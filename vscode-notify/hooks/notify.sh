#!/usr/bin/env bash
# UserPromptSubmit / Stop / Notification hook for vscode-notify.
# UserPromptSubmit only notes when the turn started, so Stop can report how long
# it took; it prints nothing, since anything it prints is added to the prompt.
# Stop and Notification drop a small JSON file in ~/.claude/vscode-notify. The
# claude-notify-bridge extension, running in the VS Code server on this same
# machine, picks it up and hands it to claude-notify-toast on your local machine,
# which turns the raw text into the notification's words.
# The desktop app shows its own notifications, so its sessions are skipped.
[ "$CLAUDE_CODE_ENTRYPOINT" = "claude-desktop" ] && exit 0
command -v jq >/dev/null || exit 0
dir="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/vscode-notify"
mkdir -p "$dir" || exit 0

input=$(cat)
event=$(jq -r '.hook_event_name // empty' <<<"$input" 2>/dev/null)
session=$(jq -r '.session_id // empty' <<<"$input" 2>/dev/null | tr -cd 'A-Za-z0-9_-')
start="$dir/.start-${session:-unknown}"
now=$(date +%s)

if [ "$event" = "UserPromptSubmit" ]; then
  echo "$now" >"$start"
  find "$dir" -name '.start-*' -mmin +1440 -delete 2>/dev/null
  exit 0
fi

find "$dir" -name '*.json' -mmin +2 -delete 2>/dev/null
elapsed=null
if [ "$event" = "Stop" ] && [ -f "$start" ]; then
  began=$(cat "$start")
  [[ $began =~ ^[0-9]+$ ]] && elapsed=$((now - began))
  rm -f "$start"
fi

name="$(date +%s%N)-$$.json"
jq -c --argjson elapsed "$elapsed" '{
  event: .hook_event_name,
  cwd: .cwd,
  title: (.cwd | split("/") | map(select(. != "")) | last // "Claude Code"),
  text: ((if .hook_event_name == "Stop" then .last_assistant_message else .message end) // "" | .[:4000]),
  elapsed: $elapsed
}' <<<"$input" >"$dir/.$name" 2>/dev/null && mv "$dir/.$name" "$dir/$name"
rm -f "$dir/.$name"
exit 0
