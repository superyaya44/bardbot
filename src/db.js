import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, '..', 'data', 'bardbot.db'));

db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS playlists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tracks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  duration TEXT DEFAULT '',
  file_path TEXT DEFAULT NULL,
  status TEXT NOT NULL DEFAULT 'done',
  download_error TEXT DEFAULT NULL,
  added_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS commands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT NOT NULL DEFAULT 'Lance une playlist',
  playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  loop INTEGER NOT NULL DEFAULT 1,
  shuffle INTEGER NOT NULL DEFAULT 0,
  volume INTEGER NOT NULL DEFAULT 50,
  allowed_roles TEXT NOT NULL DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

// Playlists
export const listPlaylists = () =>
  db.prepare('SELECT * FROM playlists ORDER BY name').all();

export const getPlaylist = (id) =>
  db.prepare('SELECT * FROM playlists WHERE id = ?').get(id);

export const getPlaylistByName = (name) =>
  db.prepare('SELECT * FROM playlists WHERE name = ? COLLATE NOCASE').get(name);

export const createPlaylist = (name) => {
  const r = db.prepare('INSERT INTO playlists (name) VALUES (?)').run(name);
  return getPlaylist(r.lastInsertRowid);
};

export const renamePlaylist = (id, name) => {
  db.prepare("UPDATE playlists SET name = ?, updated_at = datetime('now') WHERE id = ?").run(name, id);
  return getPlaylist(id);
};

export const deletePlaylist = (id) => {
  db.prepare('DELETE FROM commands WHERE playlist_id = ?').run(id);
  db.prepare('DELETE FROM playlists WHERE id = ?').run(id);
};

// Tracks
export const listTracks = (playlistId) =>
  db.prepare('SELECT * FROM tracks WHERE playlist_id = ? ORDER BY position').all(playlistId);

export const addTrack = (playlistId, { title, url, duration }) => {
  const max = db.prepare('SELECT COALESCE(MAX(position), 0) AS m FROM tracks WHERE playlist_id = ?').get(playlistId).m;
  const r = db.prepare('INSERT INTO tracks (playlist_id, position, title, url, duration) VALUES (?, ?, ?, ?, ?)')
    .run(playlistId, max + 1, title, url, duration || '');
  return db.prepare('SELECT * FROM tracks WHERE id = ?').get(r.lastInsertRowid);
};

export const removeTrack = (trackId) =>
  db.prepare('DELETE FROM tracks WHERE id = ?').run(trackId);

export const reorderTracks = (playlistId, orderedIds) => {
  const stmt = db.prepare('UPDATE tracks SET position = ? WHERE id = ? AND playlist_id = ?');
  const tx = db.transaction((ids) => {
    ids.forEach((id, i) => stmt.run(i + 1, id, playlistId));
  });
  tx(orderedIds);
};

// Commands
export const listCommands = () =>
  db.prepare(`
    SELECT c.*, p.name AS playlist_name FROM commands c
    JOIN playlists p ON p.id = c.playlist_id
    ORDER BY c.name`).all();

export const getCommand = (id) =>
  db.prepare('SELECT * FROM commands WHERE id = ?').get(id);

// loop est un mode, pas un booléen : 0 = off, 1 = morceau, 2 = playlist entière.
// Un client qui envoie un booléen n'a pas la notion de mode (vieux bundle du
// dashboard, appel API à la main) : `true` ne peut vouloir dire que « boucle la
// playlist ». Pour obtenir la répétition d'un seul morceau, il faut envoyer 1.
const loopMode = (v) => {
  if (typeof v === 'boolean') return v ? 2 : 0;
  const n = Number(v);
  return n === 2 ? 2 : n === 1 ? 1 : 0;
};

export const createCommand = (c) => {
  const r = db.prepare(`
    INSERT INTO commands (name, description, playlist_id, loop, shuffle, volume, allowed_roles)
    VALUES (@name, @description, @playlist_id, @loop, @shuffle, @volume, @allowed_roles)`)
    .run({
      name: String(c.name), description: String(c.description || 'Lance une playlist'),
      playlist_id: Number(c.playlist_id),
      loop: loopMode(c.loop), shuffle: c.shuffle ? 1 : 0,
      volume: Number(c.volume) || 50,
      allowed_roles: typeof c.allowed_roles === 'string' ? c.allowed_roles : JSON.stringify(c.allowed_roles || []),
    });
  return getCommand(r.lastInsertRowid);
};

export const updateCommand = (id, c) => {
  const cur = getCommand(id);
  if (!cur) return null;
  const merged = { ...cur, ...c };
  db.prepare(`
    UPDATE commands SET name=@name, description=@description, playlist_id=@playlist_id,
      loop=@loop, shuffle=@shuffle, volume=@volume, allowed_roles=@allowed_roles
    WHERE id=@id`)
    .run({
      ...merged, id,
      playlist_id: Number(merged.playlist_id),
      loop: loopMode(merged.loop),
      shuffle: merged.shuffle ? 1 : 0,
      volume: Math.min(100, Math.max(1, Number(merged.volume) || 50)),
      allowed_roles: typeof merged.allowed_roles === 'string'
        ? merged.allowed_roles
        : JSON.stringify(merged.allowed_roles || []),
    });
  return getCommand(id);
};

export const deleteCommand = (id) =>
  db.prepare('DELETE FROM commands WHERE id = ?').run(id);

export default db;
