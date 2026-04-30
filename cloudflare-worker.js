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

      // Hard-map Einlagerungsschein fields regardless of what Claude returns
      function flattenAndMap(fields, table) {
        if (table !== 'Einlagerungsscheine') return fields;

        const f = fields;
        const out = {};

        // Direct fields
        const direct = ['einlagerungs_nr','annehmer','radart','pneuart','alter_lagerort','bemerkungen','confidence','auftrag_nr'];
        direct.forEach(k => { if (f[k] !== undefined) out[k] = f[k]; });

        // Date fields (various Claude naming)
        out.datum_eroffnet = f.datum_eroffnet || f.datum || f.eroeffnet_am || '';
        out.annahme_datum  = f.annahme_datum  || f.annahme || '';
        out.termin_datum   = f.termin_datum   || f.termin  || '';
        out.auftrag_nr     = f.auftrag_nr     || f.auftrag || '';

        // Kunde (nested or flat)
        const k = f.kunde || {};
        out.kunde_name    = f.kunde_name    || k.name    || '';
        out.kunde_adresse = f.kunde_adresse || k.strasse || k.adresse || '';
        out.kunde_ort     = f.kunde_ort     || k.plz_ort || k.ort     || '';
        out.kunde_mobil   = f.kunde_mobil   || k.mobil   || '';

        // Fahrzeug (nested or flat)
        const fz = f.fahrzeug || {};
        out.fahrzeug_bezeichnung   = f.fahrzeug_bezeichnung   || fz.marke_modell  || fz.bezeichnung || '';
        out.kennschild             = f.kennschild             || fz.kennzeichen   || fz.kennschild  || '';
        out.chassisnr              = f.chassisnr              || fz.chassisnr     || '';
        out.erst_inverkehrssetzung = f.erst_inverkehrssetzung || fz['1_inverk_s'] || fz.erste_inverkehrsetzung || '';

        // Reifen (nested or flat)
        const pn = f.pneumarke_dimension || {};
        const vorne = f.reifendimension || pn.vorne || '';
        // Split "Yokohama 205/50R17 93V" into marke + dimension
        const reifenParts = vorne.match(/^([A-Za-z]+)\s+(.+)$/);
        out.reifenmarke     = f.reifenmarke     || (reifenParts ? reifenParts[1] : vorne);
        out.reifendimension = f.reifendimension || (reifenParts ? reifenParts[2] : '');

        // Profiltiefe (nested or flat, uppercase or lowercase)
        const pt = f.profiltiefe_mm || {};
        out.profiltiefe_VL = parseFloat(f.profiltiefe_VL || pt.VL || pt.vl || 0) || 0;
        out.profiltiefe_VR = parseFloat(f.profiltiefe_VR || pt.VR || pt.vr || 0) || 0;
        out.profiltiefe_HL = parseFloat(f.profiltiefe_HL || pt.HL || pt.hl || 0) || 0;
        out.profiltiefe_HR = parseFloat(f.profiltiefe_HR || pt.HR || pt.hr || 0) || 0;

        return out;
      }

      const mappedFields = flattenAndMap(fields, table);

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
        ? Object.fromEntries(Object.entries(mappedFields).filter(([k]) => allowed.has(k)))
        : mappedFields;

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
