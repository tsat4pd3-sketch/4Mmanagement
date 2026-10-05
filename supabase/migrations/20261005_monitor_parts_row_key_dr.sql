-- ══ monitor_board_parts: คีย์แถว = MAT + เลขพาร์ท (DR "Product DB" eyhclzkifitbhbljgoav) ══
-- 2026-10-05
--
-- ปัญหา: คีย์เดิม (board_id, mat_no) สมมติว่า "1 MAT = 1 แถว" ซึ่งไฟล์จริงไม่เป็นอย่างนั้น
--   • 300T  — MAT 20059152 มี **2 แถว**: N1WB-E16A416 (BL) คว่ำครีบ / N1WB-E16A417 (BL) หงายครีบ
--             Total SL 2,100 กับ 1,500 ⇒ คนละแถวจริง ยุบไม่ได้
--   • Argen — MAT 20065715 / 20065635 ซ้ำ **เลขพาร์ทเดียวกัน** ค่าทุกช่องที่ทับกันเท่ากันเป๊ะ
--             (256/256 · 192/192) ⇒ เป็นสำเนาในไฟล์ ยุบได้ (ฝั่ง client ยุบก่อนส่ง "ค่าล่างชนะ"
--             🔴 ห้ามรวมยอด — จะกลายเป็น 2 เท่า)
--   อาการที่หน้างานเจอ: นำเข้าไม่ได้ `ON CONFLICT DO UPDATE command cannot affect row a second time`
--   และก่อนนั้น `there is no unique or exclusion constraint matching the ON CONFLICT specification`
--
-- แก้: row_key = mat_no || '|' || part_no เป็นคีย์ · **DB เป็นเจ้าของค่า** (trigger) ไม่ใช่ client
--      เพื่อไม่ให้เพี้ยนเมื่อมีจอแก้ part_no ทีหลัง · ฝั่ง JS มีสูตรเดียวกันที่
--      `src/utils/monitorBoards.js` → `partRowKey()` (มีด่าน regressionGuards คุมให้ตรงกัน)
--
-- ย้อนกลับ (rollback): โค้ดเก่าใช้ onConflict 'board_id,mat_no' ⇒ revert โค้ดก่อน แล้วค่อย
--   create unique index monitor_board_parts_bm_uniq on public.monitor_board_parts (board_id, mat_no);
--   drop index public.monitor_board_parts_rowkey_uniq;
--   drop trigger trg_monitor_parts_row_key on public.monitor_board_parts;
--   (คอลัมน์ row_key ทิ้งไว้ได้ nullable ไม่กระทบของเดิม)
-- ════════════════════════════════════════════════════════════════════════════════════════

alter table public.monitor_board_parts add column if not exists row_key text;

create or replace function public.monitor_parts_set_row_key()
returns trigger language plpgsql as $$
begin
  new.row_key := coalesce(new.mat_no,'') || '|' || coalesce(new.part_no,'');
  return new;
end $$;

drop trigger if exists trg_monitor_parts_row_key on public.monitor_board_parts;

create trigger trg_monitor_parts_row_key
before insert or update of mat_no, part_no on public.monitor_board_parts
for each row execute function public.monitor_parts_set_row_key();

update public.monitor_board_parts
   set row_key = coalesce(mat_no,'') || '|' || coalesce(part_no,'')
 where row_key is distinct from coalesce(mat_no,'') || '|' || coalesce(part_no,'');

create unique index if not exists monitor_board_parts_rowkey_uniq
    on public.monitor_board_parts (board_id, row_key);

-- คีย์เก่าที่ตั้งบนสมมติฐานผิด — ต้องถอด ไม่งั้นแถวที่ 2 ของ MAT เดิมถูกปฏิเสธ
drop index if exists public.monitor_board_parts_bm_uniq;   -- unique (board_id, mat_no)
drop index if exists public.monitor_board_parts_uniq;      -- unique (board_id, mat_no) where mat_no is not null and is_active
drop index if exists public.zz_scratch_probe_idx;          -- index ที่ใช้ทดสอบว่า DROP ผ่าน MCP ไม่ได้ (05/10)
