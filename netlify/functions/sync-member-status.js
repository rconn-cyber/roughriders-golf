// sync-member-status.js
// Returns member count + last sync log entries from Supabase

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  const key = event.headers['x-admin-key'];
  if (!key || key !== process.env.ADMIN_KEY) {
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
