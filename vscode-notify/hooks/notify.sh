#!/usr/bin/env bash
# Stop / Notification hook: drop a small JSON file in ~/.claude/vscode-notify.
# The claude-notify-bridge extension, running in the VS Code server on this same
# machine, picks it up and hands it to claude-notify-toast on your local machine.
# The desktop app shows its own notifications, so its sessions are skipped.
[ "$CLAUDE_CODE_ENTRYPOINT" = "claude-desktop" ] && exit 0
command -v jq >/dev/null || exit 0
dir="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/vscode-notify"
mkdir -p "$dir" || exit 0
find "$dir" -name '*.json' -mmin +2 -delete 2>/dev/null

name="$(date +%s%N)-$$.json"
jq -c '{
  event: .hook_event_name,
  cwd: .cwd,
  title: (.cwd | split("/") | map(select(. != "")) | last // "Claude Code"),
  body: (if .hook_event_name == "Stop"
         then "Done: " + ((.last_assistant_message // "") | split("\n") | map(select(test("\\S"))) | first // "finished" | sub("^[#>*\\s-]+"; "") | gsub("[*`]"; ""))
         else "Needs you: " + (.message // "waiting for input") end
         | if length > 140 then .[:139] + "…" else . end)
}' >"$dir/.$name" 2>/dev/null && mv "$dir/.$name" "$dir/$name"
rm -f "$dir/.$name"
exit 0
