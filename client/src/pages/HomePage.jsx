import React from 'react';

export default function HomePage() {
  return (
    <div>
      <div className="text-center mb-4">
        <div style={{ fontSize: 56, lineHeight: 1 }}>⚙️</div>
        <h4 className="mt-2 mb-1">FRP Config Studio（FRP 配置工坊）</h4>
        <p className="text-muted">Web 可视化的 FRP 配置生成、打包与远程管理工具</p>
      </div>

      <div className="row g-3 mb-4">
        {[
          { icon: 'bi-box-seam', color: '#3b82f6', title: '程序包管理', desc: '上传和管理多个版本的 FRP 压缩包，自动解压识别 frps 和 frpc' },
          { icon: 'bi-hdd-rack', color: '#10b981', title: '服务端配置', desc: '可视化配置 frps 参数，实时预览 TOML，一键打包下载' },
          { icon: 'bi-pc-display', color: '#f59e0b', title: '客户端配置', desc: '配置 frpc 公共参数和代理规则（TCP/UDP/HTTP/HTTPS/STCP/XTCP）' },
          { icon: 'bi-globe2', color: '#8b5cf6', title: '远程管理', desc: '连接已部署的 FRP 服务端，查看运行状态、代理列表和客户端详情' },
          { icon: 'bi-floppy', color: '#ec4899', title: '方案管理', desc: '保存和加载配置方案，客户端可关联服务端方案自动同步参数' },
          { icon: 'bi-file-earmark-zip', color: '#06b6d4', title: '打包下载', desc: '生成包含二进制、配置文件、启动脚本和使用说明的 ZIP 部署包' },
        ].map((item, i) => (
          <div className="col-md-4" key={i}>
            <div className="card h-100">
              <div className="card-body text-center">
                <div style={{ fontSize: 28, color: item.color, marginBottom: 8 }}>
                  <i className={`bi ${item.icon}`}></i>
                </div>
                <h6>{item.title}</h6>
                <small className="text-muted">{item.desc}</small>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-header"><i className="bi bi-info-circle me-1"></i>使用流程</div>
        <div className="card-body">
          <div className="d-flex flex-wrap align-items-center gap-2 small">
            <span className="badge bg-primary">1. 上传程序包</span>
            <i className="bi bi-arrow-right text-muted"></i>
            <span className="badge bg-secondary">2. 配置服务端</span>
            <i className="bi bi-arrow-right text-muted"></i>
            <span className="badge bg-secondary">3. 配置客户端</span>
            <i className="bi bi-arrow-right text-muted"></i>
            <span className="badge bg-success">4. 打包下载</span>
            <i className="bi bi-arrow-right text-muted"></i>
            <span className="badge bg-success">5. 部署到服务器</span>
            <i className="bi bi-arrow-right text-muted"></i>
            <span className="badge bg-info">6. 远程管理</span>
          </div>
        </div>
      </div>
    </div>
  );
}
