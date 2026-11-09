import React, { createContext, useCallback, useContext, useState } from 'react';

const ApiCtx = createContext(null);

export const useApi = () => useContext(ApiCtx);

export function ApiProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const toast = useCallback((msg, type = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3800);
  }, []);

  const req = useCallback(async (url, opts = {}) => {
    const r = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    let data = null;
    try { data = await r.json(); } catch { /* 204 ou vide */ }
    if (!r.ok) throw new Error(data?.error || `Erreur ${r.status}`);
    return data;
  }, []);

  return (
    <ApiCtx.Provider value={{ req, toast }}>
      {children}
      <div className="toast-zone">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type === 'error' ? 'error' : ''}`}>
            <span>{t.type === 'error' ? '⚠️' : '✓'}</span>
            <span>{t.msg}</span>
          </div>
        ))}
      </div>
    </ApiCtx.Provider>
  );
}
