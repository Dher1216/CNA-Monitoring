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
    { key: 'voided', label: 'Voided funds report' }
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
      '<span>Needs ' + peso(required) + (short ? ', short by ' : ', surplus ') + peso(Math.abs(c.difference)) + '</span></div>';
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
      '<div class="' + (short ? 'void' : 'good') + '"><dt>' + (short ? 'Shortfall' : 'Surplus') + '</dt><dd>' + peso(Math.abs(c.difference)) + '</dd></div>' +
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

  function netBox(title, gross, voided, net, basis) {
    var g = amount(basis, gross), v = amount(basis, voided), n = amount(basis, net);
    return '<section class="block" id="net"><h2>' + esc(title) + '</h2><div class="netbox"><dl>' +
      '<div><dt>Total before voided fund sources</dt><dd>' + peso(g) + '</dd></div>' +
      '<div class="void"><dt>Less: voided fund sources</dt><dd>' + (v ? '(' + peso(v) + ')' : peso(0)) + '</dd></div>' +
      (basis === 'overall' ? '<div><dt>Net appropriation balance</dt><dd>' + peso(net.approp) + '</dd></div><div class="emph"><dt>Net allotment balance</dt><dd>' + peso(net.allot) + '</dd></div>' : '') +
      '<div class="net"><dt>Net available fund for CNA</dt><dd>' + peso(n) + '</dd></div></dl></div></section>';
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
    html += netBox('Net available fund for CNA', t.gross, t.voided, t.net, basis);
    // 4. Funding requirement
    html += requirementBlock(m, basis);
    return html + footer(m) + '</article>';
  }

  // ---------- Per office report
  function hasBal(a) { return Number(a.approp) || Number(a.allot); }
  function officeBlock(m, o, basis) {
    var body = '';
    o.accounts.filter(hasBal).forEach(function (a) {
      body += '<tr><th scope="row"><span class="acode">' + esc(a.code) + '</span>' + esc(a.account) + '</th>' + cells(basis, a) + '</tr>';
    });
    var vrows = o.accounts.filter(function (a) { return a.voided && (a.approp || a.allot); });
    var vbody = '';
    vrows.forEach(function (a) {
      vbody += '<tr class="is-voided"><th scope="row">Less: ' + esc(a.account) + '</th>' + redCells(basis, a) + '</tr>';
    });
    return '<section class="ofc"><h3><span class="oname">' + esc(o.name) + '</span><span class="acode">' + esc(o.code) + '</span></h3>' +
      '<div class="tbl-scroll"><table class="tbl tbl-ofc"><thead><tr>' + head(basis, 'Fund source') + '</tr></thead><tbody>' + body +
      '<tr class="sub-gross"><th scope="row">Total before voided fund sources</th>' + pesoCells(basis, o.gross, '') + '</tr>' + vbody + '</tbody>' +
      '<tfoot><tr class="foot-net"><th scope="row">Net available fund of ' + esc(o.name) + '</th>' + pesoCells(basis, o.net, 'grand-cell') + '</tr></tfoot></table></div></section>';
  }
  function officesReport(m, opts, basis, officeCode) {
    var all = officeCode === 'all';
    var one = null;
    if (!all) for (var i = 0; i < m.offices.length; i++) if (m.offices[i].code === officeCode) one = m.offices[i];
    if (!all && !one) return '';
    var html = '<article class="sheet" id="report">' + header(m, opts, 'Per office report: ' + (all ? 'All offices' : one.name) + ', ' + label(BASES, basis));
    if (!all) {
      var o = one;
      var body = '';
      o.accounts.filter(hasBal).forEach(function (a) {
        body += '<tr><th scope="row"><span class="acode">' + esc(a.code) + '</span>' + esc(a.account) + '</th>' + cells(basis, a) + '</tr>';
      });
      html += '<section class="block" id="gross"><h2>Fund sources of ' + esc(o.name) + '</h2><p class="muted">Before the voided fund sources are removed. Fund sources with no balance in this office are not listed.</p>' +
        '<div class="tbl-scroll"><table class="tbl tbl-ofc"><thead><tr>' + head(basis, 'Fund source') + '</tr></thead><tbody>' + body + '</tbody>' +
        '<tfoot><tr class="foot-net"><th scope="row">Total before voided fund sources</th>' + pesoCells(basis, o.gross, 'grand-cell') + '</tr></tfoot></table></div></section>';
      var vrows = o.accounts.filter(function (a) { return a.voided && (a.approp || a.allot); }).map(function (a) {
        var r = remarkFor(m, a.account);
        return { code: a.code, account: a.account, approp: a.approp, allot: a.allot, overall: a.overall, officeRemark: r.officeRemark, reason: r.reason, dateVoided: r.dateVoided };
      });
      html += '<section class="block block-void" id="voided"><h2>Voided fund sources</h2>' + (vrows.length
        ? '<p class="muted">Voided in every office. These are the amounts in ' + esc(o.name) + '.</p>' + voidedFundTable(basis, vrows, o.voided, true)
        : '<p class="muted">No voided fund sources in ' + esc(o.name) + '.</p>') + '</section>';
      html += netBox('Net available fund of ' + o.name, o.gross, o.voided, o.net, basis);
      return html + footer(m) + '</article>';
    }
    html += '<p class="muted">Fund sources with no balance in an office are not listed under that office.</p>';
    m.offices.forEach(function (o) { html += officeBlock(m, o, basis); });
    var t = m.totals;
    html += netBox('All offices: net available fund for CNA', t.gross, t.voided, t.net, basis);
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
    var foot = '<tfoot><tr class="foot-net"><th scope="row">Net available fund</th><td>' + peso(t.net.approp) + '</td><td class="emph-cell">' + peso(t.net.allot) + '</td><td class="grand-cell">' + peso(t.net.overall) + '</td><td class="void">' + (t.voided.overall ? '(' + peso(t.voided.overall) + ')' : '<span class="nil">–</span>') + '</td></tr>' +
      '<tr class="foot-gross"><th scope="row">Total per e-budget, before voided</th><td>' + peso(t.gross.approp) + '</td><td>' + peso(t.gross.allot) + '</td><td>' + peso(t.gross.overall) + '</td><td></td></tr></tfoot>';
    var h = '<thead><tr><th scope="col">Fund source</th><th scope="col" class="num">Appropriation balance<small>20% retention</small></th><th scope="col" class="num emph-head">Allotment balance</th><th scope="col" class="num">Overall available<small>appropriation + allotment</small></th><th scope="col" class="num void-head">Voided<small>deducted</small></th></tr></thead>';
    return '<article class="sheet" id="report">' + header(m, opts, 'Per fund source report') +
      '<section class="block" id="sources"><h2>Available fund per fund source</h2><p class="muted">Whole province, net of voided fund sources.</p>' +
      '<div class="tbl-scroll"><table class="tbl tbl-accounts">' + h + body + foot + '</table></div></section>' + footer(m) + '</article>';
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
    function picker() {
      var h = '<div class="picker no-print"><div class="field"><label for="pk-report">Report</label><select id="pk-report" data-sel="report"><option value="">Choose a report</option>' +
        REPORTS.map(function (r) { return opt(r.key, r.label, st.report); }).join('') + '</select></div>';
      if (st.report === 'summary' || st.report === 'offices') {
        h += '<div class="field"><label for="pk-basis">Fund</label><select id="pk-basis" data-sel="basis"><option value="">Choose the fund</option>' +
          BASES.map(function (b) { return opt(b.key, b.label, st.basis); }).join('') + '</select></div>';
      }
      if (st.report === 'offices') {
        h += '<div class="field"><label for="pk-office">Office</label><select id="pk-office" data-sel="office"><option value="">Choose an office</option>' + opt('all', 'All offices (all account details)', st.office) +
          offices.map(function (x) { return opt(x.code, x.name, st.office); }).join('') + '</select></div>';
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
      el.addEventListener('click', function (e) {
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
