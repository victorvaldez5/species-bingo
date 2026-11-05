// The one theme script every page carries in <head> (D11). It runs before
// first paint, so a saved Light or Dark choice never flashes the other
// theme. Auto (nothing saved) leaves <html> bare and follows the phone.
//
// It also owns the Light / Dark / Auto toggle: any button with
// data-theme-set="light|dark|auto" works on any page, wired by click
// delegation, so the footer and the game's Actions menu share this code.
// Storage is wrapped in try/catch: blocked storage just means the choice
// lasts until the page closes.
export const themeScript = `(function () {
  var KEY = 'species-bingo:theme', root = document.documentElement;
  var choice = 'auto';
  try { var saved = localStorage.getItem(KEY); if (saved === 'light' || saved === 'dark') choice = saved; } catch (e) { /* blocked storage: Auto */ }
  function dark(c) {
    return c === 'dark' || (c === 'auto' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  }
  function paint() {
    if (choice === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', choice);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark(choice) ? '#1f2c1c' : '#36492e');
    var buttons = document.querySelectorAll('[data-theme-set]');
    for (var i = 0; i < buttons.length; i++) buttons[i].setAttribute('aria-pressed', String(buttons[i].getAttribute('data-theme-set') === choice));
  }
  paint();
  document.addEventListener('DOMContentLoaded', paint);
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-theme-set]');
    if (!b) return;
    choice = b.getAttribute('data-theme-set');
    if (choice !== 'light' && choice !== 'dark') choice = 'auto';
    try { if (choice === 'auto') localStorage.removeItem(KEY); else localStorage.setItem(KEY, choice); } catch (err) { /* ignore */ }
    paint();
  });
  if (window.matchMedia) {
    var mq = matchMedia('(prefers-color-scheme: dark)');
    var follow = function () { if (choice === 'auto') paint(); };
    if (mq.addEventListener) mq.addEventListener('change', follow);
  }
})();`;
