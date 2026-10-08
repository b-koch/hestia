#!/usr/bin/env bash

chgrp windscribe /opt/windscribe/Windscribe
chmod g+s /opt/windscribe/Windscribe
echo 'g windscribe 960' > /usr/lib/sysusers.d/windscribe.conf