import { useState, useEffect, useCallback, useMemo, useContext } from 'react';
import { supabase, supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { toast } from '../components/Toast';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from 'recharts';

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
        const byKey = new Map();
        ediFiles.forEach(f => f.rows.forEach(r => byKey.set(`${r.shipTo}|${r.part}|${r.date}|${r.time || ''}`, r)));
        const rows2 = [...byKey.values()];
        if (!rows2.length) { toast.error('ไม่พบรายการที่มีจำนวน > 0 ในไฟล์ EDI'); return; }
        // map Part Num ลูกค้า → mat_no ภายใน ผ่าน p_no (normalize ตัด ขีด/ช่องว่าง) — FG (ขึ้นต้น 1) ชนะ child
        const norm = (x) => String(x || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        const [{ data: stds }, { data: prods }] = await Promise.all([
          supabaseDR.from('kanban_standards').select('mat_no, p_no, part_name').not('p_no', 'is', null),
          supabaseDR.from('dr_products').select('mat_no, p_no, name').eq('is_active', true).not('p_no', 'is', null),
        ]);
        const matMap = {};
        const put = (pno, mat, name) => {
          const k = norm(pno);
          if (!k || !mat) return;
          const cur = matMap[k];
          if (!cur || (!String(cur.mat_no).startsWith('1') && String(mat).startsWith('1'))) matMap[k] = { mat_no: mat, name };
        };
        (stds || []).forEach(x => put(x.p_no, x.mat_no, x.part_name));
        (prods || []).forEach(x => put(x.p_no, x.mat_no, x.name));
        const unmatched = new Set();
        const records = rows2.map(r => {
          const hit = matMap[norm(r.part)];
          if (!hit) unmatched.add(r.part);
          return { ...r, mat_no: hit ? hit.mat_no : r.part, part_name: hit ? hit.name : null };
        });
        setEdi({
          kind: is862 ? 'orders' : 'forecast',
          files: ediFiles.map(f => f.fName),
          records, unmatched: [...unmatched],
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
    setSaving(true);
    try {
      const { data: batch, error: e1 } = await supabaseDR.from('demand_upload_batches')
        .insert({ kind, file_name: fileName, row_count: records.length, uploaded_by: fullName || 'Sales' })
        .select().single();
      if (e1) throw e1;
      const table = kind === 'forecast' ? 'customer_forecasts' : 'customer_shipping_orders';
      for (let i = 0; i < records.length; i += 500) {
        const { error: e2 } = await supabaseDR.from(table).insert(records.slice(i, i + 500).map(x => ({ ...x, batch_id: batch.id })));
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
        const { error: eDel } = await supabaseDR.from('customer_forecasts').delete().eq('source', 'edi_830').in('customer', edi.shipTos);
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
        // เก็บใบที่เตรียม/ส่งไปแล้ว — ลบเฉพาะ pending จาก EDI ในช่วง horizon แล้วลงฉบับใหม่ (ไม่ insert ซ้ำ slot ที่ทำไปแล้ว)
        const { data: keepRows } = await supabaseDR.from('customer_shipping_orders')
          .select('customer, customer_part_no, mat_no, due_date, ship_time, status')
          .in('customer', edi.shipTos).gte('due_date', edi.dateFrom).neq('status', 'pending');
        const keepKeys = new Set((keepRows || []).map(k => `${k.customer}|${k.customer_part_no || k.mat_no}|${k.due_date}|${(k.ship_time || '').slice(0, 5)}`));
        const { error: eDel } = await supabaseDR.from('customer_shipping_orders').delete()
          .eq('source', 'edi_862').eq('status', 'pending').in('customer', edi.shipTos).gte('due_date', edi.dateFrom);
        if (eDel) throw eDel;
        const recs = edi.records
          .filter(r => !keepKeys.has(`${r.shipTo}|${r.part}|${r.date}|${r.time || ''}`))
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
    if (!window.confirm(`ลบชุดข้อมูล "${b.file_name}" (${b.row_count} แถว)? ข้อมูลที่นำเข้าจากไฟล์นี้จะถูกลบทั้งหมด`)) return;
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
      const [{ data: fc }, { data: od }] = await Promise.all([
        supabaseDR.from('customer_forecasts').select('*').gte('period_month', from).lt('period_month', to),
        supabaseDR.from('customer_shipping_orders').select('*').gte('due_date', from).lt('due_date', to),
      ]);
      setForecasts(fc || []);
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
    const fq = forecasts.filter(f => f.period_month.slice(0, 7) === m.slice(0, 7)).reduce((s, f) => s + Number(f.qty), 0);
    const oq = orders.filter(o => o.due_date.slice(0, 7) === m.slice(0, 7)).reduce((s, o) => s + Number(o.qty), 0);
    return { month: monthLabel(m), Forecast: fq, Orders: oq };
  }), [months, forecasts, orders]);

  // ตารางราย mat_no ของเดือนที่เลือก — forecast vs order จริง + ภาระชั่วโมงผลิต
  const matRows = useMemo(() => {
    const map = {};
    forecasts.filter(f => f.period_month.slice(0, 7) === focusMonth.slice(0, 7)).forEach(f => {
      const r = map[f.mat_no] = map[f.mat_no] || { mat_no: f.mat_no, part_name: f.part_name, customer: f.customer, forecast: 0, ordered: 0 };
      r.forecast += Number(f.qty);
      if (!r.part_name) r.part_name = f.part_name;
    });
    orders.filter(o => o.due_date.slice(0, 7) === focusMonth.slice(0, 7)).forEach(o => {
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
          <select value={focusMonth} onChange={e => setFocusMonth(e.target.value)} style={inputSt}>
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
          <div style={{ overflowX: 'auto' }}>
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
export default function PlannerSales() {
  const { role, fullName } = useContext(UserContext);
  const [tab, setTab] = useState('planner');
  const [refreshKey, setRefreshKey] = useState(0);
  const canUpload = ['admin', 'manager', 'sale'].includes(role);

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
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0, fontSize: 'clamp(18px, 2.5vw, 24px)', fontWeight: 900, fontFamily: 'var(--font-display)', color: 'var(--text)' }}>
          📈 Planner & Sales — Forecast จากลูกค้า
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}>
          Sales อัพโหลด Forecast/Order จากลูกค้า → ระบบวางแผนภาระการผลิตล่วงหน้า · ติดตามรอบส่งงานรายวันที่หน้า 🚚 Delivery
        </p>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { id: 'planner', label: '📈 Forecast Planner' },
          { id: 'upload',  label: '📤 อัพโหลด (Sales)' },
        ].map(t => <button key={t.id} onClick={() => setTab(t.id)} style={btn(tab === t.id)}>{t.label}</button>)}
      </div>

      {tab === 'planner' && <PlannerTab refreshKey={refreshKey} custLabel={custLabel} />}
      {tab === 'upload' && <UploadTab canUpload={canUpload} fullName={fullName} onImported={() => { setRefreshKey(k => k + 1); loadShipTo(); }} custLabel={custLabel} />}
    </div>
  );
}
