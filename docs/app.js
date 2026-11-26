/* Tempo — app logic. Plain JavaScript, no build step. */
(function () {
  'use strict';

  // ───────────── Storage (wrapped: private mode can throw) ─────────────
  const store = {
    get(k, d) { try { const v = localStorage.getItem('tempo.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('tempo.' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
    del(k) { try { localStorage.removeItem('tempo.' + k); } catch (e) { /* ignore */ } }
  };

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const state = {
    conn: store.get('conn', null),          // { url, key }
    name: store.get('name', ''),
    data: store.get('snapshot', null),      // { events, todos, now }
    history: store.get('history', []),      // [{ role, text }]
    view: store.get('view', 'today'),
    expanded: store.get('expanded', []),   // task ids whose steps are unfolded
    pinned: null,                          // step picked from the momentum nudge
    doneOpen: false,
    editing: null
  };

  // ───────────── Dates ─────────────
  const pad = (n) => String(n).padStart(2, '0');
  const localISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const dayKey = (d) => localISO(d).slice(0, 10);
  const parse = (s) => { const [d, t = '00:00'] = s.split('T'); const [y, m, dd] = d.split('-').map(Number); const [h, mi] = t.split(':').map(Number); return new Date(y, m - 1, dd, h, mi); };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const timeFmt = (d) => { let h = d.getHours(); const m = d.getMinutes(); const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12; return m ? `${h}:${pad(m)}` : `${h}`; };
  const ampm = (d) => (d.getHours() >= 12 ? 'PM' : 'AM');
  const timeFull = (d) => `${timeFmt(d)} ${ampm(d).toLowerCase()}`;
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const WDL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function relDay(key) {
    const today = dayKey(new Date());
    if (key === today) return 'Today';
    if (key === dayKey(addDays(new Date(), 1))) return 'Tomorrow';
    if (key === dayKey(addDays(new Date(), -1))) return 'Yesterday';
    const d = parse(key);
    const diff = Math.round((d - parse(today)) / 86400000);
    if (diff > 1 && diff < 7) return WD[d.getDay()];
    return `${MON[d.getMonth()]} ${d.getDate()}`;
  }
  function durationText(ms) {
    const m = Math.round(ms / 60000);
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60), r = m % 60;
    return r ? `${h} hr ${r} min` : `${h} hr`;
  }

  // ───────────── Weekly colors: a new palette every Monday ─────────────
  // The week number counts Mondays since Jan 1 2024 (a Monday), so every
  // device picks the same palette and it changes at midnight Sunday → Monday.
  // light/dark: the accent color for text and links in each mode.
  // g: the three gradient stops. t: panel tints (Do this next, Focus, Break it down, Done).
  const PALETTES = [
    { name: 'Iris', light: '#6d5dfc', dark: '#9d90ff', a2: '#ff7a59', g: ['#7b6cff', '#c26bff', '#ff8a5c'], t: ['#7b6cff', '#ff7a59', '#2f8fff', '#1fa37a'] },
    { name: 'Lagoon', light: '#0a74a6', dark: '#5cc8f0', a2: '#ff8a4c', g: ['#2b6fff', '#16a9c9', '#4fd1a0'], t: ['#2b7fff', '#ff8a4c', '#14a9c2', '#16a36e'] },
    { name: 'Ember', light: '#cf4426', dark: '#ff8c6b', a2: '#7b6cff', g: ['#ff4e6a', '#ff8a3d', '#ffbf57'], t: ['#f5803a', '#7b6cff', '#e0a21b', '#1fa37a'] },
    { name: 'Sage', light: '#23805f', dark: '#6fd3a8', a2: '#e0873a', g: ['#1e8f6e', '#46b487', '#b8d46a'], t: ['#1e8f6e', '#e0873a', '#3b82f6', '#65a30d'] },
    { name: 'Rose', light: '#c2306a', dark: '#ff7fae', a2: '#8b5cf6', g: ['#e8487f', '#f06fa8', '#ffab76'], t: ['#e8487f', '#f58246', '#8b5cf6', '#1fa37a'] },
    { name: 'Dusk', light: '#4f46e5', dark: '#a5a1ff', a2: '#f59e0b', g: ['#4f46e5', '#9b51e0', '#f5a00b'], t: ['#5b52f0', '#f59e0b', '#06b6d4', '#1fa37a'] }
  ];
  // Blend two #rrggbb colors: mix(a, b, .2) is 80% a and 20% b.
  const mix = (a, b, w) => { const x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16);
    const c = (sh) => Math.round(((x >> sh) & 255) * (1 - w) + ((y >> sh) & 255) * w);
    return '#' + ((1 << 24) + (c(16) << 16) + (c(8) << 8) + c(0)).toString(16).slice(1); };
  const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return `${n >> 16}, ${(n >> 8) & 255}, ${n & 255}`; };
  function weekIndex(d) {
    const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(2024, 0, 1)) / 86400000);
    return Math.floor(days / 7);
  }
  const paletteFor = (d) => PALETTES[((weekIndex(d) % PALETTES.length) + PALETTES.length) % PALETTES.length];
  let paletteShown = null;
  function applyPalette() {
    const p = paletteFor(new Date());
    if (paletteShown === p.name) return;
    paletteShown = p.name;
    const [g1, g2, g3] = p.g;
    // Each theme tints the whole app, not just the accents: the page, the
    // cards, the lines and the bottom bar all lean toward the week's colors.
    const common = `--accent-2:${p.a2};--a2:${rgb(p.a2)};--glow:${rgb(g2)};--g1:${rgb(g1)};--g2:${rgb(g2)};--g3:${rgb(g3)};` +
      `--grad:linear-gradient(135deg, ${g1} 0%, ${g2} 48%, ${g3} 100%);` +
      `--t-next:${rgb(p.t[0])};--t-focus:${rgb(p.t[1])};--t-break:${rgb(p.t[2])};--t-done:${rgb(p.t[3])};`;
    // Surfaces stay neutral; only a whisper of the theme color reaches them.
    const light = `--accent:${p.light};--accent-soft:rgba(${rgb(p.light)}, .12);` +
      `--bg:${mix('#f7f6f3', g1, .025)};--line:rgba(20, 16, 40, .09);` +
      `--aurora-a:rgba(${rgb(g1)}, .3);--aurora-b:rgba(${rgb(g3)}, .22);--aurora-c:rgba(${rgb(g2)}, .16);`;
    const dark = `--accent:${p.dark};--accent-soft:rgba(${rgb(p.dark)}, .15);` +
      `--bg:${mix('#09090c', g1, .025)};--bg-2:#0e0e12;` +
      `--surface:rgba(${rgb(mix('#17171c', g1, .03))}, .92);--surface-solid:${mix('#18181d', g1, .03)};` +
      `--surface-2:rgba(255, 255, 255, .045);--line:rgba(255, 255, 255, .085);` +
      `--text-2:#b3b1bb;--text-3:#7c7a86;--dock:rgba(${rgb(mix('#1a1a20', g1, .03))}, .95);` +
      `--shadow:0 1px 0 rgba(255, 255, 255, .05) inset, 0 14px 32px -14px rgba(0, 0, 0, .85);` +
      `--aurora-a:rgba(${rgb(g1)}, .28);--aurora-b:rgba(${rgb(g3)}, .12);--aurora-c:rgba(${rgb(g2)}, .14);`;
    let el = document.getElementById('paletteStyle');
    if (!el) { el = document.createElement('style'); el.id = 'paletteStyle'; document.head.appendChild(el); }
    el.textContent = `:root{${common}${light}}` +
      `@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${dark}}}` +
      `:root[data-theme="dark"]{${dark}}`;
    document.documentElement.dataset.palette = p.name.toLowerCase();
    // Match the phone's status bar to the tinted page.
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
      m.content = (m.media || '').includes('dark') ? mix('#09090c', g1, .025) : mix('#f7f6f3', g1, .025);
    });
  }

  // ───────────── Sample data (preview before connecting) ─────────────
  function sampleData() {
    const t = new Date(); const k = (n) => dayKey(addDays(t, n));
    const ev = (id, title, day, s, e, cal, color, loc) => ({ id, title, start: `${k(day)}T${s}`, end: `${k(day)}T${e}`, all_day: false, location: loc || '', calendar: cal, color, editable: cal === 'Personal' });
    return {
      sample: true,
      events: [
        ev('s1', 'Organic Chemistry', 0, '09:30', '10:45', 'School', '#3b82f6', 'Science Hall 204'),
        ev('s2', 'Lunch with Sam', 0, '12:30', '13:30', 'Personal', '#a78bfa', 'Campus Café'),
        ev('s3', 'Study: Bio exam', 0, '16:00', '18:00', 'Personal', '#a78bfa', 'Library, 3rd floor'),
        ev('s4', 'Gym', 0, '19:30', '20:30', 'Personal', '#a78bfa'),
        ev('s5', 'Statistics', 1, '11:00', '12:15', 'School', '#3b82f6', 'Hamilton 110'),
        ev('s6', 'Office hours — Prof. Lee', 2, '14:00', '14:30', 'School', '#3b82f6'),
        ev('s7', 'Bio midterm', 3, '10:00', '11:30', 'School', '#3b82f6'),
        ev('s8', 'Dinner with family', 4, '18:30', '20:30', 'Personal', '#a78bfa')
      ],
      todos: [
        { id: 'w1', title: 'Email TA about lab partner', due: k(-1), priority: 'normal', done: true, minutes: 5, parent: '', notes: '', completed: k(-1) + 'T15:10' },
        { id: 'w2', title: 'Print the reading', due: k(-1), priority: 'normal', done: true, minutes: 5, parent: '', notes: '', completed: k(-1) + 'T18:40' },
        { id: 'w3', title: 'Laundry', due: '', priority: 'low', done: true, minutes: 20, parent: '', notes: '', completed: k(-2) + 'T20:00' },
        { id: 'w4', title: 'Submit stats homework', due: k(-3), priority: 'high', done: true, minutes: 45, parent: '', notes: '', completed: k(-3) + 'T21:15' },
        { id: 'a1', title: 'Finish lab report draft', due: k(0), priority: 'high', done: false, minutes: 90, parent: '', notes: '' },
        { id: 'a2', title: 'Outline intro + methods', due: k(0), priority: 'normal', done: true, minutes: 30, parent: 'a1', notes: '', completed: k(0) + 'T08:50' },
        { id: 'a3', title: 'Open the data sheet and pick the two columns', due: k(0), priority: 'normal', done: false, minutes: 5, parent: 'a1', notes: '' },
        { id: 'a8', title: 'Make the two graphs', due: k(0), priority: 'normal', done: false, minutes: 20, parent: 'a1', notes: '' },
        { id: 'a9', title: 'Write the results paragraph', due: k(0), priority: 'normal', done: false, minutes: 15, parent: 'a1', notes: '' },
        { id: 'a4', title: 'Email Prof. Lee about extension', due: k(-1), priority: 'normal', done: false, minutes: 10, parent: '', notes: '' },
        { id: 'a5', title: 'Review chapters 7–9 for Bio', due: k(2), priority: 'high', done: false, minutes: 120, parent: '', notes: '' },
        { id: 'a6', title: 'Pay phone bill', due: k(5), priority: 'low', done: false, minutes: null, parent: '', notes: '', remind: k(5) + 'T09:00' },
        { id: 'a7', title: 'Return library books', due: '', priority: 'normal', done: false, minutes: null, parent: '', notes: '' }
      ]
    };
  }
  const isConnected = () => !!(state.conn && state.conn.url && state.conn.key);
  const data = () => (isConnected() && state.data && !state.data.sample ? state.data : (state._sample = state._sample || sampleData()));

  // ───────────── Backend ─────────────
  // The phone's time zone, so the brain stamps times the way you see them.
  const LOCAL_TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; } })();
  async function api(action, payload = {}) {
    if (!isConnected()) throw new Error('Not connected');
    let res;
    try {
      res = await fetch(state.conn.url, {
      method: 'POST',
      // text/plain avoids a CORS pre-flight, which Apps Script does not answer.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ key: state.conn.key, action, tz: LOCAL_TZ }, payload)),
      redirect: 'follow'
      });
    } catch (e) {
      throw new Error('Couldn’t reach your Tempo brain. Check you’re online and that the web app URL is the one ending in /exec (not /dev).');
    }
    if (!res.ok) throw new Error(`Server error (${res.status}). Check the web app URL ends in /exec.`);
    const raw = await res.text();
    let json;
    try { json = JSON.parse(raw); }
    catch (e) {
      throw new Error('Google sent back a sign-in page instead of Tempo. In Apps Script, open Deploy → Manage deployments and make sure "Who has access" is "Anyone", and that you copied the URL ending in /exec.');
    }
    if (!json.ok) throw new Error(json.error || 'Something went wrong');
    if (json.events && json.todos) {
      state.data = { events: json.events, todos: json.todos, now: json.now, reminders: json.reminders || null };
      store.set('snapshot', state.data);
    }
    return json;
  }

  // fresh: ask the brain to read Google Calendar again instead of using
  // its 90-second copy (used by pull-to-sync).
  async function refresh(quiet, fresh) {
    if (!isConnected()) { render(); return true; }
    try { await api('today', fresh ? { fresh: true } : {}); render(); return true; }
    catch (e) { if (!quiet) toast(e.message); return false; }
  }

  // ───────────── Rendering ─────────────
  function render() {
    applyPalette();
    renderHeader();
    renderBrief();
    renderToday();
    renderTasks();
    $('#demoBanner').hidden = isConnected();
  }

  function renderHeader() {
    const now = new Date();
    $('#dateLine').textContent = `${WDL[now.getDay()]}, ${MON[now.getMonth()]} ${now.getDate()}`;
    const h = now.getHours();
    const part = h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    const name = state.name || 'there';
    $('#greeting').innerHTML = `${part},<br><em>${esc(name)}</em>`;

    const d = data();
    const today = dayKey(now);
    const todays = d.events.filter((e) => e.start.slice(0, 10) === today && parse(e.end) > now);
    const open = topLevel(d.todos.filter((t) => !t.done));
    const dueToday = open.filter((t) => t.due && t.due <= today);
    const bits = [];
    bits.push(todays.length ? `${todays.length} ${todays.length === 1 ? 'event' : 'events'} left today` : 'Nothing else on the calendar today');
    bits.push(dueToday.length ? `${dueToday.length} ${dueToday.length === 1 ? 'task' : 'tasks'} due` : `${open.length} open ${open.length === 1 ? 'task' : 'tasks'}`);
    $('#summary').textContent = bits.join(' · ');
  }

  function renderToday() {
    const d = data();
    const now = new Date();

    // Up next
    const upcomingTimed = d.events.filter((e) => !e.all_day && parse(e.end) > now).sort((a, b) => a.start.localeCompare(b.start));
    const next = upcomingTimed[0];
    const hero = $('#upNext');
    if (next) {
      const s = parse(next.start), e = parse(next.end);
      const live = s <= now;
      const dayLabel = relDay(next.start.slice(0, 10));
      hero.className = 'hero card';
      hero.innerHTML = `
        <div class="label">${live ? '<span class="live"></span>Happening now' : 'Up next'}</div>
        <h3>${esc(next.title)}</h3>
        <div class="meta">${dayLabel === 'Today' ? '' : esc(dayLabel) + ' · '}${timeFull(s)} – ${timeFull(e)}${next.location ? ' · ' + esc(next.location) : ''}</div>
        <div class="countdown">${live ? `Ends in <b>${durationText(e - now)}</b>` : `Starts in <b>${durationText(s - now)}</b>`}</div>`;
    } else {
      hero.className = 'hero card empty';
      hero.innerHTML = `<div class="label">Up next</div><h3>Your week is wide open.</h3><div class="meta">Tap the mic and tell Tempo what you want to get done.</div>`;
    }

    // Focus: top open tasks
    const open = topLevel(d.todos.filter((t) => !t.done));
    const focus = open.sort(taskOrder).slice(0, 3);
    $('#focusList').innerHTML = focus.length ? focus.map((t) => taskHTML(t, d.todos)).join('') : `<li class="empty-note">All clear. Nothing urgent.</li>`;

    renderNextStep(d);
    renderBreaker(d);
    renderDone(d);
  }

  // ───────────── Morning brief / Evening recap ─────────────
  // Morning (4 am to noon): the shape of the day. Evening (5 pm to midnight):
  // what got done, what's left, and how tomorrow starts. Built on the phone
  // from the data it already has, so it's instant and costs nothing.
  const SUN_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/></svg>';
  const MOON_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/></svg>';
  const FOLD_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>';
  function briefKind(now) {
    const h = now.getHours();
    return h >= 4 && h < 12 ? 'morning' : h >= 17 ? 'evening' : null;
  }
  const eventTime = (e) => (e.all_day ? 'All day' : timeFull(parse(e.start)));
  function eventRow(e, now) {
    const past = !e.all_day && parse(e.end) <= now;
    return `<li class="${past ? 'past' : ''}"><time>${esc(eventTime(e))}</time><span class="bt">${esc(e.title)}</span>${e.location ? `<span class="bm">${esc(e.location)}</span>` : ''}</li>`;
  }
  const byStart = (a, b) => (a.all_day === b.all_day ? a.start.localeCompare(b.start) : a.all_day ? -1 : 1);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;
  function freeWindow(timed, now) {
    // Longest open stretch between now (or 8 am) and 10 pm today.
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let cur = new Date(Math.max(now, new Date(day.getTime() + 8 * 3600000)));
    const end = new Date(day.getTime() + 22 * 3600000);
    let best = null;
    const busy = timed.map((e) => [parse(e.start), parse(e.end)]).sort((a, b) => a[0] - b[0]);
    busy.concat([[end, end]]).forEach(([s, e]) => {
      if (s > cur) {
        const gapEnd = s < end ? s : end;
        if (gapEnd - cur > 0 && (!best || gapEnd - cur > best[1] - best[0])) best = [new Date(cur), gapEnd];
      }
      if (e > cur) cur = e;
    });
    return best && best[1] - best[0] >= 45 * 60000 ? best : null;
  }
  function renderBrief() {
    const box = $('#brief');
    const now = new Date();
    const kind = briefKind(now);
    if (!kind) { box.hidden = true; return; }
    const d = data();
    const today = dayKey(now);
    const tag = `${today}:${kind}`;
    const folded = store.get('briefFolded', '') === tag;
    const todays = d.events.filter((e) => e.start.slice(0, 10) === today || (e.all_day && e.start.slice(0, 10) < today && e.end.slice(0, 10) > today)).sort(byStart);
    const timed = todays.filter((e) => !e.all_day);
    const open = topLevel(d.todos.filter((t) => !t.done));
    const dueToday = open.filter((t) => t.due === today);
    const overdue = open.filter((t) => t.due && t.due < today);
    let html;
    if (kind === 'morning') {
      const first = timed.find((e) => parse(e.end) > now);
      const lead = (timed.length
        ? `${plural(timed.length, 'event')} on the calendar${first ? `, starting with ${esc(first.title)} at ${esc(timeFull(parse(first.start)))}` : ''}.`
        : 'Nothing on the calendar. A clear runway.') +
        (dueToday.length ? ` ${plural(dueToday.length, 'task')} due today.` : '');
      const focus = (dueToday.length || overdue.length ? overdue.concat(dueToday) : open).slice().sort(taskOrder).slice(0, 3);
      const win = freeWindow(timed, now);
      html = `
        <div class="brief-top"><p class="brief-kicker">${SUN_SVG}Morning brief</p><button class="brief-fold" data-brief-fold aria-label="${folded ? 'Show brief' : 'Hide brief'}">${FOLD_SVG}</button></div>
        <h3>Here’s your <em>${WDL[now.getDay()]}</em>.</h3>
        <div class="brief-body">
          <p class="brief-lead">${lead}</p>
          <div class="brief-stats">
            <div><b>${timed.length}</b><span>${timed.length === 1 ? 'Event' : 'Events'}</span></div>
            <div><b>${dueToday.length}</b><span>Due today</span></div>
            <div class="${overdue.length ? 'warn' : ''}"><b>${overdue.length}</b><span>Overdue</span></div>
          </div>
          ${todays.length ? `<div class="brief-sec"><h4>Schedule</h4><ul>${todays.slice(0, 5).map((e) => eventRow(e, now)).join('')}${todays.length > 5 ? `<li class="more">+${todays.length - 5} more</li>` : ''}</ul></div>` : ''}
          ${focus.length ? `<div class="brief-sec"><h4>Focus first</h4><ul>${focus.map((t) => `<li><time>${t.due && t.due < today ? 'Overdue' : t.due === today ? 'Today' : t.due ? esc(relDay(t.due)) : 'Anytime'}</time><span class="bt">${esc(t.title)}</span>${t.minutes ? `<span class="bm">${minText(t.minutes)}</span>` : ''}</li>`).join('')}</ul></div>` : ''}
          ${win ? `<p class="brief-note">Best stretch for deep work: <b>${esc(timeFull(win[0]))} – ${esc(timeFull(win[1]))}</b>.</p>` : ''}
        </div>`;
    } else {
      const done = doneOn(d, today);
      const tomorrow = dayKey(addDays(now, 1));
      const tmrEvents = d.events.filter((e) => e.start.slice(0, 10) === tomorrow).sort(byStart);
      const tmrDue = open.filter((t) => t.due === tomorrow);
      const left = overdue.concat(dueToday).sort(taskOrder);
      const heldEvents = timed.filter((e) => parse(e.start) <= now).length;
      const lead = done.length
        ? `${heldEvents ? `${plural(heldEvents, 'event')} on the calendar and ` : ''}${plural(done.length, 'check-off')}. Every one counts.`
        : `${heldEvents ? `${plural(heldEvents, 'event')} on the calendar. ` : ''}Nothing checked off, and that’s okay. Tomorrow’s a fresh start.`;
      html = `
        <div class="brief-top"><p class="brief-kicker">${MOON_SVG}Evening recap</p><button class="brief-fold" data-brief-fold aria-label="${folded ? 'Show recap' : 'Hide recap'}">${FOLD_SVG}</button></div>
        <h3>${done.length ? `You got <em>${done.length}</em> ${done.length === 1 ? 'thing' : 'things'} done.` : 'A <em>quiet</em> day.'}</h3>
        <div class="brief-body">
          <p class="brief-lead">${lead}</p>
          <div class="brief-stats">
            <div><b>${done.length}</b><span>Done</span></div>
            <div><b>${timed.length}</b><span>${timed.length === 1 ? 'Event' : 'Events'}</span></div>
            <div class="${left.length ? 'warn' : ''}"><b>${left.length}</b><span>Still open</span></div>
          </div>
          ${done.length ? `<div class="brief-sec"><h4>Finished</h4><ul>${done.slice(0, 4).map((t) => `<li>${CHECK_SVG.replace('<svg', '<svg class="ok"')}<span class="bt">${esc(t.title)}</span><span class="bm">${esc(timeFull(parse(t.completed)))}</span></li>`).join('')}${done.length > 4 ? `<li class="more">+${done.length - 4} more</li>` : ''}</ul></div>` : ''}
          ${left.length ? `<div class="brief-sec"><h4>Carry over</h4><ul>${left.slice(0, 3).map((t) => `<li><time>${t.due < today ? 'Overdue' : 'Today'}</time><span class="bt">${esc(t.title)}</span></li>`).join('')}${left.length > 3 ? `<li class="more">+${left.length - 3} more</li>` : ''}</ul></div>` : ''}
          <div class="brief-sec"><h4>Tomorrow</h4><ul>${tmrEvents.length ? tmrEvents.slice(0, 3).map((e) => eventRow(e, now)).join('') : '<li class="more">Nothing on the calendar yet.</li>'}${tmrDue.length ? `<li class="more">${plural(tmrDue.length, 'task')} due</li>` : ''}</ul></div>
        </div>`;
    }
    box.className = 'brief' + (folded ? ' folded' : '');
    box.dataset.tag = tag;
    box.innerHTML = html;
    box.hidden = false;
  }

  // ───────────── Do this next: one small step, nothing else ─────────────
  // Walk the tasks in focus order. A task with steps offers its first
  // unfinished step; a task without steps offers itself. A step picked from
  // the momentum nudge ("Let's go") goes to the front.
  const skipped = new Set();
  const stepsOf = (d, id) => d.todos.filter((s) => s.parent === id);
  function candidateFor(d, t) {
    if (t.parent) {
      const parent = d.todos.find((p) => p.id === t.parent);
      const subs = stepsOf(d, t.parent);
      return { todo: t, parent, n: subs.indexOf(t) + 1, of: subs.length, doneCount: subs.filter((x) => x.done).length };
    }
    const subs = stepsOf(d, t.id);
    const openSub = subs.find((x) => !x.done);
    if (openSub) return candidateFor(d, openSub);
    return { todo: t, parent: null, allSteps: subs.length };
  }
  function nextCandidates(d) {
    const out = topLevel(d.todos.filter((t) => !t.done)).sort(taskOrder).map((t) => candidateFor(d, t));
    const pin = state.pinned && d.todos.find((t) => t.id === state.pinned && !t.done);
    if (pin) {
      const c = candidateFor(d, pin);
      return [c].concat(out.filter((o) => o.todo.id !== c.todo.id));
    }
    return out;
  }
  function renderNextStep(d) {
    const box = $('#nextStep');
    const all = nextCandidates(d);
    let list = all.filter((c) => !skipped.has(c.todo.id));
    if (!list.length && all.length) { skipped.clear(); list = all; }
    const c = list[0];
    if (!c) {
      box.className = 'next-step empty';
      box.innerHTML = `<h3>Nothing waiting on you.</h3><p class="ns-sub">Enjoy it, or tell Tempo what’s next.</p>`;
      return;
    }
    const t = c.todo;
    const sub = c.parent
      ? `Step ${c.n} of ${c.of} · ${esc(c.parent.title)}`
      : c.allSteps ? 'All the steps are done. Finish it off.' : t.minutes ? `About ${minText(t.minutes)}` : '';
    const big = !c.parent && !c.allSteps && (t.minutes ? t.minutes >= 30 : t.priority === 'high');
    box.className = 'next-step' + (state.pinned === t.id ? ' started' : '');
    box.dataset.id = t.id;
    box.innerHTML = `
      ${state.pinned === t.id ? '<p class="ns-kicker">You’re on it</p>' : ''}
      <h3>${esc(t.title)}</h3>
      ${sub ? `<p class="ns-sub">${sub}</p>` : ''}
      ${c.parent ? progressHTML(c.doneCount, c.of) : ''}
      ${big ? '<p class="ns-hint">Feels like a lot? Break it into tiny steps first.</p>' : ''}
      <div class="ns-btns">
        <button class="ns-done" data-ns="done">${CHECK_SVG}<span>Done</span></button>
        ${big ? '<button class="ns-alt" data-ns="break"><span class="spark" aria-hidden="true"></span>Break it down</button>' : ''}
        ${list.length > 1 ? '<button class="ns-skip" data-ns="skip">Not now</button>' : ''}
      </div>`;
  }
  function progressHTML(done, of) {
    const pct = of ? Math.round((done / of) * 100) : 0;
    return `<div class="progress${done === of ? ' full' : ''}" role="progressbar" aria-valuemin="0" aria-valuemax="${of}" aria-valuenow="${done}" aria-label="${done} of ${of} steps done">
      <div class="bar"><i style="width:${pct}%"></i></div><span>${done} of ${of} steps</span></div>`;
  }
  const minText = (m) => (m < 60 ? `${m} min` : `${(m / 60).toFixed(m % 60 ? 1 : 0)} hr`);

  // ───────────── Break it down ─────────────
  function renderBreaker(d) {
    // Suggest big open tasks that don't have steps yet.
    const picks = topLevel(d.todos.filter((t) => !t.done))
      .filter((t) => !d.todos.some((s) => s.parent === t.id) && (t.minutes ? t.minutes >= 45 : t.priority === 'high'))
      .sort(taskOrder).slice(0, 3);
    $('#breakPicks').innerHTML = picks.length
      ? `<p class="picks-label">Or pick one of these</p>` + picks.map((t) =>
        `<button class="pick" data-break="${esc(t.id)}"><span class="spark" aria-hidden="true"></span><span class="pick-title">${esc(t.title)}</span>${t.minutes ? `<span class="pick-meta">${minText(t.minutes)}</span>` : ''}</button>`).join('')
      : '';
  }
  function breakDown(t) {
    if (!t) return;
    const f = breakFile;
    sendBreak(f
      ? `Break "${t.title}" into small steps and add them as sub-tasks. Use the attached file (${f.name}) for the details.`
      : `Break "${t.title}" into small steps and add them as sub-tasks.`);
  }
  function breakNew(title) {
    const f = breakFile;
    if (!title && !f) return;
    sendBreak(!f
      ? `I need to: ${title}. Add it as a task and break it into small steps as sub-tasks.`
      : title
        ? `I need to: ${title}. The attached file (${f.name}) has the details. Add it as a task and break it into small steps as sub-tasks, based on the file.`
        : `Here is a file (${f.name}). Work out what I need to do from it, add it as a task, and break it into small steps as sub-tasks.`);
  }
  async function sendBreak(text) {
    const f = breakFile;
    const ok = await ask(text, f);
    if (ok && f && breakFile === f) setBreakFile(null);
  }

  // A photo, PDF or document to break down (an assignment sheet, a syllabus…).
  const MAX_FILE_MB = 15;
  let breakFile = null; // { name, type, data (base64) }
  function setBreakFile(f) {
    breakFile = f;
    $('#breakFileChip').hidden = !f;
    $('#breakFileName').textContent = f ? f.name : '';
    $('#breakAttach').classList.toggle('on', !!f);
    $('#breakInput').placeholder = f ? 'What’s it for? (optional)' : 'What feels too big?';
    if (!f) $('#breakFile').value = '';
  }
  async function loadFile(file) {
    hint('Getting your file ready…');
    try {
      const f = /^image\//.test(file.type) ? await shrinkImage(file) : await readFileB64(file);
      if (f.data.length * 0.75 > MAX_FILE_MB * 1024 * 1024) throw new Error(`That file is over ${MAX_FILE_MB} MB. Try a smaller one, or a photo of the page.`);
      return f;
    } finally { hint(''); }
  }
  async function pickBreakFile(file) {
    if (!file) return;
    try { setBreakFile(await loadFile(file)); }
    catch (e) { setBreakFile(null); toast(e.message || 'Couldn’t read that file.'); }
  }

  // The same, for anything typed or said in the Ask Tempo bar (a flyer, a schedule…).
  let dockFile = null;
  function setDockFile(f) {
    dockFile = f;
    $('#dockFileChip').hidden = !f;
    $('#dockFileName').textContent = f ? f.name : '';
    $('#dockAttach').classList.toggle('on', !!f);
    $('#prompt').placeholder = f ? 'Ask Tempo about it' : 'Ask Tempo';
    if (!f) $('#dockFile').value = '';
    syncMic();
  }
  async function pickDockFile(file) {
    if (!file) return;
    try { setDockFile(await loadFile(file)); }
    catch (e) { setDockFile(null); toast(e.message || 'Couldn’t read that file.'); }
  }
  async function sendPrompt(raw) {
    const text = (raw || '').trim();
    const f = dockFile;
    if (!f) return ask(text);
    const msg = text
      ? `${text}\n\n(Attached file: ${f.name})`
      : `Here is a file (${f.name}). Look at it and add any events or tasks it calls for, then tell me what you did.`;
    const ok = await ask(msg, f);
    if (ok && dockFile === f) setDockFile(null);
    return ok;
  }
  function readFileB64(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve({ name: file.name || 'file', type: file.type || '', data: String(r.result).split(',')[1] || '' });
      r.onerror = () => reject(new Error('Couldn’t read that file.'));
      r.readAsDataURL(file);
    });
  }
  // Phone photos are huge. Shrink to a size Claude reads just as well, as a JPEG.
  function shrinkImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const MAX = 2000;
        const k = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
        const g = c.getContext('2d');
        g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
        g.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        const name = (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg';
        resolve({ name, type: 'image/jpeg', data: c.toDataURL('image/jpeg', 0.85).split(',')[1] });
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Couldn’t open that photo. Try a screenshot of it instead.')); };
      img.src = url;
    });
  }

  // ───────────── Done today: proof of what actually got finished ─────────────
  const DONE_PREVIEW = 5;
  function doneOn(d, day) {
    return d.todos.filter((t) => t.done && t.completed && t.completed.slice(0, 10) === day)
      .sort((a, b) => b.completed.localeCompare(a.completed));
  }
  function renderDone(d) {
    const today = dayKey(new Date());
    const list = doneOn(d, today);
    $('#doneTitle').innerHTML = `Done today${list.length ? ` <span class="count">${list.length}</span>` : ''}`;
    const box = $('#doneList');
    if (!list.length) {
      const y = doneOn(d, dayKey(addDays(new Date(), -1))).length;
      box.innerHTML = `<p class="done-empty">${y ? `Nothing yet today. Yesterday you finished ${y} ${y === 1 ? 'thing' : 'things'}, so you know you can.` : 'What you finish today lands here.'}</p>`;
      return;
    }
    const open = !!state.doneOpen;
    const shown = open ? list : list.slice(0, DONE_PREVIEW);
    box.innerHTML = `<ul>${shown.map((t) => {
      const parent = t.parent && d.todos.find((p) => p.id === t.parent);
      return `<li>${CHECK_SVG}<div><span class="dl-title">${esc(t.title)}</span>${parent ? `<span class="dl-sub">Step of ${esc(parent.title)}</span>` : ''}</div><time>${esc(timeFull(parse(t.completed)))}</time></li>`;
    }).join('')}</ul>
      ${list.length > DONE_PREVIEW ? `<button class="more-btn" data-done-more>${open ? 'Show less' : `Show ${list.length - DONE_PREVIEW} more`}</button>` : ''}`;
  }

  const topLevel = (list) => list.filter((t) => !t.parent);
  const priRank = { high: 0, normal: 1, low: 2 };
  function taskOrder(a, b) {
    const ad = a.due || '9999', bd = b.due || '9999';
    if (ad !== bd) return ad.localeCompare(bd);
    return (priRank[a.priority] ?? 1) - (priRank[b.priority] ?? 1);
  }

  const CHECK_SVG = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const BELL_SVG = '<svg class="bell" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16zM10 20.5a2 2 0 0 0 4 0"/></svg>';
  function taskHTML(t, all, isSub) {
    const today = dayKey(new Date());
    const tags = [];
    if (t.due) {
      const cls = !t.done && t.due < today ? 'overdue' : t.due === today ? 'today' : '';
      tags.push(`<span class="tag ${cls}">${cls === 'overdue' ? 'Overdue · ' : ''}${esc(relDay(t.due))}</span>`);
    }
    if (t.remind && !t.done && !t.reminded) {
      const r = parse(t.remind);
      tags.push(`<span class="tag remind">${BELL_SVG}${t.remind.slice(0, 10) === t.due ? '' : esc(relDay(t.remind.slice(0, 10))) + ' '}${esc(timeFull(r))}</span>`);
    }
    if (t.priority === 'high' && !t.done) tags.push('<span class="tag high">Priority</span>');
    if (t.minutes) tags.push(`<span class="tag">${t.minutes < 60 ? t.minutes + ' min' : (t.minutes / 60).toFixed(t.minutes % 60 ? 1 : 0) + ' hr'}</span>`);
    const subs = isSub ? [] : all.filter((s) => s.parent === t.id);
    const doneSubs = subs.filter((s) => s.done).length;
    let html = `<li class="task ${t.done ? 'done' : ''} ${isSub ? 'sub' : ''}" data-id="${esc(t.id)}">
      <button class="check ${t.done ? 'on' : ''} ${t.priority === 'high' ? 'pri-high' : ''}" data-act="toggle" aria-label="${t.done ? 'Mark not done' : 'Mark done'}">${CHECK_SVG}</button>
      <button class="t-body" data-act="edit"><div class="t-title">${esc(t.title)}</div>${tags.length ? `<div class="t-meta">${tags.join('')}</div>` : ''}${subs.length ? progressHTML(doneSubs, subs.length) : ''}</button>
    </li>`;
    if (!subs.length) return html;
    // Steps stay in the order Tempo made them. Folded, only the next
    // unfinished step shows; "Show all" opens the rest.
    const expanded = state.expanded.includes(t.id);
    const nextOpen = subs.find((s) => !s.done);
    const visible = expanded ? subs : (t.done || !nextOpen ? [] : [nextOpen]);
    visible.forEach((s) => { html += taskHTML(s, all, true); });
    const hidden = subs.length - visible.length;
    if (expanded || hidden) {
      html += `<li class="steps-toggle"><button data-steps="${esc(t.id)}" aria-expanded="${expanded}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="${expanded ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'}"/></svg>
        ${expanded ? 'Show less' : visible.length ? `Show all ${subs.length} steps` : `Show ${subs.length} steps`}</button></li>`;
    }
    return html;
  }

  function renderTasks() {
    const d = data();
    const today = dayKey(new Date());
    const weekEnd = dayKey(addDays(new Date(), 7));
    const open = topLevel(d.todos.filter((t) => !t.done)).sort(taskOrder);
    // Each group is its own colored panel, like the sections on Today.
    const groups = [
      ['Overdue', 'p-overdue', open.filter((t) => t.due && t.due < today)],
      ['Today', 'p-next', open.filter((t) => t.due === today)],
      ['This week', 'p-break', open.filter((t) => t.due > today && t.due <= weekEnd)],
      ['Later', 'p-focus', open.filter((t) => t.due > weekEnd)],
      ['Anytime', 'p-anytime', open.filter((t) => !t.due)],
      ['Done', 'p-done', topLevel(d.todos.filter((t) => t.done))]
    ];
    const html = groups.filter(([, , l]) => l.length).map(([name, cls, l]) =>
      `<section class="panel ${cls}"><header class="panel-head"><span class="panel-dot" aria-hidden="true"></span><h2>${name} <span class="count">${l.length}</span></h2></header><ul class="task-list">${l.map((t) => taskHTML(t, d.todos)).join('')}</ul></section>`).join('');
    $('#taskGroups').innerHTML = html || `<p class="empty-note">No tasks yet. Add one above, or just tell Tempo.</p>`;
  }

  // ───────────── Views ─────────────
  function setView(v) {
    state.view = v; store.set('view', v);
    $$('.seg').forEach((b) => { const on = b.dataset.view === v; b.classList.toggle('active', on); b.setAttribute('aria-selected', on); });
    $('.segmented').dataset.active = v;
    $('#view-today').hidden = v !== 'today';
    $('#view-tasks').hidden = v !== 'tasks';
  }

  // ───────────── Task actions ─────────────
  function findTodo(id) { return data().todos.find((t) => t.id === id); }

  async function toggleTodo(id, li) {
    const t = findTodo(id); if (!t) return;
    const done = !t.done;
    const prevCompleted = t.completed;
    t.done = done; // optimistic
    t.completed = done ? localISO(new Date()) : '';
    if (navigator.vibrate) navigator.vibrate(done ? [8, 40, 12] : 8);
    const check = li && li.querySelector('.check');
    if (check) check.classList.toggle('on', done);
    if (li) li.classList.toggle('done', done);
    if (done) nudge(t);
    setTimeout(render, 380);
    if (isConnected()) {
      try { await api('updateTodo', { todo: { id, done } }); render(); }
      catch (e) { t.done = !done; t.completed = prevCompleted; render(); toast(e.message); }
    }
  }

  // ───────────── Momentum nudge ─────────────
  // Right after a check-off, while it feels good, offer the next tiny step.
  const CHEERS = ['Nice!', 'Done!', 'Look at you.', 'One less thing.', 'That counts.', 'Yes!'];
  let nudgeNext = null;
  function nudge(t) {
    const d = data();
    if (state.pinned === t.id) state.pinned = null;
    const cheer = CHEERS[Math.floor(Math.random() * CHEERS.length)];
    let next = null, kicker, title;
    if (t.parent) {
      const sibs = stepsOf(d, t.parent);
      const parent = d.todos.find((p) => p.id === t.parent);
      next = sibs.find((s) => !s.done);
      if (!next && parent && !parent.done) {
        next = parent;
        kicker = `${cheer} Every step is done.`;
        title = `Check off “${parent.title}” too?`;
      } else if (next) {
        kicker = `${cheer} ${sibs.filter((s) => s.done).length} of ${sibs.length} done. While you’re rolling:`;
      }
    }
    if (!next) {
      const c = nextCandidates(d).find((x) => x.todo.id !== t.id);
      if (c) { next = c.todo; kicker = `${cheer} Keep the momentum? Next up:`; }
    }
    if (!next) { toast(`${cheer} That’s everything on your list.`); return; }
    nudgeNext = next;
    $('#nudgeKicker').textContent = kicker;
    $('#nudgeTitle').textContent = title || (next.title + (next.minutes ? ` · ${minText(next.minutes)}` : ''));
    $('#nudgeGo').textContent = next === d.todos.find((p) => p.id === t.parent) ? 'Check it off' : 'Let’s go';
    $('#reply').hidden = true;
    const box = $('#nudge');
    box.hidden = false;
    box.style.animation = 'none'; void box.offsetWidth; box.style.animation = '';
    clearTimeout(nudge._t);
    nudge._t = setTimeout(hideNudge, 15000);
  }
  function hideNudge() { $('#nudge').hidden = true; clearTimeout(nudge._t); }
  function nudgeGo() {
    const n = nudgeNext; hideNudge(); if (!n) return;
    const d = data();
    const isParentFinish = !n.parent && stepsOf(d, n.id).length && stepsOf(d, n.id).every((s) => s.done);
    if (isParentFinish) { toggleTodo(n.id, null); return; }
    state.pinned = n.id; skipped.delete(n.id);
    setView('today'); render();
    const card = $('#nextStep');
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.remove('flash'); void card.offsetWidth; card.classList.add('flash');
  }

  function openTask(id) {
    const t = findTodo(id); if (!t) return;
    state.editing = id;
    $('#tTitle').value = t.title;
    $('#tDue').value = t.due || '';
    $('#tRemind').value = t.remind || '';
    $('#tMinutes').value = t.minutes || '';
    $('#tNotes').value = t.notes || '';
    $$('#tPriority button').forEach((b) => b.classList.toggle('on', b.dataset.v === (t.priority || 'normal')));
    $('#tBreak').hidden = !!t.parent;
    openSheet('task');
  }

  async function saveTask(ev) {
    ev.preventDefault();
    const t = findTodo(state.editing); if (!t) return;
    const upd = {
      id: t.id,
      title: $('#tTitle').value.trim() || t.title,
      due: $('#tDue').value || '',
      remind: ($('#tRemind').value || '').slice(0, 16),
      minutes: $('#tMinutes').value ? Number($('#tMinutes').value) : '',
      notes: $('#tNotes').value,
      priority: ($('#tPriority .on') || {}).dataset?.v || 'normal'
    };
    if (upd.remind !== (t.remind || '')) t.reminded = '';
    if (upd.remind && !upd.due) upd.due = upd.remind.slice(0, 10);
    Object.assign(t, upd);
    closeSheets(); render();
    if (isConnected()) { try { await api('updateTodo', { todo: upd }); render(); } catch (e) { toast(e.message); } }
  }

  async function deleteTask() {
    const t = findTodo(state.editing); if (!t) return;
    const d = data();
    d.todos = d.todos.filter((x) => x.id !== t.id && x.parent !== t.id);
    closeSheets(); render(); toast('Task deleted');
    if (isConnected()) { try { await api('deleteTodo', { id: t.id }); render(); } catch (e) { toast(e.message); } }
  }

  async function quickAdd(ev) {
    ev.preventDefault();
    const input = $('#quickAddInput');
    const title = input.value.trim(); if (!title) return;
    input.value = '';
    const t = { id: 'tmp' + Date.now(), title, due: '', priority: 'normal', done: false, parent: '', minutes: null, notes: '' };
    data().todos.push(t); render();
    if (isConnected()) { try { await api('addTodo', { todo: { title } }); render(); } catch (e) { toast(e.message); } }
  }

  // ───────────── Asking Tempo ─────────────
  let busy = false;
  async function ask(text, file) {
    text = (text || '').trim();
    if (!text || busy) return false;
    if (file && !isConnected()) { toast('Connect Tempo in Settings to break down files.'); return false; }
    busy = true;
    let ok = false;
    const mic = $('#mic');
    mic.classList.add('thinking');
    $('#prompt').value = ''; autoSize(); syncMic();
    hint(file ? 'Reading your file…' : 'Thinking…');
    pushHistory('user', file ? `${text} 📎` : text);
    try {
      let res;
      if (isConnected()) {
        const payload = { text, history: state.history.slice(0, -1).slice(-8) };
        if (file) payload.file = file;
        res = await api('ask', payload);
      } else {
        await new Promise((r) => setTimeout(r, 900));
        res = { reply: 'This is a preview. Connect Tempo in Settings and I’ll add this to your real calendar and to-do list.', changes: [] };
      }
      pushHistory('assistant', res.reply);
      showReply(res.reply, res.changes || []);
      render();
      ok = true;
    } catch (e) {
      showReply(e.message, [], true);
    } finally {
      busy = false; mic.classList.remove('thinking'); hint('');
    }
    return ok;
  }

  function pushHistory(role, text) {
    state.history.push({ role, text, at: Date.now() });
    state.history = state.history.slice(-20);
    store.set('history', state.history);
  }

  const CHIP_ICONS = {
    event: '<svg class="ico" viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
    todo: '<svg class="ico" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.2l2.4 2.4 4.6-4.8"/></svg>'
  };
  function showReply(text, changes, isErr) {
    const box = $('#reply');
    $('#replyText').textContent = text;
    $('#replyText').classList.toggle('err', !!isErr);
    // Keep it short: the main changes only, with steps folded into one chip.
    const all = changes || [];
    const main = all.filter((c) => !c.sub), subs = all.filter((c) => c.sub);
    const MAX_CHIPS = 3;
    const chip = (inner, type) => `<span class="chip">${CHIP_ICONS[type] || ''}<span>${inner}</span></span>`;
    let html = main.slice(0, MAX_CHIPS).map((c) =>
      chip(`${esc(cap(c.verb))} <b>${esc(c.title)}</b>${c.when ? ' · ' + esc(c.type === 'todo' && /^\d{4}-/.test(c.when) ? relDay(c.when) : c.when) : ''}`, c.type)).join('');
    if (main.length > MAX_CHIPS) html += chip(`+${main.length - MAX_CHIPS} more`, 'todo');
    if (subs.length) {
      const verb = subs.every((c) => c.verb === subs[0].verb) ? subs[0].verb : 'updated';
      html += chip(`${esc(cap(verb))} <b>${subs.length} step${subs.length === 1 ? '' : 's'}</b>`, 'todo');
    }
    $('#replyChips').innerHTML = html;
    box.hidden = false;
    $('#replyBody').scrollTop = 0;
    box.style.animation = 'none'; void box.offsetWidth; box.style.animation = '';
    clearTimeout(showReply._t);
    // Short replies fade on their own. Long ones stay until you close them.
    const long = $('#replyBody').scrollHeight > $('#replyBody').clientHeight + 4;
    $('#replyMore').hidden = !long;
    if (!isErr && !long) showReply._t = setTimeout(hideReply, 12000);
  }
  function hideReply() { clearTimeout(showReply._t); $('#reply').hidden = true; }
  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');

  function renderChat() {
    $('#chatLog').innerHTML = state.history.length
      ? state.history.map((m) => `<div class="msg ${m.role}">${esc(m.text)}</div>`).join('')
      : '<p class="empty-note">No messages yet.</p>';
    const sheet = $('#chatSheet'); sheet.scrollTop = sheet.scrollHeight;
  }

  // ───────────── Voice ─────────────
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, listening = false, finalText = '';
  function startListening() {
    if (!SR) { fallbackDictation(); return; }
    try {
      rec = new SR();
      rec.lang = navigator.language || 'en-US';
      rec.interimResults = true;
      rec.continuous = false;
      finalText = '';
      rec.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript;
        }
        $('#prompt').value = (finalText + interim).trim(); autoSize();
      };
      rec.onerror = (e) => { stopUI(); if (e.error === 'not-allowed' || e.error === 'service-not-allowed') fallbackDictation(); };
      rec.onend = () => { const txt = $('#prompt').value.trim(); stopUI(); if (txt) sendPrompt(txt); };
      rec.start();
      listening = true;
      $('#mic').classList.add('listening');
      hint('Listening… tap to stop');
      if (navigator.vibrate) navigator.vibrate(10);
    } catch (e) { stopUI(); fallbackDictation(); }
  }
  function stopListening() { if (rec) try { rec.stop(); } catch (e) { /* ignore */ } }
  function stopUI() { listening = false; $('#mic').classList.remove('listening'); hint(''); }
  function fallbackDictation() {
    const p = $('#prompt'); p.focus();
    hint('Tap the mic on your keyboard to talk');
  }

  // ───────────── UI helpers ─────────────
  function hint(t) { $('#dockHint').textContent = t || ''; }
  function toast(msg) {
    const el = $('#toast'); el.textContent = msg; el.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => { el.hidden = true; }, 2800);
  }
  function autoSize() { const p = $('#prompt'); p.style.height = 'auto'; p.style.height = Math.min(p.scrollHeight, 120) + 'px'; }
  function syncMic() { $('#mic').classList.toggle('has-text', !!$('#prompt').value.trim() || !!dockFile); }

  function openSheet(name) {
    closeSheets();
    $(`#${name}Backdrop`).hidden = false;
    $(`#${name}Sheet`).hidden = false;
  }
  function closeSheets() {
    ['chat', 'task', 'settings'].forEach((n) => { $(`#${n}Backdrop`).hidden = true; $(`#${n}Sheet`).hidden = true; });
  }

  function openSettings() {
    $('#sName').value = state.name;
    $('#sUrl').value = (state.conn && state.conn.url) || '';
    $('#sKey').value = (state.conn && state.conn.key) || '';
    const s = $('#sStatus');
    s.className = 'status' + (isConnected() ? ' ok' : '');
    s.textContent = isConnected() ? 'Connected to your Tempo brain.' : 'Not connected. Showing sample data.';
    $('#sDisconnect').hidden = !isConnected();
    $('#sPalette').innerHTML = `<span class="swatch"></span>${esc(paletteFor(new Date()).name)}`;
    renderReminderStatus();
    openSheet('settings');
  }

  // ───────────── Notifications (Tempo's own, via Web Push) ─────────────
  const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const b64ToBytes = (b64) => { const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4)); return Uint8Array.from(s, (c) => c.charCodeAt(0)); };

  // The service worker can't read localStorage, so it gets the connection
  // through Cache Storage. It needs it to fetch what a notification should say.
  async function shareConnWithWorker() {
    try {
      const c = await caches.open('tempo-conn');
      if (isConnected()) await c.put('conn', new Response(JSON.stringify(state.conn)));
      else await c.delete('conn');
    } catch (e) { /* ignore */ }
  }

  async function currentPushSub() {
    if (!pushSupported()) return null;
    try { const reg = await navigator.serviceWorker.getRegistration(); return reg ? await reg.pushManager.getSubscription() : null; } catch (e) { return null; }
  }

  async function renderReminderStatus() {
    const box = $('#sReminders');
    const r = isConnected() && state.data && state.data.reminders;
    box.hidden = !isConnected();
    const text = $('#sRemText'), on = $('#sRemOn'), test = $('#sRemTest');
    on.hidden = true; test.hidden = true;
    if (!r || r.vapidKey == null) { text.textContent = 'Update your brain to get reminders (see SETUP, Part 6).'; return; }
    if (!pushSupported()) {
      text.textContent = 'To get reminders, open Tempo from its icon on your home screen (not in Safari), then come back here.';
      return;
    }
    if (Notification.permission === 'denied') {
      text.textContent = 'Notifications are blocked. Turn them on in iPhone Settings → Notifications → Tempo, then come back here.';
      return;
    }
    const sub = await currentPushSub();
    if (sub && Notification.permission === 'granted') {
      text.textContent = r.scheduled
        ? 'On. Reminders pop up on this device, even in Low Power Mode.'
        : 'Notifications are on, but reminder checks aren’t running yet. In Apps Script, run setupReminders once.';
      test.hidden = !r.scheduled;
    } else {
      text.textContent = 'Get a notification when a reminder is due, before events, and each morning.';
      on.hidden = false;
    }
  }

  async function turnOnNotifications() {
    const b = $('#sRemOn'); b.disabled = true;
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { toast('Notifications weren’t allowed'); return; }
      const key = state.data && state.data.reminders && state.data.reminders.vapidKey;
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (sub) { try { await sub.unsubscribe(); } catch (e) { /* ignore */ } }
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
      await shareConnWithWorker();
      await api('savePush', { subscription: sub.toJSON() });
      await refresh(true);
      toast('Notifications are on');
    } catch (e) {
      toast('Couldn’t turn on notifications: ' + e.message);
    } finally {
      b.disabled = false;
      renderReminderStatus();
    }
  }

  async function testReminder() {
    const b = $('#sRemTest'); b.disabled = true;
    try { await api('testReminder'); toast('Sent. Check your notifications.'); }
    catch (e) { toast(e.message); }
    finally { b.disabled = false; }
  }

  // Accepts the web app URL + app key, or an old-style connection code pasted anywhere.
  function readConnection() {
    const urlText = $('#sUrl').value.trim();
    const keyText = $('#sKey').value.trim();
    const blob = urlText + ' ' + keyText;
    const code = (blob.match(/eyJ[A-Za-z0-9+/=_-]{20,}/) || [])[0];
    if (code) {
      try { const o = JSON.parse(atob(code.replace(/-/g, '+').replace(/_/g, '/'))); if (o.url && o.key) return check({ url: o.url, key: o.key }); } catch (e) { /* fall through */ }
    }
    if (!urlText && !keyText) return null;
    const url = (urlText.match(/https:\/\/script\.google(usercontent)?\.com\/[^\s"'<>]+/) || [])[0];
    if (!url) throw new Error('Paste the web app URL. It starts with https://script.google.com/macros/s/ and ends in /exec.');
    const key = (keyText.match(/[A-Za-z0-9]{16,}/) || [])[0];
    if (!key) throw new Error('Paste the app key. In Apps Script, run showAppKey and copy the long code it prints.');
    return check({ url, key });
  }
  function check(conn) {
    conn.url = conn.url.replace(/[).,;]+$/, '');
    if (/\/dev(\?|$)/.test(conn.url)) throw new Error('That URL ends in /dev, which only works on your computer. Use the one ending in /exec: Apps Script → Deploy → Manage deployments → copy the Web app URL.');
    if (!/\/exec(\?|$)/.test(conn.url)) throw new Error('The web app URL should end in /exec. Copy it from Apps Script → Deploy → Manage deployments.');
    return conn;
  }

  async function saveSettings(ev) {
    ev.preventDefault();
    state.name = $('#sName').value.trim(); store.set('name', state.name);
    const s = $('#sStatus');
    let conn = null;
    try { conn = readConnection(); } catch (e) { s.className = 'status err'; s.textContent = e.message; return; }
    if (conn) {
      s.className = 'status'; s.textContent = 'Connecting…';
      const prev = state.conn; state.conn = conn;
      try {
        await api('today');
        store.set('conn', conn); shareConnWithWorker();
        s.className = 'status ok'; s.textContent = 'Connected!';
        setTimeout(closeSheets, 600);
        toast('Connected to your calendar');
      } catch (e) {
        state.conn = prev;
        s.className = 'status err'; s.textContent = 'Couldn’t connect: ' + e.message;
        return;
      }
    } else {
      closeSheets();
    }
    render();
  }

  // ───────────── Wire up ─────────────
  function bind() {
    $$('.seg').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
    $$('[data-goto]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.goto)));

    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]'); if (!btn) return;
      const li = btn.closest('.task'); if (!li) return;
      if (btn.dataset.act === 'toggle') toggleTodo(li.dataset.id, li);
      if (btn.dataset.act === 'edit') openTask(li.dataset.id);
    });

    const prompt = $('#prompt');
    prompt.addEventListener('input', () => { autoSize(); syncMic(); });
    prompt.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendPrompt(prompt.value); } });
    $('#composer').addEventListener('submit', (e) => { e.preventDefault(); sendPrompt(prompt.value); });
    $('#mic').addEventListener('click', () => {
      if (busy) return;
      if (listening) { stopListening(); return; }
      if (prompt.value.trim() || dockFile) { sendPrompt(prompt.value); return; }
      startListening();
    });
    $('#dockAttach').addEventListener('click', () => $('#dockFile').click());
    $('#dockFile').addEventListener('change', (e) => pickDockFile(e.target.files && e.target.files[0]));
    $('#dockFileClear').addEventListener('click', () => setDockFile(null));

    $('#closeReply').addEventListener('click', hideReply);
    $('#replyMore').addEventListener('click', () => { hideReply(); renderChat(); openSheet('chat'); });
    // Reading it? Don't let it vanish mid-sentence.
    $('#reply').addEventListener('touchstart', () => clearTimeout(showReply._t), { passive: true });
    $('#reply').addEventListener('wheel', () => clearTimeout(showReply._t), { passive: true });
    // Tap anywhere outside the card to close it.
    document.addEventListener('pointerdown', (e) => {
      const box = $('#reply');
      if (!box.hidden && !box.contains(e.target) && !e.target.closest('#composer')) hideReply();
    });
    // Swipe down on the card's top bar to close it.
    let swipeY = null;
    $('.reply-head').addEventListener('touchstart', (e) => { swipeY = e.touches[0].clientY; }, { passive: true });
    $('.reply-head').addEventListener('touchend', (e) => {
      if (swipeY != null && e.changedTouches[0].clientY - swipeY > 40) hideReply();
      swipeY = null;
    }, { passive: true });
    $('#openChat').addEventListener('click', () => { renderChat(); openSheet('chat'); });
    $('#clearChat').addEventListener('click', () => { state.history = []; store.set('history', []); renderChat(); });

    $('#nextStep').addEventListener('click', (e) => {
      const b = e.target.closest('[data-ns]'); if (!b) return;
      const id = $('#nextStep').dataset.id;
      if (b.dataset.ns === 'done') {
        const box = $('#nextStep'); box.classList.add('leaving');
        toggleTodo(id, null);
      }
      if (b.dataset.ns === 'skip') { skipped.add(id); renderNextStep(data()); }
      if (b.dataset.ns === 'break') breakDown(findTodo(id));
    });
    $('#breakPicks').addEventListener('click', (e) => {
      const b = e.target.closest('[data-break]'); if (b) breakDown(findTodo(b.dataset.break));
    });
    $('#breakForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $('#breakInput'); const v = input.value.trim(); if (!v && !breakFile) return;
      input.value = ''; input.blur(); breakNew(v);
    });
    $('#breakAttach').addEventListener('click', () => $('#breakFile').click());
    $('#breakFile').addEventListener('change', (e) => pickBreakFile(e.target.files && e.target.files[0]));
    $('#breakFileClear').addEventListener('click', () => setBreakFile(null));

    $('#nudgeGo').addEventListener('click', nudgeGo);
    $('#nudgeLater').addEventListener('click', () => { hideNudge(); toast('Good stopping point.'); });
    document.addEventListener('click', (e) => {
      const st = e.target.closest('[data-steps]');
      if (st) {
        const id = st.dataset.steps;
        state.expanded = state.expanded.includes(id) ? state.expanded.filter((x) => x !== id) : state.expanded.concat(id).slice(-50);
        store.set('expanded', state.expanded); render();
      }
      if (e.target.closest('[data-done-more]')) { state.doneOpen = !state.doneOpen; renderDone(data()); }
    });

    $('#quickAdd').addEventListener('submit', quickAdd);
    $('#taskForm').addEventListener('submit', saveTask);
    $('#tDelete').addEventListener('click', deleteTask);
    $$('#tPriority button').forEach((b) => b.addEventListener('click', () => { $$('#tPriority button').forEach((x) => x.classList.toggle('on', x === b)); }));
    $('#tBreak').addEventListener('click', () => {
      const t = findTodo(state.editing); closeSheets();
      breakDown(t);
    });

    $('#openSettings').addEventListener('click', openSettings);
    $('#demoConnect').addEventListener('click', openSettings);
    $('#settingsForm').addEventListener('submit', saveSettings);
    $('#sRemOn').addEventListener('click', turnOnNotifications);
    $('#sRemTest').addEventListener('click', testReminder);
    $('#sDisconnect').addEventListener('click', () => {
      state.conn = null; state.data = null; store.del('conn'); store.del('snapshot'); shareConnWithWorker();
      closeSheets(); render(); toast('Disconnected');
    });

    ['chat', 'task', 'settings'].forEach((n) => $(`#${n}Backdrop`).addEventListener('click', closeSheets));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheets(); });

    $('#brief').addEventListener('click', (e) => {
      if (!e.target.closest('[data-brief-fold]')) return;
      const tag = $('#brief').dataset.tag;
      store.set('briefFolded', store.get('briefFolded', '') === tag ? '' : tag);
      renderBrief();
    });
    bindPullToSync();

    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(true); });
    setInterval(() => { if (!document.hidden) render(); }, 60000); // keep countdowns fresh
  }

  // ───────────── Pull down to sync ─────────────
  // At the top of the page, drag down and let go: Tempo re-reads Google
  // Calendar and your tasks right now, and picks up a new app version if
  // there is one. No need to close the app.
  const PULL_AT = 70;
  let syncing = false;
  function bindPullToSync() {
    const sc = $('#scroller'), app = $('.app'), ptr = $('#ptr'), txt = $('#ptrText');
    let y0 = null, x0 = 0, pull = 0;
    const sheetOpen = () => $$('.sheet').some((x) => !x.hidden);
    const show = (p) => {
      app.style.transform = p ? `translateY(${p}px)` : '';
      ptr.style.transform = `translate(-50%, ${Math.min(p, PULL_AT) - 60}px)`;
      ptr.style.opacity = String(Math.min(1, p / PULL_AT));
      ptr.style.setProperty('--ptr-rot', `${p * 4}deg`);
    };
    const settle = (p) => {
      app.classList.add('settle'); ptr.classList.add('anim'); show(p);
      setTimeout(() => { app.classList.remove('settle'); ptr.classList.remove('anim'); }, 320);
    };
    sc.addEventListener('touchstart', (e) => {
      if (syncing || window.scrollY > 0 || sheetOpen() || e.touches.length > 1) { y0 = null; return; }
      y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; pull = 0;
    }, { passive: true });
    sc.addEventListener('touchmove', (e) => {
      if (y0 == null) return;
      const dy = e.touches[0].clientY - y0, dx = Math.abs(e.touches[0].clientX - x0);
      if (dy <= 0 || window.scrollY > 0) { if (pull) { pull = 0; show(0); } if (dy < 0) y0 = null; return; }
      if (!pull && dx > dy) { y0 = null; return; }
      e.preventDefault();
      pull = Math.min(130, dy * 0.5);
      show(pull);
      ptr.classList.toggle('ready', pull >= PULL_AT);
      txt.textContent = pull >= PULL_AT ? 'Let go to sync' : 'Pull to sync';
    }, { passive: false });
    const end = () => {
      if (y0 == null) return;
      y0 = null;
      if (pull >= PULL_AT) pullSync(); else settle(0);
      pull = 0;
    };
    sc.addEventListener('touchend', end);
    sc.addEventListener('touchcancel', end);

    async function pullSync() {
      syncing = true;
      ptr.classList.remove('ready'); ptr.classList.add('busy');
      txt.textContent = 'Syncing…';
      settle(52);
      if (navigator.vibrate) navigator.vibrate(10);
      const [ok, updating] = await Promise.all([refresh(false, true), checkForUpdate()]);
      if (updating) { txt.textContent = 'Updating Tempo…'; return; }
      ptr.classList.remove('busy');
      txt.textContent = !isConnected() ? 'Sample data' : ok ? `Synced ${timeFull(new Date())}` : 'Couldn’t sync';
      setTimeout(() => { settle(0); syncing = false; }, 900);
    }
  }
  // If a newer version of Tempo is on GitHub, switch to it now.
  async function checkForUpdate() {
    try {
      if (!('serviceWorker' in navigator)) return false;
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return false;
      await reg.update();
      if (!reg.installing && !reg.waiting) return false;
      navigator.serviceWorker.addEventListener('controllerchange', () => location.reload());
      setTimeout(() => location.reload(), 4000);
      return true;
    } catch (e) { return false; }
  }

  // Open with ?q=... (used by the iPhone Shortcut "open in app" option) or #connect=CODE
  function handleLaunchParams() {
    const params = new URLSearchParams(location.search);
    const hash = new URLSearchParams(location.hash.slice(1));
    const code = hash.get('connect');
    if (code) {
      history.replaceState(null, '', location.pathname);
      openSettings(); $('#sUrl').value = code;
    }
    const q = params.get('q');
    if (q) { history.replaceState(null, '', location.pathname); setTimeout(() => ask(q), 300); }
    if (params.get('listen') === '1') { history.replaceState(null, '', location.pathname); setTimeout(startListening, 400); }
  }

  bind();
  setView(state.view);
  render();
  refresh(true);
  handleLaunchParams();

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
    shareConnWithWorker();
  }
})();
