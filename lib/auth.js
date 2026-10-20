'use strict';
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const store = require('./store');

let SECRET = null; // read on first use, after the storage has loaded
const SESSION_HOURS = 10;
const COOKIE = 'cna_session';

const b64 = (b) => Buffer.from(b).toString('base64url');
const sign = (payload) => crypto.createHmac('sha256', SECRET || (SECRET = store.getSecret())).update(payload).digest('base64url');

function makeToken(user) {
  const body = b64(JSON.stringify({ uid: user.id, pv: user.passHash.slice(-10), exp: Date.now() + SESSION_HOURS * 3600e3 }));
  return `${body}.${sign(body)}`;
}
function readToken(token) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const good = sign(body);
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  let data;
  try { data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch (e) { return null; }
  if (!data.exp || data.exp < Date.now()) return null;
  const user = store.users.all().find((u) => u.id === data.uid && u.active);
  if (!user || user.passHash.slice(-10) !== data.pv) return null; // password change signs everyone out
  return user;
}
function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
const publicUser = (u) => ({ id: u.id, username: u.username, name: u.name, role: u.role, mustChange: !!u.mustChange });

function attachUser(req, res, next) {
  req.user = readToken(parseCookies(req.headers.cookie)[COOKIE]);
  next();
}
function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Sign in to continue.' });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Sign in to continue.' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only the administrator can do this.' });
  next();
}
// State-changing calls must carry a custom header, which other websites cannot add to a cross-site request.
function requireCsrfHeader(req, res, next) {
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method) && req.headers['x-requested-with'] !== 'cna-app') {
    return res.status(400).json({ error: 'Invalid request.' });
  }
  next();
}
const SECURE = (process.env.COOKIE_SECURE === '1' || process.env.RENDER) ? '; Secure' : '';
function setSession(res, user) {
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(makeToken(user))}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_HOURS * 3600}${SECURE}`);
}
function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${SECURE}`);
}

// Slow down password guessing: 5 misses locks that username+address for 15 minutes.
const misses = new Map();
function lockedFor(key) {
  const m = misses.get(key);
  if (!m || m.count < 5) return 0;
  const left = m.until - Date.now();
  if (left <= 0) { misses.delete(key); return 0; }
  return Math.ceil(left / 60000);
}
function recordMiss(key) {
  const m = misses.get(key) || { count: 0, until: 0 };
  m.count++; m.until = Date.now() + 15 * 60e3;
  misses.set(key, m);
}
const clearMisses = (key) => misses.delete(key);

const hash = (pw) => bcrypt.hashSync(pw, 10);
const check = (pw, h) => bcrypt.compareSync(pw, h);
function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'Use at least 8 characters for the password.';
  if (pw.length > 100) return 'The password is too long.';
  return null;
}

// First start: create the administrator with a random one-time password.
function ensureAdmin() {
  const list = store.users.all();
  if (list.some((u) => u.role === 'admin')) return null;
  const given = process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.length >= 8 ? process.env.ADMIN_PASSWORD : '';
  const pw = given || crypto.randomBytes(6).toString('base64url').replace(/[-_]/g, 'x');
  list.push({ id: store.id(), username: 'admin', name: 'Administrator', role: 'admin', passHash: hash(pw), mustChange: true, active: true, createdAt: new Date().toISOString() });
  store.users.save(list);
  return { username: 'admin', password: pw, given: !!given };
}

module.exports = { attachUser, requireAuth, requireAdmin, requireCsrfHeader, setSession, clearSession, lockedFor, recordMiss, clearMisses, hash, check, passwordProblem, ensureAdmin, publicUser };
