// GH Bounty — Cypherpunk lava field.
// Layered organic plasma (rolling fbm noise + drifting warm-cool bands)
// rendered at low-res and then sampled into a dense ASCII/halftone grid
// that glows, shifts, and hisses slowly like lava seen through a crt/terminal.

(function () {
  function initParticles(canvas, opts) {
    opts = opts || {};
    const ctx = canvas.getContext('2d');

    // offscreen low-res plasma buffer
    const low = document.createElement('canvas');
    const lctx = low.getContext('2d', { willReadFrequently: true });

    const state = {
      dpr: Math.min(window.devicePixelRatio || 1, 2),
      w: 0, h: 0,
      lw: 0, lh: 0,
      mouse: { x: -9999, y: -9999, tx: -9999, ty: -9999, active: false },
      intensity: opts.intensity ?? 1.0,
      speed: opts.speed ?? 1.0,
      accent: opts.accent ?? '0, 229, 209',
      running: true,
      t: 0,
      cell: 9,
      cols: 0,
      rows: 0,
      // a few sparkle glyphs that flicker in the mesh
      sparkles: [],
    };

    function resize() {
      state.w = canvas.clientWidth;
      state.h = canvas.clientHeight;
      canvas.width = state.w * state.dpr;
      canvas.height = state.h * state.dpr;
      ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
      state.cell = state.w < 700 ? 8 : 9;
      state.cols = Math.ceil(state.w / state.cell) + 1;
      state.rows = Math.ceil(state.h / state.cell) + 1;
      // low-res buffer matches cell grid
      state.lw = state.cols;
      state.lh = state.rows;
      low.width = state.lw;
      low.height = state.lh;

      state.sparkles = [];
    }
    resize();
    window.addEventListener('resize', resize);

    function onMove(e) {
      const r = canvas.getBoundingClientRect();
      const y = e.clientY - r.top;
      // disable mouse interaction within the hero section (top ~100vh)
      if (y < window.innerHeight) { state.mouse.active = false; state.mouse.tx = -9999; state.mouse.ty = -9999; return; }
      state.mouse.tx = e.clientX - r.left;
      state.mouse.ty = y;
      state.mouse.active = true;
    }
    function onLeave() { state.mouse.active = false; state.mouse.tx = -9999; state.mouse.ty = -9999; }
    const parent = canvas.parentElement;
    canvas.addEventListener('mousemove', onMove);
    if (parent) { parent.addEventListener('mousemove', onMove); parent.addEventListener('mouseleave', onLeave); }

    // noise
    function hash(x, y) { const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return h - Math.floor(h); }
    function noise2(x, y) {
      const xi = Math.floor(x), yi = Math.floor(y);
      const xf = x - xi, yf = y - yi;
      const u = xf * xf * (3 - 2 * xf);
      const v = yf * yf * (3 - 2 * yf);
      return (hash(xi,yi)*(1-u) + hash(xi+1,yi)*u)*(1-v) + (hash(xi,yi+1)*(1-u) + hash(xi+1,yi+1)*u)*v;
    }
    function fbm(x, y) {
      let v = 0, a = 0.5;
      for (let i = 0; i < 5; i++) { v += a * noise2(x, y); x *= 2.02; y *= 2.02; a *= 0.5; }
      return v;
    }

    let last = performance.now();
    function frame(now) {
      if (!state.running) return;
      const dt = Math.min(50, now - last); last = now;
      const dts = dt * 0.001;
      state.t += dts * state.speed;

      state.mouse.x += (state.mouse.tx - state.mouse.x) * 0.35;
      state.mouse.y += (state.mouse.ty - state.mouse.y) * 0.35;
      const mouseOn = state.mouse.active;
      const mx = state.mouse.x, my = state.mouse.y;

      // --- LOW-RES PLASMA PASS ---
      // compute an imageData where each "pixel" is an alpha value for that cell
      const img = lctx.createImageData(state.lw, state.lh);
      const data = img.data;
      const T = state.t;
      // precompute mouse in low-res space
      const mxL = mx / state.cell, myL = my / state.cell;
      const rowsL = state.lh, colsL = state.lw;

      for (let cy = 0; cy < rowsL; cy++) {
        for (let cx = 0; cx < colsL; cx++) {
          // scaled coords for fbm
          const sx = cx * 0.06;
          const sy = cy * 0.06;
          // two warped layers = rolling lava
          const n1 = fbm(sx + T * 0.35, sy - T * 0.25);
          const n2 = fbm(sx * 1.6 - T * 0.2 + 13.1, sy * 1.6 + T * 0.28 + 7.3);
          let v = n1 * 0.65 + n2 * 0.55;

          // domain warp swirl
          const wx = fbm(sx * 0.8 + T * 0.1, sy * 0.8 + 3.3);
          const wy = fbm(sx * 0.8 + 9.9, sy * 0.8 - T * 0.1);
          v += fbm(sx + wx * 1.3, sy + wy * 1.3) * 0.5;

          // slow breathing
          v += Math.sin(T * 0.6 + cx * 0.04 + cy * 0.05) * 0.06;

          // mouse heat
          if (mouseOn) {
            const dx = cx - mxL, dy = cy - myL;
            const d = Math.sqrt(dx*dx + dy*dy);
            v += Math.max(0, 1 - d / 26) * 0.55;
          }

          // normalize & boost
          v = Math.max(0, Math.min(1.2, (v - 0.25) * 1.2));

          const i4 = (cy * colsL + cx) * 4;
          const a = Math.min(255, v * 255 * state.intensity);
          data[i4]     = Math.round(a);         // store in R
          data[i4 + 1] = Math.round(a);         // G (reused for tier)
          data[i4 + 2] = 0;
          data[i4 + 3] = 255;
        }
      }
      lctx.putImageData(img, 0, 0);

      // --- COMPOSITE TO MAIN CANVAS ---
      // bg — deep black
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, state.w, state.h);

      // render ASCII halftone on top, reading from the low-res plasma
      const cell = state.cell;
      const fontSize = Math.round(cell * 0.95);
      ctx.font = `${fontSize}px 'JetBrains Mono', monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const accent = state.accent;
      for (let cy = 0; cy < state.rows; cy++) {
        for (let cx = 0; cx < state.cols; cx++) {
          const i4 = (cy * colsL + cx) * 4;
          const raw = data[i4] / 255;
          if (raw < 0.07) continue;

          const px = cx * cell + cell / 2;
          const py = cy * cell + cell / 2;

          // glyph tier based on density — halftone feel
          let ch;
          if (raw > 0.85) ch = '●';
          else if (raw > 0.55) ch = '•';
          else ch = '·';

          // flicker
          const flick = 0.88 + 0.12 * Math.sin(state.t * 3 + cx * 0.33 + cy * 0.27);
          // dim overall so background stays deep black
          const a = Math.min(0.85, (0.08 + raw * 0.55) * flick);

          if (raw > 0.92) {
            ctx.fillStyle = `rgba(180, 240, 232, ${a})`;
          } else {
            ctx.fillStyle = `rgba(${accent}, ${a})`;
          }
          ctx.fillText(ch, px, py);
        }
      }



      // mouse tight halo
      if (mouseOn) {
        const g = ctx.createRadialGradient(mx, my, 0, mx, my, 120);
        g.addColorStop(0, `rgba(${accent}, ${0.18 * state.intensity})`);
        g.addColorStop(1, `rgba(${accent}, 0)`);
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = g;
        ctx.fillRect(mx - 130, my - 130, 260, 260);
        ctx.globalCompositeOperation = 'source-over';
      }

      // strong vignette to push edges to pure black
      const vg = ctx.createRadialGradient(state.w/2, state.h/2, Math.min(state.w, state.h)*0.2, state.w/2, state.h/2, Math.max(state.w, state.h)*0.75);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,0.92)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, state.w, state.h);

      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    return {
      setIntensity: (v) => (state.intensity = v),
      setSpeed: (v) => (state.speed = v),
      setAccent: (rgb) => (state.accent = rgb),
      destroy: () => { state.running = false; },
    };
  }

  window.initParticles = initParticles;
})();
