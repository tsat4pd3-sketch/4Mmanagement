-- ⚡ Project: DR ("Product DB" · eyhclzkifitbhbljgoav) — 2026-11-24 คำสั่ง user "แก้ให้ลบอัตโนมัติตอนกดผูกด้วย"
-- ผูก topic (insert / แก้ / เปิดใช้ใน energy_meter_topics) ⇒ ลบแถวค้างใน energy_topic_unmapped ทันที:
--   ① topic ตัวเดียวกัน  ② ค่ารายเฟส v1-v3/a1-a3 ของตู้เดียวกัน (ingest v9 ผูกตามพี่น้องให้เองอยู่แล้ว)
-- ไม่ผูกจริง (is_active = false) = ไม่ลบ · ทำที่ DB ⇒ ครอบทุกทางที่ผูก (หน้าจอ · SQL)
-- ย้อน: drop trigger trg_energy_topic_mapped_clear on public.energy_meter_topics;
--       drop function public.fn_energy_topic_mapped_clear();
create or replace function public.fn_energy_topic_mapped_clear()
 returns trigger language plpgsql as $function$
declare
  pre text := regexp_replace(new.topic, '/[^/]+$', '');
begin
  if new.is_active is distinct from false and new.topic is not null then
    delete from public.energy_topic_unmapped u
     where u.topic = new.topic
        or (pre <> new.topic
            and u.topic in (pre || '/v1', pre || '/v2', pre || '/v3', pre || '/a1', pre || '/a2', pre || '/a3'));
  end if;
  return new;
end $function$;

drop trigger if exists trg_energy_topic_mapped_clear on public.energy_meter_topics;
create trigger trg_energy_topic_mapped_clear
  after insert or update of topic, is_active on public.energy_meter_topics
  for each row execute function public.fn_energy_topic_mapped_clear();
