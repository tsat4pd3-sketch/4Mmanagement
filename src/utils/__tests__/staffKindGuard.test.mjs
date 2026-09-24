/* 🛡️ ด่าน "จอที่นับคน ต้องกรองพนักงานทางอ้อมออก" — 2026-09-21
 *
 * ทำไมไม่ไปอยู่ใน regressionGuards.test.mjs: กฎที่นั่นเป็น "regex ต้องห้ามทั้งรีโป"
 * แต่กฎนี้ขึ้นกับ **บริบทของหน้า** — `from('employees')` ในจอ "เลือกคน" (ผู้แจ้งซ่อม /
 * ผู้เข้าอบรม / คนขึ้นรถ) ถูกต้องแล้วที่ไม่กรอง · ผิดเฉพาะในจอ "นับคน"
 * ⇒ เขียนเป็นรายการไฟล์ตรงๆ แม่นกว่าและไม่มี false positive (กติกาข้อ 1 ของ regressionGuards)
 *
 * ── บั๊กที่กันไว้ ────────────────────────────────────────────────────────────
 * 21/09 `employees` เปลี่ยนจาก "ทะเบียนคนหน้าไลน์" เป็น **ทะเบียนคนของทั้งบริษัท**
 * (เพื่อให้บัญชี QA/PE/ธุรการ/สโตร์ 30 ใบ ผูกตัวตนได้ — เดิมถูกติดป้าย "ไม่ใช่คน" 32 ใบ)
 * ⇒ ถ้าจอที่นับคนไม่กรอง `staff_kind='indirect'` ออก จะเกิด **ทันทีที่มีคนทางอ้อมคนแรกถูกคีย์**:
 *   · ธุรการ/เซลล์ โผล่ในลิสต์เช็คชื่อรายวัน (หัวหน้าต้องมานั่งกาว่า "ขาดงาน")
 *   · กำลังคน/OEE manpower/turnover เฟ้อขึ้นโดยไม่มีใครรู้ว่าเพราะอะไร
 *   · แผงสกิลมีคนที่ไม่มีวันมีสกิลหน้าไลน์
 * **บั๊กคลาสนี้ไม่มีอะไรฟ้องเลย** — build/lint ผ่าน จอไม่พัง แค่ตัวเลขผิดเงียบๆ
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../../', import.meta.url).pathname;

/** จอที่ "นับคน" — ทุก query `employees` ที่ดึง**รายชื่อ**ต้องผ่าน onlyDirectStaff() */
const COUNTING_SCREENS = {
  'src/pages/Checkin.jsx':          'เช็คชื่อ + PPE รายวัน (และช่องยืมคนข้ามไลน์)',
  'src/pages/Report.jsx':           'รายงานเข้างาน / OT / สกิล',
  'src/pages/ShiftOrganize.jsx':    'จัดกะ A/B',
  'src/pages/WorkforceInsight.jsx': 'กำลังคนรายวัน / เปลี่ยนจุดงาน / turnover',
};

/* ⚠️ จอที่ **ตั้งใจไม่อยู่ในลิสต์** (ถอดออก 23/09 — เขียนเหตุผลไว้กันคนเผลอใส่กลับ):
     `src/pages/operator.jsx` = **ทะเบียนพนักงาน** ไม่ใช่จอที่นับกำลังคน
     ใส่ตัวกรองไว้แล้วเกิดของจริง: พนักงานสายสนับสนุน 2 คนที่เพิ่งสร้างจาก /add-user
     (เจนนิภา · สุทธวีร์) **หายจากทะเบียนทั้งคู่** ⇒ เปิดแก้ข้อมูลเขาไม่ได้เลย
     "มีอยู่ในฐานแต่มองไม่เห็น" แย่กว่า "โผล่มาแล้วกรองทิ้ง"
     ⇒ ทะเบียนแสดงทุกคน + มีชิป 🧑‍🏭 หน้างาน / 🗂️ สนับสนุน ให้กรองดูเอง
     การกันไม่ให้ปนใน "กำลังคน" ทำที่จอที่นับคน (ลิสต์ข้างบน) เท่านั้น */

/** query ที่ไม่ใช่ "ดึงรายชื่อ" — เขียนค่า/ดึงทีละคน ไม่ต้องกรอง */
const NOT_A_LIST = /\.(update|insert|upsert|delete)\s*\(/;

/** ยกเว้นที่ตั้งใจ — ต้องเขียนเหตุผลเสมอ (กติกาข้อ 4 ของ regressionGuards) */
const ALLOW = [
  { file: 'src/pages/Checkin.jsx', match: "in('id', missingHelperIds)",
    why: 'ดึง "คนที่ถูกยืมมาช่วยไลน์" ตาม id ที่บันทึกไว้แล้ว — กรองตรงนี้ = คนที่หัวหน้าเลือกไว้เอง '
       + 'หายจากใบเช็คชื่อเงียบๆ · การตัดสินว่าใครถูกยืมได้ อยู่ที่ตอนเลือก (ช่องค้นด้านบน กรองแล้ว)' },
];
const allowed = (rel, chunk) => ALLOW.some(a => a.file === rel && chunk.includes(a.match));

test('🛡️ จอที่นับคน: ทุก query รายชื่อ employees ต้องผ่าน onlyDirectStaff()', () => {
  const bad = [];
  for (const [rel, what] of Object.entries(COUNTING_SCREENS)) {
    const src = readFileSync(join(ROOT, rel), 'utf8');
    const lines = src.split('\n');
    lines.forEach((line, i) => {
      if (!line.includes("from('employees')")) return;
      if (line.trim().startsWith('*') || line.trim().startsWith('//')) return;   // คอมเมนต์
      // ต่อบรรทัดถัดไปด้วย เพราะ .update({...}) มักขึ้นบรรทัดใหม่
      const chunk = line + '\n' + (lines[i + 1] || '');
      if (NOT_A_LIST.test(chunk)) return;
      if (line.includes('onlyShopfloorStaff(') || line.includes('onlyDirectStaff(')) return;
      if (allowed(rel, chunk + '\n' + (lines[i + 2] || ''))) return;
      bad.push(`${rel}:${i + 1} (${what})\n      ${line.trim().slice(0, 110)}`);
    });
  }
  assert.deepEqual(bad, [],
    '\n\n❌ จอที่นับคนดึงรายชื่อ employees โดยไม่กรองพนักงานทางอ้อม ' + bad.length + ' จุด\n'
    + '   ทำไมห้าม: employees = ทะเบียนคนของทั้งบริษัทแล้ว (ตั้งแต่ 21/09) ไม่ใช่แค่คนหน้าไลน์\n'
    + '             ไม่กรอง = ธุรการ/QA/เซลล์ โผล่ในเช็คชื่อ + ถูกนับเป็นกำลังคน **เงียบๆ**\n'
    + '   แก้ยังไง: ครอบด้วย onlyDirectStaff(...) จาก src/utils/staffKind.js\n'
    + '             ถ้าหน้านี้เป็น "จอเลือกคน" ไม่ใช่ "จอนับคน" ให้ถอดออกจาก COUNTING_SCREENS พร้อมเหตุผล\n\n'
    + bad.map(b => '   • ' + b).join('\n') + '\n');
});

test('🛡️ ตัวกรองต้อง "ตัดสายสนับสนุนออก" ไม่ใช่ "เลือกเฉพาะหน้างาน" — ห้าม "หายเงียบ"', () => {
  const src = readFileSync(join(ROOT, 'src/utils/staffKind.js'), 'utf8');
  /* ตัดออก (not in) ⇒ แถวที่ค่าเพี้ยน/ค่าใหม่ในอนาคต ยังถูกนับเป็นคนหน้างาน
     เลือกเข้า (eq) ⇒ ค่าใหม่หายจากทุกจอที่นับคนโดยไม่มีสัญญาณ
     นับเกิน = เห็นแล้วรู้ · หายเงียบ = ไม่มีใครรู้ — เลือกอย่างแรกเสมอ */
  assert.match(src, /\.not\('staff_kind',\s*'in',/);
  assert.ok(!/\.eq\('staff_kind',\s*STAFF_(SHOPFLOOR|DIRECT)\)/.test(src),
    'ห้ามใช้ eq(shopfloor): ค่าใหม่ที่เพิ่มทีหลังจะหายจากทุกจอที่นับคนโดยไม่มีสัญญาณ');
});

test('🛡️ ค่าเก่า indirect ต้องยังถูกตัดออกด้วย (ช่วง deploy มีแท็บเก่าเขียนค่าเก่าได้)', async () => {
  /* 23/09 เปลี่ยนชื่อค่า direct/indirect → shopfloor/support เพื่อเลิกชนกับ org_nodes.labor_type
     check constraint ฝั่ง DB **ยังรับค่าเก่าไว้** ⇒ ตัวกรองต้องครอบทั้ง 2 ชุด
     ไม่งั้นแถวที่แท็บเก่าเขียนไว้จะกลับมาโผล่ในลิสต์เช็คชื่อ/กำลังคนเงียบๆ */
  const m = await import('../staffKind.js');
  assert.ok(m.SUPPORT_VALUES.includes('support'),  'ต้องตัด support');
  assert.ok(m.SUPPORT_VALUES.includes('indirect'), 'ต้องตัดค่าเก่า indirect ด้วย');
  assert.equal(m.isShopfloorStaff({ staff_kind: 'indirect' }), false);
  assert.equal(m.isShopfloorStaff({ staff_kind: 'support' }),  false);
  assert.equal(m.isShopfloorStaff({ staff_kind: 'shopfloor' }), true);
  assert.equal(m.isShopfloorStaff({}), true, 'ไม่ระบุ = นับเป็นหน้างาน (ตาม default ของคอลัมน์)');
});

test('🛡️ ทุกข้อยกเว้นต้องเขียนเหตุผลกำกับ (ห้ามยกเว้นลอยๆ)', () => {
  for (const a of ALLOW) assert.ok(a.why && a.why.length > 30, `${a.file} (${a.match}) ต้องเขียน why`);
});
