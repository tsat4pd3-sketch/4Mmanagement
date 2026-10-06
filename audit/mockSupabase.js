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

/* ⚠️ **รอบ PM ต้องมีใน mock เสมอ ห้ามถอด** (2026-10-06)
   เดิม `ROW()` **ไม่มี `frequency`/`interval_days`/`cycle_basis` เลยสักคอลัมน์** ⇒ ทุกแผนใน harness
   ตกเป็น "ยังไม่ตั้งรอบ PM" (`periodic`) ทั้ง 14 แถว ⇒ สายที่ **มีรอบจริง** ไม่เคยถูกรันเลย:
   `computeNextDue`/`dueStatus`/`statusForDays` (เกินกำหนด/ใกล้ครบ/ตามกำหนด) · การ์ดสรุปสถานะ ·
   บาร์นับถอยหลังในมุมมอง Timeline · และ (ตั้งแต่ 02/10) **ทั้งคลาสของ `cycle_basis='run_day'`**
   — `resolveRunDayDue` · สถานะ `idle_skip` · `<RunDayCell>` · แถบสรุป "นับรอบจากวันเดินเครื่อง"
   ⇒ crashsweep ผ่านเขียวทั้งที่โค้ดครึ่งหน้าไม่เคยถูกเรียก (คลาสเดียวกับ pair_mat_no/ไลน์แม่-ลูก)
   โครงที่ใส่ = คละ 3 แบบให้ทุกสาขาถูกวาดจริง:
     · แถว 2,3 = `run_day` (2 = ไลน์เดินวันนี้ → ถึงรอบ · 3 = ไลน์ไม่เดิน → `idle_skip` เทา)
     · แถว 5   = ไม่มีรอบ (`periodic`) — เคส "ยังไม่ตั้งรอบ" ต้องไม่หายไป
     · ที่เหลือ = รอบปฏิทินคละ 1/7/30/90 วัน */
const CYCLE_BASIS_OF = { 2: 'run_day', 3: 'run_day' }
const CYCLE_DAYS = [7, 1, 1, 30, null, 90, 7, 30, 1, 180, 7, 365, 30, 90]
const FREQ_OF = { 1: 'daily', 7: 'weekly', 30: 'monthly', 90: 'quarterly' }

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
  /* ⚠️ `checklist_id` ต้องชี้ไปที่ `id` ของแถวจริง (2026-10-06 · คลาสเดียวกับ `session_id` ข้างบน)
     เดิมเป็น `c-${i}` ซึ่ง **ไม่ตรงกับ `id-${i}` เลยสักแถว** ⇒ ทุกหน้าที่จับคู่ checklist → แผน PM
     (`pm_plans`) หรือ → ผลตรวจ (`inspections`) ได้ 0 แถวเสมอ ⇒ ทุกแผนตกเป็น "ยังไม่เคยตรวจ"
     = สาย "มีแผน/เคยตรวจแล้ว" (วันครบกำหนด · เกินกำหนด · health · run_day) ไม่เคยถูกรันใน harness */
  ended_at: '2026-08-04T01:30:00+07:00', checklist_id: `id-${i}`,
  /* รอบ PM — ดูเหตุผลที่บล็อก CYCLE_BASIS_OF ข้างบน (ห้ามถอด) */
  interval_days: CYCLE_DAYS[i % CYCLE_DAYS.length],
  frequency: FREQ_OF[CYCLE_DAYS[i % CYCLE_DAYS.length]] || 'periodic',
  cycle_basis: CYCLE_BASIS_OF[i] || 'calendar',
  max_idle_days: CYCLE_BASIS_OF[i] ? 30 : null,
  plan_type: 'time', next_due_reason: CYCLE_BASIS_OF[i] ? 'run_day' : 'time',
  /* ครบกำหนดคละ: แถวคู่ = เลยกำหนด (แดง) · แถวคี่ = ยังไม่ถึง (เขียว) · run_day = null เสมอ */
  next_due_date: CYCLE_BASIS_OF[i] ? null : (i % 2 ? '2026-12-20' : '2026-09-01'),
  last_done_at: '2026-09-28T01:00:00+07:00',
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
               staff_kind: i % 4 === 3 ? 'support' : 'shopfloor' },
  production_sessions: { line_name: 'LINE APRON ASSY / HYDROFORM', work_date: '2026-08-04', shift: 'day' },
  /* 📄 เอกสารที่ "ออกเลขที่ใบแล้ว" + สายงานถังคุณภาพ (2026-09-25)
     ไม่มีคีย์พวกนี้ = โค้ดทั้งสายไม่เคยถูกรันใน harness เลย:
       · ปุ่มพิมพ์ซ้ำใบรายงานปัญหา + แผงเทียบ snapshot กับข้อมูลปัจจุบัน (prod_problem_reports)
       · คอลัมน์ "ใบรายงานของเสีย" ของถังแดง (quality_bin_records.scrap_report_id)
       · ชิปแนะนำ WI การซ่อม ในโมดัลลงวิธีแก้ไข (repair_wi_registry)
       · ผลพิจารณา QA 4 ทาง + ช่องเลขใบ FM-QA-042 (qa_decision)
     ⚠️ `snapshot` ต้องเป็นโครงจริงที่ `reportFromSnapshot()` อ่านออก (มีคีย์ quality/machine/wait
        และ `checked` เป็น **array** อย่างที่ JSON เก็บได้) — ใส่ {} เปล่าจะได้ null แล้วสายพิมพ์ซ้ำตายเหมือนเดิม */
  doc_no: `PR ${String(i).padStart(4, '0')}/08-26`,
  issued_by: `นายดุลยทรรศน์ ลาภธนสารสมบัติ ${i}`, issued_at: '2026-08-04T11:00:00+07:00',
  reprint_count: i % 3, min_minutes: 30, problem_title: `Feed nut ติด (SP-${10 + i}) 45 นาที`,
  snapshot: {
    v: 1, headline: `Feed nut ติด (SP-${10 + i}) 45 นาที`,
    quality: { checked: ['GAP NG'], details: ['GAP NG 12 ชิ้น'], fixes: [], fixBy: '', pendingFix: 1,
               qty: 12, time: { from: '09:00', to: '10:00' }, by: 'ผู้แจ้ง', count: 1 },
    machine: { checked: ['Jig'], details: ['Jig มีปัญหา 45 นาที'], fixes: ['เปลี่ยนสปริง'], fixBy: 'ช่างเอ', pendingFix: 0,
               time: { from: '09:00', to: '09:45' }, by: 'ผู้แจ้ง', count: 1, minutes: 45 },
    wait: { checked: [], details: [], fixes: [], fixBy: '', pendingFix: 0,
            time: { from: '', to: '' }, by: '', count: 0, minutes: 0 },
    followup: { lines: [], by: '', pending: 1 },
    meta: { minMinutes: 30, skippedShort: 0, hasAny: true, pendingFix: 1 },
  },
  scrap_report_id: i % 2 === 0 ? `id-${i}` : null,   // ครึ่งหนึ่งออกใบแล้ว ครึ่งหนึ่งยังค้าง (ต้องได้ทั้ง 2 สาขา)
  from_yellow_id: null, defect_log_id: `id-${i}`,
  qa_decision: ['good', 'repair', 'use_as_is', 'scrap', null][i % 5],
  special_use_doc_no: i % 5 === 2 ? `QA042-${i}` : null,
  /* ⚠️ `symptom` ต้องเป็นคำที่ **ปรากฏจริงในข้อความของแถวอื่น** (ยืมจาก DEF_NAMES) ไม่งั้น
     `matchRepairWi()` ไม่เคยจับคู่ติดเลยใน harness ⇒ ชิป 📕 WI ซ่อม ไม่เคยถูกเรนเดอร์
     (bug class เดียวกับ session_id ที่เคยชี้ `s-${i}` แล้วทุก join ได้ 0 แถว) */
  symptom: DEF_NAMES[i % DEF_NAMES.length], wi_no: `WI-PD3-0${10 + (i % 80)}`,
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
  /* เอกสาร/ถังคุณภาพ ก็ต้องมีแถว "ไม่ครบ" ด้วย — ใบเก่าที่ออกก่อนมีระบบ snapshot มีจริง
     (snapshot = null ⇒ ปุ่มพิมพ์ซ้ำต้องบอกให้ออกใบใหม่ ไม่ใช่พิมพ์ใบเปล่าเงียบๆ) */
  doc_no: null, snapshot: null, issued_by: null, issued_at: null, reprint_count: 0,
  problem_title: null, min_minutes: null,
  scrap_report_id: null, defect_log_id: null, qa_decision: null, special_use_doc_no: null,
  symptom: null, wi_no: null,
  /* รอบ PM ที่ยังไม่ตั้ง — เคส "แผนไม่มีรอบ" ต้องมีแถวรองรับเสมอ (ห้ามถอด · ดู CYCLE_BASIS_OF) */
  interval_days: null, next_due_date: null, last_done_at: null, max_idle_days: null,
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
    code: i === 1 ? 'PD1' : i <= 5 || i === 7 ? null : i === 6 ? null : r.code,
    name: i === 6 ? 'JIG MTN' : r.name,   // แผนกช่างชื่อจริง — ให้สาย ⚡ KPI ช่าง (kpi_mtn_rollup → kpiAuto) ถูกรันใน harness
    parent_id: i === 1 || i === 6 ? null : i === 2 ? 'id-1' : i <= 5 ? 'id-2' : i === 7 ? 'id-6' : 'id-3',
    ref_line_id: i >= 3 && i <= 5 ? `id-${i}` : null,
    division: i === 1 ? 'production' : i === 6 ? 'maintenance' : null,
    cost_center: isNullish(r) ? null : `21406${String(i).padStart(5, '0')}`,
    sort_order: i,
  }),
  /* 🧑‍🤝‍🧑 Manpower Control Board (2026-10-06) — ผังคนต้องได้ "ตำแหน่ง + หน่วย + ทีม" คละกัน
     ไม่งั้นทุกคนตกแถวพนักงานของ "ไม่ระบุแผนก" แล้วสายหัวผัง/หัวหน้าแผนก/หัวหน้ากลุ่ม/ช่าง/คอลัมน์ทีม
     ไม่เคยถูกรันใน harness · แถว NULLISH ยังว่างตามกติกา (ไม่มีตำแหน่ง/หน่วย = ต้องไม่หายจากบอร์ด) */
  employees: (r, i) => isNullish(r) ? r : ({
    ...r,
    position: ['manager', 'engineer', 'dept_head', 'line_leader', 'line_leader', 'technician'][i - 1] || 'operator',
    team: i === 1 || i === 2 ? 'C' : i % 2 ? 'A' : 'B',
    org_node_id: i <= 2 ? 'id-1' : 'id-2',
    line_id: i <= 2 ? null : 'id-3',
    image_url: i % 4 === 0 ? FACTORY_MAP_IMG : '',
  }),
  // ทะเบียนตำแหน่ง — key จริงตาม seed (positions.js DEFAULT_POSITIONS) ไม่งั้นทุกคนกลายเป็น "ตำแหน่งที่ระบบไม่รู้จัก"
  positions: (r, i) => ({ ...r, ...([
    ['operator', 'พนักงานฝ่ายผลิต', 'operator'], ['technician', 'ช่างเทคนิค', 'technician'], ['engineer', 'วิศวกร', 'engineer'],
    ['line_leader', 'หัวหน้าไลน์', 'leader'], ['dept_head', 'หัวหน้าแผนก', 'supervisor'], ['section_head', 'หัวหน้าส่วน', 'supervisor'],
    ['manager', 'ผู้จัดการฝ่าย', 'manager'], ['officer', 'เจ้าหน้าที่', 'staff'],
  ].map(([key, label_th, level]) => ({ key, label_th, level }))[i - 1] || {}), sort_order: i }),
  /* 🧑‍🤝‍🧑 ค่าตั้งบอร์ด (06/10) — ให้สาย "ช่องที่ตั้งเอง" (มีคน/ไม่มีคน) · ช่างประจำไลน์ · คนในสังกัดไปช่วยไลน์อื่น ถูกรัน
     ทีม D = ตั้งช่องไว้แต่ยังไม่มีใคร ⇒ คอลัมน์ช่องว่างล้วน · line_helpers ชี้ไลน์นอกแผนก (id-9) ⇒ ป้าย "↗ ไปช่วย" */
  manpower_slot_plans: (r, i) => ({ ...r, org_node_id: 'id-2', team: ['A', 'B', 'D'][i % 3], slots: isNullish(r) ? 0 : 6 }),
  // 📍 คนต่อกะของจุดงาน — 1 คน/กะ ทุกจุด (บางจุดตั้ง 2) ⇒ สายช่องว่างระบุจุด + วงประบนผัง LAYOUT ถูกรัน
  station_slot_plans: (r, i) => ({ ...r, station_id: `id-${i}`, per_shift: i % 5 === 0 ? 2 : 1 }),
  line_technicians: (r, i) => ({ ...r, employee_id: `id-${i}`, line_id: 'id-3' }),
  line_helpers: (r, i) => ({ ...r, employee_id: `id-${(i % 4) + 7}`, to_line_id: 'id-9', shift: i % 2 ? 'day' : 'night' }),
  /* จุดงาน + จุดประจำ + รูปผัง — ให้สาย "รูปคนบนผัง LAYOUT" ถูกรัน (เดิมไม่มีพิกัด = ไม่มีจุดถูกวาด) */
  workstations: (r, i) => ({ ...r, station_name: `ST-${i} SPOT WELD`, line_id: 'id-3', line_name: LINE_NAME(3),
    pos_top: isNullish(r) ? null : String(15 + (i * 5) % 70), pos_left: isNullish(r) ? null : String(8 + (i * 7) % 84) }),
  employee_home_positions: (r, i) => ({ ...r, employee_id: `id-${i}`, station_id: `id-${(i % 7) + 1}` }),
  line_layouts: (r, i) => ({ ...r, line_id: `id-${i}`, line_name: LINE_NAME(i), image_url: FACTORY_MAP_IMG }),
  /* คิวรับเข้าคลัง (2026-10-02) — คละ รอรับ/ค้างเกินกำหนด/รับแล้ว(ยอดไม่ตรง) ให้ทุกโซนของ StockReceiptQueue ถูกรัน */
  stock_receipts: (r, i) => ({
    ...r, prod_order_id: `po-${i}`, prod_no: `01203${90000 + i}`, mat_no: i % 2 ? '30047001' : '20057003',
    qty_expected: isNullish(r) ? 10 : 60, dest_line_name: i % 2 ? 'FG WAREHOUSE' : 'STORE', source_line: FAM_LINE,
    status: i % 4 === 0 ? 'received' : 'pending',
    created_at: new Date(Date.now() - (i % 3 === 0 ? 6 : 0.5) * 3600e3).toISOString(),
    qty_received: i % 4 === 0 ? 55 : null, diff_reason: i % 4 === 0 ? 'ของเสีย 5' : null,
    received_by: i % 4 === 0 ? 'สมชาย ใจดี' : null, received_at: i % 4 === 0 ? new Date().toISOString() : null,
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
  /* 🔩 parts_master — ทะเบียน**พาร์ทลูก** (2xx/3xx ชิ้นส่วน · 5xx วัตถุดิบ) คนละตารางกับ
     `dr_products` (2026-09-30) · ไม่มีคีย์นี้ = `from('parts_master')` ตกไปใช้ ROWS กลาง
     ซึ่งมี `p_no` แต่ **ไม่มี `part_no`** ⇒ `useChildParts()` ได้ Part No. ว่างทุกแถว
     ⇒ **หัวการ์ดทั้งโมดูลสโตร์ (`<PartCard>`/`<MatLabel>`) ไม่เคยมี Part No. ให้เรนเดอร์เลย**
        = สาขา "เรียง Part No. → ชื่อ → MAT" มองไม่เห็นจาก crashsweep/mobilesweep
     🔴 **แถว i%3===2 ต้องเป็นวัตถุดิบ 5xx ที่ part_no เป็น "คำบรรยาย" ห้ามถอด** — วัดทะเบียนจริง
        30/09: 5xx มี part_no หน้าตาเป็นเลขพาร์ทแค่ 18% (ที่เหลือคือประโยคว่าเอาไปทำงานอะไร
        ยาวสุด 72 ตัว มีภาษาไทยปน) ⇒ ถ้า mock มีแต่เลขพาร์ทสวยๆ สาขา `lead === 'name'`
        + การ clamp บรรทัดรอง จะไม่เคยถูกรัน แล้วบั๊ก "พาดหัวด้วยประโยคจนเลขหลุดจอ"
        กลับมาได้เงียบๆ (UI §6.21) · แถว NULLISH ยังต้องว่างตามกติกา = สาขา lead='mat' */
  parts_master: (r, i) => isNullish(r)
    ? { ...r, part_name: null, part_no: null }
    : i % 3 === 2
      ? { ...r, mat_no: `5002${6000 + i}`, part_name: `WSS-M1A367-A36 1.5X${270 + i}XC`,
          part_no: `R_BMPR SUPPORT BRKT LH/RH (N1WB-17E850-R_PIA-07/0${i % 9})1 : 2 Co(1FGใช้2ชิ้น)` }
      : { ...r, mat_no: `${i % 3 === 1 ? '3004' : '2005'}${7000 + i}`,
          part_name: `ชิ้นส่วน ${i}`, part_no: `W5207${20 + i}-S300` },
  dr_products: (r, i) => {
    /* 🔴 `line_name` ต้องเป็นชื่อที่**มีอยู่จริงในทะเบียนไลน์ของ mock** (`LINE_NAME(i)`) — 06/10
       เดิมตั้งเป็น 'LINE C ( 200&250 Ton )' / 'LINE APRON ASSY / HYDROFORM' ซึ่ง**ไม่มีในทะเบียน**
       ⇒ `lineOfMat()` คืน null ทุกพาร์ท ⇒ **การ์ดไลน์ของ /production-plan (รายวัน+รายเดือน)
          ไม่เคยถูกเรนเดอร์ใน harness เลยสักครั้ง** (กราฟภาระ/ปฏิทิน/ตารางเดือน ไม่เคยถูกตรวจ)
       · ยังคงเจตนาเดิมไว้: i<=2 อยู่**คนละไลน์**กับที่เหลือ (ต้องมีมากกว่า 1 ไลน์ถึงจะเห็น
         ว่าโค้ดแยกการ์ดตามไลน์ถูกต้อง) แค่เปลี่ยนเป็นชื่อที่ทะเบียนรู้จัก */
    const base = { ...r, line_name: i <= 2 ? LINE_NAME(2) : LINE_NAME(1) };
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
  /* 🔴 **ใบ 13-14 ต้องเป็น `open` ที่เลยกำหนด ห้ามเปลี่ยนเป็น confirmed** (2026-09-30)
        เดิมทุกใบเป็น `confirmed` ⇒ บอร์ดไทม์ไลน์ไม่มี "ใบค้าง" เลยแม้ใบเดียว
        ⇒ โค้ดทั้งคลาสที่ดูแลเรื่องดีเลย์ **ไม่เคยถูกรันใน harness**: คิวถูกดันด้วย `occupiedEndMs` ·
           หางแดง · `delayedCountOf` · `projectedFinishMs` · แถบ "หลุดแผนไปแค่ไหน" (`planStatusOf`
           + `<PlanSlipBar>`) — ซึ่งเป็นสถานะที่หน้างานเจอทุกวัน
        · คุมไว้ 2 ใบจากกลุ่มหลัง (i>10) เพื่อ **ไม่แตะเกณฑ์ตัวอย่างของกลุ่มแรก** (10 ใบ ยังถึงเกณฑ์)
        · `qty_actual` เดินไปครึ่งทาง = ได้เคส "ทำอยู่แต่ยังไม่ปิด" ไม่ใช่ "เปิดแล้วไม่แตะเลย" */
  prod_orders: (r, i) => ({
    ...r, mat_no: i <= 10 ? '10101001' : '10101002',
    /* 🔴 **ใบ 2 ต้องเป็น "ปิดช้า" ห้ามแก้ให้ปิดตรงเวลา** (2026-09-30)
          ปิดจริง 18:30 ทั้งที่ตามคิวควรจบ ~15:22 (ใบละ 120 ชิ้น × CT 58 วิ ต่อกันมาจาก 09:00)
          ⇒ เปิดโค้ดสาย `isLateDone`: หางส้ม · คิวถูกดันด้วย `confirmed_at` · **แท่งล้นกรอบแผน**
             ซึ่งเป็นภาพที่ทีมปั๊มขอ ("วาดกรอบเวลาไว้ แล้วเห็นว่าหลุดจากตัวไหน")
          เดิมทุกใบปิดก่อนกรอบ ⇒ สายนี้ไม่เคยถูกวาดใน harness เลย */
    ...(i >= 13
      ? { status: 'open', confirmed_at: null, qty_ok: null, qty_actual: Math.round((120 + i) * 0.4) }
      : i === 2
        ? { status: 'confirmed', confirmed_at: '2026-08-04T18:30:00+07:00' }
        : { status: 'confirmed' }),
  }),
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
/* วันงานสัมพัทธ์สำหรับ mock ที่ต้อง "ชนวันนี้" จริงๆ — บอร์ดที่ใช้วันที่ตายตัวจะไม่มีคอลัมน์
   "📍 วันนี้" ให้ harness รันเลยสักครั้ง (เพิ่ม 06/10) · ใช้เฉพาะบอร์ด FG ซึ่งตัวเลขมาจาก
   `customer_shipping_orders` ไม่ได้ผูกกับ `monitor_cells` ⇒ เลื่อนวันแล้วไม่มีอะไรหลุด */
const MOCK_DAY = (n) => {
  const d = new Date(Date.now() + 7 * 3600e3)   // เวลาไทยจาก epoch — ห้ามพึ่ง timezone เครื่อง
  if (d.getUTCHours() < 8) d.setUTCDate(d.getUTCDate() - 1)   // ก่อน 08:00 = วันงานก่อนหน้า
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

const TABLE_FIXED = {
  /* 📦 ออเดอร์ลูกค้าจาก EDI 862/830 — **ห้ามถอด** (2026-10-06)
     เป็นแหล่งเดียวของแถว ORDER บนบอร์ด FG และของตัวสร้างบอร์ด `MonitorFgSync`
     🔴 ต้องมีครบ 3 เคสที่ของจริงมี ไม่งั้นสาขาเหล่านี้ไม่เคยถูกรัน:
       · `cancelled` = ต้องถูกกันออก (`DEMAND_SKIP_STATUS`) — ใส่ยอดโต 99,999 ให้เห็นทันทีถ้าหลุด
       · `shipped`   = ส่งแล้วแต่**ยังนับ** (ของออกไปแล้วต้องหายจากสต๊อก)
       · `customer: null` = ผูกบอร์ดไม่ได้ ⇒ ตัวสร้างต้องนับแล้วเขียนบนจอ ห้ามทิ้งเงียบ
     · 2 แถวแรกเป็น mat เดียวกันคนละวัน — พิสูจน์ว่า `sumByMatDate` แยกวันจริง */
  customer_shipping_orders: [
    { id: 'cso-1', customer: 'GRBNA', mat_no: '10101001', part_name: 'BRACKET;SHOCK ABS 4X4,LH',
      customer_part_no: 'GR-8841', qty: 1200, due_date: MOCK_DAY(0), status: 'pending' },
    { id: 'cso-2', customer: 'GRBNA', mat_no: '10101001', part_name: 'BRACKET;SHOCK ABS 4X4,LH',
      customer_part_no: 'GR-8841', qty: 800, due_date: MOCK_DAY(1), status: 'shipped' },
    { id: 'cso-3', customer: 'GRBNA', mat_no: '10105763', part_name: 'MBR-SIDE MID INR LH',
      customer_part_no: null, qty: 300, due_date: MOCK_DAY(1), status: 'pending' },
    { id: 'cso-4', customer: 'GRBNA', mat_no: '10101001', part_name: 'BRACKET;SHOCK ABS 4X4,LH',
      customer_part_no: 'GR-8841', qty: 99999, due_date: MOCK_DAY(2), status: 'cancelled' },
    { id: 'cso-5', customer: 'GBL9A', mat_no: '10076603', part_name: 'BRACKET;SHOCK ABS 4X4 (STEP 1)',
      customer_part_no: 'BL-2210', qty: 500, due_date: MOCK_DAY(1), status: 'pending' },
    { id: 'cso-6', customer: null, mat_no: '10088639', part_name: 'ไม่ระบุลูกค้า',
      customer_part_no: null, qty: 60, due_date: MOCK_DAY(1), status: 'pending' },
  ],

  /* 🎓 ทะเบียนเกรดตามผังองค์กรทางการ — **ห้ามถอด** (2026-09-24)
     ช่อง "เกรด" ใน /operator จะไม่เรนเดอร์เลยถ้าทะเบียนว่าง (`gradesSync().length === 0`)
     ⇒ ไม่มีชุดนี้ = harness ไม่เคยรันโค้ดสายเกรด/คำเตือน "เกรดไม่ตรงตำแหน่ง" สักบรรทัด
     · ต้องมีทั้งเคส **ตรงตำแหน่ง** และ **ไม่ตรง** ให้ใช้ได้จริง
     · ต้องมี `T3` กับ `T6` คู่กันเสมอ — เป็นคู่ที่พิสูจน์กฎ "เลขน้อย = สูงกว่า"
       (เทียบสตริงจะได้ผลกลับหัว) */
  grades: [
    { code: 'M1', band: 'M', rank: 730, label_th: 'ผู้จัดการ / ผู้ชำนาญการ', is_active: true, sort_order: 40 },
    { code: 'S1', band: 'S', rank: 630, label_th: 'หัวหน้าส่วน · วิศวกรอาวุโส', is_active: true, sort_order: 50 },
    { code: 'S3', band: 'S', rank: 610, label_th: 'หัวหน้าแผนก · วิศวกร', is_active: true, sort_order: 52 },
    { code: 'T3', band: 'T', rank: 510, label_th: 'หัวหน้ากลุ่ม · ช่างเทคนิค', is_active: true, sort_order: 62 },
    { code: 'T6', band: 'T', rank: 430, label_th: 'พนักงานทั่วไป', is_active: true, sort_order: 70 },
    { code: 'Y1', band: 'Y', rank: 300, label_th: 'พนักงานชั่วคราว', is_active: true, sort_order: 80 },
  ],

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
  /* 🔴 ห้ามถอด/ห้ามเปลี่ยน `scope_kind` ของ 3 แถวนี้ (24/09)
     ตั้งแต่ย้ายมาใช้แกน `scope_kind/scope_value` (23/09) แถวที่ผูกไว้กับ `section: 'PD3'` เฉยๆ
     **ตกตัวกรอง `scopeCovers` ของทุกขอบเขต** ⇒ ตาราง "KPI นอกระบบ (กรอกมือ)" ว่างตลอดใน harness
     = โค้ดสายกรอกมือทั้งหมด (สรุปรายปีตามวิธีรวม · ทศนิยม · โมดัลนิยาม) ไม่เคยถูกรันใน crashsweep เลย
     ตั้งเป็น `plant` เพราะนิยามระดับโรงงานตกทอดถึงทุกขอบเขต ⇒ เห็นแน่นอนไม่ว่าจอ default ไปที่ไหน
     ⚠️ ต้องตั้ง `section: null` ด้วย — `scopeOfDef()` ถอยไปอ่าน `section` เมื่อ `scope_kind = 'plant'`
        (ใส่ scope_kind อย่างเดียวแล้วคง section ไว้ = ยังเป็นนิยามระดับส่วนงานเหมือนเดิม แถวก็ยังไม่โผล่)
     · `kd-3` (auto) ยังคง `section: 'PD3'` ไว้ = สาขา "นิยามระดับส่วนงาน" ยังถูกรันอยู่
     · `summary_mode` ต้องมีทั้ง `average`/`sum`/`rate` ให้ครบ — แต่ละตัวเปิดสาขาคนละเส้นใน `summaryOf()`
       (`rate` = สาขาที่ต้องถอยมาเฉลี่ยแล้วติดป้าย ≈) · `decimals: 0` = สาขาที่ `||` จะตกค่า default */
  kpi_definitions: [
    { id: 'kd-1', year: 2026, section: null, scope_kind: 'plant', scope_value: null, line_group: null, category: 'financial', seq: 1, name: 'Raw Material Control', source: 'manual', target_value: 95, direction: 'up', weight: 5, is_active: true, catalog_id: 'kc-1', std_unit: 'Production', std_item_id: 'std-1', kpi_catalog: { id: 'kc-1', name: 'Raw Material Control', unit: '%', category: 'financial', direction: 'up', decimals: 2, summary_mode: 'average', value_scope: 'plant', board_slot: 'rm' } },
    /* 🏭 30/09 ห้ามถอด: KPI แบบ "ค่าโรงงาน" ที่หน่วยงาน (PD1 = ส่วนงานของ user ใน harness) ถือด้วย — เปิดสาย sharedValueDef/แถวอ่านอย่างเดียวในแท็บ ⚙️ + note บนบอร์ด */
    { id: 'kd-7', year: 2026, section: 'PD1', scope_kind: 'section', scope_value: 'PD1', line_group: null, category: 'financial', seq: 1, name: 'Raw Material Control', source: 'manual', target_value: 96, direction: 'up', weight: 5, is_active: true, catalog_id: 'kc-1', std_unit: 'Production', std_item_id: 'std-1', kpi_catalog: { id: 'kc-1', name: 'Raw Material Control', unit: '%', category: 'financial', direction: 'up', decimals: 2, summary_mode: 'average', value_scope: 'plant', board_slot: 'rm' } },
    { id: 'kd-2', year: 2026, section: null, scope_kind: 'plant', scope_value: null, line_group: null, category: 'internal', seq: 2, name: 'Internal Quality Rate', source: 'manual', target_value: null, direction: null, weight: null, is_active: true, catalog_id: 'kc-2', std_unit: 'Production', std_item_id: 'std-3', kpi_catalog: { id: 'kc-2', name: 'Internal Quality Rate', unit: 'PPM', category: 'internal', direction: 'down', decimals: 0, summary_mode: 'rate', value_scope: 'own' } },
    { id: 'kd-3', year: 2026, section: 'PD3', scope_kind: 'plant', scope_value: null, line_group: null, category: 'internal', seq: 3, name: 'PPM ของเสียภายใน', source: 'auto:ppm', target_value: 500, direction: 'down', weight: 4, is_active: true, catalog_id: null, std_unit: null, std_item_id: null, kpi_catalog: null },
    /* แถวที่ **ตั้งหน่วย/ทศนิยมทับทะเบียน** + วิธีรวมแบบ "รวมทั้งปี" — สาขา 2 ชั้นของ `unitOf`/`decimalsOf` */
    { id: 'kd-4', year: 2026, section: null, scope_kind: 'plant', scope_value: null, line_group: null, category: 'internal', seq: 4, name: 'Defect / Scrap Cost', source: 'manual', unit: 'พันบาท/เดือน', decimals: 1, target_value: 105.1, direction: 'down', weight: null, is_active: true, catalog_id: 'kc-3', std_unit: null, std_item_id: null, kpi_catalog: { id: 'kc-3', name: 'Defect / Scrap Cost (COPQ)', unit: 'พันบาท', category: 'internal', direction: 'down', decimals: 2, summary_mode: 'sum', value_scope: 'own' } },
    /* ⚡ KPI ช่างของแผนก JIG MTN (24/09) — ชื่อตามที่ seed จริง ⇒ สาย `autoKpiOfName` → แถว "⚡ ระบบคำนวณ" + ปุ่ม "ใช้ค่านี้" ถูกรันใน harness
       · MTBF ตั้งหน่วย "นาที" ทับ = สาขา `toRowUnit` ×60 · ห้ามถอด */
    { id: 'kd-5', year: 2026, section: 'JIG MTN', scope_kind: 'department', scope_value: 'JIG MTN', line_group: null, category: 'internal', seq: 5, name: 'Mean Time Between Failure (MTBF)', source: 'manual', unit: 'นาที', target_compare: '>=', target_value: 10000, commit_compare: '>=', commit_value: 9000, direction: 'up', weight: 4, is_active: true, catalog_id: null, std_unit: 'Maintenance', std_item_id: null, kpi_catalog: null },
    { id: 'kd-6', year: 2026, section: 'JIG MTN', scope_kind: 'department', scope_value: 'JIG MTN', line_group: null, category: 'customer', seq: 6, name: 'MO Closed on target', source: 'manual', unit: '%', target_compare: '>=', target_value: 99, commit_compare: '>=', commit_value: 95, direction: 'up', weight: 6, is_active: true, catalog_id: null, std_unit: 'Maintenance', std_item_id: null, kpi_catalog: null },
  ],
  /* ค่าจริง + แผนรายเดือนของ KPI กรอกมือ (2026-09-25) — ไม่มี 2 ตารางนี้ใน mock แปลว่า
     ทั้งตารางกรอกมือ · คอลัมน์สรุปทั้งปี · มินิกราฟ · แถว 📅 แผน **ไม่เคยถูกรันด้วยข้อมูลจริงใน harness**
     🔴 ทรงข้อมูลต้องมีครบ 3 แบบที่ของจริงมี ห้ามตัดให้เหลือแบบเดียว:
        kd-1 = มีทั้งผลและแผนครบ (ทางที่เทียบได้) · kd-4 = KPI สะสม (summary_mode 'sum')
        ที่แผนขาดบางเดือน (ทางที่ต้องข้ามเดือนแล้วรายงาน skipped) · kd-6 = มีผลแต่ไม่มีแผนเลย
        (ทางที่ planProgress คืน null แล้วจอต้องเขียนว่ายังไม่มีเดือนที่เทียบได้) */
  kpi_manual_entries: [
    ...[93.1, 94.0, 95.2, 96.4, 95.8, 94.9].map((v, i) => ({ id: `ke-1-${i}`, kpi_id: 'kd-1', month: i + 1, value: v })),
    ...[120.5, 98.2, 140.9, 88.4].map((v, i) => ({ id: `ke-4-${i}`, kpi_id: 'kd-4', month: i + 1, value: v })),
    ...[97.5, 99.1, 98.0].map((v, i) => ({ id: `ke-6-${i}`, kpi_id: 'kd-6', month: i + 1, value: v })),
  ],
  /* 📝 หมายเหตุรายเดือน (30/09) — แผ่น %RM (slot rm) ที่ทั้งโรงงาน เดือน 3 มีโน้ต ⇒ เปิดสายเครื่องหมาย 📝 บนแท่ง + โมดัล (ห้ามถอด) */
  kpi_month_notes: [
    { id: 'kn-1', year: 2026, month: 3, scope_kind: 'plant', scope_value: '', row_key: 'rm', kind: 'remark', text: 'ราคาเหล็กขึ้น 4% ตามสัญญา Q1', created_by_name: 'ทดสอบ ระบบ', created_at: '2026-04-02T02:00:00Z', is_active: true },
    { id: 'kn-2', year: 2026, month: 3, scope_kind: 'plant', scope_value: '', row_key: 'rm', kind: 'action', text: 'เจรจา supplier รอบ 2 · เป้าลดลง 1.5% ใน Q2', created_by_name: 'ทดสอบ ระบบ', created_at: '2026-04-02T02:05:00Z', is_active: true },
  ],
  kpi_month_plans: [
    ...[95, 95, 95, 95, 95, 95].map((v, i) => ({ id: `kp-1-${i}`, kpi_id: 'kd-1', month: i + 1, plan_value: v })),
    { id: 'kp-4-0', kpi_id: 'kd-4', month: 1, plan_value: 105.1 },
    { id: 'kp-4-2', kpi_id: 'kd-4', month: 3, plan_value: 105.1 },   // เว้น ก.พ./เม.ย. โดยตั้งใจ = เดือนที่ยังไม่ตั้งแผน
  ],
  /* ทีมช่าง — ทรงเดียวกับ DEFAULT_TEAMS ของ pmTeams.js (dept_name ต้องตรงชื่อแผนกในผัง ไม่งั้นแท็บ ⚙️ ไม่รู้ว่าขอบเขตนี้เป็นทีมช่าง) */
  mtn_teams: [
    { id: 't-1', key: 'maintenance', label: 'MTN (ซ่อมบำรุง)', icon: '🔧', equip_type: 'machine', dept_name: 'MTN', color: '#fb923c', sort_order: 1, kind: 'pm', is_active: true },
    { id: 't-2', key: 'jig_maintenance', label: 'JIG MTN', icon: '🧩', equip_type: 'jig', dept_name: 'JIG MTN', color: '#34d399', sort_order: 2, kind: 'pm', is_active: true },
    { id: 't-3', key: 'die_maintenance', label: 'DIE MTN', icon: '🗜️', equip_type: 'die', dept_name: 'DIE MTN', color: '#4d9fff', sort_order: 3, kind: 'pm', is_active: true },
    { id: 't-4', key: 'production', label: 'AM (ผลิตตรวจเอง)', icon: '🏭', equip_type: null, dept_name: 'PRODUCTION', color: '#94a3b8', sort_order: 4, kind: 'am', is_active: true },
  ],
  factory_map: [{ id: 'fm-1', image_url: FACTORY_MAP_IMG, updated_at: '2026-09-01T00:00:00+07:00' }],
  factory_line_regions: [
    { id: 'rg-1', line_name: LINE_NAME(1), points: [[6, 8], [44, 8], [44, 46], [6, 46]] },
    { id: 'rg-2', line_name: LINE_NAME(2), points: [[54, 8], [92, 8], [92, 46], [54, 46]] },
    { id: 'rg-3', line_name: 'ห้องคอมเพรสเซอร์', points: [[6, 56], [44, 56], [44, 92], [6, 92]] },
  ],

  /* 📉 บอร์ด Monitoring — **ห้ามถอดแถวพิเศษ** (2026-10-02)
     หน้า /monitoring วาดจาก `monitor_boards.rows` (jsonb) ⇒ ถ้า mock ไม่มีบอร์ด harness จะ
     เห็นแค่หน้าจอ "ยังไม่มีบอร์ด" แล้วไม่เคยรันตัวตารางจริงสักบรรทัด · ชุดนี้ตั้งใจให้ครบทุกสาขา:
       · `mon-line`  = ไลน์ปั๊มมี WIP 7 แถว + ผูกไลน์จริง (เดินสาย IN/OUT/MIN จากระบบ)
       · `mon-line2` = ไลน์ที่ **ไม่มี WIP** 6 แถว — พิสูจน์ว่าชุดแถวมาจาก DB ไม่ใช่ hardcode
       · `mon-rack`  = คอลัมน์แบบ `date` (สูตร deplete) — คนละทรงกับรายวัน
       · `mon-raw`   = คอลัมน์เดียว ไม่มีสูตร recur เลย (สาย กก. ⇄ ชิ้น)
       · `mon-bad`   = แถวที่อ้าง **สูตรที่ระบบไม่รู้จัก** ⇒ ต้องขึ้นแถบเตือน ไม่ใช่จอพัง */
  monitor_boards: [
    { id: 'mon-line', board_key: 'line-800t', name: '800T', kind: 'line',
      line_name: LINE_NAME(1), customer: null, period_kind: 'day', period_count: 6,
      start_date: '2026-09-30', sl_row: 'out', sl_includes_seed: false, sort_order: 1, note: null,
      rows: [
        { key: 'plan', label: 'PLAN · แผน', kind: 'input' },
        { key: 'in', label: 'IN · ผลิตเข้า', kind: 'system' },
        { key: 'unbound', label: 'UNBOUND · แผนค้างสะสม', kind: 'recur', recur: 'plan_backlog' },
        { key: 'out', label: 'OUT · จ่ายออก', kind: 'system' },
        { key: 'balance', label: 'BALANCE · คงเหลือ', kind: 'recur', recur: 'stock_run' },
        { key: 'wip', label: 'WIP · งานระหว่างทำ', kind: 'input' },
        { key: 'min', label: 'MIN · ขั้นต่ำ', kind: 'const' },
      ] },
    { id: 'mon-line2', board_key: 'line-600t', name: '600T', kind: 'line',
      line_name: null, customer: null, period_kind: 'day', period_count: 5,
      start_date: '2026-09-30', sl_row: 'in', sl_includes_seed: true, sort_order: 2, note: null,
      rows: [
        { key: 'plan', label: 'PLAN · แผน', kind: 'input' },
        { key: 'in', label: 'IN · ผลิตเข้า', kind: 'system' },
        { key: 'unbound', label: 'UNBOUND · แผนค้างสะสม', kind: 'recur', recur: 'plan_backlog' },
        { key: 'out', label: 'OUT · จ่ายออก', kind: 'system' },
        { key: 'balance', label: 'BALANCE · คงเหลือ', kind: 'recur', recur: 'stock_run' },
        { key: 'min', label: 'MIN · ขั้นต่ำ', kind: 'const' },
      ] },
    /* 📦 บอร์ด FG ต่อลูกค้า — **ห้ามถอด** (2026-10-06)
       บอร์ดชนิดนี้เป็นชนิดเดียวที่ผูก `customer` แทน `line_name` และดึงแถว ORDER จาก
       `customer_shipping_orders` (EDI 862/830) ⇒ ไม่มีบอร์ดนี้ใน mock = สาขา `isFg`
       ใน `Monitoring.loadSystem` + สูตร `fg_run` ไม่เคยถูกรันใน harness เลย */
    { id: 'mon-fg', board_key: 'fg-grbna', name: 'GRBNA', kind: 'fg',
      line_name: null, customer: 'GRBNA', period_kind: 'day', period_count: 6,
      /* 🔴 เริ่ม "เมื่อวาน" เสมอ ⇒ คอลัมน์ 📍 วันนี้ โผล่ทุกครั้งที่รัน harness (ห้ามเปลี่ยนเป็นวันตายตัว) */
      start_date: MOCK_DAY(-1), sl_row: 'order', sl_includes_seed: false, sort_order: 1, note: null,
      rows: [
        { key: 'order', label: 'ORDER · ลูกค้าสั่ง', kind: 'system' },
        { key: 'in', label: 'IN · ผลิตเข้า', kind: 'system' },
        { key: 'balance', label: 'BALANCE · คงเหลือ', kind: 'recur', recur: 'fg_run' },
        { key: 'min', label: 'MIN · ขั้นต่ำ', kind: 'const' },
      ] },
    { id: 'mon-rack', board_key: 'rack-tspk', name: 'TSPK', kind: 'rack',
      line_name: null, customer: 'TSPK', period_kind: 'date', period_count: 8,
      start_date: null, sl_row: 'order', sl_includes_seed: false, sort_order: 1, note: null,
      rows: [
        { key: 'order', label: 'ORDER · ลูกค้าสั่ง', kind: 'input' },
        { key: 'balance', label: 'BALANCE · คงเหลือ', kind: 'recur', recur: 'deplete' },
        { key: 'min', label: 'MIN · ขั้นต่ำ', kind: 'const' },
        { key: 'max', label: 'MAX · สูงสุด', kind: 'const' },
      ] },
    { id: 'mon-raw', board_key: 'raw-mat', name: 'mat', kind: 'raw',
      line_name: null, customer: null, period_kind: 'day', period_count: 1,
      start_date: '2026-10-01', sl_row: 'queue_pcs', sl_includes_seed: false, sort_order: 1, note: null,
      rows: [
        { key: 'on_hand_kg', label: 'เหล็กคงเหลือ (กก.)', kind: 'input' },
        { key: 'queue_pcs', label: 'งานท้ายไลน์ (ชิ้น)', kind: 'input' },
      ] },
    { id: 'mon-bad', board_key: 'vendor-ra', name: 'RA', kind: 'vendor',
      line_name: null, customer: 'JRPE', period_kind: 'day', period_count: 4,
      start_date: '2026-09-30', sl_row: 'to_vendor', sl_includes_seed: false, sort_order: 1, note: null,
      rows: [
        { key: 'to_vendor', label: 'ส่งไปชุบ', kind: 'input' },
        { key: 'from_vendor', label: 'รับคืนจากชุบ', kind: 'input' },
        { key: 'at_vendor', label: 'ค้างที่ร้านชุบ', kind: 'recur', recur: 'สูตรที่ยังไม่มี' },
      ] },
  ],
  /* พาร์ท: mp-1 ใส่ยอดยกมาครบ · mp-2 **ไม่ใส่** (ต้องขึ้นแถบ "ยังไม่ใส่ยอดยกมา") ·
     mp-3 ไม่มีเลข MAT ในทะเบียนสินค้า (ต้องขึ้นป้าย "ยังไม่อยู่ในทะเบียนสินค้า") */
  monitor_board_parts: [
    { id: 'mp-1', board_id: 'mon-line', mat_no: '10101001', part_no: 'BHS07706', part_name: 'BRACKET;SHOCK ABS 4X4,LH',
      model: 'RG01', raw_mat: null, process: null, rack: null, lot_qty: 2000, packing: 100, cost: 121.5,
      ct_sec: 5, fc: 11800, pieces_per_shot: 2, kg_per_piece: null, spec: null, semi_part: null, sort_order: 1, note: null, is_active: true },
    { id: 'mp-2', board_id: 'mon-line', mat_no: '10101002', part_no: 'BHS08555', part_name: 'BRACKET;SHOCK ABS 4X4,RH',
      model: 'RG01', raw_mat: null, process: null, rack: null, lot_qty: 2000, packing: 100, cost: 137.11,
      ct_sec: 13.44, fc: null, pieces_per_shot: null, kg_per_piece: null, spec: null, semi_part: null, sort_order: 2, note: null, is_active: true },
    { id: 'mp-3', board_id: 'mon-line2', mat_no: '99999999', part_no: null, part_name: null,
      model: null, raw_mat: null, process: null, rack: null, lot_qty: null, packing: null, cost: null,
      ct_sec: null, fc: null, pieces_per_shot: null, kg_per_piece: null, spec: null, semi_part: null, sort_order: 1, note: null, is_active: true },
    /* พาร์ทบนบอร์ด FG — mp-fg2 **ไม่มีเลขพาร์ทของลูกค้า** โดยตั้งใจ (ออเดอร์จริงบางใบไม่ส่งมา)
       ⇒ `partRowKey(mat, null)` กับหัวพาร์ทที่ไม่มี Part No. ถูกรันจาก harness ด้วย */
    { id: 'mp-fg1', board_id: 'mon-fg', mat_no: '10101001', part_no: 'GR-8841', part_name: 'BRACKET;SHOCK ABS 4X4,LH',
      model: null, raw_mat: null, process: null, rack: null, lot_qty: null, packing: 100, cost: null,
      ct_sec: null, fc: null, pieces_per_shot: null, kg_per_piece: null, spec: null, semi_part: null, sort_order: 1, note: null, is_active: true },
    { id: 'mp-fg2', board_id: 'mon-fg', mat_no: '10105763', part_no: null, part_name: 'MBR-SIDE MID INR LH',
      model: null, raw_mat: null, process: null, rack: null, lot_qty: null, packing: null, cost: null,
      ct_sec: null, fc: null, pieces_per_shot: null, kg_per_piece: null, spec: null, semi_part: null, sort_order: 2, note: null, is_active: true },
    { id: 'mp-4', board_id: 'mon-rack', mat_no: '10101001', part_no: 'BHS07706 (LH)', part_name: null,
      model: '20TF/RG01', raw_mat: null, process: null, rack: '1', lot_qty: null, packing: 100, cost: null,
      ct_sec: null, fc: null, pieces_per_shot: null, kg_per_piece: null, spec: null, semi_part: null, sort_order: 1, note: null, is_active: true },
    { id: 'mp-5', board_id: 'mon-raw', mat_no: '50027079', part_no: null, part_name: null,
      model: null, raw_mat: null, process: null, rack: null, lot_qty: null, packing: null, cost: null,
      ct_sec: null, fc: null, pieces_per_shot: 2, kg_per_piece: 0.148, spec: 'WSS-M1A365-A11 1.40 X 187 X COIL',
      semi_part: 'GST FRT FNDR APR LH', sort_order: 1, note: null, is_active: true },
    { id: 'mp-6', board_id: 'mon-bad', mat_no: '20066542', part_no: 'R1WB-17K824-AAW', part_name: null,
      model: null, raw_mat: null, process: null, rack: null, lot_qty: null, packing: null, cost: null,
      ct_sec: null, fc: 3383.6, pieces_per_shot: null, kg_per_piece: null, spec: null, semi_part: null,
      sort_order: 1, note: 'หลังชุบ: 20066540', is_active: true },
  ],
  /* ช่องที่คนกรอก — mp-1 มียอดยกมาครบ (สูตรเดินได้) และ **ตก MIN กลางทาง** (ต้องขึ้นสีแดง)
     mp-2 จงใจไม่มียอดยกมาเลย ⇒ แถว recur ต้องขึ้นขีด "–" ทั้งแถว ห้ามเป็น 0 */
  monitor_cells: [
    { board_part_id: 'mp-1', row_key: 'plan', period_key: '2026-09-30', qty: 2000, txt: null },
    { board_part_id: 'mp-1', row_key: 'unbound', period_key: '2026-09-30', qty: -1700, txt: null },
    { board_part_id: 'mp-1', row_key: 'balance', period_key: '2026-09-30', qty: 2000, txt: null },
    { board_part_id: 'mp-1', row_key: 'min', period_key: '2026-09-30', qty: 1800, txt: null },
    { board_part_id: 'mp-1', row_key: 'out', period_key: '2026-10-01', qty: 700, txt: null },
    { board_part_id: 'mp-1', row_key: 'out', period_key: '2026-10-02', qty: 800, txt: null },
    { board_part_id: 'mp-1', row_key: 'wip', period_key: '2026-10-01', qty: 120, txt: null },
    { board_part_id: 'mp-3', row_key: 'balance', period_key: '2026-09-30', qty: 50, txt: null },
    { board_part_id: 'mp-4', row_key: 'balance', period_key: '2026-09-30', qty: 100, txt: null },
    { board_part_id: 'mp-4', row_key: 'min', period_key: '2026-09-30', qty: 1800, txt: null },
    { board_part_id: 'mp-4', row_key: 'order', period_key: '2026-10-01', qty: 700, txt: null },
    { board_part_id: 'mp-4', row_key: 'order', period_key: '2026-10-02', qty: 800, txt: null },
    { board_part_id: 'mp-5', row_key: 'on_hand_kg', period_key: '2026-10-01', qty: 699, txt: null },
    { board_part_id: 'mp-5', row_key: 'queue_pcs', period_key: '2026-10-01', qty: 2446, txt: null },
    { board_part_id: 'mp-6', row_key: 'at_vendor', period_key: '2026-09-30', qty: 849, txt: null },
    { board_part_id: 'mp-6', row_key: 'to_vendor', period_key: '2026-10-01', qty: 398, txt: null },
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
/* ⚡ KPI ช่าง (24/09) — Σ รายเดือนทรงเดียวกับ RPC จริง: มีเดือนที่มีข้อมูล/ไม่มี · ทีม jig มีใบไม่ตั้งกำหนด · เดือนที่ jig ไม่เสียเลย */
const KPI_MTN_ROLL = () => ({
  machines: [{ kind: 'die', n: 26 }, { kind: 'jig', n: 17 }, { kind: 'machine', n: 21 }],
  months: ['2026-06', '2026-07', '2026-08', '2026-09'],
  mo: [
    { m: '2026-09', team: 'jig_maintenance', closed: 4, on_target: 2, no_target: 1 },
    { m: '2026-08', team: 'jig_maintenance', closed: 3, on_target: 3, no_target: 0 },
    { m: '2026-09', team: 'maintenance', closed: 17, on_target: 1, no_target: 1 },
  ],
  dt: [
    { m: '2026-09', kind: 'jig', events: 42, breakdown_min: 502 },
    { m: '2026-08', kind: 'jig', events: 25, breakdown_min: 270 },
    { m: '2026-09', kind: 'machine', events: 50, breakdown_min: 600 },
  ],
})
/* ยอดผลิตรายไลน์รายวัน (RPC `pm_usage_daily`) — ใช้ตอบ "วันไหนเครื่องเดินจริง" ของรอบ run_day
   🔴 ต้องมีไลน์ของแถว 2 (เดินถึงวันนี้) และ **ไม่มี**ของแถว 3 (จอดมานาน) เพื่อให้จอวาดครบทั้ง
      "ถึงรอบตรวจวันนี้" และ "ไม่ได้ผลิต — ไม่ต้องตรวจ" (เทา) · ไม่มีไลน์ไหนเลย = เห็นแค่สาขาเดียว */
const PM_USAGE_DAILY = () => {
  const out = []; const today = new Date();
  for (let d = 0; d < 20; d++) {
    const t = new Date(today); t.setDate(t.getDate() - d);
    const ymd = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    /* 🔴 **ต้องข้าม d = 0 (วันนี้)** — ให้ "วันนี้ไลน์ไม่ได้เปิดใบผลิต" เป็นจริงใน harness
       ไม่งั้นแถว run_day ที่รอบยังไม่ครบจะตกเป็น "ตามกำหนด" ทุกแถว แล้ว **สถานะ `idle_skip`
       (เทา · "ไม่ได้ผลิต — ไม่ต้องตรวจ") ไม่เคยถูกวาดเลย** = ครึ่งหนึ่งของฟีเจอร์ไม่ถูกตรวจ */
    if (d % 3 !== 0) out.push({ line_name: LINE_NAME(2), work_date: ymd, qty: 500 + d, orders: 4 });
  }
  return out;
};

const RPC_RESULT = {
  pm_usage_daily: PM_USAGE_DAILY,
  kpi_mtn_rollup: KPI_MTN_ROLL,
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
