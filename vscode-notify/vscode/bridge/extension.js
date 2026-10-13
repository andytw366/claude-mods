// Watches ~/.claude/vscode-notify, where the vscode-notify Claude Code plugin's
// hook drops one JSON file per event, and passes each event to the
// claudeNotify.toast command. That command lives in claude-notify-toast, a UI
// extension, so VS Code runs it on the local machine even when this extension
// runs in WSL, a container or over SSH.
const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'vscode-notify');

function inWorkspace(cwd) {
  if (!vscode.workspace.getConfiguration('claudeNotify').get('onlyThisWorkspace')) return true;
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return true;
  return folders.some((f) => {
    const rel = path.relative(f.uri.fsPath, cwd);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  });
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

function activate(context) {
  fs.mkdirSync(dir, { recursive: true });
  // Files already there were meant for earlier windows.
  const seen = new Set(fs.readdirSync(dir));

  const watcher = fs.watch(dir, (_type, name) => {
    if (!name || !name.endsWith('.json') || name.startsWith('.') || seen.has(name)) return;
    let event;
    try {
      event = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    } catch {
      return; // gone already, or not finished writing; the rename event follows
    }
    seen.add(name);
    if (typeof event.cwd === 'string' && inWorkspace(event.cwd)) deliver(event);
  });
  context.subscriptions.push({ dispose: () => watcher.close() });
}

module.exports = { activate, deactivate() {} };
