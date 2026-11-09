import React, { useCallback, useEffect, useState } from 'react';
import { useApi } from '../api.jsx';
import CommandModal from './CommandModal.jsx';
import ConfirmModal from './ConfirmModal.jsx';

export default function Commands() {
  const { req, toast } = useApi();
  const [commands, setCommands] = useState(null);
  const [playlists, setPlaylists] = useState([]);
  const [modal, setModal] = useState(null); // {type:'new'} | {type:'edit', cmd} | {type:'delete', cmd}
  const [stats, setStats] = useState(null);

  const load = useCallback(async () => {
    try {
      const [cmds, pls, st] = await Promise.all([
        req('/api/commands'),
        req('/api/playlists'),
        req('/api/stats'),
      ]);
      setCommands(cmds);
      setPlaylists(pls);
      setStats(st);
    } catch (e) {
      toast(e.message, 'error');
    }
  }, [req, toast]);

  useEffect(() => { load(); }, [load]);

  const parseRoles = (s) => {
    try { return JSON.parse(s || '[]'); } catch { return []; }
  };

  if (!commands) return <div className="loading">Chargement…</div>;

  return (
    <div className="page">
      <div className="page-head">
        <h2>Commandes</h2>
        <button className="btn primary" onClick={() => setModal({ type: 'new' })}>＋ Nouvelle commande</button>
      </div>

      {commands.length === 0 ? (
        <div className="empty">
          <div className="big">🪕</div>
          <p>Aucune commande custom.</p>
          <p>Crée des slash commands qui lancent tes playlists en un clic.</p>
        </div>
      ) : (
        <div className="cmd-list">
          {commands.map((c) => (
            <div key={c.id} className="cmd-row">
              <span className="cmd-slash">/{c.name}</span>
              <div className="info">
                <div className="desc">{c.description}</div>
                <div className="tags">
                  <span className="tag playlist">♪ {c.playlist_name}</span>
                  <span className={`tag ${c.loop ? 'on' : ''}`}>Loop {c.loop ? 'ON' : 'OFF'}</span>
                  <span className={`tag ${c.shuffle ? 'on' : ''}`}>Shuffle {c.shuffle ? 'ON' : 'OFF'}</span>
                  <span className="tag on">Vol {c.volume}%</span>
                  {parseRoles(c.allowed_roles).length > 0 && (
                    <span className="tag">🔒 {parseRoles(c.allowed_roles).join(', ')}</span>
                  )}
                </div>
              </div>
              <button className="icon-btn" title="Modifier" onClick={() => setModal({ type: 'edit', cmd: c })}>✎</button>
              <button className="icon-btn danger" title="Supprimer" onClick={() => setModal({ type: 'delete', cmd: c })}>🗑</button>
            </div>
          ))}
        </div>
      )}

      {stats && (
        <div className="stats-bar">
          <span>💾 Disque audio : <strong>{(stats.bytes / 1024 / 1024).toFixed(1)} Mo</strong></span>
          <span>🎵 Fichiers : <strong>{stats.files}</strong></span>
          <span>📋 Commandes : <strong>{commands.length}</strong></span>
        </div>
      )}

      {modal?.type === 'new' && (
        <CommandModal playlists={playlists} onClose={() => { setModal(null); load(); }} />
      )}
      {modal?.type === 'edit' && (
        <CommandModal playlists={playlists} cmd={modal.cmd} onClose={() => { setModal(null); load(); }} />
      )}
      {modal?.type === 'delete' && (
        <ConfirmModal
          title="Supprimer la commande"
          message={`Supprimer /${modal.cmd.name} ? Elle disparaîtra de Discord immédiatement.`}
          onClose={() => { setModal(null); load(); }}
          onConfirm={async (req) => {
            await req(`/api/commands/${modal.cmd.id}`, { method: 'DELETE' });
            toast(`Commande /${modal.cmd.name} supprimée`);
          }}
        />
      )}
    </div>
  );
}
