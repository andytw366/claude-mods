# vscode-images

Pictures inside Claude Code when it runs in VS Code's integrated terminal. Each PNG Claude reads with the `Read` tool is drawn under that tool row, in the transcript.

VS Code's terminal (1.110 and later) can draw iTerm2 inline images, but Claude Code never sends it any: it asks the terminal its name, VS Code answers `xterm.js`, and Claude Code only draws pictures for kitty, Ghostty and iTerm2 3.5 or later. This plugin has two parts:

| Part | Does |
| --- | --- |
| `bin/claude-iterm` | A launcher that runs Claude Code in a pseudo-terminal and answers its terminal-name query (XTVERSION) as iTerm2 3.5, so Claude Code sends iTerm2 images. Every other byte passes through, except the placeholder cells Claude Code fills beneath a picture, which VS Code would draw as boxes; each becomes a space |
| The mod (`hooks/register.tsx`) | After each `Read` of a PNG, shrinks the picture with Pillow and draws it under the tool row with Claude Code's `Image` element |

## Requirements

- VS Code 1.110 or later, with `terminal.integrated.enableImages` on and `terminal.integrated.gpuAcceleration` left at `auto` (with it `off`, VS Code draws no pictures)
- Claude Code with mods, in fullscreen mode (`"tui": "fullscreen"` in `~/.claude/settings.json`)
- `python3` with Pillow where Claude runs. Without Pillow the picture is sent unshrunk, which is slower

## Use

Install the plugin, then start Claude Code through the launcher instead of directly:

```bash
claude plugin marketplace add andytw366/claude-mods
claude plugin install vscode-images@andytw366-mods
~/.claude/plugins/marketplaces/andytw366-mods/vscode-images/bin/claude-iterm claude
```

Anything after `claude-iterm` is the command it runs, so `claude-iterm claude --continue` works too. An alias saves typing:

```bash
alias claude-img='~/.claude/plugins/marketplaces/andytw366-mods/vscode-images/bin/claude-iterm claude'
```

## Limits

- **Sharpness is capped by the width.** VS Code resamples a picture to the cells it covers, 7 by 17 logical pixels each, before display scaling enlarges it. A picture 100 cells wide is therefore 700 pixels across whatever was sent, so the mod draws at most 100 cells wide and shrinks the picture to 700 pixels and 256 colours. Wider is sharper and slower; change `MAX_COLUMNS` in `hooks/register.tsx`.
- **Redrawing resends the picture.** Claude Code sends the whole picture again whenever it repaints that part of the screen, so a large picture makes the transcript stutter while a reply streams in. The shrinking above is what keeps that tolerable.
- **Height.** A picture is never taller than three quarters of the screen; a picture taller than the screen was not drawn at all in testing.
- **PNG only, up to 2 MB.**
- **The launcher must stay in front of Claude Code.** Started without it, Claude Code draws a dim `[picture: …]` line in the picture's place.

## Debugging the launcher

| Variable | Effect |
| --- | --- |
| `CLAUDE_ITERM_LOG=/tmp/claude-iterm.log` | Logs every terminal query and reply, each picture sent and any placeholder cells blanked |
| `CLAUDE_ITERM_NAME="iTerm2 3.5.0"` | The name given in answer to XTVERSION |
| `CLAUDE_ITERM_DROP_KITTY=1` | Drops Claude Code's kitty graphics query. Off by default: VS Code answers it with OK, and with the query dropped Claude Code sent no picture at all |
