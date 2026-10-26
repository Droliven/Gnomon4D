"use strict";
const P = window.PAGE;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const fmt = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
const visible = new WeakMap();      // element -> currently in view

// ---------------------------------------------------------------- formulas
renderMathInElement(document.body, {delimiters: [{left: "$$", right: "$$", display: true}, {left: "\\(", right: "\\)", display: false}], throwOnError: false});

// ---------------------------------------------------------------- short videos: visible playback, bounded gallery downloads
const autoVideos = new Map();
const connection = navigator.connection;
let wantedVideos = new Set(), videoFrame = 0;
function pauseAuto(v) {
  if (v.paused) return;
  const state = autoVideos.get(v);
  if (state) state.autoPause = true;
  v.pause();
}
function releaseAuto(v) {
  pauseAuto(v);
  const state = autoVideos.get(v);
  if (state) state.downloaded = false;
  if (!v.getAttribute("src")) return;
  v.removeAttribute("src"); v.load();
}
function updateVideos() {
  const candidates = document.hidden ? [] : [...autoVideos.keys()].filter(v =>
    v.isConnected && visible.get(v) && v.getClientRects().length && !autoVideos.get(v).userPaused);
  const gallery = candidates.filter(v => v.closest("#wall"));
  const score = v => autoVideos.get(v).ratio + (v.paused ? 0 : 0.01) + (document.activeElement === v ? 2 : 0);
  const downloading = gallery.filter(v => !autoVideos.get(v).downloaded);
  downloading.sort((a, b) => score(b) - score(a));
  const slowNetwork = connection && (connection.saveData || ["slow-2g", "2g", "3g"].includes(connection.effectiveType) || (connection.downlink > 0 && connection.downlink < 3));
  const limit = slowNetwork ? 1 : matchMedia("(max-width: 820px)").matches ? 2 : 4;
  const pausedDownloads = [...autoVideos].filter(([v, state]) => v.closest("#wall") &&
    state.userPaused && !state.downloaded && v.getAttribute("src") && v.networkState === 2).length;
  wantedVideos = new Set([...candidates.filter(v => !v.closest("#wall")),
    ...gallery.filter(v => autoVideos.get(v).downloaded), ...downloading.slice(0, Math.max(0, limit - pausedDownloads))]);
  autoVideos.forEach((state, v) => {
    if (!wantedVideos.has(v)) {
      if (state.userPaused) pauseAuto(v);
      else releaseAuto(v);
      return;
    }
    if (v.dataset.src && !v.getAttribute("src")) v.src = v.dataset.src;
    if (!v.paused || state.pending) return;
    state.pending = true;
    const source = v.getAttribute("src");
    let interrupted = false;
    v.play().catch(error => { interrupted = error.name === "AbortError"; }).finally(() => {
      state.pending = false;
      if (!wantedVideos.has(v)) pauseAuto(v);
      else if (interrupted || v.getAttribute("src") !== source) queueVideos();
    });
  });
}
function queueVideos() {
  if (videoFrame) return;
  videoFrame = requestAnimationFrame(() => { videoFrame = 0; updateVideos(); });
}
const vio = new IntersectionObserver(es => es.forEach(e => {
  const v = e.target;
  const state = autoVideos.get(v);
  if (!state) return;
  state.ratio = e.intersectionRatio;
  visible.set(v, e.isIntersecting && e.intersectionRatio >= 0.2);
  queueVideos();
}), {threshold: [0, 0.2, 0.5, 0.75, 1]});
function watch(v, {controls = true, observe = true} = {}) {
  if (v.id === "film" || autoVideos.has(v)) return;
  const state = {ratio: 0, userPaused: false, autoPause: false, pending: false, downloaded: false};
  autoVideos.set(v, state);
  // Keep native autoplay off so offscreen videos cannot bypass the scheduler.
  v.autoplay = false; v.controls = controls; v.preload = "none";
  v.muted = true; v.defaultMuted = true; v.playsInline = true; v.loop = true;
  v.addEventListener("pause", () => {
    if (state.autoPause) state.autoPause = false;
    else state.userPaused = true;
    queueVideos();
  });
  v.addEventListener("play", () => { state.userPaused = false; queueVideos(); });
  v.addEventListener("playing", () => { state.autoPause = false; });
  const buffered = () => {
    if (state.downloaded) return;
    const ranges = v.buffered;
    if (Number.isFinite(v.duration) && ranges.length === 1 &&
        ranges.start(0) < 0.1 && ranges.end(ranges.length - 1) >= v.duration - 0.1) {
      state.downloaded = true;
      queueVideos();
    }
  };
  ["progress", "suspend", "canplaythrough", "timeupdate"].forEach(event => v.addEventListener(event, buffered));
  v.addEventListener("suspend", queueVideos);
  v.addEventListener("focusin", queueVideos);
  if (observe) vio.observe(v);
}
function unwatch(v) {
  releaseAuto(v); autoVideos.delete(v); wantedVideos.delete(v); vio.unobserve(v);
}
document.addEventListener("visibilitychange", updateVideos);
window.addEventListener("resize", queueVideos, {passive: true});
connection?.addEventListener("change", queueVideos);
$$("video.demo-video:not(#pipeObs), .tile video").forEach(v => watch(v));

// generic tab containers
$$("[data-tabs]").forEach(box => {
  const btns = $$(":scope > .seg button", box), panes = $$(":scope > .pane", box);
  const show = key => {
    btns.forEach((b, i) => b.classList.toggle("on", (b.dataset.t ?? i) == key));
    panes.forEach((p, i) => {
      const on = (p.dataset.p ?? String(i)) == key;
      p.classList.toggle("on", on);
      if (!on) $$("video", p).forEach(pauseAuto);
    });
    queueVideos();
    box.dispatchEvent(new CustomEvent("tab", {detail: key}));
  };
  btns.forEach(b => b.addEventListener("click", () => show(b.dataset.t)));
  box.show = show;
});

// ---------------------------------------------------------------- nav highlight
const navLinks = $$("#nav a");
const secIO = new IntersectionObserver(es => es.forEach(e => {
  if (!e.isIntersecting) return;
  const id = e.target.id;
  navLinks.forEach(a => a.classList.toggle("on", a.getAttribute("href") === "#" + id));
}), {rootMargin: "-45% 0px -50% 0px"});
$$("main > section").forEach(s => secIO.observe(s));

// reveal on scroll
const rio = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add("in"); rio.unobserve(e.target); } }), {threshold: 0.12});
$$(".sec > h2, .sec > .lede, .card, .stat, .triple, .paperfig, .film, .claim, .pipe, .gd-dom figure").forEach(e => { e.classList.add("reveal"); rio.observe(e); });

// lightbox
const lb = $("#lightbox");
$$("[data-zoom]").forEach(img => img.addEventListener("click", () => { $("img", lb).src = img.src; lb.classList.add("on"); }));
lb.addEventListener("click", () => lb.classList.remove("on"));
document.addEventListener("keydown", e => { if (e.key === "Escape") lb.classList.remove("on"); });

// ---------------------------------------------------------------- sundials: hero and brand
Sundial.mount($("#heroDial"), {mode: "hero", hour: 9});
Sundial.mount($("#brandDial"), {mode: "mini", hour: 10});

// ---------------------------------------------------------------- method diagram
(() => {
  const fig = $("#pipe"), svg = $("#pipeWires"), NS = "http://www.w3.org/2000/svg";
  const box = k => $(`[data-w="${k}"]`, fig);
  // token columns of the three experts
  $$(".tok", fig).forEach((t, li) => { for (let j = 0; j < 8; j++) { const c = el("i"); c.style.animationDelay = `${(j * 0.18 + li * 0.09).toFixed(2)}s`; t.appendChild(c); } });
  // wires: [from, to, contribution, kind]; kind h = right edge to left edge, v = bottom to top
  const W = [["obs", "lv", 0, "h"], ["obs", "lg", 0, "h"], ["obs", "la", 0, "h"], ["ins", "lv", 0, "h"], ["ins", "lg", 0, "h"], ["ins", "la", 0, "h"],
             ["hum", "lv", 3, "h"], ["hum", "lg", 3, "h"], ["lv", "ov", 0, "h"], ["lg", "og", 1, "h"], ["la", "oa", 0, "h"],
             ["lg", "ro", 2, "v"], ["ro", "la", 2, "v"]];
  function wires() {
    svg.innerHTML = "";
    if (getComputedStyle(svg).display === "none") return;
    const F = fig.getBoundingClientRect(), r = k => { const b = box(k).getBoundingClientRect(); return {l: b.left - F.left, r: b.right - F.left, t: b.top - F.top, b: b.bottom - F.top, cx: (b.left + b.right) / 2 - F.left, cy: (b.top + b.bottom) / 2 - F.top}; };
    svg.setAttribute("viewBox", `0 0 ${F.width} ${F.height}`);
    const add = (d, c, cls) => { const p = document.createElementNS(NS, "path"); p.setAttribute("d", d); p.setAttribute("class", "w " + cls); if (c) p.dataset.c = c; svg.appendChild(p); };
    W.forEach(([a, b, c, kind]) => {
      const A = r(a), B = r(b);
      if (kind === "h") { const x0 = A.r, y0 = A.cy, x1 = B.l, y1 = B.cy, m = (x0 + x1) / 2; add(`M${x0} ${y0}C${m} ${y0} ${m} ${y1} ${x1} ${y1}`, c, c ? "hot" : ""); }
      else { const x = a === "ro" ? A.cx : B.cx; add(`M${x} ${A.b}L${x} ${B.t}`, c, "hot"); }
    });
    // joint attention: one vertical link per token column across the three experts
    const cols = [box("lv"), box("lg"), box("la")].map(l => $$(".tok i", l).map(i => i.getBoundingClientRect()));
    cols[0].forEach((top, j) => { const bot = cols[2][j], x = (top.left + top.right) / 2 - F.left; add(`M${x} ${top.bottom - F.top}L${x} ${bot.top - F.top}`, 0, "ja"); });
  }
  const ro = new ResizeObserver(wires); ro.observe(fig);
  window.addEventListener("load", wires);
  // highlight one contribution at a time: on hover, otherwise cycling while in view
  const keys = $$("#pipeKeys a"); let hover = 0, cyc = 1, inview = false;
  const hl = c => { fig.classList.toggle("hl", !!c); [1, 2, 3].forEach(k => fig.classList.toggle("hl-" + k, k === c)); keys.forEach(a => a.classList.toggle("on", +a.dataset.c === c)); };
  keys.forEach(a => { a.addEventListener("mouseenter", () => { hover = +a.dataset.c; hl(hover); }); a.addEventListener("mouseleave", () => { hover = 0; hl(0); }); });
  $$("[data-c]", fig).forEach(e => { if (e.tagName === "A") { e.addEventListener("mouseenter", () => { hover = +e.dataset.c; hl(hover); }); e.addEventListener("mouseleave", () => { hover = 0; hl(0); }); } });
  new IntersectionObserver(es => { inview = es[0].isIntersecting; }, {threshold: 0.3}).observe(fig);
  let ph = 0;
  setInterval(() => { if (hover || !inview) return; ph = (ph + 1) % 8; hl(ph % 2 ? 0 : 1 + (ph / 2 | 0) % 3); }, 1700);
  // the instruction is typed in, then held
  const ins = $("#pipeInstr"), txt = P.pipe.instr; let n = 0;
  setInterval(() => { if (!inview) return; n = n > txt.length + 40 ? 0 : n + 1; ins.innerHTML = txt.slice(0, n) + (n <= txt.length ? '<span class="caret"></span>' : ""); }, 45);
  // the imagined streams follow the executed view
  const obs = $("#pipeObs"), sync = $$("video.sync", fig);
  sync.forEach(v => { v.muted = true; v.playsInline = true; v.preload = "none"; });
  obs.addEventListener("play", () => sync.forEach(v => { if (!v.getAttribute("src")) v.src = v.dataset.src; v.currentTime = obs.currentTime; v.play().catch(() => {}); }));
  obs.addEventListener("pause", () => sync.forEach(v => v.pause()));
  obs.addEventListener("emptied", () => sync.forEach(v => { if (v.getAttribute("src")) { v.pause(); v.removeAttribute("src"); v.load(); } }));
  obs.addEventListener("timeupdate", () => sync.forEach(v => { if (Math.abs(v.currentTime - obs.currentTime) > 0.15) v.currentTime = obs.currentTime; }));
  watch(obs, {observe: false});
  const pipeVisible = new Set();
  // On narrow layouts the outputs are below Observation; either end starts the group.
  const pipeIO = new IntersectionObserver(es => {
    es.forEach(e => e.isIntersecting && e.intersectionRatio >= 0.2 ? pipeVisible.add(e.target) : pipeVisible.delete(e.target));
    visible.set(obs, pipeVisible.size > 0);
    queueVideos();
  }, {threshold: [0, 0.2]});
  [obs, ...sync].forEach(v => pipeIO.observe(v));
  // action chunk: 14 joint curves denoised from noise, then a playhead runs over the 32 steps
  const cv = $("#pipeAct"), cx = cv.getContext("2d"), q = P.clock_q, noise = q.map(r => r.map(() => Math.random()));
  let t0 = performance.now();
  (function tick(t) {
    requestAnimationFrame(tick);
    if (!inview) return;
    const T = ((t - t0) / 1000) % 4.4, s = Math.max(0, 1 - T / 1.2), w = cv.width, h = cv.height;
    cx.fillStyle = "#05060e"; cx.fillRect(0, 0, w, h);
    q.forEach((row, j) => {
      cx.beginPath();
      row.forEach((v, i) => { const y = (1 - s) * v + s * noise[j][i], X = 10 + (w - 20) * i / (row.length - 1), Y = h - 10 - (h - 20) * y; i ? cx.lineTo(X, Y) : cx.moveTo(X, Y); });
      cx.strokeStyle = s > 0 ? `rgba(170,176,210,${0.3 + 0.4 * (1 - s)})` : "rgba(243,196,109,.8)"; cx.lineWidth = 1.6; cx.stroke();
    });
    if (s === 0) { const x = 10 + (w - 20) * Math.min(1, (T - 1.2) / 3); cx.fillStyle = "rgba(243,196,109,.16)"; cx.fillRect(10, 0, x - 10, h); cx.fillStyle = "#f3c46d"; cx.fillRect(x - 1, 0, 2, h); }
    if (T > 4.3) for (const r of noise) for (let i = 0; i < r.length; i++) r[i] = Math.random();
  })(0);
})();

// ---------------------------------------------------------------- GeoDelta in three domains
(() => {
  const box = $("#gdDom");
  P.gd.forEach(d => {
    const f = el("figure", "", `<div class="tri-head two"><span>${d.name}</span><span class="g">GeoDelta, t → t+4</span></div><video class="demo-video" data-src="${d.src}" poster="${d.src.replace(".mp4", ".jpg")}" muted loop playsinline></video><figcaption>${d.task} · ${d.how}</figcaption>`);
    box.appendChild(f); watch($("video", f));
  });
})();

// ---------------------------------------------------------------- film chapters
const film = $("#film"), chap = $("#chapters");
P.chapters.forEach((c, i) => {
  const b = el("button", "", `<span>${fmt(c.t)}</span>${c.name}`);
  b.addEventListener("click", () => {
    const seek = () => { film.currentTime = c.t + 0.05; };
    if (film.readyState) seek();
    else film.addEventListener("loadedmetadata", seek, {once: true});
    film.play().catch(() => {});
  });
  chap.appendChild(b);
});
film.addEventListener("timeupdate", () => {
  let k = -1;
  P.chapters.forEach((c, i) => { if (film.currentTime >= c.t) k = i; });
  $$("button", chap).forEach((b, i) => b.classList.toggle("on", i === k));
});

// ---------------------------------------------------------------- attention probe
const PROBE_SCENES = [["place_can_basket", "Place can in basket"], ["stack_blocks_two", "Stack two blocks"],
                      ["lift_pot", "Lift pot"], ["place_cans_plasticbox", "Cans into box"]];
const PROBE_NAMES = {ref: "Reference regions", alpha: "OpenWAM-Alpha", xwam: "X-WAM", ours: "Gnomon4D"};
$$(".probe").forEach(box => {
  const models = box.dataset.models.split(",");
  let scene = box.dataset.id === "p2" ? "lift_pot" : PROBE_SCENES[0][0], frame = 0, dir = 1, playing = true;
  const bar = el("div", "probe-bar"), seg = el("div", "seg");
  PROBE_SCENES.forEach(([k, n]) => {
    const b = el("button", k === scene ? "on" : "", n);
    b.addEventListener("click", () => { scene = k; $$("button", seg).forEach(x => x.classList.toggle("on", x === b)); draw(); preloadScene(); });
    seg.appendChild(b);
  });
  bar.append(seg, el("span", "note", "Cyan: contact-overlap tokens. Brighter: more attention than uniform."));
  const grid = el("div", "probe-grid");
  grid.style.gridTemplateColumns = `repeat(${models.length}, 1fr)`;
  const imgs = models.map(m => {
    const f = el("figure", m === "ours" ? "ours" : "", `<img loading="lazy" decoding="async" alt=""><figcaption>${PROBE_NAMES[m]}</figcaption>`);
    grid.appendChild(f);
    return [m, $("img", f)];
  });
  const time = el("div", "probe-time", `<button class="icon" aria-label="pause">❚❚</button><input type="range" min="0" max="8" step="1" value="0"><span class="mono">frame 1 / 9</span>`);
  const [pb, sl, lab] = [$("button", time), $("input", time), $("span", time)];
  box.append(bar, grid, time);
  function draw() {
    imgs.forEach(([m, im]) => { im.src = `assets/probe/${scene}_${m}_${frame}.jpg`; });
    sl.value = frame; lab.textContent = `frame ${frame + 1} / 9`;
  }
  sl.addEventListener("input", () => { frame = +sl.value; playing = false; pb.textContent = "▶"; draw(); });
  pb.addEventListener("click", () => { playing = !playing; pb.textContent = playing ? "❚❚" : "▶"; });
  const warmed = new Set();
  function preloadScene() {
    if (!box.inview || warmed.has(scene)) return;
    warmed.add(scene);
    models.forEach(m => { for (let f = 0; f < 9; f++) new Image().src = `assets/probe/${scene}_${m}_${f}.jpg`; });
  }
  const io = new IntersectionObserver(es => { box.inview = es[0].isIntersecting; preloadScene(); }, {threshold: 0.2});
  io.observe(box);
  setInterval(() => { if (!playing || !box.inview) return; frame += dir; if (frame >= 8 || frame <= 0) dir = -dir; draw(); }, 520);
  draw();
});

// enrichment bars (supplementary Fig. probe)
const ENRICH = {"Fast-WAM": [1.21, 2.30], "OpenWAM-Alpha": [1.52, 1.83], "X-WAM": [1.18, 1.82], "Gnomon4D": [2.42, 0.74]};
const animOnce = (node, fn, th = 0.35) => {
  const io = new IntersectionObserver(es => { if (es[0].isIntersecting) { fn(); io.disconnect(); } }, {threshold: th});
  io.observe(node);
};
$$(".enrich").forEach(box => {
  const models = box.dataset.models.split(","), withOurs = models.includes("Gnomon4D");
  const SCALE = 3.0;
  [["Interaction region", "object + embodiment within 3 cm of contact", 0, "hot",
    withOurs ? "Gnomon4D raises it to 2.42×" : "Most important for control, yet under-attended"],
   ["Rest of the arm", "embodiment away from contact", 1, "cold",
    withOurs ? "Gnomon4D lowers it below uniform" : "Over-attended"]].forEach(([t, sub, idx, cls, verdict]) => {
    const c = el("div", "card " + cls, `<h4>${t}<small>${sub}</small></h4>`);
    models.forEach(m => {
      const v = ENRICH[m][idx];
      const row = el("div", "bar" + (m === "Gnomon4D" ? " ours" : ""),
        `<span>${m}</span><div class="track"><div class="fill" data-w="${v / SCALE * 100}"></div><div class="uni" style="left:${100 / SCALE}%"></div></div><span class="v">${v.toFixed(2)}×</span>`);
      c.appendChild(row);
    });
    c.appendChild(el("p", "verdict", verdict));
    box.appendChild(c);
  });
  box.appendChild(el("p", "note", "Attention mass on a region divided by its area fraction, averaged over 50 event windows; dashed line = uniform (1×). Fast-WAM is measured on the observed frame because its action does not read the future."));
  $("p.note", box).style.gridColumn = "1 / -1";
  animOnce(box, () => $$(".fill", box).forEach(f => f.style.width = f.dataset.w + "%"));
});

// ---------------------------------------------------------------- GeoDelta construction steps
const cons = $("#construct"), steps = $$("#constructSteps li");
cons.addEventListener("timeupdate", () => {
  let k = 0;
  steps.forEach((s, i) => { if (cons.currentTime >= +s.dataset.t) k = i; });
  steps.forEach((s, i) => s.classList.toggle("on", i === k));
});
steps.forEach(s => s.addEventListener("click", () => { if (cons.getAttribute("src")) cons.currentTime = +s.dataset.t + 0.05; }));
steps[0].classList.add("on");

// ---------------------------------------------------------------- mu-law codec curve
(() => {
  const svg = $("#mulaw"), mu = 31, W = 420, H = 300, L = 46, R = 16, T = 16, B = 40;
  const X = z => L + (z + 1) / 2 * (W - L - R), Y = I => T + (1 - I / 255) * (H - T - B);
  const Ic = z => 127.5 * (1 + Math.sign(z) * Math.log(1 + mu * Math.abs(z)) / Math.log(1 + mu));
  let lin = "", cur = "";
  for (let i = 0; i <= 200; i++) { const z = -1 + i / 100; lin += `${i ? "L" : "M"}${X(z)},${Y(127.5 * (1 + z))}`; cur += `${i ? "L" : "M"}${X(z)},${Y(Ic(z))}`; }
  svg.innerHTML = `
    <g stroke="rgba(255,255,255,.08)">${[-1, -.5, 0, .5, 1].map(z => `<line x1="${X(z)}" x2="${X(z)}" y1="${T}" y2="${H - B}"/>`).join("")}
      ${[0, 64, 128, 191, 255].map(I => `<line x1="${L}" x2="${W - R}" y1="${Y(I)}" y2="${Y(I)}"/>`).join("")}</g>
    <g fill="#6f7494" font-size="12" font-family="Inter">${[-1, -.5, 0, .5, 1].map(z => `<text x="${X(z)}" y="${H - B + 18}" text-anchor="middle">${z}</text>`).join("")}
      ${[0, 128, 255].map(I => `<text x="${L - 8}" y="${Y(I) + 4}" text-anchor="end">${I}</text>`).join("")}
      <text x="${(L + W - R) / 2}" y="${H - 4}" text-anchor="middle">normalized displacement z</text></g>
    <path d="${lin}" fill="none" stroke="#6f7494" stroke-dasharray="4 4" stroke-width="1.5"/>
    <path d="${cur}" fill="none" stroke="#e8a93e" stroke-width="2.6"/>
    <text x="${X(.32)}" y="${Y(232)}" fill="#f3c46d" font-size="13" font-family="Inter">μ-law, μ = 31</text>
    <text x="${X(.42)}" y="${Y(172)}" fill="#a2a7c4" font-size="12.5" font-family="Inter">linear</text>
    <line id="muV" stroke="#f3c46d" stroke-width="1" stroke-dasharray="3 3"/><line id="muH" stroke="#f3c46d" stroke-width="1" stroke-dasharray="3 3"/>
    <circle id="muP" r="6" fill="#f3c46d" stroke="#0a0c1b" stroke-width="2"/>`;
  const inp = $("#muIn");
  const upd = () => {
    const z = +inp.value, I = Ic(z);
    $("#muP").setAttribute("cx", X(z)); $("#muP").setAttribute("cy", Y(I));
    const v = $("#muV"); v.setAttribute("x1", X(z)); v.setAttribute("x2", X(z)); v.setAttribute("y1", Y(I)); v.setAttribute("y2", H - B);
    const h = $("#muH"); h.setAttribute("x1", L); h.setAttribute("x2", X(z)); h.setAttribute("y1", Y(I)); h.setAttribute("y2", Y(I));
    $("#muZ").textContent = z.toFixed(2);
    $("#muI").textContent = `I = ${I.toFixed(1)} (linear ${(127.5 * (1 + z)).toFixed(1)})`;
    const g = Math.round(I); $("#muSw").style.background = `rgb(${g},128,128)`;
  };
  inp.addEventListener("input", upd); upd();
})();

// ---------------------------------------------------------------- denoising clock
(() => {
  const box = $("#clock"), cv = $("#cV"), cg = $("#cG"), ca = $("#cA");
  const W = 320, H = 240, imV = new Image(), imG = new Image();
  imV.src = P.clock_img.video; imG.src = P.clock_img.geodelta;     // data URIs: file:// images would taint the canvas
  const base = {}, noise = new Uint8ClampedArray(W * H * 4);
  const grab = (im, k) => { const c = document.createElement("canvas"); c.width = W; c.height = H; const x = c.getContext("2d"); x.drawImage(im, 0, 0, W, H); base[k] = x.getImageData(0, 0, W, H); };
  imV.onload = () => { grab(imV, "v"); paint(); }; imG.onload = () => { grab(imG, "g"); paint(); };
  const rnd = () => { for (let i = 0; i < noise.length; i += 4) { const a = Math.random() * 255, b = Math.random() * 255, c = Math.random() * 255; noise[i] = a; noise[i + 1] = b; noise[i + 2] = c; noise[i + 3] = 255; } };
  rnd();
  const q = P.clock_q, aN = q.map(r => r.map(() => Math.random()));
  const u = $("#clockU"), pb = $("#clockPlay");
  let playing = true, step = 0, hold = 0, inview = false;
  new IntersectionObserver(es => { inview = es[0].isIntersecting; }, {threshold: 0.2}).observe(box);
  function blend(ctx, img, s) {
    if (!img) return;
    const out = ctx.createImageData(W, H), d = out.data, b = img.data;
    for (let i = 0; i < d.length; i++) d[i] = (1 - s) * b[i] + s * noise[i];
    for (let i = 3; i < d.length; i += 4) d[i] = 255;
    ctx.putImageData(out, 0, 0);
  }
  function actions(ctx, s) {
    ctx.fillStyle = "#05060e"; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(255,255,255,.06)"; ctx.lineWidth = 1;
    for (let k = 1; k < 4; k++) { ctx.beginPath(); ctx.moveTo(0, H * k / 4); ctx.lineTo(W, H * k / 4); ctx.stroke(); }
    q.forEach((row, j) => {
      ctx.beginPath();
      row.forEach((v, i) => {
        const y = (1 - s) * v + s * aN[j][i];
        const X = 14 + (W - 28) * i / (row.length - 1), Y = H - 14 - (H - 28) * y;
        i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y);
      });
      ctx.strokeStyle = s === 0 ? `rgba(243,196,109,${0.55 + 0.03 * j})` : `rgba(170,176,210,${0.35 + 0.4 * (1 - s)})`;
      ctx.lineWidth = s === 0 ? 2 : 1.4; ctx.stroke();
    });
    ctx.fillStyle = "#a2a7c4"; ctx.font = "12px Inter"; ctx.fillText("14 joints · 32 control steps", 12, 20);
  }
  function paint() {
    const uu = step / 20, sV = 1 - uu, sG = Math.max(1 - 2 * uu, 0);
    blend(cv.getContext("2d"), base.v, sV);
    blend(cg.getContext("2d"), base.g, sG);
    actions(ca.getContext("2d"), sG);
    $("#sV").textContent = `σ = ${sV.toFixed(2)}`; $("#sG").textContent = `σ = ${sG.toFixed(2)}`; $("#sA").textContent = `σ = ${sG.toFixed(2)}`;
    $("#clockLbl").textContent = `step ${Math.floor(step)} / 20`;
    $("#ready").classList.toggle("on", step >= 10);
    u.value = step;
  }
  u.addEventListener("input", () => { step = +u.value; playing = false; pb.textContent = "▶"; paint(); });
  pb.addEventListener("click", () => { playing = !playing; pb.textContent = playing ? "❚❚" : "▶"; if (playing && step >= 20) step = 0; });
  let last = 0;
  (function tick(t) {
    requestAnimationFrame(tick);
    if (!playing || !inview || t - last < 60) return;
    last = t;
    if (step >= 20) { if (++hold > 30) { step = 0; hold = 0; } }
    else step = Math.min(20, step + 0.25);
    if (Math.random() < .5) rnd();
    paint();
  })(0);
})();

// ---------------------------------------------------------------- relative motion c and transition score r
(() => {
  const {fps, c, r} = P.relation, N = c.length, svg = $("#relChart"), vid = $("#relVid");
  const W = 1000, H = 190, T = 12, B = 26, X = n => n / (N - 1) * W, Y = v => T + (1 - v) * (H - T - B);
  let pc = "", pr = `M0,${Y(0)}`;
  c.forEach((v, n) => { pc += `${n ? "L" : "M"}${X(n).toFixed(1)},${Y(v).toFixed(1)}`; });
  r.forEach((v, n) => { pr += `L${X(n).toFixed(1)},${Y(v * 0.9).toFixed(1)}`; });
  pr += `L${W},${Y(0)}Z`;
  const ev = P.relation.events;      // gripper close / open in the demonstration
  svg.innerHTML = `
    <line x1="0" x2="${W}" y1="${Y(0)}" y2="${Y(0)}" stroke="rgba(255,255,255,.15)"/>
    <line x1="0" x2="${W}" y1="${Y(1)}" y2="${Y(1)}" stroke="rgba(255,255,255,.06)"/>
    <path d="${pr}" fill="rgba(142,162,255,.22)" stroke="#8ea2ff" stroke-width="1.2"/>
    <path d="${pc}" fill="none" stroke="#e8a93e" stroke-width="2.6" stroke-linejoin="round"/>
    ${ev.map(([n, k]) => `<g><line x1="${X(n)}" x2="${X(n)}" y1="${T}" y2="${H - B}" stroke="rgba(243,196,109,.4)" stroke-dasharray="3 4"/><text x="${X(n) + 6}" y="${H - 8}" fill="#a2a7c4" font-size="13" font-family="Inter">${k}</text></g>`).join("")}
    <line id="relHead" y1="${T - 6}" y2="${H - B}" stroke="#fff" stroke-width="1.6"/>
    <circle id="relDot" r="6" fill="#e8a93e" stroke="#0a0c1b" stroke-width="2"/>`;
  const head = $("#relHead"), dot = $("#relDot"), st = $("#relState");
  let lastFrame = -1;
  (function tick() {
    requestAnimationFrame(tick);
    if (!vid.getAttribute("src")) return;
    const n = Math.min(N - 1, Math.floor(vid.currentTime * fps));
    if (n === lastFrame) return;
    lastFrame = n;
    head.setAttribute("x1", X(n)); head.setAttribute("x2", X(n));
    dot.setAttribute("cx", X(n)); dot.setAttribute("cy", Y(c[n]));
    const hi = c[n] > 0.5;
    st.textContent = hi ? `c = ${c[n].toFixed(2)} · moving apart · read here` : `c = ${c[n].toFixed(2)} · moving together`;
    st.classList.toggle("hi", hi);
  })();
  svg.addEventListener("click", e => { const b = svg.getBoundingClientRect(); if (vid.getAttribute("src")) vid.currentTime = (e.clientX - b.left) / b.width * N / fps; });
})();

// ---------------------------------------------------------------- human / robot GeoDelta pairs
(() => {
  const box = $("#pairs"), vid = $("#pairVid"), th = $("#pairThumbs");
  watch(vid);
  let kind = "human";
  const set = p => {
    pauseAuto(vid);
    autoVideos.get(vid).userPaused = false;
    vid.poster = p.src.replace(".mp4", ".jpg");
    releaseAuto(vid);
    vid.dataset.src = p.src;
    queueVideos();
  };
  const list = () => {
    th.innerHTML = "";
    const ps = P.pairs.filter(p => p.kind === kind);
    ps.forEach((p, i) => {
      const b = el("button", i ? "" : "on", p.cap);
      b.addEventListener("click", () => { $$("button", th).forEach(x => x.classList.toggle("on", x === b)); set(p); });
      th.appendChild(b);
    });
    set(ps[0]);
  };
  $$(".seg button", box).forEach(b => b.addEventListener("click", () => {
    $$(".seg button", box).forEach(x => x.classList.toggle("on", x === b)); kind = b.dataset.k; list();
  }));
  vid.removeAttribute("src");
  list();
})();

// ---------------------------------------------------------------- bar charts
const hbars = (node, rows, lo, hi, note) => {
  rows.forEach(([n, v, o]) => node.appendChild(el("div", "hb" + (o ? " ours" : ""),
    `<span>${n}</span><div class="track"><div class="fill" data-w="${(v - lo) / (hi - lo) * 100}"></div></div><span class="v">${v.toFixed(2)}</span>`)));
  if (note) node.appendChild(el("p", "note", note));
  animOnce(node, () => $$(".fill", node).forEach(f => f.style.width = f.dataset.w + "%"), 0.2);
};
const vbars = (node, groups, series, max, delta) => {
  const g = el("div", "vgroup"), lab = el("div", "vlabels"), key = el("div", "vkey");
  groups.forEach((name, i) => {
    const col = el("div", "vg");
    series.forEach(s => col.appendChild(el("div", "b" + (s.ours ? " o" : ""), "")).dataset.h = s.vals[i] / max * 100);
    if (delta) { const d = series[1].vals[i] - series[0].vals[i]; col.appendChild(el("div", "d", (d >= 0 ? "+" : "") + d.toFixed(1))); }
    $$(".b", col).forEach((b, k) => b.title = `${series[k].name}: ${series[k].vals[i]}`);
    g.appendChild(col); lab.appendChild(el("span", "", name));
  });
  series.forEach(s => key.appendChild(el("span", "", `<i class="${s.ours ? "o" : ""}"></i>${s.name}`)));
  node.append(g, lab, key);
  const go = () => { node.classList.add("go"); $$(".b", node).forEach(b => b.style.height = b.dataset.h + "%"); };
  animOnce(node, go, 0.2);
  node.closest("[data-tabs]")?.addEventListener("tab", () => { if (node.offsetParent) go(); });
};
hbars($("#rt2bars"), [["Gnomon4D", 94.33, 1], ["Qwen-RobotManip", 93.85], ["OpenWAM-Alpha", 93.60], ["LingBot-VA 2.0", 93.60],
  ["STARRY", 93.56], ["Galaxea G-0.5", 93.28], ["MECo-WAM", 92.62], ["FlowWAM", 92.54]], 88, 95, "Average success %, axis from 88%.");
vbars($("#vlbars"), ["ID", "Cat", "CS", "Ins", "Tex", "Avg."],
  [{name: "OpenWAM-Alpha", vals: [83.4, 38.1, 58.0, 53.8, 61.4, 58.9]}, {name: "Gnomon4D", vals: [84.0, 39.1, 61.7, 59.1, 68.8, 62.5], ours: 1}], 100, true);
vbars($("#realbars"), ["In distribution", "Visual shifts"],
  [{name: "Fast-WAM", vals: [58.5, 47.0]}, {name: "X-WAM", vals: [68.5, 62.0]}, {name: "FlowWAM", vals: [75.5, 61.0]}, {name: "Gnomon4D", vals: [82.5, 78.0], ours: 1}], 100, false);

// count-up on the stat cards
$$("[data-count]").forEach(n => {
  const v = +n.dataset.count, dec = (n.dataset.count.split(".")[1] || "").length;
  animOnce(n, () => {
    const t0 = performance.now();
    (function f(t) { const p = Math.min(1, (t - t0) / 1400), e = 1 - Math.pow(1 - p, 3); n.textContent = (v * e).toFixed(dec); if (p < 1) requestAnimationFrame(f); })(t0);
  }, 0.5);
});
const bench = $("#bench");
$$(".stat").forEach(s => s.addEventListener("click", e => { e.preventDefault(); bench.show(s.dataset.go); bench.scrollIntoView({behavior: "smooth"}); }));

// ---------------------------------------------------------------- case browsers
$$(".cases").forEach(box => {
  const all = P.cases.filter(c => c.bench === box.dataset.bench);
  if (!all.length) return;
  const groups = box.dataset.groups ? box.dataset.groups.split(",").map(s => s.split(":")) : [];
  const heads = box.dataset.heads ? box.dataset.heads.split("|") : [];
  let group = groups.length ? groups[0][0] : "all", list = [], cur = 0;
  const top = el("div", "cb-top"), seg = el("div", "seg"), count = el("span", "cb-count");
  groups.forEach(([k, n], i) => {
    const b = el("button", i ? "" : "on", n);
    b.addEventListener("click", () => { group = k; $$("button", seg).forEach(x => x.classList.toggle("on", x === b)); fill(0); });
    seg.appendChild(b);
  });
  top.append(groups.length ? seg : el("span"), count);
  const wrap = el("div", "cb"), main = el("div", "cb-main"), side = el("div", "cb-list");
  if (heads.length > 1) { const h = el("div", "tri-head" + (heads.length === 2 ? " two" : "")); heads.forEach((t, i) => h.appendChild(el("span", i ? "g" : "", t))); main.appendChild(h); }
  const vid = el("video"); vid.muted = true; vid.playsInline = true; vid.preload = "none";
  const cap = el("div", "cb-cap"), ctl = el("div", "cb-ctl",
    `<button class="icon" data-a="prev" aria-label="previous">‹</button><button class="icon" data-a="pp" aria-label="Play video">▶</button><button class="icon" data-a="next" aria-label="next">›</button><input type="range" min="0" max="1000" value="0"><span class="mono">0.0 / 0.0 s</span>`);
  main.append(vid, cap, ctl);
  wrap.append(main, side);
  box.append(top, wrap);
  const [bp, bpp, bn, sc, tl] = [$("[data-a=prev]", ctl), $("[data-a=pp]", ctl), $("[data-a=next]", ctl), $("input", ctl), $(".mono", ctl)];
  function load(i) {
    cur = (i + list.length) % list.length;
    const c = list[cur];
    pauseAuto(vid);
    autoVideos.get(vid).userPaused = false;
    vid.poster = c.thumb;
    releaseAuto(vid);
    vid.dataset.src = c.src;
    sc.value = 0; tl.textContent = "0.0 / 0.0 s";
    playbackState();
    queueVideos();
    $$("button", side).forEach((b, k) => b.classList.toggle("on", k === cur));
    const okm = c.ok ? `<span class="ok">✓ success</span>` : `<span class="bad">✕ failure</span>`;
    cap.innerHTML = `<span><b>${c.task}</b>${c.instr ? " · " + (c.bench === "rt2" || c.bench === "vl" ? `<span class="instr">“${c.instr}”</span>` : c.instr) : ""}${c.tag ? ` · ${c.tag}` : ""}</span><span>${okm} · ${c.speed}</span>`;
    count.textContent = `${cur + 1} / ${list.length}`;
    const b = $$("button", side)[cur];           // scroll only the thumbnail list, never the page
    if (b && side.scrollHeight > side.clientHeight) {
      const top = b.offsetTop - side.offsetTop;
      if (top < side.scrollTop || top + b.offsetHeight > side.scrollTop + side.clientHeight) side.scrollTop = top - 8;
    }
  }
  function fill(i) {
    list = all.filter(c => group === "all" || c.group === group);
    side.innerHTML = "";
    list.forEach((c, k) => {
      const b = el("button", "", `<img loading="lazy" src="${c.thumb}" alt=""><span>${c.task}${c.bench === "real" && c.group === "ood" ? " · " + c.instr.replace("OOD · ", "") : ""}${c.group === "tex" ? " · unseen texture" : ""}</span>${c.ok ? "" : `<em class="bad">✕</em>`}`);
      b.addEventListener("click", () => load(k));
      side.appendChild(b);
    });
    load(i);
  }
  function playbackState() {
    const playing = !vid.paused && !vid.ended;
    bpp.textContent = playing ? "❚❚" : "▶";
    bpp.setAttribute("aria-label", playing ? "Pause video" : "Play video");
  }
  ["play", "pause", "ended"].forEach(event => vid.addEventListener(event, playbackState));
  vid.addEventListener("timeupdate", () => { if (vid.duration) { sc.value = vid.currentTime / vid.duration * 1000; tl.textContent = `${vid.currentTime.toFixed(1)} / ${vid.duration.toFixed(1)} s`; } });
  sc.addEventListener("input", () => { if (vid.duration) vid.currentTime = sc.value / 1000 * vid.duration; });
  bp.addEventListener("click", () => load(cur - 1)); bn.addEventListener("click", () => load(cur + 1));
  bpp.addEventListener("click", () => {
    autoVideos.get(vid).userPaused = !vid.paused;
    vid.paused ? vid.play().catch(() => {}) : vid.pause();
  });
  watch(vid, {controls: false});
  fill(0);
});

// ---------------------------------------------------------------- more-cases wall
(() => {
  const wall = $("#wall"), more = $("#wallMore"), NAMES = {rt2: "RoboTwin 2.0", vl: "VLABench", rd: "RoboDojo", real: "Real robot"};
  // round-robin over benchmarks so the first screen shows all of them: two RoboTwin, one real, one RoboDojo, one VLABench
  const by = {rt2: [], real: [], rd: [], vl: []};
  P.cases.forEach(c => { if (c.ok) by[c.bench].push(c); });
  by.rt2.sort((a, b) => (a.group === "random" ? 0 : 1) - (b.group === "random" ? 0 : 1));
  const num = c => +(c.src.match(/_(\d+)(_[a-z]+)?\.mp4$/) || [0, 0])[1];
  by.real.sort((a, b) => num(a) - num(b));          // one trial of every task before the next round
  const items = [], pat = ["rt2", "real", "rt2", "rd", "vl"], pos = {rt2: 0, real: 0, rd: 0, vl: 0};
  while (Object.keys(by).some(b => pos[b] < by[b].length)) pat.forEach(b => { if (pos[b] < by[b].length) items.push(by[b][pos[b]++]); });
  let g = "all", n = 16;
  function draw() {
    $$("video", wall).forEach(unwatch);
    wall.innerHTML = "";
    const list = items.filter(c => g === "all" || c.bench === g);
    list.slice(0, n).forEach(c => {
      const f = el("figure", c.bench, `<video muted loop playsinline preload="none" poster="${c.thumb}" data-src="${c.src}"></video><figcaption><span>${NAMES[c.bench]} · ${c.task}${c.group === "tex" ? " · unseen texture" : ""}</span><em>${c.speed}</em></figcaption>`);
      wall.appendChild(f); watch($("video", f));
    });
    more.style.display = list.length > n ? "" : "none";
  }
  $$("#wallBtns button").forEach(b => b.addEventListener("click", () => { g = b.dataset.g; n = 16; $$("#wallBtns button").forEach(x => x.classList.toggle("on", x === b)); draw(); }));
  more.addEventListener("click", () => { n += 16; draw(); });
  draw();
})();
