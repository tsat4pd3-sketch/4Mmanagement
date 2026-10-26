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
const IS_CLI = Boolean(process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]);
if (IS_CLI && !file) { console.error('usage: import_base.mjs <report.xlsb|.xlsx|grids.json> [--year 2026] [--month N] [--write] [--no-inventory]'); process.exit(2); }

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
/** ปีจากชื่อไฟล์ "… Jan-2026 …" → 2026 (พ.ศ. 2569 → 2026) · ไม่เจอ = null */
export function yearFromFileName(name = '') {
  const m = String(name).match(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*[\s_\-.]*((?:20|25)\d\d)\b/i);
  if (!m) return null;
  const y = Number(m[1]);
  return y > 2400 ? y - 543 : y;
}

/** นำเข้า 1 ไฟล์ — ใช้ทั้ง CLI และ run_queue (GitHub Actions) · คืน { year, upTo, plan, written, failed, notes, lines }
 *  sb = client ฝั่ง MAIN (service role) · ไม่มี = dry-run จากไฟล์อย่างเดียว · write=false = ไม่เขียน */
export async function importBook(book, { fileName = '', year = null, month = null, write = false, sb = null, includeInventory = true, log = console.log } = {}) {
  const y = Number(year || yearFromFileName(fileName) || new Date().getFullYear());
  const fm = month != null ? Number(month) : monthFromFileName(fileName);
  const { values, src, upTo, closed, notes } = collectPlantValues(book, { maxMonth: fm, includeInventory });
  const lines = [];
  const say = (t) => { lines.push(t); log(t); };
  say(`ไฟล์: ${fileName} · ปี ${y} · ถึงเดือน ${upTo || '-'} (${month != null ? 'กำหนดเอง' : fm ? 'จากชื่อไฟล์' : `จากเดือนสุดท้ายที่มียอด = ${closed}`})`);
  notes.forEach(n => say('⚠ ' + n));
  if (!Object.keys(values).length) { say('ไม่พบตัวแปรที่นำเข้าได้'); return { year: y, upTo, plan: [], written: 0, failed: 0, notes, lines, empty: true }; }

  const existing = {};
  if (sb) {
    const { data, error } = await sb.from('kpi_base_inputs').select('id, month, var_key, value').eq('year', y).eq('scope_kind', 'plant');
    if (error) throw new Error('อ่าน kpi_base_inputs ไม่ได้: ' + error.message);
    for (const r of data || []) existing[`${r.var_key}|${r.month}`] = r;
  } else say('(ไม่มี client ฝั่ง MAIN — เทียบกับฐานไม่ได้ · dry-run จากไฟล์อย่างเดียว)');

  const plan = [];
  for (const [k, months] of Object.entries(values)) {
    for (const [m, v] of Object.entries(months)) {
      const ex = existing[`${k}|${m}`];
      const state = !ex ? 'ใหม่' : Math.abs(Number(ex.value) - Number(v)) < 0.005 ? 'เท่าเดิม' : 'เปลี่ยน';
      plan.push({ k, m: Number(m), v, ex: ex?.value ?? null, id: ex?.id ?? null, state, sheet: src[k] });
    }
  }
  plan.sort((a, b) => a.k.localeCompare(b.k) || a.m - b.m);
  for (const p of plan) say(`${p.state.padEnd(8)} ${label(p.k).padEnd(44)} ด.${String(p.m).padStart(2)}  ไฟล์ ${fmt(p.v).padStart(18)}  ฐาน ${fmt(p.ex).padStart(18)}   [${p.sheet}]`);
  const todo = plan.filter(p => p.state !== 'เท่าเดิม');
  say(`รวม ${plan.length} ค่า · ใหม่ ${plan.filter(p => p.state === 'ใหม่').length} · เปลี่ยน ${plan.filter(p => p.state === 'เปลี่ยน').length} · เท่าเดิม ${plan.length - todo.length}`);
  if (!write) { say('dry-run — ไม่เขียน'); return { year: y, upTo, plan, written: 0, failed: 0, notes, lines }; }
  if (!sb) throw new Error('write ต้องมี client ฝั่ง MAIN (SUPABASE_URL + SUPABASE_SERVICE_KEY)');
  let written = 0, failed = 0;
  for (const p of todo) {
    const row = { year: y, month: p.m, scope_kind: 'plant', scope_value: '', var_key: p.k, value: p.v, note: `acct-import ${fileName}`, created_by_name: 'acct-import' };
    const r = p.id
      ? await sb.from('kpi_base_inputs').update({ value: p.v, note: row.note }).eq('id', p.id).select('id')
      : await sb.from('kpi_base_inputs').insert(row).select('id');
    if (r.error || !r.data?.length) { failed++; say(`✗ ${p.k} ด.${p.m}: ${r.error?.message || 'ไม่มีแถวถูกเขียน'}`); } else written++;
  }
  say(`เขียนแล้ว ${written} · ล้ม ${failed}`);
  return { year: y, upTo, plan, written, failed, notes, lines };
}

export async function mainClient() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) return null;
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

async function main() {
  const book = await loadGrids(file);
  const sb = await mainClient();
  const r = await importBook(book, { fileName: basename(file), year: opt('--year'), month: opt('--month'), write: WRITE, sb, includeInventory: !NO_INV });
  if (r.empty) process.exit(1);
  if (WRITE && r.failed) process.exit(1);
}

export { loadGrids };
if (IS_CLI) main().catch(e => { console.error(e); process.exit(1); });
