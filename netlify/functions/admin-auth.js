// netlify/functions/admin-auth.js
// Simple password-based admin login
// Returns a signed token stored in localStorage on the admin page

const crypto = require('crypto');

function sign(payload, secret) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig  = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try { body = JSON.parse(event.body); } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { email, password } = body;

  // Allowed admins: email + password stored in Netlify env vars
  // Format: ADMIN_USER_1=email:hashedpassword  (sha256 hex of password)
  // For simplicity we support a single ADMIN_PASSWORD env var here.
  // To add users: set ADMIN_PASSWORD=yourpassword in Netlify dashboard.

  const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim());
  const adminPassword = process.env.ADMIN_PASSWORD || '';

  if (!adminEmails.includes(email) || password !== adminPassword) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: 'Invalid credentials' }),
    };
  }

  const secret = process.env.SESSION_SECRET || 'fallback-secret';
  const token  = sign({ email, role: 'admin', exp: Date.now() + 8 * 60 * 60 * 1000 }, secret);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, email }),
  };
};
