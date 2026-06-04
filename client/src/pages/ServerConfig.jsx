import React, { useState, useEffect, useCallback, useRef } from 'react';
import { listBinaries, generateServerConfig, downloadPackage, listServerSchemas, loadServerSchema, saveServerSchema, deleteServerSchema } from '../api';
import { useToast } from '../components/ToastContext';
import EmptyState from '../components/EmptyState';
import ConfirmModal from '../components/ConfirmModal';

const DEFAULT_FIELDS = {
  server_addr: '',
  bind_port: '7000',
  token: '',
  dashboard_port: '7500',
  dashboard_user: 'admin',
  dashboard_pwd: 'admin',
  vhost_http_port: '80',
  vhost_https_port: '443',
  subdomain_host: 'example.com',
  log_file: './frps.log',
  log_level: 'info',
};

const FIELD_LABELS = {
  server_addr: '远程服务器地址',
  bind_port: '绑定端口',
  token: '认证令牌',
  dashboard_port: '管理界面端口',
  dashboard_user: '管理界面用户名',
  dashboard_pwd: '管理界面密码',
  vhost_http_port: 'HTTP 虚拟主机端口',
  vhost_https_port: 'HTTPS 虚拟主机端口',
  subdomain_host: '子域名主机',
  log_file: '日志文件路径',
  log_level: '日志级别',
};

export default function ServerConfig({ onNavigate }) {
  const [versions, setVersions] = useState([]);
  const [selectedVersion, setSelectedVersion] = useState('');
  const [selectedPlatform, setSelectedPlatform] = useState('');
  const [fields, setFields] = useState({ ...DEFAULT_FIELDS });
  const [iniPreview, setIniPreview] = useState('');
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  const [schemas, setSchemas] = useState([]);
  const [currentSchema, setCurrentSchema] = useState(null);  // 当前编辑的方案名
  const [editingName, setEditingName] = useState('');          // 保存时用的名称
  const [confirm, setConfirm] = useState({ show: false, title: '', message: '', onConfirm: null });

  const debounceRef = useRef(null);
  const { showToast } = useToast();

  const fetchVersions = useCallback(async () => {
    try {
      const data = await listBinaries();
      const frpsVersions = data.filter((v) =>
        Object.values(v.platforms || {}).some((p) => p.files?.includes('frps'))
      );
      setVersions(frpsVersions);
      if (frpsVersions.length > 0 && !selectedVersion) {
        const def = frpsVersions.find((v) => v.default) || frpsVersions[0];
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
      const data = await listServerSchemas();
      setSchemas(data);
    } catch (_) {}
  }, []);

  useEffect(() => {
    fetchVersions();
    fetchSchemas();
  }, [fetchVersions, fetchSchemas]);

  const updatePreview = useCallback((newFields, version) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const result = await generateServerConfig({ ...newFields, version });
        setIniPreview(result.ini);
      } catch (_) {}
    }, 300);
  }, []);

  const handleFieldChange = (key, value) => {
    const newFields = { ...fields, [key]: value };
    setFields(newFields);
    updatePreview(newFields, selectedVersion);
  };

  const handleVersionChange = (version) => {
    setSelectedVersion(version);
    updatePreview(fields, version);
  };

  // 生成随机令牌
  const handleGenerateToken = () => {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let token = '';
    for (let i = 0; i < 16; i++) {
      token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    handleFieldChange('token', token);
  };

  // 点击方案列表项 → 加载
  const handleSelectSchema = async (name) => {
    try {
      const data = await loadServerSchema(name);
      const newFields = { ...DEFAULT_FIELDS, ...data };
      setFields(newFields);
      setCurrentSchema(name);
      setEditingName(name);
      if (data.version) {
        setSelectedVersion(data.version);
        const v = versions.find((x) => x.version === data.version);
        if (v) setSelectedPlatform(Object.keys(v.platforms || {})[0] || '');
      }
      updatePreview(newFields, data.version || selectedVersion);
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  // 新建（清空表单）
  const handleNew = () => {
    setFields({ ...DEFAULT_FIELDS });
    setCurrentSchema(null);
    setEditingName('');
    setIniPreview('');
    // 重置为第一个可用平台
    if (versions.length > 0) {
      const firstPlatform = Object.keys(versions[0].platforms || {})[0] || '';
      setSelectedPlatform(firstPlatform);
    }
  };

  // 保存
  const handleSave = async () => {
    const name = editingName.trim();
    if (!name) {
      showToast('请输入方案名称', 'error');
      return;
    }
    try {
      await saveServerSchema(name, { ...fields, version: selectedVersion });
      showToast(`方案「${name}」已保存`);
      setCurrentSchema(name);
      await fetchSchemas();
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  // 另存为
  const handleSaveAs = async () => {
    const name = prompt('请输入新方案名称：');
    if (!name || !name.trim()) return;
    try {
      await saveServerSchema(name.trim(), { ...fields, version: selectedVersion });
      showToast(`方案「${name.trim()}」已保存`);
      setCurrentSchema(name.trim());
      setEditingName(name.trim());
      await fetchSchemas();
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  // 删除
  const handleDelete = () => {
    if (!currentSchema) return;
    setConfirm({
      show: true,
      title: '删除方案',
      message: `确定删除方案「${currentSchema}」吗？`,
      onConfirm: async () => {
        try {
          await deleteServerSchema(currentSchema);
          showToast('方案已删除');
          handleNew();
          await fetchSchemas();
        } catch (e) {
          showToast(e.message, 'error');
        }
        setConfirm({ show: false, title: '', message: '', onConfirm: null });
      },
    });
  };

  // 下载
  const handleDownload = async () => {
    if (!fields.bind_port) { showToast('请填写绑定端口', 'error'); return; }
    if (!selectedPlatform) { showToast('请选择目标平台', 'error'); return; }
    setDownloading(true);
    try {
      const genResult = await generateServerConfig({ ...fields, version: selectedVersion });
      const resp = await downloadPackage('/server/package', { ini: genResult.ini, version: selectedVersion, platform: selectedPlatform });
      const blob = resp instanceof Response ? await resp.blob() : resp;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `frps_${selectedVersion}_package.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('打包成功，下载已开始');
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setDownloading(false);
    }
  };

  if (loading) {
    return <div className="text-center py-5"><div className="spinner-border text-primary" /></div>;
  }

  if (versions.length === 0) {
    return (
      <EmptyState icon="⚠️" message="暂无可用的 frps 程序"
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
                  className={`list-group-item list-group-item-action d-flex justify-content-between align-items-center ${currentSchema === s.name ? 'active' : ''}`}
                  onClick={() => handleSelectSchema(s.name)}
                >
                  <span className="text-truncate" style={{ maxWidth: '180px' }}>{s.name}</span>
                  <small className="text-muted ms-1">{new Date(s.createdAt).toLocaleDateString('zh-CN')}</small>
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

            {/* 配置表单 */}
            <div className="card">
              <div className="card-header">
                {currentSchema ? `编辑：${currentSchema}` : '新建配置'}
              </div>
              <div className="card-body">
                {Object.keys(DEFAULT_FIELDS).map((key) => (
                  <div className="mb-3" key={key}>
                    <label className="form-label small fw-semibold">{FIELD_LABELS[key]}</label>
                    {key === 'log_level' ? (
                      <select className="form-select form-select-sm"
                        value={fields[key]} onChange={(e) => handleFieldChange(key, e.target.value)}>
                        {['debug', 'info', 'warn', 'error'].map((lvl) => (
                          <option key={lvl} value={lvl}>{lvl}</option>
                        ))}
                      </select>
                    ) : (
                      <div className="d-flex gap-1">
                        <input
                          type={key.includes('port') ? 'number' : key === 'dashboard_pwd' ? 'password' : 'text'}
                          className="form-control form-control-sm"
                          placeholder={key === 'token' ? '选填' : ''}
                          value={fields[key]}
                          onChange={(e) => handleFieldChange(key, e.target.value)}
                        />
                        {key === 'token' && (
                          <button className="btn btn-outline-secondary btn-sm" type="button"
                            title="生成随机令牌" onClick={handleGenerateToken}>
                            <i className="bi bi-shuffle"></i>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}

                <button className="btn btn-success w-100" disabled={downloading} onClick={handleDownload}>
                  {downloading ? (
                    <><span className="spinner-border spinner-border-sm me-2" />处理中...</>
                  ) : (
                    <><i className="bi bi-download me-1"></i>生成并下载服务端包</>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* 预览 */}
          <div className="col-lg-5">
            <div className="card">
              <div className="card-header d-flex align-items-center gap-2">
                <i className="bi bi-file-code"></i> frps.toml 预览
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
