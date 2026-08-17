# ESM — คู่มือติดตั้งระบบสำหรับองค์กรใหม่ (Setup Guide)

> เอกสารนี้สำหรับบริษัท/ทีม IT ที่ต้องการนำระบบ ESM (Enterprise Shopfloor Management)
> ไปติดตั้งใช้งานเอง ใช้เวลาติดตั้งประมาณ **1–2 ชั่วโมง** ไม่ต้องเขียนโค้ดเพิ่ม

---

## ภาพรวมสถาปัตยกรรม

```
┌─────────────────┐     ┌──────────────────────────────┐
│  React Web App   │ ──→ │ Supabase โปรเจคหลัก           │
│  (Static Site)   │     │ Auth, พนักงาน, 4M, กะ, ทักษะ │
│                  │ ──→ │ Supabase โปรเจค DR            │
└─────────────────┘     │ กะผลิต, Order, Downtime, OEE  │
                         └──────────────────────────────┘
                                  │
                                  └──→ Telegram Bot (แจ้งเตือน 4M)
```

- **Frontend:** React 19 + Vite — build เป็น static site, deploy ที่ไหนก็ได้ (Render, Vercel, Netlify, nginx)
- **Backend:** Supabase 2 โปรเจค (หรือรวมเป็น 1 โปรเจคก็ได้ — ดูหมายเหตุข้อ 3.3)
- **ไม่มี server ของตัวเอง** — ทุกอย่างเป็น Supabase + static hosting

---

## ขั้นตอนที่ 1: เตรียม Supabase

### 1.1 สร้างโปรเจค

1. สมัคร/ล็อกอินที่ [supabase.com](https://supabase.com)
2. สร้างโปรเจคใหม่ **2 โปรเจค** (Region แนะนำ Singapore สำหรับไทย):
   - `esm-main` — ระบบหลัก (Auth, พนักงาน, 4M)
   - `esm-daily-report` — ระบบผลิตรายวัน (OEE, Kanban)
3. จดค่าของแต่ละโปรเจคจาก **Settings → API**:
   - `Project URL` เช่น `https://xxxx.supabase.co`
   - `anon public key`

### 1.2 รัน SQL Schema

เปิด **SQL Editor** ในแต่ละโปรเจค แล้วรันไฟล์ตามลำดับ:

| โปรเจค | ไฟล์ | สิ่งที่ได้ |
|--------|------|-----------|
| esm-main | `docs/sql/01_main_schema.sql` | ตารางทั้งหมด 19 ตาราง + RLS + Storage bucket |
| esm-daily-report | `docs/sql/02_dr_schema.sql` | ตาราง DR 10 ตาราง + RLS + Realtime |
| ทั้งสอง | `docs/sql/03_seed_data.sql` | ข้อมูลตั้งต้น (รันส่วน A ใน main, ส่วน B ใน DR) **แก้ค่าให้ตรงโรงงานก่อนรัน** |

### 1.3 สร้าง Admin คนแรก

1. ไปที่ **Authentication → Users → Add User** (โปรเจค main)
2. ใส่ email + password, ติ๊ก **Auto Confirm User**
3. รันใน SQL Editor:
   ```sql
   update profiles set role = 'admin', full_name = 'ชื่อผู้ดูแล'
   where email = 'admin@yourcompany.com';
   ```
4. หลังจากนี้ Admin สร้าง user คนอื่นได้เองผ่านหน้า **Add User** ในแอพ

### 1.4 ตรวจสอบ Realtime (โปรเจค DR)

ไปที่ **Database → Replication** ตรวจว่าตาราง `production_sessions`, `prod_orders`,
`downtime_logs`, `defect_logs` อยู่ใน publication `supabase_realtime`
(script `02_dr_schema.sql` เปิดให้แล้ว — ถ้า error ว่าซ้ำให้ข้ามได้)

---

## ขั้นตอนที่ 2: ตั้งค่าแจ้งเตือน Telegram (4M Workflow)

> ข้ามขั้นนี้ได้ถ้ายังไม่ต้องการแจ้งเตือน — ระบบทำงานได้ปกติ แค่ไม่มีข้อความเข้า Telegram

1. คุยกับ **@BotFather** ใน Telegram → `/newbot` → ได้ `BOT_TOKEN`
2. สร้าง Group แล้วเชิญบอทเข้า group
3. หา Chat ID: เปิด `https://api.telegram.org/bot<TOKEN>/getUpdates` หลังส่งข้อความใน group
   → `chat.id` จะเป็นเลขติดลบ เช่น `-5279077923`
4. Deploy Edge Function (ต้องติดตั้ง [Supabase CLI](https://supabase.com/docs/guides/cli)):
   ```bash
   supabase login
   supabase link --project-ref <main-project-ref>
   supabase functions deploy send-notification
   supabase secrets set TELEGRAM_BOT_TOKEN=<token>
   supabase secrets set TELEGRAM_CHAT_ID=<chat_id>
   ```

---

## ขั้นตอนที่ 3: ตั้งค่าและ Deploy Frontend

### 3.1 Environment Variables

สร้างไฟล์ `.env` (สำหรับ dev) หรือใส่ใน hosting dashboard (สำหรับ production):

```env
VITE_SUPABASE_URL=https://<main-project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key โปรเจค main>

VITE_SUPABASE_DR_URL=https://<dr-project>.supabase.co
VITE_SUPABASE_DR_KEY=<anon key โปรเจค DR>
```

> ⚠️ **สำคัญมาก:** ต้องตั้ง `VITE_SUPABASE_DR_URL` และ `VITE_SUPABASE_DR_KEY` เสมอ
> ห้ามปล่อยว่าง — ตรวจ `src/supabaseClient.js` ว่าไม่มี fallback URL/key
> ของโปรเจคเดิมค้างอยู่ ถ้ามีให้ลบออกหรือเปลี่ยนเป็นค่าของคุณ
> มิฉะนั้นข้อมูลผลิตจะถูกเขียนลงฐานข้อมูลของบริษัทอื่น!

### 3.2 Build & Deploy

```bash
npm install
npm run dev      # ทดสอบ local ที่ http://localhost:5173
npm run build    # ได้ ./dist สำหรับ deploy
```

**Render.com (แนะนำ — ฟรี):**
1. New → Static Site → เชื่อม Git repo
2. Build command: `npm run build` / Publish directory: `dist`
3. ใส่ Environment Variables ทั้ง 4 ตัวจากข้อ 3.1
4. เพิ่ม Rewrite Rule: `/*` → `/index.html` (สำหรับ React Router)

**Vercel / Netlify:** ทำเหมือนกัน (ทั้งคู่ auto-detect Vite ได้)

### 3.3 ทางเลือก: ใช้ Supabase โปรเจคเดียว

ถ้าไม่อยากดูแล 2 โปรเจค สามารถรัน `02_dr_schema.sql` ในโปรเจคเดียวกับ main ได้
แล้วตั้ง `VITE_SUPABASE_DR_URL` / `VITE_SUPABASE_DR_KEY` เป็นค่าเดียวกับ main
— โค้ดทำงานได้ทันทีโดยไม่ต้องแก้อะไร และแนะนำให้แก้ RLS policy ของตาราง DR
จาก `to anon, authenticated` เป็น `to authenticated` เพื่อความปลอดภัยที่ดีขึ้น

---

## ขั้นตอนที่ 4: ตั้งค่าข้อมูลพื้นฐานในแอพ (Master Data)

ล็อกอินด้วย Admin แล้วทำตามลำดับนี้ (**ลำดับสำคัญ** เพราะข้อมูลอ้างอิงกัน):

| ลำดับ | หน้า | ทำอะไร |
|------|------|--------|
| 1 | **Line Setup** | สร้างไลน์ผลิต + section + อัปโหลดรูปผังไลน์ + วางสถานีงาน + กำหนดทักษะที่ต้องการต่อสถานี + กำลังคนมาตรฐาน |
| 2 | **Add User** | สร้าง user ทุกคน (manager / supervisor / leader / qa) ระบุ section/line/team |
| 3 | **Register** | ลงทะเบียนพนักงานทุกคน พร้อมรูปถ่าย ทีม A/B/C และไลน์ |
| 4 | **Operator** | กรอกคะแนนทักษะตั้งต้นของพนักงานแต่ละคน (0–100) |
| 5 | **Shift Organize** | กำหนดตารางกะ A/B ของสัปดาห์แรก |
| 6 | **Daily Report → ตั้งค่า** | สร้างสินค้า/Model (พร้อม cycle time + เป้าต่อกะ), Kanban Standard (MAT.NO), เครื่องจักร, ประเภท Downtime, ประเภทงานเสีย, นโยบายหยุดพัก |

หลังจากนั้นระบบพร้อมใช้งานเต็มรูปแบบ — ดูวิธีใช้แต่ละหน้าใน `docs/WORK_INSTRUCTION.md`

---

## Checklist ก่อนเปิดใช้งานจริง

- [ ] รัน SQL schema ครบทั้ง 2 โปรเจค ไม่มี error
- [ ] สร้าง Admin และล็อกอินเข้าแอพได้
- [ ] ลบ/แก้ fallback key ใน `src/supabaseClient.js` แล้ว
- [ ] อัปโหลดรูปพนักงานได้ (ทดสอบ Storage bucket)
- [ ] เปิดกะทดสอบใน Daily Report → สแกนเปิด/ปิด Order → ปิดกะ → เห็น OEE
- [ ] Dashboard แสดงข้อมูล real-time เมื่อมีการเปลี่ยนแปลง
- [ ] (ถ้าใช้) Telegram แจ้งเตือนเมื่อสร้าง 4M log
- [ ] เปลี่ยน password ของ Admin ตั้งต้นแล้ว

---

## ปัญหาที่พบบ่อย (Troubleshooting)

| อาการ | สาเหตุ / วิธีแก้ |
|-------|----------------|
| ล็อกอินได้แต่หน้าขาว/ไม่มีสิทธิ์ | profile ยังไม่มี role — รัน update profiles ตามข้อ 1.3 |
| รูปอัปโหลดไม่ขึ้น | Storage bucket `employee-photos` ไม่มีหรือ policy ไม่เปิด — รันส่วนท้าย `01_main_schema.sql` ซ้ำ |
| Daily Report ไม่อัปเดต real-time | ตาราง DR ไม่อยู่ใน Realtime publication — ดูข้อ 1.4 |
| สแกน MAT.NO แล้วไม่ auto-fill | ยังไม่ได้สร้าง Kanban Standard ในหน้า ตั้งค่า |
| OEE เป็น 0 หรือเพี้ยน | สินค้าไม่ได้ใส่ `cycle_time_sec` หรือไม่ได้เลือกสินค้าตอนเปิดกะ |
| แจ้งเตือน Telegram ไม่มา | ตรวจ secrets ใน Supabase Dashboard → Edge Functions → Secrets |
| Refresh หน้าแล้ว 404 | Hosting ไม่มี rewrite rule `/*` → `/index.html` |
