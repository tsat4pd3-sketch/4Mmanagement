-- เลข MO: ต่อหาง "ใบที่เท่าไหร่ของเดือน" + แยกใบออนไลน์ของทีม MTN  (DR · eyhclzkifitbhbljgoav)
-- 2026-10-14 · คำสั่ง user (ต่อจาก 20261014_mtn_mo_no_parity.sql)
--
-- ═══ โจทย์ ═══════════════════════════════════════════════════════════════════
-- user: *"นับต่อไปเรื่อยๆ มีข้อเสียตรงไม่รู้ว่าเป็นใบที่เท่าไหร่ของเดือนนี้รึเปล่า"*
--       → *"เอาแบบ[รายเดือน] แต่ไม่ใช่เอาของเดิมออก แต่เพิ่มเข้าไปได้มั้ย"*
--
-- ⇒ **ต่อหาง `-M<n>` ไม่แตะของเดิม**  `JIG-BM-141026-0014` → `JIG-BM-141026-0014-M8`
--    ได้ครบ: ทีม · ประเภทงาน · วันที่ · เลขรันสะสม · **ใบที่เท่าไหร่ของเดือน**
--    🔑 ข้อดีที่สำคัญที่สุด: **ตัวนับเดิมไม่ถูกรีเซ็ต ⇒ ไม่มีทางออกเลขซ้ำใบเก่า**
--       และใบเก่า (JIG 13 · DIE 14 · PRO 670 ใบ) ไม่ต้อง migrate — แค่ไม่มีหาง = รู้ว่าเป็นใบก่อนเปลี่ยน
--
-- ⇒ **ทีม MTN เติม `O-` นำหน้า** (`O-MTN.2026/10-16`) เพราะทีมยังมีเล่มกระดาษเขียนเลขเองอยู่
--    `O` = ออกจากระบบ · เป็นมาตรการ**ชั่วคราว**ระหว่างทยอยเลิกเล่มมือ
--    (user: *"จะทยอยผลักดันแทนมนวลให้หมดไป เลขจะได้ไม่มีปัญหา"*)
--    ⇒ วันที่เลิกเล่มมือได้ **ถอด `O-` ออกจากที่นี่ + `TEAM_MO_FORMAT` ใน moNumber.js พร้อมกัน**
--    ⚠️ MTN ไม่ต่อหาง `-M<n>` เพราะเลขมีลำดับเดือนอยู่ในตัวแล้ว (`-16`)
--
-- ═══ 🔴 ทำไมต้องเป็น "ตัวนับ" ไม่ใช่ "นับแถวเอา" ════════════════════════════════
-- ถ้าคิดหาง `-M8` ด้วย `count(*) + 1` ของเดือนนั้น จะพังทั้ง 2 ทาง:
--   · 2 ใบที่กดรับงานพร้อมกัน นับได้เลขเดียวกัน ⇒ `-M8` ซ้ำ
--   · ใบที่ถูกลบทำให้ count ขยับ ⇒ ใบถัดไปได้เลขที่เคยใช้ไปแล้ว
--     (วัดจริง 14/10: ทีม MTN มีใบถูก delete ไป 4 ใบ — ดู docs/modules/mtn-work-order.md)
-- ⇒ ใช้แถวตัวนับจริงใน `mtn_mo_seq` คีย์ `<CODE>:M<YYYYMM>` (atomic ด้วย upsert แบบเดียวกับตัวนับหลัก)
--    คีย์นี้ **ไม่ชนกับคีย์รายเดือนของ MTN** (`MTN:202610`) เพราะมี `M` คั่น
--
-- ⚠️ **ย้อนกลับ:** รัน `20261014_mtn_mo_no_parity.sql` ทับ = กลับไปไม่มีหาง/ไม่มี `O-`
--    ใบที่ออกไปแล้วคงเลขเดิม (mo_no เก็บเป็นค่า ไม่ได้คำนวณสด) · แถวตัวนับ `:M` ค้างไว้เฉยๆ ไม่กวนใคร

-- ── 1) เติมตัวนับลำดับเดือนย้อนหลังจากใบที่ออกเลขไปแล้ว ───────────────────────
--    🔴 ขาดขั้นนี้ไม่ได้ — ถ้าตัวนับเริ่มที่ 0 ทั้งที่เดือน ต.ค. ออกไปแล้ว 9 ใบ
--       ใบถัดไปจะได้ `-M1` ทั้งที่เป็นใบที่ 10 ของเดือน = จอโกหกตั้งแต่ใบแรก
--    นับเฉพาะใบที่ "ออกเลขแล้ว" (mo_no ไม่ว่าง) ของทีมที่ต่อหาง (ไม่ใช่ maintenance)
--    ทำทุกเดือนย้อนหลัง เผื่อใบที่ลงวันที่ย้อนหลัง (`report_at` เป็นตัวตัดสินเดือนใน RPC)
insert into public.mtn_mo_seq (team_code, last_seq)
select coalesce(nullif(t.mo_code,''), upper(substr(regexp_replace(o.mtn_dept,'\s','','g'),1,3)))
         || ':M' || to_char(o.report_at at time zone 'Asia/Bangkok', 'YYYYMM'),
       count(*)
  from public.mtn_orders o
  join public.mtn_teams t on t.key = o.mtn_dept
 where coalesce(o.mo_no,'') <> '' and o.mtn_dept <> 'maintenance' and o.report_at is not null
 group by 1
on conflict (team_code) do nothing;   -- มีอยู่แล้ว = ไม่ทับ (กันรันซ้ำแล้วเลขเพี้ยน)

-- ── 2) RPC ออกเลข MO ─────────────────────────────────────────────────────────
create or replace function public.mtn_assign_mo_no(p_order_id uuid, p_prefix text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ymd text; v_seq int; v_no text; v_existing text; v_dept text; v_code text;
  v_key text; v_period text; v_ym text; v_mseq int; v_tail text := '';
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

  /* หาทีมด้วย `key` — `mtn_orders.mtn_dept` เก็บ key ไม่ใช่ dept_name
     กฎถอยต้องตรงกับ `moCodeOf()` ใน src/utils/moNumber.js (ด่าน mo-number-js-sql-parity) */
  select nullif(t.mo_code, '') into v_code from public.mtn_teams t where t.key = v_dept limit 1;
  v_code := coalesce(v_code, upper(substr(regexp_replace(coalesce(v_dept,'MTN'),'\s','','g'),1,3)), 'MTN');

  if v_dept = 'maintenance' then
    /* รีเซ็ตรายเดือน + `O-` นำหน้า (แยกจากเล่มกระดาษที่ทีมเขียนเลขเอง)
       🔴 ลิสต์ทีม + ตัวนำหน้า ต้องตรงกับ TEAM_MO_FORMAT ใน src/utils/moNumber.js */
    v_key := v_code || ':' || v_ym;
    insert into public.mtn_mo_seq(team_code, last_seq) values (v_key, 1)
      on conflict (team_code) do update set last_seq = public.mtn_mo_seq.last_seq + 1, updated_at = now()
      returning last_seq into v_seq;
    v_no := 'O-' || v_code || '.' || v_period || '-' || v_seq::text;
  else
    /* นับต่อเนื่อง (ไม่รีเซ็ต) = ตัวตนของใบ */
    insert into public.mtn_mo_seq(team_code, last_seq) values (v_code, 1)
      on conflict (team_code) do update set last_seq = public.mtn_mo_seq.last_seq + 1, updated_at = now()
      returning last_seq into v_seq;
    /* + ลำดับของเดือน = หาง `-M<n>` · ตัวนับแยกคีย์ `<CODE>:M<YYYYMM>` ⇒ รีเซ็ตเองทุกเดือน
       ไม่ต้องมีใครไปกดรีเซ็ต (ช่องที่ต้องมีคนกดทุกเดือน = ช่องตาย) */
    insert into public.mtn_mo_seq(team_code, last_seq) values (v_code || ':M' || v_ym, 1)
      on conflict (team_code) do update set last_seq = public.mtn_mo_seq.last_seq + 1, updated_at = now()
      returning last_seq into v_mseq;
    if v_mseq is not null and v_mseq > 0 then v_tail := '-M' || v_mseq::text; end if;
    v_no := v_code || '-' || coalesce(nullif(p_prefix,''),'BM') || '-' || v_ymd || '-'
            || lpad(v_seq::text, 4, '0') || v_tail;
  end if;

  update public.mtn_orders set mo_no = v_no, mo_seq = v_seq, updated_at = now() where id = p_order_id;
  return v_no;
end $$;
grant execute on function public.mtn_assign_mo_no(uuid, text) to anon, authenticated;

-- ── คิวรีเช็คผลหลัง apply (ตัวนับลำดับเดือนต้องเท่ากับใบที่ออกไปแล้วของเดือนนั้น) ──
--   select s.team_code, s.last_seq as ตัวนับ,
--          (select count(*) from public.mtn_orders o join public.mtn_teams t on t.key=o.mtn_dept
--             where coalesce(o.mo_no,'')<>'' and o.mtn_dept<>'maintenance'
--               and t.mo_code||':M'||to_char(o.report_at at time zone 'Asia/Bangkok','YYYYMM') = s.team_code
--          ) as ใบที่ออกจริง
--     from public.mtn_mo_seq s where s.team_code like '%:M%' order by s.team_code;
