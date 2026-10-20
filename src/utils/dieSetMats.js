/* 🔨 "ชุดแม่พิมพ์นี้ทำพาร์ทอะไรบ้าง" — ของกลางจุดเดียว (2026-10-14 · คำสั่ง user)
   *"แม่พิมพ์ปั๊มออกคู่ ซ้ายขวา ก็ควรเลือก mat สองตัวนะ"*

   gang die ปั๊มทีเดียวได้ RH + LH ⇒ ชุดหนึ่งผูกได้ถึง 2 MAT (`mat_no` + `mat_no_2`)
   🔴 **ห้ามเขียน `d.mat_no === mat` เองในหน้าอีก** (มีด่าน) — เดิมทั้งระบบเทียบแค่ช่องแรก
      ⇒ ล็อตฝั่งที่ไม่ได้ลงทะเบียนเป็นช่องแรก **หาแม่พิมพ์ไม่เจอเลย** (ProdLotPlanner → ไม่รู้ความสูง
        = คิดเวลาเปลี่ยนรุ่นไม่ได้ · DieLayout → ชุดนั้นไม่รู้ว่าอยู่ไลน์ไหน)

   ⚠️ คนละเรื่องกับ `dr_products.pair_mat_no`:
     · `pair_mat_no`  = "พาร์ทนี้คู่กับพาร์ทไหน"  → เจ้าของคือ Product Master · ใช้ยุบ shot ใน OEE
     · `mat_no/_2`    = "แม่พิมพ์ชุดนี้ทำพาร์ทอะไร" → เจ้าของคือทะเบียนแม่พิมพ์
   2 ชุดนี้ควรสอดคล้องกัน แต่ไม่ใช่ตัวเดียวกัน (gang die ทำ 2 พาร์ทที่ไม่ใช่คู่ RH/LH ก็มีได้)
   ⇒ ไม่ตรงกัน = **เขียนเตือนบนจอ ห้ามเขียนทับให้เอง** (ใครคู่กับใคร = Product Master ตัดสิน) */

const norm = (v) => String(v ?? '').trim().toUpperCase();

/** MAT ทั้งหมดที่ชุดนี้ทำ — เรียงตามช่อง · ตัดค่าว่าง/ซ้ำออก · ไม่มีเลย = [] */
export function dieSetMats(set) {
  const out = [];
  for (const v of [set?.mat_no, set?.mat_no_2]) {
    const m = norm(v);
    if (m && !out.includes(m)) out.push(m);
  }
  return out;
}

/** ชุดนี้ทำพาร์ทตัวนี้ไหม — ใช้แทน `d.mat_no === mat` ทุกที่ · ไม่ระบุ mat = ถือว่าใช่ (ไม่กรอง) */
export function dieMakesMat(set, mat) {
  const m = norm(mat);
  if (!m) return true;
  return dieSetMats(set).includes(m);
}

/** ตรวจความสอดคล้องกับคู่ที่ Product Master ตั้งไว้ — คืนสถานะให้จอเขียนบอก **ไม่แก้ข้อมูลให้**
    @param pairOf (mat) => pair_mat_no ของพาร์ทนั้น (null = ยังไม่ตั้งคู่)
    - `single`   ชุดนี้ลง MAT ตัวเดียว → ไม่มีอะไรให้ตรวจ
    - `ok`       2 ตัวที่ลงไว้ = คู่กันตาม Product Master
    - `unset`    Product Master ยังไม่ได้ตั้งคู่ให้ (OEE จะยังนับ shot ซ้ำ ⇒ ต้องไปตั้ง)
    - `mismatch` Product Master บอกว่าคู่ของมันเป็นอีกตัว — คนต้องตัดสิน ห้ามระบบเลือกข้าง */
export function dieSetPairState(set, pairOf) {
  const mats = dieSetMats(set);
  if (mats.length < 2) return { state: 'single', mats };
  const [a, b] = mats;
  const pa = norm(typeof pairOf === 'function' ? pairOf(a) : null);
  const pb = norm(typeof pairOf === 'function' ? pairOf(b) : null);
  if (!pa && !pb) return { state: 'unset', mats };
  if ((pa && pa !== b) || (pb && pb !== a)) return { state: 'mismatch', mats, says: pa || pb };
  return { state: 'ok', mats };
}

/** ชุดที่ลง MAT ไว้ 2 ตัว = ปั๊มทีเดียวได้อย่างน้อย 2 ชิ้น ⇒ เสนอค่า "ชิ้น/จังหวะ" ให้คนกดยืนยัน
    🔴 **คืนค่าไว้ "เสนอ" เท่านั้น ห้ามเขียนลงฐานเอง** — บางชุดปั๊มทีเดียวได้ 4 (2-out ของทั้งคู่)
       ระบบไม่มีทางรู้ · เดาแล้วเขียน = เกณฑ์ PM เพี้ยนเงียบ (ดู ppsOf ใน pmUsage.js) */
export function suggestPps(set) {
  const n = dieSetMats(set).length;
  return n >= 2 ? n : null;
}

/** 🔎 หลักฐานใน "ชื่อ/เลขพาร์ท" ที่บอกใบ้ว่าชุดนี้น่าจะเป็นงานคู่ — **ท่าสุดท้าย ใช้ชี้เป้าให้คนไปกรอกเท่านั้น**

    🔴 **ห้ามเอาผลนี้เขียนลงฐาน ห้ามเอาไปคิด shot** (กฎเดียวกับ §เดาหมวดจากคำ ใน CLAUDE.md)
       — "ชุดนี้ทำ 2 พาร์ท" ≠ "1 จังหวะได้ 2 ชิ้น" · tandem 24 OP ตอกทีละตัว ก็ชื่อ RH/LH เหมือนกัน
       คนที่ยืนหน้าเครื่องเท่านั้นที่ตอบได้ ⇒ จอมีหน้าที่บอกว่า "น่าสงสัย เพราะอะไร" แล้วให้เขากดยืนยัน
    คืน null = ไม่มีหลักฐาน (ไม่ได้แปลว่าไม่ใช่งานคู่) */
export function pairHint(set) {
  const why = [];
  const pn = String(set?.part_no ?? '');
  const nm = String(set?.part_name ?? '').toUpperCase();
  if (/[^/\s]\/[^/\s]/.test(pn)) why.push('เลขพาร์ทมี 2 ตัวคั่น /');
  if (/(RH|LH)[^A-Z]{0,6}(RH|LH)/.test(nm)) why.push('ชื่อเอ่ยทั้ง RH และ LH');
  return why.length ? { why: why.join(' + ') } : null;
}

/** ชุดแม่พิมพ์ที่ "ช่องเลือกแม่พิมพ์ของล็อต MAT นี้" ควรยื่นให้ — **2 กอง ห้ามยุบรวม**
      · `linked`   ทะเบียนบอกไว้แล้วว่าชุดนี้ทำพาร์ทนี้ (คนกรอก = ความจริง) → ระบบยืนยันได้
      · `unlinked` ยังไม่ผูก MAT เลยสักช่อง = **"ยังไม่รู้" ไม่ใช่ "ไม่ใช่"** → ต้องให้คนเลือกได้

    🔴 ชุดที่ผูก MAT อื่นไว้แล้ว = **ตัดออก** (เสนอผิดแย่กว่าไม่เสนอ — ความสูงผิด = เวลาเปลี่ยนรุ่นผิด)
    🔴 ไม่ระบุ mat = คืนทุกชุดเป็น `linked` (เท่า `dieMakesMat(set, null)` — ไม่กรอง)

    ทำไมต้องมีกอง `unlinked`: วัด 19/10 — `die_sets.mat_no` กรอกไว้ **1 จาก 92 ชุด**
    ⇒ ลิสต์ที่ยื่นแต่ `linked` จะว่างเปล่าแทบทุกพาร์ท **คนที่รู้ว่าใช้ชุดไหนก็เลือกไม่ได้** = ทางตัน
    (บทเรียนเดียวกับโมดัลตั้ง min/max ที่เปิดมาเจอลิสต์ว่าง · `demand-flow-tower.md`)
    ⇒ ยื่นให้เลือก + ป้ายบอกว่าระบบไม่ได้ยืนยัน แล้วให้ "การเลือกของคน" กลายเป็นตัวผูกทะเบียน */
export function dieSetsForMat(sets, mat) {
  const m = norm(mat);
  const linked = [], unlinked = [];
  for (const s of sets || []) {
    if (!m) { linked.push(s); continue; }
    const mats = dieSetMats(s);
    if (mats.includes(m)) linked.push(s);
    else if (!mats.length) unlinked.push(s);   // ว่างทั้ง 2 ช่อง = ยังไม่มีใครผูก (ไม่ใช่ "ไม่ใช่ตัวนี้")
  }
  return { linked, unlinked };
}

/** ช่องที่ควรเขียน MAT ลงไปเมื่อคนยืนยันว่า "ชุดนี้ทำพาร์ทนี้" — คืน `null` = เขียนไม่ได้/ไม่ต้องเขียน
    🔴 **ห้ามทับค่าที่คนกรอกไว้** — เต็มทั้ง 2 ช่องแล้ว = คืน null ให้จอบอกให้ไปแก้ที่ทะเบียนเอง
       (ชุดที่ปั๊มได้เกิน 2 พาร์ทมีจริง แต่ทะเบียนมี 2 ช่อง ⇒ ตัวที่ 3 เป็นการตัดสินใจของคน) */
export function matSlotFor(set, mat) {
  const m = norm(mat);
  if (!m) return null;
  const mats = dieSetMats(set);
  if (mats.includes(m)) return null;           // ผูกอยู่แล้ว ไม่ต้องเขียนซ้ำ
  if (!norm(set?.mat_no)) return 'mat_no';
  if (!norm(set?.mat_no_2)) return 'mat_no_2';
  return null;                                  // เต็มแล้ว — คนตัดสินที่ /equipment?tab=die
}
