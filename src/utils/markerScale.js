/**
 * markerScale — สูตรขนาด marker บนผังไลน์ "ตัวเดียวทั้งระบบ" (WYSIWYG)
 * ทุกหน้า (LineSetup / Management / Dashboard / หน้าอื่นที่วาดผัง) ต้องเรียกตัวนี้
 * เพื่อให้ขนาด+พฤติกรรมป้ายตอน setup ตรงกับตอนแสดงผลจริงเป๊ะ — ห้ามตั้งสูตรเองในหน้า
 * (ดู docs/UI-CONVENTIONS.md §1)
 *
 * หลัก density-aware: ผังที่หมุดรอง (เครื่องจักร/WIP) อยู่ชิดกัน ให้ย่อ "วงกลม" ลงตามความแน่น
 * ส่วนป้ายชื่อคุมด้วยปุ่ม 🏷️ โชว์/ซ่อน ของหน้า (สองสถานะ default โชว์ — UI-CONVENTIONS §1)
 * และป้ายต้องกว้างขั้นต่ำพออ่านชื่อออกเสมอ (pillMaxW/subPillMaxW)
 *
 * ⚠️ 2026-08-24 — "ความแน่น" วัดจาก **ระยะห่างจริงบนผัง** ไม่ใช่ "จำนวนเครื่อง"
 *   เดิมแบ่งขั้นด้วยจำนวน (≤18 = 0.6× · 19-32 = 0.5× · >32 = 0.42×) ซึ่งพังจริง 2 ทาง
 *   (user ทัก: "ทำไมขนาดสัญลักษณ์ไม่เท่ากัน อันใหญ่มันเบียด")
 *     · เครื่องน้อยแต่กระจุกอยู่มุมเดียวของผัง (เช่นไลน์ลูกที่ยืมรูปผังของไลน์แม่มาใช้ ตัวเองใช้พื้นที่
 *       แค่เสี้ยวเดียว) → นับได้ 14 ตัว = ได้วงใหญ่สุด 0.6× แล้ว **ทับกันมั่ว**
 *     · เครื่องเยอะแต่กระจายเต็มผัง → โดนย่อเป็น 0.5× ทั้งที่มีที่ว่างเหลือ
 *   ⇒ ผังสองใบที่ "แน่นพอกัน" ได้ขนาดต่างกัน และกระโดดเป็นขั้นตรงเลข 18/19 แบบไม่มีเหตุผลให้คนเห็น
 *   ตอนนี้คิดจากระยะเพื่อนบ้านที่ใกล้ที่สุดจริง → ต่างกันเมื่อไหร่ "เห็นเหตุผล" (แน่น = เล็ก)
 *   **ต้องส่ง `points` + `mapHeight` มาด้วยถึงจะได้โหมดนี้** · ไม่ส่ง = ถอยไปสูตรนับจำนวนแบบเดิมเป๊ะ
 */

const SUB_MIN = 0.34;   // เล็กกว่านี้ไอคอน/ป้ายเริ่มอ่านไม่ออก (SUB*0.44 = ขนาดไอคอน)
const SUB_MAX = 0.6;    // เท่าค่าเดิมของผังโปร่ง — ผังที่วันนี้ดูดีอยู่แล้วต้องไม่เปลี่ยน

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** อ่านพิกัด % ของหมุด — รับได้ทั้ง pos_left/pos_top (DB), left/top (state ระหว่างลาก), x/y */
function pctOf(p) {
  const x = parseFloat(p?.pos_left ?? p?.left ?? p?.x);
  const y = parseFloat(p?.pos_top ?? p?.top ?? p?.y);
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
}

/**
 * ระยะถึง "เพื่อนบ้านที่ใกล้ที่สุด" ของหมุดแต่ละตัว (หน่วย px บนจอ) แล้วคืนค่าเปอร์เซ็นไทล์ต่ำ
 *
 * ใช้ p35 ไม่ใช่ค่ากลาง/ค่าต่ำสุด:
 *   · ค่าต่ำสุด → หมุด 2 ตัวที่ถูกวางทับกันเกือบสนิท (ข้อมูลพลาด) จะลากทั้งผังให้เล็กจนอ่านไม่ออก
 *   · ค่ากลาง → ครึ่งหนึ่งของหมุดยังทับกันอยู่
 * O(n²) แต่ n ระดับหลักสิบ (ผังหนาสุดในระบบ ~60 หมุด) — ไม่ต้อง optimize
 */
function crowdGapPx(points, rw, rh) {
  const pts = [];
  for (const p of points || []) {
    const c = pctOf(p);
    if (c) pts.push([(c[0] / 100) * rw, (c[1] / 100) * rh]);
  }
  if (pts.length < 2) return null;
  const nn = [];
  for (let i = 0; i < pts.length; i++) {
    let best = Infinity;
    for (let j = 0; j < pts.length; j++) {
      if (i === j) continue;
      const d = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]);
      if (d < best) best = d;
    }
    if (Number.isFinite(best)) nn.push(best);
  }
  if (!nn.length) return null;
  nn.sort((a, b) => a - b);
  return nn[Math.floor(nn.length * 0.35)];
}

/**
 * @param renderedMapWidth  ความกว้างจริงของ "รูปผัง" ที่ render (px) — ไม่ใช่ความกว้าง container
 * @param machineCount      จำนวนหมุดรอง (ใช้เมื่อไม่ได้ส่ง points — สูตรเดิม)
 * @param points            หมุดรองพร้อมพิกัด % (pos_left/pos_top) — ส่งมาแล้วจะคิดจากความแน่นจริง
 * @param mapHeight         ความสูงจริงของรูปผังที่ render (px) — จำเป็นคู่กับ points
 */
export function markerScale(renderedMapWidth, { machineCount = 0, points = null, mapHeight = 0 } = {}) {
  const w = renderedMapWidth || 800;
  // จุดคน/จุดงานหลัก
  const MK = Math.round(Math.max(34, Math.min(84, w * 0.055)));

  // หมุดรอง (เครื่องจักร/WIP)
  const gap = (points && mapHeight) ? crowdGapPx(points, w, mapHeight) : null;
  const subFactor = gap != null
    // เส้นผ่าศูนย์กลาง ≈ 0.75 × ระยะเพื่อนบ้าน → เหลือช่องว่างระหว่างวงจริงๆ
    // (0.9 = "เฉียดกันแต่ไม่ทับ" ซึ่งพอมีเงา/ขอบเรืองแสงแล้วยังดูติดกันเป็นก้อน — เคสที่ user ทัก
    //  วัดจากภาพจริง: ระยะเพื่อนบ้าน ~55px วง 46px = กินพื้นที่ 84% ของช่องว่าง)
    ? clamp((gap * 0.75) / MK, SUB_MIN, SUB_MAX)
    // fallback สูตรเดิม (caller ที่ยังไม่ส่งพิกัด) — พฤติกรรมเท่าเดิมทุกประการ
    : (machineCount > 32 ? 0.42 : machineCount > 18 ? 0.5 : SUB_MAX);
  const SUB = Math.round(MK * subFactor);

  // legacy: เคยใช้ซ่อนป้ายหมุดรองอัตโนมัติเมื่อผังแน่น — เลิกใช้แล้ว (ปุ่ม 🏷️ เหลือ โชว์/ซ่อน สองสถานะ
  // ตามคำสั่ง user 2026-07-11) คงคีย์ไว้กัน caller เก่าพัง แต่หน้าใหม่อย่านำไปใช้ซ่อนป้ายอัตโนมัติ
  const showSubPills = machineCount <= 18;

  return {
    MK,
    SUB,
    showSubPills,
    ring: Math.max(2, Math.round(MK * 0.06)),
    subRing: Math.max(2, Math.round(SUB * 0.08)),
    pillFont: Math.max(11, Math.round(MK * 0.24)),
    subPillFont: Math.max(11, Math.round(SUB * 0.3)),
    badgeFont: Math.max(11, Math.round(MK * 0.2)),
    // ความกว้างสูงสุดของป้ายชื่อ — ห้ามผูกกับขนาดวงกลมล้วนๆ: วงเล็ก (ผังแน่น) เคยทำป้ายแคบ
    // จนเหลือ "S…"/"0…" อ่านไม่ออก = มีป้ายไปก็ไร้ประโยชน์ · ขั้นต่ำต้องพออ่าน ~8-10 ตัวอักษร
    pillMaxW: Math.max(Math.round(MK * 1.8), 96),
    // ⚠️ ห้ามผูกความกว้างป้ายกับ gap เพื่อ "กันป้ายทับกัน" — เคยลองแล้วผังแน่นจะได้ป้าย ~10px
    // เหลือ "S…" อ่านไม่ออก = มีป้ายไปก็ไร้ประโยชน์ (เทส markerScale ข้อสุดท้ายล็อกไว้)
    // ป้ายทับกันบนผังที่แน่นจริง คุมด้วยปุ่ม 🏷️ โชว์/ซ่อน ของหน้า (คำสั่ง user 2026-07-11)
    subPillMaxW: Math.max(Math.round(SUB * 2), 88),
  };
}
