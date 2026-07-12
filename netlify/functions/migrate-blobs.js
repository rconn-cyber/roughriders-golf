// netlify/functions/migrate-blobs.js
// ONE-TIME migration: copies all golf-admin/* Netlify Blobs into Supabase.
// Protected by x-admin-key header (must match ADMIN_PASSWORD env var).
// DELETE THIS FUNCTION after migration is verified.
//
// Usage (browser console or curl):
//   fetch('/.netlify/functions/migrate-blobs', { method: 'POST',
//     headers: { 'x-admin-key': '<ADMIN_PASSWORD>' } }).then(r => r.json()).then(console.log)

const KNOWN_KEYS = [
  'registrations', 'sponsors', 'settings',
  'reserved-teams', 'sponsor-config', 'event-content',
];

function blobApi() {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token  = process.env.NETLIFY_TOKEN || process.env.NETLIFY_ACCESS_TOKEN;
  const apiBase = `https://api.netlify.com/api/v1/sites/${siteID}/blobs`;
  const headers = { 'Authorization': 'Bearer ' + token };
  return {
    async get(key) {
      const metaR = await fetch(`${apiBase}/${encodeURIComponent('golf-admin/' + key)}`, { headers });
      if (!metaR.ok) return null;
      const meta = await metaR.json();
      if (!meta.url) return null;
      const dataR = await fetch(meta.url);
      if (!dataR.ok) return null;
      return dataR.text();
    },
  };
}

function supa() {
  const base = process.env.SUPABASE_URL + '/rest/v1';
  const key  = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const headers = { 'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' };
  const TABLES = { registrations: 'golf_registrations', sponsors: 'golf_sponsors' };
  return {
    async set(k, parsed) {
      if (TABLES[k]) {
        const r = await fetch(`${base}/rpc/golf_replace_all`, {
          method: 'POST', headers,
          body: JSON.stringify({ p_table: TABLES[k], p_records: parsed }),
        });
        if (!r.ok) throw new Error(`replace ${k}: ${r.status} ${await r.text()}`);
        return;
      }
      const r = await fetch(`${base}/golf_config?on_conflict=key`, {
        method: 'POST',
        headers: { ...headers, 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify({ key: k, value: parsed, updated_at: new Date().toISOString() }),
      });
      if (!r.ok) throw new Error(`config ${k}: ${r.status} ${await r.text()}`);
    },
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const adminKey = (event.headers || {})['x-admin-key'] || '';
  if (!process.env.ADMIN_PASSWORD || adminKey !== process.env.ADMIN_PASSWORD) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const blobs = blobApi();
  const db    = supa();
  const results = {};

  try {
    // 1. Migrate known keys
    for (const key of KNOWN_KEYS) {
      const raw = await blobs.get(key);
      if (raw === null) { results[key] = 'not found (skipped)'; continue; }
      let parsed;
      try { parsed = JSON.parse(raw); }
      catch { results[key] = 'unparseable (skipped)'; continue; }
      // Some blobs may have been double-encoded (stringified twice)
      if (typeof parsed === 'string') { try { parsed = JSON.parse(parsed); } catch {} }
      await db.set(key, parsed);
      const count = Array.isArray(parsed) ? parsed.length + ' records' : 'object';
      results[key] = 'migrated (' + count + ')';
    }

    // 2. Migrate sponsor logos (logo_<sponsorId>) based on migrated sponsors
    const sponsorsRaw = await blobs.get('sponsors');
    if (sponsorsRaw) {
      let sponsors = JSON.parse(sponsorsRaw);
      if (typeof sponsors === 'string') sponsors = JSON.parse(sponsors);
      if (Array.isArray(sponsors)) {
        for (const s of sponsors) {
          if (!s.id) continue;
          const logoRaw = await blobs.get('logo_' + s.id);
          if (!logoRaw) continue;
          let logo;
          try { logo = JSON.parse(logoRaw); } catch { continue; }
          if (typeof logo === 'string') { try { logo = JSON.parse(logo); } catch { continue; } }
          await db.set('logo_' + s.id, logo);
          results['logo_' + s.id] = 'migrated';
        }
      }
    }

    return { statusCode: 200, body: JSON.stringify({ success: true, results }, null, 2) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ success: false, results, error: err.message }, null, 2) };
  }
};
