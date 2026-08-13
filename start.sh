#!/bin/bash
# ARIA start wrapper — sets a sane Node heap limit for small free tiers and
# launches the bot. Use THIS as the "start command" on PaaS panels that don't
# read the Procfile (Monkey, Quaxly, Clustr, Bot-Hosting console).
#
# Start command to set on the host panel:
#   bash start.sh
# or
#   ./start.sh

# Cap Node's heap so it fails gracefully instead of OOM-killing the whole box
# on tight 256–512MB free tiers. 256 = ~256MB heap; tune up if you have more RAM.
if [ -z "$NODE_OPTIONS" ]; then
  export NODE_OPTIONS="--max-old-space-size=256"
fi

echo "🚀 Starting ARIA (heap cap: $NODE_OPTIONS)"
exec node src/index.js
