'use strict';
/* Negative self-test: the validator must FAIL when a referenced image is absent.
   Temporarily injects a bogus <img> into index.html, runs validate.js, restores.
   NOTE: never call process.exit() inside try/finally — it skips finally and
   would leave index.html mutated. Decide the code, restore, then exit. */
const fs = require('fs'), path = require('path'), cp = require('child_process');
const v = path.join(__dirname, 'validate.js'), html = path.join(__dirname, '..', 'index.html');
const orig = fs.readFileSync(html, 'utf8');
let code = 1;
try {
  fs.writeFileSync(html, orig.replace('</body>', '<img src="assets/images/__bogus__.png" alt=""></body>'));
  let out = '';
  try { cp.execFileSync(process.execPath, [v], { stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { code = e.status; out = (e.stdout || '') + (e.stderr || ''); }
  const caught = /image referenced but missing on disk: assets\/images\/__bogus__\.png/.test(out);
  console.log(caught && code !== 0
    ? 'SELFTEST PASS (validator flags missing image, exit ' + code + ')'
    : 'SELFTEST FAIL (not flagged; exit ' + code + ')');
  code = caught && code !== 0 ? 0 : 1;
} finally {
  fs.writeFileSync(html, orig);
  console.log('index.html restored, byte length:', Buffer.byteLength(fs.readFileSync(html), 'utf8') === Buffer.byteLength(orig, 'utf8') ? 'unchanged' : 'MISMATCH');
}
process.exit(code);
