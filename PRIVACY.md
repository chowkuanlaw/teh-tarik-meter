# Privacy

Teh Tarik Meter runs on your PC and has no server of its own. It sends nothing about you anywhere else.

## What it talks to

- **claude.ai**, as you. It reads the same numbers as your Settings › Usage page: your organization list (to know whose usage to read) and your usage limits. It never reads your chats, projects or files.
- **GitHub**, to check this repository's releases for updates (installed copies only).

That's all the network traffic it makes. (The Microsoft Store copy doesn't check GitHub; the Store updates it.)

## Hiding in full screen

To hide the widget during full screen apps and presentations, the app asks Windows every few seconds whether an app is full screen or presenting (`SHQueryUserNotificationState`, the same check as Lapis). It never looks at your screen, microphone or camera. Turn off **Hide the widget in full screen and presentations** in Settings to stop it.

## Your claude.ai sign-in

You sign in on claude.ai's own page, in a private browser window inside the app. The sign-in cookie stays in Electron's cookie store, which is encrypted with your Windows account (the app is built with cookie encryption on). The app never copies it to a file of its own, logs it or sends it anywhere except claude.ai. **Sign out** in the tray menu clears it.

If you paste a session key instead, it goes straight into that same encrypted cookie store.

## Claude Code

If you choose **Connect Claude Code**, the app:

- sets Claude Code's status line (in `%USERPROFILE%\.claude\settings.json`) to a small script, after asking you and saving a backup as `settings.json.before-teh-tarik`;
- copies that script to `%USERPROFILE%\.teh-tarik-meter\statusline\`. This folder is outside AppData so it also works in the Microsoft Store copy, where Windows keeps an app's AppData private and Claude Code couldn't reach it.

After each reply, Claude Code gives the script a JSON object. The script keeps **only** the usage limits: the used percentage and reset time for the 5-hour and 7-day windows. It writes them to `%USERPROFILE%\.teh-tarik-meter\claude-code-feed.json`. Your prompts, file paths, session ids and everything else are ignored.

If you already had a status line, the script runs it and shows its output, so your status line looks the same. **Disconnect Claude Code** puts your original status line back and deletes the script and the saved limits.

## Files on your PC

Everything lives in `%APPDATA%\Teh Tarik Meter\`:

- `state.json`: settings, widget position, your last usage reading and which alerts were already sent, plus a daily copy, `state.bak.json`
- `history.json`: your session and weekly usage percentages over the last 8 days, for the History chart and the forecast
- the encrypted browser profile for claude.ai

When you uninstall, the app asks whether to remove this folder too.

If you connected Claude Code, `%USERPROFILE%\.teh-tarik-meter\` holds the status line script and `claude-code-feed.json` (the latest limits). Uninstalling leaves it so Claude Code's status line keeps working; choose **Disconnect Claude Code** first to remove it.
