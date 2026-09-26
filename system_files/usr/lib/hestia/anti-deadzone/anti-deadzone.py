#!/usr/bin/env python3
"""
antideadzone.py — system-wide stick anti-deadzone for Linux.

Reads a physical gamepad via evdev, applies deadzone + anti-deadzone
(+ optional response curve) to the stick axes, and re-emits a virtual
Xbox 360 style gamepad via uinput. All non-stick events (buttons,
triggers, d-pad) are passed through unmodified.

Runs as a long-lived daemon that survives controller unplug/replug,
and also picks up a controller plugged in for the first time after
the daemon started (no restart needed). Reconnection is event-driven
via udev/netlink rather than polling: the daemon blocks on a udev
monitor waiting for the kernel to announce a new joystick-capable
input device, instead of repeatedly re-scanning /dev/input on a
timer. Meant to be run under systemd as a user service (see
antideadzone.service).

Config: /etc/hestia/anti-deadzone/config.json or
        ~/.config/hestia/anti-deadzone/config.json (JSON)

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
    os.path.expanduser("~/.config/hestia/anti-deadzone/config.json"),
    "/etc/hestia/anti-deadzone/config.json",
]

DEFAULT_PROFILE = {
    "left": {"deadzone": 0.05, "anti_deadzone": 0.25, "curve": 1.0, "deadzone_shape": "radial"},
    "right": {"deadzone": 0.01, "anti_deadzone": 0.25, "curve": 1.0, "deadzone_shape": "radial"},
}

# "off" is always available even if the user never defines it: it
# passes sticks through raw (deadzone/anti_deadzone both 0), so
# switching to it for a game that fights with any shaping is a
# single active_profile change away, same mechanism as switching
# to a real profile.
BUILTIN_OFF_PROFILE = {
    "left": {"deadzone": 0.0, "anti_deadzone": 0.0, "curve": 1.0, "deadzone_shape": "radial"},
    "right": {"deadzone": 0.0, "anti_deadzone": 0.0, "curve": 1.0, "deadzone_shape": "radial"},
}

DEFAULT_CONFIG = {
    # Substring match (case-insensitive) against the evdev device name.
    # Leave empty to match the first gamepad-looking device found.
    "device_name_match": "",
    # Which profile below is currently active. Change this (by hand
    # or via switch-profile.py) to switch behavior on the fly.
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
    # Cap how often stick ABS events are sent to the virtual device,
    # in Hz. 0 (default) disables the cap -- send every shaped value
    # as fast as the source controller reports it. Useful for high
    # polling rate controllers (500/1000Hz) under Proton, where
    # XInput emulation can buffer/lag on very frequent input; 250Hz
    # matches a real Xbox 360 controller's native polling rate.
    # Buttons/triggers/dpad are never rate-limited, only the stick
    # axes -- and the most recent shaped value is always eventually
    # sent, never dropped outright.
    "max_output_hz": 0,
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
    # "anti_deadzone": "0.26" (quoted by mistake) would otherwise
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

    # max_output_hz is profile-level (applies to both sticks
    # together, not per-stick), and optional -- a profile that
    # doesn't set it falls back to the config-wide value at the call
    # site (see min_interval()), so it's left out of `merged`
    # entirely here unless the profile itself set it. Only coerce it
    # if present, same reasoning as the per-stick fields above.
    if "max_output_hz" in merged:
        val = merged["max_output_hz"]
        if isinstance(val, bool) or not isinstance(val, (int, float)):
            try:
                merged["max_output_hz"] = float(val)
            except (TypeError, ValueError):
                log.warning(
                    "profile '%s': max_output_hz=%r is not a number, ignoring (falling back to config-wide value)",
                    name, val,
                )
                del merged["max_output_hz"]

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
    """Shape one axis: gate at `dz`, then floor to anti_deadzone*dominance
    and ramp to 1. scaled=True rescales output from 0 at the deadzone
    edge; scaled=False jumps straight to the raw value."""
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
    """Circular deadzone, rescaled from the edge (no jump). Shaped as
    a vector so diagonals aren't clipped or squared off."""
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
    """Same circular deadzone as shape_axis_radial, but no rescale --
    output jumps to the raw magnitude at the boundary. For games that
    already rescale their own input."""
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
    """Per-axis deadzone/anti-deadzone with a flat threshold, applied
    independently to one axis at a time (not vector-based). Boosts
    each axis on its own so the boost survives a game re-applying its
    own per-axis deadzone downstream -- a vector-based boost would
    not, since the game never sees the combined angle, only this
    axis's own value.

    Distorts angle on shallow diagonal pushes near the deadzone edge,
    since the two axes cross their thresholds at different points.
    See shape_axis_sloped for a variant that softens this."""
    return _shape_component(v, deadzone, anti_deadzone, curve, scaled=True)


def shape_axis_axial_unscaled(v, deadzone, anti_deadzone, curve):
    """Same flat per-axis deadzone as shape_axis_axial, no rescale --
    jumps to the raw value at the boundary."""
    return _shape_component(v, deadzone, anti_deadzone, curve, scaled=False)


def _sloped_deadzones(x, y, deadzone):
    """Wedge-shaped per-axis deadzone: axis X's threshold shrinks
    toward 0 as Y approaches 0, and vice versa, instead of staying
    flat like plain axial."""
    return deadzone * abs(y), deadzone * abs(x)


def shape_axis_sloped(x, y, deadzone, anti_deadzone, curve, dominance_curve=1.0):
    """Wedge-shaped per-axis deadzone (see _sloped_deadzones), which
    softens axial's angle distortion: a push near one cardinal gets a
    near-zero deadzone on the other axis, while a real diagonal still
    gets a normal deadzone on both.

    Requires a real vector-magnitude center gate first -- without it,
    stick noise near dead-center would pass straight through, since
    both sloped thresholds collapse toward 0 when both axes are small.

    `dominance_curve` controls how much of anti_deadzone reaches the
    smaller axis, scaled by (|minor|/|major|) ** dominance_curve:
    0.0 = full floor the instant the sloped threshold is crossed
    (strong guarantee a diagonal clears a game's own deadzone, but
    ordinary noise on the off-axis snaps toward 45 degrees); 1.0
    (default) = floor scales down with how small that axis actually
    is (clean single-axis pushes, weaker boost on shallow diagonals).
    No setting removes this trade-off -- tune to taste."""
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
    """Same wedge-shaped deadzone as shape_axis_sloped, no rescale --
    jumps at the boundary instead of ramping from 0."""
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
    """Two-stage shape: radial first (smooths out center noise/jitter
    with a circular falloff), then sloped-axial on that result (adds
    per-axis precision on top). Anti-deadzone is only applied in the
    second stage, to avoid double-boosting. `dominance_curve` has the
    same meaning as in shape_axis_sloped."""
    # Stage 1: radial, no anti-deadzone yet.
    mag = math.hypot(x, y)
    if mag < 1e-6 or mag <= deadzone:
        return 0.0, 0.0
    span = (1.0 - deadzone) if deadzone < 1.0 else 1.0
    radial_scaled = min(1.0, (mag - deadzone) / span)
    radial_scaled = apply_curve(radial_scaled, curve)
    scale = radial_scaled / mag
    rx = max(-1.0, min(1.0, x * scale))
    ry = max(-1.0, min(1.0, y * scale))

    # Stage 2: sloped-axial on the stage-1 result, with anti-deadzone.
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

    uin = UInput(caps, name="Xbox Wireless Controller", vendor=0x045e,
                 product=0x02ff, version=1)
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
    # implements it, plus whether that function accepts the extra
    # sloped_dominance_curve tuning knob (only the sloped-family
    # shapes do).
    SHAPE_FUNCS = {
        "radial": ("vector", shape_axis_radial, False),
        "radial_unscaled": ("vector", shape_axis_radial_unscaled, False),
        "axial": ("per_axis", shape_axis_axial, False),
        "axial_unscaled": ("per_axis", shape_axis_axial_unscaled, False),
        "sloped_axial": ("vector", shape_axis_sloped, True),
        "sloped_axial_unscaled": ("vector", shape_axis_sloped_unscaled, True),
        "hybrid": ("vector", shape_axis_hybrid, True),
    }

    def shape_stick(stick, profile):
        """Run one stick's raw (x, y) through its configured shape.
        Does not touch uin -- see emit_stick / flush_stick for that."""
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
        return x, y, int(nx * 32767), int(ny * 32767)

    # Output rate limiting (max_output_hz): pending[stick] holds the
    # most recently shaped-but-not-yet-written value for that stick,
    # or None if nothing is waiting. A stick's ABS events are only
    # actually written to uin at most once per min_interval seconds;
    # everything shaped in between just overwrites `pending` so the
    # most recent value is what eventually goes out -- nothing is
    # silently dropped forever, it's coalesced to the latest sample.
    # min_interval == 0 means no limiting: emit_stick writes straight
    # through immediately, same as before this feature existed.
    last_sent_time = {"left": 0.0, "right": 0.0}
    pending = {"left": None, "right": None}

    def min_interval(profile):
        """Per-profile max_output_hz overrides the config-wide value
        when the active profile sets one; otherwise falls back to
        cfg's top-level max_output_hz. 0/unset on both means no
        limiting."""
        hz = profile.get("max_output_hz", cfg.get("max_output_hz", 0))
        if isinstance(hz, bool) or not isinstance(hz, (int, float)):
            try:
                hz = float(hz)
            except (TypeError, ValueError):
                hz = 0
        return (1.0 / hz) if hz and hz > 0 else 0.0

    def emit_stick(stick, profile):
        """Shape the stick's current raw position and either write it
        immediately (no rate limit configured, or enough time has
        passed since the last write for this stick) or stash it in
        `pending` to be flushed later by flush_pending_sticks()."""
        x, y, out_x, out_y = shape_stick(stick, profile)
        interval = min_interval(profile)
        now = time.monotonic()
        if interval <= 0.0 or (now - last_sent_time[stick]) >= interval:
            write_stick(stick, out_x, out_y)
            last_sent_time[stick] = now
            pending[stick] = None
        else:
            pending[stick] = (out_x, out_y)
        return x, y, out_x, out_y

    def write_stick(stick, out_x, out_y):
        ax_x, ax_y = STICK_AXES[stick]
        uin.write(ecodes.EV_ABS, ax_x, out_x)
        uin.write(ecodes.EV_ABS, ax_y, out_y)

    def flush_pending_sticks(profile):
        """Write out any stick whose throttle window has elapsed
        since it was last stashed in `pending`. Called every loop
        iteration (including on the select() timeout) so a value
        that's just being held steady -- not re-triggered by new
        stick movement -- still goes out promptly instead of waiting
        indefinitely for the next physical event."""
        interval = min_interval(profile)
        if interval <= 0.0:
            return False
        now = time.monotonic()
        wrote = False
        for stick in ("left", "right"):
            if pending[stick] is not None and (now - last_sent_time[stick]) >= interval:
                out_x, out_y = pending[stick]
                write_stick(stick, out_x, out_y)
                last_sent_time[stick] = now
                pending[stick] = None
                wrote = True
        return wrote

    def next_flush_wait(profile):
        """Seconds until the earliest pending stick's throttle window
        elapses, for sizing the select() timeout -- so the loop wakes
        up in time to flush even with no new controller input, but
        doesn't busy-loop when nothing is pending."""
        interval = min_interval(profile)
        if interval <= 0.0:
            return 1.0
        now = time.monotonic()
        waits = [
            max(0.0, last_sent_time[s] + interval - now)
            for s in ("left", "right") if pending[s] is not None
        ]
        return min(waits) if waits else 1.0

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

            if flush_pending_sticks(watcher.profile):
                uin.syn()

            select_timeout = min(1.0, next_flush_wait(watcher.profile))
            r, _, _ = select.select([src.fd], [], [], select_timeout)
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
    effective_hz = p.get("max_output_hz", watcher.cfg.get("max_output_hz", 0))
    hz_source = "profile override" if "max_output_hz" in p else "config-wide"
    log.info("antideadzone starting (profile='%s' left dz=%.2f adz=%.2f shape=%s, right dz=%.2f adz=%.2f shape=%s, max_output_hz=%s [%s])",
              watcher.profile_name, p["left"]["deadzone"], p["left"]["anti_deadzone"], p["left"]["deadzone_shape"],
              p["right"]["deadzone"], p["right"]["anti_deadzone"], p["right"]["deadzone_shape"],
              effective_hz if effective_hz else "unlimited", hz_source)

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
