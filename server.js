'use strict';
// Optional settings.json next to this file (port, folders). Environment variables take priority.
(function loadSettings() {
  try {
    const fs = require('fs'), path = require('path');
    const c = JSON.parse(fs.readFileSync(path.join(__dirname, 'settings.json'), 'utf8'));
    if (c.port && !process.env.PORT) process.env.PORT = String(c.port);
    if (c.snapshotDir && !process.env.SNAPSHOT_DIR) process.env.SNAPSHOT_DIR = String(c.snapshotDir);
    if (c.backupDir && !process.env.BACKUP_DIR) process.env.BACKUP_DIR = String(c.backupDir);
    if (c.dataDir && !process.env.DATA_DIR) process.env.DATA_DIR = String(c.dataDir);
  } catch (e) { /* no settings file, use defaults */ }
})();
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const store = require('./lib/store');
const auth = require('./lib/auth');
const { parseWorkbook, norm } = require('./lib/parse');
const { computeModel } = require('./lib/compute');
const { buildWorkbook, buildReportWorkbook } = require('./lib/exportXlsx');
const snapshot = require('./lib/snapshot');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
let DEFAULT_FUND_SOURCES = [];
try { DEFAULT_FUND_SOURCES = JSON.parse(fs.readFileSync(path.join(__dirname, 'lib', 'default-fund-sources.json'), 'utf8')); } catch (e) { /* none bundled */ }
const DEFAULTS = { year: new Date().getFullYear(), employees: 1245, amountPerEmployee: 30000 };

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use('/api/upload', express.raw({ type: () => true, limit: '40mb' }));
app.use('/api/backup/restore', express.raw({ type: () => true, limit: '200mb' }));
app.use(express.json({ limit: '200kb' }));
app.get('/healthz', (req, res) => res.type('text').send('ok'));
app.set('trust proxy', 1);
app.use(auth.attachUser);
app.use('/api', auth.requireCsrfHeader);
// With the online database, answer only after the change has been saved there.
app.use('/api', (req, res, next) => {
  if (!store.isPg) return next();
  const json = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode >= 400) return json(body);
    store.flush().then(() => json(body), (e) => { res.status(500); json({ error: 'The change could not be saved to the database: ' + e.message }); });
    return res;
  };
  next();
});

const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  console.error(e);
  res.status(500).json({ error: 'Something went wrong on the server. Try again, and check the server window for details.' });
});
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const clean = (s, max) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max);
const todayManila = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

// ---------- helpers over the revision history
const uploadCache = new Map();
function loadUpload(id) {
  if (!uploadCache.has(id)) uploadCache.set(id, store.uploads.load(id));
  return uploadCache.get(id);
}
function modelFor(revision) {
  const upload = loadUpload(revision.uploadId);
  if (!upload) return null;
  return computeModel({ upload, revision, params: revision.params, voids: revision.voids });
}
async function addRevision(partial, user) {
  const s = store.state.load();
  const rev = { id: store.id(), at: new Date().toISOString(), by: user.name || user.username, ...partial };
  s.revisions.push(rev);
  store.state.save(s);
  refreshSnapshot().catch((e) => console.error('Could not save the offline copy:', e.message));
  return rev;
}
let lastSnapshot = null;
async function refreshSnapshot() {
  if (store.isPg) return; // online mode: the saved copy is downloaded on demand
  const cur = store.state.current();
  if (!cur) return;
  const model = modelFor(cur);
  if (model) lastSnapshot = await snapshot.writeSnapshot(model);
}

// ---------- sign in
app.post('/api/login', wrap(async (req, res) => {
  const username = clean(req.body && req.body.username, 60).toLowerCase();
  const password = String((req.body && req.body.password) || '');
  const key = `${req.ip}|${username}`;
  const wait = auth.lockedFor(key);
  if (wait) return bad(res, `Too many incorrect attempts. Try again in ${wait} minute${wait > 1 ? 's' : ''}.`, 429);
  const user = store.users.all().find((u) => u.username.toLowerCase() === username && u.active);
  if (!user || !auth.check(password, user.passHash)) {
    auth.recordMiss(key);
    return bad(res, 'Incorrect username or password.', 401);
  }
  auth.clearMisses(key);
  auth.setSession(res, user);
  res.json({ user: auth.publicUser(user) });
}));
app.post('/api/logout', (req, res) => { auth.clearSession(res); res.json({ ok: true }); });
app.get('/api/me', (req, res) => res.json({ user: req.user ? auth.publicUser(req.user) : null }));

app.post('/api/password', auth.requireAuth, wrap(async (req, res) => {
  const { current, newPassword } = req.body || {};
  const list = store.users.all();
  const u = list.find((x) => x.id === req.user.id);
  if (!auth.check(String(current || ''), u.passHash)) return bad(res, 'The current password is not correct.');
  const problem = auth.passwordProblem(newPassword);
  if (problem) return bad(res, problem);
  if (newPassword === current) return bad(res, 'Choose a password different from the current one.');
  u.passHash = auth.hash(newPassword); u.mustChange = false;
  store.users.save(list);
  auth.setSession(res, u);
  try { fs.unlinkSync(path.join(store.DATA_DIR, 'FIRST_LOGIN_PASSWORD.txt')); } catch (e) { /* not there */ }
  res.json({ ok: true, user: auth.publicUser(u) });
}));

// ---------- the report
app.get('/api/report', auth.requireAuth, wrap(async (req, res) => {
  const s = store.state.load();
  const cur = store.state.current(s);
  if (!cur) return res.json({ empty: true });
  const rev = req.query.rev ? s.revisions.find((r) => r.id === String(req.query.rev)) : cur;
  if (!rev) return bad(res, 'That report version was not found.', 404);
  const model = modelFor(rev);
  if (!model) return bad(res, 'The data for that report version is missing from the data folder.', 404);
  res.json({ model, isCurrent: rev.id === cur.id, currentId: cur.id });
}));

app.get('/api/report.xlsx', auth.requireAuth, wrap(async (req, res) => {
  const s = store.state.load();
  const cur = store.state.current(s);
  if (!cur) return bad(res, 'No report has been uploaded yet.', 404);
  const rev = req.query.rev ? s.revisions.find((r) => r.id === String(req.query.rev)) : cur;
  if (!rev) return bad(res, 'That report version was not found.', 404);
  const model = modelFor(rev);
  const FILES = { dashboard: 'available-fund', summary: 'summary', offices: 'per-office', sources: 'per-fund-source', voided: 'voided-funds' };
  const kind = FILES[req.query.report] ? String(req.query.report) : null;
  const basis = req.query.basis === 'overall' ? 'overall' : req.query.basis === 'approp' ? 'approp' : '';
  let office = String(req.query.office || '');
  let wb, tag = kind ? FILES[kind] : '';
  if (kind === 'summary' || kind === 'offices') {
    if (!basis) return bad(res, 'Choose the fund (appropriation balance or overall) first.');
    if (kind === 'offices') {
      if (office !== 'all' && !model.offices.some((o) => o.code === office)) return bad(res, 'Choose an office, or all offices.');
      tag += '-' + (office === 'all' ? 'all-offices' : office.replace(/[^A-Za-z0-9_-]/g, ''));
    }
    tag += '-' + (basis === 'approp' ? '20pct' : 'overall');
    wb = await buildReportWorkbook(model, { report: kind, basis, office });
  } else wb = await buildWorkbook(model, kind);
  const name = `CNA_Fund_Sources_${model.meta.year}${tag ? '_' + tag : ''}_as_of_${model.meta.asOf || 'report'}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  await wb.xlsx.write(res);
  res.end();
}));

const ACTION_LABEL = { upload: 'E-budget upload', params: 'Figures changed', 'void-add': 'Fund source voided', 'void-remove': 'Void removed', restore: 'Version restored' };
app.get('/api/revisions', auth.requireAuth, wrap(async (req, res) => {
  const s = store.state.load();
  const cur = store.state.current(s);
  const list = s.revisions.slice().reverse().map((r) => {
    const up = loadUpload(r.uploadId);
    let net = null, need = null;
    if (up) {
      const m = computeModel({ upload: up, revision: r, params: r.params, voids: r.voids });
      net = m.totals.net.overall; need = m.requirement.required;
    }
    return {
      id: r.id, at: r.at, by: r.by, action: r.action, label: ACTION_LABEL[r.action] || r.action, note: r.note || '',
      asOf: up ? up.reportAsOf : null, year: r.params.year, filename: up ? up.filename : '',
      employees: r.params.employees, amountPerEmployee: r.params.amountPerEmployee,
      voidCount: (r.voids || []).length, netOverall: net, required: need, current: !!cur && r.id === cur.id,
    };
  });
  res.json({ revisions: list });
}));

// ---------- admin: upload
app.post('/api/upload', auth.requireAdmin, wrap(async (req, res) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) return bad(res, 'No file was received.');
  const prev = store.state.current();
  const prevUpload = prev ? loadUpload(prev.uploadId) : null;
  let parsed;
  try { parsed = await parseWorkbook(req.body, { fallbackFundSources: prevUpload ? prevUpload.fundSources : DEFAULT_FUND_SOURCES, fallbackIsDefault: !prevUpload }); } catch (e) { return bad(res, e.message); }
  const filename = clean(decodeURIComponent(req.headers['x-filename'] || 'upload.xls'), 120);
  const fy = /FY\s*(\d{4})/i.exec(parsed.legalBasis || '');
  const guessYear = fy ? Number(fy[1]) : parsed.reportAsOf ? Number(parsed.reportAsOf.slice(0, 4)) : DEFAULTS.year;
  const params = prev ? prev.params : { ...DEFAULTS, year: guessYear };
  const uploadId = store.id();
  const upload = {
    id: uploadId, filename, uploadedAt: new Date().toISOString(), uploadedBy: req.user.name || req.user.username,
    reportAsOf: parsed.reportAsOf || todayManila(), legalBasis: parsed.legalBasis, fundAccount: parsed.fundAccount,
    fundSources: parsed.fundSources, fundSourcesFrom: parsed.fundSourcesFrom, offices: parsed.offices, ignored: parsed.ignored,
    unmatchedFundSources: parsed.unmatchedFundSources, warnings: parsed.warnings, check: parsed.check,
  };
  store.uploads.save(uploadId, upload);
  uploadCache.set(uploadId, upload);
  const rev = await addRevision({ action: 'upload', uploadId, params, voids: prev ? prev.voids : [], note: filename }, req.user);
  const model = modelFor(rev);
  res.json({
    ok: true, revisionId: rev.id,
    summary: {
      asOf: upload.reportAsOf, offices: model.offices.length, fundSources: upload.fundSources.length - upload.unmatchedFundSources.length,
      fundSourcesListed: upload.fundSources.length, fundSourcesFrom: upload.fundSourcesFrom, ignoredAccounts: upload.ignored.accounts,
      netOverall: model.totals.net.overall, warnings: upload.warnings, check: upload.check, year: params.year,
    },
  });
}));

// ---------- admin: figures
app.put('/api/params', auth.requireAdmin, wrap(async (req, res) => {
  const cur = store.state.current();
  if (!cur) return bad(res, 'Upload the e-budget report first.');
  const year = Number(req.body.year), employees = Number(req.body.employees), amount = Number(req.body.amountPerEmployee);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return bad(res, 'Enter a valid year, for example 2026.');
  if (!Number.isInteger(employees) || employees < 0 || employees > 1000000) return bad(res, 'Enter the number of employees as a whole number.');
  if (!Number.isFinite(amount) || amount < 0 || amount > 10000000) return bad(res, 'Enter the amount per employee as a number.');
  const params = { year, employees, amountPerEmployee: Math.round(amount * 100) / 100 };
  if (JSON.stringify(params) === JSON.stringify(cur.params)) return res.json({ ok: true, unchanged: true });
  const parts = [];
  if (params.year !== cur.params.year) parts.push(`year ${cur.params.year} to ${params.year}`);
  if (params.employees !== cur.params.employees) parts.push(`employees ${cur.params.employees.toLocaleString('en-US')} to ${params.employees.toLocaleString('en-US')}`);
  if (params.amountPerEmployee !== cur.params.amountPerEmployee) parts.push(`amount per employee ${cur.params.amountPerEmployee.toLocaleString('en-US')} to ${params.amountPerEmployee.toLocaleString('en-US')}`);
  const rev = await addRevision({ action: 'params', uploadId: cur.uploadId, params, voids: cur.voids, note: `Changed ${parts.join('; ')}` }, req.user);
  res.json({ ok: true, revisionId: rev.id });
}));

app.get('/api/options', auth.requireAuth, wrap(async (req, res) => {
  const cur = store.state.current();
  if (!cur) return res.json({ accounts: [], params: null, voids: [] });
  const up = loadUpload(cur.uploadId);
  const seen = new Map();
  for (const o of up.offices) for (const r of o.rows) if (!seen.has(norm(r.account))) seen.set(norm(r.account), { code: r.code, account: r.account });
  res.json({
    params: cur.params,
    accounts: [...seen.values()].sort((x, y) => String(x.code).localeCompare(String(y.code))),
    voids: cur.voids,
    snapshot: lastSnapshot,
  });
}));

// ---------- admin: voided fund sources
// A void applies to the fund source in every office. The office named is a remark only.
app.post('/api/voids', auth.requireAdmin, wrap(async (req, res) => {
  const cur = store.state.current();
  if (!cur) return bad(res, 'Upload the e-budget report first.');
  const up = loadUpload(cur.uploadId);
  const account = clean(req.body.account, 200);
  const officeRemark = clean(req.body.officeRemark, 200);
  const reason = clean(req.body.reason, 500);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body.dateVoided || '')) ? req.body.dateVoided : todayManila();
  if (!account) return bad(res, 'Choose the fund source to void.');
  if (!officeRemark) return bad(res, 'State the office.');
  if (!reason) return bad(res, 'State the reason for voiding.');
  let canon = null;
  for (const o of up.offices) { const r = o.rows.find((x) => norm(x.account) === norm(account)); if (r) { canon = r.account; break; } }
  if (!canon) return bad(res, 'Choose a fund source that is in the report.');
  if ((cur.voids || []).some((v) => norm(v.account) === norm(canon))) return bad(res, 'That fund source is already voided.');
  const added = { id: store.id(), account: canon, officeRemark, reason, dateVoided: date, addedBy: req.user.name || req.user.username };
  const rev = await addRevision({
    action: 'void-add', uploadId: cur.uploadId, params: cur.params, voids: [...(cur.voids || []), added],
    note: `${canon}, voided in all offices. Office: ${officeRemark}. Reason: ${reason}`,
  }, req.user);
  res.json({ ok: true, revisionId: rev.id });
}));

app.delete('/api/voids/:id', auth.requireAdmin, wrap(async (req, res) => {
  const cur = store.state.current();
  if (!cur) return bad(res, 'Nothing to change.');
  const v = (cur.voids || []).find((x) => x.id === req.params.id);
  if (!v) return bad(res, 'That voided fund source was not found.', 404);
  const reason = clean(req.body && req.body.reason, 300);
  if (!reason) return bad(res, 'State why the void is being removed.');
  const voids = cur.voids.filter((x) => x.id !== v.id);
  await addRevision({ action: 'void-remove', uploadId: cur.uploadId, params: cur.params, voids, note: `${v.account}. Reason for removing the void: ${reason}` }, req.user);
  res.json({ ok: true });
}));

app.post('/api/revisions/:id/restore', auth.requireAdmin, wrap(async (req, res) => {
  const s = store.state.load();
  const r = s.revisions.find((x) => x.id === req.params.id);
  if (!r) return bad(res, 'That version was not found.', 404);
  const cur = store.state.current(s);
  if (r.id === cur.id) return bad(res, 'That version is already the current one.');
  const up = loadUpload(r.uploadId);
  await addRevision({ action: 'restore', uploadId: r.uploadId, params: r.params, voids: r.voids, note: `Restored the version of ${new Date(r.at).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })} (report as of ${up ? up.reportAsOf : ''})` }, req.user);
  res.json({ ok: true });
}));

// ---------- admin: people
const userOut = (u) => ({ id: u.id, username: u.username, name: u.name, role: u.role, active: u.active, mustChange: !!u.mustChange, createdAt: u.createdAt });
app.get('/api/users', auth.requireAdmin, (req, res) => res.json({ users: store.users.all().map(userOut) }));
app.post('/api/users', auth.requireAdmin, wrap(async (req, res) => {
  const username = clean(req.body.username, 40).toLowerCase();
  const name = clean(req.body.name, 80);
  const role = req.body.role === 'admin' ? 'admin' : 'head';
  const password = String(req.body.password || '');
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) return bad(res, 'Use 3 to 40 letters, numbers, dots, dashes or underscores for the username.');
  if (!name) return bad(res, 'Enter the person\'s name.');
  const problem = auth.passwordProblem(password);
  if (problem) return bad(res, problem);
  const list = store.users.all();
  if (list.some((u) => u.username.toLowerCase() === username)) return bad(res, 'That username is already taken.');
  list.push({ id: store.id(), username, name, role, passHash: auth.hash(password), mustChange: true, active: true, createdAt: new Date().toISOString() });
  store.users.save(list);
  res.json({ ok: true });
}));
app.put('/api/users/:id', auth.requireAdmin, wrap(async (req, res) => {
  const list = store.users.all();
  const u = list.find((x) => x.id === req.params.id);
  if (!u) return bad(res, 'That person was not found.', 404);
  if (typeof req.body.active === 'boolean') {
    if (u.id === req.user.id && !req.body.active) return bad(res, 'You cannot turn off your own account.');
    u.active = req.body.active;
  }
  if (req.body.password) {
    const problem = auth.passwordProblem(String(req.body.password));
    if (problem) return bad(res, problem);
    u.passHash = auth.hash(String(req.body.password)); u.mustChange = true;
  }
  if (req.body.name) u.name = clean(req.body.name, 80);
  if (!list.some((x) => x.role === 'admin' && x.active)) return bad(res, 'At least one active administrator is required.');
  store.users.save(list);
  res.json({ ok: true });
}));

// ---------- admin: backups
app.get('/api/backups', auth.requireAdmin, (req, res) => res.json({ backups: store.listBackups().slice(0, 40), dir: store.BACKUP_DIR, snapshot: lastSnapshot, online: store.isPg }));
app.post('/api/backup', auth.requireAdmin, wrap(async (req, res) => {
  if (store.isPg) return bad(res, 'Use Download backup: the data is kept in the online database.');
  res.json({ ok: true, name: store.backupNow('manual') });
}));
app.get('/api/backup.json', auth.requireAdmin, wrap(async (req, res) => {
  const stampText = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="CNA_backup_${stampText}.json"`);
  res.send(JSON.stringify(store.exportAll()));
}));
app.post('/api/backup/restore', auth.requireAdmin, wrap(async (req, res) => {
  try { store.importAll(JSON.parse(Buffer.from(req.body || '').toString('utf8'))); } catch (e) { return bad(res, e instanceof SyntaxError ? 'That file is not a CNA Fund Monitor backup.' : e.message); }
  uploadCache.clear();
  refreshSnapshot().catch(() => {});
  res.json({ ok: true });
}));
app.get('/api/offline.html', auth.requireAuth, wrap(async (req, res) => {
  const cur = store.state.current();
  if (!cur) return bad(res, 'No report has been uploaded yet.', 404);
  const model = modelFor(cur);
  if (!model) return bad(res, 'The data for the latest report is missing.', 404);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="CNA_Fund_Sources_${model.meta.year}_as_of_${model.meta.asOf || 'report'}.html"`);
  res.send(snapshot.buildHtml(model, new Date().toISOString(), true));
}));

app.use('/api', (req, res) => bad(res, 'Not found.', 404));

// ---------- pages
app.use(express.static(path.join(__dirname, 'public'), { index: false, maxAge: 0 }));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ---------- start
async function start() {
  await store.init();
  const first = auth.ensureAdmin();
  if (first) {
    await store.flush();
    if (store.isPg) {
      console.log('\n==============================================\nFirst sign-in\n  Username: ' + first.username + (first.given ? '\n  Password: the one set as ADMIN_PASSWORD' : '\n  Password: ' + first.password) + '\nYou will be asked to choose a new password after signing in.\n==============================================\n');
    } else {
      const msg = `First sign-in\n  Username: ${first.username}\n  Password: ${first.password}\nYou will be asked to choose a new password after signing in.\n`;
      fs.writeFileSync(path.join(store.DATA_DIR, 'FIRST_LOGIN_PASSWORD.txt'), msg);
      console.log('\n==============================================\n' + msg + '==============================================\n');
    }
  }
  try { store.dailyBackupIfNeeded(); } catch (e) { console.error('Backup failed:', e.message); }
  setInterval(() => { try { store.dailyBackupIfNeeded(); } catch (e) { console.error('Backup failed:', e.message); } }, 3600e3).unref();
  refreshSnapshot().catch((e) => console.error('Could not save the offline copy:', e.message));

  app.listen(PORT, HOST, () => {
    console.log('CNA Fund Monitor is running.');
    console.log(`  On this computer:  http://localhost:${PORT}`);
    if (store.isPg) {
      console.log('  Data: online database (DATABASE_URL)');
    } else {
      for (const list of Object.values(os.networkInterfaces())) {
        for (const i of list || []) if (i.family === 'IPv4' && !i.internal) console.log(`  On the office network:  http://${i.address}:${PORT}`);
      }
      console.log(`  Data folder:  ${store.DATA_DIR}`);
      console.log(`  Offline copy folder:  ${snapshot.SNAP_DIR}`);
      console.log('Leave this window open while others use the report.\n');
    }
  });
}
start().catch((e) => { console.error('Could not start:', e.message); process.exit(1); });
