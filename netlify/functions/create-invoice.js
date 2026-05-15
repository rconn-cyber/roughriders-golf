// netlify/functions/create-invoice.js
// Creates a Stripe Customer + Invoice with all sponsorship line items.
// Stripe emails the invoice directly to the sponsor with a Pay Now link.
// Also saves the sponsor to admin Blobs with status 'invoice' for check tracking.

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

async function saveSponsorRecord(sponsorData) {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token  = process.env.NETLIFY_TOKEN || process.env.NETLIFY_ACCESS_TOKEN;
  if (!siteID || !token) return; // silently skip if not configured

  const apiBase = `https://api.netlify.com/api/v1/sites/${siteID}/blobs`;
  const headers = { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };

  // Get existing sponsors
  let sponsors = [];
  try {
    const metaR = await fetch(`${apiBase}/${encodeURIComponent('golf-admin/sponsors')}`, { headers });
    if (metaR.ok) {
      const meta = await metaR.json();
      if (meta.url) {
        const dataR = await fetch(meta.url);
        if (dataR.ok) sponsors = JSON.parse(await dataR.text());
      }
    }
  } catch(e) { console.log('Could not read existing sponsors:', e.message); }

  // Append new sponsor record
  sponsors.push(sponsorData);

  // Save back
  const body = JSON.stringify(sponsors);
  const putR = await fetch(`${apiBase}/${encodeURIComponent('golf-admin/sponsors')}`, {
    method: 'PUT',
    headers: { ...headers, 'Content-Length': Buffer.byteLength(body).toString() },
  });
  if (putR.ok) {
    const putMeta = await putR.json();
    if (putMeta.url) {
      await fetch(putMeta.url, { method: 'PUT', body, headers: { 'Content-Type': 'application/json' } });
    }
  }
}

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

  const { firstName, lastName, email, company, phone, website, address, logoData, sponsorships = [] } = body;

  if (!email || !firstName || !lastName) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Name and email are required' }) };
  }

  if (!sponsorships.length) {
    return { statusCode: 400, body: JSON.stringify({ error: 'No sponsorship items provided' }) };
  }

  try {
    // 1. Create or retrieve a Stripe customer
    const existingCustomers = await stripe.customers.list({ email, limit: 1 });
    let customer;
    if (existingCustomers.data.length > 0) {
      customer = existingCustomers.data[0];
      await stripe.customers.update(customer.id, {
        name: `${firstName} ${lastName}`,
        ...(company && { description: company }),
        ...(phone && { phone }),
        metadata: { source: 'rough-riders-golf-invoice', company: company || '' },
      });
    } else {
      customer = await stripe.customers.create({
        email,
        name: `${firstName} ${lastName}`,
        ...(company && { description: company }),
        ...(phone && { phone }),
        metadata: { source: 'rough-riders-golf-invoice', company: company || '' },
      });
    }

    // 2. Create the invoice FIRST, then attach items to it
    const dueDate = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60);

    const invoice = await stripe.invoices.create({
      customer: customer.id,
      collection_method: 'send_invoice',
      due_date: dueDate,
      description: 'Rough Riders 39th Annual Charity Golf Tournament — Sponsorship',
      footer: 'PAY WITH CREDIT CARD: Click the "Pay this invoice" button above to pay securely online.\n\nOR SEND A CHECK:\nMake check payable to: "1st U.S. Volunteer Cavalry Regiment Rough Riders Inc"\nMail to: 601 N. 19th St, Tampa FL 33605\nPlease include your invoice number on your check.\n\nQuestions? golf@tamparoughriders.org · (813) 248-1898\nThank you for supporting the Rough Riders!',
      metadata: {
        source: 'rough-riders-golf',
        company: company || '',
        contact: `${firstName} ${lastName}`,
      },
      custom_fields: [
        { name: 'Event', value: '39th Annual Charity Golf Tournament' },
        { name: 'Event Date', value: 'Monday, September 14, 2026' },
        { name: 'Venue', value: "Hunter's Green Country Club, Tampa FL" },
        ...(company ? [{ name: 'Company', value: company }] : []),
      ],
    });

    // 3. Create invoice items attached directly to this specific invoice
    for (const item of sponsorships) {
      await stripe.invoiceItems.create({
        customer: customer.id,
        invoice: invoice.id,
        amount: Math.round(item.price * 100),
        currency: 'usd',
        description: item.name,
      });
    }

    // 4. Finalize and send
    await stripe.invoices.finalizeInvoice(invoice.id);
    await stripe.invoices.sendInvoice(invoice.id);

    console.log(`Invoice ${invoice.id} sent to ${email} for ${firstName} ${lastName}`);

    // 5. Save sponsor to admin Blobs — status 'invoice', easy to mark paid later
    const totalAmount = sponsorships.reduce((s, v) => s + v.price, 0);
    const tierName    = sponsorships.length === 1 ? sponsorships[0].name : sponsorships.map(s => s.name).join(', ');
    // Detect primary tier from sponsorship names
    const tierMap = { 'Title Sponsor':'Title', 'Gold Sponsor':'Gold', 'Silver Sponsor':'Silver', 'Bronze Sponsor':'Bronze', 'Hole Sponsor':'Hole' };
    let tier = 'Alacarte';
    for (const [k, v] of Object.entries(tierMap)) {
      if (sponsorships.some(s => s.name.includes(k.replace(' Sponsor','')))) { tier = v; break; }
    }

    await saveSponsorRecord({
      id: 'rr_inv_' + Date.now() + '_' + Math.random().toString(36).slice(2,6),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      company:   company || '',
      tier,
      firstName,
      lastName,
      email,
      phone:     phone || '',
      website:   website || '',
      address:   address || '',
      logoData:  logoData || null,
      amount:    totalAmount,
      status:    'invoice',  // ← can be updated to 'paid' in admin when check arrives
      stripeInvoiceId: invoice.id,
      stripeCustomerId: customer.id,
      notes:     'Invoice sent ' + new Date().toLocaleDateString('en-US') + '. Awaiting payment.',
      packages:  tierName,
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        invoiceId: invoice.id,
        customerEmail: email,
      }),
    };

  } catch (err) {
    console.error('Stripe invoice error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Failed to create invoice',
        detail: err.message,
      }),
    };
  }
};

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

  const { firstName, lastName, email, company, phone, sponsorships = [] } = body;

  if (!email || !firstName || !lastName) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Name and email are required' }) };
  }

  if (!sponsorships.length) {
    return { statusCode: 400, body: JSON.stringify({ error: 'No sponsorship items provided' }) };
  }

  try {
    // 1. Create or retrieve a Stripe customer
    const existingCustomers = await stripe.customers.list({ email, limit: 1 });
    let customer;
    if (existingCustomers.data.length > 0) {
      customer = existingCustomers.data[0];
      // Update with latest info
      await stripe.customers.update(customer.id, {
        name: `${firstName} ${lastName}`,
        ...(company && { description: company }),
        ...(phone && { phone }),
        metadata: { source: 'rough-riders-golf-invoice', company: company || '' },
      });
    } else {
      customer = await stripe.customers.create({
        email,
        name: `${firstName} ${lastName}`,
        ...(company && { description: company }),
        ...(phone && { phone }),
        metadata: { source: 'rough-riders-golf-invoice', company: company || '' },
      });
    }

    // 2. Create the invoice FIRST, then attach items to it
    const dueDate = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60);

    const invoice = await stripe.invoices.create({
      customer: customer.id,
      collection_method: 'send_invoice',
      due_date: dueDate,
      description: 'Rough Riders 39th Annual Charity Golf Tournament — Sponsorship',
      footer: 'PAY WITH CREDIT CARD: Click the "Pay this invoice" button above to pay securely online.\n\nOR SEND A CHECK:\nMake check payable to: "1st U.S. Volunteer Cavalry Regiment Rough Riders Inc"\nMail to: 601 N. 19th St, Tampa FL 33605\nPlease include your invoice number on your check.\n\nQuestions? golf@tamparoughriders.org · (813) 248-1898\nThank you for supporting the Rough Riders!',
      metadata: {
        source: 'rough-riders-golf',
        company: company || '',
        contact: `${firstName} ${lastName}`,
      },
      custom_fields: [
        { name: 'Event', value: '39th Annual Charity Golf Tournament' },
        { name: 'Event Date', value: 'Monday, September 14, 2026' },
        { name: 'Venue', value: "Hunter's Green Country Club, Tampa FL" },
        ...(company ? [{ name: 'Company', value: company }] : []),
      ],
    });

    // 3. Create invoice items attached directly to this specific invoice
    for (const item of sponsorships) {
      await stripe.invoiceItems.create({
        customer: customer.id,
        invoice: invoice.id,          // ← attach to THIS invoice explicitly
        amount: Math.round(item.price * 100),
        currency: 'usd',
        description: item.name,
      });
    }

    // 4. Finalize and send
    await stripe.invoices.finalizeInvoice(invoice.id);
    await stripe.invoices.sendInvoice(invoice.id);

    console.log(`Invoice ${invoice.id} sent to ${email} for ${firstName} ${lastName}`);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        invoiceId: invoice.id,
        customerEmail: email,
      }),
    };

  } catch (err) {
    console.error('Stripe invoice error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Failed to create invoice',
        detail: err.message,
      }),
    };
  }
};
