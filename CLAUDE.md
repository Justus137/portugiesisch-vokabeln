# Portugiesisch-Vokabeltrainer (PWA)

Vokabeltrainer für brasilianisches Portugiesisch. Zweck: Vorbereitung auf ein
Auslandssemester in São Paulo ab dem 2.2.2027 (Countdown-Zieldatum in der App:
TARGET_DATE '2027-02-02'). Nutzer: Justus, GitHub-Account Justus137, deutsche
UI, Kommunikation auf Deutsch. Stilregel: nie den langen Gedankenstrich (em-dash)
verwenden, immer den normalen Bindestrich.

## Setup und Deployment

- Stack: Vanilla HTML/CSS/JS, keine Dependencies, kein Build-Schritt
- Live: https://justus137.github.io/portugiesisch-vokabeln/ (GitHub Pages, Branch main, Root)
- Deploy = einfach committen und pushen, Pages baut automatisch (ca. 40-60s)
- Bei JEDEM Release: APP_VERSION + CHANGELOG-Eintrag in app.js UND CACHE-Name in sw.js hochzählen, sonst bekommen installierte PWAs das Update nicht sauber
- Git-Identität ist repo-lokal konfiguriert (Justus137 + noreply-Mail)
- Lokaler Test: Dateien in ein temporäres Verzeichnis kopieren und von dort per Webserver ausliefern (macOS-Sandbox erlaubt Servern oft keinen Zugriff auf Documents)

## Architektur (alles in app.js, ~1500 Zeilen)

- Daten in localStorage unter `ptvok.data.v1`; Auto-Snapshots in IndexedDB `ptvok-snapshots` (max 10, 1x täglich beim ersten Öffnen)
- State: { schemaVersion: 2, cards[], activity{date:{a,r}}, meta{}, pack{name,total,queue,added,perDay,lastUnlock} }
- Spaced Repetition: vereinfachtes SM-2 mit 3 Stufen (Nicht gewusst / Unsicher / Gewusst), EF 1.3-2.5, Intervalle 1 -> 6 -> xEF, Cap 180 Tage; nicht gewusste Karten kommen in derselben Session 3 Positionen später erneut
- Lern-Session: 20 Minuten Timer (SESSION_MINUTES), Tagesziel 10 eigene Vokabeln (DAILY_GOAL)
- Zufallsmodus zieht NUR bereits gelernte Karten (c.last gesetzt, learnedCards())
- Bearbeiten/Löschen von Vokabeln NUR im Tab "Vokabeln", nie in Sessions (bewusste Design-Entscheidung des Nutzers)
- Aussprache: Web Speech API mit pt-BR-Stimme (pickPtVoice, speak())
- Problemwörter-Liste: Karten mit lapses >= 4 (LEECH_LAPSES)
- Export/Import: JSON mit schemaVersion 2 inkl. pack; Backup-Erinnerung nach 7 Tagen

## Starterpaket (deck-freq2500.json)

- Aktuell Version 4, 2.504 Einträge: die häufigsten pt_br-Wörter aus der OpenSubtitles-Frequenzliste (hermitdave/FrequencyWords, CC-BY-SA-4.0), manuell lemmatisiert
- Feldformat: {pt, de, ex, exd, v?, c?} - ex/exd = Beispielsatz + deutsche Übersetzung, v=1 bei Verben, c = Präsens-Konjugation aller 6 Personen
- 20 neue Karten pro Tag werden freigeschaltet (PACK_PER_DAY, unlockPackCards)
- syncPackContent(): wenn meta.packSyncV != deck.version, werden Karten/Queue automatisch gepatcht und neue Deck-Wörter vorn in bestehende Queues eingereiht - Deck-Korrekturen erreichen so auch Bestandsnutzer; deshalb bei Deck-Änderungen die version im JSON hochzählen
- Build-Skript: tools/build_deck.py (regelbasierter Konjugator + EXPLICIT_OVERRIDES für despedir, reunir)
- Qualität: Vollreview aller Einträge und Konjugations-Audit abgeschlossen; Frequenz-Audit ergab 95,4% Token-Abdeckung

## Design (seit v1.5.x)

- Warmes Creme (#F6F1EA) mit Pfirsich-Verlauf oben (--peach #F5D3BC), Orange als Akzent (#E86B34), weiße Karten mit weichen Schatten, Serifen-Headlines (--font-display), Pill-Buttons
- KEIN Dark Mode: color-scheme:light, App ist bewusst immer hell - Nutzer will keinen dunklen Hintergrund, auch nicht bei System-Dark-Mode
- Vorherige Iterationen: v1.4.x war iOS-Look mit Brasilien-Grün (verworfen, Grün als Hintergrund gefiel nicht)

## Bekannte Schwachstellen / besprochene Ideen (nicht beauftragt)

- Datenverlust-Risiko: alles liegt nur auf einem Gerät (localStorage), Schutz nur über manuelle JSON-Exporte
- Rückstau-Falle: die 20 Freischaltungen pro Tag laufen bei Lernpausen weiter, keine Pause-Logik
- Wochenliste rendert alle Karten (Performance bei 2.500+)
- Nur Abfragerichtung PT->DE; Ideen: DE->PT, Tipp-Modus
- TTS und Share-Sheet-Export auf echtem iPhone noch ungetestet

## Wichtig bei Account-/URL-Wechsel

Die Lerndaten hängen an der URL (localStorage). Vor jedem Umzug auf eine andere
Domain: in der App Backup exportieren, danach auf der neuen URL importieren.
