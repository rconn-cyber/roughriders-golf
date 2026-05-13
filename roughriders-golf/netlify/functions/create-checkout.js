// netlify/functions/create-checkout.js
// Creates a Square Order + Checkout link and returns the payment URL
// Called by the registration form when user clicks "Pay Now"

const { Client, Environment } = require('square');
const { v4: uuidv4 } = require('uuid');

const client = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN,
  environment:
    process.env.SQUARE_BASE_URL?.includes('sandbox')
      ? Environment.Sandbox
      : Environment.Production,
});

exports.handler = async (event) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { golfers = [], sponsorships = [], totalCents } = body;

  // Build line items for Square
  const lineItems = [];

  // One line item per golfer (free registration — $0, or set a price)
  golfers.forEach((g) => {
    lineItems.push({
      name: `Golfer Registration — ${g.firstName} ${g.lastName}`,
      quantity: '1',
      basePriceMoney: { amount: BigInt(0), currency: 'USD' },
      note: [
        g.company && `Company: ${g.company}`,
        g.shirt    && `Shirt: ${g.shirt}`,
        g.handicap && `Handicap: ${g.handicap}`,
        g.phone    && `Phone: ${g.phone}`,
      ]
        .filter(Boolean)
        .join(' | '),
    });
  });

  // One line item per sponsorship
  sponsorships.forEach((s) => {
    lineItems.push({
      name: s.name,
      quantity: '1',
      basePriceMoney: {
        amount: BigInt(Math.round(s.price * 100)),
        currency: 'USD',
      },
    });
  });

  // Fallback: if no sponsorships and no paid items, add a $0 placeholder
  if (lineItems.length === 0) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'No items in order' }),
    };
  }

  try {
    const response = await client.checkoutApi.createPaymentLink({
      idempotencyKey: uuidv4(),
      order: {
        locationId: process.env.SQUARE_LOCATION_ID,
        lineItems,
        metadata: {
          source: 'rough-riders-golf-registration',
          golferCount: String(golfers.length),
          primaryContact: golfers[0]
            ? `${golfers[0].firstName} ${golfers[0].lastName} <${golfers[0].email}>`
            : 'N/A',
        },
      },
      checkoutOptions: {
        redirectUrl: process.env.SUCCESS_URL,
        askForShippingAddress: false,
        merchantSupportEmail: process.env.ADMIN_EMAILS?.split(',')[0] || '',
        acceptedPaymentMethods: {
          applePay: true,
          googlePay: true,
          cashAppPay: false,
          afterpayClearpay: false,
        },
      },
      prePopulatedData: golfers[0]
        ? {
            buyerEmail: golfers[0].email,
            buyerPhoneNumber: golfers[0].phone,
          }
        : undefined,
    });

    const url = response.result?.paymentLink?.url;
    if (!url) throw new Error('No payment link URL returned from Square');

    // Also store the registration data in Netlify Blobs (or just log it)
    // For now we return the URL — admin page reads from Square dashboard
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    };
  } catch (err) {
    console.error('Square checkout error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Failed to create payment link',
        detail: err.message,
      }),
    };
  }
};
