/* ตรวจว่า `computeSessionOee` (สูตรที่ย้ายออกมา) คำนวณกะที่ปิดแล้วได้ตรงกับค่าที่ stamp ไว้
   — รันกับกะที่ปิด **หลังการแก้สูตรครั้งล่าสุด** เท่านั้น (กะเก่ากว่านั้น stamp ด้วยสูตรคนละเวอร์ชัน)
   ใช้: node scripts/backfill/verifyOee.mjs 2026-09-19 */
import { readFileSync } from 'node:fs';
import { dr, loadMaster, recompute, pct } from './recomputeSessionOee.mjs';

const since = process.argv[2] || '2026-09-19';
const lineCfg = JSON.parse(readFileSync(new URL('./lineFlow.json', import.meta.url), 'utf8'));
const master = await loadMaster();

const { data: sess, error } = await dr.from('production_sessions')
  .select('id, line_name, work_date, shift, start_time, end_time, shift_min, status, oee, oee_a, oee_p, oee_q')
  .eq('status', 'closed').gte('closed_at', `${since}T00:00:00Z`).order('work_date');
if (error) throw new Error(error.message);
console.log(`ตรวจ ${sess.length} กะ (ปิดตั้งแต่ ${since})\n`);

const near = (a, b, tol = 0.05) => (a == null && b == null) || (a != null && b != null && Math.abs(a - b) <= tol);
let ok = 0; const diffs = [];
for (const s of sess) {
  const r = await recompute(s, master, lineCfg);
  const got = { a: pct(r.A), p: pct(r.P), q: pct(r.Q), oee: pct(r.oee) };
  const want = { a: s.oee_a == null ? null : +s.oee_a, p: s.oee_p == null ? null : +s.oee_p,
                 q: s.oee_q == null ? null : +s.oee_q, oee: s.oee == null ? null : +s.oee };
  const same = ['a', 'p', 'q', 'oee'].every(k => near(got[k], want[k]));
  if (same) ok++;
  else diffs.push({ s, got, want });
}
console.log(`✅ ตรง ${ok}/${sess.length}`);
for (const d of diffs.slice(0, 25)) {
  console.log(`  ✗ ${d.s.line_name} ${d.s.work_date} ${d.s.shift}`
    + ` | stamp A=${d.want.a} P=${d.want.p} Q=${d.want.q} OEE=${d.want.oee}`
    + ` | คำนวณใหม่ A=${d.got.a} P=${d.got.p} Q=${d.got.q} OEE=${d.got.oee}`);
}
if (diffs.length > 25) console.log(`  … อีก ${diffs.length - 25} กะ`);
