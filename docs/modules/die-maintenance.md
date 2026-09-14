# DIE MAINTENANCE — Layout & สถานะแม่พิมพ์ (2026-08-19)

> ย้ายมาจาก `CLAUDE.md` (2026-09-03 — แยกไฟล์เพื่อลด context) · โหลด**เฉพาะเมื่อแตะโมดูลนี้** · แก้ไฟล์นี้แทน CLAUDE.md เมื่อกฎของโมดูลเปลี่ยน


`/die-registry` เป็น 3 แท็บ: **📋 ทะเบียน** (ของเดิม) · **🗺️ ผังจัดเก็บ** (`src/components/DieLayout.jsx`) · **📊 สถานะ** (`src/components/DieStatusBoard.jsx`) — ตอบ "แม่พิมพ์ตัวนี้อยู่ตรงไหน · สถานะอะไร" · migration **`20260819_die_layout_status.sql` (DR — apply แล้ว 2026-08-19 · user รันเองผ่าน SQL Editor)** — โค้ดยัง tolerant ไว้เผื่อ rollback (42P01/42703 → banner ไม่พังเงียบ)

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
