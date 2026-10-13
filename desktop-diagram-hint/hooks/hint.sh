#!/usr/bin/env bash
# UserPromptSubmit hook: in Claude desktop's Code tab, add hint.txt to the
# model's context. Other entrypoints (the terminal CLI) get nothing, so
# prismantis keeps handling mermaid blocks there.
[ "$CLAUDE_CODE_ENTRYPOINT" = "claude-desktop" ] || exit 0
cat "$(dirname "$0")/hint.txt"
