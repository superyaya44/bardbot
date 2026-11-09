import React, { useCallback, useEffect, useState } from 'react';
import { ApiProvider, useApi } from './api.jsx';
import Playlists from './components/Playlists.jsx';
import PlaylistDetail from './components/PlaylistDetail.jsx';
import Commands from './components/Commands.jsx';

function HealthDot() {
  const [state, setState] = useState('wait'); // wait | ok | ko
  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const r = await fetch('/api/health');
        const d = await r.json();
        if (alive) setState(d.ok && d.bot ? 'ok' : 'ko');
      } catch {
        if (alive) setState('ko');
      }
    };
    check();
    const iv = setInterval(check, 30000);
    return () => { alive = false; clearInterval(iv); };
  }, []);
  return (
    <span className="health-dot">
      <span className={`dot ${state === 'wait' ? '' : state}`} />
      {state === 'ok' ? 'Bot en ligne' : state === 'ko' ? 'Bot hors ligne' : '…'}
    </span>
  );
}

// Les cookies YouTube meurent en silence : le backend sonde vraiment yt-dlp
// plutôt que de se fier à la présence d'un fichier.
function CookieDot() {
  const { toast } = useApi();
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (force) => {
    setBusy(true);
    const wasKo = st && !st.ok; // transition rouge → vert ?
    try {
      const r = await fetch(`/api/cookies${force ? '?force=1' : ''}`);
      const d = await r.json();
      setSt(d);
      // Le backend a relancé tous les tracks en erreur au moment du passage au vert
      if (force && wasKo && d.ok && d.auto_retried > 0)
        toast(`Cookies OK — ${d.auto_retried} morceau${d.auto_retried > 1 ? 'x' : ''} en erreur${d.auto_retried > 1 ? 's' : ''} relancé${d.auto_retried > 1 ? 's' : ''}`);
    } catch {
      setSt({ ok: false, detail: 'Dashboard injoignable' });
    } finally {
      setBusy(false);
    }
  }, [st, toast]);

  useEffect(() => {
    load();
    const iv = setInterval(() => load(), 5 * 60 * 1000);
    return () => clearInterval(iv);
  }, [load]);

  const refresh = async () => {
    setBusy(true);
    try {
      const r = await fetch('/api/cookies/refresh', { method: 'POST' });
      const d = await r.json();
      setSt(d);
      if (d.warning) toast(d.warning, 'error');
      else if (d.ok) toast('Cookies rafraîchis — session YouTube valide');
      else toast(`Toujours KO : ${d.detail}`, 'error');
    } catch {
      toast('Échec du rafraîchissement', 'error');
    } finally {
      setBusy(false);
    }
  };

  const state = st ? (st.ok ? 'ok' : 'ko') : 'wait';
  const label = busy ? 'Vérification…' : state === 'ok' ? 'Cookies à jour' : state === 'ko' ? 'Cookies KO' : '…';

  return (
    <span className="health-dot">
      <span className={`dot ${state === 'wait' ? '' : state}`} />
      <button
        type="button"
        className="dot-label"
        onClick={() => load(true)}
        disabled={busy}
        title={st ? `${st.detail}${st.source ? ` · source : ${st.source}` : ''} — cliquer pour revérifier` : 'Vérification en cours…'}
      >
        {label}
      </button>
      {state === 'ko' && !busy && (
        <button type="button" className="btn sm" onClick={refresh} title="Fait visiter YouTube au browser pour renouveler la session, puis revérifie">
          ↻ Rafraîchir
        </button>
      )}
    </span>
  );
}

function App() {
  const [tab, setTab] = useState('playlists');
  const [openPlaylist, setOpenPlaylist] = useState(null);

  return (
    <>
      <header className="topbar">
        <span className="logo">🎵</span>
        <h1>Bardbot <span>— la taverne du barde</span></h1>
        <nav className="nav-tabs">
          <button className={`nav-tab ${tab === 'playlists' ? 'active' : ''}`} onClick={() => { setTab('playlists'); setOpenPlaylist(null); }}>
            Playlists
          </button>
          <button className={`nav-tab ${tab === 'commands' ? 'active' : ''}`} onClick={() => setTab('commands')}>
            Commandes
          </button>
          <button className={`nav-tab ${tab === 'wiki' ? 'active' : ''}`} onClick={() => setTab('wiki')}>
            📖 Wiki
          </button>
        </nav>
        <span className="spacer" />
        <HealthDot />
        <CookieDot />
      </header>

      {tab === 'playlists' && !openPlaylist && (
        <Playlists onOpen={setOpenPlaylist} />
      )}
      {tab === 'playlists' && openPlaylist && (
        <PlaylistDetail playlist={openPlaylist} onBack={() => setOpenPlaylist(null)} />
      )}
      {tab === 'commands' && <Commands />}
      {tab === 'wiki' && (
        <div className="page">
          <iframe
            src="/WIKI.html"
            title="Wiki Bardbot"
            style={{ width: '100%', height: 'calc(100vh - 140px)', border: '1px solid var(--border)', borderRadius: '8px', background: '#1a1410' }}
          />
        </div>
      )}
    </>
  );
}

export default function Root() {
  return (
    <ApiProvider>
      <App />
    </ApiProvider>
  );
}
