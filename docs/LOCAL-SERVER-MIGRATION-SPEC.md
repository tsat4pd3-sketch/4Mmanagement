# ESM — ข้อกำหนดการเตรียม Server สำหรับติดตั้งภายในบริษัท (On-Premise)

> **เอกสารสำหรับ:** ฝ่าย IT (ผู้เตรียม server)
> **ระบบ:** ESM — Enterprise Shopfloor Management (เดิม 4M Management System)
> **สถานะปัจจุบัน:** ใช้งานจริงบน cloud (Render.com + Supabase) · ผู้ใช้ 87 บัญชี
> **วันที่จัดทำ:** 11 กันยายน 2026 · **ผู้จัดทำ:** ทีมพัฒนา ESM
> **ตัวเลขในเอกสารนี้วัดจากระบบที่ใช้งานจริง ณ วันที่จัดทำ ไม่ใช่ค่าประมาณ**

---

## 0. สรุปย่อสำหรับ IT (อ่าน 1 นาที)

| หัวข้อ | สาระ |
|---|---|
| ระบบคืออะไร | Web application เปิดผ่าน browser (ไม่ต้องติดตั้งที่เครื่อง client) ใช้กับ PC · มือถือ · แท็บเล็ต · จอ TV หน้าไลน์ |
| Stack | **Frontend:** React 19 build เป็นไฟล์ static (HTML/JS/CSS) · **Backend:** Supabase (PostgreSQL 17 + Auth + Storage + Realtime + Edge Functions) |
| **ไม่ต้องมี** | IIS · .NET · SQL Server · Oracle · SMTP/Mail server · Active Directory integration (ปัจจุบันยังไม่ใช้) |
| **ต้องมี** | Linux server 1 เครื่อง + Docker + reverse proxy (nginx) + TLS certificate ที่เครื่อง client เชื่อถือ |
| ขนาดข้อมูลจริงวันนี้ | ฐานข้อมูล **220 MB** (2 DB) · ไฟล์รูป **325 MB** (1,914 ไฟล์) · ผู้ใช้ **87** บัญชี |
| สเปกที่เสนอ | **8 vCore / 32 GB RAM / 500 GB SSD (RAID 1)** — รายละเอียด §3 |
| ข้อที่มักถูกมองข้าม | 1) ต้องเป็น **HTTPS จริง** ไม่ใช่ http (กล้องสแกน QR + แจ้งเตือนมือถือทำงานเฉพาะ secure context) · 2) ต้องเปิด **outbound HTTPS** ออกอินเทอร์เน็ต ไม่งั้นระบบแจ้งเตือน Telegram/มือถือตายทั้งหมด · 3) ต้องตั้ง **timezone = Asia/Bangkok + NTP** เพราะระบบตัดวันทำงานที่ 08:00 น. |

---

## 1. สถาปัตยกรรม — ปัจจุบัน vs. หลังย้ายมา on-premise

### ปัจจุบัน (cloud)

```
ผู้ใช้ (browser/มือถือ/จอ TV)
        │ HTTPS
        ├──────────────► Render.com  (static site — ไฟล์ React ที่ build แล้ว)
        │
        ├──────────────► Supabase Project "MAIN"  (ewhdfqwfwofivojtsizn.supabase.co)
        │                  Auth · พนักงาน · 4M · กะ · ทักษะ · สิทธิ์ · PM · NPI
        │
        └──────────────► Supabase Project "Product DB / DR"  (eyhclzkifitbhbljgoav.supabase.co)
                           กะผลิต · Order · Downtime · ของเสีย · OEE · Kanban · สโตร์
                                   │
                                   └──► Telegram Bot API (แจ้งเตือนเข้ากลุ่ม LINE-like)
                                   └──► Web Push (เด้งมือถือแม้ปิดแอป)
```

### หลังย้าย (on-premise) — ข้อเสนอ

```
                         ┌──────────────── SERVER ในบริษัท (Linux + Docker) ────────────────┐
ผู้ใช้ใน LAN/Wi-Fi        │                                                                  │
  │ HTTPS 443            │  ① nginx (reverse proxy + TLS + เสิร์ฟไฟล์ static ของ React)      │
  └─────────────────────►│        │                                                         │
                         │        ├──► ② Supabase Stack #1  "MAIN"   (Docker, port 8000)    │
                         │        │       Kong · GoTrue(Auth) · PostgREST · Realtime ·      │
                         │        │       Storage API · Edge Runtime(Deno) · Studio         │
                         │        │            └──► PostgreSQL 17  (DB: main)               │
                         │        │                                                         │
                         │        └──► ③ Supabase Stack #2  "DR"     (Docker, port 8001)    │
                         │                   ชุดเดียวกัน                                    │
                         │                        └──► PostgreSQL 17  (DB: dr)              │
                         │                                                                  │
                         │  ④ Backup job (pg_dump + rsync ไฟล์รูป) → NAS/tape               │
                         └──────────────────────────┬───────────────────────────────────────┘
                                                    │ outbound HTTPS 443 (ต้องเปิด)
                                                    ├──► api.telegram.org   (แจ้งเตือน)
                                                    └──► Push service ของ Google/Apple/Mozilla
```

---

## 2. องค์ประกอบซอฟต์แวร์ที่ต้องติดตั้งครบ (ไม่มีข้อไหนข้ามได้)

### 2.1 ชั้น OS และ runtime

| # | รายการ | เวอร์ชันที่ต้องการ | หมายเหตุ |
|---|---|---|---|
| 1 | OS | **Ubuntu Server 24.04 LTS** (หรือ 22.04 LTS) | รองรับถึงปี 2029/2032 · Debian 12 / RHEL 9 ใช้ได้แต่ทีมพัฒนาทดสอบบน Ubuntu |
| 2 | Docker Engine | **≥ 24.0** | ใช้รัน Supabase stack |
| 3 | Docker Compose | **v2** (`docker compose`) | ไฟล์ compose ของ Supabase เป็น v2 syntax |
| 4 | Node.js | **22 LTS** (ขั้นต่ำ 20.19) | ใช้ **เฉพาะตอน build** ไฟล์ React · ถ้าไม่อยาก build บน server ให้ build ที่เครื่อง dev แล้วคัดลอกโฟลเดอร์ `dist/` มาวางก็ได้ |
| 5 | nginx | ≥ 1.24 | reverse proxy + TLS + เสิร์ฟ static · **ต้องรองรับ WebSocket upgrade** |
| 6 | git | ใดๆ | ดึงซอร์สโค้ด |
| 7 | **Timezone / NTP** | `Asia/Bangkok` + sync NTP | **สำคัญมาก** — ระบบตัด "วันทำงาน" ที่ 08:00 น. และมี cron 16 งานอิงเวลา · เวลาเพี้ยน = ข้อมูลลงผิดวัน/ผิดกะ |
| 8 | Locale | `th_TH.UTF-8` + `en_US.UTF-8` | ข้อมูลเป็นภาษาไทยทั้งระบบ |

### 2.2 ชั้นฐานข้อมูล

| # | รายการ | เวอร์ชัน | หมายเหตุ |
|---|---|---|---|
| 9 | **PostgreSQL** | **17.x** (ปัจจุบันรัน 17.6) | ขั้นต่ำที่โค้ดใช้ได้คือ 15 แต่ให้ตรงกับ production เดิม = 17 |
| 10 | Extension `pg_cron` | ตามเวอร์ชัน PG | **จำเป็น** — มีงานตั้งเวลา 16 งาน (§8) ถ้าไม่มี = PM/Kanban/แจ้งเตือนอัตโนมัติไม่ทำงาน |
| 11 | Extension `pg_net` | ตามเวอร์ชัน PG | **จำเป็น** — ฐานข้อมูลยิง HTTP ไปเรียก Edge Function เอง (เช่น insert notification แล้วเด้ง push อัตโนมัติ) |
| 12 | Extension `pgcrypto`, `uuid-ossp` | มาพร้อม Supabase image | ใช้ gen UUID / hash |
| 13 | ตั้งค่า `wal_level = logical` | — | **จำเป็นสำหรับ Realtime** (หน้าจอ Daily Report / Andon / กระดิ่งแจ้งเตือน อัปเดตสดผ่าน WAL) |

> **จำนวนออบเจ็กต์จริงที่ต้องย้าย:** MAIN = 131 ตาราง / 1 view / 29 function · DR = 151 ตาราง / 6 view / 52 function
> รวม **282 ตาราง** · ประวัติ schema migration **380 ไฟล์** (`supabase/migrations/`)

### 2.3 ชั้น Supabase (container ที่ต้องรัน — ต่อ 1 stack)

Supabase แบบ self-hosted คือชุด container ดังนี้ (ใช้ `docker-compose.yml` ทางการจาก repo `supabase/supabase`):

| Container | หน้าที่ | จำเป็น? |
|---|---|---|
| `kong` | API Gateway — ประตูเดียวที่ client คุยด้วย (`/rest`, `/auth`, `/storage`, `/realtime`, `/functions`) | ✅ |
| `postgres` | ฐานข้อมูลหลัก | ✅ |
| `postgrest` | แปลงตาราง/view เป็น REST API — **หัวใจ** (ทุกหน้าจออ่าน-เขียนผ่านตัวนี้) | ✅ |
| `gotrue` (Auth) | ระบบ login / JWT / จัดการผู้ใช้ 87 บัญชี | ✅ |
| `realtime` | WebSocket ส่งข้อมูลสดจาก WAL | ✅ |
| `storage-api` | จัดการไฟล์รูป 13 bucket | ✅ |
| `edge-runtime` (Deno) | รัน Edge Function 21 ตัว (§7) | ✅ |
| `studio` + `meta` | หน้าเว็บจัดการ DB (เหมือน phpMyAdmin) | ⬜ แนะนำ (จำกัดให้เข้าได้เฉพาะ subnet IT) |
| `imgproxy` | ย่อ/แปลงรูปอัตโนมัติ | ⬜ **ไม่จำเป็น** — ระบบเราย่อรูปฝั่ง browser ก่อนอัปโหลดแล้ว (JPEG 480px ~100 KB) ไม่เคยเรียก image transform |
| `supavisor` / pgbouncer | connection pooler | ⬜ แนะนำถ้าผู้ใช้พร้อมกันเกิน ~100 |
| `vector` / `analytics` (Logflare) | เก็บ log รวม | ⬜ ตัดออกได้ ประหยัด RAM ~2 GB (ใช้ `docker logs` แทน) |

> **ต้องรัน 2 stack** (MAIN + DR) เพราะระบบออกแบบเป็น 2 ฐานข้อมูลแยกกัน โดยเจตนา —
> ฝั่ง DR ตั้ง RLS ให้อ่านได้แบบ `anon` (ไม่ต้อง login) หลายตาราง เพื่อให้จอแสดงผลหน้าไลน์ทำงานได้
> การแยก stack ทำให้ข้อมูล HR/Auth ไม่อยู่ในฐานเดียวกับฝั่งที่เปิดกว้าง
> **ทางเลือกประหยัด:** รวมเป็น stack เดียว 2 database ได้ (โค้ดรองรับ — ชี้ URL ทั้งสองตัวไปที่เดียวกัน) ประหยัด RAM ~8 GB แต่เสียการแยกขอบเขตความปลอดภัยข้อนี้ไป → **ทีมพัฒนาแนะนำ 2 stack**

---

## 3. สเปกฮาร์ดแวร์ที่เสนอ

### 3.1 ตารางสเปก

| รายการ | ขั้นต่ำ (ใช้ได้) | **แนะนำ (เสนอจัดซื้อ)** | เหตุผล |
|---|---|---|---|
| CPU | 4 vCore | **8 vCore** (Xeon/EPYC รุ่นปัจจุบัน) | 2 Supabase stack × ~8 container + Postgres 2 ตัว · งาน cron ทุก 5 นาที · การ export Excel/PDF ฝั่ง browser ไม่กิน CPU server |
| RAM | 16 GB | **32 GB** | Postgres ×2 (shared_buffers 4 GB/ตัว) + container อื่นรวม ~8 GB + OS/cache + หัวเหลือเผื่อ SCADA เฟสหน้า |
| Disk | 250 GB SSD | **500 GB NVMe/SSD — RAID 1** | ดูการแบ่งพื้นที่ข้อ 3.2 · **ต้องเป็น SSD** (Postgres + WAL เขียนบ่อย HDD จะหน่วง) |
| Network | 1 Gbps | **1 Gbps** (2 พอร์ต teaming ถ้ามี) | ผู้ใช้ในโรงงาน + จอ TV ดึงข้อมูลทุกนาที |
| สำรองไฟ | — | **UPS** ครอบ server + switch | Postgres ไฟดับกลางเขียน = ข้อมูลเสียหาย |
| Backup target | — | **NAS หรือพื้นที่แยกเครื่อง ≥ 1 TB** | §11 |

### 3.2 การแบ่งพื้นที่ดิสก์ (จาก 500 GB)

| พื้นที่ | ขนาด | ข้อมูลจริงวันนี้ | หมายเหตุ |
|---|---|---|---|
| OS + Docker images | 60 GB | ~15 GB | Supabase images รวม ~6 GB ต่อ stack |
| PostgreSQL data (2 DB) | 120 GB | **220 MB** | เผื่อโต 3 ปี + index + bloat · ตารางใหญ่สุดวันนี้: `audit_log` 19 MB, `line_stock_transactions` 8.6 MB, `prod_orders` 7.3 MB |
| WAL + archive | 50 GB | — | จำเป็นถ้าทำ point-in-time recovery |
| Storage (ไฟล์รูป/เอกสาร) | 120 GB | **325 MB** (1,914 ไฟล์) | รูป PM/จิ๊ก/พนักงาน/ลายเซ็น โตตามการใช้งานจริง ~20-30 MB/เดือน |
| Backup ในเครื่อง (7 วันล่าสุด) | 100 GB | — | ตัวจริงเก็บที่ NAS — นี่คือสำเนาเร็ว |
| เหลือว่าง (buffer) | 50 GB | — | ห้ามให้ดิสก์เต็ม — Postgres หยุดรับ write |

### 3.3 ⚠️ สิ่งที่จะทำให้ความต้องการพื้นที่เปลี่ยนมาก

ปัจจุบันข้อมูลมาจาก **คนกรอก** ทั้งหมด ถ้าเฟสถัดไปต่อ **SCADA / PLC เก็บข้อมูลเครื่องจักรอัตโนมัติ** (มีแบบแผนไว้แล้วใน `docs/SCADA_REALTIME_DESIGN.md`) จำนวนแถวจะโต **113 – 450 เท่า**
→ ถ้าผู้บริหารมีแผนทำ SCADA ภายใน 2 ปี ให้เผื่อ **disk 1 TB และ RAM 64 GB** ตั้งแต่ตอนจัดซื้อ จะถูกกว่าการอัปเกรดทีหลัง

---

## 4. Network · Firewall · DNS · TLS

### 4.1 Inbound (จาก LAN เข้ามา)

| Port | Protocol | เปิดให้ใคร | ใช้ทำอะไร |
|---|---|---|---|
| **443** | HTTPS + WebSocket | ทุกเครื่องใน LAN/Wi-Fi โรงงาน | ใช้งานระบบ (ทางเข้าเดียว) |
| 80 | HTTP | ทุกเครื่อง | redirect → 443 เท่านั้น |
| 22 | SSH | subnet IT เท่านั้น | ดูแลระบบ |
| 3000/3001 | HTTP (Supabase Studio) | **subnet IT เท่านั้น** | จัดการฐานข้อมูล — **ห้ามเปิดให้ผู้ใช้ทั่วไป** |

### 4.2 Internal (ภายในเครื่อง / bind 127.0.0.1 อย่างเดียว)

| Service | Port | หมายเหตุ |
|---|---|---|
| Kong (MAIN) | 8000 | nginx proxy ไปหา |
| Kong (DR) | 8001 | nginx proxy ไปหา |
| PostgreSQL MAIN / DR | 5432 / 5433 | **ห้าม expose ออก LAN** (ถ้าจะให้ IT ต่อ DBeaver ให้ผ่าน SSH tunnel) |

### 4.3 DNS + TLS — ข้อบังคับ (ไม่ใช่ข้อแนะนำ)

1. ตั้งชื่อ DNS ภายใน เช่น **`esm.thaisummit.local`** ชี้มาที่ IP ของ server (ผู้ใช้จะ bookmark ชื่อนี้ · ห้ามให้จำ IP)
2. **ต้องใช้ HTTPS ด้วย certificate ที่เครื่อง client เชื่อถือ** (ออกจาก internal CA ของบริษัท แล้ว push root CA ลงเครื่อง/มือถือผ่าน GPO/MDM · หรือใช้ public domain + Let's Encrypt)
   **เหตุผลที่ http:// ใช้ไม่ได้** — ฟีเจอร์เหล่านี้ browser อนุญาตเฉพาะ "secure context":
   - 📷 **กล้องสแกน QR / บาร์โค้ด** (หน้าเปิด-ปิดใบผลิต, เลือกเครื่องจักร, ใบเบิกสโตร์) — `getUserMedia` ถูกบล็อกบน http
   - 🔔 **แจ้งเตือนเด้งมือถือ (Web Push)** — ต้องมี Service Worker ซึ่งทำงานเฉพาะ HTTPS
   - 📱 **เพิ่มลงหน้าจอโฮม (PWA)** — ต้อง HTTPS
   - ✍️ ลายเซ็นบนจอ / อัปโหลดรูปจากกล้องมือถือ
3. Certificate อายุ ≥ 1 ปี + มีผู้รับผิดชอบต่ออายุ (ใส่ในปฏิทิน IT) — cert หมดอายุ = ทั้งโรงงานเข้าระบบไม่ได้
4. nginx ต้องตั้ง **WebSocket upgrade** (`proxy_set_header Upgrade $http_upgrade; Connection "upgrade";`) ไม่งั้นหน้าจอที่อัปเดตสด (Daily Report, Andon ซ่อมบำรุง, กระดิ่งแจ้งเตือน) จะนิ่งสนิท
5. nginx ต้องตั้ง header cache ตามนี้ (กันผู้ใช้ค้างเวอร์ชันเก่าหลัง deploy — มีกลไก version guard ในแอป):
   - `/assets/*` → `Cache-Control: public, max-age=31536000, immutable`
   - `/mediapipe/*` → `Cache-Control: public, max-age=2592000`
   - ที่เหลือ (`/*`, `index.html`, `version.json`) → `Cache-Control: no-cache`
6. ต้องตั้ง **SPA fallback**: ทุก path ที่ไม่ใช่ไฟล์จริง → ส่ง `/index.html` (`try_files $uri /index.html;`) มี 74 route ในแอป ถ้าไม่ตั้งจะ 404 เมื่อ refresh หน้า
7. **Client max body size** ≥ 10 MB (อัปโหลดรูป/ไฟล์แนบ NPI)

### 4.4 Wi-Fi / ความครอบคลุมหน้างาน

ระบบถูกใช้จาก **มือถือหัวหน้ากลุ่มที่หน้าไลน์** และ **จอ TV ติดผนัง** → ถ้าจุดไหน Wi-Fi ไม่ถึง ฟีเจอร์เช็คชื่อ/เปิดปิดใบผลิต/แจ้งซ่อม จะใช้ไม่ได้ตรงนั้น ควรสำรวจจุดอับสัญญาณพร้อมกับการย้าย server

---

## 5. ⚠️ Outbound Internet ที่จำเป็น — และถ้าบล็อก อะไรจะตาย

ระบบออกแบบให้ทำงานใน LAN ได้ **แต่ระบบแจ้งเตือนต้องออกอินเทอร์เน็ต** ถ้าไฟร์วอลล์ปิดหมด ฟีเจอร์ต่อไปนี้จะเงียบทั้งหมดโดยไม่มีข้อความ error ให้ผู้ใช้เห็น:

| ปลายทาง | Port | ใช้ทำอะไร | ถ้าบล็อก |
|---|---|---|---|
| **`api.telegram.org`** | 443 | แจ้งเตือนเข้ากลุ่ม Telegram — 4M อนุมัติ, เช็คชื่อเสร็จ, downtime เกิน 15 นาที, เรียกช่างซ่อม, สรุป PM รายวัน, จองรถ OT, ปิดใบผลิต, แจ้งเตือนสโตร์ | **หัวหน้าทุกระดับไม่ได้รับแจ้งเตือนอีกเลย** (ฟีเจอร์ที่ใช้หนักที่สุดอย่างหนึ่ง) |
| `fcm.googleapis.com` (Android/Chrome) · `*.push.apple.com` (iOS) · `*.notify.windows.com` · `updates.push.services.mozilla.com` | 443 | Web Push — เด้งมือถือแม้ปิดแอป | แจ้งเตือนมือถือไม่เด้ง (กระดิ่งในแอปยังทำงาน) |
| `fonts.googleapis.com` · `fonts.gstatic.com` | 443 | ฟอนต์ Sarabun (ไทย) | **ตัวหนังสือเปลี่ยนเป็นฟอนต์สำรองของเครื่อง** หน้าตาเพี้ยน → **ทีมพัฒนาจะแก้เป็นฟอนต์ในเครื่อง (self-host) ก่อนย้าย** ดู §13 |
| `api.anthropic.com` | 443 | ผู้ช่วย AI รับแจ้งปัญหาผ่าน Telegram (ฟีเจอร์เสริม) | ฟีเจอร์นี้ไม่ทำงาน · ส่วนอื่นไม่กระทบ |
| Docker Hub / `ghcr.io` / `registry.npmjs.org` | 443 | ดึง image + ติดตั้ง/อัปเดตระบบ | ติดตั้งและอัปเดตไม่ได้ (ต้องเปิดช่วงติดตั้ง หรือเตรียม private registry/offline mirror) |

**ถ้าบริษัทมีนโยบายห้ามออกเน็ต** → ขอเป็น **whitelist 5 โดเมนข้างบน เฉพาะ port 443 จาก IP ของ server ตัวนี้เท่านั้น** (ไม่ต้องเปิดให้ client)

### Inbound จากอินเทอร์เน็ต (ตัวเลือก — ต้องตัดสินใจ)

มีฟีเจอร์ **"แจ้งปัญหาผ่าน Telegram Bot แล้วระบบบันทึกเข้าระบบให้"** ซึ่งต้องให้ Telegram ยิง webhook **เข้ามา** ที่ server
- ถ้า IT **ไม่อนุญาต** ให้เปิดจากภายนอก → ฟีเจอร์นี้ใช้ไม่ได้ (ฟีเจอร์เดียว) การแจ้งเตือน "ออก" ยังทำงานปกติ
- ถ้าอนุญาต → ต้องมี public DNS + cert ที่ Telegram เชื่อถือ + เปิดเฉพาะ path `/functions/v1/telegram-webhook` ผ่าน WAF/reverse proxy

---

## 6. ไฟล์รูป / เอกสารแนบ (Storage)

| ข้อมูล | ค่าจริงวันนี้ |
|---|---|
| จำนวน bucket | **13** |
| จำนวนไฟล์ | 1,914 ไฟล์ |
| ขนาดรวม | **325 MB** (MAIN 173 MB / DR 152 MB) |

**Bucket ฝั่ง MAIN (9):** `avatars`, `employee-photos`, `four-m-images`, `npi-files`, `part-images`, `pe-images`, `qa-drawings`, `signatures` (public) · `pm-images` (private)
**Bucket ฝั่ง DR (4):** `improvement-images`, `jig-images`, `mtn-images`, `product-images` (public)

ข้อกำหนดสำหรับ IT:
1. ทุกไฟล์ถูกย่อฝั่ง browser ก่อนอัปโหลดแล้ว (JPEG 480px ~100 KB) — **ไม่ต้องติดตั้ง imgproxy / image transform**
2. ต้องตั้ง `Cache-Control` ยาว (1 ปี) ที่ Storage/nginx — **บทเรียนจริง:** ตอนอยู่ cloud เคยลืมตั้ง ทำให้รูปถูกโหลดใหม่ทุกชั่วโมงจน traffic ทะลุโควตา และ **ทั้งโรงงาน login ไม่ได้** อยู่ช่วงหนึ่ง
3. พื้นที่ไฟล์ต้องอยู่บน volume ที่ **รวมอยู่ในแผน backup** (ไฟล์รูป PM/จิ๊ก/ลายเซ็น เป็นหลักฐานทางคุณภาพ IATF — หายแล้วสร้างใหม่ไม่ได้)

---

## 7. Edge Functions — 21 ตัว (ต้องรัน Deno runtime)

เป็นโค้ดฝั่ง server ขนาดเล็ก (TypeScript/Deno) มาพร้อม repo ครบทุกตัว — **ต้อง deploy ทั้ง 21 ตัว** ไม่งั้นฟีเจอร์ที่เกี่ยวจะเงียบ

| กลุ่ม | ฟังก์ชัน | ทำอะไร |
|---|---|---|
| แจ้งเตือน | `send-notification`, `send-cqi15-notification`, `send-mtn-notification`, `send-store-notification`, `send-event-notification`, `send-push`, `telegram-webhook` | ส่ง Telegram / Web Push / รับ webhook |
| จัดการผู้ใช้ | `create-user`, `delete-user`, `reset-user-password` | admin สร้าง/ลบ/รีเซ็ตรหัสผู้ใช้ (ต้องใช้ service_role key ห้ามทำจาก browser) |
| งานตั้งเวลา | `pm-daily-scan`, `pm-plan-reminder`, `daily-4m-summary`, `mtn-daily-summary`, `downtime-open-scan`, `shipping-phase-scan`, `qa-fme-scan`, `kanban-round-scan`, `store-daily-scan` | สแกนหาสิ่งที่ต้องเตือน/สรุปรายวัน |
| อื่นๆ | `cleanup-orphan-photos`, `ingest-energy` | ลบรูปกำพร้า · รับค่ามิเตอร์ไฟจาก MQTT bridge (ยังไม่เปิดใช้) |

### Secret / Environment variable ที่ IT ต้องตั้งให้ (ฝั่ง Edge Function)

| ชื่อ | ค่า | ใคร |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | URL + service key ของ stack ตัวเอง | IT (ได้จากตอน gen key) |
| `DR_URL`, `DR_ANON_KEY` | ของ stack DR (ฟังก์ชันฝั่ง MAIN ต้องอ่านข้อมูลผลิต) | IT |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | token bot + id กลุ่ม | ทีมพัฒนา (มีอยู่แล้ว — ย้ายมาใช้ตัวเดิมได้) |
| `TELEGRAM_WEBHOOK_SECRET`, `CRON_SECRET`, `INGEST_SECRET`, `CLEANUP_TOKEN` | shared secret กันเรียกมั่ว | **สร้างใหม่** ตอนติดตั้ง |
| `ANTHROPIC_API_KEY` | API key ผู้ช่วย AI (ฟีเจอร์เสริม) | ทีมพัฒนา |
| VAPID keys (public/private) | กุญแจ Web Push — เก็บในตาราง `notification_settings` | **สร้างใหม่** ตอนติดตั้ง (ของเดิมผูกกับโดเมนเก่า) |

> 🔐 **`service_role key` = กุญแจผ่าน RLS ได้ทุกตาราง** — ต้องอยู่แค่ฝั่ง server/Edge Function เท่านั้น **ห้ามใส่ในไฟล์ที่ build ไปฝั่ง browser**

---

## 8. งานตั้งเวลา (Scheduled Jobs) — 16 งาน ต้องใช้ `pg_cron`

เวลาทั้งหมดในตารางนี้คือ **UTC** (ตามที่ตั้งไว้ใน production ปัจจุบัน — เวลาไทย = +7)

### ฝั่ง MAIN (7 งาน)

| ชื่องาน | ตาราง cron | เวลาไทย | ทำอะไร |
|---|---|---|---|
| `daily-4m-summary` | `0 1 * * *` | 08:00 | สรุป 4M ค้างอนุมัติเข้า Telegram |
| `daily-skill-farm` | `20 1 * * *` | 08:20 | สะสม EXP ทักษะพนักงานจากงานที่ทำจริง |
| `weekly-skill-update` | `5 1 * * 1` | จ. 08:05 | อัปเดตระดับทักษะรายสัปดาห์ |
| `mtn-daily-summary` | `0 2 * * *` | 09:00 | สรุปใบแจ้งซ่อมค้าง |
| `qa-fme-scan` | `*/5 * * * *` | ทุก 5 นาที | เฝ้าระวังคุณภาพ/FME |
| `shift-schedule-gap-scan` | `30 0 * * *` | 07:30 | เตือนว่ายังไม่ได้ตั้งตารางกะ |
| `purge-audit-log` | `30 17 * * *` | 00:30 | ล้าง audit log เกินอายุเก็บ |

### ฝั่ง DR (9 งาน)

| ชื่องาน | ตาราง cron | เวลาไทย | ทำอะไร |
|---|---|---|---|
| `downtime-open-scan` | `*/5 * * * *` | ทุก 5 นาที | เครื่องหยุดเปิดค้างเกินเกณฑ์ → เตือน |
| `pm-daily-scan` | `*/10 * * * *` | ทุก 10 นาที | สแกนงาน PM ถึงกำหนด |
| `shipping-phase-scan` | `*/10 * * * *` | ทุก 10 นาที | เฟสการจัดส่งลูกค้า |
| `kanban-round-scan` | `*/10 * * * *` | ทุก 10 นาที | รอบส่งคัมบัง |
| `pm-plan-reminder` | `0 1 * * *` | 08:00 | เตือนแผน PM |
| `pm-refresh-plans` | `5 1 * * *` | 08:05 | คำนวณแผน PM ใหม่ |
| `store-daily-scan` | `50 0 * * *` | 07:50 | สรุปงานสโตร์ |
| `purge-audit-log` | `30 17 * * *` | 00:30 | ล้าง audit log |
| `purge-cron-logs` | `0 18 * * *` | 01:00 | ล้าง log ของ cron เอง |

> งาน cron เหล่านี้เรียก Edge Function ผ่าน `pg_net` ⇒ **Postgres ต้อง resolve และเรียก URL ของ Kong ในเครื่องเดียวกันได้** (ถ้า nginx/Kong ใช้ชื่อ DNS ภายใน ต้องให้ container postgres รู้จักชื่อนั้นด้วย — มักพลาดข้อนี้ตอนติดตั้งใหม่)

---

## 9. Realtime (ข้อมูลสดผ่าน WebSocket)

| ข้อมูล | ค่า |
|---|---|
| ตารางที่เปิด Realtime | MAIN: `role_permissions` (1) · DR: `production_sessions`, `prod_orders`, `downtime_logs`, `defect_logs`, `mtn_orders`, `kanban_scans`, `kanban_standards`, `kanban_targets` (8) |
| กลไก | PostgreSQL logical replication → container `realtime` → WebSocket ไปที่ browser |
| ต้องตั้ง | `wal_level = logical` · publication ชื่อ `supabase_realtime` · nginx ส่งผ่าน WebSocket ได้ |
| ใช้ที่หน้าไหน | Daily Report (เห็นกะ/ใบผลิต/downtime สดๆ) · Andon ซ่อมบำรุง · เสียงเตือน downtime · กระดิ่งแจ้งเตือน · Rack Center · VSM · Daily PM |
| นอกจากนี้ | ฟีเจอร์ **Remote Control** (มือถือคุมจอ TV) ใช้ Realtime broadcast — ไม่ต้องตั้งค่าอะไรเพิ่ม แต่ต้องมี WebSocket |

---

## 10. ระบบผู้ใช้ / Authentication

| ข้อมูล | ค่าจริง |
|---|---|
| จำนวนบัญชี | **87** |
| วิธี login | อีเมล + รหัสผ่าน (เก็บใน GoTrue/Auth ของ Supabase) |
| บทบาท (role) | กำหนดสิทธิ์รายหน้า/รายปุ่มจากตาราง `role_permissions` (แก้จากหน้าเว็บได้ ไม่ต้องแก้โค้ด) |
| **ไม่ใช้อีเมลส่งออก** | ระบบ **ไม่เคยส่งอีเมลเลย** → **ไม่ต้องตั้ง SMTP** · การรีเซ็ตรหัสผ่านทำโดย admin กดปุ่มในแอป (ผ่าน Edge Function) · ต้อง **ปิด** "confirm email" ใน GoTrue ตอนติดตั้ง ไม่งั้นสร้างผู้ใช้ใหม่แล้ว login ไม่ได้ |
| Active Directory / SSO | **ยังไม่มี** — ถ้า IT ต้องการให้ login ด้วยบัญชี AD ของบริษัท ทำได้ (Supabase รองรับ SAML/LDAP ผ่าน external provider) แต่เป็นงานพัฒนาเพิ่ม ต้องประเมินแยก **ไม่รวมในการย้ายครั้งนี้** |
| JWT | ต้อง gen `JWT_SECRET` + `ANON_KEY` + `SERVICE_ROLE_KEY` ใหม่ต่อ stack (ใช้ของเดิมไม่ได้) |

### 🔴 ข้อที่ IT ควรรู้ตรงๆ (known gap)

ฝั่งฐานข้อมูล DR ถูกออกแบบให้ client เชื่อมต่อแบบ **`anon` (ไม่ผ่าน login)** หลายตาราง เพื่อให้จอแสดงผล/ระบบผลิตทำงานได้โดยไม่ต้องล็อกอิน
- **ข้อดีของการย้ายมา on-prem:** ข้อมูลกลุ่มนี้จะอยู่ใน LAN ไม่ถูกเปิดออกอินเทอร์เน็ตอีก → **ความเสี่ยงลดลงอย่างมีนัยสำคัญ** (นี่คือเหตุผลทางความปลอดภัยที่สนับสนุนการย้าย)
- **ข้อที่ต้องระวัง:** **ห้ามเปิด port 443 ของระบบนี้ออกอินเทอร์เน็ตโดยไม่มี VPN/WAF** ถ้าต้องการให้เข้าจากนอกโรงงาน ขอให้ทำผ่าน **VPN ของบริษัท** เท่านั้น
- **ห้ามแก้ RLS policy ของฝั่ง DR ให้เป็น `authenticated` เพื่อ "ให้ปลอดภัยขึ้น"** — เคยทำแล้วพังทั้งระบบ (Product Master, Machine List, PM, เปิดกะ หายหมด ต้อง revert ฉุกเฉิน) เพราะ client ฝั่งนั้นไม่มี JWT ให้ตรวจ · ถ้าจะปิดช่องนี้จริงต้องแก้ที่โค้ด ไม่ใช่ที่ policy

---

## 11. Backup & Disaster Recovery

> **สำคัญ:** ตอนอยู่ Supabase cloud มี backup อัตโนมัติ + point-in-time recovery ให้ฟรี **ย้ายมา on-prem แล้วหน้าที่นี้เป็นของ IT ทั้งหมด** ข้อนี้คือความเสี่ยงที่เพิ่มขึ้นชัดที่สุดจากการย้าย จึงขอให้วางแผน backup พร้อมกับการติดตั้ง ไม่ใช่ทำทีหลัง

| รายการที่ต้อง backup | วิธี | ความถี่ที่เสนอ | เก็บไว้ |
|---|---|---|---|
| PostgreSQL MAIN + DR | `pg_dump -Fc` ต่อ DB | **ทุกวัน** (ตี 2) | 30 วัน + สิ้นเดือนเก็บ 12 เดือน |
| WAL archive | `archive_command` → NAS | ต่อเนื่อง | 7 วัน (ทำ point-in-time recovery ได้) |
| ไฟล์ Storage (325 MB ขึ้นไป) | `rsync` volume | ทุกวัน | 30 วัน |
| Config + docker-compose + .env + secrets | เก็บใน git ภายใน + password manager ของ IT | ทุกครั้งที่แก้ | ตลอด |
| Edge Function source | อยู่ใน git repo ของโปรเจคแล้ว | — | — |

**เป้าหมายที่เสนอ:** RPO ≤ 24 ชม. (ถ้าทำ WAL archive ได้ → ≤ 15 นาที) · RTO ≤ 4 ชม.
**ต้องทำ:** ทดสอบ **restore จริง** 1 ครั้งก่อน go-live และทุกไตรมาส — backup ที่ไม่เคย restore ไม่นับว่ามี backup

---

## 12. Monitoring & การดูแลต่อเนื่อง

| หัวข้อ | สิ่งที่ต้องมี |
|---|---|
| Disk | **alert เมื่อใช้เกิน 80%** — Postgres หยุดรับ write เมื่อดิสก์เต็ม = ทั้งโรงงานบันทึกข้อมูลไม่ได้ |
| Container health | ให้ทุก container `restart: unless-stopped` + alert เมื่อ container ตาย |
| Postgres | ตรวจ connection count, long-running query, autovacuum, ขนาด `audit_log` (มี cron ล้างให้แล้ว) |
| Backup | alert เมื่อ backup job ล้มเหลว |
| Cert | เตือนก่อนหมดอายุ 30 วัน |
| Log | เก็บ log nginx + Postgres ≥ 90 วัน (ใช้สอบกลับเวลามีปัญหาข้อมูล) |
| OS patch | มีรอบ patch + หน้าต่างหยุดระบบที่ตกลงกับฝ่ายผลิต (แนะนำวันอาทิตย์) |
| ผู้ดูแล | **ระบุชื่อผู้รับผิดชอบ + ตัวสำรอง** — ระบบนี้ฝ่ายผลิตใช้ทุกกะ ทุกวัน |

---

## 13. งานที่ฝั่งทีมพัฒนาต้องทำก่อนย้าย (ไม่ใช่หน้าที่ IT — แจ้งให้ทราบว่ามีและอยู่ในแผน)

| # | งาน | รายละเอียด | สถานะ |
|---|---|---|---|
| 1 | ถอด URL ที่ฝังไว้ในโค้ด | มี **8 จุด** ใน 6 ไฟล์ที่เขียน URL ของ Supabase cloud ตรงๆ (`src/utils/notifyEvent.js`, `src/pages/DailyReport.jsx` ×3, `PMSchedule.jsx`, `PMCheckData.jsx`, `MtnRepair.jsx`, `Checkin.jsx`) + ค่า fallback ใน `src/supabaseClient.js` → ต้องเปลี่ยนเป็นอ่านจาก environment variable ทั้งหมด **ถ้าไม่แก้ ระบบจะยังยิงแจ้งเตือนออกไปที่ cloud เดิม** | ⬜ ต้องทำ |
| 2 | ย้ายฟอนต์มาไว้ในเครื่อง | ตอนนี้โหลด Sarabun/Inter จาก Google Fonts — ถ้า LAN ไม่ออกเน็ต ตัวหนังสือจะเพี้ยน | ⬜ ต้องทำ |
| 3 | สร้าง VAPID keys + secrets ชุดใหม่ | ของเดิมผูกกับโดเมนเก่า | ⬜ ทำตอนติดตั้ง |
| 4 | ตั้ง `.env` ของ build ให้ชี้ URL ใหม่ แล้ว build ใหม่ | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SUPABASE_DR_URL`, `VITE_SUPABASE_DR_KEY` | ⬜ ทำตอนติดตั้ง |
| 5 | ตรวจ migration 380 ไฟล์ให้รันผ่านเรียงลำดับบน DB เปล่า | บาง migration เคย apply มือผ่าน dashboard | ⬜ ต้องทำ + ทดสอบ |
| 6 | ตั้ง Telegram bot webhook ใหม่ (ถ้าเปิดใช้) | ชี้มาที่ URL ใหม่ | ⬜ ทำตอนติดตั้ง |

---

## 14. แผนการย้าย (Cutover) — ที่เสนอ

| ขั้น | งาน | ผู้รับผิดชอบ | เวลาที่ใช้ |
|---|---|---|---|
| 1 | จัดหา server + ติดตั้ง OS/Docker/nginx + DNS + cert | IT | ตามรอบจัดซื้อ |
| 2 | ติดตั้ง Supabase 2 stack + เปิด extension + ตั้ง firewall | IT + ทีมพัฒนา | 1 วัน |
| 3 | รัน schema 380 migration ลง DB เปล่า + ตรวจจำนวนตาราง/ฟังก์ชันให้ตรง (282 ตาราง) | ทีมพัฒนา | 1 วัน |
| 4 | ย้ายข้อมูลชุดทดสอบ (dump จาก cloud → restore) + ย้ายไฟล์ 1,914 ไฟล์ | ทีมพัฒนา | 0.5 วัน |
| 5 | ย้ายผู้ใช้ 87 บัญชี (ตาราง `auth.users` — รหัสผ่านเดิมใช้ต่อได้ถ้า JWT secret/hash ย้ายถูกวิธี) | ทีมพัฒนา | 0.5 วัน |
| 6 | Deploy Edge Function 21 ตัว + ตั้ง secret + ตั้ง cron 16 งาน | ทีมพัฒนา | 0.5 วัน |
| 7 | **UAT** — ทดสอบครบทุกฟีเจอร์: login ทุก role · เปิด/ปิดใบผลิต · สแกน QR · อัปโหลดรูป · แจ้งเตือน Telegram · push มือถือ · Realtime · export Excel/PDF · จอ TV | ฝ่ายผลิต + ทีมพัฒนา | 3–5 วัน |
| 8 | **Freeze + Final data sync + Cutover** (แนะนำคืนวันอาทิตย์ ช่วงที่ไม่มีกะ) | ทั้งสองฝ่าย | **หยุดระบบ 2–4 ชม.** |
| 9 | เฝ้าระวัง 2 สัปดาห์ โดย**ยังไม่ปิด cloud เดิม** (เป็น rollback) | ทั้งสองฝ่าย | 2 สัปดาห์ |
| 10 | ปิด/ลดขนาด cloud เดิม | IT | — |

> **Rollback:** ระหว่าง 2 สัปดาห์แรก ถ้า on-prem มีปัญหาใหญ่ ให้ชี้ DNS/URL กลับไปที่ cloud เดิมได้ทันที (ข้อมูลที่กรอกใน on-prem ช่วงนั้นต้อง sync กลับ — จึงควรเลือกช่วง cutover ให้สั้นและชัด)

---

## 15. ⚠️ ความเสี่ยง / ข้อแลกเปลี่ยนที่ต้องรับรู้ก่อนตัดสินใจ

| ประเด็น | ตอนอยู่ cloud | หลังย้ายมา on-prem |
|---|---|---|
| Backup & PITR | อัตโนมัติ มีอยู่แล้ว | **IT ต้องทำเอง + ทดสอบ restore เอง** |
| Uptime / HA | ผู้ให้บริการดูแล | **มี server ตัวเดียว = single point of failure** · ถ้าต้องการ HA ต้องเพิ่ม server + replication (เสนอเป็นเฟส 2) |
| ไฟดับ / UPS | ไม่เกี่ยว | **ต้องมี UPS** ไม่งั้นฐานข้อมูลเสียหาย |
| อัปเดตเวอร์ชัน Supabase | อัตโนมัติ | **IT ต้องวางแผน upgrade เอง** (image version + migration) |
| ความปลอดภัยข้อมูล | ข้อมูลโรงงานอยู่นอกบริษัท | ✅ **ข้อมูลอยู่ในบริษัท** (ข้อดีหลักของการย้าย) |
| ความเร็วใช้งานหน้างาน | ผ่านอินเทอร์เน็ต | ✅ **เร็วขึ้น** (อยู่ใน LAN) และไม่ล่มตามอินเทอร์เน็ตบริษัท |
| ค่าใช้จ่าย | ค่าบริการรายเดือน | ค่าฮาร์ดแวร์ครั้งเดียว + **ค่าคนดูแล** (อย่าลืมข้อนี้) |
| ทำงานตอนเน็ตบริษัทล่ม | ใช้ไม่ได้ทั้งระบบ | ✅ ใช้งานได้ปกติ (แจ้งเตือน Telegram/push หยุดชั่วคราวเท่านั้น) |

---

## 16. สิ่งที่ขอให้ IT ยืนยัน/ตอบกลับ (Checklist)

| # | คำถาม | คำตอบ |
|---|---|---|
| 1 | สเปก server ที่จัดให้ได้จริง (CPU / RAM / Disk / RAID) | ............ |
| 2 | OS ที่บริษัทรองรับ (Ubuntu 24.04 LTS ได้หรือไม่) | ............ |
| 3 | อนุญาตใช้ **Docker** บน server ของบริษัทหรือไม่ | ............ |
| 4 | ชื่อ DNS ภายในที่จะตั้งให้ (เช่น `esm.thaisummit.local`) | ............ |
| 5 | TLS certificate — ออกจาก internal CA ของบริษัท หรือให้เราใช้ public domain | ............ |
| 6 | อนุมัติ **outbound HTTPS whitelist 5 โดเมน** ตาม §5 ได้หรือไม่ | ............ |
| 7 | ต้องการเปิดใช้งานจากนอกโรงงานไหม (ถ้าใช่ → ผ่าน VPN เท่านั้น) | ............ |
| 8 | แผน backup — ปลายทางที่ไหน (NAS/tape) · ความถี่ · ผู้รับผิดชอบ | ............ |
| 9 | ผู้ดูแลระบบหลัก + ตัวสำรอง (ชื่อ) | ............ |
| 10 | ต้องการ login ด้วยบัญชี AD ของบริษัทหรือไม่ (เป็นงานพัฒนาเพิ่ม) | ............ |
| 11 | หน้าต่างเวลาที่อนุญาตให้หยุดระบบเพื่อ cutover (2–4 ชม.) | ............ |
| 12 | มีแผนทำ SCADA/เก็บข้อมูลเครื่องจักรอัตโนมัติใน 2 ปีไหม (มีผลต่อสเปกที่ต้องซื้อ) | ............ |

---

## ภาคผนวก A — ตัวเลขระบบ ณ 11 ก.ย. 2026 (วัดจากระบบจริง)

| รายการ | MAIN | DR | รวม |
|---|---|---|---|
| PostgreSQL | 17.6 | 17.6 | — |
| ขนาดฐานข้อมูล | 114 MB | 106 MB | **220 MB** |
| ตาราง | 131 | 151 | **282** |
| View | 1 | 6 | 7 |
| Function (stored procedure) | 29 | 52 | 81 |
| Storage bucket | 9 | 4 | **13** |
| ไฟล์ใน Storage | 366 (173 MB) | 1,548 (152 MB) | **1,914 (325 MB)** |
| ผู้ใช้ (auth) | 87 | — | **87** |
| ตารางที่เปิด Realtime | 1 | 8 | 9 |
| งาน cron | 7 | 9 | **16** |
| Edge Function | รวมทั้งสองฝั่ง | | **21** |
| Schema migration | | | **380 ไฟล์** |
| หน้าจอในแอป | | | **70 หน้า / 74 route** |
| ขนาดซอร์สโค้ด | | | 60 MB (รวมโมเดล gesture 19 MB) |
| **ไฟล์ static ที่ต้องวางบน nginx (หลัง build)** | | | **31 MB** (215 ไฟล์ JS — โหลดแบบแยกหน้า) |

## ภาคผนวก B — เบราว์เซอร์ฝั่งผู้ใช้ที่ระบบรองรับ

| อุปกรณ์ | ข้อกำหนด |
|---|---|
| PC | Chrome / Edge เวอร์ชันปัจจุบัน |
| มือถือ/แท็บเล็ต | Chrome (Android) · Safari (iOS 15+) |
| **จอ TV หน้าไลน์** | **LG webOS 23 ขึ้นไป** (= Chromium 94 ขึ้นไป) — รุ่นที่โรงงานใช้คือ LG 43UR751C0SC · **webOS 22 หรือเก่ากว่า หน้าที่มีกราฟจะแสดงผลไม่ได้** ถ้า IT จะจัดซื้อจอเพิ่ม ขอให้เลือก webOS 23+ |

## ภาคผนวก C — เอกสารอ้างอิงในโปรเจค (ให้ IT ขอได้)

| ไฟล์ | เนื้อหา |
|---|---|
| `docs/SETUP_GUIDE.md` | คู่มือติดตั้งระบบทีละขั้น (เดิมเขียนสำหรับ Supabase cloud — ใช้เป็นฐานได้) |
| `docs/sql/` | Schema snapshot + seed data |
| `docs/modules/edge-functions.md` | รายละเอียด Edge Function ทุกตัว + payload |
| `docs/modules/deploy.md` | ขั้นตอน deploy + กับดัก cache/version |
| `docs/SCADA_REALTIME_DESIGN.md` | แผนต่อ SCADA (มีผลต่อการเผื่อสเปก) |
| `docs/ICS-SAP-INTEGRATION.md` | ผลการศึกษาการต่อกับ ICS/SAP ของกลุ่ม TSG |

---

*เอกสารนี้จัดทำจากการตรวจสอบระบบที่ใช้งานจริง (source code + ฐานข้อมูล production) เมื่อ 11 ก.ย. 2026 · หากมีคำถามทางเทคนิคเพิ่มเติม ติดต่อทีมพัฒนา ESM*
