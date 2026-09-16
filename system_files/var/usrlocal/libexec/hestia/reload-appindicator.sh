```bash
#!/usr/bin/env bash

set -euo pipefail

EXTENSION="appindicatorsupport@rgcjonas.gmail.com"

echo "Disabling AppIndicator extension..."
gnome-extensions disable "$EXTENSION"

sleep 2

echo "Re-enabling AppIndicator extension..."
gnome-extensions enable "$EXTENSION"

echo "AppIndicator extension reloaded."
```
