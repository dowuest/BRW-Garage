# BRW Garage – Laufblätter Scanner

PWA für BRW Garage Langnau. Fotografiert Werkstatt-Dokumente, lässt sie von Claude Vision auslesen und speichert die Daten direkt in Airtable.

## Setup

### 1. Repository klonen
```
git clone https://github.com/dowuest/BRW-Garage.git
cd BRW-Garage
```

### 2. config.js erstellen
```
cp config.example.js config.js
```
Dann `config.js` öffnen und die API-Keys eintragen:
```js
const CONFIG = {
  CLAUDE_API_KEY: 'sk-ant-...',
  AIRTABLE_TOKEN: 'pat...',
  AIRTABLE_BASE_ID: 'appo9ljZERNttZXEA'
};
```
> **config.js ist in .gitignore** und wird nie committed.

### 3. App öffnen
Direkt als Datei im Browser öffnen **funktioniert nicht** (Kamera + API brauchen HTTPS).

**Option A – GitHub Pages (empfohlen):**
https://dowuest.github.io/BRW-Garage/
→ config.js muss lokal vorhanden sein (oder Keys direkt im Browser-LocalStorage setzen, falls später implementiert)

**Option B – Lokaler Server:**
```
npx serve .
```
Dann http://localhost:3000 öffnen.

## Ablauf

1. App öffnet Kamera automatisch
2. Foto aufnehmen → Vorschau mit Bildgrösse
3. „Analysieren" → Claude Vision erkennt Dokumenttyp und extrahiert alle Felder
4. Review-Screen: alle Felder bearbeitbar, unsichere Felder orange markiert
5. „Bestätigen & Speichern" → Daten gehen direkt an Airtable
6. Erfolg → Kamera öffnet wieder für nächstes Dokument

## Dokumenttypen

| Typ | Airtable-Tabelle |
|-----|-----------------|
| Einlagerungsschein | Einlagerungsscheine |
| Werkstatt-Auftrag | Werkstatt_Auftraege |
| Servicelaufblatt | Servicelaufblaetter |

## Technisch

- Vanilla JS, keine Frameworks
- Bildkomprimierung: max 1200px, JPEG 0.65 → 0.5 → 900px/0.5 bis unter 900KB
- Claude Modell: claude-opus-4-5
- Direkter Browser-zu-API Call (kein Backend)
