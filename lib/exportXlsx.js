'use strict';
const ExcelJS = require('exceljs');

const VIOLET = 'FF4B2A8A', VIOLET_LIGHT = 'FFECE6F8', GOLD_LIGHT = 'FFF6EBC9', RED = 'FFB3261E';
const NUM = '#,##0.00;[Red]-#,##0.00';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function longDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : '';
}
const title = (m) => `Fund Sources of the CNA Incentive (${m.meta.year})`;

function headRow(ws, rowNo, labels, leftN) {
  if (leftN == null) leftN = 2;
  const r = ws.getRow(rowNo);
  labels.forEach((l, i) => {
    const cell = r.getCell(i + 1);
    cell.value = l;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VIOLET } };
    cell.alignment = { vertical: 'middle', horizontal: i < leftN ? 'left' : 'right', wrapText: true };
  });
  r.height = 32;
}
function banner(ws, m, width) {
  ws.mergeCells(1, 1, 1, width); ws.mergeCells(2, 1, 2, width);
  ws.getCell('A1').value = title(m);
  ws.getCell('A1').font = { bold: true, size: 15, color: { argb: VIOLET } };
  ws.getCell('A2').value = `As of ${longDate(m.meta.asOf)}`;
  ws.getCell('A2').font = { italic: true, size: 11 };
}
const setNum = (cell, v, f) => {
  cell.value = f ? { formula: f, result: v } : v;
  cell.numFmt = NUM;
};

async function buildWorkbook(m, report) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'CNA Fund Monitor';
  wb.created = new Date();
  const t = m.totals, rq = m.requirement;

  // ---------- Summary
  const s = wb.addWorksheet('Summary', { views: [{ showGridLines: false }] });
  s.columns = [{ width: 46 }, { width: 22 }, { width: 22 }];
  banner(s, m, 3);
  s.getCell('A3').value = 'Provincial Government of Antique, Provincial Budget Office';
  s.getCell('A4').value = `E-budget report uploaded ${m.meta.uploadedAt ? new Date(m.meta.uploadedAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila' }) : ''}${m.meta.filename ? ` (${m.meta.filename})` : ''}`;
  s.getCell('A4').font = { size: 9, color: { argb: 'FF666666' } };

  headRow(s, 6, ['Available fund', 'Appropriation balance (20% retention)', 'Overall available (appropriation + allotment)']);
  s.getCell('A7').value = 'Appropriation balance';
  setNum(s.getCell('B7'), t.gross.approp); setNum(s.getCell('C7'), t.gross.approp);
  s.getCell('A8').value = 'Allotment balance';
  s.getCell('B8').value = '-'; s.getCell('B8').alignment = { horizontal: 'right' };
  setNum(s.getCell('C8'), t.gross.allot);
  s.getCell('A9').value = 'Total CNA fund sources per e-budget';
  setNum(s.getCell('B9'), t.gross.approp, 'B7'); setNum(s.getCell('C9'), t.gross.overall, 'C7+C8');
  s.getCell('A10').value = 'Less: voided fund sources';
  setNum(s.getCell('B10'), t.voided.approp); setNum(s.getCell('C10'), t.voided.overall);
  [10].forEach((r) => ['A', 'B', 'C'].forEach((col) => { s.getCell(`${col}${r}`).font = { color: { argb: RED } }; }));
  s.getCell('A11').value = 'Net available fund';
  setNum(s.getCell('B11'), t.net.approp, 'B9-B10'); setNum(s.getCell('C11'), t.net.overall, 'C9-C10');
  ['A', 'B', 'C'].forEach((col) => {
    const cell = s.getCell(`${col}11`);
    cell.font = { bold: true }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GOLD_LIGHT } };
    cell.border = { top: { style: 'thin' }, bottom: { style: 'double' } };
  });
  s.getCell('A8').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GOLD_LIGHT } };
  s.getCell('C8').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GOLD_LIGHT } };

  headRow(s, 13, ['Funding requirement', 'Value', '']);
  s.getCell('A14').value = 'Number of permanent employees';
  s.getCell('B14').value = rq.employees; s.getCell('B14').numFmt = '#,##0';
  s.getCell('A15').value = 'CNA incentive per employee';
  setNum(s.getCell('B15'), rq.amountPerEmployee);
  s.getCell('A16').value = 'Total amount to be funded';
  setNum(s.getCell('B16'), rq.required, 'B14*B15'); s.getCell('A16').font = { bold: true }; s.getCell('B16').font = { bold: true };

  headRow(s, 18, ['Can the fund cover the requirement?', 'Appropriation balance (20% retention)', 'Overall available']);
  s.getCell('A19').value = 'Net available fund';
  setNum(s.getCell('B19'), t.net.approp, 'B11'); setNum(s.getCell('C19'), t.net.overall, 'C11');
  s.getCell('A20').value = 'Total amount to be funded';
  setNum(s.getCell('B20'), rq.required, 'B16'); setNum(s.getCell('C20'), rq.required, 'B16');
  s.getCell('A21').value = 'Surplus / (shortfall)';
  setNum(s.getCell('B21'), rq.optionA.difference, 'B19-B20'); setNum(s.getCell('C21'), rq.optionB.difference, 'C19-C20');
  s.getCell('A22').value = 'Coverage';
  s.getCell('B22').value = { formula: 'IF(B20=0,"",B19/B20)', result: rq.optionA.percent == null ? '' : rq.optionA.percent / 100 };
  s.getCell('C22').value = { formula: 'IF(C20=0,"",C19/C20)', result: rq.optionB.percent == null ? '' : rq.optionB.percent / 100 };
  s.getCell('B22').numFmt = '0.00%'; s.getCell('C22').numFmt = '0.00%';
  s.getCell('A23').value = 'Result';
  s.getCell('B23').value = { formula: 'IF(B19>=B20,"Sufficient","Insufficient")', result: rq.optionA.ok ? 'Sufficient' : 'Insufficient' };
  s.getCell('C23').value = { formula: 'IF(C19>=C20,"Sufficient","Insufficient")', result: rq.optionB.ok ? 'Sufficient' : 'Insufficient' };
  ['B23', 'C23'].forEach((a) => { s.getCell(a).alignment = { horizontal: 'right' }; s.getCell(a).font = { bold: true }; });
  ['B22', 'C22', 'B21', 'C21'].forEach((a) => { s.getCell(a).alignment = { horizontal: 'right' }; });

  // ---------- Per office
  const wo = wb.addWorksheet('Per Office', { views: [{ state: 'frozen', ySplit: 4 }] });
  wo.columns = [{ width: 18 }, { width: 58 }, { width: 22 }, { width: 22 }, { width: 22 }, { width: 22 }];
  banner(wo, m, 6);
  headRow(wo, 4, ['Code', 'Office', 'Appropriation balance (20% retention)', 'Allotment balance', 'Overall available', 'Voided (deducted)']);
  let r = 5;
  const first = r;
  for (const o of m.offices) {
    wo.getCell(r, 1).value = o.code; wo.getCell(r, 2).value = o.name;
    setNum(wo.getCell(r, 3), o.net.approp); setNum(wo.getCell(r, 4), o.net.allot);
    setNum(wo.getCell(r, 5), o.net.overall, `C${r}+D${r}`);
    setNum(wo.getCell(r, 6), o.voided.overall);
    if (o.voided.overall > 0) wo.getCell(r, 6).font = { color: { argb: RED } };
    r++;
  }
  const last = r - 1;
  wo.getCell(r, 2).value = 'Net available fund';
  for (const [col, key] of [[3, 'approp'], [4, 'allot'], [5, 'overall']]) {
    const L = String.fromCharCode(64 + col);
    setNum(wo.getCell(r, col), t.net[key], `SUM(${L}${first}:${L}${last})`);
  }
  setNum(wo.getCell(r, 6), t.voided.overall, `SUM(F${first}:F${last})`);
  wo.getCell(r, 6).font = { bold: true, color: { argb: RED } };
  for (let col = 1; col <= 5; col++) {
    const c = wo.getCell(r, col); c.font = { bold: true }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GOLD_LIGHT } }; c.border = { top: { style: 'thin' }, bottom: { style: 'double' } };
  }

  // ---------- Per fund source
  const wf = wb.addWorksheet('Per Fund Source', { views: [{ state: 'frozen', ySplit: 4 }] });
  wf.columns = [{ width: 14 }, { width: 62 }, { width: 22 }, { width: 22 }, { width: 22 }, { width: 22 }];
  banner(wf, m, 6);
  headRow(wf, 4, ['Account code', 'Fund source', 'Appropriation balance (20% retention)', 'Allotment balance', 'Overall available', 'Voided (deducted)']);
  r = 5; const f1 = r;
  for (const a of m.accounts) {
    wf.getCell(r, 1).value = a.code; wf.getCell(r, 2).value = a.account;
    setNum(wf.getCell(r, 3), a.net.approp); setNum(wf.getCell(r, 4), a.net.allot);
    setNum(wf.getCell(r, 5), a.net.overall, `C${r}+D${r}`);
    setNum(wf.getCell(r, 6), a.voided.overall);
    if (a.voided.overall > 0) wf.getCell(r, 6).font = { color: { argb: RED } };
    r++;
  }
  const f2 = r - 1;
  wf.getCell(r, 2).value = 'Net available fund';
  for (const [col, key] of [[3, 'approp'], [4, 'allot'], [5, 'overall']]) {
    const L = String.fromCharCode(64 + col);
    setNum(wf.getCell(r, col), t.net[key], `SUM(${L}${f1}:${L}${f2})`);
  }
  setNum(wf.getCell(r, 6), t.voided.overall, `SUM(F${f1}:F${f2})`);
  wf.getCell(r, 6).font = { bold: true, color: { argb: RED } };
  for (let col = 1; col <= 5; col++) {
    const c = wf.getCell(r, col); c.font = { bold: true }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GOLD_LIGHT } }; c.border = { top: { style: 'thin' }, bottom: { style: 'double' } };
  }

  // ---------- Office x fund source detail
  const wd = wb.addWorksheet('Office Detail', { views: [{ state: 'frozen', ySplit: 4 }] });
  wd.columns = [{ width: 18 }, { width: 50 }, { width: 14 }, { width: 52 }, { width: 22 }, { width: 22 }, { width: 22 }, { width: 14 }];
  banner(wd, m, 8);
  headRow(wd, 4, ['Office code', 'Office', 'Account code', 'Fund source', 'Appropriation balance (20% retention)', 'Allotment balance', 'Overall', 'Status']);
  [3, 4, 8].forEach((i) => { wd.getRow(4).getCell(i).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true }; });
  r = 5;
  for (const o of m.offices) {
    for (const a of o.accounts) {
      wd.getCell(r, 1).value = o.code; wd.getCell(r, 2).value = o.name; wd.getCell(r, 3).value = a.code; wd.getCell(r, 4).value = a.account;
      setNum(wd.getCell(r, 5), a.approp); setNum(wd.getCell(r, 6), a.allot); setNum(wd.getCell(r, 7), a.overall, `E${r}+F${r}`);
      wd.getCell(r, 8).value = a.voided ? 'Voided' : 'Included';
      if (a.voided) for (let col = 1; col <= 8; col++) wd.getCell(r, col).font = { color: { argb: RED } };
      r++;
    }
  }
  wd.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: 8 } };

  // ---------- Voided funds
  const wv = wb.addWorksheet('Voided Funds', { views: [{ showGridLines: false }] });
  wv.columns = [{ width: 52 }, { width: 22 }, { width: 22 }, { width: 22 }, { width: 40 }, { width: 46 }, { width: 18 }];
  banner(wv, m, 7);
  if (!m.voids.length) {
    wv.getCell('A4').value = 'No fund sources have been voided.';
  } else {
    wv.getCell('A4').value = 'Voided fund sources (voided in every office)'; wv.getCell('A4').font = { bold: true, color: { argb: VIOLET } };
    headRow(wv, 5, ['Voided fund source', 'Appropriation balance', 'Allotment balance', 'Total voided', 'Office', 'Reason', 'Date voided']);
    wv.getRow(5).getCell(5).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    wv.getRow(5).getCell(6).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    wv.getRow(5).getCell(7).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    r = 6; const v1 = r;
    for (const v of m.voids) {
      wv.getCell(r, 1).value = v.account;
      setNum(wv.getCell(r, 2), v.approp); setNum(wv.getCell(r, 3), v.allot); setNum(wv.getCell(r, 4), v.overall, `B${r}+C${r}`);
      wv.getCell(r, 5).value = v.officeRemark; wv.getCell(r, 6).value = v.reason; wv.getCell(r, 7).value = longDate(v.dateVoided);
      for (let col = 1; col <= 7; col++) wv.getCell(r, col).font = { color: { argb: RED } };
      r++;
    }
    wv.getCell(r, 1).value = 'Total voided';
    for (const [col, key] of [[2, 'approp'], [3, 'allot'], [4, 'overall']]) {
      const L = String.fromCharCode(64 + col);
      setNum(wv.getCell(r, col), m.voidTotals[key], `SUM(${L}${v1}:${L}${r - 1})`);
    }
    for (let col = 1; col <= 4; col++) { const c = wv.getCell(r, col); c.font = { bold: true, color: { argb: RED } }; c.border = { top: { style: 'thin' }, bottom: { style: 'double' } }; }
    r += 2;
    wv.getCell(r, 1).value = 'Voided amount per office'; wv.getCell(r, 1).font = { bold: true, color: { argb: VIOLET } }; r++;
    headRow(wv, r, ['Office', 'Appropriation balance', 'Allotment balance', 'Total voided', 'Fund sources voided', '', '']);
    r++; const o1 = r;
    for (const e of m.voidByOffice) {
      wv.getCell(r, 1).value = e.name;
      setNum(wv.getCell(r, 2), e.approp); setNum(wv.getCell(r, 3), e.allot); setNum(wv.getCell(r, 4), e.overall, `B${r}+C${r}`);
      wv.getCell(r, 5).value = e.count; wv.getCell(r, 5).alignment = { horizontal: 'left' };
      for (let col = 1; col <= 5; col++) wv.getCell(r, col).font = { color: { argb: RED } };
      r++;
    }
    wv.getCell(r, 1).value = 'Total voided';
    for (const [col, key] of [[2, 'approp'], [3, 'allot'], [4, 'overall']]) {
      const L = String.fromCharCode(64 + col);
      setNum(wv.getCell(r, col), m.voidTotals[key], `SUM(${L}${o1}:${L}${r - 1})`);
    }
    for (let col = 1; col <= 4; col++) { const c = wv.getCell(r, col); c.font = { bold: true, color: { argb: RED } }; c.border = { top: { style: 'thin' }, bottom: { style: 'double' } }; }
  }

  for (const ws of wb.worksheets) {
    ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
    ws.headerFooter = { oddFooter: '&L&8Fund Sources of the CNA Incentive&R&8Page &P of &N' };
  }
  // One report only, when a single report was asked for
  const KEEP = { dashboard: ['Summary', 'Voided Funds'], summary: ['Summary', 'Voided Funds'], offices: ['Per Office', 'Office Detail', 'Voided Funds'], sources: ['Per Fund Source'], voided: ['Voided Funds'] };
  if (report && KEEP[report]) {
    for (const ws of [...wb.worksheets]) if (!KEEP[report].includes(ws.name)) wb.removeWorksheet(ws.id);
  }
  return wb;
}



// ======================================================================
// Summary report and Per office report: one basis, gross -> voided -> net
// ======================================================================
const BASIS_LABEL = { approp: 'Appropriation balance (20% retention)', overall: 'Overall available balance (appropriation + allotment)' };
const colKeys = (basis) => (basis === 'approp' ? ['approp'] : ['approp', 'allot', 'overall']);
const colLabels = (basis) => (basis === 'approp'
  ? ['Appropriation balance (20% retention)']
  : ['Appropriation balance (20% retention)', 'Allotment balance', 'Overall available (appropriation + allotment)']);
const letter = (i) => String.fromCharCode(65 + i); // 0-based column index
const fill = (c, argb) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } }; };

function amtRow(ws, r, label, vals, basis, o) {
  o = o || {};
  const keys = colKeys(basis);
  ws.getCell(r, 1).value = label;
  keys.forEach((k, i) => {
    const c = ws.getCell(r, 2 + i);
    let f = o.formulas ? o.formulas[i] : null;
    if (!f && k === 'overall' && !o.noOverallFormula) f = `B${r}+C${r}`;
    setNum(c, vals[k], f || undefined);
  });
  const width = 1 + keys.length;
  for (let col = 1; col <= width; col++) {
    const c = ws.getCell(r, col);
    if (o.bold || o.color) c.font = { bold: !!o.bold, color: o.color ? { argb: o.color } : undefined };
    if (o.fill) fill(c, o.fill);
    if (o.total) c.border = { top: { style: 'thin' }, bottom: { style: 'double' } };
  }
  if (basis === 'overall' && o.emphasizeAllot) fill(ws.getCell(r, 3), GOLD_LIGHT);
}
const sumF = (basis, first, last) => colKeys(basis).map((_, i) => `SUM(${letter(1 + i)}${first}:${letter(1 + i)}${last})`);

function sectionTitle(ws, r, text, red) {
  const c = ws.getCell(r, 1);
  c.value = text; c.font = { bold: true, size: 12, color: { argb: red ? RED : VIOLET } };
}

function voidedTable(ws, r, m, basis, rows, totals) {
  // returns { next, totalRow }
  const keys = colKeys(basis), n = keys.length;
  const labels = ['Voided fund source'].concat(colLabels(basis).map((l, i) => (keys[i] === 'overall' ? 'Total voided' : keys[i] === 'allot' ? 'Allotment balance' : 'Appropriation balance')), ['Office', 'Reason', 'Date voided']);
  headRow(ws, r, labels, 1);
  for (let i = 0; i < 3; i++) ws.getRow(r).getCell(2 + n + i).alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
  r++;
  const first = r;
  for (const v of rows) {
    amtRow(ws, r, v.account, v, basis, { color: RED });
    const t = [v.officeRemark, v.reason, longDate(v.dateVoided)];
    t.forEach((x, i) => { const c = ws.getCell(r, 2 + n + i); c.value = x; c.font = { color: { argb: RED } }; c.alignment = { wrapText: true, vertical: 'top' }; });
    r++;
  }
  const totalRow = r;
  amtRow(ws, r, 'Total voided', totals, basis, { bold: true, color: RED, total: true, formulas: sumF(basis, first, r - 1), noOverallFormula: true });
  return { next: r + 2, totalRow, first };
}

function requirementBlock(ws, r, m, basis, netRefs) {
  // netRefs: cell address of the net available amount for each key
  const rq = m.requirement;
  sectionTitle(ws, r, 'Funding requirement'); r++;
  headRow(ws, r, ['Item', 'Value'], 1); r++;
  const eR = r;
  ws.getCell(r, 1).value = 'Number of permanent employees'; ws.getCell(r, 2).value = rq.employees; ws.getCell(r, 2).numFmt = '#,##0'; r++;
  ws.getCell(r, 1).value = 'CNA incentive per employee'; setNum(ws.getCell(r, 2), rq.amountPerEmployee); r++;
  const totR = r;
  ws.getCell(r, 1).value = 'Total amount to be funded'; setNum(ws.getCell(r, 2), rq.required, `B${eR}*B${eR + 1}`);
  ws.getCell(r, 1).font = { bold: true }; ws.getCell(r, 2).font = { bold: true }; r += 2;
  const opt = basis === 'approp' ? rq.optionA : rq.optionB;
  const key = basis === 'approp' ? 'approp' : 'overall';
  ws.getCell(r, 1).value = 'Net available fund (' + (basis === 'approp' ? 'appropriation balance' : 'overall') + ')';
  setNum(ws.getCell(r, 2), opt.available, netRefs[key]); const aR = r; r++;
  ws.getCell(r, 1).value = 'Surplus / (shortfall)'; setNum(ws.getCell(r, 2), opt.difference, `B${aR}-B${totR}`); r++;
  ws.getCell(r, 1).value = 'Coverage';
  ws.getCell(r, 2).value = { formula: `IF(B${totR}=0,"",B${aR}/B${totR})`, result: opt.percent == null ? '' : opt.percent / 100 }; ws.getCell(r, 2).numFmt = '0.00%'; r++;
  ws.getCell(r, 1).value = 'Result';
  ws.getCell(r, 2).value = { formula: `IF(B${aR}>=B${totR},"Sufficient","Insufficient")`, result: opt.ok ? 'Sufficient' : 'Insufficient' };
  ws.getCell(r, 2).font = { bold: true };
  for (let k = eR; k <= r; k++) ws.getCell(k, 2).alignment = { horizontal: 'right' };
  return r + 2;
}

function netBlock(ws, r, m, basis, title, grossRefs, voidRefs, vals) {
  // grossRefs/voidRefs: arrays of formula text per column; returns { next, netRow }
  sectionTitle(ws, r, title); r++;
  headRow(ws, r, ['Item'].concat(colLabels(basis)), 1); r++;
  const g = r;
  amtRow(ws, r, 'Total before voided fund sources', vals.gross, basis, { formulas: grossRefs, noOverallFormula: true }); r++;
  amtRow(ws, r, 'Less: voided fund sources', vals.voided, basis, { formulas: voidRefs, noOverallFormula: true, color: RED }); r++;
  const fm = colKeys(basis).map((_, i) => `${letter(1 + i)}${g}-${letter(1 + i)}${g + 1}`);
  amtRow(ws, r, 'Net available fund for CNA', vals.net, basis, { bold: true, fill: GOLD_LIGHT, total: true, formulas: fm, noOverallFormula: true });
  return { next: r + 2, netRow: r };
}

function accountsBlock(ws, r, o, basis) {
  headRow(ws, r, ['Fund source'].concat(colLabels(basis)), 1); r++;
  const first = r;
  for (const a of o.accounts) { if (!(a.approp || a.allot)) continue; amtRow(ws, r, a.account, a, basis, { emphasizeAllot: false }); r++; }
  const last = r - 1;
  return { first, last, next: r };
}

async function buildReportWorkbook(m, opts) {
  const basis = opts.basis === 'overall' ? 'overall' : 'approp';
  const wb = new ExcelJS.Workbook();
  wb.creator = 'CNA Fund Monitor'; wb.created = new Date();
  const keys = colKeys(basis), n = keys.length;
  const t = m.totals;
  const allOffices = opts.report === 'offices' && opts.office === 'all';
  const one = opts.report === 'offices' && !allOffices ? m.offices.find((o) => o.code === opts.office) : null;
  const ws = wb.addWorksheet(opts.report === 'summary' ? 'Summary' : 'Per Office', { views: [{ showGridLines: false }] });
  const widths = [58]; for (let i = 0; i < n; i++) widths.push(24); widths.push(36, 46, 18);
  ws.columns = widths.map((w) => ({ width: w }));
  banner(ws, m, 1 + n);
  const kind = opts.report === 'summary' ? 'Summary report' : 'Per office report: ' + (allOffices ? 'All offices' : one ? one.name : '');
  ws.getCell('A3').value = `${kind}, ${BASIS_LABEL[basis]}`;
  ws.getCell('A3').font = { bold: true, color: { argb: VIOLET } };
  ws.getCell('A4').value = `E-budget report uploaded ${m.meta.uploadedAt ? new Date(m.meta.uploadedAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila' }) : ''}${m.meta.filename ? ` (${m.meta.filename})` : ''}`;
  ws.getCell('A4').font = { size: 9, color: { argb: 'FF666666' } };
  let r = 6;
  const lastKey = keys[n - 1];
  const netRefs = {};

  if (opts.report === 'summary') {
    sectionTitle(ws, r, 'Available fund per office (before voided fund sources)'); r++;
    headRow(ws, r, ['Office'].concat(colLabels(basis)), 1); r++;
    const f = r;
    for (const o of m.offices) { amtRow(ws, r, `${o.name} (${o.code})`, o.gross, basis); r++; }
    const grossTotal = r;
    amtRow(ws, r, 'Total before voided fund sources', t.gross, basis, { bold: true, total: true, formulas: sumF(basis, f, r - 1), noOverallFormula: true });
    r += 2;
    sectionTitle(ws, r, 'Voided fund sources', true); r++;
    let voidTotalRow = null;
    if (m.voids.length) { const vt = voidedTable(ws, r, m, basis, m.voids, m.voidTotals); r = vt.next; voidTotalRow = vt.totalRow; }
    else { ws.getCell(r, 1).value = 'No fund sources have been voided.'; r += 2; }
    const gRefs = keys.map((_, i) => `${letter(1 + i)}${grossTotal}`);
    const vRefs = keys.map((_, i) => (voidTotalRow ? `${letter(1 + i)}${voidTotalRow}` : '0'));
    const nb = netBlock(ws, r, m, basis, 'Net available fund for CNA', gRefs, vRefs, { gross: t.gross, voided: t.voided, net: t.net });
    r = nb.next;
    keys.forEach((k, i) => { netRefs[k] = `${letter(1 + i)}${nb.netRow}`; });
    r = requirementBlock(ws, r, m, basis, netRefs);
  } else if (one) {
    sectionTitle(ws, r, 'Fund sources of ' + one.name); r++;
    const ab = accountsBlock(ws, r, one, basis); r = ab.next;
    const grossRow = r;
    amtRow(ws, r, 'Total before voided fund sources', one.gross, basis, { bold: true, total: true, formulas: sumF(basis, ab.first, ab.last), noOverallFormula: true });
    r += 2;
    sectionTitle(ws, r, 'Voided fund sources', true); r++;
    const vrows = one.accounts.filter((a) => a.voided && (a.approp || a.allot)).map((a) => {
      const v = m.voids.find((x) => x.account === a.account) || {};
      return { account: a.account, approp: a.approp, allot: a.allot, overall: a.overall, officeRemark: v.officeRemark || '', reason: v.reason || '', dateVoided: v.dateVoided || '' };
    });
    let voidTotalRow = null;
    if (vrows.length) { const vt = voidedTable(ws, r, m, basis, vrows, one.voided); r = vt.next; voidTotalRow = vt.totalRow; }
    else { ws.getCell(r, 1).value = 'No voided fund sources in ' + one.name + '.'; r += 2; }
    const gRefs = keys.map((_, i) => `${letter(1 + i)}${grossRow}`);
    const vRefs = keys.map((_, i) => (voidTotalRow ? `${letter(1 + i)}${voidTotalRow}` : '0'));
    netBlock(ws, r, m, basis, 'Net available fund of ' + one.name, gRefs, vRefs, { gross: one.gross, voided: one.voided, net: one.net });
  } else if (allOffices) {
    const grossRows = [], netRows = [];
    for (const o of m.offices) {
      sectionTitle(ws, r, `${o.name} (${o.code})`); r++;
      const ab = accountsBlock(ws, r, o, basis); r = ab.next;
      grossRows.push(r);
      amtRow(ws, r, 'Total before voided fund sources', o.gross, basis, { bold: true, formulas: sumF(basis, ab.first, ab.last), noOverallFormula: true, fill: VIOLET_LIGHT });
      const g = r; r++;
      const vs = o.accounts.filter((a) => a.voided && (a.approp || a.allot));
      const v1 = r;
      for (const a of vs) { amtRow(ws, r, 'Less: ' + a.account, a, basis, { color: RED }); r++; }
      const vf = vs.length ? sumF(basis, v1, r - 1) : keys.map(() => '0');
      netRows.push(r);
      amtRow(ws, r, 'Net available fund of ' + o.name, o.net, basis, { bold: true, fill: GOLD_LIGHT, total: true, noOverallFormula: true,
        formulas: keys.map((_, i) => `${letter(1 + i)}${g}-${vs.length ? `SUM(${letter(1 + i)}${v1}:${letter(1 + i)}${r - 1})` : '0'}`) });
      void vf;
      r += 2;
    }
    // Province totals sit above the voided table; the voided table follows at a known row.
    const netBlockStart = r;
    const voidTableStart = netBlockStart + 6; // title + head + 3 rows + blank
    const voidTotalRow = m.voids.length ? voidTableStart + 1 + 1 + m.voids.length : null; // title row, head row, rows, then total
    const gRefs = keys.map((_, i) => grossRows.map((x) => `${letter(1 + i)}${x}`).join('+'));
    const vRefs = keys.map((_, i) => (voidTotalRow ? `${letter(1 + i)}${voidTotalRow}` : '0'));
    const nb = netBlock(ws, r, m, basis, 'All offices: net available fund for CNA', gRefs, vRefs, { gross: t.gross, voided: t.voided, net: t.net });
    r = nb.next;
    keys.forEach((k, i) => { netRefs[k] = `${letter(1 + i)}${nb.netRow}`; });
    if (r !== voidTableStart) throw new Error('layout drift ' + r + ' ' + voidTableStart);
    sectionTitle(ws, r, 'Voided fund sources', true); r++;
    if (m.voids.length) {
      const vt = voidedTable(ws, r, m, basis, m.voids, m.voidTotals);
      if (vt.totalRow !== voidTotalRow) throw new Error('void total row drift');
      r = vt.next;
    } else { ws.getCell(r, 1).value = 'No fund sources have been voided.'; r += 2; }
    r = requirementBlock(ws, r, m, basis, netRefs);
  }
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
  ws.headerFooter = { oddFooter: '&L&8Fund Sources of the CNA Incentive&R&8Page &P of &N' };
  return wb;
}

module.exports = { buildWorkbook, buildReportWorkbook, longDate };
