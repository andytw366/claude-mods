// Registers claudeNotify.toast, which claude-notify-bridge calls from wherever
// Claude Code runs. As a UI extension this always runs on the local machine, so
// the notification shows up where you are. Title and body reach the notifier
// through environment variables, never through a command line or script text.
//
// On Windows, clicking the toast opens a vscode:// link made by asExternalUri,
// which carries this window's id, so VS Code routes it back here and focuses
// this window.
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

// Windows caches an app id's icon the first time it sees it, so bump the suffix
// whenever icon.png changes.
const OWN_APP_ID = 'andytw366.ClaudeNotify.2';
let iconPath = '';

// Register OWN_APP_ID under HKCU (no admin needed) so the toast shows our display
// name and icon, then show it. CLAUDE_NOTIFY_NAME is empty when the toast should use
// VS Code's own app id instead.
const WINDOWS_TOAST = `
$ErrorActionPreference = 'Stop'
$app = $env:CLAUDE_NOTIFY_APPID
if ($env:CLAUDE_NOTIFY_NAME) {
  $root = 'HKCU:\\Software\\Classes\\AppUserModelId'
  # Drop the id 0.2.0-0.2.3 used, so it doesn't linger in Windows' notification settings.
  Remove-Item -Path (Join-Path $root 'andytw366.ClaudeNotify') -Recurse -ErrorAction SilentlyContinue
  $key = Join-Path $root $app
  if (-not (Test-Path $key)) { [void](New-Item -Path $key -Force) }
  Set-ItemProperty -Path $key -Name DisplayName -Value $env:CLAUDE_NOTIFY_NAME
  if ($env:CLAUDE_NOTIFY_ICON -and (Test-Path -LiteralPath $env:CLAUDE_NOTIFY_ICON)) {
    Set-ItemProperty -Path $key -Name IconUri -Value $env:CLAUDE_NOTIFY_ICON
  }
}
[void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
[void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]
$x = New-Object Windows.Data.Xml.Dom.XmlDocument
$x.LoadXml('<toast><visual><binding template="ToastGeneric"><text/><text/></binding></visual></toast>')
if ($env:CLAUDE_NOTIFY_URI) {
  $x.DocumentElement.SetAttribute('activationType', 'protocol')
  $x.DocumentElement.SetAttribute('launch', $env:CLAUDE_NOTIFY_URI)
}
$t = $x.GetElementsByTagName('text')
[void]$t.Item(0).AppendChild($x.CreateTextNode($env:CLAUDE_NOTIFY_TITLE))
[void]$t.Item(1).AppendChild($x.CreateTextNode($env:CLAUDE_NOTIFY_BODY))
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show([Windows.UI.Notifications.ToastNotification]::new($x))
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

async function windowsEnv() {
  const name = vscode.workspace.getConfiguration('claudeNotify').get('windowsAppName') || '';
  let uri = '';
  try {
    const own = vscode.Uri.parse(`${vscode.env.uriScheme}://andytw366.claude-notify-toast/focus`);
    uri = (await vscode.env.asExternalUri(own)).toString(true);
  } catch {
    // No click-to-focus, but the toast still shows.
  }
  return {
    CLAUDE_NOTIFY_APPID: name ? OWN_APP_ID : vscodeAppId(),
    CLAUDE_NOTIFY_NAME: name,
    CLAUDE_NOTIFY_ICON: iconPath,
    CLAUDE_NOTIFY_URI: uri,
  };
}

async function notify(title, body) {
  const env = { CLAUDE_NOTIFY_TITLE: title, CLAUDE_NOTIFY_BODY: body };
  switch (process.platform) {
    case 'win32':
      return run(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(WINDOWS_TOAST, 'utf16le').toString('base64')],
        { ...env, ...(await windowsEnv()) },
      );
    case 'darwin':
      return run(
        'osascript',
        ['-e', 'display notification (system attribute "CLAUDE_NOTIFY_BODY") with title (system attribute "CLAUDE_NOTIFY_TITLE")'],
        env,
      );
    default:
      return run('notify-send', ['--app-name=Claude Code', title, body], env);
  }
}

async function toast(event) {
  if (!event || typeof event.title !== 'string') return;
  const when = vscode.workspace.getConfiguration('claudeNotify').get('when');
  if (when === 'unfocused' && vscode.window.state.focused) return;
  const body = typeof event.body === 'string' ? event.body : '';
  try {
    await notify(event.title, body);
  } catch {
    vscode.window.showInformationMessage(`${event.title}: ${body}`);
  }
}

function activate(context) {
  iconPath = path.join(context.extensionPath, 'icon.png');
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeNotify.toast', toast),
    vscode.commands.registerCommand('claudeNotify.test', () =>
      notify('Claude Notify', 'Test notification: click me to come back to this window').catch((e) =>
        vscode.window.showErrorMessage(`Claude Notify: ${e.message}`),
      ),
    ),
    // VS Code focuses this window before handing over the link, so there's
    // nothing left to do here.
    vscode.window.registerUriHandler({ handleUri() {} }),
  );
}

module.exports = { activate, deactivate() {} };
