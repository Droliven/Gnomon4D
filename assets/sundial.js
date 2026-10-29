/* Vector equatorial sundial, the same geometry as src/sundial.py (the film's opening and closing shots).
   A white-stone disc tilted parallel to the equator, a bronze rod along the polar axis, and a near sun
   circling that axis, so the rod's shadow turns 15 degrees an hour over the tick marks.
   World: x east, y north, z up; the floor is z = 0.

   Sundial.mount(svg, {mode: "hero" | "mini", hour, auto})  -> live dial drawn into an <svg>
   Sundial.icon(hour)                                          -> standalone SVG string (favicon)          */
(function () {
  "use strict";
  const rad = d => d * Math.PI / 180;
  const add = (...v) => v.reduce((a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]);
  const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const nrm = a => mul(a, 1 / Math.hypot(...a));
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));

  const LAT = rad(40);
  const N = [0, Math.cos(LAT), Math.sin(LAT)];          // disc normal = polar axis
  const E2 = [0, -Math.sin(LAT), Math.cos(LAT)];        // disc "up", toward the noon sun
  const WEST = [-1, 0, 0];
  const C = [0, 0, 1.32], R = 0.62, TK = 0.075, ROD = 0.34;
  const FACE = add(C, mul(N, TK / 2));
  const PED = [0.42, 0.42, 0.78];
  const SUN_A = 0.80, SUN_B = 1.10;
  const STONE = [236, 228, 214], STONE_SH = [118, 108, 98], PED_LIT = [74, 68, 62], PED_SH = [34, 32, 30];
  const CARVE = "rgb(150,108,52)", GOLD = "rgb(227,163,59)";

  const sunPos = h => { const H = rad(15 * (h - 12)); return add(FACE, mul(N, SUN_B), mul(E2, SUN_A * Math.cos(H)), mul(WEST, SUN_A * Math.sin(H))); };
  const rodTip = add(FACE, mul(N, ROD));
  const projOnFace = (P, S) => { const d = sub(P, S), k = dot(sub(FACE, S), N) / dot(d, N); return add(S, mul(d, k)); };
  const shadowTip = h => projOnFace(rodTip, sunPos(h));
  const f2w = (x, y, lift = 0) => add(FACE, mul(WEST, x), mul(E2, y), mul(N, lift));
  const w2f = P => { const v = sub(P, FACE); return [dot(v, WEST), dot(v, E2)]; };
  const faceAngle = P => { const [x, y] = w2f(P); return Math.atan2(x, -y); };
  const toon = (b, d, lam, soft = 0.12) => { const s = clamp((lam + 0.05) / soft); return `rgb(${d.map((v, i) => Math.round(v + (b[i] - v) * s))})`; };

  function camera(side, dist, f = 1200) {
    const ang = side * rad(34), eye = [dist * Math.sin(ang), dist * Math.cos(ang), 1.9];
    const fwd = nrm(sub([0, -0.05, 1.4], eye)), right = nrm(cross(fwd, [0, 0, 1])), up = cross(right, fwd);
    const p = P => { const q = sub(P, eye), z = Math.max(dot(q, fwd), 1e-4); return [f * dot(q, right) / z, -f * dot(q, up) / z]; };
    return {eye, fwd, p, depth: P => dot(sub(P, eye), fwd)};
  }

  const NS = "http://www.w3.org/2000/svg";
  const mk = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
  const pth = (pts, close = true) => "M" + pts.map(p => p[0].toFixed(1) + " " + p[1].toFixed(1)).join("L") + (close ? "Z" : "");
  const circlePts = (cx, cy, r, n = 96, lift = 0.002) => Array.from({length: n}, (_, k) => { const a = 2 * Math.PI * k / n; return f2w(cx + r * Math.cos(a), cy + r * Math.sin(a), lift); });

  function hull(P) {
    P = P.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const p of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (const p of P.reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  }

  function boxFaces(cam, lo, hi) {
    const [x0, y0, z0] = lo, [x1, y1, z1] = hi;
    const F = [
      [[[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], [1, 0, 0]],
      [[[x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]], [-1, 0, 0]],
      [[[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], [0, 1, 0]],
      [[[x1, y0, z0], [x0, y0, z0], [x0, y0, z1], [x1, y0, z1]], [0, -1, 0]],
      [[[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1]],
    ];
    return F.map(([q, n]) => { const m = mul(add(...q), 0.25); return {q, n, m, d: cam.depth(m), vis: dot(n, sub(cam.eye, m)) > 0}; })
      .filter(f => f.vis).sort((a, b) => b.d - a.d);
  }

  // ------------------------------------------------------------------ build
  function build(svg, mode) {
    const mini = mode === "mini";
    const cam = mini ? camera(-0.55, 2.2) : camera(-1, 3.15);
    const p = cam.p;
    svg.innerHTML = "";
    const uid = "sd" + Math.random().toString(36).slice(2, 7);
    const defs = mk("defs", {}, svg);
    defs.innerHTML = `
      <radialGradient id="${uid}sun"><stop offset="0" stop-color="rgb(255,222,160)" stop-opacity=".75"/><stop offset=".25" stop-color="rgb(255,190,110)" stop-opacity=".32"/><stop offset="1" stop-color="rgb(130,70,60)" stop-opacity="0"/></radialGradient>
      <radialGradient id="${uid}face" cx=".45" cy=".42" r=".7"><stop offset="0" stop-color="rgb(246,240,228)"/><stop offset=".8" stop-color="rgb(236,228,214)"/><stop offset="1" stop-color="rgb(222,212,196)"/></radialGradient>
      <linearGradient id="${uid}edge" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="rgb(214,205,190)"/><stop offset="1" stop-color="rgb(120,110,100)"/></linearGradient>
      <radialGradient id="${uid}bg" cx=".7" cy=".2" r="1"><stop offset="0" stop-color="#2b2350" style="stop-color: var(--dial-bg0, #2b2350)"/><stop offset="1" stop-color="#0d0f24" style="stop-color: var(--dial-bg1, #0d0f24)"/></radialGradient>
      <filter id="${uid}blur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${mini ? 0.6 : 2.2}"/></filter>
      <filter id="${uid}soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${mini ? 1 : 9}"/></filter>`;

    const rim = circlePts(0, 0, R, 160, 0);
    const back = rim.map(P => sub(P, mul(N, TK)));
    let pts = rim.concat(back).map(p);
    if (!mini) for (let h = 7.5; h <= 16.5; h += 0.5) pts.push(p(sunPos(h)));
    if (!mini) for (let k = 0; k < 24; k++) { const a = 2 * Math.PI * k / 24; pts.push(p([0.95 * Math.cos(a), 0.10 + 0.95 * Math.sin(a), 0])); }
    const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
    const pad = mini ? 120 : 60;
    const vb = [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) - Math.min(...xs) + 2 * pad, Math.max(...ys) - Math.min(...ys) + 2 * pad];
    if (mini) { const s = Math.max(vb[2], vb[3]); vb[0] -= (s - vb[2]) / 2; vb[1] -= (s - vb[3]) / 2; vb[2] = vb[3] = s; }
    svg.setAttribute("viewBox", vb.map(v => v.toFixed(1)).join(" "));
    const g = {};

    if (mini) {
      mk("rect", {x: vb[0], y: vb[1], width: vb[2], height: vb[3], rx: vb[2] * 0.22, fill: `url(#${uid}bg)`}, svg);
      g.sunDot = mk("circle", {r: vb[2] * 0.07, fill: "rgb(255,232,186)"}, svg);
      g.sunDot.setAttribute("cx", vb[0] + vb[2] * 0.17); g.sunDot.setAttribute("cy", vb[1] + vb[3] * 0.17);
      mk("circle", {cx: vb[0] + vb[2] * 0.17, cy: vb[1] + vb[3] * 0.17, r: vb[2] * 0.12, fill: "rgb(255,190,110)", opacity: 0.25}, svg);
    } else {
      g.glow = mk("circle", {r: 380, fill: `url(#${uid}sun)`}, svg);
      g.orbit = mk("g", {}, svg);
      g.orbitDots = [];
      for (let k = 0; k <= 120; k++) { const hh = 6 + 12 * k / 120, q = p(sunPos(hh)); g.orbitDots.push([hh, mk("circle", {cx: q[0], cy: q[1], r: 2, fill: GOLD}, g.orbit)]); }
      // floor rings around the pedestal
      [[1.05, .55], [1.45, .30], [1.9, .14]].forEach(([rr, al]) => {
        const q = Array.from({length: 140}, (_, k) => { const a = 2 * Math.PI * k / 140; return p([rr * Math.cos(a), 0.10 + rr * Math.sin(a), 0]); });
        mk("path", {d: pth(q), fill: "none", stroke: GOLD, "stroke-opacity": al, "stroke-width": 1.6}, svg);
      });
      g.ground = mk("path", {fill: "#000", opacity: 0.45, filter: `url(#${uid}soft)`}, svg);
      // pedestal: plinth, body, cap
      const [hx, hy, hz] = PED;
      g.ped = [];
      [[[-hx * 1.18, 0.10 - hy * 1.18, 0], [hx * 1.18, 0.10 + hy * 1.18, 0.12]],
       [[-hx, 0.10 - hy, 0.12], [hx, 0.10 + hy, hz - 0.10]],
       [[-hx * 1.12, 0.10 - hy * 1.12, hz - 0.10], [hx * 1.12, 0.10 + hy * 1.12, hz]]].forEach(([lo, hi]) =>
        boxFaces(cam, lo, hi).forEach(f => g.ped.push([f.n, mk("path", {d: pth(f.q.map(p)), stroke: GOLD, "stroke-opacity": .45, "stroke-width": 1.4}, svg)])));
      const top = p([0, 0.10, hz]), bk = p(sub(C, mul(N, TK)));
      g.post = mk("line", {x1: top[0], y1: top[1], x2: bk[0], y2: bk[1], "stroke-width": 56}, svg);
    }
    // disc: back face shows as the edge band, then the north face on top
    mk("path", {d: pth(back.map(p)), fill: `url(#${uid}edge)`}, svg);
    g.face = mk("path", {d: pth(rim.map(p)), fill: `url(#${uid}face)`}, svg);
    mk("path", {d: pth(rim.map(p), false), fill: "none", stroke: "rgb(255,236,200)", "stroke-width": mini ? 3 : 2.4, "stroke-opacity": .95}, svg);
    const carve = mk("g", {fill: "none", stroke: CARVE}, svg);
    (mini ? [[R - 0.05, 9]] : [[R - 0.03, 1.4], [R - 0.16, 1.4], [R - 0.18, 0.9], [0.07, 1.4], [0.25, 0.9]]).forEach(([rr, w]) =>
      mk("path", {d: pth(circlePts(0, 0, rr).map(p)), "stroke-width": w, stroke: mini ? GOLD : CARVE}, carve));
    g.ticks = [];
    const tickN = mini ? 12 : 96;
    for (let k = 0; k < tickN; k++) {
      const a = 2 * Math.PI * k / tickN, u = [Math.sin(a), -Math.cos(a)];
      const kk = mini ? k * 8 : k;
      const [r0, w] = kk % 8 === 0 ? [R - 0.16, 1.8] : kk % 4 === 0 ? [R - 0.125, 1.4] : [R - 0.075, 0.9];
      const P0 = f2w(r0 * u[0], r0 * u[1], 0.004), P1 = f2w((R - 0.03) * u[0], (R - 0.03) * u[1], 0.004);
      if (!mini) mk("line", {x1: p(P0)[0], y1: p(P0)[1], x2: p(P1)[0], y2: p(P1)[1], stroke: CARVE, "stroke-width": w, "stroke-linecap": "round"}, carve);
      g.ticks.push({a, P0: p(P0), P1: p(P1)});
    }
    for (let k = 0; k < 12; k++) {                        // inlaid dot at each double hour
      const a = rad(-30 * (k - 6)), rr = mini ? R - 0.17 : R - 0.205, q = p(f2w(rr * Math.sin(a), -rr * Math.cos(a), 0.003));
      mk("circle", {cx: q[0], cy: q[1], r: mini ? 9 : 5.6, fill: mini ? GOLD : CARVE}, svg);
    }
    g.trail = mk("g", {stroke: "rgb(255,214,130)", "stroke-linecap": "round"}, svg);
    if (!mini) g.ticks.forEach(t => { t.el = [mk("line", {x1: t.P0[0], y1: t.P0[1], x2: t.P1[0], y2: t.P1[1], "stroke-width": 3.4, "stroke-opacity": 0}, g.trail),
                                              mk("line", {x1: t.P0[0], y1: t.P0[1], x2: t.P1[0], y2: t.P1[1], "stroke-width": 1.5, "stroke-opacity": 0}, g.trail)]; });
    g.shadow = mk("path", {fill: "rgb(40,36,52)", opacity: mini ? 0.9 : 0.78, filter: `url(#${uid}blur)`}, svg);
    // rod along the polar axis
    const b = p(FACE), tp = p(rodTip), W = mini ? 2.6 : 1;
    mk("line", {x1: b[0], y1: b[1], x2: tp[0], y2: tp[1], stroke: "rgb(120,74,34)", "stroke-width": 9 * W, "stroke-linecap": "round"}, svg);
    mk("line", {x1: b[0], y1: b[1], x2: tp[0], y2: tp[1], stroke: "rgb(222,160,70)", "stroke-width": 6 * W, "stroke-linecap": "round"}, svg);
    if (!mini) mk("line", {x1: b[0] - 1.5, y1: b[1] - 1.5, x2: tp[0] - 1.5, y2: tp[1] - 1.5, stroke: "rgb(255,214,150)", "stroke-width": 2, "stroke-opacity": .9}, svg);
    mk("circle", {cx: tp[0], cy: tp[1], r: 6 * W, fill: "rgb(222,160,70)"}, svg);
    mk("circle", {cx: b[0], cy: b[1], r: 11 * W, fill: "rgb(120,74,34)"}, svg);
    mk("circle", {cx: b[0], cy: b[1], r: 8 * W, fill: "rgb(222,160,70)"}, svg);
    if (!mini) {
      g.sun = mk("g", {}, svg);
      mk("circle", {r: 56, fill: "rgb(255,232,186)"}, g.sun);
      mk("circle", {r: 46, fill: "rgb(255,246,222)"}, g.sun);
      g.motes = Array.from({length: 26}, (_, k) => ({u: Math.random(), v: Math.random(), s: Math.random(), ph: Math.random(), sp: Math.random(),
                                                    el: mk("circle", {fill: "rgb(255,228,170)"}, svg)}));
      // where / when call-outs, as in the film's title shot
      g.lab = mk("g", {class: "sd-lab"}, svg);
      g.lWhere = [mk("line", {stroke: GOLD, "stroke-width": 1.6}, g.lab), mk("text", {"text-anchor": "end"}, g.lab)];
      g.lWhen = [mk("line", {stroke: GOLD, "stroke-width": 1.6}, g.lab), mk("text", {"text-anchor": "end"}, g.lab)];
      g.lWhere[1].textContent = "where"; g.lWhen[1].textContent = "when";
      g.lx = Math.min(...rim.map(P => p(P)[0])) - 34;
    }
    return {cam, g, vb, mini};
  }

  // ------------------------------------------------------------------ per-frame update
  function draw(D, hour, t, alpha = 1) {
    const {cam, g, mini} = D, p = cam.p;
    const S = sunPos(hour), tip = shadowTip(hour);
    const [tx, ty] = w2f(tip), L = Math.hypot(tx, ty) || 1, dx = tx / L, dy = ty / L, nx = -dy, ny = dx;
    const k = mini ? 2.6 : 1, w0 = 0.016 * k, w1 = 0.022 * k;
    const poly = [[nx * w0, ny * w0], [tx + nx * w1, ty + ny * w1]];
    for (let i = 1; i < 10; i++) { const a = Math.PI / 2 - Math.PI * i / 10; poly.push([tx + w1 * (nx * Math.sin(a) + dx * Math.cos(a)), ty + w1 * (ny * Math.sin(a) + dy * Math.cos(a))]); }
    poly.push([tx - nx * w1, ty - ny * w1], [-nx * w0, -ny * w0]);
    g.shadow.setAttribute("d", pth(poly.map(([x, y]) => p(f2w(x, y, 0.003)))));
    g.shadow.style.opacity = (mini ? 0.9 : 0.78) * alpha;
    if (mini) return;
    const lamF = dot(N, nrm(sub(S, FACE)));
    g.face.style.filter = `brightness(${(0.92 + 0.1 * clamp(lamF / 0.5)).toFixed(3)})`;
    const sp = p(S);
    g.sun.setAttribute("transform", `translate(${sp[0].toFixed(1)} ${sp[1].toFixed(1)}) scale(${(1 + 0.035 * Math.sin(1.5 * t)).toFixed(3)})`);
    g.sun.style.opacity = alpha;
    g.glow.setAttribute("cx", sp[0]); g.glow.setAttribute("cy", sp[1]); g.glow.style.opacity = alpha;
    g.orbitDots.forEach(([hh, e]) => e.setAttribute("opacity", ((hh <= hour ? 0.55 : 0.2) * alpha).toFixed(2)));
    const Lc = nrm(sub(S, C));
    g.ped.forEach(([n, e]) => e.setAttribute("fill", toon(PED_LIT, PED_SH, dot(n, Lc))));
    g.post.setAttribute("stroke", toon(PED_LIT, PED_SH, dot([-0.7, 0.7, 0], Lc)));
    // cast shadow of pedestal and disc on the floor, from a far copy of the sun
    const Sf = add(C, mul(nrm(sub(S, C)), 9));
    const [hx, hy, hz] = PED, P = [];
    for (const z of [0, hz]) for (const sy of [-1, 1]) for (const sx of [-1, 1]) P.push([sx * hx, 0.10 + sy * hy, z]);
    for (let i = 0; i < 32; i++) { const a = 2 * Math.PI * i / 32, Q = f2w(R * Math.cos(a), R * Math.sin(a)); P.push(Q, sub(Q, mul(N, TK))); }
    const G = P.map(Q => { const kk = Sf[2] / (Sf[2] - Q[2]); return add(Sf, mul(sub(Q, Sf), kk)); }).map(Q => [Q[0], Q[1]]);
    g.ground.setAttribute("d", pth(hull(G).map(([x, y]) => p([x, y, 0]))));
    // ticks light up as the shadow passes, then fade
    const ang = faceAngle(tip);
    let lit = null;
    g.ticks.forEach((tk, i) => {
      const d = Math.atan2(Math.sin(ang - tk.a), Math.cos(ang - tk.a));
      let s = 0;
      if (d >= -0.02 && d <= 0.9) s = d >= 0 ? Math.exp(-d / 0.28) : 1 + d / 0.02;
      tk.el[0].setAttribute("stroke-opacity", (0.25 * s * alpha).toFixed(3));
      tk.el[1].setAttribute("stroke-opacity", (s * alpha).toFixed(3));
      if (i % 8 === 0 && d >= 0 && (lit === null || d < lit.d)) lit = {d, tk};
    });
    // call-outs: "where" at the shadow tip, "when" at the hour mark it last crossed
    const tpx = p(f2w(tx, ty, 0.003));
    const hm = lit ? [(lit.tk.P0[0] + lit.tk.P1[0]) / 2, (lit.tk.P0[1] + lit.tk.P1[1]) / 2] : tpx;
    const yw = Math.min(tpx[1], hm[1]) - 40, yn = Math.max(tpx[1], hm[1]) + 40;
    const put = ([ln, tx_], from, y) => { ln.setAttribute("x1", from[0] - 12); ln.setAttribute("y1", from[1]); ln.setAttribute("x2", g.lx + 10); ln.setAttribute("y2", y);
      tx_.setAttribute("x", g.lx); tx_.setAttribute("y", y + 9); };
    put(g.lWhere, tpx, yw); put(g.lWhen, hm, yn);
    const vb = D.vb;
    g.motes.forEach(m => {
      const x = vb[0] + m.u * vb[2] + 30 * Math.sin(0.35 * t + 6 * m.ph);
      const y = vb[1] + (((m.v * vb[3] - (14 + 22 * m.sp) * t) % vb[3]) + vb[3]) % vb[3];
      const tw = 0.5 + 0.5 * Math.sin(2.2 * t + 9 * m.ph);
      m.el.setAttribute("cx", x.toFixed(1)); m.el.setAttribute("cy", y.toFixed(1)); m.el.setAttribute("r", (1.2 + 2.2 * m.s).toFixed(2));
      m.el.setAttribute("opacity", ((0.25 + 0.5 * tw) * alpha).toFixed(2));
    });
  }

  // ------------------------------------------------------------------ public API
  const H0 = 7.5, H1 = 16.5, DAY = 22, FADE = 1.6;      // the sun crosses 7:30 -> 16:30 in 22 s, then a short night
  function mount(svg, opt = {}) {
    const D = build(svg, opt.mode || "hero");
    const still = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    let hour = opt.hour ?? 10, target = null, idle = 0, t0 = performance.now(), phase = (hour - H0) / (H1 - H0) * DAY, last = 0, inview = true;
    draw(D, hour, 0);
    if (still || opt.auto === false) return D;
    if (!D.mini) {
      svg.addEventListener("pointermove", e => {
        const r = svg.getBoundingClientRect();
        target = H0 + (H1 - H0) * clamp((e.clientX - r.left) / r.width); idle = performance.now();
      });
      new IntersectionObserver(es => { inview = es[0].isIntersecting; }).observe(svg);
    }
    (function tick(now) {
      requestAnimationFrame(tick);
      if (!inview || now - last < 33) return;
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      const t = (now - t0) / 1000;
      let alpha = 1;
      if (D.mini) hour = 12 + 4.5 * Math.sin(t * 2 * Math.PI / 30);
      else if (target !== null && now - idle < 2500) { hour += (target - hour) * 0.12; phase = (hour - H0) / (H1 - H0) * DAY; }
      else {
        target = null;
        phase = (phase + dt) % (DAY + FADE);
        if (phase > DAY) { alpha = 0; hour = H0; }
        else { hour = H0 + (H1 - H0) * phase / DAY; alpha = clamp(phase / FADE) * clamp((DAY - phase) / FADE); }
      }
      draw(D, hour, t, alpha);
    })(0);
    return D;
  }

  function icon(hour = 10) {
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("xmlns", NS);
    const D = build(svg, "mini");
    draw(D, hour, 0);
    return svg.outerHTML;
  }

  window.Sundial = {mount, icon};
})();
