const fs = require('fs'), vm = require('vm');
const file = process.argv[2], scriptsDir = process.argv[3];
const html = fs.readFileSync(file, 'utf8');
const grab = id => { const m = html.match(new RegExp('<script id="' + id + '">([\\s\\S]*?)</script>')); if (!m) throw new Error('missing script ' + id); return m[1]; };
let ok = true; const fail = (m) => { ok = false; console.log('FAIL', m); };

// 1. syntax of every script
for (const id of ['core', 'views', 'app']) { try { new vm.Script(grab(id), { filename: id + '.js' }); console.log('syntax ok:', id); } catch (e) { fail('syntax ' + id + ': ' + e.message); } }

// 2. wiring lint: every data-action / data-form / data-input used in markup has a handler
const views = grab('views'), app = grab('app'), core = grab('core');
const used = new Set([...views.matchAll(/data-action="([a-z-]+)"/g)].map(m => m[1]));
[...app.matchAll(/data-action="([a-z-]+)"/g)].forEach(m => used.add(m[1]));
const handled = new Set([...app.matchAll(/case '([a-z-]+)'/g)].map(m => m[1]));
const missing = [...used].filter(a => !handled.has(a)); const dead = [...handled].filter(a => !used.has(a));
if (missing.length) fail('actions without a handler: ' + missing.join(', ')); else console.log('every data-action has a handler (' + used.size + ')');
if (dead.length) console.log('note: handlers never referenced in markup:', dead.join(', '));
const forms = new Set([...views.matchAll(/data-form="([a-z-]+)"/g)].map(m => m[1])); [...views.matchAll(/form: '([a-z-]+)'/g)].forEach(m => forms.add(m[1]));
const hkeys = new Set([...app.matchAll(/^\s{2}(?:async )?'?([a-z-]+)'?\(form\)/gm)].map(m => m[1]));
const formMissing = [...forms].filter(f => !hkeys.has(f));
if (formMissing.length) fail('forms without a handler: ' + formMissing.join(', ')); else console.log('every form has a handler (' + [...forms].join(', ') + ')');
const inputs = new Set([...views.matchAll(/data-input="([a-z-]+)"/g)].map(m => m[1]));
const inputHandled = new Set([...app.matchAll(/kind === '([a-z-]+)'/g)].map(m => m[1]));
const inputMissing = [...inputs].filter(i => !inputHandled.has(i));
if (inputMissing.length) fail('inputs without a handler: ' + inputMissing.join(', ')); else console.log('every data-input has a handler (' + [...inputs].join(', ') + ')');
// ids used by app code must exist in markup or views
const idsNeeded = ['login-email', 'act-email', 'act-code', 'pw-rules', 'users-table', 'try-page', 'role-preview', 'sidebar', 'hamburger', 'account-menu', 'account-btn', 'page-title', 'code-text'];
const allMarkup = html + views;
idsNeeded.forEach(i => { if (!allMarkup.includes('id="' + i + '"')) fail('missing id in markup: ' + i); });
// ICONS referenced exist
const iconNames = new Set([...views.matchAll(/icon\('([a-z]+)'/g)].map(m => m[1])); [...app.matchAll(/icon\('([a-z]+)'/g)].forEach(m => iconNames.add(m[1])); [...app.matchAll(/'(eyeoff|eye)'/g)].forEach(m => iconNames.add(m[1]));
[...core.matchAll(/icon: '([a-z]+)'/g)].forEach(m => iconNames.add(m[1]));
const defined = new Set([...views.matchAll(/^\s{2}([a-z]+): '<[^']*',?$/gm)].map(m => m[1]));
const noIcon = [...iconNames].filter(n => !defined.has(n)); if (noIcon.length) fail('icons not defined: ' + noIcon.join(', ')); else console.log('all icons defined (' + iconNames.size + ')');

// 3. logic and template tests in a sandbox
const ctx = vm.createContext({ console, crypto: globalThis.crypto, TextEncoder, btoa, atob, Intl, Uint8Array, Array, JSON, Promise, Date, Math });
vm.runInContext(core + '\n' + views, ctx, { filename: 'core+views' });
const tests = fs.readFileSync(scriptsDir + '/ctx_tests.js', 'utf8');
vm.runInContext(tests, ctx, { filename: 'tests' }).then(res => {
  console.log('checks run:', res.total, ' failed:', res.failed.length);
  res.failed.forEach(f => console.log('  FAIL:', f[0], f[2] ? '\n        ' + String(f[2]).slice(0, 400) : ''));
  if (res.failed.length || !ok) process.exit(1);
  console.log('ALL OK');
}).catch(e => { console.log('TEST HARNESS ERROR', e && e.stack || e); process.exit(2); });
