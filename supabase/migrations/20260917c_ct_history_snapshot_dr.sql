/*  ═══════════════════════════════════════════════════════════════════════════════════════
    เฟส 0 ของ Adaptive CT — "รู้ว่าตอนนั้น CT เป็นเท่าไหร่"
    project: DR / "Product DB"  (eyhclzkifitbhbljgoav)          วันที่: 2026-09-17
    ═══════════════════════════════════════════════════════════════════════════════════════

    ทำไมต้องมีก่อนทุกอย่าง (บทเรียนสดๆ จาก 17/09):
      พยายาม backfill %P ย้อนหลังแบบคำนวณใหม่ **แล้วทำไม่ได้** เพราะ CT เปลี่ยนไปแล้ว
      และไม่มีใครรู้ว่าตอนปิดกะนั้นใช้ CT เท่าไหร่ ⇒ จำลองด้วย CT วันนี้ตรงกับที่ stamp ไว้แค่ 27-44%
      หลักฐาน: 09/09 มีคนแก้ CT ตระกูล Assy LWR จาก 58 → 54 ทั้งชุด (11 MAT รวดเดียว)
      ⇒ กะก่อนหน้านั้นทั้งหมดถูก stamp ด้วย 58 แต่คำนวณใหม่วันนี้จะได้ 54
      ⇒ **ถ้าเปิด adaptive CT โดยไม่เก็บ snapshot = OEE เดือนนี้เทียบเดือนที่แล้วไม่ได้เลย
         และจะไม่มีใครรู้ตัวด้วย**

    ── ของ 3 ชิ้นใน migration นี้ ────────────────────────────────────────────────────────
    1) `production_sessions.ct_snapshot` (jsonb) — CT ที่ **ใช้จริงตอน stamp OEE** ต่อ MAT
       รูปแบบ: {"10105769": 54, "10105770": 54}   · null = กะเก่าก่อนมีฟีเจอร์นี้ (backward-compatible)
    2) view `v_ct_history` — อ่านประวัติการเปลี่ยน CT จาก `audit_log` ให้เป็นตาราง
       **ไม่สร้างตารางใหม่** — audit_log ผูก dr_products อยู่แล้วตั้งแต่ 30/07 (กฎ: ห้ามทำทะเบียนซ้อน)
    3) ฟังก์ชัน `ct_sec_at(mat_no, ts)` — CT ของพาร์ทนั้น ณ เวลาที่ระบุ (ไล่ย้อนจากค่าปัจจุบัน)
       ⚠️ **คืน null เมื่อ ts เก่ากว่าวันที่ audit เริ่มเก็บ (2026-07-30)** — ตอบไม่ได้ต้องบอกว่าไม่รู้
          ห้ามเดา (กฎ "ห้ามล้มเหลวเงียบ")

    ไม่กระทบของเดิม: คอลัมน์ใหม่ nullable ไม่มี default · view/function เป็นของใหม่ล้วน
    ── ROLLBACK ────────────────────────────────────────────────────────────────────────────
      drop function if exists ct_sec_at(text, timestamptz);
      drop view if exists v_ct_history;
      alter table production_sessions drop column if exists ct_snapshot;
    ═══════════════════════════════════════════════════════════════════════════════════════ */

begin;

-- 1) snapshot ของ CT ที่ใช้ตอนปิดกะ ────────────────────────────────────────────────────
alter table production_sessions add column if not exists ct_snapshot jsonb;
comment on column production_sessions.ct_snapshot is
  'CT (วินาที) ที่ใช้จริงตอน stamp OEE ของกะนี้ ต่อ MAT.NO — {"mat_no": ct_sec} · null = กะเก่าก่อน 17/09/2026 · เขียนโดย DailyReport ตอนปิดกะ/แก้เวลากะ · ใช้คำนวณ %P ย้อนหลังซ้ำได้แม้ CT ใน master เปลี่ยนไปแล้ว';

-- 2) ประวัติการเปลี่ยน CT (อ่านจาก audit_log ที่มีอยู่แล้ว ไม่สร้างตารางซ้อน) ───────────
create or replace view v_ct_history as
select a.changed_at,
       a.actor,
       coalesce(a.new_data->>'mat_no', a.old_data->>'mat_no')     as mat_no,
       coalesce(a.new_data->>'name',   a.old_data->>'name')       as product_name,
       coalesce(a.new_data->>'line_name', a.old_data->>'line_name') as line_name,
       nullif(a.old_data->>'cycle_time_sec','')::numeric          as ct_old,
       nullif(a.new_data->>'cycle_time_sec','')::numeric          as ct_new,
       a.row_pk
  from audit_log a
 where a.table_name = 'dr_products'
   and a.changed_fields @> array['cycle_time_sec']
   and a.old_data->>'cycle_time_sec' is distinct from a.new_data->>'cycle_time_sec';

comment on view v_ct_history is
  'ประวัติการเปลี่ยน Cycle Time ของสินค้า — อ่านจาก audit_log (เริ่มเก็บ 2026-07-30) ห้ามสร้างตารางประวัติซ้อน';

-- 3) CT ณ เวลาหนึ่ง — ไล่ย้อนจากค่าปัจจุบันด้วยประวัติ ───────────────────────────────────
create or replace function ct_sec_at(p_mat_no text, p_at timestamptz)
returns numeric
language sql
stable
as $$
  with cover as (            -- audit เริ่มเก็บ dr_products เมื่อไหร่ (ก่อนหน้านั้น = ตอบไม่ได้)
    select min(changed_at) as since from audit_log where table_name = 'dr_products'
  ),
  nxt as (                   -- การเปลี่ยนครั้งแรก "หลัง" เวลาที่ถาม → old_data คือค่า ณ เวลานั้น
    select h.ct_old
      from v_ct_history h
     where h.mat_no = p_mat_no and h.changed_at > p_at
     order by h.changed_at asc
     limit 1
  ),
  cur as (                   -- ไม่มีการเปลี่ยนหลังจากนั้น = ยังเป็นค่าปัจจุบัน
    select max(p.cycle_time_sec)::numeric as ct
      from dr_products p
     where p.mat_no = p_mat_no and p.cycle_time_sec > 0
  )
  select case
           -- เก่ากว่าวันที่ audit เริ่มเก็บ = ตอบไม่ได้เสมอ ต่อให้มีประวัติหลังจากนั้นก็ตาม
           -- (ระหว่างนั้นอาจมีการแก้ที่ไม่ถูกบันทึก) — ห้ามเดา ต้องบอกว่าไม่รู้
           when p_at < (select since from cover) then null
           when exists (select 1 from nxt)       then (select ct_old from nxt)
           else (select ct from cur)
         end;
$$;

comment on function ct_sec_at(text, timestamptz) is
  'CT (วินาที) ของ MAT.NO นั้น ณ เวลาที่ระบุ · คืน null เมื่อตอบไม่ได้ (เวลาเก่ากว่าที่ audit เริ่มเก็บ 2026-07-30 และไม่มีประวัติคร่อม) — ห้ามเดา';

commit;

/* ── ตรวจผลหลังรัน ─────────────────────────────────────────────────────────────────────
-- ประวัติ CT ล่าสุด 10 รายการ
select changed_at, actor, mat_no, product_name, ct_old, ct_new from v_ct_history
 order by changed_at desc limit 10;

-- เคสจริง: 10105769 ถูกแก้ 58 → 54 เมื่อ 09/09 ⇒ ก่อนหน้านั้นต้องได้ 58 · หลังจากนั้น 54
select ct_sec_at('10105769', '2026-09-01'::timestamptz) as ควรได้_58,
       ct_sec_at('10105769', '2026-09-15'::timestamptz) as ควรได้_54,
       ct_sec_at('10105769', '2026-07-01'::timestamptz) as ควรได้_null;
-- ผลรันจริง 17/09: 58 · 54 · null ✅  (FENDER: 01/09 → 50 · 10/09 → 53 ✅)
─────────────────────────────────────────────────────────────────────────────────────── */
