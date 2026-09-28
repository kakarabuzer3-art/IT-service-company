'use strict';
/* Static validation for the assembled project. */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const ROOT = path.join(__dirname, '..');
let errors = 0;
const err = (m) => { console.error('ERROR: ' + m); errors++; };

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

/* 1. no external (online-only) dependencies in html/css */
const extRe = /(?:src|href)\s*=\s*["'](https?:\/\/[^"']+)["']/gi;
let m;
while ((m = extRe.exec(html))) {
  const u = m[1];
  if (!/www\.w3\.org/.test(u)) err('external reference in index.html: ' + u);
}
if (/cdn\.jsdelivr\.net|image\.qwenlm\.ai/.test(html)) err('legacy CDN/image URL still present in index.html');
if (/<style[\s>]/.test(html)) err('inline <style> still present');
if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(html)) err('inline <script> still present');

for (const f of ['css/base.css', 'css/chrome.css', 'css/sections.css', 'css/responsive.css', 'assets/fonts/fonts.css']) {
  const css = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const open = (css.match(/\{/g) || []).length;
  const close = (css.match(/\}/g) || []).length;
  if (open !== close) err(f + ' brace mismatch: ' + open + ' open vs ' + close + ' close');
  if (/https?:\/\//.test(css.replace(/url\(["']?data:[^)]*\)/g, ''))) {
    const mm = css.match(/https?:\/\/[^\s)"']+/g) || [];
    const bad = mm.filter((u) => !/www\.w3\.org/.test(u));
    if (bad.length) err(f + ' external url: ' + bad.join(', '));
  }
}

/* 2. every local reference resolves */
const refRe = /(?:src|href)\s*=\s*["']([^"']+)["']/gi;
const refs = new Set();
while ((m = refRe.exec(html))) refs.add(m[1]);
const piRe = /data-pi\s*=\s*"([^"]+)"/gi;
while ((m = piRe.exec(html))) refs.add(m[1]);
for (const r of refs) {
  if (/^(?:https?:|data:|#|mailto:|tel:)/.test(r)) continue;
  const p = path.join(ROOT, r.split('#')[0].split('?')[0]);
  if (!fs.existsSync(p)) err('missing local file referenced: ' + r);
}

/* 3. fonts.css woff2 files */
const fontsCss = fs.readFileSync(path.join(ROOT, 'assets/fonts/fonts.css'), 'utf8');
const woffRe = /url\((\.\/files\/[^)]+)\)/g;
let wf = 0;
while ((m = woffRe.exec(fontsCss))) {
  wf++;
  const p = path.join(ROOT, 'assets/fonts', m[1]);
  if (!fs.existsSync(p)) err('missing font file: ' + m[1]);
}
if (wf < 16) err('expected >=16 @font-face woff2 refs, got ' + wf);

/* 4. tag balance for block elements */
const countTag = (t) => {
  const open = (html.match(new RegExp('<' + t + '(?=[\\s>])', 'g')) || []).length;
  const close = (html.match(new RegExp('</' + t + '>', 'g')) || []).length;
  return [open, close];
};
for (const t of ['html', 'head', 'body', 'main', 'header', 'footer', 'section', 'article', 'nav', 'form', 'table', 'ul', 'ol']) {
  const [o, c] = countTag(t);
  if (o !== c) err('<' + t + '> balance: ' + o + ' open vs ' + c + ' close');
}

/* 4b. offline guarantee: every assets/images/*.png NAME mentioned anywhere in
   the markup (attributes, JS string literals in main.js, inline handlers) must
   exist on disk. Catches images referenced only from JS, which attr-scan misses. */
const jsSrc = fs.readFileSync(path.join(ROOT, 'js/main.js'), 'utf8');
const imgNames = new Set(
  (html + '\n' + jsSrc).match(/assets\/images\/[A-Za-z0-9._-]+\.png/g) || []
);
for (const r of imgNames) {
  if (!fs.existsSync(path.join(ROOT, r))) err('image referenced but missing on disk: ' + r);
}
if (imgNames.size < 11) err('expected >=11 distinct image references, got ' + imgNames.size);

/* 4c. every local image must be a structurally complete PNG (catches truncated
   downloads: valid signature but no IEND / undecodable IDAT -> broken image) */
for (const r of imgNames) {
  const p = path.join(ROOT, r);
  if (!fs.existsSync(p)) continue;
  const buf = fs.readFileSync(p);
  const fail = (why) => err('corrupt image ' + r + ': ' + why);
  if (buf.slice(0, 8).toString('hex') !== '89504e470d0a1a0a') { fail('bad PNG signature'); continue; }
  const idat = [];
  let off = 8, sawIhdr = false, sawIend = false, truncated = '', ihdrOff = -1;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    if (len > buf.length - (off + 8)) { truncated = type; break; }
    if (type === 'IHDR') { sawIhdr = true; ihdrOff = off; }
    if (type === 'IDAT') idat.push(buf.slice(off + 8, off + 8 + len));
    if (type === 'IEND') { sawIend = true; break; }
    off += 12 + len;
  }
  if (truncated) { fail('truncated inside ' + truncated + ' chunk'); continue; }
  if (!sawIhdr) { fail('missing IHDR'); continue; }
  if (!sawIend) { fail('missing IEND'); continue; }
  const w = buf.readUInt32BE(ihdrOff + 8), h = buf.readUInt32BE(ihdrOff + 12);
  const colorType = buf[ihdrOff + 8 + 9];                       /* IHDR: w,h,depth,color */
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) { fail('unknown PNG color type ' + colorType); continue; }
  let raw;
  try { raw = zlib.inflateSync(Buffer.concat(idat)); }
  catch (e) { fail('pixel data undecodable (' + e.message + ')'); continue; }
  const need = h * (1 + w * channels);
  if (raw.length < need * 0.98) fail('pixel data short: ' + raw.length + 'B of ~' + need + 'B');
  if (w < 200 || h < 200) fail('suspiciously small: ' + w + 'x' + h);
}
{
  const [o, c] = countTag('div');
  if (o !== c) err('<div> balance: ' + o + ' open vs ' + c + ' close');
  const [bo, bc] = countTag('button');
  if (bo !== bc) err('<button> balance: ' + bo + ' open vs ' + bc + ' close');
  const [ao, ac] = countTag('a');
  if (ao !== ac) err('<a> balance: ' + ao + ' open vs ' + ac + ' close');
}

/* 5. router integrity: every data-page has a matching nav/drawer link target somewhere */
const pages = [...html.matchAll(/data-page="([a-z0-9]+)"/g)].map((x) => x[1]);
const navTargets = [...html.matchAll(/href="#\/([a-z0-9]+)"/g)].map((x) => x[1]);
for (const t of navTargets) {
  if (!pages.includes(t)) err('link target has no page section: #/' + t);
}

/* 6. JS references only ids that exist in html (spot check of critical ids) */
const js = fs.readFileSync(path.join(ROOT, 'js/main.js'), 'utf8');
for (const id of ['loader', 'lgPct', 'lgBar', 'themeBtn', 'burger', 'searchBtn', 'searchIn', 'searchRes', 'modal', 'modalBody', 'toast', 'toastMsg', 'cookie', 'ckY', 'ckN', 'totop', 'nav', 'pbar']) {
  if (!new RegExp('id="' + id + '"').test(html)) err('main.js expects #' + id + ' which is missing in html');
}

console.log(errors ? 'FAILED with ' + errors + ' error(s)' : 'ALL CHECKS PASSED (' + refs.size + ' local refs verified)');
process.exit(errors ? 1 : 0);
