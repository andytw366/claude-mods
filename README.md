# claude-mods

andytw366's Claude Code mods.

| Plugin | What it does |
| --- | --- |
| [desktop-diagram-hint](desktop-diagram-hint) | In Claude desktop's Code tab, tells Claude to draw diagrams with the built-in visualize widget instead of mermaid blocks |
| [vscode-notify](vscode-notify) | Desktop notifications where you're sitting when Claude finishes or needs you, even from WSL, dev containers or Remote-SSH |

```bash
claude plugin marketplace add andytw366/claude-mods
```

`prismantis-cjk` used to live here. It fixed CJK label widths in prismantis mermaid diagrams, and upstream [prismantis](https://github.com/NahumLitvin/prismantis) has had the same fix since 0.13.0, so use upstream instead.
