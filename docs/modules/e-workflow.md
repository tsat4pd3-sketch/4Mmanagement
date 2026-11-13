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

## ⏳ ยังไม่ทำ (ตั้งใจ — ตาม E-WORKFLOW-DESIGN §13)
- โหมด `bound` (ใบโค้ดเดิม/ใบเสนอราคาใช้ engine คุมสายอนุมัติ) · เอา flow เดิม (4M ฯลฯ) ให้แต่ละโรงงาน config
- `when` ข้ามขั้น · ขั้นขนาน · ช่องตาราง · SLA + escalation (`pg_cron`) · มอบอำนาจ (§9.5) · ทดลองรัน `is_test` · ใบพิมพ์ + `doc_forms`
- พรีวิวจำนวนผู้รับต่อขั้นในหน้าออกแบบ · คิวงานของฉัน (`myQueue.js`) ยังไม่ดึง `wf_tasks` (ตอนนี้ดูที่แท็บ "รอฉัน" + กระดิ่งแจ้งเตือน)
- `wf:view_all:<key>` มีในตัวตัดสินการเห็นแล้ว แต่ยังไม่มีจอแจกคีย์ (ตั้งที่ `/permissions` เองได้)

## ประวัติ
- 2026-11-13 เฟส 1: ตาราง/RPC/หน้าใช้งาน/หน้าออกแบบ/แม่แบบ 4M
