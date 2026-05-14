// netlify/functions/admin-data.js
// CRUD for entries, sponsors, complimentary teams, and admin settings
// Uses Netlify Blobs for persistent storage

const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');

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

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type,Authorization', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE' }, body: '' };
  }

  if (!auth(event)) return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };

  const store = getStore('golf-admin');
  const params = event.queryStringParameters || {};
  const resource = params.resource; // entries | sponsors | complimentary | settings | admins

  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  try {
    // ── GET ──
    if (event.httpMethod === 'GET') {
      const raw = await store.get(resource).catch(() => null);
      const data = raw ? JSON.parse(raw) : getDefaults(resource);
      return { statusCode: 200, headers, body: JSON.stringify(data) };
    }

    // ── PUT — full replace ──
    if (event.httpMethod === 'PUT') {
      const body = JSON.parse(event.body);
      await store.set(resource, JSON.stringify(body));
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    // ── POST — append one record ──
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body);
      const raw  = await store.get(resource).catch(() => null);
      const data = raw ? JSON.parse(raw) : getDefaults(resource);
      const id   = 'rr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
      const record = { ...body, id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      if (Array.isArray(data)) {
        data.push(record);
      } else if (data.items) {
        data.items.push(record);
      }
      await store.set(resource, JSON.stringify(data));
      return { statusCode: 201, headers, body: JSON.stringify(record) };
    }

    // ── DELETE — remove by id ──
    if (event.httpMethod === 'DELETE') {
      const { id } = params;
      const raw  = await store.get(resource).catch(() => null);
      const data = raw ? JSON.parse(raw) : getDefaults(resource);
      if (Array.isArray(data)) {
        const updated = data.filter(r => r.id !== id);
        await store.set(resource, JSON.stringify(updated));
      } else if (data.items) {
        data.items = data.items.filter(r => r.id !== id);
        await store.set(resource, JSON.stringify(data));
      }
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    return { statusCode: 405, body: 'Method Not Allowed' };
  } catch (err) {
    console.error('admin-data error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

function getDefaults(resource) {
  if (resource === 'settings') return {
    adminEmails: [],
    notifyOnEntry: true,
    notifyOnSponsor: true,
    eventName: '39th Annual Charity Golf Tournament',
    eventDate: 'Monday, September 14, 2026',
    eventVenue: "Hunter's Green Country Club, Tampa FL",
  };
  return [];
}
