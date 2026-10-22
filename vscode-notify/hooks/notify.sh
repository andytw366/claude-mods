#!/usr/bin/env bash
# UserPromptSubmit / Stop / Notification hook for vscode-notify.
# Copies the hook's JSON, untouched, into ~/.claude/vscode-notify, wrapped with
# the id of the VS Code window whose terminal runs this session (the bridge puts
# it in CLAUDE_NOTIFY_WINDOW). The claude-notify-bridge extension in that VS Code
# server reads it, picks out what the notification needs and hands it to
# claude-notify-toast on your local machine.
# Only bash and coreutils, no jq, so it also runs in Git Bash on Windows. It
# prints nothing, since on UserPromptSubmit anything printed joins the prompt.
# The desktop app shows its own notifications, so its sessions are skipped.
[ "$CLAUDE_CODE_ENTRYPOINT" = "claude-desktop" ] && exit 0
dir="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/vscode-notify"
mkdir -p "$dir" || exit 0
# .start-* files are left over from plugin 0.2.x.
find "$dir" -maxdepth 1 \( -name '*.json' -mmin +2 -o -name '.start-*' \) -delete 2>/dev/null

window=$(printf %s "$CLAUDE_NOTIFY_WINDOW" | tr -cd 'A-Za-z0-9-')
name="$(date +%s)-$$-$RANDOM.json"
{ printf '{"window":"%s","hook":' "$window"; cat; printf '}'; } >"$dir/.$name" && mv "$dir/.$name" "$dir/$name"
rm -f "$dir/.$name"
exit 0
