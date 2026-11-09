import React, { useCallback, useEffect, useState } from 'react';
import { useApi } from '../api.jsx';
import PlaylistModal from './PlaylistModal.jsx';
import ConfirmModal from './ConfirmModal.jsx';

const fmtBytes = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} Go` : `${Math.round(b / 1e6)} Mo`);

export default function Playlists({ onOpen }) {
  const { req, toast } = useApi();
  const [playlists, setPlaylists] = useState(null);
  const [commands, setCommands] = useState([]);
  const [stats, setStats] = useState(null);
  const [cleaning, setCleaning] = useState(false);
  const [modal, setModal] = useState(null); // {type:'new'|'rename', pl} | {type:'delete', pl}

  const load = useCallback(async () => {
    try {
      const [pls, cmds, st] = await Promise.all([
        req('/api/playlists'), req('/api/commands'), req('/api/stats'),
      ]);
      setPlaylists(pls);
      setCommands(cmds);
      setStats(st);
    } catch (e) {
      toast(e.message, 'error');
    }
  }, [req, toast]);

  const cleanup = async () => {
    setCleaning(true);
    try {
      const r = await req('/api/audio/cleanup', { method: 'POST' });
      toast(r.removed
        ? `${r.removed} fichier(s) fantôme(s) supprimé(s) — ${fmtBytes(r.bytes)} récupérés`
        : 'Aucun fichier fantôme');
      load();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setCleaning(false);
    }
  };

  useEffect(() => { load(); }, [load]);

  // rafraîchit les compteurs pending toutes les 4s (downloads en cours)
  useEffect(() => {
    const iv = setInterval(load, 4000);
    return () => clearInterval(iv);
  }, [load]);

  if (!playlists) return <div className="loading">Chargement de la taverne…</div>;

  return (
    <div className="page">
      <div className="page-head">
        <h2>Playlists</h2>
        <button className="btn primary" onClick={() => setModal({ type: 'new' })}>＋ Nouvelle playlist</button>
      </div>

      {playlists.length === 0 ? (
        <div className="empty">
          <div className="big">🎻</div>
          <p>La taverne est vide.</p>
          <p>Crée ta première playlist pour commencer.</p>
        </div>
      ) : (
        <div className="grid">
          {playlists.map((pl) => (
            <div key={pl.id} className="card playlist-card">
              <h3 onClick={() => onOpen(pl)}>{pl.name}</h3>
              <div className="meta">
                <span>🎵 {pl.track_count ?? '—'} morceaux</span>
                {pl.pending_count > 0 && (
                  <span className="badge-pending">⏳ {pl.pending_count} en téléchargement</span>
                )}
              </div>
              <div className="actions">
                <button className="btn sm" onClick={() => onOpen(pl)}>Ouvrir</button>
                <button className="btn sm ghost" onClick={() => setModal({ type: 'rename', pl })}>Renommer</button>
                <button className="icon-btn danger" title="Supprimer"
                  onClick={() => setModal({ type: 'delete', pl })}>🗑</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {stats && (
        <div className="disk-bar">
          <span>💾 {stats.files} fichier(s) audio · {fmtBytes(stats.bytes)}</span>
          <button className="btn sm ghost" onClick={cleanup} disabled={cleaning}
            title="Supprime les fichiers audio dont le morceau n'existe plus en base">
            {cleaning ? 'Nettoyage…' : '🧹 Nettoyer'}
          </button>
        </div>
      )}

      {modal?.type === 'new' && (
        <PlaylistModal onClose={() => { setModal(null); load(); }} />
      )}
      {modal?.type === 'rename' && (
        <PlaylistModal pl={modal.pl} onClose={() => { setModal(null); load(); }} />
      )}
      {modal?.type === 'delete' && (
        <ConfirmModal
          title="Supprimer la playlist"
          message={`Supprimer « ${modal.pl.name} » ? Les morceaux et fichiers audio associés seront perdus.`}
          onClose={() => { setModal(null); load(); }}
          onConfirm={async (req) => {
            await req(`/api/playlists/${modal.pl.id}`, { method: 'DELETE' });
            toast(`Playlist « ${modal.pl.name} » supprimée`);
          }}
        >
          {(() => {
            const linked = commands.filter((c) => c.playlist_id === modal.pl.id);
            if (linked.length === 0) return null;
            return (
              <div className="warn-box">
                <strong>
                  {linked.length === 1
                    ? 'Cette commande Discord sera supprimée aussi :'
                    : `Ces ${linked.length} commandes Discord seront supprimées aussi :`}
                </strong>
                <ul>
                  {linked.map((c) => <li key={c.id}><code>/{c.name}</code></li>)}
                </ul>
                Tes joueurs ne pourront plus les lancer.
              </div>
            );
          })()}
        </ConfirmModal>
      )}
    </div>
  );
}
