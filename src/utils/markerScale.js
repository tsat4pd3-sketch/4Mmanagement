/**
 * markerScale — สูตรขนาด marker บนผังไลน์ "ตัวเดียวทั้งระบบ" (WYSIWYG)
 * ทุกหน้า (LineSetup / Management / Dashboard / หน้าอื่นที่วาดผัง) ต้องเรียกตัวนี้
 * เพื่อให้ขนาด+พฤติกรรมป้ายตอน setup ตรงกับตอนแสดงผลจริงเป๊ะ — ห้ามตั้งสูตรเองในหน้า
 * (ดู docs/UI-CONVENTIONS.md §1)
 *
 * หลัก density-aware: ผังที่มีหมุดรอง (เครื่องจักร/WIP) เยอะ ให้ย่อ "วงกลม" ลงตามความแน่น
 * ส่วนป้ายชื่อคุมด้วยปุ่ม 🏷️ โชว์/ซ่อน ของหน้า (สองสถานะ default โชว์ — UI-CONVENTIONS §1)
 * และป้ายต้องกว้างขั้นต่ำพออ่านชื่อออกเสมอ (pillMaxW/subPillMaxW)
 */

export function markerScale(renderedMapWidth, { machineCount = 0 } = {}) {
  const w = renderedMapWidth || 800;
  // จุดคน/จุดงานหลัก
  const MK = Math.round(Math.max(34, Math.min(84, w * 0.055)));

  // หมุดรอง (เครื่องจักร/WIP): ย่อตามความแน่น
  //   ≤18 เครื่อง = 0.6×MK + ป้ายโชว์ · 19-32 = 0.5× ป้ายซ่อน · >32 = 0.42× ป้ายซ่อน
  const subFactor = machineCount > 32 ? 0.42 : machineCount > 18 ? 0.5 : 0.6;
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
    subPillMaxW: Math.max(Math.round(SUB * 2), 88),
  };
}
