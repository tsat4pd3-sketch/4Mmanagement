# ESM — Enterprise Shopfloor Management

ระบบบริหารจัดการโรงงานครบวงจร สำหรับอุตสาหกรรมการผลิต  
ครอบคลุม 4M Change Management · OEE / Daily Production Report · เช็คชื่อ-PPE · Skill Matrix · กะการทำงาน

**Tech stack:** React 19 · Vite · Supabase (PostgreSQL + Auth + Realtime) · Recharts · Framer Motion

---

## ✨ Feature หลัก

| Module | คำอธิบาย |
|--------|---------|
| 📊 Dashboard | ภาพรวม real-time: กำลังคน, PPE, OEE, ผังไลน์, 4M feed |
| ⚡ Daily Report | เปิด-ปิดกะ, สแกน Kanban Order, Downtime, งานเสีย, OEE อัตโนมัติ |
| 🧩 Line Management | Drag-drop จัดคนลงสถานี, Skill Fit scoring, 4M log อัตโนมัติ |
| ✅ Check-in | เช็คชื่อ + PPE + ลางาน รายวัน + Skill Farming |
| 🗓 Shift Organize | ตาราง A/B กะ, override รายบุคคล, ยุบกะ |
| 📋 4M Workflow | Man/Machine/Material/Method → SV/QA approval → Telegram แจ้งเตือน |
| 🎯 Skill Matrix | คะแนนทักษะ 0–100, Fit % ต่อสถานี, auto-increment รายวัน |
| 📑 Reports | 10 แท็บ + CSV export |

---

## 🚀 ติดตั้งใช้งาน

**ดูคู่มือฉบับเต็ม → [`docs/SETUP_GUIDE.md`](docs/SETUP_GUIDE.md)**

ขั้นตอนโดยสรุป (ใช้เวลา ~1–2 ชั่วโมง):

1. สร้าง Supabase 2 โปรเจค → รัน SQL ใน `docs/sql/`
2. Copy `.env.example` → `.env` แล้วใส่ Supabase URL + keys
3. `npm install && npm run build` แล้ว deploy ที่ Render/Vercel/Netlify
4. สร้าง Admin user ใน Supabase Auth → ตั้ง role ใน profiles table
5. ตั้งค่า master data ในแอพ (ไลน์, พนักงาน, สินค้า, Kanban)

---

## 📁 โครงสร้างเอกสาร

```
docs/
├── SETUP_GUIDE.md      คู่มือติดตั้งสำหรับทีม IT
├── USER_MANUAL.md      คู่มือใช้งานทุกหน้า ทุกฟังก์ชัน
└── sql/
    ├── 01_main_schema.sql   Schema โปรเจคหลัก (19 ตาราง)
    ├── 02_dr_schema.sql     Schema Daily Report (10 ตาราง)
    └── 03_seed_data.sql     ข้อมูลตั้งต้น (แก้ให้ตรงโรงงาน)
```

---

## 🖥 คำสั่ง Dev

```bash
npm install       # ติดตั้ง dependencies
npm run dev       # เปิด dev server ที่ http://localhost:5173
npm run build     # build สำหรับ deploy → ./dist
```
