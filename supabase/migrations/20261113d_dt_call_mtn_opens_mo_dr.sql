-- ══ 📞 กดเรียกช่าง = ต้องมีใบ MO เสมอ  ·  2026-11-13 ══
-- Project: DR (ชื่อในจอ Supabase = "Product DB" · eyhclzkifitbhbljgoav)
-- คำสั่ง user: *"บังคับเลยถ้าเรียกช่าง เพราะข้ามแผนก · อาจจะไม่บังคับใส่รายละเอียดตอนนั้น
--   ทันทีก็ได้ มาใส่ย้อนหลังได้ เป็น tab breakdown รอเพิ่มรายละเอียด MO ·
--   ส่วนที่ไม่เปิด อาจจะแก้ไขได้เอง"*
--
-- ── ที่มา (วัดจริงก่อนทำ) ───────────────────────────────────────────────────────
-- เรียกช่างทั้งหมด 1,072 ครั้ง — มีใบ MO แล้ว 986 (92%) · **ไม่มีใบ 86 ครั้ง** (56 ใน 30 วันล่าสุด)
-- ⇒ กฎนี้เป็น "ตะแกรงกันรั่ว" ไม่ใช่การเปลี่ยนพฤติกรรมใหญ่ · downtime ที่ไม่เรียกช่าง (ผลิตแก้เอง)
--    ไม่ต้องมีใบ ตามคำสั่ง user
--
-- ── ทำไมอยู่ฝั่ง DB ไม่ใช่ฝั่งจอ ─────────────────────────────────────────────────
-- ① "บังคับ" ต้องกันทุกทางเข้า — จอ DailyReport · AI intake ทาง Telegram · สคริปต์ใดๆ ที่เซ็ต call_mtn
-- ② มีด่าน regressionGuards ห้าม `DailyReport.jsx` insert `mtn_orders` เอง (คำสั่ง user 08/11)
--
-- ── 🔴 กฎที่ห้ามแตะ ──────────────────────────────────────────────────────────────
-- 🔴 ใบที่เปิดให้ = **ใบรอเพิ่มรายละเอียด** (`details_pending = true`) ไม่ใช่ใบสมบูรณ์
--    ⇒ ต้องแยกให้เห็นในคิว (กฎเดียวกับ 4M ที่ระบบสร้างเอง — ห้ามเข้าคิวเงียบๆ)
-- 🔴 ธงนี้ **ไม่ใช่ด่าน** — ช่างรับงาน/ซ่อม/ปิดได้ตามปกติ (ไลน์ต้องไม่หยุดรอเอกสาร)
-- 🔴 กันใบซ้ำด้วย `exists` **ห้ามใส่ unique index** บน source_downtime_id — การโยนงานข้ามทีม
--    (`mtn_handoff_new_mo_per_team`) สร้างใบที่ 2 บน source เดิมโดยเจตนา (ของจริง 22 เคส)
-- 🔴 ยิงเฉพาะ "ขอบขึ้น" ของ call_mtn (null/false → true) — แก้แถวทีหลังห้ามสร้างใบซ้ำ
-- 🔴 `purpose = 'repair'` เฉพาะทีม MTN · ทีมอื่น null — ถ้าเผลอใส่ improve/build ใบจะติดด่าน
--    "รอผู้จัดการอนุมัติ" = ไลน์หยุดรอเซ็น (ข้อห้ามชัดในกฎโมดูล MTN work-order)
-- 🔴 `work_date` เอาจาก **ใบกะ** ไม่ใช่นาฬิกา — กะดึกข้ามวัน กดเรียกช่าง 02:00 ต้องเป็นวันงานของกะนั้น
-- 🔴 `machine_no` snap เข้าตัวสะกดในทะเบียนเมื่อ `machine_key()` ชี้ได้ **ตัวเดียวชัดเจน** ·
--    ชนกัน/ไม่เจอ = เก็บค่าที่คนพิมพ์ (ห้ามเดา — กฎ machineNo.js) · ไม่ snap = MTBF/พาเรโตรายเครื่องแตกแท่ง
-- 🔴 **ไม่ backfill ของเก่า 86 ใบ** — งานพวกนั้นซ่อมจบไปแล้ว สร้างย้อนหลัง = ใบเปล่ากองให้ช่างไล่กรอก
--
-- ทดสอบแล้ว (ก้อน DO ที่ roll back ทั้งหมด): ยังไม่เรียก=ไม่มีใบ · เรียก=1 ใบ · กดซ้ำ/แก้แถว=ไม่เกิดใบที่ 2 ·
--   ทีม jig ไม่มี purpose · 'jhyd040507' → 'JHYD04-05-07' · เครื่องนอกทะเบียนเก็บตามที่พิมพ์
--
-- ย้อนกลับ: drop trigger if exists trg_dt_call_mtn_opens_mo on public.downtime_logs;
--           (ใบที่เกิดไปแล้วยังอยู่ปกติ · ธง details_pending ไม่มีผลกับสูตร KPI ใดๆ)
-- เจ้าของกฎฝั่งจอ: src/utils/moDetailsPending.js

create or replace function public.trg_fn_dt_call_mtn_opens_mo()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  v_line text; v_wdate date; v_type text; v_team text; v_note text;
  v_mc text; v_snap text;
begin
  if coalesce(new.call_mtn, false) is not true then return new; end if;
  if tg_op = 'UPDATE' and coalesce(old.call_mtn, false) is true then return new; end if;
  if exists (select 1 from mtn_orders o where o.source_downtime_id = new.id) then return new; end if;

  select s.line_name, s.work_date into v_line, v_wdate
  from production_sessions s where s.id = new.session_id;
  select t.name_th into v_type from dr_downtime_types t where t.id = new.downtime_type_id;

  v_mc := nullif(btrim(coalesce(new.machine_no, '')), '');

  -- ตัวสะกดในทะเบียน — เอาเฉพาะที่ชี้ได้ตัวเดียว (ชนกัน = ไม่แตะ ให้คนลบตัวซ้ำก่อน)
  if v_mc is not null then
    select min(m.machine_no) into v_snap
    from machines m
    where coalesce(m.is_active, true)
      and nullif(btrim(coalesce(m.machine_no, '')), '') is not null
      and public.machine_key(m.machine_no) = public.machine_key(v_mc)
    having count(distinct m.machine_no) = 1;
    if v_snap is not null then v_mc := v_snap; end if;
  end if;

  v_team := nullif(btrim(coalesce(new.call_mtn_team, '')), '');
  v_note := btrim(concat_ws(' ',
    '[Downtime: ' || coalesce(nullif(btrim(v_type), ''), 'ไม่ระบุประเภท') || ']',
    nullif(btrim(coalesce(new.description, '')), '')));

  insert into mtn_orders (
    source_downtime_id, mtn_dept, line_name, machine_no, occurred_at,
    report_at, work_date, reported_by_name, report_note,
    purpose, status, current_step, details_pending
  ) values (
    new.id, coalesce(v_team, 'maintenance'), v_line, v_mc, new.started_at,
    coalesce(new.call_mtn_at, now()), coalesce(v_wdate, public.work_date_bangkok()),
    nullif(btrim(coalesce(new.call_mtn_by, '')), ''), nullif(v_note, ''),
    case when coalesce(v_team, 'maintenance') = 'maintenance' then 'repair' else null end,
    'pending', 1, true
  );
  return new;
end
$$;

drop trigger if exists trg_dt_call_mtn_opens_mo on public.downtime_logs;
create trigger trg_dt_call_mtn_opens_mo
  after insert or update of call_mtn on public.downtime_logs
  for each row execute function public.trg_fn_dt_call_mtn_opens_mo();
