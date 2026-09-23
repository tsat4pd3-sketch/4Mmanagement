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
    re: /\.from\(\s*'(mtn_orders)'\s*\)\s*\n?\s*\.select\(\s*'\*'/g,
    why: 'ตารางกว้าง (mtn_orders = **116 คอลัมน์**) ที่จอเปิดค้างทั้งวันดึงซ้ำ ⇒ egress ระเบิด · '
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
    if (!/^import[^\n]*\bwLoad\b/m.test(code)) continue;   // ใช้จริง ไม่ใช่แค่ชื่อคล้าย (borrowLoading ฯลฯ)
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
