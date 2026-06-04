import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../api';
import { useToast } from '../components/ToastContext';
import ConfirmModal from '../components/ConfirmModal';

const USERS_FILE = '/api/users';

export default function UserManager() {
  const [users, setUsers] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [form, setForm] = useState({ username: '', password: '', role: 'user' });
  const [loading, setLoading] = useState(true);
  const [confirm, setConfirm] = useState({ show: false, title: '', message: '', onConfirm: null });
  const { showToast } = useToast();

  // 注意：这只是一个简单的本地用户管理演示
  // 生产环境请使用数据库 + 密码哈希

  const fetchUsers = useCallback(async () => {
    try {
      const resp = await apiFetch(USERS_FILE);
      setUsers(await resp.json());
    } catch (_) {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const handleSave = async () => {
    if (!form.username || !form.password) { showToast('用户名和密码为必填项', 'error'); return; }
    try {
      const resp = await apiFetch(USERS_FILE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await resp.json();
      if (resp.ok) {
        showToast(editingUser ? '用户已更新' : '用户已创建');
        setShowForm(false);
        setForm({ username: '', password: '', role: 'user' });
        setEditingUser(null);
        await fetchUsers();
      } else { showToast(data.error, 'error'); }
    } catch (e) { showToast(e.message, 'error'); }
  };

  const handleEdit = (user) => {
    setForm({ username: user.username, password: '', role: user.role || 'user' });
    setEditingUser(user.username);
    setShowForm(true);
  };

  const handleDelete = (username) => {
    setConfirm({
      show: true, title: '删除用户',
      message: `确定删除用户「${username}」吗？`,
      onConfirm: async () => {
        await apiFetch(`${USERS_FILE}/${encodeURIComponent(username)}`, { method: 'DELETE' });
        showToast('用户已删除');
        await fetchUsers();
        setConfirm({ show: false, title: '', message: '', onConfirm: null });
      },
    });
  };

  if (loading) return <div className="text-center py-5"><div className="spinner-border text-primary" /></div>;

  return (
    <div className="row">
      <div className="col-lg-8">
        <div className="card">
          <div className="card-header d-flex justify-content-between align-items-center">
            <span><i className="bi bi-people me-1"></i>系统用户</span>
            <button className="btn btn-primary btn-sm" onClick={() => { setForm({ username: '', password: '', role: 'user' }); setEditingUser(null); setShowForm(true); }}>
              <i className="bi bi-plus-lg"></i> 添加用户
            </button>
          </div>
          <div className="card-body p-0">
            {users.length === 0 ? (
              <div className="text-center py-4 text-muted small">暂无用户</div>
            ) : (
              <table className="table table-hover mb-0">
                <thead><tr><th>用户名</th><th>角色</th><th>创建时间</th><th>操作</th></tr></thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.username}>
                      <td><strong>{u.username}</strong></td>
                      <td><span className={`badge ${u.role === 'admin' ? 'bg-danger' : 'bg-secondary'}`}>{u.role}</span></td>
                      <td><small className="text-muted">{u.createdAt ? new Date(u.createdAt).toLocaleString('zh-CN') : '-'}</small></td>
                      <td>
                        <button className="btn btn-sm btn-outline-secondary me-1" onClick={() => handleEdit(u)}><i className="bi bi-pencil"></i></button>
                        <button className="btn btn-sm btn-outline-danger" onClick={() => handleDelete(u.username)}><i className="bi bi-trash"></i></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {showForm && (<>
        <div className="modal-backdrop fade show" />
        <div className="modal fade show d-block">
          <div className="modal-dialog modal-dialog-centered"><div className="modal-content">
            <div className="modal-header"><h5 className="modal-title">{editingUser ? '编辑用户' : '添加用户'}</h5><button className="btn-close" onClick={() => setShowForm(false)} /></div>
            <div className="modal-body">
              <div className="mb-3"><label className="form-label">用户名</label><input className="form-control" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} disabled={!!editingUser} /></div>
              <div className="mb-3"><label className="form-label">{editingUser ? '新密码（留空则不修改）' : '密码'}</label><input type="password" className="form-control" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
              <div className="mb-3"><label className="form-label">角色</label><select className="form-select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}><option value="admin">管理员</option><option value="user">普通用户</option></select></div>
            </div>
            <div className="modal-footer"><button className="btn btn-secondary" onClick={() => setShowForm(false)}>取消</button><button className="btn btn-primary" onClick={handleSave}>保存</button></div>
          </div></div>
        </div>
      </>)}

      <ConfirmModal show={confirm.show} title={confirm.title} message={confirm.message}
        onConfirm={confirm.onConfirm} onCancel={() => setConfirm({ show: false, title: '', message: '', onConfirm: null })} />
    </div>
  );
}
