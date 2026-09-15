// Thin fetch wrapper for the Pure GitHub Mini App backend.
// Auth: every /api call carries the Telegram initData the WebApp client
// injected into `window.Telegram.WebApp.initData`. In a plain browser (dev)
// it falls back to ?initData= so the flow can be exercised without Telegram.
function getInitData() {
  const tg = window.Telegram?.WebApp;
  if (tg && tg.initData) return tg.initData;
  const fromQuery = new URLSearchParams(window.location.search).get('initData');
  if (fromQuery) return decodeURIComponent(fromQuery);
  return '';
}

function headers() {
  const initData = getInitData();
  return {
    'Content-Type': 'application/json',
    ...(initData ? { 'x-telegram-init-data': initData } : {}),
  };
}

async function req(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: headers(),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

export const api = {
  get: (p) => req('GET', p),
  post: (p, b) => req('POST', p, b),
};

export async function getPosts() {
  return api.get('/api/posts');
}

export async function getPost(id) {
  return api.get(`/api/posts/${id}`);
}

export async function approve(id, queryId) {
  return api.post(`/api/posts/${id}/approve`, { query_id: queryId || null });
}

export async function rejectPost(id, queryId) {
  return api.post(`/api/posts/${id}/reject`, { query_id: queryId || null });
}

export async function regen(id) {
  return api.post(`/api/posts/${id}/regen`, {});
}

export async function setCaption(id, caption) {
  return api.post(`/api/posts/${id}/caption`, { caption });
}

export async function schedule(id, publishAt) {
  return api.post(`/api/posts/${id}/schedule`, { publish_at: publishAt });
}

export async function addGen(fullName) {
  return api.post('/api/add/gen', { full_name: fullName });
}

export async function addManual(fullName, caption) {
  return api.post('/api/add/manual', { full_name: fullName, caption });
}