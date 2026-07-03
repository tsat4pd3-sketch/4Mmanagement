# ESM — Enterprise Shopfloor Management · Project Knowledge Base

ระบบบริหารจัดการโรงงานครบวงจร สำหรับ **Thai Summit Group**  
ครอบคลุม 4M Change Management, CQI-15 Welding Event Log, การเช็คชื่อ-PPE รายวัน, Daily Production Report, Employee Skills Matrix, Shift Management และ Approval Workflow

> ชื่อเดิม: 4M Management System (ยกระดับเป็น Enterprise Shopfloor Management)

---

## Tech Stack

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

## Supabase Project

- **Project ID:** `ewhdfqwfwofivojtsizn`
- **URL:** `https://ewhdfqwfwofivojtsizn.supabase.co`

---

## Database Schema

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

### PPE
| Table | คำอธิบาย |
|-------|---------|
| `ppe_items` | รายการ PPE (10 รายการ) |
| `ppe_requirements` | PPE ที่แต่ละไลน์ต้องการ (25 รายการ) |
| `ppe_checks` | บันทึกการตรวจ PPE |

### 4M & Notifications
| Table | คำอธิบาย | Fields สำคัญ |
|-------|---------|-------------|
| `four_m_logs` | บันทึกการเปลี่ยนแปลง 4M | work_date, line_name, category (Man/Machine/Material/Method), description, status, created_by, sv_approved_by, approved_by, reject_reason, requires_qa |
| `notifications` | In-app notifications | user_id, title, body, type (success/error/info), is_read, ref_table, ref_id |

---

## Pages & Routes

| Route | Component | Role ที่เข้าได้ | คำอธิบาย |
|-------|-----------|--------------|---------|
| `/` | Dashboard | ทุก role | KPI cards, line status, floor maps, 4M activity feed |
| `/management` | Management | ทุก role | Drag-drop station assignment, skill fit scoring, 4M logging |
| `/checkin` | Checkin | ทุก role | เช็คชื่อ + PPE + ลางาน รายวัน |
| `/event-log` | EventLog | ทุก role | CQI-15 Welding Event Log + Approval Workflow (4 roles) |
| `/daily-report` | DailyReport | ทุก role | **[PLANNED]** บันทึก Daily Production Report แทน AppSheet |
| `/downtime` | Downtime | Admin/Manager/SV | **[PLANNED]** บันทึกและวิเคราะห์ Downtime รายไลน์ |
| `/production-target` | ProductionTarget | Admin/Manager | **[PLANNED]** Target vs Actual รายวัน/รายเดือน + กราฟ |
| `/pm-checker` | PMChecker | Admin/Manager/SV | **[PLANNED]** ระบบแผน PM เครื่องจักร + Approval |
| `/linesetup` | LineSetup | Admin/Manager/SV | ตั้งค่าไลน์, อัปโหลด layout, เพิ่ม workstations |
| `/register` | Register | Admin/SV | เพิ่มพนักงานใหม่พร้อมรูปและข้อมูล |
| `/operator` | Operator | Admin/Manager/SV/Leader | ฐานข้อมูลพนักงาน + skill matrix |
| `/report` | Report | ทุก role | 10 tabs + CSV export |
| `/shift-organize` | ShiftOrganize | Admin/Manager/SV | ตารางกะ A/B + overrides |
| `/add-user` | AddUser | Admin เท่านั้น | สร้าง/แก้ไข system users + roles |
| `/login` | Login | ไม่ต้อง auth | หน้าเข้าสู่ระบบ |

---

## Organizational Hierarchy (Thai Summit Group)

ลำดับชั้นองค์กรที่สอดคล้องกันทั้งระบบ — **ห้ามเพิ่มฟีเจอร์ที่ขัดกับลำดับชั้นนี้**

```
ระดับส่วน (Section)      → org_nodes.kind='section'  cost center 21404XXXX
  เช่น PD1, PD2, QA, MTN, JIG MTN, DIE MTN
      ↓
ระดับแผนก (Department)  → org_nodes.kind='department' cost center 21405XXXX
  เช่น HYDROFORM, ASSEMBLY
      ↓
ระดับกลุ่ม/ไลน์หลัก    → production_lines ที่ parent_line_name IS NULL
  เช่น HYDROFORM (parent), LINE APRON ASSY
      ↓
ระดับไลน์ผลิต           → production_lines ที่ parent_line_name SET
  เช่น HDF1, HDF2, LASER123, LASER456, LASER E50, LASER EXPORT
      ↓
ระดับ Team              → employees.team = 'A' | 'B' | 'C'
  A/B หมุนกะ | C กะเช้าตลอด
```

**กฎการ link ข้ามระดับ:**
- `production_lines.section` = `org_nodes.code` ของ section
- `production_lines.parent_line_name` = `name` ของ production_line ระดับแผนก (เช่น 'HYDROFORM')
- Department name ใน org_nodes ต้องตรงกับ parent production_line name เพื่อให้ Register กรอง LINE dropdown ถูก
- Register.jsx กรอง LINE โดย: `l.name === department || l.parent_line_name === department`

---

## Role System

| Role | สิทธิ์หลัก |
|------|-----------|
| `admin` | ทุกอย่าง รวมถึง Add User |
| `manager` | ดูและแก้ไขได้ทุกหน้า ยกเว้น Add User |
| `supervisor` | จัดการไลน์ตัวเอง, Register พนักงาน, อนุมัติ 4M step 1 |
| `leader` | เห็นเฉพาะ line/team ของตัวเอง |
| `qa` | ดู Dashboard + Report, อนุมัติ 4M step QA |

---

## 4M Approval Workflow

```
สร้าง Log → status: "pending"
     ↓
Supervisor อนุมัติ → status: "pending_qa"  (ถ้า requires_qa = true)
                  → status: "approved"     (ถ้าไม่ต้อง QA)
     ↓
QA อนุมัติ → status: "approved"
     ↓ (หรือ)
Reject → status: "rejected" + reject_reason

ทุก status change → Telegram Group แจ้งเตือนทันที
```

---

## Edge Functions

### `send-notification`
- **Endpoint:** `POST /functions/v1/send-notification`
- **Payload:** `{ event: "status_change", log: { ...four_m_log } }`
- **Secrets ที่ต้องตั้งใน Supabase:**
  - `TELEGRAM_BOT_TOKEN` — จาก @BotFather
  - `TELEGRAM_CHAT_ID` — Group Chat ID (เลขติดลบ เช่น `-5279077923`)

---

## File Structure

```
src/
├── App.jsx                    # Router + Sidebar + Auth + UserContext
├── index.css                  # Theme CSS variables (dark/light)
├── supabaseClient.js          # Supabase init
├── components/
│   ├── Toast.jsx              # Global toast singleton
│   ├── SignatureModal.jsx     # วาด/อัปโหลดลายเซ็น
│   └── ChangePasswordModal.jsx
└── pages/
    ├── Dashboard.jsx
    ├── Management.jsx
    ├── Checkin.jsx
    ├── LineSetup.jsx
    ├── Register.jsx
    ├── Operator.jsx
    ├── Report.jsx
    ├── ShiftOrganize.jsx
    ├── AddUser.jsx
    └── Login.jsx

supabase/
└── functions/
    └── send-notification/
        └── index.ts           # Telegram + in-app notifications
```

---

## Patterns & Utilities

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

> ⚠️ **กฎสำคัญ — ห้ามใช้ `new Date().toISOString()` เพื่อหาวันที่งาน**  
> `toISOString()` คืนค่า UTC ซึ่งต่างจากเวลาไทย (UTC+7) ทำให้วันที่คลาดเคลื่อน  
> ให้ใช้ฟังก์ชันด้านล่างเท่านั้น และต้องใช้เหมือนกันทุกหน้า

```js
// ✅ ใช้ทุกครั้งที่ต้องการ work_date สำหรับ query DB
getWorkDate()
// → คืน "YYYY-MM-DD" แบบ local time
// → ถ้าเวลาปัจจุบัน < 08:00 ให้นับเป็นวันก่อนหน้า (งานกะดึกข้ามวัน)

// ✅ ใช้ detect กะปัจจุบัน
getCurrentShift()
// → "day"   เมื่อ 08:00–19:59
// → "night" เมื่อ 20:00–07:59

// ✅ ใช้แสดงผลเวลา (ไม่ใช่สำหรับ query)
new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })

// ❌ ห้ามใช้เพื่อหาวันที่งาน
new Date().toISOString()          // UTC — ผิดสำหรับไทย
new Date().toISOString().slice(0,10)  // อาจได้วันที่ผิด
```

```js
getShiftInfo()  // object { shift, label } — กะเช้า 08:00-20:00 / กะดึก 20:00-08:00
```

### Skill Fit Scoring
```js
computeFit(employee, station)  // % ของทักษะที่ผ่าน min_score
fitColor(score)   // 80+ green | 60-79 amber | 40-59 orange | <40 red
```

---

## Design System

### CSS Variables
```css
--bg, --bg2, --bg3      /* พื้นหลัง 3 ระดับ */
--card                  /* Card background */
--border, --border2
--accent                /* สีหลัก (green) */
--accent2               /* สีรอง (amber) */
--text, --text2, --muted
--sidebar-w: 252px
--radius-lg: 8px
```

### Breakpoints
| ชื่อ | ขนาด |
|------|------|
| Mobile | < 768px |
| Tablet | 768–1279px |
| Desktop | 1280–1599px |
| Ultra-wide | ≥ 1600px |

### Fonts: Sarabun (Thai body), Tahoma (display)

---

## Shift Logic

| กะ | เวลา | OT |
|----|------|-----|
| กะเช้า (Day) | 08:00–17:30 | 17:30–20:00 |
| กะดึก (Night) | 20:00–07:59 | 20:00–22:30 |
| Extended OT | 20:00–23:00 | กะเช้าพิเศษ |

- **Team A/B** — หมุนกะสลับกัน
- **Team C** — กะเช้าตลอด ไม่หมุน
- **Work date:** ก่อน 08:00 = นับเป็นวันก่อนหน้า

---

## Deploy

```
Platform:    Render.com (Static Site)
Build cmd:   npm run build
Output dir:  ./dist
Branch:      main
Dev:         npm run dev

Environment Variables:
  VITE_SUPABASE_URL=https://ewhdfqwfwofivojtsizn.supabase.co
  VITE_SUPABASE_ANON_KEY=<key from Supabase dashboard>
```

---

## Branch

- **Main branch:** `main`
- **Development branch:** `claude/awesome-gauss-Sflxt`

---

## Reusable สำหรับโปรเจคถัดไป (PM Checker)

| สิ่งที่มี | นำไปใช้ได้เลย |
|---------|-------------|
| Supabase Auth + Profiles + Roles | ✅ ใช้ระบบ Auth เดิม |
| Toast.jsx | ✅ Copy ไปใช้ |
| Telegram Bot notification | ✅ Copy Edge Function + ตั้ง Secrets ใหม่ |
| In-app notification bell | ✅ ใช้กับ notifications table เดิม |
| 4M Approval workflow | ✅ ดัดแปลงเป็น PM approval flow |
| SignatureModal.jsx | ✅ ลายเซ็นยืนยันงาน PM |
| CSV export | ✅ Report ประวัติ PM |
| Dark/Light theme | ✅ Copy index.css variables |
| Recharts | ✅ แสดงสถิติ PM |
