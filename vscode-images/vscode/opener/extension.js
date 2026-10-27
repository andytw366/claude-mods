// Watches ~/.claude/vscode-images, where the vscode-images mod drops one small
// JSON file per picture Claude shows, and opens the pictures meant for this
// window in one floating window, a tab each, then hands the keyboard back to
// the terminal, which the `code` command cannot do.
//
// Each window gives its terminals its own id in CLAUDE_IMAGES_WINDOW, and the
// mod copies it into the file. A file without a live window's id (a terminal
// opened before this extension started, or this window reloaded since) is
// opened by the windows whose workspace holds the picture.
const vscode = require('vscode');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'vscode-images');
// One empty file per open window, touched every minute while it's open.
const windowsDir = path.join(dir, 'windows');
const windowId = crypto.randomUUID();
const MINUTE = 60 * 1000;

function inWorkspace(file) {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return false;
  return folders.some((f) => {
    const rel = path.relative(f.uri.fsPath, file);
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
  });
}

function liveWindow(id) {
  try {
    return Date.now() - fs.statSync(path.join(windowsDir, id)).mtimeMs < 3 * MINUTE;
  } catch {
    return false;
  }
}

function forThisWindow(window, file) {
  if (window === windowId) return true;
  if (window && liveWindow(window)) return false;
  return inWorkspace(file);
}

// The editor group of the floating window the pictures go to, by its column.
let floating;

// VS Code's image preview, which marks a group as the one this extension made.
const showsPicture = (group) =>
  group.tabs.some((t) => t.input instanceof vscode.TabInputCustom && t.input.viewType === 'imagePreview.previewEditor');

async function show(file) {
  const uri = vscode.Uri.file(file);
  const group = vscode.window.tabGroups.all.find((g) => g.viewColumn === floating);
  if (floating !== undefined && group && showsPicture(group)) {
    await vscode.commands.executeCommand('vscode.open', uri, { viewColumn: floating, preview: false, preserveFocus: true });
  } else {
    // No floating window yet, or it was closed: open the picture here and move it out into a new one.
    await vscode.commands.executeCommand('vscode.open', uri, { preview: false });
    await vscode.commands.executeCommand('workbench.action.moveEditorToNewWindow');
    floating = vscode.window.tabGroups.activeTabGroup.viewColumn;
  }
  await vscode.commands.executeCommand('workbench.action.terminal.focus');
}

// One picture at a time, so two arriving together do not both make a window.
let queue = Promise.resolve();
function open(file) {
  queue = queue
    .then(() => show(file))
    .catch((e) => vscode.window.showErrorMessage(`Claude Image Opener: ${e.message}`));
}

function activate(context) {
  fs.mkdirSync(windowsDir, { recursive: true });
  // Pictures no window took, and windows closed without saying so.
  const stale = [
    ...fs.readdirSync(dir).filter((n) => n.endsWith('.json')).map((n) => path.join(dir, n)),
    ...fs.readdirSync(windowsDir).map((n) => path.join(windowsDir, n)),
  ];
  for (const f of stale) {
    try {
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

  context.environmentVariableCollection.replace('CLAUDE_IMAGES_WINDOW', windowId);
  context.environmentVariableCollection.description = 'Lets Claude Code open the pictures it reads in this window';

  // Files already there were meant for earlier windows.
  const seen = new Set(fs.readdirSync(dir));
  const watcher = fs.watch(dir, (_type, name) => {
    if (!name || !name.endsWith('.json') || seen.has(name)) return;
    let request;
    try {
      request = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    } catch {
      return; // gone already, or not finished writing; the next change event follows
    }
    seen.add(name);
    if (!request || typeof request.path !== 'string' || !path.isAbsolute(request.path)) return;
    if (!forThisWindow(request.window, request.path)) return;
    open(request.path);
    fs.rm(path.join(dir, name), { force: true }, () => {});
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
