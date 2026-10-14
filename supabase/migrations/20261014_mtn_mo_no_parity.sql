-- เลข MO — เก็บของที่ deploy ไปแล้วลงรีโป + ปิดระเบิดเวลา "เลขรีสตาร์ท"  (DR · eyhclzkifitbhbljgoav)
-- 2026-10-14 · ตรวจเจอตอน user ถามเรื่องเลข MO manual ของทีม MTN
--
-- ═══ 2 เรื่องที่ migration นี้แก้ ════════════════════════════════════════════════
--
-- 1) 🔴 **ของที่ deploy ไปแล้วแต่ไม่มีในรีโป** — RPC ตัวจริงบน DB ออกเลขรีเซ็ตรายเดือน
--    ให้ทีม MTN (`MTN.2026/10-14`) มาตั้งแต่ ~15/09 แต่ไฟล์ล่าสุดในรีโป
--    (`20260724_mtn_mo_per_team.sql`) ยังเป็นเวอร์ชันเก่า ⇒ ใครอ่านรีโปเข้าใจผิดหมด
--    (วัดจริง 14/10: `mtn_mo_seq` มีคีย์ `MTN:202609`=14 · `MTN:202610`=14 ซึ่งไฟล์เก่าสร้างไม่ได้)
--    ⇒ ไฟล์นี้คือ "ของจริง" ที่รันอยู่ + ส่วนที่แก้ด้านล่าง
--
-- 2) 🔴 **ระเบิดเวลา: RPC หาทีมด้วยคอลัมน์ผิด**
--    เดิม: `where dept_name = v_dept` แต่ `mtn_orders.mtn_dept` เก็บ **key** (`'production'`)
--    ไม่ใช่ `dept_name` (`'PRODUCTION'`) ⇒ **ไม่เคย match เลยสักทีม** ⇒ ตกไปใช้กฎถอย
--    "3 ตัวแรกของ key" ทุกครั้ง:
--        production → `PRO`  (แต่ทะเบียนตั้ง `mo_code='PRD'` ไว้!)
--        jig_maintenance → `JIG` · die_maintenance → `DIE`  (ถูกเพราะบังเอิญตรง)
--    ⇒ วันที่ใครไปแก้ทะเบียนให้ `dept_name` match ขึ้นมา (หรือแก้โค้ดให้หาถูกคอลัมน์)
--      เลข production จะกระโดดจาก `PRO-…-0708` ไป **`PRD-…-0001`** = รีสตาร์ทจาก 1
--      ทั้งที่ออกไปแล้ว 708 ใบ · เลขซ้ำกับของเก่าทันที
--
--    แก้: ตั้ง `mo_code` ของ production กลับเป็น `PRO` (= ของที่ออกจริง 670 ใบ) **ก่อน**
--         แล้วค่อยเปลี่ยน RPC ให้หาด้วย `key`
--    ⇒ ผลลัพธ์ของทุกทีม **เหมือนเดิมเป๊ะ** ไม่มีใบไหนได้เลขต่างจากเดิม (ดูคิวรีพิสูจน์ท้ายไฟล์)
--
-- ⚠️ **ย้อนกลับ:** migration นี้ไม่แตะข้อมูลใบ และไม่แตะตัวนับ — revert ได้ด้วยการรัน
--    `20260724_mtn_mo_per_team.sql` ทับ **แต่ต้องตั้ง `mo_code='PRD'` คืนด้วย** ถึงจะได้พฤติกรรมเดิม
--    (ถ้าไม่ตั้งคืน ก็ยังออกเลข `PRO` เหมือนเดิมอยู่ดี เพราะกฎถอยให้ผลเดียวกัน)

-- ── 1) ทะเบียนรหัสทีมต้องตรงกับเลขที่ออกไปแล้วจริง ────────────────────────────
--    🔴 ห้ามแก้ค่าพวกนี้ให้ต่างจากเลขที่ออกไปแล้ว = ตัวนับคนละตัว = เลขรีสตาร์ท
update public.mtn_teams set mo_code = 'PRO' where key = 'production' and coalesce(mo_code,'') <> 'PRO';

-- ── 2) RPC ออกเลข MO (ของจริงที่รันอยู่ + แก้ให้หาทีมด้วย key) ─────────────────
create or replace function public.mtn_assign_mo_no(p_order_id uuid, p_prefix text)
returns text
language plpgsql
security definer
set search_path = public
as $$
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

  -- idempotent — ใบหนึ่งออกเลขครั้งเดียวตลอดชีพ (ทีมที่รับช่วงต่อใช้เลขเดิม)
  if v_existing is not null and v_existing <> '' then
    return v_existing;
  end if;

  /* 🔴 หาทีมด้วย `key` — `mtn_orders.mtn_dept` เก็บ key ไม่ใช่ dept_name
     (เดิมเทียบ dept_name จึงไม่เคย match แล้วตกกฎถอยทุกครั้ง · ดูหัวไฟล์)
     กฎถอยยังอยู่ สำหรับทีมใหม่ที่ยังไม่ตั้ง mo_code — ตรรกะต้องตรงกับ `moCodeOf()`
     ใน src/utils/moNumber.js (มีด่าน mo-number-js-sql-parity) */
  select nullif(t.mo_code, '') into v_code from public.mtn_teams t where t.key = v_dept limit 1;
  v_code := coalesce(v_code, upper(substr(regexp_replace(coalesce(v_dept,'MTN'),'\s','','g'),1,3)), 'MTN');

  /* ทีมที่ใช้ฟอร์มกระดาษแบบ "เลขรีเซ็ตรายเดือน" — ตัวนับแยกคีย์ต่อเดือน (`MTN:202610`)
     ⇒ เลขรีเซ็ตเองโดยไม่ต้องมีใครไปกดรีเซ็ตทุกต้นเดือน (ช่องที่ต้องมีคนกดทุกเดือน = ช่องตาย)
     🔴 ลิสต์ทีมต้องตรงกับ MONTHLY_TEAM_KEYS ใน src/utils/moNumber.js */
  if v_dept = 'maintenance' then
    v_key := v_code || ':' || v_ym;
    insert into public.mtn_mo_seq(team_code, last_seq) values (v_key, 1)
      on conflict (team_code) do update set last_seq = public.mtn_mo_seq.last_seq + 1, updated_at = now()
      returning last_seq into v_seq;
    v_no := v_code || '.' || v_period || '-' || v_seq::text;
  else
    insert into public.mtn_mo_seq(team_code, last_seq) values (v_code, 1)
      on conflict (team_code) do update set last_seq = public.mtn_mo_seq.last_seq + 1, updated_at = now()
      returning last_seq into v_seq;
    v_no := v_code || '-' || coalesce(nullif(p_prefix,''),'BM') || '-' || v_ymd || '-' || lpad(v_seq::text, 4, '0');
  end if;

  update public.mtn_orders set mo_no = v_no, mo_seq = v_seq, updated_at = now() where id = p_order_id;
  return v_no;
end $$;
grant execute on function public.mtn_assign_mo_no(uuid, text) to anon, authenticated;

-- ── คิวรีพิสูจน์ว่า "รหัสที่ทะเบียนบอก" = "รหัสที่ออกไปแล้วจริง" ทุกทีม ───────────
-- ต้องได้ ok = true ทุกแถว (ทีมที่ยังไม่เคยออกเลข = ยกเว้น)
--   select t.key, t.mo_code,
--          (select split_part(o.mo_no,'-',1) from public.mtn_orders o
--             where o.mtn_dept = t.key and o.mo_no like '%-%-%-%' order by o.report_at desc limit 1) as ออกจริง,
--          coalesce((select split_part(o.mo_no,'-',1) from public.mtn_orders o
--             where o.mtn_dept = t.key and o.mo_no like '%-%-%-%' order by o.report_at desc limit 1) = t.mo_code, true) as ok
--     from public.mtn_teams t where t.is_active order by t.sort_order;
