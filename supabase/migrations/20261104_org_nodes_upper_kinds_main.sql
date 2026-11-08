-- ── Main project "MAIN" (ewhdfqwfwofivojtsizn) ──
-- 🏢 ผังองค์กรรับ "ชั้นบน" ของโรงงาน: company_group → spg → company → plant (2026-11-04)
--
-- ที่มา: template Com Code + ไฟล์ Activity Rate 2027 ของกลุ่ม (03/11) ⇒ ผังจริง = Group (TSG) → SPG → Company (SAP 4 หลัก) → Plant → ส่วนงาน
--   เรา = TSAT (SAP 2100 · Com Code 210) ใต้ SPG 2000 AMF · plant 2140 = TSAT-P4
-- ขั้นนี้ = **เปิดช่องรับเท่านั้น ยังไม่เติมแถว** — ฝั่งโค้ดเลิกถือว่า "ราก = ส่วนงาน" แล้ว (src/utils/orgLayers.js · ด่าน org-upper-layers-ready)
-- 🔴 ห้าม insert โหนดชั้นบนจนกว่าจอที่โหลดแค่ section/department (OjtTraining · operator · Register) จะส่งผังทั้งต้นให้ orphanDepts()
-- ย้อนกลับ: ลบแถว kind ชั้นบน (ถ้ามี) แล้ว
--   alter table public.org_nodes drop constraint org_nodes_kind_check;
--   alter table public.org_nodes add constraint org_nodes_kind_check check (kind in ('section','department','line','team'));

alter table public.org_nodes drop constraint if exists org_nodes_kind_check;
alter table public.org_nodes add constraint org_nodes_kind_check
  check (kind = any (array['company_group','spg','company','plant','section','department','line','team']));

comment on column public.org_nodes.kind is
  'ชั้นบน: company_group → spg → company → plant (ยังไม่เติม · 04/11) · ชั้นหน่วย: section → department → line → team · กฎ src/utils/orgLayers.js';
