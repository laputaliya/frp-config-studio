import React, { useState, useEffect, useCallback, useRef } from 'react';
import { listBinaries, generateClientConfig, downloadPackage, listClientSchemas, loadClientSchema, saveClientSchema, deleteClientSchema, listServerSchemas, loadServerSchema } from '../api';
import { useToast } from '../components/ToastContext';
import EmptyState from '../components/EmptyState';
import ConfirmModal from '../components/ConfirmModal';

const DEFAULT_COMMON = {
  server_addr: 'frp.example.com',
  server_port: '7000',
  token: '',
  admin_addr: '0.0.0.0',
  admin_port: '7400',
  log_file: './frpc.log',
  log_level: 'info',
};

const COMMON_LABELS = {
  server_addr: '服务端地址', server_port: '服务端端口', token: '认证令牌',
  admin_addr: '管理地址', admin_port: '管理端口',
  log_file: '日志文件路径', log_level: '日志级别',
};

const PROXY_TYPES = ['tcp', 'udp', 'http', 'https', 'stcp', 'xtcp'];

function createDefaultProxy(type = 'tcp', name = '') {
  return {
    name: name || '',
    type,
    local_ip: '127.0.0.1',
    local_port: '',
    remote_port: '',
    use_encryption: false,
    use_compression: false,
    subdomain: '',
    custom_domains: '',
    locations: '',
    host_header_rewrite: '',
    secret_key: '',
    allow_users: '',
  };
}

export default function ClientConfig({ onNavigate }) {
  const [versions, setVersions] = useState([]);
  const [selectedVersion, setSelectedVersion] = useState('');
  const [selectedPlatform, setSelectedPlatform] = useState('');
  const [common, setCommon] = useState({ ...DEFAULT_COMMON });
  const [proxies, setProxies] = useState([]);
  const [iniPreview, setIniPreview] = useState('');
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  const [schemas, setSchemas] = useState([]);
  const [currentSchema, setCurrentSchema] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [confirm, setConfirm] = useState({ show: false, title: '', message: '', onConfirm: null });

  // 关联服务端方案
  const [serverSchemas, setServerSchemas] = useState([]);
  const [linkedServerSchema, setLinkedServerSchema] = useState('');
  const [linkedServerData, setLinkedServerData] = useState(null); // 完整服务端数据

  const debounceRef = useRef(null);
  const { showToast } = useToast();

  const fetchVersions = useCallback(async () => {
    try {
      const data = await listBinaries();
      const frpcVersions = data.filter((v) =>
        Object.values(v.platforms || {}).some((p) => p.files?.includes('frpc'))
      );
      setVersions(frpcVersions);
      if (frpcVersions.length > 0 && !selectedVersion) {
        const def = frpcVersions.find((v) => v.default) || frpcVersions[0];
        setSelectedVersion(def.version);
        const firstPlatform = Object.keys(def.platforms || {})[0] || '';
        setSelectedPlatform(firstPlatform);
      }
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  const fetchSchemas = useCallback(async () => {
    try {
      const data = await listClientSchemas();
      setSchemas(data);
    } catch (_) {}
  }, []);

  const fetchServerSchemas = useCallback(async () => {
    try {
      const data = await listServerSchemas();
      setServerSchemas(data);
    } catch (_) {}
  }, []);

  useEffect(() => {
    fetchVersions();
    fetchSchemas();
    fetchServerSchemas();
  }, [fetchVersions, fetchSchemas, fetchServerSchemas]);

  // 关联服务端方案 → 自动同步 server_addr、server_port、token、subdomainHost
  const handleLinkServerSchema = async (name) => {
    if (!name) {
      setLinkedServerSchema('');
      setLinkedServerData(null);
      return;
    }
    try {
      const data = await loadServerSchema(name);
      setLinkedServerSchema(name);
      setLinkedServerData(data);
      const nc = {
        ...common,
        server_addr: data.server_addr || common.server_addr,
        server_port: data.bind_port || common.server_port,
        token: data.token || common.token,
      };
      setCommon(nc);
      updatePreview(nc, proxies, selectedVersion);
      showToast(`已关联服务端方案「${name}」，地址、端口和令牌已同步`);
    } catch (e) {
      showToast('加载服务端方案失败', 'error');
    }
  };

  const updatePreview = useCallback((newCommon, newProxies, version) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const result = await generateClientConfig({ common: newCommon, proxies: newProxies, version });
        setIniPreview(result.ini);
      } catch (_) {}
    }, 300);
  }, []);

  const handleCommonChange = (key, value) => {
    const nc = { ...common, [key]: value };
    setCommon(nc);
    updatePreview(nc, proxies, selectedVersion);
  };

  const handleVersionChange = (version) => {
    setSelectedVersion(version);
    updatePreview(common, proxies, version);
  };

  // ── 代理规则操作 ──

  const handleProxyChange = (index, field, value) => {
    const np = [...proxies];
    np[index] = { ...np[index], [field]: value };
    if (field === 'type') {
      np[index] = { ...createDefaultProxy(value), name: np[index].name };
    }
    setProxies(np);
    updatePreview(common, np, selectedVersion);
  };

  const handleAddProxy = () => {
    const np = [...proxies, createDefaultProxy('tcp', `proxy_${proxies.length + 1}`)];
    setProxies(np);
    updatePreview(common, np, selectedVersion);
  };

  const handleDeleteProxy = (index) => {
    const np = proxies.filter((_, i) => i !== index);
    setProxies(np);
    updatePreview(common, np, selectedVersion);
  };

  // ── 方案操作 ──

  const handleSelectSchema = async (name) => {
    try {
      const data = await loadClientSchema(name);
      setCommon({ ...DEFAULT_COMMON, ...data.common });
      setProxies(data.proxies || []);
      setCurrentSchema(name);
      setEditingName(name);
      if (data.version) setSelectedVersion(data.version);
      if (data.linkedServer) {
        setLinkedServerSchema(data.linkedServer);
        try { const srvData = await loadServerSchema(data.linkedServer); setLinkedServerData(srvData); } catch (_) {}
      } else { setLinkedServerSchema(''); setLinkedServerData(null); }
      updatePreview({ ...DEFAULT_COMMON, ...data.common }, data.proxies || [], data.version || selectedVersion);
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  const handleNew = () => {
    setCommon({ ...DEFAULT_COMMON });
    setProxies([]);
    setCurrentSchema(null);
    setEditingName('');
    setLinkedServerSchema('');
    setLinkedServerData(null);
    setIniPreview('');
    if (versions.length > 0) {
      setSelectedPlatform(Object.keys(versions[0].platforms || {})[0] || '');
    }
  };

  const handleSave = async () => {
    const name = editingName.trim();
    if (!name) { showToast('请输入方案名称', 'error'); return; }
    try {
      await saveClientSchema(name, { common, proxies, version: selectedVersion, linkedServer: linkedServerSchema });
      showToast(`方案「${name}」已保存`);
      setCurrentSchema(name);
      await fetchSchemas();
    } catch (e) { showToast(e.message, 'error'); }
  };

  const handleSaveAs = async () => {
    const name = prompt('请输入新方案名称：');
    if (!name || !name.trim()) return;
    try {
      await saveClientSchema(name.trim(), { common, proxies, version: selectedVersion, linkedServer: linkedServerSchema });
      showToast(`方案「${name.trim()}」已保存`);
      setCurrentSchema(name.trim());
      setEditingName(name.trim());
      await fetchSchemas();
    } catch (e) { showToast(e.message, 'error'); }
  };

  const handleDelete = () => {
    if (!currentSchema) return;
    setConfirm({
      show: true, title: '删除方案',
      message: `确定删除方案「${currentSchema}」吗？`,
      onConfirm: async () => {
        try {
          await deleteClientSchema(currentSchema);
          showToast('方案已删除');
          handleNew();
          await fetchSchemas();
        } catch (e) { showToast(e.message, 'error'); }
        setConfirm({ show: false, title: '', message: '', onConfirm: null });
      },
    });
  };

  const handleDownload = async () => {
    if (!common.server_addr || !common.server_port) { showToast('请填写服务端地址和端口', 'error'); return; }
    if (!selectedPlatform) { showToast('请选择目标平台', 'error'); return; }
    setDownloading(true);
    try {
      const genResult = await generateClientConfig({ common, proxies, version: selectedVersion });
      const resp = await downloadPackage('/client/package', { ini: genResult.ini, version: selectedVersion, platform: selectedPlatform });
      const blob = resp instanceof Response ? await resp.blob() : resp;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `frpc_${selectedVersion}_package.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('打包成功，下载已开始');
    } catch (e) { showToast(e.message, 'error'); }
    finally { setDownloading(false); }
  };

  const showRemotePort = (t) => t === 'tcp' || t === 'udp';
  const showHttpFields = (t) => t === 'http' || t === 'https';
  const showSecretFields = (t) => t === 'stcp' || t === 'xtcp';

  if (loading) {
    return <div className="text-center py-5"><div className="spinner-border text-primary" /></div>;
  }

  if (versions.length === 0) {
    return (
      <EmptyState icon="⚠️" message="暂无可用的 frpc 程序"
        actionLabel="前往上传" onAction={() => onNavigate('binary')} />
    );
  }

  return (
    <div className="row">
      {/* ── 左侧：方案列表 ── */}
      <div className="col-lg-3 mb-3">
        <div className="card">
          <div className="card-header d-flex justify-content-between align-items-center">
            <span>已保存方案</span>
            <button className="btn btn-primary btn-sm" onClick={handleNew}>
              <i className="bi bi-plus-lg"></i> 新建
            </button>
          </div>
          <div className="list-group list-group-flush" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
            {schemas.length === 0 ? (
              <div className="list-group-item text-muted text-center py-3 small">
                <i className="bi bi-inbox d-block fs-4 mb-1"></i>
                暂无方案，点击"新建"创建
              </div>
            ) : (
              schemas.map((s) => (
                <button
                  key={s.name}
                  className={`list-group-item list-group-item-action d-flex flex-column align-items-start ${currentSchema === s.name ? 'active' : ''}`}
                  onClick={() => handleSelectSchema(s.name)}
                >
                  <div className="d-flex w-100 justify-content-between align-items-center">
                    <span className="text-truncate" style={{ maxWidth: '160px' }}>{s.name}</span>
                    <small className="text-muted">{new Date(s.createdAt).toLocaleDateString('zh-CN')}</small>
                  </div>
                  {s.linkedServer && (
                    <small className={currentSchema === s.name ? 'text-info' : 'text-muted'}>
                      <i className="bi bi-link-45deg me-1"></i>{s.linkedServer}
                    </small>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      </div>

      {/* ── 右侧：编辑区 ── */}
      <div className="col-lg-9">
        <div className="row">
          {/* 表单 */}
          <div className="col-lg-7 mb-3">
            {/* 顶部操作栏 */}
            <div className="d-flex gap-2 align-items-center mb-3 flex-wrap">
              <select className="form-select" style={{ width: 'auto', minWidth: '130px' }}
                value={selectedVersion} onChange={(e) => {
                  handleVersionChange(e.target.value);
                  const v = versions.find((x) => x.version === e.target.value);
                  if (v) setSelectedPlatform(Object.keys(v.platforms || {})[0] || '');
                }}>
                {versions.map((v) => (
                  <option key={v.version} value={v.version}>{v.version}{v.default ? '（默认）' : ''}</option>
                ))}
              </select>
              <select className="form-select" style={{ width: 'auto', minWidth: '160px' }}
                value={selectedPlatform} onChange={(e) => setSelectedPlatform(e.target.value)}>
                {selectedVersion && versions.find((v) => v.version === selectedVersion)?.platforms
                  && Object.entries(versions.find((v) => v.version === selectedVersion).platforms).map(([key, p]) => (
                    <option key={key} value={key}>{key.replace('_', ' / ')}</option>
                  ))}
                {!selectedPlatform && <option value="">请选择平台</option>}
              </select>
              <input type="text" className="form-control" style={{ width: 'auto', minWidth: '140px' }}
                placeholder="方案名称" value={editingName}
                onChange={(e) => setEditingName(e.target.value)} />
              <button className="btn btn-primary" onClick={handleSave}>
                <i className="bi bi-check-lg"></i> 保存
              </button>
              <button className="btn btn-outline-secondary" onClick={handleSaveAs}>
                <i className="bi bi-files"></i> 另存为
              </button>
              {currentSchema && (
                <button className="btn btn-outline-danger" onClick={handleDelete}>
                  <i className="bi bi-trash"></i> 删除
                </button>
              )}
            </div>

            {/* 关联服务端方案 */}
            <div className="card mb-3 border-primary">
              <div className="card-header bg-primary bg-opacity-10 d-flex align-items-center gap-2">
                <i className="bi bi-link-45deg"></i>
                关联服务端方案
              </div>
              <div className="card-body py-2">
                <div className="d-flex gap-2 align-items-center">
                  <select className="form-select form-select-sm" style={{ maxWidth: '280px' }}
                    value={linkedServerSchema}
                    onChange={(e) => handleLinkServerSchema(e.target.value)}>
                    <option value="">不关联（手动填写）</option>
                    {serverSchemas.map((s) => (
                      <option key={s.name} value={s.name}>{s.name}</option>
                    ))}
                  </select>
                  {linkedServerSchema ? (
                    <small className="text-success">
                      <i className="bi bi-check-circle"></i> 已关联「{linkedServerSchema}」，端口和令牌自动同步
                    </small>
                  ) : (
                    <small className="text-muted">
                      选择服务端方案后，端口和令牌将自动填充
                    </small>
                  )}
                </div>
              </div>
            </div>

            {/* 公共参数 */}
            <div className="card mb-3">
              <div className="card-header">
                {currentSchema ? `编辑：${currentSchema}` : '新建配置'}
              </div>
              <div className="card-body">
                <div className="row g-2">
                  {Object.keys(DEFAULT_COMMON).map((key) => {
                    const isSynced = linkedServerSchema && (key === 'server_port' || key === 'token');
                    return (
                      <div className="col-md-6" key={key}>
                        <label className="form-label small fw-semibold">
                          {COMMON_LABELS[key]}
                          {isSynced && <span className="text-primary ms-1" title="已从服务端方案同步"><i className="bi bi-link-45deg"></i></span>}
                        </label>
                        {key === 'log_level' ? (
                          <select className="form-select form-select-sm"
                            value={common[key]} onChange={(e) => handleCommonChange(key, e.target.value)}>
                            {['debug', 'info', 'warn', 'error'].map((lvl) => (
                              <option key={lvl} value={lvl}>{lvl}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type={key.includes('port') ? 'number' : 'text'}
                            className={`form-control form-control-sm ${isSynced ? 'border-primary bg-primary bg-opacity-10' : ''}`}
                            placeholder={key === 'token' ? '选填' : ''}
                            value={common[key]}
                            onChange={(e) => handleCommonChange(key, e.target.value)}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* 代理规则 */}
            <div className="card mb-3">
              <div className="card-header d-flex justify-content-between align-items-center">
                代理规则
                <span className="badge bg-secondary">{proxies.length}</span>
              </div>
              <div className="card-body">
                {proxies.map((proxy, index) => (
                  <div className="card mb-2 border shadow-sm" key={index}>
                    <div className="card-header py-2 d-flex gap-2 align-items-center bg-light">
                      <input type="text" className="form-control form-control-sm" style={{ maxWidth: '130px' }}
                        placeholder="名称" value={proxy.name}
                        onChange={(e) => handleProxyChange(index, 'name', e.target.value)} />
                      <select className="form-select form-select-sm" style={{ maxWidth: '110px' }}
                        value={proxy.type}
                        onChange={(e) => handleProxyChange(index, 'type', e.target.value)}>
                        {PROXY_TYPES.map((t) => (<option key={t} value={t}>{t}</option>))}
                      </select>
                      <div className="flex-grow-1" />
                      <button className="btn btn-sm btn-outline-danger"
                        onClick={() => handleDeleteProxy(index)}>
                        <i className="bi bi-x"></i> 删除
                      </button>
                    </div>
                    <div className="card-body py-2">
                      <div className="row g-2">
                        <div className="col-6">
                          <label className="form-label small mb-0">本地 IP</label>
                          <input type="text" className="form-control form-control-sm" placeholder="127.0.0.1"
                            value={proxy.local_ip}
                            onChange={(e) => handleProxyChange(index, 'local_ip', e.target.value)} />
                        </div>
                        <div className="col-6">
                          <label className="form-label small mb-0">本地端口</label>
                          <input type="number" className="form-control form-control-sm" placeholder="8080"
                            value={proxy.local_port}
                            onChange={(e) => handleProxyChange(index, 'local_port', e.target.value)} />
                        </div>
                        {showRemotePort(proxy.type) && (
                          <div className="col-6">
                            <label className="form-label small mb-0">远程端口</label>
                            <input type="number" className="form-control form-control-sm"
                              value={proxy.remote_port}
                              onChange={(e) => handleProxyChange(index, 'remote_port', e.target.value)} />
                          </div>
                        )}
                        {showHttpFields(proxy.type) && (
                          <>
                            {linkedServerData?.subdomain_host && (
                              <div className="col-6">
                                <label className="form-label small mb-0">
                                  子域名
                                  <span className="text-muted ms-1">（.{linkedServerData.subdomain_host}）</span>
                                </label>
                                <div className="input-group input-group-sm">
                                  <input type="text" className="form-control" placeholder={proxy.name || '子域名'}
                                    value={proxy.subdomain || ''}
                                    onChange={(e) => handleProxyChange(index, 'subdomain', e.target.value)} />
                                  <button className="btn btn-outline-secondary" type="button" title="用代理名作为子域名"
                                    onClick={() => handleProxyChange(index, 'subdomain', proxy.name || '')}>
                                    <i className="bi bi-lightning"></i>
                                  </button>
                                </div>
                                <small className="text-muted">最终访问: <strong>{proxy.subdomain || proxy.name || 'xxx'}.{linkedServerData.subdomain_host}</strong></small>
                              </div>
                            )}
                            <div className="col-6">
                              <label className="form-label small mb-0">自定义域名</label>
                              <input type="text" className="form-control form-control-sm" placeholder="www.example.com"
                                value={proxy.custom_domains}
                                onChange={(e) => handleProxyChange(index, 'custom_domains', e.target.value)} />
                            </div>
                            {proxy.type === 'http' && (
                              <>
                                <div className="col-6">
                                  <label className="form-label small mb-0">路径路由</label>
                                  <input type="text" className="form-control form-control-sm"
                                    value={proxy.locations}
                                    onChange={(e) => handleProxyChange(index, 'locations', e.target.value)} />
                                </div>
                                <div className="col-6">
                                  <label className="form-label small mb-0">Host 重写</label>
                                  <input type="text" className="form-control form-control-sm"
                                    value={proxy.host_header_rewrite}
                                    onChange={(e) => handleProxyChange(index, 'host_header_rewrite', e.target.value)} />
                                </div>
                              </>
                            )}
                          </>
                        )}
                        {showSecretFields(proxy.type) && (
                          <>
                            <div className="col-6">
                              <label className="form-label small mb-0">密钥</label>
                              <input type="text" className="form-control form-control-sm"
                                value={proxy.secret_key}
                                onChange={(e) => handleProxyChange(index, 'secret_key', e.target.value)} />
                            </div>
                            <div className="col-6">
                              <label className="form-label small mb-0">允许的用户</label>
                              <input type="text" className="form-control form-control-sm"
                                value={proxy.allow_users}
                                onChange={(e) => handleProxyChange(index, 'allow_users', e.target.value)} />
                            </div>
                          </>
                        )}
                      </div>
                      <div className="mt-2">
                        <div className="form-check form-check-inline">
                          <input className="form-check-input" type="checkbox"
                            id={`enc_c_${index}`} checked={proxy.use_encryption}
                            onChange={(e) => handleProxyChange(index, 'use_encryption', e.target.checked)} />
                          <label className="form-check-label small" htmlFor={`enc_c_${index}`}>加密</label>
                        </div>
                        <div className="form-check form-check-inline">
                          <input className="form-check-input" type="checkbox"
                            id={`comp_c_${index}`} checked={proxy.use_compression}
                            onChange={(e) => handleProxyChange(index, 'use_compression', e.target.checked)} />
                          <label className="form-check-label small" htmlFor={`comp_c_${index}`}>压缩</label>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
                <button className="btn btn-outline-primary btn-sm" onClick={handleAddProxy}>
                  <i className="bi bi-plus-lg"></i> 添加代理
                </button>
              </div>
            </div>

            <button className="btn btn-success w-100" disabled={downloading} onClick={handleDownload}>
              {downloading ? (
                <><span className="spinner-border spinner-border-sm me-2" />处理中...</>
              ) : (
                <><i className="bi bi-download me-1"></i>生成并下载客户端包</>
              )}
            </button>
          </div>

          {/* 预览 */}
          <div className="col-lg-5">
            <div className="card">
              <div className="card-header d-flex align-items-center gap-2">
                <i className="bi bi-file-code"></i> frpc.toml 预览
              </div>
              <div className="card-body p-0">
                <pre className="bg-dark text-light p-3 m-0 rounded-bottom"
                  style={{ minHeight: '400px', fontSize: '0.82rem', lineHeight: 1.6 }}>
                  {iniPreview || '# 填写表单后自动生成预览...'}
                </pre>
              </div>
            </div>
          </div>
        </div>
      </div>

      <ConfirmModal show={confirm.show} title={confirm.title} message={confirm.message}
        onConfirm={confirm.onConfirm}
        onCancel={() => setConfirm({ show: false, title: '', message: '', onConfirm: null })} />
    </div>
  );
}
