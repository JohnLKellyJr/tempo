/**
 * Tempo — the "brain" of your assistant.
 *
 * This runs inside Google Apps Script, in your own Google account.
 * It receives what you say or type from the Tempo app (or the iPhone
 * Shortcut), asks Claude what to do, and then adds events to your
 * Google Calendar and keeps your to-do list in a private Google Sheet.
 * It can also nudge your phone before events and when a task's reminder
 * is due (run "setupReminders" once to turn that on).
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
var TODO_HEADERS = ['id', 'title', 'notes', 'due', 'priority', 'done', 'created', 'completed', 'parent', 'minutes', 'remind', 'reminded'];

// Reminder defaults. Change them without touching code by adding Script
// Properties with the same names (Project Settings → Script Properties):
//   EVENT_REMINDER_MINUTES  minutes before each calendar event (0 = off)
//   MORNING_HOUR            hour for the morning rundown, 0–23 ("off" = off)
var DEFAULT_EVENT_REMINDER_MINUTES = 15;
var DEFAULT_MORNING_HOUR = 8;
var NTFY_SERVER = 'https://ntfy.sh';
var DEFAULT_APP_URL = 'https://johnlkellyjr.github.io/tempo/';

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
  Logger.log('✅ Setup done. Next: Deploy → New deployment, then run "showAppKey".');
}

/**
 * Run this AFTER you deploy. It prints the app key you paste into
 * Tempo → Settings → App key. (The web app URL comes from
 * Deploy → Manage deployments; it ends in /exec.)
 */
function showAppKey() {
  Logger.log('Your app key (copy just the letters and numbers on the next line):');
  Logger.log(secret_());
  Logger.log('Your web app URL is in Deploy → Manage deployments → Web app → URL. Use the one ending in /exec.');
}

/** Older name, kept so the old setup steps still work. */
function connectionCode() { showAppKey(); }

/**
 * Run this ONCE to turn on reminders (select "setupReminders", then Run).
 * It makes your private reminder channel, checks for reminders every
 * 5 minutes, and sends a test notification.
 */
function setupReminders() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('NTFY_TOPIC')) {
    props.setProperty('NTFY_TOPIC', 'tempo-' + Utilities.getUuid().replace(/-/g, '').slice(0, 16));
  }
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendReminders') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendReminders').timeBased().everyMinutes(5).create();
  todoSheet_(); // adds the reminder columns to the Sheet if needed
  notify_({ title: 'Tempo reminders are on', message: 'This is what a reminder looks like.', tags: ['bell'] });
  Logger.log('✅ Reminders are on. In the ntfy app on your iPhone, tap +, and subscribe to this topic:');
  Logger.log(props.getProperty('NTFY_TOPIC'));
  Logger.log('Then: Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy.');
}

/** Run this to turn reminders off again. */
function stopReminders() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendReminders') ScriptApp.deleteTrigger(t);
  });
  Logger.log('Reminders are off. Run setupReminders to turn them back on.');
}

/* ═════════════════════════ Web entry points ═════════════════════════ */

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.r) return HtmlService.createHtmlOutput('<p style="font:18px -apple-system,sans-serif;padding:24px">' + reminderAction_(p) + '</p>');
  return json_({ ok: true, app: 'Tempo', message: 'Tempo brain is running.' });
}

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!body.key || body.key !== secret_()) {
      return json_({ ok: false, error: 'Wrong app key. Check the App key in Tempo → Settings.' });
    }
    rememberUrls_(body);
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
      case 'testReminder':
        if (!topic_()) return json_({ ok: false, error: 'Reminders are off. In Apps Script, run setupReminders once.' });
        notify_({ title: 'Test from Tempo', message: 'Reminders are working.', tags: ['bell'] });
        return json_({ ok: true });
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
  return {
    ok: true,
    timezone: tz_(),
    now: fmt_(now),
    events: weekEvents_(),
    todos: listTodos_(true),
    reminders: { on: !!topic_() && remindersScheduled_(), topic: topic_() || '' }
  };
}

/**
 * Today + the next 7 days of events. Reading every calendar is the slowest
 * thing Tempo does, so the result is kept for EVENT_CACHE_SECONDS and
 * thrown away whenever Tempo itself changes an event.
 */
var EVENT_CACHE_SECONDS = 90;
function weekEvents_() {
  var now = new Date();
  var key = 'week:' + Utilities.formatDate(now, tz_(), 'yyyy-MM-dd');
  var cache = CacheService.getScriptCache();
  var hit = cache.get(key);
  if (hit) { try { return JSON.parse(hit); } catch (ignore) {} }
  var start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var events = listEvents_(start, new Date(start.getTime() + 8 * 86400000));
  try { cache.put(key, JSON.stringify(events), EVENT_CACHE_SECONDS); } catch (ignore) {}
  return events;
}
function clearEventCache_() {
  CacheService.getScriptCache().remove('soon');
  CacheService.getScriptCache().remove('week:' + Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd'));
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
  // Hand Claude the week and the to-do list up front, so it rarely needs
  // a separate "look it up" round trip (each one adds a second or two).
  messages.push({ role: 'user', content: [
    { type: 'text', text: contextFor_() },
    { type: 'text', text: text }
  ] });

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

  if (changes.some(function (c) { return c.type === 'event'; })) clearEventCache_();
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

function contextFor_() {
  var lines = ['<his_calendar next_8_days>'];
  weekEvents_().forEach(function (e) {
    lines.push([e.start.replace('T', ' ') + (e.all_day ? ' (all day)' : '–' + e.end.slice(11)), e.title, e.calendar + (e.editable ? '' : ' (read-only)'), 'id=' + e.id].join(' | '));
  });
  lines.push('</his_calendar>', '<his_open_todos>');
  listTodos_(false).forEach(function (t) {
    lines.push([t.title, t.due ? 'due ' + t.due : 'no due date', t.remind ? 'reminder ' + t.remind : '', t.priority, t.parent ? 'step of ' + t.parent : '', 'id=' + t.id].filter(String).join(' | '));
  });
  lines.push('</his_open_todos>');
  return lines.join('\n');
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
    '- His calendar for the next 8 days and his open to-dos come with each message. Use them directly; only call list_events or list_todos for other dates or finished tasks.',
    '- When he asks to schedule something, check the calendar for that time first and avoid clashes. If there is a clash, pick the nearest free slot and tell him.',
    '- If he gives no time, choose a sensible one (study blocks in the afternoon or evening, not before 8am or after 11pm) and say what you chose.',
    '- Default event length is 1 hour unless he says otherwise or it is obviously different.',
    '- "Remind me to…" or "I need to…" means a to-do, not an event.',
    '- If he gives a time for the reminder ("remind me to call Mom at 5", "in 20 minutes", "tomorrow morning"), set remind_at on the to-do (and due to that day). His phone gets a notification then. "Morning" means 8:00, "afternoon" 14:00, "evening" 19:00, "tonight" 20:00.',
    '- "Remind me 30 minutes before my dentist appointment" means a to-do (e.g. "Leave for dentist") with remind_at 30 minutes before that event starts.',
    '- With no time, do not set remind_at. He gets a morning rundown of what is due anyway.',
    eventLead_() ? '- He also gets a phone nudge ' + eventLead_() + ' minutes before each calendar event automatically; only add a reminder for an event if he asks for a different time.' : '- Automatic event nudges are off, so add a reminder to-do if he asks to be reminded about an event.',
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
        remind_at: { type: 'string', description: 'When to send a phone reminder, local YYYY-MM-DDTHH:MM. Only when he gives a time.' },
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
        remind_at: { type: 'string', description: 'Phone reminder time, local YYYY-MM-DDTHH:MM, or empty string to cancel' },
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
      clearEventCache_();
      changes.push({ type: 'event', verb: 'added', title: ev.title, when: ev.when });
      return ev;
    }
    case 'update_event': {
      var up = updateEvent_(input);
      clearEventCache_();
      changes.push({ type: 'event', verb: 'moved', title: up.title, when: up.when });
      return up;
    }
    case 'delete_event': {
      var gone = deleteEvent_(input.event_id);
      clearEventCache_();
      changes.push({ type: 'event', verb: 'removed', title: gone.title });
      return { deleted: true };
    }
    case 'list_todos':
      return listTodos_(!!input.include_done);
    case 'add_todo': {
      var t = addTodo_({
        title: input.title, due: input.due, priority: input.priority,
        notes: input.notes, minutes: input.minutes, parent: input.parent_id, remind: input.remind_at
      });
      changes.push({ type: 'todo', verb: 'added', title: t.title, when: t.remind ? 'reminder ' + niceTime_(t.remind) : (t.due || '') });
      return t;
    }
    case 'update_todo': {
      if (input.remind_at != null) input.remind = input.remind_at;
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

var SHEET_ = null; // opened once per request
function todoSheet_() {
  if (SHEET_) return SHEET_;
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
    sh.getRange('K:L').setNumberFormat('@');
  }
  SHEET_ = ss.getSheetByName('todos');
  // Older Sheets don't have the reminder columns yet: add their headers.
  if (SHEET_.getRange(1, TODO_HEADERS.length).getValue() !== TODO_HEADERS[TODO_HEADERS.length - 1]) {
    SHEET_.getRange(1, 1, 1, TODO_HEADERS.length).setValues([TODO_HEADERS]).setFontWeight('bold');
    SHEET_.getRange('K:L').setNumberFormat('@'); // keep reminder times as plain text
  }
  return SHEET_;
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
      minutes: r[9] ? Number(r[9]) : null,
      remind: normDateTime_(r[10]),
      reminded: normDateTime_(r[11])
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
      minutes: t.minutes || '',
      remind: cleanRemind_(t.remind),
      reminded: ''
    };
    if (todo.remind && !todo.due) todo.due = todo.remind.slice(0, 10);
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
    if (t.remind != null) {
      var newRemind = cleanRemind_(t.remind);
      if (newRemind !== todo.remind) todo.reminded = ''; // a new time means a new nudge
      todo.remind = newRemind;
      if (todo.remind && !todo.due) todo.due = todo.remind.slice(0, 10);
    }
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

/* ═════════════════════════ Reminders ═════════════════════════ */
// Notifications go through ntfy (ntfy.sh), a free push service with an
// iPhone app. Your channel ("topic") is a long random name only you know.

/** Runs every 5 minutes (setupReminders schedules it). */
function sendReminders() {
  if (!topic_()) return;
  var now = new Date();
  var props = PropertiesService.getScriptProperties();

  // Each part runs on its own, so a slow or broken calendar can never
  // stop a to-do reminder from going out.
  safely_('to-do reminders', function () { sendTodoReminders_(now); });
  safely_('event reminders', function () { sendEventReminders_(now, props); });
  safely_('morning rundown', function () { sendMorning_(now, props); });
}

function safely_(what, fn) {
  try { fn(); } catch (err) { Logger.log('⚠️ ' + what + ' failed: ' + (err && err.stack || err)); }
}

/** To-dos whose reminder time has come. */
function sendTodoReminders_(now) {
  var due = readTodos_().filter(function (t) { return !t.done && t.remind && !t.reminded && parseLocal_(t.remind) <= now; });
  due.forEach(function (t) {
    var late = now - parseLocal_(t.remind) > 6 * 3600000; // reminders were off for hours: don't send a pile of stale nudges
    if (!late) {
      // If sending fails, leave it unmarked so the next check tries again.
      try { notify_({
        title: t.title,
        message: t.notes || ('Reminder from Tempo' + (t.due && t.due > fmt_(now).slice(0, 10) ? ' · due ' + niceDay_(t.due) : '')),
        tags: ['alarm_clock'],
        priority: t.priority === 'high' ? 4 : 3,
        actions: todoActions_(t.id)
      }); } catch (err) { Logger.log('⚠️ Could not send "' + t.title + '", will retry: ' + err); return; }
    }
    var lock = LockService.getScriptLock(); lock.waitLock(10000);
    try { todoSheet_().getRange(t.row, TODO_HEADERS.indexOf('reminded') + 1).setValue(fmt_(now)); }
    finally { lock.releaseLock(); }
  });
}

/** Calendar events starting soon. */
function sendEventReminders_(now, props) {
  var lead = eventLead_();
  if (lead > 0) {
    var sent = {};
    try { sent = JSON.parse(props.getProperty('SENT_EVENTS') || '{}'); } catch (ignore) {}
    var until = fmt_(new Date(now.getTime() + (lead + 1) * 60000));
    soonEvents_(now).forEach(function (e) {
      if (e.start > until) return;
      var start = parseLocal_(e.start);
      var key = e.id + '@' + e.start;
      if (e.all_day || start <= now || sent[key]) return;
      var mins = Math.round((start - now) / 60000);
      try { notify_({
        title: e.title,
        message: (mins <= 1 ? 'Starting now' : 'In ' + mins + ' min') + ' · ' + niceTime_(e.start).replace(/^\w+ /, '') + (e.location ? ' · ' + e.location : ''),
        tags: ['calendar']
      }); } catch (err) { Logger.log('⚠️ Could not send "' + e.title + '", will retry: ' + err); return; }
      sent[key] = e.start;
    });
    var cutoff = fmt_(new Date(now.getTime() - 86400000));
    Object.keys(sent).forEach(function (k) { if (sent[k] < cutoff) delete sent[k]; });
    props.setProperty('SENT_EVENTS', JSON.stringify(sent));
  }
}

/**
 * Events starting in the next 3 hours. Reading every calendar is slow
 * (a subscribed school calendar can take most of a minute), so the list is
 * kept for 10 minutes instead of being read every 5-minute check. Tempo's
 * own changes clear it right away.
 */
function soonEvents_(now) {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('soon');
  if (hit) { try { return JSON.parse(hit); } catch (ignore) {} }
  var events = listEvents_(now, new Date(now.getTime() + 3 * 3600000));
  try { cache.put('soon', JSON.stringify(events), 600); } catch (ignore) {}
  return events;
}

/** Morning rundown, once a day. */
function sendMorning_(now, props) {
  var hour = morningHour_();
  var today = fmt_(now).slice(0, 10);
  var h = Number(Utilities.formatDate(now, tz_(), 'H'));
  if (hour != null && h >= hour && h < hour + 3 && props.getProperty('LAST_MORNING') !== today) {
    props.setProperty('LAST_MORNING', today);
    var rundown = morningRundown_(today);
    if (rundown) notify_({ title: 'Good morning', message: rundown, tags: ['sunrise'] });
  }
}

function morningRundown_(today) {
  var events = weekEvents_().filter(function (e) { return e.start.slice(0, 10) === today && !e.all_day; });
  var open = listTodos_(false).filter(function (t) { return !t.parent; });
  var dueToday = open.filter(function (t) { return t.due === today; });
  var overdue = open.filter(function (t) { return t.due && t.due < today; });
  var lines = [];
  if (events.length) {
    lines.push(events.length + (events.length === 1 ? ' event' : ' events') + ', first: ' + events[0].title + ' at ' + niceTime_(events[0].start).replace(/^\w+ /, '') + '.');
  }
  if (dueToday.length) lines.push('Due today: ' + dueToday.slice(0, 3).map(function (t) { return t.title; }).join(', ') + (dueToday.length > 3 ? ' +' + (dueToday.length - 3) + ' more' : '') + '.');
  if (overdue.length) lines.push(overdue.length + ' overdue: ' + overdue[0].title + (overdue.length > 1 ? ' and more' : '') + '.');
  return lines.join('\n');
}

function notify_(n) {
  var payload = {
    topic: topic_(),
    title: n.title,
    message: n.message || ' ',
    tags: n.tags || [],
    priority: n.priority || 3,
    click: PropertiesService.getScriptProperties().getProperty('APP_URL') || DEFAULT_APP_URL
  };
  if (n.actions && n.actions.length) payload.actions = n.actions;
  // Google's connection to ntfy.sh sometimes fails for a moment
  // ("Address unavailable"), so try a few times before giving up.
  var lastErr;
  for (var attempt = 0; attempt < 4; attempt++) {
    if (attempt) Utilities.sleep(attempt * 3000);
    try {
      var resp = UrlFetchApp.fetch(NTFY_SERVER, {
        method: 'post', contentType: 'application/json',
        payload: JSON.stringify(payload), muteHttpExceptions: true
      });
      var code = resp.getResponseCode();
      if (code < 300) return;
      lastErr = new Error('ntfy said ' + code + ': ' + resp.getContentText().slice(0, 200));
      if (code < 500 && code !== 429) break;
    } catch (err) { lastErr = err; }
  }
  throw lastErr;
}

/** "Done" and "Snooze 1 hour" buttons on a to-do reminder. */
function todoActions_(id) {
  var url = PropertiesService.getScriptProperties().getProperty('WEB_APP_URL');
  if (!url) return [];
  var link = function (r) { return url + '?r=' + r + '&id=' + encodeURIComponent(id) + '&sig=' + sign_(r + ':' + id); };
  return [
    { action: 'http', label: 'Done', url: link('done'), method: 'GET', clear: true },
    { action: 'http', label: 'Snooze 1 hr', url: link('snooze'), method: 'GET', clear: true }
  ];
}

function reminderAction_(p) {
  var id = String(p.id || '');
  if (p.sig !== sign_(p.r + ':' + id)) return 'That link is not valid.';
  if (p.r === 'done') { var t = updateTodo_({ id: id, done: true }); return '✅ Done: ' + t.title; }
  if (p.r === 'snooze') {
    var later = fmt_(new Date(Date.now() + 3600000));
    var s = updateTodo_({ id: id, remind: later });
    return '😴 I\'ll remind you again at ' + niceTime_(later).replace(/^\w+ /, '') + ': ' + s.title;
  }
  return 'Unknown action.';
}

/** The app tells the brain its own address, so reminder buttons and taps know where to go. */
function rememberUrls_(body) {
  var props = PropertiesService.getScriptProperties();
  if (typeof body.url === 'string' && /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(body.url) && props.getProperty('WEB_APP_URL') !== body.url) {
    props.setProperty('WEB_APP_URL', body.url);
  }
  if (typeof body.appUrl === 'string' && /^https:\/\/[^\s]+$/.test(body.appUrl) && props.getProperty('APP_URL') !== body.appUrl) {
    props.setProperty('APP_URL', body.appUrl);
  }
}

function sign_(text) {
  var raw = Utilities.computeHmacSha256Signature(text, secret_());
  return Utilities.base64EncodeWebSafe(raw).replace(/=+$/, '').slice(0, 22);
}

function topic_() { return PropertiesService.getScriptProperties().getProperty('NTFY_TOPIC'); }

function remindersScheduled_() {
  return ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'sendReminders'; });
}

function eventLead_() {
  var v = PropertiesService.getScriptProperties().getProperty('EVENT_REMINDER_MINUTES');
  var n = v == null || v === '' ? DEFAULT_EVENT_REMINDER_MINUTES : Number(v);
  return isNaN(n) || n < 0 ? 0 : Math.min(n, 240);
}

function morningHour_() {
  var v = PropertiesService.getScriptProperties().getProperty('MORNING_HOUR');
  if (v == null || v === '') return DEFAULT_MORNING_HOUR;
  var n = Number(v);
  return isNaN(n) || n < 0 || n > 23 ? null : n;
}

function cleanRemind_(v) {
  if (v == null || v === '') return '';
  return fmt_(parseLocal_(v));
}

function niceTime_(s) { return Utilities.formatDate(parseLocal_(s), tz_(), 'EEE h:mm a'); }
function niceDay_(s) { return Utilities.formatDate(parseLocal_(s), tz_(), 'EEE MMM d'); }

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

function normDateTime_(v) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') return fmt_(v);
  return String(v).slice(0, 16);
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
