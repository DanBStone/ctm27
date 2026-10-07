/* Training engine — pure functions, no DOM. Testable in Node. */
const Engine = (() => {
  const MARATHON = 42.195;

  const DEFAULT_SETTINGS = {
    weightKg: 66,
    heightCm: 186,
    maxHR: 200,
    planStart: "2026-10-12",
    raceDate: "2027-05-23",
    goalSec: 9900,
    altTestPct: 2.5,
    altPaceSec: 8,
    riegel: 1.06,
    caffeineMgKg: 3,
    preRaceCaffeine: 0,
    trainAtAltitude: true,
    apiKey: "",
    model: "claude-sonnet-5-5",
  };

  const DEFAULT_CHECKPOINTS = [
    { id: "cp0", name: "Baseline 10 km (Garmin log)", date: "2026-04-11", km: 10, targetSec: null, altitude: true, actualSec: 2520 },
    { id: "cp1", name: "5 km parkrun", date: "2026-11-07", km: 5, targetSec: 1170, altitude: true, actualSec: null },
    { id: "cp2", name: "10 km race or time trial", date: "2027-01-17", km: 10, targetSec: 2310, altitude: true, actualSec: null },
    { id: "cp3", name: "Half marathon race", date: "2027-03-21", km: 21.0975, targetSec: 4680, altitude: false, actualSec: null },
  ];

  // Ratio to marathon pace approximates Daniels' VDOT relationships at ~2:45 fitness.
  const ZONES = [
    { key: "Easy (fast end)", ratio: 1.2, alt: false, hr: [0.6, 0.75], feel: "Conversational. Run by heart rate." },
    { key: "Easy (slow end)", ratio: 1.34, alt: false, hr: [0.6, 0.75], feel: "Recovery days, day after long runs." },
    { key: "Steady", ratio: 1.1, alt: true, hr: [0.75, 0.81], feel: "Comfortable but focused." },
    { key: "Marathon pace", ratio: 1.0, alt: true, hr: [0.82, 0.875], feel: "Controlled; could hold for 2.5+ hours." },
    { key: "Half marathon pace", ratio: 0.955, alt: true, hr: [0.86, 0.9], feel: "Strong; 75–80 min race effort." },
    { key: "Threshold", ratio: 0.945, alt: true, hr: [0.875, 0.915], feel: "Comfortably hard; one more rep possible." },
    { key: "10 km pace", ratio: 0.895, alt: true, hr: [0.9, 0.95], feel: "Hard. Run by pace in short reps." },
    { key: "5 km pace", ratio: 0.86, alt: true, hr: [0.93, 0.98], feel: "Very hard. Short reps only." },
  ];

  // [carbs low g/kg, carbs high g/kg, protein g/kg]
  const NUTRITION = {
    Rest: [5, 5, 1.8],
    Easy: [5, 6, 1.8],
    Quality: [7, 8, 1.8],
    Long: [8, 10, 1.8],
    Test: [7, 8, 1.8],
    "Carb load": [8, 10, 1.6],
    Race: [8, 10, 1.6],
  };

  const EXPECTED_RPE = {
    Easy: 3, Steady: 5, "Marathon pace": 6, "Half marathon pace": 7, Threshold: 7,
    "10 km pace": 8, "5 km pace": 8, Effort: 7, "Race effort": 9, Race: 9,
  };

  const GELS = [
    { at: "Before start (−15 min)", km: 0, product: "Maurten Gel 100", carbs: 25, caffeine: 0 },
    { at: "Gel 1", km: 5, product: "Maurten Gel 100", carbs: 25, caffeine: 0 },
    { at: "Gel 2", km: 10, product: "Maurten Gel 100", carbs: 25, caffeine: 0 },
    { at: "Gel 3", km: 15, product: "Maurten Gel 100", carbs: 25, caffeine: 0 },
    { at: "Gel 4", km: 20, product: "Maurten Gel 100 CAF 100", carbs: 25, caffeine: 100 },
    { at: "Gel 5", km: 25, product: "Maurten Gel 100", carbs: 25, caffeine: 0 },
    { at: "Gel 6", km: 30, product: "Maurten Gel 100 CAF 100", carbs: 25, caffeine: 100 },
    { at: "Gel 7", km: 35, product: "Maurten Gel 100", carbs: 25, caffeine: 0 },
    { at: "Gel 8 (if flat)", km: 39, product: "Maurten Gel 100", carbs: 25, caffeine: 0 },
  ];

  /* ---------- dates (local, ISO yyyy-mm-dd) ---------- */
  const pad = (n) => String(n).padStart(2, "0");
  function toISO(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function fromISO(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
  function addDays(iso, n) { const d = fromISO(iso); d.setDate(d.getDate() + n); return toISO(d); }
  function diffDays(a, b) { return Math.round((fromISO(b) - fromISO(a)) / 86400000); } // b - a
  function todayISO() { return toISO(new Date()); }

  /* ---------- formatting ---------- */
  function fmtPace(sec) {
    if (sec == null || !isFinite(sec)) return "–";
    const s = Math.round(sec);
    return `${Math.floor(s / 60)}:${pad(s % 60)}`;
  }
  function fmtDuration(sec) {
    if (sec == null || !isFinite(sec)) return "–";
    const s = Math.round(sec);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return h ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
  }
  function parseDuration(str) {
    if (str == null) return null;
    const t = String(str).trim();
    if (!t || t === "--") return null;
    const parts = t.split(":").map((p) => parseFloat(p));
    if (parts.some((p) => isNaN(p))) return null;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 1) return parts[0] * 60;
    return null;
  }
  const median = (arr) => {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const round1 = (x) => Math.round(x * 10) / 10;

  /* ---------- state ---------- */
  function defaultState() {
    return {
      version: 1,
      settings: { ...DEFAULT_SETTINGS },
      checkpoints: DEFAULT_CHECKPOINTS.map((c) => ({ ...c })),
      runs: [],
      weekModes: {}, // { [wk]: "holiday" | "crunch" }
      dismissedFlags: {}, // { [runId]: true }
      reviews: [],
      lastBackup: null,
      lastImport: null,
      installDismissed: false,
      race: { resultSec: null },
    };
  }
  function migrate(s) {
    const base = defaultState();
    if (!s || typeof s !== "object") return base;
    return {
      ...base,
      ...s,
      settings: { ...base.settings, ...(s.settings || {}) },
      checkpoints: Array.isArray(s.checkpoints) && s.checkpoints.length ? s.checkpoints : base.checkpoints,
      runs: Array.isArray(s.runs) ? s.runs : [],
      weekModes: s.weekModes || {},
      dismissedFlags: s.dismissedFlags || {},
      reviews: Array.isArray(s.reviews) ? s.reviews : [],
      race: s.race || { resultSec: null },
    };
  }

  /* ---------- plan ---------- */
  function weekOf(settings, iso) { return Math.floor(diffDays(settings.planStart, iso) / 7) + 1; }

  function basePlan(seed, settings) {
    return seed.days.map((d) => ({
      ...d,
      date: addDays(settings.planStart, d.o),
      orig: { desc: d.desc, km: d.km, type: d.type, zone: d.zone },
      notes: [],
    }));
  }

  const weekDays = (days, wk) => days.filter((d) => d.wk === wk);
  const sumKm = (arr) => round1(arr.reduce((a, d) => a + (d.km || 0), 0));

  function setDay(d, desc, km, type, zone, note) {
    d.desc = desc; d.km = km; d.type = type; d.zone = zone;
    if (note) d.notes.push(note);
    d.adjusted = true;
  }

  function applyHoliday(days, wk) {
    const w = weekDays(days, wk);
    const planned = sumKm(w);
    const target = Math.max(35, Math.round(planned * 0.6));
    const by = Object.fromEntries(w.map((d) => [d.day, d]));
    const keepTue = by.Tue.km || 8;
    let sunKm = by.Sun.km;
    if (by.Sun.type === "Long" || by.Sun.type === "Easy") {
      sunKm = Math.min(by.Sun.km, 18);
      setDay(by.Sun, `${sunKm} km easy`, sunKm, sunKm >= 20 ? "Long" : "Easy", "Easy", "Holiday mode");
    }
    const rem = Math.max(10, target - keepTue - sunKm);
    const each = Math.max(5, Math.round(rem / 2));
    for (const d of ["Mon", "Wed", "Fri"]) setDay(by[d], "Rest", 0, "Rest", "", "Holiday mode");
    if (by.Tue.type !== "Quality") setDay(by.Tue, `Easy ${keepTue} km`, keepTue, "Easy", "Easy", "Holiday mode");
    else by.Tue.notes.push("Holiday mode: keep this one");
    setDay(by.Thu, `Easy ${each} km`, each, "Easy", "Easy", "Holiday mode");
    setDay(by.Sat, `Easy ${each} km + strides`, each, "Easy", "Easy", "Holiday mode");
  }

  function applyCrunch(days, wk) {
    const w = weekDays(days, wk);
    const by = Object.fromEntries(w.map((d) => [d.day, d]));
    setDay(by.Wed, "Rest + strength", 0, "Rest", "", "Crunch week (4 days)");
    setDay(by.Fri, "Rest", 0, "Rest", "", "Crunch week (4 days)");
    if (by.Thu.type !== "Rest") setDay(by.Thu, "Easy 12 km", 12, "Easy", "Easy", "Crunch week: second session dropped");
    if (by.Thu.str) { by.Wed.str = by.Thu.str; by.Thu.str = ""; }
    const tue = by.Tue.km;
    let sun = by.Sun.km;
    let sat = clamp(65 - tue - 12 - sun, 6, 14);
    if (tue + 12 + sun + sat > 65 && (by.Sun.type === "Long")) {
      sun = Math.max(18, 65 - tue - 12 - sat);
      setDay(by.Sun, `${by.Sun.orig.desc} (cut to ${sun} km)`, sun, "Long", by.Sun.zone, "Crunch week cap: 65 km");
    }
    setDay(by.Sat, `Easy ${sat} km + strides`, sat, "Easy", "Easy", "Crunch week (4 days)");
  }

  function applyRepeat(days, targetWk, sourceWk, factor, label) {
    const tgt = weekDays(days, targetWk);
    const src = weekDays(days, sourceWk);
    for (const d of tgt) {
      if (d.type === "Test" || d.type === "Race" || d.type === "Carb load") continue;
      const s = src.find((x) => x.day === d.day);
      if (!s) continue;
      const km = Math.round(s.orig.km * factor);
      const desc = s.orig.km === 0 ? "Rest" : s.orig.desc.replace(/\b\d+(\.\d+)?\s*km\b/, `${km} km`);
      setDay(d, desc, km, s.orig.type === "Long" && km < 20 ? "Easy" : s.orig.type, s.orig.zone, label);
    }
  }

  function applyRebuild(days, wk, targetKm, label) {
    const w = weekDays(days, wk);
    const runDays = w.filter((d) => d.orig.km > 0 && !["Test", "Race", "Carb load"].includes(d.type));
    const sun = w.find((d) => d.day === "Sun");
    const sunKm = Math.min(14, Math.round(targetKm * 0.3));
    const others = runDays.filter((d) => d.day !== "Sun");
    const each = others.length ? Math.max(4, Math.round((targetKm - sunKm) / others.length)) : 0;
    for (const d of others) setDay(d, `Easy ${each} km${d.day === "Thu" ? " + strides" : ""}`, each, "Easy", "Easy", label);
    if (sun && !["Test", "Race", "Carb load"].includes(sun.type)) setDay(sun, `${sunKm} km easy`, sunKm, "Easy", "Easy", label);
  }

  /* ---------- runs & metrics ---------- */
  function runsByDate(runs) {
    const m = {};
    for (const r of runs) (m[r.date] = m[r.date] || []).push(r);
    return m;
  }
  function kmBetween(runs, fromISO_, toISO_) {
    return round1(runs.filter((r) => r.date >= fromISO_ && r.date <= toISO_).reduce((a, r) => a + (r.km || 0), 0));
  }
  function efficiency(r) {
    // metres per minute per heartbeat; higher = fitter
    if (!r.km || !r.sec || !r.hr) return null;
    return (r.km * 1000) / (r.sec / 60) / r.hr;
  }
  function qualifiesForEff(r) {
    if (r.trail || !r.hr || !r.sec || r.km < 5) return false;
    if (r.hr < 125 || r.hr > 162) return false;
    if (r.ascent != null && r.km && r.ascent / r.km > 25) return false;
    return true;
  }
  const paceAt150 = (eff) => (eff ? 60000 / (eff * 150) : null); // sec/km at 150 bpm

  function effSeries(runs) {
    return runs
      .filter(qualifiesForEff)
      .map((r) => ({ date: r.date, eff: efficiency(r), p150: paceAt150(efficiency(r)), id: r.id }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
  }

  function loadRatio(runs, today) {
    const km7 = kmBetween(runs, addDays(today, -6), today);
    const km28 = kmBetween(runs, addDays(today, -27), today);
    const chronic = km28 / 4;
    const hasHistory = runs.some((r) => r.date <= addDays(today, -21));
    return { km7, km28, chronic: round1(chronic), ratio: chronic >= 10 && hasHistory ? km7 / chronic : null };
  }

  /* ---------- pace model ---------- */
  function paceModel(state, today) {
    const s = state.settings;
    const done = state.checkpoints.filter((c) => c.actualSec).sort((a, b) => (a.date < b.date ? -1 : 1));
    const latest = done[done.length - 1] || DEFAULT_CHECKPOINTS[0];
    const sea = latest.altitude ? latest.actualSec / (1 + s.altTestPct / 100) : latest.actualSec;
    const predBase = sea * Math.pow(MARATHON / latest.km, s.riegel);
    const mpBase = predBase / MARATHON;

    const series = effSeries(state.runs);
    let ref = series.filter((x) => x.date >= addDays(latest.date, -21) && x.date <= addDays(latest.date, 7));
    if (ref.length < 3) ref = series.filter((x) => x.date >= addDays(latest.date, -21)).slice(0, 5);
    const refEnd = ref.length ? ref[ref.length - 1].date : null;
    const cur = series.filter((x) => x.date >= addDays(today, -21) && x.date <= today && (!refEnd || x.date > refEnd));
    let drift = 0, ratio = null;
    if (ref.length >= 3 && cur.length >= 3) {
      ratio = median(cur.map((x) => x.eff)) / median(ref.map((x) => x.eff));
      const weeks = Math.max(0, diffDays(refEnd, today) / 7);
      const cap = Math.min(10, 3 * weeks);
      drift = clamp(mpBase * (1 / ratio - 1), -cap, cap);
    }
    const mp = mpBase + drift;
    return {
      latest, predBase, mpBase, drift, ratio, mp,
      predicted: mp * MARATHON,
      goalMp: s.goalSec / MARATHON,
      refN: ref.length, curN: cur.length,
    };
  }

  function zones(state, model) {
    const s = state.settings;
    return ZONES.map((z) => {
      const add = z.alt && s.trainAtAltitude ? s.altPaceSec : 0;
      return {
        ...z,
        nowSea: z.ratio * model.mp,
        now: z.ratio * model.mp + add,
        goalSea: z.ratio * model.goalMp,
        goal: z.ratio * model.goalMp + add,
        hrLo: Math.round(z.hr[0] * s.maxHR),
        hrHi: Math.round(z.hr[1] * s.maxHR),
      };
    });
  }

  function targetFor(day, zs, model) {
    if (!day.zone) return { text: "", hr: "" };
    const z = (k) => zs.find((x) => x.key === k);
    if (day.zone === "Easy") {
      const a = z("Easy (fast end)"), b = z("Easy (slow end)");
      return { text: `${fmtPace(a.now)}–${fmtPace(b.now)}`, hr: `under ${a.hrHi}` };
    }
    if (day.zone === "Race") return { text: `${fmtPace(model.goalMp)} goal`, hr: "" };
    if (day.zone === "Effort" || day.zone === "Race effort") return { text: "By effort", hr: "" };
    const row = z(day.zone);
    if (!row) return { text: "", hr: "" };
    return { text: fmtPace(row.now), hr: day.zone.includes("km pace") ? "" : `${row.hrLo}–${row.hrHi}` };
  }

  function nutritionFor(day, s) {
    const n = NUTRITION[day.type] || NUTRITION.Easy;
    return {
      carbs: Math.round(((n[0] + n[1]) / 2) * s.weightKg / 10) * 10,
      protein: Math.round(n[2] * s.weightKg),
    };
  }

  /* ---------- adjustment engine ---------- */
  function expectedRpe(day) {
    if (!day) return 4;
    if ((day.type === "Long" || day.km >= 16) && day.zone === "Easy") return 4;
    return EXPECTED_RPE[day.zone] || 4;
  }

  function findGap(runs, settings, today) {
    const dates = [...new Set(runs.filter((r) => r.km > 0).map((r) => r.date))].sort();
    if (!dates.length || today < settings.planStart) return null;
    const last = dates[dates.length - 1];
    const open = diffDays(last, today) - 1;
    if (open >= 7) return { len: open, start: addDays(last, 1), resume: today, open: true };
    for (let i = dates.length - 1; i > 0; i--) {
      const len = diffDays(dates[i - 1], dates[i]) - 1;
      if (dates[i] < addDays(today, -13)) break;
      if (len >= 7 && dates[i] >= settings.planStart) return { len, start: addDays(dates[i - 1], 1), resume: dates[i], open: false };
    }
    return null;
  }

  function adjust(seed, state, today) {
    const s = state.settings;
    const days = basePlan(seed, s);
    const alerts = [];
    const curWk = clamp(weekOf(s, today), 1, 32);
    const started = today >= s.planStart;

    // 1. Week modes chosen by you
    for (const [wk, mode] of Object.entries(state.weekModes || {})) {
      const w = Number(wk);
      if (mode === "holiday") applyHoliday(days, w);
      if (mode === "crunch") applyCrunch(days, w);
    }

    // 2. Missed training
    let gapApplied = false;
    const gap = started ? findGap(state.runs, s, today) : null;
    if (gap) {
      const resumeWk = clamp(weekOf(s, gap.resume), 1, 32);
      const preWk = clamp(weekOf(s, gap.start) - 1, 1, 32);
      if (gap.len <= 14) {
        if (resumeWk >= curWk) {
          applyRepeat(days, resumeWk, Math.max(1, resumeWk - 1), 0.8, `Back from ${gap.len} days off: week ${Math.max(1, resumeWk - 1)} repeated at 80%`);
          gapApplied = true;
        }
        alerts.push({ level: "adjust", rule: "gap", title: "Welcome back",
          body: `After ${gap.len} days off, week ${resumeWk} repeats week ${Math.max(1, resumeWk - 1)} at 80% so you ease back in. Next week the plan carries on as written; the race date and peak week don't move.` });
      } else {
        const refKm = sumKm(weekDays(days, preWk).map((d) => ({ km: d.orig.km })));
        const target = Math.max(25, Math.round(refKm * 0.6));
        if (resumeWk >= curWk) { applyRebuild(days, resumeWk, target, `Rebuild after ${gap.len} days off`); gapApplied = true; }
        if (resumeWk + 1 <= 32 && resumeWk + 1 >= curWk) {
          applyRepeat(days, resumeWk + 1, preWk, 0.8, `Rebuild week 2: week ${preWk} at 80%`);
          if (resumeWk + 1 === curWk) gapApplied = true;
        }
        alerts.push({ level: "adjust", rule: "gap", title: "Easing you back in",
          body: `After ${gap.len} days off, week ${resumeWk} is an easy rebuild at about ${target} km, then week ${resumeWk + 1} repeats week ${preWk} at 80%. The race date and peak week don't move. If you were injured, get cleared before you start.` });
      }
    }

    // 3. Volume catch-up protection
    let catchupApplied = false;
    if (started && !gapApplied && curWk >= 2) {
      const prev = weekDays(days, curWk - 1);
      const prevPlanned = sumKm(prev);
      const prevActual = kmBetween(state.runs, prev[0].date, prev[6].date);
      const cur = weekDays(days, curWk);
      const curPlanned = sumKm(cur);
      if (prevActual > 0 && prevActual < 0.85 * prevPlanned) {
        const cap = Math.round(prevActual * 1.15);
        if (curPlanned > cap && cap >= 15) {
          const flex = cur.filter((d) => d.date >= today && (d.type === "Easy" || d.type === "Long") && d.km > 0);
          const flexKm = sumKm(flex);
          const cut = curPlanned - cap;
          if (flexKm > 0) {
            const f = Math.max(0.6, (flexKm - cut) / flexKm);
            for (const d of flex) {
              const km = Math.max(4, Math.round(d.km * f));
              d.notes.push(`Trimmed from ${d.km} km`);
              d.desc = d.desc.replace(/\b\d+(\.\d+)?\s*km\b/, `${km} km`);
              d.km = km; d.adjusted = true;
            }
          }
          catchupApplied = true;
          alerts.push({ level: "adjust", rule: "catchup", title: "Adjusted after a lighter week",
            body: `You ran ${prevActual} of ${prevPlanned} km last week, so this week builds from there: about ${cap} km instead of ${curPlanned}. Sessions stay; easy runs and the long run are shorter. No need to make up the missed kilometres.` });
        }
      }
    }

    // 4. Load ratio
    const load = loadRatio(state.runs, today);
    if (started && load.ratio != null) {
      if (load.ratio > 1.3) {
        const flex = gapApplied || catchupApplied ? [] : weekDays(days, curWk).filter((d) => d.date > today && d.type === "Easy" && d.km > 0);
        for (const d of flex) {
          const km = Math.max(4, Math.round(d.km * 0.8));
          d.notes.push(`Load ratio ${load.ratio.toFixed(2)}: trimmed from ${d.km} km`);
          d.desc = d.desc.replace(/\b\d+(\.\d+)?\s*km\b/, `${km} km`);
          d.km = km; d.adjusted = true;
        }
        alerts.push({ level: "adjust", rule: "load", title: "Volume jumped this week",
          body: `${load.km7} km in the last 7 days against a 4-week average of ${load.chronic} km (ratio ${load.ratio.toFixed(2)}). ${flex.length ? "The rest of this week's easy runs are 20% shorter to keep the jump safe." : "Keep the rest of this week as adjusted."}` });
      } else if (load.ratio < 0.7 && load.km28 > 0 && !gap) {
        alerts.push({ level: "info", rule: "load", title: "Lighter than usual",
          body: `${load.km7} km in the last 7 days against a 4-week average of ${load.chronic} km. Fine for a down week; otherwise just pick the plan back up rather than adding extra.` });
      }
    }

    // 5. Readiness flags
    const byDate = Object.fromEntries(days.map((d) => [d.date, d]));
    const series = effSeries(state.runs);
    const flags = [];
    for (const r of state.runs) {
      if (r.date <= addDays(today, -7) || r.date > today || state.dismissedFlags[r.id]) continue;
      const planned = byDate[r.date];
      const exp = expectedRpe(planned);
      if (r.rpe && r.rpe >= exp + 2) flags.push({ run: r, why: `RPE ${r.rpe} on a session that should feel about ${exp}` });
      if (qualifiesForEff(r)) {
        const prior = series.filter((x) => x.date < r.date && x.date >= addDays(r.date, -28)).map((x) => x.eff);
        const m = median(prior);
        if (prior.length >= 4 && efficiency(r) < 0.96 * m) {
          flags.push({ run: r, why: `Heart rate high for the pace (easy pace at 150 bpm ${fmtPace(paceAt150(efficiency(r)))} vs usual ${fmtPace(paceAt150(m))})` });
        }
      }
    }
    if (flags.length >= 2) {
      const next = days.find((d) => d.date >= today && d.date <= addDays(today, 6) && d.type === "Quality" && !(runsByDate(state.runs)[d.date]));
      if (next) {
        const km = Math.max(6, Math.round(next.km * 0.8));
        setDay(next, `Easy ${km} km (swapped from: ${next.orig.desc})`, km, "Easy", "Easy", "Readiness: session swapped");
      }
      alerts.push({ level: "action", rule: "readiness", title: "Signs of fatigue",
        body: `${flags.length} warning signs in the last 7 days. ${next ? `${next.day} ${next.date.slice(5)}'s session is swapped for an easy run.` : "Keep the next few days easy."} Sleep, eat to target, and check resting HR.`,
        flags: flags.map((f) => ({ id: f.run.id, date: f.run.date, why: f.why })) });
    } else if (flags.length === 1) {
      alerts.push({ level: "info", rule: "readiness", title: "One fatigue sign this week",
        body: `${flags[0].why} on ${flags[0].run.date.slice(5)}. One more in the next few days and the next session gets swapped.`,
        flags: flags.map((f) => ({ id: f.run.id, date: f.run.date, why: f.why })) });
    }

    return { days, alerts, load, curWk, started };
  }

  /* ---------- Garmin CSV ---------- */
  function parseCSV(text) {
    const rows = [];
    let row = [], field = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
        else field += c;
      } else if (c === '"') q = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); rows.push(row); row = []; field = "";
      } else field += c;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.length > 1 || (r[0] && r[0].trim()));
  }
  const num = (v) => {
    if (v == null) return null;
    const t = String(v).replace(/[,'\s]/g, "");
    if (!t || t === "--") return null;
    const n = parseFloat(t);
    return isNaN(n) ? null : n;
  };
  function importGarminCSV(text) {
    const rows = parseCSV(text.replace(/^\uFEFF/, ""));
    if (rows.length < 2) throw new Error("That file has no rows. Export it from Garmin Connect: Activities → All Activities → Export CSV.");
    const h = rows[0].map((x) => x.trim());
    const col = (name) => h.indexOf(name);
    const iType = col("Activity Type"), iDate = col("Date"), iDist = col("Distance"), iTime = col("Time");
    if (iType < 0 || iDate < 0 || iDist < 0 || iTime < 0) throw new Error("This doesn't look like a Garmin Activities CSV. It needs Activity Type, Date, Distance and Time columns.");
    const iHR = col("Avg HR"), iAsc = col("Total Ascent"), iTitle = col("Title");
    const out = [];
    for (const r of rows.slice(1)) {
      const type = (r[iType] || "").trim();
      if (!/running/i.test(type)) continue;
      const dt = (r[iDate] || "").trim();
      const date = dt.slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const km = num(r[iDist]);
      const sec = parseDuration(r[iTime]);
      if (!km || !sec) continue;
      out.push({
        id: `g:${dt}`,
        date,
        time: dt.slice(11, 16),
        km: round1(km),
        sec: Math.round(sec),
        hr: iHR >= 0 ? num(r[iHR]) : null,
        ascent: iAsc >= 0 ? num(r[iAsc]) : null,
        trail: /trail/i.test(type),
        title: iTitle >= 0 ? r[iTitle] : type,
        rpe: null,
        notes: "",
        source: "garmin",
      });
    }
    return out;
  }
  function mergeRuns(existing, incoming) {
    const map = new Map(existing.map((r) => [r.id, r]));
    let added = 0, updated = 0;
    for (const r of incoming) {
      if (map.has(r.id)) {
        const old = map.get(r.id);
        map.set(r.id, { ...r, rpe: old.rpe, notes: old.notes });
        updated++;
      } else { map.set(r.id, r); added++; }
    }
    return { runs: [...map.values()].sort((a, b) => (a.date + (a.time || "") < b.date + (b.time || "") ? 1 : -1)), added, updated };
  }


  /* ---------- discoveries: bests found in your own log ---------- */
  const MON3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthYear = (iso) => { const d = fromISO(iso); return `${MON3[d.getMonth()]} ${d.getFullYear()}`; };
  function mondayOf(iso) { const d = fromISO(iso); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return toISO(d); }
  const isRoad = (r) => !r.trail && r.km < 45; // ultras and trail runs don't count as road bests
  const before = (r, run) => r.id !== run.id && (r.date < run.date || (r.date === run.date && (r.time || "") < (run.time || "")));

  function runDiscoveries(runs, run) {
    const out = [];
    if (!isRoad(run)) return out;
    const prior = runs.filter((r) => before(r, run) && isRoad(r));
    if (prior.length < 10) return out;
    if (run.km >= 15) {
      const best = prior.reduce((a, r) => (r.km > a.km ? r : a), prior[0]);
      if (run.km > best.km + 0.05) out.push(`Longest road run in your log. Your previous longest was ${round1(best.km)} km in ${monthYear(best.date)}.`);
    }
    for (const [label, lo, hi] of [["5 km", 4.9, 5.4], ["10 km", 9.8, 10.7], ["half marathon", 20.9, 21.7]]) {
      if (run.km < lo || run.km > hi) continue;
      const same = prior.filter((r) => r.km >= lo && r.km <= hi && r.sec);
      if (same.length < 2) continue;
      const best = same.reduce((a, r) => (r.sec / r.km < a.sec / a.km ? r : a), same[0]);
      if (run.sec / run.km < best.sec / best.km) out.push(`Fastest ${label} in your log. Your previous best was ${fmtDuration(best.sec)} in ${monthYear(best.date)}.`);
    }
    return out;
  }

  function weekDiscovery(runs, mondayISO) {
    const totals = {};
    for (const r of runs) { const k = mondayOf(r.date); totals[k] = (totals[k] || 0) + (r.km || 0); }
    const mine = totals[mondayISO] || 0;
    const prior = Object.keys(totals).filter((k) => k < mondayISO).sort();
    if (prior.length < 8 || mine <= 0) return null;
    const bigger = prior.filter((k) => totals[k] >= mine);
    if (!bigger.length) return `Biggest week in your log: ${round1(mine)} km.`;
    const last = bigger[bigger.length - 1];
    if (diffDays(last, mondayISO) < 42) return null;
    return `Biggest week since ${monthYear(last)} (${round1(totals[last])} km).`;
  }

  /* ---------- review payload ---------- */
  function reviewPayload(seed, state, today) {
    const { days, alerts, load } = adjust(seed, state, today);
    const model = paceModel(state, today);
    const last14 = state.runs.filter((r) => r.date > addDays(today, -14) && r.date <= today)
      .map((r) => ({ date: r.date, km: r.km, time: fmtDuration(r.sec), pace: fmtPace(r.sec / r.km), hr: r.hr, rpe: r.rpe, trail: r.trail, notes: r.notes }));
    const planned14 = days.filter((d) => d.date > addDays(today, -14) && d.date <= today).map((d) => ({ date: d.date, session: d.desc, km: d.km }));
    const next7 = days.filter((d) => d.date >= today && d.date <= addDays(today, 6)).map((d) => ({ date: d.date, session: d.desc, km: d.km }));
    return {
      today, raceDate: state.settings.raceDate, goal: fmtDuration(state.settings.goalSec),
      predictedMarathon: fmtDuration(model.predicted), currentMP: fmtPace(model.mp), driftSecPerKm: Math.round(model.drift),
      loadRatio: load.ratio ? +load.ratio.toFixed(2) : null, km7: load.km7, km28: load.km28,
      alerts: alerts.map((a) => `${a.title}: ${a.body}`),
      planned14, actual14: last14, next7,
    };
  }

  return {
    MARATHON, DEFAULT_SETTINGS, DEFAULT_CHECKPOINTS, ZONES, NUTRITION, GELS,
    toISO, fromISO, addDays, diffDays, todayISO, fmtPace, fmtDuration, parseDuration, median, round1,
    defaultState, migrate, weekOf, basePlan, adjust, paceModel, zones, targetFor, nutritionFor,
    loadRatio, effSeries, efficiency, qualifiesForEff, paceAt150, kmBetween, runsByDate,
    importGarminCSV, mergeRuns, parseCSV, reviewPayload, findGap,
    runDiscoveries, weekDiscovery, mondayOf, monthYear,
  };
})();
if (typeof module !== "undefined") module.exports = Engine;
