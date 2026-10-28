# Module Docs Index

> รายละเอียดเชิงลึกของแต่ละโมดูล — **อ่านเฉพาะไฟล์ที่เกี่ยวกับงานที่กำลังทำ** (ห้าม cat ทั้งโฟลเดอร์)

> 🔴 **ไม่มีคอลัมน์ "ขนาด" แล้ว (2026-10-20 · QC audit)** — เลขที่เขียนมือเพี้ยนไป 25-45%
> (`oee.md` เขียน 268 KB · จริง 385 · `mtn-work-order.md` 148 → 315) และ **ขาดโมดูลไป 10 ไฟล์**
> ⇒ ดัชนีที่ผิดอันตรายกว่าไม่มีดัชนี เพราะคนใช้ตัวเลขนี้ตัดสินว่าจะเปิดไฟล์ไหน
> ขนาดจริงดูสดที่ `ls -S docs/modules/` (หลักเดียวกับ "โครงสร้าง DB อ่านสดที่ /schema")
> **เพิ่มไฟล์โมดูลใหม่ = เพิ่มแถวที่นี่ในคอมมิทเดียวกัน**

| โมดูล | ไฟล์ |
|---|---|
| Adoption Outlook — 🔮 ภาพเมื่อข้อมูลเชื่อมกันทั้งองค์กร (`/adoption-outlook` · 2026-08-13) | `docs/modules/adoption-outlook.md` |
| 🔗 Audit AM↔PM ทั้งโปรเจค — 2 ระบบ AM ไม่ sync · null due = "ปกติ" · ลำดับแก้ 3 รอบ (2026-10-08 · ยังไม่แก้) | `docs/modules/am-pm-linkage-audit.md` |
| 🦺 BBS — สังเกตพฤติกรรมความปลอดภัย (Behavior-Based Safety · paperless · 2026-08-21) | `docs/modules/bbs-safety.md` |
| 🌳 ชั้น BOM ที่แก้ได้ + ผูกขั้นตอน (PFC/OP) — `/products` แท็บ BOM (2026-09-16) | `docs/modules/bom-levels.md` |
| ด่านใน `npm run build` — ที่มาของแต่ละด่าน + เคสจริงที่ทำให้ต้องมี | `docs/modules/build-gates.md` |
| รีด CLAUDE.md ให้มีที่ว่าง (2026-09-30) — ย้ายอะไรไปไหน | `docs/modules/claude-md-slim.md` |
| 🔗 ลูปปิด 8D → PFMEA / PFC / Control Plan (2026-08-17 · คำสั่ง user) | `docs/modules/closed-loop-8d-pfmea.md` |
| ⏱ ทบทวน Cycle Time — "ระบบเสนอ วิศวกรตัดสิน" | `docs/modules/ct-review.md` |
| Daily Report — ไลน์ผสมหลาย process (welding + metal forming ในไลน์เดียว · 2026-07-22) | `docs/modules/daily-report-mixed-process.md` |
| Daily Report — ออเดอร์ manual สำหรับไลน์ไม่มี kanban card (2026-07-12) | `docs/modules/daily-report.md` |
| วันที่/เวลา — ตัวอย่างโค้ด + เหตุผลเต็ม (Date/Time utilities) | `docs/modules/date-time-rules.md` |
| 🗄️ Database Schema — กฎ/เหตุผล/ประวัติรายตาราง (ย้ายจาก CLAUDE.md 2026-09-23) | `docs/modules/db-schema.md` |
| หลักฐาน/ตัวเลขเบื้องหลัง "กฎเหล็กการเขียน DB จาก client" | `docs/modules/db-write-rules.md` |
| 🔗 สายธารความต้องการ (Demand Flow) — `/flow-tower` (audit + หน้าจริง · 2026-08-19) | `docs/modules/demand-flow-tower.md` |
| Deploy | `docs/modules/deploy.md` |
| 🚨 ระบบล่ม 21/10 (ช่องต่อฐานข้อมูลเต็ม) + กฎ "ถอยเมื่อ 503" | `docs/modules/conn-outage-2026-10-21.md` |
| Dashboard ส่วนงาน — 📋 `/dept-dashboard` (2026-08-06) | `docs/modules/dept-dashboard-tv.md` |
| DIE MAINTENANCE — Layout & สถานะแม่พิมพ์ (2026-08-19) | `docs/modules/die-maintenance.md` |
| 🔁 จอวนหน้า (display rotation) — `/display-rotation` (2026-10-09) | `docs/modules/display-rotation.md` |
| ทะเบียนเอกสาร `/doc-forms` (Document Master) — ขั้นตอน register เอกสาร export ใหม่ | `docs/modules/doc-forms.md` |
| Edge Functions | `docs/modules/edge-functions.md` |
| Employee Skills & EXP Farming (server-side 2026-07-13 · **v2 วัดความสามารถ 2026-09-24**) | `docs/modules/employee-skills-exp.md` |
| Factory Master Map — ผังรวมโรงงานผังเดียว (2026-07-16) | `docs/modules/factory-master-map.md` |
| 💬 กล่องรับ Feedback จากหน้างาน (2026-08-14 · คำขอ user) | `docs/modules/feedback-inbox.md` |
| โครงไฟล์ของโปรเจค (ผังโฟลเดอร์ + ของกลางที่ทุก session ควรรู้จัก) | `docs/modules/file-structure.md` |
| Fixture Shim Record — คุมความยั่งยืนของจิ๊ก (2026-09-01 · คำขอลูกค้า) | `docs/modules/fixture-shim-record.md` |
| ตั้งค่าผัง/Floorplan — แยก display ออกจาก setup (2026-07-16) | `docs/modules/floorplan-setup.md` |
| 4M Approval Workflow — ประวัติเหตุการณ์ `[Auto]` ท่วมคิว | `docs/modules/four-m-workflow.md` |
| Group Overview — 🏢 ภาพรวมกลุ่มบริษัท TSG (MOCKUP หลายบริษัท · 2026-08-05) | `docs/modules/group-overview.md` |
| Improvements — โปรเจคปรับปรุง Kaizen (2026-07-12) | `docs/modules/improvements-kaizen.md` |
| 🎯 ตั้งค่าจุดตรวจ — ระบบเดียว PM (อุปกรณ์) + QA (ชิ้นงาน) · ชิ้นส่วนกลาง `components/inspect/` (2026-10-15) | `docs/modules/inspection-point-setup.md` |
| Kanban Auto-Calc — คำนวณ kanban จาก forecast (แท็บ 🎴 คำนวณ Kanban ใน /planner-sales · 2026-07-16..17) | `docs/modules/kanban-auto-calc.md` |
| Logistic — Planner & Sales / Delivery / Rundown Stock (2026-07-10..11) | `docs/modules/logistic-planner-sales.md` |
| Layer Process Audit — LPA paperless (2026-07-20) | `docs/modules/lpa-audit.md` |
| 🧑‍🤝‍🧑 Manpower Control Board — ผังกำลังคน · ผัง LAYOUT · ป้าย 4M (`/manpower-board` · 2026-10-06) | `docs/modules/manpower-board.md` |
| 📉 Monitoring Boards — `/monitoring` (2026-10-02) | `docs/modules/monitoring-boards.md` |
| Morning Meeting — ประชุมแถวเช้า (2026-07-13) | `docs/modules/morning-meeting.md` |
| 🔍 KPI ช่าง + QC 7 Tools — `/mtn-analysis` (2026-09-22) | `docs/modules/mtn-problem-analysis.md` |
| MTN Work-Order — ใบแจ้งซ่อม MO 7 ขั้น (2026-07-14) | `docs/modules/mtn-work-order.md` |
| 📌 คิวงานของฉัน — แผงในเมนูบัญชี (2026-09-25 · คำสั่ง user) | `docs/modules/my-queue.md` |
| 🔔 แจ้งเตือนท่วม + นโยบายเก็บย้อนหลัง `notifications` (2026-09-23) | `docs/modules/notifications-flood.md` |
| 🔔 แจ้งเตือนในแอป — สภาพจริง (audit 2026-09-24) | `docs/modules/notify-inapp-audit.md` |
| 🚀 NPI — พาร์ทใหม่ APQP / PPAP / Drawing Rev / ECI / Tooling Plan (`/npi` · 2026-09-07) | `docs/modules/npi-apqp.md` |
| OBEYA แท็บ 📋 บอร์ด KPI ส่วนงาน `/obeya?tab=kpi` (2026-08-27) | `docs/modules/obeya-kpi-board.md` |
| OBEYA แท็บ 🖥️ จอมอนิเตอร์ SQDCM `/obeya?tab=sqdcm` (2026-09-15) | `docs/modules/obeya.md` |
| OEE (computeOEE ใน DailyReport) — กฎ P สำหรับหลาย MAT.NO (2026-07-14) | `docs/modules/oee.md` |
| OJT — ใบแจ้งการอบรมสอนงาน FM-HRM-004 (2026-07-20) | `docs/modules/ojt-training.md` |
| สอบกลับ Order — `/order-trace` (Order Traceability · 2026-07-30) | `docs/modules/order-trace.md` |
| Organizational Hierarchy (Thai Summit Group) | `docs/modules/org-hierarchy.md` |
| Pages & Routes | `docs/modules/pages-routes.md` |
| PE Core Tools — Process Flow / PFMEA / Control Plan (2026-08-13) | `docs/modules/pe-core-tools.md` |
| 🔐 Audit — "เข้าหน้าได้ ≠ แก้ของหน่วยงานอื่นได้" (2026-10-15 · คำสั่ง user) | `docs/modules/permission-scope-audit.md` |
| 🔑 Audit PK/FK ทั้ง 2 โปรเจค — ทะเบียนหลัก (คน·เครื่อง·ไลน์·ชิ้นงาน) ผูกด้วย FK หรือ text · แถวกำพร้าจริง · ลำดับแก้ (2026-10-28 · ยังไม่แก้) | `docs/modules/pk-fk-audit.md` |
| PM Coordination — แผนประสานงาน PM ข้ามวัน (MTN แจ้ง Production · 2026-07-23) | `docs/modules/pm-coordination.md` |
| 🔧 ศูนย์ PM — แท็บตรวจ PM + ตั้งค่าจุดตรวจ (ปุ่มบันทึกตรวจไม่ครบ · คัดลอกแผน PM ข้ามเครื่อง · 2026-10-07) | `docs/modules/pm-hub-check-setup.md` |
| PM Predictive & Planner Sync — เห็นวัน PM ล่วงหน้า + buffer (2026-07-16) · 🧭 3 ระดับ Preventive→Predictive→Prescriptive (2026-09-23) | `docs/modules/pm-predictive-planner-sync.md` |
| กระบวนการผลิต (process types) — master data-driven (2026-07-23) | `docs/modules/process-types.md` |
| ประวัติผลิต by Product — `/product-history` (2026-07-24) | `docs/modules/product-history.md` |
| Production Plan — วางแผนการผลิต (Active Planner, 2026-07-15) | `docs/modules/production-plan.md` |
| ใบรายงานปัญหาการผลิต + ถังเหลือง/ถังแดง (paperless · 2026-08-19 · feedback หน้างาน) | `docs/modules/production-problem-report-bins.md` |
| 📦 อัพเดทโปรแกรม — `/program-update` (2026-10-01 · คำสั่ง user) | `docs/modules/program-update.md` |
| QA Inspection — setup → ใบตรวจ (ปิดช่องว่าง 2026-08-04) | `docs/modules/qa-inspection.md` |
| ประวัติผล QC Audit (ตรวจ+แก้แล้ว — บันทึกกัน regress) | `docs/modules/qc-audit-history.md` |
| QR / บาร์โค้ดอุปกรณ์ — สแกนเลือกเครื่อง/จิ๊ก/สินค้า (2026-08-03 · คำสั่ง user) | `docs/modules/qr-equipment-scan.md` |
| Remote Control — จอตาม-มือถือคุม (2026-07-15) | `docs/modules/remote-control.md` |
| Reusable สำหรับโปรเจคถัดไป (PM Checker) | `docs/modules/reusable-pm-checker.md` |
| Role System | `docs/modules/role-system.md` |
| 🗄️ โครงสร้างฐานข้อมูล (Data Map) — `/schema` (2026-09-22 · ทีมงานขอ: แจ้งบัคให้ตรงตาราง) | `docs/modules/schema-map.md` |
| Scrap Report — ใบรายงานของเสีย FM-PD2-002 Rev.06 (paperless + export · 2026-07-16) | `docs/modules/scrap-report.md` |
| 🖥️ ออดิท "บัญชีกลาง (shared account) ต้องได้แค่ view" — 2026-10-13 | `docs/modules/shared-account-audit.md` |
| 📋 รายการจุดที่ "บัญชีกลาง" ยังลบ/แก้ได้ — ให้ user ไล่ติ๊กว่าจะปิดอันไหน (2026-10-13) | `docs/modules/shared-account-risk-list.md` |
| Shift Logic / OT — เวลากะ · OT วันหยุด · มาตรา 75 (ย้ายจาก CLAUDE.md 2026-09-23) | `docs/modules/shift-ot.md` |
| คลังอะไหล่ (Spare Part Master) — FM-JIG-009 + Rank ตาม WI-JIG-010 (2026-08-05) | `docs/modules/spare-part-master.md` |
| 🔍 Audit ก่อน deploy — แยกช่าง/สายสนับสนุน (`staff_kind` 3 กลุ่ม · 14/10) | `docs/modules/staff-kind-audit-14-10.md` |
| Storage & รูปภาพ (กติกาสำคัญ — 2026-07-09) | `docs/modules/storage-images.md` |
| 🏬 บอร์ดสโตร์ — ใครทำอะไร/ส่งใครรับ ทุกแท็บ + ช่องโหว่ (audit 2026-10-05) + 🧪 งานชุบภายนอก (2026-10-13) | `docs/modules/store-board-workflow.md` |
| 📦 ใบขอเบิก/คืนสินค้าคงคลัง FM-STO-003 Rev.01 (paperless · 2026-08-24) | `docs/modules/store-requisition-form.md` |
| ⏱️ ตัวกรองช่วงเวลามาตรฐาน — ใช้เหมือนกันทุกหน้า (2026-09-23 · คำสั่ง user) | `docs/modules/time-range-filter.md` |
| Traceability / Audit Log — ใครแก้อะไรเมื่อไหร่ (2026-07-24) | `docs/modules/traceability-audit-log.md` |
| UI Standard sweep — ผล audit ก่อน/หลัง (2026-09-23 → 24) | `docs/modules/ui-standard-sweep.md` |
| Value Stream Mapping — `/vsm` (เฟส 1 · 2026-08-13) | `docs/modules/vsm.md` |
| Workforce Insight — กำลังคน / เปลี่ยนจุดงาน / Turnover (`/workforce-insight` · 2026-09-02) | `docs/modules/workforce-insight.md` |

## ไฟล์ที่แยกออกจาก CLAUDE.md เพื่อลด context (2026-09-25..30)

- `claude-md-slim.md` — **อ่านก่อนจะย่อ CLAUDE.md อีก** (ย้ายอะไรไปไหน + กติกา "ตัดเหตุผลได้ ตัดกฎไม่ได้")
- `file-structure.md` — ผังโฟลเดอร์เต็ม + ของกลางรายตัว (components/utils/lib/edge functions)
- `date-time-rules.md` — ตัวอย่างโค้ด ✅/❌ ของ `getWorkDate()`/กะ + helper ฝั่ง SQL
- `db-write-rules.md` — หลักฐาน/ตัวเลขเบื้องหลังกฎเขียน DB 11 ข้อ + ฉบับเต็มของทุกข้อ
- `build-gates.md` — ที่มาของทุกด่านใน `npm run build` + เคสจริงที่ทำให้ต้องมี
- `doc-forms.md` — ขั้นตอน register เอกสาร export เข้าทะเบียน `/doc-forms`
- `employee-identity.md` — สร้างตัวตนพนักงานเข้าฐาน (`/register` + โมดัลใน `/add-user`) · กฎ `newEmployeeRow()` · กับดัก `staff_kind` default เงียบ
- `qa-inspector-scopes.md` — QC ประจำไลน์ (`qa_inspector_scopes`) · แยก 3 แกน สังกัด/เห็น/ตรวจให้หน่วยไหน · กฎ `src/utils/qaScope.js`
