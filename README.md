# Portugiesisch Vokabeltrainer (PWA)

Vokabeltrainer für brasilianisches Portugiesisch als Progressive Web App.
Läuft komplett im Browser, alle Daten bleiben lokal auf dem Gerät (localStorage + IndexedDB), kein Server nötig.

**Live:** https://justus137.github.io/portugiesisch-vokabeln/

## Features

- Tägliche Eingabe von Vokabeln (Ziel: 10 pro Tag), automatisch nach Datum und Woche gruppiert
- Starterpaket: die 2.500 häufigsten brasilianischen Vokabeln (`deck-freq2500.json`) mit Beispielsätzen und Präsens-Konjugation bei Verben, Freischaltung 20 pro Tag
- Wochenübersicht mit Bearbeiten und Löschen (Suche über alle Vokabeln, auch noch gesperrte Paket-Wörter)
- Lern-Session mit 20-Minuten-Timer und Spaced Repetition (vereinfachtes SM-2, 3 Bewertungsstufen)
- Zufallsmodus ohne Einfluss auf den Lernplan
- Backup: JSON-Export/-Import (inkl. Paket-Warteschlange), Erinnerung nach 7 Tagen, automatische tägliche Snapshots (IndexedDB, die letzten 10)
- Statistik: fällige Karten, Lernstreak, Gesamtzahl, Prognose bis zum Zieldatum
- Offline-fähig per Service Worker, als App auf dem iPhone installierbar

## Quellen und Lizenz des Starterpakets

- Frequenzbasis: [hermitdave/FrequencyWords](https://github.com/hermitdave/FrequencyWords) (OpenSubtitles 2018, pt_br), Lizenz CC-BY-SA-4.0
- Konjugationen: regelbasiert generiert (`tools/build_deck.py`), unregelmäßige Verben stichprobengeprüft gegen [Wiktionary](https://en.wiktionary.org) (CC-BY-SA)
- Die abgeleitete Wortliste `deck-freq2500.json` steht damit ebenfalls unter CC-BY-SA-4.0

## Auf dem iPhone installieren

1. Die Live-URL in Safari öffnen
2. Teilen-Button -> "Zum Home-Bildschirm"
3. App vom Home-Bildschirm starten (läuft dann im Vollbild)

## Änderungen deployen

Die App liegt als statische Seite auf GitHub Pages (Branch `main`, Root).
Nach jeder Änderung einfach committen und pushen, nach 1-2 Minuten ist der neue Stand live:

```bash
git add -A
git commit -m "Beschreibung der Änderung"
git push
```

Bei Code-Änderungen bitte zwei Versionsstellen mitpflegen:

- `APP_VERSION` und `CHANGELOG` in `app.js` (sichtbar unter Backup -> App-Info)
- `CACHE` in `sw.js` (z.B. `ptvok-v1.0.1`), damit alte Offline-Caches aufgeräumt werden

## Lokal testen

```bash
python3 -m http.server 4173
```

Dann http://localhost:4173 im Browser öffnen.

## Icons neu erzeugen

```bash
python3 tools/icon_gen.py
```

Erzeugt `icons/icon-180.png`, `icon-192.png`, `icon-512.png` ohne externe Abhängigkeiten.

## Datenmodell (Kurzfassung)

Eine Karte in `localStorage` (`ptvok.data.v1`):

```json
{
  "id": "c...", "pt": "a saudade", "de": "die Sehnsucht", "example": "Que saudade!",
  "createdAt": "2026-08-03", "createdTs": 1770000000000, "updatedAt": 1770000000000,
  "ef": 2.5, "interval": 6, "reps": 2, "lapses": 0, "due": "2026-08-09", "last": "2026-08-03"
}
```

Dazu `activity` (pro Tag: eingegeben/wiederholt, für Streak) und `meta` (z.B. `lastExportAt`).
Snapshots liegen separat in IndexedDB (`ptvok-snapshots`).
