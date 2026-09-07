# 🚀 NPI — พาร์ทใหม่ APQP / PPAP / Drawing Rev / ECI / Tooling Plan (`/npi` · 2026-09-07)

> โหลด**เฉพาะเมื่อแตะโมดูลนี้** · แก้ไฟล์นี้แทน CLAUDE.md เมื่อกฎของโมดูลเปลี่ยน
> ที่มา: user ส่งเดคขาย **E-SPT (VR Intelligence · ระบบ SPTT ของ BKF/โตโยต้า)** มาให้รีวิว แล้วสั่ง
> *"ให้ ESM ครอบคลุมทั้งหมดของโปรแกรมนี้ — ไล่ทำเรื่องที่ยังไม่ต้องยุ่งกับ supplier ก่อน อยู่ในหมวด engineering"*
> = เฟส 1-3 ของแผนที่เสนอ (ตัวติดตามเฟส/PPAP · แบบ+ECI · tooling plan) · **เฟส 4 supplier portal ยังไม่ทำ** (ดู §8)

## 1. โมดูลนี้คืออะไร / วางตรงไหนในภาพรวม

ESM ที่มีอยู่คุม **mass production** (ปลายน้ำ) — โมดูลนี้คือ **ต้นน้ำ**: ติดตามพาร์ทรุ่นใหม่ตั้งแต่รับงานลูกค้าจนถึง SOP
แล้วส่งไม้ต่อให้ของเดิมด้วย "ตัวเชื่อม" ไม่ใช่ master ชุดใหม่:

| ของใน NPI | เชื่อมกับ (มีอยู่แล้ว) | คอลัมน์ |
|---|---|---|
| พาร์ท | ชุด PFC/PFMEA/CP `/pe-docs` | `npi_parts.pe_set_id → pe_doc_sets` |
| พาร์ท | มาตรฐานตรวจ + drawing balloon `/qa-setup` | `npi_parts.qa_part_id → qa_parts` |
| พาร์ท | Product Master (DR) | `npi_parts.mat_no` (text) |
| แผน tooling | ทะเบียนแม่พิมพ์ `/die-registry` (DR) | `npi_tooling_plans.die_set_code` (text = `die_sets.set_code`) |
| ECI ขา PE | คำขอแก้เอกสาร PE (ลูปปิด 8D) | `npi_change_requests.pe_change_request_id → pe_change_requests` |
| ECI ขากระบวนการ | ใบ 4M Method | `npi_change_requests.four_m_log_id → four_m_logs` |
| ECI ขาแบบ / tooling | ทะเบียน rev แบบ / แผน tooling ในโมดูลเดียวกัน | FK |

เทียบ E-SPT: Problem follow-up + Dashboard ของ ESM ครอบคลุมกว่าอยู่แล้ว (8D closed-loop · dept-dashboard) จึง**ไม่สร้างซ้ำ** —
ที่สร้างใหม่คือ 3 ก้อนที่ IATF gap review (2026-08-14) ระบุว่าไม่มี: **APQP tracker · PPAP register · ECN workflow** + tooling development plan

## 2. หน้า `/npi` (`src/pages/NPI.jsx` · หมวด คุณภาพ & วิศวกรรม)

6 แท็บ (`useTabParam`) · param เพิ่ม `?project=<id>&part=<id>` (deep-link ได้):

| แท็บ | ทำอะไร | component |
|---|---|---|
| 📊 บอร์ด | การ์ดทุกโปรเจค (ไฟสี+%+นับถอยหลัง SOP) · KPI 7 ตัว · **ตารางพาร์ท × เฟส** เป็นไฟสี (Obeya แบบ E-SPT Project Dashboard) | ใน NPI.jsx |
| 📦 พาร์ท & PPAP | ตารางพาร์ท → แผงพาร์ท: เฟส (การ์ด timeline) · เอกสารส่งมอบจัดกลุ่มตามเฟส (= ทะเบียน PPAP) · สถานะ PPAP/PSW · 🖨️ PPAP checklist · 🔄 sync แม่แบบ | `NpiPartPanel.jsx` |
| 📐 แบบ & ECI | ทะเบียน revision แบบ 2D/3D/spec ต่อพาร์ท (ร่าง → ปล่อย → ยกเลิก) + ECI ของโปรเจค | `NpiDrawingsEci.jsx` |
| 🔧 Tooling | แผนทำแม่พิมพ์/จิ๊ก/CF/เกจ เป็น Gantt (แผน/จริง/เส้นวันนี้) + ขั้นงานจากแม่แบบ | `NpiTooling.jsx` |
| ✅ งาน | มอบหมายงาน ผูกพาร์ท/เฟส/รายการเอกสาร · แจ้งเข้ากระดิ่งคนนั้น | `NpiTasks.jsx` |
| ⚙️ แม่แบบ | เฟส + รายการเอกสารต่อลูกค้า (gate `npi:manage_templates` · แท็บท้ายสุดตาม UI §6.8) | `NpiTemplates.jsx` |

ชิ้นส่วนร่วม `src/components/NpiUi.jsx` (Modal ไม่ปิดจาก backdrop · Pill · LightDot · Field · uploadNpiFile) · สูตร/สถานะทั้งหมด `src/utils/npi.js` (pure · เทส `src/utils/__tests__/npi.test.mjs` 11 เคส) · ใบพิมพ์ `src/lib/npiPpapPrint.js`

## 3. ตาราง (Main project — 13 ตาราง · prefix `npi_` · migration `20260907_npi_apqp_main.sql`)

**ทำไม Main ไม่ใช่ DR:** เอกสารควบคุมมี workflow อนุมัติ ต้องอยู่ฝั่ง authenticated (เหตุผลเดียวกับ `pe_*`) และเฟส 4 จะเปิดให้ **supplier ภายนอก login** ซึ่งทำได้เฉพาะฝั่งที่มี auth — **ห้ามย้ายชุดนี้ไป DR (anon-open) เด็ดขาด** ไม่งั้น supplier เห็นข้อมูลผลิตทั้งโรงงานผ่าน anon key

| ตาราง | คืออะไร | จุดสำคัญ |
|---|---|---|
| `npi_templates` | แม่แบบต่อลูกค้า/สไตล์ (seed: `apqp_aiag` · `toyota_sptt`) | `code` สร้างแล้วห้ามแก้ |
| `npi_template_phases` | เฟสในแม่แบบ (code/label/seq/color) | unique (template, code) |
| `npi_template_deliverables` | รายการเอกสารในแม่แบบ: phase_code · doc_kind · required · **ppap_element** · owner_role | seed APQP 36 รายการ (PPAP 18 elements ติ๊ก ppap_element) · SPTT 28 รายการ |
| `npi_projects` | โปรเจครุ่นใหม่: code (NPI-YYYY-###) · customer · model · **template_id** · kickoff/sop_date · status | เปลี่ยนแม่แบบไม่ได้เมื่อมีพาร์ทแล้ว (UI lock) |
| `npi_parts` | พาร์ทในโปรเจค + **PPAP/PSW** (ppap_level 1-5 · ppap_status · psw_no/submitted/approved) + ตัวเชื่อม pe_set_id / qa_part_id / mat_no / die_set_code | unique (project, part_no) |
| `npi_part_phases` | เฟสรายพาร์ท (snapshot label) · plan/actual start-end · status | unique (part, phase_code) |
| `npi_deliverables` | เอกสารส่งมอบรายพาร์ท (= **ทะเบียน PPAP** เมื่อ ppap_element) · status · due/done · approved_by · ref_kind/ref_id · file_url | unique (part, code) · **approved ต้องมี approved_by** (check) |
| `npi_tasks` | งานมอบหมาย · assignee_uid (แจ้งกระดิ่ง) | — |
| `npi_drawing_revisions` | rev แบบต่อพาร์ท: kind 2d/3d/spec · rev · eci_no · file_url/external_url · status draft/released/obsolete · **is_current** | unique (part, kind, rev) · **partial unique: is_current ตัวเดียวต่อ (part, kind)** · released ต้องมี released_by |
| `npi_change_requests` | **ECI**: source · status open/evaluating/approved/implemented/rejected · 4 ขาผลกระทบ + FK ของจริง | **check: implemented ต้องผูกครบทุกขาที่ติ๊ก** · rejected ต้องมีเหตุผล |
| `npi_tooling_step_templates` | แม่แบบขั้นงานต่อชนิด (seed 32 ขั้น: die 11 · jig 6 · CF 5 · gauge 3 · mold 4 · other 3) | default_days ใช้เสนอวันแผน |
| `npi_tooling_plans` | แผนต่อเครื่องมือ: tool_kind · maker_name (text) · maker_kind · po · die_set_code · plan/actual · status | maker = text ก่อน (§8) |
| `npi_tooling_steps` | ขั้นงาน Gantt: seq · plan/actual · progress_pct · status | — |

ทุกตาราง: RLS authenticated (สิทธิ์ทำงานคุมที่ UI) · `updated_at` trigger · **audit `fn_audit`** (ป้ายไทยใน `auditLabels.js` แล้ว)
· bucket **`npi-files`** (public · 20MB · pdf/รูป/xlsx/docx/pptx — **ไม่รับไฟล์ 3D** ใช้ `external_url`) · รูปบีบ 2560px/q0.9 (tier drawing)

## 4. กฎที่ตกผลึก (ห้ามแก้ย้อนโดยไม่ update ไฟล์นี้)

1. **เฟส/รายการเอกสาร = data-driven ต่อลูกค้า** — ห้าม hardcode SPTT0-4/APQP ในโค้ด (E-SPT ล็อกโตโยต้าไว้ = ใช้กับ Ford ไม่ได้) · ลูกค้าใหม่ = เพิ่มแม่แบบที่แท็บ ⚙️
2. **พาร์ทถือ snapshot** — `buildPartRows()` ก๊อปเฟส+รายการจากแม่แบบตอนสร้าง · แก้แม่แบบทีหลัง**ไม่ย้อนแก้**พาร์ท (เอกสารที่ส่งลูกค้าแล้วต้องนิ่ง) · 🔄 sync = เติมเฉพาะ `code` ที่ยังไม่มี ไม่แตะของเดิม
3. **ไฟสีไม่เก็บใน DB** — `deliverableLight/phaseRollup/partRollup/projectRollup/stepLight/toolingRollup` ใน `utils/npi.js` เท่านั้น · เกณฑ์: 🟢 approved/เสร็จ · 🟡 กำลังทำ/รออนุมัติ/เหลือ ≤ `DUE_SOON_DAYS`=7 · 🔴 เลย due/ตีกลับ/**เฟสเลย plan_end โดยยังไม่ปิด** (timing = สัญญากับลูกค้า ชนะสถานะเอกสาร)
4. **วันแผนที่ระบบเสนอ = ข้อเสนอ ไม่ใช่การตัดสิน** — สร้างพาร์ทแล้วรู้ kickoff+SOP จะกระจายเฟสเท่าๆ กัน (เฟสสุดท้ายจบวัน SOP) · due ของเอกสาร = plan_end ของเฟส · ไม่รู้ = ว่าง **ไม่เดา** · tooling steps ต่อเนื่องจากวันเริ่มตาม default_days
5. **ECI ปิด (implemented) ต้องมีของจริงครบทุกขา** — ขาแบบ→`npi_drawing_revisions` · ขา PE→`pe_change_requests` · ขากระบวนการ→`four_m_logs` (Method) · ขา tooling→`npi_tooling_plans` · UI เตือน + DB check ซ้ำ (หลักเดียวกับ `pe_change_requests.applied`) · **ระบบไม่สร้างใบ 4M/คำขอ PE ให้เอง** — คนเปิดที่หน้าเดิมแล้วมาผูก (ระบบเสนอ คนตัดสิน)
6. **approved / released / ตัดสิน ECI / ผล PPAP จากลูกค้า = `npi:approve`** — เอกสารส่งมอบตั้ง approved ได้เฉพาะคนมีสิทธิ์ (บันทึกชื่อ+เวลา) · rev แบบ "ปล่อย" แล้วเป็นปัจจุบันตัวเดียว rev เดิมกลายเป็น obsolete
7. **ห้ามเงียบ** — โหลดทะเบียนไม่ได้/ยังไม่ apply migration = `WarnBar` แดงบนหน้า · ไม่มีสิทธิ์ = `ReadOnlyNote` · รายการที่ตัวกรองซ่อน/พาร์ทไม่มีเฟส/แม่แบบไม่มีเฟส/ผู้รับงานไม่ใช่ user ระบบ (ไม่มีแจ้งเตือน) บอกบนจอทั้งหมด
8. **บอร์ดรวมดึงทุกโปรเจคแบบ paginate** (`fetchAll` ใน NPI.jsx) — เอกสาร 36 รายการ/พาร์ท × 30 พาร์ท เกิน 1000 แถวแล้ว
9. **ไฟล์ 3D ไม่เก็บ** — ใหญ่ + ไม่มี viewer → เก็บทะเบียน rev + `external_url` (PLM/แชร์ไดรฟ์) · PDF/รูป เก็บใน `npi-files`
10. **ใบพิมพ์ PPAP checklist** = รายงานภายใน ห่อ `withDocFoot(html,'npi_ppap_checklist')` · doc_forms seed `form_code=null` ให้ doc_control ตั้งเอง · ห้าม InfoMore ฝั่งเอกสาร

## 5. สิทธิ์ (seed ใน migration — ระบุ role ชัด ห้าม enum_range)

| key | ความหมาย | seed |
|---|---|---|
| `page:/npi` | เข้าหน้า (ดู) | ทุก role 11 ตัว |
| `npi:edit` | สร้าง/แก้โปรเจค พาร์ท เอกสารส่งมอบ แบบ(ร่าง) ECI(รับเรื่อง/ประเมิน) tooling งาน | admin · manager · engineer · qa · supervisor |
| `npi:approve` | อนุมัติเอกสารส่งมอบ · ผล PPAP จากลูกค้า · ปล่อยแบบ · อนุมัติ/ปฏิเสธ/ปิด ECI | admin · manager · engineer |
| `npi:manage_templates` | แท็บ ⚙️ แม่แบบ | admin · manager · engineer |

catalog group 'คุณภาพ & วิศวกรรม' sort 755-757 · `page:/npi` อยู่ใน `PAGE_GROUPS` ของ PermissionsManagement แล้ว

## 6. แจ้งเตือน

- `notification_rules`: `npi_eci_decided` (ตัดสิน ECI) · `npi_ppap_submitted` (ส่ง/ผล PPAP) — seed inapp_roles engineer/qa/manager/admin · ห้อง Telegram ตั้งที่ `/notification-config` · ยิงผ่าน `notifyEvent()` (fire-and-forget)
- มอบหมายงาน → insert `notifications` ตรงถึง `assignee_uid` (policy `notifications_insert_authenticated` · pattern เดียวกับ mention) · ผู้รับที่พิมพ์ชื่อเอง = ไม่มีแจ้งเตือน (บอกบนจอ)
- **ยังไม่มี**: cron เตือนเอกสาร/ขั้น tooling ที่จะเลยกำหนด (ดู §8)

## 7. วิธีใช้บนพาร์ทต้นแบบ (golden thread 060/061)

1. `/npi` → + โปรเจค (แม่แบบ APQP (AIAG) · ใส่ kickoff + SOP) → + พาร์ท → เลือกชุด PE `MB3B-16E060-CH` (เติม part_no/ชื่อ/ไลน์ให้) → ได้ 5 เฟส + 36 รายการทันที
2. รายการ PPAP 5/6/7 (PFC/PFMEA/CP) ตั้ง ref_kind = ชุด PE → ลิงก์ไป `/pe-docs?set=` ของพาร์ทนั้น · รายการตรวจวัดผูก QA part
3. 🔧 Tooling + แผน (die) → ได้ 11 ขั้นตามลำดับ TMS → transfer แล้วใส่ `die_set_code` = ทะเบียนแม่พิมพ์รับช่วง
4. ลูกค้าส่ง ECI → 📐 แบบ & ECI: + Rev แบบ (ร่าง) → + ECI ติ๊กขาที่กระทบ → เปิดคำขอแก้ PE ที่ `/pe-docs` + ใบ 4M Method ตามปกติ → กลับมาผูก → ✅ ปิดงาน

## 8. ยังไม่ทำ (เฟสถัดไป — จดไว้ไม่ให้เดาว่าลืม)

- **เฟส 4 Supplier portal** (ผู้ทำแม่พิมพ์/บรรจุภัณฑ์/วัตถุดิบ login มาอัพเดทเอง): ต้อง (ก) supplier master + `supplier_id` บน `npi_tooling_plans` (additive แทน maker_name) (ข) role `supplier` scope ด้วย supplier_id (ค) **หน้าสำหรับ supplier ห้ามแตะ `supabaseDR`** และต้องทบทวน RLS ของตาราง npi_* ให้ scope ตาม supplier ก่อนเปิด — งานที่ต้องหยุดถาม user ก่อน merge
- cron/Edge `npi-due-scan` เตือนเอกสาร/ขั้นงานที่จะเลยกำหนดใน 7 วัน (ตอนนี้เห็นเฉพาะตอนเปิดหน้า)
- ฟอร์มเฉพาะโตโยต้า (CF concept builder / ATIS builder) — ไม่ทำจนกว่ามีงานโตโยต้าจริง; ใช้ `/qa-setup` + doc-forms export แทน
- import แม่แบบ/รายการจาก Excel ของลูกค้า · export timing chart เป็น Excel
- ผูก `npi_parts` → สร้าง `dr_products` อัตโนมัติตอน SOP (ตอนนี้ mat_no เป็น text เชื่อมมือ)
- แถวเก่าใน ECI ที่ผูก `four_m_log_id` แล้วใบ 4M ถูก reject — ยังไม่มีสัญญาณย้อนกลับมาที่ ECI

## 9. ประวัติ

- 2026-09-07 เฟส 1-3 ครบ: migration + `/npi` 6 แท็บ + util/เทส + ใบ PPAP checklist · crash-sweep ผ่านทุกแท็บ 1500/390px · **migration ยังไม่ apply — user รันเองที่ SQL Editor (Main)**
