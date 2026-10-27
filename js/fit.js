/* ==========================================================================
   Fit: keeps the pinned blocks inside one screen.

   Work and Process are pinned for a whole screen (sticky / GSAP pin) and
   their box is exactly one window tall, while their content is sized in rem
   and so follows the window WIDTH. On a wide but low window the content
   would be cut off at the bottom. Elements marked  data-fit-rem="N"  (N =
   their natural height in rem) get a --fit factor = min(1, window height /
   natural height); the CSS applies it with `zoom`. On tall windows --fit is 1
   and nothing changes. data-fit-fixed-rem="M" marks the part of that height
   that does not shrink with zoom. --fit never goes below 0.5.
   ========================================================================== */
(function () {
  'use strict';
  var els = document.querySelectorAll('[data-fit-rem]');
  if (!els.length) return;

  var desktop = window.PunchLayout.mq;
  var timer = 0;

  function apply() {
    var rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    var changed = false;
    els.forEach(function (el) {
      /* below 1024 some blocks stack differently (see data-fit-rem-tablet) */
      var tablet = window.innerWidth < 1024 && el.hasAttribute('data-fit-rem-tablet');
      var natural = parseFloat(el.getAttribute(tablet ? 'data-fit-rem-tablet' : 'data-fit-rem')) * rootPx;
      /* part of the height that zoom cannot shrink (the Process card fan keeps
         its width, so its height follows the width): it is subtracted first */
      var fixed = (parseFloat(el.getAttribute('data-fit-fixed-rem')) || 0) * rootPx;
      var fit = desktop.matches && natural > fixed
        ? Math.min(1, Math.max(0.5, (window.innerHeight - fixed) / (natural - fixed)))
        : 1;
      var value = fit.toFixed(4);
      if (el.style.getPropertyValue('--fit') !== value) { el.style.setProperty('--fit', value); changed = true; }
    });
    /* pins and scroll lengths were measured with the old size */
    if (changed && window.ScrollTrigger) window.ScrollTrigger.refresh();
  }

  function later() { clearTimeout(timer); timer = setTimeout(apply, 120); }

  window.addEventListener('resize', later);
  window.addEventListener('load', apply);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(apply);
  apply();
})();
