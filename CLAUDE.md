# 4M Management System

ระบบจัดการสายผลิต (4M: Man, Machine, Material, Method) สำหรับโรงงาน

## Tech Stack

- **Frontend:** React 19 + Vite 8
- **Database:** Supabase (PostgreSQL)
- **Routing:** React Router DOM v7
- **Charts:** Recharts
- **Animation:** Framer Motion
- **Deploy:** Render.com (Static Site)

## Supabase Project

- **Project ID:** `ewhdfqwfwofivojtsizn`
- **URL:** `https://ewhdfqwfwofivojtsizn.supabase.co`

## Database Tables

| Table | Rows | Description |
|-------|------|-------------|
| `employees` | - | ข้อมูลพนักงาน (มี `position`, `line_id` FK) |
| `production_lines` | 5 | ไลน์ผลิต |
| `ppe_items` | 10 | รายการ PPE |
| `ppe_requirements` | 25 | PPE ที่แต่ละไลน์ต้องการ |
| `attendances` | - | การเช็คชื่อพนักงาน |
| `ppe_checks` | - | บันทึกการตรวจ PPE |
| `daily_production_logs` | - | บันทึกการผลิตรายวัน |
| `four_m_logs` | - | บันทึกการเปลี่ยนแปลง 4M |
| `workstations` | - | สถานีงานในแต่ละไลน์ |
| `line_layouts` | - | ผังไลน์ |
| `profiles` | - | ข้อมูล user role (supervisor/manager) |

## Pages

| Route | Component | Description |
|-------|-----------|-------------|
| `/` | Dashboard | สรุปผลภาพรวม |
| `/management` | Management | จัดการสายผลิต |
| `/checkin` | Checkin | เช็คชื่อ & PPE |
| `/linesetup` | LineSetup | ตั้งค่าผังไลน์ |
| `/register` | Register | เพิ่มพนักงาน |
| `/operator` | Operator | ฐานข้อมูลพนักงาน |
| `/login` | Login | เข้าสู่ระบบ |

## Deploy (Render.com)

- **Type:** Static Site
- **Build Command:** `npm run build`
- **Publish Directory:** `./dist`
- **Branch:** `main`

### Environment Variables ที่ต้องตั้งบน Render

```
VITE_SUPABASE_URL=https://ewhdfqwfwofivojtsizn.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key from Supabase dashboard>
```

## Development

```bash
npm install
npm run dev
```

## Branch

- **Main branch:** `main`
- **Development branch:** `claude/align-with-oee-project-60AMb`
