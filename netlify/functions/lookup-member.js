// netlify/functions/lookup-member.js
// Looks up a member by member_number from Supabase rr_members table
// Returns: first_name, last_name, email, phone

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const memberNumber = event.queryStringParameters?.member_number?.trim();

  if (!memberNumber) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'member_number is required' })
    };
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Server configuration error' })
    };
  }

  try {
    const url = `${SUPABASE_URL}/rest/v1/rr_members?member_number=eq.${encodeURIComponent(memberNumber)}&select=first_name,last_name,email,phone&limit=1`;

    const res = await fetch(url, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Accept': 'application/json'
      }
    });

    if (!res.ok) {
      throw new Error(`Supabase error: ${res.status}`);
    }

    const rows = await res.json();

    if (!rows || rows.length === 0) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Member not found' })
      };
    }

    const member = rows[0];
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        first_name: member.first_name || '',
        last_name:  member.last_name  || '',
        email:      member.email      || '',
        phone:      member.phone      || ''
      })
    };

  } catch (err) {
    console.error('lookup-member error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Lookup failed' })
    };
  }
};
