// netlify/functions/admin-config.js
// GET  — public, no auth — returns sponsor config for register.html
// POST — requires x-admin-key header — saves sponsor config from admin

const { getStore } = require('@netlify/blobs');

const ADMIN_KEY  = process.env.ADMIN_KEY;
const BLOB_STORE = 'golf-config';
const BLOB_KEY   = 'sponsor-config';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-admin-key',
  'Cache-Control': 'no-store',
};

exports.handler = async function(event, context) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  const store = getStore(BLOB_STORE);

  // ── GET: public — no auth required ──
  if (event.httpMethod === 'GET') {
    try {
      const raw = await store.get(BLOB_KEY, { type: 'text' });
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
      await store.set(BLOB_KEY, body);
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
