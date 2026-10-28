/* ==========================================================================
   PresvcsFists: the two fists of "Three ways we help brands" made of moving
   particles, the same halftone dots as the preloader and hero hands.

   When the block is scrolled into view each fist, already made of its dots,
   slides in from its side of the window, winds up and punches the spot
   where a bracket of "( STAND OUT )" will be. The brackets
   are not drawn before the hit: on impact their dots burst out of the
   contact point and settle into the bracket shape, a pressure ring runs
   through the dots, and the fists recoil to where the layout puts them.

   The positions come from the page: the (hidden) fist images and bracket
   images keep their layout boxes, so the particles end up exactly where the
   artwork used to be. Without canvas or data the images simply stay.

   PresvcsFists.mount({ target: '.presvcs' })
     -> { play(), reset(), seek(seconds), destroy() }
   ========================================================================== */
(function () {
  'use strict';

  var TAU = Math.PI * 2;

  /* timeline, seconds from the start of a fist's own clock */
  var T_SLIDE = 0.7;                  /* the fist has slid in from the edge */
  var T_WIND0 = T_SLIDE;              /* it starts to pull back */
  var T_WIND1 = T_WIND0 + 0.2;        /* ...and starts to go */
  var T_HIT   = T_WIND1 + 0.15;       /* contact */
  var T_RECOIL0 = T_HIT + 0.12;
  var T_RECOIL1 = T_RECOIL0 + 0.7;
  var STAGGER = 0.09;                 /* the right fist lands a hair after the left one */
  var BURST_DUR = 0.55;
  var T_END = 2.3;                    /* everything has settled */

  function hash(i, salt) {
    var s = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
    return s - Math.floor(s);
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function easeOutCubic(t) { var u = 1 - t; return 1 - u * u * u; }
  function easeOutQuad(t) { return 1 - (1 - t) * (1 - t); }
  function easeInCubic(t) { return t * t * t; }
  function easeOutBack(t) { var c1 = 1.70158, c3 = c1 + 1, u = t - 1; return 1 + c3 * u * u * u + c1 * u * u; }

  function resolveColor(input, fallback) {
    var value = String(input || '').trim();
    var m = value.match(/^(?:var\()?\s*(--[\w-]+)\s*\)?$/);
    if (m) value = getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim();
    return value || fallback;
  }

  function mount(options) {
    var o = Object.assign({ target: '.presvcs' }, options || {});
    var D = window.PRESVCS_DOTS;
    var host = document.querySelector(o.target);
    if (!D || !host) return null;
    var imgs = {
      fl: host.querySelector('.presvcs__fist--l'), fr: host.querySelector('.presvcs__fist--r'),
      bl: host.querySelector('.presvcs__bracket--l'), br: host.querySelector('.presvcs__bracket--r'),
      row: host.querySelector('.presvcs__standout')
    };
    if (!imgs.fl || !imgs.fr || !imgs.bl || !imgs.br || !imgs.row) return null;

    var canvas = document.createElement('canvas');
    canvas.className = 'presvcs__dots';
    canvas.setAttribute('aria-hidden', 'true');
    var ctx = canvas.getContext('2d');
    if (!ctx) return null;
    host.insertBefore(canvas, host.firstChild);   /* before the grain layer, which then lies on top */
    document.documentElement.classList.add('dot-fists');

    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var coarse = window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 768;
    var fistColor = '#FF6308';
    var bracketColor = '#E04000';

    var sides = [];        /* [left, right], see build() */
    var cvs = { x: 0, y: 0, w: 0, h: 0, dpr: 1 };
    var scale = 1;         /* page scale against the 1440 design, for px-sized effects */
    var state = 'idle';    /* idle | playing | done | seek */
    var t0 = 0, raf = 0, seekT = 0;

    /* ---------------------------------------------------------------- layout */
    function rectIn(el, hr) {
      var r = el.getBoundingClientRect();
      return { x: r.left - hr.left, y: r.top - hr.top, w: r.width, h: r.height };
    }

    function build() {
      var hr = host.getBoundingClientRect();
      var W = hr.width, H = hr.height;
      scale = Math.max(0.3, (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16) / 16);
      bracketColor = resolveColor('--c-brand-second', '#E04000');

      var rects = { fl: rectIn(imgs.fl, hr), fr: rectIn(imgs.fr, hr), bl: rectIn(imgs.bl, hr), br: rectIn(imgs.br, hr) };

      /* canvas box: all four pieces plus room to move, kept inside the block */
      var m = 60 * scale, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      Object.keys(rects).forEach(function (k) {
        var r = rects[k];
        x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h);
      });
      cvs.x = 0; cvs.w = W;
      cvs.y = Math.max(0, Math.floor(y0 - m)); cvs.h = Math.min(H, Math.ceil(y1 + m)) - cvs.y;
      cvs.dpr = Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2);
      canvas.width = Math.round(cvs.w * cvs.dpr); canvas.height = Math.round(cvs.h * cvs.dpr);
      canvas.style.left = cvs.x + 'px'; canvas.style.top = cvs.y + 'px';
      canvas.style.width = cvs.w + 'px'; canvas.style.height = cvs.h + 'px';

      sides = [
        buildSide(D.fistL, D.sizes.fistL, rects.fl, rects.bl, true, 0, W),
        buildSide(D.fistR, D.sizes.fistR, rects.fr, rects.br, false, STAGGER, W)
      ];
    }

    function buildSide(fistDots, fistSize, fr, br, isLeft, dt, W) {
      var k = fr.w / fistSize[0];                       /* image px -> page px */
      var n = fistDots.length, i;
      var side = {
        dt: dt, left: isLeft, n: n,
        bx: new Float32Array(n), by: new Float32Array(n), r: new Float32Array(n), tau: new Float32Array(n),
        slideX: 0
      };
      var cx = 0, cy = 0;
      for (i = 0; i < n; i++) {
        var d = fistDots[i];
        side.bx[i] = fr.x + d[0] * k; side.by[i] = fr.y + d[1] * k; side.r[i] = d[2] * k;
        cx += side.bx[i]; cy += side.by[i];
      }
      cx /= n; cy /= n;

      /* bracket dots: final positions in page px (the left bracket is the right one mirrored) */
      var bs = D.sizes.bracket, bk = br.h / bs[1], bn = D.bracket.length;
      side.m = bn;
      side.Bx = new Float32Array(bn); side.By = new Float32Array(bn); side.Br = new Float32Array(bn);
      side.bdelay = new Float32Array(bn); side.jit = new Float32Array(bn);
      var bcx = 0, bcy = 0;
      for (i = 0; i < bn; i++) {
        var b = D.bracket[i];
        side.Bx[i] = br.x + (isLeft ? (bs[0] - b[0]) : b[0]) * bk;
        side.By[i] = br.y + b[1] * bk;
        side.Br[i] = b[2] * bk;
        bcx += side.Bx[i]; bcy += side.By[i];
      }
      bcx /= bn; bcy /= bn;

      /* punch direction: from the fist towards its bracket */
      var ux = bcx - cx, uy = bcy - cy, ul = Math.hypot(ux, uy) || 1;
      ux /= ul; uy /= ul;
      side.ux = ux; side.uy = uy;

      /* tipness of every fist dot: 0 at the back, 1 at the knuckles */
      var pmin = Infinity, pmax = -Infinity, p;
      for (i = 0; i < n; i++) {
        p = side.bx[i] * ux + side.by[i] * uy;
        side.tau[i] = p; if (p < pmin) pmin = p; if (p > pmax) pmax = p;
      }
      for (i = 0; i < n; i++) side.tau[i] = (side.tau[i] - pmin) / (pmax - pmin || 1);

      /* how far along the punch line the fist can go before its dots touch the bracket's */
      var sHit = Infinity, hx = 0, hy = 0, j;
      for (i = 0; i < n; i++) {
        if (side.tau[i] < 0.55) continue;
        for (j = 0; j < bn; j++) {
          var wx = side.Bx[j] - side.bx[i], wy = side.By[j] - side.by[i];
          var a = wx * ux + wy * uy, perp = Math.abs(wx * uy - wy * ux);
          var rho = side.r[i] + side.Br[j];
          if (perp >= rho) continue;
          var s = a - Math.sqrt(rho * rho - perp * perp);
          if (s < sHit) {
            sHit = s;
            var fxp = side.bx[i] + ux * s, fyp = side.by[i] + uy * s, q = side.r[i] / rho;
            hx = fxp + (side.Bx[j] - fxp) * q; hy = fyp + (side.By[j] - fyp) * q;
          }
        }
      }
      if (!isFinite(sHit)) { sHit = 0; hx = bcx; hy = bcy; }

      var fw = fr.w;
      side.dHit = sHit;
      side.dRest = Math.min(0, sHit - 0.06 * fw);        /* rests off the bracket, where the layout puts it when there is room */
      side.dReady = side.dRest - 0.35 * fw;               /* gathered, pulled back */
      side.dWind = side.dReady - 0.05 * fw;               /* the wind-up */
      side.hx = hx; side.hy = hy;
      side.squish = 0.035 * fw;

      /* slide-in: the whole fist starts just outside its window edge */
      var fmin = Infinity, fmax = -Infinity;
      for (i = 0; i < n; i++) {
        var ex = side.bx[i] + ux * side.dReady;
        fmin = Math.min(fmin, ex - side.r[i]); fmax = Math.max(fmax, ex + side.r[i]);
      }
      side.slideX = isLeft ? -(fmax + 24 * scale) : (W - fmin + 24 * scale);
      /* bracket burst: dots nearest the contact point leave first */
      var dmax = 0;
      for (i = 0; i < bn; i++) dmax = Math.max(dmax, Math.hypot(side.Bx[i] - hx, side.By[i] - hy));
      for (i = 0; i < bn; i++) {
        side.bdelay[i] = 0.26 * (Math.hypot(side.Bx[i] - hx, side.By[i] - hy) / (dmax || 1)) + hash(i, 6) * 0.06;
        side.jit[i] = hash(i, 8) - 0.5;
      }
      return side;
    }

    /* -------------------------------------------------------------- drawing */
    /* how far (page px, along the punch line) the fist is from where the layout puts it */
    function offsetAt(s, t) {
      if (t < T_WIND0) return s.dReady;
      if (t < T_WIND1) return s.dReady + (s.dWind - s.dReady) * easeOutQuad((t - T_WIND0) / (T_WIND1 - T_WIND0));
      if (t < T_HIT) return s.dWind + (s.dHit - s.dWind) * easeInCubic((t - T_WIND1) / (T_HIT - T_WIND1));
      if (t < T_RECOIL0) return s.dHit;
      if (t < T_RECOIL1) return s.dHit + (s.dRest - s.dHit) * easeOutBack((t - T_RECOIL0) / (T_RECOIL1 - T_RECOIL0));
      return s.dRest;
    }

    function draw(time) {
      ctx.setTransform(cvs.dpr, 0, 0, cvs.dpr, 0, 0);
      ctx.clearRect(0, 0, cvs.w, cvs.h);
      var ox = cvs.x, oy = cvs.y, W = cvs.w, H = cvs.h;
      var ringV = 1500 * scale, ringW = 70 * scale, ringA = 9 * scale;
      var s, i, tt, d, p, e, x, y, rr, env, dx, dy, dist, g, sh;

      ctx.fillStyle = fistColor;
      ctx.beginPath();
      for (var si = 0; si < sides.length; si++) {
        s = sides[si];
        tt = time - s.dt;
        d = offsetAt(s, tt);
        var since = tt - T_HIT;
        env = since > 0 ? Math.exp(-since / 0.11) : 0;
        var slide = s.slideX * (1 - easeOutCubic(clamp(tt / T_SLIDE, 0, 1)));
        var ringR = since > 0 ? ringV * since : -1;
        var ringK = since > 0 ? ringA * Math.exp(-since / 0.4) : 0;
        for (i = 0; i < s.n; i++) {
          x = s.bx[i] + s.ux * d - ox; y = s.by[i] + s.uy * d - oy; rr = s.r[i];
          x += slide;
          if (env > 0.01) {                                  /* the knuckles flatten on impact */
            sh = s.tau[i] * s.tau[i] * s.tau[i] * env;
            x -= s.ux * s.squish * sh; y -= s.uy * s.squish * sh;
            rr *= 1 + 0.2 * sh;
          }
          if (!coarse && ringR >= 0) {                      /* pressure ring from the contact point */
            dx = x + ox - s.hx; dy = y + oy - s.hy; dist = Math.hypot(dx, dy) || 1;
            g = (dist - ringR) / ringW;
            if (g > -3 && g < 3) { g = ringK * Math.exp(-g * g) / dist; x += dx * g; y += dy * g; }
          }
          if (x + rr < 0 || x - rr > W || y + rr < 0 || y - rr > H) continue;
          ctx.moveTo(x + rr, y); ctx.arc(x, y, rr, 0, TAU);
        }
      }
      ctx.fill();

      /* the brackets exist only after the hit */
      ctx.fillStyle = bracketColor;
      ctx.beginPath();
      for (si = 0; si < sides.length; si++) {
        s = sides[si];
        tt = time - s.dt - T_HIT;
        if (tt < 0) continue;
        var ringR2 = ringV * tt, ringK2 = ringA * Math.exp(-tt / 0.4);
        for (i = 0; i < s.m; i++) {
          p = (tt - s.bdelay[i]) / BURST_DUR;
          if (p <= 0) continue;
          p = Math.min(p, 1);
          e = easeOutBack(p);
          x = s.hx + (s.Bx[i] - s.hx) * e - ox; y = s.hy + (s.By[i] - s.hy) * e - oy;
          y += s.jit[i] * 60 * scale * (1 - e);
          rr = s.Br[i] * Math.min(1, p * 4);
          if (!coarse && p >= 1) {
            dx = x + ox - s.hx; dy = y + oy - s.hy; dist = Math.hypot(dx, dy) || 1;
            g = (dist - ringR2) / ringW;
            if (g > -3 && g < 3) { g = ringK2 * 0.5 * Math.exp(-g * g) / dist; x += dx * g; y += dy * g; }
          }
          if (x + rr < 0 || x - rr > W || y + rr < 0 || y - rr > H) continue;
          ctx.moveTo(x + rr, y); ctx.arc(x, y, rr, 0, TAU);
        }
      }
      ctx.fill();
    }

    function clear() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    /* ------------------------------------------------------------ playback */
    function stopLoop() { if (raf) { cancelAnimationFrame(raf); raf = 0; } }

    function tick(now) {
      raf = 0;
      var t = (now - t0) / 1000;
      if (t >= T_END) { draw(T_END); state = 'done'; return; }
      draw(t);
      raf = requestAnimationFrame(tick);
    }

    function play() {
      if (state === 'playing' || state === 'done') return;
      stopLoop();
      if (reduceMotion) { draw(T_END); state = 'done'; return; }
      state = 'playing';
      t0 = performance.now();
      raf = requestAnimationFrame(tick);
    }

    function reset() {
      stopLoop(); state = 'idle'; clear();
    }

    function seek(t) {           /* a still frame at t seconds, for checking */
      stopLoop(); state = 'seek'; seekT = t; draw(t);
    }

    function relayout() {
      build();
      if (state === 'done') draw(T_END);
      else if (state === 'seek') draw(seekT);
      else if (state === 'idle') clear();
    }

    build();

    /* ------------------------------------------------------------- triggers */
    /* start when the "( STAND OUT )" row comes into the lower part of the window; start over when the
       block has gone back below the window */
    var ioStart = null, ioReset = null;
    if ('IntersectionObserver' in window) {
      ioStart = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { if (en.isIntersecting) play(); });
      }, { rootMargin: '0px 0px -15% 0px', threshold: 0 });
      ioStart.observe(imgs.row);
      ioReset = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting && en.boundingClientRect.top > 0 && state !== 'seek') reset();
        });
      }, { threshold: 0 });
      ioReset.observe(host);
    } else {
      play();
    }

    var ro = null;
    if ('ResizeObserver' in window) {
      var first = true;
      ro = new ResizeObserver(function () { if (first) { first = false; return; } relayout(); });
      ro.observe(host);
    }
    window.addEventListener('resize', relayout);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(relayout);

    return {
      play: play, reset: reset, seek: seek,
      destroy: function () {
        stopLoop();
        if (ioStart) ioStart.disconnect();
        if (ioReset) ioReset.disconnect();
        if (ro) ro.disconnect();
        window.removeEventListener('resize', relayout);
        document.documentElement.classList.remove('dot-fists');
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
      }
    };
  }

  window.PresvcsFists = { mount: mount };
})();
