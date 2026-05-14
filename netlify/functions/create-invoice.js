// netlify/functions/create-invoice.js
// Creates a Stripe Customer + Invoice with all sponsorship line items.
// Stripe emails the invoice directly to the sponsor with a Pay Now link.

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

    // 2. Create invoice items for each sponsorship
    for (const item of sponsorships) {
      await stripe.invoiceItems.create({
        customer: customer.id,
        amount: Math.round(item.price * 100), // cents
        currency: 'usd',
        description: item.name,
      });
    }

    // 3. Create the invoice with auto-send and net 30 due date
    const dueDate = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60); // 30 days from now

    const invoice = await stripe.invoices.create({
      customer: customer.id,
      collection_method: 'send_invoice',
      due_date: dueDate,
      description: 'Rough Riders 39th Annual Charity Golf Tournament — Sponsorship',
      footer: 'Thank you for supporting the Rough Riders! Questions? Contact r.conn@tamparoughriders.org',
      metadata: {
        source: 'rough-riders-golf',
        company: company || '',
        contact: `${firstName} ${lastName}`,
      },
      // Custom fields shown on the invoice PDF
      custom_fields: [
        { name: 'Event', value: '39th Annual Charity Golf Tournament' },
        { name: 'Event Date', value: 'Monday, September 14, 2026' },
        { name: 'Venue', value: "Hunter's Green Country Club, Tampa FL" },
        ...(company ? [{ name: 'Company', value: company }] : []),
      ],
    });

    // 4. Finalize and send the invoice (triggers Stripe email to customer)
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
