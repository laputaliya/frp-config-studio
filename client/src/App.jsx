import React, { useState, useEffect, useCallback } from 'react';
import { ToastProvider } from './components/ToastContext';
import LoginPage from './pages/LoginPage';
import HomePage from './pages/HomePage';
import BinaryManager from './pages/BinaryManager';
import ServerConfig from './pages/ServerConfig';
import ClientConfig from './pages/ClientConfig';
import RemoteManager from './pages/RemoteManager';
import UserManager from './pages/UserManager';
import './admin.css';

// 菜单结构：支持分组和子菜单
const MENU_GROUPS = [
  {
    key: 'frp', label: 'FRP 管理', icon: 'bi-gear-wide-connected', defaultOpen: true,
    children: [
      { key: 'binary', label: '程序包管理', icon: 'bi-box-seam' },
      { key: 'server', label: '服务端配置', icon: 'bi-hdd-rack' },
      { key: 'client', label: '客户端配置', icon: 'bi-pc-display' },
      { key: 'remote', label: '远程管理',   icon: 'bi-globe2' },
    ],
  },
  {
    key: 'system', label: '系统管理', icon: 'bi-tools',
    children: [
      { key: 'users', label: '用户管理', icon: 'bi-people' },
    ],
  },
];

// 所有可打开的页面
const PAGES = {
  home:    { title: '首页',           icon: 'bi-house',         component: HomePage },
  binary:  { title: '程序包管理',    icon: 'bi-box-seam',      component: BinaryManager },
  server:  { title: '服务端配置',      icon: 'bi-hdd-rack',      component: ServerConfig },
  client:  { title: '客户端配置',      icon: 'bi-pc-display',    component: ClientConfig },
  remote:  { title: '远程服务端管理',  icon: 'bi-globe2',        component: RemoteManager },
  users:   { title: '用户管理',        icon: 'bi-people',        component: UserManager },
};

export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [openGroups, setOpenGroups] = useState({ frp: true });
  const [tabs, setTabs] = useState([{ key: 'home', label: '首页', icon: 'bi-house' }]);
  const [activeTab, setActiveTab] = useState('home');

  // 启动时检查登录态
  useEffect(() => {
    const token = localStorage.getItem('token');
    const cached = localStorage.getItem('user');
    if (!token) { setAuthLoading(false); return; }
    fetch('/api/auth/me', { headers: { 'Authorization': `Bearer ${token}` } })
      .then((r) => r.json())
      .then((data) => {
        if (data.username) setUser(data);
        else { localStorage.removeItem('token'); localStorage.removeItem('user'); }
      })
      .catch(() => {})
      .finally(() => setAuthLoading(false));
  }, []);

  const handleLogin = (data) => setUser(data);

  const handleLogout = async () => {
    const token = localStorage.getItem('token');
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
  };

  const toggleGroup = (key) => {
    setOpenGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const openPage = useCallback((key) => {
    if (!PAGES[key]) return;
    const page = PAGES[key];
    // 如果 tab 已存在，切换到它
    const existing = tabs.find((t) => t.key === key);
    if (existing) {
      setActiveTab(key);
      return;
    }
    // 否则新建 tab
    const newTab = { key, label: page.title, icon: page.icon };
    setTabs((prev) => [...prev, newTab]);
    setActiveTab(key);
  }, [tabs]);

  const closeTab = useCallback((key) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.key === key);
      const next = prev.filter((t) => t.key !== key);
      if (key === activeTab && next.length > 0) {
        const newIdx = Math.min(idx, next.length - 1);
        setActiveTab(next[newIdx].key);
      }
      return next;
    });
  }, [activeTab]);

  const ActiveComponent = PAGES[activeTab]?.component || HomePage;

  if (authLoading) {
    return <div className="d-flex align-items-center justify-content-center" style={{ minHeight: '100vh' }}><div className="spinner-border text-primary" /></div>;
  }

  if (!user) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return (
    <ToastProvider>
      <div className="admin-wrapper">
        {/* ── 可折叠侧边栏 ── */}
        <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
          <div className="sidebar-brand" onClick={() => setCollapsed(!collapsed)} style={{ cursor: 'pointer' }}>
            <i className="bi bi-gear-wide-connected"></i>
            {!collapsed && <span>FRP 配置工坊</span>}
          </div>
          <nav className="sidebar-nav">
            {/* 首页快捷入口 */}
            <button className={`sidebar-item single ${activeTab === 'home' ? 'active' : ''}`}
              onClick={() => { openPage('home'); }}>
              <i className="bi bi-house"></i>
              {!collapsed && <span>首页</span>}
            </button>

            {/* 分组菜单 */}
            {MENU_GROUPS.map((group) => (
              <div key={group.key} className="sidebar-group">
                <button className="sidebar-group-title"
                  onClick={() => toggleGroup(group.key)}>
                  <i className={`bi ${group.icon}`}></i>
                  {!collapsed && (
                    <>
                      <span>{group.label}</span>
                      <i className={`bi bi-chevron-${openGroups[group.key] ? 'down' : 'right'} ms-auto`}></i>
                    </>
                  )}
                </button>
                {(openGroups[group.key] || collapsed) && group.children.map((child) => (
                  <button key={child.key}
                    className={`sidebar-item sub ${activeTab === child.key ? 'active' : ''}`}
                    onClick={() => openPage(child.key)}>
                    <i className={`bi ${child.icon}`}></i>
                    {!collapsed && <span>{child.label}</span>}
                  </button>
                ))}
              </div>
            ))}
          </nav>

          {/* 底部折叠按钮 */}
          <button className="sidebar-collapse-btn" onClick={() => setCollapsed(!collapsed)}>
            <i className={`bi bi-chevron-${collapsed ? 'right' : 'left'}`}></i>
          </button>
        </aside>

        {/* ── 主内容区 ── */}
        <main className="main-area">
          {/* 顶部栏 + Tabs */}
          <div className="top-bar" style={{ height: 'auto', paddingTop: 8, paddingBottom: 0, flexDirection: 'column', alignItems: 'stretch' }}>
            <div className="d-flex align-items-center justify-content-between" style={{ height: 40 }}>
              <div className="top-bar-title">
                <i className={`bi ${PAGES[activeTab]?.icon || 'bi-house'}`}></i>
                {PAGES[activeTab]?.title || '首页'}
              </div>
              <div className="d-flex align-items-center gap-2">
                <small className="text-muted">
                  <i className="bi bi-person-circle me-1"></i>{user.username}
                  {user.role === 'admin' && <span className="badge bg-danger ms-1" style={{ fontSize: 10 }}>管理员</span>}
                </small>
                <button className="btn btn-sm btn-outline-secondary" onClick={handleLogout}>
                  <i className="bi bi-box-arrow-right"></i> 退出
                </button>
              </div>
            </div>
            {/* Tab 栏 */}
            <div className="tab-bar">
              {tabs.map((tab) => (
                <div key={tab.key} className={`tab-item ${activeTab === tab.key ? 'active' : ''}`}
                  onClick={() => setActiveTab(tab.key)}>
                  <i className={`bi ${tab.icon} me-1`}></i>
                  <span>{tab.label}</span>
                  {tab.key !== 'home' && (
                    <i className="bi bi-x tab-close"
                      onClick={(e) => { e.stopPropagation(); closeTab(tab.key); }}></i>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* 内容区 */}
          <div className="content-area">
            <ActiveComponent
              onNavigate={(key) => openPage(key)}
            />
          </div>
        </main>
      </div>
    </ToastProvider>
  );
}
