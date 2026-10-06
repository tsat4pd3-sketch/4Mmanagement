/* ═══ 🔄 Engineering Change — "เลขนี้ถูกแทนด้วย rev ไหนแล้ว" (pure · มีเทส) ═══════════
   user ถาม 2026-10-05: *"part master ไม่มีระบบ ecn หรอ … หรืออยู่ที่ product"*
   → **อยู่ที่แท็บ 3️⃣ Products** — `dr_products` มี `superseded_by` / `superseded_at` / `family_id`
     แต่ **ทะเบียนกลาง `parts_master` ไม่รู้เรื่องเลย** (วัดจริง 05/10: โน้ตที่พูดถึง EC = 0/370 แถว)
     ⇒ จอทะเบียนโชว์ rev เก่ากับ rev ใหม่เป็น "ใช้งาน" เท่ากัน คนหยิบผิดได้ง่าย
     (วัดจริง: เบอร์ลูกค้าที่มีหลาย revision = **23 กลุ่ม · 92 แถว · ยัง active 91**)

   🔴 **ของจริงอยู่ที่ `dr_products` ที่เดียว — ทะเบียนแค่ "อ่าน" ไม่เก็บซ้ำ**
      (ห้ามเพิ่มคอลัมน์ rev/superseded ใน `parts_master` แล้วมานั่ง sync กัน = ข้อมูล 2 ชุดที่จะขัดกันวันหนึ่ง)
   🔴 **ไม่รู้ = ไม่พูด** — mat ที่ไม่มีใน `dr_products` คืน `null` ห้ามเดาว่าเป็น rev ล่าสุด
   ═══════════════════════════════════════════════════════════════════════════════════ */

const key = (m) => String(m ?? '').trim().toUpperCase();

/**
 * สร้างดัชนี EC จากแถว `dr_products`
 * @param {Array} products ต้องมี { id, mat_no, name, superseded_by, superseded_at, family_id }
 * @returns {Map<string, {supersededByMat:string|null, supersededAt:string|null, latestMat:string|null,
 *                        replacesMat:string|null, isLatest:boolean, chainBroken:boolean}>}
 *   · `supersededByMat` = ถูกแทนด้วยเลขไหน (ตัวถัดไปตรงๆ) · `latestMat` = ปลายสายล่าสุด
 *   · `replacesMat` = เลขนี้ไปแทนเลขไหนมา · `isLatest` = ยังเป็นตัวปัจจุบันของตระกูล
 *   · `chainBroken` = สายวนลูป/ชี้ไปหาแถวที่ไม่มีเลข ⇒ จอต้องบอกว่าไล่ไม่สุด ห้ามเงียบ
 */
export function buildEcIndex(products) {
  const rows = (products || []).filter(p => p && key(p.mat_no));
  const byId = new Map(rows.map(p => [p.id, p]));
  const out = new Map();

  /* ชี้ไปข้างหน้า: เลขเดิม → เลขที่มาแทน */
  const nextOf = new Map();
  for (const p of rows) {
    if (!p.superseded_by) continue;
    const nx = byId.get(p.superseded_by);
    const nxMat = key(nx?.mat_no);
    /* แถวที่มาแทนไม่มีเลข MAT (เช่นชั้น OP ที่ใช้ชื่อขั้นเป็น mat_no) = ไล่ต่อไม่ได้ แต่ยังรู้ว่าถูกแทนแล้ว */
    nextOf.set(key(p.mat_no), { mat: nxMat || null, at: p.superseded_at || null });
  }

  for (const p of rows) {
    const k = key(p.mat_no);
    if (out.has(k)) continue;                       // mat ซ้ำหลายแถว = ใช้แถวแรก (ของจริงอยู่ที่ Products)
    const nx = nextOf.get(k) || null;

    /* ไล่ไปจนสุดสาย — กันวนลูปด้วย seen (ข้อมูลพลาดได้ ห้ามให้จอค้าง) */
    let latest = k, broken = false;
    const seen = new Set([k]);
    for (let hop = 0; hop < 20; hop++) {
      const step = nextOf.get(latest);
      if (!step) break;
      if (!step.mat) { broken = true; break; }      // ตัวที่มาแทนไม่มีเลข = ไล่ต่อไม่ได้
      if (seen.has(step.mat)) { broken = true; break; }
      seen.add(step.mat); latest = step.mat;
    }

    out.set(k, {
      supersededByMat: nx ? nx.mat : null,
      supersededAt: nx ? nx.at : null,
      latestMat: nx ? (broken ? null : latest) : k,
      replacesMat: null,                            // เติมรอบถัดไป
      isLatest: !nx,
      chainBroken: broken,
    });
  }

  /* ย้อนกลับ: เลขใหม่ไปแทนเลขไหนมา */
  for (const [oldMat, step] of nextOf) {
    if (!step.mat) continue;
    const e = out.get(step.mat);
    if (e && !e.replacesMat) e.replacesMat = oldMat;
  }
  return out;
}

/** ข้อมูล EC ของ mat เดียว — ไม่รู้จัก = `null` (ห้ามเดาว่า "ล่าสุด") */
export const ecOf = (ix, mat) => (ix instanceof Map ? ix.get(key(mat)) || null : null);

/** นับว่าทะเบียนมีกี่แถวที่ถูกแทนไปแล้ว — ใช้เขียนบนจอว่าซ่อนไปกี่รายการ */
export function countSuperseded(ix, mats) {
  let n = 0;
  for (const m of mats || []) if (ecOf(ix, m)?.supersededByMat) n++;
  return n;
}
