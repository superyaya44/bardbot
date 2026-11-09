import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from '../api.jsx';
import ConfirmModal from './ConfirmModal.jsx';
import Modal from './Modal.jsx';

// Traduit le charabia yt-dlp en cause lisible pour le MJ
function explainError(e = '') {
  const s = e.toLowerCase();
  if (s.includes('video unavailable')) return 'Vidéo indisponible — supprimée de YouTube ou bloquée dans notre région. Rien à récupérer : remplace le morceau.';
  if (s.includes('private video')) return 'Vidéo privée — le propriétaire a restreint l\'accès. Il faut une autre source.';
  if (s.includes('members-only') || s.includes('join this channel')) return 'Vidéo réservée aux membres de la chaîne.';
  if (s.includes('age') && s.includes('confirm')) return 'Vidéo soumise à restriction d\'âge — la session YouTube du bot ne peut pas la lire.';
  if (s.includes('sign in') || s.includes('login_required') || s.includes('not a bot') || s.includes('from-browser or --cookies'))
    return 'Session YouTube expirée au moment du téléchargement. Clique « Cookies KO → Rafraîchir » en haut, puis « Tout relancer ».';
  if (s.includes('timed out') || s.includes('timeout') || s.includes('socket')) return 'Timeout réseau vers YouTube — probablement passager, réessaie.';
  if (s.includes('challenge') || s.includes('needs to be reloaded')) return 'Challenge anti-bot YouTube non résolu (provider POT injoignable ?).';
  if (s.includes('unavailable') || s.includes('error 404')) return 'Ressource indisponible côté YouTube.';
  return e.split('\n')[0].slice(0, 200) || 'Erreur inconnue';
}

export default function PlaylistDetail({ playlist, onBack, onPlaylistDeleted }) {
  const { req, toast } = useApi();
  const [tracks, setTracks] = useState(null);
  const [query, setQuery] = useState('');
  const [importUrl, setImportUrl] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(null); // track
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);
  const [errDetail, setErrDetail] = useState(null); // track en erreur dont on montre la modal
  const saveTimer = useRef(null);

  const load = useCallback(async () => {
    try {
      setTracks(await req(`/api/playlists/${playlist.id}/tracks`));
    } catch (e) {
      toast(e.message, 'error');
    }
  }, [req, toast, playlist.id]);

  useEffect(() => { load(); }, [load]);

  // polling pendant les downloads
  const hasPending = tracks?.some((t) => t.status === 'pending');
  useEffect(() => {
    if (!hasPending) return;
    const iv = setInterval(load, 2500);
    return () => clearInterval(iv);
  }, [hasPending, load]);

  const addTrack = async () => {
    if (!query.trim()) return;
    setBusy(true);
    try {
      const t = await req(`/api/playlists/${playlist.id}/tracks`, { method: 'POST', body: { query: query.trim() } });
      toast(`« ${t.title} » ajouté — téléchargement en cours`);
      setQuery('');
      load();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const doImport = async () => {
    if (!importUrl.trim()) return;
    setBusy(true);
    try {
      const r = await req(`/api/playlists/${playlist.id}/import`, { method: 'POST', body: { url: importUrl.trim() } });
      toast(`${r.imported} morceaux importés de « ${r.playlistTitle} »`);
      setImportUrl('');
      setShowImport(false);
      load();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const retry = async (t) => {
    try {
      await req(`/api/tracks/${t.id}/retry`, { method: 'POST' });
      toast('Nouveau téléchargement lancé');
      load();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const retryAll = async () => {
    try {
      const r = await req('/api/tracks/retry-all', { method: 'POST', body: { playlist_id: playlist.id } });
      if (r.retried > 0) toast(`${r.retried} morceau${r.retried > 1 ? 'x' : ''} relancé${r.retried > 1 ? 's' : ''}`);
      else toast('Aucun morceau en erreur', 'info');
      load();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  // ----- drag & drop réordonnancement -----
  const persistOrder = (ordered) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await req(`/api/playlists/${playlist.id}/reorder`, { method: 'POST', body: { orderedIds: ordered.map((t) => t.id) } });
      } catch (e) {
        toast(e.message, 'error');
      }
    }, 350);
  };

  const onDrop = (targetId) => {
    if (dragId == null || dragId === targetId) return reset();
    const list = [...tracks];
    const from = list.findIndex((t) => t.id === dragId);
    const to = list.findIndex((t) => t.id === targetId);
    if (from < 0 || to < 0) return reset();
    const [moved] = list.splice(from, 1);
    list.splice(to, 0, moved);
    setTracks(list);
    persistOrder(list);
    reset();
  };
  const reset = () => { setDragId(null); setOverId(null); };

  const fmtSize = (b) => {
    if (!b) return '';
    const u = ['o', 'Ko', 'Mo', 'Go'];
    let i = 0, v = b;
    while (v >= 1024 && i < 3) { v /= 1024; i++; }
    return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
  };

  const pendingCount = tracks?.filter((t) => t.status === 'pending').length || 0;
  const errCount = tracks?.filter((t) => t.status === 'error').length || 0;

  return (
    <div className="page">
      <div className="detail-head">
        <button className="btn ghost" onClick={onBack}>← Retour</button>
        <h2>{playlist.name}</h2>
        {pendingCount > 0 && <span className="status-pill pending">⏳ {pendingCount} en file</span>}
        {errCount > 0 && (
          <>
            <span className="status-pill error">{errCount} erreur{errCount > 1 ? 's' : ''}</span>
            <button className="btn sm" onClick={retryAll} title="Relance le téléchargement de tous les morceaux en erreur de cette playlist">
              ↻ Tout relancer
            </button>
          </>
        )}
      </div>

      <div className="add-bar">
        <input
          type="text"
          placeholder="URL YouTube ou recherche (« epic medieval music »)…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addTrack()}
          disabled={busy}
        />
        <button className="btn primary" onClick={addTrack} disabled={busy || !query.trim()}>＋ Ajouter</button>
        <button className="btn" onClick={() => setShowImport((v) => !v)}>📥 Importer une playlist YouTube</button>
      </div>

      {showImport && (
        <div className="add-bar">
          <input
            type="url"
            placeholder="https://www.youtube.com/playlist?list=…"
            value={importUrl}
            onChange={(e) => setImportUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && doImport()}
            disabled={busy}
          />
          <button className="btn primary" onClick={doImport} disabled={busy || !importUrl.trim()}>Importer</button>
        </div>
      )}

      {!tracks ? (
        <div className="loading">Chargement…</div>
      ) : tracks.length === 0 ? (
        <div className="empty">
          <div className="big">🎼</div>
          <p>Cette playlist attend ses premiers morceaux.</p>
        </div>
      ) : (
        <div className="track-list">
          {tracks.map((t, i) => (
            <div
              key={t.id}
              className={`track-row ${dragId === t.id ? 'dragging' : ''} ${overId === t.id && dragId !== t.id ? 'drag-over' : ''}`}
              draggable
              onDragStart={() => setDragId(t.id)}
              onDragEnd={reset}
              onDragOver={(e) => { e.preventDefault(); setOverId(t.id); }}
              onDragLeave={() => setOverId((o) => (o === t.id ? null : o))}
              onDrop={(e) => { e.preventDefault(); onDrop(t.id); }}
            >
              <span className="drag-handle" title="Glisser pour réordonner">⋮⋮</span>
              <span className="track-num">{i + 1}</span>
              <span className="track-title" title={t.download_error || t.url}>{t.title}</span>
              {t.duration && <span className="track-duration">{t.duration}</span>}
              {t.status === 'done' && <span className="status-pill done">✓ Prêt</span>}
              {t.status === 'pending' && <span className="status-pill pending">Téléchargement…</span>}
              {t.status === 'error' && (
                <button
                  className="status-pill error err-pill"
                  title="Cliquer pour voir le détail de l'erreur"
                  onClick={() => setErrDetail(t)}
                >
                  Erreur ⚠
                </button>
              )}
              {t.status === 'error' && (
                <button className="btn sm" onClick={() => retry(t)}>↻ Retry</button>
              )}
              <a className="icon-btn" href={t.url} target="_blank" rel="noreferrer" title="Ouvrir sur YouTube">↗</a>
              <button className="icon-btn danger" title="Retirer" onClick={() => setConfirmDel(t)}>🗑</button>
            </div>
          ))}
        </div>
      )}

      {errDetail && (
        <Modal title="Pourquoi ce morceau est en erreur" onClose={() => setErrDetail(null)}>
          <div className="err-detail">
            <p className="err-title">🎼 {errDetail.title}</p>
            <p className="err-cause"><strong>Cause :</strong> {explainError(errDetail.download_error)}</p>
            <details>
              <summary>Message brut de yt-dlp</summary>
              <pre>{errDetail.download_error || '(vide)'}</pre>
            </details>
            <div className="err-actions">
              <a className="btn" href={errDetail.url} target="_blank" rel="noreferrer">↗ Voir sur YouTube</a>
              <button className="btn primary" onClick={() => { retry(errDetail); setErrDetail(null); }}>↻ Réessayer</button>
            </div>
          </div>
        </Modal>
      )}

      {confirmDel && (
        <ConfirmModal
          title="Retirer le morceau"
          message={`Retirer « ${confirmDel.title} » de la playlist ? Le fichier téléchargé sera supprimé.`}
          confirmLabel="Retirer"
          onClose={() => { setConfirmDel(null); load(); }}
          onConfirm={async (req) => {
            await req(`/api/tracks/${confirmDel.id}`, { method: 'DELETE' });
            toast('Morceau retiré');
          }}
        />
      )}
    </div>
  );
}
