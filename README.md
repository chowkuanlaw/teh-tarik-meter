# Teh Tarik Meter

Your Claude usage as a living glass of teh tarik. A small Windows desktop widget, a sibling of [Lapis](https://github.com/chowkuanlaw/lapis-stretch), that shows your **session** and **weekly** limits live.

## What it does

- **A glass that drains as you chat.** The tea level is your current session. Steam curls up, the foam ripples, the glass blinks and bobs. A countdown ticks to your next refill.
- **Moods.** Below 50% used it smiles and waves. As usage climbs it gets calm, then worried with a cold drip at 80%, then shaking at 95%. When you're out, it falls asleep.
- **Seven cups for the week.** Your weekly limit is a row of cup buddies. Full ones bob, empty ones sleep. Per-model weekly caps (such as Opus or Fable) are listed underneath when your plan has them.
- **A real tarik at reset.** When your session refills, a pulling mug pours fresh teh tarik into the glass.
- **Alerts** at 80% and 95% for the session, the week and per-model caps, once per window, in Windows notifications.
- **Tray icon that drains too,** with your numbers on hover. Left-click shows or hides the widget; right-click opens the menu.
- **Burn-rate forecast.** "At this pace: runs out 3:40 PM", or that it lasts till the refill, with an optional alert before you run out.
- **Settings, history and a welcome.** A settings window (gear on the widget, or the tray menu) with a usage history chart for today and the week.
- **Peek before you sign in.** "Peek at a sample first" on the signed-out widget shows everything with made-up numbers. Nothing is fetched or saved, and signing in ends it.
- **Your drink, your look.** Teh tarik, kopi O, Milo ais, teh ais or sirap bandung. Dark mode, Bahasa Melayu, bigger text and a compact strip.
- **Stays out of the way.** Hides itself in full screen and presentations; Ctrl+Alt+T shows or hides it.
- **Festive outfits** for Hari Raya, Chinese New Year, Deepavali, Kaamatan, Gawai, Merdeka, Malaysia Day and Christmas.
- **More alerts:** "fresh glass ready" after you hit the limit, and a warning if claude.ai changes its usage page.
- **Poke the glass.** It reacts. Poke it 10 times in 4 seconds for a full-screen show with chimes that makes your drink from start to finish: teh tarik and kopi O are pulled, teh ais gets ice, Milo ais is topped dinosaur style and sirap bandung swirls pink (Skip or Esc ends it).

## Where the numbers come from

1. **claude.ai.** These are the same numbers as Settings › Usage, read with your own sign-in. The widget checks every 15 seconds while your usage is moving, then slows down step by step to every 2 minutes when it's quiet. It also checks right away when you hover the widget, wake the PC or press **Refresh now**. It pauses while your PC is locked or asleep. claude.ai doesn't publish this as an official API, so a change on their side could break it until an update.
2. **Claude Code (optional, instant).** Claude Code hands its status line your limits after every reply. **Connect Claude Code** in the tray menu sets this up, and the glass moves the moment a reply lands. Your existing status line keeps working.

The newer reading always wins. The footer shows when it last synced and from where.

## Install

Download `TehTarikMeter-Setup-<version>.exe` from [Releases](https://github.com/chowkuanlaw/teh-tarik-meter/releases/latest) and run it. Windows SmartScreen may warn because the installer isn't signed: click **More info**, then **Run anyway**. It installs for you only, starts with Windows, and updates itself from this repository's releases.

### First run

1. Click **Sign in to Claude** on the widget and sign in on claude.ai's own page. The window closes by itself once you're in.
   - If Google sign-in is blocked there ("this browser may not be secure"), use the email code instead. Or click **Use a session key instead** and paste the `sessionKey` cookie from claude.ai in your browser (DevTools › Application › Cookies).
2. Right-click the tray icon and choose **Connect Claude Code (instant updates)**. It asks first and backs up your `settings.json`.

## Tray menu

Show/hide the widget · Refresh now · Settings · Compact widget · Keep on top · Connect/Disconnect Claude Code · Open claude.ai usage page · Sign in/Sign out · Check for updates · Quit. Everything else is in Settings.

## Microsoft Store

`npm run dist:store` (on Windows) builds `TehTarikMeter-Store-<version>.appx`, or run the **Store package** workflow. Set the repository variables `STORE_IDENTITY_NAME`, `STORE_PUBLISHER`, `STORE_PUBLISHER_NAME`, `STORE_DISPLAY_NAME` and `STORE_PRODUCT_ID` from Partner Center first. The listing text (English and Bahasa Melayu), screenshots, certification notes and a test list are in [`store/`](store/listing.md). The Store copy keeps the Claude Code bridge in `%USERPROFILE%\.teh-tarik-meter`, because Windows keeps a packaged app's AppData private.

## Privacy

See [PRIVACY.md](PRIVACY.md). In short: the app only talks to claude.ai (your usage numbers, never your chats) and GitHub (updates). Your sign-in stays in Electron's encrypted cookie store. The Claude Code script keeps only the limit numbers.

## Develop

```
npm install
npm test                 # automatic tests
npm start                # run against your real claude.ai account
npm run demo             # fake numbers, no network (TTM_DEMO_SESSION=85, TTM_LANG=ms, TTM_THEME=dark, TTM_FESTIVAL=raya, TTM_DEMO_HISTORY=1)
npm run dist:installer   # build the Windows installer into dist/installer
```

To release, bump `version` in `package.json`, add a `## <version>` section to `CHANGELOG.md`, commit, then either push a tag `v<version>` or run the **Release** workflow from the Actions tab with that tag. It tests, builds on Windows, smoke-tests the app and publishes the installer, with that version's changelog as the release notes.

## Trademarks

Teh Tarik Meter is an independent app. It is not made, endorsed or supported by Anthropic. Claude is a trademark of Anthropic, PBC. Milo is a trademark of Société des Produits Nestlé S.A., used here only as the name of a drink; Teh Tarik Meter is not connected with Nestlé.

## Licence

MIT. Fonts: Baloo 2 and Nunito, SIL Open Font License (see `renderer/fonts`).
