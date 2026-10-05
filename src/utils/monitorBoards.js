import { getWorkDate } from './workDate.js';
import { buildDayPeriods, buildWeekPeriods, buildDatePeriods, RECUR } from './monitorGrid.js';
import { addDays } from './planHorizon.js';

/* ══ 📉 monitorBoards — "ชีทไหนมีแถวอะไร" (การตั้งค่า ไม่ใช่สูตร) ══════════════════════
   สูตรอยู่ `monitorGrid.js` · ตัวแกะไฟล์อยู่ `monitoringSheet.js` · ไฟล์นี้คือ**ค่าตั้งต้น**
   ที่ใช้ตอน "สร้างบอร์ดใหม่" แล้วหลังจากนั้น **ความจริงอยู่ที่ `monitor_boards.rows` ใน DB**
   ⇒ ทีมวางแผนเพิ่ม/ถอดแถวเองได้ โดยไม่ต้องรอ deploy (data-driven ก่อน hardcode)

   🔴 `rowDefs(board)` = ทางเดียวที่หน้าจออ่านชุดแถว — ห้ามหน้าไหนเขียนลิสต์แถวเอง
     (เขียนเอง = วันที่ทีมเพิ่มแถวใน DB จอนั้นไม่เห็น แล้วตัวเลขสองจอไม่ตรงกัน)
   ═══════════════════════════════════════════════════════════════════════════════════════ */

/** แท็บของหน้า /monitoring — เรียงตามลำดับที่ทีมวางแผนใช้งานจริง (ไลน์ปั๊มเป็นงานประจำวัน) */
export const BOARD_TABS = [
  { key: 'line',   label: '🏭 ไลน์ปั๊ม',        sheets: '110T · 300T · 250T · 800T · 600T' },
  { key: 'rack',   label: '📦 FG รายแร็ค',      sheets: 'TSPK · TSESA+LA' },
  { key: 'great',  label: '📅 ความต้องการรายสัปดาห์', sheets: 'Argen' },
  { key: 'raw',    label: '🧱 วัตถุดิบ (R402)',  sheets: 'mat' },
  { key: 'vendor', label: '🔗 งานส่งชุบ',        sheets: 'RA · 824-825' },
];
export const BOARD_KINDS = BOARD_TABS.map((t) => t.key);

/** ป้ายไทยของแถว (ไฟล์ Excel เขียนอังกฤษ — จอเราเขียนไทยให้หน้างานอ่านออก) */
export const ROW_LABEL = {
  plan:        'PLAN · แผน',
  in:          'IN · ผลิตเข้า',
  unbound:     'UNBOUND · แผนค้างสะสม',
  out:         'OUT · จ่ายออก',
  balance:     'BALANCE · คงเหลือ',
  wip:         'WIP · งานระหว่างทำ',
  min:         'MIN · ขั้นต่ำ',
  max:         'MAX · สูงสุด',
  order:       'ORDER · ลูกค้าสั่ง',
  order_req:   'ความต้องการลูกค้า',
  prod_date:   'วันที่ผลิต',
  stock_wh:    'STOCK W/H · สต๊อกคลัง',
  send:        'ส่งลูกค้า',
  to_vendor:   'ส่งไปชุบ',
  from_vendor: 'รับคืนจากชุบ',
  at_vendor:   'ค้างที่ร้านชุบ',
  diff_fc:     'ห่างจาก Forecast',
  on_hand_kg:  'เหล็กคงเหลือ (กก.)',
  queue_pcs:   'งานท้ายไลน์ (ชิ้น)',
};

/* ── ชุดแถวตั้งต้นต่อชนิดบอร์ด (ถอดจากไฟล์จริง 01/10) ─────────────────────────────── */
const R = (key, kind, recur) => ({ key, label: ROW_LABEL[key] || key, kind, ...(recur ? { recur } : {}) });

export const ROW_PRESETS = {
  /* 800T · 600T — 6 แถว */
  line: [
    R('plan', 'input'),
    R('in', 'system'),
    R('unbound', 'recur', 'plan_backlog'),
    R('out', 'system'),
    R('balance', 'recur', 'stock_run'),
    R('min', 'const'),
  ],
  /* 110T · 300T · 250T — เหมือนข้างบน + WIP (ไลน์ที่ส่งงานต่อไลน์อื่น จึงมีของค้างกลางทาง) */
  line_wip: [
    R('plan', 'input'),
    R('in', 'system'),
    R('unbound', 'recur', 'plan_backlog'),
    R('out', 'system'),
    R('balance', 'recur', 'stock_run'),
    R('wip', 'input'),
    R('min', 'const'),
  ],
  /* TSPK · TSESA+LA — FG ตั้งต้นแล้วหักออเดอร์ตามวันส่ง */
  rack: [
    R('order', 'input'),
    R('balance', 'recur', 'deplete'),
    R('min', 'const'),
    R('max', 'const'),
  ],
  /* Argen — ยอดลูกค้ารายสัปดาห์ */
  great: [
    R('order_req', 'input'),
    R('prod_date', 'date'),
    R('plan', 'input'),
    R('in', 'system'),
    R('unbound', 'recur', 'plan_backlog'),
    R('send', 'input'),
    R('balance', 'recur', 'stock_send'),
  ],
  /* mat (R402) — ภาพ ณ วัน ไม่ใช่การไหล */
  raw: [
    R('on_hand_kg', 'input'),
    R('queue_pcs', 'input'),
  ],
  /* RA · 824-825 — งานส่งชุบข้างนอก */
  vendor: [
    R('to_vendor', 'input'),
    R('from_vendor', 'input'),
    R('at_vendor', 'recur', 'vendor_wip'),
  ],
};

/** ค่าตั้งต้นของบอร์ดใหม่ตามชนิด (ตรงกับที่วัดจากไฟล์จริง) */
export const BOARD_DEFAULTS = {
  line:   { period_kind: 'day',  period_count: 34, sl_row: 'out', sl_includes_seed: false },
  rack:   { period_kind: 'date', period_count: 8,  sl_row: 'order', sl_includes_seed: false },
  great:  { period_kind: 'week', period_count: 13, sl_row: 'send',  sl_includes_seed: false },
  raw:    { period_kind: 'day',  period_count: 1,  sl_row: 'queue_pcs', sl_includes_seed: false },
  vendor: { period_kind: 'day',  period_count: 34, sl_row: 'to_vendor', sl_includes_seed: false },
};

/**
 * ชุดแถวของบอร์ด — **ทางเดียวที่จอควรอ่าน**
 * 🔴 แถวที่ไม่มี `kind` หรือ kind ที่ไม่รู้จัก = ตกเป็น 'input' (ให้คนกรอกได้) **ห้ามทิ้งแถว**
 *    (ทิ้ง = แถวหายจากจอเงียบๆ แล้วไม่มีใครรู้ว่าหาย — กติกา "ต้องมีตะกร้ารับท้ายลิสต์")
 */
export function rowDefs(board) {
  const raw = Array.isArray(board?.rows) ? board.rows : null;
  const src = raw && raw.length ? raw : (ROW_PRESETS[board?.kind] || []);
  return src
    .filter((r) => r && (r.key || typeof r === 'string'))
    .map((r) => {
      const o = typeof r === 'string' ? { key: r } : r;
      const kind = ['input', 'system', 'recur', 'const', 'date'].includes(o.kind) ? o.kind : 'input';
      /* สูตรที่ DB อ้างแต่โค้ดไม่รู้จัก = ยังถือว่าเป็นแถว recur (จะได้ null + จอบอกว่าคิดไม่ได้)
         ห้ามแปลงเป็น input เงียบๆ — คนจะเห็นช่องว่างแล้วกรอกทับค่าที่ควรคำนวณ */
      return {
        key: String(o.key),
        label: o.label || ROW_LABEL[o.key] || String(o.key),
        kind,
        recur: kind === 'recur' ? o.recur || null : null,
        unknownRecur: kind === 'recur' && !RECUR[o.recur],
      };
    });
}

/** แถวไหนคือ "คงเหลือ" / "ขั้นต่ำ" ของบอร์ดนี้ (ใช้ตีสีของขาด) — ไม่มี = ไม่ตีสี */
export function balanceRowKey(board) {
  const keys = rowDefs(board).map((r) => r.key);
  return keys.includes('balance') ? 'balance' : (keys.includes('at_vendor') ? 'at_vendor' : null);
}
export function minRowKey(board) {
  return rowDefs(board).some((r) => r.key === 'min') ? 'min' : null;
}

/**
 * คอลัมน์ของบอร์ด
 * ⚠️ รับ `now` เพื่อให้เทสตรึงเวลาได้ (กฎ build gate: รอบ "นาฬิกา +400 วัน")
 * @param {object} board แถวจาก monitor_boards
 * @param {object} [o]   { now, dates } · `dates` = วันที่ที่ระบุเอง (period_kind='date')
 */
export function boardPeriods(board, { now, dates } = {}) {
  const kind = board?.period_kind || 'day';
  const n = Number(board?.period_count) || 0;
  if (kind === 'date') {
    /* บอร์ดรายวันส่ง: คอลัมน์มาจาก "วันที่ลูกค้าสั่งรับ" ที่มีอยู่จริง ไม่ใช่ปฏิทินต่อเนื่อง
       ⇒ ต้องมีคอลัมน์ยอดยกมาด้วย (วันก่อนวันสั่งแรก) ไม่งั้นสูตร deplete เริ่มจาก null */
    const list = (Array.isArray(dates) ? dates : []).map((d) => String(d).slice(0, 10)).filter(Boolean);
    const uniq = [...new Set(list)].sort();
    if (!uniq.length) return [];
    return buildDatePeriods([addDays(uniq[0], -1), ...uniq]);
  }
  const start = board?.start_date ? String(board.start_date).slice(0, 10) : getWorkDate(now);
  if (!(n > 0)) return [];
  return kind === 'week' ? buildWeekPeriods(start, n) : buildDayPeriods(start, n);
}

/** คีย์บอร์ดจากชื่อชีท (ใช้ตอน import — ให้ import ซ้ำลงบอร์ดเดิม ไม่สร้างซ้ำ) */
export function boardKeyOfSheet(kind, sheetName) {
  const slug = String(sheetName || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9ก-๙]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${kind}-${slug || 'board'}`;
}

/** ไลน์ในระบบที่ชีทไลน์ปั๊มชื่อนี้หมายถึง — วัดจาก dr_products 01/10 (ยืนยันกับทะเบียนจริง)
 *  ⚠️ 110T กับ 300T ชี้ไลน์**เดียวกัน** (LINE D ( 110&300 Ton )) — 2 ชีท 1 ไลน์ ไม่ใช่ความผิดพลาด
 *  ⚠️ แมปนี้เป็นเพียง **ค่าเสนอตอนสร้างบอร์ด** · ของจริงเก็บที่ `monitor_boards.line_name`
 *     ซึ่งแก้ได้จากจอ — ห้ามให้โค้ดอ่านแมปนี้ตอน runtime (ชื่อไลน์เปลี่ยนได้) */
export const SHEET_LINE_HINT = {
  '800T': 'LINE A ( 800 Ton )',
  '600T': 'LINE B ( 600 Ton )',
  '250T': 'LINE C ( 200&250 Ton )',
  '110T': 'LINE D ( 110&300 Ton )',
  '300T': 'LINE D ( 110&300 Ton )',
};

/** คีย์ประจำ "แถวพาร์ท" ในบอร์ด = MAT + เลขพาร์ท
 *  🔴 MAT เดียวกันเป็นคนละแถวได้จริง — 300T มี `20059152` 2 แถว (N1WB-E16A416 คว่ำครีบ /
 *     N1WB-E16A417 หงายครีบ) Total SL 2,100 กับ 1,500 ⇒ ยุบเป็นแถวเดียว = ทีมวางแผนเสียแถวไป 1 แถว
 *  🔴 **สูตรนี้ต้องตรงกับ trigger `monitor_parts_set_row_key()` ฝั่ง DR เป๊ะ** (migration
 *     20261005_monitor_parts_row_key_dr.sql) — DB เป็นเจ้าของค่าที่เก็บ ฝั่งนี้ใช้แค่จับคู่/ยุบซ้ำ
 *     ก่อนส่ง แก้ข้างเดียว = upsert ไปชนแถวผิดเงียบๆ */
export const partRowKey = (matNo, partNo) =>
  `${String(matNo ?? '').trim()}|${String(partNo ?? '').trim()}`;

/** ยุบแถวซ้ำใน "ก้อนเดียวที่จะ upsert" — คีย์ซ้ำในชุดเดียว PostgreSQL ปฏิเสธทั้งก้อน
 *  (`ON CONFLICT DO UPDATE command cannot affect row a second time`)
 *  🔴 **ค่าล่างทับค่าบน ห้ามรวมยอด** — ไฟล์จริงวางบล็อกซ้ำไว้ (Argen ซ้ำ 2 พาร์ท ค่าเท่ากันทุกช่อง
 *     256/256 · 192/192 = สำเนา) ถ้ารวมยอดจะกลายเป็น 2 เท่าเงียบๆ
 *  คืน `conflict` = จำนวนที่ซ้ำแล้ว**ค่าไม่ตรงกัน** ⇒ จอต้องเขียนบอก ห้ามกลืน */
export function dedupeByKey(rows, keyOf, sameOf) {
  const at = new Map();
  const out = [];
  let merged = 0;
  let conflict = 0;
  for (const r of rows) {
    const k = keyOf(r);
    const i = at.get(k);
    if (i === undefined) { at.set(k, out.length); out.push(r); continue; }
    merged++;
    if (sameOf && !sameOf(out[i], r)) conflict++;
    out[i] = r;                        // ค่าล่างชนะ
  }
  return { rows: out, merged, conflict };
}
