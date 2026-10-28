/* ==========================================================================
   PixelSeam: a scroll-driven pixel transition between two blocks.

   A vanilla port of the idea behind React Bits' <PixelTransition />: a grid
   of square "pixels" pops in, in a mostly random order, and the colour on
   the other side takes over. Instead of hover / click, the progress is tied
   to the scroll (scrubbed), so the site seems to change colour pixel by
   pixel as you scroll past the seam, and back again when you scroll up.

   A seam is an empty zero-height element between two sections. Its canvas
   hangs upward from the seam, over the end of the previous block, and is
   filled with the colour of the NEXT block; when it is fully drawn it
   merges into that block without a line.

   Markup:   <div class="pixel-seam" data-color="--c-brand"></div>
   Options (data-* on the seam, same names as the React Bits props):
     data-color        CSS colour or CSS variable name of the next block
     data-grid         columns on desktop (default 18; phones use half)
     data-randomness   0..1, share of random order vs. bottom-up order (0.3)
     data-height       band height as a share of the window height (0.22)

   PixelSeam.mount({ seams: '.pixel-seam' }) -> { destroy() }
   ========================================================================== */
(function () {
  'use strict';

  var STEP = 0.35;   /* share of the progress one pixel takes to pop in (animationStepDuration) */

  function hash(i, salt) {
    var s = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
    return s - Math.floor(s);
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function easeOutBack(t) { var c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); }   /* "pop": overshoots to ~1.1 and settles */

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
      items.push({ seam: seam, canvas: canvas, ctx: ctx, grain: grainPattern(ctx), color: '#fff', cols: 18, rows: 1, cell: 1, H: 0, W: 0, dpx: 1, t: null, last: -1 });
    });
    if (!items.length) return null;

    function layout(it) {
      var s = it.seam, vw = s.clientWidth || window.innerWidth, vh = window.innerHeight;
      var phone = window.innerWidth < 768;
      var baseCols = parseFloat(s.getAttribute('data-grid')) || 18;
      var share = parseFloat(s.getAttribute('data-height')) || 0.22;
      var randomness = clamp(parseFloat(s.getAttribute('data-randomness')), 0, 1);
      if (isNaN(randomness)) randomness = 0.3;
      it.color = resolveColor(s.getAttribute('data-color'));
      it.cols = Math.max(4, Math.round(phone ? baseCols / 2 : baseCols));
      it.cell = vw / it.cols;
      it.rows = Math.max(3, Math.round(vh * (phone ? share * 0.85 : share) / it.cell));
      it.W = vw; it.H = it.rows * it.cell;
      it.dpr = Math.min(window.devicePixelRatio || 1, 2);
      it.canvas.width = Math.round(it.W * it.dpr);
      it.canvas.height = Math.round(it.H * it.dpr);
      it.canvas.style.height = it.H + 'px';
      /* order of appearance: from the bottom row (next to the new block) upwards, with some chaos */
      it.t = new Float32Array(it.cols * it.rows);
      for (var r = 0; r < it.rows; r++) {
        var bias = 1 - (r + 0.5) / it.rows;           /* 0 at the bottom row, ~1 at the top */
        for (var c = 0; c < it.cols; c++) {
          var i = r * it.cols + c;
          it.t[i] = (1 - randomness) * bias + randomness * hash(i, 7);
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
          var sct = clamp((shift - it.t[r * it.cols + c]) / STEP, 0, 1);
          if (sct <= 0) continue;
          var k = sct >= 1 ? 1 : easeOutBack(sct), size = cell * k + (sct >= 1 ? 0.6 : 0);   /* +0.6px: no hairline between full pixels */
          var cx = (c + 0.5) * cell, cy = (r + 0.5) * cell;
          ctx.rect(cx - size / 2, cy - size / 2, size, size);
        }
      }
      ctx.fill();
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = it.grain;
      ctx.fillRect(0, 0, it.W, it.H);
      ctx.globalCompositeOperation = 'source-over';
    }

    function progressOf(it) {
      if (reduceMotion) return 0.62;                   /* static, ragged edge */
      var top = it.seam.getBoundingClientRect().top, vh = window.innerHeight;
      return clamp((vh - top) / (vh * 0.6), 0, 1);
    }

    var raf = 0;
    function update() {
      raf = 0;
      var vh = window.innerHeight;
      items.forEach(function (it) {
        var top = it.seam.getBoundingClientRect().top;
        if (top > vh + 40 || top < -it.H - 40) {       /* far away: nothing to show or keep */
          if (it.last !== (top > vh ? 0 : 1)) { draw(it, top > vh ? 0 : 1); it.last = top > vh ? 0 : 1; }
          return;
        }
        var p = progressOf(it);
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
        items.forEach(function (it) { if (it.canvas.parentNode) it.canvas.parentNode.removeChild(it.canvas); });
      }
    };
  }

  window.PixelSeam = { mount: mount };
})();
