// netlify/functions/admin-config.js
// GET  — public
//   ?key=sponsor-config  → returns sponsor config (levels, benefits, alacarte)
//   ?key=event-content   → returns { html: "..." } for the home page highlights block
//   ?key=team-capacity   → COMPUTED LIVE from registrations + reserved-teams in Supabase
// POST — requires x-admin-key header
//   body must include { _key: "sponsor-config"|"event-content", ...data }

const ADMIN_KEY  = process.env.ADMIN_PASSWORD;
const BLOB_KEYS  = {
  'sponsor-config': 'golf-admin/sponsor-config',
  'event-content':  'golf-admin/event-content',
  'team-capacity':  'golf-admin/team-capacity',
};
const DEFAULT_VALS = {
  'sponsor-config': JSON.stringify({ benefits: [], levels: [], alacarte: [] }),
  'event-content':  JSON.stringify({ html: '' }),
  'team-capacity':  JSON.stringify({ totalTeams: 18, confirmedTeams: 0, reservedTeams: 0, usedSlots: 0, openSlots: 18, individuals: 0 }),
};

const MAX_TEAMS = 18;

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-admin-key',
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json',
};

// Supabase-backed store (migrated from Netlify Blobs).
// 'registrations' and 'sponsors' live in their own tables (golf_registrations,
// golf_sponsors, one row per record). Everything else (settings, sponsor-config,
// event-content, reserved-teams, logo_*) lives in the golf_config KV table.
// Interface is identical to the old blob store: get(key) -> JSON string | null,
// set(key, value) -> void (throws on failure).
function getStore() {
  const base = process.env.SUPABASE_URL + '/rest/v1';
  const key  = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
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

// Back-compat wrappers — call sites still pass full 'golf-admin/…' keys.
async function blobGet(key) {
  return getStore().get(key.replace(/^golf-admin\//, ''));
}
async function blobSet(key, value) {
  return getStore().set(key.replace(/^golf-admin\//, ''), value);
}

// Mirror the exact logic from admin.html getConfirmedTeamCount / getIndividualCount
function computeTeamCapacity(regs, reserved) {
  let confirmedTeams    = 0;
  let individualPlayers = 0;

  for (const r of regs) {
    if (r.status === 'cancelled') continue;
    const p = r.playerCount || (r.golfers && r.golfers.length) || 1;
    const t = r.registrationType || r.type || '';

    if (p >= 4 || t === 'team' || t === 'comped-team' || t === 'sponsor-team') {
      // sponsor-team entries may represent multiple teams (e.g. Gold = 2 teams)
      confirmedTeams += (t === 'sponsor-team' ? (Math.ceil(p / 4) || 1) : 1);
    } else {
      individualPlayers += p;
    }
  }

  const reservedCount = reserved.filter(r => r.status !== 'cancelled').length;
  const indivSlots    = Math.floor(individualPlayers / 4);
  const indivPartial  = individualPlayers % 4;
  const used          = confirmedTeams + reservedCount + indivSlots;
  const open          = Math.max(0, MAX_TEAMS - used);

  return {
    totalTeams:     MAX_TEAMS,
    confirmedTeams,
    reservedTeams:  reservedCount,
    usedSlots:      used,
    openSlots:      open,
    individuals:    individualPlayers,
    indivSlots,
    indivPartial,
  };
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  // ── GET: public ──
  if (event.httpMethod === 'GET') {
    const qs  = event.queryStringParameters || {};
    const key = qs.key || 'sponsor-config';
    const blobKey = BLOB_KEYS[key];
    if (!blobKey) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Unknown key' }) };

    try {
      // team-capacity is always computed live from registrations + reserved-teams
      if (key === 'team-capacity') {
        const [regsRaw, reservedRaw] = await Promise.all([
          blobGet('golf-admin/registrations'),
          blobGet('golf-admin/reserved-teams'),
        ]);
        const regs     = regsRaw     ? JSON.parse(regsRaw)     : [];
        const reserved = reservedRaw ? JSON.parse(reservedRaw) : [];
        const capacity = computeTeamCapacity(
          Array.isArray(regs)     ? regs     : (regs.items     || []),
          Array.isArray(reserved) ? reserved : (reserved.items || [])
        );
        return { statusCode: 200, headers: CORS, body: JSON.stringify(capacity) };
      }

      const raw = await blobGet(blobKey);
      return {
        statusCode: 200,
        headers: CORS,
        body: raw || DEFAULT_VALS[key],
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
      return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorized' }) };
    }
    try {
      const body   = event.body || '{}';
      const parsed = JSON.parse(body);
      // Determine which key to save
      const keyName = parsed._key || 'sponsor-config';
      const blobKey = BLOB_KEYS[keyName];
      if (!blobKey) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Unknown _key' }) };
      // Strip internal _key field before storing
      delete parsed._key;
      await blobSet(blobKey, JSON.stringify(parsed));
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ success: true }) };
    } catch (e) {
      console.error('POST error:', e);
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
    }
  }

  return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
};
