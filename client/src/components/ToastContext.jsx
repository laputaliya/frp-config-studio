import React, { createContext, useContext, useState, useCallback } from 'react';

const ToastContext = createContext(null);

let toastId = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const showToast = useCallback((message, type = 'success') => {
    const id = ++toastId;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="toast-container position-fixed bottom-0 end-0 p-3">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`toast show align-items-center text-bg-${toast.type === 'success' ? 'success' : 'danger'} border-0`}
            role="alert"
          >
            <div className="d-flex">
              <div className="toast-body">
                {toast.type === 'success' ? '✓ ' : '✗ '}
                {toast.message}
              </div>
              <button
                type="button"
                className="btn-close btn-close-white me-2 m-auto"
                onClick={() => removeToast(toast.id)}
              />
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast 必须在 ToastProvider 内使用');
  return ctx;
}
