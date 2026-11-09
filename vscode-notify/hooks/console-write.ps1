# Windows half of notify.sh's terminal path. Claude Code on Windows has no tty
# for a hook to write to, but its console is a ConPTY whose output the terminal
# (WezTerm) reads. So: leave our own console, attach to Claude Code's (the
# process id notify.sh passes, from CLAUDE_PID), and write the escape sequence
# to its CONOUT$, the same as if Claude Code had printed it.
# Reads the bytes from -Path and deletes that file. Prints nothing.
param([uint32]$ProcessId, [string]$Path)
$ErrorActionPreference = 'Stop'
try {
  $bytes = [IO.File]::ReadAllBytes($Path)
  Add-Type -Namespace ClaudeNotify -Name Console -MemberDefinition @'
[DllImport("kernel32.dll")] public static extern bool FreeConsole();
[DllImport("kernel32.dll")] public static extern bool AttachConsole(uint pid);
[DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
public static extern IntPtr CreateFileW(string name, uint access, uint share, IntPtr sa, uint disposition, uint flags, IntPtr template);
[DllImport("kernel32.dll", SetLastError = true)]
public static extern bool WriteFile(IntPtr h, byte[] buf, uint count, out uint written, IntPtr overlapped);
[DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
'@
  [ClaudeNotify.Console]::FreeConsole() | Out-Null
  if (-not [ClaudeNotify.Console]::AttachConsole($ProcessId)) { exit 1 }
  # GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, OPEN_EXISTING
  $h = [ClaudeNotify.Console]::CreateFileW('CONOUT$', [uint32]3221225472, 3, [IntPtr]::Zero, 3, 0, [IntPtr]::Zero)
  if ($h -eq [IntPtr]::Zero -or $h -eq [IntPtr]::new(-1)) { exit 1 }
  $written = [uint32]0
  [ClaudeNotify.Console]::WriteFile($h, $bytes, [uint32]$bytes.Length, [ref]$written, [IntPtr]::Zero) | Out-Null
  [ClaudeNotify.Console]::CloseHandle($h) | Out-Null
  [ClaudeNotify.Console]::FreeConsole() | Out-Null
} catch {
  exit 1
} finally {
  Remove-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
}
