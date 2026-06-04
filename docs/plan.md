# FRP Config Studio — 开发实施计划

> **文档版本**：1.0
> **创建日期**：2026-06-04
> **状态**：待执行

---

## 阶段概览

| 阶段 | 名称 | 任务数 | 依赖 |
|------|------|--------|------|
| 1 | 项目脚手架 | 4 | 无 |
| 2 | 后端 API | 4 | 阶段 1 |
| 3 | 前端框架与共享组件 | 4 | 阶段 1 |
| 4 | 二进制管理页面 | 3 | 阶段 2、3 |
| 5 | 服务端配置页面 | 4 | 阶段 2、3 |
| 6 | 客户端配置页面 | 5 | 阶段 2、3 |
| 7 | 打磨、验证与生产构建 | 4 | 阶段 4、5、6 |

阶段 2 和阶段 3 可并行进行。阶段 4、5、6 可在阶段 2 和 3 完成后并行进行。

---

## 阶段 1：项目脚手架

**目标**：搭建项目骨架，安装所有依赖，配置构建工具，创建可运行的最小应用。

### 任务 1.1：初始化 npm 项目并安装依赖

- `npm init` 创建 `package.json`
- 生产依赖：`express`、`archiver`、`tar`、`unzipper`、`multer`、`cors`
- 开发依赖：`vite`、`@vitejs/plugin-react`、`react`、`react-dom`、`bootstrap`、`react-bootstrap`、`concurrently`
- npm scripts：`dev`（concurrently 并行启动 Express + Vite）、`build`（vite build）、`start`（node server.js）

**产出**：`package.json`

### 任务 1.2：创建 Vite 配置

- `vite.config.js`：配置 React 插件，root 设为 `client/`，proxy `/api` → `http://localhost:3001`，build.outDir 为 `client/dist/`

**产出**：`vite.config.js`

### 任务 1.3：创建 Express 服务端骨架

- `server.js`：Express + cors + JSON 中间件，serve `client/dist/`，`GET /api/health` 返回 `{"status":"ok"}`，监听 3001 端口，启动时创建 `frp_bin/`、`packages/`、`config_schemas/` 目录

**产出**：`server.js`

### 任务 1.4：创建最小 React 入口

- `client/index.html`（含 Bootstrap 5 CDN）
- `client/src/main.jsx`（渲染 `<App />`）
- `client/src/App.jsx`（占位组件）
- `client/src/api.js`（fetch 封装桩）

**产出**：4 个前端入口文件

---

## 阶段 2：后端 API

**目标**：实现架构文档中定义的所有 REST API 接口。

### 任务 2.1：二进制管理 API

- 配置 multer（100MB 限制、.tar.gz/.zip 过滤）
- `POST /api/binary/upload`：接收上传 → 解压 → 扫描 frps/frpc → 存入 `frp_bin/<version>/` → 更新 `versions.json`
- `GET /api/binary/list`：返回版本列表
- `PUT /api/binary/<version>/default`：设为默认版本
- `DELETE /api/binary/<version>`：删除版本

**关键决策**：版本元数据存为 `frp_bin/versions.json`

### 任务 2.2：配置生成 API

- `POST /api/server/generate`：接收表单 JSON → 生成 `frps.ini` 文本
- `POST /api/client/generate`：接收 common + proxies 数组 → 生成 `frpc.ini` 文本
- 空值字段跳过不输出，布尔值输出 `true`/`false`

### 任务 2.3：打包下载 API

- `POST /api/server/package`：校验 `frp_bin/<version>/frps` 存在 → archiver 流式打包 frps + frps.ini → 返回 ZIP 流
- `POST /api/client/package`：同上，使用 frpc + frpc.ini
- ZIP 命名：`frps_<version>_package.zip` / `frpc_<version>_package.zip`

### 任务 2.4：方案管理 API

- 服务端方案 CRUD：`/api/server/schema`（GET 列表、POST 保存、GET 加载、DELETE 删除）
- 客户端方案 CRUD：`/api/client/schema`（同上）
- 方案存储于 `config_schemas/server/` 和 `config_schemas/client/`

---

## 阶段 3：前端框架与共享组件

**目标**：搭建应用框架，包括标签页导航、API 工具模块、Toast 通知、响应式布局。

### 任务 3.1：API 工具模块

- `api.js`：封装 fetch，统一错误处理，导出各接口调用函数（uploadBinary、listBinaries、generateServerConfig 等）

**产出**：`client/src/api.js`

### 任务 3.2：Toast 通知组件

- `ToastContext.jsx`：React Context 全局 toast 状态管理
- `ToastContainer.jsx`：右下角弹出，3 秒自动消失，支持 success（绿）/ error（红）
- `useToast()` hook

**产出**：`ToastContext.jsx`、`ToastContainer.jsx`

### 任务 3.3：应用框架与标签页导航

- `App.jsx`：Bootstrap 5 Nav tabs（"二进制管理" | "服务端配置" | "客户端配置"），状态驱动标签切换，ToastProvider 包裹
- 三个页面的桩组件

**产出**：`App.jsx`、三个页面桩文件

### 任务 3.4：响应式布局与通用组件

- `ConfigLayout.jsx`：左右两栏布局（桌面端并排、移动端堆叠）
- `EmptyState.jsx`：空状态组件（图标 + 文案 + 可选操作按钮）
- `ConfirmModal.jsx`：确认对话框组件（Bootstrap Modal）

**产出**：`ConfigLayout.jsx`、`EmptyState.jsx`、`ConfirmModal.jsx`

---

## 阶段 4：二进制管理页面

**目标**：实现 UI 规格文档第 2 节描述的完整二进制管理页面。

### 任务 4.1：上传区域（拖拽）

- 拖拽上传区（虚线边框），中文引导文案
- 版本号输入框，文件名自动解析版本
- "上传"按钮，上传中状态，进度显示
- 成功→toast + 刷新列表，失败→toast 错误信息

### 任务 4.2：版本列表表格

- Bootstrap Table：版本、包含文件（badge）、上传时间、操作
- 默认版本高亮 + "⭐默认" 徽章
- "设为默认" / "删除"按钮 + 确认对话框
- 加载状态、空状态

### 任务 4.3：跨标签页导航

- 空状态"前往上传"按钮切换标签页
- 通过 Context 或 props 传递导航函数

---

## 阶段 5：服务端配置页面

**目标**：实现 UI 规格文档第 3 节描述的完整服务端配置页面。

### 任务 5.1：空状态与版本选择

- 无 frps 版本→空状态引导；有版本→渲染表单
- 版本选择下拉框（默认选中默认版本）

### 任务 5.2：配置表单与实时预览

- 10 个配置字段（中文标签、默认值）
- 防抖（300ms）调用 API 生成 INI 预览
- `<pre>` 标签展示预览内容

### 任务 5.3：方案管理 UI

- "方案名称"输入 + "保存方案" / "加载方案" / "删除方案"按钮
- 方案列表下拉选择加载
- 方案保存时包含版本号

### 任务 5.4：生成并下载

- "生成并下载服务端包"按钮
- 必填校验 → 生成 INI → 打包下载 → toast 提示

---

## 阶段 6：客户端配置页面

**目标**：实现 UI 规格文档第 4 节描述的完整客户端配置页面。

### 任务 6.1：空状态与版本选择

- 无 frpc 版本→空状态引导；有版本→渲染表单

### 任务 6.2：公共参数表单

- 7 个公共参数字段（中文标签、默认值）
- 防抖生成预览

### 任务 6.3：代理规则卡片 CRUD

- Bootstrap Card 展示每条代理规则
- 类型选择驱动动态字段显示（tcp/udp → remote_port，http → custom_domains/locations，stcp/xtcp → secret_key）
- "添加代理" / "删除"按钮

### 任务 6.4：客户端方案管理

- 同任务 5.3，使用客户端方案 API

### 任务 6.5：生成并下载

- "生成并下载客户端包"按钮
- 校验 server_addr/server_port → 生成 → 打包 → 下载

---

## 阶段 7：打磨、验证与生产构建

**目标**：表单验证、错误处理、响应式优化、生产构建、端到端验收。

### 任务 7.1：表单验证

- 客户端必填校验（红色边框 + "此项为必填"提示）
- 滚动到首个错误字段

### 任务 7.2：错误处理与边界情况

- 所有 API 调用统一错误处理（网络错误、服务端错误中文提示）
- 按钮"处理中..."加载态
- 竞态条件处理（取消前一个防抖请求）

### 任务 7.3：响应式布局与视觉打磨

- 移动端适配验证（< 768px 堆叠布局）
- Bootstrap 间距统一
- 添加 favicon

### 任务 7.4：生产构建与端到端验证

- `npm run build` → 验证 Express serve 静态文件
- 逐一验证验收标准 8 项
- README 使用说明更新

---

## 依赖关系图

```
阶段 1（脚手架）
  ├──> 阶段 2（后端 API）     ──┐
  │      ├──> 阶段 4（二进制）  │
  │      ├──> 阶段 5（服务端）  │
  │      └──> 阶段 6（客户端）  │
  └──> 阶段 3（前端框架）    ──┘
         ├──> 阶段 4（二进制）
         ├──> 阶段 5（服务端）
         └──> 阶段 6（客户端）

阶段 4 + 5 + 6 ──> 阶段 7（打磨）
```

---

## 文件清单

| 文件 | 阶段 | 类型 |
|------|------|------|
| `package.json` | 1.1 | 新建 |
| `vite.config.js` | 1.2 | 新建 |
| `server.js` | 1.3, 2.1-2.4 | 新建 |
| `client/index.html` | 1.4, 3.4 | 新建 |
| `client/src/main.jsx` | 1.4 | 新建 |
| `client/src/App.jsx` | 1.4, 3.3, 4.3 | 新建 |
| `client/src/api.js` | 1.4, 3.1, 5.4 | 新建 |
| `client/src/components/ToastContext.jsx` | 3.2 | 新建 |
| `client/src/components/ToastContainer.jsx` | 3.2 | 新建 |
| `client/src/components/ConfigLayout.jsx` | 3.4 | 新建 |
| `client/src/components/EmptyState.jsx` | 3.4 | 新建 |
| `client/src/components/ConfirmModal.jsx` | 3.4 | 新建 |
| `client/src/pages/BinaryManager.jsx` | 3.3, 4.1-4.2 | 新建 |
| `client/src/pages/ServerConfig.jsx` | 3.3, 5.1-5.4 | 新建 |
| `client/src/pages/ClientConfig.jsx` | 3.3, 6.1-6.5 | 新建 |

**共 15 个新建文件，1 个可能修改文件（README.md）**

---

## 关键文件

以下 5 个文件构成项目核心，需要最仔细的实现：

- `server.js` — 所有后端逻辑集中于此
- `package.json` — 依赖管理与脚本定义
- `client/src/api.js` — 所有页面组件依赖的 API 门面
- `client/src/pages/ClientConfig.jsx` — 最复杂的组件（表单 + 动态代理 + 方案管理）
- `client/src/App.jsx` — 根组件（标签路由 + 状态提升 + Toast 包裹）

---

## 风险与缓解

| 风险 | 缓解措施 |
|------|----------|
| tar 解压路径穿越 | 仅扫描根目录及一级子目录，忽略其他 |
| 大文件上传内存溢出 | Multer 100MB 限制，archiver 流式压缩 |
| 代理规则字段复杂度增长 | 状态对象统一存储，条件渲染，后端按类型分发 |
| 跨平台路径兼容 | 统一使用 `path.join()` / `path.resolve()` |
