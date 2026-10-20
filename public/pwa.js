// Lets phones install the app on the home screen and open it quickly.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js').catch(function () { /* not available: the app still works in the browser */ });
  });
}
