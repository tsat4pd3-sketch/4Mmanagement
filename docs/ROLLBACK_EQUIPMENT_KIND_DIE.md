# Rollback — แกนชนิดอุปกรณ์ (`machines.equipment_kind`) + ทะเบียนแม่พิมพ์ `/die-registry`

merge เข้า main: **2026-08-10**

| | ค่า |
|---|---|
| **จุด rollback (main ก่อน merge)** | `1044fbc` |
| **merge commit** | `f28a211` |
| commit งาน | `3664c9f` (แกนชนิด + backfill) · `2fa4ce8` (หน้า /die-registry) |
| branch | `claude/smart-maintenance-inspection-olbv03` |

## ทำอะไรไป

`machines` มี 505 แถว active แต่ **262 แถวเป็นแม่พิมพ์ ไม่ใช่เครื่องจักร** → ติดป้ายด้วยแกนใหม่
`equipment_kind` แทนการแยกตาราง (เหตุผลเต็มใน `src/utils/equipmentKinds.js` และ CLAUDE.md)
แล้วเพิ่มหน้า `/die-registry` เป็น "มุมมองแม่พิมพ์" บนตัวตนเดียวกัน

## ออกแบบมาให้ rollback ง่าย

1. **schema เป็น additive ล้วน** — คอลัมน์ `machines.equipment_kind` + ตารางใหม่ 3 ตัว
   (`die_sets` / `equipment_die` / `die_op_types`) · โค้ดเวอร์ชันก่อนหน้าไม่อ่านอะไรเลย
   → **revert โค้ดอย่างเดียวจบ ไม่ต้องแตะ DB**
2. **เลือก "ติดป้าย" ไม่ใช่ "ย้ายตาราง"** — ไม่มีแถวไหนถูกย้าย/ลบจาก `machines`
   reference ทุกเส้น (MO / downtime / prod_orders / QR / ผัง / checklists) ยังชี้ที่เดิมครบ
3. **ไม่มี permission key ใหม่สำหรับ action** — การแก้ในหน้าใหม่ใช้ `machines:edit` เดิม
   (มีเฉพาะ `page:/die-registry` ซึ่งไม่มีผลถ้าหน้าหายไป)

## ขั้นตอน Rollback

### 1) Revert โค้ดบน main (พอสำหรับเกือบทุกกรณี)

```bash
git revert -m 1 f28a211
git push origin main          # Render deploy อัตโนมัติ
```

ผลลัพธ์: หน้า `/die-registry` หายจากเมนู · `/machine-database` กลับไปแสดงทุกแถว
(รวมแม่พิมพ์ 262 ตัวปนเหมือนเดิม) · ตาราง/คอลัมน์ใหม่ค้างอยู่แต่ไม่มีใครอ่าน = ไม่มีผล

### 2) DB — ปกติ **ไม่ต้องทำอะไร**

ถ้ายืนยันแล้วว่าจะไม่กลับมาใช้ ค่อยถอน (ทำทีหลังได้เสมอ — ไม่รีบ):

```sql
-- DR project (eyhclzkifitbhbljgoav) — เรียงตาม dependency
drop table if exists equipment_die;       -- FK → machines, die_sets, die_op_types
drop table if exists die_sets;
drop table if exists die_op_types;
alter table machines drop column if exists equipment_kind;
```

```sql
-- Main project (ewhdfqwfwofivojtsizn) — สิทธิ์เข้าหน้า
delete from role_permissions where permission_key = 'page:/die-registry';
```

> ⚠️ **ห้าม drop คอลัมน์/ตารางก่อน revert โค้ด** — `MachineDatabase.jsx` และ `MtnMachineLayout.jsx`
> select `equipment_kind` อยู่ · drop ก่อนจะได้ PostgREST error 42703 ทั้ง 2 หน้า

## ⚠️ ส่วนเดียวที่ revert โค้ดแล้วไม่กลับ — `jigs.equipment_type` (9 แถว)

migration `20260810_sync_shadow_jig_equipment_type.sql` **แก้ข้อมูลจริง**:
แถวเงาใน `jigs` (สำเนาของเครื่องที่วางบนผัง PM) ที่ตั้ง `equipment_type` ไม่ตรงกับเครื่องจริง
ถูก sync ให้ตรง — ของจริงที่โดน คือ **เครื่องอัดลม Atlas Copco / คูลลิ่งทาวเวอร์ LIANG CHI /
แอร์บูสเตอร์ รวม 9 ตัว** ที่ถูกตั้งเป็น `'jig'` ทั้งที่เป็นเครื่องจักร

**ค่าเดิมคือค่าที่ผิด** — จึงไม่มีเหตุผลให้ย้อนกลับ และผลกระทบจำกัดมาก:

| หน้าที่อ่าน `jigs.equipment_type` | ผลจากการ sync |
|---|---|
| `DailyPM` (ทะเบียน AM) | **ไม่เปลี่ยน** — ตัด `equipment_category='facility'` ตั้งแต่ด่านแรกอยู่แล้ว |
| `QrLabels` | **ไม่เปลี่ยน** — กรอง `!machine_id` แถวเงามี `machine_id` ทุกตัว |
| `PMCheckData` | 9 ตัวย้ายจากแท็บ **JIG MTN → MTN** (= ผลที่ตั้งใจ เครื่องอัดลมไม่ใช่งานทีมจิ๊ก) |

ถ้าจำเป็นต้องย้อนจริงๆ ต้องตั้งกลับทีละตัวจาก `machine_no` — ไม่มี snapshot ค่าเดิมเก็บไว้
(ตรวจสอบย้อนหลังได้ที่ `audit_log` ฝั่ง DR — `jigs` อยู่ใน `DR_AUDIT_TABLES`)

## สิ่งที่ backfill **ไม่ได้** ทำ (ไม่ต้อง rollback)

ฟิลด์ที่แกะจากชื่อเครื่องไม่ออก **ถูกปล่อยว่างไว้ ไม่เดาให้** — ยังไม่ระบุตัน 180 ตัว ·
ไม่ระบุ OP 49 · ไม่ระบุกระบวนการ 90 · ยังไม่ผูกชุด 3 · ชุดที่ OP ซ้ำ 1 ชุด (24 ตัว = 4 วัสดุ × 6 OP)
เป็น **worklist ให้คนไล่เก็บผ่านหน้า `/die-registry`** ไม่ใช่ข้อมูลเสีย
