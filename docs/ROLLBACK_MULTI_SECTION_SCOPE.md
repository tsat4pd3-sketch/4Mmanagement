# Rollback — Multi-Section Scoping (profiles.sections)

ฟีเจอร์: จำกัดขอบเขตข้อมูลของ user ได้หลายส่วนงาน (เช่น manager เห็นเฉพาะ PD1+PD2+QA)
ผ่านคอลัมน์ใหม่ `profiles.sections text[]` + helper `src/utils/sectionScope.js`

## ออกแบบมาให้ rollback ง่าย

1. **คอลัมน์ DB เป็น additive** — โค้ดเวอร์ชันก่อนหน้าไม่อ่าน `profiles.sections` เลย
   ปล่อยคอลัมน์ทิ้งไว้ก็ไม่มีผลอะไร → **rollback โค้ดอย่างเดียวก็จบ ไม่ต้องแตะ DB**
2. **`profiles.section` (เดี่ยว) ยังถูกเขียนเสมอ** — หน้า AddUser เขียน `section = ตัวแรกของ sections`
   ทุกครั้งที่สร้าง/แก้ user ดังนั้นหลัง revert โค้ด supervisor ทุกคนยังมี scope เดิมครบ ไม่มีใครหลุดเป็นเห็นทุกส่วนงาน
3. **Fallback ฝั่ง client** — ถ้า `sections` ว่าง/NULL ระบบใช้ logic เดิมทุกประการ
   (supervisor ใช้ `section` เดี่ยว, role อื่นไม่จำกัด) — user เก่าที่ยังไม่ได้ตั้งค่าใหม่ไม่ได้รับผลกระทบ

## ขั้นตอน Rollback (ถ้าพัง)

### 1) Revert โค้ดบน main

```bash
git log --oneline main   # หา <merge_sha> ของ "Merge branch 'claude/production-attendance-systems-t4smxh'" (multi-section scoping)
git revert -m 1 <merge_sha>
git push origin main     # Render deploy อัตโนมัติ
```

### 2) DB — ไม่ต้องทำอะไร (ทางเลือก: ถอนคอลัมน์)

โค้ดเก่าไม่อ่านคอลัมน์นี้ ปล่อยไว้ได้ปลอดภัย 100% — ถ้าต้องการถอนออกจริง:

```sql
ALTER TABLE public.profiles DROP COLUMN IF EXISTS sections;
```

> ห้าม drop ก่อน revert โค้ด — โค้ดใหม่ select คอลัมน์นี้ตอน login ถ้า drop ก่อนจะ login ไม่ได้ทั้งระบบ

### 3) ตรวจหลัง rollback

- Login ด้วย supervisor → ยังเห็นเฉพาะ section ตัวเอง (Management / Checkin / Report / Daily Report)
- Login ด้วย manager → เห็นทุกส่วนงานเหมือนเดิม
- หน้า จัดการผู้ใช้งาน (AddUser) → แสดง Section เดี่ยวแบบเดิม

## จุดที่ฟีเจอร์นี้แตะ (สำหรับตามแก้/ตรวจ)

| ไฟล์ | อะไร |
|---|---|
| `supabase/migrations/20260709_profiles_multi_sections.sql` | เพิ่มคอลัมน์ `profiles.sections text[]` |
| `src/utils/sectionScope.js` | helper `effectiveSections` / `inSectionScope` (ใหม่) |
| `src/App.jsx` | โหลด `sections` เข้า UserContext (`sections` key) |
| `src/pages/AddUser.jsx` | Section เปลี่ยนเป็นติ๊กหลายอัน + เขียน `sections[]` และ `section` (ตัวแรก) คู่กัน |
| `src/pages/Management.jsx` | scope ไลน์ + พนักงานใน pool ตาม `sections` |
| `src/pages/Checkin.jsx` | scope รายชื่อพนักงานตาม `sections` |
| `src/pages/operator.jsx` | scope รายชื่อ + ฟิลด์ Section ตอนแก้ไข (ล็อกเมื่อ scope เดียว) |
| `src/pages/Register.jsx` | ล็อก/จำกัดตัวเลือก Section ตอนลงทะเบียนพนักงาน |
| `src/pages/Report.jsx` | 4M tab (รายการ+สิทธิ์อนุมัติ SV), Skill Matrix, Multi-Skill Form |
| `src/pages/DailyReport.jsx` | Live tab, History tab, Export tab |

พฤติกรรม role หลัง deploy (ไม่มีใครโดนจำกัดเพิ่มโดยไม่ตั้งใจ):

- `admin` — ไม่จำกัดเสมอ (bypass ใน `effectiveSections`)
- `supervisor` ที่มี `section` เดี่ยวเดิม — scope เดิมเป๊ะ (fallback `[section]`)
- `manager`/`qa`/role อื่นที่ **ไม่ได้ตั้ง** `sections` — เห็นทุกส่วนงานเหมือนเดิม
  (แม้จะมีค่า `section` เดี่ยวค้างใน profile ก็ไม่ถูกนำมาจำกัด — จำกัดเฉพาะเมื่อตั้ง `sections[]` ชัดเจน)
- `leader` — ยัง scope ด้วยไลน์+ทีมเหมือนเดิม ไม่เกี่ยวกับ sections
