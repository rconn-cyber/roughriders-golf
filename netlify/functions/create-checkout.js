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

  const { golfers = [], sponsorships = [], teamName = '', regType = 'individual' } = body;

  if (sponsorships.length === 0) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'No sponsorship items in order' }),
    };
  }

  const EVENT_LINE = '39th Annual Charity Golf Tournament · Hunter's Green Country Club, Tampa FL · Sept 14, 2026';

  // Categorise line items for richer descriptions
  const regItems      = sponsorships.filter(s => s.name.startsWith('Golf Registration'));
  const addonItems    = sponsorships.filter(s => !s.name.startsWith('Golf Registration') && !s.isSponsor);
  const sponsorItems  = sponsorships.filter(s => s.isSponsor);

  // Build per-line-item descriptions
  const lineItems = sponsorships.map((s) => {
    let desc = EVENT_LINE;

    if (s.name.startsWith('Golf Registration')) {
      // Registration line — include reg type, player names, add-ons summary
      const parts = [];
      parts.push(`Registration type: ${regType === 'team' ? 'Full Team (4 players)' : 'Individual / Group'}`);
      if (teamName) parts.push(`Team: ${teamName}`);
      if (golfers.length) {
        const names = golfers.map(g => `${g.firstName} ${g.lastName}`.trim()).filter(Boolean);
        if (names.length) parts.push(`Players: ${names.join(', ')}`);
      }
      if (addonItems.length) {
        parts.push(`Add-ons: ${addonItems.map(a => a.name).join(', ')}`);
      }
      desc = parts.join(' · ');

    } else if (s.isSponsor) {
      // Sponsorship line — include benefits
      const parts = [`Sponsorship: ${s.name}`, EVENT_LINE];
      if (s.benefits && s.benefits.length) {
        parts.push(`Benefits: ${s.benefits.join(', ')}`);
      }
      desc = parts.join(' · ');

    } else {
      // Add-on line — provide context
      const primaryName = golfers[0]
        ? `${golfers[0].firstName} ${golfers[0].lastName}`.trim()
        : null;
      const parts = [EVENT_LINE];
      if (primaryName) parts.push(`For: ${primaryName}`);
      if (regItems.length === 0) parts.push('Add-on only purchase');
      desc = parts.join(' · ');
    }

    return {
      price_data: {
        currency: 'usd',
        product_data: { name: s.name, description: desc.slice(0, 500) },
        unit_amount: Math.round(s.price * 100),
      },
      quantity: 1,
    };
  });

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
        source:           'rough-riders-golf',
        reg_type:         regType,
        team_name:        teamName || '',
        golfer_count:     String(golfers.length),
        primary_contact:  golfers[0] ? `${golfers[0].firstName} ${golfers[0].lastName}` : 'N/A',
        primary_email:    golfers[0]?.email || '',
        primary_phone:    golfers[0]?.phone || '',
        golfers:          golferSummary.slice(0, 500),
        golfer_details:   golferDetails.slice(0, 500),
        addons:           addonItems.map(a => a.name).join(', ').slice(0, 200) || 'none',
        sponsor_levels:   sponsorItems.map(s => s.name).join(', ').slice(0, 200) || 'none',
        sponsor_benefits: sponsorItems.flatMap(s => s.benefits || []).join(', ').slice(0, 500) || '',
      },

      // Payment description shown in Stripe transaction list — rich detail
      payment_intent_data: {
        description: (() => {
          const parts = [];
          if (golfers.length) {
            const primary = `${golfers[0].firstName} ${golfers[0].lastName}`.trim();
            parts.push(`${regType === 'team' ? 'Team Reg' : 'Golf Reg'} — ${primary}${golfers.length > 1 ? ` +${golfers.length - 1}` : ''}`);
          }
          if (teamName) parts.push(`Team: ${teamName}`);
          if (sponsorItems.length) parts.push(`Sponsor: ${sponsorItems.map(s => s.name).join(', ')}`);
          if (addonItems.length) parts.push(`Add-ons: ${addonItems.map(a => a.name).join(', ')}`);
          if (!parts.length) parts.push(`Sponsorship — ${sponsorships.map(s => s.name).join(', ')}`);
          return parts.join(' | ').slice(0, 1000);
        })(),
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
