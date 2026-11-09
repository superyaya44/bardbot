import WebSocket from 'ws';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Exporte les cookies du browser persistant (CDP) vers data/cookies.txt.
// Pourquoi : yt-dlp lit la DB SQLite du profil Chromium, mais (1) le profil
// actif peut changer (Default vs Profile 1), (2) Chromium garde les cookies
// en mémoire sans flusher la DB — yt-dlp voit donc des cookies périmés alors
// que la session est vivante. Le browser vivant via CDP est la source de
// vérité : on exporte ce qu'il utilise réellement, au format Netscape.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COOKIES = path.join(__dirname, '..', 'data', 'cookies.txt');
const CDP = process.env.YTDLP_BROWSER_CDP || 'http://127.0.0.1:9222';

let msgId = 0;

function cdpCall(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    const onMsg = (raw) => {
      let m; try { m = JSON.parse(raw); } catch { return; }
      if (m.id !== id) return;
      ws.off('message', onMsg);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    };
    ws.on('message', onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function fetchBrowserCookies() {
  const version = await fetch(`${CDP}/json/version`, { signal: AbortSignal.timeout(5000) }).then((r) => r.json());
  const wsUrl = version.webSocketDebuggerUrl;
  if (!wsUrl) throw new Error('pas de webSocketDebuggerUrl sur le CDP');
  const ws = new WebSocket(wsUrl, { handshakeTimeout: 8000 });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  try {
    const { cookies } = await cdpCall(ws, 'Storage.getCookies'); // tous profils confondus
    return cookies;
  } finally {
    ws.close();
  }
}

// Format Netscape : domain \t includeSubdomains \t path \t secure \t expires \t name \t value
function toNetscape(cookies) {
  const lines = ['# Netscape HTTP Cookie File', '# Exporté depuis le browser persistant via CDP'];
  for (const c of cookies) {
    const domain = c.domain || '';
    let expires = Math.floor(c.expires || 0);
    if (!expires || expires < 0) expires = 0; // cookie de session → 0 ( yt-dlp le garde pour la session )
    const secure = c.secure ? 'TRUE' : 'FALSE';
    const incSub = domain.startsWith('.') ? 'TRUE' : 'FALSE';
    const val = (c.value || '').replace(/\t|\n|\r/g, '');
    lines.push([domain, incSub, c.path || '/', secure, expires, c.name, val].join('\t'));
  }
  return lines.join('\n') + '\n';
}

// Garde tout youtube/google : yt-dlp a besoin des PSID (youtube), et les
// cookies .google.com aident aux redirects accounts.google.com.
export async function exportBrowserCookies() {
  const cookies = await fetchBrowserCookies();
  const kept = cookies.filter((c) => /(^|\.)youtube\.com$|(^|\.)google\.com$|(^|\.)google\.(fr|de|co\.uk)$/.test(c.domain || ''));
  const hasAuth = kept.some((c) => c.domain.includes('youtube') && c.name === 'LOGIN_INFO');
  if (!hasAuth) {
    throw new Error('browser vivant sans session YouTube (pas de LOGIN_INFO) — reconnexion Google nécessaire');
  }
  const tmp = COOKIES + '.tmp';
  fs.writeFileSync(tmp, toNetscape(kept), { mode: 0o600 });
  fs.renameSync(tmp, COOKIES);
  return { count: kept.length, file: COOKIES };
}
