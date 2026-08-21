-- BBS — แบบฟอร์มสังเกตพฤติกรรมความปลอดภัย (Behavior-Based Safety) · paperless
-- ★ Apply on Main project (ewhdfqwfwofivojtsizn)
--    (อยู่ Main เพราะผูกกับ employees / daily_production_logs / profiles ซึ่งอยู่ Main ทั้งหมด)
--
-- ที่มา: user ส่งไฟล์ฟอร์ม Excel มา 2026-08-21 — "เพิ่มเข้าระบบ + link ข้อมูลกับการตรวจ PPE
-- พนักงาน ดึงลายเซ็นหัวหน้าที่ตรวจใส่ให้พร้อมเลย"
--
-- โครงฟอร์มกระดาษ: 1 ใบ = เดือน × ไลน์/แผนก × กะ · แถว = พนักงาน · คอลัมน์ = วันที่ 1-31
--   ü = พฤติกรรมเหมาะสม · เลข 1-13 = ไม่เหมาะสม (อ้างข้อตกลงข้อนั้น)
--   m = ปรับแก้แล้วหลังผู้ตรวจแนะนำ · û = ไม่ได้ตรวจ (ไม่มาทำงาน/ทำงานนอกบริษัท)
--
-- ⚠️ ข้อความ "ข้อตกลงด้านความปลอดภัย" 13 ข้อในไฟล์ต้นฉบับฝังเป็น OLE object แกะไม่ได้
--    → ทำเป็นตาราง master ให้กรอกเอง (ดีกว่า hardcode อยู่แล้ว — โรงงานอื่นข้อไม่เหมือนกัน)
--    seed เฉพาะ 3 ข้อที่ผูกกับข้อมูล PPE ที่ระบบเก็บจริงได้ · ที่เหลือผู้ใช้เพิ่มเอง
--    **ห้ามเดาข้อความ 10 ข้อที่เหลือ**

/* ── 1) ข้อตกลงด้านความปลอดภัย (ข้อ 1-13) ────────────────────────────────── */
create table if not exists public.bbs_agreements (
  id          uuid primary key default gen_random_uuid(),
  seq         int  not null,                 -- เลขข้อที่พิมพ์ลงช่องในใบ (1-13)
  text        text not null,                 -- "สิ่งที่ควรทำ"
  -- ผูกกับข้อมูลที่ระบบเก็บอยู่แล้ว เพื่อเติมใบให้อัตโนมัติ
  -- ค่าที่รองรับตอนนี้: helmet | boots | gloves (คอลัมน์ใน daily_production_logs)
  -- null = ข้อที่ระบบไม่มีข้อมูล ต้องให้หัวหน้าสังเกตเอง
  auto_source text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists bbs_agree_seq_uniq on public.bbs_agreements (seq) where is_active;

/* ── 2) หัวใบ (1 ใบ = เดือน × ไลน์ × กะ) ─────────────────────────────────── */
create table if not exists public.bbs_sheets (
  id            uuid primary key default gen_random_uuid(),
  month_key     text not null,               -- 'YYYY-MM'
  line_name     text,                        -- ไลน์/พื้นที่ (ตรงกับ production_lines.name)
  section       text,                        -- ส่วนงาน
  dept          text,                        -- แผนก
  shift         text,                        -- day | night | '' (ทั้งวัน)
  -- ผู้ตรวจสอบ + ลายเซ็น — snapshot ตอนบันทึก (คนเปลี่ยนตำแหน่ง/ลาออก ใบเก่าต้องอ่านออก)
  inspector_name text,
  inspector_code text,
  inspector_sig_url text,
  note          text,
  status        text not null default 'open',  -- open | done
  updated_by_name text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists bbs_sheet_uniq
  on public.bbs_sheets (month_key, coalesce(line_name,''), coalesce(shift,''));

/* ── 3) ผลสังเกตรายวัน (1 แถว = พนักงาน × วัน) ───────────────────────────── */
create table if not exists public.bbs_observations (
  id            uuid primary key default gen_random_uuid(),
  sheet_id      uuid not null references public.bbs_sheets(id) on delete cascade,
  employee_id   uuid not null references public.employees(id) on delete cascade,
  day           int  not null check (day between 1 and 31),
  -- ok = ü · ng = เลขข้อ · fixed = m (ปรับแก้แล้ว) · na = û (ไม่ได้ตรวจ)
  mark          text not null check (mark in ('ok','ng','fixed','na')),
  agreement_seq int,                          -- เลขข้อที่ผิด (เมื่อ mark = 'ng')
  note          text,
  -- มาจากไหน: 'ppe' = ระบบเติมจากการตรวจ PPE · 'manual' = หัวหน้ากรอกเอง
  -- ⚠️ ต้องแยกให้ออก — ใบที่เติมอัตโนมัติครอบแค่ PPE ไม่ใช่ครบ 13 ข้อ ห้ามอ้างเกินจริง
  source        text not null default 'manual' check (source in ('ppe','manual')),
  updated_by_name text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists bbs_obs_uniq on public.bbs_observations (sheet_id, employee_id, day);
create index if not exists bbs_obs_sheet_idx on public.bbs_observations (sheet_id);

/* ── RLS — Main project = authenticated (ต่างจากฝั่ง DR ที่เป็น anon) ────── */
alter table public.bbs_agreements   enable row level security;
alter table public.bbs_sheets       enable row level security;
alter table public.bbs_observations enable row level security;

drop policy if exists bbs_agree_read on public.bbs_agreements;
create policy bbs_agree_read on public.bbs_agreements for select to authenticated using (true);
drop policy if exists bbs_agree_write on public.bbs_agreements;
create policy bbs_agree_write on public.bbs_agreements for all to authenticated
  using (public.has_perm('bbs:manage')) with check (public.has_perm('bbs:manage'));

drop policy if exists bbs_sheet_read on public.bbs_sheets;
create policy bbs_sheet_read on public.bbs_sheets for select to authenticated using (true);
drop policy if exists bbs_sheet_write on public.bbs_sheets;
create policy bbs_sheet_write on public.bbs_sheets for all to authenticated
  using (public.has_perm('bbs:record')) with check (public.has_perm('bbs:record'));

drop policy if exists bbs_obs_read on public.bbs_observations;
create policy bbs_obs_read on public.bbs_observations for select to authenticated using (true);
drop policy if exists bbs_obs_write on public.bbs_observations;
create policy bbs_obs_write on public.bbs_observations for all to authenticated
  using (public.has_perm('bbs:record')) with check (public.has_perm('bbs:record'));

/* ── updated_at + audit (ตาราง master ที่แก้ไขได้ ต้องมี audit ตามกฎ) ───── */
do $$ declare t text; begin
  foreach t in array array['bbs_agreements','bbs_sheets','bbs_observations'] loop
    execute format('drop trigger if exists trg_set_updated_at on public.%I', t);
    execute format('create trigger trg_set_updated_at before update on public.%I
                    for each row execute function public.fn_set_updated_at()', t);
  end loop;
  -- audit เฉพาะ master + หัวใบ · ผลสังเกตรายวันมีหลายพันแถว/เดือน ไม่ผูก (กัน audit_log บวม)
  foreach t in array array['bbs_agreements','bbs_sheets'] loop
    execute format('drop trigger if exists trg_audit on public.%I', t);
    execute format('create trigger trg_audit after insert or update or delete on public.%I
                    for each row execute function public.fn_audit()', t);
  end loop;
end $$;

/* ── seed: เฉพาะข้อที่ผูกกับข้อมูล PPE ที่ระบบเก็บจริง ─────────────────────
   ⚠️ 10 ข้อที่เหลือของฟอร์มจริงอ่านจากไฟล์ไม่ได้ (OLE object) — ให้ผู้ใช้เพิ่มเองที่หน้า BBS
      ห้าม seed ข้อความเดา ๆ ลงไป */
insert into public.bbs_agreements (seq, text, auto_source)
values (1, 'สวมใส่หมวกนิรภัยขณะปฏิบัติงาน',      'helmet'),
       (2, 'สวมใส่รองเท้านิรภัยขณะปฏิบัติงาน',   'boots'),
       (3, 'สวมใส่ถุงมือนิรภัยขณะปฏิบัติงาน',    'gloves')
on conflict do nothing;

/* ── สิทธิ์ ────────────────────────────────────────────────────────────────
   ⚠️ กับดัก enum_range: seed ด้วยรายชื่อ role ตรง ๆ (role ที่เพิ่มทีหลังไปติ๊กที่ /permissions)
   bbs:record = บันทึกผลสังเกต/หัวใบ · bbs:manage = แก้ข้อตกลง 13 ข้อ + ลบใบ */
insert into public.permission_catalog (resource, action, label, group_name, sort)
values ('bbs', 'record', 'BBS — บันทึกผลสังเกตพฤติกรรมความปลอดภัย', 'ฝ่ายผลิต', 260),
       ('bbs', 'manage', 'BBS — จัดการข้อตกลงความปลอดภัย / ลบใบ',   'ฝ่ายผลิต', 261)
on conflict do nothing;

insert into public.role_permissions (role, permission_key, allowed)
select r, k, true
from unnest(array['admin','manager','supervisor','leader']::user_role[]) r,
     unnest(array['bbs:record']) k
on conflict (role, permission_key) do nothing;

insert into public.role_permissions (role, permission_key, allowed)
select r, 'bbs:manage', true
from unnest(array['admin','manager','supervisor']::user_role[]) r
on conflict (role, permission_key) do nothing;

-- สิทธิ์ "เห็นแท็บ BBS" = page:/bbs (แท็บใน /daily-checker · route /bbs redirect เข้าแท็บ)
-- ⚠️ seed รายชื่อ role ตรงๆ ห้ามใช้ enum_range · ต้องเพิ่มใน PAGE_GROUPS (PermissionsManagement.jsx) ด้วย
--    ไม่งั้น admin ปรับจาก UI ไม่ได้ (กฎ CLAUDE.md "เพิ่มหน้า/สิทธิ์ใหม่ต้องลงทะเบียน")
insert into public.role_permissions (role, permission_key, allowed)
select r, 'page:/bbs', true
from unnest(array['admin','manager','supervisor','leader','qa','mtn','engineer',
                  'document_control','planner_store','sale','display']::user_role[]) r
on conflict (role, permission_key) do nothing;

/* ── ทะเบียนเอกสาร (กฎ CLAUDE.md: export ใหม่ทุกตัวต้อง register) ─────────
   ยังไม่มีเลขฟอร์มทางการ → form_code = null (หน้าตาเดิมเป๊ะ) doc_control ตั้งเองที่ /doc-forms
   ⚠️ layout_locked = true — ตารางกว้างตามจำนวนวัน (31 คอลัมน์) เปลี่ยนแนวกระดาษแล้วใบพัง */
insert into public.doc_forms (doc_key, title, form_code, rev, paper, paper_size, orientation,
                              layout_locked, used_route, sig_blocks)
values ('bbs_observation', 'แบบฟอร์มสังเกตพฤติกรรมความปลอดภัย (BBS)', null, null,
        'A4 แนวนอน', 'A4', 'landscape', true, '/daily-checker?tab=bbs',
        '["ผู้ตรวจสอบ"]'::jsonb)
on conflict (doc_key) do nothing;

-- Rollback:
--   drop table public.bbs_observations, public.bbs_sheets, public.bbs_agreements;
--   delete from public.doc_forms where doc_key = 'bbs_observation';
--   delete from public.permission_catalog where resource = 'bbs';
--   delete from public.role_permissions where permission_key like 'bbs:%';
