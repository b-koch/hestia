#!/usr/bin/env bash

chgrp windscribe /opt/windscribe/Windscribe
chmod g+s /opt/windscribe/Windscribe
echo 'g windscribe 350' > /usr/lib/sysusers.d/windscribe.conf