import React, { useState, useEffect, useCallback } from 'react';
import { useToast } from '../components/ToastContext';
import { listServerSchemas, loadServerSchema, apiFetch } from '../api';
import '../frp-dashboard.css';

const API = '/api/connections';

export default function RemoteManager() {
  const [connections, setConnections] = useState([]);
  const [activeConn, setActiveConn] = useState(null);
  const [serverInfo, setServerInfo] = useState(null);
  const [proxies, setProxies] = useState([]);
  const [clients, setClients] = useState([]);
  const [clientDetail, setClientDetail] = useState(null);
  const [section, setSection] = useState('overview');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const { showToast } = useToast();

  const fetchConnections = useCallback(async () => {
    try {
      const resp = await apiFetch(API);
      setConnections(await resp.json());
    } catch (_) {}
  }, []);

  useEffect(() => { fetchConnections(); }, [fetchConnections]);

  useEffect(() => {
    if (!activeConn) return;
    const load = async () => {
      setRefreshing(true);
      try {
        const [infoResp, proxyResp, clientResp] = await Promise.all([
          apiFetch(`${API}/${encodeURIComponent(activeConn.id)}/serverinfo`),
          apiFetch(`${API}/${encodeURIComponent(activeConn.id)}/proxies`),
          apiFetch(`${API}/${encodeURIComponent(activeConn.id)}/clients`),
        ]);
        const info = await infoResp.json();
        const proxyData = await proxyResp.json();
        const clientData = await clientResp.json();
        if (info.error) showToast(info.error, 'error'); else setServerInfo(info);
        if (proxyData.error) showToast(proxyData.error, 'error'); else setProxies(proxyData.proxies || []);
        if (clientData.error) showToast(clientData.error, 'error');
        else { const list = Array.isArray(clientData) ? clientData : (clientData.clients || []); setClients(list); }
      } catch (e) { showToast('连接失败: ' + e.message, 'error'); }
      finally { setRefreshing(false); setLoading(false); }
    };
    setLoading(true);
    load();
    const timer = setInterval(load, 10000);
    return () => clearInterval(timer);
  }, [activeConn, showToast]);

  const handleReload = async () => {
    const resp = await apiFetch(`${API}/${encodeURIComponent(activeConn.id)}/reload`);
    const data = await resp.json();
    showToast(data.error || '配置已重载', data.error ? 'error' : 'success');
  };

  const handleClientDetail = async (clientKey) => {
    setClientDetail(null);
    try {
      const resp = await apiFetch(`${API}/${encodeURIComponent(activeConn.id)}/clients/${encodeURIComponent(clientKey)}`);
      const data = await resp.json();
      if (data.error) showToast(data.error, 'error'); else setClientDetail(data);
    } catch (e) { showToast('获取详情失败', 'error'); }
  };

  const formatBytes = (b) => {
    if (!b || b === 0) return '0 B';
    const s = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(b) / Math.log(1024));
    return parseFloat((b / Math.pow(1024, i)).toFixed(1)) + ' ' + s[i];
  };
  const formatTime = (ts) => ts ? new Date(ts * 1000).toLocaleString('zh-CN') : '-';

  const typeCounts = {};
  proxies.forEach((p) => { const t = p.type || 'tcp'; typeCounts[t] = (typeCounts[t] || 0) + 1; });

  const proxyTypes = ['tcp', 'udp', 'http', 'https', 'stcp', 'xtcp'];
  const [proxyFilter, setProxyFilter] = useState('all');
  const filteredProxies = proxyFilter === 'all' ? proxies : proxies.filter((p) => (p.type || 'tcp') === proxyFilter);

  return (
    <div className="frp-dashboard">
      <div className="row">
        {/* 左侧：连接列表 */}
        <div className="col-lg-3 mb-3">
          <div className="frp-panel frp-sidebar-list">
            <div className="frp-panel-header">
              <span><i className="bi bi-server me-1"></i>远程服务端</span>
              <span className="frp-sidebar-badge">来自服务端方案</span>
            </div>
            {connections.length === 0 ? (
              <div className="text-center py-5 text-muted small px-3">
                <i className="bi bi-info-circle d-block mb-2" style={{ fontSize: 28 }}></i>
                暂无可用连接。请在「服务端配置」中创建方案并填写<b>远程服务器地址</b>、<b>管理界面端口</b>、用户名和密码。
              </div>
            ) : (
              connections.map((c) => (
                <div key={c.id} className={`frp-sidebar-item ${activeConn?.id === c.id ? 'active' : ''}`}
                  onClick={() => { setActiveConn(c); setSection('overview'); setClientDetail(null); }}>
                  <div className="dot" />
                  <div className="frp-sidebar-info">
                    <div className="frp-sidebar-name">{c.name}</div>
                    <div className="frp-sidebar-addr">{c.addr}:{c.port}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 右侧：详情 */}
        <div className="col-lg-9">
          {!activeConn ? (
            <div className="text-center py-5 text-muted">
              <i className="bi bi-arrow-left-circle d-block mb-2" style={{ fontSize: 36 }}></i>
              选择左侧的远程服务端查看详情
            </div>
          ) : loading ? (
            <div className="text-center py-5"><div className="spinner-border text-primary" /></div>
          ) : (
            <>
              <div className="frp-category-nav">
                {[
                  { key: 'overview', label: '概览', icon: 'bi-speedometer2' },
                  { key: 'proxies', label: '代理', icon: 'bi-diagram-3', count: proxies.length },
                  { key: 'clients', label: '客户端', icon: 'bi-people', count: clients.length },
                ].map((item) => (
                  <div key={item.key} className={`frp-category-item ${section === item.key ? 'active' : ''}`}
                    onClick={() => setSection(item.key)}>
                    <i className={`bi ${item.icon}`}></i>
                    {item.label}
                    {item.count !== undefined && <span className="count">{item.count}</span>}
                  </div>
                ))}
              </div>

              {section === 'overview' && (
                <>
                  <div className="frp-toolbar">
                    <div className="frp-toolbar-title">
                      <i className="bi bi-hdd-rack"></i> {activeConn.name}
                      <small className="text-muted ms-1">{activeConn.addr}:{activeConn.port}</small>
                      {refreshing && <span className="spinner-border spinner-border-sm text-primary ms-2" />}
                    </div>
                    <button className="frp-btn warning" onClick={handleReload}>
                      <i className="bi bi-arrow-repeat"></i> 重载配置
                    </button>
                  </div>

                  {serverInfo && (
                    <div className="frp-stats-row">
                      <div className="frp-stat-card"><div className="frp-stat-icon blue"><i className="bi bi-cpu"></i></div><div className="frp-stat-info"><div className="frp-stat-label">版本</div><div className="frp-stat-value">{serverInfo.version || '-'}</div></div></div>
                      <div className="frp-stat-card"><div className="frp-stat-icon green"><i className="bi bi-people"></i></div><div className="frp-stat-info"><div className="frp-stat-label">在线客户端</div><div className="frp-stat-value">{serverInfo.clientCounts ?? '-'}</div></div></div>
                      <div className="frp-stat-card"><div className="frp-stat-icon cyan"><i className="bi bi-plug"></i></div><div className="frp-stat-info"><div className="frp-stat-label">当前连接数</div><div className="frp-stat-value">{serverInfo.curConns ?? '-'}</div></div></div>
                      <div className="frp-stat-card"><div className="frp-stat-icon red"><i className="bi bi-broadcast"></i></div><div className="frp-stat-info"><div className="frp-stat-label">绑定端口</div><div className="frp-stat-value">{serverInfo.bindPort || '-'}</div></div></div>
                      <div className="frp-stat-card"><div className="frp-stat-icon orange"><i className="bi bi-arrow-down"></i></div><div className="frp-stat-info"><div className="frp-stat-label">累计流入</div><div className="frp-stat-value">{formatBytes(serverInfo.totalTrafficIn)}</div></div></div>
                      <div className="frp-stat-card"><div className="frp-stat-icon purple"><i className="bi bi-arrow-up"></i></div><div className="frp-stat-info"><div className="frp-stat-label">累计流出</div><div className="frp-stat-value">{formatBytes(serverInfo.totalTrafficOut)}</div></div></div>
                    </div>
                  )}

                  {serverInfo && (
                    <div className="frp-panel mb-3">
                      <div className="frp-panel-header">虚拟主机与高级配置</div>
                      <div className="p-3">
                        <div className="row g-3">
                          <div className="col-sm-4"><div className="frp-stat-label">子域名主机</div><div className="frp-stat-value" style={{fontSize:15}}>{serverInfo.subdomainHost || <span className="text-muted">未设置</span>}</div></div>
                          <div className="col-sm-2"><div className="frp-stat-label">HTTP 端口</div><div className="frp-stat-value" style={{fontSize:15}}>{serverInfo.vhostHTTPPort > 0 ? serverInfo.vhostHTTPPort : <span className="text-muted">未启用</span>}</div></div>
                          <div className="col-sm-2"><div className="frp-stat-label">HTTPS 端口</div><div className="frp-stat-value" style={{fontSize:15}}>{serverInfo.vhostHTTPSPort > 0 ? serverInfo.vhostHTTPSPort : <span className="text-muted">未启用</span>}</div></div>
                          <div className="col-sm-2"><div className="frp-stat-label">KCP 端口</div><div className="frp-stat-value" style={{fontSize:15}}>{serverInfo.kcpBindPort > 0 ? serverInfo.kcpBindPort : <span className="text-muted">未启用</span>}</div></div>
                          <div className="col-sm-2"><div className="frp-stat-label">QUIC 端口</div><div className="frp-stat-value" style={{fontSize:15}}>{serverInfo.quicBindPort > 0 ? serverInfo.quicBindPort : <span className="text-muted">未启用</span>}</div></div>
                        </div>
                        <hr className="my-3"/>
                        <div className="row g-3">
                          <div className="col-sm-3"><div className="frp-stat-label">最大连接池</div><div><strong>{serverInfo.maxPoolCount ?? '-'}</strong></div></div>
                          <div className="col-sm-3"><div className="frp-stat-label">每客户端最大端口数</div><div><strong>{serverInfo.maxPortsPerClient > 0 ? serverInfo.maxPortsPerClient : '不限制'}</strong></div></div>
                          <div className="col-sm-3"><div className="frp-stat-label">心跳超时</div><div><strong>{serverInfo.heartbeatTimeout < 0 ? '已禁用' : serverInfo.heartbeatTimeout + ' 秒'}</strong></div></div>
                          <div className="col-sm-3"><div className="frp-stat-label">TCPMux HTTP 端口</div><div><strong>{serverInfo.tcpmuxHTTPConnectPort > 0 ? serverInfo.tcpmuxHTTPConnectPort : '未启用'}</strong></div></div>
                        </div>
                      </div>
                    </div>
                  )}

                  {serverInfo?.proxyTypeCount && Object.keys(serverInfo.proxyTypeCount).length > 0 && (
                    <div className="frp-panel mt-3"><div className="frp-panel-header">代理类型分布</div><div className="p-3"><div className="d-flex gap-2 flex-wrap">{Object.entries(serverInfo.proxyTypeCount).map(([type, count]) => (<div key={type} className="frp-stat-card" style={{minWidth:140,flex:'0 0 auto'}}><div className="frp-stat-icon blue" style={{width:36,height:36,minWidth:36,fontSize:16}}><i className="bi bi-diagram-3"></i></div><div className="frp-stat-info"><div className="frp-stat-label">{type}</div><div className="frp-stat-value" style={{fontSize:18}}>{count}</div></div></div>))}</div></div></div>
                  )}
                </>
              )}

              {section === 'proxies' && (
                <div className="frp-panel">
                  <div className="frp-panel-header">
                    <span>代理列表 <span className="count">{proxies.length}</span></span>
                    <div className="d-flex gap-1">
                      <button className={`frp-btn ${proxyFilter==='all'?'primary':''}`} style={{padding:'2px 10px',fontSize:12}} onClick={()=>setProxyFilter('all')}>全部</button>
                      {proxyTypes.filter(t=>typeCounts[t]).map(t=><button key={t} className={`frp-btn ${proxyFilter===t?'primary':''}`} style={{padding:'2px 10px',fontSize:12}} onClick={()=>setProxyFilter(t)}>{t} ({typeCounts[t]})</button>)}
                    </div>
                  </div>
                  <div className="frp-panel-body">
                    {filteredProxies.length===0 ? <div className="text-center py-4 text-muted small">暂无代理</div> :
                      <div className="table-responsive"><table className="frp-table"><thead><tr><th>名称</th><th>类型</th><th>本地地址</th><th>远程端口</th><th>今日流入</th><th>今日流出</th><th>状态</th></tr></thead><tbody>
                        {filteredProxies.map((p,i)=><tr key={i}><td><strong>{p.name||'-'}</strong></td><td><span className="frp-badge type">{p.type||'tcp'}</span></td><td><code className="small">{p.local_ip||'-'}:{p.local_port||'-'}</code></td><td>{p.remote_port||'-'}</td><td className="text-success">{formatBytes(p.today_traffic_in)}</td><td className="text-danger">{formatBytes(p.today_traffic_out)}</td><td>{p.status==='online'||p.cur_conns>0?<span className="frp-badge online">在线({p.cur_conns})</span>:<span className="frp-badge offline">离线</span>}</td></tr>)}
                      </tbody></table></div>}
                  </div>
                </div>
              )}

              {section === 'clients' && (<>
                <div className="frp-panel"><div className="frp-panel-header"><span>已连接客户端 <span className="count">{clients.length}</span></span></div><div className="frp-panel-body">
                  {clients.length===0 ? <div className="text-center py-4 text-muted small">暂无客户端</div> :
                    <div className="table-responsive"><table className="frp-table"><thead><tr><th>客户端 ID</th><th>主机名</th><th>IP 地址</th><th>状态</th></tr></thead><tbody>
                      {clients.map((c,i)=><tr key={i} onClick={()=>handleClientDetail(c.key||c.clientID||c.id)}><td><strong>{c.clientID||c.id||'-'}</strong></td><td>{c.hostname||'-'}</td><td><code className="small">{c.clientIP||c.remote_addr||'-'}</code></td><td>{c.online?<span className="frp-badge online">在线</span>:<span className="frp-badge offline">离线</span>}</td></tr>)}
                    </tbody></table></div>}
                </div></div>
                {clientDetail&&<div className="frp-detail-panel"><div className="header"><span>{clientDetail.clientID||clientDetail.key}</span><button className="btn-close btn-close-white" style={{filter:'invert(0.3)'}} onClick={()=>setClientDetail(null)}/></div><div className="frp-detail-grid">
                  <div className="frp-detail-cell"><div className="label">客户端 ID</div><div className="value">{clientDetail.clientID||'-'}</div></div>
                  <div className="frp-detail-cell"><div className="label">运行 ID</div><div className="value"><code className="small">{clientDetail.runID||'-'}</code></div></div>
                  <div className="frp-detail-cell"><div className="label">版本</div><div className="value"><span className="frp-badge type">{clientDetail.version||'-'}</span></div></div>
                  <div className="frp-detail-cell"><div className="label">主机名</div><div className="value">{clientDetail.hostname||'-'}</div></div>
                  <div className="frp-detail-cell"><div className="label">客户端 IP</div><div className="value">{clientDetail.clientIP||'-'}</div></div>
                  <div className="frp-detail-cell"><div className="label">通信协议</div><div className="value">{clientDetail.wireProtocol||'-'}</div></div>
                  <div className="frp-detail-cell"><div className="label">首次连接</div><div className="value"><small>{formatTime(clientDetail.firstConnectedAt)}</small></div></div>
                  <div className="frp-detail-cell"><div className="label">最近连接</div><div className="value"><small>{formatTime(clientDetail.lastConnectedAt)}</small></div></div>
                  <div className="frp-detail-cell"><div className="label">状态</div><div className="value">{clientDetail.online?<span className="frp-badge online">在线</span>:<span className="frp-badge offline">离线</span>}</div></div>
                </div></div>}
              </>)}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
