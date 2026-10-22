// Registers claudeNotify.toast, which claude-notify-bridge calls from wherever
// Claude Code runs. As a UI extension this always runs on the local machine, so
// the notification shows up where you are. Its words reach the notifier through
// environment variables, never through a command line or script text.
//
// On Windows, clicking the toast (or its button) opens a vscode:// link made by
// asExternalUri, which carries this window's id, so VS Code routes it back here
// and focuses this window. The same id, plus the session's, tags the toast, so a
// session's newer toast replaces its older one in the notification center while
// two sessions in one window keep one each.
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { execFile } = require('child_process');
const text = require('./text');

// Windows caches an app id's icon the first time it sees it, so bump the suffix
// whenever icon.svg changes.
const OWN_APP_ID = 'andytw366.ClaudeNotify.3';
let root = '';

// Register OWN_APP_ID under HKCU (no admin needed) so the toast shows our display
// name and icon, then build the toast and show it. CLAUDE_NOTIFY_NAME is empty
// when the toast should use VS Code's own app id instead.
const WINDOWS_TOAST = `
$ErrorActionPreference = 'Stop'
$app = $env:CLAUDE_NOTIFY_APPID
if ($env:CLAUDE_NOTIFY_NAME) {
  $ids = 'HKCU:\\Software\\Classes\\AppUserModelId'
  # Drop the ids 0.2.0-0.3.1 used, so they don't linger in Windows' notification settings.
  foreach ($old in 'andytw366.ClaudeNotify', 'andytw366.ClaudeNotify.2') {
    Remove-Item -Path (Join-Path $ids $old) -Recurse -ErrorAction SilentlyContinue
  }
  $key = Join-Path $ids $app
  if (-not (Test-Path $key)) { [void](New-Item -Path $key -Force) }
  Set-ItemProperty -Path $key -Name DisplayName -Value $env:CLAUDE_NOTIFY_NAME
  if ($env:CLAUDE_NOTIFY_ICON -and (Test-Path -LiteralPath $env:CLAUDE_NOTIFY_ICON)) {
    Set-ItemProperty -Path $key -Name IconUri -Value $env:CLAUDE_NOTIFY_ICON
  }
}
[void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
[void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]
$x = New-Object Windows.Data.Xml.Dom.XmlDocument
$x.LoadXml('<toast><visual><binding template="ToastGeneric"><image placement="appLogoOverride"/><text/><text/><text placement="attribution"/></binding></visual></toast>')
$toastEl = $x.DocumentElement
if ($env:CLAUDE_NOTIFY_URI) {
  $toastEl.SetAttribute('activationType', 'protocol')
  $toastEl.SetAttribute('launch', $env:CLAUDE_NOTIFY_URI)
}
$img = $x.GetElementsByTagName('image').Item(0)
if ($env:CLAUDE_NOTIFY_LOGO) { $img.SetAttribute('src', $env:CLAUDE_NOTIFY_LOGO) } else { [void]$img.ParentNode.RemoveChild($img) }
$t = $x.GetElementsByTagName('text')
[void]$t.Item(0).AppendChild($x.CreateTextNode($env:CLAUDE_NOTIFY_TITLE))
[void]$t.Item(1).AppendChild($x.CreateTextNode($env:CLAUDE_NOTIFY_BODY))
[void]$t.Item(2).AppendChild($x.CreateTextNode($env:CLAUDE_NOTIFY_ATTRIBUTION))
if ($env:CLAUDE_NOTIFY_NEEDS) {
  # Windows ignores the reminder scenario on a toast without a button.
  if ($env:CLAUDE_NOTIFY_URI) {
    $toastEl.SetAttribute('scenario', 'reminder')
    $actions = $x.CreateElement('actions')
    $action = $x.CreateElement('action')
    $action.SetAttribute('content', $env:CLAUDE_NOTIFY_BUTTON)
    $action.SetAttribute('arguments', $env:CLAUDE_NOTIFY_URI)
    $action.SetAttribute('activationType', 'protocol')
    [void]$actions.AppendChild($action)
    [void]$toastEl.AppendChild($actions)
  }
  $audio = $x.CreateElement('audio')
  $audio.SetAttribute('src', 'ms-winsoundevent:Notification.Reminder')
  [void]$toastEl.AppendChild($audio)
}
$toast = [Windows.UI.Notifications.ToastNotification]::new($x)
if ($env:CLAUDE_NOTIFY_TAG) {
  $toast.Tag = $env:CLAUDE_NOTIFY_TAG
  $toast.Group = 'claude'
}
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show($toast)
`;

function run(file, args, env) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { env: { ...process.env, ...env }, windowsHide: true, timeout: 15000 }, (err, stdout, stderr) =>
      err ? reject(new Error(String(stderr).trim() || err.message)) : resolve(String(stdout).trim()),
    );
  });
}

function vscodeAppId() {
  try {
    const product = JSON.parse(fs.readFileSync(path.join(vscode.env.appRoot, 'product.json'), 'utf8'));
    return product.win32AppUserModelId || 'Microsoft.VisualStudioCode';
  } catch {
    return 'Microsoft.VisualStudioCode';
  }
}

const zh = () => vscode.env.language.toLowerCase().startsWith('zh');

function where() {
  const folder = (vscode.workspace.workspaceFolders || [])[0];
  return text.environment(vscode.env.remoteName, folder && folder.uri.authority);
}

async function windowsEnv(needs, session) {
  const name = vscode.workspace.getConfiguration('claudeNotify').get('windowsAppName') || '';
  let uri = '';
  try {
    const own = vscode.Uri.parse(`${vscode.env.uriScheme}://andytw366.claude-notify-toast/focus`);
    uri = (await vscode.env.asExternalUri(own)).toString(true);
  } catch {
    // No click-to-focus or tag, but the toast still shows.
  }
  const windowId = (/\bwindowId=(\d+)/.exec(uri) || [])[1] || '';
  // Windows caps a tag at 64 characters; plugin 0.2.0 and older send no session.
  const tag = windowId && [windowId, String(session || '').slice(0, 12)].filter(Boolean).join('.');
  const logo = path.join(root, needs ? 'status-needs-96.png' : 'status-done-96.png');
  return {
    CLAUDE_NOTIFY_APPID: name ? OWN_APP_ID : vscodeAppId(),
    CLAUDE_NOTIFY_NAME: name,
    CLAUDE_NOTIFY_ICON: path.join(root, 'icon-256.png'),
    CLAUDE_NOTIFY_LOGO: fs.existsSync(logo) ? pathToFileURL(logo).href : '',
    CLAUDE_NOTIFY_URI: uri,
    CLAUDE_NOTIFY_TAG: tag,
    CLAUDE_NOTIFY_NEEDS: needs ? '1' : '',
    CLAUDE_NOTIFY_BUTTON: zh() ? '切換到視窗' : 'Switch to window',
  };
}

async function notify(n) {
  const env = { CLAUDE_NOTIFY_TITLE: n.title, CLAUDE_NOTIFY_BODY: n.body, CLAUDE_NOTIFY_ATTRIBUTION: n.attribution };
  // Without the big status picture, macOS and Linux keep the state as an emoji.
  const marked = `${n.needs ? '\u{1F514}' : '✅'} ${n.title}`;
  switch (process.platform) {
    case 'win32':
      return run(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(WINDOWS_TOAST, 'utf16le').toString('base64')],
        { ...env, ...(await windowsEnv(n.needs, n.session)) },
      );
    case 'darwin':
      return run(
        'osascript',
        ['-e', 'display notification (system attribute "CLAUDE_NOTIFY_BODY") with title (system attribute "CLAUDE_NOTIFY_TITLE") subtitle (system attribute "CLAUDE_NOTIFY_ATTRIBUTION")'],
        { ...env, CLAUDE_NOTIFY_TITLE: marked },
      );
    default:
      return run('notify-send', ['--app-name=Claude Notify', `${marked} · ${n.attribution}`, n.body], env);
  }
}

const present = (event) => text.present(event, where(), zh());

async function toast(event) {
  if (!event || typeof event.title !== 'string') return;
  const when = vscode.workspace.getConfiguration('claudeNotify').get('when');
  if (when === 'unfocused' && vscode.window.state.focused) return;
  const n = present(event);
  try {
    await notify(n);
  } catch {
    vscode.window.showInformationMessage(`${n.title}: ${n.body}`);
  }
}

function test(event) {
  return notify(present(event)).catch((e) => vscode.window.showErrorMessage(`Claude Notify: ${e.message}`));
}

function activate(context) {
  root = context.extensionPath;
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeNotify.toast', toast),
    vscode.commands.registerCommand('claudeNotify.test', () =>
      test({ event: 'Stop', title: 'claude-notify', text: '好，我來看看。\n\nTest notification: click me to come back to this window', elapsed: 192 }),
    ),
    vscode.commands.registerCommand('claudeNotify.testNeeds', () =>
      test({ event: 'Notification', title: 'claude-notify', text: 'Claude needs your permission to use Bash' }),
    ),
    // VS Code focuses this window before handing over the link, so there's
    // nothing left to do here.
    vscode.window.registerUriHandler({ handleUri() {} }),
  );
}

module.exports = { activate, deactivate() {} };
