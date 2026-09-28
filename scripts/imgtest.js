'use strict';
/* Negative test: the validator must reject a TRUNCATED png (the bug that broke
   data-center.png). Backs up, truncates, validates, then always restores.
   Exits only AFTER restore — never call process.exit() inside try/finally. */
const fs = require('fs'), path = require('path'), cp = require('child_process');
const img = path.join(__dirname, '..', 'assets/images/data-center.png');
const v = path.join(__dirname, 'validate.js');
const orig = fs.readFileSync(img);
let code = 1;
try {
  fs.writeFileSync(img, orig.subarray(0, Math.floor(orig.length / 2)));
  let out = '';
  try { cp.execFileSync(process.execPath, [v], { stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { code = e.status; out = (e.stdout || '') + (e.stderr || ''); }
  const caught = /corrupt image assets\/images\/data-center\.png/.test(out);
  console.log(caught && code !== 0
    ? 'IMGTEST PASS (validator flags truncated png, exit ' + code + ')'
    : 'IMGTEST FAIL (not flagged; exit ' + code + ')\n' + out);
  code = caught && code !== 0 ? 0 : 1;
} finally {
  fs.writeFileSync(img, orig);
  const back = fs.readFileSync(img);
  console.log('image restored:', back.equals(orig) ? 'byte-identical' : 'MISMATCH');
}
process.exit(code);
