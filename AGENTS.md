# AGENTS.md

## What this is

CarGlance is a Pebble watchapp (Pebble Time 2 / `emery` only) showing door lock, charging and battery state of a Hyundai/Kia/Genesis car via the Pleos Vehicle Data API (`api.pleos.ai`, EU only). The README covers user-facing features, credentials setup and architecture in detail.

## Commands

Requires the Pebble SDK (`pebble` tool, SDK 4.33+). There is no linter.

```bash
node --test tests/token-refresh.test.cjs   # phone-side token tests (Node.js, no SDK needed)
git submodule update --init                # once, fetches pebble-ui
pebble package install @rebble/clay        # once, installs dependencies
pebble build                               # produces build/*.pbw (run `pebble clean` after changing resources)
bash pebble-ui/tools/sizes.sh .            # compiled size against the emulator's ~43 kB ceiling
pebble install --emulator emery --logs     # run in emulator with logs
pebble emu-app-config --emulator emery     # open settings page (second terminal)
pebble login && pebble install --cloudpebble   # install on a real watch (Dev Connection enabled)
```

Enter `demo` as the Client ID in settings to get sample data without an account.

## Architecture

Two JavaScript runtimes connected by AppMessage:

- **Watch — `src/embeddedjs/`** (Alloy: Moddable XS + Piu, with the [pebble-ui](https://github.com/michaelthatsit/pebble-ui) widget library as a git submodule in `pebble-ui/`; the `using-pebble-ui` skill covers its workflow and memory budget). Never touches the network. Modern JS (ES modules, `const`/`let`) is fine here.
  - `main.js`: the Piu `Application` with pebble-ui's `WindowStack`; home window `dashboard`.
  - `car.js`: the `car` object (`state.status`: `loading` | `ok` | `nocreds` | `error`, `refreshing`, `vehicles`, `vehicleIndex`), the `Message` to the phone, the 10-minute auto refresh. Every change calls `distribute("onCarChanged")`; status `loading`/`nocreds` pops the picker.
  - `windows/dashboard.js`: a pebble-ui `View` rebuilt from `car` on each `onCarChanged`; footer age updates on `onMinuteChanged`. Select or a tap on the refresh icon sends `REFRESH`; Down or a tap on the car icon opens the picker. Text uses pebble-ui's `textLayerStyle` (TextLayer positions, a few px lower than Poco drew at the same `top`). Glyphs are bitmap sprite sheets (one 36 px state per variant) from `tools/make_icons.py`, stored as `pbi` (`storageFormat` in `package.json`) so the firmware doesn't have to decode PNGs in the app heap (as PNGs they failed to load).
  - `windows/picker.js`: pebble-ui's `SubtitleMenu` with touch (tap a row, drag to scroll).
  - `src/c/mdbl.c` and `config.creation` in `manifest.json` set the machine sizes pebble-ui needs (stack 5120, slot 45056, chunk 21504); keep them in sync. Map only the pebble-ui modules in use in `manifest.json`.
- **Phone — `src/pkjs/index.js`** (PebbleKit JS). Written in ES5 style (`var`, callbacks, `XMLHttpRequest`); keep it that way. Flow per refresh: personal token → vehicle lookup via `/v1/vehicles/consent` (cached) → `/status` and `/batteries` in parallel → reduced to a flat payload sent to the watch. No refresh token exists. A cached token is reused only if its JWT `exp` is more than a minute away; otherwise a new one is fetched, and parallel requests share that renewal. If the API rejects a cached token (HTTP `TOKEN_HTTP_STATUSES` or API `TOKEN_ERRORS`), the token is refetched and the request retried once; a just-issued token is never retried. Saving settings bumps `configGeneration`, and responses to requests started before that are dropped silently. `inflightVin` prevents overlapping refreshes for the same car. Run the token tests after changing this flow.
- **Settings — `src/pkjs/config.js`** (Clay, `autoHandleEvents: false`). `webviewclosed` in `index.js` saves settings to `localStorage` and clears the cached token and vehicle. Credentials stay on the phone and are never sent to the watch.
- **Emulator settings workaround:** `configUrl()` in `index.js` rewrites Clay's HTTP-only S3 proxy URL into a `data:` URI because HTTPS-forcing browsers can't load the proxy. Don't remove it.

### Message keys must stay in sync

Adding or renaming a value passed between phone and watch requires updating **both** `pebble.messageKeys` in `package.json` and the `keys` array of the `Message` in `src/embeddedjs/car.js`. Its `input` buffer (1 kB) must hold the largest message (the car list).

## Secrets

Real Client ID/Secret/VIN entered in the emulator live outside the repo (Pebble SDK localstorage, `~/pebble-tool-emu-app-config-*.html`).
