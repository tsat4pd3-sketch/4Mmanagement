/* ── ป้ายภาษาไทยของ audit_log — ใช้ร่วมทุกจอที่โชว์ประวัติการแก้ข้อมูล (2026-08-19) ──
   audit_log มี **2 ชุด คนละ project** (Main + DR) และครอบ ~74 ตารางรวมกัน
   ป้ายอยู่ที่นี่ที่เดียว — **ห้ามนิยาม label ของตาราง/ฟิลด์ซ้ำในหน้าใดๆ**

   ⚠️ ตารางที่ไม่มีในแมพ = แสดงชื่อตารางดิบ (ไม่พัง แค่ไม่สวย)
      เพิ่ม audit ให้ตารางใหม่แล้วอยากได้ชื่อไทย ให้มาเติมที่นี่ */

export const AUDIT_ACTIONS = {
  INSERT: { t: '➕ เพิ่ม',  c: '#22c55e' },
  UPDATE: { t: '✏️ แก้ไข', c: '#f59e0b' },
  DELETE: { t: '🗑 ลบ',    c: '#ef4444' },
};

/* ตาราง → ชื่อไทย (รวมทั้ง 2 project · จัดกลุ่มตามโดเมนเพื่อให้หาง่ายเวลาแก้) */
export const AUDIT_TABLE_LABELS = {
  // ── สิทธิ์ & ผู้ใช้ (Main) — กลุ่มที่อ่อนไหวที่สุด ──
  role_permissions:        '🔐 สิทธิ์ตาม role',
  permission_catalog:      '🔐 ทะเบียนสิทธิ์',
  profiles:                '👤 ผู้ใช้งาน (โปรไฟล์/สิทธิ์)',
  employees:               '🧑‍🏭 ข้อมูลพนักงาน',
  employee_skills:         '📊 คะแนนทักษะ',
  skill_definitions:       '📊 นิยามทักษะ',
  station_requirements:    '📍 ทักษะที่จุดงานต้องการ',
  // ── ผังองค์กร & ไลน์ (Main) ──
  org_nodes:               '🏢 ผังองค์กร',
  production_lines:        '🏭 ไลน์ผลิต',
  workstations:            '📍 จุดงาน',
  cost_center_rates:       '💰 Activity Rate',
  company_calendar:        '🗓️ ปฏิทินบริษัท',
  oee_targets:             '🎯 เป้า OEE',
  // ── เอกสาร & แจ้งเตือน (Main) ──
  doc_forms:               '📄 ทะเบียนเอกสาร',
  notification_rules:      '🔔 กติกาแจ้งเตือน',
  telegram_channels:       '🔔 ห้อง Telegram',
  lpa_questions:           '📋 คำถาม LPA',
  // ── PE Core Tools (Main) ──
  pe_doc_sets:             '📐 ชุดเอกสาร PE',
  pe_processes:            '📐 ขั้นตอน (PFC)',
  pe_fmea_items:           '📐 PFMEA',
  pe_cp_items:             '📐 Control Plan',
  pe_doc_revisions:        '📐 Revision เอกสาร PE',
  pe_change_requests:      '📐 คำขอแก้เอกสาร PE',

  // ── สินค้า & คัมบัง (DR) ──
  dr_products:             '📦 สินค้า (Product Master)',
  parts_master:            '🗂 ทะเบียนพาร์ท',
  kanban_standards:        '🎴 มาตรฐานคัมบัง',
  kanban_targets:          '🎴 เป้าคัมบัง',
  part_routings:           '🔀 Routing',
  product_packaging:       '📦 บรรจุภัณฑ์',
  container_types:         '📦 ชนิดภาชนะ',
  stock_inflow_rules:      '📥 กติกาสต๊อกเข้า',
  ship_to_plants:          '🚚 ปลายทางลูกค้า',
  shipping_workflow_steps: '🚚 ขั้นตอนรอบส่ง',
  // ── เครื่องจักร & อุปกรณ์ (DR) ──
  machines:                '⚙️ ทะเบียนเครื่องจักร',
  machine_types:           '⚙️ ประเภทเครื่อง',
  machine_automation_levels: '⚙️ ระดับอัตโนมัติ',
  machine_operation_modes: '⚙️ โหมดการทำงาน',
  jigs:                    '🔧 อุปกรณ์ที่มีแผน PM',
  jig_checkpoints:         '🔧 จุดตรวจ PM',
  checklists:              '📋 รายการตรวจ (ความรับผิดชอบทีม)',
  pm_plans:                '🛠️ แผน PM',
  pm_daily_line_targets:   '🛠️ ทะเบียน AM รายไลน์',
  pm_facility_areas:       '🏗️ โซน facility',
  pm_checking_methods:     '🛠️ วิธีตรวจ',
  pm_checkpoint_categories:'🛠️ ประเภทจุดตรวจ',
  die_sets:                '🔨 ชุดแม่พิมพ์',
  die_op_types:            '🔨 กระบวนการแม่พิมพ์',
  equipment_die:           '🔨 แม่พิมพ์ (สถานะ/ตำแหน่ง)',
  die_storage_areas:       '🗺️ ผังจัดเก็บแม่พิมพ์',
  // ── งานซ่อม (DR) ──
  mtn_item_types:          '⚙️ ชนิดอุปกรณ์',
  mtn_problem_types:       '🛑 ลักษณะปัญหา',
  mtn_repair_types:        '🔧 ประเภทงานซ่อม',
  mtn_spare_categories:    '🏷️ หมวดอะไหล่',
  mtn_spare_parts:         '🔩 อะไหล่',
  mtn_technicians:         '👷 ช่าง',
  mtn_labor_rates:         '💰 ค่าแรงมาตรฐาน',
  mtn_teams:               '👷 ทีมช่าง',
  mtn_rack_maps:           '🗺️ ผังคลังอะไหล่',
  mtn_rack_cells:          '🗺️ ช่องชั้นวาง',
  // ── ผลิต & คุณภาพ (DR) ──
  dr_downtime_types:       '🛑 ประเภท Downtime',
  dr_defect_types:         '🚫 ประเภทของเสีย',
  scrap_defect_types:      '🚫 ประเภทของเสีย (ใบ Scrap)',
  quality_bin_records:     '🗑️ ถังเหลือง/ถังแดง',
  process_types:           '🏭 กระบวนการผลิต',
  break_policies:          '⏸️ นโยบายเวลาพัก',
  lot_post_configs:        '📥 กติกาสะสมล็อต',
  kanban_calc_settings:    '🎴 ตั้งค่าคำนวณคัมบัง',
  dt_alert_config:         '🔔 เกณฑ์เตือน Downtime',
  energy_monthly:          '⚡ พลังงานรายเดือน',
};

/* ฟิลด์ → ชื่อไทย (ใช้ตอนโชว์ ค่าเก่า → ค่าใหม่) */
export const AUDIT_FIELD_LABELS = {
  name: 'ชื่อ', name_th: 'ชื่อ (ไทย)', label: 'ป้าย', code: 'รหัส', note: 'หมายเหตุ',
  is_active: 'สถานะใช้งาน', sort_order: 'ลำดับ', category: 'หมวด',
  characteristic: 'ลักษณะปัญหา', detail: 'รายละเอียด', group_name: 'กลุ่ม',
  team: 'ทีม', dept: 'ทีม', department: 'แผนก', section: 'ส่วนงาน', shared_teams: 'ทีมที่เห็นร่วม',
  price: 'ราคา', unit: 'หน่วย', prefix: 'รหัสย่อ',
  role: 'สิทธิ์ (role)', allowed: 'อนุญาต', permission_key: 'คีย์สิทธิ์', is_dept_admin: 'แอดมินหน่วยงาน',
  full_name: 'ชื่อ-สกุล', position: 'ตำแหน่ง', line_id: 'ไลน์', sections: 'ส่วนงานที่ดูแล', mtn_teams: 'ทีมช่าง',
  mat_no: 'เลข MAT', p_no: 'เลขพาร์ทลูกค้า', cycle_time_sec: 'CT (วินาที)', pair_mat_no: 'พาร์ทคู่',
  line_name: 'ไลน์', machine_no: 'หมายเลขเครื่อง', machine_name: 'ชื่อเครื่อง',
  equipment_kind: 'ชนิดอุปกรณ์', equipment_category: 'หมวดอุปกรณ์', equipment_type: 'ประเภทอุปกรณ์',
  min_qty: 'ขั้นต่ำ', max_qty: 'สูงสุด', stock_qty: 'ยอดคงเหลือ', qty_per_kanban: 'จำนวน/คัมบัง',
  shelf: 'ตำแหน่งชั้นวาง', rank_override: 'Rank (ตั้งเอง)', rank_note: 'เหตุผล Rank',
  die_status: 'สถานะแม่พิมพ์', status_note: 'หมายเหตุสถานะ', area_id: 'ผังจัดเก็บ',
  pos_x: 'ตำแหน่ง X (%)', pos_y: 'ตำแหน่ง Y (%)',
  regrind_count: 'เจียรไปแล้ว (ครั้ง)', regrind_limit: 'เจียรได้สูงสุด', tonnage_ton: 'ขนาดตัน', op_seq: 'OP',
  next_due_date: 'ครบกำหนดถัดไป', last_done_at: 'ตรวจล่าสุด', interval_days: 'รอบ (วัน)',
  dl_rate: 'DL (บาท/ชม.)', oh_rate: 'OH (บาท/ชม.)', dp_rate: 'DP (บาท/ชม.)', idp_rate: 'IDP (บาท/ชม.)',
  effective_from: 'เริ่มใช้', form_code: 'เลขฟอร์ม', rev_no: 'Rev', score: 'คะแนน',
  cost_center: 'Cost Center', std_day_shift: 'กำลังคนกะเช้า', std_night_shift: 'กำลังคนกะดึก',
  flow_mode: 'โหมดไหลงาน', parallel_stations: 'จำนวนเครื่องขนาน', line_type: 'ประเภทไลน์',
  image_url: 'รูป', is_enabled: 'เปิดใช้งาน', chat_id: 'ห้องแชท', inapp_roles: 'แจ้งในแอป (role)',
};

/** ป้ายตาราง — ไม่รู้จักคืนชื่อดิบ (ไม่ซ่อน ไม่พัง) */
export const tableLabel = (t) => AUDIT_TABLE_LABELS[t] || t;
/** ป้ายฟิลด์ — ไม่รู้จักคืนชื่อดิบ */
export const fieldLabel = (f) => AUDIT_FIELD_LABELS[f] || f;

/** ฟิลด์ที่ไม่ต้องโชว์ในรายการ "เปลี่ยนอะไรบ้าง" (เป็น metadata ของ audit เอง) */
export const AUDIT_SKIP_FIELDS = new Set(['updated_at', 'updated_by_name', 'created_at']);

/** ชื่อที่ใช้เรียกแถวที่ถูกแก้ (เดาจากฟิลด์ยอดนิยม) */
export const rowLabel = (r) => {
  const d = r?.new_data || r?.old_data || {};
  return d.name || d.name_th || d.full_name || d.machine_no || d.mat_no || d.characteristic
      || d.label || d.code || d.permission_key || d.cost_center || '(ไม่ระบุชื่อ)';
};
