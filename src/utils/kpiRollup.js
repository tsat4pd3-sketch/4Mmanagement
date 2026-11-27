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
import { summaryModeOf, defBars, unitOf, valueScopeOf, boardSlotOf, formulaOf, evalFormula, baseVarOf } from './kpiSetup.js';
import { formulaOfDef } from './kpiFormula.js';
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
/* ⬆ วิธีรวมข้ามหน่วย (25/11 · user: "ค่าที่ไม่ใช่ของส่วนกลางระดับโรงงาน ควรรวมระดับส่วนทั้งหมดที่มีข้อมูลมาโชว์ เช่น DL-OH, inventory")
   ทะเบียน `kpi_catalog.rollup_mode` ตั้งเองได้ (sum | average | formula) · ว่าง = อัตโนมัติ:
     · นิยามรางสูตร (provider=formula)         → `formula` = **Σ ตัวตั้งของทุกหน่วยที่มีข้อมูล ÷ ค่ากลางโรงงาน** แล้วคิดสูตรใหม่ (ตัวตั้งรวม ÷ ตัวหารรวม — ห้ามเฉลี่ย %)
     · summary_mode = sum                      → `sum`
     · อื่นๆ                                   → `average` (เฉลี่ยไม่ถ่วงน้ำหนัก · ติด ≈)
   🔴 DSI/Inventory Balance ตั้ง `sum` ในทะเบียน (รายแผนกบวกกันได้ = ของโรงงาน · ตัวหาร COGS เป็นของโรงงาน §14.3 obeya-kpi-board.md) */
export const ROLLUP_MODES = ['sum', 'average', 'formula'];
export function rollupModeOf(def) {
  const explicit = def?.kpi_catalog?.rollup_mode;
  if (ROLLUP_MODES.includes(explicit)) return explicit;
  if (formulaOfDef(def)) return 'formula';
  return summaryModeOf(def) === 'sum' ? 'sum' : 'average';
}

/**
 * @param formulaInfoOf  (def) => info ของรางสูตร ({ inputs: { [เดือน]: { [ตัวแปร]: ค่า } } }) — ใช้เมื่อรวมแบบ `formula` · ไม่ส่ง/ไม่มี = ถอยไปเฉลี่ย (approx)
 */
export function rollupChildDefs(defs = [], entriesByDef = {}, { labelOf = null, formulaInfoOf = null } = {}) {
  const ds = (defs || []).filter(Boolean);
  if (!ds.length) return null;
  const lead = ds[0];
  const mode = summaryModeOf(lead);
  let combine = rollupModeOf(lead);
  const entries = {}, coverage = {};
  const fkey = combine === 'formula' ? formulaOfDef(lead) : null;
  const f = fkey ? formulaOf(fkey) : null;
  if (combine === 'formula' && (!f || typeof formulaInfoOf !== 'function')) combine = 'average';   // ไม่มีตัวแปรฐานให้รวม = เฉลี่ยพร้อมธง ≈ (ไม่เงียบ)
  if (combine === 'formula') {
    for (let m = 1; m <= 12; m++) {
      const vars = {}; let nUnits = 0, missing = false;
      const infos = ds.map(d => formulaInfoOf(d)?.inputs?.[m] || null);
      for (const v of f.vars) {
        const unitLevel = (baseVarOf(v)?.level || 'unit') === 'unit';
        if (unitLevel) {
          const got = infos.map(i => num(i?.[v])).filter(x => x != null);
          if (!got.length) { missing = true; break; }
          vars[v] = got.reduce((a, b) => a + b, 0);
        } else {
          const got = infos.map(i => num(i?.[v])).find(x => x != null);
          if (got == null) { missing = true; break; }
          vars[v] = got;
        }
      }
      if (missing) continue;
      nUnits = infos.filter(i => i && f.vars.some(v => (baseVarOf(v)?.level || 'unit') === 'unit' && num(i[v]) != null)).length;
      const r = evalFormula(fkey, vars);
      if (r.value == null) continue;
      entries[m] = r.value;
      coverage[m] = { n: nUnits, of: ds.length };
    }
  } else {
    for (let m = 1; m <= 12; m++) {
      const vals = ds.map(d => num(entriesByDef?.[d.id]?.[m])).filter(v => v != null);
      if (!vals.length) continue;
      const total = vals.reduce((a, b) => a + b, 0);
      entries[m] = combine === 'sum' ? total : total / vals.length;
      coverage[m] = { n: vals.length, of: ds.length };
    }
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
    def, entries, coverage, partial, combine, approx: combine === 'average', n: ds.length, targetNote, formulaKey: fkey || null,
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
