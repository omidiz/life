# Life — personal dashboard

Big black & white boards, one for each part of your life. Write your tasks and see everything at once, every day.
It's an installable web app (PWA) that works offline.

- **Pages**: the bar at the top switches between pages (e.g. Home, School, Work), each with its own cards.
  `+` adds a page, double-click a tab to rename it, × on the current tab deletes it. ⇢ on a card moves it to another page.
- **Whiteboard**: boards are cards on a dotted canvas. Drag a card by its title bar or empty space to put it anywhere,
  resize it from the bottom-right corner, and double-click empty canvas (or press `+ New board`) to make a new card.
  Positions and sizes sync. On a phone the cards stack in one column.
- **Cards**: tap a title to rename it; A− / A+ make that card's text smaller or bigger; ○ changes the colour; × deletes.
- **Text size**: ⋯ → Text size scales all text on this device (it doesn't sync, so phone and laptop can differ).
- **Write straight on a board**: tap anywhere on it and type, like a page. Enter starts a new line.
  Start a line with `[] ` for a task, `- ` for a list item or `# ` for a heading, or tap **Text · Task · List · Heading**
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
([create one](https://github.com/settings/tokens/new?scopes=gist&description=Life%20dashboard%20sync)).
Do the same on each device. Your data is stored in a secret gist named `life-dashboard.json` on your account.

- Works offline. Changes sync when the device is back online, when you open the app, and every minute while it's open.
- Changes from different devices are merged record by record (the newest edit wins), so nothing is overwritten wholesale.
- The token is stored only in that device's browser. To revoke access, delete the token on GitHub.

Without sync, data stays on the device. ⋯ → Export / Import works as a manual backup either way.

Run locally: `python3 -m http.server` and open http://localhost:8000
