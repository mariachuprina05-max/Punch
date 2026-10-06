/* ==========================================================================
   Punch wall: the halftone "someone is knocking through the screen" engine.

   Two canvases share one set of art data (window.PUNCH_HAND_DOTS):
   - the preloader WALL: a dark dot-grid membrane. The hands are never drawn,
     only felt: their silhouette is blurred into soft height fields that push
     the grid toward the viewer, so the dots magnify, catch light and ripple.
   - the HERO hands: the same halftone dots drawn in black over the yellow
     hero, at the exact screen spot where the wall was pushed. When the wall
     breaks, they arrive "from the impact" and settle into place.

   Controller API (used by the preloader script):
     var wall = PunchWall.mount(preloaderEl);
     wall.knock('l' | 'r', strength) -> seconds until the impact lands
     wall.tension(seconds)            -> both hands lean in harder and harder
     wall.smash(onDone)               -> final knock, the wall bursts apart
   ========================================================================== */
(function () {
  'use strict';

  var DOTS = window.PUNCH_HAND_DOTS || [];
  var ART_W = 1000;
  var ART_H = 666.67;

  /* palm centres in art units: where knocks land and ripples start */
  var HAND_C = [[170, 470], [865, 285]];

  /* which part of the figure a dot belongs to: 0 left hand, 1 right hand,
     2 head / body (leans in softly, never knocks on its own) */
  function regionOf(x, y) {
    if (x < 300 && y > 300) return 0;
    if (x > 740 && y < 430) return 1;
    return 2;
  }

  /* ---- tuning ---------------------------------------------------------- */
  var BG = '#121212';
  var HERO_MIN_W = 1024;       /* hero hands only on desktop, like the design */
  var REST_PRESS = 0.32;       /* how hard the figure leans on the wall idle  */
  var WINDUP = 0.16;           /* s: the wall relaxes before each knock lands */
  var DISP = 56;               /* px of dot slide per unit of slope           */
  var NORMAL_K = 4.2;          /* how strongly the relief catches the light   */
  var ALPHA_MAX = 0.42;        /* keeps the copy on top readable              */
  var BREAK_SPEED = 2100;      /* px/s: how fast the hole spreads from hands  */
  var TILE_LIFE = 0.6;         /* s: a wall tile's flight before it's gone    */
  var SETTLE = 0.95;           /* s: a hero dot's settle after the break      */
  var BREAK_HOLD = 0.55;       /* s: the last knock cracks it, then it breaks */
  var IDLE_PERIOD = 4.2;       /* s: one slow lean-in cycle per hand on hero  */
  var IDLE_STRENGTH = 0.5;     /* how hard they lean, vs ~1.0-1.8 for knocks  */
  var IDLE_DISP = 20;          /* px of dot slide per unit of slope on hero   */
  var ALPHA_BODY = 0.22;       /* hero dots: the soft halo of the figure ...  */
  var ALPHA_HAND = 0.5;        /* ... and the hands (Figma: black @ 60%)      */
  var PARALLAX = 16;           /* px the hands drift with the mouse           */
  var CURSOR_R = 170;          /* px: dots near the cursor make way ...       */
  var CURSOR_PUSH = 14;        /* ... by up to this much                      */

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var dpr = Math.min(window.devicePixelRatio || 1, 2);

  function now() { return performance.now() / 1000; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function hash(i) { var s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }

  /* ---- 1. height fields: halftone -> three blurred pressure maps -------- */
  var CELL = 8;
  var MW = Math.ceil(ART_W / CELL);
  var MH = Math.ceil(ART_H / CELL);
  var maps = [new Float32Array(MW * MH), new Float32Array(MW * MH), new Float32Array(MW * MH)];

  DOTS.forEach(function (d) {
    var mx = Math.floor(d[0] / CELL), my = Math.floor(d[1] / CELL);
    if (mx < 0 || my < 0 || mx >= MW || my >= MH) return;
    maps[regionOf(d[0], d[1])][my * MW + mx] += d[2] * d[2];
  });

  function boxBlur(m, r) {
    var tmp = new Float32Array(m.length), x, y, k, acc;
    for (var pass = 0; pass < 3; pass++) {
      for (y = 0; y < MH; y++) for (x = 0; x < MW; x++) {
        acc = 0;
        for (k = -r; k <= r; k++) acc += m[y * MW + clamp(x + k, 0, MW - 1)];
        tmp[y * MW + x] = acc / (2 * r + 1);
      }
      for (y = 0; y < MH; y++) for (x = 0; x < MW; x++) {
        acc = 0;
        for (k = -r; k <= r; k++) acc += tmp[clamp(y + k, 0, MH - 1) * MW + x];
        m[y * MW + x] = acc / (2 * r + 1);
      }
    }
  }

  maps.forEach(function (m, i) {
    boxBlur(m, i === 2 ? 2 : 1);   /* hands stay sharp enough to read fingers */
    var max = 0, j;
    for (j = 0; j < m.length; j++) if (m[j] > max) max = m[j];
    var gain = i === 2 ? 0.55 : 1;   /* the body only leans, the hands push */
    for (j = 0; j < m.length; j++) {
      var v = clamp(m[j] / (max * 0.75 || 1), 0, 1);
      m[j] = v * v * (3 - 2 * v) * gain;   /* smoothstep: a soft cushion */
    }
  });

  function sample(m, u, v) {
    u = u / CELL - 0.5; v = v / CELL - 0.5;
    if (u < 0 || v < 0 || u > MW - 1 || v > MH - 1) return 0;
    var x0 = Math.floor(u), y0 = Math.floor(v);
    var x1 = Math.min(x0 + 1, MW - 1), y1 = Math.min(y0 + 1, MH - 1);
    var fx = u - x0, fy = v - y0;
    var a = m[y0 * MW + x0], b = m[y0 * MW + x1], c = m[y1 * MW + x0], d = m[y1 * MW + x1];
    return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
  }

  /* ---- 2. where the artwork sits on screen ------------------------------
     Desktop: covers the hero, centred, same box the hero canvas fills.
     Mobile: scaled so both hands stay on screen in a portrait viewport. */
  function artFit(W, H) {
    var s;
    if (W >= HERO_MIN_W) {
      s = Math.max(W / ART_W, H / ART_H);
      /* nudged up so the lower hand clears the hero's bottom fade */
      return { s: s, ox: (W - ART_W * s) / 2, oy: (H - ART_H * s) / 2 - H * 0.05 };
    }
    s = W / 880;
    return { s: s, ox: W / 2 - 520 * s, oy: H * 0.5 - 360 * s };
  }

  function handScreen(fit) {
    return HAND_C.map(function (c) { return [fit.ox + c[0] * fit.s, fit.oy + c[1] * fit.s]; });
  }

  /* how far a screen point is from the nearest knocking hand: drives the
     order in which the wall breaks and the hero dots arrive */
  function nearestHand(hands, x, y) {
    var best = 1e9, bx = 0, by = 0;
    hands.forEach(function (h) {
      var dx = x - h[0], dy = y - h[1], d = Math.sqrt(dx * dx + dy * dy);
      if (d < best) { best = d; bx = dx; by = dy; }
    });
    var inv = best > 0.001 ? 1 / best : 0;
    return { d: best, ux: bx * inv, uy: by * inv };
  }

  function setupCanvas(canvas, W, H) {
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  /* shared clock: breakAt is set by smash() and read by both canvases */
  var breakAt = Infinity;
  var loops = [];
  var rafOn = false;
  function frame() {
    var t = now();
    loops = loops.filter(function (fn) { return fn(t) !== false; });
    if (loops.length) requestAnimationFrame(frame); else rafOn = false;
  }
  function addLoop(fn) {
    loops.push(fn);
    if (!rafOn) { rafOn = true; requestAnimationFrame(frame); }
  }

  /* ======================================================================
     HERO: black halftone hands on the yellow screen
     ====================================================================== */
  var hero = (function () {
    var heroEl = document.querySelector('.hero');
    if (!heroEl || !DOTS.length) return null;

    var canvas = document.createElement('canvas');
    canvas.className = 'hero__dots';
    canvas.setAttribute('aria-hidden', 'true');
    heroEl.insertBefore(canvas, heroEl.firstChild);
    document.documentElement.classList.add('dot-hands');

    /* each dot's share of the three pressure fields + their slopes, in art
       units: the hands keep leaning on the screen after they broke through */
    var N = DOTS.length;
    var hF = new Float32Array(N * 3), gxF = new Float32Array(N * 3), gyF = new Float32Array(N * 3);
    DOTS.forEach(function (d, i) {
      for (var k = 0; k < 3; k++) {
        hF[i * 3 + k] = sample(maps[k], d[0], d[1]);
        gxF[i * 3 + k] = (sample(maps[k], d[0] + CELL, d[1]) - sample(maps[k], d[0] - CELL, d[1])) / 2;
        gyF[i * 3 + k] = (sample(maps[k], d[0], d[1] + CELL) - sample(maps[k], d[0], d[1] - CELL)) / 2;
      }
    });

    /* how "hand" each dot is (0 body halo .. 1 hand): sets its opacity and
       how far it travels with the mouse (hands sit closer to the viewer) */
    var LEVELS = 6;
    var handness = new Float32Array(N), level = new Uint8Array(N);
    var fills = [];
    for (var lv = 0; lv < LEVELS; lv++) {
      fills.push('rgba(0,0,0,' + (ALPHA_BODY + (ALPHA_HAND - ALPHA_BODY) * lv / (LEVELS - 1)).toFixed(3) + ')');
    }
    DOTS.forEach(function (d, i) {
      var h = clamp((hF[i * 3] + hF[i * 3 + 1]) * 1.4, 0, 1);
      handness[i] = h;
      level[i] = Math.round(h * (LEVELS - 1));
    });
    var qx = new Float32Array(N), qy = new Float32Array(N), qr = new Float32Array(N);

    /* mouse, smoothed every frame so the figure drifts rather than snaps */
    var mouse = { x: 0, y: 0, tx: 0, ty: 0, cx: 0, cy: 0, tcx: 0, tcy: 0, s: 0, ts: 0 };
    if (window.matchMedia('(pointer: fine)').matches && !reduceMotion) {
      window.addEventListener('pointermove', function (e) {
        var r = canvas.getBoundingClientRect();
        mouse.tx = e.clientX / window.innerWidth * 2 - 1;
        mouse.ty = e.clientY / window.innerHeight * 2 - 1;
        mouse.tcx = e.clientX - r.left; mouse.tcy = e.clientY - r.top;
        if (!mouse.s) { mouse.cx = mouse.tcx; mouse.cy = mouse.tcy; }
        mouse.ts = 1;
      }, { passive: true });
      document.documentElement.addEventListener('mouseleave', function () { mouse.ts = 0; });
    }

    var ctx, W, H, fit, hands, active;
    var settling = false;
    var idleFrom = now();   /* when the idle pushing fades in */

    function layout() {
      W = heroEl.clientWidth; H = heroEl.clientHeight;
      active = window.innerWidth >= HERO_MIN_W;
      canvas.style.display = active ? '' : 'none';
      if (!active) return;
      ctx = setupCanvas(canvas, W, H);
      fit = artFit(W, H);
      hands = handScreen(fit);
    }

    /* idle: each hand slowly leans in, strains a little and eases off,
       the two out of step; far gentler than the knocks on the wall */
    function idlePush(tau) {
      tau = ((tau % IDLE_PERIOD) + IDLE_PERIOD) % IDLE_PERIOD;
      if (tau < 0.6) return Math.sin(tau / 0.6 * Math.PI / 2);            /* lean in  */
      return Math.exp(-(tau - 0.6) * 1.6);                                /* ease off */
    }
    function idleAmp(k, t) {
      var gain = reduceMotion ? 0 : clamp((t - idleFrom) / 1.5, 0, 1);
      if (!gain) return 0;
      var breathe = 0.12 * (0.5 + 0.5 * Math.sin(t * 1.5 + k * 2.1));
      if (k === 2) return gain * (breathe + 0.2 * (idlePush(t) + idlePush(t + IDLE_PERIOD / 2)) / 2);
      var p = idlePush(t + k * IDLE_PERIOD / 2);
      return gain * (breathe + IDLE_STRENGTH * p * (1 + 0.06 * Math.sin(t * 31 + k)));
    }

    function draw(t) {
      if (!active) return true;
      /* covered by the sections scrolling over it: skip the work */
      if (window.scrollY > H * 1.2) return true;

      var a0 = idleAmp(0, t), a1 = idleAmp(1, t), a2 = idleAmp(2, t);
      var px = fit.s;   /* screen px per art unit */
      var allSettled = true;

      mouse.x += (mouse.tx - mouse.x) * 0.05;
      mouse.y += (mouse.ty - mouse.y) * 0.05;
      mouse.cx += (mouse.tcx - mouse.cx) * 0.12;
      mouse.cy += (mouse.tcy - mouse.cy) * 0.12;
      mouse.s += (mouse.ts - mouse.s) * 0.06;
      var R2 = CURSOR_R * CURSOR_R;

      for (var i = 0; i < N; i++) {
        var d = DOTS[i];
        var x = fit.ox + d[0] * px, y = fit.oy + d[1] * px, r = d[2] * px;

        var j = i * 3;
        var z = a0 * hF[j] + a1 * hF[j + 1] + a2 * hF[j + 2];
        x -= (a0 * gxF[j] + a1 * gxF[j + 1] + a2 * gxF[j + 2]) * IDLE_DISP;
        y -= (a0 * gyF[j] + a1 * gyF[j + 1] + a2 * gyF[j + 2]) * IDLE_DISP;
        r *= 1 + 0.45 * z;

        /* parallax: the halo barely moves, the hands follow the mouse */
        var depth = 0.25 + 0.75 * handness[i];
        x += mouse.x * PARALLAX * depth;
        y += mouse.y * PARALLAX * 0.6 * depth;

        /* the cursor parts the dots around it, like a hand through sand */
        if (mouse.s > 0.01) {
          var cx = x - mouse.cx, cy = y - mouse.cy, c2 = cx * cx + cy * cy;
          if (c2 < R2 && c2 > 0.01) {
            var cd = Math.sqrt(c2), f = 1 - cd / CURSOR_R;
            f = f * f * mouse.s;
            x += cx / cd * f * CURSOR_PUSH; y += cy / cd * f * CURSOR_PUSH;
            r *= 1 + 0.2 * f;
          }
        }

        if (settling) {
          var n = nearestHand(hands, x, y);
          var q = clamp((t - breakAt - n.d / BREAK_SPEED + 0.08) / SETTLE, 0, 1);
          if (q < 1) allSettled = false;
          /* easeOutBack: lands with a small overshoot, like a hand that
             just punched through and pulls back to rest */
          var e = 1 + 2.70158 * Math.pow(q - 1, 3) + 1.70158 * Math.pow(q - 1, 2);
          var k = 1 - e;
          var push = 70 * Math.exp(-n.d / 700);
          x += n.ux * k * push; y += n.uy * k * push;
          r *= 1 + 0.9 * k;
        }
        qx[i] = x; qy[i] = y; qr[i] = r;
      }

      ctx.clearRect(0, 0, W, H);
      for (var lv = 0; lv < LEVELS; lv++) {
        ctx.fillStyle = fills[lv];
        ctx.beginPath();
        for (i = 0; i < N; i++) {
          if (level[i] !== lv || qr[i] <= 0) continue;
          ctx.moveTo(qx[i] + qr[i], qy[i]);
          ctx.arc(qx[i], qy[i], qr[i], 0, 6.2832);
        }
        ctx.fill();
      }
      if (settling && allSettled) settling = false;
      /* reduced motion: one static frame is all it needs */
      return !reduceMotion || settling;
    }

    layout();
    draw(now());
    window.addEventListener('resize', function () { layout(); draw(now()); });
    addLoop(draw);

    return {
      reveal: function () {
        settling = true;
        idleFrom = breakAt + SETTLE + 0.3;
      },
      hold: function () { idleFrom = Infinity; }
    };
  })();

  /* ======================================================================
     WALL: the dark membrane the hands push against
     ====================================================================== */
  function mount(root) {
    var noop = { knock: function () { return 0; }, tension: function () {}, smash: function (cb) { cb && cb(false); } };
    if (!root || !DOTS.length || reduceMotion) return noop;

    var canvas = document.createElement('canvas');
    canvas.className = 'preloader__wall';
    canvas.setAttribute('aria-hidden', 'true');
    root.insertBefore(canvas, root.firstChild);
    var ctx = canvas.getContext('2d');
    if (!ctx) return noop;

    /* the logo isn't shaken: it waits just below the fold and would peek in */
    var shakeEls = root.querySelectorAll('.preloader__text, .preloader__rotator');
    var heroEl = document.querySelector('.hero');

    var W, H, sp, n, fit, hands;
    var px, py, base, hF, gxF, gyF, delay;   /* per-dot static data */
    var ox, oy, rad, al, tn;                 /* per-dot frame data  */
    var order, bucketStart, bk;

    var knocks = [];          /* {ti, hand (0 | 1 | -1 for both), str} */
    var tension = { t0: Infinity, dur: 1 };
    var tint = 0;
    var finished = false, onDone = null;

    var A_BUCKETS = 14, T_BUCKETS = 4, NB = A_BUCKETS * T_BUCKETS;
    var colors = [];
    for (var tb = 0; tb < T_BUCKETS; tb++) for (var ab = 0; ab < A_BUCKETS; ab++) {
      var m = tb / (T_BUCKETS - 1);
      /* white -> brand yellow #FFF714 as the wall starts to give way */
      colors.push('rgba(255,' + Math.round(255 - 8 * m) + ',' + Math.round(255 - 235 * m) + ',' +
        ((ab + 0.5) / A_BUCKETS * ALPHA_MAX).toFixed(3) + ')');
    }

    function layout() {
      W = window.innerWidth; H = window.innerHeight;
      ctx = setupCanvas(canvas, W, H);
      /* the wall uses the hero's box on desktop so the bulges sit exactly
         where the hero hands will appear */
      var fw = W >= HERO_MIN_W && heroEl ? heroEl.clientWidth : W;
      var fh = W >= HERO_MIN_W && heroEl ? heroEl.clientHeight : H;
      fit = artFit(fw, fh);
      hands = handScreen(fit);

      sp = Math.max(7, Math.round(Math.sqrt(W * H / 6500)));
      var cols = Math.ceil(W / sp) + 1, rows = Math.ceil(H / sp) + 1;
      var x0 = (W - (cols - 1) * sp) / 2, y0 = (H - (rows - 1) * sp) / 2;
      n = cols * rows;

      px = new Float32Array(n); py = new Float32Array(n); base = new Float32Array(n);
      hF = new Float32Array(n * 3); gxF = new Float32Array(n * 3); gyF = new Float32Array(n * 3);
      delay = new Float32Array(n);
      ox = new Float32Array(n); oy = new Float32Array(n); rad = new Float32Array(n);
      al = new Float32Array(n); tn = new Uint8Array(n);
      order = new Uint32Array(n); bucketStart = new Uint32Array(NB + 1); bk = new Uint16Array(n);

      var step = sp / fit.s;   /* one grid step in art units */
      for (var j = 0, i = 0; j < rows; j++) for (var c = 0; c < cols; c++, i++) {
        var x = x0 + c * sp, y = y0 + j * sp;
        px[i] = x; py[i] = y;
        var u = (x - fit.ox) / fit.s, v = (y - fit.oy) / fit.s, hMax = 0;
        for (var k = 0; k < 3; k++) {
          var h = sample(maps[k], u, v);
          hF[i * 3 + k] = h;
          gxF[i * 3 + k] = (sample(maps[k], u + step, v) - sample(maps[k], u - step, v)) / 2;
          gyF[i * 3 + k] = (sample(maps[k], u, v + step) - sample(maps[k], u, v - step)) / 2;
          if (h > hMax) hMax = h;
        }
        /* texture: faint grain everywhere + a barely-there silhouette */
        base[i] = 0.05 + 0.035 * hash(i) + 0.075 * hMax;
        var nh = nearestHand(hands, x, y);
        delay[i] = nh.d / BREAK_SPEED + 0.07 * hash(i + 7);
      }
    }

    /* pressure of one hand over time: idle breathing + knocks + tension */
    function knockEnv(tau) {
      if (tau < -WINDUP) return 0;
      if (tau < 0) { var p = (tau + WINDUP) / WINDUP; return -0.35 * p * p; }   /* pull back */
      if (tau < 0.05) return -0.35 + 1.35 * (tau / 0.05);                        /* hit       */
      var e = tau - 0.05;
      return Math.exp(-e * 4.2) * Math.cos(e * 19);                              /* wobble    */
    }

    function tensionAt(t) {
      var p = clamp((t - tension.t0) / tension.dur, 0, 1);
      return p * p * (0.75 + 0.05 * Math.sin(t * 47));
    }

    function amp(k, t) {
      var a = REST_PRESS * (1 + 0.2 * Math.sin(t * 2.4 + k * 1.9)) + tensionAt(t);
      for (var i = 0; i < knocks.length; i++) {
        var kn = knocks[i];
        var env = knockEnv(t - kn.ti) * kn.str;
        if (k === 2) a += env * 0.3;                       /* the body leans in */
        else if (kn.hand === k || kn.hand === -1) a += env;
      }
      return Math.max(a, 0);
    }

    function shakeAt(t) {
      var sx = 0, sy = 0;
      for (var i = 0; i < knocks.length; i++) {
        var tau = t - knocks[i].ti;
        if (tau < 0 || tau > 0.8) continue;
        var s = knocks[i].str * 6 * Math.exp(-tau * 9);
        sx += s * Math.sin(tau * 61 + i * 2); sy += s * Math.cos(tau * 53 + i * 3);
      }
      return [sx, sy];
    }

    function draw(t) {
      var a0 = amp(0, t), a1 = amp(1, t), a2 = amp(2, t);
      var sh = shakeAt(t);
      var broken = t >= breakAt;

      /* live ripples: one ring per hand per knock */
      var rings = [];
      knocks.forEach(function (kn) {
        var tau = t - kn.ti;
        if (tau < 0 || tau > 1.6) return;
        var R = 950 * tau, w = 34 + 70 * tau, env = 0.45 * kn.str * Math.exp(-2.6 * tau);
        [0, 1].forEach(function (h) {
          if (kn.hand === h || kn.hand === -1) rings.push([hands[h][0], hands[h][1], R, w, env]);
        });
      });

      var lx = -0.52, ly = -0.6, lz = 0.6;   /* light from the top-left */
      var R0 = sp * 0.13;
      var i, k;

      for (i = 0; i < n; i++) {
        var j3 = i * 3;
        var z = a0 * hF[j3] + a1 * hF[j3 + 1] + a2 * hF[j3 + 2];
        var gx = a0 * gxF[j3] + a1 * gxF[j3 + 1] + a2 * gxF[j3 + 2];
        var gy = a0 * gyF[j3] + a1 * gyF[j3 + 1] + a2 * gyF[j3 + 2];

        for (k = 0; k < rings.length; k++) {
          var rg = rings[k];
          var dx = px[i] - rg[0], dy = py[i] - rg[1];
          var r = Math.sqrt(dx * dx + dy * dy) + 0.001;
          var q = (r - rg[2]) / rg[3];
          if (q < -3 || q > 3) continue;
          var g = Math.exp(-q * q);
          z += rg[4] * -2 * q * g;
          var dzdr = rg[4] * (-2 + 4 * q * q) * g / rg[3] * sp;   /* per grid step */
          gx += dzdr * dx / r; gy += dzdr * dy / r;
        }

        /* the membrane magnifies where it bulges: dots slide off the slope */
        ox[i] = px[i] - gx * DISP + sh[0];
        oy[i] = py[i] - gy * DISP + sh[1];

        var nx = -gx * NORMAL_K, ny = -gy * NORMAL_K;
        var lam = (nx * lx + ny * ly + lz) / Math.sqrt(nx * nx + ny * ny + 1);
        var a = base[i] * (1 + z * 1.1) + (lam - lz) * 0.55;
        rad[i] = R0 * (0.75 + 2.2 * base[i]) * (1 + z * 0.85);
        al[i] = clamp(a, 0, 1);
        tn[i] = Math.min(T_BUCKETS - 1, Math.floor(clamp(z * tint, 0, 0.999) * T_BUCKETS));
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      var allGone = true;
      if (!broken) {
        ctx.fillStyle = BG;
        ctx.fillRect(-20, -20, W + 40, H + 40);
      } else {
        /* the wall bursts into its own tiles, nearest the hands first */
        ctx.fillStyle = BG;
        ctx.beginPath();
        for (i = 0; i < n; i++) {
          var tau = t - breakAt - delay[i];
          var life = tau / TILE_LIFE;
          if (life >= 1) { al[i] = 0; continue; }
          allGone = false;
          var side = sp + 1;
          if (life > 0) {
            var e = 1 - Math.pow(1 - life, 3);
            var nh = nearestHand(hands, px[i], py[i]);
            var sc = 1 + 2.4 * e, fly = e * (90 + 140 * Math.exp(-nh.d / 600));
            ox[i] += nh.ux * fly; oy[i] += nh.uy * fly;
            rad[i] *= sc;
            al[i] *= 1 - life;
            side *= sc;
            /* fading tiles: skip the fill once mostly transparent */
            if (life > 0.55) continue;
          }
          ctx.rect(ox[i] - side / 2, oy[i] - side / 2, side, side);
        }
        ctx.fill();
      }

      /* dots, batched by colour bucket: one fill per bucket */
      bucketStart.fill(0);
      for (i = 0; i < n; i++) {
        var b = al[i] <= 0.004 ? NB : tn[i] * A_BUCKETS + Math.min(A_BUCKETS - 1, Math.floor(al[i] / ALPHA_MAX * A_BUCKETS));
        bk[i] = b;
        if (b < NB) bucketStart[b + 1]++;
      }
      for (b = 0; b < NB; b++) bucketStart[b + 1] += bucketStart[b];
      var fillPos = bucketStart.slice(0, NB);
      for (i = 0; i < n; i++) if (bk[i] < NB) order[fillPos[bk[i]]++] = i;
      for (b = 0; b < NB; b++) {
        var s0 = bucketStart[b], s1 = bucketStart[b + 1];
        if (s0 === s1) continue;
        ctx.fillStyle = colors[b];
        ctx.beginPath();
        for (var o = s0; o < s1; o++) {
          i = order[o];
          ctx.moveTo(ox[i] + rad[i], oy[i]);
          ctx.arc(ox[i], oy[i], rad[i], 0, 6.2832);
        }
        ctx.fill();
      }

      /* the copy and logo shake with the wall (CSS `translate` stacks on
         top of the transforms GSAP already animates on these elements) */
      for (i = 0; i < shakeEls.length; i++) {
        shakeEls[i].style.translate = sh[0].toFixed(2) + 'px ' + sh[1].toFixed(2) + 'px';
      }

      if (broken && allGone && !finished) {
        finished = true;
        if (onDone) onDone(true);
        return false;
      }
      return !finished;
    }

    layout();
    window.addEventListener('resize', function () { if (!finished) layout(); });
    addLoop(draw);
    if (hero) hero.hold();   /* hero hands stay still under the wall */

    return {
      /* schedule a knock; returns the seconds until it lands so the caller
         can sync the text change to the impact */
      knock: function (hand, str) {
        knocks.push({ ti: now() + WINDUP, hand: hand === 'r' ? 1 : hand === 'l' ? 0 : -1, str: str || 1 });
        if (knocks.length >= 2) tint = Math.max(tint, 0.5);   /* yellow starts to bleed through */
        return WINDUP;
      },
      tension: function (dur) {
        tension.t0 = now(); tension.dur = dur || 0.8;
        tint = 0.9;
      },
      /* the final knock: lands like the others (after the wind-up), the
         wall cracks and strains for BREAK_HOLD, then bursts */
      smash: function (cb) {
        onDone = cb;
        var t = now();
        knocks.push({ ti: t + WINDUP, hand: -1, str: 1.8 });
        tension.t0 = t + WINDUP; tension.dur = BREAK_HOLD;
        tint = 0.9;
        breakAt = t + WINDUP + BREAK_HOLD;
        setTimeout(function () {
          root.style.background = 'transparent';
          if (hero) hero.reveal();
          window.dispatchEvent(new CustomEvent('punch:reveal'));
        }, (WINDUP + BREAK_HOLD) * 1000);
        return WINDUP;
      }
    };
  }

  window.PunchWall = { mount: mount };
})();
