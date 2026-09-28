'use strict';
/* Runtime smoke test: executes js/main.js inside jsdom and drives the
   interactive components. Also re-checks UTF-8 integrity of index.html. */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'js/main.js'), 'utf8');

let failures = 0;
const report = [];
const watchdog = setTimeout(() => {
  report.push('FAIL  WATCHDOG: run exceeded 30s, forced exit');
  try { fs.writeFileSync(path.join(ROOT, 'scripts', '.smoke-report.txt'), report.join('\n')); } catch (e) {}
  process.exit(3);
}, 30000);
const check = (name, cond) => {
  const line = (cond ? 'PASS  ' : 'FAIL  ') + name;
  console.log(line);
  report.push(line);
  if (!cond) failures++;
};
const finish = (code) => {
  clearTimeout(watchdog);
  const summary = failures ? 'SMOKE TEST FAILED: ' + failures + ' failure(s)' : 'SMOKE TEST PASSED';
  console.log(summary);
  report.push(summary);
  try { fs.writeFileSync(path.join(ROOT, 'scripts', '.smoke-report.txt'), report.join('\n')); } catch (e) {}
  process.exit(code);
};

/* --- UTF-8 integrity (guards against BOM/ANSI corruption) --- */
check('index.html has no mojibake', !/Â|â€/.test(html));
check('index.html contains em-dash', html.includes('\u2014'));
check('index.html contains middot', html.includes('\u00b7'));
check('index.html declares UTF-8 charset', /<meta charset="UTF-8">/.test(html));

/* --- DOM runtime --- */
const vc = new VirtualConsole();
const runtimeErrors = [];
vc.on('jsdomError', (e) => {
  if (/Not implemented/.test(e.message)) return; // jsdom lacks layout/scroll
  runtimeErrors.push(e.message);
});
vc.on('error', (...a) => runtimeErrors.push(a.join(' ')));

const dom = new JSDOM(html, {
  url: 'http://localhost/index.html',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  virtualConsole: vc,
});
const w = dom.window;

/* polyfills the page expects from a real browser */
w.matchMedia = (q) => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
w.IntersectionObserver = class {
  constructor(cb) { this.cb = cb; }
  observe(el) { setTimeout(() => this.cb([{ isIntersecting: true, target: el }], this), 10); }
  unobserve() {} disconnect() {}
};
w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => {} });
w.scrollTo = () => {};
w.ResizeObserver = class { constructor(cb) { this.cb = cb; } observe() {} unobserve() {} disconnect() {} };
/* jsdom has no layout: make scrollY writable so the engine's cached-geometry
   maths can actually be exercised. */
Object.defineProperty(w, 'scrollY', { value: 0, writable: true, configurable: true });
Object.defineProperty(w.document.documentElement, 'scrollHeight', { value: 6000, configurable: true });
/* jsdom has no layout: give the parallax band a realistic box so the
   engine's cached-geometry maths (and its off-screen culling) is exercised. */
const fakeRect = (top, height) => ({ top, height, bottom: top + height, left: 0, right: 1200, width: 1200, x: 0, y: top, toJSON() { return {}; } });
const plxHost = w.document.querySelector('[data-plx]');
/* viewport-relative, exactly like a real layout: the band is fixed in the
   document at y=300, so it leaves the viewport as you scroll down. */
if (plxHost && plxHost.parentElement) plxHost.parentElement.getBoundingClientRect = () => fakeRect(300 - w.scrollY, 400);

w.addEventListener('error', (e) => runtimeErrors.push(String(e.message || e)));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (s) => w.document.querySelector(s);
const $$ = (s) => [...w.document.querySelectorAll(s)];

(async () => {
  /* run the site script */
  try { w.eval(js); } catch (e) { runtimeErrors.push('main.js threw: ' + e.message); }

  await sleep(3000); // loader: ~1.4s + 350ms + 250ms

  check('no runtime errors on boot', runtimeErrors.length === 0);
  if (runtimeErrors.length) console.log('   -> ' + runtimeErrors.join('\n   -> '));
  check('loader finished (hidden)', $('#loader').classList.contains('done'));
  check('home page is active after boot', $('.page.on') && $('.page.on').dataset.page === 'home');
  check('document title set by router', /Caravel/.test(w.document.title));
  check('reveal elements observed (in class applied)', $$('[data-rv].in').length > 0);
  check('counter animated off zero', $('[data-count="240"]').textContent !== '0');
  check('slider dots built', $$('.slider .sl-dots i').length >= 3);

  /* ---- scroll performance engine ---- */
  check('ambient effects released only after boot (body.booted)', w.document.body.classList.contains('booted'));
  check('perf layer stylesheet is linked', $$('link[rel=stylesheet]').some((l) => l.getAttribute('href') === 'css/perf.css'));
  check('no legacy un-throttled scrollspy listener', !/addEventListener\('scroll',spy/.test(js));

  const plx = $('[data-plx]');
  const pbar = $('#pbar');

  // the band sits at y=300..700, so scroll positions inside that range
  // must move the parallax layer
  w.scrollY = 350;
  w.dispatchEvent(new w.Event('scroll'));
  await sleep(120);
  check('scroll sets is-scrolling state', w.document.body.classList.contains('is-scrolling'));
  check('header gets .scrolled past 10px', $('#nav').classList.contains('scrolled'));
  check('progress bar written as scaleX', /^scaleX\(/.test(pbar.style.transform));
  check('progress bar advanced', parseFloat(pbar.style.transform.replace(/[^0-9.]/g, '')) > 0.05);
  check('parallax uses GPU transform (translate3d)', /translate3d\(/.test(plx.style.transform));

  const plxBefore = plx.style.transform;
  for (let y = 400; y <= 600; y += 50) { w.scrollY = y; w.dispatchEvent(new w.Event('scroll')); await sleep(30); }
  check('parallax updates as scroll advances', plx.style.transform !== plxBefore);
  check('no errors during scroll sequence', runtimeErrors.length === 0);

  // once the band is far off-screen the engine must stop writing at all
  w.scrollY = 5000;
  w.dispatchEvent(new w.Event('scroll'));
  await sleep(150);
  const culled = plx.style.transform;
  w.scrollY = 5200;
  w.dispatchEvent(new w.Event('scroll'));
  await sleep(150);
  check('off-screen parallax is culled (no wasted writes)', plx.style.transform === culled);
  check('back-to-top appears past 700px', $('#totop').classList.contains('on'));

  await sleep(400); // idle timer releases the scrolling state
  check('is-scrolling cleared after scroll stops', !w.document.body.classList.contains('is-scrolling'));
  w.scrollY = 0;
  w.dispatchEvent(new w.Event('scroll'));
  await sleep(200);
  check('header .scrolled cleared back at top', !$('#nav').classList.contains('scrolled'));

  /* hash router navigation */
  w.location.hash = '#/about';
  await sleep(700);
  check('router navigates to #/about', $('.page.on') && $('.page.on').dataset.page === 'about');
  check('router updates document title', w.document.title === 'About — Caravel');

  /* unknown route falls back to 404 */
  w.location.hash = '#/definitely-not-a-page';
  await sleep(700);
  check('unknown route renders 404', $('.page.on') && $('.page.on').dataset.page === '404');

  /* theme toggle */
  const before = w.document.documentElement.dataset.theme;
  $('#themeBtn').click();
  check('theme toggle flips data-theme', w.document.documentElement.dataset.theme !== before);
  $('#themeBtn').click();

  /* accordion */
  const acc = $('.acc-h');
  acc.click();
  check('FAQ accordion opens', acc.closest('.acc').classList.contains('open') && acc.getAttribute('aria-expanded') === 'true');
  acc.click();

  /* services accordion row */
  const svc = $('.svc-h');
  svc.click();
  check('services row opens', svc.closest('.svc-row').classList.contains('open'));

  /* solutions tabs */
  const tab = $('[data-tab="helm"]');
  tab.click();
  check('tab switches panel', tab.getAttribute('aria-selected') === 'true' && $('[data-panel="helm"]').classList.contains('on') && !$('[data-panel="atlas"]').classList.contains('on'));

  /* portfolio filter */
  const f = $('.filters [data-f="ai"]');
  f.click();
  const items = $$('.pitem');
  const visible = items.filter((i) => !i.classList.contains('off'));
  check('portfolio filter narrows grid', f.classList.contains('on') && visible.length === 2 && visible.every((i) => i.dataset.cat === 'ai'));
  $('.filters [data-f="all"]').click();
  check('filter reset shows all', $$('.pitem:not(.off)').length === 9);

  /* roles filter */
  $('[data-rf] .fbtn[data-f="design"]').click();
  check('careers role filter hides others', $$('.role').filter((r) => r.style.display !== 'none').length === 1);

  /* pricing billing toggle */
  $('[data-bill="y"]').click();
  await sleep(400);
  check('pricing toggle flips price', $('.flip').textContent === '7,840');

  /* slider next button (assert relative advance: the 7s auto-play may have
     already moved it, so compare against the live counter, not a literal) */
  const sl = $('[data-slider]');
  const cnt = sl.querySelector('[data-sl-cnt]');
  const cntBefore = cnt.textContent;
  sl.querySelector('[data-sl="next"]').click();
  check('slider advances', cnt.textContent !== cntBefore && /^\d\d \/ \d\d$/.test(cnt.textContent));
  check('slider counter format valid', /^\d\d \/ 0\d$/.test(cnt.textContent));

  /* search modal via Ctrl+K */
  w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }));
  await sleep(100);
  check('Ctrl+K opens search', $('#search').classList.contains('on'));
  w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await sleep(100);
  check('Escape closes search', !$('#search').classList.contains('on'));

  /* contact form */
  w.location.hash = '#/contact';
  await sleep(700);
  const form = $('[data-cform]');
  check('contact form present', !!form);
  check('required inputs declared', form && form.querySelectorAll('input[required], textarea[required]').length === 3);

  /* portfolio modal */
  w.location.hash = '#/portfolio';
  await sleep(700);
  $('.pitem').click();
  check('portfolio modal opens', $('#modal').classList.contains('on') && $('#modalBody').innerHTML.includes('Helios Bank'));
  $('#modal .x').click();
  check('modal closes', !$('#modal').classList.contains('on'));

  check('no runtime errors at end of test', runtimeErrors.length === 0);
  if (runtimeErrors.length) console.log('   -> ' + runtimeErrors.join('\n   -> '));

  dom.window.close();
  finish(failures ? 1 : 0);
})().catch((e) => {
  console.error('SMOKE TEST CRASHED:', e);
  check('run completed without crashing: ' + (e && e.message), false);
  finish(2);
});

