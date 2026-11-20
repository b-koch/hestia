#!/usr/bin/env python3
"""
antideadzone.py (adz) — system-wide stick anti-deadzone & profile CLI for Linux.

Unifies the background evdev/uinput daemon, profile switcher, pause/resume
controller, and input device inspector into a single executable (typically
symlinked as `adz`).

Subcommands:
    adz                         Show status and list available profiles
    adz list                    Show status and list available profiles
    adz status                  Print concise active/paused state
    adz pause                   Release controller grab & remove virtual device
    adz resume                  Re-enable virtual device & stick shaping
    adz toggle                  Flip between paused and active
    adz switch <profile>        Switch active profile
    adz devices                 List /dev/input devices and gamepad matches
    adz daemon                  Run the background evdev -> uinput daemon
"""

import argparse
import json
import logging
import math
import os
import select
import signal
import socket
import sys
import tempfile
import time
from dataclasses import dataclass, field

log = logging.getLogger("antideadzone")

CONFIG_PATHS = [
    os.path.expanduser("~/.config/hestia/anti-deadzone/config.json"),
    "/etc/hestia/anti-deadzone/config.json",
]

VIRTUAL_DEVICE_NAME = "Xbox Wireless Controller"
VIRTUAL_VENDOR = 0x045E
VIRTUAL_PRODUCT = 0x02FF
VIRTUAL_VERSION = 1

DEFAULT_PROFILE = {
    "left": {
        "deadzone": 0.05,
        "anti_deadzone": 0.25,
        "curve": 1.0,
        "deadzone_shape": "radial",
    },
    "right": {
        "deadzone": 0.01,
        "anti_deadzone": 0.25,
        "curve": 1.0,
        "deadzone_shape": "radial",
    },
}

BUILTIN_OFF_PROFILE = {
    "left": {"deadzone": 0.0, "anti_deadzone": 0.0, "curve": 1.0, "deadzone_shape": "radial"},
    "right": {"deadzone": 0.0, "anti_deadzone": 0.0, "curve": 1.0, "deadzone_shape": "radial"},
}

DEFAULT_CONFIG = {
    "paused": False,
    "device_name_match": "",
    "active_profile": "default",
    "profiles": {
        "off": BUILTIN_OFF_PROFILE,
    },
    "rescan_interval": 1.0,
    "reload_interval": 1.0,
    "debug_sample_rate": 0,
    "max_output_hz": 0,
}

NUMERIC_STICK_FIELDS = {
    "deadzone": 0.0,
    "anti_deadzone": 0.0,
    "axial_deadzone": 0.0,
    "curve": 1.0,
    "sloped_dominance_curve": 1.0,
}


# ---------------------------------------------------------------------------
# Lazy dependency loaders (keeps CLI commands fast & stdlib-only)
# ---------------------------------------------------------------------------

def _import_evdev():
    try:
        from evdev import InputDevice, UInput, ecodes, list_devices
        return InputDevice, UInput, ecodes, list_devices
    except ImportError:
        print(
            "Error: Python package 'evdev' is required for this command.\n"
            "Install it via your system package manager (e.g. python3-evdev) "
            "or `pip install evdev`.",
            file=sys.stderr,
        )
        sys.exit(1)


def _import_pyudev():
    try:
        import pyudev
        return pyudev
    except ImportError:
        return None


# ---------------------------------------------------------------------------
# PID file & instant daemon signaling
# ---------------------------------------------------------------------------

def get_pid_file_path() -> str:
    runtime_dir = os.environ.get("XDG_RUNTIME_DIR")
    if runtime_dir and os.path.isdir(runtime_dir):
        return os.path.join(runtime_dir, "hestia-antideadzone.pid")
    return os.path.join(tempfile.gettempdir(), f"hestia-antideadzone-{os.getuid()}.pid")


def write_pid_file():
    pid_path = get_pid_file_path()
    try:
        with open(pid_path, "w") as f:
            f.write(f"{os.getpid()}\n")
    except OSError as e:
        log.debug("Could not write PID file %s: %s", pid_path, e)


def remove_pid_file():
    pid_path = get_pid_file_path()
    try:
        if os.path.isfile(pid_path):
            with open(pid_path) as f:
                recorded = f.read().strip()
            if recorded == str(os.getpid()):
                os.unlink(pid_path)
    except OSError:
        pass


def get_running_daemon_pid():
    """Return the PID of a live `adz daemon` process, or None."""
    pid_path = get_pid_file_path()
    if not os.path.isfile(pid_path):
        return None
    try:
        with open(pid_path) as f:
            pid = int(f.read().strip())
    except (OSError, ValueError):
        return None

    if pid <= 0 or pid == os.getpid():
        return None

    try:
        os.kill(pid, 0)
    except OSError:
        return None

    # Verify /proc/<pid>/cmdline matches this script so a recycled PID is never signaled.
    cmdline_path = f"/proc/{pid}/cmdline"
    try:
        with open(cmdline_path, "rb") as f:
            cmdline = f.read().decode("utf-8", errors="replace")
        if "antideadzone" not in cmdline and "adz" not in cmdline:
            return None
    except OSError:
        pass

    return pid


def notify_daemon_reload() -> bool:
    """Send SIGHUP to a running daemon so config changes apply immediately."""
    pid = get_running_daemon_pid()
    if pid is None:
        return False
    try:
        os.kill(pid, signal.SIGHUP)
        return True
    except OSError:
        return False


# ---------------------------------------------------------------------------
# Config loading, validation, and atomic persistence
# ---------------------------------------------------------------------------

def find_config_path(override_path=None):
    if override_path:
        return override_path if os.path.isfile(override_path) else None
    for path in CONFIG_PATHS:
        if os.path.isfile(path):
            return path
    return None


def load_config(path=None):
    cfg = json.loads(json.dumps(DEFAULT_CONFIG))
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
            log.warning("Failed to parse config %s: %s (using defaults)", path, e)
            return cfg, path, False
        return cfg, path, True
    return cfg, path, False


def save_config_atomic(path: str, cfg: dict):
    """Write JSON atomically while preserving symlink targets."""
    real_path = os.path.realpath(path)
    parent = os.path.dirname(real_path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    tmp_path = f"{real_path}.{os.getpid()}.tmp"
    with open(tmp_path, "w") as f:
        json.dump(cfg, f, indent=2)
        f.write("\n")
    os.replace(tmp_path, real_path)


def active_profile(cfg):
    name = cfg.get("active_profile", "default")
    profiles = cfg.get("profiles", {})
    if name not in profiles:
        log.warning("active_profile '%s' not found in profiles, falling back to 'default'", name)
        name = "default" if "default" in profiles else next(iter(profiles), None)
    profile = profiles.get(name, DEFAULT_PROFILE)

    merged = json.loads(json.dumps(DEFAULT_PROFILE))
    for k, v in profile.items():
        if isinstance(v, dict) and k in merged:
            merged[k].update(v)
        else:
            merged[k] = v

    for stick in ("left", "right"):
        scfg = merged.get(stick, {})
        for field_name, fallback in NUMERIC_STICK_FIELDS.items():
            if field_name not in scfg or scfg[field_name] is None:
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

    if "max_output_hz" in merged:
        val = merged["max_output_hz"]
        if isinstance(val, bool) or not isinstance(val, (int, float)):
            try:
                merged["max_output_hz"] = float(val)
            except (TypeError, ValueError):
                log.warning(
                    "profile '%s': max_output_hz=%r is not a number, ignoring",
                    name, val,
                )
                del merged["max_output_hz"]

    return name, merged


# ---------------------------------------------------------------------------
# Stick normalization & deadzone shaping math
# ---------------------------------------------------------------------------

@dataclass
class AxisState:
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


def _clamp(v, lo, hi):
    return lo if v < lo else (hi if v > hi else v)


def _smoothstep(t):
    t = _clamp(t, 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def apply_curve(mag, curve):
    if curve == 1.0 or mag <= 0.0:
        return mag
    if curve <= 0.0:
        return 1.0
    return math.pow(mag, curve)


def _effective_bowtie_width(deadzone, anti_deadzone, axial_deadzone=None):
    if axial_deadzone is not None:
        return _clamp(axial_deadzone, 0.0, 0.95)
    if deadzone < 0.05 and anti_deadzone > 0.0:
        derived = max(deadzone, anti_deadzone * 0.45)
        return _clamp(derived, 0.0, 0.35)
    return _clamp(deadzone, 0.0, 0.95)


def _sloped_deadzones(x, y, deadzone, bowtie_width):
    dz_x = max(deadzone, bowtie_width * abs(y))
    dz_y = max(deadzone, bowtie_width * abs(x))
    return min(0.99, dz_x), min(0.99, dz_y)


def _smooth_dominance(minor, major, dominance_curve):
    if major <= 1e-9 or dominance_curve <= 0.0:
        return 1.0
    ratio = _clamp(minor / major, 0.0, 1.0)
    dom = _smoothstep(ratio)
    if dominance_curve != 1.0:
        dom = math.pow(dom, dominance_curve)
    return dom


def _shape_component(v, dz, anti_deadzone, curve, scaled, dominance=1.0):
    sign = 1.0 if v >= 0.0 else -1.0
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


def _clamp_outer_circle(nx, ny):
    mag = math.hypot(nx, ny)
    if mag > 1.0:
        inv = 1.0 / mag
        return nx * inv, ny * inv
    return nx, ny


def shape_axis_radial(x, y, deadzone, anti_deadzone, curve, **_kwargs):
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
    return _clamp(x * scale, -1.0, 1.0), _clamp(y * scale, -1.0, 1.0)


def shape_axis_radial_unscaled(x, y, deadzone, anti_deadzone, curve, **_kwargs):
    mag = math.hypot(x, y)
    if mag < 1e-6 or mag <= deadzone:
        return 0.0, 0.0

    out_mag = min(1.0, mag)
    if anti_deadzone > 0.0:
        out_mag = min(1.0, anti_deadzone + out_mag * (1.0 - anti_deadzone))

    scale = out_mag / mag
    return _clamp(x * scale, -1.0, 1.0), _clamp(y * scale, -1.0, 1.0)


def shape_axis_axial(x, y, deadzone, anti_deadzone, curve, axial_deadzone=None,
                     outer_circle_clamp=False, **_kwargs):
    dz = max(deadzone, axial_deadzone) if axial_deadzone is not None else deadzone
    nx = _shape_component(x, dz, anti_deadzone, curve, scaled=True)
    ny = _shape_component(y, dz, anti_deadzone, curve, scaled=True)
    if outer_circle_clamp:
        nx, ny = _clamp_outer_circle(nx, ny)
    return nx, ny


def shape_axis_axial_unscaled(x, y, deadzone, anti_deadzone, curve, axial_deadzone=None,
                              outer_circle_clamp=False, **_kwargs):
    dz = max(deadzone, axial_deadzone) if axial_deadzone is not None else deadzone
    nx = _shape_component(x, dz, anti_deadzone, curve, scaled=False)
    ny = _shape_component(y, dz, anti_deadzone, curve, scaled=False)
    if outer_circle_clamp:
        nx, ny = _clamp_outer_circle(nx, ny)
    return nx, ny


def shape_axis_bowtie(x, y, deadzone, anti_deadzone, curve, axial_deadzone=None, **_kwargs):
    mag = math.hypot(x, y)
    if mag < 1e-6 or mag <= deadzone:
        return 0.0, 0.0

    w = _effective_bowtie_width(deadzone, anti_deadzone, axial_deadzone)
    ax, ay = abs(x), abs(y)
    ex = max(0.0, ax - w * ay)
    ey = max(0.0, ay - w * ax)
    e_mag = math.hypot(ex, ey)
    if e_mag < 1e-9:
        return 0.0, 0.0

    span = (1.0 - deadzone) if deadzone < 1.0 else 1.0
    scaled = min(1.0, (mag - deadzone) / span)
    scaled = apply_curve(scaled, curve)
    if anti_deadzone > 0.0:
        scaled = anti_deadzone + scaled * (1.0 - anti_deadzone)
    scaled = min(1.0, scaled)

    sx = 1.0 if x >= 0.0 else -1.0
    sy = 1.0 if y >= 0.0 else -1.0
    nx = sx * (ex / e_mag) * scaled
    ny = sy * (ey / e_mag) * scaled
    return _clamp(nx, -1.0, 1.0), _clamp(ny, -1.0, 1.0)


def shape_axis_sloped(x, y, deadzone, anti_deadzone, curve, dominance_curve=1.0,
                      axial_deadzone=None, outer_circle_clamp=False, **_kwargs):
    if math.hypot(x, y) <= deadzone:
        return 0.0, 0.0
    w = _effective_bowtie_width(deadzone, anti_deadzone, axial_deadzone)
    dz_x, dz_y = _sloped_deadzones(x, y, deadzone, w)
    ax, ay = abs(x), abs(y)
    dom_x = _smooth_dominance(ax, ay, dominance_curve)
    dom_y = _smooth_dominance(ay, ax, dominance_curve)
    nx = _shape_component(x, dz_x, anti_deadzone, curve, scaled=True, dominance=dom_x)
    ny = _shape_component(y, dz_y, anti_deadzone, curve, scaled=True, dominance=dom_y)
    if outer_circle_clamp:
        nx, ny = _clamp_outer_circle(nx, ny)
    return nx, ny


def shape_axis_sloped_unscaled(x, y, deadzone, anti_deadzone, curve, dominance_curve=1.0,
                               axial_deadzone=None, outer_circle_clamp=False, **_kwargs):
    if math.hypot(x, y) <= deadzone:
        return 0.0, 0.0
    w = _effective_bowtie_width(deadzone, anti_deadzone, axial_deadzone)
    dz_x, dz_y = _sloped_deadzones(x, y, deadzone, w)
    ax, ay = abs(x), abs(y)
    dom_x = _smooth_dominance(ax, ay, dominance_curve)
    dom_y = _smooth_dominance(ay, ax, dominance_curve)
    nx = _shape_component(x, dz_x, anti_deadzone, curve, scaled=False, dominance=dom_x)
    ny = _shape_component(y, dz_y, anti_deadzone, curve, scaled=False, dominance=dom_y)
    if outer_circle_clamp:
        nx, ny = _clamp_outer_circle(nx, ny)
    return nx, ny


def shape_axis_hybrid(x, y, deadzone, anti_deadzone, curve, dominance_curve=1.0,
                      axial_deadzone=None, outer_circle_clamp=True, **_kwargs):
    mag = math.hypot(x, y)
    if mag < 1e-6 or mag <= deadzone:
        return 0.0, 0.0

    span = (1.0 - deadzone) if deadzone < 1.0 else 1.0
    radial_scaled = min(1.0, (mag - deadzone) / span)
    radial_scaled = apply_curve(radial_scaled, curve)
    scale = radial_scaled / mag
    rx = _clamp(x * scale, -1.0, 1.0)
    ry = _clamp(y * scale, -1.0, 1.0)

    w = _effective_bowtie_width(deadzone, anti_deadzone, axial_deadzone)
    dz_x, dz_y = _sloped_deadzones(rx, ry, 0.0, w)
    arx, ary = abs(rx), abs(ry)
    dom_x = _smooth_dominance(arx, ary, dominance_curve)
    dom_y = _smooth_dominance(ary, arx, dominance_curve)
    nx = _shape_component(rx, dz_x, anti_deadzone, 1.0, scaled=True, dominance=dom_x)
    ny = _shape_component(ry, dz_y, anti_deadzone, 1.0, scaled=True, dominance=dom_y)
    if outer_circle_clamp:
        nx, ny = _clamp_outer_circle(nx, ny)
    return nx, ny


SHAPE_FUNCS = {
    "radial": shape_axis_radial,
    "radial_unscaled": shape_axis_radial_unscaled,
    "axial": shape_axis_axial,
    "axial_unscaled": shape_axis_axial_unscaled,
    "bowtie": shape_axis_bowtie,
    "sloped_axial": shape_axis_sloped,
    "sloped_axial_unscaled": shape_axis_sloped_unscaled,
    "hybrid": shape_axis_hybrid,
}


# ---------------------------------------------------------------------------
# Device discovery (shared between `adz devices` and `adz daemon`)
# ---------------------------------------------------------------------------

def is_our_virtual_device(dev) -> bool:
    if "antideadzone" in dev.name.lower():
        return True
    info = dev.info
    return (
        not dev.phys
        and dev.name == VIRTUAL_DEVICE_NAME
        and info.vendor == VIRTUAL_VENDOR
        and info.product == VIRTUAL_PRODUCT
        and info.version == VIRTUAL_VERSION
    )


def is_gamepad_device(dev, ecodes) -> bool:
    if is_our_virtual_device(dev):
        return False
    caps = dev.capabilities()
    abs_codes = {c for c, _ in caps.get(ecodes.EV_ABS, [])}
    key_codes = set(caps.get(ecodes.EV_KEY, []))
    return (
        ecodes.ABS_X in abs_codes
        and ecodes.ABS_Y in abs_codes
        and bool(
            key_codes
            & {
                ecodes.BTN_GAMEPAD,
                ecodes.BTN_SOUTH,
                ecodes.BTN_A,
                ecodes.BTN_JOYSTICK,
            }
        )
    )


def find_source_device(name_match: str):
    InputDevice, _, ecodes, list_devices = _import_evdev()
    candidates = []
    for path in sorted(list_devices()):
        try:
            dev = InputDevice(path)
        except OSError:
            continue
        if is_gamepad_device(dev, ecodes):
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
            [d.name for d in candidates],
            candidates[0].name,
        )
        for d in candidates[1:]:
            d.close()
    return candidates[0]


# ---------------------------------------------------------------------------
# Daemon runtime
# ---------------------------------------------------------------------------

class DeviceWaiter:
    def __init__(self, rescan_interval=1.0):
        self.rescan_interval = rescan_interval
        self.context = None
        self.monitor = None
        pyudev = _import_pyudev()
        if pyudev is not None:
            try:
                self.context = pyudev.Context()
                self.monitor = pyudev.Monitor.from_netlink(self.context)
                self.monitor.filter_by(subsystem="input")
                self.monitor.start()
                log.info("udev monitor active; reconnects are event-driven")
            except Exception as e:
                log.warning(
                    "Could not set up udev monitor (%s); falling back to polling every %.1fs",
                    e,
                    self.rescan_interval,
                )
        else:
            log.info("pyudev not installed; polling every %.1fs for controller", self.rescan_interval)

    def wait_for_device(self, name_match: str, running_flag, wakeup_fd: int, on_poll_tick=None):
        src = find_source_device(name_match)
        if src is not None:
            return src

        if self.monitor is None:
            while running_flag():
                select.select([wakeup_fd], [], [], self.rescan_interval)
                if not running_flag():
                    return None
                if on_poll_tick and on_poll_tick():
                    return None
                src = find_source_device(name_match)
                if src is not None:
                    return src
            return None

        log.info("No controller found; waiting for one to be plugged in...")
        monitor_fd = self.monitor.fileno()
        while running_flag():
            r, _, _ = select.select([monitor_fd, wakeup_fd], [], [], 1.0)
            if not running_flag():
                return None
            if on_poll_tick and on_poll_tick():
                return None
            if monitor_fd not in r:
                continue

            got_joystick_hint = False
            for device in iter(lambda: self.monitor.poll(timeout=0), None):
                if device.action == "add" and device.get("ID_INPUT_JOYSTICK") == "1":
                    got_joystick_hint = True

            if got_joystick_hint:
                time.sleep(0.2)
                if not running_flag():
                    return None
                src = find_source_device(name_match)
                if src is not None:
                    return src
        return None


def build_uinput(source):
    _, UInput, ecodes, _ = _import_evdev()
    caps = {}
    key_codes = source.capabilities().get(ecodes.EV_KEY, [])
    if key_codes:
        caps[ecodes.EV_KEY] = list(key_codes)

    abs_caps = []
    for code, info in source.capabilities(absinfo=True).get(ecodes.EV_ABS, []):
        if code in (ecodes.ABS_X, ecodes.ABS_Y, ecodes.ABS_RX, ecodes.ABS_RY):
            new_info = info._replace(min=-32768, max=32767, flat=0, fuzz=0)
            abs_caps.append((code, new_info))
        else:
            abs_caps.append((code, info))
    if abs_caps:
        caps[ecodes.EV_ABS] = abs_caps

    return UInput(
        caps,
        name=VIRTUAL_DEVICE_NAME,
        vendor=VIRTUAL_VENDOR,
        product=VIRTUAL_PRODUCT,
        version=VIRTUAL_VERSION,
    )


class ConfigWatcher:
    def __init__(self, override_path=None, start_paused=None):
        self.override_path = override_path
        self.cfg, self.path, found = load_config(override_path)
        self.mtime_ns = self._current_mtime_ns()
        if start_paused is not None:
            self.cfg["paused"] = bool(start_paused)
        self.paused = bool(self.cfg.get("paused", False))
        if not found:
            log.info("No config file found; using built-in defaults")
        else:
            log.info("Loaded config from %s", self.path)
        self.profile_name, self.profile = active_profile(self.cfg)
        log.info(
            "Active profile: '%s'%s",
            self.profile_name,
            " [PAUSED — virtual device disabled]" if self.paused else "",
        )

    def _current_mtime_ns(self):
        path = self.path or find_config_path(self.override_path)
        if path and os.path.isfile(path):
            try:
                return os.stat(path).st_mtime_ns
            except OSError:
                return None
        return None

    def set_paused(self, paused: bool):
        if self.paused != paused:
            self.paused = paused
            self.cfg["paused"] = paused
            log.info(
                "Daemon %s",
                "PAUSED (physical controller released, virtual device closed)"
                if paused
                else "RESUMED (acquiring controller and virtual device)",
            )

    def maybe_reload(self, force=False):
        path = find_config_path(self.override_path)
        mtime_ns = None
        if path and os.path.isfile(path):
            try:
                mtime_ns = os.stat(path).st_mtime_ns
            except OSError:
                pass

        if not force and path == self.path and mtime_ns == self.mtime_ns:
            return False

        new_cfg, new_path, found = load_config(path)
        if not found and path is None:
            new_cfg = json.loads(json.dumps(DEFAULT_CONFIG))

        old_profile_name, old_profile = self.profile_name, self.profile
        old_paused = self.paused
        self.cfg, self.path, self.mtime_ns = new_cfg, new_path, mtime_ns
        self.profile_name, self.profile = active_profile(self.cfg)
        self.paused = bool(self.cfg.get("paused", False))

        if self.paused != old_paused:
            log.info(
                "Config reloaded: daemon %s",
                "PAUSED (virtual device disabled)" if self.paused else "RESUMED",
            )
        elif self.profile_name != old_profile_name or self.profile != old_profile:
            log.info(
                "Config reloaded: active profile is now '%s' %s",
                self.profile_name,
                "(settings changed)" if self.profile_name == old_profile_name else "(switched profile)",
            )

        return (
            self.paused != old_paused
            or self.profile_name != old_profile_name
            or self.profile != old_profile
        )


def float_to_s16(v: float) -> int:
    if v <= -1.0:
        return -32768
    if v >= 1.0:
        return 32767
    return int(round(v * 32767))


def run_session(watcher: ConfigWatcher, waiter: DeviceWaiter, running_flag, wakeup_fd: int, reload_flag):
    _, _, ecodes, _ = _import_evdev()
    stick_axes = {
        "left": (ecodes.ABS_X, ecodes.ABS_Y),
        "right": (ecodes.ABS_RX, ecodes.ABS_RY),
    }

    cfg = watcher.cfg

    while running_flag() and watcher.paused:
        select.select([wakeup_fd], [], [], cfg.get("reload_interval", 1.0))
        if not running_flag():
            return False
        forced = reload_flag()
        watcher.maybe_reload(force=forced)
        cfg = watcher.cfg

    if not running_flag():
        return False

    active_match = cfg["device_name_match"]

    def abort_wait_if_paused():
        forced = reload_flag()
        watcher.maybe_reload(force=forced)
        return watcher.paused

    src = waiter.wait_for_device(
        active_match, running_flag, wakeup_fd, on_poll_tick=abort_wait_if_paused
    )
    if src is None:
        return True

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
        try:
            src.ungrab()
        except Exception:
            pass
        src.close()
        return False

    log.info("Virtual device up: %s", uin.device.path)

    stick_raw = {"left": [0.0, 0.0], "right": [0.0, 0.0]}
    axis_to_stick_slot = {
        ecodes.ABS_X: ("left", 0),
        ecodes.ABS_Y: ("left", 1),
        ecodes.ABS_RX: ("right", 0),
        ecodes.ABS_RY: ("right", 1),
    }

    for code, (stick, slot) in axis_to_stick_slot.items():
        if code in axis_state:
            try:
                stick_raw[stick][slot] = axis_state[code].normalize(src.absinfo(code).value)
            except OSError:
                pass

    debug_count = 0
    last_config_check = 0.0
    warned_unknown_shapes = set()
    disconnected = False

    def shape_stick(stick, profile):
        scfg = profile[stick]
        shape = scfg.get("deadzone_shape", "radial")
        func = SHAPE_FUNCS.get(shape)
        if func is None:
            if shape not in warned_unknown_shapes:
                log.warning("Unknown deadzone_shape %r; falling back to 'radial'", shape)
                warned_unknown_shapes.add(shape)
            func = shape_axis_radial

        x, y = stick_raw[stick]
        nx, ny = func(
            x,
            y,
            deadzone=scfg.get("deadzone", 0.0),
            anti_deadzone=scfg.get("anti_deadzone", 0.0),
            curve=scfg.get("curve", 1.0),
            dominance_curve=scfg.get("sloped_dominance_curve", 1.0),
            axial_deadzone=scfg.get("axial_deadzone", None),
            outer_circle_clamp=bool(scfg.get("outer_circle_clamp", shape == "hybrid")),
        )
        return x, y, float_to_s16(nx), float_to_s16(ny)

    last_sent_time = {"left": 0.0, "right": 0.0}
    pending = {"left": None, "right": None}

    def min_interval(profile):
        hz = profile.get("max_output_hz", cfg.get("max_output_hz", 0))
        if isinstance(hz, bool) or not isinstance(hz, (int, float)):
            try:
                hz = float(hz)
            except (TypeError, ValueError):
                hz = 0
        return (1.0 / hz) if hz and hz > 0 else 0.0

    def write_stick(stick, out_x, out_y):
        ax_x, ax_y = stick_axes[stick]
        uin.write(ecodes.EV_ABS, ax_x, out_x)
        uin.write(ecodes.EV_ABS, ax_y, out_y)

    def emit_stick(stick, profile, now):
        x, y, out_x, out_y = shape_stick(stick, profile)
        interval = min_interval(profile)
        if interval <= 0.0 or (now - last_sent_time[stick]) >= interval:
            write_stick(stick, out_x, out_y)
            last_sent_time[stick] = now
            pending[stick] = None
            return x, y, out_x, out_y, True
        pending[stick] = (out_x, out_y)
        return x, y, out_x, out_y, False

    def flush_pending_sticks(profile, now):
        interval = min_interval(profile)
        if interval <= 0.0:
            return False
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
        interval = min_interval(profile)
        if interval <= 0.0:
            return 1.0
        now = time.monotonic()
        waits = [
            max(0.0, last_sent_time[s] + interval - now)
            for s in ("left", "right")
            if pending[s] is not None
        ]
        return min(waits) if waits else 1.0

    try:
        while running_flag():
            if watcher.paused:
                break

            now = time.monotonic()
            forced = reload_flag()
            if forced or (now - last_config_check >= cfg.get("reload_interval", 1.0)):
                last_config_check = now
                if watcher.maybe_reload(force=forced):
                    if watcher.paused:
                        break
                    wrote_reload = False
                    for stick in ("left", "right"):
                        _, _, _, _, wrote_now = emit_stick(stick, watcher.profile, now)
                        wrote_reload = wrote_reload or wrote_now
                    if wrote_reload:
                        uin.syn()
                cfg = watcher.cfg
                new_match = cfg["device_name_match"]
                if new_match != active_match:
                    active_match = new_match
                    if active_match and active_match.lower() not in src.name.lower():
                        log.info(
                            "device_name_match changed to %r; switching controller",
                            active_match,
                        )
                        break

            if flush_pending_sticks(watcher.profile, now):
                uin.syn()

            select_timeout = min(
                cfg.get("reload_interval", 1.0),
                next_flush_wait(watcher.profile),
            )
            r, _, _ = select.select([src.fd, wakeup_fd], [], [], select_timeout)
            if not running_flag() or watcher.paused:
                break
            if src.fd not in r:
                continue

            try:
                events = list(src.read())
            except (OSError, BlockingIOError):
                disconnected = True
                break

            ev_now = time.monotonic()
            dirty_sticks = set()
            wrote_any = False

            def flush_frame():
                nonlocal debug_count, wrote_any
                if not dirty_sticks:
                    return
                for stick in dirty_sticks:
                    x, y, out_x, out_y, wrote_now = emit_stick(
                        stick, watcher.profile, ev_now
                    )
                    wrote_any = wrote_any or wrote_now
                    if cfg.get("debug_sample_rate"):
                        debug_count += 1
                        if debug_count % cfg["debug_sample_rate"] == 0:
                            log.debug(
                                "[%s] %s stick raw=(%.3f,%.3f) out=(%d,%d)",
                                watcher.profile_name,
                                stick,
                                x,
                                y,
                                out_x,
                                out_y,
                            )
                dirty_sticks.clear()

            for ev in events:
                if ev.type == ecodes.EV_ABS and ev.code in axis_to_stick_slot:
                    stick, slot = axis_to_stick_slot[ev.code]
                    stick_raw[stick][slot] = axis_state[ev.code].normalize(ev.value)
                    dirty_sticks.add(stick)
                elif ev.type == ecodes.EV_SYN and ev.code == ecodes.SYN_REPORT:
                    flush_frame()
                    if wrote_any:
                        uin.syn()
                        wrote_any = False
                elif ev.type in (ecodes.EV_KEY, ecodes.EV_ABS):
                    uin.write(ev.type, ev.code, ev.value)
                    wrote_any = True

            flush_frame()
            if wrote_any:
                uin.syn()
    finally:
        try:
            src.ungrab()
        except Exception:
            pass
        try:
            src.close()
        except Exception:
            pass
        try:
            uin.close()
        except Exception:
            pass
        if disconnected and running_flag():
            log.warning("Source device disconnected; waiting for reconnect.")

    return True


def cmd_daemon(args):
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
        force=True,
    )

    existing_pid = get_running_daemon_pid()
    if existing_pid is not None:
        log.error("Another antideadzone daemon is already running (PID %d).", existing_pid)
        sys.exit(1)

    watcher = ConfigWatcher(override_path=args.config, start_paused=True if args.paused else None)
    waiter = DeviceWaiter(rescan_interval=watcher.cfg.get("rescan_interval", 1.0))

    wakeup_r, wakeup_w = socket.socketpair()
    wakeup_r.setblocking(False)
    wakeup_w.setblocking(False)
    signal.set_wakeup_fd(wakeup_w.fileno(), warn_on_full_buffer=False)

    running = True
    reload_requested = False

    def handle_term(signum, _frame):
        nonlocal running
        log.info("Received signal %s, shutting down cleanly", signum)
        running = False

    def handle_toggle_pause(_signum, _frame):
        watcher.set_paused(not watcher.paused)

    def handle_sighup(_signum, _frame):
        nonlocal reload_requested
        reload_requested = True

    def consume_reload_flag():
        nonlocal reload_requested
        try:
            while wakeup_r.recv(64):
                pass
        except BlockingIOError:
            pass
        if reload_requested:
            reload_requested = False
            return True
        return False

    signal.signal(signal.SIGTERM, handle_term)
    signal.signal(signal.SIGINT, handle_term)
    signal.signal(signal.SIGUSR1, handle_toggle_pause)
    signal.signal(signal.SIGHUP, handle_sighup)

    write_pid_file()

    p = watcher.profile
    effective_hz = p.get("max_output_hz", watcher.cfg.get("max_output_hz", 0))
    hz_source = "profile override" if "max_output_hz" in p else "config-wide"
    log.info(
        "antideadzone starting (paused=%s, profile='%s' left dz=%.4f adz=%.2f shape=%s, "
        "right dz=%.4f adz=%.2f shape=%s, max_output_hz=%s [%s])",
        watcher.paused,
        watcher.profile_name,
        p["left"]["deadzone"],
        p["left"]["anti_deadzone"],
        p["left"]["deadzone_shape"],
        p["right"]["deadzone"],
        p["right"]["anti_deadzone"],
        p["right"]["deadzone_shape"],
        effective_hz if effective_hz else "unlimited",
        hz_source,
    )

    try:
        while running:
            try:
                run_session(watcher, waiter, lambda: running, wakeup_r.fileno(), consume_reload_flag)
            except Exception as e:
                log.exception("Unexpected error in session: %s", e)
                if running:
                    select.select([wakeup_r.fileno()], [], [], 1.0)
    finally:
        remove_pid_file()
        signal.set_wakeup_fd(-1)
        wakeup_r.close()
        wakeup_w.close()

    log.info("Stopped.")


# ---------------------------------------------------------------------------
# CLI subcommands (status, list, pause, resume, toggle, switch, devices)
# ---------------------------------------------------------------------------

def _require_config(override_path=None):
    path = find_config_path(override_path)
    if path is None:
        print("No config file found. Expected one of:", file=sys.stderr)
        for p in CONFIG_PATHS:
            print(f"  {p}", file=sys.stderr)
        sys.exit(1)
    with open(path) as f:
        cfg = json.load(f)
    return path, cfg


def cmd_list(args):
    path, cfg = _require_config(args.config)
    profiles = cfg.get("profiles", {})
    current = cfg.get("active_profile", "default")
    paused = bool(cfg.get("paused", False))
    daemon_pid = get_running_daemon_pid()

    daemon_str = f"running (PID {daemon_pid})" if daemon_pid else "not running"
    state_str = "PAUSED (virtual device disabled)" if paused else "ACTIVE"

    print(f"Config:  {path}")
    print(f"Daemon:  {daemon_str}")
    print(f"State:   {state_str}")
    print(f"Profile: {current}\n")
    print("Available profiles:")
    for name in profiles:
        marker = " *" if name == current else "  "
        print(f"{marker} {name}")
    print("\nUsage: adz switch <profile> | pause | resume | toggle | status | list | devices | daemon")


def cmd_status(args):
    _, cfg = _require_config(args.config)
    current = cfg.get("active_profile", "default")
    paused = bool(cfg.get("paused", False))

    if args.active:
        print(current)
        return

    if args.short:
        print(f"paused:{current}" if paused else f"active:{current}")
        return

    daemon_pid = get_running_daemon_pid()
    daemon_note = f" [daemon PID {daemon_pid}]" if daemon_pid else " [daemon stopped]"
    if paused:
        print(f"paused ({current}){daemon_note}")
    else:
        print(f"active: {current}{daemon_note}")


def cmd_pause(args):
    path, cfg = _require_config(args.config)
    if bool(cfg.get("paused", False)):
        notify_daemon_reload()
        print("Already paused.")
        return
    cfg["paused"] = True
    save_config_atomic(path, cfg)
    signaled = notify_daemon_reload()
    suffix = "applied immediately." if signaled else "will apply when daemon runs."
    print(f"Paused anti-deadzone ({suffix})")


def cmd_resume(args):
    path, cfg = _require_config(args.config)
    current = cfg.get("active_profile", "default")
    if not bool(cfg.get("paused", False)):
        notify_daemon_reload()
        print(f"Already active (profile: '{current}').")
        return
    cfg["paused"] = False
    save_config_atomic(path, cfg)
    signaled = notify_daemon_reload()
    suffix = "applied immediately." if signaled else "will apply when daemon runs."
    print(f"Resumed anti-deadzone with profile '{current}' ({suffix})")


def cmd_toggle(args):
    path, cfg = _require_config(args.config)
    current = cfg.get("active_profile", "default")
    new_paused = not bool(cfg.get("paused", False))
    cfg["paused"] = new_paused
    save_config_atomic(path, cfg)
    signaled = notify_daemon_reload()
    suffix = "applied immediately." if signaled else "will apply when daemon runs."
    if new_paused:
        print(f"Paused anti-deadzone ({suffix})")
    else:
        print(f"Resumed anti-deadzone with profile '{current}' ({suffix})")


def cmd_switch(args):
    path, cfg = _require_config(args.config)
    profiles = cfg.get("profiles", {})
    current = cfg.get("active_profile", "default")
    paused = bool(cfg.get("paused", False))
    target = args.profile

    if target not in profiles:
        print(f"No such profile: '{target}'", file=sys.stderr)
        print("Available profiles:", ", ".join(profiles), file=sys.stderr)
        sys.exit(1)

    target_paused = paused if args.keep_paused else False
    if target == current and target_paused == paused:
        notify_daemon_reload()
        state_note = " (paused)" if target_paused else ""
        print(f"'{target}' is already active{state_note}.")
        return

    cfg["active_profile"] = target
    cfg["paused"] = target_paused
    save_config_atomic(path, cfg)
    signaled = notify_daemon_reload()
    state_note = "paused" if target_paused else "active"
    timing = "applied immediately" if signaled else "saved to config"
    print(f"Profile: '{current}' -> '{target}' [{state_note}, {timing}]")


def cmd_devices(_args):
    InputDevice, _, ecodes, list_devices = _import_evdev()
    print(f"{'PATH':<18} {'MATCH':<20} {'VID:PID':<11} NAME")
    print("-" * 78)
    for path in sorted(list_devices()):
        try:
            dev = InputDevice(path)
        except OSError:
            continue
        if is_our_virtual_device(dev):
            marker = "virtual (ignored)"
        elif is_gamepad_device(dev, ecodes):
            marker = "YES <-- gamepad"
        else:
            marker = "no"
        vid_pid = f"{dev.info.vendor:04x}:{dev.info.product:04x}"
        print(f"{path:<18} {marker:<20} {vid_pid:<11} {dev.name!r}")
        dev.close()

    print("\nUse a short, unique substring from the 'YES <-- gamepad' name(s)")
    print("as device_name_match in your config.")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="adz",
        description="System-wide Linux gamepad stick anti-deadzone & profile manager.",
    )
    parser.add_argument(
        "-c", "--config",
        metavar="PATH",
        help="Path to config.json (defaults to ~/.config/hestia/anti-deadzone/config.json)",
    )
    sub = parser.add_subparsers(dest="command")

    p_list = sub.add_parser("list", help="Show daemon state and list available profiles")
    p_list.set_defaults(func=cmd_list)

    p_status = sub.add_parser("status", help="Show current active/paused status")
    p_status.add_argument("-a", "--active", action="store_true", help="Print only the active profile name")
    p_status.add_argument("-s", "--short", action="store_true", help="Print compact state:profile string")
    p_status.set_defaults(func=cmd_status)

    p_pause = sub.add_parser("pause", help="Release controller grab and remove virtual device")
    p_pause.set_defaults(func=cmd_pause)

    p_resume = sub.add_parser("resume", help="Re-enable virtual device and active profile")
    p_resume.set_defaults(func=cmd_resume)

    p_toggle = sub.add_parser("toggle", help="Toggle between paused and active")
    p_toggle.set_defaults(func=cmd_toggle)

    p_switch = sub.add_parser("switch", help="Switch active profile (and resume unless --keep-paused)")
    p_switch.add_argument("profile", help="Profile name from config.json")
    p_switch.add_argument(
        "--keep-paused",
        action="store_true",
        help="Change active_profile without unpausing if currently paused",
    )
    p_switch.set_defaults(func=cmd_switch)

    p_devices = sub.add_parser("devices", help="List evdev input devices and gamepad matches")
    p_devices.set_defaults(func=cmd_devices)

    p_daemon = sub.add_parser("daemon", help="Run the background evdev -> uinput daemon")
    p_daemon.add_argument("--paused", action="store_true", help="Start daemon in paused state")
    p_daemon.add_argument("-v", "--verbose", action="store_true", help="Enable debug logging")
    p_daemon.set_defaults(func=cmd_daemon)

    return parser


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    if not hasattr(args, "func"):
        cmd_list(args)
        return
    args.func(args)


if __name__ == "__main__":
    main()