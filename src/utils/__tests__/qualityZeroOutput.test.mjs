/* %Q ของกะที่ "ผลิตของดีไม่ได้เลย" — บั๊ก 2026-09-17 (เจอจาก audit ทั้งฐาน)
   ของเดิม: const Q = totalProduced > 0 ? ... : 1
   ⇒ กะที่ทำออกมาเสียล้วน ไม่มีของดีสักชิ้น ได้ %Q = 100.00 (กลับหัวกับความจริง)
   วัดจริง 17 กะ (03–15/07) · หนักสุด LASER EXPORT 08/07 กะดึก: ของดี 0 เสีย 32 ⇒ Q = 100
   backfill แล้วด้วย 20260917b_oee_q_zero_output_dr.sql

   หลักที่ยึด (เดียวกับ %A/%P ทั้งโปรเจค): **"0" กับ "ยังไม่รู้" คนละเรื่อง ห้ามปนกัน** */
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

/** สูตร %Q ตอนปิดกะ — ถอดมาจาก computeSessionOee ใน src/utils/oee.js (§8) ให้ตรงตัว */
const qualityOf = (produced, ng) =>
  produced > 0 ? produced / (produced + ng) : (ng > 0 ? 0 : null);

test('🔴 ของดี 0 + ของเสีย > 0 ⇒ Q = 0 (ห้ามเป็น 1)', () => {
  assert.equal(qualityOf(0, 32), 0, 'LASER EXPORT 08/07: ของดี 0 เสีย 32 ต้องได้ 0 ไม่ใช่ 100%');
  assert.equal(qualityOf(0, 1), 0);
});

test('ของดี 0 + ของเสีย 0 ⇒ null (ไม่มีอะไรให้ประเมิน ห้ามให้เลขไปถ่วงค่าเฉลี่ย)', () => {
  assert.equal(qualityOf(0, 0), null);
});

test('เคสปกติ — ของดี/(ของดี+เสีย) ห้ามหักซ้ำ', () => {
  assert.equal(qualityOf(10, 1), 10 / 11);          // 90.9% ไม่ใช่ 90%
  assert.equal(qualityOf(100, 50), 100 / 150);      // 66.7% ไม่ใช่ 50%
  assert.equal(qualityOf(384, 0), 1);
});

test('🛡️ โค้ดจริงต้องไม่กลับไปใช้ `: 1` อีก', () => {
  // สูตรปิดกะย้ายจาก DailyReport.computeOEE → oee.js `computeSessionOee` เมื่อ 24/09/2026
  const src = readFileSync(new URL('../oee.js', import.meta.url), 'utf8');
  const m = src.match(/const Q = totalProduced > 0[\s\S]{0,200}?;/);
  assert.ok(m, 'หาสูตร Q ใน computeSessionOee ไม่เจอ — ถ้าย้ายที่ ให้แก้เทสนี้ด้วย');
  assert.ok(!/:\s*1\s*;/.test(m[0]),
    '\n\n❌ สูตร %Q กลับไปคืน 1 เมื่อผลิตได้ 0 แล้ว\n'
    + '   ทำไมห้าม: กะที่ทำออกมาเสียล้วนจะได้ %Q = 100% (เกิดจริง 17 กะ ก.ค. 2026)\n'
    + '   ที่ถูก: ของเสีย > 0 → 0 · ไม่มีอะไรเลย → null\n');
  assert.ok(/ngQty > 0 \? 0 : null/.test(m[0]), 'ต้องแยกเคส "เสียล้วน" กับ "ไม่มีอะไรเลย"');
});
