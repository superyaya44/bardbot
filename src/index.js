import 'dotenv/config';
import './bot.js';
import express from 'express';
import cors from 'cors';
import db, {
  listPlaylists, getPlaylist, createPlaylist, renamePlaylist, deletePlaylist,
  listTracks, addTrack, removeTrack, reorderTracks,
  listCommands, createCommand, updateCommand, deleteCommand,
} from './db.js';
import { resolveTrack, resolvePlaylist } from './ytdlp.js';
import { cookieStatus, refreshCookies, startCookieKeepalive } from './cookies.js';
import { enqueueDownload, deleteAudioFile, diskUsage, cleanupOrphanAudio, retryErrorTracks } from './downloader.js';
import client, { syncGuildCommands, syncPlayingQueue } from './bot.js';

const app = express();
app.use(express.json({ limit: '2mb' }));
// Dashboard servi par le même process (web/dist), accès Tailscale uniquement
app.use(express.static(new URL('../web/dist', import.meta.url).pathname));

// ---------- Playlists ----------
app.get('/api/playlists', (req, res) => {
  res.json(listPlaylists().map((p) => {
    const counts = db.prepare(`
      SELECT
        COUNT(*) AS track_count,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_count
      FROM tracks WHERE playlist_id = ?`).get(p.id);
    return { ...p, track_count: counts.track_count || 0, pending_count: counts.pending_count || 0 };
  }));
});

app.post('/api/playlists', (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'nom requis' });
  try {
    res.json(createPlaylist(name.trim()));
  } catch (e) {
    res.status(409).json({ error: 'Une playlist avec ce nom existe déjà' });
  }
});

app.patch('/api/playlists/:id', (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'nom requis' });
  try {
    const r = renamePlaylist(+req.params.id, name.trim());
    r ? res.json(r) : res.status(404).json({ error: 'playlist introuvable' });
  } catch (e) {
    res.status(409).json({ error: 'Nom déjà pris' });
  }
});

app.delete('/api/playlists/:id', (req, res) => {
  // Les tracks partent en cascade (FK), mais pas leurs fichiers audio : les
  // supprimer d'abord, tant que les lignes existent encore.
  listTracks(+req.params.id).forEach(deleteAudioFile);
  deletePlaylist(+req.params.id);
  syncGuildCommands().catch(console.error);
  res.json({ ok: true });
});

app.get('/api/playlists/:id/tracks', (req, res) => res.json(listTracks(+req.params.id)));

// Ajout d'un morceau (URL ou recherche) — résolution + download asynchrone
app.post('/api/playlists/:id/tracks', async (req, res) => {
  const { query } = req.body;
  if (!query?.trim()) return res.status(400).json({ error: 'query requise' });
  try {
    const t = await resolveTrack(query.trim());
    const track = addTrack(+req.params.id, { ...t, status: 'pending' });
    enqueueDownload(track.id, track.url, track.title, +req.params.id); // download en tâche de fond
    res.json({ ...track, status: 'pending' });
  } catch (e) {
    res.status(502).json({ error: `yt-dlp: ${e.message.slice(0, 200)}` });
  }
});

// Import d'une playlist YouTube entière (download en file d'attente)
app.post('/api/playlists/:id/import', async (req, res) => {
  const { url } = req.body;
  if (!url?.includes('list=')) return res.status(400).json({ error: 'URL playlist YouTube requise' });
  try {
    const { title, entries } = await resolvePlaylist(url.trim());
    const added = entries.map((e) => {
      const track = addTrack(+req.params.id, { ...e, status: 'pending' });
      enqueueDownload(track.id, track.url, track.title, +req.params.id);
      return track;
    });
    res.json({ imported: added.length, playlistTitle: title });
  } catch (e) {
    res.status(502).json({ error: `yt-dlp: ${e.message.slice(0, 200)}` });
  }
});

app.delete('/api/tracks/:id', (req, res) => {
  const track = db.prepare('SELECT * FROM tracks WHERE id = ?').get(+req.params.id);
  const playlistId = track?.playlist_id;
  deleteAudioFile(track);
  removeTrack(+req.params.id);
  syncPlayingQueue(playlistId); // retire le morceau d'une lecture en cours sans kick
  res.json({ ok: true });
});

// Retry d'un download en erreur
app.post('/api/tracks/:id/retry', (req, res) => {
  const track = db.prepare('SELECT * FROM tracks WHERE id = ?').get(+req.params.id);
  if (!track) return res.status(404).json({ error: 'introuvable' });
  enqueueDownload(track.id, track.url, track.title, track.playlist_id);
  res.json({ ok: true, status: 'pending' });
});

// Retry de tous les downloads en erreur — toutes playlists, ou une seule si
// playlist_id est fourni dans le body.
app.post('/api/tracks/retry-all', (req, res) => {
  const playlistId = req.body?.playlist_id ? +req.body.playlist_id : null;
  if (playlistId && !db.prepare('SELECT 1 FROM playlists WHERE id = ?').get(playlistId))
    return res.status(404).json({ error: 'playlist introuvable' });
  const retried = retryErrorTracks(playlistId);
  res.json({ ok: true, retried });
});

// Balayage des fichiers audio orphelins
app.post('/api/audio/cleanup', (req, res) => res.json(cleanupOrphanAudio()));

// Usage disque
app.get('/api/stats', (req, res) => res.json(diskUsage()));

app.post('/api/playlists/:id/reorder', (req, res) => {
  const { orderedIds } = req.body;
  if (!Array.isArray(orderedIds)) return res.status(400).json({ error: 'orderedIds requis' });
  reorderTracks(+req.params.id, orderedIds);
  res.json({ ok: true });
});

// ---------- Commandes custom ----------
app.get('/api/commands', (req, res) => res.json(listCommands()));

app.post('/api/commands', async (req, res) => {
  const { name, description, playlist_id, loop, shuffle, volume, allowed_roles } = req.body;
  if (!name?.trim() || !playlist_id) return res.status(400).json({ error: 'nom + playlist requis' });
  if (!/^[\w-]{1,32}$/.test(name.trim()))
    return res.status(400).json({ error: 'nom invalide (a-z 0-9 - _, max 32, pas d\'espace ni accent)' });
  try {
    const cmd = createCommand({
      name: name.trim().toLowerCase(), description: description || 'Lance une playlist',
      playlist_id: +playlist_id, loop, shuffle: !!shuffle,
      volume: Math.min(100, Math.max(1, +volume || 50)),
      allowed_roles: JSON.stringify(allowed_roles || []),
    });
    await syncGuildCommands();
    res.json(cmd);
  } catch (e) {
    res.status(409).json({ error: 'Commande du même nom existe déjà' });
  }
});

app.delete('/api/commands/:id', async (req, res) => {
  deleteCommand(+req.params.id);
  await syncGuildCommands();
  res.json({ ok: true });
});

// Update commande (PUT)
app.put('/api/commands/:id', async (req, res) => {
  const { name, description, playlist_id, loop, shuffle, volume, allowed_roles } = req.body;
  try {
    const cmd = updateCommand(+req.params.id, {
      ...(name && { name: name.trim().toLowerCase() }),
      ...(description && { description }),
      ...(playlist_id && { playlist_id: +playlist_id }),
      ...(loop !== undefined && { loop }),
      ...(shuffle !== undefined && { shuffle: !!shuffle }),
      ...(volume !== undefined && { volume: Math.min(100, Math.max(1, +volume || 50)) }),
      ...(allowed_roles !== undefined && { allowed_roles: JSON.stringify(allowed_roles) }),
    });
    cmd ? (await syncGuildCommands(), res.json(cmd)) : res.status(404).json({ error: 'introuvable' });
  } catch (e) {
    res.status(409).json({ error: 'Nom déjà pris' });
  }
});

// Cookies YouTube — sonde réelle (mise en cache 5 min, ?force=1 pour resonder)
app.get('/api/cookies', async (req, res) => {
  try {
    res.json(await cookieStatus({ force: req.query.force === '1' }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Rafraîchit la session via le browser vivant, puis resonde
app.post('/api/cookies/refresh', async (req, res) => {
  try {
    res.json(await refreshCookies());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Santé
app.get('/api/health', (req, res) => res.json({ ok: true, bot: client?.readyAt ? true : false }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, process.env.HOST || '0.0.0.0', () => {
  console.log(`[api] dashboard + api sur :${PORT} (accès Tailscale)`);
  cleanupOrphanAudio(); // rattrape ce qu'une suppression passée a laissé traîner
  startCookieKeepalive(); // garde les tokens YouTube vivants + ré-export régulier
});
