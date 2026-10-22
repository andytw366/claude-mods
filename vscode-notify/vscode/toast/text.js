// The notification's words, built from the raw event the hook wrote. Kept free
// of the vscode API so the rules can be tested on their own.

const chars = (s) => [...s];

// Folder names over 32 characters keep both ends: 16 + … + 15.
function title(name) {
  const c = chars(name || 'Claude Code');
  return c.length > 32 ? c.slice(0, 16).join('') + '…' + c.slice(-15).join('') : c.join('');
}

function clip(s, max = 140) {
  const c = chars(s);
  return c.length > max ? c.slice(0, max - 1).join('') + '…' : s;
}

function plain(line) {
  let s = line
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(?:(?:#{1,6}|>|[-*+]|\d+[.)])\s*)+/, '')
    .replace(/\*\*|__/g, '')
    .replace(/`/g, '');
  // Single * or _ only around a word, so snake_case names keep their underscores.
  s = s.replace(/(^|[^\w*])\*(?=\S)(.+?)(?<=\S)\*(?![\w*])/g, '$1$2');
  s = s.replace(/(^|[^\w])_(?=\S)(.+?)(?<=\S)_(?!\w)/g, '$1$2');
  return s.trim();
}

const OPENER = /^(好的|好|我來|讓我|OK|Sure|Let me)/i;

// First line of the reply with content, skipping code blocks, horizontal rules,
// table rules and short openers such as "好，我來看看。".
function summary(markdown) {
  const lines = [];
  let fenced = false;
  for (const raw of String(markdown || '').split('\n')) {
    if (/^\s*(```|~~~)/.test(raw)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const s = plain(raw);
    if (s && !/^[-|:=\s*_]+$/.test(s)) lines.push(s);
  }
  const pick = lines.find((s) => !(OPENER.test(s) && chars(s).length < 15)) || lines[0] || '';
  return clip(pick);
}

const NEEDS_ZH = [
  [/^Claude needs your permission to use (.+)$/, '需要你允許使用 $1'],
  [/^Claude is waiting for your input$/, '在等你回覆'],
];

function needsText(message, zh) {
  const m = String(message || '').trim();
  if (zh) for (const [re, to] of NEEDS_ZH) if (re.test(m)) return clip(m.replace(re, to));
  return clip(m);
}

function duration(seconds, zh) {
  if (typeof seconds !== 'number' || !(seconds >= 0)) return '';
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = Math.floor(seconds % 60);
  if (zh) return h ? `${h} 小時 ${m} 分` : m ? `${m} 分 ${s} 秒` : `${s} 秒`;
  return h ? `${h}h ${m}m` : m ? `${m}m ${s}s` : `${s}s`;
}

// remoteName and the workspace folder's URI authority, e.g. ssh-remote+lab-gpu.
// Remote-SSH hex-encodes the authority when the host was picked from a JSON config.
function environment(remoteName, authority) {
  if (!remoteName) return '';
  let host = String(authority || '').split('+').slice(1).join('+');
  if (/^[0-9a-f]+$/i.test(host) && host.length % 2 === 0) {
    try {
      host = JSON.parse(Buffer.from(host, 'hex').toString('utf8')).hostName || host;
    } catch {
      // Not JSON: keep it as written.
    }
  }
  switch (remoteName) {
    case 'wsl':
      return host ? `WSL: ${host}` : 'WSL';
    case 'ssh-remote':
      return host ? `SSH: ${host}` : 'SSH';
    case 'dev-container':
    case 'attached-container':
      return 'Dev Container';
    default:
      return remoteName;
  }
}

// event: {event, session, title, text, elapsed} from the hook (plugin 0.1.x wrote `body`).
// where: environment label; zh: VS Code is in Chinese.
function present(event, where, zh) {
  const needs = event.event === 'Notification';
  const raw = typeof event.text === 'string' ? event.text : String(event.body || '').replace(/^(Done|Needs you): /, '');
  const done = zh ? '完成' : 'Done';
  const waiting = zh ? '等你確認' : 'Needs you';
  const body = needs ? needsText(raw, zh) : summary(raw);
  const info = needs ? waiting : duration(event.elapsed, zh);
  return {
    needs,
    session: typeof event.session === 'string' ? event.session : '',
    title: title(event.title),
    body: body || (needs ? waiting : done),
    attribution: [where, info].filter(Boolean).join(' · ') || done,
  };
}

module.exports = { title, summary, needsText, duration, environment, present };
