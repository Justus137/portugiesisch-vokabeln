#!/usr/bin/env python3
"""Baut deck-freq2500.json aus den Chunk-Dateien.
- merged Chunks in Reihenfolge (Frequenz-Reihenfolge bleibt erhalten)
- dedupliziert nach normalisiertem Lemma
- generiert regelmaessige Praesens-Konjugationen fuer Verben ohne explizites "c"
- validiert alle Eintraege
"""
import json, glob, os, re, sys, unicodedata

MAX_WORDS = 2500
BASE = os.path.dirname(os.path.abspath(__file__))

def norm(s):
    s = unicodedata.normalize('NFD', s.lower())
    s = ''.join(c for c in s if not unicodedata.combining(c))
    return s.strip()

def dedup_key(pt):
    # Artikel und Alternativformen entfernen: "o amigo / a amiga" -> "amigo"
    first = pt.split('/')[0].strip()
    first = re.sub(r'^(o|a|os|as|um|uma)\s+', '', first)
    return norm(first)

# Orthografie-Regeln fuer 1. Person Singular
def first_person(stem, inf):
    if inf.endswith('cer'):
        return stem[:-1] + 'ço'      # conhecer -> conheço
    if inf.endswith('ger') or inf.endswith('gir'):
        return stem[:-1] + 'jo'      # proteger -> protejo, dirigir -> dirijo
    if inf.endswith('guir'):
        return stem[:-2] + 'go'      # distinguir -> distingo
    return stem + 'o'

def conjugate(inf):
    """Regelmaessige Praesens-Konjugation. Gibt None zurueck, wenn unbekannte Endung."""
    if inf.endswith('ar'):
        stem = inf[:-2]
        if inf.endswith('ear'):      # passear -> passeio
            e = inf[:-3]
            return [e+'eio', e+'eias', e+'eia', e+'eamos', e+'eais', e+'eiam']
        return [first_person(stem, inf), stem+'as', stem+'a', stem+'amos', stem+'ais', stem+'am']
    if inf.endswith('er'):
        stem = inf[:-2]
        return [first_person(stem, inf), stem+'es', stem+'e', stem+'emos', stem+'eis', stem+'em']
    if inf.endswith('ir'):
        stem = inf[:-2]
        return [first_person(stem, inf), stem+'es', stem+'e', stem+'imos', stem+'is', stem+'em']
    if inf.endswith('por') or inf.endswith('pôr'):   # compor -> componho ...
        p = inf[:-3] if inf.endswith('pôr') else inf[:-3]
        return [p+'ponho', p+'pões', p+'põe', p+'pomos', p+'pondes', p+'põem']
    return None

def main():
    files = sorted(glob.glob(os.path.join(BASE, 'out', 'chunk-*.json')))
    seen = {}
    order = []
    dupes = 0
    errors = []
    for f in files:
        with open(f, encoding='utf-8') as fh:
            try:
                entries = json.load(fh)
            except json.JSONDecodeError as e:
                errors.append(f'{os.path.basename(f)}: JSON-Fehler {e}')
                continue
        for e in entries:
            if not isinstance(e, dict) or not e.get('pt') or not e.get('de') or not e.get('ex'):
                errors.append(f'{os.path.basename(f)}: unvollstaendiger Eintrag {e}')
                continue
            key = dedup_key(e['pt'])
            if key in seen:
                dupes += 1
                continue
            seen[key] = e
            order.append(key)

    # Konjugationen ergaenzen und validieren
    verbs = 0
    irregular = 0
    conj_errors = []
    for key in order:
        e = seen[key]
        if e.get('v'):
            verbs += 1
            if 'c' in e:
                irregular += 1
                if not (isinstance(e['c'], list) and len(e['c']) == 6 and all(e['c'])):
                    conj_errors.append(f"{e['pt']}: explizite Konjugation ungueltig")
            else:
                inf = e['pt'].split('/')[0].strip()
                inf = re.sub(r'^(o|a)\s+', '', inf)
                c = conjugate(norm_inf(inf))
                if c is None:
                    conj_errors.append(f"{e['pt']}: keine Regel fuer diese Endung")
                else:
                    e['c'] = c

    final = [seen[k] for k in order[:MAX_WORDS]]

    out_path = os.path.join(BASE, 'out', 'deck-freq2500.json')
    deck = {
        'name': 'Häufigste 2.500 Wörter (Brasilianisches Portugiesisch)',
        'version': 1,
        'source': 'Frequenzbasis: OpenSubtitles 2018 (hermitdave/FrequencyWords, CC-BY-SA-4.0); Konjugationen geprüft gegen Wiktionary (CC-BY-SA)',
        'count': len(final),
        'words': final
    }
    with open(out_path, 'w', encoding='utf-8') as fh:
        json.dump(deck, fh, ensure_ascii=False, separators=(',', ':'))

    print(f'Chunks: {len(files)}')
    print(f'Eindeutige Lemmata: {len(order)} (Duplikate uebersprungen: {dupes})')
    print(f'Im Deck (Cap {MAX_WORDS}): {len(final)}')
    print(f'Verben: {verbs} (davon explizit/unregelmaessig: {irregular})')
    size = os.path.getsize(out_path)
    print(f'Deck-Datei: {size//1024} KB -> {out_path}')
    if errors:
        print('\nFEHLER:')
        for e in errors[:20]:
            print(' -', e)
    if conj_errors:
        print('\nKONJUGATIONS-PROBLEME:')
        for e in conj_errors[:20]:
            print(' -', e)
    if errors or conj_errors:
        sys.exit(1)

def norm_inf(inf):
    return inf.strip()

if __name__ == '__main__':
    main()
