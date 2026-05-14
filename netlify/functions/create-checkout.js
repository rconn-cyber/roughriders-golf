// netlify/functions/create-checkout.js
// Creates a Stripe Checkout Session and returns the redirect URL.
// Called by the registration form when the user clicks "Pay Now".

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

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

  const { golfers = [], sponsorships = [] } = body;

  if (sponsorships.length === 0) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'No sponsorship items in order' }),
    };
  }

  // Build Stripe line_items from sponsorship selections
  const lineItems = sponsorships.map((s) => ({
    price_data: {
      currency: 'usd',
      product_data: {
        name: s.name,
        description: `Rough Riders Golf Tournament Sponsorship`,
      },
      unit_amount: Math.round(s.price * 100), // Stripe uses cents
    },
    quantity: 1,
  }));

  // Build a readable golfer summary for Stripe metadata
  const golferSummary = golfers
    .map((g) => `${g.firstName} ${g.lastName} (${g.email})`)
    .join('; ');

  const golferDetails = golfers
    .map((g) => {
      const parts = [
        g.company   && `Company: ${g.company}`,
        g.shirt     && `Shirt: ${g.shirt}`,
        g.handicap  && `HCP: ${g.handicap}`,
        g.phone     && `Phone: ${g.phone}`,
      ].filter(Boolean).join(', ');
      return `${g.firstName} ${g.lastName}${parts ? ` — ${parts}` : ''}`;
    })
    .join(' | ');

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: lineItems,

      // Pre-fill customer email with first golfer's email
      customer_email: golfers[0]?.email || undefined,

      // Metadata stored on the Stripe session — visible in dashboard
      metadata: {
        source:         'rough-riders-golf',
        golfer_count:   String(golfers.length),
        primary_contact: golfers[0]
          ? `${golfers[0].firstName} ${golfers[0].lastName}`
          : 'N/A',
        primary_email:  golfers[0]?.email || '',
        primary_phone:  golfers[0]?.phone || '',
        golfers:        golferSummary.slice(0, 500),   // Stripe metadata max 500 chars
        golfer_details: golferDetails.slice(0, 500),
      },

      // Where to go after payment
      success_url: process.env.SUCCESS_URL + '?session_id={CHECKOUT_SESSION_ID}',
      cancel_url:  process.env.CANCEL_URL,
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: session.url }),
    };
  } catch (err) {
    console.error('Stripe checkout error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Failed to create checkout session',
        detail: err.message,
      }),
    };
  }
};
