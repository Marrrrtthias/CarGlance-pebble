# Changelog

## Unreleased

- The watch app is now built on [pebble-ui](https://github.com/michaelthatsit/pebble-ui), Pebble's native widgets for Alloy. The dashboard looks the same, with its text a few pixels lower so it lines up with the icons and the footer text is centred; the car picker is now a standard Pebble menu and slides in and out like other Pebble windows.
- The car picker also opens with the Down button.

## 1.1.0 – 2026-11-08

- New app icon: the car from the car picker button now appears in the watch's app launcher.

## 1.0.1 – 2026-11-08

- Bugfix: The app no longer shows an error after not having been used for a while.

## 1.0.0 – 2026-11-08

First release.

- Shows door lock state, charging state (with time remaining) and battery level of your Hyundai, Kia or Genesis car (EU only, via the Pleos Vehicle Data API).
- Refreshes every 10 minutes, or on demand with Select or by tapping the refresh icon.
- Footer shows how old the car's data is and turns yellow after an hour.
- Car picker for accounts with several vehicles; the choice is remembered.
- Settings page with step-by-step instructions for getting API credentials.
- Demo mode: enter `demo` as the Client ID to try it without an account.
