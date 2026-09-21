/* ═══ 🌳 กาง BOM หลายชั้น (Multilevel BOM) — เทียบเคียง SAP CS12 ═══════════════════
   ที่มา (user 2026-09-02): ส่งภาพจอ SAP "Display Multilevel BOM" มาให้ศึกษา
   แล้วสั่งยกระดับ feature BOM ของเรา

   ── SAP แสดงยังไง ────────────────────────────────────────────────────────────────
     Explosion level  .1 / ..2 / ...3   = ชั้นความลึก (จุดนำหน้า = ระดับ)
     Qty (CUn)        = จำนวน **ต่อ 1 หน่วยของตัวแม่** (ไม่ใช่ต่อ FG)
     Component unit   = PC / KG
   ตัวอย่างจริง 10100384:  .1 20066660 ×1 → ..2 20066662 ×1 → ...3 50029976 ×0.450 KG

   ── 🔴 ปัญหาที่ตัวนี้ทำให้เห็น: BOM เราถูก "แบน" มาจาก SAP แล้วเก็บไว้ทั้ง 2 ชั้น ──
   วัดจริง 2026-09-02: **121 จาก 121 แถวหลาน ถูกใส่ซ้ำที่ชั้น 1 ด้วยทั้งหมด (15 FG)**
   10100384: SAP ชั้น .1 มี 12 รายการ · ของเรามี 15 (เกิน 20066662 · 50029976 · 50027083)
   ⇒ ยอด "ตัดไปเป็น FG" และการระเบิดความต้องการ **นับของก้อนเดียวกัน 2-3 รอบ**

   ⚠️⚠️ util นี้ **ชี้ให้เห็นอย่างเดียว ห้ามแก้ตัวเลข/ลบแถวให้เอง**
   จะต่อโซ่ (ลบแถวแบนออก) หรือคงแบน (ลบ BOM ของขั้นกลาง) เป็นการตัดสินใจของ PE/Planning
   — เดาผิดแล้วความต้องการวัตถุดิบทั้งโรงงานเพี้ยน ย้อนยาก

   pure ทั้งไฟล์ — ไม่แตะ supabase/react
   ═══════════════════════════════════════════════════════════════════════════════ */

const norm = (s) => (s ?? '').toString().trim();
const key = (s) => norm(s).toUpperCase();

/** หน่วยมาตรฐานสำหรับ "แสดงผล" — ฐานมี PC / EA / pcs ปนกัน (ของเดียวกัน 3 สะกด · SAP ใช้ PC)
 *  ⚠️ แปลงเฉพาะตอนแสดง **ไม่แก้ค่าใน DB** (การจัดข้อมูลให้ตรงเป็นงานแยก)
 *  ⚠️ coil เป็น KG เสมอ — ห้ามยุบ KG เข้า PC เด็ดขาด (คนละมิติ) */
export const uomLabel = (u) => {
  const s = norm(u);
  if (!s) return '';
  return /^(pc|pcs|ea|each)$/i.test(s) ? 'PC' : s.toUpperCase();
};

/** จุดนำหน้าแบบ SAP: ชั้น 1 = ".1" · ชั้น 2 = "..2" */
export const levelTag = (lv) => `${'.'.repeat(Math.max(1, lv))}${lv}`;

/* ═══ 📍 เลขรายการ (Item) — SAP 0010 / 0020 / 0030 ═══════════════════════════════
   ⚠️ **นับใหม่ทุก "ตัวแม่" ไม่ใช่นับต่อเนื่องทั้งใบ** (user ยืนยันจากจอ SAP 2026-09-02):
      ชั้น .1 วิ่ง 0010→0120 · ใต้ 20066660 เริ่ม 0010 ใหม่ · ใต้ 20066662 ก็ 0010 ใหม่
   ⇒ ค่านี้มีความหมายเฉพาะ "ภายใน BOM ของตัวแม่ตัวนั้น" ห้ามเอาไปเทียบข้ามตัวแม่
   เก็บใน DB เป็น integer (เรียงถูกเสมอ) แล้วเติมศูนย์หน้าตอนแสดงผลเท่านั้น          */

/** 10 → "0010" · null/0 → '' (ยังไม่ตั้ง — **ไม่ใช่ "0000"** ห้ามเดาว่าเป็นรายการแรก) */
export const itemNoLabel = (n) => {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? String(Math.trunc(v)).padStart(4, '0') : '';
};

/** เลขรายการถัดไปตามธรรมเนียม SAP (เว้นทีละ 10 เพื่อให้แทรกกลางได้)
 *  ⚠️ ไล่จากเลขสูงสุดที่ "ตั้งไว้แล้ว" ไม่ใช่นับจำนวนแถว — แถวที่ยังไม่ตั้งเลขต้องไม่ดันเลขถัดไป */
export const nextItemNo = (rows = [], step = 10) => {
  const max = rows.reduce((m, r) => {
    const v = Number(r?.item_no);
    return Number.isFinite(v) && v > m ? v : m;
  }, 0);
  return Math.min(9999, Math.floor(max / step) * step + step);
};

/** เรียงแบบใบ BOM: ตามเลขรายการก่อน · **ที่ยังไม่ตั้งเลขไปท้ายสุด** (ไม่ใช่ขึ้นก่อนเพราะ null)
 *  แล้วค่อยเรียง mat_no เป็นตัวตัดสินสุดท้าย (ลำดับคงที่ ไม่เต้นทุกครั้งที่โหลด) */
export const byItemNo = (a, b) => {
  const av = Number(a?.item_no), bv = Number(b?.item_no);
  const ao = Number.isFinite(av) && av > 0 ? av : Infinity;
  const bo = Number.isFinite(bv) && bv > 0 ? bv : Infinity;
  if (ao !== bo) return ao - bo;
  return norm(a?.mat_no).localeCompare(norm(b?.mat_no));
};

/* 🏬 รหัสคลัง (SAP Stor.Loc.) มีบ้านของตัวเองที่ `src/utils/storageLoc.js`
   (รูปแบบ/ชนิดพื้นที่/การตรวจ อยู่ที่นั่นทั้งหมด) — re-export ไว้เฉยๆ ให้จุดที่ทำงานกับ BOM
   import จากที่เดียวได้ **ห้ามนิยาม slocLabel ซ้ำที่นี่** */
export { slocLabel } from './storageLoc.js';

/**
 * กาง BOM ของ FG ตัวหนึ่งเป็นรายการเรียงแบบ SAP (depth-first ตามลำดับที่ BOM เก็บไว้)
 *
 * @param {string}   root      mat_no ของตัวตั้งต้น
 * @param {Function} bomOf     (mat) => [{ mat_no, part_name, qty_per_unit, uom, supplier }]
 * @param {object}   [opt]
 * @param {number}   [opt.maxDepth=10]  กันโครงลึกผิดปกติ/ข้อมูลพัง
 * @returns {{
 *   rows: Array,        // เรียงพร้อมแสดงผล
 *   flatDupes: Array,   // mat ที่โผล่ทั้งชั้น 1 และชั้นลึกกว่า = ต้องสงสัยว่านับซ้ำ
 *   cycles: Array,      // เส้นทางที่วนกลับหาตัวเอง (ข้อมูลพัง — ต้องแก้ที่ master)
 *   truncated: boolean, // ตัดที่ maxDepth
 *   maxLevel: number,
 * }}
 *
 * rows[i] = {
 *   id,               // id ของบรรทัด bom_items (null = ตัวเรียกไม่ได้ส่ง id มา — ห้ามลบ)
 *   level,            // 1, 2, 3…
 *   tag,              // ".1" / "..2"
 *   mat_no, part_name, uom, supplier,
 *   qty,              // ต่อ 1 หน่วยของตัวแม่ (ตรงกับคอลัมน์ Qty ของ SAP)
 *   qtyPerRoot,       // สะสมถึง FG — ตัวที่เอาไปคูณยอดผลิตได้จริง
 *   parent,           // mat_no ของตัวแม่ (null = ชั้น 1)
 *   path,             // ['10100384','20066660',…]
 *   hasChildren,
 *   flatDupe,         // true = ตัวนี้ถูกใส่ที่ชั้น 1 ด้วย ทั้งที่อยู่ชั้นลึก (นับซ้ำ)
 *   isDupeRow,        // true = "แถวชั้น 1" ที่ซ้ำกับของลึกกว่า (แถวที่ควรถูกตัดออก)
 *   cycle,            // true = วนกลับหาตัวเอง หยุดกางต่อ
 * }
 */
export function explodeBom(root, bomOf, opt = {}) {
  const { maxDepth = 10 } = opt;
  const bom = typeof bomOf === 'function' ? bomOf : () => [];
  const rootMat = norm(root);
  const rows = [];
  const cycles = [];
  let truncated = false;
  let maxLevel = 0;

  /* sheetFor = ตัวสลับ "ใบ" ตอนเดินลงชั้นถัดไป (ดู buildBomIndex — กันต้นไม้ระเบิด)
     ตัวเรียกเก่าที่ส่ง bomOf ดิบมา (ไม่มี sheetFor) ⇒ อยู่ใบเดิมตลอด = พฤติกรรมเดิม */
  const nextSheet = typeof opt.sheetFor === 'function' ? opt.sheetFor : (_m, cur) => cur;

  const walk = (mat, sheet, level, qtyPerParentUnit, path) => {
    if (level > maxDepth) { truncated = true; return; }
    // เรียงตามใบ BOM ของตัวแม่ (Item 0010/0020…) · ยังไม่ตั้งเลข = ตกท้ายเรียงตาม mat (ลำดับคงที่)
    const kids = [...(bom(mat, sheet) || [])].sort(byItemNo);
    kids.forEach(k => {
      const m = norm(k?.mat_no);
      if (!m) return;
      const per = Number(k.qty_per_unit) || 0;
      const cum = qtyPerParentUnit * per;
      const isCycle = path.includes(m);
      const kidSheet = nextSheet(m, sheet);
      const kidsOf = isCycle ? [] : (bom(m, kidSheet) || []);
      const row = {
        level, tag: levelTag(level),
        // 🔑 id ของบรรทัด bom_items จริง — ต้องมี ไม่งั้นลบ "แถวนับซ้ำ" จากจอต้นไม้ไม่ได้
        //    (null = ตัวเรียก bomOf ไม่ได้ส่ง id มา ⇒ จอต้องซ่อนปุ่มลบ ห้ามเดา id)
        id: k.id ?? null,
        mat_no: m,
        part_name: k.part_name || '',
        uom: k.uom || '',
        supplier: k.supplier || '',
        // 📍 เลขรายการ/คลัง ของบรรทัดนั้นใน BOM ของตัวแม่ (null = ยังไม่ตั้ง ห้ามเดา)
        item_no: k.item_no ?? null,
        storage_location: k.storage_location || '',
        qty: per,
        qtyPerRoot: cum,
        parent: path[path.length - 1] || null,
        path: [...path, m],
        hasChildren: kidsOf.length > 0,
        flatDupe: false,
        isDupeRow: false,
        cycle: isCycle,
      };
      rows.push(row);
      if (level > maxLevel) maxLevel = level;
      if (isCycle) { cycles.push([...path, m]); return; }
      walk(m, kidSheet, level + 1, cum, [...path, m]);
    });
  };

  walk(rootMat, nextSheet(rootMat, undefined), 1, 1, [rootMat]);

  /* ── ตรวจ "แบนมาจากหลายชั้น" ────────────────────────────────────────────────
     mat ที่โผล่ทั้งชั้น 1 และชั้นลึกกว่าในต้นเดียวกัน = ของก้อนเดียวถูกนับ 2 รอบ
     ⚠️ เป็น "ต้องสงสัย" ไม่ใช่ข้อสรุป — ของบางตัวใช้จริงทั้งใน sub-assy และที่ FG โดยตรงได้
        (SAP มีเลข Item แยกตำแหน่ง แต่ตารางเราไม่มี จึงแยกไม่ออกจากข้อมูลอย่างเดียว) */
  const lvl1 = new Set(rows.filter(r => r.level === 1).map(r => r.mat_no));
  const deep = new Set(rows.filter(r => r.level > 1).map(r => r.mat_no));
  const dupeMats = [...lvl1].filter(m => deep.has(m));
  const dupeSet = new Set(dupeMats);
  rows.forEach(r => {
    if (!dupeSet.has(r.mat_no)) return;
    r.flatDupe = true;
    if (r.level === 1) r.isDupeRow = true;   // แถวนี้คือตัวที่ควรถูกตัดออกถ้ายืนยันว่าต่อโซ่
  });

  const flatDupes = dupeMats.map(m => {
    const at1 = rows.find(r => r.level === 1 && r.mat_no === m);
    const deeper = rows.filter(r => r.level > 1 && r.mat_no === m);
    return {
      mat_no: m,
      part_name: at1?.part_name || deeper[0]?.part_name || '',
      qtyAtLevel1: at1?.qty ?? 0,
      deepestLevel: Math.max(...deeper.map(d => d.level)),
      // 🔁 ตัวแม่ตัวเดียวอาจโผล่หลายครั้งในต้นไม้ — โชว์ชื่อซ้ำ 60 รอบ = อ่านไม่ออก (21/09)
      via: [...new Set(deeper.map(d => d.parent).filter(Boolean))],
    };
  });

  return { rows, flatDupes, cycles, truncated, maxLevel };
}

/**
 * ยอดที่ควรใช้จริงต่อ FG 1 ตัว เมื่อ **ต่อโซ่** (ใช้เฉพาะใบชั้นล่างสุดของแต่ละสาย)
 * = สิ่งที่ SAP เรียก "Reqd Qty" ของ component ที่ต้องซื้อ/เบิกจริง
 *
 * ⚠️ ตัวนี้ให้ไว้ **เทียบให้เห็นส่วนต่าง** เท่านั้น ห้ามเอาไปแทนสูตรที่ระบบใช้อยู่
 *    จนกว่า PE จะเคาะว่าจะต่อโซ่หรือคงแบน (เปลี่ยนเงียบ = ความต้องการทั้งโรงงานขยับ)
 */
export function leafRequirements(root, bomOf, opt) {
  const { rows } = explodeBom(root, bomOf, opt);
  const m = new Map();
  rows.forEach(r => {
    if (r.hasChildren || r.cycle) return;             // ตัวที่ยังกางต่อได้ ไม่ใช่ของที่เบิกจริง
    m.set(r.mat_no, (m.get(r.mat_no) || 0) + r.qtyPerRoot);
  });
  return [...m.entries()].map(([mat_no, qty]) => ({ mat_no, qty }))
    .sort((a, b) => a.mat_no.localeCompare(b.mat_no));
}

/* ═══ 🔀 pattern การไหลของวัสดุ (user บอกไว้ 2026-09-02) ═══════════════════════════
   "เหล็ก coil 5xxxxxxx ส่วนใหญ่จะผลิตที่ไลน์ปั๊ม กลายเป็น 2xxxxxxx แล้วเข้าสโตร์
    หลังจากนั้นถึงจะส่งเบอร์ 2xxxxxxx เข้ามาไลน์ประกอบ เพื่อทำ operation spot/nut weld
    และก็จะประกอบเป็นพาร์ทหลัก FG 1xxxxxxx — pattern พื้นฐาน"

        5xx coil ──ไลน์ปั๊ม──► 2xx ──สโตร์──► ไลน์ประกอบ ──► 1xx FG
                                   3xx ของซื้อ ──────────────┘

   ⇒ **coil 5xx ไม่ควรอยู่ใน BOM ของ FG 1xx โดยตรง** และไม่ควรถูกจ่ายเข้าไลน์ประกอบ
   วัดจริง 2026-09-02: มี **71 แถว** ที่ 5xx อยู่ใต้ 1xx (ส่วน 5xx→2xx 40 แถว = ถูก)
   ผลที่ตามมา: ตัวเสนอ "ย้ายเข้าไลน์ลูก" เสนอย้าย coil เข้าไลน์ประกอบ (user จับได้จากจอจริง)

   ⚠️ เป็น "ต้องสงสัย" ไม่ใช่กฎตายตัว — บาง FG อาจปั๊มกับประกอบในไลน์เดียวจริง
      ⇒ **เตือน ห้ามบล็อก และห้ามแก้ BOM ให้เอง**
   ═══════════════════════════════════════════════════════════════════════════════ */

/** เบอร์ตัวแรกของ mat (ใช้ตัวเดียวตามกฎ matPrefix — ช่วงเลขขยับได้ แต่ตัวแรกนิ่ง) */
const digitOf = (mat) => {
  const c = norm(mat)[0];
  return c >= '0' && c <= '9' ? c : null;
};

/** ไลน์นี้เป็นไลน์ประกอบไหม (ไม่รู้ = null ห้ามเดา) */
export const isAssemblyLine = (lineType) =>
  lineType == null || lineType === '' ? null : lineType === 'welding_assembly';

/* ⚠️⚠️ ตัดสินรายแถวเดี่ยวๆ ไม่ได้ ต้องดู "พี่น้องทั้งชุด" (user แก้ให้ 2026-09-02)

   "BOM งานปั๊มแล้วขายเลย จาก 5 ไป 1 จะดูได้ง่าย เพราะลูกจะไม่เยอะ
    งานปั๊มส่วนใหญ่จะมีลูกเบอร์ 5 แค่เลขเดียว
    ถ้างานประกอบ จะรวมหลายๆ เบอร์ มีโอกาสที่จะมีทั้ง 2 3 5 มารวมเป็น 1"

   ⇒ **FG ที่มีลูกเป็น 5xx ล้วน = งานปั๊มแล้วขายเลย ถูกต้อง ห้ามเตือน** (มีจริง 21 FG)
     เตือนเฉพาะ 5xx ที่ปนอยู่กับ 2xx/3xx (งานประกอบ) — มีจริง 22 FG

   "อย่านับซ้ำกัน ถ้าจาก 5 ผ่านไลน์ปั๊มกลายเป็น 2 แล้ว ไปอยู่เป็นลูกเบอร์ 1 ตัวไหน
    ต้องไม่นับ 5 แล้ว เพราะถูกตัดจ่ายเปลี่ยนสภาพจาก 5 เป็น 2 ไปแล้ว"

   ⇒ 5xx ที่ **ไล่ผ่าน 2xx พี่น้องถึงได้** = นับซ้ำแน่นอน (crit) — วัดจริง 31 แถว / 15 FG
     5xx ที่ไล่ไม่ถึง = ต้องตรวจ (warn) — 40 แถว (อาจใช้ที่ไลน์ประกอบจริง หรือขาดขั้นกลาง)   */

/**
 * ตรวจ BOM ทั้งชุดของแม่ 1 ตัว — คืนคำเตือนรายลูก (null = ไม่มีอะไรผิดสังเกต)
 * @param {string}   parentMat
 * @param {Array}    children  [{ mat_no, ... }] ลูกชั้น 1 ของแม่ตัวนี้
 * @param {Function} bomOf     ใช้ไล่ว่า 5xx ตัวนั้นอยู่ใต้พี่น้อง 2xx หรือเปล่า
 * @returns {Map<string, {code, level, text}>}  mat_no → คำเตือน
 */
export function checkBomFlow(parentMat, children = [], bomOf) {
  const bom = typeof bomOf === 'function' ? bomOf : () => [];
  const out = new Map();
  const p = digitOf(parentMat);
  const kids = (children || []).map(k => norm(k?.mat_no)).filter(Boolean);
  const digits = kids.map(digitOf);
  // งานปั๊มแล้วขายเลย = ไม่มีลูกที่เป็นชิ้นส่วน (2xx/3xx) เลย → 5xx ที่มีคือวัตถุดิบตรงตัว
  const isStampOnly = !digits.some(d => d === '2' || d === '3');

  /* ของที่ไล่ผ่านพี่น้องถึงได้ (ลึกกี่ชั้นก็ได้) = ถูกแปรสภาพไปแล้ว ไม่ควรนับที่ชั้นนี้อีก */
  const reachable = new Set();
  const seen = new Set();
  const dive = (m, depth) => {
    if (depth > 10 || seen.has(m)) return;
    seen.add(m);
    (bom(m) || []).forEach(g => {
      const gm = norm(g?.mat_no);
      if (!gm) return;
      reachable.add(gm);
      dive(gm, depth + 1);
    });
  };
  kids.forEach(k => dive(k, 1));

  kids.forEach((m, i) => {
    const c = digits[i];
    if (!c) return;                                  // เลขภายใน/เลขลูกค้า — ไม่ตัดสิน
    if (c === '1' && p !== null) {
      out.set(m, { code: 'fg_as_component', level: 'warn',
        text: 'FG (1xx) ถูกใส่เป็นชิ้นส่วน — ปกติ FG เป็นผลลัพธ์ ไม่ใช่ของที่ป้อนเข้า' });
      return;
    }
    if (c !== '5') return;
    if (reachable.has(m)) {
      out.set(m, { code: 'raw_double_counted', level: 'crit',
        text: 'วัตถุดิบตัวนี้อยู่ใต้ชิ้นส่วนพี่น้องอยู่แล้ว — ถูกแปรสภาพเป็นพาร์ทปั๊มไปแล้ว นับที่ชั้นนี้อีกคือนับซ้ำ' });
      return;
    }
    if (p === '1' && !isStampOnly) {
      out.set(m, { code: 'raw_in_assembly', level: 'warn',
        text: 'วัตถุดิบ (5xx) ปนอยู่กับชิ้นส่วน (2xx/3xx) ในงานประกอบ — ตรวจว่าใช้ที่ไลน์ประกอบจริง หรือขาดขั้นกลาง 2xx' });
    }
    // งานปั๊มแล้วขายเลย (5xx ล้วน) = ไม่เตือน
  });
  return out;
}

/**
 * ตรวจว่า "จ่าย mat นี้เข้าไลน์นี้" ตรง pattern ไหม
 * @param {string} mat
 * @param {string|null} lineType  production_lines.line_type ของไลน์ปลายทาง
 */
export function checkIssueFlow(mat, lineType) {
  const d = digitOf(mat);
  const asm = isAssemblyLine(lineType);
  if (d === '5' && asm === true) return {
    code: 'raw_to_assembly', level: 'warn',
    text: 'เหล็ก/วัตถุดิบ (5xx) เข้าไลน์ประกอบ — ตาม pattern ต้องเข้าไลน์ปั๊มก่อน แล้วส่ง 2xx เข้าประกอบ',
  };
  if (d === '1') return {
    code: 'fg_into_line', level: 'warn',
    text: 'FG (1xx) ถูกจ่ายเข้าไลน์ — FG เป็นของออกจากไลน์ ไม่ใช่ของที่ป้อนเข้า',
  };
  return null;
}

/** ยอดตามสูตรที่ระบบใช้อยู่ตอนนี้ (แบน ชั้นเดียว) — ไว้เทียบกับ leafRequirements */
export function flatRequirements(root, bomOf) {
  const bom = typeof bomOf === 'function' ? bomOf : () => [];
  return (bom(norm(root)) || [])
    .filter(b => norm(b?.mat_no))
    .map(b => ({ mat_no: norm(b.mat_no), qty: Number(b.qty_per_unit) || 0 }))
    .sort((a, b) => a.mat_no.localeCompare(b.mat_no));
}

/* ═══ 🧱 buildBomIndex — "ใครเป็นลูกของใคร" จุดเดียวของทั้งระบบ (2026-09-16) ═══════════════
   ที่มา (user 2026-09-16): *"เรื่อง bom level ตอนนี้ เหมือนปรับแก้อะไรไม่ได้ เหมือน SAP เพราะ SAP
   จะมีเลเวลควบคุม หรือเราตกเรื่องนี้ไป"* + *"ถ้าทำเลเวล bom ได้แบบ pfc … เหนือกว่า sap ตรงที่เรามี OP"*

   ── ข้อจำกัดเดิมที่ทำให้ "แก้ชั้นไม่ได้" (วัดจริง 16/09) ──────────────────────────────────
   ทุกหน้าสร้างต้นไม้เองด้วยสูตรเดียวกัน: `matOf[row.product_id]` → ตัวแม่
   ⇒ **ตัวแม่ต้องเป็นแถวใน `dr_products` เท่านั้น** · ของที่อยู่แค่ `parts_master` = ใบไม้ตลอดกาล
   เคสจริง `10100817`: ลูก 5 ตัว เป็น product แค่ 1 ⇒ ต่อชั้นไม่ได้ทั้งที่ของจริงมีชั้น
   ทั้งฐาน 506 แถว/98 สินค้า — มีแค่ **57 แถว (11%)** ที่ลูกมี BOM ต่อ ⇒ ~90% ตรึงชั้นเดียว

   ── กติกา ────────────────────────────────────────────────────────────────────────────
   1. **`parent_mat` ชนะเสมอเมื่อตั้งค่าไว้** · ว่าง = ตัวแม่คือ product ของ `product_id` (พฤติกรรมเดิมเป๊ะ)
      ⇒ แถวเก่า 506 แถวที่ `parent_mat` เป็น null ให้ผลเท่าเดิมทุกจอ **ไม่ต้องแก้พร้อมกัน**
   2. **`product_id` ยังเป็น "บรรทัดนี้อยู่ในใบ BOM ของ FG ตัวไหน" เสมอ** — ห้ามถอด แม้ตั้ง parent_mat แล้ว
      (ไม่งั้นลบ FG แล้วบรรทัดลอย + คิวรีเดิมที่ filter ด้วย product_id จะหาไม่เจอ)
   3. **ห้ามให้หน้าไหนคำนวณตัวแม่เอง** — เขียนซ้ำเมื่อไหร่ ชั้นจะเพี้ยนคนละจอทันที
      (บทเรียนเดียวกับ collapseOps/oee ที่ต้องมี util กลางตัวเดียว)
   pure — ไม่แตะ supabase/react (เทส `__tests__/bomLevel.test.mjs`)
   ═══════════════════════════════════════════════════════════════════════════════════ */

/**
 * @param {Array}  rows        แถว bom_items (ต้องมี product_id, mat_no, qty_per_unit · parent_mat/op_no ถ้ามี)
 * @param {object} matOfProduct  { [product_id]: mat_no } ของ dr_products
 * @returns {{ bomOf: (mat:string)=>Array, parentOf: (row:object)=>string, orphans: Array }}
 *   orphans = แถวที่หาตัวแม่ไม่ได้เลย (product_id ไม่รู้จัก + ไม่ได้ตั้ง parent_mat)
 *             ⚠️ ต้องเอาไปโชว์ ห้ามกลืน — แปลว่าบรรทัดนั้นหายไปจากต้นไม้เงียบๆ
 */
export function buildBomIndex(rows = [], matOfProduct = {}) {
  const parentOf = (r) => norm(r?.parent_mat) || norm(matOfProduct[r?.product_id]);

  /* 🔴🔴 `parent_mat` ต้องมีขอบเขต "ใบเดียวกัน" เสมอ — ไม่งั้นต้นไม้ระเบิด (บั๊กจริง 2026-09-21)
     `parent_mat` เก็บเป็น **mat** ไม่ใช่ id ⇒ ค่าเดียวกันไปโผล่ในใบ BOM ของ FG หลายตัวได้
     (วัดจริง: `20058693` ถูกตั้งเป็นตัวแม่ใน **6 ใบ** · `20058626` ใน 7 ใบ)
     ถ้าดึงลูกด้วย mat เฉยๆ = ทุกครั้งที่เจอ mat นั้น จะกางลูกของ *ทุกใบ* มารวมกัน
     ⇒ **10101158 (22 พาร์ท) กางออกมา 1,276 แถว ลึก 5 ชั้น** + แถบ "นับซ้ำ" พ่นชื่อแม่ซ้ำ 60 รอบ
     (user ส่งจอมาให้ดู 21/09 — จอใช้งานไม่ได้ และปุ่มลบแถวนับซ้ำกลายเป็นของอันตราย)

     กติกาที่ถูก (เทียบ SAP: BOM 1 ใบ = ของตัวแม่ตัวเดียว):
       ลูกของ `mat` ในใบ `sheetId` =
         ① บรรทัดใน **ใบเดียวกัน** ที่ตั้ง `parent_mat = mat` (คนจัดชั้นเองในใบนี้) — ถ้ามี ใช้ชุดนี้
         ② ไม่มี → ใบ BOM **ของ `mat` เอง** (บรรทัดชั้น 1 ของ product ตัวนั้น)
     เลือกอย่างใดอย่างหนึ่งเสมอ **ห้ามรวม 2 ชุด** (รวม = นับซ้ำ) */
  const byParentMat = {};   // mat → บรรทัดที่ตั้ง parent_mat = mat (ทุกใบ)
  const bySheetMat  = {};   // mat ของ product → บรรทัดชั้น 1 ในใบของ product นั้น
  const productIdOf = {};   // mat → product_id ของใบ BOM ที่เป็นของ mat นั้น
  Object.entries(matOfProduct || {}).forEach(([pid, m]) => { if (norm(m)) productIdOf[norm(m)] = pid; });

  const orphans = [];
  (rows || []).forEach(r => {
    const pm = norm(r?.parent_mat);
    if (pm) { (byParentMat[pm] = byParentMat[pm] || []).push(r); return; }
    const own = norm(matOfProduct[r?.product_id]);
    if (!own) { orphans.push(r); return; }
    (bySheetMat[own] = bySheetMat[own] || []).push(r);
  });

  /** ลูกชั้นถัดไปของ mat · sheetId = ใบที่กำลังไล่อยู่ (ไม่ส่ง = ใบของ mat เอง) */
  const bomOf = (mat, sheetId) => {
    const m = norm(mat);
    if (!m) return [];
    const pm = byParentMat[m] || [];
    const own = bySheetMat[m] || [];
    /* ไม่ระบุใบ (ตัวเช็ควนลูป/เช็ค pattern การไหล) — ใบของ mat เองก่อน ไม่มีค่อยเอาทุกใบ
       เผื่อไว้กว้างโดยตั้งใจ: ตัวเช็คพวกนี้ "มองกว้างเกิน" ปลอดภัยกว่า "มองไม่เห็น" */
    if (sheetId === undefined) return own.length ? own : pm;
    const same = pm.filter(r => r.product_id === sheetId);
    return same.length ? same : own;
  };
  /** ใบที่ต้องใช้เมื่อเดินลงไปใน mat นี้ต่อ — **ต้องตัดสินแบบเดียวกับ `bomOf` เป๊ะ**
   *  ① ใบปัจจุบันจัดชั้นลูกของ mat ไว้เอง → อยู่ใบเดิม (เคารพการจัดชั้นของคนในใบนี้)
   *  ② ไม่ได้จัด → สลับไปใบ BOM ของ mat เอง (ถ้ามี) · ไม่มีก็อยู่ใบเดิม
   *  ⚠️ ถ้า 2 ตัวนี้ตัดสินคนละแบบ จะได้ "ลูกจากใบหนึ่ง แต่เดินต่อในอีกใบ" = ต้นไม้เพี้ยนเงียบ */
  const sheetFor = (mat, curSheet) => {
    const m = norm(mat);
    const staysHere = (byParentMat[m] || []).some(r => r.product_id === curSheet);
    return staysHere ? curSheet : (productIdOf[m] ?? curSheet);
  };

  return { bomOf, parentOf, orphans, sheetFor, productIdOf };
}

/** ย้ายบรรทัดไปเป็นลูกของ mat อื่น — คืน patch ที่จะเขียนลง DB (null = ย้ายไม่ได้ + เหตุผล)
 *  กันเคสที่ทำให้ต้นไม้พัง: ย้ายไปใต้ตัวเอง · ย้ายไปใต้ลูกหลานของตัวเอง (วนลูป) */
export function moveBomLine(row, toMat, bomOf) {
  const child = norm(row?.mat_no);
  const to = norm(toMat);
  if (!child) return { ok: false, reason: 'บรรทัดนี้ไม่มี MAT' };
  if (!to) return { ok: true, patch: { parent_mat: null } };          // คืนไปชั้น 1 ของใบ
  if (key(to) === key(child)) return { ok: false, reason: 'ย้ายไปใต้ตัวเองไม่ได้' };
  // ไล่ลูกหลานของ child — ถ้า to อยู่ในนั้น = วนลูป
  const seen = new Set([key(child)]);
  const stack = [child];
  while (stack.length) {
    const cur = stack.pop();
    for (const k of (bomOf?.(cur) || [])) {
      const m = norm(k?.mat_no);
      if (!m || seen.has(key(m))) continue;
      if (key(m) === key(to)) return { ok: false, reason: `ย้ายไม่ได้ — ${to} อยู่ใต้ ${child} อยู่แล้ว (จะวนลูป)` };
      seen.add(key(m));
      stack.push(m);
    }
  }
  return { ok: true, patch: { parent_mat: to } };
}
