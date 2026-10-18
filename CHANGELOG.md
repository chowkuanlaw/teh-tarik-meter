# Changelog

## 1.1.0 (2026-10-18)

- **Burn-rate forecast.** Under your session, the widget says when the glass runs out at your current pace ("At this pace: runs out 3:40 PM") or that it lasts till the refill. The week gets the same. An optional alert warns you before you run out.
- **Settings window** with five tabs: General, Look, Claude, History and About. Open it from the gear on the widget or the tray menu.
- **Usage history chart** for today's session and the past week. Readings are kept for 8 days in `history.json`.
- **First-launch welcome:** pick a language and drink, sign in, and connect Claude Code.
- **Pick your drink:** teh tarik, kopi O, Milo ais, teh ais or sirap bandung. Iced drinks get ice cubes instead of steam. The weekly cups and the tray icon follow.
- **Dark mode**, or follow Windows.
- **Bahasa Melayu** for every screen, alert, the tray menu and the teh tarik show.
- **Text size:** Normal, Large or Larger.
- **Compact widget:** a small strip with the glass, your session and the week.
- **Hides itself in full screen and presentations**, using the same Windows check as Lapis.
- **Ctrl+Alt+T** shows or hides the widget.
- **Festive outfits** for Hari Raya, Chinese New Year, Deepavali, Kaamatan, Gawai, Merdeka, Malaysia Day and Christmas, with a greeting on the day.
- **"Fresh glass ready" alert** when your session resets after you hit the limit.
- **Organization picker** if you have more than one claude.ai organization.
- **Extra usage credits** shown when your plan uses them.
- **Format warning:** if claude.ai changes its usage page so the numbers can't be read, the widget says so, you get one notification, and it checks for an update.
- **"What's new"** link after each update.
- **Daily backup** of your settings (`state.bak.json`); if `state.json` can't be read, the app picks up from the backup and tells you.
- **The uninstaller asks** whether to remove your data too (No keeps it for a reinstall). It never asks during updates.
- **Microsoft Store package** (`npm run dist:store`, or the Store package workflow). The Store copy never updates itself and starts with Windows through the Store's startup task.

## 1.0.0 (2026-10-18)

First release: the living teh tarik glass, weekly cups, live claude.ai usage, the Claude Code status line feed, alerts, the tray icon and the 10-poke teh tarik show.
