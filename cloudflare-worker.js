// BRW Garage – Anthropic API Proxy
// Deploy this as a Cloudflare Worker.
// Set environment variables:
//   ANTHROPIC_API_KEY = sk-ant-...
//   AIRTABLE_TOKEN    = pat...

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        }
      });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response('Invalid JSON', { status: 400 });
    }

    // Route: /airtable → Airtable proxy
    if (url.pathname === '/airtable') {
      const { table, fields } = body;
      if (!table || !fields) {
        return new Response(JSON.stringify({ error: 'table and fields required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
      const airtableRes = await fetch(
        `https://api.airtable.com/v0/appo9ljZERNttZXEA/${encodeURIComponent(table)}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.AIRTABLE_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ fields })
        }
      );
      const data = await airtableRes.text();
      return new Response(data, {
        status: airtableRes.status,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // Route: / → Claude proxy (unchanged)
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const data = await anthropicRes.text();
    return new Response(data, {
      status: anthropicRes.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
};
