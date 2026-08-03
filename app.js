'use strict';

/* =====================================================================
   Portugiesisch Vokabeltrainer (PWA)
   Datenhaltung: localStorage (Live-Daten) + IndexedDB (Auto-Snapshots)
   Spaced Repetition: vereinfachtes SM-2 mit 3 Bewertungsstufen
   ===================================================================== */

const APP_VERSION = '1.1.0';
const CHANGELOG = [
  { v: '1.1.0', date: '2026-08-03', notes: 'Problemwörter-Liste in der Vokabelübersicht, Tempo-Prognose auf dem Start-Screen, App-Badge mit fälligen Karten (installierte App, iOS 16.4+)' },
  { v: '1.0.1', date: '2026-08-03', notes: 'Countdown-Zieldatum auf 2.2.2027 korrigiert' },
  { v: '1.0.0', date: '2026-08-03', notes: 'Erste Version: Vokabeleingabe, Wochenübersicht, SM-2 Lern-Sessions (20 Min), Zufallsmodus, Export/Import, Auto-Snapshots, Statistik' }
];

const LS_KEY = 'ptvok.data.v1';
const DAILY_GOAL = 10;
const LEECH_LAPSES = 4;             // ab so vielen Fehlversuchen gilt ein Wort als Problemwort
const SESSION_MINUTES = 20;
const SNAP_KEEP = 10;
const MAX_INTERVAL = 180;           // Tage
const TARGET_DATE = '2027-02-02';   // Start Auslandssemester São Paulo

/* ================= Utilities ================= */

const $ = (s) => document.querySelector(s);
const WEEKDAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

function pad(n) { return String(n).padStart(2, '0'); }
function dstr(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function today() { return dstr(new Date()); }
function parseD(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function addDays(s, n) { const d = parseD(s); d.setDate(d.getDate() + n); return dstr(d); }
function dayDiff(a, b) { // b - a in Tagen, DST-sicher
  const A = parseD(a), B = parseD(b);
  return Math.round((Date.UTC(B.getFullYear(), B.getMonth(), B.getDate()) - Date.UTC(A.getFullYear(), A.getMonth(), A.getDate())) / 86400000);
}
function mondayOf(s) { const d = parseD(s); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); return dstr(d); }
function weekdayName(s) { return WEEKDAYS[(parseD(s).getDay() + 6) % 7]; }
function fmtShort(s) { const d = parseD(s); return d.getDate() + '.' + (d.getMonth() + 1) + '.'; }
function fmtFull(s) { const d = parseD(s); return d.getDate() + '. ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear(); }
function fmtTs(ts) {
  const d = new Date(ts);
  return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear() + ', ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}
function esc(t) {
  return String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim(); }
function uid() { return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

let toastTimer = null;
function toast(msg, ms = 2200) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden', 'fade');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.add('fade');
    setTimeout(() => el.classList.add('hidden'), 300);
  }, ms);
}

/* ================= Modals ================= */

function openOverlay(html, { center = false, onBackdrop = null } = {}) {
  const bd = document.createElement('div');
  bd.className = 'modal-backdrop' + (center ? ' center' : '');
  bd.innerHTML = html;
  bd.addEventListener('click', (e) => { if (e.target === bd && onBackdrop) onBackdrop(); });
  document.body.appendChild(bd);
  return bd;
}

function showConfirm({ title, text, confirmLabel = 'OK', cancelLabel = 'Abbrechen', danger = false }) {
  return new Promise((resolve) => {
    const bd = openOverlay(`
      <div class="dialog">
        <h3>${esc(title)}</h3>
        <p>${esc(text)}</p>
        <div class="dialog-btns">
          <button class="btn" data-act="cancel" type="button">${esc(cancelLabel)}</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="ok" type="button">${esc(confirmLabel)}</button>
        </div>
      </div>`, { center: true, onBackdrop: () => done(false) });
    function done(v) { bd.remove(); resolve(v); }
    bd.querySelector('[data-act="ok"]').addEventListener('click', () => done(true));
    bd.querySelector('[data-act="cancel"]').addEventListener('click', () => done(false));
  });
}

/* ================= Daten ================= */

let state = null;

function defaultState() {
  return { schemaVersion: 1, cards: [], activity: {}, meta: {} };
}

function loadData() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    state = raw ? JSON.parse(raw) : defaultState();
    if (!state || !Array.isArray(state.cards)) state = defaultState();
    state.activity = state.activity || {};
    state.meta = state.meta || {};
  } catch (e) {
    console.error('loadData', e);
    state = defaultState();
  }
}

function saveData() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch (e) {
    console.error('saveData', e);
    toast('Speichern fehlgeschlagen! Bitte Backup exportieren.', 4000);
  }
  updateBadge();
}

/* App-Badge: Anzahl faelliger Karten am Home-Bildschirm-Icon.
   Auf iOS (16.4+, installierte App) braucht das die Mitteilungs-Erlaubnis. */
function updateBadge() {
  if (!('setAppBadge' in navigator) || !state) return;
  try {
    const n = state.cards.filter((c) => c.due <= today()).length;
    const p = n > 0 ? navigator.setAppBadge(n) : navigator.clearAppBadge();
    if (p && p.catch) p.catch(() => {});
  } catch (e) { /* Browser ohne Badge-Support */ }
}

function newCard(pt, de, example) {
  const t = today();
  return {
    id: uid(), pt, de, example: example || '',
    createdAt: t, createdTs: Date.now(), updatedAt: Date.now(),
    ef: 2.5, interval: 0, reps: 0, lapses: 0, due: t, last: null
  };
}

function getCard(id) { return state.cards.find((c) => c.id === id); }

function bumpActivity(key) {
  const t = today();
  if (!state.activity[t]) state.activity[t] = { a: 0, r: 0 };
  state.activity[t][key]++;
}

function dueCards() {
  const t = today();
  return state.cards.filter((c) => c.due <= t).sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.createdTs - b.createdTs));
}

function firstDayStr() {
  if (!state.cards.length) return today();
  return state.cards.reduce((min, c) => (c.createdAt < min ? c.createdAt : min), state.cards[0].createdAt);
}

function weekIndexOf(dateStr) {
  const base = mondayOf(firstDayStr());
  return Math.floor(dayDiff(base, mondayOf(dateStr)) / 7) + 1;
}

function streak() {
  const active = (d) => { const a = state.activity[d]; return !!a && (a.a > 0 || a.r > 0); };
  let d = today();
  let s = 0;
  if (!active(d)) d = addDays(d, -1); // heute noch nichts gemacht -> Streak bis gestern zaehlt
  while (active(d)) { s++; d = addDays(d, -1); }
  return s;
}

/* ================= Spaced Repetition (vereinfachtes SM-2) =================
   3 Stufen: 0 = Nicht gewusst, 1 = Unsicher, 2 = Gewusst
   - Nicht gewusst: Karte faellt zurueck (Intervall 0, kommt in derselben
     Session erneut), EF -0.20
   - Unsicher: kleines Intervall-Wachstum (x1.2), EF -0.15
   - Gewusst: 1 Tag -> 6 Tage -> Intervall x EF; EF erholt sich um +0.05
   EF bleibt zwischen 1.3 und 2.5, Intervall max. 180 Tage. */

function rateCard(c, grade) {
  const t = today();
  if (grade === 0) {
    c.lapses++;
    c.reps = 0;
    c.interval = 0;
    c.ef = Math.max(1.3, c.ef - 0.2);
    c.due = t;
  } else if (grade === 1) {
    c.ef = Math.max(1.3, c.ef - 0.15);
    c.interval = c.interval <= 0 ? 1 : Math.min(MAX_INTERVAL, Math.max(c.interval + 1, Math.round(c.interval * 1.2)));
    c.reps++;
    c.due = addDays(t, c.interval);
  } else {
    c.ef = Math.min(2.5, c.ef + 0.05);
    if (c.interval <= 0) c.interval = 1;
    else if (c.interval === 1) c.interval = 6;
    else c.interval = Math.min(MAX_INTERVAL, Math.round(c.interval * c.ef));
    c.reps++;
    c.due = addDays(t, c.interval);
  }
  c.ef = Math.round(c.ef * 100) / 100;
  c.last = t;
  c.updatedAt = Date.now();
}

function cardStatusClass(c) {
  if (c.due <= today()) return 'due';
  if (c.interval < 7) return 'learning';
  return 'mature';
}

/* ================= Views / Navigation ================= */

let currentTab = 'home';

function switchTab(name) {
  currentTab = name;
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  $('#view-' + name).classList.remove('hidden');
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  window.scrollTo(0, 0);
  renderCurrentView();
}

function renderCurrentView() {
  if (currentTab === 'home') renderHome();
  else if (currentTab === 'add') renderAddMeta();
  else if (currentTab === 'list') renderWeeks();
  else if (currentTab === 'backup') renderBackup();
  updateBackupBadge();
}

/* ---------- Start ---------- */

function backupDueInfo() {
  const n = state.cards.length;
  if (!n) return { show: false };
  const last = state.meta.lastExportAt;
  if (!last) {
    const first = state.cards.reduce((m, c) => Math.min(m, c.createdTs || Date.now()), Date.now());
    const days = Math.floor((Date.now() - first) / 86400000);
    if (days >= 2) return { show: true, text: `Noch kein Backup erstellt. Sichere deine ${n} Vokabeln als Datei.` };
    return { show: false };
  }
  const days = Math.floor((Date.now() - last) / 86400000);
  if (days > 7) return { show: true, text: `Letztes Backup vor ${days} Tagen. Jetzt wieder exportieren?` };
  return { show: false };
}

function updateBackupBadge() {
  $('#tab-backup-dot').classList.toggle('hidden', !backupDueInfo().show);
}

/* Prognose: bisheriges Eingabe-Tempo hochgerechnet bis zum Zieldatum */
function prognosis() {
  if (!state.cards.length) return null;
  const rest = dayDiff(today(), TARGET_DATE);
  if (rest <= 0) return null;
  const elapsed = Math.max(1, dayDiff(firstDayStr(), today()) + 1);
  const pace = state.cards.length / elapsed;
  const projected = Math.max(state.cards.length, Math.round((state.cards.length + pace * rest) / 10) * 10);
  return {
    paceTxt: pace.toLocaleString('de-DE', { maximumFractionDigits: 1 }),
    projectedTxt: projected.toLocaleString('de-DE')
  };
}

function renderHome() {
  const h = new Date().getHours();
  $('#greeting').textContent = h < 11 ? 'Bom dia! ☀️' : h < 18 ? 'Boa tarde! 👋' : 'Boa noite! 🌙';
  const rest = dayDiff(today(), TARGET_DATE);
  $('#countdown').textContent = rest > 0 ? `Noch ${rest} Tage bis São Paulo 🇧🇷` : 'Boa sorte em São Paulo! 🇧🇷';

  const due = dueCards().length;
  const dueEl = $('#stat-due');
  dueEl.textContent = due;
  dueEl.classList.toggle('warn', due > 30);
  const st = streak();
  $('#stat-streak').textContent = st > 0 ? st + ' 🔥' : '0';
  $('#stat-total').textContent = state.cards.length;

  $('#play-sub').textContent = due > 0
    ? `${SESSION_MINUTES} Minuten · ${due} Karten fällig`
    : 'Keine Karten fällig 🎉';

  const added = (state.activity[today()] || {}).a || 0;
  $('#today-count').textContent = `${added}/${DAILY_GOAL}`;
  $('#today-dots').innerHTML = dotsHTML(added);

  const prog = prognosis();
  const progEl = $('#prognosis');
  if (prog) {
    progEl.textContent = `Bei deinem Tempo (Ø ${prog.paceTxt}/Tag): ca. ${prog.projectedTxt} Vokabeln bis zum ${fmtShort(TARGET_DATE)}${TARGET_DATE.slice(0, 4)}`;
    progEl.classList.remove('hidden');
  } else {
    progEl.classList.add('hidden');
  }

  const info = backupDueInfo();
  $('#backup-banner').classList.toggle('hidden', !info.show);
  if (info.show) $('#backup-banner-text').textContent = info.text;

  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent);
  const standalone = navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
  $('#install-hint').classList.toggle('hidden', !(isIOS && !standalone && !state.meta.hideInstallHint));

  const canBadge = 'setAppBadge' in navigator && 'Notification' in window;
  const showBadgeHint = canBadge && standalone && Notification.permission === 'default' && !state.meta.hideBadgeHint;
  $('#badge-hint').classList.toggle('hidden', !showBadgeHint);
}

function dotsHTML(n) {
  let html = '';
  for (let i = 0; i < DAILY_GOAL; i++) html += `<span class="dot${i < n ? ' on' : ''}"></span>`;
  return html;
}

/* ---------- Eingeben ---------- */

function renderAddMeta() {
  const t = today();
  const wk = state.cards.length ? weekIndexOf(t) : 1;
  $('#add-date').textContent = `${weekdayName(t)}, ${fmtFull(t)} · Woche ${wk}`;
  const added = (state.activity[t] || {}).a || 0;
  $('#add-dots').innerHTML = dotsHTML(added);

  const todays = state.cards.filter((c) => c.createdAt === t).sort((a, b) => b.createdTs - a.createdTs);
  $('#today-list-head').textContent = `Heute eingetragen (${todays.length})`;
  $('#today-list').innerHTML = todays.length
    ? todays.map((c) => `
        <div class="vrow static">
          <div class="vmain">
            <div class="vpt">${esc(c.pt)}</div>
            <div class="vde">${esc(c.de)}</div>
          </div>
        </div>`).join('')
    : '<p class="sub small">Noch keine Vokabeln heute. Vamos lá!</p>';
}

function checkDuplicate() {
  const v = norm($('#in-pt').value);
  const hint = $('#dup-hint');
  if (!v) { hint.classList.add('hidden'); return; }
  const dup = state.cards.find((c) => norm(c.pt) === v);
  if (dup) {
    hint.textContent = `„${dup.pt}“ ist schon eingetragen (${fmtShort(dup.createdAt)}, Woche ${weekIndexOf(dup.createdAt)}): ${dup.de}`;
    hint.classList.remove('hidden');
  } else {
    hint.classList.add('hidden');
  }
}

function handleAdd(e) {
  e.preventDefault();
  const pt = $('#in-pt').value.trim();
  const de = $('#in-de').value.trim();
  const ex = $('#in-ex').value.trim();
  if (!pt || !de) { toast('Bitte Portugiesisch und Deutsch ausfüllen'); return; }
  state.cards.push(newCard(pt, de, ex));
  bumpActivity('a');
  saveData();
  $('#in-pt').value = ''; $('#in-de').value = ''; $('#in-ex').value = '';
  $('#dup-hint').classList.add('hidden');
  renderAddMeta();
  updateBackupBadge();
  const added = (state.activity[today()] || {}).a || 0;
  toast(added === DAILY_GOAL ? `Tagesziel erreicht: ${DAILY_GOAL}/${DAILY_GOAL}! 🎉` : 'Gespeichert ✓');
  $('#in-pt').focus();
}

/* ---------- Vokabel-Liste ---------- */

let openWeeks = null;    // Set der aufgeklappten Wochen
let openLeeches = false; // Problemwörter-Box auf/zu

function leechesHTML() {
  const ls = state.cards.filter((c) => c.lapses >= LEECH_LAPSES).sort((a, b) => b.lapses - a.lapses);
  if (!ls.length) return '';
  const rows = ls.map((c) => `
    <div class="vrow" data-id="${c.id}">
      <span class="vstat ${cardStatusClass(c)}"></span>
      <div class="vmain">
        <div class="vpt">${esc(c.pt)}</div>
        <div class="vde">${esc(c.de)}</div>
      </div>
      <span class="vlapses">${c.lapses}x ✗</span>
    </div>`).join('');
  return `
    <details class="week leech-box"${openLeeches ? ' open' : ''}>
      <summary>
        <div>
          <div class="week-title">⚠️ Problemwörter</div>
          <div class="week-meta">${ls.length} Vokabel${ls.length === 1 ? '' : 'n'} mit ${LEECH_LAPSES}+ Fehlversuchen</div>
        </div>
        <span class="chev">›</span>
      </summary>
      <div class="leech-note">Diese Wörter brauchen einen neuen Zugang: Beispielsatz ändern oder Eselsbrücke ergänzen (antippen zum Bearbeiten).</div>
      ${rows}
    </details>`;
}

function renderWeeks() {
  const wrap = $('#weeks');
  $('#list-count').textContent = state.cards.length;
  const q = norm($('#search').value);
  $('#leeches').innerHTML = (!q && state.cards.length) ? leechesHTML() : '';

  if (!state.cards.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="big">📚</div>Noch keine Vokabeln.<br>Trage im Tab &bdquo;Eingeben&ldquo; deine ersten 10 ein!</div>`;
    return;
  }

  if (q) {
    const hits = state.cards
      .filter((c) => norm(c.pt).includes(q) || norm(c.de).includes(q) || norm(c.example).includes(q))
      .sort((a, b) => b.createdTs - a.createdTs);
    const shown = hits.slice(0, 100);
    wrap.innerHTML = `<div class="week">` + (shown.length
      ? shown.map((c) => vrowHTML(c, true)).join('')
      : '<div class="empty-state">Keine Treffer.</div>')
      + (hits.length > shown.length ? `<div class="more-note">${hits.length - shown.length} weitere Treffer, bitte Suche verfeinern.</div>` : '')
      + `</div>`;
    return;
  }

  // Gruppieren: Woche -> Tag -> Karten
  const weeks = new Map();
  for (const c of state.cards) {
    const wk = weekIndexOf(c.createdAt);
    if (!weeks.has(wk)) weeks.set(wk, new Map());
    const days = weeks.get(wk);
    if (!days.has(c.createdAt)) days.set(c.createdAt, []);
    days.get(c.createdAt).push(c);
  }

  const curWeek = weekIndexOf(today());
  if (openWeeks === null) openWeeks = new Set([curWeek]);

  const base = mondayOf(firstDayStr());
  const weekKeys = [...weeks.keys()].sort((a, b) => b - a); // aktuelle Woche zuerst

  wrap.innerHTML = weekKeys.map((wk) => {
    const days = weeks.get(wk);
    const dayKeys = [...days.keys()].sort(); // Montag -> Sonntag
    const count = dayKeys.reduce((n, d) => n + days.get(d).length, 0);
    const mon = addDays(base, (wk - 1) * 7);
    const range = `${fmtShort(mon)} - ${fmtShort(addDays(mon, 6))}`;
    const body = dayKeys.map((d) => {
      const cards = days.get(d).slice().sort((a, b) => a.createdTs - b.createdTs);
      return `<div class="day-head">${weekdayName(d)}, ${fmtShort(d)} · ${cards.length}</div>`
        + cards.map((c) => vrowHTML(c, false)).join('');
    }).join('');
    return `
      <details class="week" data-wk="${wk}" ${openWeeks.has(wk) ? 'open' : ''}>
        <summary>
          <div>
            <div class="week-title">Woche ${wk}${wk === curWeek ? ' · aktuell' : ''}</div>
            <div class="week-meta">${range} · ${count} Vokabel${count === 1 ? '' : 'n'}</div>
          </div>
          <span class="chev">›</span>
        </summary>
        ${body}
      </details>`;
  }).join('');
}

function vrowHTML(c, withWeek) {
  return `
    <div class="vrow" data-id="${c.id}">
      <span class="vstat ${cardStatusClass(c)}"></span>
      <div class="vmain">
        <div class="vpt">${esc(c.pt)}</div>
        <div class="vde">${esc(c.de)}</div>
        ${c.example ? `<div class="vex">${esc(c.example)}</div>` : ''}
      </div>
      ${withWeek ? `<span class="vweek">W${weekIndexOf(c.createdAt)} · ${fmtShort(c.createdAt)}</span>` : ''}
    </div>`;
}

/* ---------- Bearbeiten / Löschen ---------- */

function openEdit(id) {
  const c = getCard(id);
  if (!c) return;
  const inDays = dayDiff(today(), c.due);
  const dueTxt = c.due <= today() ? 'heute' : fmtShort(c.due) + (inDays === 1 ? ' (morgen)' : ` (in ${inDays} Tagen)`);
  const lapsTxt = c.lapses > 0 ? ` · ${c.lapses}x nicht gewusst` : '';
  const bd = openOverlay(`
    <div class="sheet">
      <h3>Vokabel bearbeiten</h3>
      <div class="meta">Eingetragen am ${fmtShort(c.createdAt)} (Woche ${weekIndexOf(c.createdAt)}) · ${c.reps}x richtig wiederholt${lapsTxt} · Nächste Wiederholung: ${dueTxt}</div>
      <label class="field"><span>Portugiesisch</span><input id="ed-pt" type="text" lang="pt-BR" autocapitalize="off" value="${esc(c.pt)}"></label>
      <label class="field"><span>Deutsch</span><input id="ed-de" type="text" lang="de" autocapitalize="off" value="${esc(c.de)}"></label>
      <label class="field"><span>Beispielsatz</span><textarea id="ed-ex" lang="pt-BR" rows="2">${esc(c.example)}</textarea></label>
      <div class="sheet-btns">
        <button class="btn btn-primary" data-act="save" type="button">Speichern</button>
        <button class="btn btn-danger" data-act="del" type="button">Löschen</button>
        <button class="btn" data-act="cancel" type="button">Abbrechen</button>
      </div>
    </div>`, { onBackdrop: () => bd.remove() });

  bd.querySelector('[data-act="cancel"]').addEventListener('click', () => bd.remove());

  bd.querySelector('[data-act="save"]').addEventListener('click', () => {
    const pt = bd.querySelector('#ed-pt').value.trim();
    const de = bd.querySelector('#ed-de').value.trim();
    const ex = bd.querySelector('#ed-ex').value.trim();
    if (!pt || !de) { toast('Portugiesisch und Deutsch dürfen nicht leer sein'); return; }
    c.pt = pt; c.de = de; c.example = ex; c.updatedAt = Date.now();
    saveData();
    bd.remove();
    renderWeeks();
    toast('Gespeichert ✓');
  });

  bd.querySelector('[data-act="del"]').addEventListener('click', async () => {
    const ok = await showConfirm({
      title: 'Vokabel löschen?',
      text: `„${c.pt}“ wird endgültig gelöscht, inklusive Lernfortschritt.`,
      confirmLabel: 'Löschen', danger: true
    });
    if (!ok) return;
    state.cards = state.cards.filter((x) => x.id !== c.id);
    saveData();
    bd.remove();
    renderWeeks();
    renderCurrentView();
    toast('Gelöscht');
  });
}

/* ================= Lern-Session ================= */

let S = null; // Session-State

function startSession(mode) {
  if (!state.cards.length) { toast('Trage zuerst Vokabeln ein!'); return; }

  let queue;
  if (mode === 'sr') {
    queue = dueCards().map((c) => c.id);
    if (!queue.length) {
      showConfirm({
        title: 'Keine Karten fällig 🎉',
        text: 'Alle Wiederholungen sind erledigt. Möchtest du stattdessen zufällige Vokabeln üben?',
        confirmLabel: 'Zufällig üben', cancelLabel: 'Später'
      }).then((ok) => { if (ok) startSession('random'); });
      return;
    }
  } else {
    queue = shuffle(state.cards.map((c) => c.id));
  }

  S = {
    mode, queue, pos: 0, done: 0,
    counts: [0, 0, 0], flipped: false, currentId: null,
    start: Date.now(), end: Date.now() + SESSION_MINUTES * 60 * 1000,
    rating: false, timer: null
  };

  $('#session-summary').classList.add('hidden');
  $('#session-summary').innerHTML = '';
  $('#session').classList.remove('hidden');
  document.body.classList.add('no-scroll');
  $('#session-mode').textContent = mode === 'sr' ? 'Wiederholung nach Lernplan' : 'Zufallsmodus · ohne Wertung für den Lernplan';
  S.timer = setInterval(tick, 500);
  tick();
  nextCard();
}

function timeUp() { return Date.now() >= S.end; }

function tick() {
  if (!S) return;
  const rem = Math.max(0, S.end - Date.now());
  const m = Math.floor(rem / 60000);
  const s = Math.floor((rem % 60000) / 1000);
  const el = $('#session-timer');
  el.textContent = m + ':' + pad(s);
  el.classList.toggle('warn', rem < 60000 && rem > 0);
  if (rem <= 0 && !S.flipped) endSession('time');
}

function nextCard() {
  if (!S) return;
  if (timeUp()) return endSession('time');
  if (S.pos >= S.queue.length) {
    if (S.mode === 'random' && state.cards.length) {
      S.queue = shuffle(state.cards.map((c) => c.id));
      S.pos = 0;
    } else {
      return endSession('empty');
    }
  }
  S.currentId = S.queue[S.pos];
  S.pos++;
  S.flipped = false;
  S.rating = false;

  const c = getCard(S.currentId);
  if (!c) return nextCard();

  $('#fc').classList.remove('flip');
  $('#fc-front-word').textContent = c.pt;
  $('#fc-back-word').textContent = c.de;
  $('#fc-example').textContent = c.example || '';
  $('#fc-example').style.display = c.example ? '' : 'none';
  $('#fc-back-small').textContent = c.pt;
  $('#rate-row').classList.remove('show');
  updateSessionInfo();
}

function updateSessionInfo() {
  $('#session-progress').textContent = S.done + ' ✓';
  if (S.mode === 'sr') {
    const left = S.queue.length - S.pos + 1;
    $('#session-note').textContent = `Noch ${left} Karte${left === 1 ? '' : 'n'} in der Warteschlange`;
  } else {
    $('#session-note').textContent = '';
  }
}

function flipCard() {
  if (!S || S.rating) return;
  S.flipped = true;
  $('#fc').classList.toggle('flip');
  $('#rate-row').classList.add('show');
}

function rate(grade) {
  if (!S || !S.flipped || S.rating) return;
  S.rating = true;
  const c = getCard(S.currentId);
  if (c && S.mode === 'sr') {
    rateCard(c, grade);
    bumpActivity('r');
    saveData();
    if (grade === 0) {
      // Karte kommt in derselben Session nach ein paar Karten wieder
      S.queue.splice(Math.min(S.queue.length, S.pos + 3), 0, c.id);
    }
  }
  S.counts[grade]++;
  S.done++;
  nextCard();
}

function endSession(reason) {
  if (!S) return;
  clearInterval(S.timer);
  const elapsed = Math.min(SESSION_MINUTES * 60000, Date.now() - S.start);
  const em = Math.floor(elapsed / 60000);
  const es = Math.floor((elapsed % 60000) / 1000);
  const { mode, done, counts } = S;

  if (reason === 'abort' && done === 0) { closeSession(); return; }

  const reasonTxt = reason === 'time' ? 'Zeit abgelaufen'
    : reason === 'empty' ? (mode === 'sr' ? 'Alle fälligen Karten geschafft!' : 'Runde beendet')
    : 'Manuell beendet';

  $('#session-summary').innerHTML = `
    <div class="sum-emoji">${done > 0 && counts[2] >= counts[0] ? '🎉' : '💪'}</div>
    <div class="sum-title">${mode === 'sr' ? 'Muito bem!' : 'Zufallsrunde beendet'}</div>
    <div class="sum-sub">${reasonTxt} · ${done} Karte${done === 1 ? '' : 'n'} in ${em}:${pad(es)} Min.</div>
    <div class="sum-stats">
      <div class="stat"><div class="stat-num" style="color:var(--green)">${counts[2]}</div><div class="stat-label">Gewusst</div></div>
      <div class="stat"><div class="stat-num" style="color:var(--amber)">${counts[1]}</div><div class="stat-label">Unsicher</div></div>
      <div class="stat"><div class="stat-num" style="color:var(--red)">${counts[0]}</div><div class="stat-label">Nicht gewusst</div></div>
    </div>
    ${mode === 'random' ? '<div class="sum-sub">Diese Runde hat den Lernplan nicht verändert.</div>' : '<div class="sum-sub">Dein Fortschritt ist gespeichert.</div>'}
    <button class="btn btn-primary sum-btn" id="sum-close" type="button">Fertig</button>`;
  $('#session-summary').classList.remove('hidden');
  $('#sum-close').addEventListener('click', closeSession);
  S.timer = null;
}

function closeSession() {
  if (S && S.timer) clearInterval(S.timer);
  S = null;
  $('#session').classList.add('hidden');
  document.body.classList.remove('no-scroll');
  renderCurrentView();
}

async function confirmAbort() {
  if (!S) return;
  if (S.done === 0) { endSession('abort'); return; }
  const ok = await showConfirm({
    title: 'Session beenden?',
    text: 'Dein bisheriger Fortschritt ist bereits gespeichert.',
    confirmLabel: 'Beenden', cancelLabel: 'Weiter lernen'
  });
  if (ok && S) endSession('abort');
}

/* ================= Backup: Export / Import ================= */

function exportObject() {
  return {
    app: 'portugiesisch-vokabeln',
    schemaVersion: 1,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    cards: state.cards,
    activity: state.activity,
    meta: state.meta
  };
}

async function exportData() {
  if (!state.cards.length) { toast('Noch keine Vokabeln zum Exportieren'); return; }
  const json = JSON.stringify(exportObject(), null, 2);
  const name = `vokabeln-backup-${today()}.json`;
  let ok = false;

  const file = new File([json], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Vokabeln Backup' });
      ok = true;
    } catch (e) {
      if (e && e.name === 'AbortError') return; // Nutzer hat abgebrochen
    }
  }
  if (!ok) {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    ok = true;
  }
  if (ok) {
    state.meta.lastExportAt = Date.now();
    saveData();
    renderCurrentView();
    toast('Backup exportiert ✓');
  }
}

function normalizeImported(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('Keine gültige JSON-Datei.');
  if (!Array.isArray(obj.cards)) throw new Error('Datei enthält keine Vokabelliste (cards).');
  if (typeof obj.schemaVersion === 'number' && obj.schemaVersion > 1) {
    throw new Error('Backup stammt aus einer neueren App-Version.');
  }
  const t = today();
  const cards = [];
  let skipped = 0;
  for (const raw of obj.cards) {
    if (!raw || typeof raw.pt !== 'string' || typeof raw.de !== 'string' || !raw.pt.trim() || !raw.de.trim()) { skipped++; continue; }
    const c = {
      id: typeof raw.id === 'string' && raw.id ? raw.id : uid(),
      pt: raw.pt.trim(),
      de: raw.de.trim(),
      example: typeof raw.example === 'string' ? raw.example : '',
      createdAt: /^\d{4}-\d{2}-\d{2}$/.test(raw.createdAt) ? raw.createdAt : t,
      createdTs: typeof raw.createdTs === 'number' ? raw.createdTs : Date.now(),
      updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
      ef: typeof raw.ef === 'number' ? Math.min(2.5, Math.max(1.3, raw.ef)) : 2.5,
      interval: typeof raw.interval === 'number' && raw.interval >= 0 ? Math.min(MAX_INTERVAL, Math.round(raw.interval)) : 0,
      reps: Number.isInteger(raw.reps) && raw.reps >= 0 ? raw.reps : 0,
      lapses: Number.isInteger(raw.lapses) && raw.lapses >= 0 ? raw.lapses : 0,
      due: /^\d{4}-\d{2}-\d{2}$/.test(raw.due) ? raw.due : t,
      last: /^\d{4}-\d{2}-\d{2}$/.test(raw.last) ? raw.last : null
    };
    cards.push(c);
  }
  return {
    newState: {
      schemaVersion: 1,
      cards,
      activity: (obj.activity && typeof obj.activity === 'object') ? obj.activity : {},
      meta: Object.assign({}, (obj.meta && typeof obj.meta === 'object') ? obj.meta : {})
    },
    imported: cards.length,
    skipped,
    exportedAt: obj.exportedAt || null
  };
}

async function handleImportFile(file) {
  let parsed;
  try {
    parsed = normalizeImported(JSON.parse(await file.text()));
  } catch (e) {
    toast('Import fehlgeschlagen: ' + (e.message || 'ungültige Datei'), 4000);
    return;
  }
  const when = parsed.exportedAt ? fmtTs(Date.parse(parsed.exportedAt)) : 'unbekannt';
  const ok = await showConfirm({
    title: 'Backup importieren?',
    text: `Die Datei enthält ${parsed.imported} Vokabeln (exportiert: ${when})${parsed.skipped ? `, ${parsed.skipped} fehlerhafte Einträge werden übersprungen` : ''}. Deine aktuellen Daten (${state.cards.length} Vokabeln) werden ersetzt. Vorher wird automatisch ein Snapshot gespeichert.`,
    confirmLabel: 'Importieren', danger: state.cards.length > 0
  });
  if (!ok) return;
  await saveSnapshot('Vor Import');
  state = parsed.newState;
  saveData();
  openWeeks = null;
  renderCurrentView();
  toast(`${parsed.imported} Vokabeln importiert ✓`);
}

/* ================= Auto-Snapshots (IndexedDB) ================= */

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('ptvok-snapshots', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('snap', { keyPath: 'ts' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbReq(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function saveSnapshot(label) {
  try {
    const db = await idbOpen();
    const tx = db.transaction('snap', 'readwrite');
    const store = tx.objectStore('snap');
    await idbReq(store.put({
      ts: Date.now(), label,
      count: state.cards.length,
      data: JSON.stringify(exportObject())
    }));
    const keys = await idbReq(store.getAllKeys());
    keys.sort((a, b) => b - a);
    for (const k of keys.slice(SNAP_KEEP)) await idbReq(store.delete(k));
    db.close();
  } catch (e) {
    console.warn('Snapshot fehlgeschlagen', e);
  }
}

async function listSnapshots() {
  try {
    const db = await idbOpen();
    const all = await idbReq(db.transaction('snap').objectStore('snap').getAll());
    db.close();
    return all.sort((a, b) => b.ts - a.ts);
  } catch (e) {
    return null;
  }
}

async function maybeDailySnapshot() {
  if (!state.cards.length) return;
  const snaps = await listSnapshots();
  if (snaps === null) return;
  const todayStr = new Date().toDateString();
  const latestAuto = snaps.find((s) => s.label === 'Auto');
  if (!latestAuto || new Date(latestAuto.ts).toDateString() !== todayStr) {
    await saveSnapshot('Auto');
    if (currentTab === 'backup') renderBackup();
  }
}

async function restoreSnapshot(ts) {
  const snaps = await listSnapshots();
  const snap = (snaps || []).find((s) => s.ts === ts);
  if (!snap) { toast('Snapshot nicht gefunden'); return; }
  let parsed;
  try {
    parsed = normalizeImported(JSON.parse(snap.data));
  } catch (e) {
    toast('Snapshot ist beschädigt', 3000);
    return;
  }
  const ok = await showConfirm({
    title: 'Snapshot wiederherstellen?',
    text: `Stand vom ${fmtTs(snap.ts)} mit ${parsed.imported} Vokabeln. Deine aktuellen Daten (${state.cards.length} Vokabeln) werden ersetzt. Vorher wird der aktuelle Stand als Snapshot gesichert.`,
    confirmLabel: 'Wiederherstellen', danger: true
  });
  if (!ok) return;
  await saveSnapshot('Vor Wiederherstellung');
  state = parsed.newState;
  saveData();
  openWeeks = null;
  renderCurrentView();
  toast('Snapshot wiederhergestellt ✓');
}

/* ---------- Backup-View ---------- */

function renderBackup() {
  const last = state.meta.lastExportAt;
  let txt;
  if (!last) txt = 'Noch kein Backup exportiert.';
  else {
    const days = Math.floor((Date.now() - last) / 86400000);
    txt = `Letztes Backup: ${days === 0 ? 'heute' : days === 1 ? 'gestern' : `vor ${days} Tagen`} (${fmtTs(last)})`;
  }
  $('#last-export').textContent = txt;

  $('#app-version').textContent = 'v' + APP_VERSION;
  let size = 0;
  try { size = new Blob([JSON.stringify(state)]).size; } catch (e) { /* egal */ }
  $('#data-size').textContent = `${state.cards.length} Vokabeln · ${size < 1024 * 900 ? Math.max(1, Math.round(size / 1024)) + ' KB' : (size / 1048576).toFixed(1) + ' MB'} lokal gespeichert`;
  $('#changelog').innerHTML = CHANGELOG.map((c) => `<div class="cl-item"><strong>v${c.v}</strong> (${fmtShort(c.date)}${c.date.slice(0, 4)}) · ${esc(c.notes)}</div>`).join('');

  const list = $('#snap-list');
  list.innerHTML = '<p class="sub small">Lade Snapshots ...</p>';
  listSnapshots().then((snaps) => {
    if (snaps === null) {
      list.innerHTML = '<p class="sub small">Snapshots sind in diesem Browser nicht verfügbar.</p>';
      return;
    }
    if (!snaps.length) {
      list.innerHTML = '<p class="sub small">Noch keine Snapshots vorhanden.</p>';
      return;
    }
    list.innerHTML = snaps.map((s) => `
      <div class="snap">
        <div class="snap-main">
          <div>${fmtTs(s.ts)} · <strong>${s.count}</strong> Vok.</div>
          <div class="snap-label">${esc(s.label)}</div>
        </div>
        <button class="btn btn-small" data-restore="${s.ts}" type="button">Wiederherstellen</button>
      </div>`).join('');
  });
}

/* ================= Init ================= */

function bindEvents() {
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));

  $('#btn-play').addEventListener('click', () => startSession('sr'));
  $('#btn-random').addEventListener('click', () => startSession('random'));
  $('#btn-goto-add').addEventListener('click', () => switchTab('add'));
  $('#backup-banner-btn').addEventListener('click', exportData);
  $('#install-hint-close').addEventListener('click', () => {
    state.meta.hideInstallHint = true;
    saveData();
    $('#install-hint').classList.add('hidden');
  });

  $('#add-form').addEventListener('submit', handleAdd);
  $('#in-pt').addEventListener('input', checkDuplicate);

  let searchTimer = null;
  $('#search').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderWeeks, 150);
  });

  const weeks = $('#weeks');
  weeks.addEventListener('click', (e) => {
    const row = e.target.closest('.vrow');
    if (row && row.dataset.id) openEdit(row.dataset.id);
  });
  weeks.addEventListener('toggle', (e) => {
    const d = e.target;
    if (d.classList && d.classList.contains('week') && openWeeks) {
      const wk = Number(d.dataset.wk);
      if (d.open) openWeeks.add(wk); else openWeeks.delete(wk);
    }
  }, true);

  const leeches = $('#leeches');
  leeches.addEventListener('click', (e) => {
    const row = e.target.closest('.vrow');
    if (row && row.dataset.id) openEdit(row.dataset.id);
  });
  leeches.addEventListener('toggle', (e) => {
    const d = e.target;
    if (d.classList && d.classList.contains('leech-box')) openLeeches = d.open;
  }, true);

  $('#badge-hint-btn').addEventListener('click', async () => {
    try {
      const perm = await Notification.requestPermission();
      if (perm === 'granted') { updateBadge(); toast('App-Badge aktiviert ✓'); }
    } catch (e) { /* egal */ }
    renderHome();
  });
  $('#badge-hint-close').addEventListener('click', () => {
    state.meta.hideBadgeHint = true;
    saveData();
    $('#badge-hint').classList.add('hidden');
  });

  $('#fc').addEventListener('click', flipCard);
  $('#fc').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flipCard(); } });
  document.querySelectorAll('.rate').forEach((b) => b.addEventListener('click', () => rate(Number(b.dataset.grade))));
  $('#session-close').addEventListener('click', confirmAbort);

  $('#btn-export').addEventListener('click', exportData);
  $('#btn-import').addEventListener('click', () => $('#file-import').click());
  $('#file-import').addEventListener('change', (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (f) handleImportFile(f);
  });
  $('#snap-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-restore]');
    if (btn) restoreSnapshot(Number(btn.dataset.restore));
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      maybeDailySnapshot();
      if (!S) renderCurrentView();
    }
    updateBadge();
  });
}

function init() {
  loadData();
  bindEvents();
  renderCurrentView();
  maybeDailySnapshot();
  updateBadge();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW-Registrierung fehlgeschlagen', e));
  }
}

init();
