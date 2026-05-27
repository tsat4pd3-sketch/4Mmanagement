# 4M Management System — Project Knowledge Base

> เอกสารสรุปโปรเจคสำหรับใช้อ้างอิงใน Preventive Maintenance Checker และโปรเจคถัดไป

---

## 1. ภาพรวมโปรเจค

ระบบจัดการสายผลิต **4M (Man, Machine, Material, Method)** สำหรับโรงงาน Thai Summit Group  
ใช้ติดตามพนักงาน, เช็คชื่อ-PPE รายวัน, จัดการสถานีงาน, และบันทึกการเปลี่ยนแปลงกระบวนการผลิต

---

## 2. Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Frontend | React | 19.2.6 |
| Build tool | Vite | 8.0.12 |
| Routing | React Router DOM | 7.15.0 |
| Animation | Framer Motion | 12.38.0 |
| Charts | Recharts | 3.8.1 |
| Database | Supabase (PostgreSQL) | - |
| Auth | Supabase Auth | - |
| Storage | Supabase Storage | - |
| Realtime | Supabase Realtime | - |
| Edge Functions | Deno (Supabase) | - |
| Notification | Telegram Bot API | - |
| Deploy | Render.com (Static Site) | - |

---

## 3. Supabase Project

- **Project ID:** `ewhdfqwfwofivojtsizn`
- **URL:** `https://ewhdfqwfwofivojtsizn.supabase.co`

---

## 4. Database Schema

### หลัก
| Table | คำอธิบาย | Fields สำคัญ |
|-------|---------|-------------|
| `employees` | ข้อมูลพนักงาน | id, employee_id_code, name, image_url, line_id, team (A/B/C), section, is_active, position |
| `production_lines` | ไลน์ผลิต | id, name, section, std_day_shift, std_night_shift |
| `profiles` | User roles | id, email, role, full_name, line_id, section, notify_email, signature_url |

### การผลิตรายวัน
| Table | คำอธิบาย | Fields สำคัญ |
|-------|---------|-------------|
| `daily_production_logs` | เช็คชื่อ + PPE | work_date, employee_id, is_present, has_helmet, has_boots, has_gloves, assigned_line, shift, has_ot, has_extended_ot |
| `attendances` | บันทึกเข้างาน | - |
| `operator_special_tasks` | งานนอกไลน์ | employee_id, work_date, task_type |

### สถานีงาน
| Table | คำอธิบาย |
|-------|---------|
| `workstations` | สถานีในแต่ละไลน์ (pos_top, pos_left สำหรับวาง map) |
| `station_requirements` | ทักษะที่ต้องการต่อสถานี (skill_name, min_score) |
| `line_layouts` | รูปผังไลน์ (image_url) |
| `employee_home_positions` | สถานีประจำของพนักงาน |

### ทักษะ
| Table | คำอธิบาย |
|-------|---------|
| `employee_skills` | คะแนนทักษะรายพนักงาน (skill_name, score 0-100) |
| `skill_definitions` | นิยามทักษะ (id, name, label, color) |

### กะการทำงาน
| Table | คำอธิบาย |
|-------|---------|
| `shift_schedules` | ตารางกะ A/B รายสัปดาห์ |
| `shift_overrides` | Override กะรายบุคคล |
| `shift_merge_events` | Merge กะทั้ง section/line |

### 4M & Notifications
| Table | คำอธิบาย | Fields สำคัญ |
|-------|---------|-------------|
| `four_m_logs` | บันทึกการเปลี่ยนแปลง 4M | work_date, line_name, category (Man/Machine/Material/Method), description, status, created_by, sv_approved_by, approved_by, reject_reason |
| `notifications` | In-app notifications | user_id, title, body, type (success/error/info), is_read, ref_table, ref_id |
| `ppe_items` | รายการ PPE | - |
| `ppe_requirements` | PPE ที่แต่ละไลน์ต้องการ | - |
| `ppe_checks` | บันทึกการตรวจ PPE | - |

---

## 5. Pages & Routes

| Route | หน้า | Role ที่เข้าได้ | คำอธิบาย |
|-------|-----|--------------|---------|
| `/` | Dashboard | ทุก role | KPI cards, line status, floor maps, 4M activity feed |
| `/management` | Management | ทุก role | Drag-drop station assignment, skill fit scoring, 4M logging |
| `/checkin` | Checkin | ทุก role | เช็คชื่อ + PPE + ลางาน รายวัน |
| `/linesetup` | LineSetup | Admin/Manager/SV | ตั้งค่าไลน์, อัปโหลด layout, เพิ่ม workstations |
| `/register` | Register | Admin/SV | เพิ่มพนักงานใหม่พร้อมรูปและข้อมูล |
| `/operator` | Operator | Admin/Manager/SV/Leader | ฐานข้อมูลพนักงาน + skill matrix |
| `/report` | Report | ทุก role | 10 tabs + CSV export |
| `/shift-organize` | ShiftOrganize | Admin/Manager/SV | ตารางกะ A/B + overrides |
| `/add-user` | AddUser | Admin เท่านั้น | สร้าง/แก้ไข system users + roles |
| `/login` | Login | ไม่ต้อง auth | หน้าเข้าสู่ระบบ |

---

## 6. Role System

| Role | สิทธิ์หลัก |
|------|-----------|
| `admin` | ทุกอย่าง รวมถึง Add User |
| `manager` | ดูและแก้ไขได้ทุกหน้า ยกเว้น Add User |
| `supervisor` | จัดการไลน์ตัวเอง, Register พนักงาน, อนุมัติ 4M step 1 |
| `leader` | เห็นเฉพาะ line/team ของตัวเอง |
| `qa` | ดู Dashboard + Report, อนุมัติ 4M step QA |

---

## 7. 4M Approval Workflow

```
ช่าง/SV สร้าง Log → status: "pending"
         ↓
Supervisor อนุมัติ → status: "pending_qa"  (ถ้า requires_qa = true)
                  → status: "approved"     (ถ้าไม่ต้อง QA)
         ↓
QA อนุมัติ → status: "approved"
         ↓ (หรือ)
ใครก็ได้ Reject → status: "rejected" + reject_reason

ทุก status change → Telegram Group แจ้งเตือนทันที
```

---

## 8. Telegram Notification

### Edge Function: `send-notification`
- **Endpoint:** `POST /functions/v1/send-notification`
- **Payload:** `{ event: "status_change", log: { ...four_m_log } }`
- **Secrets:**
  - `TELEGRAM_BOT_TOKEN` — จาก @BotFather
  - `TELEGRAM_CHAT_ID` — Group Chat ID (เลขติดลบ เช่น `-5279077923`)

### ข้อความที่ส่ง
```
🔔 4M Man · Line 1 → รอ SV Approve

📅 วันที่: 2026-05-27
🏭 ไลน์: Line 1
📋 ประเภท: Man
📝 รายละเอียด: เปลี่ยนพนักงาน
🔖 สถานะ: รอ SV Approve
👤 ผู้แจ้ง: สมชาย ใจดี
✅ Supervisor อนุมัติ: สุดา มีสุข  ← แสดงเมื่อ approved แล้ว
✅ QA อนุมัติ: วิชัย เก่งมาก      ← แสดงเมื่อ QA approved แล้ว

— 4M Management System
```

---

## 9. File Structure

```
4Mmanagement/
├── src/
│   ├── App.jsx                    # Router + Sidebar + Auth + UserContext
│   ├── index.css                  # Theme CSS variables (dark/light)
│   ├── supabaseClient.js          # Supabase init
│   ├── components/
│   │   ├── Toast.jsx              # Global toast singleton
│   │   ├── SignatureModal.jsx     # วาด/อัปโหลดลายเซ็น
│   │   └── ChangePasswordModal.jsx
│   └── pages/
│       ├── Dashboard.jsx          # KPI + Floor maps + Activity feed
│       ├── Management.jsx         # Drag-drop station + 4M logging
│       ├── Checkin.jsx            # เช็คชื่อ + PPE + ลางาน
│       ├── LineSetup.jsx          # ตั้งค่าไลน์ + workstations
│       ├── Register.jsx           # เพิ่มพนักงาน
│       ├── Operator.jsx           # ฐานข้อมูล + skill matrix
│       ├── Report.jsx             # 10 tabs + CSV export
│       ├── ShiftOrganize.jsx      # ตารางกะ
│       ├── AddUser.jsx            # จัดการ system users
│       └── Login.jsx
├── supabase/
│   └── functions/
│       └── send-notification/
│           └── index.ts           # Telegram + in-app notifications
├── CLAUDE.md                      # Tech stack + tables (project instructions)
├── SKILL.md                       # ไฟล์นี้
└── WI-4M-System-101.md           # คู่มือการใช้งาน
```

---

## 10. Patterns & Utilities

### Toast (Singleton)
```js
import { toast } from '../components/Toast'
toast.success('บันทึกสำเร็จ')
toast.error('เกิดข้อผิดพลาด')
toast.info('กำลังโหลด...')
```

### UserContext
```js
const { role, lineId, team, section, fullName } = useContext(UserContext)
```

### Date/Time Utilities
```js
getWorkDate()       // วันทำงาน — ก่อน 08:00 = วันก่อนหน้า
toLocalDateStr()    // YYYY-MM-DD format
getShiftInfo()      // กะเช้า 08:00-20:00 / กะดึก 20:00-08:00
```

### Skill Fit Scoring
```js
computeFit(employee, station)  // % ของทักษะที่ผ่าน min_score
fitColor(score)   // 80+ green | 60-79 amber | 40-59 orange | <40 red
fitLabel(score)   // ดีเยี่ยม / ดี / พอใช้ / ต่ำกว่าเกณฑ์
```

### CSV Export
```js
downloadCSV(rows, filename)  // Client-side export ไม่ต้อง server
```

---

## 11. Design System

### CSS Variables (Theme)
```css
--bg, --bg2, --bg3      /* พื้นหลัง 3 ระดับ */
--card                  /* Card background */
--border, --border2     /* เส้นขอบ */
--accent                /* สีหลัก (green) */
--accent2               /* สีรอง (amber) */
--text, --text2, --muted
--sidebar-w: 252px
--radius-lg: 8px
```

### Responsive Breakpoints
| ชื่อ | ขนาด |
|------|------|
| Mobile | < 768px |
| Tablet | 768–1279px |
| Desktop | 1280–1599px |
| Ultra-wide | ≥ 1600px |

### Fonts
- **Body:** Sarabun (รองรับภาษาไทย)
- **Display:** Tahoma

---

## 12. Shift Logic

| กะ | เวลา | OT |
|----|------|-----|
| กะเช้า (Day) | 08:00–17:30 | 17:30–20:00 |
| กะดึก (Night) | 20:00–07:59 | 20:00–22:30 |
| Extended OT | 20:00–23:00 | กะเช้าพิเศษ |

- **Team A** = กะเช้าสัปดาห์คู่ / กะดึกสัปดาห์คี่ (หมุน)
- **Team B** = ตรงข้าม Team A
- **Team C** = กะเช้าตลอด ไม่หมุน
- **Work date:** ก่อน 08:00 = นับเป็นวันก่อนหน้า

---

## 13. Deploy

```
Platform:    Render.com (Static Site)
Build cmd:   npm run build
Output dir:  ./dist
Branch:      main

Environment Variables:
  VITE_SUPABASE_URL=https://ewhdfqwfwofivojtsizn.supabase.co
  VITE_SUPABASE_ANON_KEY=<key from Supabase dashboard>
```

---

## 14. สิ่งที่ Reuse ได้ใน Preventive Maintenance Checker

### Components/Patterns นำไปใช้ได้เลย
| สิ่งที่มี | วิธีใช้ใน PM |
|---------|------------|
| Supabase Auth + Profiles + Roles | ใช้ระบบ Auth เดิมทั้งหมด |
| Toast.jsx | Copy ไปใช้แสดง feedback |
| Telegram Bot notification | Copy Edge Function + ตั้ง Secrets ใหม่ |
| In-app notification bell | ใช้กับ `notifications` table เดิม |
| 4M Approval workflow | ดัดแปลงเป็น PM approval (ช่าง → SV → approve) |
| SignatureModal.jsx | ลายเซ็นยืนยันงาน PM เสร็จ |
| CSV export | Report ประวัติ PM |
| Dark/Light theme | Copy index.css variables |
| Recharts | แสดงสถิติ PM (กราฟ bar/line) |
| ChangePasswordModal | ใช้ร่วมกันได้เลย |

### Database Tables ที่แนะนำสำหรับ PM Checker

```sql
machines              -- เครื่องจักร (id, name, line_id, type, image_url, location)
pm_schedules          -- กำหนดการ PM (machine_id, frequency_days, last_pm_date, next_pm_date)
pm_checklist_items    -- รายการตรวจ (id, schedule_id, item_name, method, standard, unit)
pm_logs               -- บันทึกผล PM (id, machine_id, scheduled_date, done_date, technician_id, status)
pm_log_results        -- ผลตรวจแต่ละรายการ (pm_log_id, item_id, actual_value, is_pass, remark)
pm_attachments        -- รูปถ่ายหรือเอกสาร (pm_log_id, file_url, uploaded_at)
```

### Roles สำหรับ PM
| Role | สิทธิ์ |
|------|-------|
| `technician` | ทำ PM, บันทึกผล, อัปโหลดรูป |
| `supervisor` | อนุมัติผล PM, ดู report ทุกไลน์ |
| `manager` | ดู dashboard + report รวม |
| `admin` | ตั้งค่าทุกอย่าง, จัดการ users |

### Flow ที่แนะนำ
```
ระบบแจ้งเตือนอัตโนมัติ (cron/trigger) → PM ใกล้ครบกำหนด
         ↓
ช่าง (technician) เปิด PM Log → กรอก checklist ทีละรายการ
         ↓
อัปโหลดรูปหลักฐาน + ลายเซ็นดิจิทัล
         ↓
Supervisor อนุมัติ → status: "approved"
         ↓
Telegram แจ้ง Group + อัปเดต next_pm_date
```

---

*อัปเดตล่าสุด: 2026-05-27*
