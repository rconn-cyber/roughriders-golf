// admin-dashboard.js
// Returns aggregated data for the dashboard panel:
// KPI stats, revenue by type, sponsor availability, recent registrations

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

function getBlobStore() {
  const siteID  = process.env.NETLIFY_SITE_ID;
  const token   = process.env.NETLIFY_TOKEN || process.env.NETLIFY_ACCESS_TOKEN;
  const apiBase = `https://api.netlify.com/api/v1/sites/${siteID}/blobs`;
  const headers = { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };
  return {
    async get(key) {
      const metaR = await fetch(`${apiBase}/${encodeURIComponent('golf-admin/' + key)}`, { headers });
      if (metaR.status === 404) return null;
      if (!metaR.ok) return null;
      const meta = await metaR.json();
      if (!meta.url) return null;
      const dataR = await fetch(meta.url);
      if (!dataR.ok) return null;
      return dataR.text();
    }
  };
}

const SPONSOR_CAPS = {
  'Title Sponsor':   { cap: 1,  price: 7500  },
  'Gold Sponsor':    { cap: 4,  price: 5000  },
  'Silver Sponsor':  { cap: 6,  price: 2500  },
  'VIP Tent':        { cap: 1,  price: 1500  },
  'Beverage Cart':   { cap: 1,  price: 1500  },
  'Bronze Sponsor':  { cap: 8,  price: 1000  },
  'Lunch / Dinner':  { cap: 1,  price: 1250  },
  'Breakfast':       { cap: 2,  price: 750   },
  'Hole Sponsor':    { cap: 18, price: 250   },
};

const MAX_TEAMS       = 36;
const MAX_INDIVIDUALS = 16;
const PLAYER_PRICE    = 195;

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (!auth(event)) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };

  try {
    const store = getBlobStore();
    const [regRaw, sponsorRaw, configRaw] = await Promise.all([
      store.get('registrations'),
      store.get('sponsors'),
      store.get('config'),
    ]);

    const registrations = regRaw    ? JSON.parse(regRaw)    : [];
    const sponsors      = sponsorRaw ? JSON.parse(sponsorRaw) : [];
    const config        = configRaw  ? JSON.parse(configRaw)  : {};

    // ── KPI calculations ──────────────────────────────────
    const paidRegs     = registrations.filter(r => r.status === 'paid' || r.status === 'confirmed');
    const teamRegs     = paidRegs.filter(r => r.regType === 'team' || r.players >= 4);
    const indivRegs    = paidRegs.filter(r => r.regType !== 'team' && r.players < 4);
    const totalPlayers = paidRegs.reduce((s, r) => s + (r.players || 1), 0);

    const regRevenue     = paidRegs.reduce((s, r) => s + (r.amount || 0), 0);
    const sponsorRevenue = sponsors.filter(s => s.status === 'paid' || s.status === 'confirmed')
                                   .reduce((s, sp) => s + (sp.amount || 0), 0);
    const totalRevenue   = regRevenue + sponsorRevenue;

    // Add-on revenue: sum of non-reg, non-sponsor line items
    const addonRevenue = paidRegs.reduce((sum, r) => {
      if (r.addons) {
        // addons is a string like "Mulligan Pack, Super Ticket"
        // We don't store per-addon prices yet so estimate from total - (players * PLAYER_PRICE)
        const regPortion = (r.players || 1) * PLAYER_PRICE;
        const addonPortion = Math.max(0, (r.amount || 0) - regPortion);
        return sum + addonPortion;
      }
      return sum;
    }, 0);

    // ── Revenue by type ───────────────────────────────────
    const revenueByType = [];
    // Sponsor levels
    const levelTotals = {};
    for (const sp of sponsors) {
      if (sp.status !== 'paid' && sp.status !== 'confirmed') continue;
      const level = sp.level || sp.sponsorLevel || 'Other';
      levelTotals[level] = (levelTotals[level] || 0) + (sp.amount || 0);
    }
    for (const [name, amount] of Object.entries(levelTotals)) {
      revenueByType.push({ name, amount, type: 'sponsor' });
    }
    // Registration
    const pureRegRev = paidRegs.reduce((s, r) => s + Math.min(r.amount || 0, (r.players || 1) * PLAYER_PRICE), 0);
    if (pureRegRev > 0) revenueByType.push({ name: 'Reg', amount: pureRegRev, type: 'reg' });
    if (addonRevenue > 0) revenueByType.push({ name: 'Add-Ons', amount: Math.round(addonRevenue), type: 'addon' });

    // ── Sponsor availability ──────────────────────────────
    const soldByLevel = {};
    for (const sp of sponsors) {
      if (sp.status === 'paid' || sp.status === 'confirmed') {
        const level = sp.level || sp.sponsorLevel || '';
        soldByLevel[level] = (soldByLevel[level] || 0) + 1;
      }
    }
    const sponsorAvailability = Object.entries(SPONSOR_CAPS).map(([level, { cap, price }]) => ({
      level, cap, price, sold: soldByLevel[level] || 0,
      remaining: cap - (soldByLevel[level] || 0)
    }));

    // ── Recent registrations (last 10) ────────────────────
    const recent = [...paidRegs]
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 10)
      .map(r => ({
        id:          r.id,
        name:        r.name || `${r.firstName} ${r.lastName}`.trim(),
        email:       r.email,
        regType:     r.regType || (r.players >= 4 ? 'team' : 'individual'),
        players:     r.players || 1,
        teamName:    r.teamName || '',
        sponsorLevel: r.sponsorLevels || '',
        addons:      r.addons || '',
        amount:      r.amount,
        createdAt:   r.createdAt,
        status:      r.status,
      }));

    // ── Days to event ─────────────────────────────────────
    const eventDate  = new Date('2026-09-14');
    const today      = new Date();
    const daysToGo   = Math.max(0, Math.ceil((eventDate - today) / (1000 * 60 * 60 * 24)));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        kpi: {
          teams:         { value: teamRegs.length,   cap: MAX_TEAMS },
          individuals:   { value: indivRegs.length,  cap: MAX_INDIVIDUALS },
          totalPlayers:  { value: totalPlayers },
          sponsorRevenue:{ value: sponsorRevenue },
          addonRevenue:  { value: Math.round(addonRevenue) },
          totalRevenue:  { value: totalRevenue },
          regCount:      { value: paidRegs.length },
        },
        revenueByType,
        sponsorAvailability,
        recentRegistrations: recent,
        daysToGo,
      }),
    };
  } catch (err) {
    console.error('admin-dashboard error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
