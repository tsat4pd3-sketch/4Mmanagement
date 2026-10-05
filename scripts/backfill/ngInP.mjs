/* ══════════════════════════════════════════════════════════════════════════════════
   Backfill: เอาของเสีย/งานทดลอง/ของสงสัย เข้า "ตัวเศษ %P" ของกะที่ปิดไปแล้ว
   (กฎใหม่ 2026-10-04 — ดู §%P ใน src/utils/oee.js · คำสั่ง user "ต้องเข้าหมดเพราะใช้เครื่องลองผลิต")

   🔴 วิธีที่ **ไม่** ทำ: คำนวณ A/P/Q ใหม่ทั้งชุดด้วย master ปัจจุบัน
      — ผิดกฎ "ค่าที่ stamp ตอนปิดกะ คือความจริงสูงสุดของกะที่ปิดแล้ว ห้ามคำนวณใหม่ด้วย master ปัจจุบัน"
        (CT / นโยบายพัก / flow_mode เปลี่ยนไปแล้วตั้งแต่กะนั้น ⇒ จะได้เลขที่ไม่เคยมีใครเห็น)

   ✅ วิธีที่ทำ: คำนวณ **อัตราส่วน** จากสูตรจริงตัวเดียวกัน แล้วเอาไปคูณค่าที่ stamp ไว้
        factor = P(มีของเสียในตัวเศษ) ÷ P(ไม่มี)      ← ทั้งสองค่าคำนวณจาก master ชุดเดียวกัน
        P_ใหม่ = min(100, P_stamp × factor)   ·   OEE_ใหม่ = A_stamp × P_ใหม่ × Q_stamp
      ตัวหาร %P (runMin/busyMinutes/parallel) **หักกลบกันหมด** ⇒ master ที่ดริฟท์ไม่กระทบ factor
      และ **A กับ Q ของเดิมไม่ถูกแตะเลย** (ของเสียไม่เคยอยู่ในตัวหาร A และ Q ก็เป็นค่าที่ stamp ไว้)

   ผลข้างเคียงที่ตั้งใจ: กะที่ %P ชน 100 อยู่แล้ว factor ไม่ช่วยอะไร ⇒ ไม่ถูกแตะ

   ใช้:
     node scripts/backfill/ngInP.mjs              → dry-run (ไม่เขียนอะไร) + รายงาน
     node scripts/backfill/ngInP.mjs --sql <path> → เขียนไฟล์ SQL ให้เอาไปรันใน SQL Editor (DR project)
   ══════════════════════════════════════════════════════════════════════════════════ */
import { readFileSync, writeFileSync } from 'node:fs';
import { dr, loadMaster, recompute, pct } from './recomputeSessionOee.mjs';

const sqlOut = process.argv.includes('--sql') ? process.argv[process.argv.indexOf('--sql') + 1] : null;
const r2 = (v) => parseFloat(v.toFixed(2));

const lineCfg = JSON.parse(readFileSync(new URL('./lineFlow.json', import.meta.url), 'utf8'));
const master = await loadMaster();

/* กะที่มีของเสียผูกใบ — ตัวที่ไม่ผูกใบชี้ MAT ไม่ได้ ⇒ ไม่รู้ CT ⇒ เข้าตัวเศษไม่ได้อยู่แล้ว */
const { data: defRows, error: dErr } = await dr.from('defect_logs')
  .select('session_id, qty_ng, qty_suspect, prod_order_id').not('prod_order_id', 'is', null);
if (dErr) throw new Error(dErr.message);
const sessIds = [...new Set(defRows.filter(d => (d.qty_ng || 0) + (d.qty_suspect || 0) > 0).map(d => d.session_id))];

const sessions = [];
for (let i = 0; i < sessIds.length; i += 100) {
  const { data, error } = await dr.from('production_sessions')
    .select('id, line_name, work_date, shift, start_time, end_time, shift_min, status, oee, oee_a, oee_p, oee_q')
    .in('id', sessIds.slice(i, i + 100)).eq('status', 'closed');
  if (error) throw new Error(error.message);
  sessions.push(...(data || []));
}
sessions.sort((a, b) => (a.work_date + a.shift).localeCompare(b.work_date + b.shift));
console.log(`กะที่ปิดแล้วและมีของเสียผูกใบ: ${sessions.length} กะ\n`);

const rows = [], skipped = [];
let reproOk = 0, reproBad = 0;

for (const s of sessions) {
  const [rNew, rOld] = [await recompute(s, master, lineCfg),
                        await recompute(s, master, lineCfg, { ngInP: false })];
  const stampP = s.oee_p == null ? null : +s.oee_p;
  if (stampP == null) { skipped.push([s, 'ไม่มี %P ที่ stamp ไว้']); continue; }
  if (!rNew?.P || !rOld?.P) { skipped.push([s, 'สูตรคำนวณ %P ไม่ได้ (ไม่มี CT / ไม่มียอด)']); continue; }

  /* เช็คความมั่นใจ: master วันนี้ยังคำนวณกะนี้ได้ตรงกับที่ stamp ไหม (ไม่ตรง ≠ ผิด — factor ยังใช้ได้
     เพราะเป็นอัตราส่วน — แต่ต้องรายงานให้เห็น ห้ามเงียบ) */
  const sameAsStamp = Math.abs(pct(rOld.P) - stampP) <= 0.05;
  sameAsStamp ? reproOk++ : reproBad++;

  const factor = rNew.P / rOld.P;
  const pNew = Math.min(100, r2(stampP * factor));
  if (pNew <= stampP) { skipped.push([s, `ไม่ขยับ (${stampP} → ${pNew})`]); continue; }

  const a = s.oee_a == null ? null : +s.oee_a, q = s.oee_q == null ? null : +s.oee_q;
  const oeeNew = (a == null || q == null) ? null : r2(a * pNew * q / 10000);
  rows.push({ s, stampP, pNew, oeeOld: s.oee == null ? null : +s.oee, oeeNew,
              factor, ngInP: rNew.ngInP, ngNoMat: rNew.ngNoMatP, sameAsStamp });
}

console.log(`✅ กะที่ต้องอัพเดท: ${rows.length}  ·  ข้าม ${skipped.length}`);
console.log(`   master วันนี้คำนวณ %P เดิมได้ตรง stamp: ${reproOk} · ไม่ตรง ${reproBad} (ใช้ factor ได้อยู่ — ดูหมายเหตุหัวไฟล์)\n`);
const gain = rows.map(r => r.pNew - r.stampP);
if (gain.length) console.log(`   %P ขยับเฉลี่ย +${r2(gain.reduce((a2, b) => a2 + b, 0) / gain.length)} จุด · สูงสุด +${r2(Math.max(...gain))}\n`);

for (const r of [...rows].sort((a, b) => (b.pNew - b.stampP) - (a.pNew - a.stampP)).slice(0, 20)) {
  console.log(`  ${r.sameAsStamp ? ' ' : '⚠'} ${r.s.work_date} ${r.s.shift.padEnd(5)} ${r.s.line_name.padEnd(22)}`
    + ` P ${String(r.stampP).padStart(6)} → ${String(r.pNew).padStart(6)}`
    + ` | OEE ${String(r.oeeOld).padStart(6)} → ${String(r.oeeNew).padStart(6)}`
    + ` | NG เข้า %P ${r.ngInP}${r.ngNoMat ? ` (ชี้ MAT ไม่ได้อีก ${r.ngNoMat})` : ''}`);
}
if (rows.length > 20) console.log(`  … อีก ${rows.length - 20} กะ`);
for (const [s, why] of skipped.slice(0, 10)) console.log(`  – ข้าม ${s.work_date} ${s.shift} ${s.line_name}: ${why}`);
if (skipped.length > 10) console.log(`  … ข้ามอีก ${skipped.length - 10} กะ`);

if (sqlOut && rows.length) {
  const vals = rows.map(r => `  ('${r.s.id}'::uuid, ${r.pNew}, ${r.oeeNew == null ? 'null' : r.oeeNew})`).join(',\n');
  writeFileSync(sqlOut, `-- สร้างโดย scripts/backfill/ngInP.mjs เมื่อ ${new Date().toISOString()}
-- ${rows.length} กะ · DR project (Product DB · eyhclzkifitbhbljgoav)
create schema if not exists archive;
create table if not exists archive.oee_p_before_ng_backfill_20261004 (
  session_id uuid primary key, oee_p_old numeric, oee_old numeric,
  oee_p_new numeric, oee_new numeric, saved_at timestamptz not null default now()
);
alter table archive.oee_p_before_ng_backfill_20261004 enable row level security;

with v(session_id, oee_p_new, oee_new) as (values
${vals}
)
insert into archive.oee_p_before_ng_backfill_20261004 (session_id, oee_p_old, oee_old, oee_p_new, oee_new)
select s.id, s.oee_p, s.oee, v.oee_p_new, v.oee_new
from v join public.production_sessions s on s.id = v.session_id
on conflict (session_id) do nothing;

with v(session_id, oee_p_new, oee_new) as (values
${vals}
)
update public.production_sessions s
   set oee_p = v.oee_p_new, oee = coalesce(v.oee_new, s.oee)
  from v where s.id = v.session_id;
`, 'utf8');
  console.log(`\n📝 เขียน SQL แล้ว: ${sqlOut}`);
}
