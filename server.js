const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const archiver = require('archiver');
const tar = require('tar');
const unzipper = require('unzipper');

const app = express();
const PORT = process.env.PORT || 3001;

// ── 目录路径 ──────────────────────────────────────────────
const FRP_BIN_DIR = path.join(__dirname, 'frp_bin');
const PACKAGES_DIR = path.join(__dirname, 'packages');
const SCHEMAS_DIR = path.join(__dirname, 'config_schemas');
const CONNECTIONS_DIR = path.join(__dirname, 'server_connections');
const VERSIONS_FILE = path.join(FRP_BIN_DIR, 'versions.json');

// ── 初始化 ────────────────────────────────────────────────
[FRP_BIN_DIR, PACKAGES_DIR, SCHEMAS_DIR, path.join(SCHEMAS_DIR, 'server'), path.join(SCHEMAS_DIR, 'client'), CONNECTIONS_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// 初始化版本元数据文件
function loadVersions() {
  try {
    if (fs.existsSync(VERSIONS_FILE)) {
      return JSON.parse(fs.readFileSync(VERSIONS_FILE, 'utf-8'));
    }
  } catch (_) { /* ignore */ }
  return { versions: {} };
}

function saveVersions(data) {
  fs.writeFileSync(VERSIONS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function getDefaultVersion() {
  const meta = loadVersions();
  const entry = Object.entries(meta.versions).find(([, v]) => v.default);
  return entry ? entry[0] : null;
}

// ── 中间件 ────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ── 认证中间件 ────────────────────────────────────────────
const crypto = require('crypto');
const sessions = {};

const PUBLIC_PATHS = ['/api/auth/login', '/api/health'];

app.use((req, res, next) => {
  if (!req.path.startsWith('/api/') || PUBLIC_PATHS.includes(req.path)) return next();
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token || !sessions[token] || sessions[token].expires < Date.now()) {
    if (token) delete sessions[token];
    return res.status(401).json({ error: '未登录或会话已过期' });
  }
  next();
});

// ── 文件上传配置 ──────────────────────────────────────────
const upload = multer({
  dest: path.join(__dirname, 'uploads_tmp'),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
  fileFilter: (_req, file, cb) => {
    const name = file.originalname.toLowerCase();
    if (name.endsWith('.tar.gz') || name.endsWith('.zip')) {
      cb(null, true);
    } else {
      cb(new Error('仅支持 .tar.gz 和 .zip 格式'));
    }
  },
});

// ── 工具函数 ──────────────────────────────────────────────

/** 从文件名解析版本号和平台 */
function parseFilename(filename) {
  // frp_0.61.0_linux_amd64.tar.gz 或 frp_0.61.0_windows_amd64.zip
  const match = filename.match(/frp[cs]?_(\d+\.\d+\.\d+)_(linux|windows|darwin|freebsd|android)_(\w+)\.(tar\.gz|zip)$/i);
  if (match) {
    return { version: match[1], os: match[2].toLowerCase(), arch: match[3].toLowerCase() };
  }
  return null;
}

/** 流式解压 tar.gz */
async function extractTarGz(filePath, destDir) {
  const tmpDir = path.join(destDir, '_tmp');
  fs.mkdirSync(tmpDir, { recursive: true });

  await tar.extract({
    file: filePath,
    cwd: tmpDir,
    filter: (entryPath) => {
      return !!normalizeBinName(path.basename(entryPath));
    },
  });

  // 扫描 tmpDir 递归查找 frps/frpc，移动到 destDir
  const found = [];
  scanRecursive(tmpDir, found);

  for (const name of found) {
    // 找到文件并移动到 destDir
    const foundPath = findFile(tmpDir, name);
    if (foundPath) {
      fs.renameSync(foundPath, path.join(destDir, name));
    }
  }

  // 清理临时目录
  fs.rmSync(tmpDir, { recursive: true });
  return [...new Set(found)];
}

/** 判断是否为 frps/frpc 文件，返回标准化名称 */
function normalizeBinName(name) {
  const lower = name.toLowerCase();
  if (lower === 'frps' || lower === 'frps.exe') return 'frps';
  if (lower === 'frpc' || lower === 'frpc.exe') return 'frpc';
  return null;
}

/** 递归扫描目录收集 frps/frpc */
function scanRecursive(dir, files) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        scanRecursive(path.join(dir, entry.name), files);
      } else {
        const bin = normalizeBinName(entry.name);
        if (bin) files.push(bin);
      }
    }
  } catch (_) { /* ignore */ }
}

/** 在目录中递归查找指定标准化名称的文件 */
function findFile(dir, binName) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = findFile(fullPath, binName);
        if (found) return found;
      } else if (normalizeBinName(entry.name) === binName) {
        return fullPath;
      }
    }
  } catch (_) { /* ignore */ }
  return null;
}

/** 解压 zip */
async function extractZip(filePath, destDir) {
  const files = [];
  return new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(unzipper.Parse())
      .on('entry', (entry) => {
        const bin = normalizeBinName(path.basename(entry.path));
        if (bin) {
          files.push(bin);
          // 统一存储为无扩展名形式
          entry.pipe(fs.createWriteStream(path.join(destDir, bin)));
        } else {
          entry.autodrain();
        }
      })
      .on('close', () => resolve([...new Set(files)]))
      .on('error', reject);
  });
}

/** 构建 INI 段落 */
function buildIniSection(header, fields) {
  const lines = [];
  let hasContent = false;
  for (const [key, value] of Object.entries(fields)) {
    if (value === null || value === undefined || value === '') continue;
    hasContent = true;
    lines.push(`${key} = ${value}`);
  }
  return hasContent ? [`[${header}]`, ...lines, ''].join('\n') : '';
}

// ── 健康检查 ──────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// ── 二进制管理 API ────────────────────────────────────────

// 上传二进制包
app.post('/api/binary/upload', (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? '文件大小超过 100MB 限制'
        : err.message;
      return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: msg });
    }

    if (!req.file) {
      return res.status(400).json({ error: '请选择要上传的文件' });
    }

    // 解析文件名
    const parsed = parseFilename(req.file.originalname);
    if (!parsed) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: '无法从文件名识别版本号和平台，请使用标准命名如 frp_0.61.0_linux_amd64.tar.gz' });
    }

    const { version, os, arch } = parsed;
    const platformKey = `${os}_${arch}`;
    const versionDir = path.join(FRP_BIN_DIR, version);
    const platformDir = path.join(versionDir, platformKey);
    const fileName = req.file.originalname.toLowerCase();

    try {
      // 不删除整个版本目录，只覆盖同平台（如果存在则先删除该平台目录再解压）
      if (fs.existsSync(platformDir)) {
        fs.rmSync(platformDir, { recursive: true });
      }
      fs.mkdirSync(platformDir, { recursive: true });

      let foundFiles = [];
      if (fileName.endsWith('.tar.gz')) {
        foundFiles = await extractTarGz(req.file.path, platformDir);
      } else {
        foundFiles = await extractZip(req.file.path, platformDir);
      }

      if (foundFiles.length === 0) {
        fs.rmSync(platformDir, { recursive: true });
        return res.status(400).json({ error: '压缩包中未找到 frps 或 frpc 可执行文件' });
      }

      // 合并版本元数据
      const meta = loadVersions();
      if (!meta.versions[version]) {
        meta.versions[version] = { platforms: {}, default: false, uploadedAt: new Date().toISOString() };
      }
      if (Object.keys(meta.versions).length === 1 && Object.keys(meta.versions[version].platforms).length === 0) {
        meta.versions[version].default = true;
      }
      meta.versions[version].platforms[platformKey] = { os, arch, files: foundFiles, uploadedAt: new Date().toISOString() };
      meta.versions[version].uploadedAt = new Date().toISOString();
      saveVersions(meta);

      res.json({ version, platform: platformKey, os, arch, files: foundFiles });
    } catch (e) {
      if (fs.existsSync(platformDir)) fs.rmSync(platformDir, { recursive: true });
      res.status(500).json({ error: `解压失败: ${e.message}` });
    } finally {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    }
  });
});

// 列出所有版本
app.get('/api/binary/list', (_req, res) => {
  const meta = loadVersions();
  const list = Object.entries(meta.versions)
    .map(([version, info]) => ({
      version,
      default: info.default,
      uploadedAt: info.uploadedAt,
      platforms: info.platforms || {},
    }))
    .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
  res.json(list);
});

// 设为默认版本
app.put('/api/binary/:version/default', (req, res) => {
  const { version } = req.params;
  const meta = loadVersions();

  if (!meta.versions[version]) {
    return res.status(404).json({ error: '版本不存在' });
  }

  // 清除旧的默认
  Object.values(meta.versions).forEach((v) => { v.default = false; });
  meta.versions[version].default = true;
  saveVersions(meta);

  res.json({ ok: true });
});

// 删除版本（或单个平台）
app.delete('/api/binary/:version', (req, res) => {
  const { version } = req.params;
  const platform = req.query.platform;
  const meta = loadVersions();

  if (!meta.versions[version]) {
    return res.status(404).json({ error: '版本不存在' });
  }

  if (platform) {
    // 删除单个平台
    delete meta.versions[version].platforms[platform];
    const platformDir = path.join(FRP_BIN_DIR, version, platform);
    if (fs.existsSync(platformDir)) fs.rmSync(platformDir, { recursive: true });
    // 如果该版本没有任何平台了，删除整个版本
    if (Object.keys(meta.versions[version].platforms).length === 0) {
      delete meta.versions[version];
      const versionDir = path.join(FRP_BIN_DIR, version);
      if (fs.existsSync(versionDir)) fs.rmSync(versionDir, { recursive: true });
    }
  } else {
    delete meta.versions[version];
    const versionDir = path.join(FRP_BIN_DIR, version);
    if (fs.existsSync(versionDir)) fs.rmSync(versionDir, { recursive: true });
  }

  if (meta.versions[version]?.default || !Object.keys(meta.versions).length) {
    const first = Object.keys(meta.versions)[0];
    if (first) meta.versions[first].default = true;
  }
  saveVersions(meta);
  res.json({ ok: true });
});

// ── TOML 工具函数 ──────────────────────────────────────────

function tomlKeyVal(key, value) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'boolean') return `${key} = ${value}`;
  if (typeof value === 'number') return `${key} = ${value}`;
  // 纯数字字符串不加引号
  if (typeof value === 'string' && /^\d+$/.test(value)) return `${key} = ${value}`;
  return `${key} = "${value}"`;
}

function tomlSection(lines) {
  return lines.filter(Boolean).join('\n');
}

// ── 配置生成 API ──────────────────────────────────────────

// 生成服务端配置预览
app.post('/api/server/generate', (req, res) => {
  const lines = [
    tomlKeyVal('bindAddr', '0.0.0.0'),
    tomlKeyVal('bindPort', req.body.bind_port),
    tomlKeyVal('vhostHTTPPort', req.body.vhost_http_port),
    tomlKeyVal('vhostHTTPSPort', req.body.vhost_https_port),
    tomlKeyVal('subDomainHost', req.body.subdomain_host),
    '',
    '# 管理面板',
    tomlKeyVal('webServer.addr', '0.0.0.0'),
    tomlKeyVal('webServer.port', req.body.dashboard_port),
    req.body.dashboard_user ? tomlKeyVal('webServer.user', req.body.dashboard_user) : '',
    req.body.dashboard_pwd ? tomlKeyVal('webServer.password', req.body.dashboard_pwd) : '',
    '',
    '# 认证',
    req.body.token ? 'auth.method = "token"' : '',
    req.body.token ? tomlKeyVal('auth.token', req.body.token) : '',
    '',
    '# 日志',
    tomlKeyVal('log.to', req.body.log_file),
    tomlKeyVal('log.level', req.body.log_level),
  ];

  res.json({ ini: tomlSection(lines) });
});

// 生成客户端配置预览
app.post('/api/client/generate', (req, res) => {
  const { common = {}, proxies = [] } = req.body;

  const lines = [
    tomlKeyVal('serverAddr', common.server_addr),
    tomlKeyVal('serverPort', common.server_port),
    '',
    '# 认证',
    common.token ? 'auth.method = "token"' : '',
    common.token ? tomlKeyVal('auth.token', common.token) : '',
    '',
    '# 管理面板',
    tomlKeyVal('webServer.addr', common.admin_addr),
    tomlKeyVal('webServer.port', common.admin_port),
    '',
    '# 日志',
    tomlKeyVal('log.to', common.log_file),
    tomlKeyVal('log.level', common.log_level),
  ];

  for (const proxy of proxies) {
    if (!proxy.name) continue;

    lines.push('', '[[proxies]]');
    lines.push(tomlKeyVal('name', proxy.name));
    lines.push(tomlKeyVal('type', proxy.type));
    lines.push(tomlKeyVal('localIP', proxy.local_ip));
    lines.push(tomlKeyVal('localPort', proxy.local_port));

    if (proxy.type === 'tcp' || proxy.type === 'udp') {
      lines.push(tomlKeyVal('remotePort', proxy.remote_port));
    }

    lines.push(tomlKeyVal('transport.useEncryption', proxy.use_encryption || false));
    lines.push(tomlKeyVal('transport.useCompression', proxy.use_compression || false));

    // 类型特有字段
    if (proxy.type === 'http' || proxy.type === 'https') {
      if (proxy.custom_domains) {
        const domains = proxy.custom_domains.split(',').map((d) => d.trim()).filter(Boolean);
        if (domains.length === 1) {
          lines.push(tomlKeyVal('customDomains', domains[0]));
        } else if (domains.length > 1) {
          lines.push(`customDomains = ["${domains.join('", "')}"]`);
        }
      }
      if (proxy.type === 'http') {
        if (proxy.locations) lines.push(tomlKeyVal('locations', proxy.locations));
        if (proxy.host_header_rewrite) lines.push(tomlKeyVal('hostHeaderRewrite', proxy.host_header_rewrite));
      }
    }
    if (proxy.type === 'stcp' || proxy.type === 'xtcp') {
      if (proxy.secret_key) lines.push(tomlKeyVal('secretKey', proxy.secret_key));
      if (proxy.allow_users) lines.push(tomlKeyVal('allowUsers', proxy.allow_users));
    }
  }

  res.json({ ini: tomlSection(lines) });
});

// ── 打包下载 API ──────────────────────────────────────────

function createPackage(res, type, version, platform, iniContent) {
  const binFile = type === 'server' ? 'frps' : 'frpc';
  const tomlFile = type === 'server' ? 'frps.toml' : 'frpc.toml';
  const zipName = `${binFile}_${version}_${platform}_package.zip`;

  const platformDir = path.join(FRP_BIN_DIR, version, platform);
  const binPath = path.join(platformDir, binFile);
  if (!fs.existsSync(binPath)) {
    return res.status(400).json({ error: `版本 ${version} 平台 ${platform} 缺少 ${binFile} 文件` });
  }

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

  const isWindows = platform.startsWith('windows');
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (err) => res.status(500).json({ error: `打包失败: ${err.message}` }));
  archive.pipe(res);

  // 可执行文件：Windows 加 .exe 后缀
  const exeName = isWindows ? `${binFile}.exe` : binFile;
  archive.file(binPath, { name: exeName });

  // 配置文件
  archive.append(iniContent, { name: tomlFile });

  // 平台对应的启动脚本
  if (isWindows) {
    archive.append(`@echo off\r\nREM ${binFile} 启动脚本\r\n${exeName} -c ${tomlFile}\r\n`, { name: `start_${binFile}.bat` });
  } else {
    archive.append(`#!/bin/sh\n# ${binFile} 启动脚本\nchmod +x ./${exeName}\n./${exeName} -c ${tomlFile}\n`, { name: `start_${binFile}.sh` });
  }

  // 使用说明
  const osLabel = platform.replace('_', ' / ');
  const roleCN = type === 'server' ? '服务端 (frps)' : '客户端 (frpc)';
  const readme = [
    `FRP ${roleCN} 部署包`,
    `版本：${version}  平台：${osLabel}`,
    `生成时间：${new Date().toLocaleString('zh-CN')}`,
    '',
    '文件说明：',
    `  ${exeName}               - FRP 可执行程序`,
    `  ${tomlFile}            - 配置文件（TOML 格式）`,
    isWindows ? `  start_${binFile}.bat      - Windows 启动脚本` : `  start_${binFile}.sh       - Linux / macOS 启动脚本`,
    '  README.txt              - 本说明文件',
    '',
    '使用方法：',
    isWindows
      ? `  双击 start_${binFile}.bat 启动`
      : `  chmod +x start_${binFile}.sh && ./start_${binFile}.sh`,
    `  或直接运行：./${exeName} -c ${tomlFile}`,
    '',
    type === 'server' ? '启动后可访问 http://<服务器IP>:<dashboard_port> 进入管理面板。' : '确保服务端已启动且防火墙已放行对应端口。',
    '',
    '更多配置说明请参考：https://github.com/fatedier/frp',
    '',
    '注意：如果杀毒软件（如 Windows Defender、macOS Gatekeeper）',
    '报告病毒或恶意软件，这是对未签名可执行文件的误报。',
    'FRP 是 GitHub 开源项目（9万+ Star），可放心使用。',
    '如需解除 macOS 限制，运行：xattr -d com.apple.quarantine frps',
    '',
    '--- 由 FRP Config Studio 生成 ---',
  ].join('\n');
  archive.append(readme, { name: 'README.txt' });
  archive.finalize();
}

app.post('/api/server/package', (req, res) => {
  const { ini, version, platform } = req.body;
  if (!ini || !version || !platform) {
    return res.status(400).json({ error: '缺少配置内容、版本号或平台' });
  }
  createPackage(res, 'server', version, platform, ini);
});

app.post('/api/client/package', (req, res) => {
  const { ini, version, platform } = req.body;
  if (!ini || !version || !platform) {
    return res.status(400).json({ error: '缺少配置内容、版本号或平台' });
  }
  createPackage(res, 'client', version, platform, ini);
});

// ── 方案管理 API ──────────────────────────────────────────

function schemaRoutes(routerPrefix, schemaDir) {
  // 列出方案
  app.get(`/api/${routerPrefix}/schema`, (_req, res) => {
    const dirPath = path.join(SCHEMAS_DIR, schemaDir);
    try {
      if (!fs.existsSync(dirPath)) {
        return res.json([]);
      }
      const files = fs.readdirSync(dirPath).filter((f) => f.endsWith('.json'));
      const schemas = files.map((f) => {
        const filePath = path.join(dirPath, f);
        const stat = fs.statSync(filePath);
        const entry = { name: f.replace('.json', ''), createdAt: stat.birthtime.toISOString() };
        // 读取 linkedServer（仅客户端方案有此字段）
        try {
          const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          if (content.linkedServer) {
            entry.linkedServer = content.linkedServer;
          }
        } catch (_) { /* ignore parse error */ }
        return entry;
      });
      res.json(schemas);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 保存方案
  app.post(`/api/${routerPrefix}/schema/:name`, (req, res) => {
    const { name } = req.params;
    const dirPath = path.join(SCHEMAS_DIR, schemaDir);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    try {
      fs.writeFileSync(path.join(dirPath, `${name}.json`), JSON.stringify(req.body, null, 2), 'utf-8');
      res.json({ ok: true, name });
    } catch (e) {
      res.status(500).json({ error: `保存失败: ${e.message}` });
    }
  });

  // 加载方案
  app.get(`/api/${routerPrefix}/schema/:name`, (req, res) => {
    const { name } = req.params;
    const filePath = path.join(SCHEMAS_DIR, schemaDir, `${name}.json`);
    try {
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: '方案不存在' });
      }
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      res.json(data);
    } catch (e) {
      res.status(400).json({ error: '方案数据损坏' });
    }
  });

  // 删除方案
  app.delete(`/api/${routerPrefix}/schema/:name`, (req, res) => {
    const { name } = req.params;
    const filePath = path.join(SCHEMAS_DIR, schemaDir, `${name}.json`);
    try {
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: '方案不存在' });
      }
      fs.unlinkSync(filePath);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: `删除失败: ${e.message}` });
    }
  });
}

schemaRoutes('server', 'server');
schemaRoutes('client', 'client');

// ── 认证 API ──────────────────────────────────────────────
function generateToken() { return crypto.randomBytes(32).toString('hex'); }

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '请输入用户名和密码' });
  const data = loadUsers();
  const user = data.users.find((u) => u.username === username && u.password === password);
  if (!user) return res.status(401).json({ error: '用户名或密码错误' });
  const token = generateToken();
  sessions[token] = { username: user.username, role: user.role, expires: Date.now() + 24 * 3600 * 1000 };
  res.json({ token, username: user.username, role: user.role });
});

app.post('/api/auth/logout', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token) delete sessions[token];
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token || !sessions[token] || sessions[token].expires < Date.now()) {
    if (token) delete sessions[token];
    return res.status(401).json({ error: '未登录' });
  }
  res.json({ username: sessions[token].username, role: sessions[token].role });
});

// ── 用户管理 API ──────────────────────────────────────────
const USERS_FILE = path.join(__dirname, 'users.json');

function loadUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
  } catch (_) {}
  // 默认管理员
  const def = { users: [{ username: 'admin', password: 'admin', role: 'admin', createdAt: new Date().toISOString() }] };
  fs.writeFileSync(USERS_FILE, JSON.stringify(def, null, 2), 'utf-8');
  return def;
}

function saveUsers(data) { fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2), 'utf-8'); }

app.get('/api/users', (_req, res) => {
  const data = loadUsers();
  res.json(data.users.map((u) => ({ username: u.username, role: u.role, createdAt: u.createdAt })));
});

app.post('/api/users', (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password) return res.status(400).json({ error: '用户名和密码为必填项' });
  const data = loadUsers();
  const exist = data.users.find((u) => u.username === username);
  if (exist) {
    // 更新
    exist.password = password;
    exist.role = role || 'user';
  } else {
    data.users.push({ username, password, role: role || 'user', createdAt: new Date().toISOString() });
  }
  saveUsers(data);
  res.json({ ok: true });
});

app.delete('/api/users/:username', (req, res) => {
  const data = loadUsers();
  const idx = data.users.findIndex((u) => u.username === req.params.username);
  if (idx === -1) return res.status(404).json({ error: '用户不存在' });
  if (req.params.username === 'admin') return res.status(400).json({ error: '不能删除默认管理员' });
  data.users.splice(idx, 1);
  saveUsers(data);
  res.json({ ok: true });
});

// ── 远程服务端管理 API ────────────────────────────────────
// 连接数据从 config_schemas/server/ 中的服务端方案读取
// 有 server_addr + dashboard_port 的即视为可连接

function loadConnection(id) {
  // URL 解码（处理中文等特殊字符）
  const decodedId = decodeURIComponent(id);
  const filePath = path.join(SCHEMAS_DIR, 'server', `${decodedId}.json`);
  if (!fs.existsSync(filePath)) return null;
  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  if (!data.server_addr || !data.dashboard_port) return null;
  return {
    id: decodedId,
    name: decodedId,
    addr: data.server_addr,
    port: data.dashboard_port || '7500',
    user: data.dashboard_user || 'admin',
    password: data.dashboard_pwd || 'admin',
    serverInfo: data,
  };
}

// 列出所有可用连接（从服务端方案中读取）
app.get('/api/connections', (_req, res) => {
  try {
    const dirPath = path.join(SCHEMAS_DIR, 'server');
    if (!fs.existsSync(dirPath)) return res.json([]);
    const files = fs.readdirSync(dirPath).filter((f) => f.endsWith('.json'));
    const connections = files
      .map((f) => loadConnection(f.replace('.json', '')))
      .filter(Boolean);
    res.json(connections);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 删除连接（即删除对应的服务端方案）
app.delete('/api/connections/:id', (req, res) => {
  const filePath = path.join(SCHEMAS_DIR, 'server', `${req.params.id}.json`);
  try {
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: '连接不存在' });
    fs.unlinkSync(filePath);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 代理请求到远程 FRP Dashboard
async function frpProxy(id, apiPath, res) {
  const conn = loadConnection(id);
  if (!conn) {
    return res.status(404).json({ error: '连接不存在，请在服务端配置中填写远程服务器地址和面板信息' });
  }
  const baseUrl = `http://${conn.addr}:${conn.port}`;
  const auth = Buffer.from(`${conn.user}:${conn.password}`).toString('base64');

  try {
    const resp = await fetch(`${baseUrl}${apiPath}`, {
      headers: { 'Authorization': `Basic ${auth}` },
      signal: AbortSignal.timeout(10000),
    });

    if (resp.status === 401 || resp.status === 403) {
      return res.status(502).json({ error: '认证失败，请检查用户名和密码' });
    }
    if (resp.status === 404) {
      return res.status(502).json({ error: '远程服务端不支持此接口，请确认 FRP 版本' });
    }

    const contentType = resp.headers.get('content-type') || '';
    if (!contentType.includes('json')) {
      // 空响应或非 JSON：返回空数据
      if (resp.status === 200) {
        return res.json({ clients: [], proxies: [] });
      }
      return res.status(502).json({ error: `远程服务端返回非 JSON 响应 (HTTP ${resp.status})` });
    }
    const data = await resp.json();
    res.json(data);
  } catch (e) {
    if (e.cause?.code === 'ECONNREFUSED' || e.message.includes('fetch failed')) {
      return res.status(502).json({ error: '无法连接到远程服务端，请检查地址和端口是否正确' });
    }
    if (e.message.includes('timeout') || e.name === 'AbortError') {
      return res.status(502).json({ error: '连接远程服务端超时' });
    }
    res.status(502).json({ error: `远程服务端错误: ${e.message}` });
  }
}

app.get('/api/connections/:id/serverinfo', (req, res) => {
  frpProxy(req.params.id, '/api/serverinfo', res);
});

// 聚合所有代理类型
app.get('/api/connections/:id/proxies', async (req, res) => {
  const conn = loadConnection(req.params.id);
  if (!conn) {
    return res.status(404).json({ error: '连接不存在，请在服务端配置中填写远程服务器地址和面板信息' });
  }
  const baseUrl = `http://${conn.addr}:${conn.port}`;
  const auth = Buffer.from(`${conn.user}:${conn.password}`).toString('base64');
  const headers = { 'Authorization': `Basic ${auth}` };

  const proxyTypes = ['tcp', 'udp', 'http', 'https', 'stcp', 'xtcp'];
  const allProxies = [];

  for (const pType of proxyTypes) {
    try {
      const resp = await fetch(`${baseUrl}/api/proxy/${pType}`, {
        headers,
        signal: AbortSignal.timeout(5000),
      });
      const data = await resp.json();
      if (data.proxies && data.proxies.length > 0) {
        for (const p of data.proxies) {
          p.type = p.type || pType;
          allProxies.push(p);
        }
      }
    } catch (_) { /* ignore individual type failures */ }
  }

  res.json({ proxies: allProxies });
});

// 获取连接的客户端列表
app.get('/api/connections/:id/clients', (req, res) => {
  frpProxy(req.params.id, '/api/clients', res);
});

// 获取单个客户端详情
app.get('/api/connections/:id/clients/:clientKey', (req, res) => {
  frpProxy(req.params.id, `/api/clients/${decodeURIComponent(req.params.clientKey)}`, res);
});

app.get('/api/connections/:id/reload', (req, res) => {
  frpProxy(req.params.id, '/api/reload', res);
});

// ── 生产模式静态文件 ──────────────────────────────────────
const distPath = path.join(__dirname, 'client', 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// ── 全局错误处理 ──────────────────────────────────────────
app.use((err, _req, res, _next) => {
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: '文件大小超过 100MB 限制' });
  }
  res.status(500).json({ error: err.message || '服务器内部错误' });
});

// ── 启动 ──────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`FRP Config Studio 已启动: http://localhost:${PORT}`);
});
