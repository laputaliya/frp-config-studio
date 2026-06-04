import React from 'react';

export default function EmptyState({ icon = '📦', message, actionLabel, onAction }) {
  return (
    <div className="text-center py-5">
      <div style={{ fontSize: '3rem' }}>{icon}</div>
      <p className="text-muted mt-3 fs-5">{message}</p>
      {actionLabel && onAction && (
        <button className="btn btn-primary" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}
