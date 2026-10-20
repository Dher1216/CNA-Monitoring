// Lets phones install the app on the home screen and open it quickly, and offers an install prompt.
(function () {
  'use strict';
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function () { /* not available: the app still works in the browser */ });
    });
  }

  var KEY = 'cna:install-dismissed';
  function stored(get, set) { try { return set === undefined ? localStorage.getItem(KEY) : localStorage.setItem(KEY, set); } catch (e) { return null; } }
  var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  var ua = navigator.userAgent || '';
  var isIOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  var isAndroid = /Android/.test(ua);
  var deferred = null;
  if (standalone || !(isIOS || isAndroid) || stored()) return;

  function banner(html, withInstall) {
    if (document.getElementById('install-banner')) return;
    var b = document.createElement('div');
    b.id = 'install-banner'; b.className = 'install-banner no-print'; b.setAttribute('role', 'region'); b.setAttribute('aria-label', 'Install the app');
    b.innerHTML = '<img src="/icon-192.png" alt="" width="40" height="40"><div class="ib-text">' + html + '</div>' +
      (withInstall ? '<button type="button" class="btn small" id="ib-go">Install</button>' : '') +
      '<button type="button" class="ib-x" id="ib-x" aria-label="Close">Not now</button>';
    document.body.appendChild(b);
    document.getElementById('ib-x').onclick = function () { stored(0, '1'); b.remove(); };
    var go = document.getElementById('ib-go');
    if (go) go.onclick = function () {
      if (!deferred) return;
      deferred.prompt();
      deferred.userChoice.then(function () { deferred = null; b.remove(); stored(0, '1'); });
    };
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); deferred = e;
    banner('<strong>Install CNA Fund Monitor</strong><span>Open it from your home screen like an app.</span>', true);
  });
  window.addEventListener('appinstalled', function () { stored(0, '1'); var b = document.getElementById('install-banner'); if (b) b.remove(); });

  if (isIOS) {
    window.addEventListener('load', function () {
      setTimeout(function () {
        banner('<strong>Install CNA Fund Monitor</strong><span>In Safari, tap the Share button, then <b>Add to Home Screen</b>.</span>', false);
      }, 2500);
    });
  }
})();
