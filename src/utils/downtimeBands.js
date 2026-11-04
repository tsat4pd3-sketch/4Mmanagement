/* ══ ⛔ แถบ "เครื่องหยุด" บนบอร์ด Heijunka — เรขาคณิต (pure · มีเทส) ══════════════════
 *
 * ที่มา (2026-11-04 · feedback หน้างาน ผ่าน user):
 *   *"ปริ้น Tag มายิงประมาณพันกว่า แต่พอมาปิดแท็ก มันเรียงไม่ต่อเนื่องกันที่โชว์ขึ้นในรูป"*
 *   user: *"ต่อให้รับยอดมาจากการยกยอด มันก็ต้องเรียงต่อกันได้ดิ"*
 *
 * 🔍 สิ่งที่วัดได้จริง (Assy GOR กะเช้า 03/11): ใบ **เรียงชิดกันอยู่แล้ว** ภายในแต่ละก้อนที่สแกนปิด
 *   ช่องว่างที่หน้างานเห็น = **เวลาที่เครื่องหยุดจริง ซึ่งหน้างานลงใบไว้เอง 180 นาที/กะ**
 *     08:00-08:30 เปลี่ยนหัว Tip · 08:40-09:30 ทิชโรบอท · 09:34-10:00 Prox ไม่จับชิ้นงาน
 *     13:42-14:00 Alarm Clamp 3 · 14:00-14:46 Senser ไม่จับชิ้นงาน
 *   (ตรงกับ %A 82% ของกะนั้นเป๊ะ) — **ไม่ใช่โปรแกรมไม่ sequence ให้**
 *
 * 🔴 แล้วทำไมหน้างานอ่านไม่ออก: บอร์ดวาด downtime เป็น **ขีดสูง 4-5 px ชิดขอบบนแถว**
 *   (ตั้งใจ "ไม่บังใบกัมบัง") ⇒ บนจอ TV/ในรูปถ่าย มองไม่เห็น ช่องว่างจึงอ่านเป็น "รูโหว่"
 *   ⇒ ไฟล์นี้ทำให้แถบเต็มความสูงแถว **แต่อยู่ใต้ใบกัมบัง** (zIndex ต่ำกว่า) ⇒ แถวอ่านต่อเนื่อง:
 *     งาน → ⛔ เหตุที่หยุด → งาน  โดย **ไม่ขยับใบไหน ไม่เปลี่ยนตัวเลขไหน**
 *
 * 🔴 กติกาที่ห้ามถอด:
 *   ① **ไม่รู้เวลาเริ่ม = ข้ามใบนั้น** ห้ามเดาจาก `duration_min` ลอยๆ (วางผิดที่ = โทษผิดช่วง)
 *   ② **ความกว้างขั้นต่ำ** — ใบ 1-2 นาทีต้องยังเห็น (ไม่งั้น micro-stop หายจากจอเงียบ)
 *   ③ `rowLines` ว่าง = **แสดงทุกรายการ** (แถวที่ไม่มีใบงานเลย เห็นครบดีกว่าหายเงียบ) ·
 *      มีไลน์ = กรองเฉพาะ sub-line ของแถวนั้น (ไม่งั้นเหตุของไลน์ข้างๆ มาโผล่เป็นเหตุของแถวนี้)
 *   ④ **ห้ามคืน zIndex/สี/ฟอนต์จากที่นี่** — หน้าตาอยู่ที่ `components/DowntimeBand.jsx` ที่เดียว
 *
 * 📄 docs/UI-CONVENTIONS.md §6.31 · docs/modules/daily-report.md §ช่องว่างบนบอร์ด Heijunka
 * ══════════════════════════════════════════════════════════════════════════════════════ */

const HALF_MS = 12 * 3600000;

/** ความกว้างขั้นต่ำของแถบ (% ของครึ่งวัน) ≈ 2.9 นาที — ต่ำกว่านี้ตามองไม่เห็น (กติกา ②) */
export const DT_BAND_MIN_PCT = 0.4;

/**
 * แปลงช่วง downtime เป็นพิกัด % บนแถบครึ่งวันของบอร์ด
 *
 * @param {Array}  windows      `[{ s, e, line_name, name, min, desc, machine, planned }]` (ตัวเดียวกับ `dtWindows` ในหน้า)
 * @param {Object} opt
 * @param {Set|Array|null} opt.rowLines  ไลน์ที่แถวนี้มีใบงานอยู่ · ว่าง/null = ไม่กรอง (กติกา ③)
 * @param {number} opt.halfStartMs       เวลาเริ่มของครึ่งวันที่กำลังวาด
 * @param {number} opt.pctPerMs          100 / ความยาวครึ่งวัน (ms)
 * @returns {Array<{ w:Object, leftPct:number, widthPct:number }>} เรียงตามเวลาเริ่ม
 */
export function downtimeBandsIn(windows = [], { rowLines = null, halfStartMs, pctPerMs, halfMs = HALF_MS } = {}) {
  if (!Array.isArray(windows) || !Number.isFinite(halfStartMs) || !Number.isFinite(pctPerMs) || pctPerMs <= 0) return [];
  const set = rowLines instanceof Set ? rowLines : (Array.isArray(rowLines) ? new Set(rowLines.filter(Boolean)) : null);
  const halfEndMs = halfStartMs + halfMs;
  const out = [];
  for (const w of windows) {
    /* ① ไม่รู้เวลาเริ่ม/จบ = ข้าม (ห้ามเดา) */
    if (!w || !Number.isFinite(w.s) || !Number.isFinite(w.e) || w.e <= w.s) continue;
    /* ③ กรองรายไลน์เฉพาะเมื่อแถวนี้บอกได้ว่ามีใบของไลน์ไหน */
    if (set && set.size && w.line_name && !set.has(w.line_name)) continue;
    if (w.e <= halfStartMs || w.s >= halfEndMs) continue;         // อยู่นอกครึ่งวันนี้
    const leftPct = Math.max(0, (w.s - halfStartMs) * pctPerMs);
    const rightPct = Math.min(100, (w.e - halfStartMs) * pctPerMs);
    if (leftPct >= 100 || rightPct <= 0) continue;
    /* ② กว้างขั้นต่ำ แต่ห้ามล้นขอบขวา */
    const widthPct = Math.min(100 - leftPct, Math.max(rightPct - leftPct, DT_BAND_MIN_PCT));
    if (widthPct <= 0) continue;
    out.push({ w, leftPct, widthPct });
  }
  return out.sort((a, b) => a.w.s - b.w.s);
}

/** นาทีรวมของ downtime ที่แถบวาดอยู่ (ใช้เขียนสรุปบนจอ — "ช่องว่าง = เครื่องหยุด N นาที") */
export function downtimeBandMinutes(bands = []) {
  return (bands || []).reduce((a, b) => a + (Number(b?.w?.min) || Math.round(((b?.w?.e ?? 0) - (b?.w?.s ?? 0)) / 60000)), 0);
}
