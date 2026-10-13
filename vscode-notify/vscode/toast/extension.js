// Registers claudeNotify.toast, which claude-notify-bridge calls from wherever
// Claude Code runs. As a UI extension this always runs on the local machine, so
// the notification shows up where you are. Title and body reach the notifier
// through environment variables, never through a command line or script text.
const vscode = require('vscode');
const { execFile } = require('child_process');

const WINDOWS_TOAST = `
$ErrorActionPreference = 'Stop'
[void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
[void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]
$x = New-Object Windows.Data.Xml.Dom.XmlDocument
$x.LoadXml('<toast><visual><binding template="ToastGeneric"><text/><text/></binding></visual></toast>')
$t = $x.GetElementsByTagName('text')
[void]$t.Item(0).AppendChild($x.CreateTextNode($env:CLAUDE_NOTIFY_TITLE))
[void]$t.Item(1).AppendChild($x.CreateTextNode($env:CLAUDE_NOTIFY_BODY))
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($env:CLAUDE_NOTIFY_APPID).Show([Windows.UI.Notifications.ToastNotification]::new($x))
`;

function run(file, args, env) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { env: { ...process.env, ...env }, windowsHide: true, timeout: 15000 }, (err) =>
      err ? reject(err) : resolve(),
    );
  });
}

function notify(title, body) {
  const cfg = vscode.workspace.getConfiguration('claudeNotify');
  const env = { CLAUDE_NOTIFY_TITLE: title, CLAUDE_NOTIFY_BODY: body };
  switch (process.platform) {
    case 'win32':
      return run(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(WINDOWS_TOAST, 'utf16le').toString('base64')],
        { ...env, CLAUDE_NOTIFY_APPID: cfg.get('windowsAppId') },
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
  context.subscriptions.push(
    vscode.commands.registerCommand('claudeNotify.toast', toast),
    vscode.commands.registerCommand('claudeNotify.test', () =>
      notify('Claude Notify', 'Test notification: it works').catch((e) =>
        vscode.window.showErrorMessage(`Claude Notify: ${e.message}`),
      ),
    ),
  );
}

module.exports = { activate, deactivate() {} };
