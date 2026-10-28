# Deploy

> ย้ายมาจาก `CLAUDE.md` (2026-09-03 — แยกไฟล์เพื่อลด context) · โหลด**เฉพาะเมื่อแตะโมดูลนี้** · แก้ไฟล์นี้แทน CLAUDE.md เมื่อกฎของโมดูลเปลี่ยน


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

### 💸 Build pipeline minutes — build ล่มเพราะโควต้าหมด (2026-10-13)

Render นับ **นาที build ต่อเดือน** (ไม่เกี่ยวกับจำนวนคนเข้าเว็บ) · เพดานค่าใช้จ่ายตั้งไว้ $0 ⇒ นาทีหมด = **merge แล้วไม่ deploy**
(เว็บยังเสิร์ฟเวอร์ชันล่าสุดที่ build ผ่าน) · ต.ค. 2026 หมดวันที่ 13 หลัง push เข้า main 112 ครั้งใน 13 วัน
- `render.yaml` → `buildFilter.ignoredPaths` ข้ามการ build เมื่อ push แตะแค่ `*.md` / `.claude/**`
  (วัดย้อนหลังได้แค่ ~6% ของ push — **ตัวประหยัดจริงคือ merge เป็นรอบ ไม่ใช่ทีละงานเล็ก**)
- 🔴 **ห้ามใส่ `docs/**` / `supabase/**` / `audit/**` ทั้งโฟลเดอร์** — เทสใน build อ่านไฟล์ในนั้น (`docs/**/*.py`,
  migrations, `audit/mobilesweep.mjs`) ข้ามแล้วด่านพังจะไปโผล่ตอน push โค้ดครั้งถัดไปแทน
- `buildFilter` ใน yaml มีผลเฉพาะ service ที่สร้างจาก Blueprint — ไม่งั้นต้องตั้งซ้ำที่ dashboard
  (Settings → Build & Deploy → Build Filters → Ignored Paths)

### ⏰ Deploy ตาม merge + กันถี่ (2026-10-13 · คำสั่ง user)

push เข้า main วันละถึง 31 ครั้ง (หลาย session ขนาน) ⇒ ~290 build/เดือน เกินนาทีฟรี 500 (build จริง ~2.5 นาที)
- **`.github/workflows/scheduled-deploy.yml`** ทำงานตอน **push เข้า main** (ข้าม push ที่แตะแค่ `.md`/`.claude`):
  deploy ล่าสุดเก่ากว่า **60 นาที** = deploy ทันที · ไม่งั้นรอ "เงียบ" **30 นาที** (push ใหม่ระหว่างรอ = ยกเลิกตัวเก่า
  `concurrency: cancel-in-progress` แล้วนับใหม่) แต่ไม่เกินครบ 60 นาทีจากรอบก่อน · จำลองจาก push จริง ≈ **~130 build/เดือน (~320 นาที)**
- จำ commit + เวลาที่ deploy ด้วย **annotated tag `render-deployed`** (เวลา = taggerdate) · ไม่มีของใหม่ = ข้าม · มีแค่ `.md`/`.claude` = เลื่อน tag ไม่ build
- **cron รายชั่วโมงเหลือเป็นตัวสำรองเท่านั้น** — 13/10 cron ของ GitHub ข้าม 3 รอบติด (11:07/12:07/13:07) ทั้งที่ไฟล์ถูก
  ⇒ 🔴 **ห้ามกลับไปพึ่ง schedule อย่างเดียว**
- repo เป็น **public** ⇒ นาที GitHub Actions ไม่จำกัด การ `sleep` รอใน job จึงไม่มีค่าใช้จ่าย · **ถ้า repo เปลี่ยนเป็น private ต้องคิดใหม่** (เพดานฟรี 2,000 นาที/เดือน)
- **ด่วน** (บั๊กหน้างาน): GitHub → Actions → *Scheduled deploy* → **Run workflow** = deploy ทันทีเสมอ
  · AI session สั่ง Run workflow ไม่ได้ (MCP ได้ 403) — ต้องให้ user กด
- hook ตอบไม่ใช่ 2xx = งานแดง ไม่เลื่อน tag · secret ไม่มี = push/cron ขึ้น warning / กดมือขึ้น error
- ⚠️ tag เลื่อนตอน Render **รับคิว** ไม่ใช่ตอน build ผ่าน — build ล้มบน Render ต้องกด Run workflow ซ้ำหลังแก้
- 🔴 **Render Auto-Deploy ต้องปิด** — service เป็น **Blueprint managed** ⇒ คุมด้วย `autoDeploy: false` ใน `render.yaml` (ปิดใน dashboard อย่างเดียว sync แล้วอาจเปิดกลับ) ไม่งั้น build ซ้ำ 2 ทาง
- ตั้งครั้งแรก (ทำแล้ว 13/10): Render → Settings → **Deploy Hook** → GitHub secret `RENDER_DEPLOY_HOOK` · **URL นี้เป็นความลับ**
- spend limit ของ Render ตั้ง $5 (ต.ค. นาทีฟรีหมดแล้ว) · user จะตั้งกลับ $0 แล้วถอดบัตรเดือน พ.ย. — **ตั้ง $0 ก่อนถอดบัตร**

### PWA — เพิ่มลงหน้าจอโฮม เปิดเหมือนแอป (2026-07-23)

รองรับ "เพิ่มลงหน้าจอโฮม" (iOS Safari / Android Chrome) เปิดแบบ standalone (เต็มจอ ไม่มีแถบ browser มีไอคอนเอง) เหมาะจอหน้าไลน์/มือถือหัวหน้า
- **manifest-only ตั้งใจ ไม่มี service worker** — เพราะ SW ที่ cache asset จะชนกับ **version-guard/auto-reload** ใน `main.jsx` + no-cache header ใน `render.yaml` (กลไกกัน "จอดำหลัง deploy" — ดู 3 กับดักด้านล่าง) · ถ้าจะเพิ่ม offline/auto-install-prompt (Android banner) ต้องเขียน SW แบบ **network-only ห้าม cache HTML/chunk** ไม่งั้นแอปค้างเวอร์ชันเก่า
- ไฟล์: `public/manifest.webmanifest` (name/short_name ESM, display standalone, theme/bg `#080f08`) + icons `public/icon-192.png`/`icon-512.png`/`icon-maskable-512.png`/`apple-touch-icon.png` (180 — iOS ต้อง PNG ไม่รับ SVG) · ต้นฉบับไอคอน `public/app-icon.svg` (โลโก้ TS + ESM บนพื้นเขียวเข้ม) · gen จาก TS logo ผ่าน Chromium (สร้างใหม่: rasterize `app-icon.svg` → PNG ขนาดที่ต้องการ)
- **ทางลัดไอคอนแอป (`shortcuts` · 2026-10-19)** — กดค้างไอคอน ESM บนหน้าจอโฮม → "สแกน" เปิด `/scan` (กล้องเปิดเอง) · ใช้ได้เฉพาะ Android/Chrome ที่ติดตั้งแบบแอป (iOS ไม่รองรับ) · เครื่องที่ติดตั้งไว้แล้ว Chrome อัปเดต manifest เองภายใน ~1 วัน · ใส่เฉพาะปลายทางที่ทุก role เปิดได้ (`/scan` piggyback สิทธิ์) — ห้ามใส่หน้าที่บาง role ไม่มีสิทธิ์ (กดแล้วเจอหน้าไม่มีสิทธิ์)
- `index.html` `<head>` มี `<link rel=manifest>` + `theme-color` + `apple-touch-icon` + `apple-mobile-web-app-*` (status-bar-style = `default` กันเนื้อหาทับ notch) — **ห้ามถอด**
- **เปลี่ยนโลโก้/ไอคอน** → แก้ `app-icon.svg` แล้ว rasterize ใหม่ทับ PNG ทั้ง 4 ไฟล์ (ขนาดเดิม) · เปลี่ยนชื่อไฟล์ไอคอนต้องอัพเดท manifest + index.html ด้วย
- **Badge จุดแดง/เลขบนไอคอนแอป (2026-07-23):** `NotificationBell` (App.jsx) sync `navigator.setAppBadge(unread)`/`clearAppBadge()` ตามจำนวนแจ้งเตือนที่ยังไม่อ่าน (ตาราง `notifications`) · **guard `'setAppBadge' in navigator`** · ✅ Android/desktop Chrome-Edge (ติดตั้ง PWA) · ❌ **iOS ไม่รองรับ App Badging API** (Apple ยังไม่ทำ — iPhone จะไม่เห็นเลขบนไอคอน) · อัปเดต**เฉพาะตอนเปิดแอป**เท่านั้น (ไม่มี service worker/Web Push → ปิดแอปแล้วไม่เด้ง) · ล้าง badge ตอน logout/unmount · ถ้าจะให้เด้งตอนปิดแอป (เหมือน LINE) ต้องเพิ่ม SW network-only + Web Push VAPID (ยังไม่ทำ)
- **เสียงแจ้งเตือน (2026-07-30):** `NotificationBell` เล่นเสียง chime (Web Audio — `playNotifChime()` ใน App.jsx, ไม่ต้องมีไฟล์เสียง) ตอนมี notification ใหม่เข้ามาแบบ realtime (INSERT — initial load ไม่เล่น) · prime AudioContext ตอน gesture แรก (เบราว์เซอร์บล็อกเสียงจนกว่าจะมี user interaction) · ปุ่ม 🔔/🔕 ในหัว dropdown เปิด/ปิดเสียง จำที่ `localStorage['esm-notif-sound']` (`off`=ปิด) · **ทำงานเฉพาะตอนเปิดแอปอยู่**
- **กดแจ้งเตือนในกระดิ่ง = เปิดหน้าที่เกี่ยวข้อง (2026-08-25 · feedback หน้างาน "เปิด MO แล้วอยากให้ช่างรับงานได้ทันที"):** แถวที่มี `ref_table` → mark อ่าน + navigate ตาม **`NOTIF_ROUTE`** ใน App.jsx (mtn_orders→`/mtn-repair` · four_m_logs→`/event-log` · downtime_logs→`/daily-report`) + ลูกศร › ท้ายแถวบอกว่ากดได้ · **ปลายทางผ่าน `canAccessPage` ก่อนเสมอ** (ไม่มีสิทธิ์ = mark อ่านเฉยๆ ไม่พาไปแล้วโดนเด้ง — กฎเดียวกับ telemetry หน้า Home) · **⚠️ `NOTIF_ROUTE` ต้อง mirror กับ `routeFor()` ใน edge `send-push` เสมอ** (Web Push กับกระดิ่งต้องพาไปหน้าเดียวกัน — แก้ฝั่งไหนตามไปแก้อีกฝั่ง)
- **Web Push — เด้งเข้ามือถือแม้ปิดแอป (เฟส B · 2026-07-30):** เพิ่ม service worker `public/sw.js` (**push + notificationclick เท่านั้น ไม่มี fetch handler ไม่ cache อะไร** — จงใจ กันชน version-guard/no-cache · register production-only ใน `main.jsx`) · VAPID keys เก็บใน `notification_settings` (คอลัมน์ `vapid_public/private/subject` — เหมือน bot_token, RLS on ไม่มี policy = อ่านได้เฉพาะ service role · ค่าจริง**ไม่อยู่ใน migration** set ผ่าน execute_sql) · ฝั่งเว็บดึง public key ผ่าน RPC `get_vapid_public_key()` · subscription เก็บ `push_subscriptions` (RLS ของ user เอง) · **trigger `trg_notify_push` (notifications AFTER INSERT) → pg_net ยิง edge `send-push` อัตโนมัติทุก row** (best-effort ไม่ทำ insert หลักพัง) → ทุกอย่างที่เขียน `notifications` = เด้ง push ให้เอง · edge `send-push` (Deno + `npm:web-push`, verify_jwt=false) อ่าน VAPID + subscriptions ของ user ส่ง push · 404/410 = ลบ subscription หมดอายุ · migration `20260730_web_push.sql` · **ทุกอย่าง free tier** (push service ของ browser ฟรี, VAPID ฟรี, edge function ฟรี) · util ฝั่งเว็บ `src/utils/webpush.js` · ปุ่ม "📲 เปิด" อยู่ในหัว dropdown กระดิ่ง
  - **🔴 กฎความจริงของสถานะ push (2026-09-08 · feedback หัวหน้ากะ Samsung "เปิดแจ้งเตือน MO แล้วไม่เคยเด้ง"):** subscription ในเบราว์เซอร์ ≠ ส่งถึงจริง — edge `send-push` อ่านจาก **แถว `push_subscriptions` ของ user นั้น** เท่านั้น · แถวหายได้เงียบๆ 3 ทาง: send-push ลบ 404/410 · คนอื่นบนมือถือเครื่องเดียวกันกด "ปิด" (ลบตาม endpoint) · upsert เดิม `ignoreDuplicates` = ON CONFLICT DO NOTHING (endpoint เดิมค้าง user_id/keys ของคนก่อน) · เดิม `getPushState()` ดูแค่ `pushManager.getSubscription()` → จอโชว์ "เปิดแล้ว" ตลอดกาลและซ่อนปุ่ม "เปิด" · **แก้แล้ว:** `getPushState(userId)` (`src/utils/webpush.js`) เทียบ endpoint กับแถวของ user ปัจจุบันเสมอ → สถานะใหม่ **`stale`** ("⚠️ การลงทะเบียนหลุด — กดเปิดใหม่" + ปุ่มเปิด) และ **`check-failed`** (คิวรีล้ม → ปุ่ม "ลองใหม่" — ห้ามตีความเป็น "ยังไม่เปิด") · **หน้าใหม่/จุดใหม่ที่จะโชว์สถานะ push ต้องใช้ `getPushState(userId)` ห้ามอ่าน `getSubscription()` ตรง**
  - **RPC `upsert_push_subscription(p_endpoint, p_p256dh, p_auth, p_user_agent)`** (SECURITY DEFINER · authenticated เท่านั้น · migration `20260908_push_subscriptions_rebind.sql` — **Main** · ⏳ รอ apply) ผูกแถวกับ `auth.uid()` เสมอ = **คนที่ login ล่าสุดบนเครื่องนั้นเป็นเจ้าของ endpoint** (มือถือใช้ร่วมกัน) + ทับ p256dh/auth เมื่อ key หมุน · `subscribePush()` เรียกตัวนี้ก่อน · ถ้ายังไม่ apply → fallback insert แบบเดิมแล้ว**ตรวจกลับ**ว่าแถวเป็นของเรา ไม่ใช่ = throw บอกให้ apply migration (ไม่ขึ้น "เปิดแล้ว" ทั้งที่ no-op) · ไม่เพิ่ม UPDATE policy ให้แตะแถวคนอื่นตรงๆ (ใครรู้ endpoint ก็ลบ subscription คนอื่นได้) · `unsubscribePush()` คืน `{ok, dbRows, error}` นับแถวที่ลบจริง (RLS ปฏิเสธ = 0 แถวไม่ error)
  - **`pushsubscriptionchange` ใน `public/sw.js`** (เดิมไม่มี = token หมุนแล้วเงียบถาวร): SW สมัครใหม่ด้วย `applicationServerKey` เดิมจาก `oldSubscription` แล้ว `postMessage({type:'esm-push-resubscribe', oldEndpoint, newEndpoint})` ให้หน้าเว็บ (SW ไม่มี JWT เขียน DB เองไม่ได้) → `handlePushResubscribe()` rebind อัตโนมัติ**เฉพาะเมื่อ endpoint เก่าเป็นของ user นี้** (ไม่ใช่ = ไม่เดาแทนคน ปล่อยจอ `stale`) · ไม่มีหน้าเว็บเปิดตอนหมุน = จับได้ตอนเปิดแอปครั้งถัดไปผ่าน `stale` (trade-off ที่ยอมรับ)
  - **ปุ่ม "ทดสอบส่ง"** ข้างปุ่มปิดในหัวกระดิ่ง (สถานะ subscribed) = insert `notifications` ของตัวเอง (policy `notifications_insert_authenticated`) → trigger ยิง `send-push` จริง → หน้างานพิสูจน์ได้เองว่าเด้งถึงเครื่องนี้ ไม่ต้องรอ MO · อ่าน `error` ผ่าน `checkWrite`
  - **checklist rollout Samsung/Android (ให้หัวหน้ากะทำตามลำดับ):** (1) เปิดแอปจาก Chrome (หรือ PWA ที่ติดตั้งจากหน้าจอโฮม) · (2) กระดิ่ง → "📲 เปิด" → กด "อนุญาต" ตอน Chrome ถาม · (3) **ตั้งค่า Android → แอป → Chrome → การแจ้งเตือน = เปิด** (และหมวด "เว็บไซต์" ของโดเมน ESM เปิดอยู่) · (4) **ตั้งค่า → แอป → Chrome → แบตเตอรี่ = "ไม่จำกัด" (Unrestricted)** — Samsung ตั้ง "ปรับให้เหมาะสม/ใส่แอปเข้าโหมดหลับ" เป็น default = Doze ไม่ปลุก · ปิด "ให้แอปที่ไม่ได้ใช้เข้าสู่โหมดหลับ" สำหรับ Chrome · (5) กด "ทดสอบส่ง" แล้วล็อกจอรอ ~10 วินาที ต้องเด้ง · (6) ถ้าจอกระดิ่งขึ้น "⚠️ การลงทะเบียนหลุด" ให้กด "เปิด" ใหม่ (เกิดเมื่อมีคนอื่นกด "ปิด" บนเครื่องเดียวกัน หรือ endpoint หมดอายุ) · เช็คฝั่ง DB (MAIN): `select user_id, left(endpoint,60), created_at from push_subscriptions order by created_at desc` ต้องมีแถวของ user นั้น · ฝั่ง edge: log `send-push` ต้องไม่มี `failed 401/403`
  - ⚠️ **iPhone:** ต้อง "เพิ่มลงหน้าจอโฮม" (standalone) + iOS 16.4+ ก่อน (Safari เฉยๆ ไม่รองรับ — util เช็ค `isIosNonStandalone` โชว์คำแนะนำแทนปุ่ม) · Android/desktop Chrome-Edge ใช้ได้เต็มที่ · เสียง push ตอนปิดแอป = เสียงระบบมือถือ (กำหนดเองไม่ได้)
  - **event ที่เข้ากระดิ่ง+เสียง+push (เขียนตาราง `notifications`):** 4M + @mention (เดิม) · **+ urgent เครื่องหยุด 2 ตัว (2026-07-30): `downtime_call_mtn` (เรียกช่าง) + `downtime_open_15min` (เครื่องค้างเกินเกณฑ์)** — ผู้รับ = `recipientsForDowntime(line_name)` = **ทีมช่างทั้งหมด (role `mtn`) + หัวหน้าของ section ไลน์นั้น** (supervisor/manager ที่ section ตรงกับไลน์ ผ่าน `headsForLine` — เทียบ `production_lines.section` กับ `profiles.section`/`sections[]` + leader ที่ `line_id` ตรงไลน์) · helper `usersByRole`/`headsForLine`/`recipientsForDowntime`/`insertNotifications` ใน `send-notification` edge (เพิ่ม event urgent อื่นเรียกซ้ำได้) · **เจตนา เน้น urgent เท่านั้น** (เช็คชื่อ/OT/ปิดกะปกติ ยังอยู่แค่ Telegram กัน notification fatigue) · **ผู้รับ mtn+heads ยัง hardcode อยู่ (เป็นฐานขั้นต่ำ ห้ามถอด) แต่ตอนนี้ `recipientsForDowntime` merge ผู้รับจาก `notify_recipients` เข้ามาด้วย** → admin เพิ่มคนรับได้จาก UI โดยไม่ต้อง redeploy (2026-08-25)
  - **✅ ผู้รับในแอปแบบ data-driven ต่อทุกเรื่อง (2026-07-31):** `notification_rules.inapp_roles text[]` — ตั้งจากหน้า `/notification-config` (picker "📲 แจ้งในแอปด้วย" เลือก role ผู้รับต่อเรื่อง) · edge `send-notification` มี `notifyInApp(routes, event, message)` เรียกท้ายทุก branch มาตรฐาน (checkin/OT/morning/downtime/prod_close/pm/edi/shipping…) → เรื่องที่ตั้ง `inapp_roles` ไว้ = insert `notifications` ให้ user ทุกคนใน role นั้น (title=label เรื่อง, body=ข้อความ Telegram ตัด HTML) → trigger ยิง push ต่อ · **ไม่ตั้ง role = เข้าแค่ Telegram เหมือนเดิม** · **admin เพิ่มผู้รับเรื่องไหนก็ได้จาก UI ไม่ต้องแก้โค้ด** · migration `20260731_notification_inapp_roles.sql` · ⚠️ 3 branch bespoke (4M/downtime_call_mtn/downtime_open_15min) ไม่เรียก notifyInApp (มี recipient เองแล้ว) — `inapp_roles` ของ 3 เรื่องนี้ไม่มีผล

> ### ⚠️⚠️ กฎเหล็ก — ผู้รับแจ้งเตือน "ทั้งระบบ" มีตัวตัดสินตัวเดียว: RPC `notify_recipients(p_event, p_section)` (2026-08-25 · คำสั่ง user "telegram กับในแอปต้องสอดคล้องตรงกัน + setup ได้ว่าแจ้งส่วนงานไหน แผนกไหน role ไหน")
> **ที่มา:** audit ทั้งระบบแล้วพบ **16 จุดที่พนักงานกรอกข้อมูลแล้วไม่มีแจ้งเตือนอะไรเลย** (เปิด NCR/CAPA/เคลม · แจ้งซ่อมสโตร์ · ขอเติม WIP · ใบเบิก · ของเสีย · ถังเหลือง/แดง · ใบ scrap · OJT · Kaizen · action ประชุม · LPA เจอ N/T · คำขอ level-up · feedback · คำขอแก้เอกสาร PE · เรียกภาชนะ)
> **ต้นเหตุที่มันเงียบมาตลอด: การเพิ่มแจ้งเตือน 1 เรื่อง เคยต้องไปแก้ `send-notification/index.ts` (55KB) เพิ่ม branch เอง** → ไม่มีใครอยากแตะ เลยไม่มีใครเพิ่ม
>
> | ชั้น | ของเดิม (ก่อน 2026-08-25) | ตอนนี้ |
> |---|---|---|
> | ใครได้รับในแอป | `usersByRole(inapp_roles)` — **role อย่างเดียว ทั้งโรงงาน** | **`notify_recipients` RPC** — role × ส่วนงาน × แผนก |
> | เพิ่มเรื่องใหม่ | แก้ edge 55KB + deploy | **insert แถวใน `notification_rules` + เรียก `notifyEvent()` — ไม่ต้องแตะ edge** |
> | Telegram vs ในแอป | คนละเส้นทาง ตั้งค่าคนละที่ | อ่าน **แถวเดียวกัน** ใน `notification_rules` |
>
> - **`notify_recipients(p_event text, p_section text default null)`** (Main · SECURITY DEFINER · stable · **revoke จาก anon**) คืน `setof uuid` ของ user ที่ควรได้รับ — เกณฑ์ 3 ชั้นจากแถว `notification_rules` ของ event นั้น:
>   1. `inapp_roles` — role ที่รับ (ไม่ตั้ง = ไม่มีใครรับในแอป · เหมือนเดิม)
>   2. `inapp_sections[]` — จำกัดส่วนงาน (ว่าง = ทุกส่วนงาน) · จับคู่ทั้ง `profiles.section` · `profiles.sections[]` · **`employees.section` ผ่าน `profiles.employee_id`**
>   3. `inapp_depts[]` — จำกัดแผนก (ว่าง = ทุกแผนก) · จาก `employees.department` (แผนกไม่ได้อยู่บน profiles — ต้องเดินผ่าน employee_id เสมอ)
>   - **`inapp_match_section` (boolean)** = "แจ้งเฉพาะคนในส่วนงานที่เกิดเหตุ" — คนละแกนกับข้อ 2: ข้อ 2 คือ *fix ส่วนงานไว้ตายตัว* · ตัวนี้คือ *ตามส่วนงานของเหตุการณ์แต่ละใบ* · **`admin`/`manager` ได้รับเสมอ ไม่ถูกกรองด้วยแกนนี้** และคนที่ยังไม่ถูกตั้งส่วนงานเลย (`section`/`sections[]`/`employees.section` ว่างทั้งหมด) ก็ได้รับ — ไม่งั้นบัญชีที่ข้อมูลยังไม่ครบจะหายจากการแจ้งเตือนเงียบๆ
> - **ส่วนงานของเหตุการณ์ derive จาก `line_name` อัตโนมัติ** (`sectionOfLine()` — ไลน์ลูกที่ไม่ได้ตั้ง section **ตกทอดจาก `parent_line_name`** ตาม pattern ทั้งระบบ) → ฝั่ง client ส่งแค่ชื่อไลน์ ไม่ต้องรู้ว่าอยู่ส่วนงานอะไร
> - **edge ทั้ง 4 ตัวเรียก RPC ตัวเดียวกันแล้ว:** `send-notification` (v45) · `send-mtn-notification` (v15 — `usersByRule()` แทน `usersByRole()`) · `send-store-notification` (v2) · `send-event-notification` (v1 ใหม่) — **RPC ล้มเหลว = fallback ไป `usersByRole` เดิมเสมอ + `console.error`** (แจ้งเตือนต้องไม่หายทั้งระบบเพราะ RPC มีปัญหา)
>
> #### ➕ เพิ่มแจ้งเตือนเรื่องใหม่ = 2 ขั้น ห้ามไปแก้ `send-notification` อีก
> 1. **insert แถวใน `notification_rules`** (`event_key`/`label`/`category`/`channel_ids`/`inapp_roles`/`sort_order`)
> 2. **เรียก `notifyEvent({ event, lines, title, vars, ref_table, ref_id })` จาก `src/utils/notifyEvent.js`** ตรงจุดที่บันทึกสำเร็จ
>    → edge กลาง **`send-event-notification`** (verify_jwt=false) จัดการที่เหลือ: หา rule → resolve ส่วนงานจากไลน์ → ส่ง Telegram (template ที่ admin แก้ในหน้าตั้งค่าชนะเสมอ) → `notify_recipients` → insert `notifications` → trigger เดิมยิง Web Push ต่อ
> - **`notifyEvent` เป็น fire-and-forget ห่อ try/catch + `.catch(() => {})` — แจ้งเตือนพลาดห้ามลากงานหลักล้ม** (กฎเดิมของโปรเจค) · **แต่ห้ามเงียบฝั่ง server**: edge log error ทุกจุด
> - **ยิงตอน "สร้างใหม่" เท่านั้น ห้ามยิงตอนแก้ไข** — ทุกจุดที่ wire ไว้ gate ด้วย `!form.id` / `editing === 'new'` / `status === 'submitted'` ฯลฯ ไม่งั้นแก้ typo ทีนึงเด้งใหม่ทุกครั้ง
> - **LPA ยิงเฉพาะเมื่อมีข้อ N/T** (ตรวจแล้วผ่านหมด = ไม่ใช่เรื่องที่ต้องปลุกใคร)
>
> #### ⚠️ วัดความถี่ก่อนเปิด `inapp_roles` เสมอ (กฎเดิม ย้ำอีกครั้ง)
> event ที่ยิงเกิน ~5 ครั้ง/วัน ไม่ควรเข้ากระดิ่ง/Push (ให้อยู่ Telegram หรือยุบเป็นสรุปรายวัน)
> → **`defect_recorded` seed มาโดย `inapp_roles` ว่างก่อน แล้ววัดจริงค่อยเปิด** — วัด 21 วัน: **1–7 ครั้ง/วัน เฉลี่ย ~3** ต่ำกว่าเกณฑ์ → **user เคาะให้เปิด 2026-08-31** (`20260831_defect_recorded_inapp.sql` **apply แล้ว 2026-09-01** · supervisor/manager/admin/qa · `inapp_match_section=true` = หัวหน้าได้เฉพาะส่วนงานตัวเอง) · **นี่คือลำดับที่ถูก: seed ปิดไว้ → วัด → ค่อยเปิด** ไม่ใช่เปิดไปก่อนแล้วรอคนบ่น
> - **🔴 เคสจริงที่พิสูจน์กฎนี้ — `shipping_shipped` ถูกปิด in-app แล้ว 2026-08-25** (migration `20260825_shipping_shipped_telegram_only.sql`): วัดได้ **338 notification ใน 23 นาที (26 รอบ × ผู้รับ 13 คน)** ตอนทีมกด "ส่งแล้ว" เคลียร์รอบค้างเป็นชุด · **นี่คือต้นตอที่ user รายงานว่า "iPhone เห็นแต่การแจ้งเตือนเรื่องส่งของ"** — เรื่องจริง (เครื่องหยุด/4M/ซ่อม) ถูกกลบ · **"งานเสร็จแล้ว" ไม่ใช่สิ่งที่ต้องปลุกใคร ส่วนที่ต้องรีบคือ `shipping_overdue` ซึ่งยังเข้าแอปเหมือนเดิม** · Telegram ไม่ถูกแตะ · **บทเรียน: event ที่ผูกกับ "รายการ" (รายรอบ/รายใบ/รายชิ้น) จะระเบิดเสมอเมื่อมีคนเคลียร์งานค้างเป็นชุด — ประเมินด้วย "ถ้าเคลียร์ backlog 30 รายการรวดจะเกิดอะไร" ไม่ใช่แค่ค่าเฉลี่ยต่อวัน**
>
> - **ตั้งค่าที่ `/notification-config` → ปุ่ม 🎯 ต่อเรื่อง** (โผล่เฉพาะเมื่อเลือก role ผู้รับแล้ว) — ติ๊ก "เฉพาะส่วนงานที่เกิดเหตุ" + เลือกส่วนงาน/แผนกเป็นชิป · ลิสต์ส่วนงาน/แผนกมาจาก `org_nodes` แล้วต่อท้ายด้วยค่าที่พบจริงใน `employees` (ค่านอกผังยังเลือกได้ — หลักเดียวกับ optgroup "นอกผัง" ใน `/operator`) · หัวเรื่องมีสรุปเป้าหมายเป็นข้อความ (`● เฉพาะส่วนงานที่เกิดเหตุ · แผนก: MTN` / `○ ทุกส่วนงาน/ทุกแผนก`)
> - migration `20260825_notify_targets_and_silent_events.sql` (**apply แล้ว 2026-08-25**) — เพิ่ม 3 คอลัมน์ + RPC + seed 16 event (sort 310-460) + **backfill `channel_ids` จาก rule แรกในหมวดเดียวกัน** เพื่อให้ Telegram ทำงานทันทีโดยไม่ต้องไปตั้งห้องทีละเรื่อง
> - **คำขอ level-up ยิงจาก DB trigger** (`trg_notify_skill_levelup` — statement-level `referencing new table as new_rows` รวมสูงสุด 200 แถวเป็น POST เดียว) เพราะคำขอเกิดจาก **cron `fn_weekly_skill_update` ไม่ใช่การกดของคน** → ไม่มี client ให้เรียก `notifyEvent` · **`exception when others then return null`** — แจ้งเตือนพังห้ามทำ job สกิลรายสัปดาห์ล้ม · **trigger ที่ยิง notification ต้องเป็น statement-level เสมอ** (row-level = คำขอ 100 แถว → 100 POST)

> ⚠️ **กับดักหลัง deploy — จอดำในแท็บที่เปิดค้าง (แก้แล้ว 2026-07-10):** ทุกหน้าเป็น lazy chunk ชื่อไฟล์มี hash
> deploy ใหม่ = ไฟล์เก่าหายจาก server → แท็บเก่าเปลี่ยนหน้าแล้วโหลด chunk พัง → React ล่มเป็นจอดำเงียบๆ
> `src/main.jsx` มีตัวจัดการแล้ว: `vite:preloadError` → auto reload 1 ครั้ง (กัน loop 30 วิ) + `RootErrorBoundary`
> แสดงหน้า "โหลดหน้าใหม่" แทนจอดำ — **ห้ามถอดออก** และ error อื่นที่ไม่ใช่ chunk จะโชว์ข้อความ error ให้ debug ได้
>
> ⚠️ **กับดักที่สอง — แท็บใหม่ (ctrl+click) ได้เวอร์ชันเก่าจาก browser cache (แก้แล้ว 2026-07-12):**
> เบราว์เซอร์ cache index.html แบบเดา (heuristic) ได้ถ้า server ไม่ส่ง Cache-Control → แท็บใหม่บูตแอปเวอร์ชันเก่า
> คลิกอะไรก็เงียบ · แก้ 2 ชั้น **ห้ามถอดทั้งคู่**: (1) **version guard** ใน `src/main.jsx` เทียบ `__BUILD_ID__`
> (จาก `vite.config.js` define + emit `dist/version.json`) กับ `/version.json` (no-store) ตอนเปิด+กลับมาโฟกัสแท็บ
> ไม่ตรง = reload อัตโนมัติ · (2) `render.yaml` ตั้ง header: `/*` = no-cache, `/assets/*` = immutable
> (ถ้า service ไม่ได้สร้างจาก Blueprint ต้องตั้ง 2 rules นี้เองใน Render dashboard → Redirects/Headers)
>
> ⚠️ **กับดักที่สาม — เปิดหลายแท็บแล้วบางแท็บหลุด login เงียบๆ เป็น "หน้าผี" (แก้แล้ว 2026-07-14):**
> เดิม auth ฝั่ง Main เก็บใน `sessionStorage` (แยกต่อแท็บ) → หลายแท็บถือ refresh token คนละก๊อปปี้
> พอ token หมุน แท็บที่ถือของเก่าโดนปฏิเสธ → query ฝั่ง Main ล้มหมดแต่ฝั่ง DR (anon) ยังขึ้น
> (อาการชี้ตัว: เลขไลน์/downtime ขึ้น แต่เช็คชื่อ/4M เป็น 0 + ชิปเมนูและป้าย role หาย)
> แก้: `supabaseClient.js` ใช้ localStorage (default — **ห้ามเปลี่ยนกลับ**, ความปลอดภัยเครื่องส่วนกลาง
> มี auto-logout idle 30 นาทีคุมแทน) + `fetchProfile` ใน App.jsx เป็น fail-visible: token เสีย/user
> ถูกลบ → signOut ไปหน้า login, network สะดุด → ค้าง "กำลังโหลด..." (ไม่ signOut — localStorage
> แชร์ข้ามแท็บ เดี๋ยวพาแท็บดีๆ หลุดตาม) · หมายเหตุ test harness: seed token ต้องลง localStorage แล้ว

---

---

## 🎯 ย้ายเข้า server บริษัท — คำสั่งถาวร user (2026-10-14)

> *"อนาคต คำสั่งนายคือย้ายเข้า server บริษัทนะ"*

**เป้าหมายปลายทาง: ระบบรันบน server ของบริษัท** — ทุก session ที่แตะ deploy/โครงสร้างพื้นฐาน
ให้เลือกทางที่พาไปทางนั้น · **ห้ามผูกกับของเฉพาะ Render เพิ่ม** (เช่น Render redirects/headers/env
ที่ย้ายตามไม่ได้ — ของพวกนี้ให้ไปอยู่ในไฟล์ config ของแอปแทน)

### 🔴 แยกให้ออกก่อน: hosting กับ egress เป็นคนละเรื่อง

| | อยู่ที่ไหน | ย้าย hosting แล้วได้อะไร |
|---|---|---|
| ไฟล์หน้าเว็บ (JS/CSS/HTML) | Render Static Site | ✅ ไม่ต้องพึ่งโควตา build · เร็วขึ้นบน LAN |
| **ข้อมูล/auth/รูป/realtime** | **Supabase (เบราว์เซอร์ยิงตรง)** | ❌ **ไม่ลดแม้แต่ไบต์เดียว** |

เบราว์เซอร์ของแต่ละคนเรียก `https://<project>.supabase.co` **ตรงๆ** ไม่ผ่านตัว host
⇒ **ห้ามอ้าง "ย้าย server แล้วค่า Supabase จะลด"** — ไม่จริง และเคยเกือบตัดสินใจผิดด้วยเหตุผลนี้ (14/10)

### ลำดับที่ต้องทำ (ห้ามข้ามขั้น)

**ขั้น 1 — static hosting (ความเสี่ยงต่ำ ทำได้เลย)**
ย้ายไฟล์ที่ build แล้วไปเสิร์ฟจาก server บริษัท (nginx/IIS ก็พอ)
· ล่ม = แค่เปิดหน้าเว็บไม่ได้ **ข้อมูลไม่หาย** (ยังอยู่ที่ Supabase) ⇒ ย้อนกลับง่าย
· ต้องมี: TLS (ใบรับรอง) · ทางเข้าจากนอกโรงงาน (คนใช้มือถือ 4G/5G จริง — วัดได้ 679 IP เมื่อ 13/10)
· ⚠️ `vite:preloadError` auto-reload ใน `src/main.jsx` ต้องยังทำงาน (ไฟล์ chunk เก่าหายหลัง deploy)

**ขั้น 2 — self-host Supabase (ความเสี่ยงสูง ห้ามเริ่มจนครบเงื่อนไข)**
🔴 **เงื่อนไขที่ต้องมีครบก่อน ขาดข้อใดข้อหนึ่ง = ยังไม่ย้าย:**
1. **มีคนดูแลจริง** (ไม่ใช่ AI session) — patch security · ต่ออายุใบรับรอง · ดู log
2. **backup + ซ้อมกู้คืนสำเร็จจริงอย่างน้อย 1 ครั้ง** — ไม่ใช่แค่ "ตั้ง backup ไว้แล้ว"
3. **ทางเข้าจากมือถือนอกเครือข่ายโรงงาน** ที่ปลอดภัย (VPN หรือ reverse proxy + TLS + firewall)
4. **แผนตอน server ล่มตี 2** — ทั้งโรงงานพึ่งระบบนี้แล้ว เปิดกะไม่ได้ = เสียหายจริง

ของที่ต้องย้าย: Postgres 2 ชุด · GoTrue (auth) · PostgREST · Realtime · Storage · Edge Functions
· RLS policy ทั้งหมด · publication ของ realtime (`src/utils/realtimeTables.js`)
⚠️ **ฝั่ง DR เป็น `anon` ทั้งโปรเจค** — เปิดออกอินเทอร์เน็ตโดยไม่มีด่านหน้า = ใครก็อ่านข้อมูลผลิตได้

### ค่าใช้จ่ายระหว่างที่ยังอยู่ Supabase (วัด 14/10)

Supabase projection ของรอบ 11 ต.ค.–11 พ.ย. = **$37.42** — ไม่ใช่ $25 (นั่นคือค่า plan อย่างเดียว)
· Pro plan $25 · compute 2 projects × Micro ≈ $20 **− compute credits $10** ≈ $10–12
· egress/storage = $0 (ใช้ ~17 GB จาก 250 GB ที่รวมอยู่แล้ว)
🔴 **compute ลดไม่ได้** — Micro เล็กสุด · **ห้ามยุบ 2 projects เป็น 1** (DR เป็น anon ทั้งโปรเจค)
📄 ตัวเลขสำหรับทำเรื่องขออนุมัติ → `docs/EGRESS-AUDIT-2026-09-17.md` §17
· **ยอดจริงที่ชำระ 11 ต.ค. = $36.70** (OJBRFH-00008) — ใช้ตัวนี้เป็นฐาน ไม่ใช่ projection

---

## 🕗 หน้าต่าง deploy — ห้าม deploy ในเวลาทำงาน (2026-10-26 · บทเรียนจากของจริง)

**สิ่งที่เกิด:** 26/10 deploy ไป **6 รอบในวันทำงาน** (แต่ละตัว build ผ่าน · เทสผ่าน · crashsweep ผ่าน)
แต่หน้างานสะดุดทุกรอบ และรอบ 20:17 หน้างานแจ้งว่า **"อยู่ๆ ก็โหลดไม่ได้ซักจอ ทุกยูสเซอร์"**

🔴 **กฎ: 08:00–17:30 deploy ได้เฉพาะของที่ "ไม่แก้แล้วหน้างานทำงานไม่ได้"**
ที่เหลือ merge เข้า main ได้ตามปกติ **แต่รอ deploy หลังเลิกกะ/ก่อนเข้ากะ**

**ทำไม:** การ deploy สลับไฟล์ `assets/*` ชุดใหม่ทั้งชุด (ชื่อมี hash)
⇒ แท็บที่เปิดค้างอยู่ยังถือรายชื่อไฟล์ชุดเก่า ⇒ กดอะไรที่ต้องโหลด chunk เพิ่ม = ไฟล์หาย
⇒ **พังพร้อมกันทุกเครื่องในวินาทีเดียว** โดยที่โค้ดใหม่ไม่ได้ผิดอะไรเลย

**สิ่งที่ *ไม่* ช่วย:** โค้ดถูก · เทสครบ · สวีปผ่าน — ทั้งหมดนี้วัด "โค้ดใหม่ดีไหม"
ไม่ได้วัด "คนที่ถือโค้ดเก่าอยู่ตอนนี้จะเป็นยังไง"

**สิ่งที่ช่วย:**
- เลือกเวลา (กฎนี้)
- `version.json` + version guard ใน `main.jsx` (แท็บที่กลับมาโฟกัสจะ reload เอง)
- `Cache-Control: no-cache` ของ `/*` ใน `render.yaml` (index.html ต้อง revalidate ทุกครั้ง)
- ตาข่ายกันจอขาวใน `index.html` (§ตาข่ายกันจอขาว ด้านล่าง) — **ตัวนี้ไม่ได้กันการ deploy กลางวัน**
  มันแค่ทำให้คนหน้างาน "เห็นปุ่มให้กด" แทนจอขาวเปล่า · เลือกเวลา deploy ยังเป็นด่านแรกเสมอ

🔴 **ถ้าจำเป็นต้อง deploy กลางวันจริงๆ:** แจ้งหน้างานล่วงหน้าให้รีเฟรชรอบเดียวหลัง deploy
และ **ห้าม deploy ซ้ำภายในวันเดียวกันโดยไม่จำเป็น** — ทุกรอบคือการรบกวนครั้งใหม่

---

## ⬜ ตาข่ายกัน "จอขาวสนิท" — `#boot-fallback` ใน `index.html` (2026-10-26)

**เคสจริง:** หน้างานแจ้งจอขาว **ทั้งคอมและมือถือ (4G ก็เป็น)** · ไม่มีอะไรบนจอให้กดเลย

🔴 **ทำไม `RootErrorBoundary` ช่วยไม่ได้:** ถ้าไฟล์ chunk โหลดไม่ได้ (404 หลัง deploy · เน็ตตัดกลางคัน)
หรือโค้ดพัง**ตั้งแต่ตอน import** (เช่น env หาย → `supabaseUrl is required`) — React **ไม่เคยถูกสร้าง**
⇒ ErrorBoundary ไม่มีทางทำงาน ⇒ `<div id="root">` ว่างเปล่า = จอขาวสนิท

**ที่ทำ:** กล่อง `#boot-fallback` + สคริปต์สั้นๆ **ใน `index.html`** (ทำงานได้แม้โปรแกรมหลักไม่โหลดสักบรรทัด)
- ดัก `error` ของ `<script>`/`<link>` → ขึ้นทันที พร้อมข้อความ "โหลดไฟล์โปรแกรมไม่ได้"
- ไม่มี error แต่ไม่เคย mount ภายใน **15 วินาที** → ขึ้นข้อความทั่วไป
- `main.jsx` ตั้ง `window.__ESM_MOUNTED = true` หลัง `render()` แล้วลบกล่องทิ้ง
- 🔴 **ปุ่มต้อง "ล้างของเก่าแล้วเปิดใหม่"** (`caches.delete` + `location.replace('?fresh=…')`)
  **ห้ามเป็น `location.reload()` เปล่าๆ** — reload ธรรมดาได้ `index.html` ตัวเดิมจาก cache = วนขาวซ้ำ
  (เหตุผลเดียวกับที่หน้างานกด F5 แล้วไม่หาย)

**พิสูจน์กับบันเดิลจริง 3 เคส:**

| เคส | ผล |
|---|---|
| แอปขึ้นปกติ | `__ESM_MOUNTED=true` · **กล่องถูกลบทิ้ง ไม่บังอะไร** |
| ลบไฟล์ chunk หลัก (จำลองบันเดิลเก่าค้าง) | ขึ้นกล่อง + ข้อความ "โหลดไฟล์โปรแกรมไม่ได้…" |
| โยน error ตอน import (env หาย) | ขึ้นกล่องหลัง 15 วินาที |

· ด่าน `boot-fallback` ใน `regressionGuards` · ⚠️ `audit/*sweep.mjs` ใช้ `audit/index.html`
  **จึงไม่ได้ทดสอบตาข่ายนี้** — ต้องทดสอบกับ `dist/` จริงถ้าจะแก้


---

## 📈 ข้อมูลโตเร็วแค่ไหน + สเปค server ที่ต้องขอ (วัด 28/10/2026)

### ขนาดวันนี้

| | DR (Product DB) | Main | รวม |
|---|---:|---:|---:|
| ฐานข้อมูล | 257 MB | 153 MB | **410 MB** |
| ไฟล์ storage | 300 MB · 4,701 ไฟล์ | 81 MB · 547 ไฟล์ | **381 MB** |
| จำนวนตาราง (public) | 156 | 140 | 296 |
| **รวม** | 557 MB | 234 MB | **~790 MB** |

### โตเดือนละเท่าไหร่ (อัตราเดือน ต.ค.)

| ตัวที่โต | MB/เดือน | เป็น "ความต้องการจริง" ไหม |
|---|---:|---|
| ไฟล์/รูป (storage) | ~150–180 | ✅ ใช่ — **ตัวเลขอ่อนสุด มีข้อมูลแค่ 2 เดือน** (ก.ย. 117 · ต.ค. 179) |
| `audit_log` ฝั่ง DR | **~90** | ❌ **ไม่ใช่** — ดูหัวข้อถัดไป |
| ตารางงานจริง (ใบผลิต · DT · MO · สต็อก) | ~25–30 | ✅ ใช่ |
| `notifications` ฝั่ง Main | ~15–20 ปกติ | ⚠️ มีวันที่พุ่ง 12 MB วันเดียว |
| **รวม** | **~300 MB/เดือน** | |

**ประมาณการ 12 เดือน: ~4.5 GB (อัตราคงที่) ถึง ~7 GB (ถ้ายังโตแบบ ต.ค. อีก 6 เดือนแล้วค่อยนิ่ง)**
🔴 ช่วงนี้กว้างเพราะ storage มีข้อมูลแค่ 2 เดือน — **ห้ามเอาขอบล่างไปใช้วางแผนดิสก์**

### 🔴 2 ตัวที่โตเพราะกลไก ไม่ใช่เพราะงาน

**1. `audit_log` (DR) = 130 MB จาก 213 MB ของ public ทั้งหมด = 61%**
แถวละ ~1.2 KB · วันทำงานละ 2,500–4,000 แถว (3–5 MB/วัน)

| | ก.ค. | ส.ค. | ก.ย. | ต.ค. (28 วัน) |
|---|---:|---:|---:|---:|
| แถว | 382 | 6,364 | 26,321 | 61,193 |

ที่มา 4 อันดับแรก: `customer_shipping_orders` 29,076 · `jig_checkpoints` 21,721 ·
`stock_receipts` 13,186 · `monitor_cells` 11,257
🔑 `customer_shipping_orders` มี **2,905 แถว** แต่มี audit **29,076 รายการ = แถวละ ~10 ครั้ง**
⇒ นี่คือ **bulk update ทะเบียน/นำเข้าซ้ำ** ไม่ใช่คนแก้งาน · **ยังไม่มี retention policy เลย**

**2. `notifications` (Main) = 49 MB · 59,409 แถว · เกิดในเดือน ต.ค. ทั้งหมด**
🔴 **44,570 แถว (75%) เกิดวันเดียว — 26/10** ทั้งที่วันนั้นมีใบ 4M แค่ **49 ใบ**
หัวข้อเดียว (`4M Man · SUB APRON → รอ SV Approve`) = **6,201 แถว · 79 ผู้รับ**
⇒ 6,201 ÷ 79 = **ยิงซ้ำหัวข้อเดิม ~78 รอบ** ในช่วง 10:28–12:47 (ทุก ~1.8 นาที)
⇒ **ผิดกฎที่มีอยู่แล้ว** (CLAUDE.md §4M — *"ตัวสร้างอัตโนมัติต้องมีเพดาน/ตัวนับ + กันใบซ้ำ"*)
· fan-out 79 คน/ใบ แปลว่าใบ 4M 1 ใบ = 79 แถว ⇒ **ต้นทุนโตตามจำนวนพนักงาน ไม่ใช่ตามงาน**

### คำขอ/วัน — อ่านคู่กันเสมอ

| | 16/10 ศ. | 27/10 อ. |
|---|---:|---:|
| REST (DR) | 162,955 | 148,205 |
| writes | 7,430 | **8,967 (+21%)** |
| เบราว์เซอร์ | 49 | 44 |

🔑 **คำขออ่านนิ่ง/ลดลง แต่งานบันทึกจริงขึ้น 21%** — งานลด egress (cache ทะเบียน · ยุบคำขอซ้ำ)
กำลังทำงาน: ปริมาณคนใช้โตโดยที่ภาระอ่านไม่โตตาม

### สเปค server ที่ควรขอ (ถ้าจะ self-host ขั้น 2)

ฐานคิด: ปัจจุบันรันได้บน **Supabase Micro × 2** (2 vCPU แชร์ · RAM 1 GB ต่อ project)
· พีค ~4.5 คำขอ/วินาทีเฉลี่ย (ชั่วโมงหนาแน่นประมาณ 13–15/วินาที) · 44–49 เบราว์เซอร์พร้อมกัน

| | ขั้นต่ำ | **ที่ควรขอ** | ทำไม |
|---|---|---|---|
| CPU | 4 cores | **8 cores** | ต้องรัน **Postgres 2 ชุด** (ห้ามยุบ) + PostgREST · GoTrue · Realtime · Storage · Kong · Deno ≈ 16–20 container |
| RAM | 16 GB | **32 GB** | ให้ working set อยู่ใน RAM ทั้งก้อน — ฐานข้อมูลปีหน้า ~5–7 GB · Realtime (Elixir) กินแยก |
| ดิสก์ | 250 GB NVMe | **500 GB NVMe** | ข้อมูลปีแรก ~7 GB แต่ต้องบวก WAL + backup ย้อนหลัง 30 วัน + docker image + log |
| สำรอง | — | **เครื่องที่ 2 รับ backup** | เงื่อนไขข้อ 2/ข้อ 4 ข้างบนทำไม่ได้ถ้า backup อยู่เครื่องเดียวกับของจริง |

🔴 **สเปคนี้เผื่อไว้มาก เพราะ RAM/ดิสก์ขอเพิ่มทีหลังยากกว่าขอครั้งเดียว** — ภาระ CPU จริงวันนี้เบามาก
🔴 **ขั้น 2 เท่านั้นที่ตัดค่า Supabase ได้จริง** (ขั้น 1 = static hosting ไม่ลดแม้แต่ไบต์เดียว · ดูตารางข้างบน)
· แต่ผู้ใช้จำนวนมากอยู่นอกโรงงาน (วัดได้ 679 IP เมื่อ 13/10) ⇒ ยังต้องมีทางเข้าจากภายนอก
  **ค่าใช้จ่ายย้ายจาก "บิล Supabase" ไปเป็น "แบนด์วิดท์ขาออกของบริษัท" ไม่ใช่ศูนย์**

### งานลดขนาดที่ยังไม่ได้ทำ (เรียงตามผล)

1. **retention ของ `audit_log`** — ตัดได้ ~90 MB/เดือน (61% ของ DR) · ต้องถาม user ก่อนว่าต้องเก็บกี่เดือน
   (กฎ Traceability บังคับว่าต้องมี audit — **ลบไม่ได้ ต้องย้ายไป schema `archive`**)
2. **กันยิงแจ้งเตือนซ้ำ + เพดานต่อใบ** — ของ 26/10 คือ 12 MB วันเดียว
3. ทบทวนว่า bulk update ทะเบียน (`customer_shipping_orders`/`monitor_cells`) ต้องเขียน audit ทุกครั้งไหม
