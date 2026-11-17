/* Airly — what each piece of furniture looks like.
 * Turns one furniture item (a footprint with a kind) into real-looking parts: a sofa becomes a base,
 * a backrest, armrests, seat and back cushions and legs; a bed becomes a frame, headboard, mattress, duvet
 * and pillows; and so on. The 2D plan draws the parts from above, the 3D view draws them as boxes,
 * so both always match. Purely visual: the simulation still uses the simple footprint and height.
 *
 * Parts are in plan coordinates: x, y = floor position (m), z0..z1 = height above the floor (m).
 *   { x0, y0, x1, y1, z0, z1, mat, r }      a block (r = rounded corners in the 2D plan)
 *   { disc: true, cx, cy, rad, z, mat }     a round detail, e.g. a hob ring (2D) / thin block (3D)
 *   { line: true, x0, y0, x1, y1, mat }     a 2D-only drawing line, e.g. a wardrobe rail
 */
(function () {
  'use strict';
  const Airly = window.Airly;

  // material colours [r, g, b]
  const MAT = {
    fabric: [92, 108, 138], cushion: [112, 130, 162], legs: [58, 52, 48],
    wood: [176, 132, 92], woodDark: [118, 84, 58], oak: [196, 160, 118],
    sheet: [242, 240, 234], duvet: [146, 172, 204], pillow: [252, 251, 247],
    white: [238, 236, 231], front: [226, 224, 218], plinth: [92, 92, 96], worktop: [184, 176, 162],
    steel: [170, 176, 184], black: [36, 37, 42], screen: [22, 27, 38],
    chair: [128, 94, 64], seatPad: [160, 120, 84],
    book1: [176, 64, 56], book2: [62, 104, 150], book3: [214, 170, 72], book4: [86, 132, 92],
  };

  /* Which side is the back (against the wall)? 'top' = smaller y, 'bottom', 'left' = smaller x, 'right'.
     The axis follows the footprint; within it the side nearest a wall is the back. R (rotate) cycles
     through all four directions: rot 180/270 flip the automatic choice. */
  const BACK_ON_LONG_SIDE = { sofa: 1, armchair: 1, desk: 1, wardrobe: 1, shelf: 1, kitchen: 1, fridge: 1, tv: 1 };
  const BACK_ON_SHORT_SIDE = { bed: 1, singleBed: 1 };
  function backSide(f, home) {
    if (!BACK_ON_LONG_SIDE[f.kind] && !BACK_ON_SHORT_SIDE[f.kind]) return null;
    let alongX; // true: back is the top or bottom edge
    if (Math.abs(f.w - f.d) < 0.05) alongX = !(f.rot === 90 || f.rot === 270);
    else alongX = BACK_ON_SHORT_SIDE[f.kind] ? f.w < f.d : f.w > f.d;
    const cx = f.x + f.w / 2, cy = f.y + f.d / 2;
    const r = home && Airly.store && Airly.store.roomAt ? Airly.store.roomAt(cx, cy, home, f.level || 0) : null;
    let first;
    if (alongX) {
      const top = r ? f.y - r.y : 0, bottom = r ? r.y + r.width - (f.y + f.d) : 1;
      first = top <= bottom ? 'top' : 'bottom';
    } else {
      const left = r ? f.x - r.x : 0, right = r ? r.x + r.length - (f.x + f.w) : 1;
      first = left <= right ? 'left' : 'right';
    }
    const flip = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
    return (f.rot || 0) >= 180 ? flip[first] : first;
  }

  /* Local frame: u runs along the back (0..W), v from the back (0) to the front (D). */
  function frame(f, back) {
    const side = back || 'top';
    const W = side === 'top' || side === 'bottom' ? f.w : f.d;
    const D = side === 'top' || side === 'bottom' ? f.d : f.w;
    const pt = (u, v) => {
      if (side === 'top') return [f.x + u, f.y + v];
      if (side === 'bottom') return [f.x + W - u, f.y + D - v];
      if (side === 'left') return [f.x + v, f.y + W - u];
      return [f.x + D - v, f.y + u]; // right
    };
    return { W, D, pt };
  }

  function parts(f, home) {
    const back = backSide(f, home);
    const { W, D, pt } = frame(f, back);
    const H = f.h || 0.8;
    const out = [];
    const block = (u0, v0, u1, v1, z0, z1, mat, r) => {
      const a = pt(u0, v0), b = pt(u1, v1);
      out.push({ x0: Math.min(a[0], b[0]), y0: Math.min(a[1], b[1]), x1: Math.max(a[0], b[0]), y1: Math.max(a[1], b[1]), z0, z1, mat, r: r || 0 });
    };
    const disc = (u, v, rad, z, mat) => { const c = pt(u, v); out.push({ disc: true, cx: c[0], cy: c[1], rad, z, mat }); };
    const line = (u0, v0, u1, v1, mat) => { const a = pt(u0, v0), b = pt(u1, v1); out.push({ line: true, x0: a[0], y0: a[1], x1: b[0], y1: b[1], mat }); };
    const legs = (u0, v0, u1, v1, z1, s, mat) => {
      [[u0, v0], [u1 - s, v0], [u0, v1 - s], [u1 - s, v1 - s]].forEach(([u, v]) => block(u, v, u + s, v + s, 0, z1, mat || 'legs'));
    };
    const chair = (cu, cv, facing) => {
      // a dining chair centred at (cu, cv); facing: +1 = faces the front (+v), -1 = faces the back
      const s = 0.42, half = s / 2;
      const u0 = cu - half, v0 = cv - half;
      legs(u0 + 0.02, v0 + 0.02, u0 + s - 0.02, v0 + s - 0.02, 0.43, 0.04, 'chair');
      block(u0, v0, u0 + s, v0 + s, 0.43, 0.47, 'seatPad', 0.04);
      const bv = facing > 0 ? v0 : v0 + s - 0.05;
      block(u0 + 0.02, bv, u0 + s - 0.02, bv + 0.05, 0.47, 0.9, 'chair', 0.02);
    };

    switch (f.kind) {
      case 'sofa':
      case 'armchair': {
        const arm = Math.min(0.2, W * 0.18), backD = Math.min(0.24, D * 0.28);
        legs(0.05, 0.05, W - 0.05, D - 0.05, 0.1, 0.05);
        block(0, 0, W, D, 0.1, 0.4, 'fabric', 0.04);
        block(0, 0, W, backD, 0.4, H, 'fabric', 0.06);
        block(0, 0, arm, D, 0.4, Math.min(H, 0.62), 'fabric', 0.06);
        block(W - arm, 0, W, D, 0.4, Math.min(H, 0.62), 'fabric', 0.06);
        const inner = W - 2 * arm;
        const n = f.kind === 'armchair' ? 1 : Math.max(1, Math.round(inner / 0.62));
        const cw = inner / n;
        for (let i = 0; i < n; i++) {
          const u0 = arm + i * cw + 0.015, u1 = arm + (i + 1) * cw - 0.015;
          block(u0, backD, u1, D - 0.03, 0.4, 0.52, 'cushion', 0.07); // seat cushion
          block(u0 + 0.02, backD - 0.02, u1 - 0.02, backD + 0.16, 0.52, H - 0.04, 'cushion', 0.07); // back cushion
        }
        break;
      }
      case 'bed':
      case 'singleBed': {
        legs(0.04, 0.1, W - 0.04, D - 0.04, 0.12, 0.06, 'woodDark');
        block(0, 0.06, W, D, 0.12, 0.3, 'wood', 0.03); // frame
        block(0, 0, W, 0.07, 0, 1.0, 'woodDark', 0.02); // headboard
        block(0.03, 0.08, W - 0.03, D - 0.03, 0.3, 0.5, 'sheet', 0.05); // mattress
        block(0.01, Math.min(0.62, D * 0.32), W - 0.01, D - 0.02, 0.5, 0.56, 'duvet', 0.05); // duvet
        block(0.01, D * 0.32 + 0.12, W - 0.01, D * 0.32 + 0.32, 0.56, 0.575, 'sheet', 0.04); // folded edge
        if (W >= 1.2) {
          block(0.1, 0.13, W / 2 - 0.05, 0.53, 0.5, 0.62, 'pillow', 0.1);
          block(W / 2 + 0.05, 0.13, W - 0.1, 0.53, 0.5, 0.62, 'pillow', 0.1);
        } else block(0.1, 0.13, W - 0.1, 0.5, 0.5, 0.62, 'pillow', 0.1);
        break;
      }
      case 'table': {
        // footprint used directly: long side along whichever axis is longer; chairs on the long sides
        const long = Math.max(f.w, f.d), short = Math.min(f.w, f.d);
        const alongX = f.w >= f.d;
        const P = (a, b) => (alongX ? [f.x + a, f.y + b] : [f.x + b, f.y + a]);
        const tb = (a0, b0, a1, b1, z0, z1, mat, r) => { const p = P(a0, b0), q = P(a1, b1); out.push({ x0: Math.min(p[0], q[0]), y0: Math.min(p[1], q[1]), x1: Math.max(p[0], q[0]), y1: Math.max(p[1], q[1]), z0, z1, mat, r: r || 0 }); };
        const n = Math.max(1, Math.floor(long / 0.62));
        const tchair = (a, b, faceUp) => {
          // seat half under the table edge
          const s = 0.42, a0 = a - s / 2, b0 = b - s / 2;
          [[a0 + 0.03, b0 + 0.03], [a0 + s - 0.07, b0 + 0.03], [a0 + 0.03, b0 + s - 0.07], [a0 + s - 0.07, b0 + s - 0.07]].forEach(([x, y]) => tb(x, y, x + 0.04, y + 0.04, 0, 0.43, 'chair'));
          tb(a0, b0, a0 + s, b0 + s, 0.43, 0.47, 'seatPad', 0.04);
          const bb = faceUp ? b0 + s - 0.05 : b0;
          tb(a0 + 0.03, bb, a0 + s - 0.03, bb + 0.05, 0.47, 0.9, 'chair', 0.02);
        };
        for (let i = 0; i < n; i++) {
          const a = (long / n) * (i + 0.5);
          tchair(a, -0.08, true);
          tchair(a, short + 0.08, false);
        }
        [[0.05, 0.05], [long - 0.11, 0.05], [0.05, short - 0.11], [long - 0.11, short - 0.11]].forEach(([a, b]) => tb(a, b, a + 0.06, b + 0.06, 0, 0.71, 'woodDark'));
        tb(0, 0, long, short, 0.71, 0.75, 'oak', 0.03);
        break;
      }
      case 'desk': {
        block(0, 0, 0.04, D, 0, 0.72, 'white');
        block(W - 0.04, 0, W, D, 0, 0.72, 'white');
        if (W > 0.9) block(W - 0.46, 0.02, W - 0.04, D - 0.04, 0.12, 0.72, 'front', 0.01); // drawers
        block(0, 0, W, D, 0.72, 0.75, 'oak', 0.02);
        block(W / 2 - 0.08, 0.1, W / 2 + 0.08, 0.2, 0.75, 0.8, 'black'); // monitor foot
        block(W / 2 - 0.02, 0.12, W / 2 + 0.02, 0.15, 0.8, 0.9, 'black');
        block(W / 2 - 0.28, 0.1, W / 2 + 0.28, 0.13, 0.9, 1.22, 'screen', 0.01);
        block(W / 2 - 0.22, D * 0.55, W / 2 + 0.22, D * 0.55 + 0.15, 0.75, 0.77, 'front', 0.01); // keyboard
        chair(W / 2 - (W > 0.9 ? 0.15 : 0), D + 0.1, -1);
        break;
      }
      case 'wardrobe': {
        block(0, 0, W, D, 0, H, 'wood', 0.01);
        const n = Math.max(2, Math.round(W / 0.5));
        for (let i = 0; i < n; i++) {
          const u0 = (W / n) * i + 0.01, u1 = (W / n) * (i + 1) - 0.01;
          block(u0, D - 0.02, u1, D, 0.06, H - 0.04, 'oak');
          const hu = i % 2 ? u0 + 0.05 : u1 - 0.07;
          block(hu, D, hu + 0.02, D + 0.03, H * 0.45, H * 0.6, 'steel');
        }
        // plan symbol: hanging rail with hangers
        line(0.06, D / 2, W - 0.06, D / 2, 'woodDark');
        for (let u = 0.15; u < W - 0.1; u += 0.18) line(u - 0.05, D / 2 - 0.2, u + 0.05, D / 2 + 0.2, 'woodDark');
        break;
      }
      case 'shelf': {
        const t = 0.025;
        block(0, 0, t, D, 0, H, 'wood');
        block(W - t, 0, W, D, 0, H, 'wood');
        block(t, 0, W - t, 0.015, 0, H, 'woodDark'); // back panel
        const levels = Math.max(3, Math.round(H / 0.36));
        const books = ['book1', 'book2', 'book3', 'book4'];
        for (let k = 0; k <= levels; k++) {
          const z = (H - t) * (k / levels);
          block(t, 0, W - t, D, z, z + t, 'wood');
          if (k < levels) {
            const zTop = z + t + Math.min(0.28, (H / levels) * 0.75);
            let u = t + 0.03, j = k;
            while (u < W - t - 0.12) {
              const bw = 0.12 + ((j * 7) % 5) * 0.03;
              block(u, 0.04, Math.min(u + bw, W - t - 0.02), D - 0.04, z + t, zTop - ((j * 3) % 4) * 0.025, books[j % 4]);
              u += bw + 0.02 + ((j * 5) % 3) * 0.04; j++;
            }
          }
        }
        break;
      }
      case 'kitchen': {
        block(0, 0, W, D - 0.06, 0, 0.1, 'plinth');
        block(0, 0, W, D - 0.02, 0.1, 0.86, 'white');
        const n = Math.max(1, Math.round(W / 0.6));
        for (let i = 0; i < n; i++) {
          const u0 = (W / n) * i + 0.006, u1 = (W / n) * (i + 1) - 0.006;
          block(u0, D - 0.02, u1, D, 0.12, 0.84, 'front');
          block(u0 + 0.05, D, u1 - 0.05, D + 0.02, 0.78, 0.8, 'steel'); // handle
        }
        block(-0.01, 0, W + 0.01, D + 0.02, 0.86, 0.9, 'worktop', 0.01);
        // sink with tap
        const su = Math.min(0.35, W * 0.1);
        block(su, 0.1, su + 0.55, D - 0.12, 0.9, 0.905, 'steel', 0.04);
        block(su + 0.25, 0.04, su + 0.3, 0.09, 0.9, 1.15, 'steel');
        // hob with four rings
        if (W >= 1.6) {
          const hu = W - 0.85;
          block(hu, 0.06, hu + 0.6, D - 0.06, 0.9, 0.905, 'black', 0.02);
          [[0.15, 0.18], [0.45, 0.18], [0.15, D - 0.24], [0.45, D - 0.24]].forEach(([a, b], i) => disc(hu + a, b, i % 2 ? 0.1 : 0.08, 0.906, 'steel'));
        }
        break;
      }
      case 'fridge': {
        block(0, 0, W, D - 0.03, 0, H, 'white', 0.03);
        block(0.01, D - 0.03, W - 0.01, D, 0.02, H * 0.34, 'front', 0.02); // freezer door
        block(0.01, D - 0.03, W - 0.01, D, H * 0.35, H - 0.01, 'front', 0.02); // fridge door
        block(0.06, D, 0.09, D + 0.03, H * 0.2, H * 0.31, 'steel');
        block(0.06, D, 0.09, D + 0.03, H * 0.4, H * 0.6, 'steel');
        break;
      }
      case 'tv': {
        block(0, 0, W, D, 0.05, Math.min(H, 0.5), 'woodDark', 0.02); // TV bench
        legs(0.04, 0.04, W - 0.04, D - 0.04, 0.05, 0.04);
        block(W / 2 - 0.12, D / 2 - 0.08, W / 2 + 0.12, D / 2 + 0.06, 0.5, 0.52, 'black'); // stand
        block(W / 2 - 0.03, D / 2 - 0.04, W / 2 + 0.03, D / 2 - 0.01, 0.52, 0.62, 'black');
        const tw = Math.min(W - 0.08, 1.25);
        block(W / 2 - tw / 2, D / 2 - 0.05, W / 2 + tw / 2, D / 2 - 0.01, 0.6, 0.6 + tw * 0.57, 'screen', 0.01);
        break;
      }
      default:
        block(0, 0, W, D, 0, H, 'wood', 0.03);
    }
    return out;
  }

  const rgb = (mat) => MAT[mat] || MAT.wood;
  Airly.furnitureLook = { parts, backSide, rgb, MAT };
})();
