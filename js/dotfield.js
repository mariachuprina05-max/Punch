/* ==========================================================================
   DotField: a living halftone background, drawn in code.

   Replaces the looping GIF / PNG behind a block. A grid of cells reads a
   slowly flowing noise field; where the field crosses a contour level the
   cells swell into solid squares, a little further out they turn into thin
   diamonds, and everywhere else they shrink to tiny dots. As a contour
   sweeps past, a diamond rotates into a square and back, which is what
   makes the pattern feel like it is moving rather than blinking. The
   cursor bends the field, scrolling drifts it, and nothing ever loops or
   cuts: the field is continuous in time.

   Options:
     target     CSS selector of the block (default '.about')
     color      CSS colour or CSS variable name           (default #FFF714)
     level      contour level of the field, 0..1          (default 0.5)
     speed      how fast the field flows                  (default 0.14)
     alpha      overall strength, 0..1                    (default 1)

   DotField.mount(options) -> { destroy() } or null.
   ========================================================================== */
(function () {
  'use strict';

  /* ---- smooth 3D value noise ------------------------------------------- */
  function hash(x, y, z) {
    var h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  }
  function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  function noise(x, y, z) {
    var xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    var xf = x - xi, yf = y - yi, zf = z - zi;
    var u = fade(xf), v = fade(yf), w = fade(zf);
    function l(a, b, t) { return a + (b - a) * t; }
    return l(
      l(l(hash(xi, yi, zi), hash(xi + 1, yi, zi), u), l(hash(xi, yi + 1, zi), hash(xi + 1, yi + 1, zi), u), v),
      l(l(hash(xi, yi, zi + 1), hash(xi + 1, yi, zi + 1), u), l(hash(xi, yi + 1, zi + 1), hash(xi + 1, yi + 1, zi + 1), u), v),
      w);
  }
  /* two octaves, the second one rotated so the grid of the noise never shows */
  function field(x, y, z) {
    return 0.68 * noise(x, y, z) + 0.32 * noise(x * 1.9 + y * 0.6 + 7.3, y * 1.9 - x * 0.6 + 2.1, z * 1.3 + 4.7);
  }

  function smoothstep(a, b, x) {
    var t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }

  function resolveColor(input) {
    var value = String(input || '#FFF714').trim();
    var m = value.match(/^(?:var\()?\s*(--[\w-]+)\s*\)?$/);
    if (m) value = getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim() || '#FFF714';
    var probe = document.createElement('span');
    probe.style.color = value;
    document.body.appendChild(probe);
    var rgb = (getComputedStyle(probe).color.match(/[\d.]+/g) || [255, 247, 20]).slice(0, 3).map(Math.round);
    document.body.removeChild(probe);
    return rgb.join(',');
  }

  function mount(options) {
    var o = Object.assign({ target: '.about', color: '#FFF714', level: 0.5, speed: 0.14, alpha: 1 }, options || {});
    var host = document.querySelector(o.target);
    if (!host) return null;

    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    var layer = document.createElement('div');
    layer.className = 'dotfield-layer';
    layer.setAttribute('aria-hidden', 'true');
    var canvas = document.createElement('canvas');
    layer.appendChild(canvas);
    host.insertBefore(layer, host.firstChild);
    var ctx = canvas.getContext('2d');
    if (!ctx) { host.removeChild(layer); return null; }
    document.documentElement.classList.add('has-dotfield');

    var rgb = resolveColor(o.color);
    var W = 0, H = 0, dpr = 1, cell = 30, cols = 0, rows = 0, F = null;
    var visible = false, raf = 0, alive = true;
    var pointer = { x: 0, y: 0, tx: 0, ty: 0, p: 0, tp: 0 };

    function layout() {
      var r = host.getBoundingClientRect();
      W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      /* same pitch as the preloader wall: ~13px at 1440x810, ~7-8px on phones */
      cell = Math.max(7, Math.round(Math.sqrt(W * H / 6500)));
      cols = Math.ceil(W / cell); rows = Math.ceil(H / cell);
      F = new Float32Array((cols + 2) * (rows + 2));
    }

    function draw(ms) {
      var t = reduceMotion ? 12 : ms / 1000;
      var rect = host.getBoundingClientRect();
      var scroll = -rect.top;                                 /* the field drifts as the page scrolls past */
      var z = t * o.speed;
      var FREQ = cell / 380;                                  /* features ~380px wide, whatever the cell size */
      var stride = cols + 2;

      pointer.x += (pointer.tx - pointer.x) * 0.12;
      pointer.y += (pointer.ty - pointer.y) * 0.12;
      pointer.p += (pointer.tp - pointer.p) * 0.06;
      var bumpR = Math.max(140, W * 0.12), bump2 = 1 / (bumpR * bumpR);

      var i, j, k;
      for (j = -1; j <= rows; j++) {
        for (i = -1; i <= cols; i++) {
          var px = (i + 0.5) * cell, py = (j + 0.5) * cell;
          var v = field(i * FREQ, j * FREQ + scroll * 0.00045, z);
          if (pointer.p > 0.01) {
            var dx = px - pointer.x, dy = py - pointer.y;
            v += 0.2 * pointer.p * Math.exp(-(dx * dx + dy * dy) * bump2);
          }
          F[(j + 1) * stride + (i + 1)] = v;
        }
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      var level = o.level;
      var dots = [], dias = [], sols = [];
      for (j = 0; j < rows; j++) {
        for (i = 0; i < cols; i++) {
          k = (j + 1) * stride + (i + 1);
          var f = F[k];
          var gx = (F[k + 1] - F[k - 1]) * 0.5, gy = (F[k + stride] - F[k - stride]) * 0.5;
          /* the cells lean away from the slope, like the wall in the preloader */
          var cx = (i + 0.5) * cell - gx * 90, cy = (j + 0.5) * cell - gy * 90;
          /* distance to the contour, in cells (field difference / slope), so
             the rings keep the same thickness wherever the field is flat */
          var d = Math.abs(f - level) / Math.max(Math.sqrt(gx * gx + gy * gy), 0.004);
          var a = 1 - smoothstep(0.6, 3.6, d);                         /* 1 on the contour, 0 far from it */
          var half = cell * (0.12 + 0.2 * a * a);                      /* half the side of the mark: ~1.6px dots up to ~8px squares */
          if (a < 0.34) {
            dots.push(cx, cy, cell * (0.12 + 0.03 * a));
          } else {
            var rot = Math.PI / 4 * (1 - smoothstep(0.55, 0.82, a));    /* diamond -> square */
            (a < 0.62 ? dias : sols).push(cx, cy, half, rot);
          }
        }
      }

      var col = rgb, A = o.alpha * (W < 700 ? 0.8 : 1);       /* a touch quieter behind the text on phones */
      ctx.lineWidth = 1;

      ctx.fillStyle = 'rgba(' + col + ',' + (0.09 * A).toFixed(3) + ')';
      ctx.beginPath();
      for (k = 0; k < dots.length; k += 3) ctx.rect(dots[k] - dots[k + 2], dots[k + 1] - dots[k + 2], dots[k + 2] * 2, dots[k + 2] * 2);
      ctx.fill();

      function poly(arr, mode) {
        ctx.beginPath();
        for (var q = 0; q < arr.length; q += 4) {
          var x = arr[q], y = arr[q + 1], r = arr[q + 2] * 1.4142, ang = arr[q + 3] + Math.PI / 4;
          for (var c = 0; c < 4; c++) {
            var aa = ang + c * Math.PI / 2, px2 = x + Math.cos(aa) * r, py2 = y + Math.sin(aa) * r;
            if (c === 0) ctx.moveTo(px2, py2); else ctx.lineTo(px2, py2);
          }
          ctx.closePath();
        }
        if (mode === 'fill') ctx.fill(); else ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(' + col + ',' + (0.17 * A).toFixed(3) + ')';
      poly(dias, 'stroke');
      ctx.fillStyle = 'rgba(' + col + ',' + (0.27 * A).toFixed(3) + ')';
      poly(sols, 'fill');
    }

    function loop(ms) {
      raf = 0;
      if (!alive || !visible) return;
      draw(ms);
      if (!reduceMotion) raf = requestAnimationFrame(loop);
    }
    function wake() { if (!raf && visible) raf = requestAnimationFrame(loop); }

    function onMove(e) {
      if (!finePointer || reduceMotion) return;
      var r = host.getBoundingClientRect();
      pointer.tx = e.clientX - r.left; pointer.ty = e.clientY - r.top;
      var inside = e.clientY >= r.top && e.clientY <= r.bottom;
      if (inside && !pointer.tp) { pointer.x = pointer.tx; pointer.y = pointer.ty; }
      pointer.tp = inside ? 1 : 0;
    }

    var ro = 'ResizeObserver' in window ? new ResizeObserver(function () { layout(); if (visible) { draw(performance.now()); wake(); } }) : null;
    var io = new IntersectionObserver(function (entries) {
      visible = entries[0].isIntersecting;
      if (visible) { layout(); draw(performance.now()); wake(); }
    }, { rootMargin: '120px 0px' });

    layout();
    if (ro) ro.observe(host);
    io.observe(host);
    window.addEventListener('pointermove', onMove, { passive: true });

    return {
      destroy: function () {
        alive = false;
        if (raf) cancelAnimationFrame(raf);
        if (ro) ro.disconnect();
        io.disconnect();
        window.removeEventListener('pointermove', onMove);
        if (layer.parentNode) layer.parentNode.removeChild(layer);
        document.documentElement.classList.remove('has-dotfield');
      }
    };
  }

  window.DotField = { mount: mount };
})();
