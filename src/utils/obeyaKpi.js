/* ══ 🏛️ obeyaKpi — นิยาม KPI ของห้อง OBEYA (SQDCM) จุดเดียวของระบบ ═══════════════════════
   ออกแบบไว้ใน `docs/OBEYA-DESIGN.md` §5 ข้อ 1 — เหตุผลที่ต้องมีไฟล์นี้:
   ถ้าแต่ละแผงบนจอคำนวณ KPI เอง มันจะ drift ออกจากหน้าที่ทำงานจริงภายในไม่กี่เดือน
   (โปรเจคนี้เจอมาแล้วหลายรอบ — ยอดผลิตในหน้าเดียวกัน 2 แท็บไม่เท่ากัน / OEE คนละชุดกับ Daily Report)

   ── กฎของไฟล์นี้ ─────────────────────────────────────────────────────────────────────
   1. **pure function ล้วน** ห้าม import supabase / ห้ามแตะ DOM — หน้าเป็นคนโหลด ไฟล์นี้เป็นคนตัดสิน
   2. **ห้ามคิดสูตร OEE/A/P/Q ใหม่** — ใช้ `wavg`/`wLoad`/`wRun`/`wProd`/`avgOeeTarget` จาก `oee.js`
      (`src/utils/oee.js` เป็นเจ้าของสูตร OEE จุดเดียวเสมอ — กฎ SCADA ใน CLAUDE.md)
   3. **ข้อมูลไม่พอ ต้องบอกว่าไม่พอ ห้ามคืน 0** — ทุก axis คืน `state: 'ok' | 'thin' | 'none'`
      พร้อม `note` ที่อ่านรู้เรื่อง · จอที่ยืนยันสิ่งที่ไม่จริง แย่กว่าจอที่ว่าง (OBEYA-DESIGN §4)
   ════════════════════════════════════════════════════════════════════════════════════ */
import { wavg, wLoad, wRun, wProd, DEFAULT_OEE_TARGET } from './oee.js';

/* ── แกน SQDCM — ลำดับนี้คือลำดับบนจอ (ซ้าย→ขวา) ห้ามสลับ ──────────────────────────
   สีถูกเลือกให้ต่างกันชัดบนจอ TV ระยะ 3-4 เมตร (ไม่ใช่สีสถานะ — สถานะใช้ statusColor) */
export const OBEYA_AXES = [
  { key: 'S', icon: '🦺', label: 'ความปลอดภัย', en: 'SAFETY',   color: '#ef4444' },
  { key: 'Q', icon: '🎯', label: 'คุณภาพ',      en: 'QUALITY',  color: '#a78bfa' },
  { key: 'D', icon: '🚚', label: 'ส่งมอบ',      en: 'DELIVERY', color: '#38bdf8' },
  { key: 'C', icon: '💰', label: 'ต้นทุน',      en: 'COST',     color: '#f59e0b' },
  { key: 'M', icon: '🧑‍🏭', label: 'กำลังคน',    en: 'MANPOWER', color: '#22c55e' },
];
export const axisMeta = (key) => OBEYA_AXES.find(a => a.key === key) || null;

/* ── สถานะเทียบเป้า ────────────────────────────────────────────────────────────────
   `better` = ทิศทางที่ดี: 'up' (ยิ่งมากยิ่งดี เช่น OEE) · 'down' (ยิ่งน้อยยิ่งดี เช่น ของเสีย)
   เกณฑ์เหลือง = พลาดเป้าไม่เกิน 5% ของค่าเป้า — เลือกให้ตรงกับไฟเหลืองของ Andon ในระบบ
   ⚠️ เป้า 0 (เช่น "อุบัติเหตุ 0 ครั้ง") ไม่มีแถบเหลือง — เกิน 0 คือแดงทันที ไม่มีครึ่งทาง */
export function statusOf(value, target, better = 'up') {
  if (value == null || Number.isNaN(Number(value))) return 'none';
  if (target == null || Number.isNaN(Number(target))) return 'none';
  const v = Number(value), t = Number(target);
  if (better === 'down') {
    if (t === 0) return v === 0 ? 'good' : 'bad';
    if (v <= t) return 'good';
    return v <= t * 1.05 ? 'warn' : 'bad';
  }
  if (v >= t) return 'good';
  return v >= t * 0.95 ? 'warn' : 'bad';
}
export const STATUS_COLOR = { good: '#22c55e', warn: '#f59e0b', bad: '#ef4444', none: '#64748b' };
export const statusColor = (s) => STATUS_COLOR[s] || STATUS_COLOR.none;

/** ห่างเป้าเท่าไหร่ (บวก = ดีกว่าเป้าเสมอ ไม่ว่าทิศทางไหน) — ใช้โชว์ Δ บนหัวแผง */
export function gapToTarget(value, target, better = 'up') {
  if (value == null || target == null) return null;
  const d = Number(value) - Number(target);
  return +(better === 'down' ? -d : d).toFixed(1);
}

/* ── ป้ายไฟสถานะบนจอมอนิเตอร์ (2026-09-21 · คำขอ user "อยากได้สเตตัสสี กดเข้าไปดูได้") ──
   ข้อความบนไฟต้องเป็นชุดเดียวกันทุกบอร์ด — ห้ามให้แต่ละหน้าคิดคำเอง ไม่งั้นจอเดียวกัน
   คนละแผงจะเรียกสถานะเดียวกันคนละชื่อ (บทเรียนเดิม: KPI แถวเดียวกันได้ 3 คำตอบจาก 3 จอ)

   🔴 **`none` (เทา) มี 2 ความหมายที่ต้องแยกให้คนหน้าจออ่านออก** — กฎความซื่อสัตย์ของจอ:
      "ยังไม่มีข้อมูล" (ยังไม่เกิดงาน) ≠ "ไม่มีเป้า" (มีตัวเลขแล้ว แต่ไม่มีใครตั้งเป้าให้เทียบ)
      ทั้งคู่ห้ามถูกนับเป็นเขียว และห้ามโชว์เป็น 0 */
export const STATUS_LABEL = { good: 'ตามเป้า', warn: 'เฉียดเป้า', bad: 'หลุดเป้า', none: 'ตัดสินไม่ได้' };
export const statusLabel = (s) => STATUS_LABEL[s] || STATUS_LABEL.none;

/**
 * ไฟสถานะ 1 ดวง + เหตุผลที่เป็นสีนั้น (ใช้เป็นทั้งป้ายบนจอและ tooltip)
 * @returns {{ status:'good'|'warn'|'bad'|'none', label:string, why:string }}
 */
export function statusWhy(value, target, better = 'up', unit = '') {
  const num = (x) => x != null && x !== '' && !Number.isNaN(Number(x));
  const u = unit ? ` ${unit}` : '';
  if (!num(value)) return { status: 'none', label: 'ยังไม่มีข้อมูล', why: 'ช่วงนี้ยังไม่มีข้อมูลให้คำนวณ — ไม่ใช่ว่าผลเป็นศูนย์' };
  if (!num(target)) return { status: 'none', label: 'ไม่มีเป้า', why: `มีค่า ${value}${u} แต่ยังไม่ได้ตั้งเป้าไว้ จึงตัดสินว่าผ่าน/ไม่ผ่านไม่ได้` };
  const s = statusOf(value, target, better);
  const gap = gapToTarget(value, target, better);
  const dir = gap >= 0 ? `ดีกว่าเป้า ${Math.abs(gap)}` : `ห่างเป้าอีก ${Math.abs(gap)}`;
  return { status: s, label: STATUS_LABEL[s], why: `${value}${u} · เป้า ${target}${u} — ${dir}` };
}

/* ── ตัวช่วยรวมข้อมูลเป็นอนุกรมเวลา ────────────────────────────────────────────────
   แผงทุกใบบนจอ Obeya เป็น "กราฟ" (คำสั่ง user 2026-09-15) ⇒ ทุก axis ต้องมี `series`
   bucketBy รวมแถวดิบเป็นจุดต่อวัน/สัปดาห์/เดือน แล้วให้ผู้เรียกแปลงเป็นค่าที่ต้องการเอง */
export function bucketBy(rows = [], keyFn, reducer, seed = () => ({})) {
  const out = new Map();
  rows.forEach((r) => {
    const k = keyFn(r);
    if (k == null || k === '') return;
    if (!out.has(k)) out.set(k, { k, ...seed() });
    reducer(out.get(k), r);
  });
  return [...out.values()].sort((a, b) => String(a.k).localeCompare(String(b.k)));
}

/** เติมวันที่ว่างให้ครบช่วง (จอที่ข้ามวันเสาร์อาทิตย์เงียบๆ ทำให้อ่านแนวโน้มผิด) */
export function fillDays(series = [], from, to) {
  if (!from || !to) return series;
  const by = new Map(series.map(s => [s.k, s]));
  const out = [];
  const [y, m, d] = String(from).split('-').map(Number);
  const cur = new Date(y, m - 1, d);
  const end = String(to);
  for (let i = 0; i < 400; i++) {
    const k = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
    if (k > end) break;
    out.push(by.get(k) || { k, empty: true });
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

/* ════ แกน OEE (แกนกลางของแผ่นใหญ่ — ไม่ใช่ 1 ใน SQDCM แต่เป็นตัวอธิบาย D กับ C) ════
   ใช้ค่าที่ stamp ไว้ตอนปิดกะเท่านั้น (oee/oee_a/oee_p/oee_q) — ห้ามคำนวณใหม่
   ถ่วงน้ำหนักตามตำรา: OEE/A ถ่วงด้วยเวลารับภาระ · P ถ่วงด้วยเวลาเดินเครื่อง · Q ถ่วงด้วยจำนวนผลิต */
export function axisOee({ sessions = [], target = null } = {}) {
  const rows = sessions.filter(s => s.oee != null);
  const tg = target && target.oee != null ? target.oee
    : Math.round(DEFAULT_OEE_TARGET.a * DEFAULT_OEE_TARGET.p * DEFAULT_OEE_TARGET.q / 100) / 100;
  if (!rows.length) {
    return { key: 'OEE', value: null, target: tg, better: 'up', unit: '%', state: 'none',
      note: 'ยังไม่มีกะที่ปิดแล้วในช่วงนี้', a: null, p: null, q: null, series: [], shifts: 0 };
  }
  const val = wavg(rows, r => Number(r.oee), wLoad);
  return {
    key: 'OEE', unit: '%', better: 'up', target: tg,
    value: val == null ? null : +val.toFixed(1),
    a: round1(wavg(rows, r => Number(r.oee_a), wLoad)),
    p: round1(wavg(rows, r => Number(r.oee_p), wRun)),
    q: round1(wavg(rows, r => Number(r.oee_q), wProd)),
    shifts: rows.length,
    state: 'ok', note: null,
    series: bucketBy(rows, r => r.work_date, (acc, r) => acc.rows.push(r), () => ({ rows: [] }))
      .map(b => ({ k: b.k, v: round1(wavg(b.rows, r => Number(r.oee), wLoad)), n: b.rows.length })),
  };
}

/* ════ S — ความปลอดภัย ════════════════════════════════════════════════════════════
   🔴 ระบบยังไม่มีทะเบียนอุบัติเหตุ/near-miss (สำรวจแล้ว 2026-09-15 · OBEYA-DESIGN §2)
   ⇒ KPI "วันปลอดอุบัติเหตุ" ทำไม่ได้จริง — ห้ามโชว์ 0 ครั้งแล้วให้คนเข้าใจว่าปลอดภัย
   ที่ทำได้ตอนนี้คือ "พฤติกรรม" (PPE ครบตอนเช็คชื่อ) ซึ่งเป็น leading indicator ไม่ใช่ผลลัพธ์
   ⚠️ นับเฉพาะคนที่มาทำงาน (is_present) — คนลาไม่มี PPE เป็นเรื่องปกติ ถ้านับรวมจะได้เลขต่ำหลอก */
export function axisSafety({ logs = [], incidents = null, target = 100 } = {}) {
  const present = logs.filter(l => l.is_present);
  const base = {
    key: 'S', unit: '%', better: 'up', target,
    incidents: incidents == null ? null : incidents,
    hasIncidentRegistry: incidents != null,
  };
  if (!present.length) {
    return { ...base, value: null, state: 'none', series: [],
      note: 'ยังไม่มีบันทึกเช็คชื่อ/PPE ในช่วงนี้' };
  }
  const full = l => !!(l.has_helmet && l.has_boots && l.has_gloves);
  const value = round1((present.filter(full).length / present.length) * 100);
  return {
    ...base, value, state: 'thin',
    // 🔴 ข้อความนี้ต้องอยู่บนจอเสมอจนกว่าจะมีทะเบียนอุบัติเหตุจริง (OBEYA-DESIGN §4)
    note: 'ยังไม่มีทะเบียนอุบัติเหตุ/near-miss — ตัวเลขนี้คือ "ใส่ PPE ครบตอนเช็คชื่อ" ไม่ใช่ผลด้านความปลอดภัย',
    checked: present.length,
    series: bucketBy(present, l => l.work_date,
      (a, l) => { a.n += 1; if (full(l)) a.ok += 1; }, () => ({ n: 0, ok: 0 }))
      .map(b => ({ k: b.k, v: round1((b.ok / b.n) * 100), n: b.n })),
  };
}

/* ════ Q — คุณภาพ ═════════════════════════════════════════════════════════════════
   Q% = ค่าที่ stamp ตอนปิดกะ ถ่วงด้วยจำนวนผลิต (ห้ามเฉลี่ยเปอร์เซ็นต์ตรงๆ)
   `defectRows` ใช้แค่ทำ Pareto/ชี้สาเหตุ ไม่เอาไปคำนวณ Q ซ้ำ (จะได้คนละเลขกับ Daily Report)
   ⚠️ `defect_logs` มีแค่ 179 แถวเทียบ downtime 8,627 (วัดจริง 15/09) = บันทึกไม่ครบ ไม่ใช่ของเสียน้อย
      ⇒ ต่อให้ Q ออกมาสวย ก็ต้องกำกับไว้ว่าอ่านแล้วอย่าเพิ่งเชื่อ */
export const Q_THIN_DEFECT_ROWS = 400;
export function axisQuality({ sessions = [], defects = [], target = null } = {}) {
  const rows = sessions.filter(s => s.oee_q != null);
  const tg = target && target.q != null ? target.q : DEFAULT_OEE_TARGET.q;
  const base = { key: 'Q', unit: '%', better: 'up', target: tg, defectRows: defects.length };
  if (!rows.length) {
    return { ...base, value: null, state: 'none', series: [], ngQty: 0,
      note: 'ยังไม่มีกะที่ปิดแล้วในช่วงนี้' };
  }
  const ngQty = defects.reduce((a, d) => a + (Number(d.qty_ng) || 0) + (Number(d.qty_suspect) || 0), 0);
  const thin = defects.length < Q_THIN_DEFECT_ROWS;
  return {
    ...base,
    value: round1(wavg(rows, r => Number(r.oee_q), wProd)),
    ngQty,
    state: thin ? 'thin' : 'ok',
    note: thin
      ? `บันทึกของเสียในช่วงนี้มีแค่ ${defects.length} รายการ — น้อยผิดปกติเทียบเวลาเครื่องหยุด แปลว่าบันทึกไม่ครบ อ่านเป็นแนวโน้มได้ แต่ยังใช้ตัดสินใจแทนหน้างานไม่ได้`
      : null,
    series: bucketBy(rows, r => r.work_date, (acc, r) => acc.rows.push(r), () => ({ rows: [] }))
      .map(b => ({ k: b.k, v: round1(wavg(b.rows, r => Number(r.oee_q), wProd)), n: b.rows.length })),
  };
}

/* ════ D — ส่งมอบ ═════════════════════════════════════════════════════════════════
   "ผลิตได้ตามแผนกี่ %" จากใบงานจริง (prod_orders) — ตัวตั้ง/ตัวหารต้องมาจากที่เดียวกัน
   ⚠️ ผู้เรียกต้องส่งยอดที่**ยุบงานคู่ RH/LH และชั้น OP แล้ว** (pairAwareTotal + collapseOps)
      ไม่งั้นงานคู่จะถูกนับ 2 เท่าเหมือนบั๊กที่เคยเจอในแท็บแนวโน้มของ /oee-analytics */
export function axisDelivery({ target = 0, produced = 0, series = [], lateOrders = 0, totalOrders = 0, targetPct = 100 } = {}) {
  const base = { key: 'D', unit: '%', better: 'up', target: targetPct, plan: target, produced, lateOrders, totalOrders };
  if (!target) {
    return { ...base, value: null, state: 'none', series,
      note: 'ใบงานในช่วงนี้ยังไม่มีเป้าหมาย (qty) — เทียบแผนไม่ได้' };
  }
  return { ...base, value: round1((produced / target) * 100), state: 'ok', note: null, series };
}

/* ════ C — ต้นทุน ═════════════════════════════════════════════════════════════════
   ตอนนี้ระบบรู้ "เงินที่เสียไป" (เวลาเครื่องหยุด × ค่าแรงต่อชั่วโมง + ของเสีย × ต้นทุน/ชิ้น)
   แต่ยังไม่รู้ "ราคาขาย" ⇒ ทำ margin ไม่ได้ (ดู docs/FINANCIAL-GAP-ANALYSIS.md)
   ⇒ KPI ของแกนนี้คือ **มูลค่าความสูญเสีย** — ยิ่งน้อยยิ่งดี (better: 'down')
   ⚠️ ไม่มีอัตราค่าแรงของ cost center = คิดไม่ได้ ต้องบอก ห้ามใส่ 0 แทน (0 บาท = "ไม่เสียอะไรเลย" ซึ่งโกหก) */
export function axisCost({ dtBaht = 0, ngBaht = 0, series = [], target = null, missingRate = 0, missingCost = 0 } = {}) {
  const total = (Number(dtBaht) || 0) + (Number(ngBaht) || 0);
  const notes = [];
  if (missingRate) notes.push(`${missingRate} ไลน์ยังไม่ได้ตั้งอัตราค่าแรง/ชม. (cost center)`);
  if (missingCost) notes.push(`${missingCost} พาร์ทยังไม่มีต้นทุน/ชิ้น`);
  return {
    key: 'C', unit: 'บาท', better: 'down', target,
    value: total > 0 ? Math.round(total) : (notes.length ? null : 0),
    dtBaht: Math.round(dtBaht), ngBaht: Math.round(ngBaht),
    state: notes.length ? 'thin' : (total > 0 ? 'ok' : 'none'),
    note: notes.length ? `คิดได้ไม่ครบ: ${notes.join(' · ')}` : (total > 0 ? null : 'ยังไม่มีความสูญเสียที่คิดเป็นเงินได้ในช่วงนี้'),
    series,
  };
}

/* ════ M — กำลังคน ════════════════════════════════════════════════════════════════
   อัตรามาทำงาน = มา ÷ (มา + ขาด) จาก daily_production_logs (Main project)
   ⚠️ ไม่ใช่ "ขวัญกำลังใจ" ตามตำรา SQDCM เป๊ะๆ — ระบบยังไม่มีข้อมูลความพึงพอใจ/ข้อเสนอแนะรายคน
      ใช้ตัวที่วัดได้จริงไปก่อน แล้วกำกับว่ามันคืออะไร */
export function axisMan({ logs = [], target = 95 } = {}) {
  const base = { key: 'M', unit: '%', better: 'up', target };
  if (!logs.length) {
    return { ...base, value: null, state: 'none', series: [], present: 0, absent: 0,
      note: 'ยังไม่มีบันทึกเช็คชื่อในช่วงนี้' };
  }
  const present = logs.filter(l => l.is_present).length;
  return {
    ...base,
    value: round1((present / logs.length) * 100),
    present, absent: logs.length - present,
    ot: logs.filter(l => l.has_ot || l.has_extended_ot).length,
    state: 'ok', note: null,
    series: bucketBy(logs, l => l.work_date,
      (a, l) => { a.n += 1; if (l.is_present) a.ok += 1; }, () => ({ n: 0, ok: 0 }))
      .map(b => ({ k: b.k, v: round1((b.ok / b.n) * 100), n: b.n, present: b.ok })),
  };
}

/* ════ ACTION BOARD — ลูปปิด countermeasure ════════════════════════════════════════
   🎯 หัวใจของ Obeya (OBEYA-DESIGN §3.3): ตัวเลขหลุดเป้า → ใครรับ → ทำอะไร → ปิดหรือยัง
   สถานะบนบอร์ดไม่ใช่ `status` ดิบ — "เกินกำหนด" คือ open/doing ที่ due_date ผ่านไปแล้ว
   ซึ่งเป็นตัวเดียวที่คนในห้องประชุมต้องเห็นก่อนเพื่อน */
export function actionBuckets(items = [], today) {
  const t = today || '';
  const out = { overdue: [], dueSoon: [], open: [], done: [], cancelled: [] };
  items.forEach((a) => {
    if (a.status === 'done') { out.done.push(a); return; }
    if (a.status === 'cancelled') { out.cancelled.push(a); return; }
    if (a.due_date && t && String(a.due_date) < t) out.overdue.push(a);
    else if (a.due_date && t && String(a.due_date) <= addDays(t, 2)) out.dueSoon.push(a);
    else out.open.push(a);
  });
  return out;
}

/** สุขภาพของลูปปิด — ใช้ตอบคำถามเดียวที่สำคัญที่สุดของ Obeya: "ที่ตกลงกันไว้ ทำจริงไหม" */
export function actionHealth(items = [], today) {
  const b = actionBuckets(items, today);
  const live = b.overdue.length + b.dueSoon.length + b.open.length;
  const total = live + b.done.length;
  return {
    ...b,
    liveCount: live,
    closeRate: total ? round1((b.done.length / total) * 100) : null,
    // 🔴 0 ใบ = ไม่ใช่ "ไม่มีปัญหา" แต่คือ "ไม่มีใครบันทึกสิ่งที่ตกลงกันไว้"
    // (meeting_action_items = 0 แถวตั้งแต่ 13/07 ทั้งที่ downtime ถูกกรอก 8,627 แถว — OBEYA-DESIGN §2)
    empty: total === 0,
  };
}

/* ── ช่วงเวลาของบอร์ด ──────────────────────────────────────────────────────────────
   ⚠️ ห้ามใช้ toISOString() (UTC — เพี้ยนข้ามวันสำหรับไทย) · วันที่งานตัด 08:00 ให้ผู้เรียกส่ง
      `today` ที่ได้จาก getWorkDate() เข้ามา ไฟล์นี้ไม่แตะนาฬิกาเอง (เทสจะได้ตรึงเวลาได้ —
      กฎ "เทสระเบิดเวลา" ใน CLAUDE.md) */
export const PERIODS = [
  { key: 'day',   label: 'วันนี้' },
  { key: 'week',  label: 'สัปดาห์นี้' },
  { key: 'month', label: 'เดือนนี้' },
];
export function periodRange(mode, today) {
  const d = String(today);
  if (mode === 'day') return { from: d, to: d };
  if (mode === 'week') {
    const [y, m, dd] = d.split('-').map(Number);
    const dt = new Date(y, m - 1, dd);
    const mon = new Date(dt); mon.setDate(dt.getDate() - ((dt.getDay() + 6) % 7)); // จันทร์ = ต้นสัปดาห์
    return { from: ymd(mon), to: d };
  }
  return { from: `${d.slice(0, 7)}-01`, to: d };   // month
}
/** ช่วงเดียวกันของงวดก่อนหน้า — ใช้ตอบ "ดีขึ้นหรือแย่ลง" ซึ่งเป็นเหตุผลข้อ 2 ที่ทำ Obeya */
export function prevRange(mode, today) {
  const { from, to } = periodRange(mode, today);
  if (mode === 'day') return { from: addDays(from, -1), to: addDays(to, -1) };
  if (mode === 'week') return { from: addDays(from, -7), to: addDays(to, -7) };
  const [y, m] = from.split('-').map(Number);
  const pm = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
  const pFrom = `${pm.y}-${String(pm.m).padStart(2, '0')}-01`;
  const dayOfMonth = Number(to.slice(8, 10));
  const lastDay = new Date(pm.y, pm.m, 0).getDate();
  return { from: pFrom, to: `${pm.y}-${String(pm.m).padStart(2, '0')}-${String(Math.min(dayOfMonth, lastDay)).padStart(2, '0')}` };
}

// ── เล็กๆ น้อยๆ ───────────────────────────────────────────────────────────────────
export const round1 = (v) => (v == null || Number.isNaN(Number(v)) ? null : Math.round(Number(v) * 10) / 10);
export function ymd(dt) {
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
export function addDays(dateStr, n) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return ymd(dt);
}
