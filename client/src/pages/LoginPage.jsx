import React, { useState } from 'react';

export default function LoginPage({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username || !password) { setError('请输入用户名和密码'); return; }
    setLoading(true);
    setError('');
    try {
      const resp = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await resp.json();
      if (resp.ok) {
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify({ username: data.username, role: data.role }));
        onLogin(data);
      } else {
        setError(data.error || '登录失败');
      }
    } catch (_) {
      setError('网络错误，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="d-flex align-items-center justify-content-center" style={{ minHeight: '100vh', background: '#f1f5f9' }}>
      <div className="card shadow-sm" style={{ width: 380 }}>
        <div className="card-body p-4">
          <div className="text-center mb-4">
            <div style={{ fontSize: 40 }}>⚙️</div>
            <h5 className="mt-2">FRP 配置工坊</h5>
            <small className="text-muted">请登录以继续</small>
          </div>
          <form onSubmit={handleSubmit}>
            {error && <div className="alert alert-danger py-2 small">{error}</div>}
            <div className="mb-3">
              <label className="form-label small">用户名</label>
              <input className="form-control" autoFocus value={username}
                onChange={(e) => setUsername(e.target.value)} placeholder="admin" />
            </div>
            <div className="mb-3">
              <label className="form-label small">密码</label>
              <input type="password" className="form-control" value={password}
                onChange={(e) => setPassword(e.target.value)} placeholder="admin" />
            </div>
            <button className="btn btn-primary w-100" disabled={loading}>
              {loading ? <><span className="spinner-border spinner-border-sm me-1" />登录中...</> : '登录'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
