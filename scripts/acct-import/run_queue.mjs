/* 🤖 acct-import — หยิบไฟล์บัญชีจากคิวเมล (DR `demand_mail_inbox` kind='acct') → เขียนตัวเลขฐาน KPI ฝั่ง MAIN (2026-10-20)
   ครึ่งแรกของท่อ: Outlook บนเครื่อง user (`tools/outlook-mail-ingest` กฎ [mail.acct]) → Edge Function ingest-demand-mail → Storage `demand-mail` + คิว
   ครึ่งหลัง (ที่นี่ · รันโดย GitHub Actions `.github/workflows/acct-import.yml` ทุกวันช่วงวันที่ 10-21 + กดเองได้):
     1. อ่านคิว pending kind=acct (เก่าสุดก่อน) 2. โหลดไฟล์ด้วย service role ของ DR 3. importBook() ชุดเดียวกับ CLI/เว็บ
     4. เขียน kpi_base_inputs (MAIN) 5. ปิดแถวคิว imported + สรุปใน note · อ่านไม่ได้/เขียนล้ม = failed + เหตุผล (ไม่ค้าง pending เงียบ)
   env: DR_SUPABASE_URL · DR_SUPABASE_SERVICE_KEY (คิว+ไฟล์) · SUPABASE_URL · SUPABASE_SERVICE_KEY (MAIN · kpi_base_inputs)
   · DRY_RUN=1 = ไม่เขียน ไม่ปิดคิว (ไว้ทดสอบ) */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { loadGrids, importBook, mainClient } from './import_base.mjs';

const need = (k) => { const v = process.env[k]; if (!v) { console.error(`::error::ยังไม่ได้ตั้ง secret ${k}`); process.exit(2); } return v; };
const DRY = process.env.DRY_RUN === '1';
const dr = createClient(need('DR_SUPABASE_URL'), need('DR_SUPABASE_SERVICE_KEY'));
const main = await mainClient();
if (!main) { console.error('::error::ยังไม่ได้ตั้ง SUPABASE_URL / SUPABASE_SERVICE_KEY (MAIN)'); process.exit(2); }

const { data: rows, error } = await dr.from('demand_mail_inbox')
  .select('id, file_name, storage_path, subject, sender, received_at, size_bytes')
  .eq('kind', 'acct').eq('status', 'pending').order('received_at', { ascending: true }).limit(10);
if (error) { console.error('::error::อ่านคิวไม่ได้: ' + error.message); process.exit(1); }
if (!rows?.length) { console.log('คิวว่าง — ไม่มีไฟล์บัญชีรอนำเข้า'); process.exit(0); }
console.log(`คิว: ${rows.length} ไฟล์`);

let bad = 0;
for (const row of rows) {
  console.log(`\n═══ ${row.file_name} · ${row.subject || ''} · ${row.received_at || ''}`);
  const tmp = mkdtempSync(join(tmpdir(), 'acctq-'));
  let status = 'imported', note = '';
  try {
    const { data: blob, error: dErr } = await dr.storage.from('demand-mail').download(row.storage_path);
    if (dErr || !blob) throw new Error('โหลดไฟล์ไม่ได้: ' + (dErr?.message || 'empty'));
    const buf = Buffer.from(await blob.arrayBuffer());
    if (row.size_bytes && buf.length !== row.size_bytes) throw new Error(`ขนาดไฟล์ไม่ตรง (คิว ${row.size_bytes} · ได้ ${buf.length})`);
    const local = join(tmp, row.file_name.replace(/[^\w.\- ()]/g, '_'));   // คงชื่อเดิมไว้ให้ monthFromFileName/yearFromFileName อ่านเดือน/ปี
    writeFileSync(local, buf);
    const book = await loadGrids(local);
    const r = await importBook(book, { fileName: row.file_name, write: !DRY, sb: main });
    if (r.empty) { status = 'failed'; note = 'ไม่พบตัวแปรที่นำเข้าได้ (โครงไฟล์ไม่ตรงที่รู้จัก)'; }
    else if (r.failed) { status = 'failed'; note = `เขียนล้ม ${r.failed} ค่า · สำเร็จ ${r.written}`; }
    else note = `acct-import ${new Date().toISOString().slice(0, 16)}Z · ปี ${r.year} ถึงเดือน ${r.upTo} · เขียน ${r.written} ค่า (ใหม่ ${r.plan.filter(p => p.state === 'ใหม่').length} · เปลี่ยน ${r.plan.filter(p => p.state === 'เปลี่ยน').length} · เท่าเดิม ${r.plan.filter(p => p.state === 'เท่าเดิม').length})`;
  } catch (e) {
    status = 'failed'; note = String(e?.message || e).slice(0, 400);
    console.error('✗ ' + note);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
  if (status === 'failed') bad++;
  if (DRY) { console.log(`[dry-run] จะปิดแถวเป็น ${status}: ${note}`); continue; }
  const { data: up, error: uErr } = await dr.from('demand_mail_inbox')
    .update({ status, note, handled_by: 'github-actions/acct-import', handled_at: new Date().toISOString() }).eq('id', row.id).select('id');
  if (uErr || !up?.length) { console.error(`::error::ปิดแถวคิว ${row.id} ไม่ได้: ${uErr?.message || '0 แถว'}`); bad++; }
  else console.log(`→ ${status}: ${note}`);
}
process.exit(bad ? 1 : 0);
