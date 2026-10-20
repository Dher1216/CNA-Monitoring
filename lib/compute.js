'use strict';
// Turns an uploaded e-budget snapshot + admin inputs (year, employees, amount) + voided fund sources
// into the report model shown on screen, printed, exported and saved as an offline copy.
// All arithmetic is done in whole centavos to avoid floating-point drift.
// A voided fund source is voided in every office. The office named on a void is a remark only.
const { norm } = require('./parse');
const c = (v) => Math.round((Number(v) || 0) * 100);
const p = (v) => v / 100;

function computeModel({ upload, revision, params, voids, meta }) {
  const voidMap = new Map(); // normalised account name -> void entry
  for (const v of voids || []) if (!voidMap.has(norm(v.account))) voidMap.set(norm(v.account), v);

  const acctMap = new Map(); // province-wide, per fund source
  const sum = () => ({ approp: 0, allot: 0 });
  const gross = sum(), voided = sum();
  const offices = [];

  for (const o of upload.offices) {
    const row = { code: o.code, name: o.name, net: sum(), voided: sum(), gross: sum(), accounts: [], voidedCount: 0 };
    for (const r of o.rows) {
      const isVoid = voidMap.has(norm(r.account));
      const a = c(r.approp), l = c(r.allot);
      row.gross.approp += a; row.gross.allot += l;
      if (isVoid) { row.voided.approp += a; row.voided.allot += l; row.voidedCount++; } else { row.net.approp += a; row.net.allot += l; }
      row.accounts.push({ code: r.code, account: r.account, voided: isVoid, approp: p(a), allot: p(l), overall: p(a + l) });
      let am = acctMap.get(norm(r.account));
      if (!am) { am = { code: r.code, account: r.account, net: sum(), voided: sum(), gross: sum(), byOffice: [] }; acctMap.set(norm(r.account), am); }
      am.gross.approp += a; am.gross.allot += l;
      if (isVoid) { am.voided.approp += a; am.voided.allot += l; am.byOffice.push({ code: o.code, name: o.name, approp: a, allot: l }); } else { am.net.approp += a; am.net.allot += l; }
      gross.approp += a; gross.allot += l;
      if (isVoid) { voided.approp += a; voided.allot += l; }
    }
    offices.push(row);
  }
  const net = { approp: gross.approp - voided.approp, allot: gross.allot - voided.allot };

  const fmtSum = (s) => ({ approp: p(s.approp), allot: p(s.allot), overall: p(s.approp + s.allot) });
  const outOffices = offices
    .filter((o) => o.accounts.length)
    .map((o) => ({ code: o.code, name: o.name, net: fmtSum(o.net), voided: fmtSum(o.voided), gross: fmtSum(o.gross), accounts: o.accounts }));
  const outAccounts = [...acctMap.values()]
    .sort((x, y) => String(x.code).localeCompare(String(y.code)))
    .map((a) => ({ code: a.code, account: a.account, net: fmtSum(a.net), voided: fmtSum(a.voided), gross: fmtSum(a.gross) }));

  // Voided fund sources: one line each, with the total across all offices and the admin's remarks.
  const voidList = [...voidMap.values()].map((v) => {
    const am = acctMap.get(norm(v.account));
    const a = am ? am.voided.approp : 0, l = am ? am.voided.allot : 0;
    return {
      id: v.id, account: am ? am.account : v.account, code: am ? am.code : '',
      officeRemark: v.officeRemark != null ? v.officeRemark : (v.officeName || ''),
      reason: v.reason, dateVoided: v.dateVoided, addedBy: v.addedBy,
      approp: p(a), allot: p(l), overall: p(a + l), inReport: !!am,
      officesAffected: am ? am.byOffice.filter((x) => x.approp || x.allot).length : 0,
    };
  });
  // Voided amount per office (sum of that office's voided fund sources)
  const voidByOffice = offices
    .filter((o) => o.voidedCount && (o.voided.approp || o.voided.allot))
    .map((o) => ({
      code: o.code, name: o.name,
      count: o.accounts.filter((x) => x.voided && (x.approp || x.allot)).length,
      approp: p(o.voided.approp), allot: p(o.voided.allot), overall: p(o.voided.approp + o.voided.allot),
    }));

  // Funding requirement
  const employees = Math.max(0, Math.floor(Number(params.employees) || 0));
  const amount = c(params.amountPerEmployee);
  const required = employees * amount;
  const cover = (avail) => ({
    available: p(avail),
    difference: p(avail - required),
    ok: avail >= required,
    percent: required > 0 ? Math.round((avail / required) * 10000) / 100 : null,
  });
  const netOverall = net.approp + net.allot;

  return {
    meta: {
      year: params.year, asOf: upload.reportAsOf, uploadedAt: upload.uploadedAt, uploadedBy: upload.uploadedBy,
      filename: upload.filename, legalBasis: upload.legalBasis, fundAccount: upload.fundAccount,
      revisionId: revision.id, revisionAt: revision.at, revisionBy: revision.by, revisionAction: revision.action,
      ...(meta || {}),
    },
    totals: { gross: fmtSum(gross), voided: fmtSum(voided), net: fmtSum(net) },
    requirement: {
      employees, amountPerEmployee: p(amount), required: p(required),
      optionA: cover(net.approp), optionB: cover(netOverall),
    },
    offices: outOffices,
    accounts: outAccounts,
    voids: voidList,
    voidByOffice,
    voidTotals: fmtSum(voided),
    ignored: upload.ignored,
    staleVoids: voidList.filter((v) => !v.inReport).length,
  };
}

module.exports = { computeModel };
