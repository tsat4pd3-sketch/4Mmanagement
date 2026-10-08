import { addDays } from './planHorizon.js';

/* ══ 📉 monitorGrid — เครื่องคิดเลขของบอร์ด Monitoring (พาร์ท × ช่วงเวลา × แถว) ════════════
   ที่มา: ไฟล์ `1.Monitoring-<เดือน>.xlsx` ที่ทีมวางแผนทำมือทุกวัน (user ส่งมา 2026-10-01
   พร้อมคำสั่ง "เอาทุกชีททุกหน้าเลย ให้โปรแกรมทำได้แบบนั้น")

   13 ชีทในไฟล์นั้น **รูปร่างเดียวกันหมด** — ต่างกันแค่ "ชุดแถว" กับ "หน่วยของคอลัมน์":

     ชีท                     คอลัมน์      ชุดแถว
     110T/300T/250T          วัน          PLAN · IN · UNBOUND · OUT · BALANCE · WIP · MIN
     800T/600T               วัน          PLAN · IN · UNBOUND · OUT · BALANCE · MIN   (ไม่มี WIP)
     Argen                   สัปดาห์      ORDER · PROD.DATE · PLAN · UNBOUND · IN · STOCK · SEND · BALANCE
     TSPK/TSESA+LA           วันที่ส่ง    ORDER · BALANCE (หักสะสมจาก FG)
     mat (R402)              —            คงเหลือ(กก.) → ชิ้น · งานท้ายไลน์ → เหล็กที่ต้องใช้
     RA/824-825              วัน          ส่งชุบ · รับคืน · สต๊อกที่ร้าน · Diff FC

   ⇒ **ห้าม hardcode ชุดแถวต่อชีท** (ENGINEERING-PRINCIPLES: data-driven ก่อน hardcode)
     ชุดแถวมาจาก `monitor_boards.rows` ในฐานข้อมูล · ไฟล์นี้รู้แค่ "สูตรชื่ออะไรทำอะไร"
     เพิ่มชีท/ไลน์ใหม่ = เพิ่มแถวใน DB ไม่ต้องแก้โค้ด

   🔴 กฎเหล็กของไฟล์นี้ — เลขทุกตัวบนบอร์ดต้องออกจาก `buildGrid()` ที่เดียว
     ห้ามหน้าไหนบวก prev + in - out เองอีก (มีด่าน `monitor-grid-math-via-helper`)
     เหตุผล: สูตรพวกนี้เป็น **recurrence** (ค่าวันนี้กินค่าเมื่อวาน) ก๊อปไปไว้ในหน้า =
     หน้าไหนลืมบวกตัวเดียว ตัวเลขเพี้ยนทั้งแถวแบบไม่มีใครเห็น

   🔴 "ว่าง" กับ "ไม่รู้" ไม่ใช่ตัวเดียวกัน (กฎความซื่อสัตย์ของจอ)
     • ช่องกลางแถวที่ว่าง = วันนั้นไม่มีของเข้า/ออกจริง ⇒ นับเป็น 0 (Excel ก็คิดแบบนี้)
     • **ช่องตั้งต้น (คอลัมน์แรก) ที่ว่าง = ยังไม่รู้ยอดยกมา ⇒ ทั้งแถวเป็น `null`**
       ห้ามเดา 0 เพราะ "สต๊อกยกมา 0" กับ "ไม่รู้ว่ายกมาเท่าไหร่" ตัดสินใจคนละแบบสิ้นเชิง
       จอต้องเขียนว่าพาร์ทไหนยังไม่ใส่ยอดยกมา (`seedMissing` ใน gridSummary)
   ════════════════════════════════════════════════════════════════════════════════════════ */

const num = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
/** ว่าง = 0 สำหรับ "การไหล" ของวันนั้น (ของเข้า/ของออก) */
const flow = (v) => num(v) ?? 0;

/* ── ชนิดแถว ───────────────────────────────────────────────────────────────────────
   input  : คนกรอก (เก็บใน monitor_cells)
   system : ระบบรู้เอง (ใบผลิต/สต๊อก) — **คนทับได้ และค่าที่คนกรอกชนะเสมอ**
            (หน้างานเห็นของจริงที่ระบบยังไม่รู้ ห้ามให้ระบบลบของที่คนยืนยัน)
   recur  : คำนวณจากคอลัมน์ก่อนหน้า + แถวอื่นในคอลัมน์เดียวกัน
   const  : ค่าเดียวไหลไปขวาทั้งแถว (MIN/MAX)
   date   : ช่องวันที่ (PROD. DATE ของ Argen) ไม่ใช่จำนวน                            */
export const ROW_KIND = ['input', 'system', 'recur', 'const', 'date'];

/* ── สูตร recurrence (ถอดจากสูตรจริงในไฟล์ Excel ของทีมวางแผน) ─────────────────────
   ทุกตัวรับ (prev, cur) → คืนค่า หรือ null ถ้าคิดไม่ได้
     prev = ค่าแถวเดียวกันของคอลัมน์ก่อนหน้า
     cur  = { <rowKey>: number|null } ของคอลัมน์ปัจจุบัน (แถวที่คิดเสร็จแล้ว)                */
export const RECUR = {
  /* UNBOUND[d] = UNBOUND[d-1] − PLAN[d] + IN[d]
     = แผนค้างสะสม — ผลิตตามแผนพอดี ค่านี้นิ่ง · ผลิตได้น้อยกว่าแผน ค่าติดลบลงเรื่อยๆ
     Excel: `=P5-Q3+Q4` (800T r5) · `=+Q5-R3+R4` (110T r5) — ตัวเดียวกัน */
  plan_backlog: {
    label: 'แผนค้างสะสม',
    needs: ['plan', 'in'],
    calc: (prev, cur) => (prev === null ? null : prev - flow(cur.plan) + flow(cur.in)),
  },
  /* BALANCE[d] = BALANCE[d-1] + IN[d] − OUT[d]  — สต๊อกเดิน
     Excel: `=P7+Q4-Q6` (800T r7) */
  stock_run: {
    label: 'สต๊อกเดิน',
    needs: ['in', 'out'],
    calc: (prev, cur) => (prev === null ? null : prev + flow(cur.in) - flow(cur.out)),
  },
  /* MIN[d] = MIN[d-1]  — Excel: `=P8` ไหลไปขวาเฉยๆ */
  carry: {
    label: 'ค่าเดิมไหลไปขวา',
    needs: [],
    calc: (prev) => prev,
  },
  /* balance[d] = balance[d-1] − ORDER[d]  — TSPK/TSESA: FG ตั้งต้นแล้วหักออเดอร์สะสม
     Excel: `=L3-M3-N3-P3-R3` (ยืดไปเรื่อยๆ ตามจำนวนวันส่ง) = หักสะสมแบบเดียวกัน */
  deplete: {
    label: 'หักออเดอร์สะสม',
    needs: ['order'],
    calc: (prev, cur) => (prev === null ? null : prev - flow(cur.order)),
  },
  /* BALANCE[d] = BALANCE[d-1] + IN[d] − SEND[d]  — Argen: รับเข้า W/H แล้วส่งเกรท */
  stock_send: {
    label: 'สต๊อกเดิน (ส่งลูกค้า)',
    needs: ['in', 'send'],
    calc: (prev, cur) => (prev === null ? null : prev + flow(cur.in) - flow(cur.send)),
  },
  /* BALANCE[d] = BALANCE[d-1] + IN[d] − ORDER[d]  — บอร์ด FG ต่อลูกค้า (06/10)
     🔴 หักด้วย "ยอดที่ลูกค้าสั่ง" ไม่ใช่ "ยอดที่ส่งจริง" เพราะบอร์ดนี้ตอบคำถาม**ล่วงหน้า**
        ว่า "ของจะพอส่งไหม" — ของที่ส่งไปแล้วตอบได้แค่อดีต (หลักเดียวกับ `deplete` ของบอร์ดแร็ค) */
  fg_run: {
    label: 'สต๊อก FG เดิน',
    needs: ['in', 'order'],
    calc: (prev, cur) => (prev === null ? null : prev + flow(cur.in) - flow(cur.order)),
  },
  /* stock ที่ร้านชุบ = เมื่อวาน + ส่งไป − รับคืน (RA/824-825) */
  vendor_wip: {
    label: 'ค้างที่ร้าน',
    needs: ['to_vendor', 'from_vendor'],
    calc: (prev, cur) => (prev === null ? null : prev + flow(cur.to_vendor) - flow(cur.from_vendor)),
  },
};

/** สูตรที่ไม่รู้จัก = ไม่เดา (คืน null ทั้งแถว) แล้วจอเขียนบอก — ห้ามตกเงียบเป็น 0 */
export function recurDef(name) {
  return RECUR[name] || null;
}

/* ── ช่วงเวลา (คอลัมน์) ─────────────────────────────────────────────────────────────── */

/** คอลัมน์รายวันติดกัน n วัน (ชีทไลน์ปั๊มนับทุกวันปฏิทิน เสาร์-อาทิตย์ก็มีคอลัมน์) */
export function buildDayPeriods(startDate, n) {
  const out = [];
  if (!startDate || !(n > 0)) return out;
  for (let i = 0; i < n; i++) out.push({ key: addDays(startDate, i), date: addDays(startDate, i), kind: 'day' });
  return out;
}

/** คอลัมน์รายสัปดาห์ (Argen — ยอดลูกค้ามาเป็นสัปดาห์ ไม่ใช่รายวัน) */
export function buildWeekPeriods(startDate, n) {
  const out = [];
  if (!startDate || !(n > 0)) return out;
  for (let i = 0; i < n; i++) {
    const d = addDays(startDate, i * 7);
    out.push({ key: d, date: d, kind: 'week' });
  }
  return out;
}

/** คอลัมน์ตามวันที่ที่ระบุเอง (TSPK/TSESA — คอลัมน์คือ "วันที่ลูกค้าสั่งรับ" ไม่เรียงติดกัน) */
export function buildDatePeriods(dates) {
  return (Array.isArray(dates) ? dates : [])
    .map((d) => String(d || '').slice(0, 10))
    .filter(Boolean)
    .sort()
    .map((d) => ({ key: d, date: d, kind: 'date' }));
}

/* ── ตัวสร้างกริด ──────────────────────────────────────────────────────────────────── */

/**
 * คิดทุกช่องของบอร์ด
 * @param {object}   a
 * @param {Array}    a.parts    [{ id, mat_no, ... }]
 * @param {Array}    a.periods  จาก buildDayPeriods/buildWeekPeriods/buildDatePeriods
 * @param {Array}    a.rows     [{ key, label, kind, recur?, editable? }] — มาจาก monitor_boards.rows
 * @param {Function} a.manual   (partId, rowKey, periodKey) → ค่าที่คนกรอก (undefined = ไม่กรอก)
 * @param {Function} [a.system] (partId, rowKey, periodKey) → ค่าที่ระบบรู้ (undefined = ระบบไม่รู้)
 * @returns {{ cells: Map, rows: Array, periods: Array, seedKey: string|null }}
 *   cells: key `${partId}|${rowKey}|${periodKey}` → { v, src, editable }
 *          src = 'input' | 'system' | 'recur' | 'const' | 'date' | 'unknown'
 */
export function buildGrid({ parts = [], periods = [], rows = [], manual, system }) {
  const cells = new Map();
  const get = (fn, pid, rk, pk) => {
    if (typeof fn !== 'function') return undefined;
    const v = fn(pid, rk, pk);
    return v === undefined ? undefined : v;
  };
  const seedKey = periods.length ? periods[0].key : null;
  const put = (pid, rk, pk, v, src, editable) => {
    cells.set(`${pid}|${rk}|${pk}`, { v, src, editable: !!editable });
  };

  for (const part of parts) {
    const pid = part?.id;
    if (pid === undefined || pid === null) continue;
    /* ค่าแถวของคอลัมน์ก่อนหน้า — ใช้ป้อน recurrence */
    let prevRow = {};

    for (let pi = 0; pi < periods.length; pi++) {
      const pk = periods[pi].key;
      const cur = {};

      /* รอบที่ 1 — แถวที่ไม่ใช่ recur (คนกรอก / ระบบ / คงที่ / วันที่) */
      for (const row of rows) {
        if (row.kind === 'recur') continue;
        const mv = get(manual, pid, row.key, pk);
        if (row.kind === 'date') {
          const v = mv === undefined ? null : mv;
          cur[row.key] = null;
          put(pid, row.key, pk, v, 'date', true);
          continue;
        }
        if (row.kind === 'const') {
          /* ค่าคงที่: กรอกช่องไหนก็ได้ ค่าที่กรอกล่าสุด (นับจากซ้าย) ไหลต่อไปขวา */
          const v = mv !== undefined ? num(mv) : (prevRow[row.key] ?? null);
          cur[row.key] = v;
          put(pid, row.key, pk, v, v === null ? 'unknown' : 'const', true);
          continue;
        }
        /* input / system — ค่าที่คนกรอกชนะค่าที่ระบบรู้เสมอ */
        if (mv !== undefined && String(mv) !== '') {
          const v = num(mv);
          cur[row.key] = v;
          put(pid, row.key, pk, v, 'input', true);
          continue;
        }
        if (row.kind === 'system') {
          const sv = get(system, pid, row.key, pk);
          const v = sv === undefined ? null : num(sv);
          cur[row.key] = v;
          put(pid, row.key, pk, v, v === null ? 'unknown' : 'system', true);
          continue;
        }
        cur[row.key] = null;
        put(pid, row.key, pk, null, 'unknown', true);
      }

      /* รอบที่ 2 — แถว recur (ต้องรู้ค่าแถวอื่นในคอลัมน์นี้ก่อน) */
      for (const row of rows) {
        if (row.kind !== 'recur') continue;
        /* คอลัมน์แรก = "ยอดยกมา" ที่คนต้องใส่ — ไม่ใส่ = ไม่รู้ ⇒ null ทั้งแถว (ห้ามเดา 0) */
        if (pk === seedKey) {
          const mv = get(manual, pid, row.key, pk);
          let v = mv !== undefined && String(mv) !== '' ? num(mv) : null;
          if (v === null && typeof system === 'function') {
            const sv = get(system, pid, row.key, pk);
            if (sv !== undefined) v = num(sv);
          }
          cur[row.key] = v;
          put(pid, row.key, pk, v, v === null ? 'unknown' : 'input', true);
          continue;
        }
        const def = recurDef(row.recur);
        const v = def ? def.calc(prevRow[row.key] ?? null, cur) : null;
        cur[row.key] = v === undefined ? null : v;
        put(pid, row.key, pk, cur[row.key], cur[row.key] === null ? 'unknown' : 'recur', false);
      }

      prevRow = cur;
    }
  }

  return { cells, rows, periods, seedKey };
}

/** อ่านค่าออกจากกริด — คืน null เมื่อไม่มี/คิดไม่ได้ (ห้ามคืน 0) */
export function cellAt(grid, partId, rowKey, periodKey) {
  return grid?.cells?.get(`${partId}|${rowKey}|${periodKey}`) || null;
}
export function valueAt(grid, partId, rowKey, periodKey) {
  const c = cellAt(grid, partId, rowKey, periodKey);
  return c ? c.v : null;
}

/* ── สรุปหัวตาราง (FC / Total SL / Diff FC / %SL) ───────────────────────────────────
   🔴🔴 ไฟล์จริงของทีมวางแผน **คิด Total SL ไม่เหมือนกันระหว่างชีท** (ถอดจากสูตร 01/10):
     800T r3  `=SUM(Q6:AU6)`      → Σ แถว **OUT**  (ของที่ส่งออกไปจริง)
     110T r3  `=SUM(R4:AV4)+Q7`   → Σ แถว **IN** + BALANCE ยอดยกมา  (ของที่ "มีให้ส่ง")
   ⇒ 2 ชีทตอบคนละคำถามใต้ชื่อคอลัมน์เดียวกัน · %SL ของ 2 ไลน์จึงเทียบกันตรงๆ ไม่ได้
   **ไม่ยุบให้เหลือสูตรเดียวเอง** (จะเปลี่ยนตัวเลขที่ทีมใช้อยู่โดยไม่มีใครสั่ง) ⇒ ทำเป็น
   การตั้งค่าของบอร์ด `sl_row` + `sl_includes_seed` แล้ว**ให้จอเขียนว่าบอร์ดนี้นับจากแถวไหน**
   แล้วค่อยถามทีมวางแผนว่าจะรวมเป็นสูตรเดียวไหม (เป็นการตัดสินใจของเขา ไม่ใช่ของระบบ)

   ⚠️ ทั้ง 2 ชีท**ข้ามคอลัมน์แรก** (คอลัมน์ยอดยกมา) ในการ Σ — 800T เริ่ม Q (seed=P) ·
     110T เริ่ม R (seed=Q) ⇒ `skipSeed` ค่าเริ่มต้น true · ยอดยกมาเข้ามาทาง includeSeed เท่านั้น
   🔴 ไม่มี FC = `null` ห้ามคืน 0 และห้ามคืน %SL (หารศูนย์) — Excel ขึ้น #DIV/0! ให้เห็นอยู่แล้ว */
export function slSummary({
  grid, partId, fc,
  slRow = 'out', seedRow = 'balance', includeSeed = false, skipSeed = true,
}) {
  if (!grid) return { totalSl: null, diffFc: null, pctSl: null, slRow, includeSeed };
  let total = 0;
  let seen = 0;
  for (const p of grid.periods) {
    if (skipSeed && p.key === grid.seedKey) continue;
    const v = valueAt(grid, partId, slRow, p.key);
    if (v !== null) { total += v; seen++; }
  }
  let seedAdded = false;
  if (includeSeed && grid.seedKey) {
    const s = valueAt(grid, partId, seedRow, grid.seedKey);
    if (s !== null) { total += s; seedAdded = true; }
  }
  const totalSl = seen > 0 || seedAdded ? total : null;
  const f = num(fc);
  return {
    totalSl,
    diffFc: totalSl === null || f === null ? null : totalSl - f,
    pctSl: totalSl === null || f === null || f === 0 ? null : totalSl / f,
    slRow,
    includeSeed,
  };
}

/* ── ของขาด: BALANCE หลุด MIN ──────────────────────────────────────────────────────
   🔴 เทียบได้เฉพาะเมื่อ**รู้ทั้ง 2 ค่า** — ไม่รู้ MIN = ไม่เตือน (ห้ามเดา min ให้ —
   หลักเดียวกับ line_part_levels "ไม่ตั้ง = ไม่แจ้ง") */
export function minBreaches({ grid, parts = [], balanceRow = 'balance', minRow = 'min' }) {
  const out = [];
  if (!grid) return out;
  for (const part of parts) {
    for (const p of grid.periods) {
      const b = valueAt(grid, part.id, balanceRow, p.key);
      const m = valueAt(grid, part.id, minRow, p.key);
      if (b === null || m === null) continue;
      if (b < m) out.push({ partId: part.id, mat_no: part.mat_no, date: p.date, balance: b, min: m, short: m - b });
    }
  }
  return out;
}

/** วันแรกที่ของจะขาด (ต่อพาร์ท) — ตอบ "ต้องผลิตเพิ่มก่อนวันไหน" */
export function firstShortDate({ grid, partId, balanceRow = 'balance' }) {
  if (!grid) return null;
  for (const p of grid.periods) {
    const b = valueAt(grid, partId, balanceRow, p.key);
    if (b !== null && b < 0) return p.date;
  }
  return null;
}

/* ── สรุปความซื่อสัตย์ของบอร์ด ─────────────────────────────────────────────────────
   จอต้องเขียนบนจอว่า "คิดไม่ได้กี่พาร์ท เพราะอะไร" ห้ามโชว์ตารางเต็มเหมือนครบ */
export function gridSummary({ grid, parts = [], rows = [] }) {
  const recurRows = rows.filter((r) => r.kind === 'recur').map((r) => r.key);
  const seedMissing = [];
  let unknownCells = 0;
  let filledCells = 0;
  if (grid) {
    for (const part of parts) {
      const miss = recurRows.filter((rk) => valueAt(grid, part.id, rk, grid.seedKey) === null);
      if (miss.length) seedMissing.push({ partId: part.id, mat_no: part.mat_no, rows: miss });
      for (const r of rows) {
        for (const p of grid.periods) {
          const c = cellAt(grid, part.id, r.key, p.key);
          if (!c) continue;
          if (c.src === 'unknown') unknownCells++;
          else filledCells++;
        }
      }
    }
  }
  return {
    parts: parts.length,
    periods: grid?.periods?.length || 0,
    seedMissing,
    seedMissingCount: seedMissing.length,
    unknownCells,
    filledCells,
    partial: seedMissing.length > 0,
  };
}

/* ── mat (R402): วัตถุดิบม้วน ⇄ ชิ้น ──────────────────────────────────────────────────
   Excel: จำนวนชิ้น = คงเหลือ(กก.) / อัตรา(กก./ชิ้น)   [× ชิ้นต่อจังหวะ ถ้าปั๊มทีเดียวได้หลายชิ้น]
          คำนวณเหล็ก = งานท้ายไลน์(ชิ้น) × อัตรา       [÷ ชิ้นต่อจังหวะ]
   🔴 ตัว `× 2` / `÷ 2` ในไฟล์คนแก้มือรายแถว ("ได้ 2 ชิ้น" / "ได้ R/L") — ในระบบนี้คือ
     **งานคู่ gang die** ที่มีกฎเหล็กอยู่แล้ว (ชิ้น ≠ shot) ⇒ ใช้ `pieces` จากทะเบียน
     ห้ามให้คนพิมพ์ตัวคูณซ้ำในหน้านี้ จะได้ 2 แหล่งความจริงทันที
   🔴 อัตรา 0 / ไม่รู้ = null ห้ามหาร (Excel ขึ้น #VALUE! / 0 ให้เห็น) */
export function rawPieces({ onHandKg, kgPerPiece, pieces = 1 }) {
  const kg = num(onHandKg);
  const rate = num(kgPerPiece);
  const per = num(pieces) || 1;
  if (kg === null || rate === null || rate <= 0) return null;
  return (kg / rate) * per;
}
export function rawKgNeeded({ queuePieces, kgPerPiece, pieces = 1 }) {
  const q = num(queuePieces);
  const rate = num(kgPerPiece);
  const per = num(pieces) || 1;
  if (q === null || rate === null) return null;
  return (q * rate) / per;
}
/** เหล็กที่เหลือพอทำงานท้ายไลน์ไหม — null = ข้อมูลไม่พอ (ห้ามตอบ "พอ") */
export function rawCoverage({ onHandKg, queuePieces, kgPerPiece, pieces = 1 }) {
  const need = rawKgNeeded({ queuePieces, kgPerPiece, pieces });
  const kg = num(onHandKg);
  if (need === null || kg === null) return { need, onHand: kg, diff: null, enough: null };
  return { need, onHand: kg, diff: kg - need, enough: kg >= need };
}

/* ── TSPK/TSESA: จำนวนแร็คที่ของกินอยู่ ──────────────────────────────────────────────
   Excel `=L3/F3` = (Stock W/H + ผลิต/WIP) / Packing std · 🔴 packing 0 = null ห้ามหาร */
export function rackCount({ qty, packStd }) {
  const q = num(qty);
  const p = num(packStd);
  if (q === null || p === null || p <= 0) return null;
  return q / p;
}
