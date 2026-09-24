import test from 'node:test';
import assert from 'node:assert/strict';
import { logOddsZ, pickDiscriminative } from '../termStats.js';

/* ตัวเลขทั้งหมดคือสัดส่วนที่ "วัดจากข้อมูลจริง" 90 วัน (23/09) — ดูตารางในหัว termStats.js */

test('🔴 100% จาก 2 ใบ ต้องแพ้ 88% จาก 125 ใบ (หัวใจของรอบนี้)', () => {
  const N = 40000, NI = 3000;
  const zConveyor = logOddsZ(110, 125, NI, N);   // conveyor — ถูก
  const zKhang    = logOddsZ(2, 2, NI, N);       // "ข้าง" — บังเอิญล้วน
  assert.ok(zConveyor > zKhang * 5, `conveyor(${zConveyor.toFixed(1)}) ต้องชนะ ข้าง(${zKhang.toFixed(1)}) ขาด`);
  assert.ok(zConveyor >= 1.96, 'คำที่ชี้ได้จริงต้องผ่านเกณฑ์ 95%');
  assert.ok(zKhang < 1.96, 'คำที่เจอ 2 ครั้งต้องไม่ผ่าน');
});

test('คำโหลที่บังเอิญอยู่กลุ่มเดียว 100% ก็ยังไม่ผ่าน ถ้าหลักฐานน้อย', () => {
  const N = 40000, NI = 3000;
  for (const [n, label] of [[14, 'line'], [4, 'กล้อง'], [3, 'เหล็ก']]) {
    assert.ok(logOddsZ(n, n, NI, N) < 1.96, `${label} (${n} ใบ) ต้องไม่ผ่าน`);
  }
});

test('pickDiscriminative คืนเฉพาะคำที่ผ่านเกณฑ์ + บอกกลุ่มที่ชนะ', () => {
  const counts = new Map([
    ['conveyor', new Map([['ราง Conveyor มีปํญหา', 110], ['ชิ้นงานเต็มราง Conveyor', 15]])],
    ['ข้าง', new Map([['แก้ไขปัญหาคุณภาพ', 2]])],
  ]);
  const out = pickDiscriminative(counts);
  assert.equal(out.get('conveyor')?.group, 'ราง Conveyor มีปํญหา');
  /* 🔴 "ข้าง" ตกเพราะ **พื้นขั้นต่ำ** (2 < minCount 3) ไม่ใช่เพราะ z —
     ในคลังจิ๋วแบบเทสนี้ z ของมันขึ้นไปถึง 1.98 (ผ่านฉิวเฉียด) เพราะคลังเล็ก
     ⇒ นี่คือเหตุผลที่ต้องมีทั้งสถิติและพื้นขั้นต่ำ ห้ามถอดอันใดอันหนึ่งออก */
  assert.equal(out.has('ข้าง'), false);
  assert.ok(pickDiscriminative(counts, { minCount: 1 }).has('ข้าง'), 'ยืนยันว่าตกเพราะพื้นขั้นต่ำจริง');
});

test('รับ object ธรรมดาแทน Map ได้ + คลังว่างต้องไม่โยน error', () => {
  const out = pickDiscriminative([['laser', { 'เลเซอร์มีปัญหา': 50 }]]);
  assert.ok(out.has('laser') || out.size === 0);          // ไม่โยน error คือประเด็น
  assert.equal(pickDiscriminative([]).size, 0);
  assert.equal(logOddsZ(0, 0, 0, 0), 0);
});

test('a0 มากขึ้น = ต้องการหลักฐานมากขึ้น (ปรับความเข้มได้จริง)', () => {
  const N = 40000, NI = 3000;
  assert.ok(logOddsZ(8, 9, NI, N, 50) > logOddsZ(8, 9, NI, N, 300));
});
