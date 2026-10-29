"use strict";
const P = window.PAGE;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const fmt = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
const visible = new WeakMap();      // element -> currently in view
const interleave = (arr, key) => {  // round-robin over key(c), first-seen key order
  const b = new Map(); arr.forEach(c => { const k = key(c); if (!b.has(k)) b.set(k, []); b.get(k).push(c); });
  const q = [...b.values()], out = [];
  for (let i = 0; out.length < arr.length; i++) q.forEach(l => { if (i < l.length) out.push(l[i]); });
  return out;
};
// real-robot trials: every visual shift and every task show up within the first few entries
const SHIFT = ["In distribution", "OOD · Distractors", "OOD · Appearance", "OOD · Tablecloth", "OOD · Lighting"];
const realOrder = cs => interleave(SHIFT.flatMap(s => interleave(cs.filter(c => c.instr === s), c => c.task)), c => c.instr);
const shiftLabel = c => c.bench === "real" && c.group === "ood" ? " · " + c.instr.replace("OOD · ", "") : "";

// ---------------------------------------------------------------- color theme: light by default, the reader's choice is remembered
const root = document.documentElement, COL = {};
const readTheme = () => { const s = getComputedStyle(root); ["canvas", "canvas-ink", "gold", "gold2", "line", "bar"].forEach(k => { COL[k] = s.getPropertyValue("--" + k).trim(); }); };
readTheme();
$("#themeBtn").addEventListener("click", () => {
  const next = root.dataset.theme === "dark" ? "light" : "dark";
  root.dataset.theme = next;
  try { localStorage.setItem("g4-theme", next); } catch (e) {}
  setIconTheme(next);
  readTheme();
  document.dispatchEvent(new Event("themechange"));
});

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

// ---------------------------------------------------------------- reading position: cover, progress bar, top nav and contents rail
(() => {
  const rail = $("#rail"), navLinks = $$("#nav a"), prog = $("#prog"), cover = $("#top"), coverIn = $("#coverIn");
  const marks = $$("[data-toc]");
  const links = marks.map(m => {
    const sub = !m.matches("main > section");
    const a = el("a", sub ? "subl" : "top", m.dataset.toc);
    a.href = "#" + m.id;
    rail.appendChild(a);
    return a;
  });
  const chapterOf = m => m.closest("main > section");
  let frame = 0;
  function update() {
    frame = 0;
    const y = scrollY, vh = innerHeight;
    document.body.classList.toggle("on-cover", y < cover.offsetHeight * 0.55);
    const k = Math.min(1, y / (cover.offsetHeight * 0.7));
    coverIn.style.opacity = (1 - k).toFixed(3);
    coverIn.style.transform = k ? `translateY(${(-60 * k).toFixed(1)}px) scale(${(1 - 0.04 * k).toFixed(4)})` : "";
    prog.style.width = (100 * y / Math.max(1, document.documentElement.scrollHeight - vh)).toFixed(2) + "%";
    let cur = -1;
    marks.forEach((m, i) => { if (m.getBoundingClientRect().top < vh * 0.38) cur = i; });
    const chap = cur >= 0 ? chapterOf(marks[cur]) : null;
    links.forEach((a, i) => { a.classList.toggle("on", i === cur); a.classList.toggle("in", !!chap && chapterOf(marks[i]) === chap); });
    navLinks.forEach(a => a.classList.toggle("on", !!chap && a.getAttribute("href") === "#" + chap.id));
  }
  const queue = () => { if (!frame) frame = requestAnimationFrame(update); };
  addEventListener("scroll", queue, {passive: true});
  addEventListener("resize", queue, {passive: true});
  update();
})();

// reveal on scroll
const rio = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add("in"); rio.unobserve(e.target); } }), {threshold: 0.08});
$$(".card, .stat, .triple, .paperfig, .film, .pipe, .routes, .gd-dom figure, .media-card").forEach(e => { e.classList.add("reveal"); rio.observe(e); });

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
  const keys = $$("#pipeKeys [data-c]"); let hover = 0, inview = false;
  const hl = c => { fig.classList.toggle("hl", !!c); [1, 2, 3].forEach(k => fig.classList.toggle("hl-" + k, k === c)); keys.forEach(a => a.classList.toggle("on", +a.dataset.c === c)); };
  [...keys, ...$$(".lane[data-c], .readout, .p-human", fig)].forEach(a => {
    a.addEventListener("mouseenter", () => { hover = +a.dataset.c; hl(hover); });
    a.addEventListener("mouseleave", () => { hover = 0; hl(0); });
  });
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
    cx.globalAlpha = 1; cx.fillStyle = COL.canvas; cx.fillRect(0, 0, w, h);
    q.forEach((row, j) => {
      cx.beginPath();
      row.forEach((v, i) => { const y = (1 - s) * v + s * noise[j][i], X = 10 + (w - 20) * i / (row.length - 1), Y = h - 10 - (h - 20) * y; i ? cx.lineTo(X, Y) : cx.moveTo(X, Y); });
      cx.strokeStyle = s > 0 ? COL["canvas-ink"] : COL.gold; cx.globalAlpha = s > 0 ? 0.3 + 0.4 * (1 - s) : 0.85; cx.lineWidth = 1.6; cx.stroke();
    });
    cx.globalAlpha = 1;
    if (s === 0) { const x = 10 + (w - 20) * Math.min(1, (T - 1.2) / 3); cx.globalAlpha = 0.16; cx.fillStyle = COL.gold; cx.fillRect(10, 0, x - 10, h); cx.globalAlpha = 1; cx.fillRect(x - 1, 0, 2, h); }
    if (T > 4.3) for (const r of noise) for (let i = 0; i < r.length; i++) r[i] = Math.random();
  })(0);
})();

// ---------------------------------------------------------------- GeoDelta in three domains
(() => {
  // one three-view player; the domains follow each other, a click holds one
  const box = $("#gdDom"), seg = el("div", "seg");
  const f = el("figure", "", `<div class="tri-head"><span>RGB</span><span class="g">GeoDelta · point tracks, t → t+4</span><span class="g">GeoDelta · encoded video</span></div><video muted loop playsinline></video><figcaption></figcaption>`);
  const vid = $("video", f), cap = $("figcaption", f);
  vid.style.aspectRatio = "1440 / 360";
  box.append(seg, f);
  watch(vid);
  let cur = 0, held = false, lastT = 0;
  const show = i => {
    cur = i;
    const d = P.gd[i];
    $$("button", seg).forEach((b, k) => b.classList.toggle("on", k === i));
    pauseAuto(vid); autoVideos.get(vid).userPaused = false; releaseAuto(vid);
    vid.poster = d.src.replace(".mp4", ".jpg"); vid.dataset.src = d.src; lastT = 0;
    cap.innerHTML = `<span><b>${d.name}</b> · ${d.task}</span><span>motion from ${d.how}</span>`;
    queueVideos();
  };
  P.gd.forEach((d, i) => { const b = el("button", "", d.name); b.addEventListener("click", () => { held = true; show(i); }); seg.appendChild(b); });
  vid.addEventListener("timeupdate", () => {
    if (!held && vid.currentTime + 1 < lastT) show((cur + 1) % P.gd.length);
    else lastT = vid.currentTime;
  });
  show(0);
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
  const svg = $("#mulaw"), mu = 31, W = 420, H = 260, L = 46, R = 16, T = 14, B = 40;
  const X = z => L + (z + 1) / 2 * (W - L - R), Y = I => T + (1 - I / 255) * (H - T - B);
  const Ic = z => 127.5 * (1 + Math.sign(z) * Math.log(1 + mu * Math.abs(z)) / Math.log(1 + mu));
  let lin = "", cur = "";
  for (let i = 0; i <= 200; i++) { const z = -1 + i / 100; lin += `${i ? "L" : "M"}${X(z)},${Y(127.5 * (1 + z))}`; cur += `${i ? "L" : "M"}${X(z)},${Y(Ic(z))}`; }
  svg.classList.add("chart");
  svg.innerHTML = `
    <g class="gl">${[-1, -.5, 0, .5, 1].map(z => `<line x1="${X(z)}" x2="${X(z)}" y1="${T}" y2="${H - B}"/>`).join("")}
      ${[0, 64, 128, 191, 255].map(I => `<line x1="${L}" x2="${W - R}" y1="${Y(I)}" y2="${Y(I)}"/>`).join("")}</g>
    <g style="font-size:12px">${[-1, -.5, 0, .5, 1].map(z => `<text x="${X(z)}" y="${H - B + 18}" text-anchor="middle">${z}</text>`).join("")}
      ${[0, 128, 255].map(I => `<text x="${L - 8}" y="${Y(I) + 4}" text-anchor="end">${I}</text>`).join("")}
      <text x="${(L + W - R) / 2}" y="${H - 4}" text-anchor="middle">normalized displacement z</text></g>
    <path class="lin" d="${lin}"/>
    <path class="cc" d="${cur}"/>
    <text class="gt" x="${X(.32)}" y="${Y(232)}">μ-law, μ = 31</text>
    <text x="${X(.42)}" y="${Y(172)}">linear</text>
    <line id="muV" class="gx"/><line id="muH" class="gx"/>
    <circle id="muP" class="dot" r="6"/>`;
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
  const W = 320, H = 240;
  // The two world streams are the playing ground-truth videos; the first frames stand in until they can play.
  const still = {v: new Image(), g: new Image()};
  still.v.src = P.clock_img.video; still.g.src = P.clock_img.geodelta;
  const clip = {v: "assets/media/pipe/vid.mp4", g: "assets/media/pipe/gd.mp4"}, vids = {};
  Object.keys(clip).forEach(k => { const v = document.createElement("video"); v.muted = true; v.loop = true; v.playsInline = true; v.preload = "none"; vids[k] = v; });
  // noise is composited over the frame with alpha σ, so no pixel is read back from the video
  const noise = document.createElement("canvas"); noise.width = W; noise.height = H;
  const nx = noise.getContext("2d"), nd = nx.createImageData(W, H);
  const rnd = () => { const d = nd.data; for (let i = 0; i < d.length; i += 4) { d[i] = Math.random() * 255; d[i + 1] = Math.random() * 255; d[i + 2] = Math.random() * 255; d[i + 3] = 255; } nx.putImageData(nd, 0, 0); };
  rnd();
  const q = P.clock_q, aN = q.map(r => r.map(() => Math.random()));
  const u = $("#clockU"), pb = $("#clockPlay");
  let playing = true, step = 0, hold = 0, inview = false;
  const run = () => {
    const on = inview && playing && !document.hidden;
    Object.entries(vids).forEach(([k, v]) => {
      if (on) { if (!v.getAttribute("src")) v.src = clip[k]; v.play().catch(() => {}); }
      else v.pause();
    });
  };
  new IntersectionObserver(es => { inview = es[0].isIntersecting; run(); }, {threshold: 0.2}).observe(box);
  document.addEventListener("visibilitychange", run);
  vids.v.addEventListener("timeupdate", () => { if (Math.abs(vids.g.currentTime - vids.v.currentTime) > 0.15) vids.g.currentTime = vids.v.currentTime; });
  function blend(ctx, k, s) {
    const v = vids[k], src = v.readyState >= 2 ? v : still[k];
    const sw = src.videoWidth || src.naturalWidth, sh = src.videoHeight || src.naturalHeight;
    ctx.globalAlpha = 1; ctx.fillStyle = COL.canvas; ctx.fillRect(0, 0, W, H);
    if (sw && sh) { const sc = Math.max(W / sw, H / sh), dw = sw * sc, dh = sh * sc; ctx.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh); }
    if (s > 0) { ctx.globalAlpha = s; ctx.drawImage(noise, 0, 0); ctx.globalAlpha = 1; }
  }
  function actions(ctx, s) {
    ctx.globalAlpha = 1; ctx.fillStyle = COL.canvas; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = COL.line; ctx.lineWidth = 1;
    for (let k = 1; k < 4; k++) { ctx.beginPath(); ctx.moveTo(0, H * k / 4); ctx.lineTo(W, H * k / 4); ctx.stroke(); }
    q.forEach((row, j) => {
      ctx.beginPath();
      row.forEach((v, i) => {
        const y = (1 - s) * v + s * aN[j][i];
        const X = 14 + (W - 28) * i / (row.length - 1), Y = H - 14 - (H - 28) * y;
        i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y);
      });
      ctx.strokeStyle = s === 0 ? COL.gold : COL["canvas-ink"];
      ctx.globalAlpha = s === 0 ? 0.55 + 0.03 * j : 0.35 + 0.4 * (1 - s);
      ctx.lineWidth = s === 0 ? 2 : 1.4; ctx.stroke();
    });
    ctx.globalAlpha = 1;
    ctx.fillStyle = COL["canvas-ink"]; ctx.font = "12px Inter"; ctx.fillText("14 joints · 32 control steps", 12, 20);
  }
  function paint() {
    const uu = step / 20, sV = 1 - uu, sG = Math.max(1 - 2 * uu, 0);
    blend(cv.getContext("2d"), "v", sV);
    blend(cg.getContext("2d"), "g", sG);
    actions(ca.getContext("2d"), sG);
    $("#sV").textContent = `σ = ${sV.toFixed(2)}`; $("#sG").textContent = `σ = ${sG.toFixed(2)}`; $("#sA").textContent = `σ = ${sG.toFixed(2)}`;
    $("#clockLbl").textContent = `step ${Math.floor(step)} / 20`;
    $("#ready").classList.toggle("on", step >= 10);
    u.value = step;
  }
  u.addEventListener("input", () => { step = +u.value; playing = false; pb.textContent = "▶"; run(); paint(); });
  document.addEventListener("themechange", paint);
  still.v.onload = still.g.onload = paint;
  pb.addEventListener("click", () => { playing = !playing; pb.textContent = playing ? "❚❚" : "▶"; if (playing && step >= 20) step = 0; run(); });
  let last = 0;
  (function tick(t) {
    requestAnimationFrame(tick);
    if (!inview || t - last < 60) return;
    last = t;
    if (playing) {
      if (step >= 20) { if (++hold > 30) { step = 0; hold = 0; } }
      else step = Math.min(20, step + 0.25);
      if (Math.random() < .5) rnd();
    }
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
  svg.classList.add("chart");
  svg.innerHTML = `
    <line class="ax" x1="0" x2="${W}" y1="${Y(0)}" y2="${Y(0)}"/>
    <line class="ax2" x1="0" x2="${W}" y1="${Y(1)}" y2="${Y(1)}"/>
    <path class="rr" d="${pr}"/>
    <path class="cc" d="${pc}"/>
    ${ev.map(([n, k]) => `<g><line class="ev" x1="${X(n)}" x2="${X(n)}" y1="${T}" y2="${H - B}"/><text x="${X(n) + 6}" y="${H - 8}">${k}</text></g>`).join("")}
    <line id="relHead" class="head" y1="${T - 6}" y2="${H - B}"/>
    <circle id="relDot" class="dot" r="6"/>`;
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
const vbars = (node, groups, series, max, delta, values) => {
  const g = el("div", "vgroup"), lab = el("div", "vlabels"), key = el("div", "vkey");
  if (values) node.classList.add("vals");
  groups.forEach((name, i) => {
    const col = el("div", "vg");
    series.forEach(s => { const b = col.appendChild(el("div", "b" + (s.ours ? " o" : ""), "")); b.dataset.h = s.vals[i] / max * 100; b.dataset.v = s.vals[i].toFixed(1); });
    if (delta) { const d = series[1].vals[i] - series[0].vals[i]; col.appendChild(el("div", "d", (d >= 0 ? "+" : "") + d.toFixed(1))); }
    $$(".b", col).forEach((b, k) => b.title = `${series[k].name}: ${series[k].vals[i]}`);
    g.appendChild(col); lab.appendChild(el("span", "", name));
  });
  series.forEach(s => key.appendChild(el("span", "", `<i class="${s.ours ? "o" : ""}"></i>${s.name}`)));
  node.append(g, lab, key);
  const go = () => { node.classList.add("go"); $$(".b", node).forEach(b => b.style.height = b.dataset.h + "%"); };
  animOnce(node, go, 0.2);
};
vbars($("#vlbars"), ["ID", "Cat", "CS", "Ins", "Tex", "Avg."],
  [{name: "OpenWAM-Alpha", vals: [83.4, 38.1, 58.0, 53.8, 61.4, 58.9]}, {name: "Gnomon4D", vals: [84.0, 39.1, 61.7, 59.1, 68.8, 62.5], ours: 1}], 100, true);
vbars($("#realbars"), ["In distribution", "Visual shifts"],
  [{name: "Fast-WAM", vals: [58.5, 47.0]}, {name: "X-WAM", vals: [68.5, 62.0]}, {name: "FlowWAM", vals: [75.5, 61.0]}, {name: "Gnomon4D", vals: [82.5, 78.0], ours: 1}], 100, false, true);

// count-up on the stat cards
$$("[data-count]").forEach(n => {
  const v = +n.dataset.count, dec = (n.dataset.count.split(".")[1] || "").length;
  animOnce(n, () => {
    const t0 = performance.now();
    (function f(t) { const p = Math.min(1, (t - t0) / 1400), e = 1 - Math.pow(1 - p, 3); n.textContent = (v * e).toFixed(dec); if (p < 1) requestAnimationFrame(f); })(t0);
  }, 0.5);
});

// ---------------------------------------------------------------- case browsers
$$(".cases").forEach(box => {
  let all = P.cases.filter(c => c.bench === box.dataset.bench);
  if (!all.length) return;
  if (box.dataset.bench === "real") all = realOrder(all);
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
  // fixed frame per benchmark, so the poster thumbnail does not resize the player
  vid.style.aspectRatio = {rt2: "1440 / 324", vl: "4 / 3", rd: "4 / 3", real: "16 / 9"}[box.dataset.bench];
  vid.style.objectFit = "contain";
  const cap = el("div", "cb-cap"), ctl = el("div", "cb-ctl",
    `<button class="icon" data-a="prev" aria-label="previous">‹</button><button class="icon" data-a="pp" aria-label="Play video">▶</button><button class="icon" data-a="next" aria-label="next">›</button><input type="range" min="0" max="1000" value="0"><span class="mono">0.0 / 0.0 s</span>`);
  main.append(vid, cap, ctl);
  wrap.append(main, side);
  box.append(top, wrap);
  // the thumbnail column beside a wide player ends where the player ends
  if (box.classList.contains("wide")) new ResizeObserver(() => box.style.setProperty("--cbh", main.offsetHeight + "px")).observe(main);
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
    if (b) {
      const s = side.getBoundingClientRect(), r = b.getBoundingClientRect();
      if (side.scrollHeight > side.clientHeight && (r.top < s.top || r.bottom > s.bottom)) side.scrollTop += r.top - s.top - 8;
      if (side.scrollWidth > side.clientWidth && (r.left < s.left || r.right > s.right)) side.scrollLeft += r.left - s.left - 8;
    }
  }
  function fill(i) {
    list = all.filter(c => group === "all" || c.group === group);
    side.innerHTML = "";
    list.forEach((c, k) => {
      const b = el("button", "", `<img loading="lazy" src="${c.thumb}" alt=""><span>${c.task}${shiftLabel(c)}${c.group === "tex" ? " · unseen texture" : ""}</span>${c.ok ? "" : `<em class="bad">✕</em>`}`);
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
  by.real = realOrder(by.real);
  const items = [], pat = ["rt2", "real", "rt2", "rd", "vl"], pos = {rt2: 0, real: 0, rd: 0, vl: 0};
  while (Object.keys(by).some(b => pos[b] < by[b].length)) pat.forEach(b => { if (pos[b] < by[b].length) items.push(by[b][pos[b]++]); });
  let g = "all", n = 16;
  function draw() {
    $$("video", wall).forEach(unwatch);
    wall.innerHTML = "";
    const list = items.filter(c => g === "all" || c.bench === g);
    list.slice(0, n).forEach(c => {
      const f = el("figure", c.bench, `<video muted loop playsinline preload="none" poster="${c.thumb}" data-src="${c.src}"></video><figcaption><span>${NAMES[c.bench]} · ${c.task}${shiftLabel(c)}${c.group === "tex" ? " · unseen texture" : ""}</span><em>${c.speed}</em></figcaption>`);
      wall.appendChild(f); watch($("video", f));
    });
    more.style.display = list.length > n ? "" : "none";
  }
  $$("#wallBtns button").forEach(b => b.addEventListener("click", () => { g = b.dataset.g; n = 16; $$("#wallBtns button").forEach(x => x.classList.toggle("on", x === b)); draw(); }));
  more.addEventListener("click", () => { n += 16; draw(); });
  draw();
})();
