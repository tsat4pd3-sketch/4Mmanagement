/**
 * markerScale — สูตรขนาด marker บนผังไลน์ "ตัวเดียวทั้งระบบ" (WYSIWYG)
 * ทุกหน้า (LineSetup / Management / Dashboard / หน้าอื่นที่วาดผัง) ต้องเรียกตัวนี้
 * เพื่อให้ขนาด+พฤติกรรมป้ายตอน setup ตรงกับตอนแสดงผลจริงเป๊ะ — ห้ามตั้งสูตรเองในหน้า
 * (ดู docs/UI-CONVENTIONS.md §1)
 *
 * หลัก density-aware: ผังที่มีหมุดรอง (เครื่องจักร/WIP) เยอะ ให้ย่อหมุดลงและซ่อนป้ายชื่อ
 * โดยอัตโนมัติ — ชื่อยังดูได้จาก title tooltip / คลิกเปิดการ์ดรายละเอียด และหน้านั้นควรมี
 * ปุ่ม 🏷️ ให้ผู้ใช้บังคับเปิดป้ายทั้งหมดได้ (override)
 */

export function markerScale(renderedMapWidth, { machineCount = 0 } = {}) {
  const w = renderedMapWidth || 800;
  // จุดคน/จุดงานหลัก
  const MK = Math.round(Math.max(34, Math.min(84, w * 0.055)));

  // หมุดรอง (เครื่องจักร/WIP): ย่อตามความแน่น
  //   ≤18 เครื่อง = 0.6×MK + ป้ายโชว์ · 19-32 = 0.5× ป้ายซ่อน · >32 = 0.42× ป้ายซ่อน
  const subFactor = machineCount > 32 ? 0.42 : machineCount > 18 ? 0.5 : 0.6;
  const SUB = Math.round(MK * subFactor);

  // ป้ายชื่อของหมุดรอง: ซ่อนอัตโนมัติเมื่อแน่น (ผู้ใช้ toggle เปิดเองได้)
  const showSubPills = machineCount <= 18;

  return {
    MK,
    SUB,
    showSubPills,
    ring: Math.max(2, Math.round(MK * 0.06)),
    subRing: Math.max(2, Math.round(SUB * 0.08)),
    pillFont: Math.max(11, Math.round(MK * 0.24)),
    subPillFont: Math.max(11, Math.round(SUB * 0.3)),
    badgeFont: Math.max(10, Math.round(MK * 0.2)),
  };
}
