/* ══ 🧮 KPI การเงินคำนวณจาก "ตัวเลขฐาน" — ห้ามหารเองในหน้า (2026-10-15 · คำสั่ง user) ═══════════════════
   user: "มันจะมีพวก total sales · sales from product · sales from trading goods ที่เป็นข้อมูลหลักใช้ทั้งโรงงาน ·
          ควรให้คนคนนึงคอยกรอกค่าที่ใช้ร่วมกันทั้งโรงงาน · DL ของแต่ละส่วนงานก็ไปกรอกยอดเงินอย่างเดียว แล้วระบบเอาไปหารให้"
   กติกา:
   · ตัวเลขฐานอยู่ `kpi_base_inputs` (Main) 1 แถว = ปี·เดือน·ขอบเขต·ตัวแปร · ตัวแปร `level:'plant'` อ่านจากขอบเขต ทั้งโรงงาน **เสมอ**
     ไม่ว่านิยามอยู่หน่วยไหน · ตัวแปร `level:'unit'` อ่านจากขอบเขตของนิยาม (canonical แล้ว) **ไม่ถอยไปใช้ของโรงงาน** (ค่าของหน่วยอื่น ≠ ค่าของเรา)
   · นิยามที่ `provider='formula'` + `provider_config.formula` = ค่ารายเดือนมาจาก `evalFormula` — ขาดตัวแปร = เดือนนั้น `null` + บอกว่าขาดอะไรที่ขอบเขตไหน
     **ห้ามคืน 0** · เดือนที่คำนวณไม่ได้แต่เคยกรอกมือไว้ = ใช้ค่ากรอกมือแล้วจอต้องติดป้าย ✍️ (ช่วงเปลี่ยนผ่าน)
   · pure ทั้งไฟล์ · ไม่แตะ supabase · เทส `__tests__/kpiFormula.test.mjs` */
import { KPI_BASE_VARS, baseVarOf, formulaOf, evalFormula, fmtKpi } from './kpiSetup.js';
import { scopeKey, scopeOfDef, canonicalScope, isPlant } from './orgScope.js';

export const PLANT_BASE_KEY = 'plant';
/** คีย์ขอบเขตของตัวเลขฐาน — ทั้งโรงงาน = 'plant' · อื่นๆ = `kind:value` (ต้อง canonical ก่อนส่งเข้า) */
export const baseScopeKeyOf = (sc) => (isPlant(sc) ? PLANT_BASE_KEY : scopeKey(sc.kind, sc.value));
/** แถว kpi_base_inputs → scope_kind/scope_value ที่เขียน (plant เก็บ scope_value = '' ไม่ใช่ null — unique index coalesce ไว้) */
export const baseScopeColumns = (sc) => (isPlant(sc) ? { scope_kind: 'plant', scope_value: '' } : { scope_kind: sc.kind, scope_value: sc.value });
const rowScopeKey = (r) => (!r.scope_kind || r.scope_kind === 'plant' || !r.scope_value ? PLANT_BASE_KEY : `${r.scope_kind}:${r.scope_value}`);

/** ดัชนีตัวเลขฐาน — `get(scopeKey, varKey, month)` คืนตัวเลขหรือ null · `row(...)` คืนแถวเดิม (ใช้หา id ตอนแก้) ·
 *  `auto(sk, vk, m)` = ตัวเติมอัตโนมัติเมื่อไม่มีแถวกรอกมือ (15/10: กำลังคนจากทะเบียนพนักงาน) · `src(...)` = 'manual' | 'auto' | null */
export function buildBaseIndex(rows = [], { auto = null } = {}) {
  const m = new Map();
  for (const r of rows || []) {
    if (!r || !r.var_key || !r.month) continue;
    m.set(`${rowScopeKey(r)}|${r.var_key}|${Number(r.month)}`, r);
  }
  const row = (sk, vk, month) => m.get(`${sk}|${vk}|${Number(month)}`) || null;
  const manual = (sk, vk, month) => { const r = row(sk, vk, month); const v = r?.value; return v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v); };
  const autoVal = (sk, vk, month) => { if (!auto) return null; const v = auto(sk, vk, month); return v == null || Number.isNaN(Number(v)) ? null : Number(v); };
  const get = (sk, vk, month) => { const v = manual(sk, vk, month); return v != null ? v : autoVal(sk, vk, month); };
  const src = (sk, vk, month) => (manual(sk, vk, month) != null ? 'manual' : autoVal(sk, vk, month) != null ? 'auto' : null);
  return { get, row, src, size: m.size };
}

/** ตัวแปรนี้อ่านจากขอบเขตไหน — plant var = 'plant' เสมอ · unit var = ขอบเขตของนิยาม */
export const baseScopeForVar = (varKey, defScope) => (baseVarOf(varKey)?.level === 'plant' ? PLANT_BASE_KEY : baseScopeKeyOf(defScope));

/** นิยามนี้ใช้สูตรไหม — provider='formula' + provider_config.formula (รับ string JSON เผื่อฐานเก่า) */
export function formulaOfDef(d) {
  if (!d || d.provider !== 'formula') return null;
  let cfg = d.provider_config;
  if (typeof cfg === 'string') { try { cfg = JSON.parse(cfg); } catch { cfg = null; } }
  const key = cfg?.formula;
  return key && formulaOf(key) ? key : null;
}

/**
 * ค่ารายเดือนของนิยามสูตร 1 ตัว
 * @returns { key, formula, months:{1..12: number|null}, inputs:{m:{var:value}}, missing:{m:[{key,label,scope}]}, varScopes:{var: scopeKey} }
 */
export function formulaMonths({ def, scope, base }) {
  const key = formulaOfDef(def);
  const f = key ? formulaOf(key) : null;
  if (!f || !base) return null;
  const varScopes = Object.fromEntries(f.vars.map(v => [v, baseScopeForVar(v, scope)]));
  const months = {}, inputs = {}, missing = {}, inputSrc = {};
  const cum = new Set(f.cum || []);
  const srcOf = (v, mm) => (base.src ? base.src(varScopes[v], v, mm) : (base.get(varScopes[v], v, mm) != null ? 'manual' : null));
  for (let m = 1; m <= 12; m++) {
    const vars = {}, srcs = {};
    f.vars.forEach(v => {
      if (!cum.has(v)) { vars[v] = base.get(varScopes[v], v, m); srcs[v] = srcOf(v, m); return; }
      /* ตัวแปรสะสม YTD (ยอดขาย/หัว): รวม ม.ค.→m · ขาดเดือนใดเดือนหนึ่งก่อนหน้า = คำนวณไม่ได้ (ห้ามรวมเฉพาะที่มี = ยอดต่ำกว่าจริงเงียบ) */
      let sum = 0, ok = true, src = null;
      for (let j = 1; j <= m; j++) { const x = base.get(varScopes[v], v, j); if (x == null) { ok = false; break; } sum += Number(x); const sj = srcOf(v, j); if (sj === 'auto' || (src == null && sj)) src = sj === 'auto' ? 'auto' : src || sj; }
      vars[v] = ok ? sum : null; srcs[v] = ok ? src : null;
    });
    const r = evalFormula(key, vars);
    inputs[m] = vars; inputSrc[m] = srcs;
    if (r.value != null) months[m] = r.value;
    else {
      months[m] = null;
      const miss = (r.missing || []).map(v => ({ key: v, label: baseVarOf(v)?.label || v, scope: varScopes[v] }));
      if (miss.length || r.error) missing[m] = miss.length ? miss : [{ key: '_', label: r.error, scope: null }];
    }
  }
  return { key, formula: f, months, inputs, missing, varScopes, inputSrc };
}

/**
 * เติมค่ารายเดือนของนิยามสูตรทับตาราง entries (kpi_id → {month: value}) — คืน object ใหม่ ไม่แก้ของเดิม
 * · เดือนที่สูตรคำนวณได้ = ค่าสูตร (ชนะค่ากรอกมือ) · คำนวณไม่ได้ + มีค่ากรอกมือ = ใช้ค่ากรอกมือ (`usedManual`) · ไม่มีทั้งคู่ = ว่าง
 * @returns { entries, info:{ defId: { key, label, expr, unit, months, inputs, missing, usedManual:number[], computed:number[], varScopes } } }
 */
export function applyFormulaEntries(defs, entries, base, orgIndex) {
  const out = { ...(entries || {}) };
  const info = {};
  if (!base) return { entries: out, info };
  for (const d of defs || []) {
    const sc = canonicalScope(orgIndex, scopeOfDef(d));
    const r = formulaMonths({ def: d, scope: sc, base });
    if (!r) continue;
    const manual = (entries || {})[d.id] || {};
    const merged = {};
    const usedManual = [], computed = [];
    const approx = [];
    for (let m = 1; m <= 12; m++) {
      /* 🔴 สูตรที่มีตัวแปร "ประมาณจากทะเบียน" (auto) ห้ามทับค่าที่คนกรอกไว้ — ค่าประมาณเติมได้แค่ช่องว่าง (ทะเบียน PD1 มี 32 คน ของจริง ~300) */
      const est = Object.values(r.inputSrc?.[m] || {}).includes('auto');
      if (r.months[m] != null && !(est && manual[m] != null)) { merged[m] = r.months[m]; computed.push(m); if (est) approx.push(m); }
      else if (manual[m] != null) { merged[m] = Number(manual[m]); usedManual.push(m); }
    }
    out[d.id] = merged;
    info[d.id] = { key: r.key, label: r.formula.label, expr: r.formula.expr, unit: r.formula.unit, months: r.months, inputs: r.inputs,
      inputSrc: r.inputSrc, missing: r.missing, usedManual, computed, approx, varScopes: r.varScopes, manual };
  }
  return { entries: out, info };
}

/** ช่องเดือนของนิยามสูตร: `computed` = สูตรคำนวณได้ (อ่านอย่างเดียว 🧮) · `manual` = ตัวเลขฐานยังไม่ครบ ⇒ ยังกรอกมือได้ (✍️)
 *  — ช่วงเปลี่ยนผ่าน ห้ามล็อกช่องจนกว่าสูตรจะคำนวณได้จริง ไม่งั้นหน่วยที่ยังไม่มีตัวเลขฐานกรอกอะไรไม่ได้เลย */
export const formulaMonthMode = (info, month) => {
  const m = Number(month);
  if (!info) return 'manual';
  if (info.usedManual?.includes(m)) return 'manual';          // รวมเดือนที่สูตรคำนวณได้แต่ใช้ค่าประมาณ ⇒ ค่ากรอกมือชนะ ยังแก้ได้
  return info.months?.[m] != null ? 'computed' : 'manual';
};

const fmtBaht = (v) => (v == null ? '–' : Number(v).toLocaleString('th-TH', { maximumFractionDigits: 2 }));
const scopeText = (sk, labelOf) => (sk === PLANT_BASE_KEY ? 'ทั้งโรงงาน' : (labelOf ? labelOf(sk) : sk));

/** ข้อความอธิบาย 1 เดือน — คำนวณได้: "DL 1,200,000 + OH 800,000 ÷ ยอดขายจากสินค้า 150,000,000 (ทั้งโรงงาน)" · ขาด: "ขาด ยอดขายจากสินค้า (ทั้งโรงงาน)" */
export function formulaNoteText(info, month, { labelOf = null, def = null } = {}) {
  if (!info) return '';
  const m = Number(month);
  const miss = info.missing?.[m];
  if (miss?.length) {
    const txt = miss.map(x => (x.scope ? `${x.label} (${scopeText(x.scope, labelOf)})` : x.label)).join(' · ');
    return info.usedManual?.includes(m) ? `✍️ ใช้ค่ากรอกมือ — สูตรยังขาด ${txt}` : `ขาดตัวเลขฐาน: ${txt}`;
  }
  if (info.usedManual?.includes(m) && info.months?.[m] != null) {
    return `✍️ ใช้ค่ากรอกมือ — สูตรคำนวณได้ ${def ? fmtKpi(info.months[m], def) : fmtBaht(info.months[m])} แต่ใช้กำลังคนประมาณจากทะเบียนพนักงาน จึงไม่ทับค่าที่กรอกไว้`;
  }
  const parts = (info.formula?.vars || Object.keys(info.inputs?.[m] || {})).map(v => `${baseVarOf(v)?.label?.split(' (')[0] || v} ${fmtBaht(info.inputs?.[m]?.[v])} (${scopeText(info.varScopes?.[v], labelOf)}${info.inputSrc?.[m]?.[v] === 'auto' ? ' · ≈ทะเบียนพนักงาน' : ''})`);
  const val = info.months?.[m];
  return `🧮 ${info.label} = ${info.expr} → ${parts.join(' · ')}${val != null && def ? ` = ${fmtKpi(val, def)}` : ''}`;
}

/** สรุปสั้นสำหรับชิปหัวแถว — "🧮 สูตร DL&OH % · คำนวณได้ 9 เดือน · ขาดตัวเลขฐาน 3 เดือน" */
export function formulaSummaryText(info) {
  if (!info) return '';
  const missN = Object.keys(info.missing || {}).filter(m => !info.usedManual?.includes(Number(m))).length;
  const bits = [`🧮 ${info.label} = ${info.expr}`];
  if (info.computed?.length) bits.push(`คำนวณได้ ${info.computed.length} เดือน`);
  if (info.usedManual?.length) bits.push(`✍️ ใช้ค่ากรอกมือ ${info.usedManual.length} เดือน`);
  if (missN) bits.push(`ขาดตัวเลขฐาน ${missN} เดือน`);
  return bits.join(' · ');
}

/** ตัวแปรฐานที่สูตรทั้งหมดใช้ — เอาไว้บอกบนแผงกรอกว่า "ตัวแปรนี้ใช้ในสูตรไหน" */
export const formulasUsingVar = (varKey) => (baseVarOf(varKey) ? (['dl_pct', 'oh_pct', 'dloh_pct', 'rm_pct', 'p100_pct', 'inventory_day', 'sale_per_head']
  .map(formulaOf).filter(f => f && f.vars.includes(varKey)).map(f => f.label)) : []);
export const BASE_VARS_BY_LEVEL = {
  plant: KPI_BASE_VARS.filter(v => v.level === 'plant'),
  unit: KPI_BASE_VARS.filter(v => v.level !== 'plant'),
};
