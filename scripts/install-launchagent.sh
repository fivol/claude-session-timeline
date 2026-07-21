#!/bin/sh
# Install the timeline server as a macOS LaunchAgent (starts at login, restarts if it dies).
set -e

LABEL="com.claude-session-timeline"
DIR="$(cd "$(dirname "$0")/.." && pwd)"   # project root (this script lives in scripts/)
PORT="${PORT:-4177}"

NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then
  echo "error: 'node' not found in PATH. Activate your Node (e.g. nvm) and retry." >&2
  exit 1
fi

PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
mkdir -p "$HOME/Library/LaunchAgents"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$DIR/server.mjs</string>
  </array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PORT</key><string>$PORT</string>
    <key>PATH</key><string>$(dirname "$NODE"):/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$DIR/server.log</string>
  <key>StandardErrorPath</key><string>$DIR/server.log</string>
</dict>
</plist>
EOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

echo "installed & loaded: $LABEL"
echo "  node:  $NODE"
echo "  url:   http://localhost:$PORT"
echo "  logs:  $DIR/server.log"
