# 架构设计文档

> **文档版本**：2.0
> **最后更新**：2026-06-04

---

## 1. 技术选型

| 层级     | 技术             |
| -------- | ---------------- |
| 运行时   | Node.js 18+      |
| 后端框架 | Express          |
| 前端框架 | React 18         |
| UI 库    | Bootstrap 5 + Bootstrap Icons |
| 构建工具 | Vite             |
| ZIP 打包 | archiver         |
| 解压     | tar + unzipper   |
| 认证     | Token 会话（crypto 随机数） |
| 存储     | 文件系统（JSON）  |

---

## 2. 目录结构

```
├── server.js                  # Express 后端
├── client/                    # React 前端
│   ├── index.html
│   └── src/
│       ├── main.jsx
│       ├── App.jsx            # 根组件（认证、侧边栏、Tab 系统）
│       ├── admin.css          # 管理后台布局样式
│       ├── frp-dashboard.css  # 远程管理页 FRP 风格
│       ├── api.js             # API 封装（含认证 token）
│       ├── pages/
│       │   ├── LoginPage.jsx
│       │   ├── HomePage.jsx
│       │   ├── BinaryManager.jsx
│       │   ├── ServerConfig.jsx
│       │   ├── ClientConfig.jsx
│       │   ├── RemoteManager.jsx
│       │   └── UserManager.jsx
│       └── components/
│           ├── ToastContext.jsx
│           ├── ConfigLayout.jsx
│           ├── EmptyState.jsx
│           └── ConfirmModal.jsx
├── frp_bin/<version>/<os_arch>/ # 二进制存储
├── config_schemas/server/       # 服务端方案
├── config_schemas/client/       # 客户端方案
├── packages/                    # 临时打包
├── users.json                   # 系统用户
├── package.json
├── vite.config.js
└── docs/
```

---

## 3. 数据流

```
[登录] → token 存 localStorage，所有 API 请求带 Authorization header
[上传] → 解析 frp_<ver>_<os>_<arch>.tar.gz → frp_bin/<ver>/<os_arch>/
[配置] → 表单 → POST /api/server(generate → TOML 预览 → 保存方案)
[打包] → POST /api/server/package {ini, version, platform} → ZIP 流下载
[远程] → 从 config_schemas/server 读取连接 → proxy FRP Dashboard API
```

---

## 4. API 设计

### 4.1 认证

| 接口                | 方法 | 说明                       |
| ------------------- | ---- | -------------------------- |
| `/api/auth/login`   | POST | 登录，返回 token（24h 有效）|
| `/api/auth/logout`  | POST | 退出，销毁 session          |
| `/api/auth/me`      | GET  | 验证 token，返回用户信息    |

所有 `/api/*` 路径（除上述和 `/api/health`）均需 Bearer Token 认证。

### 4.2 程序包管理

| 接口                            | 方法   | 说明                     |
| ------------------------------- | ------ | ------------------------ |
| `/api/binary/upload`            | POST   | multipart 上传，自动识别平台 |
| `/api/binary/list`              | GET    | 版本+平台列表              |
| `/api/binary/<version>/default` | PUT    | 设为默认版本              |
| `/api/binary/<version>`         | DELETE | 删除版本（?platform=删单个）|

### 4.3 配置生成与打包

| 接口                      | 方法 | 说明                        |
| ------------------------- | ---- | --------------------------- |
| `/api/server/generate`    | POST | 生成 frps.toml（官方格式）   |
| `/api/client/generate`    | POST | 生成 frpc.toml + [[proxies]] |
| `/api/server/package`     | POST | 打包（需 version + platform） |
| `/api/client/package`     | POST | 打包（需 version + platform） |

### 4.4 方案管理

| 接口                            | 方法   | 说明     |
| ------------------------------- | ------ | -------- |
| `/api/server/schema`            | GET    | 列出方案 |
| `/api/server/schema/<name>`     | GET    | 加载方案 |
| `/api/server/schema/<name>`     | POST   | 保存方案 |
| `/api/server/schema/<name>`     | DELETE | 删除方案 |
| `/api/client/schema/*`          | 同上   | 客户端   |

### 4.5 远程管理

| 接口                                   | 方法 | 说明                            |
| -------------------------------------- | ---- | ------------------------------- |
| `/api/connections`                     | GET  | 列出可连接的服务端（从方案读取） |
| `/api/connections/<id>`                | DELETE | 删除连接（即删除方案）        |
| `/api/connections/<id>/serverinfo`     | GET  | proxy → FRP /api/serverinfo     |
| `/api/connections/<id>/proxies`        | GET  | proxy → FRP /api/proxy/6种类型   |
| `/api/connections/<id>/clients`        | GET  | proxy → FRP /api/clients        |
| `/api/connections/<id>/clients/<key>`  | GET  | proxy → FRP 客户端详情          |
| `/api/connections/<id>/reload`         | GET  | proxy → FRP /api/reload         |

### 4.6 用户管理

| 接口                    | 方法   | 说明       |
| ----------------------- | ------ | ---------- |
| `/api/users`            | GET    | 用户列表   |
| `/api/users`            | POST   | 添加/更新  |
| `/api/users/<username>` | DELETE | 删除用户   |

---

## 5. TOML 配置生成规则

兼容 FRP v0.52+，使用 camelCase + dot-notation：

- `bindPort`、`vhostHTTPPort`、`subDomainHost`
- `webServer.port`、`webServer.user`、`webServer.password`
- `auth.method`、`auth.token`
- `log.to`、`log.level`
- 代理：`[[proxies]]` + `localIP`、`localPort`、`remotePort`、`transport.useEncryption` 等
- 端口号不加引号，字符串加引号，布尔值 true/false

---

## 6. Vite 开发代理

```js
// vite.config.js
export default {
  plugins: [react()],
  root: 'client',
  build: { outDir: 'client/dist' },
  server: { port: 5173, proxy: { '/api': 'http://localhost:3001' } },
};
```
