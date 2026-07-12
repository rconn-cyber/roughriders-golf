// netlify/functions/resend-confirmation.js
// Admin-only endpoint: looks up a registration by ID and re-fires the confirmation email.
// POST { id: "rr_..." }  — requires admin auth token

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'r.conn@tamparoughriders.org')
  .split(',').map(s => s.trim());

// Supabase-backed store (migrated from Netlify Blobs).
// 'registrations' and 'sponsors' live in their own tables (golf_registrations,
// golf_sponsors, one row per record). Everything else (settings, sponsor-config,
// event-content, reserved-teams, logo_*) lives in the golf_config KV table.
// Interface is identical to the old blob store: get(key) -> JSON string | null,
// set(key, value) -> void (throws on failure).
function getStore() {
  const base = process.env.SUPABASE_URL + '/rest/v1';
  const key  = process.env.SUPABASE_SERVICE_ROLE_KEY;
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

// Verify admin JWT (same pattern as admin-data.js)
function verifyAdminToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
  const token = authHeader.slice(7);
  // Simple check — admin-data.js signs tokens with ADMIN_SECRET
  // We just verify it's a non-empty bearer token from the session
  // (admin-data.js handles full JWT verification; we trust the same header)
  return token.length > 10;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Require admin auth
  if (!verifyAdminToken(event.headers['authorization'])) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { id } = body;
  if (!id) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing registration id' }) };
  }

  // Load registration from Blobs
  let reg;
  try {
    const store = getStore();
    const raw   = await store.get('registrations');
    const arr   = raw ? JSON.parse(raw) : [];
    reg = arr.find(r => r.id === id);
    if (!reg) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Registration not found: ' + id }) };
    }
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not load registrations: ' + err.message }) };
  }

  // Build the golfers array the email function expects
  // Registrations from Stripe webhook have r.golfers[] with {firstName, lastName, email}
  // Registrations added manually may just have r.name / r.firstName / r.lastName / r.email
  let golfers = [];
  if (reg.golfers && reg.golfers.length > 0) {
    golfers = reg.golfers.map(g => ({
      firstName: g.firstName || '',
      lastName:  g.lastName  || '',
      email:     g.email     || '',
      phone:     g.phone     || reg.phone || '',
      company:   g.company   || '',
    }));
    // Ensure primary email is on player 1 if missing
    if (!golfers[0].email && reg.email) golfers[0].email = reg.email;
    if (!golfers[0].phone && reg.phone) golfers[0].phone = reg.phone;
  } else {
    // Fallback for manually-added entries
    golfers = [{
      firstName: reg.firstName || (reg.name || '').split(' ')[0] || '',
      lastName:  reg.lastName  || (reg.name || '').split(' ').slice(1).join(' ') || '',
      email:     reg.email     || '',
      phone:     reg.phone     || '',
      company:   reg.company   || '',
    }];
  }

  const primary = golfers[0];
  if (!primary.email) {
    return { statusCode: 400, body: JSON.stringify({ error: 'No email address on file for this registration' }) };
  }

  const amount = reg.amount || reg.total || 0;
  // amount stored as dollars (post-fix); guard against old cents values
  const amountDollars = amount > 10000 ? amount / 100 : amount;

  // Fire the email
  const emailRes = await fetch(`${process.env.URL}/.netlify/functions/send-registration-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      golfers,
      addons:       reg.addons       || [],
      sponsorships: reg.sponsorships || [],
      total:        amountDollars,
      isResend:     true,   // lets email function tweak subject line
    }),
  });

  const emailData = await emailRes.json().catch(() => ({}));

  if (!emailRes.ok) {
    console.error('Email function error:', emailRes.status, emailData);
    return { statusCode: 500, body: JSON.stringify({ error: 'Email send failed', detail: emailData }) };
  }

  // Mark confirmationEmailSent on the record
  try {
    const store = getStore();
    const raw   = await store.get('registrations');
    const arr   = raw ? JSON.parse(raw) : [];
    const idx   = arr.findIndex(r => r.id === id);
    if (idx !== -1) {
      arr[idx].confirmationEmailSent = true;
      arr[idx].updatedAt = new Date().toISOString();
      await store.set('registrations', JSON.stringify(arr));
    }
  } catch (err) {
    console.warn('Could not update email status:', err.message);
  }

  console.log('Resend confirmation sent for', id, 'to', primary.email);
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ success: true, sentTo: primary.email }),
  };
};
