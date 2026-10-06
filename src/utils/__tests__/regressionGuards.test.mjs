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
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { BACKUP_RE } from '../schemaAudit.js';   // ตัวตัดสิน "ชื่อตารางสำรอง" จุดเดียวทั้งระบบ
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
    re: /cachedMaster\([^\n]*(?:\n[^\n]*)?\.data\s*\|\|\s*\[\]/g,
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
      'src/pages/PMCheckData.jsx': 1,          // ขยายรูปจุดตรวจ PM (lightbox) — ดูอย่างเดียว
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
    id: 'tabs-folded-into-dropdown',
    scan: ['src/components/PageHeader.jsx'], ext: ['.jsx'],
    re: /MAX_TABS|aria-label="แท็บเพิ่มเติม"|tabList\.slice\(/g,
    why: 'แท็บที่ถูกพับเข้า "⋯ เพิ่มเติม" = คนไม่รู้ว่ามี — user ทัก 01/10/2026 *"ถ้าเป็นดรอปดาว จะทำให้ user ไม่รู้ป่าว"* '
       + '(ProductMaster ลูกค้า/Supplier/ทบทวน CT/Export หายจากสายตา · เดิมอ้าง Miller 7±2 ผิดบริบท)',
    fix: 'แท็บโชว์ครบเสมอ (เดสก์ท็อป wrap · มือถือเลื่อนแนวนอน) · แท็บเยอะเกิน = ยุบของซ้ำ/แยกเป็นหน้า (NAVIGATION-REVIEW §2.3) ไม่ใช่ซ่อน',
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
    re: /new Date\(\)\.toISOString\(\)\.slice/g,
    why: 'toISOString() = UTC ⇒ ช่วง 00:00-06:59 เวลาไทยได้ "วันก่อนหน้า" (กฎเหล็ก Date/Time ใน CLAUDE.md)',
    fix: 'ใช้ getWorkDate() (วันงานตัด 08:00) หรือ todayLocal() จาก src/utils/dateFormat.js',
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
    re: /background:\s*'var\(--accent\)'[^}\n]{0,120}?color:\s*'#|\?\s*'var\(--accent\)'\s*:[^}\n]{0,140}?color:[^,}\n]*\?\s*'#/g,
    why: 'สี --accent กลับด้านตามธีม (มืด = เขียวสว่าง #3dd65c · สว่าง = เขียวเข้ม #0d3d14) '
       + 'ตัวหนังสือสีดิบบนพื้น accent จึงจมเสมอ 1 ธีม — ดำ (#071008) จมในธีมสว่าง · ขาว (#fff) จมในธีมมืด '
       + '(05/10 · ปุ่ม "แจ้งซ่อมใหม่" /mtn-repair อ่านไม่ออก · เจอ 144 จุด 82 ไฟล์)',
    fix: "ตัวหนังสือบนพื้น var(--accent) ใช้ color: 'var(--accent-ink)' เสมอ",
    allow: {},
  },
  {
    id: 'card-shadow-via-token',
    scan: ['src/pages', 'src/components'], ext: ['.jsx'],
    /* จับเงาแบบ "การ์ด/ชิป" ที่เขียนค่าดิบ (offset แนวตั้ง 0-3px และเป็นเงาเดี่ยวทั้งค่า)
       — เงาของ modal (`0 20px 60px`) และเงาผสม inset ไม่เข้าข่าย ปล่อยไว้ตามเดิม */
    re: /boxShadow:\s*['"`]0 [0-3]px \d+px rgba\([^)]*\)['"`]/g,
    why: 'เงาใต้การ์ดในธีมมืดถูกถอดออกแล้ว (24/09 · คำสั่ง user) เพราะบนพื้นเกือบดำมันมองแทบไม่เห็น '
       + 'เหลือแค่ขอบมัวๆ = ของตกแต่งล้วน · แต่**ธีมสว่างยังต้องมีเงา** (ขอบจาง เงาคือตัวแยกการ์ด '
       + 'ออกจากพื้นขาว) ⇒ ค่าเงาต้องมาจาก token ที่ธีมตัดสินให้ · เขียน rgba ดิบไว้ในหน้า = '
       + 'เงานั้นไม่ฟังธีม แล้วธีมมืดจะมีเงาโผล่กลับมาทีละจุดโดยไม่มีใครรู้ '
       + '(วัดจริงก่อนแก้ด้วย audit/uxsweep.mjs: 6 หน้ามีรวมกัน ~60 จุด)',
    fix: "การ์ดแบนที่ไม่ได้ลอย → boxShadow: 'var(--shadow-sm)' (ธีมมืด = none) · "
       + "ของที่ลอยทับเนื้อหาจริง (ป้ายบนรูปผัง · tooltip กราฟ · badge ที่ยื่นออกนอกการ์ด · ปุ่ม toggle) "
       + "→ 'var(--shadow-float)' (มีเงาทั้ง 2 ธีม) · modal/overlay → 'var(--shadow-md|lg)'",
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
    re: /\blabel:\s*`[^`]*\b(p_no|part_no|partNo)\b[^`]*\bmat_no\b|\blabel:\s*`[^`]*\bmat_no\b[^`]*\b(p_no|part_no|partNo)\b/g,
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
  'Management.jsx': 'บอร์ดจอ TV (§6.8)',
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
  const map = code.match(/const\s+CAN_ADD_HERE\s*=\s*\{[^}]*\}/)?.[0] || '';
  assert.ok(/department\s*:/.test(map) && /line\s*:/.test(map) && /team\s*:/.test(map),
    '\n\n❌ OrgSetup.jsx ไม่มี CAN_ADD_HERE ครบ department/line/team\n'
    + '   ทำไมห้ามเขียนเป็นเชน ternary: ลงท้าย `: false` ⇒ ชั้นที่ลืมต่อสาขาถูกบล็อกเงียบ\n'
    + '              ปุ่ม ➕ โชว์ (เช็คคนละที่) แต่กดบันทึกไม่ผ่าน = ผู้ใช้ไม่รู้ว่าทำอะไรผิด\n'
    + '   แก้ยังไง: `const CAN_ADD_HERE = { department: canAddDeptHere, line: canAddLineHere, team: canAddTeamHere }`\n');
  assert.ok(/CAN_ADD_HERE\[modal\.kind\]/.test(code),
    '\n\n❌ handleSave ไม่ได้ใช้ CAN_ADD_HERE ตัดสินสิทธิ์เพิ่ม — ดูเหตุผลด้านบน\n');
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
    });
  }
  assert.deepEqual(bad, [], `\n\n❌ ฟอนต์ต่ำกว่า 11px ${bad.length} จุด\n`
    + '   ทำไมห้าม: จอหน้างานคือ TV 43" แขวนไกล — ต่ำกว่า 11px อ่านไม่ออกจริง\n'
    + '   แก้ยังไง: ยกเป็น 11 · ที่แน่นเกินให้ **เว้นป้าย/ซ่อนป้าย ไม่ใช่ลดฟอนต์** (UI-CONVENTIONS §4)\n'
    + '             ตัวที่สเกลตามจอใช้ `fs()` ที่มีพื้น `Math.max(11, …)` อยู่แล้ว\n\n'
    + bad.slice(0, 20).map(b => '   • ' + b).join('\n') + (bad.length > 20 ? `\n   …อีก ${bad.length - 20}` : '') + '\n');
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
