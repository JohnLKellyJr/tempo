# Setting up Tempo

About 30 minutes, once. You'll do everything on your Mac in a web browser, then finish on your iPhone. You don't need to write any code.

There are four parts:

1. Get a Claude API key (so Tempo can think)
2. Set up the "brain" in Google Apps Script (so Tempo can reach your calendar)
3. Open the app on your iPhone and connect it
4. Add the voice widget to your home screen

---

## Part 1: Get a Claude API key (5 min)

1. Go to **console.anthropic.com** and sign up (you can sign in with Google).
2. Click **Billing** and add credit. $5 is enough to start.
3. Click **API Keys**, then **Create Key**. Name it `Tempo`.
4. Copy the key (it starts with `sk-ant-`). Paste it in a note for a minute. **Don't share it with anyone.**

## Part 2: Set up the brain (15 min)

1. Go to **script.google.com** and sign in with your **personal Gmail** account (the one whose calendar you use).
2. Click **New project**. At the top left, click "Untitled project" and rename it `Tempo`.
3. You'll see a file called `Code.gs` with a few lines in it. Delete everything in it.
4. Open [`backend/Code.gs`](backend/Code.gs) from this repository, click the **copy** button (top right of the file), and paste it into the empty `Code.gs`. Press **⌘S** to save.
5. Click the **gear icon** (Project Settings) on the left.
   - Under **General settings**, check that the **Time zone** is yours.
   - Scroll to **Script Properties**, click **Add script property**.
     - Property: `ANTHROPIC_API_KEY`
     - Value: the key from Part 1
   - Click **Save script properties**.
6. Click the **< >** icon (Editor) on the left to go back to the code.
7. In the toolbar, make sure the dropdown next to **Run** says `setup`, then click **Run**.
   - Google will ask for permission. Click **Review permissions**, pick your account.
   - You'll see "Google hasn't verified this app". That's expected, because it's your own app. Click **Advanced**, then **Go to Tempo (unsafe)**, then **Allow**.
   - At the bottom you should see "✅ Setup done".
8. Click the blue **Deploy** button (top right), then **New deployment**.
   - Click the gear next to "Select type" and choose **Web app**.
   - Description: `Tempo`
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Click **Deploy**. (If it asks for permission again, allow it.)
9. The deploy box now shows a **Web app URL** ending in `/exec`. Click **Copy** and paste it into a note. (Ignore any URL ending in `/dev`: it only works on your computer.) You can always find it again under **Deploy → Manage deployments**.
10. Back in the editor, change the dropdown next to **Run** to `showAppKey` and click **Run**. At the bottom, copy just the long line of letters and numbers. This is your **app key**. Paste it into the same note. Treat it like a password.

> "Anyone" sounds scary, but nobody can use your brain without the app key, a long random code that only you have.

## Part 3: Open the app on your iPhone (5 min)

1. Make sure the note with your web app URL and app key is on your iPhone (Apple Notes syncs automatically).
2. On your iPhone, open **Safari** and go to **https://johnlkellyjr.github.io/tempo/**
3. Tap the **Share** button (square with an arrow), scroll down, and tap **Add to Home Screen**, then **Add**.
4. Open **Tempo** from your home screen.
5. Tap the **gear** (top right). Type your name, paste the **Web app URL** and the **App key** into their boxes, and tap **Save & connect**. If it can't connect, the message under the boxes says what to fix.

You should see your real calendar. Try tapping the mic and saying: *"Add study for bio exam Thursday from 7 to 9 pm."*

**The first time you tap the mic**, iPhone asks to allow the microphone and speech recognition. Tap **Allow**. If the mic button just opens the keyboard instead, tap the little mic on the keyboard to talk.

## Part 4: Add the voice widget (5 min)

This lets you talk to Tempo straight from your home screen without opening the app.

1. Open the **Shortcuts** app on your iPhone and tap **+**.
2. Name it `Ask Tempo` (tap the name at the top).
3. Add these actions, in order (use the search bar at the bottom to find each one):
   1. **Dictate Text**
   2. **Get Contents of URL**. Set the URL to your Apps Script web app URL (it starts with `https://script.google.com/macros/s/`). Tap the arrow to show more options:
      - Method: **POST**
      - Request Body: **JSON**
      - Add three **Text** fields:
        - `key` = your app key (see the note below)
        - `action` = `ask`
        - `text` = tap the field and choose **Dictated Text**
   3. **Get Dictionary Value**: get value for key `reply` in **Contents of URL**.
   4. **Show Notification** (or **Speak Text** if you'd like it read aloud): **Dictionary Value**.
4. Tap **Done**.
5. Long-press your home screen, tap **Edit** then **Add Widget**, search **Shortcuts**, pick the small size, and choose **Ask Tempo**.

You can also say **"Hey Siri, Ask Tempo"**.

> **Where's my app key and web app URL?** The same ones from your note. In Apps Script, the URL is under **Deploy → Manage deployments**, and running `showAppKey` prints the key again.

## Part 5: The Tempo calendar widget (5 min, optional)

A square or wide widget that looks like the Google Calendar one: today's date, your next events and your to-dos. Tapping it starts **Ask Tempo** so you can talk straight away.

1. Install **Scriptable** from the App Store (free).
2. On your iPhone, open [the widget script](https://raw.githubusercontent.com/JohnLKellyJr/tempo/main/widget/Tempo%20Widget.js) in Safari. Press and hold on the text, tap **Select All**, then **Copy**.
3. Open **Scriptable**, tap **+** (top right), and paste. Tap the title at the top and name it **Tempo Widget**. Tap **Done**.
4. Tap the **Tempo Widget** tile to run it once. Paste your **Web app URL** and **App key** when it asks, and tap **Save**. You'll see a preview.
5. Go to your home screen, long-press an empty spot, tap **Edit → Add Widget**, search **Scriptable**, choose the **small** (square) or **medium** (wide) size, and tap **Add Widget**.
6. While the icons are still jiggling, tap the new widget. Set **Script** to **Tempo Widget** and **When Interacting** to **Open URL**. Tap outside to finish.

The widget refreshes about every 15 minutes (iPhone decides the exact timing). Tapping it runs the **Ask Tempo** shortcut from Part 4, so make sure that shortcut has exactly that name. If you'd rather a tap open the Tempo app, type `app` in the widget's **Parameter** box.

## Part 6: Reminders on your iPhone (5 min)

Tempo can buzz your phone when a task's reminder time comes, 15 minutes before each calendar event, and with a short rundown at 8 am. Notifications come through **ntfy**, a free app. You don't need an account.

1. On your iPhone, install **ntfy** from the App Store (the white app with a green notification bubble). Open it and allow notifications.
2. On your Mac, go to **script.google.com**, open **Tempo**, and replace everything in `Code.gs` with the newest [`backend/Code.gs`](backend/Code.gs). Press **⌘S**.
3. Change the dropdown next to **Run** to `setupReminders` and click **Run**. Google asks for permission once more (Tempo now needs to run on a timer): **Review permissions → Advanced → Go to Tempo (unsafe) → Allow**.
4. At the bottom, copy the topic name it prints (it starts with `tempo-`).
5. In ntfy on your iPhone, tap **+**, paste the topic name, and tap **Subscribe**. Then run `setupReminders` once more so a "Tempo reminders are on" test arrives on your phone (the first run happened before you subscribed, so that one is missed).
6. Back in Apps Script: **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**.

Now say things like *"Remind me to call Mom at 5"* or *"Remind me to leave 30 minutes before my dentist appointment"*. You can also tap any task and set **Remind me**. Reminders for tasks have **Done** and **Snooze 1 hr** buttons (press and hold the notification to see them). Tempo → Settings shows your topic and has a **Send a test reminder** button.

The topic name works like a password: anyone who knows it could read your reminders, so don't share it.

**Changing the timing** (optional), in Project Settings → Script Properties:

| Property | What it does | Default |
|---|---|---|
| `EVENT_REMINDER_MINUTES` | Minutes before each event. `0` turns event nudges off (handy if Outlook already alerts you). | `15` |
| `MORNING_HOUR` | Hour of the morning rundown, `0` to `23`. `off` turns it off. | `8` |

To turn all reminders off, run `stopReminders`.

## On your Mac

- Open the same address in Safari, then choose **File → Add to Dock**. Tempo opens as its own app.
- The **Ask Tempo** shortcut syncs to your Mac. In the Shortcuts app on the Mac, right-click it and choose **Add to Menu Bar** (or pin it in the menu bar), so it's one click away.

## Your school (Outlook) calendar

To let Tempo see your classes so it won't double-book you:

1. On your Mac, sign in to **outlook.office.com** with your school account.
2. Go to **Settings (gear) → Calendar → Shared calendars → Publish a calendar**. Choose your calendar and **Can view all details**, then **Publish**. Copy the **ICS** link.
3. Open **calendar.google.com** (personal Gmail). On the left, next to **Other calendars**, click **+** then **From URL**. Paste the link and click **Add calendar**.

Tempo will now show your school events too (it can read them but not change them). If your school has turned off publishing, skip this; you can tell Tempo your class times instead.

## If something goes wrong

| What you see | What to do |
|---|---|
| "Wrong app key" | Run `showAppKey` in Apps Script and paste the key again in Settings. |
| "Google sent back a sign-in page" | **Deploy → Manage deployments → ✏️ Edit**: set **Who has access** to **Anyone** (not "Anyone with Google account"), then **Deploy**. |
| "That URL ends in /dev" | Copy the URL ending in `/exec` from **Deploy → Manage deployments**. |
| "Add your Claude API key…" | Part 2, step 5: check `ANTHROPIC_API_KEY` is spelled exactly like that. |
| "Your Claude account is out of credit" | Add credit at console.anthropic.com → Billing. |
| You changed `Code.gs` and nothing changed in the app | Apps Script needs a new version: **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**. |
| No reminders arrive | In Tempo → Settings, tap **Send a test reminder**. If nothing comes, check the topic in ntfy matches exactly, and that ntfy is allowed to send notifications (iPhone Settings → ntfy). |
| Anything else | Send me a screenshot. |

## Changing which Claude model it uses

Tempo uses **Claude Haiku 5.5** by default, which is fast and costs well under $1 a month for normal use. If it struggles with complicated requests, switch to the smarter **Claude Opus 5.5** by adding a Script Property `MODEL` with value `claude-opus-5-5` (roughly $15 to $25 a month). No redeploy is needed.
