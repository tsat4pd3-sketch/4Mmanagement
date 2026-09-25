# DIE MAINTENANCE — Layout & สถานะแม่พิมพ์ (2026-08-19)

> ย้ายมาจาก `CLAUDE.md` (2026-09-03 — แยกไฟล์เพื่อลด context) · โหลด**เฉพาะเมื่อแตะโมดูลนี้** · แก้ไฟล์นี้แทน CLAUDE.md เมื่อกฎของโมดูลเปลี่ยน

> ### 📍 ที่อยู่ใหม่ (2026-09-22) — ยุบเข้า `/equipment` ศูนย์ทะเบียนอุปกรณ์
> ทะเบียนแม่พิมพ์ย้ายเป็นแท็บใน `/equipment` · route `/die-registry` ยัง redirect เข้ามา (bookmark เก่าไม่ตาย)
> · **⚠️ แท็บของหน้านี้เปลี่ยน query param จาก `?tab=` → `?die=`** (ชนกับแท็บของหน้าแม่ · UI-CONVENTIONS §6.8)
>   `?die=registry|layout|status` — ลิงก์ภายในที่ชี้มาต้องเขียน `/equipment?tab=die&die=layout` ห้ามเด้งผ่าน redirect


`/equipment?tab=die` (เดิม `/die-registry` — redirect ให้) เป็น 3 แท็บ: **📋 ทะเบียน** (ของเดิม) · **🗺️ ผังจัดเก็บ** (`src/components/DieLayout.jsx`) · **📊 สถานะ** (`src/components/DieStatusBoard.jsx`) — ตอบ "แม่พิมพ์ตัวนี้อยู่ตรงไหน · สถานะอะไร" · migration **`20260819_die_layout_status.sql` (DR — apply แล้ว 2026-08-19 · user รันเองผ่าน SQL Editor)** — โค้ดยัง tolerant ไว้เผื่อ rollback (42P01/42703 → banner ไม่พังเงียบ)

- **ผังจัดเก็บ = pattern เดียวกับ RackMap:** ตาราง `die_storage_areas` (DR · รูปจริง 1 รูป/ผัง · หลายผังได้) + หมุดรายตัวเก็บที่ **`equipment_die.area_id/pos_x/pos_y`** (% ของรูป 0-100) — ตัวตนแม่พิมพ์ยังอยู่ `machines` ตามกฎ "ชนิดอุปกรณ์เป็นแกน ไม่ใช่ตาราง" · หมุด = **วงกลม+ป้ายใต้** ขนาดผ่าน `markerScale` (UI §1) · editor มี Undo/Redo (`useUndoHistory` — §6.7) · รูปผังบีบสเปคผัง 2560px/q0.9 bucket `mtn-images` path `die-area/` · แม่พิมพ์ที่ยังไม่วาง = worklist **ห้ามซ่อน**
- **⚠️ กฎเหล็ก — สถานะแม่พิมพ์มี 2 แกน ห้ามยุบรวม** (source of truth `src/utils/dieStatus.js`):
  1. **แกน manual `equipment_die.die_status`** (ready/in_use/maintenance/external/trial/retired — เพิ่มสถานะใหม่แก้ที่ util นี้ที่เดียว · DB ไม่มี check constraint โดยตั้งใจ · key ที่โค้ดไม่รู้จัก = โชว์ key ดิบสีเทา ไม่หายเงียบ) · **null = "ยังไม่ระบุ" ห้าม default เป็น ready** (ห้ามเดาแทนหน้างาน — หลักเดียวกับ backfill ทะเบียน) → เป็น worklist ตัวนับส้ม
  2. **แกน derive จากใบซ่อม MO** (`mtn_orders` สถานะใน `OPEN_MO_STATUSES`) — **คำนวณสดเสมอ ไม่เก็บซ้ำใน DB** (เก็บซ้ำ = 2 แหล่ง drift · หลักเดียวกับ "ห้ามให้ระบบภายนอกคำนวณ OEE เอง") · จับคู่ด้วย `machine_no` (normalize trim+uppercase) · **MO ค้างชนะสีสถานะ manual เสมอ**: หมุด/แถวแดง · **pending (ยังไม่มีคนรับงาน) = กระพริบ (`dt-alarm-blink`) · MO ที่รับแล้ว = แดงนิ่ง** ตาม Andon
- ป้ายสถานะ MO ใช้ `MO_STATUS_LABEL` ใน dieStatus.js (mirror `STATUS_META` ของ MtnRepair — import ข้ามจากหน้า lazy chunk ไม่ได้ · **เพิ่มสถานะ MO ใหม่ต้องอัพเดท 2 ที่**)
- เปลี่ยนสถานะ = `saveDieStatus()` (upsert equipment_die + stamp `status_updated_at/by_name`) ผ่าน `DieStatusEditor` (component ร่วม 2 แท็บ) · สิทธิ์ = **`machines:edit` เดิม** (ไม่ seed key ใหม่ — เลี่ยงกับดัก enum_range) · ใครแก้อะไรดูได้ที่ audit_log (`die_storage_areas` เข้า `DR_AUDIT_TABLES` แล้ว + ทั้งคู่เพิ่มใน `AUDIT_TABLES` ของ MasterAuditLog ใน /mtn-repair)
- 📊 สถานะ กดปุ่ม 🗺️ ที่แถว = กระโดดไปแท็บผังพร้อม focus หมุดตัวนั้น (`focusDieId` ใน DieRegistry)
- **🔗 link กับผังรวมโรงงาน + ไลน์ผลิต (2026-08-19 · คำสั่ง user "layout แม่พิมพ์ต้อง link กับไลน์ผลิต/ผังโรงงาน"):**
  - **ผังรวม ↔ ผังจัดเก็บ:** กรอบบน `/factory-map` ที่**ชื่อตรงกับชื่อผังจัดเก็บ** (`die_storage_areas.name` เทียบ trim+lowercase — ข้าม project Main↔DR ทำ FK ไม่ได้ "ชื่อคือกุญแจ" pattern เดียวกับโซน facility ↔ `pm_facility_areas`) = **โซนคลังแม่พิมพ์ 🔨** · dropdown ตีกรอบมี optgroup "🔨 คลังแม่พิมพ์" · โซนโชว์ health จากใบซ่อม MO ของแม่พิมพ์ที่วางในโซน (`dieZones` ใน FactoryMap · poll `RATE.ANALYTIC` · MO pending = กระพริบตาม Andon) · **คลิกโซน → `/die-registry?tab=layout&area=<id>&from=factory-map`** (มีปุ่ม ← กลับผังรวม — precedent เดียวกับโซน facility → `/mtn-layout`) · ฝั่ง DieLayout: ผังที่ตีกรอบแล้วมีปุ่ม "🏭 ดูบนผังรวมโรงงาน" · ยังไม่ตีกรอบ = ขึ้นคำแนะนำ (ห้ามเงียบ) · **เปลี่ยนชื่อผังจัดเก็บ = cascade ชื่อกรอบบนผังรวมให้อัตโนมัติ** (AreaFormModal — พลาดต้อง toast บอก ห้ามเงียบ · กฎ rename cascade)
  - **แม่พิมพ์ ↔ ไลน์ผลิต:** ชุดแม่พิมพ์ → `die_sets.mat_no` → `dr_products.line_name` = "🏭 ป้อนไลน์ผลิต" แสดงใน panel ผังจัดเก็บ + แถวบอร์ดสถานะ (info เท่านั้น — ชุดที่ยังไม่ผูก MAT ไม่แสดง = ไปผูกที่แท็บทะเบียน) · ส่วน `machines.line_name` ของแม่พิมพ์ = ชื่อ**กลุ่มเครื่องปั๊ม** (LINE A ( 800 Ton )) แสดงเป็น "เครื่องปั๊ม" ห้ามสับสนกับไลน์ผลิต
- **เฟสถัดไป (ยังไม่ทำ):** สแกน QR แม่พิมพ์ (`ESM:M:<uuid>` มีอยู่แล้ว) แล้วเด้งเข้าหมุด/เปลี่ยนสถานะ · ผูกสถานะ in_use กับการเปิดใบผลิต (ตอนนี้ยังไม่มีข้อมูล "ใบผลิตใช้แม่พิมพ์ตัวไหน" — ดู gap ใน /order-trace) · auto เปลี่ยนสถานะเป็น maintenance ตอนเปิด MO (ตอนนี้ให้ derive แสดงทับแทน ไม่เขียนทับ manual)

---

## กลุ่มเครื่องปั๊ม/ไลน์ของแม่พิมพ์ = ทะเบียน `die_press_lines` — 2026-09-08 · ทะเบียน (DR)

เดิม DieRegistry derive รายชื่อ "LINE A ( 800 Ton )" จากแถวของตัวเอง (พิมพ์ผิดตัวเดียว = กลุ่มใหม่) · ตอนนี้มีตาราง DR `die_press_lines`
(code · name · tonnage · ref_production_line · migration `20260908_die_press_lines_dr.sql` · seed 6 กลุ่ม: LINE A-D + HDF1/HDF2 ที่ ref ไลน์ผลิตจริง)
· ช่องไลน์ในฟอร์มชุด = `<SelectOrFree>` จาก `useDiePressLines()` (ค่าเก่านอกทะเบียนยังเลือกได้) · จัดการที่ `/die-registry` แท็บทะเบียน แผง ⚙️ (สิทธิ์ `machines:edit`)
· **ตั้งใจแยกจาก `production_lines`** — ถ้าเพิ่มเป็นไลน์ผลิตจะโผล่ใน dropdown ไลน์/scope/OEE/TV ทุกหน้า · `die_sets.line_name` / `machines.line_name` ยังเก็บ name text เหมือนเดิม
· `ref_production_line` = ทางเชื่อมไป production_sessions/OEE ในอนาคต (HDF1/HDF2 ตั้งแล้ว · LINE A-D ยังไม่มีไลน์ผลิตคู่)

### 🔴 กด save ที่ /machines แล้วแม่พิมพ์/จิ๊กกลายเป็น "เครื่องจักร" เงียบๆ (แก้แล้ว 2026-09-08)

`MachineDatabase.openEdit()` คัดลอกฟิลด์จากแถวเดิม 11 ตัวแต่ **ตก `equipment_kind`** → `kindOf(undefined)`
คืน `'machine'` (ค่า backward-compatible ใน `equipmentKinds.js`) → `handleSave` เขียนทับลง DB ทุกครั้งที่กดบันทึก
· หัวข้อ modal + ปุ่มชนิดที่ไฮไลต์ก็อ่านจากตัวเดียวกัน จึงโชว์ "🏭 เครื่องจักร" ผิดตั้งแต่เปิด modal
⇒ ช่างเข้าไปแก้แค่ชื่อ/ไลน์/ลำดับ แม่พิมพ์ก็หายจาก `/die-registry` ทันที **โดยไม่มีอะไรเตือน**
**แก้:** เติม `equipment_kind: kindOf(item.equipment_kind)` ใน object ของ `openEdit`

**วัดความเสียหายจริงแล้ว — ยังไม่พบเหยื่อที่ยืนยันได้ จึงไม่ backfill:**
- 10 แถว active ที่ `equipment_kind='machine'` แต่ชื่อเป็นคำบรรยายพาร์ท (มี `(OP` หรือยาว >30) —
  **ไม่มีตัวไหนมีแฝดชนิด die ชื่อเดียวกัน** และ **2 ตัวมี `downtime_logs` ผูกอยู่** (เคยถูกใช้เป็นเครื่องจริง)
  ⇒ น่าจะเป็นการลงทะเบียนที่ใช้ชื่อพาร์ทเป็น `machine_no` ตั้งแต่แรก ไม่ใช่เหยื่อของบั๊ก
- 16 `machine_no` ที่มีทั้ง die และ machine (32 แถว) — 14 คู่อยู่**คนละไลน์** (LINE C vs LINE D) = import ซ้ำ
  ส่วน 2 คู่ที่ไลน์เดียวกัน (HDF2) **ฝั่ง machine ถูกปิด `is_active=false` ไปแล้ว** ไม่มีผลค้าง
**กฎ:** จะแก้ชนิดคืนต้องให้ MTN ยืนยันรายตัวก่อน — `machine_no` เป็น join key ที่ `mtn_orders`/`downtime_logs`
อ้างด้วยข้อความ การเปลี่ยนชนิดทำให้ตัวนั้นหายจาก dropdown เครื่องจักรของ Daily Report ทันที (ห้าม backfill เงียบ)

---

## ⏱️ เวลาเปลี่ยนรุ่นงานปั๊ม (sequence-dependent setup) — ชั้น 1: ที่เก็บข้อมูล · 2026-09-25

**โจทย์จาก user (2026-09-24):** *"งานปั๊มมันจะวุ่นวายกว่าที่ผ่านมา มันมี setup time change over die
มาเป็นตัวแปร ถ้า die height ต่างกันเกินมันมีผล เลยต้องมีการ drag จัดแผนเพื่อหา optimization"*
→ *"ลุยก่อน diff die height เดี๋ยวถามมาให้"* (25/09) ⇒ ทำ**ชั้น 1 (ที่เก็บ + สูตร + ที่กรอกกฎ)** ก่อน
ตัวจัดลำดับ/ลากการ์ด (ชั้น 2-3) **ยังไม่ทำ — ห้ามเริ่มจนกว่า user สั่ง**

### ทำไมต้องหยุดที่ชั้น 1 (สำรวจข้อมูลจริงก่อนเขียนโค้ด 24/09)

| สิ่งที่ optimizer ต้องรู้ | ความจริงตอนสำรวจ |
|---|---|
| ความสูงแม่พิมพ์ | **ไม่มีคอลัมน์เลย** (มีแต่ `tonnage_ton`) |
| ช่วง shut height ของเครื่อง | **ไม่มี** ⇒ ไม่รู้ว่าแม่พิมพ์ขึ้นเครื่องไหนได้ |
| เวลา setup ที่วัดจริง | downtime "Set up Machine" 379 ครั้ง/120 วัน แต่ **336 ครั้ง (89%) = 30 นาทีเป๊ะ** = ค่าเหมา · และ **ไลน์ปั๊มไม่เคยบันทึกสักครั้ง** |
| ใบผลิต ↔ แม่พิมพ์ | `die_sets.mat_no` กรอกแล้ว **1/92** · `part_no` แมตช์ `dr_products.p_no` **16/92** |

⇒ optimizer ที่สร้างบนข้อมูลชุดนี้ = **จอที่ดูฉลาดแต่แนะนำมั่ว** (อันตรายกว่าไม่มีจอ)

### ของที่ทำแล้ว

- **migration `20260925_press_die_height_setup_dr.sql` (DR "Product DB" · apply แล้ว 25/09)**
  - `equipment_die.die_height_mm` · `machines.shut_height_min_mm` / `shut_height_max_mm` (nullable ทั้งหมด)
  - ตาราง `press_setup_rules` — กฎต่อ **เครื่อง / ไลน์ / ทั้งโรงงาน** (`base_min` · `same_die_min` ·
    `height_steps jsonb = [{max_mm, add_min}]`) + RLS `using(true)` ตามคอนเวนชัน DR (anon เสมอ) +
    `trg_audit` (`fn_audit()`) + `press_setup_rules` ในลิสต์ `DR_AUDIT_TABLES` ของ `supabaseClient.js`
  - 🔴 **ตารางกฎตั้งใจสร้างไว้ว่าง** — ตัวเลขต้องมาจากช่างปั๊ม (user กำลังไปถาม)
- **สูตรกลาง `src/utils/pressSetup.js`** (pure · เทส 20 เคสใน `__tests__/pressSetup.test.mjs`)
  `resolveSetupRule` (เครื่อง ชนะ ไลน์ ชนะ global) · `stepAddMin` · `setupMinutes` · `sequenceSetup`
  · `orderByDieHeight` · `fitsPress` · `setupDataReadiness`
  - 🔴 **ไม่มีกฎ = `min: null` + `state:'no_rule'` ห้ามคืน 0 และห้าม fallback เลขในโค้ด**
    (0 ทำให้แผนดูดีเกินจริงแล้วคนเชื่อ) · **`totalMin: null` ⇒ จอต้องเขียนว่าเทียบลำดับไม่ได้**
  - 🔴 **ไม่รู้ความสูงข้างใดข้างหนึ่ง = `state:'unknown_height'`** คืนได้แค่เวลาฐาน + `missing[]`
    และ `sequenceSetup.unknownCount > 0` ⇒ จอต้องเขียนว่า **ตัวเลขนี้ต่ำกว่าความจริง**
  - 🔴 **`fitsPress` คืน `null` เมื่อข้อมูลไม่ครบ — `null` ไม่ใช่ `false`** ("ไม่รู้ว่าขึ้นได้ไหม" ห้ามแปลว่า
    "ขึ้นไม่ได้" แล้วไปตัดตัวเลือกของคนวางแผนทิ้ง) · **`orderByDieHeight` ต่อท้ายตัวที่ไม่รู้ความสูง ห้ามตัดทิ้ง**
- **ที่กรอก:** `/equipment?tab=die` แท็บ 📋 ทะเบียน
  - ช่อง **"ความสูงแม่พิมพ์ (มม.)"** ในโมดัลแก้แม่พิมพ์ + คอลัมน์ "สูง (มม.)" ในตารางสมาชิกชุด
    + ชิปสรุป **"ยังไม่ระบุความสูง N"** (ตั้งใจโชว์จำนวนที่ยังไม่รู้ ไม่ซ่อน)
  - แผงพับ **⏱️ กฎเวลาเปลี่ยนรุ่น** = `src/components/PressSetupRules.jsx` — เพิ่ม/แก้กฎ
    (ขอบเขต · เวลาฐาน · ตัวเดิมเปลี่ยนล็อต · ขั้นบันไดความสูง · หมายเหตุว่าใครให้ตัวเลข) +
    แถบ "ความพร้อมของข้อมูล" + **🧪 ลองเทียบลำดับ** (ลำดับตามทะเบียน vs เรียงตามความสูง = ประหยัดกี่นาที)
    · เขียนผ่าน `checkWrite` + `.select('id')` นับแถว (RLS ปฏิเสธ UPDATE = 0 แถวเงียบ)
    · โหลดไม่ได้ ≠ ยังไม่มีกฎ — แยกข้อความ 2 กรณี (`missing` = ยังไม่ apply migration · `error` = โหลดพัง)
- **`/machines`:** ช่อง **Shut height ต่ำสุด/สูงสุด (มม.)** เฉพาะ "เครื่องจักรที่เดินเองในไลน์ผลิต"
  (แม่พิมพ์/จิ๊กไม่มีแกนนี้ — เกณฑ์ `isRunningMachine` ตัวเดียวกับ automation_level/operation_mode)
- ป้ายไทยของคอลัมน์ใหม่ + ตาราง `press_setup_rules` ใน `src/utils/auditLabels.js` แล้ว (จอ `/audit-log` อ่านรู้เรื่อง)

### 🔙 rollback
`drop table press_setup_rules;` + `alter table equipment_die drop column die_height_mm;`
+ `alter table machines drop column shut_height_min_mm, drop column shut_height_max_mm;`
(ทุกอย่าง additive · nullable · ไม่มี default ที่เปลี่ยนพฤติกรรมเดิม ⇒ revert โค้ดก่อนแล้วค่อยแตะ schema ได้)

### ⭐ คำตอบจากช่างปั๊ม (user 2026-09-25) — ตัวเลขจริงชุดแรกเข้าระบบแล้ว

| คำถามที่ถามไป | คำตอบ | ทำอะไรไปแล้ว |
|---|---|---|
| Δ ความสูงเท่าไหร่จึงมีผล / บวกกี่นาที | **"1mm = 1sec"** | ผลของความสูงเป็น **อัตราเชิงเส้น ไม่ใช่ขั้นบันได** ⇒ เพิ่มคอลัมน์ `per_mm_sec` + seed กฎ global `per_mm_sec = 1` (migration `20260925b_press_setup_per_mm_dr.sql` · **apply แล้ว**) |
| ข้อจำกัดอื่น (tonnage/bolster/feeder/ชุดช่าง) | **"ไว้ก่อนไม่มีผล"** | ไม่ทำ · `fitsPress` (ช่วง shut height) ยังอยู่เพราะเป็นข้อจำกัดทางกายภาพที่กรอกไว้ได้ฟรี |
| ใครลากแผนได้ / ผลิตแบบไหน | **"แพลนนิ่งกับผลิต ที่ผลิตเป็นล็อต"** | บันทึกไว้เป็นข้อกำหนดของชั้น 2: เจ้าของแผน = **Planning + Production** · หน่วยที่ลาก = **1 การ์ด = 1 ล็อต** |

🔴 **เวลาฐาน (ยกแม่พิมพ์ลง-ขึ้น-จูน) ยังไม่ได้ถาม** ⇒ `base_min`/`same_die_min` เปลี่ยนเป็น
**nullable ไม่มี default** (`not null default 0` = ระบบตอบ "เปลี่ยนแม่พิมพ์ใช้เวลา 0 นาที" = โกหกที่ดูน่าเชื่อ)

### ⭐⭐ กฎที่ปลดล็อกงานได้ทั้งที่ยังไม่รู้เวลาฐาน — แยก `varMin` ออกจาก `totalMin`

ลำดับที่สลับกันบน**แม่พิมพ์ชุดเดิม** มีจำนวนครั้งเปลี่ยนแม่พิมพ์ **เท่ากันเสมอ**
⇒ เวลาฐาน = `base × changeCount` = ค่าคงที่ ⇒ **หักกลบหายไปจากผลต่างระหว่างลำดับ**

| ตอบคำถาม | ใช้ค่าไหน | ต้องรู้เวลาฐานไหม |
|---|---|---|
| "ลำดับไหนดีกว่า / ประหยัดกี่นาที" | `varMin` (ผลของความสูง) | **ไม่ต้อง** ⇒ ทำได้ทันที |
| "รอบนี้ใช้เวลารวมกี่นาที" | `totalMin` | ต้อง ⇒ `null` จนกว่าจะถามช่าง |

⇒ `sequenceSetup()` คืนทั้ง `totalMin` (null ได้) และ `varMin` · `setupDataReadiness()` แยก
**`canPlan`** (จัดลำดับได้) ออกจาก **`canTotal`** (ตอบเวลารวมได้) — **2 คำถามนี้ห้ามปนกัน**
· `canPlan` ต้องดู **"กฎที่บอกผลของความสูงได้"** (`ruleWithHeight`) ไม่ใช่แค่ "มีกฎ" —
  กฎที่มีแต่เวลาฐานทำให้ทุกลำดับเท่ากันหมด จอจะบอก "เรียงใหม่ไม่ช่วย" แบบมั่ว (มีเทสล็อก)

📐 **1mm = 1sec ทำให้ `orderByDieHeight` (ไล่ความสูงทางเดียว) เป็นลำดับที่ดีที่สุดจริง** —
Σ|Δh| ต่ำสุดเท่ากับ (สูงสุด − ต่ำสุด) ตามอสมการสามเหลี่ยม · เทสไล่ทุก permutation ของ 4 ตัวยืนยันแล้ว
⚠️ ถ้าวันหน้าใส่ `height_steps` (เงื่อนไขแบบขั้น) ด้วย **การันตีนี้หายไป** — กลับเป็น "ข้อเสนอให้คนลากแก้"

⚠️ **นาทีที่มาจากวินาที/60 เป็นทศนิยมยาว** (10/60 + 190/60 ≠ 200/60 เป๊ะ) ⇒ จอต้องปัดเศษก่อนแสดง
เสมอ (`fmtMin` ในแผง) · เทสเทียบด้วยค่าคลาดเคลื่อน ไม่ใช่ `assert.equal`

### ค้างไว้ (รอคำตอบ / คำสั่ง user)
1. **เวลาฐานเปลี่ยนแม่พิมพ์ + ตัวเดิมเปลี่ยนล็อต กี่นาที** — ยังไม่ได้ถาม (กรอกในแผงได้ทันทีเมื่อรู้)
2. **กรอกความสูงแม่พิมพ์** — 262 ตัว ยังไม่มีตัวไหนกรอก ⇒ จอยังจัดลำดับให้ไม่ได้จนกว่าจะมี ≥ 2 ตัว
3. **ผูกใบผลิตกับแม่พิมพ์** (`die_sets.mat_no` — auto-match ได้แค่ 16/92 ⇒ ต้องมี picker ให้คนผูก)
4. **ชั้น 2 (ลากการ์ดจัดแผน · `plan_seq`/`planned_start_at`) และชั้น 3 (optimizer)** — ยังไม่เริ่ม
   · รู้แล้ว: เจ้าของแผน = Planning + Production · 1 การ์ด = 1 ล็อต
   · **ยังไม่ตอบ:** แผนที่ลากไว้ "ชนะ" หรือ "แพ้" การสแกนจริงหน้างาน (ตัวตัดสินว่าบอร์ดเขียนทับกันแบบไหน)
5. แตกใบกลางกะตอนแม่พิมพ์พังกลางล็อต (lot 1000 ผลิตได้ 600 อีก 400 ยกลง) — ยังไม่ทำ
