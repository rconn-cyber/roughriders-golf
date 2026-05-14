// netlify/functions/admin-seed.js
// Seeds test data using Netlify Blobs REST API directly (no SDK needed)
// Call once: GET https://rr-golf.netlify.app/.netlify/functions/admin-seed?key=roughriders2026

exports.handler = async (event) => {
  const key = (event.queryStringParameters || {}).key;
  if (key !== 'roughriders2026') return { statusCode: 401, body: 'Unauthorized' };

  const siteID = process.env.NETLIFY_SITE_ID;
  const token  = process.env.NETLIFY_TOKEN || process.env.NETLIFY_ACCESS_TOKEN;

  if (!siteID || !token) {
    return { statusCode: 500, body: JSON.stringify({
      error: 'Missing NETLIFY_SITE_ID or NETLIFY_TOKEN env vars',
      hint: 'Add NETLIFY_SITE_ID (from Site config > General) and NETLIFY_TOKEN (from User settings > Applications > Personal access tokens)'
    })};
  }

  async function blobSet(key, value) {
    const url = `https://api.netlify.com/api/v1/blobs/${siteID}/golf-admin/${key}`;
    const r = await fetch(url, {
      method: 'PUT',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: typeof value === 'string' ? value : JSON.stringify(value),
    });
    if (!r.ok) throw new Error(`Blob set failed for ${key}: ${r.status} ${await r.text()}`);
    return r;
  }

  const d = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString();

  const entries = [
    { id:'rr_001', createdAt:d(12), updatedAt:d(12), teamName:'Tampa Bay Bulldogs', firstName:'Mike', lastName:'Hernandez', email:'mhernandez@tampabay.com', phone:'(813) 555-0101', company:'Hernandez Contracting', amount:405, status:'paid', addons:'Super Ticket', stripeSession:'cs_live_test001', players:[{firstName:'Mike',lastName:'Hernandez',email:'mhernandez@tampabay.com'},{firstName:'Carlos',lastName:'Mendez',email:''},{firstName:'Dave',lastName:'Kowalski',email:''},{firstName:'James',lastName:'Turner',email:''}], notes:'Returning team from 2025.' },
    { id:'rr_002', createdAt:d(9),  updatedAt:d(9),  teamName:'Ybor City Cigars',   firstName:'Sandra', lastName:'Reyes', email:'sreyes@yborcigars.com', phone:'(813) 555-0202', company:'Ybor City Tobacco Co.', amount:330, status:'paid', addons:'Mulligan Pack', stripeSession:'cs_live_test002', players:[{firstName:'Sandra',lastName:'Reyes',email:'sreyes@yborcigars.com'},{firstName:'Roberto',lastName:'Fuentes',email:''}], notes:'' },
    { id:'rr_003', createdAt:d(7),  updatedAt:d(7),  teamName:'Bayshore Breeze',    firstName:'Tom', lastName:'Whitfield', email:'twhitfield@gmail.com', phone:'(727) 555-0303', company:'', amount:660, status:'invoice', addons:'Super Ticket, Raffle Tickets', stripeSession:'', players:[{firstName:'Tom',lastName:'Whitfield',email:'twhitfield@gmail.com'},{firstName:'Greg',lastName:'Simmons',email:''},{firstName:'Patrick',lastName:"O'Brien",email:''},{firstName:'Luis',lastName:'Castillo',email:''}], notes:'Invoice sent, awaiting payment.' },
    { id:'rr_004', createdAt:d(5),  updatedAt:d(5),  teamName:'MacDill Eagles',     firstName:'James', lastName:'Patterson', email:'jpatterson@macdill.mil', phone:'(813) 555-0404', company:'MacDill Air Force Base', amount:165, status:'paid', addons:'', stripeSession:'cs_live_test004', players:[{firstName:'James',lastName:'Patterson',email:'jpatterson@macdill.mil'}], notes:'Single player, will confirm team later.' },
    { id:'rr_005', createdAt:d(2),  updatedAt:d(2),  teamName:'Gold Sponsor Team A', firstName:'Robin', lastName:'Conn', email:'golf@tamparoughriders.org', phone:'(813) 248-1898', company:'1st U.S. Volunteer Cavalry Regiment', amount:0, status:'comp', addons:'Super Ticket', stripeSession:'', players:[{firstName:'Robin',lastName:'Conn',email:'golf@tamparoughriders.org'},{firstName:'TBD',lastName:'',email:''},{firstName:'TBD',lastName:'',email:''},{firstName:'TBD',lastName:'',email:''}], notes:'Comp team from Gold sponsorship.' },
  ];

  const sponsors = [
    { id:'rr_sp001', createdAt:d(20), updatedAt:d(20), company:'Tampa Bay Federal Credit Union', tier:'Gold',     firstName:'David',  lastName:'Nguyen',  email:'dnguyen@tbfcu.com',              phone:'(813) 555-1001', amount:5000, status:'paid',    hole:'',      compSlots:2, notes:'Logo files received.' },
    { id:'rr_sp002', createdAt:d(18), updatedAt:d(18), company:'Sunshine State Roofing',         tier:'Silver',   firstName:'Bill',   lastName:'Carter',  email:'bcarter@sunshineroofing.com',     phone:'(813) 555-1002', amount:2500, status:'paid',    hole:'',      compSlots:1, notes:'' },
    { id:'rr_sp003', createdAt:d(14), updatedAt:d(14), company:'Ybor City Tobacco Co.',          tier:'Bronze',   firstName:'Sandra', lastName:'Reyes',   email:'sreyes@yborcigars.com',           phone:'(813) 555-0202', amount:1000, status:'invoice', hole:'',      compSlots:1, notes:'Invoice sent 5/1. Follow up if not paid by 5/15.' },
    { id:'rr_sp004', createdAt:d(10), updatedAt:d(10), company:'Bay Area Auto Group',            tier:'Hole',     firstName:'Rick',   lastName:'Martinez',email:'rmartinez@bayareauto.com',        phone:'(813) 555-1004', amount:500,  status:'paid',    hole:'7, 14', compSlots:0, notes:'Holes 7 and 14.' },
    { id:'rr_sp005', createdAt:d(6),  updatedAt:d(6),  company:'Gulf Coast Insurance',           tier:'Alacarte', firstName:'Janet',  lastName:'Brooks',  email:'jbrooks@gulfcoastins.com',        phone:'(727) 555-1005', amount:750,  status:'paid',    hole:'',      compSlots:0, notes:'Beverage cart sponsor.' },
  ];

  const comp = [
    { id:'rr_co001', createdAt:d(5), updatedAt:d(5), sponsorId:'rr_sp001', teamName:'TBFCU Team A',       players:[{firstName:'David',lastName:'Nguyen',email:'dnguyen@tbfcu.com'},{firstName:'Lisa',lastName:'Chen',email:''},{firstName:'Marcus',lastName:'Webb',email:''},{firstName:'TBD',lastName:'',email:''}], notes:'Primary sponsor team.' },
    { id:'rr_co002', createdAt:d(3), updatedAt:d(3), sponsorId:'rr_sp002', teamName:'Sunshine State Team', players:[{firstName:'Bill',lastName:'Carter',email:'bcarter@sunshineroofing.com'},{firstName:'TBD',lastName:'',email:''}], notes:'Names TBD.' },
  ];

  const settings = {
    adminEmails: [
      { name:'Robin Conn',   email:'golf@tamparoughriders.org',   role:'admin' },
      { name:'Admin Office', email:'r.conn@tamparoughriders.org', role:'notify' },
    ],
    notifyOnEntry: true, notifyOnSponsor: true,
    eventName: '39th Annual Charity Golf Tournament',
    eventDate: 'Monday, September 14, 2026',
    eventVenue: "Hunter's Green Country Club, Tampa FL",
  };

  try {
    await blobSet('entries',  JSON.stringify(entries));
    await blobSet('sponsors', JSON.stringify(sponsors));
    await blobSet('comp',     JSON.stringify(comp));
    await blobSet('settings', JSON.stringify(settings));
    return { statusCode:200, headers:{'Content-Type':'application/json'}, body: JSON.stringify({ success:true, message:'Seeded! entries:'+entries.length+' sponsors:'+sponsors.length+' comp:'+comp.length }) };
  } catch(err) {
    return { statusCode:500, body: JSON.stringify({ error: err.message }) };
  }
};


exports.handler = async (event) => {
  // Simple key check so random people can't seed
  const key = (event.queryStringParameters || {}).key;
  if (key !== 'roughriders2026') {
    return { statusCode: 401, body: 'Unauthorized' };
  }

  const store = getStore({
    name: 'golf-admin',
    siteID: process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_TOKEN || process.env.NETLIFY_ACCESS_TOKEN,
  });

  const now = new Date().toISOString();
  const d = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString();

  const entries = [
    {
      id: 'rr_001', createdAt: d(12), updatedAt: d(12),
      teamName: 'Tampa Bay Bulldogs',
      firstName: 'Mike', lastName: 'Hernandez',
      email: 'mhernandez@tampabay.com', phone: '(813) 555-0101',
      company: 'Hernandez Contracting',
      amount: 405, status: 'paid', addons: 'Super Ticket',
      stripeSession: 'cs_live_test001',
      players: [
        { firstName: 'Mike',    lastName: 'Hernandez', email: 'mhernandez@tampabay.com' },
        { firstName: 'Carlos',  lastName: 'Mendez',    email: 'cmendez@gmail.com' },
        { firstName: 'Dave',    lastName: 'Kowalski',  email: '' },
        { firstName: 'James',   lastName: 'Turner',    email: '' },
      ],
      notes: 'Returning team from 2025.',
    },
    {
      id: 'rr_002', createdAt: d(9), updatedAt: d(9),
      teamName: 'Ybor City Cigars',
      firstName: 'Sandra', lastName: 'Reyes',
      email: 'sreyes@yborcigars.com', phone: '(813) 555-0202',
      company: 'Ybor City Tobacco Co.',
      amount: 330, status: 'paid', addons: 'Mulligan Pack',
      stripeSession: 'cs_live_test002',
      players: [
        { firstName: 'Sandra',  lastName: 'Reyes',   email: 'sreyes@yborcigars.com' },
        { firstName: 'Roberto', lastName: 'Fuentes', email: '' },
      ],
      notes: '',
    },
    {
      id: 'rr_003', createdAt: d(7), updatedAt: d(7),
      teamName: 'Bayshore Breeze',
      firstName: 'Tom', lastName: 'Whitfield',
      email: 'twhitfield@gmail.com', phone: '(727) 555-0303',
      company: '',
      amount: 660, status: 'invoice', addons: 'Super Ticket, Raffle Tickets',
      stripeSession: '',
      players: [
        { firstName: 'Tom',     lastName: 'Whitfield', email: 'twhitfield@gmail.com' },
        { firstName: 'Greg',    lastName: 'Simmons',   email: '' },
        { firstName: 'Patrick', lastName: 'O\'Brien',  email: '' },
        { firstName: 'Luis',    lastName: 'Castillo',  email: '' },
      ],
      notes: 'Invoice sent, awaiting payment.',
    },
    {
      id: 'rr_004', createdAt: d(5), updatedAt: d(5),
      teamName: 'MacDill Eagles',
      firstName: 'Col. James', lastName: 'Patterson',
      email: 'jpatterson@macdill.af.mil', phone: '(813) 555-0404',
      company: 'MacDill Air Force Base',
      amount: 165, status: 'paid', addons: '',
      stripeSession: 'cs_live_test004',
      players: [
        { firstName: 'Col. James', lastName: 'Patterson', email: 'jpatterson@macdill.af.mil' },
      ],
      notes: 'Single player, will confirm team later.',
    },
    {
      id: 'rr_005', createdAt: d(2), updatedAt: d(2),
      teamName: 'Gold Sponsor Team A',
      firstName: 'Robin', lastName: 'Conn',
      email: 'golf@tamparoughriders.org', phone: '(813) 248-1898',
      company: '1st U.S. Volunteer Cavalry Regiment',
      amount: 0, status: 'comp', addons: 'Super Ticket',
      stripeSession: '',
      players: [
        { firstName: 'Robin',   lastName: 'Conn',     email: 'golf@tamparoughriders.org' },
        { firstName: 'TBD',     lastName: '',         email: '' },
        { firstName: 'TBD',     lastName: '',         email: '' },
        { firstName: 'TBD',     lastName: '',         email: '' },
      ],
      notes: 'Comp team from Gold sponsorship.',
    },
  ];

  const sponsors = [
    {
      id: 'rr_sp001', createdAt: d(20), updatedAt: d(20),
      company: 'Tampa Bay Federal Credit Union',
      tier: 'Gold', firstName: 'David', lastName: 'Nguyen',
      email: 'dnguyen@tbfcu.com', phone: '(813) 555-1001',
      amount: 5000, status: 'paid', hole: '', compSlots: 2,
      notes: 'Logo files received. Banner printing in progress.',
    },
    {
      id: 'rr_sp002', createdAt: d(18), updatedAt: d(18),
      company: 'Sunshine State Roofing',
      tier: 'Silver', firstName: 'Bill', lastName: 'Carter',
      email: 'bcarter@sunshineroofing.com', phone: '(813) 555-1002',
      amount: 2500, status: 'paid', hole: '', compSlots: 1,
      notes: '',
    },
    {
      id: 'rr_sp003', createdAt: d(14), updatedAt: d(14),
      company: 'Ybor City Tobacco Co.',
      tier: 'Bronze', firstName: 'Sandra', lastName: 'Reyes',
      email: 'sreyes@yborcigars.com', phone: '(813) 555-0202',
      amount: 1000, status: 'invoice', hole: '', compSlots: 1,
      notes: 'Invoice sent 5/1. Follow up if not paid by 5/15.',
    },
    {
      id: 'rr_sp004', createdAt: d(10), updatedAt: d(10),
      company: 'Bay Area Auto Group',
      tier: 'Hole', firstName: 'Rick', lastName: 'Martinez',
      email: 'rmartinez@bayareauto.com', phone: '(813) 555-1004',
      amount: 500, status: 'paid', hole: '7, 14', compSlots: 0,
      notes: 'Sponsoring holes 7 and 14.',
    },
    {
      id: 'rr_sp005', createdAt: d(6), updatedAt: d(6),
      company: 'Gulf Coast Insurance',
      tier: 'Alacarte', firstName: 'Janet', lastName: 'Brooks',
      email: 'jbrooks@gulfcoastins.com', phone: '(727) 555-1005',
      amount: 750, status: 'paid', hole: '', compSlots: 0,
      notes: 'Beverage cart sponsor.',
    },
  ];

  const comp = [
    {
      id: 'rr_co001', createdAt: d(5), updatedAt: d(5),
      sponsorId: 'rr_sp001',
      teamName: 'TBFCU Team A',
      players: [
        { firstName: 'David',   lastName: 'Nguyen',   email: 'dnguyen@tbfcu.com' },
        { firstName: 'Lisa',    lastName: 'Chen',      email: '' },
        { firstName: 'Marcus',  lastName: 'Webb',      email: '' },
        { firstName: 'TBD',     lastName: '',          email: '' },
      ],
      notes: 'Primary sponsor team.',
    },
    {
      id: 'rr_co002', createdAt: d(3), updatedAt: d(3),
      sponsorId: 'rr_sp002',
      teamName: 'Sunshine State Team',
      players: [
        { firstName: 'Bill',    lastName: 'Carter',   email: 'bcarter@sunshineroofing.com' },
        { firstName: 'TBD',     lastName: '',          email: '' },
      ],
      notes: 'Names TBD — Bill to confirm.',
    },
  ];

  const settings = {
    adminEmails: [
      { name: 'Robin Conn', email: 'golf@tamparoughriders.org', role: 'admin' },
      { name: 'Admin Office', email: 'r.conn@tamparoughriders.org', role: 'notify' },
    ],
    notifyOnEntry: true,
    notifyOnSponsor: true,
    eventName: '39th Annual Charity Golf Tournament',
    eventDate: 'Monday, September 14, 2026',
    eventVenue: "Hunter's Green Country Club, Tampa FL",
  };

  await store.set('entries',  JSON.stringify(entries));
  await store.set('sponsors', JSON.stringify(sponsors));
  await store.set('comp',     JSON.stringify(comp));
  await store.set('settings', JSON.stringify(settings));

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      success: true,
      message: 'Test data seeded successfully!',
      counts: { entries: entries.length, sponsors: sponsors.length, comp: comp.length },
    }),
  };
};
