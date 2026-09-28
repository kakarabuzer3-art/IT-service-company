# Caravel — Multi-File Website (Offline-Ready)

Portfolio/corporate site for **Caravel**, refactored from a single self-contained
HTML file into a multi-file project with **zero external network dependencies** —
it renders fully with WiFi off.

## Structure

```
index.html              # markup only (no inline <style> / <script>)
css/
  base.css              # design tokens, reset, typography, buttons, cards, reveal system
  chrome.css            # loader, header/nav, mega menus, drawer, footer, modal/search/toast widgets
  sections.css          # all page-section styles (hero → docs)
  responsive.css        # media queries + prefers-reduced-motion (loaded last)
js/
  main.js               # all behavior: router, loader, reveals, sliders, tabs, filters, forms…
assets/
  fonts/
    fonts.css           # local @font-face (Space Grotesk, Inter, JetBrains Mono — latin + latin-ext)
    files/*.woff2       # 16 local font files (was: jsDelivr CDN)
  images/*.png          # 11 local images (was: image.qwenlm.ai CDN)
scripts/                # dev tooling (not used by the site at runtime)
  fetch-fonts.js        # re-downloads/rebuilds assets/fonts from @fontsource
  validate.js           # static checks: refs resolve, tag balance, no external URLs
  selftest.js           # negative test: proves validate.js FAILS on a broken ref
  imgtest.js            # negative test: proves validate.js FAILS on a truncated png
  smoke-test.js         # jsdom runtime test of router + all interactive components
```

## Why it broke offline before

| Dependency | Was | Now |
|---|---|---|
| Fonts | 8 × `cdn.jsdelivr.net` stylesheets | `assets/fonts/fonts.css` + local `.woff2` |
| Images | ~45 references to `image.qwenlm.ai` (11 unique files) | `assets/images/*.png` |

There are no other network calls — no Three.js, GSAP, or Tailwind; everything is
vanilla JS. After this refactor `index.html` contains no `http(s)://` resource
references at all (only inert `xmlns` URIs inside SVG data-URIs).

## Run it

Open `index.html` directly, or serve the folder:

```bash
python -m http.server 8123
# http://localhost:8123
```

Both work offline. The hash router (`#/about`, `#/pricing`, …) runs client-side.

## Tests / tooling

```bash
npm install          # installs jsdom (dev-only, not needed by the site)
npm run validate     # static integrity checks
npm run selftest     # injects a broken ref, proves the validator catches it, restores
npm test             # validate + selftest + jsdom smoke test (31 assertions)
npm run fonts        # regenerate assets/fonts from the @fontsource CDN (needs network)
```

The smoke test writes its full result list to `scripts/.smoke-report.txt`
(synchronously, plus a 30s watchdog) so it can be inspected even when stdout is
redirected to a file. Verified results:
- `validate.js` — ALL CHECKS PASSED (88 local refs verified)
- `selftest.js` — SELFTEST PASS (validator flags the injected missing image, exit 1)
- `smoke-test.js` — SMOKE TEST PASSED, 31/31, zero runtime errors

Notes:
- The site itself never touches the network; `npm install` / `npm run fonts`
  are development-time only and require internet.
- Fonts kept: Space Grotesk 500/600/700, Inter 400/500/600, JetBrains Mono
  400/500 — `latin` + `latin-ext` subsets, `woff2` only, with the original
  `unicode-range` declarations preserved.
