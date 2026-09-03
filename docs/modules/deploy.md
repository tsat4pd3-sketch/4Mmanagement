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

### PWA — เพิ่มลงหน้าจอโฮม เปิดเหมือนแอป (2026-07-23)

รองรับ "เพิ่มลงหน้าจอโฮม" (iOS Safari / Android Chrome) เปิดแบบ standalone (เต็มจอ ไม่มีแถบ browser มีไอคอนเอง) เหมาะจอหน้าไลน์/มือถือหัวหน้า
- **manifest-only ตั้งใจ ไม่มี service worker** — เพราะ SW ที่ cache asset จะชนกับ **version-guard/auto-reload** ใน `main.jsx` + no-cache header ใน `render.yaml` (กลไกกัน "จอดำหลัง deploy" — ดู 3 กับดักด้านล่าง) · ถ้าจะเพิ่ม offline/auto-install-prompt (Android banner) ต้องเขียน SW แบบ **network-only ห้าม cache HTML/chunk** ไม่งั้นแอปค้างเวอร์ชันเก่า
- ไฟล์: `public/manifest.webmanifest` (name/short_name ESM, display standalone, theme/bg `#080f08`) + icons `public/icon-192.png`/`icon-512.png`/`icon-maskable-512.png`/`apple-touch-icon.png` (180 — iOS ต้อง PNG ไม่รับ SVG) · ต้นฉบับไอคอน `public/app-icon.svg` (โลโก้ TS + ESM บนพื้นเขียวเข้ม) · gen จาก TS logo ผ่าน Chromium (สร้างใหม่: rasterize `app-icon.svg` → PNG ขนาดที่ต้องการ)
- `index.html` `<head>` มี `<link rel=manifest>` + `theme-color` + `apple-touch-icon` + `apple-mobile-web-app-*` (status-bar-style = `default` กันเนื้อหาทับ notch) — **ห้ามถอด**
- **เปลี่ยนโลโก้/ไอคอน** → แก้ `app-icon.svg` แล้ว rasterize ใหม่ทับ PNG ทั้ง 4 ไฟล์ (ขนาดเดิม) · เปลี่ยนชื่อไฟล์ไอคอนต้องอัพเดท manifest + index.html ด้วย
- **Badge จุดแดง/เลขบนไอคอนแอป (2026-07-23):** `NotificationBell` (App.jsx) sync `navigator.setAppBadge(unread)`/`clearAppBadge()` ตามจำนวนแจ้งเตือนที่ยังไม่อ่าน (ตาราง `notifications`) · **guard `'setAppBadge' in navigator`** · ✅ Android/desktop Chrome-Edge (ติดตั้ง PWA) · ❌ **iOS ไม่รองรับ App Badging API** (Apple ยังไม่ทำ — iPhone จะไม่เห็นเลขบนไอคอน) · อัปเดต**เฉพาะตอนเปิดแอป**เท่านั้น (ไม่มี service worker/Web Push → ปิดแอปแล้วไม่เด้ง) · ล้าง badge ตอน logout/unmount · ถ้าจะให้เด้งตอนปิดแอป (เหมือน LINE) ต้องเพิ่ม SW network-only + Web Push VAPID (ยังไม่ทำ)
- **เสียงแจ้งเตือน (2026-07-30):** `NotificationBell` เล่นเสียง chime (Web Audio — `playNotifChime()` ใน App.jsx, ไม่ต้องมีไฟล์เสียง) ตอนมี notification ใหม่เข้ามาแบบ realtime (INSERT — initial load ไม่เล่น) · prime AudioContext ตอน gesture แรก (เบราว์เซอร์บล็อกเสียงจนกว่าจะมี user interaction) · ปุ่ม 🔔/🔕 ในหัว dropdown เปิด/ปิดเสียง จำที่ `localStorage['esm-notif-sound']` (`off`=ปิด) · **ทำงานเฉพาะตอนเปิดแอปอยู่**
- **กดแจ้งเตือนในกระดิ่ง = เปิดหน้าที่เกี่ยวข้อง (2026-08-25 · feedback หน้างาน "เปิด MO แล้วอยากให้ช่างรับงานได้ทันที"):** แถวที่มี `ref_table` → mark อ่าน + navigate ตาม **`NOTIF_ROUTE`** ใน App.jsx (mtn_orders→`/mtn-repair` · four_m_logs→`/event-log` · downtime_logs→`/daily-report`) + ลูกศร › ท้ายแถวบอกว่ากดได้ · **ปลายทางผ่าน `canAccessPage` ก่อนเสมอ** (ไม่มีสิทธิ์ = mark อ่านเฉยๆ ไม่พาไปแล้วโดนเด้ง — กฎเดียวกับ telemetry หน้า Home) · **⚠️ `NOTIF_ROUTE` ต้อง mirror กับ `routeFor()` ใน edge `send-push` เสมอ** (Web Push กับกระดิ่งต้องพาไปหน้าเดียวกัน — แก้ฝั่งไหนตามไปแก้อีกฝั่ง)
- **Web Push — เด้งเข้ามือถือแม้ปิดแอป (เฟส B · 2026-07-30):** เพิ่ม service worker `public/sw.js` (**push + notificationclick เท่านั้น ไม่มี fetch handler ไม่ cache อะไร** — จงใจ กันชน version-guard/no-cache · register production-only ใน `main.jsx`) · VAPID keys เก็บใน `notification_settings` (คอลัมน์ `vapid_public/private/subject` — เหมือน bot_token, RLS on ไม่มี policy = อ่านได้เฉพาะ service role · ค่าจริง**ไม่อยู่ใน migration** set ผ่าน execute_sql) · ฝั่งเว็บดึง public key ผ่าน RPC `get_vapid_public_key()` · subscription เก็บ `push_subscriptions` (RLS ของ user เอง) · **trigger `trg_notify_push` (notifications AFTER INSERT) → pg_net ยิง edge `send-push` อัตโนมัติทุก row** (best-effort ไม่ทำ insert หลักพัง) → ทุกอย่างที่เขียน `notifications` = เด้ง push ให้เอง · edge `send-push` (Deno + `npm:web-push`, verify_jwt=false) อ่าน VAPID + subscriptions ของ user ส่ง push · 404/410 = ลบ subscription หมดอายุ · migration `20260730_web_push.sql` · **ทุกอย่าง free tier** (push service ของ browser ฟรี, VAPID ฟรี, edge function ฟรี) · util ฝั่งเว็บ `src/utils/webpush.js` · ปุ่ม "📲 เปิด" อยู่ในหัว dropdown กระดิ่ง
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
