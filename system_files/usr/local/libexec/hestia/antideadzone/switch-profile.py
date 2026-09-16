#!/usr/bin/env python3
"""
switch-profile.py — flip hestia-antideadzone's active profile without
hand-editing JSON.

Usage:
    switch-profile.py                 # list available profiles, show active one
    switch-profile.py <profile-name>  # switch to it

The daemon polls the config file's mtime (default every 1s, see
"reload_interval") and picks up the change on its own -- no need to
restart or signal it.
"""

import json
import os
import sys

CONFIG_PATHS = [
    os.path.expanduser("~/.config/hestia-antideadzone/config.json"),
    "/etc/hestia-antideadzone/config.json",
]


def find_config():
    for path in CONFIG_PATHS:
        if os.path.isfile(path):
            return path
    return None


def main():
    path = find_config()
    if path is None:
        print("No config file found. Expected one of:", file=sys.stderr)
        for p in CONFIG_PATHS:
            print(f"  {p}", file=sys.stderr)
        print("\nCopy config.example.json to one of those paths first.", file=sys.stderr)
        sys.exit(1)

    with open(path) as f:
        cfg = json.load(f)

    profiles = cfg.get("profiles", {})
    current = cfg.get("active_profile", "default")

    if len(sys.argv) < 2:
        print(f"Config: {path}")
        print(f"Active profile: {current}\n")
        print("Available profiles:")
        for name in profiles:
            marker = " *" if name == current else "  "
            print(f"{marker} {name}")
        print("\nRun `switch-profile.py <name>` to switch.")
        return

    target = sys.argv[1]
    if target not in profiles:
        print(f"No such profile: '{target}'", file=sys.stderr)
        print("Available profiles:", ", ".join(profiles), file=sys.stderr)
        sys.exit(1)

    if target == current:
        print(f"'{target}' is already active.")
        return

    cfg["active_profile"] = target
    # Write atomically (write to a temp file, then rename) so the
    # daemon never sees a half-written JSON file mid-poll.
    tmp_path = path + ".tmp"
    with open(tmp_path, "w") as f:
        json.dump(cfg, f, indent=2)
    os.replace(tmp_path, path)

    print(f"Switched active profile: '{current}' -> '{target}'")
    print("(the daemon will pick this up within reload_interval seconds)")


if __name__ == "__main__":
    main()
