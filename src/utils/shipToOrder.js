/**
 * ลำดับแถวลูกค้าบน Shipping Time Chart — **ล็อกตายตัวตามทะเบียน ship-to** (24/10 · คำสั่ง user
 * *"ไม่อยากให้ลูกค้าสลับตำแหน่งในตาราง lock ไปเลย ใครจะแถวไหน"*)
 * เดิมเรียงตามลำดับที่ใบโผล่ในคิวรีของวันนั้น ⇒ แต่ละวัน AAT/FTM สลับกันขึ้นบนสุด หาแถวไม่เจอ
 * กติกา: `ship_to_plants.sort_order` น้อยก่อน → ไม่ได้ตั้ง/ไม่อยู่ในทะเบียน = ต่อท้าย เรียงตามชื่อ
 * ตั้งค่าที่ ⚙️ Ship-to Config (ช่อง "ลำดับในชาร์ต")
 *
 * @param {Array<{key:string, code:string|null}>} rows  แถวลูกค้าบนชาร์ต (key = ป้ายที่โชว์)
 * @param {Object<string,{sort_order?:number}>} shipToMap  code → แถวทะเบียน
 * @returns {string[]} key เรียงตามลำดับที่ต้องวาด
 */
export function orderShipToRows(rows, shipToMap = {}) {
  const rank = (code) => {
    const v = shipToMap?.[code]?.sort_order;
    return v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? Infinity : Number(v);
  };
  return [...(rows || [])]
    .sort((a, b) => {
      const ra = rank(a.code), rb = rank(b.code);
      if (ra !== rb) return ra < rb ? -1 : 1;
      if (!a.code !== !b.code) return a.code ? -1 : 1;     // ใบที่ไม่ระบุลูกค้า = ล่างสุดเสมอ
      return String(a.key).localeCompare(String(b.key), 'th', { numeric: true });
    })
    .map(r => r.key);
}
