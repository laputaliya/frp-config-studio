import React, { useEffect, useRef } from 'react';

export default function ConfirmModal({ show, title, message, onConfirm, onCancel }) {
  const confirmBtnRef = useRef(null);

  useEffect(() => {
    if (show) {
      // 延迟聚焦，确保 Modal 已渲染
      setTimeout(() => confirmBtnRef.current?.focus(), 100);
    }
  }, [show]);

  if (!show) return null;

  return (
    <>
      <div className="modal-backdrop fade show" />
      <div className="modal fade show d-block" tabIndex="-1">
        <div className="modal-dialog modal-dialog-centered">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">{title}</h5>
              <button type="button" className="btn-close" onClick={onCancel} />
            </div>
            <div className="modal-body">
              <p>{message}</p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={onCancel}>
                取消
              </button>
              <button className="btn btn-danger" onClick={onConfirm} ref={confirmBtnRef}>
                确定
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
