/* ══════════════════════════════════════════════════════════════════════════
   🎴 boardCards — ใบผลิตของวัน → "การ์ด" สำหรับบอร์ด Heijunka แบบย่อ · pure (2026-10-16)

   ใช้ที่ `components/LineOrderBoard.jsx` (กล่องรายละเอียดไลน์บนผังรวม แท็บ 📦 ยอดผลิต
   — user 16/10: "เรื่องยอดผลิต เปลี่ยนจากผังเป็น heijunka ของไลน์ที่เลือก ว่ามีงานอะไรกำลังผลิต ตกแผน ได้ตามเป้า")
   · ผู้ใช้ 3 จอ: บอร์ด /management · บอร์ด /dashboard · กล่องไลน์บนผังรวม — **สร้างการ์ดที่นี่ที่เดียว**
     (2026-10-19 ยุบสำเนา `buildCards` ในหน้า 2 ชุดเข้ามา · ห้ามเขียนใหม่ในหน้า — มีด่าน)
   · เวลาเริ่ม = opened_at จริง · /dashboard ส่ง `guessStartFromSession` = ใบไม่มี opened_at
     เดาเวลาเริ่มจากเวลาเปิดกะ + CT สะสม (พฤติกรรมเดิมของหน้านั้น)
   · คิว/ดีเลย์/หลุดแผน ยังคิดที่ `utils/heijunkaQueue.js` (`positionAllCards` · `planStatusOf`) **ห้ามคิดในหน้า**
   ══════════════════════════════════════════════════════════════════════════ */

export const ROUND_MS = 2 * 3600000;

/** กรอบเวลา 24 ชม. ของวันงาน (08:00 → 07:59 วันถัดไป) + ครึ่งวัน + ตัวแบ่งรอบ — ค่าเดียวกับบอร์ด /management */
export function boardFrame(workDate) {
  const gridStartMs = new Date(`${workDate}T08:00:00`).getTime();
  const gridEndMs = gridStartMs + 24 * 3600000;
  const halves = [
    { key: 'am', startMs: gridStartMs },
    { key: 'pm', startMs: gridStartMs + 12 * 3600000 },
  ];
  return {
    gridStartMs, gridEndMs, halves,
    roundIndexOf: (ms) => Math.floor((ms - gridStartMs) / ROUND_MS),
    roundStartOf: (idx) => gridStartMs + idx * ROUND_MS,
  };
}

/**
 * ใบผลิตของทุกกะ → การ์ด (ตัดใบ carry_over ต้นทางทิ้ง — ใบใหม่ที่รับยกยอดคืองานเดียวกัน)
 * @param {object[]} sessions  [{ shift, status, line_name, dr_products?, orders: [...] }]
 */
export function buildBoardCards(sessions = [], { ctByMat = {}, nameByMat = {}, imgByMat = {}, nowMs = Date.now(), guessStartFromSession = false } = {}) {
  const cards = [];
  for (const s of sessions) {
    const sessionCtSec = s.dr_products?.cycle_time_sec || 0;
    const sessionStartMs = guessStartFromSession && s.created_at ? new Date(s.created_at).getTime() : null;
    const sorted = [...(s.orders || [])].filter(o => o.status !== 'carry_over')
      .sort((a, b) => new Date(a.opened_at || 0) - new Date(b.opened_at || 0));
    let cumSec = 0;
    for (const o of sorted) {
      const ctSec = ctByMat[o.mat_no] || sessionCtSec || 0;
      const startSec = cumSec;
      cumSec += (o.qty || 0) * ctSec;
      const orderStartMs = o.opened_at ? new Date(o.opened_at).getTime()
        : (sessionStartMs && ctSec > 0 ? sessionStartMs + startSec * 1000 : null);
      let orderEndMs = orderStartMs && ctSec > 0 ? orderStartMs + (o.qty || 0) * ctSec * 1000 : null;
      if (orderStartMs && !orderEndMs) orderEndMs = orderStartMs + 5 * 60000;   // ไม่รู้ CT = แท่งบาง (เหมือนบอร์ดหลัก)
      const isDone = o.status === 'confirmed';
      const isCarry = o.status === 'carry_over';
      const isDelayed = !isDone && !isCarry && !o.is_backfill && !!orderEndMs && nowMs > orderEndMs;
      const productLabel = nameByMat[o.mat_no] || s.dr_products?.name || o.mat_no || 'ไม่ทราบ P/N';
      // คีย์แถว: มีชื่อ = ชื่อตัวใหญ่ · ไม่มีชื่อ = mat_no ตามตัว (ตรงกับคีย์เดิมของบอร์ดหลัก — แถวไม่แตก/ไม่ยุบต่างจากเดิม)
      const productKey = (nameByMat[o.mat_no] || s.dr_products?.name || '').trim().toUpperCase() || o.mat_no || 'unknown';
      cards.push({ ...o, orderStartMs, orderEndMs, isDone, isCarry, isDelayed, productKey, productLabel,
        productImg: imgByMat[o.mat_no] || '', shift: s.shift, sessionOpen: s.status === 'open', line_name: s.line_name, ctSec });
    }
  }
  return cards;
}

/** สถานะของการ์ด 1 ใบบนบอร์ดย่อ — `positioned` = ผลของ positionAllCards สำหรับใบนี้ (อาจ undefined) */
export function cardState(card, positioned) {
  if (card.isDone) return positioned?.isLateDone ? 'late_done' : 'done';
  if (!card.orderStartMs) return 'waiting';
  if (positioned?.isDelayed || card.isDelayed) return 'late';
  return 'running';
}

export const CARD_STATE_META = {
  running: { label: 'กำลังผลิต', color: '#3b82f6' },
  late: { label: 'ตกแผน (เลยเวลา)', color: '#ef4444' },
  done: { label: 'เสร็จตามแผน', color: '#22c55e' },
  late_done: { label: 'เสร็จช้ากว่าแผน', color: '#f59e0b' },
  waiting: { label: 'ยังไม่เปิดใบ', color: '#6b7280' },
};

/** ยอดที่ทำได้ของใบ — สูตรบังคับของระบบ `confirmed ? (qty_ok ?? qty) : (qty_actual ?? 0)` */
export const cardMade = (o) => (o.status === 'confirmed' ? Number(o.qty_ok ?? o.qty ?? 0) || 0 : Number(o.qty_actual ?? 0) || 0);

/** แถวต่อพาร์ท (ไลน์แม่รวมหลายไลน์ลูก = พาร์ทเดียวกันคนละไลน์แยกแถว — คิวเป็นของเครื่องเดียวกัน) */
export function groupBoardRows(cards = []) {
  const multi = new Set(cards.map(c => c.line_name)).size > 1;
  const groups = {};
  for (const c of cards) {
    const k = multi ? `${c.line_name || ''}|${c.productKey}` : c.productKey;
    (groups[k] ||= { key: k, label: c.productLabel, img: c.productImg, mat_no: c.mat_no, line: multi ? c.line_name : null, cards: [] }).cards.push(c);
  }
  return Object.values(groups).sort((a, b) => a.label.localeCompare(b.label) || String(a.line || '').localeCompare(String(b.line || '')));
}
