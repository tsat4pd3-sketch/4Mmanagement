/* ══════════════════════════════════════════════════════════════════════════════════
   แก้ย้อนหลัง: กะที่ `end_time` ล้ำหน้าเวลาที่ปิดจริง (`closed_at`) เกินเกณฑ์
   — ต้นเหตุคือค่า default เก่าที่เดาเวลาเลิกงานมาตรฐาน (17:30/08:00) เสมอ (แก้ที่หน้าแล้ว 02/10)
     ผลคือ `shift_min` (ฐานเวลาของ %A/%P) ยาวเกินจริง 1.5–9.5 ชม.

   🔴 สคริปต์นี้ **อ่านอย่างเดียว** — คำนวณให้ดูว่าค่าใหม่จะเป็นเท่าไหร่
      การเขียนจริงอยู่ใน migration (`supabase/migrations/*_session_close_time_backfill_dr.sql`)
      ที่สำรองค่าเดิมลง schema `archive` ก่อน แล้ว UPDATE ด้วย **ค่าคงที่ที่สคริปต์นี้พิมพ์ออกมา**
      ⇒ สูตร OEE ยังมาจาก `computeSessionOee` ที่เดียว ไม่มีสูตรชุดที่ 2 ใน SQL

   พิมพ์ 3 ชุดต่อกะ เพื่อแยก "ผลของการแก้เวลา" ออกจาก "ผลของสูตรที่เปลี่ยนไปหลังปิดกะ":
     stamp   = ค่าที่ stamp ไว้ตอนปิดกะ (สูตรเวอร์ชันนั้น)
     old-end = คำนวณใหม่ด้วย end_time เดิม  ⇒ ต่างจาก stamp = สูตร drift ไม่ใช่ผลของการแก้เวลา
     new-end = คำนวณใหม่ด้วย end_time ใหม่ (= closed_at)

   ใช้: TZ=Asia/Bangkok node scripts/backfill/planCloseTimeFix.mjs [--min 90]
   ══════════════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from 'node:fs';
import { dr, loadMaster, recompute, pct } from './recomputeSessionOee.mjs';
import { CLOSE_AHEAD_WARN_MIN } from '../../src/utils/shiftWindow.js';

const argMin = process.argv.indexOf('--min');
const LIMIT_MIN = argMin > 0 ? Number(process.argv[argMin + 1]) : CLOSE_AHEAD_WARN_MIN;
const lineCfg = JSON.parse(readFileSync(new URL('./lineFlow.json', import.meta.url), 'utf8'));

/** HH:MM ของ closed_at ตามเวลาไทย — ระบุ timeZone ตรงๆ ห้ามพึ่ง TZ เครื่อง */
const bkkHHmm = (iso) => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false,
}).format(new Date(iso));

/** นาทีที่ end_time ล้ำหน้า closed_at (บวก 1 วันให้กะดึกที่ end < start) */
function aheadMinOf(s) {
  const toMs = (hhmm, plusDay = false) =>
    new Date(`${s.work_date}T${hhmm.slice(0, 5)}:00`).getTime() + (plusDay ? 86400000 : 0);
  const overnight = s.shift === 'night' && s.end_time < s.start_time;
  return Math.round((toMs(s.end_time, overnight) - new Date(s.closed_at).getTime()) / 60000);
}

const { data: sess, error } = await dr.from('production_sessions')
  .select('id, line_name, work_date, shift, start_time, end_time, shift_min, closed_at, status, oee, oee_a, oee_p, oee_q, actual_qty')
  .not('closed_at', 'is', null).not('end_time', 'is', null).not('start_time', 'is', null)
  .order('work_date');
if (error) throw new Error(error.message);

const bad = sess.filter(s => aheadMinOf(s) > LIMIT_MIN);
console.log(`กะทั้งหมดที่ปิดแล้ว ${sess.length} ใบ · เข้าเกณฑ์ (ล้ำหน้า > ${LIMIT_MIN} นาที) ${bad.length} ใบ\n`);

const master = await loadMaster();
const num = (v) => (v == null ? null : +v);
const fmt = (o) => `A=${o.a ?? '–'} P=${o.p ?? '–'} Q=${o.q ?? '–'} OEE=${o.oee ?? '–'}`;
const near = (a, b) => (a == null && b == null) || (a != null && b != null && Math.abs(a - b) <= 0.05);
const rows = [];

for (const s of bad) {
  const newEnd = bkkHHmm(s.closed_at);
  const [rOld, rNew] = [await recompute(s, master, lineCfg),
                        await recompute(s, master, lineCfg, { endTime: newEnd })];
  const g = (r) => ({ a: pct(r.A), p: pct(r.P), q: pct(r.Q), oee: pct(r.oee) });
  const stamp = { a: num(s.oee_a), p: num(s.oee_p), q: num(s.oee_q), oee: num(s.oee) };
  const oldC = g(rOld), newC = g(rNew);
  const drift = !['a', 'p', 'q', 'oee'].every(k => near(oldC[k], stamp[k]));
  const stamped = Object.values(stamp).some(v => v != null);

  console.log(`── ${s.work_date} ${s.line_name} (${s.shift}) · ปิดจริง ${newEnd} · ล้ำหน้า ${aheadMinOf(s)} น.`);
  console.log(`   end_time ${s.end_time.slice(0, 5)} → ${newEnd} · shift_min ${s.shift_min} → ${rNew.shiftMin}`);
  if (stamped) {
    console.log(`   stamp   ${fmt(stamp)}`);
    console.log(`   old-end ${fmt(oldC)}   ${drift ? '⚠️ ไม่ตรง stamp = สูตรเปลี่ยนไปหลังปิดกะ' : '✓ ตรง stamp'}`);
    console.log(`   new-end ${fmt(newC)}`);
  } else {
    console.log(`   (ไม่มีค่า OEE stamp ไว้ — แก้เฉพาะเวลา) new-end ${fmt(newC)}`);
  }
  rows.push({ id: s.id, line: s.line_name, date: s.work_date, shift: s.shift,
    oldEnd: s.end_time.slice(0, 5), newEnd, oldShiftMin: s.shift_min, newShiftMin: rNew.shiftMin,
    stamp, oldC, newC, drift, stamped });
}

console.log('\n══ SQL ให้ก๊อปลง migration (ค่าคงที่ — สูตรมาจาก computeSessionOee) ══');
for (const r of rows) {
  const v = r.stamped && !r.drift
    ? `, oee_a = ${r.newC.a ?? 'null'}, oee_p = ${r.newC.p ?? 'null'}, oee_q = ${r.newC.q ?? 'null'}, oee = ${r.newC.oee ?? 'null'}`
    : '';
  console.log(`update production_sessions set end_time = '${r.newEnd}', shift_min = ${r.newShiftMin}${v}`
    + ` where id = '${r.id}';  -- ${r.date} ${r.line}${r.stamped && r.drift ? ' · สูตร drift → ไม่แตะค่า OEE' : ''}`);
}
console.log(`\nสรุป: ${rows.length} ใบ · มีค่า stamp ${rows.filter(r => r.stamped).length} ใบ`
  + ` · สูตร drift (ไม่แตะ OEE) ${rows.filter(r => r.stamped && r.drift).length} ใบ`);
