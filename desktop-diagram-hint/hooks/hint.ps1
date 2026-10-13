# PowerShell twin of hint.sh, for Windows without Git Bash.
if ($env:CLAUDE_CODE_ENTRYPOINT -ne 'claude-desktop') { exit 0 }
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Get-Content -Raw -Encoding UTF8 (Join-Path $PSScriptRoot 'hint.txt')
