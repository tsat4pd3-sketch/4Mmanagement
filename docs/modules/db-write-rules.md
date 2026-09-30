# หลักฐาน/ตัวเลขเบื้องหลัง "กฎเหล็กการเขียน DB จาก client"

> กฎอยู่ใน `CLAUDE.md` §กฎเหล็กการเขียน DB จาก client (11 ข้อ) — ไฟล์นี้เก็บ**ของที่วัดได้จริง**
> ที่เคยอยู่ใน CLAUDE.md แล้วทำให้ไฟล์ชนเพดาน 120 KB (ย้ายออก 2026-09-25 · ตัวกฎไม่ถูกตัดแม้แต่ข้อเดียว)

## ข้อ 3 — RLS ที่ hardcode role array แคบกว่าสิทธิ์บนจอ

วัดจริง 2026-09-04 · 5 ตารางที่ policy hardcode `admin/mgr/sv`:
`machine_points` · `machine_flow_links` · `wip_buffer_points` · `skill_sub_items` · `shift_merge_events`
— แคบกว่าสิทธิ์ที่หน้า `/permissions` แจกให้จริง (`dept_admin` · `sale`/`mtn`/`planner_store` ·
`document_control`) ⇒ **คนเหล่านี้เห็นปุ่มแต่เขียนได้ 0 แถว โดยไม่มี error**

และ `operator_special_tasks` **ไม่มี UPDATE policy เลย** ⇒ เปลี่ยนงานนอกไลน์ของคนเดิมพัง `42501` ทุก role

แก้ด้วย migration `20260904_rls_match_ui_permissions.sql`

## ข้อ 7-8 — realtime/poll ที่ไม่มีเพดาน

audit เต็ม: `docs/POLLING-AUDIT-2026-09-15.md`

- `debounce(reload, 1500)` = "รอให้เงียบ 1.5 วิ" ซึ่ง **วันทำงานจริงไม่มีช่วงเงียบ**
  ⇒ จอโหลดใหม่ทุกครั้งที่ใครก็ตามในโรงงานแตะข้อมูล **ไม่มีขีดจำกัดบน**
- `setTimeout(load, 400)` ต่อ event ยิ่งแย่ — แต่ละ event ตั้งนาฬิกาของตัวเอง = N event N โหลด
- realtime message ~200 bytes เฉพาะตอนมีของเปลี่ยน — **ถูกกว่า poll ทั้งก้อนเป็นร้อยเท่า**
- audit 15/09: **11 จอมี realtime แล้ว เขียนคนละแบบทั้ง 11 จอ และไม่มีจอไหนมีเพดานจริงเลย**
  ⇒ จึงทำ `useLiveBoard()` ให้ประกอบมาแล้วทั้งชุด

## ข้อ 11 — egress

audit เต็ม: `docs/EGRESS-AUDIT-2026-09-17.md` · `mtn_orders` มี **116 คอลัมน์**
⇒ `select('*')&limit=1000` = **1.59 MB/ครั้ง** = เกือบครึ่งของ egress ฝั่ง DR จากคิวรีเดียว
· รูปผัง PNG (lossless) = **8.4 MB/ใบ**
