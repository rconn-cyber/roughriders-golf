// netlify/functions/stripe-webhook.js
// Listens for Stripe checkout.session.completed and saves the registration to Supabase.

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

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

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Verify Stripe signature
  const sig = event.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  let stripeEvent;

  try {
    stripeEvent = stripe.webhooks.constructEvent(event.body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  // Only handle checkout completion
  if (stripeEvent.type !== 'checkout.session.completed') {
    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  }

  const session = stripeEvent.data.object;
  const meta    = session.metadata || {};

  // Only process registrations from this site
  if (meta.source !== 'rough-riders-golf') {
    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  }

  // Parse golfers from metadata
  // golfers field: "First Last (email); First Last (email)"
  const golferStrings = (meta.golfers || '').split(';').map(s => s.trim()).filter(Boolean);
  const golfers = golferStrings.map(s => {
    const match = s.match(/^(.+?)\s+\((.+)\)$/);
    if (match) {
      const nameParts = match[1].trim().split(' ');
      return {
        firstName: nameParts[0] || '',
        lastName:  nameParts.slice(1).join(' ') || '',
        email:     match[2].trim(),
      };
    }
    return { firstName: s, lastName: '', email: '' };
  });

  // Parse first/last name from primary_contact ("First Last")
  const primaryContact = meta.primary_contact || '';
  const contactParts   = primaryContact.trim().split(/\s+/);
  const firstName      = contactParts[0] || '';
  const lastName       = contactParts.slice(1).join(' ') || '';

  // amount_total is in cents — divide by 100
  const amountDollars = (session.amount_total || 0) / 100;

  // Determine registration type: 'team' if reg_type=team or golfer_count>1, else 'individual'
  const golferCount = parseInt(meta.golfer_count || '1', 10);
  const regType     = (meta.reg_type === 'team' || golferCount > 1) ? 'team' : 'individual';

  // Build registration record using canonical schema
  const now   = new Date().toISOString();
  const newId = 'rr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  const record = {
    id:                    newId,
    date:                  now,
    type:                  regType,
    email:                 meta.primary_email  || session.customer_email || '',
    notes:                 '',
    phone:                 meta.primary_phone  || '',
    total:                 amountDollars,
    addons:                Array.isArray(meta.addons)
                             ? meta.addons
                             : (meta.addons && meta.addons !== 'none')
                               ? meta.addons.split(',').map(s => s.trim()).filter(Boolean)
                               : [],
    source:                'stripe',
    status:                'paid',
    golfers,
    lastName,
    teamName:              meta.team_name       || '',
    createdAt:             now,
    firstName,
    updatedAt:             now,
    playerCount:           golferCount,
    paymentMethod:         'card',
    stripeSessionId:       session.id,
    stripePaymentIntent:   session.payment_intent,
    confirmationEmailSent: false,
  };

  // Determine if this is a sponsor-only purchase (has sponsor levels, no golfers)
  const sponsorLevels   = (meta.sponsor_levels || '').trim();
  const hasSponsorItems = sponsorLevels && sponsorLevels !== 'none';
  const isSponsorOnly   = hasSponsorItems && golferCount === 0;

  // Save to Supabase
  try {
    const store = getStore();

    if (isSponsorOnly) {
      // Save as a sponsor record
      const sponsorships = sponsorLevels.split(',').map(s => ({ name: s.trim(), price: 0 }));
      const benefits     = (meta.sponsor_benefits || '').split(',').map(s => s.trim()).filter(Boolean);
      const sponsorRecord = {
        id:                    newId,
        date:                  now,
        type:                  'sponsor',
        email:                 record.email,
        company:               record.email ? '' : `${firstName} ${lastName}`.trim(),
        firstName,
        lastName,
        notes:                 `Stripe ${session.payment_intent} — auto-imported`,
        total:                 amountDollars,
        amount:                (session.amount_total || 0),
        source:                'stripe',
        status:                'paid',
        paymentMethod:         'card',
        website:               '',
        sponsorships,
        benefits,
        golfers:               [],
        addons:                [],
        hideFromPublic:        false,
        stripeSessionId:       session.id,
        stripePaymentIntent:   session.payment_intent,
        createdAt:             now,
        updatedAt:             now,
      };
      const raw = await store.get('sponsors');
      const arr = raw ? JSON.parse(raw) : [];
      arr.push(sponsorRecord);
      await store.set('sponsors', JSON.stringify(arr));
      console.log('Sponsor saved:', sponsorRecord.id, sponsorLevels, amountDollars);
    } else {
      // Save as a registration record
      const raw = await store.get('registrations');
      const arr = raw ? JSON.parse(raw) : [];
      arr.push(record);
      await store.set('registrations', JSON.stringify(arr));
      console.log('Registration saved:', record.id, record.firstName, record.lastName, record.total);
    }
  } catch (err) {
    console.error('Failed to save record:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }

  // Skip confirmation email for sponsor-only purchases (no golfer to email)
  if (isSponsorOnly) {
    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  }

  // Fire confirmation email — pass shape the email function expects
  let emailSent = false;
  try {
    const emailPayload = {
      // email function expects golfers[], addons[], sponsorships[], total
      golfers,
      addons:       [],
      sponsorships: [],
      total:        amountDollars,
    };

    // Ensure primary golfer has all fields from metadata
    if (emailPayload.golfers.length === 0) {
      emailPayload.golfers = [{
        firstName,
        lastName,
        email: record.email,
        phone: record.phone,
      }];
    }

    const emailRes = await fetch(`${process.env.URL}/.netlify/functions/send-registration-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(emailPayload),
    });

    emailSent = emailRes.ok;
    console.log('Email result:', emailRes.status, emailSent ? 'sent' : 'failed');
  } catch (err) {
    console.warn('Email notification failed (non-fatal):', err.message);
  }

  // Update the record with email status
  if (emailSent) {
    try {
      const store = getStore();
      const raw   = await store.get('registrations');
      const arr   = raw ? JSON.parse(raw) : [];
      const idx   = arr.findIndex(r => r.id === newId);
      if (idx !== -1) {
        arr[idx].confirmationEmailSent = true;
        arr[idx].updatedAt = new Date().toISOString();
        await store.set('registrations', JSON.stringify(arr));
      }
    } catch (err) {
      console.warn('Could not update email status on record:', err.message);
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
