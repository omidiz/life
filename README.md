# Life — personal dashboard

Big black & white boards, one for each part of your life. Write your tasks and see everything at once, every day.
It's an installable web app (PWA) that works offline.

- **Boards**: Study, Work, Personal, Health to start with. Tap a title to rename it; `+ New board` adds one; ← → reorders; × deletes.
- **Tasks**: type in `+ Add a task` and press Enter. Tap the text to edit it, tap the circle to tick it off.
  Finished tasks stay crossed out until the end of the day, then tidy themselves away.
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
