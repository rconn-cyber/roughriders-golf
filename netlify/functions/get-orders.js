// netlify/functions/get-orders.js
// Fetches completed Stripe Checkout Sessions for the admin dashboard.
// Protected — requires valid admin token in Authorization header.

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
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

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Verify admin token
  const authHeader = event.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  const payload = verifyToken(token, process.env.SESSION_SECRET || 'fallback-secret');
  if (!payload) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    // Fetch up to 100 most recent checkout sessions
    const sessions = await stripe.checkout.sessions.list({
      limit: 100,
      expand: ['data.line_items'],
    });

    const orders = sessions.data.map((s) => {
      const meta      = s.metadata || {};
      const lineItems = s.line_items?.data || [];
      const total     = (s.amount_total || 0) / 100;

      // Parse golfer details from metadata
      const golferNames = (meta.golfers || '').split(';').map(g => g.trim()).filter(Boolean);
      const golferDetails = (meta.golfer_details || '').split('|').map(g => g.trim()).filter(Boolean);

      const golfers = golferNames.map((name, i) => {
        const detail = golferDetails[i] || '';
        const get = (key) => detail.match(new RegExp(`${key}: ([^,]+)`))?.[1]?.trim() || '';
        return {
          name:     name.split('(')[0].trim(),
          email:    name.match(/\((.+)\)/)?.[1] || '',
          company:  get('Company'),
          shirt:    get('Shirt'),
          handicap: get('HCP'),
          phone:    get('Phone'),
        };
      });

      // Separate sponsorships from the line items
      const sponsorships = lineItems.map((li) => ({
        name:  li.description || li.price?.product?.name || 'Sponsorship',
        price: (li.amount_total || 0) / 100,
      }));

      return {
        orderId:        s.id,
        createdAt:      new Date(s.created * 1000).toISOString(),
        state:          s.payment_status === 'paid' ? 'COMPLETED' : 'OPEN',
        total,
        primaryContact: meta.primary_contact || golfers[0]?.name || 'Unknown',
        primaryEmail:   meta.primary_email || '',
        golferCount:    golfers.length || parseInt(meta.golfer_count || '0'),
        golfers,
        sponsorships,
      };
    });

    const stats = {
      totalRevenue:    orders.filter(o => o.state === 'COMPLETED').reduce((s, o) => s + o.total, 0),
      totalOrders:     orders.length,
      totalGolfers:    orders.reduce((s, o) => s + o.golferCount, 0),
      completedOrders: orders.filter(o => o.state === 'COMPLETED').length,
    };

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orders, stats }),
    };
  } catch (err) {
    console.error('get-orders error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
