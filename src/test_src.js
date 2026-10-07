const E = require('./engine.js');
const seed = require('./seed.json');
const fs = require('fs');
const assert = (c, m) => { if (!c) { console.error('FAIL', m); process.exitCode = 1; } else console.log('ok ', m); };

let st = E.defaultState();
// base plan
const base = E.basePlan(seed, st.settings);
assert(base.length === 224, '224 days');
assert(base[0].date === '2026-10-12' && base[223].date === '2027-05-23', 'dates span plan');
assert(Math.abs(base.reduce((a,d)=>a+d.km,0) - 2104.2) < 0.01, 'total km 2104.2');

// pace model baseline
let m = E.paceModel(st, '2026-10-07');
console.log('pred', E.fmtDuration(m.predicted), 'mp', E.fmtPace(m.mp));
assert(E.fmtPace(m.mp) === '4:28', 'baseline MP 4:28');

// CSV import
const csv = fs.readFileSync(process.argv[2] || 'Activities.csv','utf8');
const runs = E.importGarminCSV(csv);
console.log('imported', runs.length, runs[0]);
assert(runs.length > 0, 'imports running activities');

let mr = E.mergeRuns([], runs); st.runs = mr.runs;
let mr2 = E.mergeRuns(st.runs, runs); assert(mr2.added===0 && mr2.updated===runs.length, 'dedupe on re-import');

// eff series & model with history
const ser = E.effSeries(st.runs); console.log('eff qualifying', ser.length, 'last', ser.slice(-3).map(x=>[x.date,E.fmtPace(x.p150)]));
m = E.paceModel(st, '2026-10-07'); console.log('drift', m.drift, 'ref', m.refN, 'cur', m.curN);

// adjust before plan start: no gap rule
let a = E.adjust(seed, st, '2026-10-07'); console.log('alerts pre-start', a.alerts.map(x=>x.title));

// simulate: plan started, last run 2026-10-07, today 2026-10-20 (12 days gap open)
a = E.adjust(seed, st, '2026-10-20');
console.log('gap alerts', a.alerts.map(x=>x.title+': '+x.body));
const wk2 = a.days.filter(d=>d.wk===2).map(d=>[d.day,d.desc,d.km]); console.log(wk2);

// simulate rebuild: today 2026-11-10, gap 33 days
a = E.adjust(seed, st, '2026-11-10');
console.log('rebuild', a.alerts.map(x=>x.title));
console.log(a.days.filter(d=>d.wk===5||d.wk===6).map(d=>[d.wk,d.day,d.desc,d.km]));

// simulate normal training wk1 fully done then wk2 partly with readiness flags
st = E.defaultState();
const plan = E.basePlan(seed, st.settings);
let id=0;
for (const d of plan.filter(d=>d.wk===1 && d.km>0)) st.runs.push({id:'m'+(id++), date:d.date, km:d.km, sec:d.km*340, hr:142, rpe:3, trail:false});
a = E.adjust(seed, st, '2026-10-19'); console.log('wk2 start alerts', a.alerts.map(x=>x.title), E.kmBetween(st.runs,'2026-10-12','2026-10-18'));
// under-run week 2 at 50%
for (const d of plan.filter(d=>d.wk===2 && d.km>0)) st.runs.push({id:'m'+(id++), date:d.date, km:Math.round(d.km*0.5), sec:Math.round(d.km*0.5)*340, hr:142, rpe:3, trail:false});
a = E.adjust(seed, st, '2026-10-26'); console.log('catchup', a.alerts.map(x=>x.title+': '+x.body)); console.log(a.days.filter(d=>d.wk===3).map(d=>[d.day,d.desc,d.km]));
// readiness: two high RPE in week 3
st.runs.push({id:'x1', date:'2026-10-27', km:8, sec:8*330, hr:150, rpe:7, trail:false});
st.runs.push({id:'x2', date:'2026-10-28', km:8, sec:8*330, hr:150, rpe:6, trail:false});
a = E.adjust(seed, st, '2026-10-28'); console.log('readiness', a.alerts.map(x=>x.title));
// holiday + crunch modes
st = E.defaultState(); st.weekModes = {11:'holiday', 20:'crunch'};
a = E.adjust(seed, st, '2026-10-07');
for (const w of [11,20]) { const ds=a.days.filter(d=>d.wk===w); console.log(w, ds.map(d=>[d.day,d.desc,d.km,d.str]), ds.reduce((x,d)=>x+d.km,0)); }
// zones / targets
const z = E.zones(st, E.paceModel(st,'2026-10-07'));
console.log(z.map(r=>[r.key,E.fmtPace(r.now),E.fmtPace(r.goalSea),r.hrLo,r.hrHi]));
console.log(E.targetFor(a.days[1], z, E.paceModel(st,'2026-10-07')), E.nutritionFor(a.days[6], st.settings));
console.log(JSON.stringify(E.reviewPayload(seed, st, '2026-10-07')).slice(0,300));
