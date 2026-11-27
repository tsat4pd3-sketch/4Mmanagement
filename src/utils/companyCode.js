/* ── companyCode — กฎ "รหัสพนักงาน ↔ บริษัทในกลุ่ม" (pure · ไม่แตะ DB) · 2026-11-25 ──
   template Com Code ของกลุ่ม: Employee ID 7 หลัก = **Com Code 3 หลัก + running 4** (1100161 = TSA 110 + 0161)
   ทะเบียนบริษัทอ่านผ่าน utils/useCompanies.js (Main `companies`) แล้วส่ง rows เข้ามาที่นี่
   🔴 ไม่ใช่ 7 หลัก / ไม่เจอ / บริษัทปิดใช้ = null ห้ามเดา — ผู้รับเหมา (STM/PTA/TEC/ASC…) ไม่อยู่ใน template */

/** รหัสพนักงาน → แถวบริษัทในกลุ่ม (จาก Com Code 3 หลักแรก) · ไม่รู้ = null */
export function companyOfEmployeeCode(code, companies = []) {
  const s = String(code ?? '').trim();
  if (!/^\d{7}$/.test(s)) return null;
  const pfx = s.slice(0, 3);
  return (companies || []).find(c => c?.is_active !== false && String(c?.com_code ?? '') === pfx) || null;
}

/** จัดกลุ่มตาม SPG (เรียงตามเลข SPG) — ใช้วาดตาราง/ตัวเลือก */
export function groupBySpg(companies = []) {
  const m = new Map();
  for (const c of companies || []) {
    const k = String(c?.spg_no ?? '');
    if (!m.has(k)) m.set(k, { spg_no: k, spg_name: c?.spg_name ?? '', companies: [] });
    m.get(k).companies.push(c);
  }
  return [...m.values()].sort((a, b) => a.spg_no.localeCompare(b.spg_no));
}
