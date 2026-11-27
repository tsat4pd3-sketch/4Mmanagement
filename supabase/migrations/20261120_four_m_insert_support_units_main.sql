-- ── Main project "MAIN" (ewhdfqwfwofivojtsizn) ──
-- 🔐 four_m_insert: หน่วยสนับสนุนที่ "ออกใบ 4M ให้ไลน์ผลิต" เป็นงานปกติ ต้องไม่ถูก DB บล็อก (2026-11-20 · hotfix หลัง deploy)
--
-- ที่มา: migration 20261113_role_scope_p1 ตั้ง `four_m_insert with check (app_can_write_line(line_name))`
--   จำลองสิทธิ์จริงหลัง deploy (20/11 16:40): หัวหน้าไลน์/หัวหน้าส่วนผลิตผ่านทุกคน **แต่ QA 13 บัญชี · ช่าง (mtn) 15 ·
--   หัวหน้าส่วน QA/Planning&Store/Maintenance · ผจก. QA = false** บนไลน์ผลิต — เพราะบ้าน/CC ของเขาคือหน่วยสนับสนุน
--   ⇒ QA check sheet (QaCheckSheet.jsx) ที่ออกใบ 4M ให้ไลน์ที่ตรวจ จะโดน 42501 ทั้งที่ฝั่งจอผ่าน (`qaWriteCtx` ให้ QA
--   เป็น all-units บนจอคุณภาพ) — ขัดกติกา §2 ของ migration เดิมเอง: "ตาข่ายชั้นสอง ห้ามเข้มกว่าจอ"
-- กฎ: สร้างใบ 4M ได้ถ้า (ก) ไลน์อยู่ในขอบเขตแก้ของตัวเอง **หรือ** (ข) ถือคีย์งานข้ามไลน์ที่ออกใบ 4M เป็นปกติ
--   · `qa:record` (QA check sheet / ใบตรวจ) · `mtn_repair:service` (ช่างเปลี่ยนเครื่อง/อะไหล่ = 4M Machine)
--   ขั้นอนุมัติ (update) ไม่แตะ — ยังเป็น approve_sv ในขอบเขต / approve_qa / manage_docs / reset เหมือนเดิม
-- ย้อนกลับ: drop policy four_m_insert; create policy four_m_insert on public.four_m_logs for insert to authenticated
--   with check (public.app_can_write_line(line_name));

drop policy if exists four_m_insert on public.four_m_logs;
create policy four_m_insert on public.four_m_logs for insert to authenticated
  with check (
    public.app_can_write_line(line_name)
    or (select public.has_perm('qa:record'))
    or (select public.has_perm('mtn_repair:service'))
  );

-- ตรวจผล (จำลอง JWT ของ QA แล้วลอง): select set_config('request.jwt.claims','{"sub":"<uuid QA>"}',true), public.has_perm('qa:record');  -- true
