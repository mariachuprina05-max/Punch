/* ==========================================================================
   PixelSeam: a scroll-driven pixel transition between two blocks.

   A vanilla port of the idea behind React Bits' <PixelTransition />: a grid
   of square "pixels" in a mostly random order. Here the progress is tied to
   the scroll (scrubbed): the upper block's colour melts into the lower
   block's colour pixel by pixel, and some pixels stay for good, so the
   boundary between the two blocks is a dithered pixel edge, not a line.

   The band is a transparent canvas at the top of the LOWER block (the block
   gets extra top padding, --seam-h, so no content is covered). Only the
   pixels of the upper block's colour are drawn; the lower colour and the
   film grain are the block's own, so the band has no colour step on either
   side. When the band enters the window it is fully the upper colour and
   continues the block above; while you scroll, the "melting" pixels vanish
   (bottom rows first) and the "kept" pixels remain: dense next to the upper
   block, sparse next to the lower one.

   Markup (attributes on the lower block):
     data-pixel-from         colour of the block above (CSS colour or variable)
     data-pixel-grid         columns on desktop (default 32; phones use half)
     data-pixel-randomness   0..1, share of random vs. top-down order (0.3)
     data-pixel-height       band height as a share of the window height (0.3)

   PixelSeam.mount({ targets: '[data-pixel-from]' }) -> { destroy() }
   ========================================================================== */
(function () {
  'use strict';

  var STEP = 0.2;   /* share of the progress one pixel takes to vanish (animationStepDuration) */

  function hash(i, salt) {
    var s = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
    return s - Math.floor(s);
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function easeIn(t) { return t * t; }

  function resolveColor(input) {
    var value = String(input || '#000').trim();
    var m = value.match(/^(?:var\()?\s*(--[\w-]+)\s*\)?$/);
    if (m) value = getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim() || '#000';
    return value;
  }

  function mount(options) {
    var o = Object.assign({ targets: '[data-pixel-from]' }, options || {});
    var hosts = Array.prototype.slice.call(document.querySelectorAll(o.targets));
    if (!hosts.length) return null;

    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var items = [];

    hosts.forEach(function (host) {
      if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
      var canvas = document.createElement('canvas');
      canvas.className = 'pixel-seam';
      canvas.setAttribute('aria-hidden', 'true');
      host.insertBefore(canvas, host.firstChild);   /* before the block's own grain layer, which then lies on top of it */
      var ctx = canvas.getContext('2d');
      if (!ctx) { host.removeChild(canvas); return; }
      items.push({ host: host, canvas: canvas, ctx: ctx, color: '#000', cols: 32, rows: 1, cell: 1, H: 0, W: 0, dpr: 1, t: null, keep: null, last: -1 });
    });
    if (!items.length) return null;

    function layout(it) {
      var h = it.host, vw = h.clientWidth || window.innerWidth, vh = window.innerHeight;
      var phone = window.innerWidth < 768;
      var baseCols = parseFloat(h.getAttribute('data-pixel-grid')) || 32;
      var share = parseFloat(h.getAttribute('data-pixel-height')) || 0.3;
      var randomness = clamp(parseFloat(h.getAttribute('data-pixel-randomness')), 0, 1);
      if (isNaN(randomness)) randomness = 0.3;
      it.color = resolveColor(h.getAttribute('data-pixel-from'));
      it.cols = Math.max(6, Math.round(phone ? baseCols / 2 : baseCols));
      it.cell = vw / it.cols;
      it.rows = Math.max(5, Math.round(vh * (phone ? share * 0.8 : share) / it.cell));
      it.W = vw; it.H = it.rows * it.cell;
      it.dpr = Math.min(window.devicePixelRatio || 1, 2);
      it.canvas.width = Math.round(it.W * it.dpr);
      it.canvas.height = Math.round(it.H * it.dpr);
      it.canvas.style.height = it.H + 'px';
      h.style.setProperty('--seam-h', it.H + 'px');    /* the block's top padding makes room, nothing is covered */
      it.t = new Float32Array(it.cols * it.rows);
      it.keep = new Uint8Array(it.cols * it.rows);
      for (var r = 0; r < it.rows; r++) {
        var bias = (r + 0.5) / it.rows;                /* 0 at the top row (touching the upper block), ~1 at the bottom */
        var density = Math.pow(1 - bias, 1.7);         /* how many pixels of this row stay for good */
        if (r === 0) density = 1;                      /* the top row always stays: it carries the upper block on */
        for (var c = 0; c < it.cols; c++) {
          var i = r * it.cols + c;
          it.keep[i] = hash(i, 3) < density ? 1 : 0;
          it.t[i] = (1 - randomness) * (1 - bias) + randomness * hash(i, 7);   /* small t = melts early */
        }
      }
      it.last = -1;
    }

    function draw(it, p) {
      var ctx = it.ctx, cell = it.cell;
      ctx.setTransform(it.dpr, 0, 0, it.dpr, 0, 0);
      ctx.clearRect(0, 0, it.W, it.H);
      ctx.fillStyle = it.color;
      ctx.beginPath();
      var shift = p * (1 + STEP);
      for (var r = 0; r < it.rows; r++) {
        for (var c = 0; c < it.cols; c++) {
          var i = r * it.cols + c;
          var k = 1;
          if (!it.keep[i]) {
            var gone = clamp((shift - it.t[i]) / STEP, 0, 1);   /* 0 = still there, 1 = gone */
            if (gone >= 1) continue;
            k = 1 - easeIn(gone);
            if (k > 0.82) k = 1;
          }
          var size = cell * k + (k >= 1 ? 0.6 : 0);               /* +0.6px: no hairlines between full pixels */
          var cx = (c + 0.5) * cell, cy = (r + 0.5) * cell;
          ctx.rect(cx - size / 2, cy - size / 2, size, size);
        }
      }
      ctx.fill();
    }

    function progressOf(it) {
      if (reduceMotion) return 1;                      /* static: the dithered edge only */
      var top = it.host.getBoundingClientRect().top, vh = window.innerHeight;
      return clamp((vh * 0.85 - top) / (vh * 0.7), 0, 1);
    }

    var raf = 0;
    function update() {
      raf = 0;
      var vh = window.innerHeight;
      items.forEach(function (it) {
        var top = it.host.getBoundingClientRect().top;
        var p;
        if (reduceMotion) p = 1;
        else if (top > vh + 40) p = 0;                 /* below the window: fully the upper colour */
        else if (top < -it.H - 40) p = 1;              /* above the window: the final dithered edge */
        else p = progressOf(it);
        if (Math.abs(p - it.last) < 0.0015) return;
        it.last = p; draw(it, p);
      });
    }
    function schedule() { if (!raf) raf = requestAnimationFrame(update); }

    function relayout() { items.forEach(layout); schedule(); }
    items.forEach(layout);
    update();

    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', relayout);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(relayout);

    return {
      destroy: function () {
        window.removeEventListener('scroll', schedule);
        window.removeEventListener('resize', relayout);
        if (raf) cancelAnimationFrame(raf);
        items.forEach(function (it) { it.host.style.removeProperty('--seam-h'); if (it.canvas.parentNode) it.canvas.parentNode.removeChild(it.canvas); });
      }
    };
  }

  window.PixelSeam = { mount: mount };
})();
