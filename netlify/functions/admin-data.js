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

function getBlobStore() {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token  = process.env.NETLIFY_TOKEN || process.env.NETLIFY_ACCESS_TOKEN;
  const base   = `https://api.netlify.com/api/v1/blobs/${siteID}/golf-admin`;
  const headers = { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };

  return {
    async get(key) {
      const r = await fetch(`${base}/${key}`, { headers });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`Blob get ${key} failed: ${r.status}`);
      return r.text();
    },
    async set(key, value) {
      const r = await fetch(`${base}/${key}`, { method: 'PUT', headers, body: typeof value === 'string' ? value : JSON.stringify(value) });
      if (!r.ok) throw new Error(`Blob set ${key} failed: ${r.status}`);
    },
  };
}

function getDefaults(resource) {
  if (resource === 'settings') return { adminEmails: [], notifyOnEntry: true, notifyOnSponsor: true };
  return [];
}

const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: { ...CORS, 'Access-Control-Allow-Headers': 'Content-Type,Authorization', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE' }, body: '' };
  if (!auth(event)) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) };

  const store    = getBlobStore();
  const resource = (event.queryStringParameters || {}).resource;
  const id       = (event.queryStringParameters || {}).id;

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
