#!/usr/bin/env python3
"""
antideadzone.py — system-wide stick anti-deadzone for Linux.

Reads a physical gamepad via evdev, applies deadzone + anti-deadzone
(+ optional response curve) to the stick axes, and re-emits a virtual
Xbox 360 style gamepad via uinput. All non-stick events (buttons,
triggers, d-pad) are passed through unmodified.

Config: /etc/hestia-antideadzone/config.json or
        ~/.config/hestia-antideadzone/config.json (JSON)

The config supports named PROFILES (e.g. "off", "default", a
per-game preset) plus an "active_profile" key selecting which one
is currently live. The file is polled for changes every
`reload_interval` seconds (default 1s) -- no restart needed, so you
can switch profiles or tweak numbers while a game is running and it
takes effect within about a second. See config.example.json and
switch-profile.py for a one-line way to flip `active_profile`.
"""

import json
import logging
import math
import os
import re
import select
import signal
import sys
import time
from dataclasses import dataclass, field

from evdev import InputDevice, UInput, ecodes, list_devices, categorize
import pyudev

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("antideadzone")

CONFIG_PATHS = [
    os.path.expanduser("~/.config/hestia-antideadzone/config.json"),
    "/etc/hestia-antideadzone/config.json",
]

DEFAULT_PROFILE = {
    "left": {"deadzone": 0.05, "anti_deadzone": 0.25, "curve": 1.0, "deadzone_shape": "radial"},
    "right": {"deadzone": 0.01, "anti_deadzone": 0.25, "curve": 2.0, "deadzone_shape": "radial"},
}

BUILTIN_OFF_PROFILE = {
    "left": {"deadzone": 0.0, "anti_deadzone": 0.0, "curve": 1.0, "deadzone_shape": "radial"},
    "right": {"deadzone": 0.0, "anti_deadzone": 0.0, "curve": 1.0, "deadzone_shape": "radial"},
}

DEFAULT_CONFIG = {
    # Substring match (case-insensitive) against the evdev device name.
    # Leave empty to match the first gamepad-looking device found.
    "device_name_match": "",
    "active_profile": "default",
    "profiles": {
        "off": BUILTIN_OFF_PROFILE,
    },
    # Fallback poll interval (seconds) used only if the udev/netlink
    # event monitor can't be set up at all (e.g. missing permissions,
    # pyudev not installed correctly). Normal reconnect detection is
    # event-driven and doesn't use this.
    "rescan_interval": 1.0,
    # How often (seconds) to check the config file for changes.
    "reload_interval": 1.0,
    # Log every N processed stick events at debug level (0 disables).
    "debug_sample_rate": 0,
}

STICK_AXES = {
    "left": (ecodes.ABS_X, ecodes.ABS_Y),
    "right": (ecodes.ABS_RX, ecodes.ABS_RY),
}


def find_config_path():
    for path in CONFIG_PATHS:
        if os.path.isfile(path):
            return path
    return None


def load_config(path=None):
    """Load config from `path`, or search CONFIG_PATHS if not given.
    Always returns a fully-populated dict (falls back to defaults
    for anything missing/invalid), plus the path actually used
    (or None if no file was found)."""
    cfg = json.loads(json.dumps(DEFAULT_CONFIG))  # deep copy
    if path is None:
        path = find_config_path()
    if path and os.path.isfile(path):
        try:
            with open(path) as f:
                user_cfg = json.load(f)
            for k, v in user_cfg.items():
                if k == "profiles" and isinstance(v, dict):
                    cfg["profiles"].update(v)
                else:
                    cfg[k] = v
        except Exception as e:
            log.warning("Failed to parse config %s: %s (using last-known-good/defaults)", path, e)
            return cfg, path, False
        return cfg, path, True
    return cfg, path, False


def active_profile(cfg):
    name = cfg.get("active_profile", "default")
    profiles = cfg.get("profiles", {})
    if name not in profiles:
        log.warning("active_profile '%s' not found in profiles, falling back to 'default'", name)
        name = "default" if "default" in profiles else next(iter(profiles), None)
    profile = profiles.get(name, DEFAULT_PROFILE)
    # Backfill any missing keys from the built-in default so a
    # minimal user-defined profile (e.g. just overriding "left")
    # still works.
    merged = json.loads(json.dumps(DEFAULT_PROFILE))
    for k, v in profile.items():
        if isinstance(v, dict) and k in merged:
            merged[k].update(v)
        else:
            merged[k] = v

    # Config values come straight from JSON, so a config with e.g.
    # "anti_deadzone": "0.25" (quoted by mistake) would otherwise
    # crash deep inside the shaping math with a confusing
    # str-vs-number TypeError. Coerce here, once, so a typo in the
    # config degrades to a logged warning + a safe default instead
    # of taking the whole daemon down.
    numeric_fields = {
        "deadzone": 0.0,
        "anti_deadzone": 0.0,
        "curve": 1.0,
        "sloped_dominance_curve": 1.0,
    }
    for stick in ("left", "right"):
        scfg = merged.get(stick, {})
        for field_name, fallback in numeric_fields.items():
            if field_name not in scfg:
                continue
            val = scfg[field_name]
            if isinstance(val, bool) or not isinstance(val, (int, float)):
                try:
                    scfg[field_name] = float(val)
                except (TypeError, ValueError):
                    log.warning(
                        "profile '%s' stick '%s': %s=%r is not a number, using %s",
                        name, stick, field_name, val, fallback,
                    )
                    scfg[field_name] = fallback
    return name, merged


@dataclass
class AxisState:
    """Tracks raw min/max/flat so we can normalize to -1..1 regardless
    of the physical device's reported ABS_INFO range."""
    minimum: int
    maximum: int
    center: float = field(init=False)
    span: float = field(init=False)

    def __post_init__(self):
        self.center = (self.maximum + self.minimum) / 2.0
        self.span = (self.maximum - self.minimum) / 2.0

    def normalize(self, raw):
        if self.span == 0:
            return 0.0
        v = (raw - self.center) / self.span
        return max(-1.0, min(1.0, v))


def apply_curve(mag, curve):
    """mag in [0,1]. curve==1 is linear; >1 is more precise near
    center (less sensitive at low deflection); <1 is the opposite."""
    if curve == 1.0 or mag <= 0.0:
        return mag
    return math.pow(mag, curve)


def _shape_component(v, dz, anti_deadzone, curve, scaled, dominance=1.0):
    """Shared per-axis shaping used by every axial-family shape
    (Axial, Sloped Axial, Sloped Scaled Axial, and the axial half of
    Hybrid). `dz` is this axis's own deadzone threshold -- callers
    pass either the flat configured deadzone (plain Axial) or a
    per-push sloped value (Sloped variants).

    `scaled=True` rescales output to start at 0 right at the
    deadzone edge and ramp smoothly to 1 (PadForge's "Scaled"
    variants; matches Steam Input's own anti-deadzone formula:
    output = antiDeadZone + stickInput * (1 - antiDeadZone)).
    `scaled=False` skips the rescale -- output jumps directly to the
    raw magnitude at the boundary, for games that already do their
    own rescaling.

    `dominance` (0..1, default 1.0 = no effect) scales how much of
    `anti_deadzone` actually applies to this axis. Only the Sloped
    variants pass anything other than 1.0 here -- see
    shape_axis_sloped's docstring for why."""
    sign = 1.0 if v >= 0 else -1.0
    mag = abs(v)
    if mag <= dz:
        return 0.0
    if scaled:
        span = (1.0 - dz) if dz < 1.0 else 1.0
        frac = min(1.0, (mag - dz) / span)
        frac = apply_curve(frac, curve)
    else:
        frac = min(1.0, mag)
    effective_adz = anti_deadzone * dominance
    if effective_adz > 0.0:
        out = effective_adz + frac * (1.0 - effective_adz)
    else:
        out = frac
    return sign * min(1.0, out)


def shape_axis_radial(x, y, deadzone, anti_deadzone, curve):
    """Circular deadzone, rescaled from the deadzone edge so output
    starts at 0 right at the boundary and ramps smoothly to 1 -- no
    jump. Applied to the (x, y) vector as a whole so diagonals are
    not clipped or squared off."""
    mag = math.hypot(x, y)
    if mag < 1e-6 or mag <= deadzone:
        return 0.0, 0.0

    span = (1.0 - deadzone) if deadzone < 1.0 else 1.0
    scaled = min(1.0, (mag - deadzone) / span)
    scaled = apply_curve(scaled, curve)
    if anti_deadzone > 0.0:
        scaled = anti_deadzone + scaled * (1.0 - anti_deadzone)
    scaled = min(1.0, scaled)

    scale = scaled / mag
    nx = max(-1.0, min(1.0, x * scale))
    ny = max(-1.0, min(1.0, y * scale))
    return nx, ny


def shape_axis_radial_unscaled(x, y, deadzone, anti_deadzone, curve):
    """Same circular deadzone region as Scaled Radial, but no
    rescale -- output jumps directly to the raw magnitude the instant
    the vector crosses the deadzone boundary, rather than ramping
    from 0. Intended for games that already rescale their own input,
    so this daemon shouldn't rescale a second time on top."""
    mag = math.hypot(x, y)
    if mag < 1e-6 or mag <= deadzone:
        return 0.0, 0.0

    out_mag = min(1.0, mag)
    if anti_deadzone > 0.0:
        out_mag = max(out_mag, anti_deadzone + out_mag * (1.0 - anti_deadzone))
        out_mag = min(1.0, out_mag)

    scale = out_mag / mag
    nx = max(-1.0, min(1.0, x * scale))
    ny = max(-1.0, min(1.0, y * scale))
    return nx, ny


def shape_axis_axial(v, deadzone, anti_deadzone, curve):
    """True per-axis deadzone/anti-deadzone with a FLAT threshold --
    deliberately not vector-based. This exists specifically to defeat
    games (many UE4/5 titles) whose own built-in
    deadzone is also axial: each axis independently zeroes below its
    own deadzone and rescales past it, chamfering diagonals at the
    corners rather than using a circular radius (see Unreal's 
    EDeadZoneType::Axial docs). Pre-boosting each axis here the same
    way, so the pre-boosted value survives the game re-applying its
    own per-axis deadzone on top, is what actually restores movement
    on a diagonal push the game would otherwise eat entirely -- a
    vector/magnitude-based boost does NOT survive that, since the
    game only ever sees this axis's own value, not the vector angle
    it was computed from.

    Distorts the angle of shallow diagonal pushes near the deadzone
    edge (small pushes can register as pure-cardinal, or as a
    steeper angle than intended, until deflection is well past the
    floor) -- that's an inherent consequence of two independent
    per-axis thresholds being crossed at different points, not a
    bug, and it's the same distortion the game's own axial deadzone
    would already introduce on raw input. Sloped Axial (below)
    softens this while keeping the same downstream-deadzone
    guarantee."""
    return _shape_component(v, deadzone, anti_deadzone, curve, scaled=True)


def shape_axis_axial_unscaled(v, deadzone, anti_deadzone, curve):
    """Same flat per-axis deadzone as shape_axis_axial, but no rescale --
    output jumps directly to the raw per-axis value at the boundary."""
    return _shape_component(v, deadzone, anti_deadzone, curve, scaled=False)


def _sloped_deadzones(x, y, deadzone):
    """Shared wedge-shaped per-axis deadzone used by both Sloped
    Axial variants: axis X's effective deadzone shrinks toward 0 as
    Y approaches 0 (and vice versa), rather than staying at a flat
    value. Based on the documented "sloped axial" deadzone from Josh
    Sutphin's thumbstick dead zone article and its extension at
    github.com/Minimuino/thumbstick-deadzones."""
    return deadzone * abs(y), deadzone * abs(x)


def shape_axis_sloped(x, y, deadzone, anti_deadzone, curve, dominance_curve=1.0):
    """A well-tested approach specifically designed to fix Axial's
    "snap to grid" problem at low deflection while keeping Axial's
    precise single-axis control at high deflection: a push that's
    genuinely close to one cardinal direction gets an almost-zero
    deadzone on the *other* axis (letting a small amount of that
    axis through cleanly), while a push that's already diagonal
    gets a normal deadzone on both. The reference project's own
    test suite explicitly checks "is it possible to perform a slow
    horizontal/vertical motion" and "is it easy to perform a pure
    horizontal/vertical motion" and passes both, where plain Axial
    fails the first.

    The naive per-axis sloped formula (dz_x = deadzone*abs(y), dz_y
    = deadzone*abs(x)) has a real gap right where a deadzone matters
    most: when the stick is genuinely at rest or drifting near
    center, BOTH x and y are small, so BOTH sloped thresholds
    collapse toward 0 at the same time -- meaning stick noise/drift
    passes straight through ungated and then gets boosted by
    anti_deadzone regardless of how large `deadzone` is configured.
    So a real center deadzone (vector magnitude vs `deadzone`) is
    checked FIRST, before any per-axis sloped shaping runs.

    A second, related problem: once a minor axis's (now-tiny) sloped
    threshold is crossed at all -- even by ordinary stick noise well
    short of a real diagonal push -- the anti_deadzone floor used to
    apply at FULL strength on that axis, same as the dominant axis.
    Since the sloped threshold can be crossed by a much smaller value
    than anti_deadzone itself, this meant even near-perfect single-
    axis pushes would frequently snap toward ~45 degrees whenever the
    other axis had any real-world noise above its own tiny threshold.

    `dominance_curve` controls how much of `anti_deadzone` actually
    reaches a minor axis, scaled by how large that axis's own value
    is relative to the dominant axis (min(|minor|/|major|, 1),
    raised to this power): 0.0 reproduces the old flat-floor
    behavior (anti_deadzone applies at full strength the instant the
    sloped threshold is crossed -- strongest guarantee that a real
    diagonal push clears a downstream game's own per-axis deadzone,
    but snaps toward 45 degrees on ordinary single-axis noise); 1.0
    (the default) scales the floor linearly with dominance (clean,
    stable single-axis pushes, but a shallow real diagonal gets a
    weaker boost and may not clear an aggressive game deadzone as
    reliably); values in between blend the two. There's no formula
    that removes this trade-off -- a tiny minor-axis value looks
    identical whether it's noise or a genuine shallow diagonal, so
    tune this to whichever failure mode is worse for your game."""
    if math.hypot(x, y) <= deadzone:
        return 0.0, 0.0
    dz_x, dz_y = _sloped_deadzones(x, y, deadzone)
    ax, ay = abs(x), abs(y)
    dom_x = min(1.0, ax / ay) if ay > 1e-9 else 1.0
    dom_y = min(1.0, ay / ax) if ax > 1e-9 else 1.0
    if dominance_curve != 1.0:
        dom_x = dom_x ** dominance_curve if dominance_curve > 0 else 1.0
        dom_y = dom_y ** dominance_curve if dominance_curve > 0 else 1.0
    nx = _shape_component(x, dz_x, anti_deadzone, curve, scaled=True, dominance=dom_x)
    ny = _shape_component(y, dz_y, anti_deadzone, curve, scaled=True, dominance=dom_y)
    return nx, ny


def shape_axis_sloped_unscaled(x, y, deadzone, anti_deadzone, curve, dominance_curve=1.0):
    """Same wedge-shaped per-axis deadzone as Sloped Scaled Axial,
    but no rescale -- output may jump at the boundary rather than
    ramping from 0. Intended for games that already rescale their
    own input. Same center-deadzone guard and dominance_curve tuning
    as shape_axis_sloped, and for the same reasons (see that function's
    docstring)."""
    if math.hypot(x, y) <= deadzone:
        return 0.0, 0.0
    dz_x, dz_y = _sloped_deadzones(x, y, deadzone)
    ax, ay = abs(x), abs(y)
    dom_x = min(1.0, ax / ay) if ay > 1e-9 else 1.0
    dom_y = min(1.0, ay / ax) if ax > 1e-9 else 1.0
    if dominance_curve != 1.0:
        dom_x = dom_x ** dominance_curve if dominance_curve > 0 else 1.0
        dom_y = dom_y ** dominance_curve if dominance_curve > 0 else 1.0
    nx = _shape_component(x, dz_x, anti_deadzone, curve, scaled=False, dominance=dom_x)
    ny = _shape_component(y, dz_y, anti_deadzone, curve, scaled=False, dominance=dom_y)
    return nx, ny


def shape_axis_hybrid(x, y, deadzone, anti_deadzone, curve, dominance_curve=1.0):
    """PadForge "Hybrid": a literal two-stage pipeline, matching the
    reference implementation's own dz_hybrid exactly -- Scaled
    Radial first (eliminates center noise / stick jitter with smooth
    circular falloff), then Sloped Scaled Axial applied to THAT
    already-shaped result (adds wedge-shaped axis filtering on top).
    Per the reference article: "the order in which the transforms
    are applied is relevant: scaled radial must be called first in
    order to avoid distortion for low input values." Anti-deadzone
    is applied once, inside the second (sloped axial) stage, since
    applying it in both stages would double-boost.

    PadForge's own docs describe this as suited to "competitive
    shooters needing clean center behavior and precise cardinal-
    direction tracking" -- smoother near dead-center than plain
    Sloped Scaled Axial, at the cost of an extra processing step.
    `dominance_curve` has the same meaning and trade-off here as in
    shape_axis_sloped, applied to this function's second stage."""
    # Stage 1: Scaled Radial, WITHOUT anti-deadzone -- that's applied
    # once, in stage 2, to avoid double-boosting.
    mag = math.hypot(x, y)
    if mag < 1e-6 or mag <= deadzone:
        return 0.0, 0.0
    span = (1.0 - deadzone) if deadzone < 1.0 else 1.0
    radial_scaled = min(1.0, (mag - deadzone) / span)
    radial_scaled = apply_curve(radial_scaled, curve)
    scale = radial_scaled / mag
    rx = max(-1.0, min(1.0, x * scale))
    ry = max(-1.0, min(1.0, y * scale))

    # Stage 2: Sloped Scaled Axial on the stage-1 result, this time
    # with anti-deadzone and curve both applied (curve was already
    # applied once above on magnitude; apply again per-axis matches
    # the reference's straightforward composition of the two
    # functions as independent stages).
    dz_x, dz_y = _sloped_deadzones(rx, ry, deadzone)
    arx, ary = abs(rx), abs(ry)
    dom_x = min(1.0, arx / ary) if ary > 1e-9 else 1.0
    dom_y = min(1.0, ary / arx) if arx > 1e-9 else 1.0
    if dominance_curve != 1.0:
        dom_x = dom_x ** dominance_curve if dominance_curve > 0 else 1.0
        dom_y = dom_y ** dominance_curve if dominance_curve > 0 else 1.0
    nx = _shape_component(rx, dz_x, anti_deadzone, curve, scaled=True, dominance=dom_x)
    ny = _shape_component(ry, dz_y, anti_deadzone, curve, scaled=True, dominance=dom_y)
    return nx, ny


def find_source_device(name_match: str):
    """Return the first InputDevice that looks like a gamepad
    (has ABS_X and at least one gamepad button) and optionally
    matches name_match as a case-insensitive substring."""
    candidates = []
    for path in list_devices():
        try:
            dev = InputDevice(path)
        except OSError:
            continue
        caps = dev.capabilities()
        abs_codes = {c for c, _ in caps.get(ecodes.EV_ABS, [])}
        key_codes = set(caps.get(ecodes.EV_KEY, []))
        looks_like_gamepad = (
            ecodes.ABS_X in abs_codes
            and ecodes.ABS_Y in abs_codes
            and (ecodes.BTN_GAMEPAD in key_codes
                 or ecodes.BTN_SOUTH in key_codes
                 or ecodes.BTN_A in key_codes
                 or ecodes.BTN_JOYSTICK in key_codes)
        )
        # Skip our own virtual device to avoid feedback loops.
        if "antideadzone" in dev.name.lower():
            looks_like_gamepad = False
        if looks_like_gamepad:
            if not name_match or name_match.lower() in dev.name.lower():
                candidates.append(dev)
            else:
                dev.close()
        else:
            dev.close()

    if not candidates:
        return None
    if len(candidates) > 1:
        log.warning(
            "Multiple matching devices found (%s); using the first: %s",
            [d.name for d in candidates], candidates[0].name,
        )
        for d in candidates[1:]:
            d.close()
    return candidates[0]


class DeviceWaiter:
    """Event-driven wait for a joystick-capable input device to
    appear, using udev/netlink instead of polling /dev/input on a
    timer. Falls back to timed polling only if the udev monitor
    itself can't be created (e.g. permissions issue)."""

    def __init__(self, rescan_interval=1.0):
        self.rescan_interval = rescan_interval
        self.context = None
        self.monitor = None
        try:
            self.context = pyudev.Context()
            self.monitor = pyudev.Monitor.from_netlink(self.context)
            self.monitor.filter_by(subsystem="input")
            self.monitor.start()
            log.info("udev monitor active; reconnects are event-driven")
        except Exception as e:
            log.warning(
                "Could not set up udev monitor (%s); falling back to "
                "polling every %.1fs", e, self.rescan_interval,
            )

    def wait_for_device(self, name_match: str, running_flag):
        """Block until find_source_device() succeeds, or
        running_flag() returns False (used for clean shutdown).
        Tries immediately first (covers the "already plugged in,
        first run" and "plugged in while we were briefly busy"
        cases), then waits on udev add events, re-checking
        find_source_device() each time something joystick-shaped
        shows up. Returns the InputDevice, or None if running_flag
        went false while waiting."""
        src = find_source_device(name_match)
        if src is not None:
            return src

        if self.monitor is None:
            # No udev monitor available: fall back to the old
            # timed-poll behavior.
            while running_flag():
                time.sleep(self.rescan_interval)
                src = find_source_device(name_match)
                if src is not None:
                    return src
            return None

        log.info("No controller found; waiting for one to be plugged in...")
        monitor_fd = self.monitor.fileno()
        while running_flag():
            r, _, _ = select.select([monitor_fd], [], [], 1.0)
            if not r:
                continue  # timeout, just loop back to check running_flag

            # Drain all pending udev events before rechecking, in
            # case several input nodes appeared at once (a single
            # gamepad often registers 2-3 event nodes: the main pad,
            # plus e.g. a motion-sensor or LED sub-device).
            got_joystick_hint = False
            for device in iter(lambda: self.monitor.poll(timeout=0), None):
                if device.action == "add" and device.get("ID_INPUT_JOYSTICK") == "1":
                    got_joystick_hint = True

            if got_joystick_hint:
                # Give the kernel/udev a brief moment to finish
                # setting permissions and populate all of the new
                # device's capabilities before we try to open it.
                time.sleep(0.2)
                src = find_source_device(name_match)
                if src is not None:
                    return src
                # Hint fired but our own capability/name matching
                # didn't confirm it (e.g. it was a different kind of
                # input device, or our specific pad's primary node
                # hasn't appeared yet as a separate event). Keep
                # waiting for more events rather than giving up.
        return None


def build_uinput(source: InputDevice) -> UInput:
    """Create the virtual output device, mirroring the source's
    capabilities so buttons/triggers/dpad pass through untouched,
    while sticks are re-declared with a clean -32768..32767 range
    matching standard Xbox360-style controllers."""
    caps = {}

    key_codes = source.capabilities().get(ecodes.EV_KEY, [])
    if key_codes:
        caps[ecodes.EV_KEY] = list(key_codes)

    abs_caps = []
    for code, info in source.capabilities(absinfo=True).get(ecodes.EV_ABS, []):
        if code in (ecodes.ABS_X, ecodes.ABS_Y, ecodes.ABS_RX, ecodes.ABS_RY):
            # Re-declare stick axes with a standard clean range; we
            # do the normalization ourselves in the event loop.
            new_info = info._replace(min=-32768, max=32767, flat=0, fuzz=0)
            abs_caps.append((code, new_info))
        else:
            abs_caps.append((code, info))
    if abs_caps:
        caps[ecodes.EV_ABS] = abs_caps

    uin = UInput(caps, name="antideadzone virtual gamepad", vendor=0x045e,
                 product=0x028e, version=1)
    return uin


class ConfigWatcher:
    """Tracks the config file's mtime and reloads it when changed,
    keeping the last-known-good parsed config if a reload fails
    (e.g. the file is mid-write or has a JSON syntax error)."""

    def __init__(self):
        self.cfg, self.path, found = load_config()
        self.mtime = self._current_mtime()
        if not found:
            log.info("No config file found at any of %s; using defaults", CONFIG_PATHS)
        else:
            log.info("Loaded config from %s", self.path)
        self.profile_name, self.profile = active_profile(self.cfg)
        log.info("Active profile: '%s'", self.profile_name)

    def _current_mtime(self):
        path = self.path or find_config_path()
        if path and os.path.isfile(path):
            try:
                return os.stat(path).st_mtime
            except OSError:
                return None
        return None

    def maybe_reload(self):
        """Call periodically. Returns True if the active profile
        (name or contents) changed as a result."""
        path = find_config_path()
        mtime = None
        if path and os.path.isfile(path):
            try:
                mtime = os.stat(path).st_mtime
            except OSError:
                pass

        if path == self.path and mtime == self.mtime:
            return False  # nothing changed, skip the reparse entirely

        new_cfg, new_path, found = load_config(path)
        if not found and path is None:
            # Config file was removed entirely; fall back to defaults.
            new_cfg = json.loads(json.dumps(DEFAULT_CONFIG))

        old_profile_name, old_profile = self.profile_name, self.profile
        self.cfg, self.path, self.mtime = new_cfg, path, mtime
        self.profile_name, self.profile = active_profile(self.cfg)

        changed = (self.profile_name != old_profile_name
                   or self.profile != old_profile)
        if changed:
            log.info("Config reloaded: active profile is now '%s' %s",
                      self.profile_name,
                      "(settings changed)" if self.profile_name == old_profile_name else "(switched profile)")
        return changed


def run_session(watcher: ConfigWatcher, waiter: DeviceWaiter, running_flag):
    """One connect-process-until-disconnect cycle. Returns normally
    when the source device disappears (so the caller can wait for a
    replug). Polls `watcher` for config/profile changes every
    iteration so switching profiles (or editing numbers) applies
    live, without needing to reconnect the controller.

    Device acquisition itself is event-driven (see DeviceWaiter):
    this blocks without spinning until udev announces a matching
    joystick device, rather than re-scanning /dev/input on a timer."""
    cfg = watcher.cfg
    src = waiter.wait_for_device(cfg["device_name_match"], running_flag)
    if src is None:
        return False  # running_flag went false while waiting

    log.info("Found source device: %s (%s)", src.name, src.path)

    try:
        src.grab()
    except OSError as e:
        log.warning("Could not grab %s (%s); continuing ungrabbed", src.path, e)

    axis_state = {}
    for code, info in src.capabilities(absinfo=True).get(ecodes.EV_ABS, []):
        axis_state[code] = AxisState(info.min, info.max)

    try:
        uin = build_uinput(src)
    except Exception as e:
        log.error("Failed to create virtual uinput device: %s", e)
        src.close()
        return False

    log.info("Virtual device up: %s", uin.device.path)

    # Current raw normalized values per stick, so we can recompute
    # the pair together when either axis of a stick moves (needed
    # for radial shaping), and so a profile switch takes effect
    # immediately even without new stick movement (we re-emit the
    # last known raw position through the new profile below).
    stick_raw = {"left": [0.0, 0.0], "right": [0.0, 0.0]}
    axis_to_stick_slot = {
        ecodes.ABS_X: ("left", 0), ecodes.ABS_Y: ("left", 1),
        ecodes.ABS_RX: ("right", 0), ecodes.ABS_RY: ("right", 1),
    }

    debug_count = 0
    last_config_check = 0.0

    # Maps config "deadzone_shape" string to the function that
    # implements it, matching PadForge's own shape names, plus
    # whether that function accepts the extra sloped_dominance_curve
    # tuning knob (only the sloped-family shapes do). Kept as a
    # module-level-ish dict here (closed over cfg/curve args at call
    # time) so adding a shape later is a one-line addition.
    SHAPE_FUNCS = {
        "radial": ("vector", shape_axis_radial, False),
        "radial_unscaled": ("vector", shape_axis_radial_unscaled, False),
        "axial": ("per_axis", shape_axis_axial, False),
        "axial_unscaled": ("per_axis", shape_axis_axial_unscaled, False),
        "sloped_axial": ("vector", shape_axis_sloped, True),
        "sloped_axial_unscaled": ("vector", shape_axis_sloped_unscaled, True),
        "hybrid": ("vector", shape_axis_hybrid, True),
    }

    def emit_stick(stick, profile):
        scfg = profile["left"] if stick == "left" else profile["right"]
        shape = scfg.get("deadzone_shape", "radial")
        x, y = stick_raw[stick]
        kind, func, takes_dom_curve = SHAPE_FUNCS.get(shape, SHAPE_FUNCS["radial"])
        extra = (scfg.get("sloped_dominance_curve", 1.0),) if takes_dom_curve else ()
        if kind == "per_axis":
            nx = func(x, scfg["deadzone"], scfg["anti_deadzone"], scfg["curve"], *extra)
            ny = func(y, scfg["deadzone"], scfg["anti_deadzone"], scfg["curve"], *extra)
        else:
            nx, ny = func(x, y, scfg["deadzone"], scfg["anti_deadzone"], scfg["curve"], *extra)
        out_x, out_y = int(nx * 32767), int(ny * 32767)
        ax_x, ax_y = STICK_AXES[stick]
        uin.write(ecodes.EV_ABS, ax_x, out_x)
        uin.write(ecodes.EV_ABS, ax_y, out_y)
        return x, y, out_x, out_y

    try:
        while True:
            now = time.monotonic()
            if now - last_config_check >= cfg.get("reload_interval", 1.0):
                last_config_check = now
                if watcher.maybe_reload():
                    # Re-shape both sticks' last known position through
                    # the new profile right away, so e.g. switching to
                    # "off" mid-hold snaps to the raw value instantly
                    # instead of waiting for the next stick movement.
                    for stick in ("left", "right"):
                        emit_stick(stick, watcher.profile)
                    uin.syn()
                cfg = watcher.cfg  # pick up rescan_interval/device_name_match etc. too

            r, _, _ = select.select([src.fd], [], [], 1.0)
            if not r:
                continue
            try:
                # src.read() returns a generator; the actual read()
                # syscall doesn't happen until it's iterated, so wrap
                # it in list(...) here to force that inside the try --
                # otherwise the OSError from an unplugged device gets
                # raised later at the "for ev in events" loop below,
                # outside this except, and shows up as an unhandled
                # traceback ("Unexpected error in session") instead of
                # the clean "Source device disconnected" path.
                events = list(src.read())
            except (OSError, BlockingIOError):
                # Device likely unplugged.
                break

            for ev in events:
                if ev.type == ecodes.EV_ABS and ev.code in axis_to_stick_slot:
                    stick, slot = axis_to_stick_slot[ev.code]
                    st = axis_state[ev.code]
                    stick_raw[stick][slot] = st.normalize(ev.value)
                    x, y, out_x, out_y = emit_stick(stick, watcher.profile)

                    if cfg.get("debug_sample_rate"):
                        debug_count += 1
                        if debug_count % cfg["debug_sample_rate"] == 0:
                            log.debug("[%s] %s stick raw=(%.2f,%.2f) out=(%d,%d)",
                                      watcher.profile_name, stick, x, y, out_x, out_y)
                elif ev.type in (ecodes.EV_KEY, ecodes.EV_ABS, ecodes.EV_SYN):
                    # Passthrough: buttons, triggers, dpad, syn reports.
                    uin.write(ev.type, ev.code, ev.value)
            uin.syn()
    finally:
        try:
            src.ungrab()
        except Exception:
            pass
        src.close()
        uin.close()
        log.warning("Source device disconnected; waiting for reconnect.")

    return True


def main():
    watcher = ConfigWatcher()
    waiter = DeviceWaiter(rescan_interval=watcher.cfg.get("rescan_interval", 1.0))

    running = True

    def handle_term(signum, frame):
        nonlocal running
        log.info("Received signal %s, shutting down", signum)
        running = False

    signal.signal(signal.SIGINT, lambda sig, frame: os._exit(0))
    signal.signal(signal.SIGTERM, lambda sig, frame: os._exit(0))

    # signal.signal(signal.SIGTERM, handle_term)
    # signal.signal(signal.SIGINT, handle_term)

    p = watcher.profile
    log.info("antideadzone starting (profile='%s' left dz=%.2f adz=%.2f shape=%s, right dz=%.2f adz=%.2f shape=%s)",
              watcher.profile_name, p["left"]["deadzone"], p["left"]["anti_deadzone"], p["left"]["deadzone_shape"],
              p["right"]["deadzone"], p["right"]["anti_deadzone"], p["right"]["deadzone_shape"])

    while running:
        try:
            run_session(watcher, waiter, lambda: running)
        except Exception as e:
            log.exception("Unexpected error in session: %s", e)
            if running:
                # Something unexpected blew up outside the normal
                # disconnect path; brief pause so a persistent error
                # doesn't spin the CPU, then let wait_for_device
                # take over again (still event-driven from there).
                time.sleep(1.0)

    log.info("Stopped.")


if __name__ == "__main__":
    main()
