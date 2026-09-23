/* 🛡️ ด่าน "คิวรีต้องดึงคอลัมน์ที่ helper ใช้ตัดสิน" — org_nodes.parent_id   2026-09-23
 *
 * ── บั๊กที่เคยเกิด (22/09 · แก้ 23/09) ───────────────────────────────────────
 * `orphanDepts()` (src/utils/sectionScope.js) ตัดสิน "แผนกขึ้นตรงฝ่าย" จาก `!d.parent_id`
 * แต่ `/add-user` ดึงมาแค่ `select('code, name, kind')` ⇒ `parent_id` เป็น **undefined ทุกแถว**
 * ⇒ `!undefined` = true ⇒ **ทุกแผนกกลายเป็น "ขึ้นตรงฝ่าย" หมด** — ช่องติ๊กขอบเขตส่วนงาน
 *   ขึ้นป้าย 🏛️ ให้ GOR · LWRBAR · BIG PRESS · HYDROFORM · LINE APRON ASSY ซึ่งอยู่ใต้ส่วนงานผลิต
 *
 * **บั๊กคลาสนี้เงียบสนิท** — ไม่มี error, build/lint/เทสผ่าน, หน้าไม่พัง
 * แค่ "ตัวเลือกบนจอผิดความหมาย" ซึ่งคนกรอกข้อมูลจะเชื่อตามที่เห็น
 *
 * กฎทั่วไปที่ได้จากเคสนี้: **helper ที่ตัดสินใจจากคอลัมน์ไหน ทุกคิวรีที่ป้อนมันต้องดึงคอลัมน์นั้น**
 * (คอลัมน์ที่ไม่ได้ดึง = undefined ไม่ใช่ error — ตรรกะจะเดินผิดทางเงียบๆ)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('../../../', import.meta.url).pathname;

/** helper ที่อ่าน `org_nodes.parent_id` → ไฟล์ไหน import ตัวใดตัวหนึ่ง ต้อง select parent_id */
const NEEDS_PARENT_ID = ['orphanDepts', 'deptOptionsFor', 'deptNodeFor', 'sectionValueForEdit'];

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '__tests__' || e === 'dist' || e.startsWith('.')) continue;
    const full = join(dir, e);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (e.endsWith('.jsx') || e.endsWith('.js')) out.push(full);
  }
  return out;
}

test('🛡️ ไฟล์ที่ใช้ orphanDepts/cascade แผนก ต้อง select org_nodes.parent_id', () => {
  const bad = [];
  for (const file of walk(join(ROOT, 'src'))) {
    const src = readFileSync(file, 'utf8');
    if (!NEEDS_PARENT_ID.some(h => new RegExp(`\\b${h}\\b`).test(src))) continue;
    const rel = relative(ROOT, file);
    // ทุกคิวรี org_nodes ในไฟล์นี้ต้องมี parent_id อยู่ในรายการคอลัมน์
    const re = /from\(\s*'org_nodes'\s*\)\s*\n?\s*\.select\(\s*'([^']*)'/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      if (m[1].includes('parent_id')) continue;
      if (m[1].trim() === '*') continue;                       // select('*') ได้ทุกคอลัมน์อยู่แล้ว
      const line = src.slice(0, m.index).split('\n').length;
      bad.push(`${rel}:${line} — select('${m[1].slice(0, 60)}')`);
    }
  }
  assert.deepEqual(bad, [],
    '\n\n❌ คิวรี org_nodes ไม่ได้ดึง `parent_id` ทั้งที่ไฟล์นี้ใช้ helper ที่ตัดสินจาก parent_id '
    + bad.length + ' จุด\n'
    + '   ทำไมห้าม: คอลัมน์ที่ไม่ได้ดึง = undefined (ไม่ใช่ error) ⇒ `!parent_id` เป็นจริงทุกแถว\n'
    + '             ⇒ ทุกแผนกกลายเป็น "ขึ้นตรงฝ่าย" — เกิดจริง 22/09 ที่ /add-user\n'
    + '   แก้ยังไง: เติม parent_id เข้าไปใน .select(...) ของคิวรีนั้น\n\n'
    + bad.map(b => '   • ' + b).join('\n') + '\n');
});

test('🛡️ orphanDepts ยังตัดสินจาก parent_id จริง (ถ้าเปลี่ยนนิยาม ให้แก้ชื่อ/ด่านนี้ด้วย)', () => {
  const src = readFileSync(join(ROOT, 'src/utils/sectionScope.js'), 'utf8');
  assert.match(src, /orphanDepts\s*=\s*\(deptNodes\s*=\s*\[\]\)\s*=>\s*deptNodes\.filter\(d\s*=>\s*!d\.parent_id\)/);
});
