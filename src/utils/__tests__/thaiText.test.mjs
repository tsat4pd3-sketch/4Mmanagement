import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeThai, segmentWords, candidateTerms, phoneticKey, editDistance, sameWord,
} from '../thaiText.js';

/* 🔴 ทุกคำในเทสนี้เป็น "ข้อความจริงจาก downtime_logs / dr_downtime_types" (90 วัน · 23-24/09)
   ห้ามแต่งคำขึ้นมาเทส ไม่งั้นเทสผ่านกับภาษาสมมติแต่พังกับสิ่งที่ช่างพิมพ์จริง */

test('normalize: NFC + เเ→แ + แยกรอยต่อไทย↔อังกฤษ↔เลข', () => {
  assert.equal(normalizeThai('สายไฮดรอลิคเเตก'), 'สายไฮดรอลิคแตก');   // เ 2 ตัว = แ พิมพ์ผิด
  assert.equal(normalizeThai('เลเซอร์05อารามtc'), 'เลเซอร์ 05 อาราม tc');
  assert.equal(normalizeThai('เครื่องBending มีปัญหา'), 'เครื่อง bending มีปัญหา');
  assert.equal(normalizeThai('Alarm TC_OBSERVELINE2'), 'alarm tc observeline2');
  assert.equal(normalizeThai('a​b'), 'ab');                        // zero-width space
});

test('ตัดคำไทยได้จริง (ICU) — ไทยไม่มีช่องว่าง .split() ใช้ไม่ได้', () => {
  const w = segmentWords('อารามลมตก');
  assert.ok(w.length > 1, `ต้องตัดได้มากกว่า 1 คำ ได้ ${JSON.stringify(w)}`);
  assert.ok(w.includes('อาราม'));
  // ถ้าเครื่องไม่มี Intl.Segmenter ต้องไม่พัง — คืนก้อนเดิม (ไม่แย่ลงกว่าโค้ดเดิม)
  assert.deepEqual(segmentWords('bending alarm'), ['bending', 'alarm']);
});

test('ต่อเศษคำที่ติดกันกลับเป็นคำได้ (คำยืมไม่มีในพจนานุกรม ICU)', () => {
  const c = candidateTerms('คอนเวเย่ออาราม');
  assert.ok(c.includes('คอนเวเย่อ'), `ต้องมี "คอนเวเย่อ" ในผู้เข้าชิง ได้ ${JSON.stringify(c)}`);
  assert.ok(c.includes('อาราม'));
});

test('🔴 ผู้เข้าชิงที่ขึ้นต้น/ลงท้ายด้วยคำโหล ต้องถูกตัด — กัน "ไม่ทัน" ไปชน meeting', () => {
  /* ⚠️ ICU ตัด "ไม่ทัน" เป็น **คำเดียว** (ไม่ใช่ ไม่+ทัน) ⇒ กันด้วยตัวตัดคำไม่ได้
     ต้องอยู่ใน STOP ของ autoCategory ด้วย — เทสนี้ล็อกแค่กลไก isStop */
  const c = candidateTerms('พนักงานใหม่เคาะงานไม่ทัน', { isStop: (t) => t === 'ไม่ทัน' });
  assert.equal(c.includes('ไม่ทัน'), false, 'คำโหลเดี่ยวๆ ต้องไม่เป็นผู้เข้าชิง');
  assert.equal(c.includes('งานไม่ทัน'), false, 'ลงท้ายด้วยคำโหล ต้องไม่เป็นผู้เข้าชิง');
  assert.ok(c.includes('พนักงาน'), 'คำปกติต้องยังอยู่');
});

test('🔴 คีย์เสียงข้ามสคริปต์ — คำทับศัพท์ต้องได้คีย์เท่ากับคำอังกฤษ', () => {
  const same = [['เบนดิ่ง', 'bending'], ['ไฮดรอลิค', 'hydraulic'], ['เซ็นเซอร์', 'sensor'],
    ['สต็อปเปอร์', 'stopper'], ['กริปเปอร์', 'gripper'], ['เมนเดล', 'mandrel'],
    ['โซลินอยด์', 'solenoid'], ['ชูตเตอร์', 'shooter'], ['แม็กเนต', 'magnet']];
  for (const [th, en] of same) {
    assert.equal(phoneticKey(th), phoneticKey(en), `${th} ควรได้คีย์เท่า ${en}`);
    assert.ok(sameWord(th, en), `${th} ควรถือเป็นคำเดียวกับ ${en}`);
  }
});

test('🔴 เสียงเทียบได้เฉพาะ "ข้ามสคริปต์" — ในสคริปต์เดียวกันต้องเทียบตัวอักษร', () => {
  // เคยพังจริง 24/09: ปล่อยให้เทียบเสียงในสคริปต์เดียวกัน แล้วคำไทยคนละเรื่องชนกันเพียบ
  assert.equal(sameWord('เริ่มงาน', 'อาราม'), false);
  assert.equal(sameWord('ทำความสะอาด', 'ทำความสะอาดหัว'), false);
  assert.equal(sameWord('งานยุบ', 'kanban'), false);
  // พิมพ์ผิดในสคริปต์เดียวกัน = ต้องจับได้
  assert.ok(sameWord('คอนเวเย่า', 'คอนเวเย่อ'));
  assert.ok(sameWord('conyeyor', 'conveyor'));
  assert.ok(sameWord('bemding', 'bending'));
});

test('คีย์เท่ากันแต่สั้นเกิน 3 พยัญชนะ = ยังไม่เชื่อ (หรีด/reed → rd)', () => {
  assert.equal(phoneticKey('หรีด'), phoneticKey('reed'));   // กฎ ห นำ ทำงานถูก
  assert.equal(sameWord('หรีด', 'reed'), false);            // แต่ 2 พยัญชนะ = หลักฐานน้อยเกิน
});

test('🔴 คำสั้น/คีย์สั้น ห้ามเทียบด้วยเสียง — การชนที่อันตรายจริงในข้อมูลชุดนี้', () => {
  assert.equal(sameWord('ลม', 'alarm'), false);      // ลม (air) vs alarm → คีย์ rm เท่ากัน!
  assert.equal(sameWord('ลมตก', 'alarm'), false);
  assert.equal(sameWord('nut', 'not'), false);
  assert.equal(sameWord('tip', 'top'), false);
  assert.equal(sameWord('ราง', 'รอง'), false);
  assert.equal(sameWord('เครื่อง', 'clearance'), false);   // krn / krns — เคยชนตอนยอมให้เผื่อ 1 ตัว
  assert.equal(sameWord('คอนโทน', 'kanban'), false);
});

test('editDistance — Damerau (สลับตัว) + ไม่ระเบิดตอนแถวที่ 2', () => {
  assert.equal(editDistance('abcdef', 'abdcef', 3), 1);   // สลับ 2 ตัวติดกัน = 1
  assert.equal(editDistance('knwr', 'knwy', 2), 1);
  assert.equal(editDistance('abc', 'abc', 2), 0);
  assert.ok(editDistance('aaaa', 'bbbb', 2) > 2);         // เกินเพดานต้องคืนค่ามากกว่า max
});

test('ข้อมูลเพี้ยนต้องไม่โยน error', () => {
  for (const v of [null, undefined, '', 123, {}, '   ']) {
    assert.doesNotThrow(() => { normalizeThai(v); phoneticKey(v); candidateTerms(v); });
  }
  assert.equal(sameWord(null, 'alarm'), false);
});
