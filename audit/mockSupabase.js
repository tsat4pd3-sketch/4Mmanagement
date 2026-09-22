/* mock client สำหรับ audit layout เท่านั้น — คืนข้อมูลว่าง ให้หน้า render โครงออกมาได้ */

/* ชื่อประเภทจริงจากระบบ — ยาว/สั้นคละกันเหมือนของจริง (ใช้ทดสอบกราฟจัดอันดับ + ป้ายแกนที่ถูกตัด) */
const DT_NAMES = ['JIG มีปัญหา (ชำรุด/ปรับแก้)', 'Robot (Alarm/Error)', 'เลเซอร์มีปัญหา',
  'เครื่องแจ้งเตือน Alarm (ไม่ระบุสาเหตุ)', 'อื่นๆ (นอกแผน)', 'แก้ไขปัญหาคุณภาพ',
  'รอกระบวนการก่อนหน้า (นอกแผน)', 'ราง Conveyor มีปัญหา', 'Sensor / Reed มีปัญหา', 'ลวดเชื่อมติด',
  'Stationary มีปัญหา', 'Feed nut ติด/ปัญหาเกลียว Nut,Bolt,Stud', 'ปรับแนวเชื่อม / ปรับจุด Spot']
const DEF_NAMES = ['รอยร้าว/แตก', 'เจาะรูไม่ครบ', 'งานยุบ', 'ย่น', 'งานทดลอง / ปรับตั้งเครื่อง (Try-out)',
  'รูไม่ตรงตำแหน่ง', 'ตัดไม่ขาด / ไม่จบ process', 'บุบบุ๋ง', 'รู NOGO / ขนาดรูไม่ได้', 'ทับเศษ SCRAP',
  'เสียรูป', 'ครีบเกิน', 'เชื่อมไม่ติด']

/* ⚠️ **ลำดับชั้นไลน์แม่ → ไลน์ลูก ต้องมีใน mock เสมอ ห้ามถอด** (2026-09-08)
   ของจริง `production_lines` มีไลน์ลูก 15+ ไลน์ (HYDROFORM มีลูก 8 ไลน์: HDF1/HDF2/LASER-345/…)
   และมีโค้ดหลายสิบจุดคิดบนโครงนี้ — `utils/lineHierarchy.js` (family/leaf/ancestor/hierarchical
   options) · `utils/stdManpower.js` · rollup พลังงานแม่-ลูก · FactoryMap `familyNames`/`stOf` ·
   Management / Checkin / ProductionPlan / LineStock …
   เดิม mock ตั้ง `parent_line_name: null` **ทุกแถว** ⇒ crashsweep ไม่เคยรันโค้ดสายนี้เลยสักหน้า
   = บั๊กทั้งคลาส (นับซ้ำแม่-ลูก · หา leaf ไม่เจอ · เดินขึ้นหา ancestor แล้ววน · indent ตามชั้น)
   มองไม่เห็นจาก harness เลย (เจอตอนทำ rollup พลังงาน 2026-09-08)
   โครงที่ใส่ = **3 ชั้น** เพื่อให้ตัวไล่ recursive ถูกเรียกจริง: 1 = แม่ · 2,3 = ลูก · 4 = หลาน (ใต้ 2)
   เหลือแถว 5-14 เป็นไลน์เดี่ยว (ยังต้องมี ไม่งั้นเคส "ไม่มีลูก" หายไป) */
const LINE_NAME = (i) => `LINE APRON ASSY (HYDROFORM) ชุดที่ ${i} — งานทดสอบชื่อยาว`
const PARENT_OF = { 2: 1, 3: 1, 4: 2 }

/* แถวปลอม 1 ชุด ครอบคอลัมน์ที่ใช้บ่อยที่สุดในโปรเจค — ให้ตาราง/ลิสต์ render ของจริงออกมาวัดได้ */
const ROW = (i) => ({
  id: `id-${i}`, name: LINE_NAME(i), code: `CODE-${i}`,
  line_name: 'LINE APRON ASSY / HYDROFORM',
  parent_line_name: PARENT_OF[i] ? LINE_NAME(PARENT_OF[i]) : null, section: 'PD1', line_id: 1,
  mat_no: `1010${1000+i}`, p_no: `MB3B 16E060 CH`, pair_mat_no: null,
  part_name: `PANEL ASSY-COWL SIDE INNER RH ชิ้นที่ ${i}`, product_id: `p-${i}`, customer: 'FORD', model: 'P703',
  machine_no: `SP-${10+i}`, machine_name: `ROBOT HANDLING / SPOT WELDING GUN ${i}`, equipment_id: `e-${i}`,
  /* ⚠️ session_id ต้องชี้ไปที่ id ของแถวจริง (2026-09-18) — เดิมเป็น `s-${i}` ซึ่ง
     **ไม่ตรงกับ `id-${i}` เลยสักแถว** ⇒ ทุกโค้ดที่ join ใบผลิต/downtime กลับไปหากะ
     ได้ 0 แถวเสมอ = สาย "ข้อมูลของกะนี้" ไม่เคยถูกรันใน harness */
  status: 'open', shift: 'day', work_date: '2026-08-04', session_id: `id-${i}`,
  /* ⏱️ start_time / shift_min — ต้องมี (2026-09-16) · `computeLiveOee` คืน null ทันทีถ้าไม่มี
     `start_time` ⇒ เดิม **ทั้งสาย OEE สด (A/P/Q สด · แถบนาทีที่หายไป · ไฟ Andon ที่อิง OEE)
     ไม่เคยถูกเรนเดอร์ใน harness เลยสักหน้า** = บั๊กทั้งคลาสมองไม่เห็น
     · elapsed ถูก cap ด้วย shift_min เสมอ ⇒ ค่าคงที่ ไม่แกว่งตามวันที่รันเทส */
  start_time: '08:00:00', end_time: '20:00:00', shift_min: 570,
  /* ⏳ opened_at / confirmed_at — ต้องมี (2026-09-18) · เดิม **ไม่มีเลย** ⇒ ทุกโค้ดที่ถามว่า
     "ใบนี้เปิด-ปิดตอนไหน" ได้ undefined ⇒ สาย "ช่วงเวลาที่พาร์ทวิ่ง" ไม่เคยถูกรันใน harness:
     %A แยกตาม MAT.NO · ตัวหาร %P ฝั่ง parallel · แผงสรุปรายชิ้น ("ควรได้") · ทบทวน CT
     — ทั้งหมดนี้คือจุดที่เกิดบั๊กจริงมาแล้ว 2 ตัวในสัปดาห์เดียว (17/09)
     ตั้งห่างกัน 60 นาที ⇒ ค่าคงที่ คำนวณย้อนได้ ไม่แกว่งตามวันที่รันเทส
     ⚠️ ต้องอยู่**ในกรอบกะ** (start_time 08:00 – end_time 20:00) — นอกกรอบจะถูกรัดเหลือ 0
        แล้วทุกใบถูกตัดทิ้ง (เจอจริงตอนทำ 18/09: ตั้งไว้ 01:00 ⇒ ตารางทบทวน CT ว่างทั้งหน้า) */
  opened_at: '2026-08-04T09:00:00+07:00', confirmed_at: '2026-08-04T10:00:00+07:00',
  /* ⚡ energy_points / energy_monthly — ต้องมี ไม่งั้นหน้า /energy รวมทุกจุดไว้ชั้นเดียว
     (meteredSet ว่าง) แล้ว **โค้ดสาย "แยกตารางตามชั้นมิเตอร์" ไม่เคยถูกรันใน harness เลย**
     is_metered สลับ 1 ใน 3 โดยตั้งใจ → ได้เคส "ไลน์ลูกมีมิเตอร์ แต่ไลน์แม่อยู่คนละตาราง"
     ซึ่งเป็นเคสที่หน้างานเจอจริง (HDF1/HDF2 มีมิเตอร์ · HYDROFORM ไม่มี) */
  scope_kind: 'line', scope_name: LINE_NAME(i), is_metered: i % 3 === 0, month_key: '2026-08',
  qty: 120+i, qty_ng: i, qty_ok: 118+i, qty_suspect: 0, qty_actual: 118+i, qty_target: 130,
  qty_per_kanban: 60,   // kanban_standards — ไม่มีแล้วโมดัล Scan ขึ้น "undefined ชิ้น/ใบ" (พบ 15/09)
  duration_min: 12+i, cycle_time_sec: 58, oee: 82.5, oee_a: 91, oee_p: 93, oee_q: 98,
  employee_id: `emp-${i}`, employee_id_code: `6${1000+i}`, is_present: true, team: 'A',
  description: 'ตัวกระบอกลมที่สลับ reed ไปครับ เป็นอีกแล้ว รบกวนช่างมาดูให้หน่อยครับ ขอบคุณครับ',
  category: 'unplanned', image_url: '', is_active: true,
  created_at: '2026-08-04T01:00:00+07:00', started_at: '2026-08-04T01:00:00+07:00',
  ended_at: '2026-08-04T01:30:00+07:00', checklist_id: `c-${i}`,
  full_name: `นายดุลยทรรศน์ ลาภธนสารสมบัติ ${i}`, position: 'operator', role: 'leader', email: `u${i}@x.co`,
  title: `หัวข้อทดสอบ ${i}`, label: `ป้าย ${i}`, note: 'หมายเหตุ', remark: 'หมายเหตุ',
  /* ⚠️ ต้อง **แตกต่างกันตาม i** (2026-09-02) — เดิมทุกแถวคืนชื่อประเภทเดียวกัน
     ⇒ กราฟที่ "จัดกลุ่มตามประเภท" (Pareto/ABC/พาเรโตของเสีย) ได้ 1 กลุ่มเสมอ
        = harness มองไม่เห็นบั๊กของกราฟจัดอันดับเลยสักตัว (ทั้งความสูง ทั้งการยุบหางยาว)
     ชื่อยกมาจากประเภทจริงในระบบ เพื่อให้ความยาวข้อความใกล้เคียงของจริงด้วย */
  dr_downtime_types: { name_th: DT_NAMES[i % DT_NAMES.length], category: 'unplanned' },
  dr_defect_types: { name_th: DEF_NAMES[i % DEF_NAMES.length] },
  /* ⚠️ ต้องมี line_name ในตัว embed ด้วย (2026-09-15) — เดิมไม่มี ⇒ ทุกโค้ดที่ถามว่า
     "พาร์ทใบนี้ผูกกับไลน์ไหน" ผ่าน kanban_standards.dr_products.line_name ได้ undefined
     ⇒ ตัวเลือก MAT.NO ของโมดัล Scan เปิด Order ว่างเปล่าตลอดใน harness = ไม่เคยถูกตรวจตาเลย */
  dr_products: { mat_no: `1010${1000+i}`, part_name: `ชิ้นงาน ${i}`, cycle_time_sec: 58,
                 line_name: 'LINE APRON ASSY / HYDROFORM', p_no: 'MB3B 16E060 CH' },
  /* ⚠️ ต้องมี staff_kind เสมอ (2026-09-21) — `employees` เป็นทะเบียนคนของทั้งบริษัทแล้ว
     (มีทั้งคนหน้าไลน์และสายสนับสนุน) · ให้ 1 ใน 4 แถวเป็น `indirect` เพื่อให้โค้ดสายตัวกรอง
     พนักงานทางอ้อม (src/utils/staffKind.js → เช็คชื่อ/สกิล/กำลังคน) ถูกรันใน harness จริง
     ถ้าทุกแถวเป็น direct เหมือนกันหมด ตัวกรองจะไม่เคยถูกทดสอบเลยสักหน้า */
  employees: { name: `นายดุลยทรรศน์ ลาภธนสารสมบัติ${i}`, employee_id_code: `6${1000+i}`, image_url: '', team: 'A',
               staff_kind: i % 4 === 3 ? 'indirect' : 'direct' },
  production_sessions: { line_name: 'LINE APRON ASSY / HYDROFORM', work_date: '2026-08-04', shift: 'day' },
})
/* ⚠️ แถวสุดท้ายเป็น "แถวข้อมูลไม่ครบ" โดยตั้งใจ (2026-08-26)
   คอลัมน์ตัวเลข/ข้อความในฐานจริงส่วนใหญ่ nullable — แถวเดียวที่เป็น null ทำให้ทั้งหน้าพังได้
   (`undefined.toLocaleString()` / `.toFixed()` / `.map()`) และ build+lint จับไม่ได้เลย
   เคสจริงที่เจอ: /products แท็บ Kanban Std พังทั้งแท็บ · /improvements พังตอนมีโปรเจคแรก
   → mock ต้องมีแถวแบบนี้เสมอ ไม่งั้น harness ผ่านหมดแต่ของจริงพัง
   ห้ามใส่ null ทุกคอลัมน์ (หน้าจะ error ตั้งแต่ key หลักจนวัดอะไรไม่ได้) — null เฉพาะค่าที่ nullable จริง */
const NULLISH = (i) => ({
  ...ROW(i),
  qty: null, qty_ng: null, qty_ok: null, qty_actual: null, qty_target: null, qty_suspect: null,
  duration_min: null, cycle_time_sec: null, oee: null, oee_a: null, oee_p: null, oee_q: null,
  qty_per_pkg: null, qty_per_kanban: null, min_qty: null, max_qty: null, lot_size: null,
  section: null, parent_line_name: null, machine_no: null, description: null, note: null, remark: null,
  image_url: null, started_at: null, ended_at: null, position: null, customer: null, model: null,
  opened_at: null, confirmed_at: null, end_time: null,
  material_cost: null, standard_cost: null, capacity_pkg: null, mat_nos: null,
})
const ROWS = [...Array.from({ length: 13 }, (_, i) => ROW(i + 1)), NULLISH(14)]

const thenable = (rows = ROWS) => {
  const res = { data: rows, error: null, count: rows.length }
  const h = {
    get(t, p) {
      if (p === 'then') return (res2) => Promise.resolve(res).then(res2)
      if (p === 'maybeSingle' || p === 'single') return () => Promise.resolve({ data: rows[0], error: null })
      if (p === 'catch' || p === 'finally') return () => proxy
      return () => proxy
    },
  }
  const proxy = new Proxy({}, h)
  return proxy
}
/* ── แถวเฉพาะตาราง (2026-09-10) ────────────────────────────────────────────────────────
   เดิม `from()` คืน ROWS ชุดเดียวกันทุกตารางโดยไม่สนใจชื่อตาราง ⇒ แผงที่ต้องมี **คีย์เชื่อม**
   ถึงจะ render (source_line / lot_request_id / maker_line) คืน 0 แถวเสมอ
   ⇒ **ทั้งคอลัมน์ "ชิ้นส่วนเข้าไลน์" ของ Daily Report ไม่เคยถูกรันใน crashsweep เลยสักครั้ง**
      (StoreLotQueue · LinePartCallPanel · LineWipPanel — พบตอนแก้ดีไซน์ 10/09)
   กติกาเดียวกับ NULLISH/PARENT_OF: mock ต้องพาโค้ดไปถึงสาขาที่ของจริงเดินทุกวัน
   ⚠️ ตั้ง child_mat_no ให้ **ซ้ำกันหลายล็อต** โดยตั้งใจ (14 ล็อต → 3 พาร์ท) — เป็นรูปทรงจริงของฐาน
      (Assy GOR = 37 ล็อตของ mat เดียว) ถ้าให้ทุกแถวเป็นคนละ mat โค้ดจัดกลุ่มจะไม่เคยถูกรัน
   ⚠️ แถว NULLISH ต้องยัง null ต่อไป — เติมแค่คีย์เชื่อม ห้ามเติมตัวเลขให้                        */
const FAM_LINE = 'LINE APRON ASSY / HYDROFORM'
const isNullish = (r) => r.qty === null
const TABLE_ROWS = {
  child_lot_requests: (r, i) => ({
    ...r, source_line: FAM_LINE, child_mat_no: `1010${1001 + (i % 3)}`, seq_no: i,
    lot_qty: isNullish(r) ? null : 14,
    status: i % 5 === 0 ? 'producing' : 'pending',
    source_prod_no: isNullish(r) ? null : `MANUAL-2609${10 + i}-133957-BE`,
  }),
  /* raw_mat_no ต้องคละ 4 แบบ ให้โค้ดแยก routing ถูกรันครบทุกสาขา (2026-09-10):
     · 1010100x = มีใน dr_products mock → routed (บางแถวเป็นไลน์อื่น = "ต่อจากไลน์อื่น")
     · 2xxxxxxx = เบอร์ 2 แต่ไม่มีใน master → "routing ยังไม่ตั้ง" (เคสจริง 27 ใบกำพร้าในฐาน)
     · 3xxx/5xxx = ของซื้อ/สิ้นเปลือง */
  raw_withdrawal_requests: (r, i) => ({
    ...r, lot_request_id: `id-${i}`, status: i % 3 ? 'pending' : 'issued',
    raw_mat_no: [`1010${1000 + (i % 3)}`, '20058488', '30047587', '50027080'][i % 4],
  }),
  /* dr_products: 2 แถวแรกเป็น "ไลน์อื่น" โดยตั้งใจ — เดิมทุกแถว line_name เดียวกันหมด
     ⇒ โค้ดที่ถามว่า "ของชิ้นนี้ไลน์อื่นทำหรือเปล่า" ไม่เคยได้คำตอบว่า "ใช่" เลยใน harness
     🔩 **ต้องมีแถวชั้น OP (`is_operation`) เสมอ ห้ามถอด** (2026-09-15) — เดิมไม่มีเลยสักแถว
     ⇒ โค้ดสายชั้นขั้นตอน (collapseOps · worklist OP ใน /products · ปุ่มระเบิดของเสียใน
        /scrap-report · ตัวกรอง OP ของ picker) **ไม่เคยถูกรันใน harness เลย** = บั๊กทั้งคลาสมองไม่เห็น
     · i=4 → OP ที่ผูกพาร์ทจริง + ลำดับขั้นครบ (เคสปกติ)
     · i=5 → OP ที่ยังไม่ผูก parent/seq (เคส worklist เหลือง + กฎ "ขั้นเดี่ยว ห้ามเดาสาย") */
  dr_products: (r, i) => {
    const base = i <= 2 ? { ...r, line_name: 'LINE C ( 200&250 Ton )' } : r;
    if (i === 4) return { ...base, is_operation: true, op_parent_mat: `1010${1001}`, op_seq: 10 };
    if (i === 5) return { ...base, is_operation: true, op_parent_mat: null, op_seq: null };
    return { ...base, is_operation: false, op_parent_mat: null, op_seq: null };
  },
  /* ⏱ ct_proposals — คิวข้อเสนอปรับ CT (2026-09-18)
     ไม่มี mock = แผงคิว + ปุ่ม "อนุมัติ/ปฏิเสธ" ไม่เคยถูกเรนเดอร์เลย ทั้งที่เป็นปุ่มที่
     **เขียนทับ CT มาตรฐาน** (กระทบ %P ของทั้งไลน์) — ต้องให้ crashsweep เห็น
     · i=1 → ยังไม่เคยตั้ง CT มาตรฐาน (ct_standard null = เคสที่ต้องไม่พังตอน toLocaleString)
     · i=2 → ไม่มี p25/p75 (ข้อเสนอเก่าก่อนมีคอลัมน์นี้) */
  ct_proposals: (r, i) => ({
    ...r, status: 'proposed',
    /* ⚠️ ใช้ MAT คนละชุดกับ prod_orders โดยตั้งใจ — ถ้าชนกัน ตารางผลคำนวณจะขึ้น
       "อยู่ในคิวแล้ว" ทุกแถว แล้ว**ปุ่ม "เสนอปรับ" ไม่เคยถูกเรนเดอร์เลย** */
    mat_no: `9010${1000 + i}`,
    ct_standard: i === 1 ? null : 58,
    ct_observed: 44 + (i % 5),
    sample_orders: 10 + i, dropped_orders: i % 3,
    p25: i === 2 ? null : 41, p75: i === 2 ? null : 49,
    flags: i % 2 ? ['big_gap'] : [],
    product_name: `ชิ้นงาน ${i}`, created_by_name: `ผู้เสนอ ${i}`,
  }),
  /* prod_orders: ใบผลิตต้อง **ซ้ำ mat_no กันหลายใบ** (2026-09-18) — เดิมทุกใบคนละ MAT
     ซึ่งไม่ใช่รูปทรงจริง (กะหนึ่งวิ่ง 1-2 MAT · ไลน์หนึ่งวิ่ง MAT เดิมทุกวัน)
     ⇒ โค้ดที่ "รวมหลายใบของ MAT เดียวกัน" (ทบทวน CT · %P ต่อ MAT · parallel detection)
        ได้กลุ่มละ 1 ใบเสมอ = ไม่เคยถึงเกณฑ์ตัวอย่างขั้นต่ำเลยสักครั้ง
     · 10 ใบ + 4 ใบ ⇒ ได้ **ทั้งสองสาขา**: กลุ่มแรกถึงเกณฑ์ (ปุ่ม "เสนอปรับ" โผล่)
       กลุ่มหลังไม่ถึง (ป้าย "ตัวอย่างไม่พอ") — ถ้าทุกกลุ่มถึงเกณฑ์หมด สาขาที่สองจะไม่เคยถูกรัน */
  prod_orders: (r, i) => ({ ...r, mat_no: i <= 10 ? '10101001' : '10101002', status: 'confirmed' }),
  v_demand_flow_blocks: (r, i) => ({
    ...r, maker_line: FAM_LINE, pending_qty: isNullish(r) ? null : 500 + i,
    block_reason: i % 2 ? 'no_lot_size' : 'backlog_capped', suggested_lot: isNullish(r) ? null : 200,
  }),
}
const rowsFor = (table) => {
  const fn = TABLE_ROWS[table]
  return fn ? ROWS.map((r, idx) => fn(r, idx + 1)) : ROWS
}
const q = (table) => thenable(rowsFor(typeof table === 'string' ? table : undefined))

/* ── 🗄️ ผลของ RPC ที่คืน "ก้อน jsonb" ไม่ใช่ลิสต์แถว (2026-09-22) ─────────────────────
   mock เดิม `rpc: q` คืน ROWS (อาร์เรย์) ให้ทุกชื่อฟังก์ชัน ⇒ หน้าที่กิน jsonb ก้อนเดียว
   (หน้า /schema: esm_schema_overview / esm_schema_table) จะได้ข้อมูลผิดทรง แล้วตกไปสาขา
   "โหลดไม่ได้" ทุกครั้ง = **สาขาที่ใช้งานจริงไม่เคยถูกเรนเดอร์ใน crashsweep เลย**
   ⚠️ ต้องครอบเคสที่ของจริงมีจริงๆ: วิว (แก้ไม่ได้) · ตารางไม่มี PK · RLS ปิด · คอลัมน์ enum ·
      FK ข้าม schema (auth.users) — เคสพวกนี้คือจุดที่โค้ดหน้ามีสาขาแยก                        */
const SCHEMA_TABLES = [
  { t: 'employees', k: 'r', cols: 12, rows: 308, rls: true, pk: ['id'], note: null },
  { t: 'four_m_logs', k: 'r', cols: 18, rows: 1240, rls: true, pk: ['id'], note: 'บันทึกการเปลี่ยนแปลง 4M' },
  { t: 'line_stock_summary', k: 'v', cols: 4, rows: 0, rls: false, pk: [], note: null },
  { t: 'production_lines', k: 'r', cols: 11, rows: 31, rls: true, pk: ['id'], note: null },
]
const SCHEMA_FKS = [
  { name: 'four_m_logs_line_id_fkey', t: 'four_m_logs', c: ['line_id'], rt: 'production_lines', rc: ['id'], del: 'a' },
  { name: 'four_m_logs_created_by_fkey', t: 'four_m_logs', c: ['created_by'], rt: 'auth.users', rc: ['id'], del: 'a' },
]
const RPC_RESULT = {
  esm_schema_overview: () => ({ at: '2026-09-22T01:00:00Z', tables: SCHEMA_TABLES, fks: SCHEMA_FKS }),
  esm_schema_table: (args) => {
    const name = args?.p_table || 'four_m_logs'
    const base = SCHEMA_TABLES.find(x => x.t === name) || SCHEMA_TABLES[0]
    return {
      at: '2026-09-22T01:00:00Z', t: base.t, k: base.k, rls: base.rls, rows: base.rows, note: base.note,
      pk: base.pk,
      columns: [
        { name: 'id', type: 'uuid', nn: true, def: 'gen_random_uuid()', note: null, enum: null },
        { name: 'category', type: 'text', nn: true, def: null, note: 'Man/Machine/Material/Method', enum: null },
        { name: 'role', type: 'user_role', nn: false, def: null, note: null, enum: ['admin', 'manager', 'supervisor'] },
        { name: 'line_id', type: 'integer', nn: false, def: null, note: null, enum: null },
      ],
      fks: SCHEMA_FKS.filter(f => f.t === base.t),
      refs: base.t === 'production_lines' ? [{ name: 'x', t: 'four_m_logs', c: ['line_id'], rc: ['id'], del: 'a' }] : [],
      uniques: [{ name: 'u1', c: ['id'] }],
      checks: [{ name: 'c1', src: "CHECK (category = ANY (ARRAY['Man'::text, 'Machine'::text]))" }],
      indexes: [{ name: `${base.t}_pkey`, uniq: true, def: `CREATE UNIQUE INDEX ${base.t}_pkey ON public.${base.t} USING btree (id)` }],
      policies: base.rls ? [{ name: 'allow auth', cmd: 'ALL', roles: ['authenticated'], permissive: true }] : [],
      triggers: [{ name: 'trg_audit', fn: 'fn_audit' }],
    }
  },
}
const rpc = (name, args) => (RPC_RESULT[name] ? thenable(RPC_RESULT[name](args)) : q(name))

const chan = () => { const c = { on: () => c, subscribe: () => c, unsubscribe: () => c, send: () => c }; return c }
export const supabase = {
  from: q, rpc, channel: () => chan(),
  removeChannel: () => {},
  auth: {
    getSession: () => Promise.resolve({ data: { session: { user: { id: 'x', email: 'a@b.c' } } } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: () => Promise.resolve({}), getUser: () => Promise.resolve({ data: { user: { id: 'x' } } }),
  },
  storage: { from: () => ({ upload: q, remove: q, getPublicUrl: () => ({ data: { publicUrl: '' } }), list: q }) },
  functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
}
export const supabaseDR = supabase
export const setDrActorName = () => {}
