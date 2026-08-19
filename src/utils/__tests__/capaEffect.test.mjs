/* เทสสูตรวัดประสิทธิผล 8D (เฟส 4) — pure ล้วน รันด้วย: node src/utils/__tests__/capaEffect.test.mjs
   ครอบเคสขอบที่ QC audit ชี้: beforeTotal=0 · afterDays<MIN_DAYS · apd===bpd */
import { judgeEffect, splitBeforeAfter, effectWindow, MIN_DAYS, DROP_OK, DROP_PARTIAL } from '../capaEffect.js';
import { sumDefectQty } from '../oee.js';

const q = (r) => sumDefectQty(r, 'line');
let pass = 0; const fails = [];
const ok = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else fails.push(`${name}\n     got  ${g}\n     want ${w}`);
};

/* ── เกณฑ์ตัดสิน ── */
ok('ลด 60% = ได้ผล', judgeEffect({ beforeDays: 10, afterDays: 10, beforeTotal: 100, afterTotal: 40, beforePerDay: 10, afterPerDay: 4 }).verdict, 'effective');
ok('ลดเหลือ 0 = ได้ผล', judgeEffect({ beforeDays: 10, afterDays: 10, beforeTotal: 100, afterTotal: 0, beforePerDay: 10, afterPerDay: 0 }).verdict, 'effective');
ok('ลด 30% = ดีขึ้นบางส่วน', judgeEffect({ beforeDays: 10, afterDays: 10, beforeTotal: 100, afterTotal: 70, beforePerDay: 10, afterPerDay: 7 }).verdict, 'partial');
ok('ลด 5% = ยังไม่ได้ผล', judgeEffect({ beforeDays: 10, afterDays: 10, beforeTotal: 100, afterTotal: 95, beforePerDay: 10, afterPerDay: 9.5 }).verdict, 'not_effective');
ok('เพิ่มขึ้น = แย่ลง', judgeEffect({ beforeDays: 10, afterDays: 10, beforeTotal: 100, afterTotal: 130, beforePerDay: 10, afterPerDay: 13 }).verdict, 'worse');
/* ⚠️ เท่าเดิมเป๊ะ = ไม่ได้ผล (ไม่ใช่ worse) — เกณฑ์ใช้ apd > bpd ไม่ใช่ >= */
ok('เท่าเดิมเป๊ะ = ยังไม่ได้ผล ไม่ใช่แย่ลง', judgeEffect({ beforeDays: 10, afterDays: 10, beforeTotal: 100, afterTotal: 100, beforePerDay: 10, afterPerDay: 10 }).verdict, 'not_effective');
ok('ขอบ 50% พอดี = ได้ผล', judgeEffect({ beforeDays: 9, afterDays: 9, beforeTotal: 90, afterTotal: 45, beforePerDay: 10, afterPerDay: 5 }).verdict, 'effective');
ok('ขอบ 20% พอดี = ดีขึ้นบางส่วน', judgeEffect({ beforeDays: 9, afterDays: 9, beforeTotal: 90, afterTotal: 72, beforePerDay: 10, afterPerDay: 8 }).verdict, 'partial');

/* ── "วัดไม่ได้" ต้องไม่กลายเป็น "ไม่ได้ผล" (กฎเหล็กข้อ 2) ── */
ok('หลังน้อยกว่า MIN_DAYS = ยังวัดไม่ได้', judgeEffect({ beforeDays: 20, afterDays: MIN_DAYS - 1, beforeTotal: 200, afterTotal: 0, beforePerDay: 10, afterPerDay: 0 }).verdict, 'too_early');
ok('หลังเท่า MIN_DAYS พอดี = ตัดสินได้', judgeEffect({ beforeDays: 10, afterDays: MIN_DAYS, beforeTotal: 100, afterTotal: 10, beforePerDay: 10, afterPerDay: 2 }).verdict, 'effective');
ok('ไลน์หยุดหลังแก้ (0 วันผลิต) ต้องไม่ขึ้นว่าได้ผล', judgeEffect({ beforeDays: 20, afterDays: 0, beforeTotal: 200, afterTotal: 0, beforePerDay: 10, afterPerDay: 0 }).verdict, 'too_early');
ok('ก่อนน้อยกว่า MIN_DAYS = ไม่มีฐานเทียบ', judgeEffect({ beforeDays: 2, afterDays: 10, beforeTotal: 20, afterTotal: 5, beforePerDay: 10, afterPerDay: 0.5 }).verdict, 'no_baseline');
ok('ก่อนไม่มีของเสียเลย = ไม่มีฐานเทียบ (ห้ามเป็น effective)', judgeEffect({ beforeDays: 10, afterDays: 10, beforeTotal: 0, afterTotal: 0, beforePerDay: 0, afterPerDay: 0 }).verdict, 'no_baseline');
ok('ก่อน 0 แต่หลังมี = ไม่มีฐานเทียบ (ห้ามเป็น worse)', judgeEffect({ beforeDays: 10, afterDays: 10, beforeTotal: 0, afterTotal: 50, beforePerDay: 0, afterPerDay: 5 }).verdict, 'no_baseline');
ok('ไม่มีกะเลย', judgeEffect({ beforeDays: 0, afterDays: 0, beforeTotal: 0, afterTotal: 0 }).verdict, 'no_data');
ok('ไม่มี pivot', judgeEffect(null).verdict, 'no_pivot');
/* ⚠️ ห้ามคืน null ไม่ว่า input จะเป็นอะไร — null ทำให้ปิดใบแล้วไม่ stamp verdict */
ok('ทุก input ต้องได้ verdict ไม่ใช่ null', [undefined, null, {}, { beforeDays: 0 }].every(x => !!judgeEffect(x)?.verdict), true);

/* ── splitBeforeAfter ── */
const S = [
  { id: 'a', work_date: '2026-08-01' }, { id: 'b', work_date: '2026-08-02' },
  { id: 'c', work_date: '2026-08-10' }, { id: 'd', work_date: '2026-08-11' }, { id: 'e', work_date: '2026-08-11' },
];
const D = [
  { session_id: 'a', qty_ng: 10, qty_suspect: 2 },
  { session_id: 'b', qty_ng: 8 },
  { session_id: 'c', qty_ng: 3 },
  { session_id: 'd', qty_ng: 1, is_trial: true },                          // งานทดลอง — ไม่นับ
  { session_id: 'e', qty_ng: 4, dr_defect_types: { excl_from_q: true } },  // ประเภททดลอง — ไม่นับ
];
const m = splitBeforeAfter(S, D, '2026-08-05', q);
ok('วันผลิตนับ unique (2 กะวันเดียว = 1 วัน)', [m.beforeDays, m.afterDays], [2, 2]);
ok('qty_suspect ถูกนับด้วย · งานทดลองไม่ถูกนับ', [m.beforeTotal, m.afterTotal], [20, 3]);
ok('ต่อวัน', [m.beforePerDay, m.afterPerDay], [10, 1.5]);
ok('ไม่มีกะ/ไม่มีของเสีย = ศูนย์หมด ไม่ NaN', splitBeforeAfter([], [], '2026-08-05', q), { beforeDays: 0, afterDays: 0, beforeTotal: 0, afterTotal: 0, beforeCount: 0, afterCount: 0, beforePerDay: 0, afterPerDay: 0 });

/* ── effectWindow ── */
ok('หน้าต่าง 30 วัน', effectWindow('2026-08-10', 30, '2026-09-30'), { from: '2026-07-11', to: '2026-09-08', pivot: '2026-08-10', windowDays: 30, capped: false });
ok('ยังไม่ครบหน้าต่าง = capped', effectWindow('2026-08-10', 30, '2026-08-18').capped, true);
ok('ไม่มี pivot = null', effectWindow(null, 30), null);
ok('window ต่ำกว่า 7 ถูกยกเป็น 7', effectWindow('2026-08-10', 1, '2026-12-01').from, '2026-08-03');
ok('ค่าคงที่เกณฑ์', [MIN_DAYS, DROP_OK, DROP_PARTIAL], [5, 0.5, 0.2]);

console.log(fails.length ? `❌ ${fails.map((f, i) => `\n  ${i + 1}) ${f}`).join('')}\n\nผ่าน ${pass} · ล้มเหลว ${fails.length}` : `✅ ผ่านทั้งหมด ${pass} เคส`);
process.exit(fails.length ? 1 : 0);
