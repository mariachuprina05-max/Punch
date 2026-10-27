/* One source of truth for the desktop / mobile switch. The CSS media queries
   use the same 768px literal; keep them in step. */
(function () {
  'use strict';
  var query = '(min-width: 768px)';
  window.PunchLayout = {
    query: query,
    mq: window.matchMedia(query),
    get desktop() { return this.mq.matches; },
    /* one rem in px / 16: scales px constants with the fluid root */
    get scale() { return (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16) / 16; }
  };
})();
