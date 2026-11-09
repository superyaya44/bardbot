import React, { useState } from 'react';
import Modal from './Modal.jsx';
import { useApi } from '../api.jsx';

export default function PlaylistModal({ pl, onClose }) {
  const { req, toast } = useApi();
  const [name, setName] = useState(pl?.name || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const go = async () => {
    if (!name.trim()) return setError('Le nom est requis');
    setBusy(true);
    setError('');
    try {
      if (pl) {
        await req(`/api/playlists/${pl.id}`, { method: 'PATCH', body: { name: name.trim() } });
        toast('Playlist renommée');
      } else {
        await req('/api/playlists', { method: 'POST', body: { name: name.trim() } });
        toast('Playlist créée');
      }
      onClose();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <Modal title={pl ? 'Renommer la playlist' : 'Nouvelle playlist'} onClose={busy ? () => {} : onClose}>
      {error && <div className="error-msg">{error}</div>}
      <div className="form-group">
        <label>Nom de la playlist</label>
        <input
          type="text"
          value={name}
          autoFocus
          placeholder="Ambiance Test, Combat Épique…"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && go()}
        />
      </div>
      <div className="actions">
        <button className="btn" onClick={onClose} disabled={busy}>Annuler</button>
        <button className="btn primary" onClick={go} disabled={busy}>
          {busy ? '…' : pl ? 'Renommer' : 'Créer'}
        </button>
      </div>
    </Modal>
  );
}
