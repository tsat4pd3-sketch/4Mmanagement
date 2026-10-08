/* 🧭 ด่าน "แกนสังกัดต้องเก็บ id ไม่ใช่แค่ข้อความ"            2026-09-23
 *
 * ── ทำไมต้องมีด่าน (docs/ORG-AXES-DECISION.md) ────────────────────────────
 * ผังองค์กรจริง (`org_nodes` 51 โหนด · id + parent_id) มีมานานแล้วและถูกต้อง
 * **แต่ไม่มีตารางไหนชี้มาเลย** — ทุกที่เก็บ *ข้อความ* แล้วจับคู่ด้วยชื่อ กระจาย 11 คอลัมน์
 * ผลที่วัดได้ 23/09:
 *   · แผนก `ทั่วไป` มี 2 อัน (ใต้ PD2 และ PD4) ⇒ 15 คนจับคู่ด้วยชื่อไม่ได้เด็ดขาด
 *   · `ฝ่ายผลิต` 28 คน + สะกดผิด 2 = 30 คนที่ระบบไม่รู้ว่าอยู่แผนกไหน
 *   · ย้ายคน 1 คน = ต้องแก้ข้อความให้ตรงกันเองหลายคอลัมน์ · แก้ไม่ครบ = สิทธิ์/แจ้งเตือนเพี้ยนเงียบ
 *
 * 🔴 กฎ: **จอไหนที่บันทึก section/department ของ `employees` ต้องเขียน `org_node_id` ด้วยเสมอ**
 *    ผ่าน `orgNodeIdFor()` (`src/utils/sectionScope.js`) — ห้ามประกอบ id เองในหน้า
 *    (คอลัมน์ข้อความยังเขียนเหมือนเดิมในฐานะ "สำเนาไว้โชว์" — หน้าเก่าไม่กระทบ)
 *
 * ถ้าด่านนี้ตก แปลว่ามีจอใหม่ที่เขียนสังกัดแบบข้อความล้วน ⇒ คนที่บันทึกผ่านจอนั้นจะ
 * **หลุดจากทุกตัวกรองที่เดินด้วย id** โดยไม่มีสัญญาณอะไรเลย
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('../../../', import.meta.url).pathname;

/* ── หา "ก้อน payload ที่เขียนลง employees" ให้แม่น ─────────────────────────
   เคยเขียนหยาบกว่านี้ 2 รอบแล้วจับผิดตัวทั้ง 2 รอบ (เขียนไว้กันคนถัดไปทำซ้ำ):
     รอบ 1 — ดู `from('employees')` + คีย์ section ที่ไหนก็ได้ในไฟล์
              ⇒ จับ `src/App.jsx` ที่แค่ **อ่าน** team/line_id/section มาเติม UserContext
     รอบ 2 — เพิ่มเงื่อนไข "ต้องมีคำสั่งเขียน" แต่ยังดูคีย์ทั้งไฟล์
              ⇒ จับ `src/pages/LineSetup.jsx` ที่เขียนแค่ `{ line_id: null }` (ปลดคนออกจากไลน์ที่ลบ)
                 แต่มีคำว่า `section:` อยู่คนละเรื่องในไฟล์เดียวกัน
   ⇒ ต้องอ่าน **อาร์กิวเมนต์ของ .insert/.update/.upsert ก้อนนั้นจริงๆ**
      และรองรับทรง `const row = { ... }` ที่ payload อยู่ *ก่อน* `.from()` ด้วย */

const WRITE_CALL = /from\(\s*'employees'\s*\)[\s\S]{0,300}?\.(?:insert|update|upsert)\(/g;
const HAS_ORG_TEXT_KEY = /\b(?:department|section)\s*:/;

/** ข้อความในวงเล็บของ call ที่เริ่มที่ `from` (นับวงเล็บให้สมดุล) */
function argText(src, from) {
  let depth = 0;
  for (let i = from; i < src.length && i < from + 4000; i++) {
    const c = src[i];
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return src.slice(from + 1, i); }
  }
  return src.slice(from + 1, from + 800);
}

/** payload ของการเขียนทุกก้อนในไฟล์ — คลี่ `const row = {...}` ให้ด้วยเมื่อส่งเป็นชื่อตัวแปร */
function employeeWritePayloads(src) {
  const out = [];
  for (const m of src.matchAll(WRITE_CALL)) {
    const open = m.index + m[0].length - 1;          // ตำแหน่ง '(' ของ insert/update/upsert
    const arg = argText(src, open);
    const ident = arg.trim().match(/^([A-Za-z_$][\w$]*)\s*[,)]?$/);
    if (ident) {
      // ส่งเป็นชื่อตัวแปร → ไปอ่านที่ประกาศ (`const row = { ... }`) แทน
      const decl = new RegExp(`(?:const|let|var)\\s+${ident[1]}\\s*=\\s*\\{`).exec(src);
      out.push(decl ? src.slice(decl.index, decl.index + 1200) : arg);
    } else out.push(arg);
  }
  return out;
}

/* ยกเว้นพร้อมเหตุผล — ห้ามยกเว้นลอยๆ */
const ALLOW = {
  /* (ว่าง — ทั้ง 3 จอที่เขียนสังกัดพนักงานต่อสายครบแล้ว 23/09:
      /operator แก้ไข · /add-user เพิ่มคนจากหน้าสร้างบัญชี · /register ลงทะเบียนพนักงาน)
     เพิ่มรายการที่นี่ได้ แต่ **ต้องเขียนเหตุผลว่าทำไมจอนั้นไม่ต้องผูกผัง** ห้ามยกเว้นลอยๆ */
};

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (['node_modules', '__tests__', 'dist'].includes(e) || e.startsWith('.')) continue;
    const full = join(dir, e);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.jsx?$/.test(e)) out.push(full);
  }
  return out;
}

test('🛡️ จอที่บันทึกสังกัดพนักงาน ต้องเขียน org_node_id ผ่าน orgNodeIdFor()', () => {
  const bad = [];
  for (const file of walk(join(ROOT, 'src'))) {
    const rel = relative(ROOT, file);
    const src = readFileSync(file, 'utf8');
    if (!employeeWritePayloads(src).some(t => HAS_ORG_TEXT_KEY.test(t))) continue;
    if (src.includes('orgNodeIdFor(')) continue;
    if (ALLOW[rel]) continue;
    bad.push(rel);
  }
  assert.deepEqual(bad, [],
    '\n\n❌ จอที่เขียน section/department ของ employees โดยไม่เขียน org_node_id ' + bad.length + ' จุด\n'
    + '   ทำไมห้าม: ชื่อแผนกซ้ำกันได้จริง (`ทั่วไป` ใต้ PD2 และ PD4) ⇒ ข้อความตัวเดียวชี้ได้ 2 หน่วย\n'
    + '             คนที่บันทึกผ่านจอนี้จะหลุดจากทุกตัวกรองที่เดินด้วย id **เงียบๆ**\n'
    + '   แก้ยังไง: เพิ่ม org_node_id: orgNodeIdFor(section, department, sectionNodes, deptNodes)\n'
    + '             + org_node_src: ORG_SRC_MANUAL  (ทั้งคู่จาก src/utils/sectionScope.js)\n\n'
    + bad.map(b => '   • ' + b).join('\n') + '\n');
});

test('🛡️ orgNodeIdFor เลือก "ละเอียดก่อนหยาบ" และไม่เดาเมื่อไม่รู้', async () => {
  const { orgNodeIdFor, ORPHAN_SECTION } = await import('../sectionScope.js');
  const sections = [{ id: 'S2', name: 'PD2' }, { id: 'S4', name: 'PD4' }];
  /* เคสจริงที่เป็นต้นเหตุทั้งหมด: แผนกชื่อซ้ำกัน 2 อัน ต่างกันแค่ฝ่ายแม่ */
  const depts = [
    { id: 'D2', name: 'ทั่วไป', code: 'PD2-GEN', parent_id: 'S2' },
    { id: 'D4', name: 'ทั่วไป', code: 'PD4-GEN', parent_id: 'S4' },
    { id: 'DX', name: 'MTN', parent_id: null },
  ];
  assert.equal(orgNodeIdFor('PD2', 'PD2-GEN', sections, depts), 'D2', 'แผนกใต้ PD2');
  assert.equal(orgNodeIdFor('PD4', 'PD4-GEN', sections, depts), 'D4', 'แผนกชื่อเดียวกันใต้ PD4 ต้องได้คนละ id');
  assert.equal(orgNodeIdFor('PD2', '', sections, depts), 'S2', 'ไม่เลือกแผนก → ได้ระดับฝ่าย (หยาบแต่ไม่ผิด)');
  assert.equal(orgNodeIdFor(ORPHAN_SECTION, 'MTN', sections, depts), 'DX', 'แผนกขึ้นตรงฝ่าย');
  assert.equal(orgNodeIdFor(ORPHAN_SECTION, '', sections, depts), null, 'ไม่รู้เลย = null ห้ามเดา');
  assert.equal(orgNodeIdFor('ไม่มีในผัง', 'ไม่มีในผัง', sections, depts), null, 'ค่านอกผัง = null');
});
