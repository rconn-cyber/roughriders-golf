// netlify/functions/admin-auth.js
// Server-side admin authentication for rr-golf admin panel.
// Validates password against ADMIN_PASSWORD env var; returns a session token.
// Token = HMAC-SHA256 of (timestamp + secret) so it's verifiable server-side
// without a database.

const crypto = require('crypto');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://rr-golf.netlify.app',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Token valid for 8 hours
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000;

function makeToken(secret) {
  const expires = Date.now() + TOKEN_TTL_MS;
  const payload = `${expires}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `${expires}.${sig}`;
}

exports.verifyToken = function verifyToken(token, secret) {
  if (!token || !secret) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [expires, sig] = parts;
  if (Date.now() > Number(expires)) return false;
  const expected = crypto.createHmac('sha256', secret).update(expires).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
};

exports.handler = async (event) => {
  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: 'Method not allowed' };
  }

  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    console.error('ADMIN_PASSWORD env var is not set');
    return { statusCode: 500, headers: CORS_HEADERS, body: 'Server misconfiguration' };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: CORS_HEADERS, body: 'Invalid JSON' };
  }

  const { password } = body;
  if (!password || typeof password !== 'string') {
    return { statusCode: 400, headers: CORS_HEADERS, body: 'Password required' };
  }

  // Constant-time comparison to prevent timing attacks
  const inputBuf = Buffer.from(password.trim());
  const expectedBuf = Buffer.from(adminPassword);

  let match = false;
  if (inputBuf.length === expectedBuf.length) {
    match = crypto.timingSafeEqual(inputBuf, expectedBuf);
  }

  if (!match) {
    // Small fixed delay to blunt brute-force
    await new Promise(r => setTimeout(r, 400));
    return {
      statusCode: 401,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Incorrect password' }),
    };
  }

  const token = makeToken(adminPassword);
  return {
    statusCode: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  };
};
