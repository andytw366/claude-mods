# vscode-images

Shows the pictures Claude wants you to see. Claude reads plenty of pictures for itself (checking a chart it just drew, say); only the ones it means for you are shown.

- **In VS Code's terminal**, they open in a floating VS Code window, one tab each, while the keyboard stays in the terminal.
- **In any other terminal that draws pictures** (WezTerm, kitty, Ghostty, iTerm2 3.5+), they are drawn inline in Claude Code, under the `ShowImage` call. The picture travels inside the terminal stream, so it works the same with Claude Code running locally, on a remote host over SSH, or in WSL.

```mermaid
flowchart LR
  A[Claude calls ShowImage] --> V{VS Code terminal?}
  V -->|yes, JSON file| B[Claude Image Opener extension]
  B --> C[Floating window, a tab per picture]
  V -->|no, PNG bytes| D[Inline under the tool call]
```

| Part | Runs on | Does |
| --- | --- | --- |
| Claude Code plugin (`hooks/register.ts`) | where Claude runs | A mod that gives Claude a `ShowImage` tool. Each call drops one small JSON file per picture into `~/.claude/vscode-images`, tagged with the window whose terminal runs the session |
| Inline drawing (same plugin) | where Claude runs | Outside VS Code, draws each picture with Claude Code's terminal `Image` element. PNGs under 2 MiB go as they are; other formats and bigger pictures are scaled to 1600 px and turned into PNG with ImageMagick (`magick` or `convert`), `rsvg-convert` for SVG, or `ffmpeg` |
| `claude-image-opener` (workspace extension) | VS Code server, where Claude runs | Watches that folder and opens the pictures meant for its window in a floating window: the first picture makes the window, later ones join it as tabs. Then it hands the keyboard back to the terminal |

The extension does what the `code` command cannot: `code --reuse-window picture.png` opens a tab too, but always moves the keyboard to it.

## Install

1. Install the Claude Code plugin where Claude runs:

   ```bash
   claude plugin marketplace add andytw366/claude-mods
   claude plugin install vscode-images@andytw366-mods
   ```

   That is all WezTerm and other picture-capable terminals need.

2. For VS Code only: install the extension from `dist/` (or build it, below) into the VS Code that runs Claude Code's terminal. From that terminal:

   ```bash
   code --install-extension ~/.claude/plugins/marketplaces/andytw366-mods/vscode-images/dist/claude-image-opener-0.2.0.vsix
   ```

3. Open a new terminal, so it carries the window's id, and start Claude Code there.

Building the extension:

```bash
cd vscode-images/vscode/opener && npx @vscode/vsce package --no-dependencies -o ../../dist/
```

## Requirements

- Claude Code with mods
- VS Code: 1.86 or later (floating editor windows)
- Other terminals: one Claude Code can draw pictures in (WezTerm, kitty, Ghostty, iTerm2 3.5 or later). For formats other than PNG, ImageMagick, `rsvg-convert` or `ffmpeg` where Claude runs

## Limits

- **Inline pictures in WezTerm:** if a picture shows as a dim `[picture: ...]` line instead, Claude Code did not recognise the terminal as one that draws pictures. Inside tmux, turn on `allow-passthrough` and `focus-events`. Claude Code running natively on Windows depends on ConPTY passing the picture through; running it in WSL avoids that.
- **Inline pictures are kept for the session's run only.** After the mods reload or a resumed session, the row shows the picture's path instead.

- **The floating window takes the keyboard once.** When the first picture makes the window, the operating system focuses it, and VS Code has no command to bring the main window back to the front. Later pictures open in the existing window and leave the keyboard in the terminal. Keep the window open (move it to another screen, say) to avoid that.
- **Terminals opened before the extension started** have no window id. Pictures shown from them open only in windows whose workspace holds the picture, and Claude is told so.
- **Pictures VS Code previews:** PNG, JPEG, GIF, WebP, BMP, ICO and SVG.
