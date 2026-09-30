/* ── matLabel — "เลข MAT ตัวเดียวบนจอ อ่านไม่ออกว่าเป็นชิ้นงานอะไร"  (2026-09-24 · feedback หน้างาน) ──

   ที่มา (feedback 23/09 สองใบในวันเดียว คนละหน้าจอ แต่เป็นอาการเดียวกัน):
     • สุทธวีร์  — /daily-report "Production order ที่เปิดค้างไว้ มองเห็นแค่เลข Material number
                   ทำให้ยากต่อการดูว่าคือชิ้นงานอะไร อยากให้แสดง Part name / Part number"
     • ณัฐวุฒิ   — /daily-report "เรียกชิ้นส่วนจากสโตร์ อยากให้โชว์ Part No. เพิ่มจาก Mat.SAP"

   ทำไมต้องเป็นของกลาง ไม่ใช่ปะ 2 จุด:
   เลข MAT ถูกโชว์เปล่าๆ อยู่ **หลายสิบจุดทั้งระบบ** (ใบผลิต · เรียกของ · ของเสีย · downtime · คิวสโตร์)
   ถ้าแก้ทีละจุดจะได้ 3 รูปแบบใน 3 หน้า แล้วคนถัดไปก็ยังโชว์ MAT เปล่าอยู่ดี
   ⇒ วาดผ่าน `<MatLabel>` (src/components/MatLabel.jsx) ที่กินฟังก์ชันในไฟล์นี้ — **จุดเดียว**

   🔴 ทำไมไม่ backfill คอลัมน์ `prod_orders.part_name` แทน (วัดจริง 24/09 · ใบ 30 วันล่าสุด):
       6,484 ใบ — มี part_name แค่ **927 ใบ (14%)** · เติมจาก master ได้อีก 5,557 ใบ (86%)
       · 6,447 ใบ (99.4%) มี p_no ใน master อยู่แล้ว · มีแค่ 1 ใบที่ไม่มีแถว master เลย
     คอลัมน์บนแถว = **snapshot ตอนเปิดใบ** ถ้า backfill วันนี้ พรุ่งนี้ master เปลี่ยนชื่อ → ค้างเป็นชื่อเก่าเงียบๆ
     ⇒ อ่านสดจากทะเบียน (`useProducts` — cache ก้อนเดียวทั้งแอป 168 แถว) แล้วให้ค่าบนแถวชนะเมื่อมี

   ⚠️ ค่าบนแถวชนะ master เสมอ — ไม่ใช่เพราะใหม่กว่า แต่เพราะมันคือ "ตอนเปิดใบเรียกว่าอะไร"
      (กฎเดียวกับ production_lines: ชื่อของตัวเองชนะไลน์แม่) · ไม่มีค่าบนแถวค่อยตกไป master
*/

/** กุญแจเทียบ MAT — trim + uppercase (MAT ในระบบเป็นเลข SAP/รหัสตัวพิมพ์ใหญ่ ไม่มีตัวคั่น) */
export const matKey = (m) => String(m ?? '').trim().toUpperCase();

/* ── 🔴 "Part No. นำหน้า" ใช้ได้เฉพาะเมื่อค่านั้น **เป็นเลขพาร์ทจริง** (2026-09-30 · วัดจากทะเบียนจริง) ──

   วัด `parts_master.part_no` 346 แถว (100% กรอกไว้ครบ) แยกตามหมวดเลข MAT:
     1xx (FG/ส่งลูกค้า)  128 แถว → หน้าตาเป็นเลขพาร์ท 127 (99%)
     2xx (ชิ้นส่วน)        94 แถว → 93 (99%)
     3xx (ชิ้นส่วน)        63 แถว → 60 (95%)
     5xx (**วัตถุดิบ**)    61 แถว → **11 (18%)**   ← ตัวปัญหาทั้งหมดอยู่ที่นี่

   สาเหตุไม่ใช่ "กรอกผิด" — วัตถุดิบ 2 ช่องนี้**มีความหมายคนละแบบกับชิ้นส่วน**:
     ชิ้นส่วน 2xx/3xx : part_name = ชื่อชิ้นงาน      · part_no = เลขพาร์ทลูกค้า
     วัตถุดิบ 5xx    : part_name = **สเปคเหล็ก+ขนาด** (WSS-M1A367-A36 1.5X276XC)
                       · part_no = **"เอาไปทำอะไร"** (ข้อความยาว มีไทย)
   ของจริงที่วัดได้: mat 50026144 มี part_no ยาว 72 ตัว
     "R_BMPR SUPPORT BRKT LH/RH (N1WB-17E850-R_PIA-07/08)1 : 2 Co(1FGใช้2ชิ้น)"
   ⇒ ถ้าเอา part_no ขึ้นหัวการ์ดแบบเหมา การ์ดวัตถุดิบจะพาดหัวด้วยประโยค 72 ตัวอักษร

   🔴 กฎ: **หน้าตาไม่ใช่เลขพาร์ท = ไม่ขึ้นหัว แต่ห้ามทิ้ง** — ตกไปเป็นบรรทัดรอง (คนสโตร์ใช้หาว่า
   เหล็กม้วนนี้ของงานอะไร) แล้วให้ชื่อ (สเปคเหล็ก) ขึ้นหัวแทน · **ห้ามซ่อม/ตัดค่าที่คนกรอกให้สั้นลงเอง**
   (กฎเดียวกับ shiftWindow: คงค่าที่คนกรอกไว้ แล้วให้จอปรับตัว ไม่ใช่ดัดข้อมูล)
   · เกณฑ์ตั้งหลวมโดยเจตนา (≤30 ตัว · ไม่มีอักษรไทย · อักขระที่เลขพาร์ทใช้ได้เท่านั้น) —
     ตัดสินแค่ "ขึ้นหัวได้ไหม" ไม่ใช่ validation ตอนกรอก ห้ามเอาไปบล็อกการบันทึก
*/
const THAI_RE = /[\u0E00-\u0E7F]/;
const PARTNO_RE = /^[A-Za-z0-9][A-Za-z0-9 ._/()#-]*$/;

/**
 * ค่านี้ "หน้าตาเป็นเลขพาร์ท" พอที่จะขึ้นหัวการ์ดไหม
 * @param {string} v
 * @returns {boolean} false = เป็นคำบรรยาย/สเปค → ให้ชื่องานขึ้นหัวแทน (แต่ยังโชว์ค่านี้เป็นบรรทัดรอง)
 */
export function looksLikePartNo(v) {
  const s = String(v ?? '').trim();
  if (s.length < 3 || s.length > 30) return false;
  if (THAI_RE.test(s)) return false;
  return PARTNO_RE.test(s);
}

/**
 * index จากทะเบียนสินค้า (`dr_products` ผ่าน useProducts) → Map<matKey, {name, p_no, customer}>
 *
 * ⚠️ mat_no ซ้ำได้ในทะเบียน (แถว OP / แถวเลิกใช้) — **แถว is_active ชนะ** แล้วค่อย first-win
 *    ไม่กรอง is_operation ทิ้งเหมือน buildPnIndex เพราะที่นี่ค้นด้วย mat_no (คีย์ของแถวนั้นเอง)
 *    ไม่ใช่ค้นด้วย p_no ที่ OP ไปใช้เลขซ้ำกับพาร์ทจริง ⇒ ไม่มีปัญหาผู้สมัครปลอม
 */
export function buildMatIndex(products, childParts) {
  const idx = new Map();
  for (const p of products || []) {
    const k = matKey(p?.mat_no);
    if (!k) continue;
    const prev = idx.get(k);
    if (prev && !(p?.is_active && !prev._active)) continue;   // แถวเดิมดีกว่าหรือเท่ากัน → คงไว้
    idx.set(k, {
      name: String(p?.name || '').trim(),
      p_no: String(p?.p_no || '').trim(),
      customer: String(p?.customer || '').trim(),
      _active: !!p?.is_active,
    });
  }
  /* 🔴 พาร์ทลูก (2xx/3xx/5xx) อยู่คนละทะเบียน — `parts_master` (DR) ไม่ใช่ `dr_products` (2026-09-30)
     เดิม index สร้างจาก `dr_products` อย่างเดียว ⇒ **ทั้งโมดูลสโตร์ไม่เคยโชว์ Part No. ได้เลย**
     ไม่ว่าจะเรียงลำดับยังไง เพราะของที่สโตร์จับคือพาร์ทลูกทั้งหมด
     (นี่คือสาเหตุจริงของ "ทำไมการ์ดสโตร์ไม่มี Part No." ไม่ใช่เรื่องลำดับการโชว์)
     · คอลัมน์คนละชื่อ: `parts_master.part_name`/`part_no` vs `dr_products.name`/`p_no` — select ผิด = 42703 เงียบ
     · `dr_products` ชนะเสมอเมื่อ mat ซ้ำ (เป็นทะเบียนสินค้าหลักที่ PE/NPI ดูแล) — ตัวนี้เติมเฉพาะที่ขาด */
  for (const c of childParts || []) {
    const k = matKey(c?.mat_no);
    if (!k || idx.has(k)) continue;
    idx.set(k, {
      name: String(c?.part_name || '').trim(),
      p_no: String(c?.part_no || '').trim(),
      customer: '',
      _active: true,
    });
  }
  return idx;
}

/**
 * รวมค่าที่จะโชว์ข้างเลข MAT
 * @param {string} mat      เลข MAT ที่จะโชว์
 * @param {Map}    index    ผลจาก buildMatIndex (ว่าง/undefined ได้ — ยังโหลดไม่เสร็จ)
 * @param {{name?:string, pNo?:string}} row  ค่าที่ "แถวนั้นเก็บไว้เอง" (เช่น prod_orders.part_name)
 * @returns {{mat:string, name:string, pNo:string, from:'row'|'master'|'mixed'|null}}
 *          from = ชื่อมาจากไหน (ไว้ให้จอ/เทสตรวจได้ว่าไม่ได้เดา) · null = ไม่รู้จัก MAT นี้
 */
export function matInfo(mat, index, row) {
  const m = String(mat ?? '').trim();
  const rowName = String(row?.name || '').trim();
  const rowPno = String(row?.pNo || '').trim();
  const hit = index?.get?.(matKey(m)) || null;

  const name = rowName || hit?.name || '';
  const pNo = rowPno || hit?.p_no || '';
  if (!name && !pNo) return { mat: m, name: '', pNo: '', pNoIsCode: false, lead: 'mat', from: null };

  const nameFrom = rowName ? 'row' : name ? 'master' : null;
  const pnoFrom = rowPno ? 'row' : pNo ? 'master' : null;
  const froms = [nameFrom, pnoFrom].filter(Boolean);
  /* pNoIsCode = เอา Part No. ขึ้นหัวได้ไหม · lead = ใครขึ้นหัวจริง (จอต้องอ่านค่านี้ ห้ามเดาเอง) */
  const pNoIsCode = looksLikePartNo(pNo);
  return {
    mat: m, name, pNo, pNoIsCode,
    lead: pNoIsCode && pNo ? 'pno' : name ? 'name' : 'mat',
    from: froms.every(f => f === froms[0]) ? froms[0] : 'mixed',
  };
}

/**
 * บรรทัดเดียวสำหรับที่ที่วาด JSX ไม่ได้ (toast · confirm · title · export Excel/PDF)
 * 🔴 **ลำดับต้องตรงกับที่ `<MatLabel>`/`<PartCard>` วาดเสมอ** (คำสั่ง user 2026-09-30
 *    "เอาให้ฟอร์แมทเดียวกัน") = Part No. → Part Name → MAT SAP
 *    `MB3B 8C306 BC · BRACKET RR · MAT 10100379`
 *    ไม่มี Part No. → ขึ้นต้นด้วยชื่อ แล้วต่อด้วย MAT (ไม่เว้นช่องว่างค้างไว้)
 *    🔴 Part No. ที่หน้าตาไม่ใช่เลขพาร์ท (วัตถุดิบ 5xx) สลับไปอยู่หลังชื่อ **ไม่ถูกตัดทิ้ง**
 */
export function matText(mat, index, row) {
  const i = matInfo(mat, index, row);
  const head = i.lead === 'pno' ? [i.pNo, i.name] : [i.name, i.pNo];   // ดู looksLikePartNo
  return [...head, i.mat && `MAT ${i.mat}`].filter(Boolean).join(' · ');
}
