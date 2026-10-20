/* 📥 นำเข้าตัวเลขฐาน KPI จากไฟล์ monthly report ของบัญชี — ตัวเดียวกับปุ่ม "นำเข้าจาก Excel บัญชี" บนเว็บ แต่รันนอกเบราว์เซอร์
   (2026-10-20 · user: "ทำตัวอ่านไว้รอในเว็บ แล้วจะทำระบบไปอ่านเมลออโต้และอัพโหลดให้ แบบ 830/862")
   ขั้นนี้ = ท่อครึ่งหลัง (ไฟล์ → ตัวเลขฐาน) · ครึ่งแรก (เมล → ไฟล์) ยังรอ user เคาะว่าเมลอะไร/รันที่ไหน

   ใช้:  node scripts/acct-import/import_base.mjs <report.xlsb|.xlsx|grids.json> [--year 2026] [--month 1] [--write] [--no-inventory]
   · ไม่ใส่ --write = dry-run เสมอ (พิมพ์ตารางเทียบ "ค่าในไฟล์ vs ค่าในฐาน" ไม่เขียนอะไร)
   · .xlsb อ่านผ่าน python3 -I read_xlsb.py (pyxlsb) · .xlsx อ่านด้วย xlsx (ตัวเดียวกับเว็บ)
   · "ถึงเดือน" = --month > เดือนในชื่อไฟล์ ("… Jan-2026 …") > เดือนสุดท้ายที่ยอดขาย/กำลังคน > 0 — เดือนที่ยังไม่ปิดในไฟล์เป็น 0 ห้ามเขียน
   · เขียน = ระดับ ทั้งโรงงาน เท่านั้น (scope_kind='plant', scope_value='') · update ตาม id / insert · **ไม่ upsert** (unique index เป็น expression · CLAUDE.md)
   · ค่า 0 จากไฟล์ไม่เขียน (ไฟล์ใช้ 0 แทน "ยังไม่ปิด") · ค่าเท่าเดิมข้าม · ชีทสต็อกให้แค่ inventory_baht (COGS/RM ของชีทนั้นคนละฐานกับ PL)
   env สำหรับ --write: SUPABASE_URL + SUPABASE_SERVICE_KEY ของ project MAIN (ewhdfqwfwofivojtsizn) */
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { detectMonthColumns, detectVarRows, extractValues, limitMonths, monthFromFileName, lastClosedMonth, sheetKind, rollingMonths } from '../../src/utils/kpiBaseImport.js';
import { KPI_BASE_VARS } from '../../src/utils/kpiSetup.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const WRITE = args.includes('--write');
const NO_INV = args.includes('--no-inventory');
if (!file) { console.error('usage: import_base.mjs <report.xlsb|.xlsx|grids.json> [--year 2026] [--month N] [--write] [--no-inventory]'); process.exit(2); }

/* ── 1) อ่านไฟล์เป็นตาราง ── */
async function loadGrids(path) {
  if (/\.json$/i.test(path)) return JSON.parse(readFileSync(path, 'utf8'));
  if (/\.xlsb$/i.test(path)) {
    const tmp = mkdtempSync(join(tmpdir(), 'acct-'));
    const out = join(tmp, 'grids.json');
    const r = spawnSync('python3', ['-I', join(HERE, 'read_xlsb.py'), path, out], { encoding: 'utf8' });
    if (r.status !== 0) { rmSync(tmp, { recursive: true, force: true }); throw new Error('read_xlsb.py ล้ม: ' + (r.stderr || r.stdout)); }
    const g = JSON.parse(readFileSync(out, 'utf8'));
    rmSync(tmp, { recursive: true, force: true });
    return g;
  }
  const XLSX = await import('xlsx');
  const book = XLSX.read(readFileSync(path), { type: 'buffer', cellDates: true });
  const grids = {};
  for (const name of book.SheetNames) grids[name] = XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, raw: true, defval: null, blankrows: false });
  return { names: book.SheetNames, grids };
}

/* ── 2) ตัวเลขฐานระดับโรงงานจากทุกชีทที่รู้จัก — PL Summary ชนะ · Manpower เติม manpower · Inventory เติม inventory_baht ── */
export function collectPlantValues(book, { maxMonth = null, includeInventory = true } = {}) {
  const found = {}; const src = {}; const notes = [];
  const order = [...book.names].sort((a, b) => (/pl\s*summary/i.test(b) ? 1 : 0) - (/pl\s*summary/i.test(a) ? 1 : 0));   // PL Summary ก่อน
  let closed = null;
  for (const name of order) {
    const g = book.grids[name];
    const mc = detectMonthColumns(g);
    if (!mc || !Object.keys(mc.cols).length) continue;
    const kind = sheetKind(g, name);
    if (kind === 'inventory' && !includeInventory) continue;
    const vr = detectVarRows(g, { sheetName: name, monthCols: mc.cols });
    if (!Object.keys(vr).length) continue;
    const all = extractValues(g, { varRows: vr, monthCols: mc.cols, multiplier: 1 });
    const lc = lastClosedMonth(all);
    if (lc != null && (closed == null || lc < closed)) closed = lc;
    const roll = rollingMonths(mc.how);
    if (roll.length) notes.push(`${name}: เดือน ${roll.join(',')} ไม่มีคอลัมน์ ACTUAL ใช้ Rolling`);
    for (const [k, months] of Object.entries(all)) {
      if (found[k]) continue;                         // ชีทแรกที่เจอชนะ (PL Summary มาก่อน)
      found[k] = months; src[k] = name;
    }
  }
  const upTo = maxMonth ?? closed ?? 0;
  const out = {};
  for (const [k, months] of Object.entries(found)) {
    const keep = {};
    for (const [m, v] of Object.entries(months)) {
      if (Number(m) > upTo) continue;
      if (v == null || Number(v) === 0) continue;     // 0 = ยังไม่ปิดเดือน (number format โชว์ "-")
      keep[m] = v;
    }
    if (Object.keys(keep).length) out[k] = keep;
  }
  return { values: out, src, upTo, closed, notes };
}

const label = (k) => KPI_BASE_VARS.find(v => v.key === k)?.label || k;
const fmt = (v) => (v == null ? '–' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 }));

async function main() {
  const book = await loadGrids(file);
  const year = Number(opt('--year') || new Date().getFullYear());
  const fm = opt('--month') ? Number(opt('--month')) : monthFromFileName(basename(file));
  const { values, src, upTo, closed, notes } = collectPlantValues(book, { maxMonth: fm, includeInventory: !NO_INV });
  console.log(`ไฟล์: ${basename(file)} · ปี ${year} · ถึงเดือน ${upTo || '-'} (${opt('--month') ? 'จาก --month' : fm ? 'จากชื่อไฟล์' : `จากเดือนสุดท้ายที่มียอด = ${closed}`})`);
  notes.forEach(n => console.log('⚠ ' + n));
  if (!Object.keys(values).length) { console.log('ไม่พบตัวแปรที่นำเข้าได้'); process.exit(1); }

  let existing = {};
  let sb = null;
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
    const { createClient } = await import('@supabase/supabase-js');
    sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const { data, error } = await sb.from('kpi_base_inputs').select('id, month, var_key, value').eq('year', year).eq('scope_kind', 'plant');
    if (error) { console.error('อ่าน kpi_base_inputs ไม่ได้:', error.message); process.exit(1); }
    for (const r of data || []) existing[`${r.var_key}|${r.month}`] = r;
  } else console.log('(ไม่มี SUPABASE_URL/SUPABASE_SERVICE_KEY — เทียบกับฐานไม่ได้ · dry-run จากไฟล์อย่างเดียว)');

  const plan = [];
  for (const [k, months] of Object.entries(values)) {
    for (const [m, v] of Object.entries(months)) {
      const ex = existing[`${k}|${m}`];
      const state = !ex ? 'ใหม่' : Math.abs(Number(ex.value) - Number(v)) < 0.005 ? 'เท่าเดิม' : 'เปลี่ยน';
      plan.push({ k, m: Number(m), v, ex: ex?.value ?? null, id: ex?.id ?? null, state, sheet: src[k] });
    }
  }
  plan.sort((a, b) => a.k.localeCompare(b.k) || a.m - b.m);
  for (const p of plan) console.log(`${p.state.padEnd(8)} ${label(p.k).padEnd(44)} ด.${String(p.m).padStart(2)}  ไฟล์ ${fmt(p.v).padStart(18)}  ฐาน ${fmt(p.ex).padStart(18)}   [${p.sheet}]`);
  const todo = plan.filter(p => p.state !== 'เท่าเดิม');
  console.log(`\nรวม ${plan.length} ค่า · ใหม่ ${plan.filter(p => p.state === 'ใหม่').length} · เปลี่ยน ${plan.filter(p => p.state === 'เปลี่ยน').length} · เท่าเดิม ${plan.length - todo.length}`);
  if (!WRITE) { console.log('dry-run — ใส่ --write เพื่อเขียน (ต้องมี SUPABASE_URL + SUPABASE_SERVICE_KEY)'); return; }
  if (!sb) { console.error('--write ต้องมี SUPABASE_URL + SUPABASE_SERVICE_KEY'); process.exit(1); }
  let ok = 0, fail = 0;
  for (const p of todo) {
    const row = { year, month: p.m, scope_kind: 'plant', scope_value: '', var_key: p.k, value: p.v, note: `acct-import ${basename(file)}`, created_by_name: 'acct-import' };
    const r = p.id
      ? await sb.from('kpi_base_inputs').update({ value: p.v, note: row.note }).eq('id', p.id).select('id')
      : await sb.from('kpi_base_inputs').insert(row).select('id');
    if (r.error || !r.data?.length) { fail++; console.error(`✗ ${p.k} ด.${p.m}: ${r.error?.message || 'ไม่มีแถวถูกเขียน'}`); } else ok++;
  }
  console.log(`เขียนแล้ว ${ok} · ล้ม ${fail}`);
  if (fail) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(e => { console.error(e); process.exit(1); });
