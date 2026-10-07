/* UI — app shell, screens, sheets. Depends on Engine and SEED. */
(() => {
  const E = Engine;
  const KEY = "ctm27-training-v1";
  const params = new URLSearchParams(location.search);
  const TODAY = /^\d{4}-\d{2}-\d{2}$/.test(params.get("today") || "") ? params.get("today") : E.todayISO();
  const app = document.getElementById("app");
  const navbar = document.getElementById("navbar");
  const toastEl = document.getElementById("toast");
  const ROUTES = ["today", "plan", "progress", "runs", "settings"];
  const LEGACY = { log: "runs", trends: "progress", setup: "settings" };

  let S = load();
  let route = parseRoute();
  let lastRoute = null;
  let openWeek = null;
  let planSeg = "weeks";
  let showAllRuns = false;
  let reviewBusy = false;
  let sheet = null; // { kind: "log" | "run" | "week" | "checkpoint", ... }
  let installEvent = null;
  let toastTimer = null;

  /* ---------- storage ---------- */
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      return E.migrate(raw ? JSON.parse(raw) : null);
    } catch (e) {
      return E.migrate(null);
    }
  }
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(S));
    } catch (e) {
      toast("This browser wouldn't save. Export a backup from Settings now.");
    }
  }
  function parseRoute() {
    const h = (location.hash || "#today").slice(1);
    if (LEGACY[h]) return LEGACY[h];
    return ROUTES.includes(h) ? h : "today";
  }

  /* ---------- helpers ---------- */
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const fmtDate = (iso, withDow = true) => {
    const d = E.fromISO(iso);
    return `${withDow ? DOW[d.getDay()] + " " : ""}${d.getDate()} ${MON[d.getMonth()]}`;
  };
  const km = (x) => (x == null ? "–" : (Math.round(x * 10) / 10).toString());
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const hm = (sec) => `${Math.floor(sec / 3600)}:${String(Math.floor((sec % 3600) / 60)).padStart(2, "0")}`;
  const secs = (s) => (Math.abs(s) < 60 ? `${Math.round(Math.abs(s))} s` : E.fmtDuration(Math.abs(s)));
  const withKm = (d) => `${esc(d.desc)}${d.km && !/\bkm\b/.test(d.desc) ? `, ${km(d.km)} km` : ""}`;
  const PHASE = {
    Recover: "recovery", Base: "base building", Down: "down week", Holiday: "holiday week", Build: "build",
    Specific: "marathon-specific", Checkpoint: "half marathon week", Peak: "peak", Taper: "taper", Race: "race week",
  };
  const STRENGTH = {
    A: "Strength A: split squats, single-leg RDL, calf raises, Copenhagen plank",
    B: "Strength B: step-downs, soleus raises, hip thrust, side plank, dead bug",
  };
  const typeClass = (t) => ({ Rest: "t-rest", Easy: "t-easy", Quality: "t-quality", Long: "t-long", Test: "t-test", Race: "t-race", "Carb load": "t-race" }[t] || "t-easy");
  const standalone = () => (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true;

  const I = (paths) => `<svg viewBox="0 0 24 24" aria-hidden="true" class="ic">${paths}</svg>`;
  const ICON = {
    today: I('<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M4 9.5h16M8.5 3v4M15.5 3v4"/><circle cx="12" cy="14.5" r="1.8"/>'),
    plan: I('<path d="M9 6.5h11M9 12h11M9 17.5h11"/><circle cx="4.8" cy="6.5" r="1.2"/><circle cx="4.8" cy="12" r="1.2"/><circle cx="4.8" cy="17.5" r="1.2"/>'),
    progress: I('<path d="M4 4.5v15h16"/><path d="M7.5 15l3.8-4.2 3 2.8 5-6.1"/>'),
    runs: I('<circle cx="12" cy="12" r="8.2"/><path d="M12 7.8V12l2.9 1.9"/>'),
    plus: I('<path d="M12 5v14M5 12h14"/>'),
    settings: I('<path d="M4 7.5h9M18 7.5h2M4 16.5h3.5M12.5 16.5H20"/><circle cx="15.5" cy="7.5" r="2.3"/><circle cx="10" cy="16.5" r="2.3"/>'),
    back: I('<path d="M14.5 5.5 8 12l6.5 6.5"/>'),
    chevron: I('<path d="m9.5 6 6 6-6 6"/>'),
  };

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 3200);
  }
  function download(name, text, type) {
    const blob = new Blob([text], { type });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function buzz() { try { if (navigator.vibrate) navigator.vibrate(12); } catch (e) {} }

  function compute() {
    const adj = E.adjust(SEED, S, TODAY);
    const model = E.paceModel(S, TODAY);
    const zs = E.zones(S, model);
    const byDate = E.runsByDate(S.runs);
    return { ...adj, model, zs, byDate };
  }
  const actualOn = (C, iso) => (C.byDate[iso] || []).reduce((a, r) => a + r.km, 0);
  const weekActual = (C, wk) => C.days.filter((d) => d.wk === wk).reduce((a, d) => a + actualOn(C, d.date), 0);
  const weekPlanned = (C, wk) => C.days.filter((d) => d.wk === wk).reduce((a, d) => a + d.km, 0);
  const weekOrig = (wk) => SEED.days.filter((d) => d.wk === wk).reduce((a, d) => a + d.km, 0);
  const zone = (C, key) => C.zs.find((z) => z.key === key);

  /* ---------- shared pieces ---------- */
  function titleBar(title, sub) {
    const isSettings = route === "settings";
    return `<header class="large-title">
      <div class="lt-row">${isSettings ? `<button class="icon-btn back" data-action="back" aria-label="Back">${ICON.back}</button>` : ""}<h1>${esc(title)}</h1>
      ${isSettings ? "" : `<button class="icon-btn" data-action="go" data-to="settings" aria-label="Settings">${ICON.settings}</button>`}</div>
      ${sub ? `<p class="sub">${sub}</p>` : ""}</header>`;
  }
  function emptyState(text, actions) {
    return `<div class="empty"><p>${text}</p><div class="row">${actions
      .map(([label, action, extra]) => (action === "import" ? importButton(label, "secondary") : `<button class="secondary" data-action="${action}" ${extra || ""}>${label}</button>`))
      .join("")}</div></div>`;
  }
  const importButton = (label = "Import Garmin CSV", cls = "secondary") => `<label class="file ${cls}">${label}<input type="file" accept=".csv,text/csv" data-action="import-csv"></label>`;

  /* ---------- charts ---------- */
  function svgProfile(C) {
    const W = 640, H = 170, pl = 8, pr = 8, pt = 26, pb = 26, n = 32;
    const planned = Array.from({ length: n }, (_, i) => weekPlanned(C, i + 1));
    const actual = Array.from({ length: n }, (_, i) => weekActual(C, i + 1));
    const max = Math.max(95, ...planned, ...actual);
    const x = (i) => pl + (i * (W - pl - pr)) / (n - 1);
    const y = (v) => pt + (H - pt - pb) * (1 - v / max);
    const pts = planned.map((v, i) => [x(i), y(v)]);
    let line = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      const mx = (x0 + x1) / 2;
      line += ` C${mx},${y0} ${mx},${y1} ${x1},${y1}`;
    }
    const area = `${line} L${x(n - 1)},${H - pb} L${x(0)},${H - pb} Z`;
    const cur = C.started ? C.curWk : 0;
    const actPts = actual.map((v, i) => (i + 1 <= cur && v > 0 ? `<circle cx="${x(i)}" cy="${y(v)}" r="3.2" class="p-act"/>` : "")).join("");
    const flags = [[4, "5 km", 1], [14, "10 km", 2], [23, "Half", 3], [32, "Cape Town", null]]
      .map(([wk, label, ci]) => {
        const xx = x(wk - 1), yy = y(planned[wk - 1]);
        const end = wk === 32;
        const done = ci == null ? TODAY > S.settings.raceDate : !!(S.checkpoints[ci] && S.checkpoints[ci].actualSec);
        return `<line x1="${xx}" x2="${xx}" y1="${yy}" y2="${yy - 14}" class="p-flagpole"/><path d="M${xx},${yy - 14} l${end ? -9 : 9},3.5 l${end ? 9 : -9},3.5z" class="p-flag ${done ? "" : "open"}"/><text x="${end ? xx - 2 : xx}" y="${yy - 18}" text-anchor="${end ? "end" : "middle"}" class="p-label">${label}</text>`;
      })
      .join("");
    const months = [];
    for (let i = 0; i < n; i++) {
      const d = E.fromISO(E.addDays(S.settings.planStart, i * 7));
      const prev = i ? E.fromISO(E.addDays(S.settings.planStart, (i - 1) * 7)) : null;
      if (!prev || prev.getMonth() !== d.getMonth()) months.push(`<text x="${x(i)}" y="${H - 8}" class="p-month">${MON[d.getMonth()]}</text>`);
    }
    const marker = cur ? `<line x1="${x(cur - 1)}" x2="${x(cur - 1)}" y1="${pt - 6}" y2="${H - pb}" class="p-now"/><circle cx="${x(cur - 1)}" cy="${y(planned[cur - 1])}" r="5" class="p-nowdot"/>` : "";
    return `<svg viewBox="0 0 ${W} ${H}" class="profile" role="img" aria-label="Weekly volume from October to May. Peak ${Math.round(Math.max(...planned))} km in week ${planned.indexOf(Math.max(...planned)) + 1}.">
      <defs><linearGradient id="pfill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1A8FD0" stop-opacity="0.16"/><stop offset="1" stop-color="#1A8FD0" stop-opacity="0"/></linearGradient></defs>
      <line x1="${x(0)}" x2="${x(n - 1)}" y1="${H - pb}" y2="${H - pb}" class="p-base"/>
      <path d="${area}" class="p-area"/><path d="${line}" class="p-line"/>${actPts}${flags}${marker}${months.join("")}</svg>`;
  }

  function svgWeekly(C) {
    const W = 640, H = 200, pl = 34, pr = 8, pt = 10, pb = 24, n = 32;
    const planned = Array.from({ length: n }, (_, i) => weekPlanned(C, i + 1));
    const actual = Array.from({ length: n }, (_, i) => weekActual(C, i + 1));
    const max = Math.max(90, ...planned, ...actual);
    const bw = (W - pl - pr) / n;
    const y = (v) => pt + (H - pt - pb) * (1 - v / max);
    let s = "";
    for (const g of [0, 25, 50, 75]) s += `<line x1="${pl}" x2="${W - pr}" y1="${y(g)}" y2="${y(g)}" class="grid"/><text x="${pl - 6}" y="${y(g) + 4}" text-anchor="end" class="axis">${g}</text>`;
    for (let i = 0; i < n; i++) {
      const x0 = pl + i * bw;
      s += `<rect x="${x0 + 1}" y="${y(planned[i])}" width="${bw - 2}" height="${y(0) - y(planned[i])}" class="bar-plan"><title>Week ${i + 1}: ${km(planned[i])} km planned, ${km(actual[i])} km run</title></rect>`;
      if (actual[i] > 0) s += `<rect x="${x0 + bw * 0.25}" y="${y(actual[i])}" width="${bw * 0.5}" height="${y(0) - y(actual[i])}" class="bar-act"/>`;
      if ((i + 1) % 4 === 0 || i === 0) s += `<text x="${x0 + bw / 2}" y="${H - 8}" text-anchor="middle" class="axis">${i + 1}</text>`;
    }
    return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Planned versus actual kilometres per week">${s}</svg>
      <p class="legend"><span class="key k-plan"></span>Planned <span class="key k-act"></span>Run</p>`;
  }

  function svgEff() {
    const from = E.addDays(TODAY, -180);
    const pts = E.effSeries(S.runs).filter((p) => p.date >= from && p.date <= TODAY);
    if (pts.length < 3) return emptyState("This chart needs at least 3 road runs with heart rate in the last 6 months. Your Garmin history fills it in one go.", [["Import Garmin CSV", "import"], ["Log run", "open-log"]]);
    const W = 640, H = 200, pl = 42, pr = 8, pt = 10, pb = 24;
    const vals = pts.map((p) => p.p150);
    const lo = Math.min(...vals) - 10, hi = Math.max(...vals) + 10;
    const t0 = E.fromISO(from).getTime(), t1 = E.fromISO(TODAY).getTime();
    const x = (iso) => pl + ((E.fromISO(iso).getTime() - t0) / (t1 - t0)) * (W - pl - pr);
    const y = (v) => pt + ((v - lo) / (hi - lo)) * (H - pt - pb);
    let s = "";
    const step = hi - lo > 90 ? 30 : 15;
    for (let g = Math.ceil(lo / step) * step; g <= hi; g += step) s += `<line x1="${pl}" x2="${W - pr}" y1="${y(g)}" y2="${y(g)}" class="grid"/><text x="${pl - 6}" y="${y(g) + 4}" text-anchor="end" class="axis">${E.fmtPace(g)}</text>`;
    s += pts.map((p) => `<circle cx="${x(p.date)}" cy="${y(p.p150)}" r="3" class="pt"><title>${fmtDate(p.date)}: ${E.fmtPace(p.p150)}/km at 150 bpm</title></circle>`).join("");
    const roll = pts.map((p, i) => [p.date, E.median(pts.slice(Math.max(0, i - 4), i + 1).map((q) => q.p150))]);
    s += `<path d="${roll.map((r, i) => `${i ? "L" : "M"}${x(r[0])},${y(r[1])}`).join(" ")}" class="trend"/>`;
    for (let m = 0; m < 7; m++) {
      const d = E.fromISO(from); d.setMonth(d.getMonth() + m, 1);
      const iso = E.toISO(d);
      if (iso > from && iso <= TODAY) s += `<text x="${x(iso)}" y="${H - 8}" class="axis">${MON[d.getMonth()]}</text>`;
    }
    const last = roll[roll.length - 1][1], first = roll[Math.min(4, roll.length - 1)][1];
    const delta = Math.round(first - last);
    return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Easy pace at 150 bpm over the last six months">${s}</svg>
      <p class="caption">Higher is fitter. Rolling median ${E.fmtPace(last)}/km at 150 bpm, ${delta >= 0 ? `${delta} s/km faster` : `${-delta} s/km slower`} than six months ago. Trail and hilly runs are left out.</p>`;
  }

  function svgLoad() {
    const N = 84, W = 640, H = 170, pl = 34, pr = 8, pt = 10, pb = 24;
    const series = [];
    for (let i = N - 1; i >= 0; i--) {
      const d = E.addDays(TODAY, -i);
      series.push([d, E.loadRatio(S.runs, d).ratio]);
    }
    if (series.filter((s) => s[1] != null).length < 7) return emptyState("The load ratio needs about four weeks of running in the log. Import your Garmin history and it works straight away.", [["Import Garmin CSV", "import"]]);
    const max = 2;
    const x = (i) => pl + (i / (N - 1)) * (W - pl - pr);
    const y = (v) => pt + (H - pt - pb) * (1 - Math.min(v, max) / max);
    let s = `<rect x="${pl}" y="${y(1.3)}" width="${W - pl - pr}" height="${y(0.8) - y(1.3)}" class="band"/>`;
    for (const g of [0.5, 1, 1.5]) s += `<line x1="${pl}" x2="${W - pr}" y1="${y(g)}" y2="${y(g)}" class="grid"/><text x="${pl - 6}" y="${y(g) + 4}" text-anchor="end" class="axis">${g.toFixed(1)}</text>`;
    let path = "", pen = false;
    series.forEach(([, v], i) => {
      if (v == null) { pen = false; return; }
      path += `${pen ? "L" : "M"}${x(i)},${y(v)} `;
      pen = true;
    });
    s += `<path d="${path}" class="trend"/>`;
    series.forEach(([d], i) => { if (E.fromISO(d).getDate() === 1) s += `<text x="${x(i)}" y="${H - 8}" class="axis">${MON[E.fromISO(d).getMonth()]}</text>`; });
    return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Load ratio over the last 12 weeks">${s}</svg>
      <p class="caption">Last 7 days against your 4-week average. The shaded band (0.8–1.3) is the safe zone; above it, easy runs get trimmed.</p>`;
  }

  /* ---------- Today ---------- */
  function sessionBlock(C, d) {
    const t = E.targetFor(d, C.zs, C.model);
    const n = E.nutritionFor(d, S.settings);
    const ran = C.byDate[d.date] || [];
    const week = SEED.weeks[d.wk - 1];
    const facts = [];
    const unit = t.text === "By effort" ? "" : d.zone === "Easy" || d.zone === "Race" ? "/km" : d.type === "Quality" || d.type === "Test" ? "/km for the reps" : "/km for the fast part";
    if (d.km > 0) facts.push(`<div><span class="big">${km(d.km)}</span><span class="unit">km</span></div>`);
    if (t.text) facts.push(`<div><span class="big">${esc(t.text)}</span><span class="unit">${unit}</span></div>`);
    if (t.hr) facts.push(`<div><span class="big hr">${esc(t.hr)}</span><span class="unit">bpm</span></div>`);
    const zi = { Easy: [0], Steady: [1], "Marathon pace": [2], "Half marathon pace": [2, 3], Threshold: [3], "10 km pace": [4], "5 km pace": [4], Race: [2], Effort: [3, 4], "Race effort": [4] }[d.zone] || [];
    const names = ["Easy", "Steady", "Marathon", "Threshold", "Fast"];
    const strip = zi.length ? `<div class="zones" aria-hidden="true">${names.map((_, i) => `<span class="z${i + 1} ${zi.includes(i) ? "on" : ""}"></span>`).join("")}</div>
      <div class="zone-labels">${names.map((nm, i) => `<span class="${zi.includes(i) ? "on" : ""}">${nm}</span>`).join("")}</div>` : "";
    const extras = [];
    if (d.str) extras.push(`<li>${esc(STRENGTH[d.str])}</li>`);
    extras.push(`<li>Eat about ${n.carbs} g carbs and ${n.protein} g protein today.</li>`);
    if (d.fuel > 0 && d.km >= 15) extras.push(`<li>Fuel ${d.fuel} g of carbs per hour. Product: ${esc(week.product)}.</li>`);
    const adjusted = d.km !== d.orig.km || d.desc !== d.orig.desc;
    const chip = { Rest: "Rest", Easy: "Easy", Quality: "Session", Long: "Long run", Test: "Test", Race: "Race day", "Carb load": "Carb load" }[d.type] || d.type;
    return `<section class="session ${typeClass(d.type)}">
      <div class="s-top"><p class="when">${d.date === TODAY ? `Today, ${fmtDate(d.date)}` : fmtDate(d.date)}</p><span class="chip ${typeClass(d.type)}">${esc(chip)}</span></div>
      <h2>${esc(d.desc)}</h2>
      ${adjusted ? `<p class="was">Planned: ${withKm(d.orig)}. ${esc(d.notes.join(". "))}.</p>` : ""}
      ${strip}
      ${facts.length ? `<div class="facts">${facts.join("")}</div>` : ""}
      <ul class="extras">${extras.join("")}</ul>
      ${ran.length ? `<p class="logged">Logged: ${ran.map((r) => `${km(r.km)} km in ${E.fmtDuration(r.sec)}${r.hr ? ` at ${r.hr} bpm` : ""}`).join(", ")}</p>` : d.km > 0 ? `<button class="primary" data-action="open-log" data-date="${d.date}">Log run</button>` : ""}
    </section>`;
  }

  function tomorrowBlock(C) {
    const tmr = E.addDays(TODAY, 1);
    const d = C.days.find((x) => x.date === tmr);
    if (!d) return "";
    const s = S.settings;
    const W = s.weightKg;
    const lines = [];
    let title = "";
    if (d.type === "Race") {
      title = "Race day tomorrow";
      lines.push(`Carb load today: about ${Math.round((9 * W) / 10) * 10} g of carbs, low fibre and low fat.`);
      lines.push("Lay out kit and race shoes, pin your bib, and pack 8 Maurten Gel 100s, 2 of them CAF 100.");
      lines.push(`Breakfast 3 hours before the start: about ${Math.round((2.5 * W) / 10) * 10} g of carbs.`);
    } else if (d.type === "Carb load") {
      title = "Carb loading starts tomorrow";
      lines.push(`Aim for about ${Math.round((9 * W) / 10) * 10} g of carbs a day on Friday and Saturday: white rice, pasta, bagels, juice, sports drink.`);
    } else if (d.type === "Test") {
      title = `${d.desc.split(" (")[0]} tomorrow`;
      lines.push(`Race breakfast 2–3 hours before: about ${Math.round((2 * W) / 10) * 10} g of carbs.`);
      lines.push("Warm up 3 km easy with 3–4 strides, then run it as a real race.");
    } else if ((d.type === "Long" || d.km >= 18) && d.fuel > 0) {
      const week = SEED.weeks[d.wk - 1];
      const easy = zone(C, "Easy (fast end)").now;
      const hours = (d.km * easy) / 3600;
      title = `Long run tomorrow, ${km(d.km)} km`;
      if (/maurten/i.test(week.product)) {
        lines.push(`Race rehearsal: pack ${Math.ceil((hours * d.fuel) / 25)} Maurten Gel 100s for about ${d.fuel} g/h, and eat your race breakfast.`);
      } else {
        lines.push(`Mix your DIY bottle tonight: 45 g maltodextrin, 35 g fructose and ¼ tsp salt in 750 ml. That covers about ${Math.round(80 / d.fuel * 60)} minutes at ${d.fuel} g/h.`);
      }
      lines.push("Have a carb-heavy dinner and lay out your kit.");
    } else if (d.type === "Quality") {
      title = "Session tomorrow";
      lines.push(`${withKm(d)}. Have 70–130 g of carbs 1–3 hours before.`);
    } else return "";
    return `<section class="tomorrow"><p class="t-label">${esc(title)}</p>${lines.map((l) => `<p>${l}</p>`).join("")}</section>`;
  }

  function nudges() {
    const out = [];
    if (!standalone() && !S.installDismissed) {
      out.push(`<div class="nudge"><div><p class="a-title">Add it to your home screen</p><p>${installEvent ? "Install it and it opens full-screen like any other app, and works offline." : "In Safari, tap Share, then Add to Home Screen. It opens full-screen and works offline."}</p></div>
        <div class="row">${installEvent ? `<button class="primary small" data-action="install">Install app</button>` : ""}<button class="link" data-action="dismiss-install">Not now</button></div></div>`);
    }
    if (!S.runs.length) {
      out.push(`<div class="nudge"><div><p class="a-title">Bring in your Garmin history</p><p>One import gives the heart-rate trend and load checks months of data to work with from day one.</p></div><div class="row">${importButton("Import Garmin CSV", "primary small")}</div></div>`);
    } else if (S.runs.some((r) => r.source === "garmin") && S.lastImport && E.diffDays(S.lastImport.slice(0, 10), TODAY) > 7) {
      out.push(`<div class="nudge"><div><p class="a-title">Last Garmin import ${fmtDate(S.lastImport.slice(0, 10), false)}</p><p>Import your latest runs so the plan adjusts to what you actually ran.</p></div><div class="row">${importButton("Import Garmin CSV", "secondary small")}</div></div>`);
    }
    return out.join("");
  }

  function alertsBlock(C) {
    const items = [...C.alerts];
    const lb = S.lastBackup;
    if (S.runs.length && (!lb || E.diffDays(lb.slice(0, 10), TODAY) > 7)) {
      items.push({ level: "info", rule: "backup", title: "Back up your log", body: `${lb ? `Last backup ${fmtDate(lb.slice(0, 10), false)}. ` : ""}Your runs live only on this phone; a backup file keeps them safe if you clear the browser or change phones.`, backup: true });
    }
    if (!items.length) return "";
    const adjusted = items.some((a) => a.level === "adjust" || (a.rule === "readiness" && a.level === "action"));
    return `<section class="alerts"><h3>${adjusted ? "Plan adjusted for you" : "Notes"}</h3>${items
      .map(
        (a) => `<div class="alert a-${a.level}"><p class="a-title">${esc(a.title)}</p><p>${esc(a.body)}</p>
        ${a.flags ? `<ul class="flags">${a.flags.map((f) => `<li>${fmtDate(f.date)}: ${esc(f.why)} <button class="link" data-action="dismiss-flag" data-id="${esc(f.id)}">Not fatigue, ignore</button></li>`).join("")}</ul>` : ""}
        ${a.backup ? `<button class="secondary small" data-action="export">Export backup</button>` : ""}</div>`
      )
      .join("")}</section>`;
  }

  function weekTable(C, wk, focusDate) {
    const days = C.days.filter((d) => d.wk === wk);
    return `<div class="list week">${days
      .map((d) => {
        const a = actualOn(C, d.date);
        const adj = d.km !== d.orig.km || d.desc !== d.orig.desc;
        const status = a > 0 ? "done" : d.date < TODAY && d.km > 0 ? "missed" : "";
        const tappable = d.km > 0 && !a && d.date <= TODAY;
        return `<div class="li ${d.date === focusDate ? "is-today" : ""} ${status}" ${tappable ? `role="button" tabindex="0" data-action="open-log" data-date="${d.date}"` : ""}>
          <span class="dot ${typeClass(d.type)}"></span>
          <div class="li-main"><p class="li-title">${fmtDate(d.date)}${d.str ? ` <span class="tag">${d.str}</span>` : ""}</p><p class="li-sub">${esc(d.desc)}${adj ? `<span class="was-inline">was: ${withKm(d.orig)}</span>` : ""}</p></div>
          <div class="li-end">${status === "done" ? `<span class="done-km">${km(a)}</span><span class="li-unit">of ${d.km ? km(d.km) : "0"} km</span>` : d.km ? `<span>${km(d.km)}</span><span class="li-unit">km</span>` : ""}</div>
        </div>`;
      })
      .join("")}
      <div class="li total"><span></span><div class="li-main"><p class="li-title">Week total</p></div><div class="li-end"><span>${km(weekActual(C, wk))}</span><span class="li-unit">of ${km(weekPlanned(C, wk))} km</span></div></div></div>`;
  }

  function raceDoneBlock() {
    const s = S.settings;
    const r = S.race.resultSec;
    if (!r) {
      return `<section class="session t-race"><div class="s-top"><p class="when">${fmtDate(s.raceDate)}</p><span class="chip t-race">Race day</span></div>
        <h2>How did Cape Town go?</h2>
        <div class="grid2"><label>Finish time<input type="text" inputmode="numeric" placeholder="h:mm:ss" data-race="resultSec"></label></div></section>`;
    }
    const diff = r - s.goalSec;
    return `<section class="session t-race"><div class="s-top"><p class="when">Sanlam Cape Town Marathon</p><span class="chip t-race">Finished</span></div>
      <h2>${E.fmtDuration(r)}</h2>
      <p class="was">${diff <= 0 ? `${secs(diff)} under your ${E.fmtDuration(s.goalSec)} goal.` : `${secs(diff)} over your ${E.fmtDuration(s.goalSec)} goal.`} ${E.fmtPace(r / E.MARATHON)}/km for 42.2 km.</p>
      <ul class="extras"><li>Take two weeks of easy running or rest before anything structured.</li><li>Export your season so this block is saved with the result.</li><li>When you've picked your next goal, change the race date and goal in Settings and the plan restarts from there.</li></ul>
      <div class="row"><button class="primary" data-action="export">Export season</button><button class="secondary" data-action="go" data-to="settings">Open Settings</button></div></section>`;
  }

  function viewToday(C) {
    const s = S.settings;
    const toGo = Math.max(0, E.diffDays(TODAY, s.raceDate));
    const after = TODAY > s.raceDate;
    const wk = C.started ? C.curWk : 1;
    const week = SEED.weeks[wk - 1];
    const focus = C.started ? C.days.find((d) => d.date === TODAY) : C.days[0];
    return `${titleBar(after ? "Done." : `${toGo} ${toGo === 1 ? "day" : "days"}`)}
      <section class="hero">
        <p class="sub">${after ? "Sanlam Cape Town Marathon." : `to Cape Town, ${fmtDate(s.raceDate)}. `}${after ? "" : C.started ? `Week ${wk} of 32, ${PHASE[week.phase]}. ` : `The plan starts ${fmtDate(s.planStart)}. `}${after ? "" : `Goal <strong>${E.fmtDuration(s.goalSec)}</strong>, tracking <strong>${E.fmtDuration(C.model.predicted)}</strong>.`}</p>
        ${svgProfile(C)}
      </section>
      ${after ? raceDoneBlock() : focus ? sessionBlock(C, focus) : ""}
      ${after ? "" : tomorrowBlock(C)}
      ${after ? "" : nudges()}
      ${after ? "" : alertsBlock(C)}
      ${after ? "" : `<section><h3>${C.started ? "This week" : "Week 1"}</h3>${week.notes ? `<p class="note">${esc(week.notes)}</p>` : ""}${weekTable(C, wk, focus && focus.date)}</section>`}`;
  }

  /* ---------- Plan ---------- */
  function viewPlan(C) {
    const seg = `<div class="segmented" role="tablist">${[["weeks", "Weeks"], ["race", "Race day"], ["fuel", "Fuel"]]
      .map(([k, l]) => `<button role="tab" aria-selected="${planSeg === k}" class="${planSeg === k ? "on" : ""}" data-action="plan-seg" data-seg="${k}">${l}</button>`)
      .join("")}</div>`;
    let body = "";
    if (planSeg === "weeks") body = planWeeks(C);
    if (planSeg === "race") body = raceDay(C);
    if (planSeg === "fuel") body = fuelGuide(C);
    return `${titleBar("Plan", `32 weeks, ${Math.round(C.days.reduce((a, d) => a + d.km, 0))} km to Cape Town.`)}${seg}${body}`;
  }

  function planWeeks(C) {
    const rows = SEED.weeks
      .map((w) => {
        const days = C.days.filter((d) => d.wk === w.wk);
        const p = weekPlanned(C, w.wk), o = weekOrig(w.wk), a = weekActual(C, w.wk);
        const mode = S.weekModes[w.wk] || "normal";
        const isCur = C.started && w.wk === C.curWk;
        const open = openWeek === w.wk || (openWeek === null && isCur);
        const sun = days.find((d) => d.day === "Sun");
        return `<li class="wk ${isCur ? "current" : ""} ph-${w.phase.toLowerCase()}">
          <button class="wk-head" data-action="toggle-week" data-wk="${w.wk}" aria-expanded="${open}">
            <span class="wk-n">${w.wk}</span>
            <span class="wk-main"><span class="wk-title">${fmtDate(days[0].date, false)} to ${fmtDate(days[6].date, false)}</span><span class="wk-sub">${esc(cap(PHASE[w.phase]))}${mode !== "normal" ? `, ${mode} mode` : ""}. Long run: ${esc(sun.desc)}</span></span>
            <span class="wk-km">${Math.round(p)}${p !== o ? `<s>${Math.round(o)}</s>` : ""}<small>${a ? `${Math.round(a)} run` : "km"}</small></span>
          </button>
          ${open ? `<div class="wk-body">
            <div class="segmented small" role="radiogroup" aria-label="Week ${w.wk} mode">
              ${[["normal", "As planned"], ["holiday", "Holiday"], ["crunch", "Crunch"]]
                .map(([k, l]) => `<button role="radio" aria-checked="${mode === k}" class="${mode === k ? "on" : ""}" data-action="set-mode" data-wk="${w.wk}" data-mode="${k}">${l}</button>`)
                .join("")}
            </div>
            <p class="note">${mode === "holiday" ? "Holiday: 4 runs, at least 35 km, session and long run kept." : mode === "crunch" ? "Crunch: 4 days, up to 65 km, second session dropped." : esc(w.notes || "Switch to holiday or crunch mode if this week gets squeezed.")}</p>
            ${weekTable(C, w.wk)}
            ${w.fuel ? `<p class="note">Long-run fuel: ${w.fuel} g/h. Product: ${esc(w.product)}.</p>` : ""}
          </div>` : ""}
        </li>`;
      })
      .join("");
    return `<ol class="weeks">${rows}</ol>`;
  }

  function raceDay() {
    const s = S.settings;
    const W = s.weightKg;
    const goalPace = s.goalSec / E.MARATHON;
    const gelCarbs = E.GELS.reduce((a, g) => a + g.carbs, 0);
    const gelCaf = E.GELS.reduce((a, g) => a + g.caffeine, 0) + (Number(s.preRaceCaffeine) || 0);
    const cafKg = gelCaf / W;
    return `<section><h3>Carb loading</h3>
        <div class="group">
          <div class="row-item"><span>Friday ${fmtDate(E.addDays(s.raceDate, -2), false)}</span><span class="val">${Math.round((9 * W) / 10) * 10} g carbs</span></div>
          <div class="row-item"><span>Saturday ${fmtDate(E.addDays(s.raceDate, -1), false)}</span><span class="val">${Math.round((9 * W) / 10) * 10} g carbs</span></div>
          <div class="row-item"><span>Breakfast, 3 h before</span><span class="val">${Math.round((2.5 * W) / 10) * 10} g carbs</span></div>
        </div><p class="caption">Low fibre, low fat, 6–7 small meals. Expect 1–2 kg extra on the scale; that's stored fuel.</p></section>
      <section><h3>Gels at goal pace</h3>
        <div class="group">${E.GELS.map((g) => `<div class="row-item"><span>${g.km ? `${g.km} km` : "Start, −15 min"}${/if flat/.test(g.at) ? '<span class="was-inline">Optional, if you feel flat</span>' : ""}</span><span class="val">${esc(g.product.replace("Maurten ", ""))}${g.caffeine ? ` <span class="tag">${g.caffeine} mg</span>` : ""}<span class="was-inline">${g.km ? hm(g.km * goalPace) : "before the gun"}</span></span></div>`).join("")}</div>
        <p class="caption">${gelCarbs} g of carbs, about ${Math.round(gelCarbs / (s.goalSec / 3600))} g/h. Caffeine ${gelCaf} mg, ${cafKg.toFixed(1)} mg/kg: ${cafKg > 6 ? "over 6 mg/kg adds side effects without benefit" : cafKg < 3 ? "below the 3 mg/kg effective dose" : cafKg > 4.5 ? "upper range, watch for jitters and gut trouble" : "in the 3–4.5 mg/kg sweet spot"}.</p>
        <div class="group"><label class="row-item"><span>Race-morning coffee (mg caffeine)</span><input type="number" inputmode="numeric" step="1" data-setting="preRaceCaffeine" value="${esc(s.preRaceCaffeine)}"></label></div></section>
      <section><h3>Pacing</h3><div class="group">${[5, 10, 21.0975, 30, 35, 40, 42.195].map((k) => `<div class="row-item"><span>${k === 21.0975 ? "Half" : k === 42.195 ? "Finish" : `${k} km`}</span><span class="val">${E.fmtDuration(k * goalPace)}</span></div>`).join("")}</div>
        <p class="caption">Even splits at ${E.fmtPace(goalPace)}/km. Start at 3:58–4:00 for the first 5 km and only push after 32 km.</p></section>`;
  }

  function fuelGuide() {
    const s = S.settings;
    const rows = Object.keys(E.NUTRITION).map((t) => { const n = E.nutritionFor({ type: t }, s); return `<div class="row-item"><span><span class="dot ${typeClass(t)}"></span>${t}</span><span class="val">${n.carbs} g carbs<span class="was-inline">${n.protein} g protein</span></span></div>`; }).join("");
    return `<section><h3>Daily targets</h3><div class="group">${rows}</div><p class="caption">Scaled to ${s.weightKg} kg. If your weight drops more than 1–1.5 kg in a month, eat more.</p></section>
      <section><h3>Long-run fuelling</h3><div class="group">
        <div class="row-item"><span>Weeks 1–4</span><span class="val">Water only</span></div>
        <div class="row-item"><span>Weeks 5–12</span><span class="val">30–45 g/h</span></div>
        <div class="row-item"><span>Weeks 13–20</span><span class="val">60 g/h</span></div>
        <div class="row-item"><span>Weeks 21–29</span><span class="val">75–90 g/h</span></div></div>
        <p class="caption">Train with the DIY mix; use Maurten in weeks 23, 25, 28 and 29 as race rehearsals.</p></section>
      <section><h3>DIY training drink</h3><div class="group">
        <div class="row-item"><span>Maltodextrin</span><span class="val">45 g</span></div>
        <div class="row-item"><span>Fructose</span><span class="val">35 g</span></div>
        <div class="row-item"><span>Table salt</span><span class="val">¼ tsp</span></div>
        <div class="row-item"><span>Water</span><span class="val">750 ml</span></div></div>
        <p class="caption">80 g of carbs and about 590 mg of sodium per bottle. Mix it the night before.</p></section>`;
  }

  /* ---------- Progress ---------- */
  function viewProgress(C) {
    const m = C.model;
    const gap = Math.round(m.mp - m.goalMp);
    const cps = S.checkpoints
      .map((c, i) => {
        const sea = c.actualSec ? (c.altitude ? c.actualSec / (1 + S.settings.altTestPct / 100) : c.actualSec) : null;
        const pred = sea ? sea * Math.pow(E.MARATHON / c.km, S.settings.riegel) : null;
        return `<div class="group cp-group">
          <div class="row-item head"><span><strong>${esc(c.name)}</strong><span class="was-inline">${fmtDate(c.date)}${c.targetSec ? `, target ${E.fmtDuration(c.targetSec)}` : ""}</span></span><span class="val">${pred ? `${E.fmtDuration(pred)}<span class="was-inline">marathon</span>` : ""}</span></div>
          <label class="row-item"><span>Result</span><input type="text" inputmode="numeric" data-cp="${i}" data-field="actualSec" value="${c.actualSec ? E.fmtDuration(c.actualSec) : ""}" placeholder="Add result"></label>
          <label class="row-item"><span>Date</span><input type="date" data-cp="${i}" data-field="date" value="${c.date}"></label>
          <label class="row-item"><span>Run at altitude</span><input type="checkbox" class="switch" data-cp="${i}" data-field="altitude" ${c.altitude ? "checked" : ""}></label>
        </div>`;
      })
      .join("");
    const zs = C.zs.map((z) => `<div class="row-item"><span>${esc(z.key)}<span class="was-inline">${z.hrLo}–${z.hrHi} bpm</span></span><span class="val">${E.fmtPace(z.now)}<span class="was-inline">goal ${E.fmtPace(z.goalSea)}</span></span></div>`).join("");
    return `${titleBar("Progress")}
      <section class="pred-hero"><p class="next-label">Predicted marathon</p><p class="pred-big">${E.fmtDuration(m.predicted)}</p>
        <p class="sub">${gap > 0 ? `${gap} s/km from 2:45 pace` : "On 2:45 pace"}, based on your ${esc(m.latest.name)} result${Math.round(m.drift) ? ` and ${Math.abs(Math.round(m.drift))} s/km of heart-rate ${m.drift < 0 ? "improvement" : "drift"} since` : ""}.</p></section>
      <section><h3>Benchmarks</h3><p class="caption">Type a time like 19:05 or 1:18:30. The latest result resets every training pace.</p>${cps}</section>
      <section><h3>Training paces</h3><div class="group">${zs}</div><p class="caption">${S.settings.trainAtAltitude ? `Adds ${S.settings.altPaceSec} s/km to steady and faster paces for Joburg. ` : ""}Goal paces are at sea level.</p></section>
      <section><h3>Weekly volume</h3>${svgWeekly(C)}</section>
      <section><h3>Easy pace at 150 bpm</h3>${svgEff()}</section>
      <section><h3>Load ratio</h3>${svgLoad()}</section>`;
  }

  /* ---------- Runs ---------- */
  function viewRuns() {
    const runs = S.runs.slice().sort((a, b) => (a.date + (a.time || "") < b.date + (b.time || "") ? 1 : -1));
    const list = showAllRuns ? runs : runs.slice(0, 40);
    const row = (r) => `<div class="li run">
      <div class="li-main"><p class="li-title">${fmtDate(r.date)}${r.trail ? ' <span class="tag">trail</span>' : ""}</p><p class="li-sub">${E.fmtDuration(r.sec)}, ${E.fmtPace(r.sec / r.km)}/km${r.hr ? `, ${r.hr} bpm` : ""}${r.notes ? `<span class="was-inline">${esc(r.notes)}</span>` : ""}</p></div>
      <div class="li-end"><span>${km(r.km)}</span><span class="li-unit">km</span></div>
      <div class="li-actions"><select data-action="set-rpe" data-id="${esc(r.id)}" aria-label="Effort for ${fmtDate(r.date)}"><option value="">Effort</option>${Array.from({ length: 10 }, (_, i) => `<option value="${i + 1}" ${r.rpe === i + 1 ? "selected" : ""}>${i + 1}/10</option>`).join("")}</select><button class="link danger" data-action="delete-run" data-id="${esc(r.id)}">Delete</button></div>
    </div>`;
    return `${titleBar("Runs", runs.length ? `${runs.length} runs in your log.` : "")}
      <section class="import"><p class="a-title">Import from Garmin</p><p>On a computer, open Garmin Connect, go to Activities, then All Activities, scroll back as far as you want, and choose Export CSV. Importing again updates runs instead of duplicating them.</p>
        <div class="row">${importButton("Import Garmin CSV", "primary")}<button class="secondary" data-action="open-log">Log run</button></div></section>
      <section>${runs.length ? `<div class="list">${list.map(row).join("")}</div>${runs.length > 40 ? `<button class="link" data-action="toggle-runs">${showAllRuns ? "Show the latest 40" : `Show all ${runs.length}`}</button>` : ""}` : emptyState("No runs yet. Import your Garmin history or log today's run.", [["Import Garmin CSV", "import"], ["Log run", "open-log"]])}</section>`;
  }

  /* ---------- Settings ---------- */
  function viewSettings() {
    const s = S.settings;
    const f = (key, label, type = "number", step = "any", extra = "") => `<label class="row-item"><span>${label}</span><input type="${type}" step="${step}" data-setting="${key}" value="${esc(s[key])}" ${type === "number" ? 'inputmode="decimal"' : ""} ${extra}></label>`;
    return `${titleBar("Settings")}
      <section><h3>You</h3><div class="group">${f("weightKg", "Weight (kg)", "number", "0.1")}${f("maxHR", "Max heart rate", "number", "1")}</div></section>
      <section><h3>Race</h3><div class="group">${f("raceDate", "Race date", "date")}<label class="row-item"><span>Goal time</span><input type="text" data-setting="goalSec" data-duration="1" value="${E.fmtDuration(s.goalSec)}"></label>${f("planStart", "Plan start (Monday)", "date")}</div></section>
      <section><h3>Altitude</h3><div class="group">
        <label class="row-item"><span>Training at altitude</span><input type="checkbox" class="switch" data-setting="trainAtAltitude" ${s.trainAtAltitude ? "checked" : ""}></label>
        ${f("altPaceSec", "Pace add-on (s/km)", "number", "1")}${f("altTestPct", "Test correction (%)", "number", "0.1")}${f("riegel", "Riegel exponent", "number", "0.01")}</div>
        <p class="caption">Switch altitude off for training blocks at the coast so paces show at sea level.</p></section>
      <section><h3>Your data</h3><div class="group">
        <button class="row-item action" data-action="export"><span>Export backup</span><span class="val">${S.lastBackup ? `Last ${fmtDate(S.lastBackup.slice(0, 10), false)}` : "Never"}${ICON.chevron}</span></button>
        <label class="row-item action file-row"><span>Restore backup</span><span class="val">${ICON.chevron}</span><input type="file" accept=".json,application/json" data-action="restore"></label>
        <button class="row-item action" data-action="export-csv"><span>Export runs as CSV</span><span class="val">${ICON.chevron}</span></button></div>
        <p class="caption">Everything lives on this phone only. Export a backup weekly; restore it on any device.</p></section>
      <section><h3>Weekly review with Claude</h3><div class="group">
        <label class="row-item"><span>Anthropic API key</span><input type="password" data-setting="apiKey" value="${esc(s.apiKey)}" placeholder="sk-ant-…" autocomplete="off"></label>
        <label class="row-item"><span>Model</span><input type="text" data-setting="model" value="${esc(s.model)}"></label></div>
        <p class="caption">Optional. Sends your last 14 days, next 7 days and the plan's adjustments using your own key, which costs a few cents a review. The key stays on this device.</p>
        <button class="primary" data-action="review" ${reviewBusy ? "disabled" : ""}>${reviewBusy ? "Writing review…" : "Write this week's review"}</button>
        ${S.reviews.slice(0, 3).map((r) => `<article class="review"><p class="next-label">${fmtDate(r.date)}</p>${esc(r.text).split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("")}</article>`).join("")}
      </section>
      <section><div class="group"><button class="row-item action danger" data-action="reset"><span>Erase all data on this device</span></button></div></section>`;
  }

  /* ---------- sheets: log, run, week, checkpoint ---------- */
  const TICK = `<svg class="tick" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="24"/><path d="M15 27 l7 7 l15 -16"/></svg>`;

  function weekStats(C, wk) {
    const days = C.days.filter((d) => d.wk === wk);
    const runDays = days.filter((d) => d.km > 0);
    return {
      days,
      planned: days.reduce((a, d) => a + d.km, 0),
      actual: days.reduce((a, d) => a + actualOn(C, d.date), 0),
      runDays: runDays.length,
      doneDays: runDays.filter((d) => actualOn(C, d.date) > 0).length,
    };
  }
  const nextUp = (C, after) => C.days.find((d) => d.date > after && d.date >= TODAY && d.km > 0 && !(C.byDate[d.date] || []).length);
  const nextLine = (n) => (n ? `<div class="next"><p class="next-label">Next up, ${fmtDate(n.date)}</p><p class="next-desc">${withKm(n)}</p></div>` : "");
  const discoveriesBlock = (items) => (items.length ? `<div class="discover">${items.map((t) => `<p><span class="spark" aria-hidden="true"></span>${esc(t)}</p>`).join("")}</div>` : "");

  function rpeBlock(r) {
    return `<div class="rpe-wrap"><p class="rpe-q">How hard did that feel?</p>
      <div class="rpe" role="group" aria-label="Effort from 1 to 10">${Array.from({ length: 10 }, (_, i) => `<button class="${r.rpe === i + 1 ? "on" : ""}" data-action="sheet-rpe" data-v="${i + 1}" aria-pressed="${r.rpe === i + 1}">${i + 1}</button>`).join("")}</div>
      <div class="rpe-scale"><span>Very easy</span><span>All-out</span></div></div>`;
  }

  function estimateFor(C, iso, kmv) {
    const d = C.days.find((x) => x.date === iso);
    const k = Number(kmv) || (d && d.km) || 0;
    if (!k) return "h:mm:ss";
    const easyMid = (zone(C, "Easy (fast end)").now + zone(C, "Easy (slow end)").now) / 2;
    const pace = !d || d.zone === "Easy" || !d.zone ? easyMid : zone(C, "Steady").now;
    return `about ${E.fmtDuration(Math.round((k * pace) / 30) * 30)}`;
  }

  function logSheet(C, sh) {
    const date = sh.date || TODAY;
    const planned = C.days.find((d) => d.date === date);
    const kmPre = planned && planned.km ? planned.km : "";
    return `<h2 id="sheet-title">Log run</h2>
      ${planned ? `<p class="sheet-sub">${fmtDate(date)}: ${withKm(planned)}</p>` : ""}
      <form id="runform" class="form" autocomplete="off">
        <div class="group">
          <label class="row-item"><span>Date</span><input type="date" name="date" value="${date}" required></label>
          <label class="row-item"><span>Distance (km)</span><input type="number" name="km" step="0.01" min="0.1" inputmode="decimal" value="${kmPre}" required></label>
          <label class="row-item"><span>Time</span><input type="text" name="time" inputmode="numeric" placeholder="${esc(estimateFor(C, date, kmPre))}" required></label>
          <label class="row-item"><span>Average heart rate</span><input type="number" name="hr" min="60" max="230" inputmode="numeric" placeholder="optional"></label>
          <label class="row-item"><span>Notes</span><input type="text" name="notes" placeholder="optional"></label>
        </div>
        <div class="segmented" role="radiogroup" aria-label="Surface">${[["road", "Road"], ["trail", "Trail"], ["treadmill", "Treadmill"]]
          .map(([k, l], i) => `<label class="${i === 0 ? "on" : ""}"><input type="radio" name="surface" value="${k}" ${i === 0 ? "checked" : ""}>${l}</label>`)
          .join("")}</div>
        <button class="primary" type="submit">Log run</button>
      </form>`;
  }

  function isWeekEnd(C, run) {
    const d = C.days.find((x) => x.date === run.date);
    if (!d || (C.byDate[run.date] || []).length > 1) return false;
    const ws = weekStats(C, d.wk);
    return d.day === "Sun" || (d.km > 0 && ws.runDays > 0 && ws.doneDays >= ws.runDays);
  }

  function runSheet(C, sh) {
    const r = S.runs.find((x) => x.id === sh.runId);
    if (!r) return "";
    const d = C.days.find((x) => x.date === r.date);
    const lines = [];
    if (d && d.km > 0) {
      const diff = r.km - d.km;
      if (Math.abs(diff) <= Math.max(1, d.km * 0.1)) lines.push(`Right on plan: ${withKm(d)}.`);
      else if (diff > 0) lines.push(`${km(diff)} km more than the ${km(d.km)} km planned. Keep tomorrow as written rather than trimming it.`);
      else lines.push(`${km(-diff)} km short of the ${km(d.km)} km planned. That's fine; don't add it back later.`);
      if (d.zone === "Easy" && r.hr) {
        const capHr = zone(C, "Easy (fast end)").hrHi;
        lines.push(r.hr <= capHr ? `Heart rate ${r.hr}, under your ${capHr} easy cap. That's what builds the engine.` : `Heart rate ${r.hr}, above your ${capHr} easy cap. Run the next easy one slower so the sessions stay sharp.`);
      }
      if (d.type === "Quality") lines.push("Session done. These are the runs that move your marathon pace.");
      if (d.type === "Test") lines.push(`Add your official time and every pace updates. <button class="link" data-action="go" data-to="progress">Add result</button>`);
    } else if (d) {
      lines.push("A bonus run on a rest day. Keep it easy and keep the next session as planned.");
    }
    const ws = d ? weekStats(C, d.wk) : null;
    return `${TICK}<h2 id="sheet-title">Run logged</h2>
      <div class="facts"><div><span class="big">${km(r.km)}</span><span class="unit">km</span></div><div><span class="big">${E.fmtDuration(r.sec)}</span></div><div><span class="big">${E.fmtPace(r.sec / r.km)}</span><span class="unit">/km</span></div></div>
      ${discoveriesBlock(E.runDiscoveries(S.runs, r))}
      <div class="lines">${lines.map((l) => `<p>${l}</p>`).join("")}</div>
      ${ws ? `<div class="bar" aria-hidden="true"><span style="width:${Math.min(100, (ws.actual / Math.max(1, ws.planned)) * 100).toFixed(1)}%"></span></div>
        <p class="bar-label">Week ${d.wk}: ${ws.doneDays} of ${ws.runDays} runs, ${km(ws.actual)} of ${km(ws.planned)} km</p>` : ""}
      ${rpeBlock(r)}
      ${nextLine(nextUp(C, r.date))}`;
  }

  function weekSheet(C, sh) {
    const r = S.runs.find((x) => x.id === sh.runId);
    if (!r) return "";
    const d = C.days.find((x) => x.date === r.date);
    const wk = d.wk;
    const ws = weekStats(C, wk);
    const pct = ws.planned ? ws.actual / ws.planned : 0;
    const big = ws.days.filter((x) => actualOn(C, x.date) > 0 && ["Quality", "Long", "Test"].includes(x.orig.type)).sort((a, b) => b.orig.km - a.orig.km)[0];
    let streak = 0;
    for (let w = wk; w >= 1; w--) { const s = weekStats(C, w); if (s.planned && s.actual >= 0.85 * s.planned) streak++; else break; }
    const nw = wk < 32 ? SEED.weeks[wk] : null;
    const nwDays = nw ? C.days.filter((x) => x.wk === nw.wk) : [];
    const keys = nwDays.filter((x) => ["Quality", "Long", "Test", "Race"].includes(x.type) || (x.day === "Sun" && x.km > 0));
    const verdict = pct >= 0.95 ? "Every kilometre in." : pct >= 0.85 ? "A solid, complete week." : "A lighter week, and that's fine. Next week builds from what you actually ran.";
    const finds = E.runDiscoveries(S.runs, r);
    const wd = E.weekDiscovery(S.runs, ws.days[0].date);
    if (wd) finds.push(wd);
    return `${TICK}<h2 id="sheet-title">Week ${wk} done</h2>
      <div class="facts"><div><span class="big">${km(ws.actual)}</span><span class="unit">of ${km(ws.planned)} km</span></div><div><span class="big">${ws.doneDays}/${ws.runDays}</span><span class="unit">runs</span></div></div>
      <div class="bar" aria-hidden="true"><span style="width:${Math.min(100, pct * 100).toFixed(1)}%"></span></div>
      ${discoveriesBlock(finds)}
      <div class="lines"><p>${verdict}</p>
        ${big ? `<p>Biggest session: ${esc(big.orig.desc)}.</p>` : ""}
        ${streak >= 2 ? `<p>${streak} weeks in a row at 85% or more. That consistency is what gets you to 2:45.</p>` : ""}</div>
      ${rpeBlock(r)}
      ${nw ? `<div class="next"><p class="next-label">Week ${nw.wk}, ${PHASE[nw.phase]}, ${Math.round(nwDays.reduce((a, x) => a + x.km, 0))} km</p>${keys.map((k) => `<p class="next-desc"><span class="dot ${typeClass(k.type)}"></span>${k.day}: ${esc(k.desc)}</p>`).join("")}</div>` : ""}`;
  }

  function checkpointSheet(C, sh) {
    const c = S.checkpoints[sh.ci];
    if (!c || !c.actualSec) return "";
    const lines = [];
    if (c.targetSec) {
      const diff = c.actualSec - c.targetSec;
      lines.push(diff < 0 ? `${secs(diff)} under your ${E.fmtDuration(c.targetSec)} target.` : diff === 0 ? `Exactly on your ${E.fmtDuration(c.targetSec)} target.` : `${secs(diff)} off your ${E.fmtDuration(c.targetSec)} target.`);
    }
    const gain = Math.round(sh.beforeMp - sh.afterMp);
    if (gain > 0) lines.push(`Marathon pace is ${gain} s/km faster than your last benchmark.`);
    else if (gain < 0) lines.push(`${-gain} s/km slower than your last benchmark. One race is one day; the trend over the next block matters more.`);
    const gap = Math.round(C.model.mp - C.model.goalMp);
    lines.push(gap > 0 ? `${gap} s/km to find before race day.` : "You're on 2:45 pace.");
    lines.push("Every training pace has been updated.");
    const next = S.checkpoints.find((x, i) => i > sh.ci && !x.actualSec);
    return `<span class="chip t-test">New benchmark</span>
      <h2 id="sheet-title">${esc(c.name)}</h2>
      <div class="facts"><div><span class="big">${E.fmtDuration(c.actualSec)}</span></div></div>
      <div class="pred"><p class="next-label">Predicted marathon</p>
        <p class="pred-row"><span class="pred-from">${E.fmtDuration(sh.beforePred)}</span><span class="pred-arrow" aria-hidden="true"></span><span class="pred-to count" data-from="${Math.round(sh.beforePred)}" data-to="${Math.round(sh.afterPred)}">${E.fmtDuration(sh.afterPred)}</span></p></div>
      <div class="lines">${lines.map((l) => `<p>${l}</p>`).join("")}</div>
      ${next ? `<div class="next"><p class="next-label">Next benchmark, ${fmtDate(next.date)}</p><p class="next-desc">${esc(next.name)}${next.targetSec ? `, target ${E.fmtDuration(next.targetSec)}` : ""}</p></div>` : ""}`;
  }

  function sheetHTML(C) {
    if (!sheet) return "";
    const body = { log: logSheet, checkpoint: checkpointSheet, week: weekSheet, run: runSheet }[sheet.kind](C, sheet);
    if (!body) { sheet = null; return ""; }
    return `<div class="sheet-wrap ${sheet.shown ? "static" : ""}" data-action="sheet-backdrop"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title"><div class="grabber" aria-hidden="true"></div>${body}
      ${sheet.kind === "log" ? `<button class="link sheet-cancel" data-action="close-sheet-stay">Cancel</button>` : `<button class="primary" data-action="close-sheet">Done</button>`}</div></div>`;
  }

  function openSheet(s) {
    sheet = s;
    if (s.kind !== "log") buzz();
    render();
    if (s.kind === "log") {
      const t = document.querySelector('.sheet input[name="time"]');
      if (t && matchMedia("(hover: hover)").matches) t.focus({ preventScroll: true });
    }
  }
  function closeSheet(goToday) {
    sheet = null;
    if (goToday && route !== "today") location.hash = "#today";
    else render();
  }
  function animateCounts() {
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.querySelectorAll(".sheet .count").forEach((el) => {
      const from = Number(el.dataset.from), to = Number(el.dataset.to);
      if (reduce || from === to) return;
      const t0 = performance.now(), dur = 1100;
      const step = (t) => {
        const p = Math.min(1, (t - t0) / dur);
        el.textContent = E.fmtDuration(from + (to - from) * (1 - Math.pow(1 - p, 3)));
        if (p < 1) requestAnimationFrame(step);
      };
      el.textContent = E.fmtDuration(from);
      requestAnimationFrame(step);
    });
  }
  function logMoment(run) {
    const C = compute();
    openSheet({ kind: isWeekEnd(C, run) ? "week" : "run", runId: run.id });
  }

  /* ---------- render ---------- */
  const TITLES = { today: "Today", plan: "Plan", progress: "Progress", runs: "Runs", settings: "Settings" };
  function render() {
    const C = compute();
    const views = { today: viewToday, plan: viewPlan, progress: viewProgress, runs: viewRuns, settings: viewSettings };
    const scrollKeep = window.scrollY;
    app.innerHTML = views[route](C) + sheetHTML(C);
    if (route !== lastRoute) {
      app.classList.remove("enter");
      void app.offsetWidth;
      app.classList.add("enter");
      window.scrollTo(0, 0);
      lastRoute = route;
    } else window.scrollTo(0, scrollKeep);
    document.body.classList.toggle("has-sheet", !!sheet);
    document.body.dataset.route = route;
    if (sheet) sheet.shown = true;
    navbar.querySelector(".nb-title").textContent = TITLES[route];
    navbar.querySelector(".nb-back").hidden = route !== "settings";
    updateNavbar();
    if (sheet && sheet.kind === "checkpoint" && !sheet.animated) { sheet.animated = true; animateCounts(); }
    document.querySelectorAll(".tabs a").forEach((a) => a.setAttribute("aria-current", a.dataset.tab === route ? "page" : "false"));
  }
  function updateNavbar() { navbar.classList.toggle("show", window.scrollY > 64); }
  window.addEventListener("scroll", updateNavbar, { passive: true });

  /* ---------- events ---------- */
  window.addEventListener("hashchange", () => {
    const h = (location.hash || "#today").slice(1);
    if (h === "log") { history.replaceState(null, "", "#" + route); openSheet({ kind: "log" }); return; }
    route = parseRoute();
    sheet = sheet && sheet.kind !== "log" ? null : sheet;
    render();
  });
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvent = e; if (route === "today") render(); });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && sheet) closeSheet(false);
    if ((e.key === "Enter" || e.key === " ") && e.target.matches && e.target.matches('.li[role="button"]')) { e.preventDefault(); e.target.click(); }
  });

  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-action]");
    if (!b || b.tagName === "INPUT" || b.tagName === "SELECT") return;
    const a = b.dataset.action;
    if (a === "go") { sheet = null; location.hash = `#${b.dataset.to}`; }
    if (a === "back") { if (history.length > 1) history.back(); else location.hash = "#today"; }
    if (a === "open-log") { openSheet({ kind: "log", date: b.dataset.date || TODAY }); }
    if (a === "plan-seg") { planSeg = b.dataset.seg; render(); }
    if (a === "toggle-week") { const w = Number(b.dataset.wk); const C = compute(); const isCur = C.started && C.curWk === w; openWeek = openWeek === w || (openWeek === null && isCur) ? -1 : w; render(); }
    if (a === "set-mode") { const w = b.dataset.wk; if (b.dataset.mode === "normal") delete S.weekModes[w]; else S.weekModes[w] = b.dataset.mode; save(); render(); toast(b.dataset.mode === "normal" ? `Week ${w} back to plan` : `Week ${w} set to ${b.dataset.mode} mode`); }
    if (a === "dismiss-flag") { S.dismissedFlags[b.dataset.id] = true; save(); render(); toast("Flag ignored"); }
    if (a === "dismiss-install") { S.installDismissed = true; save(); render(); }
    if (a === "install" && installEvent) { installEvent.prompt(); installEvent.userChoice.finally(() => { installEvent = null; render(); }); }
    if (a === "delete-run") { if (confirm("Delete this run?")) { S.runs = S.runs.filter((r) => r.id !== b.dataset.id); save(); render(); toast("Run deleted"); } }
    if (a === "toggle-runs") { showAllRuns = !showAllRuns; render(); }
    if (a === "export") {
      S.lastBackup = new Date().toISOString(); save();
      download(`ctm27-backup-${TODAY}.json`, JSON.stringify(S, null, 1), "application/json");
      render(); toast("Backup exported");
    }
    if (a === "export-csv") {
      const lines = ["date,time,km,seconds,avg_hr,rpe,trail,ascent,notes"].concat(
        S.runs.map((r) => [r.date, r.time || "", r.km, r.sec, r.hr || "", r.rpe || "", r.trail ? 1 : 0, r.ascent || "", `"${(r.notes || "").replace(/"/g, '""')}"`].join(","))
      );
      download(`ctm27-runs-${TODAY}.csv`, lines.join("\n"), "text/csv");
    }
    if (a === "reset") { if (confirm("Erase every run, result and setting on this device? Export a backup first if you might want it.")) { S = E.defaultState(); save(); render(); toast("Everything erased"); } }
    if (a === "review") runReview();
    if (a === "close-sheet") closeSheet(true);
    if (a === "close-sheet-stay") closeSheet(false);
    if (a === "sheet-backdrop" && e.target === b) closeSheet(false);
    if (a === "sheet-rpe" && sheet) {
      const r = S.runs.find((x) => x.id === sheet.runId);
      if (r) { r.rpe = Number(b.dataset.v); save(); render(); }
    }
  });

  document.addEventListener("input", (e) => {
    const t = e.target;
    if (!sheet || sheet.kind !== "log" || !t.form || t.form.id !== "runform") return;
    if (t.name === "km" || t.name === "date") {
      const C = compute();
      t.form.time.placeholder = estimateFor(C, t.form.date.value, t.form.km.value);
    }
  });

  document.addEventListener("change", (e) => {
    const t = e.target;
    if (t.name === "surface") {
      t.closest(".segmented").querySelectorAll("label").forEach((l) => l.classList.toggle("on", l.contains(t)));
      return;
    }
    if (t.dataset.action === "import-csv" && t.files[0]) {
      t.files[0].text().then((txt) => {
        try {
          const before = new Set(S.runs.map((x) => x.id));
          const incoming = E.importGarminCSV(txt);
          const r = E.mergeRuns(S.runs, incoming);
          S.runs = r.runs;
          S.lastImport = new Date().toISOString();
          save();
          toast(`Imported ${r.added} new runs${r.updated ? `, updated ${r.updated}` : ""}`);
          const fresh = S.runs.filter((x) => !before.has(x.id) && x.date >= S.settings.planStart && x.date <= TODAY).sort((a, b) => (a.date + (a.time || "") < b.date + (b.time || "") ? 1 : -1))[0];
          if (fresh) logMoment(fresh); else render();
        } catch (err) { toast(err.message); }
      });
    }
    if (t.dataset.action === "restore" && t.files[0]) {
      t.files[0].text().then((txt) => {
        try {
          const data = JSON.parse(txt);
          if (!data || !data.settings) throw new Error("bad");
          if (!confirm(`Replace everything on this device with this backup (${(data.runs || []).length} runs)?`)) return;
          S = E.migrate(data); save(); render(); toast("Backup restored");
        } catch (err) { toast("That isn't a backup from this app. Choose the ctm27-backup-….json file you exported."); }
      });
    }
    if (t.dataset.action === "set-rpe") {
      const r = S.runs.find((x) => x.id === t.dataset.id);
      if (r) { r.rpe = t.value ? Number(t.value) : null; save(); toast("Effort saved"); }
    }
    if (t.dataset.race) {
      const v = E.parseDuration(t.value);
      if (!v) { toast("Type your finish time as h:mm:ss, for example 2:44:10."); return; }
      S.race.resultSec = v; save(); buzz(); render();
    }
    if (t.dataset.setting) {
      const k = t.dataset.setting;
      let v;
      if (t.type === "checkbox") v = t.checked;
      else if (t.dataset.duration) { v = E.parseDuration(t.value); if (!v) { toast("Type the goal as h:mm:ss, for example 2:45:00."); return; } }
      else if (t.type === "number") v = t.value === "" ? 0 : Number(t.value);
      else v = t.value;
      if ((k === "planStart" || k === "raceDate") && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
      S.settings[k] = v; save();
      if (k !== "apiKey" && k !== "model") render();
    }
    if (t.dataset.cp != null) {
      const c = S.checkpoints[Number(t.dataset.cp)];
      const f = t.dataset.field;
      if (f === "actualSec") {
        const v = t.value.trim() ? E.parseDuration(t.value) : null;
        if (t.value.trim() && !v) { toast("Type the time as mm:ss or h:mm:ss, for example 19:05."); return; }
        const was = E.paceModel(S, TODAY);
        c.actualSec = v;
        save();
        if (v) {
          const now = E.paceModel(S, TODAY);
          openSheet({ kind: "checkpoint", ci: Number(t.dataset.cp), beforePred: was.predicted, afterPred: now.predicted, beforeMp: was.mp, afterMp: now.mp });
        } else { render(); toast("Result cleared"); }
        return;
      } else if (f === "altitude") c.altitude = t.checked;
      else if (f === "date" && t.value) c.date = t.value;
      save(); render();
    }
  });

  document.addEventListener("submit", (e) => {
    if (e.target.id !== "runform") return;
    e.preventDefault();
    const f = new FormData(e.target);
    const sec = E.parseDuration(f.get("time"));
    const kmv = parseFloat(f.get("km"));
    if (!sec || !kmv) { toast("Add a distance and a time like 58:30."); return; }
    const surface = f.get("surface");
    const run = {
      id: `m:${Date.now()}`, date: f.get("date"), time: "", km: Math.round(kmv * 100) / 100, sec: Math.round(sec),
      hr: f.get("hr") ? Number(f.get("hr")) : null, rpe: null,
      trail: surface === "trail", treadmill: surface === "treadmill", ascent: null, notes: f.get("notes") || "", source: "manual",
    };
    S.runs.push(run);
    save();
    logMoment(run);
  });

  /* swipe a sheet down to close it */
  let drag = null;
  document.addEventListener("touchstart", (e) => {
    const s = e.target.closest(".sheet");
    if (!s || s.scrollTop > 0 || e.target.closest("input, select, textarea")) return;
    drag = { el: s, y0: e.touches[0].clientY, dy: 0 };
  }, { passive: true });
  document.addEventListener("touchmove", (e) => {
    if (!drag) return;
    drag.dy = Math.max(0, e.touches[0].clientY - drag.y0);
    drag.el.style.transform = `translateY(${drag.dy}px)`;
  }, { passive: true });
  document.addEventListener("touchend", () => {
    if (!drag) return;
    const { el, dy } = drag;
    drag = null;
    if (dy > 110) closeSheet(false);
    else { el.style.transition = "transform 0.2s"; el.style.transform = ""; setTimeout(() => { el.style.transition = ""; }, 220); }
  });

  /* ---------- Claude review ---------- */
  const REVIEW_SYSTEM = `You are reviewing two weeks of a runner's training against a 32-week sub-2:45 plan for the Sanlam Cape Town Marathon (23 May 2027). The runner is 23, 66 kg, trains at Johannesburg altitude (~1,700 m), has a strong trail/ultra background, and has historically lost consistency over December holidays. The app's rules engine has already applied the adjustments listed in "alerts"; don't repeat them, build on them.
Write a short review in plain language, under 250 words, with three parts: what went well, what to watch, and specific changes for the next 7 days (sessions, paces, volume, sleep or fuelling). Use the actual numbers. Don't restructure the plan; work within it. If anything suggests injury or illness, say to see a physio or doctor.`;

  async function runReview() {
    const s = S.settings;
    if (!s.apiKey) { toast("Add your Anthropic API key first."); return; }
    reviewBusy = true; render();
    try {
      const payload = E.reviewPayload(SEED, S, TODAY);
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": s.apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify({ model: s.model, max_tokens: 1200, system: REVIEW_SYSTEM, messages: [{ role: "user", content: `My training data:\n${JSON.stringify(payload)}` }] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(res.status === 401 ? "The API key was rejected. Check it in Settings." : (data.error && data.error.message) || `Request failed (${res.status}). Try again in a minute.`);
      const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
      if (!text) throw new Error("Claude returned an empty review. Try again.");
      S.reviews.unshift({ date: TODAY, text });
      S.reviews = S.reviews.slice(0, 12);
      save();
      toast("Review saved");
    } catch (err) {
      toast(err.message || "Couldn't reach the API. Check your connection and try again.");
    } finally {
      reviewBusy = false; render();
    }
  }

  /* ---------- boot ---------- */
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js").catch(() => {});
  if ((location.hash || "").slice(1) === "log") { history.replaceState(null, "", "#today"); route = "today"; sheet = { kind: "log" }; }
  render();
})();
