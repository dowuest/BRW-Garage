# BRW Garage Laufblatt-Automation — Technischer Stand

## Projektübersicht
Automatisierung der Laufblatt-Erfassung für BRW Garage Langnau. Fotos von Werkstatt-Dokumenten werden per App fotografiert, von Claude Vision ausgelesen und strukturiert in Airtable gespeichert.

---

## Architektur

```
Foto (PWA/Postman) 
→ Make.com Webhook 
→ Claude Vision (Routing) 
→ JSON Parse 
→ Router (4 Äste)
  → Einlagerungsschein → Claude Extraktion → JSON Parse → Airtable
  → Werkstatt-Auftrag  → Claude Extraktion → JSON Parse → Airtable
  → Servicelaufblatt   → Claude Extraktion → JSON Parse → Airtable (TODO)
  → Fehler/Unbekannt   → (TODO: Logging)
```

---

## Make.com Szenario

**Szenario-ID:** 5355119  
**Name:** BRW-Test-Workflow  
**URL:** eu1.make.com/1509637/scenarios/5355119/edit

### Webhook
- **Name:** laufblatt-eingang
- **URL:** https://hook.eu1.make.com/miq6ugjn8lprsxxxsfrhwavtjzieoocs
- **Typ:** Custom webhook
- **Payload:**
```json
{
  "image_base64": "<base64 ohne data:image Prefix>",
  "filename": "laufblatt_<timestamp>.jpg",
  "timestamp": "<ISO timestamp>"
}
```

### Credentials
| Name | Typ | Verwendung |
|------|-----|------------|
| Claue-BRW_Test | API Key (x-api-key, Header) | Claude API |
| Airtable-BRW-Test | API Key (Authorization: Bearer, Header) | Airtable API |

---

## Modulübersicht

| Nr | Typ | Funktion |
|----|-----|----------|
| 1 | Webhooks | Custom webhook — Eingang |
| 3 | HTTP | Claude Routing-Call (erkennt Dokumenttyp) |
| 4 | JSON | Parse Routing-Antwort → `typ` Feld |
| 5 | Router | Verzweigt auf 4 Äste |
| 6 | HTTP | Claude Einlagerungsschein-Extraktion |
| 7 | HTTP | Claude Werkstatt-Auftrag-Extraktion |
| 11 | HTTP | Airtable Einlagerungsscheine (POST) |
| 12 | JSON | Parse Einlagerungsschein-Antwort |
| 13 | HTTP | Airtable Werkstatt_Auftraege (POST) |
| 14 | JSON | Parse Werkstatt-Auftrag-Antwort |

**TODO:** Servicelaufblatt Ast (HTTP + JSON + Airtable), Fehler/Unbekannt Logging

---

## Claude API

**Modell:** claude-opus-4-5  
**API URL:** https://api.anthropic.com/v1/messages  
**Header:** x-api-key + anthropic-version: 2023-06-01

### Routing-Prompt (Modul 3, max_tokens: 50)
Erkennt Dokumenttyp und gibt eines zurück:
- `{"typ": "einlagerungsschein"}`
- `{"typ": "werkstatt_auftrag"}`
- `{"typ": "servicelaufblatt"}`
- `{"typ": "unbekannt"}`

**Erkennungsmerkmale:**
- einlagerungsschein: Grauer Balken mit Einlagerungs-Nr., Profiltiefe VL/VR/HL/HR
- werkstatt_auftrag: "Werkstatt - Auftrag" als Titel, Km neu handschriftlich, Barcode
- servicelaufblatt: Zwei Checklisten-Tabellen mit Codes PR1/WS1/PW1

### Einlagerungsschein-Prompt (Modul 6, max_tokens: 2000)
Extrahiert: einlagerungs_nr, datum_eroffnet, annehmer, auftrag_nr, annahme_datum, termin_datum, kunde_name, kunde_adresse, kunde_ort, kunde_mobil, fahrzeug_bezeichnung, kennschild, chassisnr, erst_inverkehrssetzung, reifenmarke, reifendimension, profiltiefe_VL/VR/HL/HR, radart, pneuart, radschrauben_vorhanden, radabdeckungen_vorhanden, neuwertig, beschaedigt, lackschaden, alter_lagerort, bemerkungen, confidence, unsichere_felder

**Sentinel-Wert:** profiltiefe = 99999 wenn nicht lesbar

### Werkstatt-Auftrag-Prompt (Modul 7, max_tokens: 2000)
Extrahiert: auftrag_nr, fahrzeug, kennschild, chassisnr, kunde_name, kunde_adresse, kunde_ort, km_alt, km_neu, annehmer, mechaniker, annahme_datum, annahme_uhrzeit, arbeiten (Array mit beschreibung/stunden/erledigt), notizen (Array), reifenetikett (marke/modell/dimension/artikel_nr/menge), confidence, unsichere_felder

**Sentinel-Wert:** km_neu = 99999 wenn nicht lesbar

### Servicelaufblatt-Prompt (TODO — noch nicht implementiert)
Wird zwei Tabellen extrahieren: verbrauchsmaterial (Array) und arbeiten (Array mit Codes PR1/WS1/PW1)

---

## Airtable

**Base ID:** appo9ljZERNttZXEA  
**Base Name:** BRW Garage  
**API URL:** https://api.airtable.com/v0/appo9ljZERNttZXEA/

### Tabelle: Einlagerungsscheine
**Table ID:** tbl0zXjJFXcyTGSBA

| Feld | Typ |
|------|-----|
| einlagerungs_nr | Text (Primary) |
| annehmer | Text |
| auftrag_nr | Text |
| kunde_name | Text |
| kunde_mobil | Text |
| fahrzeug_bezeichnung | Text |
| kennschild | Text |
| reifenmarke | Text |
| reifendimension | Text |
| profiltiefe_VL/VR/HL/HR | Number |
| radart | Text |
| pneuart | Text |
| alter_lagerort | Text |
| bemerkungen | Text |
| confidence | Number |

**Status:** ✅ Funktioniert — Datensätze werden korrekt gespeichert

### Tabelle: Werkstatt_Auftraege

| Feld | Typ |
|------|-----|
| auftrag_nr | Text (Primary) |
| fahrzeug | Text |
| kennschild | Text |
| chassisnr | Text |
| kunde_name | Text |
| kunde_adresse | Text |
| kunde_ort | Text |
| km_alt | Text |
| km_neu | Text |
| annehmer | Text |
| mechaniker | Text |
| annahme_datum | Text |
| annahme_uhrzeit | Text |
| arbeiten | Long text |
| notizen | Long text |
| reifenetikett | Long text |
| confidence | Number |

**Status:** ⚠️ In Progress — Router-Filterbedingung prüfen

### Tabelle: Servicelaufblaetter
**Status:** 🔲 TODO — Felder noch nicht angelegt

---

## Airtable HTTP Body Templates

### Einlagerungsscheine (Modul 11)
```json
{
  "records": [{
    "fields": {
      "einlagerungs_nr": "{{12.einlagerungs_nr}}",
      "annehmer": "{{12.annehmer}}",
      "auftrag_nr": "{{12.auftrag_nr}}",
      "kunde_name": "{{12.kunde_name}}",
      "kunde_mobil": "{{12.kunde_mobil}}",
      "fahrzeug_bezeichnung": "{{12.fahrzeug_bezeichnung}}",
      "kennschild": "{{12.kennschild}}",
      "reifenmarke": "{{12.reifenmarke}}",
      "reifendimension": "{{12.reifendimension}}",
      "radart": "{{12.radart}}",
      "pneuart": "{{12.pneuart}}",
      "alter_lagerort": "{{12.alter_lagerort}}",
      "bemerkungen": "{{12.bemerkungen}}",
      "profiltiefe_VL": {{ifempty(12.profiltiefe_VL; 99999)}},
      "profiltiefe_VR": {{ifempty(12.profiltiefe_VR; 99999)}},
      "profiltiefe_HL": {{ifempty(12.profiltiefe_HL; 99999)}},
      "profiltiefe_HR": {{ifempty(12.profiltiefe_HR; 99999)}},
      "confidence": {{ifempty(12.confidence; 0)}}
    }
  }]
}
```

### Werkstatt_Auftraege (Modul 13)
```json
{
  "records": [{
    "fields": {
      "auftrag_nr": "{{14.auftrag_nr}}",
      "fahrzeug": "{{14.fahrzeug}}",
      "kennschild": "{{14.kennschild}}",
      "chassisnr": "{{14.chassisnr}}",
      "kunde_name": "{{14.kunde_name}}",
      "kunde_adresse": "{{14.kunde_adresse}}",
      "kunde_ort": "{{14.kunde_ort}}",
      "km_alt": "{{14.km_alt}}",
      "km_neu": "{{14.km_neu}}",
      "annehmer": "{{14.annehmer}}",
      "mechaniker": "{{14.mechaniker}}",
      "annahme_datum": "{{14.annahme_datum}}",
      "annahme_uhrzeit": "{{14.annahme_uhrzeit}}",
      "arbeiten": "{{14.arbeiten}}",
      "notizen": "{{14.notizen}}",
      "reifenetikett": "{{14.reifenetikett}}",
      "confidence": {{ifempty(14.confidence; 0)}}
    }
  }]
}
```

---

## PWA (GitHub)

**Repository:** https://github.com/dowuest/BRW-Garage  
**GitHub Pages:** https://dowuest.github.io/BRW-Garage

**Files:**
- index.html — Kamera-App
- manifest.json — PWA Manifest
- sw.js — Service Worker
- BRW_Logo.png — App Icon
- icon-192.png / icon-512.png

**Status:** ✅ Erstellt via Claude Code

---

## Offene Punkte (TODO)

1. **Werkstatt-Auftrag Ast:** Router-Filterbedingung prüfen — Werkstatt-Auftrag Fotos landen nicht im richtigen Ast
2. **Servicelaufblatt Ast:** HTTP Extraktion + JSON Parse + Airtable aufbauen
3. **Fehler/Unbekannt Ast:** Logging in separaten Airtable-Tab
4. **Bildkomprimierung:** Fotos vor dem Senden auf <1MB komprimieren (in PWA einbauen)
5. **Bild-Upload:** imgbb.com Integration für Originalbilder als Airtable-Attachment
6. **Lokale App:** Python/FastAPI oder Streamlit nach Make.com-Prototyp

---

## Testanleitung (Postman)

**URL:** https://hook.eu1.make.com/miq6ugjn8lprsxxxsfrhwavtjzieoocs  
**Method:** POST  
**Body:** raw → JSON

```json
{
  "image_base64": "<base64 String von base64.guru>",
  "filename": "einlagerungsschein.jpg",
  "timestamp": "2026-04-28"
}
```

**Bilder konvertieren:** base64.guru/converter/encode/image  
**Bilder komprimieren:** squoosh.app (Ziel: unter 1MB)

**Wichtig:** Make.com muss im "Run once" Modus sein bevor Postman Send gedrückt wird.
