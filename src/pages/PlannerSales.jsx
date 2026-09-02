import { useState, useEffect, useCallback, useMemo, useContext } from 'react';
import { supabase, supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import LineSelect from '../components/LineSelect';
import useProductionLines from '../utils/useProductionLines';
import { baseOfPart } from '../utils/matResolve';
import { toast } from '../components/Toast';
import { can } from '../utils/permissions';
import { isFgMat } from '../utils/matPrefix';
import { calcWithdrawalKanban, calcProductionKanban, nextMonthKey } from '../utils/kanbanCalc';
import { wavg, wLoad } from '../utils/oee';
import { loadCompanyCalendar, countWorkingDaysInMonth } from '../utils/companyCalendar';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from 'recharts';
import PageHeader from '../components/PageHeader';
import useTabParam from '../utils/useTabParam';
import { fetchAllPages } from '../utils/fetchByIds';
import { dedupeForecastRows } from '../utils/demandSupply';

/* ─── PLANNER & SALES — Forecast Planner + อัพโหลดไฟล์จากลูกค้า ──────────────
   Sales อัพโหลด Excel 2 แบบ: (1) Forecast ล่วงหน้าจากลูกค้า (2) Order + รอบเวลาส่งงาน
   → ระบบทำ Forecast Planner (เทียบ forecast/order/ภาระการผลิต)
   ส่วนติดตามการส่งงานรายวัน (Shipping Chart + Ship-to Config) อยู่หน้า 🚚 Delivery */


const card = {
  background: 'var(--card)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)', padding: 16,
};
const btn = (active) => ({
  padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-body)',
  background: active ? 'var(--accent)' : 'var(--bg2)', color: active ? '#08130a' : 'var(--text2)',
  border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
});
const inputSt = {
  padding: '8px 10px', borderRadius: 8, fontSize: 13, background: 'var(--bg2)',
  border: '1px solid var(--border)', color: 'var(--text)', fontFamily: 'var(--font-body)',
};

const dateStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/* วันงานปัจจุบัน (ตัด 08:00 ตามกฎโปรเจค — ห้ามใช้ toISOString) */
const workDateStr = () => { const d = new Date(); if (d.getHours() < 8) d.setDate(d.getDate() - 1); return dateStr(d); };
const monthFirst = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
const monthLabel = (iso) => {
  const [y, m] = iso.split('-').map(Number);
  const TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  return `${TH[m - 1]} ${y + 543}`;
};
const fmt = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 1 });

/* ── Excel cell parsers — รองรับรูปแบบวันที่/เวลา ที่เจอบ่อยในไฟล์ลูกค้า ── */
const MONTH_EN = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
function excelSerialToDate(n) {
  const d = new Date(Math.round((n - 25569) * 86400000));
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
function parseDateCell(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date && !isNaN(v)) return new Date(v.getFullYear(), v.getMonth(), v.getDate());
  if (typeof v === 'number' && v >= 19000101 && v <= 21991231) {
    // EDI แบบ Ford ใช้เลข YYYYMMDD ตรง ๆ เช่น 20260706
    const y = Math.floor(v / 10000), mo = Math.floor(v / 100) % 100, da = v % 100;
    if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) return new Date(y, mo - 1, da);
  }
  if (typeof v === 'number' && v > 20000 && v < 80000) return excelSerialToDate(v);
  const s = String(v).trim();
  const m8 = s.match(/^(19|20|21)(\d{2})(\d{2})(\d{2})$/);
  if (m8) return new Date(Number(m8[1] + m8[2]), +m8[3] - 1, +m8[4]);
  let m = s.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/);            // yyyy-mm[-dd]
  if (m) return new Date(+m[1], +m[2] - 1, +(m[3] || 1));
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);                // dd/mm/yyyy (แบบไทย, รองรับ พ.ศ.)
  if (m) { let y = +m[3]; if (y < 100) y += 2000; if (y > 2400) y -= 543; return new Date(y, +m[2] - 1, +m[1]); }
  m = s.match(/^(\d{1,2})\/(\d{4})$/);                             // mm/yyyy
  if (m) { let y = +m[2]; if (y > 2400) y -= 543; return new Date(y, +m[1] - 1, 1); }
  m = s.toLowerCase().match(/^([a-z]{3,9})[\s.'-]*(\d{2,4})$/);    // Jan-26 / January 2026
  if (m && MONTH_EN[m[1].slice(0, 3)] != null) { let y = +m[2]; if (y < 100) y += 2000; if (y > 2400) y -= 543; return new Date(y, MONTH_EN[m[1].slice(0, 3)], 1); }
  const d = new Date(s);
  return isNaN(d) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function parseTimeCell(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && v >= 0 && v < 1) {
    const mins = Math.round(v * 1440);
    return `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  }
  if (v instanceof Date && !isNaN(v)) return `${String(v.getHours()).padStart(2, '0')}:${String(v.getMinutes()).padStart(2, '0')}`;
  const m = String(v).trim().match(/^(\d{1,2})[:.](\d{2})/);
  if (m) return `${String(+m[1] % 24).padStart(2, '0')}:${m[2]}`;
  return null;
}
const numCell = (v) => { const n = parseFloat(String(v ?? '').replace(/,/g, '')); return isNaN(n) ? 0 : n; };

/* คอลัมน์ที่ map ได้ + ตัวเดารายชื่อหัวตาราง */
const FIELD_DEFS = {
  forecast: [
    { key: 'mat_no',   label: 'MAT No. *',   guess: /mat|material|part\s*no|p\/?n|item|รหัส/i },
    { key: 'part_name', label: 'ชื่อพาร์ท',  guess: /name|desc|ชื่อ|รายการ/i },
    { key: 'customer', label: 'ลูกค้า',      guess: /cust|ลูกค้า/i },
    { key: 'period',   label: 'เดือน',       guess: /month|period|เดือน/i },
    { key: 'qty',      label: 'จำนวน',       guess: /qty|quan|จำนวน|pcs|amount|volume/i },
  ],
  orders: [
    { key: 'order_no', label: 'เลขที่ Order', guess: /order|p\.?o\b|po\s*no|เลขที่/i },
    { key: 'mat_no',   label: 'MAT No. *',    guess: /mat|material|part\s*no|p\/?n|item|รหัส/i },
    { key: 'part_name', label: 'ชื่อพาร์ท',   guess: /name|desc|ชื่อ|รายการ/i },
    { key: 'customer', label: 'ลูกค้า',       guess: /cust|ลูกค้า/i },
    { key: 'qty',      label: 'จำนวน *',      guess: /qty|quan|จำนวน|pcs|amount/i },
    { key: 'due_date', label: 'วันที่ส่ง *',  guess: /due|deliv|ship.*date|ส่งมอบ|วันที่ส่ง|^date/i },
    { key: 'ship_time', label: 'รอบเวลาส่ง',  guess: /time|เวลา|รอบ/i },
  ],
};

/* ─── Upload Tab ──────────────────────────────────────────────────────────── */
function UploadTab({ canUpload, fullName, onImported, custLabel }) {
  const [kind, setKind] = useState('forecast');   // 'forecast' | 'orders'
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState([]);     // [{ idx, text }]
  const [rows, setRows] = useState([]);           // data rows (array of arrays)
  const [mapping, setMapping] = useState({});     // fieldKey → column idx (-1 = ไม่ใช้)
  const [wideMode, setWideMode] = useState(false);
  const [monthCols, setMonthCols] = useState([]); // [{ idx, month }] สำหรับ wide mode
  const [saving, setSaving] = useState(false);
  const [batches, setBatches] = useState([]);
  const [edi, setEdi] = useState(null); // ไฟล์ EDI (Ford 830/862) ที่ parse แล้ว รอยืนยันนำเข้า

  const loadBatches = useCallback(async () => {
    const { data } = await supabaseDR.from('demand_upload_batches').select('*').order('uploaded_at', { ascending: false }).limit(30);
    setBatches(data || []);
  }, []);
  useEffect(() => { loadBatches(); }, [loadBatches]);

  /* ── EDI (Ford/AAT · 830 = Planning Forecast · 862 = Shipping Schedule) ──
     ไฟล์จากระบบ EDI มี sheet ดิบที่หัวตารางคงที่ — ตรวจจับแล้ว parse อัตโนมัติ ไม่ต้อง map มือ */
  const EDI_SIG = ['Part Num', 'Forecast Net Qty', 'Forecast Date'];
  const findEdiSheet = (XLSX, wb) => {
    for (const name of wb.SheetNames) {
      const m = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
      for (let i = 0; i < Math.min(m.length, 5); i++) {
        const hd = m[i].map(c => String(c).trim());
        if (EDI_SIG.every(k => hd.includes(k))) return { matrix: m, hIdx: i, headers: hd };
      }
    }
    return null;
  };
  const parseEdiFile = (sheet, fName) => {
    const { matrix, hIdx, headers } = sheet;
    const col = (n) => headers.indexOf(n);
    const is862 = col('Forecast Time') >= 0;
    const out = [];
    matrix.slice(hIdx + 1).forEach(r => {
      const part = String(r[col('Part Num')] ?? '').trim();
      if (!part) return;
      const qty = numCell(r[col('Forecast Net Qty')]);
      const d = parseDateCell(r[col('Forecast Date')]);
      if (qty <= 0 || !d) return;
      out.push({
        part, qty, date: dateStr(d),
        shipTo: String(r[col('Ship To GSDB Code')] ?? '').trim() || 'EDI',
        po: String(r[col('Purchase Order Num')] ?? '').trim(),
        time: is862 ? parseTimeCell(r[col('Forecast Time')]) : null,
        dock: is862 && col('Dock Code') >= 0 ? String(r[col('Dock Code')] ?? '').trim() : null,
      });
    });
    return { is862, rows: out, fName };
  };

  const handleFiles = async (fileList, kindNow) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    try {
      const XLSX = await import('xlsx');
      const ediFiles = [];
      let manual = null;
      for (const file of files) {
        const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
        const ediSheet = findEdiSheet(XLSX, wb);
        if (ediSheet) { ediFiles.push(parseEdiFile(ediSheet, file.name)); continue; }
        if (!manual) manual = { wb, name: file.name };
      }
      if (ediFiles.length) {
        if (ediFiles.some(f => f.is862) && ediFiles.some(f => !f.is862)) {
          toast.error('อย่าเลือกไฟล์ 830 (Forecast) ปนกับ 862 (Shipping) ในครั้งเดียว — แยกนำเข้าทีละชนิด');
          return;
        }
        const is862 = ediFiles[0].is862;
        // dedupe: EDI ออกบรรทัดซ้ำ key เดิมได้ — ใช้ตัวหลังสุด ไม่บวกทบ
        // ⚠️ key ต้องรวม PO — 2 release ต่าง Purchase Order ที่ part/วัน/เวลาเดียวกันเป็นคนละใบจริง
        //    (เดิมตัวหลังทับ = demand หายเงียบ · QC flow-audit D1) — บรรทัดซ้ำแท้ (ทุกช่องเท่ากัน) ยังถูก dedupe เหมือนเดิม
        const byKey = new Map();
        ediFiles.forEach(f => f.rows.forEach(r => byKey.set(`${r.shipTo}|${r.part}|${r.date}|${r.time || ''}|${r.po || ''}`, r)));
        const rows2 = [...byKey.values()];
        if (!rows2.length) { toast.error('ไม่พบรายการที่มีจำนวน > 0 ในไฟล์ EDI'); return; }
        /* map Part Num ลูกค้า → mat_no ภายใน ผ่าน p_no (normalize ตัด ขีด/ช่องว่าง)
           ⚠️ เลขพาร์ทลูกค้าตัวเดียว **มีได้หลายเลข SAP** — ต่างกันที่ "ลูกค้าปลายทาง"
              ข้อมูลจริง 2026-08-24: `RB3B-16E060-BA` → 10100384 (FTM) · 10100385 (AAT)
              · 10106790 (FVL) · 10104955 (FVL unpack)  = 4 เลข ทั้งหมดเป็น FG สะอาด
              เดิมเก็บ p_no ละ 1 ตัว (ตัวไหนมาก่อนชนะ) ⇒ **ออเดอร์ของทุกลูกค้าไปกองที่เลขเดียว**
              → เลขอื่นดูเหมือนไม่มีใครสั่ง (ไม่ผลิต) ส่วนเลขที่รับไปหมดดูเหมือนของจะขาด = ตัดสินใจผิดทั้งคู่
           → แยกด้วย **ship-to → ชื่อลูกค้า** (`ship_to_plants.customer_name` เทียบ `dr_products.customer`)
              ตั้งค่าที่ 🚚 Delivery → ⚙️ Ship-to Plant Config (เช่น GRBNA → AAT)
           ⚠️ ยังไม่ได้ตั้งชื่อลูกค้า = แยกไม่ออก → คงพฤติกรรมเดิม (FG ตัวแรกชนะ) **แต่ต้องรายงานว่าเดา**
              ห้ามเงียบ และห้ามหยุด import (ไม่งั้นงานส่งของหยุดทั้งวัน) */
        const norm = (x) => String(x || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        const [{ data: stds }, { data: prods }, { data: shipTos }] = await Promise.all([
          // ⚠️ ต้องกรอง is_active — แถว kanban ที่ปิดไปแล้ว (EC superseded) ห้ามจ่ายคู่ p_no ได้อีก
          supabaseDR.from('kanban_standards').select('mat_no, p_no, part_name').eq('is_active', true).not('p_no', 'is', null),
          supabaseDR.from('dr_products').select('mat_no, p_no, name, customer').eq('is_active', true).not('p_no', 'is', null),
          supabaseDR.from('ship_to_plants').select('code, customer_name'),
        ]);
        // ship-to code → ชื่อลูกค้า (ยังไม่ตั้ง = customer_name เท่ากับ code เอง → ถือว่า "ไม่รู้")
        const custOfShipTo = {};
        (shipTos || []).forEach(t => {
          const cn = String(t.customer_name || '').trim();
          if (cn && norm(cn) !== norm(t.code)) custOfShipTo[String(t.code)] = norm(cn);
        });
        const matMap = {}, baseMap = {};
        const put = (pno, mat, name, customer) => {
          const k = norm(pno);
          if (!k || !mat) return;
          const list = (matMap[k] = matMap[k] || []);
          if (!list.some(e => e.mat_no === mat)) list.push({ mat_no: mat, name, customer: norm(customer) });
          // ดัชนี base part (ตัด revision) สำหรับ fallback — เก็บทุกตัวเพื่อเช็คกำกวม
          const b = baseOfPart(pno);
          if (b) { (baseMap[b] = baseMap[b] || []); if (!baseMap[b].some(e => e.mat_no === mat)) baseMap[b].push({ mat_no: mat, name }); }
        };
        // dr_products ก่อน — ตัวเดียวที่รู้ "ลูกค้า" ของ mat (list dedupe ต่อ mat_no: ใครใส่ก่อนชนะ
        // ถ้า kanban_standards ใส่ก่อน entry จะไม่มี customer แล้วการแยกด้วย ship-to ใช้ไม่ได้)
        (prods || []).forEach(x => put(x.p_no, x.mat_no, x.name, x.customer));
        (stds || []).forEach(x => put(x.p_no, x.mat_no, x.part_name, null));
        // FG (ขึ้นต้น 1) ชนะ child เสมอ — เรียงให้ FG มาก่อนในทุกลิสต์
        Object.values(matMap).forEach(l => l.sort((a, b) => (isFgMat(b.mat_no) ? 1 : 0) - (isFgMat(a.mat_no) ? 1 : 0)));
        const unmatched = new Set();
        const guessed = new Map();     // part → { shipTos:Set, mats:[...] } = แยกลูกค้าไม่ออก ต้องตั้ง ship-to
        const baseHits = new Map();    // part → mat = จับคู่จาก base part (ตัด revision) — ต้องโชว์ให้คนเห็นก่อนยืนยัน
        const records = rows2.map(r => {
          const cands = matMap[norm(r.part)] || [];
          let hit = null;
          if (cands.length === 1) hit = cands[0];
          else if (cands.length > 1) {
            const want = custOfShipTo[r.shipTo];
            const byCust = want ? cands.filter(c => c.customer && c.customer === want) : [];
            if (byCust.length === 1) hit = byCust[0];
            else {
              hit = cands[0];                                   // เดาตัวแรก (FG ก่อน) แบบเดิม — แต่แจ้ง
              const g = guessed.get(r.part) || { shipTos: new Set(), mats: cands.map(c => c.mat_no) };
              g.shipTos.add(r.shipTo);
              guessed.set(r.part, g);
            }
          }
          if (!hit) {                                   // fallback: จับ base part เฉพาะที่ชัดตัวเดียว (กำกวม = ไม่เดา)
            const bc = baseMap[baseOfPart(r.part)];
            if (bc && bc.length === 1) { hit = bc[0]; baseHits.set(r.part, bc[0].mat_no); }
          }
          if (!hit) unmatched.add(r.part);
          return { ...r, mat_no: hit ? hit.mat_no : r.part, part_name: hit ? hit.name : null };
        });
        setEdi({
          kind: is862 ? 'orders' : 'forecast',
          files: ediFiles.map(f => f.fName),
          records, unmatched: [...unmatched],
          ambiguous: [...guessed.entries()].map(([part, g]) => ({ part, shipTos: [...g.shipTos], mats: g.mats })),
          baseMatched: [...baseHits.entries()].map(([part, mat]) => ({ part, mat })),
          shipTos: [...new Set(records.map(r => r.shipTo))].sort(),
          dateFrom: records.reduce((a, r) => (a < r.date ? a : r.date), records[0].date),
          dateTo: records.reduce((a, r) => (a > r.date ? a : r.date), records[0].date),
        });
        setHeaders([]); setRows([]); setFileName('');
        toast.success(`📡 ตรวจพบ EDI ${is862 ? '862 (Shipping Schedule)' : '830 (Forecast)'} — ${records.length} รายการจาก ${ediFiles.length} ไฟล์`);
        return;
      }
      if (!manual) { toast.error('อ่านไฟล์ไม่สำเร็จ'); return; }
      setEdi(null);
      parseManual(XLSX, manual.wb, manual.name, kindNow);
    } catch (err) { toast.error('อ่านไฟล์ไม่สำเร็จ: ' + err.message); }
  };

  const parseManual = (XLSX, wb, fName, kindNow) => {
    try {
      const ws = wb.Sheets[wb.SheetNames[0]];
      const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
      // หัวตาราง = แถวแรกที่มีข้อมูล ≥ 2 ช่อง
      const hIdx = matrix.findIndex(r => r.filter(c => String(c).trim() !== '').length >= 2);
      if (hIdx < 0) { toast.error('ไม่พบหัวตารางในไฟล์'); return; }
      const hd = matrix[hIdx].map((text, idx) => ({ idx, text: String(text).trim() }));
      const dataRows = matrix.slice(hIdx + 1).filter(r => r.some(c => String(c).trim() !== ''));
      setFileName(fName);
      setHeaders(hd);
      setRows(dataRows);
      // auto-guess mapping จากชื่อหัวคอลัมน์
      const map = {};
      FIELD_DEFS[kindNow].forEach(f => {
        const hit = hd.find(h => h.text && f.guess.test(h.text));
        map[f.key] = hit ? hit.idx : -1;
      });
      setMapping(map);
      // forecast แบบ wide: หัวคอลัมน์ที่ parse เป็นเดือนได้ (เช่น Jan-26, 2026-07) → คอลัมน์ละเดือน
      const mc = hd
        .map(h => ({ idx: h.idx, d: parseDateCell(h.text) }))
        .filter(x => x.d && x.idx !== map.mat_no && x.idx !== map.part_name && x.idx !== map.customer)
        .map(x => ({ idx: x.idx, month: monthFirst(x.d), label: hd[x.idx].text }));
      setMonthCols(mc);
      setWideMode(kindNow === 'forecast' && mc.length >= 2);
      toast.info(`อ่านไฟล์แล้ว ${dataRows.length} แถว — ตรวจ mapping แล้วกดนำเข้า`);
    } catch (err) { toast.error('อ่านไฟล์ไม่สำเร็จ: ' + err.message); }
  };

  const buildRecords = () => {
    const out = [];
    let skipped = 0;
    const get = (r, key) => mapping[key] >= 0 ? r[mapping[key]] : '';
    rows.forEach(r => {
      const mat = String(get(r, 'mat_no') ?? '').trim();
      if (!mat) { skipped++; return; }
      const base = {
        mat_no: mat,
        part_name: String(get(r, 'part_name') ?? '').trim() || null,
        customer: String(get(r, 'customer') ?? '').trim() || null,
      };
      if (kind === 'forecast') {
        if (wideMode) {
          monthCols.forEach(mc => {
            const q = numCell(r[mc.idx]);
            if (q > 0) out.push({ ...base, period_month: mc.month, qty: q });
          });
        } else {
          const d = parseDateCell(get(r, 'period'));
          const q = numCell(get(r, 'qty'));
          if (!d || q <= 0) { skipped++; return; }
          out.push({ ...base, period_month: monthFirst(d), qty: q });
        }
      } else {
        const d = parseDateCell(get(r, 'due_date'));
        const q = numCell(get(r, 'qty'));
        if (!d || q <= 0) { skipped++; return; }
        out.push({
          ...base,
          order_no: String(get(r, 'order_no') ?? '').trim() || null,
          qty: q, due_date: dateStr(d),
          ship_time: parseTimeCell(get(r, 'ship_time')),
        });
      }
    });
    return { records: out, skipped };
  };

  const doImport = async () => {
    if (mapping.mat_no < 0) { toast.error('ต้อง map คอลัมน์ MAT No. ก่อน'); return; }
    if (kind === 'orders' && (mapping.due_date < 0 || mapping.qty < 0)) { toast.error('Order ต้อง map จำนวน และ วันที่ส่ง'); return; }
    if (kind === 'forecast' && !wideMode && (mapping.period < 0 || mapping.qty < 0)) { toast.error('Forecast ต้อง map เดือน และ จำนวน (หรือใช้โหมดหลายคอลัมน์เดือน)'); return; }
    const { records, skipped } = buildRecords();
    if (!records.length) { toast.error('ไม่มีแถวที่นำเข้าได้ — ตรวจ mapping อีกครั้ง'); return; }
    // กันนับซ้ำ: manual import เป็นการ "เพิ่มทับ" ไม่ใช่แทนที่ — ถ้ามีไฟล์ประเภทเดียวกันอยู่แล้ว เตือนก่อน
    const sameKind = batches.filter(b => b.kind === kind);
    if (sameKind.length && !window.confirm(
      `มีไฟล์ ${kind === 'forecast' ? 'Forecast' : 'Orders'} นำเข้าไว้แล้ว ${sameKind.length} ไฟล์\n` +
      `การนำเข้านี้จะ "เพิ่มทับ" ยอดเดิม (ไม่ได้แทนที่) — ถ้าเป็นไฟล์แก้ไข ให้ลบไฟล์เดิมก่อน\nยืนยันนำเข้าเพิ่ม?`)) return;
    setSaving(true);
    try {
      const { data: batch, error: e1 } = await supabaseDR.from('demand_upload_batches')
        .insert({ kind, file_name: fileName, row_count: records.length, uploaded_by: fullName || 'Sales' })
        .select().single();
      if (e1) throw e1;
      const table = kind === 'forecast' ? 'customer_forecasts' : 'customer_shipping_orders';
      for (let i = 0; i < records.length; i += 500) {
        const { error: e2 } = await supabaseDR.from(table).insert(records.slice(i, i + 500).map(x => ({ source: 'manual', ...x, batch_id: batch.id })));
        if (e2) throw e2;
      }
      toast.success(`✅ นำเข้า ${records.length} แถวสำเร็จ${skipped ? ` (ข้าม ${skipped} แถวที่ข้อมูลไม่ครบ)` : ''}`);
      setHeaders([]); setRows([]); setFileName('');
      await loadBatches();
      onImported?.();
    } catch (err) { toast.error(err.message); }
    setSaving(false);
  };

  // นำเข้า EDI: ฉบับล่าสุดแทนที่ฉบับเดิมของ ship-to เดียวกัน (sale อัพโหลดใหม่ทุกวัน ไม่ให้ยอดทบซ้ำ)
  const doImportEdi = async () => {
    if (!edi) return;
    setSaving(true);
    try {
      const { data: batch, error: e1 } = await supabaseDR.from('demand_upload_batches')
        .insert({ kind: edi.kind, file_name: `EDI ${edi.kind === 'orders' ? '862' : '830'} × ${edi.files.length} ไฟล์ (${edi.shipTos.join(',')})`, row_count: edi.records.length, uploaded_by: fullName || 'Sales' })
        .select().single();
      if (e1) throw e1;
      // code ปลายทางใหม่ที่ยังไม่อยู่ใน config → เพิ่มให้อัตโนมัติ (ชื่อตั้งต้น = code รอทีมตั้งชื่อลูกค้า)
      await supabaseDR.from('ship_to_plants')
        .upsert(edi.shipTos.map(c => ({ code: c, customer_name: c })), { onConflict: 'code', ignoreDuplicates: true });
      if (edi.kind === 'forecast') {
        // ลบ forecast เดิม "เฉพาะช่วงเดือนที่ไฟล์นี้ครอบคลุม" ไม่ใช่ลบทั้งหมด —
        // เดิมลบ edi_830 ทุกเดือน ถ้าไฟล์ใหม่ horizon สั้นกว่า เดือนที่เลยช่วงจะหายถาวร (bounded เหมือน path 862)
        const months = edi.records.map(r => r.date).filter(Boolean);
        let delQ = supabaseDR.from('customer_forecasts').delete().eq('source', 'edi_830').in('customer', edi.shipTos);
        if (months.length) {
          const minM = months.reduce((a, b) => (a < b ? a : b));
          const maxM = months.reduce((a, b) => (a > b ? a : b));
          delQ = delQ.gte('period_month', minM).lte('period_month', maxM);
        }
        const { error: eDel } = await delQ;
        if (eDel) throw eDel;
        const recs = edi.records.map(r => ({
          batch_id: batch.id, customer: r.shipTo, mat_no: r.mat_no, part_name: r.part_name,
          customer_part_no: r.part, period_month: r.date, qty: r.qty, source: 'edi_830',
        }));
        for (let i = 0; i < recs.length; i += 500) {
          const { error } = await supabaseDR.from('customer_forecasts').insert(recs.slice(i, i + 500));
          if (error) throw error;
        }
      } else {
        /* เก็บใบที่เตรียม/ส่งไปแล้ว — ลบเฉพาะ pending จาก EDI ในช่วง horizon แล้วลงฉบับใหม่
           (ไม่ insert ซ้ำ slot ที่ทำไปแล้ว)

           ⚠️ กฎเหล็ก — **ห้ามลบออเดอร์ที่วันส่งผ่านไปแล้ว** (2026-08-19 · คำสั่ง user "ของเดิมไม่หายทำได้มั้ย")
           EDI 862 คือการ *แก้ไขคำสั่งซื้อในอนาคต* — รายการของวันที่ผ่านไปแล้วเป็น **ข้อเท็จจริงย้อนหลัง**
           (ลูกค้าเคยสั่งเท่านี้จริง) ลบทิ้งแล้วจะตอบไม่ได้ตลอดกาลว่า "ที่ผ่านมาผลิตพอกับที่ลูกค้าสั่งไหม"
           เดิมตัดที่ `edi.dateFrom` = วันแรกที่มีในไฟล์ → ไฟล์ที่พ่วงรายการวันเก่ามาด้วย (EDI ทำประจำ)
           จะลบประวัติทับแบบเงียบๆ · ตัดที่ max(dateFrom, วันงานปัจจุบัน) แทน
           ผลข้างเคียงที่ตั้งใจ: ใบค้างส่งของวันเก่าไม่ถูกล้างโดยการอัพไฟล์ — ต้องเคลียร์ที่หน้า Delivery
           (ซึ่งถูกแล้ว: ของที่ยังไม่ส่งและลูกค้าไม่ได้ยกเลิก คือคำถามที่ยังค้างอยู่จริง) */
        const wd = workDateStr();
        const delFrom = edi.dateFrom > wd ? edi.dateFrom : wd;
        const { data: keepRows } = await supabaseDR.from('customer_shipping_orders')
          .select('customer, customer_part_no, mat_no, due_date, ship_time, status')
          .in('customer', edi.shipTos).gte('due_date', delFrom).neq('status', 'pending');
        const keepKeys = new Set((keepRows || []).map(k => `${k.customer}|${k.customer_part_no || k.mat_no}|${k.due_date}|${(k.ship_time || '').slice(0, 5)}`));
        /* ⚠️ ต้องมีขอบบน .lte(dateTo) ด้วย (semantics เดียวกับ path 830) — ไฟล์ horizon สั้น
           จะลบ pending อนาคตที่เกินช่วงไฟล์ทิ้งถาวรโดยไม่มีอะไร insert คืน (QC flow-audit D1) */
        const { error: eDel } = await supabaseDR.from('customer_shipping_orders').delete()
          .eq('source', 'edi_862').eq('status', 'pending').in('customer', edi.shipTos)
          .gte('due_date', delFrom).lte('due_date', edi.dateTo);
        if (eDel) throw eDel;
        /* รายการวันเก่าที่อยู่ในไฟล์ ไม่ต้อง insert ซ้ำ (ของเดิมยังอยู่) — ไม่งั้นยอดทบซ้อนกัน */
        const pastKeys = new Set();
        if (edi.dateFrom < delFrom) {
          const { data: pastRows } = await supabaseDR.from('customer_shipping_orders')
            .select('customer, customer_part_no, mat_no, due_date, ship_time')
            .in('customer', edi.shipTos).gte('due_date', edi.dateFrom).lt('due_date', delFrom);
          (pastRows || []).forEach(k => pastKeys.add(`${k.customer}|${k.customer_part_no || k.mat_no}|${k.due_date}|${(k.ship_time || '').slice(0, 5)}`));
        }
        const recs = edi.records
          .filter(r => !keepKeys.has(`${r.shipTo}|${r.part}|${r.date}|${r.time || ''}`)
            && !pastKeys.has(`${r.shipTo}|${r.part}|${r.date}|${r.time || ''}`))
          .map(r => ({
            batch_id: batch.id, order_no: r.po || null, customer: r.shipTo, mat_no: r.mat_no, part_name: r.part_name,
            customer_part_no: r.part, qty: r.qty, due_date: r.date, ship_time: r.time, dock_code: r.dock || null, source: 'edi_862',
          }));
        for (let i = 0; i < recs.length; i += 500) {
          const { error } = await supabaseDR.from('customer_shipping_orders').insert(recs.slice(i, i + 500));
          if (error) throw error;
        }
      }
      toast.success(`✅ นำเข้า EDI ${edi.records.length} รายการ — แทนที่ฉบับเดิมของ ${edi.shipTos.join(', ')} แล้ว`);
      // แจ้งห้อง Smart Logistic (best-effort — พังก็ไม่กระทบการนำเข้า)
      supabase.functions.invoke('send-notification', {
        body: { event: 'edi_import', edi: {
          kind: edi.kind, ship_tos: edi.shipTos.join(', '), rows: edi.records.length, files: edi.files.length,
          date_from: edi.dateFrom, date_to: edi.dateTo, unmatched: edi.unmatched.length, uploaded_by: fullName || 'Sales',
        } },
      }).catch(() => {});
      setEdi(null);
      await loadBatches();
      onImported?.();
    } catch (err) { toast.error(err.message); }
    setSaving(false);
  };

  const deleteBatch = async (b) => {
    /* ⚠️ batch_id เป็น FK on delete cascade — ลบ batch = ลบทุกใบที่ยังถืออยู่
       ใบ shipped (ข้อเท็จจริงย้อนหลัง + จุดยึด ref_shipment_id ของแถวตัดสต็อก) และใบค้างส่งวันเก่า
       ห้ามหายไปกับปุ่มลบไฟล์ — กฎเหล็ก "ห้ามลบออเดอร์ที่วันส่งผ่านไปแล้ว" (QC flow-audit D1)
       → detach ใบประวัติออกจาก batch ก่อน (batch_id = null) แล้วค่อยลบ ให้ cascade โดนเฉพาะ pending อนาคต */
    if (!window.confirm(`ลบชุดข้อมูล "${b.file_name}" (${b.row_count} แถว)? ข้อมูลที่นำเข้าจากไฟล์นี้จะถูกลบทั้งหมด`)) return;
    if (b.kind === 'orders') {
      const wd = workDateStr();
      const { data: hist, error: eH } = await supabaseDR.from('customer_shipping_orders')
        .select('id, status, due_date').eq('batch_id', b.id)
        .or(`status.neq.pending,due_date.lt.${wd}`);
      if (eH) { toast.error(eH.message); return; }
      if (hist?.length) {
        const shipped = hist.filter(h => h.status !== 'pending').length;
        if (!window.confirm(
          `ไฟล์นี้มีใบที่เป็น "ประวัติ" ${hist.length} ใบ (เริ่ม workflow/ส่งแล้ว ${shipped} · วันส่งผ่านมาแล้ว ${hist.length - shipped})\n` +
          `ใบพวกนี้จะถูก "เก็บไว้" (ไม่ลบ) — ลบเฉพาะใบ pending ในอนาคตของไฟล์นี้\nยืนยัน?`)) return;
        const { error: eDet } = await supabaseDR.from('customer_shipping_orders')
          .update({ batch_id: null }).in('id', hist.map(h => h.id));
        if (eDet) { toast.error('แยกใบประวัติออกจากไฟล์ไม่สำเร็จ — ยกเลิกการลบ: ' + eDet.message); return; }
      }
    }
    const { error } = await supabaseDR.from('demand_upload_batches').delete().eq('id', b.id);
    if (error) { toast.error(error.message); return; }
    toast.success('ลบชุดข้อมูลแล้ว');
    await loadBatches();
    onImported?.();
  };

  const fields = FIELD_DEFS[kind].filter(f => !(kind === 'forecast' && wideMode && (f.key === 'period' || f.key === 'qty')));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {!canUpload && (
        <div style={{ ...card, borderColor: 'rgba(245,158,11,0.4)', fontSize: 13, color: '#f59e0b' }}>
          👁 โหมดดูอย่างเดียว — การอัพโหลดทำได้เฉพาะ role: Sale / Manager / Admin
        </div>
      )}
      {canUpload && (
        <div style={card}>
          <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--text)', marginBottom: 12, fontFamily: 'var(--font-display)' }}>📤 อัพโหลดไฟล์จากลูกค้า</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {[{ k: 'forecast', label: '📈 Forecast ล่วงหน้า' }, { k: 'orders', label: '🚚 Order + รอบส่งงาน' }].map(t => (
              <button key={t.k} onClick={() => { setKind(t.k); setHeaders([]); setRows([]); setFileName(''); }} style={btn(kind === t.k)}>{t.label}</button>
            ))}
            <label style={{ ...btn(false), display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              📂 เลือกไฟล์ Excel/CSV (เลือกหลายไฟล์ได้)
              <input type="file" accept=".xlsx,.xls,.csv" multiple style={{ display: 'none' }}
                onChange={e => { handleFiles(e.target.files, kind); e.target.value = ''; }} />
            </label>
            {fileName && <span style={{ alignSelf: 'center', fontSize: 12, color: 'var(--muted)' }}>📄 {fileName} · {rows.length} แถว</span>}
          </div>

          {edi && (
            <div style={{ border: '1px solid rgba(77,159,255,0.35)', background: 'rgba(77,159,255,0.05)', borderRadius: 10, padding: 14, marginBottom: 4 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#4d9fff', marginBottom: 8 }}>
                📡 EDI {edi.kind === 'orders' ? '862 — Shipping Schedule (รอบส่งงาน)' : '830 — Planning Forecast'}
              </div>
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: 'var(--text2)', marginBottom: 8 }}>
                <span>📄 {edi.files.length} ไฟล์</span>
                <span>🏭 Ship-to: <strong>{edi.shipTos.map(c => custLabel ? custLabel(c) : c).join(', ')}</strong></span>
                <span>📅 {edi.dateFrom} → {edi.dateTo}</span>
                <span>🧾 {edi.records.length} รายการ</span>
                <span style={{ color: edi.unmatched.length ? '#f59e0b' : '#22c55e' }}>
                  🔗 จับคู่พาร์ทได้ {edi.records.length - edi.records.filter(r => edi.unmatched.includes(r.part)).length}/{edi.records.length}
                </span>
              </div>
              {edi.unmatched.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b', marginBottom: 4 }}>
                    ⚠️ Part No. ที่ยังจับคู่ mat_no ภายในไม่ได้ (จะบันทึกด้วยเลขพาร์ทลูกค้าไปก่อน — เพิ่ม P/N ที่ Product Master แล้วอัพใหม่ได้):
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {edi.unmatched.map(pn => (
                      <span key={pn} style={{ fontSize: 11, fontWeight: 700, fontFamily: 'monospace', padding: '2px 8px', borderRadius: 8, background: 'rgba(245,158,11,0.12)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.3)' }}>{pn}</span>
                    ))}
                  </div>
                </div>
              )}
              {/* เลขพาร์ทลูกค้าเดียวมีหลายเลข SAP (ต่างที่ลูกค้าปลายทาง) แล้วยังแยกไม่ออก
                  → ระบบยังเดาให้เพื่อไม่ให้งานส่งของหยุด แต่ต้องบอกให้ชัดว่าเดา ไม่งั้นออเดอร์ทุกเจ้าไปกองเลขเดียว */}
              {edi.ambiguous?.length > 0 && (
                <div style={{ marginBottom: 10, padding: '8px 10px', borderRadius: 8, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.35)' }}>
                  <div style={{ fontSize: 11.5, fontWeight: 800, color: '#ef4444', marginBottom: 4 }}>
                    🔴 {edi.ambiguous.length} พาร์ท แยกลูกค้าไม่ออก — ออเดอร์ทุกเจ้าจะไปกองที่เลข SAP เดียว
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text2)', lineHeight: 1.6, marginBottom: 5 }}>
                    เลขพาร์ทลูกค้าตัวเดียวมีหลายเลข SAP (ต่างกันที่ลูกค้าปลายทาง) แต่ ship-to ยังไม่ได้ตั้งชื่อลูกค้า
                    → ระบบเลือกตัวแรกให้ก่อน <b>เลขที่เหลือจะดูเหมือนไม่มีใครสั่ง</b> · แก้ที่
                    <b> 🚚 Delivery → ⚙️ Ship-to Plant Config</b> (ตั้งชื่อลูกค้าให้ code เช่น GRBNA → AAT) แล้วอัพไฟล์ใหม่
                  </div>
                  {edi.ambiguous.slice(0, 6).map(a => (
                    <div key={a.part} style={{ fontSize: 10.5, fontFamily: 'monospace', color: 'var(--muted)' }}>
                      {a.part} · ship-to {a.shipTos.join(',')} → {a.mats.join(' | ')}
                    </div>
                  ))}
                  {edi.ambiguous.length > 6 && <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>…และอีก {edi.ambiguous.length - 6} พาร์ท</div>}
                </div>
              )}
              {/* จับคู่จาก base part (ตัด revision) = การเดาข้าม rev — ถูกเกือบเสมอ แต่เคส EC ออกเลขใหม่
                  จะพา demand เข้าเลขเก่าเงียบๆ → ต้องโชว์ให้คนกวาดตาก่อนกดยืนยัน (ระบบเสนอ คนตรวจ) */}
              {edi.baseMatched?.length > 0 && (
                <div style={{ marginBottom: 10, padding: '8px 10px', borderRadius: 8, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.35)' }}>
                  <div style={{ fontSize: 11.5, fontWeight: 800, color: '#f59e0b', marginBottom: 4 }}>
                    💡 {edi.baseMatched.length} พาร์ท จับคู่จาก base part (เลขตรง rev ไม่มีในระบบ) — ตรวจก่อนยืนยัน
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text2)', lineHeight: 1.6, marginBottom: 5 }}>
                    ถ้าเป็นพาร์ทเดิมที่ EDI สะกด rev ต่าง = ถูกต้อง · แต่ถ้าเพิ่งออก EC เป็นเลขใหม่
                    ควรไปตั้ง P/N ของ MAT ใหม่ที่ Product Master ก่อน ไม่งั้น demand จะเข้าเลข rev เก่า
                  </div>
                  {edi.baseMatched.slice(0, 6).map(b => (
                    <div key={b.part} style={{ fontSize: 10.5, fontFamily: 'monospace', color: 'var(--muted)' }}>{b.part} → {b.mat}</div>
                  ))}
                  {edi.baseMatched.length > 6 && <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>…และอีก {edi.baseMatched.length - 6} พาร์ท</div>}
                </div>
              )}
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10 }}>
                การนำเข้าจะ<strong>แทนที่</strong>ข้อมูล EDI ฉบับเดิมของ ship-to เดียวกัน (อัพใหม่ทุกวันได้ ยอดไม่ทบซ้ำ)
                {edi.kind === 'orders' ? ' · รอบที่เตรียม/ส่งไปแล้วจะไม่ถูกแตะ' : ''}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={doImportEdi} disabled={saving}
                  style={{ padding: '9px 22px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#08130a', fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'var(--font-body)', opacity: saving ? 0.6 : 1 }}>
                  {saving ? 'กำลังนำเข้า...' : '⬆ ยืนยันนำเข้า EDI'}
                </button>
                <button onClick={() => setEdi(null)} style={{ ...btn(false) }}>ยกเลิก</button>
              </div>
            </div>
          )}
          {headers.length > 0 && (
            <>
              {kind === 'forecast' && monthCols.length >= 2 && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text2)', marginBottom: 10, cursor: 'pointer' }}>
                  <input type="checkbox" checked={wideMode} onChange={e => setWideMode(e.target.checked)} />
                  ไฟล์เป็นแบบ "เดือนละคอลัมน์" — พบคอลัมน์เดือน {monthCols.length} เดือน ({monthCols.slice(0, 4).map(m => m.label).join(', ')}{monthCols.length > 4 ? ' …' : ''})
                </label>
              )}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                {fields.map(f => (
                  <div key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>{f.label}</span>
                    <select value={mapping[f.key] ?? -1} onChange={e => setMapping(m => ({ ...m, [f.key]: Number(e.target.value) }))} style={{ ...inputSt, minWidth: 140 }}>
                      <option value={-1}>— ไม่ใช้ —</option>
                      {headers.map(h => <option key={h.idx} value={h.idx}>{h.text || `(คอลัมน์ ${h.idx + 1})`}</option>)}
                    </select>
                  </div>
                ))}
              </div>
              {/* preview 5 แถวแรก */}
              <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8, marginBottom: 12 }}>
                <table style={{ borderCollapse: 'collapse', fontSize: 11, minWidth: 500 }}>
                  <thead><tr style={{ background: 'var(--bg2)' }}>
                    {headers.map(h => <th key={h.idx} style={{ padding: '6px 10px', color: 'var(--muted)', textAlign: 'left', whiteSpace: 'nowrap' }}>{h.text || `(${h.idx + 1})`}</th>)}
                  </tr></thead>
                  <tbody>
                    {rows.slice(0, 5).map((r, i) => (
                      <tr key={i}>
                        {headers.map(h => <td key={h.idx} style={{ padding: '5px 10px', borderTop: '1px solid var(--border)', color: 'var(--text2)', whiteSpace: 'nowrap' }}>{r[h.idx] instanceof Date ? dateStr(r[h.idx]) : String(r[h.idx] ?? '')}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button onClick={doImport} disabled={saving}
                style={{ padding: '10px 24px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#08130a', fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'var(--font-body)', opacity: saving ? 0.6 : 1 }}>
                {saving ? 'กำลังนำเข้า...' : `⬆ นำเข้าข้อมูล ${kind === 'forecast' ? 'Forecast' : 'Orders'}`}
              </button>
            </>
          )}
        </div>
      )}

      <div style={card}>
        <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--text)', marginBottom: 10, fontFamily: 'var(--font-display)' }}>🗂 ประวัติการอัพโหลด</div>
        {batches.length === 0 ? <div style={{ fontSize: 12, color: 'var(--muted)' }}>ยังไม่มีการอัพโหลด</div> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {batches.map(b => (
              <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--bg2)', borderRadius: 8, border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 12, color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {b.kind === 'forecast' ? '📈' : '🚚'} <strong>{b.file_name || '(ไม่มีชื่อไฟล์)'}</strong>
                  <span style={{ color: 'var(--muted)' }}> · {b.row_count} แถว · {b.uploaded_by} · {new Date(b.uploaded_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}</span>
                </div>
                {canUpload && (
                  <button onClick={() => deleteBatch(b)} style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)', flexShrink: 0, fontFamily: 'var(--font-body)' }}>🗑 ลบ</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Forecast Planner Tab ────────────────────────────────────────────────── */
function PlannerTab({ refreshKey, custLabel }) {
  const [horizon, setHorizon] = useState(3);          // จำนวนเดือนล่วงหน้า
  const [forecasts, setForecasts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [ctByMat, setCtByMat] = useState({});
  const [focusMonth, setFocusMonth] = useState(() => monthFirst(new Date()));

  const months = useMemo(() => {
    const now = new Date();
    return Array.from({ length: horizon }, (_, i) => monthFirst(new Date(now.getFullYear(), now.getMonth() + i, 1)));
  }, [horizon]);

  useEffect(() => {
    (async () => {
      const from = months[0];
      const toD = new Date(months[months.length - 1]);
      const to = monthFirst(new Date(toD.getFullYear(), toD.getMonth() + 1, 1));
      // แบ่งหน้า — forecast มี ~1,463 แถวถึง ส.ค. 2027 · ช่วง 12 เดือนทะลุเพดาน 1000 แถวแล้วตัดเงียบ (QC flow-audit D1)
      const [{ rows: fc }, { rows: od }] = await Promise.all([
        fetchAllPages(() => supabaseDR.from('customer_forecasts').select('*').gte('period_month', from).lt('period_month', to)),
        fetchAllPages(() => supabaseDR.from('customer_shipping_orders').select('*').gte('due_date', from).lt('due_date', to)),
      ]);
      // dedupe ข้าม source (edi ชนะ manual ต่อ mat×เดือน) — มาตรฐานเดียวกับแท็บ 🎴 (fBySrc เดิม)
      setForecasts(dedupeForecastRows(fc || []));
      setOrders(od || []);
      const mats = [...new Set([...(fc || []), ...(od || [])].map(x => x.mat_no))];
      if (mats.length) {
        const { data: prods } = await supabaseDR.from('dr_products').select('mat_no, cycle_time_sec').in('mat_no', mats);
        const m = {};
        (prods || []).forEach(p => { m[p.mat_no] = p.cycle_time_sec || 0; });
        setCtByMat(m);
      } else setCtByMat({});
    })();
  }, [months, refreshKey]);

  const chartData = useMemo(() => months.map(m => {
    // period_month อาจเป็นรายเดือน (manual) หรือรายสัปดาห์ (EDI 830) — รวมด้วยเดือนเดียวกัน
    const fq = forecasts.filter(f => (f.period_month || '').slice(0, 7) === m.slice(0, 7)).reduce((s, f) => s + Number(f.qty), 0);
    const oq = orders.filter(o => (o.due_date || '').slice(0, 7) === m.slice(0, 7)).reduce((s, o) => s + Number(o.qty), 0);
    return { month: monthLabel(m), Forecast: fq, Orders: oq };
  }), [months, forecasts, orders]);

  // ตารางราย mat_no ของเดือนที่เลือก — forecast vs order จริง + ภาระชั่วโมงผลิต
  const matRows = useMemo(() => {
    const map = {};
    forecasts.filter(f => (f.period_month || '').slice(0, 7) === focusMonth.slice(0, 7)).forEach(f => {
      const r = map[f.mat_no] = map[f.mat_no] || { mat_no: f.mat_no, part_name: f.part_name, customer: f.customer, forecast: 0, ordered: 0 };
      r.forecast += Number(f.qty);
      if (!r.part_name) r.part_name = f.part_name;
    });
    orders.filter(o => (o.due_date || '').slice(0, 7) === focusMonth.slice(0, 7)).forEach(o => {
      const r = map[o.mat_no] = map[o.mat_no] || { mat_no: o.mat_no, part_name: o.part_name, customer: o.customer, forecast: 0, ordered: 0 };
      r.ordered += Number(o.qty);
      if (!r.part_name) r.part_name = o.part_name;
    });
    return Object.values(map).map(r => {
      const ct = ctByMat[r.mat_no] || 0;
      const planQty = Math.max(r.forecast, r.ordered);
      return { ...r, ct, loadHours: ct > 0 ? (planQty * ct) / 3600 : null, coverage: r.forecast > 0 ? (r.ordered / r.forecast) * 100 : null };
    }).sort((a, b) => (b.loadHours || 0) - (a.loadHours || 0) || b.forecast - a.forecast);
  }, [forecasts, orders, focusMonth, ctByMat]);

  const totalLoadHours = matRows.reduce((s, r) => s + (r.loadHours || 0), 0);
  const noCtCount = matRows.filter(r => !r.ct).length;
  // กำลังผลิตหยาบ ๆ: วันทำงาน ~26 วัน/เดือน × (กะเช้า 8.75 + กะดึก 8.75 ชม.) ต่อ 1 ไลน์
  const HOURS_PER_DAY = 17.5;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 700 }}>ช่วงพยากรณ์:</span>
        {[3, 6, 12].map(h => <button key={h} onClick={() => setHorizon(h)} style={btn(horizon === h)}>{h} เดือน</button>)}
      </div>

      {/* กราฟ Forecast vs Orders รายเดือน */}
      <div style={card}>
        <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--text)', marginBottom: 10, fontFamily: 'var(--font-display)' }}>📊 Forecast vs Order จริง (ชิ้น/เดือน)</div>
        {chartData.every(d => !d.Forecast && !d.Orders) ? (
          <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>ยังไม่มีข้อมูลในช่วงนี้ — อัพโหลดที่แท็บ 📤 อัพโหลด</div>
        ) : (
          <div style={{ width: '100%', height: 260 }}>
            <ResponsiveContainer>
              <BarChart data={chartData} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                <Tooltip contentStyle={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 8, fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Forecast" fill="#4d9fff" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Orders" fill="#22c55e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* ตารางราย mat_no ต่อเดือน + ภาระการผลิต */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
          <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--text)', fontFamily: 'var(--font-display)' }}>🧠 แผนภาระการผลิตรายพาร์ท</div>
          <select value={focusMonth} onChange={e => setFocusMonth(e.target.value)} style={{ ...inputSt, width: 170 }}>
            {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          {[
            { label: 'พาร์ทที่มี demand', value: matRows.length, icon: '🔩' },
            { label: 'ภาระรวม (ชม.เครื่อง)', value: fmt(totalLoadHours), icon: '⏱' },
            { label: `≈ วันผลิต (${HOURS_PER_DAY} ชม./วัน/ไลน์)`, value: fmt(totalLoadHours / HOURS_PER_DAY), icon: '📅' },
            ...(noCtCount ? [{ label: 'พาร์ทไม่มี cycle time', value: noCtCount, icon: '⚠️', warn: true }] : []),
          ].map(c => (
            <div key={c.label} style={{ flex: '1 1 150px', background: 'var(--bg2)', border: `1px solid ${c.warn ? 'rgba(245,158,11,0.4)' : 'var(--border)'}`, borderRadius: 8, padding: '8px 12px' }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>{c.icon} {c.label}</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: c.warn ? '#f59e0b' : 'var(--text)', fontFamily: 'var(--font-display)' }}>{c.value}</div>
            </div>
          ))}
        </div>
        {matRows.length === 0 ? <div style={{ fontSize: 12, color: 'var(--muted)' }}>ไม่มีข้อมูลเดือนนี้</div> : (
          <div className="table-sticky" style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
              <thead><tr style={{ background: 'var(--bg2)' }}>
                {['พาร์ท', 'ลูกค้า', 'Forecast', 'Order จริง', 'Coverage', 'ภาระ (ชม.)'].map(h => (
                  <th key={h} style={{ padding: '8px 12px', fontSize: 11, fontWeight: 800, color: 'var(--muted)', textAlign: h === 'พาร์ท' || h === 'ลูกค้า' ? 'left' : 'right' }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {matRows.map(r => (
                  <tr key={r.mat_no}>
                    <td style={{ padding: '7px 12px', borderTop: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 12, fontWeight: 700, fontFamily: 'monospace', color: '#0ea5e9' }}>{r.mat_no}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.part_name || ''}</div>
                    </td>
                    <td style={{ padding: '7px 12px', borderTop: '1px solid var(--border)', fontSize: 12, color: 'var(--text2)' }}>{r.customer ? (custLabel ? custLabel(r.customer) : r.customer) : '—'}</td>
                    <td style={{ padding: '7px 12px', borderTop: '1px solid var(--border)', fontSize: 13, fontWeight: 700, textAlign: 'right', color: '#4d9fff' }}>{fmt(r.forecast)}</td>
                    <td style={{ padding: '7px 12px', borderTop: '1px solid var(--border)', fontSize: 13, fontWeight: 700, textAlign: 'right', color: '#22c55e' }}>{fmt(r.ordered)}</td>
                    <td style={{ padding: '7px 12px', borderTop: '1px solid var(--border)', fontSize: 12, fontWeight: 800, textAlign: 'right', color: r.coverage == null ? 'var(--muted)' : r.coverage > 110 ? '#ef4444' : r.coverage >= 80 ? '#22c55e' : '#f59e0b' }}>
                      {r.coverage == null ? '—' : `${fmt(r.coverage)}%`}
                    </td>
                    <td style={{ padding: '7px 12px', borderTop: '1px solid var(--border)', fontSize: 12, fontWeight: 700, textAlign: 'right', color: r.loadHours == null ? '#f59e0b' : 'var(--text)' }}>
                      {r.loadHours == null ? 'ไม่มี CT' : fmt(r.loadHours)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10 }}>
          Coverage = Order จริง ÷ Forecast · เกิน 110% (แดง) = ลูกค้าสั่งเกินที่พยากรณ์ ควรเช็คกำลังผลิต · ต่ำกว่า 80% (เหลือง) = order ยังมาไม่ครบตาม forecast
        </div>
      </div>
    </div>
  );
}

/* ─── Page ────────────────────────────────────────────────────────────────── */
/* ─── คำนวณ Kanban อัตโนมัติจาก Forecast (Type A — Withdrawal/FG store) ─────── */
const numInput = { ...inputSt, width: 62, padding: '5px 6px', fontSize: 12, textAlign: 'center' };
const tdc = { padding: '6px 8px', borderTop: '1px solid var(--border)', fontSize: 12.5, fontVariantNumeric: 'tabular-nums' };

/* นับวันทำงานของเดือนจากปฏิทินบริษัท: วันธรรมดา (จ-ศ) − วันหยุด + วันเสาร์/อาทิตย์ที่มาร์ค working
   (company_calendar เก็บเฉพาะวันพิเศษ ไม่ครบเดือน — วันปกติจึงอนุมานเป็นวันธรรมดา) */
// baseOfPart ย้ายไป src/utils/matResolve.js แล้ว (ใช้ร่วมกับโมดูล Fixture Shim — ห้ามนิยามซ้ำ)

/* วันทำงาน/เดือน → ใช้ countWorkingDaysInMonth (utils/companyCalendar) ที่เดียว
   (QC audit 2026-08-20 · รอบ 5: เดิมไฟล์นี้ถือสูตรของตัวเองซ้ำกับ util กลาง — ความหมายเท่ากัน
   แต่เป็น 2 ที่ที่ drift กันได้ทุกครั้งที่มีคนแก้ฝั่งเดียว) */

/* ⚠️ กฎเหล็ก — `kanban_standards.lot_size` เก็บเป็น **ชิ้น** ทุกฝั่งที่อ่านตีความเป็นชิ้นหมด:
     fn_explode_child_demand (สะสม demand เป็นชิ้นแล้วเทียบตรงๆ) · ProductMaster (ป้ายเขียน "ชิ้น")
     · FlowTower (suggested_lot = 1 กล่อง) · Heijunka (pending_qty ÷ lot) · VSM · RoutingPanel
   แต่ param "Lot" ของแท็บ Withdrawal เป็น **ใบ** (สูตร Total(K/B) = Max + Lot บวกกับจำนวนใบ)
   → ต้องคูณ Pkg ก่อนเขียน ไม่งั้น 1 ใบ (= 1 กล่อง) กลายเป็น 1 ชิ้น
   เคสจริง 4/8/2026: 50031601 กล่องละ 100 ถูกเขียน lot_size=1 → ปิดใบผลิตใบเดียวออกใบสั่งซื้อ 984 ใบ
   ⇒ ค่าที่จะเขียนต้องมาจากฟังก์ชันนี้ที่เดียว (ตาราง/Preview/Apply อ่านตัวเดียวกัน ห้ามคำนวณซ้ำ) */
const lotPcsOf = (calcType, pp) => (calcType === 'production'
  ? Number(pp.lot_qty) || 0                                      // production กรอกเป็นชิ้นอยู่แล้ว (Info LT = lot × CT)
  : (Number(pp.lot_size) || 0) * (Number(pp.packaging) || 0));   // withdrawal: ใบ × ชิ้น/กล่อง

function KanbanCalcTab({ canApply, fullName, custLabel }) {
  const [settings, setSettings] = useState({ working_days: 20, efficiency_pct: 80, hours_per_day: 16 });
  const [calcType, setCalcType] = useState('withdrawal');   // 'withdrawal' (เบิกถอน FG) | 'production' (ผลิต press)
  const [params, setParams]     = useState({});   // mat_no → param row
  const [forecast, setForecast] = useState({});   // mat_no → order/month
  const [ksMap, setKsMap]       = useState({});   // mat_no → kanban_standards ปัจจุบัน
  const [pmMap, setPmMap]       = useState({});   // mat_no → { part_name, qty_per_pkg }
  const [drMap, setDrMap]       = useState({});   // mat_no → { cycle_time_sec, customer, line_name, name }
  const [month, setMonth]       = useState(nextMonthKey());
  const [lineFilter, setLineFilter] = useState('');
  const [edits, setEdits]       = useState({});   // mat_no → {field:value} override ชั่วคราว
  const [loading, setLoading]   = useState(false);
  const [preview, setPreview]   = useState(null);  // [{mat_no, ...}] ก่อน apply
  const [applying, setApplying] = useState(false);
  const [mapModal, setMapModal] = useState(false); // จับคู่เลขพาร์ทลูกค้า → เลข SAP ภายใน
  const [mapSel, setMapSel]     = useState({});    // customerPart → sap ที่เลือก
  const [mapping, setMapping]   = useState(false);
  const [oeeByLine, setOeeByLine] = useState({});   // ไลน์ → { oee, n } จากกะที่ปิดแล้ว 90 วัน

  const monthRange = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    const start = `${month}-01`;
    const end = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`;
    return { start, end };
  }, [month]);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: st }, { data: pr }, { data: ks }, { data: pm }, { data: dr }, { data: fc }] = await Promise.all([
      supabaseDR.from('kanban_calc_settings').select('*').eq('id', 'default').maybeSingle(),
      supabaseDR.from('kanban_calc_params').select('*'),
      supabaseDR.from('kanban_standards').select('mat_no, part_name, customer, qty_per_kanban, min_qty, max_qty, lot_size, total_kanban').eq('is_active', true),
      supabaseDR.from('parts_master').select('mat_no, part_name, qty_per_pkg').eq('is_active', true),
      supabaseDR.from('dr_products').select('mat_no, cycle_time_sec, customer, line_name, name, p_no, process_type').eq('is_active', true),
      supabaseDR.from('customer_forecasts').select('mat_no, qty, source').gte('period_month', monthRange.start).lt('period_month', monthRange.end),
      loadCompanyCalendar(),   // ปฏิทินบริษัท (cache กลาง) — ใช้คิดวันทำงานผ่าน util เดียวกันทั้งระบบ
    ]);
    /* CAP/ชม. ที่กรอกเป็น "กำลังทางทฤษฎี" (3600 ÷ CT) — ไลน์จริงไม่มีทางเดินได้เท่านั้นทั้งกะ
       → ดึง OEE ของกะที่ปิดแล้ว 90 วัน มาเทียบให้เห็นว่า "จริงๆ ออกกี่ชิ้น/ชม."
       ⚠️ เฉลี่ยด้วย `wavg` + `wLoad` เท่านั้น (กฎ OEE: ห้าม mean-of-percentages)
          ที่นี่ไม่ได้โหลด downtime → `plannedMin` = 0 → wLoad ตกไปถ่วงด้วย shift_min
          ยอมรับได้เพราะเป็น "ตัวเลขให้ดูเทียบ" ไม่ใช่ค่าที่ stamp ที่ไหน */
    // ⚠️ ห้าม toISOString (UTC) กับขอบเขตของ work_date — ช่วง 00:00-06:59 ไทยจะได้ขอบเขตเลื่อน 1 วัน
    //    ทำให้ตัวเลข "CAP จริง" ขยับตามเวลาที่เปิดหน้า · ไฟล์นี้มี dateStr() (local) อยู่แล้ว
    const oeeD = new Date(); oeeD.setDate(oeeD.getDate() - 90);
    const oeeFrom = dateStr(oeeD);
    // แบ่งหน้า — กะปิดแล้ว 90 วันทะลุ 1000 แถวได้ (~130 กะ/สัปดาห์) → OEE บางไลน์ขาดเงียบ
    // แล้วค่า "CAP จริง ~" ที่ planner คลิกใช้จะเพี้ยน (QC flow-audit D1)
    const { rows: sess } = await fetchAllPages(() => supabaseDR.from('production_sessions')
      .select('id, line_name, oee, shift_min').eq('status', 'closed').gte('work_date', oeeFrom).not('oee', 'is', null));
    const byLine = {};
    (sess || []).forEach(s => { if (s.line_name) (byLine[s.line_name] = byLine[s.line_name] || []).push(s); });
    setOeeByLine(Object.fromEntries(Object.entries(byLine)
      .map(([ln, arr]) => [ln, { oee: wavg(arr, s => Number(s.oee), wLoad), n: arr.length }])
      .filter(([, v]) => v.oee != null)));
    // วันทำงานลิงก์ปฏิทินตามเดือนที่เลือก (แก้ทับได้) · efficiency = ค่ากลาง
    const wdCal = countWorkingDaysInMonth(month, 0);
    setSettings({ working_days: wdCal || st?.working_days || 20, efficiency_pct: st ? st.efficiency_pct : 80, hours_per_day: st?.hours_per_day ?? 16 });
    setParams(Object.fromEntries((pr || []).map(r => [r.mat_no, r])));
    setKsMap(Object.fromEntries((ks || []).map(r => [r.mat_no, r])));
    setPmMap(Object.fromEntries((pm || []).map(r => [r.mat_no, r])));
    setDrMap(Object.fromEntries((dr || []).map(r => [r.mat_no, r])));
    // กัน double-count: mat ที่มีทั้ง EDI 830 (รายสัปดาห์) และ manual (รายเดือน) ในเดือนเดียว
    // → ใช้ helper กลาง dedupeForecastRows (edi ชนะ manual ต่อ mat×เดือน) — สูตรเดียวกับทุกจอ (2026-08-25)
    const fmap = {};
    dedupeForecastRows(fc || []).forEach(r => {
      if (!r.mat_no) return;
      fmap[r.mat_no] = (fmap[r.mat_no] || 0) + (Number(r.qty) || 0);
    });
    setForecast(fmap);
    setEdits({});
    setLoading(false);
  }, [monthRange, month]);
  useEffect(() => { load(); }, [load]);

  // ค่าพารามิเตอร์ที่ใช้จริง = edit ชั่วคราว > param ที่บันทึกไว้ > default จาก master/ค่ากลาง
  // firstPos: ตัวแรกที่มีค่าจริง (>0) จาก master หลายแหล่ง — ไม่ต้องกรอกเองถ้ามีในฐานข้อมูล
  const firstPos = (...xs) => { for (const x of xs) { const n = Number(x); if (x != null && x !== '' && n > 0) return x; } return ''; };
  const paramOf = useCallback((mat) => {
    const p = params[mat] || {}, e = edits[mat] || {}, pm = pmMap[mat] || {}, dr = drMap[mat] || {}, ks = ksMap[mat] || {};
    const g = (k, dflt) => e[k] ?? p[k] ?? dflt;
    // PKG (จำนวน/กล่อง) = คุณสมบัติสินค้า → ดึงจาก master: parts_master.qty_per_pkg → kanban_standards.qty_per_kanban
    const pkg = g('packaging', firstPos(pm.qty_per_pkg, ks.qty_per_kanban));
    /* ⚠️ ks.lot_size เก็บเป็น "ชิ้น" (กฎเหล็กที่ lotPcsOf) แต่ param Lot ของแท็บนี้เป็น "ใบ"
       → default ต้องหารด้วย Pkg ก่อน ไม่งั้นล็อต 3,000 ชิ้น กลายเป็น 3,000 ใบ
       (totalKanban เฟ้อ 188 เท่า — QC audit 2026-08-20 · T2-1 ฝั่งอ่าน) · ไม่รู้ Pkg = ไม่เดา */
    const lotPcs = Number(ks.lot_size) || 0;
    const lotCards = lotPcs > 0 && Number(pkg) > 0 ? Math.max(1, Math.ceil(lotPcs / Number(pkg) - 1e-9)) : '';
    return {
      prep_time_min:  g('prep_time_min', 30),
      fluctuation_pct: g('fluctuation_pct', 7),
      packaging:      pkg,
      delivery_cycle: g('delivery_cycle', 1),
      capacity_pc_hr: g('capacity_pc_hr', dr.cycle_time_sec ? Math.round(3600 / dr.cycle_time_sec) : ''),
      lot_size:       g('lot_size', firstPos(lotCards, 1) || 1),
      safety_days:    g('safety_days', 1),
      // production (Type B)
      process_count:  g('process_count', 1),
      lot_qty:        g('lot_qty', ''),
      setup_time_sec: g('setup_time_sec', 0),
    };
  }, [params, edits, pmMap, drMap, ksMap]);

  // แยกพาร์ทตามกระบวนการผลิต (process_type) — PI (สั่งผลิต press) กับ PW (เบิกถอน) ไม่คำนวณพาร์ทร่วมกัน
  //   Production = metal_forming (ปั๊ม/lot — งานปั๊มขายตรงเป็น FG เบอร์ 1 ก็เข้าที่นี่ ไม่ดูเลข MAT)
  //   Withdrawal = welding_assembly + พาร์ทที่ยังไม่ตั้ง process (default) · 'common' = ทั้งสองแท็บ
  const procMatchesTab = useCallback((proc) => {
    const p = proc || '';
    if (p === 'common') return true;
    return calcType === 'production' ? p === 'metal_forming' : p !== 'metal_forming';
  }, [calcType]);

  const rows = useMemo(() => {
    const mats = Object.keys(forecast).filter(m => forecast[m] > 0 && procMatchesTab(drMap[m]?.process_type));
    return mats.map(mat => {
      const pp = paramOf(mat);
      const r = calcType === 'production'
        ? calcProductionKanban({
            orderMonth: forecast[mat], workingDays: settings.working_days, hoursPerDay: settings.hours_per_day,
            packaging: pp.packaging, capacityPcHr: pp.capacity_pc_hr, processCount: pp.process_count,
            lotQty: pp.lot_qty, setupTimeSec: pp.setup_time_sec, safetyDays: pp.safety_days,
          })
        : calcWithdrawalKanban({
            orderMonth: forecast[mat], workingDays: settings.working_days, efficiencyPct: settings.efficiency_pct,
            prepTimeMin: pp.prep_time_min, fluctuationPct: pp.fluctuation_pct, packaging: pp.packaging,
            deliveryCycle: pp.delivery_cycle, capacityPcHr: pp.capacity_pc_hr, lotSize: pp.lot_size, safetyDays: pp.safety_days,
          });
      const dr = drMap[mat] || {}, ks = ksMap[mat] || {};
      const name = pmMap[mat]?.part_name || dr.name || ks.part_name || '';
      const line = dr.line_name || '';
      const changed = r.valid && (Number(ks.max_qty) !== r.maxPcs || Number(ks.min_qty) !== r.minPcs || Number(ks.total_kanban) !== r.totalKanban);
      /* CAP จริง = (3600 ÷ CT) × OEE ของไลน์นั้น — ตรงกับสูตร fallback ของ capacityModel.js
         (แผนผลิตใช้ median ยอดจริงต่อกะ ซึ่งบวก OEE/เบรค/NG ไว้ในตัวแล้ว · ที่นี่คิดจาก CT×OEE
          เพราะ kanban คิดเป็น "ชิ้น/ชม." ไม่ใช่ "ชิ้น/กะ")
         ⚠️ เป็นตัวเลขให้ "เห็นแล้วตัดสินใจ" — ระบบไม่แทนค่าให้เอง (ห้ามเดาแทนคนวางแผน) */
      const lo = oeeByLine[line];
      const capReal = (dr.cycle_time_sec > 0 && lo?.oee > 0)
        ? Math.round((3600 / Number(dr.cycle_time_sec)) * (lo.oee / 100)) : null;
      return { mat, name, line, customer: dr.customer || ks.customer, order: forecast[mat], pp, r, ks, changed,
               capReal, oeePct: lo?.oee ?? null, oeeN: lo?.n ?? 0 };
    }).filter(row => !lineFilter || row.line === lineFilter)
      .sort((a, b) => a.mat.localeCompare(b.mat));
  }, [forecast, settings, paramOf, drMap, ksMap, pmMap, lineFilter, calcType, procMatchesTab, oeeByLine]);

  // พาร์ทที่ CAP ที่กรอกห่างจากกำลังจริง ≥ 20% — ตัวเลข kanban ที่ออกมาจะเพี้ยนตาม
  const capGap = useMemo(() => rows.filter(r => {
    const cur = Number(r.pp.capacity_pc_hr) || 0;
    return r.capReal > 0 && cur > 0 && Math.abs(cur - r.capReal) / r.capReal >= 0.2;
  }), [rows]);

  // นับพาร์ทที่ถูกกรองออกเพราะเป็นอีกกระบวนการ (โปร่งใส — ไม่ปล่อยหายเงียบ)
  const otherProcCount = useMemo(() => Object.keys(forecast)
    .filter(m => forecast[m] > 0 && !procMatchesTab(drMap[m]?.process_type)).length, [forecast, drMap, procMatchesTab]);

  const lines = useMemo(() => [...new Set(rows.map(r => r.line).filter(Boolean))].sort(), [rows]);
  const prodLines = useProductionLines();   // ทะเบียนไลน์ (ให้ dropdown มีลำดับชั้น)
  const changedRows = rows.filter(r => r.changed);

  // (#2) พาร์ทที่ forecast จับคู่เลข SAP ภายในไม่ได้ = ไม่มีใน dr_products/parts_master/kanban_standards เลย
  //      (mat_no เก็บเป็นเลขพาร์ทลูกค้าไปก่อน) → คำนวณ kanban ไม่ได้จนกว่าจะจับคู่ p_no
  const unmapped = useMemo(() => Object.keys(forecast)
    .filter(m => forecast[m] > 0 && !drMap[m] && !pmMap[m] && !ksMap[m])
    .map(m => ({ mat: m, order: forecast[m], part_name: null }))
    .sort((a, b) => b.order - a.order), [forecast, drMap, pmMap, ksMap]);

  // ตัวเลือกเลข SAP ภายในสำหรับจับคู่ (จาก dr_products ที่ active)
  const sapOptions = useMemo(() => Object.entries(drMap)
    .map(([mat, v]) => ({ mat, name: v.name || '', line: v.line_name || '' }))
    .sort((a, b) => a.mat.localeCompare(b.mat)), [drMap]);

  // auto-suggest จับคู่ด้วย base part (revision ต่างกันก็จับได้) — customerPart → [{sap,name}]
  const suggestByCust = useMemo(() => {
    const byBase = {};
    Object.entries(drMap).forEach(([sap, v]) => {
      if (!v.p_no) return;
      const b = baseOfPart(v.p_no); if (!b) return;
      (byBase[b] = byBase[b] || []).push({ sap, name: v.name || '' });
    });
    const out = {};
    unmapped.forEach(u => { const c = byBase[baseOfPart(u.mat)]; if (c && c.length) out[u.mat] = c; });
    return out;
  }, [drMap, unmapped]);

  // เปิด modal จับคู่ + เติมข้อเสนอที่ชัดเจน (มีตัวเดียว) ให้อัตโนมัติ
  const openMapModal = () => {
    const pre = {};
    Object.entries(suggestByCust).forEach(([cust, cands]) => { if (cands.length === 1) pre[cust] = cands[0].sap; });
    setMapSel(pre);
    setMapModal(true);
  };

  // สรุปภาระการผลิต (Type B): Σ work-time/ไลน์ เทียบ available = %load
  const capacity = useMemo(() => {
    if (calcType !== 'production') return null;
    const availSec = (Number(settings.hours_per_day) || 16) * 3600 * (Number(settings.working_days) || 0);
    const byLine = {};
    rows.forEach(row => {
      if (!row.r.valid) return;
      const line = row.line || '(ไม่ระบุไลน์)';
      if (!byLine[line]) byLine[line] = { line, parts: 0, workSec: 0 };
      byLine[line].parts++;
      byLine[line].workSec += row.r.workTimeMonth;
    });
    return { availSec, list: Object.values(byLine)
      .map(l => ({ ...l, loadPct: availSec ? (l.workSec / availSec) * 100 : 0 }))
      .sort((a, b) => b.loadPct - a.loadPct) };
  }, [rows, calcType, settings.hours_per_day, settings.working_days]);

  const setEdit = (mat, field, val) => setEdits(e => ({ ...e, [mat]: { ...e[mat], [field]: val === '' ? '' : Number(val) } }));

  const exportCSV = () => {
    if (!rows.length) { toast.info('ไม่มีข้อมูลให้ export'); return; }
    const esc = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const isProd = calcType === 'production';
    const head = isProd
      ? ['Mat SAP','Part Name','Line','Customer','Order/Month','Vol/Day','CT(sec)','Packaging','CAP(pc/hr)','Process','LotQty','Setup(s)','SafetyDays',
         'Min(K/B)','Max(K/B)','Kanban/Lot','Kanban(sys)','Min(pcs)','Max(pcs)','WorkTime(sec/mo)','WorkTime(hr/mo)','Available(hr/mo)','Load%']
      : ['Mat SAP','Part Name','Line','Customer','Order/Month','Order/Day','CT(sec)','Order/Round','Prep','Fluct','SafetyTime',
         'PrepTime(min)','Fluct%','Packaging','DeliveryCycle','CAP(pc/hr)','LotSize','SafetyDays','Min(K/B)','Max(K/B)','Total(K/B)','Min(pcs)','Max(pcs)','Total(pcs)'];
    const dataLines = rows.map(row => {
      const { r, pp } = row;
      const cells = isProd
        ? [row.mat, esc(row.name), row.line || '', row.customer || '', row.order,
           r.volDay, r.ct, pp.packaging, pp.capacity_pc_hr, pp.process_count, pp.lot_qty, pp.setup_time_sec, pp.safety_days,
           r.minKanban, r.maxKanban, r.kanbanPerLot, r.totalKanban, r.minPcs, r.maxPcs,
           Math.round(r.workTimeMonth), (r.workTimeMonth / 3600).toFixed(1), (r.availableMonth / 3600).toFixed(1), r.loadPct.toFixed(1)]
        : [row.mat, esc(row.name), row.line || '', row.customer || '', row.order,
           r.orderDay, r.ct, r.orderRound, r.prep, r.fluct, r.safetyTime,
           pp.prep_time_min, pp.fluctuation_pct, pp.packaging, pp.delivery_cycle, pp.capacity_pc_hr, pp.lot_size, pp.safety_days,
           r.minKanban, r.maxKanban, r.totalKanban, r.minPcs, r.maxPcs, r.totalPcs];
      return cells.join(',');
    });
    // ต่อท้ายด้วยตารางสรุป capacity (production)
    const capBlock = (isProd && capacity)
      ? ['', 'สรุปภาระการผลิต (Capacity Load)', 'Line,Parts,WorkTime(hr/mo),Available(hr/mo),Load%',
         ...capacity.list.map(l => [esc(l.line), l.parts, (l.workSec / 3600).toFixed(1), (capacity.availSec / 3600).toFixed(1), l.loadPct.toFixed(1)].join(','))]
      : [];
    const blob = new Blob(['﻿' + [head.join(','), ...dataLines, ...capBlock].join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `kanban_${calcType}_${month}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const saveSettings = async () => {
    const full = { working_days: Math.max(1, Number(settings.working_days) || 20), efficiency_pct: Number(settings.efficiency_pct) || 80, hours_per_day: Math.max(1, Number(settings.hours_per_day) || 16), updated_by: fullName, updated_at: new Date().toISOString() };
    let { error } = await supabaseDR.from('kanban_calc_settings').update(full).eq('id', 'default');
    if (error && /hours_per_day/.test(error.message || '')) {           // ยังไม่ได้ apply migration → บันทึกค่าเดิมได้
      const { hours_per_day, ...base } = full;
      ({ error } = await supabaseDR.from('kanban_calc_settings').update(base).eq('id', 'default'));
      if (!error) { toast.info('บันทึกค่ากลางแล้ว (hours/day ต้อง apply migration ก่อนถึงจำได้ข้ามรอบ)'); return; }
    }
    if (error) toast.error(error.message); else toast.success('บันทึกค่ากลางแล้ว');
  };

  const doApply = async () => {
    setApplying(true);
    try {
      let paramWarn = false;
      for (const row of changedRows) {
        const pp = row.pp, r = row.r;
        // 1) บันทึก param ที่ใช้ (จำไว้รอบหน้า) — production เพิ่มฟิลด์เฉพาะ (best-effort ถ้ายังไม่ได้ apply migration)
        const baseP = {
          mat_no: row.mat, part_name: row.name, customer: row.customer, line_name: row.line,
          prep_time_min: Number(pp.prep_time_min), fluctuation_pct: Number(pp.fluctuation_pct),
          packaging: Number(pp.packaging), delivery_cycle: Number(pp.delivery_cycle),
          capacity_pc_hr: Number(pp.capacity_pc_hr), lot_size: Number(pp.lot_size), safety_days: Number(pp.safety_days),
          updated_by: fullName, updated_at: new Date().toISOString(),
        };
        const payloadP = calcType === 'production'
          ? { ...baseP, calc_type: 'production', process_count: Number(pp.process_count), lot_qty: Number(pp.lot_qty), setup_time_sec: Number(pp.setup_time_sec) }
          : baseP;
        let { error: pErr } = await supabaseDR.from('kanban_calc_params').upsert(payloadP, { onConflict: 'mat_no' });
        if (pErr && calcType === 'production' && /calc_type|process_count|lot_qty|setup_time_sec/.test(pErr.message || '')) {
          paramWarn = true;                                              // migration ยังไม่ apply — เขียน param พื้นฐานพอ
          ({ error: pErr } = await supabaseDR.from('kanban_calc_params').upsert(baseP, { onConflict: 'mat_no' }));
        }
        if (pErr) throw pErr;
        // 2) เขียนผลเข้า kanban_standards (min/max = ชิ้น, total_kanban = ใบ) — ใช้คอลัมน์เดิม ทำงานได้ทั้ง 2 type
        // ⚠️ ต้อง destructure { error } + นับแถว — supabase-js คืน error ไม่ throw · เดิมไม่เช็คเลย
        //    = kanban_standards ไม่ติดบางแถวใต้ toast เขียว "อัปเดตแล้ว" (QC flow-audit D1)
        const lotStd = lotPcsOf(calcType, pp);   // ← ชิ้นเสมอ (ดูกฎเหล็กที่ lotPcsOf)
        const patch = { qty_per_kanban: Number(pp.packaging), min_qty: r.minPcs, max_qty: r.maxPcs, lot_size: lotStd, total_kanban: r.totalKanban, updated_by: fullName, updated_at: new Date().toISOString() };
        if (row.ks && row.ks.mat_no) {
          const { data: upd, error: kErr } = await supabaseDR.from('kanban_standards')
            .update(patch).eq('mat_no', row.mat).select('mat_no');
          if (kErr) throw new Error(`เขียน kanban ของ ${row.mat} ไม่สำเร็จ: ${kErr.message}`);
          if (!upd || upd.length === 0) throw new Error(`เขียน kanban ของ ${row.mat} ไม่ติด (0 แถว) — ตรวจว่าพาร์ทยังอยู่ในระบบ`);
        } else {
          const { error: kErr } = await supabaseDR.from('kanban_standards')
            .insert({ mat_no: row.mat, part_name: row.name, customer: row.customer, is_active: true, ...patch });
          if (kErr) throw new Error(`เพิ่ม kanban ของ ${row.mat} ไม่สำเร็จ: ${kErr.message}`);
        }
      }
      toast.success(`✅ อัปเดต kanban ${changedRows.length} รายการเข้าระบบดึงแล้ว`);
      if (paramWarn) toast.info('หมายเหตุ: param เฉพาะ Production ยังไม่ถูกจำ (ต้อง apply migration 20260716_kanban_production_calc)');
      setPreview(null);
      await load();
    } catch (err) { toast.error(err.message); }
    setApplying(false);
  };

  // (#1) จับคู่เลขพาร์ทลูกค้า → เลข SAP ภายใน: เขียน p_no ให้ dr_products (รอบถัดไป) + re-point forecast เดิม
  const doMapping = async () => {
    const pairs = Object.entries(mapSel).filter(([, sap]) => sap);
    if (!pairs.length) { toast.info('ยังไม่ได้เลือกคู่ SAP'); return; }
    setMapping(true);
    try {
      for (const [cust, sap] of pairs) {
        const name = drMap[sap]?.name || null;
        await supabaseDR.from('dr_products').update({ p_no: cust }).eq('mat_no', sap);                       // future uploads
        // single source: p_no เก็บซ้ำใน kanban_standards ด้วย — เขียน write-through กันตาราง 2 ฝั่ง map เลข SAP ไม่ตรง (stale → map ผิด)
        try { await supabaseDR.from('kanban_standards').update({ p_no: cust }).eq('mat_no', sap); } catch { /* best-effort — บางพาร์ทไม่มีแถว kanban */ }
        await supabaseDR.from('customer_forecasts').update({ mat_no: sap, part_name: name }).eq('mat_no', cust); // existing forecast
      }
      toast.success(`🔗 จับคู่ ${pairs.length} พาร์ทเข้าเลข SAP แล้ว — Store/Planner จะ sync ตามเลขเดียวกัน`);
      setMapModal(false); setMapSel({});
      await load();
    } catch (err) { toast.error(err.message); }
    setMapping(false);
  };

  const NCOLS = calcType === 'production'
    ? ['packaging','capacity_pc_hr','process_count','lot_qty','setup_time_sec','safety_days']
    : ['prep_time_min','fluctuation_pct','packaging','delivery_cycle','capacity_pc_hr','lot_size','safety_days'];
  /* ⚠️ หัวคอลัมน์ต้องบอก "หน่วย" เสมอ (user แจ้ง 2026-08-21: ทั้งตารางไม่มีหน่วยสักช่อง)
     ช่องที่เจ็บสุดคือ **Lot ของแท็บ Withdrawal ซึ่งเป็น "ใบ" ไม่ใช่ "ชิ้น"**
     (สูตร `totalKanban = maxKanban + lotSize` บวกกับจำนวนใบตรงๆ — ตรวจกับหน้าจอจริง 88 + 300 = 388)
     พอไม่มีหน่วยบอก คนกรอกเลยใส่ 1 บ้าง 300 บ้าง แล้วค่านั้นถูก Apply เขียนลง
     `kanban_standards.lot_size` ซึ่ง fn_explode_child_demand อ่านเป็น "ชิ้น" → ล็อตระเบิดความต้องการเพี้ยน
     หน่วยของช่องที่คูณกับ CT (lot_qty / process_count) ยืนยันด้วยมิติ: ค่า × วินาที/ชิ้น = วินาที ⇒ เป็น "ชิ้น" */
  const NHEAD = calcType === 'production'
    ? [{ t: 'Pkg', u: 'ชิ้น/กล่อง' },
       { t: 'CAP/ชม.', u: 'ชิ้น/ชม.' },
       { t: 'Process', u: 'ชิ้น', tip: 'Process LT = ค่านี้ × CT' },
       { t: 'Lot Qty', u: 'ชิ้น', tip: 'ขนาดล็อตผลิต · Info LT = ค่านี้ × CT · ใบ/ล็อต = ⌈ค่านี้ ÷ Pkg⌉' },
       { t: 'Setup', u: 'วินาที' },
       { t: 'Safety', u: 'วัน' }]
    : [{ t: 'เตรียม', u: 'นาที' },
       { t: 'ผันผวน', u: '%' },
       { t: 'Pkg', u: 'ชิ้น/กล่อง' },
       { t: 'รอบส่ง', u: 'รอบ/วัน' },
       { t: 'CAP/ชม.', u: 'ชิ้น/ชม.' },
       { t: 'Lot', u: 'ใบ', tip: 'ขนาดล็อตเป็นจำนวนใบคัมบัง — 1 ใบ = 1 กล่อง = Pkg ชิ้น · Total(K/B) = Max + Lot\nตอน Apply ระบบคูณ Pkg ให้เองก่อนบันทึก (ขนาดล็อตในระบบดึงเก็บเป็น "ชิ้น") — ดูตัวเลขจริงใต้ช่อง' },
       { t: 'Safety', u: 'วัน' }];

  return (
    <div>
      {/* เลือกชนิด Kanban */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {[
          { id: 'withdrawal', label: '🔄 Withdrawal (เบิกถอน FG)' },
          { id: 'production', label: '🏭 Production (ผลิต press)' },
        ].map(t => (
          <button key={t.id} onClick={() => { setCalcType(t.id); setPreview(null); }}
            style={{ ...btn(calcType === t.id), fontSize: 12.5 }}>{t.label}</button>
        ))}
      </div>

      {/* แยกพาร์ทตามกระบวนการผลิต — โปร่งใส ไม่ปล่อยพาร์ทหายเงียบ */}
      <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 10, padding: '6px 10px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8 }}>
        🔎 แยกพาร์ทตาม <b style={{ color: 'var(--text2)' }}>กระบวนการผลิต (process_type)</b> — {calcType === 'production'
          ? <>แท็บนี้แสดงเฉพาะงาน <b style={{ color: 'var(--text2)' }}>ปั๊ม/ผลิตเป็น lot (metal_forming)</b> · งานปั๊มที่ขายตรงเป็น FG ก็อยู่ที่นี่ (ดูกระบวนการ ไม่ดูเลข MAT)</>
          : <>แท็บนี้แสดงงาน <b style={{ color: 'var(--text2)' }}>เบิกถอน/ประกอบ</b> (ไม่ใช่ปั๊ม)</>}
        {otherProcCount > 0 && <> · <span style={{ color: '#f59e0b' }}>ซ่อน {otherProcCount} พาร์ทที่เป็นอีกกระบวนการ</span> (อยู่อีกแท็บ)</>}
        {' '}· ตั้ง process_type ต่อพาร์ทที่ Product Master
      </div>

      {/* controls */}
      <div style={{ ...card, marginBottom: 14, display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>เดือน Forecast ที่ใช้คำนวณ</label>
          <input type="month" value={month} onChange={e => setMonth(e.target.value)} style={{ ...inputSt, width: 160 }} />
        </div>
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>📅 วันทำงาน/เดือน <span style={{ color: '#0ea5e9' }}>(จากปฏิทิน)</span></label>
          <input type="number" value={settings.working_days} onChange={e => setSettings(s => ({ ...s, working_days: e.target.value }))} style={{ ...inputSt, width: 90 }} />
        </div>
        {calcType === 'withdrawal' ? (
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Efficiency %</label>
            <input type="number" value={settings.efficiency_pct} onChange={e => setSettings(s => ({ ...s, efficiency_pct: e.target.value }))} style={{ ...inputSt, width: 80 }} />
          </div>
        ) : (
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>⏱ ชม.ทำงาน/วัน <span style={{ color: '#0ea5e9' }}>(คิด capacity)</span></label>
            <input type="number" value={settings.hours_per_day} onChange={e => setSettings(s => ({ ...s, hours_per_day: e.target.value }))} style={{ ...inputSt, width: 90 }} />
          </div>
        )}
        {canApply && <button onClick={saveSettings} style={btn(false)}>💾 ค่ากลาง</button>}
        {lines.length > 0 && (
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>ไลน์</label>
            {/* ไลน์ที่มีพาร์ทในตาราง — จัดลำดับชั้นตามผัง (แม่→ลูก) แทนลิสต์แบนเรียงตัวอักษร */}
            <LineSelect lines={prodLines.filter(l => lines.includes(l.name))}
              value={lineFilter} onChange={setLineFilter} placeholder="ทุกไลน์"
              style={{ ...inputSt, width: 150 }}
              extraGroups={[{ label: '⚠ ไม่มีในทะเบียนไลน์', options: lines.filter(n => !prodLines.some(l => l.name === n)).map(n => ({ value: n })) }]}
            />
          </div>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{rows.length} พาร์ท · <b style={{ color: '#f59e0b' }}>{changedRows.length}</b> เปลี่ยน</span>
          {canApply && (
            <button onClick={() => setPreview(changedRows)} disabled={changedRows.length === 0}
              style={{ ...btn(changedRows.length > 0), opacity: changedRows.length ? 1 : 0.5 }}>🎴 Preview &amp; Apply</button>
          )}
          <button onClick={exportCSV} disabled={rows.length === 0} style={{ ...btn(false), opacity: rows.length ? 1 : 0.5 }}>⬇ CSV</button>
        </div>
      </div>

      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
        {calcType === 'production'
          ? '📖 Production Kanban (คัมบังสั่งผลิต press). Vol/Day = ⌈forecast/วันทำงาน⌉ · Kanban(sys) = ⌈(Info+Process+Safety)/CT/pkg⌉ · Min = Safety · Max = Min + Kanban/Lot · แก้ param แล้วค่าคำนวณอัปเดตทันที · มีสรุปภาระการผลิต (%load) ด้านล่าง'
          : '📖 Withdrawal Kanban (คัมบังเบิกถอน FG). Order/เดือน = ผลรวม forecast ของเดือนที่เลือก · แก้ param ในตารางแล้วค่าคำนวณอัปเดตทันที · Apply = เขียนเข้า kanban_standards (ระบบดึงใช้ต่อ)'}
      </div>

      {/* CAP/ชม. ที่กรอก vs กำลังจริงจาก OEE — ไม่แทนค่าให้เอง แต่ต้องเห็นว่าห่างกันแค่ไหน */}
      {capGap.length > 0 && (
        <div style={{ ...card, marginBottom: 12, borderColor: '#f59e0b', background: 'rgba(245,158,11,0.06)', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 22 }}>⚡</span>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#f59e0b' }}>{capGap.length} พาร์ท CAP/ชม. ที่กรอก ห่างจากกำลังจริง ≥ 20%</div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
              ช่อง CAP/ชม. ตั้งต้นเป็น <b>กำลังทางทฤษฎี</b> (3600 ÷ CT) ซึ่งไม่หัก downtime/ของเสีย ·
              ตัวเลข <b style={{ color: '#f59e0b' }}>จริง ~</b> ใต้ช่อง = (3600 ÷ CT) × OEE จริงของไลน์นั้น (กะที่ปิดแล้ว 90 วัน) <b>คลิกเพื่อใช้ค่านั้น</b>
              <div style={{ marginTop: 2 }}>⚠️ ระบบ<b>ไม่แทนค่าให้เอง</b> — จะวางแผนด้วยกำลังทฤษฎีหรือกำลังจริงเป็นการตัดสินใจของผู้วางแผน</div>
            </div>
          </div>
        </div>
      )}

      {/* (#2) แจ้งเตือนพาร์ทที่จับคู่เลข SAP ไม่ได้ */}
      {unmapped.length > 0 && (
        <div style={{ ...card, marginBottom: 12, borderColor: '#f59e0b', background: 'rgba(245,158,11,0.06)', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 22 }}>⚠️</span>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#f59e0b' }}>{unmapped.length} พาร์ทจับคู่เลข SAP ภายในไม่ได้ (forecast โชว์เป็นเลขพาร์ทลูกค้า)</div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
              ยังไม่มีใน Product Master (dr_products) → คำนวณ kanban ไม่ได้ และ Store/Planner จะไม่ sync จนกว่าจะจับคู่ p_no
              {Object.keys(suggestByCust).length > 0 && <span style={{ color: '#22c55e', fontWeight: 700 }}> · 💡 ระบบแนะนำได้ {Object.keys(suggestByCust).length} พาร์ท (ตัด revision เทียบ base)</span>}
            </div>
          </div>
          {canApply && <button onClick={openMapModal} style={{ ...btn(true) }}>🔗 จับคู่เลข SAP</button>}
        </div>
      )}

      {loading ? <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)' }}>กำลังโหลด...</div> :
       rows.length === 0 ? <div style={{ ...card, textAlign: 'center', color: 'var(--muted)' }}>ไม่มี forecast ในเดือน {monthLabel(monthRange.start)} — อัปโหลด forecast ที่แท็บ 📤 ก่อน</div> : (
        <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
          <div className="table-sticky" style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1000 }}>
              <thead>
                <tr style={{ background: 'var(--bg2)' }}>
                  {[{ t: 'Mat SAP' }, { t: 'Part / ไลน์' }, { t: 'Order/เดือน', u: 'ชิ้น' }, ...NHEAD,
                    { t: 'Min', u: 'ใบ' }, { t: 'Max', u: 'ใบ' },
                    { t: 'Total', u: 'ใบ', tip: 'Total = Max + Lot' },
                    { t: 'Min→Max', u: 'ชิ้น', tip: 'แปลงเป็นชิ้นแล้ว = ใบ × Pkg' }, { t: 'สถานะ' }].map(h => (
                    <th key={h.t} title={h.tip || ''} style={{ padding: '6px 8px', fontSize: 11, fontWeight: 800, color: 'var(--muted)', textAlign: 'center', whiteSpace: 'nowrap', textTransform: 'uppercase', cursor: h.tip ? 'help' : undefined }}>
                      <div>{h.t}{h.tip ? ' ⓘ' : ''}</div>
                      {/* หน่วยต้องเห็นตลอด ห้ามซ่อนใน tooltip — คนกรอกไม่มีทางรู้ว่าช่องนี้เป็นใบหรือชิ้น */}
                      {h.u && <div style={{ fontSize: 9.5, fontWeight: 600, color: h.u === 'ใบ' ? '#f59e0b' : 'var(--muted)', textTransform: 'none', opacity: 0.9 }}>({h.u})</div>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(row => {
                  const { r, ks } = row;
                  return (
                    <tr key={row.mat} style={{ background: row.changed ? 'rgba(245,158,11,0.05)' : undefined }}>
                      <td style={{ ...tdc, fontFamily: 'monospace', fontWeight: 700, color: '#0ea5e9', textAlign: 'left' }}>{row.mat}</td>
                      <td style={{ ...tdc, textAlign: 'left', maxWidth: 200 }}><div style={{ color: 'var(--text)' }}>{row.name || '—'}</div><div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{row.line || '—'}{row.customer ? ` · ${row.customer}` : ''}</div></td>
                      <td style={{ ...tdc, textAlign: 'right', fontWeight: 800 }}>{fmt(row.order)}</td>
                      {NCOLS.map(c => (
                        <td key={c} style={{ ...tdc, textAlign: 'center' }}>
                          <input type="number" value={row.pp[c]} disabled={!canApply}
                            onChange={e => setEdit(row.mat, c, e.target.value)}
                            style={{ ...numInput, borderColor: (edits[row.mat] || {})[c] != null ? '#0ea5e9' : 'var(--border)' }} />
                          {/* ช่อง Lot กรอกเป็น "ใบ" แต่ค่าที่บันทึกลง kanban_standards เป็น "ชิ้น"
                              → ต้องเห็นตัวเลขที่จะถูกบันทึกจริงตรงนี้ ห้ามให้ไปรู้ตอนของระเบิดแล้ว */}
                          {c === 'lot_size' && (
                            <div style={{ fontSize: 9.5, marginTop: 2, whiteSpace: 'nowrap', color: lotPcsOf(calcType, row.pp) > 0 ? 'var(--muted)' : '#f59e0b' }}>
                              {lotPcsOf(calcType, row.pp) > 0 ? `= ${fmt(lotPcsOf(calcType, row.pp))} ชิ้น` : 'ต้องมี Pkg'}
                            </div>
                          )}
                          {/* CAP ที่กรอกเป็นกำลังทางทฤษฎี — โชว์กำลังจริงจาก OEE ให้เทียบ กดแล้วเติมให้ (คนกดเอง) */}
                          {c === 'capacity_pc_hr' && (row.capReal
                            ? (() => {
                                const cur = Number(row.pp.capacity_pc_hr) || 0;
                                const far = cur > 0 && Math.abs(cur - row.capReal) / row.capReal >= 0.2;
                                return (
                                  <div
                                    onClick={() => canApply && setEdit(row.mat, 'capacity_pc_hr', row.capReal)}
                                    title={`กำลังจริง = (3600 ÷ CT) × OEE ${row.oeePct.toFixed(1)}% ของไลน์ ${row.line}\nจากกะที่ปิดแล้ว ${row.oeeN} กะ ใน 90 วัน\nคลิกเพื่อใช้ค่านี้`}
                                    style={{ fontSize: 9.5, marginTop: 2, whiteSpace: 'nowrap', cursor: canApply ? 'pointer' : 'default',
                                             color: far ? '#f59e0b' : 'var(--muted)', fontWeight: far ? 800 : 500, textDecoration: canApply ? 'underline dotted' : 'none' }}>
                                    จริง ~{fmt(row.capReal)}
                                  </div>
                                );
                              })()
                            : <div style={{ fontSize: 9.5, color: 'var(--muted)', marginTop: 2, opacity: 0.6 }} title="ยังไม่มีกะที่ปิดแล้วของไลน์นี้ใน 90 วัน หรือยังไม่ได้ตั้ง CT ที่ Product Master">จริง —</div>
                          )}
                        </td>
                      ))}
                      <td style={{ ...tdc, textAlign: 'right', fontWeight: 700 }}>{r.valid ? r.minKanban : '—'}</td>
                      <td style={{ ...tdc, textAlign: 'right', fontWeight: 700 }}>{r.valid ? r.maxKanban : '—'}</td>
                      <td style={{ ...tdc, textAlign: 'right', fontWeight: 900, color: r.valid ? 'var(--accent)' : 'var(--muted)', fontSize: 14 }}>{r.valid ? r.totalKanban : '—'}</td>
                      <td style={{ ...tdc, textAlign: 'right', color: 'var(--muted)' }}>{r.valid ? `${fmt(r.minPcs)}→${fmt(r.maxPcs)}` : '—'}</td>
                      <td style={{ ...tdc, textAlign: 'center', whiteSpace: 'nowrap' }}>
                        {!r.valid ? <span title={calcType === 'production' ? 'ต้องมี Pkg + CAP + Lot Qty' : 'ต้องมี Pkg + CAP'} style={{ fontSize: 11, color: '#ef4444' }}>⚠️ ขาด param</span>
                          : row.changed ? <span style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b' }}>ต่างจากเดิม ({ks.total_kanban ?? '—'}→{r.totalKanban})</span>
                          : <span style={{ fontSize: 11, color: '#22c55e' }}>✓ ตรงแล้ว</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* สรุปภาระการผลิต (Type B) — Σ work-time/ไลน์ เทียบ available */}
      {calcType === 'production' && capacity && capacity.list.length > 0 && (
        <div style={{ ...card, marginTop: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 800, fontFamily: 'var(--font-display)', marginBottom: 2 }}>📊 สรุปภาระการผลิต (Capacity Load)</div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 12 }}>
            เวลาที่ต้องใช้ = Σ (setup + lot×CT) × (order/lot) ต่อไลน์ · Available = {fmt(settings.hours_per_day)} ชม./วัน × {fmt(settings.working_days)} วัน = {fmt(capacity.availSec / 3600)} ชม./เดือน · สี &lt;85% เขียว · 85–100% เหลือง · &gt;100% แดง (เกิน capacity)
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {capacity.list.map(l => {
              const col = l.loadPct > 100 ? '#ef4444' : l.loadPct >= 85 ? '#f59e0b' : '#22c55e';
              return (
                <div key={l.line} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <div style={{ width: 150, fontSize: 12.5, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.line}</div>
                  <div style={{ flex: 1, height: 22, background: 'var(--bg2)', borderRadius: 6, overflow: 'hidden', position: 'relative', border: '1px solid var(--border)' }}>
                    <div style={{ width: `${Math.min(100, l.loadPct)}%`, height: '100%', background: col, transition: 'width .25s' }} />
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', paddingLeft: 8, fontSize: 11.5, fontWeight: 800, color: 'var(--text)' }}>
                      {l.parts} พาร์ท · {fmt(l.workSec / 3600)} ชม.
                    </div>
                  </div>
                  <div style={{ width: 72, textAlign: 'right', fontSize: 13.5, fontWeight: 900, color: col, fontVariantNumeric: 'tabular-nums' }}>{l.loadPct.toFixed(1)}%</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* (#1) Modal จับคู่เลขพาร์ทลูกค้า → เลข SAP ภายใน — ฟอร์มกรอกหลายสิบแถว ไม่ปิดจาก backdrop (UI-CONVENTIONS §5) */}
      {mapModal && (
        <div className="modal-scroll" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 14, padding: 22, width: 'min(760px,100%)', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 16, fontWeight: 800, fontFamily: 'var(--font-display)', marginBottom: 4 }}>🔗 จับคู่เลขพาร์ทลูกค้า → เลข SAP ภายใน</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
              เลือกเลข SAP ภายในให้แต่ละพาร์ท → ระบบเขียน <b>p_no</b> ให้ Product Master (ใช้ auto-map รอบอัพโหลดถัดไป) และแก้ forecast เดิมให้ชี้เลข SAP ทันที · <b>{Object.values(mapSel).filter(Boolean).length}</b> เลือกแล้ว · 💡 = ระบบแนะนำจาก base part (กดชิปเขียวเพื่อเติม)
            </div>
            <div style={{ overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead><tr style={{ background: 'var(--bg2)' }}>
                  {['เลขพาร์ทลูกค้า', 'Order/เดือน', 'เลข SAP ภายใน'].map(h => <th key={h} style={{ padding: '7px 10px', fontSize: 11, color: 'var(--muted)', textAlign: h === 'Order/เดือน' ? 'right' : 'left' }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {unmapped.map(u => (
                    <tr key={u.mat}>
                      <td style={{ padding: '6px 10px', borderTop: '1px solid var(--border)', fontFamily: 'monospace', fontWeight: 700 }}>{u.mat}</td>
                      <td style={{ padding: '6px 10px', borderTop: '1px solid var(--border)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(u.order)}</td>
                      <td style={{ padding: '6px 10px', borderTop: '1px solid var(--border)' }}>
                        <input list="sap-opts" value={mapSel[u.mat] || ''} placeholder="พิมพ์เลข SAP หรือชื่อ…"
                          onChange={e => setMapSel(s => ({ ...s, [u.mat]: e.target.value.trim() }))}
                          style={{ ...inputSt, width: '100%', padding: '5px 8px', fontSize: 12,
                            borderColor: mapSel[u.mat] && drMap[mapSel[u.mat]] ? '#22c55e' : mapSel[u.mat] ? '#ef4444' : 'var(--border)' }} />
                        {mapSel[u.mat] && (drMap[mapSel[u.mat]]
                          ? <div style={{ fontSize: 10.5, color: '#22c55e', marginTop: 2 }}>✓ {drMap[mapSel[u.mat]].name}{drMap[mapSel[u.mat]].line_name ? ` · ${drMap[mapSel[u.mat]].line_name}` : ''}</div>
                          : <div style={{ fontSize: 10.5, color: '#ef4444', marginTop: 2 }}>✗ ไม่พบเลข SAP นี้ใน Product Master</div>)}
                        {suggestByCust[u.mat] && (
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 3 }}>
                            {suggestByCust[u.mat].map(c => (
                              <button key={c.sap} onClick={() => setMapSel(s => ({ ...s, [u.mat]: c.sap }))}
                                title="แนะนำจาก base part (revision ต่างกัน)"
                                style={{ fontSize: 11, padding: '2px 6px', borderRadius: 5, cursor: 'pointer', border: '1px solid #22c55e',
                                  background: mapSel[u.mat] === c.sap ? 'rgba(34,197,94,0.18)' : 'transparent', color: '#22c55e', fontWeight: 700 }}>
                                💡 {c.sap} · {c.name}
                              </button>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <datalist id="sap-opts">
                {sapOptions.map(o => <option key={o.mat} value={o.mat}>{o.name}{o.line ? ` · ${o.line}` : ''}</option>)}
              </datalist>
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>* พาร์ทที่ยังไม่มีเลข SAP ในระบบเลย ต้องไปเพิ่มที่ Product Master ก่อน แล้วค่อยกลับมาจับคู่</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button onClick={() => setMapModal(false)} style={{ ...btn(false) }}>ปิด</button>
              <button onClick={doMapping} disabled={mapping || Object.values(mapSel).filter(v => v && drMap[v]).length === 0}
                style={{ ...btn(true), opacity: mapping || Object.values(mapSel).filter(v => v && drMap[v]).length === 0 ? 0.5 : 1 }}>
                {mapping ? '...' : `🔗 จับคู่ (${Object.values(mapSel).filter(v => v && drMap[v]).length})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Preview & Apply (แสดงอย่างเดียว ปิดจากปุ่ม/นอกกรอบได้) */}
      {preview && (
        <div className="modal-scroll" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={() => setPreview(null)}>
          <div style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 14, padding: 22, width: 'min(680px,100%)', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 16, fontWeight: 800, fontFamily: 'var(--font-display)', marginBottom: 4 }}>🎴 ยืนยันอัปเดต Kanban — {changedRows.length} รายการ</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
              เขียนค่า Min/Max/Total + <b>ขนาดล็อต</b> ใหม่เข้า kanban_standards (ระบบดึงทั้งองค์กรใช้ต่อทันที)
              <div style={{ marginTop: 3 }}>⚠️ <b>ขนาดล็อต</b> คือตัวที่ระบบใช้ตัดสินว่าสะสมความต้องการครบเมื่อไหร่ถึงออกใบสั่ง — ตั้งเล็กเกินจริง = ใบสั่งพุ่งเป็นร้อยใบ</div>
            </div>
            <div style={{ overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead><tr style={{ background: 'var(--bg2)' }}>{['Mat','Total เดิม (ใบ)','→ ใหม่ (ใบ)','Max (ชิ้น)','ขนาดล็อต (ชิ้น)'].map(h => <th key={h} style={{ padding: '7px 10px', fontSize: 11, color: 'var(--muted)', textAlign: h === 'Mat' ? 'left' : 'right' }}>{h}</th>)}</tr></thead>
                <tbody>
                  {preview.map(row => {
                    // ขนาดล็อตคือค่าที่ทริกเกอร์ระเบิดความต้องการใช้ตรงๆ — เปลี่ยนแล้วกระทบจำนวนใบสั่งทันที ต้องเห็นก่อนกดยืนยัน
                    const lotNew = lotPcsOf(calcType, row.pp), lotOld = row.ks?.lot_size;
                    const lotDiff = lotOld != null && Number(lotOld) !== lotNew;
                    return (
                    <tr key={row.mat}>
                      <td style={{ padding: '6px 10px', borderTop: '1px solid var(--border)', fontFamily: 'monospace', color: '#0ea5e9' }}>{row.mat}</td>
                      <td style={{ padding: '6px 10px', borderTop: '1px solid var(--border)', textAlign: 'right', color: 'var(--muted)' }}>{row.ks.total_kanban ?? '—'}</td>
                      <td style={{ padding: '6px 10px', borderTop: '1px solid var(--border)', textAlign: 'right', fontWeight: 800, color: 'var(--accent)' }}>{row.r.totalKanban}</td>
                      <td style={{ padding: '6px 10px', borderTop: '1px solid var(--border)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(row.r.maxPcs)}</td>
                      <td style={{ padding: '6px 10px', borderTop: '1px solid var(--border)', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: lotDiff ? 800 : 500, color: lotDiff ? '#f59e0b' : 'var(--muted)' }}>
                        {lotDiff && <span style={{ opacity: 0.7, fontWeight: 500 }}>{fmt(lotOld)} → </span>}{lotNew > 0 ? fmt(lotNew) : '—'}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button onClick={() => setPreview(null)} style={{ ...btn(false) }}>ยกเลิก</button>
              <button onClick={doApply} disabled={applying} style={{ ...btn(true), opacity: applying ? 0.6 : 1 }}>{applying ? '...' : `✅ ยืนยัน Apply (${changedRows.length})`}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PlannerSales() {
  const { role, fullName } = useContext(UserContext);
  const [tab, setTab] = useTabParam(['planner', 'kanban', 'upload'], 'planner');
  const [refreshKey, setRefreshKey] = useState(0);
  // สิทธิ์อัพโหลดจากตาราง role_permissions (ปรับได้ที่หน้า จัดการสิทธิ์ → สิทธิ์การทำงาน)
  const canUpload = can('demand', 'upload', role);

  // ship-to code → ชื่อลูกค้า (config ที่หน้า 🚚 Delivery → ⚙️ Ship-to Config)
  const [shipToMap, setShipToMap] = useState({});
  const loadShipTo = useCallback(async () => {
    const { data } = await supabaseDR.from('ship_to_plants').select('*');
    const m = {};
    (data || []).forEach(r => { m[r.code] = r; });
    setShipToMap(m);
  }, []);
  useEffect(() => { loadShipTo(); }, [loadShipTo]);
  const custLabel = useCallback((code) => {
    if (!code) return '— ไม่ระบุลูกค้า —';
    const r = shipToMap[code];
    return r && r.customer_name && r.customer_name !== code ? `${r.customer_name} (${code})` : code;
  }, [shipToMap]);

  return (
    <div style={{ padding: 'clamp(12px, 2vw, 24px)', maxWidth: 'min(96vw, 1600px)', margin: '0 auto' }}>
      <PageHeader
        title="Planner & Sales — Forecast จากลูกค้า" icon="📈"
        sub="Sales อัพโหลด Forecast/Order จากลูกค้า → ระบบวางแผนภาระการผลิตล่วงหน้า · ติดตามรอบส่งงานรายวันที่หน้า 🚚 Delivery"
        tabs={[
          { key: 'planner', label: '📈 Forecast Planner' },
          { key: 'kanban', label: '🎴 คำนวณ Kanban' },
          { key: 'upload', label: '📤 อัพโหลด (Sales)' },
        ]}
        tab={tab} onTab={setTab}
      />

      {tab === 'planner' && <PlannerTab refreshKey={refreshKey} custLabel={custLabel} />}
      {tab === 'kanban' && <KanbanCalcTab canApply={canUpload} fullName={fullName} custLabel={custLabel} />}
      {tab === 'upload' && <UploadTab canUpload={canUpload} fullName={fullName} onImported={() => { setRefreshKey(k => k + 1); loadShipTo(); }} custLabel={custLabel} />}
    </div>
  );
}
