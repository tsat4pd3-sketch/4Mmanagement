/* ═══════════════════════════════════════════════════════════════════════════
   🛡️ ด่านกัน "บั๊กเก่ากลับมา" — ไล่อ่านไฟล์ทั้งรีโปแล้วบังคับกฎที่เคยพังจริง   2026-09-16

   คำสั่ง user: *"ปัญหาต่างๆ ที่เคยแก้เคยเกิด ไม่ควรเกิดซ้ำ"*

   ทำไมเป็น "เทส" ไม่ใช่ script แยก: `npm test` อยู่ในด่าน `npm run build` อยู่แล้ว และ
   `scripts/run-tests.mjs` เก็บไฟล์ใน `__tests__/` เองอัตโนมัติ ⇒ ไม่มีด่านใหม่ให้ลืมต่อ
   (pattern เดียวกับ `storageUpload.test.mjs` ที่สแกนทั้งรีโปอยู่แล้ว)

   ── กติกาของไฟล์นี้ (สำคัญกว่าตัวกฎ) ──────────────────────────────────────
   1. **ใส่เฉพาะกฎที่เคยพังจริงและตรวจด้วย grep ได้แม่น** — กฎที่ false positive บ่อยจะทำให้คน
      อยากปิดด่าน (บทเรียนเดียวกับ `eslint.critical.config.js`: ห้ามใส่กฎ style จุกจิก)
   2. **ทุกกฎต้องเขียน `why` = บั๊กที่เคยเกิด + `fix` = ทำยังไงแทน** — ข้อความนี้คือสิ่งที่คนเห็นตอน build ล่ม
   3. **คอมเมนต์ไม่นับ** — เอกสาร/คำเตือนในโค้ดพูดถึง pattern ต้องห้ามได้ (ตัวสแกนตัด comment ออกก่อน)
   4. **ยกเว้นได้ แต่ต้องมีเหตุผลเขียนกำกับใน `allow`** ห้ามยกเว้นลอยๆ
   5. เจอบั๊กคลาสใหม่ที่ "คนถัดไปน่าจะพลาดซ้ำ" → เพิ่มกฎที่นี่ **ในคอมมิทเดียวกับที่แก้บั๊ก**
   ═══════════════════════════════════════════════════════════════════════════ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { BACKUP_RE } from '../schemaAudit.js';   // ตัวตัดสิน "ชื่อตารางสำรอง" จุดเดียวทั้งระบบ
import { REALTIME_TABLES } from '../realtimeTables.js';   // ทะเบียนตารางที่ subscribe realtime
import { join, relative } from 'node:path';

const ROOT = new URL('../../../', import.meta.url).pathname;

function walk(dir, exts, out = []) {
  // `scan` ระบุ "ไฟล์เดี่ยว" ได้ด้วย (กฎบางข้อคุมเฉพาะไฟล์ของชั้นนั้นๆ ไม่ใช่ทั้งโฟลเดอร์)
  if (!statSync(dir).isDirectory()) { out.push(dir); return out; }
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '__tests__' || e === 'dist' || e.startsWith('.')) continue;
    const full = join(dir, e);
    if (statSync(full).isDirectory()) walk(full, exts, out);
    else if (exts.some(x => e.endsWith(x))) out.push(full);
  }
  return out;
}

/** ตัดคอมเมนต์ออกก่อนตรวจ — ไม่งั้นคำเตือนที่เขียนไว้ในโค้ดจะกลายเป็น "ผู้ต้องหา" เสียเอง
 *  (แทนที่ด้วยช่องว่างความยาวเท่าเดิม เพื่อให้เลขบรรทัด/คอลัมน์ยังตรง) */
function stripComments(src) {
  let out = '', i = 0, n = src.length;
  let inLine = false, inBlock = false, inStr = null;
  while (i < n) {
    const c = src[i], c2 = src[i + 1];
    if (inLine) { if (c === '\n') { inLine = false; out += c; } else out += ' '; i++; continue; }
    if (inBlock) { if (c === '*' && c2 === '/') { inBlock = false; out += '  '; i += 2; } else { out += c === '\n' ? c : ' '; i++; } continue; }
    if (inStr) { out += c; if (c === '\\') { out += c2 ?? ''; i += 2; continue; } if (c === inStr) inStr = null; i++; continue; }
    if (c === '/' && c2 === '/') { inLine = true; out += '  '; i += 2; continue; }
    if (c === '/' && c2 === '*') { inBlock = true; out += '  '; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; out += c; i++; continue; }
    out += c; i++;
  }
  return out;
}

/* ── ทะเบียนกฎ ─────────────────────────────────────────────────────────────
   scan: โฟลเดอร์ที่ตรวจ · ext: นามสกุล · re: regex (global) · allow: ไฟล์ที่ยกเว้น + เหตุผล */
const RULES = [
  {
    id: 'wf-tables-write-via-rpc',
    scan: ['src'], ext: ['.jsx', '.js'],
    /* จับการเขียนตาราง e-Workflow ตรงจาก client: from('wf_…').insert/update/upsert/delete */
    re: /from\(\s*['"`]wf_(defs|versions|instances|tasks|actions)['"`]\s*\)\s*\.\s*(insert|update|upsert|delete)\b/g,
    why: '🧩 e-Workflow (13/11): ตาราง wf_* ไม่มี policy เขียนเลย (ตั้งใจ) — การเปลี่ยนขั้น/สถานะต้องผ่าน RPC ที่ตรวจผู้กด + '
       + 'compare-and-swap (step_rev) + ขอบเขตส่วนงานฝั่ง DB · เขียนตรง = ได้ 42501 หรือถ้ามีคนไปเปิด policy = ข้ามขั้นได้',
    fix: 'เรียก supabase.rpc(\'wf_save_draft\' | \'wf_request_publish\' | \'wf_review_publish\' | \'wf_start\' | \'wf_act\' | \'wf_resubmit\' | \'wf_cancel\') — 📄 docs/modules/e-workflow.md',
    allow: {},
  },
  {
    id: 'uom-write-via-normuom',
    scan: ['src'], ext: ['.jsx', '.js'],
    /* จับ default หน่วยแบบเดิม: `uom: x || 'EA'` · `unit: x || 'Pcs'` · `uom: 'pcs'` */
    re: /\b(uom|unit)\s*:\s*(?:[^,\n}]*\|\|\s*)?['"](EA|ea|pcs|Pcs|PCS)['"]/g,
    why: '📏 user ตัดสิน 05/11: **EA = pcs = PC (หน่วยเดียวกัน) · หน่วยหลัก = PC** — ฐานเคยมี PC/EA/pcs ปนกัน '
       + 'เพราะแต่ละทางเขียน default คนละแบบ (ฟอร์ม/import = EA · ลงทะเบียนจาก BOM = pcs · ใบเบิก = Pcs) '
       + '⇒ แก้ข้อมูล 392 แถวแล้ว (archive.uom_fix_20261105) · default แบบเดิมโผล่กลับ = ปนใหม่เงียบๆ',
    fix: "ใช้ `normUom(raw, uomIdx) || DEFAULT_UOM` จาก src/utils/uom.js (ทะเบียน DR `uom_units` · useUomUnitsState)",
    allow: {},
  },
  {
    id: 'myqueue-next-step-not-current-step',
    scan: ['src/utils/myQueue.js'], ext: ['.js'],
    /* จับการอ่านเลขขั้นตรงจาก current_step ในตัวตัดสิน "ใบนี้รอใคร" */
    re: /\.current_step\b/g,
    why: '`mtn_orders.current_step` = ขั้นที่ **ทำเสร็จแล้ว** ไม่ใช่ขั้นที่รอ — คิวงานเคยอ่านตรงๆ แล้วช้าไป 1 ขั้นทุกใบ '
       + '(workflow audit 05/10: ใบรอ QA 204 ใบไปขึ้นเป็น "ตรวจรับงาน" ที่ผู้แจ้งซึ่งเซ็นไปแล้ว · QA ไม่เห็นในคิว · '
       + 'ใบรอจ่ายงาน 32 ใบไม่โผล่ที่ไหนเลย)',
    fix: 'ใช้ `nextStepOf(order)` จาก src/utils/mtnStepPerm.js (ตัดสินจาก status · ตัวเดียวกับปุ่มขั้นถัดไปใน MtnRepair)',
    allow: {},
  },
  {
    id: 'mo-wait-stage-via-mowaitmeta',
    scan: ['src/utils/myQueue.js', 'src/pages/MtnRepair.jsx', 'src/utils/mtnStale.js'], ext: ['.js', '.jsx'],
    /* จับการถาม "ใบนี้รอขั้นไหน" ด้วย nextStepOf() ตรงๆ ในตัวจัดกอง/ตัวกรอง */
    re: /(const|let)\s+\w*[Ww]ait\w*\s*=[^\n]*nextStepOf\(/g,
    why: '🔒 **ด่านอนุมัติก่อนเริ่มงานไม่มีเลขขั้น** — ใบ improve/build ที่ ผจก.ฝ่ายที่แจ้งยังไม่เซ็น '
       + 'ช่างกดรับงานไม่ได้ แต่ `nextStepOf()` คืน 2 ⇒ ตัวกรอง "รอขั้นไหน" + คิวงานของฉัน + กระดิ่ง '
       + 'เหมาไปกองเดียวกับ "รอช่างรับงาน" ⇒ **ไม่มีจอไหนบอกว่ารอใคร** คนต้องไปตามกันใน LINE '
       + '(13/10/2026 · user: "มีงานรอเราอนุมัติ MO แต่เราหาไม่เจอ")',
    fix: 'ใช้ `moWaitMeta(order)` จาก src/utils/mtnStepPerm.js — คืน { stage, step, meta } ที่ด่านอนุมัติ '
       + "ชนะเลขขั้น (stage = 'approve_first' · step = null)",
    allow: {},
  },
  {
    id: 'jigs-has-no-department-column',
    scan: ['src'], ext: ['.jsx', '.js'],
    /* select จากตาราง jigs (DR) ที่ขอคอลัมน์ department — ตารางนี้ไม่มีคอลัมน์นั้น */
    re: /from\(['"]jigs['"]\)\s*\.select\(['"`][^'"`]*\bdepartment\b/g,
    why: 'ตาราง DR `jigs` **ไม่มีคอลัมน์ department** (วัด 05/10) — /scan เคย select ไปด้วย ⇒ 42703 ทั้งคิวรี '
       + '⇒ จิ๊กไม่เคยถูกพบ + ปุ่ม "ตรวจ PM เครื่องนี้" ไม่เคยโผล่ (QC 05/10)',
    fix: 'แผนกของใบตรวจ PM อยู่ที่ `checklists.department` (module=mtn, equipment_id=jig.id) — ดู ScanLanding.jsx',

    allow: {},
  },
  {
    id: 'dr-products-has-no-part-name',
    scan: ['src'], ext: ['.jsx', '.js'],
    /* select จาก dr_products (DR) ที่ขอคอลัมน์ part_name — ชื่อสินค้าของตารางนี้คือ `name` */
    re: /from\(['"]dr_products['"]\)\s*\.select\(['"`][^'"`]*\bpart_name\b/g,
    why: 'ตาราง DR `dr_products` **ไม่มีคอลัมน์ part_name** (ชื่อ = `name` · `part_name` อยู่ที่ prod_orders/qa_parts) — '
       + '/scan เคย select ไป ⇒ 42703 ทุกครั้ง ⇒ สแกนบาร์โค้ด MAT ไม่เคยเจอสินค้า (20/10)',
    fix: "ใช้ `select('mat_no, p_no, name')` แล้วอ่าน `.name` — ดู ScanLanding.jsx",
    allow: {},
  },
  {
    id: 'pm-checkpoints-no-delete-all',
    scan: ['src'], ext: ['.jsx', '.js'],
    /* จับการลบจุดตรวจ/รูปทั้งชุดด้วยคีย์แม่ (checklist_id / jig_id) — pattern "ลบหมดแล้ว insert ใหม่" */
    re: /from\(['"](jig_checkpoints|jig_images)['"]\)\s*\.delete\(\)\s*\.eq\(['"](checklist_id|jig_id)['"]/g,
    why: '`inspection_results.checkpoint_id` เป็น ON DELETE CASCADE ⇒ กดบันทึกรายการตรวจ PM 1 ครั้ง (ลบทั้งชุดแล้ว insert ใหม่) '
       + '= **ประวัติผลตรวจของใบนั้นหายถาวร** + `fixture_points.checkpoint_id/image_id` หลุดเป็น null ทุกครั้ง '
       + '(QC 05/10: fixture_points 18 จุด เหลือผูก checkpoint 0 · image 1)',
    fix: 'sync แบบแก้ตาม id: update แถวที่มี id · insert แถวใหม่ · delete เฉพาะ id ที่ถูกถอดจริง '
       + '(มีประวัติผลตรวจต้องยืนยันก่อน) — ดู handleSave ใน src/pages/PMSetup.jsx',
    allow: { 'src/lib/pmChecklists.js': 'คัดลอกทับแผนกอื่น (ผู้ใช้กด "ทับ" เอง) — เช็คก่อนว่าปลายทางไม่มีประวัติผลตรวจ มี = โยน error ไม่ลบ' },
  },
  {
    id: 'order-plan-via-helper',
    scan: ['src'], ext: ['.jsx', '.js'],
    /* จับการรวม "เป้า" ของใบผลิตด้วย qty_target ?? qty ดิบ (ไม่สนสถานะ) */
    re: /target\s*\+=\s*\(?\s*\w+\.qty_target\s*\?\?\s*\w+\.qty\b/g,
    why: 'ใบยกยอด (`imported`) ถือเป้าเต็มไว้ ขณะที่กะถัดไปออกใบใหม่ด้วยยอดที่เหลือ ⇒ Σ เป้าดิบนับ 2 รอบ '
       + '(35 + 30 = 65 ทั้งที่งานจริง 35) + นับใบยกเลิกด้วย · QC 05/10: จอเดโม Obeya/FactoryMap/GroupOverview/'
       + 'DeptDashboard ขึ้น "ผลิตได้ 71% ของแผน" ทั้งที่จบครบ',
    fix: 'ใช้ `orderPlanQty(o)` จาก src/utils/oee.js §6.1 (คู่กับ orderProducedQty)',
    allow: {},
  },
  {
    id: 'die-set-kinds-from-registry',
    scan: ['src'], ext: ['.jsx', '.js'],
    /* จับการวาดตัวเลือกรูปแบบชุดแม่พิมพ์จากค่าสำรองในโค้ด แทนทะเบียน die_set_kinds */
    re: /DIE_SET_KINDS\.(map|filter|find)\(/g,
    why: 'รูปแบบชุดแม่พิมพ์เคย hardcode 4 ค่า (+ check constraint) — ทีมแม่พิมพ์เพิ่ม HYDROFORM/BEND เองไม่ได้ '
       + 'และศัพท์ทางการหน้างานไม่เข้าใจ (user 2026-10-05) ⇒ ย้ายเป็นทะเบียน DR `die_set_kinds` '
       + 'ถ้ามีจอวาดจาก DIE_SET_KINDS ตรงๆ อีก ชนิดที่ทีมเพิ่มเองจะไม่โผล่/ป้ายเป็นชื่อเก่า',
    fix: 'ใช้ `useDieSetKinds()` (src/utils/useDieSetKinds.js) + `dieSetKindOptions()`/`dieSetKindLabel(v, kinds)` '
       + '— DIE_SET_KINDS เหลือไว้เป็นค่าสำรองตอนยังไม่ apply migration เท่านั้น',
    allow: { 'src/utils/useDieSetKinds.js': 'ตัวโหลดทะเบียน — ใช้ค่าสำรองเฉพาะตอนตารางยังไม่มี/ก่อนโหลดเสร็จ' },
  },
  {
    id: 'timeline-break-intervals-via-helper',
    scan: ['src'], ext: ['.jsx', '.js'],
    /* จับสูตรวางช่วงพักบนกริดครึ่งวันที่ก๊อปเอง — กรองกะด้วย `p.shift === 'day' && half.key === 'am'`
       (การหา "ชื่อพัก" จาก start_time เพื่อทำ tooltip ไม่โดน — ไม่ได้สร้างช่วงเวลา) */
    re: /\.shift\s*===\s*'day'\s*&&\s*\w+\.key\s*===\s*'am'/g,
    why: 'บอร์ดไทม์ไลน์ 3 จอ (Dashboard · /management · Heijunka) เคยก๊อปสูตรช่วงพักเอง ไม่กรอง ot_scope/process '
       + '⇒ พัก 5ส.(ไม่ทำโอ) 17:10 กับพักโอ 17:30/19:40 ขึ้นพร้อมกัน คิวการ์ดถูกดันเกินจริง (QC 05/10)',
    fix: 'ใช้ `halfDayBreakIntervals({ policies, half })` จาก src/utils/oee.js (ผ่าน breakIntervalsIn ที่เดียว)',
    allow: {},
  },
  {
    id: 'raw-withdrawal-status-set',
    scan: ['src'], ext: ['.jsx', '.js'],
    /* raw_withdrawal_requests มีสถานะ pending / issued / cancelled เท่านั้น — "ไม่ใช่ done" = นับใบยกเลิกเป็นค้าง */
    re: /from\(\s*'raw_withdrawal_requests'\s*\)[^;]*?\.neq\(\s*'status'\s*,\s*'(?:done|issued)'\s*\)/g,
    why: 'Flow Tower นับใบเบิกค้างด้วย `.neq(status, done)` ทั้งที่ตารางไม่มีสถานะ done ⇒ ใบ cancelled 700 ใบถูกนับเป็นค้าง '
       + '(จอขึ้น 1,472 แทน 482 · QC 05/10) · คิวสโตร์เดิมโหลดล่าสุด 400 ใบไม่กรองสถานะ ใบรอจ่ายเก่า 172 ใบหายจากจอ',
    fix: 'งานค้าง = `.eq(\'status\', \'pending\')` (+ fetchAllPages ถ้าเป็นลิสต์) · ยอดรวม = `.neq(\'status\', \'cancelled\')`',
    allow: {},
  },
  {
    id: 'master-cache-swallow',
    scan: ['src'], ext: ['.jsx', '.js'],
    /* จับ loader ของ cachedMaster ที่กลืน error เป็นลิสต์ว่าง — `.data || []` บนบรรทัดเดียวกับ cachedMaster( */
    /* 05/10 ขยายเป็น 2 บรรทัด — loader ที่ขึ้นบรรทัดใหม่หลัง `async () =>` หลบด่านเดิมได้ทั้งที่กลืน error เหมือนกัน
       (เจอจริง: FactoryMap dr_products:ct / kanban_standards:ct / break_policies:active / machines:* · LineOeeBoard) */
    /* 13/10 ขยายอีกครั้ง — loader ที่ยาวหลายบรรทัด (อ่าน 2 ตารางแล้ว return object) หลบ 2 บรรทัดเดิมได้
       เจอจริง: `usePartOptions` → `return { sets: a.data || [], qaParts: b.data || [] }` (บรรทัดที่ 6 ของ loader)
       ⇒ ทะเบียนพาร์ททั้งชุดกลายเป็นว่างแล้วถูก cache 4 ชม. **และ `cachedMaster` ไม่เห็น error
          ⇒ toast กลางใน main.jsx ไม่ขึ้นด้วย = เงียบสนิท** (ช่องเลือกพาร์ทว่าง = "ไม่มีพาร์ทนี้")
       หน้าต่าง 500 ตัวอักษร และ **หยุดเมื่อเจอ `throw` / `mrows` / ปลาย loader (`})`)**
       ⇒ loader ที่เช็ค error ไว้ก่อนแล้ว (useProducts/useMachines/usePeople/partImages) ไม่ถูกจับผิด */
    re: /cachedMaster\((?:(?!\}\s*\)|throw|mrows)[\s\S]){0,500}?\.data\s*(\|\||\?\?)/g,
    why: 'supabase-js **ไม่ throw** ⇒ `(await …).data || []` ทำให้คิวรีที่ล้ม (เน็ตสะดุด/timeout/RLS) '
       + 'กลายเป็น "โหลดสำเร็จ ได้ 0 แถว" แล้ว `cachedMaster` **เขียนลิสต์ว่างลง localStorage ทับของดี '
       + 'ค้างในเครื่องนั้นอีก 4 ชม.** โดยไม่มีข้อความบนจอเลย — เครื่องอื่นที่โหลดติดยังเห็นครบ '
       + '⇒ "ผมไม่เห็น แต่ User คนอื่นเห็น" · เกิดจริง 30/09 (คุณนพดล · /daily-report · งาน 068 '
       + 'หายจากลิสต์ทั้งที่ข้อมูลใน DB ปกติทุกอย่าง) แล้วหาต้นเหตุไม่เจอเพราะไม่มีร่องรอยอะไรเลย',
    fix: 'ห่อด้วย `mrows(await …)` จาก `src/utils/masterCache.js` — ตาราง/คอลัมน์ยังไม่มี (42P01/42703) '
       + 'ยังคืน [] เหมือนเดิม · error อื่นโยน ⇒ cache ไม่ถูกทับ + ขึ้น toast ให้คนเห็น',
    allow: {},   // ตัวอย่างใน masterCache.js อยู่ในคอมเมนต์ — ตัวสแกนตัดคอมเมนต์ก่อนตรวจอยู่แล้ว
  },
  {
    id: 'daily-check-unknown-not-false',
    scan: ['src'], ext: ['.jsx', '.js'],
    /* จับการบีบ "ไม่รู้ว่าวันนั้นผลิตไหม" ให้กลายเป็น "ไม่ได้ผลิต" */
    re: /ranOn\([^)]*\)\s*(\?\?|\|\|)\s*false/g,
    why: 'ตารางตรวจรายวันต้องแยก 3 อย่าง: **ไม่ได้ตรวจ / ไม่ได้ผลิต / ต้องตรวจวันนั้น** (คำสั่ง user 13/10) '
       + '· `ranOn()` คืน `null` = "อ่านข้อมูลการเปิดกะไม่สำเร็จ" ⇒ บีบเป็น `false` = จอสรุปว่า '
       + '"ไม่ได้ผลิต ไม่ต้องตรวจ" ⇒ **วันที่ขาดตรวจทั้งเดือนหายเกลี้ยงเพราะคิวรีล้มครั้งเดียว** '
       + '— เป็นการโกหกที่อันตรายกว่าไม่เช็ค เพราะจอดูสะอาดขึ้นตอนระบบพัง',
    fix: 'ส่ง `null` ต่อให้ `checkDayState()` (`src/utils/dailyCheckDay.js`) แล้วมันจะคืน `unknown` '
       + '· จอวาด ❔ และเขียนจำนวนวันที่ไม่รู้ด้วย `checkDaysNote()` (ตัวหารของ % ไม่นับ unknown)',
    allow: {},
  },
  {
    id: 'unit-kind-via-util',
    scan: ['src'], ext: ['.jsx', '.js'],
    /* ตัดสิน "เป็นไลน์ผลิตไหม" ต้องผ่าน utils/unitKind.js — เทียบสตริงเองในหน้าคือจุดที่ drift */
    re: /unit_kind\s*[=!]==\s*['"]/g,
    why: 'ชนิดหน่วย (`production`/`support`) ตัดสินที่ `src/utils/unitKind.js` ที่เดียว '
       + '— เทียบสตริงเองในหน้า = แต่ละจอตีความไม่เหมือนกัน และ**ลืมกฎ fail-open** '
       + '(ค่าว่าง/ไม่รู้จัก = ไลน์ผลิต) ⇒ `l.unit_kind === "production"` จะทิ้งไลน์ผลิตที่ยังไม่มีค่า '
       + 'ทั้งตารางออกจากจอเงียบๆ ซึ่งเป็นทิศที่อันตรายที่สุด',
    fix: 'ใช้ `isProductionUnit(line)` / `isSupportUnit(line)` / `productionUnits(lines)` '
       + '· ช่องเลือกไลน์ส่ง `includeSupport` แทนการกรองเอง',
    allow: { 'src/utils/unitKind.js': true },
  },
  {
    id: 'am-open-lines-family-aware',
    scan: ['src/lib/dailyAmBoard.js'], ext: ['.js'],
    /* "ไลน์ไหนเดินอยู่" ต้องผ่าน openFamilyLines() — ประกอบ Set เองที่นี่ = กลับไปเทียบชื่อตรงตัว */
    re: /openSessionLines:\s*new Set\(/g,
    why: 'ไลน์แม่หลายตัวไม่เคยเปิดกะในชื่อตัวเอง (วัด 45 วัน: GOR · LWR BAR · HYDROFORM '
       + '· LINE APRON ASSY = 0 ครั้ง · ลูกเดินทุกวันแทน) แต่ถือ **แผน LPA รวม 30 แผน** '
       + '⇒ ชุด "ไลน์ที่เดินอยู่" ที่เทียบชื่อตรงตัวจะไม่มีชื่อไลน์แม่ ⇒ `pokayokeByLine`/`lpaByLine` '
       + '(`utils/prodRoutine.js`) ใช้ชุดนี้เป็นประตู แล้ว**ข้ามงานตรวจของไลน์แม่ทั้งก้อนเงียบๆ** '
       + '· จอ AM ก็เขียน "ยังไม่เปิดกะ" ให้ไลน์ที่ลูกเดินอยู่',
    fix: 'คืน `openSessionLines: openFamilyLines(lines, openRaw)` (`src/lib/pmDailyStatus.js` · มีเทส) '
       + '— family = ตัวเอง + แม่/ปู่ + ลูก/หลาน **ไม่รวมพี่น้อง**',
    allow: {},
  },
  {
    id: 'check-day-mark-not-answer',
    scan: ['src/utils/dailyCheckDay.js'], ext: ['.js'],
    /* สัญลักษณ์ "สถานะวัน" ห้ามยืมตัวอักษรจากพจนานุกรม "คำตอบของการตรวจ" */
    re: /mark:\s*'(?:Y|N|T|NA|N\/A|✓|✗|×|x|X|–|—|-)'/g,
    why: 'ใบตรวจรายวัน (LPA FM-QMR-008) ตอบด้วย `Y`/`N`/`T`/`N/A` ซึ่งทุกตัวหมายถึง '
       + '**"ไปตรวจแล้ว เจอผลอย่างนี้"** ⇒ ถ้า `CHECK_DAY_META.mark` ใช้ตัวเดียวกัน (หรือ `✗`/`–` '
       + 'ที่ตาอ่านเป็น `N`/`N/A`) คนอ่านจะนึกว่า **"ตรวจแล้วเจอผิดปกติ" ทั้งที่ยังไม่มีใครไปตรวจ** '
       + '(คำสั่ง user 13/10 — ชนทั้งตัวอักษรและสี: ✗ แดง = N แดง · – เทา = N/A เทา · ? เหลือง = T เหลือง)',
    fix: 'ใช้คำย่อที่ไม่อยู่ในพจนานุกรมคำตอบ — `ขาด` (ขาดตรวจ) · `NP` (Non-Production) · `?` (ไม่รู้) '
       + '· `·` (ไม่มีแผน) · และกันอ่านสลับด้วย `tint` ทาทั้งคอลัมน์ + กรอบ chip (คำตอบไม่มีทั้งสองอย่าง)',
    allow: {},
  },
  {
    id: 'shift-sched-no-raw-byline',
    scan: ['src'], ext: ['.jsx', '.js'],
    /* จับการอ่าน `maps.byLine[...]` ตรงๆ นอก `utils/shiftAssign.js`
       🔴 ยกเว้น index ที่เป็น "ตัวเลขล้วน" (`byLine[0]`) = การอ่านสมาชิก array ไม่ใช่การ lookup ด้วย line id
          — ชื่อ `byLine` ถูกใช้โดยโมดูลอื่นที่ไม่เกี่ยวกับตารางกะด้วย (เช่น `LineStock.jsx` เก็บยอดสต็อก
          รายไลน์เป็น array แล้วอ่าน `p.byLine[0].line_name`) · เจอจริง 13/10 ตอน merge 2 session
          ที่แตะคนละไฟล์ · การ lookup ด้วย id (`byLine[lineId]` / `byLine[emp.line_id]`) ยังโดนจับเหมือนเดิม */
    re: /\.byLine\s*\[(?!\s*\d+\s*\])/g,
    why: 'ตารางกะเก็บแถว "ต่อไลน์" แต่ **ไลน์ลูกตกทอดกะจากไลน์แม่** (จอตั้งค่า `ShiftOrganize.effTeam` ทำแบบนี้มาตลอด) '
       + '⇒ อ่าน `byLine[line_id]` ตรงตัว = ไลน์ลูกที่ยังไม่มีแถวของตัวเองได้ `null` ทั้งที่จอบอกว่าตั้งกะแล้ว '
       + '· เกิดจริง 13/10 (PD2): `Line D2 - LWR BAR` + `Line D3 - STAMPED` สร้าง 09/10 หลังตารางถูกเติมล่วงหน้า '
       + 'ถึง 03/01/2027 ⇒ ไม่มีแถวเลยสักแถว ⇒ **พนักงาน 18 คนไม่มีกะ** หายจากใบเช็คชื่อ/กำลังคนไลน์เป็น 0',
    fix: 'ใช้ `lineScheduleTeam(lineId, maps)` (ถามเป็นไลน์) หรือ `scheduleTeamFor(emp, maps)` (ถามเป็นคน) '
       + 'จาก `src/utils/shiftAssign.js` — 2 ตัวนี้ไล่ขึ้นไลน์แม่ให้แล้ว',
    allow: { 'src/utils/shiftAssign.js': true },
  },
  {
    id: 'shift-sched-maps-needs-lines',
    scan: ['src'], ext: ['.jsx', '.js'],
    /* `buildScheduleMaps(rows)` ที่ไม่ส่ง lines = ไม่มีสายไลน์แม่ให้ไล่ (เงียบ ไม่มี error) */
    re: /buildScheduleMaps\([^,)]*\)/g,
    why: 'ไม่ส่ง `lines` = `parentOf` ว่าง ⇒ การตกทอดจากไลน์แม่ไม่ทำงาน ⇒ กลับไปเป็นบั๊กเดิมแบบเงียบๆ '
       + '(ไลน์ลูกที่ไม่มีแถวของตัวเอง = คนไม่มีกะ) · อาการเหมือนตารางกะยังไม่ได้ตั้ง ทั้งที่ตั้งแล้ว',
    fix: 'ส่งทะเบียนไลน์เข้าไปด้วยเสมอ: `buildScheduleMaps(scheduleRows, lines)` '
       + '(ต้องมี `id` · `name` · `parent_line_name` — `LINE_COLUMNS` มีครบอยู่แล้ว)',
    allow: { 'src/utils/__tests__/shiftAssign.test.mjs': true },   // เทสจงใจเรียกแบบไม่ส่ง lines เพื่อยืนยันพฤติกรรมเดิม
  },
  {
    id: 'registry-loader-no-silent-catch',
    scan: ['src/utils'], ext: ['.js'],
    /* จับ `loadXxx()…​.catch(() => {})` ใน **ของกลาง** (src/utils) — กลืนแล้วคืนลิสต์ว่างเงียบๆ */
    re: /\bload[A-Z]\w*\([^;]{0,200}\.catch\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/g,
    why: 'ลิสต์ว่างมี 2 ความหมาย — "ทะเบียนไม่มีของ" กับ "โหลดไม่สำเร็จ" · hook ทะเบียนทั้ง 13 ตัวเคยลงท้าย '
       + 'ด้วย `.catch(() => {})` ⇒ หน้างานเปิดช่องเลือกเห็นว่าง แล้วสรุปว่า "ยังไม่ได้ลงทะเบียน" ไปสร้างซ้ำ '
       + '(`useProductionLines` เป็นตัวอ่านทะเบียนไลน์ตัวเดียวที่อนุญาต ⇒ ล้มทีเดียว dropdown ไลน์ว่างทั้งแอป '
       + 'โดยจอไม่บอกเหตุ) · `usePartOptions`/`useOrgScope`/`useOrgDepts` ล้มแบบนี้ได้โดย toast กลางไม่ขึ้นด้วย',
    fix: 'ของกลางใช้ `useMasterRows(KEY, loadXxx)` (`src/utils/useMasterRows.js`) → คืน `{ rows, failed, stale }` '
       + 'แล้วช่องเลือกส่งเข้า `loadFail` ของ `<SearchSelect>` · ตัวที่ไม่ผ่าน cachedMaster ต้อง `console.warn` '
       + 'แล้วคืนธงล้มเหลวให้จอเขียนบอก **ห้าม `catch` เปล่า**',
    allow: {},
  },
  {
    id: 'role-retired-flag-honored',
    scan: ['src'], ext: ['.js'],
    /* จับการสร้างลิสต์ "ให้คนเลือก role" จาก ROLE_META โดยไม่กรอง retired ออก */
    re: /Object\.entries\(ROLE_META\)(?![^\n]*\bisLive\b)(?![^\n]*\bretired\b)[^\n]*\.map\(/g,
    why: 'role ที่ปลดระวางแล้ว (`retired: true`) ต้องหายจากลิสต์ที่ให้คนเลือก — ไม่งั้นยังตั้งให้ user ใหม่ได้ '
       + 'และยังกินพื้นที่เป็นคอลัมน์ใน /permissions · เคยเกิดจริง: ธงถูกเขียนตอนปลด `sale` (23/09) '
       + 'แต่**ไม่มีใครอ่าน** ⇒ 2026-10-04 ยังเจอคอลัมน์ `sale` 46 ช่องติ๊กที่มีคนถือจริง 0 คน',
    fix: 'กรองด้วย `isLive` ก่อน `.map()` · **ห้ามกรองใน `roleLabel()`** — ป้ายต้องอ่าน role เก่าออกเสมอ '
       + 'ไม่งั้น audit log / ใบเก่าขึ้นเป็นคีย์ดิบ (= เหตุผลที่เก็บแถวไว้ตั้งแต่แรก)',
    allow: {},
  },
  {
    id: 'monitor-grid-math-via-helper',
    scan: ['src'], ext: ['.jsx', '.js'],
    /* จับการหยิบสูตร recurrence ของบอร์ด Monitoring ไปคิดเองนอก monitorGrid.js */
    re: /\bRECUR\s*[[.]/g,
    why: 'แถว UNBOUND / BALANCE / ค้างที่ร้านชุบ เป็น **recurrence** (ค่าวันนี้กินค่าเมื่อวาน) — '
       + 'ก๊อปสูตรไปคิดในหน้า = หน้าไหนลืมบวกตัวเดียว ตัวเลขเพี้ยนทั้งแถวแบบไม่มีใครเห็น '
       + '(ช่องยังมีเลขอยู่ ดูปกติทุกประการ) · และสูตรพวกนี้ถอดมาจากไฟล์ Excel จริงที่ทีมวางแผน '
       + 'ใช้ตัดสินใจเปิด OT/เพิ่มกะ ⇒ เพี้ยนแล้วตามไม่เจอ · ทุกเลขบนบอร์ดต้องออกจาก `buildGrid()` ที่เดียว',
    fix: 'เรียก `buildGrid({ parts, periods, rows, manual, system })` แล้วอ่านค่าด้วย `valueAt()` / `cellAt()` '
       + '· ต้องการสูตรใหม่ ให้เพิ่มใน `RECUR` ของ `src/utils/monitorGrid.js` แล้วอ้างด้วย**ชื่อสูตร** '
       + 'ผ่าน `monitor_boards.rows[].recur` ไม่ใช่เขียนเลขคณิตในหน้า',
    allow: {
      'src/utils/monitorGrid.js': 99,    // เจ้าของสูตร
      'src/utils/monitorBoards.js': 99,  // เช็คว่าสูตรที่ DB อ้างมีอยู่จริงไหม (unknownRecur)
    },
  },
  {
    id: 'monitor-parts-key-is-mat-plus-part',
    scan: ['src'], ext: ['.jsx', '.js'],
    /* จับการกลับไปใช้ "MAT เดี่ยว" เป็นคีย์แถวพาร์ทของบอร์ด Monitoring */
    re: /onConflict:\s*['"`]board_id,\s*mat_no['"`]/g,
    why: 'คีย์แถวพาร์ทของบอร์ด Monitoring ไม่ใช่ MAT เดี่ยว — ไฟล์จริงของทีมวางแผนมี MAT เดียวกัน '
       + 'หลายแถว (300T: `20059152` = N1WB-E16A416 คว่ำครีบ / N1WB-E16A417 หงายครีบ · Total SL '
       + '2,100 กับ 1,500) ⇒ คีย์ (board_id, mat_no) ทำให้ **แถวที่ 2 ถูกเขียนทับหายไปเงียบๆ** '
       + 'หรือ upsert ล้มทั้งก้อน · เคยเกิดจริง 02–05/10: user นำเข้าไฟล์ไม่ได้ 2 รอบ '
       + '(`no unique or exclusion constraint matching the ON CONFLICT specification` → '
       + '`ON CONFLICT DO UPDATE command cannot affect row a second time`)',
    fix: 'ใช้ `onConflict: \'board_id,row_key\'` โดย row_key มาจาก `partRowKey(mat_no, part_no)` '
       + '(`src/utils/monitorBoards.js` — สูตรเดียวกับ trigger `monitor_parts_set_row_key()` ฝั่ง DR) '
       + '· และยุบของซ้ำในก้อนเดียวด้วย `dedupeByKey()` ก่อนส่ง **ค่าล่างชนะ ห้ามรวมยอด**',
    allow: {},
  },
  {
    id: 'modal-closes-on-backdrop',
    scan: ['src'], ext: ['.jsx'],
    /* จับ "ชั้น backdrop ของ modal มี onClick={onClose}" — บรรทัดเดียวกับ position:'fixed' / className="overlay"
       ⚠️ ยกเว้นด้วย `allow` เท่านั้น **ห้ามพึ่งคอมเมนต์** — ตัวสแกนตัด comment ออกก่อนตรวจ (ข้อ 3 ด้านบน)
          popup แสดงผลอย่างเดียวยังต้องเขียนคอมเมนต์กำกับตาม UI-CONVENTIONS §5 ไว้ให้คนอ่าน
          แต่สิ่งที่ทำให้ด่านผ่านคือรายการใน allow ซึ่งบังคับให้ "ตั้งใจยกเว้น" ไม่ใช่ "ลืม" */
    re: /^(?=.*onClick=\{onClose\})(?=.*(?:position:\s*'fixed'|className="(?:overlay|modal-scroll)")).*$/gm,
    why: 'modal ที่มีฟอร์มกรอก **ห้ามปิดจากการคลิกพื้นหลัง** (คำสั่ง user 2026-07-09 · audit ทั้งระบบ 21/08) — '
       + 'เผลอแตะนอกกรอบทีเดียว ที่กรอกไว้ทั้งฟอร์มหายหมด ไม่มีทางเรียกคืน '
       + '· กฎนี้เคยถูก audit แล้วแต่**ไม่มีด่านอัตโนมัติ** ⇒ 01/10 `TrialBookingModal` (ฟอร์มจองเครื่องทดลอง '
       + '8 ช่อง) เขียน `onClick={onClose}` ที่ชั้นนอกกลับมาอีก และหลุดถึงมือ user '
       + '· popup ที่แสดงผลอย่างเดียว (ดูกราฟ/รูป/ประวัติ/กล้องสแกน) ปิดจาก backdrop ได้ — แต่ต้องเขียน '
       + 'คอมเมนต์มีคำว่า `backdrop` กำกับที่บรรทัดนั้น เพื่อให้รู้ว่า "ตั้งใจ" ไม่ใช่ "ลืม"',
    fix: 'เอา `onClick={onClose}` ออกจาก <div> ชั้นนอก แล้วปิดด้วยปุ่ม ✕ / ยกเลิก เท่านั้น '
       + '· ใช้ `<div className="overlay">` + `<div className="modal">` ของกลาง อย่าวาง position:fixed/สีพื้นเอง '
       + '· ถ้าเป็น popup แสดงผลอย่างเดียวจริง ให้เขียนคอมเมนต์กำกับที่บรรทัดนั้น เช่น '
       + '`/* ดูอย่างเดียว ไม่มีช่องกรอก → ปิดจาก backdrop ได้ตามกฎ */` **แล้วเติมชื่อไฟล์ใน allow ด้านล่าง**',
    allow: {
      /* 4 ตัวนี้เป็น popup **แสดงผลอย่างเดียว ไม่มีช่องกรอก** → กฎ UI-CONVENTIONS §5 อนุญาตให้ปิดจาก backdrop
         (เผลอแตะแล้วไม่เสียงาน เพราะไม่มีอะไรให้เสีย) · ทุกตัวมีคอมเมนต์กำกับในไฟล์แล้ว
         🔴 จะเติมรายการใหม่ที่นี่ได้ ต้องตอบได้ว่า "ถ้าผู้ใช้เผลอแตะพื้นหลัง เขาเสียอะไร" = ไม่เสียอะไรเลย
            ถ้ามีช่องกรอก/ติ๊กเลือกแม้ช่องเดียว ห้ามใส่ — ให้แก้โค้ดแทน */
      'src/components/KpiMonthly.jsx': 1,      // ขยายกราฟ KPI รายเดือน — ดูอย่างเดียว
      'src/components/SparePartMaster.jsx': 1, // ประวัติการเบิกอะไหล่ — ดูอย่างเดียว
      'src/pages/PMSchedule.jsx': 1,           // DayModal — ดูรายการ PM ของวันนั้น
      'src/pages/RackCenter.jsx': 1,           // จอสแกน QR — กล้องอย่างเดียว
      'src/components/ObeyaSheet.jsx': 1,      // ขยายแผ่น A4 ของบอร์ด KPI/SQDCM — ดูอย่างเดียว
      'src/components/inspect/PointZoom.jsx': 1,   // ขยายรูปโคลสอัพจุดตรวจ PM+QA (lightbox · ย้ายมาจาก PMCheckData 15/10) — ดูอย่างเดียว
    },
  },
  {
    id: 'edi-dict-wrapper-not-dict',
    scan: ['src'], ext: ['.jsx', '.js'],
    /* จับ "เอาผลของ buildEdiDict() ทั้งก้อนไปใช้เป็นพจนานุกรม" — ต้องแกะ `{ dict }` เสมอ */
    re: /(?:const|let|var)\s+\w+\s*=\s*(?:useMemo\(\s*\(\)\s*=>\s*)?buildEdiDict\(/g,
    why: '`buildEdiDict()` คืน `{ dict, fromDb }` · `/planner-sales` เคยเก็บทั้งก้อนเป็น `ediDict` '
       + '⇒ `sigOf()` อ่าน `wrapper.part` = undefined ⇒ ไม่มีหัวตารางไหนผ่าน ⇒ **ไฟล์ EDI 830/862 ทุกไฟล์ '
       + 'ตกไปโหมด map มือบนชีตแรก** (Summary/Running · "ไม่พบหัวตาราง") **ไม่มีใครนำเข้าได้เลย 22/09 → 01/10** '
       + '· เทสระดับ util ผ่านหมดเพราะส่ง dict ตรง — พังเฉพาะจุดเรียกในหน้า',
    fix: '`const { dict: ediDict } = useMemo(() => buildEdiDict(rows), [rows])`',
    allow: {},
  },
  {
    id: 'no-factory-vocabulary-in-language-layer',
    scan: ['src/utils/thaiText.js', 'src/utils/termStats.js', 'src/utils/autoCategory.js', 'src/utils/machineNo.js'],
    ext: ['.js'],
    /* จับ "ชื่ออุปกรณ์/ศัพท์เฉพาะโรงงาน" ที่หลุดเข้าไปเป็นโค้ด (คอมเมนต์ไม่นับ — ตัวสแกนตัดออกก่อน)
       เลือกเฉพาะคำที่เป็นอุปกรณ์ชัดเจน ไม่ใช่คำกลางอย่าง alarm/stop/error ที่อยู่ใน STOP โดยชอบธรรม */
    re: /\b(conveyor|bending|hydraulic|gripper|solenoid|stopper|mandrel|pallet)\b|เลเซอร์|คอนเวเย่อ|เบนดิ่ง|ไฮดรอลิ/gi,
    why: 'CLAUDE.md: **ห้าม AI เดา taxonomy ของโรงงาน** — พจนานุกรมที่ใช้จับกลุ่มต้องมาจาก '
       + 'ทะเบียนของโรงงาน (`mtn_problem_types` / `dr_downtime_types`) + ใบที่คนจัดกลุ่มไว้แล้วเท่านั้น '
       + '· ถ้าเริ่มฮาร์ดโค้ดศัพท์เครื่องจักรลงในชั้นภาษา มันจะ (1) ถูกต้องเฉพาะโรงงานนี้ '
       + '(2) ล้าสมัยเงียบๆ เมื่อโรงงานเพิ่ม/เปลี่ยนประเภท (3) ทำให้ไม่มีใครไปแก้ที่ทะเบียนซึ่งเป็นต้นเหตุจริง '
       + '· ไฟล์ชั้นภาษาเก็บได้แค่ "กฎของภาษา" (ห นำ · c อ่อน/แข็ง · เเ→แ · คำเชื่อม)',
    fix: 'เอาคำนั้นออก แล้วให้มันมาจากข้อมูล: ป้ายในทะเบียน → `buildCategoryIndex(..., kind:"registry")` '
       + '· ศัพท์หน้างาน → เรียนจากใบที่จัดกลุ่มแล้ว (`kind:"seen"`) ซึ่งต้องผ่าน log-odds z + พื้นขั้นต่ำ',
    allow: {},
  },
  {
    id: 'line-dropdown-hand-built',
    scan: ['src'], ext: ['.jsx', '.js'],
    /* จับ "วาด <option> ของไลน์เอง" 2 ลายเซ็นที่เคยหลุดจริง:
         (1) เยื้องชั้นเอง — `${'\u00a0'…repeat(depth)}` / `'\u21b3 '` ใน <option>
         (2) ตัดไลน์ลูกทิ้งตอนทำลิสต์ — `!l.parent_line_name` + `.map(... => l.name)` ติดกัน
       ไม่จับการใช้ `lineOptions()`/`lineOptionLabel()` (ของกลาง) และไม่จับลิสต์ที่สร้างจาก
       "ข้อมูลที่โหลดมาแล้ว" (เช่น dropdown กรองกะใน /qa ที่ map จาก sessions) ซึ่งถูกต้องอยู่แล้ว */
    re: /<option\b[^>]*>\s*\{[^}]{0,60}?(?:\.repeat\(\s*\w*\.?depth|\b\w*\.?depth\s*\?)/g,
    why: 'dropdown เลือกไลน์ที่หน้าประกอบเอง drift กันทุกหน้า — จอ 📟 OEE รายไลน์ (Weekly) กรอง '
       + '`!l.parent_line_name` ⇒ dropdown มีแต่ไลน์แม่ 9 ตัว ทั้งที่ **งานจริงเกือบทั้งหมดอยู่ไลน์ลูก** '
       + '(วัดจริง 24/09/2026: Line 60 = 109 กะ · LASER-345 = 106 · HDF2 = 107 ส่วนไลน์แม่ HYDROFORM 11 กะ '
       + 'และหยุดใช้ตั้งแต่ 02/07) → จอ TV ประจำไลน์เปิดดู OEE ของไลน์ตัวเองไม่ได้เลย '
       + '· รอบก่อนหน้า (08-25) ก็เป็น dropdown ชุดเดียวกันที่ปน "Office PD4"/"test" เพราะไม่เช็ค is_active',
    fix: 'ใช้ `<LineSelect>` (`src/components/LineSelect.jsx`) — ลำดับชั้นแม่→ลูก + scope leader/sections '
       + '+ ไลน์ปลดระวาง + ค่าที่ไม่รู้จักไม่หายเงียบ ครบในตัว (UI-CONVENTIONS §5.1.2) '
       + '· ต้องวาด <option> เองเพราะ onChange ทำอย่างอื่นต่อ → `lineOptions()` + `lineOptionLabel()` '
       + 'จากไฟล์เดียวกัน ห้ามก๊อปสูตรเยื้อง',
    allow: {
      // ตัวจริงที่เป็นเจ้าของสูตรเยื้อง — ที่อื่น import จากที่นี่
      'src/components/LineSelect.jsx': 1,
    },
  },
  {
    id: 'org-list-raw-order',
    scan: ['src'], ext: ['.jsx', '.js'],
    /* จับ 2 ลายเซ็นที่ทำให้ "ส่วนงาน/แผนก/ทีม" เรียงคนละแบบต่อหน้า:
         (1) ดึงผังองค์กรด้วย `.order('name')` (ทิ้ง sort_order ที่ admin ตั้งใน /org-setup)
         (2) ลิสต์ส่วนงาน/รหัสผังที่สร้างจากข้อมูล แล้ว `.sort()` ดิบ */
    re: /from\('org_nodes'\)[^;]{0,220}?\.order\('name'\)|\.(?:section|team)\)(?:\.filter\(Boolean\))?\)\]\.sort\(\s*\)|n\.code \|\| n\.name\)(?:\.filter\(Boolean\))?\)?\]?\.sort\(\s*\)/g,
    why: 'dropdown ที่ใช้ซ้ำหลายหน้าเรียงคนละแบบ — user ทัก 01/10/2026 *"ดู dropdown ตัวอื่นๆ ที่ใช้เหมือนกันหลายหน้า '
       + 'อย่าให้มั่ว"*: ผังองค์กรตัวเดียวกันถูกดึง order(name) / order(sort_order) / ไม่เรียง แล้ว .sort() ทับ ⇒ '
       + '"แผนก" PD3 หน้าหนึ่ง LINE APRON ASSY → HYDROFORM (ตามผัง) อีกหน้า HYDROFORM → LINE APRON ASSY · แผนกช่าง QA→MTN / MTN→QA',
    fix: 'ของจากผัง → `orgValues(nodes)` / `.sort(orgNodeCompare)` (select `sort_order` มาด้วย) · ลิสต์ที่สร้างจากข้อมูล → '
       + '`sortLike(values, orgList)` (ค่านอกผังต่อท้าย) หรือ `.sort(naturalCompare)` — ทั้งหมดจาก `src/utils/listOrder.js`',
    allow: {},
  },
  {
    id: 'button-radius-token',
    scan: ['src/pages', 'src/components'], ext: ['.jsx'],
    /* จับ <button …style={{ … borderRadius: <เลข> …}}> — มุมปุ่มต้องเป็น token (`var(--r-md)` ผ่าน .pg-btn/.pg-btn.sm) ไม่ใช่เลขดิบ
       (วัดจริง 06/11: แถวปุ่ม 147 แถว 26 หน้า มีมุม 9 แบบ 0/6/7/8/10/16/20/999) · ปุ่มวงกลม '50%' และ className="pg-btn…" ไม่เข้าข่าย */
    re: /<button\b(?:[^>{}]|\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\})*borderRadius:\s*(?:999|\d{1,2})\b(?!%)/g,
    why: 'user ทัก 06/11/2026 *"tab หัวตาราง บางหน้าเหลี่ยม บางหน้ารี บางหน้ามุม r ไม่เท่ากันเลย"* — ปุ่มเลือก/คำสั่งแต่ละหน้าเขียนมุมเอง 9 แบบ',
    fix: 'แถวเลือกมุมมอง → <TabBar> · สลับโหมด 2–5 → <Segmented> · ปุ่มคำสั่ง → className="pg-btn" / "pg-btn sm" (+primary/danger) · ถ้าต้องเขียน style เอง ใช้ borderRadius: \'var(--r-md)\' (UI-CONVENTIONS §6.36 ข้อ 0)',
    allow: {},
  },
  {
    id: 'control-radius-token',
    scan: ['src/pages', 'src/components'], ext: ['.jsx'],
    /* จับ <input|select|textarea …style={{ … borderRadius: <เลข> …}}> — มุมช่องกรอกต้องเป็น token --ctl-r (วัดจริง 08/11: 126 ช่อง/50 ไฟล์ มี 7 ค่าปน) */
    re: /<(?:input|select|textarea)\b(?:[^>{}]|\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\})*borderRadius:\s*(?:999|\d{1,2})\b(?!%)/g,
    why: 'รอบ 3 มุมมาตรฐาน (08/11/2026): ช่องกรอก/select/textarea เคยเขียนมุม 3/4/5/6/7/8/10 ปน — ให้ใช้ token เดียวกับแถบกรอง',
    fix: "borderRadius: 'var(--ctl-r)' (ค่ากลาง 8px · อ่านจาก :root) หรือไม่ต้องเขียนเลย (global input/select/textarea ใช้ --ctl-r อยู่แล้ว · UI-CONVENTIONS §6.36 ข้อ 0)",
    allow: {},
  },
  {
    id: 'box-radius-token',
    scan: ['src/pages', 'src/components'], ext: ['.jsx'],
    /* จับ <div|span …style={{ … borderRadius: <เลข> …}}> — การ์ด/กล่อง/ชิป ต้องเป็น token (วัดจริง 09/11: 1,658 จุด/225 ไฟล์ มี 14 ค่าปน 2…999) · วงกลม '50%' และสตริงหลายมุม '8px 8px 0 0' ไม่เข้าข่าย */
    re: /<(?:div|span)\b(?:[^>{}]|\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\})*borderRadius:\s*(?:999|\d{1,2})\b(?!%)/g,
    why: 'รอบ 4 มุมมาตรฐาน (09/11/2026): การ์ดเคยเป็น 8/10/12/14 ปนในหน้าเดียว ชิปเป็น 4/5/6/20/999 — ผู้ใช้ทักว่ามุมไม่เท่ากัน',
    fix: "ชิปเล็ก/ป้ายตัวเลข 'var(--r-xs)' (4) · การ์ด/กล่อง/ชิปทั่วไป 'var(--r-md)' (8) · การ์ดใหญ่/แผง/modal 'var(--r-lg)' (12) · แคปซูล/แถบ progress 'var(--r-pill)' (UI-CONVENTIONS §6.36 ข้อ 0)",
    allow: {},
  },
  {
    id: 'tabs-folded-into-dropdown',
    scan: ['src/components/PageHeader.jsx'], ext: ['.jsx'],
    re: /MAX_TABS|aria-label="แท็บเพิ่มเติม"|tabList\.slice\(/g,
    why: 'แท็บที่ถูกพับเข้า "⋯ เพิ่มเติม" = คนไม่รู้ว่ามี — user ทัก 01/10/2026 *"ถ้าเป็นดรอปดาว จะทำให้ user ไม่รู้ป่าว"* '
       + '(ProductMaster ลูกค้า/Supplier/ทบทวน CT/Export หายจากสายตา · เดิมอ้าง Miller 7±2 ผิดบริบท)',
    fix: 'แท็บโชว์ครบเสมอ (เดสก์ท็อป wrap · มือถือเลื่อนแนวนอน) · แท็บเยอะเกิน = ยุบของซ้ำ/แยกเป็นหน้า (NAVIGATION-REVIEW §2.3) ไม่ใช่ซ่อน',
    allow: {},
  },
  {
    id: 'i18n-chrome-literal',
    scan: ['src/pages', 'src/components'], ext: ['.jsx'],
    /* ปุ่ม/หัวตาราง/option/placeholder ที่เขียนข้อความไทยดิบบรรทัดเดียว — ต้องผ่าน tr() (รอบ 2 ของชั้นภาษา 12/11)
       จับเฉพาะรูปที่ codemod ห่อให้ได้แน่ (เปิด-ปิดบรรทัดเดียว ไม่มี {}) · ข้อความข้าง JSX/หลายบรรทัดยังไม่บังคับ */
    re: /<(?:button|th|option)\b[^>\n]*>\s*[^<{}\n]*[\u0E00-\u0E7F][^<{}\n]*<\/(?:button|th|option)>|placeholder="[^"\n]*[\u0E00-\u0E7F]/g,
    why: 'user ทัก 12/11/2026 *"สลับภาษาไทย-อังกฤษยังไม่สมบูรณ์"* — วัดโหมดอังกฤษ: ปุ่มไทยค้าง 1,156 จุด · หัวตาราง 210 · placeholder 89 '
       + 'ทั้งที่โครงหลักแปลแล้ว ⇒ ห่อ tr() ให้ครบทั้งระบบ (2,890 จุด) แล้วห้ามเขียนดิบกลับมา',
    fix: "{tr('ข้อความ')} (import { tr } from '<path>/utils/i18n' · ไฟล์ที่มี const tr = useTimeRange() ใช้ `tr as trI18n`) "
       + "+ เติมคำใน src/i18n/en.js หมวดรอบ 2 · UI-CONVENTIONS §6.34 ข้อ 7",
    allow: { 'src/pages/Report.jsx': 'ใบพิมพ์ OT เป็น HTML string ใน template literal (กระดาษไทย ไม่แปล · {tr()} ในสตริงพิมพ์ออกมาตรงตัว — บั๊กรอบ 2 แก้ 13/11)' },
  },
  {
    id: 'scrim-token-only',
    scan: ['src/pages', 'src/components'], ext: ['.jsx'],
    /* ม่านหลัง modal (fixed เต็มจอ) ที่เขียนสีดำโปร่งเอง — วัดจริง 13/11: 225 modal มีความมืด 8 ค่า (0.5→1.0) ใน 14 หน้ามืดไม่เท่ากันในหน้าเดียว */
    re: /position:\s*'fixed'[^{}\n]{0,300}(?:background(?:Color)?):\s*'rgba\(0,\s*0,\s*0,\s*(?:0?\.\d+|1)\)'|(?:background(?:Color)?):\s*'rgba\(0,\s*0,\s*0,\s*(?:0?\.\d+|1)\)'[^{}\n]{0,300}position:\s*'fixed'/g,
    why: 'user สั่ง 13/11 "แก้ backdrop ให้เป็น token เดียว 0.7 + blur ทั้งระบบ" — ก่อนหน้ามี 3 ก๊อก (--scrim 0.55 · .overlay 0.78 · เขียนมือ 0.6 อีก 99 จุด) '
       + 'modal เดียวกันคนละหน้ามืดไม่เท่ากัน · 0.55/0.6 เหลือ contrast หน้าหลัง 3.1–3.6:1 ยังแย่งสายตา',
    fix: "background: 'var(--scrim)', WebkitBackdropFilter: 'var(--scrim-blur)', backdropFilter: 'var(--scrim-blur)' (หรือ className=\"overlay\") · ค่าแก้ที่ index.css ที่เดียว (UI-CONVENTIONS §5)",
    allow: {},
  },
  {
    id: 'i18n-map-label-at-declaration',
    scan: ['src/pages', 'src/components', 'src/utils', 'src/lib'], ext: ['.jsx', '.js'],
    /* label: tr('…') ที่จุดประกาศ map ค่าคงที่ — แปลตอน import ครั้งเดียว · สลับภาษาแล้ว App remount (ไม่ reload) ⇒ ป้ายค้างภาษาเดิม */
    /* จับเฉพาะบรรทัดที่เป็น "แถวของ map" (เริ่มด้วย key: { … หรือ { … หรือ property ตรงๆ) — tr() ใน props ของ call ตอน render ไม่เข้าข่าย */
    re: /^\s*(?:[\w$'"]+\s*:\s*\{\s*|\{\s*)?(?:[\w$]+\s*:\s*[^,\n{}]*,\s*)*(?:label|desc|hint|short|title|sub)\s*:\s*(?:tr|trI18n)\(\s*'/gm,
    why: 'รอบ 3c (13/11): สลับภาษาทำงานด้วยการ remount ต้นไม้ React ไม่ใช่ reload ⇒ ค่าคงที่ระดับโมดูลที่เรียก tr() ตอน import '
       + 'จะแปลครั้งเดียวแล้วค้าง — จอโชว์ภาษาเก่าทั้งที่สลับแล้ว',
    fix: "เก็บไทยไว้ที่ map · แปลที่จุดวาด {tr(meta.label)} (📄 docs/modules/i18n.md §รอบ 3c)",
    allow: {},
  },
  {
    id: 'i18n-import-path-depth',
    scan: ['src/components/inspect'], ext: ['.jsx'],   // เฉพาะโฟลเดอร์ย่อย — ไฟล์ตรงใต้ pages/components ใช้ '../utils/i18n' ถูกแล้ว
    /* ไฟล์ในโฟลเดอร์ย่อย (src/components/inspect/…) เขียน import '../utils/i18n' = ชี้ผิดชั้น — lint ไม่จับ (resolve ตอน bundle)
       vite dev ตอบ 500 ⇒ 3 หน้าพังใน crashsweep (12/11) · ต้องเป็น '../../utils/i18n' */
    re: /from '\.\.\/utils\/i18n'/g,
    why: 'codemod รอบ 2 ใส่ path ชั้นเดียวให้ทุกไฟล์ ⇒ src/components/inspect/* 6 ไฟล์ resolve ไม่ได้ · build เงียบเพราะ grep ดูแค่ผลเทส',
    fix: "ไฟล์ใต้โฟลเดอร์ย่อย import { tr } from '../../utils/i18n' (นับชั้นจริง)",
    allow: {},
  },
  {
    id: 'section-select-hand-built',
    scan: ['src/pages', 'src/components'], ext: ['.jsx'],
    /* ช่อง "ทุกส่วนงาน" ที่วาดเป็น <select> ลิสต์แบนเอง — ต้องเป็นต้นไม้ผังองค์กร (SectionScopeSelect/LineScopeSelect/OrgScopePicker) */
    re: /<option value="">\{ALL\.section\}<\/option>/g,
    why: 'user ทัก 09/11/2026 *"dropdown ที่ยังเหมือนไม่ดึงจากผังองค์กร ยังเจอหลาย tab ในหลายๆ หน้า"* (ภาพ /manpower-board) — '
       + 'ลิสต์แบน PD1/PD2/… ไม่มีฝ่าย/ไอคอน/ย่อหน้า ทั้งที่ UI §5.3 ข้อ 9 สั่งให้ทุกช่องขอบเขตเป็นต้นไม้ `<OrgScopePicker>` ตัวเดียว · วัดจริง 12 หน้า/17 ช่อง',
    fix: 'หน้าที่เก็บ state เป็นสตริงส่วนงาน = `<SectionScopeSelect value onChange only={…} [pickDept dept]>` (`src/components/SectionScopeSelect.jsx`) · '
       + 'หน้าที่เลือกไลน์ได้ = `<LineScopeSelect>` · กรองได้ทุกมิติ = `<OrgScopePicker>` · ป้าย "ทุกส่วนงาน" ส่งผ่าน `plantLabel`/`allLabel` ไม่ใช่ <option> เอง',
    allow: {},
  },
  {
    id: 'line-scope-split-selects',
    scan: ['src'], ext: ['.jsx'],
    /* ตัวกรองขอบเขตไลน์ที่แตกเป็น "ช่องส่วนงาน + ช่องไลน์" (2 ช่องติดกัน) หรือ map ทะเบียนไลน์เป็น <option> เอง */
    re: /\{ALL\.section\}<\/option>[\s\S]{0,700}?<LineSelect\b|\blines\b[^;\n]{0,40}\.map\(\(?(\w+)\)?\s*=>\s*<option/g,
    why: 'dropdown ขอบเขตทำงานไม่เหมือนกันทุกหน้า — user ทัก 02/10/2026 *"หน้าวางแผนมี 2 ช่องให้เลือก · หน้า OEE แยกส่วนงานกับแผนก '
       + 'แต่เจาะไลน์ไม่ได้ · เอาให้เป็นมาตรฐาน"* + ภาพ OBEYA *"นี่ก็อีกแบบ"* (OEE ช่องไลน์ลูกโผล่เฉพาะตอนเลือกกลุ่มที่มีลูก · แผนล็อต map ทะเบียนเรียงตัวอักษรแบน)',
    fix: 'ตัวกรองขอบเขต = `<LineScopeSelect section line onChange={(sec, ln, {root}) => …}>` (`src/components/LineScopeSelect.jsx`) '
       + 'ซึ่งวาดด้วย `<OrgScopePicker>` ตัวเดียวกับ OBEYA (ต้นไม้ผัง 🏭›🏢›📁›📂›🔗›➖) · หน้าที่กรองได้ทุกมิติใช้ `<OrgScopePicker>` ตรงๆ · '
       + 'ช่องที่ต้องได้ไลน์เดียว = `<LineSelect>`',
    allow: {
      // ไม่ใช่ทะเบียนไลน์ — ปลายทางที่ระบบเสนอเป็นกลุ่มพร้อมเหตุผล (ไลน์ลูกที่มีพาร์ทนั้นใน BOM)
      'src/components/StockMoveToChild.jsx': 1,
    },
  },
  {
    id: 'line-names-raw-sort',
    scan: ['src'], ext: ['.jsx', '.js'],
    /* จับ "เรียงชื่อไลน์ด้วย sort ดิบ" — `.sort()` เปล่า / `localeCompare` บนลิสต์ชื่อไลน์
       (ชื่อตัวแปร lines/lineNames/lineOpts/byLine/… หรือ `.map(x => x.line_name)`) */
    re: /(?:\.map\(\s*\(?\w+\)?\s*=>\s*\w+\.line(?:_name)?\)[^;\n]{0,60}|liveLines[^;\n]{0,120}\.map\(l => l\.name\)|Object\.keys\(byLine\)|\[\.\.\.(?:lines|lineSet|byLine\.keys\(\))\]|\b(?:line_?[nN]ames?|lineOpts)\b[^;\n]{0,40})\.sort\(\s*(?:\)|\(a, ?b\) => a\.localeCompare\(b\)\))/g,
    why: 'dropdown/หัวกลุ่มไลน์เรียงคนละแบบทุกหน้า — user ทัก 01/10/2026 *"บางหน้าโอเค บางหน้าเรียงมั่ว '
       + 'ไม่มีแพทเทิร์น"*: sort ดิบเรียงตาม code unit ⇒ `Line 60` แยกจาก `LINE …` · `LINE 10` มาก่อน `LINE 9` '
       + 'และไม่แยกส่วนงาน (LINE A ของ PD1 ไปอยู่ระหว่าง APRON ของ PD3 กับ ASSY ของ PD2)',
    fix: 'มีทะเบียนไลน์ → `sortLineNames(names, lines)` (ส่วนงาน→แม่→ลูก) · ไม่มีทะเบียน → `.sort(lineNameCompare)` '
       + '(ทั้งคู่จาก `src/utils/lineHierarchy.js`) · dropdown ใช้ `<LineSelect>` ซึ่งเรียง+ตั้งหัวกลุ่มส่วนงานให้เอง',
    allow: {
      // ไม่ใช่ลำดับบนจอ — เรียงเพื่อทำ "คีย์" (join '|') ให้ได้ค่าเดิมทุกครั้ง ลำดับแบบไหนก็ได้ขอให้นิ่ง
      'src/components/StoreLotQueue.jsx': 1,
    },
  },
  {
    id: 'downtime-bucket-not-raw-type-name',
    scan: ['src'], ext: ['.jsx', '.js'],
    /* จับเฉพาะ "เอาชื่อประเภทดิบไปเป็น**คีย์จัดกลุ่ม**" 2 รูปแบบที่ใช้จริงในรีโป:
         (1) `const k = d.dr_downtime_types?.name_th || '…'`  → เอาไปเป็น key ของ object นับยอด
         (2) `cat: d.dr_downtime_types?.name_th || '…'`        → แกนของพาเรโต (ParetoAbcChart)
       🔴 **ไม่จับการ *แสดงผล* ชื่อประเภทของแถวเดียว** (`<span>{d…name_th || 'Downtime'}</span>`)
          เพราะนั่นถูกต้องอยู่แล้ว — แถวเดียวมีเลขเครื่องกับข้อความอยู่ข้างๆ ให้อ่านต่อได้
          (กติกาข้อ 1 ของไฟล์นี้: กฎที่ false positive บ่อย = คนอยากปิดด่าน) */
    re: /(?:(?:const|let|var)\s+[\w$]+\s*=|\bcat:)\s*[\w$]+\??\.dr_downtime_types\?\.name_th\s*\|\|/g,
    why: 'พาเรโต downtime ยุบ "อื่นๆ (นอกแผน)" / "เครื่องแจ้งเตือน Alarm (ไม่ระบุสาเหตุ)" เป็นแท่งเดียว '
       + '⇒ แท่งใหญ่ที่บอกไม่ได้ว่าไปแก้ที่ไหน · วัดจริง 90 วัน (23/09/2026): ถังขยะ 438 ใบ / 15,433 นาที '
       + '= อันดับ 5 และ 8 ของพาเรโตนอกแผน (รวมกัน 10.3% ของนาที = อันดับ 2 ถ้ายุบเป็นแท่งเดียว) '
       + 'ทั้งที่ **401 ใบ (92%) กรอก `machine_no` ไว้แล้ว** ⇒ จอโยนค่าที่มีอยู่ทิ้งเอง '
       + '· เคสที่โผล่ทันทีที่แตกตามเครื่อง: **HDF-02 = 66 ใบ / 2,619 นาที** ที่ไม่มีจอไหนเคยเห็น',
    fix: "ใช้ `dtBucketName(d)` จาก `src/utils/downtimeCategory.js` เป็นคีย์จัดกลุ่มเสมอ "
       + '(ประเภทปกติได้ชื่อเดิมเป๊ะ · เฉพาะถังขยะที่ถูกแตกเป็น "<เลขเครื่อง> · <ชื่อประเภท>") '
       + '· ฝั่ง SQL ที่ rollup รายปีก็ต้องแตกแบบเดียวกัน (migration 20260923_obeya_year_rollup_dt_machine_dr.sql)',
    allow: {
      // คีย์นี้ **มี `::${machine_no}` ต่อท้ายอยู่แล้ว** (หาเครื่องที่หยุดซ้ำซาก) = แตกตามเครื่องอยู่แล้ว
      'src/components/OeeInsightPanel.jsx': 1,
      // ป้ายกำกับแท่งบนไทม์ไลน์รายใบ (1 แถว = 1 ครั้งที่หยุด) ไม่ได้รวมยอดข้ามใบ
      'src/components/DowntimeTimeline.jsx': 1,
      // popup ของไลน์บนผังโรงงาน — ลิสต์รายใบ มีเลขเครื่องอยู่ในแถวเดียวกัน
      'src/pages/FactoryMap.jsx': 1,
      // `_causes` ของ KPI ช่าง — ทั้ง record ถูก key ด้วย "เครื่อง" อยู่แล้ว
      // ⇒ ถ้าเติมเลขเครื่องเข้าไปในชื่อสาเหตุอีก จะได้ "HDF-02 · อื่นๆ" ซ้อนอยู่ใน record ของ HDF-02
      'src/utils/mtnMetrics.js': 1,
    },
  },
  {
    id: 'shift-midnight-hardcoded-hour',
    scan: ['src'], ext: ['.jsx', '.js'],
    /* จับการเดา "ข้ามเที่ยงคืนไหม" จากเลขชั่วโมงดิบคู่กับ shift === 'night'
       เช่น `shift === 'night' && h < 8` · `s.shift==='night' && parseInt(t) < 8`
       (ตัว resolve ที่ถูกต้องอยู่ `src/utils/shiftWindow.js` ซึ่งไม่ match เพราะไม่อ้าง 'night' เลย) */
    re: /'night'[\s\S]{0,80}?<\s*8\b/g,
    why: 'กฎ "กะดึก + ชั่วโมง < 8 = วันถัดไป" **ผิดกับกะดึกที่จบ 08:00 หรือเลยไป** '
       + '· กะดึกเริ่ม 20:00 จบ 08:00+ ⇒ คนกรอก 5ส./ส่งกะท้ายกะเป็น "08:00"/"08:30" ไม่เข้าเงื่อนไข `< 8` '
       + '→ ถูก anchor ไว้ "วันเดียวกับ work_date" = **ก่อนเปิดกะ ~12 ชม.** '
       + '· วัดจริง 23/09/2026: 15 แถว 890 นาที ตรงลายเซ็นนี้เป๊ะ (กะดึกล้วน ไม่ใช่ความผิดคนกรอก) '
       + '· โผล่พร้อมกัน 3 จุดใน DailyReport (buildDT · backfillIsoFromTime · carryImportOpenedAt) '
       + 'เพราะเป็นสูตรที่ถูกก๊อปต่อๆ กัน · ผลลัพธ์: ไทม์ไลน์/พาเรโต/OEE ได้เวลาผิดวัน',
    fix: 'ใช้ `resolveShiftTime(hhmm, session)` จาก `src/utils/shiftWindow.js` '
       + '— เลือก offset วันจาก **กรอบกะจริง** (start_time + shift_min/end_time) ไม่เดาจากเลขชั่วโมง '
       + '⇒ กะดึกที่เริ่ม 22:30 หรือกะเช้าที่ลาก OT ข้ามเที่ยงคืน ก็ถูกโดยไม่ต้องแก้โค้ดเพิ่ม '
       + '· ต้องการแค่ "เวลาเริ่ม/จบกะเป็น ms" ใช้ `shiftWindow()` หรือ `shiftFrameOf()` (oee.js)',
    allow: {
      // getCurrentPeriod() เรียงช่วงเวลาที่ **hardcode ไว้ในไฟล์เดียวกัน** (SHIFT_PERIODS: 22:30/03:00)
      // บนสเกลนาทีสัมพัทธ์ เพื่อตอบ "ตอนนี้อยู่ช่วงไหน" — ไม่ได้ anchor เวลาที่คนกรอกกับ work_date
      // จึงไม่ใช่บั๊กคลาสเดียวกัน · แต่เป็นสมมติฐาน "กะดึก = 20:00-08:00" ที่ฝังอยู่เหมือนกัน
      // ⇒ ถ้าวันหนึ่งกะดึกเปลี่ยนเวลา ต้องกลับมาแก้จุดนี้ด้วย (บันทึกไว้กันลืม)
      'src/pages/Management.jsx': 'ช่วงเวลา hardcode ในไฟล์เอง ไม่ผูก work_date — ดูหมายเหตุด้านบน',
    },
  },
  {
    id: 'kpi-source-not-truthy',
    scan: ['src'], ext: ['.jsx', '.js'],
    /* จับ `!x.source` ที่ใช้ตัดสินว่า "แถวนี้กรอกมือ" — ยกเว้น `!x.source?.startsWith(...)`
       และ `!x.source.foo` (ตามด้วย `?` หรือ `.` = ไม่ใช่การเช็ค truthiness ของตัวคอลัมน์)
       ปัจจุบันทั้งรีโปเหลือ 0 จุด ⇒ ไม่มี false positive */
    re: /![A-Za-z_$][\w$]*\.source(?![.?\w])/g,
    why: '`kpi_definitions.source` เป็น **`not null default \'manual\'`** ⇒ `!d.source` เป็นเท็จเสมอ '
       + '· ต้นเหตุ: migration 20260901 เขียน comment ว่า "null = กรอกมือ" แล้วโค้ดกับ index เชื่อตาม '
       + 'ทั้งที่คอลัมน์ถูกสร้างพร้อม default มาตั้งแต่ 20260824 '
       + '⇒ เกิดจริง 2 จุดพร้อมกัน (พบ 23/09/2026 ตอน kpi_definitions ยังมี 0 แถว จึงไม่มีใครเห็น): '
       + '(1) `KpiMonthly` ตาราง "KPI นอกระบบกรอกมือ" กรองด้วย `!d.source` ⇒ **ว่างตลอดกาล** '
       + 'ต่อให้ตั้ง KPI ไว้กี่ข้อก็ไม่ขึ้น · (2) unique index `where source is not null` '
       + 'คลุมแถวกรอกมือไปด้วย ⇒ ตั้ง KPI ได้ **ส่วนงานละ 1 ข้อ** ข้อที่ 2 ตก 23505 '
       + 'แล้วจอแปลเป็น "KPI นี้ถูกตั้งไว้แล้ว" ซึ่งเป็นคำตอบที่ผิด '
       + '· build/lint/เทส/crashsweep ผ่านหมดทั้ง 2 เคส (mock คืนค่าอะไรก็ได้ ตารางว่างดูเหมือน "ยังไม่มีข้อมูล")',
    fix: "เช็คจากฝั่ง auto เสมอ: `!String(d.source || '').startsWith('auto:')` = แถวกรอกมือ "
       + '(ครอบทั้งแถวเก่าที่เป็น null และแถวใหม่ที่เป็น \'manual\') '
       + '· กฎทั่วไป: **คอลัมน์ที่มี `not null default` ห้ามเช็คด้วย truthiness** — อ่าน default จาก migration ที่ '
       + '*สร้างตาราง* เสมอ อย่าเชื่อ comment ของ migration ที่มาทีหลัง',
    allow: {},
  },
  {
    id: 'kpi-unit-decimals-via-helper',
    scan: ['src'], ext: ['.jsx', '.js'],
    /* จับการอ่าน `…kpi_catalog.unit` / `.decimals` / `.summary_mode` ตรงๆ ในหน้า
       (ทั้ง `?.` และ `.`) — ต้องผ่าน `unitOf`/`decimalsOf`/`summaryModeOf` ของ `kpiSetup.js`
       ตัว helper เองอยู่ใน kpiSetup.js ซึ่ง allow ไว้ · เทสสร้าง object `{ kpi_catalog: {...} }` = ไม่เข้าเงื่อน */
    re: /kpi_catalog\??\.(unit|decimals|summary_mode|value_scope|board_slot)\b/g,
    why: '**หน่วย/ทศนิยม ตั้งได้ 2 ชั้น** (24/09 · user เคาะ "2 ชั้น"): `kpi_catalog` = ค่าตั้งต้น '
       + '· `kpi_definitions.unit`/`.decimals` = override เฉพาะแถวนั้น (ว่าง = ตามทะเบียน) '
       + '⇒ อ่านจากทะเบียนตรงๆ = **แถวที่ตั้งทับไว้ไม่มีผล** (เกิดจริง: MTBF ใบ JIG ใช้ "นาที" '
       + 'แต่เด็คใช้ "ชม." · DSI มี 2 หน่วยทางการ วัน/MB) '
       + '· และ `summary_mode` ถ้าไม่ผ่าน `summaryModeOf` คีย์แปลกจะไม่ถูกปัดเป็น average '
       + '· บั๊กที่มาก่อนหน้านี้: ทั้งระบบ hardcode `maximumFractionDigits: 2` และ '
       + "`unit === 'PPM' ? 0 : 1` ทั้งที่คอลัมน์ `decimals` มีอยู่แล้วแต่ไม่มีจอไหนอ่าน (grep = 0)",
    fix: 'ใช้ `unitOf(d)` · `decimalsOf(d)` · `summaryModeOf(d)` จาก `src/utils/kpiSetup.js` '
       + '(ส่ง "แถว kpi_definitions ที่ embed kpi_catalog มาแล้ว" เข้าไป) '
       + '· จัดรูปตัวเลขด้วย `fmtKpi(v, d)` · สรุป 12 เดือนด้วย `summaryOf(months, d)` '
       + '· 🔴 อย่าลืมใส่ `decimals, summary_mode, value_scope, board_slot` ในสตริง `.select()` ที่ embed `kpi_catalog` '
       + 'ไม่งั้นทุกแถวตกเป็นทศนิยม 2 / วิธีรวม "เฉลี่ย" / ค่าของหน่วยเอง เงียบๆ '
       + '· `value_scope` (30/09) อ่านผ่าน `valueScopeOf(d)` + หานิยามที่ถือค่าด้วย `sharedValueDef(defs, d)` · `board_slot` ผ่าน `boardSlotOf(d)`',
    allow: {
      'src/utils/kpiSetup.js': 'นิยามของ unitOf/decimalsOf/summaryModeOf เอง — เป็นที่เดียวที่อ่านทะเบียนตรงๆ ได้',
    },
  },
  {
    id: 'filelist-copy-before-reset',
    scan: ['src'], ext: ['.jsx', '.js'],
    /* จับการ "เก็บ e.target.files ทั้งก้อนไว้ในตัวแปร" — ของจริงในรีโปทุกจุดหยิบ `[0]` ทันที
       จึงไม่มี false positive · `= [...e.target.files]` (ที่ถูกต้อง) ไม่ match เพราะมี `[` คั่น */
    re: /=\s*\w+\.target\.files\s*[;,)]/g,
    why: '`e.target.files` เป็น **live FileList ที่ผูกกับ input** — พอสั่ง `e.target.value = \'\'` '
       + '(ซึ่งทุกจุดรับไฟล์ต้องทำ ไม่งั้นเลือก "ไฟล์เดิมซ้ำ" แล้ว change ไม่ยิง) ลิสต์จะว่างทันที '
       + '⇒ ตัวแปรที่เก็บไว้กลายเป็นลิสต์เปล่า **แนบไฟล์ไม่ติดสักใบแบบเงียบ ไม่มี error ไม่มี toast** '
       + '· เกิดจริง 22/09/2026 ที่ช่องแนบรูปใน FeedbackModal — build/lint/เทสผ่านหมด '
       + 'เห็นตอนกดจริงในเบราว์เซอร์เท่านั้น',
    fix: "ก๊อปเป็น array ก่อนเสมอ: `const files = [...e.target.files]; e.target.value = '';` "
       + '(หรือหยิบ `e.target.files[0]` ออกมาก่อนแล้วค่อยเคลียร์ แบบที่จุดอื่นในรีโปทำ)',
    allow: {},
  },
  {
    id: 'kpi-score-via-scoreDef',
    scan: ['src/components', 'src/pages', 'src/lib'], ext: ['.jsx', '.js'],
    // จับการเอา statusVsTarget ไปตัดสิน "แถว KPI" (ตัวมันมีแถบผ่อนผัน ±5% ที่เราคิดเอง)
    re: /statusVsTarget\s*\(/g,
    why: 'เกณฑ์ทางการของกลุ่มคือ **ถึง Target = 1 · ถึงแค่ Commitment = 0.5 · ไม่ถึง = 0** '
       + '(หัวคอลัมน์ในประกาศบริษัท QSM-R2 001/2569 เขียนตรงตัว) แต่ statusVsTarget ใช้ "แถบ ±5%" '
       + 'ที่เราคิดขึ้นเอง ⇒ 17/09/2026 วัดจริง: KPI แถวเดียวกันค่าเดียวกันได้ 3 คำตอบจาก 3 จอ '
       + '(KpiMonthly = Y/N ไม่มีขั้น 0.5 · ObeyaKpiBoard = เหลืองจากแถบ ±5% · kpiSetup = 1/0.5/0) '
       + 'และ CLAUDE.md เขียนห้ามไว้ตรงๆ ว่า "ห้ามคิดเกณฑ์สีเอง"',
    fix: 'ใช้ scoreDef(value, defRow) จาก src/utils/kpiSetup.js (อ่านได้ทั้งคอลัมน์ใหม่และ direction/commitment เก่า) '
       + 'แล้ว map sc.status → good/warn/bad/unknown',
    allow: {},   // 23/09: ObeyaKpiBoard ไม่มี statusVsTarget แล้ว (แถบ SQDCM รายวันถูกถอดออก) — ด่านคุมเต็มทั้งไฟล์
  },
  {
    id: 'fetchallrows-returns-object',
    scan: ['src/pages', 'src/components', 'src/utils'], ext: ['.jsx', '.js'],
    /* จับการรับค่า `fetchAllRows(supabase…)` เป็นอาร์เรย์ตรงๆ (ไม่ destructure)
       ผูกกับ `fetchAllRows(supabase` โดยตั้งใจ — `Report.jsx` มีฟังก์ชันชื่อเดียวกันของตัวเอง
       ที่รับ "ตัวสร้างคิวรี" แล้วคืนอาร์เรย์จริง (`fetchAllRows(() => supabase…)`) ห้ามจับผิดตัวนั้น */
    re: /(?:const|let|var)\s+(?!\{)[\w$]+\s*=\s*await\s+fetchAllRows\s*\(\s*supabase/g,
    why: '`src/utils/fetchAllRows.js` คืน **`{ data, error }`** ไม่ใช่อาร์เรย์ (เพราะ supabase-js ไม่ throw '
       + '⇒ ผู้เรียกต้องอ่าน error เอง · กฎเหล็ก DB ข้อ 1) · เอาไปใช้เป็นอาร์เรย์ตรงๆ จะได้ '
       + '`.forEach/.map is not a function` ซึ่งมัก**ถูก try/catch ของหน้ากลืน**กลายเป็น "โหลดข้อมูลไม่สำเร็จ" '
       + 'ทั้งหน้า — เกิดจริง 22/09/2026 ที่ `/mtn-analysis` (ทั้งหน้าใช้ไม่ได้ตั้งแต่ deploy แรก · '
       + 'build ผ่าน · lint ผ่าน · เทสผ่าน · crashsweep ผ่าน เพราะ error ถูกกลืนไปโชว์เป็นกล่องแดง)',
    fix: 'const { data, error } = await fetchAllRows(...) แล้วเช็ค error ก่อนใช้ data '
       + '(ใน Promise.all ให้ destructure ตอนอ่านผล เช่น `const rows = res?.data || []`)',
    allow: {
      /* 2 ตัวนี้รับเป็นตัวแปรก้อนเดียวโดยตั้งใจ เพราะต้อง **ลองใหม่เมื่อ error** (คอลัมน์ใหม่ยังไม่ apply
         migration → 42703) แล้วค่อยอ่าน `r.data` — ตรวจแล้วทั้งคู่อ่าน `r.error` จริงก่อนใช้ `r.data` */
      'src/utils/useMachines.js': 'let r = ... แล้วเช็ค r.error เพื่อ fallback ชุดคอลัมน์ ก่อนใช้ r.data (ถูกต้องแล้ว)',
      'src/utils/useProducts.js': 'let r = ... แล้วเช็ค r.error เพื่อ fallback ชุดคอลัมน์ ก่อนใช้ r.data (ถูกต้องแล้ว)',
    },
  },
  {
    id: 'mo-step-branch-via-stage',
    scan: ['src/pages', 'src/components'], ext: ['.jsx', '.js'],
    /* จับการแตกสาขาด้วย "เลขขั้น" ของใบ MO ตั้งแต่ขั้น 5 ขึ้นไป (ขั้น 1-4 ตรงกันทั้ง 2 ฟอร์ม)
       เช่น `step === 5` · `step === 7` · `next.step === 6` */
    re: /\b(?:\w+\.)?step\s*===\s*[5-9]\b/g,
    why: 'ใบ MO มี 2 ฟอร์มที่ "เลขขั้นเดียวกันคนละความหมาย" — ขั้น 5 = ตรวจคุณภาพ (QA) ของ JIG/DIE '
       + 'แต่ = รับมอบ ของฟอร์ม MTN · ขั้น 7 = ปิดใบ ของ JIG/DIE แต่ = ผจก.ช่างอนุมัติ ของ MTN '
       + '⇒ โค้ดที่ผูกกับเลขขั้นจะเขียนคนละคอลัมน์/โชว์คนละฟอร์ม **เงียบๆ** ทันทีที่ลำดับขยับ '
       + '(เกิดจริง 2 รอบใน 1 สัปดาห์: 15/09/2026 ช่องเซ็นที่ 5 ของใบพิมพ์ถูกเติมด้วย checker_name '
       + 'ซึ่งเป็นคนฝั่งผู้แจ้ง — 6 จาก 8 ใบเป็นคนเดียวกับผู้เปิดใบ · 22/09/2026 ลำดับปิดใบสลับหัวท้าย)',
    fix: 'ใช้ stageOf(step, { mtnForm }) จาก src/utils/mtnStepPerm.js แล้วเทียบกับชื่อจังหวะงาน '
       + "('qa' · 'handover' · 'mtn_head' · 'mtn_approve' · 'cost_mgr_close' · 'close') — เลขขั้นไว้โชว์อย่างเดียว",
    allow: {},
  },
  {
    id: 'kpi-level-not-boolean',
    scan: ['src'], ext: ['.jsx', '.js'],
    // จับ ternary บนตัวแปรระดับคะแนนโดยตรง เช่น `yn ? 'Y' : 'N'` / `lv ? 'Y' : 'N'`
    re: /\b(yn|ynTot|ynTotal|lv|level)\s*\?\s*['"]Y['"]\s*:\s*['"]N['"]/g,
    why: 'ระดับคะแนน KPI เป็น 1 / 0.5 / 0 ไม่ใช่ boolean — **0.5 เป็นค่า truthy** '
       + '⇒ ใบที่ได้แค่ครึ่งคะแนน (ถึง Commitment แต่ไม่ถึง Target) จะถูกพิมพ์เป็น "Y" สีเขียว '
       + 'เหมือนผ่านเต็ม ทั้งบนจอและในไฟล์ Excel ฟอร์ม FM-HRM-6-022 ที่ส่งให้ QSM',
    fix: "เทียบด้วย === 1 / === 0.5 เสมอ · สัญลักษณ์ทางการ ○ Achieve (1) · △ Improvement (0.5) · ✗ Miss goal (0)",
    allow: {},
  },
  {
    id: 'open-order-filter-via-openOnly',
    scan: ['src'], ext: ['.jsx', '.js'],
    // จับตัวกรอง "งานค้าง" ที่เขียนเองด้วย shipped ตรงๆ ทั้งฝั่งคิวรีและฝั่ง JS
    re: /\.neq\(\s*['"]status['"]\s*,\s*['"]shipped['"]\s*\)/g,
    why: 'ทั้งระบบเคยนิยาม "งานค้าง" ด้วย neq(status,shipped) กระจาย 7 จุด ⇒ พอเพิ่มสถานะปิดใหม่ '
       + '(cancelled — ใบที่ลูกค้ายกเลิก/ใบผี) **ตกไปจุดเดียว = ใบที่ปิดแล้วยังโผล่แดงอยู่จอนั้นเงียบๆ** '
       + 'ซึ่งเป็นเหตุผลเดียวที่ก่อนหน้านี้ไม่กล้าเพิ่มสถานะ เลยต้องลบข้อมูลทิ้งแทน (25/09/2026)',
    fix: 'ใช้ openOnly(query) / isOpenOrder(row) จาก src/utils/shipStatus.js — เจ้าของเดียวของนิยาม "ยังเป็นงานค้าง"',
    allow: { 'src/utils/shipStatus.js': 'ตัว helper เอง' },  },
  {
    id: 'actor-identity-via-setActor',
    scan: ['src'], ext: ['.jsx', '.js'],
    re: /setDrActorName\s*\(/g,
    why: 'setDrActorName ตั้งได้แค่ "ชื่อ" ไม่มี uid ⇒ ตัวตนผู้ใช้ขาดคีย์ที่นับ/join ได้ '
       + 'ซึ่งเป็นต้นเหตุเดิมที่ทำให้ตอบไม่ได้ว่า "งานนี้มีคนทำจริงกี่คน" '
       + '(วัดจริง 16/09/2026: คนเดียวกันถูกนับเป็นหลายคนเพราะทะเบียนคนพิมพ์มือคนละชุด — '
       + '"อภิสิทธิ์ จำปาต้า" ใน profiles vs "นายอภิสิทธิ์ จำปาต้น" ใน mtn_technicians)',
    fix: 'ใช้ setActor(uid, name) จาก src/utils/actorStamp.js — เจ้าของเดียวของ "ใครกำลังทำงาน"',
    allow: { 'src/supabaseClient.js': 'ตัว shim backward-compat เอง (ส่งต่อให้ setActor)' },
  },
  {
    id: 'people-index-single-owner',
    scan: ['src'], ext: ['.jsx', '.js'],
    re: /setPeopleIndex\s*\(/g,
    why: 'ทะเบียน "ชื่อ → uid" มีเจ้าของได้คนเดียว — ป้อนจากหลายที่ = ทะเบียนทับกันเอง '
       + 'แล้ว uid ที่ stamp ลงแถวจะต่างกันตามลำดับการโหลดของแต่ละหน้า (บทเรียนเดียวกับตัวตนผู้ใช้ที่เคยมี 2 เจ้าของ)',
    fix: 'ป้อนที่ loadProfilesPeople() ใน src/utils/usePeople.js ที่เดียว — มันคือฟังก์ชันเดียวที่ผลิตรายชื่อ profiles ทั้งแอป',
    allow: {
      'src/utils/usePeople.js': 'เจ้าของที่ตั้งใจให้ป้อน',
      'src/utils/actorStamp.js': 'ตัวฟังก์ชันเอง',
      'src/utils/__tests__/actorStamp.test.mjs': 'เทส',
    },
  },
  {
    id: 'bom-tree-via-buildBomIndex',
    scan: ['src'], ext: ['.jsx', '.js'],
    // จับ pattern "หาตัวแม่ของบรรทัด BOM เอง" = matOf[b.product_id] / matOfProd[x.product_id] ฯลฯ
    re: /\w*[mM]at[A-Za-z]*\s*\[\s*\w+\.product_id\s*\]/g,
    why: 'ประกอบต้นไม้ BOM เองด้วย product_id ⇒ **ตัวแม่ต้องเป็นแถว dr_products เท่านั้น** '
       + 'ของที่อยู่แค่ parts_master เลยเป็นใบไม้ตลอดกาล — วัดจริง 16/09/2026: 506 แถว/98 สินค้า '
       + 'มีแค่ 57 แถว (11%) ที่ลูกมี BOM ต่อ ⇒ ~90% ถูกตรึงชั้นเดียว "แก้ชั้นไม่ได้" '
       + 'และตั้งแต่มีคอลัมน์ parent_mat แล้ว การเขียนเองจะ**มองข้ามชั้นที่คนตั้งไว้เงียบๆ**',
    fix: 'ใช้ buildBomIndex(rows, matOfProduct) จาก src/utils/bomTree.js แล้วอ่านผ่าน ix.bomOf / ix.parentOf',
    allow: { 'src/utils/bomTree.js': 'ตัว helper เอง (นิยาม parentOf อยู่ที่นี่)' },
  },
  {
    id: 'explode-bom-needs-sheetFor',
    scan: ['src'], ext: ['.jsx', '.js'],
    // จับ explodeBom(root, bomOf) ที่ไม่ได้ส่ง { sheetFor } — ตัดคอมเมนต์แล้วดูในบรรทัดเดียวกัน
    re: /explodeBom\s*\((?![^)]*sheetFor)/g,
    why: 'ต้นไม้ BOM ระเบิด — `parent_mat` เก็บเป็น **mat** ไม่ใช่ id ⇒ ค่าเดียวกันไปโผล่ในใบของ FG '
       + 'หลายตัวได้ (วัดจริง 21/09/2026: 20058693 ถูกตั้งเป็นตัวแม่ใน 6 ใบ · 20058626 ใน 7 ใบ) '
       + 'ถ้าดึงลูกด้วย mat เฉยๆ = กางลูกของ *ทุกใบ* มารวมกัน ⇒ 10101158 ที่มี 22 พาร์ท '
       + 'กางออกมา **1,276 แถว ลึก 5 ชั้น** จอใช้ไม่ได้ + ปุ่มลบ "แถวนับซ้ำ" ตัดสินจากต้นไม้ที่ผิด',
    fix: 'const ix = buildBomIndex(rows, matOf); explodeBom(root, ix.bomOf, { sheetFor: ix.sheetFor })',
    allow: { 'src/utils/bomTree.js': 'ตัวนิยามฟังก์ชันเอง' },
  },
  {
    id: 'carry-qty-must-include-imported',
    scan: ['src'], ext: ['.jsx', '.js'],
    // จับลิสต์สถานะใบผลิตที่ "นับยอดที่ทำได้" แต่ลืม imported
    re: /\[\s*'open'\s*,\s*'carry_over'\s*,\s*'cancelled'\s*\]/g,
    why: 'ลิสต์สถานะที่นับยอดผลิตแต่**ไม่มี `imported`** ⇒ พอกะถัดไปกด "รับยอดค้าง" ใบเดิมกลายเป็น '
       + 'imported แล้วยอดที่ทำได้ในกะนั้นหายจากสูตรทันที · เกิดจริง 16/09/2026 (หัวหน้ากลุ่ม Assy2 จับได้): '
       + 'Assy LWR 15/09 กะเช้า ตอนขอปิดกะนับ 384 ชิ้น → SV อนุมัติเช้าวันถัดไป (ใบถูก import ไปแล้ว) '
       + 'เหลือ 352 ⇒ %P 86.18 → 79.00 · OEE 72.00 → 66.00 ทั้งที่ actual_qty ในแถวเดียวกันยังเป็น 384',
    fix: "เติม 'imported' เข้าลิสต์ (ยอดอยู่ที่ qty_actual ของใบเดิม · ใบสืบทอดถือแค่ส่วนที่เหลือ ไม่ซ้ำซ้อน) "
       + 'หรือใช้ orderProducedQty() จาก src/utils/oee.js §6',
    allow: {},
  },
  {
    id: 'storage-locations-via-loader',
    scan: ['src'], ext: ['.jsx', '.js'],
    re: /\.from\(\s*'storage_locations'\s*\)\s*\n?\s*\.select\(/g,
    why: 'ทะเบียนรหัสคลังเป็น master ที่แทบไม่เปลี่ยน แต่ 3 หน้ายิงตรงด้วย**ชุดคอลัมน์ของตัวเอง** '
       + 'ทั้งที่มี loader + cache กลางอยู่แล้ว (มันไม่มี `line_names` คนเลยยิงเองแทนที่จะเติมเข้า loader) '
       + '⇒ วัดจริง 21/09/2026: `storage_locations` โดน **850 ครั้งในครึ่งวัน** '
       + '(บั๊กคลาสเดียวกับ invalidate* ที่เขียนไว้แล้วไม่มีใครเรียก — ของกลางมีอยู่แต่ถูกข้าม)',
    fix: 'ใช้ loadStorageLocations() จาก src/utils/useStorageLocations.js · '
       + 'ต้องการคอลัมน์เพิ่ม → **เติมใน loader แล้ว bump คีย์ cache** (shape เปลี่ยนแต่คีย์เดิม = '
       + 'เครื่องที่มี cache เก่าค้างได้แถวขาดคอลัมน์ไปอีก 4 ชม. แบบเงียบๆ)',
    allow: {
      'src/utils/useStorageLocations.js': 'ตัว loader เอง',
      'src/components/StorageLocPanel.jsx': 'แผงจัดการทะเบียน (CRUD) — ต้องเห็นแถวดิบครบรวม inactive',
      'src/pages/LineSetup.jsx': 'ตามแก้ line_names ตอนเปลี่ยนชื่อไลน์ (เขียน ไม่ใช่อ่านเพื่อแสดง)',
    },
  },
  {
    id: 'no-select-star-on-wide-hot-tables',
    scan: ['src'], ext: ['.jsx', '.js'],
    /* จับ `.from('<ตารางอ้วน>').select('*')` — เว้นวรรค/ขึ้นบรรทัดระหว่างกันได้
       ทะเบียนตารางในกฎนี้ = ตารางที่ **คอลัมน์เยอะ + ถูกดึงซ้ำทั้งวันจากหลายเครื่อง** เท่านั้น
       (ไม่ใช่ทุกตาราง — ทะเบียน master เล็กๆ `select('*')` ได้ตามปกติ ไม่ต้องมาขึ้นด่านนี้) */
    re: /\.from\(\s*'(mtn_orders|prod_orders)'\s*\)\s*\n?\s*\.select\(\s*'\*'/g,
    why: 'ตารางกว้าง (mtn_orders = **116 คอลัมน์** · prod_orders = **33**) ที่จอเปิดค้างทั้งวันดึงซ้ำ ⇒ egress ระเบิด · '
       + 'วัดจริง 16/09/2026: `mtn_orders?select=*&limit=1000` = **1.59 MB/ครั้ง** (บีบแล้ว ~452 KB) '
       + 'ยิงวันละ **1,389 ครั้ง** ⇒ **~628 MB/วัน = เกือบครึ่งของ egress ฝั่ง DR ทั้งหมดจากคิวรีเดียว** '
       + '· โควต้า Supabase Free = 5 GB/เดือน ⇒ คิวรีนี้ตัวเดียวกินหมดโควต้าใน ~8 วัน '
       + '(เคยโดนล็อกบริการทั้ง organization มาแล้วจาก egress เกิน — ทั้งโรงงาน login ไม่ได้)',
    fix: "จอรายการ = เลือกคอลัมน์ที่ใช้จริง (ดู MO_LIST_COLS ใน src/pages/MtnRepair.jsx) · "
       + "รายละเอียดใบเต็มค่อยดึงตอนเปิดใบทีละใบด้วย .select('*').eq('id', id)",
    allow: {
      'src/pages/MtnRepair.jsx': 'ใบเดียวตอนเปิดดู/หลังบันทึก (fetchFullOrder + .eq(id)) — ไม่ใช่ทั้งตาราง',
      'src/pages/PMCheckData.jsx': 'insert(...).select() คืนแถวที่เพิ่งสร้าง 1 แถว',
      'src/lib/monthlyReviewPptx.js': 'รายงานรายเดือน กดเองปีละไม่กี่ครั้ง ไม่ใช่จอเปิดค้าง',
      'src/pages/OrderTrace.jsx': 'สอบกลับใบเดียวตามที่ผู้ใช้ค้น ไม่ใช่ทั้งตาราง',
      /* 🔸 2 ไฟล์ล่าง: prod_orders เท่านั้น — ตั้งใจไม่ตัดคอลัมน์ (ตัดสินไว้แล้ว 25/09 ห้ามรื้อซ้ำ)
         DailyReport.loadProdOrders = ใบของ **กะที่เลือกกะเดียว** (ไม่กี่สิบแถว) แต่หน้านี้เป็นจอแก้ไข
         ที่อ่าน/เขียนเกือบทุกคอลัมน์ ⇒ ตัดคอลัมน์แล้วพลาดไป 1 ตัว = ยอด/เป้า/ยอดยกเพี้ยนเงียบ
         — ได้ไม่คุ้มเสี่ยง · ส่วนคิวรี "ยอดค้าง 8 กะก่อนหน้า" ในไฟล์เดียวกัน **ตัดไปแล้ว** (CARRY_COLS)
         ⚠️ ด่านนี้จึงมองไม่เห็นถ้าใครเผลอเปลี่ยน CARRY_COLS กลับเป็น '*' — มีคอมเมนต์เตือนคาไว้ที่นั่น */
      'src/pages/DailyReport.jsx': 'จอแก้ไขใบผลิตของกะที่เลือก — ใช้เกือบทุกคอลัมน์ (ดูเหตุผลเต็มด้านบน)',
      'src/pages/MorningMeeting.jsx': 'บอร์ดประชุมเช้า เปิดวันละครั้ง ไม่ใช่จอเปิดค้าง',
    },
  },
  {
    id: 'webp-tobiob-needs-type-check',
    scan: ['src'], ext: ['.jsx', '.js'],
    /* จับการขอ WebP จาก canvas — `toBlob(cb, 'image/webp', q)` (รับช่องว่าง/ขึ้นบรรทัด) */
    re: /toBlob\([\s\S]{0,400}?['"]image\/webp['"]/g,
    why: 'เบราว์เซอร์ที่เขียน WebP ไม่ได้ (Safari < 16.4) **ไม่ throw และไม่คืน null** — '
       + 'มันคืน **PNG เงียบๆ** ⇒ ถ้าโค้ดเชื่อว่าได้ webp แล้วตั้งนามสกุล `.webp` เอง '
       + 'จะได้ไฟล์ PNG ที่ชื่อ .webp: ใหญ่กว่าเดิม (PNG = lossless) และ Content-Type ผิด '
       + '⇒ งานลด egress กลายเป็นเพิ่ม egress โดยไม่มีใครเห็น (ไม่มี error ให้จับ)',
    fix: 'ใช้ตัวกลางที่เช็คให้แล้ว: <ImageCropModal webp> · resizeImage(f,px,q,{webp:true}) + imgExt(blob) · '
       + 'compressToWebp() ใน src/utils/layoutImage.js — ถ้าจำเป็นต้องเรียก toBlob เอง '
       + '**ต้องเทียบ `blob.type === "image/webp"` ก่อนใช้ และถอยไป JPEG เมื่อไม่ตรง** '
       + 'แล้วเอานามสกุลจาก blob.type เท่านั้น ห้าม hardcode',
    allow: {
      'src/components/ImageCropModal.jsx': 'emit() เทียบ blob.type แล้วถอยไป JPEG · ตั้งนามสกุลจากชนิดที่ได้จริง',
      'src/utils/resizeImage.js': 'draw() เทียบ b.type === "image/webp" แล้วถอยไป JPEG · imgExt() อ่านจาก blob.type',
    },
  },
  {
    id: 'lines-via-cached-loader',
    scan: ['src'], ext: ['.jsx', '.js'],
    /* จับ "อ่านทะเบียนไลน์เองแทนที่จะใช้ cache กลาง" — ทุกแบบ ไม่ใช่แค่ที่ใช้ LINE_COLUMNS
       (25/09: ด่านรอบแรกจับแต่ `select(LINE_COLUMNS)` ⇒ จุดที่ตั้งชุดคอลัมน์เองรอดไปหมด
        ซึ่งเป็นตัวใหญ่จริง — 4,170 จาก 4,594 ครั้ง/วัน) */
    re: /from\(\s*'production_lines'\s*\)\s*\.select\(/g,
    why: 'audit 07/09/2026 ทำให้ทุกหน้าใช้ `LINE_COLUMNS` ชุดเดียวกันแล้วจริง **แต่ยังยิง DB เองทุกจุด** '
       + '⇒ "คอลัมน์ตรงกัน" กับ "ยิงครั้งเดียว" เป็นคนละเรื่อง · วัดจริง 23/09/2026: '
       + '`production_lines` โดน **4,041 ครั้ง/วัน** จาก **107 จุด** ที่ select เองทั่วรีโป '
       + '(ตารางนี้มีแค่ ~50 แถว และแทบไม่เปลี่ยน — ควรโหลดครั้งเดียวแล้วแชร์) '
       + '· กับดักซ้อน: พอขยาย LINE_COLUMNS เป็น superset จุดที่ยังยิงเองจะ**หนักขึ้น**ทุกจุด '
       + 'ทั้งที่ตั้งใจจะลด (เจอจริงตอนแก้ 25/09 — ต้องกวาดให้จบในคอมมิทเดียวกัน)',
    fix: 'ใช้ loadLinesRes() (รูปแบบ { data, error } สลับได้บรรทัดเดียว) หรือ loadProductionLines() / '
       + 'hook useProductionLines() จาก src/utils/useProductionLines.js · '
       + 'ต้องการคอลัมน์เพิ่ม → **เติมใน LINE_COLUMNS + bump คีย์ cache** อย่าต่อท้ายที่จุดเรียก '
       + '(ต่อท้ายแล้วได้คอลัมน์ซ้ำใน querystring ด้วย) · ลำดับต่างจาก order by name → เรียงเองฝั่งจอ',
    allow: {
      'src/utils/useProductionLines.js': 'ตัว loader เอง',
      'src/pages/Report.jsx': 'จุดเดียวที่ต้องการ head_name ซึ่งไม่อยู่ใน LINE_COLUMNS (ไม่มี dropdown ไหนใช้)',
      'src/pages/LineSetup.jsx': 'หน้าแก้ทะเบียนไลน์เอง — ต้องเห็นของสดหลังบันทึกทันที + probe ว่าคอลัมน์มีจริงไหม',
    },
  },
  {
    id: 'no-setSearchParams-object',
    scan: ['src'], ext: ['.jsx', '.js'],
    re: /setSearchParams\s*\(\s*\{/g,
    why: 'ล้าง URL param อื่นทิ้งหมด รวม ?tab= ของหน้าแม่ ⇒ จอเด้งออกจากแท็บที่ใช้อยู่ '
       + '(เกิดจริง 16/09/2026: /pm?tab=setup กดแท็บส่วนงานแล้วเด้งไป "ตรวจอุปกรณ์" · เจอซ้ำ 3 หน้า)',
    fix: "ใช้ useMergeParams() จาก src/utils/useTabParam.js — setParams({ dept: d }) · ล้างตัวเดียวด้วย { equip: null }",
    allow: { 'src/utils/useTabParam.js': 'ตัว helper เอง' },
  },
  {
    id: 'no-utc-workdate',
    scan: ['src'], ext: ['.jsx', '.js'],
    /* ⚠️ เดิมจับแค่รูป `new Date().toISOString().slice` — **แคบเกินไป** ด่านจึงมองไม่เห็น
       2 เคสที่หลุดจริง (QC 06/10): `new Date(Date.now() - n).toISOString().slice(0,10)` (CtReview)
       และ `d.toISOString().slice(0,10)` ที่ `d` มาจาก parse แบบ `+07:00` (MonitorFgSync — คลาด 1 วันทุก TZ)
       ⇒ จับ "ปิดท้ายด้วย toISOString().slice(0,10)" ทั้งหมด ไม่สนว่าตัวรับคืออะไร */
    re: /\.toISOString\(\)\s*\.slice\(\s*0\s*,\s*10/g,
    why: 'toISOString() อ่านฝั่ง UTC ⇒ ถ้าขาเข้าไม่ใช่ UTC ล้วน จะคลาดวันแบบเงียบ '
       + '(ช่วง 00:00-06:59 เวลาไทยได้ "วันก่อนหน้า" · วัด 06/10: MonitorFgSync ผสม parse +07:00 กับ output UTC '
       + 'แล้ว addDays(today, 0) คืน "เมื่อวาน" ⇒ หน้าต่างสแกน FG เลื่อนไป 1 วันทุกครั้ง)',
    fix: 'วันนี้/วันงาน = getWorkDate() · บวกลบวัน = addDaysStr() ทั้งคู่ใน src/utils/workDate.js '
       + '(UTC ล้วนทั้งขาเข้า-ออก) · แปลง Date เป็นสตริงวันที่ = localDateStr() / todayLocal()',
    allow: {},
  },
  {
    id: 'no-color-mix',
    scan: ['src'], ext: ['.jsx', '.js', '.css'],
    re: /color-mix\s*\(/g,
    why: 'ต้องใช้ Chromium 111+ แต่จอ TV หน้างาน (LG webOS 23) = Chromium 94 ⇒ ทั้งบรรทัด declaration ถูกทิ้ง '
       + 'พื้นการ์ดกลายเป็นโปร่ง (เคยหลุดจริงที่ StoreMonitor)',
    fix: "ใช้ alpha-hex `${color}14` หรือ backgroundImage: linear-gradient(c14, c14) ทับบน var(--card)",
    allow: {},
  },
  {
    id: 'no-viewport-dvh',
    scan: ['src'], ext: ['.jsx', '.js', '.css'],
    re: /\b\d+(\.\d+)?(dvh|svh|lvh)\b/g,
    why: 'หน่วย dvh/svh/lvh ต้องใช้ Chromium 108+ — เพดานจอ TV ที่ต้องรองรับคือ 94',
    fix: 'ใช้ vh หรือคำนวณความสูงด้วย flex/grid แทน',
    allow: {},
  },
  {
    id: 'no-css-container-query',
    scan: ['src'], ext: ['.jsx', '.js', '.css'],
    re: /@container\b/g,
    why: '@container ต้องใช้ Chromium 105+ — เพดานจอ TV = 94',
    fix: 'ใช้ breakpoint ปกติ (useIsMobile / media query)',
    allow: {},
  },
  {
    id: 'no-replica-identity-full',
    scan: ['supabase/migrations'], ext: ['.sql'],
    re: /replica\s+identity\s+full/gi,
    why: 'ทำให้ทุก UPDATE/DELETE ส่ง row เต็มผ่าน realtime = ค่า egress พุ่ง (กฎเหล็กข้อ 7 ใน CLAUDE.md) '
       + 'ปัญหาจริงคือ DELETE กรองด้วยคอลัมน์ที่ไม่ใช่ pk ไม่ได้ — ห้ามแก้ด้วยวิธีนี้',
    fix: 'แยก subscribe DELETE แบบไม่กรอง แล้วกรองฝั่ง client แทน',
    allow: {},
  },
  {
    id: 'capacity-shiftmin-must-be-net',
    scan: ['src'], ext: ['.jsx', '.js'],
    // จับการส่ง "เวลากะดิบ" เข้าสูตรกำลังผลิต — ต้องหักพักตามนโยบายก่อนเสมอ
    /* ยกเว้นบรรทัดที่เรียก `policyBreakForShift` — ตัวนั้น**ต้อง**รับกรอบเวลาดิบไปหาว่าพักกี่นาที
       (tempered pattern: ห้ามมีคำนั้นอยู่ก่อนในบรรทัดเดียวกัน) */
    re: /^(?:(?!policyBreakForShift).)*shiftMin\s*:\s*DEFAULT_SHIFT_MIN\b/g,
    why: '`estimateCapacity` คิด `(shiftMin×60 ÷ CT) × lineOee` แต่ `lineOee` วัดบน netAvail '
       + '(= elapsed − plannedDT − **breakMin**) คือหักเวลาพักไปแล้ว ⇒ เอาไปคูณเวลากะดิบ = '
       + 'กำลังผลิตเฟ้อ · วัดจริง 22/09/2026: พักกะเช้า 80 นาที ⇒ ฐานที่ถูก 490 ไม่ใช่ 570 = '
       + '**เฟ้อ 16.3%** กระทบ 19/36 พาร์ทที่มี demand (53%) ซึ่งประวัติ < 3 กะจึงตกมาทางสูตรนี้ '
       + 'และทิศทางนี้อันตราย: กำลังเฟ้อ = วางแผนน้อยกว่าที่ต้องใช้ = ของไม่ทันส่ง',
    fix: 'shiftMin: netShiftMin(DEFAULT_SHIFT_MIN, policyBreakForShift({ policies, shift, shiftMin, workDate })) '
       + '— เวลาพักมีเจ้าของที่ src/utils/oee.js ที่เดียว ห้ามตั้งรายการพักเองในหน้า',
    allow: {},
  },
  {
    id: 'edi-headers-from-registry',
    scan: ['src/pages'], ext: ['.jsx', '.js'],
    // จับการหยิบชื่อคอลัมน์ค่าสำรองไปใช้ในหน้า แทนที่จะใช้พจนานุกรมจากทะเบียน
    re: /\b(EDI_SIG|TIME_HDRS|DOCK_HDRS|FALLBACK_EDI_DICT)\b/g,
    why: 'ชื่อหัวคอลัมน์ของไฟล์ลูกค้าเคย hardcode อยู่ในโค้ด ⇒ **ลูกค้าเจ้าใหม่ = แก้โค้ด + deploy** '
       + 'วัดจริง 22/09/2026: ความต้องการเข้าระบบได้แค่ทางตระกูล Ford (830/862/e-SMART) ⇒ '
       + '72 จาก 115 พาร์ท active ไม่มี order/forecast ในระบบเลย (TSRA 28 · TSPK 15 ที่เป็น FG ทั้งหมด · '
       + 'ISUZU RT50 · GWM · TSESA) ⇒ 10 จาก 22 ไลน์หายจากแผนผลิตทั้งไลน์แบบไม่มีคำเตือน',
    fix: 'โหลดแถวจาก customer_pull_formats (kind = order/forecast) แล้วใช้ buildEdiDict(rows) + '
       + 'sigOf(dict) จาก src/utils/ediDetect.js — ค่าสำรองในโค้ดถูกรวมให้อยู่แล้ว '
       + 'เพิ่มลูกค้าใหม่ = เพิ่มแถวที่แผง 🧩 ฟอร์แมตไฟล์ลูกค้า ไม่ต้อง deploy',
    allow: {},
  },
  {
    id: 'plan-demand-via-explodeDemand',
    scan: ['src/pages'], ext: ['.jsx', '.js'],
    // จับการเขียน "ระเบิด BOM" เองในหน้า (เรียก explodeBom ตรงๆ เพื่อรวมความต้องการ)
    re: /explodeBom\s*\([^)]*\)\s*\.rows/g,
    why: 'การระเบิดความต้องการลง BOM มีกติกาที่พลาดง่าย 3 ข้อ: ① ต้องต่อโซ่แบบ SAP '
       + '(ข้ามแถวชั้น 1 ที่เป็นสำเนาแบนของหลาน ไม่งั้นนับซ้ำ 2-3 เท่า — ของจริงมี 17 ตัวแม่) '
       + '② ความต้องการของลูก = ลูกค้าสั่งตรง **บวก** ที่ระเบิดมา ห้ามแทนกัน '
       + '(22/09: ลูกค้าสั่งพาร์ท 2xxxxxxx ตรงๆ อยู่แล้ว 687 แถว/18 mat) ③ หน่วย PC/KG ห้ามปนกัน',
    fix: 'ใช้ explodeDemand(demand, ix, explodeBom) จาก src/utils/demandExplode.js '
       + '(คืน needByMat + flatDupes + cycles ให้ครบ) แล้วกรองเฉพาะ mat ที่มีไลน์ผลิตจริง',
    allow: {},
  },
  {
    id: 'status-color-gradient-mix',
    scan: ['src', 'audit'], ext: ['.jsx', '.js', '.css'],
    /* จับไล่เฉดที่ผสม "สีสถานะ" มากกว่า 1 เฉด — ตัด `repeating-linear-gradient` ออกด้วย lookbehind
       เพราะลายขีด 45° (พัก/หยุดตามแผน) ใช้สีเดียวคนละ alpha = สื่อความหมาย ไม่ใช่ของตกแต่ง */
    re: /(?<!repeating-)linear-gradient\([^)]*#(?:3dd65c|22c55e|ef4444|e74c3c|f59e0b)[0-9a-fA-F]{0,2}\s*[,)][^)]*#(?:3dd65c|22c55e|ef4444|e74c3c|f59e0b|ff6b6b)/g,
    why: 'เขียว/เหลือง/แดง ถูกจองไว้แปลว่า **ปกติ / เฝ้าระวัง / มีปัญหา** ทั้งระบบ (Andon + ไฟ KPI) — '
       + 'เอามาไล่เฉดเป็นของตกแต่ง = ยิงสัญญาณปลอมใส่คนที่ถูกฝึกมาให้มองสีก่อนอ่านตัวหนังสือ · '
       + 'เกิดจริง 23/09: อักษรย่อโปรไฟล์บน sidebar เป็น `linear-gradient(135deg, var(--accent), #ff6b6b)` '
       + '= เขียว→แดงไล่เฉด อยู่บนจอเดียวกับไฟ Andon จริง (พบตอนรีเช็คทั้งโปรเจคตาม brief De-AI UI)',
    fix: 'ใช้พื้นเรียบ + เส้นขอบ (`var(--bg2)` + `var(--border2)`) · ถ้าต้องการสีที่ "แปลว่าอะไร" จริงๆ '
       + 'ให้มาจาก statusColor()/toneInk() ใน src/utils/statusTone.js เท่านั้น',
    allow: {},
  },
  {
    id: 'status-palette-single-source',
    scan: ['src/pages', 'src/components', 'src/utils'], ext: ['.jsx', '.js'],
    // จับการประกาศ "ตารางสีสถานะ" ชุดใหม่ในไฟล์อื่น (good/warn/bad → hex ตรงๆ)
    re: /\b(?:good|warn|bad|crit|ok)\s*:\s*'#[0-9a-fA-F]{6}'/g,
    why: 'ตารางสีสถานะต้องมีชุดเดียวทั้งระบบ (`STATUS_COLOR` ใน src/utils/statusTone.js) — '
       + 'แตกชุดใหม่เมื่อไหร่ จอคนละหน้าจะใช้ "แดง" คนละเฉดแล้วคนอ่านนึกว่าเป็นคนละความหมาย · '
       + 'วัดจริง 23/09 ตอนรีเช็คทั้งโปรเจค: มีแดงอยู่ **4 เฉด** ปนกัน '
       + '(#ef4444 · #e74c3c · #e5484d · #e05c4a) และเหลือง 2 เฉด (#f59e0b · #f59a3f) '
       + 'และบางที่ใช้ var(--accent) เป็น "good" แทน #22c55e ⇒ เขียวคนละเฉดในจอเดียวกัน',
    fix: 'import { statusColor, toneOf, toneInk } from src/utils/statusTone.js แล้วใช้ tone '
       + "('good'|'warn'|'bad'|'none') แทนการตั้ง hex เอง · 🔴 ไม่มีเป้าให้เทียบ = 'none' (เทา) ห้ามเขียว",
    allow: {
      /* 🧾 หนี้ที่รู้ตัวแล้ว (23/09) — ด่านนี้ตั้งไว้กัน "ของใหม่" ก่อน ส่วน 6 จุดนี้รอกวาดในก้อนถัดไป
         ทุกตัวเป็นตารางสีสถานะของตัวเอง ซึ่งควรย้ายมาใช้ statusTone ทั้งหมด */
      'src/components/LineWipPanel.jsx': 'TONE ของแผง WIP — รอย้ายมา statusTone',
      'src/components/StorageZonePanel.jsx': 'CAT_COLOR ของโซนคลัง (มี #e5484d = แดงเฉดที่ 3) — รอย้าย',
      'src/components/BomTreeView.jsx': 'TONE ของต้นไม้ BOM — รอย้าย',
      'src/components/CapaEffectiveness.jsx': 'ชุดสีใน c = {...} — รอย้าย',
      'src/utils/pmUsage.js': 'USAGE_LEVELS มี 4 ระดับ (ok/warn/due/over) ไม่ตรงกับ 4 ระดับของ statusTone — ต้องตัดสินใจว่าจะ map ยังไงก่อนย้าย',
      'src/pages/FactoryMap.jsx': 'stColor ของ popup โซน — ผังใช้ cat ของตัวเอง (good/ok/bad/idle) รอ map เข้ากับ tone',
      'src/components/QaFmeBoard.jsx': 'C = {...} 7 สถานะของใบ FME (late/pending/acked/ok/ng/…) กว้างกว่า 4 ระดับของ statusTone — ต้องตัดสินใจ map ก่อนย้าย',
      'src/pages/PMCheckData.jsx': 'PIN_STATUS_COLOR — มี #e05c4a (แดงเฉดที่ 4) + #f59a3f (เหลืองเฉดที่ 2) รอย้าย',
      /* 🔴 ไฟล์เจ้าของนิยาม — ต้องประกาศ hex ที่นี่ ไม่งั้นไม่มีใครเป็นต้นทาง */
      'src/utils/statusTone.js': 'ไฟล์นี้คือ single source ของ STATUS_COLOR เอง',
    },
  },
  {
    id: 'module-identity-not-status-hue',
    scan: ['src/pages', 'src/components'], ext: ['.jsx'],
    /* ทะเบียน "สีประจำหมวด/โมดูล" ในระบบนี้เขียนเป็น `{ code: …, color: '#xxxxxx', route: … }`
       ⇒ จับเฉพาะแถวที่มี route ตามหลัง = ทะเบียนเมนู ไม่ใช่สีทั่วไปในหน้า */
    re: /color:\s*'#(?:22c55e|f59e0b|ef4444)'\s*,\s*route:/g,
    why: 'สีประจำโมดูลบนหน้าแรก **ห้ามเป็นสีสถานะ** — 23/09 เจอ "ฝ่ายผลิต" ใช้ #22c55e และ '
       + '"Warehouse & Delivery" ใช้ #f59e0b ซึ่งเป็นเฉดเดียวกับไฟ good/warn เป๊ะ '
       + 'และอยู่บนจอเดียวกับการ์ด telemetry ที่ใช้สีชุดนั้นแปลว่าสถานะจริง ⇒ แถบเหลืองเหนือการ์ดคลัง '
       + 'ถูกอ่านว่า "คลังมีปัญหา" ทั้งที่แปลว่า "นี่คือการ์ดคลัง" (statusTone กฎ 1: status colours are reserved)',
    fix: 'เลือกโทนที่ไม่มีความหมายสถานะ (teal/indigo/cyan/violet/pink/slate) — การ์ดแยกกันออกได้ด้วย '
       + 'emoji + code + label อยู่แล้ว (statusTone กฎ 4: แยกด้วยไอคอน/ป้าย ไม่ใช่สี)',
    allow: {},
  },
  {
    id: 'store-card-hand-drawn',
    scan: ['src/pages', 'src/components'], ext: ['.jsx'],
    /* จับ "ปุ่มลงมือของโมดูลสโตร์" ที่เขียน padding เตี้ยๆ เอง แทนที่จะผ่าน storeBtn()
       ⚠️ ตัวรันรองรับแค่ scan/ext/re/allow — **ไม่มี `only`** ⇒ ขอบเขตต้องคุมด้วย regex เอง
          ที่นี่คุมด้วยคำสั่งงานของสโตร์ (จ่าย/รับครบ/ยืนยันส่ง/เริ่มเตรียม/เริ่มผลิต) ซึ่งไม่โผล่นอกโมดูลนี้ */
    re: /padding:\s*['"`][0-7]px [0-9]+px['"`][^}]*?(?:จ่าย|รับครบ|ยืนยันส่ง|เริ่มเตรียม|เริ่มผลิต)/g,
    why: 'feedback หน้างาน 25/09 ("จุดที่ user ต้อง interactive ด้วยก็ดูบาง หายาก") — วัดจริงพบปุ่มลงมือ '
       + 'ในโมดูลสโตร์เล็กกว่า 40px แทบทุกตัว ที่แย่สุดคือปุ่ม "จ่าย" (จ่ายวัตถุดิบออกจากคลังจริง) = 39×26px '
       + 'คนหน้างานใส่ถุงมือกดพลาด/หาไม่เจอ',
    fix: "ใช้ storeBtn('primary'|'secondary', extra) จาก src/utils/storeUi.js (สูง 44px · พื้น accent ทึบ) — UI §6.24",
    allow: {},
  },
  {
    id: 'accent-bg-hardcoded-ink',
    scan: ['src/pages', 'src/components', 'src/App.jsx'], ext: ['.jsx'],
    /* 3 ทาง: (1) background:'var(--accent)' … color:'#…' (2) ternary คู่ (3) ส่งผ่านอาร์กิวเมนต์ฟังก์ชันสไตล์
       เช่น btn('var(--accent)', '#08130a') / btnSt(on ? 'var(--accent)' : …, on ? '#…' : …) — ทาง (3) หลุดรอบแรก
       ไป 14 จุด (06/10) เพราะไม่มีคำว่า background:/color: ให้จับ */
    re: /background:\s*'var\(--accent\)'[^}\n]{0,120}?color:\s*'#|\?\s*'var\(--accent\)'\s*:[^}\n]{0,140}?color:[^,}\n]*\?\s*'#|'var\(--accent\)'(?:\s*:\s*'[^'\n]*')?\s*,\s*(?:\w+\s*=\s*|[\w.]+\s*\?\s*)?'#[0-9a-fA-F]{3,6}'/g,
    why: 'สี --accent กลับด้านตามธีม (มืด = เขียวสว่าง #3dd65c · สว่าง = เขียวเข้ม #0d3d14) '
       + 'ตัวหนังสือสีดิบบนพื้น accent จึงจมเสมอ 1 ธีม — ดำ (#071008) จมในธีมสว่าง · ขาว (#fff) จมในธีมมืด '
       + '(05/10 · ปุ่ม "แจ้งซ่อมใหม่" /mtn-repair อ่านไม่ออก · เจอ 144 จุด 82 ไฟล์)',
    fix: "ตัวหนังสือบนพื้น var(--accent) ใช้ color: 'var(--accent-ink)' เสมอ",
    allow: {},
  },
  {
    id: 'kpi-scope-write-raw',
    scan: ['src/pages', 'src/components'], ext: ['.jsx'],
    /* เขียน/คิวรีคีย์ขอบเขตของตาราง kpi_* ด้วย scope ที่เลือกบนจอตรงๆ (scope.kind / sel.kind) — ต้องผ่าน canonicalScope() ก่อน
       (15/10 · PD1 กับ CC 2140461000 เก็บเป็น 2 คีย์ ⇒ นิยาม 9 ตัว + โน้ต 10 แถว + layout แยกกัน สลับช่องกรองแล้วค่าหาย) */
    re: /scope_kind(?::\s*|',\s*)\b(?:scope|sel|sc|form\.scope)\.kind\b/g,
    why: 'ขอบเขต KPI ของ "รหัส cost center ที่มีหน่วยเจ้าของ" ต้องเก็บ/เทียบที่หน่วยเจ้าของ — เขียน scope ดิบ = คีย์แยก 2 ชุดของหน่วยเดียวกัน',
    fix: "ส่งผ่าน canonicalScope(org, scope) (utils/orgScope.js) หรือ defScopeColumns(org, scope) ก่อนเขียน/คิวรี scope_kind",
    allow: {},
  },
  {
    id: 'icon-only-trash-emoji',
    scan: ['src/pages', 'src/components'], ext: ['.jsx'],
    re: />\s*🗑️?\s*<\/button>/g,
    why: 'ปุ่มลบที่เป็นอีโมจิ 🗑️ เปล่าตัวเล็ก ไม่มีกรอบ — Windows วาดเป็นถังเส้นบางสีเทา "เล็กจนดูไม่ออก" '
       + 'และใส่ color แดงไม่มีผลกับอีโมจิ (06/10 · /org-setup · เจอ 12 จุด 7 ไฟล์)',
    fix: "ใช้ <DeleteButton onClick=… title=\"ลบ …\" /> จาก src/components/IconButton.jsx (กล่อง 30px + ถังขยะ SVG สีแดง)",
    allow: {},
  },
  {
    id: 'orphan-emoji-variation-selector',
    scan: ['src', 'src/pages', 'src/components', 'src/utils', 'src/lib'], ext: ['.jsx', '.js'],
    /* U+FE0F ที่ไม่มี emoji นำหน้า (อยู่หลังเครื่องหมายคำพูด/ช่องว่าง) = ซากของสคริปต์กวาด "ตัด emoji" ที่ลบตัว emoji
       แต่ทิ้งตัวเลือกรูปแบบไว้ ⇒ ตรงนั้นวาดเป็น "ว่าง" (09/11 · /management ปุ่ม 4M Machine ไม่มีไอคอนข้างพี่น้อง 📦📋)
       · คู่กับเคสปุ่มไอคอนล้วนที่ถูกลบจนเหลือกล่องเปล่า (rail ขวา ปุ่ม 🏷️ — user ถาม "คืออะไร")
       · 1️⃣ (keycap) ไม่โดน เพราะ FE0F ตามหลังตัวเลข ไม่ใช่เครื่องหมายคำพูด */
    re: /['"`>\s]\uFE0F/g,
    why: 'emoji ถูกลบเหลือแต่ U+FE0F (มองไม่เห็น) — ไอคอนหายเงียบ ปุ่มไอคอนล้วนกลายเป็นกล่องเปล่า (09/11 · e839b388)',
    fix: 'ใส่ไอคอนกลับเป็น <Icon glyph="…" /> (ปุ่มมีป้าย · UI §6.35 ข้อ 5) หรือ emoji เต็มตัว (ปุ่มไอคอนล้วน) · ไม่ต้องการไอคอน = ลบ FE0F ทิ้ง',
    allow: {},
  },
  {
    id: 'card-shadow-via-token',
    scan: ['src', 'src/pages', 'src/components'], ext: ['.jsx'],
    /* ⚠️ เดิมจับแค่ offset แนวตั้ง **0-3px** ⇒ เงา modal/แผงลอย (`0 8px 28px`, `0 20px 60px`)
       รั่วทั้งหมด — วัด 06/10 เจอ 32 จุดที่ด่านมองไม่เห็น (แผง dropdown · popover · modal
       ของ 25 ไฟล์) ⇒ ธีมสว่างได้เงาเข้มเกินจริง และธีมมืดมีเงาโผล่กลับมาทีละจุด
       ⇒ ขยายเป็น "เงาเดี่ยว offset แนวตั้ง สี **ดำ**" ทุกขนาด

       สิ่งที่ **ไม่เข้าข่ายโดยเจตนา** (ลองขยายคลุมแล้วได้ false positive เพียบ = คนจะอยากปิดด่าน):
       · เงาเรืองแสงสี — `0 0 4px 1px rgba(61,214,92,.6)` ไฟ LED เขียว · `rgba(239,68,68,…)` ไซเรนแดง
         (offset 0 ทั้งคู่ + สีไม่ใช่ดำ) → เป็น "สัญญาณ" ไม่ใช่ "ของลอย" ธีมไม่ควรตัดสินให้
       · เงาแนวนอน — `2px 0 6px` เส้นแบ่งคอลัมน์ sticky ใน /operator (token ไม่มีตัวแนวนอน)
       · เงาผสม/มี inset — `0 3px 14px rgba(…), inset 0 0 0 1px …` (ป้ายบนผังโรงงาน) */
    re: /boxShadow:\s*(['"`])0 \d+px \d+px rgba\(0,\s*0,\s*0[^)]*\)\1/g,
    why: 'เงาใต้การ์ดในธีมมืดถูกถอดออกแล้ว (24/09 · คำสั่ง user) เพราะบนพื้นเกือบดำมันมองแทบไม่เห็น '
       + 'เหลือแค่ขอบมัวๆ = ของตกแต่งล้วน · แต่**ธีมสว่างยังต้องมีเงา** (ขอบจาง เงาคือตัวแยกการ์ด '
       + 'ออกจากพื้นขาว) ⇒ ค่าเงาต้องมาจาก token ที่ธีมตัดสินให้ · เขียน rgba ดิบไว้ในหน้า = '
       + 'เงานั้นไม่ฟังธีม แล้วธีมมืดจะมีเงาโผล่กลับมาทีละจุดโดยไม่มีใครรู้ '
       + '(วัดจริงก่อนแก้ด้วย audit/uxsweep.mjs: 6 หน้ามีรวมกัน ~60 จุด)',
    fix: "การ์ดแบนที่ไม่ได้ลอย → boxShadow: 'var(--shadow-sm)' (ธีมมืด = none) · "
       + "ของที่ลอยทับเนื้อหาจริง (dropdown · popover · tooltip กราฟ · ป้ายบนรูปผัง · badge ที่ยื่นออกนอกการ์ด) "
       + "→ 'var(--shadow-float)' (มีเงาทั้ง 2 ธีม) · modal/overlay เต็มจอ → 'var(--shadow-lg)' "
       + "(เกณฑ์ที่ใช้ตอนกวาด 06/10: offset ≥ 8px และ blur ≥ 34px = modal · ที่เหลือ = แผงลอย)",
    allow: {},
  },
  {
    id: 'pm-run-day-via-helper',
    scan: ['src/pages', 'src/components', 'src/lib'], ext: ['.jsx', '.js'],
    /* จับการเทียบสถานะ "ไม่ได้ผลิตเลยไม่ต้องตรวจ" ด้วยสตริงดิบในหน้า */
    re: /['"`]idle_skip['"`]\s*(?:===|==|!==|!=)|(?:===|==|!==|!=)\s*['"`]idle_skip['"`]/g,
    why: 'สถานะ `idle_skip` (รอบ PM ที่นับจากวันเดินเครื่อง · 02/10) มีกฎพ่วงอยู่ 2 ข้อที่มองไม่เห็น '
       + 'จากตัวสตริง: **ห้ามนับในตัวหารของ %ความครบถ้วน** และ **เทาเท่านั้น ห้ามเขียว** · '
       + 'หน้าที่เทียบสตริงเองจะตกหล่นข้อใดข้อหนึ่งเสมอเมื่อเพิ่มสถานะใหม่ทีหลัง '
       + '(คลาสเดียวกับที่เคยก๊อป ORDER map ไว้ใน PMSchedule แล้วสถานะใหม่หล่นไปท้ายลิสต์เงียบๆ)',
    fix: "ใช้ `countsForCompliance(status)` จาก src/utils/pmRunDay.js ตัดสินว่านับเข้า KPI ไหม · "
       + "สีมาจาก `STATUS_META[status]` (src/lib/pmSchedule.js) · ข้อความมาจาก `runDayText(res)`",
    allow: {
      'src/pages/PMSchedule.jsx': 'จอเดียวที่ต้องแยก "เทา" ออกจากสีสถานะอื่นตอนวาดแถว — ตัวหาร KPI ใช้ countsForCompliance แล้ว',
    },
  },
  {
    id: 'pm-run-day-needs-line-family',
    scan: ['src/pages', 'src/components'], ext: ['.jsx'],
    /* เรียก runDaysOf โดยส่งชื่อไลน์ตรงๆ จาก record (ไม่ผ่าน getLineFamilyNames) */
    re: /runDaysOf\([^)]*\[\s*\w+\.line_name\s*\]\s*\)/g,
    why: '`runDaysOf` ที่เทียบชื่อไลน์ตรงตัวจะมองไม่เห็นใบผลิตของไลน์ลูก — เคสจริง 02/10: '
       + 'PF-H101 ลงทะเบียนที่ไลน์แม่ **HYDROFORM** แต่ใบผลิตเปิดที่ **HDF1/HDF2** ⇒ ระบบอ่านว่า '
       + '"ไม่เคยเดินเลย 60 วัน" ทั้งที่ของจริงเดิน 38 วัน แล้ว**ข้ามการตรวจที่จำเป็นเงียบๆ** '
       + '(ผิดทิศที่อันตรายกว่าตรวจเกิน)',
    fix: 'กางครอบครัวไลน์ก่อนเสมอ: `runDaysOf(rows, getLineFamilyNames(lines, eq.line_name))` '
       + '(src/utils/lineHierarchy.js) — กติกาเดียวกับ `sumUsage` ใน pmUsage.js',
    allow: {},
  },
  {
    id: 'nav-alsoin-is-shortcut-not-second-home',
    scan: ['src', 'audit'], ext: ['.jsx', '.js', '.mjs'],
    /* จับ "เอา group กับ alsoIn มากองรวมเป็นลิสต์หมวดของหน้านี้" — รูปที่บั๊กเคยเขียนไว้เป๊ะๆ */
    re: /\[\s*\w+\.group\s*,\s*\w+\.alsoIn/g,
    why: '`alsoIn` = "โชว์หน้านี้เป็น **ทางลัด** ในหมวดนั้นด้วย" **ไม่ใช่ "หน้านี้มี 2 บ้าน"** — '
       + 'เดิมเมนูที่ตั้ง alsoIn โผล่ 2 หมวดด้วยหน้าตาเหมือนกันเป๊ะ ⇒ (1) user ทักว่าเมนูซ้ำ '
       + '("ไม่ซ้ำยังไง วางแผนผลิต อยู่ทั้ง sidebar หมวดผลิต กับ วางแผน" 24/09) '
       + '(2) ไฮไลต์ "คุณอยู่ตรงนี้" สว่าง 2 หมวดพร้อมกัน = คำถามตำแหน่งมี 2 คำตอบ',
    fix: 'ตัดสิน "บ้านจริง" ด้วย `item.group` ตัวเดียว · เช็คว่าแถวนี้เป็นทางลัดไหมด้วย '
       + '`isNavGuest(item, group)` (src/App.jsx) แล้ววาดให้ต่าง (จาง + `↗ <หมวดบ้าน>`) · '
       + '"หน้านี้อยู่ในหมวดนี้ไหม (นับทางลัด)" ใช้ `inNavGroup()` — คนละคำถามกัน ห้ามปน',
    allow: {},
  },
  {
    id: 'nav-alsoin-read-via-helper',
    scan: ['src'], ext: ['.jsx', '.js'],
    re: /\.alsoIn\b/g,
    why: 'ทุกหน้าที่อ่าน `.alsoIn` เองจะตีความเองว่า "บ้านที่สอง" หรือ "ทางลัด" ⇒ แต่ละจอตอบ '
       + 'คำถาม "หน้านี้อยู่หมวดไหน" ไม่เหมือนกัน (เกิดจริง 24/09: sidebar กับ stdsweep คิดคนละแบบ)',
    fix: 'ใช้ helper กลางใน src/App.jsx: `inNavGroup(item, groups)` = โชว์ในหมวดนี้ไหม (นับทางลัด) · '
       + '`isNavGuest(item, group)` = แถวนี้เป็นทางลัดของหมวดนี้ไหม',
    allow: { 'src/App.jsx': 'เจ้าของ helper — inNavGroup/isNavGuest นิยามอยู่ที่นี่' },
  },
  {
    id: 'plan-lot-no-hard-delete',
    scan: ['src'], ext: ['.jsx', '.js'],
    /* แผนสั่งงานที่ยกเลิก = ประวัติที่ต้องสอบกลับได้ว่า "ใครสั่งอะไร แล้วทำไมไม่ได้ทำ" */
    re: /from\(['"]production_plan_lots['"]\)[\s\S]{0,80}?\.delete\(/g,
    why: 'ล็อตในแผนคือคำสั่งที่ออกไปหาฝ่ายผลิตแล้ว — ลบแถวทิ้ง = สอบกลับไม่ได้ว่าเคยสั่งอะไร '
       + 'แล้วทำไมถึงไม่ได้ทำ (ตระกูลเดียวกับกฎ "เคลียร์คิว 4M ค้างด้วย rejected ห้าม delete")',
    fix: "อัพเดท status = 'cancelled' + cancel_reason แทน — จอกรอง cancelled ออกจากคิวอยู่แล้ว",
    allow: {},
  },
  {
    id: 'blame-chain-rank-by-impact',
    scan: ['src/utils'], ext: ['.js'],
    /* เรียงสายการถีบด้วย ownLateMin ล้วน = ใบที่ "กินเกินนานแต่ไม่พาลใคร" ชนะทุกครั้ง */
    re: /sort\(\(a, b\) => b\.ownLateMin - a\.ownLateMin\)/g,
    why: 'วัดกับข้อมูลจริง 2026-09-30 (วันงาน 25/09 ทั้งโรงงาน): chain ที่พาลใบอื่นจริง 27 ตัว '
       + '**ถูกบังไม่ขึ้นจอ 22 ตัว** เพราะเรียงด้วย ownLateMin ล้วน แล้วใบ manual/ใบที่เปิดคลุมทั้งกะ '
       + '(กินเกิน 270–806 น. โดยไม่มีใบต่อท้ายเลย) ชนะการเรียงเสมอ — ไลน์ GOR มีตัวจริง 4 ตัว ขึ้นจอ 0 ตัว '
       + '⇒ จอตอบคำถามทีมปั๊ม "พาลไปโดนตัวไหนบ้าง" ไม่ได้เลยทั้งที่คำนวณถูกทุกตัว',
    fix: 'เรียง 3 ชั้นใน pushChainOf: (1) victimCount > 0 ชนะ 0 (2) blameTotalMin มากชนะ '
       + '(3) ownLateMin มากชนะ — เทสตรึงไว้ที่ src/utils/__tests__/heijunkaBlame.test.mjs',
    allow: {},
  },
  {
    id: 'pareto-hand-built-recharts',
    scan: ['src/pages', 'src/components'], ext: ['.jsx'],
    /* พาเรโตที่ประกอบเองด้วย Recharts จะมี "เส้น % สะสม" เป็น series ชื่อ cum เสมอ
       — ด่าน `pareto-via-ParetoChart` เดิมจับได้แค่แท่งนอนที่คำนวณ width เอง จึงหลุดตัวนี้ไป */
    re: /dataKey=["'](?:cum|cumPct|cumulative)["']/g,
    why: 'พาเรโตที่ประกอบเองใน Recharts หลุดด่านเดิมไปตัวหนึ่ง (เจอ 23/09 ที่ QualityControl) '
       + 'แล้วมันผิดทั้ง 2 อย่างที่กฎพาเรโตห้ามไว้: (1) **`.slice(0,10)` ก่อนคิด % สะสม** '
       + '⇒ เส้นสะสมจบ 100% ที่รายการที่ 10 ทั้งที่ของจริงยังมีที่ 11+ = จอประกาศว่า '
       + '"10 อันนี้คือทั้งหมด" ซึ่งไม่จริง (2) **ทาแท่งด้วยสีประจำประเภท** ⇒ แท่งเขียว/เหลือง/แดง '
       + 'เรียงกันโดยสีไม่ได้แปลว่าหนักเบา ชนกับสี Andon บนจอเดียวกัน (UI §6.17 ข้อ 1)',
    fix: '<ParetoChart rows={classifyAbc(items, v => v.qty)} unit="…" /> — `collapseTail` ยุบหางเป็นแท่ง '
       + '"อื่นๆ" ตามมาตรฐาน ทำให้ % สะสมจบ 100% จริง · สีมาจากกลุ่ม ABC (A แดง = 80% แรก ต้องแก้ก่อน)',
    allow: {},
  },
  {
    id: 'no-dual-y-axis',
    scan: ['src/pages', 'src/components'], ext: ['.jsx'],
    re: /<YAxis[^>]*orientation=["']right["']/g,
    why: 'กราฟที่มีแกน Y 2 ข้าง = กับดักอันดับ 1 ของ data-viz — **จุดที่เส้นตัดแท่งเป็นของปลอม** '
       + 'เพราะสเกล 2 ข้างตั้งอิสระจากกัน ขยับข้างเดียวก็เปลี่ยน "เรื่องเล่า" ได้ทันทีโดยตัวเลขไม่เปลี่ยน '
       + 'แต่ตาคนอ่านว่าการตัดกันนั้นมีความหมาย · เคสจริง 23/09 ที่ /energy: แท่ง = ชิ้น · เส้น = kWh/ชิ้น '
       + 'คนละหน่วยคนละสเกล ทั้งที่คำถามจริงคือ "2 เส้นนี้ไปทางเดียวกันหรือสวนกัน"',
    fix: 'แยกเป็น 2 กราฟวางซ้อนกัน ใช้แกน X ชุดเดียวกัน (small multiples) + ล็อก `YAxis width` ให้เท่ากัน '
       + 'ทั้งคู่ เพื่อให้คอลัมน์ตรงกันเป๊ะ — เทียบทิศทางได้ตรงๆ โดยไม่มีสเกลปลอม · '
       + 'แกนขวาของพาเรโต (% สะสม) ไม่เข้าข่าย เพราะ <ParetoChart> วาดเป็น SVG เองไม่ได้ใช้ <YAxis>',
    allow: {},
  },
  {
    id: 'pareto-via-ParetoChart',
    scan: ['src/pages', 'src/components'], ext: ['.jsx'],
    // จับการวาดพาเรโตเองในหน้า: ใช้ผลของ classifyAbc ไปทำแท่ง/ความกว้างเป็น % เอง
    re: /classifyAbc\s*\([\s\S]{0,400}?width:\s*`\$\{/g,
    why: 'Pareto ของระบบเคยเป็น **แท่งนอน ความหนาไม่เท่ากันตามกลุ่ม ABC** ซึ่งไม่ใช่ Pareto '
       + 'ตามมาตรฐานสากล (ASQ · Juran · Excel · QI Macros) — user เทียบกับใบมาตรฐานแล้วสรุปว่า '
       + '"ยังเทียบกันไม่ติดเลย ... แนวนอนไม่เวิค" (22/09) · Pareto ต้องมีครบ: แท่งตั้งเรียงมาก→น้อย · '
       + 'แท่งชิดกันสนิท · แกนซ้ายเริ่ม 0 · แกนขวา % สะสม 0-100 · เส้นสะสมจบ 100% ที่ขอบขวา · เส้น 80% '
       + 'ขาดข้อใดข้อหนึ่ง = ไม่ใช่ Pareto อีกต่อไป (กฎทั้งหมดถูกล็อกใน paretoGeometry.test.mjs) · '
       + '⚠️ กฎนี้จับได้แค่ "แท่งนอนที่คำนวณ width เอง" — พาเรโตที่ประกอบด้วย Recharts หลุดไปได้ '
       + 'จึงมีกฎคู่กัน `pareto-hand-built-recharts` (เพิ่ม 23/09 หลังเจอของหลุดจริงที่ QualityControl)',
    fix: 'ใช้ <ParetoChart rows={classifyAbc(...)} /> (src/components/ParetoChart.jsx) '
       + 'หรือ <ParetoAbcChart> ถ้าต้องการเจาะลึก/ABC ด้วย — พิกัดทั้งหมดมาจาก '
       + 'paretoGeometry() ใน src/utils/pareto.js ห้ามคำนวณความกว้าง/ความสูงแท่งเองในหน้า',
    allow: {},
  },
  {
    id: 'quality-photo-via-helper',
    scan: ['src/pages', 'src/components'], ext: ['.jsx'],
    // จับการแตะถัง quality-images ตรงๆ จากหน้า (upload / remove / getPublicUrl)
    re: /storage\s*\.from\(\s*['"]quality-images['"]\s*\)/g,
    why: 'รูปหลักฐานของเสียพาดผ่าน 3 จอ (ลงงานเสีย → ถังเหลือง/แดง → ใบรายงานของเสีย) '
       + 'และมีกติกาที่พลาดแล้วเห็นผลช้า: ① บีบ webp 1024px (480px ของรูปโปรไฟล์เล็กเกินกว่าจะเห็นตำหนิ) '
       + '② นามสกุลจาก imgExt(blob) ห้าม hardcode .jpg ③ uploadOpts() ไม่งั้น cacheControl หาย '
       + '— เคยทำ egress ทะลุโควต้าจนทั้ง organization ถูกล็อก · บทเรียนเดียวกับ mtnImage.js: '
       + 'กติกาที่ฝังอยู่ในหน้าแรก ทำให้จุดที่ 2 ต้องก๊อป แล้วตกหล่นทีละข้อ',
    fix: 'ใช้ uploadQualityPhoto(file, folder, key) / removeQualityImg(url) '
       + 'จาก src/utils/qualityImage.js (ช่องกรอกใช้ <QualityPhotoField>)',
    allow: {},
  },
  {
    id: 'action-photo-via-helper',
    scan: ['src/pages', 'src/components'], ext: ['.jsx'],
    re: /storage\s*\.from\(\s*['"]action-images['"]\s*\)/g,
    why: 'รูปหลักฐานตอนปิด Action Item มีกติกาเดียวกับรูปของเสีย: บีบ webp 1024px · นามสกุลจาก '
       + 'imgExt(blob) · uploadOpts() (ไม่ใส่ = cacheControl หาย เคยทำ egress ทะลุโควต้าจนทั้ง '
       + 'organization ถูกล็อก) — ฝังไว้ในหน้าแล้วจุดที่ 2 จะก๊อปแล้วตกหล่น',
    fix: 'ใช้ uploadActionPhoto(file, id) / removeActionImg(url) จาก src/utils/actionImage.js',
    allow: {},
  },
  {
    id: 'mo-image-via-mtnImage',
    scan: ['src/pages', 'src/components'], ext: ['.jsx'],
    // จับการอัปโหลดขึ้น bucket mtn-images โดยไม่ผ่าน util กลาง
    re: /storage\s*\.from\(\s*['"]mtn-images['"]\s*\)\s*\.upload/g,
    why: 'รูปในใบ MO มีกติกา 3 ข้อที่พลาดแล้วเห็นผลช้า: ① สัดส่วน 16:9 ทุก step '
       + '(ผจก.สุรเสน 22/09) ② บีบเป็น webp — รูปซ่อม = 39 MB/วันของ egress ฝั่ง DR '
       + '③ นามสกุลไฟล์ต้องมาจาก imgExt(blob) ห้าม hardcode .jpg · เดิมกติกาพวกนี้ฝังอยู่ใน '
       + 'MtnRepair.jsx ⇒ จุดแนบรูปใหม่ต้องก๊อป แล้วตกหล่นทีละข้อ (22/09: เปิด MO จากดาวน์ไทม์ '
       + 'ไม่มีช่องแนบรูปเลย เพราะก๊อปไม่ไหว)',
    fix: 'ใช้ uploadMoBeforeImg(file, orderId) หรือ resizeMoImage()+uploadMtnImg() '
       + 'จาก src/utils/mtnImage.js',
    allow: {
      'src/utils/mtnImage.js': 1,
      /* 3 ไฟล์นี้ใช้ bucket `mtn-images` ร่วมกัน แต่ **ไม่ใช่รูปในใบ MO** — เป็นรูปผัง/ชั้นวาง/อะไหล่
         ซึ่ง **ห้ามครอบ 16:9** (ผังโดนครอบ = ตำแหน่งหมุดเพี้ยนทั้งผัง) จึงไม่ควรผ่าน util ของใบ MO */
      'src/components/DieLayout.jsx': 1,      // รูปผังจัดเก็บแม่พิมพ์ — สัดส่วนตามรูปจริง
      'src/components/RackMap.jsx': 1,        // รูปชั้นวางอะไหล่ — สัดส่วนตามรูปจริง
      'src/components/SparePartMaster.jsx': 1, // รูปอะไหล่รายชิ้น
    },
  },
  {
    id: 'mock-mapper-must-return-one-row',
    scan: ['audit'], ext: ['.js', '.mjs'],
    /* จับ mapper ใน TABLE_ROWS ที่คืน "อาร์เรย์" — สัญญาของ TABLE_ROWS คือ 1 แถวเข้า → 1 แถวออก
       (ตัวเรียกทำ ROWS.map(fn) ให้แล้ว) · ตารางที่มีรูปทรงของตัวเองต้องไปอยู่ TABLE_FIXED */
    re: /^\s{2}[a-z_0-9]+: \([^)]*\) => \[/gm,
    why: 'mapper คืนอาร์เรย์ = ได้อาร์เรย์ซ้อน 14 ชั้นใน mock ⇒ ทุก field เป็น undefined '
       + '(เกิดจริง 22/09/2026: factory_line_regions ⇒ r.line_name undefined ⇒ FactoryMap พัง '
       + 'ที่ .sort(localeCompare) — และก่อนหน้านั้นทั้งหน้าไม่เคยเรนเดอร์เลยเพราะ image_url ว่าง)',
    fix: 'ตารางที่มีชุดแถวของตัวเอง ให้ย้ายไป TABLE_FIXED ใน audit/mockSupabase.js '
       + '(rowsFor จะคืนทั้งก้อนตรงๆ) · TABLE_ROWS ใช้เฉพาะ "แปลง ROWS ทีละแถว"',
    allow: {},
  },
  {
    id: 'no-hardcoded-other-category',
    scan: ['src/pages', 'src/components'], ext: ['.jsx'],
    // จับการเขียนค่าหมวด/อาการเป็น 'อื่นๆ' ตายตัวตอน insert/update ลง DB
    re: /(problem_characteristic|problem_group|defect_type|category)\s*:\s*['"]อื่น\s*ๆ?['"]/g,
    why: 'เขียน "อื่นๆ" ทับค่าที่ระบบรู้อยู่แล้ว = ทำถังขยะขึ้นอันดับ 1 ของพาเรโตด้วยมือตัวเอง '
       + '(เกิดจริง 23/09: เปิดใบซ่อมจากดาวน์ไทม์ hardcode problem_characteristic:"อื่นๆ" '
       + 'ทั้งที่ประเภทดาวน์ไทม์อยู่ในมือตั้งแต่กดปุ่ม ⇒ 325 ใบเป็นถังขยะ · พาเรโตขึ้น '
       + '"ไม่ระบุกลุ่ม 65% + อื่นๆ 33% = 98%" user แจ้งว่า "การวิเคราะห์จะไม่มีประโยชน์เลย")',
    fix: 'ใส่ค่าจริงที่มีอยู่ (เช่น dtType?.name_th / mo_problem_group จากทะเบียน) แล้ว fallback '
       + 'เป็น "อื่นๆ" เฉพาะตอนไม่มีค่าจริงจริงๆ · กติกา 3 ชั้น + ตัวช่วยอยู่ src/utils/unclassified.js',
    allow: {},
  },
  {
    id: 'filter-all-label-hand-written',
    scan: ['src'], ext: ['.jsx', '.js'],
    /* ป้าย "ทั้งหมด" ของตัวกรองที่พิมพ์เอง — option ที่ขึ้นต้น "ทุก…" / "— ทุก… —" · placeholder="ทุก…"
       ของ LineSelect/SearchSelect · และคำอังกฤษ/ปนภาษาที่เคยหลุดจริง */
    re: /<option\s+value=(?:""|''|\{''\}|"all"|'all')\s*>\s*(?:—\s*)?ทุก[^<{]*<|placeholder=["'](?:—\s*)?ทุก|ALL SHIFT|ทุก Team\b|ทุก Section\b/g,
    why: 'audit 23/09/2026: คำว่า "ทั้งหมด" ในตัวกรองมี 30+ แบบ (`ALL SHIFT (ทุกกะ)` · `— ทุกกะ —` · `ทุก Team` · '
       + '`ทุกไลน์ (5)` …) หน้าเดียวกัน (/report) ยังใช้ 2 แบบ ⇒ ผู้ใช้สงสัยว่าความหมายต่างกันไหม (Nielsen #4) '
       + 'user ทักว่า "search/filter/dropdown มั่ว"',
    fix: 'ใช้ `ALL.<คำนาม>` / `allOf(คำนาม)` จาก src/utils/filterLabels.js — ตัวกรอง = "ทุก…" ไม่มีขีด/วงเล็บ '
       + '(ช่องในฟอร์มใช้ PICK/NONE) · docs/UI-STANDARD.md §3',
    allow: {
      'src/utils/filterLabels.js': 'ทะเบียนป้ายเอง',
      'src/pages/operator.jsx': 'ช่องในฟอร์มเพิ่ม/แก้สกิล — ค่าว่าง = "สกิลกลางใช้ทุกฝ่าย" ไม่ใช่ตัวกรองมุมมอง',
    },
  },
  {
    id: 'chart-yaxis-fixed-width',
    scan: ['src'], ext: ['.jsx', '.js'],
    /* แกนตัวเลขที่ตั้งความกว้างเป็นเลขตายตัว — แกนหมวด (type="category") ยกเว้น (ความกว้างคือพื้นที่ชื่อ) */
    re: /<YAxis\b(?![^\n]*type="category")[^\n]*\bwidth=\{\s*[\d(]/g,
    why: 'user 24/09/2026 ส่งภาพจอ SQDCM: แกนตั้งเขียน "0", "5", "7" ทั้งที่ค่าจริง 100 / 75 — `<YAxis width={34}>` '
       + 'แคบกว่าตัวเลข (จอ TV สเกลฟอนต์ขึ้นแต่แกนไม่ขยายตาม) ⇒ SVG ตัดหลักหน้าทิ้ง = ตัวเลขที่อ่านผิดแย่กว่าไม่มีตัวเลข',
    fix: 'ใช้ `width="auto"` (Recharts 3 วัดจากตัวเลขที่ยาวที่สุดเอง) + `tickFormatter={fmtAxis}` จาก src/utils/chartAxis.js',
    allow: {},
  },
  {
    id: 'kpi-yn-boolean-compare',
    scan: ['src'], ext: ['.jsx', '.js'],
    /* คอลัมน์ตัดสิน yn/ynTotal ที่คืน boolean จากการเทียบเอง (>= / <=) แทนระดับ 1/0.5/0 ของ scoreDef */
    re: /\byn(?:Total)?:\s*[^,\n]*?\s(?:>=|<=|<|>)\s/g,
    why: 'ระดับ KPI = 1/0.5/0 (scoreDef) ไม่ใช่ boolean — LV_SYM ใน kpiExportExcel เทียบ === 1 / === 0.5 ⇒ true/false ตกเป็น ✗ ทั้งคู่ · '
       + 'เคยเกิดจริง (audit 05/10): คอลัมน์สรุปปี OEE ในฟอร์ม FM-HRM-6-022 พิมพ์ ✗ เสมอแม้ผ่านเป้า',
    fix: 'yn: v => scoreDef(v, { target_compare, target_value }).level (null เมื่อไม่มีเป้า)',
    allow: {},
  },
  {
    id: 'obeya-actions-unscoped',
    scan: ['src/components', 'src/pages'], ext: ['.jsx'],
    /* ACTION BOARD ที่เอาแถว meeting_action_items ดิบไปคิด health โดยไม่ผ่าน scopeActions() */
    re: /actionHealth\(\s*(?:actions|items|rows|data)\s*,/g,
    why: 'ใบ Action ต้องเดินตามขอบเขตเดียวกับข้อมูลผลิต (scope user ∩ ขอบเขตที่เลือก) — audit 05/10: SQDCM โชว์ทุกใบทั้งโรงงาน '
       + 'ไม่ว่าจะเลือกส่วนงานไหน และ user ที่ถูกจำกัดส่วนงานก็เห็นใบของหน่วยอื่น',
    fix: 'const scoped = scopeActions(actions, { sections, scopeSecs, lineOk }) → actionHealth(scoped.items, today) + เขียน scoped.hidden บนจอ',
    allow: {},
  },
  {
    id: 'chart-yaxis-domain-hand-made',
    scan: ['src'], ext: ['.jsx', '.js'],
    /* แกน Y ที่ไม่เริ่ม 0 แบบเขียนเอง: domain={[dataMin => …, …]} / domain={[95, 100]} / domain: [min => …] */
    re: /(?:domain=\{\[|domain:\s*\[)\s*(?:dataMin|\(?\s*\w+\s*\)?\s*=>|[1-9]\d*)/g,
    why: 'แกน Y ที่ไม่เริ่ม 0 ทำให้ "แท่งสูง 2 เท่า ≠ ค่ามาก 2 เท่า" — กติกาความซื่อสัตย์ (UI §กราฟ 30/09): ช่วงต้องมาจาก '
       + '`focusDomain()` (ทุกอย่างที่วาดอยู่ในช่วง · มี 0 จริง = ไม่โฟกัส) และต้องมี <FocusAxisNote> บนกราฟ · '
       + 'เคยหลุด 05/10: SQDCM %Q เขียน domain 95–100 เองโดยไม่มีป้าย',
    fix: 'const f = focusDomain(values, { max }) → domain={f ? f.domain : [0, max]} ticks={f?.ticks} + <FocusAxisNote loText=…/> (ObeyaSheet)',
    allow: {},
  },
  {
    id: 'chart-negative-margin',
    scan: ['src'], ext: ['.jsx', '.js'],
    re: /margin=\{\{[^}\n]*\bleft:[^,}\n]*-\s*\d/g,
    why: 'margin ซ้ายติดลบ (`left: -22`) ดึงกราฟไปทับพื้นที่แกน Y ⇒ ตัวเลขแกนถูกตัดครึ่ง (ต้นเหตุคู่กับ YAxis width ตายตัว · '
       + 'เคยก๊อปต่อกัน 12 จุดใน OBEYA/QA/LineOeeBoard)',
    fix: 'margin ซ้าย ≥ 0 — ใช้ `CHART_MARGIN` จาก src/utils/chartAxis.js · อยากได้พื้นที่คืน ให้ย่อตัวเลขด้วย fmtAxis แทน',
    allow: {},
  },
  {
    id: 'problem-report-must-be-recorded',
    scan: ['src'], ext: ['.jsx', '.js'],
    /* จับการเรียก printProdProblemReport() ตรงๆ จากหน้าจอ (ข้ามทะเบียนใบ) */
    re: /\bprintProdProblemReport\s*\(/g,
    why: 'ใบรายงานปัญหาการผลิต FM-PD1-019 ต้องเก็บ 1 ปี (WI-PD3-069 §7) แต่เดิมปุ่มพิมพ์ '
       + '**generate ใหม่ทุกครั้งแล้วจบ** ⇒ (1) หัวเรื่อง "ปัญหา :" ที่คนพิมพ์หายทันที '
       + '(2) ไม่รู้ว่าใครออกใบ/เมื่อไหร่/กี่ใบ (3) ข้อมูลต้นทางถูกแก้ทีหลัง = ใบที่พิมพ์ซ้ำ '
       + '"ไม่เหมือนใบที่ยื่นไปแล้ว" โดยไม่มีใครรู้ ⇒ หน้างานต้องปริ้นกระดาษเก็บเองทุกวัน '
       + '(user 2026-09-25: "เห็นหัวหน้าต้องปริ้นออกมาเก็บเป็นกระดาษทุกวัน")',
    fix: 'ออกใบผ่าน `issueProblemReport()` (เขียนทะเบียน `prod_problem_reports` ก่อน แล้วค่อยพิมพ์) '
       + 'หรือพิมพ์ซ้ำใบเดิมผ่าน `reprintProblemReport()` (ใช้ snapshot เสมอ) — ทั้งคู่ใน `src/lib/prodProblemDoc.js`',
    allow: {
      // เจ้าของฟังก์ชันพิมพ์ + ตัวห่อที่บังคับให้เขียนทะเบียนก่อน
      'src/lib/prodProblemReport.js': 1,
      'src/lib/prodProblemDoc.js': 2,
    },
  },
  {
    id: 'quality-bin-rules-hand-built',
    scan: ['src'], ext: ['.jsx', '.js'],
    /* จับการตั้งค่า/รายชื่อของถังคุณภาพซ้ำนอก util กลาง:
         (1) ประกาศเพดานอายุแท็กเอง   (2) เขียนลิสต์ผลพิจารณา QA เอง */
    re: /\bTAG_MAX_DAYS\s*=|['"]use_as_is['"]\s*,\s*['"]scrap['"]/g,
    why: 'ค่าจาก WI ที่ถูกก๊อปไปวางหลายที่จะหลุดกันเองแน่นอน — บทเรียนเดียวกับ `PROBLEM_MIN_MINUTES` '
       + 'ที่เคยถูกก๊อปเลข 30 ไป 3 จุดใน DailyReport แล้วแก้ไม่ครบ · อายุแท็ก (🟡 5 วัน · 🔴 1 วัน '
       + 'ตาม WI-PD3-087 §5.6) และผลพิจารณา QA 4 ทาง (WI-PD3-069 §5.4) เป็นข้อกำหนดของเอกสาร '
       + 'ไม่ใช่ค่าที่หน้าจอตั้งเองได้ · จอ 2 จอที่ตอบอายุแท็กไม่ตรงกัน = ไม่มีใครเชื่อจอไหนเลย',
    fix: 'import `TAG_MAX_DAYS` / `QA_DECISIONS` / `binTagAge` / `binClosed` จาก `src/utils/qualityBin.js`',
    allow: {
      // เจ้าของกติกา — ที่อื่น import จากที่นี่
      'src/utils/qualityBin.js': 2,
    },
  },
  {
    id: 'repair-wi-number-hardcoded',
    scan: ['src'], ext: ['.jsx', '.js'],
    /* จับเลข WI การซ่อมที่ถูกเขียนเป็น string literal ในโค้ด (ต้องมาจากทะเบียนเท่านั้น) */
    re: /['"]WI-PD3-\d{3}['"]/g,
    why: 'ทะเบียน "อาการไหนซ่อมตาม WI เล่มไหน" (WI-PD3-069 §6) มีการแก้/เพิ่มรายการทุกปี '
       + '— ฮาร์ดโค้ดเลขเล่มในโค้ดแล้ว WI ออก Rev ใหม่เมื่อไหร่ จอจะแนะนำเล่มที่ยกเลิกไปแล้วเงียบๆ '
       + 'และ **คนหน้างานจะซ่อมตามเล่มผิด** ซึ่งอันตรายกว่าไม่แนะนำอะไรเลย',
    fix: 'อ่านจากตาราง `repair_wi_registry` (DR) แล้วจับคู่ด้วย `matchRepairWi()` (`src/utils/repairWi.js`) '
       + '· doc_control/QA แก้ทะเบียนเองได้ที่ /qa แท็บถังเหลือง-แดง → ปุ่ม 📕 ทะเบียน WI ซ่อม',
    allow: {},
  },
  {
    id: 'drag-start-via-pointer-event',
    scan: ['src'], ext: ['.jsx'],
    /* จับเฉพาะ "เริ่มลาก" ที่ผูกกับ mouse event — ตัวที่ไม่ใช่การลาก (เช่น onMouseDown ที่
       preventDefault เพื่อเลือกก่อน blur ใน SearchSelect · แคนวาสวาดลายเซ็นที่มี onTouch* ครบแล้ว)
       ไม่เข้าข่าย เพราะไม่ได้เรียก startDrag */
    re: /onMouseDown=\{[^}]*\bstartDrag\b/g,
    why: 'จอหน้างาน/แท็บเล็ตที่หัวหน้าไลน์ใช้เป็น **จอทัช** — นิ้วไม่ยิง mousedown/mousemove '
       + '⇒ ลากหมุดย้ายตำแหน่งไม่ได้เลย และ "แตะหมุด" ก็ไม่เข้า onUp ⇒ panel แก้ไขไม่เปิดด้วย '
       + '(QC 06/10: /line-setup แก้ผังบนจอทัชไม่ได้ทั้งหน้า ทั้งที่ MachineFloorMap ทำถูกอยู่แล้ว)',
    fix: 'onPointerDown + window listener `pointermove`/`pointerup`/**`pointercancel`** '
       + '(cancel = ระบบยกเลิก gesture เช่นจอหมุน ⇒ ห้าม commit ตำแหน่ง) '
       + "· หมุดต้องมี `touchAction: 'none'` ตอนโหมดแก้ไข ไม่งั้นจอ scroll แทนการลาก "
       + '· ต้นแบบ: src/components/MachineFloorMap.jsx',
    allow: {},
  },
  {
    id: 'time-frame-start-single-source',
    scan: ['src'], ext: ['.jsx', '.js'],
    /* จับการประกาศ `FRAME_START` ซ้ำนอกไฟล์เจ้าของ (ของกลาง = utils/timeFrame.js) */
    re: /\b(const|let|var)\s+FRAME_START\s*=/g,
    why: 'กรอบวันงาน 08:00→08:00 เป็นฐานของทุกบอร์ดไทม์ไลน์ (รอบกะดึกข้ามเที่ยงคืนต้องอยู่แถวเดียวกัน) '
       + '· `InternalTimeBoard` เคยประกาศค่าเดียวกันซ้ำในไฟล์ตัวเอง (QC 06/10) ⇒ ตัวบอร์ดกับตัวที่คำนวณ '
       + 'ตำแหน่งแท่ง/ช่วงพักที่ส่งเข้ามา เป็น **แกนเวลา 2 ชุด** ที่บังเอิญตรงกันวันนี้ '
       + '· ใครขยับค่าในของกลางวันหลัง บอร์ดจะเพี้ยนเงียบๆ ทีละจอ โดยไม่มี error',
    fix: "import { FRAME_START } from '../utils/timeFrame'",
    allow: {
      'src/utils/timeFrame.js': 'เจ้าของค่า — เป็นที่ประกาศจริง',
    },
  },
  {
    id: 'shift-frame-start-via-helper',
    scan: ['src'], ext: ['.jsx', '.js'],
    /* จับการต่อ "เวลาเริ่มกะ" จาก work_date + start_time ตรงๆ เป็น timestamp
       (รูปที่เจอจริงทั้ง 6 สำเนา: `${wd}T${st}` / `${work_date}T${start_time}`) */
    re: /new Date\(`\$\{[\w.?]*(wd|work_date|workDate)\}T\$\{[^`]*(st|start_time|startHm|openHm|startTimeStr)\b/g,
    why: 'กะดึกที่บันทึกเวลาเริ่ม 00:00-07:59 = **เช้าของวันถัดไป** ⇒ ต่อ work_date + start_time ตรงๆ '
       + 'ได้กรอบกะ **เร็วไป 20 ชม.** แล้วไปโดน clampWinToShift (ช่วงของ MAT) + dtMinOutsideWork '
       + '⇒ %A/%P เพี้ยนเงียบ · และจุดที่ **เขียนลงฐาน** (ใบ downtime ที่ยกข้ามกะใน DailyReport) '
       + 'ยังทำให้ timestamp ในฐานเพี้ยนไป 1 วันด้วย = ต้นทางของข้อมูลเสีย ไม่ใช่แค่จอ '
       + '· กฎนี้ถูกก๊อป **6 สำเนา** (shiftFrameOf · computeLiveOee · computeSessionOee · sessionWindow '
       + '· mtnMetrics · DailyReport) รอบแก้ 06/10 ไปแก้แค่ 2 ⇒ ที่เหลือยังพังต่ออีก 2 วัน (QC 08/10)',
    fix: "ห่อวันด้วย `shiftStartDate(workDate, 'HH:MM', shift)` จาก src/utils/oee.js ก่อนต่อเป็น Date",
    allow: {
      'src/utils/oee.js': 'เจ้าของกฎ — shiftStartDate ประกาศและถูกเรียกครบทุกจุดในไฟล์นี้แล้ว (ตรวจด้วยเทส shiftStartDate.test.mjs)',
    },
  },
  {
    id: 'shift-start-date-via-helper',
    scan: ['src'], ext: ['.jsx', '.js'],
    /* จับการ "บวก 1 วันให้กะดึก" ที่เขียนเองนอกของกลาง — รูปที่เจอจริงคือ
       `d.setDate(d.getDate() + 1)` ที่อยู่ในบล็อกเดียวกับการเช็ค `shift === 'night'` */
    re: /shift\s*===\s*['"]night['"][^\n]{0,120}setDate\([^)]*\+\s*1\s*\)|isNight[^\n]{0,80}setDate\([^)]*\+\s*1\s*\)/g,
    why: 'กะดึกที่บันทึกเวลาเริ่ม 00:00-07:59 = **เช้าของวันถัดไป** — เดิมกฎนี้อยู่ 2 ที่ที่ตัดสินไม่เหมือนกัน '
       + '(`computeLiveOee` บวกวันให้ · `shiftFrameOf` ไม่บวก) ⇒ กรอบกะเร็วไป 20 ชม. '
       + '⇒ `clampWinToShift()` รัดช่วง downtime/พาร์ททิ้งทั้งหมดเพราะ "อยู่นอกกรอบ" '
       + '⇒ **%A หาย downtime · "ควรได้" เพี้ยน แบบเงียบ** (วัดฐานจริง 06/10: 5 กะเข้าเงื่อนไขนี้ 23/09-05/10)',
    fix: "ใช้ `shiftStartDate(workDate, startHm, shift)` จาก src/utils/oee.js (ของกลางของกฎนี้)",
    allow: {
      'src/utils/oee.js': 'เจ้าของกฎ — เป็นที่คำนวณ shiftStartDate เอง',
    },
  },
  {
    id: 'picker-arms-first-row-on-open',
    scan: ['src/components'], ext: ['.jsx'],
    /* จับการตั้ง active = 0 ตอนลิสต์เปิด (ไม่ผ่าน initialActiveRow) ใน picker */
    re: /setActive\(\s*0\s*\)/g,
    why: '🔴 feedback หน้างาน 02/10 — เครื่องสแกนบาร์โค้ด **ส่ง Enter ตามท้ายรหัสเสมอ** (บางรุ่น CR+LF '
       + '= 2 ครั้ง) · ถ้า picker เปิดลิสต์แล้ว "เล็งแถวแรก" ไว้ Enter ที่หลงเข้ามาจะเลือกตัวบนสุดให้เอง '
       + 'เงียบๆ · เคสจริง: สแกน PROD.NO ซ้ำ → focus เด้งมาช่อง MAT → **MAT เปลี่ยนเป็นพาร์ทอื่น** '
       + '(98881640 → MAT 10092454 BUMPER REINF คนละพาร์ท) ⇒ ถ้ากดเปิด Order ต่อ = ใบผลิตผูกพาร์ทผิด',
    fix: 'ใช้ `initialActiveRow(q)` / `moveActiveRow()` จาก `src/utils/pickerKeys.js` (มีเทส) — '
       + 'ไม่มีคำค้น = `NO_ROW` (ไม่เล็งอะไร) · มีคำค้น = แถวแรกของผลค้นหา (พิมพ์แล้ว Enter ยังใช้ได้เหมือนเดิม)',
    allow: {},
  },
  {
    id: 'shift-capacity-summed-serially',
    scan: ['src/pages', 'src/components'], ext: ['.jsx'],
    /* จับการบวก "ภาระกะ" เองในหน้า — รูปแบบ qty × CT / 60 สะสมลง reducer */
    re: /\breduce\(\s*\([^)]*\)\s*=>\s*[^,]*\bct\w*\([^)]*\)\s*\/\s*60/gi,
    why: '🔴 feedback หน้างาน 02/10 ("ทั้งที่เปิดงานใหม่เครื่องใหม่ขนาน แต่ทำไมแจ้งเวลาเกิน") — '
       + 'ด่านความจุกะเดิมบวก qty×CT ของ **ทุกใบในกะเรียงต่อกันเป็นสายเดียว** โดยไม่สนว่าไลน์เดินกี่เครื่อง '
       + '· วัดจริง ASSEMBLY 1 กะเช้า 02/10: 55 ใบ 2,180 ชิ้น = 2,120 นาที เทียบความจุ 590 '
       + '⇒ แจ้ง "เกิน 1,605 นาที" ทั้งที่ใช้ 6 เครื่องขนาน = ~353 นาที/เครื่อง (ใช้ไป 60% เท่านั้น) '
       + '· ไลน์นั้นลงทะเบียน flow_mode = parallel_machine อยู่แล้ว — `computeLiveOee` อ่านถูกมาตลอด '
       + 'แต่ด่านความจุไม่เคยอ่าน ⇒ modal เด้งทุกใบจนกลายเป็นเสียงรบกวน',
    fix: 'คิดผ่าน `checkShiftCapacity()` / `committedMin()` (`src/utils/shiftCapacity.js` · มีเทส) — '
       + 'แยกภาระเป็น "เลน" ตาม flow_mode + ยุบคู่ RH/LH ด้วย pairLoadTotal (ชิ้น ≠ shot) '
       + '+ คืน unknownCt ให้จอเขียนบอกว่ามีกี่ใบที่คิดเวลาไม่ได้',
    allow: {},
  },
  {
    id: 'purchase-receipt-to-dest-line',
    scan: ['src'], ext: ['.jsx', '.js'],
    /* จับการเอา `dest_line` ของใบสั่งซื้อไปใส่เป็น `line_name` ของแถว ledger
       ⚠️ ต้องมี lookbehind — ไม่งั้นชน `dest_line_name:` ของทะเบียนกฎนำเข้า (stock_inflow_rules)
          ซึ่งเป็นคอลัมน์ "ไลน์ปลายทางของกฎ" คนละเรื่องกับ line_name ของแถว ledger */
    re: /(?<![A-Za-z0-9_])line_name:\s*(?:\w+\.)?(?:dest_line|dest|destLine)\b/g,
    why: '🔴 ต้นเหตุ "stock พาร์ทในไลน์ตายหมด" (01/10) — `purchase_requests.dest_line` คือ '
       + '"ไลน์ไหนจะ**ใช้**ของ" (ได้จากการระเบิด BOM) ไม่ใช่ "ของ**อยู่**ที่ไหน" '
       + 'เอาไปใช้เป็น line_name = ของทั้ง PO เด้งไปกองหน้าไลน์ทันที ข้ามสโตร์ทั้งขั้น '
       + '· วัดจริง: **10 แถว 1,336,000 ชิ้น = 76% ของยอดค้างทั้งระบบ** (น็อตเชื่อม 3 ตัว ลงวันเดียว 4 ไลน์) '
       + 'และขัดกับลูปสโตร์เองที่ `deductStockForPick` หัก STORE แล้วบวกเข้าไลน์ '
       + '(ลูปนั้นเตือนอยู่แล้วว่า "STORE ไม่มีแถวสต็อกของพาร์ทนี้ — ลงรับเข้า STORE ก่อน")',
    fix: 'สร้างแถวผ่าน `buildReceiptRows()` (`src/utils/stockReceipt.js` · มีเทส) — ลงที่ `RECEIPT_LINE` '
       + 'เสมอ แล้วเขียน "ไลน์ที่รอของ" ไว้ในหมายเหตุ · ของจะไปอยู่หน้าไลน์ได้ต่อเมื่อมีการเบิกจริง',
    allow: {},
  },
  {
    id: 'wip-buffer-points-write',
    scan: ['src'], ext: ['.jsx', '.js'],
    /* จับการ "เขียน" กลับเข้าตารางจุด WIP หรือเรียก RPC เติมยอดจุด — อ่านไม่ห้าม (ลบทิ้งตอนลบไลน์ยังต้องทำ)
       ⚠️ ด้านล่างจงใจไม่จับ `.delete()` — LineSetup ยังต้องเก็บกวาดแถวกำพร้าตอนลบไลน์ */
    re: /from\(\s*['"`]wip_buffer_points['"`]\s*\)\s*\.\s*(insert|update|upsert)\b|\bwip_point_add_qty\b/g,
    why: '🔴 2026-10-01 คำสั่ง user — **เลิกชั้น "จุดย่อยในไลน์" ถาวร** · ของหน้าไลน์คุมที่ '
       + '"พื้นที่ (SLoc เช่น P411 — ตรง SAP) → ไลน์ย่อยสุด → พาร์ท" ผ่าน `line_part_levels` เท่านั้น '
       + '· วัดกับฐานจริง 01/10: ใบขอเติม 25 ใบ **ผูกจุด WIP 0 ใบ** (ทางนี้ไม่เคยถูกใช้จริง) '
       + 'และ `current_qty` ของ 10 จุดที่มียอด **เท่ากับ min เป๊ะทุกตัว ไม่ขยับตั้งแต่ 1 ก.ย.** '
       + '— ไม่มีใครหักยอดออกตอนใช้ ⇒ ยอดที่จุดเป็นของปลอม และยอดปลอมจุดเดียวทำให้คนเลิกเชื่อทั้งจอ '
       + '· อีก 18 จุดเป็นชื่อซ้ำที่ต่างกันแค่ช่องว่างท้ายบรรทัด / max=1-2 (นับภาชนะ ไม่ใช่ชิ้น) / แถว test',
    fix: 'ตั้ง min/max ที่ "ไลน์ + พาร์ท" ใน `line_part_levels` (จอ: Daily Report → ⚙️ ตั้งจุดเรียกเติม) '
       + '· ปลายทางของการส่งของคือ **ป้าย QR จุดส่ง** (`line_delivery_points` = "ที่อยู่" ไม่มียอด) '
       + '· ตาราง `wip_buffer_points` คงไว้อ่านประวัติเท่านั้น — ห้ามมีจอไหนเขียนอีก '
       + '· อ่านเหตุผลเต็ม: docs/modules/demand-flow-tower.md §เลิกจุด WIP',
    allow: {},
  },
  {
    id: 'picker-label-stuffed-with-codes',
    scan: ['src'], ext: ['.jsx', '.js'],
    /* จับการยัด "หลายรหัส + ชื่อ" ลง `label:` ของ option ในนิพจน์เดียว
       (label = บรรทัดเดียว ถูก ellipsis ตัดท้าย ⇒ ตัวท้ายหายทุกแถว) */
    /* ⚠️ ขยาย 06/10 — เดิมจับเฉพาะ "2 รหัสปนกัน" (p_no + mat_no) ⇒ พลาดรูปที่พบจริงบ่อยกว่า:
       **ข้อความอิสระมาก่อน แล้วรหัสต่อท้าย** (`${p.name} · MAT ${p.mat_no}` ที่ /line-stock)
       ellipsis กินท้ายบรรทัด ⇒ รหัสที่อยู่ท้ายสุดหายทุกแถว = กลไกเสียหายตัวเดียวกันเป๊ะ
       · รูป "รหัสมาก่อน ข้อความต่อท้าย" (`${p.mat_no} · ${p.name}`) **ไม่เข้าข่าย** —
         ellipsis กินชื่อ ซึ่งเดาต่อได้ ไม่ใช่รหัสที่อ่านผิดตัวได้ */
    re: /\blabel:\s*`[^`]*\b(p_no|part_no|partNo)\b[^`]*\bmat_no\b|\blabel:\s*`[^`]*\bmat_no\b[^`]*\b(p_no|part_no|partNo)\b|\blabel:\s*`[^`]*\b(name|part_name)\b[^`]*(\bmat_no\b|MAT )/g,
    why: 'feedback หน้างาน 30/09 ("ตอนเปิด Tag ตรงนี้ขอเห็นเลข Mat ด้วยครับ") — ลิสต์เลือก MAT.NO '
       + 'ยัด Part No. + ชื่อสินค้า + MAT ลง `label` บรรทัดเดียว แล้ว `textOverflow: ellipsis` '
       + 'กินท้ายบรรทัด ⇒ **เลข MAT หายทุกแถว** เพราะอยู่ท้ายสุด '
       + '· รหัสที่ถูกตัดครึ่งไม่ได้แค่ "อ่านไม่ครบ" แต่ **อ่านผิดตัวได้** (10105769 กับ 10105770 ต่างกันตัวเดียว)',
    fix: 'แยกเป็นช่อง "รหัส (ห้ามตัด)" กับ "ข้อความ (ตัดได้)" ของ <SearchSelect>: '
       + '`lead` = Part No. · `title` = ชื่อ (ตัดได้ตัวเดียว) · `code` = `MAT <เลข>` · `sub` = ลูกค้า/ไลน์ '
       + '· `label` เหลือไว้เป็น **ค่าที่ฟอร์มเก็บจริง** เท่านั้น (ตัวอย่าง: `productOptions()` ใน src/utils/pickerOptions.js)',
    allow: {},
  },
  {
    id: 'partno-headline-via-lead',
    scan: ['src'], ext: ['.jsx', '.js'],
    /* จับการตัดสิน "ใครขึ้นหัว" จากการมีค่า pNo ตรงๆ — ต้องใช้ `info.lead` จาก matInfo แทน
       (จับได้เฉพาะรูปที่เอาไปใช้เป็นเงื่อนไข: `.pNo ?` / `.pNo &&` / `!.pNo` — การอ่านค่าไปโชว์ไม่เข้าข่าย) */
    re: /\b\w+\.pNo\s*(\?[^?]|&&)|![a-zA-Z_$][\w$]*\.pNo\b/g,
    why: 'วัดทะเบียนจริง 30/09 (parts_master 346 แถว): ช่อง `part_no` ของ **วัตถุดิบ 5xx** '
       + 'ไม่ได้เก็บเลขพาร์ท แต่เก็บ "เอาไปทำงานอะไร" เป็นประโยค — หน้าตาเป็นเลขพาร์ทแค่ 18% '
       + '(1xx/2xx/3xx = 99/99/95%) ยาวสุด 72 ตัวอักษร มีภาษาไทยปน (mat 50026144) '
       + '⇒ โค้ดที่เช็คแค่ "มี pNo ไหม" แล้วเอาขึ้นหัว จะทำให้การ์ด/ตารางวัตถุดิบ '
       + '**พาดหัวด้วยประโยคยาว จนเลขพาร์ทกับ MAT ถูกดันหลุดจอ**',
    fix: 'ตัดสินด้วย `info.lead` (`\'pno\'|\'name\'|\'mat\'`) ที่ `matInfo()` คืนมา '
       + '— เกณฑ์อยู่ใน `looksLikePartNo()` (`src/utils/matLabel.js`) ที่เดียว '
       + '· ค่าที่ไม่ได้ขึ้นหัว **ห้ามตัดทิ้ง** ให้ตกไปเป็นบรรทัดรอง (clamp + title)',
    allow: {
      'src/utils/matLabel.js': 'เจ้าของกฎ — เป็นที่คำนวณ pNoIsCode/lead เอง',
    },
  },
  {
    id: 'plan-lot-time-via-helper',
    scan: ['src'], ext: ['.jsx', '.js'],
    /* คิดเวลาของล็อตเองในหน้า — `qty_plan × CT` ตรงๆ */
    re: /\bqty_plan\b[^\n]*\*/g,
    why: 'เวลาของล็อตไม่ได้มาจาก `qty_plan × CT` เสมอไปแล้ว (01/10) — **ใบจองเครื่องทดลองงานใหม่** '
       + 'ไม่มีทั้ง `mat_no` และ cycle time (SAP ยังไม่ออกเลข MAT · พาร์ทใหม่ไม่มี CT แน่ๆ) '
       + 'เวลาของมันมาจาก `est_min` = "ที่คนวางแผนขอ" ⇒ หน้าที่คูณเองจะได้ 0 หรือ null '
       + 'แล้วงานทดลองจะหายจากไทม์ไลน์ทั้งที่เครื่องถูกจองไปจริงหลายชั่วโมง (แผนโกหกว่าไลน์ว่าง)',
    fix: 'เรียก `lotRunMin(lot, ctOf)` หรือ `lotRunInfo(lot, ctOf)` (`src/utils/planLots.js`) '
       + '· `lotRunInfo().from` บอกว่าเลขนั้นมาจากระบบคำนวณ (ct) หรือคนกรอก (est) '
       + '— จอต้องเขียนให้ต่างกัน ห้ามโชว์เหมือนกัน',
    allow: {
      'src/utils/planLots.js': 'เจ้าของสูตร — เป็นที่คิด qty × CT เอง',
    },
  },
  {
    id: 'legacy-redirect-keeps-query',
    scan: ['src/App.jsx'], ext: ['.jsx'],
    /* route เก่าที่ยุบเป็นแท็บ แต่ redirect ด้วย <Navigate to="...?tab=..."> ลอยๆ */
    re: /<Navigate\s+to="[^"]*\?tab=/g,
    why: '`<Navigate to="/pm?tab=forecast">` **ทิ้ง query เดิมทั้งหมด** — ลิงก์/บุ๊กมาร์กเก่า `/pm-forecast?tab=usage` '
       + 'ตกแท็บแรกเงียบๆ และ `?dept=`/`?line=` หาย (QC 05/10: PM 5 route + Daily Checker 4 route)',
    fix: 'ใช้ `<LegacyTabRedirect to="/pm" tab="forecast" subParam="fc" />` (App.jsx) — ส่งต่อ param ครบ '
       + 'และย้าย `?tab=` เก่าไปเป็น param ของหน้าลูก (ชื่อเดียวกับที่หน้าลูกส่งให้ useTabParam)',
    allow: {},
  },
  {
    id: 'mobile-fixed-bottom-needs-mnav',
    scan: ['src'], ext: ['.jsx'],
    /* ของ position:fixed ที่ชิดล่างด้วยตัวเลข (bottom: 12) — แถบล่างมือถือ (MobileNavBar 56px) จะทับ */
    re: /position:\s*'fixed'[^\n]*\bbottom:\s*[1-9]\d*\s*[,}]/g,
    why: 'มือถือมีแถบล่าง 4 ช่อง (MobileNavBar · 15/10) ⇒ toast/ไซเรน/ปุ่มลอยที่ตั้ง `bottom: 12` ตรงๆ ถูกแถบทับ กดไม่ได้ '
       + '(docs/MOBILE-UX-STANDARD.md §3)',
    fix: "ใช้ `bottom: 'calc(12px + var(--mnav-h, 0px))'` — จอคอมตัวแปรไม่มีค่า = 0 = ตำแหน่งเดิมเป๊ะ "
       + '(⚠️ `position: sticky; bottom` ห้ามบวก — body มี padding เท่าแถบแล้ว)',
    allow: {},
  },
  {
    id: 'daily-report-close-by-permission',
    scan: ['src/pages/DailyReport.jsx'], ext: ['.jsx'],
    /* ตัดสิน "ปิดตรง vs ส่งขอปิด" ด้วยชื่อ role */
    re: /(isLeaderRequest\s*=\s*role\s*===|role\s*===\s*'leader'\s*\?\s*'📋)/g,
    why: 'ปิดกะตรง/ส่งขอปิดเคยตัดสินด้วย `role === \'leader\'` ⇒ role ที่ /permissions แจก `request_close` อย่างเดียว '
       + '(ไม่มี `close_shift`) **ปิดกะตรงข้ามการอนุมัติ SV ได้** (QC 05/10)',
    fix: 'ใช้ `closeIsRequest` (= `!can(\'daily_report\',\'close_shift\')`) ที่ประกาศคู่ canManage',
    allow: {},
  },
  {
    id: 'daily-report-backfill-shift-window',
    scan: ['src/pages/DailyReport.jsx'], ext: ['.jsx'],
    /* เช็คเวลาย้อนหลังด้วยช่วงชั่วโมงตายตัว 08–20 */
    re: /\b\w+\s*>=\s*8\s*&&\s*\w+\s*<\s*20\b/g,
    why: 'ด่านเวลาย้อนหลังเคย hardcode 08–20 ⇒ กะดึกที่เริ่ม 22:30 / กะเช้าลาก OT ข้าม 20:00 ถูกบล็อกผิด '
       + 'และกะดึกกรอก 08:30 (ส่งกะ) ถูกตีว่าหลุดกรอบ (QC 05/10 · CLAUDE.md §เวลาที่คนกรอก ต้อง resolve ด้วยกรอบกะจริง)',
    fix: '`backfillWindowError(hhmm)` ใน DailyReport (→ `resolveShiftTime` + `checkShiftTime` ของ src/utils/shiftWindow.js)',
    allow: {},
  },
];

function violations(rule) {
  const files = rule.scan.flatMap(d => walk(join(ROOT, d), rule.ext));
  const hits = [];
  for (const file of files) {
    const rel = relative(ROOT, file);
    if (rule.allow[rel]) continue;
    const raw = readFileSync(file, 'utf8');
    const code = rule.ext.includes('.sql') ? raw.replace(/--[^\n]*/g, '') : stripComments(raw);
    code.split('\n').forEach((line, i) => {
      rule.re.lastIndex = 0;
      if (rule.re.test(line)) hits.push(`${rel}:${i + 1}  ${line.trim().slice(0, 110)}`);
    });
  }
  return hits;
}

for (const rule of RULES) {
  test(`🛡️ ${rule.id} — ${rule.why.slice(0, 70)}…`, () => {
    const hits = violations(rule);
    assert.deepEqual(hits, [],
      `\n\n❌ กฎ "${rule.id}" ถูกละเมิด ${hits.length} จุด\n`
      + `   ทำไมห้าม: ${rule.why}\n`
      + `   แก้ยังไง: ${rule.fix}\n\n`
      + hits.map(h => '   • ' + h).join('\n')
      + `\n\n   (ยกเว้นจริงๆ ให้เติม allow ใน src/utils/__tests__/regressionGuards.test.mjs พร้อมเหตุผล)\n`);
  });
}

/* 🛡️ session-status-no-neq (2026-10-08)
   มีสถานะกะ `void` ("ไม่ใช่กะจริง") แล้ว ⇒ `.neq('status', …)` บน `production_sessions` อันตราย:
   "ไม่ใช่ closed" จะลากใบโมฆะเข้ามาเป็น **กะที่เปิดค้าง** · "ไม่ใช่ open" จะนับเป็น **วันผลิต**
   (เจอจริง 2 จุดตอนเพิ่มสถานะ: ObeyaKpiBoard "กะเปิดค้าง" · Improvements ตัวหารวันผลิต)
   ⇒ ต้องระบุสถานะที่ต้องการเป็นรายตัวผ่าน `SESSION_STATUSES_*` (`utils/sessionStatus.js`) */
test('🛡️ session-status-no-neq — คิวรี production_sessions ห้ามใช้ .neq(\'status\', …)', () => {
  const bad = [];
  for (const file of walk(join(ROOT, 'src'), ['.jsx', '.js'])) {
    const rel = relative(ROOT, file);
    if (rel === 'src/utils/sessionStatus.js') continue;           // ตัวนิยามกฎเอง
    const code = stripComments(readFileSync(file, 'utf8'));
    const re = /from\(\s*'production_sessions'\s*\)/g;
    let m;
    while ((m = re.exec(code))) {
      const at = m.index + m[0].length;          // JS: regex match ไม่มี .end() (อย่าเผลอเขียนแบบ Python)
      const nextQ = code.indexOf("from('", at);
      const win = code.slice(at, nextQ === -1 ? at + 420 : Math.min(nextQ, at + 420));
      if (/\.neq\(\s*'status'/.test(win)) bad.push(`${rel}:${code.slice(0, m.index).split('\n').length}`);
    }
  }
  assert.deepEqual(bad, [],
    '\n\n❌ ใช้ .neq(\'status\', …) กับ production_sessions — ใบโมฆะ (void) จะหลุดเข้ามาเงียบๆ\n'
    + "   แก้: .in('status', SESSION_STATUSES_LIVE / _DONE / _REAL) จาก utils/sessionStatus.js\n"
    + `   จุดที่ผิด: ${bad.join(' · ')}\n`);
});

/* 🛡️ open-shift-date-and-shift-together (2026-10-06)
   ฟอร์ม "เปิดกะใหม่" ต้องตั้ง **วันทำงาน + กะ พร้อมกัน** จาก `openShiftDefaults()` (`utils/workDate.js`)
   เดิมปุ่มรีเฟรชแค่ `shift` จากนาฬิกา ปล่อย `work_date` ค้าง ⇒ ตอน 07:40 ได้ "กะดึกของวันนี้"
   = เริ่ม 20:00 คืนนี้ = เปิดกะล่วงหน้า 12 ชม. (เคสจริง LINE C 05/10 · ปิดทิ้งใน 1 นาที
   เหลือใบผี shift_min 720 ค้างในฐาน แล้วไปโผล่เป็นแถบ 12 ชม. บนไทม์ไลน์)
   ⇒ ห้ามมีจุดไหนตั้ง `shift:` ให้ฟอร์มเปิดกะ โดยไม่ตั้ง `work_date` ในก้อนเดียวกัน
   (ช่อง dropdown ที่คนเลือกกะเอง = ตั้งแค่ `start_time` ไม่เข้าข่าย) */
test('🛡️ open-shift-date-and-shift-together — ฟอร์มเปิดกะห้ามตั้ง shift โดยไม่ตั้ง work_date', () => {
  const bad = [];
  for (const file of walk(join(ROOT, 'src'), ['.jsx', '.js'])) {
    const rel = relative(ROOT, file);
    const code = stripComments(readFileSync(file, 'utf8'));
    const re = /setOpenForm\s*\(/g;
    let m;
    while ((m = re.exec(code))) {
      /* หน้าต่าง = ตัว call นี้เท่านั้น — ตัดก่อนถึง setOpenForm ตัวถัดไป
         (ไม่ตัด = หน้าต่างล้นไปเจอ `shift:` ของ call ข้างล่างแล้วแจ้งผิดจุด) */
      const nextCall = code.indexOf('setOpenForm', m.index + 11);
      const end = Math.min(m.index + 220, nextCall === -1 ? Infinity : nextCall);
      const win = code.slice(m.index, end);
      if (!/\bshift\s*:/.test(win)) continue;              // ไม่ได้ตั้งกะ = ไม่เกี่ยว
      if (/e\.target\.value/.test(win)) continue;           // คนเลือกกะเองจาก dropdown
      if (/openShiftDefaults/.test(win)) continue;          // ใช้ของกลางแล้ว
      if (/work_date\s*:/.test(win)) continue;              // ตั้งคู่กันเองก็ยอม
      bad.push(`${rel}:${code.slice(0, m.index).split('\n').length}`);
    }
  }
  assert.deepEqual(bad, [],
    '\n\n❌ ตั้ง `shift` ให้ฟอร์มเปิดกะโดยไม่ตั้ง `work_date` คู่กัน — ตอนก่อน 08:00 จะได้กะที่ยังไม่เริ่ม\n'
    + '   แก้: setOpenForm(f => ({ ...f, ...openShiftDefaults() }))\n'
    + `   จุดที่ผิด: ${bad.join(' · ')}\n`);
});

/* 🛡️ close-time-needs-downtimes (2026-10-05)
   `checkCloseTime()` ตัดสินว่า "เวลาปิดกะที่กรอกล้ำหน้าเวลาจริงเกินไปไหม" — แต่ปลายกะที่
   **ลง downtime คลุมไว้แล้ว ไม่ใช่ความผิด** (ปิดงานเที่ยงแล้วลง "ไม่มีแผนผลิต" ถึงเลิกงาน
   = กะเดินถึงเวลานั้นจริง ส่วนที่เหลือเป็น planned stop ที่ถูกกันออกจากฐานเวลาไปแล้ว)
   ไม่ส่ง `downtimes` เข้าไป = ฟังก์ชันถือว่าไม่มีอะไรรองรับ ⇒ **เตือนผิด/ติดป้ายผิด**
   วัดจริง 05/10: เกณฑ์ที่ดูแต่ `aheadMin` ติดป้ายผิด 5 ใบจาก 9 ใบที่เข้าเกณฑ์ (SP-72/74/88 · Line 60/61) */
/* ── 🛡️ mo-stale-since-cols (2026-10-13) ──────────────────────────────────────────────
   แผง "ใบค้างขั้นเดิม" นับวันจากเวลาที่ใบ**เข้าขั้นปัจจุบัน** (`STALE_SINCE_COLS` ใน utils/mtnStale.js)
   แต่หน้าลิสต์ MO select แบบ **เลือกคอลัมน์** (`MO_LIST_COLS` — เพื่อ egress ห้ามกลับไป `select('*')`)
   ⇒ เพิ่มคอลัมน์เวลาเข้าขั้นใหม่ในฝั่ง util แล้วลืมเติมใน MO_LIST_COLS = ค่านั้นเป็น `undefined`
      ⇒ `stageSinceOf()` **ถอยไปนับจากวันแจ้งเงียบๆ** (ตัวเลขเก่ากว่าจริง แต่จอยังขึ้นเป็นปกติ)
   คลาสเดียวกับที่เคยเกิดจริงมาแล้วหลายรอบในโมดูลนี้ (`mtn_head_at`/`approve_at` ที่ต้อง select
   มาด้วยไม่งั้น `mtnCloseStage()` แยก 3 ขั้นปิดใบไม่ออก · `pair_mat_no` ที่ลืม select แล้วนับ 2 เท่า) */
test('🛡️ mo-stale-since-cols — MO_LIST_COLS ต้อง select ทุกคอลัมน์ที่ mtnStale อ่าน', async () => {
  const { STALE_SINCE_COLS } = await import('../mtnStale.js');
  const code = stripComments(readFileSync(join(ROOT, 'src/pages/MtnRepair.jsx'), 'utf8'));
  const m = code.match(/const MO_LIST_COLS\s*=\s*\[([\s\S]*?)\]\.join/);
  assert.ok(m, 'หา MO_LIST_COLS ใน MtnRepair.jsx ไม่เจอ — เปลี่ยนชื่อ/รูปแบบแล้วต้องมาแก้ด่านนี้ด้วย');
  const picked = new Set([...m[1].matchAll(/'([a-z0-9_]+)'/g)].map(x => x[1]));
  const missing = STALE_SINCE_COLS.filter(c => !picked.has(c));
  assert.deepEqual(missing, [],
    '\n\n❌ MO_LIST_COLS ไม่ได้ select คอลัมน์เวลาเข้าขั้นที่ utils/mtnStale.js อ่าน\n'
    + '   ผล: ค่าเป็น undefined ⇒ แผงใบค้างถอยไปนับจากวันแจ้งเงียบๆ (ตัวเลขเก่ากว่าความจริง)\n'
    + `   เติมใน MO_LIST_COLS: ${missing.join(' · ')}\n`);
});

/* ── 🛡️ mo-number-js-sql-parity (2026-10-14) ──────────────────────────────────────────
   เลข MO ออกจริงที่ RPC `mtn_assign_mo_no` (ฝั่ง DB) แต่ **จอตั้งค่าต้องบอกล่วงหน้าได้ว่า
   "ใบถัดไปจะเป็นเลขอะไร"** ⇒ มีสูตรเดียวกัน 2 ฝั่ง (SQL + `src/utils/moNumber.js`)
   คลาสเดียวกับ `snapMachineNo` ↔ `public.machine_key()` — ดริฟท์เมื่อไหร่จอโกหกทันที
   เกิดจริง 14/10: จอบอก MTN "ถัดไป MTN-BM-141026-0001" ของจริง `MTN.2026/10-15`
   และบอก PRODUCTION รหัส `PRD` ของจริง `PRO` (ออกไปแล้ว 708 ใบ)
   ⇒ บังคับว่า migration ที่แตะ RPC ตัวนี้ ต้องแตะ `moNumber.js` ในคอมมิทเดียวกัน (และกลับกัน)
   🔴 ด่านนี้จับ "ลิสต์ทีมรายเดือน" ที่ต้องตรงกัน — เพิ่มทีมฝั่งเดียวแล้วลืมอีกฝั่ง = เลขคนละชุด */
test('🛡️ mo-number-js-sql-parity — ลิสต์ทีม "เลขรีเซ็ตรายเดือน" ต้องตรงกันทั้ง JS และ SQL', async () => {
  const { MONTHLY_TEAM_KEYS, TEAM_MO_FORMAT } = await import('../moNumber.js');
  const dir = join(ROOT, 'supabase/migrations');
  // migration ล่าสุดที่นิยาม mtn_assign_mo_no = ตัวที่รันอยู่จริง
  const owner = readdirSync(dir).filter(f => f.endsWith('.sql'))
    .filter(f => /create\s+or\s+replace\s+function\s+public\.mtn_assign_mo_no/i.test(readFileSync(join(dir, f), 'utf8')))
    .sort().pop();
  assert.ok(owner, 'หา migration ที่นิยาม mtn_assign_mo_no ไม่เจอ — RPC ที่ deploy แล้วต้องมีไฟล์ในรีโปเสมอ');
  const sql = readFileSync(join(dir, owner), 'utf8');
  for (const key of MONTHLY_TEAM_KEYS) {
    assert.ok(new RegExp(`v_dept\\s*=\\s*'${key}'`).test(sql),
      `\n\n❌ ทีม '${key}' อยู่ใน MONTHLY_TEAM_KEYS (JS) แต่ SQL ${owner} ไม่มีสาขาของมัน\n`
      + '   ผล: จอโชว์เลขแบบรายเดือน แต่ DB ออกเลขแบบต่อเนื่อง = จอโกหก\n');
  }
  // กลับทาง: SQL แตกสาขาทีมไหนไว้ JS ต้องรู้จักด้วย
  for (const m of sql.matchAll(/v_dept\s*=\s*'([a-z_]+)'/g)) {
    assert.ok(MONTHLY_TEAM_KEYS.includes(m[1]),
      `\n\n❌ SQL ${owner} แตกสาขาทีม '${m[1]}' แต่ MONTHLY_TEAM_KEYS ใน src/utils/moNumber.js ไม่มี\n`
      + '   ผล: DB ออกเลขรายเดือน แต่จอคิดว่าต่อเนื่อง = บอกเลขถัดไปผิด\n');
  }
  /* ตัวนำหน้า (`O-` = ออกจากระบบ · แยกจากเล่มเขียนมือของทีม MTN) — ถอดฝั่งเดียว = จอกับใบจริงคนละเลข
     🔴 วันที่เลิกเล่มมือได้ ต้องถอดทั้ง 2 ฝั่งในคอมมิทเดียวกัน ด่านนี้จะบังคับให้ */
  for (const [key, f] of Object.entries(TEAM_MO_FORMAT)) {
    if (!f.mark) continue;
    assert.ok(sql.includes(`'${f.mark}'`),
      `\n\n❌ ทีม '${key}' ตั้งตัวนำหน้า '${f.mark}' ใน TEAM_MO_FORMAT แต่ SQL ${owner} ไม่มี\n`
      + '   ผล: จอบอกว่าใบถัดไปขึ้นต้นด้วยตัวนี้ แต่ DB ออกเลขไม่มี = จอโกหก\n');
  }
  /* หาง `-M<n>` ต้องมีตัวนับของตัวเองใน SQL — ถ้า SQL นับแถวเอา (count) แทน จะได้เลขซ้ำตอนกดพร้อมกัน
     และใบที่ถูกลบจะทำให้เลขของใบถัดไปย้อนไปทับของเก่า */
  const anyTail = Object.values(TEAM_MO_FORMAT).some(f => f.monthTail) || true;  // ค่าตั้งต้นต่อหางอยู่แล้ว
  if (anyTail) {
    assert.ok(/':M'/.test(sql) && /'-M'/.test(sql),
      `\n\n❌ JS ต่อหาง '-M<n>' แต่ SQL ${owner} ไม่มีตัวนับลำดับเดือน (คีย์ ':M' + หาง '-M')\n`
      + '   ผล: DB ออกเลขไม่มีหาง แต่จอบอกว่ามี = จอโกหก\n');
    assert.ok(!/count\(\*\)[^;]*\bv_mseq\b/s.test(sql),
      '\n\n❌ ลำดับเดือนต้องมาจากตัวนับ (upsert) ห้ามนับแถวเอา — นับแถว = 2 ใบที่กดพร้อมกันได้เลขเดียวกัน\n');
  }
});

test('🛡️ close-time-needs-downtimes — ทุกจุดที่เรียก checkCloseTime ต้องส่ง downtimes', () => {
  const bad = [];
  for (const file of walk(join(ROOT, 'src'), ['.jsx', '.js'])) {
    const rel = relative(ROOT, file);
    if (rel === 'src/utils/shiftWindow.js') continue;          // ตัวนิยามกฎเอง
    if (rel.includes('__tests__')) continue;                   // เทสตั้งใจเรียกแบบไม่ส่ง เพื่อตรวจ fallback
    const code = stripComments(readFileSync(file, 'utf8'));
    const re = /checkCloseTime\s*\(/g;
    let m;
    while ((m = re.exec(code))) {
      const win = code.slice(m.index, m.index + 260);
      const line = code.slice(0, m.index).split('\n').length;
      if (!/downtimes\s*:/.test(win)) bad.push(`${rel}:${line}`);
    }
  }
  assert.deepEqual(bad, [],
    '\n\n❌ เรียก checkCloseTime โดยไม่ส่ง { downtimes } — ปลายกะที่ลง downtime คลุมไว้แล้วจะถูกเตือนว่าผิด\n'
    + '   แก้: checkCloseTime(hhmm, session, Date.now(), { downtimes: dtLogs })\n'
    + `   จุดที่ขาด: ${bad.join(' · ')}\n`);
});

/* 🛡️ oee-suspect-needs-qbin-embed (2026-09-30)
   ตัวนี้เป็นกฎ "ระดับไฟล์" ไม่ใช่ระดับบรรทัด (เงื่อนไขไขว้กัน 3 อย่าง) จึงเขียนเป็นเทสเดี่ยว
   ไม่ได้อยู่ใน RULES ที่สแกนทีละบรรทัด

   กฎ §7.1 ของ `src/utils/oee.js`: ของสงสัยไม่ถูกนับเข้า %Q จนกว่า QA จะตัดสิน
   ผลพิจารณาอยู่ในทะเบียนถังเหลือง/แดง ⇒ คิวรีที่เอา defect_logs ไปคิด %Q **ต้อง embed ทะเบียนถังมาด้วย**
   ไม่ embed = `suspectState()` คืน 'unknown' ⇒ ระบบถอยไปใช้พฤติกรรมเดิม (นับสงสัยเป็นของเสีย)
   ⇒ จอ 2 จออ่านข้อมูลชุดเดียวกันแล้วตอบ %Q ไม่เท่ากัน — คลาสเดียวกับที่เคยเกิดกับ `excl_from_q` */
/* ── 🛡️ self-save-must-touch-coalesce (2026-10-08) ────────────────────────────────────
   จอที่ "บันทึกเองแล้วเรียกตัวโหลดตรงๆ" **และ** มี `coalesce` ฟัง realtime ของตารางเดียวกัน
   ⇒ realtime ของการเซฟ **ตัวเราเอง** เด้งกลับมาแล้วโหลดซ้ำใน ~600 ms (settleMs)
   เพราะ `lastRun` ของ coalesce ขยับเฉพาะตอน `run()` ของมันเอง — ไม่รู้ว่าเราโหลดไปแล้ว
   วัดจริง 06/10: รายการกะทั้งวันของ DailyReport 667 ครั้ง · ซ้ำใน 2 วิ **293 = 43.9%**
   🔑 แก้ที่ปลาย `load()` ด้วย `<bumpRef>.current?.touch?.()` — ครอบทุกเส้นทางที่โหลด
      **ห้ามเอาการบันทึกไปรอเพดาน** (กดบันทึกแล้วจอนิ่ง 600 ms บนจอกรอกงาน = แย่กว่าเดิม) */
test('🛡️ self-save-must-touch-coalesce — DailyReport.load() ต้องเคาะเพดาน coalesce ตอนจบ', () => {
  const code = stripComments(readFileSync(join(ROOT, 'src/pages/DailyReport.jsx'), 'utf8'));
  assert.match(code, /sessBumpRef\.current\s*=\s*bumpSess/,
    'ต้องผูก bumpSess เข้า ref ใน effect realtime — ไม่ผูก = touch() ไม่มีผล (เงียบ)');
  assert.match(code, /sessBumpRef\.current\?\.touch\?\.\(\)/,
    'ปลาย load() ต้องเรียก sessBumpRef.current?.touch?.() — ไม่เรียก = ทุกครั้งที่บันทึกบนจอที่เงียบ '
  + 'มาก่อน จ่ายรอบโหลดฟรี 1 รอบ (วัดจริง 06/10 = 43.9% ของคิวรีที่หนักสุดในระบบ)');
});

/* ── 🛡️ no-session-object-in-db-effect-deps (2026-10-06) ──────────────────────────────
   deps ของ effect/useCallback ที่ยิง DB **ห้ามมี object** (กฎเหล็กข้อ 9 ใน CLAUDE.md)
   `selSession` เป็นตัวที่พลาดซ้ำได้ง่ายที่สุด เพราะ `load()` ของ DailyReport ปิดท้ายด้วย
     setSelSession(s => s?.id ? (ss.find(x => x.id === s.id) || ss[0]) : ss[0])
   ⇒ ได้ **object ใบใหม่ เนื้อเหมือนเดิมเป๊ะ** ทุกรอบโหลด ⇒ ทุก effect ที่ผูก `selSession` รีรันฟรี

   ผลที่วัดได้ (02/10/2026 · ~40 เครื่อง) — เสียเปล่า 2 ทาง:
   ① effect โหลดข้อมูลกะ ยิง **4 คิวรีหนักใหม่ทั้งชุด** ทั้งที่กะที่เลือกไม่เปลี่ยนอะไรเลย
      (downtime_logs 1,706 · prod_orders+embed 2,112 · ยอดค้าง 3,746 · defect_logs+embed 3,136 req/วัน)
   ② 🔴 effect realtime — cleanup เรียก `bump*.cancel()` แล้วสร้าง `coalesce` ใบใหม่
      ⇒ **"เพิ่งยิงไปเมื่อไหร่" ถูกล้าง ⇒ event ถัดไปยิงทันที = เพดาน LIVE.* หายไปเลย**
      เป็นลูป: bump → load → selSession ใบใหม่ → effect รีรัน → เพดานรีเซ็ต → bump ถัดไปยิงทันที
      ⇒ **ของที่แพงที่สุดคือ "เพดานที่ถูกรีเซ็ต" ไม่ใช่ตัวคิวรีเอง** — ใส่เพดานแล้วแต่ไม่มีผล
   🔑 แก้ด้วย `selSession?.id` + `selSession?.line_name` (string) · ตัวโหลดต้องเป็น `useCallback(..., [])`

   ── `scopeSecs` (array จาก UserContext) = คลาสเดียวกัน (06/10) ──────────────────────
   ได้ array "ใบใหม่เนื้อเดิม" 2 ทาง: ① destructure `sections: scopeSecs = []` — ค่า default
   สร้างใบใหม่**ทุก render** เมื่อ context ส่ง `undefined` · ② `<UserContext.Provider
   value={{ … sections: userSections || [] }}>` ใน App.jsx เป็น object literal ใบใหม่ทุก render
   วัดจริง 02/10 — "คิวรีเดิมเป๊ะ จาก IP+เบราว์เซอร์เดิม ซ้ำภายใน 2 วินาที":
     prod_orders 3,559 (22.5%) · production_sessions 2,597 (21.1%)
     · v_demand_flow_blocks 745 · child_lot_requests 747  ← **เท่ากัน = 2 คิวรีใน load() ตัวเดียว**
       ⇒ พิสูจน์ว่าเป็น "โหลดซ้ำทั้ง load()" ไม่ใช่คนละคนเปิดพร้อมกัน
   ⚠️ ด่านนี้จับเฉพาะ `useCallback`/`useEffect` ที่**ยิง DB จริง** — `useMemo` ที่คิดเลขจาก scopeSecs
      ไม่เข้าข่าย (คิดใหม่ทุก render เปลืองซีพียูเล็กน้อย แต่ไม่จ่าย egress) · รอบแรกที่เขียนด่านนี้
      กว้างเกินไปจนจับ useMemo 3 ตัวที่ไม่ใช่ปัญหา — **ด่านที่จับของดีด้วย จะถูกถอดทิ้งในที่สุด**
   🔑 แก้ด้วยคีย์เนื้อหา: `const scopeKey = useMemo(() => [...scopeSecs].sort().join('|'), [scopeSecs])`
      (useMemo คิดใหม่ทุก render ได้ แต่**ได้ string เท่าเดิม** ⇒ useCallback ที่ผูก scopeKey จึงนิ่ง) */
test('🛡️ no-unstable-ref-in-db-effect-deps — ห้ามใส่ `selSession` (object) / `scopeSecs` (array) ใน deps ของ effect ที่ยิง DB', () => {
  const bad = [];
  for (const file of walk(join(ROOT, 'src'), ['.jsx'])) {
    const rel = relative(ROOT, file);
    const code = stripComments(readFileSync(file, 'utf8'));
    /* เฉพาะ `useCallback(` / `useEffect(` ที่ **ยิง DB จริง** — `useMemo` ที่คิดเลขเฉยๆ ไม่เข้าข่าย
       (ของกลาง/loader ที่ขึ้นต้นด้วย load… นับเป็นยิง DB ด้วย เพราะข้างในมันยิง) */
    const re = /\b(useCallback|useEffect)\(([\s\S]*?)\}\s*,\s*\[([^\]]*)\]\s*\)/g;
    let m;
    while ((m = re.exec(code))) {
      const body = m[2], deps = m[3];
      if (!/(^|[\s,])(selSession|scopeSecs)\s*(,|$)/.test(deps)) continue;
      if (!/supabase|\.from\(|\.rpc\(|\bload[A-Z]\w*\(/.test(body)) continue;   // ไม่ยิง DB = ไม่เกี่ยว
      bad.push(`${rel}:${code.slice(0, m.index).split('\n').length}  deps = [${deps.replace(/\s+/g, ' ').trim().slice(0, 90)}]`);
    }
  }
  assert.deepEqual(bad, [],
    'deps มี object/array ที่ identity ไม่นิ่ง — `selSession` → ใช้ `selSession?.id`/`?.line_name` · '
  + '`scopeSecs` → ใช้คีย์เนื้อหา `[...scopeSecs].sort().join("|")` (ดู `scopeKey` ใน DailyReport.jsx) · '
  + 'ใบใหม่เนื้อเดิม = ยิงคิวรีซ้ำ **และล้างเพดาน coalesce** · '
  + 'เหตุผล + ตัวเลขที่วัดมา ดูคอมเมนต์เหนือเทสนี้ และที่ effect ใน src/pages/DailyReport.jsx');
});

/* ── 🛡️ list-thumb-needs-lazy (2026-10-05) ────────────────────────────────────────────
   รูป "ย่อในลิสต์" (กว้าง/สูง ≤ 64px) ที่ชี้ไป Supabase Storage **ต้องมี `loading="lazy"`**
   เพราะ thumbnail 34-52px ดาวน์โหลด**ไฟล์เต็มใบ ~19-90 KB** เสมอ (ระบบนี้ไม่มี image transform
   — เป็นฟีเจอร์ของ Pro เท่านั้น) ⇒ เปิดหน้าทีเดียวโหลดทุกแถว ทั้งที่คนเห็นบนจอ ~6-10 แถว
   วัดจริง 02/10/2026 (storage egress รวม 74 MB/วัน = 1.4 GB/เดือน ≈ 28% ของโควต้า Free ทั้งก้อน):
     jig-images 24.2 MB · employee-photos 22.7 MB · mtn-images 17.1 MB · signatures 7.0 MB
   ดูรายนาทีแล้วเป็น **การเปิดหน้าแกลเลอรี**: 47 รูป = 4.08 MB ในนาทีเดียวจากเครื่องเดียว
   ⚠️ ห้ามใส่ `loading="lazy"` กับรูปที่มี `ref=`/`onLoad=` (ผังโรงงาน/ผังชั้นวาง/โมดัลซูม) —
      พวกนั้นต้องวัดขนาดจริงตอนโหลดเพื่อวาง marker ⇒ lazy = คำนวณพิกัดจากรูปที่ยังไม่มา */
test('🛡️ list-thumb-needs-lazy — รูปย่อในลิสต์ (≤64px) ต้องมี loading="lazy"', () => {
  const bad = [];
  for (const file of walk(join(ROOT, 'src'), ['.jsx'])) {
    const rel = relative(ROOT, file);
    const code = stripComments(readFileSync(file, 'utf8'));
    const re = /<img\b[\s\S]{0,600}?\/>/g;
    let m;
    while ((m = re.exec(code))) {
      const tag = m[0];
      if (tag.includes('loading=')) continue;
      if (/\bref=|onLoad=/.test(tag)) continue;              // รูปที่ต้องวัดขนาด — ห้าม lazy
      if (!/\bsrc=\{/.test(tag)) continue;                   // โลโก้ import มา = อยู่ในบันเดิล ไม่ใช่ egress
      // ขนาดเล็กทั้ง width และ height = thumbnail ในลิสต์ (รูปเต็ม/โมดัลใช้ maxWidth/maxHeight)
      const w = /(?:^|[^x])\bwidth:\s*(\d+)\b/.exec(tag);
      const h = /(?:^|[^x])\bheight:\s*(\d+)\b/.exec(tag);
      if (!w || !h) continue;
      if (Number(w[1]) > 64 || Number(h[1]) > 64) continue;
      bad.push(`${rel}:${code.slice(0, m.index).split('\n').length}  ${tag.replace(/\s+/g, ' ').slice(0, 100)}`);
    }
  }
  assert.deepEqual(bad, [],
    'รูปย่อในลิสต์ที่ยังไม่มี loading="lazy" — ใส่ `loading="lazy"` ที่แท็ก <img> '
  + '(รูปที่ต้องวัดขนาดด้วย ref/onLoad ยกเว้นให้แล้ว) · เหตุผล + ตัวเลขดูคอมเมนต์เหนือเทสนี้');
});

/* ── 🛡️ unfiltered-session-bump-needs-shift-tier (2026-10-05) ─────────────────────────
   subscribe `production_sessions` ของ DailyReport **กรองด้วยไลน์ไม่ได้** (หน้านี้ต้องแสดง
   "รายการกะทั้งวัน" จึงต้องรู้เมื่อไลน์อื่นเปิดกะใหม่) ⇒ ทุก event ของทั้งโรงงาน ~20 ไลน์
   ถึงทุกเครื่องที่เปิดหน้านี้ ~40 เครื่อง · แต่เนื้อที่จอใช้ (รายการกะ + ยอดค้างกะก่อน)
   เปลี่ยน**ไม่กี่ครั้งต่อกะ** ⇒ เพดาน 15 วิ (LIVE.PAGE) จ่าย egress ~20 เท่าโดยไม่มีใครเห็นของใหม่
   วัดจริง 02/10/2026: ยอดค้างกะก่อน 3,746 req/วัน + รายการกะทั้งวัน 2,564 req/วัน
     = **คู่คิวรีที่หนักที่สุดของทั้งระบบ** (40-41 เครื่อง) ⇒ ย้ายเป็น LIVE.SHIFT = −5,250 req/วัน
   🔴 LIVE.PAGE ถูกต้องสำหรับ bumpOrd/bumpDt/bumpDef เท่านั้น — 3 ตัวนั้นกรอง `session_id` ฝั่ง server แล้ว
   (เป็นเทสแยก ไม่ใช่กฎในลิสต์ เพราะตัวสแกนของลิสต์ตรวจ**บรรทัดต่อบรรทัด** จับ coalesce ที่คร่อม 4 บรรทัดไม่ได้) */
test('🛡️ unfiltered-session-bump-needs-shift-tier — bump ที่เกาะ subscribe ซึ่งกรองไลน์ไม่ได้ ต้องใช้ LIVE.SHIFT', () => {
  const code = stripComments(readFileSync(join(ROOT, 'src/pages/DailyReport.jsx'), 'utf8'));
  const m = /bumpSess\s*=\s*coalesce\([\s\S]{0,400}?LIVE\.([A-Z]+)/.exec(code);
  assert.ok(m, 'หา `bumpSess = coalesce(…, LIVE.*)` ใน DailyReport.jsx ไม่เจอ — เปลี่ยนชื่อ/ย้ายที่ '
             + '(หรือเลิกใช้เพดานจาก refreshRates) แล้วต้องมาแก้เทสนี้ด้วย ห้ามลบทิ้งเฉยๆ');
  assert.equal(m[1], 'SHIFT',
    'bumpSess (subscribe `production_sessions` ทั้งตาราง กรองไลน์ไม่ได้) ต้องใช้เพดาน LIVE.SHIFT (5 นาที) '
  + 'ไม่ใช่ LIVE.PAGE — วัดจริง 02/10/2026: LIVE.PAGE ทำให้ 2 คิวรีนี้รวม 6,310 req/วัน '
  + 'ทั้งที่เนื้อเปลี่ยนไม่กี่ครั้งต่อกะ · เหตุผลเต็ม + ตัวเลข ดู LIVE.SHIFT ใน src/utils/refreshRates.js');
});

test('🛡️ oee-suspect-needs-qbin-embed — ทุกคิวรีที่ดึง qty_suspect ในไฟล์ที่คิด %Q ต้อง embed ทะเบียนถัง', () => {
  const Q_HELPERS = /\b(defectQty|sumDefectQty|splitDefectQty|sumSuspectPending|suspectPendingQty)\b/;
  /* ยกเว้นรายคิวรี — ต้องเขียนเหตุผลทุกตัว · 05/10: เปลี่ยนจาก "ไฟล์:บรรทัด" เป็น "ไฟล์ + ข้อความใน select"
     (คีย์บรรทัดเลื่อนทุกครั้งที่ใครแก้ไฟล์ข้างบน ⇒ ด่านล้มทั้งที่คิวรีเดิมไม่ได้เปลี่ยน) */
  const ALLOW = {
    'src/pages/FactoryMap.jsx': [
      ["select('session_id, qty_ng, qty_suspect')", 'แผงทบทวนทั้งวัน — NG ดิบของไลน์ (ไม่ได้เอาไปคิด %Q · %Q ใช้ค่า stamp ของกะ)'],
      ['qty_suspect, qty_repair, description', 'popup รายการของเสียของกะ — แสดง ng/สงสัย/ซ่อม แยกกัน ไม่รวมเป็นตัวเลขเดียว'],
    ],
  };
  const bad = [];
  for (const file of walk(join(ROOT, 'src'), ['.jsx', '.js'])) {
    const rel = relative(ROOT, file);
    if (rel === 'src/utils/oee.js') continue;                 // ตัวนิยามกฎเอง
    const code = stripComments(readFileSync(file, 'utf8'));
    if (!Q_HELPERS.test(code)) continue;                      // ไฟล์นี้ไม่ได้คิด %Q = ไม่เกี่ยว
    const re = /from\(\s*'defect_logs'\s*\)/g;
    let m;
    while ((m = re.exec(code))) {
      const win = code.slice(m.index, m.index + 500);         // ตัวคิวรีตั้งแต่ from(...) ไปจนจบ select
      if (!win.includes('qty_suspect')) continue;             // ไม่ได้ดึงของสงสัยมา = ไม่เกี่ยว
      const line = code.slice(0, m.index).split('\n').length;
      const key = `${rel}:${line}`;
      if ((ALLOW[rel] || []).some(([snip]) => win.includes(snip))) continue;
      if (!win.includes('QBIN_EMBED')) bad.push(key);
    }
  }
  assert.deepEqual(bad, [],
    '\n\n❌ คิวรีที่ดึง qty_suspect ไปใช้ในไฟล์ที่คิด %Q แต่ไม่ได้ embed ทะเบียนถังเหลือง/แดง\n'
    + '   ทำไมห้าม: ไม่ embed ⇒ suspectState() ตอบไม่ได้ ระบบถอยไปนับ "ของสงสัย" เป็นของเสียตามพฤติกรรมเดิม\n'
    + '            ⇒ %Q ของจอนี้ไม่เท่ากับจออื่นที่ embed มา (ข้อมูลชุดเดียวกัน 2 คำตอบ)\n'
    + '            กฎเต็ม: §7.1 ใน src/utils/oee.js — ของสงสัยยังไม่ใช่ของเสียจนกว่า QA จะตัดสิน\n'
    + '   แก้ยังไง: import { QBIN_EMBED } from "../utils/oee" แล้วต่อท้าย select:\n'
    + '            .select(`session_id, qty_ng, qty_suspect, is_trial, ..., ${QBIN_EMBED}`)\n'
    + '            ถ้าคิวรีนั้นแสดงยอดดิบจริงๆ ไม่ได้คิด %Q ให้เติม ALLOW ในเทสนี้พร้อมเหตุผล\n\n'
    + bad.map(f => '   • ' + f).join('\n') + '\n');
});

/* 🛡️ oee-live-needs-ngforp (2026-10-04)
   กฎ "ระดับไฟล์" อีกตัว (ต้องดูทั้งก้อน argument ของ computeLiveOee ไม่ใช่บรรทัดเดียว)

   หัวหน้าทัก 04/10: *"P คิดที่งานผลิตได้ งานที่ผลิตเสียออกมาไม่คิด ทำให้ P ตก"* — จริง
   %P วัด**ความเร็ว** ⇒ ชิ้นที่ออกมาเสีย/ทดลอง/รอ QA ก็กินรอบเครื่องเท่าชิ้นดี ต้องอยู่ในตัวเศษ
   ไม่งั้นของเสีย 1 ชิ้นถูกหัก 2 ครั้ง (ทั้ง %P และ %Q) — ตรงกับสูตรสากล Total Count = ดี + เสีย
   🔴 จอที่ลืมส่ง `ngForP` จะ **ไม่พัง ไม่เตือน** แค่ตอบ %P ต่ำกว่าจออื่นเงียบๆ = คลาสเดียวกับ
      ที่เคยเกิดกับ `pairMap` (ลืมส่ง = นับ 2 เท่า) และ `excl_from_q` (ลืม join = Q เพี้ยน) */
test('🛡️ oee-live-needs-ngforp — ทุกจุดที่เรียก computeLiveOee ต้องส่ง ngForP', () => {
  /* ยกเว้นรายจุด (ไฟล์:บรรทัด) — ต้องเขียนเหตุผลทุกตัว */
  const ALLOW = {};
  const bad = [];
  for (const file of walk(join(ROOT, 'src'), ['.jsx', '.js'])) {
    const rel = relative(ROOT, file);
    if (rel === 'src/utils/oee.js') continue;                 // ตัวนิยามเอง
    const code = stripComments(readFileSync(file, 'utf8'));
    const re = /computeLiveOee\(\s*\{/g;
    let m;
    while ((m = re.exec(code))) {
      const win = code.slice(m.index, m.index + 1200);        // ก้อน argument ของ call นี้
      const line = code.slice(0, m.index).split('\n').length;
      const key = `${rel}:${line}`;
      if (ALLOW[key]) continue;
      if (!/\bngForP\s*:/.test(win)) bad.push(key);
    }
  }
  assert.deepEqual(bad, [],
    '\n\n❌ เรียก computeLiveOee แต่ไม่ได้ส่ง ngForP ⇒ %P ของจอนี้นับแค่ "งานดี"\n'
    + '   ทำไมห้าม: ของเสีย/งานทดลอง/ของสงสัย กินรอบเครื่องไปแล้ว ไม่นับ = หักซ้ำทั้ง %P และ %Q\n'
    + '            ⇒ จอนี้ตอบ %P ต่ำกว่าจออื่นที่ส่งมา (ข้อมูลชุดเดียวกัน 2 คำตอบ) และไม่มีอะไรเตือน\n'
    + '   แก้ยังไง: import { ngByMatFrom } from "../utils/oee" แล้วใส่ในก้อน argument:\n'
    + '            ngForP: ngByMatFrom(<แถว defect_logs ของกะนั้น>, <ใบในกะ>)\n'
    + '            คิวรี defect_logs ต้อง embed `prod_orders(mat_no)` (หรือ select prod_order_id + ใบมี id)\n'
    + '            ไม่งั้นชี้ CT ของ NG ไม่ได้ → ตกไปอยู่ noMat (ไม่เข้า %P แต่รายงานออกจอ)\n\n'
    + bad.map(f => '   • ' + f).join('\n') + '\n');
});

test('🛡️ ทุกกฎต้องมี why + fix เขียนกำกับ (ข้อความนี้คือสิ่งที่คนเห็นตอน build ล่ม)', () => {
  for (const r of RULES) {
    assert.ok(r.why && r.why.length > 30, `${r.id}: ต้องเขียน why ให้เข้าใจว่าเคยพังยังไง`);
    assert.ok(r.fix && r.fix.length > 10, `${r.id}: ต้องเขียน fix ว่าให้ใช้อะไรแทน`);
  }
});

test('🛡️ ตัวสแกนต้องไม่จับข้อความในคอมเมนต์ (ไม่งั้นเอกสารในโค้ดกลายเป็นผู้ต้องหา)', () => {
  const src = [
    '// setSearchParams({ dept: d })  ← ห้ามเขียนแบบนี้',
    '/* color-mix( ) ห้ามใช้ */',
    'const ok = 1;',
  ].join('\n');
  const out = stripComments(src);
  assert.ok(!out.includes('setSearchParams({'));
  assert.ok(!out.includes('color-mix('));
  assert.ok(out.includes('const ok = 1;'), 'โค้ดจริงต้องไม่ถูกตัดทิ้ง');
  assert.equal(out.split('\n').length, 3, 'เลขบรรทัดต้องไม่เพี้ยน');
});

test('🛡️ ตัวสแกนต้องไม่พลาดของจริงที่อยู่ในสตริง/JSX', () => {
  const out = stripComments(`const s = "a // b"; setSearchParams({ x: 1 });`);
  assert.ok(out.includes('setSearchParams({'), 'โค้ดหลังสตริงที่มี // ต้องยังถูกตรวจ');
});

/* ═══ กฎเชิงความสัมพันธ์ (regex บรรทัดเดียวจับไม่ได้) ═══════════════════════
   บั๊ก "downtime ที่ทับเวลาพักถูกหักซ้ำ" เขียนคร่อมหลายบรรทัดเสมอ (reduce/forEach สะสม
   `duration_min` ของ category='planned') ⇒ regex ต่อบรรทัดจับไม่ได้เลยสักจุด
   แต่มี invariant ที่จับได้แม่น: **ใครถ่วงน้ำหนักด้วย `wLoad` ต้องได้ `plannedMin` มาจาก
   ตัวที่ตัดช่วงพักแล้ว** — ถ้าไฟล์ import wLoad โดยไม่มีตัวตัดช่วงพักอยู่เลย = น่าสงสัยทันที

   วัดจริง 16/09: กฎนี้จับได้ครบทั้ง 6 จุดที่เป็นบั๊ก (OeeInsightPanel · ObeyaKpiBoard ×2 ·
   vsmLive · monthlyReviewPptx ×2 · VSM) — จุดสุดท้าย QC audit เองก็ตกหล่น เพราะ VSM
   ไม่ได้ import wLoad ตรงๆ แต่เซ็ต `s.plannedMin` ให้ util ไปใช้ */
const BREAK_AWARE = /dtMinBySession|dtMinOutsideBreaks|breakIntervalsIn|policyBreakForShift|policyBreakOverlapMin/;
// สูตรน้ำหนักที่เขียนเองในหน้า: `(s.shift_min || 570) - plannedMin` · `r.shift_min - r.plannedMin`
const INLINE_WLOAD = /shift_?[mM]in[^;\n]{0,30}\)? *- *[A-Za-z_.]*[pP]lanned/;
const WLOAD_ALLOW = {
  'src/utils/obeyaKpi.js':
    'โมดูล pure — รับ rows ที่มี plannedMin มาแล้ว ไม่ได้อ่าน downtime เอง (หน้าที่เรียกเป็นคนรับผิดชอบ)',
  'src/utils/manpowerBoard.js':
    'compareOeeByStaffing (12/10) — เฉลี่ยค่า oee/oee_p ที่ stamp ตอนปิดกะแล้ว ไม่อ่าน downtime เลย → plannedMin = 0 '
    + '→ wLoad ถ่วงด้วย shift_min ล้วน (แบบเดียวกับ axisOee ใน obeyaKpi) = ไม่มีการหักพักซ้ำ',
  'src/pages/PlannerSales.jsx':
    'ตั้งใจไม่โหลด downtime → plannedMin = 0 → wLoad ถอยไปถ่วงด้วย shift_min (มีคอมเมนต์อธิบายที่บรรทัด 883-884) '
    + '= ประมาณการ ไม่ใช่การหักซ้ำ',
};

test('🛡️ no-wload-without-break-helper — ไฟล์ที่ถ่วง OEE ด้วย wLoad ต้องตัด downtime ที่ทับเวลาพักก่อน', () => {
  const files = walk(join(ROOT, 'src'), ['.jsx', '.js']);
  const hits = [];
  for (const file of files) {
    const rel = relative(ROOT, file);
    if (WLOAD_ALLOW[rel] || rel === 'src/utils/oee.js') continue;
    const code = stripComments(readFileSync(file, 'utf8'));
    /* 05/10 (QC audit) ขยาย: นอกจาก import wLoad แล้ว ยังจับ "สูตรน้ำหนักเขียนเอง" `shift_min − planned…`
       (GroupOverview/DeptDashboard เขียนตรงๆ ไม่ import wLoad ⇒ หลุดด่านเดิม ทั้งที่หักพักซ้ำจริง) */
    const usesWLoad = /^import[^\n]*\bwLoad\b/m.test(code)   // ใช้จริง ไม่ใช่แค่ชื่อคล้าย (borrowLoading ฯลฯ)
      || INLINE_WLOAD.test(code);
    if (!usesWLoad) continue;
    if (!BREAK_AWARE.test(code)) hits.push(rel);
  }
  assert.deepEqual(hits, [],
    '\n\n❌ ไฟล์ด้านล่างถ่วงน้ำหนัก OEE ด้วย wLoad แต่ไม่มีตัวตัด downtime ที่ทับเวลาพักเลย\n'
    + '   ทำไมห้าม: พักตามนโยบายถูกกันออกจากฐานเวลาไปแล้ว — เอานาที downtime ที่ตกในช่วงพัก\n'
    + '   มาหักอีก = หักซ้ำ (วัดจริง 90 วัน: 664/1,298 กะ %A ต่ำกว่าจริงเฉลี่ย 1.52 จุด สูงสุด 41.1)\n'
    + '   แก้ยังไง: plannedMin ต้องมาจาก dtMinBySession(sessions, downtimes, breakPolicies)[id].planned\n'
    + '   ⚠️ อย่าลืม select `start_time` ของกะ และ `started_at`/`ended_at` ของ downtime ด้วย\n'
    + '      — ขาดคอลัมน์พวกนี้ ตัวตัดช่วงพักจะคืนค่าดิบเงียบๆ (fix ที่ไม่ fix)\n\n'
    + hits.map(h => '   • ' + h).join('\n')
    + '\n\n   (ยกเว้นจริงๆ ให้เติม WLOAD_ALLOW พร้อมเหตุผล)\n');
});


/* ═══ กฎเชิงความสัมพันธ์ #2 — ช่วงเวลาของพาร์ทต้องอยู่ในกะ (2026-09-17 · user จับได้) ═══
   ใบผลิตถูก "ยืนยันย้อนหลัง" ได้ (หัวหน้าปิดการ์ดเช้าวันรุ่งขึ้น / SV อนุมัติทีหลัง)
   ⇒ confirmed_at / stopped_at ตกนอกเวลาเปิด-ปิดกะของตัวเองได้จริง
   วัดจริง 17/09/2026 (ฐาน DR · กะที่ปิดแล้ว): **251 ใบ ใน 64 กะ ปิดหลังกะจบ เฉลี่ยเกิน 715 นาที
   (~12 ชม.) สูงสุด 13,314 นาที (9.2 วัน)**

   เอาไปประกอบ "ช่วงที่พาร์ทวิ่ง" ตรงๆ ⇒ ฐานเวลายาวเกินจริงหลายเท่า:
     Assy LWR 15/09 กะเช้า · MAT 10105769 มีใบที่ confirmed_at = 08:30 ของ *วันถัดไป*
     ⇒ window 24.5 ชม. ⇒ "ควรได้" 1,278 ชิ้นในกะเดียว ⇒ %P รายชิ้น 6%
     ทั้งที่งานตัวเดียวกันคนละลูกค้า (10105770) ได้ 70%
     (จอโชว์ช่วงเป็น "08:00–08:30" เพราะตัดเหลือ HH:MM เลยดูเหมือนครึ่งชั่วโมง — หลอกตามาก)

   regex บรรทัดเดียวจับไม่ได้ (Math.max(...) กับ clampWinToShift อยู่คนละบรรทัด) และ allow
   ระดับไฟล์ก็ใช้ไม่ได้ (จะข้ามทั้ง DailyReport.jsx ซึ่งเป็นไฟล์ที่ต้องเฝ้าพอดี)
   ⇒ ใช้ invariant: **ไฟล์ไหนประกอบ closedTimes/stopTimes จาก confirmed_at/stopped_at
      ต้อง import clampWinToShift มาใช้ด้วย** */
const BUILDS_MAT_WINDOW = /\bconst\s+(?:closedTimes|stopTimes|openStopTimes)\s*=/;

test('🛡️ mat-window-must-clamp-to-shift — ไฟล์ที่ประกอบช่วงเวลาของพาร์ท ต้องรัดให้อยู่ในกะ', () => {
  const files = walk(join(ROOT, 'src'), ['.jsx', '.js']);
  const hits = [];
  for (const file of files) {
    const rel = relative(ROOT, file);
    if (rel === 'src/utils/oee.js') continue;            // ตัว helper เอง
    const code = stripComments(readFileSync(file, 'utf8'));
    if (!BUILDS_MAT_WINDOW.test(code)) continue;
    if (!/\bclampWinToShift\s*\(/.test(code)) hits.push(rel);
  }
  assert.deepEqual(hits, [],
    '\n\n❌ ไฟล์ด้านล่างประกอบ "ช่วงเวลาที่ MAT.NO วิ่ง" จาก confirmed_at/stopped_at แต่ไม่ได้รัดให้อยู่ในกะ\n'
    + '   ทำไมห้าม: ใบผลิตถูกยืนยันย้อนหลังข้ามวันได้ — วัดจริง 17/09/2026: 251 ใบ ใน 64 กะ ปิดหลังกะจบ\n'
    + '   เฉลี่ยเกิน 715 นาที สูงสุด 13,314 นาที (9.2 วัน) ⇒ ฐานเวลาของพาร์ทยาวเกินจริงหลายเท่า\n'
    + '   เคสจริง: Assy LWR 15/09 กะเช้า MAT 10105769 → "ควรได้" 1,278 ชิ้น ⇒ %P รายชิ้น 6%\n'
    + '   (งานตัวเดียวกันคนละลูกค้าได้ 70%)\n'
    + '   แก้ยังไง: clampWinToShift(startMs, endMs, shiftFrameOf(session)) จาก src/utils/oee.js §7\n'
    + '   ⚠️ ห้ามแก้ด้วยการทิ้งใบที่เวลาเกิน — ยอดผลิตของใบนั้นเป็นของกะนี้จริง หายไม่ได้\n'
    + '   ⚠️ อย่าลืม select work_date / start_time / end_time ของกะมาด้วย ไม่งั้น frame = null = ไม่รัดเงียบๆ\n\n'
    + hits.map(h => '   • ' + h).join('\n') + '\n');
});

test('🛡️ new-table-needs-rls — migration ที่สร้างตารางใหม่ใน public ต้องเปิด RLS ในไฟล์เดียวกัน', () => {
  // บั๊กที่เคยเกิด (22/09/2026 · รอบตรวจสุขภาพโครงสร้าง /schema แท็บ 🩺):
  //   `child_demand_explosions` (DR · 14,505 แถว) ถูกสร้างไว้ตั้งแต่ 25/08 **โดยไม่เปิด RLS**
  //   ฝั่ง DR client วิ่งด้วย role anon เสมอ ⇒ ใครถือ anon key (ฝังอยู่ในบันเดิลเว็บ) **ลบ marker
  //   กันระเบิด BOM ซ้ำได้ทั้งตาราง** ⇒ ใบผลิตถูกระเบิดความต้องการซ้ำ ออเดอร์ลูก/ใบเบิกบรรจุภัณฑ์
  //   งอกเป็นเท่าตัวโดยไม่มีใครรู้ต้นเหตุ · ฝั่ง Main `employee_photo_purge_log` ก็ปล่อยรายชื่อ+
  //   รหัส+ส่วนงานพนักงานให้ anon อ่านได้โดยไม่ต้อง login
  //   ⇒ ตอนนี้ทั้ง 2 project เหลือ "ตาราง public ที่ RLS ปิด = 0" — ด่านนี้คือตัวที่ทำให้มันอยู่ที่ 0
  const SINCE = 20260923;   // บังคับไฟล์ใหม่ตั้งแต่พรุ่งนี้ไป (ของเก่าไล่ปิดครบแล้วด้วยมือ)
  const dir = join(ROOT, 'supabase/migrations');
  const hits = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.sql')) continue;
    if (Number((f.match(/^(\d{8})/) || [])[1] || 0) < SINCE) continue;
    const sql = readFileSync(join(dir, f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
    for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:(\w+)\.)?(\w+)/gi)) {
      const [, schema, name] = m;
      if ((schema || 'public').toLowerCase() !== 'public') continue;   // archive/temp ไม่ผ่าน API อยู่แล้ว
      const rls = new RegExp(`alter\\s+table[\\s\\S]{0,120}?\\b${name}\\b[\\s\\S]{0,80}?enable\\s+row\\s+level\\s+security`, 'i');
      if (!rls.test(sql)) hits.push(`${f} → ${name}`);
    }
  }
  assert.deepEqual(hits, [],
    '\n\n❌ migration ด้านล่างสร้างตารางใหม่ใน schema public แต่ไม่ได้เปิด RLS ในไฟล์เดียวกัน\n'
    + '   ทำไมห้าม: ตารางใน public ถูก expose ผ่าน PostgREST ทันที · RLS ปิด = ไม่มีด่านฝั่งฐานข้อมูลเลย\n'
    + '   ฝั่ง DR client วิ่งด้วย role anon เสมอ (anon key ฝังในบันเดิลเว็บ) ⇒ ใครก็อ่าน/เขียน/ลบได้ทั้งตาราง\n'
    + '   โดยไม่ต้อง login (เคยเกิดจริง 22/09/2026: child_demand_explosions 14,505 แถว ลบทิ้งได้ทั้งตาราง)\n'
    + '   แก้ยังไง: ต่อท้าย `alter table public.<ชื่อ> enable row level security;` แล้วเขียน policy\n'
    + '   ให้ครบทุกคำสั่งที่โค้ดใช้ ด้วย has_perm(\'<คีย์เดียวกับปุ่มบนจอ>\') — `upsert` ต้องมี UPDATE ด้วย\n'
    + '   (ตารางที่ตั้งใจให้ไม่มีใครอ่านเลย เช่น log ของ migration: เปิด RLS แล้วไม่ต้องมี policy)\n'
    + '   ตารางชั่วคราว/สำรองให้สร้างใน schema `archive` แทน — ไม่ถูก expose ผ่าน API\n\n'
    + hits.map(h => '   • ' + h).join('\n') + '\n');
});


/* ═══ กฎเชิงความสัมพันธ์ #3 — เรียก computeLiveOee ต้องส่ง pairMap (2026-09-18 · user ยืนยันนิยาม) ═══
   user: *"ถ้างานคู่ แบบ gang die / 1 shot ได้งาน 2 ชิ้น หรือ คู่ซ้าย-ขวา ต้องนับเป็น shot หรือ cycle"*

   **ชิ้น ≠ shot** — CT ที่ตั้งในทะเบียนคือเวลาต่อ **1 จังหวะเครื่อง** แต่ RH กับ LH ถือ CT
   เต็มคนละค่า ⇒ บวก qty×CT ทั้งสองข้าง = เวลามาตรฐาน 2 เท่า ⇒ %P ทะลุ 100 แล้วโดน
   `Math.min(1, …)` กดเหลือ 100 **เงียบๆ** ⇒ OEE สูงเกินจริงโดยไม่มีใครรู้

   วัดจริง 18/09 บนข้อมูลสด: HDF1 %P ดิบ 159% · LASER-345 160% (จอขึ้น "⚠%P ตัน")
   ratio (เวลามาตรฐาน ÷ เวลาเครื่องเดิน · เกิน 1 = เป็นไปไม่ได้) ก่อน→หลังยุบ 45 วัน:
     LASER-345 1.80→1.04 · HDF2 1.15→0.72 · HDF1 1.14→0.66
     ไลน์ไม่มีคู่ไม่ขยับ (Line 61 0.71 · BENDING E50 0.59) = ยืนยันว่าแตะเฉพาะไลน์งานคู่

   ⚠️ `pairMap` ไม่ส่ง = กลับไปนับ 2 เท่าเงียบๆ (พฤติกรรมเดิม ไม่ throw ไม่เตือน)
      → ต้องมีด่าน ไม่งั้นจอใหม่ที่ลอกโค้ดจอเก่าจะพลาดซ้ำแน่ */
test('🛡️ live-oee-must-pass-pairmap — ทุกจอที่คิด OEE สด ต้องส่ง pairMap (งานคู่ = 1 shot)', () => {
  const files = walk(join(ROOT, 'src'), ['.jsx', '.js']);
  const hits = [];
  for (const file of files) {
    const rel = relative(ROOT, file);
    if (rel === 'src/utils/oee.js') continue;                 // ตัวฟังก์ชันเอง
    const code = stripComments(readFileSync(file, 'utf8'));
    if (!/\bcomputeLiveOee\s*\(\s*\{/.test(code)) continue;   // เรียกจริง ไม่ใช่แค่ import/อ้างชื่อ
    if (!/\bpairMap\s*[:,}]/.test(code)) hits.push(rel);
  }
  assert.deepEqual(hits, [],
    '\n\n❌ ไฟล์ด้านล่างเรียก computeLiveOee แต่ไม่ได้ส่ง pairMap\n'
    + '   ทำไมห้าม: งานคู่ gang die / RH-LH ปั๊ม 1 จังหวะได้ 2 ชิ้น แต่ CT คือเวลาต่อ 1 จังหวะ\n'
    + '   ไม่ส่ง pairMap = บวก qty×CT ทั้งสองข้าง = เวลามาตรฐาน 2 เท่า ⇒ %P ทะลุ 100 แล้วถูก cap เงียบ\n'
    + '   (วัดจริง 18/09: HDF1 %P ดิบ 159% · LASER-345 160% ⇒ OEE สูงเกินจริงทั้ง 4 ไลน์งานคู่)\n'
    + '   แก้ยังไง: โหลด `pair_mat_no` จาก dr_products แล้วส่ง pairMap = { mat_no: pair_mat_no }\n'
    + '   ⚠️ อย่าลืม select `pair_mat_no` ด้วย — ขาดคอลัมน์นี้ pairMap จะว่างเปล่าเงียบๆ (fix ที่ไม่ fix)\n'
    + '   ⚠️ ห้ามยุบคู่ในฝั่งยอดผลิต/%Q — นั่นนับ "ชิ้น" คนละหน่วยกับ "shot"\n\n'
    + hits.map(h => '   • ' + h).join('\n') + '\n');
});

/* 🖤 <Bar> ที่ลูกเป็น <Cell> แต่ไม่มี fill= — tooltip เขียนบรรทัดค่าด้วย "สีของ series" = fill ของ <Bar>
   ไม่มี ⇒ Recharts ตกไปใช้ #000 = ตัวหนังสือดำบน var(--card) ธีมมืด (user 30/09/2026 ส่งภาพ
   "พื้นเขียวเข้ม text ดำ" จากแผ่น DL+OH บอร์ด KPI) · เจอ 7 จุดใน 4 ไฟล์ตอนกวาด
   ⚠️ ต้องดูข้ามบรรทัด (Cell อยู่ในลูก) จึงเขียนเป็นเทสแยก ไม่ใช่กฎใน RULES */
test('🛡️ <Bar> ที่ระบายสีด้วย <Cell> ต้องมี fill={CELL_BAR_FILL} — ไม่งั้น tooltip ตัวหนังสือดำ', () => {
  const bad = [];
  for (const file of walk(join(ROOT, 'src'), ['.jsx'])) {
    const code = stripComments(readFileSync(file, 'utf8'));
    const rel = relative(ROOT, file);
    for (const m of code.matchAll(/<Bar\b([^>]*?)>([\s\S]*?)<\/Bar>/g)) {
      if (/\bfill=/.test(m[1])) continue;              // มี fill แล้ว
      if (!/<Cell\b/.test(m[2])) continue;              // ไม่ได้ระบายรายแท่ง — สี default ของ Recharts ยังอ่านออก
      const line = code.slice(0, m.index).split('\n').length;
      bad.push(`${rel}:${line}  <Bar dataKey=…> มี <Cell> แต่ไม่มี fill=`);
    }
  }
  assert.deepEqual(bad, [],
    `\n❌ แท่งที่ระบายสีด้วย <Cell> ไม่มี fill ที่ <Bar> — tooltip จะเขียนค่าเป็นสีดำบนการ์ดเข้ม:\n  ${bad.join('\n  ')}\n` +
    `   แก้: <Bar fill={CELL_BAR_FILL} …> (จาก src/utils/chartAxis.js — Cell ทับสีที่วาดอยู่แล้ว fill นี้ไปโผล่แค่ใน tooltip)\n` +
    `   + <Tooltip {...tooltipProps(fs)}> ให้พื้น/ตัวหนังสือ/cursor เป็นมาตรฐานเดียวกัน`);
});

/* 🧩 helper กลางที่คืน "ค่าเปล่า" (map/array/null) ห้ามถูกแกะด้วย `{ data: x }` ใน Promise.all
   เคยเกิดจริง 25/09→02/10/2026 (commit 60c4bfc8 ลด egress): แทน `supabaseDR.from('dr_products')…`
   ด้วย `loadPairMap()` ใน 4 ไฟล์ แต่ยังแกะ `{ data: prods }` อยู่ 3 ไฟล์ ⇒ prods = undefined
   · FactoryMap แผงทบทวนรายวัน: `pairMap[m]` ระเบิด → catch กลืน → **0/0 ทุกวัน 7 วันเต็ม** (user ทัก)
   · GroupOverview: เหมือนกัน · ProdProgressStrip: `prods?.[m]` ไม่ระเบิดแต่ **เลิกยุบงานคู่เงียบๆ**
   build/lint/เทส/crashsweep ผ่านหมด — เพราะ error ถูก try/catch ของหน้ากลืน
   ⚠️ ตรวจเฉพาะ Promise.all ที่ destructure เป็น array — เทียบ "ช่องที่ i" กับ "สมาชิกที่ i" */
test('🛡️ loadPairMap/loadOpInfo/loadProductsMaster/loadProductionLines ใน Promise.all — ห้ามแกะ { data }', () => {
  const BARE = ['loadPairMap(', 'loadOpInfo(', 'loadProductsMaster(', 'loadProductionLines('];
  /* แยกสมาชิกระดับบนด้วย comma โดยไม่แตะใน () [] {} และสตริง */
  const splitTop = (src) => {
    const out = []; let depth = 0, cur = '', q = null;
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (q) { cur += c; if (c === q && src[i - 1] !== '\\') q = null; continue; }
      if (c === '"' || c === "'" || c === '`') { q = c; cur += c; continue; }
      if ('([{'.includes(c)) depth++;
      if (')]}'.includes(c)) depth--;
      if (c === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
      cur += c;
    }
    if (cur.trim()) out.push(cur);
    return out.map(x => x.trim());
  };
  const bad = [];
  for (const file of walk(join(ROOT, 'src'), ['.jsx', '.js'])) {
    const code = stripComments(readFileSync(file, 'utf8'));
    const rel = relative(ROOT, file);
    const re = /const\s*\[([^\]]*)\]\s*=\s*await\s+Promise\.all\(\[/g;
    for (const m of code.matchAll(re)) {
      // หา `]` ที่ปิด array ของ Promise.all แบบนับวงเล็บ
      let i = m.index + m[0].length, depth = 1, q = null;
      for (; i < code.length && depth > 0; i++) {
        const c = code[i];
        if (q) { if (c === q && code[i - 1] !== '\\') q = null; continue; }
        if (c === '"' || c === "'" || c === '`') { q = c; continue; }
        if ('([{'.includes(c)) depth++; else if (')]}'.includes(c)) depth--;
      }
      const members = splitTop(code.slice(m.index + m[0].length, i - 1));
      const slots = splitTop(m[1]);
      slots.forEach((slot, k) => {
        const mem = members[k] || '';
        if (!slot.startsWith('{')) return;                       // ไม่ได้แกะ object = ปลอดภัย
        if (!BARE.some(b => mem.startsWith(b))) return;          // ไม่ใช่ helper ค่าเปล่า
        if (/\.then\s*\(/.test(mem)) return;                      // ห่อเป็น { data } เองแล้ว (DeptDashboard)
        const line = code.slice(0, m.index).split('\n').length;
        bad.push(`${rel}:${line}  ช่องที่ ${k + 1} แกะ \`${slot.slice(0, 30)}\` จาก \`${mem.slice(0, 40)}\``);
      });
    }
  }
  assert.deepEqual(bad, [],
    `\n❌ helper กลางคืนค่าเปล่า (map/array/null) แต่ถูกแกะด้วย { data } ⇒ ได้ undefined เงียบๆ:\n  ${bad.join('\n  ')}\n` +
    `   เคยเกิดจริง 25/09–02/10/2026: แผงทบทวนรายวันบนผังรวมเป็น 0/0 ทุกวัน (pairMap undefined → TypeError → catch กลืน)\n` +
    `   แก้: รับค่าตรงๆ \`const [..., pairMap] = await Promise.all([..., loadPairMap()])\` แล้วใช้ \`pairMap?.[m] ?? null\``);
});

/* 🔴 onClick={fn} เมื่อ fn "รับ argument" — React ส่ง click event เป็น arg ตัวแรกเสมอ
   เคยพังจริง 22/09/2026: `openPicker` ถูกเพิ่มพารามิเตอร์ `parentMat` ทีหลัง แต่ call site ยังเป็น
   `onClick={openPicker}` ⇒ event ถูกเก็บลง state → `(m || '').trim()` ระเบิดทั้งจอ
   ("(e || \"\").trim is not a function") · build / lint / เทส / crashsweep **ผ่านหมด**
   ⚠️ ตรวจแบบเทียบกับ "คำประกาศของฟังก์ชันในไฟล์เดียวกัน" ไม่ใช่ regex กว้างๆ —
      handler ที่ไม่รับ arg (openNew/openCreate) ต้องไม่ถูกฟ้อง ไม่งั้นด่านนี้จะกลายเป็นที่รำคาญ */
test('🛡️ onClick={fn} ที่ fn รับ argument — ต้องห่อด้วย () => fn(...)', () => {
  const bad = [];
  for (const file of walk(join(ROOT, 'src'), ['.jsx'])) {
    const code = stripComments(readFileSync(file, 'utf8'));
    const rel = relative(ROOT, file);
    for (const m of code.matchAll(/onClick=\{(\w+)\}/g)) {
      const fn = m[1];
      /* เอาเฉพาะ element จริงของ DOM (<button …>) — คอมโพเนนต์ของเราเอง (<SearchSelect onChange={emit}>)
         ส่ง object ที่ตั้งใจ ไม่ใช่ DOM event ⇒ ไม่ใช่บั๊กคลาสนี้ */
      const openTag = code.lastIndexOf('<', m.index);
      if (openTag < 0 || !/^[a-z]/.test(code.slice(openTag + 1, openTag + 2))) continue;
      // หาคำประกาศในไฟล์เดียวกัน: const fn = (args) =>   /   function fn(args)
      const d = code.match(new RegExp(`(?:const\\s+${fn}\\s*=\\s*(?:async\\s*)?\\(([^)]*)\\)\\s*=>|function\\s+${fn}\\s*\\(([^)]*)\\))`));
      if (!d) continue;                                   // ประกาศที่อื่น/import — ข้าม
      const args = (d[1] ?? d[2] ?? '').trim();
      if (!args) continue;                                // ไม่รับ arg = ปลอดภัย
      if (/^(e|ev|evt|event)\b/.test(args)) continue;      // ตั้งใจรับ event จริง
      const line = code.slice(0, m.index).split('\n').length;
      bad.push(`${rel}:${line}  on…={${fn}} แต่ ${fn} รับ (${args})`);
    }
  }
  assert.deepEqual(bad, [],
    `\n❌ handler รับ argument แต่ผูกตรงๆ — React จะส่ง event เข้าไปแทน:\n  ${bad.join('\n  ')}\n` +
    `   เคยพังจริง 22/09/2026: openPicker(parentMat) ได้ event มา → (m || '').trim() ระเบิดทั้งจอ\n` +
    `   แก้: onClick={() => ${'${fn}'}()} หรือ guard ชนิดใน handler`);
});

test('🛡️ virtual-module-plugin-in-both-vite-configs — plugin ที่หน้าใช้ ต้องมีทั้ง build จริงและ audit', () => {
  const need = 'vite-plugin-schema-usage';
  const uses = walk(join(ROOT, 'src'), ['.jsx', '.js'])
    .filter(f => /from\s+['"]virtual:schema-usage['"]/.test(stripComments(readFileSync(f, 'utf8'))))
    .map(f => relative(ROOT, f));
  if (!uses.length) return;   // ไม่มีหน้าไหนใช้แล้ว = ไม่ต้องบังคับ
  const missing = ['vite.config.js', 'audit/vite.audit.mjs']
    .filter(c => !readFileSync(join(ROOT, c), 'utf8').includes(need));
  assert.deepEqual(missing, [],
    '\n\n❌ config ด้านล่างไม่ได้ต่อ plugin `' + need + '` ทั้งที่มีหน้าที่ import virtual:schema-usage อยู่\n'
    + '   (' + uses.join(', ') + ')\n'
    + '   ทำไมห้าม: virtual module ไม่มีไฟล์จริงบนดิสก์ — config ไหนไม่ต่อ plugin ไว้ หน้านั้น**โหลดไม่ขึ้นเลย**\n'
    + '   ตกที่ audit/vite.audit.mjs = crashsweep/mobilesweep เปิดหน้าไม่ได้ ⇒ หน้าพังโดยไม่มีด่านไหนเห็น\n'
    + '   แก้ยังไง: import schemaUsage จาก scripts/vite-plugin-schema-usage.mjs แล้วใส่ใน plugins ของ config นั้น\n\n'
    + missing.map(h => '   • ' + h).join('\n') + '\n');
});


/* ═══ 👻 พื้นที่กดเผื่อนิ้ว ต้องไม่ถูกนับเป็น "ของล้น" (2026-10-06) ═══
   `src/index.css` @media (pointer:coarse) วาง `button:not(:has(*))::before` absolute + min 40×40
   ทับกลางปุ่มเล็ก = ขยายพื้นที่รับสัมผัสให้คนใส่ถุงมือ โดยไม่ขยับ layout สักพิกเซล
   แต่ pseudo ที่ absolute **นับเข้า scrollWidth ของปุ่ม แล้วลามถึงแถวแม่** ⇒ mobilesweep เห็น
   "แถวล้นปัดไม่ได้" ทั้งที่ไม่มีอะไรโผล่ออกมาเลย (วัด 06/10: desktop sw===cw ทุกปุ่ม ·
   ปุ่มตัวอักษร "X" ก็เป็น = ไม่เกี่ยวอีโมจิ)
   เคยหลงมาแล้ว 05/10 (54da354a): ไล่แก้ที่อีโมจิ แล้ว "หาย" เพราะห่อ <span> ทำให้
   `:not(:has(*))` เลิกแมตช์ = **ถอดพื้นที่กด 40px ทิ้งเงียบๆ** เพื่อให้ตัวเลขในด่านสวย */
test('🛡️ mobilesweep-must-mute-tap-target-ghost — ด่านมือถือต้องตัดพื้นที่กดเผื่อนิ้วก่อนวัด', () => {
  const css = readFileSync(join(ROOT, 'src/index.css'), 'utf8');
  if (!/button:not\(:has\(\*\)\)::before/.test(css)) return;   // เลิกใช้ทริกนี้แล้ว = ไม่ต้องบังคับ
  const sweep = readFileSync(join(ROOT, 'audit/mobilesweep.mjs'), 'utf8');
  const muted = /button:not\(:has\(\*\)\)::before\{min-width:0!important/.test(sweep);
  assert.ok(muted,
    '\n\n❌ audit/mobilesweep.mjs ไม่ได้ตัด min-width/min-height ของ `button:not(:has(*))::before` ก่อนวัด\n'
    + '   ⇒ ด่านจะฟ้อง "ล้นปัดไม่ได้" จากพื้นที่กดเผื่อนิ้วที่มองไม่เห็น (ปุ่ม 25px ได้ scrollWidth 33)\n'
    + '   แล้ว session ถัดไปจะ "แก้" ด้วยการห่อไอคอนใน <span> ซึ่ง**ถอดพื้นที่กด 40px ทิ้ง**\n'
    + '   = ทำให้หน้างานใส่ถุงมือกดยากขึ้น เพื่อให้ตัวเลขในด่านสวย (เกิดจริง 05/10 กับ SheetIconBtn)\n'
    + '   แก้: ใส่ addStyleTag ที่ตั้ง min-width:0!important/min-height:0!important ให้ pseudo นี้ก่อน evaluate\n'
    + '   📄 docs/UI-CONVENTIONS.md §7.1\n');
});


/* ═══ 📜 ตารางที่ `useColumnHistory` ชี้ ต้องมีอยู่จริง (2026-10-06 · QC audit) ═══
   ฟีเจอร์ "📜 เคยบันทึกไว้ (ไม่มีในทะเบียน)" ดึงค่าที่คนเคยพิมพ์ไว้มาให้เลือกซ้ำ
   (คำสั่ง user 07/09 *"ถ้าข้อมูลจะไม่มีในทะเบียน ใช้ข้อมูลที่เคยลงไว้ได้มั้ย"*)
   🔴 พิมพ์ชื่อตารางผิด = **ตายเงียบสนิท ไม่มีอะไรฟ้องบนจอ** — `masterCache.mrows()` จับ `42P01`
   คืน `[]` + console.warn แล้ว `useColumnHistory` ยัง `.catch(() => {})` ทับอีกชั้น
   เจอจริง 06/10 ผิด 4 จุด: `npi_part_deliverables`(→npi_deliverables) · `npi_eci`(→npi_change_requests)
   · `qa_claims`(→qa_customer_claims) · `qa_check_items`(→qa_inspection_items)
   ทั้ง 4 อยู่ในไฟล์ที่ query ข้อมูลชุดเดียวกันด้วย*ชื่อจริง* อยู่แล้ว (= พิมพ์ผิด ไม่ใช่ตารางคู่ขนาน)
   ต้นตอ: `docs/SINGLE-SOURCE-AUDIT-2026-09-07.md` เขียนชื่อผิดแบบเดียวกัน แล้วคนก๊อปไปใช้ */
test('🛡️ column-history-table-must-exist — ตารางของ useColumnHistory ต้องมี create/alter ในรีโป', () => {
  const sqlDirs = ['supabase/migrations', 'docs/sql'];
  const known = new Set();
  for (const d of sqlDirs) {
    let files = [];
    try { files = readdirSync(join(ROOT, d)).filter(f => f.endsWith('.sql')); } catch { continue; }
    for (const f of files) {
      const t = readFileSync(join(ROOT, d, f), 'utf8');
      for (const m of t.matchAll(/create\s+(?:or\s+replace\s+)?(?:table|view|materialized\s+view)\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+)"?/gi)) known.add(m[1]);
      for (const m of t.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+)"?/gi)) known.add(m[1]);
      /* trigger/policy ผูกกับตาราง = ตารางมีอยู่จริงแน่ (ตารางยุคก่อนมี migration ไม่มี create ในรีโป) */
      for (const m of t.matchAll(/\bon\s+(?:public\.)?"?([a-z0-9_]+)"?\s*(?:for\s+each\s+row|as\s|for\s+(?:all|select|insert|update|delete))/gi)) known.add(m[1]);
      /* docs/sql/00_schema_snapshot_*.sql บันทึก ~39 ตารางยุคก่อนกฎ migration ไว้เป็นคอมเมนต์
         `-- <ตาราง> (col type, …)` — เป็นที่เดียวในรีโปที่มีหลักฐานว่าตารางพวกนี้มีจริง */
      for (const m of t.matchAll(/^--\s*([a-z0-9_]+)\s*\([a-z0-9_]+\s+[a-z]/gim)) known.add(m[1]);
    }
  }
  if (known.size < 50) return;   // อ่าน SQL ไม่ได้ = ไม่ตัดสิน (ห้ามฟ้องผิด)
  const bad = [];
  for (const f of walk(join(ROOT, 'src'), ['.jsx', '.js'])) {
    const src = stripComments(readFileSync(f, 'utf8'));
    for (const m of src.matchAll(/useColumnHistory\(\s*supabase[A-Za-z]*\s*,\s*'([a-z0-9_]+)'/g)) {
      if (!known.has(m[1])) bad.push(`${relative(ROOT, f)} → '${m[1]}'`);
    }
  }
  assert.deepEqual([...new Set(bad)], [],
    '\n\n❌ useColumnHistory ชี้ตารางที่ไม่มี create/alter ในรีโป (น่าจะพิมพ์ชื่อผิด):\n'
    + '   ' + [...new Set(bad)].join('\n   ') + '\n'
    + '   ทำไมอันตราย: ตารางไม่มี → 42P01 → masterCache คืน [] + useColumnHistory .catch(() => {})\n'
    + '   ⇒ กลุ่ม "📜 เคยบันทึกไว้" **ว่างตลอดกาล ไม่มี error บนจอ** = คนต้องพิมพ์ชื่อใหม่ทุกครั้ง\n'
    + '     สะกดไม่ตรง → จับกลุ่ม/ค้นหาย้อนหลังแตก (เคสจริง 06/10 ผิด 4 จุด)\n'
    + '   แก้: ใช้ชื่อตารางจริง — ดูว่าไฟล์เดียวกัน `.from(...)` ตารางอะไรอยู่\n'
    + '   ถ้าตารางมีจริงแต่สร้างผ่าน dashboard ไม่มี migration: เขียน migration/บันทึกใน docs/sql ก่อน\n');
});


/* ═══ 🚫 `mtn_orders` ห้ามกรองสถานะด้วย `.neq()` (2026-10-14) ═════════════════════════
   `.neq('status','rejected')` แปลว่า **"ไม่ใช่ rejected"** ไม่ใช่ "เป็นงานจริง"
   ⇒ สถานะโมฆะที่เพิ่มทีหลังไหลเข้ามาเงียบๆ · เกิดจริง: เพิ่ม `cancelled` (14/10) แล้วใบที่ถูกยกเลิก
     ไปโผล่เป็น **ค่าซ่อมจริง/แท่งพาเรโต** ใน /improvements ทั้งที่ไม่มีงานเกิดขึ้น
   คลาสเดียวกับ `session-status-no-neq` (`production_sessions.status='void'`)
   ⇒ ระบุสถานะรายตัว: `.in('status', OPEN_MO_STATUSES)` หรือ `.not('status','in', MO_VOID_NOT_IN)` */
test('🛡️ mtn-status-no-neq — คิวรี mtn_orders ห้ามกรองสถานะด้วย .neq()', () => {
  const bad = [];
  for (const f of walk(join(ROOT, 'src'), ['.jsx', '.js'])) {
    const src = stripComments(readFileSync(f, 'utf8'));
    src.split('\n').forEach((ln, i) => {
      if (!/from\(\s*['"]mtn_orders['"]\s*\)/.test(ln)) return;
      if (!/\.neq\(\s*['"]status['"]/.test(ln)) return;
      bad.push(`${relative(ROOT, f)}:${i + 1}  ${ln.trim().slice(0, 100)}`);
    });
  }
  assert.deepEqual(bad, [],
    '\n\n❌ กรองสถานะ `mtn_orders` ด้วย `.neq()`:\n'
    + '   ' + bad.join('\n   ') + '\n'
    + '   `.neq(\'status\',\'rejected\')` = "ไม่ใช่ rejected" **ไม่ใช่** "เป็นงานจริง"\n'
    + '     ⇒ สถานะโมฆะที่เพิ่มทีหลัง (`cancelled`) ไหลเข้ามานับเป็นค่าซ่อม/พาเรโตเงียบๆ\n'
    + '   แก้: `.in(\'status\', OPEN_MO_STATUSES)` (เอาใบที่ยังเดินอยู่)\n'
    + '        `.not(\'status\', \'in\', MO_VOID_NOT_IN)` (ตัดใบที่ไม่เคยเป็นงานจริง)\n'
    + '   ทั้ง 2 ตัวอยู่ใน src/utils/mtnStepPerm.js — ห้ามเขียนลิสต์สถานะด้วยมือในหน้า\n');
});

/* ═══ 🗑️ ลบไฟล์ใน storage ได้ ต่อเมื่อ "ยืนยันว่าแถวหายจริง" แล้ว (2026-10-06 · QC audit) ═══
   RLS ปฏิเสธ DELETE = **สำเร็จ 0 แถว ไม่มี error** (กฎเหล็ก DB ข้อ 2 — มีแต่ INSERT ที่โยน 42501)
   ⇒ โค้ดที่เช็คแค่ `error` แล้วเดินไปลบไฟล์ = **แถวยังอยู่ แต่ไฟล์หายถาวร** แล้วจอขึ้น "ลบแล้ว"
   เจอจริง 06/10 ที่ `QAInspectionSetup.delPart` (ลบ `qa-drawings/parts/<id>` ทั้งโฟลเดอร์ ⇒
   ใบตรวจพาร์ทเสียถาวร) · `OjtTraining.handleDelete` (ลายเซ็นพนักงานทั้งใบ) · `PMSetup` (รูปจิ๊กทั้งชุด
   + โมเดล 3D) · `MtnMachineLayout` (รูปผังโซน) · `LineSetup` (รูปผังไลน์)
   🔴 ลำดับที่ปลอดภัยมีทางเดียว: `.select(...)` → นับแถว > 0 → **ค่อย** ลบไฟล์

   ── รอบ 2 (14/10 · เจอที่ `MtnRepair.del`) — ด่านเดิมมีรูรั่ว 2 ทาง ────────────────
   (ก) **ตัวลบไฟล์เป็น helper** `removeMtnImg(u)` ไม่ใช่ `storage….remove(` ตรงๆ
       ⇒ regex เดิมมองไม่เห็น ทั้งที่ข้างในเรียก `.remove()` จริง (`src/utils/mtnImage.js`)
   (ข) **ลบไฟล์ "ก่อน" `.delete()`** — ด่านเดิมมองไปข้างหน้าเท่านั้น
       ⇒ เคสนี้ **แย่กว่า** ที่ด่านจับได้ด้วยซ้ำ: ไฟล์หายแน่นอน ไม่ต้องรอ RLS ปฏิเสธ
   ⇒ ด่านนี้สแกนทั้งหน้าต่าง **ก่อนและหลัง** และรู้จักชื่อ helper ทุกตัวที่ห่อ `.remove()` ไว้ */
/* 🔴 ชื่อ helper ที่ "ลบไฟล์ใน storage จริง" — เพิ่ม helper ใหม่ที่ห่อ `.remove()` ต้องมาเติมที่นี่
   (ด่าน `storage-remover-list-complete` ข้างล่างเช็คให้ว่าลิสต์นี้ยังครบ) */
/* ── รอบ 3 (15/10 · QC audit) — ด่านเดิมยังมีรูอีก 2 ทาง ────────────────────────
   (ค) **helper ที่ประกาศในหน้า** `const removePeImage = (url) => …storage.remove(…)`
       ⇒ ด่าน `storage-remover-list-complete` เดิมสแกนแค่ `src/utils/**` + เฉพาะตัวที่ `export`
       ⇒ ตัวที่อยู่ในไฟล์หน้าเองมองไม่เห็นเลย (เจอจริงที่ `PEDocs.jsx`)
   (ง) **`.update()` ที่เขียน/ล้างคอลัมน์รูป** แล้วลบไฟล์เก่าตามหลัง — ด่านเดิมดูแค่ `.delete()`
       RLS ปฏิเสธ UPDATE ก็ "0 แถว ไม่มี error" เหมือนกัน ⇒ **แถวยังชี้ไฟล์เก่า แต่ไฟล์หายแล้ว**
       = รูปเสียถาวร กู้ไม่ได้ (เจอจริง 3 จุด: `PEDocs.attachImage` · `operator` รูปพนักงาน
       · `Report` Reset ใบ 4M · `Management` แนบเอกสาร 4M) */
const STORAGE_REMOVERS = ['removeMtnImg', 'removeActionImg', 'removeQualityImg', 'removePeImage', 'removeImg', 'removeRackImg'];
/* 🔑 ลายเซ็นต้องเป็นข้อความที่อยู่ **บรรทัดเดียวกับ `.delete()`** (ด่านนี้ไล่ทีละบรรทัด)
   — chain ที่ขึ้นบรรทัดใหม่ `from(…)` จะอยู่คนละบรรทัดกับ `.delete()` ⇒ ใส่ชื่อตารางไม่ติด */
const STORAGE_DEL_ALLOW = {
  /* delete นี้ลบ "คนที่ถูกเอาออกจากใบ" ซึ่งปกติ = 0 คน ⇒ 0 แถวเป็นเรื่องปกติ นับแถวไม่มีความหมาย
     และไฟล์ลายเซ็นที่ลบด้านล่างเป็นของ "รอบที่ถูกเซ็นทับ" (`_replacedSigPaths`) ไม่ใช่ของแถวที่ลบ
     = window ของด่านคาบเกี่ยวกันเท่านั้น ไม่ใช่คลาสบั๊กนี้ */
  'src/pages/OjtTraining.jsx': ["from('ojt_training_attendees').delete()"],
  /* ไฟล์ที่ `removeMtnImg` ลบ = **รูปอะไหล่ตัวเก่าที่ถูกอัปโหลดทับ** (`oldImg !== img`)
     ไม่ใช่ไฟล์ของแถว `mtn_spare_usage_monthly` ที่ลบ (ยอดใช้รายเดือน ไม่มีไฟล์แนบเลย)
     + 0 แถวเป็นเรื่องปกติ (ล้างเดือนที่อาจไม่เคยมีค่า) ⇒ คาบเกี่ยวกันแค่ใน window ของด่าน */
  'src/components/SparePartMaster.jsx': [".in('month_key', clear)"],
  /* ไฟล์ผังถูกลบ **ก่อน** `production_lines.delete()` จริง แต่ไม่ใช่คลาสบั๊กนี้:
     เจ้าของไฟล์คือแถว `line_layouts` ซึ่งถูกลบไปก่อนแล้วในลูปข้างบน และคิวรีนับผู้ใช้ร่วม
     (`eq('image_url', …)`) จะเจอ **แถวของไลน์นี้เอง** ถ้า delete นั้นถูก RLS ปฏิเสธเงียบ
     ⇒ shared.data มี 1 แถว ⇒ ไม่ลบไฟล์ · fail-closed ครบทั้ง 2 ทางอยู่แล้ว */
  'src/pages/LineSetup.jsx': ["from('production_lines').delete()"],
};
/** ตำแหน่งแรกในข้อความที่ "ลบไฟล์ใน storage" — ทั้งเรียกตรงและผ่าน helper */
const removeAt = (txt) => {
  const hits = [txt.search(/storage[\s\S]{0,40}?\.remove\(/)]
    .concat(STORAGE_REMOVERS.map(fn => txt.search(new RegExp(`\\b${fn}\\s*\\(`))))
    .filter(k => k >= 0);
  return hits.length ? Math.min(...hits) : -1;
};
const hasRemove = (txt) => removeAt(txt) >= 0;

test('🛡️ storage-delete-after-row-count — ลบไฟล์ storage ต้องมาหลังนับแถวที่ลบได้จริง', () => {
  const bad = [];
  for (const f of walk(join(ROOT, 'src'), ['.jsx', '.js'])) {
    const rel = relative(ROOT, f);
    const lines = readFileSync(f, 'utf8').split('\n');
    lines.forEach((ln, i) => {
      if (!/\.delete\(\)/.test(ln)) return;
      if ((STORAGE_DEL_ALLOW[rel] || []).some(sig => ln.includes(sig))) return;
      /* ลบไฟล์ "ก่อน" delete = ไฟล์หายแน่นอน (ไม่ต้องรอ RLS ปฏิเสธ) ⇒ ต้องมองย้อนหลังด้วย */
      const back = lines.slice(Math.max(0, i - 10), i).join('\n');
      if (hasRemove(back)) {
        bad.push(`${rel}:${i + 1}  (ลบไฟล์ก่อน delete) ${ln.trim().slice(0, 70)}`);
        return;
      }
      const win = lines.slice(i, i + 16).join('\n');
      const k = removeAt(win);
      if (k < 0) return;                       // ไม่มีการลบไฟล์ตามหลัง = ไม่เกี่ยว
      if (/\.select\(/.test(win.slice(0, k))) return;   // นับแถวแล้วก่อนแตะไฟล์ = ถูกต้อง
      bad.push(`${rel}:${i + 1}  ${ln.trim().slice(0, 90)}`);
    });
  }
  assert.deepEqual(bad, [],
    '\n\n❌ ลบไฟล์ใน storage ตามหลัง `.delete()` ที่ไม่ได้ `.select()` นับแถว:\n'
    + '   ' + bad.join('\n   ') + '\n'
    + '   ทำไมอันตราย: RLS ปฏิเสธ DELETE = **0 แถว ไม่มี error** (กฎเหล็ก DB ข้อ 2)\n'
    + '     ⇒ แถวยังอยู่ แต่ไฟล์ถูกลบถาวร แล้วจอขึ้น "ลบแล้ว" = ข้อมูลเสียแบบกู้ไม่ได้\n'
    + '   แก้: const res = await supabase.from(t).delete().eq(...).select(\'id\');\n'
    + '        if (!checkWrite(res, \'ลบ…\')) return;\n'
    + '        if (!(res.data || []).length) { toast.error(\'ลบไม่สำเร็จ (0 แถว) — ไฟล์ยังอยู่\'); return; }\n'
    + '        // ← ลบไฟล์ storage ได้หลังบรรทัดนี้เท่านั้น\n'
    + '   ถ้า "0 แถว = เรื่องปกติ" จริง (เช่น ลบของที่อาจไม่มีอยู่แต่แรก) ให้เพิ่มใน STORAGE_DEL_ALLOW\n'
    + '   พร้อมเหตุผล — ห้ามใส่เพราะแก้ไม่ไหว\n');
});

/* ลิสต์ STORAGE_REMOVERS ข้างบนจะมีค่าก็ต่อเมื่อ **ครบ** — helper ใหม่ที่ไม่อยู่ในลิสต์
   = ด่านข้างบนมองไม่เห็น = รูรั่วเดิมกลับมาเงียบๆ ⇒ ด่านนี้ไล่หา helper ที่ห่อ `.remove()` เอง */
test('🛡️ storage-remover-list-complete — helper ที่ลบไฟล์ storage ต้องอยู่ใน STORAGE_REMOVERS', () => {
  const missing = [];
  /* 🔴 สแกน **ทั้ง src** ไม่ใช่แค่ utils — helper ที่ประกาศในไฟล์หน้าเองก็ซ่อนรูเท่ากัน (รอบ 3)
     วิธี: เจอบรรทัดที่ลบไฟล์จริง → เดินย้อนขึ้นหา "ชื่อฟังก์ชันที่ห่อมันอยู่" ตัวใกล้สุด
     แล้วถ้าชื่อนั้นเป็นแนว remove/del (= ถูกเรียกจากที่อื่นไปลบไฟล์) ต้องอยู่ในลิสต์ */
  for (const f of walk(join(ROOT, 'src'), ['.js', '.jsx'])) {
    const rel = relative(ROOT, f);
    if (rel.startsWith('src/utils/__tests__')) continue;
    const lines = stripComments(readFileSync(f, 'utf8')).split('\n');
    lines.forEach((ln, i) => {
      if (!/storage[\s\S]{0,40}?\.remove\(|\bstorage\.remove\(/.test(ln)) return;
      for (let k = i; k >= Math.max(0, i - 4); k--) {
        const d = lines[k].match(/(?:export\s+)?(?:const|let|async\s+function|function)\s+(\w+)\s*(?:=|\()/);
        if (!d) continue;
        if (!/^(remove|delete|del)/i.test(d[1])) break;      // ไม่ใช่ helper ลบไฟล์ = ตัวเขียน inline ปล่อยได้
        if (!STORAGE_REMOVERS.includes(d[1])) missing.push(`${rel}:${k + 1} → ${d[1]}()`);
        break;
      }
    });
  }
  assert.deepEqual([...new Set(missing)], [],
    '\n\n❌ มี helper ที่ลบไฟล์ใน storage แต่ไม่อยู่ใน STORAGE_REMOVERS:\n'
    + '   ' + [...new Set(missing)].join('\n   ') + '\n'
    + '   ⇒ ด่าน storage-delete-after-row-count / storage-remove-after-update มองที่เรียก helper นี้ไม่เห็น\n'
    + '   แก้: เติมชื่อใน STORAGE_REMOVERS (ไฟล์นี้) — ห้ามปล่อยไว้\n');
});

/* ═══ 🗑️ รอบ 3 — `.update()` ที่ตามด้วยการลบไฟล์ ก็ต้องนับแถวก่อน (2026-10-15 · QC audit) ═══
   คลาสเดียวกับ `.delete()` แต่ **เจ็บกว่า**: แถวไม่ได้หายไปไหน มันยังชี้ URL เดิมอยู่
   ⇒ RLS ปฏิเสธ (0 แถว ไม่มี error) แล้วเราลบไฟล์เก่า = ช่องรูปบนใบกลายเป็นรูปเสียถาวร
   + ไฟล์ใหม่ที่อัปโหลดไว้กลายเป็นขยะที่ไม่มีแถวไหนอ้าง */
const STORAGE_UPD_ALLOW = {
  /* ไฟล์ที่ลบ = ของแถว `qa_part_drawings` ที่ `.delete().select('id')` นับแถวผ่านแล้วข้างบน
     `.update()` ตัวนี้แค่ประทับเวลา `drawing_updated_at` ไม่ได้เป็นเจ้าของไฟล์ */
  'src/components/QaPointsEditor.jsx': ["update({ drawing_updated_at:"],
  /* ── 4 จุดข้างล่างอยู่ฝั่ง DR (`supabaseDR` = anon ตลอด · ไม่มี policy ที่ปฏิเสธรายคน)
     ⇒ "0 แถว" เกิดได้ทางเดียวคือแถวถูกลบไปแล้วจริง — ไฟล์ของแถวที่ไม่มีอยู่ = ขยะ ลบถูกแล้ว
     (ถ้าวันไหนฝั่ง DR มี Edge Function/RLS รายคน ต้องกลับมานับแถวทั้ง 4 จุดนี้) */
  'src/components/QualityBins.jsx': ["from('quality_bin_records').update(payload)"],
  'src/pages/DailyReport.jsx': ["from('defect_logs').update(payload)"],
  'src/pages/MtnRepair.jsx': ["from('mtn_orders').update(upd)"],
  'src/pages/MtnMachineLayout.jsx': ["from('pm_facility_areas').update({ image_path: path })"],
  'src/components/DieLayout.jsx': ["from('die_storage_areas').update({ image_url: url })"],
  'src/components/RackMap.jsx': ["from('mtn_rack_maps').update({ image_url: url })"],
  /* ไฟล์ที่ลบคือรูปพนักงานเก่าของ `employees.update(...).select('id')` ที่นับแถวผ่านแล้วข้างบน
     ตัวนี้เป็น best-effort เขียน `mtn_team` แยก (คอลัมน์อาจยังไม่ apply migration) ไม่ได้เป็นเจ้าของไฟล์
     = คาบเกี่ยวกันแค่ใน window ของด่าน */
  'src/pages/operator.jsx': [".update({ mtn_team: nextTeam })"],
};
test('🛡️ storage-remove-after-update — ลบไฟล์ตามหลัง .update() ต้องนับแถวก่อน', () => {
  const bad = [];
  for (const f of walk(join(ROOT, 'src'), ['.jsx', '.js'])) {
    const rel = relative(ROOT, f);
    if (rel.startsWith('src/utils/__tests__')) continue;
    const lines = readFileSync(f, 'utf8').split('\n');
    lines.forEach((ln, i) => {
      if (!/\.update\(/.test(ln)) return;
      if ((STORAGE_UPD_ALLOW[rel] || []).some(sig => ln.includes(sig))) return;
      const win = lines.slice(i, i + 18).join('\n');
      const k = removeAt(win);
      if (k < 0) return;
      if (/\.select\(/.test(win.slice(0, k))) return;   // นับแถวแล้วก่อนแตะไฟล์ = ถูกต้อง
      bad.push(`${rel}:${i + 1}  ${ln.trim().slice(0, 90)}`);
    });
  }
  assert.deepEqual(bad, [],
    '\n\n❌ ลบไฟล์ใน storage ตามหลัง `.update()` ที่ไม่ได้ `.select()` นับแถว:\n'
    + '   ' + bad.join('\n   ') + '\n'
    + '   ทำไมอันตรายกว่า delete: แถวยังอยู่และยังชี้ URL เดิม ⇒ ไฟล์หาย = **รูปเสียถาวร**\n'
    + '   แก้: const res = await supabase.from(t).update(x).eq(...).select(\'id\');\n'
    + '        if (!checkWriteRows(res, \'…\')) return;   // ← ลบไฟล์ได้หลังบรรทัดนี้เท่านั้น\n'
    + '   ถ้าไฟล์ที่ลบ "ไม่ใช่ของแถวนี้" หรือตารางอยู่ฝั่ง DR (anon · ไม่มีการปฏิเสธรายคน)\n'
    + '   ให้เพิ่มใน STORAGE_UPD_ALLOW พร้อมเหตุผล — ห้ามใส่เพราะแก้ไม่ไหว\n');
});


/* ═══ 🔐 จอที่คุมสิทธิ์ ต้องเช็คสิทธิ์ "คนที่เปิดดู" ด้วย (2026-10-06 · QC audit) ═══
   `/permissions` เคย**ไม่เช็คสิทธิ์ผู้ดูเลย** (grep UserContext|can( = 0) — ตัวแปร `role` ในหน้านี้
   คือ role ของ**คอลัมน์ใน matrix** ไม่ใช่ของผู้ใช้ ⇒ อ่านโค้ดผ่านตาแล้วเหมือนมีด่านอยู่
   ประตูเดียวคือ `page:/permissions` ซึ่ง**ติ๊กให้ role อื่นได้จากจอนั้นเอง**
   ⇒ คนที่ได้คีย์นั้นกดแก้แถวที่มีอยู่แล้ว → RLS ปฏิเสธ = 0 แถว ไม่มี error (กฎเหล็ก DB ข้อ 2)
   → ช่องติ๊กเปลี่ยนบนจอ ฐานไม่เปลี่ยน ไม่มี toast = **จอโกหกเรื่อง "ใครมีสิทธิ์อะไร"**
   ซึ่งเป็นข้อมูลที่ทุกจอในระบบพึ่ง · แก้แล้วด้วย `canSeeded('permissions','manage')` + นับแถว
   + migration `20261006_permissions_manage_perm_main.sql` (policy อ่านคีย์เดียวกับปุ่ม) */
test('🔐 permissions-page-needs-viewer-gate — /permissions ต้องเช็คสิทธิ์ผู้ดู + นับแถวที่เขียนได้', () => {
  const f = 'src/pages/PermissionsManagement.jsx';
  const src = stripComments(readFileSync(join(ROOT, f), 'utf8'));
  const miss = [];
  if (!/canSeeded\(\s*'permissions'\s*,\s*'manage'/.test(src))
    miss.push("ไม่พบ canSeeded('permissions', 'manage', …) — ด่านของคนที่เปิดจอ");
  if (!/\bcanManage\b/.test(src))
    miss.push('ไม่พบตัวแปร canManage ที่เอาไปปิดช่องติ๊ก');
  /* upsert ของ role_permissions ต้อง .select() เพื่อนับแถว — RLS ปฏิเสธ = 0 แถว ไม่มี error */
  const up = src.match(/from\('role_permissions'\)[\s\S]{0,400}?\.upsert\([\s\S]{0,300}?\)/);
  if (!up) miss.push("ไม่พบ upsert ของ role_permissions (โครงหน้าเปลี่ยน — ทวนกฎนี้ใหม่)");
  else if (!/\.select\(/.test(src.slice(src.indexOf(up[0]), src.indexOf(up[0]) + up[0].length + 120)))
    miss.push('upsert ไม่ได้ .select() ⇒ ไม่นับแถว = RLS ปฏิเสธแล้วจอยังโชว์ว่าบันทึกสำเร็จ');
  assert.deepEqual(miss, [],
    `\n\n❌ ${f} หลุดด่านของตัวเอง:\n   ` + miss.join('\n   ') + '\n'
    + '   ทำไมสำคัญ: นี่คือจอที่ตัดสินว่า "ใครทำอะไรได้" ทั้งระบบ — ถ้าจอนี้โกหก\n'
    + '     ทุกการตั้งสิทธิ์หลังจากนั้นเชื่อถือไม่ได้ และคนตั้งจะไม่รู้ตัวเลย\n'
    + '   🔴 ระวัง: `role` ในไฟล์นี้คือ role ของ**คอลัมน์ใน matrix** ไม่ใช่ของผู้ใช้\n'
    + '     ⇒ `can(..., role)` ในหน้านี้ **ไม่ใช่** ด่านของผู้ดู ต้องอ่าน role จาก UserContext\n'
    + '   แก้: const { role: myRole } = useContext(UserContext);\n'
    + '        const canManage = canSeeded(\'permissions\', \'manage\', myRole);\n'
    + '        → ใช้ปิด disabled ของ checkbox + ด่านใน toggle() + <ReadOnlyNote show={!canManage} …>\n'
    + '        → upsert ต้อง .select() แล้วเช็ค res.data.length ก่อนถือว่าสำเร็จ\n');
});


/* ═══ own-profile-role-via-context — ห้ามหน้าไหนอ่าน `profiles` ของ "ตัวเอง" ซ้ำจากฐาน ═══
   (2026-10-09 · QC audit รอบ 4 — `PMCheckData.jsx` เป็นไฟล์เดียวในโปรเจคที่ทำ)

   `App.jsx` โหลด profile ของผู้ล็อกอินครั้งเดียวแล้วตีความให้ครบ (`effectiveSections()` ·
   `is_dept_admin` · โหมด 🎭 ดูแทน role อื่น) แล้วแจกผ่าน `UserContext`
   หน้าที่ไปยิง `profiles` ของตัวเองซ้ำ จะได้แต่ **คอลัมน์ดิบ** ⇒
     · ขอบเขตหาย — `sections` ที่ context คำนวณให้ (ตาข่าย admin · scope_depth) ไม่ถูกใช้
     · 🎭 **โหมดดูแทนไม่มีผล** — admin สวมเป็น mtn เพื่อทดสอบ แต่หน้านั้นยังอ่าน role จริง
       ⇒ เห็นปุ่มครบ แล้วสรุปว่า "role นี้ทำได้" ผิด (ทดสอบสิทธิ์เชื่อถือไม่ได้ทั้งหน้า)
   ✅ `src/App.jsx` = เจ้าของเรื่อง (คนโหลดตัวจริงแล้วแจกต่อ) — ยกเว้นตัวเดียวเท่านั้น
   🔴 `auth.getUser()` เพื่อเอา **uid** ยังทำได้ตามปกติ (ตัวตนคนเซ็น/คนอนุมัติในใบ
      ต้องเป็น uid จริงเสมอ ห้ามใช้ role ที่ถูกสวม) — ด่านนี้จับเฉพาะการ "อ่าน role/สังกัด" */
test('🔐 own-profile-role-via-context — role/สังกัดของผู้ใช้ต้องมาจาก UserContext ไม่ใช่คิวรี profiles ซ้ำ', () => {
  const ALLOW = { 'src/App.jsx': 'เจ้าของเรื่อง — โหลด profile ของผู้ล็อกอินแล้วแจกผ่าน UserContext' };
  const SELF = /\.eq\(\s*'id'\s*,\s*[^)]*(user\.id|uid|auth\.uid\(\))/;   // "กรองด้วยตัวเอง"
  const CTX_COLS = /\b(role|sections|section|is_dept_admin|line_id|team)\b/;
  const bad = [];
  for (const f of walk(join(ROOT, 'src'), ['.js', '.jsx'])) {
    const rel = relative(ROOT, f);
    if (ALLOW[rel]) continue;
    const src = stripComments(readFileSync(f, 'utf8'));
    const re = /from\(\s*'profiles'\s*\)\s*\.select\(\s*([`'"])([^`'"]*)\1\s*\)/g;
    for (let m; (m = re.exec(src));) {
      const cols = m[2];
      if (!CTX_COLS.test(cols)) continue;                  // ไม่ได้ขอคอลัมน์ที่ context มีให้ = ไม่เกี่ยว
      const tail = src.slice(m.index, m.index + m[0].length + 160);
      if (!SELF.test(tail)) continue;                      // อ่านของ "คนอื่น" (ทะเบียนผู้ใช้) = ปกติ
      bad.push(`${rel} — select('${cols}') ของตัวเอง`);
    }
  }
  assert.deepEqual(bad, [],
    '\n\n❌ อ่าน profile ของตัวเองซ้ำจากฐาน:\n   ' + bad.join('\n   ') + '\n'
    + '   ทำไมสำคัญ: ได้คอลัมน์ดิบ ⇒ ขอบเขต (sections ที่ effectiveSections ตีความ) หาย\n'
    + '     และโหมด 🎭 "ดูแทน role อื่น" ไม่มีผลบนหน้านั้น = ทดสอบสิทธิ์เชื่อถือไม่ได้\n'
    + "   แก้: const { role, fullName, sections } = useContext(UserContext)\n"
    + '   🔴 ต้องการแค่ uid (คนเซ็น/คนอนุมัติ) → `supabase.auth.getUser()` ยังใช้ได้ตามปกติ\n');
});


/* ═══ กฎเชิงความสัมพันธ์ #4 — ภาระเวลาของงานคู่ RH/LH ห้ามบวกกัน (2026-09-22 · audit แผนผลิต) ═══
   `ProductionPlan` แปลงความต้องการเป็น shift-load ด้วย `qty ÷ กำลังต่อกะ` ต่อพาร์ท แล้ว**บวกรวม**
   ⇒ คู่ RH/LH (ปั๊มทีเดียวได้ 2 ข้าง) ถูกนับเวลา 2 เท่า
   วัดจริงในฐาน DR 22/09 (คู่ที่มี demand ครบทั้ง 2 ข้าง):
     20065635↔20065715 LASER-789 · 20059957↔20059959 และ 20059966↔20059967 LINE D (110&300T)
   ⇒ LINE D ที่ `std_night_shift = 0` (ไม่มีกะดึกให้เปิด) ถูกดันไป tier "🚨 เกินกำลัง — ต้องเพิ่มไลน์/คน"
     ทั้งที่โหลดจริงประมาณครึ่งเดียว

   regex บรรทัดเดียวจับไม่ได้ (ตัวหารกับตัวรวมอยู่คนละบรรทัดเสมอ) ⇒ ใช้ invariant:
   **ไฟล์ไหนหารด้วย "กำลังต่อกะ" ต้องมี `pairLoadTotal` อยู่ในไฟล์ด้วย** */
test('🛡️ plan-load-needs-pair-collapse — ไฟล์ที่คิด shift-load ต้องยุบคู่ RH/LH ก่อนรวม', () => {
  const files = walk(join(ROOT, 'src'), ['.jsx', '.js']);
  const hits = [];
  for (const file of files) {
    const rel = relative(ROOT, file);
    const code = stripComments(readFileSync(file, 'utf8'));
    if (!/\/\s*perShift\b/.test(code)) continue;        // ไม่ได้คิด shift-load = ไม่เกี่ยว
    if (!/\bpairLoadTotal\b/.test(code)) hits.push(rel);
  }
  assert.deepEqual(hits, [],
    '\n\n❌ ไฟล์ด้านล่างแปลงความต้องการเป็น "ภาระกะ" (qty ÷ กำลังต่อกะ) แต่ไม่ยุบคู่ RH/LH\n'
    + '   ทำไมห้าม: ปั๊มทีเดียวได้ทั้ง RH+LH ⇒ **เวลาไม่บวกกัน** (กฎเหล็ก "ชิ้น ≠ shot" ใน CLAUDE.md)\n'
    + '   บวกกัน = โหลดเฟ้อ 2 เท่า → สั่งเปิด OT/กะดึก/แจ้ง "เกินกำลัง" เกินจำเป็น\n'
    + '   แก้ยังไง: สะสมโหลด**แยกราย mat** (คีย์ = เลข SAP) แล้วรวมด้วย\n'
    + '            pairLoadTotal(loadByMat, pairOf) จาก src/utils/pairTotals.js\n'
    + '   ⚠️ อย่าลืม select `pair_mat_no` จาก dr_products — ขาดคอลัมน์นี้ = pairOf ว่าง = นับ 2 เท่าเงียบๆ\n\n'
    + hits.map(h => '   • ' + h).join('\n')
    + '\n\n   (ยอด**ชิ้น** เช่น duePcs ยังบวกทั้งคู่ตามปกติ — RH/LH ส่งลูกค้าแยกใบ เป็นชิ้นจริงทั้งคู่)\n');
});

test('🛡️ backup-tables-go-to-archive — migration ใหม่ห้ามสร้างตารางสำรองไว้ใน public', () => {
  // ตัวตัดสินชื่อ "ตารางสำรอง" ใช้ตัวเดียวกับจอ /schema และ migration ที่ย้ายของ (ห้ามนิยามซ้ำ)
  // บังคับตั้งแต่วันที่ทำความสะอาด (22/09/2026) เป็นต้นไป — ของเก่ากว่านั้นเป็นประวัติศาสตร์
  // ที่ถูกย้ายเข้า archive ไปแล้ว ไม่ต้องไปไล่แก้ไฟล์ migration ที่รันไปแล้ว
  //
  // ⚠️ เดิมตั้ง SINCE = 20260923 (ไม่บังคับไฟล์ลงวันที่เดียวกับรอบทำความสะอาด) — **รั่วจริงภายในวันเดียว**:
  //    บ่าย 22/09 session ขนานสร้าง `public.bom_items_backup_20260922` เพิ่มอีกตัว (RLS ปิด · 598 แถว)
  //    แล้วด่านไม่จับเพราะไฟล์ลงวันที่ 20260922 ⇒ ลดเป็น 20260922 + ยกเว้นเฉพาะไฟล์ที่เก็บกวาดแล้ว
  const SINCE = 20260922;
  // ไฟล์ที่ merge ไปก่อนด่านจะแน่น และ**ตารางถูกย้ายเข้า archive เรียบร้อยแล้ว** — ห้ามเพิ่มชื่อใหม่เข้ารายการนี้
  // เพื่อให้ build ผ่าน (ให้ไปสร้างใน `archive.` ตั้งแต่แรกแทน)
  const CLEANED = new Set([
    '20260922_bom_flat_dupe_rows_off_dr.sql',   // ย้ายออกแล้วโดย 20260922d_archive_bom_backup_dr.sql
  ]);
  const dir = join(ROOT, 'supabase/migrations');
  const hits = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.sql') || CLEANED.has(f)) continue;
    const day = Number((f.match(/^(\d{8})/) || [])[1] || 0);
    if (day < SINCE) continue;
    // ตัดคอมเมนต์ SQL ก่อน (ไฟล์ migration ในโปรเจคนี้อธิบายยาวและมักยกตัวอย่างคำสั่งจริง)
    const sql = readFileSync(join(dir, f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
    for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:(\w+)\.)?(\w+)/gi)) {
      const [, schema, name] = m;
      if (BACKUP_RE.test(name) && (schema || 'public').toLowerCase() !== 'archive') hits.push(`${f} → ${name}`);
    }
  }
  assert.deepEqual(hits, [],
    '\n\n❌ migration ด้านล่างสร้าง "ตารางสำรอง/ชั่วคราว" ไว้ใน schema public\n'
    + '   ทำไมห้าม: สำเนาข้อมูลที่ copy มาแบบ `create table ... as select` **ไม่ได้ RLS ตามมาด้วย**\n'
    + '   ฝั่ง DR ที่ client วิ่งด้วย anon เสมอ = ใครมี anon key ก็อ่าน/เขียนสำเนาข้อมูลจริงได้โดยไม่ต้อง login\n'
    + '   (วัดจริง 22/09/2026: ค้างใน public 37 ตาราง · 35 ตัวไม่มี RLS · รวม 56,816 แถว)\n'
    + '   และมันปนกับตารางจริงในทุกที่ที่มองเห็น schema (SQL Editor · จอ /schema · PostgREST)\n'
    + '   แก้ยังไง: `create schema if not exists archive;` แล้วสร้างเป็น `archive.<ชื่อ>_<เหตุผล>_<YYYYMMDD>`\n'
    + '   (schema archive ไม่ถูก expose ผ่าน API และไม่ grant ให้ anon/authenticated)\n\n'
    + hits.map(h => '   • ' + h).join('\n') + '\n');
});

test('🛡️ postgrest-limit-needs-range — edge function ที่ยิง /rest/v1/ ต้องแบ่งหน้าด้วย Range header', () => {
  /* บั๊กที่เคยเกิดจริง 2026-09-24 (sync-station-output รอบแรก):
     ใส่ `limit=20000` ใน query string ของ PostgREST แล้วคิดว่าได้ครบ — แต่ Supabase ตั้ง
     `max-rows` = 1000 ไว้ที่เซิร์ฟเวอร์ ซึ่ง `limit=` **ชนะไม่ได้** และมันตอบ 200 OK
     พร้อมข้อมูล 1000 แถวเป๊ะ ⇒ "สำเร็จ" แบบเงียบๆ ทั้งที่ข้อมูลขาด
     จับได้เพราะบังเอิญเห็นเลข 1000 กลมๆ — ไม่มี error ไม่มี log อะไรเตือนเลย */
  const dir = join(ROOT, 'supabase/functions');
  const hits = [];
  for (const f of walk(dir, ['.ts'])) {
    const src = stripComments(readFileSync(f, 'utf8'));
    if (!src.includes('/rest/v1/')) continue;
    if (!/limit=\d{4,}/.test(src)) continue;             // limit 4 หลักขึ้นไป = ตั้งใจดึงเกิน 1000
    if (/['"`]Range['"`]\s*:/.test(src)) continue;       // มีการแบ่งหน้าแล้ว
    hits.push(relative(ROOT, f));
  }
  assert.deepEqual(hits, [],
    '\n\n❌ edge function ด้านล่างยิง PostgREST ด้วย `limit=` เกิน 1000 แต่ไม่ได้แบ่งหน้า\n'
    + '   ทำไมพัง: Supabase ตั้ง max-rows = 1000 ที่เซิร์ฟเวอร์ · `limit=` ใน query string ชนะไม่ได้\n'
    + '   และมันคืน 200 OK พร้อมข้อมูลไม่ครบ = พังเงียบ ไม่มี error ให้จับ\n'
    + '   (เกิดจริง 24/09/2026: backfill rollup ได้ sessions = 1000 เป๊ะ ทั้งที่จริงมี 1,318)\n'
    + '   แก้ยังไง: วนอ่านทีละหน้าด้วย header `Range: <from>-<to>` + `Range-Unit: items`\n'
    + '   แล้วหยุดเมื่อหน้าที่ได้สั้นกว่าขนาดหน้า (ดูตัวอย่าง supabase/functions/sync-station-output/index.ts)\n\n'
    + hits.map(h => '   • ' + h).join('\n') + '\n');
});

test('🛡️ no-production-sessions-product-id — คอลัมน์ร้าง ห้ามใช้หา "รุ่นที่ผลิตในกะ"', () => {
  /* บั๊กที่เคยเกิดจริง 2026-09-24: rollup ของ EXP v2 ดึงรุ่นที่ผลิตผ่าน production_sessions.product_id
     → ได้ parts_seen ว่างทุกแถว ⇒ ประตู "ความหลากหลาย" ตกหมดทั้งโรงงานโดยไม่มี error
     เพราะคอลัมน์นั้น **เป็น null ทั้งตาราง** (วัด 24/09/2026: 0 จาก 1,318 แถว ตั้งแต่ 18/06)
     ของจริงอยู่ที่ prod_orders.mat_no — 1 กะมีได้หลายใบ/หลายรุ่น

     ⚠️ จุดที่ยกเว้นด้านล่าง = โค้ดเดิมที่ยัง select คอลัมน์นี้อยู่จริง (พบตอนตั้งด่าน 24/09)
        ทั้ง 3 จุดได้ค่า null เสมอ ⇒ ฟีเจอร์ที่พึ่งมันเงียบอยู่ — ยังไม่ได้แก้ในคอมมิทนี้
        เพราะอยู่คนละโมดูล (สรุปยอดตาม family / การ์ด Heijunka) ต้องดูเจตนาเดิมก่อน
        🔴 ห้ามเพิ่มชื่อใหม่เข้ารายการนี้ — จุดใหม่ให้ใช้ prod_orders ตั้งแต่แรก */
  const ALLOW = new Set([
    'src/pages/DailyReport.jsx',      // :7244 select('product_id, qty_ok, dr_products(family_id)')
    'src/pages/HeijunkaKanban.jsx',   // :1819 select('... product_id, dr_products(...)')
    'src/pages/ProductMaster.jsx',    // :317  select('product_id, qty_ok, dr_products(family_id)')
  ]);
  const hits = [];
  for (const f of [...walk(join(ROOT, 'src'), ['.js', '.jsx']),
                   ...walk(join(ROOT, 'supabase/functions'), ['.ts'])]) {
    const rel = relative(ROOT, f);
    if (ALLOW.has(rel)) continue;
    const src = stripComments(readFileSync(f, 'utf8'));
    // จับเฉพาะ "อ่าน product_id จากตารางนี้จริงๆ" ไม่ใช่แค่เอ่ยชื่อตารางในไฟล์เดียวกัน
    const viaClient  = /from\(\s*['"`]production_sessions['"`]\s*\)[\s\S]{0,200}?\.select\(\s*['"`][^'"`]*\bproduct_id\b/;
    const viaRest    = /production_sessions\?[^'"`]*\bproduct_id\b/;
    if (viaClient.test(src) || viaRest.test(src)) hits.push(rel);
  }
  assert.deepEqual(hits, [],
    '\n\n❌ ไฟล์ด้านล่าง select `product_id` จากตาราง production_sessions\n'
    + '   ทำไมพัง: คอลัมน์นั้นเป็นคอลัมน์ร้าง = null ทั้งตาราง (0/1,318 แถว · 24/09/2026)\n'
    + '   ได้ null เงียบๆ แล้วฟีเจอร์ปลายทางตกทั้งชุดโดยไม่มี error ให้จับ\n'
    + '   แก้ยังไง: รุ่นที่ผลิตในกะ ดึงจาก `prod_orders` (มี session_id + mat_no ตรงๆ)\n\n'
    + hits.map(h => '   • ' + h).join('\n') + '\n');
});


/* ═══ มาตรฐานกรอบหน้า + หัวเพจ (docs/UI-STANDARD.md §1–2 · 2026-09-24) ════════════
   audit 23/09: ระยะขอบรากหน้า 20+ แบบ ⇒ ชื่อหน้ากระโดดซ้าย-ขวา 0–78px ตอนเปลี่ยนหน้า · 18 หน้าวาดหัวเอง
   ⇒ ทุกหน้าใน src/pages ต้องมี <Page และ <PageHeader ยกเว้นบอร์ด TV/หน้าพิเศษที่มีเหตุผลเขียนไว้ */
const PAGE_EXEMPT = {
  'Login.jsx': 'หน้า login มีแบรนด์ของตัวเอง ไม่ใช่หน้าในเมนู',
  'Dashboard.jsx': 'บอร์ดจอ TV — หัวเรื่องกินแนวตั้ง (UI-CONVENTIONS §6.8)',
  'LineOeeBoard.jsx': 'บอร์ดจอ TV ประจำไลน์ (§6.8)',
  'TvBoard.jsx': 'จอแขวนห้อง ไม่มี sidebar (§6.8)',
  'LineSetup.jsx': 'เครื่องมือวาดผังที่ถูกฝังในแท็บของ /layout-setup (§6.8)',
  'DeptHub.jsx': 'หน้าแรก (hero) ของระบบ ไม่ใช่หน้างาน (§6.8)',
};
test('🛡️ ทุกหน้าใช้ <Page> + <PageHeader> (UI-STANDARD §1–2)', () => {
  const dir = join(ROOT, 'src/pages');
  const bad = [];
  for (const f of readdirSync(dir).filter(n => n.endsWith('.jsx'))) {
    if (PAGE_EXEMPT[f]) continue;
    const code = stripComments(readFileSync(join(dir, f), 'utf8'));
    const miss = [];
    if (!/<Page[\s>]/.test(code)) miss.push('<Page>');
    if (!/<PageHeader\b/.test(code) && !/<(ObeyaKpiBoard|ObeyaSqdcmBoard|DeptDashboard)\b/.test(code)) miss.push('<PageHeader>');
    if (miss.length) bad.push(`src/pages/${f} — ไม่มี ${miss.join(' + ')}`);
  }
  assert.deepEqual(bad, [], `\n\n❌ หน้าที่ไม่ใช้กรอบ/หัวมาตรฐาน ${bad.length} ไฟล์\n`
    + '   ทำไมห้าม: ระยะขอบ/หัวเพจคนละแบบ ⇒ ชื่อหน้ากระโดดตอนเปลี่ยนหน้า (audit 23/09/2026)\n'
    + '   แก้ยังไง: รากหน้าเป็น <Page> (components/Page.jsx) + หัว <PageHeader> · บอร์ด TV ให้เพิ่มใน PAGE_EXEMPT พร้อมเหตุผล\n\n'
    + bad.map(b => '   • ' + b).join('\n') + '\n');
});

test('🛡️ hub ที่ฝังหน้าลูกต้องครอบ <Hub> (หัวซ้อน 2 ชั้น — UI-STANDARD §2)', () => {
  const dir = join(ROOT, 'src/pages');
  const bad = [];
  for (const f of readdirSync(dir).filter(n => n.endsWith('.jsx'))) {
    const code = stripComments(readFileSync(join(dir, f), 'utf8'));
    const embedsPage = /lazy\(\s*\(\)\s*=>\s*import\(\s*['"]\.\/(?!.*Board)/.test(code) || /^import \w+ from '\.\/\w+'/m.test(code);
    if (embedsPage && !/<Hub>/.test(code) && f !== 'Obeya.jsx') bad.push(`src/pages/${f}`);
  }
  assert.deepEqual(bad, [], `\n\n❌ hub ที่ฝังหน้าลูกโดยไม่ครอบ <Hub>: ${bad.join(', ')}\n`
    + '   ทำไมห้าม: หัวเรื่องซ้อน 2 ชั้น ขนาดคนละแบบทุกแท็บ (PmHub/DailyChecker audit 23/09/2026)\n'
    + '   แก้ยังไง: import { Hub } from components/Page แล้วครอบหน้าลูก — Obeya ยกเว้นเพราะหน้าลูกเป็นเจ้าของหัว+แท็บของ hub เอง\n');
});


/* ═══ ลำดับแนวตั้งของหัวเพจ (UI-STANDARD §2 · 2026-09-24) ═══════════════════════
   user 24/09: *"ลำดับยังโดดไปมา เดี๋ยวแท็บมาก่อนช่องค้นหา บางหน้าค้นหาอยู่บนสุดก่อนแท็บ"*
   ต้นเหตุ: ตัวกรอง (ขอบเขต/เดือน/โปรเจค/ช่วงเวลา) ถูกยัดใน `actions` ของ PageHeader ⇒ ไปโผล่แถวชื่อหน้า
   **เหนือแถบแท็บ** ขณะที่หน้าอื่นวางตัวกรองใต้แท็บ (OBEYA 4 แท็บลำดับไม่เหมือนกันเองด้วยซ้ำ)
   ⇒ ตัวกรองต้องส่งผ่าน `filters` (PageHeader วาดใต้แท็บให้เสมอ) — `actions` = ปุ่มคำสั่งเท่านั้น */
function parenBlock(code, i) {
  let depth = 0;
  for (let j = i; j < code.length; j++) {
    if (code[j] === '(') depth++;
    else if (code[j] === ')') { depth--; if (depth === 0) return code.slice(i, j + 1); }
  }
  return '';
}
function jsxPropBlock(code, from) {
  let i = code.indexOf('{', from), depth = 0;
  for (let j = i; j < code.length; j++) {
    if (code[j] === '{') depth++;
    else if (code[j] === '}') { depth--; if (depth === 0) return code.slice(i, j + 1); }
  }
  return '';
}
test('🛡️ ตัวกรองห้ามอยู่ใน actions ของ PageHeader — ใช้ filters (ลำดับ: ชื่อหน้า → แท็บ → แถบกรอง)', () => {
  const FILTER_CTL = /<select\b|<OrgScopePicker\b|<LineSelect\b|<Segmented\b|<SearchInput\b|<TimeRangeBar\b|type=["'](?:date|month|week)["']/;
  const bad = [];
  for (const file of walk(join(ROOT, 'src'), ['.jsx'])) {
    const code = stripComments(readFileSync(file, 'utf8'));
    let at = 0;
    while ((at = code.indexOf('<PageHeader', at)) !== -1) {
      const end = code.indexOf('/>', at);
      const seg = code.slice(at, end === -1 ? undefined : end);
      const k = seg.search(/\bactions=\{/);
      if (k !== -1) {
        let block = jsxPropBlock(code, at + k);
        /* ตัวกรองมักถูกประกอบเป็นตัวแปรก่อน (`const controls = (<>…</>)` แล้วส่ง `{controls}`)
           ⇒ ตามชื่อตัวแปรใน block ไปเปิดดูเนื้อของมันด้วย (เคสจริง: OBEYA {controls} · NPI {projectSelect}) */
        for (const [, id] of block.matchAll(/\{\s*(\w+)\s*\}/g)) {
          const d = code.search(new RegExp(`const\\s+${id}\\s*=\\s*\\(`));
          if (d !== -1) block += parenBlock(code, code.indexOf('(', d));
        }
        if (FILTER_CTL.test(block)) bad.push(`${relative(ROOT, file)}:${code.slice(0, at).split('\n').length}`);
      }
      at += 11;
    }
  }
  assert.deepEqual(bad, [], `\n\n❌ มีตัวกรองอยู่ใน actions ของ PageHeader ${bad.length} จุด\n`
    + '   ทำไมห้าม: ตัวกรองไปโผล่เหนือแถบแท็บ ขณะที่หน้าอื่นอยู่ใต้แท็บ ⇒ ลำดับโดดไปมาทุกหน้า (user 24/09/2026)\n'
    + '   แก้ยังไง: ย้ายไป prop `filters` ของ PageHeader (วาดใต้แท็บเป็น .filter-bar ให้เอง) — actions เหลือแค่ปุ่มคำสั่ง\n\n'
    + bad.map(b => '   • ' + b).join('\n') + '\n');
});

/* ── ทะเบียนสินค้ากลาง: คอลัมน์ที่ "ขาดแล้วตัวเลขผิดเงียบ" ต้องอยู่ในชุดเสมอ (2026-09-25) ──
   กฎเหล็ก CLAUDE.md "ชิ้น ≠ shot": ลืม `pair_mat_no` = pairMap ว่าง = งานคู่ (gang die / RH-LH)
   ถูกนับ **2 เท่า** ทุกจอที่ใช้ `computeLiveOee` โดยไม่มี error ให้เห็นสักบรรทัด
   ตั้งแต่ 25/09 ทั้งระบบอ่านคู่จาก cache ก้อนนี้ก้อนเดียว ⇒ คอลัมน์หายที่นี่ = ผิดพร้อมกันทุกจอ */
test('🛡️ PRODUCT_COLUMNS ต้องมี pair_mat_no + op_seq · และคีย์ cache ต้องถูก bump เมื่อชุดคอลัมน์เปลี่ยน', () => {
  const src = readFileSync(join(ROOT, 'src/utils/useProducts.js'), 'utf8');
  const cols = src.match(/PRODUCT_COLUMNS\s*=\s*'([^']+)'/)?.[1] || '';
  const set = new Set(cols.split(',').map(s => s.trim()));
  for (const need of ['pair_mat_no', 'op_seq', 'is_operation', 'op_parent_mat']) {
    assert.ok(set.has(need), `\n\n❌ PRODUCT_COLUMNS ขาด '${need}'\n`
      + '   ทำไมสำคัญ: pair_mat_no หาย = งานคู่ถูกนับ 2 เท่าทุกจอ (กฎเหล็ก "ชิ้น ≠ shot")\n'
      + '              op_seq/op_parent_mat หาย = ชั้น OP ไม่ถูกยุบ = ยอดผลิตนับซ้ำหลายขั้น\n'
      + '   แก้ยังไง: เติมคอลัมน์กลับใน PRODUCT_COLUMNS **แล้ว bump คีย์ cache ในบรรทัดถัดไปด้วย**\n');
  }
  // ชุดถอย (fallback ตอน migration ชั้น OP ยังไม่ลง) ต้องมี pair_mat_no ด้วย — ไม่งั้นถอยแล้วนับ 2 เท่า
  const fallback = [...src.matchAll(/'dr_products'\s*,\s*'([^']+)'/g)].map(m => m[1]).filter(c => c !== cols);
  assert.ok(fallback.length >= 1, 'คาดว่ามีชุดคอลัมน์ถอยอย่างน้อย 1 ชุดใน useProducts.js — ถ้าเอาออกแล้วให้ลบด่านนี้ด้วย');
  for (const f of fallback) {
    assert.ok(f.includes('pair_mat_no'), `\n\n❌ ชุดคอลัมน์ถอยใน useProducts.js ขาด pair_mat_no: '${f}'\n`
      + '   ถอยแล้วขาดคอลัมน์นี้ = งานคู่ถูกนับ 2 เท่า ซึ่งแย่กว่าการไม่ยุบชั้น OP มาก\n');
  }
});

/* ── ชั้น OP ต้องยุบเข้า "สินค้า" ไม่ใช่ "MAT ตัวเดียว" (2026-10-05 · คำสั่ง user) ──────────
   `op_parent_mat` เป็น text ช่องเดียว แต่สินค้าตัวเดียวแตกเป็นหลาย MAT ตามลูกค้า
   (แยกบิล/รหัส/MAT SAP) ⇒ กะที่ไลน์รันลูกค้าอื่น ขั้นตอนไม่ยุบ แล้วยอดถูกนับ 2 ครั้ง
   วัดจริงฐาน DR 05/10 (ต่อวันทำงาน+กะ ทั้งโรงงาน): **27 กะ · 18,659 ชิ้น · OP 5 ตัว**
   ⇒ `loadOpInfo` ต้องแนบ `alts` (พี่น้องแกน p_no เดียวกัน) · `collapseOps` ต้องเช็ค `alts` ด้วย */
test('🛡️ op-parent-is-product-not-mat — loadOpInfo ต้องแนบ alts · collapseOps ต้องใช้ alts', () => {
  const op = readFileSync(join(ROOT, 'src/utils/opItems.js'), 'utf8');
  const code = stripComments(op);
  assert.ok(/partCoreOf/.test(code), '\n\n❌ src/utils/opItems.js ไม่ได้ใช้ partCoreOf\n'
    + '   ทำไมสำคัญ: ไม่จับกลุ่มด้วยแกน p_no = `alts` ว่าง = ขั้นตอนไม่ยุบเมื่อไลน์รันลูกค้าอื่น\n'
    + '              ⇒ ยอดผลิตถูกนับ 2 ครั้ง (ขั้น + พาร์ทจริง) โดยไม่มี error (วัดจริง 18,659 ชิ้น)\n'
    + '   แก้ยังไง: import { partCoreOf } from \'./partGroup\' แล้วแนบ alts ใน loadOpInfo\n');
  assert.ok(/\balts\b/.test(code), '\n\n❌ loadOpInfo ไม่ได้คืน `alts` — ดูเหตุผลข้างบน\n');
  // ห้ามจับกลุ่มด้วย "ชื่อ" (ชื่อเป็นข้อความที่คนพิมพ์ ชนกันได้ ⇒ ยุบเกิน = ยอดขาด กู้ไม่ได้)
  assert.ok(!/groupSameProductKeys/.test(code),
    '\n\n❌ opItems.js ห้ามใช้ groupSameProductKeys (รวมด้วย "ชื่อ" ด้วย)\n'
    + '   ยุบเกิน = ตัดขั้นที่ไม่ควรตัด = ยอด**ขาด** ซึ่งแย่กว่านับซ้ำ · ใช้ partCoreOf (แกน p_no) เท่านั้น\n');

  const pt = stripComments(readFileSync(join(ROOT, 'src/utils/pairTotals.js'), 'utf8'));
  const fn = pt.slice(pt.indexOf('export function collapseOps'), pt.indexOf('function resolvePairAcrossOps'));
  assert.ok(fn.includes('op.alts'), '\n\n❌ collapseOps ไม่ได้เช็ค `op.alts`\n'
    + '   ทำไมสำคัญ: opItems แนบ alts มาแล้วแต่ไม่มีใครอ่าน = การแก้ตายเงียบ ยอดยังนับซ้ำ\n'
    + '   แก้ยังไง: ก่อนยุบเป็นกลุ่ม ให้ตัดขั้นทิ้งเมื่อ `(op.alts||[]).some(a => present.has(a))`\n');
});

/* ── คิวรับเข้าคลัง: ถอนยอด "auto" ของใบผลิต ต้องจัดการใบรอรับด้วย (2026-10-02) ──
   กฎรับเข้าโหมด 🟡 ต้องยืนยันรับ ⇒ ปิดใบผลิตแล้วของ**ไม่ได้ลงสต็อก** แต่ไปรอใน `stock_receipts`
   จุดที่ถอยใบ/ถอนยอดด้วย `created_by = 'auto'` อย่างเดียว = ใบรอรับค้างอยู่ → คลังกดรับของที่ไลน์ถอยไปแล้ว
   (สต็อกงอกจากใบที่ไม่มีอยู่จริง) — แถมพอไลน์ปิดใบใหม่ trigger ไม่ออกใบใหม่ให้เพราะเห็นใบเดิมยังรออยู่ */
test('🛡️ ถอนยอด auto ของใบผลิต ต้องยกเลิกใบรอรับเข้าคลัง (stock_receipts) ในไฟล์เดียวกันด้วย', () => {
  const bad = [];
  for (const file of walk(join(ROOT, 'src'), ['.js', '.jsx'])) {
    const code = stripComments(readFileSync(file, 'utf8'));
    if (/from\(\s*['"]line_stock_transactions['"]\s*\)[\s\S]{0,120}\.delete\(\)[\s\S]{0,160}created_by['"]\s*,\s*['"]auto['"]/.test(code)
        && !/from\(\s*['"]stock_receipts['"]\s*\)/.test(code)) bad.push(relative(ROOT, file));
  }
  assert.deepEqual(bad, [], `\n\n❌ ถอนยอด auto ของใบผลิตแต่ไม่แตะคิวรับเข้า: ${bad.join(', ')}\n`
    + '   แก้: update stock_receipts set status=cancelled (+ cancel_reason) where prod_order_id=… and status=pending\n'
    + '        และถ้ามีใบ received แล้ว ห้ามถอนเงียบ — บอกให้คลังปรับยอดเอง (ดู DailyReport handleRevertOrder)\n');
});

/* ── ช่องที่พิมพ์ ห้ามเป็นตัวที่จัด key/กลุ่มของลิสต์ (2026-10-02 · feedback หน้างาน) ──────
   เคสจริง `/pm-setup` ช่อง "กลุ่ม/หัวข้อ (Item)": การ์ดจุดตรวจถูกจัดกลุ่มตาม `group_name`
   แล้ววาดใน `<div key={g.name}>` ⇒ พิมพ์ "L" การ์ดย้ายจากกอง "ไม่ระบุกลุ่ม" ไปกลุ่มใหม่ ·
   พิมพ์ "o" ต่อ key เปลี่ยนเป็น "Lo" = กล่องเดิมถูก unmount แล้วสร้างใหม่
   ⇒ **หลุดโฟกัสทุกตัวอักษร ต้องคลิกกลับเข้าช่องใหม่ทุกครั้ง** (user แจ้ง 02/10)
   บั๊กคลาสนี้ build/lint/เทส/crashsweep/mobilesweep ผ่านหมด — เห็นได้ตอนพิมพ์จริงเท่านั้น

   ⚠️ **ทำไมเป็นกฎเจาะจงไฟล์ ไม่ใช่กฎสแกนทั้งรีโป** — ลองเขียนแบบทั่วไปแล้ว (ฟิลด์ที่โผล่ใน
   `key={}` ห้ามรับค่าจาก `<input>` ดิบ) ได้ 23 จุด **จริง 1 จุด** ที่เหลือเป็นคนละอ็อบเจกต์
   (ฟอร์ม `form.key` กับลิสต์ `key={t.key}` บังเอิญชื่อฟิลด์ตรงกัน) — regex แยก "ตัวแปรไหน"
   ไม่ได้ ⇒ ผิดกติกาข้อ 1 ของไฟล์นี้ (กฎที่ false positive บ่อย = คนอยากปิดด่าน)
   📌 audit ทั้งรีโป 02/10 แล้ว: **มีที่เดียวคือ PMSetup** · เจอที่ใหม่ให้เพิ่มไฟล์ในลิสต์นี้ */
test('🛡️ pm-setup-group-field-commit-input — ช่อง "กลุ่ม/หัวข้อ (Item)" ต้องเป็น <CommitInput>', () => {
  const src = stripComments(readFileSync(join(ROOT, 'src/pages/PMSetup.jsx'), 'utf8'));
  const bad = [];
  // ห้ามกลับไปเป็น input/textarea ดิบที่ยิง group_name ออกทุก keystroke
  if (/<(?:input|textarea)[^]{0,300}?group_name:\s*e\.target\.value/.test(src)) {
    bad.push('PMSetup.jsx — group_name ถูกยิงออกทุก keystroke จาก <input> ดิบอีกแล้ว');
  }
  if (!/<CommitInput[^]{0,200}?group_name/.test(src)) {
    bad.push('PMSetup.jsx — ไม่พบ <CommitInput ... group_name> (ช่องกลุ่ม/หัวข้อต้องส่งค่าตอน blur/Enter)');
  }
  // ตัวช่วยกลางต้องไม่ sync ค่าจาก prop ทับขณะยังพิมพ์อยู่ (ไม่งั้นของที่พิมพ์ค้างหายเงียบ)
  const ci = stripComments(readFileSync(join(ROOT, 'src/components/CommitInput.jsx'), 'utf8'));
  if (!/if\s*\(\s*!focused\.current\s*\)/.test(ci)) {
    bad.push('CommitInput.jsx — effect ที่ sync ค่าจาก prop ต้องมีเงื่อนไข !focused.current');
  }
  assert.deepEqual(bad, [],
    '\n\n❌ ช่องพิมพ์ที่ค่าของมันคือ key/ตัวจัดกลุ่มของลิสต์\n'
    + '   ทำไมห้าม: ส่งค่าออกทุก keystroke ⇒ ลิสต์จัดกลุ่มใหม่ ⇒ กล่องที่ถือ focus ถูก unmount\n'
    + '             = พิมพ์ได้ทีละตัวแล้วเด้ง ต้องคลิกกลับเข้าไปใหม่ (เกิดจริง /pm-setup 02/10)\n'
    + '   แก้ยังไง: ใช้ <CommitInput value={...} onCommit={v => ...}> (src/components/CommitInput.jsx)\n\n'
    + bad.map(b => '   • ' + b).join('\n') + '\n');
});

/* ── ชื่อพาร์ทห้ามตกเป็นเลข MAT (บั๊กจริง 02/10/2026) ──────────────────────────────
   ตัวแกะไฟล์ SAP อ่านคอลัมน์ "Object description" ไม่ออก (หัว `Obj` กินชื่อไปก่อน) ⇒ ทุกแถวได้
   `part_name = ''` แล้วโค้ดนำเข้าเขียน `part_name || mat_no` ลงฐาน = ทั้งใบขึ้นเป็นเลข 7 แถว
   **โดยไม่มี error สักบรรทัด** — user เห็นเองจากจอว่า "ทำไมเพี้ยนหมด"
   กฎ: ไม่มีชื่อ = หยุดแล้วบอกว่าแถวไหน ห้ามเติมเลข MAT ให้ดูเหมือนมีชื่อ */
test('🛡️ ห้าม fallback ชื่อพาร์ทเป็นเลข MAT (`part_name: x || x.mat_no`)', () => {
  const bad = [];
  for (const file of walk(join(ROOT, 'src'), ['.js', '.jsx', '.mjs'])) {
    const code = stripComments(readFileSync(file, 'utf8'));
    const re = /part_name\s*:\s*[^,\n]*\|\|\s*[\w.]*mat_no/g;
    for (const m of code.matchAll(re)) {
      bad.push(`${relative(ROOT, file)}:${code.slice(0, m.index).split('\n').length}  ${m[0].trim()}`);
    }
  }
  assert.deepEqual(bad, [], `\n\n❌ มีการเติมเลข MAT แทนชื่อพาร์ท ${bad.length} จุด\n`
    + '   ทำไมห้าม: ชื่อที่หายเพราะอ่านไฟล์ไม่ออก จะถูกกลบด้วยเลข MAT แล้วดูเหมือนข้อมูลปกติ\n'
    + '              (เกิดจริง 02/10/2026 — ใบ 10102017 ได้ชื่อเป็นเลขทั้ง 7 แถว ไม่มี error ให้เห็น)\n'
    + '   แก้ยังไง: ชื่อจากไฟล์ → ชื่อในทะเบียน parts_master → **ไม่มี = ไม่เขียน แล้วบอกบนจอว่าแถวไหน**\n\n'
    + bad.map(b => '   • ' + b).join('\n') + '\n');
});

test('🛡️ ตัวนำเข้า 862 ต้องตัดแถว "ยอดค้างตาม Cum" ของ ship-to ที่ใช้ e-SMART ก่อนสร้างใบ', () => {
  const code = stripComments(readFileSync(join(ROOT, 'src/pages/PlannerSales.jsx'), 'utf8'));
  assert.ok(/splitCumCatchUp\(\s*edi\.records/.test(code),
    '\n\n❌ PlannerSales.jsx ไม่เรียก splitCumCatchUp(edi.records, …) ก่อนสร้างใบ 862 แล้ว\n'
    + '   ทำไมห้าม: แถววันออกไฟล์ที่ไม่มีเวลา = Cum ที่ลูกค้าต้องการ − Cum ที่รับแล้ว ไม่ใช่เที่ยวรถ\n'
    + '              ถ้าสร้างเป็นใบจะชนใบ e-SMART (เกิดจริง AAT 01–02/10: ค้างแดง 1,605 + 1,415 ชิ้น)\n'
    + '   แก้ยังไง: ดู splitCumCatchUp ใน src/utils/ediMerge.js\n');
});

/* ── คน "หายทั้งส่วนงาน" เพราะกรองส่วนงานด้วย line_id (บั๊กจริง 05/10/2026) ────────────
   หัวหน้า PD2 แจ้ง "เช็คชื่อพนักงานผมหายหมดเลย" — ตั้งแผนก Assembly Line D ครบทุกคนแล้ว
   แต่ `employees.line_id` ยัง null ทั้ง 35 คน (กลุ่ม Assembly Line D2-D6 ในผังยังไม่ผูกไลน์ผลิต)
   จอเช็คชื่อกรอง section ด้วย `sectionFamilyIds.has(line_id)` ⇒ ไม่มีใครผ่านเลย = "แสดง 0 คน"
   กฎ: เลือก "ส่วนงาน" ต้องยึด `section` · เลือก "ไลน์" ค่อยยึด `line_id` (เข้มเหมือนเดิม) */
test('🛡️ /checkin: กรองด้วยส่วนงานต้องไม่ทิ้งคนที่ยังไม่ผูกไลน์', () => {
  const code = stripComments(readFileSync(join(ROOT, 'src/pages/Checkin.jsx'), 'utf8'));
  assert.ok(/if\s*\(\s*selSection\s*\)\s*return[^;]*emp\.section\s*===\s*selSection/.test(code),
    '\n\n❌ Checkin.jsx กรอง selSection โดยไม่มีทางออกให้คนที่ line_id ว่าง\n'
    + '   ทำไมห้าม: ผู้ใช้เลือก "ส่วนงาน" แต่โค้ดถามว่า "อยู่ไลน์ไหน" ⇒ คนที่ยังไม่ผูกไลน์หายเงียบทั้งกอง\n'
    + '              (เกิดจริง 05/10/2026 — PD2 คนหน้างาน 35 คน เช็คชื่อขึ้น 0 คน)\n'
    + '   แก้ยังไง: `return sectionFamilyIds.has(el) || (!el && emp.section === selSection)`\n'
    + '              แล้วนับคนที่ไม่มีไลน์ขึ้นเตือนบนจอ (noLineCount) — ห้ามปนเงียบ ๆ\n');
});

/* ── ตัวเลือกใน dropdown ต้องมาจากกองเดียวกับที่ตารางโชว์ (บั๊กจริง 05/10/2026) ──────────
   /operator สร้างตัวเลือก แผนก/กลุ่ม/ทีม จาก [...employees, ...inactiveEmployees] ขณะที่ตาราง
   โชว์ทีละกองตาม showInactive ⇒ dropdown เสนอค่าที่เลือกแล้วได้ 0 แถว (user: "ตัวกรองมั่ว") */
test('🛡️ /operator: ตัวเลือกตัวกรองต้องมาจากกองที่กำลังโชว์ ไม่ใช่รวมคนที่ปิดใช้งาน', () => {
  const code = stripComments(readFileSync(join(ROOT, 'src/pages/operator.jsx'), 'utf8'));
  assert.ok(/const\s+optPool\s*=\s*useMemo\(\s*\(\)\s*=>\s*\(\s*showInactive\s*\?/.test(code),
    '\n\n❌ operator.jsx ไม่ได้สร้างตัวเลือกตัวกรองจาก optPool (กองที่กำลังโชว์)\n'
    + '   ทำไมห้าม: ตารางโชว์ทีละกองตาม showInactive แต่ตัวเลือกมาจากทั้ง 2 กอง\n'
    + '              ⇒ หัวหน้ากดกรองแล้วจอว่าง นึกว่าคนหาย (เกิดจริง 05/10/2026 PD2)\n'
    + '   แก้ยังไง: `const optPool = useMemo(() => (showInactive ? inactiveEmployees : employees), …)`\n');
  /* ห้ามเฉพาะ "แหล่งตัวเลือก" — การค้นคนตาม id ข้ามทั้ง 2 กอง (handleEdit/toggle) ยังถูกต้อง */
  assert.ok(/const\s+empsInSec\s*=\s*useMemo\(\s*\(\)\s*=>\s*optPool\./.test(code),
    '\n\n❌ operator.jsx: empsInSec (ต้นทางตัวเลือก แผนก/กลุ่ม/ทีม) ไม่ได้มาจาก optPool — ดูเหตุผลด้านบน\n');
  assert.ok(/optPool\.map\(e\s*=>\s*e\.section\)/.test(code),
    '\n\n❌ operator.jsx: ตัวเลือกส่วนงาน (fallback) ไม่ได้มาจาก optPool — ดูเหตุผลด้านบน\n');
});

/* ── ลบโหนดผังองค์กร ต้องเช็ค "ทุกตารางที่อ้างถึง" ไม่ใช่แค่ลูกในผัง (05/10/2026) ──────────
   user: "เช็ค relate table ที แก้ไห้ถูก" — ของเดิมเช็คแค่ `nodes.filter(parent_id === id)`
   แต่ที่ชี้มาจริงยังมี employees.org_node_id (308 แถว) · profiles.org_node_id (72) ·
   org_assignments (4) + สำเนาชื่อแบบ text (employees.section/department/group_name/team)
   ⇒ ลบแผนกที่ "ไม่มีลูก" แต่มีคน 9 คน = FK set null เงียบ · ลบกลุ่ม = 35 คนเหลือชื่อกลุ่มที่ไม่มีอยู่ */
test('🛡️ /org-setup: ลบโหนดต้องผ่าน loadOrgNodeRefs + orgRefBlockMessage', () => {
  const code = stripComments(readFileSync(join(ROOT, 'src/pages/OrgSetup.jsx'), 'utf8'));
  assert.ok(/loadOrgNodeRefs\s*\(/.test(code) && /orgRefBlockMessage\s*\(/.test(code),
    '\n\n❌ OrgSetup.jsx ลบโหนดโดยไม่ได้เช็คตารางที่อ้างถึง\n'
    + '   ทำไมห้าม: employees.org_node_id/profiles.org_node_id เคยเป็น ON DELETE SET NULL\n'
    + '              ⇒ พนักงานหลุดสังกัดเงียบ · สำเนาชื่อแบบ text ไม่มี FK คุมเลย\n'
    + '   แก้ยังไง: `const refs = await loadOrgNodeRefs(supabase, node, nodes)` แล้วบล็อกด้วย\n'
    + '              `orgRefBlockMessage(node, refs)` ก่อนยิง delete (src/utils/orgNodeRefs.js)\n');
  assert.ok(/orgRefKeyChange\s*\(/.test(code) && /renameOrgRefs\s*\(/.test(code),
    '\n\n❌ OrgSetup.jsx เปลี่ยนชื่อ/code โหนดโดยไม่ไล่แก้ "สำเนาชื่อ" ในทะเบียนอื่น\n'
    + '   ทำไมห้าม: ทะเบียนพนักงาน/บัญชี จับคู่หน่วยงานด้วยข้อความ (ไม่ใช่ FK)\n'
    + '              เปลี่ยนคีย์แล้วไม่ตามแก้ = คนหลุดหน่วยงานเงียบ (เคยตามเก็บด้วย migration)\n');
});

/* ── เพิ่มชั้นใหม่ใน /org-setup แล้วลืมเติม map = ปุ่มโชว์แต่ใช้ไม่ได้ (05/10/2026) ──────────
   เกิดจริงวันเดียวกับที่เพิ่มชั้น "ทีม": หัวโมดัลขึ้น "เพิ่ม undefined" (ขาดใน KIND_LABEL) และ
   กดบันทึกเด้ง "แก้ได้เฉพาะแผนก/กลุ่ม…" เพราะ guard เป็นเชน ternary ที่ลงท้าย `: false`
   ⇒ ชั้นที่มีพาเนล/ปุ่ม ➕ ต้องมีครบทั้ง "ป้าย" และ "ตัวตรวจสิทธิ์" */
test('🛡️ /org-setup: ทุกชั้นที่มีปุ่มเพิ่ม ต้องมีป้าย + ตัวตรวจสิทธิ์ครบ', () => {
  const code = stripComments(readFileSync(join(ROOT, 'src/pages/OrgSetup.jsx'), 'utf8'));
  const kinds = ['section', 'department', 'line', 'team'];
  const label = code.match(/const\s+KIND_LABEL\s*=\s*\{[^}]*\}/)?.[0] || '';
  const missing = kinds.filter(k => !new RegExp(`\\b${k}\\s*:`).test(label));
  assert.deepEqual(missing, [], `\n\n❌ KIND_LABEL ขาดชั้น: ${missing.join(', ')}\n`
    + '   ผลที่เกิด: หัวโมดัลขึ้น "เพิ่ม undefined" (เกิดจริง 05/10/2026 ตอนเพิ่มชั้นทีม)\n');
  const rule = stripComments(readFileSync(join(ROOT, 'src/utils/orgNodeEdit.js'), 'utf8'));
  const map = rule.match(/const\s+ORG_PARENT_KIND\s*=\s*\{[^}]*\}/)?.[0] || '';
  assert.ok(/department\s*:/.test(map) && /line\s*:/.test(map) && /team\s*:/.test(map),
    '\n\n❌ orgNodeEdit.js ไม่มี ORG_PARENT_KIND ครบ department/line/team\n'
    + '   ทำไมห้ามเขียนเป็นเชน ternary: ลงท้าย `: false` ⇒ ชั้นที่ลืมต่อสาขาถูกบล็อกเงียบ\n'
    + '              ปุ่ม ➕ โชว์ (เช็คคนละที่) แต่กดบันทึกไม่ผ่าน = ผู้ใช้ไม่รู้ว่าทำอะไรผิด\n'
    + '   แก้ยังไง: เติมชั้นใหม่ใน `ORG_PARENT_KIND = { department: \'section\', line: \'department\', team: \'line\' }`\n');
  assert.ok(/orgSaveBlockReason\s*\(/.test(code),
    '\n\n❌ handleSave ไม่ได้ใช้ orgSaveBlockReason ตัดสินสิทธิ์ — ดูเหตุผลด้านบน\n');
});

/* ── 🔴 ทะเบียน "ของกลางทั้งโรงงาน" — ไม่มีเจ้าของรายหน่วย ⇒ ด่านคือ "คีย์สิทธิ์" (QC audit §7.4 · 20/10)
   ทะเบียนพวกนี้ไม่มีคอลัมน์หน่วยงานให้ยึด (machine_types · pm_facility_areas · break_policies ·
   bbs_agreements · skill_definitions) ⇒ ชั้นที่ 3 ใช้ไม่ได้ · ด่านเดียวที่มีคือคีย์เดียวกับปุ่มบนจอ
   แต่วัดแล้ว 13 handler **ไม่เช็คอะไรเลย** — พึ่งการซ่อนปุ่มอย่างเดียว (คลาสเดียวกับ audit ข้อ 5)
   ⚠️ ของพวกนี้แก้ทีเดียวกระทบทั้งโรงงาน (นโยบายพัก = ฐานเวลา %A/%P · นิยามสกิล = คะแนนทุกคน) */
test('🛡️ ทะเบียนของกลาง: handler ที่เขียนต้องเช็คคีย์สิทธิ์เอง ไม่ใช่พึ่งซ่อนปุ่ม', () => {
  /* ตรวจจาก "คำสั่งเขียนจริง" แล้วย้อนขึ้นไปหาฟังก์ชันที่ครอบมันอยู่ — ไม่ยึดชื่อฟังก์ชัน
     (ไฟล์ใหญ่มี handleSave ซ้ำหลายตัว · ยึดชื่อ = จับผิดตัว) */
  const FN = /\n  (?:const|async function)\s+[A-Za-z0-9_]+\s*=?\s*(?:async)?\s*(?:\([^)]*\)|[A-Za-z0-9_]+)\s*=>?\s*\{/g;
  const cases = [
    ['src/pages/MachineDatabase.jsx', 'machine_types',     /canEdit/,                  'machines:edit'],
    ['src/pages/MachineDatabase.jsx', 'pm_facility_areas', /canEdit/,                  'machines:edit'],
    ['src/pages/DailyReport.jsx',     'break_policies',    /canEdit/,                  'daily_report:setup'],
    ['src/pages/BbsCheck.jsx',        'bbs_agreements',    /canManage/,                'bbs:manage'],
    ['src/pages/FactoryMap.jsx',      'pm_facility_areas', /canEdit/,                  'factory_map:edit'],
    ['src/pages/operator.jsx',        'skill_definitions', /canEditSkills|canDeleteUtil/, 'skills:edit / skills:delete'],
  ];
  for (const [file, table, need, key] of cases) {
    const code = stripComments(readFileSync(join(ROOT, file), 'utf8'));
    const starts = [...code.matchAll(FN)].map(m => m.index);
    const writes = [...code.matchAll(new RegExp(`from\\('${table}'\\)[\\s\\S]{0,160}?\\.(insert|update|upsert|delete)\\(`, 'g'))];
    assert.ok(writes.length > 0, `${file}: ไม่เจอคำสั่งเขียน ${table} — ด่านนี้ต้องแก้ตามโครงไฟล์ใหม่`);
    for (const w of writes) {
      const fnStart = starts.filter(i => i < w.index).pop();
      const body = code.slice(fnStart ?? 0, w.index);
      assert.ok(need.test(body),
        `\n\n❌ ${file} เขียน ${table} โดยไม่เช็คสิทธิ์ (${key}) ในฟังก์ชันนั้น\n`
        + '   ทะเบียนของกลางไม่มีคอลัมน์หน่วยงาน ⇒ ชั้นที่ 3 ช่วยไม่ได้ คีย์สิทธิ์คือด่านเดียวที่มี\n'
        + '   และฝั่ง DR ไม่มี RLS ⇒ ยิงตรงก็ผ่าน ถ้าจอไม่เช็ค\n');
    }
  }
});

/* ── 🔴 MO: `manage_master` ต้องอยู่ "ท้ายสุด" ของตัวตรวจขั้น — ด่านทุกตัวต้องมาก่อน (20/10/2026) ──
   คีย์นี้ถูกแจกให้ role `mtn` **ทั้งก้อน 16 บัญชี** (ไม่ใช่แค่หัวหน้า) ⇒ ด่านไหนที่อยู่ "ใต้" มัน
   = ด่านปลอมสำหรับช่างทุกคน · เจอมาแล้ว 2 รอบในไฟล์เดียวกัน:
     · 15/10 ล็อก "ทีมใครทีมมัน" อยู่ใต้ manage_master ⇒ ช่างข้ามทีมได้
     · 20/10 ด่าน "งานปรับปรุง/สร้างต้องให้ ผจก.เซ็นก่อน" อยู่ใต้ manage_master ⇒ ช่างเริ่มงานเองได้
       (+ `canSignMtnApproval` ยอมให้ manage_master **เซ็นลายเซ็น ผจก. แทน** — เกิดจริง 1 ใบ
        โดยบัญชีกลาง `maintenance` ซึ่งสอบกลับไม่ได้ว่าใครกด) */
test('🛡️ mtn: ด่านทุกตัวต้องอยู่ก่อน manage_master · ช่องเซ็น ผจก. ห้ามเซ็นแทนด้วย manage_master', () => {
  const code = stripComments(readFileSync(join(ROOT, 'src/utils/mtnStepPerm.js'), 'utf8'));
  const fn = code.slice(code.indexOf('export function canDoStep'));
  const body = fn.slice(0, fn.indexOf('\nexport '));
  const iMaster = body.indexOf("can('manage_master')");
  assert.ok(iMaster > -1, 'canDoStep ไม่มีบรรทัด manage_master แล้ว — ด่านนี้ต้องแก้ตามโครงใหม่');
  for (const [what, needle] of [
    ['ด่านฝั่ง/ตำแหน่ง', 'wrong_side'],
    ['ล็อกทีมใครทีมมัน', "code: 'other_team'"],
    ['ด่านอนุมัติก่อนเริ่มงาน', 'await_mgr_approval'],
  ]) {
    const at = body.indexOf(needle);
    assert.ok(at > -1 && at < iMaster,
      `\n\n❌ ${what} อยู่ "ใต้" manage_master ใน canDoStep\n`
      + '   คีย์นั้นแจกให้ role mtn ทั้งก้อน ⇒ ด่านที่อยู่ใต้มันไม่เคยกัดช่างเลย (เกิดจริงมาแล้ว 2 รอบ)\n'
      + '   ย้ายบรรทัด `if (can(\'manage_master\')) …` ลงไปไว้ท้ายสุดของด่านทั้งหมด\n');
  }
  const sign = code.slice(code.indexOf('export function canSignMtnApproval'));
  const signBody = sign.slice(0, sign.indexOf('\n}'));
  assert.ok(!/can\('manage_master'\)/.test(signBody),
    '\n\n❌ canSignMtnApproval ยอมให้ manage_master เซ็นช่อง ผจก. แทน\n'
    + '   ช่องนี้คือลายเซ็น ผจก. บนใบจริง ⇒ ต้องเป็นคนที่ใบระบุชื่อ หรือผู้ถือ mtn_repair:approve เท่านั้น\n'
    + '   (กฎ 04/10 "ช่องเซ็นล็อกฝั่ง+ตำแหน่ง ไม่มีการเซ็นแทน แม้แต่ผู้ถือ manage_master")\n');
});

/* ── 🔴 SQL: `array_length(<NOT NULL default '{}'>, 1)` = NULL ⇒ ด่านผ่านทุกคนเงียบๆ (20/10/2026) ──
   เกิดจริงกับ `app_can_write_line()` (ตาข่ายขอบเขตชั้น DB): เขียน
     `resp_cost_centers is not null and array_length(resp_cost_centers,1) > 0`
   คอลัมน์เป็น NOT NULL default '{}' ⇒ array_length คืน NULL ⇒ `true and NULL` = NULL
   ⇒ OR ทั้งชุด NULL ⇒ `coalesce(..., true)` ⇒ **คืน true ให้ทุกคน ทุกไลน์** ทั้งที่ policy ผูกครบ
   (ตรวจ pg_policies เห็นชื่อฟังก์ชันอยู่ในนิพจน์ = ดูเหมือนมีด่าน — แต่ด่านไม่เคยบล็อกใครเลย)
   ⇒ ในไฟล์ migration ให้ใช้ `coalesce(array_length(x,1),0) > 0` เสมอ */
test('🛡️ migration SQL: ห้ามเช็คอาร์เรย์ว่างด้วย is-not-null + array_length (ได้ NULL = ด่านไม่ทำงาน)', () => {
  const dir = join(ROOT, 'supabase/migrations');
  const bad = [];
  for (const f of readdirSync(dir).filter(n => n.endsWith('.sql'))) {
    const sql = readFileSync(join(dir, f), 'utf8');
    /* 🔴 ดูเฉพาะไฟล์ที่นิพจน์นั้น "เป็นด่าน" (policy / ฟังก์ชันคืน boolean / CHECK)
       ใน `where` ของ UPDATE/SELECT ธรรมดา NULL = กรองแถวออก (ฝั่งปลอดภัย) ไม่ใช่ปล่อยผ่าน
       — วัดแล้ว: ถ้าไม่แยก จะจับไฟล์เก่า 2 ไฟล์ที่ถูกต้องอยู่แล้ว = ด่านที่คนอยากปิด */
    if (!/create\s+policy|returns\s+boolean|\bcheck\s*\(/i.test(sql)) continue;
    sql.split('\n').forEach((ln, i) => {
      if (/^\s*--/.test(ln)) return;                               // บรรทัดคอมเมนต์ (อธิบายบั๊กได้)
      if (/is\s+not\s+null\s+and\s+array_length\s*\(/i.test(ln)) bad.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(bad, [], `\n\n❌ เช็คอาร์เรย์ว่างแบบที่คืน NULL: ${bad.join(' · ')}\n`
    + "   `array_length('{}',1)` = NULL ⇒ `true and NULL` = NULL ⇒ OR ทั้งชุดเป็น NULL\n"
    + '   ถ้านิพจน์นั้นเป็นด่าน (policy/trigger) จะ "ผ่านทุกคนเงียบๆ" ทั้งที่ดูเหมือนมีด่าน\n'
    + "   แก้: `coalesce(array_length(<col>, 1), 0) > 0`\n");
});

/* ── 🔴 /lpa: ใบตรวจ + แผนเดือน/ไตรมาส ไม่เคยมีด่านชั้น 3 (QC audit §7 · 20/10/2026) ──────────
   หน้านี้มี `qWrite/qGuard` อยู่แล้ว แต่คุมแค่ **ทะเบียนคำถาม** (`lpa_questions`)
   ส่วน `lpa_audits`/`lpa_plans` ซึ่งเป็นเอกสาร ISO ของไลน์ เขียนได้โดยไม่ถามขอบเขตเลย
   ⇒ เปิด `?line=` ของส่วนงานอื่นแล้วบันทึก/ลบใบตรวจของเขาทับได้
   (วัดจริง 843 ใบ: ทุกใบคนเขียนอยู่ส่วนงานเดียวกับไลน์ หรือถือ scope:all_units ⇒ ด่านนี้ไม่กระทบงานจริง) */
test('🛡️ /lpa: ทุกฟังก์ชันที่เขียนใบตรวจ/แผน ต้องผ่านด่านไลน์ (lineGuard) ก่อน', () => {
  const code = stripComments(readFileSync(join(ROOT, 'src/pages/LayerProcessAudit.jsx'), 'utf8'));
  assert.ok(/const\s+lineWrite\s*=\s*canWriteLine\(/.test(code),
    '\n\n❌ LayerProcessAudit ไม่มี lineWrite = canWriteLine(...) — ด่านชั้น 3 ของไลน์ที่เลือกอยู่\n');
  for (const fn of ['const savePlan', 'const saveQuarter', 'const saveAudit', 'const deleteAudit',
                    'const handleSignDone', 'const fillStationsFromWorkstations']) {
    const at = code.indexOf(fn);
    assert.ok(at > -1, `LayerProcessAudit: หา ${fn} ไม่เจอ — ด่านนี้ต้องแก้ตามโครงไฟล์ใหม่`);
    assert.ok(/lineGuard\(/.test(code.slice(at, at + 320)),
      `\n\n❌ LPA ${fn.replace('const ', '')}() เขียนใบตรวจ/แผนโดยไม่ผ่าน lineGuard()\n`
      + '   ผลที่เกิด: เปิด ?line= ของส่วนงานอื่น แล้วบันทึก/ลบเอกสาร ISO ของไลน์เขาได้\n');
  }
  // ต้องเขียนเหตุผลบนจอด้วย ไม่ใช่เด้ง toast ตอนกดอย่างเดียว
  assert.ok(/!lineWrite\.ok[\s\S]{0,400}writeBlockText\(lineWrite/.test(code),
    '\n\n❌ LPA ไม่ได้เขียนบนจอว่าไลน์นี้แก้ไม่ได้ (ซ่อนปุ่มได้ ห้ามซ่อนเหตุผล · UI §6.9)\n');
});

/* ── 🔴 "ซ่อนปุ่ม" ไม่ใช่ด่าน — ฟังก์ชันที่เขียน DB ต้องเช็คคีย์เดียวกับปุ่ม (QC audit ข้อ 5 · 19/10) ──
   4 จอรอบสุดท้ายของ audit ข้อ 5: ปุ่มถูกซ่อนด้วย can()/canEdit อยู่แล้ว แต่ handler ไม่เช็คอะไรเลย
   ⇒ สิทธิ์เปลี่ยนระหว่างเปิดจอ / โมดัลเปิดค้าง / เรียกตรง = เขียนได้จริง (กฎเขียน DB ข้อ 10) */
test('🛡️ handler ที่เขียน DB ต้องเช็คสิทธิ์เอง ไม่ใช่พึ่งการซ่อนปุ่ม', () => {
  const cases = [
    ['src/pages/RackCenter.jsx', ['const issuePkg', 'const advance', 'const cancel'], /canOperate/, 'rack_center:operate'],
    ['src/components/QualityBins.jsx', ['const save', 'const remove', 'const toRed'], /canRecord|canManage/, 'scrap:record / scrap:manage'],
    ['src/pages/LineStock.jsx', ['const addRule', 'const setRuleMode', 'const deleteRule'], /noPerm\(\)|canEdit/, 'line_stock:manage_rounds'],
    ['src/pages/QualityControl.jsx', ['const createNCR', 'const cancelNCR', 'const updateNCR'], /canRecord|canManage/, 'qa:record / qa:manage'],
  ];
  for (const [file, fns, need, key] of cases) {
    const code = stripComments(readFileSync(join(ROOT, file), 'utf8'));
    for (const fn of fns) {
      const at = code.indexOf(fn);
      assert.ok(at > -1, `${file}: หา ${fn} ไม่เจอ — ด่านนี้ต้องแก้ตามโครงไฟล์ใหม่`);
      const head = code.slice(at, at + 420);
      assert.ok(need.test(head),
        `\n\n❌ ${file} → ${fn.replace('const ', '')}() ไม่ได้เช็คสิทธิ์ (${key}) ในฟังก์ชันเอง\n`
        + '   ทำไม: ซ่อนปุ่มไม่ใช่ด่าน — สิทธิ์เปลี่ยนระหว่างเปิดจอ / โมดัลเปิดค้าง / เรียกตรงได้\n'
        + '   (ฝั่ง DR ไม่มี RLS ให้พึ่งเลย = จอเป็นด่านเดียว)\n');
    }
  }
  /* KpiMonthly: เขียน kpi_definitions ต้องผ่านชั้นที่ 3 ทุกทาง — เดิมมีแต่ removeDef */
  const kpi = stripComments(readFileSync(join(ROOT, 'src/components/KpiMonthly.jsx'), 'utf8'));
  for (const fn of ['const copyFromYear', 'const restoreDef', 'const removeDef']) {
    const at = kpi.indexOf(fn);
    assert.ok(at > -1, `KpiMonthly: หา ${fn} ไม่เจอ`);
    assert.ok(/scopeWrite\.ok|rowWrite\.ok/.test(kpi.slice(at, at + 900)),
      `\n\n❌ KpiMonthly ${fn.replace('const ', '')}() ไม่ได้เช็คขอบเขต (ชั้นที่ 3) ก่อนเขียน kpi_definitions\n`
      + '   deep-link ?scope= เปิดขอบเขตของหน่วยอื่นได้ ⇒ คัดลอก/เปิดคืนนิยามของเขาได้\n');
  }
  // restoreDef ต้องตัดสินด้วย "ขอบเขตของแถว" ไม่ใช่ขอบเขตที่เปิดอยู่ (ถูกเรียกด้วยแถวแฝดจากขอบเขตอื่น)
  const rd = kpi.slice(kpi.indexOf('const restoreDef'), kpi.indexOf('const removeDef'));
  assert.ok(/scopeOfDef\(d2\)/.test(rd) && /rowWrite/.test(rd),
    '\n\n❌ restoreDef ต้องคิดขอบเขตจากแถว (scopeOfDef(d2)) — ใช้ scopeWrite ของหน้าจะตัดสินผิดแถว\n');
});

/* ── 🔴 /npi: แผงลูกเขียนของพาร์ทไลน์อื่นได้ (QC audit ข้อ 5 · 19/10/2026) ───────────────────
   หน้าแม่มี `partWriteOf` (canWriteLine ของไลน์พาร์ท) แต่ส่งเข้าแผงลูกแค่ `canEdit`
   ⇒ 4 แผง (พาร์ท · แบบ/ECI · tooling · งาน) เขียน/ลบแถวของพาร์ทไลน์อื่นได้ทั้งหมด
   และ `delProject` ลบโปรเจค (cascade ทั้งพาร์ท/เอกสาร/ECI/tooling) โดยไม่ถามขอบเขตเลย
   ⇒ กฎรวมที่ `src/utils/npiScope.js` · แผงลูกห้ามคิดกฎเอง · ลบโปรเจคต้องนับพาร์ทได้ก่อน */
test('🛡️ /npi: แผงลูกต้องรับกฎขอบเขต + ลบโปรเจคต้องนับพาร์ทครบก่อน', () => {
  const npi = stripComments(readFileSync(join(ROOT, 'src/pages/NPI.jsx'), 'utf8'));
  for (const c of ['NpiPartPanel', 'NpiDrawingsEci', 'NpiTooling', 'NpiTasks']) {
    const at = npi.indexOf(`<${c} `);
    const tag = npi.slice(at, at + npi.slice(at).indexOf('/>') + 2);   // ตัดที่ปลาย tag เท่านั้น
    assert.ok(at > -1 && tag.length > 10, `หา <${c}> ใน NPI.jsx ไม่เจอ — ด่านนี้ต้องแก้ตามโครงใหม่`);
    assert.ok(/partWriteOf=\{partWriteOf\}/.test(tag),
      `\n\n❌ NPI.jsx ไม่ได้ส่ง partWriteOf เข้า <${c}> — แผงนั้นเขียนของพาร์ทไลน์อื่นได้\n`
      + '   (หน้าแม่คือที่เดียวที่รู้ ctx + ทะเบียนไลน์ ⇒ ต้องส่งตัวตัดสินลงไป ไม่ให้แผงลูกคิดเอง)\n');
  }
  const del = npi.slice(npi.indexOf('const delProject'));
  const guard = del.indexOf('npiProjectDeleteBlock');
  const write = del.search(/from\('npi_projects'\)[\s\S]{0,80}\.delete\(/);
  assert.ok(guard > -1 && write > -1 && guard < write,
    '\n\n❌ NPI.delProject ไม่ได้ผ่าน npiProjectDeleteBlock ก่อนลบ\n'
    + '   ลบโปรเจค = cascade ลบพาร์ท/เอกสาร/ECI/tooling ทั้งก้อน ⇒ ต้องแก้ได้ทุกพาร์ท\n'
    + '   และ "นับพาร์ทไม่ได้ = ห้ามลบ" (fail-closed · กฎเขียน DB ข้อ 2)\n');
  assert.ok(/countable:\s*!ePart/.test(del.slice(0, 1200)),
    '\n\n❌ delProject ต้องส่ง countable จากผลอ่าน npi_parts (อ่านไม่สำเร็จ = ห้ามลบ)\n');

  // แผงลูกต้องเรียกกฎจาก utils (ไม่ใช่เขียนเงื่อนไขสิทธิ์เอง) และต้องเช็คก่อนเขียน
  const files = {
    'src/components/NpiPartPanel.jsx': [/npiBlock\(/, /blocked\(\)/],
    'src/components/NpiDrawingsEci.jsx': [/npiBlockForPart\(/, /rowBlocked\(/],
    'src/components/NpiTooling.jsx': [/npiBlockForPart\(/, /rowBlocked\(/],
    'src/components/NpiTasks.jsx': [/npiBlockForPart\(/, /rowBlocked\(/],
  };
  for (const [f, pats] of Object.entries(files)) {
    const code = stripComments(readFileSync(join(ROOT, f), 'utf8'));
    for (const re of pats) {
      assert.ok(re.test(code), `\n\n❌ ${f} ไม่ได้ใช้กฎขอบเขตจาก utils/npiScope.js (${re})\n`
        + '   ทุกฟังก์ชันที่เขียน DB ในแผงนี้ต้องเช็คขอบเขตของพาร์ทก่อน\n');
    }
    const writes = [...code.matchAll(/from\('npi_[a-z_]+'\)[\s\S]{0,160}?\.(update|insert|delete)\(/g)];
    assert.ok(writes.length > 0, `${f}: ไม่เจอ write เลย — ด่านนี้ต้องแก้ตามโครงไฟล์ใหม่`);
  }
});

/* ── 🔴 ทางเขียนที่ยังไม่มีด่านชั้น 3 เลย + "ย้ายของ" ที่ไม่เช็คปลายทาง (QC audit ข้อ 5 · 19/10) ──
   3 จุดที่ปิดรอบนี้ — คลาสเดียวกับ /org-setup ข้างล่าง แต่คนละหน้า:
   · PMCheckData `NgRecheckPanel` เขียน action/ค่าวัดใหม่ลง inspection_results โดย**ไม่มีด่านเลย**
   · PmCoordination `notify`/`toggleTask` เขียนสถานะ/ติ๊กงานของแผนไลน์อื่น · `PlanModal.save` ย้ายไลน์ได้
   · PMSetup `handleTransfer` ย้าย/คัดลอกรายการตรวจ + ประวัติ เข้า **ทีมปลายทาง** โดยเช็คแต่ทีมต้นทาง */
test('🛡️ PM/แผนประสาน: ทางเขียนต้องมีด่านชั้น 3 · ย้ายของต้องเช็คปลายทาง', () => {
  const pmc = stripComments(readFileSync(join(ROOT, 'src/pages/PMCheckData.jsx'), 'utf8'));
  const panel = pmc.slice(pmc.indexOf('function NgRecheckPanel'));
  const body = panel.slice(0, panel.indexOf('\nfunction '));
  const sub = body.slice(body.indexOf('const submit'));   // ต้องอยู่ "ในฟังก์ชันที่เขียน" ไม่ใช่แค่โผล่ในไฟล์
  const gIdx = sub.indexOf('!canRecord');
  const wIdx = sub.search(/from\('inspection_results'\)[\s\S]{0,140}\.update\(/);
  assert.ok(gIdx > -1 && wIdx > -1 && gIdx < wIdx,
    '\n\n❌ NgRecheckPanel เขียน inspection_results โดยไม่ผ่านด่าน canRecord (สิทธิ์ลงผลตรวจ + แกนทีม)\n'
    + '   ผลที่เกิด: ใครเปิดประวัติของทีมอื่นได้ ก็เขียน action/ค่าวัดใหม่ทับผลตรวจของทีมนั้นได้\n');

  const coord = stripComments(readFileSync(join(ROOT, 'src/pages/PmCoordination.jsx'), 'utf8'));
  for (const fn of ['const notify =', 'const toggleTask =']) {
    const part = coord.slice(coord.indexOf(fn), coord.indexOf(fn) + 700);
    assert.ok(/planWrite\.ok/.test(part),
      `\n\n❌ PmCoordination ${fn.replace('const ', '').replace(' =', '')} ไม่ได้เช็ค planWrite\n`
      + '   ผลที่เกิด: แจ้ง Production / ติ๊กงาน ของแผนไลน์ส่วนงานอื่นได้ (notify ยิง Telegram ออกข้างนอกด้วย)\n');
  }
  const save = coord.slice(coord.indexOf('const save = async'));
  const dst = save.search(/canWriteLine\([^)]*f\.line_name/);
  const ins = save.search(/from\('pm_coordination_plans'\)/);
  assert.ok(dst > -1 && ins > -1 && dst < ins,
    '\n\n❌ PmCoordination PlanModal.save ไม่ได้เช็ค "ไลน์ปลายทาง" (f.line_name) ก่อนเขียน\n'
    + '   ผลที่เกิด: แก้แผนของไลน์เรา แล้วเปลี่ยนไลน์เป็นของส่วนงานอื่น = ย้ายแผนข้ามส่วนงานเงียบๆ\n');

  const setup = stripComments(readFileSync(join(ROOT, 'src/pages/PMSetup.jsx'), 'utf8'));
  const tr = setup.slice(setup.indexOf('const handleTransfer'));
  const dstT = tr.indexOf('teamWriteOf');
  const run = tr.search(/moveChecklistDept|copyChecklistToDept/);
  assert.ok(dstT > -1 && run > -1 && dstT < run,
    '\n\n❌ PMSetup.handleTransfer ไม่ได้เช็ค "ทีมปลายทาง" ก่อนย้าย/คัดลอกรายการตรวจ\n'
    + '   ผลที่เกิด: ย้ายรายการตรวจ + ประวัติการตรวจทั้งก้อนเข้าไปในทีมช่างอื่นได้ (ของเขาถูกทับด้วย)\n');
});

/* ── 🔴 ย้ายโหนดผัง = เขียนลง "แม่ใหม่" ⇒ เช็คแต่ต้นทางไม่พอ (QC audit ข้อ 5 · 19/10/2026) ─────
   เคสจริงที่ปิดไป: ผู้ถือ org:manage_own_unit เปิดแก้กลุ่มของตัวเอง (ต้นทางผ่าน) แล้วเปลี่ยนช่อง
   "อยู่ภายใต้" เป็นแผนกของส่วนงานอื่น — payload เขียน parent_id ใหม่ ส่วน guard มองแถวเดิม
   = ย้ายหน่วยงานเข้าไปแขวนใต้ส่วนงานที่ไม่ใช่ของตัวเองได้ (ลิสต์ก็โชว์ทั้งโรงงาน)
   ⇒ ด่านตอนบันทึกต้องถามปลายทางด้วย (orgSaveBlockReason) และกฎต้องอยู่ใน utils ที่เดียว */
test('🛡️ /org-setup: ด่านตอนบันทึกต้องเช็ค "ปลายทาง" ของการย้าย ไม่ใช่แค่แถวเดิม', () => {
  const rule = stripComments(readFileSync(join(ROOT, 'src/utils/orgNodeEdit.js'), 'utf8'));
  assert.ok(/export\s+function\s+orgSaveBlockReason/.test(rule)
    && /moved[\s\S]{0,200}canAddOrgNodeUnder/.test(rule),
    '\n\n❌ orgNodeEdit.orgSaveBlockReason ไม่ได้เทียบแม่เดิมกับแม่ใหม่แล้วเช็คปลายทาง\n'
    + '   ผลที่เกิด: ย้ายหน่วยงานข้ามส่วนงานได้ทั้งที่ไม่มีสิทธิ์ (เขียนของหน่วยงานอื่น)\n');
  const code = stripComments(readFileSync(join(ROOT, 'src/pages/OrgSetup.jsx'), 'utf8'));
  const save = code.slice(code.indexOf('const handleSave'));
  const guard = save.indexOf('orgSaveBlockReason');
  const write = save.search(/from\('org_nodes'\)/);
  assert.ok(guard > -1 && write > -1 && guard < write,
    '\n\n❌ handleSave เขียน org_nodes ก่อนผ่าน orgSaveBlockReason (ด่านต้องมาก่อนการเขียน)\n');
  /* กฎห้ามถูกก๊อปกลับมาไล่สายในหน้า — เคยมี canEditNode/canAddLineHere ไล่ parent_id เองทีละชั้น */
  assert.ok(!/allDepts\.find\([^)]*\)[\s\S]{0,80}parent_id\s*===\s*mySecId/.test(code),
    '\n\n❌ OrgSetup.jsx ไล่สายผัง/เทียบ mySecId เองในหน้า — ใช้ utils/orgNodeEdit.js ที่เดียว\n');
});

/* ── สำเนาชื่อของผัง: กลุ่มเก็บ "ชื่อ" · ที่เหลือเก็บ code||name — ห้ามเดาเป็น name หมด ───── */
test('🛡️ orgNodeRefs: คีย์จับคู่ของกลุ่มต้องเป็นชื่อ ไม่ใช่ code (code = เลขไลน์)', () => {
  const code = stripComments(readFileSync(join(ROOT, 'src/utils/orgNodeRefs.js'), 'utf8'));
  assert.ok(/kind\s*===\s*'line'[\s\S]{0,120}node\.name\s*,\s*node\.code/.test(code),
    '\n\n❌ orgNodeRefs.orgRefValues: กลุ่ม (kind=line) ต้องเอา name มาก่อน code\n'
    + '   ทำไม: code ของ kind=line เป็นเลขไลน์ (\'9\'/\'12\') ส่วน employees.group_name เก็บชื่อกลุ่ม\n'
    + '          สลับลำดับ = ไล่เปลี่ยนชื่อผิดคอลัมน์/นับคนไม่เจอ (operator.jsx §เลือกกลุ่ม)\n');
});

test('🛡️ insert/upsert ลง dr_products ห้ามส่ง created_by (ตารางไม่มีคอลัมน์นี้ — ผู้แก้ประทับเองที่ updated_by_*)', () => {
  const bad = [];
  for (const file of walk(join(ROOT, 'src'), ['.js', '.jsx'])) {
    const code = stripComments(readFileSync(file, 'utf8'));
    const re = /from\(\s*'dr_products'\s*\)\s*\.\s*(?:insert|upsert)\(\s*\{[^}]*\bcreated_by\s*:/g;
    for (const m of code.matchAll(re)) bad.push(`${relative(ROOT, file)}:${code.slice(0, m.index).split('\n').length}`);
  }
  assert.deepEqual(bad, [], `\n\n❌ ส่ง created_by เข้า dr_products ${bad.length} จุด\n`
    + '   ทำไมห้าม: PostgREST ปฏิเสธทั้งแถว "Could not find the created_by column" (เกิดจริง 05/10 ปุ่มเปิดใบ BOM ใช้ไม่ได้)\n'
    + '   แก้ยังไง: ตัดฟิลด์นี้ออก — dr_products อยู่ใน DR_AUDIT_TABLES ผู้แก้ถูกประทับที่ updated_by_name/uid ให้เอง\n\n'
    + bad.map(b => '   • ' + b).join('\n') + '\n');
});

/* ── บอร์ด New Model: การ์ดทุกใบขนาดเท่ากัน = บอร์ดไม่มีลำดับสายตา (feedback user 05/10/2026) ──
   *"สเกลการ์ดเท่ากันแบบนี้มันดูไม่มีการ design ที่ดี มันควรมีน้ำหนักที่ต่างกันในแต่ละการ์ด"*
   บอร์ด 737D MLM: 21 แผง มี 14 ใบ (67%) ที่ไม่มีข้อความให้อ่านเลย แต่กินที่เท่าใบแดงที่มี 3 บรรทัด */
test('🛡️ /nm-board โหมดจอ TV: ขนาดการ์ดต้องมาจาก tvWeightedLayout ห้ามกลับไปกริด 1fr เท่ากันทุกใบ', () => {
  const file = 'src/pages/NewModelBoard.jsx';
  const code = stripComments(readFileSync(join(ROOT, file), 'utf8'));
  assert.ok(/tvWeightedLayout\s*\(/.test(code),
    '\n\n❌ NewModelBoard.jsx ไม่ได้ใช้ tvWeightedLayout — การ์ดกลับไปขนาดเท่ากันหมดแล้ว\n'
    + '   ทำไมห้าม: น้ำหนักการ์ด = ปริมาณที่ต้องอ่าน (แดง 3 : เหลือง 2 : เขียว/ยังไม่ประเมิน 1)\n'
    + '              ใบเขียว/ยังไม่ประเมินไม่มีข้อความเลย ถ้ากินที่เท่าใบแดง คนยืนหน้าบอร์ดต้องกวาดตาทีละใบ\n'
    + '   แก้ยังไง: `const { rows } = tvWeightedLayout(proj.panels)` แล้ววาดแถวละ flex ตาม panelWeight()\n');
  assert.ok(!/gridTemplateRows:\s*`repeat\(\$\{rows\}/.test(code),
    `\n\n❌ ${file} กลับไปใช้กริด rows×cols ช่องเท่ากันแล้ว — ดูเหตุผลด้านบน\n`);
  /* 🔴 กดการ์ดแล้วต้องเจาะเข้าแผงได้ — ก่อน 05/10 การ์ดบนจอ TV เป็น <div> เฉยๆ กดไม่ได้เลย
     (user: "ยังกดเจาะไปในแต่ละการ์ดไม่ได้") */
  assert.ok(/onPick\s*\(\s*p\s*\)/.test(code),
    `\n\n❌ ${file}: การ์ดบนบอร์ด TV กดเจาะไม่ได้ (ไม่มี onPick)\n`
    + '   ทำไมต้องมี: บอร์ดคือจุดเริ่มของการไล่ปัญหา — เห็นใบแดงแล้วต้องกดดูได้ว่าแดงเพราะอะไร\n');
});

test('🛡️ /nm-board: ห้ามเรียงการ์ดใหม่ตามสี (คนจำตำแหน่งแผงบนบอร์ดกระดาษ)', () => {
  const code = stripComments(readFileSync(join(ROOT, 'src/pages/NewModelBoard.jsx'), 'utf8'));
  assert.ok(!/panels[\s\S]{0,40}\.sort\(/.test(code) && !/gridAutoFlow:\s*'dense'/.test(code),
    '\n\n❌ NewModelBoard.jsx เรียง/สลับตำแหน่งแผงเอง (sort หรือ gridAutoFlow:dense)\n'
    + '   ทำไมห้าม: สีเปลี่ยนทุกสัปดาห์ ถ้าใบย้ายที่ตามสี คนหาแผงที่ต้องการไม่เจอ\n'
    + '              บอร์ดกระดาษของจริง ตำแหน่งแผงคงที่เสมอ — ระบบต้องเหมือนกัน\n');
});

/* ── หมวดฐานพนักงาน: "จอโชว์ว่าทำได้ แต่ระบบไม่ให้ทำ" (ไล่ตรวจทั้งหมวด 06/10/2026) ─────────
   คลาสเดียวกับ /org-setup 05/10 (ปุ่มโชว์ แต่ด่านตอนบันทึกไม่รู้จักชั้นใหม่) — user สั่งให้
   ไล่ตรวจให้หมดในหมวดฐานพนักงาน · เจอ 4 จุด แก้แล้ว ด่านข้างล่างกันไม่ให้ย้อนกลับ */
test('🛡️ /operator: ปุ่มอนุมัติอัพระดับ ต้องเช็คสิทธิ์ที่ "การเขียนจริง" ต้องใช้ด้วย', () => {
  const code = stripComments(readFileSync(join(ROOT, 'src/pages/operator.jsx'), 'utf8'));
  assert.ok(/const\s+writeBlock\s*=/.test(code) && /canApprove\s*=\s*mayApprove\s*&&\s*!writeBlock/.test(code),
    '\n\n❌ operator.jsx: canApprove ดูแค่ skills:approve_levelup\n'
    + '   ทำไมห้าม: การอนุมัติเขียน employee_skills.score = to_level ซึ่ง RLS WITH CHECK บังคับ\n'
    + '              score ≤ 50 ‖ skills:edit_high · สกิลค่าฝีมือ ‖ skills:edit_allowance\n'
    + '              ⇒ ผู้อนุมัติที่ไม่มี edit_high กด Lv.75/100 = เด้ง error ดิบจาก Postgres\n'
    + '   แก้ยังไง: คิด writeBlock จาก SKILL_EDIT_CAP + canEditHighSkill/canEditAllowance\n'
    + '              แล้ว canApprove = mayApprove && !writeBlock (จอต้องบอกว่าขาดคีย์ไหน)\n');
});

test('🛡️ /operator: ช่องติ๊กสกิลที่คะแนนเกินเพดาน ต้องถูกล็อกเหมือนช่องคะแนน', () => {
  const code = stripComments(readFileSync(join(ROOT, 'src/pages/operator.jsx'), 'utf8'));
  assert.ok(/rowEditable\s*=[^;]*!lockedAllowance\s*&&\s*!lockedHigh/.test(code),
    '\n\n❌ operator.jsx: rowEditable ไม่ได้รวม !lockedHigh\n'
    + '   ทำไมห้าม: ช่องคะแนนถูกล็อก แต่ช่องติ๊กยังกดออกได้ ⇒ handleSaveEmp ข้ามแถวนั้นเงียบ\n'
    + '              แล้วขึ้น "อัปเดตเรียบร้อย!" · เปิดดูใหม่สกิลยังอยู่ (วัดจริง 06/10:\n'
    + '              720 แถว / 148 คน มีคะแนนเกินเพดาน 50 ที่ role leader ตั้งได้)\n');
  assert.ok(/skipped\.push\(/.test(code) && /skipNote/.test(code),
    '\n\n❌ operator.jsx: แถวที่สิทธิ์ไม่ถึงถูกข้ามโดยไม่บอกผู้ใช้ — ต้องเก็บ skipped แล้วรายงาน\n');
});

test('🛡️ /register: ช่องกลุ่มต้องเก็บ "ชื่อกลุ่ม" + เตือนกลุ่มที่ยังไม่ผูกไลน์ (เท่ากับ /operator)', () => {
  const code = stripComments(readFileSync(join(ROOT, 'src/pages/Register.jsx'), 'utf8'));
  assert.ok(!/orgGroupOpts\.map\(g\s*=>\s*<option[^>]*value=\{g\.code\s*\|\|\s*g\.name\}/.test(code),
    '\n\n❌ Register.jsx เก็บ group_name เป็น `code || name` — ไม่ตรงกับ /operator ที่เก็บ "ชื่อ"\n'
    + '   ทำไมห้าม: org_nodes(kind=line).code บางตัวคนละสตริงกับชื่อ (ของจริง 06/10:\n'
    + '              ASSEMBLY 1 → code \'Assembly Line D1\') ⇒ คนลงทะเบียนใหม่แยกออกจาก\n'
    + '              เพื่อนร่วมกลุ่ม 35 คนในทุกตัวกรอง และ /operator โชว์ว่า "(นอกผัง)"\n');
  assert.ok(/ref_line_id\s*\?\s*''\s*:\s*'\s*⚠ ยังไม่ผูกไลน์'/.test(code) && /จะไม่ขึ้นในหน้าเช็คชื่อ/.test(code),
    '\n\n❌ Register.jsx ไม่เตือนตอนเลือกกลุ่มที่ยังไม่ผูกไลน์ผลิต\n'
    + '   ทำไมห้าม: ref_line_id ว่าง ⇒ line_id = null ⇒ พนักงานใหม่ไม่ขึ้นหน้าเช็คชื่อ เงียบสนิท\n'
    + '              (เคสจริง 05/10 PD2 35 คน — /operator เตือนแล้ว หน้าลงทะเบียนต้องเตือนด้วย)\n');
  assert.ok(/if\s*\(!canRegister\)\s*return toast\.error/.test(code),
    '\n\n❌ Register.jsx: handleRegister ไม่มีด่านชั้นสอง — ปุ่ม disabled อย่างเดียวไม่พอ (Enter ก็ submit ได้)\n');
});

/* ── /nm-board ↔ /npi: ผูกกันด้วย "ตัวชี้" ห้ามให้ระบบเขียนทับสี EVA (06/10/2026 · คำสั่ง user) ──
   IEC เขียนกติกาไว้เองว่า EVA **คนตั้งสีเอง** (`Obeya_E_Board-V2.pptx` ข้อ 1) — ระบบ *เสนอ* ได้
   แต่ห้ามเขียนทับ · ถ้าบอร์ดเริ่มเอาสถานะเอกสารจาก NPI มาคิดสีเอง = ผิดกติกาเจ้าของบอร์ด */
test('🛡️ /nm-board: ห้ามเอาข้อมูล NPI ไปคิดสี EVA เอง (คนตั้งสีเท่านั้น — กติกา IEC ข้อ 1)', () => {
  const code = stripComments(readFileSync(join(ROOT, 'src/pages/NewModelBoard.jsx'), 'utf8'));
  assert.ok(!/eva\s*[:=]\s*[^;,\n]*\b(sum|npi)\b/i.test(code),
    '\n\n❌ NewModelBoard.jsx เอาค่าจาก NPI ไปตั้ง eva ของแผง/รุ่น\n'
    + '   ทำไมห้าม: IEC เขียนกติกามาเองว่า EVA คนตั้งสีเอง ระบบเสนอได้แต่ห้ามเขียนทับ\n'
    + '              บอร์ดคือภาพที่คนตัดสินใจร่วมกัน ไม่ใช่รายงานอัตโนมัติ\n'
    + '   แก้ยังไง: ยกตัวเลข NPI มา "แสดงข้างๆ" (NpiLinkCard) แล้วให้คนตัดสินสีเอง\n');
  /* เขียนกลับฝั่ง NPI จากบอร์ดก็ห้าม — บอร์ดเป็นจอดูอย่างเดียวในเฟสนี้ */
  assert.ok(!/from\(\s*'npi_[a-z_]+'\s*\)\s*\.\s*(insert|update|upsert|delete)/.test(code),
    '\n\n❌ NewModelBoard.jsx เขียนข้อมูลลงตาราง npi_* — บอร์ดเป็นจออ่านอย่างเดียวในเฟสนี้\n');
});

test('🛡️ /nm-board ↔ /npi: ห้ามเดาการผูกจากชื่อ/ลูกค้า — ต้องอ่านจาก npi_projects.nm_board_id', () => {
  const board = stripComments(readFileSync(join(ROOT, 'src/pages/NewModelBoard.jsx'), 'utf8'));
  assert.ok(/\.eq\(\s*'nm_board_id'/.test(board),
    '\n\n❌ NewModelBoard.jsx ไม่ได้หาโปรเจค NPI ด้วยคอลัมน์ผูก `nm_board_id`\n'
    + '   ทำไมสำคัญ: `model` ซ้ำกันได้ (หลายรุ่นย่อยของ platform เดียว) เดาผิด = บอร์ดโชว์ตัวเลขของรุ่นอื่น\n'
    + '              ซึ่งแย่กว่าไม่โชว์เลย · ยังไม่ผูก = เขียนบนจอว่ายังไม่ผูก\n'
    + '   แก้ยังไง: `.eq(\'nm_board_id\', <รหัสรุ่นบนบอร์ด>)` · คนผูกเองที่ /npi → ✏️ โปรเจค\n');
  assert.ok(!/nm_board_id[\s\S]{0,80}(toLowerCase|includes|match)\s*\(/.test(board),
    '\n\n❌ NewModelBoard.jsx จับคู่โปรเจค NPI ด้วยการเทียบข้อความ — ดูเหตุผลด้านบน\n');
});

/* ── ฟอนต์บนจอห้ามต่ำกว่า 11px (user เคาะเลขเดียว 06/10 หลัง QC audit) ────────────────
   เอกสาร (CLAUDE.md §Design System · UI-CONVENTIONS §4) เขียน "ขั้นต่ำ 11-12px" มาตลอด
   แต่ **ไม่เคยมีด่าน** ⇒ drift กลับมาเรื่อยๆ (วัด 06/10: 160 จุดที่ต่ำกว่า 11 · ด่าน chartsweep
   เองก็ตั้งเกณฑ์ไว้ 10.5 ทำให้ 92 จุด "ผ่านด่าน แต่ผิดเอกสาร")
   จอหน้างานเป็น TV 43" แขวนไกล — 10px อ่านไม่ออกจริง ไม่ใช่เรื่องสวยงาม
   ข้อยกเว้น: `src/lib/**` = ใบพิมพ์/PPTX (หน่วย pt บนกระดาษ) · บรรทัด jsPDF autoTable */
test('🛡️ UI: fontSize บนจอต้องไม่ต่ำกว่า 11px', () => {
  const bad = [];
  for (const file of walk(join(ROOT, 'src'), ['.js', '.jsx'])) {
    const rel = relative(ROOT, file);
    if (rel.startsWith('lib/') || rel.startsWith('src/lib/') || rel.includes('__tests__')) continue;
    const code = stripComments(readFileSync(file, 'utf8'));
    code.split('\n').forEach((ln, i) => {
      if (ln.includes('cellPadding') || ln.includes("font: 'Sarabun'")) return;   // jsPDF = pt
      for (const m of ln.matchAll(/fontSize\s*[:=]\s*\{?\s*(\d+(?:\.\d+)?)\s*\}?/g)) {
        if (Number(m[1]) < 11) bad.push(`${rel}:${i + 1} → fontSize ${m[1]}`);
      }
      /* 🕳️ รูของด่านนี้ (QC audit 20/10): รูปที่มี quote นำ **หลุดทั้งหมด** เพราะ regex ข้างบน
         จับเฉพาะ "ตัวเลขดิบ" ⇒ เจอจริง `clamp(9px,…)` 3 จุด + `0.72em` 1 จุด (ซึ่งยังถูกคูณ
         `zoom` ที่ผู้ใช้กด A− ลงได้ถึง 0.6 = ~5px บนจอ)
         · `clamp()` — ค่า **min** คือขนาดจริงบนจอเล็ก จึงเป็นตัวที่ต้อง ≥ 11px
         · `em`/`rem` ที่ < 1 — ขนาดจริงขึ้นกับแม่ (และ zoom) พิสูจน์ไม่ได้ว่า ≥ 11px ⇒ ห้ามใช้กับฟอนต์ */
      for (const m of ln.matchAll(/fontSize\s*[:=]\s*['"`]clamp\(\s*(\d+(?:\.\d+)?)px/g)) {
        if (Number(m[1]) < 11) bad.push(`${rel}:${i + 1} → clamp() min ${m[1]}px`);
      }
      for (const m of ln.matchAll(/fontSize\s*[:=]\s*['"`](0?\.\d+)(em|rem)\b/g)) {
        bad.push(`${rel}:${i + 1} → fontSize ${m[1]}${m[2]} (พิสูจน์ไม่ได้ว่า ≥ 11px — ใช้ px/clamp แทน)`);
      }
    });
  }
  assert.deepEqual(bad, [], `\n\n❌ ฟอนต์ต่ำกว่า 11px ${bad.length} จุด\n`
    + '   ทำไมห้าม: จอหน้างานคือ TV 43" แขวนไกล — ต่ำกว่า 11px อ่านไม่ออกจริง\n'
    + '   แก้ยังไง: ยกเป็น 11 · ที่แน่นเกินให้ **เว้นป้าย/ซ่อนป้าย ไม่ใช่ลดฟอนต์** (UI-CONVENTIONS §4)\n'
    + '             ตัวที่สเกลตามจอใช้ `fs()` ที่มีพื้น `Math.max(11, …)` อยู่แล้ว\n\n'
    + bad.slice(0, 20).map(b => '   • ' + b).join('\n') + (bad.length > 20 ? `\n   …อีก ${bad.length - 20}` : '') + '\n');
});

/* ── ไฟล์ source ห้ามมีไบต์ NUL (QC audit 06/10) ───────────────────────────────────
   เคสจริง: `EventLog.jsx:149` มี `'\0__none__'` (NUL หลุดเข้ามาตอนพิมพ์ sentinel ที่ใช้ match ไม่เจอ)
   โค้ด**ทำงานถูก**ทุกอย่าง — แต่ `grep`/`ripgrep` ถือว่าไฟล์นั้นเป็น **binary** แล้ว
   **ข้ามไปเลย** ⇒ ไฟล์หายจากทุกการสแกน: ด่าน regression ข้างบนนี้ · QC agent · audit sweep
   = มีไฟล์ที่ "ไม่มีด่านไหนมองเห็น" อยู่ในรีโปโดยไม่มีใครรู้ (ตรวจเจอตอนด่านอื่นรายงานไฟล์น้อยกว่าที่ควร)
   ⇒ อันตรายกว่าบั๊กเอง เพราะมันปิดตาเครื่องมือตรวจทั้งชุด */
test('🛡️ ไฟล์ source ต้องไม่มีไบต์ NUL (ไม่งั้น grep ข้ามไฟล์ = หลุดทุกด่าน)', () => {
  const bad = [];
  for (const dir of ['src', 'scripts', 'audit', 'supabase', 'docs']) {
    let files = [];
    try { files = walk(join(ROOT, dir), ['.js', '.jsx', '.mjs', '.cjs', '.sql', '.md', '.css', '.json', '.html']); }
    catch { continue; }                       // โฟลเดอร์ไม่มีก็ข้าม
    for (const file of files) {
      const buf = readFileSync(file);
      const at = buf.indexOf(0);
      if (at >= 0) bad.push(`${relative(ROOT, file)} @ byte ${at}`);
    }
  }
  assert.deepEqual(bad, [], `\n\n❌ พบไบต์ NUL ${bad.length} ไฟล์\n`
    + '   ทำไมห้าม: grep/ripgrep ถือว่าไฟล์เป็น binary แล้วข้ามทั้งไฟล์ ⇒ ไฟล์นั้นหลุดจาก\n'
    + '             ด่าน regression · QC agent · audit sweep ทั้งหมด โดยไม่มีสัญญาณเตือนใดๆ\n'
    + '   แก้ยังไง: ลบไบต์นั้นออก — sentinel ที่อยากให้ match ไม่เจอ ใช้สตริงธรรมดาพอ (เช่น \'__none__\')\n\n'
    + bad.map(b => '   • ' + b).join('\n') + '\n');
});

/* ── ตารางที่โค้ด subscribe realtime ต้องอยู่ในทะเบียน (QC audit 06/10) ─────────────────
   subscribe ตารางที่ไม่อยู่ใน publication `supabase_realtime` = **เงียบสนิท ไม่มี error**
   จอยังอัปเดตเพราะมี poll กันเหนียว แต่ช้าได้ถึง hard floor 2 ชม. ⇒ ไม่มีใครรู้ว่าพัง
   เกิดซ้ำ 3 รอบ (19/08 `mtn_orders` · 15/09 ทั้งชุด · 06/10 อีก 4 ตาราง) เพราะลิสต์อยู่ใน
   **เอกสารที่เขียนมือ** แล้วล้าสมัย ⇒ ย้ายมาเป็นทะเบียนในโค้ด + ด่านนี้บังคับให้ตรงกัน
   เหตุผลเต็ม + SQL ตรวจของจริง → src/utils/realtimeTables.js */
test('🛡️ realtime-table-registered — ตารางที่ subscribe ต้องอยู่ใน REALTIME_TABLES', () => {
  const missing = new Map();                  // ชื่อตาราง → จุดที่เจอ
  for (const file of walk(join(ROOT, 'src'), ['.js', '.jsx'])) {
    const rel = relative(ROOT, file);
    if (rel.includes('__tests__') || rel.endsWith('realtimeTables.js')) continue;
    const code = stripComments(readFileSync(file, 'utf8'));
    code.split('\n').forEach((ln, i) => {
      const found = [];
      for (const m of ln.matchAll(/\btables:\s*\[([^\]]*)\]/g))
        for (const q of m[1].matchAll(/['"]([a-z0-9_]+)['"]/g)) found.push(q[1]);
      for (const m of ln.matchAll(/\btable:\s*['"]([a-z0-9_]+)['"]/g)) found.push(m[1]);
      for (const t of found) {
        if (REALTIME_TABLES[t]) continue;
        if (!missing.has(t)) missing.set(t, `${rel}:${i + 1}`);
      }
    });
  }
  assert.deepEqual([...missing.keys()], [],
    `\n\n❌ มี ${missing.size} ตารางที่โค้ด subscribe แต่ไม่อยู่ในทะเบียน\n`
    + '   ทำไมสำคัญ: ถ้าตารางนั้นไม่อยู่ใน publication `supabase_realtime` ของ project ที่ถูกต้อง\n'
    + '             subscription จะ **เงียบสนิท ไม่มี error** — จอช้าได้ถึง 2 ชม. โดยไม่มีใครรู้\n'
    + '   แก้ยังไง: 1) เติมชื่อตาราง + project ลง src/utils/realtimeTables.js\n'
    + '             2) เช็คว่าอยู่ใน publication แล้วจริง (SQL อยู่ในหัวไฟล์นั้น) — ไม่อยู่ให้เขียน migration\n\n'
    + [...missing].map(([t, at]) => `   • ${t}  (${at})`).join('\n') + '\n');
});

/* ── checkWrite vs checkWriteRows ใช้ให้ถูกตัว (QC audit 06/10) ────────────────────
   สองด่านคู่กัน เพราะเป็นความเข้าใจผิดคนละทาง:
   (ก) ต่อ `.select()` ไว้แล้ว **แต่ส่งเข้า `checkWrite`** ซึ่งไม่เคยอ่าน `data`
       ⇒ `.select('id')` นั้นเสียเปล่า และ **ผู้เขียนคิดว่าตัวเองกันบั๊กนี้แล้ว** (เจอ 7 จุด 06/10)
       อันตรายกว่าไม่เช็คเลย เพราะไม่มีใครกลับมาดูอีก
   (ข) เรียก `checkWriteRows` **โดยไม่ต่อ `.select()`** ⇒ supabase คืน `data: null` นับแถวไม่ได้
       helper จะถอยไปเช็คแค่ error (ไม่ทำปุ่มพัง) แต่เจตนา "นับแถว" หายไปเงียบๆ
   เหตุผลเต็ม → src/utils/dbWrite.js */
function checkWriteCalls() {
  const out = [];                                   // { file, line, fn, arg }
  for (const file of walk(join(ROOT, 'src'), ['.js', '.jsx'])) {
    const rel = relative(ROOT, file);
    if (rel.includes('__tests__') || rel.endsWith('utils/dbWrite.js')) continue;
    const code = stripComments(readFileSync(file, 'utf8'));
    for (const fn of ['checkWriteRows(', 'checkWrite(']) {
      let i = 0;
      while ((i = code.indexOf(fn, i)) >= 0) {
        // `checkWrite(` เป็นสตริงย่อยของ `checkWriteRows(` ไม่ได้ (มี Rows คั่น) — ไม่ต้องกันซ้ำ
        let j = i + fn.length, depth = 1;
        while (j < code.length && depth > 0) { const c = code[j]; if (c === '(') depth++; else if (c === ')') depth--; j++; }
        out.push({ file: rel, line: code.slice(0, i).split('\n').length, fn: fn.slice(0, -1), arg: code.slice(i, j) });
        i = j;
      }
    }
  }
  return out;
}

test('🛡️ checkwrite-rows-not-plain — ต่อ .select() แล้วต้องใช้ checkWriteRows', () => {
  const bad = checkWriteCalls()
    .filter(c => c.fn === 'checkWrite' && /\.(update|delete|upsert)\(/.test(c.arg) && /\.select\(/.test(c.arg))
    .map(c => `${c.file}:${c.line}`);
  assert.deepEqual(bad, [], `\n\n❌ ${bad.length} จุดต่อ .select() ไว้แต่ส่งเข้า checkWrite\n`
    + '   ทำไมผิด: checkWrite อ่านแค่ `error` ไม่เคยอ่าน `data` ⇒ `.select()` ที่ต่อไว้เสียเปล่า\n'
    + '             RLS ที่ปฏิเสธ UPDATE/DELETE คืน "0 แถว ไม่มี error" ⇒ toast เขียวทั้งที่ไม่ได้บันทึก\n'
    + '   แก้ยังไง: เปลี่ยนเป็น checkWriteRows(...) (import จาก utils/dbWrite)\n\n'
    + bad.map(b => '   • ' + b).join('\n') + '\n');
});

test('🛡️ checkwriterows-needs-select — checkWriteRows ต้องต่อ .select()', () => {
  const bad = checkWriteCalls()
    /* ⚠️ ตรวจได้เฉพาะตอนที่คิวรีเขียนเป็น chain อยู่ในวงเล็บเดียวกัน (`.from(` อยู่ใน arg)
       — ที่เก็บผลใส่ตัวแปรก่อนแล้วส่ง `checkWriteRows(res, …)` **มองไม่เห็น** `.select()`
       จะฟ้องก็เป็น false positive (เจอทันทีที่เขียนด่านนี้: CapacityBoard ต่อ .select('key') ไว้แล้ว)
       ⇒ ข้ามรูปนั้นไป ดีกว่ามีด่านที่คนอยากปิด (กติกาข้อ 1 ของไฟล์นี้) */
    .filter(c => c.fn === 'checkWriteRows' && /\.from\(/.test(c.arg)
      && !/\.select\(/.test(c.arg) && !/\.(single|maybeSingle)\(/.test(c.arg))
    .map(c => `${c.file}:${c.line}`);
  assert.deepEqual(bad, [], `\n\n❌ ${bad.length} จุดเรียก checkWriteRows โดยไม่ต่อ .select()\n`
    + '   ทำไมผิด: ไม่ต่อ .select() → supabase คืน `data: null` → นับแถวไม่ได้\n'
    + '             helper จะถอยไปเช็คแค่ error (ปุ่มไม่พัง) แต่เจตนา "นับแถว" หายไปเงียบๆ\n'
    + '   แก้ยังไง: ต่อ `.select(\'id\')` ท้ายคิวรี · ถ้าไม่ต้องนับแถวจริงให้ใช้ checkWrite ตามเดิม\n\n'
    + bad.map(b => '   • ' + b).join('\n') + '\n');
});

/* ── <Tooltip> ของ Recharts ต้องมีธีม (QC audit 06/10) ────────────────────────────
   Recharts default = พื้นขาว ตัวหนังสือดำ ⇒ บนการ์ดธีมมืดอ่านไม่ออก
   (เคสจริง 30/09: user ส่งภาพ "พื้นเขียวเข้ม text ดำ" จากบอร์ด KPI — แก้ด้วย fill={CELL_BAR_FILL})
   ✅ วัด 06/10: **ตอนนี้ 0 จุด** ทุกตัวมี `tooltipProps` / `{...chartTip}` / `contentStyle` /
      `content={<CustomTip/>}` อยู่แล้ว — ด่านนี้เป็นตัว "ล็อกสถานะที่ดีไว้" ไม่ใช่ตัวแก้บั๊กค้าง
   ⚠️ ต้องอ่านข้ามบรรทัด (prop อยู่หลายบรรทัด) จึงเป็นเทสแยก ไม่ใช่กฎใน RULES */
test('🛡️ tooltip-needs-theme — <Tooltip> ต้องมี tooltipProps/contentStyle/content', () => {
  const bad = [];
  for (const file of walk(join(ROOT, 'src'), ['.jsx'])) {
    const code = stripComments(readFileSync(file, 'utf8'));
    const rel = relative(ROOT, file);
    let i = 0;
    while ((i = code.indexOf('<Tooltip', i)) >= 0) {
      let j = i, depth = 0, end = -1;
      while (j < code.length) {                    // ปลายแท็ก = '>' ที่อยู่นอก {}
        const c = code[j];
        if (c === '{') depth++;
        else if (c === '}') depth--;
        else if (depth === 0 && c === '>') { end = j; break; }
        j++;
      }
      if (end < 0) break;
      const tag = code.slice(i, end + 1);
      if (!/tooltipProps|chartTip|contentStyle|content=/.test(tag))
        bad.push(`${rel}:${code.slice(0, i).split('\n').length}`);
      i = end + 1;
    }
  }
  assert.deepEqual(bad, [], `\n\n❌ ${bad.length} <Tooltip> ไม่มีธีม\n`
    + '   ทำไมผิด: default ของ Recharts = พื้นขาว ตัวหนังสือดำ → บนการ์ดธีมมืดอ่านไม่ออก\n'
    + '   แก้ยังไง: <Tooltip {...tooltipProps(fs)}> (จาก src/utils/chartAxis.js)\n'
    + '             หรือ content={<CustomTip/>} ที่วาดกล่องเองตามธีม\n\n'
    + bad.map(b => '   • ' + b).join('\n') + '\n');
});

/* ── ช่องรับรูปทุกช่องต้องผ่าน acceptImageFile (QC audit 06/10) ──────────────────────
   `docs/modules/storage-images.md` เขียนกฎไว้ว่า "ทุกจุดรับรูปต้องผ่าน toDecodableImage"
   แต่ **ไม่มีด่าน** ⇒ วัด 06/10: มี 12 ช่อง `accept="image/*"` ใน 9 ไฟล์ที่รับไฟล์ตรงๆ
   · รูปจาก iPhone (HEIC) ใช้ไม่ได้ — บางจุดพังตอนกดบันทึก บางจุดอัปไฟล์ดิบขึ้นไปเงียบๆ
   · เลือกไฟล์ที่ไม่ใช่รูป (PDF/Excel) ไม่มีใครเตือน (ขัดคำสั่ง user 11/09 ตรงๆ)
   ✅ ผ่านได้ 3 ทาง: `acceptImageFile` · `<ImageCropModal>` (มี toDecodableImage ในตัว)
      · เรียก `toDecodableImage` เองในไฟล์นั้น
   เหตุผลเต็ม → src/utils/acceptImageFile.js */
test('🛡️ image-input-via-accept-helper — <input accept="image/*"> ต้องผ่านด่านรับรูป', () => {
  const bad = [];
  for (const file of walk(join(ROOT, 'src'), ['.jsx'])) {
    const raw = readFileSync(file, 'utf8');
    if (!/accept=["']image\//.test(raw)) continue;
    if (/acceptImageFile|ImageCropModal|toDecodableImage/.test(raw)) continue;
    const rel = relative(ROOT, file);
    raw.split('\n').forEach((ln, i) => {
      if (/accept=["']image\//.test(ln)) bad.push(`${rel}:${i + 1}`);
    });
  }
  assert.deepEqual(bad, [], `\n\n❌ ${bad.length} ช่องรับรูปไม่ผ่านด่าน\n`
    + '   ทำไมต้องผ่าน: HEIC จาก iPhone เบราว์เซอร์ Android/Chrome decode ไม่ได้\n'
    + '                 ⇒ พังตอนกดบันทึก หรืออัปไฟล์ดิบขึ้นไปแล้วทุกคนเห็นรูปเสีย\n'
    + '                 + ไฟล์ที่ไม่ใช่รูปต้องขึ้น toast บอกเหตุผล ห้ามเงียบ (คำสั่ง user 11/09)\n'
    + '   แก้ยังไง: const f = await acceptImageFile(e.target.files?.[0]); if (!f) return;\n'
    + '             (src/utils/acceptImageFile.js — ใช้ค่าที่คืนมา ไม่ใช่ไฟล์เดิม)\n\n'
    + bad.map(b => '   • ' + b).join('\n') + '\n');
});

/* ── 🛑 ทะเบียนลักษณะปัญหา MO: กลุ่มต้องอยู่ในลูกโซ่ cascade + ห้ามใช้ป้าย "อื่นๆ" เป็นถังสังเคราะห์
   (06/10/2026 · user: "ตรงนี้มั่วด้วย ระบบ dropdown" → "มั่ว")
   2 บั๊กที่เจอพร้อมกันในหน้าเดียว:
     1. `NAME_CASCADE` ไม่มี `group_name` ⇒ เปลี่ยนชื่อกลุ่มในทะเบียน ใบเก่าค้างชื่อเดิม
        พาเรโตแตก 2 แท่งเงียบๆ (วัดจริง: 2 ใบค้างกลุ่ม "MTN ระบบ…" ที่ไม่มีในทะเบียนแล้ว)
     2. ถังสังเคราะห์ของแถวที่ไม่มีกลุ่ม ถูกตั้งชื่อว่า 'อื่นๆ' **ชนกับแถวจริงชื่อ "อื่นๆ"**
        ⇒ dropdown เดียวมีป้ายซ้ำ 2 ความหมาย · และค่านั้นถูกเขียนลงใบเป็นกลุ่มปลอม          */
test('🛡️ /mtn-repair: NAME_CASCADE ต้องครอบ group_name (ไม่งั้นเปลี่ยนชื่อกลุ่มแล้วพาเรโตแตกเงียบ)', () => {
  const code = readFileSync(join(ROOT, 'src/pages/MtnRepair.jsx'), 'utf8');
  const block = code.match(/const NAME_CASCADE\s*=\s*\{[\s\S]*?\n\};/);
  assert.ok(block, '\n\n❌ หา NAME_CASCADE ใน MtnRepair.jsx ไม่เจอ — ย้ายแล้วต้องอัปเดตด่านนี้ด้วย\n');
  assert.ok(/mtn_problem_types:\s*\{[^}]*group_name:\s*'problem_group'/.test(block[0]),
    '\n\n❌ NAME_CASCADE.mtn_problem_types ไม่มี `group_name: \'problem_group\'`\n'
    + '   ทำไมสำคัญ: ใบซ่อมเก็บ `problem_group` เป็น **สำเนาข้อความ** ไม่ผูก FK\n'
    + '              ไม่มีในลูกโซ่ = เปลี่ยนชื่อกลุ่มในทะเบียนแล้วใบเก่าค้างชื่อเดิม\n'
    + '              ⇒ พาเรโตกลุ่มแตกเป็น 2 แท่ง และไม่มีใครรู้ (ไม่มี error ไม่มี toast)\n'
    + '   แก้ยังไง: เติม group_name: \'problem_group\' ใน NAME_CASCADE (MtnRepair.jsx)\n');
});

test('🛡️ /mtn-repair: ถังสังเคราะห์ของแถวไม่มีกลุ่ม ห้ามตั้งชื่อ "อื่นๆ" (ชนกับแถวจริงในทะเบียน)', () => {
  const code = stripComments(readFileSync(join(ROOT, 'src/pages/MtnRepair.jsx'), 'utf8'));
  assert.ok(!/NO_GROUP\s*=\s*['"]อื่น\s*ๆ?['"]/.test(code),
    '\n\n❌ MtnRepair.jsx ตั้ง NO_GROUP = \'อื่นๆ\' อีกแล้ว\n'
    + '   ทำไมห้าม: ทะเบียน mtn_problem_types มีแถวจริงชื่อ "อื่นๆ" (221 ใบใช้อยู่)\n'
    + '              ป้ายเดียวกัน 2 ความหมายใน dropdown เดียว = คนแจ้งเลือกแล้วไม่รู้ว่าได้อะไร\n'
    + '   แก้ยังไง: ใช้ UNGROUPED_LABEL จาก src/utils/unclassified.js (= "ยังไม่จัดกลุ่ม")\n'
    + '              และกลุ่มจริงของอาการที่ระบุไม่ได้ = OTHER_GROUP ("อื่นๆ / ยังระบุไม่ได้")\n');
  /* ป้ายถังสังเคราะห์ห้ามหลุดลง DB — ต้องผ่าน groupForDb() ก่อนใส่ payload */
  assert.ok(/groupForDb\s*\(/.test(code) && /problem_group:\s*groupForDb\(/.test(code),
    '\n\n❌ payload ของใบแจ้งซ่อมไม่ได้กรอง problem_group ผ่าน groupForDb()\n'
    + '   ทำไมสำคัญ: ช่องเลือกกลุ่มถือป้าย "ยังไม่จัดกลุ่ม" ได้ (เป็นป้ายของจอ ไม่ใช่ taxonomy)\n'
    + '              เขียนลงใบ = ปลอมกลุ่มให้พาเรโต · ผิดกฎชั้น 1 "ห้ามเขียนทับค่าที่ระบบรู้อยู่แล้ว"\n'
    + '   แก้ยังไง: problem_group: groupForDb(f.problem_group) (คืนค่าว่างเมื่อเป็นป้ายสังเคราะห์)\n');
});

/* ── ใบเบิกวัตถุดิบ: ตัดสต็อกครั้งเดียวต่อใบ ไม่ว่ากด "จ่าย" ก่อนหรือ "ปิดล็อต" ก่อน (06/10) ──
   เดิม "จ่ายวัตถุดิบ" เปลี่ยนแค่สถานะ แล้วปิดล็อตตัดเฉพาะใบ pending ⇒ จ่ายก่อนปิด = วัตถุดิบไม่เคยลด */
test('🛡️ /heijunka: "จ่ายวัตถุดิบ" ต้องเขียน consume · ปิดล็อตต้อง claim ใบ pending ก่อนตัด', () => {
  const code = stripComments(readFileSync(join(ROOT, 'src/pages/HeijunkaKanban.jsx'), 'utf8'));
  const issue = code.slice(code.indexOf('const issueRaw'), code.indexOf('const issueRaw') + 3000);
  assert.ok(/from\('line_stock_transactions'\)\.insert/.test(issue) && /type: 'consume'/.test(issue),
    '\n\n❌ issueRaw ไม่ตัดสต็อกวัตถุดิบแล้ว — จ่ายก่อนปิดล็อต = สต็อกวัตถุดิบไม่ลด (ปิดล็อตตัดเฉพาะใบ pending)\n');
  assert.ok(/from\('raw_withdrawal_requests'\)\s*\.update\(\{ status: 'issued' \}\)\.eq\('lot_request_id', lot\.id\)\.eq\('status', 'pending'\)\s*\.select\(/.test(code),
    '\n\n❌ ปิดล็อตต้อง claim ใบเบิก pending→issued แล้วตัดเฉพาะแถวที่ claim ได้ (กันตัดซ้ำกับ issueRaw)\n');
});

/* ── 🔴 ปุ่ม "เปิดใบ BOM ของพาร์ทนี้" ห้ามผูกกับ `fromOtherSheet` (2026-10-06) ─────────
   บั๊กจริง: user สั่งทำปุ่มกระโดดเข้าใบลูก แล้วทดสอบใบจริง 10105772 → 20070036 **กดไม่ได้เลย**
   เพราะเงื่อนไขเดิมเป็น `fromOtherSheet` = "ลูกถูกอ่านมาจากใบอื่น" ⇒ ใบที่ก๊อปลูกมาใส่เอง
   (`sheetFor` คืนใบเดิม) ปุ่มหายหมด — ซึ่งเป็น**เคสที่ต้องกดเข้าไปเทียบที่สุด**
   เพราะของชิ้นเดียวถูกนิยามไว้ 2 ใบ และวัดจริงแล้วว่า**ไม่ตรงกัน**
   วัดทั้งฐาน 06/10: นิยาม 2 ที่ = 94 บรรทัด / 47 MAT · ยืมใบจริง = 9 บรรทัด / 5 ใบ (3%)
   ⇒ คลิกได้/ไม่ได้ ตัดสินด้วย `ownSheet` (มีใบของตัวเองที่ไม่ว่าง) เท่านั้น            */
test('🛡️ BOM: ปุ่มเปิดใบลูกต้องตัดสินด้วย ownSheet ไม่ใช่ fromOtherSheet', () => {
  const view = stripComments(readFileSync(join(ROOT, 'src/components/BomTreeView.jsx'), 'utf8'));
  assert.ok(!/fromOtherSheet\s*&&\s*onOpenSheet/.test(view),
    '\n\n❌ BomTreeView ผูกปุ่มเปิดใบลูกไว้กับ `fromOtherSheet`\n'
    + '   ทำไมผิด: `fromOtherSheet` = ลูกถูกอ่านมาจากใบอื่น ⇒ ใบที่ก๊อปลูกมาใส่เองจะไม่มีปุ่ม\n'
    + '            ทั้งที่นั่นคือเคสที่ต้องกดเข้าไปเทียบที่สุด (นิยาม 2 ใบ · วัดจริง 94 บรรทัด/47 MAT)\n'
    + '   แก้ยังไง: `r.ownSheet && onOpenSheet` (ดู explodeBom ใน src/utils/bomTree.js)\n');
  assert.ok(/r\.ownSheet\s*&&\s*onOpenSheet/.test(view),
    '\n\n❌ BomTreeView ไม่มีปุ่มเปิดใบลูกที่ตัดสินด้วย `ownSheet` แล้ว — ถอดออกไปทำไม?\n'
    + '   user สั่งไว้ 06/10 ("กดคลิกดู component เบอร์ 200 ที่ตาราง แล้วแตกย่อยลงไป")\n');
  assert.ok(/sheetConflict/.test(view),
    '\n\n❌ จอไม่เตือนเคส "นิยามไว้ 2 ใบ" (`sheetConflict`) แล้ว\n'
    + '   กฎความซื่อสัตย์ของจอ: ข้อมูลขัดกัน **ต้องเขียนบนจอ ห้ามเงียบ** (CLAUDE.md §OBEYA)\n');
});

/* ── 🔴 กดเลข MAT ในต้นไม้ BOM ต้องค้นจาก `products` ไม่ใช่ `items` (2026-10-06) ───────
   บั๊กจริงที่หลุดไปพร้อมฟีเจอร์: `openSheetOfMat` ค้นจาก `items` (= bom_items ของใบที่เปิดอยู่)
   แล้วเจอ "บรรทัด BOM" ที่มี mat ตรงกัน → `setSelProduct(<bom row>)`
   ⇒ `selProduct.id` กลายเป็น id ของบรรทัด BOM ⇒ โหลดใบด้วย product_id ที่ไม่มีจริง = **ใบเปล่า**
   เงียบสนิท: ไม่มี error ไม่มี toast ไม่มีอะไรบนจอบอกว่ากดไปเจอใบผิด
   ⇒ `selProduct` ต้องมาจาก `products` (= dr_products) เท่านั้น                        */
test('🛡️ /products BOM: openSheetOfMat ต้องค้นจาก products (dr_products) ไม่ใช่ items (bom_items)', () => {
  const code = stripComments(readFileSync(join(ROOT, 'src/pages/ProductMaster.jsx'), 'utf8'));
  const i = code.indexOf('const openSheetOfMat');
  assert.ok(i > 0, '\n\n❌ หา openSheetOfMat ใน ProductMaster.jsx ไม่เจอ — เปลี่ยนชื่อแล้วต้องอัปเดตด่านนี้\n');
  const fn = code.slice(i, i + 900);
  assert.ok(!/items\.find\s*\(/.test(fn),
    '\n\n❌ openSheetOfMat ค้นใบจาก `items` (= bom_items ของใบที่เปิดอยู่)\n'
    + '   ทำไมผิด: เจอ "บรรทัด BOM" แล้วเอา id ของบรรทัดไปเป็น selProduct.id\n'
    + '            ⇒ โหลดใบด้วย product_id ที่ไม่มีจริง = เปิดมาเจอใบเปล่า **เงียบสนิท**\n'
    + '   แก้ยังไง: `products.find(p => upMat(p.mat_no) === k)` (products = dr_products)\n');
  assert.ok(/products\.find\s*\(/.test(fn),
    '\n\n❌ openSheetOfMat ไม่ได้ค้นจาก `products` — ดูเหตุผลด้านบน\n');
});

/* ── ใบขั้นงาน (OP) ห้ามถูกเทียบชุดลูกกับใบพาร์ท (2026-10-06) ──────────────────────────
   ใบ OP ตอบ "ขั้นนี้กินอะไร" (ขั้นเชื่อมนัท M6 → นัท 30044771)
   ใบพาร์ท ตอบ "พาร์ทนี้ประกอบจากอะไร" (คอยล์ 50027969) — **ถูกทั้งคู่ ไม่ใช่ขัดกัน**
   เทียบรวม = เตือนผิด 5 คู่จาก 19 (26%) · สัญญาณหลอกทำให้คนเลิกเชื่อคำเตือนทั้งจอ        */
test('🛡️ /products BOM: ต้องส่ง isOpSheet ให้ BomTreeView (ไม่งั้นเตือนผิดที่ใบขั้นงาน)', () => {
  const page = stripComments(readFileSync(join(ROOT, 'src/pages/ProductMaster.jsx'), 'utf8'));
  assert.ok(/isOpSheet=\{/.test(page),
    '\n\n❌ ProductMaster ไม่ส่ง `isOpSheet` ให้ BomTreeView\n'
    + '   ผล: ใบขั้นงานจะขึ้น "⚠️ ต่างกัน N รายการ" ทั้งที่ 2 ใบตอบคนละคำถาม (เตือนผิด 5 คู่จาก 19)\n');
  const view = stripComments(readFileSync(join(ROOT, 'src/components/BomTreeView.jsx'), 'utf8'));
  assert.ok(/isOpSheet/.test(view),
    '\n\n❌ BomTreeView ไม่รับ/ไม่ใช้ `isOpSheet` แล้ว — ถอดออกแล้วใบขั้นงานจะถูกเทียบผิด\n');
});

/* ── การ์ดบนบอร์ด NM ต้องมี "ตัวเลข" ไม่ใช่แค่สี (06/10/2026 · feedback user "design obeya ยังดีกว่า") ──
   วัดจริงก่อนแก้: บอร์ด 737D MLM มีข้อมูลนับได้ทั้ง 21 แผง แต่ไม่โชว์ตัวเลขสักใบ
   ⇒ ตัวเลขทุกตัวต้องมาจาก panelMetric() (pure · มีเทส) ห้ามนับเองในหน้า */
test('🛡️ /nm-board: ตัวเลขบนการ์ดต้องมาจาก panelMetric() ห้ามนับ rows เองในหน้า', () => {
  const code = stripComments(readFileSync(join(ROOT, 'src/pages/NewModelBoard.jsx'), 'utf8'));
  assert.ok(/panelMetric\s*\(/.test(code),
    '\n\n❌ NewModelBoard.jsx ไม่ได้ใช้ panelMetric() — การ์ดกลับไปมีแต่ชื่อกับสี\n'
    + '   ทำไมต้องมี: การ์ด OBEYA ตอบ 5 คำถาม (เท่าไหร่/เทียบแล้วไง/มาจากไหน/คืบไปแค่ไหน/กดอะไรต่อ)\n'
    + '              การ์ดที่มีแต่สี ตอบได้ข้อเดียว\n'
    + '   แก้ยังไง: `<MetricBlock panel={p} />` · สูตรอยู่ที่ src/utils/nmPanelMetric.js\n');
  /* กันการนับเองในหน้า — เช่น rows.filter(...).length ของแผง */
  assert.ok(!/panel\.rows\s*\.\s*filter\(/.test(code) && !/p\.rows\s*\.\s*filter\(/.test(code),
    '\n\n❌ NewModelBoard.jsx นับแถวของแผงเองในหน้า\n'
    + '   ทำไมห้าม: กติกา "แถวที่ยังไม่ประเมินห้ามนับเป็นผ่าน" + "ตัวหารต้องเป็นแถวที่ประเมินแล้ว"\n'
    + '              อยู่ใน panelMetric() ที่เดียว · นับเองในหน้า = กติกาหลุดทีละจุดโดยไม่มีใครรู้\n');
});

/* ── รับของซื้อแบบรวมหลายใบ: ledger ล้มต้องคืนใบที่ claim ไป (06/10 · ช่องโหว่สโตร์ข้อ 4) ──
   เดิมแค่ toast "ไปบันทึกเองที่ Line Stock" ⇒ ใบค้าง "รับเข้าแล้ว" ทั้งที่สต็อกไม่ขึ้น กดใหม่ไม่ได้ */
test('🛡️ PurchaseBulkModal: บันทึกรับเข้าคลังล้ม/เลื่อนก้อนหลังล้ม ต้องคืนสถานะใบที่ขยับไปแล้ว', () => {
  const code = stripComments(readFileSync(join(ROOT, 'src/components/PurchaseBulkModal.jsx'), 'utf8'));
  assert.ok(/if\s*\(\s*eLedger\s*\)\s*\{\s*const\s*\{[^}]*\}\s*=\s*await\s+revertClaimed\(/.test(code),
    '\n\n❌ PurchaseBulkModal ไม่คืนสถานะใบเมื่อเขียน line_stock_transactions ล้ม (กฎเขียน DB ข้อ 6)\n');
  assert.ok(/if\s*\(\s*error\s*\)\s*\{\s*const\s*\{[^}]*\}\s*=\s*await\s+revertClaimed\(/.test(code),
    '\n\n❌ PurchaseBulkModal ไม่คืนก้อนที่ claim ไปแล้วเมื่อก้อนถัดไปล้ม\n');
});
/* ═══ กฎเชิงความสัมพันธ์ — คีย์ของ upsert ต้องเป็น "คอลัมน์ล้วน" (2026-10-06 · เกิดเป็นครั้งที่ 3) ═══

   PostgREST ส่งได้แค่ `on_conflict=<ชื่อคอลัมน์>` ⇒ Postgres ต้อง **infer** index จากรายชื่อนั้น
   index ที่เป็น **expression** (`coalesce(x,'')`, `lower(x)`) หรือ **partial** (`where …`)
   อ้างแบบนี้ไม่ได้ ⇒ 42P10 `there is no unique or exclusion constraint matching the ON CONFLICT
   specification` ⇒ **ทั้งก้อนไม่ถูกเขียนเลย** (supabase-js ไม่ throw — เห็นก็ต่อเมื่อมี checkWrite)

   เกิดจริงมาแล้ว 3 รอบ:
     • 09/09 `customer_pull_signals` — index ใช้ coalesce(supplier_ref, customer_part_no) ⇒ แถวหลักฐานหายทั้งชุด
     • 02–05/10 `monitor_board_parts` — index เป็น partial (`where mat_no is not null and is_active`)
     • 06/10 `monitoring_shipments` — index ใช้ coalesce(sheet,'') ⇒ ประวัติการส่ง 804 แถวไม่ลง
   ทางแก้มาตรฐานของโปรเจคนี้: **คอลัมน์ในคีย์ทำเป็น NOT NULL DEFAULT '' แล้ว index ด้วยคอลัมน์ล้วน**

   ด่านนี้ไม่ได้ห้าม expression/partial index (มีที่ใช้ถูกต้องเยอะ) — ห้ามเฉพาะ **การจับคู่**:
   ตารางที่ client upsert ด้วย onConflict ชุดหนึ่ง แต่ในไฟล์ migration มีแค่ index ที่อ้างชุดนั้นไม่ได้ */
const SQL_KEYS_CACHE = (() => {
  const dir = join(ROOT, 'supabase/migrations');
  const plain = new Map(), bad = new Map();        // table → Set<"a,b,c">
  const add = (map, t, cols) => { if (!map.has(t)) map.set(t, new Set()); map.get(t).add(cols); };
  const norm = (list) => {
    const parts = []; let depth = 0, cur = '';
    for (const ch of list) {
      if (ch === '(') depth++; if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
    }
    parts.push(cur);
    return parts.map(s => s.trim().toLowerCase().replace(/\s+(asc|desc)$/, ''));
  };
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.sql')) continue;
    const sql = readFileSync(join(dir, f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
    const re = /create\s+unique\s+index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?[\w.]+\s+on\s+(?:\w+\.)?(\w+)\s*\(([^;]*?)\)\s*(where[^;]*)?;/gi;
    for (const m of sql.matchAll(re)) {
      const [, table, colList, where] = m;
      const cols = norm(colList);
      const key = cols.join(',');
      const inferable = !where && !cols.some(c => c.includes('('));
      /* คีย์ "ฐาน" ของ index ที่อ้างไม่ได้ = ชื่อคอลัมน์ที่ห่อด้วยฟังก์ชัน (coalesce(sheet,'') → sheet) */
      add(inferable ? plain : bad, table,
        inferable ? key : cols.map(c => (c.match(/\(\s*(\w+)/) || [, c])[1]).join(','));
    }
  }
  return { plain, bad };
})();

test('🛡️ upsert-key-must-be-plain-columns — onConflict ต้องตรงกับ unique index ที่เป็นคอลัมน์ล้วน', () => {
  const hits = [];
  for (const file of walk(join(ROOT, 'src'), ['.jsx', '.js'])) {
    const code = stripComments(readFileSync(file, 'utf8'));
    for (const m of code.matchAll(/from\(\s*['"`](\w+)['"`]\s*\)([\s\S]{0,700}?)onConflict:\s*['"`]([^'"`]+)['"`]/g)) {
      const [, table, between, conflict] = m;
      if (!between.includes('.upsert(') || /from\(\s*['"`]/.test(between)) continue;   // คนละคำสั่ง
      const key = conflict.split(',').map(s => s.trim().toLowerCase()).join(',');
      if (SQL_KEYS_CACHE.plain.get(table)?.has(key)) continue;          // มี index คอลัมน์ล้วนตรงชุด = ผ่าน
      if (!SQL_KEYS_CACHE.bad.get(table)?.has(key)) continue;           // ไม่รู้จัก = ไม่เดา (ด่านนี้ไม่ตะโกนมั่ว)
      hits.push(`${relative(ROOT, file)} → from('${table}') onConflict '${conflict}'`);
    }
  }
  assert.deepEqual(hits, [],
    '\n\n❌ upsert ด้านล่างอ้างคีย์ที่ตรงกับ **expression/partial unique index** เท่านั้น\n'
    + '   PostgREST ส่งได้แค่ชื่อคอลัมน์ ⇒ Postgres infer index ไม่เจอ ⇒ 42P10\n'
    + '   "there is no unique or exclusion constraint matching the ON CONFLICT specification"\n'
    + '   ⇒ **ทั้งก้อนไม่ถูกเขียนเลย** (supabase-js ไม่ throw — เงียบถ้าไม่มี checkWrite)\n'
    + '   เคยเกิดจริง 3 รอบ: customer_pull_signals 09/09 · monitor_board_parts 02–05/10 ·\n'
    + '   monitoring_shipments 06/10 (ประวัติการส่ง 804 แถวไม่ลง ทั้งที่จอขึ้นสรุปว่าจะลง)\n'
    + '   แก้ยังไง: ทำคอลัมน์ในคีย์เป็น NOT NULL DEFAULT \'\' แล้วสร้าง unique index **คอลัมน์ล้วน**\n'
    + '   (เขียน migration ไว้ใน supabase/migrations/ ด้วย ไม่งั้นด่านนี้ยังไม่เห็นว่ามีคีย์ใหม่แล้ว)\n'
    + '   ⚠️ ห้ามแก้ด้วย coalesce() ใน index — นั่นคือสิ่งที่พากลับมา 42P10 ทุกครั้ง\n\n'
    + hits.map(h => '   • ' + h).join('\n') + '\n');
});


/* ── ฝั่งไลน์ยกเลิก/รับใบ WIP ต้องล็อกสถานะต้นทาง + นับแถว (06/10 · ช่องโหว่สโตร์ข้อ 8) ── */
test('🛡️ LinePartCallPanel: ยกเลิกได้แค่ใบ hold · รับได้แค่ใบ delivered (CAS + .select)', () => {
  const code = stripComments(readFileSync(join(ROOT, 'src/components/LinePartCallPanel.jsx'), 'utf8'));
  assert.ok(/\.update\(\{\s*status:\s*'cancelled'\s*\}\)\.eq\('id',\s*r\.id\)\.eq\('status',\s*'hold'\)\.select\(/.test(code),
    '\n\n❌ ปุ่ม "ไม่ใช้แล้ว" ยกเลิกใบได้ทุกสถานะ — จอค้างแล้วยกเลิกใบที่สโตร์ตัดสต็อกไปแล้วได้\n');
  assert.ok(!/neq\('status',\s*'received'\)/.test(code) && /\.eq\('status',\s*'delivered'\)\.select\(/.test(code),
    '\n\n❌ ปุ่ม "รับ" ต้อง .eq(status, delivered) — .neq(received) ชุบชีวิตใบที่ถูกยกเลิก/ปิดลูปใบที่สต็อกยังไม่ถูกตัด\n');
});

/* ── 📞 เรียกช่าง: ทีมที่ "คนกดเลือกเอง" ต้องชนะการเดา และต้องโชว์บนจอห้องช่าง
   (06/10/2026 · ทีม MTN: *"เราจะไม่รู้ว่า PD เรียกใคร … จะรู้ได้ยังไงว่าเค้าเรียกเรา"*)
   เกิดจริง 06/10 15:33 — ทดสอบเรียกทีม JIG แล้วจอ Andon ขึ้นแค่ "📞 เรียกช่าง" เฉยๆ
   เพราะ `teamOfDt()` เดาจากเลขเครื่อง/ใบ MO เท่านั้น และแถวนั้น `machine_no` ว่าง ⇒ คืน null
   ทั้งที่ `downtime_logs.call_mtn_team` เก็บ 'jig_maintenance' ไว้ตั้งแต่ตอนกดแล้ว            */
test('🛡️ Andon/ไซเรน: ต้องดึง call_mtn_team มาด้วย (ไม่งั้นจอบอกไม่ได้ว่าเรียกทีมไหน)', () => {
  for (const f of ['src/components/MtnAndonBoard.jsx', 'src/components/DowntimeSiren.jsx']) {
    const code = readFileSync(join(ROOT, f), 'utf8');
    assert.ok(/\.select\([^)]*call_mtn_team/s.test(code),
      `\n\n❌ ${f} ไม่ได้ select 'call_mtn_team'\n`
      + '   ทำไมสำคัญ: เป็นช่องเดียวที่บอกว่า "ฝ่ายผลิตกดเรียกทีมไหน"\n'
      + '              ไม่ดึงมา = จอห้องช่างขึ้น "📞 เรียกช่าง" เหมือนกันหมด แยกไม่ออกว่าของใคร\n'
      + '              และไซเรนดังทุกห้องทุกใบ (ห้อง DIE ได้ยินงาน JIG)\n');
  }
});

test('🛡️ Andon: call_mtn_team (ของจริง) ต้องชนะการเดาจากชนิดอุปกรณ์', () => {
  const code = stripComments(readFileSync(join(ROOT, 'src/components/MtnAndonBoard.jsx'), 'utf8'));
  const fn = code.match(/const teamOfDt\s*=\s*useCallback\([\s\S]*?\}, \[[^\]]*\]\);/);
  assert.ok(fn, '\n\n❌ หา teamOfDt ใน MtnAndonBoard.jsx ไม่เจอ — ย้ายแล้วต้องอัปเดตด่านนี้\n');
  const body = fn[0];
  const iDeclared = body.indexOf('call_mtn_team');
  const iGuess = body.indexOf('teamForEquipmentKind');
  assert.ok(iDeclared !== -1 && (iGuess === -1 || iDeclared < iGuess),
    '\n\n❌ teamOfDt อ่าน call_mtn_team ทีหลัง (หรือไม่อ่านเลย)\n'
    + '   กฎ (utils/mtnTeams.js หัวไฟล์): ชนิดอุปกรณ์เป็นแค่ "การเดา" —\n'
    + '        ตัวตัดสินจริงคือ mtn_orders.mtn_dept และ downtime_logs.call_mtn_team\n'
    + '   ของจริงต้องมาก่อนการเดาเสมอ · และห้าม return null ทิ้งตั้งแต่ไม่มีเลขเครื่อง\n'
    + '   (ใบที่ไม่ระบุเครื่องแต่ระบุทีมไว้ จะกลายเป็น "ไม่รู้ทีม" ทั้งที่คนกดระบุชัดเจน)\n');
});

/* ── คิว rack / บรรจุภัณฑ์ ห้ามโหลด "ล่าสุด N ใบ ไม่กรองสถานะ" (06/10 · ช่องโหว่สโตร์ข้อ 7) ── */
test('🛡️ rack_requests / packaging_withdrawal_requests: คิวต้องโหลดใบค้างครบผ่าน openPlusHistory', () => {
  for (const f of ['src/pages/HeijunkaKanban.jsx', 'src/pages/RackCenter.jsx']) {
    const code = stripComments(readFileSync(join(ROOT, f), 'utf8'));
    assert.ok(!/from\('(?:rack_requests|packaging_withdrawal_requests)'\)\.select\('\*'\)\.order\([^)]*\)\.limit\(/.test(code),
      `\n\n❌ ${f} โหลดคิว rack/บรรจุภัณฑ์แบบ order().limit() ไม่กรองสถานะ — ใบค้างเก่าหลุดจากจอเมื่อใบโตขึ้น\n`
      + '   แก้ยังไง: openPlusHistory(ใบค้าง, ประวัติ, N, คอลัมน์เวลา) จาก src/utils/fetchByIds.js\n');
  }
});

/* ── ไฟล์ EDI จากเมล ห้ามดาวน์โหลดตรงจาก bucket (06/10 · B5 — bucket ไม่เปิดให้ anon แล้ว) ── */
test('🛡️ demand-mail-via-edge-function — ไฟล์ใน bucket demand-mail ต้องเปิดผ่าน Edge Function demand-mail-file', () => {
  const hits = walk(join(ROOT, 'src'), ['.js', '.jsx'])
    .filter(f => /storage\s*\.from\(\s*['"]demand-mail['"]\s*\)/.test(stripComments(readFileSync(f, 'utf8'))));
  assert.deepEqual(hits, [],
    '\n\n❌ มีจอดาวน์โหลดไฟล์ EDI ตรงจาก storage bucket `demand-mail`: ' + hits.join(', ') + '\n'
    + '   ทำไม: bucket นี้ถูกปิดไม่ให้ anon อ่านแล้ว (supabaseDR เป็น anon เสมอ ⇒ ได้ error/ไฟล์ว่าง)\n'
    + '         เดิมเปิดไว้ = ใครถือ anon key ในบันเดิลเว็บก็โหลดยอดสั่งลูกค้าได้โดยไม่ล็อกอิน\n'
    + '   แก้ยังไง: เรียก downloadMailFile(id) ใน src/components/DemandMailInbox.jsx\n'
    + '            (Edge Function `demand-mail-file` ตรวจ token ล็อกอิน Main + สิทธิ์ก่อนส่งไฟล์)\n');
});

test('🛡️ skill-exp-no-manual-nref-divide — ห้ามหาร cum_cycles ด้วย n_ref เองในหน้า', () => {
  /* บั๊กที่เคยเกิดจริง 2026-10-08 (EXP v2 รอบแรก):
     n_ref เดิมเป็นค่าเดียวทั้งโรงงาน (2,000) แล้วหน้าจอเอา cum_cycles ÷ n_ref เอง
     พอตั้ง n_ref ต่อสถานีจาก CT จริง ค่ามันห่างกัน 34 เท่า (CT 2.5 วิ → 86 วิ)
     ⇒ คนที่สลับหลายสถานี "เลือกตัวหารไม่ถูก" · ไลน์ปั๊มไต่ขั้นเร็วกว่าไลน์ประกอบหลายสิบเท่า
     ของจริง: ฝั่ง DB สะสมเป็น `cum_ratio` รายวันไว้แล้ว (Σ shots ÷ parallel_staff ÷ n_ref ของวันนั้น) */
  const hits = [];
  for (const f of walk(join(ROOT, 'src'), ['.js', '.jsx'])) {
    const src = stripComments(readFileSync(f, 'utf8'));
    if (!/\bcum_cycles\b/.test(src)) continue;
    // หาร cum_cycles ด้วยอะไรก็ตามที่ชื่อมี n_ref (เว้นวรรค/ขึ้นบรรทัดได้)
    if (/\bcum_cycles\b[\s\S]{0,60}?\/[\s\S]{0,40}?n_?[Rr]ef/.test(src)
     || /n_?[Rr]ef[\s\S]{0,40}?\/[\s\S]{0,60}?\bcum_cycles\b/.test(src)) hits.push(relative(ROOT, f));
  }
  assert.deepEqual(hits, [],
    '\n\n❌ ไฟล์ด้านล่างหาร `cum_cycles` ด้วย `n_ref` เองที่หน้าจอ\n'
    + '   ทำไมพัง: n_ref เป็นค่า**ต่อสถานี** (คำนวณจาก CT จริง — ห่างกัน 34 เท่า · วัด 08/10/2026)\n'
    + '   คนหนึ่งสลับ 5-6 สถานี ⇒ ไม่มี n_ref ตัวเดียวที่ถูกต้องสำหรับหาร\n'
    + '   แก้ยังไง: ใช้ `employee_skill_evidence.cum_ratio` (DB สะสมสัดส่วนรายวันไว้แล้ว)\n'
    + '   ผ่าน `bandProgress(cumRatio, band, cfg)` ใน src/utils/skillExp.js\n\n'
    + hits.map(h => '   • ' + h).join('\n') + '\n');
});

/* ── 🔁 จอ "BOM ซ้ำ 2 ใบ" — กฎที่ถอดแล้วจอโกหกทันที (2026-10-08) ──────────────────────
   user สั่ง *"ทำจอสรุป 94 คู่ให้ PE ไล่เคลียร์เลย"* · กฎ 3 ข้อที่เป็นหัวใจของจอนี้:
     1. `fingerprint` — ตรวจแล้วไม่ใช่จบตลอดกาล · BOM เปลี่ยนหลังตรวจ = คู่นั้นต้องกลับเข้าคิว
        (วัดจริง: ระหว่างทำงานนี้เอง 06/10→08/10 มี 82 แถวถูกเพิ่มใน bom_items)
     2. ใบขั้นงาน (OP) ห้ามถูกนับว่า "ทำของหาย" — คนละคำถามกับใบพาร์ท
     3. จอต้องชี้อย่างเดียว **ห้ามลบ/ยุบ bom_items เอง** (ของบางตัวใช้ต่างกันตามรุ่นได้จริง
        ลบผิด = ความต้องการวัตถุดิบหาย กู้ไม่ได้ — การตัดสินเป็นของ PE/Planning)            */
test('🛡️ BOM ซ้ำ 2 ใบ: ต้องเทียบ fingerprint · ใบ OP ไม่นับของหาย · จอห้ามลบ bom_items เอง', () => {
  const util = stripComments(readFileSync(join(ROOT, 'src/utils/bomDupAudit.js'), 'utf8'));
  assert.ok(/fingerprint\s*===|norm\(review\.fingerprint\)\s*===/.test(util),
    '\n\n❌ `applyDupReviews` ไม่ได้เทียบ fingerprint แล้ว\n'
    + '   ผล: คู่ที่เคยกด "ตรวจแล้ว" จะหายจากคิว **ตลอดกาล** แม้มีคนแก้ BOM ทีหลัง = จอโกหก\n');
  assert.ok(/missingFromExplode:\s*verdict === 'op' \? \[\]/.test(util),
    '\n\n❌ ใบขั้นงาน (OP) ถูกนับว่าทำของหายแล้ว\n'
    + '   ทำไมผิด: ใบ OP ตอบ "ขั้นนี้กินอะไร" · ใบพาร์ทตอบ "พาร์ทนี้ประกอบจากอะไร" — ถูกทั้งคู่\n');

  const panel = stripComments(readFileSync(join(ROOT, 'src/components/BomDupPanel.jsx'), 'utf8'));
  assert.ok(!/from\('bom_items'\)[\s\S]{0,120}\.(delete|update|upsert|insert)\(/.test(panel),
    '\n\n❌ จอ BomDupPanel เขียน/ลบ `bom_items` เอง\n'
    + '   ทำไมห้าม: จอนี้ "ชี้ให้เห็นอย่างเดียว" — ของบางตัวใช้ต่างกันตามรุ่น/ลูกค้าได้จริง\n'
    + '            ยุบ 2 ชุดเอง = นับซ้ำ · ลบข้างใดข้างหนึ่ง = ยอดขาด กู้ไม่ได้\n'
    + '   แก้ยังไง: ให้คนกดไปแก้ที่แท็บ BOM เอง (ปุ่ม ↗) แล้วบันทึกผลตรวจใน bom_dup_reviews\n');
  assert.ok(/checkWriteRows\(await/.test(panel),
    '\n\n❌ ปุ่มบันทึกผลตรวจไม่ได้นับแถวผ่าน `checkWriteRows` (RLS ปฏิเสธ = 0 แถว ไม่มี error)\n');
});

/* ═══ 🚪 modal ที่ "มีช่องกรอก" ห้ามปิดจากการคลิกพื้นหลัง — รูป `setX(null)` (2026-10-06 · QC audit) ═══
   กฎเดิม `modal-closes-on-backdrop` (ข้อ 200 ด้านบน) จับเฉพาะลายเซ็น `onClick={onClose}`
   ⇒ รูป `onClick={() => setXxx(null)}` **ลอดด่านมาได้** · เจอจริง `DailyReport` modal
   "📞 เรียกช่างด่วน / 📝 เปิดใบแจ้งซ่อม" ที่มีปุ่มเลือกทีมช่าง + `<input type="file" capture>`
   ⇒ เผลอแตะนอกกรอบบนแท็บเล็ตหน้าไลน์ = ทีมที่เลือก + รูปที่ถ่ายหายหมด ต้องถ่ายใหม่

   🔴 ด่านนี้ **ดูเนื้อในจริง ไม่ใช้ allow list** — popup แสดงผลอย่างเดียว (ดูกราฟ/รูป/ประวัติ/drill)
   ปิดจาก backdrop ได้ตามกฎ UI-CONVENTIONS §5 อยู่แล้ว (เผลอแตะก็ไม่เสียอะไร) ⇒ ไม่ต้องขึ้นทะเบียน
   วัดจริง 06/10: 18 overlay ที่ใช้รูปนี้ — **17 ตัวไม่มีช่องกรอกเลย** ถ้าใช้ allow list ต้องเขียน
   17 รายการที่ไม่ได้บอกอะไร แล้ว popup ตัวที่ 18 ที่มีฟอร์มจริงก็ยังหลุดได้อยู่ดี
   ⇒ ขอบเขต overlay หาจาก `</div>` ตัวแรกที่ย่อหน้า ≤ บรรทัดเปิด (JSX ในรีโปนี้จัดย่อหน้าสม่ำเสมอ)
     — เทียบกับที่ไล่ดูมือทั้ง 18 ตัวแล้วตรงกันเป๊ะ (window แบบนับบรรทัดตายตัวล้นไปโมดัลถัดไป) */
test('🚪 backdrop-close-form-modal — overlay ที่ปิดด้วย setX(null) ห้ามมีช่องกรอกข้างใน', () => {
  const OVERLAY = /position:\s*'fixed'|className="(?:overlay|modal-scroll)"/;
  const CLOSER  = /onClick=\{\(\)\s*=>\s*[A-Za-z_$][A-Za-z0-9_$]*\s*\(\s*(?:null|false|'')\s*\)\s*\}/;
  const CTRL    = /<input(?![A-Za-z])|<textarea|<select(?![A-Za-z])|<SearchSelect|<PersonSelect|<MachineSelect|<ProductSelect|<PartSelect|<CustomerSelect|type="file"/;
  const bad = [];
  for (const f of walk(join(ROOT, 'src'), ['.jsx'])) {
    const lines = readFileSync(f, 'utf8').split('\n');
    lines.forEach((ln, i) => {
      if (!OVERLAY.test(ln) || !CLOSER.test(ln)) return;
      const indent = ln.match(/^\s*/)[0].length;
      let end = lines.length;
      for (let k = i + 1; k < Math.min(lines.length, i + 400); k++) {
        if (/^\s*<\/div>/.test(lines[k]) && lines[k].match(/^\s*/)[0].length <= indent) { end = k; break; }
      }
      const body = stripComments(lines.slice(i, end).join('\n'));
      const m = body.match(CTRL);
      if (m) bad.push(`${relative(ROOT, f)}:${i + 1}  (พบ ${m[0]} ข้างใน)`);
    });
  }
  assert.deepEqual(bad, [],
    '\n\n❌ overlay ที่ปิดจากการคลิกพื้นหลัง แต่ข้างในมีช่องกรอก:\n   ' + bad.join('\n   ') + '\n'
    + '   ทำไมห้าม (คำสั่ง user 2026-07-09): เผลอแตะนอกกรอบทีเดียว ที่กรอกไว้ทั้งฟอร์มหายหมด\n'
    + '     ไม่มีทางเรียกคืน — บนแท็บเล็ต/จอทัชหน้าไลน์เกิดง่ายมาก (รูปที่ถ่ายไว้ก็หายด้วย)\n'
    + '   แก้: เอา `onClick={() => setXxx(null)}` ออกจาก <div> ชั้น overlay\n'
    + '        แล้วปิดด้วยปุ่ม ✕ / ยกเลิก ข้างในเท่านั้น (เกือบทุก modal มีปุ่มนั้นอยู่แล้ว)\n'
    + '   ⚠️ ด่านนี้ไม่มี allow list โดยเจตนา — popup แสดงผลอย่างเดียวไม่เข้าข่ายอยู่แล้ว\n'
    + '      ถ้าจำเป็นต้องมีช่องกรอกในของที่ปิดจาก backdrop ได้จริง ให้คุยกับ user ก่อน\n');
});


/* ═══ 📝 เขียน DB แล้วทิ้งผล `await` = กลืน error 100% (2026-10-06 · QC audit) ═══
   `supabase-js` **ไม่ throw** — คืน `{ data, error }` เสมอ (กฎเหล็ก DB ข้อ 1)
   ⇒ `await supabase.from(t).update(x)` ที่อยู่ "ตำแหน่ง statement" (ไม่มีใครรับผล) = ล้มแล้วไม่มีใครรู้
   ด่านเดิมในลิสต์ RULES จับได้เฉพาะรูป `^\s*await supabase…` (ต้นบรรทัดล้วน) ⇒ รูปที่ซ่อนอยู่
   หลัง `if (…)` / `else if (…)` / ใน one-liner arrow **ลอดมาได้ทั้งหมด**
   วัดจริง 06/10 เจอ 7 จุด ที่หนักสุด 3 ตัว:
     · `PeRoutingSuggest` เส้นทาง **rollback** — ขึ้น toast "คืนชุดเดิมให้แล้ว" โดยไม่เคยเช็ค
       ⇒ ถ้าคืนล้ม ผู้ใช้ได้ข้อความยืนยัน**เท็จ** ทั้งที่ routing ของพาร์ทนั้นหายทั้งชุด
     · `ProductMaster.delLink/delMaster` ปุ่มลบจริง — RLS ปฏิเสธ = 0 แถว ไม่มี error
       ⇒ กดลบแล้วแถวเดิมวาดกลับมา ไม่มีอะไรบอกว่าทำไม ⇒ ผู้ใช้กดซ้ำ/คิดว่าจอค้าง
     · `RoutingPanel` เรียง `seq` ใหม่หลังลบ — ล้มเงียบ ⇒ เลขกระโดด/ซ้ำ แล้วไปชน
       `unique (mat_no, seq)` ในการบันทึกครั้งถัดไปแบบงงๆ
   ข้อยกเว้นที่ถูกต้อง: ต่อ `.then(ok, err)` = **ตั้งใจ** best-effort (ไม่ใช่กลืนเงียบ) */
test('📝 write-result-discarded — write ที่อยู่ตำแหน่ง statement ต้องมีคนรับผล', () => {
  const bad = [];
  for (const f of walk(join(ROOT, 'src'), ['.jsx', '.js'])) {
    const rel = relative(ROOT, f);
    if (/__tests__|utils[/\\]dbWrite\.js/.test(rel)) continue;
    const lines = readFileSync(f, 'utf8').split('\n');
    lines.forEach((ln, i) => {
      const k = ln.search(/\bawait\s+supabase(?:DR)?\s*\.from\(/);
      if (k < 0) return;
      // chain เขียนจริงไหม (อาจพาดหลายบรรทัด)
      if (!/\.(insert|update|delete|upsert)\(/.test(lines.slice(i, i + 3).join('\n'))) return;
      /* "ตำแหน่ง statement" ตัดสินจากตัวอักษรที่ไม่ใช่ช่องว่าง **ตัวสุดท้ายก่อน `await`**
         `{` `;` `}` = ต้นประโยคใหม่ · `)` = ท้ายหัว if/while/for · `else` = สาขา ⇒ ผลถูกทิ้ง
         `=` `(` `?` `:` `,` `[` `>` / คำ `return` = ผลถูกรับไว้แล้ว (assign / checkWrite( / ternary)
         (เลี่ยงการ strip วงเล็บ — วงเล็บซ้อน + template literal ภาษาไทยทำ regex พลาด) */
      const tail = ln.slice(0, k).replace(/\s+$/, '');
      if (!(tail === '' || /[{};)]$/.test(tail) || /\belse$/.test(tail))) return;
      if (/\.then\(/.test(lines.slice(i, i + 5).join('\n'))) return;   // best-effort ที่ตั้งใจ
      bad.push(`${rel}:${i + 1}  ${ln.trim().slice(0, 95)}`);
    });
  }
  assert.deepEqual(bad, [],
    '\n\n❌ เขียน DB แล้วไม่มีใครรับผล (supabase-js ไม่ throw ⇒ ล้มแล้วเงียบ 100%):\n   '
    + bad.join('\n   ') + '\n'
    + '   แก้: const res = await supabase.from(t).update(x).eq(...).select(\'id\');\n'
    + '        if (!checkWrite(res, \'ป้ายงาน\')) return;\n'
    + '        if (!(res.data || []).length) { toast.error(\'ไม่สำเร็จ (0 แถว) — สิทธิ์ไม่พอ\'); return; }\n'
    + '   ⚠️ ปุ่มที่ผลลัพธ์สำคัญต้องนับแถวด้วย — RLS ปฏิเสธ UPDATE/DELETE = 0 แถว ไม่มี error (ข้อ 2)\n'
    + '   ถ้าตั้งใจให้ best-effort จริง (งานหลักสำเร็จแล้ว ล้มตรงนี้ไม่ควรล้มทั้ง flow):\n'
    + '        ต่อ `.then(() => {}, () => {})` + เขียนคอมเมนต์ว่าทำไม — **ห้ามปล่อยลอยๆ**\n'
    + '        และถ้าของที่ล้มมีคนอ่านต่อ (ประวัติ/รายงาน) ควร toast.error บอกด้วย\n');
});

/* ── 💬 คอมเมนต์ใบ MO ต้องมี "กองเดียว" และต้องไปถึงใบพิมพ์ (07/10 · คอมเมนต์ทีม MTN ข้อ 1) ──
   ที่มา: ทีม MTN ขอ *"แก้ไขรายละเอียด MO ได้"* เพราะเปิดเอกสารมาแล้วรายละเอียดไม่ตรงของจริง
   user ตัดสิน: ไม่แก้ทับของผู้แจ้ง — เอาคอมเมนต์ที่คุยกันใต้ใบ ไปต่อท้ายในช่องเดียวกันบนใบพิมพ์
   รอบแรกของงานนี้เกือบสร้างตาราง `mtn_order_comments` ใหม่ ทั้งที่ `event_comments` ใช้อยู่แล้ว
   (74 คอมเมนต์ · 49 ใบ) ⇒ ใบเดียวมีคอมเมนต์ 2 กอง = ใบพิมพ์ไม่ตรงกับจอ
   📄 `docs/modules/mtn-work-order.md` §คอมเมนต์บนใบพิมพ์ */
test('🛡️ mo-comments-single-store — คอมเมนต์ใบ MO ต้องอยู่ที่ event_comments ที่เดียว', () => {
  const hits = walk(join(ROOT, 'src'), ['.js', '.jsx'])
    .filter(f => /mtn_order_comments/.test(stripComments(readFileSync(f, 'utf8'))))
    .map(f => relative(ROOT, f));
  assert.deepEqual(hits, [],
    '\n\n❌ มีโค้ดอ้างตารางคอมเมนต์ใบ MO ชุดที่ 2 (`mtn_order_comments`): ' + hits.join(', ') + '\n'
    + '   ทำไมห้าม: ใบ MO มีคอมเมนต์อยู่แล้วที่ `event_comments` (ref_kind=\'mtn_order\')\n'
    + '            ซึ่ง <EventComments> บนจอใช้อยู่ · 2 กอง = ใบพิมพ์ไม่ตรงกับที่คนคุยกันบนจอ\n'
    + '   แก้ยังไง: อ่าน/เขียนผ่าน event_comments · ฝั่งใบพิมพ์/Excel ใช้ src/lib/moComments.js\n');
});

test('🛡️ mo-print-needs-comments — ใบพิมพ์ MO ทั้ง 2 ฟอร์ม + Excel ต้องวางคอมเมนต์ต่อท้ายผู้แจ้ง', () => {
  const mo = stripComments(readFileSync(join(ROOT, 'src/pages/MtnRepair.jsx'), 'utf8'));
  // ทั้ง 2 ฟอร์มต้องรับ cmt และเรียกตัววาดกลาง (ห้ามประกอบข้อความคอมเมนต์เองในแต่ละฟอร์ม)
  for (const fn of ['printMoReport', 'printMoReportMtn']) {
    assert.ok(new RegExp(`function ${fn}\\([^)]*cmt`).test(mo),
      `\n\n❌ ${fn}() ไม่รับคอมเมนต์ (พารามิเตอร์ \`cmt\`) — ใบที่พิมพ์ออกไปจะไม่มีคอมเมนต์ที่คุยกันไว้\n`
      + '   ที่มา: คอมเมนต์ทีม MTN 06/10 "เปิดเอกสารมาบางครั้งรายละเอียดไม่ตรงสาเหตุที่เกิดขึ้นจริง"\n');
  }
  // นับเฉพาะ "การเรียกในเทมเพลตใบ" (${cmtBlockHtml(…)) — ไม่นับบรรทัดประกาศฟังก์ชัน
  assert.equal((mo.match(/\$\{cmtBlockHtml\(cmt/g) || []).length, 2,
    '\n\n❌ ใบพิมพ์ MO ไม่ได้วาดบล็อกคอมเมนต์ครบทั้ง 2 ฟอร์ม (FM-JIG-008 + FM-MTN-006)\n'
    + '   ทั้ง 2 ฟอร์มต้องเรียก cmtBlockHtml(cmt, esc) — ฟอร์มที่ลืม = ทีมนั้นไม่เห็นคอมเมนต์บนใบ\n');
  // คอมเมนต์ต้องอยู่ "ต่อท้าย" รายละเอียดของผู้แจ้ง ไม่ใช่แทนที่ (คำสั่ง user: ต่อจากที่ผู้แจ้งแจ้งมา)
  assert.ok(/report_note \|\| o\.problem_detail\)\}\$\{cmtBlockHtml/.test(mo),
    '\n\n❌ ใบ FM-JIG-008 ไม่ได้วางคอมเมนต์ "ต่อท้าย" รายละเอียดของผู้แจ้ง\n'
    + '   🔴 ของผู้แจ้งคือ **บันทึก ณ วันที่แจ้ง** ห้ามถูกแทนที่/ถูกดันหาย — คอมเมนต์ต่อท้ายเท่านั้น\n');
  const xl = stripComments(readFileSync(join(ROOT, 'src/lib/mtnMoExportExcel.js'), 'utf8'));
  /* 03/11 — คอลัมน์ชีท 1 ย้ายไปทะเบียน `src/utils/mtnMoExportCols.js` (ข้อ A8) ⇒ ตัวทำไฟล์ส่ง `moCommentText`
     + `commentsError` เข้าทะเบียน · ทะเบียนต้องเขียน "โหลดคอมเมนต์ไม่สำเร็จ" เมื่อ commentsError (ห้ามกลืน) */
  const cols = stripComments(readFileSync(join(ROOT, 'src/utils/mtnMoExportCols.js'), 'utf8'));
  assert.ok(/commentText:\s*moCommentText\b/.test(xl) && /commentsError/.test(xl)
    && /commentsError\s*\?\s*'⚠ โหลดคอมเมนต์ไม่สำเร็จ'/.test(cols) && /commentText\(/.test(cols),
    '\n\n❌ Excel export ใบ MO ไม่มีคอลัมน์คอมเมนต์ (หรือกลืน commentsError)\n'
    + '   🔴 โหลดคอมเมนต์ไม่สำเร็จ = ต้องเขียนกำกับในไฟล์ · ช่องว่างเฉยๆ อ่านเป็น "ไม่มีใครคอมเมนต์"\n');
});

test('🛡️ daily-am-single-loader — จอ AM รายวัน (DailyPM · FactoryMap) ต้องอ่านผ่าน lib/dailyAmBoard.js ห้ามคิวรี inspections/คิดกะเอง', () => {
  for (const f of ['src/pages/DailyPM.jsx', 'src/pages/FactoryMap.jsx']) {
    const src = stripComments(readFileSync(join(ROOT, f), 'utf8'));
    assert.ok(/from ['"]\.\.\/lib\/dailyAmBoard['"]/.test(src),
      `\n\n❌ ${f} ไม่ได้ import lib/dailyAmBoard — สถานะ AM รายวันต้องมาจาก loader กลางตัวเดียว\n`
      + '   ที่มา 2026-10-08: ผังรวมโรงงานอ่าน AM จาก pm_plans.next_due_date ขณะที่แผน AM รายวันเป็น run_day (null)\n'
      + '            ⇒ "AM ปกติ (N)" ค้างตลอดกาลไม่ว่าจะตรวจหรือไม่ (user: "สเตตัสไม่อัพเดท")\n');
    assert.ok(!/from\(['"]inspections['"]\)/.test(src) && !/function getShiftInfo\(/.test(src),
      `\n\n❌ ${f} คิวรี inspections / ประกาศ getShiftInfo เอง — สองจอจะตอบคนละสี · ใช้ loadDailyAm()/amShiftInfo() จาก lib/dailyAmBoard.js\n`);
  }
  // ตัวตัดสินสี AM บนผังต้องไม่กลับไปใช้ตัวนับจากแผนปฏิทินล้วน (amTotal/amOverdue) เป็นตัวหลัก
  const fm = stripComments(readFileSync(join(ROOT, 'src/pages/FactoryMap.jsx'), 'utf8'));
  assert.ok(!/s\.amTotal \? \(s\.amOverdue/.test(fm) && /amDTotal/.test(fm),
    '\n\n❌ METRICS.am ใน FactoryMap กลับไปตัดสินจาก amTotal/amOverdue (วันครบกำหนดแผน) — ต้องใช้ amD* จาก dailyAmLineStatus\n');
});

/* ── ลบแถวทะเบียน cost center ต้องนับปลายทางก่อน (08/10 · เคสจริง 06/10) ──────────────
   06/10 มีการลบ 31 แถวใน `cost_centers` ด้วยเหตุผล "ชื่อว่าง น่าจะไม่ได้ใช้" — ตรวจย้อนพบว่า
   29 รหัสในนั้นบัญชีตั้ง activity rate ปี 2026 ไว้ครบ (ชื่อหน่วยจริงอยู่ใน cost_center_rates.note)
   แผงทะเบียนลบทันทีโดยไม่เคยนับปลายทาง — ขัดกฎ CLAUDE.md "นับไม่ครบ = ห้ามลบ (fail-closed)" */
test('🛡️ cost-center-delete-needs-refs — แผงทะเบียน cost_centers ต้องส่ง onBeforeDelete', () => {
  const bad = walk(join(ROOT, 'src'), ['.js', '.jsx']).filter((f) => {
    const code = stripComments(readFileSync(f, 'utf8'));
    if (!/table=["']cost_centers["']/.test(code)) return false;
    return !/onBeforeDelete/.test(code) || !/costCenterRefs/.test(code);
  }).map(f => f.replace(ROOT + '/', ''));
  assert.deepEqual(bad, [],
    '\n\n❌ แผงที่เรนเดอร์ทะเบียน `cost_centers` ไม่มีด่านนับปลายทางก่อนลบ: ' + bad.join(', ') + '\n'
    + '   ทำไมผิด: cost_centers.code จับคู่ด้วย "ข้อความ" ไม่ผูก FK ⇒ ลบแล้วไม่มีใครเตือน\n'
    + '            ปลายทางมี 3 ทาง: production_lines · org_nodes · **cost_center_rates (ค่าแรงจากบัญชี)**\n'
    + '            + แกน KPI (scope_kind=cost_center) · เช็คแค่ไลน์/ผัง = ตอบ "ไม่มีใครใช้" ทั้งที่มี\n'
    + '            รหัสที่หลุดจากทะเบียน <CostCenterSelect> (allowFree=false) เลือกไม่ได้อีก\n'
    + '   แก้ยังไง: onBeforeDelete={async (r) => costCenterBlockMessage(r.code,\n'
    + '               await loadCostCenterRefs(supabase, r.code))}  (src/utils/costCenterRefs.js)\n');
});


/* ═══ 📑 CSV export ต้องผ่านทะเบียนเอกสาร (2026-10-08 · QC audit รอบ 3) ═══
   CLAUDE.md §doc-forms: *"เอกสาร export ใหม่ทุกตัว (ฟอร์มพิมพ์/PDF/Excel/รายงานภายใน/CSV —
   **ไม่มีข้อยกเว้น**) ต้อง register เข้าทะเบียน `/doc-forms`"*
   CSV ถูกมองข้ามมาตลอดเพราะไม่มีหัวกระดาษให้ใส่เลขฟอร์ม ⇒ เลขฟอร์มไปอยู่ที่ **ชื่อไฟล์**
   (`csvDocName` ใน `src/utils/csvDoc.js`) — 🔴 ห้ามแทรกบรรทัดเลขฟอร์มในเนื้อ CSV
   เพราะ Excel/Sheets ใช้ "แถวแรก = หัวตาราง" ⇒ คอลัมน์เลื่อนทั้งไฟล์ = พัง pivot/สูตรของคนที่ใช้ทุกวัน

   เจอจริง 08/10: `Report.jsx` (10 ปุ่ม) + `DailyReport.jsx` (2 ปุ่ม × 4 ชนิดรายงาน) เขียนตัว
   ดาวน์โหลดเองโดยก๊อป logic ของ `csvDoc.js` มาทั้งดุ้น ⇒ doc_control แก้เลขฟอร์มไม่ได้เลย
   🔴 และสำเนาใน `DailyReport` **ไม่มีด่านกัน formula injection** (ของ `Report.jsx` มี) ⇒ ค่าที่
   หน้างานพิมพ์ในช่อง 'รายละเอียด'/'เครื่องจักร' ขึ้นต้นด้วย `=` `+` `@` ถูก Excel **รันเป็นสูตร
   บนเครื่องคนรับไฟล์** — นี่คือเหตุผลที่ต้องมีทางเดียว ไม่ใช่สำเนาที่ต้องไปตามแก้ทีละที่ */
test('📑 csv-export-via-csvDoc — สร้างไฟล์ CSV ต้องผ่าน src/utils/csvDoc.js', () => {
  const bad = [];
  for (const f of walk(join(ROOT, 'src'), ['.jsx', '.js'])) {
    const rel = relative(ROOT, f);
    if (rel === 'src/utils/csvDoc.js') continue;              // ตัวของกลางเอง
    const src = stripComments(readFileSync(f, 'utf8'));
    for (const m of src.matchAll(/new\s+Blob\([^)]*text\/csv/g)) {
      const line = src.slice(0, m.index).split('\n').length;
      bad.push(`${rel}:${line}  new Blob(… 'text/csv' …)`);
    }
  }
  assert.deepEqual(bad, [],
    '\n\n❌ สร้างไฟล์ CSV เองโดยไม่ผ่านทะเบียนเอกสาร:\n   ' + bad.join('\n   ') + '\n'
    + '   ทำไมต้องผ่านของกลาง:\n'
    + '     1. doc_control ต้องแก้เลขฟอร์ม/Rev ได้เองจาก /doc-forms โดยไม่ต้องแก้โค้ด\n'
    + '     2. กัน formula injection ที่เดียว — สำเนาที่ก๊อปไปมักตกข้อนี้ (เกิดจริงที่ DailyReport)\n'
    + '        ค่าที่หน้างานพิมพ์ขึ้นต้น `=` `+` `@` = Excel รันเป็นสูตรบนเครื่องคนรับไฟล์\n'
    + '     3. BOM นำหน้า (Excel ไทยอ่าน UTF-8 ไม่ออกถ้าไม่มี) + revoke blob URL ทุกทาง\n'
    + '   แก้: import { downloadCsvDoc, csvText } from \'../utils/csvDoc\';\n'
    + '        downloadCsvDoc(\'<doc_key>\', \'<ชื่อไฟล์เดิม>\', csvText(headers, rows));\n'
    + '        + seed doc_key ใน migration (ดู 20261008_doc_forms_csv_round2_main.sql)\n'
    + '        + เรียก loadDocForms() ที่หน้านั้น (docFormSync เป็น sync ⇒ ต้อง warm cache เอง)\n'
    + '   🔴 ห้ามแทรกบรรทัดเลขฟอร์มในเนื้อ CSV — เลขฟอร์มอยู่ที่ "ชื่อไฟล์" เท่านั้น\n');
});

/* ── ตารางมอนิเตอร์ใช้หัวคอลัมน์/วันเริ่มชุดเดียว (08/10 · user "หัวตาราง/การกรอง/วันเริ่ม ให้ทิศทางเดียวกัน") ── */
test('🛡️ MonitorBoardGrid + RundownStock: หัวคอลัมน์ช่วงเวลาผ่าน utils/periodHead.js · บอร์ดเปิดมาที่วันนี้', () => {
  for (const f of ['src/components/MonitorBoardGrid.jsx', 'src/pages/RundownStock.jsx']) {
    const code = stripComments(readFileSync(join(ROOT, f), 'utf8'));
    assert.ok(/from '\.\.\/utils\/periodHead'/.test(code) && /periodHead\(/.test(code),
      `\n\n❌ ${f} เขียนป้ายหัวคอลัมน์เอง — ต้องใช้ periodHead() (ป้าย/วันนี้/สี ชุดเดียวทุกตาราง)\n`);
    assert.ok(!/const dayLabel\s*=/.test(code), `\n\n❌ ${f} กลับไปมี dayLabel ของตัวเองอีกแล้ว\n`);
  }
  const grid = stripComments(readFileSync(join(ROOT, 'src/components/MonitorBoardGrid.jsx'), 'utf8'));
  assert.ok(/startIndexForToday\(/.test(grid) && /isTodayPeriod\(/.test(grid),
    '\n\n❌ บอร์ดต้องเปิดมาที่คอลัมน์วันนี้ (startIndexForToday) และชี้วันนี้แบบรู้จักบอร์ดรายสัปดาห์ (isTodayPeriod)\n');
});

test('🛡️ am-team-via-isAmTeam — ห้าม hardcode department "production" เป็นทีม AM (ใช้ isAmTeam จาก mtn_teams.kind)', () => {
  const hits = walk(join(ROOT, 'src'), ['.js', '.jsx'])
    .filter(f => !/utils\/pmTeams\.js$/.test(f))
    .filter(f => /\.eq\(['"]department['"],\s*['"]production['"]\)|department\s*[!=]==\s*['"]production['"]|\.has\(['"]production['"]\)/.test(stripComments(readFileSync(f, 'utf8'))))
    .map(f => relative(ROOT, f));
  assert.deepEqual(hits, [],
    '\n\n❌ มีโค้ดตัดสิน "ทีม AM" ด้วย department === \'production\' ตรงๆ: ' + hits.join(', ') + '\n'
    + '   ที่มา 2026-10-08 (audit AM↔PM): AM แยกรายส่วนงานได้ (mtn_teams.kind=\'am\' หลาย key) — hardcode = ทีมใหม่ไม่ถูกนับว่าตรวจแล้ว\n'
    + '            ⇒ ส้มยิงทุกไลน์ / จอ AM ว่าง / สอบกลับนับใบช่างเป็น AM\n'
    + '   แก้ยังไง: isAmTeam(department) จาก src/utils/pmTeams.js (โหลด loadPmTeams() ก่อน) · ฝั่ง edge อ่าน mtn_teams.kind\n');
});

/* ── 🖼️ ลบรูปใน storage ต้องนับผู้อ้างก่อน เมื่อ path ถูกแชร์ได้ (08/10 · QC audit) ────────
   เคสจริง: `copyChecklistToEquipment/Dept` คัดลอกจุดตรวจไปเครื่องอื่นโดย **ใช้ image_path เดิม
   ร่วมกัน ไม่ก๊อปไฟล์** ⇒ `handleDelete` ที่ลบทั้งโฟลเดอร์ `jigs/<id>/` ทำให้รูปจุดตรวจของทุก
   เครื่องที่ก๊อปไป **หายถาวร กู้ไม่ได้ และไม่มี error ฟ้อง** · path เดียวถูกอ้างจาก 3 ตาราง
   (jig_images · jigs · jig_checkpoints) ⇒ ต้องผ่าน `orphanImagePaths()` ที่นับครบทั้ง 3 + fail-closed
   📄 `docs/modules/pm-hub-check-setup.md` §คัดลอกแผน PM */
test('🛡️ jig-image-delete-needs-ref-count — ลบรูป bucket jig-images ต้องผ่าน orphanImagePaths()', () => {
  const bad = [];
  for (const file of walk(join(ROOT, 'src'), ['.js', '.jsx'])) {
    const rel = relative(ROOT, file);
    if (rel.includes('__tests__') || rel.endsWith('utils/jigImageRefs.js')) continue;
    const code = stripComments(readFileSync(file, 'utf8'));
    if (!/from\(\s*['"]jig-images['"]\s*\)[\s\S]{0,200}?\.remove\(/.test(code)) continue;
    /* เฉพาะไฟล์ที่แตะ path ใต้ `jigs/` — นั่นคือชุดที่ถูกแชร์ตอนคัดลอกจุดตรวจ
       รูปผังโซน `facility/<id>.<ext>` (MtnMachineLayout) เป็น 1 path ต่อ 1 แถว ไม่ถูกแชร์ ⇒ ไม่เข้าข่าย
       ⚠️ ถ้าวันหน้ามีการแชร์ path แบบอื่น ให้ขยายเงื่อนไขนี้ ไม่ใช่ใส่ allow-list รายไฟล์ */
    if (!/['"`]jigs\//.test(code)) continue;
    if (!/orphanImagePaths\s*\(/.test(code)) bad.push(rel);
  }
  assert.deepEqual(bad, [], '\n\n❌ ลบไฟล์ใน bucket `jig-images` โดยไม่นับผู้อ้าง: ' + bad.join(', ') + '\n'
    + '   ทำไม: จุดตรวจที่ "คัดลอกไปเครื่อง/แผนกอื่น" ใช้ image_path เดิมร่วมกัน (ไม่ก๊อปไฟล์)\n'
    + '         ⇒ ลบรูปของเครื่องต้นแบบ = รูปของทุกเครื่องที่ก๊อปไปเสียถาวร ไม่มี error ฟ้อง\n'
    + '   แก้ยังไง: `const { orphan } = await orphanImagePaths(paths, { exceptJigId })` แล้วลบแค่ orphan\n'
    + '             (นับไม่ได้ = ของกลางคืน orphan ว่าง = ไม่ลบ · ไฟล์กำพร้าค้าง ดีกว่าลบของที่ยังใช้)\n');
});

/* ── 📄 CSV export ต้องผ่าน `utils/csvDoc.js` (ทะเบียนเอกสาร + กัน formula injection) ──────
   กฎ 06/10 (user เคาะ "เข้า ทำเลย"): CSV ที่หลุดออกจากระบบก็เป็นเอกสาร ต้อง register /doc-forms
   รอบนั้น seed 8 คีย์ แต่ **ตก /report (10 จุด) และ /daily-report (2 จุด)** ซึ่งเขียน helper เอง
   🔴 ตัวของ DailyReport ยัง **ไม่มีตัวกัน formula injection เลย** — ค่าที่คนพิมพ์ขึ้นต้น `=`
      ถูก Excel รันเป็นสูตร · ไฟล์มีรหัสพนักงาน ชื่อ-สกุล การมาทำงาน เบี้ยทักษะ
   📄 `docs/modules/doc-forms.md` §CSV export ก็เป็นเอกสาร */
test('🛡️ csv-export-via-csvdoc — หน้าที่ทำไฟล์ CSV ห้ามประกอบ Blob/escape เอง', () => {
  const bad = [];
  for (const file of walk(join(ROOT, 'src'), ['.js', '.jsx'])) {
    const rel = relative(ROOT, file);
    if (rel.includes('__tests__') || rel.endsWith('utils/csvDoc.js')) continue;
    const code = stripComments(readFileSync(file, 'utf8'));
    // สร้าง Blob ชนิด text/csv เอง = ไม่ผ่านทะเบียน/ไม่การันตีว่ากัน formula injection
    if (/new Blob\([^)]*text\/csv/.test(code)) bad.push(`${rel} (new Blob text/csv)`);
  }
  assert.deepEqual(bad, [], '\n\n❌ มีจุดทำไฟล์ CSV เองไม่ผ่านของกลาง: ' + bad.join(', ') + '\n'
    + '   ทำไม: (1) ไม่เข้าทะเบียน /doc-forms — doc_control คุมเลขฟอร์ม/Rev ไม่ได้\n'
    + '         (2) ทุกชุดที่เขียนเองมีสิทธิ์ลืมตัวกัน CSV formula injection (เกิดจริงที่ DailyReport)\n'
    + '   แก้ยังไง: `downloadCsvDoc(docKey, legacyName, csvText(headers, rows))` + seed doc_key\n'
    + '             (form_code = null ⇒ วันที่ apply ชื่อไฟล์เหมือนเดิมเป๊ะ)\n');
});

/* ── 🎞️ ตัวเช็ค GIF + เพดานขนาด ต้องมาจาก `utils/imageFileKind.js` จุดเดียว (08/10 · QC audit) ──
   กฎเดิม (storage-images.md): *"ตัวตรวจชนิดไฟล์ = imageFileKind.js จุดเดียว (ดูนามสกุลด้วย
   ไม่ใช่แค่ MIME)"* — แต่ไม่มีด่าน ⇒ drift กลับมา **6 ไฟล์** (รวมของกลาง ImageCropModal เอง)
   🔴 ทำไมสำคัญ: **Android/Chrome ส่ง MIME ว่างมากับรูปจริง** ⇒ `type === 'image/gif'` เป็นเท็จ
      = เพดาน 2MB รั่ว = GIF เฉลี่ย 4 MB/ไฟล์ ขึ้น storage (เคยทำ egress ทะลุโควต้าจน
      Supabase ล็อกบริการทั้ง organization — ทั้งโรงงาน login ไม่ได้)
   · เลขเพดานก็ห้ามเขียนซ้ำ — `GIF_MAX_BYTES` / `GIF_TOO_BIG_MSG` */
test('🛡️ gif-check-via-imagefilekind — ห้ามเทียบ image/gif หรือเขียนเพดาน GIF เองในหน้า', () => {
  const bad = [];
  for (const file of walk(join(ROOT, 'src'), ['.js', '.jsx'])) {
    const rel = relative(ROOT, file);
    if (rel.includes('__tests__') || rel.endsWith('utils/imageFileKind.js')) continue;
    const code = stripComments(readFileSync(file, 'utf8'));
    // layoutImage.js เทียบ type ภายในตัวบีบ (ได้ไฟล์ที่ผ่านด่านมาแล้ว) — ข้อยกเว้นที่บันทึกไว้
    if (!rel.endsWith('utils/layoutImage.js') && /['"]image\/gif['"]\s*===|===\s*['"]image\/gif['"]/.test(code)) {
      bad.push(`${rel} (เทียบ 'image/gif' เอง → ใช้ isGifFile())`);
    }
    if (/2\s*\*\s*1024\s*\*\s*1024/.test(code) && /gif/i.test(code)) {
      bad.push(`${rel} (เขียนเพดาน GIF 2MB เอง → ใช้ GIF_MAX_BYTES)`);
    }
  }
  assert.deepEqual(bad, [], '\n\n❌ ตัวเช็ค GIF เขียนเองนอกของกลาง:\n' + bad.map(b => '   • ' + b).join('\n') + '\n'
    + '   ทำไม: Android ส่ง MIME ว่างมากับรูปจริง ⇒ เทียบ type ล้วน = เพดาน 2MB รั่ว\n'
    + '         GIF บีบไม่ได้ (เฉลี่ย 4 MB/ไฟล์) · egress เคยทะลุโควต้าจนทั้งโรงงาน login ไม่ได้\n'
    + '   แก้ยังไง: `isGifFile(file)` + `GIF_MAX_BYTES` / `GIF_TOO_BIG_MSG` จาก utils/imageFileKind.js\n');
});

/* ── 📦 ไลบรารี export ก้อนใหญ่ ต้อง lazy (08/10 · QC audit · egress ข้อ 11) ──────────────
   `jspdf` ~400 KB · `jspdf-autotable` ~30 KB · `xlsx` ~424 KB · `exceljs` ~930 KB
   static import = **โหลดตอน "เปิดหน้า" ไม่ใช่ตอน "กด export"** · วัดจากบันเดิลจริง 08/10:
   `PMCheckData-*.js` ดึง jspdf + autotable มาทุกครั้งที่เปิด /pm?tab=check (429 KB)
   และ `EventLog` ดึง xlsx 424 KB — ที่เหลือทั้งระบบ lazy อยู่แล้ว 2 จุดนี้เป็นตัวที่ตก */
test('🛡️ export-libs-lazy-import — jspdf/xlsx/exceljs ห้าม static import', () => {
  const LIBS = ['jspdf', 'jspdf-autotable', 'xlsx', 'exceljs'];
  const bad = [];
  for (const file of walk(join(ROOT, 'src'), ['.js', '.jsx'])) {
    const rel = relative(ROOT, file);
    if (rel.includes('__tests__')) continue;
    const code = stripComments(readFileSync(file, 'utf8'));
    for (const lib of LIBS) {
      const re = new RegExp(`^\\s*import\\s[^;]*?from\\s+['"]${lib.replace('/', '\\/')}['"]`, 'm');
      if (re.test(code)) bad.push(`${rel} → ${lib}`);
    }
  }
  assert.deepEqual(bad, [], '\n\n❌ ไลบรารี export ถูก static import:\n' + bad.map(b => '   • ' + b).join('\n') + '\n'
    + '   ทำไม: โหลดตอนเปิดหน้า แม้ผู้ใช้ไม่เคยกด export (jspdf 429 KB · xlsx 424 KB · exceljs 930 KB)\n'
    + '   แก้ยังไง: `const { default: jsPDF } = await import(\'jspdf\')` ในฟังก์ชัน export\n'
    + '             (ฟังก์ชันที่เป็น async อยู่แล้วเปลี่ยนได้โดยไม่กระทบผู้เรียก)\n');
});

/* ── ยอดคงเหลือชีทไลน์ปั๊มห้ามลงเป็นสต็อกที่ชื่อไลน์ผลิต (09/10 · user "เลขนั้นแค่บอกว่าผลิตได้เท่าไหร่ ไม่ได้บอกว่าของอยู่ไหน") ── */
test('🛡️ MonitoringUpload ต้องส่ง stockLocOf (refStockOf) ให้ monitoringToRecords', () => {
  const code = stripComments(readFileSync(join(ROOT, 'src/components/MonitoringUpload.jsx'), 'utf8'));
  assert.ok(/monitoringToRecords\([\s\S]*?stockLocOf[\s\S]*?\}\)/.test(code) && /refStockOf\(/.test(code),
    '\n\n❌ ตัวนำเข้า Monitoring ไม่ส่ง stockLocOf — BALANCE ชีทไลน์ปั๊มจะกลับไปลงเป็นสต็อกที่ชื่อไลน์ผลิต\n'
    + '   ผล: ยอดค้างที่ LINE A–D ไม่มีใครเบิก/รับ · จุดเรียกเติมที่อ้าง STORE ขึ้น "ยังเช็คไม่ได้" ทั้งที่ของเต็มสโตร์\n'
    + '   แก้: stockLocOf = (mat, line) => refStockOf(...) แบบ seedOnly (utils/partRefStock.js)\n');
});

/* ── 🔒 หน้า login ห้ามบอกว่า "อีเมลนี้มีบัญชีหรือไม่" (2026-10-12 · คำสั่ง user) ──────────
   เดิมแยกข้อความ "ไม่พบบัญชี" ออกจาก "รหัสผ่านผิด" ด้วย RPC `login_email_exists`
   ซึ่ง **grant ให้ `anon`** (จำเป็น เพราะใช้ก่อน login) ⇒ ใครก็ยิงไล่เดาได้ว่าอีเมลไหนมีบัญชี
   = account enumeration = ได้ลิสต์เป้าไปไล่ลองรหัสผ่าน (ระบบเปิดบนอินเทอร์เน็ตจริง
   Render + anon key ที่อ่านได้จากหน้าเว็บ) · ฟังก์ชันถูก drop แล้ว 12/10
   ⇒ ด่านนี้กันการเอากลับมา ไม่ว่าจะชื่อเดิมหรือ RPC ตัวใหม่ที่ทำหน้าที่เดียวกัน */
test('🛡️ login-no-email-oracle — ห้ามมีโค้ดถามว่าอีเมลนี้มีบัญชีอยู่ไหม', () => {
  const bad = [];
  const SUSPECT = /\b(login_email_exists|email_exists|account_exists|user_exists)\b/;
  for (const file of walk(join(ROOT, 'src'), ['.jsx', '.js'])) {
    const rel = relative(ROOT, file);
    if (rel.includes('__tests__')) continue;
    const code = stripComments(readFileSync(file, 'utf8'));   // พูดถึงในคอมเมนต์ได้ (อธิบายว่าทำไมถอด)
    code.split('\n').forEach((ln, i) => {
      const m = ln.match(SUSPECT);
      if (m) bad.push(`${rel}:${i + 1} — ${m[1]}`);
    });
  }
  assert.deepEqual(bad, [],
    '\n\n❌ เจอโค้ดที่ถามว่า "อีเมลนี้มีบัญชีไหม" กลับมาแล้ว\n'
    + '   ทำไมสำคัญ: หน้า login เปิดให้ anon ⇒ ตอบคำถามนี้ = ปล่อยให้คนนอกไล่เดาได้ว่า\n'
    + '             อีเมลไหนมีบัญชีในระบบ แล้วเอาไปไล่ลองรหัสผ่าน (account enumeration)\n'
    + '   แก้ยังไง: ใช้ข้อความรวม "อีเมลหรือรหัสผ่านไม่ถูกต้อง" + บอกทางออก (ติดต่อ admin)\n'
    + '             ห้ามแยก 2 กรณีนี้ ไม่ว่าจะด้วย RPC · ตาราง profiles · หรือ error ของ Auth\n\n'
    + bad.map(b => `   • ${b}`).join('\n') + '\n');
});

/* ── 📄 บันทึกต้นฉบับของใบ MO ต้องมีคนเขียนที่เดียว (2026-10-12 · คำสั่ง user) ─────────────
   `mtn_orders.snapshot` = เนื้อใบ ณ เวลาปิดใบ · เขียน **ครั้งเดียว** แล้วห้ามทับ
   (ทับได้ = บันทึกเปลี่ยนตามคนแก้ = หมดความเป็นบันทึก · ใบมีเลขที่เอกสารและเก็บตามอายุเอกสาร)
   ตัวเขียนเดียวคือ `saveMoSnapshot()` ซึ่งกันทับด้วย `.is('snapshot', null)` ที่ชั้น WHERE
   ⇒ ด่านนี้กันหน้าอื่น/โค้ดใหม่เขียนตรงๆ ข้ามด่านนั้น */
test('🛡️ mo-snapshot-single-writer — เขียน mtn_orders.snapshot ได้ที่ mtnMoSnapshot.js เท่านั้น', () => {
  const bad = [];
  for (const file of walk(join(ROOT, 'src'), ['.jsx', '.js'])) {
    const rel = relative(ROOT, file);
    if (rel.includes('__tests__') || rel === 'src/lib/mtnMoSnapshot.js') continue;
    const code = stripComments(readFileSync(file, 'utf8'));
    code.split('\n').forEach((ln, i) => {
      if (/\bsnapshot\s*:/.test(ln) && /mtn_order|moSnap|snapshot_at/.test(code)) {
        if (/\bsnapshot\s*:/.test(ln) && !/serializeMo|moFromSnapshot/.test(ln)) {
          bad.push(`${rel}:${i + 1} — ${ln.trim().slice(0, 90)}`);
        }
      }
    });
  }
  assert.deepEqual(bad, [],
    '\n\n❌ มีจุดเขียน `snapshot:` ของใบ MO นอก src/lib/mtnMoSnapshot.js\n'
    + '   ทำไมสำคัญ: บันทึกต้นฉบับต้องเขียนครั้งเดียวแล้วห้ามทับ — ตัวเขียนเดียวกันทับด้วย\n'
    + '             `.is(\'snapshot\', null)` · เขียนตรงๆ ที่อื่น = ข้ามด่านนั้น\n'
    + '   แก้ยังไง: เรียก `saveMoSnapshot(order)` จาก src/lib/mtnMoSnapshot.js\n\n'
    + bad.map(b => `   • ${b}`).join('\n') + '\n');});

/* ═══ 🗑️ ลบคำถาม LPA ต้องนับปลายทางก่อน + บอกขอบเขต (2026-10-12 · feedback หน้างาน) ═══
   เคสจริง: *"Layer ข้อ 22,23 หายไปครับ"* — 02/10 มีคนกด 🗑 ลบข้อ common 2 ข้อ (VISUAL/ANDON)
   ⇒ หายจากใบตรวจ **ทุกไลน์** ทันที (คนกดอยู่ในมุมมอง "ทุกไลน์" แต่ confirm เดิมไม่บอกว่าเป็นของส่วนรวม)
   `lpa_audit_answers` ไม่มี FK ⇒ คำตอบกำพร้า 2,444 แถว (17%) กระทบใบตรวจ 581 ใบ
   — ข้อมูลไม่หาย (มี question_text snapshot) แต่ใบเก่าแสดงไม่ครบ เพราะจอวาดจากลิสต์คำถามปัจจุบัน */
test('🛡️ lpa-question-delete-needs-refs — ลบ lpa_questions ต้องผ่านด่านนับปลายทาง', () => {
  const bad = walk(join(ROOT, 'src'), ['.js', '.jsx']).filter((f) => {
    const code = stripComments(readFileSync(f, 'utf8'));
    if (!/from\(['"]lpa_questions['"]\)[\s\S]{0,80}?\.delete\(\)/.test(code)) return false;
    return !/lpaQuestionBlockMessage/.test(code) || !/lpaDeleteConfirmText/.test(code);
  }).map(f => f.replace(ROOT + '/', ''));
  assert.deepEqual(bad, [],
    '\n\n❌ ลบ `lpa_questions` โดยไม่มีด่านนับปลายทาง/ไม่บอกขอบเขต: ' + bad.join(', ') + '\n'
    + '   ทำไมผิด: ข้อ common (line_name ว่าง) = ของส่วนรวม ลบทีเดียวหายทุกไลน์\n'
    + '            และคำตอบเก่าใน lpa_audit_answers ไม่มี FK ⇒ กลายเป็นกำพร้า ใบย้อนหลังอ่านไม่ครบ\n'
    + '   แก้ยังไง: นับก่อนถาม → lpaQuestionBlockMessage(q, await loadLpaQuestionRefs(supabase, q.id))\n'
    + '            มีคนใช้อยู่ = ไม่ลบ ให้ "⏸ ปิดใช้งาน" แทน · ลบได้ค่อย confirm ด้วย lpaDeleteConfirmText(q)\n'
    + '            (src/utils/lpaQuestionRefs.js)\n');
});

/* ใบตรวจ LPA ที่บันทึกแล้ว = **บันทึก** ไม่ใช่ใบที่ generate ใหม่ (กฎเดียวกับฟอร์มที่ยื่นออกไปแล้ว)
   ⇒ ต้องวาด/เขียนกลับ "ข้อที่ถูกถอดออกจากเช็คลิสต์ไปแล้ว" ด้วย ไม่งั้น:
     (ก) ใบเก่าแสดงไม่ครบ  (ข) แค่กดบันทึกซ้ำ คำตอบของข้อที่ถูกลบจะหายถาวร (delete-then-insert) */
test('🛡️ lpa-audit-keeps-removed-answers — ใบตรวจต้องพกคำตอบของข้อที่ถูกถอดออกไปแล้ว', () => {
  const f = join(ROOT, 'src/pages/LayerProcessAudit.jsx');
  const code = stripComments(readFileSync(f, 'utf8'));
  assert.ok(/savedOnlyAnswers\(/.test(code),
    '\n\n❌ LayerProcessAudit ไม่เรียก savedOnlyAnswers — ข้อที่ถูกลบ/ปิดใช้ทีหลังจะหายจากใบย้อนหลัง\n');
  assert.ok(/question_text:\s*a\.question_text/.test(code) || /text:\s*a\.question_text/.test(code),
    '\n\n❌ ตอนโหลดใบเก่าไม่ได้พก question_text (snapshot) มาด้วย ⇒ ข้อที่ถูกลบจะไม่มีข้อความให้แสดง\n');
  assert.ok(/removedAnswers\.map\(/.test(code),
    '\n\n❌ saveAudit ไม่ได้เขียนคำตอบของข้อที่ถูกถอดออกกลับลงฐาน ⇒ กดบันทึกซ้ำ = ข้อมูลหายรอบสอง\n');
});

/* ═══ ไลน์เครื่องขนาน — นาที downtime ต้องหารจำนวนเลนก่อนเป็นน้ำหนัก wLoad (2026-10-12) ═══
   ที่มา: recheck ใบ OEE/Defect PD3+PD4 ก.ย. 2026 เทียบกับระบบ — %A/%Q ตรง แต่ OEE เดือนของ
   LASER-345 ต่ำกว่าที่ควร เพราะ `dtMinBySession` รวมนาที DT **รายเครื่อง** (3 เครื่อง) มาหัก
   จากเวลากะเดียว ⇒ plannedMin ทะลุความยาวกะ ⇒ `wLoad = max(0, …)` เหลือ 0
   ⇒ **กะนั้นถูกตัดออกจากค่าเฉลี่ยโดยไม่มี error** (ก.ย. 2026: 11 กะน้ำหนัก 0 · LASER-345 22/37 กะ
   โดนลดน้ำหนักเกินครึ่ง ⇒ OEE เดือน 82.9% → 80.6% แล้วถูก export เป็นฟอร์มไปเซ็น)
   `computeSessionOee` หาร 1/N ถูกมาตั้งแต่แรก — ที่พังคือ "ตัวถ่วงน้ำหนัก" เท่านั้น */
test('🛡️ dt-by-session-needs-lines — ทุกการเรียก dtMinBySession ต้องส่งทะเบียนไลน์ { lines }', () => {
  const bad = [];
  for (const file of walk(join(ROOT, 'src'), ['.js', '.jsx'])) {
    const rel = relative(ROOT, file);
    if (rel.includes('__tests__') || rel === 'src/utils/oee.js') continue;
    const code = stripComments(readFileSync(file, 'utf8'));
    let m; const re = /dtMinBySession\s*\(/g;
    while ((m = re.exec(code))) {
      // อ่านอาร์กิวเมนต์จนวงเล็บปิด (รองรับวงเล็บซ้อน เช่น `brk.data || []`)
      let i = m.index + m[0].length, depth = 1;
      while (i < code.length && depth > 0) { const c = code[i++]; if (c === '(') depth++; else if (c === ')') depth--; }
      const args = code.slice(m.index + m[0].length, i - 1);
      if (!/\blines\b/.test(args)) bad.push(`${rel}:${code.slice(0, m.index).split('\n').length}`);
    }
  }
  assert.deepEqual(bad, [],
    '\n\n❌ จุดด้านล่างเรียก dtMinBySession โดยไม่ส่ง { lines } (ทะเบียนไลน์)\n'
    + '   ทำไมห้าม: ไลน์เครื่องขนาน (LASER-345/789 = 3 เครื่อง · SUB APRON = 6 สถานี) บันทึก downtime\n'
    + '   **รายเครื่อง** ⇒ ผลรวมนาทีของกะเดียวทะลุความยาวกะได้ตามปกติ (วัดจริง 09/09/2026: 1,025 น. บนกะ 720 น.)\n'
    + '   ไม่หารเลนก่อน ⇒ wLoad = shift_min − plannedMin เหลือ 0 = กะนั้นหายจากค่าเฉลี่ยเงียบๆ\n'
    + '   แก้ยังไง: dtMinBySession(sessions, downtimes, breakPolicies, { lines })\n'
    + '             `lines` รับได้ทั้งอาร์เรย์ทะเบียนไลน์ และแมป { [ชื่อไลน์]: แถว } (oee.js §3.2)\n\n'
    + bad.map(b => '   • ' + b).join('\n') + '\n');
});

/* ═══ ทุกการ "อนุมัติ/เซ็น" ใบ MO ต้องถามยืนยันก่อนเขียน (2026-10-28 · คำสั่ง user) ═══
   user: *"ทุกการกดอนุมัติ ของ mo ต้องมีการยืนยันก่อนนะ อันนี้กดพลาดคือพลาดเลย"*
   ลายเซ็นบนใบ MO เป็น one-way — เซ็นแล้วเจ้าตัวแก้เองไม่ได้ ต้องให้ผู้ถือสิทธิ์แก้ย้อนหลังมาปลด
   และใบเดินไปขั้นถัดไปทันที · ปุ่มเซ็นอยู่ติดปุ่มอื่นในใบ กดพลาดบนแท็บเล็ตหน้างานง่ายมาก */
test('🛡️ print-digit-grid-no-default — ช่องตัวเลขทีละหลักบนใบพิมพ์ ห้ามมีความยาว default', () => {
  const src = readFileSync(join(ROOT, 'src/pages/MtnRepair.jsx'), 'utf8');

  /* 🔴 เคสจริง (30/10 หน้างานแจ้ง "IO ขึ้นแค่ 11 ตัว ปกติมี 12"):
     `grid = (v, n = 11)` ⇒ ตอนแก้ I/O เป็น 12 แก้แต่ call site · default ยังค้าง 11
     = ผู้เรียกรายต่อไปได้ความยาวที่ไม่มีใครเลือก (02/11) */
  assert.ok(!/const grid = \(v, n = \d/.test(src),
    '\n\n❌ `grid()` กลับมามีความยาว default แล้ว\n'
    + '   ⇒ ช่องใหม่ที่ลืมส่งจำนวนหลัก จะถูกวาดด้วยเลขที่ไม่มีใครเลือก แล้วไม่มีอะไรบอก\n'
    + '   แก้ยังไง: บังคับส่ง `n` + ประกาศเป็นค่าคงที่ (IO_DIGITS / PR_NO_DIGITS)\n');

  /* ค่าที่ยาวกว่าจำนวนช่อง ต้อง "งอกช่องเพิ่ม" ไม่ใช่ตัดทิ้ง — ใบพิมพ์ที่ตัวเลขหายไปเงียบๆ เชื่อไม่ได้
     กลไกอยู่ที่ `moGridChars()` (utils/mtnMoForm.js) ⇒ หน้าต้องวาดผ่านตัวนั้น ห้าม loop เองในหน้า */
  assert.ok(/moGridChars\(/.test(src),
    '\n\n❌ ใบพิมพ์เลิกวาดกริดผ่าน `moGridChars()` แล้ว\n'
    + '   ⇒ กลับไป loop ตามจำนวนช่องที่ฝังไว้ = ค่าที่ยาวกว่าถูกตัดทิ้งเงียบ (เคสจริง 03/11 "PR ขึ้นเกิน")\n');
  const form = readFileSync(join(ROOT, 'src/utils/mtnMoForm.js'), 'utf8');
  assert.ok(/Math\.max\(Number\(n\)/.test(form),
    '\n\n❌ `moGridChars()` เลิกงอกช่องตามความยาวค่าจริงแล้ว — ตัวเลขที่ยาวกว่าจะหายจากกระดาษ\n');

  /* ทุก call site ต้องส่งค่าคงที่ ไม่ใช่เลขดิบ */
  const calls = src.match(/\bgrid\([^)]*\)/g) || [];
  for (const c of calls) {
    if (/^grid\(v, n\)/.test(c)) continue;                 // ตัวประกาศเอง
    assert.ok(/_DIGITS\s*\)/.test(c),
      `\n\n❌ \`${c}\` ส่งจำนวนหลักเป็นเลขดิบ (หรือไม่ส่ง)\n`
      + '   ⇒ เลขความยาวกระจายหลายที่ แก้ไม่ครบแล้วใบพิมพ์ไม่ตรงของจริง\n'
      + '   แก้ยังไง: ประกาศค่าคงที่ `<ชื่อ>_DIGITS` ไว้หัวไฟล์ แล้วส่งตัวนั้น\n');
  }
});

test('🛡️ pr-order-vs-receive-split — "รอสั่ง" กับ "รอของ" ต้องแยกถัง ห้ามยุบกลับ', () => {
  const src = readFileSync(join(ROOT, 'src/utils/mtnPurchase.js'), 'utf8');

  /* 🔴 เคสจริง (04/11 · หน้างานแจ้ง): *"พอกรอกเลข PR มันเด้งข้ามไปหัวข้อ 3 เลย …
     มันต้องอยู่ช่องที่ 2 ก่อน พอใส่เลข PO แล้วถึงเด้งลงช่องที่ 3"*
     ถังเดิมชื่อ "รอสั่ง/รอของ" = ยัด 2 ขั้นรวมกัน ⇒ กรอกเลข PR ปุ๊บใบไปอยู่ขั้นสุดท้าย
     ทั้งที่ยังไม่ได้สั่งซื้อ (วัด 04/11: 2 ใบ requested มีเลข PR แต่ยังไม่มี PO นั่งอยู่ถังนั้น) */
  const i = src.indexOf('export function prQueueStateOf');
  const body = src.slice(i, i + 900);
  /* 🔴 คง 3 ถังตามที่ทีม MTN สั่ง (02/11 "จริงๆควรมีแค่ 3 Filter") — เพิ่มถังที่ 4 = ขัดคำสั่ง */
  assert.equal(Object.keys({ need: 1, no_no: 1, open: 1 }).length, (src.match(/^\s{2}(need|no_no|open):/gm) || []).length,
    '\n\n❌ `PR_QUEUE_META` ไม่ใช่ 3 ขั้น need/no_no/open แล้ว\n'
    + '   ทีม MTN สั่งไว้ 02/11: "จริงๆควรมีแค่ 3 Filter" — เพิ่มถังที่ 4 = ขัดคำสั่ง\n');

  assert.ok(/normalizePrNo\(p\.po_no\)/.test(body),
    '\n\n❌ `prQueueStateOf` เลิกดูเลข PO แล้ว\n'
    + '   🔴 ต้องตัดสินจาก **เลข PO** ไม่ใช่ `status` อย่างเดียว — สถานะ `ordered` ที่เลข PO ยังว่าง\n'
    + '      ยังไม่ใช่ "สั่งแล้ว" (เลขมาจาก SAP ทีหลัง เหมือน `pr_no`)\n');
});

test('🛡️ mo-open-rows-not-capped-by-recency — ใบที่ยังไม่ปิดต้องโหลดครบ ห้ามพึ่งหน้าต่างล่าสุด', () => {
  const src = readFileSync(join(ROOT, 'src/pages/MtnRepair.jsx'), 'utf8');

  /* 🔴 เคสจริง 05/11 (หน้างาน): *"ทำไมบอกมีงาน กดเข้าไปไม่เจออะไรเลย"*
     หน้าโหลดชุดเดียว `order(report_at desc).limit(1000)` · ทั้งตาราง 1,616 ใบ
     ⇒ หน้าต่างจบที่ 06/10 · 618 ใบเก่าไม่เคยถูกโหลด (เป็นใบยังไม่ปิด 47 ใบ)
     แต่กระดิ่ง/คิวนับจากชุดเต็ม ⇒ ป้ายบอก "รอคุณเซ็น 27 ใบ" กดแล้วลิสต์ 0 รายการ
     🔑 ขยายกรอบวันที่ช่วยไม่ได้ — แถวไม่เคยถูกขอมาตั้งแต่ต้น */
  assert.ok(/not\('status',\s*'in',/.test(src),
    '\n\n❌ หน้ารายการ MO เลิกยิงคิวรี "ใบที่ยังไม่ปิด" แยกแล้ว\n'
    + '   ⇒ กลับไปพึ่งหน้าต่าง "N ใบล่าสุด" ใบเดียว = ใบค้างที่เก่ากว่านั้นหายจากจอเงียบๆ\n'
    + '   ⇒ กระดิ่งบอกว่ามีงาน กดเข้าไปจอว่าง (ขยายกรอบวันที่ไม่ช่วย แถวไม่เคยถูกขอมา)\n');

  assert.ok(/MO_DONE_STATUSES\.join\(/.test(src),
    '\n\n❌ คิวรี "ใบที่ยังไม่ปิด" ไม่ได้อ่านชุดสถานะจาก `MO_DONE_STATUSES`\n'
    + '   ⇒ รายชื่อสถานะถูกพิมพ์ซ้ำ 2 ที่ แล้วหลุดจากกันเงียบๆ (เพิ่มสถานะใหม่ = ลิสต์เพี้ยน)\n');

  /* ชุดนี้ล้ม/ชนเพดาน = ใบค้างหาย ⇒ ต้องเขียนบนจอ */
  assert.ok(/openLoadErr/.test(src) && /openCapped/.test(src),
    '\n\n❌ ไม่ได้บอกบนจอเมื่อชุด "ใบที่ยังไม่ปิด" ล้มหรือชนเพดาน\n'
    + '   "ไม่มีรายการ" ทั้งที่คิวรีล่ม = จอโกหก (ห้ามล้มเหลวเงียบ)\n');
});

test('🛡️ mo-scope-unknown-line-falls-back — ไลน์ที่ทะเบียนไม่รู้จัก ห้ามตัดใบทิ้ง', () => {
  const src = readFileSync(join(ROOT, 'src/pages/MtnRepair.jsx'), 'utf8');
  const i = src.indexOf("key: 'scope', label: 'ขอบเขตไลน์ของคุณ'");
  assert.ok(i > 0, '\n\n❌ หาด่านขอบเขตไลน์ใน baseFilters ไม่เจอ\n');
  const body = src.slice(Math.max(0, i - 200), i + 900);

  /* 🔴 เคสจริง 05/11 (หน้างาน): *"ทำไมบอกมีงาน กดเข้าไปไม่เจออะไรเลย"*
     กระดิ่ง/คิวตัดสินขอบเขตด้วย `dept_section` (scopeStateOf) · หน้านี้ตัดสินด้วย `line_name`
     เทียบทะเบียนตรงตัว ⇒ ใบ PD4 ที่เขียนชื่อไลน์ `Assy GOR`/`Laser LWR` (ทะเบียนชื่อ
     `GOR ASSY`/`LWRBAR LASER`) ถูกตัดทิ้ง 68 ใบ ทั้งที่อยู่ในขอบเขตของคนกด */
  assert.ok(/knownLineNames\.has\(/.test(body),
    '\n\n❌ ด่านขอบเขตกลับไปเทียบชื่อไลน์กับทะเบียนตรงตัวโดยไม่ถามว่า "ทะเบียนรู้จักไลน์นี้ไหม"\n'
    + '   ⇒ ใบที่ชื่อไลน์ไม่ตรงทะเบียน ถูกตัดทิ้งทั้งที่เป็นใบของหน่วยงานเรา\n'
    + '   ⇒ กระดิ่งบอกว่ามีงาน กดเข้าไปจอว่าง (คลาสเดียวกับ orderInReporterScope 02/11)\n');
  assert.ok(/dept_section/.test(body),
    '\n\n❌ ไลน์ที่ทะเบียนไม่รู้จัก ไม่ได้ถอยไปดู `dept_section`\n'
    + '   🔑 คิวตัดสินด้วยแกนนั้น — 2 แกนต้องให้คำตอบเดียวกัน ไม่งั้นป้ายกับลิสต์ขัดกันเสมอ\n');
});

test('🛡️ ojt-approver-self-sign-only — ช่องลายเซ็นหัวใบ OJT ต้องเซ็นเอง ห้ามแปะของคนอื่น', () => {
  const src = readFileSync(join(ROOT, 'src/pages/OjtTraining.jsx'), 'utf8');

  /* 🔴 เคสจริง: เดิมช่องพวกนี้เป็น PersonSelect — ใครแก้ใบได้ เลือกชื่อคนจาก profiles
     แล้วดึง `signature_url` ของคนนั้นมาแปะ (วัด 02/11: 74 ใบ · 61 ใบที่ผู้อนุมัติ ≠ คนสร้างใบ)
     กฎของโมดูลนี้ห้ามอยู่แล้ว (28/10): "ลายเซ็นที่เก็บไว้แล้วเอามาแปะ = ตรายาง ไม่ใช่การลงนาม"
     · 02/11 ปิดช่อง "ระดับจัดการอนุมัติ" · 05/11 ปิดช่อง "ผู้รับทราบ" (คำสั่ง user "hr เซ็นเองด้วย") */
  for (const label of ['ระดับจัดการอนุมัติ', 'ผู้รับทราบ']) {
    assert.ok(!new RegExp(`sigPicker\\(\\s*'${label}'`).test(src),
      `\n\n❌ ช่อง "${label}" กลับไปเป็น picker เลือกคนอื่นแล้ว\n`
      + '   ⇒ ธุรการเลือกชื่อคน แล้วลายเซ็นประจำตัวของคนนั้นถูกแปะลงใบ\n'
      + '   แก้ยังไง: ปุ่มที่เขียนชื่อ+uid+เวลา **ของคนที่ล็อกอินอยู่** เท่านั้น (`signSelfOjt`)\n');
  }

  /* ตัวบันทึกใบ (ธุรการ) ต้องเขียนช่องลายเซ็นพวกนี้ไม่ได้ */
  for (const k of ['approver_name', 'hr_name']) {
    assert.ok(!new RegExp(`${k}:\\s*editing\\.${k}`).test(src),
      `\n\n❌ payload ของ \`handleSave\` กลับมาเขียน \`${k}\` แล้ว\n`
      + '   ⇒ ใครที่แก้ใบได้ ก็เขียนช่องลายเซ็นได้ตามเดิม (ด่านที่ปุ่มไม่มีความหมาย)\n');
  }

  /* ตัวเซ็นต้อง: ถามยืนยัน → เขียน uid ของคนกด → นับแถว (RLS ปฏิเสธ = 0 แถว ไม่มี error) */
  const i = src.indexOf('const signSelfOjt = async');
  assert.ok(i > 0, '\n\n❌ หา `signSelfOjt` ไม่เจอ — เปลี่ยนชื่อแล้วต้องแก้ด่านนี้ด้วย\n');
  const body = src.slice(i, i + 2200);
  const cAt = body.indexOf('confirmSign('), uAt = body.indexOf('.update(');
  assert.ok(cAt > 0 && uAt > 0 && cAt < uAt,
    '\n\n❌ `signSelfOjt` เขียน DB โดยไม่ถามยืนยันก่อน (ลายเซ็นเป็น one-way)\n');
  assert.ok(/\[S\.uidKey\]:\s*user\.id/.test(body),
    '\n\n❌ ไม่ได้เขียน uid ของคนที่ล็อกอิน\n'
    + '   ⇒ กลับไปเป็นลายเซ็นที่ตรวจย้อนไม่ได้ว่าใครกด (เดิม 67 จาก 74 ใบเป็นแบบนั้น)\n');
  assert.ok(/checkWriteRows\(/.test(body),
    '\n\n❌ ไม่ได้นับแถวที่เขียนจริง — RLS ปฏิเสธ UPDATE = "สำเร็จ 0 แถว ไม่มี error"\n'
    + '   ⇒ จอขึ้น "เซ็นแล้ว" ทั้งที่ฐานไม่มีอะไรเปลี่ยน (กฎเขียน DB ข้อ 2)\n');
  assert.ok(/MANAGER_SIGN_MIN_RANK/.test(src),
    '\n\n❌ ไม่เช็คระดับตำแหน่ง — ต้องใช้ค่าจาก `utils/signRank.js` ห้ามเขียนเลขเองในหน้า\n');

  /* 🔴 ด่านของ 2 ช่องไม่เท่ากัน — อนุมัติ = การตัดสินใจ (ตำแหน่ง+ขอบเขต) ·
     รับทราบ = การลงนามรับรู้ (HR เป็นหน่วยกลาง ใบอยู่คนละส่วนงานเสมอ ⇒ ใส่ด่านขอบเขต = ไม่มีใครเซ็นได้) */
  assert.ok(/gated:\s*true/.test(src) && /gated:\s*false/.test(src),
    '\n\n❌ ทะเบียน `SELF_SIGN` ไม่แยก `gated` แล้ว\n'
    + '   🔴 ใส่ด่านตำแหน่ง/ขอบเขตให้ช่อง "ผู้รับทราบ" = HR เซ็นใบของส่วนงานผลิตไม่ได้เลย\n'
    + '   🔴 ถอดด่านออกจากช่อง "อนุมัติ" = ใครก็อนุมัติได้ (เคสจริง 30/10)\n');

  /* ลายเซ็นเดิมที่ไม่มี uid = ของก่อนเปลี่ยนกฎ ⇒ จอต้องเขียนบอก ห้ามแสดงเป็นการลงนามที่ยืนยันแล้ว */
  assert.ok(/!editing\[S\.uidKey\]/.test(src) && /ลายเซ็นเดิม/.test(src),
    '\n\n❌ จอไม่แยก "ลายเซ็นเดิมที่ไม่ทราบผู้กด" ออกจากการลงนามที่ยืนยันแล้ว\n'
    + '   ใบเก่ามีภาพลายเซ็นแต่ไม่มี uid/เวลา — แสดงเป็นปกติ = จอโกหก\n');
});


test('🛡️ approve-needs-confirm-4m — ปุ่มอนุมัติ 4M (SV) ต้องถามยืนยันก่อนเขียน DB', () => {
  const src = readFileSync(join(ROOT, 'src/pages/Report.jsx'), 'utf8');
  const i = src.indexOf('const handleApprove = async');
  assert.ok(i > 0, '\n\n❌ หา `handleApprove` ใน Report.jsx ไม่เจอ — เปลี่ยนชื่อแล้วต้องแก้ด่านนี้ด้วย\n');
  const body = src.slice(i, i + 3000);

  /* 🔴 คลาสเดียวกับใบ MO (02/11 · คำสั่ง user "มุม systemic ไม่ควรจะเกิดปัญหาเดิมๆ กับจุดอื่น")
     เขียน sv_approved_by = ชื่อคนกดขึ้นใบ + compare-and-swap ⇒ กดคืนเองไม่ได้
     + แจ้งเตือนยิงออกทันทีที่สถานะเปลี่ยน ⇒ ถอนเงียบไม่ได้ */
  const cAt = body.indexOf('confirmSign('), uAt = body.indexOf('.update(');
  assert.ok(cAt > 0 && uAt > 0 && cAt < uAt,
    '\n\n❌ `handleApprove` (อนุมัติ 4M) เขียน DB โดยไม่ถามยืนยันก่อน\n'
    + '   ทำไมห้าม: ชื่อคนกดไปอยู่บนใบ · compare-and-swap = กดคืนเองไม่ได้ ต้องให้คนตีกลับ\n'
    + '   แก้ยังไง: `if (!confirmSign({ what, docLabel, orderNo, actor, as, effect })) return;`\n'
    + '   ⚠️ ขั้น QA ไม่ต้องถามซ้ำ (มี modal แนบรูป) · ตีกลับไม่ต้อง (ต้องพิมพ์เหตุผล)\n');

  /* ของกลางต้องเป็นตัวเดียวกับที่ใบ MO ใช้ — ห้ามเขียนข้อความยืนยันเองในหน้า */
  assert.ok(/from '\.\.\/utils\/signConfirm'/.test(src),
    '\n\n❌ `Report.jsx` ไม่ได้ใช้ของกลาง `utils/signConfirm.js`\n'
    + '   ข้อความยืนยันต้องบอกครบ 3 อย่างเสมอ (อนุมัติอะไร · ใบไหน · ในนามใคร) — ห้ามเขียนเองในหน้า\n');
});

test('🛡️ mtn-approve-needs-confirm — ปุ่มเซ็น/อนุมัติใบ MO ต้องผ่าน confirmSign() ก่อนเขียน DB', () => {
  const src = readFileSync(join(ROOT, 'src/pages/MtnRepair.jsx'), 'utf8');

  /* ① ปุ่ม "อนุมัติใบ MO (ผู้จัดการ…)" — confirm ต้องมาก่อน update() ในฟังก์ชันเดียวกัน */
  const i = src.indexOf('const signApproval = async');
  assert.ok(i > 0, '\n\n❌ หา `signApproval` ใน MtnRepair.jsx ไม่เจอ — ถ้าเปลี่ยนชื่อ ให้แก้ด่านนี้ด้วย\n');
  const body = src.slice(i, i + 3000);
  const cAt = body.indexOf('confirmSign('), uAt = body.indexOf(".update(");
  assert.ok(cAt > 0 && uAt > 0 && cAt < uAt,
    '\n\n❌ `signApproval` เขียน DB โดยไม่ถามยืนยันก่อน (หรือถามหลังเขียนไปแล้ว)\n'
    + '   ทำไมห้าม: ลายเซ็นผู้จัดการเป็น one-way — เซ็นพลาดแล้วเจ้าตัวปลดเองไม่ได้\n'
    + '   แก้ยังไง: `if (!confirmSign({ what, orderNo, actor, as })) return;` ก่อน `.update(`\n');

  /* ② ขั้นที่เป็นการเซ็น/อนุมัติใน StepModal — ต้องถามผ่านทะเบียน stage ไม่ใช่ไล่เช็คเลขขั้นเอง */
  assert.ok(/needsSignConfirm\s*\(/.test(src) && /confirmSign\s*\(/.test(src),
    '\n\n❌ StepModal ไม่ได้ถามยืนยันก่อนเซ็นขั้น\n'
    + '   แก้ยังไง: `needsSignConfirm(stageOf(step, …))` แล้ว `confirmSign({ … })` ก่อนประกอบ payload\n');

  /* ③ ห้ามเขียนข้อความยืนยันเองในหน้า — ต้องบอกครบ 3 อย่าง (เซ็นอะไร · ใบไหน · ในนามใคร)
        จึงบังคับให้ผ่าน utils/signConfirm.js จุดเดียว */
  const conf = readFileSync(join(ROOT, 'src/utils/signConfirm.js'), 'utf8');
  for (const k of ['what', 'orderNo', 'actor']) {
    assert.ok(new RegExp(`signConfirmText[\\s\\S]{0,800}?\\b${k}\\b`).test(conf),
      `\n\n❌ \`signConfirmText\` ไม่ได้บอก \`${k}\` แล้ว — ข้อความยืนยันต้องบอกครบ "เซ็นอะไร · ใบไหน · ในนามใคร"\n`
      + '   ถามยืนยันลอยๆ = คนกด OK ผ่านโดยไม่อ่าน (UI-CONVENTIONS §5.4)\n');
  }

  /* ④ ห้ามลากการ "กรอกงาน" เข้ามาถามด้วย — ถามพร่ำเพรื่อแล้วคนกดผ่านโดยไม่อ่าน */
  const stages = conf.slice(conf.indexOf('SIGN_STAGES'), conf.indexOf('needsSignConfirm'));
  for (const bad of ['assign', 'service']) {
    assert.ok(!new RegExp(`'${bad}'`).test(stages),
      `\n\n❌ \`SIGN_STAGES\` มี '${bad}' ซึ่งเป็น "การกรอกงาน" ไม่ใช่การอนุมัติ\n`
      + '   (จ่ายงาน/ลงผลซ่อม ช่างทำวันละหลายรอบ — ถามทุกครั้ง = คนกดผ่านจนด่านจริงไม่มีความหมาย)\n');
  }
});

/* ═══ 🔒 ช่อง "ผู้จัดการ…" ในใบ MO ต้องเช็คระดับตำแหน่ง (2026-10-30 · หน้างานแจ้ง) ═══
   *"มีคนอนุมัติแทนพี่แล้ว"* — วิศวกร (`engineer` = 30) เซ็นช่อง "ผู้จัดการต้นสังกัด" แทนเจ้าตัวได้
   เพราะด่านเดิมเช็คแค่ `can('approve')` **ไม่ดูตำแหน่งเลย** และ `signApproval` เขียนชื่อคนกด
   ทับชื่อที่ระบุไว้ ⇒ เจ้าตัวโดนตัดสิทธิ์ (`already_signed`) แก้เองไม่ได้
   🔴 ด่านตำแหน่งต้องมาก่อนทาง `named` ด้วย — ผู้แจ้งพิมพ์ชื่อใครลงช่องนั้นก็ได้ รวมชื่อตัวเอง */
test('🛡️ reporter-scope-known-unit — ด่านขอบเขตต้องมี "รู้จักหน่วยนี้ไหม" ครบทั้ง 2 แกน', () => {
  const src = readFileSync(join(ROOT, 'src/utils/mtnStepPerm.js'), 'utf8');
  const i = src.indexOf('export function orderInReporterScope');
  assert.ok(i > 0, '\n\n❌ หา `orderInReporterScope` ไม่เจอ — เปลี่ยนชื่อแล้วต้องแก้ด่านนี้ด้วย\n');
  const body = src.slice(i, i + 1600);

  /* 🔴 ฝั่งไลน์มีด่าน `knownLineNames` มาตั้งแต่แรก แต่ฝั่งส่วนงานไม่มี (02/11)
     ⇒ เอาชื่อ **แผนก** ไปเทียบลิสต์ **ส่วนงาน** แล้วตอบ false = บล็อกผิด
     เคสจริง: JIG MTN เป็น department ใต้ PD4 ⇒ ผู้จัดการที่ดูแลควบ PD3+PD4 เซ็นใบนั้นไม่ได้ */
  assert.ok(/knownSections/.test(body),
    '\n\n❌ `orderInReporterScope` เลิกเช็ค `knownSections` แล้ว\n'
    + '   ⇒ ใบที่ `dept_section` เป็นชื่อ **แผนก/ทีม** (ไม่ใช่ส่วนงาน) จะถูกตัดสินว่า "ของหน่วยอื่น"\n'
    + '   🔴 JIG MTN = department ใต้ PD4 — คนที่ดูแลควบแผนกครอบอยู่แล้วตามผัง แต่สตริงไม่ตรง\n'
    + '   แก้ยังไง: หน่วยที่ไม่อยู่ในทะเบียนส่วนงาน = คืน `null` (ไม่รู้ = ไม่บล็อก)\n');

  /* หน้าที่เรียกต้องส่งทะเบียนมาจริง ไม่ใช่มีพารามิเตอร์ลอยไว้ */
  const page = readFileSync(join(ROOT, 'src/pages/MtnRepair.jsx'), 'utf8');
  assert.ok(/knownSections:\s*\[/.test(page),
    '\n\n❌ `MtnRepair.jsx` ไม่ส่ง `knownSections` ใน `reporterScope` แล้ว\n'
    + '   ⇒ ด่านถอยไปใช้พฤติกรรมเดิม = บล็อกใบของแผนกที่อยู่ใต้ส่วนงานที่เราดูแล\n');
});

test('🛡️ mtn-approval-needs-rank — ช่องผู้จัดการในใบ MO ต้องกันตำแหน่งที่ต่ำกว่าเกณฑ์', () => {
  const src = readFileSync(join(ROOT, 'src/utils/mtnStepPerm.js'), 'utf8');
  const i = src.indexOf('export function canSignMtnApproval');
  assert.ok(i > 0, '\n\n❌ หา `canSignMtnApproval` ไม่เจอ — เปลี่ยนชื่อแล้วต้องแก้ด่านนี้ด้วย\n');
  const body = src.slice(i, i + 2600);

  assert.ok(/posRank/.test(body) && /rank_too_low/.test(body),
    '\n\n❌ `canSignMtnApproval` เลิกเช็คตำแหน่งแล้ว\n'
    + '   ⇒ ใครถือ `mtn_repair:approve` ก็เซ็นช่อง "ผู้จัดการต้นสังกัด" แทนเจ้าตัวได้อีก\n'
    + '   แก้ยังไง: เช็ค `posRank < APPROVAL_MIN_RANK` ก่อนคืน ok\n');

  /* ลำดับสำคัญ: ด่านตำแหน่งต้องอยู่ "ก่อน" ทางผ่านด้วยชื่อ (named) และสิทธิ์ (can) */
  const rankAt = body.indexOf('rank_too_low');
  const namedAt = body.indexOf("code: 'named'");
  const canAt = body.indexOf("code: 'approve'");
  assert.ok(rankAt > 0 && rankAt < namedAt && rankAt < canAt,
    '\n\n❌ ด่านตำแหน่งถูกย้ายไปอยู่หลังทาง `named`/`approve`\n'
    + '   ⇒ ผู้แจ้งพิมพ์ชื่อตัวเองลงช่อง "ผู้จัดการต้นสังกัด" แล้วเซ็นเองได้ (เคสจริง 30/10)\n');

  /* 🔴 ชั้น ③ ขอบเขตหน่วยงาน — "ผู้จัดการ**ต้นสังกัด**" ตามนิยามคือฝั่งผู้แจ้ง
     audit ชั้น ③ รอบ 15/10 ไม่ได้ครอบด่านนี้ (`canDoStep` มี · ตัวนี้ไม่มี) */
  assert.ok(/inReporterScope\s*===\s*false/.test(body) && /out_of_scope/.test(body),
    '\n\n❌ `canSignMtnApproval` เลิกเช็คขอบเขตหน่วยงานแล้ว\n'
    + '   ⇒ หัวหน้าแผนกของส่วนงานหนึ่ง เซ็นช่อง "ผู้จัดการต้นสังกัด" ของใบส่วนงานอื่นได้\n'
    + '   🔴 `null` (ตัดสินไม่ได้) ต้องไม่บล็อก — คนดูแลควบแผนกผ่านทาง sections/resp_cost_centers\n');

  /* 🔴 เกณฑ์ = "หัวหน้าแผนกขึ้นไป" (50) ไม่ใช่ "ผู้จัดการ" (60)
     ⚠️ ห้ามยกเป็น 60 โดยไม่พิสูจน์กับทะเบียนผู้ใช้จริงก่อน (CLAUDE.md 26/10)
     — นับความครอบคลุมต้องกาง `sections`/`resp_cost_centers` ไม่ใช่ `section` เดี่ยว */
  assert.ok(/APPROVAL_MIN_RANK\s*=\s*MANAGER_SIGN_MIN_RANK\b/.test(src),
    '\n\n❌ `APPROVAL_MIN_RANK` ไม่ได้อ้างแหล่งเดียว (`utils/signRank.js`) แล้ว\n'
    + '   ⇒ ใบ MO กับใบอบรม OJT ใช้เกณฑ์ตำแหน่งต่างกันได้เงียบๆ\n');
  const rankSrc = readFileSync(join(ROOT, 'src/utils/signRank.js'), 'utf8');
  assert.ok(/MANAGER_SIGN_MIN_RANK\s*=\s*50\b/.test(rankSrc),
    '\n\n❌ `MANAGER_SIGN_MIN_RANK` ไม่ใช่ 50 แล้ว\n'
    + '   ยกเกณฑ์ = ต้องพิสูจน์กับทะเบียนผู้ใช้จริงก่อน merge (CLAUDE.md 26/10)\n'
    + '   ถ้าจะเปลี่ยน ต้องพิสูจน์กับทะเบียน `profiles` จริงก่อน (กฎ CLAUDE.md 26/10)\n');
});

/* ═══ 🏭 ตัวตนเครื่องนอกทะเบียน ต้องผูก "สายไลน์" (2026-10-30 · คำสั่ง user) ═══
   user: *"conveyor ที่ 306 มันก็คนละตัวกับ conveyor 297 มันแยกส่วนงาน แยกไลน์ แยกแผนก
   ต้องดูผังองค์กรด้วย มันต้องลิ้งกันมั้ย"*
   `machine_no` เป็นข้อความ**ระดับทั้งโรงงาน** ⇒ จัดกลุ่มด้วยข้อความล้วน = "CONVEYOR" ของ
   สาย HYDROFORM (PD3) กับสาย LWR BAR (PD4) ถูกนับเป็นเครื่องเดียวใน MTBF/MTTR/KPI ช่าง
   🔴 ผูกที่ **สาย** ไม่ใช่ชื่อไลน์ดิบ — แม่กับลูกคือที่เดียวกัน (วัดจริง: 21 คีย์ชน → เหลือ 4) */
test('🛡️ equip-identity-family-scoped — จัดกลุ่มเครื่องนอกทะเบียนต้องผูกสายไลน์', () => {
  const src = readFileSync(join(ROOT, 'src/utils/mtnMetrics.js'), 'utf8');
  assert.ok(/scopeKeyByFamily\s*\(/.test(src) && /lineFamilyKey\s*\(/.test(src),
    '\n\n❌ `mtnMetrics` เลิกผูกสายไลน์กับคีย์เครื่องแล้ว\n'
    + '   ⇒ ชื่อเครื่องซ้ำข้ามสาย (CONVEYOR ของ PD3 กับ PD4) กลับไปถูกนับเป็นเครื่องเดียว\n'
    + '   แก้ยังไง: `scopeKeyByFamily(typedKey, lineFamilyKey(lineFamilyOf(rowLine)))` (utils/machineNo.js)\n');

  /* เครื่องที่ **อยู่ในทะเบียน** ต้องไม่ถูกผูกสาย — ทะเบียนเป็นตัวบอกตัวตนอยู่แล้ว
     ผูกซ้ำ = เครื่องตัวเดียวที่ถูกลงหลายสาย (ช่างยกไปใช้ไลน์อื่น) แตกเป็นหลายแถว */
  assert.ok(/machine\s*\?\s*normEquipKey\(machine\.machine_no\)/.test(src),
    '\n\n❌ เครื่องที่อยู่ในทะเบียนถูกผูกสายไปด้วย — ต้องใช้เลขทะเบียนล้วน\n');

  /* 🔴 ตัวผูกสายห้าม normalize ซ้ำ — แต่ละจอมี normalizer ของตัวเอง
     (`normEquipKey` เก็บศูนย์นำหน้า · `machineKey` ตัดทิ้ง) บังคับตัวใดตัวหนึ่ง = คีย์ขยับยกระบบ */
  const mn = readFileSync(join(ROOT, 'src/utils/machineNo.js'), 'utf8');
  const fn = mn.slice(mn.indexOf('export const scopeKeyByFamily'));
  assert.ok(!/machineKey\s*\(/.test(fn.slice(0, 300)),
    '\n\n❌ `scopeKeyByFamily` ไป normalize ซ้ำ — คีย์ของเครื่องที่ขึ้นทะเบียนแล้วจะเปลี่ยนยกระบบ\n'
    + '   (ประวัติ MTBF/พาเรโตขยับโดยไม่มีใครสั่ง) · ต้องรับคีย์ที่ normalize มาแล้วเท่านั้น\n');
});

/* ═══ ของกลางของไลน์ขนาน ห้ามถูกหารเลน — `affects_lanes` (2026-10-28 · คำสั่ง user) ═══
   ที่มา: user ถามถึงเคส HDF1 → LASER-345 (เลเซอร์ 3 เครื่องวิ่งขนาน · คอนเวเยอร์ลำเลียงตัวเดียว
   เลี้ยงทั้ง 3 เครื่อง) — *"คอนเวเย่อ พัง ไม่ใช่เลเซอพัง … ถ้าคอนเวเย่อเบรคดาว จะกระทบกับทั้ง3เครื่องทันที"*
   การหาร 1/N (กฎ 12/10) ถูกสำหรับ **เครื่องในเลน** แต่ผิดสำหรับ **ของกลางของไลน์**:
   คอนเวเยอร์หยุด 155 นาที = ไลน์หยุด 155 นาที ไม่ใช่ 52 นาที
   ⇒ ทะเบียนเครื่องตอบว่า "ตัวนี้ครอบกี่เลน" (`machines.affects_lanes` ฝั่ง DR · กรอกที่ `/machines`)
     แล้วทุกสูตรต้องรับแมปนั้นผ่าน `laneWeightFn(parallelN, affectsBy)` — ว่าง = 1 เลน = พฤติกรรมเดิม
   🔴 สูตรน้ำหนักเลนต้องมี **ชุดเดียว** — ใครเขียน `1 / parallelN` เองในหน้า/ในสูตร = ของกลางหายไปเงียบ */
test('🛡️ lane-weight-single-entry — น้ำหนักเลนต้องมาจาก laneWeightFn ห้ามเขียน 1/parallelN เอง', () => {
  const bad = [];
  for (const file of walk(join(ROOT, 'src'), ['.js', '.jsx'])) {
    const rel = relative(ROOT, file);
    if (rel.includes('__tests__')) continue;
    const code = stripComments(readFileSync(file, 'utf8'));
    /* จับ `1 / parallelN` · `1 / N` · `1/parallelUnitsOf(...)` — รูปที่เคยมีจริงใน computeLiveOee */
    if (/\b1\s*\/\s*(parallelN|parallelUnitsOf|laneN|lanes)\b/.test(code)) bad.push(rel);
  }
  assert.deepEqual(bad, [],
    '\n\n❌ ไฟล์ด้านล่างคิดน้ำหนักเลนเองด้วย `1 / parallelN`\n'
    + '   ทำไมห้าม: ของกลางของไลน์ขนาน (คอนเวเยอร์ · ระบบลม · ตู้ไฟ) ที่กรอก `machines.affects_lanes` ไว้\n'
    + '   จะยังถูกหารเลนอยู่ ⇒ นาทีที่ไลน์หยุดต่ำกว่าจริง N เท่า (เคส LASER-345: 155 น. → 52 น.)\n'
    + '   แก้ยังไง: `laneWeightFn(parallelN, affectsBy)` (utils/oee.js §3.2) — สูตรมีชุดเดียวที่นั่น\n\n'
    + bad.map(b => '   • ' + b).join('\n') + '\n');
});

test('🛡️ lane-weight-needs-affects — สูตรที่หารเลนต้องรับแมป affects_lanes ด้วย', () => {
  const src = readFileSync(join(ROOT, 'src/utils/oee.js'), 'utf8');
  for (const [fn, param] of [['laneWeightFn', 'affectsBy'], ['dtLineMin', 'affectsBy'],
                             ['dtMinBySession', 'affectsBy'], ['computeSessionOee', 'affectsLanes'],
                             ['computeLiveOee', 'affectsLanes']]) {
    assert.ok(new RegExp(`${fn}[\\s\\S]{0,900}?${param}`).test(src),
      `\n\n❌ \`${fn}\` ใน utils/oee.js ไม่รับ \`${param}\` แล้ว\n`
      + '   ถอดออก = ของกลางของไลน์ขนาน (คอนเวเยอร์) ถูกหารเลนเหมือนเครื่องในเลน\n'
      + '   = นาทีที่ไลน์หยุดต่ำกว่าจริง N เท่า โดยไม่มี error (คำสั่ง user 28/10)\n');
  }
  /* 🏭 ของกลางของสาย — อุปกรณ์ที่ลงทะเบียนไว้ที่ "ไลน์แม่" ใช้ร่วมหลายไลน์ที่เลนไม่เท่ากัน
     (คอนเวเยอร์สาย HYDROFORM ใช้ทั้ง hdf1/hdf2/laser345/laser789 · user 28/10)
     ⇒ ต้องมีธง `stops_whole_line` ไม่ใช่ตัวเลขอย่างเดียว ไม่งั้นคนกรอกไม่รู้ว่าต้องใส่เลขของไลน์ไหน */
  assert.ok(/stops_whole_line/.test(src),
    '\n\n❌ `affectsLanesMap` ไม่รู้จัก `stops_whole_line` แล้ว\n'
    + '   ของกลางที่ลงทะเบียนไว้ที่ไลน์แม่ (คอนเวเยอร์) จะถูกหารเลนเหมือนเครื่องในเลน\n');

  /* ตัวอ่านแมปต้อง normalize เลขเครื่องผ่าน machineKey — `SW10` vs `SW-10` = คนละคีย์ join ไม่ติด */
  assert.ok(/affectsLanesMap[\s\S]{0,600}?machineKey\s*\(/.test(src),
    '\n\n❌ `affectsLanesMap` ไม่ได้ผ่าน `machineKey()` — เลขเครื่องที่เขียนต่างแบบจะ join ไม่ติด\n'
    + '   (กฎ CLAUDE.md §machine_no = คีย์ join แบบ text)\n');
});

/* ═══ ยอดผลิตของ "ทั้งกะ" ห้ามวน reduce ใบผลิตเองในหน้า (2026-10-12) ═══
   กฎเดียวกันเคยอยู่ 3 ที่ (orderProducedQty / computeSessionOee / handleCloseSession)
   ⇒ `confirmed → o.qty` ที่หนึ่ง กับ `qty_ok ?? qty` อีกที่หนึ่ง = รอวัน drift
   ยุบเป็น `sessionProducedQty()` (oee.js §6.0.1) แล้ว — ห้ามเขียนใหม่ */
test('🛡️ session-produced-qty-single-source — ห้ามรวมยอดผลิตของกะเองด้วย reduce', () => {
  const ALLOW = {
    'src/utils/oee.js': 'เจ้าของสูตร',
  };
  const bad = [];
  for (const file of walk(join(ROOT, 'src'), ['.js', '.jsx'])) {
    const rel = relative(ROOT, file);
    if (rel.includes('__tests__') || ALLOW[rel]) continue;
    const code = stripComments(readFileSync(file, 'utf8'));
    // `…filter(o => o.status === 'confirmed')…reduce(… + o.qty …)` ภายในช่วงสั้นๆ เดียวกัน
    const re = /status\s*===\s*'confirmed'[\s\S]{0,200}?\.reduce\([^)]{0,120}\+\s*[A-Za-z_$][\w$]*\.qty\b/g;
    let m;
    while ((m = re.exec(code))) bad.push(`${rel}:${code.slice(0, m.index).split('\n').length}`);
  }
  assert.deepEqual(bad, [],
    '\n\n❌ จุดด้านล่างรวม "ยอดผลิตของกะ" เองจากใบผลิต\n'
    + '   ทำไมห้าม: สูตรนี้เคยมี 3 สำเนาที่กติกาไม่ตรงกัน (`o.qty` vs `qty_ok ?? qty`)\n'
    + '   และต้องนับใบ carry_over/imported/cancelled ด้วย — ลืมข้อใดข้อหนึ่ง = ยอดหายเงียบ\n'
    + '   แก้ยังไง: sessionProducedQty(orders, carryQtyActual) จาก utils/oee.js (§6.0.1)\n\n'
    + bad.map(b => '   • ' + b).join('\n') + '\n');
});

/* ═══ คำนวณ OEE ใหม่ = ต้อง re-stamp "ยอด" ด้วยเสมอ (2026-10-12) ═══
   ปุ่ม "แก้เวลากะ + คำนวณ OEE ใหม่" เคยเขียนทับแค่ oee_a/p/q/oee/shift_min
   แต่ %P/%Q ถูกคำนวณจาก **ใบผลิตชุดปัจจุบัน** ⇒ ถ้าใบถูกแก้ยอดหลังปิดกะ
   แถวเดียวกันจะขัดแย้งกันเอง: actual_qty 1,000 แต่ %P คิดจาก 1,100
   (วัดจริง ก.ย. 2026: 26 กะ · 885 ชิ้น ที่ actual_qty ต่ำกว่าผลรวมใบผลิตจริง) */
test('🛡️ oee-restamp-needs-qty — ทุก payload ที่เขียน oee_a ต้องเขียน actual_qty ด้วย', () => {
  const file = join(ROOT, 'src/pages/DailyReport.jsx');
  const code = stripComments(readFileSync(file, 'utf8'));
  const bad = [];
  /* ข้าม payload ของ Telegram (`notifyProdClose({...})`) — มันแค่ "ส่งข้อความ" ไม่ได้เขียนลงฐาน
     (ใช้คีย์ `total_qty` ไม่ใช่ `actual_qty` โดยตั้งใจ) ⇒ ไม่เกี่ยวกับกฎนี้ */
  const notifySpans = [];
  let nm; const nre = /notifyProdClose\s*\(/g;
  while ((nm = nre.exec(code))) {
    let i = nm.index + nm[0].length, depth = 1;
    while (i < code.length && depth > 0) { const c = code[i++]; if (c === '(') depth++; else if (c === ')') depth--; }
    notifySpans.push([nm.index, i]);
  }
  const inNotify = (idx) => notifySpans.some(([a, b]) => idx > a && idx < b);

  let m; const re = /\boee_a\s*:/g;
  while ((m = re.exec(code))) {
    if (inNotify(m.index)) continue;
    // มองย้อนขึ้นไป/ลงมารอบๆ payload เดียวกัน (ออบเจกต์ที่ stamp ค่า OEE ยาวไม่เกิน ~40 บรรทัด)
    const from = Math.max(0, m.index - 2500), to = Math.min(code.length, m.index + 1200);
    if (!/\bactual_qty\s*:/.test(code.slice(from, to))) bad.push(`DailyReport.jsx:${code.slice(0, m.index).split('\n').length}`);
  }
  assert.deepEqual(bad, [],
    '\n\n❌ จุดด้านล่าง stamp ค่า OEE ลง production_sessions โดยไม่ stamp ยอดผลิตด้วย\n'
    + '   ทำไมห้าม: %P/%Q คิดจากใบผลิตชุดปัจจุบัน — ปล่อย actual_qty/qty_ok ค้างค่าเดิม\n'
    + '   = แถวเดียวกันขัดแย้งกันเอง (ยอด 1,000 แต่ %P คิดจาก 1,100) อธิบายให้ผู้บริหารไม่ได้\n'
    + '   แก้ยังไง: ใส่ actual_qty / qty_ok = sessionProducedQty(...) ใน payload เดียวกัน\n\n'
    + bad.map(b => '   • ' + b).join('\n') + '\n');
});

/* ── เด็ค PowerPoint ทุกตัว = ธีม TSG Revision 01 (12/10 · คำสั่ง user "ทำใหม่หลังจากนี้ต้อง revision1") ──
   R00 = ปก/ปิดพื้นเขียว · R01 = พื้นขาวทุกหน้า · skill tsg-presentation-theme ที่ sync มายังเป็น R00 */
test('🛡️ pptx-theme-r01 — ตัวสร้างเด็คห้ามใช้ asset/สีของธีม TSG R00', () => {
  const theme = readFileSync(join(ROOT, 'docs/meetings/roadshow_build/tsg_theme.py'), 'utf8');
  assert.match(theme, /REVISION = "R01"/,
    '\n\n❌ docs/meetings/roadshow_build/tsg_theme.py ไม่ใช่ R01 แล้ว — อย่าเอาไฟล์จาก skill tsg-presentation-theme (R00) มาทับ\n');
  const R00 = /bg_title\.png|div_pd3\.png|div_pd4\.png|div_jig\.png|logo_big\.png|logo_footer\.png|C0561E|0xC0, ?0x56, ?0x1E|EBD9B0/;
  const hits = walk(join(ROOT, 'docs'), ['.py'])
    .filter(f => !f.endsWith('retheme_r01.py'))
    // เฉพาะตัวสร้าง "สไลด์" (pptx + เด็ค HTML) — infographic A4 ไม่อยู่ในคำสั่งนี้
    .filter(f => f.endsWith('build_presentation.py') || /from pptx|import tsg_theme/.test(readFileSync(f, 'utf8')))
    .filter(f => R00.test(readFileSync(f, 'utf8')))
    .map(f => relative(ROOT, f));
  assert.deepEqual(hits, [],
    '\n\n❌ ตัวสร้างเด็คยังอ้าง asset/สีของธีม TSG R00 (ปก/ปิดพื้นเขียว): ' + hits.join(', ') + '\n'
    + '   ทำไม: user สั่ง 12/10 ว่าเด็คทุกตัวต้องเป็น Revision 01 — พื้นขาวทุกหน้ารวมปก/ปิด · เขียว 068734 · ส้ม D95323\n'
    + '   แก้ยังไง: import tsg_theme จาก docs/meetings/roadshow_build/ (title_slide / agenda_slide / section_divider / closing_slide)\n'
    + '            เด็ค .pptx เก่าที่ไม่มีสคริปต์ → python3 docs/meetings/roadshow_build/retheme_r01.py <file>\n');
});

/* ── 🔴 LOT size ≠ Packing — ห้ามยุบ 2 เรื่องเป็นรายการเดียว (12/10 · คำสั่ง user "แยกกันนะ") ──
   `kanban_standards.lot_size` = ขนาดล็อตผลิต (คุมจังหวะออกใบสั่ง · `pullAccumulator`/`kanbanCalc`)
   `kanban_standards.qty_per_kanban` = Packing (ชิ้นต่อกล่อง/ต่อบัตร · คุมการบรรจุ-การส่ง)
   เดิมจอเทียบรวมเป็นแถวเดียว "ไม่ตรง" แล้วนับรวม ⇒ ตัวเลขตอบไม่ได้ว่าต้องไปแก้เรื่องไหนกับใคร */
test('🛡️ kanban-lot-vs-packing-split — จอเทียบทะเบียน kanban ต้องแยกกอง LOT / Packing', () => {
  const code = stripComments(readFileSync(join(ROOT, 'src/components/MonitoringUpload.jsx'), 'utf8'));
  assert.ok(!/\bdLot\s*\|\|\s*dPack\b|\bdPack\s*\|\|\s*dLot\b/.test(code),
    '\n\n❌ MonitoringUpload รวม "LOT ไม่ตรง" กับ "Packing ไม่ตรง" เป็นรายการเดียวอีกแล้ว\n'
    + '   ทำไมห้าม: 2 ค่านี้คุมคนละเรื่อง — lot_size = จังหวะออกใบสั่งผลิต (pullAccumulator/kanbanCalc)\n'
    + '   · qty_per_kanban = การบรรจุ/ป้ายบัตร · คนละคนตัดสิน · รวมกันแล้วนับ "N พาร์ทไม่ตรง"\n'
    + '   = ตอบไม่ได้ว่าต้องไปคุยกับใครเรื่องอะไร และเรื่องที่ค้างจะไปบล็อกเรื่องที่ชัดอยู่แล้ว\n'
    + '   แก้ยังไง: แยกเป็น { lot, pack, noStd } แล้ววาดคนละตาราง (ดู <KbDiffTable>)\n');
  assert.ok(/kbDiff\s*=\s*\{\s*lot:\s*\[\]\s*,\s*pack:\s*\[\]\s*,\s*noStd:\s*\[\]\s*\}/.test(code),
    '\n\n❌ ไม่พบการแยกกอง `kbDiff = { lot, pack, noStd }` ใน MonitoringUpload — ดูเหตุผลด้านบน\n'
    + '   ("ยังไม่มีในทะเบียน" เป็นกองที่ 3 คนละเรื่องกับ "มีแล้วแต่ไม่ตรง")\n');
});

/* ── Monitoring 12/10 (user): IN ต้องเป็น "คลังกดรับแล้ว" + ORDER บอร์ดแร็คต้องไปถึงหน้า Delivery ── */
test('🛡️ Monitoring: IN จาก ledger รับเข้า (inAtRef) ไม่ใช่ใบผลิตคอนเฟิร์ม · ORDER บอร์ดแร็คซิงค์ใบส่งของ', () => {
  const code = stripComments(readFileSync(join(ROOT, 'src/pages/Monitoring.jsx'), 'utf8'));
  assert.ok(!/IN_ORDER_STATUS|orderInQty\(/.test(code),
    '\n\n❌ Monitoring กลับไปนับ IN จากใบผลิตที่คอนเฟิร์ม — ของยังไม่ถึงคลัง (รอสโตร์/คลัง FG กดรับ) แต่ยอดวิ่งเข้าตารางแล้ว\n'
    + '   แก้: IN = inAtRef(ledger issue ที่คลังอ้างอิง) · ใบรอรับ (stock_receipts pending) เขียนบนจอแยก\n');
  assert.ok(/inAtRef\(/.test(code), '\n\n❌ Monitoring ไม่ได้คิด IN ผ่าน inAtRef (utils/monitorSystem.js)\n');
  assert.ok(/rackOrderSyncPlan\(/.test(code) && /syncRackOrder\(/.test(code),
    '\n\n❌ ช่อง ORDER บอร์ดรายแร็คไม่ซิงค์ customer_shipping_orders — คนพิมพ์ยอดแล้วไม่ขึ้น Shipping Time Chart ต้องไปเพิ่มมือซ้ำ\n');
  assert.ok(/horizon:\s*\d/.test(code), '\n\n❌ บอร์ดรายวันส่งต้องส่ง horizon ให้ boardPeriods — ไม่งั้นไม่มีคอลัมน์วันนี้ให้พิมพ์\n');
});

/* ── 🔑 rls-tightened-tables-need-key (13/10 · รอบ 8) ───────────────────────────
   RLS ฝั่ง DB รัดตารางกลุ่มนี้ด้วย has_perm('<คีย์เดียวกับปุ่มบนจอ>') แล้ว
   ⇒ ไฟล์ไหนก็ตามที่ **เขียน** ตารางพวกนี้ ต้องอ้างคีย์นั้นในไฟล์เดียวกันด้วย
     (เรียก can(...) / ส่ง prop canXxx / เช็คก่อนเรียก)

   ทำไมถึงต้องมีด่าน: เจอของจริงใน Management.jsx — ปุ่ม "📌 บันทึกตำแหน่งประจำ" กับ "↩ Pool"
   ไม่มี can() กันเลย (มีแต่ `canDrag` ที่ประกาศอยู่ในฟังก์ชันวาดการ์ด จึงไม่ครอบปุ่มใน modal)
   พอฝั่ง DB รัด → ปุ่มยังโชว์ กดแล้วเด้ง error จาก Postgres = ผู้ใช้เจอปุ่มตายโดยไม่รู้สาเหตุ
   นี่คือกลับด้านของกฎ db-write-rules ข้อ 3 ("จอที่คุมสิทธิ์เองก็ต้องเช็คสิทธิ์ผู้ดู")

   ด่านนี้ดูแค่ "คีย์ถูกอ้างในไฟล์ไหม" ไม่ได้พิสูจน์ว่ากันถูกจุด — ตั้งใจให้หยาบไว้ก่อน
   จะได้ไม่ false positive · ตารางที่รัดเพิ่มในรอบถัดไป ให้เติมในตารางนี้ */
const RLS_KEYED_TABLES = {
  employee_home_positions: ['management:assign_manpower', 'assign_manpower'],
  workstations:            ['line_setup:edit', 'line_setup'],
  station_requirements:    ['line_setup:edit', 'line_setup', 'skills:delete', 'skills'],
  shift_schedules:         ['shift_schedule:edit', 'shift_schedule'],
  daily_production_logs:   ['checkin:record', 'checkin', 'management:assign_manpower', 'assign_manpower'],
  // รอบ 9 (13/10)
  ot_night_bookings:       ['checkin:record', 'checkin'],
  line_helpers:            ['checkin:record', 'checkin'],
  operator_special_tasks:  ['management:assign_special_task', 'assign_special_task'],
  station_assignment_logs: ['management:assign_manpower', 'assign_manpower'],
  special_task_types:      ['ot_master:manage', 'ot_master'],
  leave_types:             ['ot_master:manage', 'ot_master'],
  // รอบ 10 (14/10) — ปิดชั้น "เขียนได้ทุกคนที่ล็อกอิน" จบ
  wip_replenish_requests:  ['wip_request:', 'wip_request', 'line_levels:manage', 'heijunka:operate'],
  line_replenish_scan_blocks: ['heijunka:operate', 'wip_request:', 'wip_request'],
  ojt_trainings:           ['ojt:record', 'ojt:delete', "'ojt'"],
  ojt_training_attendees:  ['ojt:record', 'ojt:delete', "'ojt'"],
  pokayoke_devices:        ['pokayoke:manage', 'pokayoke'],
  pokayoke_checks:         ['pokayoke:record', 'pokayoke:manage', 'pokayoke'],
  line_layouts:            ['line_setup:edit', 'line_setup', 'storage_maintain:run', 'storage_maintain'],
  shift_overrides:         ['shift_schedule:edit', 'shift_schedule'],
  qa_customer_claims:      ['canRecord', 'canManage', "'qa'"],
  cqi15_event_logs:        ['event_log:', 'event_log'],
  cqi15_event_approvals:   ['event_log:', 'event_log'],
  cqi15_check_completions: ['event_log:', 'event_log'],
};

/* ยกเว้นได้เฉพาะ "util กลางที่ด่านอยู่ที่ผู้เรียก" — ต้องเขียนเหตุผล + ชี้ไฟล์ที่กันจริง
   (ปล่อยเงียบไม่ได้ ไม่งั้นด่านนี้จะกลายเป็นด่านที่ใครก็ปิดได้ด้วยการย้ายโค้ดไป util) */
const RLS_KEY_ALLOW = {
  'src/utils/recompressLayouts.js':
    'util บีบรูปผัง — ด่านอยู่ที่ผู้เรียก: StorageMaintenance.jsx:24 isActionSeeded(storage_maintain,run) '
    + '→ prop canRun → ImageSqueezePanel.jsx (util ไม่รู้จัก role เลยโดยการออกแบบ)',
};

test('🛡️ rls-tightened-tables-need-key — ไฟล์ที่เขียนตารางที่ถูกรัด RLS ต้องอ้างคีย์สิทธิ์ของมันด้วย', () => {
  const bad = [];
  for (const file of walk(join(ROOT, 'src'), ['.js', '.jsx'])) {
    const code = stripComments(readFileSync(file, 'utf8'));
    for (const [table, keys] of Object.entries(RLS_KEYED_TABLES)) {
      const writeRe = new RegExp(
        `from\\(\\s*['"\`]${table}['"\`]\\s*\\)[\\s\\S]{0,300}?\\.(insert|update|upsert|delete)\\s*\\(`, 'g');
      /* 🔴 แผง CRUD กลาง (<SimpleNameMaster table="x"> / <SimpleMasterPanel table="x">) รับ "ชื่อตาราง"
         เป็น prop ⇒ ไฟล์ที่ใช้มันไม่มี `from('x').insert` ให้ grep เจอ แต่มันเขียนจริง
         (เจอรอบ 9: special_task_types / leave_types เขียนจาก Report.jsx แบบนี้) */
      const panelRe = new RegExp(`table=\\{?\\s*['"\`]${table}['"\`]`, 'g');
      if (!writeRe.test(code) && !panelRe.test(code)) continue;
      if (keys.some(k => code.includes(k))) continue;
      if (RLS_KEY_ALLOW[relative(ROOT, file)]) continue;
      bad.push(`${relative(ROOT, file)} → เขียน ${table} แต่ไม่พบคีย์ ${keys.slice(0, 2).join(' / ')}`);
    }
  }
  assert.deepEqual(bad, [],
    '\n\n❌ มีไฟล์เขียนตารางที่ RLS รัดด้วย has_perm แล้ว โดยไม่เช็คสิทธิ์ฝั่งจอ:\n   '
    + bad.join('\n   ')
    + '\n\n   ผลที่เกิด: ปุ่มยังโชว์ให้คนที่ไม่มีสิทธิ์ กดแล้วได้ error ดิบจาก Postgres (หรือ "สำเร็จ 0 แถว"\n'
    + '   แบบเงียบ ถ้าเป็น UPDATE/DELETE — ดู db-write-rules ข้อ 2)\n'
    + '   แก้: ประกาศ const canXxx = can(\'<resource>\', \'<action>\', role) ที่ระดับคอมโพเนนต์\n'
    + '   แล้ว (ก) ซ่อนปุ่มเมื่อไม่มีสิทธิ์ และ (ข) เช็คซ้ำในฟังก์ชันที่เขียน DB (ซ่อนปุ่มอย่างเดียวไม่พอ)\n'
    + '   ตารางคีย์อยู่ที่ RLS_KEYED_TABLES ในไฟล์นี้ · migration 20261013_rls_round8_*.sql\n');
});

/* ── 🔑 manpower-actions-need-perm (13/10 · บั๊กจริงที่ด่านข้างบนจับไม่ได้) ──────
   ด่าน `rls-tightened-tables-need-key` ดูแค่ "ไฟล์นี้อ้างคีย์ไหม" ⇒ **จับเคสนี้ไม่ได้**
   เพราะ Management.jsx มี can('management','assign_manpower') อยู่แล้ว — แต่ไปอยู่ใน
   `canDrag` ที่ประกาศ *ข้างใน* ฟังก์ชันวาดการ์ดพนักงาน จึงไม่ครอบปุ่มใน modal จุดงาน
   ⇒ ใครเปิด modal ได้ก็กด "📌 บันทึกตำแหน่งประจำ" / "↩ Pool" ได้ทั้งที่ไม่มีสิทธิ์
   บทเรียน: **"ไฟล์มีคีย์" ≠ "ทางเข้านั้นถูกกัน"** — ด่านหยาบต้องมีด่านเจาะจงคู่เสมอ */
test('🛡️ manpower-actions-need-perm — ฟังก์ชันที่เขียนกำลังคนต้องเช็ค canAssignManpower ในตัวเอง', () => {
  const code = stripComments(readFileSync(join(ROOT, 'src/pages/Management.jsx'), 'utf8'));
  assert.ok(/const\s+canAssignManpower\s*=\s*can\(\s*'management'\s*,\s*'assign_manpower'/.test(code),
    '\n\n❌ Management.jsx ไม่มี `canAssignManpower` ระดับคอมโพเนนต์แล้ว\n'
    + '   ตัวแปรสิทธิ์ที่ประกาศอยู่ในฟังก์ชันย่อย (เช่น canDrag) ครอบปุ่มใน modal ไม่ถึง\n');
  // ด่านสิทธิ์ต้องเป็น guard clause ช่วงต้นฟังก์ชัน ⇒ ดู 600 ตัวอักษรแรกหลังบรรทัดประกาศก็พอ
  // (ตัดจบฟังก์ชันด้วย regex เปราะเกินไป — ฟังก์ชันพวกนี้ยาวและมี `};` ซ้อนข้างใน)
  for (const fn of ['assignWorker', 'saveHomePosition']) {
    const at = code.indexOf(`const ${fn} = async`);
    assert.ok(at >= 0, `\n\n❌ หาฟังก์ชัน ${fn} ใน Management.jsx ไม่เจอ (เปลี่ยนชื่อ/ย้ายไฟล์? อัพเดทด่านนี้ด้วย)\n`);
    assert.ok(code.slice(at, at + 600).includes('canAssignManpower'),
      `\n\n❌ ${fn}() เขียน DB โดยไม่เช็ค canAssignManpower ในตัวฟังก์ชันเอง\n`
      + '   ซ่อนปุ่มอย่างเดียวไม่พอ — RLS ฝั่ง DB รัด daily_production_logs / employee_home_positions\n'
      + '   ด้วย management:assign_manpower แล้ว ถ้าไม่กันที่นี่ ผู้ใช้จะเจอ error ดิบจาก Postgres\n');
  }
});

/* ── 📋 ทะเบียนของบอร์ด AM รายวัน ต้องผ่าน cache (13/10 · งานลด egress รอบ "โตตามจำนวนจอ") ──
   วัดจาก log 09/10: `loadDailyAm()` ถูกเรียกใหม่ทุก event ของ inspections/prod_orders/
   production_sessions ⇒ ดึง `jigs` 545 + `checklists` 497 + `pm_daily_line_targets` 266
   = **1,308 ครั้ง/วัน** ทั้งที่ 3 ตารางนี้เป็น "ทะเบียน" เปลี่ยนเดือนละไม่กี่ครั้ง
   บนจอ TV ที่เปิดค้าง = ยิงทุก 10 นาทีตลอดคืน · 🔴 **ตัวเลขนี้คูณตามจำนวนจอที่เปิด**
   ⇒ ต้องผ่าน `cachedRows` (ไม่ใช่ `cachedMaster` — บอร์ดนี้ "โหลดพลาด" ต้องไม่กลายเป็น "ว่าง"
      เพราะว่าง = จอขึ้น "ไม่มีจุดตรวจ" ซึ่งเป็นคำตอบผิดที่ดูเหมือนคำตอบถูก)                */
test('🛡️ am-board-registries-cached — jigs/checklists/pm_daily_line_targets ใน dailyAmBoard ต้องผ่าน cachedRows', () => {
  const code = stripComments(readFileSync(join(ROOT, 'src/lib/dailyAmBoard.js'), 'utf8'));
  const bad = [];
  for (const t of ['jigs', 'pm_daily_line_targets', 'checklists']) {
    const re = new RegExp(`cachedRows\\(\\s*'[^']+'\\s*,[^\\n]*from\\('${t}'\\)`);
    if (!re.test(code)) bad.push(t);
  }
  assert.deepEqual(bad, [], '\n\n❌ ทะเบียนบอร์ด AM ไม่ได้ผ่าน cachedRows: ' + bad.join(', ') + '\n'
    + '   ผล: จอ AM/ผังรวมโรงงานดึงทะเบียนใหม่ทุกรอบ refresh = 1,308 ครั้ง/วัน และโตตามจำนวนจอ\n'
    + '   แก้: cachedRows(\'<คีย์>\', () => supabaseDR.from(\'<ตาราง>\')...) + ลงทะเบียนคีย์ใน masterInvalidate.js\n'
    + '        และทุกจุดที่เขียนตารางนั้นต้องเรียก invalidateTable(\'<ตาราง>\') หลังบันทึกสำเร็จ\n');
});

/* ── 📝 รายละเอียดในใบแจ้งซ่อม MO ต้องชัดพอให้ช่างเตรียมตัว (13/10 · คำขอทีม MTN ผ่าน user) ──
   วัดจากของจริง (DR `mtn_orders` 90 วัน 718 ใบ): ไม่กรอกเลย 10 ใบ (1.4%) · สั้น 1–15 ตัว
   109 ใบ (15%) · เฉลี่ย 40 ตัว · ไม่เลือกกลุ่มอาการ 0 ใบ ⇒ ปัญหาคือ "สั้นจนเดาไม่ออก"
   🔴 เตือนได้ ห้ามบล็อกความยาว — บังคับแล้วคนเลิกแจ้งในระบบ ไปบอกช่างปากเปล่า เสียทั้งสายข้อมูล
      (บล็อกได้ชั้นเดียว: เลือกอาการ "อื่นๆ/ไม่ระบุ" แล้วไม่เขียนอะไรเลย = ไม่เหลือข้อมูลให้ใครเลย)
   ⇒ เกณฑ์อยู่ใน `utils/moNoteQuality.js` ที่เดียว · หน้าแจ้งซ่อมต้องเรียกใช้ ห้ามคิดเกณฑ์เอง   */
test('🛡️ mo-note-quality-gate — ฟอร์มแจ้งซ่อมต้องตรวจคุณภาพรายละเอียดผ่าน moNoteCheck', () => {
  const code = stripComments(readFileSync(join(ROOT, 'src/pages/MtnRepair.jsx'), 'utf8'));
  assert.ok(/moNoteCheck\(/.test(code),
    '\n\n❌ MtnRepair ไม่ได้เรียก moNoteCheck — ช่อง "ระบุรายละเอียดปัญหา" กลับไปเป็นช่องเปล่า\n'
    + '   ผล: ใบที่เขียน 1–15 ตัวอักษร (15% ของใบ) ไม่มีใครเตือน ช่างต้องเดินไปถามเอง\n'
    + '   แก้: moNoteCheck({ note, group, character }) จาก src/utils/moNoteQuality.js\n'
    + '        → เตือนใต้ช่อง (level thin) + บล็อกตอน blocked (อื่นๆ + ไม่เขียนอะไรเลย)\n');
  assert.ok(/noteCheck\.blocked/.test(code),
    '\n\n❌ ผล moNoteCheck ไม่ได้ถูกใช้กันตอนกดบันทึก — เตือนบนจอแต่ส่งผ่านได้ทุกกรณี\n');
  assert.ok(!/MO_NOTE_MIN\s*=/.test(code),
    '\n\n❌ เกณฑ์ความยาวถูกประกาศซ้ำในหน้า — แก้ที่เดียวไม่พอ แล้วจอกับด่านจะตอบคนละเลข\n'
    + '   แก้: import { MO_NOTE_MIN } from "../utils/moNoteQuality"\n');
});

/* ── ช่องแนบ "รูปหลักฐานของเสีย" ต้องเริ่มที่โหมด "ใช้ทั้งรูป" (2026-10-13 · คำสั่ง user) ──
   เดิมโมดัลครอบรูปมีช่องติ๊ก "ใช้ทั้งรูป" ที่ **ไม่ติ๊ก = ครอบ 4:3** ⇒ หน้างานที่รีบ
   กด "✓ ใช้รูปนี้" เลย จะได้รูปที่ถูกตัดขอบโดยไม่รู้ตัว — รูปหลักฐานที่ตำหนิหลุดกรอบ
   ใช้เป็นหลักฐานไม่ได้ และ **กู้คืนไม่ได้** (ต้นฉบับไม่ถูกเก็บ เก็บแต่ผลลัพธ์ที่ครอบแล้ว)
   ⇒ ค่าเริ่มต้นของจุดนี้ต้องเป็น "ทั้งรูป" · อยากครอบต้องตั้งใจกดเลือก
   ⚠️ กฎนี้คุมแค่ "จุดรูปหลักฐาน" — PMSetup (รูปภาพรวมเครื่อง) ยังเริ่มที่โหมดครอบตามเดิม */
test('🛡️ quality-photo-full-by-default — QualityPhotoField ต้องส่ง fullDefault ให้ ImageCropModal', () => {
  const file = join(ROOT, 'src/components/QualityPhotoField.jsx');
  const code = stripComments(readFileSync(file, 'utf8'));
  const call = code.match(/<ImageCropModal[\s\S]*?\/>/);
  assert.ok(call, '\n\n❌ ไม่พบ <ImageCropModal> ใน QualityPhotoField.jsx — ช่องแนบรูปหลักฐานต้องผ่านโมดัลครอบกลางเท่านั้น\n');
  const bad = [];
  if (!/\ballowFull\b/.test(call[0])) bad.push('ไม่มี allowFull — ผู้ใช้สลับไปโหมด "ใช้ทั้งรูป" ไม่ได้เลย');
  if (!/\bfullDefault\b/.test(call[0])) bad.push('ไม่มี fullDefault — ค่าเริ่มต้นกลับไปเป็น "ครอบ" รูปหลักฐานจะถูกตัดขอบเงียบๆ');
  assert.deepEqual(bad, [],
    '\n\n❌ <ImageCropModal> ใน src/components/QualityPhotoField.jsx ตั้งค่าไม่ครบ:\n'
    + bad.map(b => '   • ' + b).join('\n') + '\n'
    + '   ทำไมสำคัญ: ค่าเริ่มต้นคือสิ่งที่คนรีบๆ หน้าไลน์จะได้จริง — รูปหลักฐานที่ครอบจนตำหนิ\n'
    + '   หลุดกรอบ ใช้เป็นหลักฐานไม่ได้ และกู้คืนไม่ได้ (เก็บแต่รูปที่ครอบแล้ว)\n'
    + '   แก้ยังไง: <ImageCropModal ... allowFull fullDefault fullHint="…" />\n');
});

/* ── 📎 หน้าพิมพ์ที่มีรูป ต้องรอรูปโหลดก่อนสั่ง print (2026-10-13) ────────────────
   `window.print()` **ไม่รอรูป** — สั่งพิมพ์ทันทีที่ฟอนต์พร้อม จะได้ภาคผนวกเป็นช่องว่าง
   โดยไม่มี error ให้เห็นเลย (คนเซ็นใบไปแล้วถึงรู้ว่ารูปไม่ติด) · และ `loading="lazy"`
   ในหน้าพิมพ์ยิ่งซ้ำ — รูปที่ยังไม่ถูกเลื่อนถึงจะไม่ถูกโหลดเลย
   ⚠️ กฎ `list-thumb-needs-lazy` เป็นเรื่องของ "จอรายการ" (กัน egress) คนละเรื่องกับหน้าพิมพ์ */
test('🛡️ print-photos-need-wait — ใบพิมพ์ที่แนบภาคผนวกรูป ต้องเรียก __waitImgs ก่อน print()', () => {
  const bad = [];
  for (const f of walk(join(ROOT, 'src/lib'), ['.js'])) {
    const rel = relative(ROOT, f);
    // เทียบกับโค้ดที่ตัดคอมเมนต์แล้วเสมอ — ไม่งั้นคอมเมนต์ที่ "เตือนห้ามใช้ lazy" จะทำให้ด่านยิงใส่ตัวเอง
    const code = stripComments(readFileSync(f, 'utf8'));
    if (/loading\s*=\s*\\?["']lazy/.test(code)) bad.push(`${rel} — ใส่ loading="lazy" ในหน้าพิมพ์`);
    if (!/photoAppendixHtml/.test(code)) continue;
    if (!/__waitImgs/.test(code)) bad.push(`${rel} — แนบภาคผนวกรูปแต่ไม่ได้รอรูปโหลด (waitImgsScript/__waitImgs)`);
    if (/window\.print\(\)/.test(code) && !/__waitImgs\(/.test(code)) bad.push(`${rel} — สั่ง print() โดยไม่ผ่าน __waitImgs`);
  }
  assert.deepEqual(bad, [],
    '\n\n❌ หน้าพิมพ์ต่อไปนี้เสี่ยงพิมพ์ออกมาเป็นช่องว่าง:\n'
    + bad.map(b => '   • ' + b).join('\n') + '\n'
    + '   แก้ยังไง: ฝัง ${waitImgsScript()} ในแท็ก <script> ของใบ แล้วสั่งพิมพ์ผ่าน\n'
    + '            window.__waitImgs(function () { window.print(); })\n'
    + '            (ของกลางอยู่ที่ src/lib/photoAppendix.js — รูปพัง/ช้าเกิน 8 วิ จะติดป้าย\n'
    + '             "โหลดรูปไม่สำเร็จ" บนกระดาษแล้วพิมพ์ต่อ ไม่ค้างรอไม่จบ)\n');
});

/* ── 🔁 ตัวยุบคำขอ GET ที่ซ้อนเวลากัน ต้องผูกกับ client ทั้งสองฝั่ง (13/10 · งานลด egress) ──
   วัดจริง 13/10: คำขอ GET ที่เหมือนกันเป๊ะบนตารางหลักซ้ำกัน **median 3–77 ms**
   = หลายแผงบนหน้าเดียวกันต่างคนต่างยิงคิวรีชุดเดียวกันในเรนเดอร์รอบเดียว (ไม่ใช่ poll/realtime)
   `makeDedupeFetch` แก้ทั้งระบบที่จุดเดียว — **แต่ได้ผลก็ต่อเมื่อถูกส่งเข้า createClient จริง**
   ถอดออก/ลืมฝั่งใดฝั่งหนึ่ง = กลับไปจ่าย 2-3 เท่าทันทีโดยไม่มีอะไรพัง = ไม่มีใครรู้ตัว         */
test('🛡️ supabase-fetch-chain — ทั้ง 2 client ต้องผ่าน "ยุบคำขอซ้ำ" + "ถอยเมื่อ 503" ตัวเดียวกัน', () => {
  const code = stripComments(readFileSync(join(ROOT, 'src/supabaseClient.js'), 'utf8'));
  const calls = [...code.matchAll(/createClient\([^)]*\)/g)].map(m => m[0]);
  assert.equal(calls.length, 2, `ควรมี createClient 2 ตัว (Main + DR) พบ ${calls.length}`);
  calls.forEach((c) => {
    assert.match(c, /global:\s*\{\s*fetch:\s*guardedFetch\s*\}/,
      '\n\n❌ createClient ตัวนี้ไม่ได้ส่ง guardedFetch:\n   ' + c + '\n'
      + '   ผล: คำขอ GET ที่ซ้อนเวลากันยิงซ้ำทุกตัว (70% ของคำขอ) และ 503 แล้วยังยิงต่อจนฐานฟื้นไม่ได้\n'
      + '   แก้: createClient(url, key, { global: { fetch: guardedFetch } })\n');
  });
  /* 🔴 โซ่ต้องครบทั้ง 2 ชั้น และ "ถอยเมื่อ 503" ต้องครอบ**นอก** ตัวยุบคำขอซ้ำ
     (ถ้ากลับด้าน คำขอที่ถูกพักจะถูกยุบเป็นคีย์เดียวกับของจริง = ปล่อยผ่านเงียบ) */
  assert.match(code, /makeDedupeFetch\(/, 'ต้องสร้าง dedupeFetch จาก makeDedupeFetch');
  assert.match(code, /connFetch\(\s*dedupeFetch\s*\)/,
    '\n\n❌ โซ่ fetch ผิดลำดับ — ต้องเป็น connFetch(dedupeFetch)\n'
    + '   ทำไม: 21/10 ฐานข้อมูลตอบ 503 ทุกคำขอ แต่ทุกจอยังยิงต่อจังหวะเดิม ⇒ ฟื้นเองไม่ได้ 25 นาที\n'
    + '   📄 src/utils/connGuard.js\n');
});

/* ── 🔴 ต่อฐานข้อมูลไม่ได้ ต้องเขียนบนจอ ห้ามหมุนค้าง (21/10 · เหตุการณ์จริง) ──
   จอขึ้นแค่ "กำลังโหลด..." ⇒ หน้างานนึกว่าเน็ตตัวเองช้า เลยกดรีเฟรชซ้ำ = ยิงใหม่ทั้งหน้า
   ⇒ โหลดพุ่งตอนที่ฐานข้อมูลอ่อนแรงที่สุด (ENGINEERING-PRINCIPLES: ห้ามล้มเหลวเงียบ) */
test('🛡️ conn-banner-mounted — แถบเตือน "เชื่อมต่อไม่ได้" ต้องถูกวางใน App.jsx', () => {
  const app = stripComments(readFileSync(join(ROOT, 'src/App.jsx'), 'utf8'));
  assert.match(app, /<ConnBanner\s*\/>/, 'App.jsx ต้องวาง <ConnBanner /> (ไม่งั้นต่อไม่ได้แล้วจอเงียบ)');
  assert.match(app, /from '\.\/components\/ConnBanner'/, 'App.jsx ต้อง import ConnBanner');
  const guard = stripComments(readFileSync(join(ROOT, 'src/utils/connGuard.js'), 'utf8'));
  // การเขียนต้องผ่านเสมอ — บล็อกการบันทึกของคน = งานหาย/ไม่รู้ว่าสำเร็จไหม
  assert.match(guard, /method !== 'GET'/, 'connGuard ต้องปล่อยทุก method ที่ไม่ใช่ GET ผ่านเสมอ');
});

/* ── 🧪 งานชุบภายนอก — ทุกการเขียนผ่าน RPC `plating_*` เท่านั้น (13/10 · คำสั่ง user) ──
   ส่ง/รับ/ตัดยอด/ส่งเข้า W/H เขียน 2-3 ตารางพร้อมกัน (ใบ + ประวัติ + ledger ทั้งต้นทางและปลายทาง)
   เขียนแยกจาก client = ล้มครึ่งทาง ⇒ ของหายจากคลังแต่ไม่ไปค้างร้าน (หรือรับคืนแล้วยอดค้างไม่ลด)
   และชื่อที่เก็บเสมือนของร้านใน ledger ต้องตรงกันทั้ง JS และ SQL ไม่งั้นยอดค้างร้านแยก 2 ถัง */
test('🛡️ plating-writes-via-rpc — ห้ามเขียน plating_orders/plating_moves ตรงจากจอ · ชื่อคลังร้านตรงกับ RPC', () => {
  const bad = [];
  for (const f of walk(join(ROOT, 'src'), ['.js', '.jsx'])) {
    const rel = relative(ROOT, f);
    if (rel.includes('__tests__')) continue;
    const code = stripComments(readFileSync(f, 'utf8'));
    if (/from\(\s*['"]plating_(orders|moves)['"]\s*\)\s*\.\s*(insert|update|upsert|delete)\b/.test(code)) bad.push(rel);
  }
  assert.deepEqual(bad, [], '\n\n❌ เขียนตารางงานชุบตรงจากจอ — ใช้ supabaseDR.rpc(\'plating_*\') แทน:\n' + bad.map(b => '   • ' + b).join('\n'));
  const js = readFileSync(join(ROOT, 'src/utils/plating.js'), 'utf8');
  const sql = readFileSync(join(ROOT, 'supabase/migrations/20261013_plating_loop_dr.sql'), 'utf8');
  const pre = (js.match(/VENDOR_LOC_PREFIX\s*=\s*'([^']+)'/) || [])[1];
  assert.ok(pre, 'หา VENDOR_LOC_PREFIX ใน utils/plating.js ไม่เจอ');
  assert.ok(sql.includes(`'${pre}' || btrim(p_vendor)`), `ชื่อคลังร้านใน RPC plating_send ต้องเป็น '${pre}' || vendor ให้ตรงกับ JS`);
});

/* ── 🖥️ บัญชีกลางห้ามลบ — ด่านต้องอยู่ "ก่อน" admin bypass (2026-10-13 · คำสั่ง user) ──
   บัญชีกลาง = จอ TV / บัญชีประจำเครื่อง-กะ (`maintenance` · `toolingmaintenance` · TV-1..13)
   ใช้ร่วมกันหลายคน ⇒ ลบแถวแล้วสอบกลับไม่ได้ว่าใครกด (audit เขียนได้แค่ชื่อบัญชี)
   🔴 บัญชี `ADMIN` ในฐานจริงก็เป็นบัญชีกลาง ⇒ ถ้าเช็ค `_sharedAccount` **หลัง** `role === 'admin'`
      ด่านนี้จะไร้ผลกับบัญชีที่อันตรายที่สุด (ลบได้ทุกตาราง) — เคยพลาดแบบเดียวกันที่ล็อกช่องเซ็น MO
      ("ล็อกเต็ม manage_master ก็ข้ามไม่ได้")                                                   */
test('🛡️ shared-account-no-delete — canDelete ต้องเช็คบัญชีกลางก่อน admin bypass', () => {
  const code = stripComments(readFileSync(join(ROOT, 'src/utils/permissions.js'), 'utf8'));
  const fn = code.slice(code.indexOf('export function canDelete'));
  const body = fn.slice(0, fn.indexOf('\n}'));
  const iShared = body.indexOf('_sharedAccount');
  const iAdmin = body.indexOf("role === 'admin'");
  assert.ok(iShared >= 0,
    '\n\n❌ canDelete ไม่มีด่านบัญชีกลาง (_sharedAccount) แล้ว\n'
    + '   ผล: บัญชีกลาง (จอ TV / maintenance / toolingmaintenance) กดลบได้อีก\n'
    + '        แล้ว audit สอบกลับไม่ได้ว่าใครกด (คำสั่ง user 13/10 "บัญชีกลาง ไม่ควรลบได้")\n');
  assert.ok(iAdmin < 0 || iShared < iAdmin,
    '\n\n❌ ด่านบัญชีกลางอยู่หลัง admin bypass — บัญชี ADMIN เองเป็นบัญชีกลาง\n'
    + '   ⇒ ด่านไร้ผลกับบัญชีที่ลบได้ทุกตาราง · ย้าย `if (_sharedAccount) return false;` ขึ้นบนสุด\n');
});


/* ── 🖥️ ห้ามตั้งตัวแปรท้องถิ่นชื่อ `canDelete` ทับ util (ออดิท 13/10) ──────────────────
   เจอจริง 5 หน้า: `const canDelete = can('products','delete', role)` ⇒ **อ่านโค้ดเหมือนมีด่าน
   แต่เป็น `can()` เปล่าๆ** ⇒ ด่าน "บัญชีกลางห้ามลบ" (canDelete ของกลาง) ไม่ทำงานเลย
   และ grep หา `canDelete(` ก็เจอ = หลงว่าครอบแล้ว · ตัวที่โดน: ลบสินค้า · ปิดเครื่องจักร ·
   ลบใบ LPA · ลบ event log · ลบ OJT — ของที่ลบแล้วกู้ไม่ได้ทั้งนั้น
   🔴 ถ้าจะมีตัวแปรสรุปสิทธิ์ลบในหน้า ให้ชื่ออื่น (เช่น `mayDelete`) แล้วค่าต้องมาจาก util    */
test('🛡️ no-shadow-candelete — ห้ามประกาศตัวแปร/พารามิเตอร์ชื่อ canDelete ในหน้า', () => {
  const bad = [];
  for (const f of walk(join(ROOT, 'src'), ['.js', '.jsx'])) {
    const rel = relative(ROOT, f);
    if (rel === 'src/utils/permissions.js' || rel.includes('__tests__')) continue;
    const code = stripComments(readFileSync(f, 'utf8'));
    if (/\b(?:const|let|var)\s+canDelete\s*=/.test(code)) bad.push(rel);
  }
  assert.deepEqual(bad, [], '\n\n❌ ประกาศ canDelete ทับ util (ด่านบัญชีกลางจะไม่ทำงาน):\n'
    + bad.map(b => '   • ' + b).join('\n')
    + '\n   แก้: ตั้งชื่อ `mayDelete` แล้วเรียก canDelete() ของกลาง\n'
    + '        import { canDelete as canDeleteUtil } from \'../utils/permissions\';\n');
});

/* ── 🔴 "ใบนี้ว่าง" ≠ "พาร์ทนี้ไม่มีลูก" (2026-10-14 · user ส่งภาพจอ 4 ใบ) ──────────
   `items` = บรรทัดของ **ใบที่เปิดอยู่** เท่านั้น ⇒ ใบของพาร์ทที่เพิ่งเปิดยังว่าง
   แต่ใบ FG กรอกลูกของมันไว้แล้ว ⇒ จอขึ้น "ยังไม่มีพาร์ทย่อยใน BOM นี้" = **จอโกหก**
   เคสจริง: ใบ 20058495 ว่าง · ใบ FG 10086024 กรอก 20058498 ไว้ใต้มันแล้ว
   ⇒ ต้องถามด้วย `sheetsWithKidsOf()` (buildBomIndex) ก่อนจะประกาศว่าไม่มีลูก          */
test('🛡️ /products BOM: ใบว่างต้องเช็ค sheetsWithKidsOf ก่อนขึ้น "ยังไม่มีพาร์ทย่อย"', () => {
  const code = stripComments(readFileSync(join(ROOT, 'src/pages/ProductMaster.jsx'), 'utf8'));
  assert.ok(/sheetsWithKidsOf/.test(code),
    '\n\n❌ ProductMaster ไม่ได้ถาม `sheetsWithKidsOf` แล้ว\n'
    + '   ทำไมผิด: `items.length === 0` = ใบนี้ว่าง ไม่ได้แปลว่าพาร์ทนี้ไม่มีลูก\n'
    + '   (ลูกอาจถูกกรอกไว้ในใบ FG — เคสจริง 20058495/10086024 · user แจ้ง 14/10)\n'
    + '   แก้ยังไง: kidsElsewhere = bomIx.sheetsWithKidsOf(mat) แล้วกางให้ดูด้วย startSheet\n');
  const i = code.indexOf('ยังไม่มีพาร์ทย่อยใน BOM นี้');
  assert.ok(i > 0 && /kidsElsewhere/.test(code.slice(Math.max(0, i - 2500), i)),
    '\n\n❌ ข้อความ "ยังไม่มีพาร์ทย่อยใน BOM นี้" ไม่ได้อยู่หลังด่าน `kidsElsewhere` แล้ว\n'
    + '   = ประกาศว่าไม่มีลูก ทั้งที่ยังไม่ได้ถามว่าใบอื่นกรอกไว้ไหม\n');
  const tree = stripComments(readFileSync(join(ROOT, 'src/utils/bomTree.js'), 'utf8'));
  assert.ok(/opt\.startSheet\s*!==\s*undefined/.test(tree),
    '\n\n❌ explodeBom ไม่รับ `startSheet` แล้ว — พาร์ทที่ลูกถูกกรอกไว้ในใบอื่นจะกางไม่ออกเลย\n'
    + '   (sheetFor(mat, undefined) ตอบได้แค่ "ใบของ mat เอง" ซึ่งอาจว่างหรือไม่มี)\n');
});

/* ── 🏃 คนวิ่งข้ามแผนก = "อ้างอิง" ไม่ใช่การย้ายสังกัด (14/10 · feedback user "ใช่ คนวิ่งข้ามแผนก") ──
   ทางที่ง่ายแต่ผิดคือ "ย้าย `employees.org_node_id` ให้เลย" หรือ "ยัด `line_id` ให้"
   ⇒ cost center ของคนเปลี่ยนตามหน่วย (วัด 14/10: 11 จาก 12 แผนกมี cost_center ของตัวเอง)
      แล้ว activity rate ใน `utils/costSaving.js` = ตัวคูณ "เงินที่ประหยัดได้" ทุกจอ เพี้ยนทั้งระบบ
      และ Checkin/Report จะนับเขาเป็นคนของหน่วยใหม่ (คลาสเดียวกับที่ `line_technicians` แก้ไว้แล้ว)
   ⇒ บอร์ดกำลังคน **ห้ามเขียนทะเบียนพนักงาน/ไลน์/cost center** — เขียนได้แค่ `employee_flex_units`
   🔴 "ไปช่วย ≠ นับเป็นกำลังคน" คุมด้วยเทสพฤติกรรมใน `manpowerBoard.test.mjs` (ช่องว่าง/ตัวนับห้ามขยับ) */
test('🛡️ manpower-flex-reference-only — จอบอร์ดกำลังคนห้ามย้ายสังกัด/แก้ cost center ของคน', () => {
  for (const f of ['src/pages/ManpowerBoard.jsx', 'src/components/ManpowerBoardSetup.jsx']) {
    const code = stripComments(readFileSync(join(ROOT, f), 'utf8'));
    assert.ok(!/from\(\s*['"]employees['"]\s*\)\s*\.\s*(update|upsert|insert|delete)/.test(code),
      `\n\n❌ ${f} เขียนทะเบียนพนักงาน — บอร์ดนี้อ่านอย่างเดียว\n`
      + '   ย้ายสังกัด = cost center ของคนเปลี่ยน (11/12 แผนกมี cc ของตัวเอง) ⇒ activity rate ทุกจอเพี้ยน\n'
      + '   แก้: ผูกผ่านตาราง employee_flex_units (อ้างอิง) — บ้านจริงไม่ขยับ\n');
    assert.ok(!/cost_center\s*:/.test(code),
      `\n\n❌ ${f} เขียนค่า cost_center — cost center เป็นของหน่วยต้นสังกัด ห้ามให้บอร์ดนี้แตะ\n`);
  }
  const util = stripComments(readFileSync(join(ROOT, 'src/utils/manpowerBoard.js'), 'utf8'));
  assert.ok(/flexUnits\s*=\s*\[\]/.test(util),
    '\n\n❌ buildManpowerBoard ไม่ได้ตั้ง flexUnits เป็น optional default [] — ไม่ส่งแล้วต้องได้พฤติกรรมเดิมเป๊ะ\n');
  assert.ok(/flexFrom/.test(util),
    '\n\n❌ การ์ดคนวิ่งข้ามแผนกไม่ติดธง flexFrom — จอจะแยกไม่ออกว่าใครเป็นคนของแผนกจริง\n');
  const page = stripComments(readFileSync(join(ROOT, 'src/pages/ManpowerBoard.jsx'), 'utf8'));
  assert.ok(/buildManpowerBoard\(\{[^}]*flexUnits/.test(page),
    '\n\n❌ หน้าบอร์ดไม่ส่ง flexUnits เข้า buildManpowerBoard — ทะเบียนมีข้อมูลแต่จอไม่โชว์ (ตายเงียบ)\n');

  /* 🎖️ รักษาการ (20/10) — ทะเบียนเดียวกับคนวิ่งข้ามแผนก แยกด้วยคอลัมน์ `kind`
     ลืม select('kind') = แถว acting ตกเป็น flex (ค่า default ของ flexKind)
     ⇒ ผจก.รักษาการไปโผล่เป็นการ์ด 🏃 ในแผนกแทนที่จะขึ้นหัวผัง — ผิดแบบเงียบ */
  assert.ok(/from\(\s*['"]employee_flex_units['"]\s*\)[\s\S]{0,160}?kind/.test(page),
    '\n\n❌ หน้าบอร์ดไม่ได้ select คอลัมน์ `kind` ของ employee_flex_units\n'
    + '   ⇒ แถวรักษาการถูกตีเป็น "คนวิ่งข้ามแผนก" (ค่า default) = ขึ้นผิดแถวเงียบๆ\n');
  assert.ok(/acting/.test(util),
    '\n\n❌ buildManpowerBoard ไม่รู้จัก acting แล้ว — ป้ายรักษาการหายจากหัวผัง\n');
  /* รักษาการ/คนวิ่งข้ามแผนก **ห้ามเข้าตัวนับกำลังคน** — ตัวนับต้องมาจากแถวพนักงาน (cols[].ops) เท่านั้น */
  assert.ok(/opsTotal:\s*allOps\.length/.test(util),
    '\n\n❌ opsTotal ไม่ได้นับจาก allOps (cols[].ops) แล้ว — flex/acting อาจถูกนับเป็นกำลังคน\n');
  for (const k of ['flex', 'acting']) {
    assert.ok(!new RegExp(`allOps\\s*=\\s*[^;]*${k}`).test(util),
      `\n\n❌ allOps ถูกผสม ${k} เข้าไป — "ไปช่วย/รักษาการ ≠ นับเป็นกำลังคน" (กฎ CLAUDE.md)\n`);
  }
});

/* ── 👯 คู่ RH/LH ต้องอยู่ไลน์เดียวกัน (14/10 · เคสจริง GOR 297) ──
   ตั้ง pair_mat_no ก่อนชุบ↔หลังชุบ (คนละไลน์) ⇒ Daily Report เด้ง MAT คู่ให้ใบถัดไป → 12 ใบลงเป็นเลขหลังชุบทั้งกะ
   ด่าน: จุดตั้งคู่ (Product Master) + จุดผูกคู่ตอนเปิดใบ (Daily Report) ต้องผ่าน pairBlockReason() */
test('🛡️ pair-same-line — ตั้งคู่/ผูกคู่ RH/LH ต้องผ่าน pairBlockReason()', () => {
  const pm = stripComments(readFileSync(join(ROOT, 'src/pages/ProductMaster.jsx'), 'utf8'));
  const dr = stripComments(readFileSync(join(ROOT, 'src/pages/DailyReport.jsx'), 'utf8'));
  assert.match(pm, /pairBlockReason\(/, 'ProductMaster ต้องเช็ค pairBlockReason ก่อนบันทึก pair_mat_no');
  assert.match(dr, /pairBlockReason\(/, 'DailyReport ต้องเช็ค pairBlockReason ก่อนผูกคู่/เด้ง MAT คู่');
  assert.doesNotMatch(dr, /const partnerMatNo = products\.find\([^)]*\)\?\.pair_mat_no/, 'ห้ามอ่าน pair_mat_no ตรงๆ เป็น partnerMatNo โดยไม่ผ่านด่าน');
});

test('🛡️ pm-checkpoint-copy-via-util — คัดลอกจุดตรวจต้องผ่าน checkpointCopyRow() (ล้างหมุดเมื่อข้ามเครื่อง)', () => {
  const rel = 'src/lib/pmChecklists.js';
  const code = stripComments(readFileSync(join(ROOT, rel), 'utf8'));
  const bad = [];
  /* แตก cp ด้วยมือ (`({ id, created_at, ... checklist_id, ...rest })`) = ข้ามกฎล้างหมุด ⇒ หมุดผูกรูปเครื่องต้นทางกลับมา */
  if (/\(\s*\{\s*id\s*,\s*created_at[^}]*\.\.\.rest\s*\}\s*\)/.test(code)) bad.push(rel + ' (แตกแถวจุดตรวจด้วยมือ)');
  if (!/checkpointCopyRow\s*\(/.test(code)) bad.push(rel + ' (ไม่เรียก checkpointCopyRow)');
  assert.deepEqual(bad, [], '\n\n❌ ' + bad.join(', ') + '\n'
    + '   ทำไม: x_pos/y_pos/label_dx/label_dy/image_id ผูกกับ "รูปของเครื่องต้นทาง" — ก๊อปข้ามเครื่องแล้วหมุดไปโผล่ผิดที่บนจอตั้งค่า\n'
    + '         และหายไปเลยบนจอตรวจ (14/10 เจอจริง 9 จุด) · jig_id ต้องเป็นเครื่องปลายทาง\n'
    + '   แก้: ใช้ checkpointCopyRow() จาก src/utils/pmCheckpointCopy.js · ข้ามแผนกบนเครื่องเดิมส่ง samePhotos:true\n');
});

test('🛡️ pm-check-stale-guard — ใบตรวจ PM บันทึกได้เฉพาะเมื่อจุดตรวจเป็นของเครื่องที่เปิดอยู่', () => {
  const rel = 'src/pages/PMCheckData.jsx';
  const code = stripComments(readFileSync(join(ROOT, rel), 'utf8'));
  const bad = [];
  if (!/loadReqRef\.current/.test(code)) bad.push('ไม่มี loadReqRef (request id ของการโหลดเครื่อง)');
  const save = code.slice(code.indexOf('const handleSave'), code.indexOf('const handleSave') + 900);
  if (!/cpLoad\.status\s*!==\s*'ok'/.test(save) || !/cpLoad\.key/.test(save)) bad.push('handleSave ไม่เช็ค cpLoad (status + key เครื่อง|แผนก)');
  assert.deepEqual(bad, [], '\n\n❌ ' + rel + ': ' + bad.join(', ') + '\n'
    + '   ทำไม: สลับเครื่องเร็วๆ คำตอบของเครื่องก่อนมาถึงทีหลังแล้วเขียน checklistId/จุดตรวจทับ ⇒ ผลตรวจลง jig_id\n'
    + '         เครื่องใหม่ + checklist_id เครื่องเก่า (audit PM 19/10)\n'
    + '   แก้: ทุก callback ในเอฟเฟกต์โหลดเครื่องเทียบ loadReqRef · handleSave เช็ค cpLoad.status === ok และ key ตรงเครื่อง|แผนก\n');
});

/* ── 🔨 ชิ้น/จังหวะ ของแม่พิมพ์ — "ไม่รู้" ห้ามกลายเป็น 1 (14/10 · คำสั่ง user "ควรนับ shot ไม่ใช่นับชิ้น สำหรับงานคู่") ──
   migration 20260810 ออกแบบ 2 ชั้นไว้แล้ว (equipment_die ว่าง = ใช้ค่าของ die_sets) แต่ไม่เคยถูกเขียนจริง
   ⇒ จอ PM อ่านแค่ชั้น OP ที่ว่าง 264/264 = คิด shot ไม่ได้สักตัว · และชั้นชุดเป็น default 1 + จอบีบ `?? 1` ตอนเซฟ
   = ระบบประกาศเองว่าแม่พิมพ์ทุกตัวปั๊มได้ 1 ชิ้น · งานคู่ LH/RH ปั๊มทีเดียว 2 ชิ้น ⇒ PM เด้งช้าไป 2 เท่า */
test('🛡️ die-pps-no-guess-one — ชิ้น/จังหวะต้องผ่าน ppsOf() และห้ามเดาเป็น 1', () => {
  const bad = [];
  const util = stripComments(readFileSync(join(ROOT, 'src/utils/pmUsage.js'), 'utf8'));
  if (!/export function ppsOf\s*\(/.test(util)) bad.push('src/utils/pmUsage.js (ไม่มี ppsOf แล้ว)');
  /* ถอยชั้นต้องอยู่ในตัวมันเอง ไม่ใช่ให้หน้าไปทำเอง */
  if (!/die\?\.pieces_per_stroke[\s\S]{0,80}set\?\.pieces_per_stroke/.test(util))
    bad.push('src/utils/pmUsage.js (ppsOf ไม่ได้ถอยจากชั้น die ไปชั้นชุดแล้ว)');

  const reg = stripComments(readFileSync(join(ROOT, 'src/pages/DieRegistry.jsx'), 'utf8'));
  if (/pieces_per_stroke[^\n]*\?\?\s*1\b/.test(reg))
    bad.push('src/pages/DieRegistry.jsx (บีบ pieces_per_stroke ว่าง → 1 ตอนเซฟ/ตอนโชว์)');

  /* หน้าไหนจะคิด shot ต้องขอค่าผ่าน ppsOf ห้ามหยิบคอลัมน์ดิบไปหาร
     08/11: สูตร shot ของแม่พิมพ์ย้ายไป src/utils/dieUsage.js (คิดย้อนตามสาย) — ตัวนั้นต้องเรียก ppsOf (โหมด legacy) */
  for (const rel of ['src/utils/dieUsage.js']) {
    const code = stripComments(readFileSync(join(ROOT, rel), 'utf8'));
    if (!/ppsOf\s*\(/.test(code)) bad.push(rel + ' (ไม่เรียก ppsOf)');
  }
  for (const rel of ['src/components/PmUsageBoard.jsx', 'src/utils/dieUsage.js']) {
    const code = stripComments(readFileSync(join(ROOT, rel), 'utf8'));
    if (/piecesToShots\s*\([^)]*\.pieces_per_stroke/.test(code))
      bad.push(rel + ' (ส่งคอลัมน์ดิบเข้า piecesToShots — ข้ามการถอยชั้น)');
  }
  assert.deepEqual(bad, [], '\n\n❌ ' + bad.join(', ') + '\n'
    + '   ทำไม: แม่พิมพ์สเปค "ทน 50,000 shot" ถ้าระบบคิด 1 ชิ้น = 1 shot กับงานคู่\n'
    + '         PM จะเด้งตอนครบ 50,000 ชิ้น = 25,000 shot จริง = ช้าไป 2 เท่า แม่พิมพ์พังก่อนถึงคิว\n'
    + '   แก้: ppsOf(die, set) ใน src/utils/pmUsage.js · ไม่รู้ = null จอต้องเขียนบอก ห้ามเดา 1\n');
});

/* ── 🔨 แม่พิมพ์นับจากพาร์ทของชุด ห้ามกลับไปใช้ยอดไลน์ (2026-11-08 · คำสั่ง user) ───────
   *"ไลน์ 800 ผลิตงาน a100, b100 เครื่องทำ 200 shot แต่ a ไม่ได้เท่ากับ 200"*
   เดิมจอยอดผลิตสะสมให้แม่พิมพ์ทุกตัวในไลน์ = ยอดทั้งไลน์ · วัดจริง: เกินยอดพาร์ทจริง ~15 เท่า
   ⇒ แม่พิมพ์ต้องผ่าน dieUsage() (MAT ของชุด · ทุกไลน์) · ไม่ผูก MAT = null "นับไม่ได้" ห้ามถอยไปยอดไลน์ */
test('🛡️ die-usage-by-part — แม่พิมพ์นับจาก MAT ของชุด ไม่ใช่ยอดไลน์', () => {
  const bad = [];
  const board = stripComments(readFileSync(join(ROOT, 'src/components/PmUsageBoard.jsx'), 'utf8'));
  if (!/dieUsage\s*\(/.test(board)) bad.push('PmUsageBoard.jsx (ไม่เรียก dieUsage)');
  if (!/isDie\s*\?\s*du\.pieces\s*:/.test(board)) bad.push('PmUsageBoard.jsx (ยอดของแม่พิมพ์ไม่ได้มาจาก dieUsage)');
  const util = stripComments(readFileSync(join(ROOT, 'src/utils/dieUsage.js'), 'utf8'));
  if (!/if\s*\(\s*!mats\.length\s*\)\s*return null/.test(util)) bad.push('dieUsage.js (ชุดไม่ผูก MAT ต้องคืน null)');
  if (/line_name\s*:\s*r\.line_name/.test(util)) bad.push('dieUsage.js (กลับไปนับตามไลน์)');
  assert.deepEqual(bad, [], '\n\n❌ ' + bad.join(', ') + '\n'
    + '   ทำไม: ไลน์ผลิตหลายพาร์ท — แม่พิมพ์ของพาร์ท A ทำงานเฉพาะตอนผลิต A · ยอดไลน์ = PM แม่พิมพ์เด้งเร็วผิด\n'
    + '   แก้: dieUsage() ใน src/utils/dieUsage.js · RPC pm_usage_daily_by_mat (DR)\n');
});

/* ── 🔴 คำเตือน "5xx ปนกับ 2xx/3xx" ห้ามกลับมา (2026-10-14 · user แก้ให้เอง) ───────
   *"เบอร์ 5 เป็นเบอร์ 1 เลยก็มีนะ มีบางงานเป็นแบบนั้น ไม่ต้องขึ้นโชว์แบบนี้ก็ได้
     เราน่าจะบอกผิดไปครั้งก่อน"*
   เดิมเตือนจาก **รูปแบบเลข** ไม่ใช่จากหลักฐาน ⇒ เตือนผิด 40 แถว
   คำเตือนที่เตือนผิดบ่อย ทำให้คนเลิกเชื่อคำเตือนที่ถูกด้วย (raw_double_counted ที่พิสูจน์ได้)
   ⇒ เหลือเตือนเฉพาะที่ไล่ถึงจริง · ห้ามเอา raw_in_assembly กลับมาโดยไม่ถาม user       */
test('🛡️ BOM flow: ห้ามมีคำเตือน raw_in_assembly (5xx ใต้ 1xx = ปกติ)', () => {
  const tree = stripComments(readFileSync(join(ROOT, 'src/utils/bomTree.js'), 'utf8'));
  assert.ok(!/raw_in_assembly/.test(tree),
    '\n\n❌ `raw_in_assembly` กลับมาใน bomTree.js\n'
    + '   user สั่งถอดเอง 14/10: 5xx ไปเป็นลูกของ 1xx ตรงๆ เป็นของจริง ไม่ใช่ความผิด\n'
    + '   จะเอากลับมาต้องถาม user ก่อน (เตือนผิด 40 แถว = คนเลิกเชื่อคำเตือนที่เหลือ)\n');
  assert.ok(/raw_double_counted/.test(tree),
    '\n\n❌ `raw_double_counted` หายไป — ตัวนี้พิสูจน์ได้ (5xx อยู่ใต้พี่น้อง 2xx จริง) ห้ามถอด\n');
});

/* ── 🧹 conflict marker ห้ามหลุดเข้า main (2026-10-14 · เจอตอนตรวจย้อนงานตัวเอง) ──────
   คอมมิท `66bdd954` merge งาน 2 session ในไฟล์ `.md` เดียวกัน แล้ว marker 3 บรรทัด
   (`<<<<<<<` / `=======` / `>>>>>>>`) ค้างอยู่ — **ผ่านทุกด่านเพราะ build ไม่คอมไพล์ `.md`**
   เอกสารที่มี marker = คนอ่านไม่รู้ว่าฝั่งไหนจริง (เอกสารผิดแย่กว่าไม่มีเอกสาร)
   · ถ้าหลุดเข้าไฟล์ `.js/.jsx` = จอขาวทั้งหน้า (syntax error)
   🔴 ด่านนี้สแกนทั้งรีโป — เจอ = แปลว่า merge ยังไม่จบ ห้าม commit                     */
test('🛡️ no-merge-conflict-markers — ไม่มี marker ค้างในรีโปทั้ง code และ docs', () => {
  const files = [
    ...walk(join(ROOT, 'src'), ['.js', '.jsx', '.mjs', '.css']),
    ...walk(join(ROOT, 'docs'), ['.md']),
    ...walk(join(ROOT, 'supabase'), ['.sql']),
  ];
  const bad = [];
  for (const f of files) {
    const txt = readFileSync(f, 'utf8');
    // ต้นบรรทัดเท่านั้น — `=======` กลางตารางเอกสาร/เส้นคั่นไม่ใช่ marker
    const hit = txt.split('\n').findIndex(l => /^<{7} |^>{7} |^={7}$/.test(l));
    if (hit >= 0) bad.push(`${relative(ROOT, f)}:${hit + 1}`);
  }
  assert.deepEqual(bad, [], '\n\n❌ มี conflict marker ค้าง: ' + bad.join(', ') + '\n'
    + '   แปลว่า merge ยังไม่จบ — ต้องตัดสินว่าเก็บฝั่งไหน (ส่วนใหญ่เก็บทั้ง 2 ฝั่งแล้วคั่นหัวข้อ)\n'
    + '   ของจริงที่เคยหลุด: docs/modules/manpower-board.md (66bdd954) — build ไม่จับเพราะเป็น .md\n');
});

/* ── 🔨 ชุดแม่พิมพ์ปั๊มออกคู่ = ผูกได้ 2 MAT (14/10 · คำสั่ง user "แม่พิมพ์ปั๊มออกคู่ ซ้ายขวา ก็ควรเลือก mat สองตัว") ──
   เดิม `die_sets.mat_no` ช่องเดียว แล้วปลายทางเทียบ `d.mat_no === mat` ตรงๆ
   ⇒ ล็อตของฝั่งที่ไม่ได้ลงเป็นช่องแรก **หาแม่พิมพ์ไม่เจอ** = ไม่รู้ die_height_mm
     = pressSetup คืน unknown_height = คิดเวลาเปลี่ยนรุ่นไม่ได้ · ผังแม่พิมพ์ก็ไม่รู้ว่าชุดนั้นป้อนไลน์ไหน */
test('🛡️ die-set-two-mats — หาแม่พิมพ์ของพาร์ทต้องผ่าน dieMakesMat()/dieSetMats()', () => {
  const bad = [];
  const util = stripComments(readFileSync(join(ROOT, 'src/utils/dieSetMats.js'), 'utf8'));
  for (const fn of ['dieSetMats', 'dieMakesMat', 'dieSetPairState', 'suggestPps', 'dieSetsForMat', 'matSlotFor']) {
    if (!new RegExp(`export function ${fn}\\s*\\(`).test(util)) bad.push(`src/utils/dieSetMats.js (ไม่มี ${fn})`);
  }
  /* suggestPps ต้องไม่เสนอ 1 — "ชุดทำพาร์ทเดียว" ไม่ได้แปลว่า 1 ชิ้น/จังหวะ (2-out ของพาร์ทเดียวก็มี) */
  if (!/n >= 2 \? n : null/.test(util)) bad.push('src/utils/dieSetMats.js (suggestPps เสนอค่าต่ำกว่า 2 แล้ว = เดาแทนหน้างาน)');

  for (const rel of ['src/components/ProdLotPlanner.jsx', 'src/components/DieLayout.jsx']) {
    const code = stripComments(readFileSync(join(ROOT, rel), 'utf8'));
    if (!/die(SetMats|MakesMat|SetsForMat)\s*\(/.test(code)) bad.push(rel + ' (ไม่เรียกของกลาง)');
    /* เทียบช่องแรกตรงๆ กับตัวแปรชุดแม่พิมพ์ = ตกฝั่งที่ลงช่อง 2 */
    if (/\bd(ie(Set)?)?\.mat_no\s*===/.test(code)) bad.push(rel + ' (เทียบ die.mat_no === ตรงๆ)');
  }
  /* 🔎 pairHint = เดาจากชื่อ/เลขพาร์ท (ท่าสุดท้าย) — ใช้ชี้เป้าให้คนไปกรอกได้ แต่ **ห้ามเขียนกลับฐาน**
     "ชุดนี้ทำ 2 พาร์ท" ≠ "1 จังหวะได้ 2 ชิ้น" · tandem 24 OP ตอกทีละตัวก็ชื่อ RH/LH เหมือนกัน */
  /* ⚠️ ตรวจ "รายบรรทัด" ไม่ใช่ `update\([^)]*pairHint` — payload มักถูกประกอบไว้ก่อนแล้วส่งเป็นตัวแปร
     (`update(payload)`) ⇒ ด่านแบบดูในวงเล็บจะหลุดทุกครั้ง (เจอตอนยิงทดสอบด่านนี้เอง 15/10) */
  for (const rel of ['src/pages/DieRegistry.jsx', 'src/utils/dieSetMats.js']) {
    const code = stripComments(readFileSync(join(ROOT, rel), 'utf8'));
    for (const line of code.split('\n')) {
      if (!/pairHint/.test(line)) continue;
      if (/\b(pieces_per_stroke|pair_mat_no|shot_total)\b/.test(line))
        bad.push(rel + ' (ผล pairHint ไปลงคอลัมน์จริง — เดาแล้วเขียนฐาน)');
      if (/piecesToShots|ppsOf/.test(line))
        bad.push(rel + ' (เอาผล pairHint ไปคิด shot)');
    }
  }

  /* ช่องกรอกต้องมีให้ลงจริง ไม่งั้นคอลัมน์ว่างตลอด */
  const reg = stripComments(readFileSync(join(ROOT, 'src/pages/DieRegistry.jsx'), 'utf8'));
  if (!/mat_no_2/.test(reg)) bad.push('src/pages/DieRegistry.jsx (ไม่มีช่อง MAT ตัวที่ 2)');

  /* 🔗 ปุ่ม "ตั้งคู่ให้เลย" = หน้าแม่พิมพ์ยืมมือเขียน dr_products ⇒ ต้องผ่านด่านครบเหมือน Product Master
     ถอดด่านไหนออก: ข้ามไลน์ = คู่ผิด (เคสจริง GOR 297) · ไม่นับแถว = RLS ปฏิเสธแล้วขึ้น "สำเร็จ"
     · เขียนทางเดียว = คู่ชี้ข้างเดียว = collapsePairShots ยุบไม่ครบ · ใช้สิทธิ์ผิดใบ = ใครก็แก้ทะเบียนสินค้าได้ */
  if (/pair_mat_no/.test(reg)) {
    if (!/pairBlockReason\s*\(/.test(reg)) bad.push('src/pages/DieRegistry.jsx (เขียน pair_mat_no โดยไม่ผ่าน pairBlockReason)');
    if (!/checkWriteRows\s*\(/.test(reg)) bad.push('src/pages/DieRegistry.jsx (เขียน pair_mat_no โดยไม่นับแถว)');
    if (!/can\(\s*'products'\s*,\s*'edit'/.test(reg)) bad.push("src/pages/DieRegistry.jsx (ตั้งคู่ต้องใช้สิทธิ์ products:edit ไม่ใช่ machines:edit)");
    /* 2 ทาง = เขียน "ค่าจริง" 2 ครั้ง — ⚠️ ห้ามนับรวม `pair_mat_no: null` (= ปลดคู่เก่า ไม่ใช่การผูก)
       นับรวมแล้วด่านจะหลวม: ถอดการผูกฝั่งหนึ่งออก ยอดก็ยังครบ 2 (เจอตอนยิงเทสด่านนี้เอง 14/10) */
    /* ⚠️ lookahead ต้องอยู่ "ก่อน" \s* — เขียน `\s*(?!null)` จะถูก backtrack (\s* ยอมจับ 0 ตัว
       แล้ว lookahead ไปมองที่ช่องว่าง = ผ่านเสมอ) ⇒ นับ `pair_mat_no: null` เข้ามาด้วย ด่านหลวมทันที */
    const writes = (reg.match(/update\(\s*\{\s*pair_mat_no:(?!\s*null\b)/g) || []).length;
    if (writes < 2) bad.push(`src/pages/DieRegistry.jsx (ผูกคู่ ${writes} ทาง — ต้อง 2 ทาง ไม่งั้นคู่ชี้ข้างเดียว)`);
  }

  /* 🔗 ช่องเลือกแม่พิมพ์ของล็อต (19/10) — `die_sets.mat_no` ผูกไว้ 1/92 ชุด
     ⇒ ยื่นแต่ชุดที่ "ทะเบียนยืนยันแล้ว" = ลิสต์ว่างแทบทุกพาร์ท **คนที่รู้ก็เลือกไม่ได้ = ทางตัน**
     (die_no ว่าง ⇒ ไม่รู้ความสูง ⇒ เวลาเปลี่ยนรุ่นคิดไม่ได้ · วัดจริง 0/8 ใบมี die_no)
     แต่กอง "ยังไม่ผูก" ห้ามให้ระบบหยิบเอง — ยังไม่มีใครยืนยันว่าชุดนั้นทำพาร์ทนี้ */
  const pl = stripComments(readFileSync(join(ROOT, 'src/components/ProdLotPlanner.jsx'), 'utf8'));
  if (!/unlinked/.test(pl)) bad.push('src/components/ProdLotPlanner.jsx (ช่องเลือกแม่พิมพ์ไม่ยื่นกองที่ยังไม่ผูก MAT = ทางตัน)');
  /* เลือกให้เองได้เฉพาะตอนทะเบียนชี้ชัด "ตัวเดียว" — 2 ชุดทำ MAT เดียวกันมีจริง (10 กลุ่ม) */
  if (!/\.linked\b/.test(pl) || !/linked\.length === 1/.test(pl))
    bad.push('src/components/ProdLotPlanner.jsx (auto-เลือกแม่พิมพ์ไม่ได้จำกัดที่ linked ตัวเดียว = เดาความสูงผิด)');
  /* ผูก MAT จากหน้าแผน = ยืมมือเขียนทะเบียนแม่พิมพ์ ⇒ ต้องใช้สิทธิ์ของทะเบียน + นับแถว */
  if (/from\('die_sets'\)\s*\n?\s*\.update|from\('die_sets'\)\.update/.test(pl)) {
    if (!/can\(\s*'machines'\s*,\s*'edit'/.test(pl))
      bad.push("src/components/ProdLotPlanner.jsx (ผูก MAT ต้องใช้สิทธิ์ machines:edit ไม่ใช่ production_plan:write)");
    if (!/checkWriteRows\s*\(/.test(pl))
      bad.push('src/components/ProdLotPlanner.jsx (เขียน die_sets โดยไม่นับแถว — RLS ปฏิเสธ = 0 แถว ไม่มี error)');
    if (!/matSlotFor\s*\(/.test(pl))
      bad.push('src/components/ProdLotPlanner.jsx (เขียน die_sets โดยไม่ผ่าน matSlotFor = ทับ MAT ที่คนกรอกไว้)');
  }

  assert.deepEqual(bad, [], '\n\n❌ ' + bad.join(', ') + '\n'
    + '   ทำไม: gang die ปั๊มทีเดียวได้ RH+LH — ทะเบียนลงได้ 2 MAT (mat_no + mat_no_2)\n'
    + '         เทียบช่องแรกช่องเดียว = อีกฝั่งหาแม่พิมพ์ไม่เจอเงียบๆ\n'
    + '   แก้: dieMakesMat(set, mat) / dieSetMats(set) จาก src/utils/dieSetMats.js\n'
    + '   ⚠️ "ใครคู่กับใคร" ยังเป็นของ Product Master (pair_mat_no) — จอแม่พิมพ์เตือนได้ ห้ามเขียนทับ\n');
});

/* ── 🛒 ใบขอซื้อ (PR) งานช่าง — รับของต้องผ่าน RPC เดียว · ห้ามลบ (14/10 · MTN REQUEST) ──
   รับของ = เปลี่ยนสถานะ + เข้าสต็อก ถ้าเขียน 2 คำสั่งแยกจาก client แล้วอันหลังล้ม
   ⇒ PR ขึ้น "รับแล้ว" แต่สต็อกไม่เข้า (กฎเหล็ก DB ข้อ 6) · ประวัติขอซื้อห้ามหาย = ยกเลิกแทนลบ
   📄 `docs/modules/mtn-work-order.md` §🛒 PR / GL / IO */
test('🛡️ mtn-pr-receive-via-rpc — รับของ PR ผ่าน mtn_pr_receive · ห้าม delete PR', () => {
  const bad = [];
  for (const f of walk(join(ROOT, 'src'), ['.js', '.jsx'])) {
    const src = stripComments(readFileSync(f, 'utf8'));
    if (!/mtn_purchase_requests/.test(src)) continue;
    if (/from\(['"]mtn_purchase_requests['"]\)[\s\S]{0,200}?\.delete\(/.test(src)) bad.push(`${relative(ROOT, f)} (delete)`);
    if (/status:\s*['"]received['"]/.test(src)) bad.push(`${relative(ROOT, f)} (เขียน status received เอง)`);
    /* 19/10 คำสั่ง user: "เลข PR มาจาก SAP แอดมินช่างกรอก" ⇒ ระบบห้ามออกเลขเอง */
    if (/mtn_assign_pr_no|from\(['"]mtn_pr_seq['"]\)/.test(src)) bad.push(`${relative(ROOT, f)} (ระบบออกเลข PR เอง — เลขต้องมาจาก SAP)`);
  }
  assert.deepEqual(bad, [],
    '\n\n❌ ใบขอซื้อ (PR) ถูกลบ หรือถูกตั้ง "received" ตรงจาก client: ' + bad.join(', ') + '\n'
    + '   ทำไมห้าม: รับของต้องเปลี่ยนสถานะ + เข้าสต็อกในทรานแซกชันเดียว → RPC `mtn_pr_receive`\n'
    + '            ยกเลิก = status `cancelled` + เหตุผล (ประวัติขอซื้อห้ามหาย)\n');
});

/* ═══ 🔒 ลบข้ามทีมไม่ได้ — ทะเบียนของช่างต้องมีด่าน "เจ้าของทีม" (คำสั่ง user 2026-10-14) ═══
   ที่มา: หัวหน้าแผนกผลิตถูกตั้งเป็น `is_dept_admin` เพื่อให้เพิ่มอะไหล่เองได้
          bucket dept_admin ถือ `mtn_repair:delete` ติดมาด้วย ⇒ ลบอะไหล่ของทีม MTN/DIE ได้
          user: *"ให้เพิ่มได้ แต่จะลบมั่วไม่ได้ … เห็นข้ามกันหมด แต่ลบข้ามกันไม่ได้"*
   ด่านนี้จับ "ปุ่มลบหลุดกลับไปเช็คแค่สิทธิ์" ซึ่งเป็นการถอยที่มองไม่เห็นจากหน้าจอ
   (ฝั่ง DR เป็น anon ไม่มี RLS ช่วย ⇒ ด่านหน้าจอคือด่านเดียวที่มี) */
test('🔒 คลังอะไหล่ — ปุ่มแก้/ลบต้องผ่านด่านเจ้าของทีม (teamRowOwner) ไม่ใช่ด่านสิทธิ์ล้วน', () => {
  const bad = [];
  const sp = stripComments(readFileSync(join(ROOT, 'src/components/SparePartMaster.jsx'), 'utf8'));

  if (!/teamRowOwner\s*\(/.test(sp)) bad.push('src/components/SparePartMaster.jsx (ไม่ได้เรียก teamRowOwner)');
  /* ปุ่มลบต้องผูกกับตัวที่รวม 2 ด่านแล้ว — เขียน canDelete(...) ลอยๆ = ลบข้ามทีมได้ทันที */
  if (/<DeleteButton[^>]*/.test(sp) && !/mayDeleteRow\s*\(/.test(sp))
    bad.push('src/components/SparePartMaster.jsx (ปุ่มลบไม่ได้ผ่าน mayDeleteRow)');
  /* ซ่อนปุ่มอย่างเดียวไม่พอ — ตัวเขียนจริงต้องกันซ้ำ (fail-closed) */
  const del = sp.slice(sp.indexOf('const doDelete'), sp.indexOf('const doDelete') + 900);
  if (!/mayDeleteRow\s*\(/.test(del)) bad.push('src/components/SparePartMaster.jsx (doDelete ไม่มีด่านซ้ำ)');
  /* soft delete ผ่าน update ⇒ RLS ปฏิเสธ = 0 แถว ไม่มี error (กฎเหล็ก DB ข้อ 2) */
  if (!/checkWriteRows\s*\(/.test(del)) bad.push('src/components/SparePartMaster.jsx (doDelete ไม่ได้นับแถว)');

  /* กฎต้องมีที่เดียว — หน้าไหนก๊อปเงื่อนไขไปเขียนเองแปลว่าจะ drift */
  const mr = stripComments(readFileSync(join(ROOT, 'src/pages/MtnRepair.jsx'), 'utf8'));
  if (/canEditRow\s*=/.test(mr) && !/teamRowOwner\s*\(/.test(mr))
    bad.push('src/pages/MtnRepair.jsx (canEditRow เขียนเงื่อนไขเอง ไม่ผ่าน teamRowOwner)');

  /* fallback ที่ห้ามหาย — ยังไม่ตั้งทีม = ไม่ล็อก ไม่งั้นช่างทำอะไรไม่ได้ทั้งระบบวันที่ deploy */
  const own = readFileSync(join(ROOT, 'src/utils/mtnTeamOwn.js'), 'utf8');
  if (!/code:\s*'unscoped'/.test(own)) bad.push("src/utils/mtnTeamOwn.js (ถอด fallback 'unscoped' ออก)");

  /* 🔩 คีย์แยก spare_master ต้องไม่กลายเป็นประตูหลังของ manage_master
     — ผู้ถือคีย์ใหม่ต้องเป็น strict (ไม่มีทีม = แก้ของเดิมไม่ได้) ไม่งั้นด่านแทบไม่ทำงาน */
  if (/spare_master/.test(sp) && !/strict:\s*strictOwn/.test(sp))
    bad.push('src/components/SparePartMaster.jsx (spare_master ไม่ได้บังคับ strict)');
  /* นำเข้าไฟล์ Excel อัพเดททีละหลายร้อยแถว — ไม่กัน = ด่านรายแถวไร้ความหมาย */
  if (/function ImportModal/.test(sp) && !/ownOf\(r\.existing\)/.test(sp))
    bad.push('src/components/SparePartMaster.jsx (นำเข้าไฟล์ไม่ได้กันแถวของทีมอื่น)');

  assert.deepEqual(bad, [], '\n\n❌ ' + bad.join(', ') + '\n'
    + '   ทำไม: dept_admin/mtn ถือคีย์ลบ ⇒ ด่านสิทธิ์ผ่านหมด แต่ต้องลบได้เฉพาะของทีมตัวเอง\n'
    + '   แก้: teamRowOwner(row, { myTeams, role }) จาก src/utils/mtnTeams.js\n'
    + '        (ตรรกะจริง src/utils/mtnTeamOwn.js · แถวทีมอื่น = เห็นได้ แต่ต้องขึ้น 🔒 บอกเหตุผล ห้ามซ่อนเงียบ)\n');
});

/* ── 🔴 จอ "BOM ซ้ำ 2 ใบ" ต้องเทียบ qty ไม่ใช่แค่รายชื่อ MAT (2026-10-14) ──────────
   เดิมเทียบเฉพาะชุด mat ⇒ คู่ที่ของตรงกันแต่ **จำนวนต่าง** ถูกตีเป็น `identical`
   แล้วขึ้นจอว่า "ตรงกัน" (เทา) = จอโกหก · เคสจริง 20066663 : 0.171 ↔ 0.341 (ต่าง 2 เท่า)
   และลายนิ้วมือต้องรวม qty ด้วย ไม่งั้นมีคนแก้แค่จำนวน คู่ที่ "ตรวจแล้ว" จะไม่กลับเข้าคิว */
test('🛡️ bomDupAudit: qty ต้องอยู่ในกติกา + อยู่ในลายนิ้วมือ', () => {
  const code = stripComments(readFileSync(join(ROOT, 'src/utils/bomDupAudit.js'), 'utf8'));
  assert.ok(/qty_diff/.test(code) && /pair_shot/.test(code),
    '\n\n❌ หาย verdict ที่เกิดจากการเทียบ qty (`qty_diff` / `pair_shot`)\n'
    + '   ถอดออก = คู่ที่จำนวนไม่ตรงจะกลับไปขึ้นว่า "ตรงกัน" อีก (จอโกหก)\n');
  assert.ok(/fingerprint:\s*dupFingerprint\(\s*withQty\(/.test(code),
    '\n\n❌ ลายนิ้วมือไม่ได้รวม qty แล้ว\n'
    + '   ⇒ แก้แค่จำนวนแล้วคู่ที่ตรวจไปแล้วจะไม่กลับเข้าคิว = ตัวเลขเปลี่ยนโดยไม่มีใครรู้\n');
  /* ชิ้น ≠ shot เป็นกฎเหล็กของโปรเจค — ห้ามยุบ 2 กรณีนี้เป็นอันเดียว
     (qty ผิด = แก้ตัวเลข · ×2 = เคาะหน่วยทั้งโรงงาน — คนละทางแก้) */
  const audit = require_like(code);
  assert.ok(audit.qtyRank < audit.pairRank,
    '\n\n❌ `qty_diff` ต้องร้อนกว่า `pair_shot` — ตัวเลขผิดจริงเร่งกว่าเรื่องหน่วย\n');
  function require_like(src) {
    const q = /qty_diff:\s*\{\s*rank:\s*(\d+)/.exec(src);
    const p = /pair_shot:\s*\{\s*rank:\s*(\d+)/.exec(src);
    assert.ok(q && p, '\n\n❌ อ่าน rank ของ qty_diff / pair_shot ไม่ได้ — เปลี่ยนรูปแบบแล้วต้องอัปเดตด่านนี้\n');
    return { qtyRank: +q[1], pairRank: +p[1] };
  }
});

/* ── 🖼️ ใบพิมพ์ FM-JIG-003 ห้ามยืดรูปเต็มกรอบ (A7 · ประชุมหน้างาน 02/11 · 2026-11-03) ──
   เดิม PDF `addImage(img, x, y, กว้างกรอบ, สูงกรอบ)` + Excel `ext: 130×52` ตายตัว ⇒ รูปมือถือแนวตั้งถูกดึงแบน
   และหมุดทุกจุดถูกวาดลงรูปหลักแม้วางไว้บนรูปมุมอื่น ⇒ "รูปขนาดผิด อยู่ผิดที่" · ของกลาง `utils/imageFit.js` */
test('🛡️ pm-export-image-fit — ใบพิมพ์ PM ต้องวางรูปผ่าน fitContain + หมุดผ่าน pinsOnFrame', () => {
  const pdf = stripComments(readFileSync(join(ROOT, 'src/lib/pmExportPDF.js'), 'utf8'));
  const xls = stripComments(readFileSync(join(ROOT, 'src/lib/pmExportExcel.js'), 'utf8'));
  const bad = [];
  if (!/fitContain\(/.test(pdf)) bad.push('pmExportPDF.js ไม่ได้ใช้ fitContain');
  if (!/pinsOnFrame\(/.test(pdf)) bad.push('pmExportPDF.js ไม่ได้กรองหมุดต่อเฟรมด้วย pinsOnFrame');
  if (/addImage\([^)]*IMG_W\s*-\s*1\s*,\s*IMG_H\s*-\s*1\)/.test(pdf)) bad.push('pmExportPDF.js ยืดรูปเครื่องเต็มกรอบ (IMG_W-1, IMG_H-1)');
  if (/ext:\s*\{\s*width:\s*130,\s*height:\s*52\s*\}/.test(xls)) bad.push('pmExportExcel.js ยืดรูปจุดเป็น 130×52 ตายตัว');
  if (!/fitContain\(/.test(xls)) bad.push('pmExportExcel.js ไม่ได้ใช้ fitContain');
  assert.deepEqual(bad, [], '\n\n❌ ' + bad.join('\n❌ ') + '\n   แก้: placeImage()/fitContain() คงสัดส่วน · หมุดเป็น % ของรูปจริง · กรองเฟรมด้วย pinsOnFrame() (📄 docs/modules/inspection-point-setup.md §A7)\n');
});

/* ── 🎯 ตั้งค่าจุดตรวจ PM + QA = ชิ้นส่วนกลางชุดเดียว (2026-10-15 · คำสั่ง user) ─────────
   *"ใช้หลักการเดียวกันในการสร้าง — ต่างแค่อุปกรณ์ vs ชิ้นงาน · user เรียนระบบเดียวแล้วทำเป็นทั้งคู่"*
   เดิม 2 จอใช้หมุดตัวเดียวกันแต่วิธีทำคนละแบบ (PM บันทึกครั้งเดียว / QA เขียนทุกคลิก · QA ไม่มีรูปจุด ·
   PM ไม่มีซูม) ⇒ ถ้าหน้าใดกลับไปวาดโมดัล/ผังรูป-การ์ดเอง 2 จอจะแยกทางกันอีกเงียบๆ
   📄 docs/modules/inspection-point-setup.md */
test('🛡️ inspection-setup-shared — จอตั้งค่าจุดตรวจ PM/QA ต้องใช้ชิ้นส่วนกลาง components/inspect/', () => {
  const files = { 'src/pages/PMSetup.jsx': 'PM', 'src/components/QaPointsEditor.jsx': 'QA' };
  const need = ['InspectEditorModal', 'PinWorkspace', 'PointCardShell', 'usePointJump', 'SpinAnnotator'];
  const bad = [];
  for (const [f, who] of Object.entries(files)) {
    const code = readFileSync(join(ROOT, f), 'utf8');
    for (const n of need) if (!new RegExp(`import\\s+${n}\\b`).test(code)) bad.push(`${who} (${f}) ไม่ได้ใช้ ${n}`);
  }
  // ฝั่งตรวจ: รูปโคลสอัพเปิดด้วยตัวกลางเดียวกันทั้ง PM/QA (15/10)
  for (const f of ['src/pages/PMCheckData.jsx', 'src/components/QaCheckSheet.jsx', 'src/components/QaPieceStepper.jsx']) {
    if (!/from '\.{1,2}\/(components\/)?inspect\/PointZoom'/.test(readFileSync(join(ROOT, f), 'utf8'))) bad.push(`${f} ไม่ได้ใช้ PointZoom/PointThumb (รูปจุดตอนตรวจ)`);
  }
  // หน้า QA ห้ามกลับไปแก้จุดตรวจเอง (เขียน qa_inspection_items ตรง) — ต้องผ่านโมดัลกลาง
  const qa = stripComments(readFileSync(join(ROOT, 'src/pages/QAInspectionSetup.jsx'), 'utf8'));
  if (/from\('qa_inspection_items'\)\s*\.(insert|update|delete|upsert)/.test(qa)) bad.push('QAInspectionSetup.jsx เขียน qa_inspection_items เอง');
  /* คัดลอกจุดตรวจ QA ข้ามพาร์ท (19/10): แถวผ่าน qaItemCopyRow · ไฟล์ต้องคัดลอกจริง ห้ามแชร์ path
     (delPart ลบทั้งโฟลเดอร์ parts/<id> ⇒ แชร์ = รูปของพาร์ทปลายทางหายตาม) */
  /* 🧮 จุดคำนวณ A − B (19/10): ใบตรวจต้องเติมค่าผ่านตัวกลาง · ตั้งค่าใช้ช่องกลางเดียวกัน
     (คิดเองในหน้า = PM/QA คิดคนละแบบ · ไม่เติม = คนตรวจต้องพิมพ์ผลต่างเอง หรือใบค้างกรอกไม่ครบ) */
  for (const [f, fn] of [['src/pages/PMCheckData.jsx', 'pmCalcResults'], ['src/components/QaPieceStepper.jsx', 'qaCalcDraft']]) {
    if (!new RegExp(`\\b${fn}\\(`).test(readFileSync(join(ROOT, f), 'utf8'))) bad.push(`${f} ไม่ได้เติมค่าจุดคำนวณผ่าน ${fn}()`);
  }
  for (const f of ['src/pages/PMSetup.jsx', 'src/components/QaPointsEditor.jsx']) {
    if (!/import\s+CalcFormulaField\b/.test(readFileSync(join(ROOT, f), 'utf8'))) bad.push(`${f} ไม่ได้ใช้ CalcFormulaField (ช่องตั้งสูตรกลาง)`);
  }
  const cp = stripComments(readFileSync(join(ROOT, 'src/lib/qaPointsCopy.js'), 'utf8'));
  if (!/qaItemCopyRow\(/.test(cp)) bad.push('lib/qaPointsCopy.js ไม่ได้สร้างแถวผ่าน qaItemCopyRow()');
  if (!/\.copy\(/.test(cp)) bad.push('lib/qaPointsCopy.js ไม่ได้ storage.copy ไฟล์เข้าโฟลเดอร์ปลายทาง (แชร์ path = รูปหายเมื่อลบต้นทาง)');
  assert.deepEqual(bad, [], '\n\n❌ ' + bad.join('\n   ') + '\n'
    + '   ทำไม: ตั้งค่าจุดตรวจ PM กับ QA ต้องเป็น "ระบบเดียว" (โมดัล · ผังรูปซ้าย/การ์ดขวา · ซูม · ปักหมุด ·\n'
    + '         รูปโคลสอัพ · ไปที่จุด · บันทึกครั้งเดียว) ต่างกันได้แค่ช่องสเปคในการ์ด\n'
    + '   แก้: ประกอบจาก src/components/inspect/* + SpinAnnotator · แก้พฤติกรรมที่ชิ้นกลางที่เดียว\n');
});

/* ── 🔐 ชั้นที่ 3 ของสิทธิ์ห้ามหายไป (2026-10-15 · คำสั่ง user) ─────────────────────
   *"user บาง role เข้าหน้าได้ทุกหน้า แต่ต้องไม่มีสิทธิ์ไปแก้ข้อมูลส่วนงานคนอื่น"*
   📄 ผลตรวจ 20 จุดรั่ว → docs/modules/permission-scope-audit.md
   ด่านนี้คุม 2 เรื่องที่พังเงียบได้ง่ายที่สุด:
   ① `writeScope.js` ต้องไม่เอา `sections` (= ขอบเขตที่ **เห็น**) มาตัดสินการ **แก้**
      — 31/122 บัญชีมี `sections` ว่างโดยตั้งใจ (ช่างต้องเห็นทุกไลน์) ⇒ ใช้ตัดสินการแก้ = เปิดทั้งโรงงาน
   ② จอที่มีด่านแล้ว ต้องเช็ค **ซ้ำในฟังก์ชันที่เขียนจริง** ไม่ใช่แค่ซ่อนปุ่ม (deep-link เปิดตรงได้) */
/* 🛡️ leader-line-wins — "หัวหน้ากลุ่มเห็นทุกไลน์" ห้ามกลับมา (24/10 · แจ้งจากหน้างาน)
   เคสจริง: หัวหน้า LWR BAR / HYDROFORM ถูกตั้ง `scope_depth='all'` ⇒ effectiveSections() คืน []
   ⇒ จอที่กรองด้วย `sections` อย่างเดียวโชว์ทั้งโรงงาน
   ⇒ แกน "ไลน์" ต้องมาก่อนแกน "ส่วนงาน" ใน scopedLines() เสมอ และทุกจุดเรียกต้องส่ง role/lineId */
test('🛡️ leader-line-wins — scopedLines ต้องบีบ leader กลับเป็นครอบครัวไลน์ตัวเอง', () => {
  const bad = [];
  const ss = stripComments(readFileSync(join(ROOT, 'src/utils/sectionScope.js'), 'utf8'));
  /* 🔁 29/10 — ตรรกะย้ายไปอยู่ `lineScope()` (แกนเดียวของ scopedLines + scopedLineNames)
     เจตนาเดิมคงไว้ครบ แค่เปลี่ยนที่ตรวจ · พฤติกรรมจริงถูกคุมด้วย
     src/utils/__tests__/lineScopeOneAnswer.test.mjs (ยิงเคสเดียวกันเข้าทั้ง 2 ทาง) */
  if (!/export function lineScope\(\{\s*role,\s*lineId,/.test(ss))
    bad.push('sectionScope.js (lineScope ไม่ได้รับ role/lineId)');
  if (!/role === 'leader' && lineId/.test(ss))
    bad.push('sectionScope.js (lineScope ไม่มีกิ่ง leader)');
  /* กิ่ง leader ต้องอยู่ **ก่อน** ทางที่คืน "ทั้งโรงงาน" เพราะไม่มี sections
     — ไม่งั้น scope_depth=all จะหลุดไปเห็นทุกไลน์เหมือนเคสจริง 24/10 */
  const iLeader = ss.indexOf("role === 'leader' && lineId");
  const iAll = ss.indexOf("if (!secs.length) return out(all,");
  if (iLeader < 0 || iAll < 0 || iLeader > iAll)
    bad.push('sectionScope.js (กิ่ง leader ต้องมาก่อนทางที่คืนทั้งโรงงาน)');
  if (!/export function scopeTooWide/.test(ss))
    bad.push('sectionScope.js (ไม่มี scopeTooWide — คิวทบทวนสิทธิ์จะไม่ฟ้องการตั้งกว้างเกิน)');

  /* ทุกจุดเรียก scopedLines ต้องส่ง role เข้าไป ไม่งั้นตาข่ายไม่ทำงานที่จอนั้น */
  for (const f of walk(join(ROOT, 'src'), ['.jsx', '.js'])) {
    if (/utils[\\/]sectionScope\.js$/.test(f) || /__tests__/.test(f)) continue;
    const src = stripComments(readFileSync(f, 'utf8'));
    for (const m of src.matchAll(/scopedLines\(\{([^}]*)\}/g)) {
      if (!/\brole\b/.test(m[1])) bad.push(`${f.replace(ROOT + '/', '')} (scopedLines ไม่ส่ง role)`);
    }
  }
  assert.deepEqual(bad, [], 'ด่าน "หัวหน้ากลุ่มเห็นทุกไลน์" หาย:\n' + bad.join('\n'));
});

test('🛡️ write-scope-layer — ด่าน "แก้ข้ามหน่วยงาน" ยังอยู่ครบ', () => {
  const bad = [];
  const ws = stripComments(readFileSync(join(ROOT, 'src/utils/writeScope.js'), 'utf8'));
  for (const fn of ['writeUnitsOf', 'hasAllUnits', 'canWriteUnit', 'canWriteLine', 'writeBlockText']) {
    if (!new RegExp(`export (function|const) ${fn}\\b`).test(ws)) bad.push(`writeScope.js (ไม่มี ${fn})`);
  }
  /* บ้านจริงต้องชนะเมื่อ sections ว่าง — ถ้ามีใครกลับไปคืน [] (= ไม่จำกัด) ตอน sections ว่าง จะรั่วทันที */
  if (!/const one = String\(section \|\| ''\)\.trim\(\);[\s\S]{0,60}return one \? \[one\] : \[\];/.test(ws))
    bad.push('writeScope.js (writeUnitsOf ไม่ได้ถอยไปใช้ profiles.section)');
  if (!/role === 'admin' \|\| allUnits === true/.test(ws))
    bad.push("writeScope.js (เสีย fallback admin หรือคีย์ scope:all_units)");

  /* ชั้น context — ถ้า `allUnits` หลุดจาก UserContext ทุกจอจะเห็นเป็น undefined = บล็อกหมด/เปิดหมดแล้วแต่จุด */
  const app = stripComments(readFileSync(join(ROOT, 'src/App.jsx'), 'utf8'));
  if (!/allUnits:\s*can\('scope',\s*'all_units'/.test(app))
    bad.push("src/App.jsx (UserContext ไม่ได้ส่ง allUnits)");

  /* 💰 19/10 — สลับ 20 จอมาใช้แกน Cost Center: สลับที่ `writeScope.js` ที่เดียว
     ⇒ จอที่เรียกด่านต้อง **ส่ง `respCostCenters` + `scopeIdx` มาใน ctx** ไม่งั้นจอนั้นค้างอยู่
     แกนข้อความเดิมแบบเงียบ (แอดมินติ๊ก CC แล้วไม่มีผลที่จอนั้น = สิทธิ์ไม่ตรงที่ตั้ง) */
  if (!/from '\.\/ccScope\.js'/.test(ws)) bad.push('writeScope.js (ไม่ได้ import canWriteScope — แกน CC หลุด)');
  if (!/const ccLine = ccDecide\(/.test(ws)) bad.push('writeScope.js (canWriteLine ไม่ได้ลองแกน CC ที่ตัวไลน์ก่อน)');
  if (!/if \(idx\?\.failed\) return \{ ok: false, code: 'scope_unreadable' \}/.test(ws))
    bad.push('writeScope.js (เสีย fail-closed ตอนอ่านผังไม่ได้ — จะถอยไปใช้ sections ที่กว้างกว่า)');
  if (!/scopeIdx:\s*userScopeIdx/.test(app)) bad.push('src/App.jsx (UserContext ไม่ได้ส่ง scopeIdx)');
  const CTX_PROP_OK = {
    // รับ ctx เป็น prop จากหน้าแม่ (หน้าแม่เป็นคนประกอบ ctx) — ไม่ต้องมี scopeIdx ของตัวเอง
    'src/components/QaCopyPointsModal.jsx': 1,
  };
  for (const f of walk(join(ROOT, 'src'), ['.js', '.jsx'])) {
    const rel = relative(ROOT, f);
    if (rel === 'src/utils/writeScope.js' || CTX_PROP_OK[rel]) continue;
    const src = stripComments(readFileSync(f, 'utf8'));
    if (!/\b(?:canWriteUnit|canWriteLine|writableRows)\s*\(/.test(src)) continue;
    /* เช็ครายบรรทัด: ทุกที่ที่เอ่ย `allUnits` (ctx ของด่าน · deps · บรรทัด destructure)
       ต้องมี `scopeIdx` + `respCostCenters` ด้วย — ประกอบ ctx ใหม่โดยลืม 2 ช่องนี้ = จอนั้น
       ค้างแกนเดิมแบบเงียบ (ไฟล์มีคำนี้อยู่ที่อื่นแล้วก็ยังจับได้) */
    src.split('\n').forEach((ln, i) => {
      if (!/\ballUnits\b/.test(ln)) return;
      if (!/\bscopeIdx\b/.test(ln) || !/\brespCostCenters\b/.test(ln))
        bad.push(`${rel}:${i + 1} (บรรทัดนี้มี allUnits แต่ไม่มี respCostCenters/scopeIdx ⇒ ด่านค้างที่แกนข้อความเดิม)`);
    });
  }

  /* จอที่ปิดรูแล้ว — ด่านต้องถูกเรียกในฟังก์ชันเขียนจริง ไม่ใช่แค่ตอน render ปุ่ม */
  const kpi = stripComments(readFileSync(join(ROOT, 'src/components/KpiMonthly.jsx'), 'utf8'));
  const guards = (kpi.match(/if \(!scopeWrite\.ok\)/g) || []).length;
  if (guards < 5) bad.push(`KpiMonthly.jsx (ด่านใน handler เหลือ ${guards} จุด — ต้องมีทุกฟังก์ชันที่เขียน)`);
  if (!/unknownTarget: 'block'/.test(kpi))
    bad.push('KpiMonthly.jsx (ขอบเขตระดับโรงงาน/ฝ่ายต้องบังคับ unknownTarget:block)');

  assert.deepEqual(bad, [], '\n\n❌ ' + bad.join(', ') + '\n'
    + '   ทำไม: ระบบมี "เข้าหน้าได้ไหม" + "กดปุ่มเป็นไหม" แต่ไม่มี "แถวนี้ของหน่วยงานเราไหม"\n'
    + '         ⇒ แอดมินหน่วยงานฝ่ายช่างเปิด ?scope=department:<แผนกอื่น> แล้วแก้ KPI ของเขาได้\n'
    + '   แก้: canWriteUnit()/canWriteLine() จาก src/utils/writeScope.js + เรียกซ้ำใน handler\n');
});

/* ── 🔴 LPA: คำตอบห้ามข้ามไลน์ — stale-response race (2026-10-19 · QC audit ข้อ ④) ───────────
   `/lpa` โหลดใบร่าง/แผนด้วย `await` แล้ว `setState` **โดยไม่มี guard** ⇒ สลับไลน์เร็วๆ แล้ว
   คำตอบของคิวรีเก่ามาทับจอ · ที่ร้ายคือคำถามชั้น `common` (`line_name = null`)
   **ใช้ `question_id` ร่วมกันทุกไลน์** ⇒ กดบันทึกต่อ = **คำตอบของไลน์ A ไปลงเป็นของไลน์ B ไม่มี error**
   (ข้อเฉพาะไลน์จะชน PK แล้วเด้ง error งงๆ · และใบร่างที่มาช้ายัง**ทับคำตอบที่คนกำลังติ๊กอยู่**)
   LPA = บันทึก audit ตามระบบคุณภาพ ⇒ เขียนผิดใบแล้วย้อนไม่ได้ และคนตรวจไม่รู้ตัว
   ⇒ ต้องมี 2 ชั้น: ① ทิ้งคำตอบที่มาช้า ② ตอนกดบันทึก เช็คว่าของบนจอเป็นของที่เลือกอยู่ (fail-closed) */
test('🛡️ lpa-stale-draft-guard — ใบตรวจ/แผน LPA ต้องกันคำตอบที่มาช้า + ห้ามเขียนข้ามไลน์', () => {
  const bad = [];
  const sv = stripComments(readFileSync(join(ROOT, 'src/utils/staleView.js'), 'utf8'));
  for (const fn of ['viewKey', 'isStale', 'staleBlockText']) {
    if (!new RegExp(`export (?:const|function) ${fn}\\b`).test(sv)) bad.push(`staleView.js (ไม่มี ${fn})`);
  }
  /* คีย์ว่าง = ยังไม่โหลด ≠ ของไลน์อื่น — ถ้าเผลอตีเป็น stale จอที่ยังไม่มีข้อมูลจะกดบันทึกไม่ได้เลย */
  if (!/!!loadedKey && loadedKey !== currentKey/.test(sv))
    bad.push('staleView.js (isStale ไม่ได้ยกเว้น "ยังไม่เคยโหลด")');

  const lpa = stripComments(readFileSync(join(ROOT, 'src/pages/LayerProcessAudit.jsx'), 'utf8'));
  // ชั้น ① — ทิ้งคำตอบที่มาช้า (loadMonth · loadQuarter 2 จุด · ใบร่าง)
  const drops = (lpa.match(/(?:monthKeyRef|draftKeyRef)\.current !== key/g) || []).length;
  if (drops < 4) bad.push(`LayerProcessAudit.jsx (ด่านทิ้งคำตอบที่มาช้าเหลือ ${drops} จุด — ต้องมีทุก loader ที่ setState หลัง await)`);
  if (!/setDraft\(\{ key, id: existing\.id/.test(lpa) || !/setDraft\(\{ key, id: null/.test(lpa))
    bad.push('LayerProcessAudit.jsx (ใบร่างไม่ได้พก key ของตัวเอง ⇒ ด่านชั้น 2 เช็คไม่ได้)');
  // ชั้น ② — ห้ามเขียนเมื่อของบนจอไม่ใช่ของที่เลือกอยู่
  if (!/const draftMismatch = \(\) =>/.test(lpa)) bad.push('LayerProcessAudit.jsx (ไม่มี draftMismatch)');
  if (!/const monthMismatch = \(loadedKey\) =>/.test(lpa)) bad.push('LayerProcessAudit.jsx (ไม่มี monthMismatch)');
  for (const [fn, re] of [
    ['saveAudit', /const saveAudit = async \(\) => \{[\s\S]{0,200}?draftMismatch\(\)/],
    ['deleteAudit', /const deleteAudit = async \(\) => \{[\s\S]{0,200}?draftMismatch\(\)/],
    ['savePlan', /const savePlan = async \(\) => \{[\s\S]{0,200}?monthMismatch\(/],
    ['saveQuarter', /const saveQuarter = async \(\) => \{[\s\S]{0,200}?monthMismatch\(/],
  ]) {
    if (!re.test(lpa)) bad.push(`LayerProcessAudit.jsx (${fn} ไม่ได้เช็คว่าของบนจอเป็นของที่เลือกอยู่ก่อนเขียน)`);
  }

  assert.deepEqual(bad, [], '\n\n❌ ' + bad.join('\n   ') + '\n'
    + '   ทำไม: คำถาม LPA ชั้น common ใช้ question_id ร่วมกันทุกไลน์ ⇒ ใบร่างที่มาช้าทับจอแล้วกดบันทึก\n'
    + '         = คำตอบไปลงผิดไลน์ **โดยไม่มี error** · เป็นบันทึก audit ⇒ ย้อนไม่ได้\n'
    + '   แก้: viewKey/isStale จาก src/utils/staleView.js — ทิ้งคำตอบที่มาช้า + เช็คคีย์ก่อนเขียนทุกปุ่ม\n');
});

/* ── 🪪 คิว "บัญชีที่ยังไม่รู้ว่าเป็นใคร" ห้ามกลับไปเป็นข้อความเปล่า (2026-10-19 · คำสั่ง user) ──
   เดิมจอ `/add-user` บอกแค่ "ยังไม่ระบุประเภทบัญชี · N บัญชี" **ไม่มีชื่อ ไม่มีปุ่ม**
   ⇒ ต้องไปไล่หาเองใน 122 แถว ⇒ ไม่มีใครทำ ค้างมาตลอด (18 ใบ)
   🔴 ตัวเลขต้องพูดให้ตรง: `shared` 31 ใบที่ไม่ผูกตัวตน **ถูกต้องแล้ว ไม่ใช่งานค้าง**
      ⇒ ห้ามรวมเป็นเลขเดียว ("49 ไม่ผูกพนักงาน") ⇒ ต้องผ่าน `unlinkedTriage()` ที่แยก 3 กอง
   🔴 `normSearch` ต้องมีบ้านเดียว (`utils/thaiText.js`) — ตัวเทียบชื่อของ `identityMatch` ต้องเป็น
      ตัวเดียวกับที่ picker ใช้ค้น ไม่งั้น "จอบอกว่าไม่มีชื่อนี้" กับ "ค้นแล้วเจอ" ขัดกันเอง */
test('🛡️ unlinked-account-queue — คิวบัญชีไม่ผูกตัวตนต้องมีชื่อ + ปุ่ม + แยกบัญชีกลางออก', () => {
  const bad = [];
  const im = stripComments(readFileSync(join(ROOT, 'src/utils/identityMatch.js'), 'utf8'));
  for (const fn of ['employeeCandidates', 'unlinkedTriage', 'routeHint']) {
    if (!new RegExp(`export function ${fn}\\b`).test(im)) bad.push(`identityMatch.js (ไม่มี ${fn})`);
  }
  /* ชื่อซ้ำ/ชื่อต้นตรง ต้องไม่ถูกผูกให้เอง — `confident` ต้องผูกกับ "เจอคนเดียว" เท่านั้น */
  /* 28/10 เข้มขึ้น: ต้อง "เจอคนเดียว" **และ** คนนั้นยังไม่ถูกบัญชีอื่นจอง (ด่าน link-suggest-must-check-taken) */
  if (!/confident: free\.length === 1 && same\.length === 1/.test(im))
    bad.push('identityMatch.js (confident ไม่ได้ผูกกับ "ชื่อตรง เจอคนเดียว และยังไม่ถูกจอง" — เสี่ยงผูกผิดคน/ชน unique)');
  if (!/tier: 'first', rows: first\.slice\(0, limit\)\.map\(mark\), confident: false/.test(im))
    bad.push('identityMatch.js (ชั้น "ชื่อต้นตรง" ต้อง confident=false เสมอ)');
  if (!/e\.is_active !== false/.test(im)) bad.push('identityMatch.js (เสนอคนที่ลาออกแล้วได้)');

  const au = stripComments(readFileSync(join(ROOT, 'src/pages/AddUser.jsx'), 'utf8'));
  if (!/unlinkedTriage\(users, emps\)/.test(au)) bad.push('AddUser.jsx (ไม่ได้แยก 3 กองผ่าน unlinkedTriage)');
  if (!/tri\.queue\.map\(/.test(au)) bad.push('AddUser.jsx (คิวไม่ได้ลิสต์รายชื่อ — กลับไปเป็นข้อความเปล่า)');
  if (!/linkEmployee\(u, e\)/.test(au)) bad.push('AddUser.jsx (ไม่มีปุ่มผูกกับพนักงานในคิว)');
  if (!/markShared\(u\)/.test(au)) bad.push('AddUser.jsx (ไม่มีปุ่ม "เป็นบัญชีกลาง" ในคิว)');
  if (!/tri\.sharedOk\.length/.test(au))
    bad.push('AddUser.jsx (ไม่ได้เขียนว่าบัญชีกลางที่ไม่ผูกตัวตน = ถูกต้องแล้ว)');
  /* 2 ปุ่มนั้นเขียน DB ⇒ ต้องนับแถว (RLS ปฏิเสธ UPDATE = 0 แถว ไม่มี error) */
  /* ปุ่มในคิวทั้ง 2 ทางต้องนับแถวจริง — รับทั้งแบบ inline และแบบแยก `const res = await …` (28/10) */
  if ((au.match(/checkWriteRows\((await supabase\.from\('profiles'\)|res, )/g) || []).length < 2)
    bad.push('AddUser.jsx (ปุ่มในคิวไม่ได้นับแถวที่เขียนจริงด้วย checkWriteRows)');

  /* บ้านเดียวของ normSearch */
  const tt = stripComments(readFileSync(join(ROOT, 'src/utils/thaiText.js'), 'utf8'));
  if (!/export const normSearch/.test(tt)) bad.push('utils/thaiText.js (normSearch ไม่ได้อยู่ที่นี่)');
  for (const f of walk(join(ROOT, 'src'), ['.js', '.jsx'])) {
    const rel = relative(ROOT, f);
    if (rel === 'src/utils/thaiText.js') continue;
    const src = stripComments(readFileSync(f, 'utf8'));
    if (/export const normSearch\s*=/.test(src)) bad.push(`${rel} (ประกาศ normSearch ชุดที่ 2)`);
  }

  assert.deepEqual(bad, [], '\n\n❌ ' + bad.join('\n   ') + '\n'
    + '   ทำไม: ตัวตน (ทีม/ไลน์/ส่วนงาน) อ่านจากฐานพนักงานเมื่อผูกแล้ว — ยังไม่ผูก = ใช้ค่าที่แอดมิน\n'
    + '         กรอกเองซึ่งเพี้ยนเงียบ · และ "จับคู่ชื่ออัตโนมัติ" แก้ไม่ได้ (วัด 19/10: ชื่อตรง 1/18)\n'
    + '   แก้: จัดคิวผ่าน src/utils/identityMatch.js + ลิสต์รายชื่อ/ปุ่ม 3 ทางที่ /add-user\n');
});

/* ── 🚫 กะผลิตห้ามถูก hard delete (2026-10-19 · QC audit ข้อ ③) ───────────────────────
   `production_sessions` มี FK cascade ไปที่ `prod_orders` · `downtime_logs` · `defect_logs`
   ⇒ `delete` ใบเดียว = ยอดผลิต/เวลาหยุด/ของเสียของกะนั้นหายถาวร และ OEE ย้อนหลังเปลี่ยน
     โดยไม่เหลือร่องรอยว่าใครลบ เพราะอะไร (กู้ไม่ได้ — ฝั่ง DR ไม่มี audit log)
   กฎในหัวไฟล์ `utils/sessionStatus.js` เขียนไว้แล้วว่า "เก็บประวัติไว้แทน delete" แต่ตัวจอ
   ยังมีปุ่มลบอยู่ 3 จุด (Live · กะค้าง · ประวัติ) ⇒ ด่านนี้กันไม่ให้กลับมา
   ✅ ทางที่ถูก: `status = 'void'` + `void_reason` (บังคับ) + `voided_by_name`
      · ด่านจริงฝั่ง DB = trigger `trg_session_void_guard` (ทำโมฆะได้เฉพาะกะเปล่า) */
test('🛡️ session-no-hard-delete — ห้ามจอไหน delete production_sessions (ต้องใช้ void)', () => {
  const bad = [];
  for (const f of walk(join(ROOT, 'src'), ['.js', '.jsx'])) {
    const src = stripComments(readFileSync(f, 'utf8'));
    if (/from\('production_sessions'\)[\s\S]{0,200}?\.delete\(/.test(src))
      bad.push(`${relative(ROOT, f)} (delete production_sessions)`);
  }
  /* ฝั่งจอต้องยังมีทางทำโมฆะอยู่จริง — ถอดปุ่มลบแล้วไม่เหลืออะไรให้ทำ = กะค้างเต็มจอ */
  const dr = stripComments(readFileSync(join(ROOT, 'src/pages/DailyReport.jsx'), 'utf8'));
  for (const fn of ['handleVoidSession', 'handleVoidEmptySession', 'voidEmpty']) {
    if (!new RegExp(`const ${fn} = async`).test(dr)) bad.push(`DailyReport.jsx (ไม่มี ${fn} — ทางทำโมฆะหายไป)`);
  }
  if (!/void_reason: reason/.test(dr)) bad.push('DailyReport.jsx (ทำโมฆะโดยไม่เก็บเหตุผล — DB มี CHECK บังคับ)');

  assert.deepEqual(bad, [], '\n\n❌ ' + bad.join('\n   ') + '\n'
    + '   ทำไม: ลบกะ = ลบ prod_orders/downtime_logs/defect_logs ตาม cascade ⇒ ยอดของวันนั้นหายถาวร\n'
    + '   แก้: update status = SESSION_VOID + void_reason + voided_by_name (src/utils/sessionStatus.js)\n');
});

/* ── 💰 ชั้นที่ 3 แกน Cost Center (2026-10-16..19 · คำสั่ง user) ──────────────────────
   *"ใช้ cost center เป็น key หลัก … เซ็ตได้ว่า user ไหน response กับ cost center ไหน **ตามลำดับชั้น**
     ถ้า response ชั้นส่วน 46 ก็ response ได้ทั้งหมดลงไป"*
   ด่านนี้คุม 4 อย่างที่พังเงียบ (ไม่มี error ให้เห็น แค่สิทธิ์ผิด):
   ① กฎ "CC ของโหนด = ตัวเอง → แม่ → ปู่" ต้องมีชุดเดียว — เคยมี 2 ชุด (orgDivisions.js + ccScope.js)
      จาก 2 session ขนานกัน ⇒ แก้กฎที่เดียวแล้วอีกจอตัดสินคนละแบบ
   ② 🔴 **ห้ามไล่ลำดับชั้นด้วยตัวเลขรหัส** — ลูกของ PD1 `2140461000` คือ `2140561001` (หลักที่ 5
      เปลี่ยน 4→5) ⇒ `like '21404%'`/`slice(0,5)` ได้ชุดผิดแบบดูเหมือนถูก
   ③ ว่าง = ถอยไปใช้ `profiles.section` (122 บัญชีเดิมต้องไม่เปลี่ยนพฤติกรรมวันที่ลง)
   ④ ค่าต้องเดินถึงจอ: UserContext ส่ง `respCostCenters` · /add-user เขียน `resp_cost_centers`
      และรายงานรหัสที่ผังไม่รู้จัก */
test('🛡️ cc-scope-layer — ชั้นสิทธิ์แกน Cost Center ยังอยู่ครบ + ห้ามไล่ชั้นด้วยเลขรหัส', () => {
  const bad = [];
  const cc = stripComments(readFileSync(join(ROOT, 'src/utils/ccScope.js'), 'utf8'));
  for (const fn of ['buildCcIndex', 'respScopesOf', 'canWriteScope', 'ccBlockText', 'writableByScope',
    'unknownRespCcs', 'attachCc', 'ccCoverage', 'costCenterOfNode']) {
    if (!new RegExp(`export function ${fn}\\b`).test(cc)) bad.push(`ccScope.js (ไม่มี ${fn})`);
  }
  /* ① ลำดับชั้นต้องมาจากผัง ไม่ใช่เลข ⇒ ต้องยืมของ orgScope ไม่ใช่เขียนต้นไม้ใหม่ */
  if (!/canonicalScope|scopeCovers/.test(cc)) bad.push('ccScope.js (ไม่ได้ใช้ canonicalScope/scopeCovers ของ orgScope — แปลว่าไปสร้างกฎลำดับชั้นเองใหม่)');
  /* ③ fallback section + ใบผ่าน all_units */
  if (!/role === 'admin' \|\| allUnits === true/.test(cc)) bad.push('ccScope.js (เสีย fallback admin / คีย์ scope:all_units)');
  if (!/const sec = norm\(section\);[\s\S]{0,120}kind: 'section'/.test(cc)) bad.push('ccScope.js (respScopesOf ไม่ได้ถอยไปใช้ profiles.section เมื่อยังไม่ตั้ง CC)');

  /* ① กฎตกทอดชุดเดียว — ห้ามมีไฟล์อื่นประกาศ costCenterOfNode หรือเขียนลูปไล่แม่หา cost_center เอง */
  for (const f of walk(join(ROOT, 'src'), ['.js', '.jsx'])) {
    const rel = relative(ROOT, f);
    if (rel === 'src/utils/ccScope.js') continue;
    const src = stripComments(readFileSync(f, 'utf8'));
    if (/(?:export )?function costCenterOfNode\b/.test(src)) bad.push(`${rel} (ประกาศ costCenterOfNode เอง — ต้อง import จาก utils/ccScope.js)`);
    if (/\bcur\.cost_center\b/.test(src)) bad.push(`${rel} (ไล่แม่หา cost_center เอง — ใช้ buildCcIndex().ccOfNode())`);
    /* ② ห้ามตัด/เทียบ prefix ของรหัสเพื่อเดาลำดับชั้น */
    if (/cost_center[^\n]{0,60}?(?:\.startsWith\(|\.slice\(0|\.substring\(0)/.test(src)
      || /(?:startsWith|slice\(0|substring\(0)[^\n]{0,40}?cost_center/.test(src))
      bad.push(`${rel} (เดาลำดับชั้นจากตัวเลข cost_center — ลำดับชั้นมาจาก org_nodes.parent_id เท่านั้น)`);
  }
  /* ② ฝั่ง SQL ก็ห้าม like '<เลข>%' บน cost_center */
  for (const f of walk(join(ROOT, 'supabase/migrations'), ['.sql'])) {
    const sql = readFileSync(f, 'utf8').replace(/--[^\n]*/g, '');
    if (/cost_center\s+(?:i?like)\s+'\d/i.test(sql)) bad.push(`${relative(ROOT, f)} (cost_center LIKE '<เลข>%' — ไล่ลำดับชั้นด้วยเลขรหัส)`);
  }

  /* ④ ค่าต้องเดินถึงจอ */
  const app = stripComments(readFileSync(join(ROOT, 'src/App.jsx'), 'utf8'));
  if (!/respCostCenters:/.test(app)) bad.push('src/App.jsx (UserContext ไม่ได้ส่ง respCostCenters)');
  if (!/resp_cost_centers/.test(app)) bad.push('src/App.jsx (ไม่ได้ select resp_cost_centers ตอนโหลดโปรไฟล์)');
  const au = stripComments(readFileSync(join(ROOT, 'src/pages/AddUser.jsx'), 'utf8'));
  if (!/resp_cost_centers:\s*form\.respCcs/.test(au)) bad.push('src/pages/AddUser.jsx (ไม่ได้บันทึก resp_cost_centers)');
  if (!/unknownRespCcs/.test(au)) bad.push('src/pages/AddUser.jsx (ไม่ได้รายงานรหัสที่ผังไม่รู้จัก — ค่าที่ตั้งไว้แล้วใช้ไม่ได้แบบเงียบ)');

  assert.deepEqual(bad, [], '\n\n❌ ' + bad.join('\n   ') + '\n'
    + '   ทำไม: รหัส CC **ไม่ได้เข้ารหัสลำดับชั้น** (PD1 2140461000 → ลูก 2140561001) และทีม 24 โหนด\n'
    + '         ไม่มีรหัสเลย ⇒ ต้องตกทอดจากแม่ผ่านผัง · มีกฎ 2 ชุด = สิทธิ์เพี้ยนแบบไม่มีใครเห็น\n'
    + '   แก้: ทุกอย่างผ่าน src/utils/ccScope.js (buildCcIndex/canWriteScope) · ลำดับชั้นจาก org_nodes.parent_id\n');
});

/* 🛡️ ship-due-date-calendar (2026-10-16) — `customer_shipping_orders.due_date` = วันที่ตามปฏิทิน
   ใบ 862 ลงวันที่ตามไฟล์ลูกค้า · Shipping Time Chart วางกรอบวันงาน D = (D ≥08:00) + (D+1 <08:00)
   แต่ e-SMART เขียน `due_date: workDate` ⇒ รอบกะดึกคืนแรก (4 ไฟล์) ไปอยู่วันงานก่อนหน้า ไม่ขึ้นชาร์ต
   + ไปทับยอดใบ 862 ของเมื่อวาน · คีย์มือ 04:00 ก็ตกหลุมเดียวกันจนคีย์ซ้ำ */
test('🛡️ ship-due-date-calendar — ใบส่งลูกค้าลง due_date ตามปฏิทิน (วันงานต้องผ่าน shipDueDate)', () => {
  const bad = [];
  const ps = stripComments(readFileSync(join(ROOT, 'src/utils/pullSignal.js'), 'utf8'));
  const em = stripComments(readFileSync(join(ROOT, 'src/utils/ediMerge.js'), 'utf8'));
  const fnBody = (src, name) => (src.match(new RegExp(`export function ${name}\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}`)) || [''])[0];
  if (/getDate\(\) \+ 1/.test(fnBody(ps, 'orderShipAt'))) bad.push('pullSignal.js orderShipAt (กลับไปบวกวันให้ใบก่อน 08:00)');
  if (/getDate\(\) \+ 1/.test(fnBody(em, 'shipAtMs'))) bad.push('ediMerge.js shipAtMs (กลับไปบวกวันให้ใบก่อน 08:00)');
  const up = stripComments(readFileSync(join(ROOT, 'src/components/PullSignalUpload.jsx'), 'utf8'));
  if (/due_date:\s*workDate\b/.test(up)) bad.push('PullSignalUpload.jsx (due_date: workDate — ต้อง shipDueDate(workDate, shipTime))');
  if (/orderShipAt\(workDate,/.test(up)) bad.push('PullSignalUpload.jsx (orderShipAt(workDate, …) — ต้องแปลงด้วย shipDueDate ก่อน)');
  if (/\.eq\('due_date',\s*workDate\)/.test(up)) bad.push("PullSignalUpload.jsx (.eq('due_date', workDate) — รอบกะดึกต้องเห็นใบของวัน D+1)");
  const cd = stripComments(readFileSync(join(ROOT, 'src/pages/CustomerDemand.jsx'), 'utf8'));
  if (!/due_date:\s*shipDueDate\(addForm\.due_date/.test(cd)) bad.push('CustomerDemand.jsx (คีย์ order ด่วนไม่ได้แปลงวันงาน → ปฏิทิน)');
  assert.deepEqual(bad, [], '\n\n❌ ' + bad.join(', ') + '\n'
    + '   แก้: วันงาน + รอบส่ง → shipDueDate() (src/utils/pullSignal.js) · เวลาจริงของใบ → orderShipAt(due_date, ship_time) ไม่บวกวัน\n');
});

/* 🛡️ esmart-window-confirm (2026-10-21) — 862 = แผนทั้งวัน · e-SMART = คอนเฟิร์มว่า "ช่วงนั้น" ส่งจริง
   (งาน 060/061/306 AAT GRBNA) เดิมจับคู่ "เวลาใกล้สุด 1:1" ⇒ ไฟล์ 06–08 ไปจับใบ 10:00 · ใบ 08:00 ค้างแดง
   + ใบที่เหลือในช่วงเดียวกันกลายเป็นใบเบิ้ล · 862 รอบเช้าสร้างใบช่วงที่ยืนยันแล้วกลับมาอีก */
test('🛡️ esmart-window-confirm — e-SMART ต้องทับใบแผน 862 ตามช่วงเวลา · 862 ห้ามสร้างช่วงที่ยืนยันแล้วกลับ', () => {
  const bad = [];
  const up = stripComments(readFileSync(join(ROOT, 'src/components/PullSignalUpload.jsx'), 'utf8'));
  if (!/windowEnd:\s*parsed\?\.windowEnd/.test(up)) bad.push('PullSignalUpload.jsx (slot ไม่ส่ง windowEnd = ตกไปโหมดเวลาใกล้สุด)');
  if (!/x\.merge\b/.test(up)) bad.push('PullSignalUpload.jsx (ไม่ปิดใบแผน 862 อื่นในช่วงเดียวกัน = ใบเบิ้ล)');
  const ps = readFileSync(join(ROOT, 'src/pages/PlannerSales.jsx'), 'utf8');
  if (!/splitPullCovered\(/.test(stripComments(ps))) bad.push('PlannerSales.jsx (862 ไม่กันช่วงที่ e-SMART ยืนยันแล้ว)');
  /* 22/10 — ไฟล์หลาย dock = หลายเที่ยว · ห้ามกลับไปวางแผนทั้งไฟล์ด้วย dock เดียว */
  if (!/planDockLegs\(/.test(up) || !/dockLegsOf\(/.test(up)) bad.push('PullSignalUpload.jsx (ไม่แยกเที่ยวต่อ dock — ไฟล์ B1+B5 จะลงรอบเดียวกันหมด)');
  if (/planOrderUpdates\(/.test(up)) bad.push('PullSignalUpload.jsx (เรียก planOrderUpdates ตรง — ต้องผ่าน planDockLegs)');
  /* 24/10 — แถวลูกค้าบนชาร์ตล็อกตามทะเบียน (orderShipToRows) ห้ามวาดตาม Object.entries(byCustomer) */
  const cd = stripComments(readFileSync(join(ROOT, 'src/pages/CustomerDemand.jsx'), 'utf8'));
  /* 27/10 — แผน 862 รอ e-SMART ห้ามนับเป็น "เลยเวลา"/"ค้างส่ง" (AAT แดงทั้งแถวทุกวัน) */
  if (!/const isOverdue = \(o\) => isOpenOrder\(o\) && !isPlan\(o\)/.test(cd)) bad.push('CustomerDemand.jsx (isOverdue ไม่กันแผน 862 รอ e-SMART — ใช้ isEsmartPlanRow จาก utils/shipPlan.js)');
  if (/\{Object\.entries\(byCustomer\)\.map/.test(cd)) bad.push('CustomerDemand.jsx (แถวลูกค้าวาดตามลำดับคิวรี — ต้องใช้ custOrder จาก orderShipToRows)');
  assert.deepEqual(bad, [], '\n\n❌ ' + bad.join(', ') + '\n'
    + '   แก้: planOrderUpdates โหมดช่วงเวลา (pullSignal.js) + splitPullCovered/pullCoverBatches (ediMerge.js)\n');
});

/* ═══ 🔒 ด่านฝั่งงาน — ห้ามเทียบ actorSide ตรงๆ · ทุก call site ต้องส่ง isAm (2026-10-16) ═══
   ที่มา: ผจก.ฝ่ายผลิตที่อยู่ทีม AM (`mtn_teams={production}`) ถูกตีเป็น "ฝั่งช่าง" ถาวร
          ⇒ เซ็นช่อง "อนุมัติปิดใบ" ของหน่วยตัวเองไม่ได้ และใบหายจากคิว "รอคุณ"
   AM = ฝ่ายผลิตซ่อมเครื่องตัวเอง ⇒ ช่าง = ผู้แจ้ง = หน่วยเดียวกัน ⇒ side 'both'
   ด่านนี้กันการถอยกลับ 2 ทาง: เขียนเงื่อนไขฝั่งเองในหน้า · ลืมส่ง isAm แล้ว 'both' ไม่เคยเกิด */
test('🔒 ฝั่งงาน (actorSide) — เทียบผ่าน sideAllows เท่านั้น · call site ต้องส่ง isAm', () => {
  const bad = [];
  const perm = stripComments(readFileSync(join(ROOT, 'src/utils/mtnStepPerm.js'), 'utf8'));

  if (!/export function sideAllows/.test(perm)) bad.push('src/utils/mtnStepPerm.js (ไม่มี sideAllows)');
  if (!/code:\s*'both'|return\s+teams\.every/.test(perm) && !/'both'/.test(perm))
    bad.push("src/utils/mtnStepPerm.js (actorSideOf ไม่คืน 'both' ให้ทีม AM แล้ว)");
  /* ไฟล์นี้ pure — เดาชื่อทีมเองแปลว่า hardcode taxonomy (กฎ AM↔PM: ห้าม hardcode 'production') */
  if (/'production'/.test(perm)) bad.push("src/utils/mtnStepPerm.js (hardcode 'production' — ต้องรับ isAm เข้ามา)");

  /* ทุกที่ที่ถามฝั่ง ต้องบอกด้วยว่าทีมไหนเป็น AM ไม่งั้น 'both' ไม่มีทางเกิด = แก้แล้วเหมือนไม่ได้แก้ */
  for (const f of ['src/components/MyQueuePanel.jsx', 'src/pages/MtnRepair.jsx']) {
    const src = stripComments(readFileSync(join(ROOT, f), 'utf8'));
    const calls = src.match(/actorSideOf\(\{[^}]*\}\)/g) || [];
    for (const c of calls) if (!/isAm\s*:/.test(c)) bad.push(`${f} (actorSideOf ไม่ได้ส่ง isAm)`);
  }

  /* คิว "รอคุณ" ต้องถามโดยปิดคีย์หัวหน้า ไม่ใช่ถามแล้วทิ้งคำตอบ
     (ทิ้งคำตอบ = ผจก.ตัวจริงถูกตัดออกจากคิวตัวเองไปด้วย — บั๊กเดิม) */
  const q = stripComments(readFileSync(join(ROOT, 'src/utils/myQueue.js'), 'utf8'));
  if (!/can:\s*canNoBoss/.test(q)) bad.push('src/utils/myQueue.js (soleSignerFor ไม่ได้ปิด manage_master ตอนถาม)');
  if (/me\.actorSide\s*!==\s*m\.side/.test(q)) bad.push('src/utils/myQueue.js (เทียบฝั่งตรงๆ ไม่ผ่าน sideAllows)');

  assert.deepEqual(bad, [], '\n\n❌ ' + bad.join(', ') + '\n'
    + '   ทำไม: ทีม AM = ฝ่ายผลิตซ่อมเอง ⇒ คนกลุ่มนี้เป็นทั้งช่างและผู้แจ้งของหน่วยตัวเอง\n'
    + '   แก้: actorSideOf({ …, isAm: isAmTeam }) · เทียบด้วย sideAllows(actorSide, meta.side)\n'
    + '   ⚠️ ล็อกฝั่ง/ตำแหน่ง 04/10 ยังอยู่ครบ — ฝั่งช่างจริงยังเซ็นช่องของฝ่ายผู้แจ้งไม่ได้\n');
});

/* ── 🛡️ board-cards-single-source (2026-10-19) ─────────────────────────────────────────
   การ์ดบอร์ด Heijunka เคยถูกสร้าง 3 ที่ (/management · /dashboard · กล่องไลน์บนผังรวม) สูตรต่างกันเล็กน้อย
   ⇒ บอร์ดเดียวกันโชว์ใบคนละสถานะได้ · ตอนนี้ทุกจอเรียก `buildBoardCards()` (`utils/boardCards.js`) ที่เดียว */
test('🛡️ board-cards-single-source — ห้ามเขียน buildCards สร้างการ์ดบอร์ดเองในหน้า', () => {
  const bad = [];
  for (const file of walk(join(ROOT, 'src'), ['.jsx'])) {
    const code = stripComments(readFileSync(file, 'utf8'));
    if (/\b(?:const|function)\s+buildCards\b/.test(code)) bad.push(relative(ROOT, file));
  }
  assert.deepEqual(bad, [], `สร้างการ์ดบอร์ดเองในหน้า — ใช้ buildBoardCards() จาก utils/boardCards.js:\n  ${bad.join('\n  ')}`);
});

/* ═══ 🔭 ด่านขอบเขต 2 แกน — แกนไลน์กับแกนส่วนงานห้ามเป็น else-if กัน (2026-10-19) ═══
   ที่มา: `/checkin` เขียน `if (role === 'leader') { if (lineId) {…} } else if (scopeSecs.length)`
          ⇒ leader ที่บัญชี**ไม่มี `line_id`** หลุดทั้งสองด่าน = **เห็นพนักงานทั้งโรงงานเงียบๆ**
   ทำไมสำคัญขึ้นเรื่อยๆ: การตั้ง "รักษาการหลายหน่วย" ทำด้วย `profiles.sections`
          ⇒ บัญชีหัวหน้าที่ไม่ผูกไลน์จะมีจริงตั้งแต่ตอนนั้น (ดู docs/modules/org-hierarchy.md)
   กติกา: ด่านไลน์ต้องมีเงื่อนไข `role === 'leader' && lineId` อยู่ใน if เดียวกัน
          แล้วค่อย `else if (scopeSecs…)` — ห้ามซ่อน lineId ไว้ชั้นใน */
test('🔭 leader-scope-no-fallthrough — leader ที่ไม่มี line_id ต้องถอยไปใช้ขอบเขตส่วนงาน', () => {
  const bad = [];
  for (const file of walk(join(ROOT, 'src'), ['.jsx', '.js'])) {
    if (/__tests__/.test(file)) continue;
    const lines = stripComments(readFileSync(file, 'utf8')).split('\n');
    lines.forEach((ln, i) => {
      // ด่านที่เปิดด้วย leader ลอยๆ (ไม่มี && lineId/userLineId ในบรรทัดเดียวกัน)
      if (!/if\s*\(\s*role\s*===\s*'leader'\s*\)\s*\{/.test(ln)) return;
      const tail = lines.slice(i + 1, i + 22).join('\n');
      // ...แล้วมี else-if แกนส่วนงานเป็นพี่น้อง = แกนไลน์ถูกข้ามได้เงียบๆ
      if (/\}\s*else\s+if\s*\(\s*(scopeSecs|sections|scopeSections)\b/.test(tail)) {
        bad.push(`${file.replace(ROOT, '')}:${i + 1}`);
      }
    });
  }
  assert.deepEqual(bad, [], '\n\n❌ ' + bad.join(', ') + '\n'
    + '   ทำไม: leader ที่ไม่มี line_id จะไม่โดนทั้งด่านไลน์และด่านส่วนงาน = เห็นทั้งโรงงาน\n'
    + "   แก้: const fam = (role === 'leader' && lineId) ? getLineFamilyIds(...) : null;\n"
    + '        if (fam) { …แกนไลน์… } else if (scopeSecs.length) { …แกนส่วนงาน… }\n'
    + "        แล้วแยกแกนทีม (teamsVisibleToLeader) ออกเป็น if (role === 'leader') ของตัวเอง\n"
    + '   · ไม่มีสมอทั้ง 2 แกน = scopeAnchorless() → **ต้องเขียนบนจอว่ากำลังเห็นทั้งโรงงาน**\n');
});

/* ── 🔁 จอ BOM ซ้ำ: หลุม 3 อย่างที่เคยทำยอดเปลี่ยนเงียบ (2026-10-19) ──────────────────
   ① ตารางคู่เทียบได้แค่ 2 ใบ ⇒ พาร์ทที่ **ไม่มีใบของตัวเอง** ไม่เคยขึ้นจอ (วัด 19/10: 17/40 mat)
   ② **ใบที่ 3** เขียนคนละค่า ⇒ ยุบคู่ที่ตรงกันเป๊ะแล้วยอดเปลี่ยน (เคสนัท 20059851 ×4 → ×1)
   ③ เส้นแบ่ง "ของร้อน" เขียนซ้ำ 2 ที่ ⇒ ตัวนับหัวจอกับตัวกรองตารางไม่ตรงกัน                    */
test('🛡️ จอ BOM ซ้ำ: ต้องมีมุมมองกลุ่ม + ธงใบที่ 3 + เส้นแบ่งของร้อนที่เดียว', () => {
  const util = stripComments(readFileSync(join(ROOT, 'src/utils/bomDupAudit.js'), 'utf8'));
  const panel = stripComments(readFileSync(join(ROOT, 'src/components/BomDupPanel.jsx'), 'utf8'));
  const groupView = stripComments(readFileSync(join(ROOT, 'src/components/BomSheetGroups.jsx'), 'utf8'));

  // ① มุมมองกลุ่มต้องยังอยู่ และต้องถูกวาดจริงในจอ (ไม่ใช่มีฟังก์ชันลอยๆ)
  assert.ok(/export function auditBomSheetGroups/.test(util),
    '\n\n❌ หาย `auditBomSheetGroups` — พาร์ทที่ "ไม่มีใบ BOM ของตัวเอง แต่ถูกนิยามไว้หลายใบ"\n'
    + '   จะกลับไปไม่มีที่โผล่บนจอเลย (ตารางคู่ `continue` ทิ้งทั้งหมด · วัด 19/10 = 17 จาก 40 mat)\n');
  assert.ok(/<BomSheetGroups/.test(panel),
    '\n\n❌ จอ /products?tab=bomdup ไม่วาดตารางกลุ่มแล้ว — ตารางคู่ไม่ครอบ 2 คลาสนั้น ห้ามถอด\n');

  // ② ธง "ใบที่ 3" ต้องคิดจาก sheetsWithKidsOf และต้องขึ้นบนจอ
  assert.ok(/sheetsWithKidsOf/.test(util) && /hasThirdSheet/.test(util),
    '\n\n❌ ไม่ได้ถาม `sheetsWithKidsOf` เพื่อหา "ใบที่ 3" แล้ว\n'
    + '   ⇒ คู่ที่ 2 ใบตรงกันเป๊ะจะดูเหมือนยุบได้ ทั้งที่ใบที่ 3 เขียนคนละค่า (ยอดเปลี่ยนเงียบ)\n');
  assert.ok(/hasThirdSheet/.test(panel),
    '\n\n❌ จอไม่เตือน "มีใบที่ 3" แล้ว — PE จะตัดสินยุบจากการเทียบ 2 ใบ เหมือนที่เคยพลาด 14/10\n');

  // ③ เส้นแบ่งของร้อนมีที่เดียว — ห้ามเขียนเลข rank ซ้ำในหน้า
  assert.ok(/isHotPair/.test(panel),
    '\n\n❌ จอไม่ได้ใช้ `isHotPair` — ต้องใช้เส้นแบ่งเดียวกับตัวนับหัวจอ\n');
  assert.ok(!/\brank\s*[<>]=?\s*\d/.test(panel),
    '\n\n❌ มีการเทียบเลข `rank` ตรงๆ ในจอ BOM ซ้ำ\n'
    + '   ⇒ เพิ่ม verdict ใหม่แล้วตัวนับกับตัวกรองจะไม่ตรงกัน (เคยเพี้ยนจริงตอนเพิ่ม pair_shot)\n'
    + '   ใช้ `isHotPair` / `HOT_RANK_MAX` จาก utils/bomDupAudit.js แทน\n');

  // ④ ตารางกลุ่ม = อ่านอย่างเดียว · ห้ามเขียน/ลบ bom_items จากจอ (กฎโมดูล: จอชี้ PE ตัดสิน)
  assert.ok(!/supabaseDR|\.upsert\(|\.delete\(/.test(groupView),
    '\n\n❌ ตารางกลุ่มเริ่มเขียน DB แล้ว — มุมมองนี้ต้องอ่านอย่างเดียว\n'
    + '   การตัดสินอยู่ที่ตารางคู่ (คีย์ ใบ+พาร์ท) และห้ามยุบ/ลบ bom_items ให้เอง\n');

  // ⑤ "ใบนั้นไม่มีของตัวนี้" = null ห้ามกลายเป็น 0 บนจอ
  assert.ok(/==\s*null/.test(groupView),
    '\n\n❌ ตารางกลุ่มไม่ได้แยก `null` (ใบนั้นไม่มีของตัวนี้) ออกจากเลข 0 แล้ว\n'
    + '   โชว์ 0 = คนอ่านว่า "ใบนั้นเขียนว่าไม่ใช้" ซึ่งคนละเรื่องกับ "ใบนั้นไม่ได้พูดถึงเลย"\n');
});

/* ── 🗑️ ทะเบียนที่จับคู่ด้วย "ข้อความ" ต้องมีด่านนับปลายทางก่อนลบ (2026-10-18) ─────────────
   CLAUDE.md §Database Schema: *"ลบ/เปลี่ยนชื่อแถวทะเบียน ต้องไล่เช็คและไล่แก้ปลายทางในคราวเดียว
   · นับไม่ครบ = ห้ามลบ (fail-closed)"* — `<SimpleMasterPanel>` มี `onBeforeDelete` ให้แล้ว
   แต่ 18/10 พบว่าใช้จริงแค่ `cost_centers` ตัวเดียว · อีก 6 ทะเบียนลบได้ทันทีโดยไม่นับใครเลย
   (ลูกค้า 1,974 ใบผลิต · supplier 16,552 ใบขอซื้อ · กลุ่มเครื่องปั๊ม 268 แม่พิมพ์ … กลายเป็นกำพร้าเงียบ)

   ด่านนี้กัน 3 ทาง: ถอด onBeforeDelete ออกจากแผงเดิม · เพิ่มทะเบียนใหม่แล้วลืมใส่ด่าน ·
   แก้ `masterRefs.js` ให้ตอบ 0 เมื่อนับไม่ได้ (ต้อง partial เสมอ) หรือเอา label มาจับคู่ซ้ำกับ key */
test('🗑️ ทะเบียนข้อความ (SimpleMasterPanel) ต้องส่ง onBeforeDelete + masterRefs ต้อง fail-closed', () => {
  const bad = [];

  /* ทะเบียนที่ปลายทางเก็บเป็น "ข้อความ" ไม่ผูก FK ⇒ ลบแล้วไม่มีใครเตือน — ต้องมีด่านทุกตัว
     (cost_centers ใช้ util เฉพาะของตัวเอง `costCenterRefs.js` ตั้งแต่ 06/10) */
  const MUST_GUARD = ['customers', 'suppliers', 'die_press_lines', 'die_op_types',
                      'die_set_kinds', 'repair_wi_registry', 'cost_centers'];

  for (const f of walk(join(ROOT, 'src'), ['.jsx', '.js'])) {
    const src = stripComments(readFileSync(f, 'utf8'));
    if (!src.includes('<SimpleMasterPanel')) continue;
    const rel = relative(ROOT, f);
    /* ตัดเป็นก้อนต่อ 1 element แล้วดูว่าก้อนที่ประกาศ table="<ทะเบียน>" มีด่านอยู่ในก้อนเดียวกันไหม */
    for (const chunk of src.split('<SimpleMasterPanel').slice(1)) {
      const el = chunk.split(/\/>|<\/SimpleMasterPanel>/)[0];
      const m = el.match(/table=["']([a-z_]+)["']/);
      if (!m || !MUST_GUARD.includes(m[1])) continue;
      if (!/onBeforeDelete=/.test(el)) bad.push(`${rel} → table="${m[1]}" ไม่มี onBeforeDelete`);
    }
  }

  const refs = stripComments(readFileSync(join(ROOT, 'src/utils/masterRefs.js'), 'utf8'));
  /* นับไม่ได้ต้องเป็น partial — ด่านนี้ตายทันทีถ้ามีใครเปลี่ยน default เป็น false */
  if (!/partial:\s*true/.test(refs)) bad.push('src/utils/masterRefs.js (ไม่มีทาง fail-closed แล้ว)');
  /* 🔴 die_op_types / die_set_kinds ห้ามเอา label ไปจับคู่ — ป้ายเป็นคำไทยกลาง ("อื่นๆ") ชนกับ
     mtn_orders.problem_characteristic 328 แถว ⇒ จะบล็อกการลบทั้งที่ไม่มีใครใช้จริง */
  for (const reg of ['die_op_types', 'die_set_kinds']) {
    const blk = refs.split(`${reg}: {`)[1]?.split('},')[0] || '';
    if (/r\?\.label/.test(blk)) bad.push(`src/utils/masterRefs.js → ${reg} เอา label ไปจับคู่ปลายทาง`);
  }
  /* machines.line_name ใช้ร่วมกับไลน์ผลิต ⇒ ต้องกรอง equipment_kind ไม่งั้นนับเกินแล้วบล็อกผิด */
  if (refs.includes("['machines', 'line_name'") && !/equipment_kind:\s*'die'/.test(refs))
    bad.push("src/utils/masterRefs.js (machines.line_name ไม่กรอง equipment_kind='die')");

  assert.deepEqual(bad, [], '\n\n❌ ' + bad.join('\n   ') + '\n'
    + '   ทำไม: ทะเบียนพวกนี้ปลายทางเก็บเป็นข้อความ ไม่ผูก FK ⇒ ลบแถวแล้วใบ/ทะเบียนที่อ้างอยู่\n'
    + '         กลายเป็นค่ากำพร้าเงียบๆ (วัด 18/10: ลูกค้า 1 ราย = 1,974 ใบผลิต)\n'
    + '   แก้: onBeforeDelete={masterDeleteGuard(supabaseDR, \'<ทะเบียน>\')} (src/utils/masterRefs.js)\n'
    + '        ทะเบียนใหม่ = เพิ่ม spec ใน MASTER_REF_SPECS โดย**วัดปลายทางจากฐานจริง** ห้ามเขียนจากความจำ\n');
});

/* 🛡️ lot-dest-from-rules (เดิม lot-mats-from-rules · เขียนใหม่ 2026-10-26 · คำสั่ง user)

   19/10: พาร์ทโหมด 🔧 "ปิดล็อตที่สโตร์" ยอดลงที่ **ชื่อไลน์ผลิต** ⇒ กฎโหมดนี้ห้ามร่วมตัดสินคลัง
   26/10: สโตร์แจ้งว่าปลายทางจริงคือสโตร์ (*"พอกดรับ สต็อกจะวิ่งไปที่ไลน์นั้นๆ"* — วัดแล้ว 70 แถว
          ลงไลน์ · STORE 0 แถว) ⇒ user เคาะให้ย้ายปลายทางเป็นคลังตามกฎ
   ⇒ ด่านกลับทิศ: `inflowDestOf()` **ต้องไม่ข้ามกฎโหมด lot** และ `advanceLot` ต้องลงที่คลังของกฎ
     ไม่ใช่ `lot.source_line` · ไม่มีกฎ = ห้ามเดา (ต้อง throw ให้คืนสถานะล็อต) */
test('🛡️ lot-dest-from-rules — ปลายทางของล็อตมาจากกฎรับเข้า ไม่ใช่ชื่อไลน์ผลิต', () => {
  const bad = [];
  const pr = stripComments(readFileSync(join(ROOT, 'src/utils/partRefStock.js'), 'utf8'));
  if (/mode === 'lot'\) continue/.test(pr))
    bad.push("partRefStock.js inflowDestOf (กลับไปข้ามกฎโหมด lot = ของเข้าสโตร์แล้วไปโผล่ที่ไลน์)");
  if (/lotMats/.test(pr))   // stripComments แล้ว ⇒ เหลือแต่โค้ดจริง
    bad.push('partRefStock.js (ยังมีพารามิเตอร์ lotMats ค้าง — ไม่มีใครใช้ตัดสินคลังแล้ว)');

  const hk = stripComments(readFileSync(join(ROOT, 'src/pages/HeijunkaKanban.jsx'), 'utf8'));
  if (!/destLoc = inflowDestOf\(/.test(hk))
    bad.push('HeijunkaKanban.advanceLot (ไม่ได้หาคลังปลายทางจาก inflowDestOf)');
  if (/line_name:\s*lot\.source_line/.test(hk))
    bad.push('HeijunkaKanban.advanceLot (ยังเขียน ledger ลงที่ lot.source_line = ชื่อไลน์ผลิต)');
  if (!/if \(!destLoc\)/.test(hk))
    bad.push('HeijunkaKanban.advanceLot (ไม่มีกฎแล้วไม่ได้บล็อก — เดาคลังเองกู้ยากกว่ารอคนตั้งกฎ)');
  /* 🔴 27/10 (ข้อ A2) — ปิดล็อตลงสต็อกได้เฉพาะพาร์ทที่ยังอยู่โหมด 🔧
     พาร์ทที่ย้ายไปโหมด 🟡 ยืนยันรับ ของเข้าทางคิว "รอรับเข้า" แล้ว ⇒ ลงที่นี่อีก = เข้าคลัง 2 เด้ง
     (ตรงกับที่สโตร์แจ้ง: *"ถ้ามีปุ่มนี้จะเหมือนเป็นการรับงานซ้ำ 2 รอบ"*) */
  if (!/lotMatsOf\((?:rulesRows|rules)/.test(hk))
    bad.push('HeijunkaKanban.advanceLot (ไม่ได้เช็คโหมดก่อนลงสต็อก — พาร์ทโหมดยืนยันรับจะเข้าคลัง 2 เด้ง)');

  /* 🔴🔴 27/10 — ด่านคู่แฝดของข้างบน: ด่านนั้นกันเข้าคลัง 2 เด้ง **ด่านนี้กันของหายจากบัญชี**
     ใบล็อตที่ออกตอนพาร์ทยังโหมด 🔧 ไม่เคยมี `stock_receipts` รองรับ (trigger ข้าม) ⇒ พอสลับโหมด
     ปุ่มปิดล็อตเลิกลงสต็อก **และ** ไม่มีใบรับเข้าให้กดแทน = ปิดแล้วของหายเงียบ
     (วัดวันสลับ: 7 ใบค้างขั้น producing · บนใบ 13,200 ชิ้น · ใบรับเข้ารองรับ 0)
     ⇒ การ์ดต้องเตือนก่อนกด **ห้ามบอกว่า "ของเข้าคิวแล้ว" ลอยๆ** · ต้องรู้ว่าใบออกก่อน/หลังสลับ
       ⇒ ต้อง select `updated_at` ของกฎมาด้วย */
  if (!/lotOrphanRisk\(/.test(hk))
    bad.push('HeijunkaKanban (การ์ดล็อตไม่ได้เช็ค lotOrphanRisk — ใบที่ออกก่อนสลับโหมดจะปิดแล้วของหายเงียบ)');
  if (![...hk.matchAll(/from\('stock_inflow_rules'\)\.select\('([^']*)'\)/g)]
        .some(m => /\bupdated_at\b/.test(m[1])))
    bad.push('HeijunkaKanban (ไม่มี select stock_inflow_rules ตัวไหน select updated_at — lotOrphanRisk ตัดสินไม่ได้)');

  /* 🔴 ชั้นป้องกันของขั้น ③ — จอตั้งค่าต้องห้ามสลับออกจากโหมด 🔧 เงียบๆ ตอนยังมีใบล็อตค้าง
     (นับไม่ได้ = บล็อก · ด่านนี้ตรวจแค่ว่า "ยังเช็คอยู่" ไม่ตรวจข้อความ) */
  const ls = stripComments(readFileSync(join(ROOT, 'src/pages/LineStock.jsx'), 'utf8'));
  if (!/'producing'/.test(ls) || !/child_lot_requests/.test(ls))
    bad.push('LineStock.setRuleMode (ไม่ได้เช็คใบล็อตค้างก่อนสลับออกจากโหมด lot — ของบนใบที่ค้างจะไม่เข้าคลังเลย)');

  /* 🔴 จอที่เอากฎรับเข้าไปป้อน partRefStock ต้อง select `mode` มาด้วย — ตอนนี้ `mode` คือสิ่งที่
     `/line-stock` ใช้แสดง/แก้ "ยอดเข้าทางไหน" ขาดไป = จอตั้งค่าโชว์โหมดผิด */
  for (const f of walk(join(ROOT, 'src'), ['.js', '.jsx'])) {
    const src = stripComments(readFileSync(f, 'utf8'));
    if (!/from\s+['"][^'"]*partRefStock['"]/.test(src)) continue;
    for (const m of src.matchAll(/from\('stock_inflow_rules'\)\.select\((['"])([^'"]*)\1\)/g)) {
      const cols = m[2];
      if (/match_type/.test(cols) && !/\bmode\b/.test(cols)) bad.push(`${relative(ROOT, f)} (select stock_inflow_rules ไม่มี mode)`);
    }
  }
  assert.deepEqual(bad, [], '\n\n❌ ' + bad.join('\n   ') + '\n'
    + '   ทำไม: ปุ่มเขียนว่า "รับของเข้าสโตร์" แต่ยอดไปโผล่ที่ไลน์ = สโตร์หายอดตัวเองไม่เจอ\n'
    + '   แก้: advanceLot ลงที่ inflowDestOf(mat, rules) · ไม่มีกฎ = throw ให้คืนสถานะล็อต\n');
});
/* 🛡️ asset-url-data-inline (2026-10-19) — รูปที่ import ใน src/assets เล็กกว่า 4 KB ถูก Vite ฝังเป็น `data:` URL
   เดิมใบพิมพ์ MO เช็คแค่ `https?:` แล้วต่อ `location.origin` หน้า ⇒ "https://…data:image/png…" = รูปพัง
   (โลโก้ TS 2.4 KB ไม่ขึ้นมุมซ้ายใบแจ้งซ่อม · user แจ้ง 19/10) */
test('🛡️ asset-url-data-inline — ห้ามต่อ location.origin หน้า URL ของ asset ที่ import มาตรงๆ', () => {
  const bad = [];
  for (const f of walk(join(ROOT, 'src'), ['.js', '.jsx'])) {
    const src = stripComments(readFileSync(f, 'utf8'));
    const assets = [...src.matchAll(/^import\s+(\w+)\s+from\s+['"][^'"]*\.(?:png|jpe?g|svg|gif|webp)['"]/gm)].map(m => m[1]);
    for (const a of assets) {
      if (new RegExp(`location\\.origin\\s*\\+\\s*${a}\\b`).test(src)) bad.push(`${relative(ROOT, f)} (location.origin + ${a})`);
    }
  }
  assert.deepEqual(bad, [], '\n\n❌ ' + bad.join('\n   ') + '\n'
    + '   แก้: เช็ค /^(https?:|data:|blob:)/ ก่อน ค่อยต่อ origin เฉพาะ path สัมพัทธ์ (ใช้ absAssetUrl() ที่ src/utils/assetUrl.js)\n');
});

/* ── 🛡️ map3d-switch-no-transition (2026-10-19 · user "จอค่อยๆ วูมเอ้าตอนสลับ 3D/2D") ─────────────
   ทรานสิชันของกรอบผัง 3D ต้องปิดใน render ที่สลับโหมด — ไม่งั้น transform เอียง+ย่อทั้งก้อนเล่น .45s เป็นภาพซูมออก/เข้า */
test('🛡️ map3d-switch-no-transition — useMapOrbit ปิด transition ตอนสลับ 2D/3D', () => {
  const code = stripComments(readFileSync(join(ROOT, 'src/components/useMapOrbit.js'), 'utf8'));
  assert.match(code, /transition:\s*[^\n]*switching[^\n]*\?\s*'none'/, 'transition ของ useMapOrbit ต้องเป็น none ระหว่าง switching');
});

/* ── 📮 ทะเบียนเคลมลูกค้าว่าง ทั้งที่บันทึกแล้ว (2026-10-19 · หน้างานแจ้ง "กดไป 2 อัน ไม่โชว์สักอัน") ──
   `QaClaims` รับ `lines` = แถว production_lines (object) ตั้งแต่ 07/09 แต่ตัวกรองขอบเขตยังเป็น
   `lines.includes(c.line_name)` (string vs object = false เสมอ) ⇒ เคลมที่ระบุไลน์ถูกซ่อนทุกใบ */
test('🛡️ qa-claims-scope-by-name — ตัวกรองขอบเขตเคลมต้องเทียบชื่อไลน์ ไม่ใช่ object', () => {
  const src = stripComments(readFileSync(join(ROOT, 'src/components/QaClaims.jsx'), 'utf8'));
  assert.ok(!/\blines\.includes\(/.test(src),
    '\n\n❌ QaClaims.jsx ใช้ lines.includes(ชื่อไลน์) — lines เป็นแถว object ⇒ ไม่ตรงเลย เคลมหายจากทะเบียน\n'
    + '   แก้: เทียบกับชุดชื่อ (lines.map(l => l.name)) และกรองเฉพาะเมื่อผู้ดูมีขอบเขตจริง (แบบแท็บ NCR)\n');
});

/* ── ❌ ใบ NCR/เคลมที่ "ยกเลิก (เปิดผิด)" ห้ามนับเป็นงานค้าง (2026-10-19) ──
   เพิ่มสถานะ `cancelled` แล้ว ⇒ ตัวนับเดิม `status !== 'closed'` / `.neq('status','closed')` จะนับใบยกเลิกเป็นงานค้างปลอม
   ตัวตัดสินอยู่ `utils/qaDocStatus.js` ที่เดียว */
test('🛡️ qa-doc-cancelled-not-open — ตัวนับ NCR/เคลมค้างต้องผ่าน qaDocStatus', () => {
  const bad = [];
  for (const f of ['src/components/QaClaims.jsx', 'src/pages/DeptDashboard.jsx']) {
    const src = stripComments(readFileSync(join(ROOT, f), 'utf8'));
    if (/\.status\s*!==\s*'closed'/.test(src) && f.endsWith('QaClaims.jsx')) bad.push(`${f}: status !== 'closed'`);
    if (/claims\.filter\(\s*c\s*=>\s*c\.status\s*!==\s*'closed'/.test(src)) bad.push(`${f}: claims.filter(status !== 'closed')`);
  }
  const qc = stripComments(readFileSync(join(ROOT, 'src/pages/QualityControl.jsx'), 'utf8'));
  if (/from\('qa_ncr'\)[^;]*\.neq\('status',\s*'closed'\)/.test(qc)) bad.push("QualityControl.jsx: qa_ncr .neq('status','closed')");
  assert.deepEqual(bad, [], '\n\n❌ ' + bad.join('\n   ') + '\n   ใช้ isOpenQaDoc() / QA_DONE_IN จาก utils/qaDocStatus.js\n');
});

/* ── 👁 หน้า /qa ห้ามเขียนกฎขอบเขตที่เห็นเอง (2026-10-19) — ใช้ qaViewScope() (ห่อ scopedLineNames) ──
   เดิมเขียนเอง 3 ชุด ⇒ ส่วนงานที่ไม่มีไลน์ผลิต (QA) ได้ 0 ไลน์ = ทุกแท็บว่าง */
test('🛡️ qa-view-scope-shared — QualityControl ใช้ qaViewScope ไม่กรอง inSectionScope เอง', () => {
  const qc = stripComments(readFileSync(join(ROOT, 'src/pages/QualityControl.jsx'), 'utf8'));
  assert.ok(!/inSectionScope\(/.test(qc), 'QualityControl.jsx กรองขอบเขตเองด้วย inSectionScope — ใช้ qaViewScope()');
  assert.ok(/qaViewScope\(/.test(qc), 'QualityControl.jsx ต้องใช้ qaViewScope()');
});

/* ── 🗑️ ลบพาร์ท QA ที่มีใบตรวจแล้ว = ประวัติตรวจหายถาวร (FK cascade · audit 19/10) ── */
test('🛡️ qa-part-delete-needs-sheet-count — delPart ต้องนับใบตรวจก่อนลบ', () => {
  const src = stripComments(readFileSync(join(ROOT, 'src/pages/QAInspectionSetup.jsx'), 'utf8'));
  const i = src.indexOf('const delPart');
  const body = src.slice(i, src.indexOf("from('qa_parts').delete()", i));
  assert.ok(i >= 0 && /qa_inspection_sheets/.test(body),
    '\n\n❌ delPart ลบ qa_parts โดยไม่นับ qa_inspection_sheets ก่อน — ON DELETE CASCADE ลบประวัติตรวจทั้งพาร์ท\n');
});

/* ── 🛡️ tv-fit-no-compound-zoom (2026-10-19 · จอ TV จริง "ค่อยๆ วูมเอ้า") ─────────────────────────────
   Chromium 94 คืน rect ของตัวที่ตั้ง zoom เป็นขนาดก่อนย่อ ⇒ สูตร `zoom × จอ ÷ rect` ย่อซ้อนทบทุกรอบจนชนพื้น
   ตัวพอดีจอต้องวัดความสูงตอนถอด zoom แล้วคิด target จากค่านั้นตรงๆ ห้ามคูณ zoom ปัจจุบัน */
test('🛡️ tv-fit-no-compound-zoom — DisplayRotator ห้ามคิด target จาก zoom × จอ ÷ rect', () => {
  const code = stripComments(readFileSync(join(ROOT, 'src/components/DisplayRotator.jsx'), 'utf8'));
  assert.doesNotMatch(code, /zoom\s*\*\s*\(\s*window\.innerHeight/, 'สูตรย่อซ้อนทบกลับมา — วัดความสูงตอนไม่ย่อแทน');
  assert.match(code, /m\.style\.zoom\s*=\s*'';\s*\n\s*const natural/, 'ต้องถอด zoom ก่อนวัดความสูงจริง');
});

/* ═══ 🔕 แถว "เรียกช่าง" ต้องระบุทีมเสมอ — ไม่ระบุ = ไซเรนดังทุกห้อง (2026-10-19) ═══
   `DowntimeSiren`/`MtnAndonBoard` ตีความ `call_mtn_team` ว่าง = "ดังทุกห้อง" (เจตนา: ไม่เดาทีม)
   ⇒ ทุกจุดที่เขียน `call_mtn: true` ต้องเติมทีมไปด้วยถ้ารู้
   วัดจริง ต.ค. 2026: 80 จาก 175 ครั้ง (46%) ไม่ระบุทีม — มาจาก syncDowntimeTimes ที่เติมแต่เวลา */
test('🔕 เขียน call_mtn = true ต้องเติม call_mtn_team ด้วย (ไม่งั้นไซเรนดังข้ามทีม)', () => {
  const bad = [];
  for (const f of ['src/pages/DailyReport.jsx', 'src/pages/MtnRepair.jsx']) {
    const src = stripComments(readFileSync(join(ROOT, f), 'utf8'));
    /* ดูทีละ update ที่ตั้ง call_mtn เป็น true — ต้องมี call_mtn_team อยู่ใน object เดียวกัน */
    for (const m of src.match(/\{[^{}]*call_mtn:\s*true[^{}]*\}/g) || []) {
      if (!/call_mtn_team/.test(m)) bad.push(`${f} (${m.replace(/\s+/g, ' ').slice(0, 70)}…)`);
    }
  }
  assert.deepEqual(bad, [], '\n\n❌ ' + bad.join(', ') + '\n'
    + '   ทำไม: call_mtn_team ว่าง = จอ Andon/ไซเรนถือว่า "ไม่รู้ทีม" แล้วดังให้ทุกทีม\n'
    + '   แก้: เติม call_mtn_team จากทีมที่รู้ (ปุ่มเรียกช่าง = ทีมที่เลือก · ใบ MO = mtn_dept)\n'
    + '   ⚠️ ไม่รู้ทีมจริงๆ ให้ปล่อยว่าง (ดังทุกห้องดีกว่าเงียบผิดทีม) แต่ห้ามลืมเติมตอนที่รู้\n');
});

/* ── 📲 แถบ "เปิดแจ้งเตือนเข้ามือถือ" ต้องไม่หายไป และต้องไม่แตะจอคอม (2026-10-20) ──────────
   ที่มา: feedback *"มือถือ ไม่มีการแจ้งเตือนใบแจ้งซ่อมมา 2-3 วัน"* — ไล่แล้ว**ไม่ใช่เรื่องสิทธิ์**
   ปุ่มเปิด push มีอยู่แล้วแต่ซ่อนในกระดิ่ง ⇒ วัด 20/10: ผู้รับแจ้งเตือน 7 วัน 102 คน
   **มีเครื่องผูกไว้ 28 · ไม่มี 74** (ได้แจ้งเตือนใบซ่อมด้วย 55 คน) = มือถือไม่เคยเด้งเลย

   ด่านนี้กัน 4 ทาง: ถอดแถบออกจาก layout · ย้ายไปแสดงบนคอมด้วย · ก๊อปข้อความสถานะไปเขียนซ้ำในหน้า ·
   ทำให้ "ตรวจสถานะไม่ได้" กลายเป็นข้อความ "ยังไม่เปิด" (จอโกหก) */
test('📲 MobilePushPrompt — ต้องถูก mount ใน layout · มือถือเท่านั้น · ข้อความมาจาก utils ที่เดียว', () => {
  const bad = [];
  const app    = stripComments(readFileSync(join(ROOT, 'src/App.jsx'), 'utf8'));
  const prompt = stripComments(readFileSync(join(ROOT, 'src/components/MobilePushPrompt.jsx'), 'utf8'));
  const util   = stripComments(readFileSync(join(ROOT, 'src/utils/pushPrompt.js'), 'utf8'));

  if (!/<MobilePushPrompt\b/.test(app)) bad.push('src/App.jsx (ไม่ได้ mount <MobilePushPrompt> แล้ว)');
  if (!/userId=\{userId\}/.test(app.split('<MobilePushPrompt')[1]?.slice(0, 80) || ''))
    bad.push('src/App.jsx (<MobilePushPrompt> ไม่ได้รับ userId — getPushState จะเทียบ DB ไม่ได้ = ขึ้น stale ตลอด)');

  /* 🔴 ห้ามเปลี่ยนจอคอมแม้แต่พิกเซลเดียว (คำสั่ง user 15/10) — ต้องตัดด้วย useIsMobile ก่อนวาด */
  if (!/useIsMobile/.test(prompt)) bad.push('src/components/MobilePushPrompt.jsx (ไม่เช็ค useIsMobile = โผล่บนจอคอม)');
  if (!/if \(!isMobile/.test(prompt)) bad.push('src/components/MobilePushPrompt.jsx (ไม่มี early return เมื่อไม่ใช่มือถือ)');
  /* fixed/sticky ที่แถบนี้ = ทับเนื้อหา/ต้องบวก --mnav-h — ตั้งใจเลี่ยงทั้งคู่ */
  if (/position:\s*['"]?(fixed|sticky)/.test(prompt))
    bad.push('src/components/MobilePushPrompt.jsx (ใช้ fixed/sticky — แถบนี้ต้องเป็นแถบในเนื้อหา)');

  /* ข้อความสถานะต้องมาจาก utils ที่เดียว ห้ามก๊อปไปเขียนในคอมโพเนนต์ */
  if (!/pushPromptCopy/.test(prompt))
    bad.push('src/components/MobilePushPrompt.jsx (ไม่ได้ใช้ pushPromptCopy — เขียนข้อความสถานะเองในหน้า)');
  if (/case\s+'(stale|check-failed|ios-need-install)'/.test(prompt))
    bad.push('src/components/MobilePushPrompt.jsx (ตัดสินสถานะเองในหน้า — ต้องอยู่ที่ utils/pushPrompt.js)');

  /* 🔴 ตรวจไม่ได้ ≠ ยังไม่เปิด (กฎความซื่อสัตย์ของจอ) */
  const cf = util.split("case 'check-failed':")[1]?.split('case ')[0] || '';
  if (!/ยังไม่ทราบ/.test(cf) || /ยังไม่เปิดแจ้งเตือน/.test(cf))
    bad.push("src/utils/pushPrompt.js ('check-failed' ต้องบอกว่ายังไม่ทราบ ห้ามบอกว่ายังไม่เปิด)");
  if (!/return null/.test(util.split('default:')[1] || ''))
    bad.push('src/utils/pushPrompt.js (สถานะที่ไม่รู้จัก/subscribed ต้องคืน null = ไม่วาดแถบ)');

  /* จอแอดมิน: ลิสต์ว่าง 2 ความหมาย — RPC ต้องโยน 42501 และจอต้องแยกข้อความได้ */
  const panel = stripComments(readFileSync(join(ROOT, 'src/components/PushCoveragePanel.jsx'), 'utf8'));
  if (!/pushCoverageFailText/.test(panel))
    bad.push('src/components/PushCoveragePanel.jsx (ไม่แยกสาเหตุที่อ่านไม่ได้ — "ว่าง" จะกำกวม)');
  if (!/push_coverage/.test(panel))
    bad.push('src/components/PushCoveragePanel.jsx (ไม่ได้เรียก RPC push_coverage — RLS ไม่ให้นับของคนอื่น)');
  const mig = readFileSync(join(ROOT, 'supabase/migrations/20261020_push_coverage_rpc_main.sql'), 'utf8');
  if (!/raise exception/.test(mig) || !/42501/.test(mig))
    bad.push('migration push_coverage (ไม่โยน 42501 เมื่อไม่มีสิทธิ์ = จอแยกไม่ออกว่าไม่มีสิทธิ์หรือไม่มีข้อมูล)');
  if (!/has_perm\('page:\/notification-config'\)/.test(mig))
    bad.push('migration push_coverage (ด่านไม่ใช่คีย์เดียวกับหน้าที่เรียกใช้)');

  assert.deepEqual(bad, [], '\n\n❌ ' + bad.join('\n   ') + '\n'
    + '   ทำไม: แถบนี้เป็นทางเดียวที่คนหน้างานจะรู้ว่า "มือถือตัวเองยังไม่เปิดแจ้งเตือน"\n'
    + '         (วัด 20/10: 74 จาก 102 คนที่ได้รับแจ้งเตือน ไม่มีเครื่องผูกไว้เลย)\n'
    + '   แก้: คงการ mount ใน App.jsx · ตัดด้วย useIsMobile · ข้อความอยู่ utils/pushPrompt.js ที่เดียว\n');
});

/* ── 🔧 QA ต้องเห็น "ใบซ่อมรอตรวจ" + ยอดกองต้องเป็นยอดจริง (2026-10-22) ────────────────────
   ที่มา (คำสั่ง user 21/10): *"ตอนนี้ QA จะรู้ได้ยังไงว่ามี MO ที่ค้างรอ QA อนุมัติกี่ใบ"*
   วัด 22/10: ใบรอ QA จริง **92 ใบ เก่าสุด 36 วัน** แต่
     · หน้า `/qa` ทั้ง 9 แท็บไม่มีที่ไหนพูดถึงใบซ่อมเลย
     · บรรทัดสรุปในแผงคิวนับจากชุดรายการที่ถูกตัดที่ 300 แถว (ใบเปิดค้าง 672) ⇒ นับได้ 26 และไม่บอกว่าไม่ครบ
   ด่านนี้กัน: ถอดแท็บออก · กลับไปนับกองจากชุดที่ถูกตัด · เทียบ `status === 'qa'` ดิบแทน moWaitMeta */
test('🔧 ใบซ่อมรอ QA — ต้องมีแท็บใน /qa · นับกองจากชุดเต็ม · ตัดสินขั้นด้วย moWaitMeta', () => {
  const bad = [];
  const qc    = stripComments(readFileSync(join(ROOT, 'src/pages/QualityControl.jsx'), 'utf8'));
  const panel = stripComments(readFileSync(join(ROOT, 'src/components/QaMoPending.jsx'), 'utf8'));
  const queue = stripComments(readFileSync(join(ROOT, 'src/utils/myQueue.js'), 'utf8'));
  const mq    = stripComments(readFileSync(join(ROOT, 'src/components/MyQueuePanel.jsx'), 'utf8'));

  if (!/key:\s*'morepair'/.test(qc)) bad.push("src/pages/QualityControl.jsx (ไม่มีแท็บ 'morepair' แล้ว)");
  if (!/<QaMoPending\b/.test(qc))    bad.push('src/pages/QualityControl.jsx (ไม่ได้วาด <QaMoPending>)');

  /* 🔴 "ใบนี้รอ QA ไหม" ต้องผ่าน moWaitMeta — ขั้น 5 = QA ของ JIG/DIE แต่ = รับมอบ ของ MTN
     เทียบ status ดิบ = ลากใบ MTN ที่ลูปไม่มี QA เข้ามาด้วย */
  if (!/moWaitMeta\(/.test(panel))
    bad.push('src/components/QaMoPending.jsx (ไม่ได้ใช้ moWaitMeta — ตัดสินขั้นเองไม่ได้)');
  if (/status\s*===\s*'qa'/.test(panel))
    bad.push("src/components/QaMoPending.jsx (เทียบ status === 'qa' ดิบ — ใบ MTN จะถูกนับผิด)");
  if (!/ห้ามโชว์\s*0|ไม่ใช่ว่าไม่มี/.test(panel))
    bad.push('src/components/QaMoPending.jsx (อ่านไม่ได้แล้วไม่ได้เขียนบนจอ — ลิสต์ว่าง 2 ความหมาย)');

  /* ยอดกองในแผงคิวต้องนับจากชุดเต็ม (moAll) และบอกเมื่อนับไม่ครบ */
  if (!/src\.moAll/.test(queue))
    bad.push('src/utils/myQueue.js (ไม่รับชุดนับเต็ม moAll — กลับไปนับจากชุดที่ถูกตัด)');
  if (!/capped:\s*countsCapped/.test(queue))
    bad.push('src/utils/myQueue.js (บรรทัดสรุปไม่ติดธงว่านับไม่ครบ)');
  if (!/moAll:/.test(mq))
    bad.push('src/components/MyQueuePanel.jsx (ไม่ได้ส่ง moAll เข้า buildQueue)');
  /* 🔴 ชุดที่ใช้นับต้องครอบใบเปิดค้างได้จริง — วันนี้ทำด้วย LIMIT 1000 บนคิวรีเดียว (26/10)
     ด่านนี้จึงเช็ค "เพดานถึงพันไหม" ไม่ใช่ "มีคิวรีนับแยกไหม" (ยิง 2 รอบบนชุดเดียวกัน = เปลือง egress) */
  if (!/const LIMIT = 1000;/.test(mq))
    bad.push('src/components/MyQueuePanel.jsx (เพดานแถวต่ำกว่า 1000 — ชุดนับกองกลับไปถูกตัด)');
  if (!/moAllCapped:/.test(mq))
    bad.push('src/components/MyQueuePanel.jsx (ไม่ส่ง moAllCapped — ชนเพดานแล้วจอไม่รู้ว่านับไม่ครบ)');

  assert.deepEqual(bad, [], '\n\n❌ ' + bad.join('\n   ') + '\n'
    + '   ทำไม: QA ไม่มีทางรู้ว่ามีใบรอตรวจกี่ใบ (วัด 22/10: 92 ใบ เก่าสุด 36 วัน)\n'
    + '         และบรรทัดสรุปเคยนับจากชุด 300 แถว = ต่ำกว่าจริงโดยไม่บอกใคร\n'
    + '   แก้: คงแท็บ morepair ใน /qa · นับกองจาก moAll · ตัดสินขั้นด้วย moWaitMeta เท่านั้น\n');
});

/* ── 🔚 พักที่ผูกปลายกะ: กรอบที่ไม่ใช่ "ทั้งกะ" ต้องส่ง shiftEndMs (2026-10-20) ──────
   `breakIntervalsIn` ถอยไปใช้ "ปลายกรอบ" เมื่อไม่ส่ง `shiftEndMs` — ถูกเฉพาะกรอบที่เป็นทั้งกะ
   จุดที่กรอบเป็น "ถึงตอนนี้" (OEE สด · ผังรวมโรงงาน) หรือ "ช่วงที่ใบ/พาร์ทวิ่ง" (แท็บประวัติ ·
   ctReview · computeSessionOee) ถ้าไม่ส่ง ⇒ พักท้ายกะ (5ส.) จะไหลไปเกาะปลายของทุกช่วง
   = **หักพักซ้ำทุกใบ** โดยตัวเลขยังดูสมเหตุสมผล (ไม่มี error ให้เห็น)
   ⚠️ ด่านนี้คุม "จุดที่รู้แล้วว่ากรอบไม่ใช่ทั้งกะ" — เพิ่มจุดใหม่ที่เข้าข่าย ให้เพิ่มในลิสต์นี้ด้วย */
test('🛡️ break-anchor-needs-shift-end — จุดที่กรอบ ≠ ทั้งกะ ต้องส่ง shiftEndMs ให้ breakIntervalsIn', () => {
  const NEED = [
    ['src/utils/oee.js', 'brkIvIn', /const brkIvIn = \([\s\S]{0,400}?\}\);/],
    ['src/utils/oee.js', 'computeLiveOee', /const brkIv = usablePolicies\.length[\s\S]{0,400}?: \[\];/],
    ['src/utils/ctReview.js', 'ช่วงของใบผลิต', /const brkIv = breakIntervalsIn\(\{[\s\S]{0,400}?\}\);/],
    ['src/pages/DailyReport.jsx', 'histBreakIv', /const histBreakIv = \([\s\S]{0,300}?\);/],
    ['src/pages/FactoryMap.jsx', 'brkIvWin', /const brkIvWin = breakIntervalsIn\(\{[\s\S]{0,400}?\}\);/],
  ];
  const bad = [];
  for (const [rel, what, re] of NEED) {
    const code = stripComments(readFileSync(join(ROOT, rel), 'utf8'));
    const m = code.match(re);
    if (!m) { bad.push(`${rel} — หาบล็อก ${what} ไม่เจอ (ย้าย/เปลี่ยนชื่อแล้ว? อัพเดทด่านนี้ด้วย)`); continue; }
    if (!/shiftEndMs/.test(m[0])) bad.push(`${rel} — ${what} ไม่ได้ส่ง shiftEndMs`);
  }
  // computeLiveOee ต้องไม่เดาเวลาเลิกกะ: กะที่ยังเปิดอยู่ไม่มี end_time ⇒ ต้องกรองแถว shift_end ออก
  const oee = stripComments(readFileSync(join(ROOT, 'src/utils/oee.js'), 'utf8'));
  if (!/usablePolicies\s*=\s*hardEndMs\s*\?/.test(oee))
    bad.push("src/utils/oee.js — computeLiveOee ต้องกรองแถว anchor='shift_end' ออกเมื่อยังไม่รู้เวลาเลิกกะ");
  if (!/noShiftEndBreak/.test(oee))
    bad.push('src/utils/oee.js — ต้องคืนธง noShiftEndBreak ให้จอเขียนบอกว่ายังไม่ได้หักพักท้ายกะ');
  assert.deepEqual(bad, [],
    '\n\n❌ จุดด้านล่างจะหักเวลาพัก "ท้ายกะ" ผิดที่:\n'
    + bad.map(b => '   • ' + b).join('\n') + '\n'
    + '   ทำไมสำคัญ: 5ส. ถูกตั้งเป็น anchor=shift_end (ยึดเวลาเลิกกะ) ตั้งแต่ 20/10\n'
    + '   กรอบที่ส่งเข้าไปถ้าไม่ใช่ทั้งกะ แล้วไม่บอกปลายกะ = พักไปเกาะปลายกรอบนั้นแทน\n'
    + '   แก้ยังไง: ส่ง shiftEndMs = เวลาเลิกกะจริง (shiftFrameOf(session)?.endMs / capMs / end_time)\n'
    + '            ยังไม่รู้เวลาเลิกกะ = อย่าเดา ให้กรองแถว shift_end ออกแล้วชูธงบอกจอ\n');
});

/* ── ☕ คิวรี `break_policies` ที่เลือกคอลัมน์เอง ต้องครบทุกแกนของกติกาพัก (2026-10-20) ──
   🔴 เคสจริงที่ทำให้ต้องมีด่านนี้ (20/10 · หัวหน้า Apron Assy ทัก):
   ย้าย 5ส. ไปเป็นแถว `anchor='shift_end'` + ปิดแถวนาฬิกาเก่า แต่ **10 คิวรีเลือกคอลัมน์เอง
   โดยไม่ได้ดึง `anchor`/`offset_min`** ⇒ จอพวกนั้นอ่านแถว 5ส. ได้ `start_time = null`
   → `String(p.start_time || '00:00')` → ตีเป็น 00:00 → หลุดนอกกรอบกะ → **5ส. 20 นาทีหายไปเงียบๆ**
   ⇒ ฐานเวลาบวม 20 นาที ⇒ **%A/%P ต่ำกว่าจริงทุกจอที่คำนวณสดย้อนหลัง** (จอ Line 61 20/10:
   พัก 110 แทนที่จะเป็น 130 · "OEE จริง" ต่ำกว่าความจริง) — build/lint/เทสผ่านหมด ไม่มีใครเห็น
   บทเรียนเดียวกับรอบ `ot_scope` (14/09) ที่เคยหลุดแบบนี้มาแล้ว — คราวนี้ล็อกด้วยด่าน            */
test('🛡️ break-policy-select-needs-all-axes — คิวรี break_policies ที่เลือกคอลัมน์เองต้องมีครบทุกแกน', () => {
  const NEED = ['ot_scope', 'anchor', 'offset_min'];
  const bad = [];
  for (const full of walk(join(ROOT, 'src'), ['.js', '.jsx'])) {
    const rel = full.slice(ROOT.length).replace(/\\/g, '/');
    const code = stripComments(readFileSync(full, 'utf8'));
    let i = 0;
    while ((i = code.indexOf("from('break_policies')", i)) >= 0) {
      /* 🔴 ต้องตัดขอบเขตที่ "คิวรีถัดไป" ก่อน (28/10) — เดิมมองยาว 260 ตัวอักษรรวด
         ⇒ ไปจับ `.select('id, line_name, …')` ของคิวรีตัวถัดไปใน Promise.all เดียวกัน
            มาเป็นคอลัมน์ของ break_policies แล้วฟ้องว่า "ขาดทุกแกน" (false positive จริงที่
            ProductionPlan.jsx) · ด่านที่ฟ้องผิดทำให้คนเลิกเชื่อด่าน */
      const win = code.slice(i, i + 260);
      const nextFrom = win.indexOf(".from('", 1);
      const tail = nextFrom > 0 ? win.slice(0, nextFrom) : win;
      i += 22;
      const selAt = tail.indexOf('.select(');
      if (selAt < 0) continue;                                 // ไม่มี select = ไม่ใช่การอ่าน
      const arg = tail.slice(selAt + '.select('.length).trimStart();
      /* ส่ง **ตัวแปร** มา (ชุดกลาง `BREAK_POLICY_COLS` ใน utils/oeeMasters.js) = ครบแน่นอน
         — ด่าน `break-policy-cols-central` เป็นคนบังคับว่าต้องเป็นชุดกลางหรือ '*' เท่านั้น */
      if (!/^['"`]/.test(arg)) continue;
      const m = arg.match(/^(['"`])([^'"`]*)\1/);
      if (!m) continue;
      /* `.delete().select('id')` = นับแถวตามกฎเขียน DB ข้อ 2 ไม่ใช่การอ่านนโยบาย — ข้าม */
      if (/\.(delete|insert|update)\s*\(/.test(tail.slice(0, selAt))) continue;
      const cols = m[2];
      if (cols.trim() === '*') continue;      // ชุดเต็ม = ครบอยู่แล้ว
      const miss = NEED.filter(c => !cols.includes(c));
      if (miss.length) bad.push(`${rel} — select ขาด: ${miss.join(', ')}`);
    }
  }
  assert.deepEqual(bad, [],
    '\n\n❌ คิวรีด้านล่างอ่าน `break_policies` ไม่ครบแกน — ช่วงพักจะถูกคิดผิดแบบเงียบๆ:\n'
    + bad.map(b => '   • ' + b).join('\n') + '\n'
    + '   ทำไมสำคัญ: ขาด `anchor`/`offset_min` = แถวพักท้ายกะ (5ส.) ถูกตีเป็นเวลา 00:00 แล้วหลุดกรอบกะ\n'
    + '              ⇒ ฐานเวลาบวม ⇒ %A/%P ต่ำกว่าจริง · ขาด `ot_scope` = หักพักซ้ำในกะที่ทำโอ\n'
    + '   แก้ยังไง: เติมคอลัมน์ที่ขาดใน .select() หรือใช้ `loadBreakPolicies()` (utils/oeeMasters.js) ที่ดึงชุดเต็ม\n');
});

/* ── 🏭 ข้อยกเว้นเวลาพัก "รายไลน์" ต้องมีทางเข้าทางเดียว (2026-10-20) ─────────────────
   ที่มา: feedback หน้างาน *"บางไลน์เค้าทำ5สก่อนเลิกงานแค่ 10นาที หรือ5นาทีก็มี"*
   จุดคิดเวลาพักกระจาย 15 จุด / 21 จอ ⇒ เลือกทางให้สูตร OEE อ่าน **ทะเบียนกลาง** เอง
   (`utils/breakLineRules.js` — มี `session.line_name` อยู่แล้ว จอไม่ต้องไล่ส่ง prop)
   ⇒ ด่านนี้กันของที่ทำให้ฟีเจอร์ "ตายเงียบ" หรือ "นับพักผิด" โดยที่ build ยังผ่าน    */
test('🛡️ break-line-rules-single-entry — ข้อยกเว้นเวลาพักรายไลน์ต้องมีทางเข้าทางเดียว', () => {
  const bad = [];
  const oee  = stripComments(readFileSync(join(ROOT, 'src/utils/oee.js'), 'utf8'));
  const rules = stripComments(readFileSync(join(ROOT, 'src/utils/breakLineRules.js'), 'utf8'));
  const masters = stripComments(readFileSync(join(ROOT, 'src/utils/oeeMasters.js'), 'utf8'));

  /* ① `breakIntervalsIn` ต้องถอยไปอ่านทะเบียนกลางเมื่อผู้เรียกไม่ส่ง `lineRules`
        ถอดบรรทัดนี้ = ทุกจอกลับไปใช้ค่ากลาง เงียบสนิท (เทสหน่วยที่ส่ง lineRules เองยังผ่านหมด) */
  if (!/applyBreakLineRules\(\s*applicable\s*,\s*lineRules\s*\?\?\s*breakLineRuleIndexSync\(\)/.test(oee))
    bad.push('src/utils/oee.js — breakIntervalsIn ต้องเรียก applyBreakLineRules(applicable, lineRules ?? breakLineRuleIndexSync(), lineName)');

  /* ② 🔴 `isOt` ต้องตัดสิน **ก่อน** ทับค่ารายไลน์ — ไลน์ที่ตั้งพักโอเป็น 0 แปลว่า
        "ไลน์นี้ไม่พักรอบนั้น" ไม่ใช่ "ไลน์นี้ไม่ได้ทำโอ" · สลับลำดับ = ปลุก `no_ot` กลับมา = หักพักซ้ำ */
  const iOt = oee.indexOf('const isOt = applicable.some(');
  const iApply = oee.indexOf('applyBreakLineRules(applicable');
  if (iOt < 0 || iApply < 0) bad.push('src/utils/oee.js — หาบรรทัด isOt / applyBreakLineRules ไม่เจอ (เปลี่ยนโครงแล้ว? อัพเดทด่านนี้)');
  else if (iOt > iApply) bad.push('src/utils/oee.js — isOt ต้องคำนวณก่อน applyBreakLineRules (ค่ากลางชนะ) ห้ามสลับลำดับ');

  /* ③ การทับค่า + การไล่สายไลน์แม่-ลูก ต้องอยู่ใน 2 ไฟล์นี้เท่านั้น — หน้าไหนทำเองจะ drift */
  const OWNERS = new Set(['src/utils/oee.js', 'src/utils/breakLineRules.js', 'src/utils/oeeMasters.js']);
  for (const full of walk(join(ROOT, 'src'), ['.js', '.jsx'])) {
    const r = full.slice(ROOT.length).replace(/\\/g, '/');   // ROOT ลงท้ายด้วย '/' อยู่แล้ว
    if (OWNERS.has(r)) continue;
    const code = stripComments(readFileSync(full, 'utf8'));
    if (/\bapplyBreakLineRules\s*\(/.test(code))
      bad.push(`${r} — ห้ามเรียก applyBreakLineRules เอง (ทับค่าได้ที่ breakIntervalsIn ที่เดียว)`);
    if (/\bsetBreakLineRuleIndex\s*\(/.test(code))
      bad.push(`${r} — ห้ามตั้งทะเบียนกลางเอง ใช้ primeBreakRuleIndex() ใน utils/oeeMasters.js`);
    /* ไล่สายแม่-ลูกของ "กฎเวลาพัก" เองในหน้า = มีกฎ 2 ชุด ⇒ จอตั้งค่าโชว์คนละเรื่องกับที่คิด %A/%P
       (จับเฉพาะไฟล์ที่แตะ breakLineRules จริง — `parent_line_name` เฉยๆ เป็นเรื่องปกติของหลายหน้า) */
    if (/from '[^']*breakLineRules'/.test(code) && /getAncestorNames\s*\(/.test(code))
      bad.push(`${r} — ห้ามไล่สายไลน์แม่-ลูกของกฎเวลาพักเองในหน้า (ใช้ breakRuleFollowers/buildBreakLineRuleIndex)`);
  }

  /* ④ ค่าว่างห้ามกลายเป็น 0 — `Number(null)` = 0 ⇒ "ไม่ได้กรอก" จะลบพักของไลน์นั้นทิ้งเงียบๆ */
  if (!/raw === null \|\| raw === undefined \|\| raw === ''/.test(rules))
    bad.push("src/utils/breakLineRules.js — ruleDurationOf ต้องปฏิเสธ null/undefined/'' ก่อนแปลงเป็นเลข (Number(null) = 0)");

  /* ⑤ ทะเบียนกลางต้องถูกปลุกจริง — ทั้งตอนโหลดนโยบายพัก และตอนเปิดแอป */
  if (!/primeBreakRuleIndex\(\);/.test(masters))
    bad.push('src/utils/oeeMasters.js — loadBreakPolicies() ต้องปลุก primeBreakRuleIndex()');
  const app = stripComments(readFileSync(join(ROOT, 'src/App.jsx'), 'utf8'));
  if (!/primeBreakRuleIndex\(\)/.test(app))
    bad.push('src/App.jsx — ต้องปลุก primeBreakRuleIndex() (จอ OEE บางจอคิวรี break_policies ตรงๆ)');

  /* ⑥ 🏭 บอร์ดไทม์ไลน์ 24 ชม. — แถบเงาเวลาพักต้องเป็น "ของไลน์แถวนั้น" (20/10 รอบที่ 2)
        เดิมทั้ง 3 จอวาดแถบจากค่ากลาง + เดาว่า "แถบนี้คือพักอะไร" ด้วยการจับคู่ `start_time` เอง
        ⇒ พัก `anchor='shift_end'` (`start_time = null`) จับไม่ติด = tooltip เขียน "undefined"
          และไลน์ที่ตั้ง 5ส. 10 นาที ถูกวาดเป็น 20 นาที = จอบอกเวลาพักผิดจากที่ไลน์ตั้งไว้ */
  const BOARDS = ['src/pages/Dashboard.jsx', 'src/pages/Management.jsx', 'src/pages/HeijunkaKanban.jsx'];
  for (const rel of BOARDS) {
    const code = stripComments(readFileSync(join(ROOT, rel), 'utf8'));
    // (ก) ห้ามจับคู่นโยบายจากเวลาเอง — ชื่อพักต้องมาจาก `band.policies` ที่ breakBandsIn ติดมา
    if (/half\.hours\.indexOf\(\s*Number\(\s*String\(\s*bp\.start_time/.test(code))
      bad.push(`${rel} — ห้ามหานโยบายของแถบพักด้วยการจับคู่ start_time เอง (ใช้ band.policies จาก halfDayBreakBands)`);
    // (ข) ต้องวาดแถบจาก halfDayBreakBands (ตัวที่ติดป้ายมาให้)
    if (!/halfDayBreakBands/.test(code))
      bad.push(`${rel} — บอร์ดไทม์ไลน์ต้องวาดแถบพักผ่าน halfDayBreakBands (ได้ชื่อพัก + ป้าย "ไลน์นี้ตั้งเอง")`);
    /* (ค) 🔴 ตัวสำคัญที่สุด — เรียกแบบ**ไม่ส่งชื่อไลน์** = ไลน์ที่ตั้งเวลาพักเองกลับไปใช้ค่ากลาง
           เงียบสนิท (จอดูปกติ · build/lint/เทสผ่านหมด) ซึ่งเป็นสถานะก่อน 20/10 รอบที่ 2 พอดี */
    for (const call of ['getBreakBands(half)', 'getBreakIntervals(half)', 'allBreaksOnce()'])
      if (code.includes(call))
        bad.push(`${rel} — \`${call}\` ไม่ส่งชื่อไลน์ ⇒ แถวนั้นกลับไปใช้เวลาพักค่ากลางเงียบๆ (ส่ง row.line / lineName)`);
  }

  assert.deepEqual(bad, [],
    '\n\n❌ ข้อยกเว้นเวลาพัก "รายไลน์" จะเพี้ยน/ตายเงียบ:\n'
    + bad.map(b => '   • ' + b).join('\n') + '\n'
    + '   ทำไมสำคัญ: ไลน์ที่ตั้ง 5ส. 10 นาที ถ้าระบบกลับไปหัก 20 นาที = ฐานเวลาของ %A/%P\n'
    + '              ผิดทุกกะ โดยที่จอดูปกติและ build ผ่าน — หาไม่เจอจนกว่าจะมีคนทักจากหน้างาน\n'
    + '              บอร์ดไทม์ไลน์ที่วาดแถบเงาต้องส่งชื่อไลน์ของแถวนั้นเข้า halfDayBreakBands\n'
    + '   เจ้าของกฎ: src/utils/breakLineRules.js (ไล่สายแม่-ลูก + ทะเบียนกลาง + ป้ายบนแถบ)\n'
    + '              src/utils/oee.js  (จุดทับค่าจุดเดียว — ใน breakIntervalsIn)\n');
});

/* 🛡️ limit-over-postgrest-cap — `.limit(N > 1000)` = ความมั่นใจปลอม (QC audit 19/10)
   PostgREST **clamp ที่ 1000 แถวเสมอ** ⇒ `.limit(5000)` ไม่ได้ขยายอะไรเลย และ "ถูกตัดแถว"
   **ไม่ใช่ error** ⇒ `if (error)` จับไม่ได้ จอได้ข้อมูลไม่ครบแบบเงียบสนิท
   เคสจริงที่ทำให้ต้องมีด่านนี้ — `CtReview.jsx` `.in(session_id).limit(5000)`:
     วัด 19/10 ต่อไลน์ 60 วัน `prod_orders` สูงสุด **2,802 แถว (เกิน 1000 อยู่ 4 ไลน์)** ·
     `downtime_logs` 1,179 ⇒ หักเวลาหยุดไม่ครบ ⇒ CT ที่เสนอช้ากว่าจริง ⇒ อนุมัติแล้วเขียนทับ
     `dr_products.cycle_time_sec` = ตัวเศษ %P ทั้งโรงงาน · กฎนี้เขียนไว้ในคอมเมนต์ 5 ที่มาก่อน
     **แต่ไม่มีด่าน** จึง drift เรื่อยๆ
   กติกา: เกิน 1000 ต้องมีคำว่า `cap-ok` ใน 3 บรรทัดเหนือขึ้นไป พร้อม**ตัวเลขที่วัดมา**
          — ไม่ใช่ตรายาง: ถ้าวัดไม่ได้/วัดแล้วเกิน ให้เปลี่ยนไปใช้
          `fetchByIds` / `fetchAllPages` / `fetchAllRows` (แบ่งก้อน + แบ่งหน้า + order คู่ range) */
test('🛡️ limit-over-postgrest-cap — .limit(N > 1000) ต้องมีหลักฐาน cap-ok ว่าไม่ชนเพดาน', () => {
  const bad = [];
  for (const file of walk(join(ROOT, 'src'), ['.js', '.jsx'])) {
    const raw = readFileSync(file, 'utf8');
    const rawLines = raw.split('\n');
    /* ตัดคอมเมนต์ก่อน — ไม่งั้นคำเตือน ".limit(5000) ใช้ไม่ได้" ที่เขียนกันไว้ 7 ที่จะกลายเป็นผู้ต้องหา */
    stripComments(raw).split('\n').forEach((ln, i) => {
      const m = ln.match(/\.limit\(\s*(\d+)\s*\)/);
      if (!m || Number(m[1]) <= 1000) return;
      const near = rawLines.slice(Math.max(0, i - 3), i + 1).join('\n');
      if (!/cap-ok/.test(near)) bad.push(`${file.slice(ROOT.length)}:${i + 1} (.limit(${m[1]}))`);
    });
  }
  assert.deepEqual(bad, [], '\n\n❌ ' + bad.join(', ') + '\n'
    + '   ทำไม: PostgREST clamp ที่ 1000 แถวเสมอ — `.limit(5000)` ไม่ได้อะไรเพิ่ม\n'
    + '         และการถูกตัดแถวไม่ใช่ error ⇒ จอได้ข้อมูลไม่ครบเงียบๆ (CT/OEE/ยอด เพี้ยนโดยไม่มีสัญญาณ)\n'
    + '   แก้: โตเกิน 1000 ได้ → fetchByIds / fetchAllPages / fetchAllRows (แบ่งหน้า + order คู่ range)\n'
    + '        โตไม่ถึงจริง → เขียน `cap-ok: <ตาราง> วัด <วันที่> = <N> แถว` เหนือบรรทัดนั้น (ต้องวัดจริง)\n');
});

/* 🛡️ lpa-read-fail-not-missed — `/lpa` อ่านไม่สำเร็จ ≠ "ขาดตรวจ" และ ≠ "ยังไม่มีใบ" (QC audit 20/10)
   2 คิวรีฝั่ง Main ของหน้านี้เคยแกะแต่ `{ data }` ทิ้ง `error`:
     ① ใบของเดือน (`loadMonth`) ล้ม ⇒ ทั้งเดือนขึ้น "ขาดตรวจ" + ตัวหาร % คิดจากใบ 0 ใบ
        = **จอกล่าวหาหน้างานว่าไม่ตรวจ** (ไฟล์นี้ระวังฝั่ง DR ไว้ดีแล้วด้วย `loadRunDays` แต่ฝั่ง Main ไม่มีด่าน)
     ② ใบที่กำลังกรอก (effect โหลด draft) ล้ม ⇒ ได้ใบร่างเปล่า แล้ว `saveAudit` ทำ
        upsert → delete คำตอบทั้งใบ → insert ชุดใหม่ = **คำตอบที่ตรวจไปแล้วหายถาวร**
   ด่าน `daily-check-unknown-not-false` จับเฉพาะรูป `ranOn(…) ?? false` จึงมองไม่เห็นทั้ง 2 เคส */
test('🛡️ lpa-read-fail-not-missed — /lpa ต้องอ่าน error ของ lpa_audits แล้ว fail-closed', () => {
  const bad = [];
  const rel = 'src/pages/LayerProcessAudit.jsx';
  const code = stripComments(readFileSync(join(ROOT, rel), 'utf8'));
  /* แกะ `{ data: x }` จาก Promise.all โดยไม่เก็บตัว result ไว้อ่าน error = กลืน error ตั้งแต่ต้นทาง */
  /* ตรวจเฉพาะก้อนที่ดึง `lpa_audits` — ก้อนอื่น (ทะเบียนคำถาม/ไลน์/โปรไฟล์) เป็นคนละเรื่อง */
  for (const m of code.matchAll(/const \[\{\s*data:[^\]]*\]\s*=\s*await Promise\.all\(\[/g)) {
    if (/lpa_audits/.test(code.slice(m.index, m.index + 700)))
      bad.push(rel + ' (แกะ { data } จาก Promise.all ที่ดึง lpa_audits = ทิ้ง error)');
  }
  for (const [v, why] of [
    ['monthErr', 'ตารางเดือน: อ่านไม่ได้ต้องเป็น unknown ทั้งเดือน ห้ามเป็น "ขาดตรวจ"'],
    ['draftErr', 'ใบที่กำลังกรอก: อ่านไม่ได้ต้องไม่ตั้ง draft (บันทึกทับแล้วคำตอบเดิมหาย)'],
  ]) if (!new RegExp(`\\b${v}\\b`).test(code)) bad.push(`${rel} (ไม่มี ${v} — ${why})`);
  /* เดือนที่อ่านไม่ได้ต้องส่ง planned/ran เป็น null เข้า checkDayState (null ⇒ unknown) */
  if (!/monthErr \? null :/.test(code))
    bad.push(rel + ' (checkDayState ไม่ได้รับ null ตอน monthErr — เดือนที่อ่านไม่ได้จะกลายเป็น "ขาดตรวจ")');
  assert.deepEqual(bad, [], '\n\n❌ ' + bad.join(', ') + '\n'
    + '   ทำไม: อ่านไม่สำเร็จ = "ไม่รู้" — บีบเป็น "ขาดตรวจ" คือจอโกหกในทิศที่กล่าวหาคน\n'
    + '         และใบร่างเปล่าที่มาจากการอ่านที่ล้ม พอกดบันทึกจะลบคำตอบเดิมทั้งใบ (delete-then-insert)\n'
    + '   แก้: เก็บผลเป็นตัวแปร (exRes/audRes) อ่าน .error → ตั้ง draftErr/monthErr แล้ว fail-closed\n');
});

/* 🛡️ cc-scope-trigger-columns — คอลัมน์ที่ "ให้สิทธิ์" ต้องอยู่ใน protect_profile_role() (QC audit 20/10)
   `profiles.resp_cost_centers` (แกนที่ 2 ของชั้นสิทธิ์ ③ · `utils/ccScope.js`) เพิ่มมา 16/10
   แต่ไม่มีใครเติมเข้า trigger ⇒ เจ้าของแถว `PATCH /profiles?id=eq.<ตัวเอง>` ตั้งขอบเขตให้ตัวเองได้
   🔴 เกิดซ้ำรอบที่ 2 — migration 12/10 เขียนเตือนคลาสนี้ไว้เองแล้ว ("คอลัมน์ที่เพิ่มทีหลัง") */
test('🛡️ cc-scope-trigger-columns — คอลัมน์ให้สิทธิ์ใน profiles ต้องถูก trigger กันครบ', () => {
  const dir = join(ROOT, 'supabase/migrations');
  const defs = readdirSync(dir).filter(f => f.endsWith('.sql'))
    .map(f => readFileSync(join(dir, f), 'utf8'))
    .filter(sql => /create or replace function public\.protect_profile_role/i.test(sql));
  const bad = [];
  if (!defs.length) bad.push('ไม่พบ migration ที่นิยาม protect_profile_role()');
  /* ดูนิยาม "ล่าสุด" ตามลำดับชื่อไฟล์ — create or replace ตัวหลังชนะตัวหน้า */
  const latest = defs[defs.length - 1] || '';
  for (const col of ['role', 'sections', 'section', 'scope_depth', 'resp_cost_centers']) {
    if (!new RegExp(`new\\.${col}\\s+is distinct from\\s+old\\.${col}`).test(latest))
      bad.push(`protect_profile_role() ไม่ได้กันคอลัมน์ ${col}`);
  }
  assert.deepEqual(bad, [], '\n\n❌ ' + bad.join(', ') + '\n'
    + '   ทำไม: คอลัมน์พวกนี้ = "ขอบเขตที่บัญชีนี้แก้ได้" — ปล่อยให้เจ้าของแถวแก้เอง = ยกสิทธิ์ให้ตัวเอง\n'
    + '   แก้: migration ใหม่ `create or replace function public.protect_profile_role()` ที่คัดลอกของเดิม\n'
    + '        มาครบ แล้วเติมบล็อก `if new.<col> is distinct from old.<col> then raise exception …`\n');
});
/* ── 📥 ลบใบที่ "ยกยอดมาจากกะก่อน" ต้องคืนยอดค้างให้ต้นทาง (2026-10-20) ───────────
   ตอนกดรับยอด ระบบมาร์คใบต้นทางเป็น `imported` (= ถูกรับไปแล้ว) ⇒ ลบใบปลายทางทิ้ง
   = ต้นทางค้าง `imported` ตลอดกาล · แบนเนอร์ "รับยอดค้าง" ไม่กลับมา · **งานหายถาวร
   ไม่มีทางกู้จากจอ** (เคสจริง Assy GOR 20/10: ยก 2 ชิ้นจากกะดึก แล้วถูกลบตอนไล่ลบใบขยะ
   → กะเช้ารายงาน "ไม่ขึ้นให้รับ" ทั้งที่ระบบส่งต่อทำงานถูกทุกขั้น · กู้คืนจาก audit_log)

   ⌨️ และต้นเหตุของ "ใบขยะ" รอบนั้น = เครื่องสแกนยิงตอนแป้นค้างภาษาไทย (6 ใบใน 10 วินาที)
   ⇒ ช่องรับเลขใบต้องกรองอักษรไทยเสมอ (`utils/kbLayout.js`) */
test('🛡️ carry-delete-restores-source — ลบใบยกยอดต้องคืนต้นทาง + ช่องสแกนต้องกันแป้นไทย', () => {
  const code = stripComments(readFileSync(join(ROOT, 'src/pages/DailyReport.jsx'), 'utf8'));
  const bad = [];

  const del = code.match(/const handleDeleteProdOrder = async \([\s\S]*?\n  \};/);
  if (!del) bad.push('หา handleDeleteProdOrder ไม่เจอ (เปลี่ยนชื่อ/ย้ายแล้ว? อัพเดทด่านนี้ด้วย)');
  else {
    if (!/carry_over_from_session_id/.test(del[0]))
      bad.push("handleDeleteProdOrder ไม่ได้ดู carry_over_from_session_id — ไม่รู้ว่าใบไหนยกยอดมา");
    if (!/status:\s*'carry_over'/.test(del[0]))
      bad.push("handleDeleteProdOrder ไม่ได้คืนต้นทางเป็น 'carry_over' — ยอดค้างหายถาวร");
    if (!/checkWriteRows/.test(del[0]))
      bad.push('handleDeleteProdOrder คืนต้นทางโดยไม่นับแถว — RLS ปฏิเสธ = 0 แถวเงียบ (กฎเหล็กข้อ 2)');
    // ต้องส่งทั้ง object ไม่ใช่แค่ id ไม่งั้นไม่รู้ว่าใบนี้ยกยอดมา/มียอดแล้ว
    if (/handleDeleteProdOrder\(o\.id\)/.test(code))
      bad.push('ยังมีจุดเรียก handleDeleteProdOrder(o.id) — ต้องส่งทั้งใบ เพื่อให้รู้ว่ายกยอดมา/มียอดแล้ว');
  }

  if (!/fixThaiLayout/.test(code) || !/hasThai/.test(code))
    bad.push('ช่องสแกนเลขใบไม่ได้ผ่าน utils/kbLayout.js — แป้นค้างภาษาไทยเปิดใบขยะได้อีก');

  assert.deepEqual(bad, [],
    '\n\n❌ ช่องโหว่ "ยอดค้างหายเงียบ" กลับมาแล้ว:\n'
    + bad.map(b => '   • ' + b).join('\n') + '\n'
    + '   ทำไมสำคัญ: ใบต้นทางถูกมาร์ค imported ตอนกะถัดไปกดรับ — ถ้าใบปลายทางหายไป\n'
    + '   ยอดค้างจะไม่โผล่ให้รับอีกเลย และไม่มีร่องรอยบนจอว่าหายไปไหน\n'
    + '   แก้ยังไง: ลบใบที่มี carry_over_from_session_id → update ต้นทาง (session+prod_no เดิม)\n'
    + '            จาก imported กลับเป็น carry_over ผ่าน checkWriteRows แล้วรีโหลดแบนเนอร์\n');
});

/* ── 🔤 PDF จาก jsPDF ต้องลงฟอนต์ไทยก่อนเขียนตัวอักษร (2026-10-20) ─────────────
   Helvetica ของ jsPDF ไม่มี glyph ไทย ⇒ ชื่อจุดตรวจ/ชื่อคนออกมาเป็นอักขระขยะทั้งใบ
   (เคสจริง: ใบ PM JIG FM-JIG-003 export จาก /pm — user: "แย่มาก") ·
   ตัวลงฟอนต์มีตัวเดียว `src/lib/pdfThaiFont.js` (`registerThaiFont`) */
test('🛡️ jspdf-needs-thai-font — ไฟล์ที่ new jsPDF ต้องเรียก registerThaiFont และห้ามตั้ง helvetica', () => {
  const bad = [];
  for (const file of walk(join(ROOT, 'src'), ['.jsx', '.js'])) {
    const code = stripComments(readFileSync(file, 'utf8'));
    if (!/new jsPDF\b/.test(code)) continue;
    const rel = relative(ROOT, file);
    if (!/registerThaiFont\(/.test(code)) bad.push(`${rel} — new jsPDF แต่ไม่เรียก registerThaiFont(doc)`);
    if (/['"]helvetica['"]/i.test(code)) bad.push(`${rel} — ตั้งฟอนต์ 'helvetica' (ไม่มี glyph ไทย)`);
  }
  assert.deepEqual(bad, [],
    '\n\n❌ PDF ภาษาไทยจะออกมาเป็นอักขระขยะ:\n' + bad.map(b => '   • ' + b).join('\n') + '\n'
    + "   แก้ยังไง: const { registerThaiFont } = await import('../lib/pdfThaiFont'); registerThaiFont(doc)\n"
    + "            แล้วใช้ฟอนต์ 'Sarabun' (รวมใน autoTable styles.font ด้วย)\n");
});

/* 🛡️ scope-layer-closed-screens — 4 จอที่ปิดรูชั้น ③ รอบ QC audit 20/10 ห้ามถอยกลับ
   ทั้ง 4 จุดมี "สิทธิ์กดปุ่ม" (ชั้น ②) อยู่แล้ว แต่**ไม่มีด่าน "แถวนี้/หน่วยนี้เป็นของเราไหม"**
   และ RLS ของตารางปลายทางรู้แค่คีย์สิทธิ์ ไม่รู้ขอบเขต ⇒ `?sec=`/`?scope=` เปิดตรงแล้วเขียนได้
     · `/manpower-board` ⚙️ — เขียน station_slot_plans / manpower_slot_plans / line_technicians / employee_flex_units ของส่วนงานอื่น
     · `/line-stock` 📋 ตรวจนับ — เขียน line_stock_transactions (+ approved ทันที) ของไลน์อื่น
     · `/equipment?tab=spare` 🛒 บอร์ด PR — รับของเข้าสต็อก/ยกเลิกใบของทีมช่างอื่น
     · แผงตัวเลขฐาน KPI — ทางนำเข้า Excel ไม่เช็คสิทธิ์เลย (ด่านอยู่ในโมดัลชั้นเดียว) */
test('🛡️ scope-layer-closed-screens — 4 จอที่ปิดรูชั้น ③ ต้องยังเช็คในฟังก์ชันที่เขียนจริง', () => {
  const bad = [];
  const read = (rel) => stripComments(readFileSync(join(ROOT, rel), 'utf8'));

  /* ⚙️ manpower: หน้าแม่ต้องส่งผลด่านลงแผงลูก (ส่งแค่ "เปิดได้ไหม" = แผงลูกเขียนข้ามหน่วยได้) */
  const mb = read('src/pages/ManpowerBoard.jsx');
  if (!/secWrite=\{canWriteUnit\(/.test(mb))
    bad.push('src/pages/ManpowerBoard.jsx (ไม่ได้ส่ง secWrite=canWriteUnit(...) ลง ManpowerBoardSetup)');
  const mbs = read('src/components/ManpowerBoardSetup.jsx');
  const blocks = (mbs.match(/if \(blocked\(\)\) return;/g) || []).length;
  if (blocks < 7) bad.push(`src/components/ManpowerBoardSetup.jsx (ด่าน blocked() เหลือ ${blocks} จุด — ต้องมีครบทุกฟังก์ชันที่เขียน DB)`);

  /* 📋 ตรวจนับสต็อก: ด่านต้องอยู่ใน save()/postMissingCuts() ไม่ใช่แค่กรองรายการใน <LineSelect> */
  const scs = read('src/components/StockCountSheet.jsx');
  if ((scs.match(/canWriteLine\(/g) || []).length < 2)
    bad.push('src/components/StockCountSheet.jsx (ต้องเรียก canWriteLine ทั้งตอนบันทึกผลนับและตอนหักสต็อกย้อนหลัง)');

  /* 🛒 PR: แกน "ทีม" (ฝั่งช่าง) — ปุ่มซ่อนอย่างเดียวไม่ใช่ด่าน ต้องเช็คซ้ำใน do* ทุกตัว */
  const pur = read('src/components/MtnPurchase.jsx');
  if (!/teamRowOwner\(/.test(pur)) bad.push('src/components/MtnPurchase.jsx (บอร์ด PR ไม่มีด่านเจ้าของทีม)');
  const owns = (pur.match(/if \(ownBlock\(\)\) return;/g) || []).length;
  if (owns < 4) bad.push(`src/components/MtnPurchase.jsx (ownBlock() เหลือ ${owns} จุด — ต้องครบ 4: เลข PR · สั่งแล้ว · รับของ · ยกเลิก)`);
  const eq = read('src/pages/EquipmentHub.jsx');
  if (!/<MtnPrBoard[^>]*myTeams=/s.test(eq))
    bad.push('src/pages/EquipmentHub.jsx (ไม่ได้ส่ง myTeams ให้ MtnPrBoard — แผงลูกตัดสินเจ้าของไม่ได้)');

  /* 💰 ตัวเลขฐาน KPI: ทางนำเข้าต้องเช็คเอง ไม่พึ่งโมดัล */
  const kb = read('src/components/KpiBaseInputsPanel.jsx');
  const many = kb.slice(kb.indexOf('const saveMany'), kb.indexOf('const saveMany') + 2200);
  if (!/if \(!canManage\)/.test(many)) bad.push('src/components/KpiBaseInputsPanel.jsx (saveMany ไม่เช็ค canManage)');
  if (!/lvl === 'plant' && !plant/.test(many)) bad.push("src/components/KpiBaseInputsPanel.jsx (saveMany ไม่กันตัวแปรระดับ plant ตอนยืนที่ขอบเขตหน่วย)");

  assert.deepEqual(bad, [], '\n\n❌ ' + bad.join(', ') + '\n'
    + '   ทำไม: "กดปุ่มเป็นไหม" (can) ≠ "หน่วย/ทีม/ไลน์นี้ของเราไหม" — RLS ปลายทางไม่รู้ขอบเขต\n'
    + '         ⇒ เปิด ?sec=/?scope= ของหน่วยอื่นแล้วเขียนได้จริง (ตั้งช่องตำแหน่ง · เฟิร์มยอดคลัง · รับของเข้าสต็อกทีมอื่น)\n'
    + '   แก้: canWriteUnit/canWriteLine (utils/writeScope.js) · teamRowOwner (utils/mtnTeams.js)\n'
    + '        เรียก **ในฟังก์ชันที่เขียน DB** + เขียนเหตุผลบนจอ (writeBlockText/teamRowLockNote) ห้ามซ่อนปุ่มเงียบ\n');
});

/* ── 🔐 ชั้นที่ ③ ของ **ทะเบียน 2 ตัวที่มีคอลัมน์หน่วยงานอยู่แล้ว** (20/10 · audit §14) ─────────
   ต่างจากด่าน `plant-registry-needs-perm-key` ข้างบน (ทะเบียนของกลางที่ไม่มีคอลัมน์หน่วยงาน
   ⇒ คีย์สิทธิ์เป็นด่านเดียวที่มีได้) — 2 ตารางนี้**บอกเจ้าของได้** จึงต้องเช็คขอบเขตจริง:
     · `dr_products.line_name` — CT คือฐานของ %P ทุกกะ · `is_active=false` = ไลน์เขาเปิดงานไม่ได้
       เขียนได้จาก 4 ทาง: /products · /daily-report ⚙️ · /die-registry (ตั้งคู่ RH/LH) · /planner-sales (ผูก p_no)
       ⇒ ปิดทางเดียวไม่พอ **ต้องปิดทุกทาง** (ฝั่ง DR ไม่มี RLS ⇒ จอคือด่านเดียว)
     · `skill_definitions.scope_section` — "ลบสกิล" ลบคะแนนพนักงานทุกคน + requirement ทุกจุดงาน (กู้ไม่ได้)
   🔴 ทั้ง 2 ตารางต้องเช็ค **2 ฝั่ง** ตอนแก้ (แถวเดิม + ค่าที่กำลังจะเขียน) — กฎ "ย้ายของ" 19/10 */
test('🛡️ row-scope-dr-products-skills — ทุกทางเขียน dr_products / skill_definitions ต้องมีด่านชั้น ③', () => {
  const FN2 = /\n  (?:const|async function)\s+[A-Za-z0-9_]+\s*=?\s*(?:async)?\s*(?:\([^)]*\)|[A-Za-z0-9_]+)\s*=>?\s*\{/g;
  const SCOPE = /pGuard\(|sdGuard\(|pWrite\(|sdWrite\(|canWriteLine\(|canWriteUnit\(/;
  const cases = [
    ['src/pages/ProductMaster.jsx', 'dr_products'],
    ['src/pages/DailyReport.jsx',   'dr_products'],
    ['src/pages/DieRegistry.jsx',   'dr_products'],
    ['src/pages/PlannerSales.jsx',  'dr_products'],
    ['src/pages/operator.jsx',      'skill_definitions'],
  ];
  const bad = [];
  for (const [file, table] of cases) {
    const code = stripComments(readFileSync(join(ROOT, file), 'utf8'));
    const starts = [...code.matchAll(FN2)].map(m => m.index);
    const writes = [...code.matchAll(new RegExp(`from\\('${table}'\\)[\\s\\S]{0,200}?\\.(insert|update|upsert|delete)\\(`, 'g'))];
    assert.ok(writes.length > 0, `${file}: ไม่เจอคำสั่งเขียน ${table} — ด่านนี้ต้องแก้ตามโครงไฟล์ใหม่`);
    for (const w of writes) {
      const fnStart = starts.filter(i => i < w.index).pop();
      const body = code.slice(fnStart ?? 0, w.index);
      /* ยกเว้นที่มีเหตุผล (กติกาข้อ 4 ของไฟล์นี้) — 2 จุดนี้ "ไม่ได้เขียนของที่ผูกไลน์":
         · makeBomHead — เปิดใบ BOM สร้างหัวพาร์ทโดยไม่ใส่ `line_name` เลย (ของกลาง ⇒ ด่านจะผ่านอยู่แล้ว)
         · เติม `image_url` จากทะเบียนกลาง parts_master ให้สินค้าที่ยังไม่มีรูป — รูปคือตัวตนพาร์ท
           (MAT เดียวกันใช้รูปเดียวกันทุกไลน์) ไม่ใช่ค่าที่ไลน์เป็นเจ้าของ */
      if (/const makeBomHead\b/.test(body.slice(0, 80))) continue;
      if (/update\(\{ image_url: imageUrl \}\)[\s\S]{0,30}\.in\('id', emptyIds\)/.test(code.slice(w.index, w.index + 200))) continue;
      if (!SCOPE.test(body))
        bad.push(`${file} — เขียน ${table} โดยฟังก์ชันนั้นไม่เช็คขอบเขต (ตำแหน่ง ~${w.index})`);
    }
  }
  /* 🔴 ด่าน "2 ฝั่ง": ตอนแก้ต้องเทียบทั้งแถวเดิมและไลน์/ส่วนงานปลายทาง */
  const pm = stripComments(readFileSync(join(ROOT, 'src/pages/ProductMaster.jsx'), 'utf8'));
  if (!/orig && !pGuard\(orig\.line_name/.test(pm) || !/pGuard\(form\.line_name/.test(pm))
    bad.push('src/pages/ProductMaster.jsx — handleSave ต้องเช็ค 2 ฝั่ง (orig.line_name + form.line_name)');
  const dr = stripComments(readFileSync(join(ROOT, 'src/pages/DailyReport.jsx'), 'utf8'));
  if (!/orig && !pGuard\(orig\.line_name/.test(dr) || !/pGuard\(form\.line_name/.test(dr))
    bad.push('src/pages/DailyReport.jsx — ProductSetup.handleSave ต้องเช็ค 2 ฝั่ง');
  const op = stripComments(readFileSync(join(ROOT, 'src/pages/operator.jsx'), 'utf8'));
  if (!/sdGuard\(sdOrig\?\.scope_section/.test(op) || !/sdGuard\(editingSkill\.scope_section/.test(op))
    bad.push('src/pages/operator.jsx — handleUpdateSkill ต้องเช็ค 2 ฝั่ง (แถวเดิม + ส่วนงานปลายทาง)');
  /* แผงลูกที่ยืมมือเขียนทะเบียนสินค้า ต้องได้ทะเบียนไลน์ผลิตจากหน้าแม่ (ไม่มี = ตัดสินเจ้าของไม่ได้ ⇒ ด่านปลอม) */
  const die = stripComments(readFileSync(join(ROOT, 'src/pages/DieRegistry.jsx'), 'utf8'));
  if (!/<SetPairNote[^>]*prodLines=\{lines\}/s.test(die))
    bad.push('src/pages/DieRegistry.jsx — ไม่ได้ส่ง prodLines={lines} ให้ SetPairNote');

  assert.deepEqual(bad, [], '\n\n❌ ' + bad.join('\n   ') + '\n'
    + '   ทำไม: ทั้ง 2 ตารางรู้เจ้าของ (line_name / scope_section) ⇒ "กดปุ่มเป็นไหม" ไม่พอ\n'
    + '         CT/โหมดลงยอด/ปิดใช้งานสินค้าของไลน์อื่น = %P ทั้งกะเขาเพี้ยน · ลบสกิล = คะแนนพนักงานหายทั้งส่วนงาน\n'
    + '         ฝั่ง DR ไม่มี RLS เลย ⇒ จอคือด่านเดียว · ปิดทางเดียวไม่พอ ต้องปิดทุกทางที่เขียนตารางนั้น\n'
    + '   แก้: canWriteLine/canWriteUnit (utils/writeScope.js) เรียกในฟังก์ชันที่เขียน DB + writeBlockText บนจอ\n');
});

/* ── 🧭 จุดอ้างอิงของ `audit/stdsweep.mjs` (§2.1 ลำดับแนวตั้ง) ห้ามหาย — 2026-10-20 ───────
   ตัวตรวจลำดับวัดจาก "ก้อนหัวเพจ" (`data-ph-root`) และยกเว้นของที่ติดป้ายไว้
   (`data-ro-note` / `data-page-note` / `data-subtab` / `data-subpanel`)
   🔴 ถอดป้ายออกจากคอมโพเนนต์กลาง = ตัวตรวจถอยไปวัดจาก `h1` ⇒ คำอธิบายใต้ชื่อหน้าถูกนับเป็น
      "ของแทรก" ทุกหน้า (รอบ 20/10 รายงานเกินจริง 19 มุมมอง เสียเวลาไล่ของที่ไม่ผิด)
   ⇒ ด่านนี้ล็อกแค่ 2 ป้ายที่อยู่ในคอมโพเนนต์กลาง (ป้ายรายหน้าเป็นดุลพินิจ ตรวจด้วย stdsweep เอง) */
test('stdsweep anchors — PageHeader/ReadOnlyNote ต้องคงป้ายจุดอ้างอิงไว้', () => {
  const bad = [];
  const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
  if (!/data-ph-root\s*=/.test(read('src/components/PageHeader.jsx')))
    bad.push('src/components/PageHeader.jsx (หาย data-ph-root)');
  if (!/data-ro-note\s*=/.test(read('src/components/ReadOnlyNote.jsx')))
    bad.push('src/components/ReadOnlyNote.jsx (หาย data-ro-note)');
  const sweep = read('audit/stdsweep.mjs');
  /* ดูที่ "ตัวเลือกที่เรียกใช้จริง" ไม่ใช่ทั้งไฟล์ — ไม่งั้นคอมเมนต์อธิบายป้ายทำให้ด่านผ่านเอง */
  const sel = (sweep.match(/closest\('([^']*data-ph-root[^']*)'\)/) || [])[1] || '';
  const noteSel = (sweep.match(/querySelectorAll\('(\[data-ro-note\][^']*)'\)/) || [])[1] || '';
  for (const k of ['data-ph-root', 'data-ro-note', 'data-page-note', 'data-subtab', 'data-subpanel'])
    if (!sel.includes(k)) bad.push(`audit/stdsweep.mjs (gapWhat ไม่ยกเว้น ${k})`);
  for (const k of ['data-ro-note', 'data-page-note', 'data-subtab', 'data-subpanel'])
    if (!noteSel.includes(k)) bad.push(`audit/stdsweep.mjs (จุดวัดระยะไม่นับ ${k})`);
  assert.deepEqual(bad, [], '\n\n❌ ' + bad.join(', ') + '\n'
    + '   ทำไม: ตัวตรวจลำดับ §2.1 ใช้ป้ายพวกนี้เป็นจุดอ้างอิง/ข้อยกเว้น — หายแล้วมันจะร้องหมาป่าทั้งระบบ\n'
    + '   แก้: คืนป้ายกลับ (docs/UI-STANDARD.md §2.1 เพิ่มเติม) ห้ามแก้ด้วยการผ่อนเกณฑ์ตัวตรวจ\n');
});

/* ── 🏠 "บ้านจริง" ≠ "ขอบเขตการมองเห็น" — ช่องเดียวห้ามทำ 2 หน้าที่ (20/10 · คำสั่ง user) ───────
   `/add-user` เคยบันทึก `profiles.section` (บ้านจริง = แกนตัดสิน "แก้ข้อมูลของใครได้")
   เป็น **`form.sections[0]`** คือช่องแรกของ "เห็นข้อมูลของใคร"
   ⇒ ติ๊กพื้นที่ที่ไปตรวจ แล้ว**สังกัดเปลี่ยนตามเงียบๆ** · วัดจริง 20/10: QC 13 บัญชี
     ทะเบียนพนักงานว่าสังกัด **QA** แต่ `profiles.section` กลายเป็น **PD3**
   ⇒ บ้านจริงของบัญชีของคนต้องมาจาก**ทะเบียนพนักงาน** (สูตรเดียวกับ `App.jsx`: `emp.section ?? ident.section`)

   และ `/operator` แถบ "⚠️ ข้อมูลไม่ตรงผังองค์กร" ห้ามนับ **ผู้จัดการ/หัวหน้าส่วน** ว่า "ยังไม่ระบุแผนก"
   (เขายืนเหนือชั้นแผนก — user: "ดุลยทรรศน์ เป็นผู้จัดการ เลือกแค่ส่วนพอ") · ตัดสินที่ `needsDepartment()` */
test('🛡️ home-unit-vs-view-scope — บ้านจริงมาจากทะเบียนพนักงาน · ผู้จัดการไม่ต้องมีแผนก', () => {
  const bad = [];
  const au = stripComments(readFileSync(join(ROOT, 'src/pages/AddUser.jsx'), 'utf8'));
  if (/section:\s*form\.sections\[0\]/.test(au))
    bad.push('src/pages/AddUser.jsx — ยังบันทึก profiles.section จาก form.sections[0] (ช่อง "เห็นข้อมูลของใคร")');
  const saves = (au.match(/section:\s*homeSectionForSave\(\)/g) || []).length;
  if (saves < 2) bad.push(`src/pages/AddUser.jsx — ต้องบันทึกบ้านจริงผ่าน homeSectionForSave() ทั้งตอนสร้างและตอนแก้ (เจอ ${saves}/2)`);
  if (!/linkedEmp\(\)\?\.section\s*\|\|\s*form\.homeSection/.test(au))
    bad.push('src/pages/AddUser.jsx — homeSectionForSave() ต้องให้ทะเบียนพนักงานชนะ (emp.section ก่อน form.homeSection)');

  const op = stripComments(readFileSync(join(ROOT, 'src/pages/operator.jsx'), 'utf8'));
  if (!/if \(!dep && needsDepartment\(emp\.position\)\)/.test(op))
    bad.push('src/pages/operator.jsx — ด่าน "ยังไม่ระบุแผนก" ต้องผ่าน needsDepartment(emp.position)');
  const pos = stripComments(readFileSync(join(ROOT, 'src/utils/positions.js'), 'utf8'));
  if (!/export function needsDepartment/.test(pos) || !/levelOfPosition\(v\) !== 'manager'/.test(pos))
    bad.push("src/utils/positions.js — needsDepartment() ต้องคืน false ให้ระดับ 'manager' (และ SECTION_LEVEL_POSITION_KEYS)");

  assert.deepEqual(bad, [], '\n\n❌ ' + bad.join('\n   ') + '\n'
    + '   ทำไม: "สังกัดหน่วยไหน" (profiles.section · ชั้นสิทธิ์ที่ 3) กับ "เห็นข้อมูลของใคร" (profiles.sections)\n'
    + '         เป็นคนละคำถาม — ช่องเดียวทำ 2 หน้าที่ = ข้อมูลขัดกับทะเบียนพนักงานโดยไม่มีใครรู้\n'
    + '   แก้: AddUser → homeSectionForSave() (ทะเบียนพนักงานชนะ) · operator → needsDepartment() (utils/positions.js)\n');
});

/* ── 🧾 กรอบแผน (Layer 1) ต้องยังขึ้นบอร์ด Heijunka — 2026-10-20 ───────────────────────
   ที่มา (คำสั่ง user): หน้างานไม่สแกนคัมบัง ⇒ บอร์ดว่าง ⇒ ถูกอ่านว่า "ไม่มีออเดอร์"
   🔴 ถอดการโหลด `production_plan_lots` ออกจาก `/management` เมื่อไหร่ = **จอกลับไปโกหกเงียบๆ**
      (ไม่มีอะไรพัง ไม่มีเทสตก — แค่ความต้องการจริงหายจากจอ) ⇒ ต้องมีด่าน
   🔴 CT ต้องครอบ mat ของ "กรอบ" ด้วย — ถ้าเอาเฉพาะ mat ของ `orders` พาร์ทที่ยังไม่เปิดใบ
      (= เคสที่ฟีเจอร์นี้มีไว้เพื่อโชว์) จะไม่มี CT = วางบนแกนเวลาไม่ได้สักใบ */
test('🧾 plan-frame-on-heijunka — บอร์ด /management ต้องอ่านกรอบแผน + CT ต้องครอบ mat ของกรอบ', () => {
  const bad = [];
  const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
  const mg = read('src/pages/Management.jsx');

  if (!/from\('production_plan_lots'\)/.test(mg))
    bad.push("src/pages/Management.jsx (ไม่ได้โหลด production_plan_lots — กรอบแผนหายจากบอร์ด)");
  if (!/matchPlanToActual\(/.test(mg))
    bad.push('src/pages/Management.jsx (ไม่ได้เทียบกรอบกับของจริงผ่าน matchPlanToActual)');
  for (const c of ['PlanFrameBar', 'PlanFrameRow'])
    if (!new RegExp(`<${c}\\b`).test(mg)) bad.push(`src/pages/Management.jsx (ไม่ได้วาด <${c}>)`);

  /* mat ที่ใช้หา CT ต้องมาจาก 2 ทาง: ใบผลิต + กรอบแผน */
  const matLine = (mg.match(/const matNos = \[[\s\S]{0,400}?\];/) || [''])[0];
  if (!/planLots/.test(matLine))
    bad.push('src/pages/Management.jsx (matNos ไม่รวม mat ของ planLots — พาร์ทที่ยังไม่เปิดใบจะไม่มี CT)');

  /* `ctOf` ของ layoutLots รับ **mat_no** (lotRunInfo เรียก ctOf(lot?.mat_no)) — ส่ง lot = ไม่มี CT เลย */
  const row = read('src/components/PlanFrameRow.jsx');
  if (/ctOf\s*=\s*\(\s*l(ot)?\s*\)\s*=>/.test(mg) || /ctOf\(\s*lot\s*\)/.test(row))
    bad.push('ctOf ต้องรับ mat_no ไม่ใช่ lot (lotRunInfo เรียก ctOf(lot?.mat_no))');
  if (!/layoutLots\(/.test(row))
    bad.push('src/components/PlanFrameRow.jsx (ไม่ได้ใช้ layoutLots — ห้ามคิดพิกัดเวลาเองในหน้า)');

  assert.deepEqual(bad, [], '\n\n❌ ' + bad.join(', ') + '\n'
    + '   ทำไม: บอร์ดที่เห็นเฉพาะใบที่สแกน ทำให้ "ไม่มีใครสแกน" กับ "ไม่มีงาน" หน้าตาเหมือนกันเป๊ะ\n'
    + '   แก้: คืนการโหลด production_plan_lots + <PlanFrameBar>/<PlanFrameRow>\n'
    + '        📄 docs/modules/production-plan.md §กรอบแผนขึ้นบอร์ด Heijunka\n');
});

/* ── 🔁 ปิดกะ: ใบที่ยังไม่ได้ผลิต ต้องยกเอง ห้ามมีปุ่มยกเลิก — 2026-10-20 ─────────────────
   คำสั่ง user: "มันควรจะต้องส่งต่อไปเรื่อยๆ · ห้ามลบ นอกจากแพลนนิ่งจะปิดโปรสิ้นเดือน"
                "ยกยอดแค่ใบที่ทำไม่จบครึ่งๆกลางๆ ที่เหลือออโต้ยกไปเลย"
   เหตุผลหน้างาน: ต้องกดตัดสินทุกใบก่อนปิดกะ ⇒ เปิดคัมบังไว้ 20 ใบแล้วทำไม่ทัน = กด 20 ครั้ง
   หรือกด "ยกเลิก" ทิ้ง ⇒ หัวหน้าเลยเลือก **ไม่เปิดใบตั้งแต่แรก** = บอร์ดดูเหมือนไม่มีออเดอร์
   🔴 ถอดการแยก 2 กองออกเมื่อไหร่ = กลับไปบังคับกดทุกใบ = พฤติกรรมเดิมกลับมาทันที */
test('🔁 close-auto-carry — ปิดกะต้องแยก "ยังไม่แตะ = ยกเอง" ออกจาก "ทำบางส่วน = คนตัดสิน"', () => {
  const bad = [];
  const read = (rel) => stripComments(readFileSync(join(ROOT, rel), 'utf8'));
  const dr = read('src/pages/DailyReport.jsx');

  if (!/splitCloseOrders\(/.test(dr))
    bad.push('src/pages/DailyReport.jsx (ไม่ได้ใช้ splitCloseOrders — กฎอยู่ utils/closeShiftOrders.js ห้ามคิดเองในหน้า)');
  if (!/autoCarryPatch\(/.test(dr))
    bad.push('src/pages/DailyReport.jsx (ไม่ได้เขียน carry_over ให้ใบที่ยังไม่แตะผ่าน autoCarryPatch)');
  /* 🔴 ยกให้เองได้ แต่ **ห้ามยกเงียบ** — จอปิดกะต้องเขียนว่ากำลังจะยกกี่ใบ/กี่ชิ้น */
  if (!/autoCarryText\(/.test(dr))
    bad.push('src/pages/DailyReport.jsx (ไม่ได้เขียนบนจอว่าจะยกให้กี่ใบ — ยกเงียบ = คนไม่รู้ว่าของไปไหน)');

  /* ปุ่มปิดกะต้องรอเฉพาะกองที่คนตัดสิน — รอทุกใบ = บังคับกดทีละใบเหมือนเดิม */
  /* 10/11: ปุ่มถูกห่อเป็น `() => handleCloseSession()` (รับ opts `dtConfirmed` จากป๊อปอัพทวน DT)
     ⇒ รับทั้ง 2 รูป · ที่ด่านนี้สนใจคือ `disabled=` ต้องรอเฉพาะ needDecision */
  const btn = (dr.match(/onClick=\{(?:\(\) => )?handleCloseSession\(?\)?\}[^\n]*/) || [''])[0];
  if (!/needDecision/.test(btn))
    bad.push('src/pages/DailyReport.jsx (ปุ่มปิดกะยังรอ "ทุกใบที่ open" ไม่ใช่เฉพาะ needDecision)');

  /* กองที่ยกอัตโนมัติต้องเช็ค error — ล้มเงียบ = กะปิดแต่ใบยัง open ค้างในกะที่ปิดแล้ว */
  const loop = (dr.match(/for \(const order of autoCarryOrders\)[\s\S]{0,900}?\n    \}/) || [''])[0];
  if (loop && !/if \(acErr\)/.test(loop))
    bad.push('src/pages/DailyReport.jsx (ยกอัตโนมัติแล้วไม่เช็ค error — ใบค้าง open ในกะที่ปิดแล้ว)');
  if (!loop) bad.push('src/pages/DailyReport.jsx (ไม่เจอลูปยกอัตโนมัติ)');

  /* กฎกลางต้องไม่เผลอเซ็ต carry_over_from_session_id (ใบชี้กลับหาตัวเอง = ป้าย "ยกยอดมา" ผิด) */
  if (/carry_over_from_session_id/.test(read('src/utils/closeShiftOrders.js')))
    bad.push('src/utils/closeShiftOrders.js (ห้ามเซ็ต carry_over_from_session_id ในฝั่ง "ยกออก")');

  assert.deepEqual(bad, [], '\n\n❌ ' + bad.join(', ') + '\n'
    + '   ทำไม: บังคับตัดสินทุกใบ = หน้างานเลี่ยงด้วยการไม่เปิดใบ ⇒ ความต้องการจริงหายจากระบบ\n'
    + '   แก้: ใช้ splitCloseOrders/autoCarryPatch (src/utils/closeShiftOrders.js)\n'
    + '        📄 docs/modules/daily-report.md §ปิดกะ — ยกยอดอัตโนมัติ\n');
});

/* ── 📥 ของค้างต้องไม่หายตามอายุ — 2026-10-20 ("มันหาย" จากแชทหน้างาน) ──────────────────
   🕳️ บั๊กเดิม: หายอดค้างด้วย "ใบของ **8 กะล่าสุด**" ของไลน์ ⇒ ไลน์เดิน 2 กะ/วัน = หน้าต่าง ~4 วัน
      ของที่ค้างเกินนั้นหลุดหน้าต่าง **หายถาวร** (วัดจริง: 8 / 28 / 33 / 97 วัน)
      หน้างานจึงเลือก "ทยอยปริ้น" เพราะเปิดไปก็หาย ⇒ บอร์ดดูเหมือนไม่มีออเดอร์
   🔴 ห้ามกลับไปจำกัดด้วย "จำนวนกะ" — ต้องถามด้วย **สถานะ** (open/carry_over) ซึ่งถูกกว่าด้วย */
test('📥 carry-debt-no-session-window — ของค้างต้องถามด้วยสถานะ ห้ามจำกัด "กี่กะล่าสุด"', () => {
  const bad = [];
  const read = (rel) => stripComments(readFileSync(join(ROOT, rel), 'utf8'));
  const dr = read('src/pages/DailyReport.jsx');

  /* ตรรกะอยู่ `lib/carryDebtOps.js` ที่เดียว (หน้าเรียกใช้ ห้ามก๊อปคิวรีมาไว้ในหน้า) */
  const ops = read('src/lib/carryDebtOps.js');
  if (/from\('production_sessions'\)[\s\S]{0,400}?\.limit\(/.test(ops))
    bad.push('src/lib/carryDebtOps.js (กลับไปจำกัดยอดค้างด้วยจำนวนกะ — ของเก่าจะหายอีก)');
  /* ดูเฉพาะตัวโหลด — `closeSource` ก็ใช้ PENDING_STATUSES ทั้งไฟล์จึงไม่พอเป็นหลักฐาน */
  /* 🔴 หน้าต่างต้องยาวพอถึงคิวรีจริง — จบที่ `offers: carryOffers(` ไม่ใช่ `return` ตัวแรก
     (ตัวแรกคือ early-return ตอนไม่มี lineName ซึ่งอยู่ก่อนคิวรี ⇒ ด่านจะมองไม่เห็นอะไรเลย) */
  const loadFn = (ops.match(/export async function loadCarryOffers[\s\S]{0,2500}?offers: carryOffers\(/) || [''])[0];
  if (!/\.in\('status', PENDING_STATUSES\)/.test(loadFn))
    bad.push('src/lib/carryDebtOps.js (loadCarryOffers ไม่ได้ถามด้วยสถานะ PENDING_STATUSES)');
  if (!/carryOffers\(/.test(ops))
    bad.push('src/lib/carryDebtOps.js (ไม่ได้ใช้ carryOffers — กฎ dedupe อยู่ utils/carryDebt.js)');
  if (!/fetchByIds\(/.test(ops))
    bad.push('src/lib/carryDebtOps.js (ประวัติ prod_no ไม่ได้ผ่าน fetchByIds — .in() ยาวคืนค่าว่างเงียบ)');
  if (!/hist\.failed \|\| hist\.truncated/.test(ops))
    bad.push('src/lib/carryDebtOps.js (โหลดไม่ครบแล้วไม่บอก — ลิสต์ขาดถูกอ่านว่า "ของค้างทั้งหมด")');
  if (!/loadCarryOffers\(/.test(dr))
    bad.push('src/pages/DailyReport.jsx (ไม่ได้เรียก loadCarryOffers)');

  /* 🔁 เปิดกะต้องรับของค้างอัตโนมัติ (คำสั่ง user: "กะถัดไปพอเปิดกะก็ต้องรับงานยกยอดออโต้เลย")
     🔴 ตัวนี้ปลอดภัยเพราะ auto-carry ตอนปิดกะมีอยู่ — ถอดตัวนั้นต้องถอดตัวนี้ด้วย */
  const openFn = (dr.match(/const handleOpenSession[\s\S]{0,4000}?toast\.success\('เปิดกะสำเร็จ'\)[\s\S]{0,1800}/) || [''])[0];
  if (!/loadCarryOffers\(/.test(openFn) || !/importCarryOrders\(/.test(openFn))
    bad.push('src/pages/DailyReport.jsx (เปิดกะแล้วไม่ได้รับของค้างอัตโนมัติ)');
  /* 🔴 "รับยอดต่อ" ต้องเลือกใบได้ (feedback: "ไม่อยากมาส่งต่อกะทุกใบที่เหลือ")
     เอาทั้งหมดอย่างเดียว = คนที่ไม่อยากลากพาร์ทอื่นเข้ากะ **ไม่กดเลย** แล้วของค้างไม่ขยับ */
  const imp = (dr.match(/const handleImportCarryOrders[\s\S]{0,700}?importCarryOrders\(\{/) || [''])[0];
  if (!/carryPick\.has/.test(imp))
    bad.push('src/pages/DailyReport.jsx (รับยอดต่อยังเป็น "เอาทั้งหมด" — ต้องเลือกใบได้ผ่าน carryPick)');

  /* กฎ ② ที่เคยทำยอดค้างหายทั้งกะ — ต้องยังอยู่ในไฟล์กฎ */
  const cd = read('src/utils/carryDebt.js');
  if (!/status === 'imported' \? 1 : 0/.test(cd))
    bad.push("src/utils/carryDebt.js (หายกฎ 'imported ห้ามเป็นใบล่าสุด' — เคส Assy LWR 09/09)");

  assert.deepEqual(bad, [], '\n\n❌ ' + bad.join(', ') + '\n'
    + '   ทำไม: ของค้างที่มองไม่เห็น = หน้างานเลิกเชื่อระบบ แล้วกลับไปทยอยเปิดใบเหมือนเดิม\n'
    + '   แก้: ถามด้วยสถานะ + carryOffers() (src/utils/carryDebt.js)\n'
    + '        📄 docs/modules/daily-report.md §ของค้าง\n');
});

test('🛡️ order-close-single-entry — "เวลาปิดของใบผลิต" ต้องมีสูตรเดียว', () => {
  const bad = [];
  const oee = stripComments(readFileSync(join(ROOT, 'src/utils/oee.js'), 'utf8'));

  /* ① เจ้าของสูตรต้องยังอยู่ — ตรงกับ backfill ฝั่ง DB (migration 20260915):
        confirmed ⇒ confirmed_at · ยกยอด/ส่งกะถัดไป/ยกเลิก ⇒ stopped_at · open ⇒ null */
  if (!/export function orderCloseMs\s*\(/.test(oee))
    bad.push('src/utils/oee.js — ต้องมี orderCloseMs() (เจ้าของสูตร "เวลาปิดของใบผลิต")');
  if (!/export function matRawWindow\s*\(/.test(oee))
    bad.push('src/utils/oee.js — ต้องมี matRawWindow() (กรอบ "ช่วงที่ MAT นี้วิ่ง")');
  if (!/st === 'carry_over' \|\| st === 'imported' \|\| st === 'cancelled'/.test(oee))
    bad.push("src/utils/oee.js — orderCloseMs ต้องนับ imported ด้วย (ใบที่กะถัดไปรับไปแล้วก็หยุดผลิตในกะนี้จริง)");

  /* ② 🔴 ห้ามหน้าไหนปั้นสูตรเอง — คลาสบั๊กจริง (Apron Assy 20/10): modal แก้เวลาตัด `imported` ทิ้ง
        แต่แท็บประวัติอ่าน `o.confirmed_at || o.stopped_at` ⇒ MAT เดียว กะเดียว เห็นเวลาจบ 19:28 vs 20:00
        แก้แล้ว "ตีกลับเป็นเวลาหยุดผลิต" ทุกครั้ง + ฐานเวลา %P ของ 2 จอไม่ตรงกัน */
  for (const full of walk(join(ROOT, 'src'), ['.js', '.jsx'])) {
    const r = full.slice(ROOT.length).replace(/\\/g, '/');   // ROOT ลงท้ายด้วย '/' อยู่แล้ว
    if (r === 'src/utils/oee.js') continue;
    const code = stripComments(readFileSync(full, 'utf8'));
    if (/\.confirmed_at\s*\|\|\s*\w+\.stopped_at/.test(code))
      bad.push(`${r} — ห้ามเขียน \`o.confirmed_at || o.stopped_at\` เอง (ใช้ orderCloseMs/matRawWindow จาก utils/oee)`);
    if (/status === 'carry_over' \|\| \w+\.status === 'cancelled'\)\s*&&\s*\w+\.stopped_at/.test(code))
      bad.push(`${r} — ห้ามคัดใบที่ปิดแล้วเอง (ลืม 'imported' = เวลาจบของ MAT ไม่ตรงกับแท็บประวัติ) ใช้ orderCloseMs`);
  }

  /* ③ ตัวบันทึกต้องเขียนผ่าน planMatTimeWrites — เขียน `confirmed_at` ของใบสุดท้ายใบเดียวไม่พอ
        (ใบยกยอดถือเวลาไว้ใน `stopped_at` ⇒ จอไม่ขยับ = "แก้ไม่ได้") */
  const dr = stripComments(readFileSync(join(ROOT, 'src/pages/DailyReport.jsx'), 'utf8'));
  if (!/planMatTimeWrites\s*\(/.test(dr))
    bad.push('src/pages/DailyReport.jsx — handleSaveTimes ต้องวางแผนการเขียนด้วย planMatTimeWrites (utils/matTimeEdit.js)');
  /* ④ ข้ามแล้วต้องบอกบนจอ — เดิม `continue` เงียบๆ แต่ toast ยังขึ้น "บันทึกสำเร็จ" */
  if (!/skippedOpen\.length\)\s*toast\.error/.test(dr))
    bad.push('src/pages/DailyReport.jsx — MAT ที่ข้ามเพราะมีใบเปิดค้าง ต้องเตือนบนจอ ห้ามข้ามเงียบ');

  assert.deepEqual(bad, [], '\n\n❌ ' + bad.join(', ') + '\n'
    + '   ทำไม: จอแก้เวลากับจอที่อ่านผลใช้คนละสูตร = หน้างานกดบันทึกแล้วเหมือนไม่เกิดอะไร\n'
    + '   แก้: orderCloseMs()/matRawWindow() (src/utils/oee.js §6.2) + planMatTimeWrites() (src/utils/matTimeEdit.js)\n'
    + '        📄 docs/modules/daily-report.md §เวลาเริ่ม-จบของ MAT\n');
});

/* ═══ 🧪 "เกี่ยวคุณภาพ / ต้องให้ QA ตรวจ?" ต้องตอบผ่าน qaRelatedView() ═══  2026-10-21
   `mtn_orders.quality_related` เก็บเป็น **ข้อความไทย** ('เกี่ยวกับคุณภาพ' / 'ไม่เกี่ยวกับคุณภาพ')
   ⇒ อ่านแบบ truthiness (`o.quality_related ? 'ใช่' : ''`) ตอบ **"ใช่"** ให้ใบที่ QA ตัดสินว่า *ไม่* เกี่ยว
   วัดจริง 21/10: 411 ใบจาก 1050 (39%) ถูกรายงานกลับด้านใน Excel + สรุปรายเดือน
   และใบที่ QA **ไม่อยู่ในลูปเลย** (ฟอร์ม MTN · งานสร้าง/ปรับปรุง) ยังมีค่าเศษค้างจากขั้น 4
   ⇒ เคสจริง O-MTN.2026/10-17: ใบทีม MTN ที่รอ "รับมอบ" ขึ้นว่า "ต้องผ่าน QA" = จอโกหก
   ⇒ คำตอบนี้มีเจ้าของไฟล์เดียว = `qaRelatedView()` ใน mtnStepPerm.js */
test('🧪 ห้ามอ่าน quality_related ดิบนอก mtnStepPerm.js — ต้องผ่าน qaRelatedView()', () => {
  const OWNER = 'src/utils/mtnStepPerm.js';   // เจ้าของกฎ (นิยาม qaRelatedView เอง)
  const bad = [];
  for (const f of walk(join(ROOT, 'src'), ['.js', '.jsx'])) {
    const rel = relative(ROOT, f);
    if (rel === OWNER) continue;
    const src = stripComments(readFileSync(f, 'utf8'));
    /* เอาเฉพาะ "การอ่านค่า" — การเขียน (`quality_related: QA_RELATED`) และชื่อคอลัมน์ใน
       `.select('…')` ไม่เข้าข่าย เพราะตามด้วย `:` หรืออยู่ในสตริงล้วน */
    for (const m of src.match(/\.quality_related\s*[?)&|=!,]/g) || []) bad.push(`${rel} (${m.trim()})`);
  }
  assert.deepEqual(bad, [], '\n\n❌ อ่าน quality_related ดิบ: ' + bad.join(', ') + '\n'
    + '   ทำไม: คอลัมน์นี้เป็นข้อความ ไม่ใช่ boolean — "ไม่เกี่ยวกับคุณภาพ" ก็ truthy\n'
    + '         และใบที่ QA ไม่อยู่ในลูป (ฟอร์ม MTN · งานสร้าง/ปรับปรุง) ยังมีค่าเศษค้างอยู่\n'
    + '   แก้: ใช้ qaRelatedView(order) → yes | no | n_a | unknown แล้ว map เป็นข้อความที่หน้า\n');
});

/* ขั้น 4 ของใบที่ไม่มี QA ในลูป ห้าม stamp quality_related (ต้นทางของค่าเศษข้างบน) */
test('🧪 ขั้น 4 stamp quality_related ได้เฉพาะใบที่ qaAppliesTo', () => {
  const src = stripComments(readFileSync(join(ROOT, 'src/pages/MtnRepair.jsx'), 'utf8'));
  const m = src.match(/stage === 'accept_work'[\s\S]{0,1200}?checker_sign: s,([^}]*)\}/);
  assert.ok(m, 'หาบล็อกบันทึกขั้น 4 (accept_work) ไม่เจอ — แก้ชื่อ stage แล้วต้องอัพเดทด่านนี้ด้วย');
  assert.match(m[1], /qaAppliesTo\(o\)\s*\?/,
    '\n\n❌ ขั้น 4 ยัง stamp quality_related ให้ทุกใบ\n'
    + '   ทำไม: ใบทีม MTN (FM-MTN-006) และงานสร้าง/ปรับปรุงไม่มีขั้น QA ในลูป —\n'
    + '         stamp ไว้ = แผงรายละเอียด/Excel อ่านแล้วบอกว่า "ต้องผ่าน QA" ทั้งที่ไม่มีใครมาตรวจ\n'
    + '   แก้: ...(qaAppliesTo(o) ? { quality_related: QA_RELATED } : {})\n');
});

/* ═══ 🔩 อะไหล่ในใบ MO: โหลดของเดิมก่อนแก้ · เขียนทับทั้งชุด · ขยับสต็อกด้วยส่วนต่าง ═══  2026-10-22
   MTN แจ้ง: "Spare Part พอกดบันทึกแล้วข้อมูลถูก Hide ไป แสดงใน Export อยู่ แต่หน้าปิด MO ไม่ขึ้น"
   ราก: `usedParts` เริ่ม [] แล้วไม่เคยอ่านจาก mtn_order_parts ⇒ เปิดแก้ไขขั้น 3 เห็นลิสต์ว่าง
   (ข้อมูลยังอยู่ในฐาน ใบพิมพ์จึงยังมี) → พิมพ์ใหม่ → บันทึกเป็น insert ล้วน = แถวซ้ำ + ตัดสต็อกซ้ำ
   วัด 22/10: ซ้ำไปแล้ว 4 แถว ใน 2 ใบ (จาก 475 แถว / 203 ใบ)
   ⇒ ต้องครบ 3 ชั้นเหมือนค่าแรง: โหลดของเดิม · delete-then-insert · สต็อกคิดจากส่วนต่าง */
test('🔩 ขั้น 3: ต้องโหลดอะไหล่เดิมเข้าฟอร์ม + บันทึกแบบลบก่อนเขียน + สต็อกใช้ส่วนต่าง', () => {
  const src = stripComments(readFileSync(join(ROOT, 'src/pages/MtnRepair.jsx'), 'utf8'));
  const miss = [];
  // ① โหลดของเดิม — ไม่งั้นลิสต์ว่างทุกครั้งที่เปิดแก้ไข
  if (!/from\('mtn_order_parts'\)\s*\.select\(/.test(src)) miss.push('ไม่ได้อ่าน mtn_order_parts เข้าฟอร์ม (usedParts จะว่างทุกครั้ง)');
  // ② ลบของเดิมก่อนเขียนใหม่ — insert ล้วน = แถวซ้ำ
  if (!/from\('mtn_order_parts'\)\s*\.delete\(\)/.test(src)) miss.push("บันทึกอะไหล่ไม่ได้ลบของเดิมก่อน (insert ล้วน = แถวซ้ำ)");
  // ③ สต็อกต้องคิดจากส่วนต่าง ไม่ใช่ยอดเต็มทุกครั้ง
  if (!/basePartQty/.test(src)) miss.push('ไม่มีฐานยอดเดิม (basePartQty) ⇒ ตัดสต็อกเต็มทุกครั้งที่กดบันทึก');
  if (/p_type:\s*'issue',\s*p_qty:\s*totalQty/.test(src)) miss.push("ยังตัดสต็อกด้วยยอดเต็ม (p_qty: totalQty) แทนส่วนต่าง");
  // ④ โหลดไม่เสร็จ/ไม่ติด = ห้ามบันทึก (ไม่งั้นลบของจริงทิ้งแล้วเขียนชุดว่าง)
  if (!/partsState\s*!==\s*'ok'/.test(src)) miss.push("ไม่มีด่านกันบันทึกตอนอะไหล่เดิมยังโหลดไม่เสร็จ (partsState)");
  assert.deepEqual(miss, [], '\n\n❌ ' + miss.join('\n   ❌ ') + '\n'
    + '   ทำไม: ขั้นบันทึกลบอะไหล่เดิมทั้งชุดแล้วเขียนใหม่ — ฟอร์มที่ไม่โหลดของเดิมมาก่อน\n'
    + '         = ลบรายการจริงทิ้ง · และตัดสต็อกด้วยยอดเต็มซ้ำทุกครั้งที่กดแก้\n'
    + '   แก้: ทำตามแพทเทิร์น laborRows/laborState ในไฟล์เดียวกัน (โหลด → บล็อกบันทึก → delete-then-insert)\n'
    + '   📄 docs/modules/mtn-work-order.md §อะไหล่ในใบ MO\n');
});

/* ── 🔒 `inherit_scope` ต้องถูก select มาด้วยทุกจุดที่สร้างดัชนีขอบเขต (2026-10-22) ──────────
   ธง "อยู่ใต้ในผัง แต่สิทธิ์ไม่ตกทอด" ตัดสินใน `ancestorsOf()` (`utils/orgScope.js`)
   ⇒ จอไหน select org_nodes มาสร้าง `buildOrgScope()` โดย **ลืมคอลัมน์นี้** = ธงหายเงียบ
     แล้วหน่วยแม่จะกลับมา "ครอบ" หน่วยที่เอามาฝากอีกครั้ง โดยไม่มี error ให้เห็น
   (คลาสเดียวกับ `pair_mat_no` ที่ลืม select แล้ว pairMap ว่าง → นับ 2 เท่าเงียบๆ) */
test('🛡️ org-scope-needs-inherit-scope — จุดที่สร้าง buildOrgScope ต้อง select inherit_scope', () => {
  const bad = [];
  for (const rel of ['src/App.jsx', 'src/utils/useOrgScope.js', 'src/pages/AddUser.jsx']) {
    const code = stripComments(readFileSync(join(ROOT, rel), 'utf8'));
    if (!/from\('org_nodes'\)/.test(code)) { bad.push(`${rel} — ไม่เจอคิวรี org_nodes (ด่านต้องแก้ตามโครงใหม่)`); continue; }
    if (!/inherit_scope/.test(code)) bad.push(`${rel} — select org_nodes ไม่มี inherit_scope`);
  }
  const org = stripComments(readFileSync(join(ROOT, 'src/utils/orgScope.js'), 'utf8'));
  if (!/noInherit\.has\(startKey\)/.test(org) || !/if \(noInherit\.has\(k\)\) break;/.test(org))
    bad.push('src/utils/orgScope.js — ancestorsOf ต้องหยุดที่หน่วยที่ปิดการตกทอด (noInherit)');
  assert.deepEqual(bad, [], '\n\n❌ ' + bad.join('\n   ') + '\n'
    + '   ทำไม: หน่วยที่ "เอามาฝาก" ไว้ใต้หน่วยอื่น (เช่น JIG MTN ใต้ PD4) ต้องไม่ถูกหน่วยแม่ครอบ\n'
    + '         ลืม select คอลัมน์นี้ = ธงหาย = หัวหน้าหน่วยแม่แก้ข้อมูลได้อีกครั้งแบบเงียบ\n'
    + '   แก้: เติม inherit_scope ใน select ของ org_nodes ที่ป้อน buildOrgScope()\n');
});

/* ── 📅 สรุปทั้งปีห้ามรีเฟรชระดับนาที (2026-10-22 · วัดจาก log จริง) ──────────────────
   `obeya_year_rollup` = Σ รายเดือนทั้งปี · ครั้งละ ~1.15 วินาทีของเวลาฐานข้อมูล
   เดิมผูก realtime `production_sessions` ที่ `LIVE.BOARD` (60 วิ) ⇒ ไลน์ไหนก็ได้ในโรงงาน
   แตะ 1 แถว = บอร์ดคิดสรุปทั้งปีใหม่ · วัดจริง: **จอเดียว 216 ครั้งใน 6.5 ชม. · timeout 12 ครั้ง**
   บนเครื่องที่ทั้งโรงงานใช้ร่วมกัน = เบียดคิวรีของหน้างานจริง (เหตุการณ์ 08:25 ของวันนั้น) */
test('🛡️ year-rollup-not-minutely — บอร์ดที่สรุปทั้งปีต้องใช้ LIVE.YEAR ไม่ใช่ LIVE.BOARD', () => {
  const bad = [];
  const rates = stripComments(readFileSync(join(ROOT, 'src/utils/refreshRates.js'), 'utf8'));
  if (!/\bYEAR:\s*\d+/.test(rates))
    bad.push('src/utils/refreshRates.js — ต้องมีระดับ LIVE.YEAR (สรุปทั้งปี)');

  for (const rel of ['src/components/ObeyaSqdcmBoard.jsx', 'src/components/ObeyaKpiBoard.jsx']) {
    const code = stripComments(readFileSync(join(ROOT, rel), 'utf8'));
    if (!/obeya_year_rollup/.test(code)) continue;          // ไฟล์เปลี่ยนโครงแล้ว ปล่อยผ่าน
    // ตัว useLiveBoard ที่คุม "โหลดสรุปทั้งปี" ต้องไม่ตั้ง tier เป็น LIVE.BOARD
    for (const m of code.matchAll(/useLiveBoard\([^;]*?\)/gs)) {
      const call = m[0];
      if (/topic:\s*'obeya-(year|kpi)'/.test(call) && /tier:\s*LIVE\.BOARD/.test(call))
        bad.push(`${rel} — useLiveBoard ของสรุปทั้งปีต้องใช้ tier: LIVE.YEAR (เจอ LIVE.BOARD)`);
    }
  }
  assert.deepEqual(bad, [], '\n\n❌ ' + bad.join(', ') + '\n'
    + '   ทำไม: สรุปทั้งปีครั้งละ ~1.2 วินาที · ที่ 60 วิ = จอเดียวกินเวลาฐานข้อมูล ~250 วิ ต่อ 6.5 ชม.\n'
    + '   แก้: tier: LIVE.YEAR (src/utils/refreshRates.js) — poll ยังเดินตามปกติ ช้าสุด 15-20 นาที\n');
});

/* ── 🏭 ประเภท Downtime/ของเสีย ห้ามถูกซ่อนจนเลือกไม่ได้ (2026-10-24 · แจ้งจากหน้างาน) ──
   `sessionProcessTypesAll()` เดา process ของกะจาก (ก) เครื่องในสายไลน์ (ข) สินค้าในใบผลิต**ที่เปิดอยู่**
   🔴 เครื่องเสียตอนต้นกะ ก่อนเปิดใบผลิตใบแรก ⇒ ข้อ (ข) ว่าง เหลือแต่ป้ายของเครื่อง
      ซึ่งไลน์ปั๊มทุกไลน์ติดป้ายไว้ผิดเป็น welding_assembly (วัดจริง: LINE A/B/C/D รวม 285 เครื่อง)
   ⇒ หน้างานเห็นแค่ 2 กลุ่ม เลือกประเภทของงานปั๊มไม่ได้เลย = ถูกบังคับให้ลงผิด = พาเรโตเพี้ยนถาวร
   กติกา: กรองเพื่อ **จัดลำดับ** ได้ แต่ **ห้ามตัดออกจากลิสต์** */
test('🛡️ dt-defect-types-never-hidden — ประเภทที่ไม่ตรง process ต้องยังเลือกได้ (อยู่ท้ายลิสต์)', () => {
  const bad = [];
  const code = stripComments(readFileSync(join(ROOT, 'src/pages/DailyReport.jsx'), 'utf8'));
  /* รูปแบบเดิมที่ห้ามกลับมา: เอาผลกรองไปเป็น "ลิสต์ทั้งหมด" ตรงๆ
     (dtTypes/defectTypes.filter(...) แล้วใช้ตัวนั้นเป็น options/map เดียวโดยไม่มีตะกร้ารับที่เหลือ) */
  for (const which of ['dtTypes', 'defectTypes']) {
    const re = new RegExp(`const\\s+filtered\\s*=\\s*${which}\\.filter\\([^;]*process_type[^;]*\\);`);
    if (re.test(code) && !new RegExp(`${which}\\.filter\\(\\s*t\\s*=>\\s*!ofLine\\(t\\)\\s*\\)|const\\s+others\\s*=\\s*${which}\\.filter`).test(code))
      bad.push(`src/pages/DailyReport.jsx — ${which}: กรองด้วย process_type แล้วไม่มีตะกร้ารับตัวที่เหลือ (ประเภทจะหายจากลิสต์)`);
  }
  // ต้องมีกลุ่มท้ายลิสต์ให้คนเห็นว่ายังเลือกได้
  if (!/กระบวนการอื่น/.test(code))
    bad.push('src/pages/DailyReport.jsx — ต้องมีกลุ่ม "กระบวนการอื่น" ท้ายลิสต์ (ห้ามซ่อนประเภทที่ไม่ตรง process)');

  assert.deepEqual(bad, [], '\n\n❌ ' + bad.join(', ') + '\n'
    + '   ทำไม: ป้าย process_type ของเครื่องในฐานยังผิดอยู่หลายร้อยตัว + ตอนต้นกะยังไม่มีใบผลิต\n'
    + '        ⇒ กรองแบบตัดทิ้ง = หน้างานลงประเภทที่ถูกต้องไม่ได้เลย\n'
    + '   แก้: กรองเพื่อจัดลำดับ (ของไลน์นี้ขึ้นก่อน) แล้วต่อท้ายด้วยกลุ่ม "กระบวนการอื่น"\n');
});

/* ═══ 🔄 เซ็นงานจากคิวเสร็จแล้ว แถวต้องไม่คาอยู่ในแผง ═══  2026-10-22 · user แจ้ง "ปิดแล้วยังโชว์อยู่"
   `useMyQueue` โหลด "ครั้งเดียวต่อ session" แล้วรีเฟรชเฉพาะตอนเปิดแผง + ของเก่าเกิน STALE_MIN (5 นาที)
   ⇒ ผจก.กดเซ็นอนุมัติปิดใบจากคิว ใบปิดจริงแล้ว แต่แถวยังอยู่ · badge ค้างเลขเดิม · เสี่ยงกดซ้ำ
   ⇒ ทุกจุดที่ "ปิดงานที่เคยอยู่ในคิว" ต้องเรียก invalidateMyQueue() */
test('🔄 บันทึกขั้นใบ MO เสร็จ ต้องเคลียร์คิวงานของฉัน (invalidateMyQueue)', () => {
  const panel = stripComments(readFileSync(join(ROOT, 'src/components/MyQueuePanel.jsx'), 'utf8'));
  assert.match(panel, /export function invalidateMyQueue\s*\(/,
    'MyQueuePanel ต้อง export invalidateMyQueue ให้หน้าอื่นเรียกได้');
  assert.match(panel, /shared\.loader/,
    'invalidateMyQueue ต้องยิงโหลดจริงเมื่อมีแผง/กระดิ่งที่ยัง mount อยู่ (ล้าง at อย่างเดียว = แผงที่เปิดค้างไม่รู้ตัว)');
  const mo = stripComments(readFileSync(join(ROOT, 'src/pages/MtnRepair.jsx'), 'utf8'));
  assert.match(mo, /invalidateMyQueue\s*\(\s*\)/,
    '\n\n❌ /mtn-repair บันทึกขั้นเสร็จแล้วไม่ได้เคลียร์คิวงานของฉัน\n'
    + '   ทำไม: แผงคิวโหลดครั้งเดียวต่อ session — ไม่เคลียร์ = แถวที่เซ็นไปแล้วคาอยู่ถึง 5 นาที\n'
    + '   แก้: เรียก invalidateMyQueue() ใน onSaved ของ StepModal\n');
});

/* ═══ 🧭 คำสั่งระดับหน้า = ปุ่มตายตัว ≤2 + ⋯ (UI-CONVENTIONS §6.35) ═══  2026-11-04 · คำสั่ง user
   *"ปัญหาของโปรแกรมเราตอนนี้คือ ux/ui ใช้งานยาก ปุ่มเยอะ และ pattern ไม่ค่อยเหมือนกันในแต่ละหน้า"*
   ⇒ `actions=` ของ <PageHeader> มี <button ได้ไม่เกิน 2 · ที่เหลือเข้า <OverflowMenu> (components/OverflowMenu.jsx)
   นับแบบ static (ปุ่มที่มีเงื่อนไขก็นับ — ถ้าเงื่อนไขทำให้เกิน 2 พร้อมกันได้ ก็ต้องเข้าเมนู)
   🕰️ หน้าที่มีปุ่ม >2 อยู่ก่อนกฎ = ทยอยแก้ **ห้ามเพิ่มหน้าใหม่เข้าลิสต์นี้** */
test('🧭 PageHeader actions= มีปุ่มตายตัวไม่เกิน 2 — ที่เหลือเข้า <OverflowMenu>', () => {
  const LEGACY_MANY_ACTIONS = [];   // 05/11: ไล่ครบทุกหน้าแล้ว — ห้ามเติมชื่อใหม่ (หน้าใหม่ต้องผ่านตั้งแต่แรก)
  const bad = [];
  for (const f of walk(join(ROOT, 'src/pages'), ['.jsx'])) {
    const rel = relative(ROOT, f);
    if (LEGACY_MANY_ACTIONS.includes(rel)) continue;
    const code = stripComments(readFileSync(f, 'utf8'));
    let at = 0;
    while ((at = code.indexOf('<PageHeader', at)) !== -1) {
      const i = code.indexOf('actions={', at);
      at += 11;
      if (i < 0 || i > at + 4000) continue;
      let j = i + 'actions={'.length; let depth = 1;
      while (j < code.length && depth) { if (code[j] === '{') depth++; else if (code[j] === '}') depth--; j++; }
      const blk = code.slice(i, j);
      const n = (blk.match(/<button\b/g) || []).length;
      if (n > 2 && !/<OverflowMenu\b/.test(blk)) bad.push(`${rel} (${n} ปุ่ม)`);
    }
  }
  assert.deepEqual(bad, [], '\n\n❌ ปุ่มใน actions= ของ PageHeader เกิน 2: ' + bad.join(', ') + '\n'
    + '   แก้: เหลือปุ่มหลัก ≤2 แล้วย้ายที่เหลือเข้า <OverflowMenu items={[…]}/> (UI-CONVENTIONS §6.35)\n');
});

/* ═══ 🧹 ปุ่มล้างตัวกรอง = ของกลาง ห้ามวาดเองในหน้า ═══  2026-10-22 · คำสั่ง user
   *"ขอปุ่มล้างตัวกรองด้วยได้มั้ย และควรจะมีทุกหน้านะที่มีระบบกรอง"*
   ⇒ ฝังใน <FilterBar> + <TimeRangeBar> ⇒ 51 หน้าที่ใช้ FilterBar และ 18 หน้าที่ใช้ TimeRangeBar ได้ฟรี
   วาดเองในหน้า = คนละหน้าตา/คนละกฎว่าล้างอะไรบ้าง แล้วเผลอล้าง `?tab=`/`?mo=` จนเด้งออกจากหน้า */
test('🧹 ปุ่มล้างตัวกรองอยู่ในแถบกลาง และหน้าไม่วาดเอง', () => {
  const read = (f) => stripComments(readFileSync(join(ROOT, f), 'utf8'));
  for (const f of ['src/components/FilterBar.jsx', 'src/components/TimeRangeBar.jsx']) {
    assert.match(read(f), /<ClearFiltersBtn/, `${f} ต้องวาดปุ่มล้างตัวกรองให้ทุกหน้า`);
  }
  /* กฎ "ล้างอะไรได้บ้าง" มีเจ้าของไฟล์เดียว — หน้าห้ามเขียนลิสต์พารามิเตอร์เอง */
  assert.match(read('src/components/ClearFiltersBtn.jsx'), /from '\.\.\/utils\/filterReset'/,
    'ClearFiltersBtn ต้องใช้กฎจาก utils/filterReset.js ไม่ใช่เขียนเกณฑ์เอง');
  /* 🕰️ 8 หน้านี้มีปุ่มของตัวเองมาก่อนปุ่มกลาง (22/10) — ตัวกรองอยู่ใน React state ล้วน
     ไม่ขึ้น URL ⇒ ปุ่มกลางไม่โผล่ซ้ำ จึงยังไม่บังคับย้าย **แต่ห้ามเพิ่มหน้าใหม่เข้าลิสต์นี้**
     (QualityControl ย้ายไปใช้ onClear ของแถบกลางแล้ว · Report ที่เหลือเป็นปุ่มในแถบเตือน
      "ไม่พบใบที่เลือก" คนละที่กับแถบกรอง ไม่ใช่ปุ่มซ้ำ) */
  const LEGACY_OWN_BTN = [
    'src/pages/AddUser.jsx', 'src/pages/DailyPM.jsx', 'src/pages/Dashboard.jsx',
    'src/pages/PMSchedule.jsx', 'src/pages/PMSetup.jsx', 'src/pages/PmForecast.jsx',
    'src/pages/ProductMaster.jsx', 'src/pages/Report.jsx',
  ];
  const bad = [];
  for (const f of walk(join(ROOT, 'src'), ['.js', '.jsx'])) {
    const rel = relative(ROOT, f);
    if (rel === 'src/components/ClearFiltersBtn.jsx' || LEGACY_OWN_BTN.includes(rel)) continue;
    if (rel.startsWith('src/i18n/')) continue;   // 🌐 พจนานุกรม ไทย→English ถือคำนี้เป็นคีย์แปล ไม่ใช่ปุ่ม (02/11)
    const src = stripComments(readFileSync(f, 'utf8'));
    // ปุ่มที่มีข้อความ "ล้างตัวกรอง" ของตัวเอง = วาดเอง
    if (/<button[^>]*>[^<]*ล้างตัวกรอง/.test(src) || /(?<!tr\()(?<!trI18n\()'ล้างตัวกรอง'/.test(src)) bad.push(rel);   // 🌐 13/11: ข้อความอธิบายที่ครอบ tr('ล้างตัวกรอง') ไม่ใช่ปุ่ม
  }
  assert.deepEqual(bad, [], '\n\n❌ วาดปุ่มล้างตัวกรองเองใน: ' + bad.join(', ') + '\n'
    + '   แก้: ลบออก แล้วปล่อยให้ <FilterBar>/<TimeRangeBar> วาดให้ —\n'
    + '        หน้าที่มีตัวกรองใน state ส่ง onClear={...} · อยากเก็บพารามิเตอร์เพิ่ม ส่ง clearKeep={[...]}\n');
});

/* ═══ 📷 ช่องรับรูปห้ามบังคับกล้อง ═══  2026-10-24 · user แจ้ง "เหมือนมีแต่บังคับถ่ายใหม่"
   `<input type="file" accept="image/*" capture="environment">` บนมือถือ/แท็บเล็ต
   = **เปิดกล้องตรง ไม่มีตัวเลือกแกลเลอรี/ไฟล์** ⇒ รูปที่ถ่ายไว้ก่อนหน้า หรือภาพหน้าจอ alarm แนบไม่ได้เลย
   เคสจริง: ช่อง "รูปก่อนซ่อม" ในโมดัลเปิดใบซ่อมจาก Downtime (DailyReport) เป็นจุดเดียวทั้งแอปที่ใส่ไว้
   ⇒ ถอดออก · ถ่ายใหม่ยังกดแท็บเดียวเหมือนเดิม แค่เพิ่มทางเลือก ไม่เสียอะไร */
test('📷 ไม่มีช่องรับรูปไหนใส่ capture (บังคับกล้อง = แนบรูปในเครื่องไม่ได้)', () => {
  const bad = [];
  for (const f of walk(join(ROOT, 'src'), ['.jsx'])) {
    const src = stripComments(readFileSync(f, 'utf8'));
    for (const tag of src.match(/<input[^>]*type="file"[^>]*>/g) || []) {
      if (/\bcapture\s*=/.test(tag)) bad.push(`${relative(ROOT, f)} (${tag.replace(/\s+/g, ' ').slice(0, 80)}…)`);
    }
  }
  assert.deepEqual(bad, [], '\n\n❌ ช่องรับรูปที่บังคับกล้อง: ' + bad.join(', ') + '\n'
    + '   ทำไม: capture= ตัดตัวเลือก "เลือกจากเครื่อง" ทิ้งบนมือถือ/แท็บเล็ต\n'
    + '         รูปที่ถ่ายไว้ก่อนหน้า/ภาพหน้าจอ alarm แนบไม่ได้เลย\n'
    + '   แก้: ลบ capture ออก — ถ่ายใหม่ยังทำได้ปกติ แค่ไม่บังคับ\n'
    + '   📄 docs/modules/storage-images.md §ห้ามบังคับกล้อง\n');
});

/* ═══ ✍️ ลายเซ็น: ดึงสดจากโปรไฟล์ · ห้ามลบไฟล์ที่เอกสารอ้างถึง ═══  2026-10-24 · คำสั่ง user
   ตอนคนอัพเดทลายเซ็น ระบบอัปโหลด path ใหม่แล้ว **ลบไฟล์เดิม** ⇒ ใบที่เก็บ URL เดิมไว้
   กลายเป็นรูปเสีย กู้ไม่ได้ ไม่มี error ฟ้อง · วัด 24/10: 31 ไฟล์ที่ถูกอ้าง หาย 1 ⇒ 93 ใบ (ปิดแล้ว 28)
   ⇒ 2 ชั้น: (1) แสดงผลดึงสดจากโปรไฟล์ด้วย uid (2) ห้ามลบไฟล์เดิมอีก */
test('✍️ ใบพิมพ์/แผง MO ต้องดึงลายเซ็นสดจากโปรไฟล์ ไม่ส่ง null หรือค่าดิบ', () => {
  const src = stripComments(readFileSync(join(ROOT, 'src/pages/MtnRepair.jsx'), 'utf8'));
  assert.match(src, /from '\.\.\/utils\/signResolve'/, 'ต้องใช้ตัวแปลงกลาง signResolve.js');
  /* ช่องเซ็นที่ส่ง null/ค่าดิบตรงๆ = ช่องว่างตลอดกาล หรือพังเมื่อไฟล์ถูกลบ */
  const raw = src.match(/sg\('[^']*',\s*o\.[a-z_]+,\s*(?:null|o\.[a-z_]*sign)\s*,/g) || [];
  assert.deepEqual(raw, [], '\n\n❌ ช่องเซ็นในใบพิมพ์ที่ยังไม่ดึงสด: ' + raw.join(' · ') + '\n'
    + '   แก้: ห่อด้วย sgn(<uid>, <ค่าที่เก็บไว้>) — null = ช่องว่างตลอดกาล (เคสผู้ออก M/O · ผู้รับ MO)\n');
});

test('✍️ ห้ามลบไฟล์ลายเซ็นเดิมตอนอัพเดทโปรไฟล์ (เอกสารเก่าอ้าง URL นั้นอยู่)', () => {
  const src = stripComments(readFileSync(join(ROOT, 'src/components/SignatureModal.jsx'), 'utf8'));
  assert.doesNotMatch(src, /storage\.from\('signatures'\)\s*\.remove\(/,
    '\n\n❌ SignatureModal ลบไฟล์ลายเซ็นเดิมอีกแล้ว\n'
    + '   ทำไม: ใบที่เซ็นไปแล้วเก็บ URL ของไฟล์นั้นไว้ — ลบ = รูปเสีย กู้ไม่ได้ ไม่มี error ฟ้อง\n'
    + '   วัด 24/10: ลบไป 1 ไฟล์ = 93 ใบ (ปิดแล้ว 28) ลายเซ็นหาย\n'
    + '   📄 docs/modules/storage-images.md §ลายเซ็น\n');
});

/* ═══ 🔧 ประวัติเครื่องจักร (FM-MTN-005) ต้องกรองทีมช่างได้ ═══  2026-10-24 · ทีม MTN แจ้ง
   *"ตัวประวัติเครื่องจักร มันดึงมาหมดเลยครับพี่ ทั้งปรับคุณภาพ ทั้งซ่อม JiG
     น่าจะต้อง Filter ในส่วนที่เป็น O-MTN มา อย่างเดียวครับผม"*
   เดิม `mtn_orders_by_machine` กรองแค่เลขเครื่อง ⇒ ใบของ production/jig/die/maintenance ปนกันหมด
   ⇒ ใบพิมพ์ FM-MTN-005 (เอกสารของทีม MTN) มีใบทีมอื่นปนอยู่
   🔴 กรองแล้ว **ต้องเขียนบนจอว่าซ่อนกี่ใบ** และ Excel ต้องออกตามที่เห็นบนจอ (จอกับใบพิมพ์ห้ามคนละชุด) */
test('🔧 MachineRepairHistory: มีตัวกรองทีม · บอกจำนวนที่ซ่อน · Excel ตามที่กรอง', () => {
  const src = stripComments(readFileSync(join(ROOT, 'src/components/MachineRepairHistory.jsx'), 'utf8'));
  assert.match(src, /teamKeyOf/, 'ต้องตัดสินทีมด้วย teamKeyOf ไม่ใช่เทียบชื่อดิบ');
  assert.match(src, /ซ่อนไป/, 'ซ่อนแถวแล้วต้องเขียนบนจอว่าซ่อนกี่ใบ (ห้ามกรองเงียบ)');
  /* 🔴 สรุป/ตาราง/Excel ต้องมาจากชุดที่กรองแล้วชุดเดียวกัน */
  assert.match(src, /summarizeMachineHistory\(shown,/, 'สรุปต้องคิดจากชุดที่กรองแล้ว');
  assert.match(src, /machineHistoryRows\(shown,/, 'Excel ต้องออกตามที่เห็นบนจอ');
  assert.doesNotMatch(src, /summarizeMachineHistory\(state\.orders/, 'สรุปห้ามคิดจากชุดก่อนกรอง');
});

/* ═══ 🧩 ทุก stage ที่มีฟอร์มในโมดัล ต้องมี branch ตอนบันทึกด้วย ═══  2026-10-25
   เคสจริง: `modalStage === 'report'` **ไม่มีทั้งบล็อกฟอร์มและ branch ตอนบันทึก**
   ⇒ ปุ่ม "✏️ แก้ไขข้อมูลแจ้งซ่อม" เปิดโมดัลว่างเปล่า · กดบันทึกแล้วลูกโซ่ if/else ไม่เข้าสักอัน
     `upd` เหลือแค่ updated_at แล้วไหลไปจบที่ toast "แก้ไขแล้ว ✅" = **ล้มเหลวเงียบ**
   (คนเติมรูปปัญหาย้อนหลังไม่ได้ทั้งที่จอบอกว่าบันทึกแล้ว — ปุ่มหลอกมาตลอด) */
test('🧩 StepModal: ทุก modalStage ที่มีฟอร์ม ต้องมี branch ตอนบันทึก (กันบันทึกเงียบ)', () => {
  const src = stripComments(readFileSync(join(ROOT, 'src/pages/MtnRepair.jsx'), 'utf8'));
  const forms = new Set((src.match(/modalStage === '([a-z_]+)'/g) || []).map(m => m.split("'")[1]));
  const saves = new Set((src.match(/stage === '([a-z_]+)'/g) || []).map(m => m.split("'")[1]));
  const missing = [...forms].filter(x => !saves.has(x));
  assert.deepEqual(missing, [], '\n\n❌ stage ที่มีฟอร์มแต่ไม่มี branch ตอนบันทึก: ' + missing.join(', ') + '\n'
    + '   ทำไม: ลูกโซ่ if/else ไม่มี else ปิดท้าย — ไม่เข้าสักอัน = เขียนแค่ updated_at\n'
    + '         แล้วยังขึ้น toast "บันทึกแล้ว" ⇒ คนกรอกเสียเวลาฟรีและไม่รู้ตัว\n'
    + '   แก้: เพิ่ม `} else if (stage === \'<ชื่อ>\') {` พร้อม checkWriteRows()\n');
});

/* ═══ 🪪 employee-identity-single-entry — "สร้างคนใหม่" ต้องได้แถวเดียวกันทุกทางเข้า ═══ 2026-10-26
   เคสจริง (audit ตามคำสั่ง user *"การสร้างตัวตนใส่ฐานข้อมูลจากหน้าจัดการสิทธิ์ ตรงกันมั้ย"*):
   `/register` กับโมดัลเพิ่มคนใน `/add-user` ต่างคน insert `employees` คนละชุดฟิลด์
   ⇒ **`/register` ไม่เคยเขียน `staff_kind`** ตกไปที่ default 'shopfloor' ของคอลัมน์
     = QA/วิศวกร/ธุรการ/สโตร์ ที่ลงทะเบียนทางนั้น ถูกนับเป็นกำลังคนหน้าไลน์เงียบๆ
     (เข้าแผงสกิล · เข้าตัวหาร manpower · เข้า turnover — ดู staffKind.js §แกนที่ 1)
   ⇒ ทุกทางเข้าต้องประกอบแถวผ่าน `newEmployeeRow()` ที่ utils ที่เดียว */
test('🪪 employee-identity-single-entry — ทุกจุดที่ insert employees ต้องผ่าน newEmployeeRow()', async () => {
  const mod = await import('../employeeIdentity.js');
  const row = mod.newEmployeeRow({ employeeIdCode: 'E1', name: 'ทดสอบ' });
  assert.equal(row.staff_kind, 'shopfloor', 'ไม่ส่งประเภท = หน้างาน (ตรงกับ default ของคอลัมน์)');
  assert.ok('staff_kind' in row, '🔴 แถวต้องเขียน staff_kind เสมอ ห้ามปล่อยให้ default เงียบ');
  /* สายสนับสนุนต้องไม่ติดไลน์/ทีมมาด้วย — เป็นคำสัญญาที่เขียนไว้บนจอทั้ง 2 หน้า */
  const sup = mod.newEmployeeRow({ employeeIdCode: 'E2', name: 'ก', staffKind: 'support', lineId: 'L1', team: 'A', groupName: 'G' });
  assert.equal(sup.line_id, null, 'สายสนับสนุนห้ามผูกไลน์');
  assert.equal(sup.team, null, 'สายสนับสนุนห้ามผูกทีม');

  const bad = [];
  for (const f of walk(join(ROOT, 'src'), ['.jsx', '.js'])) {
    const src = stripComments(readFileSync(f, 'utf8'));
    if (!/from\(['"]employees['"]\)\s*\.?\s*\n?\s*\.insert\(/.test(src.replace(/\s+/g, ' ')
      .replace(/from\('employees'\) \.insert\(/g, "from('employees').insert("))) continue;
    if (!/newEmployeeRow\(/.test(src)) bad.push(f.replace(ROOT + '/', ''));
    /* 🔁 09/11: รหัสซ้ำต้องถูกถามก่อน insert และแปล 23505 เป็นข้อความคน — ห้ามพ่นชื่อ constraint ให้คนอ่าน
       (PD2 เพิ่ม 3 คนที่มีอยู่แล้วแต่ตัวเองมองไม่เห็น ⇒ ตันที่ "employees_employee_id_code_key") */
    if (!/findEmployeeByCode\(/.test(src)) bad.push(f.replace(ROOT + '/', '') + ' (ไม่ถาม findEmployeeByCode ก่อน insert)');
    if (!/isDuplicateEmployeeError\(/.test(src)) bad.push(f.replace(ROOT + '/', '') + ' (ไม่แปล 23505 ด้วย isDuplicateEmployeeError)');
  }
  assert.deepEqual(bad, [], '\n\n❌ ไฟล์ที่ insert employees เองโดยไม่ผ่าน newEmployeeRow(): ' + bad.join(', ') + '\n'
    + '   ทำไม: ชุดฟิลด์จะแยกกันทันทีที่เพิ่มคอลัมน์ใหม่ — ทางที่ลืมเขียนจะตกไปที่ default เงียบๆ\n'
    + '   แก้: ประกอบแถวด้วย newEmployeeRow({...}) จาก src/utils/employeeIdentity.js\n');
});

/* ═══ 📷 ปุ่ม/ช่องที่ "เปิดแล้วแผงปิดทันที" ต้องไม่ถูก unmount ไปด้วย ═══  2026-10-26
   หน้างานแจ้ง: *"เปลี่ยนรูปโปรไฟล์จากแถบซ้ายมือไม่ได้ ต้องออกมาหน้าโฮม"*
   ต้นเหตุ: `<input type=file ref={avatarRef}>` เคยอยู่ใน `profileActions` ซึ่งวาดเฉพาะตอนแผงโปรไฟล์เปิด
   เมนูกด 📷 → `avatarRef.current.click()` → **แล้ว `closeNav()` ปิดแผงทันที** ⇒ input หลุดจาก React
   ⇒ คนเลือกไฟล์เสร็จ event `change` ไม่มีใครรับ = เงียบสนิท (หน้า Home มี input ของตัวเองจึงยังทำงาน)
   ⇒ input ต้องอยู่ใน `modals` ซึ่งวาดทุกสถานะของ sidebar ทั้ง desktop และมือถือ */
test('📷 input เปลี่ยนรูปโปรไฟล์ต้องอยู่ใน modals ไม่ใช่ใน profileActions (กดแล้วแผงปิด = เงียบ)', () => {
  const src = stripComments(readFileSync(join(ROOT, 'src/App.jsx'), 'utf8'));
  const act = src.indexOf('const profileActions');
  const mod = src.indexOf('const modals');
  const inp = src.indexOf('ref={avatarRef}');
  assert.ok(act >= 0 && mod >= 0 && inp >= 0, 'หา profileActions / modals / input ไม่เจอ — โครงเปลี่ยนไปแล้ว');
  assert.ok(inp > mod, '\n\n❌ src/App.jsx: <input ref={avatarRef}> ไม่ได้อยู่ใน `modals`\n'
    + '   ทำไม: เมนูโปรไฟล์กด 📷 แล้วปิดแผงทันที ⇒ input ถูก unmount ก่อนคนเลือกไฟล์เสร็จ\n'
    + '         = เปลี่ยนรูปจาก sidebar ไม่ได้เลย โดยไม่มี error ให้เห็น (เคสจริง 26/10)\n'
    + '   แก้: ย้าย <input> ไปไว้ใน `modals` (วาดทุกสถานะ ทั้ง desktop rail และ drawer มือถือ)\n');
  assert.ok(mod > act, 'โครงไฟล์เปลี่ยน — `modals` ต้องประกาศหลัง `profileActions` ด่านนี้ถึงจะเชื่อถือได้');
});

/* ═══ 🧯 จอ error ของ RootErrorBoundary ต้องมี stack ให้หน้างานคัดลอกส่งมา ═══  2026-10-26
   เคสจริง: หน้างานส่งรูปจอ error มาพร้อมข้อความ `Cannot access 'V' before initialization`
   ซึ่งเป็นชื่อหลัง minify ⇒ ตามหาต้นเหตุจากข้อความอย่างเดียว**ไม่ได้เลย**
   (โหลดทุก chunk ของ build จริง 331 ตัว + เรนเดอร์ทุกหน้า/ทุก role ในฮาร์เนส = ผ่านหมด) */
test('🧯 RootErrorBoundary ต้องเก็บ stack + มีปุ่มคัดลอกรายละเอียด', () => {
  const src = stripComments(readFileSync(join(ROOT, 'src/main.jsx'), 'utf8'));
  const bad = [];
  if (!/componentStack/.test(src)) bad.push('ไม่ได้เก็บ componentStack จาก componentDidCatch');
  if (!/error\?\.stack|error\.stack/.test(src)) bad.push('ไม่ได้เก็บ error.stack');
  if (!/clipboard\.writeText/.test(src)) bad.push('ไม่มีปุ่มคัดลอกรายละเอียด');
  if (!/location\.pathname/.test(src)) bad.push('รายละเอียดไม่ได้บอกว่าพังที่หน้าไหน');
  assert.deepEqual(bad, [], '\n\n❌ src/main.jsx: ' + bad.join(' · ') + '\n'
    + '   ทำไม: error ที่เกิดเฉพาะเครื่องหน้างาน (ข้อมูลจริง/role จริง) จำลองซ้ำไม่ได้\n'
    + '         ถ้าจอบอกแค่ message ที่ถูก minify แล้ว = ไล่ต้นเหตุไม่ได้เลย\n');
});

/* ═══ 📦 แผงเรียกชิ้นส่วน: คนที่ "ตั้งจุดเรียกเติมได้" ต้องเห็นปุ่ม ⚙️ แม้ไลน์ยังไม่มีอะไรต้องทำ ═══  2026-10-26
   feedback สโตร์: *"ปุ่มเรียกชิ้นส่วนจากสโตร์ ขึ้นให้กดแค่บางไลน์ ไม่ขึ้นทั้งหมด และขึ้นเฉพาะบาง User"*
   กิ่ง `nothing` เคยตัดด้วย `canDecide` อย่างเดียว ⇒ คนที่มี `line_levels:manage` แต่ไม่มี
   `wip_request:decide` ไม่เห็นแม้แต่ทางเข้าไปตั้ง min บนไลน์ที่ยังไม่เคยตั้ง = ไก่กับไข่ */
test('📦 LinePartCallPanel: กิ่ง "ไม่มีอะไรต้องทำ" ต้องเปิดให้ canSetLv ด้วย + ⚙️ ต้องเปิดโมดัลได้จริง', () => {
  const src = stripComments(readFileSync(join(ROOT, 'src/components/LinePartCallPanel.jsx'), 'utf8'));
  const bad = [];
  if (!/if \(!canDecide && !canSetLv\) return null;/.test(src))
    bad.push('กิ่ง nothing ยังตัดด้วย canDecide อย่างเดียว (คนตั้ง min ไม่เห็นทางเข้า)');
  if ((src.match(/<LevelSetupModal/g) || []).length !== 1)
    bad.push('มี <LevelSetupModal> มากกว่า 1 ชุด — ก๊อป JSX = ปุ่มชุดใดชุดหนึ่งกลายเป็นปุ่มหลอก');
  if ((src.match(/\{setupModal\}/g) || []).length < 2)
    bad.push('ไม่ได้วาง {setupModal} ทั้ง 2 กิ่ง — ปุ่ม ⚙️ ของกิ่งใดกิ่งหนึ่งจะกดแล้วไม่มีอะไรเกิดขึ้น');
  assert.deepEqual(bad, [], '\n\n❌ src/components/LinePartCallPanel.jsx: ' + bad.join('\n   ') + '\n'
    + '   ทำไม: ไลน์ที่ยังไม่ตั้ง min = ไม่มีอะไรต้องทำ ⇒ แผงย่อ ⇒ ถ้าซ่อน ⚙️ ด้วย\n'
    + '         ก็ไม่มีทางตั้งจุดเฝ้าได้เลย ทั้งที่จุดเฝ้าคือสิ่งที่ต้องตั้ง "ก่อน" ของจะหมด\n');
});

/* ═══ 📉 บอร์ดคัมบังสโตร์: "ถึงจุดต้องปล่อย" ต้องมองจากยอดคงเหลือ ไม่ใช่จากคิวใบเดิม ═══  2026-10-26
   feedback สโตร์ (ใบ E-Production TSAT P4): *"ให้แสดงรายการที่สต็อกต่ำกว่าหรือเท่ากับค่า min
   เพื่อที่ให้สโตร์ทราบถึงสถานะงานที่จะต้องปล่อยคัมบังเข้าไลน์ผลิต (ปัจจุบัน ขึ้นบางรายการ)"*
   เหตุที่เดิมขึ้นบางรายการ: คิวใบล็อตมาจาก trigger ระเบิด BOM + ต้องสะสมครบ `lot_size`
   วัด 26/10: kanban_standards is_active 458 แถว แต่ **250 แถวไม่ได้ตั้ง lot_size** = ไม่มีวันออกใบ */
test('📉 PullBoard ต้องมีชั้น "สต็อก ≤ min" และคิดผ่าน utils/kanbanReleaseDue เท่านั้น', () => {
  const src = stripComments(readFileSync(join(ROOT, 'src/pages/HeijunkaKanban.jsx'), 'utf8'));
  const bad = [];
  if (!/releaseDueRows\(/.test(src)) bad.push('ไม่ได้เรียก releaseDueRows() — กติกาต้องอยู่ที่ utils ที่เดียว');
  if (!/<ReleaseDueSection/.test(src)) bad.push('ไม่ได้วาดชั้น "ถึงจุดต้องปล่อยคัมบัง"');
  if (!/min_qty/.test(src)) bad.push("คิวรี kanban_standards ไม่ได้ดึง min_qty — ไม่มีค่าให้เทียบ");
  assert.deepEqual(bad, [], '\n\n❌ src/pages/HeijunkaKanban.jsx: ' + bad.join('\n   ') + '\n'
    + '   ทำไม: ของที่ใกล้หมดแต่ยังไม่มีใครสั่ง FG รอบใหม่ ไม่เคยโผล่ในคิวใบล็อตเลย\n');
});

/* ═══ 📋 แผนสั่งงานล็อต: ต้องเข้าแผนพาร์ทที่ไลน์ผลิตได้ แม้ยังไม่มีความต้องการ ═══  2026-10-26
   feedback สโตร์: *"ขึ้นข้อมูลพาร์ทไม่ครบทุกรายการ อยากให้ขึ้นข้อมูลพาร์ททั้งหมดที่ผลิตของไลน์ผลิตนั้น"*
   + *"งานต่อ Process ตอนนี้ขึ้นให้เข้าแผนแค่ Step2 อยากให้ขึ้น Step1 ด้วย"*
   เดิมปุ่ม "+ เข้าแผน" มีที่เดียวคือลิสต์ `unplanned` ซึ่งมาจากความต้องการล้วน
   ⇒ วัด 26/10: LINE A (800 ตัน) และ LINE B (600 ตัน) ออเดอร์ค้าง **0 ใบ** ⇒ ลิสต์ว่าง ⇒ เปิดแผนไม่ได้
   และ Step 1 เป็นแถว is_operation ที่ไม่มีใน bom_items ⇒ ไม่มีทางได้ความต้องการของตัวเอง */
test('📋 ProdLotPlanner: มีทางเข้าแผนพาร์ทอื่นของไลน์ + ขั้นต่อ Process ตกทอดยอดจากพาร์ทแม่', () => {
  const planner = stripComments(readFileSync(join(ROOT, 'src/components/ProdLotPlanner.jsx'), 'utf8'));
  const page    = stripComments(readFileSync(join(ROOT, 'src/pages/ProductionPlan.jsx'), 'utf8'));
  const bad = [];
  if (!/otherParts/.test(planner)) bad.push('ProdLotPlanner ไม่มีลิสต์ "พาร์ทอื่นที่ไลน์นี้ผลิต"');
  if (!/opStepsOf\(/.test(planner)) bad.push('ProdLotPlanner ไม่ได้ตกทอดยอดให้ขั้นต่อ Process');
  if (!/op_parent_mat/.test(page))  bad.push('ProductionPlan ไม่ได้ดึง op_parent_mat — ไม่รู้จักขั้นตอน');
  if (!/partsOfLine=/.test(page))   bad.push('ProductionPlan ไม่ได้ส่ง partsOfLine ให้แท็บล็อต');
  assert.deepEqual(bad, [], '\n\n❌ ' + bad.join('\n   ') + '\n'
    + '   ทำไม: ไลน์ที่ออเดอร์ยังไม่เข้า จะไม่มีปุ่มให้กดเลย = "เปิดแผนไม่ได้" ตามที่หน้างานแจ้ง\n');
});

/* ═══ 🕳️ ป้าย/ลิงก์ที่พาไปหน้าที่มีตัวกรองค้าง ต้องไม่ลงจอว่าง ═══  2026-10-26 · user "ทำไม filter ไม่ขึ้น"
   เคสจริง: ป้าย "รอคุณเซ็นรับทราบ" (myQueue) พาไป `/mtn-repair?tab=list&ack=pending`
   แต่ช่อง "ทีมช่าง" ของหน้านั้นตั้งต้นเป็นทีมของ user เอง — ผู้รับป้ายคือ ผจก.ต้นสังกัดของ
   **ฝ่ายที่แจ้ง** (ส่วนใหญ่ = PRODUCTION) ส่วนใบที่ป้ายนับเป็นใบฟอร์มทีม MTN ล้วน
   วัด 26/10 ฝั่ง DR: production 1,018 ใบ ∩ maintenance 58 ใบ = **0 ใบเสมอ ไม่ว่าเลือกวันไหน**
   ⇒ ป้ายบอก 48 ใบ แต่จอขึ้น "ไม่มีรายการ" = จอโกหก (คนอ่านว่าไม่มีงานค้าง แล้วเดินจากไป)
   แก้ 2 ชั้น: (1) เปิด `?ack=pending` แล้วปลดช่องทีมให้ก่อนครั้งเดียว
              (2) ลิสต์ว่าง ต้องเขียนบนจอว่า "ตัวกรองไหนตัดทิ้ง · ปลดตัวไหนแล้วได้คืนกี่ใบ" */
test('🕳️ จอรายการ MO: ว่างแล้วต้องบอกว่าตัวกรองไหนตัดทิ้ง + ?ack=pending ต้องปลดช่องทีมให้', () => {
  const src = stripComments(readFileSync(join(ROOT, 'src/pages/MtnRepair.jsx'), 'utf8'));

  assert.match(src, /blameEmpty\(/,
    'จอรายการ MO ต้องเรียก blameEmpty() ตอนลิสต์ว่าง — "ไม่มีรายการ" เฉยๆ อ่านได้ว่า "ไม่มีงานค้าง"');
  assert.match(src, /ladderSteps\(/,
    'ต้องวาดบันได "ตกเหลือ 0 ตรงไหน" ด้วย — บอกแค่ชื่อตัวกรองไม่พอ คนต้องเห็นว่าตกตรงขั้นไหน');
  assert.match(src, /clearFilterBy/,
    'ต้องมีปุ่มปลดตัวกรองที่ชี้ — บอกว่าใครตัดทิ้งแต่ปลดไม่ได้ = ยังแก้ปัญหาให้คนหน้างานไม่ได้');
  /* 🔗 ลิงก์ที่กรองกองมาแล้ว (`?wait=` `?ack=` `?pr=`) ต้องปลดช่องทีมให้ก่อน — ป้ายนับข้ามทีม
     แต่หน้าตั้งทีมเป็นทีมของ user เอง ⇒ กดจากกระดิ่งแล้วว่างเปล่า (26/10 ack · 27/10 wait) */
  assert.match(src, /queueLinkSeen/,
    'ลิงก์ ?wait=/?ack=/?pr= ต้องปลดช่องทีมช่างให้ก่อนครั้งเดียว (ป้ายในคิวนับข้ามทีม)');
  assert.match(src, /inPageFilterEdit/,
    'ต้องแยก "เดินมาจากลิงก์" ออกจาก "กดเลือกเองบนหน้า" — กดเองแล้วห้ามล้างทีมที่ user ตั้งไว้');

  /* 🔴 ตัวกรองของจอนี้ต้องมาจาก "ลิสต์ตัวกรอง" ชุดเดียว แล้วค่อยเอาไปทั้งกรองจริงและอธิบาย
     เขียนเป็น if ซ้อนกันเหมือนเดิม = ต้องมีเกณฑ์ชุดที่ 2 ไว้อธิบาย แล้วมันจะเพี้ยนกันวันใดวันหนึ่ง */
  for (const name of ['baseFilters', 'queueFilters']) {
    assert.match(src, new RegExp(`const ${name} = useMemo`),
      `${name} ต้องเป็นลิสต์ตัวกรองชุดเดียวที่ทั้ง "กรองจริง" และ "อธิบายว่าทำไมว่าง" ใช้ร่วมกัน`);
  }
  assert.match(src, /const beforeWait = useMemo\(\(\) => \{\s*const on = baseFilters\.filter/,
    'beforeWait ต้องกรองจาก baseFilters — ห้ามกลับไปเขียน if ซ้อนกันเอง');
  assert.match(src, /const shownNoDate = useMemo\(\(\) => \{\s*const on = queueFilters\.filter/,
    'shownNoDate ต้องกรองจาก queueFilters — ห้ามกลับไปเขียน if ซ้อนกันเอง');
});

/* ═══ 🛡️ scope-registry-gate — ด่าน "กฎขอบเขตต้องพิสูจน์กับทะเบียนจริง" ห้ามถูกถอด ═══  2026-10-26
   เคสจริง (คำสั่ง user "ทำด่านกันซ้ำ"): 25/10 บีบขอบเขตหัวหน้ากลุ่ม — build/เทส/crashsweep ผ่านหมด
   เพราะเทสทุกตัวเล่นกับ **ข้อมูลสังเคราะห์ที่เขียนให้กฎใหม่ผ่าน** ⇒ เช้า 26/10 หน้างานเปิดกะไม่ได้
   (วัดย้อนหลัง: 15 บัญชีถูกบีบ · หัวหน้ากลุ่มฝั่ง PD1 3 คนเหลือ **ไลน์เดียว**)
   ⇒ ตั้งแต่นี้ กฎขอบเขตต้องถูกเล่นซ้ำกับทะเบียนผู้ใช้จริง (ไม่มีชื่อคน) ก่อน merge เสมอ
   🔴 ด่านนี้คุม "ด่านนั้นยังอยู่และยังมีของจริงให้เล่น" — ตัวกฎ 5 ข้อ (A-E) อยู่ใน scopeRegistryGate */
test('🛡️ scope-registry-gate — ด่านทะเบียนจริงของกฎขอบเขตยังอยู่ครบ', () => {
  const bad = [];
  const gatePath = join(ROOT, 'src/utils/__tests__/scopeRegistryGate.test.mjs');
  const fixPath = join(ROOT, 'src/utils/__tests__/fixtures/userScopeRegistry.json');
  if (!existsSync(gatePath)) bad.push('ไม่มี scopeRegistryGate.test.mjs (ด่านถูกลบ)');
  if (!existsSync(fixPath)) bad.push('ไม่มี fixtures/userScopeRegistry.json (ทะเบียนถูกลบ)');
  if (bad.length) { assert.deepEqual(bad, [], bad.join('\n')); return; }

  const gate = stripComments(readFileSync(gatePath, 'utf8'));
  /* ต้องเล่นกับทะเบียนจริง + ผ่าน 2 ประตูของกฎขอบเขต ไม่ใช่เทสสังเคราะห์ล้วน */
  for (const need of ['userScopeRegistry.json', 'effectiveSections', 'scopedLines', 'scopedLineNames']) {
    if (!gate.includes(need)) bad.push(`scopeRegistryGate ไม่ได้ใช้ ${need}`);
  }
  const reg = JSON.parse(readFileSync(fixPath, 'utf8'));
  /* 🔴 กันทางหนีที่ง่ายที่สุด: ล้าง fixture ให้ว่าง แล้วด่านผ่านฟรี */
  if (!(reg.profiles?.length >= 50)) bad.push(`ทะเบียนมีบัญชีแค่ ${reg.profiles?.length ?? 0} (ต้อง ≥ 50)`);
  if (!(reg.lines?.filter(l => l.is_active).length >= 20)) bad.push('ทะเบียนไลน์ที่ใช้งานน้อยกว่า 20');
  if (!(reg.openedLines?.length >= 10)) bad.push('ประวัติเปิดกะใน fixture น้อยกว่า 10 บัญชี');
  if (!reg._meta?.refresh_sql) bad.push('fixture ไม่มี _meta.refresh_sql (session หน้ารีเฟรชไม่ได้)');
  /* 🔴 ห้ามมีชื่อคน/อีเมล/uid เต็ม — ไฟล์นี้อยู่ในรีโป */
  if (/[฀-๿]{2,}\s+[฀-๿]{2,}/.test(JSON.stringify(reg.profiles || [])))
    bad.push('เจอข้อความไทยยาวใน profiles — น่าจะเป็นชื่อคน');
  for (const p of reg.profiles || []) {
    if (!/^[0-9a-f]{8}$/.test(p.acct || '')) { bad.push(`acct ไม่ใช่ hash: ${p.acct}`); break; }
  }
  assert.deepEqual(bad, [], 'ด่าน "กฎขอบเขตต้องพิสูจน์กับทะเบียนจริง" หาย:\n' + bad.join('\n'));
});

/* ═══ 🪧 ช่องเลือกไลน์ต้อง "ไม่ตาย" — ลิสต์ของ picker ห้ามกรองเองจนเหลือ 0 ═══  2026-10-26
   หน้างานแจ้ง: *"ช่องไลน์การผลิต ไม่มีไลน์ให้เลือกครับ เปิด MO"*
   ต้นเหตุ: 4 หน้า (MtnRepair · MtnAnalysis · MaintenanceLevels · DailyPM) **ก๊อปสูตรขอบเขตมาไว้ในหน้า**
   แล้วเอา Set นั้นมากรองลิสต์ของ <LineSelect> ตรงๆ — ไม่มีตาข่าย "กรองแล้วไม่เหลือ = ไม่กรอง"
   ที่ `scopeLines()` ของกลางใน components/LineSelect.jsx มีมาตั้งแต่ 2026-08-24
   ⇒ บัญชีที่ส่วนงานไม่มีไลน์ผลิตสังกัดเลย (QA · Planning&Store · ฝั่งช่าง) ได้ dropdown ว่างเปล่า
     = แจ้งซ่อมไม่ได้ทั้งหน้า โดยไม่มีข้อความบอกสักตัว (fail-closed เงียบ)
   🔴 ลิสต์ของ picker (fail-open) **คนละแกนกับ** Set ที่เป็นตัวกรองรายการ/ด่านสิทธิ์ (fail-closed)
      — ห้ามยุบรวมกัน และห้ามเอา Set มาเป็นลิสต์ของ picker */
test('🪧 line-picker-never-dead — ลิสต์ที่ส่งเข้า <LineSelect> ต้องมาจาก scopeLines() ของกลาง', () => {
  const bad = [];
  /* helper กลางที่มีตาข่าย "กรองแล้วไม่เหลือ = ไม่กรอง" อยู่แล้ว — ผ่านตัวใดตัวหนึ่ง = ปลอดภัย */
  const VIA_SHARED = /\b(pickerLines|scopeLines|lineOptions|scopedLineNames)\s*\(/;
  /* สัญญาณว่ากรองด้วย "ขอบเขต" — ไม่ใช่เงื่อนไขธุรกิจ (ไลน์ที่มี demand · dedupe · ไลน์ที่เคยผลิต) */
  const SCOPE_SRC = /\b(inSectionScope|scopedLines|getLineFamilyNames|getLineFamilyIds)\s*\(/;
  /* ตัดเนื้อ useMemo แบบสแกนตรงๆ — regex `[\s\S]*?` บนไฟล์ 7 พันบรรทัดทำให้เทสค้าง (เจอจริง 26/10) */
  const bodyAfter = (src, at) => {
    /* ตัดที่ "ท้าย useMemo" ตัวแรกที่เจอ — มี 2 รูป: `\n  }, [deps]` กับ `\n  [deps],\n  );`
       ตัดไม่ครบ = เนื้อของ memo ถัดไปปนเข้ามา แล้วด่านฟ้องผิดตัว (เจอจริงตอนทำด่านนี้) */
    let end = src.length;
    for (const t of ['\n  }, [', '\n    [', '\n  );', '\n\n']) {
      const i = src.indexOf(t, at + 1);
      if (i >= 0 && i < end) end = i;
    }
    return src.slice(at, Math.min(end, at + 1200));
  };
  const memoBody = (src, name) => {
    const at = src.indexOf(`const ${name} = useMemo(`);
    return at < 0 ? null : bodyAfter(src, at);
  };
  for (const f of walk(join(ROOT, 'src'), ['.jsx'])) {
    if (/__tests__/.test(f) || /components[\\/]LineSelect\.jsx$/.test(f)) continue;
    const src = stripComments(readFileSync(f, 'utf8'));
    const rel = relative(ROOT, f);
    /* ตัวแปรที่ "ได้มาจากขอบเขต" ในไฟล์นี้ — ใช้ไล่ต่ออีกชั้น (visibleLineNames → lineOptions) */
    const derived = new Set();
    for (const m of src.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*useMemo\(/g)) {
      const body = bodyAfter(src, m.index);
      if (SCOPE_SRC.test(body) && !VIA_SHARED.test(body)) derived.add(m[1]);
    }
    /* ⚖️ ข้อยกเว้นทางการ — `/report` กรอง **ข้อมูล** ด้วย `scopeSecs` ของตัวเองอยู่แล้ว
       (`empQ.in('section', scopeSecs)` ฯลฯ) ⇒ ลิสต์ไลน์ของตัวกรองผูกกับชุดข้อมูลที่มีสิทธิ์เห็นจริง
       เปิดลิสต์ให้กว้างกว่าข้อมูล = เลือกแล้วได้จอเปล่า (จอโกหกอีกแบบ)
       🔴 จะเปลี่ยนพฤติกรรมหน้านี้ = **product decision ต้องถาม user ก่อน** ห้ามแก้เงียบ */
    if (/pages[\\/]Report\.jsx$/.test(f)) continue;
    /* ⚖️ ข้อยกเว้นทางการที่ 2 — `/morning-meeting` เอาชุดไลน์นี้ไปเป็น `.in('line_name', lineNames)`
       ของคิวรีจริง (กะ/ใบผลิต/เครื่อง) ⇒ เปิดลิสต์กว้างขึ้น = **เปิดข้อมูลกว้างขึ้นด้วย**
       🔴 เป็น product decision ต้องถาม user ก่อน ห้ามแก้เงียบ */
    if (/pages[\\/]MorningMeeting\.jsx$/.test(f)) continue;
    const seen = new Set();
    for (const m of src.matchAll(/<Line(?:Scope)?Select\b[^>]{0,400}?\blines=\{([A-Za-z_$][\w$]*)\}/g)) {
      const name = m[1];
      if (seen.has(name)) continue;
      seen.add(name);
      const body = memoBody(src, name);
      if (!body || VIA_SHARED.test(body)) continue;   // เป็น prop / ผ่านของกลางแล้ว
      const why = SCOPE_SRC.test(body) ? 'กรองขอบเขตเองในหน้า'
        : [...derived].some(v => v !== name && body.includes(v)) ? 'กรองด้วยชุดที่มาจากขอบเขต'
        : null;
      if (why) bad.push(`${rel} → ${name} (${why})`);
    }
  }
  assert.deepEqual(bad, [], '\n\n❌ ลิสต์ของ <LineSelect> ที่กรองขอบเขตเองในหน้า:\n  ' + bad.join('\n  ')
    + '\n\n   ทำไมห้าม: ส่วนงานที่ไม่มีไลน์ผลิตสังกัด (QA · Planning&Store · ฝั่งช่าง) จะได้ลิสต์ว่าง\n'
    + '            = เลือกไลน์ไม่ได้ทั้งหน้า และจอไม่บอกอะไรเลย (เคสจริง 26/10 "เปิด MO ไม่มีไลน์ให้เลือก")\n'
    + '   แก้: import { scopeLines as pickerLines } from "../components/LineSelect"\n'
    + '        แล้ว pickerLines(lines, { role, lineId, sections }) — มีตาข่าย "กรองแล้วไม่เหลือ = ไม่กรอง"\n'
    + '   🔴 ชุดที่ใช้กรอง "รายการ/สิทธิ์" ยัง fail-closed เหมือนเดิม — คนละแกน ห้ามยุบรวม\n');
});

/* ═══ 💥 ชื่อ const ห้ามชนกับฟังก์ชันที่ import มา แล้วเรียกตัวนั้นข้างใน ═══  2026-10-26
   เคสจริง (commit 83b3e1c3 · 25/10): 4 หน้าเขียน
     `const scopedLines = useMemo(() => { … return scopedLines({…}) }, […])`
   โดยไฟล์นั้น `import { scopedLines } from '../utils/sectionScope'` อยู่ด้วย
   ⇒ ชื่อในฟังก์ชันคอมโพเนนต์ **บังของที่ import มา** · callback รันตอน const ยังไม่ถูก assign
   ⇒ `ReferenceError: Cannot access 'scopedLines' before initialization` = **จอขาวทั้งหน้า**
   พิสูจน์กับแอปจริง: /energy · /morning-meeting · /equipment?tab=die · ?tab=jig
   พังทุกบัญชีที่ **ไม่ใช่ leader และมีขอบเขตส่วนงาน** (= supervisor/manager เกือบทั้งหมด)
   🔴 ทำไม lint `no-use-before-define` ไม่จับ: การอ่านอยู่ใน callback (คนละ scope กับที่ประกาศ)
   🔴 ทำไม crashsweep ไม่จับ: mock ใช้ `role=admin` + `sections: []` ⇒ กิ่งนั้นไม่เคยถูกเดิน
      (อุดแล้วด้วยรอบ scoped ใน audit/crashsweep.mjs)
   ⇒ แก้ด้วยการ import เป็น alias (`scopedLines as scopedLinesOf`) ห้ามตั้งชื่อชนแล้วหวังว่าจะไม่เรียก */
test('💥 no-shadowed-import-call — const ที่ชื่อชนกับ import แล้วเรียกตัวนั้น = TDZ จอขาว', () => {
  const bad = [];
  for (const f of walk(join(ROOT, 'src'), ['.jsx', '.js'])) {
    if (/__tests__/.test(f)) continue;
    const src = stripComments(readFileSync(f, 'utf8'));
    const imported = new Set();
    for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from/g)) {
      for (const part of m[1].split(',')) {
        const nm = part.split(' as ').pop().trim();
        if (nm) imported.add(nm);
      }
    }
    if (!imported.size) continue;
    for (const m of src.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=/g)) {
      const name = m[1];
      if (!imported.has(name)) continue;
      /* มีการ "เรียก name(" หลังจุดที่ประกาศ = อ่าน binding ตัวใหม่ที่ยังไม่ถูก assign */
      const call = src.indexOf(`${name}(`, m.index + m[0].length);
      if (call < 0) continue;
      const ln = src.slice(0, m.index).split('\n').length;
      bad.push(`${relative(ROOT, f)}:${ln} — const ${name} บังของที่ import มา แล้วเรียก ${name}() ข้างใน`);
    }
  }
  assert.deepEqual(bad, [], '\n\n❌ const ที่ชื่อชนกับฟังก์ชันที่ import มา:\n  ' + bad.join('\n  ')
    + '\n\n   ทำไมพัง: callback ของ useMemo/useCallback รัน "ระหว่าง" ที่ const ยังไม่ถูก assign\n'
    + '            ⇒ ReferenceError: Cannot access \'x\' before initialization = จอขาวทั้งหน้า\n'
    + '            lint no-use-before-define จับไม่ได้ (คนละ scope) · crashsweep เดิมจับไม่ได้ (mock ไม่มี scope)\n'
    + '   แก้: import เป็น alias → `import { x as xOf } from "..."` แล้วเรียก xOf() ข้างใน\n');
});

/* ═══ 🫙 ลิสต์ตัวเลือกว่าง ห้ามบอกเหตุผลเดียวแบบเหมารวม ═══  2026-10-26
   เคสจริง: หัวหน้ากลุ่มแจ้ง *"เปิดยอดเลเซอร์ไม่ได้"* — ช่องเลือกสินค้าของ "เปิดเป้าผลิต (ไม่มีบาร์โค้ด)"
   ขึ้นว่า **"ไลน์นี้ยังไม่มีสินค้า register (เพิ่มที่ Product Master ก่อน)"**
   ของจริง: สินค้าเลเซอร์ตัวนั้น **ถูกปิดใช้งานไว้** (เคยเปิดใบด้วย 40 ครั้ง ล่าสุด 30/09)
   ⇒ หน้างานไปรอ ผจก. "เพิ่มสินค้าใหม่" ทั้งที่ของมีอยู่แล้ว แค่ต้องเปิดใช้งานคืน = เสียกะเปล่า
   🔴 ลิสต์ว่างที่นี่มี 4 ความหมาย ต้องแยกให้ครบ:
     ทะเบียนยังโหลดไม่เสร็จ · ไลน์ไม่อยู่ในทะเบียน · มีของแต่ถูกปิดใช้งาน · ไม่มีจริงๆ
   (กฎ "ห้ามล้มเหลวเงียบ" + กฎเขียน DB ข้อ 12 "ลิสต์ว่าง 2 ความหมาย") */
test('🫙 manual-open-product-empty-reason — ช่องเลือกสินค้าต้องแยกสาเหตุลิสต์ว่าง ไม่ใช่บอกว่า "ยังไม่มี register" อย่างเดียว', () => {
  const src = stripComments(readFileSync(join(ROOT, 'src/pages/DailyReport.jsx'), 'utf8'));
  const bad = [];
  if (!src.includes('inactiveProds')) bad.push('ไม่มี inactiveProds — จอตอบไม่ได้ว่า "ของถูกปิดใช้งาน"');
  if (!/dr_products:inactive/.test(src)) bad.push('ไม่ได้โหลดสินค้าที่ปิดใช้งาน (คีย์ dr_products:inactive)');
  for (const need of ['ไม่อยู่ในทะเบียนไลน์', 'ปิดใช้งาน', 'ยังโหลดไม่เสร็จ']) {
    if (!src.includes(need)) bad.push(`ข้อความแยกสาเหตุหาย: "${need}"`);
  }
  /* คีย์ cache ใหม่ต้องลงทะเบียนด้วย ไม่งั้นแก้ Product Master แล้วค้าง 4 ชม. */
  const inv = stripComments(readFileSync(join(ROOT, 'src/utils/masterInvalidate.js'), 'utf8'));
  if (!inv.includes("'dr_products:inactive'")) bad.push('masterInvalidate ไม่ได้ลงทะเบียน dr_products:inactive');
  assert.deepEqual(bad, [], '\n\n❌ ช่องเลือกสินค้ากลับไปบอกสาเหตุเดียว:\n  ' + bad.join('\n  ')
    + '\n\n   ทำไมสำคัญ: "ไม่มีสินค้า register" กับ "มีแต่ถูกปิดใช้งาน" แก้คนละทางกันคนละคน\n'
    + '              บอกผิด = หน้างานรอของที่ไม่ต้องรอ และของที่ต้องทำไม่มีใครทำ\n');
});

/* ═══ 🔧 ขั้น 4 ของใบ JIG/DIE เป็นของหัวหน้าแผนกช่าง — ห้ามลืมส่ง `toolTeam` ═══  2026-10-27
   คำสั่ง user: *"สำหรับ MO ของ jig กับ DIE งานซ่อมนอกไลน์ step 4 ต้องเป็นหัวหน้าแผนกช่าง
   ก่อน QA ไม่ใช่ผู้แจ้ง"* — `stepMeta/stepLabel/stepDenyHint/stepAssumptions` ต้องรู้ 2 อย่าง:
   ฟอร์มไหน (`mtnForm`) **และ** ทีมเครื่องมือไหม (`toolTeam`)
   ลืมส่ง `toolTeam` = ไม่พัง ไม่มี error — แค่จอกลับไปเขียนว่า "ผู้เปิดใบแจ้งซ่อม (ฝ่ายที่แจ้ง)"
   ทั้งที่ปุ่มกดไม่ได้ (canDoStep อ่านจากใบเอง) ⇒ **จอบอกคนผิดว่าใครต้องเซ็น** = คนเดินไปตามผิดคน
   (คลาสเดียวกับ `dtMinBySession` ที่ไม่ส่ง `{lines}` แล้วกะหายเงียบ) */
test('🔧 ส่ง mtnForm เข้าตัวอ่านขั้นที่ไหน ต้องส่ง toolTeam ที่นั่นด้วย', () => {
  const FNS = ['stepMeta', 'stepLabel', 'stepDenyHint', 'stepAssumptions'];
  const bad = [];
  for (const f of walk(join(ROOT, 'src'), ['.js', '.jsx'])) {
    const rel = relative(ROOT, f);
    // เจ้าของกฎเอง + ชั้น util ที่อ่านทีมจากใบให้แล้ว (canDoStep/moWaitMeta) ไม่ต้องมีใครส่งเข้ามา
    if (rel === 'src/utils/mtnStepPerm.js') continue;
    const src = stripComments(readFileSync(f, 'utf8'));
    for (const fn of FNS) {
      /* 🔴 ต้องนับวงเล็บให้สมดุล ห้ามใช้ regex จับถึง `)` ตัวแรก —
         `stepLabel(step, { mtnForm: isMtnFormOrder(order), toolTeam: … })` มีวงเล็บซ้อน
         regex แบบขี้เกียจจะตัดที่ `isMtnFormOrder(order)` แล้วฟ้องผิดทั้งที่ส่ง toolTeam แล้ว */
      const re = new RegExp(`\\b${fn}\\(`, 'g');
      for (const m of src.matchAll(re)) {
        let i = m.index + m[0].length, depth = 1;
        while (i < src.length && depth > 0) {
          const c = src[i];
          if (c === '(') depth++; else if (c === ')') depth--;
          i++;
        }
        const args = src.slice(m.index + m[0].length, i - 1);
        if (/\bmtnForm\b/.test(args) && !/\btoolTeam\b/.test(args)) {
          bad.push(`${rel} → ${fn}(${args.replace(/\s+/g, ' ').slice(0, 70)})`);
        }
      }
    }
  }
  assert.deepEqual(bad, [], '\n\n❌ ส่ง mtnForm แต่ไม่ส่ง toolTeam:\n   ' + bad.join('\n   ') + '\n'
    + '   ทำไม: ขั้น 4 ของใบทีม JIG/DIE เป็นของ "หัวหน้าแผนกช่าง" ไม่ใช่ผู้แจ้ง (27/10)\n'
    + '         ไม่ส่ง toolTeam = จอเขียนชื่อฝั่งผิด ทั้งที่ปุ่มกดไม่ได้ = คนเดินไปตามผิดคน\n'
    + '   แก้: เติม `toolTeam: isToolTeamOrder(o)` ข้างๆ `mtnForm` (เกณฑ์อยู่ที่ utils/mtnMoForm.js)\n');
});

/* ═══ 🔀 "ไลน์หยุดกี่นาที" ต้องหารเลนเสมอ — ห้ามบวก duration_min ดิบ ═══  2026-10-27 · คำสั่ง user
   *"มันไม่ควรนับรวมเป็น 306 นาที สำหรับไลน์ขนาน เพราะความจริงมันคือ 102 นาที"*
   ไลน์เครื่องขนานบันทึก downtime **รายเครื่อง** ⇒ บวกดิบ = นับเหตุการณ์เดียวซ้ำตามจำนวนเลน
   วัด 30 วัน (5 ไลน์ที่ตั้ง parallel_stations): ดิบ 68,137 → ของไลน์ 21,517 นาที (โป่งเกิน ~777 ชม.)
   เคสที่ทำให้รู้: จอ OEE หัวข้อ 1 (%A) หารเลนแล้ว แต่หัวข้อ 2 บวกดิบ ⇒ หน้าเดียวกันขัดกันเอง */
test('🔀 จอที่ตอบ "ไลน์หยุดกี่นาที" ต้องใช้ dtLineMin() ไม่ใช่บวก duration_min เอง', () => {
  /* ไฟล์ที่ย้ายมาใช้ `dtLineMin` แล้ว — **ย้ายไฟล์ไหนเพิ่ม ให้เติมชื่อที่นี่** กันถอยกลับ */
  const MIGRATED = ['src/pages/OEEAnalytics.jsx'];
  for (const rel of MIGRATED) {
    const src = stripComments(readFileSync(join(ROOT, rel), 'utf8'));
    assert.match(src, /\bdtLineMin\s*\(/, `${rel} ต้องรวมนาที downtime ผ่าน dtLineMin()`);
  }
  /* เจ้าของกฎมีไฟล์เดียว — ห้ามใครหาร parallel เองในหน้า */
  const owner = stripComments(readFileSync(join(ROOT, 'src/utils/oee.js'), 'utf8'));
  assert.match(owner, /export const dtLineMin/, 'dtLineMin ต้องอยู่ที่ utils/oee.js');
  const bad = [];
  for (const f of walk(join(ROOT, 'src'), ['.js', '.jsx'])) {
    const rel = relative(ROOT, f);
    if (rel === 'src/utils/oee.js') continue;
    const src = stripComments(readFileSync(f, 'utf8'));
    // หาร duration_min ด้วยจำนวนเลน/สถานีเองในหน้า = เกณฑ์ชุดที่ 2
    if (/duration_min[^;\n]{0,40}\/\s*(parallel|lanes?|stations?|laneN|pN)\b/i.test(src)) bad.push(rel);
  }
  assert.deepEqual(bad, [], '\n\n❌ หารเลนเองใน: ' + bad.join(', ') + '\n'
    + '   แก้: ใช้ dtLineMin(row, laneN) จาก utils/oee.js — เกณฑ์เดียวกับฐานเวลาของ %A\n');
});

/* ═══ ⬜ "จอขาวสนิท" ต้องเป็นไปไม่ได้ — ตาข่ายใน index.html ═══  2026-10-26
   หน้างานแจ้ง: จอขาว **ทั้งคอมและมือถือ** · ไม่มีอะไรบนจอให้กดเลย
   ทำไมถึงขาวสนิท: ถ้าไฟล์ chunk โหลดไม่ได้ (404 หลัง deploy · เน็ตตัด) หรือพังตั้งแต่ตอน import
   ⇒ React ไม่เคยถูกสร้าง ⇒ `RootErrorBoundary` ไม่มีทางทำงาน ⇒ `<div id="root">` ว่างเปล่า
   ⇒ ตาข่ายต้องอยู่ **ใน index.html** เท่านั้น (ทำงานได้แม้โปรแกรมหลักไม่โหลดสักบรรทัด)
   🔴 ปุ่มต้อง "ล้างของเก่า + เปิดใหม่" ไม่ใช่ `reload()` เฉยๆ — reload ธรรมดาได้ index.html
      ตัวเดิมจาก cache = วนขาวซ้ำ (เหตุผลเดียวกับที่หน้างานกด F5 แล้วไม่หาย) */
test('⬜ boot-fallback — จอขาวสนิทต้องเป็นไปไม่ได้ (ตาข่ายใน index.html + ธงจาก main.jsx)', () => {
  const bad = [];
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const main = stripComments(readFileSync(join(ROOT, 'src/main.jsx'), 'utf8'));

  if (!html.includes('id="boot-fallback"')) bad.push('index.html: ไม่มีกล่อง #boot-fallback');
  if (!html.includes('id="boot-retry"')) bad.push('index.html: ไม่มีปุ่มลองใหม่ #boot-retry');
  if (!/__ESM_MOUNTED/.test(html)) bad.push('index.html: ตาข่ายไม่ได้เช็คธง __ESM_MOUNTED');
  /* ต้องจับทั้ง 2 ทาง: ไฟล์โหลดไม่ได้ (error ของ SCRIPT/LINK) + เงียบไปเฉยๆ (ตั้งเวลา) */
  if (!/addEventListener\(\s*'error'/.test(html)) bad.push('index.html: ไม่ดัก error ของ SCRIPT/LINK');
  if (!/setTimeout\(/.test(html)) bad.push('index.html: ไม่มีตัวจับเคส "เงียบแต่ไม่เคย mount"');
  /* 🔴 ปุ่มต้องล้างของเก่าจริง — ห้ามเป็น location.reload() เปล่าๆ */
  if (!/location\.replace\([^)]*fresh=/.test(html)) bad.push('index.html: ปุ่มไม่ได้เปิดใหม่แบบล้างแคช (ต้องมี ?fresh=)');
  /* 🔴 ตาข่ายที่บังจอที่ใช้งานได้ = แย่กว่าไม่มีตาข่าย — ต้องเช็คว่า React วาดอะไรลง #root แล้วหรือยัง */
  if (!/childElementCount/.test(html)) bad.push('index.html: ตาข่ายไม่ได้เช็คว่า #root มีเนื้อหาแล้ว (เสี่ยงบังของจริง)');

  if (!/window\.__ESM_MOUNTED\s*=\s*true/.test(main)) bad.push('main.jsx: ไม่ได้ตั้งธง __ESM_MOUNTED หลัง render');
  const iMount = main.indexOf('__ESM_MOUNTED');
  const iRender = main.indexOf('createRoot(');
  if (iMount >= 0 && iRender >= 0 && iMount < iRender) bad.push('main.jsx: ตั้งธงก่อน render — ต้องตั้งหลัง');

  assert.deepEqual(bad, [], '\n\n❌ ตาข่ายกันจอขาวหาย:\n  ' + bad.join('\n  ')
    + '\n\n   ทำไมสำคัญ: chunk โหลดไม่ได้ = React ไม่เคยขึ้น = RootErrorBoundary ไม่ทำงาน\n'
    + '              หน้างานเห็นจอขาวเปล่าๆ ไม่รู้ว่าพังหรือช้า แล้วกด F5 รัวๆ (ยิ่งซ้ำเติมตอนระบบอ่อนแรง)\n');
});

test('🏭 machine-process-vote-needs-asset-filter — ห้ามโหวต process_type จากทะเบียน machines โดยไม่กรองชนิดสินทรัพย์', () => {
  /* บั๊กจริง 2026-10-27: ตาราง `machines` (DR) เก็บสินทรัพย์ทุกชนิด — เครื่องจักร 226 · แม่พิมพ์ 268
     · จิ๊ก 190 · facility 44 — และ 674/728 แถวมี process_type = 'welding_assembly' (ค่า default
     ที่ไม่มีใครแก้) ⇒ นับรวมทุกชนิด = แม่พิมพ์/จิ๊กโหวตชนะเครื่องจักร
     วัดจริง: HDF1 · HDF2 · LASER-345 · LASER-789 ถูกตีเป็น welding_assembly ทั้งที่เครื่องจักร
     ทั้งหมดเป็น metal_forming ⇒ DailyReport เลือก **นโยบายเวลาพัก** ผิดชุด ⇒ %A/%P ผิดทั้งกะ
     ⇒ ต้องผ่าน processVotingRows() (src/utils/machineAssets.js) เสมอ
     🔴 ยอมรับ `processUnionRows(` ด้วย = "จุดนี้ตั้งใจไม่กรอง" (dropdown ต้องใจกว้าง — ซ่อนผิด
        = หน้างานบันทึกปัญหาจริงไม่ได้ · เคสจริง Line 60 ลง DT metal_forming 10 ใบ ทั้งที่ประเภทนั้น
        มาจากแม่พิมพ์/จิ๊ก) — บังคับให้เลือกข้างอย่างชัดเจน ห้ามปล่อยให้ดูเหมือนลืมกรอง
     หมายเหตุ: จับเฉพาะการ "อ่าน process_type ของแถวที่กรองมาจาก machines" — การแสดงผลรายแถว
     (`machine?.process_type` ในการ์ด/ชิป) ไม่เข้าข่าย เพราะไม่ได้เอามาตัดสินแทนทั้งไลน์ */
  const bad = [];
  for (const file of walk(join(ROOT, 'src'), ['.jsx', '.js'])) {
    if (/machineAssets\.js$/.test(file)) continue;
    const src = stripComments(readFileSync(file, 'utf8'));
    let i = 0;
    for (;;) {
      i = src.indexOf('machines.filter(', i);
      if (i < 0) break;
      const stmt = src.slice(i, i + 400);
      const end = stmt.search(/\)\s*[;,)\n]/);
      const body = end > 0 ? stmt.slice(0, end + 1) : stmt;
      if (/process_type/.test(body)) {
        /* ยอมรับได้เมื่อห่อด้วย processVotingRows( … machines.filter(…) … ) */
        const before = src.slice(Math.max(0, i - 60), i);
        if (!/(machineAssetsOnly|machineLaneCount|processUnionRows)\(\s*$/.test(before)) {
          bad.push(`${file.replace(ROOT, '')}: machines.filter(...process_type...) ไม่ได้ห่อด้วย machineAssetsOnly()`);
        }
      }
      i += 'machines.filter('.length;
    }
  }
  /* 🔴 ชุดที่ 2 — "นับจำนวนเครื่องของไลน์" เอาไปเป็น **ตัวหาร** (เลนของไลน์เครื่องขนาน / ฐาน % Downtime)
     นับจิ๊ก/แม่พิมพ์รวม = ตัวหารใหญ่เกิน = **หักเวลาเสียน้อยกว่าจริง = %A/OEE สูงเกินจริง**
     วัดจริง 27/10: Line D1 9→4 · D3 8→4 · D5 8→5 · D4 5→3 (ส่วนเกินคือจิ๊ก)
     ⇒ ต้องผ่าน machineLaneCount() */
  for (const file of walk(join(ROOT, 'src'), ['.jsx', '.js'])) {
    if (/machineAssets\.js$/.test(file)) continue;
    const src = stripComments(readFileSync(file, 'utf8'));
    /* รูปแบบที่เคยเขียนกันมา: new Set(machines.filter(...).map(m => m.machine_no)).size */
    const re = /new Set\(\s*machines\s*\.filter\([\s\S]{0,220}?machine_no\s*\)\s*\)\s*\.size/g;
    if (re.test(src)) {
      bad.push(`${file.replace(ROOT, '')}: นับเลน/เครื่องต่อไลน์เองจาก machines — ต้องใช้ machineLaneCount()`);
    }
  }
  assert.deepEqual(bad, [], '\n\n❌ โหวต process_type จาก machines โดยไม่กรองชนิดสินทรัพย์:\n  ' + bad.join('\n  ')
    + '\n\n   แก้: import { processVotingRows } from \'<path>/utils/machineAssets\';\n'
    + '        machineAssetsOnly(machines.filter(m => … && m.process_type))\n'
    + '   ทำไม: แม่พิมพ์/จิ๊ก/facility ถือ process_type default ⇒ โหวตชนะเครื่องจักรจริง\n');
});

test('🧩 upsert-mixed-id-needs-default — upsert ที่ปนแถวเดิม/แถวใหม่ ต้องส่ง defaultToNull:false', () => {
  /* เจอ 2 รอบแล้ว (MaterialRequests 19/10 · BbsCheck 27/10 หน้างานแจ้ง "เพิ่มหัวข้อ BBS ไม่สำเร็จ")
     อาการ: `null value in column "id" ... violates not-null constraint` ทั้งที่ตารางมี
     `default gen_random_uuid()` อยู่แล้ว
     สาเหตุ: ส่ง array ที่ **บางแถวมี id บางแถวไม่มี** เข้า upsert ⇒ postgrest สร้าง INSERT ก้อนเดียว
     ด้วย "คอลัมน์รวมของทุกแถว" แล้วเติม NULL ให้แถวที่ขาดคีย์นั้น ⇒ DEFAULT ไม่ถูกใช้ ⇒ ล้มทั้งก้อน
     🔴 ห้ามแก้ด้วยการถอด not-null ของ PK / ยัด id เองจากฝั่ง client
        ⇒ ส่ง { defaultToNull: false } (postgrest `missing=default`)
        หรือแยก insert (แถวใหม่) / upsert (แถวเดิม) คนละคอลแบบ OjtTraining.jsx

     จับเฉพาะรูปที่อันตรายจริง — ต้องครบ 2 อย่าง:
       ① สเปรดแบบ `...(x.id ? { id: x.id } : {})` = แถวนั้น**ยังอยู่ในก้อน**แต่ไม่มี id
          (ถ้าเป็น `: null` แล้ว filter ทิ้ง = ปลอดภัย ไม่เข้าข่าย)
       ② อยู่ในคอลแบ็กของ `.map(` ที่รับตัวแปรนั้นเป็นพารามิเตอร์ = สร้างเป็น "อาร์เรย์หลายแถว"
          (ออบเจกต์เดี่ยวไม่มีปัญหานี้ — คีย์ของมันเองคือคอลัมน์ลิสต์ทั้งหมด เช่น LayerProcessAudit) */
  const bad = [];
  const RE = /\.\.\.\((\w+)\??\.id \? \{ id: \1\??\.id \} : \{\}\)/g;
  for (const file of walk(join(ROOT, 'src'), ['.jsx', '.js'])) {
    const src = stripComments(readFileSync(file, 'utf8'));
    for (const m of src.matchAll(RE)) {
      const ident = m[1];
      const back = src.slice(Math.max(0, m.index - 400), m.index);
      const mapAt = back.lastIndexOf('.map(');
      if (mapAt < 0) continue;                                   // ออบเจกต์เดี่ยว = ปลอดภัย
      const between = back.slice(mapAt);
      if (!new RegExp(`\\b${ident}\\b`).test(between)) continue;  // .map() คนละตัว (บังเอิญอยู่ใกล้)
      if (!src.includes('defaultToNull')) {
        bad.push(`${file.replace(ROOT, '')}: upsert ปนแถวเดิม/ใหม่ (${ident}) แต่ไม่ได้ส่ง { defaultToNull: false }`);
      }
    }
  }
  assert.deepEqual([...new Set(bad)], [], '\n\n❌ upsert ที่ปน id/ไม่มี id จะพังด้วย 23502:\n  ' + bad.join('\n  ')
    + '\n\n   แก้: .upsert(rows, { defaultToNull: false })  ← ให้ postgrest ใช้ default ของคอลัมน์\n'
    + '   หรือแยก insert (แถวใหม่) / upsert (แถวเดิม) คนละคอล แบบ OjtTraining.jsx\n');
});

test('🧭 identity-line-wider — ตัวตนจากฐานพนักงานห้ามบีบ "ไลน์ที่ดูแล" ให้แคบลง', () => {
  /* เคสจริง 27/10 (หน้างานแจ้ง): หัวหน้ากลุ่ม Assembly Line D 2 คน
     `profiles.line_id` = ไลน์แม่ (ไลน์ที่ดูแล · แอดมินตั้งถูกแล้ว)
     `employees.line_id` = ไลน์ลูกที่ตัวเองสังกัด ⇒ กติกา "ตัวตนอ่านจาก employees" ทำให้ของพนักงานชนะ
     ⇒ ครอบครัวไลน์เหลือใบเดียว ⇒ เช็คชื่อ/เปิดกะไลน์ใหญ่/จัดการไลน์ผลิต ทำไม่ได้
     ขัดกฎ "ห้ามคืนน้อยกว่าที่ profiles ตั้งไว้" (CLAUDE.md §สิทธิ์ 3 ชั้น)
     ⇒ แกนไลน์ต้องผ่าน widerLineId() เสมอ (utils/lineHierarchy.js) */
  const app = stripComments(readFileSync(join(ROOT, 'src/App.jsx'), 'utf8'));
  const bad = [];
  if (/line_id:\s*emp\.line_id\s*\?\?/.test(app) && !/widerLineId\s*\(/.test(app)) {
    bad.push('src/App.jsx: เอา employees.line_id มาทับโดยไม่ผ่าน widerLineId()');
  }
  assert.deepEqual(bad, [], '\n\n❌ ' + bad.join('\n  ')
    + '\n\n   หัวหน้าที่ดูแล "ไลน์แม่" แต่ตัวเองสังกัดไลน์ลูก จะถูกบีบเหลือกลุ่มย่อยของตัวเองเงียบๆ\n');
});

/* ═══ 🔗 deep-link-scope-race — "ไม่พบใบที่เลือก" ห้ามขึ้นตอนยังไม่รู้ขอบเขต ═══ 2026-10-28
   เคสจริง (user แจ้ง): กดจากคิวงาน/Dashboard ส่วนงาน → `/report?tab=4&focus=<id>`
   → จอขึ้น "⚠️ ไม่พบใบที่เลือกในรายการนี้" + Man/Machine/Material/Method = 0
   → อีกแป๊บใบก็โผล่มาเอง (ผู้ใช้สรุปว่า "บางทีขึ้นบางทีไม่ขึ้น")
   ต้นเหตุ: `lines` โหลดทีหลัง (loadLinesRes) ⇒ รอบแรก `allowedLineNames` = `[]`
   ⇒ คิวรีกลายเป็น `.in('line_name', ['__none__'])` = 0 แถว · `loading` ก็เริ่ม `false`
   ⇒ **"ยังไม่รู้ขอบเขต" ถูกแปลเป็น "ไม่มีสิทธิ์เห็นอะไรเลย" แล้วประกาศผลทันที**
   ⇒ 3 ค่าต้องแยกกัน: `undefined` ยังไม่รู้ · `[]` รู้แล้วว่าว่าง · `null` ไม่จำกัด */
test('🔗 deep-link-scope-race — FourMTab ต้องรอทะเบียนไลน์ก่อนประกาศว่า "ไม่พบใบ"', () => {
  const src = stripComments(readFileSync(join(ROOT, 'src/pages/Report.jsx'), 'utf8'));
  assert.match(src, /const \[linesLoaded, setLinesLoaded\] = useState\(false\)/,
    'ต้องมีธงว่าทะเบียนไลน์ settle แล้วหรือยัง');
  assert.match(src, /if \(needsLines && !linesLoaded\) return undefined;/,
    '🔴 ยังไม่รู้ขอบเขตต้องคืน undefined ห้ามคืน [] (ซึ่งแปลว่า "ไม่มีไลน์ในขอบเขต")');
  assert.match(src, /if \(allowedLineNames === undefined\) \{ setLoading\(true\); return; \}/,
    '🔴 ยังไม่รู้ขอบเขต = ห้ามยิงคิวรี และต้องคา loading ไว้');
  assert.match(src, /setLinesLoaded\(true\)/, 'โหลดล้มก็ต้องปลดล็อก ไม่งั้นจอค้างหมุนตลอด');
  assert.match(src, /\.finally\(\(\) => setLinesLoaded\(true\)\)/,
    'ต้องตั้งธงใน finally (ทั้งสำเร็จและล้ม) ไม่ใช่เฉพาะ then');
  /* เฟรมแรกต้องเป็น Loader ไม่ใช่ "ไม่มีข้อมูล" — บรรทัดนี้จัดคอลัมน์แบบเฉพาะของ FourMTab */
  assert.match(src, /const \[loading, {5}setLoading\] {5}= useState\(true\);/,
    '🔴 loading ของ FourMTab ต้องเริ่ม true — เริ่ม false = เฟรมแรกประกาศว่าไม่มีข้อมูล');
});

test('🏖️ holiday-break-single-entry — เวลาพักวันหยุด/กฎวันทำงาน ต้องมีชุดเดียว', () => {
  /* 27/10 (คำสั่ง user): วันที่ปฏิทินบอกว่าไม่ใช่วันทำงาน พักเที่ยง 50 → 60 นาที
     🔴 ค่าเป็นของโรงงาน ไม่ใช่ตรรกะ ⇒ อยู่ในทะเบียน `break_policies.duration_min_holiday`
        ห้ามฝังเลขในโค้ด (วันหลังเปลี่ยนเป็น 45/70 จะต้องรอโปรแกรมเมอร์)
     🔴 กฎ "วันไหนคือวันทำงาน" มีชุดเดียว = `isWorkingDayFrom()` ใน utils/workingDay.js
        — ตัวนับวันทำงานในเดือน (companyCalendar) ต้องเรียกตัวเดียวกัน ไม่งั้นตัวนับวัน
          กับการหักเวลาพักจะไม่ตรงกัน แล้วหาไม่เจอว่าจอไหนถูก */
  const bad = [];
  const oee = stripComments(readFileSync(join(ROOT, 'src/utils/oee.js'), 'utf8'));
  if (!/applyHolidayBreaks\s*\(/.test(oee)) bad.push('src/utils/oee.js: ไม่ได้เรียก applyHolidayBreaks()');

  const cal = stripComments(readFileSync(join(ROOT, 'src/utils/companyCalendar.js'), 'utf8'));
  if (!/isWorkingDayFrom\s*\(/.test(cal)) bad.push('companyCalendar.js: countWorkingDaysInMonth ไม่ได้ใช้ isWorkingDayFrom()');
  if (!/setDayTypeMap\s*\(/.test(cal)) bad.push('companyCalendar.js: โหลดปฏิทินแล้วไม่ได้ป้อนให้ workingDay.js');

  /* workingDay.js ต้องบริสุทธิ์ — oee.js import มัน และ oee.js มีเทสที่รันใน node */
  const wd = readFileSync(join(ROOT, 'src/utils/workingDay.js'), 'utf8');
  if (/from\s+['"]\.\.?\/supabaseClient/.test(wd)) bad.push('workingDay.js: ห้าม import supabaseClient (เทสจะพัง)');

  assert.deepEqual(bad, [], '\n\n❌ ' + bad.join('\n  ')
    + '\n\n   หักเวลาพักผิด = ฐานเวลาของ %A/%P ผิดทั้งกะ โดยไม่มีใครเห็นบนจอ\n');
});

test('📤 cross-line-close-guards — ปิดใบข้ามไลน์ต้องผ่านด่านครบ 3 ข้อ', () => {
  /* 30/10 (คำสั่ง user): *"เวลาปิดออเดอร์ให้สแกนจากไลน์ไหนก็ได้ … แค่ให้คอนเฟิร์ม"*
     เปิดทางให้ปิดใบของไลน์อื่น = เปิดช่องผิดพลาด 3 แบบที่ "เงียบ" ทั้งหมด ⇒ ด่านนี้กันของหาย:
     ① `prod_no` ไม่ unique เชิงโครงสร้าง (ของจริง 30/10: LINE A ใช้เลข `35`/`42`/`43`/`45`)
        ⇒ เจอหลายใบต้อง `ambiguous` ให้คนเลือก **ห้ามเดา**
     ② กะเจ้าของใบที่ `pending_close`/`closed` **stamp ยอด/OEE ไปแล้ว** ⇒ ห้ามปิดใบย้อนหลัง
     ③ ปิดใบไลน์อื่น = เขียนข้ามหน่วยงาน · ฝั่ง DR วิ่ง `anon` **ไม่มีด่านฝั่ง DB**
        ⇒ `canWriteLine` ในตัวเขียนเป็นด่านเดียวที่มี
     ④ 03/11 ถอดการกดยืนยันออกตามคำสั่ง user ⇒ ต้องมี `closed_from_line` + ด่าน stale แทน */
  const bad = [];
  const CL = 'src/utils/crossLineClose.js';
  const cl = readFileSync(join(ROOT, CL), 'utf8');
  if (/from\s+['"]\.\.?\/supabaseClient/.test(cl)) bad.push(`${CL}: ห้าม import supabaseClient (ต้อง pure · มีเทส)`);
  const clCode = stripComments(cl);
  if (!/'ambiguous'/.test(clCode)) bad.push(`${CL}: ① หายไป — เลขซ้ำต้องคืน 'ambiguous' ห้ามเดาใบให้`);
  if (!/'shift_locked'/.test(clCode)) bad.push(`${CL}: ② หายไป — กะที่ปิดแล้วต้องคืน 'shift_locked'`);
  /* ⓪ ใบ manual ต้องปิดด้วย "ยอดจริง" (handleManualClose เขียน qty/qty_ok/qty_actual + log + syncPairQty)
     ปิดแบบใบสแกนจะ stamp "เป้า" แทนยอดจริง = OEE + ยอดเข้าคลังเพี้ยนเงียบ */
  if (!/is_manual[\s\S]{0,80}'manual_only_owner'/.test(clCode))
    bad.push(`${CL}: ⓪ หายไป — ใบ is_manual ต้องคืน 'manual_only_owner' ห้ามปิดข้ามไลน์`);
  /* ข้อความพวกนี้ถูกเรนเดอร์เป็น plain text — markdown ที่หลุดมาจะโผล่เป็นตัวอักษรดิบบนจอหน้างาน */
  for (const m of clCode.matchAll(/return\s+`[^`]*\*\*[^`]*`/g))
    bad.push(`${CL}: ข้อความขึ้นจอมี ** (markdown ไม่ถูกเรนเดอร์) — ${m[0].slice(0, 50)}…`);

  /* ตัวเขียนจริงในหน้า — ดู "ในตัวฟังก์ชัน" ไม่ใช่ทั้งไฟล์ (ทั้งไฟล์มี canWriteLine ของแผงอื่นอยู่แล้ว) */
  const DR = 'src/pages/DailyReport.jsx';
  const dr = stripComments(readFileSync(join(ROOT, DR), 'utf8'));
  const fn = dr.match(/const\s+doCrossLineClose\s*=[\s\S]*?\n  \};/);
  if (!fn) bad.push(`${DR}: หา doCrossLineClose ไม่เจอ — เปลี่ยนชื่อแล้วต้องแก้ด่านนี้ด้วย`);
  else {
    const body = fn[0];
    if (!/canWriteLine\s*\(/.test(body)) bad.push(`${DR} doCrossLineClose: ③ ไม่ได้เช็ค canWriteLine — ปิดใบข้ามหน่วยงานได้ฟรี`);
    if (!/unknownTarget:\s*'block'/.test(body)) bad.push(`${DR} doCrossLineClose: ไลน์ที่ผังไม่รู้จักต้อง block (fail-closed)`);
    if (!/crossLineCloseState\s*\(/.test(body)) bad.push(`${DR} doCrossLineClose: ② ไม่ได้เช็คซ้ำตอนกดจริง (การ์ดบนจอเป็นแค่ภาพตอนค้น)`);
    if (!/checkWriteRows\s*\(/.test(body)) bad.push(`${DR} doCrossLineClose: ต้องนับแถว — RLS/แข่งกันปิด = "สำเร็จ 0 แถว ไม่มี error"`);
    if (!/\.eq\(\s*'status'\s*,\s*'open'\s*\)/.test(body)) bad.push(`${DR} doCrossLineClose: ต้อง CAS .eq('status','open') กันปิดซ้ำ`);
    /* 🔄 03/11 (คำสั่ง user): *"ถ้าเป็นยอดงานของ user นั้นรับผิดชอบ อยากให้ไม่ต้องคอนเฟิร์มเลย
       แต่มีการเก็บ log ไว้ตรวจสอบได้"* ⇒ การยืนยันถูกถอด **ความปลอดภัยย้ายไปอยู่ที่ log**
       🔴 ไม่ stamp `closed_from_line` = trigger `trg_prod_order_cross_close_audit` ไม่ยิง
          = ปิดข้ามไลน์ได้ฟรีโดยไม่มีร่องรอยเลย (แย่กว่าตอนมีปุ่มยืนยัน) */
    if (!/closed_from_line\s*:/.test(body))
      bad.push(`${DR} doCrossLineClose: ต้อง stamp closed_from_line — ไม่มี = audit_log ไม่ถูกเขียน (log หายเงียบ)`);
    if (/window\.confirm/.test(body))
      bad.push(`${DR} doCrossLineClose: เอา window.confirm กลับมา — user สั่งถอดออก 03/11 (ด่านคือ canWriteLine + log)`);
  }
  /* 🔴 สแกนปิดข้ามไลน์อัตโนมัติ — 3 เงื่อนไขที่ถอดแล้วพังเงียบ */
  const chg = dr.match(/const\s+handleCloseProdNoChange\s*=[\s\S]*?\n  \};/);
  if (chg && !/hasEnter\s*&&\s*!found[\s\S]{0,120}crossLookup\([^)]*auto:\s*true/.test(chg[0]))
    bad.push(`${DR} handleCloseProdNoChange: Enter จากเครื่องสแกนต้องเรียก crossLookup(v, { auto: true }) — ไม่งั้นทางหลักของคนคุมหลายไลน์ตาย`);
  const look = dr.match(/const\s+crossLookup\s*=[\s\S]*?\n  \};/);
  if (!look) bad.push(`${DR}: หา crossLookup ไม่เจอ — เปลี่ยนชื่อแล้วต้องแก้ด่านนี้ด้วย`);
  else {
    /* ① เลขซ้ำหลายไลน์ (ของจริง LINE A `35`/`42`/`43`/`45`) ห้ามให้ระบบเดาแล้วปิดให้ */
    if (!/auto\s*&&\s*out\.state\s*===\s*'ready'/.test(look[0]))
      bad.push(`${DR} crossLookup: ปิดอัตโนมัติต้องจำกัดที่ state 'ready' เท่านั้น (ambiguous = ให้คนเลือกไลน์)`);
    /* กฎเขียน DB ข้อ 4: สแกนเลขใหม่ทับระหว่างรอผล = ผลเก่าย้อนมาปิดใบที่คนไม่ได้สแกน */
    if (!/crossReqRef\.current/.test(look[0]))
      bad.push(`${DR} crossLookup: ไม่มีด่าน stale (crossReqRef) — ผลค้นของเลขเก่าจะย้อนมาปิดใบอัตโนมัติ`);
  }

  assert.deepEqual(bad, [], '\n\n❌ ' + bad.join('\n  ')
    + '\n\n   ปิดใบผิดไลน์ = ยอด/OEE ของไลน์ที่ไม่เกี่ยวเปลี่ยน โดยไม่มีใครเห็นบนจอ\n');
});

test('🟡 defect-auto-yellow — ลงงานเสียต้องตั้งแท็กเหลือง "รอพิจารณา" ให้เอง + มีจอเคลียร์คิว', () => {
  /* 05/11 (คำสั่ง user): *"พอลงว่ามีงานเสีย ต้องเด้งเข้าถังเหลืองอัตโนมัติเลย เพื่อพิจารณาว่า
     กลับมาดีได้หรือเสียแน่ๆ · หน้าสรุปงานที่ค้างเคลียร์จากรอพิจารณา … ยังไม่มี"*
     🔴 **กฎนี้แทนกฎเดิม** ("ห้ามสร้างใบถังอัตโนมัติ · ต้องมีคนกดยืนยัน" 19/08) — หลักฐานที่ทำให้เปลี่ยน:
        วัด 90 วัน ของเสีย 252 รายการ ผูกใบถังแค่ 46 = 18% · ถังเหลืองทั้งระบบ 1 ใบ
     ⚠️ ไม่แตะ %Q: `suspectState()` ดู `qty_suspect` เท่านั้น ⇒ แท็กจากแถว NG ล้วนไม่ขยับตัวเลขกะ */
  const bad = [];
  const U = 'src/utils/qualityBin.js';
  const u = stripComments(readFileSync(join(ROOT, U), 'utf8'));
  if (!/export function yellowRowFromDefect/.test(u))
    bad.push(`${U}: ต้องมี yellowRowFromDefect() — payload ของแท็กเหลืองมีที่เดียว ห้ามประกอบเองในหน้า`);
  if (!/export function pendingYellow/.test(u))
    bad.push(`${U}: ต้องมี pendingYellow() — กฎ "ยังรอพิจารณา" มีที่เดียว`);
  /* 🔴 ห้ามเดาผลให้ — ไฟล์ payload ต้องไม่ตั้ง qa_decision */
  const yf = u.match(/export function yellowRowFromDefect[\s\S]*?\n\}/);
  if (yf && /qa_decision\s*:/.test(yf[0]))
    bad.push(`${U} yellowRowFromDefect: ห้ามตั้ง qa_decision — ระบบตั้งแท็ก คนตัดสินผล`);

  const DR = 'src/pages/DailyReport.jsx';
  const dr = stripComments(readFileSync(join(ROOT, DR), 'utf8'));
  const fn = dr.match(/const\s+handleAddDefectLog\s*=[\s\S]*?\n  \};/);
  if (!fn) bad.push(`${DR}: หา handleAddDefectLog ไม่เจอ — เปลี่ยนชื่อแล้วต้องแก้ด่านนี้`);
  else {
    const body = fn[0];
    if (!/\.insert\([\s\S]{0,400}\.select\(/.test(body))
      bad.push(`${DR} handleAddDefectLog: insert ต้อง .select() แถวกลับมา (แท็กเหลืองต้องใช้ id + embed)`);
    if (!/yellowRowFromDefect\(/.test(body))
      bad.push(`${DR} handleAddDefectLog: ต้องตั้งแท็กเหลืองผ่าน yellowRowFromDefect() ทุกครั้งที่ลงงานเสีย`);
    /* 🔴 ตั้งแท็กไม่สำเร็จ = บอกให้ไปกดเอง ห้ามเงียบ (งานเสียถูกบันทึกไปแล้ว) */
    if (!/binErr[\s\S]{0,200}toast\.error/.test(body))
      bad.push(`${DR} handleAddDefectLog: ตั้งแท็กเหลืองล้มเหลวต้องขึ้น toast บอกทางแก้ ห้ามล้มเหลวเงียบ`);
  }
  if (!/ยังไม่ลงถัง \{pend\.length\}/.test(dr))
    bad.push(`${DR}: ต้องมีชิปนับ "🗑️ ยังไม่ลงถัง N" บนหัวข้อบันทึกงานเสีย`);

  const Q = 'src/components/QualityBins.jsx';
  const q = stripComments(readFileSync(join(ROOT, Q), 'utf8'));
  if (!/pendingYellow\(/.test(q))
    bad.push(`${Q}: ต้องมีคิว "รอพิจารณา" (pendingYellow) — จุดที่คนเคลียร์ว่ากลับมาดีหรือเสียแน่`);
  /* 10/11 สายแบบใบ MO: "ซ่อมแล้วดี" คลิกเดียว → แตกเป็น ส่งซ่อม (QA) · ลงผลซ่อม (ผลิต) · ตรวจรับ/ตีกลับ (QA) */
  for (const [t, why] of [['งานดี', 'ตรวจแล้วใช้ได้'], ['ส่งซ่อม', 'ขั้น 2 → 3'], ['ลงผลซ่อม', 'ขั้น 3 ฝ่ายผลิต'],
    ['ตรวจรับ', 'ขั้น 4 QA'], ['ตีกลับ', 'ขั้น 4 ไม่ผ่าน → 3'], ['เสียแน่', 'rework ไม่ได้ → ถังแดง']]) {
    if (!q.includes(t)) bad.push(`${Q}: คิวรอพิจารณาต้องมีปุ่ม "${t}" (${why})`);
  }
  /* 🔴 ส่งซ่อมห้ามปิดใบในคลิกเดียว (ลง return_date/repair_date พร้อมผล) — ไม่มีใครตรวจรับงานซ่อมจริง (10/11) */
  const decRep = q.match(/const\s+decide\s*=[\s\S]*?\n  \};/);
  if (decRep && /qa_decision:\s*'repair'[^}]*(return_date|repair_date)/.test(decRep[0]))
    bad.push(`${Q} decide(): "ส่งซ่อม" ห้ามลง repair_date/return_date — ขั้น 3 ผลิตลงผล · ขั้น 4 QA ตรวจรับ`);
  if (!/export function ncStep/.test(u))
    bad.push(`${U}: ต้องมี ncStep() — ขั้นของใบถัง (แบบใบ MO) ตัดสินที่เดียว`);
  /* 🔴 RLS ปฏิเสธ UPDATE = "สำเร็จ 0 แถว ไม่มี error" ⇒ ปุ่มตัดสินต้องนับแถว */
  const dec = q.match(/const\s+decide\s*=[\s\S]*?\n  \};/);
  if (dec && !/checkWriteRows\(/.test(dec[0]))
    bad.push(`${Q} decide(): ต้องใช้ checkWriteRows — RLS ปฏิเสธ UPDATE เงียบ (กฎเขียน DB ข้อ 2)`);
  /* ✍️ ตัดสินผล = เขียนชื่อคนกดลงช่อง QA บนใบ = การเซ็น ⇒ ต้องถามผ่านของกลาง (คำสั่ง user 28/10)
     ห้ามกลับไป window.confirm เขียนข้อความเอง (ต้องบอก 3 อย่าง: อนุมัติอะไร · ใบไหน · ในนามใคร) */
  for (const [re, fname] of [[/const\s+decide\s*=[\s\S]*?\n  \};/, 'decide()'],
                             [/const\s+decideScrap\s*=[\s\S]*?\n  \};/, 'decideScrap()']]) {
    const m = q.match(re);
    if (!m) { bad.push(`${Q}: หา ${fname} ไม่เจอ — เปลี่ยนชื่อแล้วต้องแก้ด่านนี้`); continue; }
    if (!/confirmSign\(/.test(m[0]))
      bad.push(`${Q} ${fname}: ต้องถามยืนยันผ่าน confirmSign() ก่อนเขียน DB`);
    if (/window\.confirm\(/.test(m[0]))
      bad.push(`${Q} ${fname}: ห้ามเขียนข้อความยืนยันเองด้วย window.confirm — ใช้ของกลาง signConfirm.js`);
  }
  assert.deepEqual(bad, [], '\n\n❌ ' + bad.join('\n  ')
    + '\n\n   ของจริงอยู่ในถังแต่ระบบไม่รู้ = สืบกลับไม่ได้ว่าของหายไปไหน\n');
});

test('🔭 scope-copies-swept — จอที่กวาดแล้ว ห้ามกลับไปเขียนสูตรขอบเขตเองในหน้า', () => {
  /* QC audit 09/11: สำเนาสูตร `role === 'leader' && lineId` ที่เขียนเองในหน้า ให้คำตอบ
     **แคบกว่า** ของกลาง (leader ได้ครอบครัวไลน์ล้วน · ไม่รู้จัก `scopeIdx` = แกน Cost Center/ผัง)
     ⇒ กวาดให้เรียกของกลาง `lineScope()` / `scopedLines()` แล้ว · ไฟล์ชุดนี้ห้ามถอยกลับ
     ⚠️ ยังมีจออื่นที่ยังไม่กวาด (ดู `permission-scope-audit.md`) — รายชื่อข้างล่างคือที่กวาดแล้วเท่านั้น */
  const SWEPT = [
    /* รอบ 1 (09/11) */
    'src/pages/ScrapReport.jsx', 'src/pages/MtnAnalysis.jsx', 'src/pages/MaintenanceLevels.jsx',
    'src/pages/MorningMeeting.jsx', 'src/pages/DieRegistry.jsx', 'src/pages/FixtureRegistry.jsx',
    'src/pages/VSM.jsx', 'src/pages/PmForecast.jsx', 'src/pages/WorkforceInsight.jsx',
    'src/pages/ShiftOrganize.jsx', 'src/pages/DailyReport.jsx', 'src/components/QualityBins.jsx',
    /* รอบ 2 (09/11) */
    'src/pages/PmCoordination.jsx', 'src/pages/QrLabels.jsx', 'src/pages/OrderTrace.jsx',
    'src/pages/ProductHistory.jsx', 'src/pages/Dashboard.jsx', 'src/pages/MachineDatabase.jsx',
    'src/pages/EventLog.jsx', 'src/pages/OEEAnalytics.jsx', 'src/pages/OjtTraining.jsx',
    'src/pages/DailyPM.jsx',
    /* รอบ 3 (09/11) — ปิดครบทั้งรีโป ยกเว้น `components/LineSelect.jsx` ซึ่ง **เป็นของกลางเอง** */
    'src/pages/Report.jsx', 'src/pages/Checkin.jsx', 'src/pages/MtnRepair.jsx',
    'src/pages/Improvements.jsx', 'src/pages/ProductionPlan.jsx', 'src/components/WipBetweenSteps.jsx',
  ];
  const bad = [];
  for (const f of SWEPT) {
    const src = stripComments(readFileSync(join(ROOT, f), 'utf8'));
    if (/role === 'leader' && (lineId|userLineId)/.test(src))
      bad.push(`${f}: กลับไปเขียนสูตรขอบเขตเองในหน้า — ต้องเรียก lineScope()/scopedLines() ของกลาง`);
    if (!/lineScope\(|scopedLinesOf\(|scopedLines\(\{/.test(src))
      bad.push(`${f}: ไม่พบการเรียกของกลางเลย — ขอบเขตต้องมาจาก sectionScope.js`);
    /* ส่ง `scopeIdx` ด้วยเสมอ ไม่งั้นแกน Cost Center/ผังตกหมด */
    if (/lineScope\(\{(?![^})]*scopeIdx)/.test(src))
      bad.push(`${f}: เรียก lineScope() โดยไม่ส่ง scopeIdx`);
  }
  /* 🔴 ทั้งรีโปเหลือที่เดียวที่เขียนสูตรนี้ได้ = `components/LineSelect.jsx` (ตัวของกลางเอง)
     ไฟล์ใหม่ที่ก๊อปสูตรไปใช้ จะถูกจับที่นี่ทันที ไม่ต้องรอ audit รอบหน้า */
  const ALLOW = new Set(['src/components/LineSelect.jsx', 'src/utils/sectionScope.js']);   // 2 ไฟล์นี้ = ตัวของกลางเอง
  for (const f of walk(join(ROOT, 'src'), ['.js', '.jsx'])) {
    const rel = f.replace(ROOT + '/', '').replace(/^\/+/, '');
    if (ALLOW.has(rel) || [...ALLOW].some(x => f.endsWith(x))) continue;
    if (/role === 'leader' && (lineId|userLineId)/.test(stripComments(readFileSync(f, 'utf8'))))
      bad.push(`${rel}: เขียนสูตรขอบเขตเองในหน้า — ต้องเรียก lineScope()/scopedLines() ของกลาง`);
  }
  assert.deepEqual(bad, [], '\n\n❌ ' + bad.join('\n  ')
    + '\n\n   "การบีบขอบเขตเป็นการตั้งค่า ไม่ใช่งานของโค้ด" — คืนน้อยกว่าที่ profiles ตั้ง = คนทำงานไม่ได้\n');
});

test('🔐 qbin-writes-layer3 — ทุกจุดที่เขียนถังต้องผ่านด่านชั้น ③ + นับแถว + คิวไม่โกหกตอนโหลดไม่ครบ', () => {
  /* QC audit 09/11 (หมวด B·C·D): ฝั่ง DR เป็น anon ⇒ **จอคือด่านเดียว**
     ช่องเลือกไลน์ที่กรอง scope แล้วไม่ใช่ด่าน (`?scope=` เปิดตรงได้) */
  const bad = [];
  const Q = 'src/components/QualityBins.jsx';
  const q = stripComments(readFileSync(join(ROOT, Q), 'utf8'));
  if (!/const guardLines = \(/.test(q))
    bad.push(`${Q}: ต้องมี guardLines() = canWriteLine + unknownTarget 'block' (ชั้น ③)`);
  if (!/unknownTarget: 'block'/.test(q))
    bad.push(`${Q}: ด่านชั้น ③ ต้องใช้ unknownTarget:'block' (ไลน์ที่ผังไม่รู้จัก = ห้ามเขียน)`);
  for (const fn of ['save', 'toRed', 'decide', 'decideScrap', 'remove']) {
    const m = q.match(new RegExp(`const\\s+${fn}\\s*=\\s*async[\\s\\S]*?\\n  \\};`));
    if (!m) { bad.push(`${Q}: หา ${fn}() ไม่เจอ — เปลี่ยนชื่อแล้วต้องแก้ด่านนี้`); continue; }
    if (!/guardLines\(/.test(m[0])) bad.push(`${Q} ${fn}(): ต้องเช็ค guardLines ก่อนเขียน DB`);
  }
  /* ✍️ ช่อง QA บนใบ = ลายเซ็น — ไม่รู้ชื่อคนกด ห้ามเขียนใบที่ไม่มีชื่อผู้พิจารณา */
  for (const fn of ['decide', 'decideScrap']) {
    const m = q.match(new RegExp(`const\\s+${fn}\\s*=\\s*async[\\s\\S]*?\\n  \\};`));
    if (m && !/guardSigner\(\)/.test(m[0])) bad.push(`${Q} ${fn}(): ต้องเช็ค guardSigner() ก่อนเขียน qa_by`);
  }
  const save = q.match(/const\s+save\s*=\s*async[\s\S]*?\n  \};/);
  if (save && !/checkWriteRows\(/.test(save[0]))
    bad.push(`${Q} save(): UPDATE ต้องนับแถว (RLS ปฏิเสธ = 0 แถวไม่มี error)`);
  /* `.in(ids)` ยาว = URL เกินเพดาน proxy แล้วคืนค่าว่างเงียบ */
  if (/\.in\('id', repIds\)/.test(q))
    bad.push(`${Q}: repIds ยาวได้ถึง 500 ⇒ ต้องผ่าน fetchByIds (chunk) ห้าม .in() ตรงๆ`);
  if (!/fetchByIds\(/.test(q))
    bad.push(`${Q}: ต้องใช้ fetchByIds สำหรับคิวรีที่ส่ง id เป็นชุด`);
  /* ทะเบียนไลน์โหลดไม่ได้ = ขอบเขตไม่ชัด ห้ามเขียนยืนยันว่า "ทั้งโรงงาน" */
  if (!/scopeRes\.unsure/.test(q))
    bad.push(`${Q}: ต้องอ่าน unsure จาก lineScope() มาเขียนบนจอ`);

  const P = 'src/components/MyQueuePanel.jsx';
  const p = stripComments(readFileSync(join(ROOT, P), 'utf8'));
  if (!/binsTruncated/.test(p)) bad.push(`${P}: คิวถังชนเพดาน 200 ต้องติดธง binsTruncated`);
  if (!/redRows\.length < 1000/.test(p))
    bad.push(`${P}: รายการใบแดงชนเพดาน 1000 = ไม่รู้ ⇒ ต้องถือเป็น partial (ของค้างเทียม)`);
  const mq = stripComments(readFileSync(join(ROOT, 'src/utils/myQueue.js'), 'utf8'));
  if (!/binsTruncated[\s\S]{0,80}missing\.push\('bins_truncated'\)/.test(mq))
    bad.push(`src/utils/myQueue.js: binsTruncated ต้องเข้า missing (จอจะได้เขียนว่าโหลดไม่ครบ)`);
  assert.deepEqual(bad, [], '\n\n❌ ' + bad.join('\n  ')
    + '\n\n   ฝั่ง DR ไม่มี RLS จริง — จอปล่อยผ่าน = ใครก็เขียนของหน่วยอื่นได้\n');
});

test('📝 write-honesty — ปิดใบ/ลบของ ต้อง CAS + นับแถว + ไม่ทิ้งใบถังกำพร้า', () => {
  /* QC audit 09/11: จุดที่ "ผลลัพธ์สำคัญ" แต่ยังอ่านแค่ error แล้วขึ้น toast สำเร็จ */
  const bad = [];
  const D = 'src/pages/DailyReport.jsx';
  const d = stripComments(readFileSync(join(ROOT, D), 'utf8'));
  const close = d.match(/const\s+handleManualCloseInner\s*=\s*async[\s\S]*?\n  \};/);
  if (!close) bad.push(`${D}: หา handleManualCloseInner ไม่เจอ`);
  else {
    if (!/\.eq\('status', 'open'\)/.test(close[0]))
      bad.push(`${D} handleManualCloseInner: ต้อง CAS .eq('status','open') — 2 เครื่องกดพร้อมกันทับกันเงียบ`);
    if (!/checkWriteRows\(/.test(close[0]))
      bad.push(`${D} handleManualCloseInner: ต้องนับแถว`);
  }
  const qty = d.match(/const\s+handleManualQtyUpdateInner\s*=\s*async[\s\S]*?\n  \};/);
  if (qty && !/checkWriteRows\(/.test(qty[0]))
    bad.push(`${D} handleManualQtyUpdateInner: ลงยอดผลิตต้องนับแถว`);
  const del = d.match(/const\s+handleDeleteDefectLog\s*=\s*async[\s\S]*?\n  \};/);
  if (!del) bad.push(`${D}: หา handleDeleteDefectLog ไม่เจอ`);
  else {
    /* FK เป็น on delete set null ⇒ ลบเฉยๆ = ใบถังกำพร้าค้างคิวตลอดไป */
    if (!/quality_bin_records/.test(del[0]))
      bad.push(`${D} handleDeleteDefectLog: ต้องจัดการใบถังที่ผูกอยู่ก่อนลบ (FK = on delete set null)`);
    if (!/checkWriteRows\(/.test(del[0]))
      bad.push(`${D} handleDeleteDefectLog: ต้องนับแถวที่ลบจริง`);
  }

  const S = 'src/pages/ScrapReport.jsx';
  const sr = stripComments(readFileSync(join(ROOT, S), 'utf8'));
  if (/from\('scrap_reports'\)\s*\.update\([\s\S]{0,120}\.eq\('id', repId\);/.test(sr))
    bad.push(`${S}: UPDATE หัวใบต้อง .select('id') + checkWriteRows`);
  if (/from\('scrap_reports'\)\.delete\(\)\.eq\('id', rep\.id\);/.test(sr))
    bad.push(`${S}: DELETE ใบต้อง .select('id') + checkWriteRows`);
  if (!/emptyWhy/.test(sr))
    bad.push(`${S}: จอว่างต้องแยก "ไม่มีใบ" / "ไม่มีไลน์ในขอบเขต" / "เช็คไม่ได้" ออกจากกัน`);

  const PM = 'src/pages/ProductMaster.jsx';
  const pm = stripComments(readFileSync(join(ROOT, PM), 'utf8'));
  if (!/function OpStepsPanel\(\{[^)]*guard/.test(pm))
    bad.push(`${PM}: OpStepsPanel ต้องรับ prop guard (กฎชั้น ③ จากหน้าแม่) ไม่ใช่แค่ canEdit`);
  const opSave = pm.match(/function OpStepsPanel[\s\S]*?const remove = async/);
  if (opSave && !/guard\?\.\(/.test(opSave[0]))
    bad.push(`${PM} OpStepsPanel.save(): ต้องเรียก guard ก่อน insert bom_items`);
  assert.deepEqual(bad, [], '\n\n❌ ' + bad.join('\n  ')
    + '\n\n   "สำเร็จ 0 แถว ไม่มี error" คือหน้าตาปกติของ RLS ปฏิเสธ — ไม่นับแถว = จอโกหกทุกครั้ง\n');
});

test('🔴 bin-link-unknown-not-zero — เช็คสถานะ "ลงถังแล้วยัง" ไม่ได้ ห้ามตีเป็น "ยังไม่ลงถัง"', () => {
  /* QC audit 09/11: คิวรี binLinks ล้มแล้ว `setBinLinks({})` ⇒ ชิป "🗑️ ยังไม่ลงถัง N" + ปุ่ม "ลงถัง"
     ⇒ หน้างานกดสร้างใบถังซ้ำกับแท็บเหลืองที่ระบบตั้งอัตโนมัติไว้แล้ว (05/11)
     = **คิวรีล่มแล้วจอชวนให้เขียนข้อมูลผิด** หนักกว่าโชว์ 0 เฉยๆ */
  const bad = [];
  const F = 'src/pages/DailyReport.jsx';
  const raw = readFileSync(join(ROOT, F), 'utf8');
  const src = stripComments(raw);
  const errBranch = src.match(/if \(binErr\)[^\n]*\n?/);
  if (!errBranch) bad.push(`${F}: หาสาขา error ของคิวรี binLinks ไม่เจอ — เปลี่ยนโครงแล้วต้องแก้ด่านนี้`);
  else {
    if (/setBinLinks\(\{\}\)/.test(errBranch[0]))
      bad.push(`${F}: binErr ห้าม setBinLinks({}) — ต้องเป็น null (ไม่รู้) ไม่ใช่ "ยังไม่ลงถังทุกแถว"`);
    if (!/setBinLinks\(null\)/.test(errBranch[0]))
      bad.push(`${F}: binErr ต้อง setBinLinks(null)`);
    if (!/setSessLoadErr/.test(errBranch[0]))
      bad.push(`${F}: binErr ต้องเขียนบนจอผ่าน setSessLoadErr ห้าม console.warn เป็นทางเดียว`);
  }
  /* ฝั่งจอต้องรู้จักค่า "ไม่รู้" ทั้ง 2 จุดที่ใช้ binLinks */
  if (!/if \(!binLinks\) return \(/.test(src))
    bad.push(`${F}: ชิปนับ "ยังไม่ลงถัง" ต้องมีสาขา !binLinks (เขียนว่าเช็คไม่ได้)`);
  if (!/const unknown = !binLinks;/.test(src))
    bad.push(`${F}: ปุ่ม 🗑️ ลงถัง ต้องมีสถานะ unknown — ห้ามเขียนว่า "ลงถัง" ตอนเช็คสถานะไม่ได้`);
  if (/binLinks\[d\.id\]/.test(src) && !/binLinks\?\.\[d\.id\]/.test(src))
    bad.push(`${F}: อ่าน binLinks[d.id] ตรงๆ = พังเมื่อเป็น null — ใช้ optional chaining`);
  assert.deepEqual(bad, [], '\n\n❌ ' + bad.join('\n  ')
    + '\n\n   "ไม่รู้" กับ "ยังไม่ได้ทำ" คนละเรื่อง — ตีรวมกันแล้วจอสั่งให้คนทำงานซ้ำ\n');
});

test('🔴 scrap-report-scope-central — หน้าของเสียต้องตัดขอบเขตด้วย lineScope() ของกลาง', () => {
  /* QC audit 09/11: หน้านี้เขียนสูตร scope เองแล้วได้ผล **แคบกว่า** ที่ profiles ตั้งไว้
     (leader ได้ครอบครัวไลน์ล้วน · ไม่ส่ง scopeIdx) · แท็บถังในหน้าเดียวกันใช้ของกลาง
     ⇒ 2 แท็บตอบขอบเขตคนละชุด · กฎ 26/10: "การบีบขอบเขตเป็นการตั้งค่า ไม่ใช่งานของโค้ด" */
  const bad = [];
  const F = 'src/pages/ScrapReport.jsx';
  const src = stripComments(readFileSync(join(ROOT, F), 'utf8'));
  if (!/lineScope\(\{[\s\S]{0,160}scopeIdx/.test(src))
    bad.push(`${F}: ต้องเรียก lineScope({ … scopeIdx }) — ไม่ส่ง scopeIdx = แกน Cost Center/ผังตกหมด`);
  if (/role === 'leader' && lineId/.test(src))
    bad.push(`${F}: ห้ามเขียนสูตรขอบเขตเองในหน้า (สำเนาที่แคบกว่าของกลาง)`);
  if (/filter\(l => inSectionScope\(/.test(src))
    bad.push(`${F}: ห้ามกรองไลน์ด้วย inSectionScope เอง — ของกลางรู้จักขอบเขตที่ไม่ใช่ "ส่วนงาน" ด้วย`);
  if (!/scopeRes\.unsure/.test(src))
    bad.push(`${F}: ตัดขอบเขตไม่ชัด (unsure) ต้องเขียนบนจอ ห้ามเงียบ`);
  assert.deepEqual(bad, [], '\n\n❌ ' + bad.join('\n  ')
    + '\n\n   คืนน้อยกว่าที่ profiles ตั้งไว้ = คนทำงานไม่ได้ทั้งที่ admin ตั้งสิทธิ์ให้แล้ว\n');
});

test('🟡 bins-in-my-queue — ถังเหลืองรอพิจารณาต้องอยู่ในคิวงาน 2 ชั้น · ห้ามขึ้น badge', () => {
  /* 09/11: เปิดแท็กอัตโนมัติ 4 วัน ตั้งแท็ก 14 ใบ **ตัดสินแล้ว 0** ⇒ กองไม่มีใครถูกดึงไปเคลียร์
     🔴 ชั้น `unit` อย่างเดียวไม่พอ — คนตัดสินคือ QA ซึ่งส่วนงานไม่ตรงไลน์ผลิต จะไม่เห็นอะไรเลย */
  const bad = [];
  const Q = 'src/utils/myQueue.js';
  const q = stripComments(readFileSync(join(ROOT, Q), 'utf8'));
  if (!/need\('bins', src\.bins\)/.test(q))
    bad.push(`${Q}: ต้องรับ bins ผ่าน need() — ส่งไม่ครบต้องติด partial ห้ามเงียบ`);
  if (!/key: 'binpend'[\s\S]{0,200}TIER\.FLOOR/.test(q) && !/TIER\.FLOOR[\s\S]{0,200}key: 'binpend'/.test(q))
    bad.push(`${Q}: ต้องมีบรรทัดสรุปชั้น floor (QA เห็นกองผ่านชั้นนี้ชั้นเดียว)`);
  if (!/key: 'binpend_unit'[\s\S]{0,200}TIER\.UNIT/.test(q))
    bad.push(`${Q}: ต้องมีบรรทัดสรุปของหน่วยเราในชั้น unit`);
  /* 🔴 แตกรายตัว = 14 ใบดันใบซ่อม/4M ของหน่วยงานตกจอ (CAP unit = 6 แถว) */
  if (/key: `bin:\$\{/.test(q))
    bad.push(`${Q}: ห้ามแตกถังเหลืองเป็นรายตัวในคิว — สรุปบรรทัดเดียวต่อชั้น`);
  if (!/binTagAge\(/.test(q))
    bad.push(`${Q}: อายุแท็กต้องอ่านจาก binTagAge() ห้ามเขียนเลขวันซ้ำ (WI-PD3-087 §5.6)`);
  if (/TIER\.MINE[\s\S]{0,160}binpend/.test(q))
    bad.push(`${Q}: ถังเหลืองห้ามเข้าชั้น mine — badge จะเด้งค้างกับคนทั้งโรงงาน`);

  const P = 'src/components/MyQueuePanel.jsx';
  const p = stripComments(readFileSync(join(ROOT, P), 'utf8'));
  if (!/from\('quality_bin_records'\)[\s\S]{0,400}qa_decision/.test(p))
    bad.push(`${P}: ต้องโหลดคิวถังเหลือง (เงื่อนไขเดียวกับ pendingYellow)`);
  if (/from\('quality_bin_records'\)\s*\n?\s*\.select\('\*'\)/.test(p))
    bad.push(`${P}: ห้าม select('*') บนตารางถัง (egress · กฎเขียน DB ข้อ 11)`);
  if (!/secOfLine\.get\(String\(b\.line_name/.test(p))
    bad.push(`${P}: ต้องเติม section จากทะเบียนไลน์ก่อนส่ง bins (ตารางถังไม่มีคอลัมน์ส่วนงาน)`);
  assert.deepEqual(bad, [], '\n\n❌ ' + bad.join('\n  ')
    + '\n\n   ของอยู่ในถังแต่ไม่มีใครถูกดึงไปตัดสิน = กองค้างถาวร\n');
});

test('🏭 qa-bins-queue-only — เอกสารถังเหลือง/แดงอยู่ฝ่ายผลิต · /qa เห็นแค่คิวรออนุมัติ', () => {
  /* 06/11 (คำสั่ง user): *"หลักๆอันนี้ต้องอยู่หมวดของผลิตนะ qa จะไปโชว์แค่พวกงานค้างอนุมัติของแผนก
     เพราะ หลักๆเอกสารอยู่ที่ผลิต"*
     ⇒ บ้าน = `/scrap-report?tab=bins` (NAV หมวด ฝ่ายผลิต) ถือ `mode="full"` (ทะเบียน+ใบ+อายุแท็ก+WI)
       · `/qa?tab=bins` ถือ `mode="queue"` = เฉพาะคิวรอพิจารณา
     🔴 เอาทะเบียน/ปุ่มบันทึกกลับเข้าโหมด queue = "บ้านที่สอง" (UI §4.5 alsoIn: ทางลัด ไม่ใช่บ้านที่สอง)
        แล้วไม่มีใครรู้ว่าใบจริงอยู่หน้าไหน */
  const bad = [];
  const QC = 'src/pages/QualityControl.jsx';
  const qc = stripComments(readFileSync(join(ROOT, QC), 'utf8'));
  if (!/<QualityBins\s+mode="queue"/.test(qc))
    bad.push(`${QC}: แท็บ bins ต้องเรียก <QualityBins mode="queue" /> — QA โชว์แค่คิวรออนุมัติของแผนก`);
  if (/<QualityBins\s*\/>/.test(qc))
    bad.push(`${QC}: ห้ามเรียก <QualityBins /> เปล่า (= โหมด full = ทะเบียนเอกสารมาอยู่ /qa อีกที่)`);

  const SR = 'src/pages/ScrapReport.jsx';
  const sr = stripComments(readFileSync(join(ROOT, SR), 'utf8'));
  if (!/<QualityBins\s+mode="full"/.test(sr))
    bad.push(`${SR}: หน้าฝ่ายผลิตคือบ้านของเอกสาร ต้องเรียก <QualityBins mode="full" />`);

  /* บ้านต้องอยู่หมวดฝ่ายผลิตจริงในเมนู (ย้ายหมวดแล้วด่านนี้ต้องดัง) */
  const app = stripComments(readFileSync(join(ROOT, 'src/App.jsx'), 'utf8'));
  const navLine = app.split('\n').find(l => /to:\s*'\/scrap-report'/.test(l)) || '';
  if (!/group:\s*'ฝ่ายผลิต'/.test(navLine))
    bad.push(`src/App.jsx: /scrap-report ต้องอยู่ group 'ฝ่ายผลิต' — เอกสารของเสียเป็นของผลิต (คำสั่ง user 06/11)`);

  const Q = 'src/components/QualityBins.jsx';
  const q = stripComments(readFileSync(join(ROOT, Q), 'utf8'));
  if (!/const\s+queueOnly\s*=\s*mode\s*===\s*'queue'/.test(q))
    bad.push(`${Q}: ต้องมี queueOnly = mode === 'queue' — โหมดมีที่ตัดสินที่เดียว`);
  const branch = q.match(/if \(queueOnly\) return \(([\s\S]*?)\n  return \(/);
  if (!branch) bad.push(`${Q}: ต้องมีสาขา \`if (queueOnly) return (…)\` ก่อน return ปกติ`);
  else {
    const b = branch[1];
    if (!/renderPendQueue\(\)/.test(b))
      bad.push(`${Q} โหมด queue: ต้องวาดคิวผ่าน renderPendQueue() (แผงเดียวกับหน้าผลิต ห้ามวาดชุดที่ 2)`);
    for (const [re, what] of [[/<TimeRangeBar/, 'แถบกรองช่วงเวลา'], [/<table/, 'ตารางทะเบียน'],
                              [/openNew/, 'ปุ่มบันทึกรายการ'], [/SimpleMasterPanel/, 'ทะเบียน WI ซ่อม']]) {
      if (re.test(b)) bad.push(`${Q} โหมด queue: ห้ามมี${what} — เอกสารตัวจริงอยู่หน้าฝ่ายผลิต`);
    }
    /* 🔴 ลิงก์ที่กดแล้วเด้งกลับ = จอโกหก ⇒ ต้องเช็คสิทธิ์เข้าหน้าก่อนโชว์ลิงก์ */
    if (!/canAccessPage\('\/scrap-report'/.test(b))
      bad.push(`${Q} โหมด queue: ลิงก์ไป /scrap-report ต้องผ่าน canAccessPage() ก่อนโชว์`);
    if (!/scopeNames/.test(b))
      bad.push(`${Q} โหมด queue: ต้องเขียนบนจอว่าคิวนี้เห็นขอบเขตไหน (เห็นแค่ส่วนงานตัวเอง ≠ เคลียร์หมด)`);
  }
  /* คิวในโหมดนี้ไม่ควรโหลดทะเบียนทิ้ง (egress — ตารางกว้าง select('*') × 500 × 2 คิวรี) */
  if (!/if \(queueOnly\) \{[\s\S]{0,600}return;/.test(q))
    bad.push(`${Q} load(): โหมด queue ต้องข้ามคิวรีทะเบียน/ของค้างตามช่วงวันที่ (กฎเขียน DB ข้อ 11)`);
  assert.deepEqual(bad, [], '\n\n❌ ' + bad.join('\n  ')
    + '\n\n   เอกสาร 2 บ้าน = คนกรอกคนละที่ แล้วเถียงกันว่าใบจริงอยู่ไหน\n');
});

test('📊 mat-breakdown-default-collapsed — แท็บ Live ต้องขึ้นภาพรวมก่อน รายชิ้นงานยุบไว้', () => {
  /* 05/11 (คำสั่ง user): *"แยกตามชิ้นงาน default มันเปิดไว้ มันจะรก มันควรจะ default ซ่อนไว้ใน
     ความคืบหน้ารวมทั้งกะ ถ้าจะกดดูรายละเอียดค่อยคลิกจากแถบภาพรวม"*
     ของจริง: SUB APRON 10 MAT.NO ⇒ ต้องเลื่อนผ่าน 10 แท่งกว่าจะเจอตัวเลขรวม ·
     ไลน์ MAT เดียวยิ่งซ้ำ — แท่งเดียวกันโผล่ 2 ที่
     🔴 `liveCollapsed(key, auto)` กับ `toggleLiveCollapse(key, auto)` ต้องส่ง auto ตัวเดียวกัน
        ไม่งั้นคลิกแรก = "ปิดของที่ปิดอยู่แล้ว" (จอไม่ขยับ) — คลาสบั๊กของ API คู่นี้ */
  const bad = [];
  const DR = 'src/pages/DailyReport.jsx';
  const code = stripComments(readFileSync(join(ROOT, DR), 'utf8'));
  if (!/liveCollapsed\(\s*'mat_breakdown'\s*,\s*true\s*\)/.test(code))
    bad.push(`${DR}: "แยกตามชิ้นงาน" ต้อง default ยุบ — liveCollapsed('mat_breakdown', true)`);
  for (const m of code.matchAll(/toggleLiveCollapse\(\s*'mat_breakdown'\s*([^)]*)\)/g)) {
    if (!/,\s*true/.test(m[1]))
      bad.push(`${DR}: toggleLiveCollapse('mat_breakdown') ต้องส่ง true ด้วย — ไม่งั้นคลิกแรกไม่มีอะไรเกิดขึ้น`);
  }
  /* 🔴 ยุบแล้วต้องยังบอกจำนวน (ห้ามซ่อนเงียบ) */
  if (!/แยกตามชิ้นงาน \{productRows\.length\} MAT\.NO/.test(code))
    bad.push(`${DR}: หัวข้อที่ยุบต้องเขียนจำนวน MAT.NO เสมอ (กฎความซื่อสัตย์ของจอ)`);
  /* ภาพรวมต้องมาก่อนรายละเอียด — เทียบตำแหน่งในไฟล์ */
  const iOverview = code.indexOf('ภาพรวมทั้งกะ');   // 05/11: หัวข้อไม่มี emoji แล้ว (UI §6.36)
  const iDetail = code.indexOf('แยกตามชิ้นงาน');
  if (iOverview < 0 || iDetail < 0) bad.push(`${DR}: หาหัวข้อภาพรวม/แยกตามชิ้นงานไม่เจอ — เปลี่ยนข้อความแล้วต้องแก้ด่านนี้`);
  else if (iDetail < iOverview) bad.push(`${DR}: "แยกตามชิ้นงาน" ต้องอยู่ใต้ภาพรวมทั้งกะ ไม่ใช่เหนือ`);
  assert.deepEqual(bad, [], '\n\n❌ ' + bad.join('\n  ')
    + '\n\n   ไลน์ที่มี 10 MAT.NO = ภาพรวมของกะถูกดันตกจอ · 📄 docs/modules/daily-report.md\n');
});

test('📏 dr-order-fold-keeps-alerts — แถวย่อใบผลิต (Live desktop) ต้องยังเห็นสัญญาณเตือน', () => {
  /* 09/11: ใบที่เปิดอยู่ย่อเป็นแถวบรรทัดเดียว (แผงสูง 1,842 → 773px) — ย่อแล้วถ้าตัดป้ายเตือนทิ้ง
     ใบ manual ที่ไม่มีใครอัพเดทยอดเกิน 2.5 ชม. จะหายเงียบจนปิดกะ (เดิมเห็นจากขอบเหลือง + ⚠ บนการ์ด) */
  const DR = 'src/pages/DailyReport.jsx';
  const code = stripComments(readFileSync(join(ROOT, DR), 'utf8'));
  const i = code.indexOf('if (!isOrderExpanded) return (');
  const bad = [];
  if (i < 0) bad.push(`${DR}: หาแถวย่อใบผลิต (if (!isOrderExpanded) return) ไม่เจอ — เปลี่ยนโครงแล้วต้องแก้ด่านนี้`);
  else {
    const row = code.slice(i, code.indexOf('\n                  );', i));
    if (!/manualStale/.test(row)) bad.push(`${DR}: แถวย่อต้องโชว์ ⚠ ยอดไม่อัพเดท (manualStale)`);
    if (!/isCarried/.test(row)) bad.push(`${DR}: แถวย่อต้องโชว์ ➡ ยกยอดมา (isCarried)`);
    if (!/statusLabel/.test(row)) bad.push(`${DR}: แถวย่อต้องโชว์สถานะใบ (statusLabel)`);
  }
  assert.deepEqual(bad, [], '\n\n❌ ' + bad.join('\n  ') + '\n\n   📄 docs/modules/daily-report.md §แท็บ Live — จัดหน้า desktop\n');
});

test('🚨 andon-bar-mobile — แถบ Andon ลอยต้องอ่านออก + กดรับทราบได้บนมือถือ', () => {
  /* 05/11 (mobilesweep @390px ที่ /heijunka): แถบ "📦 ไลน์เรียกของ" เป็น flex แถวเดียว nowrap
     ไอคอน 27 + ชิปเปิดเสียง 99 + ปุ่ม 118 + ปุ่ม 133 = 377px > กล่อง 374px
     ⇒ กล่องข้อความ (flex:1 · min-width:0) **ถูกบีบเหลือกว้าง 0** = เห็นแต่ไอคอนกับปุ่ม
        ไม่รู้ว่าไลน์ไหนเรียกอะไร · Andon ที่อ่านไม่ออก = ไม่มีประโยชน์
     แก้แล้วแถบสูง 62→272px/ใบ ⇒ 3 ใบ = 894px บนจอ 844px **ปุ่มรับทราบใบล่างตกนอกจอ**
     (position:fixed เลื่อนตามไม่ได้) ⇒ มือถือโชว์ทีละใบ + เขียนว่าเหลืออีกกี่ใบ
     📄 docs/UI-CONVENTIONS.md §6.32 */
  const bad = [];
  const css = readFileSync(join(ROOT, 'src/index.css'), 'utf8');
  /* กฎต้องอยู่ใต้ media query มือถือเท่านั้น — จอคอม/TV ห้ามขยับ (ด่าน desktopdiff) */
  const mq = css.match(/@media\s*\(max-width:\s*768px\)\s*\{[\s\S]*?\.andon-bar[\s\S]*?\n\}/);
  if (!mq) bad.push('src/index.css: ไม่มีกฎ .andon-bar ใต้ @media (max-width:768px) — แถบ Andon จะบีบข้อความเหลือ 0 บนมือถือ');
  else {
    if (!/flex-wrap:\s*wrap/.test(mq[0])) bad.push('src/index.css: .andon-bar ต้อง flex-wrap: wrap บนมือถือ');
    /* 🔴 inline style `flex: 1` ของกล่องข้อความชนะ CSS เสมอ — ไม่มี !important = กฎไม่มีผล */
    if (!/\.andon-bar-msg\s*\{[^}]*!important/.test(mq[0]))
      bad.push('src/index.css: .andon-bar-msg ต้องมี !important (inline style flex:1 ชนะ CSS ไม่งั้นข้อความยังถูกบีบ)');
  }
  for (const f of ['src/components/StoreCallSiren.jsx', 'src/components/DowntimeSiren.jsx']) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    const code = stripComments(src);
    if (!/className="dt-alarm-blink andon-bar"/.test(code))
      bad.push(`${f}: แถบ Andon ต้องมี class "andon-bar" (ไม่มี = ข้อความกว้าง 0 บนจอ 390px)`);
    if (!/className="andon-bar-msg"/.test(code))
      bad.push(`${f}: กล่องข้อความต้องมี class "andon-bar-msg"`);
    /* โชว์ทีละใบบนมือถือ + ต้องเขียนว่าเหลืออีกกี่ใบ (ห้ามตัดทิ้งเงียบ) */
    if (!/useIsMobile/.test(code))
      bad.push(`${f}: ต้องจำกัดจำนวนแถบบนมือถือด้วย useIsMobile() — ซ้อนกันหลายใบ = ปุ่มรับทราบตกนอกจอ`);
    if (!/\+ อีก /.test(src))
      bad.push(`${f}: ตัดแถบที่เกินแล้วต้องเขียนบนจอว่า "+ อีก N …" ห้ามหายเงียบ`);
  }
  assert.deepEqual(bad, [], '\n\n❌ ' + bad.join('\n  ')
    + '\n\n   พิสูจน์ 2 ด้านเสมอ: node audit/mobilesweep.mjs (ต้องแก้ 0) + node audit/desktopdiff.mjs (ต้องต่าง 0)\n');
});

test('⛔ downtime-band-central — แถบเครื่องหยุดบนบอร์ดต้องผ่านตัวกลาง + เห็นจริง', () => {
  /* 04/11 (feedback หน้างาน · user): *"ปริ้น Tag มายิงประมาณพันกว่า แต่พอมาปิดแท็ก
     มันเรียงไม่ต่อเนื่องกัน"* → *"ต่อให้รับยอดมาจากการยกยอด มันก็ต้องเรียงต่อกันได้ดิ"*
     ของจริง (Assy GOR กะเช้า 03/11): ใบ**เรียงชิดกันอยู่แล้ว** · ช่องว่าง = downtime 180 นาที
     ที่หน้างานลงใบไว้เอง (ตรงกับ %A 82%) — แต่บอร์ดวาดเป็น**ขีดสูง 4-5px ชิดขอบบน**
     ⇒ บนจอ TV มองไม่เห็น = ช่องว่างกลายเป็น "รูโหว่ที่ไม่มีคำอธิบาย" แล้วถูกเข้าใจว่าโปรแกรมพัง
     ⇒ ด่านนี้กัน 2 เรื่อง: (ก) กลับไปวาดเองในหน้า (2 จอจะเพี้ยนไม่ตรงกันอีก)
        (ข) กลับไปเป็นขีดบางๆ ที่ `top:0` + `height` คงที่ */
  const bad = [];
  const U = 'src/utils/downtimeBands.js', C = 'src/components/DowntimeBand.jsx';
  for (const f of [U, C]) {
    if (!existsSync(join(ROOT, f))) { bad.push(`${f}: หายไป — ตัวกลางของแถบ downtime ห้ามถูกลบ`); }
  }
  if (!bad.length) {
    const comp = stripComments(readFileSync(join(ROOT, C), 'utf8'));
    /* ① ต้องอยู่ใต้ใบกัมบัง — ใบงานคือของหลักของบอร์ด */
    if (!/zIndex:\s*0\b/.test(comp)) bad.push(`${C}: ต้อง zIndex 0 (ใต้ใบกัมบัง) — ทับใบงานคือสิ่งที่ห้ามที่สุด`);
    /* แถบต้องเต็มความสูงแถว ไม่ใช่ขีดบางๆ อย่างเดิม */
    if (!/bottom:\s*0\b/.test(comp)) bad.push(`${C}: ต้องเต็มความสูงแถว (top+bottom 0) — ขีดบาง 4-5px คือต้นเหตุที่หน้างานอ่านไม่ออก`);
    /* ③ งานตามแผน (PM) ไม่ใช่ปัญหา ⇒ ต้องแยกสีจากของเสีย */
    if (!/w\.planned/.test(comp)) bad.push(`${C}: ต้องแยกสี downtime ตามแผน (PM) ออกจากของเสีย — กฎ "งานตามแผนไม่ใช่ปัญหา"`);
    /* ④ จอ TV: ฟอนต์ขั้นต่ำ 11 (ด่าน font-min-11 ไม่เห็นค่าที่คำนวณ runtime) */
    if (!/Math\.max\(\s*11\s*,/.test(comp)) bad.push(`${C}: ฟอนต์ป้ายต้องมีพื้น Math.max(11, …) — จอ TV ห้ามต่ำกว่า 11px`);
  }
  /* (ก) จอที่วาดบอร์ดห้ามประกอบแถบ downtime เองอีก */
  for (const f of ['src/pages/Dashboard.jsx', 'src/pages/Management.jsx']) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    const code = stripComments(src);
    if (!/downtimeBandsIn\s*\(/.test(code) || !/<DowntimeBand\b/.test(code))
      bad.push(`${f}: ต้องวาด downtime ผ่าน downtimeBandsIn() + <DowntimeBand> (2 จอต้องเหมือนกันเป๊ะ)`);
    /* ขีดบางๆ แบบเดิม: key `dt-` + สี downtime ดิบ ๆ ในหน้า */
    if (/key=\{`dt-\$\{di\}`\}[\s\S]{0,400}height:\s*\d/.test(code))
      bad.push(`${f}: กลับไปวาดแถบ downtime เป็นขีดความสูงคงที่ในหน้า — ต้องใช้ <DowntimeBand>`);
  }
  assert.deepEqual(bad, [], '\n\n❌ ' + bad.join('\n  ')
    + '\n\n   ช่องว่างบนบอร์ดที่ไม่มีคำอธิบาย = หน้างานสรุปเองว่า "โปรแกรมพัง" ทั้งที่เป็นเวลาที่เครื่องหยุดจริง\n');
});

test('☕ break-policy-cols-central — เลือกคอลัมน์ break_policies เองต้องใช้ชุดกลาง', () => {
  /* 27/10: เพิ่มคอลัมน์ `duration_min_holiday` (นาทีพักวันหยุด) แล้วพบว่ามี 6 จุด
     เลือกคอลัมน์เองไว้ ⇒ จอพวกนั้นจะคิดเวลาพักวันหยุดเป็นค่าปกติ ขณะที่จอหลักคิดค่าวันหยุด
     = **ตัวเลข OEE 2 ชุดของกะเดียวกัน** (สิ่งที่ user สั่งว่าห้ามมี: "เลขเรื่องเดียวกันต้องคิดเหมือนกัน")
     ⇒ ต้อง `select('*')` หรือ `select(BREAK_POLICY_COLS)` เท่านั้น — เพิ่มคอลัมน์ใหม่เติมที่เดียว */
  const bad = [];
  for (const file of walk(join(ROOT, 'src'), ['.jsx', '.js'])) {
    if (/oeeMasters\.js$/.test(file)) continue;
    const src = stripComments(readFileSync(file, 'utf8'));
    for (const m of src.matchAll(/from\(\s*'break_policies'\s*\)\s*\.select\(\s*([^)]+?)\s*\)/g)) {
      const arg = m[1].trim();
      if (arg !== "'*'" && arg !== '"*"' && arg !== 'BREAK_POLICY_COLS') {
        bad.push(`${file.replace(ROOT, '')}: select(${arg.slice(0, 60)}…) — ใช้ BREAK_POLICY_COLS แทน`);
      }
    }
  }
  assert.deepEqual(bad, [], '\n\n❌ เลือกคอลัมน์ break_policies เอง:\n  ' + bad.join('\n  ')
    + "\n\n   import { BREAK_POLICY_COLS } from '<path>/utils/oeeMasters';\n"
    + '   ขาดคอลัมน์ = จอนั้นหักเวลาพักคนละแบบกับจออื่น = OEE 2 ชุดของกะเดียวกัน\n');
});

/* 🛡️ line-registry-load-visible (2026-10-28 · เคสจริง หัวหน้า PD1)
   หน้างานแจ้ง *"ไม่มีไลน์ให้เลือกในลิสต์"* — ไล่แล้วไม่ใช่เรื่องสิทธิ์ (RLS select ของ
   `production_lines` = `true` · ขอบเขตของบัญชีนั้นคืนครบทุกไลน์เมื่อรันกับผังจริง)
   ต้นเหตุคือ `loadLinesRes()` เคยคืน `error: null` ตายตัว แล้วจอเขียน `setLines(data || [])`
   ⇒ อ่านทะเบียนพลาด = ลิสต์ว่าง **เงียบ** = จอบอกว่า "ไม่มีไลน์" ทั้งที่แปลว่า "อ่านไม่ได้"
   (กฎเขียน DB ข้อ 12: `catch {}` แล้วโชว์ "ไม่มีข้อมูล" = จอโกหก)
   ⇒ ด่าน 2 ชั้น: util ต้องคืน error จริง · จอต้องไม่ทับลิสต์เดิมด้วยผลที่ล้มเหลว */
test('🛡️ line-registry-load-visible — ลิสต์ไลน์ว่างต้องแยก "ไม่มีของ" ออกจาก "อ่านไม่ได้"', () => {
  const bad = [];
  const util = stripComments(readFileSync(join(ROOT, 'src/utils/useProductionLines.js'), 'utf8'));
  if (/loadLinesRes\s*=\s*async\s*\(\)\s*=>\s*\(\{[^}]*error:\s*null/.test(util))
    bad.push('useProductionLines.loadLinesRes (กลับไปคืน error: null ตายตัว — จอแยกไม่ออกว่าว่างเพราะอะไร)');
  if (!/masterLoadState\(/.test(util))
    bad.push('useProductionLines.loadLinesRes (ไม่ได้อ่านผลล้มจาก masterLoadState — error จะไม่มีวันถูกตั้ง)');

  for (const f of walk(join(ROOT, 'src'), ['.js', '.jsx'])) {
    const src = stripComments(readFileSync(f, 'utf8'));
    if (!/loadLinesRes\s*\(/.test(src)) continue;
    /* แกะผลโดยไม่เอา error ออกมาเลย = กลืนความล้มเหลวซ้ำรอยเดิม */
    if (/const\s*\{\s*data\s*\}\s*=\s*await\s+loadLinesRes\s*\(/.test(src))
      bad.push(`${relative(ROOT, f)} (แกะแค่ { data } จาก loadLinesRes — อ่านพลาดแล้วลิสต์ว่างเงียบ)`);
    /* 🔴 30/10 — รอบแรกด่านนี้จับแค่รูป `const { data } = await loadLinesRes()` ⇒ **หลุด**
       รูปที่หน้างานเจอจริง: เรียกใน `Promise.all` แล้วแกะเป็น array
       (`const [{ data: ln }, …] = await Promise.all([ loadLinesRes(), … ])`)
       หน้างาน PD1 แจ้ง 30/10 "MO ไม่มีให้เลือกไลน์" ทั้งที่ฐานข้อมูลมี 5 ไลน์ของ PD1 ครบ
       ⇒ จับเพิ่ม: หา `Promise.all([…])` ที่มี `loadLinesRes()` อยู่ในอาร์เรย์ แล้วดูว่า
         ตัวแปรฝั่งซ้าย **ตำแหน่งเดียวกัน** ถูกแกะเป็น `{ … }` (= ทิ้ง error) หรือไม่
       🔴 ห้ามเปลี่ยนเป็นกฎหยาบ "ไฟล์ไหนเรียกต้องมี .error" — เคยลองแล้วเหมาไป 15+ ไฟล์
         ที่ยังไม่ได้กวาด (ดู §หนี้ที่เหลือ ใน docs/modules/mtn-work-order.md) ⇒ ด่านจะเขียวไม่ได้เลย */
    const splitTop = (txt) => {              // แยก , ชั้นบนสุด (ข้าม () [] {} และสตริง)
      const out = []; let d = 0, q = '', cur = '';
      for (const ch of txt) {
        if (q) { cur += ch; if (ch === q) q = ''; continue; }
        if (ch === '"' || ch === "'" || ch === '`') { q = ch; cur += ch; continue; }
        if ('([{'.includes(ch)) d++;
        if (')]}'.includes(ch)) d--;
        if (ch === ',' && d === 0) { out.push(cur); cur = ''; continue; }
        cur += ch;
      }
      out.push(cur); return out;
    };
    for (const m of src.matchAll(/const\s*\[([^\]]*)\]\s*=\s*await\s+Promise\.all\(\s*\[/g)) {
      const lhs = splitTop(m[1]);
      // หาเนื้อในวงเล็บของ Promise.all แบบนับวงเล็บ (array literal อาจมี [] ซ้อน)
      let i = m.index + m[0].length, d = 1, body = '';
      for (; i < src.length && d > 0; i++) {
        const ch = src[i];
        if (ch === '[') d++;
        if (ch === ']') { d--; if (!d) break; }
        body += ch;
      }
      const args = splitTop(body);
      args.forEach((a, idx) => {
        if (!/loadLinesRes\s*\(/.test(a)) return;
        if (/mrows\s*\(/.test(a)) return;                    // โยน error ต่อ = ถูกแล้ว
        const el = lhs[idx] ?? '';
        if (/^\s*\{/.test(el) && !/\berror\b/.test(el))   // แกะ `{ data, error }` ไว้แล้ว = ถูกแล้ว
          bad.push(`${relative(ROOT, f)} (loadLinesRes ใน Promise.all ตำแหน่งที่ ${idx + 1} ถูกแกะเป็น { … } ไม่เอา error — หล่นหาย)`);
      });
    }
  }
  assert.deepEqual(bad, [], '\n\n❌ ' + bad.join('\n   ') + '\n'
    + '   ทำไม: จอบอก "ไม่มีไลน์" ทั้งที่ไลน์ยังอยู่ครบ — หน้างานสรุปว่าไลน์ถูกลบ\n'
    + '   แก้: const { data, error } = await loadLinesRes() · error = คงลิสต์เดิม + เขียนบนจอ ห้าม setLines([])\n');
});

/* ═══ 👨‍🔧 "หัวหน้างานของไลน์" = หลายคน/หลายกะ — ห้ามกลับไปใช้ head_name ช่องเดียว (2026-10-28) ═══
   คำพูด user: *"ไลน์นึง มีหัวหน้าได้ 2-3 คน แล้วแต่ว่ามีกี่กะการทำงาน บางที่ 1 กะ บางที่ 2 กะ บางที่ 3 กะ"*
   วัดจริง 28/10 (13 ไลน์ที่กรอก `production_lines.head_name` ไว้): ช่องเดียวถูกกรอกเป็น **3 ความหมายปนกัน**
     หัวหน้าแผนก 3 · หัวหน้าไลน์ของกะเช้า 3 · ชื่อที่จับคู่ทะเบียนพนักงานไม่ได้เลย 6 (สะกดมือ)
   ⇒ แหล่งความจริง = ทะเบียนพนักงาน (position + team + line_id) ผ่าน `lineHeadsOf()` ที่เดียว
   ด่านนี้กันการถอยกลับ 2 ทาง: จอเลิกเรียก lineHeadsOf · auto-fill กลับไปอ่าน head_name ตรงๆ */
test('👨‍🔧 line-heads-single-source — จอตั้งค่าไลน์ + ใบค่าฝีมือ ต้องอ่านหัวหน้างานผ่าน lineHeadsOf()', () => {
  const bad = [];
  for (const f of ['src/pages/LineSetup.jsx', 'src/pages/Report.jsx']) {
    const code = stripComments(readFileSync(join(ROOT, f), 'utf8'));
    if (!/lineHeadsOf\s*\(/.test(code)) bad.push(`${f} (ไม่ได้เรียก lineHeadsOf)`);
    /* auto-fill ชื่อหัวหน้าจาก head_name ตรงๆ = กลับไปเดาคนเดียวต่อไลน์
       (ยังอ่าน head_name ได้ แต่ต้องส่งเข้า lineHeadsOf เป็น `legacyName` เท่านั้น) */
    if (/setSignerHead\(\s*lineObj\?\.head_name/.test(code))
      bad.push(`${f} (setSignerHead อ่าน head_name ตรงๆ)`);
  }
  const util = stripComments(readFileSync(join(ROOT, 'src/utils/lineHeads.js'), 'utf8'));
  /* กะต้องมาจากตารางกะจริง ห้ามเดาจากตัวอักษรทีม (กฎเดียวกับ shiftAssign ทั้งระบบ) */
  if (!/shiftFromTeam\s*\(/.test(util)) bad.push('lineHeads.js (ไม่ได้ใช้ shiftFromTeam — เดากะเอง?)');
  if (/['"]A['"]\s*(===|==)\s*team|team\s*(===|==)\s*['"]A['"]/.test(util))
    bad.push('lineHeads.js (เทียบทีม A ตรงๆ = เดาว่า A คือกะเช้า)');
  /* ── 🔴 2 ทะเบียนตอบคนละคำถาม (28/10 รอบ 2) ─────────────────────────────────────
     "ดูแลไลน์ไหน" = widerLineId(profiles, employees) — ไม่ใช้ = ไลน์แม่ที่หัวหน้าสังกัดไลน์ลูก
     จะขึ้นว่า "ไม่มีหัวหน้า" ทั้งที่มี (เคสจริง Assembly Line D) */
  if (!/widerLineId/.test(util)) bad.push('lineHeads.js (ไม่ได้ใช้ widerLineId — ขอบเขตไลน์ผิด)');
  /* "เป็นหัวหน้าไหม" ต้องตัดสินด้วย levelOfPosition ของ employees เท่านั้น
     role ของบัญชี = ชุดสิทธิ์ใช้ระบบ ไม่ใช่ตำแหน่งงาน (กฎ CLAUDE.md §Role System) */
  if (!/levelOfPosition\s*\(/.test(util))
    bad.push('lineHeads.js (ไม่ได้ตัดสินตำแหน่งจาก levelOfPosition)');
  if (/picked\s*=\s*profiles|profiles\.filter\([^)]*role[^)]*\)\s*\.map\(.*=>.*rows/.test(util))
    bad.push('lineHeads.js (เอา profiles.role มาเป็นตำแหน่งงาน — role คือชุดสิทธิ์ ไม่ใช่ตำแหน่ง)');
  /* ที่ 2 ทะเบียนไม่ตรงกันต้องฟ้อง ห้ามเงียบ */
  if (!/conflicts/.test(util)) bad.push('lineHeads.js (ไม่มี conflicts — ข้อมูลไม่ตรงกันแล้วเงียบ)');
  /* 🔑 จับคู่บัญชี↔พนักงาน ต้องใช้ FK `profiles.employee_id` ก่อน ชื่อเป็นท่าสุดท้าย
     (กฎ CLAUDE.md: ทะเบียนที่จับคู่ด้วย "ข้อความ" คือกับดัก — มี FK ให้ใช้ ต้องใช้ FK)
     เคยพลาด: "ณัฐพล  คำผาง" เว้น 2 เคาะ จับไม่ติด = หัวหน้าหายทั้งไลน์ */
  if (!/employee_id/.test(util)) bad.push('lineHeads.js (ไม่ได้ใช้ profiles.employee_id — จับคู่ด้วยชื่อล้วน)');
  for (const f of ['src/pages/LineSetup.jsx', 'src/pages/Report.jsx']) {
    const code = stripComments(readFileSync(join(ROOT, f), 'utf8'));
    /* เจาะเฉพาะคิวรี "บัญชีหัวหน้า" (กรอง role leader/supervisor) — หน้าเดียวกันมีคิวรี profiles อื่นด้วย */
    for (const q of code.match(/from\(\s*['"]profiles['"]\s*\)[\s\S]{0,200}?\['leader',\s*'supervisor'\]/g) || []) {
      if (!/employee_id/.test(q))
        bad.push(`${f} (คิวรีบัญชีหัวหน้าไม่ได้ดึง employee_id ⇒ ถอยไปจับคู่ด้วยชื่อเงียบๆ)`);
    }
  }
  for (const f of ['src/pages/LineSetup.jsx', 'src/pages/Report.jsx']) {
    const code = stripComments(readFileSync(join(ROOT, f), 'utf8'));
    if (!/lineHeads\.conflicts/.test(code)) bad.push(`${f} (ไม่ได้เขียน conflicts บนจอ)`);
    if (!/headScopeLineIds\s*\(/.test(code))
      bad.push(`${f} (คิวรีพนักงานไม่ได้ใช้ headScopeLineIds — ไลน์ลูกไม่ถูกดึง หัวหน้าหาย)`);
  }

  assert.deepEqual(bad, [], '\n\n❌ ' + bad.join(', ') + '\n'
    + '   ทำไม: `production_lines.head_name` เป็นข้อความช่องเดียว ⇒ ตอบ "ใครเป็นหัวหน้ากะไหน" ไม่ได้\n'
    + '   แก้: lineHeadsOf({ lineId, lines, employees, maps, legacyName }) จาก src/utils/lineHeads.js\n'
    + '        head_name ส่งเป็น legacyName ได้อย่างเดียว (ชื่อที่พิมพ์ทับ) ห้ามเป็นแหล่งหลัก\n');
});

/* ═══ 🏭 line-registry-empty-is-not-truth — cache ซ้อน cache ห้ามจด "ลิสต์ว่าง" เป็นของจริง ═══ 28/10
   เคสจริง (หน้างานแจ้งในไลน์ 20:50): *"วันนี้เป็นของ600 ครับ เปิดกะไม่ได้ครับ · 250 ตัน ใช้งานได้ปกติ"*
   ช่อง "ไลน์การผลิต" ในโมดัลเปิดกะ **ว่างเปล่า** และไม่มีอะไรบนจอบอกว่าทำไม
   ลูกโซ่:
     1. `loadProductionLines()` ล้ม → `cachedMaster` กลืน error คืน `[]` (ถูกแล้วตามสัญญาของมัน)
     2. `loadLinesRes()` ห่อเป็น `{ data: [], error: null }` = **"สำเร็จ แต่ว่าง"**  ← ตรงนี้คือจุดโกหก
     3. หน้าเอาไปใส่ `cachedMaster('production_lines:dr', …)` อีกชั้น ⇒ ชั้นนอกคิดว่าสำเร็จ
        แล้ว **`lsWrite([])` ลง localStorage อายุ 4 ชม.**
     ⇒ เครื่องนั้นเปิดกะไม่ได้ยาว 4 ชม. ส่วนเครื่องอื่นปกติ = "บางคนได้ บางคนไม่ได้"
   กฎ: **helper ที่ห่อ cache ชั้นในต้องส่งต่อความล้ม** ไม่งั้นชั้นนอกจดความว่างนั้นเป็นข้อเท็จจริง */
test('🏭 line-registry-empty-is-not-truth — loadLinesRes ต้องส่งต่อความล้ม ไม่ใช่ error:null เสมอ', () => {
  const src = stripComments(readFileSync(join(ROOT, 'src/utils/useProductionLines.js'), 'utf8'));
  assert.doesNotMatch(src, /export const loadLinesRes = async \(\) => \(\{[^}]*error: null[^}]*\}\);/,
    '\n\n❌ loadLinesRes คืน `error: null` เสมอ = ชั้นนอกจะจดลิสต์ว่างลง localStorage 4 ชม.\n'
    + '   แก้: เช็ค masterLoadState(KEY) แล้วคืน error เมื่อล้มและไม่มีของเก่าให้ใช้\n');
  assert.match(src, /masterLoadState\(KEY\)/, 'ต้องอ่านธงล้มของ cache ชั้นในก่อนบอกว่าสำเร็จ');
  assert.match(src, /error: fail \? new MasterLoadError\(fail\) : null/,
    'ต้องคืน error จริงให้ชั้นนอกแยก "อ่านไม่สำเร็จ" ออกจาก "ว่างจริง" (mrows จะ throw ต่อให้เอง)');

  /* ฝั่งจอ: ลิสต์ว่างต้องเขียนบนจอว่าเพราะอะไร + ปุ่มเปิดกะต้องกดไม่ได้ */
  const dr = stripComments(readFileSync(join(ROOT, 'src/pages/DailyReport.jsx'), 'utf8'));
  assert.match(dr, /const openableLines = useMemo/, 'ชุดไลน์ของช่องเลือกต้องคิดที่เดียว ใช้ร่วมทั้ง dropdown · คำเตือน · ปุ่ม');
  assert.match(dr, /pickerLines\(lines, \{ role, lineId: userLineId, sections: scopeSecs, scopeIdx \}\)/,
    '🪧 ลิสต์ของช่องเลือกต้องมาจากของกลาง (fail-open) ห้ามเอา Set ขอบเขตมากรองเอง');
  /* 🔴 ลิสต์ที่เห็นเป็น fail-open ⇒ **ด่านจริงต้องอยู่ตอนเขียน** ไม่งั้นเปลี่ยนค่าใน dropdown = เปิดกะข้ามไลน์ */
  assert.match(dr, /if \(openScopeLineNames && !openScopeLineNames\.has\(openForm\.line_name\)\)/,
    '🔴 handleOpenSession ต้องเช็คขอบเขตซ้ำก่อน insert (กฎสิทธิ์ชั้น ③)');
  assert.match(dr, /!openableLines\.length && \(/, '🔴 ลิสต์ว่างต้องขึ้นเหตุผลบนจอ ห้ามปล่อยช่องเปล่าเงียบ');
  assert.match(dr, /disabled=\{!openForm\.line_name \|\| openingSession \|\| !openableLines\.length\}/,
    '🔴 ไม่มีไลน์ให้เลือก = ปุ่มเปิดกะต้องกดไม่ได้ (กดแล้วเงียบ = คนไม่รู้ว่าติดตรงไหน)');
  /* 🔄 ปุ่มโหลดใหม่ต้องล้าง cache **ชั้นนอก** ของหน้านี้ด้วย ไม่งั้นได้ลิสต์ว่างเดิม
     🔴 09/11 — เลิกเช็คว่าหน้านี้พิมพ์คีย์เอง (`invalidateMaster('production_lines:dr')`)
        การพิมพ์คีย์ที่จุดเรียก **คือ**ต้นเหตุที่ทะเบียนค้างที่ `:v2` มา 4 สัปดาห์
        ⇒ เช็คที่เจตนาแทน: หน้านี้ล้างผ่านของกลาง + ทะเบียนของกลางครอบคีย์ชั้นนอกครบ */
  assert.match(dr, /invalidateProductionLines\(\);\s*\n\s*load\(\);/,
    'ปุ่มโหลดใหม่ของหน้าเปิดกะต้องล้างผ่านของกลาง (invalidateProductionLines)');
  const invSrc = stripComments(readFileSync(join(ROOT, 'src/utils/masterInvalidate.js'), 'utf8'));
  for (const k of ['production_lines:dr', 'production_lines:flow']) {
    if (!invSrc.includes(`'${k}'`))
      assert.fail(`ทะเบียน masterInvalidate ขาดคีย์ชั้นนอก '${k}' — ปุ่มโหลดใหม่จะได้ลิสต์ว่างเดิม`);
  }
});

test('🛡️ notify-no-insert-per-recipient — ห้าม insert `notifications` ทีละคนในลูป', () => {
  /* บั๊กที่เคยเกิดจริง 26/10/2026 (branch 4M ใน supabase/functions/send-notification):
     โค้ดเขียนว่า `Promise.allSettled(unique.map(t => supabase.from('notifications').insert({...})))`
     = ผู้รับ 79 คน ⇒ **79 รอบวิ่งไป DB ต่อการเปลี่ยนสถานะ 1 ครั้ง** และเพราะเป็นการเขียนทีละแถว
     มันเลยไม่มีจุดไหนเห็นภาพรวมพอจะกันซ้ำได้เลย

     ผลที่วัดได้: ใบ 4M **ใบเดียว** สถานะ pending ได้ 316 แถว / 79 คน = คนละ 4 ใบ ใน 16 วินาที
     (edge ถูก invoke 4 รอบจากฝั่งจอ · ตัวมันยุบผู้รับซ้ำได้แค่ภายในรอบเดียว ข้ามรอบไม่รู้เรื่องกัน)
     วันนั้นตาราง notifications โตวันเดียว 44,570 แถว = 75% ของทั้งตาราง (12 MB)

     🔑 กฎนี้บังคับ "เขียนเป็นก้อน" ซึ่งเป็นเงื่อนไขที่ทำให้ **กันซ้ำได้จริง** — ก้อนเดียว
        = กรองผู้รับก่อนเขียนได้ทีเดียว (ดู withoutRecentSame / withoutUnreadFor) */
  const hits = [];
  for (const f of [...walk(join(ROOT, 'src'), ['.js', '.jsx']),
                   ...walk(join(ROOT, 'supabase/functions'), ['.ts'])]) {
    const src = stripComments(readFileSync(f, 'utf8'));
    // Promise.all / allSettled ที่มี insert ลง notifications อยู่ข้างใน = เขียนทีละคน
    const re = /Promise\.(?:all|allSettled)\(([\s\S]{0,400}?)\)\s*\)?\s*[;,)]/g;
    let m;
    while ((m = re.exec(src))) {
      const body = m[1];
      if (/from\(\s*['"`]notifications['"`]\s*\)[\s\S]{0,120}?\.insert\(/.test(body)) {
        hits.push(relative(ROOT, f));
        break;
      }
    }
  }
  assert.deepEqual(hits, [],
    '\n\n❌ ไฟล์ด้านล่าง insert ลงตาราง `notifications` ทีละคนในลูป (Promise.all/allSettled)\n'
    + '   ทำไมพัง: 1 เหตุการณ์ × ผู้รับ N คน = N รอบวิ่งไป DB · และกันแจ้งเตือนซ้ำไม่ได้เลย\n'
    + '   (เกิดจริง 26/10/2026: ใบ 4M ใบเดียวได้ 316 แถว/79 คน ใน 16 วินาที เพราะ edge ถูกเรียก 4 รอบ\n'
    + '    วันนั้น notifications โตวันเดียว 44,570 แถว = 75% ของทั้งตาราง)\n'
    + '   แก้ยังไง: รวมผู้รับเป็น array แล้ว `.insert(ids.map(uid => ({...})))` ครั้งเดียว\n'
    + '        และกรองคนที่เพิ่งได้ไปแล้วออกก่อนเขียน (withoutRecentSame / withoutUnreadFor)\n\n'
    + hits.map(h => '   • ' + h).join('\n') + '\n');
});

/* ═══ 🔭 leader-scope-no-silent-fallopen — ชี้ไลน์ไม่ได้ ห้ามกลายเป็น "เห็นทั้งโรงงาน" ═══ 28/10
   เคสจริง (หัวหน้าไลน์ LWR แจ้ง 21:15): *"กลายเป็นเห็นของทุกไลน์ แต่เปิดกะเลือกไลน์ตัวเองไม่ได้"*
   ข้อมูลบัญชีเขาถูกต้องครบ (role=leader · line_id ตรงกันทั้ง profiles/employees · sections=[PD4])
   ต้นเหตุเดียว = **ทะเบียนไลน์ในเครื่องว่าง** แล้วโค้ด 2 ที่ตอบคนละทาง:
     · รายการกะ   `if (myLine) {กรอง}` — **ไม่มี else** ⇒ หาไลน์ไม่เจอ = ไม่กรองเลย = เห็นทั้งโรงงาน
       ซ้ำร้าย ตาข่ายส่วนงานข้างล่างเขียน `role !== 'leader'` ⇒ หัวหน้ากลุ่มไม่มีด่านสักชั้น
     · ช่องเลือกไลน์ `getLineFamilyNames(lines, id)` ⇒ ว่าง = เลือกไม่ได้
   ⇒ สาเหตุเดียว อาการตรงข้าม (fail-open ฝั่งดู · fail-closed ฝั่งเลือก) — หาต้นเหตุยากมาก
   กฎ: **"ยังตัดสินขอบเขตไม่ได้" ห้ามแปลว่า "ไม่จำกัด"** · ถอยไปแกนที่กว้างรองลงมา + เขียนบนจอ */
test('🔭 leader-scope-no-silent-fallopen — กรองด้วยไลน์ไม่ได้ ต้องถอยไปส่วนงาน ไม่ใช่ปล่อยผ่าน', () => {
  const src = stripComments(readFileSync(join(ROOT, 'src/pages/DailyReport.jsx'), 'utf8'));
  assert.match(src, /let scopedByLine = false;/,
    'ต้องมีธงว่า "กรองด้วยไลน์สำเร็จไหม" — ไม่งั้นแยก "ไม่มีไลน์" ออกจาก "ไม่จำกัด" ไม่ได้');
  assert.match(src, /if \(!scopedByLine && scopeSecs\.length\)/,
    '🔴 ตาข่ายส่วนงานต้องครอบหัวหน้ากลุ่มที่ชี้ไลน์ไม่ได้ด้วย ห้ามเขียน `role !== \'leader\'`');
  assert.doesNotMatch(src, /if \(role !== 'leader' && scopeSecs\.length\)/,
    '🔴 เงื่อนไขเดิมกันหัวหน้ากลุ่มออกจากตาข่าย = ไม่มีด่านสักชั้นเมื่อทะเบียนไลน์ว่าง');
  /* ⚠️ เช็ค "เจตนา" ไม่ใช่สตริงเป๊ะ — 09/11 ย้ายมาใช้ของกลาง `lineScope()` แล้วธง unsure
     กว้างขึ้น (ครอบเคส "ทะเบียนไลน์โหลดไม่สำเร็จ" ของ role อื่นด้วย) ซึ่งเป็น superset ของเดิม */
  const su = src.match(/setScopeUnsure\(([^;]*)\);/);
  assert.ok(su, 'ต้องจำไว้ว่ารอบนี้ตัดสินขอบเขตไม่ได้');
  assert.match(su[1], /!scopedByLine/,
    '🔴 ธง unsure ต้องผูกกับ "กรองด้วยไลน์ไม่สำเร็จ" ไม่งั้นแยกจาก "ไม่จำกัด" ไม่ได้');
  assert.match(su[1], /unsure|role === 'leader' && !!userLineId/,
    'ต้องครอบเคสหัวหน้ากลุ่มที่ชี้ไลน์ตัวเองไม่ได้ (และ/หรือ unsure จากของกลาง)');
  assert.match(src, /\{scopeUnsure && \(/,
    '🔴 รายการกว้างกว่าที่ควร = ต้องเขียนบนจอ ห้ามให้คนเข้าใจว่าได้สิทธิ์ดูทุกไลน์แล้ว');
});

/* ═══ 🪪 link-suggest-must-check-taken — ห้ามเสนอผูกพนักงานที่ถูกจองไปแล้ว ═══ 2026-10-28
   เคสจริง (หน้างาน 21:19): กดปุ่ม "ผูกได้เลย" แล้วเด้ง error ดิบจาก Postgres
   `duplicate key value violates unique constraint "profiles_employee_id_uniq"` ×2
   ต้นเหตุ: `employeeCandidates()` จับคู่จาก**ชื่อ**อย่างเดียว ไม่รู้ว่าพนักงานคนนั้น
   ถูกบัญชีอื่นผูกไปแล้ว ⇒ จอเสนอทางที่ **ล้มเหลวแน่นอน 100%**
   ("ธวัช  พิมพ์วงศ์" มี 2 บัญชี ต่างกันแค่จำนวนช่องว่าง — ตัวหนึ่งผูกแล้ว อีกตัวยังค้าง)
   🔴 ซ่อนคนที่ถูกจองออกไม่ได้ — จอจะบอก "ไม่มีชื่อนี้ในทะเบียนพนักงาน" ซึ่งไม่จริง
      ⇒ ต้องโชว์ + ติดป้ายว่าใครถืออยู่ + ไม่นับเป็น "ผูกได้เลย" */
test('🪪 link-suggest-must-check-taken — คนที่ถูกผูกแล้วต้องไม่ถูกเสนอเป็น "ผูกได้เลย"', async () => {
  const m = await import('../identityMatch.js');
  const emps = [{ id: 'e1', name: 'ธวัช  พิมพ์วงศ์', is_active: true }];
  const users = [
    { id: 'a', full_name: 'ธวัช พิมพ์วงศ์', employee_id: 'e1' },
    { id: 'b', full_name: 'ธวัช  พิมพ์วงศ์', employee_id: null },
  ];
  const row = m.unlinkedTriage(users, emps).queue.find(x => x.u.id === 'b');
  assert.equal(row.confident, false, '🔴 คนที่ถูกจองแล้วห้ามเป็น "ผูกได้เลย" (กดแล้วชน unique แน่นอน)');
  assert.equal(row.rows.length, 1, 'ต้องยังโชว์ — ซ่อน = จอบอก "ไม่มีชื่อนี้ในทะเบียน" ซึ่งไม่จริง');
  assert.ok(row.rows[0].takenByName, 'ต้องติดป้ายว่าบัญชีไหนถืออยู่');
  assert.equal(m.routeHint(row).key, 'taken', 'ป้ายบนจอต้องบอกว่าถูกผูกไปแล้ว ไม่ใช่ "ผูกได้เลย"');
  /* คนที่ยังว่าง = พฤติกรรมเดิมเป๊ะ */
  const free = m.unlinkedTriage([{ id: 'c', full_name: 'ก ข', employee_id: null }],
    [{ id: 'e9', name: 'ก ข', is_active: true }]).queue[0];
  assert.equal(free.confident, true, 'คนที่ยังไม่ถูกจอง ต้องยังเสนอ "ผูกได้เลย" เหมือนเดิม');

  /* ฝั่งจอ: เช็คก่อนเขียน + แปล error ดิบเป็นภาษาคน */
  const au = stripComments(readFileSync(join(ROOT, 'src/pages/AddUser.jsx'), 'utf8'));
  assert.match(au, /const holder = users\.find\(x => x\.employee_id === emp\.id && x\.id !== u\.id\)/,
    '🔴 ต้องเช็คก่อนเขียนว่าพนักงานคนนี้ถูกบัญชีอื่นถืออยู่ไหม');
  assert.match(au, /res\?\.error\?\.code === '23505'/,
    '🔴 ชนแม้เช็คแล้ว (จอถือรายชื่อเก่า) ต้องบอกให้รีเฟรช ห้ามโชว์ error ดิบของ Postgres');
});

/* ═══ 🧹 logout-clears-master-cache — "ออกจากระบบแล้วเข้าใหม่" ต้องเป็นทางแก้จริง ═══ 28/10
   คำพูด user: *"Logout แล้ว login ใหม่หายมั้ย · incognito หน้างานไม่เข้าใจ แย่ๆ"* — ถูกต้อง
   เดิม logout ไม่ล้าง cache ทะเบียนกลางเลย ⇒ ของพิษ (ลิสต์ไลน์ว่างที่ถูกจดไว้ 4 ชม.) ยังค้าง
   ⇒ ทางแก้เดียวที่เหลือคือ "เปิด incognito" ซึ่ง**หน้างานทำตามไม่ถูก**
   ⇒ ต้องมีประโยคเดียวที่ทุกคนทำได้: ออกจากระบบ → เข้าใหม่ */
test('🧹 logout-clears-master-cache — logout ต้องล้าง cache ทะเบียนกลางของเครื่องนั้น', () => {
  const mc = stripComments(readFileSync(join(ROOT, 'src/utils/masterCache.js'), 'utf8'));
  assert.match(mc, /export function clearAllMasterCache\(\)/, 'ต้องมีตัวล้าง cache ทั้งเครื่อง');
  assert.match(mc, /cache\.clear\(\);[\s\S]{0,60}failures\.clear\(\);/,
    'ล้างทั้ง memory และธงล้ม ไม่งั้นรอบหน้ายังถือสถานะเดิม');
  const app = stripComments(readFileSync(join(ROOT, 'src/App.jsx'), 'utf8'));
  const i = app.indexOf('clearAllMasterCache();');
  assert.ok(i > 0, '🔴 handler logout ต้องเรียก clearAllMasterCache()');
  assert.ok(app.indexOf("auth.signOut({ scope: 'local' })", i) - i < 200,
    'ต้องล้างก่อน signOut ในก้อนเดียวกัน (ล้างทีหลัง = navigate ไปแล้ว)');
});

/* ═══ 🕵️ account-activity-never-vs-unknown — "ไม่เคยเข้า" ≠ "อ่านไม่ได้" ═══ 29/10
   คำถาม user: *"บัญชีของคน คนไหนไม่มีการเข้าใช้เลยบ้าง · admin ดู last login ได้มั้ย
                  จะได้ลบหรือปิดถูก"*
   จอนี้เป็นจอที่ใช้ตัดสิน **ลบ/ปิดบัญชี** ⇒ เดาผิดข้างเดียวก็ลบบัญชีที่คนใช้อยู่ทุกวัน
   `get_auth_users()` เป็น admin-only ⇒ คนที่เข้าหน้านี้ได้แต่ไม่ใช่ admin จะไม่ได้ค่านี้เลย
   ⇒ undefined (ไม่รู้) ต้องไม่ถูกบีบเป็น null (ไม่เคยเข้า) ด้วย `|| null` เด็ดขาด */
test('🕵️ account-activity-never-vs-unknown — ห้ามบีบ "อ่านไม่ได้" เป็น "ไม่เคยเข้าใช้"', () => {
  const act = stripComments(readFileSync(join(ROOT, 'src/utils/accountActivity.js'), 'utf8'));
  assert.match(act, /lastSignInAt === undefined/, 'ต้องแยกเคส undefined ออกมาก่อน');
  assert.match(act, /lastSignInAt === null/,      'ต้องแยกเคส null ออกมาก่อน');
  assert.doesNotMatch(act, /Date\.now\(\)/,
    '🔴 ห้ามอ่านนาฬิกาในไฟล์กฎ — ต้องรับ now เข้ามา (ด่าน "นาฬิกา +400 วัน")');

  const au = stripComments(readFileSync(join(ROOT, 'src/pages/AddUser.jsx'), 'utf8'));
  assert.doesNotMatch(au, /last_sign_in_at:[^,\n]*\|\|\s*null/,
    '🔴 `last_sign_in_at: … || null` = undefined กลายเป็น "ไม่เคยเข้าใช้" ⇒ ชวนลบบัญชีที่ยังใช้อยู่');
  // 05/11 เกิดจริง: migration ที่เติมคอลัมน์ยังไม่ apply ⇒ RPC คืนแถวที่ "ไม่มีคีย์" ⇒ `?? null` ตีเป็น "ไม่เคยเข้า" ทั้งจอ
  assert.doesNotMatch(au, /last_sign_in_at:[^,\n]*\?\?\s*null/,
    '🔴 `last_sign_in_at: … ?? null` — คีย์ที่ไม่มาในแถว (migration ยังไม่ลง) ต้องเป็น undefined = "อ่านไม่ได้" ไม่ใช่ "ไม่เคยเข้า"');
  assert.match(au, /'last_sign_in_at' in authMap\[p\.id\]/,
    'ต้องเช็คว่าแถวมีคีย์ last_sign_in_at จริงก่อนอ่านค่า');

  // 🗑️ ลบบัญชีที่มีประวัติผูก (FK NO ACTION) — edge ตอบ 409 + blockers · จอต้องเขียนว่าติดอะไร ห้ามกลืนเป็น "ลบไม่สำเร็จ"
  assert.match(au, /res\.status === 409 && Array\.isArray\(data\.blockers\)/,
    '🔴 handleDelete ต้องรับ 409/blockers จาก edge delete-user แล้วเปิดแผงโอนประวัติ (edge-functions.md §delete-user)');
  const delFn = readFileSync(join(ROOT, 'supabase/functions/delete-user/index.ts'), 'utf8');
  assert.match(delFn, /fn_profile_ref_blockers/, '🔴 delete-user ต้องถาม fn_profile_ref_blockers ก่อนลบ');
  assert.match(delFn, /fn_profile_reassign_refs/, '🔴 delete-user ต้องโอนประวัติผ่าน fn_profile_reassign_refs ฝั่ง DB ห้ามไล่ตารางเอง');
  assert.match(au, /activityOf\(u\.last_sign_in_at/,
    'คอลัมน์ต้องตัดสินผ่าน activityOf() ห้ามเทียบวันเองในหน้า');
  assert.match(au, /ACT_UNKNOWN \? '—'/,
    'อ่านไม่ได้ต้องขึ้นขีด ไม่ใช่ข้อความที่อ่านเหมือน "ไม่เคยเข้า"');
});

/* ═══ 🔭 line-scope-two-answers — "เห็นไลน์ไหน" ต้องมีคำตอบเดียว ═══ 29/10 (คำสั่ง user "ทำข้อ1")
   คำพูด user: *"ทำไมปัญหานี้มันแก้ไม่จบไม่สิ้นซักที"* · *"เห็นของทุกไลน์ แต่เปิดกะเลือกไลน์ตัวเองไม่ได้"*
   วัดได้จริงก่อนแก้ (29/10): บัญชีเดียวกัน หัวหน้าไลน์ลูก + sections=[ส่วนงานตัวเอง]
     scopedLines()     → ไลน์ตัวเอง + ไลน์แม่ + ไลน์อื่นในส่วนงาน   (ช่องเลือกไลน์ ~20 จอ)
     scopedLineNames() → ไลน์ตัวเองไลน์เดียว                        (กรองข้อมูล  ~22 จอ)
   ⇒ กฎ 26/10 ("ไลน์ตัวเอง ∪ ส่วนงานที่กำกับ") ถูกใส่ไว้ที่ scopedLines ตัวเดียว อีกตัวไม่ได้ตาม
   ⇒ ยุบให้ทั้งคู่เป็น wrapper ของ lineScope() · ห้ามแตกกลับเป็น 2 ตรรกะอีก
   📄 เทสเชิงพฤติกรรม (ยิงเคสเดียวกันเข้า 2 ทาง) = src/utils/__tests__/lineScopeOneAnswer.test.mjs */
test('🔭 line-scope-two-answers — scopedLines/scopedLineNames ต้องเป็น wrapper ของ lineScope()', () => {
  const src = stripComments(readFileSync(join(ROOT, 'src/utils/sectionScope.js'), 'utf8'));
  assert.match(src, /export function lineScope\(/, 'ต้องมีแกนเดียว lineScope()');

  const body = (name) => {
    const i = src.indexOf(`export function ${name}(`);
    assert.ok(i > 0, `หา ${name} ไม่เจอ`);
    // หยุดที่ "ฟังก์ชันถัดไป" ตัวใดก็ได้ ไม่ใช่แค่ที่ export (ไม่งั้นลากตัวช่วยที่อยู่ติดกันมาด้วย)
    const ends = [src.indexOf('\nexport ', i + 10), src.indexOf('\nfunction ', i + 10)]
      .filter(x => x > 0);
    return src.slice(i, ends.length ? Math.min(...ends) : undefined);
  };
  for (const fn of ['scopedLines', 'scopedLineNames']) {
    const b = body(fn);
    assert.match(b, /lineScope\(/, `🔴 ${fn} ต้องเรียก lineScope() ห้ามคิดขอบเขตเอง`);
    assert.doesNotMatch(b, /getLineFamilyNames\(/,
      `🔴 ${fn} ไล่ครอบครัวไลน์เองอีกแล้ว = แตกเป็น 2 ตรรกะ ⇒ บั๊กเรื้อรังกลับมา`);
    assert.doesNotMatch(b, /inSectionScope\(/,
      `🔴 ${fn} กรองส่วนงานเองอีกแล้ว = แตกเป็น 2 ตรรกะ`);
  }
  /* ✅ 29/10 user สั่งยุบเป็นท่าเดียว ("ให้เห็นส่วนงานตัวเองทุกจอ")
     ⇒ scopedLineNames ต้อง **ไม่** ขอท่า 'own' อีก · แยกกลับ = ต้องถาม user ใหม่
     (พฤติกรรมจริงถูกคุมที่ scopeRegistryGate ข้อ E ซึ่งเล่นกับทะเบียนผู้ใช้จริง) */
  assert.doesNotMatch(body('scopedLineNames'), /scope: 'own'/,
    '🔴 scopedLineNames กลับไปใช้ท่า own = แยก 2 ประตูอีกครั้งโดยไม่ถาม user');
  // ธง unsure ต้องมีอยู่ ไม่งั้น "ตัดขอบเขตไม่ได้" จะกลับไปเงียบเหมือนเดิม
  assert.match(src, /unsure/, '🔴 ต้องคง unsure ไว้ให้จอเขียนบนจอ');
  assert.match(src, /registry_unloaded/, 'ทะเบียนยังไม่โหลดต้องแยกเหตุผลไว้');
  assert.match(src, /own_line_unknown/, 'หาไลน์ตัวเองไม่เจอต้องแยกเหตุผลไว้');
});

/* ═══ 🏭 line-registry-never-silent — ทะเบียนไลน์ล้ม ต้องมีจอบอกเสมอ ═══ 30/10 (หน้างานแจ้ง 29/10)
   *"มันกรองไลน์ไม่ได้ครับ"* · *"แจ้งซ่อม MO JIG เลือกไลน์ผลิตไม่ได้ค่ะ ไม่มีข้อมูล"*
   ตรวจแล้วไม่ใช่เรื่องสิทธิ์ — RLS ของ production_lines เปิดให้ทุกคนที่ login อ่าน (select = true)
   ต้นเหตุ: `loadLinesRes()` คืน `{ data, error }` แต่ **82 จาก 89 จุดเรียกทิ้ง error ทิ้ง**
   ⇒ โหลดล้ม = dropdown ไลน์ว่างพร้อมกันทั้งแอป โดยไม่มีจอไหนบอกเหตุ ⇒ หน้างานอ่านว่า "ไม่มีข้อมูล"
   ⇒ ไล่แก้ทีละจอไม่มีวันครบ ⇒ ตาข่ายต้องอยู่ที่เดียวใน App.jsx และห้ามถอด */
test('🏭 line-registry-never-silent — ต้องมีตาข่ายกลางบอกว่าทะเบียนไลน์โหลดไม่สำเร็จ', () => {
  const alert = stripComments(readFileSync(join(ROOT, 'src/components/LineRegistryAlert.jsx'), 'utf8'));
  assert.match(alert, /useProductionLinesState\(\)/, 'ต้องถามสถานะจากทะเบียนกลาง ไม่ใช่เดาเอง');
  assert.match(alert, /registryFailText\(/, 'ข้อความต้องมาจากของกลาง ห้ามแต่งเองในหน้า');
  assert.match(alert, /if \(loading \|\| !failed\) return null;/,
    '🔴 ระหว่างโหลดห้ามขึ้น (แถบกะพริบทุกครั้งที่เปลี่ยนหน้า) · ไม่ล้มก็ห้ามขึ้น');
  assert.match(alert, /reload\(\)/, 'ต้องมีปุ่มโหลดใหม่ — แจ้งเฉยๆ แล้วทำอะไรไม่ได้ = จอตัน');

  const app = stripComments(readFileSync(join(ROOT, 'src/App.jsx'), 'utf8'));
  assert.match(app, /<LineRegistryAlert \/>/, '🔴 ตาข่ายกลางหายจาก App.jsx');
  assert.match(app, /import LineRegistryAlert from/, 'ต้อง import จริง');
});

test('🏷️ edition-alias-safe — import `appEdition` ต้องไม่มีนามสกุล และห้ามเรียกตัว .nm ตรงๆ', () => {
  /* why: เว็บ New Model = โค้ดชุดเดียวกับ ESM แต่ `vite.nm.config.js` สลับไฟล์ตอน build ด้วย
          alias `/^(.*)\/appEdition$/` — **จับเฉพาะ path ที่ไม่มีนามสกุล**
          · เขียน `'../appEdition.js'` = alias ไม่จับ ⇒ บิลด์ NM ได้รุ่นเต็ม = ไม่มีด่านกันหน้าเลย
            (เว็บ IEC เปิดจอระบบแมสได้ทั้งหมด — พังแบบไม่มีอะไรฟ้อง build ยังผ่าน)
          · เขียน `'./appEdition.nm'` ตรงๆ = บิลด์**หลัก**ได้ allowlist ของ NM ⇒ หน้าหายจากระบบแมส
     fix: import จาก `'<path>/appEdition'` เท่านั้น (ไม่มี `.js` ไม่มี `.nm`)
          · ต้องการค่าของรุ่น NM ในเทส ให้ import ไฟล์ตรงได้ (โฟลเดอร์ `__tests__` ไม่ถูกสแกน) */
  const bad = [];
  for (const f of walk(join(ROOT, 'src'), ['.js', '.jsx'])) {
    const rel = relative(ROOT, f);
    if (/appEdition(\.nm)?\.js$/.test(rel)) continue;        // ตัวไฟล์ edition เอง
    const code = stripComments(readFileSync(f, 'utf8'));
    for (const m of code.matchAll(/from\s*['"]([^'"]*appEdition[^'"]*)['"]/g)) {
      const spec = m[1];
      if (spec.endsWith('/appEdition')) continue;            // ถูกต้อง — alias จับได้
      bad.push(`${rel}  →  '${spec}'`);
    }
  }
  assert.deepEqual(bad, [], '\n\n❌ import `appEdition` ผิดรูป ' + bad.length + ' จุด\n'
    + '   ทำไมสำคัญ: alias ของ vite.nm.config.js จับเฉพาะ path ที่ลงท้าย `/appEdition` (ไม่มีนามสกุล)\n'
    + '              ใส่ `.js` = เว็บ NM ได้รุ่นเต็ม (เปิดจอระบบแมสได้) · ใส่ `.nm` = เว็บแมสได้ allowlist ของ NM (หน้าหาย)\n'
    + '   แก้: เขียน import เป็น \'<path>/appEdition\' เท่านั้น\n'
    + `   จุดที่ผิด:\n     ${bad.join('\n     ')}\n`);

  /* ด่านคู่: ตัว alias ต้องยังอยู่ใน config ของ NM (ถอดออก = เว็บ NM กลายเป็นเว็บแมสเงียบๆ) */
  const nmc = readFileSync(join(ROOT, 'vite.nm.config.js'), 'utf8');
  assert.match(nmc, /appEdition\$\/[\s\S]{0,80}appEdition\.nm/,
    '\n\n❌ vite.nm.config.js ไม่มี alias appEdition → appEdition.nm แล้ว — เว็บ NM จะเปิดได้ทุกหน้าของระบบแมส\n');
});

test('🗑️ ojt-delete-needs-sign-url — ประตู "ลบใบที่เปิดผิด" ต้องรู้ว่ามีใครเซ็นแล้วหรือยัง', () => {
  /* why (01/11 · หน้างาน PD4 ขอ "เปิดผิดลบได้ด้วย"): ใบ OJT = FM-HRM-004 เอกสารคุมเล่มที่
     auditor ขอดู ⇒ เปิดให้เจ้าของใบลบเองได้**เฉพาะใบที่ยังไม่มีใครเซ็น** (ของที่เซ็นแล้ว =
     หลักฐานการอบรมของพนักงานคนนั้น ลบแล้วกู้ไม่ได้ — ต้องเป็นระดับจัดการเท่านั้น)
     กับดัก: ตัวตัดสิน `sheetSigned()` อ่าน `sign_url` ที่ติดมากับคิวรีรายการ
       ⇒ ใครรีดคิวรีให้เหลือ `ojt_training_attendees(id)` (ของเดิมก่อน 01/11) = ทุกใบดู "ยังไม่มีใครเซ็น"
         ⇒ ปุ่มลบโผล่บนใบที่เซ็นครบแล้ว **เงียบสนิท ไม่มีอะไรฟ้อง** (ด่านชั้น 2 ใน handleDelete
         อ่านสดอีกรอบจึงยังกันการลบจริงไว้ได้ แต่จอโกหกว่าลบได้)
     fix: คิวรีรายการต้อง select `ojt_training_attendees(id, sign_url)` เสมอ */
  const src = readFileSync(join(ROOT, 'src/pages/OjtTraining.jsx'), 'utf8');
  if (!/canRemoveSheet/.test(src)) return;        // ถอดฟีเจอร์ลบใบของตัวเองออกแล้ว = ไม่ต้องมีด่าน
  assert.match(src, /ojt_training_attendees\(id,\s*sign_url\)/,
    '\n\n❌ OjtTraining.jsx: คิวรีรายการใบอบรมไม่ได้ดึง `sign_url` ของผู้เข้าอบรม\n'
    + '   ผล: `sheetSigned()` คืน false ทุกใบ ⇒ ปุ่ม 🗑️ โผล่บนใบที่พนักงานเซ็นครบแล้ว\n'
    + '   แก้: select(\'*, ojt_training_attendees(id, sign_url), ojt_training_files(id)\')\n');
});

test('🔩 mtn-parts-before-stock — ตัดสต็อกอะไหล่ได้ต่อเมื่อเขียนรายการลงใบ MO สำเร็จ', () => {
  /* why (02/11 · ทีม MTN แจ้ง "รายการ Spare Part ที่กดใช้ ไม่แสดงรายการในใบ MO"):
     `mtn_order_parts` มี RLS `for all to anon using(true)` แต่ **GRANT ระดับตารางไม่มี DELETE**
     ⇒ RLS ผ่าน แต่ Postgres ปฏิเสธที่ชั้นสิทธิ์ตาราง ⇒ PostgREST ตอบ 401
     โค้ดเดิมคร่อม insert ไว้ด้วยผลของ delete (ถูกแล้ว) **แต่ลูปตัดสต็อกไม่ได้ถูกคร่อมด้วย**
     ⇒ 23/10–02/11: อะไหล่ออกจากคลัง 98 รายการ / 45 ใบ โดยใบ MO ไม่มีบันทึกสักบรรทัด
       (วัดจาก edge_logs: DELETE /rest/v1/mtn_order_parts → 401 วันละ ~49 ครั้ง ·
        แถวใหม่ใน mtn_order_parts = 0 ทุกวันติดกัน 11 วัน · ไม่มีรายการคืนสต็อกเลย)
     กฎ: "ของออกจากคลัง" กับ "บันทึกว่าใช้กับใบไหน" ต้องไปด้วยกัน — เขียนบันทึกไม่ติด ห้ามตัดสต็อก
     (หลักเดียวกับ db-write-rules ข้อ 6: claim ก่อนเขียน ledger · ledger ล้มต้องคืนสถานะ)
     🔴 ห้ามแก้ด่านนี้ด้วยการย้าย `mtn_stock_move` ออกไปไฟล์อื่น — ให้ย้ายด่านตามไปด้วย */
  const src = readFileSync(join(ROOT, 'src/pages/MtnRepair.jsx'), 'utf8');
  const iGate  = src.indexOf('if (!partsWritten)');
  const iStock = src.indexOf("rpc('mtn_stock_move'");
  assert.ok(iGate > -1,
    '\n\n❌ MtnRepair.jsx ไม่มีประตู `if (!partsWritten)` ก่อนตัดสต็อกแล้ว\n'
    + '   ผล: เขียน mtn_order_parts ไม่ติด (401/เน็ตหลุด) แต่ของยังออกจากคลัง = ตามรอยอะไหล่ไม่ได้\n');
  assert.ok(iStock > -1 && iGate < iStock,
    '\n\n❌ `mtn_stock_move` ไม่ได้อยู่หลังประตู `if (!partsWritten)`\n'
    + '   แก้: ตัดสต็อกเฉพาะเมื่อเขียนรายการอะไหล่ลงใบสำเร็จ (นับแถวด้วย checkWriteRows)\n');
  assert.match(src, /from\('mtn_order_parts'\)\.insert\(partRows\)\.select\('id'\)[\s\S]{0,160}?checkWriteRows\(insParts/,
    '\n\n❌ insert รายการอะไหล่ไม่ได้นับแถว — ต้องใช้ checkWriteRows(... .select(\'id\'), …, { min })\n'
    + '   เขียนไม่ครบแล้วตัดสต็อกตามรายการที่ใบไม่มี = ยอดคลังกับใบไม่ตรงกันเงียบๆ\n');
});

/* ═══ 🧩 scope-picker-single-field — ③ ส่วนงาน กับ ④ Cost Center ต้องเป็นช่องเดียว ═══ 02/11
   คำสั่ง user: *"ปัญหาเรื่อง 3 กับ 4 ที่ควรจะรวมกันจะแก้จบเมื่อไหร่ ที่จริงเลือก 4 มันครอบคลุมอยู่แล้ว มันตามผังองค์กร"*
   2 ช่องที่ตอบคำถามเดียวกัน ("แก้ของใครได้") = ตั้งแล้วขัดกันเอง ⇒ `profiles.sections` ต้อง derive จาก CC
   ที่ติ๊ก (utils/scopePicker.js) — ห้ามมีช่องติ๊กส่วนงานแยกใน /add-user อีก */
test('🧩 scope-picker-single-field — /add-user ห้ามมีช่องติ๊กส่วนงานแยกจากต้นไม้ CC', () => {
  const au = stripComments(readFileSync(join(ROOT, 'src/pages/AddUser.jsx'), 'utf8'));
  assert.doesNotMatch(au, /setF\('sections',\s*checked\s*\?/,
    '🔴 ช่องติ๊ก sections กลับมาแล้ว — ต้อง derive จาก CC ผ่าน scopePicker.js เท่านั้น');
  assert.match(au, /deriveSections\(ccIdxNodes/, 'sections ที่บันทึกต้องมาจาก effectiveSections() ของ scopePicker');
  assert.match(au, /sections:\s*effSections/, 'ตอนสร้างบัญชีต้องบันทึก effSections');
  assert.match(au, /sections:\s*effSections\.length \? effSections : null/, 'ตอนแก้บัญชีต้องบันทึก effSections');
  const sp = stripComments(readFileSync(join(ROOT, 'src/utils/scopePicker.js'), 'utf8'));
  assert.match(sp, /if \(!ccs\?\.length\) return base;/,
    '🔴 ไม่ติ๊ก CC เลยต้องคืนค่าเดิมเป๊ะ — บัญชีเก่าห้ามเปลี่ยนพฤติกรรม (บทเรียน 26/10)');
});

/* ═══ 🔄 assignment-overlay-widen-only — ขอบเขตจริงอ่าน org_assignments แบบ "กว้างขึ้นได้อย่างเดียว" ═══ 02/11
   คำสั่ง user: *"ตำแหน่งจริงของ HR เป็นพื้นฐาน และเพิ่มความรับผิดชอบงานที่อาจจะรักษาการแทนตำแหน่งนั้น"*
                → *"ลุยต่อ ให้ขอบเขตจริงอ่าน org_assignments เลย"*
   · ตัวทับมีไฟล์เดียว `utils/assignmentOverlay.js` (pure · ห้ามแตะ DB) · App.jsx ต้องส่งผล
     effectiveSections() เข้า applyAssignments() ก่อน setUserSections (ไม่งั้นมอบหมายไม่มีผลเงียบ)
   · กฎวันที่มีผล = `isGranting()` ที่เดียว — ห้ามเขียน starts_on/ends_on เทียบวันเองใน App.jsx
   · ห้ามคืนน้อยกว่าที่ profiles ตั้ง (กฎ 26/10) — ฐานไม่จำกัด (sections ว่าง) ต้องคงว่างเสมอ */
test('🔄 assignment-overlay-widen-only — รักษาการทับขอบเขตได้ทางกว้างขึ้นเท่านั้น · กฎวันที่ที่เดียว', async () => {
  const app = stripComments(readFileSync(join(ROOT, 'src/App.jsx'), 'utf8'));
  assert.match(app, /from\('org_assignments'\)[\s\S]{0,200}\.eq\('profile_id',\s*user\.id\)/,
    '🔴 fetchProfile ต้องอ่าน org_assignments ของบัญชีนี้ (กรอง profile_id)');
  assert.match(app, /applyAssignments\(\{\s*sections:\s*baseSections/, 'ผล effectiveSections ต้องผ่าน applyAssignments ก่อน setUserSections');
  assert.match(app, /setUserSections\(finalSections\)/, 'setUserSections ต้องใช้ค่าหลังทับ');
  assert.doesNotMatch(app, /starts_on\s*<=|ends_on\s*>=/, '🔴 ห้ามเขียนกฎวันที่ของมอบหมายเองใน App.jsx — ใช้ isGranting()');

  const ov = stripComments(readFileSync(join(ROOT, 'src/utils/assignmentOverlay.js'), 'utf8'));
  assert.doesNotMatch(ov, /supabaseClient|from\(/, 'assignmentOverlay.js ต้อง pure ห้ามแตะ DB');
  assert.match(ov, /isGranting\(a, today\)/, 'ต้องใช้ isGranting() ตัวเดียวกับจอ /org-setup');

  const { applyAssignments } = await import('../assignmentOverlay.js');
  const { buildCcIndex } = await import('../ccScope.js');
  const nodes = [{ id: 1, kind: 'section', name: 'PD3', parent_id: null, cost_center: '1' }];
  const ccIdx = buildCcIndex(nodes);
  const a = [{ id: 'x', kind: 'acting', org_node_id: 1, scope_depth: 'branch', starts_on: '2026-01-01', ends_on: null }];
  const r0 = applyAssignments({ sections: [], respCostCenters: [] }, a, { nodes, ccIdx, today: '2026-11-02' });
  assert.deepEqual(r0.sections, [], '🔴 ฐานไม่จำกัดต้องคงไม่จำกัด — มอบหมายห้ามทำให้แคบลง');
  const r1 = applyAssignments({ sections: ['PD4'], respCostCenters: ['9'] }, a, { nodes, ccIdx, today: '2026-11-02' });
  assert.ok(r1.sections.includes('PD4') && r1.respCostCenters.includes('9'), '🔴 ของเดิมต้องอยู่ครบหลังทับ');
  const rf = applyAssignments({ sections: ['PD4'], respCostCenters: [] }, a, { nodes: [], ccIdx: null, today: '2026-11-02' });
  assert.deepEqual(rf.sections, ['PD4']); assert.equal(rf.failed, true, 'ผังอ่านไม่ได้ = ไม่ทับ + failed');
});

test('🛒 pr-filter-keeps-waiting — ซ่อนตัวกรองรวมได้ แต่ห้ามถอดออกจากลิสต์', () => {
  /* why (02/11 · ทีม MTN แจ้ง "Filter ไปขึ้นซ้อนกัน ทั้ง 1.รอแอดมินช่างเปิด PR 2.รอเปิด PR"):
     ตัวเลือก `waiting` = ผลรวมของ `need` + `no_no` ⇒ เมื่อ `no_no` เป็น 0 มันโชว์เลขเท่ากับ `need` เป๊ะ
     หน้างานอ่านว่าเป็นตัวเลือกซ้ำ ⇒ ซ่อนจาก dropdown (เหลือ 3 ขั้นตามที่ทีมเขียนมา)
     🔴 แต่ **ห้ามลบออกจาก `PR_FILTERS`** — กระดิ่ง `mtn_pr_waiting` เก็บลิงก์ `/mtn-repair?pr=waiting`
        ไว้ใน `notification_rules` (Main) · `prMatch` ตัดสินว่า "ค่าที่ไม่รู้จัก = ไม่กรอง"
        ⇒ ลบทิ้งเมื่อไหร่ กดกระดิ่งแล้วได้ลิสต์ทั้งหมดแทนคิวของแอดมินช่าง เงียบๆ ไม่มีอะไรฟ้อง
     🔴 และตัวที่ซ่อนต้องยังโผล่เป็น <option> เมื่อถูกเลือกอยู่ ไม่งั้นช่องว่างทั้งที่กรองอยู่ */
  const src = readFileSync(join(ROOT, 'src/pages/MtnRepair.jsx'), 'utf8');
  assert.match(src, /\{\s*v:\s*'waiting'[^}]*hidden:\s*true/,
    '\n\n❌ ตัวเลือก `waiting` หายจาก PR_FILTERS (หรือไม่ได้ทำเป็น hidden)\n'
    + '   ผล: ลิงก์ในกระดิ่ง `/mtn-repair?pr=waiting` จะไม่กรองอะไรเลย — แอดมินช่างได้ลิสต์ทั้งหมด\n'
    + '   แก้: เก็บแถวไว้แล้วติด hidden: true (ซ่อนจาก dropdown เฉยๆ)\n');
  assert.match(src, /PR_FILTERS\.filter\(x => !x\.hidden \|\| x\.v === fPr\)/,
    '\n\n❌ ลิสต์ตัวเลือกไม่ได้เปิดทางให้ตัวที่ซ่อนโผล่ตอนถูกเลือก\n'
    + '   ผล: มาจากลิงก์กระดิ่งแล้วช่อง "งาน PR" ว่างเปล่า ทั้งที่จอกรองอยู่ = จอโกหก\n');
});

test('🧑‍🔧 mo-print-shows-techs — ใบพิมพ์ FM-MTN-006 ต้องมีชื่อช่างซ่อมหลัก/รอง', () => {
  /* why (02/11 · ทีม MTN แจ้ง "ช่างซ่อมหลักและช่างซ่อมรองที่ให้กรอก ไม่ได้แสดงในเอกสาร MO ที่ Export"):
     ฟอร์มมี **2 ที่** ให้บอกว่าใครทำงาน — ช่อง `tech_main`/`tech_secondary` (ขั้น 3) กับตาราง
     "+ เพิ่มคน" (`mtn_order_labor`) — และใบพิมพ์วาดจากตารางค่าแรงอย่างเดียว
     วัด 90 วัน: 1,317/1,430 ใบ (92%) กรอกชื่อช่างหลักไว้แต่ไม่มีแถวค่าแรงเลย
     ⇒ ใบพิมพ์โชว์ตารางค่าแรงว่างทั้งตาราง ทั้งที่ระบบรู้อยู่แล้วว่าใครซ่อม
     กฎ: ใบพิมพ์ต้องรวม 2 แหล่งเข้าด้วยกัน (ชื่อซ้ำไม่เติม · แถวที่เติมไม่มีราคา = ช่องว่าง ห้ามเดาเลข)
     🔴 ห้ามแก้ด้วยการเขียน tech_main กลับเข้า `mtn_order_labor` — ใบพิมพ์ไม่ใช่ที่มาของข้อมูล */
  const src = readFileSync(join(ROOT, 'src/pages/MtnRepair.jsx'), 'utf8');
  assert.match(src, /laborList\s*=\s*\[[\s\S]{0,400}?o\.tech_main[\s\S]{0,120}?o\.tech_secondary/,
    '\n\n❌ ใบพิมพ์ MTN ไม่ได้เอา tech_main/tech_secondary เข้าตารางค่าแรงแล้ว\n'
    + '   ผล: 92% ของใบพิมพ์ออกมาโดยตาราง "ค่าแรงในการปฏิบัติงาน" ว่างทั้งตาราง\n'
    + '   แก้: ต่อท้าย laborList ด้วยช่างหลัก/รองที่ยังไม่มีชื่อในตาราง (rate/hours = null)\n');
  assert.match(src, /laborNames\.has\(/,
    '\n\n❌ ไม่ได้กันชื่อซ้ำ — ช่างที่ลงค่าแรงไว้แล้วจะขึ้น 2 บรรทัดบนใบ\n');
});

test('⏸️ mttr-hold-follows-path-flag — หยุดนับ MTTR ต้องผูกกับ holdsMttr ไม่ใช่ needsPr', () => {
  /* why (02/11 · ทีม MTN เขียนรายละเอียด 4 เส้นทางมา):
     "ซ่อมไม่ได้ > รออะไหล่ , รอจ้าง Vender [รออะไหล่เข้า, รอ PO ถึงร้านค้า ถึงซ่อมได้] ส่งผลให้หยุด MTTR"
     ⇒ ตัวชี้ขาดคือ **ซ่อมได้/ซ่อมไม่ได้** ไม่ใช่ "ต้องเปิด PR ไหม" — คนละคำถามกัน
       · ซ่อมเสร็จแล้วเปิด PR ซื้ออะไหล่มาเติมสต็อก = เครื่องเดินแล้ว **ไม่ได้รอ** ⇒ ห้ามหยุด
       · ส่งของไปซ่อมนอก = มีนาฬิกา supplier ของตัวเอง (vendor_sent→back · union ใน mttrHoldMin)
         ⇒ ติด holdsMttr ซ้ำ = หักซ้อนกันเปล่าๆ
     fix: `REPAIR_PATHS[].holdsMttr` เป็นเจ้าของคำตอบ · หน้าจอห้ามใช้ `needsPr` มาตัดสินการหยุด */
  const src = readFileSync(join(ROOT, 'src/components/MtnPurchase.jsx'), 'utf8');
  const patch = src.slice(src.indexOf('const savePath'), src.indexOf('const resumeRepair'));
  assert.ok(patch.length > 50, 'หา savePath ใน MtnPurchase.jsx ไม่เจอ — ด่านนี้ต้องตามไปด้วยถ้าย้ายโค้ด');
  assert.doesNotMatch(patch, /if \(\s*needs\s*&&[^)]*mttr_hold_from/,
    '\n\n❌ savePath กลับไปใช้ `needsPr` ตัดสินการหยุด MTTR แล้ว\n'
    + '   ผล: ใบที่ "ซ่อมเสร็จแล้ว เปิด PR ซื้อของมาเติม" ถูกนับว่ายังรออยู่ ⇒ MTTR ช่างต่ำกว่าจริง\n'
    + '   แก้: ใช้ `repairPathMeta(k)?.holdsMttr`\n');
  assert.match(patch, /holdsMttr/,
    '\n\n❌ savePath ไม่ได้อ่าน `holdsMttr` — เส้นทาง "ซ่อมไม่ได้" จะไม่หยุดนับ MTTR ให้เลย\n');
  /* ด่านคู่: ทะเบียนต้องมีเส้นทาง "ซ่อมไม่ได้" อยู่จริง และ 2 เส้นทาง "ซ่อมได้" ต้องไม่หยุด */
  const reg = readFileSync(join(ROOT, 'src/utils/mtnPurchase.js'), 'utf8');
  assert.match(reg, /key:\s*'blocked'[^}]*holdsMttr:\s*true/,
    '\n\n❌ ไม่มีเส้นทาง `blocked` (ซ่อมไม่ได้ — รออะไหล่/รอจ้าง Vendor) ที่ holdsMttr: true แล้ว\n');
  for (const k of ['inhouse_pr', 'outsource']) {
    assert.match(reg, new RegExp(`key:\\s*'${k}'[^}]*holdsMttr:\\s*false`),
      `\n\n❌ เส้นทาง '${k}' กลับมาหยุด MTTR แล้ว — เป็นเส้นทาง "ซ่อมได้" ห้ามหยุด\n`);
  }
});

/* ── ⚙️🔧✍️ AM รายเครื่อง / ติดตาม MO / สายอนุมัติ (ประชุมหน้างาน 2026-11-02 · B1/B3/B2) ─────────
   📄 docs/modules/am-pm-linkage-audit.md §5 */
test('🛡️ am-per-machine-run — loader AM ต้องอ่าน machine_no ของใบผลิต + จอ AM ต้องส่ง runByLine', () => {
  const loader = stripComments(readFileSync(join(ROOT, 'src/lib/dailyAmBoard.js'), 'utf8'));
  assert.match(loader, /from\('prod_orders'\)\.select\('[^']*machine_no[^']*'\)/,
    '\n\n❌ ตัวโหลด AM ไม่ได้ select machine_no ของ prod_orders — "เครื่องไหนต้องตรวจ" จะกลับไปตัดสินทั้งไลน์เงียบๆ\n'
    + '   ⇒ ไลน์ auto/single ขึ้นส้มให้เครื่องที่ไม่ได้เดิน (feedback 02/11) · แก้: select machine_no แล้วผ่าน runningMachinesByLine()\n');
  assert.match(loader, /runByLine/, '\n\n❌ loader ไม่คืน runByLine\n');
  const page = stripComments(readFileSync(join(ROOT, 'src/pages/DailyPM.jsx'), 'utf8'));
  assert.match(page, /dailyAmLineStatus\(\{[^}]*runByLine[^}]*\}\)/,
    '\n\n❌ DailyPM เรียก dailyAmLineStatus โดยไม่ส่ง runByLine — จอ AM ตัดสินทั้งไลน์ ขณะที่ผังรวมโรงงานตัดสินรายเครื่อง (2 จอคนละสี)\n');
});

test('🛡️ am-approval-chain — ใบ AM อนุมัติต้องผ่าน amApprovalVerdict() (ห้ามข้ามไปผู้จัดการ)', () => {
  const src = stripComments(readFileSync(join(ROOT, 'src/pages/PMCheckData.jsx'), 'utf8'));
  assert.match(src, /amApprovalVerdict\(/,
    '\n\n❌ PMCheckData ไม่ได้ตัดสินลำดับขั้นอนุมัติ AM ด้วย amApprovalVerdict() (src/utils/amApproval.js)\n'
    + '   บั๊กเดิม: ใครถือ pm:approve ก็อนุมัติได้ ⇒ หัวหน้ากลุ่มตรวจเองแล้วไปจบที่ผู้จัดการ (feedback 02/11)\n');
  // ด่านซ้ำตอนเขียนจริง — ซ่อนปุ่มอย่างเดียวไม่พอ
  assert.match(src, /if \(amVerdict && !amVerdict\.ok\)/, '\n\n❌ handleApprove/handleReject ไม่เช็ค amVerdict ซ้ำก่อนเขียน\n');
});

/* ✍️ ลงนามทบทวน AM รายเดือน (ขั้น 3 · 2026-11-03) — ลงนาม = บันทึก ห้ามลบ · ด่านซ้ำตอนเขียน
   📄 docs/modules/am-pm-linkage-audit.md §7 */
test('🛡️ am-monthly-signoff-record — เขียน am_monthly_signoffs ผ่าน lib/amMonthlySignoff.js เท่านั้น · ห้าม delete · ต้องตรวจ verdict', () => {
  const LIB = 'src/lib/amMonthlySignoff.js';
  const bad = [];
  for (const file of walk(join(ROOT, 'src'), ['.js', '.jsx'])) {
    const rel = relative(ROOT, file);
    if (rel === LIB) continue;
    const code = stripComments(readFileSync(file, 'utf8'));
    if (/from\(\s*['"`]am_monthly_signoffs['"`]\s*\)|from\(\s*AM_SIGNOFF_TABLE\s*\)/.test(code)) bad.push(rel);
  }
  assert.deepEqual(bad, [], '\n\n❌ มีไฟล์คิวรี am_monthly_signoffs เอง — ต้องผ่าน src/lib/amMonthlySignoff.js (ด่าน verdict + นับแถว อยู่ที่นั่น)\n   ' + bad.join('\n   ') + '\n');
  const lib = stripComments(readFileSync(join(ROOT, LIB), 'utf8'));
  assert.ok(!/\.delete\s*\(/.test(lib), '\n\n❌ amMonthlySignoff.js เรียก .delete() — ลายเซ็นห้ามลบ ให้เพิกถอน (status=revoked + เหตุผล)\n');
  assert.ok(!/\.upsert\s*\(/.test(lib), '\n\n❌ amMonthlySignoff.js ใช้ upsert — unique index เป็น partial/expression (42P10) และลายเซ็นห้ามเขียนทับ\n');
  assert.equal((lib.match(/if \(!verdict\?\.ok\)/g) || []).length, 2,
    '\n\n❌ signAmMonthly/revokeAmMonthly ต้องเช็ค verdict ก่อนเขียนทั้ง 2 ทาง (ด่านซ้ำตอนเขียน — ซ่อนปุ่มอย่างเดียวไม่พอ)\n');
  const page = stripComments(readFileSync(join(ROOT, 'src/components/AmMonthlyReport.jsx'), 'utf8'));
  assert.match(page, /const v = signVerdict\(signing\.line\)/, '\n\n❌ AmMonthlyReport ไม่ได้คิด verdict ใหม่ตอนกดลงนาม\n');
  assert.match(page, /isStale\(sign\.key, curKey\)/, '\n\n❌ AmMonthlyReport ไม่มีด่าน stale (เดือน/กะ) ก่อนลงนาม\n');
});

test('🛡️ am-onsite-badge-verify — ใบ AM ต้องมีบัตรผู้ตรวจ + ผู้ตรวจตัวจริง = คนตามบัตร (B4 · 10/11)', () => {
  /* หัวหน้าถือ handheld บันทึกแทน ⇒ inspector_id = หัวหน้า · ถ้าสายอนุมัติอ่านตำแหน่ง/ใบตัวเองจาก inspector_id
     หัวหน้ารับทราบไม่ได้ (self) และใบเลื่อนไปรอหัวหน้าแผนกทุกใบ · ไม่บังคับบัตร = ไม่รู้ว่าใครตรวจ */
  const page = stripComments(readFileSync(join(ROOT, 'src/pages/PMCheckData.jsx'), 'utf8'));
  assert.match(page, /const gate = amBadgeGate\(/, '\n\n❌ PMCheckData.handleSave ไม่ผ่าน amBadgeGate — ใบ AM ต้องมีบัตรผู้ตรวจที่ชี้พนักงานได้ 1 คน\n');
  assert.match(page, /if \(!gate\.ok\) \{ toast\.error\(gate\.text\); return \}/, '\n\n❌ บัตรไม่ผ่านแล้วยังบันทึกต่อ\n');
  assert.match(page, /onSite = amOnSiteApproval\(/, '\n\n❌ อนุมัติหน้าเครื่องต้องตัดสินผ่าน amOnSiteApproval (utils/amApproval.js)\n');
  assert.ok(!/inspPosById\[\s*(insp|viewInspection)\.inspector_id\s*\]/.test(page),
    '\n\n❌ อ่านตำแหน่งผู้ตรวจจาก inspector_id ตรงๆ — ใบที่มีรหัสบัตรต้องใช้ inspectorOf()/amInspectorIdentity (คนตามบัตรชนะบัญชีที่ login)\n');
});

test('🛡️ am-mo-label-single-source — ป้ายสถานะ MO บนจอ AM ต้องมาจาก moStatusLabel()', () => {
  for (const f of ['src/pages/DailyPM.jsx', 'src/pages/PMCheckData.jsx']) {
    const src = stripComments(readFileSync(join(ROOT, f), 'utf8'));
    assert.ok(!/MO_STATUS_LABEL\s*\[/.test(src), `\n\n❌ ${f} อ่าน MO_STATUS_LABEL[...] เอง — ใช้ moStatusLabel(order) (ใบ handover/checked มีป้ายต่อใบ)\n`);
  }
});

/* ── 🔫 สแกนงานคู่ทีละข้าง (03/11 · หน้างานแจ้งด่วน "บังคับสแกนสลับ พนักงานสแกนมั่ว") ──────────
   เดิม: สแกนข้างแรกแล้วเปลี่ยน MAT ในช่องเป็นของคู่ + จำว่าใบถัดไปคือคู่ ⇒ ยิง LH ติดกัน = ใบที่ 2 ถูกบันทึกเป็น MAT ของ RH
   📄 docs/modules/daily-report.md §สแกนงานคู่ทีละข้าง */
test('🛡️ pair-scan-one-side — สแกนเปิดใบต้องไม่สลับ MAT ไปข้างคู่ และไม่บังคับใบถัดไปเป็นคู่', () => {
  const src = stripComments(readFileSync(join(ROOT, 'src/pages/DailyReport.jsx'), 'utf8'));
  const a = src.indexOf('const handleScanOpenInner');
  const body = src.slice(a, src.indexOf('const handleOverflowNextShift', a));
  assert.ok(body.length > 200, 'หา handleScanOpenInner ไม่เจอ — ด่านนี้ต้องตามไปด้วยถ้าย้ายโค้ด');
  assert.doesNotMatch(body, /nextMatNo\s*=\s*partnerMatNo/,
    '\n\n❌ สแกนเปิดใบกลับไปเปลี่ยน MAT ในช่องเป็นของข้างคู่แล้ว — ยิง Tag ข้างเดียวกันติดกันจะถูกบันทึกเป็น MAT ผิดข้าง\n');
  assert.doesNotMatch(body, /setPendingPairId\(/,
    '\n\n❌ กลับมาบังคับ "ใบถัดไป = คู่" (pendingPairId) — คนยิงข้างเดียวกันต่อ = ผูก LH กับ LH\n');
});

/* ═══ 🏢 org-upper-layers-ready — ผังรับชั้นบน (plant/company) ได้โดยไม่ทำให้ส่วนงานหาย ═══ 04/11
   ที่มา: template Com Code + ไฟล์ Activity Rate 2027 (03/11) ⇒ ผังจริงของกลุ่ม = Group → SPG → Company → Plant → ส่วนงาน
   บล็อกเดิม (ORG-SCALE-GLOBAL-DESIGN §4 ขั้น 0): orgScope.js ถือว่า "ราก = ส่วนงาน" (`kids.get('')`) ⇒ เติมโหนด plant
   เหนือส่วนงาน = ส่วนงานหายจาก picker ทั้งระบบ · กฎรวมอยู่ที่ `src/utils/orgLayers.js` ที่เดียว
   🔴 ทุกจุดที่ตัดสิน "ขึ้นตรง/ราก/ตกทอด" ต้องถาม orgLayers — ห้ามเขียน `!n.parent_id` / `kind === 'section' ||` ใหม่ */
test('🏢 org-upper-layers-ready — รากของชั้นหน่วย/การตกทอดต้องผ่าน orgLayers.js', () => {
  const os = stripComments(readFileSync(join(ROOT, 'src/utils/orgScope.js'), 'utf8'));
  assert.match(os, /unitRoots\(act\)/, '🔴 orgScope.js: topNodes ต้องมาจาก unitRoots() ไม่ใช่ kids.get(\'\')');
  assert.doesNotMatch(os, /kids\.get\(''\)[^\n]*kind === 'section'/, 'ห้ามกลับไปอ่านรากจาก parent_id ว่างแล้วกรอง kind');

  const cc = stripComments(readFileSync(join(ROOT, 'src/utils/ccScope.js'), 'utf8'));
  assert.match(cc, /unitParentId\(cur, byId\)/, '🔴 ccOfNode ต้องหยุดไล่สายที่ชั้นบน — รหัสของ plant ห้ามไหลลงหน่วย');

  for (const [f, pat, why] of [
    ['src/utils/assignmentOverlay.js', /isUpperKind\(cur\.kind\)/, 'ส่วนงานของหน่วยที่ได้รับมอบ ต้องหยุดที่ชั้นบน'],
    ['src/utils/scopePicker.js', /isUpperKind\(n\.kind\)/, 'โหนดชั้นขอบเขตต้องข้ามชั้นบน (path[0] อาจเป็น company)'],
    ['src/utils/orgDivisions.js', /isOrphanDept\(n, byId\)/, 'แผนกขึ้นตรง = ไม่มีแม่เป็นหน่วย'],
    ['src/utils/sectionScope.js', /unitParentId\(d, allNodes\) == null/, 'orphanDepts ต้องรับผังทั้งต้น'],
    ['src/components/OrgTreeView.jsx', /unitParentId\(n, byId\) == null/, 'หน่วยลอย = ไม่มีแม่เป็นหน่วย'],
    ['src/pages/ManpowerBoard.jsx', /isOrphanDept\(n, nodes\)/, 'บอร์ดของแผนกขึ้นตรง'],
    ['src/pages/OrgSetup.jsx', /isOrphanDept\(n, nodes\)/, 'ตะกร้า "ขึ้นตรง" ใน /org-setup'],
  ]) {
    const s = stripComments(readFileSync(join(ROOT, f), 'utf8'));
    assert.match(s, pat, `🔴 ${f}: ${why}`);
  }
  /* จุดที่ยังเขียน "แผนกขึ้นตรง = parent_id ว่าง" เองต้องไม่เพิ่ม (ของเก่าที่เหลือถูกย้ายหมดแล้ว 04/11) */
  const bad = [];
  for (const f of ['src/utils/orgDivisions.js', 'src/pages/ManpowerBoard.jsx', 'src/pages/OrgSetup.jsx', 'src/components/OrgTreeView.jsx', 'src/utils/orgScope.js']) {
    const s = stripComments(readFileSync(join(ROOT, f), 'utf8'));
    if (/kind === 'department' && !n\.parent_id/.test(s) || /n\.kind !== 'section' && !n\.parent_id/.test(s)) bad.push(f);
  }
  assert.deepEqual(bad, [], 'ตัดสิน "ขึ้นตรง" จาก parent_id ว่างเอง — ใช้ isOrphanDept()/unitParentId()');
});

/* 🛡️ line-request-not-self-made (2026-11-04 · คำสั่ง user)
   ใบ "➕ ขอเบิกพาร์ทนี้เลย" ค้าง 10/10 ใบเป็นพาร์ทที่ไลน์นั้นผลิตเอง (ขอผิดทิศ — ต้องผลิตเติม/เบิกลูกใน BOM)
   ⇒ ทางที่ไลน์สร้างใบ `line_adhoc` ต้องผ่าน `selfMadeRequestBlock()` (partRefStock.js) ก่อน insert */
test('🛡️ line-request-not-self-made — ไลน์ขอเบิกพาร์ทที่ตัวเองผลิตไม่ได้', () => {
  const bad = [];
  const files = ['src/components/LinePartCallPanel.jsx'];
  for (const f of files) {
    const s = stripComments(readFileSync(join(ROOT, f), 'utf8'));
    if (/source:\s*'line_adhoc'/.test(s) && !/selfMadeRequestBlock\(/.test(s))
      bad.push(`${f} — สร้างใบ line_adhoc โดยไม่เช็ค selfMadeRequestBlock()`);
    // 04/11 — พาร์ทที่ทำเอง ต้องแตก BOM ผ่าน lineRequestFromBom (ห้ามขอตัวเอง · ห้ามไล่ BOM เองในหน้า)
    if (/source:\s*'line_adhoc'/.test(s) && !/lineRequestFromBom\(/.test(s))
      bad.push(`${f} — เลือกพาร์ทที่ไลน์ทำเองแล้วไม่แตก BOM ผ่าน lineRequestFromBom()`);
  }
  // จอใหม่ที่สร้างใบ line_adhoc ต้องเช็คเหมือนกัน
  for (const abs of walk(join(ROOT, 'src'), ['.js', '.jsx'])) {
    const f = relative(ROOT, abs);
    if (f.includes('__tests__') || files.includes(f)) continue;
    const s = stripComments(readFileSync(abs, 'utf8'));
    if (/source:\s*'line_adhoc'/.test(s) && !/selfMadeRequestBlock\(/.test(s))
      bad.push(`${f} — สร้างใบ line_adhoc โดยไม่เช็ค selfMadeRequestBlock()`);
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

/* 🛡️ heijunka-monitor-only (2026-11-04 · คำสั่ง user)
   *"หน้าตู้ heijunka ยอดงานจะต้องไม่วิ่งผ่านหน้านี้ หน้านี้เป็นแค่ monitor เรื่องสัญญาณ KANBAN"*
   ⇒ /heijunka = mode 'monitor' (ค่าเริ่ม) · ทำรายการได้เฉพาะที่ฝังใน /line-stock (mode 'ops')
   ด่าน: (1) canOperate ต้องผูกกับ isOps (2) ฟังก์ชันที่เขียน DB ทุกตัวต้องเรียก opsGuard() ก่อน
         (3) App.jsx ห้ามส่ง mode="ops" ให้ route /heijunka (4) PlatingBoard ต้องรับ readOnly และกันใน rpc() */
test('🛡️ heijunka-monitor-only — /heijunka ดูอย่างเดียว ยอดไม่วิ่งผ่าน', () => {
  const bad = [];
  const hk = stripComments(readFileSync(join(ROOT, 'src/pages/HeijunkaKanban.jsx'), 'utf8'));
  if (!/const canOperate = isOps && can\('heijunka', 'operate'/.test(hk)) bad.push('HeijunkaKanban: canOperate ไม่ผูกกับ isOps');
  if (!/HeijunkaKanban\(\{ mode = 'monitor'/.test(hk)) bad.push("HeijunkaKanban: ค่าเริ่มของ mode ต้องเป็น 'monitor'");
  for (const n of ['advanceLot', 'advancePurchase', 'reorderLot', 'issueRaw', 'createStoreRequests', 'deductStockForPick', 'advanceWip', 'confirmRound', 'submitReceive']) {
    const m = hk.match(new RegExp(`const ${n} = async \\([^)]*\\) => \\{\\n([^\\n]*)`));
    if (!m) { bad.push(`HeijunkaKanban: หา ${n} ไม่เจอ (เปลี่ยนชื่อ? ต้องอัพเดทด่านนี้)`); continue; }
    if (!/opsGuard\(\)/.test(m[1])) bad.push(`HeijunkaKanban: ${n} ไม่เรียก opsGuard() เป็นบรรทัดแรก`);
  }
  const app = readFileSync(join(ROOT, 'src/App.jsx'), 'utf8');
  if (/<HeijunkaKanban[^>]*mode=["']ops["']/.test(app)) bad.push('App.jsx: route ส่ง mode="ops" ให้ HeijunkaKanban');
  const pb = stripComments(readFileSync(join(ROOT, 'src/components/PlatingBoard.jsx'), 'utf8'));
  if (!/readOnly = false/.test(pb) || !/const rpc = async[^\n]*\n\s*if \(readOnly\)/.test(pb)) bad.push('PlatingBoard: ต้องรับ readOnly และกันใน rpc()');
  assert.deepEqual(bad, [], bad.join('\n'));
});

/* ── 📦 "ใบของตัวเองว่าง" ≠ "ไม่มี BOM" — ต้องนับลูกที่ใบอื่นกรอกไว้ด้วย (2026-11-04) ──────
   user แจ้ง: 20059152 ขึ้น "BOM ✗" ทั้งที่ใบของแม่ (20059261) กรอกลูกไว้ให้แล้ว
   ต้นเหตุ: ตัวนับดู `product_id` ของตัวเองอย่างเดียว ไม่ได้ดู `parent_mat` ของใบอื่น
   (วัดวันนั้น 31 พาร์ทโดนแบบเดียวกัน) — กฎเดียวกับ `sheetsWithKidsOf()` ใน bomTree.js    */
test('🛡️ ความครบของสินค้า: BOM ต้องนับลูกที่ใบอื่นกรอกไว้ให้ (parent_mat) ด้วย', () => {
  const rule = stripComments(readFileSync(join(ROOT, 'src/utils/productReadiness.js'), 'utf8'));
  const page = stripComments(readFileSync(join(ROOT, 'src/pages/ProductMaster.jsx'), 'utf8'));

  assert.ok(/bomElsewhere/.test(rule),
    '\n\n❌ `productReadiness` ไม่รับ `bomElsewhere` แล้ว\n'
    + '   ⇒ พาร์ทที่ใบของแม่กรอกลูกไว้ให้ จะกลับไปขึ้น "BOM ✗" ทั้งที่มี BOM จริง\n');
  assert.ok(/bomHere\s*>\s*0\s*\|\|\s*bomAway\s*>\s*0/.test(rule),
    '\n\n❌ กฎ `have.bom` ไม่ได้ "ใบตัวเอง หรือ ใบอื่น" แล้ว — ห้ามนับแค่ใบของตัวเอง\n');

  // หน้าต้องดึง parent_mat มาด้วย ไม่งั้นนับไม่ได้ตั้งแต่ต้นทาง (เงียบ ไม่มี error)
  assert.ok(/from\('bom_items'\)\s*\.select\('product_id, mat_no, parent_mat'\)/.test(page),
    '\n\n❌ /products ไม่ได้ `select` `parent_mat` จาก bom_items แล้ว\n'
    + '   ตัวนับจะว่างเงียบๆ แล้วชิป BOM กลับไปแดงเหมือนเดิม\n');
  assert.ok(/bomElsewhere:\s*bomAwayOf\(/.test(page),
    '\n\n❌ /products ไม่ได้ส่ง `bomElsewhere` เข้า productReadiness แล้ว\n');
  // แถบเตือน "ขั้นตอน (OP) ที่ยังไม่ผูก component" ต้องใช้กติกาเดียวกัน ไม่งั้นเตือนผิดแบบเดิม
  assert.ok(/opNoBom[\s\S]{0,160}bomAwayOf\(/.test(page),
    '\n\n❌ แถบ OP ที่ยังไม่ผูก component ไม่ได้นับลูกที่ใบอื่นกรอกไว้ — จะเตือนผิดแบบเดิม\n');
});

/* ── ⬆️ แถบ "ถูกใช้เป็นลูกของ" — 2 บั๊กที่ user เจอ 04/11 (เคส 20058490) ─────────────────
   ① ปุ่มแม่เปิดใบด้วย "ชื่อแม่" ⇒ แม่ตัวเดียวกันที่อยู่ 2 ใบ ได้ปุ่มเหมือนกันเป๊ะ กดแล้วไปใบเดียวกัน
   ② แถวที่อยู่ในใบที่จอไม่ได้โหลด (ใบปิดใช้งาน) ตกไปอยู่ `orphans` แล้วหายจากแถบเงียบๆ
      (ของจริง: มีแม่ 7 ที่ จอขึ้น 4)                                                        */
test('🛡️ แถบแม่ใน /products: ต้องเปิดตาม "ใบ" + ต้องนับของที่ชี้ชื่อไม่ได้', () => {
  const page = stripComments(readFileSync(join(ROOT, 'src/pages/ProductMaster.jsx'), 'utf8'));
  const bar = page.slice(page.indexOf('const parentsBar'), page.indexOf('const kidsElsewhere'));
  assert.ok(bar.length > 100, 'หา parentsBar ไม่เจอ — เปลี่ยนชื่อแล้วต้องอัปเดตด่านนี้');

  assert.ok(/openSheetById\(\s*x\.sheetId/.test(bar),
    '\n\n❌ ปุ่มแม่ไม่ได้เปิดด้วย `x.sheetId` แล้ว\n'
    + '   เปิดด้วยชื่อแม่อย่างเดียว = แม่ตัวเดียวกันคนละใบ จะพาไปใบเดิมทั้งคู่ (ปุ่มซ้ำกดแล้วเหมือนกัน)\n');
  assert.ok(/dupMat/.test(bar),
    '\n\n❌ ไม่ได้ติดป้าย "ในใบ …" ให้แม่ที่ซ้ำชื่อแล้ว — บนจอจะเห็นปุ่มเหมือนกันเป๊ะ แยกไม่ออก\n');
  assert.ok(/orphans/.test(bar),
    '\n\n❌ แถบแม่ไม่ได้นับ `bomIx.orphans` แล้ว\n'
    + '   แถวที่อยู่ในใบปิดใช้งานจะหายจากแถบเงียบๆ — ตัวเลข "ถูกใช้เป็นลูกของ N ที่" จะต่ำกว่าจริง\n');
});

test('🔕 notify-mute-single-choke-point — ตัวกรอง "ปิดแจ้งเตือนเอง" ต้องอยู่ฝั่ง DB ที่เดียว', () => {
  /* why (03/11 · ข้อเสนอจากหน้างาน ข้อ 4 · คำสั่ง user "เอาแบบล็อกไม่ให้ปิดงานที่รอเรา"):
     `notification_user_prefs` เป็น "ของส่วนตัว" ที่ RLS ให้เห็นแค่แถวตัวเอง ⇒ หน้าจอไหนเอามากรอง
     กระดิ่ง/ลิสต์เองฝั่ง client จะได้ผลครึ่งๆ และ **ข้ามการล็อกได้** (เรื่องที่ `can_mute=false`
     ยังถูกซ่อนบนจอ ทั้งที่กฎบอกว่าต้องเห็นเสมอ) ⇒ งานที่รอคนลงมือเงียบหายโดยไม่มีใครรู้
     กฎ: ตัวกรองจริงอยู่ใน `notify_recipients` (migration 20261103) จุดเดียว —
         ฝั่ง client แตะตารางนี้ได้เฉพาะ "จอตั้งค่า" (NotifyPrefsModal) เพื่อเขียน/ลบค่าของตัวเอง
     🔴 ห้ามแก้ด้วยการกรองในหน้า — ต้องแก้ที่ RPC ฝั่ง DB เท่านั้น */
  const OK = ['src/components/NotifyPrefsModal.jsx', 'src/utils/notifyPrefs.js'];
  const hits = walk(join(ROOT, 'src'), ['.js', '.jsx'])
    .filter(f => readFileSync(f, 'utf8').includes('notification_user_prefs'))
    .map(f => relative(ROOT, f))
    .filter(f => !OK.includes(f));
  assert.deepEqual(hits, [],
    '\n\n❌ มีไฟล์อื่นแตะตาราง `notification_user_prefs` ฝั่ง client:\n   '
    + hits.join('\n   ')
    + '\n   ผล: กรองกระดิ่งเองในหน้า = ข้ามการล็อก "งานที่รอเรา" (can_mute=false) ได้\n'
    + '   แก้: ให้ตัวกรองอยู่ใน notify_recipients ฝั่ง DB เท่านั้น\n');

  /* ด่านคู่: เรื่องที่ล็อกต้อง **ยังโชว์** บนจอตั้งค่า (ซ่อน = คนงงว่าทำไมยังมีแจ้งเตือนโผล่) */
  const util = readFileSync(join(ROOT, 'src/utils/notifyPrefs.js'), 'utf8');
  assert.doesNotMatch(util, /filter\([^)]*can_mute\s*===\s*false/,
    '\n\n❌ myNotifyRows กรองเรื่องที่ล็อกออกจากลิสต์แล้ว — ต้องคืนมาพร้อมธง `locked` ไม่ใช่ตัดทิ้ง\n');
  assert.match(util, /locked:\s*x\.can_mute === false/,
    '\n\n❌ myNotifyRows ไม่ได้ติดธง `locked` จาก `can_mute` — จอจะเปิดสวิตช์ให้กดเรื่องที่ปิดไม่ได้\n');
  const modal = readFileSync(join(ROOT, 'src/components/NotifyPrefsModal.jsx'), 'utf8');
  assert.match(modal, /disabled=\{r\.locked/,
    '\n\n❌ โมดัลไม่ได้ปิดสวิตช์ของเรื่องที่ล็อก — กดได้แต่ฝั่ง DB ไม่กรองให้ = สวิตช์หลอก\n');
});

test('🧑‍🔧 mo-export-shows-real-techs — ไฟล์ Excel ของ MO ต้องมีคอลัมน์ "ช่างซ่อมจริง" แยกจาก "ช่างที่มอบหมาย"', () => {
  /* why (04/11 · feedback ทีม MTN ข้อ 2 "การปิด MO"):
     "ช่างซ่อมหลักและช่างซ่อมรองที่ให้กรอก ไม่ได้แสดงในเอกสาร MO ที่ Export"
     รอบ 02/11 แก้ใบพิมพ์ไปแล้ว (ด่าน mo-print-shows-techs) — รอบนี้ปิดฝั่งไฟล์ Excel
     🔴 **"มอบหมาย" ≠ "ซ่อมจริง" ห้ามยุบเป็นคอลัมน์เดียว** — มอบหมาย 2 คนแล้วคนเดียวทำ /
        ส่งต่อให้คนอื่นทำ = เกิดปกติ ⇒ รายงานต้องเห็นทั้ง 2 แกน ไม่งั้น KPI ช่างผิดคน
     🔴 **`tech_main`/`tech_secondary` ห้ามเข้า `MO_LIST_COLS`** — คิวรีรายการยิง ~1,389 ครั้ง/วัน
        ที่เพดาน 1000 ใบ · คอลัมน์ที่มีแต่ปุ่ม export อ่าน ไปอยู่ในนั้น = คนเปิดจอจ่าย egress แทน
        ⇒ ต้องโหลดตอนกดปุ่ม ผ่าน `loadRepairTechsFor()` (chunk .in() ให้เอง) */
  /* 🔴 คอลัมน์อยู่ในทะเบียนชุดเดียว `MO_EXPORT_COLS` (03/11 · ข้อ A8) — ไม่ใช่ put() ในไฟล์ทำ Excel */
  const xl = readFileSync(join(ROOT, 'src/utils/mtnMoExportCols.js'), 'utf8');
  const iAssigned = xl.indexOf("h: 'ช่างที่มอบหมาย'");
  const iReal = xl.indexOf("h: 'ช่างซ่อมจริง (หลัก/รอง)'");
  assert.ok(iReal > 0,
    '\n\n❌ คอลัมน์ "ช่างซ่อมจริง (หลัก/รอง)" หายจากทะเบียน MO_EXPORT_COLS แล้ว\n'
    + '   ผล: กลับไปเป็นอาการที่ทีม MTN แจ้ง — export มาแล้วไม่รู้ว่าใครซ่อม\n');
  assert.ok(iAssigned > 0 && iAssigned < iReal,
    '\n\n❌ "ช่างที่มอบหมาย" ต้องยังอยู่ และอยู่ก่อน "ช่างซ่อมจริง" — 2 คอลัมน์คนละคำถาม ห้ามยุบรวม\n'
    + '   (มอบหมายตอนรับงาน ≠ ลงมือจริงตอนปิดงาน · ยุบ = KPI ช่างไปลงผิดคน)\n');
  assert.match(xl, /techsError \? '⚠/,
    '\n\n❌ โหลดชื่อช่างไม่ติดแล้วไม่เขียนกำกับ — ช่องว่างจะอ่านเป็น "ไม่ได้กรอก" (จอโกหก)\n');
  /* ตัวทำไฟล์ต้องส่ง techsBy/techsError ลงทะเบียน ไม่งั้นคอลัมน์ว่างทั้งไฟล์เงียบๆ */
  const mk = readFileSync(join(ROOT, 'src/lib/mtnMoExportExcel.js'), 'utf8');
  assert.match(mk, /cellCtx\s*=\s*\{[^}]*techsBy[^}]*techsError/,
    '\n\n❌ exportMoExcel ไม่ได้ส่ง techsBy/techsError เข้า cellCtx — คอลัมน์ช่างซ่อมจริงจะว่างทุกแถว\n');
  /* ด่านคู่: ตัวโหลดต้องผ่าน fetchByIds (chunk) และคอลัมน์ต้องไม่ไปโป่งในคิวรีรายการ */
  const ld = readFileSync(join(ROOT, 'src/lib/moRepairTechs.js'), 'utf8');
  assert.match(ld, /fetchByIds\(/,
    '\n\n❌ loadRepairTechsFor ไม่ได้ผ่าน fetchByIds — `.in()` ยาวเกินเพดาน proxy = คืนค่าว่างเงียบ\n');
  const page = readFileSync(join(ROOT, 'src/pages/MtnRepair.jsx'), 'utf8');
  const listCols = page.slice(page.indexOf('const MO_LIST_COLS'), page.indexOf('const SCOPE_OPTS'));
  assert.ok(listCols.length > 100, 'หา MO_LIST_COLS ไม่เจอ — ด่านนี้ต้องตามไปด้วยถ้าย้ายโค้ด');
  for (const col of ['tech_main', 'tech_secondary']) {
    assert.doesNotMatch(listCols, new RegExp(`'${col}'`),
      `\n\n❌ '${col}' ถูกเติมเข้า MO_LIST_COLS แล้ว — คิวรีรายการ MO ยิง ~1,389 ครั้ง/วัน\n`
      + '   ผล: ทุกคนที่เปิดจอจ่าย egress เพิ่ม แทนคนที่กด export\n'
      + '   แก้: โหลดตอนกดปุ่มผ่าน loadRepairTechsFor() (src/lib/moRepairTechs.js)\n');
  }
});
/* ═══ 🔻 ตัดสต็อกตอน confirm = ลูกตรงชั้นเดียว (หลัก SAP) — 2026-11-04 ═════════════════
   บั๊กจริง: `fn_explode_child_demand` วน `where product_id = v_fg` ทั้งใบโดยไม่กรอง parent_mat
   ⇒ แถว "หลาน" ที่นอนในใบแม่ถูกตัดสต็อกด้วย + ใช้ qty_per_unit ที่เป็น "ต่อ 1 ลูก" มาคูณยอด FG
   ของจริง 4/11: prod_no 0121060580 ตัด 30042566 ถึง 5 แถว รวม 380 (ที่ถูก = 1 แถว × 2)
   ⇒ ตัวตัดสินย้ายไป `fn_bom_direct_demand(mat)` ที่เดียว · ห้ามใครเขียนลูปทั้งใบกลับมา  */
test('🛡️ trigger ตัดสต็อกต้องเรียก fn_bom_direct_demand ห้ามวน bom_items ทั้งใบ', () => {
  const dir = join(ROOT, 'supabase/migrations');
  const files = readdirSync(dir).filter(f => f.endsWith('.sql'));
  // ตัดคอมเมนต์ออกก่อน (กฎข้อ 3 ของไฟล์นี้ — เอกสารพูดถึง pattern ต้องห้ามได้)
  const strip = (s) => s.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');

  const owners = files.filter(f =>
    /create\s+or\s+replace\s+function\s+public\.fn_explode_child_demand/i
      .test(strip(readFileSync(join(dir, f), 'utf8'))));
  assert.ok(owners.length > 0,
    'ไม่เจอ migration ที่นิยาม fn_explode_child_demand — ด่านนี้ต้องมีไฟล์ให้ตรวจ');

  // ไฟล์ล่าสุด (เรียงตามชื่อ = ตามวัน) คือตัวที่มีผลจริง
  const latest = owners.sort().at(-1);
  const sql = strip(readFileSync(join(dir, latest), 'utf8'));

  assert.ok(/fn_bom_direct_demand\s*\(\s*NEW\.mat_no\s*\)/i.test(sql),
    `${latest}: trigger ต้องเอารายการที่จะตัดจาก fn_bom_direct_demand(NEW.mat_no)\n` +
    'why: ลูปทั้งใบตัดหลานด้วย = ของเสียถูกหักซ้ำ/ยอดสต็อกเพี้ยน\n' +
    'fix: for b in select * from public.fn_bom_direct_demand(NEW.mat_no) loop');

  assert.ok(!/from\s+bom_items\s+where\s+product_id\s*=\s*v_fg/i.test(sql),
    `${latest}: ห้ามวน bom_items ทั้งใบใน trigger ตัดสต็อก (พบ "from bom_items where product_id = v_fg")\n` +
    'why: parent_mat ทำให้แถวหลานนอนในใบแม่ได้ ⇒ ทั้งใบ ≠ ลูกตรง\n' +
    'fix: ใช้ fn_bom_direct_demand(mat) ซึ่งกรอง parent_mat + ทะลุเฉพาะของลม');
});

/* กฎ "อ่านไม่ได้ = ไม่ตัดสิน" ของทะเบียนของลม — เดา 0 จะกลายเป็น "โซ่ขาด" เทียมทั้งจอ */
test('🛡️ bomPhantom: ownOrders ที่อ่านไม่ได้ต้องเป็น unknown ห้ามบีบเป็น 0', async () => {
  const { classifyIntermediate } = await import('../bomPhantom.js');
  assert.equal(classifyIntermediate({}), 'unknown');
  assert.equal(classifyIntermediate({ ownOrders: null }), 'unknown');
  assert.equal(classifyIntermediate({ ownOrders: 0 }), 'gap');
});

/* 🛡️ short-receipt-not-lost (2026-11-05 · คำสั่ง user "ต้องไม่หาย")
   รับไม่ครบเดิม consume ทิ้งที่ไลน์ = ยอดหายจากทุกคลัง ⇒ ต้องย้ายไปคลังพักผ่าน shortReceiptRows() + เปิดเคส stock_discrepancies */
test('🛡️ short-receipt-not-lost — รับไม่ครบต้องย้ายไปคลังพัก ไม่ตัดทิ้ง', () => {
  const bad = [];
  for (const f of ['src/components/LinePartCallPanel.jsx', 'src/pages/HeijunkaKanban.jsx']) {
    const s = stripComments(readFileSync(join(ROOT, f), 'utf8'));
    if (!/shortReceiptRows\(/.test(s)) bad.push(`${f} — ไม่ใช้ shortReceiptRows()`);
    if (!/from\('stock_discrepancies'\)\.insert/.test(s)) bad.push(`${f} — ไม่เปิดเคส stock_discrepancies`);
    if (/\(ปรับยอดตามจริง\)/.test(s)) bad.push(`${f} — ยังมีทาง consume ทิ้ง "(ปรับยอดตามจริง)"`);
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

/* ═══ ⛔ ห้าม seed ทะเบียน "ของลม" — 2026-11-05 · กฎ user ════════════════════════════════
   กฎ: *"ควรจะตัดลูกที่ติดตัว ลูกมีหน้าที่ไปตัดหลาน และสร้างผัง bom ทีเดียว"*
   ⇒ **ค่าเริ่มต้นคือตัดลูกตรงเสมอ** · ของลม = ข้อยกเว้นที่ PE ติ๊กเองบนจอ
   บั๊กจริง 4/11: migration รุ่นแรก seed 45 แถวจากการเดา ⇒ confirm 10100286 ข้าม 20059342
   ไปตัด 20059343 แทน = ขัดกฎข้างบน · ล้างทิ้ง 5/11 แล้ว · ด่านนี้กัน migration หน้า seed ซ้ำ  */
test('🛡️ bom-phantom-no-seed — migration ห้าม insert ทะเบียนของลมให้เอง', () => {
  const dir = join(ROOT, 'supabase/migrations');
  const strip = (s) => s.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  const bad = [];
  for (const f of readdirSync(dir).filter(f => f.endsWith('.sql'))) {
    const sql = strip(readFileSync(join(dir, f), 'utf8'));
    if (/insert\s+into\s+(public\.)?bom_phantom_mats/i.test(sql)) bad.push(f);
  }
  assert.deepEqual(bad, [],
    `\n\n❌ migration seed ทะเบียนของลม: ${bad.join(', ')}\n`
    + 'why: ติ๊กของลมให้เอง = ระบบข้ามลูกกลางไปตัดหลาน ขัดกฎ "ตัดลูกที่ติดตัว ลูกไปตัดหลาน"\n'
    + '     (รอบ 4/11 seed 45 แถวแล้วทำให้ confirm 10100286 ข้าม 20059342 — ล้างทิ้งแล้ว)\n'
    + 'fix: ปล่อยทะเบียนว่าง ให้ PE ติ๊กเองที่ /products?tab=phantom ·\n'
    + '     โซ่ที่เดินไม่ถึงให้โชว์ผ่าน fn_bom_deduct_gaps() ห้ามกลบด้วยการติ๊กของลม\n');
});

test('🏃 mo-chase-side-via-registry — แผงไล่งานต้องถามฝั่งจากทะเบียนขั้น ห้ามเทียบเลขขั้น/ชื่อ stage เอง', () => {
  /* why (05/11 · คำสั่ง user "ทำแผงไล่ MO ค้างให้หัวหน้าช่าง"):
     แผงนี้แบ่งกองด้วย "ใบนี้รอฝั่งช่าง หรือรอฝ่ายที่แจ้ง" ซึ่ง **ไม่ใช่ฟังก์ชันของเลขขั้น** —
     ขั้น 4 (ตรวจรับงานหลังซ่อม) ของทีมเครื่องมือ (JIG/DIE) เป็น **ฝั่งช่าง** (หัวหน้าแผนกช่างตรวจ
     เพราะของยังอยู่ห้องช่าง) แต่ของทีม production เป็น **ฝั่งผู้แจ้ง** (เครื่องกลับมาเดินที่ไลน์แล้ว)
     ⇒ ใครเขียน `step === 4 → reporter` เองในหน้า/ใน util นี้ จะโยนใบ JIG/DIE ~35 ใบไปกองผิดฝั่ง
        แล้วหัวหน้าช่างโทรตามผิดคน (วัด 05/11: ใบค้าง accept_work ของ jig/die = 3 ใบ)
     กฎ: ฝั่งมาจาก `moWaitMeta(order).meta.side` ที่เดียว · ขั้น QA ไม่มี side (แยกถังเอง)
     🔴 ห้ามนับวันซ้ำ — อายุการค้างต้องมาจาก `stageAgeOf` ของ mtnStale.js (2 สูตร = 2 จอคนละเลข) */
  const src = stripComments(readFileSync(join(ROOT, 'src/utils/moChase.js'), 'utf8'));
  assert.match(src, /moWaitMeta\(/,
    '\n\n❌ moChase ไม่ได้ถาม moWaitMeta แล้ว — ฝั่งจะถูกเดาเอง\n');
  assert.match(src, /meta\?\.side === 'mtn'/,
    '\n\n❌ ไม่ได้อ่าน `meta.side` จากทะเบียนขั้น\n');
  assert.doesNotMatch(src, /step\s*===\s*\d/,
    '\n\n❌ moChase กลับไปเทียบเลขขั้นตรงๆ แล้ว — ขั้นเดียวกันคนละฝั่งตามทีม (JIG/DIE vs production)\n'
    + '   ผล: ใบไปกองผิดฝั่ง หัวหน้าช่างโทรตามผิดคน\n');
  assert.match(src, /stageAgeOf/,
    '\n\n❌ ไม่ได้ใช้ stageAgeOf — อายุการค้างต้องมาจากสูตรเดียวกับแผงใบค้าง\n');
  /* จอต้องไม่ตัดสินฝั่งเอง และต้องส่ง board มาจากหน้าแม่ (ไม่ยิงคิวรีในแผง) */
  const panel = stripComments(readFileSync(join(ROOT, 'src/components/MoStalePanel.jsx'), 'utf8'));
  assert.doesNotMatch(panel, /\.side\s*===\s*'(mtn|reporter)'/,
    '\n\n❌ แผงเทียบฝั่งเองแล้ว — ต้องรับ `chase` ที่ประกอบจาก buildMoChaseBoard มาวาดเท่านั้น\n');
  assert.doesNotMatch(panel, /supabase/,
    '\n\n❌ แผงยิงคิวรีเอง — ต้องนับจาก orders ที่หน้าโหลดไว้แล้ว (egress 0)\n');

  /* ชิป "ชื่อช่าง" กดแล้วกรองด้วยคำค้น ⇒ ช่องค้นหาต้องครอบ assigned_to ไม่งั้นเป็นปุ่มหลอก */
  const page = stripComments(readFileSync(join(ROOT, 'src/pages/MtnRepair.jsx'), 'utf8'));
  const textFilter = page.slice(page.indexOf("key: 'text'"), page.indexOf("key: 'text'") + 500);
  assert.match(textFilter, /o\.assigned_to/,
    '\n\n❌ ช่องค้นหาของหน้า MO ไม่ครอบ `assigned_to` แล้ว\n'
    + '   ผล: กดชื่อช่างในแถบ "ไล่งาน" แล้วลิสต์ไม่กรองอะไรเลย (ปุ่มหลอก)\n');
});

/* ═══ 🧲 coil-request-via-bom — 2026-11-05 · คำสั่ง user ══════════════════════════════════
   *"สโตร์จะจ่ายงานเหล็ก coil เป็น kgs. ไม่ใช่ชิ้น ตอนเบิกพาร์ทต้องแตกผ่านบอม"* · *"ต้องเบิกผ่านพาร์ท"*
   ⇒ ตัวออกใบ (lib/lineDemandSync.js) ต้องรู้ coil จาก parts_master.uom + บล็อกการขอ coil ตรง +
     ประทับ uom ลงใบ · ทางแตก BOM ในแผงไลน์ต้องส่ง viaBom (ไม่งั้น coil ที่แตกจาก BOM ถูกบล็อกด้วย)  */
test('🧲 coil-request-via-bom — coil ขอตรงไม่ได้ · ใบต้องประทับ uom', () => {
  const bad = [];
  const sync = stripComments(readFileSync(join(ROOT, 'src/lib/lineDemandSync.js'), 'utf8'));
  if (!/select\('[^']*\buom\b[^']*'\)/.test(sync)) bad.push('lineDemandSync — ไม่อ่าน parts_master.uom');
  if (!/directCoil/.test(sync)) bad.push('lineDemandSync — ไม่บล็อก coil ที่ขอตรง');
  if (!/uom: r\.uom/.test(sync)) bad.push('lineDemandSync — ไม่ประทับ uom ลงใบ');
  const panel = stripComments(readFileSync(join(ROOT, 'src/components/LinePartCallPanel.jsx'), 'utf8'));
  if (!/viaBom: true/.test(panel)) bad.push('LinePartCallPanel — ทางแตก BOM ไม่ส่ง viaBom');
  assert.deepEqual(bad, [], bad.join('\n'));
});

/* ═══ 🔒 line-adhoc-picker-strict — 2026-11-05 · คำสั่ง user ═══════════════════════════════
   ช่อง "ขอเบิกพาร์ทนี้เลย" ห้ามโชว์พาร์ทของไลน์อื่น (*"ไม่ควรขึ้นเพื่อกันการงง"*) ⇒ ProductSelect ต้อง strict */
test('🔒 line-adhoc-picker-strict — ช่องขอเบิกเองโชว์เฉพาะพาร์ทของไลน์นี้', () => {
  const s = stripComments(readFileSync(join(ROOT, 'src/components/LinePartCallPanel.jsx'), 'utf8'));
  assert.match(s, /<ProductSelect strict value=\{adhocMat\}/, 'ProductSelect ของฟอร์มขอเบิกเองต้องมี strict');
  assert.match(s, /<ProductSelect strict value=\{newMat\}/, 'ProductSelect ของโมดัลตั้งจุดเรียกเติมต้องมี strict');
  assert.doesNotMatch(s, /useColumnHistory\(supabaseDR, 'line_part_levels'/, 'ห้ามดึงประวัติ mat ของทุกไลน์มาเป็นตัวเลือก');
});

/* ═══ 🏠 store-area-via-home-sloc — 2026-11-05 · คำสั่ง user ══════════════════════════════
   *"สโตร์ไม่จำเป็นต้องไปตั้งไลน์ · part master แต่ละตัวควรตั้งได้ว่าที่จัดเก็บหลักอยู่ที่ไหน"*
   ⇒ พื้นที่ของกองคลัง (STORE / FG WAREHOUSE) = parts_master.home_sloc ของพาร์ท ห้ามถามผ่านการผูกไลน์  */
test('🏠 store-area-via-home-sloc — ห้ามหา SLoc ของกองคลังด้วย slocCodeOfLine/slocOfLine', () => {
  const bad = [];
  for (const f of ['src/pages/HeijunkaKanban.jsx', 'src/pages/LineStock.jsx', 'src/utils/slocStockView.js', 'src/components/LinePartCallPanel.jsx']) {
    const s = stripComments(readFileSync(join(ROOT, f), 'utf8'));
    if (/slocO(?:f|fLine|deOfLine)?\w*\([^)]*'(?:STORE|FG WAREHOUSE)'/.test(s)) bad.push(`${f} — หาพื้นที่ของกองคลังผ่านการผูกไลน์`);
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

/* ═══ 🖱️ hover-intent-needs-settle — 2026-11-05 · feedback user ════════════════════════════
   *"ลากเม้าส์ผ่านไม่ตั้งใจดู ก็ขึ้นมาเกะกะ แต่จะเป็นเยอะตอนเลือกไลน์จาก dropdown ...
     มันเลยนับเวลาแช่เม้าสตั้งแต่ตอนเลือกไลน์รึป่าว"*
   ⇒ การ์ดสกิลห้ามติดนาฬิกาจาก `mouseenter` — ต้องรอ `mousemove` แล้วนิ่ง (settle)
     เพราะ Chromium ยิง `mouseenter` ให้เองเมื่อการ์ดถูก render มาโผล่ใต้เมาส์ที่วางนิ่งอยู่  */
test('🖱️ hover-intent-needs-settle — การ์ดสกิลต้องรอเมาส์นิ่ง ห้ามนับจาก mouseenter', () => {
  const bad = [];
  const s = stripComments(readFileSync(join(ROOT, 'src/pages/Management.jsx'), 'utf8'));
  const enter = s.slice(s.indexOf('const onHoverEnter ='), s.indexOf('const onHoverLeave ='));
  if (!enter) bad.push('หา onHoverEnter ไม่เจอ');
  if (/setTimeout/.test(enter)) bad.push('onHoverEnter ติดนาฬิกาเอง — ต้องรอ mousemove (ดูคอมเมนต์เคส ② ที่หัวบล็อก)');
  if (!/const onHoverMove =/.test(s)) bad.push('ไม่มี onHoverMove — ไม่มีทางรู้ว่าเมาส์ขยับจริง');
  if (!/armHover\(\)/.test(s)) bad.push('onHoverMove ไม่ติดนาฬิกา');
  const moveWired = (s.match(/onMouseMove=\{!isMobile \? onHoverMove/g) || []).length;
  if (moveWired < 2) bad.push(`การ์ดพนักงานผูก onMouseMove แค่ ${moveWired} จุด (ต้องครบทั้ง pool + จุดงาน)`);
  assert.deepEqual(bad, [], bad.join('\n'));
});

/* ═══ 🏭 line-registry-reload-reaches-every-page — 2026-11-09 · feedback user ════════════
   *"เราจะเจอปัญหาโหลดไลน์ไม่ขึ้นในหลายๆหน้า แต่เราเห็นมีหน้าเปิดกะที่มีไห้โหลดไลน์ใหม่
     แต่จุดอื่นไม่มี"*

   ต้นเหตุที่เจอ (2 บั๊กซ้อนกัน):
   ① ทะเบียน `KEYS_BY_TABLE.production_lines` ค้างที่ `production_lines:v2` ทั้งที่คีย์จริงคือ `:v3`
      (bump 13/10 ตอนเพิ่ม `unit_kind`) ⇒ `/line-setup` เซฟแล้วเรียก `invalidateTable()`
      = **ล้างคีย์ที่ตายแล้ว** · dropdown ไลน์ของหน้าอื่นค้างของเก่าถึง 4 ชม.
      ที่ด่านเดิมมองไม่เห็น: `cachedMaster(KEY, …)` เขียนคีย์เป็น**ตัวแปร**
      (ปิดช่องนี้แล้วใน `masterInvalidate.test.mjs` — เจอเพิ่มอีก 10 คีย์ที่หลุดแบบเดียวกัน)
   ② `failures` Map ใน masterCache **ไม่มีใครฟังได้** (มีแต่ failSink ตัวเดียวของ toast)
      ⇒ `<LineRegistryAlert />` ที่ mount ครั้งเดียวเหนือ `<Routes>` ไม่มีอะไรปลุก
        ทะเบียนล้มหลังเปิดแอป = ช่องเลือกว่างทั้งแอป **แถบเตือน + ปุ่มโหลดใหม่ไม่โผล่** */
test('🏭 line-registry-reload-reaches-every-page — ธงล้มต้อง subscribe ได้ + ล้างครบทุกคีย์ของไลน์', () => {
  const bad = [];

  // ① คีย์จริงของ picker ต้องอยู่ในทะเบียน (ถ้า bump คีย์แล้วลืม = invalidateTable ล้างผิดตัว)
  const upl = stripComments(readFileSync(join(ROOT, 'src/utils/useProductionLines.js'), 'utf8'));
  const key = /const KEY = '([^']+)'/.exec(upl)?.[1];
  const inv = stripComments(readFileSync(join(ROOT, 'src/utils/masterInvalidate.js'), 'utf8'));
  if (!key) bad.push('useProductionLines: หา const KEY ไม่เจอ');
  else if (!inv.includes(`'${key}'`)) bad.push(`masterInvalidate: ไม่มีคีย์ '${key}' ในทะเบียน — invalidateTable('production_lines') จะล้างผิดตัว`);

  // ล้างทะเบียนไลน์ต้องผ่านของกลาง (ครอบ :dr/:flow ของ /daily-report ด้วย) ห้ามล้างคีย์เดียว
  if (!/invalidateTable\('production_lines'\)/.test(upl))
    bad.push('invalidateProductionLines ไม่ได้ล้างผ่าน invalidateTable — ชั้นนอกของ /daily-report จะค้าง');

  // ② ทะเบียนผลล้มต้องแจ้งเตือนได้ และ useMasterRows ต้องฟัง
  const mc = stripComments(readFileSync(join(ROOT, 'src/utils/masterCache.js'), 'utf8'));
  if (!/export function onMasterFailChange\(/.test(mc))
    bad.push('masterCache: ไม่มี onMasterFailChange — ไม่มีใครรู้ว่าทะเบียนล้มหลังเปิดแอป');
  for (const [what, re] of [
    ['ตอนล้ม', /failures\.set\([\s\S]{0,200}?notifyFailChange\(/],
    ['ตอนสำเร็จ', /if \(failures\.delete\(key\)\) notifyFailChange\(key\)/],
  ]) if (!re.test(mc)) bad.push(`masterCache: ไม่ได้แจ้ง${what} — ธงเปลี่ยนแล้วจอไม่รู้`);

  const umr = stripComments(readFileSync(join(ROOT, 'src/utils/useMasterRows.js'), 'utf8'));
  if (!/onMasterFailChange\(/.test(umr))
    bad.push('useMasterRows: ไม่ subscribe onMasterFailChange — แถบเตือนจะตามสถานะไม่ทัน');
  /* 🔴 ตัวฟังห้ามยิงโหลดใหม่ — ทุกจอที่เปิดอยู่จะยิง DB พร้อมกันทั้งโรงงาน */
  const sub = umr.slice(umr.indexOf('onMasterFailChange('), umr.indexOf('const reload ='));
  if (/loader|setNonce/.test(sub))
    bad.push('useMasterRows: ตัวฟังสถานะล้มไปสั่งโหลดใหม่ — ทุกจอจะยิง DB พร้อมกัน');

  // แถบกลางต้องมีปุ่มโหลดใหม่ และปุ่มต้องล้างทุกคีย์ของไลน์ (ไม่ใช่แค่ reload() ของ picker)
  const alert = stripComments(readFileSync(join(ROOT, 'src/components/LineRegistryAlert.jsx'), 'utf8'));
  if (!/invalidateProductionLines\(\)/.test(alert))
    bad.push('LineRegistryAlert: ปุ่มโหลดใหม่ไม่ล้างทุกคีย์ของไลน์ — หน้าเปิดกะจะยังได้ลิสต์ว่างเดิม');
  const app = stripComments(readFileSync(join(ROOT, 'src/App.jsx'), 'utf8'));
  if (!/<LineRegistryAlert \/>/.test(app))
    bad.push('App.jsx: ถอด <LineRegistryAlert /> ออก — ไม่มีตาข่ายกลางแล้ว');

  assert.deepEqual(bad, [], bad.join('\n'));
});

test('🛡️ pr-board-folded-but-counts-visible — แผง PR พับไว้ แต่ตัวนับ/คำเตือนต้องเห็นตอนพับ', () => {
  const src = readFileSync(join(ROOT, 'src/components/MtnPurchase.jsx'), 'utf8');

  /* 🔴 คำสั่ง user 08/11 (จากจอมือถือ `/equipment?tab=spare`):
       *"พวก PR มันควร hide default ถ้าจะเยอะขนาดนี้ · KPI card มันควรอยู่บน
         พวกรายการเกิน 10 row มันควรมี show/hide และ hide default ไม่ใช่โชว์ทุกอย่าง"*
     แผงนี้มี 5 ลิสต์ซ้อนกัน (อะไหล่ติด Min จริง 58 แถว) ⇒ กางหมด = KPI คลังอะไหล่ตกจอไป 3 หน้าจอ
     🔑 แต่ "พับ" ห้ามแปลว่า "เงียบ" — ของหมด/โหลดไม่ครบต้องเห็นจากหัวที่พับอยู่ */
  const i = src.indexOf('<CollapseCard');
  assert.ok(i > 0,
    '\n\n❌ แผง PR ในคลังอะไหล่เลิกใช้ `CollapseCard` แล้ว\n'
    + '   ⇒ กลับไปกาง 5 ลิสต์ซ้อนกันทั้งแผง = KPI คลังอะไหล่ตกจอ (คำสั่ง user 08/11)\n');
  /* 🔑 หน้าต่างต้องจบ **ก่อน** children — ไม่งั้น `{err && <div>` ในเนื้อแผงมาตอบข้อล่างให้เอง
     (ด่านผ่านทั้งที่ย้ายตัวนับลงไปใน children แล้ว = ด่านหลอก) */
  const bodyStarts = src.indexOf('ลูปเดียวกับสโตร์', i);
  assert.ok(bodyStarts > i && bodyStarts - i < 2000,
    '\n\n❌ หาขอบเขต prop ของ <CollapseCard> ไม่เจอ — ด่านนี้วัดอะไรไม่ได้แล้ว ต้องแก้ด่าน\n');
  const head = src.slice(i, bodyStarts);

  assert.ok(/defaultOpen=\{false\}/.test(head),
    '\n\n❌ แผง PR ไม่ได้พับเป็นค่าเริ่มต้น (`defaultOpen={false}`)\n'
    + '   ⇒ user สั่งให้ hide default — แผงเตือนที่ซ้อนลิสต์ย่อยหลายอันห้ามกางทิ้งไว้\n'
    + '   📄 docs/UI-CONVENTIONS.md §ลิสต์เกิน 10 แถว = พับ\n');

  /* ตัวนับทั้ง 4 + ธงโหลดไม่สำเร็จ ต้องอยู่ใน `title` (ส่วนที่ CollapseCard วาดตอนพับ) */
  for (const [needle, what] of [
    ['needOrder.length', 'อะไหล่ติด Min ที่ยังไม่เปิด PR'],
    ['noPrMos.length', 'ใบ MO ที่รอเปิด PR'],
    ['waitNoList.length', 'ใบที่รอเลข PR จาก SAP'],
    ['hasNoList.length', 'PR ค้าง'],
    ['{err &&', 'ธง "โหลดไม่ครบ" (ต้องผูกกับ err)'],
    ['โหลดไม่ครบ', 'ข้อความธงโหลดไม่สำเร็จ'],
  ]) {
    assert.ok(head.includes(needle),
      `\n\n❌ หัวแผง PR (ตอนพับ) ไม่ได้โชว์ ${what}\n`
      + '   ⇒ พับแล้วตัวเลขหาย = จอโกหก (อะไหล่หมด/คิวค้าง ไม่มีใครรู้ว่าต้องกางมาดู)\n'
      + '   ⇒ ตัวนับต้องอยู่ใน prop `title` ไม่ใช่ใน children ของ CollapseCard\n');
  }

  /* ทุกลิสต์ย่อยพับแถวด้วยของกลางตัวเดียว ห้ามก๊อป slice เอง */
  const folds = src.match(/<RowFold\b/g) || [];
  assert.ok(folds.length >= 4,
    `\n\n❌ ลิสต์ย่อยในแผง PR ใช้ <RowFold> แค่ ${folds.length} จุด (ต้อง ≥ 4)\n`
    + '   ⇒ ลิสต์ที่ยาวเกิน 10 แถวกลับไป render แบนทั้งก้อน (อะไหล่ติด Min 58 แถว)\n');
  assert.ok(!/\.slice\(0,\s*(8|10|12|15|20)\)/.test(src),
    '\n\n❌ มี `.slice(0, N)` เขียนมือในแผง PR — ตัดแถวเงียบๆ ไม่บอกว่าซ่อนกี่รายการ\n'
    + '   ⇒ ใช้ <RowFold> (`components/RowFold.jsx`) ซึ่งเขียน "ซ่อนอยู่ N" ให้เสมอ\n');
});

test('🛡️ row-fold-must-report-hidden — ตัวพับแถวของกลางต้องบอกจำนวนที่ซ่อน', () => {
  const src = readFileSync(join(ROOT, 'src/components/RowFold.jsx'), 'utf8');
  /* 🔑 ต้องเจอใน **template literal ที่วาดออกจอ** — เทียบแค่คำว่า "ซ่อนอยู่" ลอยๆ
     คอมเมนต์หัวไฟล์ตอบให้เองได้ (ด่านผ่านทั้งที่ปุ่มเลิกบอกจำนวนแล้ว) */
  assert.ok(/`[^`]*ซ่อนอยู่ \$\{hidden\}[^`]*`/.test(src),
    '\n\n❌ `RowFold` เลิกเขียนว่าซ่อนอยู่กี่แถวบนปุ่ม\n'
    + '   ⇒ ตัดแถวออกจากจอแล้วเงียบ = จอโกหก (กฎ "กรองแถวออกแล้วต้องเขียนว่าซ่อนกี่รายการ")\n');
  assert.ok(/hidden\s*=\s*Math\.max\(0,\s*list\.length\s*-\s*max\)/.test(src),
    '\n\n❌ `RowFold` ไม่ได้นับจำนวนที่ซ่อนจาก (ทั้งหมด − ที่โชว์)\n');
  assert.ok(/export const ROW_FOLD_MAX\s*=\s*10/.test(src),
    '\n\n❌ เกณฑ์ `ROW_FOLD_MAX` ไม่ใช่ 10 แล้ว — user กำหนด "เกิน 10 row" (08/11)\n'
    + '   ⇒ อยากได้เกณฑ์อื่นในบางจอให้ส่ง prop `max` ที่จอนั้น ห้ามขยับค่ากลาง\n');
});

test('🛡️ spare-registry-table-not-flat — ทะเบียนอะไหล่ 295 แถวห้าม render แบนทั้งก้อน', () => {
  const src = readFileSync(join(ROOT, 'src/components/SparePartMaster.jsx'), 'utf8');

  /* 🔴 ภาพหน้างาน 08/11 (มือถือ): ทะเบียน 295 รายการ × รูป 1 ใบต่อแถว ไหลยาวทั้งหน้า
     ⇒ เลื่อนไม่จบ + DOM หนัก · user: "พวกรายการเกิน 10 row มันควรมี show/hide"
     🔑 แต่ตารางนี้คือเหตุผลที่หน้านี้มีอยู่ ⇒ หางยาว (50) ไม่ใช่ 10 และห้ามพับทั้งก้อน */
  assert.ok(/<RowFold rows=\{filtered\}[^>]*colSpan=\{13\}/.test(src),
    '\n\n❌ ตารางทะเบียนอะไหล่กลับไป `filtered.map()` แบนทั้งก้อน (หรือลืม colSpan)\n'
    + '   ⇒ 295 แถวไหลยาวทั้งหน้าบนมือถือ · ปุ่มเปล่าใน <tbody> = HTML ผิด ปุ่มเด้งออกนอกตาราง\n'
    + '   📄 docs/UI-CONVENTIONS.md §ลิสต์เกิน 10 แถว = พับ (ข้อ "ตารางหลักของหน้า")\n');

  assert.ok(/<RowFold rows=\{filtered\} max=\{50\}/.test(src),
    '\n\n❌ ทะเบียนอะไหล่ไม่ได้ใช้หางยาว `max={50}`\n'
    + '   ⇒ ตัดทะเบียนเหลือ 10 แถว = ทะเบียนใช้งานไม่ได้ (คนละเคสกับลิสต์เตือนที่ซ้อนกัน)\n');

  assert.ok(!/<CollapseCard[^>]*>\s*<table/.test(src),
    '\n\n❌ เอาตารางทะเบียนไปพับทั้งก้อนใน CollapseCard — ห้าม (ตารางหลักของหน้า)\n');
});

test('🛡️ machine-key-stray-mark-base-includes-vowels — ฐานของ "มาร์คลอย" ต้องรวมสระ', () => {
  const js = readFileSync(join(ROOT, 'src/utils/machineNo.js'), 'utf8');

  /* 🔴 เคสจริง 09/11: รอบแรกเขียนฐานเป็น [^ก-ฮ] (พยัญชนะล้วน)
     ⇒ ตัดวรรณยุกต์ที่ซ้อนบน "สระ" ทิ้งด้วย: เครื่อง→เครือง · ติดตั้ง→ติดตัง · เบนดิ่ง→เบนดิง
     จับได้เพราะพรีวิวคอลัมน์ผลลัพธ์ก่อน update · ถ้าไม่พรีวิว = ทำลายชื่อไทยทั้งฐานเงียบๆ */
  assert.ok(/\[\^\\u0E01-\\u0E4E\]/.test(js),
    '\n\n❌ ฐานของ STRAY_THAI_MARK ใน machineNo.js ไม่ใช่ [^\\u0E01-\\u0E4E]\n'
    + '   ⇒ ถ้าแคบลงเหลือพยัญชนะ (\\u0E2E) จะกินวรรณยุกต์ที่ซ้อนบนสระ:\n'
    + '      เครื่อง→เครือง · ติดตั้ง→ติดตัง · เบนดิ่ง→เบนดิง (ชื่อ/อาการภาษาไทยพังทั้งฐาน)\n'
    + '   📄 supabase/migrations/20261109b_machine_no_strip_stray_thai_marks_dr.sql\n');

  assert.ok(/stripStrayThaiMarks/.test(js) && /machineKey/.test(js),
    '\n\n❌ machineNo.js ไม่มี stripStrayThaiMarks แล้ว — machineKey จะไม่ยุบ typo มาร์คลอย\n'
    + '   ⇒ `ฺBD-08` แตกเป็นคนละแท่งกับ `BD-08` ในพาเรโต/MTBF/KPI ช่าง อีกครั้ง\n');

  /* ตรรกะต้องตรงกับฝั่ง SQL — คนละไฟล์ แก้ข้างเดียว = คีย์ 2 ชุด เถียงกันว่าเชื่อจอไหน */
  const sql = readFileSync(join(ROOT, 'supabase/migrations/20261109c_machine_key_strip_stray_thai_marks_dr.sql'), 'utf8');
  for (const part of ['\\u0E01-\\u0E4E', '\\u0E31\\u0E34-\\u0E3A\\u0E47-\\u0E4E']) {
    assert.ok(js.includes(part) && sql.includes(part),
      `\n\n❌ ช่วงอักขระ ${part} ไม่ตรงกันระหว่าง machineNo.js กับ machine_key() ฝั่ง SQL\n`
      + '   ⇒ จอกับ DB จัดกลุ่มเครื่องคนละแบบ = ตัวเลขไม่ตรงกันโดยไม่มีใครรู้\n');
  }
});

/* ═══ 📝 เปิดใบซ่อมจาก Downtime = ฟอร์มเต็ม + รูปบังคับ (2026-11-08 · คำสั่ง user) ═══
   *"เปิดใบแจ้งซ่อมจากดาวน์ไทม์ ต้องไม่เด้งเปิดทันที ต้องป๊อปอัพแนบรูปบังคับ และใส่รายละเอียดให้ชัดเจน"*
   เดิม DailyReport insert `mtn_orders` เองจากป๊อปอัพเลือกทีม (อาการ = ชื่อประเภท DT · รูปไม่บังคับ)
   ⇒ ห้ามกลับไป insert เองในหน้า · ต้องผ่าน `MoReportFromDowntime` (ReportModal ตัวเดียวกับหน้าแจ้งซ่อม) */
test('📝 Daily Report ห้าม insert mtn_orders เอง — เปิดใบจาก Downtime ต้องผ่านฟอร์มเต็ม (requireBefore)', () => {
  const dr = stripComments(readFileSync(join(ROOT, 'src/pages/DailyReport.jsx'), 'utf8'));
  assert.doesNotMatch(dr, /from\(\s*['"]mtn_orders['"]\s*\)\s*\.insert/,
    '\n\n❌ DailyReport.jsx insert mtn_orders เอง — ใช้ <MoReportFromDowntime> (ฟอร์มเต็ม + รูปบังคับ) แทน\n');
  const mr = stripComments(readFileSync(join(ROOT, 'src/pages/MtnRepair.jsx'), 'utf8'));
  assert.match(mr, /export function MoReportFromDowntime[\s\S]*?requireBefore\b/,
    '\n\n❌ MoReportFromDowntime ต้องส่ง requireBefore ให้ ReportModal (รูปก่อนซ่อมบังคับ)\n');
  assert.match(mr, /if \(requireBefore && !beforeFile\) return toast\.error/,
    '\n\n❌ ReportModal ต้องบล็อกการบันทึกเมื่อ requireBefore แต่ไม่มีรูป\n');
});

test('✍️ signature-no-blank-save — โมดัลลายเซ็นห้ามบันทึกกระดาษเปล่า', () => {
  /* 09/11 เคสจริง: กด "บันทึก" บนกรอบวาดเปล่าได้ ⇒ โปรไฟล์ได้รูปขาวล้วน แล้วทุกใบที่ดึงลายเซ็นสด
     จากโปรไฟล์ (utils/signResolve.js) ขึ้นว่างหมด รวมใบเก่า ("เซ็นไม่ติด ลายเซ็นเก่าก็หาย") */
  const s = stripComments(readFileSync(join(ROOT, 'src/components/SignatureModal.jsx'), 'utf8'));
  const save = s.slice(s.indexOf('const handleSave ='), s.indexOf('setSaving(true)', s.indexOf('const handleSave =')));
  assert.ok(/tab === 'draw' && !hasInk\.current/.test(save), 'handleSave ต้องเช็ค hasInk ก่อนบันทึกแท็บวาด');
  assert.ok(/hasInk\.current = true/.test(s), 'startDraw ต้องตั้ง hasInk = true');
});

/* ═══ 🔴 "ยังหยุดอยู่" ต้องมีกะที่ยังเปิดรองรับ — dt-open-needs-session-status (2026-11-09) ═══
   เคสจริงที่หัวหน้าหน้างานแจ้ง: Robot (Alarm/Error) ไลน์ D4 03/11 · กะถูกอนุมัติปิด 04/11
   แต่แถว downtime ยังเปิดค้าง ⇒ จอ OEE รายไลน์กระพริบ "🔴 ยังหยุดอยู่" ค้าง 147 ชม.
   (ทั้งโรงงานมี 6 แถวแบบนี้ เก่าสุด 3,322 ชม.) · และ **ไม่ไหลไปกะใหม่** — ต่อกะหน้าเกิดเฉพาะ
   `carry_over=true` ที่คนเลือกตอนปิดกะเท่านั้น ⇒ ค้างถาวรจนมีคนไปปิดมือ
   ⇒ จอที่รู้สถานะกะ ต้องตัดสินผ่าน `dtOpenKind(d, sessionStatus)` ห้ามอ่าน `ended_at` ลอยๆ */
test('🔴 dt-open-needs-session-status — จอที่โชว์ "ยังหยุดอยู่" ต้องใช้ dtOpenKind', () => {
  const rules = readFileSync(join(ROOT, 'src/utils/downtimeRules.js'), 'utf8');
  assert.match(rules, /export function dtOpenKind\(d, sessionStatus\)/,
    '\n\n❌ ถอด dtOpenKind ออกจาก utils/downtimeRules.js — นิยาม "ลืมปิดรายการ" ต้องอยู่ที่เดียว\n');
  assert.match(rules, /SESSION_STATUSES_LIVE\.includes\(sessionStatus\)/,
    '\n\n❌ dtOpenKind ต้องตัดสินจาก SESSION_STATUSES_LIVE (utils/sessionStatus.js) ห้าม hardcode รายสถานะ\n');
  assert.match(rules, /if \(sessionStatus == null\) return 'unknown'/,
    '\n\n❌ ไม่รู้สถานะกะต้องคืน \'unknown\' — ห้ามบีบเป็น \'forgotten\' เงียบๆ (จะกลายเป็นซ่อน Andon จริง)\n');

  const board = stripComments(readFileSync(join(ROOT, 'src/pages/LineOeeBoard.jsx'), 'utf8'));
  assert.match(board, /const kind = dtOpenKind\(d2, d2\._sessStatus\)/,
    '\n\n❌ Alarm History บน /line-oee กลับไปตัดสิน active จาก isOpenDT ลอยๆ\n'
    + '   ⇒ แถวที่ลืมปิดในกะที่ปิดไปแล้ว จะกระพริบ "ยังหยุดอยู่" ค้างเป็นเดือน (เคสจริง 09/11)\n');
  assert.doesNotMatch(board, /const active = isOpenDT\(/,
    '\n\n❌ /line-oee กลับไปใช้ `const active = isOpenDT(...)` — ต้องผ่าน dtOpenKind + สถานะกะ\n');
  assert.match(board, /C\.forgottenDt > 0 &&/,
    '\n\n❌ /line-oee ไม่ได้เขียนบนจอว่า "ไม่ได้ปิดรายการกี่ใบ" — ห้ามซ่อน (%A ของกะนั้นสูงกว่าจริง)\n');

  const vsm = stripComments(readFileSync(join(ROOT, 'src/lib/vsmLive.js'), 'utf8'));
  assert.match(vsm, /isOpenDT\(d\) && liveIds\.has\(d\.session_id\)/,
    '\n\n❌ vsmLive กลับไปนับ downtime เปิดค้างทุกกะเป็น Andon — ไลน์ที่ปิดกะแล้วจะแดงค้างทั้งวัน\n');
  assert.match(vsm, /forgottenDt/,
    '\n\n❌ vsmLive ต้องคืน forgottenDt ให้จอเขียนบอก (ไม่ใช่ Andon แต่ห้ามซ่อน)\n');

  const dept = stripComments(readFileSync(join(ROOT, 'src/pages/DeptDashboard.jsx'), 'utf8'));
  assert.doesNotMatch(dept, /const isOpenDT = \(d\) =>/,
    '\n\n❌ DeptDashboard ก๊อป isOpenDT มาไว้ในหน้า — นิยามอยู่ utils/downtimeRules.js ที่เดียว\n');
  assert.match(dept, /dtOpenKind\(x, sessStatusById\[x\.session_id\]/,
    '\n\n❌ การ์ด "เครื่องหยุดค้าง" ต้องแยกแถวที่ลืมปิดออกด้วย dtOpenKind\n');
});

/* ═══ 🔒 อนุมัติปิดกะ ต้องมีด่าน Downtime เปิดค้าง — approve-close-dt-gate (2026-11-09) ═══
   รูที่ทำให้เกิดแถวค้าง: ไลน์ "ขอปิดกะ" ตอนยังไม่มี downtime ใบนั้น (ด่านตอนขอปิดจึงผ่าน)
   → มีคนเพิ่ม downtime ทีหลังขณะใบอยู่ `pending_close` → SV กดอนุมัติ = ปิดทั้งที่แถวยังเปิดค้าง
   ⇒ `duration_min` null = หัก 0 นาที ⇒ กะนั้น stamp %A = 100% ทั้งที่ Robot Alarm ค้างอยู่ */
test('🔒 approve-close-dt-gate — handleApproveClose ต้องบล็อกเมื่อมี Downtime เปิดค้าง', () => {
  const src = stripComments(readFileSync(join(ROOT, 'src/pages/DailyReport.jsx'), 'utf8'));
  const i = src.indexOf('const handleApproveClose =');
  assert.ok(i > 0, 'ไม่พบ handleApproveClose');
  const body = src.slice(i, src.indexOf('supabase.auth.getUser()', i));
  assert.match(body, /dtLogs\.filter\(d => d\.duration_min == null && !d\.ended_at\)/,
    '\n\n❌ handleApproveClose ไม่มีด่าน "Downtime เปิดค้าง" (ด่านตอนขอปิดกะอย่างเดียวไม่พอ —\n'
    + '   downtime ที่ถูกเพิ่มหลังขอปิดกะจะหลุดเข้าไปปิดพร้อมกะ แล้วค้างถาวร · เคสจริง 09/11 ไลน์ D4)\n');
  assert.match(body, /if \(openDtNow\.length\) \{[\s\S]*?return;/,
    '\n\n❌ ด่านมีแต่ไม่ return — ต้องบล็อกการอนุมัติจริง ไม่ใช่แค่เตือน\n');
});

/* ═══ ⏩ Downtime ตัดยอดข้ามกะ ต้องส่งต่อ **2 ทาง** — dt-carry-two-ways (2026-11-09) ═══
   เดิมมีแต่ทาง "ดึงตอนเปิดกะ" (อ่านธง `carry_over` ของกะก่อน) ⇒ ใช้ได้เฉพาะเมื่อ
   **ปิดกะเก่าเสร็จก่อนเปิดกะใหม่** ซึ่งไม่ใช่ลำดับปกติของหน้างาน
   วัดจากฐานจริง: ใช้ฟีเจอร์นี้ 1 เคส (HDF1 24/08) — กะดึกเปิด 21:02 แต่กะเช้าปิด 21:55
   ⇒ ไม่เกิดแถวต่อเนื่องเลย (0/1) · เครื่องที่ยังซ่อมอยู่หายจากกะดึกทั้งกะ                */
test('⏩ dt-carry-two-ways — ส่ง Downtime ข้ามกะต้องมีทั้งทางดึง (เปิดกะ) และทางดัน (ปิดกะ)', () => {
  const src = stripComments(readFileSync(join(ROOT, 'src/pages/DailyReport.jsx'), 'utf8'));

  assert.match(src, /prevSessionOfLine\(openForm\.line_name, data\.id\)/,
    '\n\n❌ ทาง "ดึงตอนเปิดกะ" หาย — กะที่เปิดหลังกะเก่าปิดจะไม่ได้รับ Downtime ต่อเนื่อง\n');
  assert.match(src, /nextOpenSessionOfLine\(selSession\)/,
    '\n\n❌ ทาง "ดันตอนปิดกะ" หาย — กะถัดไปที่เปิดไปก่อนแล้ว (ลำดับปกติของโรงงาน)\n'
    + '   จะไม่ได้รับ Downtime ที่หัวหน้าเลือก "ยังซ่อมอยู่ ตัดยอดข้ามกะ" เลย (วัดจากฐานจริง 0/1 สำเร็จ)\n');
  assert.ok(src.split('carryDowntimesTo({').length - 1 >= 2,
    '\n\n❌ ต้องเรียก carryDowntimesTo ทั้ง 2 ทาง (เปิดกะ + ปิดกะ)\n');

  /* ห้ามกลืน error — เดิมทั้งก้อนอยู่ใน `catch {}` + ไม่เช็ค error ของคิวรีไหนเลย
     ⇒ อ่าน/เขียนพลาด = เปิดกะได้ปกติแต่ Downtime ต่อเนื่องหายเงียบ (ผิดกฎ "ห้ามล้มเหลวเงียบ") */
  assert.doesNotMatch(src, /\} catch \{ \/\* การรับ DT ต่อเนื่องล้มเหลวต้องไม่ล้มการเปิดกะ \*\/ \}/,
    '\n\n❌ กลับไปใช้ `catch {}` เปล่าในการรับ DT ต่อเนื่อง — ล้มแล้วต้อง toast บอก ห้ามเงียบ\n');

  const lib = stripComments(readFileSync(join(ROOT, 'src/lib/downtimeCarry.js'), 'utf8'));
  assert.match(lib, /pendingCarryRows\(carryRows, conts\)/,
    '\n\n❌ ถอดการกันซ้ำด้วย carried_from_id — เรียก 2 ทางแล้วจะได้แถวซ้ำในกะใหม่\n');
  assert.match(lib, /shiftWindow\(toSession\)/,
    '\n\n❌ เวลาเริ่มของแถวต่อเนื่องต้องมาจาก shiftWindow() (ภายในใช้ shiftStartDate)\n'
    + '   คิดเองจาก work_date = กะดึกที่เริ่ม 00:00-07:59 เขียน timestamp เร็วไป 1 วัน (หลุดกรอบกะ)\n');
  assert.doesNotMatch(lib, /\bduration_min\b|\bended_at\b|\bcall_mtn\b/,
    '\n\n❌ แถวต่อเนื่องห้ามก๊อป duration_min/ended_at (ต้องเป็นเปิดค้างจริง) หรือ call_mtn (ใบเก่าปิดไปแล้ว)\n');
});

/* ═══ 📤 ปิดใบข้ามไลน์ "ไม่ต้องยืนยัน" = log ต้องอ่านรู้เรื่อง — cross-close-log-readable ═══
   03/11 ถอดการกดยืนยันออกตามคำสั่ง user แล้วย้ายความปลอดภัยไปอยู่ที่ร่องรอยย้อนหลัง
   ⇒ แถว `CROSS_LINE_CLOSE` คือหลักฐานชิ้นเดียว · ใช้จริงแล้ว 25 ครั้ง (05-06/11 · 2,280 ชิ้น)
   หัวแถวของ AuditLogViewer บอกแค่ prod_no ⇒ ถ้าไม่กางรายละเอียด = มี log แต่ตรวจไม่ได้ */
test('📤 cross-close-log-readable — จอ audit ต้องกาง "ยอดเข้าไลน์ไหน · ปิดจากจอไลน์ไหน"', () => {
  const labels = readFileSync(join(ROOT, 'src/utils/auditLabels.js'), 'utf8');
  assert.match(labels, /CROSS_LINE_CLOSE:\s*\{/,
    '\n\n❌ ไม่มีป้ายไทยของ action CROSS_LINE_CLOSE — จอจะโชว์ชื่อ action ดิบ\n');

  const v = stripComments(readFileSync(join(ROOT, 'src/components/AuditLogViewer.jsx'), 'utf8'));
  assert.match(v, /r\.action === 'CROSS_LINE_CLOSE' &&/,
    '\n\n❌ AuditLogViewer ไม่กางรายละเอียดของการปิดใบข้ามไลน์\n'
    + '   (กิ่งเดิมกางเฉพาะ action UPDATE ⇒ แถวนี้เหลือแค่ prod_no = ตรวจย้อนหลังไม่ได้)\n');
  for (const k of ['owner_line', 'closed_from_line', 'qty_ok']) {
    assert.ok(v.includes(`new_data?.${k}`),
      `\n\n❌ รายละเอียดปิดใบข้ามไลน์ขาด \`${k}\` — ต้องตอบได้ว่ายอดเข้าไลน์ไหน/ใครปิดจากจอไลน์ไหน/กี่ชิ้น\n`);
  }

  /* ตัวจุด trigger อยู่ฝั่งจอ — ถอด stamp = trigger ไม่ยิง = log หายเงียบ (ไม่มี error ให้เห็น) */
  const dr = stripComments(readFileSync(join(ROOT, 'src/pages/DailyReport.jsx'), 'utf8'));
  assert.match(dr, /closed_from_line: selSession\?\.line_name/,
    '\n\n❌ doCrossLineClose ไม่ stamp closed_from_line — trigger trg_prod_order_cross_close_audit\n'
    + '   จะไม่ยิง ⇒ ปิดใบข้ามไลน์ได้โดยไม่มี log เลย (ซึ่งเป็นด่านเดียวที่เหลือหลังถอดการยืนยัน)\n');
});

test('🛡️ pm-notify-via-single-source — แจ้งเตือนผลตรวจต้องผ่านของกลาง ห้ามหาผู้รับเอง', () => {
  /* 🔑 ต้องตัดคอมเมนต์ก่อน — ไฟล์นี้อธิบายเหตุผลไว้ยาว คำว่า `notifyEvent()` / `extra_user_ids`
     โผล่ในคอมเมนต์ด้วย ⇒ เทียบกับไฟล์ดิบ = ด่านผ่านทั้งที่โค้ดถูกถอดออกแล้ว (เคยพลาดจริงรอบแรก) */
  const src = stripComments(readFileSync(join(ROOT, 'src/lib/pmNotify.js'), 'utf8'));

  /* 🔴 เคสจริง 09/11: `notifyDepartment()` รับ `department` มาแต่ใช้แค่เลือกคีย์สิทธิ์
     แล้วดึง profiles ด้วย role ล้วน ⇒ ใบ "ผลตรวจ NG" ยิงถึง 83 คน ข้าม 12 ส่วนงาน
     และเพราะไม่ผ่าน notify_recipients ⇒ ค่าใน /notification-config ไม่มีผล
     + ตัวกรอง mute ของผู้ใช้ไม่ทำงาน (กฎ CLAUDE.md §Edge Functions) */
  assert.ok(/notifyEvent\(/.test(src),
    '\n\n❌ pmNotify ไม่ได้ยิงผ่าน notifyEvent — ผู้รับจะไม่ผ่าน notify_recipients\n'
    + '   ⇒ ตั้งค่าใน /notification-config ไม่มีผล · คนที่ปิดแจ้งเตือนเรื่องนี้ยังได้รับ\n');

  assert.ok(!/\.in\(\s*['"]role['"]/.test(src),
    '\n\n❌ กลับไปดึง profiles ด้วย role ล้วน — นั่นคือบั๊กเดิม (83 คน / 12 ส่วนงาน ต่อ 1 ใบ)\n');

  /* ช่างของทีมส่งผ่านช่อง "เจ้าของงาน" เพราะแกนทีมกับส่วนงานใน RPC เป็น AND
     (ส่ง p_team = หัวหน้าส่วนงานหลุด · ไม่ส่ง = ช่างหลุด — วัดจริง PD3+jig: 12 vs 14) */
  assert.ok(/extra_user_ids:\s*owners/.test(src),
    '\n\n❌ ไม่ได้ส่งช่างของทีมผ่าน extra_user_ids — ช่างจะหลุดจากผู้รับ\n'
    + '   (ส่วนงานของช่างคือ JIG MTN/Die MTN ไม่ตรงกับส่วนงานของอุปกรณ์ จึงตกตัวกรอง match_section)\n');

  /* edge ตัด extra_user_ids ที่ 20 — ตัดแล้วเงียบ = ช่างบางคนไม่รู้ว่ามีงาน */
  assert.ok(/ownersCapped/.test(src),
    '\n\n❌ ไม่ได้บอกว่ารายชื่อช่างถูกตัดที่ 20 คน — ตัดแล้วเงียบ = ช่างไม่รู้ว่ามีใบ NG\n');

  const page = stripComments(readFileSync(join(ROOT, 'src/pages/PMCheckData.jsx'), 'utf8'));
  assert.ok(/ownersCapped/.test(page),
    '\n\n❌ หน้าจอไม่ได้เตือนเมื่อรายชื่อช่างถูกตัด (จอต้องไม่โกหกว่าส่งครบ)\n');
  assert.ok(/event:\s*'pm_inspection_ng'/.test(page),
    '\n\n❌ ไม่ได้ส่ง event key — edge จะตอบ 400 แล้วแจ้งเตือนหายทั้งใบ\n');
});

test('🔊 siren-call-mtn-needs-team — ไซเรน "เรียกช่าง" ต้องรู้ขอบเขตทีมของจอเสมอ', () => {
  /* 🔴 feedback หน้างาน 09/11: "เรียกช่างแผนกอื่น แต่ตัวเองก็เห็น alarm"
     ต้นเหตุ: `/mtn-machine-layout` mount <DowntimeSiren mode="call_mtn" /> **โดยไม่ส่ง team**
     ⇒ ช่าง JIG ที่เปิดหน้านี้ได้ยินเสียงเรียกของทีม DIE/Maintenance ทุกใบ
     (ต่างจาก MtnAndonBoard ที่ออกแบบชิปเลือกทีมไว้ตั้งแต่แรก)
     ⚠️ เสียงมาจาก downtime_logs ตรงๆ **ไม่ใช่** notifications.type — แก้ type ไม่ช่วยอะไร */
  const files = ['src/pages/MtnMachineLayout.jsx', 'src/components/MtnAndonBoard.jsx',
                 'src/pages/Dashboard.jsx', 'src/pages/Management.jsx'];
  let checked = 0;
  for (const f of files) {
    const src = stripComments(readFileSync(join(ROOT, f), 'utf8'));
    for (const m of src.matchAll(/<DowntimeSiren\b[^/>]*\/?>/g)) {
      const tag = m[0];
      if (!/call_mtn|soundAll|'all'/.test(tag)) continue;   // โหมดเครื่องหยุดเฉยๆ ไม่ต้องกรองทีม
      checked++;
      assert.ok(/\bteam=/.test(tag),
        `\n\n❌ ${f}: <DowntimeSiren> โหมดเรียกช่างไม่ได้ส่ง prop \`team\`\n`
        + '   ⇒ จอนี้จะดังทุกทีม — ช่างทีมอื่นโดนเสียงเรียกที่ไม่ใช่ของตัวเอง\n'
        + `   แท็กที่เจอ: ${tag}\n`);
    }
  }
  assert.ok(checked >= 2,
    `\n\n❌ หา <DowntimeSiren> โหมดเรียกช่างเจอแค่ ${checked} จุด (ต้อง ≥ 2)\n`
    + '   ⇒ ด่านนี้วัดอะไรไม่ได้แล้ว (ย้ายไฟล์/เปลี่ยนชื่อ component?) ต้องแก้ด่าน\n');

  /* ตัวกรองต้องรับได้ทั้ง key เดียวและหลายทีม — ช่างที่สังกัด 2 ทีมต้องไม่ได้ยินทีมที่ 3 */
  const siren = stripComments(readFileSync(join(ROOT, 'src/components/DowntimeSiren.jsx'), 'utf8'));
  assert.ok(/Array\.isArray\(team\)/.test(siren),
    '\n\n❌ DowntimeSiren รับ team เป็น key เดียวเท่านั้น — ช่างหลายทีมจะถูกบีบเหลือทีมเดียวหรือได้ยินหมด\n');
  /* ใบที่ไม่ระบุทีม = ดังทุกห้อง (fail-open) — ห้ามเปลี่ยนเป็น fail-closed (เงียบ = อันตรายกว่า) */
  assert.ok(/if \(!got\) return true/.test(siren),
    '\n\n❌ ใบที่ไม่ระบุทีมถูกกรองทิ้ง — เงียบเพราะข้อมูลไม่ครบ อันตรายกว่าดังเกิน\n');
});

test('🔇 notify-rollup-never-for-call-mtn — ห้ามยุบใบ "เรียกช่าง"', () => {
  /* 🔴 09/11 ตอนลดเสียงรบกวน: ตั้ง inapp_rollup_min ให้ `mtn_approved`/`skill_levelup_request`
     (คิวงาน — เข้าจอทีเดียวเคลียร์ทั้งชุด) แต่ `downtime_call_mtn` **ห้ามยุบเด็ดขาด**
     *"เรียกช่างครั้งแรก ทุกใบต้องดัง"* (send-notification/index.ts)
     ยุบ = เครื่องหยุด 2 ตัวกลายเป็นการ์ดเดียว ⇒ ช่างไปไม่ครบ ⇒ สายหยุดต่อ

     หลักตัดสิน: ยุบได้เมื่อเป็น **คิวงาน** · ห้ามยุบเมื่อเป็น **สัญญาณต่อเหตุการณ์**
     📄 docs/modules/notify-inapp-audit.md §รอบ 6                                         */
  const dir = join(ROOT, 'supabase/migrations');
  const files = readdirSync(dir).filter(f => f.endsWith('.sql'));
  assert.ok(files.length > 50,
    `\n\n❌ อ่าน supabase/migrations/ ได้แค่ ${files.length} ไฟล์ — ด่านนี้วัดอะไรไม่ได้แล้ว\n`);

  for (const f of files) {
    const sql = readFileSync(join(dir, f), 'utf8');
    if (!/downtime_call_mtn/.test(sql)) continue;
    /* ตัดคอมเมนต์ /* *\/ ออกก่อน — เอกสารในหัวไฟล์พูดถึงกฎนี้ได้ (ไฟล์นี้เองก็พูด) */
    const code = sql.replace(/\/\*[\s\S]*?\*\//g, ' ');
    if (!/downtime_call_mtn/.test(code)) continue;          // พูดถึงแต่ในคอมเมนต์ = ผ่าน
    assert.ok(!/inapp_rollup_min/.test(code),
      `\n\n❌ ${f}: ตั้ง inapp_rollup_min ในคำสั่งที่แตะ downtime_call_mtn\n`
      + '   ⇒ ใบเรียกช่างจะถูกยุบรวมกัน — เครื่องหยุด 2 ตัวเหลือการ์ดเดียว ช่างไปไม่ครบ\n'
      + '   ถ้าคิวรีนี้ไม่ได้ตั้ง rollup ให้ downtime_call_mtn จริง ให้แยกเป็น 2 คำสั่งคนละ UPDATE\n');
  }
});

/* ═══ 🔴 ปิดกะต้องทวน Downtime เปิดค้างทีละใบ — close-shift-dt-confirm (2026-11-10) ═══
   คำสั่ง user: *"ก่อนปิดกะต้องเช็คเรื่องไม่ปิดดาวไทม์ ป๊อปอัพให้ยืนยันว่าเครื่องยังเบรกดาวน์อยู่
   ส่งต่อไปกะถัดไป หรือลืมปิดให้ไปใส่เวลาปิด"*
   ที่มา: ตัวเลือกเดิมเป็นหัวข้อกลางโมดัลปิดกะที่ยาวมาก ⇒ เลื่อนผ่านแล้วกดปิดกะได้
   ผลคือแถว downtime "ลืมปิด" ค้างในฐาน 6 ใบ นานถึง 3,322 ชม. (ดู docs/modules/daily-report.md) */
test('🔴 close-shift-dt-confirm — ปิดกะที่มี Downtime เปิดค้าง ต้องผ่านป๊อปอัพทวนก่อนเขียน DB', () => {
  const src = stripComments(readFileSync(join(ROOT, 'src/pages/DailyReport.jsx'), 'utf8'));

  // รับพารามิเตอร์เพิ่มได้ (เช่น `recheckDone` ของด่าน poka-yoke 11/11) แต่ `dtConfirmed` ต้องยังอยู่
  assert.match(src, /const handleCloseSession = async \(\{ dtConfirmed = false[^)]*\} = \{\}\s*\) =>/,
    '\n\n❌ handleCloseSession ไม่รับ dtConfirmed — ป๊อปอัพทวนจะเรียกกลับมาปิดจริงไม่ได้\n');
  assert.match(src, /if \(openDT\.length > 0 && !dtConfirmed\) \{ setDtCloseConfirm\(openDT\); return; \}/,
    '\n\n❌ ถอดด่านป๊อปอัพทวน Downtime เปิดค้างออกจาก handleCloseSession\n'
    + '   ⇒ กลับไปปิดกะได้โดยไม่เห็นว่าใบไหนจะถูกส่งต่อกะถัดไป/ปิดที่เวลาเท่าไหร่\n');

  /* ด่านต้องอยู่ "ก่อน" ตัวเขียนจริง — ย้ายลงไปหลัง setSavingClose = ไม่ได้กันอะไรเลย */
  const i = src.indexOf('const handleCloseSession =');
  const gate = src.indexOf('setDtCloseConfirm(openDT)', i);
  const write = src.indexOf('setSavingClose(true)', i);
  assert.ok(gate > 0 && write > 0 && gate < write,
    '\n\n❌ ด่านป๊อปอัพอยู่หลังจุดเริ่มเขียน DB — ต้องอยู่ก่อน setSavingClose(true)\n');

  /* ป๊อปอัพต้องบอกครบ 2 ทางตามคำสั่ง user: ส่งต่อกะถัดไป / ปิดที่เวลา */
  assert.match(src, /เครื่องยังเบรกดาวน์อยู่/,
    '\n\n❌ ป๊อปอัพไม่ได้เขียนว่า "เครื่องยังเบรกดาวน์อยู่" (ทางที่ 1 — ส่งต่อกะถัดไป)\n');
  assert.match(src, /เปิดรายการต่อให้กะถัดไป/,
    '\n\n❌ ป๊อปอัพต้องบอกว่าใบที่ยังเบรกดาวน์จะถูกเปิดต่อในกะถัดไป\n');
  assert.match(src, /ปิดรายการที่(?:'\)\})? \{endStr/,   // 🌐 13/11: รองรับ {tr('… ปิดรายการที่')} {endStr}
    '\n\n❌ ป๊อปอัพไม่ได้บอกเวลาปิดของใบที่ "เครื่องกลับมาแล้ว" (ทางที่ 2)\n');
});

/* ═══ ⏩ สแกนเปิดใบที่เกินเวลากะ — ห้ามขวางการยิงรัว (2026-11-10 · หน้างานแจ้ง) ═══
   *"เวลาสแกน order ล้นไปกะถัดไป ต้องกดคอนเฟิร์ม และทำให้ต้องคลิกช่อง prod order ใหม่ทุกใบ"*
   2 เรื่อง: ① ทาง "เกินเวลากะ" ไม่เคยคืนโฟกัสให้ช่องสแกน (ทางปกติคืนอยู่แล้ว)
   ⇒ เครื่องสแกนยิงเข้าช่องที่โฟกัสอยู่เท่านั้น = ต้องเอามือคลิกทุกใบ
   ② ใกล้เลิกกะ **ทุกใบจะเกินความจุหมด** ⇒ โมดัลเด้งทุกใบ ⇒ ต้องเลือกครั้งเดียวแล้วจำได้ทั้งกะ */
test('⏩ scan-open-overflow-flow — ใบเกินเวลากะต้องคืนโฟกัส + จำคำตอบได้ทั้งกะ', () => {
  const src = stripComments(readFileSync(join(ROOT, 'src/pages/DailyReport.jsx'), 'utf8'));

  assert.match(src, /const refocusScanOpen = \(\) => setTimeout\(\(\) => openProdInputRef\.current\?\.focus\(\)/,
    '\n\n❌ ไม่มี refocusScanOpen — ทางที่จบการเปิดใบต้องคืนโฟกัสให้ช่อง PROD.NO ทุกทาง\n');
  const fn = src.slice(src.indexOf('const runOverflowChoice ='), src.indexOf('const handleCloseProdNoChange'));
  assert.ok(fn.length > 100, 'ไม่พบ runOverflowChoice');
  assert.ok((fn.match(/refocusScanOpen\(\)/g) || []).length >= 2,
    '\n\n❌ runOverflowChoice ไม่ได้คืนโฟกัสทุกทางออก (ทั้งสำเร็จและ error)\n'
    + '   ⇒ หน้างานต้องเอามือคลิกช่อง PROD.NO ใหม่ทุกใบ ยิง Tag รัวไม่ได้ (เคสจริง 10/11)\n');

  /* ทางเดียวกันทั้งปุ่มในโมดัลและโหมดที่จำไว้ — ห้ามแตกเป็น 2 ชุดแล้วลืมคืนโฟกัสฝั่งใดฝั่งหนึ่ง */
  assert.doesNotMatch(src, /const handleOverflowNextShift|const handleOverflowForce/,
    '\n\n❌ แตก handler ของใบเกินเวลากะกลับเป็น 2 ตัว — ต้องรวมที่ runOverflowChoice ตัวเดียว\n');
  assert.match(src, /if \(overflowMode === 'carry'\) \{ await runOverflowChoice\('carry',/,
    '\n\n❌ ถอดโหมด "จำคำตอบทั้งกะ" — ใกล้เลิกกะโมดัลจะเด้งทุกใบ ยิง Tag ต่อกันไม่ได้\n');

  /* 🔴 จำคำตอบได้ แต่ห้ามเงียบ และห้ามข้ามกะ */
  assert.match(src, /useEffect\(\(\) => \{ setOverflowMode\(null\); \}, \[selSession\?\.id\]\)/,
    '\n\n❌ ไม่ได้ล้างโหมดเมื่อเปลี่ยนกะ — ใบของกะใหม่จะถูกตัดสินใจแทนด้วยคำตอบของกะก่อน\n');
  assert.match(src, /\{overflowMode && \(/,
    '\n\n❌ เปิดโหมดแล้วไม่มีแถบบนจอ = ใบถูกยกไปกะหน้าเงียบๆ (ห้ามล้มเหลวเงียบ)\n');
  assert.match(src, /กลับไปถามทุกใบ/,
    '\n\n❌ ไม่มีปุ่มเลิกโหมด — ติ๊กพลาดแล้วออกไม่ได้จนกว่าจะเปลี่ยนกะ\n');
  assert.match(src, /โหมดจำคำตอบ/,
    '\n\n❌ toast ไม่ได้บอกว่าใบนี้ถูกจัดการด้วยโหมดที่จำไว้ (คนยิงรัวต้องรู้ว่าของไปไหน)\n');
});

/* ═══ ⏱️ "เปิด OT" มีเพดาน — ot-ceiling-auto-carry (2026-11-10 · คำสั่ง user) ═══
   *"กดเปิดโอที ใบหลังจากนั้นก็ลงไปที่ช่วง OT จนประมาณใบที่ 4 เห็นว่าใช้เกิน OT ไปอีก
     ใบถัดๆ ไปให้โยนไปกะถัดไปอัตโนมัติเลย"*
   ⇒ ความจุมี 2 ชั้น: เพดานกะ → เพดาน OT · เกินชั้น 2 = ส่งกะถัดไป ห้ามเปิดต่อ
   (เปิดต่อ = รับงานที่ไม่มีเวลาทำ แล้วไปโผล่เป็นใบค้างตอนปิดกะอยู่ดี) */
test('⏱️ ot-ceiling-auto-carry — โหมด OT ต้องมีเพดาน แล้วสลับเป็นส่งกะถัดไปเอง', () => {
  const cap = readFileSync(join(ROOT, 'src/utils/shiftCapacity.js'), 'utf8');
  assert.match(cap, /export function otSpanMin\(/,
    '\n\n❌ ถอด otSpanMin — โควต้า OT ต้องมีเจ้าของกฎใน utils/shiftCapacity.js\n');
  assert.match(cap, /WEEKDAY_OT_TIME/,
    '\n\n❌ โควต้า OT ต้องอ่านจากทะเบียนกลาง WEEKDAY_OT_TIME (utils/otPeriods.js) ห้าม hardcode นาที\n');
  assert.doesNotMatch(stripComments(cap), /\b150\b/,
    '\n\n❌ hardcode นาที OT ไว้ใน shiftCapacity.js — เปลี่ยนนโยบายแล้วตัวเลขจะไม่ขยับตาม\n');

  const src = stripComments(readFileSync(join(ROOT, 'src/pages/DailyReport.jsx'), 'utf8'));
  assert.match(src, /if \(overflowMode === 'force'\)/,
    '\n\n❌ โหมด OT กลับไปเปิดใบทุกใบโดยไม่เช็คเพดาน OT\n');
  assert.match(src, /const otOver = checkOtCapacity\(\{/,
    '\n\n❌ ไม่ได้เช็คโควต้า OT ด้วย checkOtCapacity ก่อนเปิดใบในโหมด OT\n');
  assert.match(src, /if \(!otOver\) \{ await runOverflowChoice\('force'[\s\S]{0,80}await runOverflowChoice\('carry'/,
    '\n\n❌ เกินโควต้า OT แล้วต้องสลับเป็น carry อัตโนมัติ (ไม่ใช่เปิดต่อ/ไม่ใช่เงียบ)\n');
  assert.match(src, /โควต้า OT เต็มแล้ว/,
    '\n\n❌ สลับเป็นส่งกะถัดไปแล้วไม่บอก — คนยิงรัวจะนึกว่ายอดยังอยู่กะนี้ (ห้ามล้มเหลวเงียบ)\n');
});

test('🔀 insp-team-not-jig-only — ใบตรวจต้องแยกด้วยทีม ไม่ใช่ jig_id ล้วน', () => {
  /* 🔴 10/11 คำสั่ง user: "การตรวจ am/pm มาทับกัน ตอนนี้อ้างอิงแค่ id ของอุปกรณ์ มันปนกัน"
     เครื่องเดียวมี checklist ทั้ง AM และ PM เป็นเรื่องปกติของ TPM — วัดจริง DR 6 เครื่อง / 112 ใบ
     ดึงใบด้วย `jig_id` ล้วน = ได้ใบของทั้ง 2 ทีมปนกัน และถ้ามี limit ทีมที่ตรวจถี่กว่าจะกินช่อง
     จนใบของอีกทีมหลุดหาย (PF-H101: AM 22 ใบ · DIE MTN 1 ใบ — ช่างเคยเห็นใบตัวเอง 1 ใน 23)
     ⇒ ทุกคิวรี inspections ที่กรองด้วย jig_id ต้องมีแกนทีมกำกับในฟังก์ชันเดียวกัน
     📄 src/utils/pmTeams.js §1 อุปกรณ์ ตรวจได้หลายทีม · docs/modules/am-pm-linkage-audit.md */
  const TEAM_AXIS = /checklist_id|amClIds|clDept|teamsKnown|isAmTeam|amCls/;
  /* ยกเว้นโดยเจตนา: เด็คสรุปรายเดือนรายงาน "PM/AM ที่พบผิดปกติ" รวมกันทั้ง 2 ฝั่งโดยตั้งใจ
     (หัวข้อบนสไลด์เขียน PM/AM) — จะแยกต้องให้ user สั่ง เพราะเปลี่ยนเนื้อรายงานผู้บริหาร */
  const ALLOW = new Set(['src/lib/monthlyReviewPptx.js']);
  const files = [];
  for (const dir of ['src', 'supabase/functions']) walk(join(ROOT, dir), ['.js', '.jsx', '.ts'], files);
  let checked = 0;
  for (const f of files) {
    const rel = relative(ROOT, f);
    if (ALLOW.has(rel) || /__tests__/.test(rel) || !/\.(js|jsx|ts)$/.test(rel)) continue;
    const src = stripComments(readFileSync(f, 'utf8'));
    if (!/from\(['"]inspections['"]\)/.test(src)) continue;
    const lines = src.split('\n');
    lines.forEach((ln, i) => {
      if (!/\.(eq|in)\(['"]jig_id['"]/.test(ln)) return;
      /* ใบตรวจหรือเปล่า — ดูย้อนขึ้นไปว่าเป็นคิวรี inspections จริง */
      const back = lines.slice(Math.max(0, i - 4), i + 1).join('\n');
      if (!/from\(['"]inspections['"]\)/.test(back)) return;
      checked++;
      const win = lines.slice(Math.max(0, i - 25), i + 25).join('\n');
      assert.ok(TEAM_AXIS.test(win),
        `\n\n❌ ${rel}:${i + 1} — ดึงใบตรวจด้วย jig_id โดยไม่มีแกนทีมกำกับ\n`
        + '   ⇒ เครื่องที่มีทั้ง checklist AM และ PM จะได้ใบของทั้ง 2 ทีมปนกัน แยกไม่ออกว่าใบไหนของใคร\n'
        + '   แก้ยังไง: กรองด้วย checklist_id ของทีมนั้น (ถาม checklists.department ก่อนดึงใบ)\n'
        + '   หรือใช้ splitInspByTeam() จาก src/utils/pmTeams.js แล้วติดป้าย inspTeamLabel()\n');
    });
  }
  assert.ok(checked >= 1,
    `\n\n❌ หาคิวรี inspections ที่กรองด้วย jig_id ไม่เจอเลย (${checked}) — ด่านนี้วัดอะไรไม่ได้แล้ว\n`
    + '   ถ้าย้ายโค้ด/เปลี่ยนชื่อคอลัมน์จริง ต้องแก้ด่าน ไม่ใช่ปล่อยให้ผ่านเงียบ\n');
});

test('🔢 cp-number-not-tied-to-pin — เลขข้อ/โหมดทีละข้อ ห้ามผูกกับการปักหมุด', () => {
  /* 🔴 10/11 feedback หน้างาน (user: "ทำไมแพทเทินไม่เหมือนกัน · เห็นปนกันไปหมด")
     หน้า /pm-check-data เคยผูก 2 อย่างนี้ไว้กับ `x_pos` (พิกัดหมุดบนรูป):
       ① เลขข้อในแถว `{cp.x_pos != null && <span>{idx+1}</span>}` ⇒ เครื่องที่ยังไม่ปักหมุด
          (RB-109 ปัก 0/11) ทุกแถวไม่มีเลข ทั้งที่ชิป "ยังไม่ตรวจ" · สูตร "ข้อ N" · ปุ่มข้อก่อน/ถัดไป
          อ้างเลขนี้หมด ⇒ จับคู่ไม่ได้ว่าแถวไหนคือข้อไหน
       ② โหมดตรวจทีละข้อ `focusOn = ... && allPinned` ⇒ เครื่องที่ปักไม่ครบตกไปใช้ลิสต์ยาว
          = คนละหน้าตากับเครื่องข้างๆ ทั้งที่เป็นใบตรวจเหมือนกัน
     🔑 การปักหมุดจำเป็นแค่กับ "แตะหมุดบนรูปเพื่อเลือกข้อ" — ไม่ใช่กับเลขข้อหรือตัวโหมด */
  const src = stripComments(readFileSync(join(ROOT, 'src/pages/PMCheckData.jsx'), 'utf8'));

  assert.ok(!/x_pos\s*!=\s*null\s*&&\s*<span[^>]*>\{idx \+ 1\}/.test(src),
    '\n\n❌ เลขข้อในแถวถูกผูกกับ `cp.x_pos` อีกแล้ว — เครื่องที่ยังไม่ปักหมุดจะไม่มีเลขข้อเลย\n'
    + '   ชิป/สูตร/ปุ่มข้อก่อน-ถัดไป อ้างเลขนี้ทั้งหมด ⇒ คนตรวจจับคู่แถวกับเลขไม่ได้\n');

  const m = src.match(/const focusOn = [^\n]*/);
  assert.ok(m, '\n\n❌ หา `const focusOn =` ใน PMCheckData.jsx ไม่เจอ — ด่านนี้วัดอะไรไม่ได้แล้ว\n');
  assert.ok(!/allPinned/.test(m[0]),
    `\n\n❌ โหมดตรวจทีละข้อกลับไปบังคับว่าต้องปักหมุดครบ: ${m[0].trim()}\n`
    + '   ⇒ เครื่องที่ปักไม่ครบจะได้หน้าตาคนละแบบกับเครื่องอื่น (user สั่งให้แพทเทินเหมือนกัน 10/11)\n'
    + '   ใช้ allPinned ได้เฉพาะกับ "แตะหมุดบนรูป" และข้อความอธิบาย ไม่ใช่กับตัวโหมด\n');

  /* รูปของจุดตรวจขึ้นจอใหญ่ได้ แต่ห้ามวาดหมุดทับ (พิกัดหมุดเป็น % ของรูปเครื่อง คนละรูป) */
  assert.ok(/onCpPhoto/.test(src),
    '\n\n❌ ไม่มีทางดูรูปของจุดตรวจบนจอใหญ่แล้ว — รูปใหญ่จะค้างที่เฟรมแรกของเครื่องเหมือนเดิม\n');
  assert.ok(/imgBox && !onCpPhoto/.test(src),
    '\n\n❌ ชั้นหมุดไม่ได้กันออกตอนโชว์รูปของจุดตรวจ\n'
    + '   ⇒ หมุดจะถูกวาดทับรูปคนละรูปด้วยพิกัดของรูปเครื่อง = ชี้ผิดจุด (กฎ §5.1 UI-CONVENTIONS)\n');
});

test('🛡️ master-cache-auth-gate — ผลที่โหลดตอนไม่ได้ login ห้ามลง cache', () => {
  /* เคสจริง 10/11 (หน้างาน "โหลดไลน์ผลิต dropdown ไม่ขึ้น"): log Main 24 ชม. — `production_lines`
     อ่านแบบ anon 122 ครั้ง/28 IP ได้ 200 + 0 แถว ⇒ ลิสต์ว่างถูกจด 4 ชม. ⇒ คน login ถัดไป dropdown ว่าง
     ต้นเหตุ = ออกจากระบบ/สลับบัญชีแล้วหน้าที่ยัง mount โหลดทะเบียนใหม่ตอนไม่มี token
     📄 src/utils/masterCache.js §ประตู "ตอนนี้ใคร login อยู่" */
  const app = stripComments(readFileSync(join(ROOT, 'src/App.jsx'), 'utf8'));
  assert.match(app, /onAuthStateChange\(\(evt, s\) => \{\s*\n\s*setMasterAuthUser\(/,
    '🔴 onAuthStateChange ต้องบอก masterCache ว่าใคร login อยู่ (ไม่งั้นผลตอน anon ถูก cache)');
  assert.match(app, /getSession\(\)\.then\(\(\{ data: \{ session \} \}\) => \{\s*\n\s*setMasterAuthUser\(/,
    '🔴 getSession ตอนเปิดแอปต้องตั้งประตู masterCache');
  assert.match(app, /setMasterAuthUser\(null\);[^\n]*\n\s*clearAllMasterCache\(\);/,
    '🔴 handleLogout ต้องปิดประตูก่อนล้าง cache — ไม่งั้นหน้าที่ re-render จดลิสต์ว่างทับ');
  const ck = stripComments(readFileSync(join(ROOT, 'src/pages/Checkin.jsx'), 'utf8'));
  assert.match(ck, /setMasterAuthUser\(null\);[^\n]*\n\s*try \{ await supabase\.auth\.signOut/,
    '🔴 ปุ่มสลับบัญชีหน้าเช็คชื่อต้องปิดประตูก่อน signOut');
  const pl = stripComments(readFileSync(join(ROOT, 'src/utils/useProductionLines.js'), 'utf8'));
  assert.match(pl, /if \(!data\?\.length\) throw new MasterLoadError/,
    '🔴 ทะเบียนไลน์ว่าง = อ่านไม่ได้ ต้องโยน ห้ามคืน [] ให้ลง cache');
  assert.match(pl, /\{ nonEmpty: true \}/, '🔴 ทะเบียนไลน์ต้องข้ามลิสต์ว่างที่ค้างใน cache (nonEmpty)');
});

/* ═══ 🪪 badge-scan-saves-now — 2026-11-10 · คำสั่ง user ═══════════════════════════════════
   *"มันควรจะเช็คมาเลยมั้ยแบบนี้ ตอนนี้ไม่เห็นใช้ได้"* — ยิงบัตร 1 ใบ = ลงฐานทันที 1 แถว
   3 อย่างที่ห้ามหลุด: ① หน้าเขียนจริงและเช็คจำนวนแถว ② ScanModal ต้อง await (ไม่งั้นขึ้นเขียว
   ก่อนรู้ผล = จอบอกสำเร็จทั้งที่เขียนล้ม) ③ ตัวนับในหน้าต่างสแกนห้าม hardcode "ยังไม่ได้บันทึก"  */
test('🪪 badge-scan-saves-now — สแกนบัตรต้องเขียนลงฐานทันที + จอต้องบอกผลจริง', () => {
  const bad = [];
  const ck = stripComments(readFileSync(join(ROOT, 'src/pages/Checkin.jsx'), 'utf8'));
  const fn = ck.slice(ck.indexOf('const onBadgeScan'), ck.indexOf('badgeScanRef.current ='));
  if (!/const onBadgeScan = async/.test(fn)) bad.push('onBadgeScan ไม่ใช่ async — เขียนฐานไม่ได้');
  if (!/upsertCheckin\(/.test(fn)) bad.push('onBadgeScan ไม่เขียนลงฐาน (กลับไปติ๊กบนจอเฉยๆ)');
  if (!/ckLogRow\(/.test(fn)) bad.push('onBadgeScan ประกอบแถวเอง — ต้องใช้ ckLogRow ชุดเดียวกับปุ่มบันทึก');
  // ❌ เขียนไม่ติดแล้วยังติ๊กบนจอ = จอบอกเช็คแล้วทั้งที่ฐานว่าง
  const okIdx = fn.indexOf('if (!okRow)'), setIdx = fn.indexOf('setAttendance(');
  if (okIdx < 0 || setIdx < 0 || okIdx > setIdx) bad.push('ติ๊กบนจอก่อนรู้ผลการเขียน — ต้องเช็คผลก่อน setAttendance');

  const sm = stripComments(readFileSync(join(ROOT, 'src/components/ScanModal.jsx'), 'utf8'));
  if (!/problem = await res/.test(sm)) bad.push('ScanModal ไม่ await onScan ที่เป็น Promise — ขึ้นเขียวก่อนรู้ผลจริง');
  if (!/await emit\(/.test(sm)) bad.push('ลูปกล้องไม่ await emit — ยิงใบถัดไปทับระหว่างบันทึกใบแรก');

  const SCAN_RE = /<ScanModal title=(?:"สแกนบัตรพนักงาน"|\{tr\('สแกนบัตรพนักงาน'\)\})/;   // 🌐 13/11: title ครอบ tr() แล้ว
  const foot = ck.slice(ck.search(SCAN_RE), ck.search(SCAN_RE) + 2200);
  if (/ยังไม่ได้บันทึก<\/span>/.test(foot)) bad.push('ตัวนับในหน้าต่างสแกนยัง hardcode "ยังไม่ได้บันทึก" (จอโกหก)');
  if (!/scanSaved\.length/.test(foot)) bad.push('หน้าต่างสแกนไม่บอกว่ารอบนี้บันทึกไปกี่คน');
  assert.deepEqual(bad, [], bad.join('\n'));
});

/* ═══ 🪪 scan-landing-checkin — 2026-11-10 · คำสั่ง user ════════════════════════════════════
   *"ยิงบัตรแล้วขึ้น ✓ เช็คชื่อสำเร็จ พอ ไม่ต้องเปิดหน้าเช็คชื่อ"* ⇒ `/scan` เขียนฐานได้ **ข้อยกเว้นเดียว**
   ของกฎ "หน้านี้อ่านอย่างเดียว" · 2 อย่างที่ห้ามหลุด:
   ① สูตรแถวต้องเป็นของกลาง (`lib/checkinSave.js`) — ห้ามหน้าไหนประกอบ/ยิง upsert เอง
   ② `/scan` ยิงบัตรใครก็ได้ทั้งโรงงาน (ไม่มีรายชื่อมากรองเหมือน `/checkin`) ⇒ **ต้องเช็คขอบเขตชั้น ③ เอง**  */
test('🪪 scan-landing-checkin — /scan เช็คชื่อได้ แต่ต้องผ่านของกลาง + ด่านขอบเขตชั้น ③', () => {
  const bad = [];
  const sl = stripComments(readFileSync(join(ROOT, 'src/pages/ScanLanding.jsx'), 'utf8'));
  if (!/checkinByBadge\(/.test(sl)) bad.push('ScanLanding ไม่ได้เช็คชื่อผ่าน checkinByBadge (ของกลาง)');
  if (/from\('daily_production_logs'\)/.test(sl)) bad.push('ScanLanding แตะ daily_production_logs ตรงๆ — ต้องผ่าน lib/checkinSave.js');
  if (!/canWriteLine\(/.test(sl) || !/canWriteUnit\(/.test(sl))
    bad.push('ScanLanding ไม่เช็คขอบเขตชั้น ③ — ยิงบัตรคนแผนกอื่นแล้วเช็คชื่อให้ได้');
  // ด่านต้องอยู่ใน handler ที่เขียนจริง ไม่ใช่แค่ซ่อนปุ่ม (เปิด /scan?c=<รหัส> ตรงได้)
  const h = sl.slice(sl.indexOf('const doCheckin'), sl.indexOf('const doCheckin') + 1800);
  if (!/if \(!ckScope\?\.ok\)/.test(h)) bad.push('doCheckin ไม่มีด่านขอบเขตในฟังก์ชันที่เขียนจริง');
  if (h.indexOf('ckScope?.ok') > h.indexOf('checkinByBadge(')) bad.push('เช็คขอบเขตหลังเขียนไปแล้ว');
  // ctx ของด่านต้องครบ 2 แกน (write-scope-layer: ไม่ส่ง = ถอยไปใช้ section เงียบๆ)
  if (!/respCostCenters/.test(sl) || !/scopeIdx/.test(sl)) bad.push('ctx ของด่านไม่ได้ส่ง respCostCenters/scopeIdx');

  const lib = stripComments(readFileSync(join(ROOT, 'src/lib/checkinSave.js'), 'utf8'));
  if (!/checkWriteRows\(/.test(lib)) bad.push('checkinSave ไม่ได้นับแถว (RLS ปฏิเสธ = 0 แถว ไม่มี error)');
  if (!/markPresentRecord\(/.test(lib)) bad.push('checkinSave ไม่ได้ใช้ markPresentRecord (กติกาการลา)');
  // 🔴 อ่านแถวเดิมไม่ได้ = ห้ามเขียน (เขียนทั้งที่ไม่รู้ของเดิม = ทับ PPE/OT/ลา ของคนอื่น)
  if (!/read_failed/.test(lib)) bad.push('checkinSave ไม่มีทาง read_failed — อ่านของเดิมไม่ได้แล้วยังเขียนทับ');
  const byBadge = lib.slice(lib.indexOf('export async function checkinByBadge'));
  if (byBadge.indexOf("kind: 'already'") > byBadge.indexOf('upsertCheckin(')) bad.push('checkinByBadge เขียนก่อนเช็คว่ามางานอยู่แล้ว');
  assert.deepEqual(bad, [], bad.join('\n'));
});

test('📋 sheet-quality-is-hint-not-gate — แถบความครบของใบตรวจเป็นตัวบอก ห้ามเป็นด่าน', () => {
  /* 🔴 10/11 คำสั่ง user เรื่อง "แพทเทินการสร้างใบตรวจ" — จอตั้งค่า PM โชว์ว่าใบนี้ครบหรือยัง
     (มุม/จุด/ปักหมุด/รูปขยาย) + ชี้ใบตัวอย่างจริง
     ห้าม 2 อย่าง:
       ① เอาความครบไปบล็อกการบันทึก — ใบที่ยังปักไม่ครบก็ยังใช้ตรวจได้ (จอตรวจไม่บังคับแล้ว)
          บล็อก = ตั้งค่าใบใหม่ไม่ได้จนกว่าจะทำครบ = คนเลิกใช้ระบบ
       ② hardcode ชื่อเครื่องตัวอย่างในโค้ด — ใบต้นแบบเปลี่ยนได้ ต้องมาจาก
          RPC `fn_inspect_sheet_examples` (DR · migration 20261110)
     📄 src/utils/inspectSheetQuality.js · docs/modules/inspection-point-setup.md */
  const src = stripComments(readFileSync(join(ROOT, 'src/pages/PMSetup.jsx'), 'utf8'));

  /* ตัวบอก: ต้องมีจริง ไม่งั้นด่านนี้วัดอะไรไม่ได้ */
  assert.ok(/sheetCompleteness\(/.test(src) && /cpInFrameFilter\(/.test(src),
    '\n\n❌ จอตั้งค่าไม่ได้ใช้ sheetCompleteness/cpInFrameFilter แล้ว — แถบความครบ/ตัวกรองรายมุมหายไป\n');

  /* ① ความครบห้ามไปอยู่ในเส้นทางบันทึก */
  const saveFn = src.slice(src.indexOf('const handleSave'), src.indexOf('const handleSave') + 3000);
  assert.ok(!/\bcomp\.(done|missing|pinned|unpinned|noPhoto)\b/.test(saveFn),
    '\n\n❌ handleSave อ่านค่าความครบของใบ — กำลังจะกลายเป็นด่านบล็อกการบันทึก\n'
    + '   ใบที่ยังปักหมุด/ใส่รูปไม่ครบ ต้องบันทึกได้ตามปกติ (เป็นตัวบอก ไม่ใช่ด่าน)\n');
  assert.ok(!/disabled=\{[^}]*comp\./.test(src),
    '\n\n❌ มีปุ่มถูก disabled ด้วยค่าความครบของใบ — ห้ามบล็อก ให้บอกว่ายังขาดอะไรพอ\n');

  /* ② ห้าม hardcode ชื่อ/ไอดีเครื่องตัวอย่าง */
  assert.ok(/fn_inspect_sheet_examples/.test(src),
    '\n\n❌ ไม่ได้เรียก RPC หาใบตัวอย่างแล้ว — ถ้าจะโชว์ตัวอย่างต้องมาจากข้อมูลจริง\n');
  assert.ok(!/JHYD\d|HDF-0\d\s*-\s*SCHULER/i.test(src),
    '\n\n❌ hardcode ชื่อเครื่องตัวอย่างในโค้ด — ใบต้นแบบเปลี่ยนได้ ต้องถาม fn_inspect_sheet_examples\n');
});

/* ═══ 🦺 ppe-requirements-layers — 2026-11-10 · คำสั่ง user ════════════════════════════════
   *"บางไลน์ต้องมีผ้ากันเปื้อน ปลอกแขน แว่นตาอีก"* ⇒ PPE เป็นทะเบียน 4 ชั้น ไม่ใช่ 3 คอลัมน์ตายตัว
   ที่ห้ามหลุด: ① กฎตกทอดอยู่ไฟล์เดียว หน้าห้ามคิดเอง ② ถาม PPE ต้องขึ้นเฉพาะที่หน่วยนั้นบังคับ
   ③ "ข้าม" ต้องไม่เขียนผลว่าผ่าน ④ ติ๊กที่ชั้นใหม่ต้องซิงก์คอลัมน์เดิม ไม่งั้นจอเก่า/ใหม่เถียงกัน  */
test('🦺 ppe-requirements-layers — กฎ PPE อยู่ไฟล์เดียว + ข้ามต้องไม่นับว่าผ่าน', () => {
  const bad = [];
  for (const f of ['src/pages/ScanLanding.jsx', 'src/pages/PpeSetup.jsx']) {
    const s = stripComments(readFileSync(join(ROOT, f), 'utf8'));
    if (!/resolvePpe\(/.test(s)) bad.push(`${f} — ไม่ได้ตัดสินข้อกำหนดผ่าน resolvePpe`);
    // ห้ามไล่ชั้นเอง: หน้าห้ามแตะ scope_kind ตรงๆ เพื่อตัดสินว่าชั้นไหนชนะ (PpeSetup เขียนทะเบียนได้)
    if (f.includes('ScanLanding') && /scope_kind/.test(s)) bad.push(`${f} — ไล่ชั้นเองในหน้า`);
  }
  const sl = stripComments(readFileSync(join(ROOT, 'src/pages/ScanLanding.jsx'), 'utf8'));
  // "ข้ามไว้ก่อน" ต้องแค่ปิดแผง ห้ามเรียกตัวบันทึก
  const skip = sl.slice(sl.indexOf("done: 'skipped'") - 200, sl.indexOf("done: 'skipped'") + 120);
  if (/savePpe|savePpeChecks/.test(skip)) bad.push('ปุ่มข้ามเรียกตัวบันทึก — ข้ามต้องไม่เขียนผลตรวจ');
  if (!/ppe\.required\.map/.test(sl)) bad.push('จอไม่ได้ขึ้นเฉพาะรายการที่หน่วยนั้นบังคับ');

  const lib = stripComments(readFileSync(join(ROOT, 'src/lib/checkinSave.js'), 'utf8'));
  if (!/legacyPatchOf\(/.test(lib)) bad.push('savePpeChecks ไม่ซิงก์คอลัมน์เดิม — จอเก่ากับจอใหม่จะเถียงกัน');
  if (!/legacySynced/.test(lib)) bad.push('ซิงก์คอลัมน์เดิมล้มแล้วไม่บอกใคร');

  const rule = stripComments(readFileSync(join(ROOT, 'src/utils/ppeRequirements.js'), 'utf8'));
  if (!/lineChainIds\(/.test(rule)) bad.push('ไม่ได้ไล่สายไลน์ผ่าน lineChainIds (แม่→ลูก)');
  if (!/unknown: true/.test(rule)) bad.push('อ่านทะเบียนไม่ได้แล้วไม่คืน unknown — จะกลายเป็น "ไม่ต้องใส่อะไรเลย"');
  assert.deepEqual(bad, [], bad.join('\n'));
});

test('🛒 pr-loop-not-locked-by-mo — ใบปิดแล้วต้องทำ PR ที่ค้างต่อได้ + ไล่งานต้องรู้จัก PR', () => {
  /* 🔴 10/11 feedback หน้างาน 2 ข้อ ต้นเหตุเดียวกัน (ลูป PR กับลูปขั้นของใบ MO คนละลูป):
       ① "ใบที่เปิด PR ไว้ ถ้า ผจก.ฝ่ายแจ้งอนุมัติไปแล้ว แก้ไขอะไรไม่ได้เลย"
          — หน้า MO ส่ง `canEdit={isMoOpen(o) && …}` ให้แผง PR ⇒ ใบปิด = อ่านอย่างเดียว
            ⇒ กดรับของเข้าสต็อก/ยกเลิก PR ไม่ได้ตลอดกาล (ของมาถึงหลังปิดใบเป็นเคสปกติ)
          แก้: `canEdit` ไม่ผูก isMoOpen · เปิด PR **ใบใหม่** ยังผูก (`canAdd`)
          หลักเดียวกับแผง "ส่งซ่อมนอก" ที่เขียนเหตุผลไว้ในไฟล์เดียวกันแล้ว
       ② "งานที่มีการออก PR จะต้องยังไม่รอ ผจก.ฝ่ายที่แจ้งอนุมัติ — ผจก.อนุมัติได้ก็ต่อเมื่อ loop PR จบ"
          — แผงไล่งานตัดสินจากทะเบียนขั้นอย่างเดียว ⇒ โยนใบไปกอง "รอฝ่ายที่แจ้ง" = ไล่ผิดคน
          แก้: ฝั่ง `pr` ใน moChase + หน้า MO ส่ง `prOf`
     📄 docs/modules/mtn-work-order.md §ลูป PR */
  const page = stripComments(readFileSync(join(ROOT, 'src/pages/MtnRepair.jsx'), 'utf8'));

  /* ① แผง PR: canEdit ห้ามผูก isMoOpen (canAdd ผูกได้ — คนละค่า) */
  const tag = page.match(/<MtnPrPanel[\s\S]{0,400}?\/>/);
  assert.ok(tag, '\n\n❌ หา <MtnPrPanel> ในหน้า MO ไม่เจอ — ด่านนี้วัดอะไรไม่ได้แล้ว\n');
  const canEditProp = tag[0].match(/canEdit=\{([^}]*)\}/);
  assert.ok(canEditProp, '\n\n❌ <MtnPrPanel> ไม่มี prop canEdit\n');
  assert.ok(!/isMoOpen/.test(canEditProp[1]),
    `\n\n❌ แผง PR ถูกล็อกตามสถานะใบ MO อีกแล้ว: canEdit={${canEditProp[1].trim()}}\n`
    + '   ⇒ ใบปิดแล้ว = ลงเลข PR / รับของเข้าสต็อก / ยกเลิก PR ไม่ได้ตลอดกาล\n'
    + '   ของสั่งซื้อมาถึงหลังปิดใบเป็นเคสปกติ — ให้ผูก isMoOpen ที่ `canAdd` (เปิด PR ใบใหม่) แทน\n');
  assert.ok(/canAdd=\{[^}]*isMoOpen/.test(tag[0]),
    '\n\n❌ เปิด PR ใบใหม่ไม่ได้ผูกกับ isMoOpen — ใบที่ปิดแล้วไม่ควรเปิด PR ใบใหม่ได้\n');

  /* ② แผงไล่งานต้องรู้จัก PR */
  assert.ok(/buildMoChaseBoard\([\s\S]{0,600}?prOf:/.test(page),
    '\n\n❌ แผงไล่งานไม่ได้รับข้อมูล PR (prOf) แล้ว\n'
    + '   ⇒ ใบที่มีใบขอซื้อค้างจะถูกโยนไปกอง "รอฝ่ายที่แจ้ง" ทั้งที่ ผจก.อนุมัติไม่ได้จนกว่าลูป PR จบ\n');
  const chase = stripComments(readFileSync(join(ROOT, 'src/utils/moChase.js'), 'utf8'));
  assert.ok(/key: 'pr'/.test(chase),
    '\n\n❌ ทะเบียนฝั่งไล่งานไม่มีถัง `pr` แล้ว — จอวาดหัวข้อ "รอลูปจัดซื้อ" ไม่ได้\n');
});

test('🚦 mo-close-gated-by-pr-loop — ปิดใบ MO ต้องถาม moCloseGate() และห้ามตัดสินเองในหน้า', () => {
  /* 🔴 10/11 คำสั่ง user *"บล็อกเลย"* (ยกระดับจากคำเตือนที่ส่งไปรอบก่อน):
       "ผจก.ฝ่ายแจ้งจะอนุมัติได้ก็ต่อเมื่อ loop pr จบ"
     กับดักที่ด่านนี้กัน 3 ข้อ:
       ① รอบก่อนเขียนคำเตือนจาก `o._prs` ซึ่ง **StepModal ไม่เคยได้รับ** (ติดมากับ handler ปุ่มพิมพ์
          ใน DetailDrawer เท่านั้น) ⇒ เงื่อนไขเป็น [] เสมอ = คำเตือนไม่เคยขึ้น (ล้มเหลวเงียบ)
          ⇒ ด่านนี้บังคับว่าขั้นปิดใบต้อง **โหลดใบขอซื้อของตัวเอง** ไม่ใช่หวังว่าจะมีติดมากับ order
       ② ตัดสินด้วยค่าที่โหลดตอนเปิดโมดัล = บล็อกผิด/ปล่อยผิด (อีกเครื่องรับของ/เปิด PR ใบใหม่ระหว่างนั้น)
          ⇒ ตอนกดบันทึกต้องถามฐานสดอีกชั้น
       ③ อ่านไม่ได้ (null) ห้ามบล็อก — บล็อกตอนคิวรีล่ม = ปิดใบไม่ได้ทั้งโรงงาน (กฎอยู่ใน moCloseGate)
     📄 docs/modules/mtn-work-order.md §ลูป PR */
  const chase = stripComments(readFileSync(join(ROOT, 'src/utils/moChase.js'), 'utf8'));
  assert.ok(/export function moCloseGate\b/.test(chase),
    '\n\n❌ ไม่มี moCloseGate() ใน utils/moChase.js — ด่าน "ปิดใบได้ต่อเมื่อลูป PR จบ" หายไป\n');
  assert.ok(/prs == null\)\s*return \{ gate: 'unknown'/.test(chase),
    '\n\n❌ moCloseGate ไม่ได้กัน "อ่าน PR ไม่ได้ = unknown" แล้ว\n'
    + '   ⇒ คิวรี PR ล่มแล้วบล็อกการปิดใบทั้งโรงงาน (ไม่รู้ ≠ มีค้าง)\n');

  const page = stripComments(readFileSync(join(ROOT, 'src/pages/MtnRepair.jsx'), 'utf8'));
  assert.ok(/moCloseGate\(/.test(page),
    '\n\n❌ หน้า MO ไม่เรียก moCloseGate() แล้ว — ปิดใบได้ทั้งที่ใบขอซื้อยังค้าง\n');
  /* ① + ② ด่านตอนกดบันทึกต้องถามฐานสด ไม่ใช่อ่าน prop ที่ติดมากับ order */
  assert.ok(/moCloseGate\(_stage,\s*await fetchOpenPrs\(\)\)/.test(page),
    '\n\n❌ ด่านตอนกดเซ็นไม่ได้โหลดใบขอซื้อสดๆ\n'
    + '   ⇒ ตัดสินด้วยค่าค้างในหน้า = บล็อกผิด (ของมาถึงแล้ว) หรือปล่อยผิด (เพิ่ง PR ใบใหม่)\n');
  assert.ok(!/moCloseGate\([^)]*_prs/.test(page) && !/openPrRows\(o\._prs/.test(page),
    '\n\n❌ ด่านกลับไปอ่าน `order._prs` อีกแล้ว — StepModal ไม่เคยได้รับฟิลด์นี้ (ว่างเสมอ = ด่านตาย)\n');
  /* ห้ามหน้าเขียนเกณฑ์ "ลูป PR จบ" ชุดที่ 2 (= drift)
     🔴 แคบไว้ที่คำว่า `received` เท่านั้น — `cancelled` ใช้ที่อื่นโดยชอบด้วย 2 ที่
        (ตัวกรองคิวรีใบขอซื้อ `.neq('status','cancelled')` · การยกเลิก**ใบ MO** เอง) ⇒ ห้ามจับเหมา */
  assert.ok(!/'received'/.test(page),
    '\n\n❌ หน้า MO เทียบสถานะ "รับของแล้ว" ของใบขอซื้อเอง\n'
    + '   ⇒ เกณฑ์ "ลูป PR จบ" กลายเป็น 2 ชุด — แผงไล่งานกับด่านปิดใบจะไม่ตรงกัน\n'
    + '   ให้ถาม openPrRows() / moCloseGate() ใน utils/moChase.js ที่เดียว\n');
  /* ทางออกต้องเปิดอยู่: ด่านปิดใบ ห้ามไปล็อกแผง PR (ไม่งั้นวงจรล็อกตัวเอง) — ข้อ ① ของด่านข้างบนคุมอยู่ */
});

test('📅 board-workdate-must-refresh — จอที่เปิดค้างทั้งวัน ต้องอัปเดตวันงานเองตอนข้าม 08:00', () => {
  /* 🔴 บั๊กจริงที่หน้างานแจ้ง 12/11 (ทีม MTN + DIE MTN · สังเกตมา 3-4 วัน):
       "โหมดจอแขวนของทีมซัพพอต ถ้าเปิดทิ้งไว้ ไม่ดึงข้อมูลขึ้นมา จะไม่เห็น Status เลยว่า
        ไลน์ไหนเปิดหรือปิด เป็นสีเทาหมด กด refresh ก็ไม่หาย ต้องออก browser แล้วเข้าใหม่"
     ต้นเหตุ: `const workDate = getWorkDate()` เขียนในตัว component ⇒ คิดใหม่เฉพาะตอน
       re-render · จอแขวนที่ไม่มีใครแตะ ไม่มีอะไรสั่ง re-render ⇒ ข้าม 08:00 แล้วยังถาม
       `production_sessions` ด้วยวันงานเมื่อวาน (กะปิดหมดแล้ว) = "ไม่มีไลน์เปิด" เทาทั้งจอ
     ⇒ จอกลุ่มนี้ต้องใช้ `useWorkDate()` เท่านั้น (utils/useWorkDate.js) */
  for (const f of ['src/pages/TvBoard.jsx', 'src/pages/DeptDashboard.jsx', 'src/pages/FlowTower.jsx']) {
    const src = stripComments(readFileSync(join(ROOT, f), 'utf8'));
    assert.ok(/useWorkDate\(\)/.test(src),
      `\n\n❌ ${f} ไม่ได้ใช้ useWorkDate() แล้ว — จอเปิดค้างจะค้างวันงานเก่าข้ามวัน\n`);
    assert.ok(!/const\s+\w+\s*=\s*getWorkDate\(\)\s*;/.test(src),
      `\n\n❌ ${f} กลับไปจับวันงานตอน render ด้วย getWorkDate() อีกแล้ว\n`
      + '   จอแขวนไม่มีอะไรสั่ง re-render ⇒ ข้าม 08:00 แล้วสถานะไลน์เทาทั้งจอ\n'
      + '   ให้ใช้ useWorkDate() (คืนค่าเดิมเป๊ะเมื่อวันยังไม่เปลี่ยน = ไม่ re-render ฟรี)\n');
  }
  /* hook ต้องไม่ re-render ฟรีๆ — ไม่งั้นจอ TV เสีย egress จากนาฬิกา (กฎ egress ข้อ 11) */
  const hook = stripComments(readFileSync(join(ROOT, 'src/utils/useWorkDate.js'), 'utf8'));
  assert.ok(/setWd\(prev =>/.test(hook),
    '\n\n❌ useWorkDate ต้องเซ็ตด้วยฟังก์ชันที่คืน `prev` เมื่อค่าเท่าเดิม (React bail out)\n'
    + '   ไม่งั้นจอ TV re-render ทุกนาทีและยิงโหลดใหม่ = egress เพิ่มฟรี\n');
  assert.ok(/visibilitychange/.test(hook),
    '\n\n❌ useWorkDate ไม่ได้เช็คตอนจอกลับมา (visibilitychange) — เบราว์เซอร์ทีวีพักหน้าจอแล้วจะช้าไป 1 รอบ\n');
});

test('🚦 andon-must-read-both-query-errors — คิวรีกะล้ม ห้ามกลายเป็น "ไม่มีไลน์เปิด" เงียบๆ', () => {
  /* 🔴 บั๊กเดียวกับข้างบน อีกเส้นทางหนึ่ง (12/11):
       เดิม `if (dtRes.error) { ...; return; }` แล้ว **ไม่เคยอ่าน `sessRes.error` เลย**
       ⇒ คิวรี production_sessions ล้ม → data = undefined → `|| []` → openLines = []
         = เทาทุกไลน์ โดยจอไม่ขึ้นอะไรบอก (ผิดกฎ "ห้ามล้มเหลวเงียบ" + กฎ DB ข้อ 1) */
  const src = stripComments(readFileSync(join(ROOT, 'src/components/MtnAndonBoard.jsx'), 'utf8'));
  assert.ok(/sessRes\.error/.test(src),
    '\n\n❌ MtnAndonBoard ไม่ได้อ่าน error ของคิวรีกะ (`sessRes.error`)\n'
    + '   ล้มเมื่อไหร่ = openLines ว่าง = เทาทุกไลน์เงียบๆ ทั้งที่ไลน์เปิดอยู่จริง\n');
  /* และต้องไม่ปล่อยให้ `|| []` เป็นทางเดียวที่รองรับความล้มเหลว */
  assert.ok(/setDtErr\(errs\.length/.test(src),
    '\n\n❌ MtnAndonBoard ไม่ได้เอา error ขึ้นจอรวมทั้ง 2 คิวรีแล้ว — จอต้องเขียนบอก ห้ามเงียบ\n');
});
test('🗂️ line-registry-empty-not-cached — ทะเบียนไลน์ว่างห้ามถูกจดเป็นของจริง', () => {
  /* 🔴 10/11 ผังโรงงานกรอบหายทั้งผัง ("ซ่อนโซนสนับสนุน 25 โซน" + ยอดรวม 0/0)
     RLS ของ production_lines = `authenticated` ⇒ session ยังไม่พร้อม = 200 + 0 แถว **ไม่มี error**
     ⇒ เดิม loader คืน `[]` สำเร็จ ⇒ cachedMaster จดลง localStorage 4 ชม. ⇒ ทุกจอเห็นไลน์ว่างทั้งเช้า
     กฎ: loader ของทะเบียนไลน์ต้อง throw เมื่อได้ลิสต์ว่าง (cachedMaster ไม่เขียน cache ตอน throw) */
  const code = stripComments(readFileSync(join(ROOT, 'src/utils/useProductionLines.js'), 'utf8'));
  const m = code.match(/export async function loadProductionLines\(\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(m, '\n\n❌ หา loadProductionLines() ใน src/utils/useProductionLines.js ไม่เจอ — ด่านนี้วัดอะไรไม่ได้แล้ว\n');
  assert.ok(/if\s*\(\s*!data\?\.length\s*\)\s*throw/.test(m[1]),
    '\n\n❌ loadProductionLines() ต้อง `if (!data?.length) throw …` — ลิสต์ว่างจะถูกจดลง cache 4 ชม.' +
    '\n   (ผังโรงงานกรอบหายทั้งผัง / dropdown ไลน์ว่าง · 10/11)\n');
});

/* ═══ 🔗 handoff-child-must-not-vanish — 2026-11-11 · ไล่จากรอบตรวจรายวัน ════════════
   โมเดลส่งต่อ MO = 1 ปัญหา หลายใบผูกกันเป็นสาย · ใบต้นทางจบที่ `transferred`
   (อยู่ใน `MO_DONE_STATUSES` = **สถานะจบ**) แล้วเปิดใบใหม่ของทีมปลายทาง

   🔴 รูที่เจอ (วัด 11/11 · DR): ใบแม่ 31 ใบที่ transferred เกิน 7 วัน — 4 ใบ **ปลายทางหายไป**
      ต้นเหตุ: FK `mtn_order_handoffs.to_order_id` เป็น `on delete set null`
      + ใบลูกยังไม่ออกเลข MO ⇒ `moRemoveMode()` เดิมตอบ "ลบได้"
      ⇒ ลบใบลูก = ลิงก์ถูกล้างเงียบๆ · ใบแม่ยังจบ ⇒ **ปัญหาหลุดจากคิวทุกคน ไม่มีจอไหนบอก**
      พิสูจน์จาก audit_log: ถูก DELETE จริง 3/4 ใบ (ทีม JIG ลบตอนยัง pending)
   แก้ 3 ชั้น — ด่านนี้ล็อกทั้งสามไว้ */
test('🔗 handoff-child-must-not-vanish — ลบใบปลายทางไม่ได้ + โซ่ขาดต้องโผล่บนจอ', () => {
  const bad = [];

  // ① ชั้นกฎ: moRemoveMode ต้องดู transferred_from_mo ก่อนตอบ "ลบได้"
  const perm = stripComments(readFileSync(join(ROOT, 'src/utils/mtnStepPerm.js'), 'utf8'));
  const fn = perm.slice(perm.indexOf('export function moRemoveMode'), perm.indexOf('export const MO_LABEL_WAIT_APPROVAL'));
  if (!/transferred_from_mo/.test(fn))
    bad.push('moRemoveMode ไม่ได้เช็ค transferred_from_mo — ใบที่ถูกส่งต่อมาจะถูกลบทิ้งได้อีก');
  const iFrom = fn.indexOf('transferred_from_mo');
  const iDel = fn.indexOf('MO_REMOVE_DELETE', fn.indexOf('if (!hasNo)'));
  if (iFrom < 0 || iDel < 0 || iFrom > iDel)
    bad.push('ด่าน transferred_from_mo ต้องอยู่ "ก่อน" สาขา !hasNo ที่ปล่อยให้ลบ');

  // ② ชั้น DB: migration ตั้ง FK เป็น restrict (ของจริงที่ client ข้ามไม่ได้)
  const mig = readFileSync(join(ROOT, 'supabase/migrations/20261111_mtn_handoff_child_no_delete_dr.sql'), 'utf8');
  if (!/to_order_id\)\s*references\s+public\.mtn_orders\(id\)\s+on delete restrict/.test(mig))
    bad.push('migration ไม่ได้ตั้ง to_order_id เป็น on delete restrict');

  // ③ ชั้นจอ: หน้า MO ต้องโหลดโซ่ส่งต่อ + ส่งเข้าแผง · แผงต้องวาดบล็อกนี้
  const page = stripComments(readFileSync(join(ROOT, 'src/pages/MtnRepair.jsx'), 'utf8'));
  if (!/from\('mtn_order_handoffs'\)/.test(page))
    bad.push('MtnRepair ไม่ได้อ่าน mtn_order_handoffs — โซ่ขาดจะไม่โผล่ที่ไหนเลย');
  if (!/buildHandoffGapBoard\(/.test(page))
    bad.push('MtnRepair ไม่ได้ใช้ buildHandoffGapBoard — ห้ามตัดสินโซ่ขาดเองในหน้า');
  if (!/gaps=\{/.test(page)) bad.push('MtnRepair ไม่ได้ส่ง gaps เข้า MoStalePanel');
  /* `.in()` ยาวบน id ชุดใหญ่ = URL เกินเพดาน proxy → คืนว่างเงียบ (กฎเหล็กข้อ 5) */
  if (!/fetchByIds\(/.test(page)) bad.push('MtnRepair โหลดใบแม่/ใบลูกของโซ่ส่งต่อไม่ผ่าน fetchByIds');
  /* แปล error FK ให้คนอ่านรู้เรื่อง — พ่น PG ดิบ = หน้างานไม่รู้ว่าต้องกดยกเลิกแทน */
  if (!/23503/.test(page)) bad.push('MtnRepair ไม่ได้แปล error 23503 (FK restrict) ตอนลบใบ');

  const panel = stripComments(readFileSync(join(ROOT, 'src/components/MoStalePanel.jsx'), 'utf8'));
  if (!/handoffGapMeta\(/.test(panel))
    bad.push('MoStalePanel ไม่ได้อ่านทะเบียนชนิดโซ่ขาด (handoffGapMeta) — ห้ามแต่งป้าย/สีเองในหน้า');
  if (!/gapsErr/.test(panel))
    bad.push('MoStalePanel ไม่ได้เขียนบนจอตอนอ่านโซ่ส่งต่อไม่สำเร็จ (จะโชว์ 0 ทั้งที่ไม่รู้)');

  assert.deepEqual(bad, [], bad.join('\n'));
});
/* ═══ 🧭 workstations-dual-line-key — 2026-11-11 · feedback user ("จุดงานไม่โหลดหรอ") ═════════
   ทะเบียน `workstations` ผูกไลน์ **2 ทาง**: `line_id` (30/133 แถว) และ `line_name` ข้อความ (103/133)
   ⇒ ถามด้วย `line_id` ทางเดียว = จุดงานหายไป 3 ใน 4 **เงียบๆ** (ไลน์ที่มีจุดงาน 32 ชื่อ แต่มี id แค่ 8)
   + ชื่อคอลัมน์คือ `station_name` ไม่ใช่ `name` — เลือกผิดชื่อ = คิวรี error แล้วถ้ากลืน error
     จะเหลือลิสต์ว่างที่อ่านเหมือน "ไลน์นี้ไม่มีจุดงาน" (จอโกหก · ลิสต์ว่าง 2 ความหมาย)                */
test('🧭 workstations-dual-line-key — /ppe-setup ต้องถามจุดงานทั้ง 2 คีย์ + ไม่กลืน error', () => {
  const bad = [];
  const s = stripComments(readFileSync(join(ROOT, 'src/pages/PpeSetup.jsx'), 'utf8'));
  if (!/\.eq\('line_id'/.test(s) || !/\.eq\('line_name'/.test(s))
    bad.push('ถามจุดงานคีย์เดียว — ต้องรวมทั้ง line_id และ line_name');
  if (/select\('id, name'\)/.test(s) || /\bst\.name\b/.test(s))
    bad.push("ใช้คอลัมน์ `name` — ทะเบียนนี้ชื่อ `station_name`");
  if (!/setStFail\(/.test(s)) bad.push('อ่านทะเบียนจุดงานล้มแล้วไม่บอกใคร (ลิสต์ว่าง = จอโกหก)');
  // ว่างจริง กับ อ่านไม่ได้ ต้องเขียนบนจอคนละข้อความ
  if (!/ยังไม่ได้ตั้งจุดงาน/.test(s)) bad.push('ไลน์ที่ยังไม่มีจุดงาน ไม่ได้บอกว่าต้องไปตั้งที่ไหน');
  assert.deepEqual(bad, [], bad.join('\n'));
});

/* ═══ 🧭 nav-item-needs-sub — 2026-11-11 · feedback user ═══════════════════════════════════
   หมวดเมนูที่มีหัวข้อย่อย (`sub`) — รายการที่ไม่ใส่ `sub` จะลอยอยู่เหนือหัวข้อย่อยทั้งหมด
   ดูเหมือนหลุดกลุ่ม (เจอจริงกับ "ข้อกำหนด PPE" ตอนเพิ่มใหม่ 10/11)                              */
test('🧭 nav-item-needs-sub — หมวดที่มีหัวข้อย่อยแล้ว ห้ามมีรายการไม่มี sub', () => {
  const src = readFileSync(join(ROOT, 'src/App.jsx'), 'utf8');
  const block = src.slice(src.indexOf('const NAV_ITEMS'), src.indexOf('NAV_GROUP_ORDER'));
  const rows = block.split('\n').filter(l => /^\s*\{\s*to:\s*'\//.test(l));
  const groupsWithSub = new Set();
  for (const l of rows) {
    const g = l.match(/group:\s*'([^']+)'/);
    if (g && /\bsub:\s*'/.test(l)) groupsWithSub.add(g[1]);
  }
  const bad = [];
  for (const l of rows) {
    const g = l.match(/group:\s*'([^']+)'/);
    if (!g || !groupsWithSub.has(g[1]) || /\bsub:\s*'/.test(l)) continue;
    bad.push(`${(l.match(/to:\s*'([^']+)'/) || [])[1]} — อยู่หมวด "${g[1]}" ที่มีหัวข้อย่อย แต่ไม่ได้ใส่ sub`);
  }
  assert.deepEqual(bad, [], '\n\n❌ รายการเมนูจะลอยเหนือหัวข้อย่อย ดูเหมือนหลุดกลุ่ม:\n   ' + bad.join('\n   ') + '\n');
});

test('📐 factory-map-polygon-save-gate — ลากกรอบบนผังต้องผ่านด่านก่อนบันทึก', () => {
  /* 🔴 11/11 กรอบ Laser GOR จุดมุมหลุดขึ้นไป ~46% ของผังแล้วบันทึกลง DB เงียบๆ (ปล่อยเมาส์ = บันทึก)
     กฎ: endDrag ต้องถาม checkPolygonEdit() (utils/polygonEdit.js) ก่อน update · ลากมุมผ่าน dragVertex() */
  const code = stripComments(readFileSync(join(ROOT, 'src/pages/FactoryMap.jsx'), 'utf8'));
  const m = code.match(/const endDrag = async \(\) => \{([\s\S]*?)\n  \};/);
  assert.ok(m, '\n\n❌ หา endDrag ใน FactoryMap.jsx ไม่เจอ — ด่านนี้วัดอะไรไม่ได้แล้ว\n');
  const iChk = m[1].indexOf('checkPolygonEdit(');
  const iUpd = m[1].indexOf(".from('factory_line_regions').update(");
  assert.ok(iChk >= 0 && iUpd > iChk,
    '\n\n❌ endDrag บันทึกกรอบโดยไม่ผ่าน checkPolygonEdit() ก่อน — จุดหลุดไกล/เส้นตัดกันจะถูกบันทึกเงียบ (เคส Laser GOR 11/11)\n');
  assert.ok(/dragVertex\(/.test(code),
    '\n\n❌ ลากจุดมุมไม่ผ่าน dragVertex() แล้ว — โหมดคงมุมฉากหาย\n');
});

/* ═══ 🚪 alsoIn-allowlist — 2026-11-11 · คำสั่ง user ("พยายามไม่ให้มี shortcut แบบนี้") ═══════
   `alsoIn` = เมนูเดียวโผล่ 2 หมวด (หมวดที่ 2 วาดจางๆ + `↗`) — user ขอให้มีให้น้อยที่สุด
   รีวิว 11/11: มี 4 ตัว → เหลือ **2 ตัวที่มีเหตุผลว่า "2 ฝ่ายลงมือจริงทั้งคู่"**
     · /production-plan  — ผลิตตัดสินเปิดกะ/OT + planner เทียบยอดลูกค้า (คำสั่ง user เดิม: บ้าน=ฝ่ายผลิต)
     · /store-monitor    — หน้าเดียวจับทั้งขาเข้า (min-max) และขาออก (ใบสั่งซื้อค้าง)
   ถอดออก: /ppe-setup (ทางลัดพาไปหน้าที่ supervisor กดไม่ได้) · /monitoring (ฝ่ายผลิตดูอย่างเดียว)
   🔴 เพิ่มตัวใหม่ = ต้องถาม user ก่อน แล้วค่อยเติมในลิสต์นี้ — **ห้ามเติมเพื่อให้ build ผ่าน** */
test('🚪 alsoIn-allowlist — ทางลัดข้ามหมวดต้องมีเท่าที่ user เคาะไว้', () => {
  const src = readFileSync(join(ROOT, 'src/App.jsx'), 'utf8');
  const block = src.slice(src.indexOf('const NAV_ITEMS'), src.indexOf('NAV_GROUP_ORDER'));
  const found = block.split('\n')
    .filter(l => /^\s*\{\s*to:\s*'\//.test(l) && /\balsoIn:/.test(l))
    .map(l => (l.match(/to:\s*'([^']+)'/) || [])[1])
    .sort();
  assert.deepEqual(found, ['/production-plan', '/store-monitor'],
    '\n\n❌ ชุดเมนูที่มีทางลัดข้ามหมวด (`alsoIn`) เปลี่ยนไปจากที่ user เคาะไว้ 11/11\n'
    + `   เจอ: ${found.join(' · ') || '(ไม่มี)'}\n`
    + '   เพิ่มทางลัดใหม่ = ต้องถาม user ก่อน · ถอดออก = อัปเดตลิสต์ในด่านนี้พร้อมเหตุผล\n');
});

/* ═══ 🪪 ใบตรวจทุกใบ (AM + PM) ต้องผ่านด่านบัตรผู้ตรวจ (2026-11-11 · คำสั่ง user) ═══
   เดิมด่าน `amBadgeGate` อยู่ใน `if (isAmTeam(department))` ⇒ ใบ PM ของช่างบันทึกได้โดยไม่มีบัตร */
test('🪪 PMCheckData: ด่านบัตรผู้ตรวจต้องไม่อยู่ใต้เงื่อนไข isAmTeam (ใช้ทุกใบ)', () => {
  const src = stripComments(readFileSync(join(ROOT, 'src/pages/PMCheckData.jsx'), 'utf8'))
  assert.doesNotMatch(src, /if\s*\(\s*isAmTeam\(department\)\s*\)\s*\{\s*const raw = inspectorCode/,
    '\n\n❌ ด่านบัตรผู้ตรวจกลับไปอยู่ใต้ isAmTeam — ใบ PM จะบันทึกได้โดยไม่สแกนบัตร\n')
  assert.match(src, /amBadgeGate\(\{[^}]*kind:/, '\n\n❌ amBadgeGate ต้องส่ง kind (AM/PM) ให้ข้อความถูกใบ\n')
  assert.match(src, /<InspectorCodeField[^>]*required(\s|\/|>)/, '\n\n❌ ช่องรหัสผู้ตรวจต้อง required ทุกใบ\n')
})

/* ═══ 🛡️ row-cap-dated-select — SELECT ที่มีตัวกรอง "ช่วงวันที่" ต้องแบ่งหน้า (2026-11-11) ═══
   ต่อยอดจาก `limit-over-postgrest-cap` ซึ่งจับได้แค่ `.limit(N > 1000)` — **ช่องโหว่จริงอยู่ที่
   "ไม่ใส่ limit เลย"** ซึ่งเงียบกว่า เพราะดูเหมือนตั้งใจดึงทั้งหมด
   audit 11/11/26 (สแกน 1,463 SELECT · ไม่แบ่งหน้า 836) เจอชนเพดานจริง 6 จุด เช่น
     · ShiftAutoFillModal — `shift_schedules` หน้าต่าง 546 วัน = **11,458 แถว ได้มา 1,000 (หาย 91%)**
       แล้วเอาไปตัดสินว่าจะ "ทับ" แถวที่คนตั้งมือไว้หรือไม่
     · กะปิดแล้ว 30 วัน = 968 แถว (เหลือที่ 32) ⇒ ปุ่มย้อนหลัง 60/90/120/"ปีนี้" ชนทันที
   กติกา: คิวรีบน **ตารางรายแถวที่โตตามเวลา** ที่มี `.gte('<คอลัมน์วันที่>')` ต้องผ่าน
          `fetchAllPages` / `fetchByIds` / `fetchAllRows` / `.range(` / `openPlusHistory`
          หรือมีหลักฐาน `cap-ok` ที่วัดมาจริงใน 3 บรรทัดเหนือขึ้นไป                                */
test('🛡️ row-cap-dated-select — คิวรีช่วงวันที่บนตารางรายแถว ต้องแบ่งหน้า', () => {
  /* ตารางที่ "โตตามเวลา" จริง — ทะเบียน master ไม่เข้าข่าย (โตช้า มีด่าน fetchAllRows ของตัวเอง) */
  const GROWING = ['production_sessions', 'prod_orders', 'downtime_logs', 'defect_logs',
    'daily_production_logs', 'shift_schedules', 'four_m_logs', 'mtn_orders', 'audit_log'];
  const PAGED = /fetchAllPages|fetchByIds|fetchAllRows|openPlusHistory|\.range\(|pageAll|fetchAll\(/;
  const bad = [];
  for (const file of walk(join(ROOT, 'src'), ['.js', '.jsx'])) {
    if (file.includes('__tests__')) continue;
    const raw = readFileSync(file, 'utf8');
    const rawLines = raw.split('\n');
    const src = stripComments(raw);
    const lines = src.split('\n');
    lines.forEach((ln, i) => {
      const m = ln.match(/\.from\(\s*['"]([a-z_]+)['"]\s*\)/);
      if (!m || !GROWING.includes(m[1])) return;
      /* ดูทั้งก้อนคิวรี — ตัวแบ่งหน้ามัก **ห่อไว้ข้างบน** (`fetchAllPages(() => supabase.from(…))`)
         ⇒ ต้องมองขึ้นไปด้วย ไม่ใช่แค่ chain ที่ต่อท้าย */
      const block = lines.slice(Math.max(0, i - 4), i + 20).join('\n');
      if (!/\.select\(/.test(block)) return;              // insert/update/delete ไม่เกี่ยว
      if (!/\.gte\(\s*['"][a-z_]*(date|_at)['"]/.test(block)) return;  // ไม่มีตัวกรองช่วงวันที่ = ไม่ใช่เคสนี้
      if (PAGED.test(block)) return;                       // แบ่งหน้าแล้ว
      if (/\.(limit|maybeSingle|single)\(/.test(block)) return;  // จำกัดเองแล้ว → ด่าน limit-over-cap ดูแลต่อ
      const near = rawLines.slice(Math.max(0, i - 3), i + 1).join('\n');
      if (/cap-ok/.test(near)) return;                     // มีหลักฐานวัดมาแล้ว
      bad.push(`${file.slice(ROOT.length)}:${i + 1} (${m[1]})`);
    });
  }
  assert.deepEqual(bad, [], '\n\n❌ คิวรีช่วงวันที่ที่ยังไม่แบ่งหน้า:\n   ' + bad.join('\n   ') + '\n'
    + '   ทำไม: PostgREST คืนสูงสุด 1,000 แถว และ "ถูกตัด" ไม่ใช่ error ⇒ จอได้ข้อมูลไม่ครบเงียบสนิท\n'
    + '         เรียงวันขึ้น = ตัดท้าย (เดือนล่าสุดหาย) · เรียงลง = ตัดหัว (ของเก่าหาย) — แย่ทั้งคู่\n'
    + '   แก้: ผ่าน fetchAllPages (คิวรีเดี่ยว) / fetchByIds (มี id list) / fetchAllRows (ทะเบียน)\n'
    + '        หรือถ้าวัดแล้วไม่มีทางถึง 1,000 ให้เขียน `cap-ok: <ตาราง> วัด <วันที่> = <N> แถว` เหนือบรรทัดนั้น\n');
});

/* ═══ ✍️ ใบ PM ขั้น 2 หัวหน้าผู้ตรวจยืนยัน ต้องผ่าน pmConfirmVerdict (2026-11-11 · คำสั่ง user) ═══
   เดิมใบ PM กดอนุมัติได้ทุกคนที่ถือ pm:approve รวมถึงใบที่ตัวเองตรวจ */
test('✍️ PMCheckData: ใบ PM อนุมัติต้องผ่าน pmConfirmVerdict (ระดับ + ไม่ใช่ใบตัวเอง)', () => {
  const src = stripComments(readFileSync(join(ROOT, 'src/pages/PMCheckData.jsx'), 'utf8'))
  assert.match(src, /isAm \? amApprovalVerdict\(verdictArgs\) : pmConfirmVerdict\(\{ \.\.\.verdictArgs, isShared \}\)/,
    '\n\n❌ ใบ PM ต้องคิด verdict ด้วย pmConfirmVerdict\n')
  assert.match(src, /can\('pm', 'approve', userRole\) && !!amVerdict\?\.ok/,
    '\n\n❌ ปุ่มยืนยันใบ PM ต้องเช็ค verdict ด้วย ไม่ใช่แค่ pm:approve\n')
})

/* ═══ 🔫 cross-close-auto-both-paths — 2026-11-13 · feedback หน้างาน ═══════════════════════
   *"สแกนข้ามไลน์ เก็บ log พอ ไม่ต้องเด้งแจ้ง เพราะหน้างานใช้สแกนเนอร์ยิงบาร์โค้ดปิด order
     ไม่ได้อยู่หน้าคอม กดคอนเฟิร์มไม่ได้"*
   ของที่ user สั่งไว้ 03/11 ลงแค่ทางเดียว: เครื่องสแกนส่ง Enter ได้ **2 แบบ**
     ① แทรก `\n` ลงในค่า → `handleCloseProdNoChange` (ส่ง auto แล้ว)
     ② ส่งเป็น "คีย์" Enter  → `onKeyDown` ของช่อง  ← **ทางนี้ลืมส่ง auto** = ค้างรอกดปุ่ม
   ⇒ เครื่องยิงส่วนใหญ่ใช้ทาง ② ⇒ ของที่สั่งไว้ไม่มีผลกับหน้างานเลย · การ์ดบนจอก็เขียนเองว่า
     "สแกนด้วยเครื่องยิง = ปิดให้ทันทีไม่ต้องกดยืนยัน" = จอโกหก                                   */
test('🔫 cross-close-auto-both-paths — ทางสแกนทั้ง 2 ทางต้องปิดใบข้ามไลน์ให้เอง', () => {
  const bad = [];
  const s = stripComments(readFileSync(join(ROOT, 'src/pages/DailyReport.jsx'), 'utf8'));
  // ① ทาง \n ในค่า
  if (!/hasEnter && !found && v\) crossLookup\(v, \{ auto: true \}\)/.test(s))
    bad.push('ทาง `\\n` (handleCloseProdNoChange) ไม่ได้ส่ง { auto: true }');
  // ② ทางคีย์ Enter — เครื่องยิงส่วนใหญ่มาทางนี้
  // ⚠️ ไฟล์นี้มี onKeyDown Enter หลายช่อง — ยึดช่องที่เรียก crossLookup เท่านั้น
  const kd = s.slice(Math.max(0, s.indexOf('crossLookup(closeProdNo') - 320), s.indexOf('crossLookup(closeProdNo') + 60);
  if (!/if \(e\.key !== 'Enter'\) return;[\s\S]*crossLookup\(closeProdNo, \{ auto: true \}\)/.test(kd))
    bad.push('ทางคีย์ Enter (onKeyDown ของช่องสแกน) ไม่ได้ส่ง { auto: true } — หน้างานกดยืนยันไม่ได้');
  // ปุ่ม "ค้นทั้งโรงงาน" ที่คนพิมพ์มือกดเอง ต้องไม่ auto (คนอยู่หน้าจอ เลือกไลน์เองได้)
  if (/onClick=\{\(\) => crossLookup\(closeProdNo, \{ auto: true \}\)\}/.test(s))
    bad.push('ปุ่มค้นทั้งโรงงาน (พิมพ์มือ) กลายเป็น auto — คนพิมพ์มือต้องได้เลือกเอง');
  assert.deepEqual(bad, [], bad.join('\n'));
});

/* ═══ 📸 ปิดกะต้องตรึง CT + นโยบายพัก แล้วสูตรต้องอ่าน snapshot ก่อนทะเบียนสด (11/11 · คำสั่ง user)
   เคสจริง 10/11: restamp 5 กะเก่า ไม่มีกะไหนได้ค่าเดิม เพราะ `break_policies` ถูกแก้ 20/10 + 05/11
   ⇒ ออดิทเทียบ "เลขที่เก็บ" กับ "เลขที่คำนวณได้" ไม่ตรง · ถอดด่านนี้ = ปัญหากลับมาทั้งระบบ */
test('📸 computeSessionOee: snapshot (CT + พัก) ต้องชนะทะเบียนสด และปิดกะต้อง stamp กลับ', () => {
  const oee = stripComments(readFileSync(join(ROOT, 'src/utils/oee.js'), 'utf8'))
  assert.match(oee, /const ctSnap = readCtSnapshot\(session\)/,
    '\n\n❌ computeSessionOee ต้องอ่าน ct_snapshot ของกะก่อน (readCtSnapshot)\n')
  assert.match(oee, /const brkSnap = readBreakSnapshot\(session\)/,
    '\n\n❌ computeSessionOee ต้องอ่าน break_snapshot ของกะก่อน (readBreakSnapshot)\n')
  assert.match(oee, /snap > 0 \? snap : ctForMat\(matNo/,
    '\n\n❌ CT ต้องเอา snapshot ก่อน แล้วค่อยถอยไปทะเบียน (ctForMat)\n')
  // brkIvIn = ประตูเดียวของช่วงพักในสูตรปิดกะ — ต้องกินชุดที่ผ่าน snapshot แล้วทั้ง 3 ตัว
  const brk = oee.match(/const brkIvIn = \(a, b\) => breakIntervalsIn\(\{[\s\S]*?\}\);/)
  assert.ok(brk, '\n\n❌ หา brkIvIn ใน computeSessionOee ไม่เจอ\n')
  for (const k of ['policies: brkPolicies', 'processType: brkProcessType', 'lineRules: brkLineRules']) {
    assert.ok(brk[0].includes(k),
      `\n\n❌ brkIvIn ต้องใช้ ${k} (ไม่ใช่ prop สดจากหน้า) ไม่งั้นกะที่มี snapshot ยังคิดจากทะเบียนวันนี้\n`)
  }
  const dr = stripComments(readFileSync(join(ROOT, 'src/pages/DailyReport.jsx'), 'utf8'))
  assert.ok((dr.match(/break_snapshot:\s*brkSnap/g) || []).length >= 2,
    '\n\n❌ payload ปิดกะทั้ง 2 ทาง (pending_close + closed) ต้อง stamp break_snapshot\n')
  assert.match(dr, /breakSnapshot \? \{ break_snapshot: breakSnapshot \} : \{\}/,
    '\n\n❌ ปุ่ม "คำนวณ OEE ใหม่" ต้อง stamp break_snapshot ที่ใช้คิดรอบนั้นด้วย\n')
})

/* ═══ 🛡️ poka-yoke หน้าปิดกะ ห้ามถอด (2026-11-11 · คำสั่ง user) ═════════════════════════
   "ทำ poka-yoke เวลาลงข้อมูลหรือก่อนส่งขอปิดกะ เพื่อรีเช็คและแจ้งให้พนักงานที่ลงตรวจสอบตอนนั้นเลย
    จะช่วยได้เยอะกว่ามาย้อนหลังหลายๆวัน" — ด่าน 2 จังหวะ: ตอนลงยอด + ก่อนส่งขอปิดกะ */
test('🛡️ DailyReport: ด่าน poka-yoke ตอนลงยอด + ก่อนปิดกะ ต้องยังอยู่', () => {
  const dr = stripComments(readFileSync(join(ROOT, 'src/pages/DailyReport.jsx'), 'utf8'))
  // ① ทุกทางที่คนพิมพ์ยอดเอง ต้องผ่าน qtyFitPass ก่อนเขียน DB
  assert.ok((dr.match(/if \(!qtyFitPass\(o, (?:v|finalQty)\)\) return;/g) || []).length >= 2,
    '\n\n❌ ทั้งทาง "ลงยอดสะสม" และ "ปิดใบด้วยยอดจริง" ต้องเรียก qtyFitPass() ก่อนบันทึก\n')
  assert.match(dr, /checkQtyFit\(\{/, '\n\n❌ ด่านยอดต้องคิดด้วย checkQtyFit จาก utils/closeChecks.js\n')
  // ② ด่านรีเช็คก่อนปิดกะ — ต้องกั้นก่อนเขียน DB และต้องติ๊กครบจึงไปต่อได้
  assert.match(dr, /if \(confirmChecks\(checks\)\.length\) \{ setRecheckTicks\(\{\}\); setCloseRecheck\(checks\); return; \}/,
    '\n\n❌ handleCloseSession ต้องหยุดรอการติ๊กเมื่อมีข้อ confirm (ห้ามปล่อยผ่าน)\n')
  assert.match(dr, /const allTicked = must\.every\(c => recheckTicks\[c\.key\]\)/,
    '\n\n❌ ปุ่มยืนยันต้องปลดล็อกเมื่อติ๊กครบทุกข้อ (ปุ่มเดียวรวบ = คนกดผ่านไม่อ่าน)\n')
  assert.match(dr, /disabled=\{!allTicked\}/, '\n\n❌ ปุ่ม "ตรวจแล้ว" ต้อง disabled จนติ๊กครบ\n')
  // 🔴 ตัวเลขที่ด่านจับ ต้องเป็นตัวเดียวกับที่จอโชว์ — ใบ downtime หลังคำตัดสินมีสูตรเดียว
  assert.ok((dr.match(/previewDecidedDt\(\)/g) || []).length >= 3,
    '\n\n❌ OEE preview บนจอ + ด่านรีเช็ค ต้องใช้ previewDecidedDt() ตัวเดียวกัน (ห้ามคิดนาที DT ซ้ำในหน้า)\n')
  assert.match(stripComments(readFileSync(join(ROOT, 'src/utils/downtimeCarryRules.js'), 'utf8')),
    /export function decidedDtLogs\(/, '\n\n❌ decidedDtLogs ต้องอยู่ใน utils (pure) ไม่ใช่ในหน้า\n')
})

/* ═══ 🚫 4M ห้ามอนุมัติใบตัวเอง / ห้ามคนเดียวเซ็นทั้ง SV+QA (2026-11-13 · คำสั่ง user) ═════════
   คู่กับ trigger `protect_four_m_status()` (20261113_four_m_no_self_approve_main.sql) */
test('🛡️ 4M: ปุ่มอนุมัติต้องผ่าน fourMSelfBlock ทั้งขั้น SV และ QA', () => {
  const rp = stripComments(readFileSync(join(ROOT, 'src/pages/Report.jsx'), 'utf8'))
  assert.match(rp, /const selfBlock = fourMSelfBlock\(log, myUid\);\s*if \(selfBlock\)/,
    '\n\n❌ handleApprove ต้องเช็ค fourMSelfBlock ก่อนอนุมัติ/เปิด modal QA\n')
  assert.match(rp, /const selfBlock = fourMSelfBlock\(qaApproveModal, user\.id\);/,
    '\n\n❌ ปุ่มยืนยัน QA ต้องเช็ค fourMSelfBlock ซ้ำตอนเขียนจริง\n')
  assert.match(rp, /const userCanAct = canApproveLog\(l\) && !selfBlock;/,
    '\n\n❌ ปุ่ม SV/QA Approve ในแถวต้องซ่อนเมื่อเป็นใบของตัวเอง\n')
  const mig = readFileSync(join(ROOT, 'supabase/migrations/20261113_four_m_no_self_approve_main.sql'), 'utf8')
  assert.match(mig, /cannot approve a 4M log you created/, '\n\n❌ trigger ฝั่ง DB ต้องกันอนุมัติใบตัวเอง\n')
})

/* ═══ ✍️ ใบ MO ฟอร์ม MTN ช่อง "ผจก.ส่วนซ่อมบำรุง" ต้องให้เจ้าตัวกดเอง (2026-11-13 · คำสั่ง user) ═══ */
test('🛡️ MtnRepair: ขั้น 2 ห้ามลงเวลา/ลายเซ็นช่อง ผจก.ส่วนซ่อมบำรุงแทนเจ้าตัว', () => {
  const mr = stripComments(readFileSync(join(ROOT, 'src/pages/MtnRepair.jsx'), 'utf8'))
  assert.doesNotMatch(mr, /mo_approved_at:\s*o\.mo_approved_at \|\|/,
    '\n\n❌ ขั้นจ่ายงานห้ามเขียน mo_approved_at ให้ ผจก. (ช่องอนุมัติที่เจ้าตัวไม่ได้กด)\n')
  assert.match(mr, /mo_ack_at: nowIso/, '\n\n❌ ปุ่มรับทราบของ ผจก. ต้อง stamp mo_ack_at\n')
  assert.match(mr, /o\.mo_ack_at\s*\?\s*sg\('ผู้อนุมัติ \(ผจก\.ส่วนซ่อมบำรุง\)'/,
    '\n\n❌ ใบพิมพ์ต้องโชว์ลายเซ็น/วันที่ช่องนี้เฉพาะเมื่อ ผจก. กดรับทราบแล้ว (mo_ack_at)\n')
  const perm = readFileSync(join(ROOT, 'src/utils/mtnStepPerm.js'), 'utf8')
  assert.match(perm, /7: \{\s*\.\.\.MTN_STEPS\[7\],\s*minRank: 60,/,
    '\n\n❌ ขั้น 7 ใบ JIG/DIE ต้องเป็น ผจก.ฝ่ายผู้แจ้ง (minRank 60) — คำสั่ง user 13/11\n')
})

/* ═══ ✍️ ลายเซ็นต้องเป็นของเจ้าตัว — ห้ามก๊อป signature_url ของคนที่เลือกจาก picker (2026-11-13 · คำสั่ง user) ═══
   ของกลาง `src/utils/selfSign.js` (pickSignerPatch / isSelfName) */
test('🛡️ ฟอร์มที่มีช่องเลือกผู้เซ็น ห้ามแปะลายเซ็นของคนที่เลือก', () => {
  const read = (f) => stripComments(readFileSync(join(ROOT, f), 'utf8'))
  const lpa = read('src/pages/LayerProcessAudit.jsx')
  assert.doesNotMatch(lpa, /auditor_sig_url:\s*r\.kind === 'free'/, '\n\n❌ LPA: ห้ามดึง r.signature_url ของผู้ตรวจที่เลือก\n')
  assert.match(lpa, /pickSignerPatch\(r\.name/, '\n\n❌ LPA: ช่องผู้ตรวจต้องผ่าน pickSignerPatch\n')
  const bbs = read('src/pages/BbsCheck.jsx')
  assert.doesNotMatch(bbs, /inspector_sig_url:\s*p\?\.signature_url/, '\n\n❌ BBS: ห้ามแปะลายเซ็นของผู้ตรวจที่เลือก\n')
  assert.match(bbs, /pickSignerPatch\(p\?\.full_name/, '\n\n❌ BBS: ต้องผ่าน pickSignerPatch\n')
  const mr = read('src/components/MaterialRequests.jsx')
  assert.doesNotMatch(mr, /_sig_url`\]:\s*p\?\.signature_url/, '\n\n❌ FM-STO-003: ห้ามแปะลายเซ็นของคนที่เลือก\n')
  const ojt = read('src/pages/OjtTraining.jsx')
  assert.doesNotMatch(ojt, /\[sigKey\]:\s*p\.signature_url/, '\n\n❌ OJT: ช่องผู้จัดทำห้ามแปะลายเซ็นของคนที่เลือก\n')
  const rp = read('src/pages/Report.jsx')
  assert.doesNotMatch(rp, /setMakerSig\(ldr\.signature_url|setCheckerSig\(sv\.signature_url|setApproverSig\(mgr\.signature_url/,
    '\n\n❌ Multi-Skill: ห้ามดึงลายเซ็นหัวหน้าประจำไลน์มาพิมพ์อัตโนมัติ\n')
})

/* ═══ 🚪 nav-route-reachable — หน้าที่สร้างแล้วต้องหาเจอ (2026-11-13) ═══════════════════════
   เจอตอนไล่เมนูซ้ำ/ไม่เข้าหมวด (คำสั่ง user) — มี route ที่ render หน้าจริง 88 ตัว แต่เมนูมี 70
   ส่วนต่างทั้งหมดอธิบายได้ (LegacyTabRedirect ของหน้าที่ยุบเป็นแท็บ · เข้าทาง QR/เมนูโปรไฟล์)
   แต่ "อธิบายได้" วันนี้ ไม่ได้กันหน้าใหม่ที่ session หน้าสร้างแล้วลืมใส่ NAV_ITEMS
   ⇒ หน้าใหม่ที่เปิดด้วย URL ได้แต่ไม่มีในเมนู = **ไม่มีใครหาเจอ** (สร้างแล้วตายเงียบ)
   กฎ: route ที่ไม่อยู่ในเมนู ต้องเป็น LegacyTabRedirect/Navigate หรืออยู่ในทะเบียนข้อยกเว้นนี้
   📄 docs/modules/pages-routes.md §ไล่เมนู "ซ้ำ / ไม่เข้าหมวด" รอบ 13/11                      */
test('🚪 nav-route-reachable — route ที่ render หน้าจริง ต้องมีในเมนู หรืออยู่ในทะเบียนข้อยกเว้น', () => {
  const s = readFileSync(join(ROOT, 'src/App.jsx'), 'utf8');

  // เข้าถึงทางอื่นโดยเจตนา — เติมได้ แต่ต้องเขียนเหตุผลว่า "หาเจอทางไหน"
  const OFF_MENU = {
    '/scan':      'ส่องป้าย QR หน้างาน (handheld) — ไม่ใช่เมนูจอคอม',
    '/remote':    'เมนูโปรไฟล์ (src/utils/profileMenu.js)',
    '/linesetup': 'ลิงก์จาก /layout-setup ตอนไม่มีสิทธิ์แก้ (ดูอย่างเดียว)',
    '/login':     'หน้า login',
  };

  const navTo = new Set();
  const i = s.indexOf('NAV_ITEMS'), j = s.indexOf('NAV_GROUP_ORDER');
  for (const m of s.slice(i, j).matchAll(/\{\s*to:\s*'([^']+)'/g)) navTo.add(m[1]);
  assert.ok(navTo.size > 50, '\n\n❌ อ่าน NAV_ITEMS ไม่ออก (เปลี่ยนรูปแบบ `to:` ?) — แก้ด่านนี้ให้ตรงของจริง\n');

  const orphan = [];
  for (const m of s.matchAll(/<Route\s+path="([^"]+)"\s+element=\{([\s\S]{0,160}?)\}\s*\/?>/g)) {
    const [, path, el] = m;
    if (path === '*' || path === '/*' || path.includes(':')) continue;   // catch-all + param ไม่ใช่หน้า
    if (navTo.has(path) || OFF_MENU[path]) continue;
    // ของที่ redirect ไปที่อื่นอยู่แล้ว = ไม่ต้องมีในเมนู
    if (/LegacyTabRedirect|<Navigate/.test(el)) continue;
    orphan.push(path);
  }
  assert.deepEqual(orphan, [], `\n\n❌ route พวกนี้เปิดด้วย URL ได้ แต่ไม่มีในเมนูและไม่ใช่ redirect\n   ⇒ สร้างแล้วไม่มีใครหาเจอ:\n   ${orphan.join('\n   ')}\n\n   แก้ทางใดทางหนึ่ง: ① เติมลง NAV_ITEMS (พร้อม group + sub)\n   ② ถ้าเข้าทางอื่นโดยเจตนา (QR / เมนูโปรไฟล์ / ลิงก์ในหน้า) เติมใน OFF_MENU ของด่านนี้พร้อมเหตุผล\n`);
});

/* ═══ ➕ register-folded-into-operator — 2026-11-13 · คำสั่ง user ═══════════════════════════
   *"ยุบละย้ายเพิ่มพนักงานเข้าไปในหน้าฐานข้อมูล"* — /operator ไม่มีทางเพิ่มคนเลย ส่วน /register
   เป็นฟอร์มเดียว ⇒ "เพิ่มพนักงาน" คือปุ่มของ "ฐานข้อมูลพนักงาน" ไม่ใช่เมนูพี่น้อง
   3 อย่างที่พังง่ายและพังเงียบ ถ้า session หน้าแก้โดยไม่รู้:
     ① เติม `/register` กลับเข้าเมนู = เมนูซ้ำกลับมา
     ② แทรก 'add' กลางๆ `TAB_KEYS` = เนื้อหาอ้าง `tab === n` ⇒ สลับแท็บทั้งหน้าเงียบๆ
     ③ ถอด piggyback `page:/register` ออกจาก canAccessPage('/operator') = คนที่ตั้งสิทธิ์ไว้แค่
        หน้าเดิม เข้าไม่ได้ทั้งหน้า
   📄 docs/modules/pages-routes.md §/register ยุบเข้าเป็นแท็บใน /operator                      */
test('➕ register-folded-into-operator — เมนูเดียว · แท็บต่อท้าย · piggyback สิทธิ์หน้าเดิม', () => {
  const bad = [];
  const app = readFileSync(join(ROOT, 'src/App.jsx'), 'utf8');
  const appNc = stripComments(app);

  // ① ห้ามกลับมาเป็นเมนู · route ต้องเป็น redirect เข้าแท็บ
  if (/\{\s*to:\s*'\/register'/.test(appNc))
    bad.push("`/register` กลับมาอยู่ใน NAV_ITEMS — ยุบเข้าแท็บ ?tab=add ของ /operator แล้ว (ถามผู้ใช้ก่อนเติมกลับ)");
  if (!/path="\/register"\s+element=\{<LegacyTabRedirect to="\/operator" tab="add" \/>\}/.test(appNc))
    bad.push('route /register ต้องเป็น <LegacyTabRedirect to="/operator" tab="add" /> (ลิงก์เก่าต้องไม่ตาย)');

  // ② 'add' ต้องอยู่ "ท้าย" TAB_KEYS — index ของ 3 ตัวแรกถูกอ้างด้วย tab === n
  const op = stripComments(readFileSync(join(ROOT, 'src/pages/operator.jsx'), 'utf8'));
  const keys = op.match(/const TAB_KEYS = \[([^\]]+)\]/);
  if (!keys) bad.push('หา TAB_KEYS ใน operator.jsx ไม่เจอ');
  else {
    const arr = keys[1].split(',').map(x => x.trim().replace(/^'|'$/g, ''));
    if (arr.slice(0, 3).join() !== 'employees,skills,levelup')
      bad.push(`TAB_KEYS 3 ตัวแรกต้องคงลำดับเดิม (employees,skills,levelup) — ได้ ${arr.slice(0, 3).join()}`);
    if (arr[arr.length - 1] !== 'add') bad.push("'add' ต้องเป็นตัวท้ายสุดของ TAB_KEYS");
  }
  // แท็บต้องกรองด้วยสิทธิ์หน้าเดิม + สิทธิ์กดบันทึกจริง (เห็นแท็บ ≠ เขียนได้)
  if (!/hasPermission\('page:\/register', role\) && can\('employees', 'register', role\)/.test(op))
    bad.push("แท็บ ➕ ต้องโผล่เมื่อ hasPermission('page:/register') && can('employees','register') เท่านั้น");
  // ฝังหน้าลูกต้องครอบ <Hub> (หัวซ้อน 2 ชั้น)
  if (!/<Hub><RegisterEmployeeForm embedded onSaved=\{fetchEmployees\} \/><\/Hub>/.test(op))
    bad.push('แท็บ ➕ ต้องเป็น <Hub><RegisterEmployeeForm embedded onSaved={fetchEmployees} /></Hub>');
  // 🔗 เพิ่มคนเสร็จต้องโหลดรายชื่อใหม่ ไม่งั้นสลับไปแท็บ 👥 แล้วไม่เห็นคนที่เพิ่งเพิ่ม = จอโกหก
  if (!/onSaved\?\.\(\)/.test(stripComments(readFileSync(join(ROOT, 'src/pages/Register.jsx'), 'utf8'))))
    bad.push('Register.jsx ต้องเรียก onSaved?.() หลังเพิ่มสำเร็จ (ให้หน้าแม่โหลดรายชื่อใหม่)');

  // ③ piggyback สิทธิ์ — ไม่มี = คนที่ตั้งไว้แค่ page:/register เข้าหน้าไม่ได้เลย
  const perm = stripComments(readFileSync(join(ROOT, 'src/utils/permissions.js'), 'utf8'));
  if (!/path === '\/operator'[\s\S]{0,200}hasPermission\('page:\/register', role\)/.test(perm))
    bad.push("canAccessPage('/operator') ต้อง piggyback `page:/register` ด้วย");

  // ฟอร์มต้องตรึงความกว้างเอง — .page-content .page-content ล้าง max-width ของชั้นใน
  const reg = stripComments(readFileSync(join(ROOT, 'src/pages/Register.jsx'), 'utf8'));
  if (!/maxWidth: 960/.test(reg))
    bad.push('การ์ดฟอร์มต้องตรึง maxWidth 960 เอง (ฝังในหน้าแม่แล้ว <Page width="form"> ไม่คุมความกว้างให้)');

  assert.deepEqual(bad, [], '\n\n❌ ' + bad.join('\n❌ ') + '\n');
});

test('🔧 dt-mb-flag-three-state — ธง "เครื่องเสียของช่าง" ต้องมี 3 สถานะ และห้ามแตะเลขที่ส่งกลุ่ม', () => {
  /* 🔴 13/11 คำสั่ง user *"ทำข้อ 2 ติดธงในทะเบียนประเภท downtime"*
     ที่มา: KPI ทางการนับทุกแถวที่ไม่ใช่ planned เข้า Machine Break Down/MTTR/MTBF ของช่าง
       ⇒ ช่างแบกชั่วโมงที่ไม่เคยถูกเรียก 813.6 ชม. (78.8% ของ ต.ค.) ซึ่งมี "แก้ไขปัญหาคุณภาพ"
         107.6 ชม. ที่ไม่ใช่เครื่องเสียเลย · เดาจากชื่อประเภทไม่ได้ (กฎ §อื่นๆ/ไม่ระบุ ข้อ 5)
       ⇒ ให้คนที่รู้งานติ๊กในทะเบียนครั้งเดียว แล้วทุกจอใช้ธงเดียวกัน
     กับดัก 3 ข้อที่ด่านนี้กัน:
       ① ยุบเหลือ 2 สถานะ (`!!row.is_machine_breakdown`) ⇒ "ยังไม่มีใครติ๊ก" กลายเป็น "ไม่ใช่ของช่าง"
          = ตัวเลขช่างดีขึ้นฟรีทันทีโดยไม่มีใครตัดสิน (ล้มเหลวเงียบที่ตรวจไม่ได้จากจอ)
       ② เก็บ `false` ลงฐานแทน `null` ⇒ แยก "ตัดสินแล้วว่าไม่ใช่" กับ "ยังไม่ได้ตัดสิน" ไม่ออกตลอดกาล
       ③ เอาธงไปทับเลขที่ส่งกลุ่ม — กลุ่มเป็นเจ้าของนิยาม KPI (ESM = ที่ผลิตตัวเลข Actual)
          ⇒ mbd/mtbf/mttr ใน kpiAuto ห้ามรู้จักธงนี้เลย (มีเทสเลขเท่าเดิมใน kpiAuto.test.mjs ด้วย)
     📄 src/utils/dtBreakdownOwner.js · docs/OBEYA-KPI-SOURCES.md §15.2 */
  const own = stripComments(readFileSync(join(ROOT, 'src/utils/dtBreakdownOwner.js'), 'utf8'));
  /* ① ครบ 3 สถานะ และ unset ต้องเป็น null */
  for (const k of ['yes', 'no', 'unset']) {
    assert.ok(new RegExp(`key: '${k}'`).test(own),
      `\n\n❌ dtBreakdownOwner.js ไม่มีสถานะ '${k}' แล้ว — 3 สถานะห้ามยุบเหลือ 2\n`
      + '   "ยังไม่ระบุ" ≠ "ไม่ใช่ของช่าง" (ยุบ = ตัวเลขช่างดีขึ้นฟรีโดยไม่มีใครตัดสิน)\n');
  }
  assert.ok(/key: 'unset',[\s\S]{0,200}?value: null/.test(own),
    '\n\n❌ สถานะ unset ต้องเก็บ null — เก็บ false = แยก "ตัดสินแล้วว่าไม่ใช่" กับ "ยังไม่ตัดสิน" ไม่ออก\n');
  assert.ok(/if \(v === true\) return 'yes';[\s\S]{0,120}?if \(v === false\) return 'no';/.test(own),
    '\n\n❌ mbFlagOf ต้องเทียบ === true / === false ตรงๆ\n'
    + '   ใช้ truthiness = undefined (คิวรีไม่ได้ select คอลัมน์) ไหลเข้าฝั่งใดฝั่งหนึ่งเงียบๆ\n');

  /* ② จอทะเบียนต้องเขียนผ่าน mbValueForDb ห้าม || false */
  const dr = stripComments(readFileSync(join(ROOT, 'src/pages/DailyReport.jsx'), 'utf8'));
  assert.ok(/is_machine_breakdown:\s*mbValueForDb\(/.test(dr),
    '\n\n❌ ฟอร์มทะเบียนประเภท downtime ต้องเขียนธงผ่าน mbValueForDb() เท่านั้น\n'
    + '   เขียนค่าดิบ/`|| false` = ยัด false ให้ประเภทที่ยังไม่มีใครติ๊ก\n');
  assert.ok(!/is_machine_breakdown[^\n]*\|\|\s*false/.test(dr) && !/!!\s*\w*\.?is_machine_breakdown/.test(dr),
    '\n\n❌ เจอการบีบธงเป็น boolean 2 สถานะในหน้า (`|| false` / `!!`) — null ต้องคงเป็น null\n');
  /* ②ข ช่องติ๊กต้องอยู่ **แผงประเภท downtime** ไม่ใช่แผงประเภทงานเสีย
     เคสจริง 13/11: UI ไปโผล่ในฟอร์ม `dr_defect_types` ส่วน payload อยู่ฟอร์ม `dr_downtime_types`
     ⇒ คนกดติ๊กในฟอร์มงานเสีย = ส่ง `mb_flag` ลงตารางที่ไม่มีคอลัมน์นี้ = บันทึกล้มทั้งใบ
     (เจอเพราะ merge conflict ไม่ใช่เพราะเทส — จึงต้องมีด่าน) */
  const iPayload = dr.indexOf('is_machine_breakdown: mbValueForDb');
  const iUi = dr.indexOf('MB_FLAGS.map(');
  assert.ok(iPayload > 0 && iUi > iPayload,
    '\n\n❌ ช่องติ๊กธง (MB_FLAGS.map) ไม่ได้อยู่ในแผงประเภท downtime เดียวกับตัวบันทึก\n'
    + '   แผงประเภทงานเสีย (dr_defect_types) ไม่มีคอลัมน์ is_machine_breakdown\n'
    + '   ⇒ ติ๊กแล้วกดบันทึก = ส่งคีย์ที่ตารางไม่รู้จัก = บันทึกล้มทั้งใบ\n');

  /* ③ ธงห้ามไปอยู่ในสูตรที่ส่งกลุ่ม */
  const auto = stripComments(readFileSync(join(ROOT, 'src/utils/kpiAuto.js'), 'utf8'));
  const official = auto.slice(0, auto.indexOf('export function mtnOwnerSeries'));
  assert.ok(official.length > 0, '\n\n❌ ไม่เจอ mtnOwnerSeries() ใน kpiAuto.js — แท่ง "ของช่าง/ไม่ใช่" หายไป\n');
  assert.ok(!/mb_yes_min|mb_no_min/.test(official),
    '\n\n❌ ธง is_machine_breakdown ไปโผล่ในสูตร KPI ที่ส่งกลุ่ม (ก่อน mtnOwnerSeries)\n'
    + '   🔴 Machine Break Down / MTBF / MTTR ต้องนับไลน์หยุดเต็มตาม KPI Guideline เหมือนเดิม\n'
    + '   กลุ่มเป็นเจ้าของนิยาม · ESM = ที่ผลิตตัวเลข Actual (ห้ามคิดเกณฑ์เอง)\n');
  /* ถังที่ 3 ต้องถูกนับและโชว์ ไม่ใช่โยนทิ้ง */
  assert.ok(/mb_unset_min/.test(auto),
    '\n\n❌ mtnOwnerSeries ไม่นับถัง "ยังไม่ระบุ" แล้ว — ชั่วโมงหายจากจอ (จอโกหก)\n');
  const kpi = stripComments(readFileSync(join(ROOT, 'src/components/KpiMonthly.jsx'), 'utf8'));
  assert.ok(/unknownHr=\{mtnOwner\.unsetHr\}/.test(kpi),
    '\n\n❌ จอ KPI ต้องวาดถัง "ยังไม่ระบุ" เป็นช่องที่มองเห็น (unknownHr)\n'
    + '   ซ่อน = คนอ่านคิดว่าติ๊กครบแล้ว ทั้งที่ยังไม่มีใครตัดสิน\n');
});

/* ═══ 🏠 checkin-opens-on-own-line — 2026-11-13 · หัวหน้ากลุ่ม PD4 แจ้งหน้างาน ═══════════════
   *"หัวหน้าไลน์เห็นพนักงานไลน์อื่นด้วยตอนเช็คชื่อ"* — วัดจริง: หัวหน้า GOR ควรเห็น 24 คน
   แต่เห็น 52 (ติดครอบครัว LWR BAR 21 + Office PD4 7) · เป็นทุกส่วนงาน ไม่ใช่แค่ PD4
   คำสั่ง user: *"เปิดมาเห็นไลน์ตัวเอง แต่สลับดูไลน์อื่นในส่วนงานได้"*

   🔴🔴 ทางแก้ที่ **ห้าม** ทำ = ไปบีบ `lineScope()` ให้หัวหน้าไลน์เห็นแค่ครอบครัวตัวเอง
        26/10 เคยทำแล้ว **ทั้งโรงงานเปิดกะไม่ได้เช้าวันจันทร์** · และปุ่ม "ยืมคน" ต้องเห็น
        คนไลน์อื่นก่อนจึงยืมเข้าไลน์ตัวเองได้ ⇒ แก้ได้แค่ "ค่าตั้งต้นของช่องกรอง"
   กฎ: ① ค่าตั้งต้นมาจากของกลาง `defaultLineFilter()` ห้ามเช็ค role ในหน้า
       ② จอต้องเขียนว่าซ่อนคนไลน์อื่นไว้กี่คน (ไม่บอก = หัวหน้าคิดว่าส่วนงานมีแค่นี้)
   📄 src/utils/__tests__/defaultLineFilter.test.mjs                                          */
test('🏠 checkin-opens-on-own-line — ค่าตั้งต้นมาจากของกลาง + จอต้องบอกว่าซ่อนกี่คน', () => {
  const bad = [];
  const ck = stripComments(readFileSync(join(ROOT, 'src/pages/Checkin.jsx'), 'utf8'));

  // ① ค่าตั้งต้นของช่องขอบเขตต้องมาจากของกลาง
  if (!/useState\(\(\) => defaultLineFilter\(\{ role, lineId \}\)\)/.test(ck))
    bad.push("selLine ต้องตั้งค่าเริ่มต้นด้วย defaultLineFilter({ role, lineId }) ของกลาง");
  // ตาข่าย: ไลน์ตัวเองหายจากทะเบียน ต้องล้างค่าตั้งต้น ไม่ปล่อยจอว่างเทียม
  if (!/defaultLineFilter\(\{ role, lineId, lines \}\) === ''/.test(ck))
    bad.push('ต้องมีตาข่าย: ไลน์ตัวเองไม่อยู่ในทะเบียนแล้ว ให้ล้างค่าตั้งต้น (ลิสต์ว่าง 2 ความหมาย)');

  // ② กรองแถวออกแล้วต้องเขียนบนจอว่ากี่คน
  if (!/hiddenOtherLines/.test(ck))
    bad.push('จอต้องนับและเขียน "+N คนในไลน์อื่น" — กรองแถวออกแล้วห้ามซ่อนเงียบ');

  /* ③ 🔴 หัวหน้าไลน์ต้อง "สลับดูไลน์อื่นได้" — เดิมแถบกรองถูกซ่อนจาก leader ทั้ง role
        (`role !== 'leader' && lines.length > 0`) ⇒ ถ้าตั้งค่าตั้งต้นเป็นไลน์ตัวเองแล้วยังซ่อนอยู่
        เขาจะติดอยู่ที่ไลน์เดียว **ยืมคนข้ามไลน์ไม่ได้เลย** (คำสั่ง user: ต้องสลับได้) */
  if (!/const showScopeFilter = /.test(ck))
    bad.push('ต้องมี showScopeFilter — แถบกรองขอบเขตต้องโผล่ให้ leader ที่ขอบเขตมีหลายไลน์');
  if (/\{role !== 'leader' && lines\.length > 0 && \(/.test(ck))
    bad.push("แถบกรองกลับไปซ่อนจาก leader ทั้ง role — หัวหน้าไลน์จะสลับดู/ยืมคนไลน์อื่นไม่ได้");

  // 🔴 ของกลางต้องไม่ถูกบีบ: lineScope ของ leader ยังต้องรวมไลน์ในส่วนงาน
  const sc = stripComments(readFileSync(join(ROOT, 'src/utils/sectionScope.js'), 'utf8'));
  if (!/export function defaultLineFilter/.test(sc))
    bad.push('defaultLineFilter() ต้องอยู่ใน sectionScope.js (กฎขอบเขตมีที่เดียว)');
  if (!/own\.concat\(bySec\.filter/.test(sc))
    bad.push("lineScope() ของ leader ถูกบีบแล้ว — ต้องยังเป็น own ∪ sections (ไม่งั้นซ้ำเหตุ 26/10 เปิดกะไม่ได้ + ยืมคนไม่ได้)");

  assert.deepEqual(bad, [], '\n\n❌ ' + bad.join('\n❌ ') + '\n');
});

/* ═══ 🔑 harness-lineid-matches-mock — harness ต้องชี้ไลน์ที่มีจริงใน mock (2026-11-13) ═══════
   กับดักที่ทำให้ "พัง 0" เชื่อไม่ได้: `audit/main.jsx` ตั้ง `CTX.lineId` เป็นเลข แต่
   `audit/mockSupabase.js` ให้ไลน์มี `id` เป็น `'id-N'` ⇒ ไม่ตรงกันเลยสักแถว
   ⇒ ทุกจุดที่ถาม "ไลน์ของผู้ใช้คนนี้คือไลน์ไหน" หาไม่เจอ แล้วเดินกิ่ง fail-open ทุกครั้ง
   ⇒ **กิ่ง "ขอบเขตรายไลน์" ไม่เคยถูกรันใน crashsweep เลย** (เจอ 13/11 ตอนแก้ /checkin)
   🔴 ของจริง `production_lines.id` เป็น **integer** ⇒ mock ต้องเป็นเลข
      ห้ามแก้กลับทางให้ CTX เป็นสตริง — โค้ดจริงมี `Number(lineId)` จะได้ NaN แล้วเดินผิดกิ่ง
   📄 audit/README.md §CTX.lineId ต้องตรงกับ id ของไลน์ใน mock                                */
test('🔑 harness-lineid-matches-mock — CTX.lineId ต้องชี้ไลน์ที่มีจริง + id ของไลน์ต้องเป็นเลข', () => {
  const bad = [];
  const mock = readFileSync(join(ROOT, 'audit/mockSupabase.js'), 'utf8');
  const main = readFileSync(join(ROOT, 'audit/main.jsx'), 'utf8');

  // ① ไลน์ใน mock ต้องมี id เป็นเลข (override ที่ production_lines)
  const pl = stripComments(mock).match(/production_lines:\s*\(r, i\) => \(\{([^}]*)\}\)/);
  if (!pl) bad.push('หา override production_lines ใน mockSupabase.js ไม่เจอ — เปลี่ยนรูปแล้วต้องแก้ด่านนี้');
  else if (!/\bid:\s*i\b/.test(pl[1]))
    bad.push("production_lines ของ mock ต้องตั้ง `id: i` (เลข) — ของจริง production_lines.id เป็น integer");

  // ② CTX.lineId ต้องเป็นเลข และอยู่ในช่วงแถวที่ mock สร้างจริง
  const m = stripComments(main).match(/const CTX = \{[^}]*?lineId:\s*([^,]+),/);
  if (!m) bad.push('หา CTX.lineId ใน audit/main.jsx ไม่เจอ');
  else {
    const raw = m[1].trim();
    if (!/^\d+$/.test(raw))
      bad.push(`CTX.lineId ต้องเป็นเลข (ได้ \`${raw}\`) — สตริงจะทำให้ Number(lineId) เป็น NaN แล้วเดินผิดกิ่ง`);
    else {
      const n = Number(raw);
      const rows = stripComments(mock).match(/const ROWS = \[\.\.\.Array\.from\(\{ length: (\d+) \}/);
      const len = rows ? Number(rows[1]) : 0;
      if (!len) bad.push('อ่านจำนวนแถว ROWS ของ mock ไม่ออก');
      else if (n < 1 || n > len)
        bad.push(`CTX.lineId = ${n} อยู่นอกช่วงแถวที่ mock สร้าง (1..${len}) = ชี้ไลน์ที่ไม่มีอยู่`);
      // 🔴 ต้องเป็น "ไลน์ลูก" ไม่ใช่ไลน์แม่ ไม่งั้นสายตกทอดจากไลน์แม่ไม่เคยถูกรัน
      const par = stripComments(mock).match(/const PARENT_OF = \{([^}]*)\}/);
      const kids = par ? [...par[1].matchAll(/(\d+)\s*:/g)].map(x => Number(x[1])) : [];
      if (kids.length && !kids.includes(n))
        bad.push(`CTX.lineId = ${n} ไม่ใช่ไลน์ลูก (ลูกใน PARENT_OF = ${kids.join(',')})`
          + ' — ตั้งเป็นไลน์แม่ = กิ่ง "ไลน์ลูกตกทอดจากไลน์แม่" ไม่เคยถูกรัน');
    }
  }

  // ③ ห้ามเหลือจุดที่ "ชี้ไลน์" ด้วยสตริง 'id-N' (join กลับไปหาไลน์ไม่เจอ)
  for (const key of ['line_id', 'to_line_id', 'ref_line_id']) {
    const re = new RegExp(`${key}:\\s*(\`id-|'id-)`);
    if (re.test(stripComments(mock)))
      bad.push(`mockSupabase.js: \`${key}\` ยังชี้ไลน์ด้วยสตริง 'id-N' — ต้องเป็นเลขให้ตรงกับ production_lines.id`);
  }

  assert.deepEqual(bad, [], '\n\n❌ ' + bad.join('\n❌ ') + '\n');
});

test('⏳ mo-details-pending — เรียกช่าง = ต้องมีใบ MO · ใบรอรายละเอียดต้องเห็นในคิว', () => {
  /* 🔴 13/11 คำสั่ง user: *"บังคับเลยถ้าเรียกช่าง เพราะข้ามแผนก · อาจจะไม่บังคับใส่รายละเอียด
     ตอนนั้นทันทีก็ได้ มาใส่ย้อนหลังได้ เป็น tab breakdown รอเพิ่มรายละเอียด MO"*
     ข้อมูลตอนทำ: เรียกช่าง 1,072 ครั้ง — มีใบแล้ว 986 (92%) · ไม่มีใบ 86 (56 ใน 30 วัน)
     กับดัก 4 ข้อที่ด่านนี้กัน:
       ① ตัวบังคับหายไปจากฐาน (trigger) ⇒ กลับไปเป็น "เรียกช่างแล้วไม่มีใบ" เงียบๆ
          — ต้องมีไฟล์ migration ในรีโป ไม่ใช่ apply ลอยๆ ผ่าน MCP แล้วลืม
       ② `details_pending` หายจาก `MO_LIST_COLS` ⇒ ป้าย+ตัวกรองหายทั้งจอ (คอลัมน์ที่ไม่ select = undefined)
       ③ หน้าเทียบ `details_pending === true` เอง ⇒ `undefined` (ไม่ได้ select) ถูกตัดสินเป็น "ใบครบ"
       ④ โหมดเติมรายละเอียดเขียน status/current_step ทับ ⇒ ใบที่ช่างซ่อมอยู่ถูกดึงกลับไปกองรอรับงาน
     📄 src/utils/moDetailsPending.js · docs/modules/mtn-work-order.md */
  const dir = join(ROOT, 'supabase/migrations');
  const files = readdirSync(dir).filter(f => f.endsWith('.sql'));
  const hasTrg = files.some(f => /create\s+trigger\s+trg_dt_call_mtn_opens_mo/i.test(readFileSync(join(dir, f), 'utf8')));
  assert.ok(hasTrg,
    '\n\n❌ ไม่มี migration ที่สร้าง trigger `trg_dt_call_mtn_opens_mo` ในรีโป\n'
    + '   ⇒ ตัวบังคับ "เรียกช่าง = ต้องมีใบ MO" ไม่มีใครรู้ว่ามีอยู่ กู้ฐานใหม่แล้วหาย\n');

  const mr = stripComments(readFileSync(join(ROOT, 'src/pages/MtnRepair.jsx'), 'utf8'));
  /* ② */
  assert.match(mr, /MO_LIST_COLS[\s\S]{0,4000}?'details_pending'/,
    '\n\n❌ `details_pending` ไม่อยู่ใน MO_LIST_COLS — ป้าย/ตัวกรอง "รอเพิ่มรายละเอียด" หายทั้งจอเงียบๆ\n');
  /* ③ — ห้ามเทียบธงเองในหน้า ต้องผ่านของกลาง */
  for (const [file, src] of [['src/pages/MtnRepair.jsx', mr],
                             ['src/pages/DailyReport.jsx', stripComments(readFileSync(join(ROOT, 'src/pages/DailyReport.jsx'), 'utf8'))]]) {
    assert.ok(!/\.details_pending\s*===\s*true/.test(src),
      `\n\n❌ ${file} เทียบ \`details_pending === true\` เอง — ใช้ isDetailsPending() จาก utils/moDetailsPending.js\n`
      + '   คอลัมน์ที่ไม่ได้ select มา = undefined ⇒ เทียบเองแล้วใบที่รอเอกสารหายจากคิว\n');
    assert.match(src, /isDetailsPending\(/,
      `\n\n❌ ${file} ไม่เรียก isDetailsPending() แล้ว — ใบที่รอรายละเอียดไม่ถูกแยกออกมา\n`);
  }
  /* ④ — โหมดเติมต้องถอดฟิลด์ของ "การเปิดใบ" ออกก่อนเขียนทับ */
  assert.match(mr, /if \(fillOrderId\)[\s\S]{0,700}?status: _s[\s\S]{0,200}?current_step: _cs/,
    '\n\n❌ โหมดเติมรายละเอียดไม่ได้ถอด status/current_step ออกจาก payload\n'
    + '   ⇒ เขียน status:\'pending\' step:1 ทับใบที่ช่างรับงาน/ซ่อมไปแล้ว = ดึงใบกลับไปกองรอรับงาน\n');
  assert.match(mr, /details_pending: done \? false : true/,
    '\n\n❌ โหมดเติมต้องปลดธงเฉพาะเมื่อครบ (canClearDetailsFlag) — ปลดทุกครั้ง = ใบไม่ครบหลุดจากคิว\n');
  /* ธงนี้ห้ามกลายเป็นด่านของขั้น (ไลน์ต้องไม่หยุดรอเอกสาร) */
  assert.ok(!/details_pending[^\n]{0,80}(return toast\.error|canDoStep)/.test(mr),
    '\n\n❌ เอาธง details_pending ไปบล็อกขั้น/ปุ่ม — ใบที่รอเอกสารต้องยังรับงาน/ซ่อม/ปิดได้ตามปกติ\n'
    + '   (กฎโมดูล: "งานซ่อมกับบริการ แค่แจ้งให้ทราบ ไม่งั้นไลน์จะหยุดรอการอนุมัติ")\n');
});

test('🧾 qbin-edit-modal-both-modes — modal บันทึก/แก้ไขของถังต้องวาดทั้งโหมดคิวและโหมดเต็ม', () => {
  /* บั๊ก 13/11: โหมดคิว (/qa?tab=bins) `return` ก่อนถึง modal ⇒ ปุ่ม "✏️ กรอกเลขใบ FM-QA-042" กดแล้วเงียบ */
  const Q = 'src/components/QualityBins.jsx';
  const q = stripComments(readFileSync(join(ROOT, Q), 'utf8'));
  const bad = [];
  const i = q.indexOf('if (queueOnly) return (');
  if (i < 0) bad.push(`${Q}: หา "if (queueOnly) return (" ไม่เจอ — เปลี่ยนโครงแล้วต้องแก้ด่านนี้`);
  else {
    const def = q.indexOf('const renderEditModal = ');
    if (def < 0 || def > i) bad.push(`${Q}: ต้องประกาศ renderEditModal() ก่อน return โหมดคิว`);
    const after = q.slice(i);
    const n = (after.match(/\{renderEditModal\(\)\}/g) || []).length;
    if (n < 2) bad.push(`${Q}: ต้องเรียก {renderEditModal()} ทั้งใน return โหมดคิวและโหมดเต็ม (เจอ ${n})`);
  }
  if (/ระบบไม่ย้ายให้เอง/.test(q)) bad.push(`${Q}: ข้อความ "ระบบไม่ย้ายให้เอง" ไม่ตรงพฤติกรรม (save() เรียก toRed ให้แล้ว)`);
  assert.deepEqual(bad, []);
});

test('🔍 dt-closed-at-shift-end — ใบที่ปิดตรงเวลาเลิกกะต้องถูกถาม (เตือน ไม่บล็อก)', () => {
  /* 🔴 13/11 คำสั่ง user: *"พวกที่คืนไลน์นาน ค่อมช่วงเบรคด้วยรึป่าว และถ้านานจริง ผลิตก็ต้อง
     รับผิดชอบ ว่าเกิดจากอะไร ต้องมีคำตอบ เพราะลงแบบนี้ A ตก P อาจจะ over และเราคิดแคพ 100%
     เป็น poka-yoke ดัก OEE เกิน 100% ไว้ก็จะมีผล"*
     วัดจริง ต.ค.: ใบที่ซ่อมเสร็จแล้วปิดช้าสุด 6 ใบ **ปิดตรงเวลาเลิกกะเป๊ะทั้ง 6 ใบ** ·
       ค่อมเบรคทั้ง 6 ใบ (BD-08 94 นาที — เป็นเบรค 50 ⇒ ที่ต้องตอบจริง 44) ·
       %P แตะเพดาน 100% ใน 194 จาก 783 กะ (24.8%)
     กับดัก 4 ข้อที่ด่านนี้กัน:
       ① ยกเป็นด่านห้ามบันทึก ⇒ หน้างานลงข้อมูลไม่ได้ตอนหยุดยาวจริง (user สั่ง "เตือนไม่บล็อก")
       ② ลืมหักเวลาพัก ⇒ กล่าวหาเกินจริง (เบรคถูกกันออกจากฐาน %A อยู่แล้ว · dtMinOutsideBreaks)
       ③ เขียนด่านปิดกะชุดที่ 2 แยกจาก `buildCloseChecks` ⇒ คนติ๊ก 2 ลิสต์ (เกือบทำรอบนี้)
       ④ เตือนแต่ไม่บอกผลที่ตามมา ⇒ คนไม่รู้ว่าจะไปแก้อะไร
     📄 src/utils/shiftDataSanity.js · src/utils/closeChecks.js */
  const san = stripComments(readFileSync(join(ROOT, 'src/utils/shiftDataSanity.js'), 'utf8'));
  /* ② ต้องรับช่วงพักและหักออก */
  assert.match(san, /breakIntervals/,
    '\n\n❌ ตัวตัดสินใบปิดตรงเลิกกะไม่รับช่วงพักแล้ว — เบรคถูกกันออกจากฐาน %A อยู่แล้ว\n'
    + '   ไม่หัก = เตือนด้วยนาทีที่ไม่ได้กระทบ %A จริง (เคส BD-08: 94 นาที เป็นเบรค 50)\n');
  assert.match(san, /answerMin/,
    '\n\n❌ ต้องคืน "นาทีที่ต้องตอบ" (หักพักแล้ว) ไม่ใช่นาทีดิบ\n');
  /* ③ ห้ามมีด่านปิดกะชุดที่ 2 */
  assert.ok(!/export function shiftDataSanity\b/.test(san),
    '\n\n❌ มี shiftDataSanity() กลับมา — ด่านปิดกะต้องอยู่ที่ `buildCloseChecks()` ลิสต์เดียว\n'
    + '   (%P ทะลุเพดาน = `work_over_time` · DT เกินเวลากะ = `dt_over_shift` มีอยู่แล้ว)\n');

  const cc = stripComments(readFileSync(join(ROOT, 'src/utils/closeChecks.js'), 'utf8'));
  assert.match(cc, /key: 'dt_closed_at_shift_end'[\s\S]{0,200}?level: 'confirm'/,
    '\n\n❌ ด่าน dt_closed_at_shift_end ต้องเป็น level `confirm`\n'
    + '   `block` = ปิดกะไม่ได้ตอนหยุดยาวถึงเลิกกะจริง (คำสั่ง user: เตือนไม่บล็อก)\n');

  const dr = stripComments(readFileSync(join(ROOT, 'src/pages/DailyReport.jsx'), 'utf8'));
  /* ① ด่านรายใบต้องเป็น confirm ไม่ใช่ toast.error + return */
  assert.match(dr, /checkDtClosedAtShiftEnd\(/,
    '\n\n❌ หน้ารายงานผลิตไม่เรียก checkDtClosedAtShiftEnd() แล้ว — ใบที่ปิดตรงเลิกกะไม่ถูกถาม\n');
  assert.match(dr, /dtEndChk && !window\.confirm\(/,
    '\n\n❌ ด่านใบปิดตรงเลิกกะต้องเป็น window.confirm (เตือนแล้วไปต่อได้)\n'
    + '   ใช้ toast.error + return = บล็อกการบันทึก ซึ่ง user สั่งว่าห้าม\n');
  assert.match(dr, /dtClosedAtShiftEnd:/,
    '\n\n❌ ไม่ได้ส่งตัวนับ dtClosedAtShiftEnd เข้า buildCloseChecks — ด่านตอนปิดกะไม่ขึ้นเลย\n');
  /* ④ ต้องบอกผลที่ตามมา */
  assert.ok(/%A/.test(san) && /%P/.test(san),
    '\n\n❌ ข้อความเตือนไม่บอกผลต่อ %A/%P — คนอ่านไม่รู้ว่าต้องไปแก้อะไร\n');
});

test('🔴 mtn-team-must-be-picked — ทีมช่างห้ามมีค่าตั้งต้น ต้องเลือกเองทุกครั้ง', () => {
  /* 🔴 13/11 หน้างานแจ้ง (ภาพหน้าจอ LINE): *"เปิดใบแจ้งซ่อม หัวข้อนี้แก้ไขเป็นตัวเลือกได้ไหมครับ
     กันส่งไปผิดแผนก · ตอนนี้มันตั้งค่าเริ่มต้นเป็น MTN ครับ ส่งผิดแผนกบ่อยครับ"*
     คำสั่ง user: *"ให้บังคับต้องเลือกนะ · ไม่ออโต้ MTN แน่นอน"* + *"บางทีกดไวไปเลย"*
     กับดัก 3 ข้อที่ด่านนี้กัน:
       ① `teamKeyOf(defaultDept) || 'maintenance'` — เดาทีมไม่ออก = ยัด MTN ให้เงียบๆ
          แล้วคนกดเร็วก็ส่งผิดทีม ⇒ ใบต้องตีกลับ เสียเวลาทั้ง 2 ฝั่ง
       ② ปุ่ม "เรียกช่าง" กดได้ทั้งที่ยังไม่เลือกทีม แล้ว handleCallMtn ถอยไป 'maintenance'
          🔴 ตั้งแต่ 13/11 ฐานเปิดใบ MO ตามทีมที่เรียกด้วย ⇒ เรียกผิด = ใบไปผิดคิวตามไปอีก
       ③ เอาทีมที่เดาจากทะเบียนมา **กดเลือกให้** แทนที่จะเป็นคำใบ้ = กลับไปปัญหาเดิม
     📄 docs/modules/mtn-work-order.md */
  const mr = stripComments(readFileSync(join(ROOT, 'src/pages/MtnRepair.jsx'), 'utf8'));
  /* ① ค่าตั้งต้นต้องว่าง */
  assert.ok(!/mtn_dept:\s*teamKeyOf\([^)]*\)\s*\|\|/.test(mr),
    '\n\n❌ ฟอร์มแจ้งซ่อมกลับไปตั้งค่าทีมช่างให้เอง (`teamKeyOf(...) || ...`)\n'
    + '   คำสั่ง user: ไม่ออโต้ MTN แน่นอน — ต้องเลือกเองทุกครั้ง\n');
  assert.match(mr, /mtn_dept:\s*''/,
    '\n\n❌ ค่าเริ่มต้นของ "แจ้งถึงทีมช่าง" ต้องเป็นค่าว่าง\n');
  /* บังคับตอนบันทึก */
  assert.match(mr, /if \(!teamKeyOf\(f\.mtn_dept\)\) return toast\.error/,
    '\n\n❌ ฟอร์มแจ้งซ่อมไม่บล็อกตอนยังไม่เลือกทีมช่าง\n');
  /* มี placeholder ให้เห็นว่ายังไม่ได้เลือก */
  assert.match(mr, /<option value="">— \{trI18n\('เลือกทีมช่าง'\)\} —<\/option>/,
    '\n\n❌ ช่องทีมช่างไม่มีตัวเลือก placeholder — คนเปิดมาเห็นทีมใดทีมหนึ่งค้างอยู่แล้วกดผ่าน\n');

  const dr = stripComments(readFileSync(join(ROOT, 'src/pages/DailyReport.jsx'), 'utf8'));
  /* ② ปุ่มเรียกช่างต้องกดไม่ได้จนเลือกทีม + ห้าม fallback */
  assert.match(dr, /disabled=\{moSaving \|\| !moDtPick\.team\}/,
    '\n\n❌ ปุ่มเรียกช่างกดได้ทั้งที่ยังไม่เลือกทีม — "บางทีกดไวไปเลย" (คำ user)\n');
  assert.ok(!/teamKeyOf\(team\)\s*\|\|\s*'maintenance'/.test(dr),
    '\n\n❌ handleCallMtn กลับไปถอยเป็น \'maintenance\' เมื่อไม่รู้ทีม\n'
    + '   ⇒ เรียกผิดทีม และฐานจะเปิดใบ MO ไปผิดคิวตามด้วย (trigger 13/11)\n');
  /* ③ ทีมที่เดาได้ต้องเป็นคำใบ้ ไม่ใช่ค่าที่เลือกให้ */
  assert.match(dr, /team:\s*'',\s*hint:\s*teamForMachine\(/,
    '\n\n❌ ป๊อปอัพเรียกช่างกลับไปเลือกทีมให้ล่วงหน้า — ต้องเป็นคำใบ้ (hint) เท่านั้น\n');
});

test('🚫 no-fg-line-request — ทุกจุดที่ออกใบเบิกเข้าไลน์ต้องกันเลข FG 1xx', () => {
  /* 🔴 13/11 คำสั่ง user: *"FG มันป้อนไลน์ประกอบไม่ได้ … คลังสินค้าเก็บแค่งานสำเร็จรูปพร้อมขาย หรืองานก่อนแพ็ค
     … ไม่มี FG เข้าไลน์"* · วัดจริง: ใบเบิก 1xx เข้าไลน์มีแล้ว 7 ใบ (ยกเลิก 5 · รับ 2) + BOM 1 แถวที่มีลูกเป็น 1xx
     (สินค้าอ้างถึงตัวเอง) ⇒ ระบบเปิดทางให้เกิดของที่ไม่มีอยู่จริงในโรงงาน
     ด่านนี้: ไฟล์ไหน insert `wip_replenish_requests` ต้องเรียก `isFgMat` (utils/storeOps.js) ในไฟล์เดียวกัน */
  const offenders = [];
  for (const file of walk(join(ROOT, 'src'), ['.jsx', '.js'])) {
    if (file.includes('__tests__')) continue;
    const src = stripComments(readFileSync(file, 'utf8'));
    if (!/from\('wip_replenish_requests'\)\.insert\(/.test(src)) continue;
    if (!/\bisFgMat\(/.test(src)) offenders.push(relative(ROOT, file));
  }
  assert.deepEqual(offenders, [],
    '\n\n❌ ไฟล์นี้ออกใบเบิกเข้าไลน์โดยไม่กันเลข FG 1xx:\n   ' + offenders.join('\n   ')
    + '\n   ใช้ `isFgMat(mat)` + ข้อความ `FG_NO_LINE_REQUEST` จาก src/utils/storeOps.js ก่อน insert\n');
});
