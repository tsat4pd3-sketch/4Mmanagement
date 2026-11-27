/* ══ 🤝 csatImport — ตัวแกะไฟล์ "V5 %Customer Satisfaction" ของ QSM (2026-11-24 · คำสั่ง user "อัพ customer satisfaction ให้ที แยก Q/D และเจาะรายลูกค้า") ══
   ไฟล์: `TSAT 4 V5 %Customer Satisfaction FY<ปี> <เดือน>.<ชื่อเดือน> - Rev.xx.xlsx` (QSM ส่งทางอีเมลเดือนละครั้ง + วางที่ V:\Document Information\IATF 16949\14.Customer Sat\…)
   ชีทที่อ่าน = `STD FAC. (<ปี>)` — ตาราง "ลูกค้า × ชนิด (Delivery/Quality) × เดือน" แต่ละเดือนมี 2 ช่อง Result (คะแนน/PPM ดิบ) + Score (เกรด A=1 · B=0.5 · C=0)
   · แถว `Q&D` ของลูกค้า = ค่าที่คำนวณในไฟล์ (เฉลี่ย D/Q) **ไม่เก็บ** — ระบบคิดเองจากคะแนน D/Q
   · แถว `Total Delivery` / `Total Quality` / `Overall TSAT-4` = ค่ารวมในไฟล์ (สัดส่วน 0–1) เก็บไว้ **เทียบ** กับที่ระบบคิดเท่านั้น (จอต้องเขียนบอกถ้าไม่ตรง)
   · `*` = ลูกค้ารายนั้นไม่ประเมินเดือนนั้น (ไม่มี order / ลูกค้ายังไม่ส่ง) ⇒ `evaluated:false` ไม่เข้าตัวหาร (ตรงกับที่ไฟล์ตัด '*' ออกจากค่าเฉลี่ย)
   🔴 สูตรค่ารวม = (Σคะแนน Q + Σคะแนน D) ÷ (จำนวนที่ประเมิน Q + D) × 100 — เท่ากับ "Overall" ในไฟล์เป๊ะ (พิสูจน์ ก.พ. 11/12 · ต.ค. 6.5/8)
      และเท่ากับ `csat_qd_pct` ใน KPI_FORMULAS ⇒ ตัวแปรฐาน csat_q_actual = Σคะแนน Q · csat_q_total = จำนวนที่ประเมิน Q (D เหมือนกัน)
   ⚠️ ไฟล์นี้ไม่ยิง DB · ไม่ import react — ใช้ร่วมกันทั้งเว็บ (KpiCsatImportModal) และ CLI (scripts/acct-import/import_csat.mjs) ห้ามมีตัวแกะชุดที่ 2 */
import { monthOfHeader } from './kpiBaseImport.js';

export const CSAT_KINDS = ['delivery', 'quality'];
export const CSAT_KIND_LABEL = { delivery: 'ส่งมอบ (D)', quality: 'คุณภาพ (Q)' };

const low = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const isStar = (v) => typeof v === 'string' && v.trim() === '*';
const num = (v) => {
  if (v == null || v === '' || typeof v === 'boolean') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace(/[,%\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const kindOf = (t) => { const s = low(t); return s === 'delivery' ? 'delivery' : s === 'quality' ? 'quality' : null; };

/** ชีทนี้เป็นตาราง STD FAC. ของ Customer Satisfaction ไหม (ใช้ใน importRegistry · ตอบ true เมื่อมั่นใจเท่านั้น) */
export function isCsatSheet(rows = []) {
  const head = (rows || []).slice(0, 15);
  const hasHdr = head.some(r => Array.isArray(r) && r.some(c => low(c) === 'customer') && r.some(c => low(c) === 'type'));
  const hasTotal = (rows || []).slice(0, 40).some(r => Array.isArray(r) && r.some(c => /^(total (delivery|quality)|overall)/.test(low(c))));
  return hasHdr && hasTotal;
}

/** เลือกชีท `STD FAC. (<ปี>)` — ระบุปีแล้วไม่เจอ = null (ห้ามหยิบปีอื่นมาเงียบๆ) · ไม่ระบุ = ปีล่าสุด */
export function pickCsatSheet(names = [], year = null) {
  const hits = (names || []).map(n => { const m = /std\s*fac\.?\s*\((\d{4})\)/i.exec(String(n)); return m ? { name: n, year: Number(m[1]) } : null; }).filter(Boolean);
  if (!hits.length) return null;
  if (year != null) return hits.find(h => h.year === Number(year)) || null;
  return hits.sort((a, b) => b.year - a.year)[0];
}

/**
 * แกะชีท STD FAC. → แถวรายลูกค้า + ค่ารวมในไฟล์ + ค่ารวมที่ระบบคิด
 * @param grid  rows แบบ sheet_to_json(header:1)
 * @returns { year, rows:[{customer, kind, month, result, score, evaluated, remark}], bands:{[customer|kind]:{a,b,c,target}},
 *            totals:{ sheet:{delivery:{m:pct}, quality:{}, overall:{}}, computed:{…} }, mismatch:[{kind, month, sheet, computed}], warnings:[] }
 */
export function parseCsatGrid(grid = [], { year = null } = {}) {
  const warnings = [];
  const g = (grid || []).map(r => (Array.isArray(r) ? r : []));
  const hdrRow = g.findIndex(r => r.some(c => low(c) === 'customer') && r.some(c => low(c) === 'type'));
  if (hdrRow < 0) return { year, rows: [], bands: {}, totals: null, mismatch: [], warnings: ['ไม่พบแถวหัวตาราง (Customer · Type)'] };
  const hdr = g[hdrRow];
  const colCustomer = hdr.findIndex(c => low(c) === 'customer');
  const colType = hdr.findIndex(c => low(c) === 'type');
  const colA = hdr.findIndex(c => low(c) === 'target');          // Grade A ตรงกับ Target ของลูกค้า
  /* แถวหัวเดือน = แถวแรกใต้หัวตารางที่มีชื่อเดือน ≥ 6 ช่อง · แต่ละเดือนกิน 2 คอลัมน์ (Result · Score) */
  let monthRow = -1; const monthCols = {};
  for (let i = hdrRow; i < Math.min(g.length, hdrRow + 4); i++) {
    const cols = {};
    g[i].forEach((c, ci) => { if (ci > colType) { const m = monthOfHeader(c); if (m && !cols[m]) cols[m] = ci; } });
    if (Object.keys(cols).length >= 6) { monthRow = i; Object.assign(monthCols, cols); break; }
  }
  if (monthRow < 0) return { year, rows: [], bands: {}, totals: null, mismatch: [], warnings: ['ไม่พบแถวหัวเดือน (Jan … Dec)'] };
  const sub = g[monthRow + 1] || [];
  const scoreColOf = (m) => {
    const c = monthCols[m];
    if (low(sub[c]) === 'result' && low(sub[c + 1]) === 'score') return c + 1;
    if (low(sub[c]) === 'score') return c;
    return c + 1;   // ไม่มีแถว Result/Score กำกับ = ถือว่า Score อยู่ช่องถัดไป (โครงเดิมของไฟล์)
  };
  const lastDataCol = Math.max(...Object.values(monthCols)) + 1;
  const months = Object.keys(monthCols).map(Number).sort((a, b) => a - b);

  const rows = []; const bands = {};
  const totals = { sheet: { delivery: {}, quality: {}, overall: {} }, computed: { delivery: {}, quality: {}, overall: {} } };
  const dataStart = low(sub[monthCols[months[0]]]) === 'result' ? monthRow + 2 : monthRow + 1;
  for (let i = dataStart; i < g.length; i++) {
    const r = g[i];
    const cust = String(r[colCustomer] ?? '').trim();
    if (!cust) continue;
    const lc = low(cust);
    const totalKind = /^total delivery/.test(lc) ? 'delivery' : /^total quality/.test(lc) ? 'quality' : /^overall/.test(lc) ? 'overall' : null;
    if (totalKind) {
      months.forEach(m => { const v = num(r[scoreColOf(m)]); if (v != null) totals.sheet[totalKind][m] = v <= 1.0001 ? v * 100 : v; });
      if (totalKind === 'overall') break;   // Overall = แถวสุดท้ายของตาราง (ใต้ลงไปเป็น remark)
      continue;
    }
    const kind = kindOf(r[colType]);
    if (!kind) continue;   // แถว Q&D (ค่าที่ไฟล์คำนวณ) หรือแถวอื่น — ไม่เก็บ
    bands[`${cust}|${kind}`] = { a: r[colA] ?? null, b: r[colA + 1] ?? null, c: r[colA + 2] ?? null, target: r[colA] ?? null };
    /* remark = ข้อความท้ายแถวหลังคอลัมน์เดือน (เช่น "ไม่มีการประเมินจากลูกค้า เนื่องจากไม่มี Order") · ข้าม "Jan - Apr" ที่เป็นป้ายช่วย */
    const remark = r.slice(lastDataCol + 1).filter(c => typeof c === 'string' && c.trim() && !/^jan\s*-/i.test(c.trim()) && c.trim() !== '*').map(c => c.trim()).join(' · ') || null;
    months.forEach(m => {
      const rc = monthCols[m]; const sc = scoreColOf(m);
      const rawRes = r[rc]; const rawScore = r[sc];
      if (isStar(rawRes) || isStar(rawScore)) { rows.push({ customer: cust, kind, month: m, result: null, score: null, evaluated: false, remark }); return; }
      const result = num(rawRes);
      if (result == null) return;   // เดือนที่ยังไม่มีผล (ช่องว่าง) — ไม่สร้างแถว · ห้ามเดา 0
      const score = num(rawScore);
      if (score == null || score < 0 || score > 1) { warnings.push(`${cust} ${kind} เดือน ${m}: คะแนน "${rawScore}" ไม่ใช่ 0 / 0.5 / 1 — ข้ามเดือนนี้`); return; }
      rows.push({ customer: cust, kind, month: m, result, score, evaluated: true, remark });
    });
  }
  /* ค่ารวมที่ระบบคิด — สูตรเดียวกับ csat_qd_pct (ตัวตั้งรวม ÷ ตัวหารรวม · ห้ามเฉลี่ย % ของขา) */
  const mismatch = [];
  months.forEach(m => {
    const agg = csatAggregate(rows.filter(x => x.month === m));
    if (agg.d.n) totals.computed.delivery[m] = (agg.d.sum / agg.d.n) * 100;
    if (agg.q.n) totals.computed.quality[m] = (agg.q.sum / agg.q.n) * 100;
    if (agg.d.n + agg.q.n) totals.computed.overall[m] = ((agg.d.sum + agg.q.sum) / (agg.d.n + agg.q.n)) * 100;
    for (const k of ['delivery', 'quality', 'overall']) {
      const s = totals.sheet[k][m], c = totals.computed[k][m];
      if (s != null && c != null && Math.abs(s - c) > 0.05) mismatch.push({ kind: k, month: m, sheet: s, computed: c });
    }
  });
  /* เดือนที่ไฟล์มี "ค่ารวม" แต่ไม่มีผลรายลูกค้าเลย = สูตรค้างของเดือนที่ยังไม่ประเมิน (พ.ย./ธ.ค. โชว์ 41.67 %) — ไม่นำเข้า · บอกไว้เฉยๆ */
  const ghost = months.filter(m => totals.sheet.overall[m] != null && totals.computed.overall[m] == null);
  if (ghost.length) warnings.push(`เดือน ${ghost.join(', ')} ไฟล์มีค่ารวมแต่ไม่มีผลรายลูกค้า (สูตรค้างของเดือนที่ยังไม่ประเมิน) — ไม่นำเข้า`);
  if (!rows.length) warnings.push('ไม่พบแถวลูกค้าที่มีผลประเมิน');
  return { year, rows, bands, totals, mismatch, warnings, months };
}

/** รวมคะแนนของเดือนหนึ่ง → { q:{sum,n}, d:{sum,n} } (นับเฉพาะที่ประเมิน) — ตัวเดียวกับที่ trigger ฝั่ง DB ใช้ (kpi_csat_rollup) */
export function csatAggregate(rows = []) {
  const out = { q: { sum: 0, n: 0 }, d: { sum: 0, n: 0 } };
  for (const r of rows) {
    if (!r.evaluated || r.score == null) continue;
    const k = r.kind === 'quality' ? 'q' : r.kind === 'delivery' ? 'd' : null;
    if (!k) continue;
    out[k].sum += Number(r.score); out[k].n += 1;
  }
  return out;
}

/** ตัวแปรฐาน csat_* ของเดือน (null เมื่อไม่มีใครถูกประเมิน — ห้าม 0) */
export function csatBaseVars(rows = []) {
  const a = csatAggregate(rows);
  return {
    csat_q_actual: a.q.n ? a.q.sum : null, csat_q_total: a.q.n ? a.q.n : null,
    csat_d_actual: a.d.n ? a.d.sum : null, csat_d_total: a.d.n ? a.d.n : null,
  };
}

/** แกะทั้งเล่ม { names, grids } → ผลของชีทปีที่ขอ (ไม่ระบุ = ปีล่าสุดในเล่ม) */
export function parseCsatBook(book, { year = null } = {}) {
  const pick = pickCsatSheet(book?.names || Object.keys(book?.grids || {}), year);
  if (!pick) return { year, sheet: null, rows: [], bands: {}, totals: null, mismatch: [], warnings: [year != null ? `ไม่มีชีท "STD FAC. (${year})" ในไฟล์นี้` : 'ไม่มีชีท STD FAC. (<ปี>) ในไฟล์นี้'] };
  return { ...parseCsatGrid(book.grids[pick.name], { year: pick.year }), sheet: pick.name };
}

/** ปี + เดือนล่าสุดจากชื่อไฟล์ "… FY2026 10.Oct - Rev.02.xlsx" → { year, month, rev } (ไม่เจอ = null รายช่อง) */
export function csatFileMeta(name = '') {
  const y = /FY\s*(\d{4})/i.exec(name); const m = /(\d{1,2})\.(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.exec(name); const rev = /rev\.?\s*(\d+)/i.exec(name);
  return { year: y ? Number(y[1]) : null, month: m ? Number(m[1]) : null, rev: rev ? Number(rev[1]) : null };
}
