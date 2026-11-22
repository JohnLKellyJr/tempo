// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-purple; icon-glyph: magic;

/*
 * Tempo widget for Scriptable (free on the App Store).
 *
 * Shows today's date, your next events and your to-dos from Tempo.
 * Tapping the widget starts the "Ask Tempo" shortcut so you can talk to it.
 *
 * First run: open this script in Scriptable and tap ▶︎. It asks for your
 * Web app URL and App key (the same two you use in Tempo's Settings).
 * To change them later, run it again and choose "Change connection".
 *
 * Widget "Parameter" options (long-press widget → Edit Widget → Parameter):
 *   (empty)  tap opens the "Ask Tempo" shortcut (talk to Tempo)
 *   app      tap opens the Tempo app instead
 */

const APP_URL = 'https://johnlkellyjr.github.io/tempo/';
const SHORTCUT_NAME = 'Ask Tempo';
const KEY_URL = 'tempo.url';
const KEY_KEY = 'tempo.key';
const ACCENT = new Color('#a99bff');
const ACCENT_2 = new Color('#ff8a5c');

// ───────────── Connection settings ─────────────
async function askForConnection() {
  const a = new Alert();
  a.title = 'Connect Tempo';
  a.message = 'Paste the same Web app URL (ends in /exec) and App key you use in Tempo’s Settings.';
  a.addTextField('https://script.google.com/macros/s/…/exec', Keychain.contains(KEY_URL) ? Keychain.get(KEY_URL) : '');
  a.addTextField('App key', Keychain.contains(KEY_KEY) ? Keychain.get(KEY_KEY) : '');
  a.addAction('Save');
  a.addCancelAction('Cancel');
  if (await a.presentAlert() === -1) return false;
  const url = a.textFieldValue(0).trim();
  const key = a.textFieldValue(1).trim();
  if (!/^https:\/\/script\.google\.com\/.+\/exec/.test(url)) {
    await info('That URL doesn’t look right', 'Use the Web app URL from Apps Script → Deploy → Manage deployments. It ends in /exec.');
    return false;
  }
  if (key.length < 16) {
    await info('That key doesn’t look right', 'Copy the APP_SECRET value from Apps Script → Project Settings → Script Properties.');
    return false;
  }
  Keychain.set(KEY_URL, url);
  Keychain.set(KEY_KEY, key);
  return true;
}

async function info(title, message) {
  const a = new Alert(); a.title = title; a.message = message; a.addAction('OK'); await a.presentAlert();
}

// ───────────── Data ─────────────
const fm = FileManager.local();
const cachePath = fm.joinPath(fm.cacheDirectory(), 'tempo-widget.json');

async function loadData() {
  if (!Keychain.contains(KEY_URL) || !Keychain.contains(KEY_KEY)) return { error: 'setup' };
  try {
    const req = new Request(Keychain.get(KEY_URL));
    req.method = 'POST';
    req.headers = { 'Content-Type': 'text/plain;charset=utf-8' };
    req.body = JSON.stringify({ key: Keychain.get(KEY_KEY), action: 'today' });
    req.timeoutInterval = 25;
    const json = await req.loadJSON();
    if (!json.ok) return Object.assign(readCache() || {}, { error: json.error || 'Could not load' });
    fm.writeString(cachePath, JSON.stringify(json));
    return json;
  } catch (e) {
    const cached = readCache();
    return cached ? Object.assign(cached, { stale: true }) : { error: 'offline' };
  }
}

function readCache() {
  try { return fm.fileExists(cachePath) ? JSON.parse(fm.readString(cachePath)) : null; } catch (e) { return null; }
}

// ───────────── Dates ─────────────
const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function parse(s) {
  const [d, t = '00:00'] = s.split('T');
  const [y, m, dd] = d.split('-').map(Number);
  const [h, mi] = t.split(':').map(Number);
  return new Date(y, m - 1, dd, h, mi);
}
const WD = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
function hm(d, withAmPm) {
  const h = d.getHours() % 12 || 12, m = d.getMinutes();
  return (m ? `${h}:${pad(m)}` : `${h}`) + (withAmPm ? (d.getHours() >= 12 ? ' PM' : ' AM') : '');
}
function range(ev) {
  if (ev.all_day) return 'All day';
  const s = parse(ev.start), e = parse(ev.end);
  const same = (s.getHours() >= 12) === (e.getHours() >= 12);
  return `${hm(s, !same)}–${hm(e, true)}`;
}
function dayLabel(key, now) {
  if (key === dayKey(now)) return 'TODAY';
  const t = new Date(now); t.setDate(t.getDate() + 1);
  if (key === dayKey(t)) return 'TOMORROW';
  const d = parse(key);
  return `${WD[d.getDay()]} ${d.getDate()}`;
}

// What to show: rest of today; if nothing left, the next day that has events.
function pickEvents(events, now, max) {
  const upcoming = (events || []).filter((e) => parse(e.end) > now).sort((a, b) => a.start.localeCompare(b.start));
  if (!upcoming.length) return { label: 'NOTHING SCHEDULED', list: [] };
  const firstDay = upcoming[0].start.slice(0, 10);
  const list = upcoming.filter((e) => e.start.slice(0, 10) === firstDay).slice(0, max);
  return { label: dayLabel(firstDay, now), list };
}

function pickTasks(todos, now) {
  const today = dayKey(now);
  const rank = { high: 0, normal: 1, low: 2 };
  const open = (todos || []).filter((t) => !t.done && !t.parent).sort((a, b) => {
    const ad = a.due || '9999', bd = b.due || '9999';
    return ad !== bd ? ad.localeCompare(bd) : (rank[a.priority] ?? 1) - (rank[b.priority] ?? 1);
  });
  const due = open.filter((t) => t.due && t.due <= today);
  return { open, due };
}

// ───────────── Drawing ─────────────
const text = Color.dynamic(new Color('#17141f'), new Color('#ffffff'));
const text2 = Color.dynamic(new Color('#17141f', 0.62), new Color('#ffffff', 0.72));
const cardFill = Color.dynamic(new Color('#ffffff', 0.55), new Color('#ffffff', 0.12));

function background(w) {
  const g = new LinearGradient();
  g.locations = [0, 1];
  g.colors = [
    Color.dynamic(new Color('#f4f1fb'), new Color('#1a1830')),
    Color.dynamic(new Color('#efe7f3'), new Color('#0e0d18'))
  ];
  g.startPoint = new Point(0, 0);
  g.endPoint = new Point(1, 1);
  w.backgroundGradient = g;
}

function addLabel(stack, str, size, color, weight, opts = {}) {
  const t = stack.addText(str);
  t.font = weight === 'bold' ? Font.boldRoundedSystemFont(size)
    : weight === 'semibold' ? Font.semiboldRoundedSystemFont(size)
    : weight === 'medium' ? Font.mediumRoundedSystemFont(size)
    : weight === 'light' ? Font.lightRoundedSystemFont(size)
    : Font.regularRoundedSystemFont(size);
  t.textColor = color;
  t.lineLimit = opts.lines || 1;
  if (opts.scale) t.minimumScaleFactor = opts.scale;
  return t;
}

function eventCard(parent, ev, compact) {
  const card = parent.addStack();
  card.layoutVertically();
  card.backgroundColor = cardFill;
  card.cornerRadius = compact ? 12 : 14;
  card.setPadding(compact ? 7 : 9, 10, compact ? 7 : 9, 10);
  const row = card.addStack();
  row.layoutHorizontally();
  const title = addLabel(row, ev.title, compact ? 13 : 14.5, text, 'semibold', { scale: 0.8 });
  row.addSpacer();
  card.addSpacer(2);
  addLabel(card, range(ev), compact ? 11.5 : 13, text2, 'medium');
  return card;
}

function taskCard(parent, t, now, compact) {
  const card = parent.addStack();
  card.layoutHorizontally();
  card.centerAlignContent();
  card.backgroundColor = cardFill;
  card.cornerRadius = compact ? 12 : 14;
  card.setPadding(compact ? 7 : 9, 10, compact ? 7 : 9, 10);
  const sym = SFSymbol.named('circle');
  sym.applyFont(Font.mediumSystemFont(13));
  const img = card.addImage(sym.image);
  img.imageSize = new Size(14, 14);
  img.tintColor = t.priority === 'high' ? ACCENT_2 : text2;
  card.addSpacer(7);
  const col = card.addStack();
  col.layoutVertically();
  addLabel(col, t.title, compact ? 13 : 14, text, 'semibold', { scale: 0.8 });
  const today = dayKey(now);
  if (t.due) addLabel(col, t.due < today ? 'Overdue' : t.due === today ? 'Due today' : 'Due ' + dayLabel(t.due, now).toLowerCase().replace(/^\w/, (c) => c.toUpperCase()), 11.5, t.due < today ? ACCENT_2 : text2, 'medium');
  card.addSpacer();
  return card;
}

function dateBlock(parent, now, bigSize) {
  addLabel(parent, WD[now.getDay()], 13, ACCENT, 'semibold');
  addLabel(parent, String(now.getDate()), bigSize, text, 'light');
}

function micPill(parent, label) {
  const pill = parent.addStack();
  pill.layoutHorizontally();
  pill.centerAlignContent();
  pill.backgroundColor = cardFill;
  pill.cornerRadius = 11;
  pill.setPadding(4, 8, 4, 9);
  const s = SFSymbol.named('mic.fill');
  s.applyFont(Font.semiboldSystemFont(11));
  const img = pill.addImage(s.image);
  img.imageSize = new Size(11, 11);
  img.tintColor = ACCENT;
  if (label) { pill.addSpacer(4); addLabel(pill, label, 11, text, 'semibold'); }
  return pill;
}

function messageWidget(w, title, body) {
  const s = SFSymbol.named('sparkle');
  const img = w.addImage(s.image);
  img.imageSize = new Size(22, 22);
  img.tintColor = ACCENT;
  w.addSpacer(8);
  addLabel(w, title, 15, text, 'semibold', { lines: 2 });
  w.addSpacer(3);
  addLabel(w, body, 12, text2, 'medium', { lines: 4 });
}

// ───────────── Layouts ─────────────
function buildSmall(w, data, now) {
  w.setPadding(14, 14, 14, 14);
  const top = w.addStack();
  top.layoutHorizontally();
  const date = top.addStack();
  date.layoutVertically();
  addLabel(date, WD[now.getDay()], 12, ACCENT, 'semibold');
  addLabel(date, String(now.getDate()), 30, text, 'light');
  top.addSpacer();
  micPill(top);
  w.addSpacer();

  const { label, list } = pickEvents(data.events, now, 1);
  const tasks = pickTasks(data.todos, now);
  if (list.length) {
    addLabel(w, label, 10, text2, 'semibold');
    w.addSpacer(4);
    eventCard(w, list[0], true);
  } else if (tasks.open.length) {
    addLabel(w, 'NEXT TASK', 10, text2, 'semibold');
    w.addSpacer(4);
    taskCard(w, tasks.open[0], now, true);
  } else {
    addLabel(w, 'All clear today', 14, text, 'semibold');
  }
  w.addSpacer(6);
  const n = tasks.due.length || tasks.open.length;
  addLabel(w, n ? `${n} ${tasks.due.length ? 'due' : 'open'} ${n === 1 ? 'task' : 'tasks'}` : 'No open tasks', 11, text2, 'medium');
}

function buildMedium(w, data, now) {
  w.setPadding(14, 16, 14, 14);
  const row = w.addStack();
  row.layoutHorizontally();

  const left = row.addStack();
  left.layoutVertically();
  left.size = new Size(78, 0);
  dateBlock(left, now, 40);
  left.addSpacer();
  const tasks = pickTasks(data.todos, now);
  const n = tasks.due.length || tasks.open.length;
  addLabel(left, n ? `${n} ${tasks.due.length ? 'due' : 'to do'}` : 'All clear', 11, text2, 'medium');
  left.addSpacer(5);
  micPill(left, 'Ask');

  row.addSpacer(10);
  const right = row.addStack();
  right.layoutVertically();
  const { label, list } = pickEvents(data.events, now, 2);
  addLabel(right, list.length ? label : 'UP NEXT', 11, text2, 'semibold');
  right.addSpacer(6);
  list.forEach((ev, i) => { if (i) right.addSpacer(6); eventCard(right, ev); });
  // Fill empty space with to-dos so the widget always feels useful.
  const room = 2 - list.length;
  tasks.open.slice(0, room).forEach((t, i) => { if (i || list.length) right.addSpacer(6); taskCard(right, t, now); });
  if (!list.length && !tasks.open.length) addLabel(right, 'Nothing planned. Tap to tell Tempo what’s next.', 13, text, 'medium', { lines: 3 });
  right.addSpacer();
}

function buildLarge(w, data, now) {
  w.setPadding(16, 16, 16, 16);
  const head = w.addStack();
  head.layoutHorizontally();
  head.bottomAlignContent();
  const date = head.addStack();
  date.layoutVertically();
  dateBlock(date, now, 40);
  head.addSpacer();
  micPill(head, 'Ask Tempo');
  w.addSpacer(10);

  const { label, list } = pickEvents(data.events, now, 3);
  addLabel(w, list.length ? label : 'NOTHING SCHEDULED', 11, text2, 'semibold');
  w.addSpacer(6);
  list.forEach((ev, i) => { if (i) w.addSpacer(6); eventCard(w, ev); });
  w.addSpacer(12);

  const tasks = pickTasks(data.todos, now);
  addLabel(w, 'TO DO', 11, text2, 'semibold');
  w.addSpacer(6);
  const show = tasks.open.slice(0, Math.max(1, 4 - list.length));
  if (!show.length) addLabel(w, 'No open tasks. Nice.', 13, text, 'medium');
  show.forEach((t, i) => { if (i) w.addSpacer(6); taskCard(w, t, now); });
  w.addSpacer();
}

// ───────────── Main ─────────────
async function buildWidget(family) {
  const w = new ListWidget();
  background(w);
  const now = new Date();
  const param = (args.widgetParameter || '').trim().toLowerCase();
  w.url = param === 'app' ? APP_URL : `shortcuts://run-shortcut?name=${encodeURIComponent(SHORTCUT_NAME)}`;
  // Refresh roughly every 15 minutes (iOS decides the exact timing).
  w.refreshAfterDate = new Date(now.getTime() + 15 * 60 * 1000);

  const data = await loadData();
  if (data.error === 'setup') {
    w.setPadding(14, 14, 14, 14);
    w.url = URLScheme.forRunningScript();
    messageWidget(w, 'Connect Tempo', 'Tap here, then paste your Web app URL and App key.');
    return w;
  }
  if (!data.events) {
    w.setPadding(14, 14, 14, 14);
    messageWidget(w, 'Can’t reach Tempo', data.error === 'offline' ? 'Check your connection. It will try again soon.' : String(data.error));
    return w;
  }
  if (family === 'large') buildLarge(w, data, now);
  else if (family === 'medium') buildMedium(w, data, now);
  else buildSmall(w, data, now);
  return w;
}

if (config.runsInWidget) {
  Script.setWidget(await buildWidget(config.widgetFamily));
} else {
  const hasConn = Keychain.contains(KEY_URL) && Keychain.contains(KEY_KEY);
  let choice = 0;
  if (hasConn) {
    const a = new Alert();
    a.title = 'Tempo widget';
    a.addAction('Preview small');
    a.addAction('Preview medium');
    a.addAction('Preview large');
    a.addAction('Change connection');
    a.addCancelAction('Done');
    choice = await a.presentSheet();
  } else {
    choice = (await askForConnection()) ? 1 : -1;
  }
  if (choice === 3) { if (await askForConnection()) choice = 1; else choice = -1; }
  if (choice >= 0 && choice <= 2) {
    const fam = ['small', 'medium', 'large'][choice];
    const w = await buildWidget(fam);
    if (fam === 'small') await w.presentSmall();
    else if (fam === 'medium') await w.presentMedium();
    else await w.presentLarge();
  }
}
Script.complete();
