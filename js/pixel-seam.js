/* ==========================================================================
   PixelSeam: a scroll-driven pixel transition between two blocks.

   A vanilla port of the idea behind React Bits' <PixelTransition />: a grid
   of square "pixels" that pop in / out in a mostly random order. Here the
   progress is tied to the scroll (scrubbed): the upper block's colour melts
   into the lower block's colour, pixel by pixel, and back when you scroll up.

   A seam is an empty band BETWEEN two sections (extra spacing; it covers no
   content). Its canvas is opaque: the lower block's colour with pixels of the
   upper block's colour on top. When the seam enters the window the pixels
   cover it, so the upper block seems to continue downwards; while you scroll
   they vanish and the lower colour shows through.

   Markup:   <div class="pixel-seam" data-from="--c-bg" data-to="--c-brand"></div>
   Options (data-* on the seam, same names as the React Bits props):
     data-from         colour of the block above (CSS colour or variable name)
     data-to           colour of the block below
     data-grid         columns on desktop (default 30; phones use half)
     data-randomness   0..1, share of random order vs. top-down order (0.3)
     data-height       band height as a share of the window height (0.26)

   PixelSeam.mount({ seams: '.pixel-seam' }) -> { destroy() }
   ========================================================================== */
(function () {
  'use strict';

  var STEP = 0.2;   /* share of the progress one pixel takes to vanish (animationStepDuration) */

  function hash(i, salt) {
    var s = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
    return s - Math.floor(s);
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function easeIn(t) { return t * t; }   /* slow at first, then it drops out quickly */

  function resolveColor(input) {
    var value = String(input || '#ffffff').trim();
    var m = value.match(/^(?:var\()?\s*(--[\w-]+)\s*\)?$/);
    if (m) value = getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim() || '#ffffff';
    return value;
  }

  /* the same film grain as the blocks around it, so the band does not look flat */
  function grainPattern(ctx) {
    var size = 200, c = document.createElement('canvas');
    c.width = c.height = size;
    var cx = c.getContext('2d'), img = cx.createImageData(size, size), d = img.data;
    for (var i = 0; i < d.length; i += 4) { var v = Math.random() * 255; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 18; }
    cx.putImageData(img, 0, 0);
    return ctx.createPattern(c, 'repeat');
  }

  function mount(options) {
    var o = Object.assign({ seams: '.pixel-seam' }, options || {});
    var seams = Array.prototype.slice.call(document.querySelectorAll(o.seams));
    if (!seams.length) return null;

    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var items = [];

    seams.forEach(function (seam) {
      var canvas = document.createElement('canvas');
      canvas.setAttribute('aria-hidden', 'true');
      seam.appendChild(canvas);
      var ctx = canvas.getContext('2d');
      if (!ctx) { seam.removeChild(canvas); return; }
      items.push({ seam: seam, canvas: canvas, ctx: ctx, grain: grainPattern(ctx), from: '#000', to: '#fff', cols: 30, rows: 1, cell: 1, H: 0, W: 0, dpr: 1, t: null, last: -1 });
    });
    if (!items.length) return null;

    function layout(it) {
      var s = it.seam, vw = s.parentNode ? s.parentNode.clientWidth || window.innerWidth : window.innerWidth, vh = window.innerHeight;
      var phone = window.innerWidth < 768;
      var baseCols = parseFloat(s.getAttribute('data-grid')) || 30;
      var share = parseFloat(s.getAttribute('data-height')) || 0.26;
      var randomness = clamp(parseFloat(s.getAttribute('data-randomness')), 0, 1);
      if (isNaN(randomness)) randomness = 0.3;
      it.from = resolveColor(s.getAttribute('data-from'));
      it.to = resolveColor(s.getAttribute('data-to'));
      it.cols = Math.max(6, Math.round(phone ? baseCols / 2 : baseCols));
      it.cell = vw / it.cols;
      it.rows = Math.max(4, Math.round(vh * (phone ? share * 0.8 : share) / it.cell));
      it.W = vw; it.H = it.rows * it.cell;
      it.dpr = Math.min(window.devicePixelRatio || 1, 2);
      it.canvas.width = Math.round(it.W * it.dpr);
      it.canvas.height = Math.round(it.H * it.dpr);
      it.canvas.style.height = it.H + 'px';
      s.style.height = it.H + 'px';                    /* the band itself is the extra spacing */
      /* when each pixel vanishes: the rows next to the lower block go first, the ones
         touching the upper block hold on longest, with some chaos on top */
      it.t = new Float32Array(it.cols * it.rows);
      for (var r = 0; r < it.rows; r++) {
        var bias = (r + 0.5) / it.rows;                /* 0 at the top row, ~1 at the bottom row */
        for (var c = 0; c < it.cols; c++) {
          var i = r * it.cols + c;
          it.t[i] = (1 - randomness) * (1 - bias) + randomness * hash(i, 7);   /* small t = vanishes early */
        }
      }
      it.last = -1;
    }

    function draw(it, p) {
      var ctx = it.ctx, cell = it.cell;
      ctx.setTransform(it.dpr, 0, 0, it.dpr, 0, 0);
      ctx.fillStyle = it.to;                           /* the lower block's colour is the base */
      ctx.fillRect(0, 0, it.W, it.H);
      ctx.fillStyle = it.from;                         /* the upper block's pixels melt away over it */
      ctx.beginPath();
      var shift = p * (1 + STEP);
      for (var r = 0; r < it.rows; r++) {
        for (var c = 0; c < it.cols; c++) {
          var gone = clamp((shift - it.t[r * it.cols + c]) / STEP, 0, 1);   /* 0 = still there, 1 = gone */
          if (gone >= 1) continue;
          var k = gone <= 0 ? 1 : 1 - easeIn(gone); if (k > 0.82) k = 1;                          /* "pop" in reverse: the pixel shrinks away */
          var size = cell * k + (k >= 1 ? 0.6 : 0);                       /* +0.6px: no hairlines between full pixels */
          if (size <= 0) continue;
          var cx = (c + 0.5) * cell, cy = (r + 0.5) * cell;
          ctx.rect(cx - size / 2, cy - size / 2, size, size);
        }
      }
      ctx.fill();
      ctx.fillStyle = it.grain;                        /* the same film grain as the blocks around it */
      ctx.fillRect(0, 0, it.W, it.H);
    }

    function progressOf(it) {
      if (reduceMotion) return 0.5;                    /* static, ragged edge */
      var top = it.seam.getBoundingClientRect().top, vh = window.innerHeight;
      return clamp((vh * 0.85 - top) / (vh * 0.7), 0, 1);
    }

    var raf = 0;
    function update() {
      raf = 0;
      var vh = window.innerHeight;
      items.forEach(function (it) {
        var top = it.seam.getBoundingClientRect().top;
        var p;
        if (top > vh + 40) p = 0;                      /* below the window: fully the upper colour */
        else if (top < -it.H - 40) p = 1;              /* above the window: fully the lower colour */
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
        items.forEach(function (it) { it.seam.style.height = ''; if (it.canvas.parentNode) it.canvas.parentNode.removeChild(it.canvas); });
      }
    };
  }

  window.PixelSeam = { mount: mount };
})();
