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
  /* `division` = ป้ายฝ่ายบน node ชั้นบนสุด (org_nodes.division · ไม่ใช่ node) — เพิ่ม 23/09 เมื่อ picker
     ขอบเขตกรองได้ทุกมิติของผัง (`src/utils/orgScope.js`) · check constraint ใน DB ขยายแล้ว (migration 20260923b) */
  { key: 'division',    label: 'ฝ่าย',             short: 'ฝ่าย',    depth: 1, source: 'org_nodes:division' },
  { key: 'section',     label: 'ส่วนงาน',          short: 'ส่วนงาน', depth: 2, source: 'org_nodes:section' },
  { key: 'department',  label: 'แผนก',            short: 'แผนก',    depth: 3, source: 'org_nodes:department' },
  { key: 'line_group',  label: 'กลุ่มไลน์ (ไลน์แม่)', short: 'กลุ่ม',  depth: 4, source: 'production_lines:parent' },
  { key: 'line',        label: 'ไลน์ลูก',          short: 'ไลน์',    depth: 5, source: 'production_lines:leaf' },
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
  /* `level` (15/10 · user: "ให้คนคนนึงกรอกค่าที่ใช้ร่วมกันทั้งโรงงาน · DL ของแต่ละส่วนงานกรอกยอดเงินอย่างเดียว ระบบหารให้")
       'plant' = ตัวเลขกลางของโรงงาน กรอกครั้งเดียวที่ขอบเขต ทั้งโรงงาน ทุกสูตรของทุกหน่วยอ่านตัวเดียวกัน (ยอดขาย · COGS · ตัวหารวัน)
       'unit'  = ยอดเงินของหน่วยเอง กรอกที่ขอบเขตของหน่วย (DL · OH · วัตถุดิบ · สต็อก · กำลังคน · 100P) — ที่ขอบเขต ทั้งโรงงาน = ยอดรวมโรงงาน */
  { key: 'sale_total',     label: 'ยอดขายรวม (Total Sales)',                 unit: 'บาท', level: 'plant' },
  { key: 'sale_product',   label: 'ยอดขายจากสินค้า (Sales from product)',     unit: 'บาท', level: 'plant' },
  { key: 'sale_trading',   label: 'ยอดขายสินค้าซื้อมาขายไป (Sales from trading goods)', unit: 'บาท', level: 'plant' },
  { key: 'cogs',           label: 'ต้นทุนขาย COGS (ตัวหารของ DSI)',           unit: 'บาท', level: 'plant' },
  { key: 'days_in_month',  label: 'ตัวหารวัน (ใบจริงใช้ 30 คงที่)',           unit: 'วัน',  level: 'plant' },
  { key: 'dl',             label: 'ค่าแรงทางตรง (Direct Labour)',            unit: 'บาท', level: 'unit' },
  { key: 'oh',             label: 'ค่าโสหุ้ย (Overhead)',                    unit: 'บาท', level: 'unit' },
  { key: 'raw_material',   label: 'ต้นทุนวัตถุดิบ (Raw Material)',           unit: 'บาท', level: 'unit' },
  { key: 'inventory_baht', label: 'มูลค่าสต็อกสิ้นเดือน (ตาม storage location)', unit: 'บาท', level: 'unit' },
  { key: 'manpower',       label: 'กำลังคนทั้งโรงงาน (Total Head count All)', unit: 'คน',  level: 'plant' },   // 09/11 user: ยอดขาย/หัว = ค่ากลาง ⇒ ตัวหาร = คนทั้งโรงงานจากใบ 5.Manpower (เดิม level unit)
  { key: 'cost_100p',      label: '100P + CR (มูลค่าที่ลดได้)',              unit: 'บาท', level: 'unit' },
  /* 🤝 แบบสอบถามความพึงพอใจลูกค้า (16/11 · user: "customer satisfaction ต้อง single source of truth
     และยิ่งค่าของโรงงาน ต้องมีค่าเดียว ดึงไปใช้เอา") — คะแนนดิบของ "แบบสอบถามใบเดียวของโรงงาน"
     ⇒ `level:'plant'` = กรอกครั้งเดียวที่ขอบเขต ทั้งโรงงาน · ทุกหน่วยที่มี KPI ข้อนี้อ่านตัวเดียวกัน
     🔴 ห้ามเพิ่มที่กรอกชุดที่ 2 ต่อหน่วย (ตารางของตัวเอง/ช่องกรอกในหน้า) — มี 2 ที่กรอก = ไม่มีค่าเดียว */
  { key: 'csat_q_actual', label: 'ความพึงพอใจ — คะแนนที่ได้ ด้านคุณภาพ (Q)',     unit: 'คะแนน', level: 'plant' },
  { key: 'csat_q_total',  label: 'ความพึงพอใจ — คะแนนเต็ม ด้านคุณภาพ (Q)',       unit: 'คะแนน', level: 'plant' },
  { key: 'csat_d_actual', label: 'ความพึงพอใจ — คะแนนที่ได้ ด้านการส่งมอบ (D)',  unit: 'คะแนน', level: 'plant' },
  { key: 'csat_d_total',  label: 'ความพึงพอใจ — คะแนนเต็ม ด้านการส่งมอบ (D)',    unit: 'คะแนน', level: 'plant' },
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
  /* `parts` (16/11 · user: "dl+oh พอเจาะเข้าไปควรแตกเป็น 2 กราฟ dl กับ oh") = สูตรลูกที่ใช้ตัวแปรชุดเดียวกัน — จอ 🔍 วาดให้เองผ่าน `formulaPartSeries()` */
  { key: 'dloh_pct',      label: 'DL&OH %',     expr: '(dl + oh) ÷ sale_product × 100',           vars: ['dl', 'oh', 'sale_product'],       unit: '%', parts: ['dl_pct', 'oh_pct'] },
  { key: 'rm_pct',        label: '%RM',         expr: 'raw_material ÷ sale_product × 100',        vars: ['raw_material', 'sale_product'],   unit: '%' },
  { key: 'p100_pct',      label: '100P %',      expr: 'cost_100p ÷ sale_product × 100',           vars: ['cost_100p', 'sale_product'],      unit: '%' },
  { key: 'inventory_day', label: 'DSI (วัน)',   expr: '(inventory_baht ÷ cogs) × days_in_month',      vars: ['inventory_baht', 'cogs', 'days_in_month'], unit: 'วัน' },
  /* 19/10 ใบจริง "5.Manpower" แถว "Sale All / Head (All)" = **Accumulate Total Sale (ม.ค.→เดือนนี้) ÷ Total Head count (All) ของเดือนนั้น**
     (เม.ย. 706.43 ÷ 392 = 1.802 · พ.ค. 887.45 ÷ 384 = 2.311 · ทั้งปี 2,118.70 ÷ 386 = 5.489 = เป้า) ⇒ ตัวตั้งสะสม YTD ไม่ใช่ยอดเดือนเดียว (`cum`) */
  /* 09/11 user: "sales/head ต้องเท่ากันทุกส่วนงาน เป็นค่ากลาง ยอดขายรวม ÷ ยอดคนทั้งโรงงาน จากไฟล์บัญชี" ⇒ `scope:'plant'` = ทุกตัวแปรอ่านจาก ทั้งโรงงาน
     ไม่ว่านิยามจะอยู่หน่วยไหน (เคส PD1: Σ ยอดขายโรงงาน ÷ กำลังคน PD1 32 คน = 47.951 ทั้งที่ค่ากลาง ~4) · catalog `value_scope='plant'` ให้ทุกหน่วยอ่านแผ่นโรงงาน */
  { key: 'sale_per_head', label: 'ยอดขาย/หัว (MB)', expr: 'Σ sale_total (ม.ค.→เดือนนี้) ÷ manpower ทั้งโรงงาน ÷ 1,000,000', vars: ['sale_total', 'manpower'], cum: ['sale_total'], unit: 'MB', scope: 'plant' },
  /* ── 🤝 ความพึงพอใจลูกค้า (Q&D) · 16/11 ─────────────────────────────────────────────────────
     ทะเบียนกลางของกลุ่ม (`kpi_standard_items` 2026) เขียนหัวข้อนี้เป็น **1 แถว 1 คะแนน** สูตร
     `(Actual Score / Total Score) x 100` · **ทะเบียนไม่มีข้อย่อย Q และ D** — `(Q&D)` คือ *ขอบเขตของ
     แบบสอบถาม* (คุณภาพ + การส่งมอบ) ไม่ใช่ KPI 2 ตัว ⇒ ห้ามแตกเป็น 2 แถว KPI / 2 คะแนน / 2 น้ำหนัก
     ⇒ แตกที่ **ตัวแปรฐาน** แทน: 4 ช่อง (ได้/เต็ม × Q/D) ที่ขอบเขต ทั้งโรงงาน
     🔴 ค่ารวม = (Σคะแนนที่ได้ ÷ Σคะแนนเต็ม) × 100 — **ห้ามเฉลี่ย % ของ 2 ขา** (ตัวหารแต่ละขาไม่เท่ากัน
        เฉลี่ยแล้วได้เลขที่ไม่มีอยู่ในใบจริง) · `parts` = % ของขานั้นเทียบคะแนนเต็มของขาเอง (คนละคำถาม
        กับค่ารวม) จอ 🔍 วาดแยกคนละกราฟ พร้อมสูตรของตัวเอง ไม่ได้ซ้อนทับให้บวกกัน
     🔴 `scope:'plant'` = ทุกตัวแปรอ่านจากขอบเขต ทั้งโรงงาน ไม่ว่านิยามจะอยู่หน่วยไหน (QA · PD1-4 ·
        Die MTN เห็นเลขเดียวกับโรงงาน) — นี่คือ "ค่าเดียว ดึงไปใช้" ที่ user สั่ง 16/11
     ℹ️ `Internal Satisfaction` ของหน่วยสนับสนุน = **แบบสอบถามคนละใบ รายหน่วย** ยังกรอกมือที่หน่วยนั้น
        ห้ามเอามารวมสูตรนี้ (Tooling MTN มีค่าจริงของตัวเอง 7 เดือน) */
  { key: 'csat_q_pct',    label: 'ความพึงพอใจ — คุณภาพ (Q) %',   expr: 'csat_q_actual ÷ csat_q_total × 100', vars: ['csat_q_actual', 'csat_q_total'], unit: '%', scope: 'plant' },
  { key: 'csat_d_pct',    label: 'ความพึงพอใจ — ส่งมอบ (D) %',   expr: 'csat_d_actual ÷ csat_d_total × 100', vars: ['csat_d_actual', 'csat_d_total'], unit: '%', scope: 'plant' },
  { key: 'csat_qd_pct',   label: 'Customer Satisfaction (Q&D) %', expr: '(csat_q_actual + csat_d_actual) ÷ (csat_q_total + csat_d_total) × 100',
    vars: ['csat_q_actual', 'csat_q_total', 'csat_d_actual', 'csat_d_total'], unit: '%', scope: 'plant', parts: ['csat_q_pct', 'csat_d_pct'] },
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
    case 'csat_q_pct':    value = div(v.csat_q_actual, v.csat_q_total); break;
    case 'csat_d_pct':    value = div(v.csat_d_actual, v.csat_d_total); break;
    /* 🔴 ตัวตั้งรวม ÷ ตัวหารรวม — ห้ามเฉลี่ย (csat_q_pct + csat_d_pct) ÷ 2 */
    case 'csat_qd_pct':   value = div(v.csat_q_actual + v.csat_d_actual, v.csat_q_total + v.csat_d_total); break;
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

export const summaryModeLabel = (k) => KPI_SUMMARY_MODES.find(m => m.key === k)?.label || k;
/** ป้ายสั้นไว้ติดคอลัมน์สรุป — **จอต้องเขียนให้ตรงวิธีรวมของแถวนั้น ห้ามพิมพ์ "เฉลี่ย" ตายตัว**
 *  (บั๊กที่เจอ 23/09: Scrap ต้องรวมทั้งปี 1,628 แต่จอโชว์ 271.4 = เฉลี่ย โดยหัวคอลัมน์ยังเขียนว่า "เฉลี่ย") */
export const summaryShort = (k) => (
  { average: 'เฉลี่ย', sum: 'รวมปี', max: 'สูงสุด', as_of: 'ล่าสุด', rate: 'ทั้งปี' }[k] || 'เฉลี่ย');

/* ── 5.1) ตั้งค่า 2 ชั้น: ทะเบียน `kpi_catalog` = ค่าตั้งต้น · นิยามรายแถว = override (24/09) ──
   คำถาม user: "หน่วย/ทศนิยม/average-total ตั้งที่ไหน ตั้งต่อจากทะเบียนหรือควรแยก" → ตอบ **2 ชั้น**
     🔒 **วิธีรวม 12 เดือน = ของตัวตน KPI → ทะเบียนอย่างเดียว ห้าม override รายแถว**
        (PPM คิดจากยอดรวมทั้งปีเสมอ · Scrap รวมเสมอ ไม่ว่าแผนกไหน — ปล่อยให้ตั้งเองรายแผนก
         = แผนกหนึ่งเฉลี่ย อีกแผนกรวม แล้วเอาเลขมาเทียบกันไม่ได้ · บั๊กคลาสเดียวกับ "30 วัน คนละเลข")
     🔓 **หน่วย + ทศนิยม = ทะเบียนตั้ง default · แถว override ได้** (ว่าง/null = ตามทะเบียน)
        หลักฐานว่าต้อง override ได้: MTBF ใบ JIG ใช้ "นาที" เด็คใช้ "ชม." · DSI มี 2 หน่วยทางการ (วัน / MB)
   ⚠️ ทุกตัวรับ "แถว kpi_definitions ที่ embed `kpi_catalog` มาด้วย" — ไม่ได้ embed = ได้ค่าของแถวล้วน
      (ไม่พัง แต่จะไม่เห็นค่าตั้งต้นจากทะเบียน) */
export const unitOf = (d) => (d?.unit || d?.kpi_catalog?.unit || '');

export function decimalsOf(d) {
  for (const v of [d?.decimals, d?.kpi_catalog?.decimals]) {
    if (v == null || v === '') continue;
    const n = Number(v);
    if (Number.isFinite(n)) return Math.min(6, Math.max(0, Math.round(n)));
  }
  return 2;
}

/** 🧱 ช่วงค่าที่ "เป็นไปได้" ของตัวตน KPI (20/11 · user: "เดือนที่เหลือ ถ้าเป็นไปไม่ได้ ไม่ควรคาดการณ์ — OEE > 100 % · MTTR ติดลบ")
    อ่านจากทะเบียน `kpi_catalog.value_min/value_max` เท่านั้น (ตั้งที่ปุ่ม 📘 ทะเบียน · seed: ทุกตัว ≥ 0 · % ≤ 100 · PPM ≤ 1e6)
    · null = ไม่จำกัดด้านนั้น · **ห้าม hardcode "% = 100" ในหน้า** — ทะเบียนแก้ได้รายตัว (เช่น % เติบโตเกิน 100 ได้) */
export function valueBoundsOf(d) {
  const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
  const c = d?.kpi_catalog || d;
  return { min: num(c?.value_min), max: num(c?.value_max) };
}

/** วิธีรวมของแถว — อ่านจากทะเบียนเท่านั้น · คีย์แปลก/ไม่มี = `average` (ไม่ใช่พัง) */
export function summaryModeOf(d) {
  const k = d?.kpi_catalog?.summary_mode || d?.summary_mode;
  return KPI_SUMMARY_MODES.some(m => m.key === k) ? k : 'average';
}

/* ── 5.2) KPI ที่ "ค่าเป็นของโรงงาน" (30/09 · คำสั่ง user: %RM + Customer Satisfaction ทุกหน่วยใช้ตัวเลขเดียวกัน) ──
   `kpi_catalog.value_scope` = 'own' (ค่าของหน่วยงานเอง) | 'plant' (ค่าโรงงาน) — data-driven ตั้งจากปุ่ม 📘 ทะเบียน
   🔴 กติกา: KPI แบบ plant **ค่ารายเดือนอยู่ที่นิยามระดับโรงงานตัวเดียว** · นิยามของหน่วยงานยังมีได้
      (เก็บเป้า/น้ำหนัก/ลำดับในใบของหน่วยนั้น) แต่ทุกจอต้องอ่านค่าจาก `sharedValueDef()` ห้ามอ่าน entries ของตัวเอง
      · ไม่มีนิยามโรงงาน = "ยังไม่มีค่า" + จอต้องบอกว่าไปสร้างที่ขอบเขต ทั้งโรงงาน (ห้ามถอยไปใช้ค่าของหน่วยเงียบๆ) */
export const KPI_VALUE_SCOPES = [
  { key: 'own',   label: 'ของหน่วยงานเอง (แต่ละหน่วยกรอกของตัวเอง)' },
  { key: 'plant', label: 'ค่าโรงงาน — ทุกหน่วยที่ถือ KPI นี้ใช้ตัวเลขเดียวกัน' },
];
export const valueScopeOf = (d) => ((d?.kpi_catalog?.value_scope || d?.value_scope) === 'plant' ? 'plant' : 'own');
const normKpiName = (x) => String(x ?? '').toLowerCase().replace(/[\s\-_./()]+/g, '');
const isPlantDef = (x) => x?.scope_kind === 'plant' || (!x?.scope_kind && !x?.section && !x?.line_group);
/** นิยามระดับโรงงานที่ถือ "ค่า" ของ KPI แบบ plant — จับคู่ด้วย catalog_id ก่อน ไม่มีค่อยเทียบชื่อ · คืน null = ยังไม่มี
 *  (ส่งนิยามโรงงานเข้ามาเอง = คืนตัวมันเอง) · KPI แบบ own = null เสมอ */
export function sharedValueDef(defs, d) {
  if (valueScopeOf(d) !== 'plant') return null;
  const cid = d?.catalog_id || d?.kpi_catalog?.id || null;
  const nm = normKpiName(d?.kpi_catalog?.name || d?.name);
  return (defs || []).find(x => x && x.is_active !== false && isPlantDef(x)
    && !String(x.source || '').startsWith('auto:')
    && (d?.year == null || x.year == null || Number(x.year) === Number(d.year))
    && ((cid && x.catalog_id === cid) || normKpiName(x.kpi_catalog?.name || x.name) === nm)) || null;   // แถวเก่าไม่มี catalog_id = เทียบชื่อ (ชื่อคือตัวตนของทะเบียนอยู่แล้ว · unique index)
}

/** 5.3) นิยามระดับโรงงานที่ "ต้องมี" สำหรับ KPI แบบ plant (19/10 · เคสจริง: Customer Satisfaction ถูกตั้งเป็นค่าโรงงาน 30/09
 *  โดยไม่มีนิยาม scope plant ⇒ ทุกหน่วยขึ้นว่าง + ค่าที่ PD4 กรอกไว้ 8 เดือนถูกซ่อน 3 สัปดาห์)
 *  → รายการทะเบียน plant ที่ปีนี้ยังไม่มีนิยามโรงงาน พร้อมจำนวนค่าที่หน่วยกรอกไว้แล้วแต่ไม่แสดง (จอต้องเขียนบอก) */
export function missingPlantValueDefs(defs = [], entries = {}) {
  const out = new Map();
  for (const d of defs || []) {
    if (!d || d.is_active === false || valueScopeOf(d) !== 'plant' || isPlantDef(d)) continue;
    if (sharedValueDef(defs, d)) continue;
    const key = d.catalog_id || d.kpi_catalog?.id || normKpiName(d.kpi_catalog?.name || d.name);
    const cur = out.get(key) || { key, catalogId: d.catalog_id || d.kpi_catalog?.id || null, name: d.kpi_catalog?.name || d.name, year: d.year ?? null, unitDefs: [], hiddenEntries: 0 };
    cur.unitDefs.push(d);
    cur.hiddenEntries += Object.values(entries?.[d.id] || {}).filter(v => v != null).length;
    out.set(key, cur);
  }
  return [...out.values()];
}

/** payload สร้างนิยามระดับโรงงานจากนิยามของหน่วย (โคลนเป้า/หน่วย/ทิศทาง/ทะเบียน · ขอบเขต = ทั้งโรงงาน · ไม่ก๊อป entries) */
export function plantDefPayloadFrom(u, { year = null, note = '' } = {}) {
  if (!u) return null;
  const pick = (k) => (u[k] === undefined ? null : u[k]);
  return {
    year: year ?? u.year ?? null, section: null, line_group: null, scope_kind: 'plant', scope_value: null,
    category: pick('category') || 'internal', seq: Number(u.seq) || 0, name: u.kpi_catalog?.name || u.name,
    formula_text: pick('formula_text'), scope_text: note || `ค่าโรงงาน — สร้างอัตโนมัติจากนิยามของ ${u.scope_value || u.section || 'หน่วยงาน'}`,
    unit: pick('unit'), decimals: pick('decimals'), commitment: pick('commitment'), target: pick('target'), target_value: pick('target_value'),
    direction: pick('direction'), commit_compare: pick('commit_compare'), commit_value: pick('commit_value'), target_compare: pick('target_compare'),
    weight: null, source: 'manual', is_active: true, catalog_id: u.catalog_id || u.kpi_catalog?.id || null, std_item_id: pick('std_item_id'),
    provider: u.provider === 'formula' ? 'formula' : 'manual', provider_config: u.provider === 'formula' ? (u.provider_config ?? null) : null,
  };
}

/* ── 5.4) ช่องบนบอร์ด OBEYA (30/09 · user: "inventory balance กับ DSI คือเรื่องเดียวกัน · training กับ TS Academy คือสกอเดียวกัน") ──
   บอร์ด 8 แผ่นหลักเคยจับคู่ด้วย "ชื่อตรงตัว" ⇒ ชื่อทางการในทะเบียน (Day Sales of Inventory (DSI) / TS Academy training)
   ไม่ตรงชื่อบนบอร์ดกระดาษ (Inventory Balance / Training) ⇒ แผ่นขึ้น "ยังไม่ได้ตั้ง KPI" ทั้งที่กรอกครบ
   ⇒ `kpi_catalog.board_slot` = ทะเบียนบอกเองว่าขึ้นแผ่นไหน (ตั้งจากปุ่ม 📘) · คีย์ต้องตรง `boardRowsFor()` ใน ObeyaKpiBoard
   · ทะเบียนที่ตั้ง slot แล้ว **ห้ามจับคู่ด้วยชื่ออีก** (ไม่งั้น KPI ที่ตั้งใจย้ายช่องจะโผล่ 2 ที่) · null = เทียบชื่อแบบเดิม (ของเก่า) */
export const KPI_BOARD_SLOTS = [
  { key: 'rm',    label: '%RM (Raw Material)' },
  { key: 'dloh',  label: 'DL+OH (Direct Labor + Overhead)' },
  { key: 'dl',    label: 'Direct Labor (ปี ≤ 2025)' },
  { key: 'oh',    label: 'Overhead (ปี ≤ 2025)' },
  { key: 'inv',   label: 'Inventory Balance / DSI' },
  { key: 'csat',  label: 'Customer Satisfaction' },
  { key: 'oee',   label: 'OEE' },
  { key: 'ppm',   label: 'PPM' },
  { key: 'safe',  label: 'Safety' },
  { key: 'train', label: 'Training / TS Academy' },
];
export const boardSlotOf = (d) => {
  const k = d?.kpi_catalog?.board_slot || d?.board_slot || null;
  return KPI_BOARD_SLOTS.some(s => s.key === k) ? k : null;
};

/* ── 5.3) คาดการณ์ปลายปี = "ผลจริงที่มีแล้ว + แผนของเดือนที่เหลือ" (30/09 · คำสั่ง user) ─────────────
   *"มันจะมีบางค่า จะคิดแบบ Actual+Plan ที่เหลือ เพื่อสรุปว่าปีนี้จะรอดหรือร่วง"*
   · เดือนที่มีผลจริง → ใช้ผลจริง · เดือนที่ยังไม่มีผล → ใช้แผน (`kpi_month_plans`) · รวมด้วยวิธีรวมของ KPI ตัวนั้น
   · 🔴 เดือนที่ไม่มีทั้งผลและแผน = **คาดการณ์ไม่ได้** (`value:null` + `missing`) — ห้ามเดา ห้ามเติม 0 ห้ามลากค่าเฉลี่ยไปแทน
   · `rate` ไม่มียอดดิบของแผนให้หาร ⇒ เฉลี่ย + `approx` (กฎเดียวกับ summaryOf/planProgress)
   · ตัดสิน "รอด/ร่วง" ที่ผู้เรียกด้วย `scoreDef(value, def)` — ที่นี่ไม่ตัดสิน (สูตรสีมีที่เดียว) */
export function yearForecast({ actual = [], plan = [], def = null, fallback = false } = {}) {
  const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
  const a = Array.from({ length: 12 }, (_, i) => num(actual[i]));
  const p = Array.from({ length: 12 }, (_, i) => num(plan[i]));
  const mode0 = summaryModeOf(def);
  const approx = mode0 === 'rate';
  const mode = approx ? 'average' : mode0;
  /* 📈 16/11 (user: "ทุกกราฟตอบไม่ได้ว่าจบปีจะผ่านไหม เดือนที่ยังไม่ถึงเหมือนไม่มีค่า") — `fallback: true` =
     เดือนที่ไม่มีทั้งผลและแผน **สมมติว่าทำได้เท่าเดิม** แล้วบอกบนจอว่าสมมติอะไร (ห้ามเนียนเป็นแผน):
     · ตัวไม่สะสม (average/sum/rate≈average) = เท่าค่าเฉลี่ยของเดือนที่มีผลจริง
     · ตัวสะสม (max/as_of) = เพิ่มต่อด้วยอัตราเดิม (ค่าล่าสุด ÷ จำนวนเดือนที่เดินมา) — ค่าสะสมถอยหลังไม่ได้
     ค่าเริ่มต้น (ไม่ส่ง fallback) = พฤติกรรมเดิมเป๊ะ: ขาดเดือนไหน = คาดไม่ได้ */
  const have = a.filter(x => x != null);
  const cumulative = mode === 'max' || mode === 'as_of';
  const lastIdx = a.map((x, i) => (x != null ? i : -1)).reduce((m, i) => Math.max(m, i), -1);
  const firstIdx = a.findIndex(x => x != null);
  let assumed = null;
  if (fallback && have.length) {
    if (cumulative) {
      const last = a[lastIdx];
      const slope = lastIdx > firstIdx ? (last - a[firstIdx]) / (lastIdx - firstIdx) : last / (lastIdx + 1);
      assumed = { kind: 'slope', rate: slope, from: last, fromIdx: lastIdx };
    } else {
      assumed = { kind: 'average', rate: have.reduce((s, x) => s + x, 0) / have.length };
    }
  }
  const used = []; const missing = []; const months = []; const src = []; const assumedMonths = [];
  let actualMonths = 0, planMonths = 0;
  for (let m = 1; m <= 12; m++) {
    const i = m - 1;
    if (a[i] != null) { used.push(a[i]); months.push(a[i]); src.push('actual'); actualMonths += 1; }
    else if (p[i] != null) { used.push(p[i]); months.push(p[i]); src.push('plan'); planMonths += 1; }
    else if (assumed) {
      const v = assumed.kind === 'slope' ? assumed.from + assumed.rate * Math.max(0, i - assumed.fromIdx) : assumed.rate;
      used.push(v); months.push(v); src.push('assumed'); assumedMonths.push(m);
    } else { missing.push(m); months.push(null); src.push(null); }
  }
  const basis = assumedMonths.length ? (planMonths ? 'mixed' : 'runrate') : planMonths ? 'plan' : 'actual';
  const base = { mode, approx, actualMonths, planMonths, assumedMonths, assumed, basis, months, src };
  if (!actualMonths) return { ...base, value: null, reason: 'no_actual', missing };
  if (missing.length) return { ...base, value: null, reason: 'no_plan', missing };
  return { ...base, value: summarizeMonths(used, mode), reason: null, missing: [] };
}

/** 🎯 "เดือนที่เหลือต้องทำได้เท่าไหร่ถึงจะถึงเป้าทั้งปี" (16/11) — คู่กับ yearForecast · pure
 *  · average: (เป้า × 12 − Σ จริง) ÷ เดือนที่เหลือ · sum: (เป้า − Σ จริง) ÷ เดือนที่เหลือ
 *  · ตัวสะสม (max/as_of): ต้อง "ไปถึง" เป้าภายใน ธ.ค. ⇒ คืนส่วนที่ต้องเพิ่มจากค่าล่าสุด · rate: คำนวณไม่ได้ (ต้องรู้ยอดดิบ)
 *  @returns null เมื่อไม่มีเป้า/ไม่มีผลจริง/ครบ 12 เดือนแล้ว · ไม่งั้น { kind:'avg'|'sum'|'reach', perMonth, remaining, add? } */
export function neededRunRate({ actual = [], target = null, def = null } = {}) {
  const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
  const t = num(target);
  const a = Array.from({ length: 12 }, (_, i) => num(actual[i]));
  const have = a.filter(x => x != null);
  const remaining = 12 - have.length;
  if (t == null || !have.length || remaining <= 0) return null;
  const mode0 = summaryModeOf(def);
  const sum = have.reduce((s, x) => s + x, 0);
  if (mode0 === 'rate') return null;
  /* 🧱 เป็นไปได้ไหม (20/11): ที่ต้องทำต่อเดือนหลุดช่วง `valueBoundsOf()` ของทะเบียน = **เป็นไปไม่ได้** (`feasible:false` + `limit` ด้านที่ชน)
     · ตัวยิ่งสูงยิ่งดี: ต้องได้ ≤ พื้น = ผ่านแน่ (`trivial`) · เกินเพดาน = ไม่ทัน
     · ตัวยิ่งต่ำยิ่งดี: ต้องไม่เกิน ≥ เพดาน = ผ่านแน่ · ต่ำกว่าพื้น = ไม่ทัน
     · ไม่มีขอบด้านนั้นในทะเบียน = ไม่ตัดสิน (feasible ตามเดิม) — จอยังโชว์ตัวเลข */
  const down = String(def?.direction || def?.kpi_catalog?.direction || '').toLowerCase() === 'down';
  const b = valueBoundsOf(def);
  const judge = (perMonth) => {
    if (down) {
      if (b.min != null && perMonth < b.min) return { feasible: false, limit: { kind: 'min', value: b.min } };
      if (b.max != null && perMonth >= b.max) return { feasible: true, trivial: true, limit: { kind: 'max', value: b.max } };
    } else {
      if (b.max != null && perMonth > b.max) return { feasible: false, limit: { kind: 'max', value: b.max } };
      if (b.min != null && perMonth <= b.min) return { feasible: true, trivial: true, limit: { kind: 'min', value: b.min } };
    }
    return { feasible: true, trivial: false, limit: null };
  };
  /* `bestCase` (เฉพาะเป็นไปไม่ได้) = ค่าสรุปทั้งปี "ดีที่สุดที่ยังเป็นไปได้" ถ้าเดือนที่เหลือทำได้สุดขอบทุกเดือน — จอโชว์ตัวนี้แทนตัวเลขติดลบ/เกิน 100 */
  if (mode0 === 'max' || mode0 === 'as_of') {
    const last = a[a.map((x, i) => (x != null ? i : -1)).reduce((m, i) => Math.max(m, i), -1)];
    const j = judge(t);
    return { kind: 'reach', perMonth: t, remaining, add: t - last, ...j, bounds: b, bestCase: j.feasible ? null : j.limit.value };
  }
  if (mode0 === 'sum') {
    const pm = (t - sum) / remaining; const j = judge(pm);
    return { kind: 'sum', perMonth: pm, remaining, ...j, bounds: b, bestCase: j.feasible ? null : sum + remaining * j.limit.value };
  }
  const pm = (t * 12 - sum) / remaining; const j = judge(pm);
  return { kind: 'avg', perMonth: pm, remaining, ...j, bounds: b, bestCase: j.feasible ? null : (sum + remaining * j.limit.value) / 12 };
}

/** จัดรูปตัวเลขตามทศนิยมของแถว — `null`/ไม่ใช่ตัวเลข = สตริงว่าง **ห้ามคืน 0** */
export function fmtKpi(v, d) {
  if (v == null || v === '' || !Number.isFinite(Number(v))) return '';
  return Number(v).toLocaleString(undefined, { maximumFractionDigits: decimalsOf(d) });
}

/**
 * สรุป 12 เดือนของแถวหนึ่งตามวิธีรวมของมัน
 * @returns { value, mode, effMode, approx } — `approx` = วิธีจริงคือ `rate` แต่ไม่มียอดดิบให้หาร
 *   ⇒ ถอยมาเฉลี่ยรายเดือน **จอต้องติดป้าย ≈ ห้ามโชว์เหมือนเป็นตัวเลขทางการ**
 *   (แถวกรอกมือมีแต่ค่า PPM รายเดือน ไม่มี Σของเสีย/Σยอดผลิต ⇒ คำนวณสูตรทางการไม่ได้)
 */
export function summaryOf(months = [], d = null, rate = null) {
  const mode = summaryModeOf(d);
  if (mode === 'rate' && !rate) {
    return { value: summarizeMonths(months, 'average'), mode, effMode: 'average', approx: true };
  }
  return { value: summarizeMonths(months, mode, rate), mode, effMode: mode, approx: false };
}

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

/* ── 5.2) แผนรายเดือน (`kpi_month_plans`) — "ถึงเดือนนี้ควรอยู่ตรงไหน" (2026-09-25) ────────
   🔴 **ไม่ใช่คะแนน** — คะแนนทางการยังมาจาก `scoreDef()` ตัวเดียว (1 / 0.5 / 0)
      **ห้ามเอาผลของตัวนี้ไปเปลี่ยนสี/ขั้นคะแนน หรือเพิ่มขั้นใหม่** (กฎ: เกณฑ์สีมีเอกสารแล้ว ห้ามคิดเอง)
      เด็คทบทวนของจริงเขียน `◐ In progress` กับ KPI สะสม — ขั้นนั้น**ไม่มีในประกาศ QSM-R2 001/2569**
   ปัญหาที่ตัวนี้แก้: KPI สะสม (100P · Annual Sales per Head · TS Academy) ถูกเทียบกับเป้า "ทั้งปี"
      ตั้งแต่เดือนแรก ⇒ แดงทุกเดือนจนถึง ธ.ค. ทั้งที่เดินตามแผน — จอโกหกโดยโครงสร้าง ไม่ใช่ข้อมูลผิด
   วิธี: เทียบ **ผลถึงเดือนนี้ vs แผนถึงเดือนนี้** โดยรวมทั้งสองชุดด้วย "วิธีรวม" ของ KPI ตัวนั้นเอง
      (`sum` = Σ ถึงเดือนนี้ · `max` = ตัวสะสมล่าสุด · `average` = เฉลี่ยถึงเดือนนี้ · `as_of` = เดือนล่าสุด)
   🔴 **เทียบเฉพาะเดือนที่มีทั้งแผนและผล** แล้วคืนจำนวนเดือนที่ใช้/ที่ข้ามเสมอ —
      ถ้ารวมทั้งช่วงทั้งที่แผนขาดบางเดือน Σ แผนจะต่ำกว่าจริง ⇒ ขึ้นว่า "นำแผน" ทั้งที่แค่ยังไม่ได้ตั้งแผน
   @param actual  ค่าจริง 12 ช่อง (index 0 = ม.ค.)
   @param plan    แผน 12 ช่อง
   @param def     แถว kpi_definitions (+ embed kpi_catalog) — ใช้หาวิธีรวม + ทิศทาง
   @param upTo    เดือนสุดท้ายที่นับ (1-12) · ไม่ส่ง = เดือนล่าสุดที่มีผลจริง
   @returns null = ยังไม่มีอะไรให้เทียบ · หรือ
     { upTo, months, skipped, actual, plan, diff, diffPct, onTrack, dir, mode, approx }
     `onTrack` null = ไม่รู้ทิศทางของเป้า (ห้ามเดา — จอต้องบอกว่าตัดสินไม่ได้) */
export function planProgress({ actual = [], plan = [], def = null, upTo = null } = {}) {
  const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
  const a = Array.from({ length: 12 }, (_, i) => num(actual[i]));
  const p = Array.from({ length: 12 }, (_, i) => num(plan[i]));

  const lastActual = a.reduce((last, v, i) => (v != null ? i + 1 : last), 0);
  const end = upTo == null ? lastActual
    : Math.min(12, Math.max(0, Math.round(Number(upTo)) || 0));
  if (!end) return null;

  const months = [];
  for (let m = 1; m <= end; m++) if (a[m - 1] != null && p[m - 1] != null) months.push(m);
  if (!months.length) return null;
  /* เดือนที่มีผลแต่ยังไม่ได้ตั้งแผน — จอต้องเขียนให้เห็น ไม่ใช่เงียบแล้วเทียบไปเลย */
  let skipped = 0;
  for (let m = 1; m <= end; m++) if (a[m - 1] != null && p[m - 1] == null) skipped += 1;

  const mode0 = summaryModeOf(def);
  /* `rate` คิดจากยอดดิบทั้งปี — แผนไม่มียอดดิบให้หาร ⇒ ถอยมาเฉลี่ย แล้วติดป้าย approx (กฎเดียวกับ summaryOf) */
  const approx = mode0 === 'rate';
  const mode = approx ? 'average' : mode0;
  const pick = (arr) => months.map(m => arr[m - 1]);
  const av = summarizeMonths(pick(a), mode);
  const pv = summarizeMonths(pick(p), mode);
  if (av == null || pv == null) return null;

  const bars = defBars(def || {});
  const cmp = bars.target_compare || bars.commit_compare || null;
  const dir = cmp == null ? null : (String(cmp).startsWith('<') ? 'down' : String(cmp).startsWith('>') ? 'up' : null);

  const diff = av - pv;
  return {
    upTo: end,
    months: months.length,
    skipped,
    actual: av,
    plan: pv,
    diff,
    diffPct: pv === 0 ? null : (diff / Math.abs(pv)) * 100,
    onTrack: dir == null ? null : (dir === 'up' ? av >= pv : av <= pv),
    dir, mode, approx,
  };
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

/* 📅 ตัดสินรายเดือนด้วย "แผนสะสมของเดือนนั้น" (11/11 · คำสั่ง user เลือกแบบ ข: Plan รายเดือนจากชีทบัญชี)
   KPI สะสม (ยอดขาย/หัว) เทียบกับเป้าทั้งปีตั้งแต่กลางปี = แดงทุกเดือนจนถึง ธ.ค. ทั้งที่บัญชีตัดสินเทียบ Plan สะสมของเดือนนั้น
   · เปิดต่อแถวด้วย `kpi_definitions.score_by_plan` · แผนอยู่ `kpi_month_plans` (ตารางเดิม) · เดือนที่ไม่มีแผน = ถอยไปเทียบเป้าทั้งปีตามเดิม
   · Commitment ของเดือน = แผน × (commit ปี ÷ target ปี) เมื่อมีทั้งคู่ — ไม่มี = ไม่มีขั้น 0.5 เดือนนั้น
   🔴 จอห้ามคิดเอง — ส่ง `{ plan }` เข้า scoreDef แล้วอ่าน `bars.byPlan` ไปเขียนบนจอว่าเทียบกับแผนเดือนไหน */
export function planBarsOf(def = {}, plan = null) {
  const bars = defBars(def);
  const pv = plan == null || plan === '' || Number.isNaN(Number(plan)) ? null : Number(plan);
  if (!def?.score_by_plan || pv == null) return { ...bars, byPlan: false };
  const t = bars.target_value, c = bars.commit_value;
  const ratio = t != null && c != null && Number(t) !== 0 ? Number(c) / Number(t) : null;
  return { ...bars, target_value: pv, commit_value: ratio != null ? pv * ratio : null, commit_compare: ratio != null ? bars.commit_compare || bars.target_compare : null, byPlan: true, annualTarget: t };
}

/** ให้คะแนนแถว KPI จาก "แถวในฐาน" โดยตรง — คืน `status` ('good'/'warn'/'bad'/'unknown') ให้จอใช้ทำไฟด้วย
 *  opts.plan = แผนสะสมของเดือนที่ตัดสิน (ใช้เมื่อ def.score_by_plan) */
export function scoreDef(value, def = {}, { plan = null } = {}) {
  const bars = planBarsOf(def, plan);
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

/** เดา "หน่วยงานมาตรฐาน" จากชื่อขอบเขต — **เป็นข้อเสนอให้คนกดยืนยันเท่านั้น ห้ามตั้งให้เอง**
 *  (16/11 · เคส QA: ขอบเขตชื่อตรงกับหน่วยงานในทะเบียนเป๊ะ แต่ยังไม่มีแถว KPI เลยสักข้อ ⇒ จอต้องชี้ทางได้
 *   ไม่ใช่โชว์ตารางว่าง — กฎความซื่อสัตย์ของจอ · การเลือก KPI ต่อหน่วยงานเป็นการตั้งค่าของคน)
 *  🔴 ตรงเป๊ะเท่านั้น (ไม่สนตัวพิมพ์/ช่องว่าง/เครื่องหมาย) — ไม่ตรง = `null` ห้ามเดาคลุม
 *     เช่น "Tooling MTN" ต้องคืน null ไม่ใช่เดาเป็น "Tooling" (คนละชุด KPI กัน) */
/* ══ 🔧 ทะเบียน "หน่วยงานจริงในโรงงาน → หน่วยงานมาตรฐาน" (2026-11-19 · คำสั่ง user) ═══════════
   user 19/11: *"ทีมช่างใช้มาตรฐานเดียวกันคือ KPI Maintenance เพราะในแบบ KPI Die Maintenance
                 เหมือนเป็นของโรงงานสร้างแม่พิมพ์ใช้"*

   เหตุผลที่ต้องมีทะเบียนนี้ ไม่ใช่ผ่อนเกณฑ์การจับคู่ชื่อ:
     แบบ `Die Maintenance` ในทะเบียนกลางเป็นของ **ธุรกิจสร้าง-ขายแม่พิมพ์** —
     มี "Annual Sale Per Head" · "Manage project … on time delivery to customer" ·
     "Keep inventory no more than" · "Customer Satisfaction (Q&D)"
     ซึ่งทีมช่างที่ซ่อมแม่พิมพ์ในโรงงานปั๊มของเราไม่มีทางวัดได้ (ไม่มียอดขาย ไม่มีลูกค้าภายนอก)
     และ**ไม่มี MTBF / MTTR / MO Closed / Machine Break Down เลยสักตัว** ซึ่งคือเนื้องานจริงของช่าง
     ⇒ ทีมช่างทุกทีมอิงแบบ `Maintenance` (ที่มี Internal Satisfaction + ตัววัดงานซ่อมครบ)

   🔴 นี่คือ "การตั้งค่าของคน" ที่ user เคาะแล้ว **ไม่ใช่การเดาจากชื่อ** —
      `guessStdUnit` ยังคงกฎเดิมทุกอย่าง (ตรงเป๊ะเท่านั้น · ไม่ตรง = null) เพียงแต่ดูทะเบียนนี้ก่อน
      และผลลัพธ์ยังเป็น **ข้อเสนอให้คนกดยืนยัน ห้ามตั้งให้เอง** เหมือนเดิม
   🔴 คีย์เขียนแบบ "แบน" (ตัดช่องว่าง/ขีด/วงเล็บ ตัวพิมพ์เล็ก) ให้ตรงกับ flat() ข้างล่าง            */
export const KPI_STD_UNIT_ALIASES = Object.freeze({
  diemtn: 'Maintenance',       // ซ่อมบำรุงแม่พิมพ์ (ทีม die_maintenance)
  jigmtn: 'Maintenance',       // ซ่อมบำรุงจิ๊ก (ทีม jig_maintenance)
  toolingmtn: 'Maintenance',   // ซ่อมบำรุง Tooling — คนละตัวกับ std_unit 'Tooling' (ธุรกิจขายแม่พิมพ์)
  mechanic: 'Maintenance',
  electric: 'Maintenance',
});

export function guessStdUnit(name) {
  const flat = (s) => normTopic(s).replace(/[\s\-_.&/()]+/g, '');
  const n = flat(name);
  if (!n) return null;
  /* ทะเบียนที่คนเคาะมาก่อน แล้วค่อยจับชื่อตรงเป๊ะ */
  const alias = KPI_STD_UNIT_ALIASES[n];
  if (alias) return alias;
  return KPI_STD_UNITS.find(u => flat(u.unit) === n)?.unit || null;
}

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
  /* 🧾 "ของนอกมาตรฐาน" — แถวในใบที่ไม่มีอยู่ในทะเบียนของหน่วยงานนี้เลย (2026-11-19 · คำสั่ง user)
     เคสต้นเรื่อง: ใบของ **Die MTN** ถือแบบ `Die Maintenance` ซึ่งเป็นของธุรกิจสร้าง-ขายแม่พิมพ์
     ("Annual Sale Per Head" · "Keep inventory no more than" · "Manage project … delivery to customer")
     จอเดิมบอกได้แค่ "ข้อบังคับที่ยังไม่ได้หยิบ" ⇒ **ของแปลกปลอมที่ค้างอยู่ในใบมองไม่เห็นเลย**
     ⚠️ เตือนเท่านั้น ห้ามบล็อก และห้ามลบให้เอง — ใบจริงบางใบเพิ่มของนอกมาตรฐานได้โดยตั้งใจ (§6)
        คนเป็นคนตัดสินว่าจะเก็บหรือปิด (ปิด = `is_active=false` ไม่ใช่ลบ) */
  let extras = [];
  if (Array.isArray(stdItems)) {
    missingFixed = matchStdItems(stdItems.filter(isStdFixed), rows)
      .filter(m => !m.row)
      .map(m => m.item);

    const known = new Set();
    for (const m of matchStdItems(stdItems, rows)) if (m.row) known.add(m.row);
    extras = (Array.isArray(rows) ? rows : []).filter(r => r && !known.has(r));
  }
  return { weight, diff, ok: diff === 0 && missingFixed.length === 0, missingFixed, extras };
}

/* ══ ⚖️ น้ำหนักรวมของแต่ละหน่วยครบ 50 หรือยัง — ดูข้ามหน่วยในที่เดียว ══════════════════
   (2026-11-19 · คำสั่ง user "ทำหน้าสรุปน้ำหนักที่ยังไม่ครบเลย")

   เคสต้นเรื่อง: หลังย้ายทีมช่างมาอิงแบบ `Maintenance` แล้วหยิบข้อบังคับที่ขาดเข้าใบ
   **แถวใหม่ไม่มีน้ำหนัก** (ตั้งใจ — เอกสารกลุ่มให้หน่วยงานถ่วงเอง ระบบเดาแทนไม่ได้)
   ⇒ วัด 19/11 มีแค่ Tooling MTN ที่ครบ 50 · ที่เหลือ 22 / 11 / 9 / 5 / 0
   แต่ `checkStdSelection()` ตอบได้ทีละใบ ⇒ ต้องเปิดไล่ทีละหน่วยถึงจะรู้ว่าใครยังไม่ครบ

   🔴 ไม่คิดเกณฑ์ใหม่ — เรียก `checkStdSelection()` ตัวเดิมรายหน่วย (เพดาน 50 มีที่เดียวคือ
      `KPI_TOTAL_WEIGHT`) · ที่เพิ่มมาคือ "จัดกลุ่มตามขอบเขต แล้วเรียงตัวที่ห่างเป้าที่สุดขึ้นก่อน"
   🔴 `defs` ไม่ใช่ array (โหลดไม่ได้) = คืน `null` **ห้ามคืนลิสต์ว่าง** — ลิสต์ว่างแปลว่า
      "ครบทุกหน่วย" ซึ่งตรงข้ามกับความจริง (กฎความซื่อสัตย์ของจอ)
   ⚠️ เห็นเฉพาะหน่วยที่ **มีแถว KPI อยู่แล้ว** — หน่วยที่ยังไม่มีใบเลยไม่โผล่ที่นี่
      (คนละอาการ ไม่ใช่ "น้ำหนักขาด") ⇒ จอต้องเขียนกำกับ                                  */
export function weightAudit(defs, { scopeOf, labelOf } = {}) {
  if (!Array.isArray(defs)) return null;
  /* 🔴 ขอบเขตของกลุ่มต้องมาจาก **ชุดเดียว** ทั้งคีย์ · ป้าย · ปลายทางที่กดแล้วไป
        (19/11 เจอจริง: เคยจัดกลุ่มด้วยขอบเขตที่ยุบแล้ว แต่เก็บ `scope_kind/scope_value` ดิบไว้ทำป้าย
         ⇒ แถวที่ `scope_kind='plant'` แต่ `section='PD3'` ขึ้นป้าย "ทั้งโรงงาน" **และกดแล้วพาไปผิดใบ**)
     จอจริงส่ง `scopeOf` ที่ผ่าน `canonicalScope()` มา — CC ↔ หน่วยเจ้าของต้องนับเป็นขอบเขตเดียวกัน */
  const scOf = typeof scopeOf === 'function'
    ? scopeOf
    : (d) => ({ kind: d?.scope_kind || null, value: d?.scope_value ?? null });
  const keyOf = (sc) => (sc?.kind && sc.kind !== 'plant' ? `${sc.kind}:${sc.value ?? ''}` : 'plant');
  const groups = new Map();
  for (const d of defs) {
    if (!d || d.is_active === false) continue;
    const sc = scOf(d) || {};
    const k = keyOf(sc);
    if (!groups.has(k)) groups.set(k, { key: k, kind: sc.kind || null, value: sc.value ?? null, rows: [] });
    groups.get(k).rows.push(d);
  }
  const out = [];
  for (const g of groups.values()) {
    const chk = checkStdSelection(g.rows);
    out.push({
      key: g.key, kind: g.kind, value: g.value,
      label: (typeof labelOf === 'function' ? labelOf(g.kind, g.value) : null) || scopeLabel(g.kind, g.value),
      weight: chk.weight, diff: chk.diff, ok: chk.diff === 0,
      count: g.rows.length,
      /* แถวที่ยังไม่ได้ใส่น้ำหนักเลย — ตัวชี้ว่า "เพิ่งหยิบเข้ามา ยังไม่ได้ถ่วง" */
      /* ⚠️ `Number(null)` = 0 ซึ่ง finite ⇒ ต้องกัน null/undefined/'' ก่อน ไม่งั้นนับเป็น "ใส่น้ำหนักแล้ว" */
      noWeight: g.rows.filter(r => r?.weight == null || r.weight === '' || !Number.isFinite(Number(r.weight))).length,
      stdUnit: g.rows.map(r => r?.std_unit).find(Boolean) || null,
    });
  }
  /* 🔴 ป้ายซ้ำ = จอโกหก — เจอจริง 19/11 ตอนทดสอบ: 2 ใบคนละชุด (1 ข้อ กับ 3 ข้อ) ขึ้นว่า "ทั้งโรงงาน"
        เหมือนกันทั้งคู่ ⇒ คนอ่านแยกไม่ออกว่าต้องไปแก้ใบไหน (และนึกว่าระบบนับซ้ำ)
        ต่อคีย์ขอบเขตท้ายป้าย **เฉพาะตัวที่ชนกัน** — ตัวที่ชื่อไม่ซ้ำคงรูปเดิม ไม่ให้รกเปล่าๆ */
  const seen = new Map();
  for (const u of out) seen.set(u.label, (seen.get(u.label) || 0) + 1);
  for (const u of out) if (seen.get(u.label) > 1) u.label = `${u.label} [${u.key}]`;

  /* ห่างเป้ามากสุดขึ้นก่อน · เท่ากันเรียงชื่อ (เรียงคงที่ ไม่สลับไปมาทุกครั้งที่โหลด) */
  return out.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff) || String(a.label).localeCompare(String(b.label), 'th'));
}

/* ── 🧾 "KPI นี้ตัดสินยังไง" เป็นประโยคเดียว + ตรวจเกณฑ์ที่ตั้งขัดกัน (2026-11-16 · user: "หน้ากรอก KPI งงเรื่อง plan และผ่าน/ตก") ──
   เกณฑ์ทุกตัวตั้งได้ต่อ KPI อยู่แล้ว (เป้า · Commit · ทิศทาง · เทียบแผนรายเดือนไหม · วิธีสรุปปี) — ที่ขาดคือ "ประโยคสรุป" ให้คนกรอกเห็น
   · อ่านผ่าน defBars() เท่านั้น (ข้อความเก่าก็แกะให้) · ไม่คิดเกณฑ์ใหม่ · pure มีเทส */
export const CMP_SYM = { '<=': '≤', '>=': '≥', '<': '<', '>': '>', '=': '=' };
export function scoreRuleText(def = {}, { unit = null, fmt = (v) => String(v), summaryLabel = null } = {}) {
  const b = defBars(def);
  const u = unit != null ? unit : unitOf(def);
  const f = (v) => `${fmt(v)}${u ? ' ' + u : ''}`;
  const mode = summaryLabel || summaryModeLabel(summaryModeOf(def));
  if (b.target_value == null && b.commit_value == null) return { text: `ยังไม่ตั้งเป้า — ไม่ตัดสิน ○△✗ (เห็นแค่ตัวเลข) · สรุปปี = ${mode}`, ok: false, mode };
  const cmp = b.target_compare || b.commit_compare;
  if (!cmp) return { text: 'ตั้งเป้าไว้แต่ไม่ได้บอกทิศทาง (≥ หรือ ≤) — ตัดสิน ○△✗ ไม่ได้', ok: false, mode };
  const sym = CMP_SYM[cmp] || cmp;
  const down = String(cmp).startsWith('<');
  const parts = [];
  if (b.target_value != null) parts.push(`○ ${sym} ${f(b.target_value)}`);
  if (b.commit_value != null) parts.push(`△ ${sym} ${f(b.commit_value)}`);
  parts.push(`✗ ${down ? 'เกิน' : 'ต่ำกว่า'}นั้น`);
  const head = def.score_by_plan
    ? 'รายเดือนเทียบ "แผนของเดือนนั้น" (ช่องแผน = เป้าเดือน · △ = แผน×สัดส่วน Commit/Target · เดือนไม่มีแผน = เทียบเป้าปี) · เป้าปี: '
    : 'ทุกเดือนเทียบเป้าเดียวกัน: ';
  return { text: `${head}${parts.join(' · ')} · สรุปปี = ${mode}`, ok: true, mode, down, bars: b };
}

/** เกณฑ์ที่ตั้งขัดกัน/ไม่ครบ — จอขึ้นเตือนแดงที่แถวทันที ไม่รอให้บอร์ดสีเพี้ยน · `plans` = {เดือน: ค่า} ของแถว (ไม่ส่ง = ไม่ตรวจเรื่องแผน) */
export function defIssues(def = {}, { plans = null } = {}) {
  const out = [];
  const b = defBars(def);
  const hasNum = b.target_value != null || b.commit_value != null;
  if (hasNum && !(b.target_compare || b.commit_compare)) out.push({ code: 'no_direction', text: 'ตั้งเป้าแล้วแต่ไม่ได้เลือกทิศทาง ≥/≤ — ตัดสิน ○△✗ ไม่ได้' });
  const cmp = b.target_compare || b.commit_compare;
  const dirOf = (c) => (c == null ? null : String(c).startsWith('<') ? 'down' : String(c).startsWith('>') ? 'up' : null);
  if (b.target_compare && b.commit_compare && dirOf(b.target_compare) && dirOf(b.commit_compare) && dirOf(b.target_compare) !== dirOf(b.commit_compare)) {
    out.push({ code: 'commit_dir_conflict', text: `เครื่องหมายของ Commitment (${CMP_SYM[b.commit_compare] || b.commit_compare}) สวนทางกับ Target (${CMP_SYM[b.target_compare] || b.target_compare}) — น่าจะพิมพ์ผิดด้าน (เคส "≤ 0" กับเป้า ≥ 30)` });
  } else if (cmp && b.target_value != null && b.commit_value != null) {
    const down = String(cmp).startsWith('<');
    if (down ? b.commit_value < b.target_value : b.commit_value > b.target_value) {
      out.push({ code: 'commit_wrong_side', text: `Commitment (${b.commit_value}) เข้มกว่า Target (${b.target_value}) ทั้งที่ทิศทาง "${down ? 'ยิ่งน้อยยิ่งดี' : 'ยิ่งมากยิ่งดี'}" — △ จะไม่มีวันเกิด (น่าจะใส่เครื่องหมายผิดด้าน)` });
    }
  }
  const ct = def.commitment == null ? '' : String(def.commitment).trim();
  if (b.commit_value == null && ct && ct !== '-' && !/\d/.test(ct)) out.push({ code: 'commit_text_unparsed', text: `Commitment เป็นข้อความที่อ่านตัวเลขไม่ได้ ("${ct}") — ไม่ถูกใช้ตัดสิน` });
  if (plans && typeof plans === 'object') {
    const n = Object.values(plans).filter(v => v != null && v !== '' && !Number.isNaN(Number(v))).length;
    if (n && !def.score_by_plan) out.push({ code: 'plan_unused', text: `กรอกแผนไว้ ${n} เดือน แต่ตั้งให้เทียบเป้าปี — แผนเป็นแค่เส้นประกอบ ไม่มีผลกับ ○△✗ (ถ้าต้องการให้มีผล เลือก "เทียบแผนของเดือนนั้น" ในนิยาม)` });
    if (!n && def.score_by_plan) out.push({ code: 'plan_missing', text: 'ตั้งให้เทียบแผนของเดือนนั้น แต่ยังไม่กรอกแผนสักเดือน — ทุกเดือนจะถอยไปเทียบเป้าปี' });
  }
  return out;
}
