// netlify/functions/send-registration-email.js
// Sends two emails when a golfer registers:
// 1. Confirmation email to the registrant
// 2. Notification email to the admin
// Uses Resend (free tier: 3,000 emails/month, no credit card needed)
// Sign up at: https://resend.com — get your API key and add RESEND_API_KEY to Netlify env vars

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { golfers = [], addons = [], sponsorships = [], total = 0 } = body;
  const primary = golfers[0];

  if (!primary || !primary.email) {
    return { statusCode: 400, body: JSON.stringify({ error: 'No primary golfer email' }) };
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const ADMIN_EMAIL    = process.env.ADMIN_EMAILS?.split(',')[0]?.trim() || 'r.conn@tamparoughriders.org';
  const FROM_EMAIL     = process.env.FROM_EMAIL || 'golf@tamparoughriders.org';
  // NOTE: FROM_EMAIL domain must be verified in Resend dashboard
  // Until verified, use: onboarding@resend.dev for testing

  const fmt = n => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2 });

  // Build golfer list HTML
  const golferRows = golfers.map((g, i) => `
    <tr style="border-bottom:1px solid #e8e8e4;">
      <td style="padding:8px 12px;font-weight:600;color:#0f2318;">Player ${i + 1}</td>
      <td style="padding:8px 12px;">${g.firstName} ${g.lastName}${g.company ? ` — ${g.company}` : ''}</td>
      <td style="padding:8px 12px;color:#555;">${g.email || '—'}</td>
      <td style="padding:8px 12px;color:#555;">${g.phone || '—'}</td>
    </tr>`).join('');

  const addonRows = addons.length ? addons.map(a => `
    <tr>
      <td style="padding:6px 12px;">${a.name}</td>
      <td style="padding:6px 12px;font-weight:600;color:#0f2318;">${fmt(a.price)}</td>
    </tr>`).join('') : '';

  const sponsorRows = sponsorships.length ? sponsorships.map(s => `
    <tr>
      <td style="padding:6px 12px;">${s.name}</td>
      <td style="padding:6px 12px;font-weight:600;color:#0f2318;">${fmt(s.price)}</td>
    </tr>`).join('') : '';

  // ── CONFIRMATION EMAIL to registrant ──
  const confirmHtml = `
  <!DOCTYPE html>
  <html>
  <body style="font-family:'Helvetica Neue',Arial,sans-serif;background:#f4f6f4;margin:0;padding:24px;">
    <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.1);">

      <!-- Header -->
      <div style="background:linear-gradient(135deg,#0d2d5c,#1a4a8a);padding:32px 36px;text-align:center;">
        <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:rgba(255,255,255,0.65);margin-bottom:8px;">1st U.S. Volunteer Cavalry Regiment — Rough Riders</div>
        <h1 style="font-family:Georgia,serif;font-size:28px;font-weight:900;color:#fff;margin:0 0 6px;">39th Annual Charity</h1>
        <h1 style="font-family:Georgia,serif;font-size:28px;font-weight:900;color:#f5d840;margin:0 0 12px;">Golf Tournament</h1>
        <div style="font-size:13px;color:rgba(255,255,255,0.75);">Monday, September 14, 2026 · Hunter's Green Country Club · Tampa, FL</div>
      </div>

      <!-- Body -->
      <div style="padding:32px 36px;">
        <h2 style="font-family:Georgia,serif;font-size:22px;color:#0f2318;margin:0 0 8px;">You're registered, ${primary.firstName}! 🏌️</h2>
        <p style="color:#2a2a26;font-size:15px;line-height:1.6;margin:0 0 24px;">
          Thank you for registering for the 39th Annual Rough Riders Charity Golf Tournament.
          Your spot is confirmed — we'll be in touch with tee times and event details closer to September 14.
        </p>

        <!-- Players -->
        <h3 style="font-size:11px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:#0f2318;margin:0 0 10px;">Your Group</h3>
        <table style="width:100%;border-collapse:collapse;margin-bottom:24px;font-size:14px;">
          <thead>
            <tr style="background:#f0f4f0;">
              <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#555;">#</th>
              <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#555;">Name</th>
              <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#555;">Email</th>
              <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#555;">Phone</th>
            </tr>
          </thead>
          <tbody>${golferRows}</tbody>
        </table>

        <!-- Order summary -->
        ${addons.length || sponsorships.length ? `
        <h3 style="font-size:11px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:#0f2318;margin:0 0 10px;">Order Summary</h3>
        <table style="width:100%;border-collapse:collapse;margin-bottom:24px;font-size:14px;">
          <tbody>
            <tr style="background:#f0f4f0;">
              <td style="padding:8px 12px;font-weight:600;">Golf Registration — ${golfers.length} Player${golfers.length > 1 ? 's' : ''}</td>
              <td style="padding:8px 12px;font-weight:700;color:#0f2318;">${fmt(golfers.length * 165)}</td>
            </tr>
            ${addonRows}
            ${sponsorRows}
            <tr style="border-top:2px solid #0f2318;">
              <td style="padding:12px;font-weight:800;font-size:16px;color:#0f2318;">Total</td>
              <td style="padding:12px;font-weight:900;font-size:18px;color:#b8940e;">${fmt(total)}</td>
            </tr>
          </tbody>
        </table>` : ''}

        <p style="color:#2a2a26;font-size:14px;line-height:1.6;margin:0 0 8px;">
          Questions? Reply to this email or contact us at
          <a href="mailto:r.conn@tamparoughriders.org" style="color:#2d7a4a;font-weight:600;">r.conn@tamparoughriders.org</a>
        </p>
        <p style="color:#555;font-size:13px;margin:0;">Proceeds benefit veterans and local charities. Thank you for your support!</p>
      </div>

      <!-- Footer -->
      <div style="background:#0f2318;padding:20px 36px;text-align:center;">
        <div style="color:rgba(255,255,255,0.6);font-size:12px;">1st U.S. Volunteer Cavalry Regiment "Rough Riders" · Tampa, FL</div>
        <div style="margin-top:4px;"><a href="https://tamparoughriders.org" style="color:#f5d840;font-size:12px;text-decoration:none;">tamparoughriders.org</a></div>
      </div>
    </div>
  </body>
  </html>`;

  // ── ADMIN NOTIFICATION EMAIL ──
  const adminHtml = `
  <!DOCTYPE html>
  <html>
  <body style="font-family:'Helvetica Neue',Arial,sans-serif;background:#f4f6f4;margin:0;padding:24px;">
    <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.1);">
      <div style="background:#0f2318;padding:24px 32px;">
        <h2 style="font-family:Georgia,serif;color:#f5d840;margin:0;font-size:20px;">⛳ New Golf Registration</h2>
        <div style="color:rgba(255,255,255,0.7);font-size:13px;margin-top:4px;">Rough Riders 39th Annual Tournament</div>
      </div>
      <div style="padding:28px 32px;">
        <table style="width:100%;font-size:14px;border-collapse:collapse;margin-bottom:20px;">
          <tr><td style="padding:6px 0;color:#555;width:130px;">Primary Contact</td><td style="padding:6px 0;font-weight:700;color:#0f2318;">${primary.firstName} ${primary.lastName}${primary.company ? ` — ${primary.company}` : ''}</td></tr>
          <tr><td style="padding:6px 0;color:#555;">Email</td><td style="padding:6px 0;"><a href="mailto:${primary.email}" style="color:#2d7a4a;">${primary.email}</a></td></tr>
          <tr><td style="padding:6px 0;color:#555;">Phone</td><td style="padding:6px 0;">${primary.phone || '—'}</td></tr>
          <tr><td style="padding:6px 0;color:#555;">Players</td><td style="padding:6px 0;font-weight:700;">${golfers.length}</td></tr>
          <tr><td style="padding:6px 0;color:#555;">Total</td><td style="padding:6px 0;font-weight:900;font-size:18px;color:#b8940e;">${fmt(total)}</td></tr>
        </table>

        ${golfers.length > 1 ? `
        <h4 style="font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#0f2318;margin:0 0 8px;">All Players</h4>
        <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px;">
          ${golferRows}
        </table>` : ''}

        ${addons.length ? `
        <h4 style="font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#0f2318;margin:0 0 8px;">Add-ons</h4>
        <table style="width:100%;font-size:13px;border-collapse:collapse;margin-bottom:16px;">${addonRows}</table>` : ''}

        ${sponsorships.length ? `
        <h4 style="font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#0f2318;margin:0 0 8px;">Sponsorships</h4>
        <table style="width:100%;font-size:13px;border-collapse:collapse;margin-bottom:16px;">${sponsorRows}</table>` : ''}

        <div style="background:#f0f4f0;border-radius:6px;padding:14px 16px;margin-top:16px;">
          <a href="https://dashboard.stripe.com" style="color:#2d7a4a;font-weight:600;font-size:13px;">View payment in Stripe Dashboard →</a>
        </div>
      </div>
    </div>
  </body>
  </html>`;

  try {
    // Send both emails via Resend
    const [confirmRes, adminRes] = await Promise.all([
      // Confirmation to registrant
      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: `Rough Riders Golf <${FROM_EMAIL}>`,
          to: [primary.email],
          subject: `You're registered! Rough Riders 39th Annual Golf Tournament — Sept 14, 2026`,
          html: confirmHtml,
        }),
      }),
      // Notification to admin
      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: `Rough Riders Golf <${FROM_EMAIL}>`,
          to: [ADMIN_EMAIL],
          subject: `⛳ New Registration: ${primary.firstName} ${primary.lastName} — ${golfers.length} player${golfers.length > 1 ? 's' : ''} — ${fmt(total)}`,
          html: adminHtml,
        }),
      }),
    ]);

    const confirmData = await confirmRes.json();
    const adminData   = await adminRes.json();

    console.log('Confirmation email:', confirmData);
    console.log('Admin email:', adminData);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true }),
    };
  } catch (err) {
    console.error('Email send error:', err);
    // Don't fail the whole registration over an email error
    return {
      statusCode: 200,
      body: JSON.stringify({ success: false, error: err.message }),
    };
  }
};
