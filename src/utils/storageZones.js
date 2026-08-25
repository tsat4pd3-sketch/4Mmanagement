/**
 * 🏬 storageZones — สูตรกลางของ "โซนจัดเก็บในคลัง" (WMS เฟส 1 · 2026-08-25)
 *
 * โซน = พื้นที่บนผังรวมที่ไม่ใช่ไลน์ผลิต (ตาราง storage_zones ฝั่ง DR)
 * ยอดของโซน = สต็อกของ MAT ที่ผูกไว้ อ่านจาก line_stock_summary เฉพาะ "คลังกลาง"
 * (FG WAREHOUSE / STORE) — mini-store หน้าไลน์ไม่ใช่พื้นที่คลัง ไม่นับ
 *
 * ⚠️ กฎซื่อตรงของตัวเลข (หลักเดียวกับ OEE "ประเมินไม่ได้ = null ห้ามเป็น 0"):
 *   - MAT ไม่รู้ขนาดกล่อง (pkg) → pkgs = null (ไม่ใช่ 0) และ fill% ของโซน = null "ไม่รู้"
 *   - โซนไม่กรอก capacity → fill% = null — จอต้องเขียน "ยังไม่กรอกความจุ" ห้ามโชว์ 0%
 *   - min/max ที่ไม่ได้ตั้ง (null) ≠ 0 — Number(null) === 0 คือกับดักเดิม (Rank อะไหล่/lineFlow)
 *
 * ไฟล์นี้ pure ล้วน (ไม่ import supabase) — เทสได้ตรงๆ ใน node:test
 * ห้ามเขียนสูตรเต็ม/ขาด/นับกล่อง ซ้ำในหน้าใดๆ — FactoryMap + StorageZonePanel อ่านตัวนี้
 */

/* ชนิดโซน — key เก็บใน storage_zones.kind (DB ไม่มี check constraint — เพิ่มที่นี่ที่เดียว) */
export const ZONE_KINDS = [
  { key: 'fg',    label: 'FG พร้อมส่ง',          icon: '📦' },
  { key: 'wip',   label: 'WIP / กึ่งสำเร็จ',      icon: '🔩' },
  { key: 'sub',   label: 'พาร์ทย่อย (Store)',     icon: '🧰' },
  { key: 'raw',   label: 'วัตถุดิบ',              icon: '🧱' },
  { key: 'out',   label: 'เลนรอส่งออก (OUT)',     icon: '🚚' },
  { key: 'other', label: 'อื่นๆ',                 icon: '🏬' },
];
// key ที่โค้ดไม่รู้จัก = โชว์ key ดิบ ไม่หายเงียบ
export const zoneKindMeta = (k) =>
  ZONE_KINDS.find(z => z.key === k) || { key: k || 'other', label: k || 'อื่นๆ', icon: '🏬' };

/* location ใน line_stock_summary ที่นับเป็น "คลังกลาง" */
export const WAREHOUSE_LOCATIONS = ['FG WAREHOUSE', 'STORE'];

const num = (v) => (v == null || v === '' ? null : Number(v)); // null = ไม่รู้ (ห้ามให้ Number(null)=0 หลอก)

/**
 * คำนวณความเต็ม/ขาดของโซน
 * @param {{capacity_pkg?:number, mat_nos?:string[]}} zone
 * @param {Record<string, number>} stockByMat   mat_no → qty รวมในคลังกลาง
 * @param {(mat:string)=>number|null} pkgOf     ขนาดกล่อง (qty_per_pkg ‖ qty_per_kanban) — ไม่รู้ = null
 * @param {(mat:string)=>{min_qty?:any,max_qty?:any}|null} stdOf  kanban_standards ของ mat
 */
export function zoneFill(zone, stockByMat = {}, pkgOf = () => null, stdOf = () => null) {
  const mats = (zone?.mat_nos || []).map(m => {
    const qty = Number(stockByMat[m]) || 0;         // ไม่มีแถวสต็อก = 0 จริง (ledger ครบ) ต่างจาก pkg/min ที่ null=ไม่รู้
    const pkg = num(pkgOf(m));
    const std = stdOf(m) || {};
    const min = num(std.min_qty);
    const max = num(std.max_qty);
    return {
      mat_no: m, qty,
      pkgs: pkg > 0 ? Math.ceil(qty / pkg) : null,  // ไม่รู้ขนาดกล่อง = null ห้ามเดา
      min, max,
      short: min != null && min > 0 && qty < min,
      over: max != null && max > 0 && qty > max,
    };
  });
  const totQty = mats.reduce((a, x) => a + x.qty, 0);
  const unknownPkg = mats.filter(x => x.qty > 0 && x.pkgs == null).length;
  const totPkgs = mats.reduce((a, x) => a + (x.pkgs || 0), 0);
  const cap = Number(zone?.capacity_pkg) || 0;
  // fill% ต้องรู้ทั้ง capacity และขนาดกล่องของทุก MAT ที่มีของ — ไม่ครบ = null ("ไม่รู้" ≠ 0%)
  const fillPct = cap > 0 && unknownPkg === 0 ? Math.round((totPkgs / cap) * 100) : null;
  return {
    mats, totQty, totPkgs, unknownPkg, fillPct,
    shortCount: mats.filter(x => x.short).length,
    overMaxCount: mats.filter(x => x.over).length,
  };
}

/**
 * สถานะโซนบนผัง (map เข้า CAT ของ FactoryMap)
 * แดงนิ่ง (bad) = มี MAT ต่ำกว่า Min หรือของล้นความจุ — งานคลังไม่ใช่ alarm เครื่องหยุด ห้ามกระพริบ
 * เหลือง (ok)  = ใกล้เต็ม ≥85% หรือมี MAT เกิน Max · เขียว (good) = ปกติ · เทา (idle) = ยังไม่ผูก MAT
 */
export function zoneHealth(f) {
  if (!f || !f.mats.length) return 'idle';
  if (f.shortCount) return 'bad';
  if (f.fillPct != null && f.fillPct >= 100) return 'bad';
  if ((f.fillPct != null && f.fillPct >= 85) || f.overMaxCount) return 'ok';
  return 'good';
}

export function zoneHealthText(f) {
  if (!f || !f.mats.length) return '🏬 ยังไม่ผูก MAT';
  if (f.shortCount) return `🟥 ต่ำกว่า Min ${f.shortCount} รายการ`;
  if (f.fillPct != null && f.fillPct >= 100) return `⚠ ล้นความจุ ${f.fillPct}%`;
  const boxes = f.unknownPkg ? `${f.totPkgs}+? กล่อง` : `${f.totPkgs} กล่อง`;
  if (f.fillPct != null) return `${boxes} · ${f.fillPct}%${f.fillPct >= 85 ? ' ใกล้เต็ม' : ''}`;
  if (f.overMaxCount) return `${boxes} · เกิน Max ${f.overMaxCount} รายการ`;
  return boxes;
}
