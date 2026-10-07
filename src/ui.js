/* UI — renders state, handles input. Depends on Engine and SEED. */
(() => {
  const E = Engine;
  const KEY = "ctm27-training-v1";
  const params = new URLSearchParams(location.search);
  const TODAY = /^\d{4}-\d{2}-\d{2}$/.test(params.get("today") || "") ? params.get("today") : E.todayISO();
  const app = document.getElementById("app");
  const toastEl = document.getElementById("toast");

  let S = load();
  let tab = (location.hash || "#today").slice(1);
  let openWeek = null;
  let showAllRuns = false;
  let reviewBusy = false;
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
      toast("This browser wouldn't save. Export a backup from Setup now.");
    }
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
  const PHASE = {
    Recover: "recovery", Base: "base building", Down: "down week", Holiday: "holiday week", Build: "build",
    Specific: "marathon-specific", Checkpoint: "half marathon week", Peak: "peak", Taper: "taper", Race: "race week",
  };
  const STRENGTH = {
    A: "Strength A: split squats, single-leg RDL, calf raises, Copenhagen plank",
    B: "Strength B: step-downs, soleus raises, hip thrust, side plank, dead bug",
  };
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const hm = (sec) => `${Math.floor(sec / 3600)}:${String(Math.floor((sec % 3600) / 60)).padStart(2, "0")}`;
  const typeClass = (t) => ({ Rest: "t-rest", Easy: "t-easy", Quality: "t-quality", Long: "t-long", Test: "t-test", Race: "t-race", "Carb load": "t-race" }[t] || "t-easy");

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

  /* ---------- charts ---------- */
  function svgProfile(C) {
    const W = 640, H = 170, pl = 8, pr = 8, pt = 26, pb = 26;
    const n = 32;
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
    const flags = [[4, "5 km"], [14, "10 km"], [23, "Half"], [32, "Cape Town"]]
      .map(([wk, label]) => {
        const xx = x(wk - 1), yy = y(planned[wk - 1]);
        const anchor = wk === 32 ? "end" : "middle";
        return `<line x1="${xx}" x2="${xx}" y1="${yy}" y2="${yy - 14}" class="p-flagpole"/><path d="M${xx},${yy - 14} l${wk === 32 ? -9 : 9},3.5 l${wk === 32 ? 9 : -9},3.5z" class="p-flag"/><text x="${wk === 32 ? xx - 2 : xx}" y="${yy - 18}" text-anchor="${anchor}" class="p-label">${label}</text>`;
      })
      .join("");
    const months = [];
    for (let i = 0; i < n; i++) {
      const d = E.fromISO(E.addDays(S.settings.planStart, i * 7));
      const prev = i ? E.fromISO(E.addDays(S.settings.planStart, (i - 1) * 7)) : null;
      if (!prev || prev.getMonth() !== d.getMonth()) months.push(`<text x="${x(i)}" y="${H - 8}" class="p-month">${MON[d.getMonth()]}</text>`);
    }
    const marker = cur
      ? `<line x1="${x(cur - 1)}" x2="${x(cur - 1)}" y1="${pt - 6}" y2="${H - pb}" class="p-now"/><circle cx="${x(cur - 1)}" cy="${y(planned[cur - 1])}" r="5" class="p-nowdot"/>`
      : "";
    return `<svg viewBox="0 0 ${W} ${H}" class="profile" role="img" aria-label="Weekly volume from October to May. Peak ${Math.round(Math.max(...planned))} km in week ${planned.indexOf(Math.max(...planned)) + 1}.">
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
    if (pts.length < 3) return `<p class="empty">Needs at least 3 road runs at 125–162 bpm in the last 6 months. Import your Garmin CSV or log runs with heart rate.</p>`;
    const W = 640, H = 200, pl = 42, pr = 8, pt = 10, pb = 24;
    const vals = pts.map((p) => p.p150);
    const lo = Math.min(...vals) - 10, hi = Math.max(...vals) + 10;
    const t0 = E.fromISO(from).getTime(), t1 = E.fromISO(TODAY).getTime();
    const x = (iso) => pl + ((E.fromISO(iso).getTime() - t0) / (t1 - t0)) * (W - pl - pr);
    const y = (v) => pt + ((v - lo) / (hi - lo)) * (H - pt - pb); // faster = higher
    let s = "";
    const step = (hi - lo) > 90 ? 30 : 15;
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
      <p class="caption">Higher is fitter. Rolling median ${E.fmtPace(last)}/km at 150 bpm, ${delta >= 0 ? `${delta} s/km faster` : `${-delta} s/km slower`} than six months ago. Trail runs and hilly runs (over 25 m/km) are left out.</p>`;
  }

  function svgLoad() {
    const N = 84, W = 640, H = 170, pl = 34, pr = 8, pt = 10, pb = 24;
    const series = [];
    for (let i = N - 1; i >= 0; i--) {
      const d = E.addDays(TODAY, -i);
      const l = E.loadRatio(S.runs, d);
      series.push([d, l.ratio]);
    }
    if (series.filter((s) => s[1] != null).length < 7) return `<p class="empty">Needs about four weeks of logged running before the load ratio means anything.</p>`;
    const max = 2;
    const x = (i) => pl + (i / (N - 1)) * (W - pl - pr);
    const y = (v) => pt + (H - pt - pb) * (1 - Math.min(v, max) / max);
    let s = `<rect x="${pl}" y="${y(1.3)}" width="${W - pl - pr}" height="${y(0.8) - y(1.3)}" class="band"/>`;
    for (const g of [0.5, 1, 1.5]) s += `<line x1="${pl}" x2="${W - pr}" y1="${y(g)}" y2="${y(g)}" class="grid"/><text x="${pl - 6}" y="${y(g) + 4}" text-anchor="end" class="axis">${g.toFixed(1)}</text>`;
    let path = "", pen = false;
    series.forEach(([d, v], i) => {
      if (v == null) { pen = false; return; }
      path += `${pen ? "L" : "M"}${x(i)},${y(v)} `;
      pen = true;
    });
    s += `<path d="${path}" class="trend"/>`;
    series.forEach(([d], i) => { if (E.fromISO(d).getDate() === 1) s += `<text x="${x(i)}" y="${H - 8}" class="axis">${MON[E.fromISO(d).getMonth()]}</text>`; });
    return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Load ratio over the last 12 weeks">${s}</svg>
      <p class="caption">Last 7 days against your 4-week average. The shaded band (0.8–1.3) is the safe zone; above it, the engine trims easy runs.</p>`;
  }

  /* ---------- views ---------- */
  function sessionBlock(C, d) {
    const t = E.targetFor(d, C.zs, C.model);
    const n = E.nutritionFor(d, S.settings);
    const ran = C.byDate[d.date] || [];
    const week = SEED.weeks[d.wk - 1];
    const facts = [];
    if (d.km > 0) facts.push(`<div><span class="big">${km(d.km)}</span><span class="unit">km</span></div>`);
    const unit = t.text === "By effort" ? "" : d.zone === "Easy" || d.zone === "Race" ? "/km" : d.type === "Quality" || d.type === "Test" ? "/km for the reps" : "/km for the fast part";
    if (t.text) facts.push(`<div><span class="big">${esc(t.text)}</span><span class="unit">${unit}</span></div>`);
    if (t.hr) facts.push(`<div><span class="big hr">${esc(t.hr)}</span><span class="unit">bpm</span></div>`);
    const extras = [];
    if (d.str) extras.push(`<li>${esc(STRENGTH[d.str])}</li>`);
    extras.push(`<li>Eat about ${n.carbs} g carbs and ${n.protein} g protein today.</li>`);
    if (d.fuel > 0 && d.km >= 15) extras.push(`<li>Fuel ${d.fuel} g of carbs per hour. Product: ${esc(week.product)}.</li>`);
    if (d.type === "Race") extras.push(`<li>Race plan is under Setup: carb load, breakfast, gels and splits.</li>`);
    const adjusted = d.km !== d.orig.km || d.desc !== d.orig.desc;
    return `<section class="session ${typeClass(d.type)}">
      <p class="when">${d.date === TODAY ? "Today" : fmtDate(d.date)}${d.date === TODAY ? `, ${fmtDate(d.date)}` : ""}</p>
      <h2>${esc(d.desc)}</h2>
      ${adjusted ? `<p class="was">Planned: ${esc(d.orig.desc)}${d.orig.km ? `, ${km(d.orig.km)} km` : ""}. ${esc(d.notes.join(". "))}.</p>` : ""}
      ${facts.length ? `<div class="facts">${facts.join("")}</div>` : ""}
      <ul class="extras">${extras.join("")}</ul>
      ${ran.length ? `<p class="logged">Logged: ${ran.map((r) => `${km(r.km)} km in ${E.fmtDuration(r.sec)}${r.hr ? ` at ${r.hr} bpm` : ""}`).join(", ")}</p>` : d.km > 0 ? `<button class="primary" data-action="go-log" data-date="${d.date}">Log this run</button>` : ""}
    </section>`;
  }

  function alertsBlock(C) {
    const items = [...C.alerts];
    const lb = S.lastBackup;
    if (S.runs.length && (!lb || E.diffDays(lb.slice(0, 10), TODAY) > 7)) {
      items.push({ level: "info", rule: "backup", title: lb ? `Last backup ${fmtDate(lb.slice(0, 10), false)}` : "No backup yet", body: "Your log lives only in this browser. Export a backup file so a cleared browser or new phone doesn't lose it.", backup: true });
    }
    if (!items.length) return "";
    return `<section class="alerts"><h3>Adjustments</h3>${items
      .map(
        (a) => `<div class="alert a-${a.level}"><p class="a-title">${esc(a.title)}</p><p>${esc(a.body)}</p>
        ${a.flags ? `<ul class="flags">${a.flags.map((f) => `<li>${fmtDate(f.date)}: ${esc(f.why)} <button class="link" data-action="dismiss-flag" data-id="${esc(f.id)}">Not fatigue, ignore</button></li>`).join("")}</ul>` : ""}
        ${a.backup ? `<button class="secondary" data-action="export">Export backup</button>` : ""}</div>`
      )
      .join("")}</section>`;
  }

  function weekTable(C, wk, focusDate) {
    const days = C.days.filter((d) => d.wk === wk);
    return `<table class="week"><thead><tr><th>Day</th><th>Session</th><th class="n">Plan</th><th class="n">Run</th></tr></thead><tbody>
      ${days
        .map((d) => {
          const a = actualOn(C, d.date);
          const adj = d.km !== d.orig.km || d.desc !== d.orig.desc;
          const past = d.date < TODAY;
          const status = a > 0 ? "done" : past && d.km > 0 ? "missed" : "";
          return `<tr class="${d.date === focusDate ? "is-today" : ""} ${status}">
            <td class="d"><span class="dot ${typeClass(d.type)}"></span>${fmtDate(d.date)}</td>
            <td>${esc(d.desc)}${d.str ? ` <span class="tag">${d.str}</span>` : ""}${adj ? `<span class="was-inline">was: ${esc(d.orig.desc)}${d.orig.km ? `, ${km(d.orig.km)} km` : ""}</span>` : ""}</td>
            <td class="n">${d.km ? km(d.km) : ""}</td><td class="n">${a ? km(a) : status === "missed" ? "–" : ""}</td></tr>`;
        })
        .join("")}
      </tbody><tfoot><tr><td></td><td>Total</td><td class="n">${km(weekPlanned(C, wk))}</td><td class="n">${km(weekActual(C, wk))}</td></tr></tfoot></table>`;
  }

  function viewToday(C) {
    const s = S.settings;
    const toGo = Math.max(0, E.diffDays(TODAY, s.raceDate));
    const wk = C.started ? C.curWk : 1;
    const week = SEED.weeks[wk - 1];
    const focus = C.started ? C.days.find((d) => d.date === TODAY) : C.days[0];
    const after = TODAY > s.raceDate;
    return `
      <header class="hero">
        <p class="kicker">Sanlam Cape Town Marathon, ${fmtDate(s.raceDate)} 2027</p>
        <h1>${after ? "Race done." : `${toGo} days to go.`}</h1>
        <p class="sub">${C.started ? `Week ${wk} of 32, ${PHASE[week.phase]}. ` : `The plan starts ${fmtDate(s.planStart)}. `}Goal ${E.fmtDuration(s.goalSec)}, currently tracking ${E.fmtDuration(C.model.predicted)}.</p>
        ${svgProfile(C)}
      </header>
      ${focus ? sessionBlock(C, focus) : ""}
      ${alertsBlock(C)}
      <section><h3>${C.started ? "This week" : "Week 1"}</h3>${week.notes ? `<p class="note">${esc(week.notes)}</p>` : ""}${weekTable(C, wk, focus && focus.date)}</section>`;
  }

  function viewPlan(C) {
    const rows = SEED.weeks
      .map((w) => {
        const days = C.days.filter((d) => d.wk === w.wk);
        const start = days[0].date, end = days[6].date;
        const p = weekPlanned(C, w.wk), o = weekOrig(w.wk), a = weekActual(C, w.wk);
        const mode = S.weekModes[w.wk] || "normal";
        const isCur = C.started && w.wk === C.curWk;
        const open = openWeek === w.wk || (openWeek === null && isCur);
        const sun = days.find((d) => d.day === "Sun");
        return `<li class="wk ${isCur ? "current" : ""} ph-${w.phase.toLowerCase()}">
          <button class="wk-head" data-action="toggle-week" data-wk="${w.wk}" aria-expanded="${open}">
            <span class="wk-n">${w.wk}</span>
            <span class="wk-main"><span class="wk-title">${fmtDate(start, false)} to ${fmtDate(end, false)}</span><span class="wk-sub">${esc(cap(PHASE[w.phase]))}${mode !== "normal" ? `, ${mode} mode` : ""}. Long run: ${esc(sun.desc)}</span></span>
            <span class="wk-km">${Math.round(p)}${p !== o ? `<s>${Math.round(o)}</s>` : ""}<small>${a ? `${Math.round(a)} run` : "km"}</small></span>
          </button>
          ${open ? `<div class="wk-body">
            <div class="modes" role="radiogroup" aria-label="Week ${w.wk} mode">
              ${[["normal", "As planned"], ["holiday", "Holiday (4 runs, ≥35 km)"], ["crunch", "Crunch (4 days, ≤65 km)"]]
                .map(([k, l]) => `<button role="radio" aria-checked="${mode === k}" class="${mode === k ? "on" : ""}" data-action="set-mode" data-wk="${w.wk}" data-mode="${k}">${l}</button>`)
                .join("")}
            </div>
            ${w.notes ? `<p class="note">${esc(w.notes)}</p>` : ""}
            ${weekTable(C, w.wk)}
            ${w.fuel ? `<p class="note">Long-run fuel: ${w.fuel} g/h. Product: ${esc(w.product)}.</p>` : ""}
          </div>` : ""}
        </li>`;
      })
      .join("");
    return `<header class="page"><h1>Plan</h1><p class="sub">32 weeks, ${Math.round(C.days.reduce((a, d) => a + d.km, 0))} km. Crossed-out numbers are what the engine changed. Set holiday or crunch mode per week.</p></header><ol class="weeks">${rows}</ol>`;
  }

  function viewLog(C) {
    const prefill = sessionStorage.getItem("prefillDate") || TODAY;
    sessionStorage.removeItem("prefillDate");
    const planned = C.days.find((d) => d.date === prefill);
    const runs = S.runs.slice().sort((a, b) => (a.date + (a.time || "") < b.date + (b.time || "") ? 1 : -1));
    const list = showAllRuns ? runs : runs.slice(0, 40);
    return `<header class="page"><h1>Log</h1><p class="sub">Add a run by hand or import Garmin's Activities CSV. Re-importing updates runs without duplicating them.</p></header>
      <section>
        <form id="runform" class="form" autocomplete="off">
          <div class="grid2">
            <label>Date<input type="date" name="date" value="${prefill}" required></label>
            <label>Distance (km)<input type="number" name="km" step="0.01" min="0.1" inputmode="decimal" value="${planned && planned.km ? planned.km : ""}" required></label>
            <label>Time (h:mm:ss)<input type="text" name="time" placeholder="58:30" inputmode="numeric" required></label>
            <label>Average HR<input type="number" name="hr" min="60" max="230" inputmode="numeric" placeholder="optional"></label>
            <label>Effort (RPE 1–10)<select name="rpe"><option value="">–</option>${Array.from({ length: 10 }, (_, i) => `<option>${i + 1}</option>`).join("")}</select></label>
            <label>Surface<select name="surface"><option value="road">Road</option><option value="trail">Trail</option><option value="treadmill">Treadmill</option></select></label>
          </div>
          <label>Notes<input type="text" name="notes" placeholder="How it felt, niggles, conditions"></label>
          ${planned ? `<p class="hint">Planned for ${fmtDate(prefill)}: ${esc(planned.desc)}${planned.km ? `, ${km(planned.km)} km` : ""}.</p>` : ""}
          <button class="primary" type="submit">Save run</button>
        </form>
      </section>
      <section class="import">
        <h3>Import from Garmin</h3>
        <p>Garmin Connect on the web: Activities, All Activities, scroll to load the period you want, then Export CSV.</p>
        <label class="file secondary">Choose Activities CSV<input type="file" accept=".csv,text/csv" data-action="import-csv"></label>
      </section>
      <section>
        <h3>Runs (${runs.length})</h3>
        ${runs.length ? `<table class="runs"><thead><tr><th>Date</th><th class="n">km</th><th class="n">Time</th><th class="n">Pace</th><th class="n">HR</th><th>RPE</th><th></th></tr></thead><tbody>
          ${list
            .map(
              (r) => `<tr><td class="nw">${fmtDate(r.date, false)}${r.trail ? ' <span class="tag">trail</span>' : ""}${r.notes ? `<span class="was-inline">${esc(r.notes)}</span>` : ""}</td>
              <td class="n">${km(r.km)}</td><td class="n">${E.fmtDuration(r.sec)}</td><td class="n">${E.fmtPace(r.sec / r.km)}</td><td class="n">${r.hr || "–"}</td>
              <td><select data-action="set-rpe" data-id="${esc(r.id)}" aria-label="RPE for ${fmtDate(r.date)}"><option value="">–</option>${Array.from({ length: 10 }, (_, i) => `<option ${r.rpe === i + 1 ? "selected" : ""}>${i + 1}</option>`).join("")}</select></td>
              <td><button class="link danger" data-action="delete-run" data-id="${esc(r.id)}" aria-label="Delete run on ${fmtDate(r.date)}">Delete</button></td></tr>`
            )
            .join("")}
        </tbody></table>${runs.length > 40 ? `<button class="link" data-action="toggle-runs">${showAllRuns ? "Show the latest 40" : `Show all ${runs.length}`}</button>` : ""}` : `<p class="empty">No runs yet. Import your Garmin CSV to bring in your history; the engine uses it for heart-rate trends.</p>`}
      </section>`;
  }

  function viewTrends(C) {
    const m = C.model;
    const cps = S.checkpoints;
    return `<header class="page"><h1>Trends</h1><p class="sub">Predicted marathon ${E.fmtDuration(m.predicted)} from your ${esc(m.latest.name)} result${Math.round(m.drift) ? `, ${Math.abs(Math.round(m.drift))} s/km ${m.drift < 0 ? "faster" : "slower"} from your heart-rate trend since` : ""}. Goal pace ${E.fmtPace(m.goalMp)}/km.</p></header>
      <section><h3>Weekly volume</h3>${svgWeekly(C)}</section>
      <section><h3>Easy pace at 150 bpm</h3>${svgEff()}</section>
      <section><h3>Load ratio</h3>${svgLoad()}</section>
      <section><h3>Checkpoints</h3><table class="runs"><thead><tr><th>Test</th><th>Date</th><th class="n">Target</th><th class="n">Result</th><th class="n">Marathon</th></tr></thead><tbody>
        ${cps.map((c) => {
          const sea = c.actualSec ? (c.altitude ? c.actualSec / (1 + S.settings.altTestPct / 100) : c.actualSec) : null;
          const pred = sea ? sea * Math.pow(E.MARATHON / c.km, S.settings.riegel) : null;
          return `<tr><td>${esc(c.name)}</td><td>${fmtDate(c.date, false)}</td><td class="n">${c.targetSec ? E.fmtDuration(c.targetSec) : "–"}</td><td class="n">${c.actualSec ? E.fmtDuration(c.actualSec) : "–"}</td><td class="n">${pred ? E.fmtDuration(pred) : "–"}</td></tr>`;
        }).join("")}
      </tbody></table><p class="caption">Enter results under Setup. The latest one resets every training pace.</p></section>`;
  }

  function viewSetup(C) {
    const s = S.settings;
    const m = C.model;
    const W = s.weightKg;
    const goalPace = s.goalSec / E.MARATHON;
    const gelCarbs = E.GELS.reduce((a, g) => a + g.carbs, 0);
    const gelCaf = E.GELS.reduce((a, g) => a + g.caffeine, 0) + (Number(s.preRaceCaffeine) || 0);
    const cafKg = gelCaf / W;
    const field = (key, label, type = "number", step = "any", extra = "") => `<label>${label}<input type="${type}" step="${step}" data-setting="${key}" value="${esc(s[key])}" ${extra}></label>`;
    return `<header class="page"><h1>Setup</h1><p class="sub">Results, paces, nutrition, race day and backups.</p></header>
      <section><h3>Checkpoint results</h3><p class="hint">Type a time like 19:05 or 1:18:30. The most recent result sets your paces.</p>
        <div class="cps">${S.checkpoints
          .map(
            (c, i) => `<div class="cp"><p class="cp-name">${esc(c.name)}<span>${fmtDate(c.date)}${c.targetSec ? `, target ${E.fmtDuration(c.targetSec)}` : ""}</span></p>
          <label>Result<input type="text" inputmode="numeric" data-cp="${i}" data-field="actualSec" value="${c.actualSec ? E.fmtDuration(c.actualSec) : ""}" placeholder="h:mm:ss"></label>
          <label>Date<input type="date" data-cp="${i}" data-field="date" value="${c.date}"></label>
          <label class="check"><input type="checkbox" data-cp="${i}" data-field="altitude" ${c.altitude ? "checked" : ""}> Run at altitude (Joburg)</label></div>`
          )
          .join("")}</div>
      </section>
      <section><h3>Paces</h3><p class="hint">Based on your ${esc(m.latest.name)} result${Math.round(m.drift) ? ` with ${Math.round(m.drift)} s/km heart-rate drift (${m.curN} recent runs vs ${m.refN} reference runs)` : ""}. ${s.trainAtAltitude ? `Joburg column adds ${s.altPaceSec} s/km to steady and faster paces.` : ""}</p>
        <table class="runs"><thead><tr><th>Zone</th><th class="n">Now</th><th class="n">Goal</th><th class="n">HR</th></tr></thead><tbody>
          ${C.zs.map((z) => `<tr><td>${esc(z.key)}<span class="was-inline">${esc(z.feel)}</span></td><td class="n">${E.fmtPace(z.now)}${z.now !== z.nowSea ? `<span class="was-inline">${E.fmtPace(z.nowSea)} sea level</span>` : ""}</td><td class="n">${E.fmtPace(z.goalSea)}</td><td class="n">${z.hrLo}–${z.hrHi}</td></tr>`).join("")}
        </tbody></table></section>
      <section><h3>Daily nutrition</h3><table class="runs"><thead><tr><th>Day type</th><th class="n">Carbs (g)</th><th class="n">Protein (g)</th></tr></thead><tbody>
        ${Object.keys(E.NUTRITION).map((t) => { const n = E.nutritionFor({ type: t }, s); return `<tr><td><span class="dot ${typeClass(t)}"></span>${t}</td><td class="n">${n.carbs}</td><td class="n">${n.protein}</td></tr>`; }).join("")}
      </tbody></table><p class="caption">General sports-nutrition ranges scaled to ${W} kg. If your weight drops more than 1–1.5 kg in a month, eat more.</p></section>
      <section><h3>Race day</h3>
        <p>Carb load Friday ${fmtDate(E.addDays(s.raceDate, -2), false)} and Saturday: about ${Math.round((9 * W) / 10) * 10} g of carbs a day, low fibre and low fat. Breakfast 3 hours before the start: about ${Math.round((2.5 * W) / 10) * 10} g of carbs.</p>
        <table class="runs"><thead><tr><th>Km</th><th class="n">Clock</th><th>Gel (25 g carbs each)</th></tr></thead><tbody>
          ${E.GELS.map((g) => `<tr><td>${g.km ? g.km : "Start"}</td><td class="n">${g.km ? hm(g.km * goalPace) : "−0:15"}</td><td>${esc(g.product)}${g.caffeine ? ` <span class="tag">${g.caffeine} mg caffeine</span>` : ""}${/if flat/.test(g.at) ? '<span class="was-inline">Optional, if you feel flat</span>' : ""}</td></tr>`).join("")}
        </tbody></table>
        <p class="caption">${gelCarbs} g of carbs, about ${Math.round(gelCarbs / (s.goalSec / 3600))} g/h at goal time. Caffeine ${gelCaf} mg, ${cafKg.toFixed(1)} mg/kg: ${cafKg > 6 ? "over 6 mg/kg adds side effects without benefit" : cafKg < 3 ? "below the 3 mg/kg effective dose" : cafKg > 4.5 ? "upper range, watch for jitters and gut trouble" : "in the 3–4.5 mg/kg sweet spot"}.</p>
        <div class="grid2">${field("preRaceCaffeine", "Race-morning coffee caffeine (mg)", "number", "1")}</div>
      </section>
      <section><h3>Settings</h3><div class="grid2">
        ${field("weightKg", "Weight (kg)", "number", "0.1")}${field("maxHR", "Max heart rate", "number", "1")}
        ${field("planStart", "Plan start (Monday)", "date")}${field("raceDate", "Race date", "date")}
        <label>Goal time<input type="text" data-setting="goalSec" data-duration="1" value="${E.fmtDuration(s.goalSec)}"></label>
        ${field("altPaceSec", "Altitude pace add-on (s/km)", "number", "1")}
        ${field("altTestPct", "Altitude test correction (%)", "number", "0.1")}
        ${field("riegel", "Riegel exponent", "number", "0.01")}
      </div>
      <label class="check"><input type="checkbox" data-setting="trainAtAltitude" ${s.trainAtAltitude ? "checked" : ""}> I'm training at altitude (Joburg) right now</label></section>
      <section><h3>Backup</h3><p>Everything is stored in this browser only. Export a file weekly; restore it on any device.</p>
        <div class="row"><button class="primary" data-action="export">Export backup</button>
        <label class="file secondary">Restore from backup<input type="file" accept=".json,application/json" data-action="restore"></label>
        <button class="secondary" data-action="export-csv">Export runs as CSV</button></div>
        <p class="caption">${S.lastBackup ? `Last backup ${fmtDate(S.lastBackup.slice(0, 10))}.` : "No backup yet."}</p>
      </section>
      <section><h3>Weekly review with Claude (optional)</h3>
        <p>Sends your last 14 days, the next 7 days and the engine's adjustments to Claude using your own Anthropic API key, which costs a few cents a review. The key is stored in this browser only, so only use this on your own device.</p>
        <div class="grid2"><label>Anthropic API key<input type="password" data-setting="apiKey" value="${esc(s.apiKey)}" placeholder="sk-ant-…" autocomplete="off"></label>
        <label>Model<input type="text" data-setting="model" value="${esc(s.model)}"></label></div>
        <button class="primary" data-action="review" ${reviewBusy ? "disabled" : ""}>${reviewBusy ? "Writing review…" : "Write this week's review"}</button>
        ${S.reviews.slice(0, 3).map((r) => `<article class="review"><p class="when">${fmtDate(r.date)}</p>${esc(r.text).split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("")}</article>`).join("")}
      </section>
      <section><h3>Start over</h3><button class="link danger" data-action="reset">Erase all data on this device</button></section>`;
  }

  /* ---------- render ---------- */
  function render() {
    const C = compute();
    const views = { today: viewToday, plan: viewPlan, log: viewLog, trends: viewTrends, setup: viewSetup };
    if (!views[tab]) tab = "today";
    app.innerHTML = views[tab](C);
    document.querySelectorAll(".tabs a").forEach((a) => a.setAttribute("aria-current", a.getAttribute("href") === `#${tab}` ? "page" : "false"));
  }

  /* ---------- events ---------- */
  window.addEventListener("hashchange", () => { tab = (location.hash || "#today").slice(1); render(); window.scrollTo(0, 0); });

  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-action]");
    if (!b || b.tagName === "INPUT" || b.tagName === "SELECT") return;
    const a = b.dataset.action;
    if (a === "go-log") { sessionStorage.setItem("prefillDate", b.dataset.date); location.hash = "#log"; }
    if (a === "toggle-week") { const w = Number(b.dataset.wk); const C = compute(); const isCur = C.started && C.curWk === w; openWeek = openWeek === w || (openWeek === null && isCur) ? -1 : w; render(); }
    if (a === "set-mode") { const w = b.dataset.wk; if (b.dataset.mode === "normal") delete S.weekModes[w]; else S.weekModes[w] = b.dataset.mode; save(); render(); toast(b.dataset.mode === "normal" ? `Week ${w} back to plan` : `Week ${w} set to ${b.dataset.mode} mode`); }
    if (a === "dismiss-flag") { S.dismissedFlags[b.dataset.id] = true; save(); render(); toast("Flag ignored"); }
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
  });

  document.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.action === "import-csv" && t.files[0]) {
      const f = t.files[0];
      f.text().then((txt) => {
        try {
          const incoming = E.importGarminCSV(txt);
          const r = E.mergeRuns(S.runs, incoming);
          S.runs = r.runs; save(); render();
          toast(`Imported ${r.added} new runs${r.updated ? `, updated ${r.updated}` : ""}`);
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
        } catch (err) { toast("That file isn't a backup from this app."); }
      });
    }
    if (t.dataset.action === "set-rpe") {
      const r = S.runs.find((x) => x.id === t.dataset.id);
      if (r) { r.rpe = t.value ? Number(t.value) : null; save(); toast("Effort saved"); }
    }
    if (t.dataset.setting) {
      const k = t.dataset.setting;
      let v;
      if (t.type === "checkbox") v = t.checked;
      else if (t.dataset.duration) { v = E.parseDuration(t.value); if (!v) { toast("Type the goal as h:mm:ss, for example 2:45:00."); return; } }
      else if (t.type === "number") { v = t.value === "" ? 0 : Number(t.value); }
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
        if (t.value.trim() && !v) { toast("Type the time as mm:ss or h:mm:ss."); return; }
        c.actualSec = v;
        toast(v ? `${c.name}: ${E.fmtDuration(v)} saved. Paces updated.` : "Result cleared");
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
    S.runs.push({
      id: `m:${Date.now()}`, date: f.get("date"), time: "", km: Math.round(kmv * 100) / 100, sec: Math.round(sec),
      hr: f.get("hr") ? Number(f.get("hr")) : null, rpe: f.get("rpe") ? Number(f.get("rpe")) : null,
      trail: surface === "trail", treadmill: surface === "treadmill", ascent: null, notes: f.get("notes") || "", source: "manual",
    });
    save(); render();
    toast(`Saved ${kmv} km at ${E.fmtPace(sec / kmv)}/km`);
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
        headers: {
          "content-type": "application/json",
          "x-api-key": s.apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: s.model,
          max_tokens: 1200,
          system: REVIEW_SYSTEM,
          messages: [{ role: "user", content: `My training data:\n${JSON.stringify(payload)}` }],
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(res.status === 401 ? "The API key was rejected. Check it under Setup." : (data.error && data.error.message) || `Request failed (${res.status}).`);
      const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
      if (!text) throw new Error("Claude returned an empty review. Try again.");
      S.reviews.unshift({ date: TODAY, text });
      S.reviews = S.reviews.slice(0, 12);
      save();
      toast("Review saved");
    } catch (err) {
      toast(err.message || "Couldn't reach the API. Check your connection.");
    } finally {
      reviewBusy = false; render();
    }
  }

  /* ---------- boot ---------- */
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  render();
})();
