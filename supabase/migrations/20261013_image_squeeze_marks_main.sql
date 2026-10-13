-- ทะเบียน "ตรวจแล้ว ไม่ต้องบีบ" ของแผงบีบรูป (Main project · ewhdfqwfwofivojtsizn)
-- ⚠️ APPLY แล้วผ่าน MCP 2026-10-13 · ไฟล์นี้เก็บไว้ให้ session อื่นเห็นประวัติ ไม่ต้องรันซ้ำ
--
-- ปัญหาที่ปิด (user: "ทำไมบีบแล้วก็ยังค้างว่ายังไม่ได้บีบอีก 495"):
--   คิวของ `src/utils/recompressLayouts.js` = "ทุกแถวที่ path ไม่ใช่ .webp"
--   ไฟล์จะหลุดคิวได้ทางเดียวคือ "ถูกแปลงเป็น .webp จริง" — แต่ 493/495 ใบถูก **ตั้งใจไม่แตะ**
--   (เล็กกว่าเกณฑ์อยู่แล้ว / บีบแล้วไม่เล็กลงเกิน 20%) ⇒ มันไม่เคยเปลี่ยนสภาพ ⇒ **ค้างในคิวตลอดกาล**
--   ซ้ำร้าย: ใบที่ใหญ่กว่าเกณฑ์ HEAD จะถูก **ดาวน์โหลดเต็มก้อนใหม่ทุกครั้งที่กด** เพื่อไปรู้ว่า
--   "บีบไม่ลง" เหมือนเดิม — รูปพนักงาน 271 ใบ เฉลี่ย 66 KB ≈ **18 MB ต่อการกด 1 ครั้ง ฟรีๆ**
--   บนหน้าที่ตั้งมาเพื่อ "ลด egress" โดยเฉพาะ
--   (เป็นกับดักเดียวกับกฎข้อ 5 ในหัวไฟล์ recompressLayouts.js ซึ่งแก้ไว้เฉพาะเคส .webp)
--
-- ⇒ จำ "คำตัดสินถาวร" ไว้ที่นี่ — ตรวจแล้วไม่ต้องบีบ = ไม่ต้องเข้าคิวอีก ไม่ต้องโหลดอีก
-- 🔑 ต้องเป็นตารางกลาง (ไม่ใช่ localStorage) เพราะ admin คนละเครื่องต้องเห็นเลขเดียวกัน

create table if not exists public.image_squeeze_marks (
  bucket      text not null,
  path        text not null,
  verdict     text not null,                       -- 'small' (เล็กกว่าเกณฑ์) | 'no_gain' (บีบแล้วไม่เล็กลงพอ)
  bytes       bigint,                              -- ขนาดที่วัดได้ตอนตรวจ (ไว้ดูย้อนหลัง)
  checked_at  timestamptz not null default now(),
  -- 🔑 PK คอลัมน์ล้วน = PostgREST infer onConflict ของ upsert ได้ (db-write-rules ข้อ 3)
  primary key (bucket, path)
);

alter table public.image_squeeze_marks enable row level security;

-- อ่าน: เปิดให้ authenticated ทุกคน — แผงนี้ "ดูได้แต่กดไม่ได้" สำหรับคนไม่มีสิทธิ์
-- ถ้ารัดการอ่านด้วย has_perm ด้วย คนที่ดูอย่างเดียวจะเห็นตัวเลข "เหลือ" พองผิดความจริง
create policy image_squeeze_marks_read on public.image_squeeze_marks
  for select to authenticated using (true);

-- เขียน: คีย์เดียวกับปุ่มบนจอ (ImageSqueezePanel — `canRun` = can('storage_maintain:run'))
create policy image_squeeze_marks_write on public.image_squeeze_marks
  for all to authenticated
  using ((select public.has_perm('storage_maintain:run')))
  with check ((select public.has_perm('storage_maintain:run')));
