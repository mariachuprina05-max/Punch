/* ==========================================================================
   PixelTrail: a pixel-grid cursor trail with a gooey edge.

   A dependency-free WebGL port of React Bits' <PixelTrail />, which needs
   React + three + @react-three/fiber. This site is plain HTML, so the same
   idea (a grid of square "pixels" that light up under the pointer and fade
   out, merged into blobs by a goo threshold) is done here with one tiny
   fragment shader and no build step.

   Options (same names and meaning as the React Bits props):
     gridSize      cells along the longer side of the screen   (default 40)
     trailSize     dot radius, as a fraction of that side      (default 0.1)
     maxAge        ms for a dot to fade out                    (default 250)
     interpolate   dots per radius between two pointer events  (default 5)
     color         any CSS colour, or a CSS variable name      (default #fff)
     gooey         how strongly neighbouring pixels melt into  (default 1,
                   one blob; 0 = plain squares                  0 .. 1)
     zIndex        stacking of the fixed overlay               (default 5000)

   PixelTrail.mount(options) -> { destroy() } (or null when unsupported:
   touch-only devices, reduced motion, no WebGL).
   ========================================================================== */
(function () {
  'use strict';

  var VERT = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}';

  var FRAG = [
    'precision mediump float;',
    'uniform sampler2D uTrail;',
    'uniform vec2 uRes;',      /* canvas size, device px */
    'uniform vec2 uGrid;',     /* cols, rows */
    'uniform float uCell;',    /* cell size, device px */
    'uniform vec3 uColor;',
    'uniform float uGoo;',
    'float cell(vec2 ij){',
    '  ij = clamp(ij, vec2(0.0), uGrid - 1.0);',
    '  return texture2D(uTrail, (ij + 0.5) / uGrid).r;',
    '}',
    'void main(){',
    '  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uCell;',
    '  float sq = cell(floor(p));',
    /* goo: the bilinear blend of the four nearest cell centres is a smooth
       field; thresholding it fills the corners between lit neighbours */
    '  vec2 q = p - 0.5;',
    '  vec2 b = floor(q);',
    '  vec2 f = fract(q);',
    '  float v = mix(mix(cell(b), cell(b + vec2(1.0, 0.0)), f.x),',
    '                mix(cell(b + vec2(0.0, 1.0)), cell(b + vec2(1.0, 1.0)), f.x), f.y);',
    '  float goo = smoothstep(0.4, 0.46, v) * uGoo;',
    '  float a = max(sq, goo);',
    '  gl_FragColor = vec4(uColor * a, a);',
    '}'
  ].join('\n');

  function parseColor(input) {
    var probe = document.createElement('span');
    probe.style.color = '#fff';
    var value = String(input || '#ffffff').trim();
    /* "--c-brand-second" or "var(--c-brand-second)" -> the site's token */
    var m = value.match(/^(?:var\()?\s*(--[\w-]+)\s*\)?$/);
    if (m) value = getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim() || '#ffffff';
    probe.style.color = value;
    document.body.appendChild(probe);
    var rgb = getComputedStyle(probe).color.match(/[\d.]+/g) || [255, 255, 255];
    document.body.removeChild(probe);
    return [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255];
  }

  function mount(options) {
    var o = Object.assign({
      gridSize: 40, trailSize: 0.1, maxAge: 250, interpolate: 5,
      color: '#ffffff', gooey: 1, zIndex: 5000
    }, options || {});

    /* nothing to follow on touch-only screens; respect reduced motion */
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return null;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return null;

    var canvas = document.createElement('canvas');
    canvas.className = 'pixel-trail';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.zIndex = o.zIndex;
    var gl = canvas.getContext('webgl', { alpha: true, antialias: false, premultipliedAlpha: true, powerPreference: 'high-performance' });
    if (!gl) return null;

    function shader(type, src) {
      var s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
    }
    var vs = shader(gl.VERTEX_SHADER, VERT), fs = shader(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return null;
    var prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
    gl.useProgram(prog);

    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);   /* one big triangle */
    var loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    var u = {};
    ['uTrail', 'uRes', 'uGrid', 'uCell', 'uColor', 'uGoo'].forEach(function (n) { u[n] = gl.getUniformLocation(prog, n); });

    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    var color = parseColor(o.color);
    gl.uniform3f(u.uColor, color[0], color[1], color[2]);
    gl.uniform1f(u.uGoo, Math.max(0, Math.min(1, o.gooey)));
    gl.uniform1i(u.uTrail, 0);

    var W, H, cols, rows, cell, cells, bytes;       /* cell in CSS px */
    function layout() {
      W = window.innerWidth; H = window.innerHeight;
      var dpr = Math.min(window.devicePixelRatio || 1, 1.25);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
      cell = Math.max(W, H) / o.gridSize;
      cols = Math.ceil(W / cell); rows = Math.ceil(H / cell);
      cells = new Float32Array(cols * rows);
      bytes = new Uint8Array(cols * rows);
      gl.uniform2f(u.uRes, canvas.width, canvas.height);
      gl.uniform2f(u.uGrid, cols, rows);
      gl.uniform1f(u.uCell, cell * dpr);
    }
    layout();
    document.body.appendChild(canvas);

    /* ---- the trail ------------------------------------------------------- */
    function stamp(x, y) {
      var R = o.trailSize * Math.max(W, H) / cell;          /* radius in cells */
      var cx = x / cell, cy = y / cell;
      var i0 = Math.max(0, Math.floor(cx - R)), i1 = Math.min(cols - 1, Math.ceil(cx + R));
      var j0 = Math.max(0, Math.floor(cy - R)), j1 = Math.min(rows - 1, Math.ceil(cy + R));
      for (var j = j0; j <= j1; j++) {
        for (var i = i0; i <= i1; i++) {
          var dx = i + 0.5 - cx, dy = j + 0.5 - cy;
          var d = Math.sqrt(dx * dx + dy * dy) / R;
          if (d >= 1) continue;
          var v = 1 - d;
          v = v * v * (3 - 2 * v);                          /* soft cushion */
          var k = j * cols + i;
          if (v > cells[k]) cells[k] = v;
        }
      }
    }

    var last = null, running = false, prev = 0;
    function onMove(e) {
      if (e.pointerType === 'touch') return;
      var x = e.clientX, y = e.clientY;
      if (last) {
        var R = o.trailSize * Math.max(W, H);
        var step = R / Math.max(o.interpolate, 0.1);
        var dx = x - last.x, dy = y - last.y, dist = Math.sqrt(dx * dx + dy * dy);
        var n = Math.min(60, Math.max(1, Math.ceil(dist / step)));
        for (var s = 1; s <= n; s++) stamp(last.x + dx * s / n, last.y + dy * s / n);
      } else {
        stamp(x, y);
      }
      last = { x: x, y: y };
      if (!running) { running = true; prev = performance.now(); requestAnimationFrame(frame); }
    }

    function frame(t) {
      var dt = Math.min(t - prev, 50); prev = t;
      var fade = dt / o.maxAge, alive = false;
      for (var k = 0; k < cells.length; k++) {
        var v = cells[k];
        if (v > 0) {
          v -= fade;
          if (v < 0.004) v = 0; else alive = true;
          cells[k] = v;
        }
        bytes[k] = v * 255;
      }
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (alive) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, cols, rows, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, bytes);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        requestAnimationFrame(frame);
      } else {
        running = false;     /* idle: stop drawing until the pointer moves again */
      }
    }

    function onLeave() { last = null; }
    window.addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('mouseleave', onLeave);
    window.addEventListener('resize', layout);

    return {
      destroy: function () {
        window.removeEventListener('pointermove', onMove);
        document.documentElement.removeEventListener('mouseleave', onLeave);
        window.removeEventListener('resize', layout);
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
      }
    };
  }

  window.PixelTrail = { mount: mount };
})();
