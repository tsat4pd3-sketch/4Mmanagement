/* %Q ของกะที่ "ผลิตของดีไม่ได้เลย" — บั๊ก 2026-09-17 (เจอจาก audit ทั้งฐาน)
   ของเดิม: const Q = totalProduced > 0 ? ... : 1
   ⇒ กะที่ทำออกมาเสียล้วน ไม่มีของดีสักชิ้น ได้ %Q = 100.00 (กลับหัวกับความจริง)
   วัดจริง 17 กะ (03–15/07) · หนักสุด LASER EXPORT 08/07 กะดึก: ของดี 0 เสีย 32 ⇒ Q = 100
   backfill แล้วด้วย 20260917b_oee_q_zero_output_dr.sql

   หลักที่ยึด (เดียวกับ %A/%P ทั้งโปรเจค): **"0" กับ "ยังไม่รู้" คนละเรื่อง ห้ามปนกัน**

   📌 25/11 — สูตร %Q ย้ายไปอยู่ที่ `qRatio()` (oee.js §7.2.2) ตัวเดียวทั้งระบบ
      ⇒ เทสนี้เลิกถอดสูตรมาไว้เองแล้ว (สำเนาที่ 2 = สิ่งที่เทสนี้มีหน้าที่กัน) เรียกของจริงตรงๆ
      · ตัวหารเปลี่ยนจาก "ยอดสแกน + ของเสีย" → **"ยอดผลิต"** (ทุกชิ้นที่เครื่องทำออกมา)
        แต่เคสในเทสนี้ให้ผลเท่าเดิมเป๊ะ เพราะเมื่อของเสียถูกตัดสินครบ 2 สูตรเท่ากันทางพีชคณิต:
        `ok / (ok + ng)` ≡ `(ok + ng − ng) / (ok + ng)` */
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { qRatio, qTotalCount } from '../oee.js';

/** %Q ตามที่ `computeSessionOee` เรียกจริง — ยอดสแกน `ok` ชิ้น · ของเสียที่ตัดสินแล้ว `ng` ชิ้น
 *  (ไม่มีแถว defect_logs ให้ ⇒ ฐานถอยไป `ok + ng` ด้วยด่าน `Math.max` ตัวเดียวกับในโค้ดจริง) */
const qualityOf = (ok, ng) => qRatio(Math.max(qTotalCount(ok, []), ok + ng), ng);

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

test('🛡️ โค้ดจริงต้องไม่กลับไปใช้ `: 1` อีก — และต้องเดินผ่าน `qRatio` ตัวเดียว', () => {
  const src = readFileSync(new URL('../oee.js', import.meta.url), 'utf8');

  /* ① `qRatio` เป็นคนตอบ "ยอดผลิต 0 = ตอบไม่ได้" — ห้ามเปลี่ยนเป็น 0/1 */
  const fn = src.match(/export function qRatio\([\s\S]{0,400}?\n}/);
  assert.ok(fn, 'หา qRatio ใน oee.js ไม่เจอ — ถ้าย้ายที่ ให้แก้เทสนี้ด้วย');
  assert.ok(/if \(!\(tc > 0\)\) return null;/.test(fn[0]),
    '\n\n❌ `qRatio` ไม่คืน null เมื่อยอดผลิต 0 แล้ว\n'
    + '   ทำไมห้ามคืน 0/1: 0 = "เสียล้วน" · null = "ไม่มีอะไรให้ประเมิน" — คนละเรื่อง\n'
    + '   เลข 0 ที่ไม่มีมูลจะไปถ่วงค่าเฉลี่ย OEE ของเดือนทั้งเดือน\n');

  /* ② ทั้ง 2 จุดที่คิด %Q ต้องเรียก `qRatio` + มีด่าน `Math.max` back-compat
        (เคยมี 3 สำเนาของสูตรนี้ — ดู regressionGuards `q-ratio-single-entry`) */
  for (const m of ['computeLiveOee', 'computeSessionOee']) {
    const body = src.slice(src.indexOf(`export function ${m}(`));
    const head = body.slice(0, body.indexOf('\nexport '));
    assert.ok(/const Q = qRatio\(/.test(head), `${m} ต้องคิด %Q ผ่าน qRatio()`);
    assert.ok(/Math\.max\(/.test(head.slice(head.indexOf('const Q = qRatio(') - 400)),
      `${m} ต้องมีด่าน Math.max กันผู้เรียกที่ไม่ส่งแถวของเสีย (ฐานห้ามต่ำกว่าสูตรเดิม)`);
  }

  /* ③ กะที่ "เสียล้วน" ต้องยังได้ 0 ไม่ใช่ null — พิสูจน์ด้วยค่าจริง ไม่ใช่ regex */
  assert.equal(qualityOf(0, 32), 0);
});
