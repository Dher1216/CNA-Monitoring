'use strict';
// Saves the latest report as files that open without the server: a single HTML page
// (data, fonts, seal and styles all inside it) and the matching Excel workbook.
const fs = require('fs');
const path = require('path');
const { buildWorkbook } = require('./exportXlsx');

const PUBLIC = path.join(__dirname, '..', 'public');
const SNAP_DIR = path.resolve(process.env.SNAPSHOT_DIR || path.join(__dirname, '..', 'data', 'latest-report'));
const HTML_NAME = 'CNA_Fund_Sources_latest.html';
const XLSX_NAME = 'CNA_Fund_Sources_latest.xlsx';

const b64 = (file) => fs.readFileSync(path.join(PUBLIC, file)).toString('base64');
const safeJson = (o) => JSON.stringify(o).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

function css() {
  let text = fs.readFileSync(path.join(PUBLIC, 'app.css'), 'utf8');
  // Inline the fonts so the saved page looks identical with no server.
  text = text.replace(/url\("\/fonts\/([^"]+)"\)/g, (m, f) => `url("data:font/woff2;base64,${b64('fonts/' + f)}")`);
  return text;
}

function buildHtml(model, savedAt, standalone) {
  const xlsxLink = standalone ? '' : `<a class="btn small alt" href="./${XLSX_NAME}" download>Download Excel (all reports)</a>`;
  const reportJs = fs.readFileSync(path.join(PUBLIC, 'report.js'), 'utf8');
  const seal = `data:image/png;base64,${b64('seal.png')}`;
  const savedText = new Date(savedAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' });
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fund Sources of the CNA Incentive (${String(model.meta.year).replace(/[<>&"]/g, '')})</title>
<link rel="icon" href="${seal}">
<style>${css()}
.offline-copy{max-width:1120px;margin:0 auto;padding:24px 20px 8px}
.offline-copy .actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
</style></head>
<body>
<main class="main">
<div class="offline-banner no-print"><strong>Saved copy.</strong> This page was saved on ${savedText} from the e-budget report as of the date shown below. It works without the server. Open the CNA Fund Monitor link for live data.
<div class="actions">${xlsxLink}</div></div>
<div id="out"></div>
</main>
<script>${reportJs}</script>
<script>
var MODEL = ${safeJson(model)};
var SEAL = ${JSON.stringify(seal)};
function parse() {
  var q = {}, h = location.hash.replace(/^#/, '');
  h.split('&').forEach(function (kv) { var p = kv.split('='); if (p[0]) q[p[0]] = decodeURIComponent(p[1] || ''); });
  return q;
}
var q = parse();
CNAReport.mount(document.getElementById('out'), MODEL, {
  view: q.view === 'reports' ? 'reports' : 'dashboard', showViewSwitch: true, sealSrc: SEAL,
  state: { report: q.report || '', basis: q.basis || '', office: q.office || '' },
  onState: function (v, st) {
    var p = ['view=' + v];
    ['report', 'basis', 'office'].forEach(function (k) { if (st[k]) p.push(k + '=' + encodeURIComponent(st[k])); });
    try { history.replaceState(null, '', '#' + p.join('&')); } catch (e) {}
  }
});
</script>
</body></html>`;
}

async function writeSnapshot(model) {
  fs.mkdirSync(SNAP_DIR, { recursive: true });
  const savedAt = new Date().toISOString();
  const html = buildHtml(model, savedAt);
  const tmpH = path.join(SNAP_DIR, `.${HTML_NAME}.tmp`);
  fs.writeFileSync(tmpH, html);
  fs.renameSync(tmpH, path.join(SNAP_DIR, HTML_NAME));
  const wb = await buildWorkbook(model);
  const tmpX = path.join(SNAP_DIR, `.${XLSX_NAME}.tmp`);
  await wb.xlsx.writeFile(tmpX);
  fs.renameSync(tmpX, path.join(SNAP_DIR, XLSX_NAME));
  return { dir: SNAP_DIR, html: HTML_NAME, xlsx: XLSX_NAME, savedAt };
}

module.exports = { writeSnapshot, buildHtml, SNAP_DIR };
