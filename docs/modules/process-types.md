# กระบวนการผลิต (process types) — master data-driven (2026-07-23)

> ย้ายมาจาก `CLAUDE.md` (2026-09-03 — แยกไฟล์เพื่อลด context) · โหลด**เฉพาะเมื่อแตะโมดูลนี้** · แก้ไฟล์นี้แทน CLAUDE.md เมื่อกฎของโมดูลเปลี่ยน


**เลิก hardcode รายชื่อกระบวนการแล้ว** (คำสั่ง user — ยืดหยุ่นกับโรงงานอื่น): ตาราง **`process_types`** (DR · migration `20260723_process_types_master.sql`): key (ค่าที่เก็บใน process_type ของตารางอื่น — สร้างแล้วห้ามแก้)/label/icon/color/sort/is_active · seed welding_assembly + metal_forming (ค่าเดิมไม่ต้อง migrate — เทียบด้วย key เหมือนเดิม)
- **จัดการได้ 2 ทางเข้า (component เดียว `src/components/ProcessTypeSetup.jsx` — ไม่ duplicate logic · 2026-07-30):** (1) Daily Report → ⚙️ ตั้งค่า → แท็บ 🏭 กระบวนการ (ที่ฝ่ายผลิตใช้งาน) (2) **หน้า `/process-setup` "🏭 กระบวนการผลิต" ในหมวดตั้งค่าโปรแกรม,ฐานข้อมูล** (master กลางอยู่คู่กับ machine/product master · page perm `page:/process-setup` = admin/mgr/sv · migration `20260730_process_setup_permission.sql`) — การ **"แก้"** ยังคุมด้วยสิทธิ์ `daily_report:setup` ใน component ทั้ง 2 ทาง · เพิ่มกระบวนการใหม่ (เช่น Laser, Bending) → ไป tag เครื่อง/สินค้า → dropdown ทุกจุดเห็นเอง (logic จับคู่เทียบ key generic อยู่แล้ว) · **process_type เป็น master กลาง data ถูก centralize แล้ว (ตาราง `process_types` อ่านผ่าน `processTypes.js`) ไม่ผูกกับ Daily Report** — จุดจัดการอยู่ที่ไหนก็มีผลทั้งระบบ
- โค้ดอ่านผ่าน **`src/utils/processTypes.js`** (`loadProcessTypes()` cache + `activeProcessTypes()`/`procDisplay()`/`procColor()` + `DEFAULT_PROCESS_TYPES` fallback — ตารางล่ม/ยังไม่ apply = พฤติกรรมเดิม) · **'common' (ทุกกระบวนการ) เป็น sentinel ในโค้ด ไม่อยู่ในตาราง** dropdown เติมเองต่อจุด
- จุดที่ใช้แล้ว: DailyReport (dropdown ประเภท DT/งานเสีย/นโยบายพัก + กลุ่มแสดงรายการ + product quick manager) · ProductMaster (ฟอร์มสินค้า) — **ห้าม hardcode welding_assembly/metal_forming เพิ่มในหน้าใหม่** อ่านผ่าน util นี้ · หมายเหตุ: `line_type` (production_lines) เป็นคนละตัว ไม่เกี่ยว

## 🔒 ลบแถวทะเบียน = ต้องนับปลายทางก่อน (fail-closed · 2026-10-06 · QC audit)

`process_types.key` จับคู่ด้วย**ข้อความ ไม่ผูก FK** ⇒ ลบแล้วไม่มีใครเตือน · เดิม
`ProcessTypeSetup.handleDelete` ลบทันทีโดย**ไม่เคยนับปลายทาง** มีแค่ข้อความเตือนใน `confirm`
ว่า "จะกลายเป็นยังไม่กำหนด" — ซึ่งตาม CLAUDE.md §Database Schema **ไม่พอ**
(*"นับไม่ครบ = ห้ามลบ (fail-closed)"*)

🔴 **ทุกการลบต้องผ่าน `loadProcessTypeRefs()` + `processTypeBlockMessage()`
(`src/utils/processTypeRefs.js` · มีเทส 8 เคส) ห้ามนับเองในหน้า**

ปลายทางที่ถือค่า `process_type` (ทั้งหมดฝั่ง DR · ยืนยันจากโค้ดที่อ่าน/เขียนจริง):

| ตาราง | ความหมาย | ตกแล้วเกิดอะไร |
|---|---|---|
| `break_policies` | 🔴 สูตรเวลาพักต่อกระบวนการ | **นับพักผิด ⇒ %A/%P ของทุกกะที่ใช้สูตรนั้นเพี้ยน** |
| `machines` | ประเภทเครื่องจักร | dropdown Downtime/งานเสียของไลน์นั้นหาย |
| `dr_products` | ประเภทสินค้า/ชั้น OP | สินค้าหลุดจากการจับกลุ่มตามกระบวนการ |
| `part_routings` | ขั้นตอนการผลิตต่อพาร์ท | ขั้นตอนกำพร้า |
| `pe_master_processes` | คลัง PFMEA กลาง | กระบวนการใน master ชี้คีย์ที่ไม่มี |

· `break_policies` อยู่**ลำดับแรกของลิสต์** เพราะคนต้องเห็นก่อน (มีเทสล็อกลำดับไว้)
· `42P01`/`42703` (ตาราง/คอลัมน์ยังไม่ apply) = นับเป็น 0 ได้จริง · **error อื่น = `partial` ⇒ ห้ามลบ**
· แนะนำ "ปิดใช้งาน" แทนลบเสมอ — ค่าเดิมที่ tag ไว้ยังอ่านออก
