/* ประเภทไลน์ผลิต — source of truth เดียว (คอลัมน์ production_lines.line_type · Main project)
   ตั้งค่าที่หน้า ⚙️ ตั้งค่าผังไลน์ (LineSetup — แผง Standard Manpower)
   ใช้กับ: จัดกลุ่มกำลังผลิตตามกระบวนการ (Production Plan), ผูกกับที่มา MAT เบอร์ 200
   (พาร์ทย่อยผลิตเองส่วนใหญ่มาจากไลน์ปั๊ม) — ดู CLAUDE.md "รหัส MAT SAP"
   หมายเหตุ: คนละตัวกับ process_type (dr_products/machines ฝั่ง DR: metal_forming/welding_assembly/common)
   ซึ่งใช้กรองประเภท downtime/ของเสีย — line_type คือป้ายประเภทของ "ตัวไลน์" ที่หัวหน้ากำหนดเอง */
export const LINE_TYPES = [
  { value: 'stamping',         label: '🔩 ปั๊ม / Stamping' },
  { value: 'hydroform',        label: '💧 ไฮโดรฟอร์ม' },
  { value: 'laser',            label: '✂️ เลเซอร์' },
  { value: 'welding_assembly', label: '🔥 เชื่อมประกอบ' },
  { value: 'other',            label: '📦 อื่นๆ' },
];

export const lineTypeLabel = (v) => LINE_TYPES.find(t => t.value === v)?.label || null;

/* โหมดการไหลงาน (production_lines.flow_mode · Main project · migration 20260723_line_flow_mode.sql)
   คนละมิติกับ line_type — บอกว่าไลน์นี้ "ไหลงานยังไง" ใช้กับบอร์ด Heijunka จัดเลนคิว
   one_piece_flow  = สายเดียวไหลทีละชิ้น → 1 เลน เรียงคิวต่อกัน (ดีฟอลต์ = พฤติกรรมเดิม)
   parallel_machine = เครื่อง stand-alone หลายตัว วิ่งพร้อมกันคนละรายการ → N เลนขนาน เริ่มพร้อมกัน */
export const FLOW_MODES = [
  { value: 'one_piece_flow',  label: '🔁 One-piece flow (เรียงคิวทีละใบ)', short: '🔁 สายเดียว' },
  { value: 'parallel_machine', label: '⚙️ เครื่องขนาน (วิ่งพร้อมกันหลายเครื่อง)', short: '⚙️ เครื่องขนาน' },
];
export const flowModeOf = (v) => v === 'parallel_machine' ? 'parallel_machine' : 'one_piece_flow';
export const isParallelLine = (v) => flowModeOf(v) === 'parallel_machine';
export const flowModeShort = (v) => FLOW_MODES.find(t => t.value === flowModeOf(v))?.short || null;

/* จำนวน "เครื่องหลักวิ่งขนาน" ของไลน์ (N) — ใช้หัก Downtime ที่ผูกเครื่อง 1/N ในสูตร OEE
   ⚠️ คนละเรื่องกับ flow_mode (การจัดเลนคิวบนบอร์ด/เลือกเครื่องตอนเปิด Order):
   - ไลน์งานคู่ LH/RH เช่น LASER-345/789 (เลเซอร์ 3 ตัวขึ้น product เดียว 2 พาร์ทซ้าย-ขวา)
     = one_piece_flow บนบอร์ด (เลนคู่จาก pair_mat_no) แต่ตั้ง parallel_stations=3 เพื่อหัก DT 1/3
   - ไลน์เครื่อง stand-alone หลาย product เช่น SUB APRON = parallel_machine (dispatch ผูกเครื่อง)
     ถ้าไม่ตั้ง stations ให้ fallback นับจากทะเบียนเครื่องของไลน์ (fallbackCount)
   line = { flow_mode, parallel_stations } · คืนค่า ≥ 1 เสมอ */
export const parallelUnitsOf = (line, fallbackCount = 0) => {
  const n = Number(line?.parallel_stations);
  if (n > 1) return n;
  if (flowModeOf(line?.flow_mode) === 'parallel_machine') return fallbackCount > 1 ? fallbackCount : 1;
  return 1;
};
