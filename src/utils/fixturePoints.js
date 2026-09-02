// 🔧 Fixture Shim & Sustainability — สูตรกลางทั้งหมด (pure · เทสได้ · ไม่ import supabase)
//
// ออกแบบเต็ม + เหตุผลรายข้อ: docs/FIXTURE-SHIM-DESIGN.md
//
// ⚠️ กฎเหล็กที่ไฟล์นี้บังคับ (ห้ามแก้ให้หลวมลง):
//   1. "ไม่รู้" ≠ "ศูนย์" — ไม่ตั้ง baseline/เกณฑ์/CT = คืน null พร้อมเหตุผล ห้ามแปลงเป็น 0
//   2. max_shim_mm = null → ไม่เตือนอะไรเลย (0 แปลว่า "ห้ามใส่ชิมเลย" คนละความหมาย)
//   3. interval ที่เป็น null → ตามความถี่ของ checklist เหมือนเดิม (backward-compatible)
//   4. ค่ารวม (shim_after_mm) คือความจริง · delta เป็นแค่วิธีกรอก ห้ามบวกสะสมจาก delta
//   5. tool life เรียนรู้จากประวัติของโรงงานเราเอง — ค่า default เป็นแค่ค่าตั้งต้น ไม่ใช่มาตรฐาน

/** ชนิดจุด fallback เมื่อตาราง fixture_point_kinds ยังว่าง/โหลดไม่ได้ (ตารางคือ source of truth) */
export const DEFAULT_POINT_KINDS = [
  { code: 'locator_pin', label: 'Locator Pin (พินระบุตำแหน่ง)', icon: '📍', color: '#ef4444', sort_order: 10,
    default_interval_days: 7,  default_interval_cycles: 5000, default_life_cycles: 30000 },
  { code: 'bush',        label: 'Bush / บุชนำ',                  icon: '⭕', color: '#f59e0b', sort_order: 20,
    default_interval_days: 14, default_interval_cycles: 8000, default_life_cycles: 40000 },
  { code: 'clamp',       label: 'Clamp / ตัวกด',                 icon: '🗜️', color: '#3b82f6', sort_order: 30,
    default_interval_days: 30 },
  { code: 'rest_pad',    label: 'Rest Pad / แผ่นรอง',            icon: '▭', color: '#22c55e', sort_order: 40,
    default_interval_days: 90 },
  { code: 'block',       label: 'Block / บล็อกอ้างอิง',          icon: '🧱', color: '#8b5cf6', sort_order: 50,
    default_interval_days: 90 },
  { code: 'other',       label: 'อื่นๆ',                         icon: '•',  color: '#94a3b8', sort_order: 90 },
];

/** เหตุผลที่ใส่/ถอดชิม — ใช้ทำ pareto ว่าจิ๊กเสื่อมเพราะอะไร */
export const SHIM_REASONS = [
  { key: 'wear',            label: 'สึกตามการใช้งาน' },
  { key: 'part_rev_change', label: 'เปลี่ยน rev ชิ้นงาน' },
  { key: 'after_repair',    label: 'หลังซ่อม/ตั้งใหม่' },
  { key: 'quality_issue',   label: 'แก้ปัญหาคุณภาพ' },
  { key: 'new_setup',       label: 'ตั้งค่าครั้งแรก' },
  { key: 'other',           label: 'อื่นๆ (ต้องระบุ)' },
];

export const SHIM_ACTIONS = [
  { key: 'add',           label: '➕ ใส่ชิมเพิ่ม' },
  { key: 'remove',        label: '➖ ถอดชิมออก' },
  { key: 'replace_set',   label: '🔁 เปลี่ยนชุดชิม' },
  { key: 'recount',       label: '🔢 ตรวจนับจริง' },
  { key: 'part_replaced', label: '🔧 เปลี่ยนชิ้นส่วน (รีเซ็ต tool life)' },
];

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
export const n0 = num;

// ── 1) ชิมสะสม ─────────────────────────────────────────────────────────────
/**
 * สถานะชิมของจุดหนึ่ง
 * @returns {{current:number|null, baseline:number|null, added:number|null,
 *            pct:number|null, level:'unknown'|'no_limit'|'ok'|'warn'|'over'}}
 *   - current = null  → ยังไม่เคยบันทึกชิมเลย (ไม่รู้ ไม่ใช่ 0)
 *   - max = null      → level 'no_limit' = ยังไม่ตั้งเกณฑ์ **ห้ามเตือน**
 */
export function shimStack(point) {
  const current  = num(point?.current_shim_mm);
  const baseline = num(point?.baseline_shim_mm);
  const max      = num(point?.max_shim_mm);
  const added    = current != null && baseline != null ? +(current - baseline).toFixed(3) : null;

  if (current == null) return { current, baseline, added, pct: null, level: 'unknown' };
  if (max == null || max <= 0) return { current, baseline, added, pct: null, level: 'no_limit' };

  const pct = (current / max) * 100;
  const level = current > max ? 'over' : pct >= 80 ? 'warn' : 'ok';
  return { current, baseline, added, pct, level };
}

// ── 2) shot (จำนวนครั้งที่จิ๊กทำงาน) ────────────────────────────────────────
/**
 * แปลง "จำนวนชิ้นที่ผลิต" → "จำนวนครั้งที่จิ๊กจับ-ปล่อย"
 * ⚠️ งานคู่ RH/LH ต้องส่ง pieces ที่ผ่าน pairAwareTotal (max) มาแล้ว **ห้ามบวก LH+RH**
 * @param pieces จำนวนชิ้น (ผ่านการยุบคู่/ยุบ OP มาแล้ว)
 * @param piecesPerCycle จำนวนชิ้นต่อ 1 ครั้ง — null = ยังไม่ตั้ง (ถือเป็น 1 แต่ต้องเตือนบนจอ)
 * @returns {{shots:number|null, assumed:boolean}} assumed=true คือเดาว่า 1 เพราะยังไม่ตั้งค่า
 */
export function shotsFromPieces(pieces, piecesPerCycle) {
  const p = num(pieces);
  if (p == null) return { shots: null, assumed: false };
  const per = num(piecesPerCycle);
  if (per == null || per <= 0) return { shots: Math.round(p), assumed: true };
  return { shots: Math.round(p / per), assumed: false };
}

// ── 3) ครบกำหนดตรวจ 2 แกน ──────────────────────────────────────────────────
/**
 * จุดนี้ถึงกำหนดตรวจหรือยัง — เวลา vs การใช้งาน อันไหนถึงก่อนชนะ
 * @param point แถว fixture_points
 * @param ctx {nowMs, currentShot, shotPerDay}
 *   - currentShot = shot สะสมของ fixture ตอนนี้ (null = ยังนับไม่ได้)
 *   - shotPerDay  = อัตราการใช้งานต่อวัน (ใช้ประมาณว่าจะครบ cycle วันไหน)
 * @returns {{due:boolean, level:'over'|'soon'|'ok'|'unset'|'unknown_usage',
 *            daysLeft:number|null, cyclesLeft:number|null, driver:'days'|'cycles'|null, text:string}}
 *   - 'unset'         = ไม่ตั้ง interval ทั้ง 2 แกน → ตามความถี่ของ checklist เหมือนเดิม
 *   - 'unknown_usage' = ตั้งแกน cycle ไว้ แต่นับ shot ไม่ได้ → ตกไปใช้แกนเวลาอย่างเดียว
 */
export function pointDueStatus(point, ctx = {}) {
  const nowMs = ctx.nowMs ?? Date.now();
  const iDays = num(point?.interval_days);
  const iCyc  = num(point?.interval_cycles);
  if (iDays == null && iCyc == null) {
    return { due: false, level: 'unset', daysLeft: null, cyclesLeft: null, driver: null,
             text: 'ใช้ความถี่ของเช็คลิสต์' };
  }

  // แกนเวลา
  let daysLeft = null;
  if (iDays != null) {
    const last = point?.last_check_at ? new Date(point.last_check_at).getTime() : null;
    daysLeft = last == null ? -1 // ไม่เคยตรวจเลย = ถึงกำหนดแล้ว (ไม่ใช่ "ไม่รู้")
      : Math.floor((last + iDays * 86400000 - nowMs) / 86400000);
  }

  // แกนการใช้งาน
  let cyclesLeft = null;
  let usageUnknown = false;
  if (iCyc != null) {
    const cur  = num(ctx.currentShot);
    const last = num(point?.last_check_shot);
    if (cur == null) usageUnknown = true;
    else cyclesLeft = Math.round((last ?? 0) + iCyc - cur);
  }

  // แปลง cycle ที่เหลือ → วันที่เหลือ (ถ้ารู้อัตรา) เพื่อเทียบกับแกนเวลาในหน่วยเดียวกัน
  const rate = num(ctx.shotPerDay);
  const cycDays = cyclesLeft != null && rate != null && rate > 0
    ? Math.floor(cyclesLeft / rate) : null;

  const cands = [];
  if (daysLeft != null) cands.push({ d: daysLeft, driver: 'days' });
  if (cycDays  != null) cands.push({ d: cycDays,  driver: 'cycles' });
  // ตั้งแกน cycle แต่ไม่รู้อัตรา → ตัดสินจาก cycle ที่เหลือตรงๆ (ไม่มีวันเทียบ)
  const cycOverOnly = cyclesLeft != null && cycDays == null && cyclesLeft <= 0;

  const best = cands.length ? cands.reduce((a, b) => (b.d < a.d ? b : a)) : null;
  const dLeft = best?.d ?? null;
  const driver = cycOverOnly && (dLeft == null || dLeft > 0) ? 'cycles' : (best?.driver ?? null);
  const due = cycOverOnly || (dLeft != null && dLeft <= 0);
  const level = due ? 'over'
    : usageUnknown ? 'unknown_usage'
    : dLeft != null && dLeft <= 3 ? 'soon' : 'ok';

  const parts = [];
  if (daysLeft   != null) parts.push(daysLeft <= 0 ? `เลยกำหนด ${-daysLeft} วัน` : `อีก ${daysLeft} วัน`);
  if (cyclesLeft != null) parts.push(cyclesLeft <= 0 ? `เลย ${-cyclesLeft} shot` : `อีก ${cyclesLeft} shot`);
  if (usageUnknown) parts.push('นับ shot ไม่ได้ — ใช้แกนเวลาอย่างเดียว');

  return { due, level, daysLeft, cyclesLeft, driver, text: parts.join(' · ') || '—' };
}

// ── 4) tool life ───────────────────────────────────────────────────────────
/**
 * เหลืออายุกี่ % — null = ประเมินไม่ได้ (ไม่ตั้ง life หรือนับ shot ไม่ได้) **ห้ามคืน 0**
 * @returns {{used:number|null, pct:number|null, level:'unknown'|'ok'|'warn'|'over'}}
 */
export function toolLifeStatus(point, currentShot) {
  const life = num(point?.expected_life_cycles);
  const cur  = num(currentShot);
  if (life == null || life <= 0 || cur == null) return { used: null, pct: null, level: 'unknown' };
  const used = Math.max(0, Math.round(cur - (num(point?.last_replaced_shot) ?? 0)));
  const pct  = (used / life) * 100;
  return { used, pct, level: pct >= 100 ? 'over' : pct >= 80 ? 'warn' : 'ok' };
}

/**
 * เรียนรู้ tool life จริงจากประวัติเปลี่ยนชิ้นส่วนของโรงงานเรา
 * ⚠️ คืนค่าเป็น "ข้อเสนอ" เท่านั้น — ห้ามเขียนทับ expected_life_cycles เอง (ระบบเสนอ คนตัดสิน)
 * @param events แถว fixture_shim_events ของจุดนั้น (ต้องมี shot_at_event)
 * @param minSamples ต้องมีอย่างน้อยกี่ช่วงถึงจะเสนอ (default 3 — น้อยกว่านี้ไม่มีความหมาย)
 * @returns {{suggested:number|null, samples:number, spans:number[]}}
 */
export function learnedToolLife(events = [], minSamples = 3) {
  const shots = events
    .filter(e => e?.action === 'part_replaced' && num(e?.shot_at_event) != null)
    .map(e => num(e.shot_at_event))
    .sort((a, b) => a - b);
  const spans = [];
  for (let i = 1; i < shots.length; i++) {
    const d = shots[i] - shots[i - 1];
    if (d > 0) spans.push(d);
  }
  if (spans.length < minSamples) return { suggested: null, samples: spans.length, spans };
  const sorted = [...spans].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  return { suggested: median, samples: spans.length, spans };
}

// ── 5) เสนอเกณฑ์เพดานชิมจากข้อมูลจริง ──────────────────────────────────────
/**
 * ยังไม่ตั้ง max_shim_mm → เสนอจากค่าที่เคยใช้จริง (เสนอ ไม่ตั้งให้)
 * @returns {{suggested:number|null, samples:number}}
 */
export function suggestMaxShim(events = [], minSamples = 5) {
  const vals = events.map(e => num(e?.shim_after_mm)).filter(v => v != null && v > 0);
  if (vals.length < minSamples) return { suggested: null, samples: vals.length };
  const peak = Math.max(...vals);
  // ⚠️ ปัดทศนิยมก่อน ceil เสมอ — 0.8*1.5*10 = 12.000000000000002 ทำให้ ceil ดีดเป็น 1.3
  const suggested = Math.ceil(Number((peak * 1.5 * 10).toFixed(6))) / 10;
  return { suggested: +suggested.toFixed(1), samples: vals.length };
}

// ── 6) เสนอว่าเครื่องไหน "น่าจะเป็น fixture" (เฟส 0) ────────────────────────
/**
 * ⚠️ เป็นการ **เสนอ** เท่านั้น — ห้าม backfill equipment_kind อัตโนมัติ
 *    ชื่ออย่าง "Welding" / "Tower load" แยกไม่ออกว่าเป็นจิ๊กหรือเครื่อง ต้องให้ช่างชี้
 * @param machines แถว machines (ต้องมี machine_no, machine_name, equipment_kind)
 * @param onMapKeys Set ของ machine_no (normalize แล้ว) ที่วางอยู่บนผังไลน์
 * @returns รายการที่ยัง kind='machine' พร้อม score + reasons (มากไปน้อย)
 */
export function suggestFixtureCandidates(machines = [], onMapKeys = new Set()) {
  const NAME_HINTS = [
    { re: /\bJIG\b|จิ๊ก|FIXTURE/i,        w: 40, why: 'ชื่อมีคำว่า JIG/FIXTURE' },
    { re: /GRIPPER|CLAMP/i,               w: 30, why: 'gripper / clamp' },
    { re: /CENTERING|LOCAT/i,             w: 30, why: 'centering / locating' },
    { re: /POKA[- ]?YOKE/i,               w: 25, why: 'poka-yoke' },
    { re: /MARKING/i,                     w: 20, why: 'marking' },
    { re: /MAGAZINE|TOWER\s*LOAD|SLIDE/i, w: 20, why: 'magazine / tower load / slide' },
  ];
  const NO_HINTS = [
    { re: /^JHYD/i,  w: 35, why: 'เลขขึ้นต้น JHYD (จิ๊กไฮโดรฟอร์ม)' },
    { re: /^GPHYD/i, w: 35, why: 'เลขขึ้นต้น GPHYD (gripper)' },
    { re: /^JIG/i,   w: 35, why: 'เลขขึ้นต้น JIG' },
  ];
  const norm = (s) => String(s ?? '').trim().toUpperCase();

  return machines
    .filter(m => String(m?.equipment_kind ?? 'machine') === 'machine')
    .map(m => {
      const reasons = [];
      let score = 0;
      for (const h of NO_HINTS)   if (h.re.test(m.machine_no   || '')) { score += h.w; reasons.push(h.why); }
      for (const h of NAME_HINTS) if (h.re.test(m.machine_name || '')) { score += h.w; reasons.push(h.why); }
      if (onMapKeys.has(norm(m.machine_no))) { score += 10; reasons.push('วางอยู่บนผังไลน์แล้ว'); }
      return { ...m, _score: score, _reasons: reasons };
    })
    .filter(m => m._score > 0)
    .sort((a, b) => b._score - a._score
      || String(a.line_name || '').localeCompare(String(b.line_name || ''))
      || String(a.machine_no || '').localeCompare(String(b.machine_no || '')));
}

// ── 7) จับคู่ fixture ↔ พาร์ทที่มันจับ (ใช้นับ shot) ────────────────────────
/**
 * แปลงข้อความพาร์ทในทะเบียนจิ๊ก (`jigs.part_no`) → รายการ mat_no ที่ต้องนับยอดผลิต
 *
 * ⚠️ ข้อมูลจริงเป็นเลข "พาร์ทลูกค้า" คนละรูปแบบกับ dr_products (ตรวจ 2026-09-01: match ตรงตัว = 0)
 *      ทะเบียนจิ๊ก: "MB3B-16C274-C/MB3B-16C275-C"   ← RH/LH ในช่องเดียว คั่นด้วย /
 *      ระบบสินค้า : "MB3B 16C274 CD"                 ← ช่องว่าง + rev ต่าง
 *    → ลองตรงตัวก่อน (normMat) ไม่เจอค่อยถอยไปเทียบ base (ตัด rev)
 *
 * 🔴 เจอหลาย MAT ต่อ 1 พาร์ท = **รวมทุกตัว ไม่ใช่ "กำกวม"**
 *    FG ตัวเดียวแตกหลาย MAT SAP ตามลูกค้า (FTM/AAT/FVL) แต่จิ๊กจับเหมือนกันทุกชิ้น
 *    (ต่างจาก resolveMatNo ที่ใช้ตัดสต็อก ซึ่งห้ามรวมข้าม MAT เด็ดขาด — คนละคำถาม)
 *
 * @param partNoText ข้อความจาก jigs.part_no
 * @param products   [{mat_no, p_no, part_name}] จาก dr_products
 * @param helpers    { normMat, baseOfPart } จาก utils/matResolve (ส่งเข้ามาเพื่อให้ไฟล์นี้ pure)
 * @returns {{mats:string[], tokens:Array<{token:string,mats:string[],via:'exact'|'base'|null}>,
 *            status:'empty'|'none'|'partial'|'ok'}}
 */
export function resolveFixtureParts(partNoText, products = [], helpers = {}) {
  const normMat = helpers.normMat || ((s) => String(s ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase());
  const baseOfPart = helpers.baseOfPart || ((x) => String(x || '').toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ').trim().replace(/ [A-Z0-9]{1,2}$/, '').replace(/ /g, ''));

  const raw = String(partNoText ?? '').split(/[/,;]+/).map(s => s.trim()).filter(Boolean);
  if (!raw.length) return { mats: [], tokens: [], status: 'empty' };

  const exact = new Map();  // normalized → Set(mat_no)
  const base  = new Map();
  const push = (map, key, mat) => {
    if (!key || !mat) return;
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(mat);
  };
  for (const p of products) {
    for (const k of [p?.p_no, p?.mat_no]) push(exact, normMat(k), p?.mat_no);
    push(base, baseOfPart(p?.p_no), p?.mat_no);
  }

  const tokens = raw.map(token => {
    const hitE = exact.get(normMat(token));
    if (hitE?.size) return { token, mats: [...hitE], via: 'exact' };
    const hitB = base.get(baseOfPart(token));
    if (hitB?.size) return { token, mats: [...hitB], via: 'base' };
    return { token, mats: [], via: null };
  });

  const mats = [...new Set(tokens.flatMap(t => t.mats))];
  const okN = tokens.filter(t => t.mats.length).length;
  const status = okN === 0 ? 'none' : okN < tokens.length ? 'partial' : 'ok';
  return { mats, tokens, status };
}
