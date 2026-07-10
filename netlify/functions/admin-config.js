// netlify/functions/admin-config.js
// GET  — public
//   ?key=sponsor-config  → returns sponsor config (levels, benefits, alacarte)
//   ?key=event-content   → returns { html: "..." } for the home page highlights block
//   ?key=team-capacity   → COMPUTED LIVE from registrations + reserved-teams blobs
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
