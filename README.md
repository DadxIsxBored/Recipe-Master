# Recipe Master

Recipe Master is a cross-browser Manifest V3 extension for Chromium, Firefox, and Safari Web Extensions. It detects recipe pages, hides page clutter, jumps to the recipe card, and can reconstruct ingredients and instructions in a clean reader.

## Coverage model

Detection runs on HTTP and HTTPS pages in this order:

1. Schema.org `Recipe` data in JSON-LD, including nested `@graph` data.
2. Shared recipe-card formats, including WP Recipe Maker, WP Tasty, Mediavine Create, EasyRecipe, Zip Recipes, and Schema.org microdata.
3. Site-specific selectors for major food and drink publishers.
4. Ingredient and instruction heading heuristics.
5. Direct DOM extraction when structured recipe data is unavailable.

The rule catalog includes the 150 priority food and drink domains from the project brief. Universal detection is not restricted to those domains.

## Current features

- Automatic jump to the ingredients section.
- Repeated cleanup for ads or prompts inserted after page load.
- Ad, newsletter, marketing popup, inline signup, and floating video suppression.
- Per-site enable and disable control.
- Separate toggles for automatic jumping, advertisements, prompts, floating media, and scroll behavior.
- Clean recipe reader with ingredient checkboxes, grouped instructions, timing, yield, category, cuisine, nutrition, source attribution, and printing.
- Drink-recipe fields for glassware, garnish, technique, equipment, and ABV when publishers supply them.
- Preservation rules for age verification, authentication, paywalls, and required consent controls.

## Install in Brave

1. Open `brave://extensions`.
2. Turn on **Developer mode**.
3. Select **Load unpacked**.
4. Select this repository folder.
5. Reload recipe tabs that were open before installation.

## Install in Chrome or Chromium

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Select **Load unpacked**.
4. Select this repository folder.
5. Reload recipe tabs that were open before installation.

## Development checks

```powershell
npm test
npm run check
npm run test:browser
npm run lint:firefox
npm run package
```

After changing extension files, use the extension page's reload control and reload the website tab under test.

## Mozilla reviewer build instructions

The submitted extension contains the original readable JavaScript, HTML, CSS, and manifest files. No source file is transpiled, minified, concatenated, obfuscated, or generated during packaging. Mozilla's `web-ext` tool only copies the runtime files into a ZIP archive.

Requirements:

- Node.js 20 or newer.
- npm with access to the official npm registry.

From the repository root, run:

```sh
npm run package
```

This downloads `web-ext` version 10.6.0 from the official npm registry and creates `artifacts/recipe-master-0.1.0.zip`. No dependency is included in the extension. The package can be checked with:

```sh
npm test
npm run check
npm run lint:firefox
```

The release package was produced on Windows 11 with Node.js 22.23.2 and npm 10.9.8. The commands use cross-platform Node.js tooling and require no operating-system-specific build step.

## Permissions

The extension requests `storage` for settings. Content scripts run on HTTP and HTTPS pages so universal recipe detection can operate beyond a fixed domain list. Page processing occurs locally in the browser; this project has no server component.

## Browser and mobile targets

See [Browser and mobile support](docs/BROWSER_SUPPORT.md) for the complete compatibility matrix and Firefox Android or Safari iOS packaging instructions.
