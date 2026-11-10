'use strict';
// Turns an uploaded e-budget snapshot + admin inputs (year, employees, amount) + voided fund sources
// into the report model shown on screen, printed, exported and saved as an offline copy.
// All arithmetic is done in whole centavos to avoid floating-point drift.
// A voided fund source is voided in every office. The office named on a void is a remark only.
// The uploaded report holds every account line; only the fund sources the administrator selected are counted.
const { norm } = require('./parse');
const c = (v) => Math.round((Number(v) || 0) * 100);
const p = (v) => v / 100;

// The fund sources in force for a version: the administrator's selection, or (versions saved before
// the selection existed) the list that came with the upload.
function selectionOf(revision, upload) {
  return (revision && revision.fundSources) || (upload && upload.fundSources) || [];
}

function computeModel({ upload, revision, params, voids, fundSources, pgso, meta }) {
  const selected = new Set((fundSources || selectionOf(revision, upload)).map(norm));
  const allAccounts = !!upload.allAccounts; // older uploads kept only the CNA lines
  const ignored = { accounts: 0, approp: 0, allot: 0, oblig: 0 };
  const voidMap = new Map(); // normalised account name -> void entry
  for (const v of voids || []) if (!voidMap.has(norm(v.account))) voidMap.set(norm(v.account), v);

  const acctMap = new Map(); // province-wide, per fund source
  const sum = () => ({ approp: 0, allot: 0 });
  const gross = sum(), voided = sum();
  const offices = [];

  for (const o of upload.offices) {
    const row = { code: o.code, name: o.name, net: sum(), voided: sum(), gross: sum(), accounts: [], voidedCount: 0 };
    for (const r of o.rows) {
      if (allAccounts && !selected.has(norm(r.account))) {
        ignored.accounts++; ignored.approp += c(r.approp); ignored.allot += c(r.allot); ignored.oblig += c(r.oblig);
        continue;
      }
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

  // PGSO balances. The e-budget figures stay as they are (they are the budget office's actual balances);
  // where the administrator entered the balance PGSO holds for a fund source in an office, it is shown beside
  // the budget office balance, with the difference and the net available fund adjusted by that difference.
  // Entries for a fund source that is voided or not selected have no effect, because that fund source is not counted.
  const pg = pgso || (revision && revision.pgso) || null;
  let pgsoOut = null;
  if (pg && Array.isArray(pg.entries) && pg.entries.length) {
    const rows = [], byOffice = new Map(), pgMap = new Map(), accts = new Map();
    const T = { boA: 0, boL: 0, pgA: 0, pgL: 0 };
    for (const e of pg.entries) {
      const key = norm(e.account);
      const office = upload.offices.find((o) => o.code === e.office);
      if (!office || !selected.has(key) || voidMap.has(key)) continue;
      const line = office.rows.find((x) => norm(x.account) === key);
      const boA = line ? c(line.approp) : 0, boL = line ? c(line.allot) : 0;
      const pgA = e.approp != null ? c(e.approp) : boA, pgL = e.allot != null ? c(e.allot) : boL;
      T.boA += boA; T.boL += boL; T.pgA += pgA; T.pgL += pgL;
      pgMap.set(office.code + '|' + key, { pgA, pgL });
      if (!accts.has(key)) accts.set(key, { account: line ? line.account : e.account, code: line ? line.code : '' });
      const d = byOffice.get(office.code) || { approp: 0, allot: 0 };
      d.approp += pgA - boA; d.allot += pgL - boL; byOffice.set(office.code, d);
      rows.push({
        officeCode: office.code, officeName: office.name, account: line ? line.account : e.account, code: line ? line.code : '',
        bo: fmtSum({ approp: boA, allot: boL }), pgso: fmtSum({ approp: pgA, allot: pgL }), diff: fmtSum({ approp: pgA - boA, allot: pgL - boL }),
        enteredApprop: e.approp != null, enteredAllot: e.allot != null,
      });
    }
    if (rows.length) {
      rows.sort((x, y) => String(x.officeCode).localeCompare(String(y.officeCode), undefined, { numeric: true }) || String(x.code).localeCompare(String(y.code)));
      const dA = T.pgA - T.boA, dL = T.pgL - T.boL;
      const adj = { approp: net.approp + dA, allot: net.allot + dL };
      // For the PGSO adjusted fuel and oil report: every office that has the fund source, with the PGSO balance where one was
      // entered and the budget office balance (unchanged) where not.
      const byAccount = [...accts].map(([key, a]) => {
        const list = [], X = { boA: 0, boL: 0, pgA: 0, pgL: 0 };
        for (const o of upload.offices) {
          const line = o.rows.find((x) => norm(x.account) === key);
          const hit = pgMap.get(o.code + '|' + key);
          const boA = line ? c(line.approp) : 0, boL = line ? c(line.allot) : 0;
          if (!hit && !boA && !boL) continue;
          const pgA = hit ? hit.pgA : boA, pgL = hit ? hit.pgL : boL;
          X.boA += boA; X.boL += boL; X.pgA += pgA; X.pgL += pgL;
          list.push({ officeCode: o.code, officeName: o.name, entered: !!hit, bo: fmtSum({ approp: boA, allot: boL }), pgso: fmtSum({ approp: pgA, allot: pgL }), diff: fmtSum({ approp: pgA - boA, allot: pgL - boL }) });
        }
        return {
          account: a.account, code: a.code, rows: list,
          totals: { bo: fmtSum({ approp: X.boA, allot: X.boL }), pgso: fmtSum({ approp: X.pgA, allot: X.pgL }), diff: fmtSum({ approp: X.pgA - X.boA, allot: X.pgL - X.boL }) },
        };
      }).sort((x, y) => String(x.code).localeCompare(String(y.code)) || x.account.localeCompare(y.account));
      pgsoOut = {
        asOf: pg.asOf || '',
        rows,
        byAccount,
        totals: { bo: fmtSum({ approp: T.boA, allot: T.boL }), pgso: fmtSum({ approp: T.pgA, allot: T.pgL }), diff: fmtSum({ approp: dA, allot: dL }) },
        byOffice: Object.fromEntries([...byOffice].map(([k, v]) => [k, fmtSum(v)])),
        adjusted: { net: fmtSum(adj), requirement: { optionA: cover(adj.approp), optionB: cover(adj.approp + adj.allot) } },
      };
    }
  }

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
    pgso: pgsoOut,
    ignored: allAccounts ? { accounts: ignored.accounts, approp: p(ignored.approp), allot: p(ignored.allot), oblig: p(ignored.oblig) } : upload.ignored,
    staleVoids: voidList.filter((v) => !v.inReport).length,
  };
}

module.exports = { computeModel, selectionOf };
