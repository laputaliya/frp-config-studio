const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const fs = require('fs');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const multer = require('multer');
const archiver = require('archiver');
const tar = require('tar');
const unzipper = require('unzipper');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3001;
const BCRYPT_ROUNDS = 12;

// ── 目录路径 ──────────────────────────────────────────────
const FRP_BIN_DIR = path.join(__dirname, 'frp_bin');
const PACKAGES_DIR = path.join(__dirname, 'packages');
const SCHEMAS_DIR = path.join(__dirname, 'config_schemas');
const VERSIONS_FILE = path.join(FRP_BIN_DIR, 'versions.json');
const USERS_FILE = path.join(__dirname, 'users.json');

// ── 初始化 ────────────────────────────────────────────────
[FRP_BIN_DIR, PACKAGES_DIR, SCHEMAS_DIR,
  path.join(SCHEMAS_DIR, 'server'), path.join(SCHEMAS_DIR, 'client')].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// 清理临时上传目录
const TMP_DIR = path.join(__dirname, 'uploads_tmp');
if (fs.existsSync(TMP_DIR)) {
  fs.readdirSync(TMP_DIR).forEach((f) => {
    try { fs.unlinkSync(path.join(TMP_DIR, f)); } catch (_) {}
  });
}

// ── 路径安全工具 ──────────────────────────────────────────
function safePath(baseDir, ...segments) {
  const resolved = path.resolve(path.join(baseDir, ...segments));
  const baseResolved = path.resolve(baseDir);
  if (!resolved.startsWith(baseResolved + path.sep) && resolved !== baseResolved) {
    throw new Error('路径穿越检测');
  }
  return resolved;
}

function validateName(name) {
  if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) {
    throw new Error('非法名称');
  }
  return name;
}

// ── 版本元数据 ────────────────────────────────────────────
function loadVersions() {
  try {
    if (fs.existsSync(VERSIONS_FILE)) return JSON.parse(fs.readFileSync(VERSIONS_FILE, 'utf-8'));
  } catch (_) {}
  return { versions: {} };
}
function saveVersions(data) { fs.writeFileSync(VERSIONS_FILE, JSON.stringify(data, null, 2), 'utf-8'); }

// ── 用户管理 ──────────────────────────────────────────────
function loadUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
  } catch (_) {}
  const hash = bcrypt.hashSync('admin', BCRYPT_ROUNDS);
  const def = { users: [{ username: 'admin', passwordHash: hash, role: 'admin', createdAt: new Date().toISOString() }] };
  fs.writeFileSync(USERS_FILE, JSON.stringify(def, null, 2), 'utf-8');
  return def;
}
function saveUsers(data) { fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2), 'utf-8'); }

// ── 认证会话 ──────────────────────────────────────────────
const sessions = {};

// 每5分钟清理过期会话
setInterval(() => {
  const now = Date.now();
  Object.keys(sessions).forEach((t) => {
    if (sessions[t].expires < now) delete sessions[t];
  });
}, 5 * 60 * 1000);

function generateToken() { return crypto.randomBytes(32).toString('hex'); }

// ── 中间件 ────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // 允许 Bootstrap CDN
  crossOriginEmbedderPolicy: false,
}));
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || 'http://localhost:5173', credentials: true }));
app.use(express.json());

// 登录频率限制
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: '登录尝试过多，请15分钟后重试' },
});

// ── 认证中间件 ────────────────────────────────────────────
const PUBLIC_PATHS = ['/api/auth/login', '/api/health'];

app.use((req, res, next) => {
  if (!req.path.startsWith('/api/') || PUBLIC_PATHS.includes(req.path)) return next();
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token || !sessions[token] || sessions[token].expires < Date.now()) {
    if (token) delete sessions[token];
    return res.status(401).json({ error: '未登录或会话已过期' });
  }
  req.session = sessions[token];
  next();
});

// 角色授权
function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.session.role)) {
      return res.status(403).json({ error: '权限不足' });
    }
    next();
  };
}

// ── SSRF 防护 ─────────────────────────────────────────────
function isPrivateHost(hostname) {
  // 检查是否为私有/内网 IP
  if (net.isIP(hostname)) {
    const parts = hostname.split('.');
    if (net.isIPv4(hostname)) {
      const first = parseInt(parts[0], 10);
      const second = parseInt(parts[1], 10);
      if (first === 10) return true;
      if (first === 172 && second >= 16 && second <= 31) return true;
      if (first === 192 && second === 168) return true;
      if (first === 127) return true;
      if (first === 0) return true;
      if (first === 169 && second === 254) return true;
    }
    if (net.isIPv6(hostname)) {
      const lower = hostname.toLowerCase();
      if (lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80')) return true;
    }
    return false;
  }
  // 检查主机名
  const lower = hostname.toLowerCase();
  if (lower === 'localhost' || lower === 'metadata.google.internal') return true;
  return false;
}

// ── 文件上传配置 ──────────────────────────────────────────
const upload = multer({
  dest: TMP_DIR,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const name = file.originalname.toLowerCase();
    if (name.endsWith('.tar.gz') || name.endsWith('.zip')) cb(null, true);
    else cb(new Error('仅支持 .tar.gz 和 .zip 格式'));
  },
});

// ── 解压工具 ──────────────────────────────────────────────
function normalizeBinName(name) {
  const lower = name.toLowerCase();
  if (lower === 'frps' || lower === 'frps.exe') return 'frps';
  if (lower === 'frpc' || lower === 'frpc.exe') return 'frpc';
  return null;
}

function scanRecursive(dir, files) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) { scanRecursive(path.join(dir, entry.name), files); }
      else { const bin = normalizeBinName(entry.name); if (bin) files.push(bin); }
    }
  } catch (_) {}
}

function findFile(dir, binName) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) { const found = findFile(fullPath, binName); if (found) return found; }
      else if (normalizeBinName(entry.name) === binName) return fullPath;
    }
  } catch (_) {}
  return null;
}

async function extractTarGz(filePath, destDir) {
  const tmpDir = path.join(destDir, '_tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  await tar.extract({
    file: filePath, cwd: tmpDir,
    filter: (entryPath) => !!normalizeBinName(path.basename(entryPath)),
  });
  const found = [];
  scanRecursive(tmpDir, found);
  for (const name of found) {
    const foundPath = findFile(tmpDir, name);
    if (foundPath) fs.renameSync(foundPath, path.join(destDir, name));
  }
  fs.rmSync(tmpDir, { recursive: true });
  return [...new Set(found)];
}

async function extractZip(filePath, destDir) {
  const files = [];
  return new Promise((resolve, reject) => {
    fs.createReadStream(filePath).pipe(unzipper.Parse())
      .on('entry', (entry) => {
        const bin = normalizeBinName(path.basename(entry.path));
        if (bin) { files.push(bin); entry.pipe(fs.createWriteStream(path.join(destDir, bin))); }
        else entry.autodrain();
      })
      .on('close', () => resolve([...new Set(files)]))
      .on('error', reject);
  });
}

function parseFilename(filename) {
  const match = filename.match(/frp[cs]?_(\d+\.\d+\.\d+)_(linux|windows|darwin|freebsd|android)_(\w+)\.(tar\.gz|zip)$/i);
  return match ? { version: match[1], os: match[2].toLowerCase(), arch: match[3].toLowerCase() } : null;
}

// ── 健康检查 ──────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

// ── 认证 API ──────────────────────────────────────────────
app.post('/api/auth/login', loginLimiter, (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '请输入用户名和密码' });
  const data = loadUsers();
  const user = data.users.find((u) => u.username === username);
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
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
  res.json({ username: req.session.username, role: req.session.role });
});

// ── 二进制管理 API ────────────────────────────────────────
app.post('/api/binary/upload', requireRole('admin'), (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? '文件大小超过 100MB 限制' : err.message;
      return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: msg });
    }
    if (!req.file) return res.status(400).json({ error: '请选择要上传的文件' });

    const parsed = parseFilename(req.file.originalname);
    if (!parsed) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: '无法从文件名识别版本号和平台，请使用标准命名如 frp_0.61.0_linux_amd64.tar.gz' });
    }

    const { version, os, arch } = parsed;
    const platformKey = `${os}_${arch}`;
    const versionDir = path.join(FRP_BIN_DIR, version);
    const platformDir = path.join(versionDir, platformKey);

    try {
      if (fs.existsSync(platformDir)) fs.rmSync(platformDir, { recursive: true });
      fs.mkdirSync(platformDir, { recursive: true });

      const fileName = req.file.originalname.toLowerCase();
      let foundFiles = fileName.endsWith('.tar.gz')
        ? await extractTarGz(req.file.path, platformDir)
        : await extractZip(req.file.path, platformDir);

      if (foundFiles.length === 0) {
        fs.rmSync(platformDir, { recursive: true });
        return res.status(400).json({ error: '压缩包中未找到 frps 或 frpc 可执行文件' });
      }

      const meta = loadVersions();
      if (!meta.versions[version]) meta.versions[version] = { platforms: {}, default: false, uploadedAt: new Date().toISOString() };
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

app.get('/api/binary/list', (req, res) => {
  const meta = loadVersions();
  const list = Object.entries(meta.versions).map(([version, info]) => ({
    version, default: info.default, uploadedAt: info.uploadedAt, platforms: info.platforms || {},
  })).sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
  res.json(list);
});

app.put('/api/binary/:version/default', requireRole('admin'), (req, res) => {
  const { version } = req.params;
  const meta = loadVersions();
  if (!meta.versions[version]) return res.status(404).json({ error: '版本不存在' });
  Object.values(meta.versions).forEach((v) => v.default = false);
  meta.versions[version].default = true;
  saveVersions(meta);
  res.json({ ok: true });
});

app.delete('/api/binary/:version', requireRole('admin'), (req, res) => {
  const { version } = req.params;
  const platform = req.query.platform;
  const meta = loadVersions();
  if (!meta.versions[version]) return res.status(404).json({ error: '版本不存在' });

  if (platform) {
    validateName(platform);
    if (!meta.versions[version].platforms[platform]) return res.status(404).json({ error: '平台不存在' });
    delete meta.versions[version].platforms[platform];
    const platformDir = path.join(FRP_BIN_DIR, version, platform);
    if (fs.existsSync(platformDir)) fs.rmSync(platformDir, { recursive: true });
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

  if (!Object.keys(meta.versions).length || (meta.versions[version]?.default)) {
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
  if (typeof value === 'string' && /^\d+$/.test(value)) return `${key} = ${value}`;
  return `${key} = "${value}"`;
}

// ── 配置生成 API ──────────────────────────────────────────
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
  ].filter((l) => l !== '');
  res.json({ ini: lines.join('\n') });
});

app.post('/api/client/generate', (req, res) => {
  const { common = {}, proxies = [] } = req.body;
  const lines = [
    tomlKeyVal('serverAddr', common.server_addr),
    tomlKeyVal('serverPort', common.server_port),
    '',
    common.token ? '# 认证' : '',
    common.token ? 'auth.method = "token"' : '',
    common.token ? tomlKeyVal('auth.token', common.token) : '',
    common.token ? '' : '',
    '# 管理面板',
    tomlKeyVal('webServer.addr', common.admin_addr),
    tomlKeyVal('webServer.port', common.admin_port),
    '',
    '# 日志',
    tomlKeyVal('log.to', common.log_file),
    tomlKeyVal('log.level', common.log_level),
  ].filter((l) => l !== '');

  for (const proxy of proxies) {
    if (!proxy.name) continue;
    lines.push('', '[[proxies]]', tomlKeyVal('name', proxy.name), tomlKeyVal('type', proxy.type),
      tomlKeyVal('localIP', proxy.local_ip), tomlKeyVal('localPort', proxy.local_port));
    if (proxy.type === 'tcp' || proxy.type === 'udp') lines.push(tomlKeyVal('remotePort', proxy.remote_port));
    lines.push(tomlKeyVal('transport.useEncryption', proxy.use_encryption || false));
    lines.push(tomlKeyVal('transport.useCompression', proxy.use_compression || false));
    if (proxy.type === 'http' || proxy.type === 'https') {
      if (proxy.subdomain) lines.push(tomlKeyVal('subdomain', proxy.subdomain));
      if (proxy.custom_domains) {
        const domains = proxy.custom_domains.split(',').map((d) => d.trim()).filter(Boolean);
        lines.push(`customDomains = ["${domains.join('", "')}"]`);
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
  res.json({ ini: lines.join('\n') });
});

// ── 打包下载 API ──────────────────────────────────────────
function createPackage(res, type, version, platform, iniContent) {
  try {
    validateName(version);
    validateName(platform);
  } catch (_) { return res.status(400).json({ error: '参数不合法' }); }

  const binFile = type === 'server' ? 'frps' : 'frpc';
  const tomlFile = type === 'server' ? 'frps.toml' : 'frpc.toml';
  const zipName = `${binFile}_${version}_${platform}_package.zip`;

  const binPath = path.join(FRP_BIN_DIR, version, platform, binFile);
  if (!fs.existsSync(binPath)) return res.status(400).json({ error: `版本 ${version} 平台 ${platform} 缺少 ${binFile} 文件` });

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

  const isWindows = platform.startsWith('windows');
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (err) => res.status(500).json({ error: `打包失败: ${err.message}` }));
  archive.pipe(res);

  const exeName = isWindows ? `${binFile}.exe` : binFile;
  archive.file(binPath, { name: exeName });
  archive.append(iniContent, { name: tomlFile });

  if (isWindows) {
    archive.append(`@echo off\r\nREM ${binFile} 启动脚本\r\n${exeName} -c ${tomlFile}\r\n`, { name: `start_${binFile}.bat` });
  } else {
    archive.append(`#!/bin/sh\n# ${binFile} 启动脚本\nchmod +x ./${exeName}\n./${exeName} -c ${tomlFile}\n`, { name: `start_${binFile}.sh` });
  }

  const roleCN = type === 'server' ? '服务端 (frps)' : '客户端 (frpc)';
  const osLabel = platform.replace('_', ' / ');
  const readme = [
    `FRP ${roleCN} 部署包`, `版本：${version}  平台：${osLabel}`,
    `生成时间：${new Date().toLocaleString('zh-CN')}`,
    '', '文件说明：',
    `  ${exeName}               - FRP 可执行程序`,
    `  ${tomlFile}            - 配置文件（TOML 格式）`,
    isWindows ? `  start_${binFile}.bat      - Windows 启动脚本` : `  start_${binFile}.sh       - Linux / macOS 启动脚本`,
    '  README.txt              - 本说明文件',
    '', '使用方法：',
    isWindows ? `  双击 start_${binFile}.bat 启动` : `  chmod +x start_${binFile}.sh && ./start_${binFile}.sh`,
    `  或直接运行：./${exeName} -c ${tomlFile}`,
    '', type === 'server' ? '启动后可访问 http://<服务器IP>:<dashboard_port> 进入管理面板。' : '确保服务端已启动且防火墙已放行对应端口。',
    '', '注意：如果杀毒软件报告病毒，这是对未签名可执行文件的误报。',
    'FRP 是 GitHub 开源项目（9万+ Star），可放心使用。',
    '如需解除 macOS 限制：xattr -d com.apple.quarantine frps',
    '', '更多配置说明：https://github.com/fatedier/frp',
    '', '--- 由 FRP Config Studio 生成 ---',
  ].join('\n');
  archive.append(readme, { name: 'README.txt' });
  archive.finalize();
}

app.post('/api/server/package', (req, res) => {
  const { ini, version, platform } = req.body;
  if (!ini || !version || !platform) return res.status(400).json({ error: '缺少配置内容、版本号或平台' });
  createPackage(res, 'server', version, platform, ini);
});

app.post('/api/client/package', (req, res) => {
  const { ini, version, platform } = req.body;
  if (!ini || !version || !platform) return res.status(400).json({ error: '缺少配置内容、版本号或平台' });
  createPackage(res, 'client', version, platform, ini);
});

// ── 方案管理 API ──────────────────────────────────────────
function schemaRoutes(routerPrefix, schemaDir) {
  app.get(`/api/${routerPrefix}/schema`, (_req, res) => {
    const dirPath = path.join(SCHEMAS_DIR, schemaDir);
    try {
      if (!fs.existsSync(dirPath)) return res.json([]);
      const files = fs.readdirSync(dirPath).filter((f) => f.endsWith('.json'));
      const schemas = files.map((f) => {
        const filePath = path.join(dirPath, f);
        const stat = fs.statSync(filePath);
        const entry = { name: f.replace('.json', ''), createdAt: stat.birthtime.toISOString() };
        try {
          const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          if (content.linkedServer) entry.linkedServer = content.linkedServer;
        } catch (_) {}
        return entry;
      });
      res.json(schemas);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post(`/api/${routerPrefix}/schema/:name`, (req, res) => {
    try {
      const name = validateName(req.params.name);
      const dirPath = path.join(SCHEMAS_DIR, schemaDir);
      if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
      const filePath = safePath(dirPath, `${name}.json`);
      fs.writeFileSync(filePath, JSON.stringify(req.body, null, 2), 'utf-8');
      res.json({ ok: true, name });
    } catch (e) { res.status(400).json({ error: e.message || '保存失败' }); }
  });

  app.get(`/api/${routerPrefix}/schema/:name`, (req, res) => {
    try {
      const name = validateName(req.params.name);
      const filePath = safePath(path.join(SCHEMAS_DIR, schemaDir), `${name}.json`);
      if (!fs.existsSync(filePath)) return res.status(404).json({ error: '方案不存在' });
      res.json(JSON.parse(fs.readFileSync(filePath, 'utf-8')));
    } catch (e) { res.status(404).json({ error: '方案不存在' }); }
  });

  app.delete(`/api/${routerPrefix}/schema/:name`, (req, res) => {
    try {
      const name = validateName(req.params.name);
      const filePath = safePath(path.join(SCHEMAS_DIR, schemaDir), `${name}.json`);
      if (!fs.existsSync(filePath)) return res.status(404).json({ error: '方案不存在' });
      fs.unlinkSync(filePath);
      res.json({ ok: true });
    } catch (e) { res.status(404).json({ error: '方案不存在' }); }
  });
}

schemaRoutes('server', 'server');
schemaRoutes('client', 'client');

// ── 用户管理 API ──────────────────────────────────────────
app.get('/api/users', (req, res) => {
  const data = loadUsers();
  res.json(data.users.map((u) => ({ username: u.username, role: u.role, createdAt: u.createdAt })));
});

app.post('/api/users', requireRole('admin'), (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password) return res.status(400).json({ error: '用户名和密码为必填项' });
  try { validateName(username); } catch (_) { return res.status(400).json({ error: '非法用户名' }); }
  const data = loadUsers();
  const exist = data.users.find((u) => u.username === username);
  const hash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
  if (exist) {
    exist.passwordHash = hash;
    exist.role = role || 'user';
    // 密码变更后清除该用户的所有会话
    Object.keys(sessions).forEach((t) => {
      if (sessions[t].username === username) delete sessions[t];
    });
  } else {
    data.users.push({ username, passwordHash: hash, role: role || 'user', createdAt: new Date().toISOString() });
  }
  saveUsers(data);
  res.json({ ok: true });
});

app.delete('/api/users/:username', requireRole('admin'), (req, res) => {
  try { validateName(req.params.username); } catch (_) { return res.status(400).json({ error: '非法用户名' }); }
  if (req.params.username === 'admin') return res.status(400).json({ error: '不能删除默认管理员' });
  const data = loadUsers();
  const idx = data.users.findIndex((u) => u.username === req.params.username);
  if (idx === -1) return res.status(404).json({ error: '用户不存在' });
  data.users.splice(idx, 1);
  saveUsers(data);
  res.json({ ok: true });
});

// ── 远程服务端管理 API ────────────────────────────────────
function loadConnection(id) {
  try {
    const decodedId = decodeURIComponent(validateName(id));
    const filePath = safePath(path.join(SCHEMAS_DIR, 'server'), `${decodedId}.json`);
    if (!fs.existsSync(filePath)) return null;
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (!data.server_addr || !data.dashboard_port) return null;
    return { id: decodedId, name: decodedId, addr: data.server_addr, port: data.dashboard_port || '7500',
      user: data.dashboard_user || 'admin', password: data.dashboard_pwd || 'admin' };
  } catch (_) { return null; }
}

app.get('/api/connections', (_req, res) => {
  try {
    const dirPath = path.join(SCHEMAS_DIR, 'server');
    if (!fs.existsSync(dirPath)) return res.json([]);
    const files = fs.readdirSync(dirPath).filter((f) => f.endsWith('.json'));
    const connections = files.map((f) => {
      const conn = loadConnection(f.replace('.json', ''));
      if (!conn) return null;
      return { id: conn.id, name: conn.name, addr: conn.addr, port: conn.port, user: conn.user };
    }).filter(Boolean);
    res.json(connections);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/connections/:id', requireRole('admin'), (req, res) => {
  try {
    const filePath = safePath(path.join(SCHEMAS_DIR, 'server'), `${validateName(req.params.id)}.json`);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: '连接不存在' });
    fs.unlinkSync(filePath);
    res.json({ ok: true });
  } catch (e) { res.status(404).json({ error: '连接不存在' }); }
});

async function frpProxy(id, apiPath, res) {
  const conn = loadConnection(id);
  if (!conn) return res.status(404).json({ error: '连接不存在' });
  const baseUrl = `http://${conn.addr}:${conn.port}`;
  const auth = Buffer.from(`${conn.user}:${conn.password}`).toString('base64');

  try {
    const resp = await fetch(`${baseUrl}${apiPath}`, {
      headers: { 'Authorization': `Basic ${auth}` },
      signal: AbortSignal.timeout(10000),
    });
    if (resp.status === 401 || resp.status === 403) return res.status(502).json({ error: '认证失败，请检查用户名和密码' });
    if (resp.status === 404) return res.status(502).json({ error: '远程服务端不支持此接口' });
    const contentType = resp.headers.get('content-type') || '';
    if (!contentType.includes('json')) return res.json({ clients: [], proxies: [] });
    const data = await resp.json();
    res.json(data);
  } catch (e) {
    if (e.cause?.code === 'ECONNREFUSED' || e.message.includes('fetch failed'))
      return res.status(502).json({ error: '无法连接到远程服务端' });
    if (e.message.includes('timeout') || e.name === 'AbortError')
      return res.status(502).json({ error: '连接远程服务端超时' });
    res.status(502).json({ error: `远程服务端错误: ${e.message}` });
  }
}

app.get('/api/connections/:id/serverinfo', (req, res) => frpProxy(req.params.id, '/api/serverinfo', res));

app.get('/api/connections/:id/proxies', async (req, res) => {
  const conn = loadConnection(req.params.id);
  if (!conn) return res.status(404).json({ error: '连接不存在' });
  const baseUrl = `http://${conn.addr}:${conn.port}`;
  const auth = Buffer.from(`${conn.user}:${conn.password}`).toString('base64');
  const headers = { 'Authorization': `Basic ${auth}` };
  const allProxies = [];
  for (const pType of ['tcp', 'udp', 'http', 'https', 'stcp', 'xtcp']) {
    try {
      const resp = await fetch(`${baseUrl}/api/proxy/${pType}`, { headers, signal: AbortSignal.timeout(5000) });
      const data = await resp.json();
      if (data.proxies?.length > 0) {
        for (const p of data.proxies) { p.type = p.type || pType; allProxies.push(p); }
      }
    } catch (_) {}
  }
  res.json({ proxies: allProxies });
});

app.get('/api/connections/:id/clients', (req, res) => frpProxy(req.params.id, '/api/clients', res));

// 获取指定客户端的代理列表
app.get('/api/connections/:id/clients/:clientKey/proxies', async (req, res) => {
  const conn = loadConnection(req.params.id);
  if (!conn) return res.status(404).json({ error: '连接不存在' });
  const baseUrl = `http://${conn.addr}:${conn.port}`;
  const auth = Buffer.from(`${conn.user}:${conn.password}`).toString('base64');
  const headers = { 'Authorization': `Basic ${auth}` };
  const clientKey = decodeURIComponent(req.params.clientKey);
  const allProxies = [];
  for (const pType of ['tcp', 'udp', 'http', 'https', 'stcp', 'xtcp']) {
    try {
      const resp = await fetch(`${baseUrl}/api/proxy/${pType}`, { headers, signal: AbortSignal.timeout(5000) });
      const data = await resp.json();
      if (data.proxies?.length > 0) {
        for (const p of data.proxies) {
          p.type = p.type || pType;
          // 通过 clientID 匹配客户端
          if (p.clientID === clientKey) {
            allProxies.push(p);
          }
        }
      }
    } catch (_) {}
  }
  res.json({ proxies: allProxies });
});

app.get('/api/connections/:id/clients/:clientKey', (req, res) => {
  try {
    const key = validateName(req.params.clientKey);
    frpProxy(req.params.id, `/api/clients/${key}`, res);
  } catch (_) { res.status(400).json({ error: '非法客户端ID' }); }
});

// 单个代理详情
app.get('/api/connections/:id/proxy/:type/:name', (req, res) => {
  frpProxy(req.params.id, `/api/proxy/${req.params.type}/${req.params.name}`, res);
});

// 代理流量数据
app.get('/api/connections/:id/traffic/:name', (req, res) => {
  frpProxy(req.params.id, `/api/traffic/${req.params.name}`, res);
});

app.get('/api/connections/:id/reload', (req, res) => frpProxy(req.params.id, '/api/reload', res));

// ── 生产模式静态文件 ──────────────────────────────────────
const distPath = path.join(__dirname, 'client', 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
}

// ── 错误处理 ──────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  if (err.type === 'entity.too.large') return res.status(413).json({ error: '文件大小超过 100MB 限制' });
  res.status(500).json({ error: '服务器内部错误' });
});

app.listen(PORT, () => console.log(`FRP Config Studio 已启动: http://localhost:${PORT}`));
