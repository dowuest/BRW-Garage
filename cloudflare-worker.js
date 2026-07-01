// BRW Garage – API Proxy (Claude + Supabase)
// Secrets im Cloudflare Dashboard setzen:
//   ANTHROPIC_API_KEY  → Claude API Key
//   SUPABASE_URL       → https://jvxlpjxbmrhgtpprbyid.supabase.co
//   SUPABASE_KEY       → service_role Key (nicht der publishable Key)
//   PAD_URL            → Power Automate Desktop Listener URL (später)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    const json = (data, status = 200) => new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json', ...CORS },
    });
    const err = (msg, status = 400) => json({ error: msg }, status);

    async function supabase(method, path, body = null) {
      const res = await fetch(`${env.SUPABASE_URL}/rest/v1${path}`, {
        method,
        headers: {
          'apikey': env.SUPABASE_KEY,
          'Authorization': `Bearer ${env.SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': method === 'POST' ? 'return=representation' : '',
        },
        body: body ? JSON.stringify(body) : null,
      });
      const text = await res.text();
      try { return { ok: res.ok, status: res.status, data: JSON.parse(text) }; }
      catch { return { ok: res.ok, status: res.status, data: text }; }
    }

    // ── /aggregate?auftrag_nr=12345 (GET) ────────────────────────────────────
    if (url.pathname === '/aggregate' && request.method === 'GET') {
      const auftrag_nr = url.searchParams.get('auftrag_nr');
      if (!auftrag_nr) return err('auftrag_nr fehlt');
      const result = await supabase('GET',
        `/auftrag_komplett?auftrag_nr=eq.${encodeURIComponent(auftrag_nr)}&limit=1`
      );
      if (!result.ok) return json(result.data, result.status);
      if (!result.data?.length) return err(`Kein Auftrag gefunden: ${auftrag_nr}`, 404);
      return json(result.data[0]);
    }

    // ── /aggregate-all (GET) — alle Aufträge fürs Dashboard ──────────────────
    if (url.pathname === '/aggregate-all' && request.method === 'GET') {
      const result = await supabase('GET',
        `/auftrag_komplett?order=auftrag_nr.desc&limit=200`
      );
      if (!result.ok) return json(result.data, result.status);
      return json(result.data || []);
    }

    // ── /send-to-pad (POST) ───────────────────────────────────────────────────
    if (url.pathname === '/send-to-pad' && request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch { return err('Invalid JSON'); }
      const { auftrag_nr } = body;
      if (!auftrag_nr) return err('auftrag_nr fehlt');

      const result = await supabase('GET',
        `/auftrag_komplett?auftrag_nr=eq.${encodeURIComponent(auftrag_nr)}&limit=1`
      );
      if (!result.ok || !result.data?.length) {
        return err(`Kein Auftrag gefunden: ${auftrag_nr}`, 404);
      }
      const payload = result.data[0];

      if (!env.PAD_URL) {
        return err('PAD_URL nicht konfiguriert – bitte in Cloudflare Secrets setzen', 503);
      }

      const padRes = await fetch(env.PAD_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!padRes.ok) {
        const t = await padRes.text();
        return err(`Power Automate Fehler ${padRes.status}: ${t}`, 502);
      }

      await supabase('PATCH',
        `/werkstatt_auftraege?auftrag_nr=eq.${encodeURIComponent(auftrag_nr)}`,
        { nextlane_gesendet: true, nextlane_gesendet_am: new Date().toISOString() }
      );
      return json({ ok: true, auftrag_nr, message: 'An Power Automate Desktop gesendet' });
    }

    // ── /delete (POST) — löscht Auftrag aus allen Tabellen ───────────────────
    if (url.pathname === '/delete' && request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch { return err('Invalid JSON'); }
      const { auftrag_nr } = body;
      if (!auftrag_nr) return err('auftrag_nr fehlt');

      const enc = encodeURIComponent(auftrag_nr);

      // Reihenfolge: erst abhängige Tabellen, dann werkstatt_auftraege
      const sl = await supabase('DELETE', `/servicelaufblaetter?auftrag_nr=eq.${enc}`);
      const es = await supabase('DELETE', `/einlagerungsscheine?auftrag_nr=eq.${enc}`);
      const wa = await supabase('DELETE', `/werkstatt_auftraege?auftrag_nr=eq.${enc}`);

      if (!wa.ok) return err(`Fehler beim Löschen: ${JSON.stringify(wa.data)}`, 500);
      return json({ ok: true, auftrag_nr, deleted: { servicelaufblaetter: sl.ok, einlagerungsscheine: es.ok, werkstatt_auftraege: wa.ok } });
    }

    // ── /supabase (POST) — PWA speichert Dokumente ────────────────────────────
    if (url.pathname === '/supabase' && request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch { return err('Invalid JSON'); }
      const { table, fields } = body;
      if (!table || !fields) return err('table und fields erforderlich');

      const cleanFields = Object.fromEntries(
        Object.entries(fields).filter(([, v]) => v !== '' && v !== null && v !== undefined)
      );

      // Einlagerungsschein: profiltiefe uppercase → lowercase + integer
      if (table === 'einlagerungsscheine') {
        const remap = {
          profiltiefe_VL: 'profiltiefe_vl',
          profiltiefe_VR: 'profiltiefe_vr',
          profiltiefe_HL: 'profiltiefe_hl',
          profiltiefe_HR: 'profiltiefe_hr',
        };
        for (const [from, to] of Object.entries(remap)) {
          if (cleanFields[from] !== undefined) {
            cleanFields[to] = parseInt(cleanFields[from]) || null;
            delete cleanFields[from];
          }
        }
      }

      // Werkstatt-Aufträge: upsert (update wenn auftrag_nr bereits existiert)
      if (table === 'werkstatt_auftraege' && cleanFields.auftrag_nr) {
        const upsertRes = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, {
          method: 'POST',
          headers: {
            'apikey': env.SUPABASE_KEY,
            'Authorization': `Bearer ${env.SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates,return=representation',
          },
          body: JSON.stringify(cleanFields),
        });
        const upsertText = await upsertRes.text();
        try { return json(JSON.parse(upsertText), upsertRes.status); }
        catch { return json(upsertText, upsertRes.status); }
      }

      const result = await supabase('POST', `/${table}`, cleanFields);
      return json(result.data, result.status);
    }

    // ── / (POST) — Claude API ─────────────────────────────────────────────────
    if (request.method !== 'POST') return err('Method not allowed', 405);

    let body;
    try { body = await request.json(); } catch { return err('Invalid JSON'); }

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const data = await claudeRes.text();
    return new Response(data, {
      status: claudeRes.status,
      headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }
};
