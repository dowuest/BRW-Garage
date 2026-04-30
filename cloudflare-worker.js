// BRW Garage – API Proxy (Claude + Airtable)
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

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

    // ── Airtable route ────────────────────────────────────────────────────────
    if (url.pathname === '/airtable') {
      const { table, fields } = body;

      const ALLOWED_FIELDS = {
        Einlagerungsscheine: new Set([
          'einlagerungs_nr','datum_eroffnet','annehmer','auftrag_nr','annahme_datum',
          'termin_datum','kunde_name','kunde_adresse','kunde_ort','kunde_mobil',
          'fahrzeug_bezeichnung','kennschild','chassisnr','erst_inverkehrssetzung',
          'reifenmarke','reifendimension','profiltiefe_VL','profiltiefe_VR',
          'profiltiefe_HL','profiltiefe_HR','radart','pneuart','alter_lagerort',
          'bemerkungen','confidence'
        ]),
        Werkstatt_Auftraege: new Set([
          'auftrag_nr','annahme_datum','annahme_uhrzeit','termin_datum','annehmer',
          'mechaniker','kunde_name','kunde_adresse','kunde_ort','kunde_mobil',
          'fahrzeug','kennschild','chassisnr','km_alt','km_neu','arbeiten',
          'notizen','hervorgehoben','verbrauchsmaterial','zeitverrechnung',
          'zeit_verrechnung_h','confidence'
        ]),
        Servicelaufblaetter: new Set([
          'auftrag_nr','annahme_datum','mechaniker','fahrzeug','kennschild','km_neu',
          'arbeiten','reifenetikett','notizen','verbrauchsmaterial','zeitverrechnung',
          'zeit_verrechnung_h','confidence'
        ]),
        Lieferscheine: new Set([
          'lieferschein_nr','datum','lieferant','kundennummer','lieferart',
          'tourencode','positionen','notizen','anzahl_positionen','auftrag_nr','confidence'
        ])
      };

      const allowed = ALLOWED_FIELDS[table];
      const cleanFields = allowed
        ? Object.fromEntries(Object.entries(fields).filter(([k]) => allowed.has(k)))
        : fields;

      const airtableRes = await fetch(
        `https://api.airtable.com/v0/appo9ljZERNttZXEA/${encodeURIComponent(table)}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.AIRTABLE_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ fields: cleanFields })
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

    // ── Claude route ──────────────────────────────────────────────────────────
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
