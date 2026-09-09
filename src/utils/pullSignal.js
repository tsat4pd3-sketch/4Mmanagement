/**
 * 📥 สัญญาณดึงงานจากลูกค้า (Customer Pull Signal) — ตัวอ่านไฟล์ e-SMART และพวกเดียวกัน
 *
 * ที่มา (user 2026-09-08 · ฝ่าย Logistic): ลูกค้า AAT เรียกงาน **ไม่ตรงตาม EDI 862**
 * เขาส่ง e-SMART มาให้ในพอร์ทัล → user โหลดออกมาทุก 2 ชม. → อัพเข้าระบบเพื่ออัพเดท Shipping Chart
 *   "e-SMART คือข้อมูลที่อัพเดทสุดท้ายก่อนจะส่งของ **เหมือนการยืนยัน order จากลูกค้า**"
 *   "**ส่วนตัวไหนที่ไม่มีใน e-SMART แปลว่าตรงกับ 862**"
 *
 * ⇒ โมเดล: **862 = แผน · pull signal = ยอดยืนยันสุดท้าย**
 *   - อัพเดท **เฉพาะพาร์ทที่อยู่ในไฟล์** · พาร์ทที่ไม่อยู่ = ไม่แตะ (ห้ามลบ ห้าม zero-out)
 *   - รอบส่ง = **ปลายช่วงเวลาในไฟล์ + lead_min** (user: "8:00-10:00 บวกไป 1 ชั่วโมงเป็น 11:00
 *     คือรอบที่ลูกค้ามารับงาน เพราะเป็นการส่งแบบ milkrun")
 *   - จำนวน = Σ(Containers Used × Part Quantity)
 *
 * ⚠️ ไฟล์นี้เป็น **pure function ล้วน ไม่แตะ DB/UI** (มีเทส `__tests__/pullSignal.test.mjs`)
 *   จุดใหม่ที่ต้องอ่านไฟล์สัญญาณดึง ให้เรียกตัวนี้ **ห้ามเขียน parser ซ้ำในหน้า**
 *
 * ⚠️ ทำไมต้อง data-driven (`customer_pull_formats` ฝั่ง DR):
 *   **รายงานตัวเดียวกันยังใช้ชื่อหัวไม่ตรงกัน** — ไฟล์ .csv ที่ user ส่งมาเขียน `username`/`GSDBCODE`
 *   แต่ .xlsx ของรายงานเดียวกันเขียน `CDSID`/`GSDB` ⇒ ทุก field ต้องเทียบได้ "หลายชื่อ"
 *   ลูกค้าเจ้าใหม่/ฟอร์แมตใหม่ = เพิ่ม 1 แถวในตาราง ไม่ต้อง deploy
 */

/** ตัดช่องว่าง/ทำตัวพิมพ์เล็ก สำหรับเทียบชื่อหัวคอลัมน์ (ไฟล์จริงมีเว้นวรรคเกิน/ตัวพิมพ์ไม่นิ่ง) */
const normHead = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * โปรไฟล์สำรองในโค้ด — ใช้เมื่อตาราง `customer_pull_formats` ยังไม่ apply migration หรือโหลดไม่ได้
 * ⚠️ ต้องตรงกับแถว seed `ford_esmart` ใน `20260908_customer_pull_signals_esmart.sql`
 *    (tolerant ตามกฎโปรเจค — แต่หน้าจอต้องบอกว่ากำลังใช้ค่าสำรอง ห้ามเงียบ)
 */
export const FALLBACK_PROFILE = {
  code: 'ford_esmart',
  name: 'Ford e-SMART — Detailed SMART (ค่าสำรองในโค้ด)',
  ship_to_codes: ['GRBNA'],
  detect_keywords: ['SMART Supplier', 'Detailed SMART', 'Part Usage Report'],
  meta_map: {
    window_start: ['Start Time'],
    window_end: ['End Time'],
    supplier_code: ['GSDBCODE', 'GSDB'],
    user: ['username', 'CDSID'],
  },
  col_map: {
    ship_to: ['Plant Code'],
    supplier_ref: ['SMART Number'],
    part_prefix: ['Prefix'],
    part_base: ['Base'],
    part_suffix: ['Suffix'],
    part_name: ['Part Description'],
    pulled_at: ['Replenishment time stamp'],
    containers: ['Containers Used'],
    qty: ['Part Quantity'],
    dock_code: ['Market Row'],
    market_area: ['Market Area'],
    market_rack: ['Market Rack'],
    lsa: ['LSA'],
    lp: ['LP'],
  },
  part_join: '-',
  qty_mode: 'containers_x_qty',
  ts_format: 'MDY',
  lead_min: 60,
  is_fallback: true,
};

/** field ที่ขาดไม่ได้ — ไม่มีก็ประกอบใบส่งไม่ได้เลย */
const REQUIRED_COLS = ['part_base', 'pulled_at', 'qty'];

/**
 * เลือกโปรไฟล์จากเนื้อไฟล์ (auto-detect) — นับคำใน `detect_keywords` ที่เจอในหัวไฟล์
 * @param {Array<Array<any>>} matrix แถวดิบทั้งไฟล์ (sheet_to_json header:1)
 * @param {Array<object>} profiles แถวจาก customer_pull_formats (is_active)
 * @returns {{profile: object, score: number, guessed: boolean}}
 *   guessed = ไม่มีคำไหน match เลย → ถอยไปโปรไฟล์ตัวแรก (จอต้องให้คนเลือกเอง)
 */
export function pickProfile(matrix, profiles) {
  const list = (profiles || []).filter(p => p && p.is_active !== false);
  const pool = list.length ? list : [FALLBACK_PROFILE];
  const hay = (matrix || []).slice(0, 12).map(r => (r || []).join(' ')).join(' ').toLowerCase();
  let best = pool[0], bestScore = 0;
  pool.forEach(p => {
    const kws = p.detect_keywords || [];
    const score = kws.reduce((n, k) => n + (k && hay.includes(String(k).toLowerCase()) ? 1 : 0), 0);
    if (score > bestScore) { best = p; bestScore = score; }
  });
  return { profile: best, score: bestScore, guessed: bestScore === 0 };
}

/**
 * หาแถวหัวตาราง = แถวแรกที่มีชื่อคอลัมน์ครบตาม `REQUIRED_COLS`
 * (ไฟล์มีหัวรายงาน 5-6 บรรทัดก่อนถึงตารางจริง และจำนวนบรรทัดไม่คงที่ระหว่าง .csv กับ .xlsx)
 * @returns {number} index ของแถวหัว · -1 = ไม่เจอ
 */
export function findHeaderRow(matrix, profile) {
  const cm = profile?.col_map || {};
  const need = REQUIRED_COLS.map(f => (cm[f] || []).map(normHead)).filter(a => a.length);
  if (!need.length) return -1;
  for (let i = 0; i < Math.min((matrix || []).length, 40); i++) {
    const cells = (matrix[i] || []).map(normHead);
    if (need.every(aliases => aliases.some(a => cells.includes(a)))) return i;
  }
  return -1;
}

/**
 * map field → index คอลัมน์ (เทียบทุก alias)
 * @returns {{idx: Record<string, number>, missing: string[]}}
 */
export function colIndexMap(headerCells, colMap) {
  const cells = (headerCells || []).map(normHead);
  const idx = {}; const missing = [];
  Object.entries(colMap || {}).forEach(([field, aliases]) => {
    const at = (aliases || []).map(normHead).map(a => cells.indexOf(a)).find(i => i >= 0);
    if (at === undefined) { if (REQUIRED_COLS.includes(field)) missing.push(field); }
    else idx[field] = at;
  });
  return { idx, missing };
}

/**
 * อ่านค่าในหัวไฟล์แบบ "ป้ายอยู่ช่องหนึ่ง ค่าอยู่ช่องถัดไป"
 * รองรับหลายคู่ในแถวเดียว: `Start Time | 2026-09-08T12:00:00 | End Time | 2026-09-08T14:00:00`
 */
export function readMeta(matrix, headerIdx, metaMap) {
  const out = {};
  const rows = (matrix || []).slice(0, headerIdx < 0 ? 12 : headerIdx);
  Object.entries(metaMap || {}).forEach(([field, aliases]) => {
    const want = (aliases || []).map(normHead);
    for (const row of rows) {
      const cells = row || [];
      for (let c = 0; c < cells.length - 1; c++) {
        if (want.includes(normHead(cells[c]))) {
          const v = cells[c + 1];
          if (v !== undefined && v !== null && String(v).trim() !== '') { out[field] = String(v).trim(); return; }
        }
      }
    }
  });
  return out;
}

/**
 * แปลงข้อความเวลาเป็น Date **เวลาท้องถิ่น** (ห้ามใช้ `new Date(str)` ตรงๆ)
 * เหตุผล: `09/08/2026` เอนจินต่างกันตีความ MDY/DMY ไม่เหมือนกัน และ ISO ที่ไม่มี offset
 * บางที่ถูกตีเป็น UTC → วันงานเพี้ยน (กฎเหล็ก Date/Time ของโปรเจค)
 * @param {string|Date|number} v
 * @param {'MDY'|'DMY'|'ISO'} fmt ลำดับวันของรูปแบบ `dd/mm/yyyy`
 * @returns {Date|null}
 */
export function parseTs(v, fmt = 'MDY') {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const s = String(v ?? '').trim();
  if (!s) return null;
  // ISO: 2026-09-08T12:00:00 / 2026-09-08 12:00
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { const [y, mo, d] = s.split('-').map(Number); return new Date(y, mo - 1, d); }
  // slash: 09/08/2026 13:43:46
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?/i);
  if (m) {
    const a = +m[1], b = +m[2];
    const [mo, d] = fmt === 'DMY' ? [b, a] : [a, b];
    let h = +(m[4] || 0);
    const ap = (m[7] || '').toUpperCase();
    if (ap === 'PM' && h < 12) h += 12;
    if (ap === 'AM' && h === 12) h = 0;
    return new Date(+m[3], mo - 1, d, h, +(m[5] || 0), +(m[6] || 0));
  }
  return null;
}

const pad2 = (n) => String(n).padStart(2, '0');
/** 'YYYY-MM-DD' จาก Date แบบ local (ห้าม toISOString — คืน UTC วันเพี้ยน) */
export const dateStr = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
/** 'HH:MM' จาก Date แบบ local */
export const timeStr = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

/**
 * รอบส่งที่ลูกค้ามารับ = ปลายช่วงเวลาในไฟล์ + lead_min
 * user 2026-09-08: "ถ้า 8:00-10:00 รอบดึงจะบวกไป 1 ชั่วโมงเป็น 11:00 คือรอบที่ลูกค้ามารับงาน
 *                   เพราะเป็นการส่งแบบ milkrun"
 * @returns {{at: Date, ship_time: string, work_date: string}|null}
 *   work_date = กรอบวันงาน 08:00→08:00 (ก่อน 08:00 นับเป็นวันก่อนหน้า — กฎเดียวกับทั้งระบบ)
 */
export function shipSlotOf(windowEnd, leadMin = 60) {
  if (!(windowEnd instanceof Date) || isNaN(windowEnd.getTime())) return null;
  const at = new Date(windowEnd.getTime() + (Number(leadMin) || 0) * 60000);
  const wd = new Date(at.getTime());
  if (wd.getHours() < 8) wd.setDate(wd.getDate() - 1);
  return { at, ship_time: timeStr(at), work_date: dateStr(wd) };
}

/** ประกอบเลขพาร์ทลูกค้า RB3B + 16E060 + BA → 'RB3B-16E060-BA' (ส่วนที่ว่างถูกข้าม) */
export function joinPartNo(prefix, base, suffix, join = '-') {
  return [prefix, base, suffix].map(x => String(x ?? '').trim()).filter(Boolean).join(join);
}

const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

/**
 * อ่านไฟล์ทั้งใบ → แถวสัญญาณ + meta + คำเตือน
 * @param {Array<Array<any>>} matrix  sheet_to_json(ws, { header: 1, raw: true, defval: '' })
 * @param {object} profile            แถวจาก customer_pull_formats (หรือ FALLBACK_PROFILE)
 * @returns {{ok: boolean, error?: string, meta: object, rows: Array<object>, warnings: string[],
 *            windowStart: Date|null, windowEnd: Date|null, slot: object|null, shipTo: string|null}}
 */
export function parsePullFile(matrix, profile) {
  const p = profile || FALLBACK_PROFILE;
  const warnings = [];
  const headerIdx = findHeaderRow(matrix, p);
  if (headerIdx < 0) {
    return { ok: false, error: 'หาแถวหัวตารางไม่เจอ — คอลัมน์ที่ต้องมีอย่างน้อย: เลขพาร์ท (Base) · เวลาที่ดึง · จำนวน',
      meta: {}, rows: [], warnings, windowStart: null, windowEnd: null, slot: null, shipTo: null };
  }
  const { idx, missing } = colIndexMap(matrix[headerIdx], p.col_map);
  if (missing.length) {
    return { ok: false, error: `ไฟล์ขาดคอลัมน์: ${missing.join(', ')}`,
      meta: {}, rows: [], warnings, windowStart: null, windowEnd: null, slot: null, shipTo: null };
  }
  const meta = readMeta(matrix, headerIdx, p.meta_map);
  const windowStart = parseTs(meta.window_start, p.ts_format);
  const windowEnd = parseTs(meta.window_end, p.ts_format);
  const slot = shipSlotOf(windowEnd, p.lead_min);
  if (!windowEnd) warnings.push('ไฟล์ไม่ได้บอกช่วงเวลา (End Time) — ต้องเลือกวัน/รอบส่งเองบนจอ');

  const at = (row, f) => (idx[f] === undefined ? '' : row[idx[f]]);
  const rows = [];
  let badTs = 0, badQty = 0, blank = 0;
  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const r = matrix[i] || [];
    if (r.every(c => String(c ?? '').trim() === '')) continue;
    const partNo = joinPartNo(at(r, 'part_prefix'), at(r, 'part_base'), at(r, 'part_suffix'), p.part_join);
    if (!partNo) { blank++; continue; }
    const pulledAt = parseTs(at(r, 'pulled_at'), p.ts_format);
    if (!pulledAt) { badTs++; continue; }
    const per = num(at(r, 'qty'));
    const cont = idx.containers === undefined ? 1 : (num(at(r, 'containers')) ?? 1);
    if (per === null) { badQty++; continue; }
    const qty = p.qty_mode === 'qty_only' ? per : per * cont;
    rows.push({
      ship_to: String(at(r, 'ship_to') ?? '').trim() || null,
      supplier_ref: String(at(r, 'supplier_ref') ?? '').trim() || null,
      customer_part_no: partNo,
      part_name: String(at(r, 'part_name') ?? '').trim() || null,
      pulled_at: pulledAt,
      containers: cont,
      qty_per_container: per,
      qty,
      dock_code: String(at(r, 'dock_code') ?? '').trim() || null,
      market_area: String(at(r, 'market_area') ?? '').trim() || null,
      market_rack: String(at(r, 'market_rack') ?? '').trim() || null,
      lsa: String(at(r, 'lsa') ?? '').trim() || null,
      lp: String(at(r, 'lp') ?? '').trim() || null,
    });
  }
  // ห้ามข้ามเงียบ — ทุกแถวที่ทิ้งต้องนับให้เห็นบนจอ
  if (badTs) warnings.push(`ข้าม ${badTs} แถว — อ่านเวลาที่ดึงไม่ออก`);
  if (badQty) warnings.push(`ข้าม ${badQty} แถว — อ่านจำนวนไม่ออก`);
  if (blank) warnings.push(`ข้าม ${blank} แถว — ไม่มีเลขพาร์ท`);

  const shipTos = [...new Set(rows.map(r => r.ship_to).filter(Boolean))];
  if (shipTos.length > 1) warnings.push(`ไฟล์มีหลาย Plant Code: ${shipTos.join(', ')} — ระบบจะแยกใบตามแต่ละเจ้า`);

  return { ok: rows.length > 0, error: rows.length ? undefined : 'ไม่พบแถวข้อมูลในไฟล์',
    meta, rows, warnings, windowStart, windowEnd, slot, shipTo: shipTos[0] || null };
}

/** คีย์กันนำเข้าซ้ำ — ตรงกับ unique index `customer_pull_signals_dedup_idx` ฝั่ง DB เป๊ะ */
export const signalKey = (r, source = 'esmart') =>
  `${source}|${r.ship_to || ''}|${r.supplier_ref || r.customer_part_no}|${
    r.pulled_at instanceof Date ? r.pulled_at.toISOString() : String(r.pulled_at)}`;

/**
 * รวมยอดรายพาร์ท (ต่อ ship-to) — 1 กลุ่ม = 1 ใบส่งที่จะสร้าง/อัพเดท
 * @returns {Array<{ship_to, customer_part_no, supplier_ref, part_name, dock_code, qty, containers, pulls, first_at, last_at}>}
 */
export function aggregateSignals(rows) {
  const m = new Map();
  (rows || []).forEach(r => {
    const k = `${r.ship_to || ''}|${r.customer_part_no}`;
    let g = m.get(k);
    if (!g) {
      g = { ship_to: r.ship_to, customer_part_no: r.customer_part_no, supplier_ref: r.supplier_ref,
        part_name: r.part_name, dock_code: r.dock_code, qty: 0, containers: 0, pulls: 0,
        first_at: r.pulled_at, last_at: r.pulled_at };
      m.set(k, g);
    }
    g.qty += Number(r.qty) || 0;
    g.containers += Number(r.containers) || 0;
    g.pulls += 1;
    if (!g.part_name && r.part_name) g.part_name = r.part_name;
    if (!g.dock_code && r.dock_code) g.dock_code = r.dock_code;
    if (r.pulled_at < g.first_at) g.first_at = r.pulled_at;
    if (r.pulled_at > g.last_at) g.last_at = r.pulled_at;
  });
  return [...m.values()].sort((a, b) => a.customer_part_no.localeCompare(b.customer_part_no));
}

/** สถานะที่ "ทำไปแล้ว" — ห้ามแก้ยอด (สต็อกอาจถูกหักไปแล้ว · user เคาะ 2026-09-08: ไม่แตะ แต่รายงานส่วนต่าง) */
export const LOCKED_STATUSES = ['prepared', 'loaded', 'shipped'];

/**
 * ตัดสินว่าแต่ละพาร์ทจะทำอะไรกับใบส่งที่มีอยู่ — **pure** (ไม่แตะ DB)
 *
 * กติกา (user เคาะ 2026-09-08):
 *   - เจอใบในรอบนั้น + ยังไม่เตรียม → **อัพเดทยอด + ยืนยัน** (pending → confirmed)
 *   - เจอใบแต่ `prepared` ขึ้นไป      → **ไม่แตะ** รายงานส่วนต่างให้คนไปจัดการเอง
 *   - ไม่เจอใบเลย                     → **สร้างใหม่** (source esmart · confirmed)
 *   - พาร์ทที่ไม่อยู่ในไฟล์            → ไม่อยู่ในผลลัพธ์นี้เลย = ไม่ถูกแตะ (862 ถูกอยู่แล้ว)
 *
 * @param {Array} groups  ผลจาก aggregateSignals
 * @param {Array} orders  customer_shipping_orders ของ ship-to + work_date + ship_time นั้น
 * @param {(partNo:string)=>{mat:string|null,status:string,candidates:string[]}} resolve ตัวจับคู่ MAT
 * @returns {Array<{group, order, mat, matStatus, candidates, action, diff, reason}>}
 *   action: 'update' | 'create' | 'locked' | 'unresolved' | 'same'
 */
export function planOrderUpdates(groups, orders, resolve) {
  const byPart = new Map();
  (orders || []).forEach(o => {
    const k = normKey(o.customer_part_no || o.mat_no);
    if (!byPart.has(k)) byPart.set(k, []);
    byPart.get(k).push(o);
  });
  return (groups || []).map(g => {
    const r = resolve ? resolve(g.customer_part_no) : { mat: null, status: 'none', candidates: [] };
    // ใบเดิมจับด้วยเลขลูกค้าก่อน (EDI เก็บ customer_part_no) แล้วค่อยลองเลข MAT ที่ map ได้
    const cand = [...(byPart.get(normKey(g.customer_part_no)) || []),
      ...(r.mat ? (byPart.get(normKey(r.mat)) || []) : [])];
    const seen = new Set(); const list = cand.filter(o => !seen.has(o.id) && seen.add(o.id));
    const open = list.find(o => !LOCKED_STATUSES.includes(o.status));
    const locked = list.find(o => LOCKED_STATUSES.includes(o.status));
    const base = { group: g, mat: r.mat, matStatus: r.status, candidates: r.candidates || [] };
    if (open) {
      const diff = g.qty - Number(open.qty || 0);
      return { ...base, order: open, action: diff === 0 ? 'same' : 'update', diff,
        reason: diff === 0 ? 'ยอดตรงกับ 862 อยู่แล้ว' : null };
    }
    if (locked) {
      return { ...base, order: locked, action: 'locked', diff: g.qty - Number(locked.qty || 0),
        reason: `ใบนี้${locked.status === 'shipped' ? 'ส่งไปแล้ว' : 'เตรียม/โหลดไปแล้ว'} — ไม่แก้ยอดให้ (สต็อกอาจถูกหักแล้ว)` };
    }
    if (!r.mat) {
      return { ...base, order: null, action: 'unresolved', diff: g.qty,
        reason: matIssueOf(r) };
    }
    return { ...base, order: null, action: 'create', diff: g.qty, reason: 'ไม่มีใบในรอบนี้ — สร้างใหม่จากยอดที่ลูกค้ายืนยัน' };
  });
}

const normKey = (s) => String(s ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();

function matIssueOf(r) {
  if (r.status === 'ambiguous') return `จับคู่ MAT ได้หลายตัว (${(r.candidates || []).join(' / ')}) — ตั้ง "ลูกค้า" ที่ Product Master ให้ตรง ship-to`;
  if (r.status === 'placeholder') return `จับคู่ได้แต่ปลายทางไม่ใช่เลข SAP (${(r.candidates || [])[0] || '—'})`;
  return 'ไม่มีพาร์ทนี้ใน Product Master — ตั้ง p_no ก่อน';
}
