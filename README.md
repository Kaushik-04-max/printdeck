# PrintDeck

**Turn an old Android phone into a smart 3D-printer controller.**

PrintDeck runs [OctoPrint](https://octoprint.org) on your phone and gives it a clean, touch-first dashboard, so you can start, watch and manage prints without a Raspberry Pi and without OctoPrint's desktop-style web UI.

PrintDeck is a redesigned fork of [octo4a](https://github.com/feelfreelinux/octo4a) by feelfreelinux and contributors, which does the hard work of running OctoPrint on Android. Many thanks to them.

## What's different

- **New dashboard** built into the app: live progress ring, nozzle and bed temperatures with sparklines, camera view, file library with drag-and-drop upload, jog controls and a G-code console.
- **Watchdog tab**: local rules that alert you about runaway or stuck heaters, temperature drops, lost connections and finished or failed prints, with an optional auto-pause.
- **Refreshed native screens**: dark and light friendly, consistent type and colour.
- **No telemetry.** The bug-reporting SDK was removed entirely.
- **No screen pinning**, so the app behaves like a normal app.
- The classic OctoPrint web UI is still there at `http://<phone-ip>:5000`.

## Install

1. Download the latest `PrintDeck-x.y.z.apk` from the [Releases](../../releases) page.
2. Allow installing apps from this source when Android asks.
3. Open PrintDeck and tap **Install OctoPrint**. It needs an internet connection and takes a few minutes.
4. Plug your printer into the phone with a USB OTG cable and power it on.
5. Open the dashboard and tap **Connect**.

> Some phones can't charge while using USB OTG. Check that yours copes with that before leaving a long print unattended.

## Build from source

Requirements: JDK 11, Android SDK (platform 28, build-tools 30.0.3, NDK 21.4.7075529, CMake 3.18.1).

```bash
cd app
./gradlew assembleDebug
```

For a signed release, create `keystore.properties` in `app/` (it is git-ignored):

```properties
storeFile=/path/to/your.jks
storePassword=...
keyAlias=...
keyPassword=...
```

then run `./gradlew assembleRelease`.

The dashboard is plain HTML, CSS and JavaScript in `app/app/src/main/assets/dashboard/`. It has no build step and talks to OctoPrint's REST API with the key it reads from the app.

## Credits and licence

Based on octo4a, © feelfreelinux and contributors. Licensed under the [GNU AGPL v3](LICENSE.md). If you distribute a modified build, you must publish its source under the same licence.

Dashboard font: [Chakra Petch](https://fonts.google.com/specimen/Chakra+Petch), SIL Open Font License.
