import React, { useEffect, useState } from 'react';
import Modal from './Modal.jsx';
import { useApi } from '../api.jsx';

export default function ConfirmModal({ title, message, confirmLabel = 'Supprimer', onConfirm, onClose, children }) {
  const { req } = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const go = async () => {
    setBusy(true);
    setError('');
    try {
      await onConfirm(req);
      onClose();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <Modal title={title} onClose={onClose}>
      {error && <div className="error-msg">{error}</div>}
      <p style={{ margin: '0 0 6px', color: 'var(--text)' }}>{message}</p>
      {children}
      <div className="actions">
        <button className="btn" onClick={onClose} disabled={busy}>Annuler</button>
        <button className="btn danger" onClick={go} disabled={busy}>
          {busy ? '…' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
