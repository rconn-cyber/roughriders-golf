// sync-member-now.js
// Manually triggers a WA → Supabase member sync (runs inline, not background)
// Called from admin panel "Sync Members Now" button

const crypto = require('crypto');
const WA_BASE = 'https://api.wildapricot.org/v2.2';

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

async function getWAToken(apiKey) {
  const creds = Buffer.from('APIKEY:' + apiKey).toString('base64');
  const resp = await fetch('https://oauth.wildapricot.org/auth/token', {
    method: 'POST',
    headers: { 'Authorization': 'Basic ' + creds, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials&scope=auto'
  });
  if (!resp.ok) throw new Error('WA auth failed: ' + resp.status);
  return (await resp.json()).access_token;
}

async function fetchWAMembers(token, accountId) {
  let members = [], skip = 0;
  while (true) {
    const resp = await fetch(
      `${WA_BASE}/accounts/${accountId}/contacts?$top=100&$skip=${skip}&$async=false&$filter=Status+in+[Active,PendingRenewal,Lapsed]`,
      { headers: { 'Authorization': 'Bearer ' + token } }
    );
    if (!resp.ok) throw new Error('WA fetch failed: ' + resp.status);
    const data = await resp.json();
    const batch = data.Contacts || [];
    members = members.concat(batch);
    if (batch.length < 100) break;
    skip += 100;
  }
  return members;
}

function mapMember(m) {
  const fields = {};
  if (m.FieldValues) for (const f of m.FieldValues) fields[f.FieldName] = f.Value;
  const photoUrl = fields['Photo']?.Url || '';
  return {
    member_number:    fields['Member #'] || String(m.Id || ''),
    wa_id:            String(m.Id || ''),
    first_name:       m.FirstName || '',
    last_name:        m.LastName  || '',
    email:            m.Email     || '',
    status:           m.Status    || '',
    level:            m.MembershipLevel?.Name || '',
    phone:            fields['Phone'] || fields['Cell Phone'] || '',
    address:          fields['Address'] || '',
    city:             fields['City']    || '',
    state:            fields['State']   || '',
    zip:              fields['Zip']     || '',
    date_joined:      fields['Member since'] || null,
    photo_url:        photoUrl,
    updated_at:       m.LastUpdated ? new Date(m.LastUpdated).toISOString() : new Date().toISOString()
  };
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  if (!auth(event)) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  const WA_API_KEY   = process.env.WA_API_KEY;
  const WA_ACCOUNT_ID = process.env.WA_ACCOUNT_ID || '279468';

  if (!WA_API_KEY) return { statusCode: 500, headers, body: JSON.stringify({ error: 'WA_API_KEY not configured' }) };

  const results = { wa_to_sb: 0, skipped: 0, errors: [] };

  // Log start
  const logStartRes = await fetch(`${SUPABASE_URL}/rest/v1/sync_log`, {
    method: 'POST',
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
    body: JSON.stringify({ sync_type: 'members', status: 'running' })
  });
  const logRows = logStartRes.ok ? await logStartRes.json() : [];
  const logId = logRows[0]?.id;

  try {
    const token    = await getWAToken(WA_API_KEY);
    const waMembers = await fetchWAMembers(token, WA_ACCOUNT_ID);

    // Fetch existing Supabase members for comparison
    const sbRes = await fetch(`${SUPABASE_URL}/rest/v1/rr_members?select=member_number,updated_at`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    const sbMembers = sbRes.ok ? await sbRes.json() : [];
    const sbByNum = {};
    for (const m of sbMembers) sbByNum[String(m.member_number)] = m;

    const toUpsert = [];
    for (const wm of waMembers) {
      try {
        const mapped   = mapMember(wm);
        const existing = sbByNum[mapped.member_number];
        const waTime   = new Date(mapped.updated_at).getTime();
        const sbTime   = existing ? new Date(existing.updated_at).getTime() : 0;
        if (!existing || waTime > sbTime) toUpsert.push(mapped);
        else results.skipped++;
      } catch(e) { results.errors.push(e.message); }
    }

    // Upsert in batches of 50
    for (let i = 0; i < toUpsert.length; i += 50) {
      const batch = toUpsert.slice(i, i + 50);
      const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/rr_members?on_conflict=member_number`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates,return=minimal'
        },
        body: JSON.stringify(batch)
      });
      if (!upsertRes.ok) {
        const err = await upsertRes.text();
        results.errors.push(`Batch ${i}: ${err}`);
      } else {
        results.wa_to_sb += batch.length;
      }
    }

    // Update sync log
    if (logId) {
      await fetch(`${SUPABASE_URL}/rest/v1/sync_log?id=eq.${logId}`, {
        method: 'PATCH',
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'complete', results: { members: results }, finished_at: new Date().toISOString() })
      });
    }

    if (results.errors.length) console.error('Sync errors:', JSON.stringify(results.errors));
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, results, error_detail: results.errors }) };

  } catch (e) {
    if (logId) {
      await fetch(`${SUPABASE_URL}/rest/v1/sync_log?id=eq.${logId}`, {
        method: 'PATCH',
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'error', results: { error: e.message }, finished_at: new Date().toISOString() })
      });
    }
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
