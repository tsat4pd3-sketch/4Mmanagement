/* ═══ 📍 "ไลน์ไหนยังไม่ตั้งจุดเรียกเติม" — ครอบคลุมทั้งโรงงานในที่เดียว (2026-10-20) ══════════

   ทำไมต้องมี (วัดจริง 20/10 · ตรวจลูป `docs/modules/store-board-workflow.md`):
   ใบที่ "ไลน์เรียกของจาก Store" ทั้งชีวิตระบบมี **4 ใบ** ส่วน 107 ใบที่เหลือสโตร์สร้างเองจาก forecast
   ต้นเหตุไม่ใช่กลไก (4 ใบนั้นจบลูปครบทุกใบ และ `min_at_req` มีค่า = ระบบเป็นคนเสนอ) แต่เป็น
   **`line_part_levels` 61 แถวเกือบทั้งหมดเป็นพาร์ทที่ไลน์ "ผลิตเอง"** (= ผลิตเติม ไม่ใช่เบิก)
   ⇒ พาร์ทที่ต้องเบิกจากสโตร์แทบไม่มีใครเฝ้า ⇒ ขั้น 3 ของลูป (ถึง min แล้วเสนอให้เบิก) ไม่มีวันยิง
   และเดิม**เห็นได้ทีละไลน์เท่านั้น** (แผงใน `/layout-setup`) — ไม่มีจอไหนตอบว่า "ทั้งโรงงานขาดกี่จุด"

   กติกาของไฟล์นี้ (pure · เทส `__tests__/partLevelCoverage.test.mjs`):
   · ตัวตั้ง = **ทุกแถวใน `line_stock_summary`** ไม่ใช่เฉพาะที่ยอด > 0 — แถวยอด 0 คือ
     "พาร์ทนี้เคยเดินผ่านไลน์นี้แล้วของหมด" ซึ่งเป็นตัวที่ *ต้องมี* จุดเรียกเติมที่สุด (วัด 20/10: 253 แถวยอด 0)
   · แยก "ของที่ไลน์ใช้" (`consume` = ต้องเบิกจากสโตร์ ⇒ ต้องตั้ง `line_part_levels`) ออกจาก
     "ของที่ไลน์ผลิตเอง" (`produce` = ผลิตเติม · min/max อยู่ที่ `kanban_standards`)
     ด้วย **`refStockOf()` ของ `partRefStock.js` ตัวเดียวกับแผงจุดเรียกเติม** — ห้ามตัดสินใหม่ที่นี่
     (ตัดสินคนละแบบ = จอนี้บอกว่าขาด แต่แผงของไลน์ไม่เสนอ = คนเลิกเชื่อทั้งคู่)
   · 🔴 **คลัง (STORE / FG WAREHOUSE / ปลายทางที่ไม่ใช่ไลน์ผลิต) ไม่ใช่งานของจุดเรียกเติม**
     ⇒ กันออกจากตัวนับ **แต่ต้องคืนจำนวนที่กันออก** (`skipped`) ให้จอเขียนบอก ห้ามหายเงียบ
   · 🔴 **อ่านทะเบียนไลน์ไม่ได้ = ไม่รู้ว่าอะไรคือไลน์ ⇒ ไม่ตัดสินแทน** — ส่ง `lines` ว่าง/undefined
     คืน `linesUnknown: true` + ไม่กันอะไรออกเลย (fail-open ฝั่ง "แสดง" · fail-closed ฝั่ง "สรุปว่าครบ")
   · "เฝ้าอยู่" = มีแถว `line_part_levels` ที่ active **และมี `min_qty`** — ตั้งแถวไว้แต่ไม่ใส่ min
     = ระบบไม่เตือนอะไรเลย (`suggest` ข้ามแถวที่ min เป็น null) ⇒ นับเป็น "ยังไม่เฝ้า" + ธง `hasRowNoMin`
   ═══════════════════════════════════════════════════════════════════════════════ */

import { refStockOf } from './partRefStock.js';   // .js เพื่อให้ node:test resolve ได้ (bundler ไม่สน)

const key = (s) => String(s ?? '').trim();
const lineKey = (s) => key(s).replace(/\s+/g, ' ').toLowerCase();
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/**
 * @param {object} a
 * @param {Array}  a.stock     แถว `line_stock_summary` (line_name, mat_no, part_name, qty_on_hand)
 * @param {Array}  a.levels    แถว `line_part_levels` (line_name, mat_no, min_qty, max_qty, is_active)
 * @param {Array}  a.products  `dr_products` ผ่าน `loadProductsMaster()`
 * @param {Array}  a.rules     `stock_inflow_rules` (ต้อง select `mode` มาด้วย)
 * @param {Array}  a.lines     ทะเบียนไลน์ (`useProductionLines`) — ว่าง = ไม่รู้ ⇒ ไม่กันคลังออก
 * @param {Array|Set} a.lotMats MAT ที่สโตร์คุมเป็นล็อต — **`lotMatsOf(rules)`** (`utils/stockReceipts.js`)
 *                             ห้ามส่งชุดที่มาจาก `child_lot_requests` (ด่าน `lot-mats-from-rules`)
 * @returns {{ rows:Array, totals:object, linesUnknown:boolean }}
 */
export function partLevelCoverage({ stock = [], levels = [], products = [], rules = [], lines = [], lotMats = [] } = {}) {
  const lineSet = new Set((lines || []).map(l => lineKey(l?.name)).filter(Boolean));
  const linesUnknown = lineSet.size === 0;

  /* จุดเรียกเติมที่ตั้งไว้ — แยก "มี min" ออกจาก "มีแถวแต่ไม่ใส่ min" (คนละความหมาย) */
  const lvWithMin = new Set();
  const lvNoMin = new Set();
  for (const l of levels || []) {
    if (!l || l.is_active === false) continue;
    const k = `${lineKey(l.line_name)}\u0001${key(l.mat_no)}`;
    if (!key(l.mat_no)) continue;
    if (l.min_qty == null) lvNoMin.add(k); else lvWithMin.add(k);
  }

  const byLine = new Map();
  const seen = new Set();
  let skipped = 0;

  for (const s of stock || []) {
    const mat = key(s?.mat_no);
    const ln = key(s?.line_name);
    if (!mat || !ln) continue;
    const lk = lineKey(ln);
    const pairKey = `${lk}\u0001${mat}`;
    if (seen.has(pairKey)) continue;        // สรุปยอดควร unique อยู่แล้ว — กันไว้ไม่ให้นับซ้ำ
    seen.add(pairKey);

    // คลัง/ปลายทางที่ไม่ใช่ไลน์ผลิต = ไม่ใช่งานของจุดเรียกเติม (แต่ต้องนับว่ากันออกกี่รายการ)
    if (!linesUnknown && !lineSet.has(lk)) { skipped += 1; continue; }

    const { kind } = refStockOf(mat, { lineName: ln, products, rules, lotMats });
    const watched = lvWithMin.has(pairKey);
    const rowNoMin = !watched && lvNoMin.has(pairKey);

    if (!byLine.has(lk)) byLine.set(lk, { line_name: ln, consume: 0, produce: 0, watched: 0, unwatched: 0, rowNoMin: 0, parts: [] });
    const g = byLine.get(lk);
    if (kind === 'produce') { g.produce += 1; continue; }   // ผลิตเติม — min/max อยู่ที่ kanban_standards
    g.consume += 1;
    if (watched) g.watched += 1; else g.unwatched += 1;
    if (rowNoMin) g.rowNoMin += 1;
    g.parts.push({ mat_no: mat, part_name: key(s?.part_name) || '', qty: num(s?.qty_on_hand), watched, hasRowNoMin: rowNoMin });
  }

  /* เรียง: ไลน์ที่ขาดมากสุดขึ้นก่อน · ที่ครบแล้วไปท้าย (ไม่ตัดออก — ต้องเห็นว่าใครทำครบ) */
  const rows = [...byLine.values()].map(g => ({
    ...g,
    pct: g.consume > 0 ? Math.round((g.watched / g.consume) * 100) : null,
    parts: g.parts.sort((a, b) => Number(a.watched) - Number(b.watched) || b.qty - a.qty || a.mat_no.localeCompare(b.mat_no)),
  })).sort((a, b) => b.unwatched - a.unwatched || b.consume - a.consume || a.line_name.localeCompare(b.line_name, 'th'));

  const totals = rows.reduce((t, g) => ({
    lines: t.lines + 1,
    linesWithGap: t.linesWithGap + (g.unwatched > 0 ? 1 : 0),
    linesDone: t.linesDone + (g.consume > 0 && g.unwatched === 0 ? 1 : 0),
    consume: t.consume + g.consume,
    watched: t.watched + g.watched,
    unwatched: t.unwatched + g.unwatched,
    produce: t.produce + g.produce,
    rowNoMin: t.rowNoMin + g.rowNoMin,
  }), { lines: 0, linesWithGap: 0, linesDone: 0, consume: 0, watched: 0, unwatched: 0, produce: 0, rowNoMin: 0 });

  return { rows, totals: { ...totals, skipped }, linesUnknown };
}

export default partLevelCoverage;
