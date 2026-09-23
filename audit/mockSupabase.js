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

/* ⚠️ **งานคู่ RH/LH (pair_mat_no) ต้องมีใน mock เสมอ ห้ามถอด** (2026-09-22)
   ของจริงมีคู่ที่ demand ครบทั้ง 2 ข้างอยู่หลายคู่ (20059957↔20059959 · 20065635↔20065715 …)
   และมีกฎเหล็ก "ชิ้น ≠ shot" ที่โค้ดหลายจุดต้องยุบคู่ก่อนรวม — `collapsePairShots` (OEE/%P) ·
   `pairLoadTotal` (ภาระกะในแผนผลิต) · `pairAwareTotal` (ยอดรวมภาพใหญ่)
   เดิม mock ตั้ง `pair_mat_no: null` **ทุกแถว** ⇒ crashsweep ไม่เคยเดินเข้าสาขา "มีคู่" เลยสักหน้า
   = บั๊กทั้งคลาส (นับ 2 เท่า · ยุบผิดข้าง · คู่ที่มีข้างเดียวในชุดข้อมูล) มองไม่เห็นจาก harness
   ตั้งเป็นคู่กัน 2 ทางที่แถว 6↔7 (ต้องครบทั้ง 2 ทางเหมือนของจริง ไม่งั้นจับคู่ไม่ติด)  */
const PAIR_OF = { 6: 7, 7: 6 }

/* แถวปลอม 1 ชุด ครอบคอลัมน์ที่ใช้บ่อยที่สุดในโปรเจค — ให้ตาราง/ลิสต์ render ของจริงออกมาวัดได้ */
const ROW = (i) => ({
  id: `id-${i}`, name: LINE_NAME(i), code: `CODE-${i}`,
  line_name: 'LINE APRON ASSY / HYDROFORM',
  parent_line_name: PARENT_OF[i] ? LINE_NAME(PARENT_OF[i]) : null, section: 'PD1', line_id: 1,
  mat_no: `1010${1000+i}`, p_no: `MB3B 16E060 CH`, pair_mat_no: PAIR_OF[i] ? `1010${1000 + PAIR_OF[i]}` : null,
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
/* รูปผังโรงงานปลอม — SVG data URI 1600×900 (ไม่ต้องต่อเน็ต · <img> เรนเดอร์ได้จริง
   ต้องมีขนาดจริงในไฟล์ ไม่งั้น onImgLoad ได้ naturalWidth = 0 แล้วสเกลป้ายเพี้ยน) */
const FACTORY_MAP_IMG = 'data:image/svg+xml;utf8,'
  + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900">'
    + '<rect width="1600" height="900" fill="#1f2937"/>'
    + '<rect x="60" y="60" width="1480" height="780" fill="none" stroke="#475569" stroke-width="6"/></svg>')
const isNullish = (r) => r.qty === null
const TABLE_ROWS = {
  /* org_nodes: ผังองค์กรทรงจริง (2026-09-23 — picker ขอบเขต `orgScope.js` ต้องได้ต้นไม้ครบชั้น ไม่งั้นสาขา
     แผนก/ฝ่าย/กลุ่มไลน์ ไม่เคยถูกรันใน harness): 1 = ส่วนงาน PD1 · 2 = แผนกใต้ PD1 · 3-5 = ไลน์ในแผนก
     (ref_line_id ชี้ production_lines mock ที่ id เป็น 'id-N') · 6 = แผนกขึ้นตรงฝ่ายช่าง (ไม่มีไลน์) ·
     7 = org line node ไม่ผูก production line (สโตร์) · ที่เหลือ = ทีม · แถว NULLISH ยังคงว่างตามกติกา */
  org_nodes: (r, i) => ({
    ...r,
    kind: i === 1 ? 'section' : (i === 2 || i === 6) ? 'department' : i <= 5 || i === 7 ? 'line' : 'team',
    code: i === 1 ? 'PD1' : i <= 5 || i === 7 ? null : r.code,
    parent_id: i === 1 || i === 6 ? null : i === 2 ? 'id-1' : i <= 5 ? 'id-2' : i === 7 ? 'id-6' : 'id-3',
    ref_line_id: i >= 3 && i <= 5 ? `id-${i}` : null,
    division: i === 1 ? 'production' : i === 6 ? 'maintenance' : null,
    cost_center: isNullish(r) ? null : `21406${String(i).padStart(5, '0')}`,
    sort_order: i,
  }),
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
  /* 🏭 production_sessions — กะต้องผูกกับ **ไลน์ที่มีอยู่จริงใน production_lines** (2026-09-22)
     เดิมทุกแถวเป็น `line_name: FAM_LINE` ซึ่งไม่ตรงกับ `LINE_NAME(i)` ของ production_lines เลย
     ⇒ ทุกหน้าที่ถามว่า "ไลน์นี้เปิดกะหรือยัง" ได้คำตอบว่า "ยังไม่เปิด" ทุกไลน์เสมอ
        (FactoryMap: ทุกกรอบเป็นสีเทา idle · แผงขวาทุกโหมดว่าง · ยอดผลิต/OEE/DT/NG = 0)
     = สาขา "มีกะเปิดอยู่" ซึ่งเป็นสถานะปกติของวันทำงาน ไม่เคยถูกรันใน harness เลย
     · กระจายลง 4 ไลน์แรก (มีทั้งแม่ 1 · ลูก 2,3 · หลาน 4) ⇒ ได้เคส rollup แม่-ลูกจริงด้วย
     · แถว 13-14 คงเป็น FAM_LINE ไว้ = เคส "กะของไลน์ที่ไม่มีในทะเบียน" ที่ของจริงก็มี (ชื่อไลน์เก่า) */
  production_sessions: (r, i) => ({ ...r, line_name: i <= 12 ? LINE_NAME(((i - 1) % 4) + 1) : FAM_LINE }),
  /* 🗺️ factory_map / factory_line_regions — **ต้องมีเสมอ ห้ามถอด** (2026-09-22)
     `/factory-map` เช็ค `if (!imageUrl) return <ยังไม่มีรูปผังโรงงาน>` ก่อนวาดอะไรทั้งนั้น
     ⇒ mock เดิมคืน `image_url: ''` (falsy) ⇒ **ทั้งหน้าไม่เคยเรนเดอร์อะไรเลยนอกจากข้อความว่าง**
        ทั้งผัง polygon · ป้าย/การ์ด KPI · de-overlap ป้าย · แผงขวาทุกโหมด (ทบทวนรายวัน /
        บอร์ด OBEYA / จัดอันดับ) — crashsweep + mobilesweep ผ่านหน้านี้มาตลอดโดยไม่เคยแตะโค้ดพวกนี้
     · รูป = data URI (ออฟไลน์ ไม่ต้องต่อเน็ต) ขนาด 1600×900 ให้ aspect ใกล้ผังจริง
     · กรอบ: 2 ไลน์ผลิต (แม่ 1 + ลูก 1) + 1 โซนสนับสนุนที่ไม่ใช่ไลน์ผลิต (isFac = true)
       ⇒ ได้ทั้งสาขา "ไลน์" และ "โซน facility" ที่คิดสถานะคนละชุด */

  v_demand_flow_blocks: (r, i) => ({
    ...r, maker_line: FAM_LINE, pending_qty: isNullish(r) ? null : 500 + i,
    block_reason: i % 2 ? 'no_lot_size' : 'backlog_capped', suggested_lot: isNullish(r) ? null : 200,
  }),
}
/* ── ตารางที่ต้องคืน "ชุดแถวของตัวเอง" ไม่ใช่ ROWS แปลงร่าง ──────────────────────────
   TABLE_ROWS ข้างบนคือ "แปลง ROWS ทีละแถว" (1 แถวเข้า → 1 แถวออก) ⇒ ตารางที่มีรูปทรงคนละเรื่อง
   กับ ROWS ต้องมาอยู่ที่นี่แทน **ห้ามเขียน `() => [...]` ใน TABLE_ROWS** (เคยพลาดมาแล้ว 22/09:
   mapper คืนอาร์เรย์ต่อ 1 แถว ⇒ ได้อาร์เรย์ซ้อน 14 ชั้น → `r.line_name` undefined → หน้าพังเงียบ) */
const TABLE_FIXED = {
  /* 🎯 ทะเบียน KPI มาตรฐานของกลุ่ม — **ห้ามถอด** (2026-09-23)
     โมดัล `KpiStandardPicker` แตกแขนงตามค่า `requirement` 3 แบบ ซึ่ง ROWS ทั่วไปไม่มีให้เลย
     ⇒ ถ้าไม่มีชุดนี้ harness จะไม่เคยรันโค้ดสายนี้สักบรรทัด:
       · `requirement: null` = **แถวหัวข้อแม่** (ไม่ใช่ KPI · ห้ามมี checkbox ห้ามนับน้ำหนัก)
       · `fixed` = ติ๊กมาให้ · `choice` = ให้คนติ๊กเอง
     · `seq` ซ้ำกันได้จริง (ต้นฉบับ Production พิมพ์ '6' ซ้ำ 2 แถว) ⇒ ใส่ไว้ให้ชนกันจริง
       เพื่อพิสูจน์ว่าจอเรียงด้วย `sort_order` ไม่ใช่ `seq`
     · ต้องมีอย่างน้อย 2 std_unit เพื่อให้ dropdown เลือกหน่วยงานมีของให้สลับ */
  kpi_standard_items: [
    { id: 'std-1', year: 2026, std_unit: 'Production', seq: '1', sort_order: 1, perspective: 'financial', topic: 'Raw Material Control', formula_text: '(Raw Material/Sales from product) x 100', requirement: 'fixed', catalog_id: null, note: null },
    { id: 'std-2', year: 2026, std_unit: 'Production', seq: '6', sort_order: 2, perspective: 'internal', topic: 'Cost Reduction', formula_text: 'Reduce X% from last year or Value', requirement: 'choice', catalog_id: null, note: null },
    { id: 'std-3', year: 2026, std_unit: 'Production', seq: '6', sort_order: 3, perspective: 'internal', topic: 'Internal Quality Rate', formula_text: '(Defect/Total Production) x 1,000,000', requirement: 'fixed', catalog_id: null, note: null },
    { id: 'std-4', year: 2026, std_unit: 'Production', seq: '11', sort_order: 4, perspective: 'learning', topic: 'Activity', formula_text: 'Number of Passed Activity', requirement: null, catalog_id: null, note: null },
    { id: 'std-5', year: 2026, std_unit: 'Production', seq: '11.1', sort_order: 5, perspective: 'learning', topic: 'QCC', formula_text: '*Refer to activity announcement', requirement: 'fixed', catalog_id: null, note: null },
    { id: 'std-6', year: 2026, std_unit: 'QA', seq: '1', sort_order: 1, perspective: 'customer', topic: 'Customer Claim', formula_text: '(Claim qty/Delivery qty) x 1,000,000', requirement: 'fixed', catalog_id: null, note: null },
  ],
  /* นิยาม KPI — **ต้องมีทั้งแถว `manual` และ `auto:` เสมอ ห้ามถอด** (2026-09-23)
     `source` เป็น `not null default 'manual'` ⇒ แถวกรอกมือ**ไม่ใช่ null** · เคยเข้าใจผิดจนเกิดบั๊ก
     2 จุด (ตารางกรอกมือว่างตลอดกาล + แผง Key Performance ดูดแถว auto มาโชว์ว่า "ยังไม่กรอกค่า")
     ⇒ ไม่มีแถว auto ในม็อก = ตัวกรองที่แก้บั๊กนั้นไม่เคยถูกรันใน harness */
  kpi_definitions: [
    { id: 'kd-1', year: 2026, section: 'PD3', line_group: null, category: 'financial', seq: 1, name: 'Raw Material Control', source: 'manual', target_value: 95, direction: 'up', weight: 5, is_active: true, catalog_id: 'kc-1', std_unit: 'Production', std_item_id: 'std-1', kpi_catalog: { id: 'kc-1', name: 'Raw Material Control', unit: '%', category: 'financial', direction: 'up', decimals: 2 } },
    { id: 'kd-2', year: 2026, section: 'PD3', line_group: null, category: 'internal', seq: 2, name: 'Internal Quality Rate', source: 'manual', target_value: null, direction: null, weight: null, is_active: true, catalog_id: 'kc-2', std_unit: 'Production', std_item_id: 'std-3', kpi_catalog: { id: 'kc-2', name: 'Internal Quality Rate', unit: 'PPM', category: 'internal', direction: 'down', decimals: 0 } },
    { id: 'kd-3', year: 2026, section: 'PD3', line_group: null, category: 'internal', seq: 3, name: 'PPM ของเสียภายใน', source: 'auto:ppm', target_value: 500, direction: 'down', weight: 4, is_active: true, catalog_id: null, std_unit: null, std_item_id: null, kpi_catalog: null },
  ],
  factory_map: [{ id: 'fm-1', image_url: FACTORY_MAP_IMG, updated_at: '2026-09-01T00:00:00+07:00' }],
  factory_line_regions: [
    { id: 'rg-1', line_name: LINE_NAME(1), points: [[6, 8], [44, 8], [44, 46], [6, 46]] },
    { id: 'rg-2', line_name: LINE_NAME(2), points: [[54, 8], [92, 8], [92, 46], [54, 46]] },
    { id: 'rg-3', line_name: 'ห้องคอมเพรสเซอร์', points: [[6, 56], [44, 56], [44, 92], [6, 92]] },
  ],
}
const rowsFor = (table) => {
  if (TABLE_FIXED[table]) return TABLE_FIXED[table]
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
/* ⚠️ ชุดนี้ต้องมีครบทุก "เคสที่แท็บ 🩺 ตรวจสุขภาพ มีสาขาแยก" ไม่งั้นสาขานั้นไม่เคยถูกเรนเดอร์:
     วิว (ไม่ฟ้อง PK/RLS) · ตารางสำรองค้าง public · RLS ปิด · ไม่มี PK · ไม่มีใครใช้ · ตารางว่าง */
const SCHEMA_TABLES = [
  { t: 'employees', k: 'r', cols: 12, rows: 308, bytes: 311296, rls: true, pk: ['id'], note: null },
  { t: 'four_m_logs', k: 'r', cols: 18, rows: 1240, bytes: 696320, rls: true, pk: ['id'], note: 'บันทึกการเปลี่ยนแปลง 4M' },
  { t: 'line_stock_summary', k: 'v', cols: 4, rows: 0, bytes: 0, rls: false, pk: [], note: null },
  { t: 'production_lines', k: 'r', cols: 11, rows: 31, bytes: 81920, rls: true, pk: ['id'], note: null },
  { t: 'jigs_bak_test1_20260909', k: 'r', cols: 22, rows: 0, bytes: 16384, rls: false, pk: [], note: null },
  { t: 'legacy_no_pk', k: 'r', cols: 3, rows: 958, bytes: 65536, rls: false, pk: [], note: null },
]
const SCHEMA_FKS = [
  { name: 'four_m_logs_line_id_fkey', t: 'four_m_logs', c: ['line_id'], rt: 'production_lines', rc: ['id'], del: 'a' },
  { name: 'four_m_logs_created_by_fkey', t: 'four_m_logs', c: ['created_by'], rt: 'auth.users', rc: ['id'], del: 'a' },
]
/* ── 🏛️ OBEYA โหมดปี (2026-09-22): RPC คืน "ผลรวมรายเดือน" (ดู src/utils/obeyaYear.js) ────────
   ต้องมี: เดือนที่มีข้อมูล · เดือนว่าง (ไม่มีแถว) · แถว NULLISH (wprod/q_w = null) · ไลน์ที่ไม่มีใน production_lines ·
   downtime ทั้ง planned/unplanned · defect ที่มี mat ไม่รู้ต้นทุน · เช็คชื่อที่ line เป็น id จุดงาน (ของจริงเป็น uuid) */
const OBEYA_YEAR = () => ({
  from: '2026-01-01', to: '2026-09-22',
  sessions: [
    /* แถวของไลน์ที่มีจริงใน production_lines ของ mock — บอร์ด KPI กรองตาม "กลุ่มไลน์" ไม่งั้นแผ่น OEE/PPM ว่างใน harness ตลอด */
    { m: '2026-01', line: LINE_NAME(1), n: 30, wload: 15000, oee_w: 1275000, a_wload: 15000, a_w: 1350000, wrun: 13500, p_w: 1215000, wprod: 3000, q_w: 297000, qty: 2970, ng: 30 },
    { m: '2026-03', line: LINE_NAME(1), n: 28, wload: 14000, oee_w: 980000, a_wload: 14000, a_w: 1190000, wrun: 11900, p_w: 952000, wprod: 2800, q_w: 274400, qty: 2790, ng: 10 },
    { m: '2026-09', line: LINE_NAME(1), n: 12, wload: 6000, oee_w: 480000, a_wload: 6000, a_w: 540000, wrun: 5400, p_w: 486000, wprod: 1200, q_w: 118800, qty: 1195, ng: 5 },
    { m: '2026-01', line: 'LINE 060', n: 40, wload: 20000, oee_w: 1600000, a_wload: 20000, a_w: 1800000, wrun: 18000, p_w: 1620000, wprod: 4000, q_w: 396000, qty: 3960, ng: 40 },
    { m: '2026-02', line: 'LINE 060', n: 38, wload: 19000, oee_w: 1330000, a_wload: 19000, a_w: 1615000, wrun: 16150, p_w: 1291000, wprod: 3800, q_w: 372400, qty: 3780, ng: 20 },
    { m: '2026-03', line: 'LINE 061', n: 20, wload: 10000, oee_w: 850000, a_wload: 10000, a_w: 920000, wrun: 9200, p_w: 828000, wprod: null, q_w: null, qty: 0, ng: 0 },
    { m: '2026-05', line: 'ไลน์ที่ไม่มีในทะเบียน', n: 3, wload: 1500, oee_w: 90000, a_wload: 1500, a_w: 120000, wrun: 1200, p_w: 96000, wprod: 300, q_w: 29700, qty: 297, ng: 3 },
  ],
  downtime: [
    { m: '2026-01', line: 'LINE 060', type: 'Robot (Alarm/Error)', category: 'unplanned', min: 300 },
    { m: '2026-01', line: 'LINE 060', type: 'พักเที่ยง', category: 'planned', min: 2000 },
    { m: '2026-02', line: 'LINE 060', type: 'รอวัตถุดิบ', category: 'unplanned', min: 120 },
    { m: '2026-03', line: 'LINE 061', type: null, category: '', min: 45 },
  ],
  defects: [
    { m: '2026-01', line: LINE_NAME(1), mat: '90031601', rows: 4, ng: 30, trial_ng: 10 },
    { m: '2026-09', line: LINE_NAME(1), mat: '90031601', rows: 1, ng: 5, trial_ng: null },
    { m: '2026-01', line: 'LINE 060', mat: '90031601', rows: 6, ng: 40, trial_ng: 5 },
    { m: '2026-02', line: 'LINE 060', mat: 'MAT-ไม่มีต้นทุน', rows: 2, ng: 20, trial_ng: null },
  ],
  orders: [
    { m: '2026-01', line: 'LINE 060', status: 'confirmed', n: 30, qty: 4000, qty_ok_fb: 3960, qty_actual: 0 },
    { m: '2026-02', line: 'LINE 060', status: 'carry_over', n: 2, qty: 200, qty_ok_fb: 200, qty_actual: 150 },
    { m: '2026-02', line: 'LINE 060', status: 'open', n: 1, qty: 100, qty_ok_fb: 100, qty_actual: 0 },
  ],
})
const OBEYA_ATTEND = () => ([
  { m: '2026-01', line: 'ws-1', n: 400, present: 380, ppe_ok: 350, ot: 20 },
  { m: '2026-02', line: 'ws-1', n: 380, present: 300, ppe_ok: 100, ot: 0 },
  { m: '2026-03', line: null, n: 50, present: 50, ppe_ok: 50, ot: 5 },
  { m: '2026-04', line: 'ws-ไม่รู้จัก', n: 10, present: null, ppe_ok: null, ot: null },
])
const RPC_RESULT = {
  obeya_year_rollup: OBEYA_YEAR,
  obeya_attendance_rollup: OBEYA_ATTEND,
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
