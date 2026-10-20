-- 2026-10-20 · DR ("Product DB" eyhclzkifitbhbljgoav) · apply แล้วผ่าน MCP 20/10
-- คิวไฟล์จากเมลรับ "ชนิด" — demand (EDI 830/862 เดิม) | acct (monthly report ของบัญชี → ตัวเลขฐาน KPI ฝั่ง MAIN)
-- + สถานะ failed สำหรับตัวนำเข้าอัตโนมัติ (GitHub Actions acct-import) ที่อ่านไฟล์ไม่ได้ — ต้องเห็นบนจอ ไม่ใช่ค้าง pending เงียบ
-- ย้อนได้: แถวเดิมทั้งหมด kind='demand' (default) · จอ planner-sales กรอง kind='demand' เท่านั้น
alter table public.demand_mail_inbox add column if not exists kind text not null default 'demand';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'demand_mail_inbox_kind_check') then
    alter table public.demand_mail_inbox add constraint demand_mail_inbox_kind_check check (kind in ('demand', 'acct'));
  end if;
end $$;
alter table public.demand_mail_inbox drop constraint if exists demand_mail_inbox_status_check;
alter table public.demand_mail_inbox add constraint demand_mail_inbox_status_check check (status in ('pending', 'imported', 'skipped', 'failed'));
create index if not exists demand_mail_inbox_kind_status_idx on public.demand_mail_inbox (kind, status, received_at desc);
-- ตรวจ: select kind, status, count(*) from public.demand_mail_inbox group by 1,2;
