# 🔁 จอวนหน้า (display rotation) — `/display-rotation` (2026-10-09)

> คำสั่ง user: *"user ที่เป็น role display เราจะตั้งหน้าที่จะให้มันเปิดวนไปเรื่อยๆ ได้มั้ย"*
> → เลือกแบบ ข. *"มีหน้า config ได้ ว่าจอ user นี้จะเปิดอะไรวนบ้าง"* (แทนแบบ ก. = ใส่รายการหน้าในลิงก์บุ๊กมาร์ก)

## ชิ้นส่วน

| ชิ้น | ไฟล์ | หน้าที่ |
|---|---|---|
| ตาราง | `display_rotations` (**Main**) · migration `20261009_display_rotations_main.sql` | 1 แถว = 1 บัญชีที่เปิดจอ (`user_id` = PK) |
| กฎกลาง | `src/utils/displayRotation.js` (+ เทส `__tests__/displayRotation.test.mjs`) | ตรวจ path · clamp วินาที · แยกหน้าที่ข้าม · ลำดับถัดไป · เกณฑ์รีโหลด |
| ตัววนบนจอ | `src/components/DisplayRotator.jsx` | ฝังใน `ProtectedLayout` **ทุก branch** (`/tv` · Home · หน้าปกติ) |
| หน้าตั้งค่า | `src/pages/DisplayRotation.jsx` | เลือกบัญชี → ลำดับหน้า + วินาที/หน้า + ค่าหยุดเมื่อมีคนแตะ + รอบรีโหลด |

**`items`** = `[{ "path": "/tv?dept=production", "sec": 60 }, …]` · `sec: null` = ใช้ `default_sec` ของแถว
· ลิสต์หน้าให้เลือกมาจาก `NAV_ITEMS` (ไม่มีรายชื่อหน้าซ้ำในไฟล์) · ส่วนต่อท้าย `?…` พิมพ์เองได้ (เช่น `?dept=production` ของ `/tv`)

## กฎ

- 🔴 **หน้าที่บัญชีจอไม่มีสิทธิ์ = ข้าม แล้วต้องเขียนบนจอ** — ชิปบนจอ "⚠ ข้าม N หน้า" (hover ดูรายการ) +
  หน้าตั้งค่าติด ⛔ ตั้งแต่ตอนเลือก · ตัดสินด้วย `canAccessPage(path, role ของบัญชีนั้น)` ตอนวนจริง
  **ห้ามเก็บสิทธิ์ลงแถว** (สิทธิ์เปลี่ยนที่ `/permissions` ได้ตลอด)
- 🔴 **ตัววนไม่ยกเว้น auto-logout** — เปลี่ยนหน้าเองไม่นับเป็น activity · บัญชีจอควรเป็น role `display`
  (ยกเว้น idle-logout อยู่แล้ว) · หน้าตั้งค่าเตือนเหลืองเมื่อบัญชีไม่ใช่ display
  · **ห้ามแก้ด้วยการเพิ่มทุกหน้าในรอบเข้า `KIOSK_PATHS`** (กฎใน `src/utils/kioskRoutes.js` — หน้าที่มีปุ่มเขียนข้อมูลห้ามเป็น kiosk)
- path ต้องเป็นเส้นทางภายใน (`/…` · ห้าม `//host` `http:` · ห้าม `/login` `/register`) — `isValidRotationPath()`
- มีคนแตะ/คลิก/กดปุ่ม/เลื่อน = หยุดวนชั่วคราว `pause_sec` แล้ววนต่อเอง · ปุ่ม ⏸ บนชิป = หยุดค้าง
  (ปุ่มบนชิปเองไม่นับเป็น "มีคนใช้จอ")
- เปลี่ยนหน้าแบบ SPA · ครบ `reload_min` แล้ว **รีโหลดเต็มหน้าตอนเปลี่ยนหน้า** (`window.location.assign` ไปหน้าถัดไป)
  กันหน่วยความจำค้างบนทีวี webOS (Chromium 94) · `null` = ไม่รีโหลด
- อ่านแผนใหม่ทุกครั้งที่วนครบรอบ (1 แถวเล็ก) — **ไม่ใช้ realtime** · แก้ที่หน้าตั้งค่าแล้วจอรับเองภายใน 1 รอบ
- admin ที่จำลองมุมมอง (viewAs) = ตัววนปิด
- จอที่ login บัญชีเดียวกันหลายเครื่อง = ได้รอบเดียวกัน (ผูกต่อบัญชี ไม่ใช่ต่อเครื่อง) — อยากให้ต่างกันต้องแยกบัญชี

## สิทธิ์

`page:/display-rotation` + `display_rotation:manage` — seed admin/manager (วงแคบก่อน · ขยายที่ `/permissions`)
· RLS: อ่าน = เจ้าของบัญชี (จออ่านแผนตัวเอง) **หรือ** `has_perm('display_rotation:manage')` · เขียน = `has_perm('display_rotation:manage')`
· ผูก `fn_audit` (row_pk = user_id)

## สถานะ DB (2026-10-09)

apply แล้วบน Main — ตาราง + RLS 2 policy + trigger `trg_audit`/`trg_display_rotations_updated` + สิทธิ์ 4 แถว + catalog 1 แถว
(⚠️ `apply_migration` ของ MCP timeout ทั้ง 2 ครั้ง ⇒ รันทีละคำสั่งผ่าน `execute_sql` · ไม่มีแถวใน `supabase_migrations` แต่ไฟล์อยู่ในรีโป)

สิทธิ์เข้าหน้าของ role `display` วัด 09/10: มี `/tv` `/dashboard` `/line-oee` `/factory-map` `/manpower-board` `/obeya`
`/oee-analytics` ฯลฯ (45 หน้า) · **ไม่มี** `/machine-database` `/die-registry` → ใส่ในรอบได้แต่จะถูกข้าม

## ยังไม่ทำ (เฟสถัดไป)

- ตั้งรอบ "ต่อเครื่อง" (หลายจอใช้บัญชีเดียว แต่วนคนละชุด) — ต้องมีรหัสเครื่องในเบราว์เซอร์ ยังไม่มีคนขอ
- ช่วงเวลาตามกะ (กะเช้าวนชุด A กะดึกชุด B)
