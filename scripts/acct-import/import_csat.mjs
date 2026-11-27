/* 📥 นำเข้าไฟล์ V5 %Customer Satisfaction ของ QSM → kpi_csat_scores (MAIN) — ตัวเดียวกับปุ่ม "นำเข้า Customer Satisfaction (V5)" บนเว็บ แต่รันนอกเบราว์เซอร์
   (2026-11-24 · user: "สามารถอัพโหลดเองผ่านโปรแกรมได้รึยัง ละดูเรื่องไพทอนดึงออโต้ด้วย")
   ใช้:  node scripts/acct-import/import_csat.mjs "<TSAT 4 V5 %Customer Satisfaction FY2026 10.Oct - Rev.02.xlsx>" [--year 2026] [--month 10] [--write]
   · ไม่ใส่ --write = dry-run (พิมพ์ตารางรายลูกค้า + ค่ารวมที่ระบบคิด vs ในไฟล์ ไม่เขียนอะไร)
   · ปี/ถึงเดือน อ่านจากชื่อไฟล์ ("FY2026 10.Oct") · --year/--month ทับได้ · เดือนหลัง "ถึงเดือน" ไม่นำเข้า
   · ตัวแกะ = src/utils/csatImport.js (ตัวเดียวกับเว็บ — ห้ามมีตัวแกะชุดที่ 2) · เขียน upsert (unique year,month,customer,kind) ผ่าน REST
   · trigger ฝั่ง DB (kpi_csat_rollup) รวมเป็นตัวแปรฐาน csat_* ระดับ ทั้งโรงงาน ให้เอง
   env สำหรับ --write: SUPABASE_URL + SUPABASE_SERVICE_KEY ของ project MAIN (ewhdfqwfwofivojtsizn) — เหมือน import_base.mjs */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsatBook, csatFileMeta, CSAT_KIND_LABEL } from '../../src/utils/csatImport.js';

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const WRITE = args.includes('--write');
const IS_CLI = Boolean(process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]);
if (IS_CLI && !file) { console.error('usage: import_csat.mjs <V5 Customer Satisfaction .xlsx> [--year 2026] [--month N] [--write]'); process.exit(2); }

export async function loadBook(path) {
  const XLSX = await import('xlsx');
  const book = XLSX.read(readFileSync(path), { type: 'buffer', cellDates: true });
  const grids = {};
  for (const name of book.SheetNames) grids[name] = XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, raw: true, defval: null, blankrows: false });
  return { names: book.SheetNames, grids };
}

export function rowsToPayload(parsed, { year, maxMonth, fileName }) {
  return parsed.rows.filter(x => x.month <= maxMonth).map(x => {
    const b = parsed.bands[`${x.customer}|${x.kind}`] || {};
    return { year, month: x.month, customer: x.customer, kind: x.kind, result: x.result, score: x.score, evaluated: !!x.evaluated,
      grade_a: b.a == null ? null : String(b.a), grade_b: b.b == null ? null : String(b.b), grade_c: b.c == null ? null : String(b.c),
      remark: x.remark || null, source: 'import', source_file: fileName || null, created_by_name: 'csat-import' };
  });
}

async function main() {
  const meta = csatFileMeta(basename(file));
  const year = Number(opt('--year') || meta.year || new Date().getFullYear());
  const book = await loadBook(file);
  const parsed = parseCsatBook(book, { year });
  if (!parsed.sheet) { console.error('❌', parsed.warnings.join(' · ')); process.exit(1); }
  const last = parsed.rows.length ? Math.max(...parsed.rows.map(x => x.month)) : 0;
  const maxMonth = Number(opt('--month') || meta.month || last || 12);
  const payload = rowsToPayload(parsed, { year, maxMonth, fileName: basename(file) });
  console.log(`📄 ${basename(file)} · ชีท ${parsed.sheet} · ปี ${year} · ถึงเดือน ${maxMonth} · ${payload.length} แถว`);
  for (const w of parsed.warnings) console.log('ℹ️ ', w);
  for (const m of parsed.mismatch) console.log(`⚠️  ค่ารวมไม่ตรง ${m.kind} เดือน ${m.month}: ไฟล์ ${m.sheet?.toFixed(2)} / ระบบ ${m.computed?.toFixed(2)}`);
  const custs = [...new Set(payload.map(x => x.customer))];
  const months = [...new Set(payload.map(x => x.month))].sort((a, b) => a - b);
  for (const c of custs) for (const k of ['delivery', 'quality']) {
    const cells = months.map(m => { const x = payload.find(y => y.customer === c && y.kind === k && y.month === m); return x ? (x.evaluated ? `${x.result}(${x.score})` : '*') : '—'; });
    console.log(`  ${c.padEnd(16)} ${CSAT_KIND_LABEL[k].padEnd(10)} ${cells.join('  ')}`);
  }
  for (const k of ['delivery', 'quality', 'overall']) console.log(`  รวม ${k.padEnd(9)} ${months.map(m => (parsed.totals.computed[k][m] == null ? '—' : parsed.totals.computed[k][m].toFixed(2) + '%')).join('  ')}`);
  if (!WRITE) { console.log('\n(dry-run — ใส่ --write เพื่อบันทึก)'); return; }
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) { console.error('❌ ต้องตั้ง SUPABASE_URL + SUPABASE_SERVICE_KEY (project MAIN)'); process.exit(2); }
  const res = await fetch(`${url}/rest/v1/kpi_csat_scores?on_conflict=year,month,customer,kind`, {
    method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(payload),
  });
  const body = await res.text();
  if (!res.ok) { console.error('❌ เขียนไม่สำเร็จ', res.status, body.slice(0, 400)); process.exit(1); }
  const n = (() => { try { return JSON.parse(body).length; } catch { return '?'; } })();
  console.log(`✅ บันทึก ${n} แถว → kpi_csat_scores (trigger รวมเป็น csat_* ให้แล้ว)`);
}
if (IS_CLI) main().catch(e => { console.error('❌', e?.message || e); process.exit(1); });
