/**
 * vsmGaps — worklist "ข้อมูลที่ VSM ยังขาด" (คำขอ user 2026-08-20 หลัง audit ข้อมูลจริง)
 *
 * กติกา single source of truth:
 *  · การ "ตรวจว่าขาดอะไร" อยู่ที่ buildVsmModel (lib/vsmModel.js) ที่เดียว — ไฟล์นี้ห้ามตรวจซ้ำ
 *  · ที่นี่ทำแค่จับคู่ warning.code → ปุ่ม "ไปแก้ที่ไหน" (deep link)
 *  · code ที่ไม่รู้จัก = แสดง warning ตามเดิมโดยไม่มีลิงก์ — warning ใหม่ในโมเดลต้องไม่หายเงียบ
 *
 * pure ไม่ import supabase/react — เทสได้ด้วย node:test (import ต้องมีนามสกุล .js)
 */

/** action ของแต่ละ code — คืน [{ label, to? }] · ไม่มี `to` = งานที่ทำในหน้า VSM เอง */
const FIX = {
  // routing คือช่องว่างใหญ่สุดจาก audit (FG 44 ตัว ลง routing แล้ว 0) — มี PFC ใน /pe-docs = เสนอได้เลย
  no_routing: peSet => [
    peSet
      ? { label: '📐 เสนอจาก PFC ที่มีอยู่แล้ว', to: `/pe-docs?set=${peSet.id}` }
      : { label: '📐 ดูว่ามี PFC ของพาร์ทนี้ไหม', to: '/pe-docs' },
    { label: '🔀 ลงเองที่ Product Master → Routing', to: '/products?tab=routing' },
  ],
  fallback_routing: peSet => FIX.no_routing(peSet),
  no_ct: () => [{ label: '🔩 ตั้ง CT ที่ Product Master', to: '/products' }],
  no_demand: () => [{ label: '📈 อัพ forecast / จับคู่เลขพาร์ท (p_no) ที่ Planner & Sales', to: '/planner-sales' }],
  demand_from_order: () => [{ label: '📈 อัพ forecast ที่ Planner & Sales', to: '/planner-sales' }],
  no_working_days: () => [{ label: '📅 ตั้งวันทำงานที่ปฏิทินบริษัท', to: '/company-calendar' }],
  no_sessions: () => [{ label: '🏭 เปิด-ปิดกะใน Daily Report', to: '/daily-report' }],
  no_oee: () => [{ label: '🏭 เปิด-ปิดกะใน Daily Report', to: '/daily-report' }],
  // แท็บ setup ของ daily-report มี guard สิทธิ์อยู่แล้ว — คนไม่มีสิทธิ์จะตกกลับแท็บ default ไม่พัง
  no_setup: () => [{ label: '⚙️ จัดหมวดประเภท Downtime เป็น "setup" (Daily Report → ตั้งค่า)', to: '/daily-report?tab=setup' }],
  no_supplier_stock: () => [{ label: '📦 บันทึกรับเข้าคลังที่ Store', to: '/line-stock' }],
  supplier_pattern: () => [{ label: '✍️ กรอกในการ์ด "รอบส่ง" ด้านล่าง' }],
  missing_wip: () => [{ label: '✍️ กรอกช่อง "คงคลังหลังขั้นนี้" ในตาราง' }],
  no_vendor: () => [{ label: '✍️ ระบุผู้รับจ้างใน routing (Product Master → Routing)', to: '/products?tab=routing' }],
};

/**
 * @param {object} model  ผลจาก buildVsmModel (ใช้ .warnings)
 * @param {object} opts   { peSet } = ชุดเอกสาร PE (pe_doc_sets) ที่จับคู่กับ FG นี้ได้ (null = ไม่มี)
 * @returns [{ level, text, code, actions: [{label, to?}] }]
 */
export function buildVsmGaps(model, { peSet = null } = {}) {
  if (!model) return [];
  return (model.warnings || []).map(w => ({
    ...w,
    actions: FIX[w.code] ? FIX[w.code](peSet) : [],
  }));
}
