import React, { useState } from 'react';
import Modal from './Modal.jsx';
import { useApi } from '../api.jsx';

// Générateur de commande custom : /name → lance playlist avec loop/shuffle/volume/rôles
export default function CommandModal({ playlists, cmd, onClose }) {
  const { req, toast } = useApi();
  let roles = [];
  try { roles = JSON.parse(cmd?.allowed_roles || '[]'); } catch { roles = []; }

  const [name, setName] = useState(cmd?.name || '');
  const [description, setDescription] = useState(cmd?.description || '');
  const [playlistId, setPlaylistId] = useState(cmd?.playlist_id || playlists[0]?.id || '');
  const [loop, setLoop] = useState(cmd ? !!cmd.loop : true);
  const [shuffle, setShuffle] = useState(!!cmd?.shuffle);
  const [volume, setVolume] = useState(cmd?.volume ?? 50);
  const [rolesText, setRolesText] = useState(roles.join(', '));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const go = async () => {
    if (!name.trim()) return setError('Le nom est requis');
    if (!playlistId) return setError('Crée d\'abord une playlist');
    setBusy(true);
    setError('');
    const body = {
      name: name.trim(),
      description: description.trim() || 'Lance une playlist',
      playlist_id: +playlistId,
      loop: loop ? 2 : 0, // 2 = rejouer la playlist entière (voir refillQueue)
      shuffle, volume,
      allowed_roles: rolesText.split(',').map((r) => r.trim()).filter(Boolean),
    };
    try {
      if (cmd) {
        await req(`/api/commands/${cmd.id}`, { method: 'PUT', body });
        toast(`Commande /${body.name} mise à jour — synchronisée avec Discord`);
      } else {
        await req('/api/commands', { method: 'POST', body });
        toast(`Commande /${body.name} créée — disponible sur Discord`);
      }
      onClose();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  const nameValid = /^[a-z0-9_-]{1,32}$/.test(name.trim().toLowerCase());

  return (
    <Modal title={cmd ? `Modifier /${cmd.name}` : 'Nouvelle commande'} onClose={busy ? () => {} : onClose}>
      {error && <div className="error-msg">{error}</div>}

      <div className="form-group">
        <label>Nom de la commande (sans le /)</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: 'var(--gold)', fontFamily: 'monospace', fontSize: 16 }}>/</span>
          <input
            type="text"
            value={name}
            autoFocus
            placeholder="taverne, combat, boss…"
            style={{ flex: 1, textTransform: 'lowercase' }}
            onChange={(e) => setName(e.target.value.toLowerCase())}
          />
        </div>
        {name.trim() !== '' && !nameValid && (
          <p className="hint" style={{ color: 'var(--red)' }}>
            a-z 0-9 - _ uniquement, max 32 caractères, pas d'espace ni accent
          </p>
        )}
      </div>

      <div className="form-group">
        <label>Description (visible sur Discord)</label>
        <input
          type="text"
          value={description}
          placeholder="Lance l'ambiance de la taverne"
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div className="form-group">
        <label>Playlist à lancer</label>
        <select value={playlistId} onChange={(e) => setPlaylistId(e.target.value)} style={{ width: '100%' }}>
          {playlists.length === 0 && <option value="">— aucune playlist —</option>}
          {playlists.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      <div className="toggle-row">
        <label>Loop — rejouer en boucle</label>
        <span className="toggle">
          <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} />
          <span className="slider" onClick={() => setLoop((v) => !v)} />
        </span>
      </div>

      <div className="toggle-row">
        <label>Shuffle — ordre aléatoire</label>
        <span className="toggle">
          <input type="checkbox" checked={shuffle} onChange={(e) => setShuffle(e.target.checked)} />
          <span className="slider" onClick={() => setShuffle((v) => !v)} />
        </span>
      </div>

      <div className="form-group" style={{ marginTop: 10 }}>
        <label>Volume — <strong style={{ color: 'var(--gold-soft)' }}>{volume}%</strong></label>
        <input
          type="range"
          min="1"
          max="100"
          value={volume}
          style={{ '--val': `${volume}%` }}
          onChange={(e) => setVolume(+e.target.value)}
        />
      </div>

      <div className="form-group">
        <label>Rôles autorisés (optionnel, séparés par des virgules)</label>
        <input
          type="text"
          value={rolesText}
          placeholder="MJ, Player"
          onChange={(e) => setRolesText(e.target.value)}
        />
        <p className="hint">Vide = tout le monde peut utiliser la commande.</p>
      </div>

      <div className="actions">
        <button className="btn" onClick={onClose} disabled={busy}>Annuler</button>
        <button className="btn primary" onClick={go} disabled={busy || !nameValid || !playlistId}>
          {busy ? 'Synchronisation…' : cmd ? 'Enregistrer' : 'Créer la commande'}
        </button>
      </div>
    </Modal>
  );
}
