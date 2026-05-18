// netlify/functions/admin-config.js
// GET  — public — returns sponsor config for register.html
// POST — requires x-admin-key header matching ADMIN_PASSWORD env var

// Uses same auth as admin-login.js (ADMIN_PASSWORD env var)
// Uses same Blobs pattern as admin-data.js (REST API with NETLIFY_TOKEN)

const ADMIN_KEY = process.env.ADMIN_PASSWORD; // same env var as admin-login
const STORE_KEY = 'golf-admin/sponsor-config';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-admin-key',
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json',
};

function getApiBase() {
  const siteID = process.env.NETLIFY_SITE_ID;
  return `https://api.netlify.com/api/v1/sites/${siteID}/blobs`;
}

function authHeader() {
  const token = process.env.NETLIFY_TOKEN || process.env.NETLIFY_ACCESS_TOKEN;
  return { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };
}

async function blobGet(key) {
  const metaR = await fetch(`${getApiBase()}/${encodeURIComponent(key)}`, { headers: authHeader() });
  if (metaR.status === 404) return null;
  if (!metaR.ok) { console.error('blobGet meta failed:', metaR.status, await metaR.text()); return null; }
  const meta = await metaR.json();
  if (!meta.url) return null;
  const dataR = await fetch(meta.url);
  if (!dataR.ok) return null;
  return dataR.text();
}

async function blobSet(key, value) {
  const body = typeof value === 'string' ? value : JSON.stringify(value);
  const len  = Buffer.byteLength(body);
  const metaR = await fetch(`${getApiBase()}/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { ...authHeader(), 'Content-Length': String(len) },
  });
  if (!metaR.ok) {
    const txt = await metaR.text();
    throw new Error(`Blob presign failed (${metaR.status}): ${txt}`);
  }
  const meta = await metaR.json();
  if (!meta.url) throw new Error('No presigned URL in response');
  const upR = await fetch(meta.url, {
    method: 'PUT',
    body,
    headers: { 'Content-Type': 'application/octet-stream' },
  });
  if (!upR.ok) throw new Error(`Blob upload failed (${upR.status})`);
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  // ── GET: public ──
  if (event.httpMethod === 'GET') {
    try {
      const raw = await blobGet(STORE_KEY);
      return {
        statusCode: 200,
        headers: CORS,
        body: raw || JSON.stringify({ benefits: [], levels: [], alacarte: [] }),
      };
    } catch (e) {
      console.error('GET error:', e);
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
    }
  }

  // ── POST: requires password ──
  if (event.httpMethod === 'POST') {
    const k = (event.headers || {})['x-admin-key'] || '';
    if (!ADMIN_KEY || k !== ADMIN_KEY) {
      console.log('Auth failed — key provided:', k ? 'yes' : 'no', '— ADMIN_KEY set:', !!ADMIN_KEY);
      return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) };
    }
    try {
      const body = event.body || '{}';
      JSON.parse(body);
      await blobSet(STORE_KEY, body);
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ success: true }) };
    } catch (e) {
      console.error('POST error:', e);
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
    }
  }

  return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
};
