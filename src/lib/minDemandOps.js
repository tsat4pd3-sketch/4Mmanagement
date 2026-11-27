/* ═══ 🔔 "ของถึง min แล้ว" — โหลดครั้งเดียว ใช้ได้ทั้งจอผลิตและจอวางแผน ═══════════════
 *
 * คำสั่ง user 13/11: *"เมื่อ stock ลดลงถึง min จะแสดงความต้องการไปหาไลน์ผลิตเจ้าของงานนั้น
 * เพื่อให้เตรียมตัว และไปฝ่ายวางแผนเพื่อเห็นว่ามีงานตัวไหนต้องจัดแผนลง"*
 *
 * 🔴 **กฎการตัดสินอยู่ `utils/replenish.js` (`minAlerts`) ที่เดียว** — ไฟล์นี้แค่ไปเอาข้อมูลมาป้อน
 *    ห้ามตัดสิน "ติด min ไหม" ที่นี่ และห้ามก๊อปสูตรไปไว้ในหน้า (2 จอต้องตอบเลขเดียวกัน)
 * 🔴 **อ่านไม่ครบ = `error` ไม่ใช่ "ไม่มีของติด min"** — จอต้องเขียนบนจอว่าตอบไม่ได้
 *    (ลิสต์ว่าง 2 ความหมาย · กฎเหล็ก DB ข้อ 12)
 * 🔴 ทะเบียนอ่านเฉพาะ `is_active` — FG ถูกปิดไปแล้ว 32 แถว (migration 20261115) **ห้ามถอดตัวกรองนี้**
 *
 * 📄 docs/modules/kanban-auto-calc.md §ของถึง min
 * ═══════════════════════════════════════════════════════════════════════════════ */
import { supabaseDR } from '../supabaseClient';
import { fetchByIds } from '../utils/fetchByIds';
import { minAlerts, minAlertSummary } from '../utils/replenish';

/* เลือกเท่าที่ใช้ — ตารางพวกนี้โตได้ (กฎเหล็ก DB ข้อ 11: egress คิดเป็นไบต์) */
const LV_COLS = 'line_name, mat_no, min_qty, max_qty, is_active';

/**
 * ของที่ถึง min แล้วทั้งโรงงาน (ยังไม่กรองไลน์ — ให้จอกรองเอง)
 * @returns {{ rows: Array, summary: object, error: string|null }}
 *          `error != null` = **ตอบไม่ได้** ห้ามแปลว่า "ไม่มีของติด min"
 */
export async function loadMinAlerts() {
  const lv = await supabaseDR.from('line_part_levels').select(LV_COLS)
    .eq('is_active', true).gt('min_qty', 0).limit(1000);
  if (lv.error) return { rows: [], summary: minAlertSummary([]), error: lv.error.message };
  const levels = lv.data || [];
  if (!levels.length) return { rows: [], summary: minAlertSummary([]), error: null };

  const mats = [...new Set(levels.map(l => l.mat_no).filter(Boolean))];
  /* `.in()` ยาว = URL เกินเพดาน proxy แล้วคืนค่าว่างเงียบ ⇒ ผ่าน fetchByIds เสมอ */
  const [stock, prods, moves] = await Promise.all([
    /* 🔴 `line_stock_summary` เป็น **วิว ไม่มีคอลัมน์ `id`** ⇒ ต้องส่ง `orderBy` เองเสมอ
       ไม่ส่ง = `fetchByIds` ใช้ดีฟอลต์ `'id'` แล้วล้มทั้งก้อนด้วย 42703
       (เกิดจริง 18/11: แผง "ของถึง min แล้ว" ขึ้น "โหลดไม่ครบ — column line_stock_summary.id does not exist")
       🔴 คีย์ที่ unique จริงของวิวนี้คือ **(line_name, mat_no)** — order ด้วย `mat_no` เดี่ยวมีค่าซ้ำได้
       ⇒ `range()` ข้ามหน้าแล้วแถวหลุด/ซ้ำเงียบๆ (กฎ DB ข้อ 5) */
    fetchByIds(mats, part => supabaseDR.from('line_stock_summary').select('line_name, mat_no, qty_on_hand, part_name').in('mat_no', part),
      { orderBy: ['line_name', 'mat_no'] }),
    /* 🔴 `dr_products` ไม่มีคอลัมน์ `part_name` — ชื่อคือ `name` (มีด่าน dr-products-has-no-part-name) */
    fetchByIds(mats, part => supabaseDR.from('dr_products').select('mat_no, line_name, name').in('mat_no', part)),
    /* 🔴 เวลาขยับล่าสุดของบัญชี — ตัวตัดสินว่า "0" คือของหมดจริง หรือแค่ไม่มีใครนับ
       ผ่าน RPC (migration 20261116) เพราะดึงแถวดิบมานับเองคือหลักพันแถวต่อพาร์ท */
    supabaseDR.rpc('line_part_last_move', { p_mats: mats }),
  ]);
  if (stock.failed || stock.truncated) return { rows: [], summary: minAlertSummary([]), error: stock.error || 'โหลดยอดคงเหลือไม่ครบ' };
  if (prods.failed || prods.truncated) return { rows: [], summary: minAlertSummary([]), error: prods.error || 'โหลดทะเบียนสินค้าไม่ครบ' };
  if (moves.error) return { rows: [], summary: minAlertSummary([]), error: `อ่านเวลาเคลื่อนไหวบัญชีไม่ได้ — ${moves.error.message}` };

  /* 🔴 ไม่มีแถวใน ledger = **ไม่ส่งค่า** (undefined → null) ห้ามแทนด้วย 0 — "ไม่เคยนับ ≠ ของหมด" */
  const onHand = new Map((stock.rows || []).map(s => [`${s.line_name}\u0001${s.mat_no}`, s.qty_on_hand]));
  const nameOf = new Map();
  const ownerOf = new Map();
  (prods.rows || []).forEach(p => {
    if (p.line_name) ownerOf.set(p.mat_no, p.line_name);
    if (p.name) nameOf.set(p.mat_no, p.name);
  });
  (stock.rows || []).forEach(s => { if (s.part_name && !nameOf.has(s.mat_no)) nameOf.set(s.mat_no, s.part_name); });

  const withName = levels.map(l => ({ ...l, part_name: nameOf.get(l.mat_no) || '' }));
  const lastMove = new Map((moves.data || []).map(m => [`${m.line_name}\u0001${m.mat_no}`, m.last_at]));
  /* 🔎 "ของตัวนี้ขยับจริงที่ไหน" — RPC คืน **ทุก** คู่ (ไลน์, mat) ของ mat ที่ขอมาอยู่แล้ว
     ⇒ ได้ฟรีจากข้อมูลบนสายเดิม **ไม่ต้องยิงคิวรีเพิ่ม** (กฎเหล็ก DB ข้อ 11: egress คิดเป็นไบต์)
     เก็บที่ขยับล่าสุดสุดต่อ mat · ตัวเทียบว่า "ที่อื่น" ทำใน `minAlerts` (ของกลางที่เดียว) */
  const byMat = new Map();
  (moves.data || []).forEach(m => {
    if (!m?.line_name || !m?.mat_no) return;
    const cur = byMat.get(m.mat_no);
    if (!cur || String(m.last_at || '') > String(cur.lastAt || '')) {
      byMat.set(m.mat_no, { line_name: m.line_name, lastAt: m.last_at, moves: m.moves });
    }
  });
  const rows = minAlerts(
    withName,
    (ln, mat) => { const v = onHand.get(`${ln}\u0001${mat}`); return v === undefined ? null : v; },
    (mat) => ownerOf.get(mat) || null,
    {
      lastMoveOf: (ln, mat) => lastMove.get(`${ln}\u0001${mat}`) || null,
      movesElsewhereOf: (ln, mat) => byMat.get(mat) || null,
      now: new Date().toISOString(),
    },
  );
  return { rows, summary: minAlertSummary(rows), error: null };
}

/** เฉพาะของที่ "ไลน์นี้เป็นเจ้าของงาน" — ใช้ที่จอผลิต (ไลน์เห็นของตัวเอง)
 *  🔴 กรองด้วย `ownerLine` ไม่ใช่ `line_name` — ของอาจกองที่คลัง แต่คนที่ต้องเตรียมคือไลน์ที่ผลิต */
export const minAlertsForLine = (rows = [], lineName) =>
  (rows || []).filter(r => r?.state === 'at_min' && r.ownerLine && String(r.ownerLine) === String(lineName));
