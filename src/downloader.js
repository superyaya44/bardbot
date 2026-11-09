import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from './db.js';
import { downloadAudio, resolveStream } from './ytdlp.js';
import { syncPlayingQueue } from './bot.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUDIO_DIR = path.join(__dirname, '..', 'data', 'audio');

// File de downloads séquentielle (évite de spammer YouTube en parallèle)
const queue = [];
let running = false;

export function enqueueDownload(trackId, url, title, playlistId = null) {
  queue.push({ trackId, url, title, playlistId });
  processQueue();
}

// Remet en file d'attente tous les tracks en erreur — toutes playlists, ou
// une seule (playlistId) dans le cas d'un retry ciblé depuis le dashboard.
export function retryErrorTracks(playlistId = null) {
  const rows = playlistId
    ? db.prepare("SELECT id, url, title, playlist_id FROM tracks WHERE status = 'error' AND playlist_id = ?").all(playlistId)
    : db.prepare("SELECT id, url, title, playlist_id FROM tracks WHERE status = 'error'").all();
  for (const t of rows) enqueueDownload(t.id, t.url, t.title, t.playlist_id);
  return rows.length;
}

function processQueue() {
  if (running || queue.length === 0) return;
  running = true;
  const job = queue.shift();
  setStatus(job.trackId, 'downloading');

  downloadAudio(job.url, `track_${job.trackId}`)
    .then((filePath) => {
      const r = db.prepare('UPDATE tracks SET file_path = ?, status = ?, download_error = NULL WHERE id = ?')
        .run(filePath, 'done', job.trackId);
      // 0 ligne touchée = le track a été supprimé pendant le download (voir finally)
      if (r.changes) {
        console.log(`[dl] ✓ track ${job.trackId}: ${path.basename(filePath)}`);
        // Injecte le morceau dans une lecture en cours de cette playlist (sync
        // live, sans kick du bot) — no-op si personne ne joue cette playlist.
        try { syncPlayingQueue(job.playlistId); } catch {}
      }
    })
    .catch((e) => {
      db.prepare('UPDATE tracks SET status = ?, download_error = ? WHERE id = ?')
        .run('error', e.message.slice(0, 500), job.trackId);
      console.error(`[dl] ✗ track ${job.trackId}: ${e.message.slice(0, 150)}`);
    })
    .finally(() => {
      // La playlist a pu être supprimée pendant le download : yt-dlp continue
      // d'écrire et recrée le fichier après coup. Sans ligne en base, c'est un
      // fantôme — on le jette tout de suite plutôt qu'au prochain balayage.
      const alive = db.prepare('SELECT 1 FROM tracks WHERE id = ?').get(job.trackId);
      if (!alive) {
        const { removed } = removeAudioFor(job.trackId);
        if (removed) console.log(`[dl] track ${job.trackId} supprimé pendant le download — fichier jeté`);
      }
      running = false;
      processQueue();
    });
}

function setStatus(id, status) {
  db.prepare('UPDATE tracks SET status = ? WHERE id = ?').run(status, id);
}

// Retourne une source lisible pour FFmpeg : fichier local si dispo, sinon stream URL
export async function getSource(track) {
  if (track.file_path && fs.existsSync(track.file_path)) {
    return { type: 'file', src: track.file_path };
  }
  const streamUrl = await resolveStream(track.url);
  return { type: 'stream', src: streamUrl };
}

// Supprime le fichier audio d'un track (à la suppression du track)
export function deleteAudioFile(track) {
  if (track?.file_path && fs.existsSync(track.file_path)) {
    try { fs.unlinkSync(track.file_path); } catch {}
  }
}

// Supprime les fichiers d'un track donné, quel que soit leur extension
function removeAudioFor(trackId) {
  let removed = 0, bytes = 0;
  try {
    for (const f of fs.readdirSync(AUDIO_DIR)) {
      if (!f.startsWith(`track_${trackId}.`)) continue;
      const full = path.join(AUDIO_DIR, f);
      try { bytes += fs.statSync(full).size; fs.unlinkSync(full); removed++; } catch {}
    }
  } catch {}
  return { removed, bytes };
}

// Fichiers audio dont le track n'existe plus (suppression de playlist, crash…).
// On se fie au nom `track_<id>` et non à file_path : pendant un download (--no-part)
// le fichier existe déjà alors que file_path est encore NULL — s'y fier effacerait
// les téléchargements en cours.
export function cleanupOrphanAudio() {
  const alive = new Set(db.prepare('SELECT id FROM tracks').all().map((t) => String(t.id)));
  let files = [];
  try { files = fs.readdirSync(AUDIO_DIR); } catch { return { removed: 0, bytes: 0 }; }
  let removed = 0, bytes = 0;
  for (const f of files) {
    const m = /^track_(\d+)\./.exec(f);
    if (!m || alive.has(m[1])) continue; // nom inconnu : on n'y touche pas
    const full = path.join(AUDIO_DIR, f);
    try {
      const size = fs.statSync(full).size;
      fs.unlinkSync(full);
      removed++; bytes += size;
    } catch {}
  }
  if (removed) console.log(`[audio] ${removed} orphelin(s) supprimé(s) — ${(bytes / 1e6).toFixed(0)} Mo`);
  return { removed, bytes };
}

// Disque occupé par l'audio
export function diskUsage() {
  let bytes = 0, count = 0;
  try {
    for (const f of fs.readdirSync(AUDIO_DIR)) {
      const st = fs.statSync(path.join(AUDIO_DIR, f));
      if (st.isFile()) { bytes += st.size; count++; }
    }
  } catch {}
  return { files: count, bytes };
}
