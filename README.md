# ESM — Enterprise Shopfloor Management

ระบบบริหารจัดการโรงงานครบวงจร สำหรับ **Thai Summit Group**

---

## Modules

| Module | สถานะ | คำอธิบาย |
|--------|--------|---------|
| 4M Change Management | ✅ Live | บันทึก/อนุมัติการเปลี่ยนแปลง Man · Machine · Material · Method |
| CQI-15 Welding Event Log | ✅ Live | บันทึก Welding Event (Cat A/B/C) + Approval Workflow 4 แผนก + Telegram |
| Attendance & PPE | ✅ Live | เช็คชื่อ + PPE รายวัน + ลางาน (กะเช้า/กะดึก) |
| Employee Management | ✅ Live | ฐานข้อมูลพนักงาน, Skills Matrix, Station Assignment |
| Shift Management | ✅ Live | ตารางกะ A/B/C + Override + Merge |
| Reports & Export | ✅ Live | 10 tabs, CSV, PDF, Excel (attendance form, CQI-15) |
| Daily Production Report | 🔜 Planned | แทน AppSheet — บันทึก Output/Defect/Downtime รายกะ |
| Downtime Tracking | 🔜 Planned | บันทึกและวิเคราะห์ Downtime รายไลน์/เครื่องจักร |
| Production Target vs Actual | 🔜 Planned | เปรียบ Target/Actual รายวัน + กราฟแนวโน้ม |
| PM Checker | 🔜 Planned | แผน Preventive Maintenance + Approval + ประวัติ |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + Vite |
| Routing | React Router DOM 7 |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth |
| Realtime | Supabase Realtime |
| Edge Functions | Deno (Supabase) |
| Notification | Telegram Bot API |
| Charts | Recharts |
| Export | SheetJS (xlsx) |
| Deploy | Render.com (Static Site) |

---

## Quick Start

```bash
npm install
npm run dev
```

Environment variables (`.env.local`):
```
VITE_SUPABASE_URL=https://ewhdfqwfwofivojtsizn.supabase.co
VITE_SUPABASE_ANON_KEY=<key>
```

---

## Role System

| Role | สิทธิ์ |
|------|--------|
| `admin` | ทุกอย่าง |
| `manager` | ดู/แก้ไขทุกหน้า ยกเว้น Add User |
| `supervisor` | จัดการไลน์ตัวเอง, Register พนักงาน, อนุมัติ 4M/CQI-15 |
| `leader` | เห็นเฉพาะ line/team ของตัวเอง |
| `qa` | Dashboard + Report + อนุมัติ CQI-15 QT role |

---

## Deploy

- **Platform:** Render.com (Static Site)
- **Build:** `npm run build` → `./dist`
- **Branch:** `main` (production), `claude/awesome-gauss-Sflxt` (development)
- **Supabase Project:** `ewhdfqwfwofivojtsizn`
