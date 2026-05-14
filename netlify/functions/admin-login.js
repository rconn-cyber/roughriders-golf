// netlify/functions/admin-login.js
const crypto = require('crypto');

function signToken(payload, secret) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig  = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return data + '.' + sig;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, body: '{}' }; }

  const { password } = body;
  const adminPassword = process.env.ADMIN_PASSWORD || '';
  if (!adminPassword || password !== adminPassword) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Invalid password' }) };
  }
  const secret = process.env.SESSION_SECRET || 'fallback';
  const token  = signToken({ role: 'admin', exp: Date.now() + 8 * 60 * 60 * 1000 }, secret);
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) };
};
