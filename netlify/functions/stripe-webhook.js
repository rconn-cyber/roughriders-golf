// netlify/functions/stripe-webhook.js
// Listens for Stripe checkout.session.completed and saves the registration to Blobs.

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

function getBlobStore() {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token  = process.env.NETLIFY_TOKEN || process.env.NETLIFY_ACCESS_TOKEN;
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

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Verify Stripe signature
  const sig = event.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  let stripeEvent;

  try {
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      sig,
      webhookSecret
    );
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

  // Build registration record matching admin-data.js POST format
  const newId  = 'rr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  const record = {
    id:             newId,
    stripeSessionId: session.id,
    stripePaymentIntent: session.payment_intent,
    name:           meta.primary_contact || '',
    email:          meta.primary_email   || session.customer_email || '',
    phone:          meta.primary_phone   || '',
    players:        parseInt(meta.golfer_count || '1', 10),
    golfers,
    amount:         (session.amount_total || 0) / 100,
    status:         'paid',
    paymentMethod:  'card',
    source:         'stripe',
    createdAt:      new Date().toISOString(),
    updatedAt:      new Date().toISOString(),
  };

  try {
    const store = getBlobStore();
    const raw   = await store.get('registrations');
    const arr   = raw ? JSON.parse(raw) : [];
    arr.push(record);
    await store.set('registrations', JSON.stringify(arr));
    console.log('Registration saved:', record.id, record.name, record.amount);
  } catch (err) {
    console.error('Failed to save registration to Blobs:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }

  // Fire confirmation email (non-blocking)
  try {
    await fetch(`${process.env.URL}/.netlify/functions/send-registration-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    });
  } catch (err) {
    console.warn('Email notification failed (non-fatal):', err.message);
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
