/* mock client สำหรับ audit layout เท่านั้น — คืนข้อมูลว่าง ให้หน้า render โครงออกมาได้ */

/* แถวปลอม 1 ชุด ครอบคอลัมน์ที่ใช้บ่อยที่สุดในโปรเจค — ให้ตาราง/ลิสต์ render ของจริงออกมาวัดได้ */
const ROW = (i) => ({
  id: `id-${i}`, name: `รายการทดสอบชื่อยาวพอสมควร ${i}`, code: `CODE-${i}`,
  line_name: 'LINE APRON ASSY', parent_line_name: null, section: 'PD1', line_id: 1,
  mat_no: `1010${1000+i}`, p_no: `MB3B 16E060 CH`, pair_mat_no: null,
  part_name: `ชิ้นงานทดสอบ ${i}`, product_id: `p-${i}`, customer: 'FORD', model: 'P703',
  machine_no: `SP-${10+i}`, machine_name: `ROBOT HANDLING ${i}`, equipment_id: `e-${i}`,
  status: 'open', shift: 'day', work_date: '2026-08-04', session_id: `s-${i}`,
  qty: 120+i, qty_ng: i, qty_ok: 118+i, qty_suspect: 0, qty_actual: 118+i, qty_target: 130,
  duration_min: 12+i, cycle_time_sec: 58, oee: 82.5, oee_a: 91, oee_p: 93, oee_q: 98,
  employee_id: `emp-${i}`, employee_id_code: `6${1000+i}`, is_present: true, team: 'A',
  description: 'รายละเอียดเหตุการณ์ที่พนักงานกรอกไว้ ยาวประมาณนี้ครับ',
  category: 'unplanned', image_url: '', is_active: true,
  created_at: '2026-08-04T01:00:00+07:00', started_at: '2026-08-04T01:00:00+07:00',
  ended_at: '2026-08-04T01:30:00+07:00', checklist_id: `c-${i}`,
  full_name: `นายทดสอบ ระบบ ${i}`, position: 'operator', role: 'leader', email: `u${i}@x.co`,
  title: `หัวข้อทดสอบ ${i}`, label: `ป้าย ${i}`, note: 'หมายเหตุ', remark: 'หมายเหตุ',
  dr_downtime_types: { name_th: 'เครื่องเสีย', category: 'unplanned' },
  dr_defect_types: { name_th: 'งานเป็นครีบ' },
  dr_products: { mat_no: `1010${1000+i}`, part_name: `ชิ้นงาน ${i}`, cycle_time_sec: 58 },
  employees: { name: `นายทดสอบ ${i}`, employee_id_code: `6${1000+i}`, image_url: '', team: 'A' },
  production_sessions: { line_name: 'LINE APRON ASSY', work_date: '2026-08-04', shift: 'day' },
})
const ROWS = Array.from({ length: 14 }, (_, i) => ROW(i + 1))

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
