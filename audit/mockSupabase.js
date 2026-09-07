/* mock client สำหรับ audit layout เท่านั้น — คืนข้อมูลว่าง ให้หน้า render โครงออกมาได้ */

/* ชื่อประเภทจริงจากระบบ — ยาว/สั้นคละกันเหมือนของจริง (ใช้ทดสอบกราฟจัดอันดับ + ป้ายแกนที่ถูกตัด) */
const DT_NAMES = ['JIG มีปัญหา (ชำรุด/ปรับแก้)', 'Robot (Alarm/Error)', 'เลเซอร์มีปัญหา',
  'เครื่องแจ้งเตือน Alarm (ไม่ระบุสาเหตุ)', 'อื่นๆ (นอกแผน)', 'แก้ไขปัญหาคุณภาพ',
  'รอกระบวนการก่อนหน้า (นอกแผน)', 'ราง Conveyor มีปัญหา', 'Sensor / Reed มีปัญหา', 'ลวดเชื่อมติด',
  'Stationary มีปัญหา', 'Feed nut ติด/ปัญหาเกลียว Nut,Bolt,Stud', 'ปรับแนวเชื่อม / ปรับจุด Spot']
const DEF_NAMES = ['รอยร้าว/แตก', 'เจาะรูไม่ครบ', 'งานยุบ', 'ย่น', 'งานทดลอง / ปรับตั้งเครื่อง (Try-out)',
  'รูไม่ตรงตำแหน่ง', 'ตัดไม่ขาด / ไม่จบ process', 'บุบบุ๋ง', 'รู NOGO / ขนาดรูไม่ได้', 'ทับเศษ SCRAP',
  'เสียรูป', 'ครีบเกิน', 'เชื่อมไม่ติด']

/* แถวปลอม 1 ชุด ครอบคอลัมน์ที่ใช้บ่อยที่สุดในโปรเจค — ให้ตาราง/ลิสต์ render ของจริงออกมาวัดได้ */
const ROW = (i) => ({
  id: `id-${i}`, name: `LINE APRON ASSY (HYDROFORM) ชุดที่ ${i} — งานทดสอบชื่อยาว`, code: `CODE-${i}`,
  line_name: 'LINE APRON ASSY / HYDROFORM', parent_line_name: null, section: 'PD1', line_id: 1,
  mat_no: `1010${1000+i}`, p_no: `MB3B 16E060 CH`, pair_mat_no: null,
  part_name: `PANEL ASSY-COWL SIDE INNER RH ชิ้นที่ ${i}`, product_id: `p-${i}`, customer: 'FORD', model: 'P703',
  machine_no: `SP-${10+i}`, machine_name: `ROBOT HANDLING / SPOT WELDING GUN ${i}`, equipment_id: `e-${i}`,
  status: 'open', shift: 'day', work_date: '2026-08-04', session_id: `s-${i}`,
  qty: 120+i, qty_ng: i, qty_ok: 118+i, qty_suspect: 0, qty_actual: 118+i, qty_target: 130,
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
  dr_products: { mat_no: `1010${1000+i}`, part_name: `ชิ้นงาน ${i}`, cycle_time_sec: 58 },
  employees: { name: `นายดุลยทรรศน์ ลาภธนสารสมบัติ${i}`, employee_id_code: `6${1000+i}`, image_url: '', team: 'A' },
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
  material_cost: null, standard_cost: null, capacity_pkg: null, mat_nos: null,
})
const ROWS = [...Array.from({ length: 13 }, (_, i) => ROW(i + 1)), NULLISH(14)]

const thenable = () => {
  const res = { data: ROWS, error: null, count: ROWS.length }
  const h = {
    get(t, p) {
      if (p === 'then') return (res2) => Promise.resolve(res).then(res2)
      if (p === 'maybeSingle' || p === 'single') return () => Promise.resolve({ data: ROWS[0], error: null })
      if (p === 'catch' || p === 'finally') return () => proxy
      return () => proxy
    },
  }
  const proxy = new Proxy({}, h)
  return proxy
}
const q = () => thenable()
const chan = () => { const c = { on: () => c, subscribe: () => c, unsubscribe: () => c, send: () => c }; return c }
export const supabase = {
  from: q, rpc: q, channel: () => chan(),
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
