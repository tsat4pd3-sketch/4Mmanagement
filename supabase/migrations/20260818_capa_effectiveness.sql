-- ═══ วัดประสิทธิผล 8D/CAPA จากข้อมูลจริง · Main project ═══
-- 2026-08-18 · เฟส 4 ของลูปปิด 8D → PE (docs/CLOSED-LOOP-8D-PE.md)
--
-- IATF 16949 §10.2.4 บังคับให้ "ทวนสอบว่ามาตรการแก้ไขได้ผลจริง"
-- เดิมระบบมีแค่ qa_capa.effectiveness (ข้อความที่คนพิมพ์เอง) — auditor ถามว่า
-- "รู้ได้ยังไงว่าได้ผล" แล้วตอบไม่ได้ เพราะไม่มีตัวเลขผูกกับข้อความนั้น
--
-- migration นี้เพิ่มแค่ "ตัวแปรของการวัด" + "ผลที่ stamp ตอนปิด"
-- ตัวเลขจริงคำนวณสดจาก defect_logs ฝั่ง DR (ไม่ copy ข้อมูลข้าม project)

-- ── ตัวแปรของการวัด (คนตั้ง) ──────────────────────────────────────────────
-- ⚠️ pivot = "วันที่มาตรการมีผลจริง" ไม่ใช่ closed_at
--    ใบมักถูกปิดหลังมาตรการมีผลไปแล้วหลายสัปดาห์ (รอผลติดตาม) → ใช้วันปิดจะวัดคร่อมช่วงผิด
alter table public.qa_capa add column if not exists d6_effective_from date;
alter table public.qa_capa add column if not exists eff_window_days   int not null default 30;

-- เกณฑ์ว่าจะวัด "ของเสียประเภทไหน" — id ของ dr_defect_types ฝั่ง DR project
-- ⚠️ ข้าม project จึงไม่มี FK · เก็บ label เป็น snapshot ด้วย (master ฝั่งโน้นเปลี่ยนชื่อได้)
--    ว่าง = วัดของเสียทุกประเภทของพาร์ทนั้น (กว้างกว่า แต่ถูกรบกวนจากอาการอื่น)
alter table public.qa_capa add column if not exists eff_defect_type_id    text;
alter table public.qa_capa add column if not exists eff_defect_type_label text;

-- ── ผลที่ stamp ตอนปิดใบ (ไม่คำนวณใหม่ย้อนหลัง) ───────────────────────────
-- หลักเดียวกับ OEE ที่ stamp ตอนปิดกะ: ค่าที่เปลี่ยนได้ ห้ามเอาไปตอบคำถามย้อนหลัง
-- (ของเสียถูกแก้ไข/เพิ่มทีหลังได้ ถ้าคำนวณสดทุกครั้ง ใบที่ปิดไปแล้วจะเปลี่ยนคำตอบเองเงียบๆ)
alter table public.qa_capa add column if not exists eff_verdict     text
  check (eff_verdict is null or eff_verdict in
    ('effective','partial','not_effective','worse','too_early','no_baseline','no_data','no_pivot'));
alter table public.qa_capa add column if not exists eff_measured_at timestamptz;
alter table public.qa_capa add column if not exists eff_snapshot    jsonb;  -- ตัวเลขก่อน/หลัง ณ วันปิด

comment on column public.qa_capa.d6_effective_from is 'วันที่มาตรการแก้ไข (D6) มีผลจริงหน้างาน — จุดตัดของการวัดก่อน/หลัง';
comment on column public.qa_capa.eff_verdict      is 'ผลวัดประสิทธิผลที่ stamp ตอนปิดใบ — ห้าม recompute ย้อนหลัง';

create index if not exists qa_capa_eff_idx on public.qa_capa (eff_verdict, closed_at desc);

-- ⚠️ ไม่เพิ่ม permission key ใหม่ — ใช้ qa:record (ตั้งค่าการวัด) + qa:manage (ปิดใบ)
--    เลี่ยงกับดัก seed enum_range ที่ทำให้ role ใหม่เข้าไม่ได้แบบ fail-closed
