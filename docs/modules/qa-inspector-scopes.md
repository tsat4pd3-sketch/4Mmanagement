# 🔬 QC ประจำไลน์ — แยก QA ออกจากผลิต (`qa_inspector_scopes` · 2026-10-27)

> เจ้าของกฎ: **`src/utils/qaScope.js`** · จอตั้งค่า: `/qa-setup?tab=inspectors` (`QaInspectorScopes.jsx`)
> migration: `supabase/migrations/20261027_qa_inspector_scopes_main.sql` (**apply แล้ว 27/10 · Main project**)

## คำสั่ง user (26/10)

> *"QA ที่มาอยู่กับผลิต คือต้องอยู่ส่วน QA แต่หน้างาน ตรวจคุณภาพให้ไลน์ไหน ไม่ควรขึ้นกับผลิตรึป่าว"*
> *"QA ต้องเห็นทั้งโรงงานในเรื่องของคุณภาพ"* · *"ทำเลย แยก QA ออกจากผลิต"*

## 🔴 3 แกน — ห้ามปนกัน

| คำถาม | เก็บที่ |
|---|---|
| สังกัดใคร (บ้านจริง) | `employees.section` = `QA` · `profiles.section` |
| เห็นแค่ไหน | `profiles.scope_depth = 'all'` (ทั้งโรงงาน — ตามคำสั่ง user) |
| **ตรวจคุณภาพให้หน่วยไหน** | **`qa_inspector_scopes`** |

🔴 **อ้างอิงเท่านั้น ไม่ใช่การย้ายสังกัด** — ห้ามเอาไปแตะ `employees.section` / `org_node_id` /
`cost_center` · **ห้ามนับเป็นกำลังคนของไลน์** (QC = `staff_kind='support'`)
หลักเดียวกับ `line_technicians` (ช่างประจำไลน์) และ `employee_flex_units` (คนวิ่งข้ามแผนก)

🔴 **ไม่ใช่ด่านสิทธิ์** — role `qa` ถือคีย์ `scope:all_units` อยู่แล้ว (ตั้งใจ)
⇒ **ห้ามเอาตารางนี้ไปใช้ใน `canWriteUnit`/`canWriteLine`** — ชั้น ③ มีเจ้าของแล้วที่ `writeScope.js`

🔴 **ทะเบียนว่าง = "ยังไม่ได้ตั้ง" ไม่ใช่ "ไม่รับผิดชอบอะไรเลย"** (`QA_COVER.UNSET`)
จอต้องเขียนบนจอ ห้ามแปลเป็น "ไม่มีงาน" · ตั้งที่ชั้น "ส่วนงาน" = รับตรวจทุกหน่วยใต้ลงไป (`qaCovers`)

## สิ่งที่ตรวจเจอก่อนแก้ (ฐานจริง 26/10)

| จุด | สภาพเดิม |
|---|---|
| `employees` ของ QC 23 คน | `section='QA'` · `line_id` ว่างทุกคน ✅ **ถูกอยู่แล้ว** |
| `profiles.section` ของ 13 บัญชี role `qa` | **`PD3`** ❌ (ฝ่ายผลิต) |
| "ตรวจให้ไลน์ไหน" | ยัดไว้ใน `profiles.sections` = `['PD3']` / `['PD3','PD4']` |

**ทำไม `profiles.section='PD3'` ไม่ทำให้พังมาก่อน** — `UserContext.section` อ่าน `employees.section`
ชนะ `profiles.section` (`App.jsx` · ตัวตนอยู่ที่ `employees`) และ role `qa` ถือ `scope:all_units`
⇒ ค่านั้นเป็น**ข้อมูลที่ขัดกันเฉยๆ** ไม่เคยถูกใช้ตัดสินอะไร · แก้จึงไม่กระทบสิทธิ์ใคร (พิสูจน์ก่อนแก้)

## ผล migration (27/10)

- ตาราง + RLS 2 policy (`qa:manage` สำหรับเขียน · อ่านได้ทุกบัญชีที่ login) + trigger 2 ตัว (updated_at · audit)
- backfill จาก `profiles.sections` → **20 แถว · QC 15 คน** (ระดับส่วนงาน — ไม่เดาไลน์แทนคน)
- `profiles.section` ของ **13 บัญชี** `PD3` → `QA` · เหลือบัญชี `qa` ที่ไม่ตรงทะเบียน = **0**

## rollback

```sql
-- Main project ("MAIN" · ewhdfqwfwofivojtsizn) — ย้อนโค้ดก่อน แล้วรันใน SQL Editor
drop table if exists public.qa_inspector_scopes;
-- (ถ้าต้องการคืน section เดิมด้วย — ไม่จำเป็น เพราะไม่มีผลกับสิทธิ์)
-- update public.profiles set section='PD3' where role='qa' and section='QA';
```

## งานที่ยังเหลือ

- backfill ได้แค่ระดับ **ส่วนงาน** (PD3/PD4) — ให้ QA ไล่ปรับเป็น **กลุ่ม/ไลน์** จริงที่จอเอง
- ยังไม่มีจอไหนเอา `qaCovers()` ไปใช้กรอง/มอบหมายงาน — ใส่เมื่อมีคนขอ (ตารางว่าง = พฤติกรรมเดิมเป๊ะ)
