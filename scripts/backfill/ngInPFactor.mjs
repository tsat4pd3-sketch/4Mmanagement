/* ══════════════════════════════════════════════════════════════════════════════════
   Backfill ตัวเศษ %P (ของเสีย/ทดลอง/สงสัย เข้า %P — กฎ 2026-10-04) สำหรับกะที่ปิดไปแล้ว

   🔴 **ไม่คำนวณ A/P/Q ใหม่ด้วย master ปัจจุบัน** — ผิดกฎ "ค่าที่ stamp คือความจริงสูงสุดของกะที่ปิดแล้ว"
      (CT/นโยบายพัก/flow_mode ดริฟท์ไปแล้ว ⇒ จะได้เลขที่ไม่เคยมีใครเห็น)

   ✅ สิ่งที่ทำ: หา **อัตราส่วนของตัวเศษ** ด้วยสูตรจริงตัวเดียวกัน (`computeSessionOee`) รันสองรอบ
        factor = stdMin(มีของเสีย) ÷ stdMin(ไม่มี)
      ตัวหารไม่เกี่ยว (รันสองรอบด้วย session/เวลาชุดเดียวกัน ⇒ หักกลบกันหมด)
      แล้วเอา factor ไปคูณค่าที่ stamp ไว้ **ในฝั่ง SQL**: P_ใหม่ = least(100, round(oee_p × factor, 2))
      · A และ Q ไม่ถูกแตะเลย · OEE_ใหม่ = oee_a × P_ใหม่ × oee_q

   🔴 ของเสียที่ "ชี้ MAT ไม่ได้" (ไม่ผูกใบ) ไม่เข้า %P — ไม่รู้ CT ⇒ ห้ามเดา (เหมือนกฎในจอ)
   🔴 MAT ที่ **วันนี้ไม่มี CT แล้ว** ⇒ สูตรคำนวณ stdMin ไม่ได้ ⇒ **ข้ามกะนั้น ไม่แตะ** แล้วรายงานออกมา
      (เช่น 50031625 ของ Laser LWR — แถว kanban_standards กำพร้า product_id = null)

   อินพุตเป็นไฟล์ (คอนเทนเนอร์นี้ยิง Supabase ตรงไม่ได้ — network allowlist) รูปแบบ `|` คั่น:
     orders.txt  session8|mat_no|status|qty|qty_actual     (รวมแล้วต่อ session+mat+status)
     ng.txt      session8|mat_no|qty_ng+qty_suspect        (รวมแล้วต่อ session+mat)
     ct.txt      mat_no|cycle_time_sec|pair_mat_no
   ใช้: node scripts/backfill/ngInPFactor.mjs <dir>
   ══════════════════════════════════════════════════════════════════════════════════ */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeSessionOee } from '../../src/utils/oee.js';

const dir = process.argv[2];
if (!dir) { console.error('ใช้: node scripts/backfill/ngInPFactor.mjs <dir ที่มี orders.txt ng.txt ct.txt>'); process.exit(1); }
const rows = (f) => readFileSync(join(dir, f), 'utf8').split('\n').filter(Boolean).map(l => l.split('|'));

const products = rows('ct.txt').map(([mat_no, ct, pair]) => ({
  mat_no, cycle_time_sec: ct ? Number(ct) : null, pair_mat_no: pair || null, name: mat_no, p_no: mat_no,
}));

const bySess = new Map();
const get = (s) => bySess.get(s) || bySess.set(s, { orders: [], defects: [] }).get(s);
let oid = 0;
rows('orders.txt').forEach(([s, mat, status, qty, qa]) =>
  get(s).orders.push({ id: `o${++oid}`, mat_no: mat || null, status, qty: Number(qty), qty_actual: Number(qa) }));
rows('ng.txt').forEach(([s, mat, ng]) =>
  get(s).defects.push({ id: `d${s}${mat}`, prod_orders: { mat_no: mat }, qty_ng: Number(ng), qty_suspect: 0 }));

/* กรอบกะสมมติ — เหมือนกันทั้งสองรอบ ⇒ ตัวหารหักกลบ (ยาวพอให้ %P ไม่ชนเพดานจนบังอัตราส่วน) */
const SESS = { work_date: '2026-01-01', shift: 'day', line_name: 'X', start_time: '00:00:00', end_time: '23:59:00' };
const run = (o, d) => computeSessionOee({
  session: SESS, orders: o, defects: d, ngQty: 0, products, endTime: '23:59:00',
});

const out = [], skip = [];
for (const [s, { orders, defects }] of [...bySess].sort()) {
  if (!defects.length) continue;
  const a = run(orders, defects), b = run(orders, []);
  if (!(b.stdMin > 0)) { skip.push([s, 'คำนวณเวลามาตรฐานไม่ได้ (MAT ไม่มี CT ในทะเบียนวันนี้)']); continue; }
  const factor = a.stdMin / b.stdMin;
  if (!(factor > 1 + 1e-9)) { skip.push([s, `ตัวเศษไม่ขยับ (factor ${factor.toFixed(6)})`]); continue; }
  out.push({ s, factor, ngInP: a.ngInP, ngNoMat: a.ngNoMatP, stdOld: b.stdMin, stdNew: a.stdMin });
}

console.log(`กะที่มีของเสียผูกใบ ${[...bySess].filter(([, v]) => v.defects.length).length} · คิด factor ได้ ${out.length} · ข้าม ${skip.length}\n`);
out.sort((x, y) => y.factor - x.factor);
for (const r of out.slice(0, 12))
  console.log(`  ${r.s}  ×${r.factor.toFixed(5)}  (เวลามาตรฐาน ${r.stdOld.toFixed(1)} → ${r.stdNew.toFixed(1)} นาที · NG เข้า %P ${r.ngInP})`);
console.log(`  … รวม ${out.length} กะ`);
for (const [s, why] of skip) console.log(`  – ข้าม ${s}: ${why}`);

console.log('\n--- VALUES สำหรับ SQL ---');
console.log(out.map(r => `('${r.s}',${r.factor.toFixed(8)})`).join(','));
