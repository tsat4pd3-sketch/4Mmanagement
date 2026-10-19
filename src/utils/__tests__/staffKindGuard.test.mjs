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
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../../', import.meta.url).pathname;

/** จอที่ "นับคน" — ทุก query `employees` ที่ดึง**รายชื่อ**ต้องผ่าน onlyDirectStaff() */
const COUNTING_SCREENS = {
  'src/pages/Report.jsx':           'รายงานเข้างาน / OT / สกิล',
  'src/pages/WorkforceInsight.jsx': 'กำลังคนรายวัน / เปลี่ยนจุดงาน / turnover',
};

/* ⚠️ จอที่ **ตั้งใจไม่อยู่ในลิสต์** (ถอดออก 23/09 — เขียนเหตุผลไว้กันคนเผลอใส่กลับ):
     `src/pages/operator.jsx` = **ทะเบียนพนักงาน** ไม่ใช่จอที่นับกำลังคน
     ใส่ตัวกรองไว้แล้วเกิดของจริง: พนักงานสายสนับสนุน 2 คนที่เพิ่งสร้างจาก /add-user
     (เจนนิภา · สุทธวีร์) **หายจากทะเบียนทั้งคู่** ⇒ เปิดแก้ข้อมูลเขาไม่ได้เลย
     "มีอยู่ในฐานแต่มองไม่เห็น" แย่กว่า "โผล่มาแล้วกรองทิ้ง"
     ⇒ ทะเบียนแสดงทุกคน + มีชิป 🧑‍🏭 หน้างาน / 🗂️ สนับสนุน ให้กรองดูเอง
     การกันไม่ให้ปนใน "กำลังคน" ทำที่จอที่นับคน (ลิสต์ข้างบน) เท่านั้น

   ── ถอดออก 14/10 (คำสั่ง user: "ส่วนสนับสนุนอยากใช้ระบบเช็คชื่อ ให้แยกออกมา") ──
     `src/pages/Checkin.jsx` = **ใบเช็คชื่อ** — user ยืนยันว่าช่าง/ธุรการ/หัวหน้าแผนก
       **ต้องเช็คชื่อได้** แค่ต้อง "แยกกลุ่มให้เห็นชัด" ไม่ใช่กรองหายไป
       ⇒ ลิสต์หลัก + ใบ export ไม่กรอง แต่เรียงเป็นกลุ่ม (หน้างาน → ช่าง → สนับสนุน)
          + มีแถวหัวข้อกลุ่มคั่น (staffGroupOf / STAFF_KINDS)
       ⚠️ ช่อง **ยืมคนข้ามไลน์** ยังกรองอยู่ (= กำลังคนของไลน์จริง) — มีด่านข้างล่าง
     `src/pages/ShiftOrganize.jsx` = **จัดกะ** ไม่ใช่ "นับกำลังคน"
       ช่าง/สนับสนุนก็หมุนกะ A/B/C ⇒ กรองออก = คนกลุ่มนั้น **ไม่มีกะเงียบๆ**
       (บั๊กคลาสเดียวกับไลน์ลูกไม่ตกทอดกะจากไลน์แม่ 13/10) */

/** query ที่ไม่ใช่ "ดึงรายชื่อ" — เขียนค่า/ดึงทีละคน ไม่ต้องกรอง */
const NOT_A_LIST = /\.(update|insert|upsert|delete)\s*\(/;

/** ยกเว้นที่ตั้งใจ — ต้องเขียนเหตุผลเสมอ (กติกาข้อ 4 ของ regressionGuards) */
const ALLOW = [
  /* 14/10 ข้อยกเว้นของ Checkin.jsx ("in('id', missingHelperIds)") ถูกถอดออกทั้งไฟล์แล้ว
     (ดูบล็อก "ถอดออก 14/10" ข้างบน) — ไม่ต้องยกเว้นรายบรรทัดอีก

     Report.jsx มี **2 แกนในไฟล์เดียว** — แท็บสกิล/กำลังคนยังกรอง · แท็บรายบุคคล (มาทำงาน/OT) ห้ามกรอง */
  { file: 'src/pages/Report.jsx', match: "select('id, name, employee_id_code, section, department, team, staff_kind')",
    why: 'แท็บ "รายบุคคล" = ประวัติการมาทำงานของคนคนนั้น — ใครเช็คชื่อได้ต้องเปิดดูเดือนของเขาได้ '
       + 'กรอง = ช่าง/ธุรการที่เช็คชื่อทุกวัน เปิดประวัติไม่ได้เลย (Office PD4 6 คน เช็คชื่อ 28/28 วัน)' },
  { file: 'src/pages/Report.jsx', match: 'department, team, line_id, staff_kind',
    why: 'รายงาน OT รายบุคคล = ชั่วโมง OT ที่ต้องจ่ายเงินจริงของคนคนนั้น '
       + 'กรองสายสนับสนุน/ช่างออก = OT ของเขาหายจากรายงานเงียบๆ (แกนกำลังคนกรองที่แท็บสกิลแทน)' },
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

/* ───────────────────────────────────────────────────────────────────────────────
 * 14/10 · 2 แกน: "เช็คชื่อได้ไหม" (ทุกคนได้) ≠ "เป็นกำลังคนของไลน์ไหม" (หน้างานเท่านั้น)
 * ด่านข้างล่างกันทั้ง 2 ทิศ — ใส่ตัวกรองกลับ = คนหาย · ถอดตัวกรองที่ยืมคน = กำลังคนเฟ้อ
 * ────────────────────────────────────────────────────────────────────────────── */

/** จอที่ "ห้ามกรอง" — ต้องเห็นคนครบทุกกลุ่ม
 *  `queries` = คิวรีรายชื่อหลักของหน้านั้น (ต้องเจอ ไม่งั้นแปลว่าโค้ดเปลี่ยนโครง → อัพเดทด่าน)
 *  `filters` = จำนวน onlyShopfloorStaff() ที่อนุญาตให้มีในไฟล์ (Checkin = 1 ช่องยืมคน · อื่น = 0) */
const MUST_NOT_FILTER = [
  { file: 'src/pages/Checkin.jsx', what: 'ลิสต์เช็คชื่อหลัก + ใบ export', filters: 1,
    queries: [{ re: /let empQ = supabase\.from\('employees'\)/g, n: 2 }],   // ลิสต์หลัก + ใบ export
    why: 'user สั่ง 14/10: สายสนับสนุนต้องเช็คชื่อได้ · กรอง = ช่าง/ธุรการหายจากใบเช็คชื่อทั้งที่มาทำงาน' },
  { file: 'src/pages/ShiftOrganize.jsx', what: 'จัดกะ', filters: 0,
    queries: [{ re: /let q = supabase\.from\('employees'\)/g, n: 1 }],
    why: 'ช่าง/สนับสนุนก็หมุนกะ · กรอง = คนกลุ่มนั้นไม่มีกะเงียบๆ' },
];

test('🛡️ จอเช็คชื่อ/จัดกะ ห้ามกลับไปกรอง staff_kind (user สั่ง 14/10)', () => {
  const bad = [];
  for (const g of MUST_NOT_FILTER) {
    const src = readFileSync(join(ROOT, g.file), 'utf8');
    for (const { re, n } of g.queries) {
      const hits = src.match(re) || [];
      assert.equal(hits.length, n,
        `${g.file}: คิวรีรายชื่อหลักควรมี ${n} จุด แต่เจอ ${hits.length} (${re}) — โค้ดเปลี่ยนโครง `
        + 'ให้อัพเดทด่านนี้ให้ตรง **ห้ามลบด่านทิ้ง**');
      // ตัวกรองอยู่บรรทัดเดียวกันเสมอ (`onlyShopfloorStaff(supabase.from(...)`) ⇒ เช็คทุกบรรทัดที่แมตช์
      src.split('\n').forEach((l, i) => {
        if (!new RegExp(re.source).test(l)) return;
        if (/onlyShopfloorStaff\(|onlyDirectStaff\(/.test(l)) {
          bad.push(`${g.file}:${i + 1} คิวรีหลัก (${g.what}) ถูกครอบตัวกรองกลับ — ${g.why}`);
        }
      });
    }
    const n = (src.match(/onlyShopfloorStaff\(|onlyDirectStaff\(/g) || []).length;
    if (n !== g.filters) {
      bad.push(`${g.file} มีตัวกรอง ${n} จุด (อนุญาต ${g.filters}) — ${g.why}`);
    }
  }
  assert.deepEqual(bad, [],
    '\n\n❌ จอที่ "ต้องเห็นคนครบทุกกลุ่ม" กลับมามีตัวกรอง staff_kind\n'
    + '   แยกกลุ่มด้วย **การเรียง + แถวหัวข้อ** (staffGroupOf / STAFF_KINDS) ไม่ใช่กรองออกจากคิวรี\n'
    + '   เพิ่มตัวกรองใหม่ในไฟล์นี้จริงๆ (เช่นช่องเลือกคนมาเป็นกำลังคน) = แก้ `filters` พร้อมเหตุผล\n\n'
    + bad.map(b => '   • ' + b).join('\n') + '\n');
});

test('🛡️ ช่องยืมคนข้ามไลน์ (Checkin) ต้องยังกรองอยู่ — ยืมคน = กำลังคนของไลน์', () => {
  const src = readFileSync(join(ROOT, 'src/pages/Checkin.jsx'), 'utf8');
  const i = src.indexOf('setBorrowResults(data || [])');
  assert.ok(i > 0, 'หาช่องยืมคนไม่เจอ — โค้ดถูกแก้โครง ให้อัพเดทด่านนี้');
  const block = src.slice(Math.max(0, i - 900), i);
  assert.match(block, /onlyShopfloorStaff\(supabase\.from\('employees'\)/,
    'ช่องค้นหา "ยืมคนข้ามไลน์" ต้องกรองสายสนับสนุน/ช่างออก — ยืมช่างมาเป็นกำลังคนของไลน์ = %A/%P เพี้ยน');
});

test('🛡️ staff_kind = 3 กลุ่ม และ 2 แกนต้องไม่ยุบรวมกัน', async () => {
  const m = await import('../staffKind.js');
  assert.equal(m.STAFF_KINDS.length, 3, 'ต้องมี 3 กลุ่ม: หน้างาน / ช่าง / สนับสนุน');
  assert.deepEqual(m.STAFF_KINDS.map(k => k.key), ['shopfloor', 'technician', 'support'],
    'ลำดับกลุ่มคือลำดับที่แสดงบนจอ (หน้างานขึ้นก่อน) — เปลี่ยนลำดับ = ใบเช็คชื่อสลับแถว');
  for (const k of m.STAFF_KINDS) assert.ok(k.label && k.desc, `${k.key} ต้องมี label + desc`);

  /* แกน 1 — "เป็นกำลังคนของไลน์ไหม": ช่างไม่ใช่ (ซ่อมข้ามไลน์) */
  assert.equal(m.isShopfloorStaff({ staff_kind: 'technician' }), false, 'ช่างไม่ใช่กำลังคนของไลน์');
  assert.equal(m.isShopfloorStaff({ staff_kind: 'shopfloor' }), true);
  assert.equal(m.isShopfloorStaff({}), true, 'ไม่ระบุ = หน้างาน (fail-open · นับเกินดีกว่าหายเงียบ)');
  assert.ok(m.NON_LINE_VALUES.includes('technician') && m.NON_LINE_VALUES.includes('support')
    && m.NON_LINE_VALUES.includes('indirect'), 'ตัวกรองต้องตัดทั้ง ช่าง + สนับสนุน + ค่าเก่า');

  /* แกน 2 — "เช็คชื่อได้ไหม": ทุกกลุ่มได้ (คำสั่ง user 14/10) */
  for (const k of ['shopfloor', 'technician', 'support', 'indirect', undefined]) {
    assert.equal(m.checksInStaff({ staff_kind: k }), true, `${k} ต้องเช็คชื่อได้`);
  }

  /* จัดกลุ่มเพื่อแสดงผล — ค่าเก่า indirect ต้องไปอยู่กลุ่มสนับสนุน ไม่ใช่กลุ่มที่ 4 */
  assert.equal(m.staffGroupOf({ staff_kind: 'indirect' }), 'support');
  assert.equal(m.staffGroupOf({ staff_kind: 'technician' }), 'technician');
  assert.equal(m.staffGroupOf({ staff_kind: 'อะไรไม่รู้' }), 'shopfloor', 'ค่าแปลก = หน้างาน ห้ามหาย');
  assert.equal(m.staffGroupOf(null), 'shopfloor', 'null ต้องไม่ระเบิด');
  const g = m.groupByStaffKind([{ staff_kind: 'technician' }]);
  assert.deepEqual(g.map(x => x.key), ['shopfloor', 'technician', 'support'],
    'groupByStaffKind ต้องคืนครบ 3 กลุ่มเสมอ (กลุ่มว่าง = rows:[] ไม่ใช่หายไป — จอต้องเขียน "ไม่มี")');
  assert.deepEqual(g.map(x => x.rows.length), [0, 1, 0]);
});

/* ═══ 🔴 แกนเดียวกันต้องตอบเหมือนกันทั้ง client และ server (19/10) ═══════════════════
   เจอ 19/10: `isShopfloorStaff()` (client) ตัด `NON_LINE_VALUES` = ช่าง + สนับสนุน
              แต่ `onlyShopfloorStaff()` (server) ตัดแค่ `SUPPORT_VALUES` = สนับสนุนอย่างเดียว
   ⇒ **ชื่อเดียวกัน เจตนาเดียวกัน แต่ให้คำตอบคนละอย่างกับ "ช่าง"** — จอนับกำลังคน/สกิล/turnover
     ยังนับช่างเป็นคนหน้าไลน์เงียบๆ ทั้งที่คอมเมนต์ในจอเขียนไว้ว่าตัดแล้ว (WorkforceInsight.jsx)
   เพิ่มกลุ่มใหม่ครั้งหน้าแล้วลืมแก้ฝั่ง server = บั๊กเดิมซ้ำ ⇒ ด่านนี้เทียบ "ของจริง" ไม่ใช่เทียบข้อความ */
test('🛡️ onlyShopfloorStaff (server) ต้องตัดชุดเดียวกับ isShopfloorStaff (client) เป๊ะ', async () => {
  const m = await import('../staffKind.js');
  /* query builder ปลอม — จับว่าตัวกรองส่งค่าอะไรไปจริง */
  const spy = () => { const c = {}; c.not = (col, op, val) => { Object.assign(c, { col, op, val }); return c; }; return c; };

  const sf = m.onlyShopfloorStaff(spy());
  assert.equal(sf.col, 'staff_kind');
  assert.equal(sf.op, 'in');
  const cut = sf.val.replace(/[()]/g, '').split(',').map(s => s.trim()).filter(Boolean);
  assert.deepEqual([...cut].sort(), [...m.NON_LINE_VALUES].sort(),
    'onlyShopfloorStaff ต้องตัด NON_LINE_VALUES (ช่าง + สนับสนุน + ค่าเก่า) ไม่ใช่แค่ SUPPORT_VALUES');
  /* ทุกค่าที่ server ตัด client ก็ต้องตอบ false และกลับกัน — ไม่มีคนกลุ่มไหนตกร่องระหว่าง 2 ฝั่ง */
  for (const v of ['shopfloor', 'technician', 'support', 'indirect'])
    assert.equal(m.isShopfloorStaff({ staff_kind: v }), !cut.includes(v), `ค่า ${v}: 2 ฝั่งตอบไม่ตรงกัน`);

  /* ตัวแยกของบอร์ดกำลังคน — ตัดเฉพาะสายสนับสนุน **ช่างต้องผ่าน** */
  const ws = m.withoutSupportStaff(spy());
  const cut2 = ws.val.replace(/[()]/g, '').split(',').map(s => s.trim()).filter(Boolean);
  assert.deepEqual([...cut2].sort(), [...m.SUPPORT_VALUES].sort());
  assert.ok(!cut2.includes('technician'), 'withoutSupportStaff ต้องปล่อยช่างผ่าน (บอร์ดวาดแถวช่างแยก)');
});

/* ── บอร์ดกำลังคนเป็นจอเดียวที่ตั้งใจเห็นช่าง — ห้ามให้จออื่นหยิบ withoutSupportStaff ไปใช้มั่ว ── */
test('🛡️ withoutSupportStaff ใช้ได้เฉพาะ /manpower-board (จอที่วาดแถวช่างแยก)', () => {
  const bad = [];
  const stack = [join(ROOT, 'src')];
  while (stack.length) {
    const dir = stack.pop();
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== '__tests__') stack.push(full); continue; }
      if (!/\.(jsx?|mjs)$/.test(e.name)) continue;
      const rel = full.replace(ROOT, '');
      if (rel === 'src/utils/staffKind.js' || rel === 'src/pages/ManpowerBoard.jsx') continue;
      if (/withoutSupportStaff\s*\(/.test(readFileSync(full, 'utf8'))) bad.push(rel);
    }
  }
  assert.deepEqual(bad, [], '\n\n❌ ' + bad.join(', ') + '\n'
    + '   จอที่นับกำลังคนต้องใช้ onlyShopfloorStaff() — withoutSupportStaff ปล่อยช่างผ่าน\n'
    + '   จะใช้ที่จอใหม่จริงๆ ต้องพิสูจน์ก่อนว่า "ช่างไม่ถูกนับรวมเป็นกำลังคนของไลน์" แล้วแก้ด่านนี้\n');
});
