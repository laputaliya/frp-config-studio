# 架构设计文档

> **文档版本**：2.1
> **最后更新**：2026-06-05

---

## 1. 技术选型

| 层级     | 技术                         |
| -------- | ---------------------------- |
| 运行时   | Node.js 18+                  |
| 后端框架 | Express                      |
| 前端框架 | React 18                     |
| UI 库    | Bootstrap 5 + Bootstrap Icons |
| 构建工具 | Vite                         |
| ZIP 打包 | archiver                     |
| 解压     | tar + unzipper               |
| 认证     | Token 会话 + bcrypt 密码哈希  |
| 安全     | helmet / express-rate-limit  |
| 存储     | 文件系统（JSON）              |

---

## 2. 目录结构

```
├── server.js                    # Express 后端（全部 API）
├── client/                      # React 前端
│   └── src/
│       ├── App.jsx              # 根组件（认证、侧边栏、Tab）
│       ├── admin.css            # 管理后台样式
│       ├── frp-dashboard.css    # 远程管理 FRP 风格
│       ├── api.js               # API 封装（自动附加 Token）
│       ├── pages/
│       │   ├── LoginPage.jsx / HomePage.jsx
│       │   ├── BinaryManager.jsx / ServerConfig.jsx
│       │   ├── ClientConfig.jsx / RemoteManager.jsx
│       │   └── UserManager.jsx
│       └── components/
│           ├── ToastContext.jsx / ConfirmModal.jsx
│           ├── EmptyState.jsx / ConfigLayout.jsx
├── frp_bin/<version>/<os_arch>/ # 多平台二进制存储
├── config_schemas/server/       # 服务端方案
├── config_schemas/client/       # 客户端方案
├── packages/                    # 临时打包
├── users.json                   # 用户数据（bcrypt 哈希）
└── docs/
```

---

## 3. API 设计

### 3.1 认证
| 接口               | 方法 | 说明                    |
| ------------------ | ---- | ----------------------- |
| `/api/auth/login`  | POST | 登录，返回 Token        |
| `/api/auth/logout` | POST | 退出                    |
| `/api/auth/me`     | GET  | 验证 Token              |

所有 `/api/*`（除上述和 `/api/health`）需 Bearer Token + 角色授权。

### 3.2 程序包
| 接口                            | 方法   | 说明               |
| ------------------------------- | ------ | ------------------ |
| `/api/binary/upload`            | POST   | multipart 上传      |
| `/api/binary/list`              | GET    | 版本+平台列表       |
| `/api/binary/<version>/default` | PUT    | 设默认             |
| `/api/binary/<version>`         | DELETE | 删除版本或单个平台  |

### 3.3 配置生成
| 接口                      | 方法 | 说明               |
| ------------------------- | ---- | ------------------ |
| `/api/server/generate`    | POST | 生成 frps.toml      |
| `/api/client/generate`    | POST | 生成 frpc.toml      |
| `/api/server/package`     | POST | 打包服务端 ZIP      |
| `/api/client/package`     | POST | 打包客户端 ZIP      |

### 3.4 方案管理
| 接口                      | 方法   | 说明    |
| ------------------------- | ------ | ------- |
| `/api/server/schema/*`    | CRUD   | 服务端  |
| `/api/client/schema/*`    | CRUD   | 客户端  |

### 3.5 远程管理（代理 FRP Dashboard API）
| 接口                                        | 方法 | 说明                          |
| ------------------------------------------- | ---- | ----------------------------- |
| `/api/connections`                          | GET  | 从服务端方案自动读取连接        |
| `/api/connections/<id>/serverinfo`          | GET  | → FRP /api/serverinfo          |
| `/api/connections/<id>/proxies`             | GET  | → FRP 聚合 6 种代理类型        |
| `/api/connections/<id>/proxy/<type>/<name>` | GET  | → FRP 单个代理详情             |
| `/api/connections/<id>/traffic/<name>`      | GET  | → FRP /api/traffic/:name       |
| `/api/connections/<id>/clients`             | GET  | → FRP /api/clients             |
| `/api/connections/<id>/clients/<key>`       | GET  | → FRP 客户端详情               |
| `/api/connections/<id>/clients/<key>/proxies` | GET | 该客户端的代理列表             |
| `/api/connections/<id>/reload`              | GET  | → FRP /api/reload              |

### 3.6 用户管理
| 接口                  | 方法   | 说明     |
| --------------------- | ------ | -------- |
| `/api/users`          | GET    | 用户列表 |
| `/api/users`          | POST   | 添加/更新 |
| `/api/users/<name>`   | DELETE | 删除     |

---

## 4. 安全架构

- **路径穿越防护**：`safePath()` + `validateName()` 校验所有用户输入的文件路径
- **密码哈希**：bcrypt 12 轮加密存储，默认密码 admin/admin
- **角色授权**：`requireRole('admin')` 中间件保护管理接口
- **安全头**：`helmet` 提供 X-Frame-Options / X-Content-Type-Options 等
- **频率限制**：登录接口 15 分钟 10 次上限
- **CORS**：限制为开发/生产域名

---

## 5. TOML 生成规则

FRP v0.52+ 官方格式，camelCase + dot-notation：
- `bindPort`、`webServer.port`、`auth.token`、`log.to`
- 代理 `[[proxies]]`：`localIP`、`localPort`、`transport.useEncryption`
- `customDomains` 始终为数组格式
- `subdomain` 继承服务端 `subdomainHost`
