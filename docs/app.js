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
        { id: 'a1', title: 'Finish lab report draft', due: k(0), priority: 'high', done: false, minutes: 90, parent: '', notes: '' },
        { id: 'a2', title: 'Outline intro + methods', due: k(0), priority: 'normal', done: true, minutes: 30, parent: 'a1', notes: '' },
        { id: 'a3', title: 'Make the two graphs', due: k(0), priority: 'normal', done: false, minutes: 40, parent: 'a1', notes: '' },
        { id: 'a4', title: 'Email Prof. Lee about extension', due: k(-1), priority: 'normal', done: false, minutes: 10, parent: '', notes: '' },
        { id: 'a5', title: 'Review chapters 7–9 for Bio', due: k(2), priority: 'high', done: false, minutes: 120, parent: '', notes: '' },
        { id: 'a6', title: 'Pay phone bill', due: k(5), priority: 'low', done: false, minutes: null, parent: '', notes: '' },
        { id: 'a7', title: 'Return library books', due: '', priority: 'normal', done: false, minutes: null, parent: '', notes: '' }
      ]
    };
  }
  const isConnected = () => !!(state.conn && state.conn.url && state.conn.key);
  const data = () => (isConnected() && state.data && !state.data.sample ? state.data : (state._sample = state._sample || sampleData()));

  // ───────────── Backend ─────────────
  async function api(action, payload = {}) {
    if (!isConnected()) throw new Error('Not connected');
    const res = await fetch(state.conn.url, {
      method: 'POST',
      // text/plain avoids a CORS pre-flight, which Apps Script does not answer.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ key: state.conn.key, action }, payload)),
      redirect: 'follow'
    });
    if (!res.ok) throw new Error(`Server error (${res.status})`);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Something went wrong');
    if (json.events && json.todos) {
      state.data = { events: json.events, todos: json.todos, now: json.now };
      store.set('snapshot', state.data);
    }
    return json;
  }

  async function refresh(quiet) {
    if (!isConnected()) { render(); return; }
    try { await api('today'); render(); }
    catch (e) { if (!quiet) toast(e.message); }
  }

  // ───────────── Rendering ─────────────
  function render() {
    renderHeader();
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
    const open = d.todos.filter((t) => !t.done);
    const dueToday = open.filter((t) => t.due && t.due <= today);
    const bits = [];
    bits.push(todays.length ? `${todays.length} ${todays.length === 1 ? 'event' : 'events'} left today` : 'Nothing else on the calendar today');
    bits.push(dueToday.length ? `${dueToday.length} ${dueToday.length === 1 ? 'task' : 'tasks'} due` : `${open.length} open ${open.length === 1 ? 'task' : 'tasks'}`);
    $('#summary').textContent = bits.join(' · ');
  }

  function renderToday() {
    const d = data();
    const now = new Date();
    const today = dayKey(now);

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

    // Today timeline
    const todays = d.events.filter((e) => e.start.slice(0, 10) === today).sort((a, b) => a.start.localeCompare(b.start));
    $('#scheduleTitle').textContent = 'Today';
    let html = '', nowPlaced = false;
    todays.forEach((e) => {
      const s = parse(e.start), en = parse(e.end);
      if (!nowPlaced && s > now) { html += nowLine(now); nowPlaced = true; }
      const cls = en <= now ? 'past' : s <= now ? 'now' : '';
      html += `<li class="ev ${cls}">
        <div class="ev-time">${e.all_day ? 'All day' : `${timeFmt(s)}<small>${ampm(s)}</small>`}</div>
        <div class="ev-card" style="--ev-color:${esc(e.color || '')}">
          <div class="ev-title">${esc(e.title)}</div>
          <div class="ev-sub">${e.all_day ? '' : `${timeFull(s)} – ${timeFull(en)}`}${e.location ? ' · ' + esc(e.location) : ''}${e.calendar ? ' · ' + esc(e.calendar) : ''}</div>
        </div></li>`;
    });
    if (todays.length && !nowPlaced) html += nowLine(now);
    $('#timeline').innerHTML = html || `<li class="empty-note">No events today.</li>`;

    // Coming up (next 6 days)
    const later = d.events.filter((e) => e.start.slice(0, 10) > today).sort((a, b) => a.start.localeCompare(b.start)).slice(0, 6);
    $('#upcoming').innerHTML = later.length ? later.map((e) => {
      const s = parse(e.start), en = parse(e.end);
      return `<li>
        <div class="day-badge"><span>${WD[s.getDay()]}</span><b>${s.getDate()}</b></div>
        <div class="up-body"><div class="ev-title">${esc(e.title)}</div>
          <div class="ev-sub">${e.all_day ? 'All day' : `${timeFull(s)} – ${timeFull(en)}`}${e.location ? ' · ' + esc(e.location) : ''}</div></div>
        <span class="cal-dot" style="background:${esc(e.color || 'var(--accent)')}"></span>
      </li>`;
    }).join('') : `<li class="empty-note">Nothing else this week.</li>`;
  }

  const nowLine = (now) => `<li class="now-line" aria-label="Now"><span>${timeFull(now).toUpperCase()}</span><span></span></li>`;
  const topLevel = (list) => list.filter((t) => !t.parent);
  const priRank = { high: 0, normal: 1, low: 2 };
  function taskOrder(a, b) {
    const ad = a.due || '9999', bd = b.due || '9999';
    if (ad !== bd) return ad.localeCompare(bd);
    return (priRank[a.priority] ?? 1) - (priRank[b.priority] ?? 1);
  }

  const CHECK_SVG = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  function taskHTML(t, all, isSub) {
    const today = dayKey(new Date());
    const tags = [];
    if (t.due) {
      const cls = !t.done && t.due < today ? 'overdue' : t.due === today ? 'today' : '';
      tags.push(`<span class="tag ${cls}">${cls === 'overdue' ? 'Overdue · ' : ''}${esc(relDay(t.due))}</span>`);
    }
    if (t.priority === 'high' && !t.done) tags.push('<span class="tag high">Priority</span>');
    if (t.minutes) tags.push(`<span class="tag">${t.minutes < 60 ? t.minutes + ' min' : (t.minutes / 60).toFixed(t.minutes % 60 ? 1 : 0) + ' hr'}</span>`);
    const subs = all.filter((s) => s.parent === t.id);
    if (subs.length) tags.push(`<span class="tag">${subs.filter((s) => s.done).length}/${subs.length} steps</span>`);
    let html = `<li class="task ${t.done ? 'done' : ''} ${isSub ? 'sub' : ''}" data-id="${esc(t.id)}">
      <button class="check ${t.done ? 'on' : ''} ${t.priority === 'high' ? 'pri-high' : ''}" data-act="toggle" aria-label="${t.done ? 'Mark not done' : 'Mark done'}">${CHECK_SVG}</button>
      <button class="t-body" data-act="edit"><div class="t-title">${esc(t.title)}</div>${tags.length ? `<div class="t-meta">${tags.join('')}</div>` : ''}</button>
    </li>`;
    if (!isSub) subs.sort((a, b) => Number(a.done) - Number(b.done)).forEach((s) => { html += taskHTML(s, all, true); });
    return html;
  }

  function renderTasks() {
    const d = data();
    const today = dayKey(new Date());
    const weekEnd = dayKey(addDays(new Date(), 7));
    const open = topLevel(d.todos.filter((t) => !t.done)).sort(taskOrder);
    const groups = [
      ['Overdue', open.filter((t) => t.due && t.due < today)],
      ['Today', open.filter((t) => t.due === today)],
      ['This week', open.filter((t) => t.due > today && t.due <= weekEnd)],
      ['Later', open.filter((t) => t.due > weekEnd)],
      ['Anytime', open.filter((t) => !t.due)],
      ['Done', topLevel(d.todos.filter((t) => t.done))]
    ];
    const html = groups.filter(([, l]) => l.length).map(([name, l]) =>
      `<h3 class="group-title">${name} <span class="count">${l.length}</span></h3><ul class="task-list">${l.map((t) => taskHTML(t, d.todos)).join('')}</ul>`).join('');
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
    t.done = done; // optimistic
    if (navigator.vibrate) navigator.vibrate(8);
    li.querySelector('.check').classList.toggle('on', done);
    li.classList.toggle('done', done);
    setTimeout(render, 380);
    if (isConnected()) {
      try { await api('updateTodo', { todo: { id, done } }); render(); }
      catch (e) { t.done = !done; render(); toast(e.message); }
    }
  }

  function openTask(id) {
    const t = findTodo(id); if (!t) return;
    state.editing = id;
    $('#tTitle').value = t.title;
    $('#tDue').value = t.due || '';
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
      minutes: $('#tMinutes').value ? Number($('#tMinutes').value) : '',
      notes: $('#tNotes').value,
      priority: ($('#tPriority .on') || {}).dataset?.v || 'normal'
    };
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
  async function ask(text) {
    text = (text || '').trim();
    if (!text || busy) return;
    busy = true;
    const mic = $('#mic');
    mic.classList.add('thinking');
    $('#prompt').value = ''; autoSize(); syncMic();
    hint('Thinking…');
    pushHistory('user', text);
    try {
      let res;
      if (isConnected()) {
        res = await api('ask', { text, history: state.history.slice(0, -1).slice(-8) });
      } else {
        await new Promise((r) => setTimeout(r, 900));
        res = { reply: 'This is a preview. Connect Tempo in Settings and I’ll add this to your real calendar and to-do list.', changes: [] };
      }
      pushHistory('assistant', res.reply);
      showReply(res.reply, res.changes || []);
      render();
    } catch (e) {
      showReply(e.message, [], true);
    } finally {
      busy = false; mic.classList.remove('thinking'); hint('');
    }
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
    $('#replyChips').innerHTML = (changes || []).map((c) =>
      `<span class="chip">${CHIP_ICONS[c.type] || ''}<span>${esc(cap(c.verb))} <b>${esc(c.title)}</b>${c.when ? ' · ' + esc(c.type === 'todo' && /^\d{4}-/.test(c.when) ? relDay(c.when) : c.when) : ''}</span></span>`).join('');
    box.hidden = false;
    box.style.animation = 'none'; void box.offsetWidth; box.style.animation = '';
    clearTimeout(showReply._t);
    if (!isErr) showReply._t = setTimeout(() => { box.hidden = true; }, 12000);
  }
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
      rec.onend = () => { const txt = $('#prompt').value.trim(); stopUI(); if (txt) ask(txt); };
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
  function syncMic() { $('#mic').classList.toggle('has-text', !!$('#prompt').value.trim()); }

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
    $('#sCode').value = '';
    const s = $('#sStatus');
    s.className = 'status' + (isConnected() ? ' ok' : '');
    s.textContent = isConnected() ? 'Connected to your Tempo brain.' : 'Not connected. Showing sample data.';
    $('#sDisconnect').hidden = !isConnected();
    openSheet('settings');
  }

  function decodeCode(code) {
    code = code.trim();
    if (!code) return null;
    try { const o = JSON.parse(atob(code.replace(/\s+/g, ''))); if (o.url && o.key) return o; } catch (e) { /* fall through */ }
    throw new Error('That code doesn’t look right. Copy the whole line from Apps Script.');
  }

  async function saveSettings(ev) {
    ev.preventDefault();
    state.name = $('#sName').value.trim(); store.set('name', state.name);
    const s = $('#sStatus');
    let conn = null;
    try { conn = decodeCode($('#sCode').value); } catch (e) { s.className = 'status err'; s.textContent = e.message; return; }
    if (conn) {
      s.className = 'status'; s.textContent = 'Connecting…';
      const prev = state.conn; state.conn = conn;
      try {
        await api('today');
        store.set('conn', conn);
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
    prompt.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(prompt.value); } });
    $('#composer').addEventListener('submit', (e) => { e.preventDefault(); ask(prompt.value); });
    $('#mic').addEventListener('click', () => {
      if (busy) return;
      if (listening) { stopListening(); return; }
      if (prompt.value.trim()) { ask(prompt.value); return; }
      startListening();
    });

    $('#closeReply').addEventListener('click', () => { $('#reply').hidden = true; });
    $('#openChat').addEventListener('click', () => { renderChat(); openSheet('chat'); });
    $('#clearChat').addEventListener('click', () => { state.history = []; store.set('history', []); renderChat(); });

    $('#quickAdd').addEventListener('submit', quickAdd);
    $('#taskForm').addEventListener('submit', saveTask);
    $('#tDelete').addEventListener('click', deleteTask);
    $$('#tPriority button').forEach((b) => b.addEventListener('click', () => { $$('#tPriority button').forEach((x) => x.classList.toggle('on', x === b)); }));
    $('#tBreak').addEventListener('click', () => {
      const t = findTodo(state.editing); closeSheets();
      if (t) ask(`Break "${t.title}" into small steps and add them as sub-tasks.`);
    });

    $('#openSettings').addEventListener('click', openSettings);
    $('#demoConnect').addEventListener('click', openSettings);
    $('#settingsForm').addEventListener('submit', saveSettings);
    $('#sDisconnect').addEventListener('click', () => {
      state.conn = null; state.data = null; store.del('conn'); store.del('snapshot');
      closeSheets(); render(); toast('Disconnected');
    });

    ['chat', 'task', 'settings'].forEach((n) => $(`#${n}Backdrop`).addEventListener('click', closeSheets));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheets(); });

    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(true); });
    setInterval(() => { if (!document.hidden) render(); }, 60000); // keep countdowns fresh
  }

  // Open with ?q=... (used by the iPhone Shortcut "open in app" option) or #connect=CODE
  function handleLaunchParams() {
    const params = new URLSearchParams(location.search);
    const hash = new URLSearchParams(location.hash.slice(1));
    const code = hash.get('connect');
    if (code) {
      history.replaceState(null, '', location.pathname);
      openSettings(); $('#sCode').value = code;
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
  }
})();
