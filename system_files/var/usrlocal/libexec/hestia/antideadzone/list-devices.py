#!/usr/bin/env python3
"""
list-devices.py — show all evdev input devices and flag which ones
look like gamepads, to help pick `device_name_match` for
hestia-antideadzone's config.

Run this with your controller plugged in.
"""

from evdev import InputDevice, list_devices, ecodes


def main():
    print(f"{'PATH':<20} {'HAS STICKS':<12} NAME")
    print("-" * 60)
    for path in list_devices():
        try:
            dev = InputDevice(path)
        except OSError:
            continue
        abs_codes = set(dev.capabilities().get(ecodes.EV_ABS, []))
        has_sticks = ecodes.ABS_X in abs_codes and ecodes.ABS_Y in abs_codes
        marker = "YES <-- likely it" if has_sticks else "no"
        print(f"{path:<20} {marker:<20} {dev.name!r}")
        dev.close()

    print("\nUse a short, unique substring from the 'likely it' name(s)")
    print("as device_name_match in your config.")


if __name__ == "__main__":
    main()