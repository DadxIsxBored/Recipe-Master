# Browser and mobile support

Recipe Master uses one Manifest V3 source tree for Chromium, Firefox, and Safari Web Extensions. It selects `browser.*` when supplied by the browser and falls back to `chrome.*` on older Chromium releases.

## Compatibility matrix

| Platform | Status | Installation route |
| --- | --- | --- |
| Chrome desktop | Supported | Chrome Web Store or unpacked extension |
| Brave desktop | Supported and browser-tested | Chrome Web Store or unpacked extension |
| Edge desktop | Supported | Edge Add-ons, Chrome Web Store, or unpacked extension |
| Opera desktop | Supported | Opera Add-ons, Chrome Web Store, or unpacked extension |
| Vivaldi and other Chromium desktop browsers | Supported | Chrome-compatible package or unpacked extension |
| Firefox desktop 140+ | Supported and lint-validated | Mozilla Add-ons or temporary add-on |
| Firefox for Android 142+ | Declared and lint-validated | Mozilla Add-ons; device testing remains required before release |
| Safari 15.4+ on macOS | Source-compatible | Temporary web extension or Apple package |
| Safari 15.4+ on iPhone and iPad | Source-compatible | Packaged Safari Web Extension through an iOS app |
| Chrome on Android or iOS | Not available | Chrome mobile does not install browser extensions |
| Brave on Android or iOS | Not available | Brave mobile does not expose its desktop extension system |
| Firefox on iPhone or iPad | Not available | Firefox iOS does not support Firefox add-ons |

Safari implements `storage.sync` as local extension storage without cross-device synchronization. Recipe Master settings persist in Safari, but Safari does not synchronize them through that API.

## Firefox desktop development

Run Mozilla's validator:

```powershell
npm run lint:firefox
```

Package the extension:

```powershell
npm run package
```

For a temporary installation:

1. Open `about:debugging#/runtime/this-firefox`.
2. Select **Load Temporary Add-on**.
3. Select `manifest.json` from the repository.

Mozilla Add-ons signing is required for normal persistent Firefox installation.

## Firefox for Android development

The manifest contains `browser_specific_settings.gecko_android` so Mozilla Add-ons can list the extension for Android. The popup uses a mobile viewport and responsive controls.

With Android Debug Bridge and Firefox installed on a connected device, run:

```powershell
npx --yes web-ext@10.6.0 run -t firefox-android --adb-device DEVICE_ID --firefox-apk org.mozilla.firefox
```

Replace `DEVICE_ID` with the identifier returned by `adb devices`.

## Safari on macOS, iPhone, and iPad

Safari supports both `browser.*` and `chrome.*`, callback and Promise APIs, and Manifest V3 beginning with Safari 15.4. Recipe Master does not use background services or unsupported request-blocking APIs.

On current macOS, the source folder can be loaded temporarily from Safari's Developer settings. For App Store, iPhone, or iPad deployment, package the existing source on a Mac:

```bash
xcrun safari-web-extension-packager "/path/to/Recipe Master" \
  --app-name "Recipe Master" \
  --bundle-identifier "com.dadxisxbored.recipemaster" \
  --swift
```

Apple also accepts the ZIP produced by `npm run package` through the Safari Web Extension Packager in App Store Connect. Apple Developer signing, App Store Connect access, and Safari device testing occur outside this Windows repository.
