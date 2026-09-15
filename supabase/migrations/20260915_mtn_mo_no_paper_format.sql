/* ═══════════════════════════════════════════════════════════════════════════
   เลข MO ของ **ทีม MTN เท่านั้น** ให้ตรงฟอร์มกระดาษ   (DR)        2026-09-15

   คำสั่ง user: "เปลี่ยนเฉพาะของ MTN ส่วนทีมอื่นยึดตามเดิม"
   กระดาษ: `MTN.2026/06-59`  = <mo_code>.<ค.ศ.>/<เดือน>-<ลำดับในเดือนนั้น>
   ระบบเดิม: `PRO-BM-150926-0343` = <ทีม>-<ชนิดงาน>-<DDMMYY>-<ลำดับสะสมของทีม>

   กติกา:
   • **เฉพาะทีมที่ key = 'maintenance'** (mtn_teams) — JIG/DIE/PRODUCTION ใช้รูปแบบเดิมทุกตัวอักษร
   • ลำดับ **รีเซ็ตทุกเดือน** — เก็บตัวนับใน `mtn_mo_seq` ด้วยคีย์ '<code>:YYYYMM'
     (ไม่ต้องแก้ตาราง · ตัวนับเดิมของทุกทีมไม่ถูกแตะ)
   • เดือน/ปี อ้างจาก `report_at` ตามเวลาไทย (ใบที่แจ้งย้อนหลังได้เลขของเดือนที่แจ้งจริง)
   • **ใบที่ออกเลขไปแล้วไม่ถูกแก้** (ฟังก์ชันคืนเลขเดิมถ้ามีอยู่แล้ว เหมือนเดิม)
   ⚠️ ถ้าโรงงานนับ "ต่อเนื่องทั้งปี" ไม่ใช่รายเดือน ให้เปลี่ยนคีย์ตัวนับเป็น ':YYYY' บรรทัดเดียว

   ย้อนกลับ: create or replace ฟังก์ชันกลับเป็นสูตรเดิม (โค้ดเดิมอยู่ในคอมมิทก่อนหน้า)
   ═══════════════════════════════════════════════════════════════════════════ */
create or replace function public.mtn_assign_mo_no(p_order_id uuid, p_prefix text)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_ymd text; v_seq int; v_no text; v_existing text; v_dept text; v_code text;
  v_key text; v_period text; v_ym text;
begin
  select mo_no, mtn_dept,
         to_char(coalesce(report_at, now()) at time zone 'Asia/Bangkok', 'DDMMYY'),
         to_char(coalesce(report_at, now()) at time zone 'Asia/Bangkok', 'YYYY/MM'),
         to_char(coalesce(report_at, now()) at time zone 'Asia/Bangkok', 'YYYYMM')
    into v_existing, v_dept, v_ymd, v_period, v_ym
  from public.mtn_orders where id = p_order_id;

  -- ออกเลขไปแล้ว = คืนเลขเดิม ห้ามออกซ้ำ (พฤติกรรมเดิม)
  if v_existing is not null and v_existing <> '' then
    return v_existing;
  end if;

  /* ⚠️ ของเดิมหา mo_code ด้วย `dept_name = v_dept` แต่ `mtn_orders.mtn_dept` เก็บ **key**
     ('maintenance'/'jig_maintenance') ส่วน `mtn_teams.dept_name` คือ 'MTN'/'JIG MTN'
     ⇒ **ไม่เคย match เลย** ทุกทีมตกไปใช้ fallback 3 ตัวอักษรแรกมาตลอด
        jig_maintenance → 'JIG' (บังเอิญตรง) · production → 'PRO' (mo_code จริงคือ 'PRD')
        maintenance → 'MAI' ← เลขทีม MTN จะออกเป็น MAI.2026/09-1 ถ้าไม่แก้
     🔴 แก้เฉพาะสาขา MTN — สาขาทีมอื่นคง fallback เดิมเป๊ะ (คำสั่ง user "ทีมอื่นยึดตามเดิม")
        ถ้าไปแก้ทั้งก้อน PRODUCTION จะเปลี่ยนจาก PRO- เป็น PRD- ทันที = เลขไม่ต่อเนื่องกับของเก่า */
  select mo_code into v_code from public.mtn_teams where dept_name = v_dept and mo_code is not null limit 1;
  v_code := coalesce(nullif(v_code, ''), upper(substr(regexp_replace(coalesce(v_dept,'MTN'),'\s','','g'),1,3)), 'MTN');

  if v_dept = 'maintenance' then
    -- ── ทีม MTN: MTN.2026/06-59 (ลำดับรีเซ็ตรายเดือน) ──
    -- ใช้ mo_code จากทะเบียนทีม (หาโดย key) — ตั้งค่าที่ master ได้ ไม่ hardcode
    select coalesce(nullif(t.mo_code, ''), 'MTN') into v_code
      from public.mtn_teams t where t.key = 'maintenance' limit 1;
    v_code := coalesce(v_code, 'MTN');
    v_key := v_code || ':' || v_ym;
    insert into public.mtn_mo_seq(team_code, last_seq) values (v_key, 1)
      on conflict (team_code) do update set last_seq = public.mtn_mo_seq.last_seq + 1, updated_at = now()
      returning last_seq into v_seq;
    v_no := v_code || '.' || v_period || '-' || v_seq::text;
  else
    -- ── ทีมอื่น: รูปแบบเดิมเป๊ะ ──
    insert into public.mtn_mo_seq(team_code, last_seq) values (v_code, 1)
      on conflict (team_code) do update set last_seq = public.mtn_mo_seq.last_seq + 1, updated_at = now()
      returning last_seq into v_seq;
    v_no := v_code || '-' || coalesce(nullif(p_prefix,''),'BM') || '-' || v_ymd || '-' || lpad(v_seq::text, 4, '0');
  end if;

  update public.mtn_orders set mo_no = v_no, mo_seq = v_seq, updated_at = now() where id = p_order_id;
  return v_no;
end $function$;
