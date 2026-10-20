'use strict';
// Reads the e-budget report ("Balances of Appropriations / Allotments per Object of Expenditures")
// from .xls (as exported by the e-budget system) or .xlsx, and keeps only the accounts that fund the CNA.
// The list of CNA fund sources comes from a "CNA Fund Source" sheet when the file has one;
// otherwise the list saved with the previous upload is reused.
const ExcelJS = require('exceljs');
const XLSX = require('xlsx');

const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase();
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function cellText(v) {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    if ('result' in v) return cellText(v.result);
    if (v.text != null) return String(v.text);
    return '';
  }
  return String(v);
}
function cellNum(v) {
  if (v && typeof v === 'object' && !(v instanceof Date) && 'result' in v) v = v.result;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/[,\s₱]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }
  return 0; // blank cells in the e-budget report mean zero
}
const cents = (v) => Math.round(v * 100);
const pad = (n) => String(n).padStart(2, '0');

function parseAsOf(text) {
  const m = /([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(text);
  if (!m) return null;
  const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
  if (!mo) return null;
  return `${m[3]}-${pad(mo)}-${pad(Number(m[2]))}`;
}
function isoFromSerial(n) { // Excel date serial -> yyyy-mm-dd
  const d = new Date(Math.round((n - 25569) * 86400000));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

// ---- Turn any supported file into plain rows: [{ name, rows: [[cell, cell, ...], ...] }]
async function loadSheets(buffer) {
  const isZip = buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
  if (isZip) {
    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(buffer); } catch (e) { throw new Error('The file could not be read as an Excel workbook.'); }
    return wb.worksheets.map((ws) => {
      const rows = [];
      ws.eachRow({ includeEmpty: true }, (row, n) => {
        const arr = [];
        for (let c = 1; c <= 8; c++) arr.push(row.getCell(c).value);
        rows[n - 1] = arr;
      });
      for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
      return { name: ws.name, rows };
    });
  }
  // Older .xls (and web-page or text exports saved as .xls)
  let wb;
  try { wb = XLSX.read(buffer, { type: 'buffer', cellDates: false }); } catch (e) { wb = null; }
  if (!wb || !wb.SheetNames.length) throw new Error('The file could not be read. Open it in Excel and save it as .xlsx, then upload that file.');
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    let rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });
    const startCol = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']).s.c : 0;
    if (startCol > 0) rows = rows.map((r) => Array(startCol).fill(null).concat(r));
    return { name, rows };
  });
}

async function parseWorkbook(buffer, opts) {
  opts = opts || {};
  const sheets = await loadSheets(buffer);

  // Find the e-budget report sheet by content, and the fund-source sheet by name.
  const reportSheet = sheets.find((s) => s.rows.some((r) => /^responsibility center/i.test(cellText(r[0]).trim())));
  if (!reportSheet) throw new Error('No e-budget report was found in this file. The report must contain "Responsibility Center" rows.');
  let fundSheet = sheets.find((s) => s !== reportSheet && /fund\s*source/i.test(s.name));
  if (!fundSheet) fundSheet = sheets.find((s) => s !== reportSheet) || null;

  // ---- CNA fund sources
  let fundSources = [];
  let fundSourcesFrom = 'file';
  if (fundSheet) {
    const seen = new Set();
    for (const r of fundSheet.rows) {
      const t = cellText(r[0]).replace(/^\(\d{4,10}\)\.?\s*/, '').replace(/\s+/g, ' ').trim();
      const n = norm(t);
      if (!n || n === 'account name' || n === 'cna fund sources' || n === 'cna fund source') continue;
      if (!seen.has(n)) { seen.add(n); fundSources.push(t); }
    }
  }
  if (!fundSources.length && opts.fallbackFundSources && opts.fallbackFundSources.length) {
    fundSources = opts.fallbackFundSources.slice();
    fundSourcesFrom = opts.fallbackIsDefault ? 'default' : 'previous';
  }
  if (!fundSources.length) {
    throw new Error('This file has no list of CNA fund sources. For the first upload, add a sheet named "CNA Fund Source" with one account name per row.');
  }

  // ---- E-budget report
  const out = {
    reportTitle: '', legalBasis: '', fundAccount: '', reportAsOf: null,
    offices: [], fundSources, fundSourcesFrom, unmatchedFundSources: [], warnings: [],
    ignored: { accounts: 0, approp: 0, allot: 0, oblig: 0 },
    check: null,
  };
  const fsMap = new Map(fundSources.map((n) => [norm(n), n]));
  const acctRe = /^\((\d{4,10})\)\.?\s*(.*)$/;
  const cols = { approp: 1, allot: 2, oblig: 3 }; // zero-based column positions
  let office = null;
  const officeMap = new Map();
  const matched = new Set();
  let allApprop = 0, allAllot = 0, allOblig = 0; // every account line, to cross-check the report's Grand Total
  let grand = null;
  let dateSerial = null;

  for (const row of reportSheet.rows) {
    const rawA = row[0];
    const a = cellText(rawA).trim();
    if (rawA instanceof Date) dateSerial = `${rawA.getUTCFullYear()}-${pad(rawA.getUTCMonth() + 1)}-${pad(rawA.getUTCDate())}`;
    else if (typeof rawA === 'number' && rawA > 30000 && rawA < 80000) dateSerial = isoFromSerial(rawA);
    if (!a) continue;
    if (/^balances of appropriations/i.test(a)) out.reportTitle = a;
    else if (/^as of\s/i.test(a)) { out.reportAsOf = out.reportAsOf || parseAsOf(a); }
    else if (/^legal basis/i.test(a)) out.legalBasis = cellText(row[1]).trim();
    else if (/^fund account/i.test(a)) out.fundAccount = cellText(row[1]).trim();
    else if (/^object of expenditures/i.test(a)) {
      for (let c = 1; c <= 7; c++) {
        const h = norm(cellText(row[c]));
        if (h.includes('appropriation balance')) cols.approp = c;
        else if (h.includes('allotment balance')) cols.allot = c;
        else if (h.includes('obligation')) cols.oblig = c;
      }
    } else if (/^responsibility center/i.test(a)) {
      const v = cellText(row[1]).trim();
      const dot = v.indexOf('.');
      const code = dot > 0 ? v.slice(0, dot).trim() : v;
      const name = dot > 0 ? v.slice(dot + 1).trim() : v;
      if (!officeMap.has(code)) { office = { code, name, rowsMap: new Map() }; officeMap.set(code, office); out.offices.push(office); }
      else office = officeMap.get(code);
    } else if (/^grand total/i.test(a)) {
      grand = { approp: cellNum(row[cols.approp]), allot: cellNum(row[cols.allot]), oblig: cellNum(row[cols.oblig]) };
    } else {
      const m = acctRe.exec(a);
      if (!m || !office) continue;
      const code = m[1];
      const name = m[2].replace(/\s+/g, ' ').trim();
      const vals = { approp: cellNum(row[cols.approp]), allot: cellNum(row[cols.allot]), oblig: cellNum(row[cols.oblig]) };
      allApprop += cents(vals.approp); allAllot += cents(vals.allot); allOblig += cents(vals.oblig);
      const key = norm(name);
      if (!fsMap.has(key)) {
        out.ignored.accounts++;
        out.ignored.approp += cents(vals.approp); out.ignored.allot += cents(vals.allot); out.ignored.oblig += cents(vals.oblig);
        continue;
      }
      matched.add(key);
      const ex = office.rowsMap.get(key);
      if (ex) { ex.approp += cents(vals.approp); ex.allot += cents(vals.allot); ex.oblig += cents(vals.oblig); }
      else office.rowsMap.set(key, { code, account: fsMap.get(key), approp: cents(vals.approp), allot: cents(vals.allot), oblig: cents(vals.oblig) });
    }
  }

  // Finalise: centavos -> pesos
  out.offices = out.offices.map((o) => ({
    code: o.code, name: o.name,
    rows: [...o.rowsMap.values()].map((r) => ({ code: r.code, account: r.account, approp: r.approp / 100, allot: r.allot / 100, oblig: r.oblig / 100 })),
  }));
  out.ignored = { accounts: out.ignored.accounts, approp: out.ignored.approp / 100, allot: out.ignored.allot / 100, oblig: out.ignored.oblig / 100 };
  out.unmatchedFundSources = fundSources.filter((n) => !matched.has(norm(n)));

  if (!out.reportAsOf && dateSerial) out.reportAsOf = dateSerial;
  if (!out.reportAsOf) out.warnings.push('The report date could not be read from the file, so the upload date is used instead.');
  if (!out.offices.some((o) => o.rows.length)) throw new Error('None of the CNA fund sources were found in the e-budget report. Check that the account names match.');
  if (out.unmatchedFundSources.length) {
    out.warnings.push(`${out.unmatchedFundSources.length} CNA fund source(s) were not found in this report: ${out.unmatchedFundSources.join('; ')}.`);
  }

  // Cross-check against the report's Grand Total. The totals are always taken from the account lines;
  // some e-budget exports leave the Sub Total and Grand Total cells at zero, so a zero total is skipped, not treated as an error.
  if (grand) {
    const pairs = [['appropriation balance', grand.approp, allApprop], ['allotment balance', grand.allot, allAllot], ['total obligations', grand.oblig, allOblig]];
    const verified = [], skipped = [], failed = [];
    for (const [label, reported, parsed] of pairs) {
      if (Math.abs(reported) < 0.005 && parsed !== 0) skipped.push(label);
      else if (Math.abs(cents(reported) - parsed) <= 100) verified.push(label);
      else failed.push(label);
    }
    out.check = { ok: failed.length === 0, verified, skipped, failed };
    if (failed.length) out.warnings.push(`The account lines do not add up to the report's Grand Total for: ${failed.join(', ')}. Check that the file is complete.`);
  }
  return out;
}

module.exports = { parseWorkbook, norm };
