// netlify/functions/create-invoice.js
// Creates a Stripe Customer + Invoice with all sponsorship line items.
// Stripe emails the invoice directly to the sponsor with a Pay Now link.
// Also saves the sponsor to Supabase with status 'invoice' for check tracking.

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Supabase-backed store (migrated from Netlify Blobs).
// 'registrations' and 'sponsors' live in their own tables (golf_registrations,
// golf_sponsors, one row per record). Everything else (settings, sponsor-config,
// event-content, reserved-teams, logo_*) lives in the golf_config KV table.
// Interface is identical to the old blob store: get(key) -> JSON string | null,
// set(key, value) -> void (throws on failure).
function getStore() {
  const base = process.env.SUPABASE_URL + '/rest/v1';
  const key  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const headers = { 'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' };
  const TABLES = { registrations: 'golf_registrations', sponsors: 'golf_sponsors' };

  return {
    async get(k) {
      if (TABLES[k]) {
        const r = await fetch(`${base}/${TABLES[k]}?select=data&order=created_at.asc,id.asc`, { headers });
        if (!r.ok) { console.error('Supabase get failed:', k, r.status, await r.text()); return null; }
        const rows = await r.json();
        return JSON.stringify(rows.map(x => x.data));
      }
      const r = await fetch(`${base}/golf_config?key=eq.${encodeURIComponent(k)}&select=value`, { headers });
      if (!r.ok) { console.error('Supabase config get failed:', k, r.status); return null; }
      const rows = await r.json();
      return rows.length ? JSON.stringify(rows[0].value) : null;
    },
    async set(k, value) {
      const parsed = typeof value === 'string' ? JSON.parse(value) : value;
      if (TABLES[k]) {
        const r = await fetch(`${base}/rpc/golf_replace_all`, {
          method: 'POST', headers,
          body: JSON.stringify({ p_table: TABLES[k], p_records: parsed }),
        });
        if (!r.ok) throw new Error(`Supabase replace ${k} failed: ${r.status} ${await r.text()}`);
        return;
      }
      const r = await fetch(`${base}/golf_config?on_conflict=key`, {
        method: 'POST',
        headers: { ...headers, 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify({ key: k, value: parsed, updated_at: new Date().toISOString() }),
      });
      if (!r.ok) throw new Error(`Supabase config set ${k} failed: ${r.status} ${await r.text()}`);
    },
  };
}

async function saveSponsorRecord(sponsorData) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log('WARN: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — sponsor not saved');
    return;
  }
  const store = getStore();

  // Strip logoData from the main record to keep it small — save logo separately
  const logoData = sponsorData.logoData;
  const recordWithoutLogo = Object.assign({}, sponsorData, { logoData: logoData ? '[stored]' : null });

  // Save logo separately if provided (golf_config key: logo_<sponsorId>)
  if (logoData && logoData.length > 10) {
    try {
      await store.set('logo_' + sponsorData.id, JSON.stringify({ logoData }));
      recordWithoutLogo.logoData = logoData; // restore after separate save succeeds
      console.log('Logo saved separately for', sponsorData.id);
    } catch (e) {
      console.log('Logo save failed (non-fatal):', e.message);
      recordWithoutLogo.logoData = logoData ? '[stored]' : null;
    }
  }

  // Get existing sponsors, append, save
  try {
    const raw = await store.get('sponsors');
    let sponsors = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(sponsors)) sponsors = [];
    sponsors.push(recordWithoutLogo);
    console.log('Saving sponsors, count:', sponsors.length);
    await store.set('sponsors', JSON.stringify(sponsors));
    console.log('Sponsor saved successfully:', sponsorData.company || sponsorData.email);
  } catch (e) {
    console.error('Sponsor save failed:', e.message);
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
      footer: 'PAY WITH CREDIT CARD: Click the "Pay this invoice" button above to pay securely online.\n\nOR SEND A CHECK:\nMake check payable to:\n"1st U.S. Volunteer Cavalry Regiment Rough Riders Inc"\nMail check to Admin Office at:\n601 N. 19th St, Tampa FL 33605\nPlease write your invoice number on the check.\n\nQuestions? golf@tamparoughriders.org · (813) 248-1898\nThank you for supporting the Rough Riders!',
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
