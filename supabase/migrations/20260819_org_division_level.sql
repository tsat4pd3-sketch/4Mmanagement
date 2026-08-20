-- เพิ่มชั้น "ฝ่าย (Division)" เข้าผังองค์กร — single source of truth  (Main project)
--
-- ที่มา: ผังจริง ORG001_TSAT4_Overall Rev.09 (user แนบไฟล์ 2026-08-19) มี 3 ชั้น
--        ฝ่าย → ส่วน → แผนก/กลุ่ม   แต่ `org_nodes` มีแค่ section → department → line
--        ทำให้ "ฝ่ายไหนเป็นเจ้าของงานช่วงนี้" ไม่มีที่เก็บ → หน้าไหนอยากรู้ต้อง hardcode เอง
--        (เกิดขึ้นจริงแล้วที่ /flow-tower ที่ผมเผลอ hardcode ชื่อฝ่ายไว้ในหน้า — ผิดหลักโปรเจค)
--
-- ⚠️ ปลอดภัยกับของเดิม: ตรวจแล้วว่า **ไม่มีโค้ดไหนสมมติว่า section ต้องไม่มี parent_id**
--    ทุกที่กรองด้วย `kind === 'section'` เท่านั้น (sectionScope/laborType/OrgSetup/Register/
--    operator/AddUser/ShiftOrganize/OjtTraining/CostCenterRatePanel) → เพิ่มแม่ให้ section ไม่กระทบ
--
-- ⚠️ ไม่ย้าย/ไม่เปลี่ยน kind ของ node เดิมสักตัว — แค่ "เติมแม่" ให้ section ที่จับคู่ได้ชัดเจน
--    ส่วนที่จับคู่ไม่ได้ปล่อยว่างไว้ให้คนมาตั้งเองที่ /org-setup (ห้ามเดา)
--
-- Rollback: ดูท้ายไฟล์

-- ── 1) ปลดล็อกชนิด 'division' ────────────────────────────────────────────
alter table public.org_nodes drop constraint if exists org_nodes_kind_check;
alter table public.org_nodes add constraint org_nodes_kind_check
  check (kind = any (array['division','section','department','line','team']));

-- ── 2) seed ฝ่ายตามผังจริง Rev.09 ────────────────────────────────────────
-- cost center จากผัง · ตรวจแล้วไม่ชนกับเลขที่ org_nodes ใช้อยู่
insert into public.org_nodes (kind, name, code, cost_center, parent_id, sort_order, is_active)
select v.kind, v.name, v.code, v.cc, null, v.ord, true
from (values
  ('division','ฝ่าย Logistic and Sales','LOG','2140320000', 10),
  ('division','ฝ่าย Engineering',        'ENG','2140340000', 20),
  ('division','ฝ่าย Production',         'PRD','2140360000', 30),
  ('division','ฝ่าย Maintenance',        'MTN','2140456000', 40),
  ('division','ฝ่าย สนับสนุนกลาง',        'SUP', null,        50)
) as v(kind,name,code,cc,ord)
where not exists (select 1 from public.org_nodes o where o.kind='division' and o.name = v.name);

-- ── 3) เติมแม่ให้ section ที่จับคู่กับผังได้ชัดเจนเท่านั้น ──────────────────
-- PD1–PD4 = ส่วนงานผลิต → ฝ่าย Production
update public.org_nodes s
   set parent_id = (select d.id from public.org_nodes d where d.kind='division' and d.code='PRD')
 where s.kind='section' and s.parent_id is null and s.name in ('PD1','PD2','PD3','PD4');

-- Planning&Store (cost 2140429000 = ส่วน Log&Sales/Planning&Store ในผัง) → ฝ่าย Logistic and Sales
update public.org_nodes s
   set parent_id = (select d.id from public.org_nodes d where d.kind='division' and d.code='LOG')
 where s.kind='section' and s.parent_id is null and s.name = 'Planning&Store';

-- ⚠️ TEST และ section อื่นที่จับคู่ไม่ได้ = ปล่อยว่าง ให้คนไปตั้งเองที่ /org-setup
--    (ห้ามเดาว่าอยู่ฝ่ายไหน — ผังจริงเป็นเอกสารควบคุม เดาผิดกระทบ scope/สิทธิ์ทั้งระบบ)

-- ── Rollback ─────────────────────────────────────────────────────────────
-- update public.org_nodes set parent_id = null where kind='section';
-- delete from public.org_nodes where kind='division';
-- alter table public.org_nodes drop constraint org_nodes_kind_check;
-- alter table public.org_nodes add constraint org_nodes_kind_check
--   check (kind = any (array['section','department','line','team']));
