import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COOKIES = path.join(__dirname, '..', 'data', 'cookies.txt');
const AUDIO_DIR = path.join(__dirname, '..', 'data', 'audio');
// Source des cookies YouTube (ordre de priorité) :
//  1. data/cookies.txt, exporté via CDP (voir cdp-cookies.js) ;
//  2. YTDLP_SHARED_COOKIES : fichier cookies Netscape optionnel, par ex. maintenu
//     par un script externe qui rafraîchit les cookies YouTube
//     (défaut : data/shared-cookies.txt, ignoré s'il est absent ou vide) ;
//  3. aucun cookie.
const SHARED_COOKIES = process.env.YTDLP_SHARED_COOKIES || path.join(__dirname, '..', 'data', 'shared-cookies.txt');
const hasCookies = (f = COOKIES) => { try { return fs.statSync(f).size > 100; } catch { return false; } };
export const cookieArgs = () => (hasCookies()
  ? ['--cookies', COOKIES]
  : hasCookies(SHARED_COOKIES) ? ['--cookies', SHARED_COOKIES] : []);
export const cookieSource = () => (hasCookies() ? 'fichier (CDP export)' : hasCookies(SHARED_COOKIES) ? 'fichier partagé' : 'aucune');
fs.mkdirSync(AUDIO_DIR, { recursive: true });

// Résout une URL/recherche en métadonnées (sans télécharger)
export function resolveTrack(query) {
  return new Promise((resolve, reject) => {
    const args = [
      '-f', 'bestaudio/best', '--no-playlist', '--dump-single-json', '--no-warnings',
      ...cookieArgs(),
      '--extractor-args', 'youtubepot-bgutilhttp:base_url=http://127.0.0.1:4416',
      '--socket-timeout', '15',
      query.startsWith('http') || query.startsWith('ytsearch') ? query : `ytsearch1:${query}`,
    ];
    const p = spawn('yt-dlp', args, { timeout: 30000 });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(`yt-dlp exit ${code}: ${err.slice(-300)}`));
      try {
        const j = JSON.parse(out);
        // Pour une recherche, l'entrée réelle est dans entries[0]
        const t = j._type === 'playlist' ? (j.entries || [])[0] : j;
        if (!t) return reject(new Error('aucun résultat'));
        resolve({
          title: t.title, url: t.webpage_url || t.url || query,
          duration: fmtDur(t.duration),
        });
      } catch { reject(new Error('JSON parse fail')); }
    });
  });
}

// Télécharge l'audio d'une vidéo dans data/audio/. Retourne le chemin du fichier.
export function downloadAudio(url, basename) {
  return new Promise((resolve, reject) => {
    const outTpl = path.join(AUDIO_DIR, `${basename}.%(ext)s`);
    const args = [
      '-f', 'bestaudio/best', '--no-playlist', '--no-warnings',
      ...cookieArgs(),
      '--extractor-args', 'youtubepot-bgutilhttp:base_url=http://127.0.0.1:4416',
      '--socket-timeout', '20', '--retries', '3',
      '-o', outTpl, '--no-part',
      url,
    ];
    const p = spawn('yt-dlp', args, { timeout: 600000 });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(`yt-dlp exit ${code}: ${err.slice(-300)}`));
      const f = fs.readdirSync(AUDIO_DIR).find((x) => x.startsWith(basename + '.'));
      if (!f) return reject(new Error('fichier téléchargé introuvable'));
      resolve(path.join(AUDIO_DIR, f));
    });
  });
}

// Résout une playlist YouTube complète (flat: rapide, pas de téléchargement)
export function resolvePlaylist(url) {
  return new Promise((resolve, reject) => {
    const args = [
      '--flat-playlist', '--dump-single-json', '--no-warnings',
      ...cookieArgs(),
      '--extractor-args', 'youtubepot-bgutilhttp:base_url=http://127.0.0.1:4416',
      '--socket-timeout', '15',
      url,
    ];
    const p = spawn('yt-dlp', args, { timeout: 120000 });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(`yt-dlp exit ${code}: ${err.slice(-300)}`));
      try {
        const j = JSON.parse(out);
        const entries = (j.entries || []).filter((e) => e.url || e.id)
          .map((e) => ({
            title: e.title || e.id,
            url: e.url || `https://www.youtube.com/watch?v=${e.id}`,
            duration: fmtDur(e.duration),
          }));
        resolve({ title: j.title || 'Playlist', entries });
      } catch { reject(new Error('JSON parse fail')); }
    });
  });
}

// Fallback : stream direct (si fichier local absent)
export function resolveStream(trackUrl) {
  return new Promise((resolve, reject) => {
    const args = [
      '-f', 'bestaudio/best', '--no-playlist', '--get-url', '--no-warnings',
      ...cookieArgs(),
      '--extractor-args', 'youtubepot-bgutilhttp:base_url=http://127.0.0.1:4416',
      '--socket-timeout', '15',
      trackUrl,
    ];
    const p = spawn('yt-dlp', args, { timeout: 30000 });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(`yt-dlp exit ${code}: ${err.slice(-300)}`));
      const url = out.trim().split('\n')[0];
      url ? resolve(url) : reject(new Error('no stream url'));
    });
  });
}

function fmtDur(s) {
  if (!s || isNaN(s)) return '';
  const m = Math.floor(s / 60), sec = Math.round(s % 60);
  const h = Math.floor(m / 60);
  return h > 0
    ? `${h}:${String(m % 60).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}
