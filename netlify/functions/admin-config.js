// netlify/functions/admin-config.js
// GET  — public, no auth — returns sponsor config for register.html
// POST — requires x-admin-key header — saves sponsor config from admin
//
// Uses Netlify Blobs REST API directly (same pattern as admin-data.js)

const ADMIN_KEY  = process.env.ADMIN_KEY;
const BLOB_PATH  = 'golf-config/sponsor-config';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-admin-key',
  'Cache-Control': 'no-store',
};

function getBlobStore() {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token  = process.env.NETLIFY_TOKEN || process.env.NETLIFY_ACCESS_TOKEN;
  const apiBase = `https://api.netlify.com/api/v1/sites/${siteID}/blobs`;
  const headers = { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };

  return {
    async get(key) {
      const metaR = await fetch(`${apiBase}/${encodeURIComponent(key)}`, { headers });
      if (metaR.status === 404) return null;
      if (!metaR.ok) { console.error('Blob GET failed:', metaR.status); return null; }
      const meta = await metaR.json();
      if (!meta.url) return null;
      const dataR = await fetch(meta.url);
      if (!dataR.ok) return null;
      return dataR.text();
    },
    async set(key, value) {
      const body = typeof value === 'string' ? value : JSON.stringify(value);
      const metaR = await fetch(`${apiBase}/${encodeURIComponent(key)}`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Length': Buffer.byteLength(body).toString() },
      });
      if (!metaR.ok) throw new Error('Blob set presign failed: ' + metaR.status);
      const meta = await metaR.json();
      if (!meta.url) throw new Error('No presigned URL returned');
      const uploadR = await fetch(meta.url, {
        method: 'PUT', body,
        headers: { 'Content-Type': 'application/json' }
      });
      if (!uploadR.ok) throw new Error('Blob upload failed: ' + uploadR.status);
    },
  };
}

exports.handler = async function(event, context) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  // ── GET: public — no auth required ──
  if (event.httpMethod === 'GET') {
    try {
      const store = getBlobStore();
      const raw = await store.get(BLOB_PATH);
      if (!raw) {
        return {
          statusCode: 200,
          headers: { ...CORS, 'Content-Type': 'application/json' },
          body: JSON.stringify({ benefits: [], levels: [], alacarte: [] }),
        };
      }
      return {
        statusCode: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: raw,
      };
    } catch (err) {
      console.error('admin-config GET error:', err);
      return {
        statusCode: 500,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: err.message }),
      };
    }
  }

  // ── POST: requires admin key ──
  if (event.httpMethod === 'POST') {
    const key = (event.headers && event.headers['x-admin-key']) || '';
    if (!ADMIN_KEY || key !== ADMIN_KEY) {
      return {
        statusCode: 401,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Unauthorized' }),
      };
    }
    try {
      const body = event.body || '{}';
      JSON.parse(body); // validate before storing
      const store = getBlobStore();
      await store.set(BLOB_PATH, body);
      return {
        statusCode: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true }),
      };
    } catch (err) {
      console.error('admin-config POST error:', err);
      return {
        statusCode: 500,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: err.message }),
      };
    }
  }

  return {
    statusCode: 405,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: 'Method not allowed' }),
  };
};
