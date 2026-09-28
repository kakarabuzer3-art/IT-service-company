'use strict';
/* Downloads the @fontsource CSS weights used by index.html, keeps the
   latin + latin-ext subsets, downloads their .woff2 files locally and
   rewrites src URLs so the site works fully offline. */
const fs = require('fs');
const path = require('path');

const CDN = 'https://cdn.jsdelivr.net/npm/';
const FAMILIES = [
  ['@fontsource/space-grotesk@5.0.16', [500, 600, 700]],
  ['@fontsource/inter@5.0.16', [400, 500, 600]],
  ['@fontsource/jetbrains-mono@5.0.16', [400, 500]],
];
/* keep only /* latin * / and /* latin-ext * / subsets */
const KEEP = /-(latin|latin-ext)-\d+-normal \*\//;
const OUT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
const FILES_DIR = path.join(OUT_DIR, 'files');

async function main() {
  fs.mkdirSync(FILES_DIR, { recursive: true });
  let css = '/* Local webfonts - Space Grotesk, Inter, JetBrains Mono (@fontsource, OFL).\n'
          + '   Regenerate with: node scripts/fetch-fonts.js */\n\n';

  for (const [dir, weights] of FAMILIES) {
    for (const w of weights) {
      const cssUrl = CDN + dir + '/' + w + '.css';
      const res = await fetch(cssUrl);
      if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + cssUrl);
      const text = await res.text();
      const blocks = text.split(/(?=\/\* [a-z0-9-]+ \*\/)/);
      let kept = 0;
      for (const block of blocks) {
        const m = block.match(/url\(\.\/files\/([a-z0-9-]+\.woff2)\)/);
        if (!m || !KEEP.test(block)) continue;
        const file = m[1];
        const dest = path.join(FILES_DIR, file);
        if (!fs.existsSync(dest)) {
          const fileUrl = CDN + dir + '/files/' + file;
          const bin = await fetch(fileUrl);
          if (!bin.ok) throw new Error('HTTP ' + bin.status + ' for ' + fileUrl);
          fs.writeFileSync(dest, Buffer.from(await bin.arrayBuffer()));
        }
        // keep only the woff2 source
        const local = block.replace(
          /src:[^;]+;/,
          "src: url(./files/" + file + ") format('woff2');"
        );
        css += local.trim() + '\n\n';
        kept++;
      }
      console.log(dir + '/' + w + '.css -> ' + kept + ' blocks');
    }
  }
  fs.writeFileSync(path.join(OUT_DIR, 'fonts.css'), css);
  console.log('Wrote ' + path.join(OUT_DIR, 'fonts.css'));
}

main().catch((e) => { console.error(e); process.exit(1); });
