#!/usr/bin/env bash

chgrp windscribe /opt/windscribe/Windscribe
chmod g+s /opt/windscribe/Windscribe
echo 'u windscribe 350:350 "Windscribe VPN" - /usr/sbin/nologin' > /usr/lib/sysusers.d/windscribe.conf