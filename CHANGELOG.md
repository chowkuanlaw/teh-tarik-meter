# Changelog

## 1.3.1 (2026-10-18)

- **Every drink's show has its own captions.** Before, all five shows opened with the same line, teh ais reused teh tarik's first three steps, and several steps and bows shared titles ("Tarik! Tarik! Tarik!", "Ais!", "Back to work lah"). Now each drink has its own words for all seven moments, in English and Bahasa Melayu, for example "Ten pokes?! Need kopi ah?", "Step 3 · Tarik sejuk!" (teh ais) and "Step 4 · Ais & rahsia" (Milo ais).
- The glass's "Sign in so I can watch your…" and one of its poke replies now name your drink instead of always saying teh tarik.
- A test now fails if two drinks ever share a caption.

## 1.3.0 (2026-10-18)

- **Peek at a sample.** When you're signed out, "Peek at a sample first" shows the widget, the forecast and the History tab with made-up numbers. Nothing is fetched or saved, no alerts fire, and signing in (or "Back to sign in") ends it.
- **Claude Code connection moved to your user folder**, `%USERPROFILE%\.teh-tarik-meter`. The Microsoft Store version runs as a package, and Windows keeps a package's AppData private, so Claude Code couldn't have reached the old place. If you're already connected, the app moves it over by itself the next time it starts, with the same status line. Disconnecting now also deletes the script.
- **Trademark notes** in Settings › About and the README: Teh Tarik Meter isn't made or endorsed by Anthropic (Claude is Anthropic's trademark), and Milo is a trademark of Nestlé, used only as a drink name.
- **Release notes now include the changelog** for that version.
- **Bahasa Melayu touch-ups** across the widget, alerts and the show captions.
- Microsoft Store listing text, screenshots and certification notes are in the `store` folder.

## 1.2.0 (2026-10-18)

- **An easter egg for every drink.** Poke the glass 10 times and the show now makes the drink you picked:
  - **Kopi O:** coffee through the sock, a spoon of sugar and no milk, three pulls, served hot and black.
  - **Teh ais:** the teh tarik steps, then ice into the glass with a clink, and the tea poured over.
  - **Milo ais:** two scoops of powder, hot water from the kettle, *Kacau! ×3*, ice, and a surprise heap of powder on top (Milo dinosaur).
  - **Sirap bandung:** rose syrup, milk swirling it pink, a stir instead of a pull, and lots of ice.
  - Teh tarik stays as it was. Captions are in English and Bahasa Melayu, and the music adds spoon and ice clinks.

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
