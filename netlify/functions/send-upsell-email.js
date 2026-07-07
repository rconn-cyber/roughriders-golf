// netlify/functions/send-upsell-email.js
// Admin-only endpoint: sends a post-registration upsell email to a golfer
// offering add-ons they didn't purchase at registration time.
// POST { id: "rr_..." }  — requires admin auth token

const ADDONS = [
  { name: 'Super Ticket',   price: 50,  icon: '⭐', desc: 'Entry into all on-course prize contests' },
  { name: 'Mulligan Pack',  price: 20,  icon: '🔄', desc: 'Two extra shots — use them wisely!' },
  { name: 'Closest to Pin', price: 20,  icon: '🎯', desc: 'Contest entry — win a prize for the closest shot' },
  { name: 'Longest Drive',  price: 20,  icon: '💪', desc: 'Contest entry — win a prize for the longest drive' },
  { name: 'Hole Sponsor',   price: 250, icon: '⛳', desc: 'Your name/company on a tee box sign' },
];

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
    },
    async set(key, value) {
      const body = typeof value === 'string' ? value : JSON.stringify(value);
      const metaR = await fetch(`${apiBase}/${encodeURIComponent('golf-admin/' + key)}`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Length': Buffer.byteLength(body).toString() },
      });
      if (!metaR.ok) throw new Error('Blob set presign failed: ' + metaR.status);
      const meta = await metaR.json();
      if (!meta.url) throw new Error('No presigned URL returned');
      const uploadR = await fetch(meta.url, { method: 'PUT', body, headers: { 'Content-Type': 'application/json' } });
      if (!uploadR.ok) throw new Error('Blob upload failed: ' + uploadR.status);
    },
  };
}

function verifyAdminToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
  return authHeader.slice(7).length > 10;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  if (!verifyAdminToken(event.headers['authorization'])) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { id } = body;
  if (!id) return { statusCode: 400, body: JSON.stringify({ error: 'Missing registration id' }) };

  // Load registration
  let reg;
  try {
    const store = getBlobStore();
    const raw   = await store.get('registrations');
    const arr   = raw ? JSON.parse(raw) : [];
    reg = arr.find(r => r.id === id);
    if (!reg) return { statusCode: 404, body: JSON.stringify({ error: 'Registration not found: ' + id }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not load registrations: ' + err.message }) };
  }

  // Resolve primary golfer email
  const primary = reg.golfers?.[0] || reg;
  const email   = primary.email || reg.email;
  const firstName = primary.firstName || (reg.name || '').split(' ')[0] || 'Golfer';
  if (!email) return { statusCode: 400, body: JSON.stringify({ error: 'No email on file for this registration' }) };

  // Determine which add-ons they already have
  const alreadyHave = new Set((reg.addons || []).map(a => (a.name || a).toLowerCase()));
  const available   = ADDONS.filter(a => !alreadyHave.has(a.name.toLowerCase()));

  if (available.length === 0) {
    return { statusCode: 200, body: JSON.stringify({ success: true, message: 'Golfer already has all add-ons — no upsell sent' }) };
  }

  const SITE_URL = process.env.URL || 'https://rr-golf.netlify.app';
  const FROM_EMAIL = process.env.FROM_EMAIL || 'golf@tamparoughriders.org';
  const RESEND_API_KEY = process.env.RESEND_API_KEY;

  const fmt = n => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2 });

  // Build add-on cards for email
  const addonCards = available.map(a => `
    <tr>
      <td style="padding:0 0 12px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e0e4dc;border-radius:8px;overflow:hidden;">
          <tr>
            <td style="padding:16px 20px;background:#fff;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <div style="font-size:22px;display:inline;margin-right:8px;">${a.icon}</div>
                    <span style="font-family:Georgia,serif;font-size:16px;font-weight:700;color:#0f2318;">${a.name}</span>
                    <span style="font-size:15px;font-weight:900;color:#b8940e;margin-left:10px;">${fmt(a.price)}</span>
                    <div style="font-size:13px;color:#555;margin-top:4px;">${a.desc}</div>
                  </td>
                  <td width="120" style="text-align:right;vertical-align:middle;">
                    <a href="${SITE_URL}/?upsell=1&addon=${encodeURIComponent(a.name)}&price=${a.price}&email=${encodeURIComponent(email)}&regId=${encodeURIComponent(id)}"
                       style="display:inline-block;background:#0d2d5c;color:#f5d840;font-size:13px;font-weight:700;padding:9px 16px;border-radius:6px;text-decoration:none;white-space:nowrap;">
                      Add to My Round →
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>`).join('');

  const alreadyList = [...alreadyHave].map(n =>
    ADDONS.find(a => a.name.toLowerCase() === n)?.name
  ).filter(Boolean);

  const alreadyNote = alreadyList.length
    ? `<p style="color:#555;font-size:13px;margin:0 0 24px;">You already have: <strong>${alreadyList.join(', ')}</strong>. The options below are still available to add.</p>`
    : '';

  const html = `<!DOCTYPE html>
<html>
<body style="font-family:'Helvetica Neue',Arial,sans-serif;background:#f4f6f4;margin:0;padding:24px;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.1);">

    <div style="background:linear-gradient(135deg,#0d2d5c,#1a4a8a);padding:32px 36px;text-align:center;">
      <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:rgba(255,255,255,0.65);margin-bottom:8px;">1st U.S. Volunteer Cavalry Regiment — Rough Riders</div>
      <h1 style="font-family:Georgia,serif;font-size:28px;font-weight:900;color:#fff;margin:0 0 6px;">39th Annual Charity</h1>
      <h1 style="font-family:Georgia,serif;font-size:28px;font-weight:900;color:#f5d840;margin:0 0 12px;">Golf Tournament</h1>
      <div style="font-size:13px;color:rgba(255,255,255,0.75);">Monday, September 14, 2026 · Hunter's Green Country Club · Tampa, FL</div>
    </div>

    <div style="padding:32px 36px;">
      <h2 style="font-family:Georgia,serif;font-size:22px;color:#0f2318;margin:0 0 8px;">Enhance your round, ${firstName}! ⛳</h2>
      <p style="color:#2a2a26;font-size:15px;line-height:1.6;margin:0 0 20px;">
        You're all set for September 14 — we can't wait to see you on the course!
        Before the big day, here are a few extras you can add to make your round even better.
      </p>
      ${alreadyNote}

      <h3 style="font-size:11px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:#0f2318;margin:0 0 14px;">Available Add-Ons</h3>
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
        ${addonCards}
      </table>

      <div style="background:#f8f9f5;border-radius:8px;padding:16px 20px;margin-bottom:24px;border-left:4px solid #f5d840;">
        <p style="font-size:13px;color:#555;margin:0;">
          ⏰ <strong>Add-ons close September 7, 2026</strong> — one week before the tournament.
          All payments are processed securely via Stripe.
        </p>
      </div>

      <p style="color:#2a2a26;font-size:14px;line-height:1.6;margin:0 0 8px;">
        Questions? Contact us at
        <a href="mailto:r.conn@tamparoughriders.org" style="color:#2d7a4a;font-weight:600;">r.conn@tamparoughriders.org</a>
      </p>
      <p style="color:#555;font-size:13px;margin:0;">Proceeds benefit veterans and local charities. Thank you for your support!</p>
    </div>

    <div style="background:#0f2318;padding:20px 36px;text-align:center;">
      <div style="color:rgba(255,255,255,0.6);font-size:12px;">1st U.S. Volunteer Cavalry Regiment "Rough Riders" · Tampa, FL</div>
      <div style="margin-top:4px;"><a href="https://tamparoughriders.org" style="color:#f5d840;font-size:12px;text-decoration:none;">tamparoughriders.org</a></div>
    </div>
  </div>
</body>
</html>`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `Rough Riders Golf <${FROM_EMAIL}>`,
        to:   [email],
        subject: `Add more to your round, ${firstName}! ⛳ Rough Riders Golf Tournament`,
        html,
      }),
    });

    const data = await res.json();
    console.log('Upsell email result:', data);

    if (!res.ok) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Resend error', detail: data }) };
    }

    // Mark upsellEmailSent on the record
    try {
      const store = getBlobStore();
      const raw   = await store.get('registrations');
      const arr   = raw ? JSON.parse(raw) : [];
      const idx   = arr.findIndex(r => r.id === id);
      if (idx !== -1) {
        arr[idx].upsellEmailSent = true;
        arr[idx].upsellEmailSentAt = new Date().toISOString();
        await store.set('registrations', JSON.stringify(arr));
      }
    } catch (err) {
      console.warn('Could not update upsell status:', err.message);
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, sentTo: email, addonsOffered: available.map(a => a.name) }),
    };
  } catch (err) {
    console.error('Upsell email error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
