-- จังหวะ 1 ของการนำเข้า PE seed เต็มใบ (ดูเหตุผลใน 20260813_pe_seed_p703_full_import_main.sql)
-- pg_net worker ไม่เห็นคิวจนกว่า transaction จะ commit → ต้องแยกไฟล์นี้ออกจากตัว import
create table if not exists public._pe_seed_fetch(rid bigint);
delete from public._pe_seed_fetch;
insert into public._pe_seed_fetch
select net.http_get(
  url := 'https://raw.githubusercontent.com/tsat4pd3-sketch/4Mmanagement/main/docs/sql/pe_seed_p703_full.json',
  timeout_milliseconds := 25000);
