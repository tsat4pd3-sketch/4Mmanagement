/* ═══ 🔁 "ของชิ้นเดียวถูกนิยามไว้ 2 ใบ" — ลิสต์ให้ PE ไล่เคลียร์ ════════════════════════
   ที่มา (user 06/10): *"ตอนนี้เราว่า BOM อนาคตจะมีปัญหา… พาร์ท 100 FG และก็มี BOM ของ 200
   ที่เป็นพาร์ทยังไม่พร้อมขาย แยกกันใช่มั้ย"* → ไล่ลิสต์ทั้งฐานแล้วเจอ **94 คู่**
   แล้วสั่ง *"ทำจอสรุป 94 คู่ให้ PE ไล่เคลียร์เลย"*

   ── ปัญหาคืออะไร ────────────────────────────────────────────────────────────────────
   `bom_items.parent_mat` ให้ใครก็เป็นตัวแม่ได้ ⇒ ลูกของพาร์ท `X` ถูกกรอกได้ 2 ที่:
     ① ในใบของ FG (แถวที่ตั้ง `parent_mat = X` ในใบนั้น)
     ② ในใบ BOM ของ `X` เอง (แถวชั้น 1 ของ product `X`)
   `bomOf(mat, sheet)` เลือก **`same.length ? same : own`** ⇒ มี ① = **① ชนะทั้งชุด ไม่ได้เอามารวมกัน**
   🔴 ของที่มีแต่ใน ② จึง **ไม่ถูกระเบิดเลย** (ความต้องการวัตถุดิบเป็น 0 ทั้งที่ของถูกใช้จริง)

   ── จอนี้ทำอะไร / ไม่ทำอะไร ──────────────────────────────────────────────────────────
   ✅ ชี้ให้เห็นว่าคู่ไหนต่างกันตรงไหน + จัดลำดับความร้อน + ให้คนกดไปเปิดใบทั้ง 2 ใบ
   🔴 **ไม่ยุบ ไม่ลบ ไม่เลือกใบให้เอง** — ของบางตัวใช้ต่างกันตามรุ่น/ลูกค้าได้จริง
      (เคสจริง `20070036`: ใบ FG = RB3B-8B224 · ใบ sub = MB3B-8C306 **คนละรุ่น ถูกทั้งคู่ก็ได้**)
      รวม 2 ชุดเอง = นับซ้ำ · ลบข้างใดข้างหนึ่ง = ยอดขาด กู้ไม่ได้ ⇒ เป็นการตัดสินใจของ PE/Planning

   ── ทำไมต้องมี "ลายนิ้วมือ" (fingerprint) ────────────────────────────────────────────
   PE กด "ตรวจแล้ว" ไว้ แต่พรุ่งนี้มีคนแก้ BOM ⇒ ผลตรวจเก่า**ใช้ไม่ได้แล้ว**
   ⇒ เก็บลายนิ้วมือของ "ชุดลูกทั้ง 2 ใบ ณ เวลาที่ตรวจ" · ไม่ตรง = **เปิดคู่นั้นกลับมาใหม่**
   🔴 ห้ามถือว่า "เคยตรวจแล้ว = จบตลอดกาล" (ของที่เคลียร์แล้วแต่ข้อมูลเปลี่ยน = จอโกหก)

   pure ทั้งไฟล์ — ไม่แตะ supabase/react · การตัดสินทั้งหมดอยู่ที่นี่ **ห้ามคิดเองในหน้า**
   ═══════════════════════════════════════════════════════════════════════════════════ */

import { buildBomIndex } from './bomTree.js';

const norm = (s) => (s ?? '').toString().trim();
const key = (s) => norm(s).toUpperCase();

/* ── ผลตัดสินของแต่ละคู่ ───────────────────────────────────────────────────────────────
   เรียงตาม `rank` = ลำดับที่ PE ควรจับก่อน (เลขน้อย = ร้อนกว่า)
   🔴 `tone` ต้องเป็นคีย์ของตารางสีกลาง `STATUS_COLOR` (`src/utils/statusTone.js`) เท่านั้น
      — good | warn | bad | none · **ห้ามตั้ง hex เอง** (มีด่าน `status-palette-single-source`)
      "ตรงกัน" = `none` (เทา) ไม่ใช่เขียว — ยังต้องแก้ 2 ที่ ไม่ใช่เรื่องที่จบแล้ว
   🔴 `subset` ร้อนกว่า `conflict` เพราะ **ของหายจากการระเบิดจริง** ไม่ใช่แค่ 2 ใบไม่ตรงกัน  */
export const DUP_VERDICTS = {
  subset: {
    rank: 1, tone: 'bad', label: 'ใบนี้ขาดของ',
    /* 🔴 ข้อความใน `why`/`label` ขึ้นจอตรงๆ — **ห้ามใส่ markdown** (`**…**` โผล่เป็นดอกจันบนจอ) */
    why: 'ใบนี้กรอกลูกไว้น้อยกว่าใบของพาร์ทเอง — ตัวที่ขาดไม่ถูกระเบิดเลย (ความต้องการเป็น 0)',
  },
  /* 🔴 qty เข้ามาอยู่ในกติกา 2026-10-14 — เดิมเทียบแค่ "รายชื่อ MAT" ⇒ คู่ที่รายการตรงแต่ qty ต่าง
     ถูกตีเป็น `identical` ("ตรงกัน") = **จอโกหก** (เคสจริง 20066663: 0.171 ↔ 0.341 แต่จอว่าตรงกัน) */
  qty_diff: {
    rank: 2, tone: 'bad', label: 'รายการตรง แต่จำนวนไม่ตรง',
    why: 'ของชุดเดียวกันแต่ qty ต่าง — ยอดที่ระเบิดออกมาผิดแน่ ขึ้นกับว่าเปิดใบไหน',
  },
  conflict: {
    rank: 3, tone: 'bad', label: 'ขัดกันจริง',
    why: 'ทั้ง 2 ใบมีของที่อีกใบไม่มี และไม่ใช่เรื่อง "ลึกกว่ากัน 1 ขั้น" — ต้องตัดสินว่าใบไหนถูก',
  },
  /* ⚖️ ชิ้น ≠ shot — กฎเหล็กของโปรเจค (ดู CLAUDE.md §ชิ้น ≠ shot · utils/pairTotals.js)
     งานคู่ปั๊มทีเดียวได้ 2 ชิ้น ⇒ ใบหนึ่งกรอก "ต่อ shot" อีกใบกรอก "ต่อชิ้น" = ต่างกันพอดี 2 เท่า
     🔴 **ไม่ใช่ใครกรอกผิด — คนละหน่วยในช่องเดียวกัน** ⇒ ต้องแยกจาก `qty_diff` ไม่งั้น PE แก้ผิดทาง
     เคสจริง 14/10 (user ชี้เอง): คอยล์ 50027083 "WSS-M1A367-A33 1.7X 350XC" ·
     ทะเบียนเขียน "1:2" ไว้เองในช่อง part_no · 0.341 ÷ 2 = 0.1705 → 0.171 (×1.994) */
  pair_shot: {
    rank: 4, tone: 'warn', label: 'ต่างกันพอดี 2 เท่า — ชิ้น vs shot',
    why: 'จำนวนต่างกันพอดี 2 เท่าทุกตัว = ใบหนึ่งน่าจะกรอก "ต่อ shot" อีกใบ "ต่อชิ้น" (งานคู่ปั๊มทีเดียวได้ 2) — ต้องเคาะว่าทั้งโรงงานใช้หน่วยไหน ไม่ใช่แก้ตัวเลขทีละใบ',
  },
  extra: {
    rank: 5, tone: 'warn', label: 'ใบนี้มีเกิน',
    why: 'ใบนี้มีของที่ใบของพาร์ทเองไม่มี — ใบนั้นถูกใช้ที่อื่นด้วย ตรงนั้นจะขาดของ',
  },
  identical: {
    rank: 6, tone: 'none', label: 'ตรงกัน แต่ต้องแก้ 2 ที่',
    why: 'ตัวเลขยังตรง · ความเสี่ยงคือวันหน้าแก้ใบเดียวแล้วอีกใบค้าง = ขัดกันเงียบ',
  },
  deeper: {
    rank: 7, tone: 'good', label: 'ลึกกว่า 1 ขั้น (โซ่ตรงกัน)',
    why: 'ใบนี้บันทึกขั้นกระบวนการ · ใบของพาร์ทบันทึกชุดวัตถุดิบ — ไม่ขัดกัน',
  },
  op: {
    rank: 8, tone: 'good', label: 'ใบขั้นงาน — ไม่เทียบ',
    why: 'ใบขั้นงานตอบ "ขั้นนี้กินอะไร" · ใบพาร์ทตอบ "พาร์ทนี้ประกอบจากอะไร" — คนละคำถาม ถูกทั้งคู่',
  },
  /* 🧺 ตะกร้ารับท้ายลิสต์ — รูปแบบที่ยังไม่เคยเจอ **ห้ามหายจากจอ**
     (กฎโปรเจค: ตัวที่ตีชนิดไม่ได้ต้องโผล่ ไม่ใช่ถูกกรองออกเงียบๆ) */
  other: {
    rank: 9, tone: 'warn', label: 'ยังตีชนิดไม่ได้',
    why: 'รูปแบบที่กติกายังไม่ครอบ — ต้องให้คนดูด้วยตา (แจ้งทีมพัฒนาได้)',
  },
};

/* ── 🔢 เครื่องมือเทียบ qty ──────────────────────────────────────────────────────
   `sameQty` ใช้ epsilon เล็กมาก (ทศนิยมลอยตัว) — ไม่ใช่ "ปัดให้เท่ากัน"
   `isPairRatio` ยอมคลาด 2.5% เพราะของจริงถูกปัดทศนิยม 3 ตำแหน่งตอนกรอก
   (0.341 ÷ 2 = 0.1705 → คนกรอก 0.171 ⇒ อัตราส่วนจริง 1.994 ไม่ใช่ 2.000 เป๊ะ) */
const EPS = 1e-9;
export const sameQty = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) <= EPS;
export const isPairRatio = (a, b) => {
  const x = Number(a) || 0, y = Number(b) || 0;
  if (x <= 0 || y <= 0) return false;
  return Math.abs(Math.max(x, y) / Math.min(x, y) - 2) <= 0.05;
};
/** mat → qty รวม (แถวซ้ำของ mat เดียวกันในใบเดียวกัน = บวกกัน ไม่ใช่ทับกัน) */
const qtyMapOf = (rows) => {
  const m = new Map();
  for (const r of rows || []) {
    const k = key(r?.mat_no);
    if (!k) continue;
    m.set(k, (m.get(k) || 0) + (Number(r?.qty_per_unit) || 0));
  }
  return m;
};
const withQty = (mats, qmap) => mats.map(m => `${m}:${qmap.get(m) ?? 0}`);

/** ลำดับที่ PE ควรจับก่อน (เลขน้อย = ร้อนกว่า) · ชนิดที่ไม่รู้จักไปท้ายสุด ห้ามหาย */
export const dupRank = (verdict) => DUP_VERDICTS[verdict]?.rank ?? 99;

/* ── ลายนิ้วมือ: FNV-1a 32-bit → hex 8 ตัว ──────────────────────────────────────────
   ใช้แค่ "เปลี่ยนไหม" ไม่ใช่งานความปลอดภัย ⇒ ไม่ต้องเป็น crypto hash
   🔴 ต้อง deterministic ข้ามเครื่อง/ข้ามรอบ ⇒ เรียงคีย์ก่อนเสมอ (ลำดับแถวจาก DB ไม่คงที่) */
const fnv1a = (s) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
};

/** ลายนิ้วมือของคู่หนึ่ง = ชุดลูกทั้ง 2 ใบ (เรียงแล้ว) — ฝั่งใดเปลี่ยน = ค่าเปลี่ยน */
export const dupFingerprint = (kidsHere = [], kidsOwn = []) =>
  fnv1a(`${[...kidsHere].sort().join(',')}|${[...kidsOwn].sort().join(',')}`);

/** คีย์ของคู่ (ใช้เป็นคีย์ upsert ฝั่ง DB ด้วย — ห้ามเปลี่ยนรูป) */
export const dupKeyOf = (sheetMat, mat) => `${key(sheetMat)}|${key(mat)}`;

/* ── ลูกหลานที่ "ไล่ต่อจากใบของตัวเอง" ได้ (ใช้ตัดสิน deeper) ───────────────────────────
   เคสจริง: ใบ FG เขียน `20059852 → 20059853 (ก่อนชุบ)` ส่วนใบของ 20059852 เขียน
   `→ 20059854 + 30042570` ⇒ ดูเผินๆ "ขัดกัน" แต่ 20059854/30042570 อยู่ใต้ 20059853 อีกชั้น
   ⇒ ใบ FG แค่**บันทึกลึกกว่า 1 ขั้น** ไม่ใช่ขัดกัน
   depth 3 = พอสำหรับโครงจริง (ลึกสุดในฐาน 4 ชั้น) · กัน path ระเบิดด้วย `seen`                */
const reachableFrom = (mats, ix, depth = 3) => {
  const out = new Set();
  const seen = new Set();
  let frontier = mats.map(key).filter(Boolean);
  for (let d = 0; d < depth && frontier.length; d++) {
    const next = [];
    for (const m of frontier) {
      if (seen.has(m)) continue;
      seen.add(m);
      const own = ix.ownSheetOf(m);
      for (const k of (ix.bomOf(m, own ?? undefined) || [])) {
        const km = key(k?.mat_no);
        if (!km) continue;
        out.add(km);
        next.push(km);
      }
    }
    frontier = next;
  }
  return out;
};

/**
 * ไล่ทั้งฐานหา "คู่ที่ของชิ้นเดียวถูกนิยามไว้ 2 ใบ"
 *
 * @param {Array}  rows           แถว `bom_items` (ต้องมี product_id · mat_no · parent_mat)
 * @param {object} matOfProduct   product_id → mat_no (จาก `dr_products`)
 * @param {object} [opts]
 * @param {Function} [opts.isOpSheet]  (product_id) => true ถ้าใบนั้นเป็น "ขั้นงาน (OP)"
 * @param {Function} [opts.infoOfSheet] (product_id) => { mat, name } สำหรับโชว์ (ไม่ส่ง = เอาจาก matOfProduct)
 * @returns {{ pairs: Array, counts: object }}
 *
 * pairs[i] = {
 *   dupKey, sheetId, sheetMat, sheetName, mat, matName,
 *   ownSheet, kidsHere[], kidsOwn[], onlyHere[], onlyOwn[], same,
 *   missingFromExplode[],   // = onlyOwn → ตัวที่ "ไม่ถูกระเบิด" เพราะชุดของใบนี้ชนะ
 *   verdict, rank, fingerprint,
 * }
 */
export function auditBomDupes(rows = [], matOfProduct = {}, opts = {}) {
  const isOp = typeof opts.isOpSheet === 'function' ? opts.isOpSheet : () => false;
  const infoOf = typeof opts.infoOfSheet === 'function' ? opts.infoOfSheet : () => null;
  const ix = buildBomIndex(rows, matOfProduct);

  /* ① หา "ใบนี้จัดลูกของ mat ไว้เอง" — ต้องนับแบบเดียวกับ `bomOf` (parent_mat ในใบเดียวกัน) */
  const assigned = new Map();           // `${product_id}|${MAT}` → { sheetId, mat }
  for (const r of (rows || [])) {
    const pm = key(r?.parent_mat);
    const sid = r?.product_id;
    if (!pm || !sid) continue;
    const k = `${sid}|${pm}`;
    if (!assigned.has(k)) assigned.set(k, { sheetId: sid, mat: pm });
  }

  const pairs = [];
  for (const { sheetId, mat } of assigned.values()) {
    const ownSheet = ix.ownSheetOf(mat);
    if (!ownSheet || ownSheet === sheetId) continue;          // ไม่มีใบของตัวเอง / เป็นใบเดียวกัน
    const kidsHere = [...new Set((ix.bomOf(mat, sheetId) || []).map(k => key(k?.mat_no)).filter(Boolean))];
    const kidsOwn  = [...new Set((ix.bomOf(mat, ownSheet) || []).map(k => key(k?.mat_no)).filter(Boolean))];
    if (!kidsHere.length || !kidsOwn.length) continue;        // ใบเปล่า = ไม่ใช่ "นิยาม 2 ที่"

    const hereSet = new Set(kidsHere);
    const ownSet = new Set(kidsOwn);
    const onlyHere = kidsHere.filter(m => !ownSet.has(m));
    const onlyOwn  = kidsOwn.filter(m => !hereSet.has(m));
    const same = kidsHere.filter(m => ownSet.has(m)).length;

    /* 🔢 qty ของ "ตัวที่มีทั้ง 2 ใบ" — รวมแถวซ้ำในใบเดียวกันก่อน (2 แถวของ mat เดียว = ยอดรวม) */
    const qHere = qtyMapOf(ix.bomOf(mat, sheetId));
    const qOwn  = qtyMapOf(ix.bomOf(mat, ownSheet));
    const qtyDiff = kidsHere.filter(m => ownSet.has(m))
      .map(m => ({ mat: m, here: qHere.get(m) ?? 0, own: qOwn.get(m) ?? 0 }))
      .filter(d => !sameQty(d.here, d.own));

    let verdict;
    if (isOp(sheetId)) verdict = 'op';
    else if (!onlyHere.length && !onlyOwn.length) {
      /* รายการตรงกันหมด — ต่อไปดู qty: ตรง = identical · ต่างพอดี 2 เท่าทุกตัว = ชิ้น vs shot · อื่นๆ = ตัวเลขผิด */
      if (!qtyDiff.length) verdict = 'identical';
      else if (qtyDiff.every(d => isPairRatio(d.here, d.own))) verdict = 'pair_shot';
      else verdict = 'qty_diff';
    }
    else if (!onlyHere.length) verdict = 'subset';
    else if (!onlyOwn.length) verdict = 'extra';
    else {
      // ตัวที่ใบนั้นเกิน อยู่ใต้ตัวที่ใบนี้เกิน (ลึกกว่า 1 ขั้น) ครบทุกตัวไหม
      const reach = reachableFrom(onlyHere, ix);
      verdict = onlyOwn.every(m => reach.has(m)) ? 'deeper' : 'conflict';
    }

    const sInfo = infoOf(sheetId) || {};
    const oInfo = infoOf(ownSheet) || {};
    pairs.push({
      dupKey: dupKeyOf(sInfo.mat ?? matOfProduct[sheetId], mat),
      sheetId, sheetMat: norm(sInfo.mat ?? matOfProduct[sheetId]), sheetName: norm(sInfo.name),
      mat, matName: norm(oInfo.name),
      ownSheet, kidsHere, kidsOwn, onlyHere, onlyOwn, same,
      /* ตัวที่มีทั้ง 2 ใบ แต่ qty ไม่ตรง — โชว์เสมอ ไม่ว่า verdict จะเป็นอะไร (subset/conflict ก็มีได้) */
      qtyDiff,
      /* 🔴 ของที่หายจากการระเบิด = ตัวที่มีแต่ในใบของพาร์ทเอง (ชุดของใบนี้ชนะทั้งชุด)
         ใบขั้นงานไม่นับ — ใบ OP ไม่ได้พยายามเป็น BOM ของพาร์ท */
      missingFromExplode: verdict === 'op' ? [] : onlyOwn,
      verdict, rank: dupRank(verdict),
      /* 🔴 ลายนิ้วมือต้องรวม qty ด้วย (แก้ 14/10) — ไม่งั้นมีคนแก้แค่จำนวน
         คู่ที่ "ตรวจแล้ว" จะไม่กลับเข้าคิว = ตัวเลขเปลี่ยนแล้วไม่มีใครรู้
         ⚠️ สูตรเปลี่ยน ⇒ ผลตรวจเก่าทุกแถวจะขึ้น "ต้องตรวจซ้ำ" รอบเดียว (ตั้งใจ ปลอดภัยกว่าปล่อยผ่าน) */
      fingerprint: dupFingerprint(withQty(kidsHere, qHere), withQty(kidsOwn, qOwn)),
    });
  }

  pairs.sort((a, b) => a.rank - b.rank
    || a.sheetMat.localeCompare(b.sheetMat)
    || a.mat.localeCompare(b.mat));

  const counts = { total: pairs.length };
  for (const v of Object.keys(DUP_VERDICTS)) counts[v] = 0;
  for (const p of pairs) counts[p.verdict] = (counts[p.verdict] || 0) + 1;
  counts.missingMats = new Set(pairs.flatMap(p => p.missingFromExplode)).size;

  return { pairs, counts };
}

/* ── ผลตรวจที่คนบันทึกไว้ ────────────────────────────────────────────────────────────── */

/** ตัวเลือกตอนกด "ตรวจแล้ว" — 3 ทางที่ PE ใช้จริง (ไม่ใช่ทะเบียน: เป็นสถานะของ workflow) */
export const DUP_DECISIONS = [
  { value: 'ok_both', label: '✅ ถูกทั้ง 2 ใบ (ปล่อยไว้)', hint: 'คนละรุ่น/คนละมุมมอง — ไม่ต้องแก้' },
  { value: 'fixed',   label: '🔧 แก้ BOM แล้ว',           hint: 'แก้ใบใดใบหนึ่งเรียบร้อย' },
  { value: 'later',   label: '⏸ พักไว้ก่อน',              hint: 'ต้องถามคนอื่น / รอข้อมูล' },
];
export const decisionLabel = (v) => DUP_DECISIONS.find(d => d.value === v)?.label || v || '';

/**
 * ผูกผลตรวจที่คนบันทึกไว้เข้ากับคู่ที่ระบบเจอตอนนี้
 * 🔴 ลายนิ้วมือไม่ตรง = **ไม่ถือว่าเคลียร์แล้ว** (BOM ถูกแก้หลังตรวจ ⇒ ผลเก่าใช้ไม่ได้)
 *    แต่ยังบอกบนจอว่า "เคยตรวจไว้ว่าอะไร" เพื่อให้คนตัดสินเร็วขึ้น — ห้ามทิ้งเงียบ
 * @returns {Array} pairs เดิม + { review, cleared, staleReview }
 */
export function applyDupReviews(pairs = [], reviews = []) {
  const byKey = new Map();
  for (const r of (reviews || [])) {
    const k = dupKeyOf(r?.sheet_mat, r?.component_mat);
    if (k !== '|') byKey.set(k, r);
  }
  return (pairs || []).map(p => {
    const review = byKey.get(p.dupKey) || null;
    const fresh = !!review && norm(review.fingerprint) === p.fingerprint;
    return {
      ...p,
      review,
      cleared: fresh,                       // ตรวจแล้วและข้อมูลยังเหมือนเดิม
      staleReview: !!review && !fresh,      // เคยตรวจ แต่ BOM เปลี่ยนหลังจากนั้น
    };
  });
}

/** นับให้หัวจอ: เหลือเท่าไหร่ · เคลียร์แล้วเท่าไหร่ · ต้องตรวจซ้ำเท่าไหร่ */
export function dupProgress(pairs = []) {
  let cleared = 0, stale = 0, openHot = 0;
  for (const p of pairs) {
    if (p.cleared) { cleared++; continue; }
    if (p.staleReview) stale++;
    if (p.rank <= 4) openHot++;             // subset / qty_diff / conflict / pair_shot
  }
  return { total: pairs.length, cleared, stale, open: pairs.length - cleared, openHot };
}
