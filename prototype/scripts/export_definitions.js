// Writes docs/report-definitions.md from the same METRICS table the dashboard and reports use,
// so the written definitions can never drift from the app.
// Usage: node scripts/export_definitions.js app/outreach-management.html ../docs/report-definitions.md
const fs = require('fs'), vm = require('vm');
const [htmlFile, outFile] = process.argv.slice(2);
const html = fs.readFileSync(htmlFile, 'utf8');
const core = html.match(/<script id="core">([\s\S]*?)<\/script>/)[1];
const ctx = vm.createContext({ console, crypto: globalThis.crypto, TextEncoder, btoa, atob, Intl, Uint8Array, Array, JSON, Promise, Date, Math });
vm.runInContext(core + '\n;globalThis.__out = { METRICS, REPORT_GROUPS, REPORT_PRESETS };', ctx);
const { METRICS, REPORT_GROUPS, REPORT_PRESETS } = ctx.__out;
let md = '# How the figures are counted\n\n' +
  'These are the definitions the dashboard, the reports, the charts and the CSV exports all use. They are **drafts** until Kharis leadership confirms them. ' +
  'A person can have many encounters and many follow-up contacts, so each figure says whether it counts records or different people.\n\n' +
  '_Generated from the prototype\'s own metric table by `prototype/scripts/export_definitions.js`._\n\n' +
  '**Periods:** ' + REPORT_PRESETS.map(p => p.label).join(', ') + '. Figures marked "right now" describe today and ignore the period.\n';
REPORT_GROUPS.forEach(g => {
  md += '\n## ' + g.label + '\n\n| Figure | Basis | How it is counted |\n|---|---|---|\n';
  METRICS.filter(m => m.group === g.key).forEach(m => { md += '| ' + m.label + ' | ' + (m.basis === 'now' ? 'Right now' : 'Period') + ' | ' + m.long.replace(/\|/g, '\\|') + ' |\n'; });
});
fs.writeFileSync(outFile, md);
console.log('wrote', outFile, METRICS.length, 'definitions');
