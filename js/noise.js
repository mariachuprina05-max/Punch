/* ==========================================================================
   Noise: animated film grain, laid over chosen blocks.

   A dependency-free port of React Bits' <Noise />, which needs React. Same
   idea and the same props: a small tile of random grey pixels is redrawn
   every few frames and tiled over a canvas, so the surface looks like it is
   alive. Instead of one fixed full-screen overlay, every target block gets
   its own layer (a canvas behind its content), so the grain can sit on
   some backgrounds and stay off others.

   Options:
     targets                 CSS selectors of the blocks that get grain
     patternSize             side of the random tile, px          (default 250)
     patternScaleX / ScaleY  stretch of the tile                  (default 1)
     patternRefreshInterval  redraw every N frames (2 = 30 fps)   (default 2)
     patternAlpha            opacity of each grain pixel, 0..255  (default 15)

   Only blocks that are on screen are drawn. With prefers-reduced-motion the
   grain is painted once and stays still.

   Noise.mount(options) -> { destroy() } (or null if nothing matched)
   ========================================================================== */
(function () {
  'use strict';

  function mount(options) {
    var o = Object.assign({
      targets: [], patternSize: 250, patternScaleX: 1, patternScaleY: 1,
      patternRefreshInterval: 2, patternAlpha: 15
    }, options || {});

    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var size = Math.max(8, Math.round(o.patternSize));

    /* one random tile, shared by every layer */
    var tile = document.createElement('canvas');
    tile.width = tile.height = size;
    var tileCtx = tile.getContext('2d');
    if (!tileCtx) return null;
    var tileData = tileCtx.createImageData(size, size);

    function refreshTile() {
      var d = tileData.data, a = o.patternAlpha;
      for (var i = 0; i < d.length; i += 4) {
        var v = Math.random() * 255;
        d[i] = d[i + 1] = d[i + 2] = v;
        d[i + 3] = a;
      }
      tileCtx.putImageData(tileData, 0, 0);
    }

    /* ---- one layer (a canvas behind the content) per target block ------- */
    var layers = [];
    o.targets.forEach(function (selector) {
      document.querySelectorAll(selector).forEach(function (host) {
        if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
        var layer = document.createElement('div');
        layer.className = 'noise-layer';
        layer.setAttribute('aria-hidden', 'true');
        var canvas = document.createElement('canvas');
        layer.appendChild(canvas);
        host.insertBefore(layer, host.firstChild);
        var ctx = canvas.getContext('2d');
        if (!ctx) { host.removeChild(layer); return; }
        layers.push({ host: host, layer: layer, canvas: canvas, ctx: ctx, visible: false, dirty: true });
      });
    });
    if (!layers.length) return null;
    document.documentElement.classList.add('has-noise');

    function fit(l) {
      var r = l.host.getBoundingClientRect();
      var w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
      if (l.canvas.width !== w || l.canvas.height !== h) {
        l.canvas.width = w; l.canvas.height = h;   /* css px: one grain pixel = one css pixel */
        l.dirty = true;
      }
    }

    function paint(l) {
      var c = l.ctx, sx = o.patternScaleX, sy = o.patternScaleY;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, l.canvas.width, l.canvas.height);
      c.setTransform(sx, 0, 0, sy, 0, 0);
      c.fillStyle = c.createPattern(tile, 'repeat');
      c.fillRect(0, 0, l.canvas.width / sx, l.canvas.height / sy);
      l.dirty = false;
    }

    function anyVisible() {
      for (var i = 0; i < layers.length; i++) if (layers[i].visible) return true;
      return false;
    }

    var frame = 0, raf = 0, alive = true;
    function loop() {
      raf = 0;
      if (!alive || !anyVisible()) return;       /* idle until something scrolls into view */
      if (frame % Math.max(1, o.patternRefreshInterval) === 0) {
        refreshTile();
        layers.forEach(function (l) { if (l.visible) paint(l); });
      }
      frame++;
      if (!reduceMotion) raf = requestAnimationFrame(loop);
    }
    function wake() { if (!raf) raf = requestAnimationFrame(loop); }

    /* ---- keep sizes right, draw only what is on screen ------------------ */
    var ro = 'ResizeObserver' in window ? new ResizeObserver(function (entries) {
      layers.forEach(function (l) { fit(l); });
      if (reduceMotion) { refreshTile(); layers.forEach(function (l) { if (l.visible) paint(l); }); }
      else wake();
    }) : null;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        layers.forEach(function (l) { if (l.host === e.target) l.visible = e.isIntersecting; });
      });
      if (reduceMotion) { refreshTile(); layers.forEach(function (l) { if (l.visible) paint(l); }); }
      else wake();
    }, { rootMargin: '80px 0px' });

    layers.forEach(function (l) {
      fit(l);
      if (ro) ro.observe(l.host);
      io.observe(l.host);
    });
    if (!ro) window.addEventListener('resize', function () { layers.forEach(fit); wake(); });

    return {
      destroy: function () {
        alive = false;
        if (raf) cancelAnimationFrame(raf);
        if (ro) ro.disconnect();
        io.disconnect();
        layers.forEach(function (l) { if (l.layer.parentNode) l.layer.parentNode.removeChild(l.layer); });
        document.documentElement.classList.remove('has-noise');
      }
    };
  }

  window.Noise = { mount: mount };
})();
