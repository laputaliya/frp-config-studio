import React, { useState, useEffect, useCallback, useRef } from 'react';
import { listBinaries, uploadBinary, setDefaultVersion, deleteVersion } from '../api';
import { useToast } from '../components/ToastContext';
import EmptyState from '../components/EmptyState';
import ConfirmModal from '../components/ConfirmModal';

export default function BinaryManager() {
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [versionInput, setVersionInput] = useState('');
  const [confirm, setConfirm] = useState({ show: false, title: '', message: '', onConfirm: null });

  const fileInputRef = useRef(null);
  const { showToast } = useToast();

  const fetchVersions = useCallback(async () => {
    try {
      const data = await listBinaries();
      setVersions(data);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    fetchVersions();
  }, [fetchVersions]);

  // 从文件名解析版本号
  const tryParseVersion = (filename) => {
    const patterns = [
      /frp[cs]?_(\d+\.\d+\.\d+)/,
      /(\d+\.\d+\.\d+)/,
    ];
    for (const p of patterns) {
      const m = filename.match(p);
      if (m) return m[1];
    }
    return '';
  };

  const handleFileSelect = (file) => {
    if (!file) return;
    const ext = file.name.toLowerCase();
    if (!ext.endsWith('.tar.gz') && !ext.endsWith('.zip')) {
      showToast('仅支持 .tar.gz 和 .zip 格式', 'error');
      return;
    }
    setSelectedFile(file);
    if (!versionInput) {
      const parsed = tryParseVersion(file.name);
      if (parsed) setVersionInput(parsed);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      showToast('请选择要上传的文件', 'error');
      return;
    }
    const version = versionInput.trim();
    if (!version) {
      showToast('请输入版本号', 'error');
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('version', version);
      const result = await uploadBinary(formData);
      showToast(`版本 ${result.version} 上传成功`);
      setSelectedFile(null);
      setVersionInput('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      await fetchVersions();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleSetDefault = (version) => {
    setConfirm({
      show: true,
      title: '设为默认版本',
      message: `确定将版本 ${version} 设为默认版本吗？`,
      onConfirm: async () => {
        try {
          await setDefaultVersion(version);
          showToast(`版本 ${version} 已设为默认`);
          await fetchVersions();
        } catch (e) {
          showToast(e.message, 'error');
        }
        setConfirm({ show: false, title: '', message: '', onConfirm: null });
      },
    });
  };

  const handleDelete = (version) => {
    setConfirm({
      show: true,
      title: '删除版本',
      message: `确定删除版本 ${version} 吗？此操作不可撤销`,
      onConfirm: async () => {
        try {
          await deleteVersion(version);
          showToast(`版本 ${version} 已删除`);
          await fetchVersions();
        } catch (e) {
          showToast(e.message, 'error');
        }
        setConfirm({ show: false, title: '', message: '', onConfirm: null });
      },
    });
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => setDragOver(false);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    handleFileSelect(file);
  };

  return (
    <div className="row">
      {/* 左侧：上传区域 */}
      <div className="col-lg-5 mb-4">
        <div className="card">
          <div className="card-header fw-bold">上传 FRP 程序包</div>
          <div className="card-body">
            {/* 拖拽上传区 */}
            <div
              className={`border border-2 border-dashed rounded-3 text-center py-4 px-3 mb-3 ${
                dragOver ? 'border-primary bg-light' : ''
              }`}
              style={{ cursor: 'pointer', borderStyle: 'dashed' }}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <div style={{ fontSize: '2rem' }}>📁</div>
              <p className="mb-1">
                {selectedFile
                  ? `已选择: ${selectedFile.name}`
                  : '将 FRP 压缩包拖拽到此处，或点击选择文件'}
              </p>
              <small className="text-muted">支持 .tar.gz 和 .zip 格式，最大 100MB</small>
              <input
                type="file"
                ref={fileInputRef}
                className="d-none"
                accept=".tar.gz,.zip"
                onChange={(e) => handleFileSelect(e.target.files[0])}
              />
            </div>

            {/* 版本号输入 */}
            <div className="mb-3">
              <label className="form-label">版本号</label>
              <input
                type="text"
                className="form-control"
                placeholder="例如 0.61.0"
                value={versionInput}
                onChange={(e) => setVersionInput(e.target.value)}
              />
            </div>

            {/* 上传按钮 */}
            <button
              className="btn btn-primary w-100"
              disabled={!selectedFile || uploading}
              onClick={handleUpload}
            >
              {uploading ? (
                <>
                  <span className="spinner-border spinner-border-sm me-2" />
                  上传中...
                </>
              ) : (
                '上传'
              )}
            </button>
          </div>
        </div>
      </div>

      {/* 右侧：版本列表 */}
      <div className="col-lg-7">
        <div className="card">
          <div className="card-header fw-bold">已上传版本</div>
          <div className="card-body">
            {loading ? (
              <div className="text-center py-4">
                <div className="spinner-border text-primary" />
              </div>
            ) : versions.length === 0 ? (
              <EmptyState message="暂无程序包，请先在左侧上传 FRP 官方压缩包" />
            ) : (
              <div className="table-responsive">
                <table className="table table-hover align-middle">
                  <thead>
                    <tr>
                      <th>版本</th>
                      <th>支持平台</th>
                      <th>上传时间</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {versions.map((v) => {
                      const platforms = Object.entries(v.platforms || {});
                      return (
                        <tr key={v.version} className={v.default ? 'table-light' : ''}>
                          <td>
                            <strong>{v.version}</strong>
                            {v.default && (
                              <span className="badge bg-warning text-dark ms-2">⭐ 默认</span>
                            )}
                          </td>
                          <td>
                            {platforms.length === 0 ? (
                              <span className="text-muted small">无</span>
                            ) : (
                              platforms.map(([key, p]) => {
                                const icon = key.startsWith('windows') ? 'bi-windows' :
                                             key.startsWith('darwin') ? 'bi-apple' : 'bi-ubuntu';
                                return (
                                  <span key={key} className="badge bg-secondary me-1 mb-1" title={`${p.files?.join(', ') || ''}`}>
                                    <i className={`bi ${icon} me-1`}></i>
                                    {key.replace('_', '/')}
                                  </span>
                                );
                              })
                            )}
                          </td>
                          <td>
                            <small className="text-muted">
                              {new Date(v.uploadedAt).toLocaleString('zh-CN')}
                            </small>
                          </td>
                          <td>
                            {!v.default && (
                              <button
                                className="btn btn-sm btn-outline-secondary me-1"
                                onClick={() => handleSetDefault(v.version)}
                              >
                                设为默认
                              </button>
                            )}
                            <button
                              className="btn btn-sm btn-outline-danger"
                              onClick={() => handleDelete(v.version)}
                            >
                              删除
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 确认对话框 */}
      <ConfirmModal
        show={confirm.show}
        title={confirm.title}
        message={confirm.message}
        onConfirm={confirm.onConfirm}
        onCancel={() => setConfirm({ show: false, title: '', message: '', onConfirm: null })}
      />
    </div>
  );
}
