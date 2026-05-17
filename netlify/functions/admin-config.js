// netlify/functions/admin-config.js
// Reads and writes sponsor level + à la carte config to Netlify Blobs
// GET  /.netlify/functions/admin-config  → returns current config JSON
// POST /.netlify/functions/admin-config  → saves new config JSON
//
// Deploy to: netlify/functions/admin-config.js
// Requires:  @netlify/blobs (auto-available in Netlify Functions runtime)

import { getStore } from '@netlify/blobs';

const ADMIN_KEY = process.env.ADMIN_KEY;
const BLOB_STORE = 'golf-config';
const BLOB_KEY   = 'sponsor-config';

export default async function handler(req, context) {
  // ── Auth ──
  const key = req.headers.get('x-admin-key');
  if (key !== ADMIN_KEY) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: corsHeaders('application/json'),
    });
  }

  const store = getStore(BLOB_STORE);

  // ── GET: load config ──
  if (req.method === 'GET') {
    try {
      const raw = await store.get(BLOB_KEY, { type: 'text' });
      if (!raw) {
        // First run — return empty structure
        return new Response(JSON.stringify({ benefits: [], levels: [], alacarte: [] }), {
          status: 200,
          headers: corsHeaders('application/json'),
        });
      }
      return new Response(raw, {
        status: 200,
        headers: corsHeaders('application/json'),
      });
    } catch (err) {
      console.error('admin-config GET error:', err);
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: corsHeaders('application/json'),
      });
    }
  }

  // ── POST: save config ──
  if (req.method === 'POST') {
    try {
      const body = await req.text();
      // Validate it's parseable JSON before storing
      JSON.parse(body);
      await store.set(BLOB_KEY, body);
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: corsHeaders('application/json'),
      });
    } catch (err) {
      console.error('admin-config POST error:', err);
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: corsHeaders('application/json'),
      });
    }
  }

  // ── OPTIONS: CORS preflight ──
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405,
    headers: corsHeaders('application/json'),
  });
}

function corsHeaders(contentType) {
  const h = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-admin-key',
    'Cache-Control': 'no-store',
  };
  if (contentType) h['Content-Type'] = contentType;
  return h;
}

export const config = { path: '/.netlify/functions/admin-config' };
