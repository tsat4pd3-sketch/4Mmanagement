/* ══ 🎯 kpiSetup — ทะเบียนกลางของ "การตั้งค่า KPI" (pure · ห้าม import supabase/DOM) ══════════
   2026-09-16 · ถอดจากใบจริง 3 แผนก (PD3 · PD4 · JIG MTN) + คู่มือ KPI Online ของกลุ่ม
   ที่มา/หลักฐานทุกตัวเลขในนี้ → docs/OBEYA-KPI-SOURCES.md §8-12  **อ่านก่อนแก้ไฟล์นี้เสมอ**

   ทำไมต้องมีไฟล์นี้:
   ใบจริงพิสูจน์แล้วว่า **hardcode ชุด KPI ไม่มีทางพอ** — JIG MTN ไม่มี Inventory/PPM/OEE เลย
   แต่มี MTBF/MTTR/PM JIG · เป้ากับหน่วยต่างกันทุกแผนก · แม้แต่เด็คทบทวนกับไฟล์ Excel
   ยังตั้งเป้าไม่ตรงกัน (PD3 OEE เด็ค ≥85% ไฟล์ ≥79%) ⇒ ทุกอย่างต้องตั้งจากจอ ไม่ใช่จากโค้ด

   สิ่งที่ไฟล์นี้เป็นเจ้าของ (ห้ามเขียนซ้ำในหน้า):
     1) ระดับขอบเขต (KPI_SCOPE_LEVELS)     — ส่วนงาน → แผนก → กลุ่ม → ไลน์ · + cost center
     2) ที่มาข้อมูล (KPI_PROVIDERS)         — 🔗 "ลิ้ง data" ที่ user ขอ
     3) ตัวแปรฐาน (KPI_BASE_VARS)           — ตัวเลขดิบจากบัญชี/SAP ที่สูตรการเงินใช้
     4) เกณฑ์คะแนน (scoreKpi)               — ถึง Target ×1 · ถึง Commitment ×0.5 · ไม่ถึง 0
     5) วิธีรวม 12 เดือน (summarizeMonths)  — average / sum / max / as_of / rate
   ════════════════════════════════════════════════════════════════════════════════════════ */

/* ── 1) ระดับขอบเขต ───────────────────────────────────────────────────────────────────────
   user 16/09: "เจาะได้ตามระดับองค์กร ส่วน · แผนก · กลุ่ม หรือไลน์ลูก (ถ้าข้อมูลถึง)"
   ⚠️ `cost_center` **ไม่ได้อยู่ในสายเดียวกับไลน์** — KPI การเงินตัดด้วย cc (1 กลุ่มไลน์ครอบหลาย cc
      และหลายไลน์ใช้ cc เดียวกัน) จึงมี `depth: null` = เทียบความลึกกับสายไลน์ไม่ได้ ห้ามเอาไป sort ปน */
export const KPI_SCOPE_LEVELS = [
  { key: 'plant',       label: 'ทั้งโรงงาน',       short: 'โรงงาน',  depth: 0, source: null },
  { key: 'section',     label: 'ส่วนงาน',          short: 'ส่วนงาน', depth: 1, source: 'org_nodes:section' },
  { key: 'department',  label: 'แผนก',            short: 'แผนก',    depth: 2, source: 'org_nodes:department' },
  { key: 'line_group',  label: 'กลุ่มไลน์ (ไลน์แม่)', short: 'กลุ่ม',  depth: 3, source: 'production_lines:parent' },
  { key: 'line',        label: 'ไลน์ลูก',          short: 'ไลน์',    depth: 4, source: 'production_lines:leaf' },
  { key: 'cost_center', label: 'Cost Center',     short: 'CC',      depth: null, source: 'cost_centers' },
];

export const scopeLevel = (kind) => KPI_SCOPE_LEVELS.find(l => l.key === kind) || null;

/** ป้ายขอบเขตที่คนอ่านรู้เรื่อง — `plant` ไม่มีค่า จึงคืนแค่ชื่อระดับ */
export function scopeLabel(kind, value) {
  const lv = scopeLevel(kind);
  if (!lv) return value || '—';
  if (lv.key === 'plant') return lv.label;
  return value ? `${lv.short}: ${value}` : lv.label;
}

/* ── 2) 🔗 ที่มาข้อมูล (ลิ้ง data) ─────────────────────────────────────────────────────────
   3 แบบตามที่ใบจริงใช้:
     auto    = ระบบคำนวณเองจากข้อมูลที่มีอยู่ (กรองตามขอบเขตของ KPI แถวนั้น)
     formula = คำนวณจาก "ตัวแปรฐาน" ที่บัญชี/SAP กรอกรายเดือน (ดู KPI_BASE_VARS)
     manual  = คนกรอกผลลัพธ์เอง (ระบุเจ้าของตัวเลข เช่น Acc · SAP · QSM · HRM)

   ⚠️ `deepest` = ระดับลึกสุดที่ข้อมูลไปถึงจริง **วัดจาก DB ไม่ใช่ความหวัง** — ตั้ง KPI ลึกกว่านี้
      จอต้องเขียนว่า "ข้อมูลไปไม่ถึงระดับนี้" ไม่ใช่โชว์ค่าว่างหรือ 0 (กฎความซื่อสัตย์ของจอ) */
export const KPI_PROVIDERS = [
  { key: 'manual',       kind: 'manual',  label: '✍️ กรอกมือ',              deepest: 'line',        unit: null,   note: 'ระบุเจ้าของตัวเลขที่ช่อง "ที่มา"' },
  { key: 'formula',      kind: 'formula', label: '🧮 สูตรจากตัวแปรฐาน',     deepest: 'cost_center', unit: null,   note: 'เลือกสูตรใน provider_config.formula' },
  { key: 'oee',          kind: 'auto',    label: '⚙️ OEE (A×P×Q)',          deepest: 'line',        unit: '%',    note: 'production_sessions · ผ่าน src/utils/oee.js เท่านั้น' },
  { key: 'ppm',          kind: 'auto',    label: '🎯 PPM ของเสียภายใน',      deepest: 'line',        unit: 'PPM',  note: '(ของเสีย ÷ ยอดผลิต) × 1e6 — ยืนยัน 3 แหล่ง §10.3' },
  { key: 'defect_cost',  kind: 'auto',    label: '💸 มูลค่าของเสีย',          deepest: 'line',        unit: 'บาท',  note: 'defect_logs × defectUnitCost' },
  { key: 'downtime_min', kind: 'auto',    label: '⏱️ นาทีเครื่องหยุด',        deepest: 'line',        unit: 'นาที', note: 'downtime_logs (duration_min เต็ม ไม่ใช่ตัวหักฐานเวลา)' },
  { key: 'mtbf',         kind: 'auto',    label: '🔧 MTBF',                  deepest: 'line',        unit: 'ชม.',  note: 'ผ่าน src/utils/oee.js · ⚠️ ใบ JIG ใช้ "นาที" เด็คใช้ "ชม." — ตั้งหน่วยให้ตรงใบ' },
  { key: 'mttr',         kind: 'auto',    label: '🔧 MTTR',                  deepest: 'line',        unit: 'ชม.',  note: 'เหมือน MTBF' },
  { key: 'pm_percent',   kind: 'auto',    label: '🛠️ PM ตามแผน',            deepest: 'line',        unit: '%',    note: 'โมดูล PM' },
  { key: 'mo_on_target', kind: 'auto',    label: '📋 ใบ MO ปิดตามเป้า',       deepest: 'department',  unit: '%',    note: 'mtn_orders (JIG: 455/456)' },
  { key: 'safety_case',  kind: 'auto',    label: '🦺 เหตุความปลอดภัย',        deepest: 'section',     unit: 'Case', note: 'safety_events · line_name เป็น optional ⇒ ลึกกว่าส่วนงานอาจไม่ครบ' },
  { key: 'produced_qty', kind: 'auto',    label: '📦 ยอดผลิต',               deepest: 'line',        unit: 'ชิ้น', note: 'prod_orders ผ่าน orderTotal' },
  { key: 'manpower',     kind: 'auto',    label: '🧑‍🏭 กำลังคนเฉลี่ย',        deepest: 'line',        unit: 'คน',   note: 'daily_production_logs.assigned_line' },
  { key: 'training_pct', kind: 'auto',    label: '🎓 TS Academy (% อบรม)',   deepest: 'department',  unit: '%',    note: 'ojt_training_attendees ÷ employees · ⚠️ ต้องตกลงเกณฑ์ "ผ่าน" ก่อน' },
];

export const providerOf = (key) => KPI_PROVIDERS.find(p => p.key === key) || null;

/** provider นี้ไปถึงระดับที่ตั้งไว้ไหม — คืน `null` เมื่อเทียบไม่ได้ (cost_center อยู่คนละสาย) */
export function providerReaches(providerKey, scopeKind) {
  const p = providerOf(providerKey); const want = scopeLevel(scopeKind);
  if (!p || !want) return null;
  if (p.kind === 'manual') return true;                 // คนกรอกเอง ลึกแค่ไหนก็ได้
  const deep = scopeLevel(p.deepest);
  if (!deep) return null;
  if (want.key === 'cost_center') return p.deepest === 'cost_center';
  if (want.depth == null || deep.depth == null) return null;
  return want.depth <= deep.depth;
}

/* ── 3) ตัวแปรฐาน — ตัวเลขดิบที่บัญชี/SAP กรอกเดือนละครั้ง ───────────────────────────────
   ในไฟล์ Excel ของจริงคือแถว 48-67 ที่ลิงก์ข้ามไฟล์จนสอบกลับไม่ได้ (`'[2]Overall PD3 2025'!$C$5`)
   ⚠️ ตาราง `kpi_base_inputs.var_key` **ไม่มี check constraint โดยตั้งใจ** — เพิ่มตัวแปรใหม่
      แก้ที่ลิสต์นี้พอ ไม่ต้องทำ migration (กติกาเดียวกับ `meeting_action_items.kpi_key`) */
export const KPI_BASE_VARS = [
  { key: 'sale_product',   label: 'ยอดขายจากสินค้า (Sale from product)', unit: 'บาท' },
  { key: 'sale_total',     label: 'ยอดขายรวม (Total Sale)',              unit: 'บาท' },
  { key: 'dl',             label: 'ค่าแรงทางตรง (Direct Labour)',         unit: 'บาท' },
  { key: 'oh',             label: 'ค่าโสหุ้ย (Overhead)',                 unit: 'บาท' },
  { key: 'raw_material',   label: 'ต้นทุนวัตถุดิบ (Raw Material)',        unit: 'บาท' },
  { key: 'cogs',           label: 'ต้นทุนขาย COGS (ตัวหารของ DSI)',        unit: 'บาท' },
  { key: 'inventory_baht', label: 'มูลค่าสต็อกสิ้นเดือน (ตาม storage location)', unit: 'บาท' },
  { key: 'manpower',       label: 'กำลังคน (หัว)',                        unit: 'คน' },
  { key: 'cost_100p',      label: '100P + CR (มูลค่าที่ลดได้)',           unit: 'บาท' },
  { key: 'days_in_month',  label: 'ตัวหารวัน (ใบจริงใช้ 30 คงที่)',        unit: 'วัน' },
];

export const baseVarOf = (key) => KPI_BASE_VARS.find(v => v.key === key) || null;

/* สูตรสำเร็จรูปที่ถอดมาจากเซลล์จริง (§12.2) — provider_config.formula เก็บแค่ `key`
   ✅ verify กับ **ใบ Monitoring ในระบบ KPI Online ของจริง** แล้ว 17/09 (§13.1) — ตรงเป๊ะ 3 ตัว:
      rm_pct = (Raw Material/Sales from product)×100 · dloh_pct = [(DL+OH)/Sale from product]×100
      · p100_pct = (Actual 100P/Sale from product)×100
   ✅ `inventory_day` (DSI) = `(มูลค่าสต็อกสิ้นเดือน ÷ COGS) × Days` — **ปิดข้อยุติแล้ว 17/09 (§14.2)**
      ยืนยันตรงกัน 3 แหล่งอิสระ: ประกาศบริษัท QSM-R2 001/2569 · แม่แบบ Corporate KPI Guideline 2026
      · ใบ Monitoring ในระบบ KPI Online  ⇒ **ตัวหารคือ COGS ไม่ใช่ยอดขาย** (เคยเขียนผิดเป็น sale_product)
      · ตัวหารวัน (`days_in_month`) ยังไม่ชี้ขาดว่า 30 คงที่หรือวันทำงานจริง — จึงยังเป็นตัวแปรฐาน
      · DSI มี **2 หน่วยทางการ**: `วัน` (สูตรนี้) หรือ `MB` (มูลค่าสต็อกดิบๆ) — แม่แบบ Corporate ให้เลือกได้
        ⇒ แถว "Inventory Balance - …" ใต้ DSI ในใบแผนก = ตัวเดียวกันแต่รายงานเป็น MB
      · **ตัวตั้งมาจาก storage location เฉพาะของแผนกนั้น** (PD1 P401/405/406/407/408 · PD2 P402/403/404/413
        · PD3 P409+P411 · PD4 P410+412 · LOG ขาเข้า MAT 5xxxxx,3xxxxx + 2xxxxx · WH ขาออก FG 1xxxxx)
        และ **ตัวหาร COGS เป็นของทั้งโรงงาน** ⇒ DSI รายแผนกบวกกันได้ = DSI ของโรงงาน (พิสูจน์แล้ว §14.3)
   ℹ️ `sale_per_head` ใบทางการเขียน "Total Sales / **Average** manpower" — `manpower` ต้องเป็นค่าเฉลี่ยของช่วง */
export const KPI_FORMULAS = [
  { key: 'dl_pct',        label: 'DL %',        expr: 'dl ÷ sale_product × 100',                  vars: ['dl', 'sale_product'],             unit: '%' },
  { key: 'oh_pct',        label: 'OH %',        expr: 'oh ÷ sale_product × 100',                  vars: ['oh', 'sale_product'],             unit: '%' },
  { key: 'dloh_pct',      label: 'DL&OH %',     expr: '(dl + oh) ÷ sale_product × 100',           vars: ['dl', 'oh', 'sale_product'],       unit: '%' },
  { key: 'rm_pct',        label: '%RM',         expr: 'raw_material ÷ sale_product × 100',        vars: ['raw_material', 'sale_product'],   unit: '%' },
  { key: 'p100_pct',      label: '100P %',      expr: 'cost_100p ÷ sale_product × 100',           vars: ['cost_100p', 'sale_product'],      unit: '%' },
  { key: 'inventory_day', label: 'DSI (วัน)',   expr: '(inventory_baht ÷ cogs) × days_in_month',      vars: ['inventory_baht', 'cogs', 'days_in_month'], unit: 'วัน' },
  { key: 'sale_per_head', label: 'ยอดขาย/หัว (MB)', expr: 'sale_total ÷ manpower ÷ 1,000,000',    vars: ['sale_total', 'manpower'],         unit: 'MB' },
];

export const formulaOf = (key) => KPI_FORMULAS.find(f => f.key === key) || null;

/** คำนวณสูตรจากตัวแปรฐาน 1 เดือน — ขาดตัวแปรไหนคืน `{ value: null, missing: [...] }` **ห้ามคืน 0** */
export function evalFormula(formulaKey, vars = {}) {
  const f = formulaOf(formulaKey);
  if (!f) return { value: null, missing: [], error: 'ไม่รู้จักสูตรนี้' };
  const num = (k) => { const v = vars[k]; return v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v); };
  const missing = f.vars.filter(k => num(k) == null);
  if (missing.length) return { value: null, missing, error: null };

  const v = Object.fromEntries(f.vars.map(k => [k, num(k)]));
  const div = (a, b) => (b === 0 ? null : a / b);   // หารศูนย์ = ไม่รู้ ไม่ใช่ 0
  let value = null;
  switch (f.key) {
    case 'dl_pct':        value = div(v.dl, v.sale_product); break;
    case 'oh_pct':        value = div(v.oh, v.sale_product); break;
    case 'dloh_pct':      value = div(v.dl + v.oh, v.sale_product); break;
    case 'rm_pct':        value = div(v.raw_material, v.sale_product); break;
    case 'p100_pct':      value = div(v.cost_100p, v.sale_product); break;
    case 'inventory_day': { const r = div(v.inventory_baht, v.cogs); value = r == null ? null : r * Number(v.days_in_month); break; }
    case 'sale_per_head': { const per = div(v.sale_total, v.manpower); return { value: per == null ? null : per / 1e6, missing: [], error: null }; }
    default: return { value: null, missing: [], error: 'ยังไม่ได้ทำสูตรนี้' };
  }
  if (value == null) return { value: null, missing: [], error: 'ตัวหารเป็นศูนย์' };
  if (f.unit === '%') value *= 100;
  return { value, missing: [], error: null };
}

/* ── 4) เกณฑ์คะแนน — ถึง Target ×1 · ถึง Commitment ×0.5 · ไม่ถึง 0 ─────────────────────
   ยืนยันกับตัวเลขจริงในคู่มือ KPI Online 6 แถว (§8.3) + Symbol EVA บนกระดาษหน้างาน
   (○ Achieve · △ Improvement · ✗ Miss goal) ที่พิมพ์ท้ายทุกแผ่น (§9.1)
   **ห้ามคิดเกณฑ์สี/band เองอีก** — ของจริงมีเอกสารแล้ว                                     */
export const KPI_LEVELS = {
  1:   { level: 1,   symbol: '○', label: 'ผ่านเป้า',        color: '#22c55e' },
  0.5: { level: 0.5, symbol: '△', label: 'ถึง Commitment', color: '#f59e0b' },
  0:   { level: 0,   symbol: '✗', label: 'ไม่ถึง',          color: '#ef4444' },
};
/** ยังไม่มีข้อมูล ≠ ไม่ผ่าน — เด็คทบทวนของจริงก็แยก `— Pending —` ออกจาก `✘ Below` (§12.4) */
export const KPI_PENDING = { level: null, symbol: '—', label: 'ยังไม่มีข้อมูล', color: '#64748b' };

const passes = (value, compare, bar) => {
  if (bar == null || compare == null) return null;
  switch (compare) {
    case '<=': return value <= bar;
    case '<':  return value < bar;
    case '>=': return value >= bar;
    case '>':  return value > bar;
    case '=':  return value === bar;
    default:   return null;
  }
};

/**
 * ให้คะแนน 1 แถว KPI
 * @param value  ผลจริง (null = ยังไม่มีข้อมูล)
 * @param def    { commit_compare, commit_value, target_compare, target_value, weight }
 * @returns { level, point, symbol, label, color, reason }  — level null = pending
 *
 * ⚠️ ไม่สมมติว่า "Target ยากกว่า Commitment เสมอ" — ใบจริงมีแถวที่กลับด้าน (Safety commit 0 / target 1)
 *    ⇒ ผ่านบาร์ไหนก็ตามที่**เข้มกว่า** = 1 · ผ่านแค่บาร์ที่หลวมกว่า = 0.5   (§8.3 ข้อควรถาม)
 */
export function scoreKpi(value, def = {}) {
  const w = Number(def.weight);
  const weight = Number.isFinite(w) ? w : null;
  if (value == null || value === '' || Number.isNaN(Number(value))) {
    return { ...KPI_PENDING, point: null, reason: 'ยังไม่มีผลจริง' };
  }
  const v = Number(value);
  const okT = passes(v, def.target_compare, def.target_value == null ? null : Number(def.target_value));
  const okC = passes(v, def.commit_compare, def.commit_value == null ? null : Number(def.commit_value));

  if (okT == null && okC == null) {
    return { ...KPI_PENDING, point: null, reason: 'ยังไม่ได้ตั้งเป้า' };   // ไม่มีเป้า = เทา ไม่ใช่เขียว
  }

  /* 🔴 เกณฑ์ตัดสินอ่านจาก "ป้ายของบาร์" ไม่ใช่ "บาร์ไหนเข้มกว่า"
     หลักฐานชี้ขาด: ประกาศบริษัท QSM-R2 001/2569 Rev.0 (16/03/2026) หัวคอลัมน์เขียนตรงๆ ว่า
     `Commitment Score = 0.5` · `Target Score = 1` (ดู docs/OBEYA-KPI-SOURCES.md §14.2)
     ⇒ ถึง Target = 1 · ไม่ถึง Target แต่ถึง Commitment = 0.5 · ไม่ถึงทั้งคู่ = 0
     เคยเขียนเป็น "บาร์ที่เข้มกว่า = 1" (เดาเอง) แล้วผิดกับแถวที่ commit เข้มกว่า target
     — ซึ่งในใบจริงเป็น **คำผิดของคนกรอก** ไม่ใช่กติกาอีกแบบ (เช่น Total Sales ในประกาศพิมพ์
     2,117.82 MB แต่ใบ GM เขียน 2,177.82 MB) ⇒ ห้ามเปลี่ยนกลับไปเดาจากความเข้ม */
  let level;
  if (okT) level = 1;
  else if (okC) level = 0.5;
  else level = 0;

  const meta = KPI_LEVELS[level];
  return {
    ...meta,
    point: weight == null ? null : Math.round(weight * level * 100) / 100,
    reason: level === 1 ? 'ถึง Target' : level === 0.5 ? 'ถึง Commitment' : 'ไม่ถึงทั้ง Commitment และ Target',
  };
}

/** รวมคะแนนทั้งใบ — คืน coverage ด้วยเสมอ (กฎ: ไฟรวมต้องบอกว่าตัดสินจากกี่ช่อง) */
export function totalPoints(rows = []) {
  let weight = 0, point = 0, scored = 0, pending = 0;
  for (const r of rows) {
    const w = Number(r?.weight);
    if (Number.isFinite(w)) weight += w;
    const s = r?.score;
    if (!s || s.level == null) { pending += 1; continue; }
    scored += 1;
    if (Number.isFinite(s.point)) point += s.point;
  }
  return {
    weight: Math.round(weight * 100) / 100,
    point: Math.round(point * 100) / 100,
    scored, pending, total: rows.length,
  };
}

/* ── 5) วิธีรวม 12 เดือน — ใบจริงใช้คนละวิธีต่อ KPI (§12.2) ──────────────────────────────
   average = ส่วนใหญ่ · sum = จำนวนเคส · max = ตัวสะสม (Sales/Head · TS Academy) ·
   as_of = เอาเดือนล่าสุดที่กรอก (DSI) · rate = คำนวณจากยอดรวมทั้งปี ไม่ใช่เฉลี่ยรายเดือน (PPM) */
export const KPI_SUMMARY_MODES = [
  { key: 'average', label: 'ค่าเฉลี่ยรายเดือน' },
  { key: 'sum',     label: 'ผลรวมทั้งปี' },
  { key: 'max',     label: 'ค่าสูงสุด (ตัวสะสม)' },
  { key: 'as_of',   label: 'เดือนล่าสุดที่มีค่า' },
  { key: 'rate',    label: 'คำนวณจากยอดรวมทั้งปี (เช่น PPM)' },
];

/**
 * @param months  array ของค่ารายเดือน (null = ยังไม่กรอก — ถูกข้าม ไม่ใช่นับเป็น 0)
 * @param mode    ดู KPI_SUMMARY_MODES
 * @param rate    สำหรับ mode 'rate': { num: [], den: [], scale: 1e6 }
 */
export function summarizeMonths(months = [], mode = 'average', rate = null) {
  const nums = months.map(m => (m == null || m === '' || Number.isNaN(Number(m)) ? null : Number(m)));
  const have = nums.filter(n => n != null);
  if (mode === 'rate') {
    const sum = (a = []) => a.reduce((s, x) => s + (Number(x) || 0), 0);
    const den = sum(rate?.den);
    if (!den) return null;
    return (sum(rate?.num) / den) * (rate?.scale ?? 1);
  }
  if (!have.length) return null;
  switch (mode) {
    case 'sum':   return have.reduce((s, n) => s + n, 0);
    case 'max':   return Math.max(...have);
    case 'as_of': { for (let i = nums.length - 1; i >= 0; i--) if (nums[i] != null) return nums[i]; return null; }
    case 'average':
    default:      return have.reduce((s, n) => s + n, 0) / have.length;
  }
}

/* ── ตัวช่วยเล็กๆ ─────────────────────────────────────────────────────────────────────── */
export const COMPARES = ['<=', '>=', '<', '>', '='];

/** แกะ "≤ 2.5364%" / "<=300PPM" → { compare, value } — ใช้ตอนนำเข้าจากใบเก่าที่เก็บเป็นข้อความ */
/* ใบจริงเขียนเป้าแบบ "ไม่มีเครื่องหมาย" เป็นเรื่องปกติ — ต้องเดาทิศทางให้ถูก ไม่งั้นข้อนั้นเทาตลอดกาล
   (Customer Satisfaction เป้า "100%" โผล่ครบทั้ง 12 ใบ น้ำหนัก 5 · MTN MTBF "730 Hr." · MTTR "0 Hr."
    · Machine Break Down "0%" · Safety "0 Case" · Premium Freight "0" · WH TS Academy "100%")
   ลำดับการเดา — คงที่ ห้ามสลับ:
     1) มีเครื่องหมายในข้อความ → ใช้ตามนั้น
     2) ไม่มี แต่บาร์อีกฝั่ง (Commitment) มีเครื่องหมาย → ใช้ทิศเดียวกัน   ← ครอบคลุมเคสส่วนใหญ่
     3) ยังไม่รู้ → ค่า 0 = `<=` (นับเคส/ของเสีย ติดลบไม่ได้) · ค่า 100 = `>=` (เปอร์เซ็นต์เต็ม)
     4) เดาไม่ได้ → คืน null แล้วให้จอบอกว่า "เป้าข้อนี้ยังไม่ระบุทิศทาง" ห้ามเดามั่ว */
export function inferCompare(txt, otherCompare = null) {
  const s = txt == null ? '' : String(txt);
  if (/(≤|<=)/.test(s)) return '<=';
  if (/(≥|>=)/.test(s)) return '>=';
  if (/</.test(s)) return '<';
  if (/>/.test(s)) return '>';
  if (otherCompare) return String(otherCompare).startsWith('<') ? '<=' : '>=';
  const m = s.replace(/,/g, '').match(/(-?\d+(\.\d+)?)/);
  const n = m ? Number(m[1]) : null;
  if (n === 0) return '<=';
  if (n === 100) return '>=';
  return null;
}

export function parseBar(txt, otherCompare = null) {
  if (txt == null) return { compare: null, value: null };
  const m = String(txt).replace(/,/g, '').match(/(-?\d+(\.\d+)?)/);
  return { compare: inferCompare(txt, otherCompare), value: m ? Number(m[1]) : null };
}

/** ประกอบกลับเป็นข้อความบนใบ เช่น `≤ 2.5364 %` */
export function fmtBar(compare, value, unit) {
  if (value == null) return '—';
  const sym = compare === '<=' ? '≤' : compare === '>=' ? '≥' : (compare || '');
  return `${sym ? sym + ' ' : ''}${value}${unit ? ' ' + unit : ''}`.trim();
}

/* ══ 🔗 ตัวเชื่อมกับแถว `kpi_definitions` จริง — จอทุกจอต้องตัดสินผ่านตัวนี้ตัวเดียว ════════
   (2026-09-17 · คำสั่ง user "สองหน้าซ้ำซ้อนกัน" แล้วตรวจเจอว่า 3 จอตัดสินคนละสูตร:
    KpiMonthly = Y/N ล้วน · ObeyaKpiBoard = แถบ ±5% ที่คิดเอง · kpiSetup = 1/0.5/0 แต่ไม่มีใครเรียก)

   แถวในฐานมี 2 ยุคปนกัน — ตัวนี้อ่านได้ทั้งคู่ **ห้ามให้จอไหนแกะเอง**:
     ยุคใหม่ (migration 20260916): `target_compare` + `target_value` · `commit_compare` + `commit_value`
     ยุคเก่า:                      `direction` ('up'/'down') + `target_value` · `commitment`/`target` เป็น**ข้อความ**
   ⚠️ ของเดิม `commitment` ถูกเก็บเป็นข้อความแล้ว**ไม่เคยถูกเอามาตัดสินเลย** ⇒ ขั้น 0.5 หายไปทั้งระบบ
      ตัวนี้ parse ข้อความนั้นกลับมาเป็นบาร์ ⇒ ใบที่กรอก "≤ 1.452%" ไว้ ได้ขั้น 0.5 คืนทันทีโดยไม่ต้องกรอกใหม่ */
export function defBars(def = {}) {
  const dirCmp = def.direction === 'up' ? '>=' : def.direction === 'down' ? '<=' : null;
  const tNum = def.target_value == null || def.target_value === '' ? null : Number(def.target_value);
  const tText = parseBar(def.target, dirCmp);
  const target_compare = def.target_compare || dirCmp || tText.compare;
  const target_value = tNum != null ? tNum : tText.value;

  const cNum = def.commit_value == null || def.commit_value === '' ? null : Number(def.commit_value);
  const cText = parseBar(def.commitment, target_compare);
  const commit_compare = def.commit_compare || (cNum != null ? target_compare : cText.compare);
  const commit_value = cNum != null ? cNum : cText.value;

  const w = Number(def.weight);
  return {
    target_compare, target_value, commit_compare, commit_value,
    weight: Number.isFinite(w) ? w : null,
  };
}

/** ให้คะแนนแถว KPI จาก "แถวในฐาน" โดยตรง — คืน `status` ('good'/'warn'/'bad'/'unknown') ให้จอใช้ทำไฟด้วย */
export function scoreDef(value, def = {}) {
  const bars = defBars(def);
  const s = scoreKpi(value, bars);
  return {
    ...s, bars,
    status: s.level === 1 ? 'good' : s.level === 0.5 ? 'warn' : s.level === 0 ? 'bad' : 'unknown',
  };
}

/* ── 6) KPI Standard 2026 — ทะเบียนมาตรฐานของกลุ่ม (ที่มา: KPI Guideline 2026 as of 29.01.2026 หน้า 7-18)
   🔴 **กติกาการเลือก KPI ของแต่ละส่วนงาน "มีอยู่แล้ว" ในเอกสารกลุ่ม — ห้ามคิดเกณฑ์เอง** (§15)
      ทุกแถวในทะเบียนติดป้ายบังคับ 2 แบบ:
        `fixed`  = **ต้องมีในใบ** ตัดทิ้งไม่ได้ (ในไฟล์ PDF นับได้ 239 คำ)
        `choice` = เลือกได้ตามภาระงานจริงของหน่วยงานนั้น (108 คำ)
      แถวที่ `requirement = null` = **แถวหัวข้อแม่** (เช่น `Activity`) ที่มีข้อย่อยอยู่ใต้มัน — ไม่ใช่ KPI เอง
   ⚠️ หน่วยงานปรับ/เพิ่มข้อ + ถ่วงน้ำหนักเองได้ **แต่ผลรวม weight ต้องเป็น 50 เสมอ** (ประกาศ QSM-R2 001/2569)
   ⚠️ ข้อมูลจริงอยู่ในตาราง `kpi_standard_items` (Main · migration 20260921) — ไฟล์นี้เก็บแค่
      "รายชื่อหน่วยงาน + กติกา" ที่ pure เทสได้ **ห้าม hardcode ตัว KPI ซ้ำในนี้** */

export const KPI_TOTAL_WEIGHT = 50;

/* 4 มุมมอง Balanced Scorecard ที่ทั้งเอกสารกลุ่มและใบ KPI ของเราใช้ร่วมกัน
   คีย์ต้องตรงกับ `kpi_standard_items.perspective` และ `kpi_definitions.category` เป๊ะ
   ⚠️ เคยเขียนลิสต์นี้ซ้ำในหน้า — ย้ายมาที่เดียว 2026-09-23 (แก้ป้ายที่นี่ที่เดียวพอ) */
export const KPI_PERSPECTIVES = [
  { key: 'financial', label: '💰 Financial' },
  { key: 'customer',  label: '🤝 Customer' },
  { key: 'internal',  label: '🏭 Internal Process' },
  { key: 'learning',  label: '📚 Learning & Growth' },
];
export const perspectiveLabel = (k) => KPI_PERSPECTIVES.find(c => c.key === k)?.label || k || '';

export const KPI_REQUIREMENTS = [
  { key: 'fixed',  label: 'บังคับ',  short: 'F', color: '#ef4444', hint: 'ต้องมีในใบ ตัดทิ้งไม่ได้' },
  { key: 'choice', label: 'เลือกได้', short: 'C', color: '#3b82f6', hint: 'เลือกตามภาระงานจริงของหน่วยงาน' },
];
export const requirementOf = (key) => KPI_REQUIREMENTS.find(r => r.key === key) || null;

/** แถวหัวข้อแม่ (มีข้อย่อย) ไม่ใช่ KPI ที่ให้คะแนนเอง — `requirement` ว่าง */
export const isStdParent = (item) => !item?.requirement;
export const isStdFixed  = (item) => item?.requirement === 'fixed';

/* 24 หน่วยงานมาตรฐาน — `unit` ต้องตรงกับคอลัมน์ `std_unit` เป๊ะ (คีย์เชื่อมทะเบียน)
   `seeded:false` = ตารางต้นฉบับหน้า 16-18 ถอดออกมาแล้วนับ Fixed/Choice ไม่ตรง PDF ⇒ **ตั้งใจยังไม่ใส่**
   จอที่ให้เลือกหน่วยงานต้องบอกตรงๆ ว่ายังไม่มีในทะเบียน ห้ามโชว์เป็นช่องว่างเฉยๆ (กฎความซื่อสัตย์ของจอ) */
export const KPI_STD_UNITS = [
  { unit: 'Head of SPG',       th: null,                 seeded: true },
  { unit: 'GM Plant',          th: 'ผู้จัดการโรงงาน',      seeded: true },
  { unit: 'GM Plant (Tooling)', th: 'ผู้จัดการโรงงาน (Tooling)', seeded: true },
  { unit: 'Production',        th: 'ฝ่ายผลิต',            seeded: true },
  { unit: 'Engineering',       th: 'วิศวกรรม',            seeded: true },
  { unit: 'QA',                th: 'ประกันคุณภาพ',         seeded: true },
  { unit: 'QSM',               th: null,                 seeded: true },
  { unit: 'Logistic & Sales',  th: 'โลจิสติกส์ & ขาย',     seeded: true },
  { unit: 'Maintenance',       th: 'ซ่อมบำรุง',           seeded: true },
  { unit: 'Die Maintenance',   th: 'ซ่อมบำรุงแม่พิมพ์',     seeded: true },
  { unit: 'Tooling',           th: null,                 seeded: true },
  { unit: 'Marketing',         th: 'การตลาด',             seeded: true },
  { unit: 'RDPP',              th: null,                 seeded: true },
  { unit: 'CSC',               th: null,                 seeded: true },
  { unit: 'CIC',               th: null,                 seeded: true },
  { unit: 'Accounting',        th: 'บัญชี',               seeded: true },
  { unit: 'Purchase',          th: 'จัดซื้อ',             seeded: true },
  { unit: 'HRM',               th: 'ทรัพยากรบุคคล',       seeded: true },
  { unit: 'Purchase-TSA',      th: 'จัดซื้อ (TSA)',        seeded: true },
  { unit: 'IT-TSA',            th: 'ไอที (TSA)',           seeded: true },
  { unit: 'Accounting-TSA',    th: 'บัญชี (TSA)',          seeded: false },
  { unit: 'HRM-TSA',           th: 'ทรัพยากรบุคคล (TSA)',  seeded: false },
  { unit: 'Internal Audit-TSA', th: 'ตรวจสอบภายใน (TSA)',  seeded: false },
  { unit: 'AOBM-TSA',          th: null,                 seeded: false },
];
export const stdUnitOf = (unit) => KPI_STD_UNITS.find(u => u.unit === unit) || null;
/** ป้ายที่เอาไปขึ้นจอ — ไม่มีคำแปลไทยที่มั่นใจ ก็ใช้ชื่ออังกฤษตามเอกสาร ห้ามเดาคำแปล */
export const stdUnitLabel = (unit) => {
  const u = stdUnitOf(unit);
  return u ? (u.th ? `${u.unit} — ${u.th}` : u.unit) : (unit || '');
};

/** normalize ชื่อหัวข้อก่อนจับคู่ — ใช้จุดเดียวทั้ง checkStdSelection และ matchStdItems
 *  ⚠️ แถวในใบจริง (`kpi_definitions`) เก็บชื่อไว้ที่ `name` ไม่ใช่ `topic` ⇒ ต้องดูทั้งสองช่อง
 *     (ตกหล่นข้อนี้ = ข้อ fixed ที่หยิบมาแล้วยังถูกฟ้องว่า "ยังไม่ได้หยิบ" ทุกข้อ) */
export const normTopic = (s) => String(s == null ? '' : s).trim().toLowerCase();
const rowTopic = (r) => normTopic(r?.topic ?? r?.name);

/**
 * จับคู่ "ทะเบียนมาตรฐาน" กับ "แถวที่อยู่ในใบจริงแล้ว"
 * @param stdItems แถวจาก `kpi_standard_items` ของหน่วยงาน+ปีนั้น
 * @param rows     แถวในใบ (`kpi_definitions`)
 * คืน `[{ item, row }]` เรียงตามทะเบียน — `row = null` แปลว่ายังไม่ได้หยิบเข้าใบ
 */
export function matchStdItems(stdItems = [], rows = []) {
  const byId = new Map();
  const byTopic = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (r?.std_item_id) byId.set(r.std_item_id, r);
    const t = rowTopic(r);
    if (t && !byTopic.has(t)) byTopic.set(t, r);
  }
  return (Array.isArray(stdItems) ? stdItems : [])
    .map(item => ({ item, row: byId.get(item?.id) || byTopic.get(normTopic(item?.topic)) || null }));
}

/**
 * ตรวจใบ KPI ของหน่วยงาน 1 ใบว่าถูกกติกากลุ่มไหม
 * @param rows      แถวในใบ (ต้องมี `weight` · `std_item_id` หรือ `topic` ไว้จับคู่กับทะเบียน)
 * @param stdItems  แถวทะเบียนของหน่วยงานนั้น (จาก `kpi_standard_items`) — ไม่ส่ง = ตรวจแค่น้ำหนัก
 * คืน `{ weight, ok, diff, missingFixed }` — **ห้ามบล็อกการบันทึกด้วยผลนี้** (ใบจริงบางใบก็ไม่ตรง)
 * ให้เตือนบนจอเท่านั้น (กฎความซื่อสัตย์: บอกว่าไม่ตรง ดีกว่าแอบแก้ให้หรือเงียบ)
 */
export function checkStdSelection(rows = [], stdItems = null) {
  let weight = 0;
  for (const r of rows) {
    const w = Number(r?.weight);
    if (Number.isFinite(w)) weight += w;
  }
  weight = Math.round(weight * 100) / 100;
  const diff = Math.round((weight - KPI_TOTAL_WEIGHT) * 100) / 100;

  let missingFixed = [];
  if (Array.isArray(stdItems)) {
    missingFixed = matchStdItems(stdItems.filter(isStdFixed), rows)
      .filter(m => !m.row)
      .map(m => m.item);
  }
  return { weight, diff, ok: diff === 0 && missingFixed.length === 0, missingFixed };
}
