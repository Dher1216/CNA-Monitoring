(function () {
  'use strict';
  var R = window.CNAReport, esc = R.esc, peso = R.peso;
  var app = document.getElementById('app');
  var me = null;
  var CACHE_KEY = 'cna:last-report';

  // ---------- helpers
  function $(sel, root) { return (root || document).querySelector(sel); }
  function api(path, opts) {
    opts = opts || {};
    var headers = { 'X-Requested-With': 'cna-app' };
    var init = { method: opts.method || 'GET', credentials: 'same-origin', headers: headers };
    if (opts.json !== undefined) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.json); }
    if (opts.raw) { headers['Content-Type'] = 'application/octet-stream'; headers['X-Filename'] = encodeURIComponent(opts.filename || 'upload.xlsx'); init.body = opts.raw; }
    return fetch(path, init).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.status === 401 && path !== '/api/login') { me = null; showLogin('Your session ended. Sign in again.'); throw new Error('signed-out'); }
        if (!res.ok) { var e = new Error(data.error || 'Something went wrong.'); e.handled = true; throw e; }
        return data;
      });
    });
  }
  function toast(msg) {
    var t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
    document.body.appendChild(t); setTimeout(function () { t.remove(); }, 3800);
  }
  function msg(kind, text) { return '<p class="msg ' + kind + '" role="' + (kind === 'err' ? 'alert' : 'status') + '">' + esc(text) + '</p>'; }
  function errText(e) { return e && e.handled ? e.message : (e && e.message === 'signed-out' ? '' : 'The server could not be reached. Check that the server computer is on, then try again.'); }
  function askDialog(opts) {
    return new Promise(function (resolve) {
      var d = document.createElement('dialog');
      d.style.cssText = 'border:1px solid #b9aed6;border-top:4px solid #4b2a8a;border-radius:4px;padding:22px;max-width:440px;width:92vw';
      d.innerHTML = '<form method="dialog"><h2 style="font-size:1.2rem;margin-bottom:6px">' + esc(opts.title) + '</h2>' +
        '<p class="muted" style="margin:0 0 12px;font-size:.92rem">' + esc(opts.text || '') + '</p>' +
        (opts.field ? '<div class="field"><label for="dlg-f">' + esc(opts.field) + '</label>' + (opts.password ? '<input id="dlg-f" type="password" autocomplete="new-password" minlength="8">' : '<textarea id="dlg-f" maxlength="300"></textarea>') + '</div>' : '') +
        '<p class="msg err" id="dlg-e" hidden></p>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn alt" value="cancel" type="button" id="dlg-c">Cancel</button><button class="btn' + (opts.danger ? ' danger' : '') + '" id="dlg-ok" type="submit">' + esc(opts.ok || 'Confirm') + '</button></div></form>';
      document.body.appendChild(d); d.showModal();
      var f = $('#dlg-f', d); if (f) f.focus();
      function close(v) { d.close(); d.remove(); resolve(v); }
      $('#dlg-c', d).onclick = function () { close(null); };
      d.addEventListener('cancel', function (e) { e.preventDefault(); close(null); });
      $('form', d).onsubmit = function (e) {
        e.preventDefault();
        var v = f ? f.value.trim() : true;
        if (opts.field && !v) { var er = $('#dlg-e', d); er.textContent = opts.required || 'This is required.'; er.hidden = false; return; }
        close(v);
      };
    });
  }

  // ---------- login
  function showLogin(note) {
    app.innerHTML = '<div class="login"><div class="login-side"><img src="/seal.png" alt="Official seal of the Province of Antique">' +
      '<h1>CNA Fund Monitor</h1><p>Province of Antique, Provincial Budget Office</p><p>Funds available for the Collective Negotiation Agreement incentive.</p></div>' +
      '<div class="login-form"><form id="lf" novalidate><h2>Sign in</h2><p class="lead">Use the account the Budget Office gave you.</p>' +
      (note ? msg('warn', note) : '') + '<div id="lerr"></div>' +
      '<div class="field"><label for="u">Username</label><input id="u" autocomplete="username" autocapitalize="off" required></div>' +
      '<div class="field"><label for="p">Password</label><input id="p" type="password" autocomplete="current-password" required></div>' +
      '<button class="btn" style="width:100%" type="submit">Sign in</button></form></div></div>';
    $('#u').focus();
    $('#lf').onsubmit = function (e) {
      e.preventDefault();
      var btn = $('#lf button'); btn.disabled = true;
      api('/api/login', { method: 'POST', json: { username: $('#u').value, password: $('#p').value } })
        .then(function (d) { me = d.user; route(); })
        .catch(function (err) { $('#lerr').innerHTML = msg('err', errText(err)); btn.disabled = false; $('#p').select(); });
    };
  }

  // ---------- shell
  function shell(active, inner) {
    var links = [['dashboard', 'Dashboard'], ['reports', 'Reports'], ['history', 'History']];
    if (me.role === 'admin') links.push(['data', 'Upload and figures'], ['voids', 'Voided funds'], ['users', 'People']);
    app.innerHTML = '<header class="topbar no-print"><div class="topbar-in">' +
      '<a class="brand" href="#/dashboard"><img src="/seal.png" alt=""><span><b>CNA Fund Monitor</b><span>Province of Antique, Provincial Budget Office</span></span></a>' +
      '<nav class="nav" aria-label="Main">' + links.map(function (l) { return '<a href="#/' + l[0] + '"' + (l[0] === active ? ' aria-current="page"' : '') + '>' + l[1] + '</a>'; }).join('') + '</nav>' +
      '<div class="who"><span>' + esc(me.name) + (me.role === 'admin' ? '' : ' (view only)') + '</span><a class="who-link" href="/api/offline.html" download title="A copy of the latest report that opens without the server">Saved copy</a><button type="button" id="pw">Change password</button><button type="button" id="out">Sign out</button></div>' +
      '</div></header><main class="main" id="main">' + inner + '</main>';
    $('#out').onclick = function () { api('/api/logout', { method: 'POST' }).then(function () { me = null; showLogin(); }); };
    $('#pw').onclick = function () { location.hash = '#/password'; };
  }

  // ---------- forced password change
  function viewPassword(forced) {
    var inner = '<h1 class="page-title">' + (forced ? 'Choose a new password' : 'Change password') + '</h1>' +
      '<p class="page-lead">' + (forced ? 'The password you were given is temporary. Choose your own to continue.' : 'Use at least 8 characters.') + '</p>' +
      '<div class="pane" style="max-width:520px"><div id="perr"></div><form id="pf">' +
      '<div class="field"><label for="cp">Current password</label><input id="cp" type="password" autocomplete="current-password" required></div>' +
      '<div class="field"><label for="np">New password</label><input id="np" type="password" autocomplete="new-password" minlength="8" required><span class="hint">At least 8 characters.</span></div>' +
      '<div class="field"><label for="np2">Type the new password again</label><input id="np2" type="password" autocomplete="new-password" required></div>' +
      '<button class="btn" type="submit">Save new password</button></form></div>';
    if (forced) {
      app.innerHTML = '<main class="main" style="max-width:640px;padding-top:48px">' + inner + '</main>';
    } else shell('', inner);
    $('#pf').onsubmit = function (e) {
      e.preventDefault();
      if ($('#np').value !== $('#np2').value) { $('#perr').innerHTML = msg('err', 'The two new passwords do not match.'); return; }
      api('/api/password', { method: 'POST', json: { current: $('#cp').value, newPassword: $('#np').value } })
        .then(function (d) { me = d.user; toast('Password saved.'); location.hash = '#/dashboard'; route(); })
        .catch(function (err) { $('#perr').innerHTML = msg('err', errText(err)); });
    };
  }

  // ---------- dashboard and reports
  function hashQuery() {
    var q = {}, h = location.hash || '', i = h.indexOf('?');
    if (i >= 0) h.slice(i + 1).split('&').forEach(function (kv) { var p = kv.split('='); if (p[0]) q[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ''); });
    return q;
  }
  function viewReport(view, q) {
    shell(view, '<p class="muted">Loading the report</p>');
    var revId = q.rev || '';
    api('/api/report' + (revId ? '?rev=' + encodeURIComponent(revId) : ''))
      .then(function (d) {
        if (d.empty) return renderEmpty();
        if (d.isCurrent) { try { localStorage.setItem(CACHE_KEY, JSON.stringify({ model: d.model, savedAt: new Date().toISOString() })); } catch (e) { /* storage unavailable */ } }
        renderReport(d.model, { isCurrent: d.isCurrent, revId: revId, view: view, q: q });
      })
      .catch(function (err) {
        if (err.message === 'signed-out') return;
        if (!err.handled) {
          var cached = null; try { cached = JSON.parse(localStorage.getItem(CACHE_KEY)); } catch (e) { /* none */ }
          if (cached && cached.model) return renderReport(cached.model, { isCurrent: true, cachedAt: cached.savedAt, view: view, q: q });
        }
        $('#main').innerHTML = msg('err', errText(err));
      });
  }
  function renderEmpty() {
    $('#main').innerHTML = '<div class="pane empty"><h2>No report yet</h2>' +
      (me.role === 'admin'
        ? '<p>Upload the compiled Excel file with the CNA fund sources and the e-budget report to see the available fund.</p><p><a class="btn" href="#/data">Upload the e-budget report</a></p>'
        : '<p>The Budget Office has not published a report yet. Check again later.</p>') + '</div>';
  }
  function excelHref(o, view, st) {
    if (o.cachedAt) return '';
    var u = '/api/report.xlsx?report=' + (view === 'dashboard' ? 'dashboard' : encodeURIComponent(st.report));
    if (view === 'reports') {
      if (st.basis) u += '&basis=' + encodeURIComponent(st.basis);
      if (st.office) u += '&office=' + encodeURIComponent(st.office);
    }
    return u + (o.revId ? '&rev=' + encodeURIComponent(o.revId) : '');
  }
  function renderReport(model, o) {
    var view = o.view === 'reports' ? 'reports' : 'dashboard';
    var rv = o.revId ? '&rev=' + encodeURIComponent(o.revId) : '';
    var banner = '';
    if (o.cachedAt) banner = '<div class="offline-banner no-print"><strong>The server could not be reached.</strong> Showing the last report this browser received, saved ' + esc(R.stamp(o.cachedAt)) + '. The report date below is the date of that data.</div>';
    else if (!o.isCurrent) banner = '<div class="rev-banner no-print"><span><strong>Earlier version.</strong> Saved ' + esc(R.stamp(model.meta.revisionAt)) + ' by ' + esc(model.meta.revisionBy) + '.</span><a href="#/' + view + '">Show the latest report</a></div>';
    $('#main').innerHTML = banner + '<div id="rep"></div>';
    var q = o.q || {};
    R.mount($('#rep'), model, {
      view: view,
      state: { report: q.report || '', basis: q.basis || '', office: q.office || '' },
      excelHref: function (v, st) { return excelHref(o, v, st); },
      onState: function (v, st) {
        // keep the address in step with the selection without redrawing the page
        var h = '#/reports?';
        var parts = [];
        ['report', 'basis', 'office'].forEach(function (k) { if (st[k]) parts.push(k + '=' + encodeURIComponent(st[k])); });
        if (o.revId) parts.push('rev=' + encodeURIComponent(o.revId));
        try { history.replaceState(null, '', h + parts.join('&')); } catch (e) { /* ignore */ }
      }
    });
    document.title = (view === 'dashboard' ? 'Available fund' : 'Reports') + ' | Fund Sources of the CNA Incentive (' + model.meta.year + ')';
  }
  // ---------- history
  function viewHistory() {
    shell('history', '<h1 class="page-title">History</h1><p class="page-lead">Every upload and every change to the figures or voided fund sources is kept. Open any version to see the report as it was.</p><div id="hist"><p class="muted">Loading</p></div>');
    api('/api/revisions').then(function (d) {
      var uploadsOnly = false;
      function draw() {
        var rows = d.revisions.filter(function (r) { return !uploadsOnly || r.action === 'upload'; });
        $('#hist').innerHTML = '<div class="pane"><label style="display:flex;gap:8px;align-items:center;margin-bottom:12px"><input type="checkbox" id="uo"' + (uploadsOnly ? ' checked' : '') + '> Show e-budget uploads only</label>' +
          '<div class="tbl-scroll"><table class="tbl"><thead><tr><th>Saved</th><th>Report as of</th><th>What happened</th><th>By</th><th class="r">Overall available</th><th></th></tr></thead><tbody>' +
          rows.map(function (r) {
            return '<tr><td>' + esc(R.stamp(r.at)) + (r.current ? '<span class="cur-tag">Latest</span>' : '') + '</td><td>' + esc(R.longDate(r.asOf)) + '</td>' +
              '<td><span class="act-tag">' + esc(r.label) + '</span> <span class="muted">' + esc(r.note) + '</span></td><td>' + esc(r.by) + '</td>' +
              '<td class="r">' + (r.netOverall == null ? '' : peso(r.netOverall)) + '</td>' +
              '<td class="r"><a class="btn small alt" href="#/dashboard?rev=' + esc(r.id) + '">Open</a> ' + (me.role === 'admin' && !r.current ? '<button type="button" class="btn small alt" data-restore="' + esc(r.id) + '">Make latest</button>' : '') + '</td></tr>';
          }).join('') + '</tbody></table></div></div>';
        $('#uo').onchange = function () { uploadsOnly = this.checked; draw(); };
        Array.prototype.forEach.call(document.querySelectorAll('[data-restore]'), function (b) {
          b.onclick = function () {
            askDialog({ title: 'Make this version the latest?', text: 'The current version stays in the history. A new entry is added so the change is on record.', ok: 'Make latest' }).then(function (ok) {
              if (!ok) return;
              api('/api/revisions/' + b.getAttribute('data-restore') + '/restore', { method: 'POST', json: {} }).then(function () { toast('Version restored.'); location.hash = '#/dashboard'; }).catch(function (e) { toast(errText(e)); });
            });
          };
        });
      }
      draw();
    }).catch(function (e) { $('#hist').innerHTML = msg('err', errText(e)); });
  }

  // ---------- admin: upload and figures
  function viewData() {
    shell('data', '<h1 class="page-title">Upload and figures</h1><p class="page-lead">Upload the compiled Excel file whenever there is a new e-budget report. Set the year, the number of employees and the amount per employee for the CNA incentive.</p><div id="dat"><p class="muted">Loading</p></div>');
    Promise.all([api('/api/options'), api('/api/backups')]).then(function (res) {
      var o = res[0], b = res[1];
      var p = o.params || { year: new Date().getFullYear(), employees: 1245, amountPerEmployee: 30000 };
      $('#dat').innerHTML =
        '<div class="pane"><h2>Upload the e-budget report</h2><p class="muted">Upload the report exactly as the e-budget system exports it (.xls or .xlsx). The app keeps only the CNA fund sources and ignores other accounts. The list of CNA fund sources is remembered from one upload to the next; to change the list, upload a workbook that also has a sheet named <strong>CNA Fund Source</strong>. The new upload becomes the latest report and the old one stays in the history.</p>' +
        '<div id="uerr"></div><div class="drop" id="drop"><p>Drop the Excel file here, or</p><label class="btn alt" for="file" style="cursor:pointer">Choose file</label><input id="file" type="file" accept=".xls,.xlsx" hidden></div><div id="ures"></div></div>' +
        '<div class="pane"><h2>Figures for the incentive</h2><p class="muted">Change these when the year, the headcount or the amount changes. Each change is recorded in the history.</p>' +
        '<div id="ferr"></div><form id="ff"><div class="row">' +
        '<div class="field"><label for="fy">Year</label><input id="fy" type="number" min="2000" max="2100" step="1" value="' + esc(p.year) + '" required></div>' +
        '<div class="field"><label for="fe">Number of permanent employees</label><input id="fe" type="number" min="0" step="1" value="' + esc(p.employees) + '" required></div>' +
        '<div class="field"><label for="fa">Incentive per employee (₱)</label><input id="fa" type="number" min="0" step="0.01" value="' + esc(p.amountPerEmployee) + '" required><span class="hint">The DBM circular sets the maximum.</span></div></div>' +
        '<p>Total amount to be funded: <strong id="ftot"></strong></p><button class="btn" type="submit"' + (o.params ? '' : ' disabled') + '>Save figures</button>' + (o.params ? '' : ' <span class="muted">Upload the e-budget report first.</span>') + '</form></div>' +
        (b.online
          ? '<div class="pane"><h2>Backup and saved copy</h2><p class="muted">The data is kept in the online database. Download a backup now and then and keep the file somewhere private: it holds the figures, the history and the sign-in accounts. The database\'s own backup history is short.</p>' +
            '<p><a class="btn alt" href="/api/backup.json" download>Download backup</a> <a class="btn alt" href="/api/offline.html" download>Download saved copy (opens without the server)</a></p>' +
            '<h3>Restore from a backup file</h3><p class="muted">This replaces everything currently in the app with the contents of the file.</p><div id="rerr"></div>' +
            '<p><input type="file" id="rfile" accept=".json,application/json"> <button class="btn alt" type="button" id="rbtn">Restore</button></p></div>'
          : '<div class="pane"><h2>Saved copy and backups</h2><p class="muted">Each time something changes, the app saves the latest report as a web page and an Excel file that open without the server. Daily backups of all data are kept as well.</p>' +
            '<ul class="summary-list"><li>Saved copy folder: <code>' + esc(b.snapshot ? b.snapshot.dir : '(created after the first upload)') + '</code></li>' +
            '<li>Backup folder: <code>' + esc(b.dir) + '</code> (' + b.backups.length + ' backup' + (b.backups.length === 1 ? '' : 's') + (b.backups[0] ? ', latest ' + esc(b.backups[0]) : '') + ')</li></ul>' +
            '<button class="btn alt" type="button" id="bk">Back up now</button> <a class="btn alt" href="/api/backup.json" download>Download backup file</a></div>');
      function tot() { var t = Math.round((Number($('#fe').value) || 0) * Math.round((Number($('#fa').value) || 0) * 100)) / 100; $('#ftot').textContent = peso(t); }
      $('#fe').oninput = tot; $('#fa').oninput = tot; tot();
      $('#ff').onsubmit = function (e) {
        e.preventDefault();
        api('/api/params', { method: 'PUT', json: { year: Number($('#fy').value), employees: Number($('#fe').value), amountPerEmployee: Number($('#fa').value) } })
          .then(function (d) { $('#ferr').innerHTML = ''; toast(d.unchanged ? 'No changes to save.' : 'Figures saved.'); })
          .catch(function (er) { $('#ferr').innerHTML = msg('err', errText(er)); });
      };
      if ($('#rbtn')) $('#rbtn').onclick = function () {
        var f = $('#rfile').files[0];
        if (!f) { $('#rerr').innerHTML = msg('err', 'Choose a backup file first.'); return; }
        askDialog({ title: 'Restore from this backup?', text: 'Everything now in the app will be replaced by the contents of ' + f.name + '. You may be signed out if the accounts differ.', ok: 'Restore', danger: true }).then(function (ok) {
          if (!ok) return;
          fetch('/api/backup/restore', { method: 'POST', headers: { 'X-Requested-With': 'cna-app' }, body: f, credentials: 'same-origin' })
            .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'Could not restore.'); return j; }); })
            .then(function () { toast('Backup restored.'); location.hash = '#/dashboard'; route(); })
            .catch(function (er) { $('#rerr').innerHTML = msg('err', er.message); });
        });
      };
      if ($('#bk')) $('#bk').onclick = function () { api('/api/backup', { method: 'POST', json: {} }).then(function (d) { toast('Backup saved: ' + d.name); }).catch(function (er) { toast(errText(er)); }); };
      function send(file) {
        if (!file) return;
        $('#uerr').innerHTML = ''; $('#ures').innerHTML = '<p class="muted">Reading ' + esc(file.name) + '</p>';
        file.arrayBuffer().then(function (buf) { return api('/api/upload', { method: 'POST', raw: buf, filename: file.name }); }).then(function (d) {
          var s = d.summary;
          $('#ures').innerHTML = msg('ok', 'Uploaded. This is now the latest report.') + '<ul class="summary-list"><li>Report date: <strong>' + esc(R.longDate(s.asOf)) + '</strong></li><li>' + s.offices + ' offices, ' + s.fundSources + ' of ' + s.fundSourcesListed + ' CNA fund sources found</li><li>' + s.ignoredAccounts + ' lines for other accounts ignored</li><li>Overall available balance: <strong>' + peso(s.netOverall) + '</strong></li>' +
            '<li>CNA fund source list: ' + (s.fundSourcesFrom === 'previous' ? 'kept from the previous upload' : s.fundSourcesFrom === 'default' ? 'the 33-account list supplied with the app' : 'read from the file') + '</li>' +
            (s.check ? '<li>' + (s.check.ok ? 'Check passed: the account lines add up to the report\'s Grand Total' + (s.check.skipped.length ? ' for ' + esc(s.check.verified.join(' and ')) + '. The Grand Total for ' + esc(s.check.skipped.join(' and ')) + ' is blank in this file, so it could not be compared.' : '.') : 'Check failed: the account lines do not add up to the report\'s Grand Total.') + '</li>' : '') + '</ul>' +
            s.warnings.map(function (w) { return msg('warn', w); }).join('') + '<a class="btn" href="#/dashboard">View the dashboard</a>';
        }).catch(function (er) { $('#ures').innerHTML = ''; $('#uerr').innerHTML = msg('err', errText(er)); });
      }
      $('#file').onchange = function () { send(this.files[0]); this.value = ''; };
      var drop = $('#drop');
      ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
      ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
      drop.addEventListener('drop', function (e) { send(e.dataTransfer.files[0]); });
    }).catch(function (e) { $('#dat').innerHTML = msg('err', errText(e)); });
  }

  // ---------- admin: voided funds
  function viewVoids() {
    shell('voids', '<h1 class="page-title">Voided funds</h1><p class="page-lead">When a fund source is voided, it is voided in every office. Its balances leave the available fund and are shown in red as a deduction, with the office and the reason you state here.</p><div id="vd"><p class="muted">Loading</p></div>');
    Promise.all([api('/api/options'), api('/api/report')]).then(function (res) {
      var o = res[0], rep = res[1];
      if (!o.accounts.length) { $('#vd').innerHTML = '<div class="pane empty"><h2>No report yet</h2><p>Upload the e-budget report before voiding fund sources.</p><p><a class="btn" href="#/data">Upload and figures</a></p></div>'; return; }
      var m = rep.model;
      var voided = {}; m.voids.forEach(function (v) { voided[v.account] = true; });
      var bal = {}; m.accounts.forEach(function (a) { bal[a.account] = a.gross.overall; });
      $('#vd').innerHTML =
        '<div class="pane"><h2>Void a fund source</h2><p class="muted">The amount voided is the balance of the fund source in all offices, taken from the latest e-budget report.</p><div id="verr"></div><form id="vf">' +
        '<div class="field"><label for="va">Fund source</label><select id="va" required><option value="">Choose a fund source</option>' + o.accounts.filter(function (a) { return !voided[a.account]; }).map(function (a) { return '<option value="' + esc(a.account) + '">' + esc(a.account) + '</option>'; }).join('') + '</select><span class="hint" id="vbal">&nbsp;</span></div>' +
        '<div class="row"><div class="field"><label for="vo">Office</label><input id="vo" maxlength="200" required autocomplete="off"><span class="hint">The office that caused the void. Type it as it should appear in the report.</span></div>' +
        '<div class="field"><label for="vdte">Date voided</label><input id="vdte" type="date" value="' + new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }) + '" required></div></div>' +
        '<div class="field"><label for="vr">Reason</label><textarea id="vr" maxlength="500" required></textarea><span class="hint">This is printed in the report.</span></div>' +
        '<button class="btn danger" type="submit">Void fund source</button></form></div>' +
        '<div class="pane"><h2>Currently voided</h2>' + (m.voids.length ? '<div class="tbl-scroll"><table class="tbl"><thead><tr><th>Fund source</th><th class="r">Amount voided (all offices)</th><th>Office</th><th>Reason</th><th>Date</th><th></th></tr></thead><tbody>' +
          m.voids.map(function (v) { return '<tr><td>' + esc(v.account) + '</td><td class="r void">' + peso(v.overall) + '</td><td>' + esc(v.officeRemark) + '</td><td>' + esc(v.reason) + '</td><td>' + esc(R.longDate(v.dateVoided)) + '</td><td class="r"><button type="button" class="btn small alt" data-rm="' + esc(v.id) + '">Remove void</button></td></tr>'; }).join('') +
          '</tbody><tfoot><tr><th class="r">Total voided</th><th class="r void">' + peso(m.voidTotals.overall) + '</th><th colspan="4"></th></tr></tfoot></table></div>' : '<p class="muted">No fund sources have been voided.</p>') + '</div>';
      $('#va').onchange = function () { $('#vbal').innerHTML = this.value ? 'Balance in all offices: <strong>' + peso(bal[this.value] || 0) + '</strong> (appropriation plus allotment balance)' : '&nbsp;'; };
      $('#vf').onsubmit = function (e) {
        e.preventDefault();
        askDialog({ title: 'Void this fund source?', text: 'You are about to void ' + $('#va').value + ' in all offices, which deducts ' + peso(bal[$('#va').value] || 0) + ' from the available fund. This is recorded in the history.', ok: 'Void', danger: true }).then(function (ok) {
          if (!ok) return;
          api('/api/voids', { method: 'POST', json: { account: $('#va').value, officeRemark: $('#vo').value, reason: $('#vr').value, dateVoided: $('#vdte').value } })
            .then(function () { toast('Fund source voided.'); viewVoids(); }).catch(function (er) { $('#verr').innerHTML = msg('err', errText(er)); });
        });
      };
      Array.prototype.forEach.call(document.querySelectorAll('[data-rm]'), function (b) {
        b.onclick = function () {
          askDialog({ title: 'Remove this void?', text: 'The balances return to the available fund in every office. Give the reason so the history shows why.', field: 'Reason for removing the void', required: 'State why the void is being removed.', ok: 'Remove void', danger: true }).then(function (reason) {
            if (!reason) return;
            api('/api/voids/' + b.getAttribute('data-rm'), { method: 'DELETE', json: { reason: reason } }).then(function () { toast('Void removed.'); viewVoids(); }).catch(function (er) { toast(errText(er)); });
          });
        };
      });
    }).catch(function (e) { if (e.message !== 'signed-out') $('#vd').innerHTML = msg('err', errText(e)); });
  }

  // ---------- admin: people
  function viewUsers() {
    shell('users', '<h1 class="page-title">People</h1><p class="page-lead">The Administrator uploads data and changes figures. Head of Office accounts can only view, print and download the report.</p><div id="us"><p class="muted">Loading</p></div>');
    api('/api/users').then(function (d) {
      $('#us').innerHTML = '<div class="pane"><h2>Accounts</h2><div class="tbl-scroll"><table class="tbl"><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th></th></tr></thead><tbody>' +
        d.users.map(function (u) {
          return '<tr><td>' + esc(u.name) + '</td><td>' + esc(u.username) + '</td><td>' + (u.role === 'admin' ? 'Administrator' : 'Head of Office (view only)') + '</td><td>' + (u.active ? 'Active' : '<span class="void">Turned off</span>') + (u.mustChange ? ' <span class="muted">(must change password)</span>' : '') + '</td>' +
            '<td class="r"><button type="button" class="btn small alt" data-reset="' + esc(u.id) + '">Reset password</button> ' + (u.id !== me.id ? '<button type="button" class="btn small alt" data-toggle="' + esc(u.id) + '" data-active="' + (u.active ? '1' : '0') + '">' + (u.active ? 'Turn off' : 'Turn on') + '</button>' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div></div>' +
        '<div class="pane"><h2>Add a person</h2><div id="uerr"></div><form id="uf"><div class="row"><div class="field"><label for="un">Full name</label><input id="un" required></div><div class="field"><label for="uu">Username</label><input id="uu" autocapitalize="off" required></div></div>' +
        '<div class="row"><div class="field"><label for="ur">Role</label><select id="ur"><option value="head">Head of Office (view only)</option><option value="admin">Administrator</option></select></div><div class="field"><label for="up">Temporary password</label><input id="up" type="text" minlength="8" autocomplete="off" required><span class="hint">They must choose their own at first sign-in.</span></div></div>' +
        '<button class="btn" type="submit">Add person</button></form></div>';
      $('#uf').onsubmit = function (e) {
        e.preventDefault();
        api('/api/users', { method: 'POST', json: { name: $('#un').value, username: $('#uu').value, role: $('#ur').value, password: $('#up').value } })
          .then(function () { toast('Person added.'); viewUsers(); }).catch(function (er) { $('#uerr').innerHTML = msg('err', errText(er)); });
      };
      Array.prototype.forEach.call(document.querySelectorAll('[data-reset]'), function (b) {
        b.onclick = function () {
          askDialog({ title: 'Reset password', text: 'Enter a temporary password. The person must choose a new one at their next sign-in.', field: 'Temporary password', password: true, required: 'Enter a temporary password.', ok: 'Reset password' }).then(function (pw) {
            if (!pw) return;
            api('/api/users/' + b.getAttribute('data-reset'), { method: 'PUT', json: { password: pw } }).then(function () { toast('Password reset.'); viewUsers(); }).catch(function (er) { toast(errText(er)); });
          });
        };
      });
      Array.prototype.forEach.call(document.querySelectorAll('[data-toggle]'), function (b) {
        b.onclick = function () {
          api('/api/users/' + b.getAttribute('data-toggle'), { method: 'PUT', json: { active: b.getAttribute('data-active') !== '1' } }).then(function () { viewUsers(); }).catch(function (er) { toast(errText(er)); });
        };
      });
    }).catch(function (e) { if (e.message !== 'signed-out') $('#us').innerHTML = msg('err', errText(e)); });
  }

  // ---------- routing
  function route() {
    if (!me) return showLogin();
    var name = ((location.hash || '#/dashboard').replace(/^#\/?/, '').split('?')[0].split('/')[0]) || 'dashboard';
    if (me.mustChange) return viewPassword(true);
    var adminOnly = { data: 1, voids: 1, users: 1 };
    if (adminOnly[name] && me.role !== 'admin') { location.hash = '#/dashboard'; return; }
    window.scrollTo(0, 0);
    if (name === 'history') return viewHistory();
    if (name === 'data') return viewData();
    if (name === 'voids') return viewVoids();
    if (name === 'users') return viewUsers();
    if (name === 'password') return viewPassword(false);
    return viewReport(name === 'reports' ? 'reports' : 'dashboard', hashQuery());
  }
  window.addEventListener('hashchange', route);
  api('/api/me').then(function (d) { me = d.user; route(); }).catch(function () {
    // Server unreachable: show the last report this browser received, if any.
    var cached = null; try { cached = JSON.parse(localStorage.getItem(CACHE_KEY)); } catch (e) { /* none */ }
    if (cached && cached.model) {
      me = { name: 'Offline copy', role: 'head' };
      app.innerHTML = '<main class="main" id="main"></main>';
      renderReport(cached.model, { isCurrent: true, cachedAt: cached.savedAt, view: 'dashboard', q: {} });
    } else {
      app.innerHTML = '<main class="main"><div class="pane empty"><h2>The server cannot be reached</h2><p>Check that the server computer is on and connected, then reload this page. A saved copy of the latest report is kept in the Budget Office\'s shared folder.</p></div></main>';
    }
  });
})();
