# 🧩 E-WORKFLOW-DESIGN — ใบงานที่ user สร้างเอง (Low-code / No-code e-Workflow)

> **สถานะ: ออกแบบไว้ ยังไม่ลงมือ** (2026-11-13 · คำสั่ง user "ทำเอกสารออกแบบ E-WORKFLOW-DESIGN.md ก่อน")
> 📌 อยู่ในรายการ "ออกแบบไว้แล้ว ยังไม่ลงมือ — ห้ามหยิบไปทำเองจนกว่า user สั่ง" (`docs/modules/file-structure.md`)
> คำถามที่ยังรอ user ตอบ → **§14** (ห้ามเดาคำตอบแล้วลงมือ)

---

## 1. ปัญหาที่จะแก้

ตอนนี้ใบที่ส่งต่อกันมี 17 ใบ (`docs/modules/step-flow.md`) แต่**ทุกใบเขียนขั้นตอนไว้ในโค้ด**
(`fourMFlow()` · `moFlow()` · `ncrFlow()` …) ⇒ หน่วยงานอยากได้ใบขออนุมัติใหม่ 1 ใบ = ต้องรอโปรแกรมเมอร์
สร้างตาราง + หน้า + RLS + แจ้งเตือน + ใบพิมพ์ ใหม่ทั้งชุด

**เป้า:** user ที่ได้รับสิทธิ์ **สร้างฟอร์ม + กำหนดสายอนุมัติ + เผยแพร่** ได้เองจากหน้าจอ โดยไม่ต้องแก้โค้ด/deploy
และใบที่สร้างเองต้องได้ "ของมาตรฐาน" ครบเท่ากับใบที่เขียนด้วยโค้ด: สิทธิ์ 3 ชั้น · คิวงาน · แจ้งเตือนในแอป ·
แถบขั้นตอน · เลขที่ใบ · ใบพิมพ์ใน `/doc-forms` · ประวัติการเซ็น

### คำถามทดสอบ (ENGINEERING-PRINCIPLES §1 ข้อ 4)
"ถ้าพรุ่งนี้มี 10 หน่วยงานขอใบใหม่ ต้องแก้โค้ดไหม" → หลังทำเสร็จต้องตอบว่า **ไม่ต้อง**

---

## 2. ขอบเขต

### ✅ ทำ
- ใบงานทั่วไปที่เป็น "กรอก → ส่ง → อนุมัติทีละขั้น/พร้อมกัน → จบ" และ**ไม่มีสูตรธุรกิจผูก**
  (ตัวอย่างชนิดใบ: ขออนุมัติทั่วไป · ขอใช้ทรัพยากร · แจ้งเรื่อง/ขอเปลี่ยนแปลงที่ไม่กระทบตัวเลขผลิต)

- **โหมดผสม (hybrid · user เคาะ 13/11)** — ใบที่มีสูตร/ราคา: **หน้ากรอก+คำนวณเขียนเป็นโค้ด** (สูตรอยู่ utils กลาง) แล้ว **ใช้ engine คุมเฉพาะสายอนุมัติ** (§7.5) · ใบนำร่อง = **ใบเสนอราคา Marketing**

### ❌ ไม่ทำ (ตั้งใจ ไม่ใช่ลืม)
| ไม่ทำ | เหตุผล |
|---|---|
| **ย้ายใบเดิม 17 ใบเข้า engine** (MO · 4M · ถังเหลือง/แดง · NCR · 8D …) | ผูกกับ OEE/%Q/สต๊อก/ทักษะ/ปิดกะ ลึก — ย้าย = blast radius ทั้งโรงงาน · ไม่มีประโยชน์เพิ่ม |
| ให้ user เขียนสูตร/สคริปต์อิสระ | สูตรเป็นของ `src/utils/` ที่เดียว (single source of truth) · สคริปต์อิสระ = ช่องโหว่ + จอโกหก |
| ตารางบนฝั่ง DR | `supabaseDR` = anon เสมอ ⇒ คุมสิทธิ์ไม่ได้ (CLAUDE.md §Supabase Projects) |
| ใบที่สร้างเองเขียนลงตารางธุรกิจอื่น (เช่น ตัดสต๊อก/เปิดใบซ่อมอัตโนมัติ) | เฟสนี้ไม่ทำ · ถ้าจะทำต้องเป็น "action ที่โปรแกรมเมอร์ลงทะเบียนไว้" ไม่ใช่ user ประกอบเอง (§13 เฟสถัดไป) |
| แจ้งเตือนทาง Telegram | กฎ: แจ้งเตือนใหม่ = ในแอปเท่านั้น (CLAUDE.md §Edge Functions) |

---

## 3. ของที่มีอยู่แล้ว — ใช้ต่อ ห้ามสร้างชุดที่ 2

| ต้องการ | ใช้ของเดิม | หมายเหตุ |
|---|---|---|
| สิทธิ์ปุ่ม/หน้า | `role_permissions` + `can()` + `has_perm()` | คีย์ใหม่ดู §9 |
| ขอบเขต "แถวนี้ของหน่วยเราไหม" | `src/utils/writeScope.js` · `ccScope.js` | ห้ามเขียนกฎขอบเขตใหม่ในโมดูลนี้ |
| ผังองค์กร/หาหัวหน้า | `org_nodes.parent_id` + `src/utils/orgLayers.js` | ลำดับชั้นมาจาก `parent_id` เท่านั้น |
| รักษาการ | `org_assignments` (`kind = head/acting` · `starts_on/ends_on`) + `assignmentOverlay.js` | ใช้หาผู้อนุมัติแทนตอนหัวหน้าไม่อยู่ |
| แจ้งเตือน | `notification_rules` → `notify_recipients()` → `notifications` | งานที่รอคนลงมือ = `can_mute=false` |
| คิวงาน | `src/utils/myQueue.js` (`mine`/`unit`/`floor`) | ใบที่รอเราตรง = `mine` |
| แถบขั้น | `<StepFlow>` + `linearFlow()` (UI §6.30 ใบงาน) | ขั้นขนานดู §8.3 |
| ยืนยันก่อนเซ็น | `src/utils/signConfirm.js` | ต้องบอก อนุมัติอะไร · ใบไหน · ในนามใคร |
| ทะเบียนเอกสาร | `doc_forms` + `utils/docForms.js` | ทุกใบที่เผยแพร่ต้องมี `doc_key` |
| เลขที่ใบ/ใบพิมพ์ | แบบ `src/lib/prodProblemDoc.js` | เลข = สูงสุดของเดือน+1 · เก็บ `snapshot` |
| ประวัติใครแก้ | `audit_log` (trigger) + `actorStamp.js` | ผูก uid คู่ชื่อ |
| ร่างฟอร์มบนมือถือ | `src/utils/formDraft.js` | |
| ช่องกรอกคน/เครื่อง/MAT/ไลน์ ฯลฯ | picker กลาง (UI §5.1.2) | ห้าม `<input>` เปล่า |
| อัปโหลดรูป | `ImageCropModal` + `uploadOpts()` + `acceptImageFile()` | |
| ปฏิทินบริษัท | `src/utils/companyCalendar.js` | ใช้คิด SLA (§10) |
| งานตั้งเวลา | `pg_cron` (มีใช้แล้ว เช่น `20260708_pm_daily_scan_cron.sql`) | ใช้ไล่ SLA |

---

## 4. แนวคิดหลัก — 4 ชั้น

```
นิยาม (Definition)          ← คนออกแบบสร้าง/แก้ได้
  └ เวอร์ชัน (Version)        ← เผยแพร่แล้ว = แช่แข็ง ห้ามแก้
       └ ใบ (Instance)         ← ผู้ใช้เปิดใบ · ตรึง version_id ตั้งแต่เปิด
            ├ งานรอทำ (Task)    ← ขั้นปัจจุบันมอบให้ใคร (1 ใบมีได้หลาย task ตอนขั้นขนาน)
            └ การกระทำ (Action) ← บันทึกทุกการกด (append-only)
```

🔴 **ใบที่เปิดแล้วเดินตามเวอร์ชันที่ตรึงไว้ตลอดชีวิตใบ** — แก้ flow วันนี้ห้ามทำให้ใบค้างเมื่อวานเพี้ยน
(หลักเดียวกับ `ct_snapshot`/`break_snapshot` ตอนปิดกะ)

---

## 5. Schema (Main project · `ewhdfqwfwofivojtsizn` · จอ Supabase "MAIN")

> ร่างเพื่อให้เห็นโครง — ชื่อคอลัมน์จริงยืนยันตอนลงมือ · ทุกตาราง: RLS ครบทุก cmd + GRANT ครบ + audit trigger + migration file

### 5.1 `wf_defs` — นิยามใบ
| คอลัมน์ | ชนิด | หมายเหตุ |
|---|---|---|
| `id` | uuid pk | |
| `key` | text unique | สั้น อังกฤษ ใช้ทำคีย์สิทธิ์ (`wf:start:<key>`) · **ตั้งแล้วห้ามเปลี่ยน** |
| `name` | text | ชื่อที่โชว์ |
| `owner_org_node_id` | uuid → `org_nodes` | หน่วยเจ้าของนิยาม (ใช้ตัดสินว่าใครแก้นิยามได้ · §9) |
| `doc_key` | text | ผูก `doc_forms` (เลขฟอร์ม/Rev/โลโก้) |
| `number_prefix` | text | คำนำหน้าเลขที่ใบ |
| `status` | text | `draft` / `active` / `retired` (เลิกใช้ = ห้ามเปิดใบใหม่ · ใบเก่ายังเดินจนจบ) |
| `current_version_id` | uuid → `wf_versions` | เวอร์ชันที่ใบใหม่จะใช้ |

### 5.2 `wf_versions` — เวอร์ชันแช่แข็ง
| คอลัมน์ | ชนิด | หมายเหตุ |
|---|---|---|
| `id` | uuid pk | |
| `def_id` | uuid → `wf_defs` | |
| `version_no` | int | unique (`def_id`,`version_no`) |
| `form_schema` | jsonb | §6 |
| `flow_schema` | jsonb | §7 |
| `status` | text | `draft` / `published` |
| `published_at` / `published_by` | | |

🔴 trigger ฝั่ง DB: แถว `published` **ห้าม UPDATE `form_schema`/`flow_schema`** (แก้ = สร้างเวอร์ชันใหม่)

### 5.3 `wf_instances` — ใบ
| คอลัมน์ | ชนิด | หมายเหตุ |
|---|---|---|
| `id` | uuid pk | |
| `def_id` / `version_id` | uuid | ตรึงตอนเปิด |
| `doc_no` | text | เลขที่ใบ ออกตอน "ส่ง" ไม่ใช่ตอนร่าง |
| `data` | jsonb | คำตอบของฟอร์ม |
| `status` | text | `draft` / `in_progress` / `approved` / `rejected` / `cancelled` / `returned` |
| `current_step` | text | key ของขั้นปัจจุบัน (null = จบ) |
| `step_rev` | int | เพิ่มทุกครั้งที่ขั้นเปลี่ยน — ใช้ compare-and-swap กันกดซ้อน (§8.2) |
| `org_node_id` / `cost_center` / `line_id` | | **หน่วยของใบ** — ใช้กับ `writeScope` |
| `created_by` / `created_at` / `submitted_at` / `closed_at` | | |
| `is_test` | bool default false | ใบทดลอง (§11) — ไม่นับรายงาน |
| `snapshot` | jsonb | ภาพใบตอนจบ (ใช้พิมพ์ซ้ำ) |

### 5.4 `wf_tasks` — งานรอทำ
`id` · `instance_id` · `step_key` · `assignee_profile_id` (null ได้ถ้ามอบให้ "ใครก็ได้ที่ถือสิทธิ์ X ในหน่วย Y") ·
`assignee_rule` jsonb (ผลการ resolve ตอนสร้าง task — เก็บไว้ตรวจย้อน) · `via_assignment_id` (มาจากรักษาการ) ·
`status` (`open`/`done`/`skipped`/`cancelled`) · `due_at` · `escalated_at`

### 5.5 `wf_actions` — บันทึกการกด (append-only)
`id` · `instance_id` · `task_id` · `step_key` · `action` (`submit`/`approve`/`reject`/`return`/`cancel`/`comment`/`escalate`/`reassign`) ·
`comment` · `actor_uid` · `actor_name` (stamp ผ่าน `actorStamp.js`) · `acted_at` · `on_behalf_of` (รักษาการ)
🔴 **ไม่มี policy UPDATE/DELETE เลย** — เป็นหลักฐาน

### 5.6 เลขที่ใบ
ออกใน RPC ตอน `submit` · **สูงสุดของเดือน+1 ห้าม `count()+1`** (กฎใบที่มีเลขที่ · CLAUDE.md §ใบรายงานปัญหาการผลิต)
· ล็อกด้วย `pg_advisory_xact_lock(hash(def_id, เดือน))` กันเลขชน

---

## 6. Form schema (`wf_versions.form_schema`)

```json
{
  "sections": [
    { "key": "s1", "title": "ข้อมูลคำขอ", "fields": [
      { "key": "reason",  "type": "textarea", "label": "เหตุผล", "required": true, "maxLength": 1000 },
      { "key": "machine", "type": "machine",  "label": "เครื่อง" },
      { "key": "amount",  "type": "number",   "label": "จำนวน", "min": 0 },
      { "key": "urgent",  "type": "yesno",    "label": "ด่วน" },
      { "key": "detail",  "type": "text",     "label": "รายละเอียดด่วน",
        "showIf": { "field": "urgent", "eq": true } }
    ]}
  ]
}
```

### 6.1 ชนิดช่อง
| กลุ่ม | type | วาดด้วย |
|---|---|---|
| พื้นฐาน | `text` `textarea` `number` `date` `time` `yesno` `select` `multiselect` | คอมโพเนนต์ฟอร์มกลาง (ขนาดใช้ token `--ctl-*`) |
| **ทะเบียน (บังคับ picker กลาง · UI §5.1.2)** | `person` `machine` `mat` `customer` `storage_loc` `line` `team` `org_unit` `cost_center` | `PersonSelect` · `MachineSelect` · `ProductSelect` · `CustomerSelect` · `StorageLocSelect` · `LineSelect` · `useOrgTeams` · picker ผังองค์กร |
| ไฟล์ | `image` `file` | `ImageCropModal` + `uploadOpts()` + `acceptImageFile()` |
| แสดงผล | `heading` `note` | ไม่เก็บค่า |
| ตาราง | `table` (แถวซ้ำ · คอลัมน์ใช้ type ข้างบน) | เฟส 2 |

🔴 **ไม่มี type "สูตร/สคริปต์"** — ช่องคำนวณที่ต้องการจริงให้โปรแกรมเมอร์เพิ่มเป็น type ใหม่ที่เรียก util กลาง
🔴 เวลาที่คนกรอกแล้วผูกกะ → ต้องผ่าน `resolveShiftTime()` / `checkShiftTime()` (`shiftWindow.js`) เหมือนทุกจอ

### 6.2 เงื่อนไข (`showIf` / `requiredIf`)
ภาษาเล็กๆ ที่ **ตีความเอง ห้าม `eval`/`new Function`** — ตัวดำเนินการ: `eq` `ne` `in` `gt` `gte` `lt` `lte` `empty` `notEmpty` + `all`/`any`
ตัวตีความอยู่ไฟล์เดียว `src/utils/wfExpr.js` (pure + เทส) **และมีตัวเดียวกันฝั่ง SQL** สำหรับตรวจตอนส่ง (§8.2) — ตรรกะต้องตรงกัน (เหมือนคู่ `snapMachineNo` ↔ `machine_key()`)

### 6.3 ตรวจค่า
ตรวจ 2 ชั้น: จอ (บอกทันที) + **RPC ตอน submit ตรวจซ้ำตาม schema ของเวอร์ชันที่ตรึงไว้** (client โกงได้)
ค่าที่ทะเบียนอ่านไม่ได้ตอนตรวจ = fail-closed (ไม่ให้ส่ง + บอกเหตุผล)

---

## 7. Flow schema (`wf_versions.flow_schema`)

```json
{
  "steps": [
    { "key": "sv",  "label": "หัวหน้างานอนุมัติ", "kind": "approve",
      "assignee": { "rule": "creator_head", "levels": 1 },
      "sla": { "hours": 8 }, "allowReturn": true },
    { "key": "qa",  "label": "QA ตรวจ", "kind": "approve",
      "assignee": { "rule": "perm_in_unit", "perm": "wf:approve:qa", "unit": "instance" },
      "when": { "field": "urgent", "eq": true } },
    { "key": "mgr", "label": "ผู้จัดการรับทราบ", "kind": "parallel", "mode": "all",
      "branches": [
        { "assignee": { "rule": "creator_head", "levels": 2 } },
        { "assignee": { "rule": "person", "profile_id": "…" } }
      ] }
  ],
  "onReject": "end",
  "onReturn": "creator"
}
```

### 7.1 ชนิดขั้น
| kind | ความหมาย |
|---|---|
| `approve` | อนุมัติ/ตีกลับ/ส่งกลับแก้ |
| `ack` | รับทราบอย่างเดียว (ตีกลับไม่ได้) |
| `parallel` | หลายคนพร้อมกัน · `mode`: `all` (ครบทุกคน) / `any` (คนแรก) / `n` (ครบ N คน) — **ไม่มีลำดับก่อน-หลัง** (เหมือน CQI-15) |

### 7.2 ข้ามขั้นตามเงื่อนไข (`when`)
เงื่อนไขไม่ผ่าน = ขั้นนั้น **`skipped`** · แถบขั้นวาดเป็น ⏭ เหลือง **ห้าม ✓ เขียว** (= โกหกว่ามีคนตรวจ · กฎ step-flow ข้อ 4)

### 7.3 ทางออก
- **ตีกลับ (reject)** = จบใบ สถานะ `rejected` · ต้องมีเหตุผล
- **ส่งกลับแก้ (return)** = กลับไปผู้เปิดใบ (หรือขั้นที่ระบุ) · ต้องมีเหตุผล · ส่งใหม่แล้วเริ่มนับต่อจากขั้นที่ส่งกลับ (ตามที่ตั้งใน schema — ค่าเริ่มต้นรอ user ตอบ §14)
- **ยกเลิก (cancel)** = ผู้เปิดใบยกเลิกได้ก่อนมีคนอนุมัติขั้นแรกเท่านั้น
- 🔴 **ห้าม `delete` ใบที่ส่งแล้ว** — ใช้สถานะ (หลักเดียวกับ `void` ของ `production_sessions` และคิว 4M)

### 7.4 ตรวจ flow ก่อนเผยแพร่ (validator · `src/utils/wfValidate.js`)
ปุ่มเผยแพร่กดไม่ได้จนกว่าจะผ่าน:
- มีอย่างน้อย 1 ขั้น · key ไม่ซ้ำ · `when`/`showIf` อ้างช่องที่มีอยู่จริง
- ทุกขั้นมีกฎหาผู้อนุมัติ · คีย์สิทธิ์ที่อ้างมีอยู่ใน `role_permissions`
- `parallel mode n` ⇒ N ≤ จำนวนสาขา
- ช่องที่ใช้ใน `when` ห้ามแก้ได้หลังส่ง (ไม่งั้นข้ามขั้นย้อนหลังได้)

---

### 7.5 โหมดผสม — engine คุมสายอนุมัติของใบที่เขียนด้วยโค้ด (user เคาะ 13/11)
- `wf_defs.mode` = `form` (ฟอร์มจาก `form_schema` · ค่าเริ่มต้น) / `bound` (ฟอร์มเป็นหน้าโค้ด)
- ใบ `bound` ผูกแถวธุรกิจด้วย `wf_instances.subject_table` + `subject_id` (เช่น `mkt_quotations` + id) — **ใบธุรกิจ 1 แถว·1 rev = ใบ workflow 1 ใบ** (unique)
- หน้าโค้ดเรียก RPC `wf_start(def_key, subject_table, subject_id)` ตอนกด "ส่งอนุมัติ" · **ข้อมูลที่ใช้ตัดสินเงื่อนไข (`when`) ส่งผ่าน `data` ตอน start แล้วตรึง** — ห้ามให้ engine ไปอ่านตารางธุรกิจเอง
- 🔴 **ระหว่างรออนุมัติ แถวธุรกิจต้องล็อกแก้ไม่ได้** (trigger ฝั่งตารางธุรกิจเช็ค "มีใบ workflow สถานะ `in_progress` ผูกอยู่ไหม") · แก้ = ส่งกลับแก้ (§7.3) หรือออก rev ใหม่
- ผลอนุมัติเขียนกลับตารางธุรกิจด้วย trigger/RPC ที่**โปรแกรมเมอร์ลงทะเบียน**ต่อ `subject_table` (เช่น `mkt_quotations.approved_by`) — ไม่ใช่ user ประกอบเอง
- 🔴 ราคา/ต้นทุนอยู่ตารางธุรกิจฝั่ง Main เท่านั้น · **`wf_instances.data` ห้ามเก็บราคา** (สิทธิ์อ่าน `wf_*` กว้างกว่า — คนในสายอนุมัติเห็นราคาผ่านหน้าโค้ดที่มี RLS ของตัวเอง)
- ใบเสนอราคา: สายอนุมัติ 2 ชั้นตาม MARKETING-QNEX-DESIGN §6.1 (`approved_by` = MKT Manager) · ตัวคำนวณ `mktCost.js` + ตาราง `mkt_quotations` ต้องสร้างก่อน (MARKETING-QNEX-DESIGN §8 เฟส 3) ⇒ **ลำดับเฟส 1 ต้องรวมงานนี้**

## 8. Engine — การเดินใบ

### 8.1 กฎหาผู้อนุมัติ (assignee resolver)
| rule | หาอย่างไร |
|---|---|
| `creator_head` (`levels: n`) | ไล่ `org_nodes.parent_id` จากหน่วยของผู้เปิดใบขึ้นไป n ชั้น → หัวหน้าจาก `org_assignments kind='head'` · มีรักษาการที่วันมีผล (`isGranting()`) ⇒ ให้รักษาการ + บันทึก `via_assignment_id` |
| `perm_in_unit` | คนที่ถือคีย์สิทธิ์ `perm` **และ** `canWriteUnit/canWriteScope` ผ่านกับหน่วยของใบ (`unit: instance` = หน่วยของใบ · `unit: <org_node_id>` = หน่วยตายตัว เช่น QA) |
| `person` | ระบุตัวคน (ใช้น้อยที่สุด — คนย้ายงานแล้ว flow ค้าง ⇒ validator เตือน) |
| `creator` | ผู้เปิดใบเอง (เช่น ขั้นยืนยันปิดงาน) |

🔴 **หาไม่เจอ = fail-closed** — ใบค้างที่ขั้นนั้นพร้อมป้ายแดง "ไม่พบผู้อนุมัติ: <เหตุผล>" + แจ้งเจ้าของนิยาม · **ห้ามข้ามขั้นเอง ห้ามโยนให้ admin เงียบๆ**
🔴 **ผู้เปิดใบห้ามอนุมัติใบตัวเอง** ในขั้น `approve` (ถ้าผลการ resolve ได้ตัวเอง ⇒ ไล่ขึ้นอีกชั้น · ถ้าไม่มีชั้นบน ⇒ fail-closed)
🔴 ตัวหาอยู่ฝั่ง DB (SQL function) — ฝั่งจอใช้แค่ "พรีวิว" ในหน้าออกแบบ/ทดลองรัน · **ตรรกะ 2 ฝั่งต้องตรงกัน + มีเทสคู่**

### 8.2 การเปลี่ยนขั้น = RPC เดียว `wf_act()`
```
wf_act(instance_id, task_id, action, comment, expected_step_rev, data_patch?)  -- security definer
```
1. ตรวจผู้กด: เป็น assignee ของ task นี้ (หรือรักษาการที่มีผลวันนี้)
2. **compare-and-swap** `step_rev = expected_step_rev` — ไม่ตรง = มีคนกดก่อนแล้ว ⇒ คืน error ให้จอบอก "ใบนี้เปลี่ยนแล้ว กรุณาโหลดใหม่" (กันกดซ้อน · กฎ DB ข้อ 4/6)
3. ตรวจ `data` ตาม schema ของเวอร์ชันที่ตรึงไว้ (ตอน `submit`/แก้หลังส่งกลับ)
4. เขียน `wf_actions` → ปิด task → คำนวณขั้นถัดไป (`when`/`parallel`) → สร้าง task ใหม่ → `step_rev + 1`
5. ยิงแจ้งเตือน (§10.2)
ทั้งหมดใน transaction เดียว — ขั้นไหนล้ม = ย้อนทั้งก้อน

🔴 **client ไม่มีสิทธิ์ INSERT/UPDATE `wf_instances`/`wf_tasks`/`wf_actions` ตรง** (RLS select อย่างเดียว · เขียนผ่าน RPC เท่านั้น)
— ยกเว้นใบสถานะ `draft` ของตัวเอง (แก้ `data` ได้)
ฝั่งจอเรียก RPC ผ่าน `checkWrite()` และปุ่มอนุมัติผ่าน `signConfirm` (มี modal พิมพ์เหตุผลอยู่แล้ว = ไม่ถามซ้ำ)

### 8.3 แถบขั้น
`wfFlow(instance, version)` ใน `src/utils/wfFlow.js` คืนรูปแบบเดียวกับ `linearFlow()` ให้ `<StepFlow>` วาด
- ขั้น `parallel` = **1 วงในแถบ** + ชิปรายคนใต้วง (✓/⏳) — ห้ามแตกเป็นหลายวงเรียงกัน (= โกหกลำดับ · step-flow.md "ไม่ใส่ CQI-15")
- สถานะที่ไม่รู้จัก = `known:false` ("สถานะนี้ระบบไม่รู้จัก")

---

## 9. สิทธิ์

### 9.1 คีย์ใหม่ (`role_permissions` · seed ด้วย migration)
| คีย์ | ใช้ทำ |
|---|---|
| `page:/workflows` | เข้าหน้าใบงานของฉัน/กล่องรออนุมัติ |
| `page:/workflow-designer` | เข้าหน้าออกแบบ |
| `wf:design` | สร้าง/แก้ **ร่าง** นิยาม (ในหน่วยเจ้าของที่ตัวเองมีขอบเขต) · ให้ `admin` + **bucket `dept_admin`** (= key user · ดู §9.4) |
| `wf:publish` | เผยแพร่/เลิกใช้นิยาม |
| `wf:start:<key>` | เปิดใบชนิดนี้ (สร้างอัตโนมัติตอนเผยแพร่ครั้งแรก · ค่าเริ่มต้นรอ user ตอบ §14) |
| `wf:view_all:<key>` | ดูใบชนิดนี้ทุกใบในขอบเขต (ไม่ใช่แค่ใบที่ตัวเองเกี่ยว) |

🔴 การเพิ่มคีย์ตอนเผยแพร่ = เขียน `role_permissions` ⇒ ทำใน RPC `wf_publish()` ที่ตรวจ `has_perm('wf:publish')` เอง
🔴 RLS ทุกตารางใช้ `has_perm('<คีย์เดียวกับปุ่มบนจอ>')` **ห้าม hardcode role array**

### 9.4 Key user = flag แอดมินหน่วยงานเดิม (user เคาะ 13/11 · **ไม่สร้าง role ใหม่**)
- key user = `profiles.is_dept_admin` (ติ๊กรายคนที่ `/add-user`) + bucket `dept_admin` ใน `role_permissions` — ซ้อนบน role เดิม ไม่เสียสิทธิ์ของ role เดิม
- เหตุที่ไม่ทำเป็น role: `profiles.role` มีค่าเดียว ⇒ role `key_user` = เสียสิทธิ์ของ role เดิม (เช่น marketing เข้า `/rfq` ไม่ได้)
- เปลี่ยนป้ายใน `roleMeta.js` เป็น "Key User (แอดมินหน่วยงาน)" — ระบบเดียว ห้ามมี 2 ชุด
- ขอบเขต: แก้นิยามได้เฉพาะหน่วยเจ้าของที่ `canWriteUnit(..., { unknownTarget:'block' })` ผ่าน (บ้านจริง `profiles.section`/CC)
- 🔴 ตรวจฐานจริง 13/11: bucket มี 147 คีย์ (ก๊อปจาก manager ตอน 03/08) รวมคีย์ข้ามสายงาน เช่น `employees:edit_all_sections` · `org:manage_divisions` · `company_calendar:edit` · `shipping:config` · `skills:edit_high` · คนถือ flag 14 คน (supervisor 6 · mtn 5 · planner_store 1 · document_control 1 · manager 1) · marketing ยังไม่มีใครถือ
  ⇒ **การตัดคีย์ข้ามสายงานออกจาก bucket = รอ user ไล่ทีละคีย์** (14 คนอาจใช้อยู่) · ห้ามตัดแบบเหมา
- `wf:publish` ให้ key user ด้วยไหม = รอ user ตอบ (§14)

### 9.2 ใครเห็นใบไหน (RLS `wf_instances` select)
ผู้เปิดใบ · คนที่มี/เคยมี task ในใบ · ถือ `wf:view_all:<key>` **และ** ใบอยู่ในขอบเขตที่เห็น (`sections`)
ใบ `is_test` เห็นเฉพาะผู้ทดลองและคนถือ `wf:design`

### 9.3 ขอบเขตแก้นิยาม
ชั้น ③ ใช้ `canWriteUnit(ctx, owner_org_node_id, { unknownTarget: 'block' })` (ค่าเริ่มต้นของฟังก์ชันคือ `allow` ⇒ ต้องส่ง `block` เอง · ctx ต้องส่ง `respCostCenters` + `scopeIdx` ตามกฎ `write-scope-layer`)
· ย้ายเจ้าของนิยามไปหน่วยอื่น = เช็ค 2 ฝั่ง (ต้นทาง+ปลายทาง)

---

## 10. SLA · เตือน · ส่งต่อหัวหน้า

### 10.1 SLA
- `sla.hours` ต่อขั้น → `wf_tasks.due_at` คำนวณตอนสร้าง task
- วิธีนับ = **ชั่วโมงทำงานตามกะ 08:00–17:30 ข้ามวันหยุดตาม `companyCalendar.js`** (user เคาะ 13/11)
- ตัวคำนวณอยู่ไฟล์เดียว `src/utils/wfSla.js` + ฟังก์ชัน SQL คู่กัน · รับ `now` เป็นพารามิเตอร์ (ด่านเทสนาฬิกา +400 วัน)

### 10.2 แจ้งเตือน (ในแอปเท่านั้น)
event ใหม่ใน `notification_rules`:
| event_key | ยิงถึง | ปิดได้ไหม |
|---|---|---|
| `wf.task_assigned` | assignee ของ task (`extra_user_ids`) | ❌ `can_mute=false` (งานรอคนลงมือ) |
| `wf.sla_warning` | assignee | ❌ |
| `wf.escalated` | หัวหน้าชั้นถัดไปของ assignee | ❌ |
| `wf.closed` | ผู้เปิดใบ | ✅ |
| `wf.resolver_failed` | เจ้าของนิยาม (คนถือ `wf:design` ในหน่วยเจ้าของ) | ❌ |
🔴 ผู้รับต้องแคบ — **ห้ามยิงทั้ง role** (`docs/modules/notify-inapp-audit.md`)

### 10.3 ส่งต่อ (escalation)
`pg_cron` ทุก 15 นาที เรียก `wf_sla_scan()`: เกิน `due_at` ⇒ ยิง `wf.escalated` + ตั้ง `escalated_at`
🔴 **ไม่ย้ายงานไปให้หัวหน้าอัตโนมัติ** (แค่แจ้ง) — หัวหน้าเลือก `reassign` เอง (บันทึกใน `wf_actions`) · ถ้า user ต้องการย้ายอัตโนมัติ ตอบใน §14

---

## 11. หน้าจอ

| หน้า | แท็บ (`useTabParam`) | หมายเหตุ |
|---|---|---|
| `/workflows` | `inbox` (รอฉัน) · `mine` (ที่ฉันเปิด) · `all` (ดูทั้งหมดตามสิทธิ์) · `new` (เปิดใบใหม่) | `<Page>` + `PageHeader` · ตัวกรองส่ง `filters=` · ช่วงเวลา `<TimeRangeBar>` |
| `/workflow-designer` | `list` · `form` · `flow` · `test` · `versions` | |
| ใบเต็ม (drawer/modal) | | `<StepFlow>` เต็ม + "⏳ รอ: ใคร — ทำอะไร" + ประวัติ `wf_actions` + ปุ่มตาม task |

- เข้าแผง "คิวงานของฉัน" — task ที่ `assignee_profile_id = ฉัน` = ชั้น `mine` · task แบบ `perm_in_unit` = ชั้น `unit` (กฎ `myQueue.js` · badge นับ `mine` เท่านั้น)
- มือถือ: ใบเต็ม + ปุ่มอนุมัติต้องใช้บนมือถือได้ · อยู่หลัง `useIsMobile()` · **จอคอมห้ามเปลี่ยน** (ตรวจ `audit/desktopdiff.mjs`)
- ฟอร์มยาว: ใช้ `formDraft.js` (ร่างบนเครื่อง)
- 🧪 **แท็บทดลองรัน**: เปิดใบ `is_test=true` จากเวอร์ชันร่าง · จำลองการกดของแต่ละขั้น "ในนาม" ผู้อนุมัติที่ resolve ได้ (ไม่ได้ login เป็นคนนั้นจริง · ไม่ยิงแจ้งเตือนจริง) · เห็นผล resolver ทุกขั้นก่อนเผยแพร่ · ใบทดลองลบอัตโนมัติหลัง 7 วัน
- เพิ่มเมนูใน `NAV_ITEMS` (`src/App.jsx`) · edition NM: ไม่ใส่จนกว่า user สั่ง

### ใบพิมพ์
แม่แบบกลางตัวเดียว (หัวจาก `doc_forms` · ตาราง ช่อง/ค่า ตาม `form_schema` · ช่องลายเซ็นจาก `wf_actions`) ·
พิมพ์ซ้ำใช้ `snapshot` · รูปแนบ = ภาคผนวกท้าย (กฎ doc-forms) · register `doc_key` ตอนเผยแพร่

---

## 12. รายงาน (เฟส 3)
- lead time ต่อขั้น/ต่อชนิดใบ · ขั้นที่เป็นคอขวด · ใบค้างเกิน SLA แยกตามคน/หน่วย
- ใช้ `<ParetoChart>` / `<TimeRangeBar>` · ข้อมูลไม่พอ = เขียนบนจอ ห้ามโชว์ 0 · ตัด `is_test` ออกเสมอ

---

## 13. ลำดับลงมือ

| เฟส | ของที่ได้ | เกณฑ์ผ่าน |
|---|---|---|
| **1** | ตาราง §5 · ช่องพื้นฐาน + picker ทะเบียน · ขั้น `approve`/`ack` เส้นตรง · resolver `creator_head`/`perm_in_unit`/`creator` · `wf_act()` · `/workflows` · `/workflow-designer` (form+flow แบบฟอร์มกรอก ยังไม่ลาก-วาง) · แถบขั้น · คิวงาน · แจ้งเตือน `wf.task_assigned`/`wf.closed` · ใบพิมพ์ | ใบนำร่อง (§14 ข้อ 1) เดินครบ เปิด→อนุมัติ→จบ / ตีกลับ / ส่งกลับแก้ บนข้อมูลจริง · ทดสอบ RLS ด้วย JWT จำลอง (เขียนตรงไม่ได้ · เห็นเฉพาะใบที่ควรเห็น) · `npm run build` + `crashsweep` 2 รอบ + `mobilesweep` ผ่าน |
| **2** | `when` ข้ามขั้น · `parallel` · ช่อง `table` · SLA + `pg_cron` + escalation · เวอร์ชัน (แก้หลังเผยแพร่) · ทดลองรัน | ใบนำร่องตัวที่ 2 ที่มีขั้นขนาน · แก้ flow ระหว่างมีใบค้างแล้วใบค้างไม่เพี้ยน |
| **3** | รายงาน §12 · ตัวออกแบบแบบลาก-วาง | |
| ถัดไป (ยังไม่ออกแบบ) | "action ที่ลงทะเบียนไว้" ให้ขั้นสุดท้ายเรียก เช่น เปิดใบ MO · ผูกกับ golden thread สาย 060/061 | ต้องออกแบบแยก + user สั่ง |

### ด่านที่ต้องเพิ่มตอนลงมือ (`regressionGuards`)
- ห้าม `from('wf_instances'|'wf_tasks'|'wf_actions').insert/update/delete` ในโค้ด client (ต้องผ่าน RPC)
- ห้าม `eval`/`new Function` ใน `src/utils/wfExpr.js`
- type ทะเบียนใน form renderer ต้องวาดด้วย picker กลาง
- อัปเดต checklist ใน `.claude/agents/qc-project-rules.md` คอมมิทเดียวกัน

### Rollback
ตารางใหม่ทั้งหมด ไม่แตะตารางเดิม ⇒ ย้อนโค้ด = `git revert` · schema ทิ้งไว้ได้ (ไม่มีใครอ่าน) ·
คีย์สิทธิ์ใหม่ลบได้ด้วย `delete from role_permissions where perm_key like 'wf:%' or perm_key in ('page:/workflows','page:/workflow-designer')`

---

## 14. ❓ คำถามที่รอ user ตอบ (ห้ามเดา)

| # | คำถาม | คำตอบ user (13/11) | ยังค้าง |
|---|---|---|---|
| 1 | ใบนำร่องเฟส 1 = ใบอะไร | **ใบเสนอราคา (Marketing) แบบผสม** — หน้าคำนวณเป็นโค้ด · engine คุมสายอนุมัติ (§7.5) | สายอนุมัติ 2 ชั้นเป็นใครบ้าง (ตำแหน่ง/หน่วย) |
| 2 | ใครออกแบบใบได้ | **admin และ key user = flag แอดมินหน่วยงานเดิม** (ไม่สร้าง role · §9.4) | `wf:publish` ให้ key user ไหม · ตัดคีย์ข้ามสายงานออกจาก bucket คีย์ไหนบ้าง |
| 3 | ใครเปิดใบได้ตั้งต้น ตอนเผยแพร่ใหม่ | — | ยังไม่ได้ตอบ |
| 4 | SLA นับแบบไหน | **ข. ชั่วโมงทำงานตามกะ (08:00–17:30) ข้ามวันหยุดตามปฏิทินบริษัท** | — |
| 5 | เกิน SLA แล้วทำอะไร | **แจ้งหัวหน้า** (ไม่ย้ายงานอัตโนมัติ) = ตาม §10.3 | — |
| 6 | ส่งกลับแก้แล้วส่งใหม่ เริ่มขั้นไหน | — | ยังไม่ได้ตอบ |
| 7 | ต้องมีใบพิมพ์ในเฟส 1 ไหม | — | ยังไม่ได้ตอบ |
| 8 | ฝากอนุมัติแทนรายคน นอกจาก `org_assignments` | — | ยังไม่ได้ตอบ |
| 9 | เว็บ New Model (edition NM) ต้องเห็นหน้านี้ไหม | — | ใบนำร่องเป็นของ Marketing ซึ่งอยู่ใน `EDITION_PAGES` ของ NM ⇒ ต้องตอบข้อนี้ก่อนเฟส 1 |

## ประวัติ
- 2026-11-13 ฉบับแรก (ออกแบบ · ยังไม่ลงมือ)
- 2026-11-13 บันทึกคำตอบ user ข้อ 1 (Marketing) · 2 (admin + key user) · 5 (แจ้งหัวหน้า) ลง §14
- 2026-11-13 บันทึกคำตอบข้อ 1 (ใบเสนอราคา) · 2 (key user — รอเคาะ flag vs role) · 4 (SLA แบบ ข.)
- 2026-11-13 เคาะ: key user = flag เดิม (§9.4) · ใบเสนอราคาแบบผสม (§7.5)
