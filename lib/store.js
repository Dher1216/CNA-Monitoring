'use strict';
// Small file-based store: easy to back up (copy the data folder) and no database to install.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Two storage modes. With DATABASE_URL set (for example a Neon Postgres address) the data lives in
// that database; otherwise it lives in the data folder on this computer.
const DATABASE_URL = process.env.DATABASE_URL || '';
const isPg = !!DATABASE_URL;
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const BACKUP_DIR = path.resolve(process.env.BACKUP_DIR || path.join(DATA_DIR, 'backups'));
if (!isPg) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

// ---- Database mode: everything is kept in memory and written through to one table.
const mem = { users: [], state: { revisions: [] }, secret: '', uploads: new Map() };
let pool = null;
let queue = Promise.resolve();
let lastPersistError = null;
function persist(key, value) {
  if (!isPg) return;
  const text = value === null ? null : JSON.stringify(value);
  queue = queue.then(() => (text === null
    ? pool.query('DELETE FROM cna_kv WHERE key = $1', [key])
    : pool.query('INSERT INTO cna_kv (key, value, updated_at) VALUES ($1, $2, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()', [key, text])))
    .then(() => { lastPersistError = null; })
    .catch((e) => { lastPersistError = e; console.error('Could not save to the database:', e.message); });
}
// Resolves when everything changed so far is saved; throws if the last save failed.
async function flush() {
  if (!isPg) return;
  await queue;
  if (lastPersistError) throw lastPersistError;
}
async function init() {
  if (!isPg) return;
  const { Pool } = require('pg');
  const local = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(DATABASE_URL);
  pool = new Pool({ connectionString: DATABASE_URL, max: 3, idleTimeoutMillis: 20000, connectionTimeoutMillis: 30000, ssl: local ? false : { rejectUnauthorized: true } });
  pool.on('error', (e) => console.error('Database connection dropped (it will reconnect):', e.message));
  await pool.query('CREATE TABLE IF NOT EXISTS cna_kv (key text PRIMARY KEY, value text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())');
  const { rows } = await pool.query('SELECT key, value FROM cna_kv');
  for (const r of rows) {
    const v = JSON.parse(r.value);
    if (r.key === 'users') mem.users = v;
    else if (r.key === 'state') mem.state = v;
    else if (r.key === 'secret') mem.secret = v;
    else if (r.key.startsWith('upload:')) mem.uploads.set(r.key.slice(7), v);
  }
}

const files = {
  users: path.join(DATA_DIR, 'users.json'),
  state: path.join(DATA_DIR, 'state.json'),
  secret: path.join(DATA_DIR, 'secret.key'),
};

function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}
const id = () => crypto.randomBytes(6).toString('hex');

function getSecret() {
  if (isPg) {
    if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16) return process.env.SESSION_SECRET;
    if (!mem.secret) { mem.secret = crypto.randomBytes(32).toString('hex'); persist('secret', mem.secret); }
    return mem.secret;
  }
  try { return fs.readFileSync(files.secret, 'utf8').trim(); } catch (e) { /* create below */ }
  const s = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(files.secret, s, { mode: 0o600 });
  return s;
}

const users = {
  all: () => (isPg ? JSON.parse(JSON.stringify(mem.users)) : readJson(files.users, [])),
  save: (list) => {
    if (isPg) { mem.users = JSON.parse(JSON.stringify(list)); persist('users', mem.users); return; }
    writeAtomic(files.users, JSON.stringify(list, null, 2));
  },
};

const state = {
  load: () => (isPg ? JSON.parse(JSON.stringify(mem.state)) : readJson(files.state, { revisions: [] })),
  save: (s) => {
    if (isPg) { mem.state = JSON.parse(JSON.stringify(s)); persist('state', mem.state); return; }
    writeAtomic(files.state, JSON.stringify(s, null, 2));
  },
  current(s) { s = s || this.load(); return s.revisions[s.revisions.length - 1] || null; },
};

const uploads = {
  save: (uploadId, data) => {
    if (isPg) { mem.uploads.set(uploadId, data); persist('upload:' + uploadId, data); return; }
    writeAtomic(path.join(UPLOAD_DIR, `${uploadId}.json`), JSON.stringify(data));
  },
  load: (uploadId) => (isPg ? (mem.uploads.get(uploadId) || null) : readJson(path.join(UPLOAD_DIR, `${uploadId}.json`), null)),
};

// ---- Backup as one file the administrator can download, and restore from it.
// (Password hashes are included, so the file must be kept private. The session secret is not.)
function exportAll() {
  const up = {};
  if (isPg) for (const [k, v] of mem.uploads) up[k] = v;
  else {
    for (const f of fs.readdirSync(UPLOAD_DIR)) if (f.endsWith('.json')) up[f.slice(0, -5)] = readJson(path.join(UPLOAD_DIR, f), null);
  }
  return { app: 'cna-fund-monitor', version: 1, exportedAt: new Date().toISOString(), users: users.all(), state: state.load(), uploads: up };
}
function importAll(data) {
  if (!data || data.app !== 'cna-fund-monitor' || !Array.isArray(data.users) || !data.state || !Array.isArray(data.state.revisions) || typeof data.uploads !== 'object') {
    throw new Error('That is not a CNA Fund Monitor backup file.');
  }
  if (!data.users.some((u) => u && u.role === 'admin' && u.active)) throw new Error('The backup has no active administrator, so it was not restored.');
  for (const r of data.state.revisions) {
    if (r.uploadId && !data.uploads[r.uploadId]) throw new Error('The backup is incomplete (an uploaded report is missing).');
    if (r.uploadId && !/^[0-9a-f]{12}$/.test(r.uploadId)) throw new Error('The backup file is not valid.');
  }
  for (const k of Object.keys(data.uploads)) if (!/^[0-9a-f]{12}$/.test(k)) throw new Error('The backup file is not valid.');
  for (const [k, v] of Object.entries(data.uploads)) uploads.save(k, v);
  state.save(data.state);
  users.save(data.users);
}

// ---- Backups: a dated copy of the whole data folder (except the backups themselves)
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (path.resolve(s) === BACKUP_DIR) continue;
    if (e.isDirectory()) copyDir(s, d);
    else if (!e.name.endsWith('.tmp')) fs.copyFileSync(s, d);
  }
}
function stamp(d = new Date()) {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
}
function backupNow(kind = 'manual') {
  if (isPg) throw new Error('Folder backups are not used with the online database. Use Download backup instead.');
  const name = `${stamp()}_${kind}`;
  copyDir(DATA_DIR, path.join(BACKUP_DIR, name));
  pruneBackups();
  return name;
}
function listBackups() {
  if (isPg) return [];
  return fs.readdirSync(BACKUP_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory()).map((e) => e.name).sort().reverse();
}
function pruneBackups(keepDaily = 30) {
  const auto = listBackups().filter((n) => n.endsWith('_auto'));
  for (const n of auto.slice(keepDaily)) fs.rmSync(path.join(BACKUP_DIR, n), { recursive: true, force: true });
}
function dailyBackupIfNeeded() {
  if (isPg) return null;
  const today = stamp().slice(0, 10);
  if (!listBackups().some((n) => n.startsWith(today) && n.endsWith('_auto'))) return backupNow('auto');
  return null;
}

module.exports = { isPg, init, flush, exportAll, importAll, DATA_DIR, BACKUP_DIR, id, getSecret, users, state, uploads, backupNow, listBackups, dailyBackupIfNeeded };
