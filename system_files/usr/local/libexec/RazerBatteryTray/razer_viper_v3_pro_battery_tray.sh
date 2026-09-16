#!/usr/bin/env bash

if ! grep -q "plugdev" /etc/group; then
            sudo bash -c 'grep "plugdev" /lib/group >> /etc/group'
        fi
        sudo usermod -a -G plugdev "$USER"

# Get the directory where this script is located
BASE_DIR=$(dirname "$(readlink -f "$0")")

# Just wait 5 seconds for the system/daemon to settle
sleep 0.5

# Ensure only one instance is running
pkill -f razer_battery_tray.py

# Move to the src directory so Python finds its modules
cd "$BASE_DIR/src"

# Launch the app
nohup python3 ./razer_battery_tray.py "Razer Viper V3 Pro" &

sleep 2
/usr/local/bin/hestia-reload-appindicator.sh