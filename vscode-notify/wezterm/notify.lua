-- WezTerm side of vscode-notify: shows the same Windows notification as the
-- VS Code toast extension when Claude Code finishes or needs you, for sessions
-- running in WezTerm (locally on Linux, in WSL, or over SSH).
--
-- The plugin's hook writes each event to the terminal as a WezTerm user
-- variable named claude_notify; this module listens for it.
--
-- Use: put this file and the three PNGs from ../vscode/toast (icon-256.png,
-- status-done-96.png, status-needs-96.png) next to your wezterm config, then
--
--   require('notify').setup {}
--
-- Options: images (folder with the PNGs, default: the config folder),
-- only_when_away (default true: skip the tab you're looking at),
-- app_name (default 'Claude Notify'), chinese (default true: Chinese words).
local wezterm = require 'wezterm'
local M = {}

local NOTIFY_DIR, NOTIFY_APP_NAME, ONLY_WHEN_AWAY
local NOTIFY_APP_ID = 'andytw366.ClaudeNotify.WezTerm'

local function basename(path)
  return ((path or ''):gsub('.*[/\\]', ''):gsub('%.exe$', ''):lower())
end

-- The host in an ssh command line: the first argument that isn't an option or an option's value.
-- Also for trzsz ssh ... (trzsz wraps ssh for file transfer), where the word ssh is skipped.
local OPT_WITH_VALUE = 'bcDEeFIiJLlmOopQRSWw'
local function host_from_argv(argv)
  local skip = false
  for i = 2, #argv do
    local a = argv[i]
    if i == 2 and a == 'ssh' then
      -- trzsz ssh host
    elseif skip then
      skip = false
    elseif a:sub(1, 1) == '-' then
      if #a == 2 and OPT_WITH_VALUE:find(a:sub(2, 2), 1, true) then skip = true end
    else
      return (a:gsub('^.*@', ''))
    end
  end
end

local B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
local function base64(s)
  return ((s:gsub('.', function(c)
    local r, b = '', c:byte()
    for i = 8, 1, -1 do r = r .. (b % 2 ^ i - b % 2 ^ (i - 1) > 0 and '1' or '0') end
    return r
  end) .. '0000'):gsub('%d%d%d?%d?%d?%d?', function(x)
    if #x < 6 then return '' end
    local c = 0
    for i = 1, 6 do c = c + (x:sub(i, i) == '1' and 2 ^ (6 - i) or 0) end
    return B64:sub(c + 1, c + 1)
  end) .. ({ '', '==', '=' })[#s % 3 + 1])
end

-- ---- The notification's words, as in ../vscode/toast/text.js ----
local function uchars(s)
  local t = {}
  for _, c in utf8.codes(s) do t[#t + 1] = utf8.char(c) end
  return t
end

local function clip(s, max)
  max = max or 140
  local c = uchars(s)
  if #c <= max then return s end
  return table.concat(c, '', 1, max - 1) .. '…'
end

local function short_title(name)
  local c = uchars((name and name ~= '') and name or 'Claude Code')
  if #c <= 32 then return table.concat(c) end
  return table.concat(c, '', 1, 16) .. '…' .. table.concat(c, '', #c - 14, #c)
end

local function plain(line)
  local s = line
  s = s:gsub('!%b[]%b()', '')
  s = s:gsub('%[([^%]]*)%]%b()', '%1')
  repeat
    local before = s
    s = s:gsub('^%s*#+%s*', ''):gsub('^%s*>%s*', ''):gsub('^%s*[-*+]%s+', ''):gsub('^%s*%d+[.)]%s+', '')
  until s == before
  s = s:gsub('%*%*', ''):gsub('__', ''):gsub('`', '')
  s = s:gsub('%f[%w*]%*(%S[^*]-)%*', '%1')
  return (s:gsub('^%s+', ''):gsub('%s+$', ''))
end

local OPENERS = { '好的', '好', '我來', '讓我', 'ok', 'sure', 'let me' }
local function is_opener(s)
  local low = s:lower()
  for _, o in ipairs(OPENERS) do
    if low:sub(1, #o) == o then return #uchars(s) < 15 end
  end
  return false
end

local function summary(markdown)
  local lines, fenced = {}, false
  for raw in ((markdown or '') .. '\n'):gmatch('(.-)\r?\n') do
    if raw:match('^%s*```') or raw:match('^%s*~~~') then
      fenced = not fenced
    elseif not fenced then
      local s = plain(raw)
      if s ~= '' and not s:match('^[-|:=%s*_]+$') then lines[#lines + 1] = s end
    end
  end
  for _, s in ipairs(lines) do
    if not is_opener(s) then return clip(s) end
  end
  return clip(lines[1] or '')
end

local ZH = true

local function needs_text(message)
  local m = (message or ''):gsub('^%s+', ''):gsub('%s+$', '')
  if ZH then
    local tool = m:match('^Claude needs your permission to use (.+)$')
    if tool then return clip('需要你允許使用 ' .. tool) end
    if m == 'Claude is waiting for your input' then return '在等你回覆' end
  end
  return clip(m)
end

local function duration(seconds)
  if not seconds then return '' end
  local h, m, s = seconds // 3600, (seconds % 3600) // 60, seconds % 60
  if ZH then
    if h > 0 then return string.format('%d 小時 %d 分', h, m) end
    if m > 0 then return string.format('%d 分 %d 秒', m, s) end
    return string.format('%d 秒', s)
  end
  if h > 0 then return string.format('%dh %dm', h, m) end
  if m > 0 then return string.format('%dm %ds', m, s) end
  return string.format('%ds', s)
end

local function environment(pane)
  local ok, info = pcall(function() return pane:get_foreground_process_info() end)
  if not ok or not info then return '' end
  local proc = basename(info.executable or (info.argv and info.argv[1]))
  if proc == 'ssh' or proc == 'trzsz' then
    local host = info.argv and host_from_argv(info.argv)
    return host and ('SSH: ' .. host) or 'SSH'
  elseif proc == 'wsl' then
    return 'WSL'
  end
  return ''
end

-- ---- Show it with the same PowerShell toast the VS Code extension uses ----
-- Every value goes in base64, so the script itself stays plain ASCII.
-- Clicking the toast or its button opens claude-wezterm:pane/<id>. The script
-- registers that link type for the current user (no admin) and writes the
-- small script it runs, ACTIVATE_PS, so nothing needs setting up by hand.
local URI_SCHEME = 'claude-wezterm'
local TOAST_PS = [[
$ErrorActionPreference = 'Stop'
function D($s) { [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($s)) }
$app = D '%s'
$key = Join-Path 'HKCU:\Software\Classes\AppUserModelId' $app
if (-not (Test-Path $key)) { [void](New-Item -Path $key -Force) }
Set-ItemProperty -Path $key -Name DisplayName -Value (D '%s')
$icon = D '%s'
if (Test-Path -LiteralPath $icon) { Set-ItemProperty -Path $key -Name IconUri -Value $icon }
[void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
[void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]
$x = New-Object Windows.Data.Xml.Dom.XmlDocument
$x.LoadXml('<toast><visual><binding template="ToastGeneric"><image placement="appLogoOverride"/><text/><text/><text placement="attribution"/></binding></visual></toast>')
$toastEl = $x.DocumentElement
$img = $x.GetElementsByTagName('image').Item(0)
$logo = D '%s'
if (Test-Path -LiteralPath $logo) { $img.SetAttribute('src', ([Uri]$logo).AbsoluteUri) } else { [void]$img.ParentNode.RemoveChild($img) }
$t = $x.GetElementsByTagName('text')
[void]$t.Item(0).AppendChild($x.CreateTextNode((D '%s')))
[void]$t.Item(1).AppendChild($x.CreateTextNode((D '%s')))
[void]$t.Item(2).AppendChild($x.CreateTextNode((D '%s')))
if ('%s' -eq '1') {
  $audio = $x.CreateElement('audio')
  $audio.SetAttribute('src', 'ms-winsoundevent:Notification.Reminder')
  [void]$toastEl.AppendChild($audio)
}
$uri = D '%s'
if ($uri) {
  $dir = Join-Path $env:LOCALAPPDATA 'ClaudeNotify'
  [void](New-Item -ItemType Directory -Path $dir -Force)
  $handler = Join-Path $dir 'wezterm-activate.ps1'
  [IO.File]::WriteAllText($handler, (D '%s'))
  $scheme = D '%s'
  $cls = "HKCU:\Software\Classes\$scheme"
  $cmd = Join-Path $cls 'shell\open\command'
  if (-not (Test-Path $cmd)) { [void](New-Item -Path $cmd -Force) }
  Set-ItemProperty -Path $cls -Name '(default)' -Value "URL:$scheme"
  Set-ItemProperty -Path $cls -Name 'URL Protocol' -Value ''
  $ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  Set-ItemProperty -Path $cmd -Name '(default)' -Value ('"' + $ps + '" -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $handler + '" "%%1"')
  $toastEl.SetAttribute('activationType', 'protocol')
  $toastEl.SetAttribute('launch', $uri)
  $actions = $x.CreateElement('actions')
  $action = $x.CreateElement('action')
  $action.SetAttribute('content', (D '%s'))
  $action.SetAttribute('arguments', $uri)
  $action.SetAttribute('activationType', 'protocol')
  [void]$actions.AppendChild($action)
  [void]$toastEl.AppendChild($actions)
}
$toast = [Windows.UI.Notifications.ToastNotification]::new($x)
$tag = D '%s'
if ($tag) { $toast.Tag = $tag; $toast.Group = 'claude-wezterm' }
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show($toast)
]]

-- Run on a click, with the link as its argument. A program started from a
-- toast click may bring a window to the front; it hands that right on to
-- WezTerm, then asks WezTerm to show the pane (wezterm cli activate-pane
-- switches to its tab and focuses its window). If WezTerm still isn't in
-- front, it brings the WezTerm window forward itself.
local ACTIVATE_PS = [[
param([string]$Uri)
if ($Uri -notmatch 'pane/(\d+)') { exit 1 }
$pane = $Matches[1]
Add-Type -Namespace ClaudeNotify -Name Win -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(int pid);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
'@
[void][ClaudeNotify.Win]::AllowSetForegroundWindow(-1)
& '@WEZTERM@' cli activate-pane --pane-id $pane
Start-Sleep -Milliseconds 300
$gui = @(Get-Process wezterm-gui -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })
[uint32]$fg = 0
[void][ClaudeNotify.Win]::GetWindowThreadProcessId([ClaudeNotify.Win]::GetForegroundWindow(), [ref]$fg)
if ($gui.Count -ge 1 -and -not ($gui.Id -contains $fg)) {
  $h = $gui[0].MainWindowHandle
  if ([ClaudeNotify.Win]::IsIconic($h)) { [void][ClaudeNotify.Win]::ShowWindow($h, 9) }
  [void][ClaudeNotify.Win]::SetForegroundWindow($h)
}
]]

local function activate_script()
  local exe = wezterm.executable_dir .. '\\wezterm.exe'
  return (ACTIVATE_PS:gsub('@WEZTERM@', function() return exe:gsub("'", "''") end))
end

local function show_toast(n)
  local win_path = function(p) return (p:gsub('/', '\\')) end
  local logo = NOTIFY_DIR .. (n.needs and '/status-needs-96.png' or '/status-done-96.png')
  local script = string.format(TOAST_PS,
    base64(NOTIFY_APP_ID), base64(NOTIFY_APP_NAME), base64(win_path(NOTIFY_DIR .. '/icon-256.png')),
    base64(win_path(logo)), base64(n.title), base64(n.body), base64(n.attribution),
    n.needs and '1' or '0', base64(n.tag),
    base64(n.uri or ''), base64(activate_script()), base64(URI_SCHEME),
    base64(ZH and '切換到視窗' or 'Switch to window'))
  -- -EncodedCommand wants UTF-16LE; the script is ASCII, so that is each byte followed by a zero.
  local utf16 = script:gsub('.', '%0\0')
  wezterm.background_child_process {
    'powershell.exe', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', base64(utf16),
  }
end

-- ---- Events from the hook ----
local turn_started = {}    -- when each session's current turn started, for the time on Stop
local notified = {}        -- when each pane last got a Claude notification

local function watching(window, pane)
  local active = window:active_pane()
  return window:is_focused() and active ~= nil and active:pane_id() == pane:pane_id()
end

local function on_event(window, pane, value)
  local ok, file = pcall(wezterm.json_parse, value)
  if not ok or type(file) ~= 'table' or type(file.hook) ~= 'table' then return end
  local hook = file.hook
  local event = hook.hook_event_name
  local session = tostring(hook.session_id or ''):gsub('[^%w-]', '')

  if event == 'UserPromptSubmit' then
    turn_started[session] = os.time()
    return
  end
  if event ~= 'Stop' and event ~= 'Notification' then return end

  local elapsed
  if event == 'Stop' and turn_started[session] then
    elapsed = os.time() - turn_started[session]
    turn_started[session] = nil
  end
  notified[pane:pane_id()] = os.time()
  if ONLY_WHEN_AWAY and watching(window, pane) then return end

  local needs = event == 'Notification'
  local done, waiting = ZH and '完成' or 'Done', ZH and '等你確認' or 'Needs you'
  local folder = tostring(hook.cwd or ''):match('([^/\\]+)[/\\]*$')
  local body = needs and needs_text(hook.message) or summary(hook.last_assistant_message)
  local info = needs and waiting or duration(elapsed)
  local where = environment(pane)
  local attribution = (where ~= '' and info ~= '') and (where .. ' · ' .. info) or (where .. info)

  show_toast {
    needs = needs,
    title = short_title(folder),
    body = body ~= '' and body or (needs and waiting or done),
    attribution = attribution ~= '' and attribution or done,
    tag = session:sub(1, 12),
    uri = URI_SCHEME .. ':pane/' .. pane:pane_id(),
  }
end

function M.setup(opts)
  opts = opts or {}
  NOTIFY_DIR = opts.images or wezterm.config_dir
  NOTIFY_APP_NAME = opts.app_name or 'Claude Notify'
  ONLY_WHEN_AWAY = opts.only_when_away ~= false
  ZH = opts.chinese ~= false
  wezterm.on('user-var-changed', function(window, pane, name, value)
    if name == 'claude_notify' then on_event(window, pane, value) end
  end)
end

-- For other handlers, such as a bell notification, to skip a pane Claude just notified for.
function M.recently_notified(pane_id, seconds)
  local t = notified[pane_id]
  return t ~= nil and os.time() - t < (seconds or 5)
end

return M
