# desktop-diagram-hint

[prismantis](https://github.com/NahumLitvin/prismantis) draws mermaid blocks in the terminal, but not in Claude desktop's Code tab, where they show as raw source. This plugin adds a short note to every prompt sent from the desktop app, telling Claude to:

- draw diagrams with the desktop app's own visualize widget instead of mermaid, including when you ask for prismantis or mermaid by name;
- put commands in fenced code blocks so they get a copy (and Run) button.

The note is model-only; you don't see it. Terminal sessions (`CLAUDE_CODE_ENTRYPOINT` other than `claude-desktop`) get nothing, so prismantis works there as before. The note's text lives in `hooks/hint.txt`.

## Install

```bash
claude plugin marketplace add andytw366/claude-mods
```

```bash
claude plugin install desktop-diagram-hint@andytw366-mods
```

Install it on each machine where sessions actually run: a dev container the desktop app connects to reads the container's `~/.claude`, a local Windows session reads `%USERPROFILE%\.claude`.

## Windows without Git Bash

The plugin's hook runs `hooks/hint.sh`, which needs bash (Linux, macOS, WSL, or Windows with Git Bash). On Windows without Git Bash, skip the plugin and wire `hooks/hint.ps1` into `%USERPROFILE%\.claude\settings.json` yourself, keeping `hint.txt` next to it:

```json
"hooks": {
  "UserPromptSubmit": [
    { "hooks": [ { "type": "command", "command": "powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:/Users/<you>/.claude/hooks/hint.ps1" } ] }
  ]
}
```

`hint.ps1` has not been tested on a real Windows machine yet.
