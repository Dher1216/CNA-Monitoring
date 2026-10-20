'use strict';
// Saves everything in the data folder (reports, history, voided fund sources, accounts) as ONE backup file
// that can be restored on another copy of the app (for example the online version).
// Usage: node export-backup.js [output-file]
const fs = require('fs');
const path = require('path');
try {
  const c = JSON.parse(fs.readFileSync(path.join(__dirname, 'settings.json'), 'utf8'));
  if (c.dataDir && !process.env.DATA_DIR) process.env.DATA_DIR = String(c.dataDir);
} catch (e) { /* no settings file */ }
delete process.env.DATABASE_URL; // always read the data folder
const store = require('./lib/store');
if (!fs.existsSync(path.join(store.DATA_DIR, 'state.json'))) {
  console.error('No data found in ' + store.DATA_DIR + '. Run this from the app folder that holds your data folder.');
  process.exit(1);
}
const data = store.exportAll();
const out = path.resolve(process.argv[2] || `CNA_backup_${new Date().toISOString().slice(0, 10)}.json`);
fs.writeFileSync(out, JSON.stringify(data));
console.log(`Saved ${data.state.revisions.length} history entries, ${Object.keys(data.uploads).length} uploaded report(s) and ${data.users.length} account(s) to:\n${out}`);
