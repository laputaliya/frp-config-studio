# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 在此仓库中工作时提供指导。

## 项目概述

FRP Config Studio（FRP 配置工坊）是一个 Web 可视化的 FRP 配置生成与打包工具。用户上传 FRP 二进制包后，通过图形界面配置 frps/frpc 参数，一键生成包含可执行程序与配置文件的部署压缩包。

## 文档索引

| 文档 | 内容 |
|------|------|
| [docs/requirements.md](docs/requirements.md) | 功能需求、非功能需求、验收标准（v2.0） |
| [docs/architecture.md](docs/architecture.md) | 技术选型、API 设计、数据流、目录结构（v2.0） |
| [docs/ui-spec.md](docs/ui-spec.md) | 页面布局、组件行为、交互规范（v2.0） |
| [README.md](README.md) | 项目介绍、快速开始、使用流程 |

## 技术栈概要

Node.js 18+ / Express / React 18 / Bootstrap 5 + Bootstrap Icons / Vite / archiver / tar + unzipper

## 关键架构约束

- 前端 React SPA（Vite 构建），后端 Express REST API。
- 开发时 Vite（:5173）代理 `/api` → Express（:3001），生产时 Express serve `client/dist/`。
- 所有 API（除 `/api/auth/login` 和 `/api/health`）需要 Bearer Token 认证。
- Token 从 `localStorage` 读取，`api.js` 的 `request()` 自动附加。
- 二进制按 `frp_bin/<version>/<os_arch>/frps` 存储，文件名自动解析版本+平台+架构。
- 配置生成使用 FRP 官方 TOML 格式（camelCase + dot-notation），非 INI。
- 远程管理连接数据从服务端方案（`config_schemas/server/`）自动读取。
- 方案保存时记录版本号和平台，加载时恢复。

## 常用命令

```bash
npm install          # 安装依赖
npm run dev          # 开发模式（前后端同时启动）
npm run build        # 构建前端
node server.js       # 生产模式启动
```
