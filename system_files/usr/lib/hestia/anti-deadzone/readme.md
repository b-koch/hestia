# hestia-antideadzone (`adz`)

A lightweight, system-wide Linux daemon and CLI (`adz`) that removes forced in-game analog stick deadzones and shapes stick response curves at the kernel input level—without relying on Steam Input.

When active, the daemon reads your physical controller via `evdev`, applies per-stick deadzone, anti-deadzone, and response curve shaping, and re-emits a virtual Xbox 360-style gamepad (`Xbox Wireless Controller`) through `uinput`. Buttons, triggers, and D-pad events pass through unmodified.

When paused (`adz pause`), the daemon releases its exclusive grab on your physical controller and tears down the virtual device completely so games see your untouched native hardware.

## Features

* **Unified `adz` CLI + Background Daemon:** One executable handles background input shaping (`adz daemon`), profile switching (`adz switch <profile>`), pause/resume toggling (`adz pause`, `adz resume`, `adz toggle`), and controller inspection (`adz devices`).
* **True Bypass / Pause Mode:** `adz pause` ungrabs your physical pad and removes the virtual Xbox 360 device immediately, letting you keep the systemd user service running permanently while opting in only for games that need it.
* **Instant Updates + Hot-Reload:** CLI commands write atomically to `config.json` and signal the running daemon (`SIGHUP`) to apply changes immediately, while manual JSON edits are also picked up automatically within `reload_interval` seconds.
* **Event-Driven Hotplugging:** Uses `pyudev` / netlink to detect controller connections and disconnections without busy-polling.
* **Rich Deadzone & Anti-Deadzone Shapes:** Supports `radial`, `bowtie`, `axial`, `sloped_axial`, `hybrid`, and `_unscaled` variants with independent left and right stick settings.
* **Optional Polling Rate Cap (`max_output_hz`):** Coalesces high-polling-rate stick events (e.g., 500 Hz or 1000 Hz controllers) down to a target rate such as 250 Hz to prevent XInput buffer lag under Proton while sending buttons and triggers immediately.

## Requirements

* **OS:** Linux with `evdev` and `uinput` kernel modules loaded
* **Python:** Python 3.8+
* **Python Packages** *(required only for `adz daemon` and `adz devices`; profile/pause commands use only the Python standard library)*:
  * `evdev`
  * `pyudev`

Install dependencies via your distribution's package manager or `pip`:

```bash
# Arch Linux
sudo pacman -S python-evdev python-pyudev

# Debian / Ubuntu
sudo apt install python3-evdev python3-pyudev

# Fedora
sudo dnf install python3-evdev python3-pyudev

# Or via pip
pip install evdev pyudev
```

## Permissions Setup

To run the daemon as a regular user (without `root`), your user needs read/write access to `/dev/input/event*` and `/dev/uinput`.

1. **Add your user to the `input` group:**
   ```bash
   sudo usermod -aG input "$USER"
   ```

2. **Grant `input` group access to `/dev/uinput` via udev:**

   Create `/etc/udev/rules.d/99-uinput.rules`:
   ```udev
   KERNEL=="uinput", MODE="0660", GROUP="input", OPTIONS+="static_node=uinput"
   ```

3. **Reload udev rules and re-login** (or reboot) for group membership to take effect:
   ```bash
   sudo udevadm control --reload-rules
   sudo udevadm trigger
   ```

## Installation

1. **Install `anti-deadzone.py` into `~/.local/bin/` and create the `adz` symlink:**
   ```bash
   mkdir -p ~/.local/bin
   cp anti-deadzone.py ~/.local/bin/anti-deadzone.py
   chmod +x ~/.local/bin/anti-deadzone.py
   ln -sf ~/.local/bin/anti-deadzone.py ~/.local/bin/adz
   ```

2. **Install your configuration file:**

   `adz` checks `~/.config/hestia/anti-deadzone/config.json` first, falling back to `/etc/hestia/anti-deadzone/config.json`.
   ```bash
   mkdir -p ~/.config/hestia/anti-deadzone
   cp config.json ~/.config/hestia/anti-deadzone/config.json
   ```

3. **Check detected controllers (optional):**
   ```bash
   adz devices
   ```

   Example output:
   ```text
   PATH               MATCH                VID:PID     NAME
   ------------------------------------------------------------------------------
   /dev/input/event14 YES <-- gamepad      045e:0b12   'Microsoft Xbox Series S|X Controller'
   ```

   If multiple gamepads appear, set `"device_name_match"` in `config.json` to a unique substring from the desired controller's name.

## Running as a Systemd User Service

Running `adz daemon` as a systemd user service keeps it ready in the background across reboots and controller reconnects, while `adz pause` and `adz resume` control whether the virtual device is active.

1. **Create `~/.config/systemd/user/antideadzone.service`:**
   ```ini
   [Unit]
   Description=Hestia Stick Anti-Deadzone Daemon
   After=graphical-session.target

   [Service]
   Type=simple
   ExecStart=%h/.local/bin/adz daemon
   ExecReload=/bin/kill -HUP $MAINPID
   Restart=on-failure
   RestartSec=2

   [Install]
   WantedBy=default.target
   ```

2. **Enable and start the service:**
   ```bash
   systemctl --user daemon-reload
   systemctl --user enable --now antideadzone.service
   ```

3. **Check service logs anytime:**
   ```bash
   journalctl --user -u antideadzone.service -f
   ```

## CLI Usage

```bash
# Show daemon state, paused/active status, active profile, and profile list
adz
adz list

# Concise status output (useful for status bars or scripts)
adz status               # e.g. "active: rdr2 [daemon PID 1234]"
adz status --short       # e.g. "active:rdr2" or "paused:rdr2"
adz status --active      # e.g. "rdr2"

# Switch to a profile (automatically resumes if paused)
adz switch rdr2

# Switch profile without unpausing
adz switch rdr2 --keep-paused

# Disable the virtual device & release physical controller grab completely
adz pause

# Re-enable the virtual device & stick shaping
adz resume

# Flip between paused and active states
adz toggle

# Switch to built-in 0.0 passthrough while keeping the virtual device connected
adz switch off

# List connected evdev input devices
adz devices

# Run the daemon in the foreground (optionally starting paused or with verbose logs)
adz daemon
adz daemon --paused
adz daemon --verbose
```

### Per-Game Steam / Lutris Launch Options

If you leave the daemon paused by default (`adz pause`), you can activate a game's profile automatically on launch and pause again when the game exits:

* **Steam Launch Options:**
  ```bash
  adz switch rdr2 && %command%; adz pause
  ```
* **Lutris / Heroic Wrapper Script:**
  ```bash
  #!/usr/bin/env bash
  adz switch "$1"
  shift
  "$@"
  adz pause
  ```

> **Note on Double Input:** When active, `adz daemon` calls `grab()` (`EVIOCGRAB`) on the physical `evdev` device so games only see the virtual controller. Titles using SDL2/Steam/Proton that open `/dev/hidraw*` directly may still see the raw HID node unless Steam Input is disabled for that game.

## Configuration Reference

Configuration is stored in JSON. Any key starting with `_` (such as `_comment` or `_profile_help`) is ignored by `adz`.

### Global Options

| Key | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `paused` | `boolean` | `false` | When `true`, the daemon releases its grab on the physical controller and removes the virtual `uinput` device. Managed automatically by `adz pause` / `adz resume`. |
| `device_name_match` | `string` | `""` | Case-insensitive substring matched against the `evdev` device name. Empty matches the first physical gamepad found. |
| `active_profile` | `string` | `"default"` | Name of the active entry in `profiles`. `"off"` is always available as a built-in raw passthrough profile. |
| `profiles` | `object` | `{...}` | Dictionary of named profiles, each containing `"left"` and `"right"` stick objects (and an optional profile-level `"max_output_hz"`). |
| `max_output_hz` | `number` | `0` | Maximum stick output rate in Hz (`0` = unlimited). Can also be overridden inside an individual profile. |
| `reload_interval` | `number` | `1.0` | How often (in seconds) `config.json` is polled for manual edits. |
| `rescan_interval` | `number` | `1.0` | Fallback polling interval (in seconds) if `pyudev` netlink monitoring is unavailable. |
| `debug_sample_rate` | `integer` | `0` | Log every $N$-th shaped stick event at `DEBUG` level (`0` disables). |

### Per-Stick Options (`left` / `right`)

Each profile configures `"left"` and `"right"` sticks independently:

| Key | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `deadzone` | `float` | `0.05` / `0.01` | Inner center gate ($0.0$–$1.0$) to filter out physical stick rest drift and noise. |
| `anti_deadzone` | `float` | `0.25` | Minimum output magnitude ($0.0$–$1.0$) applied once the stick leaves the deadzone, countering a game's built-in deadzone. |
| `curve` | `float` | `1.0` | Power response curve exponent applied after rescaling. `$1.0$` is linear; `$> 1.0$` gives finer precision near center; `$< 1.0$` is faster near center. Ignored by `_unscaled` shapes. |
| `deadzone_shape` | `string` | `"radial"` | Deadzone and anti-deadzone geometry (see table below). |
| `axial_deadzone` | `float` | `null` | Optional cardinal/bowtie slope width ($0.0$–$0.95$). When omitted on `bowtie`, `sloped_axial`, or `hybrid` and `deadzone < 0.05`, it auto-derives from `anti_deadzone * 0.45` so low-deadzone Hall-effect sticks still get clean cardinal locking. |
| `sloped_dominance_curve` | `float` | `1.0` | Controls how smoothly `anti_deadzone` ramps onto the minor axis in `sloped_axial` and `hybrid` (`0.0` = full boost immediately outside the bowtie; `1.0` = smooth Hermite ramp; `> 1.0` = stronger cardinal bias). |
| `outer_circle_clamp` | `boolean` | `false` (`true` on `hybrid`) | Clamps diagonal output vector magnitude to $\le 1.0$ so diagonals do not exceed cardinal turn speeds. |

### Deadzone Shapes Explained

| Shape | Behavior & Best Use Case |
| :--- | :--- |
| **`radial`** | Circular center deadzone with vector-normalized anti-deadzone and rescaling. Preserves exact stick angles with zero diagonal distortion. Best general-purpose choice. |
| **`radial_unscaled`** | Circular deadzone that jumps straight to raw stick magnitude at the boundary instead of rescaling from $0$. Useful when a game already rescales its own deadzone. |
| **`bowtie`** | Locks pure horizontal/vertical movement inside an angular cone around the cardinal axes, then transitions continuously ($C^0$) into angle-preserving radial anti-deadzone outside the cone. Ideal for camera sticks where cardinal panning feels wobbly. |
| **`axial`** | Independent per-axis flat deadzone and anti-deadzone. Matches games with strict square/cross internal deadzones, though shallow diagonals near the boundary bend toward $45^\circ$. |
| **`axial_unscaled`** | Independent per-axis flat deadzone without rescaling from $0$. |
| **`sloped_axial`** | Wedge-shaped per-axis deadzone combined with a smooth Hermite dominance ramp on the minor axis. Defeats square in-game deadzones while avoiding sudden cardinal-to-diagonal snapping. |
| **`sloped_axial_unscaled`** | Unscaled variant of `sloped_axial`. |
| **`hybrid`** | Two-stage shaping: circular center deadzone + single radial response curve first, followed by bowtie per-axis shaping and outer-circle normalization. |

### Example `config.json`

```json
{
  "paused": false,
  "device_name_match": "",
  "active_profile": "my-game",
  "max_output_hz": 250,
  "profiles": {
    "my-game": {
      "left": {
        "deadzone_shape": "radial",
        "deadzone": 0.0025,
        "anti_deadzone": 0.20,
        "curve": 1.0
      },
      "right": {
        "deadzone_shape": "bowtie",
        "deadzone": 0.0025,
        "axial_deadzone": 0.14,
        "anti_deadzone": 0.25,
        "curve": 1.4
      }
    }
  }
}
```