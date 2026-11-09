#!/usr/bin/env bash
# UserPromptSubmit / Stop / Notification hook for vscode-notify.
# Copies the hook's JSON, untouched, into ~/.claude/vscode-notify, wrapped with
# the id of the VS Code window whose terminal runs this session (the bridge puts
# it in CLAUDE_NOTIFY_WINDOW). The claude-notify-bridge extension in that VS Code
# server reads it, picks out what the notification needs and hands it to
# claude-notify-toast on your local machine.
# Outside VS Code's terminal, it also hands the same JSON to the terminal itself
# as a WezTerm user variable (claude_notify), which wezterm/notify.lua turns into
# the same notification. Other terminals ignore it; CLAUDE_NOTIFY_TERMINAL=0
# turns it off.
# Only bash and coreutils, no jq, so it also runs in Git Bash on Windows. It
# prints nothing, since on UserPromptSubmit anything printed joins the prompt.
# The desktop app shows its own notifications, so its sessions are skipped.
[ "$CLAUDE_CODE_ENTRYPOINT" = "claude-desktop" ] && exit 0
dir="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/vscode-notify"
mkdir -p "$dir" || exit 0
# .start-* files are left over from plugin 0.2.x.
# .seq-* are left by console-write.ps1 when it could not run (Windows only).
find "$dir" -maxdepth 1 \( -name '*.json' -mmin +2 -o -name '.start-*' -o -name '.seq-*' -mmin +2 \) -delete 2>/dev/null

window=$(printf %s "$CLAUDE_NOTIFY_WINDOW" | tr -cd 'A-Za-z0-9-')
name="$(date +%s)-$$-$RANDOM.json"
{ printf '{"window":"%s","hook":' "$window"; cat; printf '}'; } >"$dir/.$name" && mv "$dir/.$name" "$dir/$name"
rm -f "$dir/.$name"

# The terminal: OSC 1337 SetUserVar, base64 as the protocol wants. Written to
# the session's terminal in one go; a session with no terminal (claude -p in a
# pipe) skips it. Inside tmux it goes through tmux's passthrough (needs
# allow-passthrough on).
# Claude Code starts hooks in a new session with no controlling terminal, so
# /dev/tty fails there (ENXIO). Then the terminal is found by walking up the
# parent processes to the first one that has one, i.e. claude itself.
find_tty() {
  if { : >/dev/tty; } 2>/dev/null; then echo /dev/tty; return; fi
  p=$PPID
  while [ -n "$p" ] && [ "$p" -gt 1 ] 2>/dev/null; do
    t=$(ps -o tty= -p "$p" 2>/dev/null | tr -d ' ')
    case "$t" in
      ''|*'?'*) ;;
      *) [ -w "/dev/$t" ] && { echo "/dev/$t"; return; } ;;
    esac
    p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')
  done
}
if [ -z "$window" ] && [ "$TERM_PROGRAM" != "vscode" ] && [ "${CLAUDE_NOTIFY_TERMINAL:-1}" != "0" ] && [ -f "$dir/$name" ]; then
  value=$(base64 <"$dir/$name" | tr -d '\n')
  if [ -n "$TMUX" ]; then
    seq=$(printf '\033Ptmux;\033\033]1337;SetUserVar=claude_notify=%s\007\033\\' "$value")
  else
    seq=$(printf '\033]1337;SetUserVar=claude_notify=%s\007' "$value")
  fi
  tty_dev=$(find_tty)
  if [ -n "$tty_dev" ]; then
    { printf %s "$seq" >"$tty_dev"; } 2>/dev/null
  elif [ -n "$CLAUDE_PID" ] && command -v powershell.exe >/dev/null 2>&1 && command -v cygpath >/dev/null 2>&1; then
    # Windows (Git Bash): there is no tty, and Git Bash's ps has no -o, so
    # find_tty finds nothing. Claude Code's console is a ConPTY the terminal
    # reads, so console-write.ps1 attaches to it (CLAUDE_PID) and writes there.
    # PowerShell takes about half a second to start, so it runs in the
    # background and the hook returns at once.
    seqfile="$dir/.seq-$name"
    printf %s "$seq" >"$seqfile" &&
      (powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass \
        -File "$(cygpath -w "$(dirname "$0")/console-write.ps1")" \
        -ProcessId "$CLAUDE_PID" -Path "$(cygpath -w "$seqfile")" </dev/null >/dev/null 2>&1 &)
  fi
fi
exit 0
