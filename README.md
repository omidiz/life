# Life — personal dashboard

Minimal black & white dashboard for study, work and life. It's an installable web app (PWA) that runs offline.

- **Today**: one focus for the day, what's due, habits, quick stats
- **Tasks**: grouped by area (Study, Work, Personal, Health; you can edit the list in the ⋯ menu), with due dates
- **Habits**: 7-day grid and streaks
- **Notes**: quick notes that save as you type
- **Focus**: 25/50-minute timer that logs time per area

## Sync between devices

Open ⋯ → **Sync** and paste a GitHub token that has only the `gist` permission
([create one](https://github.com/settings/tokens/new?scopes=gist&description=Life%20dashboard%20sync)).
Do the same on each device. Your data is stored in a secret gist named `life-dashboard.json` on your account.

- Works offline. Changes sync when the device is back online, when you open the app, and every minute while it's open.
- Changes from different devices are merged record by record (the newest edit wins), so nothing is overwritten wholesale.
- The token is stored only in that device's browser. To revoke access, delete the token on GitHub.

Without sync, data stays on the device. ⋯ → Export / Import works as a manual backup either way.

Run locally: `python3 -m http.server` and open http://localhost:8000
