# 🧩 e-Workflow — ใบงานที่ user สร้างเอง (`/workflows` · `/workflow-designer`)

> เฟส 1 ลงแล้ว 2026-11-13 (คำสั่ง user "เอ้าทำสิ จะได้ลองใช้" · "ลองอย่าง flow ของ 4M")
> ออกแบบ + เหตุผล → `docs/E-WORKFLOW-DESIGN.md` · ขอบเขต role/scope ที่ยังค้าง → `docs/ROLE-SCOPE-AUDIT-2026-11-13.md`

## ไฟล์
| เรื่อง | ไฟล์ |
|---|---|
| ตาราง + RPC + RLS + สิทธิ์ + แจ้งเตือน (Main) | `supabase/migrations/20261113b_e_workflow_phase1_main.sql` (**apply แล้ว 13/11** · ทดสอบจำลอง JWT แล้ว rollback) |
| ชนิดช่อง/ขั้น/กฎหาผู้อนุมัติ + ตัวตรวจ + แม่แบบ 4M | `src/utils/wfSchema.js` |
| แถบขั้น (StepFlow) ของใบ | `src/utils/wfFlow.js` |
| วาดช่องกรอกตามฟอร์ม (picker กลาง) | `src/components/WfFormFields.jsx` |
| หน้าใช้งาน (รอฉัน · ใบของฉัน · เปิดใบใหม่) | `src/pages/Workflows.jsx` |
| หน้าออกแบบ (ใบทั้งหมด · ออกแบบ · รอเผยแพร่) | `src/pages/WorkflowDesigner.jsx` |
| เทส | `src/utils/__tests__/wfSchema.test.mjs` · ด่าน `wf-tables-write-via-rpc` ใน `regressionGuards` |

## ตาราง (Main)
`wf_defs` (นิยาม · `owner_section` = ส่วนงานเจ้าของ) → `wf_versions` (ฟอร์ม+ขั้น · แช่แข็งเมื่อ `published` ด้วย trigger) →
`wf_instances` (ใบ · ตรึง `version_id` · `step_rev` กันกดซ้อน · `blocked_reason` = หาผู้อนุมัติไม่ได้) →
`wf_tasks` (งานรอทำรายคน · คนใดคนหนึ่งกดได้ ที่เหลือ `cancelled`) · `wf_actions` (ประวัติ append-only)

## 🔴 กฎ
1. **client เขียนตาราง `wf_*` ตรงไม่ได้** — ไม่มี policy INSERT/UPDATE/DELETE + revoke แล้ว · ทุกอย่างผ่าน RPC (มีด่าน)
   `wf_save_draft` · `wf_request_publish` · `wf_review_publish` · `wf_set_def_status` · `wf_start` · `wf_act` · `wf_resubmit` · `wf_cancel`
2. **ตัวตรวจฟอร์มมี 2 ฝั่ง ตรรกะต้องตรงกัน**: `checkData()` (จอ) ↔ `wf_check_data()` (DB · ตัวตัดสิน) · กฎหาผู้อนุมัติ `ASSIGNEE_RULES` ↔ `wf_resolve()`
3. **หาผู้อนุมัติไม่เจอ = fail-closed** → ใบค้าง + `blocked_reason` แดงบนจอ · ห้ามข้ามขั้น/โยนให้ admin เงียบ · ไม่ตัดจำนวนผู้รับ (แจ้งเตือนจำกัด 20 คนที่ตัวยิงเท่านั้น)
4. **ผู้เปิดใบอนุมัติใบตัวเองไม่ได้** · บัญชีกลาง (`account_kind='shared'`) ไม่ถูกเลือกเป็นผู้อนุมัติ
5. **ขอบเขตแก้นิยาม = `wf_can_own()`** — admin หรือ `profiles.section` (บ้านจริง) ตรงกับ `owner_section` ·
   🔴 ไม่ใช้ `sections` (ขอบเขตที่เห็น) · ไม่ใช้ `scope:all_units` (ยังแจกราย role — audit 13/11 P1-1) · ย้ายเจ้าของ = เช็คทั้งต้นทาง+ปลายทาง
6. **Key User = flag แอดมินหน่วยงานเดิม** (`is_dept_admin` → bucket `dept_admin` ได้ `wf:design`) · ไม่สร้าง role ใหม่ ·
   เข้าหน้า `/workflow-designer` ผ่าน piggyback `wf:design` ใน `canAccessPage()`
7. **เผยแพร่ = admin เท่านั้น** (`wf:publish`) — Key User "ส่งขอเผยแพร่" → แจ้ง admin → เผยแพร่/ส่งกลับ (ต้องมีเหตุผล)
   เผยแพร่แล้ว RPC seed `wf:start:<key>` ให้ role ที่เลือก (role ที่ไม่เลือก = `allowed=false`) + แถวใน `permission_catalog`
8. **เวอร์ชันที่เผยแพร่แล้วแก้ไม่ได้** — บันทึกครั้งถัดไป = เวอร์ชันใหม่ · ใบที่เปิดแล้วเดินตามเวอร์ชันเดิมจนจบ
9. ปุ่มอนุมัติ/รับทราบถามยืนยันผ่าน `confirmSign` · ตีกลับ/ส่งกลับ/ยกเลิกมีช่องเหตุผลแล้ว ไม่ถามซ้ำ · **ห้าม delete ใบ** (ยกเลิก = สถานะ)
10. แจ้งเตือนในแอปเท่านั้น (`wf.task_assigned` · `wf.returned` · `wf.closed` · `wf.publish_requested` · `wf.publish_reviewed`) ·
    ผู้รับ = เจ้าของงานตรง (`extra_user_ids`) · RPC คืน `notify` แล้วจอยิง `notifyEvent` (fire-and-forget)

## แม่แบบ 4M (ทดลอง)
ปุ่ม "🧪 4M Change (ทดลอง)" ในหน้าออกแบบ = ใบทดลองในตัวสร้าง (หมวด 4M · ไลน์ · MAT · รายละเอียด → SV ส่วนงานผู้เปิด `four_m:approve_sv` → QA `four_m:approve_qa`)
🔴 **ไม่ใช่ใบ 4M จริง** — ใบ 4M จริงยังเดินที่ `/report` · การเอา flow เดิมเข้าตัวสร้างให้แต่ละโรงงาน config ได้ = งานถัดไป (ต้องออกแบบโหมด `bound` E-WORKFLOW-DESIGN §7.5)

## ผลจำลองบนฐานจริง (13/11 · transaction rollback ทั้งก้อน)
แม่แบบ 4M · ผู้เปิด leader PD3: ช่องบังคับขาด = ปฏิเสธ · ขั้น SV ได้ผู้รับ 20 คน (ทุกคนใน PD3 ที่ถือ `four_m:approve_sv` รวม leader) ·
คนอื่นกด = "งานนี้ไม่ได้มอบให้คุณ" · กดซ้ำ = "งานนี้ปิดไปแล้ว" · ขั้น QA ได้ผู้รับ 20+ คน · จบ `approved` · RLS: leader PD1 เห็นใบ 0 · insert/update ตรง = 42501
⚠️ **ข้อสังเกต:** `four_m:approve_sv` ถือโดย leader ด้วย ⇒ "คนที่ถือคีย์" กว้างกว่าที่คนออกแบบอาจคาด — หน้าออกแบบควรโชว์ "ขั้นนี้จะได้ผู้รับกี่คน" (เฟส 2)

## 🔗 โหมดผูกเอกสาร (bound) + รอบการเซ็น (2026-11-25 · คำสั่ง user · migration `20261125b_e_workflow_bound_main.sql` apply แล้ว)
> user: *"ทุกเอกสารในระบบ เรื่อง issued/checked/approved ควรคุมด้วย e-workflow"* · *"ความถี่ในการเซ็นแต่ละเอกสารต่างกัน"* · *"ตั้งในหน้าจอได้"*

| เรื่อง | ที่อยู่ |
|---|---|
| การผูก = `flow_schema.binding = { subject, period, perShift }` (อยู่ในเวอร์ชัน ⇒ แช่แข็งตอนเผยแพร่) | ตั้งที่ `/workflow-designer` การ์ด 🔗 |
| เอกสารที่ผูกได้ (โปรแกรมเมอร์ลงทะเบียน) | `wf_bound_subjects()` (DB) ↔ `BOUND_SUBJECTS` (`src/utils/wfBound.js`) — เทสคู่ `wfBound.test.mjs` |
| ช่วงวันของรอบ (day / week บล็อก 1-7·8-14·15-21·22-สิ้นเดือน / month / quarter) | `wf_period_range()` ↔ `wfPeriodRange()` — เทสคู่ · บล็อกสัปดาห์ = LPA |
| เปิดใบรอบ | `wf_bound_ensure(key, line, date, shift)` (จอเอกสาร) · `wf_bound_scan()` cron `wf-bound-scan` 08:45 ไทย (เปิดรอบของเมื่อวานที่มีข้อมูล) |
| หาผู้เซ็นตามไลน์ | กฎ `perm_in_line` (`match: line` = ผูกไลน์นี้/ไลน์แม่ · ไม่เจอ = ทั้งส่วนงาน · `section` = ทั้งส่วนงาน) · `wf_line_candidates()` |
| แผงเซ็นบนจอเอกสาร | `src/components/WfRoundPanel.jsx` (ตัวเดียวทุกเอกสาร) |
| ล็อกข้อมูลรอบที่เซ็นแล้ว | trigger ฝั่งตารางเอกสาร (`pokayoke_checks_wf_lock` → `wf_bound_locked()`) · แก้ = `wf_revoke` (เหตุผล ≥5 ตัว · คนถือสิทธิ์ขั้นสุดท้ายของไลน์) |
| คิวงานของฉัน | `wf_tasks` ที่เปิดรอฉัน → ชั้น `unit` บรรทัดเดียวต่อใบงาน (ไม่ขึ้น badge) |

🔴 กฎ:
1. **ใบรอบระบบเปิด (`created_by` ว่าง)** — ผู้กดเปิดบันทึกแค่ใน `wf_actions` (ไม่งั้นกฎ "ผู้เปิดอนุมัติใบตัวเองไม่ได้" ตัด leader ที่บันทึกผลออกจากขั้นของตัวเอง) ⇒ ใบรอบห้ามใช้กฎ `creator`/`creator_head` (ด่านทั้ง 2 ฝั่ง)
2. **1 รอบ = 1 ใบที่มีผล** (unique `def_id + subject_key` เมื่อ in_progress/returned/approved) · ตีกลับ/เพิกถอน = เปิดรอบใหม่ได้
3. **รอบหลายวันเปิด/อนุมัติได้หลังจบรอบเท่านั้น** (เซ็นก่อนข้อมูลครบ = ลายเซ็นรับรองของที่ยังไม่เกิด) · รอบรายวันเปิดเมื่อมีข้อมูลแล้ว
4. **ใบรอบส่งกลับแก้ไม่ได้** (ไม่มีผู้เปิดให้ส่งใหม่) — ตีกลับพร้อมเหตุผล
5. **เซ็นครบ = ล็อก** ที่ DB (ไม่ใช่แค่ซ่อนปุ่ม) · เอกสารใหม่ที่จะผูก ต้องเพิ่ม: แถวใน `wf_bound_subjects()` + `BOUND_SUBJECTS` · trigger ล็อก · ตัวสแกนใน `wf_bound_scan()` · ฝัง `<WfRoundPanel subject="…">`
6. ใบรอบเห็นได้ทุกคนที่ login (`wf_can_see` · สถานะการเซ็นของใบตรวจไม่ใช่ความลับ)

**ใช้แล้ว:** Poka-Yoke — `pokayoke_daily` (Leader รับทราบ · รายวัน · แยกกะ · `pokayoke:ack` ตามไลน์) + `pokayoke_weekly` (Supervisor อนุมัติ · รายสัปดาห์ · `pokayoke:approve` ทั้งส่วนงาน)
**จำลองบนฐานจริง 25/11 (rollback):** ใบรายวัน Line 60 ได้ผู้รับ 5 (ตามไลน์) · เปิดซ้ำ = ใบเดิม · สัปดาห์ปัจจุบัน = `period_open` · สัปดาห์ 15–21/11 ผู้รับ 11 (SV PD3) · scan เปิด 4 ใบ · เซ็นแล้วแก้ผลตรวจ = ถูกบล็อก
### 🦺 BBS — เอกสารนำร่อง "สายเซ็นทั้งใบคุมด้วย e-workflow" (2026-11-25 · migration `20261125c_e_workflow_bbs_monthly_main.sql` apply แล้ว)
> user: *"ระบบเอกสารกับ e-workflow แยกกัน อยากให้รวม · อยากสร้างเอกสารอะไรก็ใช้ e-workflow สร้าง"* ·
> *"ลองทำจาก BBS ก่อน แล้วทยอยเอาที่เหลือเข้า · อนาคตไม่อยากให้มีฟอร์มที่เขียนด้วยโค้ดสด"* ·
> *"ไม่ได้หมายความว่าตรวจแล้วยังต้องออกใบมาทำ e-workflow อีก"* ⇒ **เซ็นบนใบเอกสารเอง** (แผง `WfRoundPanel`) ไม่มีใบแยก · **LPA ไม่แตะ** (การตรวจแต่ละชั้น = การเซ็นอยู่แล้ว)

| เรื่อง | ที่อยู่ |
|---|---|
| ใบงาน `bbs_monthly` (BBS) — รายเดือน ไม่แยกกะ | ผู้ตรวจ `bbs:record` ตามไลน์ (ack · ช่อง "ออกโดย") → Supervisor `bbs:check` ทั้งส่วนงาน ("ตรวจสอบโดย") → Manager `bbs:approve` ทั้งส่วนงาน ("อนุมัติโดย") |
| ผูกทะเบียนเอกสาร | `wf_bound_subjects().bbs.doc_key = 'bbs_observation'` ↔ `BOUND_SUBJECTS[].docKey` · เลขฟอร์ม/Rev/โลโก้ยังอยู่ `/doc-forms` · **ช่องเซ็นบนใบพิมพ์ = ขั้นของใบงาน** (`step.sig_label` → `signoffRows()` → `loadRoundSignoff()` `src/lib/wfSignoff.js`) |
| ใบพิมพ์ | `printBbsSheet({ signoff })` — มีใบงานผูก = ช่องเซ็นตามขั้น + ชื่อ/วันที่/ลายเซ็นโปรไฟล์ของคนที่กดเซ็นเอง · ยังเซ็นไม่ครบ = แถบเตือนบนใบ · ไม่มีใบงาน = ช่อง "ผู้ตรวจสอบ" เดิม · อ่านไม่ได้ = toast + ช่องเดิม |
| ล็อก | 🔴 **ล็อกตั้งแต่มีคนเซ็นขั้นแรก** (`wf_bound_locked` เปลี่ยน 25/11: approved **หรือ** in_progress ที่มี approve ≥1) — หลายขั้นต้องตรวจของชุดเดียวกัน · Poka-Yoke 1 ขั้นไม่เปลี่ยนพฤติกรรม · trigger `bbs_wf_lock` บน `bbs_observations`/`bbs_row_notes`/`bbs_sheets` · จอเช็คซ้ำใน `ensureSheet` (`wfLock`) |
| เปิดรอบ | หลังจบเดือน (กฎ 3) · จอ BBS ของเดือนที่ผ่านแล้ว + มีข้อมูล (`openOnlyWithData`) · cron `wf-bound-scan` เปิดเดือนก่อนที่มีผลสังเกต |
| หน้า /doc-forms | แถวที่มีใบงานคุมสายเซ็นขึ้นป้าย "✍️ สายเซ็นคุมโดย e-Workflow" + ลิงก์ไปหน้าออกแบบ |
| หน้าออกแบบ | ขั้นมีช่อง "ช่องเซ็นบนใบพิมพ์" (`sig_label`) · การ์ด 🔗 โชว์ doc_key ที่ผูก |

🔴 **ใบรอบ: 1 คนเซ็นได้ขั้นเดียวต่อใบ** (25/11 · user เคาะ · migration `20261125d_wf_bound_distinct_signer_main.sql` apply แล้ว) —
`wf_open_step()` ตัดคนที่เซ็นขั้นก่อนหน้าของใบนี้แล้วออกจากผู้รับงาน · ตัดแล้วไม่เหลือใคร = ใบค้าง + `blocked_reason` (ห้ามข้ามขั้น) ·
ใบฟอร์มทั่วไป (ไม่ผูกเอกสาร) ไม่เปลี่ยน · จำลอง: SV เซ็นขั้นผู้ตรวจ → ขั้น SV เหลือ 10 จาก 11 (ไม่มีคนนั้น)
· `owner_section` ของ `bbs_monthly` = PD3 (ตาม Poka-Yoke · admin แก้ได้)
**จำลองบนฐานจริง 25/11 (rollback):** Line 60 ต.ค. — ขั้นผู้ตรวจ 8 คน · SV PD3 11 คน · Manager PD3 1 คน (+admin) · ก่อนเซ็นแก้ได้ · เซ็นขั้นแรกแล้วแก้ = ถูกบล็อก · พ.ย. (ยังไม่จบเดือน) = `period_open` · scan เปิดรอบ ต.ค. 18 ไลน์
🐞 cron `wf-bound-scan` ของ 20261125b **ไม่ได้ลงจริง** (บรรทัด `cron.schedule` อยู่นอก transaction ตอน apply) — ลงแล้วใน 20261125c (ตรวจ `cron.job`)

### 🧩 ขั้น 2 — "ใบตรวจแบบตาราง (คน × วัน)" ออกแบบได้ในหน้าออกแบบใบงาน (2026-11-26 · migration `20261126_wf_checkgrid_main.sql` apply แล้ว)
> user: *"สร้างใบตรวจแบบตารางได้ทุกแบบ"* · *"ข้อ 1 เริ่มตารางใหม่ 1 ธ.ค."* · *"พอขึ้นตารางใหม่ค่อยย้าย data เก่ามาใส่ย้อนหลังให้ แล้วลบตารางเดิมทิ้ง"*

| เรื่อง | ที่อยู่ |
|---|---|
| ใบงาน = ผูกเอกสาร `binding.subject = 'grid'` + ช่องชนิด `checkgrid` 1 ช่อง | ตั้งที่ `/workflow-designer` (ตัวตั้งค่า `src/components/WfGridFieldEditor.jsx`) |
| นิยามช่อง: แหล่งแถว · คีย์สิทธิ์บันทึก (`recordPerm`) · ทะเบียนเอกสาร (`docKey` → `/doc-forms`) · สัญลักษณ์ (`marks[]` รหัส/ตัวในช่อง/ความหมาย/สี token/ต้องระบุข้อ/แจ้ง) · หัวข้อ (`items[]` + `auto`) · ตัวเติม (`autofill`) · แจ้งเตือน (`alertEvent` = event_key ใน notification_rules) · หมายเหตุท้ายแถว | ของกลาง `src/utils/checkGrid.js` (`validateGrid` · `ppeToGridCell` · `GRID_ROW_SOURCES` · `GRID_AUTOFILL` · `GRID_COLORS`) |
| ข้อมูล (Main) | `wf_grid_sheets` (ใบงาน × ไลน์ × รอบ) · `wf_grid_cells` (row_key × col) · `wf_grid_row_notes` — RLS เขียน = `wf_grid_can_write(def_key)` = has_perm(`recordPerm` ของฟอร์มเวอร์ชันที่ใช้อยู่) · ไม่มีใบงาน/ไม่ตั้งคีย์ = เขียนไม่ได้ |
| ล็อก | trigger `wf_grid_lock` ทั้ง 3 ตาราง → `wf_grid_locked(def_key, line, from)` (มีคนเซ็นแล้ว = ล็อก) |
| จอ | `src/components/WfGridSheet.jsx` (ตาราง desktop + การ์ดรายวันมือถือ + หมายเหตุ + เติมอัตโนมัติ + ตัวหาร/วันหยุด/ไลน์ไม่เดิน + แผงเซ็น `WfRoundPanel defKey`) |
| ใบพิมพ์ | `src/lib/gridPrint.js` (หัว = /doc-forms · ช่องเซ็น = ขั้น · ข้อความบังคับ "ระบบเติมได้ N จาก M ข้อ") |
| ด่านเผยแพร่ | `wf_request_publish` (DB) ↔ `validateDef` (จอ): grid ต้องมี checkgrid 1 ช่อง + คีย์บันทึก · ไม่แยกกะ · checkgrid ห้ามอยู่ในใบที่ไม่ใช่ grid |
| ตัวสแกน | `wf_bound_scan` เปิดใบรอบของใบที่มีข้อมูล + รอบจบแล้วภายใน 40 วัน |

🦺 **BBS ตั้งแต่ ธ.ค. 2569 = ใบงาน `bbs_grid`** (`BBS_GRID_FROM` ใน checkGrid.js · `BbsCheck.jsx` แตกสาขาตามเดือน) · หัวข้อ 13 ข้อยกจาก `bbs_agreements` ณ 26/11 ·
แก้หัวข้อ/สัญลักษณ์ = หน้าออกแบบ → เวอร์ชันใหม่ → admin เผยแพร่ (ไม่ใช่ปุ่ม 📋 ข้อตกลงบนจอ BBS เดิม)
· ⚠️ ของที่ใบใหม่**ไม่มี**: ช่อง "ผู้ตรวจ" + สแกนรหัสพนักงาน/ลายเซ็นจากฐานพนักงาน (C1 03/11) — ผู้ตรวจ = คนที่เซ็น "ออกโดย" ในสายเซ็น (ลายเซ็นโปรไฟล์ของตัวเอง)
· ⏳ **ค้าง (คำสั่ง user):** ย้ายข้อมูล ต.ค.–พ.ย. จาก `bbs_*` เข้า `wf_grid_*` (สำเนาเก่าเก็บ `archive`) → ตรวจนับตรง → ลบตาราง `bbs_*` + ใบงาน `bbs_monthly` — **ทำหลังใบใหม่ขึ้นใช้จริง · ถาม user ยืนยันก่อนลบ**
· ฮาร์เนส: `?wfgrid=1` = ใบงานตัวอย่าง (`audit/mockSupabase.js`)

**ยังไม่ย้าย:** LPA (ตั้งใจ — ตรวจแล้ว = เซ็น) · AM · 4M (ย้ายทีละตัวตามที่ user สั่ง)

## ⏳ ยังไม่ทำ (ตั้งใจ — ตาม E-WORKFLOW-DESIGN §13)
- โหมด `bound` ทำแล้วสำหรับ "ใบรอบเอกสาร" (25/11 ↑) · ใบเสนอราคา/4M ยังไม่ผูก
- `when` ข้ามขั้น · ขั้นขนาน · ช่องตาราง · SLA + escalation (`pg_cron`) · มอบอำนาจ (§9.5) · ทดลองรัน `is_test` · ใบพิมพ์ + `doc_forms`
- พรีวิวจำนวนผู้รับต่อขั้นในหน้าออกแบบ · ~~คิวงานของฉันยังไม่ดึง `wf_tasks`~~ (ดึงแล้ว 25/11)
- `wf:view_all:<key>` มีในตัวตัดสินการเห็นแล้ว แต่ยังไม่มีจอแจกคีย์ (ตั้งที่ `/permissions` เองได้)

## ประวัติ
- 2026-11-13 เฟส 1: ตาราง/RPC/หน้าใช้งาน/หน้าออกแบบ/แม่แบบ 4M
