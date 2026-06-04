const BASE = '/api';

// 带认证的 fetch 封装
export function apiFetch(url, options = {}) {
  const token = localStorage.getItem('token');
  return fetch(url, {
    ...options,
    headers: {
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
}

async function request(path, options = {}) {
  const url = `${BASE}${path}`;
  const config = { ...options };

  const token = localStorage.getItem('token');
  config.headers = { ...config.headers };
  if (token) config.headers['Authorization'] = `Bearer ${token}`;

  if (config.body && !(config.body instanceof FormData)) {
    config.headers['Content-Type'] = 'application/json';
    config.body = JSON.stringify(config.body);
  }

  const res = await fetch(url, config);

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `请求失败 (${res.status})`);
  }

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return res.json();
  }
  return res;
}

export function uploadBinary(formData) {
  return request('/binary/upload', {
    method: 'POST',
    body: formData,
  });
}

export function listBinaries() {
  return request('/binary/list');
}

export function setDefaultVersion(version) {
  return request(`/binary/${encodeURIComponent(version)}/default`, {
    method: 'PUT',
  });
}

export function deleteVersion(version) {
  return request(`/binary/${encodeURIComponent(version)}`, {
    method: 'DELETE',
  });
}

export function generateServerConfig(data) {
  return request('/server/generate', {
    method: 'POST',
    body: data,
  });
}

export function generateClientConfig(data) {
  return request('/client/generate', {
    method: 'POST',
    body: data,
  });
}

export async function downloadPackage(url, body) {
  const res = await request(url, {
    method: 'POST',
    body,
  });
  return res;
}

export function listServerSchemas() {
  return request('/server/schema');
}

export function loadServerSchema(name) {
  return request(`/server/schema/${encodeURIComponent(name)}`);
}

export function saveServerSchema(name, data) {
  return request(`/server/schema/${encodeURIComponent(name)}`, {
    method: 'POST',
    body: data,
  });
}

export function deleteServerSchema(name) {
  return request(`/server/schema/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  });
}

export function listClientSchemas() {
  return request('/client/schema');
}

export function loadClientSchema(name) {
  return request(`/client/schema/${encodeURIComponent(name)}`);
}

export function saveClientSchema(name, data) {
  return request(`/client/schema/${encodeURIComponent(name)}`, {
    method: 'POST',
    body: data,
  });
}

export function deleteClientSchema(name) {
  return request(`/client/schema/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  });
}
