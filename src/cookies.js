import { spawn } from 'node:child_process';
import { cookieArgs, cookieSource } from './ytdlp.js';
import { exportBrowserCookies } from './cdp-cookies.js';
import { retryErrorTracks } from './downloader.js';

// Vidéo courte et stable, sert uniquement de cible de sonde
const PROBE_URL = 'https://www.youtube.com/watch?v=ZOoFtJWJXL4';
const CDP = process.env.YTDLP_BROWSER_CDP || 'http://127.0.0.1:9222';
const TTL_MS = 5 * 60 * 1000;

let cached = null;   // { ok, source, detail, checked_at }
let running = null;  // sonde en cours — évite d'en lancer plusieurs en parallèle

// Seul verdict fiable : faire résoudre une vidéo à yt-dlp. Un fichier de cookies
// non vide (ou un profil browser présent) peut très bien être périmé.
function probe() {
  return new Promise((resolve) => {
    const args = [
      '--simulate', '-f', 'bestaudio/best', '--no-playlist', '-e', '--no-warnings',
      ...cookieArgs(),
      '--socket-timeout', '15',
      PROBE_URL,
    ];
    const p = spawn('yt-dlp', args, { timeout: 45000 });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => resolve({ ok: false, detail: `yt-dlp injoignable : ${e.message}` }));
    p.on('close', (code) => resolve(code === 0
      ? { ok: true, detail: 'Session YouTube valide' }
      : { ok: false, detail: explain(err) }));
  });
}

// Traduit le charabia de yt-dlp en cause actionnable
function explain(err) {
  const e = err.toLowerCase();
  if (e.includes('sign in') || e.includes('login_required') || e.includes('not a bot'))
    return 'Session YouTube expirée — reconnecte le compte Google dans le browser';
  if (e.includes('needs to be reloaded') || e.includes('challenge'))
    return 'Runtime JS absent du PATH du service (n challenge non résolu)';
  if (e.includes('could not copy') || e.includes('database is locked'))
    return 'Cookies du browser illisibles — profil verrouillé';
  if (e.includes('timed out') || e.includes('timeout'))
    return 'Timeout réseau vers YouTube';
  return err.trim().split('\n').pop()?.slice(0, 160) || 'Échec inconnu';
}

export async function cookieStatus({ force = false } = {}) {
  if (!force && cached && Date.now() - new Date(cached.checked_at).getTime() < TTL_MS) return cached;
  if (running) return running;
  running = (async () => {
    let r = await probe();
    // Auto-réparation : la cause n°1 de sonde rouge est un export périmé alors
    // que la session du browser vivant est OK. On tente UN refresh CDP (visite
    // YouTube → rotation des tokens → ré-export → re-sonde) avant de conclure.
    if (!r.ok) {
      try {
        await visitYouTube();
        await exportBrowserCookies();
        const r2 = await probe();
        if (r2.ok) {
          console.log('[cookies] sonde rouge → auto-réparation CDP réussie');
          r = r2;
        }
      } catch { /* browser down ou sans session : verdict rouge initial */ }
    }
    let auto_retried = 0;
    // Transition rouge → vert : les téléchargements tombés en erreur pendant
    // la panne de cookies n'ont aucune chance d'avoir réussi pour d'autres
    // raisons — on les relance tous automatiquement, toutes playlists.
    if (r.ok && cached && !cached.ok) {
      auto_retried = retryErrorTracks();
      if (auto_retried) console.log(`[cookies] session redevenue valide — retry automatique de ${auto_retried} track(s) en erreur`);
    }
    cached = { ...r, ...(auto_retried ? { auto_retried } : {}), source: cookieSource(), checked_at: new Date().toISOString() };
    return cached;
  })();
  running.finally(() => { running = null; });
  return running;
}

// Faire visiter YouTube au browser vivant : Google en profite pour faire tourner
// __Secure-1PSIDTS dans le profil, ce qui remet la session à jour pour yt-dlp.
async function visitYouTube() {
  const url = `${CDP}/json/new?https://www.youtube.com/`;
  let r = await fetch(url, { method: 'PUT', signal: AbortSignal.timeout(10000) });
  if (!r.ok) r = await fetch(url, { signal: AbortSignal.timeout(10000) }); // Chrome < 111
  if (!r.ok) throw new Error(`CDP a répondu ${r.status}`);
  const { id } = await r.json();
  await new Promise((s) => setTimeout(s, 8000)); // laisse la rotation des tokens se faire
  if (id) await fetch(`${CDP}/json/close/${id}`, { signal: AbortSignal.timeout(5000) }).catch(() => {});
}

// Garde-alive : la session YouTube repose sur des tokens tournants
// (__Secure-1PSIDTS) qui périment même sans utilisation. Visite périodique
// via le browser vivant + ré-export, pour que data/cookies.txt reste valide.
const KEEPALIVE_MS = 6 * 60 * 60 * 1000; // 6h
export function startCookieKeepalive() {
  const tick = async () => {
    try {
      await visitYouTube();
      await exportBrowserCookies();
      console.log('[cookies] keep-alive : tokens rafraîchis, cookies ré-exportés');
    } catch (e) {
      console.warn(`[cookies] keep-alive échoué : ${e.message}`);
    }
  };
  setTimeout(tick, 2 * 60 * 1000); // première rotation 2 min après le boot
  setInterval(tick, KEEPALIVE_MS).unref();
}

export async function refreshCookies() {
  let warning = null;
  try {
    await visitYouTube();
  } catch (e) {
    // Le browser peut être éteint sans que les cookies soient pour autant morts :
    // on exporte quand même les cookies existants et on signale le souci.
    warning = `Browser injoignable sur ${CDP} (${e.message}) — export effectué sans rafraîchissement`;
  }
  // Source de vérité = cookies du browser vivant via CDP → data/cookies.txt.
  // Sans cet export, yt-dlp continuerait à lire un fichier périmé.
  try {
    await exportBrowserCookies();
  } catch (e) {
    const s = await cookieStatus({ force: true });
    return { ...s, warning: `Export CDP impossible : ${e.message}` };
  }
  const s = await cookieStatus({ force: true });
  return warning ? { ...s, warning } : s;
}
