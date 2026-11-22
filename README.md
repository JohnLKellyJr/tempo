# Tempo

A personal assistant for your calendar and to-do list. Talk or type to it ("study for bio Thursday 7 to 9, and remind me to email Prof. Lee") and it adds the event to Google Calendar and the task to its own to-do list.

- **The app** (`docs/`, which GitHub Pages serves): a home-screen web app for iPhone and Mac. Plain HTML, CSS and JavaScript with no build step, hosted on GitHub Pages.
- **The brain** (`backend/Code.gs`): a Google Apps Script in your own Google account. It calls Claude, reads and writes Google Calendar, and keeps the to-do list in a private Google Sheet.

**Setup:** follow [SETUP.md](SETUP.md).

## How it fits together

```
iPhone / Mac app  ──►  Apps Script web app  ──►  Claude API
  (GitHub Pages)        (your Google account)     (tool use)
                              │
                              ├─► Google Calendar (read all calendars, write personal)
                              └─► Google Sheet "Tempo to-do list"
```

## Trying the app without setup

Open `docs/index.html` with any local web server (for example `python3 -m http.server` inside `docs/`). Until you paste a connection code, it shows sample data.
