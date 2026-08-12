// netlify/functions/upload-sponsor-logo.js
// Accepts a base64 logo, uploads to Supabase Storage, returns a public URL.
// Called from register.html before Stripe checkout so the URL can be stored
// in session metadata and picked up by the webhook.

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { ...CORS, 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST' }, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { logoData, fileName, mimeType } = JSON.parse(event.body || '{}');
    if (!logoData) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'No logoData provided' }) };

    // Strip base64 prefix (data:image/png;base64,...)
    const base64 = logoData.replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(base64, 'base64');

    // Sanitize filename, add timestamp to avoid collisions
    const ext      = (mimeType || 'image/png').split('/')[1].replace('jpeg', 'jpg').replace('svg+xml', 'svg');
    const safeName = (fileName || 'logo').replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.[^.]+$/, '');
    const path     = `${Date.now()}_${safeName}.${ext}`;

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey  = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

    const uploadRes = await fetch(
      `${supabaseUrl}/storage/v1/object/golf-sponsor-logos/${path}`,
      {
        method: 'POST',
        headers: {
          'apikey':        serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
          'Content-Type':  mimeType || 'image/png',
          'x-upsert':      'true',
        },
        body: buffer,
      }
    );

    if (!uploadRes.ok) {
      const err = await uploadRes.text();
      console.error('Storage upload failed:', uploadRes.status, err);
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Upload failed: ' + err }) };
    }

    const publicUrl = `${supabaseUrl}/storage/v1/object/public/golf-sponsor-logos/${path}`;
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ url: publicUrl }) };

  } catch (err) {
    console.error('upload-sponsor-logo error:', err);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
