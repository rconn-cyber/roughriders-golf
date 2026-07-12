// netlify/functions/admin-data.js
// CRUD using Netlify Blobs REST API directly

const crypto = require('crypto');

function verifyToken(token, secret) {
  try {
    const [data, sig] = token.split('.');
    const expected = crypto.createHmac('sha256', secret).update(data).digest('base64url');
    if (sig !== expected) return null;
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString());
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch { return null; }
}

function auth(event) {
  const h = event.headers.authorization || '';
  return verifyToken(h.replace('Bearer ', ''), process.env.SESSION_SECRET || 'fallback');
}

// Supabase-backed store (migrated from Netlify Blobs).
// 'registrations' and 'sponsors' live in their own tables (golf_registrations,
// golf_sponsors, one row per record). Everything else (settings, sponsor-config,
// event-content, reserved-teams, logo_*) lives in the golf_config KV table.
// Interface is identical to the old blob store: get(key) -> JSON string | null,
// set(key, value) -> void (throws on failure).
function getStore() {
  const base = process.env.SUPABASE_URL + '/rest/v1';
  const key  = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const headers = { 'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' };
  const TABLES = { registrations: 'golf_registrations', sponsors: 'golf_sponsors' };

  return {
    async get(k) {
      if (TABLES[k]) {
        const r = await fetch(`${base}/${TABLES[k]}?select=data&order=created_at.asc,id.asc`, { headers });
        if (!r.ok) { console.error('Supabase get failed:', k, r.status, await r.text()); return null; }
        const rows = await r.json();
        return JSON.stringify(rows.map(x => x.data));
      }
      const r = await fetch(`${base}/golf_config?key=eq.${encodeURIComponent(k)}&select=value`, { headers });
      if (!r.ok) { console.error('Supabase config get failed:', k, r.status); return null; }
      const rows = await r.json();
      return rows.length ? JSON.stringify(rows[0].value) : null;
    },
    async set(k, value) {
      const parsed = typeof value === 'string' ? JSON.parse(value) : value;
      if (TABLES[k]) {
        const r = await fetch(`${base}/rpc/golf_replace_all`, {
          method: 'POST', headers,
          body: JSON.stringify({ p_table: TABLES[k], p_records: parsed }),
        });
        if (!r.ok) throw new Error(`Supabase replace ${k} failed: ${r.status} ${await r.text()}`);
        return;
      }
      const r = await fetch(`${base}/golf_config?on_conflict=key`, {
        method: 'POST',
        headers: { ...headers, 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify({ key: k, value: parsed, updated_at: new Date().toISOString() }),
      });
      if (!r.ok) throw new Error(`Supabase config set ${k} failed: ${r.status} ${await r.text()}`);
    },
  };
}

function getDefaults(resource) {
  if (resource === 'settings') return { adminEmails: [], notifyOnEntry: true, notifyOnSponsor: true };
  return [];
}

const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: { ...CORS, 'Access-Control-Allow-Headers': 'Content-Type,Authorization', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE' }, body: '' };

  const resource = (event.queryStringParameters || {}).resource;
  const id       = (event.queryStringParameters || {}).id;

  // Allow public read of sponsors (for logo strip on register page) — no auth required
  const isPublicRead = event.httpMethod === 'GET' && resource === 'sponsors';
  if (!isPublicRead && !auth(event)) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) };

  const store = getStore();

  try {
    if (event.httpMethod === 'GET') {
      const raw  = await store.get(resource);
      const data = raw ? JSON.parse(raw) : getDefaults(resource);
      return { statusCode: 200, headers: CORS, body: JSON.stringify(data) };
    }

    if (event.httpMethod === 'PUT') {
      const body = JSON.parse(event.body);
      await store.set(resource, JSON.stringify(body));
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ success: true }) };
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body);
      const raw  = await store.get(resource);
      const data = raw ? JSON.parse(raw) : [];
      const newId = 'rr_' + Date.now() + '_' + Math.random().toString(36).slice(2,7);
      const record = { ...body, id: newId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      const arr = Array.isArray(data) ? data : (data.items || []);
      arr.push(record);
      await store.set(resource, JSON.stringify(arr));
      return { statusCode: 201, headers: CORS, body: JSON.stringify(record) };
    }

    // PATCH — partial update of a single record by id
    if (event.httpMethod === 'PATCH') {
      if (!id) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'id required for PATCH' }) };
      const body = JSON.parse(event.body);
      const raw  = await store.get(resource);
      const data = raw ? JSON.parse(raw) : [];
      const arr  = Array.isArray(data) ? data : (data.items || []);
      const idx  = arr.findIndex(r => r.id === id);
      if (idx === -1) return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'Record not found' }) };
      arr[idx] = { ...arr[idx], ...body, id, updatedAt: new Date().toISOString() };
      await store.set(resource, JSON.stringify(arr));
      return { statusCode: 200, headers: CORS, body: JSON.stringify(arr[idx]) };
    }

    if (event.httpMethod === 'DELETE') {
      const raw  = await store.get(resource);
      const data = raw ? JSON.parse(raw) : [];
      const arr  = Array.isArray(data) ? data : (data.items || []);
      const updated = arr.filter(r => r.id !== id);
      await store.set(resource, JSON.stringify(updated));
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ success: true }) };
    }

    return { statusCode: 405, headers: CORS, body: 'Method Not Allowed' };
  } catch (err) {
    console.error('admin-data error:', err);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
