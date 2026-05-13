// netlify/functions/get-orders.js
// Fetches recent orders from Square and returns structured data for the admin page
// Protected — requires valid admin token in Authorization header

const { Client, Environment } = require('square');
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

const client = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN,
  environment:
    process.env.SQUARE_BASE_URL?.includes('sandbox')
      ? Environment.Sandbox
      : Environment.Production,
});

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
    // Search orders at this location
    const ordersResp = await client.ordersApi.searchOrders({
      locationIds: [process.env.SQUARE_LOCATION_ID],
      query: {
        sort: { sortField: 'CREATED_AT', sortOrder: 'DESC' },
        filter: {
          stateFilter: { states: ['COMPLETED', 'OPEN'] },
        },
      },
      limit: 200,
    });

    const rawOrders = ordersResp.result?.orders || [];

    // Shape data for the admin UI
    const orders = rawOrders.map((o) => {
      const meta      = o.metadata || {};
      const lineItems = o.lineItems || [];
      const totalMoney = o.totalMoney?.amount
        ? Number(o.totalMoney.amount) / 100
        : 0;

      // Separate golfer registrations from sponsorships
      const golferLines = lineItems.filter(l =>
        l.name?.toLowerCase().includes('golfer registration')
      );
      const sponsorLines = lineItems.filter(l =>
        !l.name?.toLowerCase().includes('golfer registration')
      );

      // Parse golfer details from line item notes
      const golfers = golferLines.map(l => {
        const note = l.note || '';
        const get  = (key) => note.match(new RegExp(`${key}: ([^|]+)`))?.[1]?.trim() || '';
        const namePart = l.name.replace('Golfer Registration — ', '').trim();
        return {
          name:      namePart,
          company:   get('Company'),
          shirt:     get('Shirt'),
          handicap:  get('Handicap'),
          phone:     get('Phone'),
        };
      });

      return {
        orderId:       o.id,
        createdAt:     o.createdAt,
        state:         o.state,
        total:         totalMoney,
        primaryContact: meta.primaryContact || golfers[0]?.name || 'Unknown',
        golferCount:   golferLines.length,
        golfers,
        sponsorships:  sponsorLines.map(l => ({
          name:  l.name,
          price: l.basePriceMoney?.amount ? Number(l.basePriceMoney.amount) / 100 : 0,
        })),
      };
    });

    // Summary stats
    const stats = {
      totalRevenue:    orders.reduce((s, o) => s + o.total, 0),
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
