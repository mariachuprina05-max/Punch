/* One source of truth for the desktop / mobile switch. The CSS media queries
   use the same 768px literal; keep them in step. */
(function () {
  'use strict';
  var query = '(min-width: 768px)';
  window.PunchLayout = {
    query: query,
    mq: window.matchMedia(query),
    get desktop() { return this.mq.matches; },
    /* one design pixel of the 1440 frame at width w, same curve as --dpx in the CSS */
    dpx: function (w) {
      var grow = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--grow')) || 0.4;
      return Math.min(w / 1440, 1 + (Math.min(w, 1920) - 1440) * grow / 1440);
    },
    /* one rem in px / 16: scales px constants with the fluid root */
    get scale() { return (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16) / 16; }
  };
})();
