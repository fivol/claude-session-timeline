#!/bin/sh
# Stop and remove the timeline LaunchAgent.
LABEL="com.claude-session-timeline"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
launchctl unload "$PLIST" 2>/dev/null || true
rm -f "$PLIST"
echo "removed $LABEL"
