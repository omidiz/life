# os — personal dashboard

Big black & white boards, one for each part of your life. Write your tasks and see everything at once, every day.
It's an installable web app (PWA) that works offline.

- **Pages**: the bar at the top switches between pages (e.g. Home, School, Work), each with its own cards.
  `+` adds a page (Boards or Notepad), double-click a tab to rename it, × on the current tab deletes it. ⇢ on a card moves or copies it to another page.
- **Notepad pages**: `+` → **Notepad** gives a blank sheet to write anything, like a simple Word page.
  The toolbar (or shortcuts at the start of a line) adds headings (`# `, `## `), bullet lists (`- `), numbered lists (`1. `),
  tasks you can tick (`[] `), quotes (`> `) and **bold** / *italic* / underline (Ctrl/⌘ B, I, U).
  **✎ Draw** turns on a pen to write on top of the page: tick, circle, underline or highlight your text (pens, highlighter,
  thin/thick, eraser, undo, clear; Done goes back to typing). It saves as you type, shows a word count, and syncs.
- **Sheets**: a notepad page can hold several sheets. **+ Sheet** in the toolbar adds one to the left, right, above or
  below the sheet you're writing in; drag a sheet's left or right edge to make it wider or narrower; × deletes a sheet.
  **⇢ Board** turns a sheet into a card on a board page (first heading = title, lists, tasks and notes carry over).
- **English and Farsi**: every line picks its own direction, so Farsi runs right-to-left and English left-to-right, with
  checkboxes and bullets on the right side. ⇆ in the notepad toolbar forces a line to RTL or LTR. The date, the Persian date and a live Tehran clock stay on screen in the header under the top bar.
- **Whiteboard**: boards are cards on a dotted canvas. Drag a card by its title bar or empty space to put it anywhere,
  resize it from the bottom-right corner, and double-click empty canvas (or press + in its top-right corner) to make a new card.
  Positions and sizes sync. The + in the top-right corner of the board area adds a card. On a phone the cards stack in one column.
- **Cards**: tap a title to rename it; ○ changes the colour; × deletes. ⇢ moves a card to another page or copies it (to this page or any other), with everything on it.
- **Bold**: select words and press Ctrl/⌘ B (again to undo), or press it before typing. On a phone, use **B** in the bar under the line.
- **Line size**: with the cursor in a line, Ctrl/⌘ + makes it bigger, Ctrl/⌘ − smaller, Ctrl/⌘ 0 resets. On a phone, use A− / A+ in the bar under the line.
- **Text size**: ⋯ → Text size scales all text on this device (it doesn't sync, so phone and laptop can differ).
- **Write straight on a board**: tap anywhere on it and type, like a page. Enter starts a new line.
  Start a line with `[] ` for a task, `- ` for a list item, `1. ` for a numbered list (1. 2. 3. …) or `# ` for a heading, or tap **Text · Task · List · 1. List · Heading**
  under the line you're writing. In a task or list, Enter makes the next one; Enter on an empty one turns it back into text.
  Shift+Enter adds a line break inside a paragraph. Backspace on an empty line removes it.
  Tap the circle to tick a task off; finished tasks stay crossed out until the end of the day, then tidy themselves away.
- **Drag** the ⋮⋮ handle (left of each item) to reorder, or drop it on another board to move it there.
- **Deadlines (optional)**: tap the clock next to a task to pick a date, and a time if you want.
  The task then shows how long is left: "3 h left", "Due today", "4 days left", "2 days late". Late tasks turn black,
  and tasks due within a day get an outline.
- Light / dark with ◐. Right-to-left text (Persian, Arabic…) lines up on its own.

## Sync between devices

Open ⋯ → **Sync** and paste a GitHub token that has only the `gist` permission
([create one](https://github.com/settings/tokens/new?scopes=gist&description=os%20dashboard%20sync)).
Do the same on each device. Your data is stored in a secret gist named `life-dashboard.json` on your account.

- Works offline. Changes sync when the device is back online, when you open the app, and every minute while it's open.
- Changes from different devices are merged record by record (the newest edit wins), so nothing is overwritten wholesale.
- The token is stored only in that device's browser. To revoke access, delete the token on GitHub.

Without sync, data stays on the device. ⋯ → Export / Import works as a manual backup either way.

## Telegram bot

A private AI assistant in Telegram, like ChatGPT or Gemini but personal: it chats about anything with live answers,
remembers you, reads photos, voice, PDFs, files and links, makes pictures, manages this dashboard (tasks, reminders,
morning brief) and can even propose changes to its own code. Works with any OpenAI-compatible AI service.
Set-up and details (in Farsi): [bot/README.md](bot/README.md).

Run locally: `python3 -m http.server` and open http://localhost:8000
