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
