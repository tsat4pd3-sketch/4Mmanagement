/* ══ 🏬 storeStockSheet — ไฟล์ทะเบียนพาร์ทของสโตร์ (Stock_Store.xlsm) → บอร์ดสโตร์ + MAX/MIN (2026-11-23 · คำสั่ง user)

   user: *"สโตร์อยากอัพโหลดไฟล์แบบนี้เข้าระบบ ได้เหมือน พวก 862 830"* = เลือกไฟล์ → ดูก่อน → กดยืนยัน
   ไฟล์: 1 ชีท = 1 รหัสพื้นที่ SAP (R401 · R402 · S401…S408) · หัวตาราง `Item | Mat'l SAP | Part Name | Picture | STD/PC | MAX | MIN`

   กติกา (user เคาะ 23/11):
   1. **ไฟล์ = รายชื่อปัจจุบันของบอร์ด** — พาร์ทบนบอร์ดที่ไม่อยู่ในไฟล์ ⇒ ถอดออก (`is_active=false` · ไม่ลบแถว/ช่องที่กรอกไว้)
   2. **MAX/MIN จากไฟล์ทับค่าใน `kanban_standards`** (สโตร์เป็นเจ้าของค่า) — ต้องโชว์ เดิม→ใหม่ ก่อนยืนยัน
      🔴 **MAT ที่ยังไม่มีแถวใน `kanban_standards` = ไม่สร้างใหม่** (สร้าง = ได้ qty_per_kanban default 1
         ⇒ ตารางคัมบัง/Kanban NET ขึ้นตัวเลขเพี้ยนทันที) · ขึ้นจอว่า "ยังไม่มีทะเบียนคัมบัง ไม่ได้บันทึก"
      🔴 **MAX < MIN = ไม่บันทึกคู่นั้น** + ขึ้นเตือน (ห้ามสลับให้เอง = เดาแทนคน)
      · ช่องว่าง = ไม่แตะค่าเดิม (ไฟล์ว่าง ≠ สั่งลบ)
   3. **ที่จัดเก็บหลัก (`parts_master.home_sloc`) เติมเฉพาะที่ยังว่าง** · ตั้งไว้คนละที่ = โชว์ ไม่ทับ (กฎเดิม 16/11)
   4. STD/PC ที่ไม่ใช่ตัวเลข (เช่น `Kg` ของเหล็ก coil) = packing `null` ไม่เดาตัวเลข
   ⚠️ ไฟล์นี้ไม่ยิง DB — ผู้เรียกโหลดสถานะปัจจุบันมาให้ แล้วเอาแผนไปเขียนเอง (`components/StoreStockUpload.jsx`)
   ══════════════════════════════════════════════════════════════════════════════════════════════ */
import { partRowKey } from './monitorBoards.js';

const norm = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const num = (v) => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
};
export const boardKeyOfSloc = (sloc) => `store-${String(sloc || '').trim().toLowerCase()}`;

/** หาแถวหัวตาราง (ภายใน 6 แถวแรก) — คืน index คอลัมน์ หรือ null ถ้าไม่ใช่ชีทแบบนี้ */
export function storeSheetHeader(rows = []) {
  for (let r = 0; r < Math.min(6, rows.length); r++) {
    const cells = (rows[r] || []).map(c => norm(c).toLowerCase());
    const mat = cells.findIndex(c => /mat'?l\s*sap|^mat\s*sap$/.test(c));
    const max = cells.findIndex(c => c === 'max');
    const min = cells.findIndex(c => c === 'min');
    if (mat >= 0 && max >= 0 && min >= 0) {
      return {
        row: r, mat, max, min,
        name: cells.findIndex(c => c === 'part name'),
        std: cells.findIndex(c => /^std\s*\/?\s*pc/.test(c)),
        item: cells.findIndex(c => c === 'item'),
      };
    }
  }
  return null;
}

/** แกะชีทเดียว → { sloc, parts, why } · ไม่ใช่ชีทแบบนี้ = parts ว่าง + why */
export function parseStoreStockSheet(name, rows = []) {
  const sloc = norm(name).toUpperCase();
  const h = storeSheetHeader(rows);
  if (!h) return { sloc, parts: [], why: 'ไม่เจอหัวตาราง Mat\'l SAP / MAX / MIN' };
  const parts = [];
  const seen = new Set();
  const dupMats = [];
  for (let r = h.row + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const mat = norm(row[h.mat]);
    if (!mat) continue;
    if (seen.has(mat)) { dupMats.push(mat); continue; }   // MAT ซ้ำในชีทเดียว = ใช้แถวแรก + เตือน
    seen.add(mat);
    const stdRaw = h.std >= 0 ? row[h.std] : null;
    const std = num(stdRaw);
    parts.push({
      mat,
      name: h.name >= 0 ? (norm(row[h.name]) || null) : null,
      std: std != null && std > 0 ? std : null,
      unit: std == null && norm(stdRaw) ? norm(stdRaw) : null,   // เช่น 'Kg'
      max: num(row[h.max]),
      min: num(row[h.min]),
      order: parts.length,
    });
  }
  return { sloc, parts, dupMats, why: parts.length ? null : 'ชีทไม่มีรายการพาร์ท' };
}

/**
 * แผนนำเข้า — ยังไม่เขียนอะไร
 * @param {Array} sheets  [{ name, rows }]
 * @param {object} cur
 *   boards:   [{ id, board_key }]
 *   parts:    [{ id, board_id, mat_no, part_no, row_key, part_name, packing, sort_order, is_active }]
 *   ks:       [{ mat_no, min_qty, max_qty }]   (is_active เท่านั้น)
 *   home:     Map(mat → home_sloc | null)       (มีแถวใน parts_master เท่านั้น)
 */
export function buildStoreStockPlan(sheets = [], cur = {}) {
  const boardByKey = new Map((cur.boards || []).map(b => [b.board_key, b]));
  const partsByBoard = new Map();
  for (const p of cur.parts || []) {
    if (!partsByBoard.has(p.board_id)) partsByBoard.set(p.board_id, []);
    partsByBoard.get(p.board_id).push(p);
  }
  const ksByMat = new Map((cur.ks || []).map(k => [norm(k.mat_no), k]));
  const home = cur.home instanceof Map ? cur.home : new Map();
  const out = { sheets: [], skipped: [], minmax: [], minmaxNoKs: [], minmaxBad: [], homeFill: [], homeConflict: [], homeNoPm: [], dupAcross: [] };
  const matSheet = new Map();

  for (const { name, rows } of sheets) {
    const p = parseStoreStockSheet(name, rows);
    if (!p.parts.length) { out.skipped.push({ name, why: p.why }); continue; }
    const board = boardByKey.get(boardKeyOfSloc(p.sloc));
    if (!board) { out.skipped.push({ name, why: `ยังไม่มีบอร์ดสโตร์ ${p.sloc} ในระบบ` }); continue; }
    const existing = partsByBoard.get(board.id) || [];
    const exByKey = new Map(existing.map(e => [e.row_key || partRowKey(e.mat_no, e.part_no), e]));
    const fileKeys = new Set();
    const add = [], update = [], same = [];
    const upserts = p.parts.map(fp => {
      const key = partRowKey(fp.mat, null);
      fileKeys.add(key);
      const ex = exByKey.get(key);
      const row = { board_id: board.id, mat_no: fp.mat, part_no: null, row_key: key, part_name: fp.name, packing: fp.std, sort_order: fp.order, is_active: true };
      if (!ex || ex.is_active === false) add.push(fp);
      else if (norm(ex.part_name) !== norm(fp.name) || (ex.packing ?? null) !== fp.std || (ex.sort_order ?? null) !== fp.order) update.push(fp);
      else same.push(fp);
      return row;
    });
    /* ถอดออก = แถวที่ยังเปิดอยู่บนบอร์ดนี้แต่ไม่อยู่ในไฟล์ (รวมแถวที่มีเลขพาร์ท — ไฟล์สโตร์ไม่มีคอลัมน์เลขพาร์ท) */
    const remove = existing.filter(e => e.is_active !== false && !fileKeys.has(e.row_key || partRowKey(e.mat_no, e.part_no)));
    out.sheets.push({ name, sloc: p.sloc, boardId: board.id, upserts, add, update, same, remove, dupMats: p.dupMats || [] });

    for (const fp of p.parts) {
      if (matSheet.has(fp.mat) && matSheet.get(fp.mat) !== p.sloc) out.dupAcross.push({ mat: fp.mat, sheets: [matSheet.get(fp.mat), p.sloc] });
      else matSheet.set(fp.mat, p.sloc);

      if (fp.min != null || fp.max != null) {
        if (fp.min != null && fp.max != null && fp.max < fp.min) out.minmaxBad.push({ sloc: p.sloc, mat: fp.mat, name: fp.name, min: fp.min, max: fp.max });
        else {
          const k = ksByMat.get(fp.mat);
          if (!k) out.minmaxNoKs.push({ sloc: p.sloc, mat: fp.mat, name: fp.name, min: fp.min, max: fp.max });
          else {
            /* ช่องว่างในไฟล์ = ไม่แตะค่าเดิม */
            const toMin = fp.min != null ? fp.min : (k.min_qty ?? null);
            const toMax = fp.max != null ? fp.max : (k.max_qty ?? null);
            if (num(k.min_qty) !== toMin || num(k.max_qty) !== toMax) {
              out.minmax.push({ sloc: p.sloc, mat: fp.mat, name: fp.name, fromMin: num(k.min_qty), fromMax: num(k.max_qty), min: toMin, max: toMax });
            }
          }
        }
      }
      if (!home.has(fp.mat)) out.homeNoPm.push({ sloc: p.sloc, mat: fp.mat });
      else {
        const h = norm(home.get(fp.mat)).toUpperCase();
        if (!h) out.homeFill.push({ sloc: p.sloc, mat: fp.mat });
        else if (h !== p.sloc) out.homeConflict.push({ sloc: p.sloc, mat: fp.mat, now: h });
      }
    }
  }
  out.totals = {
    sheets: out.sheets.length,
    parts: out.sheets.reduce((a, s) => a + s.upserts.length, 0),
    add: out.sheets.reduce((a, s) => a + s.add.length, 0),
    update: out.sheets.reduce((a, s) => a + s.update.length, 0),
    remove: out.sheets.reduce((a, s) => a + s.remove.length, 0),
  };
  return out;
}
