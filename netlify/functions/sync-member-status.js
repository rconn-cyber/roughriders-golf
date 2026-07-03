// sync-member-status.js
// Returns member count + last sync log entries from Supabase

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

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  if (!auth(event)) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

  try {
    const [countRes, logRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/rr_members?select=id&limit=1`, {
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Prefer': 'count=exact' }
      }),
      fetch(`${SUPABASE_URL}/rest/v1/sync_log?sync_type=eq.members&order=created_at.desc&limit=10`, {
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
      })
    ]);

    const member_count = parseInt(countRes.headers.get('content-range')?.split('/')[1] || '0');
    const log = logRes.ok ? await logRes.json() : [];

    const last = log.find(r => r.status === 'complete');
    const last_sync   = last?.finished_at || null;
    const last_result = last ? { status: last.status, ...(last.results?.members || last.results || {}) } : null;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ member_count, last_sync, last_result, log })
    };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
