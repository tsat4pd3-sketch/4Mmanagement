/*
  เฉลี่ย OEE/A/P/Q ข้ามหลายกะ — ต้องถ่วงน้ำหนักตามตำรา ห้าม mean-of-percentages
  (กฎ CLAUDE.md "กฎเฉลี่ย OEE รวมหลายกะ" · 2026-08-02 · รวมศูนย์เป็น util 2026-08-05)

  น้ำหนักที่ถูกต้องต่อเมตริก:
    A, OEE → เวลารับภาระ  (wLoad = shift_min − planned DT)
    P      → เวลาเดินเครื่อง (wRun  = wLoad × A/100)
    Q      → จำนวนที่ผลิต   (wProd = ของดี + ของเสีย)

  เดิม mean ธรรมดาทำให้กะเล็ก (ผลิตครึ่งชั่วโมง) ถ่วงเท่ากะเต็มวัน และ mean-of-means รายวัน
  ทำให้วันที่ผลิตน้อยถ่วงเท่าวันที่ผลิตเยอะ — ตัวเลขเพี้ยนคนละชุดระหว่างหน้าจอ

  ⚠️ จอที่รวม OEE หลายกะ **ต้อง import จากที่นี่** ห้ามเขียน sum/n เอง
  (เคย drift มาแล้ว: FactoryMap/MorningMeeting/เด็คผู้บริหาร ใช้ mean ธรรมดาคนละเลขกับ /oee-analytics)
*/

// เฉลี่ยถ่วงน้ำหนัก — ไม่มีน้ำหนัก (ทุกตัว 0) ถอยไปเป็น mean ธรรมดา · ไม่มีค่า valid = null
export function wavg(items, valFn, wFn) {
  let ws = 0, vs = 0, plainN = 0, plainSum = 0;
  for (const it of items) {
    const v = valFn(it);
    if (v == null || isNaN(v)) continue;
    plainN++; plainSum += Number(v);
    const w = wFn ? Number(wFn(it)) || 0 : 1;
    if (w > 0) { ws += w; vs += Number(v) * w; }
  }
  if (ws > 0) return +(vs / ws).toFixed(1);
  return plainN ? +(plainSum / plainN).toFixed(1) : null;
}

// น้ำหนักมาตรฐาน — row ต้องมี shift_min, plannedMin (นาที DT ในแผน), calcA/oee_a, actual_qty/qty_ng
export const wLoad = it => Math.max(0, (Number(it.shift_min ?? it.shiftMin) || 0) - (Number(it.plannedMin) || 0));
export const wRun  = it => wLoad(it) * ((it.calcA != null ? it.calcA : (it.oee_a != null ? +it.oee_a : 100)) / 100);
export const wProd = it => (Number(it.totalQty != null ? it.totalQty : it.actual_qty) || 0) + (Number(it.ngQty != null ? it.ngQty : it.qty_ng) || 0);
