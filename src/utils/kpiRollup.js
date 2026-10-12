/* ── ⬆ รวม KPI ของ "หน่วยลูก" ขึ้นบอร์ดของ "หน่วยแม่" (2026-10-12 · คำสั่ง user) ───────────────────────────
   *"บางอย่างที่ลูกมี แม่ไม่มี ต้องโชว์ที่แม่ด้วย · ส่วนบางอย่างแม่มีลูกไม่มี ลูกไม่ต้องมีได้เพราะเป็น KPI ใหญ่"*
   ทิศทางการตกทอดจึงมี 2 ขา คนละกติกา:
     ↓ แม่ → ลูก : นิยาม/เป้าของแม่ตกทอดให้ลูกเฉพาะ **ช่องมาตรฐาน 8 ช่อง** (`nearest()` ในบอร์ด) · KPI 📌 ของแม่ **ไม่** ไปโผล่ที่ลูก
     ↑ ลูก → แม่ : **แม่ชนะเป็นรายเดือน** (user 12/10: *"แม่มี 2 อยู่แล้ว ลูกกรอก 2 อีก ไม่ใช่ 4 — แม่เป็น 0 เพราะไม่ได้กรอก
                   ค่อยเอา 2 ของลูกมาที่แม่"*) ⇒ เดือนที่แม่กรอกเอง = ค่าแม่ (ของเสียที่แม่รวมไว้แล้ว **ห้ามบวกของลูกซ้ำ**) ·
                   เดือนที่แม่ไม่ได้กรอก (ว่าง — เลข 0 ที่กรอกจริงถือว่ากรอก) = ค่ารวมจากลูก (`fillParentWithChildren`) ·
                   แม่ไม่มี KPI นี้เลย = ทุกเดือนมาจากลูก (แผ่นรวม) · ไม่เขียนลงฐาน
   กติการวม (ตาม `kpi_catalog.summary_mode` ของนิยามลูก):
     · `sum` (ของเสีย/บาท/ครั้ง)        → ผลรวมของลูกที่กรอก · เดือนที่ลูกกรอกไม่ครบทุกใบ = ติด `partial` (จอต้องบอก)
     · อื่นๆ (average/rate/max/as_of)  → **เฉลี่ยไม่ถ่วงน้ำหนัก** (ไม่มียอดดิบให้ถ่วง) · `approx = true` ⇒ จอติด ≈
     · เป้า: sum → ผลรวมเป้าของลูก (ต้องตั้งครบทุกใบ) · อื่นๆ → ใช้ต่อเมื่อลูกทุกใบตั้งเท่ากัน · ไม่งั้น `null` + `targetNote`
       (แม่อยากตัดสินด้วยเป้าของตัวเอง = ตั้งนิยามระดับแม่ที่ ⚙️ แล้วแผ่นรวมจะหายไปเอง เพราะแม่ "ถือ" KPI นี้แล้ว)
     · นิยาม `value_scope='plant'` (ค่าโรงงานร่วม) และแถว `auto:` ไม่เข้ารวม — เป็นค่าชุดเดียวกันอยู่แล้ว / ระบบคำนวณจากไลน์ของแม่เอง
   🔴 pure · ไม่แตะ supabase · เทส `__tests__/kpiRollup.test.mjs` */
import { summaryModeOf, defBars, unitOf, valueScopeOf, boardSlotOf } from './kpiSetup.js';
import { normKpiRowName } from './kpiBoardRows.js';

/** คีย์กลุ่มของนิยาม — ทะเบียนเดียวกันก่อน ไม่มีค่อยเทียบชื่อ (คีย์เดียวกับ `roll:<key>` ของแผ่น/หมายเหตุรายเดือน) */
export const rollupGroupKey = (d) => {
  const cid = d?.catalog_id || d?.kpi_catalog?.id || null;
  return cid ? `cat:${cid}` : `name:${normKpiRowName(d?.kpi_catalog?.name || d?.name)}`;
};

/** จัดกลุ่มนิยามของหน่วยลูก (ตัด auto + ค่าโรงงานร่วม) → Map<groupKey, defs[]> เรียงตาม seq ของใบแรกที่เจอ */
export function groupChildDefs(defs = []) {
  const m = new Map();
  for (const d of defs || []) {
    if (!d || String(d.source || '').startsWith('auto:') || valueScopeOf(d) === 'plant' || d.is_active === false) continue;
    const k = rollupGroupKey(d);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(d);
  }
  return m;
}

const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

/**
 * รวมนิยามลูกหลายใบเป็น "แถวเดียว" ของแม่
 * @param defs          นิยามลูกกลุ่มเดียวกัน (จาก groupChildDefs)
 * @param entriesByDef  { [kpi_id]: { [month]: value } }
 * @param labelOf       (kind, value) => ป้ายหน่วย (ไม่ส่ง = ใช้ scope_value)
 * @returns null เมื่อไม่มีนิยาม · ไม่งั้น { def, entries, coverage, partial, combine, approx, n, targetNote, children }
 */
export function rollupChildDefs(defs = [], entriesByDef = {}, { labelOf = null } = {}) {
  const ds = (defs || []).filter(Boolean);
  if (!ds.length) return null;
  const lead = ds[0];
  const mode = summaryModeOf(lead);
  const combine = mode === 'sum' ? 'sum' : 'average';
  const entries = {}, coverage = {};
  for (let m = 1; m <= 12; m++) {
    const vals = ds.map(d => num(entriesByDef?.[d.id]?.[m])).filter(v => v != null);
    if (!vals.length) continue;
    const total = vals.reduce((a, b) => a + b, 0);
    entries[m] = combine === 'sum' ? total : total / vals.length;
    coverage[m] = { n: vals.length, of: ds.length };
  }
  const bars = ds.map(d => defBars(d));
  const sameAll = (pick) => bars.every(b => pick(b) === pick(bars[0]));
  let target_value = null, commit_value = null, targetNote = '';
  const target_compare = bars.find(b => b.target_compare)?.target_compare || null;
  if (bars.every(b => b.target_value != null)) {
    if (combine === 'sum') target_value = bars.reduce((a, b) => a + b.target_value, 0);
    else if (sameAll(b => b.target_value) && sameAll(b => b.target_compare)) target_value = bars[0].target_value;
    else targetNote = 'เป้าของแต่ละหน่วยลูกไม่เท่ากัน';
  } else {
    targetNote = ds.length > 1 && bars.some(b => b.target_value != null) ? 'หน่วยลูกบางใบยังไม่ตั้งเป้า' : 'หน่วยลูกยังไม่ตั้งเป้า';
  }
  if (target_value != null && bars.every(b => b.commit_value != null)) {
    if (combine === 'sum') commit_value = bars.reduce((a, b) => a + b.commit_value, 0);
    else if (sameAll(b => b.commit_value)) commit_value = bars[0].commit_value;
  }
  const def = {
    id: null, rollup: true,
    name: lead.kpi_catalog?.name || lead.name, kpi_catalog: lead.kpi_catalog || null, catalog_id: lead.catalog_id || null,
    unit: unitOf(lead), decimals: lead.decimals ?? null, category: lead.category || null,
    direction: lead.direction || null, target_value, target_compare, commit_value,
    commit_compare: commit_value != null ? target_compare : null, summary_mode: mode,
  };
  const partial = Object.keys(coverage).map(Number).filter(m => coverage[m].n < coverage[m].of);
  return {
    def, entries, coverage, partial, combine, approx: combine !== 'sum', n: ds.length, targetNote,
    children: ds.map(d => ({ id: d.id, kind: d.scope_kind, value: d.scope_value, label: labelOf ? labelOf(d.scope_kind, d.scope_value) : String(d.scope_value ?? '') })),
  };
}

/** คีย์กลุ่มลูกที่ "ตรงกับแถวนี้ของแม่" — ทะเบียนเดียวกับนิยามแม่ก่อน · แถวช่องมาตรฐาน (ไม่ใช่ def:) เทียบ board_slot แล้วค่อยชื่อ · ไม่มี = null */
export function childGroupKeyFor(groups, row, def = null) {
  if (!(groups instanceof Map) || !groups.size) return null;
  if (def) { const gk = rollupGroupKey(def); if (groups.has(gk)) return gk; }
  if (row?.defId) return null;   // แผ่น 📌 ของแม่ จับคู่ได้ด้วยทะเบียน/ชื่อนิยามเท่านั้น
  for (const [gk, ds] of groups) {
    const lead = ds[0];
    const slot = boardSlotOf(lead);
    if (slot ? slot === row?.key : normKpiRowName(lead.kpi_catalog?.name || lead.name) === normKpiRowName(row?.name)) return gk;
  }
  return null;
}

/** 🔴 แม่ชนะเป็นรายเดือน · ลูกเติมเฉพาะเดือนที่แม่ "ไม่ได้กรอก" (null/'' — เลข 0 ที่กรอกจริง = กรอกแล้ว) · ไม่มีการบวกแม่+ลูก
 *  @returns { entries, filled: [เดือนที่เติมจากลูก], covered: [เดือนที่แม่กรอกเองและลูกก็มี — ของลูกไม่ถูกใช้] } */
export function fillParentWithChildren(parentEntries = {}, roll = null) {
  const entries = {}, filled = [], covered = [];
  for (let m = 1; m <= 12; m++) {
    const p = num(parentEntries?.[m]);
    const c = roll?.entries?.[m];
    if (p != null) { entries[m] = p; if (c != null) covered.push(m); }
    else if (c != null) { entries[m] = c; filled.push(m); }
  }
  return { entries, filled, covered };
}
