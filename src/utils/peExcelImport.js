/**
 * นำเข้า PFMEA / Process Flow / Control Plan จากไฟล์ Excel ฟอร์ม TSAT
 * ── pure ทั้งไฟล์ ไม่มี dependency กับ react/supabase/xlsx (เทสได้ตรงๆ)
 *
 * ⚠️ ตัวแกะผูกกับ "โครงฟอร์ม" ไม่ใช่ชื่อไฟล์/ชื่อชีท:
 *   FMEA — ข้อมูลเริ่มแถว 10 · คอลัมน์ B..S · แถวใหม่ = มี Severity (E) + Failure mode (C)
 *   CP   — ข้อมูลเริ่มแถว 12 · คอลัมน์ D..N · แถวใหม่ = Char No. (D) เป็นตัวเลขล้วน
 *   ทั้งคู่จบที่แถว footer ที่คอลัมน์ A มีเลขฟอร์ม (FM-PE1-018 / FM-PE1-019 …)
 *   คอลัมน์ A/B/C เป็น merged cell ครอบหลายแถว → ต้อง resolve ผ่าน colLabelMap
 *
 * ฟอร์มที่ layout ไม่ตรงจะได้ 0 แถว — **ต้องขึ้นเตือนบนจอ ห้าม import เงียบ**
 * (ตัวเรียกต้องให้คนดู preview ก่อนเขียนฐานเสมอ)
 *
 * รับข้อมูลดิบจาก SheetJS:
 *   rows   = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' })
 *   merges = ws['!merges'] || []        // [{ s:{r,c}, e:{r,c} }] 0-based
 */

/* ── helper พื้นฐาน ─────────────────────────────────────────── */

/**
 * worksheet ของ SheetJS → { rows, merges } ที่ index ตรงกับพิกัดจริงในชีท (แถว 0 = แถว 1)
 * รับ XLSX เข้ามาเป็นพารามิเตอร์ เพื่อให้ไฟล์นี้ไม่ต้อง import xlsx (คงความ pure + lazy chunk)
 *
 * ⚠️ ห้ามเรียก sheet_to_json ตรงๆ — มันคืนแถวเทียบกับ "ขอบเขตข้อมูล" (`!ref`)
 *    ชีทที่ข้อมูลไม่ได้เริ่มที่ A1 จะได้ index เลื่อน แต่ `!merges` เป็นพิกัดสัมบูรณ์เสมอ
 *    → สองอย่างเหลื่อมกัน ป้ายกำกับ (คอลัมน์ A/B/C) จะไปโผล่ผิดแถวแบบเงียบๆ
 */
export function sheetToGrid(XLSX, ws) {
  const ref = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  ref.s.r = 0; ref.s.c = 0;
  return {
    rows: XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', range: ref }),
    merges: ws['!merges'] || [],
  };
}

const pad2 = (n) => String(n).padStart(2, '0');

/** ค่าเซลล์ → ข้อความ trim แล้ว ('' = ว่าง) · Date → YYYY-MM-DD */
export const cv = (v) => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return `${v.getFullYear()}-${pad2(v.getMonth() + 1)}-${pad2(v.getDate())}`;
  const s = String(v).trim();
  return s === 'None' ? '' : s;
};

/** คะแนน S/O/D — รับเฉพาะ 1..10 นอกนั้น null (กันเลขอื่นในตารางหลุดมาเป็นคะแนน) */
export const num1to10 = (v) => {
  const n = parseFloat(String(v ?? '').trim());
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  return i >= 1 && i <= 10 ? i : null;
};

const isDateCell = (v) => v instanceof Date && !Number.isNaN(v.getTime());

/** เลข OP ตัวหน้าของข้อความ ('130.3 · PROGRESSIVE' → '130') */
export const baseOf = (s) => (String(s ?? '').trim().match(/^(\d+)/) || [])[1] || null;

/** ชื่อชีท '140 (1)' → '140-1' (ให้ชีทหน้าต่อของ OP เดียวกันยุบเข้าด้วยกันได้) */
export const normSheetKey = (s) => String(s ?? '').trim().replace(/\s*\((\d+)\)$/, '-$1');

/** ชีทช่วงรวม '240-280' (คุมหลาย OP) — '120-2' ไม่ใช่ (ห่างกันน้อยกว่า 20) */
export const rangedKey = (key) => {
  const m = String(key ?? '').match(/^(\d+)-(\d+)$/);
  if (!m) return null;
  const a = +m[1], b = +m[2];
  return b - a >= 20 ? [a, b] : null;
};

/** ชีทที่มีข้อมูล = ขึ้นต้นด้วยเลข OP หรือเป็นชีท REWORK (ที่เหลือ = cover/ฟอร์มเปล่า) */
export const isDataSheet = (key) => /^\d/.test(String(key ?? '').trim()) || /REWORK/i.test(key ?? '');

/** โทเคนที่หน้าตาเป็นเลขพาร์ท (นัท/child part) เช่น W520771-S · MB3B-16E060-CH */
const PART_RE = /^(W\d{6}\S*|[A-Z]{2,4}\d[A-Z0-9]*-\S+)$/;

/** แถว footer ของฟอร์ม (เลขฟอร์ม FM-xxx-000 ในคอลัมน์ A) → หยุดอ่านตรงนี้ */
const FOOTER_RE = /FM-[A-Z]+\d*-\d+/i;

const findFooter = (rows) => {
  for (let r = 0; r < rows.length; r++) if (FOOTER_RE.test(cv(rows[r]?.[0]))) return r;
  return rows.length;
};

/**
 * ป้ายกำกับของคอลัมน์หนึ่ง โดย resolve merged cell (ค่าอยู่มุมบนซ้าย ครอบทั้งช่วง)
 * คืน Map<rowIndex, label>
 */
export function colLabelMap(rows, merges, ci, stopRow) {
  const acc = new Map();
  for (const m of merges || []) {
    if (m?.s?.c <= ci && ci <= m?.e?.c) {
      const v = cv(rows[m.s.r]?.[m.s.c]);
      if (!v) continue;
      for (let r = m.s.r; r <= Math.min(m.e.r, stopRow); r++) {
        if (!acc.has(r)) acc.set(r, []);
        acc.get(r).push(v);
      }
    }
  }
  for (let r = 0; r <= Math.min(stopRow, rows.length - 1); r++) {
    const v = cv(rows[r]?.[ci]);
    if (v && !acc.has(r)) acc.set(r, [v]);
  }
  const out = new Map();
  for (const [r, vs] of acc) out.set(r, vs.join(' '));
  return out;
}

/** ต่อข้อความหลายบรรทัดของแถวที่เป็น "บรรทัดต่อ" ของ record เดิม */
const appendLine = (cur, key, val) => {
  if (!val) return;
  cur[key] = cur[key] ? `${cur[key]}\n${val}`.trim() : val;
};

/* ── ① PFMEA ────────────────────────────────────────────────── */

const F_COLS = { requirement: 1, failure_mode: 2, effects: 3, causes: 6, prevention: 7, detection_ctrl: 9, recommended_action: 12, responsibility: 13, action_taken: 14 };

/** แกะชีท PFMEA 1 ชีท → รายการ failure mode */
export function parseFmeaSheet(rows = [], merges = []) {
  const stop = findFooter(rows);
  const funcs = colLabelMap(rows, merges, 0, stop - 1);
  const recs = [];
  let cur = null, lastFunc = '';

  for (let r = 9; r < stop; r++) {
    const row = rows[r] || [];
    const g = (c) => cv(row[c]);
    const label = funcs.get(r) || '';
    if (label) lastFunc = label;

    const sev = num1to10(row[4]);
    if (sev !== null && g(2)) {
      if (cur) recs.push(cur);
      cur = {
        item_function: lastFunc, requirement: g(1), failure_mode: g(2), effects: g(3),
        severity: sev, classification: g(5), causes: g(6), prevention: g(7),
        occurrence: num1to10(row[8]), detection_ctrl: g(9), detection: num1to10(row[10]),
        recommended_action: g(12), responsibility: g(13), action_taken: g(14),
        new_severity: num1to10(row[15]), new_occurrence: num1to10(row[16]), new_detection: num1to10(row[17]),
      };
    } else if (cur) {
      for (const [key, c] of Object.entries(F_COLS)) appendLine(cur, key, g(c));
      if (g(5) && !cur.classification) cur.classification = g(5);
      for (const [key, c] of [['new_severity', 15], ['new_occurrence', 16], ['new_detection', 17]]) {
        if (cur[key] === null && num1to10(row[c]) !== null) cur[key] = num1to10(row[c]);
      }
    }
  }
  if (cur) recs.push(cur);
  return recs;
}

/* ── ② Control Plan ─────────────────────────────────────────── */

const C_COLS = { product_char: 4, process_char: 5, person: 7, spec: 8, method: 9, sample_size: 10, frequency: 11, control_method: 12, reaction_plan: 13 };

/** แกะชีท Control Plan 1 ชีท → จุดควบคุมราย Char No. */
export function parseCpSheet(rows = [], merges = []) {
  const stop = findFooter(rows);
  const subA = colLabelMap(rows, merges, 0, stop - 1);
  const subB = colLabelMap(rows, merges, 1, stop - 1);
  const subC = colLabelMap(rows, merges, 2, stop - 1);
  const recs = [];
  let cur = null, lastA = '', lastB = '', lastC = '';

  for (let r = 11; r < stop; r++) {
    const row = rows[r] || [];
    const g = (c) => cv(row[c]);

    if (subA.has(r) && /^\d/.test(subA.get(r))) {
      lastA = subA.get(r); lastB = subB.get(r) || ''; lastC = subC.get(r) || '';
    } else if (!subA.has(r) && subB.get(r)) {
      lastB = `${lastB}\n${subB.get(r)}`.trim();
    }

    const d = g(3);
    if (/^\d+$/.test(d)) {
      if (cur) recs.push(cur);
      cur = {
        sub_op: lastA, sub_name: lastB, machine: lastC, char_no: parseInt(d, 10),
        product_char: g(4), process_char: g(5), special_class: g(6), person: g(7),
        spec: g(8), method: g(9), sample_size: g(10), frequency: g(11),
        control_method: g(12), reaction_plan: g(13),
      };
    } else if (cur) {
      for (const [key, c] of Object.entries(C_COLS)) appendLine(cur, key, g(c));
      if (g(6) && !String(cur.special_class || '').includes(g(6))) {
        cur.special_class = cur.special_class ? `${cur.special_class}/${g(6)}` : g(6);
      }
    }
  }
  if (cur) recs.push(cur);
  return recs;
}

/* ── ③ Cover → ประวัติการแก้ไข (Revision History) ──────────── */

/**
 * แกะชีท cover → ประวัติ revision
 * ⚠️ คอลัมน์วันที่ไม่คงที่ระหว่างไฟล์ (เจอทั้ง B และ C) → หาเองจากคอลัมน์ที่มี "วันที่จริง" มากสุด
 *    แล้วอ่านคอลัมน์ที่เหลือแบบ offset (+1 suffix · +2 ECN · +3 เนื้อหา · +6..+8 ผู้จัดทำ/ตรวจ/อนุมัติ)
 */
export function parseCoverSheet(rows = []) {
  const last = Math.min(rows.length, 200);
  let dc = -1, bestN = 0;
  for (let c = 1; c <= 3; c++) {
    let n = 0;
    for (let r = 9; r < last; r++) if (isDateCell(rows[r]?.[c])) n++;
    if (n > bestN) { bestN = n; dc = c; }
  }
  if (dc < 0) return [];

  const out = [];
  let cur = null;
  for (let r = 9; r < last; r++) {
    const row = rows[r] || [];
    const b = cv(row[1]);
    if (/^REV/i.test(b) || b.includes('แก้ไข')) break;
    const content = cv(row[dc + 3]);
    if (isDateCell(row[dc])) {
      if (cur) out.push(cur);
      cur = {
        rev_date: cv(row[dc]), suffix: cv(row[dc + 1]), ecn_no: cv(row[dc + 2]).replace(/-/g, ''),
        content, issued_by: cv(row[dc + 6]), checked_by: cv(row[dc + 7]), approved_by: cv(row[dc + 8]),
      };
    } else if (cur && content) {
      cur.content += ` | ${content}`;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/* ── ④ ประกอบเป็นแผนนำเข้า ─────────────────────────────────── */

const GENERIC_NAMES = new Set(['INCOMING INSP.', 'INCOMING  INSP.', 'STORAGE', 'FINAL INSPECTION', 'INSPECTION', 'WELD INSPECTION', 'WARE HOUSE', 'WAREHOUSE', 'DELIVERY']);
const KEYWORD_OP = [['RIVET', 'RIVET'], ['WELD', 'WELD INSPECTION'], ['FINAL', 'FINAL INSPECTION'], ['WAREHOUSE', 'WARE HOUSE'], ['WARE', 'WARE HOUSE'], ['DELIVERY', 'DELIVERY']];

/** ตั้งชื่อ + ชนิดของ OP จากชื่อขั้นย่อยที่เจอในไฟล์ */
function nameOp(names, child, opNo) {
  const set = new Set(names);
  const suffix = child.length ? ` (${child[0]})` : '';
  const all = [...set];
  if (set.size && all.every((n) => n === 'INCOMING INSP.' || n === 'INCOMING  INSP.' || n === 'STORAGE')) {
    return { name: 'INCOMING INSP. + STORAGE', kind: 'incoming_insp' };
  }
  if (all.some((n) => n.includes('HYDROFORM'))) return { name: `HYDROFORM FAMILY${suffix}`, kind: 'process' };
  if (all.some((n) => n.includes('PROGRESSIVE'))) return { name: `PROGRESSIVE STAMPING${suffix}`, kind: 'process' };
  if (all.some((n) => n.startsWith('FORM') || n.includes('PIERCE') || n.includes('BLANK'))) {
    return { name: `STAMPING${suffix}`, kind: 'process' };
  }
  const main = names.find((n) => !GENERIC_NAMES.has(n)) || names[0] || `OP ${opNo}`;
  const kind = main.includes('INSPECTION') ? 'inspection'
    : main.includes('WARE') ? 'warehouse'
      : main.includes('DELIVERY') ? 'delivery' : 'process';
  return { name: main, kind };
}

/** เติม item_function ที่ว่าง (merged cell ครอบไม่ถึง) ด้วยค่าของ record ถัดไปที่มี */
function backfillFuncs(recs) {
  for (let i = 0; i < recs.length; i++) {
    const f = recs[i].item_function;
    if (!f || f === 'Item' || f === 'Function') {
      recs[i].item_function = recs.slice(i).find((x) => x.item_function && x.item_function !== 'Item' && x.item_function !== 'Function')?.item_function || '';
    }
  }
  return recs;
}

/**
 * ประกอบชีทที่แกะแล้วทั้งหมด → แผนนำเข้า
 * @param fmeaSheets Map/obj  { sheetKey: records[] }  (จาก parseFmeaSheet)
 * @param cpSheets   Map/obj  { sheetKey: records[] }  (จาก parseCpSheet)
 * @param revisions  [{ doc_type, ...parseCoverSheet }]
 * @returns { ops, fmea, cp, revisions, warnings }
 *   warnings = สิ่งที่ระบบจัดไม่ได้ **ต้องเอาไปโชว์ ห้ามกลืน**
 */
export function buildImportPlan({ fmeaSheets = {}, cpSheets = {}, revisions = [] } = {}) {
  const fmea = Object.fromEntries(Object.entries(fmeaSheets).filter(([k]) => isDataSheet(k)));
  const cp = Object.fromEntries(Object.entries(cpSheets).filter(([k]) => isDataSheet(k)));
  const warnings = [];

  /* 1) รายการ OP — สร้างจาก Control Plan ก่อน (ละเอียดสุด: มีขั้นย่อย + เครื่อง) */
  const ops = new Map(); // base → { names[], machines:Set, childs:Set }
  const touch = (b) => {
    if (!ops.has(b)) ops.set(b, { names: [], machines: new Set(), childs: new Set() });
    return ops.get(b);
  };

  for (const [key, recs] of Object.entries(cp)) {
    const rng = rangedKey(key);
    for (const r of recs) {
      const b = baseOf(r.sub_op) || (rng ? null : baseOf(key));
      if (!b) continue;
      const o = touch(b);
      const lines = String(r.sub_name || '').split('\n');
      const nm = (lines[0] || '').trim();
      if (nm && !o.names.includes(nm)) o.names.push(nm);
      for (const ln of lines.slice(1)) if (PART_RE.test(ln.trim())) o.childs.add(ln.trim());
      if (String(r.machine || '').trim()) o.machines.add(String(r.machine).trim());
    }
  }

  /* ไม่มี Control Plan → ถอยไปสร้าง OP จากชื่อชีทของ PFMEA (อัพโหลดไฟล์เดียวก็ยังใช้ได้) */
  if (!ops.size) {
    for (const key of Object.keys(fmea)) {
      if (rangedKey(key)) continue;
      const b = baseOf(key);
      if (b) touch(b);
    }
    if (ops.size) warnings.push({ level: 'warn', text: `ไม่มีไฟล์ Control Plan — สร้างรายการ OP จากชื่อชีทของ PFMEA (${ops.size} OP) ชื่อขั้นงาน/เครื่องจักรจะยังว่าง ต้องเติมเองภายหลัง` });
  }

  /* child part จาก label ฝั่ง PFMEA (บางตัวมีเฉพาะใน FMEA) */
  for (const [key, recs] of Object.entries(fmea)) {
    const b = baseOf(key);
    if (!b || rangedKey(key) || /REWORK/i.test(key)) continue;
    for (const r of recs) {
      for (const tok of String(r.item_function || '').split(/\s+/)) {
        if (PART_RE.test(tok) && ops.has(b)) ops.get(b).childs.add(tok);
      }
    }
  }

  const opRows = [...ops.keys()].sort((a, b) => +a - +b).map((b) => {
    const o = ops.get(b);
    const names = o.names.filter(Boolean);
    const child = [...o.childs].sort();
    const machines = [...o.machines].sort();
    const { name, kind } = nameOp(names, child, b);
    const flow = names.length > 1 ? names.join(' → ') : '';
    return {
      op_no: b, seq: +b, name, kind, machine_no: null,
      child_parts: child.join('\n') || null,
      remark: [flow, machines.join(' / ')].filter(Boolean).join(' · ') || null,
    };
  });
  const opNos = new Set(opRows.map((o) => o.op_no));

  /* 2) จัดแถว PFMEA เข้า OP */
  const weldInspOp = opRows.find((o) => o.name.includes('WELD INSPECTION'))?.op_no || null;
  const fmeaItems = [];
  const unrouted = [];
  const keys = Object.keys(fmea).sort((a, b) => {
    const ba = baseOf(a), bb = baseOf(b);
    return (ba ? 0 : 1) - (bb ? 0 : 1) || (+ba || 999) - (+bb || 999) || a.localeCompare(b);
  });

  for (const key of keys) {
    const recs = backfillFuncs(fmea[key]);
    const rng = rangedKey(key);
    if (/REWORK/i.test(key)) {
      for (const r of recs) r._op = weldInspOp;
    } else if (rng) {
      // ชีทช่วงรวม: เดา OP จากคำสำคัญใน Item/Function แล้วยึดค่าล่าสุดต่อไป
      let lastOp = String(rng[0]);
      const inRange = opRows.filter((o) => +o.op_no >= rng[0] && +o.op_no <= rng[1]);
      for (const r of recs) {
        const f = String(r.item_function || '').toUpperCase();
        let hit = null;
        for (const [kw, nm] of KEYWORD_OP) {
          if (f.includes(kw)) {
            hit = inRange.find((o) => String(o.name).toUpperCase().includes(nm))?.op_no || null;
            if (hit) break;
          }
        }
        lastOp = hit || lastOp;
        r._op = lastOp;
      }
    } else {
      const b = baseOf(key);
      for (const r of recs) r._op = b;
    }
    for (const r of recs) {
      if (r._op && opNos.has(r._op)) fmeaItems.push(r);
      else unrouted.push({ sheet: key, op: r._op, text: String(r.failure_mode || '').slice(0, 40) });
    }
  }

  /* 3) จัดแถว Control Plan เข้า OP */
  const cpItems = [];
  for (const key of Object.keys(cp).sort((a, b) => (+baseOf(a) || 999) - (+baseOf(b) || 999) || a.localeCompare(b))) {
    for (const r of cp[key]) {
      const b = baseOf(r.sub_op) || baseOf(key);
      if (b && opNos.has(b)) { r._op = b; cpItems.push(r); }
      else unrouted.push({ sheet: key, op: b, text: `Char ${r.char_no} · ${String(r.product_char || '').slice(0, 30)}` });
    }
  }

  /* seq เริ่มนับใหม่ทุก OP (ตรงกับฟอร์มกระดาษ) */
  for (const list of [fmeaItems, cpItems]) {
    const c = new Map();
    for (const r of list) { c.set(r._op, (c.get(r._op) || 0) + 1); r._seq = c.get(r._op); }
  }

  /* 4) ประวัติ revision — ตัดซ้ำด้วย (ชนิด, วันที่, ต้นเนื้อหา) */
  const seen = new Set();
  const revs = [];
  for (const r of revisions) {
    const k = `${r.doc_type}|${r.rev_date}|${String(r.content || '').slice(0, 60)}`;
    if (seen.has(k) || !r.rev_date) continue;
    seen.add(k);
    revs.push(r);
  }

  if (unrouted.length) {
    warnings.push({ level: 'error', text: `มี ${unrouted.length} แถวที่จัดเข้า OP ไม่ได้ — จะไม่ถูกนำเข้า`, rows: unrouted.slice(0, 20) });
  }
  if (!opRows.length) {
    warnings.push({ level: 'error', text: 'อ่านไม่พบขั้นงาน (OP) เลย — ไฟล์อาจไม่ใช่ฟอร์ม TSAT หรือ layout ต่างจากที่ระบบรู้จัก' });
  }

  return { ops: opRows, fmea: fmeaItems, cp: cpItems, revisions: revs, warnings, unrouted };
}

/** สรุปจำนวนรายการต่อ OP (ใช้โชว์ในตาราง preview) */
export function planSummary(plan) {
  const by = new Map();
  for (const o of plan.ops) by.set(o.op_no, { ...o, fmea: 0, cp: 0 });
  for (const r of plan.fmea) if (by.has(r._op)) by.get(r._op).fmea++;
  for (const r of plan.cp) if (by.has(r._op)) by.get(r._op).cp++;
  return [...by.values()];
}
