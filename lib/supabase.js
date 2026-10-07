/** Helper REST Supabase (server saja) — memakai SUPABASE_URL & SUPABASE_SERVICE_ROLE_KEY. */
async function sb(path, { method = 'GET', body, prefer } = {}) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY belum di-set');
  const headers = { apikey: key, Accept: 'application/json' };
  if (!key.startsWith('sb_')) headers.Authorization = `Bearer ${key}`;
  if (body) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;
  const r = await fetch(`${url.replace(/\/$/, '')}/rest/v1/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(`${method} ${path.split('?')[0]}: HTTP ${r.status}`);
  return r.status === 204 || r.headers.get('content-length') === '0' ? null : r.json().catch(() => null);
}
module.exports = { sb };
