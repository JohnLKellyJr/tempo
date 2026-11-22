/**
 * Tempo — the "brain" of your assistant.
 *
 * This runs inside Google Apps Script, in your own Google account.
 * It receives what you say or type from the Tempo app (or the iPhone
 * Shortcut), asks Claude what to do, and then adds events to your
 * Google Calendar and keeps your to-do list in a private Google Sheet.
 *
 * You only ever need to touch the SETTINGS section below.
 */

// ───────────────────────────── SETTINGS ─────────────────────────────
// Which Claude model to use. claude-haiku-5-5 is fast and very cheap.
// For harder planning, switch to claude-opus-5-5 (smarter, costs more):
// add a Script Property MODEL = claude-opus-5-5. No redeploy needed.
var DEFAULT_MODEL = 'claude-haiku-5-5';
// ────────────────────────────────────────────────────────────────────

var API_URL = 'https://api.anthropic.com/v1/messages';
var API_VERSION = '2026-10-21';
var MAX_TOOL_ROUNDS = 8;
var TODO_HEADERS = ['id', 'title', 'notes', 'due', 'priority', 'done', 'created', 'completed', 'parent', 'minutes'];

/* ═════════════════════════ One-time setup ═════════════════════════ */

/**
 * Run this ONCE from the editor (select "setup" at the top, then Run).
 * It creates your private to-do Sheet and a secret app key.
 */
function setup() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('APP_SECRET')) {
    props.setProperty('APP_SECRET', Utilities.getUuid().replace(/-/g, ''));
  }
  todoSheet_(); // creates the Sheet if needed
  // Touch Calendar so Google asks for permission now.
  CalendarApp.getDefaultCalendar().getName();
  if (!props.getProperty('ANTHROPIC_API_KEY')) {
    Logger.log('⚠️  Almost there: add your Claude API key. Project Settings (gear icon) → Script Properties → Add property → name ANTHROPIC_API_KEY, value = your key.');
  }
  Logger.log('✅ Setup done. Next: Deploy → New deployment, then run "connectionCode".');
}

/**
 * Run this AFTER you deploy. It prints the code you paste into the app.
 */
function connectionCode() {
  var url = ScriptApp.getService().getUrl();
  if (!url) {
    Logger.log('❌ Deploy first: Deploy → New deployment → Web app.');
    return;
  }
  var code = Utilities.base64Encode(JSON.stringify({ url: url, key: secret_() }));
  Logger.log('Copy everything on the next line and paste it into Tempo → Settings → Connection code:');
  Logger.log(code);
}

/* ═════════════════════════ Web entry points ═════════════════════════ */

function doGet() {
  return json_({ ok: true, app: 'Tempo', message: 'Tempo brain is running.' });
}

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!body.key || body.key !== secret_()) {
      return json_({ ok: false, error: 'Wrong app key. Paste your connection code again in Settings.' });
    }
    var action = body.action || 'ask';
    switch (action) {
      case 'ping':
        return json_({ ok: true, timezone: tz_() });
      case 'today':
        return json_(snapshot_());
      case 'ask':
        return json_(ask_(String(body.text || ''), body.history || []));
      case 'addTodo':
        addTodo_(body.todo || {});
        return json_(snapshot_());
      case 'updateTodo':
        updateTodo_(body.todo || {});
        return json_(snapshot_());
      case 'deleteTodo':
        deleteTodo_(String(body.id || ''));
        return json_(snapshot_());
      default:
        return json_({ ok: false, error: 'Unknown action: ' + action });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

/** Everything the Today screen needs, in one response. */
function snapshot_() {
  var now = new Date();
  var start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var end = new Date(start.getTime() + 7 * 86400000);
  return {
    ok: true,
    timezone: tz_(),
    now: fmt_(now),
    events: listEvents_(start, end),
    todos: listTodos_(true)
  };
}

/* ═════════════════════════ Talking to Claude ═════════════════════════ */

function ask_(text, history) {
  text = text.trim();
  if (!text) return { ok: false, error: 'Say or type something first.' };

  var messages = [];
  (history || []).slice(-8).forEach(function (m) {
    if (m && (m.role === 'user' || m.role === 'assistant') && m.text) {
      messages.push({ role: m.role, content: String(m.text) });
    }
  });
  // The API needs the conversation to start with the user and alternate.
  while (messages.length && messages[0].role !== 'user') messages.shift();
  messages = alternate_(messages);
  if (messages.length && messages[messages.length - 1].role === 'user') messages.pop();
  messages.push({ role: 'user', content: text });

  var changes = [];
  var reply = '';
  for (var round = 0; round < MAX_TOOL_ROUNDS; round++) {
    var res = callClaude_(messages);
    if (res.stop_reason === 'refusal') {
      reply = "Sorry, I can't help with that one.";
      break;
    }
    messages.push({ role: 'assistant', content: res.content });
    var toolUses = res.content.filter(function (b) { return b.type === 'tool_use'; });
    reply = res.content.filter(function (b) { return b.type === 'text'; })
      .map(function (b) { return b.text; }).join('\n').trim() || reply;
    if (res.stop_reason !== 'tool_use' || !toolUses.length) break;

    var results = toolUses.map(function (t) {
      try {
        var out = runTool_(t.name, t.input || {}, changes);
        return { type: 'tool_result', tool_use_id: t.id, content: JSON.stringify(out) };
      } catch (err) {
        return { type: 'tool_result', tool_use_id: t.id, is_error: true, content: String(err && err.message || err) };
      }
    });
    messages.push({ role: 'user', content: results });
  }

  var snap = snapshot_();
  snap.reply = reply || 'Done.';
  snap.changes = changes;
  return snap;
}

function callClaude_(messages) {
  var key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!key) throw new Error('Add your Claude API key in Apps Script → Project Settings → Script Properties (ANTHROPIC_API_KEY).');
  var model = PropertiesService.getScriptProperties().getProperty('MODEL') || DEFAULT_MODEL;

  var payload = {
    model: model,
    max_tokens: 8000,
    system: systemPrompt_(),
    tools: TOOLS,
    output_config: { effort: 'low' },
    messages: messages
  };
  var headers = { 'x-api-key': key, 'anthropic-version': API_VERSION };
  // Opus/Sonnet: if a safety check declines, let Anthropic retry on a fallback model.
  if (/opus|sonnet|fable/.test(model)) {
    headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
    payload.fallbacks = 'default';
  }

  for (var attempt = 0; attempt < 3; attempt++) {
    var resp = UrlFetchApp.fetch(API_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: headers,
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    var code = resp.getResponseCode();
    if (code === 200) return JSON.parse(resp.getContentText());
    var retryable = code === 429 || code === 408 || code >= 500;
    if (!retryable || attempt === 2) {
      var msg = resp.getContentText();
      try { msg = JSON.parse(msg).error.message; } catch (ignore) {}
      if (code === 401) msg = 'Your Claude API key was rejected. Check ANTHROPIC_API_KEY in Script Properties.';
      if (code === 400 && /credit/i.test(msg)) msg = 'Your Claude account is out of credit. Add credit at console.anthropic.com.';
      throw new Error(msg);
    }
    Utilities.sleep(1500 * (attempt + 1));
  }
}

function systemPrompt_() {
  var now = new Date();
  return [
    'You are Tempo, a personal assistant for Chris, a student. You manage his calendar and his to-do list.',
    'Right now it is ' + Utilities.formatDate(now, tz_(), "EEEE, MMMM d, yyyy 'at' h:mm a") + ' (time zone ' + tz_() + ').',
    '',
    'What you can do with your tools:',
    '- Look at his calendars (personal Google Calendar, plus any school calendar he has subscribed to), and add, move or remove events on his Google Calendar.',
    '- Keep his to-do list: add tasks, set due dates and priorities, mark them done, and split a big task into smaller steps (sub-tasks use parent_id).',
    '',
    'How to work:',
    '- When he asks to schedule something, check the calendar for that time first and avoid clashes. If there is a clash, pick the nearest free slot and tell him.',
    '- If he gives no time, choose a sensible one (study blocks in the afternoon or evening, not before 8am or after 11pm) and say what you chose.',
    '- Default event length is 1 hour unless he says otherwise or it is obviously different.',
    '- "Remind me to…" or "I need to…" with no specific time means a to-do, not an event.',
    '- When he asks what to work on, look at his to-dos and today\'s free time and suggest one or two concrete next steps.',
    '- Only delete events or tasks when he clearly asks you to.',
    '- Times you send to tools are local times in ' + tz_() + ', formatted YYYY-MM-DDTHH:MM. Dates are YYYY-MM-DD.',
    '',
    'Replies are read on a phone: answer in one to three short sentences, plain text, no markdown, no lists unless he asks. Confirm exactly what you changed, with day and time (e.g. "Added Bio study, Thu 7–9 pm.").'
  ].join('\n');
}

/* ═════════════════════════ Tools Claude can use ═════════════════════════ */

var TOOLS = [
  {
    name: 'list_events',
    description: 'List calendar events between two local date-times, across all of his calendars. Use before scheduling to find free time.',
    input_schema: {
      type: 'object',
      properties: {
        start: { type: 'string', description: 'Local start, YYYY-MM-DDTHH:MM' },
        end: { type: 'string', description: 'Local end, YYYY-MM-DDTHH:MM' }
      },
      required: ['start', 'end']
    }
  },
  {
    name: 'create_event',
    description: 'Create an event on his Google Calendar.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        start: { type: 'string', description: 'Local start YYYY-MM-DDTHH:MM, or YYYY-MM-DD for all-day' },
        end: { type: 'string', description: 'Local end YYYY-MM-DDTHH:MM. Omit for all-day.' },
        all_day: { type: 'boolean' },
        location: { type: 'string' },
        notes: { type: 'string' }
      },
      required: ['title', 'start']
    }
  },
  {
    name: 'update_event',
    description: 'Change an existing event on his Google Calendar (move it, rename it). Only fields you pass are changed.',
    input_schema: {
      type: 'object',
      properties: {
        event_id: { type: 'string' },
        title: { type: 'string' },
        start: { type: 'string', description: 'New local start YYYY-MM-DDTHH:MM' },
        end: { type: 'string', description: 'New local end YYYY-MM-DDTHH:MM' },
        location: { type: 'string' }
      },
      required: ['event_id']
    }
  },
  {
    name: 'delete_event',
    description: 'Delete an event from his Google Calendar. Only when he clearly asks.',
    input_schema: {
      type: 'object',
      properties: { event_id: { type: 'string' } },
      required: ['event_id']
    }
  },
  {
    name: 'list_todos',
    description: 'List his to-dos.',
    input_schema: {
      type: 'object',
      properties: { include_done: { type: 'boolean', description: 'Also include completed tasks' } }
    }
  },
  {
    name: 'add_todo',
    description: 'Add a to-do. Use parent_id to add a step under a bigger task.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        due: { type: 'string', description: 'Due date YYYY-MM-DD' },
        priority: { type: 'string', enum: ['high', 'normal', 'low'] },
        notes: { type: 'string' },
        minutes: { type: 'integer', description: 'Estimated minutes to finish' },
        parent_id: { type: 'string' }
      },
      required: ['title']
    }
  },
  {
    name: 'update_todo',
    description: 'Change a to-do: rename, reschedule, change priority, or mark done (done: true).',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        due: { type: 'string', description: 'YYYY-MM-DD, or empty string to clear' },
        priority: { type: 'string', enum: ['high', 'normal', 'low'] },
        notes: { type: 'string' },
        minutes: { type: 'integer' },
        done: { type: 'boolean' }
      },
      required: ['id']
    }
  },
  {
    name: 'delete_todo',
    description: 'Delete a to-do (and its steps). Only when he clearly asks.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id']
    }
  }
];

function runTool_(name, input, changes) {
  switch (name) {
    case 'list_events':
      return listEvents_(parseLocal_(input.start), parseLocal_(input.end));
    case 'create_event': {
      var ev = createEvent_(input);
      changes.push({ type: 'event', verb: 'added', title: ev.title, when: ev.when });
      return ev;
    }
    case 'update_event': {
      var up = updateEvent_(input);
      changes.push({ type: 'event', verb: 'moved', title: up.title, when: up.when });
      return up;
    }
    case 'delete_event': {
      var gone = deleteEvent_(input.event_id);
      changes.push({ type: 'event', verb: 'removed', title: gone.title });
      return { deleted: true };
    }
    case 'list_todos':
      return listTodos_(!!input.include_done);
    case 'add_todo': {
      var t = addTodo_({
        title: input.title, due: input.due, priority: input.priority,
        notes: input.notes, minutes: input.minutes, parent: input.parent_id
      });
      changes.push({ type: 'todo', verb: 'added', title: t.title, when: t.due || '' });
      return t;
    }
    case 'update_todo': {
      var u = updateTodo_(input);
      changes.push({ type: 'todo', verb: input.done ? 'completed' : 'updated', title: u.title, when: u.due || '' });
      return u;
    }
    case 'delete_todo': {
      var d = deleteTodo_(input.id);
      changes.push({ type: 'todo', verb: 'removed', title: d.title });
      return { deleted: true };
    }
  }
  throw new Error('Unknown tool ' + name);
}

/* ═════════════════════════ Calendar ═════════════════════════ */

function listEvents_(start, end) {
  var out = [];
  var defaultId = CalendarApp.getDefaultCalendar().getId();
  CalendarApp.getAllCalendars().forEach(function (cal) {
    if (cal.isHidden && cal.isHidden()) return;
    var events;
    try { events = cal.getEvents(start, end); } catch (err) { return; }
    events.forEach(function (ev) {
      out.push({
        id: ev.getId(),
        title: ev.getTitle() || '(no title)',
        start: fmt_(ev.getStartTime()),
        end: fmt_(ev.getEndTime()),
        all_day: ev.isAllDayEvent(),
        location: ev.getLocation() || '',
        calendar: cal.getName(),
        color: cal.getColor(),
        editable: cal.getId() === defaultId
      });
    });
  });
  out.sort(function (a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : 0; });
  return out;
}

function createEvent_(input) {
  var cal = CalendarApp.getDefaultCalendar();
  var opts = {};
  if (input.location) opts.location = input.location;
  if (input.notes) opts.description = input.notes;
  var ev;
  if (input.all_day || /^\d{4}-\d{2}-\d{2}$/.test(input.start)) {
    ev = cal.createAllDayEvent(input.title, parseLocal_(input.start.slice(0, 10) + 'T00:00'), opts);
  } else {
    var s = parseLocal_(input.start);
    var e = input.end ? parseLocal_(input.end) : new Date(s.getTime() + 3600000);
    if (e <= s) e = new Date(s.getTime() + 3600000);
    ev = cal.createEvent(input.title, s, e, opts);
  }
  return describe_(ev);
}

function updateEvent_(input) {
  var ev = findEvent_(input.event_id);
  if (input.title) ev.setTitle(input.title);
  if (input.location != null) ev.setLocation(input.location);
  if (input.start) {
    var s = parseLocal_(input.start);
    var len = ev.getEndTime().getTime() - ev.getStartTime().getTime();
    var e = input.end ? parseLocal_(input.end) : new Date(s.getTime() + len);
    ev.setTime(s, e);
  } else if (input.end) {
    ev.setTime(ev.getStartTime(), parseLocal_(input.end));
  }
  return describe_(ev);
}

function deleteEvent_(id) {
  var ev = findEvent_(id);
  var title = ev.getTitle();
  ev.deleteEvent();
  return { title: title };
}

function findEvent_(id) {
  var ev = CalendarApp.getDefaultCalendar().getEventById(id);
  if (!ev) throw new Error('That event is not on his Google Calendar (school events can only be read, not changed).');
  return ev;
}

function describe_(ev) {
  var when = ev.isAllDayEvent()
    ? Utilities.formatDate(ev.getStartTime(), tz_(), 'EEE MMM d') + ' (all day)'
    : Utilities.formatDate(ev.getStartTime(), tz_(), 'EEE MMM d, h:mm a') + '–' + Utilities.formatDate(ev.getEndTime(), tz_(), 'h:mm a');
  return { id: ev.getId(), title: ev.getTitle(), start: fmt_(ev.getStartTime()), end: fmt_(ev.getEndTime()), when: when };
}

/* ═════════════════════════ To-do list (private Google Sheet) ═════════════════════════ */

function todoSheet_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SHEET_ID');
  var ss = null;
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (err) { ss = null; } }
  if (!ss) {
    ss = SpreadsheetApp.create('Tempo to-do list (managed by the app)');
    props.setProperty('SHEET_ID', ss.getId());
    var sh = ss.getSheets()[0];
    sh.setName('todos');
    sh.getRange(1, 1, 1, TODO_HEADERS.length).setValues([TODO_HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange('D:D').setNumberFormat('@'); // keep due dates as plain text
  }
  return ss.getSheetByName('todos');
}

function readTodos_() {
  var sh = todoSheet_();
  var last = sh.getLastRow();
  if (last < 2) return [];
  var rows = sh.getRange(2, 1, last - 1, TODO_HEADERS.length).getValues();
  return rows.map(function (r, i) {
    return {
      row: i + 2,
      id: String(r[0]),
      title: String(r[1]),
      notes: String(r[2] || ''),
      due: normDate_(r[3]),
      priority: String(r[4] || 'normal'),
      done: r[5] === true || r[5] === 'TRUE',
      created: String(r[6] || ''),
      completed: String(r[7] || ''),
      parent: String(r[8] || ''),
      minutes: r[9] ? Number(r[9]) : null
    };
  }).filter(function (t) { return t.id; });
}

function listTodos_(includeDone) {
  var weekAgo = fmt_(new Date(Date.now() - 7 * 86400000));
  return readTodos_()
    .filter(function (t) { return includeDone ? (!t.done || t.completed >= weekAgo) : !t.done; })
    .map(function (t) { delete t.row; return t; });
}

function addTodo_(t) {
  if (!t.title) throw new Error('A to-do needs a title.');
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var todo = {
      id: Utilities.getUuid().slice(0, 8),
      title: String(t.title).trim(),
      notes: t.notes || '',
      due: t.due ? String(t.due).slice(0, 10) : '',
      priority: t.priority || 'normal',
      done: false,
      created: fmt_(new Date()),
      completed: '',
      parent: t.parent || '',
      minutes: t.minutes || ''
    };
    todoSheet_().appendRow(TODO_HEADERS.map(function (h) { return todo[h]; }));
    return todo;
  } finally { lock.releaseLock(); }
}

function updateTodo_(t) {
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var todo = readTodos_().filter(function (x) { return x.id === String(t.id); })[0];
    if (!todo) throw new Error('No to-do with id ' + t.id);
    ['title', 'notes', 'priority', 'minutes'].forEach(function (k) { if (t[k] != null) todo[k] = t[k]; });
    if (t.due != null) todo.due = String(t.due).slice(0, 10);
    if (t.done != null) {
      todo.done = !!t.done;
      todo.completed = t.done ? fmt_(new Date()) : '';
    }
    var row = todo.row;
    todoSheet_().getRange(row, 1, 1, TODO_HEADERS.length).setValues([TODO_HEADERS.map(function (h) { return todo[h] == null ? '' : todo[h]; })]);
    delete todo.row;
    return todo;
  } finally { lock.releaseLock(); }
}

function deleteTodo_(id) {
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var all = readTodos_();
    var target = all.filter(function (x) { return x.id === id; })[0];
    if (!target) throw new Error('No to-do with id ' + id);
    var sh = todoSheet_();
    all.filter(function (x) { return x.id === id || x.parent === id; })
      .map(function (x) { return x.row; })
      .sort(function (a, b) { return b - a; })
      .forEach(function (row) { sh.deleteRow(row); });
    return { title: target.title };
  } finally { lock.releaseLock(); }
}

/* ═════════════════════════ Helpers ═════════════════════════ */

function secret_() {
  var s = PropertiesService.getScriptProperties().getProperty('APP_SECRET');
  if (!s) throw new Error('Run setup() once in the Apps Script editor first.');
  return s;
}

function tz_() { return Session.getScriptTimeZone(); }

function fmt_(d) { return Utilities.formatDate(d, tz_(), "yyyy-MM-dd'T'HH:mm"); }

function parseLocal_(s) {
  s = String(s || '').trim().replace(' ', 'T');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += 'T00:00';
  s = s.slice(0, 16);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) throw new Error('Bad date-time "' + s + '". Use YYYY-MM-DDTHH:MM.');
  return Utilities.parseDate(s, tz_(), "yyyy-MM-dd'T'HH:mm");
}

function normDate_(v) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') return Utilities.formatDate(v, tz_(), 'yyyy-MM-dd');
  return String(v).slice(0, 10);
}

function alternate_(msgs) {
  var out = [];
  msgs.forEach(function (m) {
    if (out.length && out[out.length - 1].role === m.role) {
      out[out.length - 1].content += '\n' + m.content;
    } else out.push({ role: m.role, content: m.content });
  });
  return out;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
