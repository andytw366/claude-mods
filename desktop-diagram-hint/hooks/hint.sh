#!/usr/bin/env bash
# UserPromptSubmit hook: in sessions the Claude desktop app draws (its Code
# tab, and cloud tasks opened in the app), add hint.txt to the model's
# context. Other entrypoints (the terminal CLI) get nothing, so prismantis
# keeps handling mermaid and figure blocks there.
case "$CLAUDE_CODE_ENTRYPOINT" in
  claude-desktop|remote_cowork) cat "$(dirname "$0")/hint.txt" ;;
esac
exit 0
