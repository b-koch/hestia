#!/usr/bin/env bash

# Get the directory where this script is located
BASE_DIR=$(dirname "$(readlink -f "$0")")

# Ensure only one instance is running
pkill -f razer_battery_tray.py

# Move to the src directory so Python finds its modules
cd "$BASE_DIR/src"

# Launch the app
nohup python3 ./razer_battery_tray.py &

sleep 2
/usr/bin/reload-appindicator.sh