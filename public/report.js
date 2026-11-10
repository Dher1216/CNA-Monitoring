/* Renders the CNA fund reports. Shared by the web app and the saved offline copy. */
(function (root) {
  'use strict';
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  var BASES = [
    { key: 'approp', label: 'Appropriation balance (20% retention)' },
    { key: 'overall', label: 'Overall available balance (appropriation + allotment)' }
  ];
  var REPORTS = [
    { key: 'summary', label: 'Summary report' },
    { key: 'offices', label: 'Per office report' },
    { key: 'sources', label: 'Per fund source report' },
    { key: 'voided', label: 'Voided funds report' },
    { key: 'fuel', label: 'PGSO adjusted Fuel and Oil report' }
  ];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function fmt(n) { return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function peso(n) { return '₱' + fmt(n); }
  function cell(n) { return Number(n) ? fmt(n) : '<span class="nil">–</span>'; }
  function red(n) { return Number(n) ? '<span class="void">(' + fmt(n) + ')</span>' : '<span class="nil">–</span>'; }
  function longDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    return m ? MONTHS[Number(m[2]) - 1] + ' ' + Number(m[3]) + ', ' + m[1] : '';
  }
  function stamp(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleString('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  function label(list, key) { for (var i = 0; i < list.length; i++) if (list[i].key === key) return list[i].label; return ''; }

  // ---------- shared pieces
  function header(m, opts, subtitle) {
    var meta = m.meta, src = [];
    if (meta.uploadedAt) src.push('E-budget report uploaded ' + stamp(meta.uploadedAt));
    if (meta.uploadedBy) src.push('by ' + meta.uploadedBy);
    return '<header class="rep-head">' +
      '<img class="rep-seal" src="' + esc((opts && opts.sealSrc) || '/seal.png') + '" alt="Official seal of the Province of Antique" width="84" height="84">' +
      '<div class="rep-titles">' +
      '<p class="rep-org">Province of Antique<span>Provincial Budget Office</span></p>' +
      '<h1>Fund Sources of the CNA Incentive (' + esc(meta.year) + ')</h1>' +
      '<p class="rep-asof">As of ' + esc(longDate(meta.asOf)) + '</p>' +
      (subtitle ? '<p class="rep-kind">' + esc(subtitle) + '</p>' : '') +
      '</div>' +
      '<p class="rep-src">' + esc(src.join(' ')) + (meta.fundAccount ? '<br>Fund: ' + esc(meta.fundAccount) : '') + '</p>' +
      '</header>';
  }
  function footer(m) {
    var note = 'Only the ' + m.accounts.length + ' CNA fund sources are counted.';
    if (m.ignored && m.ignored.accounts) note += ' The ' + m.ignored.accounts + ' lines for other accounts in the e-budget report are not included.';
    return '<footer class="rep-foot"><p>' + esc(note) + (m.meta.legalBasis ? ' Legal basis of the report: ' + esc(m.meta.legalBasis) + '.' : '') + '</p></footer>';
  }
  function ledger(gross, voided) {
    return '<dl class="ledger">' +
      '<div><dt>Total CNA fund sources per e-budget</dt><dd>' + peso(gross) + '</dd></div>' +
      '<div class="void"><dt>Less: voided fund sources</dt><dd>' + (Number(voided) ? '(' + peso(voided) + ')' : peso(0)) + '</dd></div>' +
      '</dl>';
  }
  function verdict(c, required) {
    var short = !c.ok;
    return '<div class="verdict ' + (short ? 'is-short' : 'is-ok') + '"><span class="badge ' + (short ? 'badge-short' : 'badge-ok') + '">' + (short ? 'Not enough' : 'Enough') + '</span>' +
      '<span>Needs ' + peso(required) + (short ? ', deficit of ' : ', excess of ') + peso(Math.abs(c.difference)) + '</span></div>';
  }
  function coverRow(lbl, c, required) {
    var max = Math.max(c.available, required, 1);
    var fill = Math.max(0, Math.min(100, (c.available / max) * 100));
    var mark = Math.max(0, Math.min(100, (required / max) * 100));
    var short = !c.ok;
    return '<div class="cover ' + (short ? 'is-short' : 'is-ok') + '">' +
      '<div class="cover-head"><h3>' + esc(lbl) + '</h3>' +
      '<span class="badge ' + (short ? 'badge-short' : 'badge-ok') + '">' + (short ? 'Not enough' : 'Enough') + '</span></div>' +
      '<div class="bar" role="img" aria-label="' + esc(lbl) + ' covers ' + (c.percent == null ? 0 : c.percent) + ' percent of the requirement">' +
      '<span class="bar-fill" style="width:' + fill.toFixed(2) + '%"></span>' +
      '<span class="bar-mark" style="left:' + mark.toFixed(2) + '%"></span></div>' +
      '<dl class="cover-nums">' +
      '<div><dt>Available</dt><dd>' + peso(c.available) + '</dd></div>' +
      '<div><dt>Required</dt><dd>' + peso(required) + '</dd></div>' +
      '<div class="' + (short ? 'void' : 'good') + '"><dt>' + (short ? 'Deficit' : 'Excess') + '</dt><dd>' + peso(Math.abs(c.difference)) + '</dd></div>' +
      '<div><dt>Coverage</dt><dd>' + (c.percent == null ? '–' : fmt(c.percent) + '%') + '</dd></div>' +
      '</dl></div>';
  }
  function equation(rq) {
    return '<div class="equation"><div class="eq-part"><span class="eq-n">' + Number(rq.employees).toLocaleString('en-US') + '</span><span class="eq-l">permanent employees</span></div>' +
      '<span class="eq-op" aria-hidden="true">×</span>' +
      '<div class="eq-part"><span class="eq-n">' + peso(rq.amountPerEmployee) + '</span><span class="eq-l">CNA incentive per employee</span></div>' +
      '<span class="eq-op" aria-hidden="true">=</span>' +
      '<div class="eq-part eq-total"><span class="eq-n">' + peso(rq.required) + '</span><span class="eq-l">total amount to be funded</span></div></div>';
  }
  function requirementBlock(m, basis) {
    var rq = m.requirement;
    var covers = basis === 'approp' ? coverRow(label(BASES, 'approp'), rq.optionA, rq.required)
      : basis === 'overall' ? coverRow('Overall available balance', rq.optionB, rq.required)
      : coverRow(label(BASES, 'approp'), rq.optionA, rq.required) + coverRow('Overall available balance', rq.optionB, rq.required);
    return '<section class="block" id="requirement"><h2>Funding requirement</h2>' + equation(rq) + '<div class="covers' + (basis ? ' covers-one' : '') + '">' + covers + '</div></section>';
  }

  // ---------- columns that depend on the chosen basis
  function head(basis, first) {
    var a = '<th scope="col" class="num">Appropriation balance<small>20% retention</small></th>';
    if (basis === 'approp') return '<th scope="col">' + first + '</th>' + a;
    return '<th scope="col">' + first + '</th>' + a + '<th scope="col" class="num emph-head">Allotment balance</th><th scope="col" class="num">Overall available<small>appropriation + allotment</small></th>';
  }
  function cells(basis, o) {
    if (basis === 'approp') return '<td>' + cell(o.approp) + '</td>';
    return '<td>' + cell(o.approp) + '</td><td class="emph-cell">' + cell(o.allot) + '</td><td class="overall-cell">' + cell(o.overall) + '</td>';
  }
  function redCells(basis, o) {
    if (basis === 'approp') return '<td>' + red(o.approp) + '</td>';
    return '<td>' + red(o.approp) + '</td><td>' + red(o.allot) + '</td><td>' + red(o.overall) + '</td>';
  }
  function pesoCells(basis, o, cls) {
    if (basis === 'approp') return '<td>' + peso(o.approp) + '</td>';
    return '<td>' + peso(o.approp) + '</td><td class="emph-cell">' + peso(o.allot) + '</td><td class="' + (cls || '') + '">' + peso(o.overall) + '</td>';
  }
  function ncols(basis) { return basis === 'approp' ? 2 : 4; }
  function amount(basis, o) { return basis === 'approp' ? o.approp : o.overall; }

  // cover = rq.optionA / rq.optionB for the basis shown; given only for the whole-province boxes.
  // pg = m.pgso: when PGSO balances exist, the adjusted net available fund follows the net available fund.
  function netBox(title, gross, voided, net, basis, cover, required, pg) {
    var g = amount(basis, gross), v = amount(basis, voided), n = amount(basis, net);
    var key = basis === 'approp' ? 'approp' : 'overall';
    var adj = '', extra = '';
    if (pg) {
      adj = '<div><dt>Add / (less): difference per PGSO<small>PGSO balance less budget office balance</small></dt><dd>' + signedPeso(pg.totals.diff[key]) + '</dd></div>' +
        '<div class="net net-adj"><dt>Net available fund adjusted for PGSO</dt><dd>' + peso(pg.adjusted.net[key]) + '</dd></div>';
    }
    if (cover) {
      var short = !cover.ok;
      extra = '<div class="fund-need"><dt>Less: amount to be funded</dt><dd>(' + peso(required) + ')</dd></div>' +
        '<div class="excess ' + (short ? 'is-short' : 'is-ok') + '"><dt>' + (short ? 'Deficit' : 'Excess') + (pg ? ', per budget office' : '') + '<small>net available fund ' + (short ? 'below' : 'above') + ' the amount to be funded</small></dt><dd>' + (short ? '(' + peso(Math.abs(cover.difference)) + ')' : peso(cover.difference)) + '</dd></div>';
      if (pg) {
        var ac = key === 'approp' ? pg.adjusted.requirement.optionA : pg.adjusted.requirement.optionB, ashort = !ac.ok;
        extra += '<div class="excess excess-adj ' + (ashort ? 'is-short' : 'is-ok') + '"><dt>' + (ashort ? 'Deficit' : 'Excess') + ', adjusted for PGSO<small>adjusted net available fund ' + (ashort ? 'below' : 'above') + ' the amount to be funded</small></dt><dd>' + (ashort ? '(' + peso(Math.abs(ac.difference)) + ')' : peso(ac.difference)) + '</dd></div>';
      }
    }
    return '<section class="block" id="net"><h2>' + esc(title) + '</h2><div class="netbox"><dl>' +
      '<div><dt>Total before voided fund sources</dt><dd>' + peso(g) + '</dd></div>' +
      '<div class="void"><dt>Less: voided fund sources</dt><dd>' + (v ? '(' + peso(v) + ')' : peso(0)) + '</dd></div>' +
      (basis === 'overall' ? '<div><dt>Net appropriation balance</dt><dd>' + peso(net.approp) + '</dd></div><div class="emph"><dt>Net allotment balance</dt><dd>' + peso(net.allot) + '</dd></div>' : '') +
      '<div class="net"><dt>Net available fund for CNA</dt><dd>' + peso(n) + '</dd></div>' + adj + extra + '</dl></div></section>';
  }

  // ---------- PGSO balances (fuel and oil and other accounts the administrator adjusted)
  // The budget office figures are the actual e-budget balances; the PGSO balance is shown beside them.
  function signed(n) {
    n = Number(n) || 0;
    if (!n) return '<span class="nil">–</span>';
    return n < 0 ? '<span class="void">(' + fmt(Math.abs(n)) + ')</span>' : '<span class="good">' + fmt(n) + '</span>';
  }
  function signedText(n) {
    n = Number(n) || 0;
    return n < 0 ? '(' + peso(Math.abs(n)) + ')' : peso(n);
  }
  function signedPeso(n) {
    n = Number(n) || 0;
    return n < 0 ? '<span class="void">(' + peso(Math.abs(n)) + ')</span>' : '<span class="' + (n ? 'good' : '') + '">' + peso(n) + '</span>';
  }
  function pgsoNote(m) {
    var pg = m.pgso, old = pg.asOf && m.meta.asOf && String(pg.asOf) < String(m.meta.asOf);
    return 'The budget office balances are the actual balances in the e-budget report. PGSO still has transactions that have not been transferred to the budget office, so the balances PGSO holds' +
      (pg.asOf ? ' as of ' + esc(longDate(pg.asOf)) : '') + ' are shown beside them. The difference is PGSO less the budget office.' +
      (old ? ' <strong>The PGSO figures are older than the e-budget report, so they may need to be updated.</strong>' : '');
  }
  function sumRows(rows) {
    var t = { bo: { approp: 0, allot: 0 }, pgso: { approp: 0, allot: 0 }, diff: { approp: 0, allot: 0 } };
    rows.forEach(function (r) {
      ['bo', 'pgso', 'diff'].forEach(function (k) { t[k].approp += Math.round(r[k].approp * 100); t[k].allot += Math.round(r[k].allot * 100); });
    });
    ['bo', 'pgso', 'diff'].forEach(function (k) { t[k] = { approp: t[k].approp / 100, allot: t[k].allot / 100, overall: (t[k].approp + t[k].allot) / 100 }; });
    return t;
  }
  function pgsoTable(rows, key, total, showOffice) {
    var lbl = key === 'approp' ? 'Appropriation balance' : 'Overall available balance';
    var h = '<thead><tr>' + (showOffice ? '<th scope="col">Office</th>' : '') + '<th scope="col">Fund source</th>' +
      '<th scope="col" class="num">Budget office<small>' + lbl + '</small></th><th scope="col" class="num">PGSO<small>' + lbl + '</small></th>' +
      '<th scope="col" class="num">Difference<small>PGSO less budget office</small></th></tr></thead>';
    var b = '';
    rows.forEach(function (r) {
      b += '<tr>' + (showOffice ? '<th scope="row"><span class="oname">' + esc(r.officeName) + '</span><span class="acode">' + esc(r.officeCode) + '</span></th><td class="lft">' + esc(r.account) + '</td>'
        : '<th scope="row"><span class="acode">' + esc(r.code) + '</span>' + esc(r.account) + '</th>') +
        '<td>' + cell(r.bo[key]) + '</td><td>' + cell(r.pgso[key]) + '</td><td>' + signed(r.diff[key]) + '</td></tr>';
    });
    var f = '<tfoot><tr class="foot-net"><th scope="row"' + (showOffice ? ' colspan="2"' : '') + '>Total</th><td>' + peso(total.bo[key]) + '</td><td>' + peso(total.pgso[key]) + '</td><td>' + signedPeso(total.diff[key]) + '</td></tr></tfoot>';
    return '<div class="tbl-scroll"><table class="tbl tbl-pgso">' + h + '<tbody>' + b + '</tbody>' + f + '</table></div>';
  }
  // Net available fund per the budget office, the PGSO difference, and the net available fund adjusted for PGSO.
  function adjustedBox(m, basis, officeCode) {
    var pg = m.pgso, key = basis === 'approp' ? 'approp' : 'overall', base, diff, adj, cover = null;
    if (officeCode) {
      var o = null; m.offices.forEach(function (x) { if (x.code === officeCode) o = x; });
      base = o ? o.net[key] : 0;
      diff = pg.byOffice[officeCode] ? pg.byOffice[officeCode][key] : 0;
      adj = Math.round((base + diff) * 100) / 100;
    } else {
      base = m.totals.net[key]; diff = pg.totals.diff[key]; adj = pg.adjusted.net[key];
      cover = key === 'approp' ? pg.adjusted.requirement.optionA : pg.adjusted.requirement.optionB;
    }
    var h = '<div class="netbox pgso-box"><dl>' +
      '<div><dt>Net available fund per budget office</dt><dd>' + peso(base) + '</dd></div>' +
      '<div><dt>Add / (less): difference per PGSO</dt><dd>' + signedPeso(diff) + '</dd></div>' +
      '<div class="net"><dt>Net available fund adjusted for PGSO</dt><dd>' + peso(adj) + '</dd></div>';
    if (cover) {
      var short = !cover.ok;
      h += '<div class="fund-need"><dt>Less: amount to be funded</dt><dd>(' + peso(m.requirement.required) + ')</dd></div>' +
        '<div class="excess ' + (short ? 'is-short' : 'is-ok') + '"><dt>' + (short ? 'Deficit' : 'Excess') + ' after the PGSO adjustment</dt><dd>' + (short ? '(' + peso(Math.abs(cover.difference)) + ')' : peso(cover.difference)) + '</dd></div>';
    }
    return h + '</dl></div>';
  }
  // basis: 'approp' | 'overall' | 'both' (the dashboard and the per fund source report). officeCode limits it to one office.
  function pgsoBlock(m, basis, officeCode) {
    var pg = m.pgso;
    if (!pg) return '';
    var rows = officeCode ? pg.rows.filter(function (r) { return r.officeCode === officeCode; }) : pg.rows;
    if (!rows.length) return '';
    var key = basis === 'approp' ? 'approp' : 'overall';
    var html = '<section class="block block-pgso" id="pgso"><h2>' + (officeCode ? 'PGSO balance' : 'Adjusted for PGSO balances') + '</h2><p class="muted">' + pgsoNote(m) + '</p>' +
      pgsoTable(rows, key, officeCode ? sumRows(rows) : pg.totals, !officeCode);
    if (basis === 'both') {
      html += '<h3 class="pgso-sub">' + esc(label(BASES, 'approp')) + '</h3>' + adjustedBox(m, 'approp') +
        '<h3 class="pgso-sub">Overall available balance</h3>' + adjustedBox(m, 'overall');
    } else html += adjustedBox(m, basis, officeCode);
    return html + '</section>';
  }

  // ---------- PGSO adjusted Fuel and Oil report: one table per fund source PGSO holds balances for
  function fuelTable(a) {
    var h = '<thead><tr><th scope="col" rowspan="2">Office</th><th scope="colgroup" colspan="3" class="grp">Budget office (actual)</th><th scope="colgroup" colspan="3" class="grp grp-pgso">PGSO adjusted</th><th scope="col" rowspan="2" class="num">Difference<small>overall, PGSO less budget office</small></th></tr>' +
      '<tr><th scope="col" class="num">Appropriation balance</th><th scope="col" class="num">Allotment balance</th><th scope="col" class="num">Overall available</th>' +
      '<th scope="col" class="num">Appropriation balance</th><th scope="col" class="num">Allotment balance</th><th scope="col" class="num">Overall available</th></tr></thead>';
    var b = '';
    a.rows.forEach(function (r) {
      b += '<tr' + (r.entered ? '' : ' class="no-pgso"') + '><th scope="row"><span class="oname">' + esc(r.officeName) + '</span><span class="acode">' + esc(r.officeCode) + '</span>' + (r.entered ? '' : '<small>no PGSO balance entered, same as the budget office</small>') + '</th>' +
        '<td>' + cell(r.bo.approp) + '</td><td>' + cell(r.bo.allot) + '</td><td>' + cell(r.bo.overall) + '</td>' +
        '<td>' + cell(r.pgso.approp) + '</td><td>' + cell(r.pgso.allot) + '</td><td class="grand-cell">' + cell(r.pgso.overall) + '</td><td>' + signed(r.diff.overall) + '</td></tr>';
    });
    var t = a.totals;
    var f = '<tfoot><tr class="foot-net"><th scope="row">Total</th><td>' + peso(t.bo.approp) + '</td><td>' + peso(t.bo.allot) + '</td><td>' + peso(t.bo.overall) + '</td><td>' + peso(t.pgso.approp) + '</td><td>' + peso(t.pgso.allot) + '</td><td class="grand-cell">' + peso(t.pgso.overall) + '</td><td>' + signedPeso(t.diff.overall) + '</td></tr></tfoot>';
    return '<div class="tbl-scroll"><table class="tbl tbl-fuel">' + h + '<tbody>' + b + '</tbody>' + f + '</table></div>';
  }
  function fuelReport(m, opts) {
    var pg = m.pgso;
    var html = '<article class="sheet" id="report">' + header(m, opts, 'PGSO adjusted Fuel and Oil report');
    if (!pg) {
      return html + '<section class="block"><p class="muted">No PGSO balances have been entered yet. The budget office enters them under PGSO balances, and this report then shows the adjusted balance of each office.</p></section>' + footer(m) + '</article>';
    }
    html += '<section class="block"><p class="muted">' + pgsoNote(m) + '</p></section>';
    pg.byAccount.forEach(function (a) {
      html += '<section class="block" id="fuel"><h2>' + esc(a.account) + '</h2>' + fuelTable(a) + '</section>';
    });
    html += '<section class="block" id="pgso"><h2>Effect on the net available fund for CNA</h2><p class="muted">The difference per PGSO, whole province, applied to the net available fund.</p>' +
      '<h3 class="pgso-sub">' + esc(label(BASES, 'approp')) + '</h3>' + adjustedBox(m, 'approp') +
      '<h3 class="pgso-sub">Overall available balance</h3>' + adjustedBox(m, 'overall') + '</section>';
    return html + footer(m) + '</article>';
  }

  // ---------- voided tables
  function voidedFundTable(basis, rows, total, withRemarks) {
    var h = '<th scope="col">Voided fund source</th><th scope="col" class="num">Appropriation balance</th>' + (basis === 'overall' ? '<th scope="col" class="num">Allotment balance</th><th scope="col" class="num">Total voided</th>' : '') +
      '<th scope="col">Office</th><th scope="col">Reason</th><th scope="col">Date voided</th>';
    var b = '';
    rows.forEach(function (v) {
      b += '<tr><th scope="row"><span class="acode">' + esc(v.code) + '</span>' + esc(v.account) + '</th><td>' + peso(v.approp) + '</td>' +
        (basis === 'overall' ? '<td>' + peso(v.allot) + '</td><td>' + peso(v.overall) + '</td>' : '') +
        '<td class="reason">' + esc(v.officeRemark) + '</td><td class="reason">' + esc(v.reason) + '</td><td class="when">' + esc(longDate(v.dateVoided)) + '</td></tr>';
    });
    var f = '<tr><th scope="row">Total voided</th><td>' + peso(total.approp) + '</td>' + (basis === 'overall' ? '<td>' + peso(total.allot) + '</td><td>' + peso(total.overall) + '</td>' : '') + '<td colspan="3"></td></tr>';
    return '<div class="tbl-scroll"><table class="tbl tbl-void"><thead><tr>' + h + '</tr></thead><tbody>' + b + '</tbody><tfoot>' + f + '</tfoot></table></div>';
  }
  function remarkFor(m, account) {
    for (var i = 0; i < m.voids.length; i++) if (m.voids[i].account === account) return m.voids[i];
    return { officeRemark: '', reason: '', dateVoided: '' };
  }

  // ---------- Dashboard
  function dashboard(m, opts) {
    var t = m.totals, rq = m.requirement;
    var html = '<article class="sheet" id="report">' + header(m, opts, '');
    html += '<section class="summary" id="summary" aria-label="Available fund">' +
      '<div class="panel panel-a"><h2>Appropriation balance</h2><p class="sub">Available under the 20% retention, per fund source</p>' +
      '<p class="big">' + peso(t.net.approp) + '</p>' + ledger(t.gross.approp, t.voided.approp) + verdict(rq.optionA, rq.required) + '</div>' +
      '<div class="panel panel-b"><h2>Overall available balance</h2><p class="sub">Not yet obligated: appropriation balance plus allotment balance</p>' +
      '<dl class="compose"><div><dt>Appropriation balance</dt><dd>' + peso(t.net.approp) + '</dd></div>' +
      '<div class="emph"><dt>Allotment balance</dt><dd>' + peso(t.net.allot) + '</dd></div></dl>' +
      '<p class="grand-label">Overall available balance</p><p class="grand">' + peso(t.net.overall) + '</p>' +
      ledger(t.gross.overall, t.voided.overall) + verdict(rq.optionB, rq.required) + '</div></section>';
    html += requirementBlock(m, '');
    html += pgsoBlock(m, 'both');
    html += voidedBlock(m);
    return html + footer(m) + '</article>';
  }
  function voidedBlock(m) {
    if (!m.voids.length) return '<section class="block" id="voided"><h2>Voided fund sources</h2><p class="muted">No fund sources have been voided.</p></section>';
    var stale = m.staleVoids ? '<p class="notice">' + m.staleVoids + (m.staleVoids > 1 ? ' voided fund sources do' : ' voided fund source does') + ' not appear in this e-budget report, so ' + (m.staleVoids > 1 ? 'their amounts show' : 'its amount shows') + ' as zero.</p>' : '';
    return '<section class="block block-void" id="voided"><h2>Voided fund sources</h2><p class="muted">Each voided fund source is excluded in every office. The amounts are deducted from the totals above.</p>' + stale +
      voidedFundTable('overall', m.voids, m.voidTotals, true) + '</section>';
  }

  // ---------- Summary report (one basis)
  function summaryReport(m, opts, basis) {
    var t = m.totals;
    var html = '<article class="sheet" id="report">' + header(m, opts, 'Summary report: ' + label(BASES, basis));
    // 1. Available fund per office, before voided
    var rows = '';
    m.offices.forEach(function (o) {
      rows += '<tr><th scope="row"><span class="oname">' + esc(o.name) + '</span><span class="acode">' + esc(o.code) + '</span></th>' + cells(basis, o.gross) + '</tr>';
    });
    html += '<section class="block" id="gross"><h2>Available fund per office</h2><p class="muted">Before the voided fund sources are removed.</p>' +
      '<div class="tbl-scroll"><table class="tbl tbl-offices"><thead><tr>' + head(basis, 'Office') + '</tr></thead><tbody>' + rows + '</tbody>' +
      '<tfoot><tr class="foot-net"><th scope="row">Total before voided fund sources</th>' + pesoCells(basis, t.gross, 'grand-cell') + '</tr></tfoot></table></div></section>';
    // 2. Voided accounts
    html += '<section class="block block-void" id="voided"><h2>Voided fund sources</h2>' + (m.voids.length
      ? '<p class="muted">Each voided fund source is excluded in every office. The amounts are deducted below.</p>' + voidedFundTable(basis, m.voids, m.voidTotals, true)
      : '<p class="muted">No fund sources have been voided.</p>') + '</section>';
    // 3. Net available
    html += netBox('Net available fund for CNA', t.gross, t.voided, t.net, basis, basis === 'approp' ? m.requirement.optionA : m.requirement.optionB, m.requirement.required, m.pgso);
    // 4. Funding requirement
    html += requirementBlock(m, basis);
    return html + footer(m) + '</article>';
  }

  // ---------- Per office report
  function hasBal(a) { return Number(a.approp) || Number(a.allot); }
  // Same layout as the per fund source report: net amounts first, voided fund sources in red at the right.
  function officeTable(o, basis, m) {
    var zero = { approp: 0, allot: 0, overall: 0 };
    var vkey = basis === 'approp' ? 'approp' : 'overall';
    var body = '';
    o.accounts.filter(hasBal).forEach(function (a) {
      body += '<tr><th scope="row"><span class="acode">' + esc(a.code) + '</span>' + esc(a.account) + '</th>' + cells(basis, a.voided ? zero : a) + '<td>' + red(a.voided ? a[vkey] : 0) + '</td></tr>';
    });
    var h = '<thead><tr>' + head(basis, 'Fund source') + '<th scope="col" class="num void-head">Voided<small>deducted</small></th></tr></thead>';
    // PGSO still holds transactions not yet transferred to the budget office: the adjusted line follows the net available fund.
    var d = m && m.pgso && m.pgso.byOffice[o.code], adj = '';
    if (d) {
      var r2 = function (x) { return Math.round(x * 100) / 100; };
      var a2 = { approp: r2(o.net.approp + d.approp), allot: r2(o.net.allot + d.allot), overall: r2(o.net.overall + d.overall) };
      adj = '<tr class="foot-adj"><th scope="row">Net available fund of ' + esc(o.name) + ', adjusted for PGSO<small>PGSO balance less budget office balance: ' + signedText(d[vkey]) + '</small></th>' + pesoCells(basis, a2, 'grand-cell') + '<td></td></tr>';
    }
    // ... and the PGSO adjusted balance of each fund source PGSO holds in this office (for example fuel and oil).
    var lines = '';
    if (m && m.pgso) m.pgso.rows.forEach(function (r) {
      if (r.officeCode !== o.code) return;
      lines += '<tr class="foot-pgso"><th scope="row">' + esc(r.account) + ', adjusted per PGSO<small>Budget office balance ' + peso(r.bo[vkey]) + '; PGSO less budget office: ' + signedText(r.diff[vkey]) + '</small></th>' + pesoCells(basis, r.pgso, '') + '<td></td></tr>';
    });
    var foot = '<tfoot><tr class="foot-net"><th scope="row">Net available fund of ' + esc(o.name) + '</th>' + pesoCells(basis, o.net, 'grand-cell') + '<td class="void">' + (o.voided[vkey] ? '(' + peso(o.voided[vkey]) + ')' : '<span class="nil">–</span>') + '</td></tr>' + adj + lines +
      '<tr class="foot-gross"><th scope="row">Total per e-budget, before voided</th>' + pesoCells(basis, o.gross, '') + '<td></td></tr></tfoot>';
    return '<div class="tbl-scroll"><table class="tbl tbl-accounts tbl-ofc">' + h + '<tbody>' + body + '</tbody>' + foot + '</table></div>';
  }
  function officeBlock(m, o, basis) {
    return '<section class="ofc"><h3><span class="oname">' + esc(o.name) + '</span><span class="acode">' + esc(o.code) + '</span></h3>' + officeTable(o, basis, m) + '</section>';
  }
  function officesReport(m, opts, basis, officeCode) {
    var all = officeCode === 'all';
    var one = null;
    if (!all) for (var i = 0; i < m.offices.length; i++) if (m.offices[i].code === officeCode) one = m.offices[i];
    if (!all && !one) return '';
    var html = '<article class="sheet" id="report">' + header(m, opts, 'Per office report: ' + (all ? 'All offices' : one.name) + ', ' + label(BASES, basis));
    if (!all) {
      html += '<section class="block" id="gross"><h2>Fund sources of ' + esc(one.name) + '</h2><p class="muted">Voided fund sources are shown at the right and are not counted in the net available fund. Fund sources with no balance in this office are not listed.</p>' +
        officeTable(one, basis, m) + '</section>';
      return html + footer(m) + '</article>';
    }
    html += '<p class="muted">Voided fund sources are shown at the right of each table and are not counted in the net available fund. Fund sources with no balance in an office are not listed under that office.</p>';
    m.offices.forEach(function (o) { html += officeBlock(m, o, basis); });
    var t = m.totals;
    html += netBox('All offices: net available fund for CNA', t.gross, t.voided, t.net, basis, basis === 'approp' ? m.requirement.optionA : m.requirement.optionB, m.requirement.required, m.pgso);
    html += '<section class="block block-void" id="voided"><h2>Voided fund sources</h2>' + (m.voids.length
      ? '<p class="muted">Each voided fund source is excluded in every office.</p>' + voidedFundTable(basis, m.voids, m.voidTotals, true)
      : '<p class="muted">No fund sources have been voided.</p>') + '</section>';
    html += requirementBlock(m, basis);
    return html + footer(m) + '</article>';
  }

  // ---------- Per fund source report and Voided funds report
  function sourcesReport(m, opts) {
    var t = m.totals;
    var body = '<tbody>';
    m.accounts.forEach(function (a) {
      body += '<tr><th scope="row"><span class="acode">' + esc(a.code) + '</span>' + esc(a.account) + '</th>' +
        '<td>' + cell(a.net.approp) + '</td><td class="emph-cell">' + cell(a.net.allot) + '</td><td class="overall-cell">' + cell(a.net.overall) + '</td><td>' + red(a.voided.overall) + '</td></tr>';
    });
    body += '</tbody>';
    var pg = m.pgso;
    var PGSO_ADJ = pg ? '<tr class="foot-adj"><th scope="row">Net available fund, adjusted for PGSO<small>PGSO balance less budget office balance: ' + signedText(pg.totals.diff.overall) + '</small></th><td>' + peso(pg.adjusted.net.approp) + '</td><td class="emph-cell">' + peso(pg.adjusted.net.allot) + '</td><td class="grand-cell">' + peso(pg.adjusted.net.overall) + '</td><td></td></tr>' : '';
    var foot = '<tfoot><tr class="foot-net"><th scope="row">Net available fund</th><td>' + peso(t.net.approp) + '</td><td class="emph-cell">' + peso(t.net.allot) + '</td><td class="grand-cell">' + peso(t.net.overall) + '</td><td class="void">' + (t.voided.overall ? '(' + peso(t.voided.overall) + ')' : '<span class="nil">–</span>') + '</td></tr>' +
      PGSO_ADJ +
      '<tr class="foot-need"><th scope="row">Less: amount to be funded</th><td>(' + peso(m.requirement.required) + ')</td><td></td><td>(' + peso(m.requirement.required) + ')</td><td></td></tr>' +
      '<tr class="foot-excess"><th scope="row">Excess / (Deficit)' + (pg ? ', per budget office' : '') + '</th>' + excessCell(m.requirement.optionA) + '<td></td>' + excessCell(m.requirement.optionB) + '<td></td></tr>' +
      (pg ? '<tr class="foot-excess foot-excess-adj"><th scope="row">Excess / (Deficit), adjusted for PGSO</th>' + excessCell(pg.adjusted.requirement.optionA) + '<td></td>' + excessCell(pg.adjusted.requirement.optionB) + '<td></td></tr>' : '') +
      '<tr class="foot-gross"><th scope="row">Total per e-budget, before voided</th><td>' + peso(t.gross.approp) + '</td><td>' + peso(t.gross.allot) + '</td><td>' + peso(t.gross.overall) + '</td><td></td></tr></tfoot>';
    var h = '<thead><tr><th scope="col">Fund source</th><th scope="col" class="num">Appropriation balance<small>20% retention</small></th><th scope="col" class="num emph-head">Allotment balance</th><th scope="col" class="num">Overall available<small>appropriation + allotment</small></th><th scope="col" class="num void-head">Voided<small>deducted</small></th></tr></thead>';
    return '<article class="sheet" id="report">' + header(m, opts, 'Per fund source report') +
      '<section class="block" id="sources"><h2>Available fund per fund source</h2><p class="muted">Whole province, net of voided fund sources.</p>' +
      '<div class="tbl-scroll"><table class="tbl tbl-accounts">' + h + body + foot + '</table></div></section>' + excessTable(m) + footer(m) + '</article>';
  }
  // Excess or deficit, worked out for both bases: the 20% appropriation balance and the overall available balance.
  function excessTable(m) {
    var rq = m.requirement;
    function row(lbl, c) {
      var short = !c.ok;
      return '<tr><th scope="row">' + lbl + '</th><td>' + peso(c.available) + '</td><td>(' + peso(rq.required) + ')</td>' +
        '<td class="' + (short ? 'void' : 'good') + '"><strong>' + (short ? '(' + peso(Math.abs(c.difference)) + ')' : peso(c.difference)) + '</strong></td>' +
        '<td><span class="badge ' + (short ? 'badge-short' : 'badge-ok') + '">' + (short ? 'Deficit' : 'Excess') + '</span></td></tr>';
    }
    return '<section class="block" id="excess"><h2>Excess or deficit</h2><p class="muted">The net available fund compared with the amount to be funded: ' +
      esc(Number(rq.employees).toLocaleString('en-PH')) + ' employees × ' + peso(rq.amountPerEmployee) + ' = ' + peso(rq.required) + '.</p>' +
      '<div class="tbl-scroll"><table class="tbl tbl-excess"><thead><tr><th scope="col">Based on</th><th scope="col" class="num">Net available fund</th><th scope="col" class="num">Amount to be funded</th><th scope="col" class="num">Excess / (Deficit)</th><th scope="col">Result</th></tr></thead><tbody>' +
      row('Appropriation balance<small>20% retention</small>', rq.optionA) + row('Overall available balance<small>appropriation + allotment</small>', rq.optionB) +
      (m.pgso ? row('Appropriation balance, adjusted for PGSO<small>20% retention</small>', m.pgso.adjusted.requirement.optionA) + row('Overall available balance, adjusted for PGSO<small>appropriation + allotment</small>', m.pgso.adjusted.requirement.optionB) : '') +
      '</tbody></table></div></section>';
  }
  function excessCell(c) {
    return '<td class="' + (c.ok ? 'good' : 'void') + '"><strong>' + (c.ok ? peso(c.difference) : '(' + peso(Math.abs(c.difference)) + ')') + '</strong><small>' + (c.ok ? 'excess' : 'deficit') + '</small></td>';
  }
  function voidedReport(m, opts) {
    var html = '<article class="sheet" id="report">' + header(m, opts, 'Voided funds report');
    if (!m.voids.length) {
      html += '<section class="block" id="voided"><h2>Voided fund sources</h2><p class="muted">No fund sources have been voided.</p></section>';
      return html + footer(m) + '</article>';
    }
    var per = '<div class="tbl-scroll"><table class="tbl tbl-void"><thead><tr><th scope="col">Office</th><th scope="col" class="num">Fund sources voided</th><th scope="col" class="num">Appropriation balance</th><th scope="col" class="num">Allotment balance</th><th scope="col" class="num">Total voided</th></tr></thead><tbody>';
    m.voidByOffice.forEach(function (e) {
      per += '<tr><th scope="row">' + esc(e.name) + '</th><td class="cnt">' + e.count + '</td><td>' + peso(e.approp) + '</td><td>' + peso(e.allot) + '</td><td>' + peso(e.overall) + '</td></tr>';
    });
    per += '</tbody><tfoot><tr><th scope="row" colspan="2">Total voided</th><td>' + peso(m.voidTotals.approp) + '</td><td>' + peso(m.voidTotals.allot) + '</td><td>' + peso(m.voidTotals.overall) + '</td></tr></tfoot></table></div>';
    var stale = m.staleVoids ? '<p class="notice">' + m.staleVoids + (m.staleVoids > 1 ? ' voided fund sources do' : ' voided fund source does') + ' not appear in this e-budget report, so ' + (m.staleVoids > 1 ? 'their amounts show' : 'its amount shows') + ' as zero.</p>' : '';
    html += '<section class="block block-void" id="voided"><h2>Voided fund sources</h2><p class="muted">Each voided fund source is excluded in every office. The amounts are deducted from the available fund.</p>' + stale +
      '<h3>Summary</h3>' + voidedFundTable('overall', m.voids, m.voidTotals, true) + '<h3>Voided amount per office</h3>' + per + '</section>';
    return html + footer(m) + '</article>';
  }

  // ---------- which report does a selection call for?
  function needs(state) {
    var r = state.report;
    if (!r) return 'Choose a report.';
    if ((r === 'summary' || r === 'offices') && !state.basis) return 'Choose the fund: appropriation balance (20%) or overall available.';
    if (r === 'offices' && !state.office) return 'Choose an office, or all offices.';
    return '';
  }
  function renderReport(m, state, opts) {
    if (needs(state)) return '';
    if (state.report === 'summary') return summaryReport(m, opts, state.basis);
    if (state.report === 'offices') return officesReport(m, opts, state.basis, state.office);
    if (state.report === 'sources') return sourcesReport(m, opts);
    if (state.report === 'voided') return voidedReport(m, opts);
    if (state.report === 'fuel') return fuelReport(m, opts);
    return '';
  }

  // ---------- the page: dashboard, or the report chooser with the chosen report
  function mount(el, model, o) {
    o = o || {};
    var st = { report: (o.state && o.state.report) || '', basis: (o.state && o.state.basis) || '', office: (o.state && o.state.office) || '' };
    var view = o.view === 'reports' ? 'reports' : 'dashboard';
    var offices = model.offices;
    if (st.office && st.office !== 'all' && !offices.some(function (x) { return x.code === st.office; })) st.office = '';

    function opt(v, l, cur) { return '<option value="' + esc(v) + '"' + (cur === v ? ' selected' : '') + '>' + esc(l) + '</option>'; }
    // ----- office search box (type to filter; tap the arrow or the box to see every office)
    var ALL_LABEL = 'All offices (all account details)';
    function officeLabel(code) {
      if (code === 'all') return ALL_LABEL;
      for (var i = 0; i < offices.length; i++) if (offices[i].code === code) return offices[i].name;
      return '';
    }
    function officeChoices(q) {
      var words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
      var all = [{ code: 'all', name: ALL_LABEL }].concat(offices.map(function (x) { return { code: x.code, name: x.name }; }));
      if (!words.length) return all;
      return all.filter(function (c) {
        var n = c.name.toLowerCase();
        return words.every(function (w) { return n.indexOf(w) !== -1; });
      });
    }
    var combo = { active: -1, items: [] };
    function comboEls() {
      return { input: el.querySelector('#pk-office'), list: el.querySelector('#pk-office-list') };
    }
    function comboClose() {
      var c = comboEls(); if (!c.input) return;
      c.list.hidden = true; c.input.setAttribute('aria-expanded', 'false'); c.input.removeAttribute('aria-activedescendant'); combo.active = -1;
    }
    function comboShow(query) {
      var c = comboEls(); if (!c.input) return;
      combo.items = officeChoices(query);
      combo.active = combo.items.length && query ? 0 : -1;
      c.list.innerHTML = combo.items.length ? combo.items.map(function (x, i) {
        return '<li role="option" id="pk-office-o' + i + '" data-pick="' + i + '"' + (x.code === st.office ? ' aria-selected="true"' : '') + (i === combo.active ? ' class="on"' : '') + '>' + esc(x.name) + '</li>';
      }).join('') : '<li class="none" role="presentation">No office matches what you typed.</li>';
      c.list.hidden = false; c.input.setAttribute('aria-expanded', 'true');
      comboMark();
    }
    function comboMark() {
      var c = comboEls(); if (!c.input) return;
      var nodes = c.list.querySelectorAll('[data-pick]');
      for (var i = 0; i < nodes.length; i++) nodes[i].className = (i === combo.active) ? 'on' : '';
      if (combo.active >= 0 && nodes[combo.active]) {
        c.input.setAttribute('aria-activedescendant', nodes[combo.active].id);
        if (nodes[combo.active].scrollIntoView) nodes[combo.active].scrollIntoView({ block: 'nearest' });
      } else c.input.removeAttribute('aria-activedescendant');
    }
    function comboPick(i) {
      var x = combo.items[i]; if (!x) return;
      st.office = x.code;
      comboClose();
      if (o.onState) o.onState(view, st);
      draw();
    }

    function picker() {
      var h = '<div class="picker no-print"><div class="field"><label for="pk-report">Report</label><select id="pk-report" data-sel="report"><option value="">Choose a report</option>' +
        REPORTS.map(function (r) { return opt(r.key, r.label, st.report); }).join('') + '</select></div>';
      if (st.report === 'summary' || st.report === 'offices') {
        h += '<div class="field"><label for="pk-basis">Fund</label><select id="pk-basis" data-sel="basis"><option value="">Choose the fund</option>' +
          BASES.map(function (b) { return opt(b.key, b.label, st.basis); }).join('') + '</select></div>';
      }
      if (st.report === 'offices') {
        h += '<div class="field"><label for="pk-office">Office</label><div class="combo">' +
          '<input id="pk-office" class="combo-input" type="text" role="combobox" aria-expanded="false" aria-controls="pk-office-list" aria-autocomplete="list" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Type to search, or tap to choose" value="' + esc(officeLabel(st.office)) + '">' +
          '<button type="button" class="combo-btn" data-combo="toggle" tabindex="-1" aria-label="Show all offices">&#9662;</button>' +
          '<ul id="pk-office-list" class="combo-list" role="listbox" hidden></ul></div></div>';
      }
      return h + '</div>';
    }
    function toolbar(ready) {
      var href = ready && o.excelHref ? o.excelHref(view, st) : '';
      return '<div class="acts no-print"><button class="btn small alt" type="button" data-act="print"' + (ready ? '' : ' disabled') + '>Print this report</button>' +
        (o.excelHref ? (href ? '<a class="btn small" href="' + esc(href) + '" download>Download Excel</a>' : '<button class="btn small" type="button" disabled>Download Excel</button>') : '') + '</div>';
    }
    function draw(focusSel) {
      var html = '';
      if (o.showViewSwitch) {
        html += '<nav class="tabs no-print" aria-label="View">' +
          '<button type="button" data-view="dashboard"' + (view === 'dashboard' ? ' aria-current="page"' : '') + '>Dashboard</button>' +
          '<button type="button" data-view="reports"' + (view === 'reports' ? ' aria-current="page"' : '') + '>Reports</button></nav>';
      }
      if (view === 'dashboard') {
        html += '<div class="subbar no-print"><span class="subbar-title">Available fund</span>' + toolbar(true) + '</div>' + dashboard(model, o);
      } else {
        var why = needs(st);
        html += '<div class="subbar subbar-picker no-print">' + picker() + toolbar(!why) + '</div>';
        html += why ? '<div class="pane empty no-print"><h2>No report selected</h2><p>' + esc(why) + '</p></div>' : renderReport(model, st, o);
      }
      el.innerHTML = html;
      if (focusSel) { var f = el.querySelector('[data-sel="' + focusSel + '"]'); if (f) f.focus(); }
    }
    if (!el.__cnaBound) {
      el.__cnaBound = true;
      el.addEventListener('change', function (e) {
        var s = e.target.getAttribute && e.target.getAttribute('data-sel');
        if (!s) return;
        st[s] = e.target.value;
        if (s === 'report') { st.basis = (st.report === 'summary' || st.report === 'offices') ? st.basis : ''; if (st.report !== 'offices') st.office = ''; }
        if (o.onState) o.onState(view, st);
        draw(s);
      });
      el.addEventListener('input', function (e) {
        if (e.target.id === 'pk-office') comboShow(e.target.value);
      });
      el.addEventListener('focusin', function (e) {
        if (e.target.id === 'pk-office') { try { e.target.select(); } catch (x) {} comboShow(''); }
      });
      el.addEventListener('focusout', function (e) {
        if (e.target.id !== 'pk-office') return;
        var inp = e.target;
        setTimeout(function () {
          if (document.activeElement === inp) return;
          comboClose();
          if (inp.value !== officeLabel(st.office)) inp.value = officeLabel(st.office); // typed text that was never chosen is dropped
        }, 120);
      });
      el.addEventListener('keydown', function (e) {
        if (e.target.id !== 'pk-office') return;
        var c = comboEls(), open = !c.list.hidden, k = e.key;
        if (k === 'ArrowDown' || k === 'ArrowUp') {
          e.preventDefault();
          if (!open) { comboShow(''); return; }
          if (!combo.items.length) return;
          combo.active = (combo.active + (k === 'ArrowDown' ? 1 : -1) + combo.items.length) % combo.items.length;
          comboMark();
        } else if (k === 'Enter') {
          if (!open) return;
          e.preventDefault();
          if (combo.active < 0 && combo.items.length === 1) combo.active = 0;
          if (combo.active >= 0) comboPick(combo.active);
        } else if (k === 'Escape') {
          if (open) { e.preventDefault(); comboClose(); e.target.value = officeLabel(st.office); }
        }
      });
      // keep focus in the box while an office is picked with the mouse or a finger
      el.addEventListener('mousedown', function (e) {
        if (e.target.closest && e.target.closest('.combo-list, .combo-btn')) e.preventDefault();
      });
      el.addEventListener('click', function (e) {
        var li = e.target.closest ? e.target.closest('[data-pick]') : null;
        if (li) { comboPick(parseInt(li.getAttribute('data-pick'), 10)); return; }
        var tg = e.target.closest ? e.target.closest('[data-combo]') : null;
        if (tg) {
          var c = comboEls();
          if (c.list.hidden) { c.input.focus(); comboShow(''); } else comboClose();
          return;
        }
        var b = e.target.closest ? e.target.closest('[data-act],[data-view]') : null;
        if (!b) return;
        if (b.getAttribute('data-act') === 'print' && !b.disabled) window.print();
        var v = b.getAttribute('data-view');
        if (v && v !== view) { view = v; if (o.onState) o.onState(view, st); draw(); }
      });
    }
    draw();
  }

  root.CNAReport = { mount: mount, fmt: fmt, peso: peso, longDate: longDate, stamp: stamp, esc: esc, BASES: BASES, REPORTS: REPORTS };
})(typeof window !== 'undefined' ? window : this);
