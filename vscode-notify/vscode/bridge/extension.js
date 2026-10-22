// Watches ~/.claude/vscode-notify, where the vscode-notify Claude Code plugin's
// hook drops each hook event's raw JSON, and passes the events meant for this
// window to the claudeNotify.toast command. That command lives in
// claude-notify-toast, a UI extension, so VS Code runs it on the local machine
// even when this extension runs in WSL, a container or over SSH.
//
// Each window gives its terminals its own id in CLAUDE_NOTIFY_WINDOW, and the
// hook copies it into the event, so a session started in this window's terminal
// notifies only this window. Events without a live window's id (Claude started
// elsewhere, or this window reloaded since) fall back to the workspace folders.
const vscode = require('vscode');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'vscode-notify');
// One empty file per open window, touched every minute while it's open.
const windowsDir = path.join(dir, 'windows');
const windowId = crypto.randomUUID();
const MINUTE = 60 * 1000;
// When each session's current turn started, for the time shown on Stop.
const starts = new Map();

function inWorkspace(cwd) {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return true;
  return folders.some((f) => {
    const rel = path.relative(f.uri.fsPath, cwd);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  });
}

function liveWindow(id) {
  try {
    return Date.now() - fs.statSync(path.join(windowsDir, id)).mtimeMs < 3 * MINUTE;
  } catch {
    return false;
  }
}

function forThisWindow(window, cwd) {
  if (!vscode.workspace.getConfiguration('claudeNotify').get('onlyThisWorkspace')) return true;
  if (window === windowId) return true;
  if (window && liveWindow(window)) return false;
  return typeof cwd === 'string' && inWorkspace(cwd);
}

// The hook's raw JSON as the toast wants it: {event, session, cwd, title, text, elapsed}.
// Returns null for UserPromptSubmit, which only marks when a turn started.
function toEvent(hook) {
  const name = hook.hook_event_name;
  const session = String(hook.session_id || '').replace(/[^\w-]/g, '');
  if (name === 'UserPromptSubmit') {
    starts.set(session, Date.now());
    return null;
  }
  let elapsed = null;
  if (name === 'Stop' && starts.has(session)) {
    elapsed = Math.round((Date.now() - starts.get(session)) / 1000);
    starts.delete(session);
  }
  const cwd = typeof hook.cwd === 'string' ? hook.cwd : '';
  const text = name === 'Stop' ? hook.last_assistant_message : hook.message;
  return {
    event: name,
    session,
    cwd,
    title: cwd.split(/[\\/]/).filter(Boolean).pop() || 'Claude Code',
    text: String(text || '').slice(0, 4000),
    elapsed,
  };
}

async function deliver(event) {
  try {
    await vscode.commands.executeCommand('claudeNotify.toast', event);
  } catch {
    // claude-notify-toast isn't installed: fall back to VS Code's own popup,
    // with the first line of the raw text (plugin 0.1.x wrote `body` instead).
    const raw = String(event.text ?? event.body ?? '');
    const line = raw.split('\n').find((s) => s.trim()) || '';
    vscode.window.showInformationMessage(line ? `${event.title}: ${line.trim()}` : event.title);
  }
}

function handle(file) {
  let window, event;
  // Plugin 0.3.0 wraps the raw hook JSON; 0.2.x wrote the event itself.
  if (file.hook) {
    window = file.window;
    event = toEvent(file.hook);
  } else {
    event = file;
  }
  if (event && forThisWindow(window, event.cwd)) deliver(event);
}

function activate(context) {
  fs.mkdirSync(windowsDir, { recursive: true });
  for (const name of fs.readdirSync(windowsDir)) {
    try {
      const f = path.join(windowsDir, name);
      if (Date.now() - fs.statSync(f).mtimeMs > 24 * 60 * MINUTE) fs.unlinkSync(f);
    } catch {
      // Another window got there first.
    }
  }
  const beacon = path.join(windowsDir, windowId);
  const beat = () => {
    try {
      const now = new Date();
      fs.closeSync(fs.openSync(beacon, 'a'));
      fs.utimesSync(beacon, now, now);
    } catch {
      // Try again next minute.
    }
  };
  beat();
  const timer = setInterval(beat, MINUTE);

  context.environmentVariableCollection.replace('CLAUDE_NOTIFY_WINDOW', windowId);
  context.environmentVariableCollection.description = 'Lets Claude Notify send this terminal\'s Claude notifications to this window only';

  // Files already there were meant for earlier windows.
  const seen = new Set(fs.readdirSync(dir));
  const watcher = fs.watch(dir, (_type, name) => {
    if (!name || !name.endsWith('.json') || name.startsWith('.') || seen.has(name)) return;
    let file;
    try {
      file = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    } catch {
      return; // gone already, or not finished writing; the rename event follows
    }
    seen.add(name);
    if (file && typeof file === 'object') handle(file);
  });
  context.subscriptions.push({
    dispose: () => {
      watcher.close();
      clearInterval(timer);
      fs.rmSync(beacon, { force: true });
    },
  });
}

module.exports = { activate, deactivate() {} };
