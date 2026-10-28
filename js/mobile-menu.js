/* ==========================================================================
   MobileMenu: the burger menu of the mobile layout (< 768 px).

   The ( MENU ) button in the hero bar opens a black rounded panel (markup
   .mmenu in index.html, styles at the end of css/style.css). The panel grows
   out of its top right corner, the menu items rise out of masks letter by
   letter with the same entrance as every heading on the site (PunchReveal),
   and the logo comes up from below. A link closes the menu and scrolls
   smoothly to its section.

   Closes with the cross, Esc, a tap outside the panel, a link, or when the
   window becomes wide enough for the desktop layout. Page scroll is locked
   while it is open (html.menu-open + Lenis stop). Reduced motion: no animation.

   MobileMenu.mount() -> { open(), close(), destroy() }
   ========================================================================== */
(function () {
  'use strict';

  function mount() {
    var btn = document.querySelector('.hero__menu');
    var panel = document.getElementById('mobileMenu');
    if (!btn || !panel) return null;

    var closeBtn = panel.querySelector('.mmenu__close');
    var links = Array.prototype.slice.call(panel.querySelectorAll('.mmenu__link'));
    var head = panel.querySelectorAll('.mmenu__label, .mmenu__close');
    var logoBox = panel.querySelector('.mmenu__logo');
    var root = document.documentElement;
    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var isOpen = false;
    var splits = [];

    /* the logo is the hero's own mark, copied (no second copy of its path data in the markup) */
    var mark = document.querySelector('.hero__logo-mark');
    if (mark && logoBox) {
      var copy = mark.cloneNode(true);
      copy.removeAttribute('role'); copy.removeAttribute('aria-label'); copy.setAttribute('aria-hidden', 'true');
      logoBox.appendChild(copy);
    }

    function animated() { return !reduceMotion && typeof gsap !== 'undefined'; }
    function lenis() { return window.__lenis || null; }

    function stopAnim() {
      if (typeof gsap === 'undefined') return;
      gsap.killTweensOf([panel, logoBox].concat(Array.prototype.slice.call(head)));
      splits.forEach(function (sp) { sp.revert(); });
      splits = [];
      gsap.set([panel, logoBox].concat(Array.prototype.slice.call(head)), { clearProps: 'opacity,transform' });
    }

    function lock(on) {
      root.classList.toggle('menu-open', on);
      var l = lenis();
      if (l) { if (on) l.stop(); else l.start(); }
    }

    function open() {
      if (isOpen || window.PunchLayout.desktop) return;
      isOpen = true;
      stopAnim();
      panel.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      lock(true);

      if (animated()) {
        gsap.fromTo(panel, { scale: 0.86, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.55, ease: 'expo.out', clearProps: 'transform,opacity' });
        gsap.fromTo(head, { opacity: 0 }, { opacity: 1, duration: 0.4, delay: 0.15, ease: 'power2.out', clearProps: 'opacity' });
        links.forEach(function (a, i) {
          if (!window.PunchReveal || typeof SplitText === 'undefined') return;
          var split = window.PunchReveal.prepare(a);
          splits.push(split);
          window.PunchReveal.play(split, 0.14 + i * 0.06);
        });
        if (logoBox) gsap.fromTo(logoBox, { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7, delay: 0.3, ease: 'expo.out', clearProps: 'transform,opacity' });
      }
      (links[0] || closeBtn).focus({ preventScroll: true });
    }

    function finish(restoreFocus) {
      panel.hidden = true;
      stopAnim();
      if (restoreFocus) btn.focus({ preventScroll: true });
    }

    /* opts.focus: give the focus back to the ( MENU ) button; opts.instant: no animation */
    function close(opts) {
      opts = opts || {};
      if (!isOpen) return;
      isOpen = false;
      btn.setAttribute('aria-expanded', 'false');
      lock(false);
      if (animated() && !opts.instant) {
        stopAnim();
        gsap.to(panel, { scale: 0.92, opacity: 0, duration: 0.28, ease: 'power2.in', onComplete: function () { finish(opts.focus); } });
      } else {
        finish(opts.focus);
      }
    }

    function scrollTo(hash) {
      var el = hash && hash.length > 1 ? document.querySelector(hash) : null;
      if (!el) return;
      var y = el.getBoundingClientRect().top + window.pageYOffset;
      var l = lenis();
      if (l) l.scrollTo(y, { duration: 1.4 });
      else window.scrollTo({ top: y, behavior: reduceMotion ? 'auto' : 'smooth' });
      if (window.history && history.replaceState) history.replaceState(null, '', hash);
    }

    btn.addEventListener('click', function () { if (isOpen) close({ focus: true }); else open(); });
    closeBtn.addEventListener('click', function () { close({ focus: true }); });

    links.forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        var hash = a.getAttribute('href');
        close();
        scrollTo(hash);
      });
    });

    function onKey(e) {
      if (!isOpen) return;
      if (e.key === 'Escape') { e.preventDefault(); close({ focus: true }); return; }
      if (e.key !== 'Tab') return;
      var items = [closeBtn].concat(links);
      var first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      else if (!panel.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    }
    function onPointer(e) {
      if (!isOpen) return;
      if (panel.contains(e.target) || btn.contains(e.target)) return;
      close();
    }
    function onLayout() { if (isOpen && window.PunchLayout.desktop) close({ instant: true }); }

    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    if (window.PunchLayout.mq.addEventListener) window.PunchLayout.mq.addEventListener('change', onLayout);
    else if (window.PunchLayout.mq.addListener) window.PunchLayout.mq.addListener(onLayout);

    return {
      open: open,
      close: close,
      destroy: function () {
        close({ instant: true });
        document.removeEventListener('keydown', onKey);
        document.removeEventListener('pointerdown', onPointer);
      }
    };
  }

  window.MobileMenu = { mount: mount };
})();
