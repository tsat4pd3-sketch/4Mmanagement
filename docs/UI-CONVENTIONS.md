# UI Conventions — ESM (Enterprise Shopfloor Management)

> **อ่านไฟล์นี้ก่อนแก้ UI ทุกครั้ง และทำตามอย่างเคร่งครัด**
> ถ้างานของคุณ *สร้างหรือเปลี่ยน pattern ที่ใช้ร่วมกันหลายหน้า* ให้อัปเดตไฟล์นี้
> (พร้อมวันที่) ในคอมมิทเดียวกันด้วย ถ้า convention ขัดกับสิ่งที่กำลังจะทำ
> ให้ทำตาม convention ก่อน เว้นแต่เจ้าของโปรเจกต์สั่งเปลี่ยน

สร้างครั้งแรก: 2026-07-09

---

## 1. จุด/Marker บนผังไลน์ (ทุกหน้าที่วาง marker บนรูปผัง)

- Marker = **วงกลม + ป้ายชื่อใต้วงกลม เท่านั้น** — **ห้ามกล่องเหลี่ยม**
- ตำแหน่งเก็บเป็น `pos_top` / `pos_left` = **% ของ "ตัวรูปจริง"** (ไม่ใช่ % ของการ์ด)
- ขนาด marker สเกลตาม **ความกว้างผังจริง** (สูตร MK) และต้อง **clamp ไม่ให้ตกขอบรูป**
- วิธี clamp ที่เป็นมาตรฐาน: วาง overlay ทับ *กรอบรูปหลังหัก letterbox* (คำนวณ
  `object-fit: contain` → `ox/oy/rw/rh`) แล้ววาง marker ด้วย `translate(-50%,-50%)`
  ภายใน overlay นั้น จุดจึงเกาะรูปตรงตำแหน่งเดิมทุกขนาดจอ

**Reference implementation:** `src/pages/Dashboard.jsx` → `ThumbMap` (มาตรฐานเดียวกับ
`LineSetup.jsx` และ `Management.jsx`). ใช้ pattern นี้ซ้ำ อย่าประดิษฐ์ใหม่

## 2. ไฟ/ป้าย Alarm — ตรรกะ Andon

- ใช้สเกล **เขียว – เหลือง – แดง**
- **กระพริบเฉพาะสีแดง** = เครื่องหยุดค้าง (stuck-open downtime) เท่านั้น
  เขียว/เหลืองไม่กระพริบ
- ตรรกะ alarm รวมอยู่ที่ **`src/utils/downtimeAlarm.js`** (alarm เมื่อ downtime
  ยังไม่ปิดรายการ หรือเพิ่งบันทึกภายใน 10 นาที) — ใช้ helper นี้ อย่าคำนวณเงื่อนไข
  alarm ซ้ำในแต่ละหน้า
- คลาสกระพริบมาตรฐาน: `dt-alarm-blink`

## 3. ตัวอักษร / เลย์เอาต์ (จอ TV เป็นหลัก)

- **ฟอนต์ขั้นต่ำ 11–12px** สำหรับ text/label ที่ต้องอ่าน (badge, cell, label)
  — ข้อยกเว้นเดียว: glyph เล็กภายในตัว marker บนผัง (initial ในวงกลม) ที่พื้นที่จำกัด
- การ์ดใน **grid เดียวกันต้องสูงเท่ากัน** (ใช้ grid/flex ที่ยืดความสูงเสมอกัน
  อย่าปล่อยให้การ์ดเตี้ย-สูงสลับ)
- สีสถานะให้สอดคล้อง andon: เขียว `#22c55e` / เหลือง-ส้ม `#f59e0b` / แดง `#ef4444`

## 4. สิทธิ์ Action

- ตรวจสิทธิ์ระดับ action ด้วย **`can(resource, action, role)` จาก
  `src/utils/permissions.js`** เท่านั้น
- **ห้าม hardcode role array เพิ่ม** (เช่น `['admin','manager'].includes(role)`)
  — ถ้าต้องการสิทธิ์ใหม่ ให้เพิ่ม permission key ในตาราง `role_permissions`
  (seed เป็น migration) แล้วเช็คด้วย `can()` เพื่อให้ปรับได้จากหน้า `/permissions`
- `admin` bypass เสมอในตัว `can()` อยู่แล้ว ไม่ต้องเช็คซ้ำ

---

## Shared patterns log

บันทึก pattern ที่ใช้ร่วมกันเมื่อสร้าง/แก้ (ล่าสุดอยู่บน)

- **2026-07-09 — Store review queue (Line Stock):** manual stock movement ที่ต้อง
  อนุมัติก่อนมีผลต่อ on-hand → insert เป็น `status='pending'`, มีคิว "⏳ รออนุมัติ"
  ให้ผู้มีสิทธิ์ (`can('line_stock','approve',role)`) กด อนุมัติ/ปฏิเสธ (พร้อมเหตุผล),
  badge สถานะ pending/rejected ในประวัติ. อนุมัติ/ปฏิเสธใช้ update ที่ผูก
  `.eq('status','pending')` เพื่อกันกดซ้ำ/สองคน. ประเภทที่ต้อง review คุมจาก config
  array `REVIEW_TYPES` จุดเดียว. ref: `src/pages/LineStock.jsx`
