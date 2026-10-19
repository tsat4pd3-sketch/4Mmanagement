/* ══ 📥 นำเข้าตัวเลขฐานจาก Excel monthly report ของบัญชี (2026-10-15 · user: "บัญชีส่งไฟล์ excel ทุกเดือน ทำหน้าอัพโหลดให้อ่านเลย") ═══
   ยังไม่เห็นไฟล์จริง ⇒ โมดัลนี้ "เดาแล้วให้คนยืนยัน" (utils/kpiBaseImport.js): หาแถวตัวแปรจากป้าย · หาคอลัมน์เดือนจากหัวตาราง ·
   โชว์ตารางเทียบ "ค่าใหม่ vs ค่าที่มีอยู่" ก่อนบันทึกเสมอ · แถวที่เดาไม่เจอ = คนเลือกเองจาก dropdown (ไม่เดาเป็น 0)
   · จำแผนที่ (ป้ายที่เลือกต่อตัวแปร + ตัวคูณหน่วย) ต่อชื่อชีทไว้ใน localStorage ของเครื่องนี้ — เดือนหน้าอัพไฟล์เดิมได้ทันที
   · ค่ากลางทั้งโรงงานเขียนได้เฉพาะตอนดูขอบเขต ทั้งโรงงาน (คนกลาง) · ยอดเงินของหน่วยเขียนที่ขอบเขตที่ดู · ตัวอ่าน xlsx = import แบบ lazy */
import { useEffect, useMemo, useState } from 'react';
import { toast } from './Toast';
import { KPI_BASE_VARS, baseVarOf } from '../utils/kpiSetup';
import { detectMonthColumns, detectVarRows, extractValues, rowLabels, IMPORT_MULTIPLIERS, limitMonths, rollingMonths, bestSheet, magnitudeWarning } from '../utils/kpiBaseImport';
import { getWorkDate } from '../utils/workDate';
import { PLANT_BASE_KEY } from '../utils/kpiFormula';

const MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const fmt = (v) => (v == null ? '–' : Number(v).toLocaleString('th-TH', { maximumFractionDigits: 2 }));
const memKey = (sheet) => `esm.kpiBaseImport.${sheet}`;
const loadMem = (sheet) => { try { return JSON.parse(localStorage.getItem(memKey(sheet)) || 'null'); } catch { return null; } };
const saveMem = (sheet, v) => { try { localStorage.setItem(memKey(sheet), JSON.stringify(v)); } catch { /* private mode */ } };

/**
 * @param base       buildBaseIndex ของปีนี้ (ไว้โชว์ค่าที่มีอยู่)
 * @param unitSk     scopeKey ของหน่วยที่ดู ('plant' = ทั้งโรงงาน)
 * @param canPlant   เขียนค่ากลางได้ไหม (ดู ทั้งโรงงาน + สิทธิ์) · canUnit เขียนยอดเงินของหน่วยได้ไหม
 * @param onSave     async (values {varKey:{month:value}}) → จำนวนที่บันทึก
 */
const MONTH_TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

export default function KpiBaseImportModal({ year, unitLabel, unitSk, base, canPlant, canUnit, onSave, onClose }) {
  const [file, setFile] = useState(null);
  const [wb, setWb] = useState(null);            // { sheets: {name: grid} }
  const [sheet, setSheet] = useState('');
  const [monthRow, setMonthRow] = useState(null); // แถวหัวเดือนที่ใช้ (override ได้)
  const [varRows, setVarRows] = useState({});
  const [mult, setMult] = useState(1);
  /* เดือนล่าสุดที่ปิดแล้ว — คอลัมน์ Rolling/Plan ของเดือนถัดไปมีตัวเลข (= แผน) ห้ามนำเข้าเป็นจริง · ปีปัจจุบัน = เดือนก่อนหน้าวันทำงาน (รายงานเดือน m ออกต้นเดือน m+1) · ปีย้อนหลัง = 12 */
  const [maxMonth, setMaxMonth] = useState(() => { const wd = getWorkDate(); const [y, m] = wd.split('-').map(Number); return Number(year) < y ? 12 : (Number(year) > y ? 0 : Math.max(1, m - 1)); });
  const [on, setOn] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const grid = wb?.sheets?.[sheet] || null;
  const labels = useMemo(() => (grid ? rowLabels(grid) : []), [grid]);
  const detectedMonths = useMemo(() => (grid ? detectMonthColumns(grid) : null), [grid]);
  const monthInfo = useMemo(() => {
    if (!grid) return null;
    if (monthRow != null && monthRow !== detectedMonths?.row) return detectMonthColumns(grid, { row: monthRow });
    return detectedMonths;
  }, [grid, monthRow, detectedMonths]);
  const monthCols = useMemo(() => limitMonths(monthInfo?.cols || {}, maxMonth), [monthInfo, maxMonth]);
  const rollingM = useMemo(() => rollingMonths(monthInfo?.how || {}).filter(m => m <= maxMonth), [monthInfo, maxMonth]);
  const values = useMemo(() => (grid ? extractValues(grid, { varRows, monthCols, multiplier: mult }) : {}), [grid, varRows, monthCols, mult]);
  const magWarn = useMemo(() => magnitudeWarning(values, mult), [values, mult]);

  const pick = async (f) => {
    setFile(f); setErr(''); setWb(null); setSheet('');
    if (!f) return;
    try {
      const XLSX = await import('xlsx');
      const book = XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: true });
      const sheets = {};
      book.SheetNames.forEach((name) => { sheets[name] = XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, raw: true, defval: null, blankrows: false }); });
      setWb({ sheets, names: book.SheetNames });
      setSheet(bestSheet(sheets) || book.SheetNames[0] || '');   // ไฟล์บัญชีมี 10+ ชีท — เลือกชีทที่จับตัวแปรได้มากสุดก่อน (เปลี่ยนเองได้)
    } catch (e) {
      setErr('อ่านไฟล์ไม่ได้: ' + (e?.message || e));
    }
  };

  /* เปลี่ยนชีท → เดาใหม่ · ถ้าเคยจำแผนที่ของชีทนี้ไว้ ใช้ป้ายที่จำมาจับแถวก่อน */
  useEffect(() => {
    if (!grid) return;
    const mem = loadMem(sheet);
    const auto = detectVarRows(grid);
    const next = { ...auto };
    if (mem?.labels) {
      Object.entries(mem.labels).forEach(([k, lab]) => { const hit = labels.find(x => x.label === lab); if (hit) next[k] = hit.row; });
    }
    setVarRows(next);
    setMult(mem?.mult || 1);
    setMonthRow(detectMonthColumns(grid)?.row ?? null);
    setOn(Object.fromEntries(Object.keys(next).map(k => [k, true])));
  }, [grid, sheet, labels]);

  const writable = (v) => (v.level === 'plant' ? canPlant : canUnit);
  const targetOf = (v) => (v.level === 'plant' ? 'ทั้งโรงงาน' : unitLabel);
  const skOf = (v) => (v.level === 'plant' ? PLANT_BASE_KEY : unitSk);
  const chosen = KPI_BASE_VARS.filter(v => on[v.key] && values[v.key] && writable(v));
  const nCells = chosen.reduce((a, v) => a + Object.keys(values[v.key]).length, 0);

  const doImport = async () => {
    if (!chosen.length) { toast.error('ยังไม่มีตัวแปรที่พร้อมนำเข้า — เลือกแถวให้ตัวแปรก่อน'); return; }
    setBusy(true);
    const payload = Object.fromEntries(chosen.map(v => [v.key, values[v.key]]));
    const n = await onSave(payload);
    setBusy(false);
    if (n > 0) {
      saveMem(sheet, { labels: Object.fromEntries(Object.entries(varRows).filter(([, r]) => r != null).map(([k, r]) => [k, labels.find(x => x.row === r)?.label || ''])), mult });
      toast.success(`นำเข้าแล้ว ${n} ค่า จาก "${file?.name}" (${sheet})`);
      onClose?.();
    }
  };

  const inp = { padding: '4px 6px', fontSize: 12, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)' };
  const th = { padding: '3px 4px', fontSize: 11, color: 'var(--muted)', fontWeight: 700, borderBottom: '1px solid var(--border)', textAlign: 'center', whiteSpace: 'nowrap' };
  const td = { padding: '3px 4px', fontSize: 11.5, borderBottom: '1px solid var(--border)', textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' };
  const months = Object.values(monthCols).sort((a, b) => a - b);

  return (
    /* ห้ามปิดจากคลิกพื้นหลัง — มีฟอร์มที่คนกำลังเลือกแถว (ด่าน modal-closes-on-backdrop) */
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, boxShadow: 'var(--shadow-lg)', width: 'min(1180px, 100%)', maxHeight: '92vh', overflow: 'auto', padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <b style={{ fontSize: 14, color: 'var(--text)' }}>📥 นำเข้าตัวเลขฐานจาก Excel ของบัญชี — ปี {year + 543}</b>
          <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>ค่ากลาง → ทั้งโรงงาน · ยอดเงินของหน่วย → {unitLabel}</span>
          <span style={{ flex: 1 }} />
          <button onClick={onClose} style={{ ...inp, cursor: 'pointer' }}>ปิด</button>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
          <input type="file" accept=".xlsx,.xlsm,.xlsb,.xls,.csv" onChange={e => pick(e.target.files?.[0] || null)} style={{ fontSize: 12 }} />
          {wb && (
            <>
              <span style={{ fontSize: 12, color: 'var(--text2)' }}>ชีท</span>
              <select style={inp} value={sheet} onChange={e => setSheet(e.target.value)}>{wb.names.map(n => <option key={n} value={n}>{n}</option>)}</select>
              <span style={{ fontSize: 12, color: 'var(--text2)' }}>หน่วยเงินในไฟล์</span>
              <select style={inp} value={mult} onChange={e => setMult(Number(e.target.value))}>{IMPORT_MULTIPLIERS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}</select>
              <span style={{ fontSize: 12, color: 'var(--text2)' }}>ถึงเดือน</span>
              <select style={inp} value={maxMonth} onChange={e => setMaxMonth(Number(e.target.value))} title="เดือนล่าสุดที่บัญชีปิดแล้ว — เดือนหลังจากนี้ในไฟล์เป็นแผน/Rolling ไม่นำเข้า">
                <option value={0}>— ไม่นำเข้า —</option>
                {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{MONTH_TH[i]}</option>)}
              </select>
              <span style={{ fontSize: 12, color: 'var(--text2)' }}>แถวหัวเดือน</span>
              <select style={inp} value={monthRow ?? ''} onChange={e => setMonthRow(e.target.value === '' ? null : Number(e.target.value))}>
                <option value="">— ไม่พบ —</option>
                {grid.map((r, i) => <option key={i} value={i}>แถว {i + 1}: {(r || []).slice(0, 6).map(c => (c instanceof Date ? c.toISOString().slice(0, 7) : String(c ?? ''))).join(' | ').slice(0, 60)}</option>)}
              </select>
            </>
          )}
        </div>
        {err && <div style={{ marginTop: 8, color: '#ef4444', fontSize: 12.5 }}>{err}</div>}
        {wb && monthInfo?.subRow != null && (
          <div style={{ marginTop: 6, fontSize: 12, color: '#38bdf8' }}>ℹ️ หัวเดือนคร่อมบล็อก PLAN | Rolling | ACTUAL — ใช้คอลัมน์ <b>ACTUAL → Amount</b> ของแต่ละเดือน (แถว {monthInfo.subRow + 1})</div>
        )}
        {wb && rollingM.length > 0 && (
          <div style={{ marginTop: 6, fontSize: 12.5, color: '#f59e0b' }}>⚠ เดือน {rollingM.map(m => MONTH_TH[m - 1]).join(' · ')} ไม่มีคอลัมน์ ACTUAL — ใช้ <b>Rolling</b> แทน (เดือนที่ยังไม่ปิด Rolling = แผน) · ลด "ถึงเดือน" ถ้าไม่ใช่ตัวเลขจริง</div>
        )}
        {wb && magWarn && <div style={{ marginTop: 6, fontSize: 12.5, color: '#f59e0b' }}>{magWarn}</div>}
        {wb && !Object.keys(monthInfo?.cols || {}).length && (
          <div style={{ marginTop: 8, fontSize: 12.5, color: '#f59e0b' }}>⚠ ยังหาแถวหัวเดือนไม่เจอ (ต้องมีช่อง Jan/Feb… หรือ ม.ค./ก.พ.… หรือเลข 1–12 อย่างน้อย 6 ช่อง) — เลือกแถวเองจากช่อง "แถวหัวเดือน"</div>
        )}
        {grid && (
          <div style={{ overflowX: 'auto', marginTop: 10 }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: 'left' }}>นำเข้า</th>
                  <th style={{ ...th, textAlign: 'left' }}>ตัวแปร → เขียนที่</th>
                  <th style={{ ...th, textAlign: 'left' }}>แถวในไฟล์</th>
                  {months.map(m => <th key={m} style={th}>{MONTHS[m - 1]}</th>)}
                </tr>
              </thead>
              <tbody>
                {KPI_BASE_VARS.map((v) => {
                  const row = varRows[v.key];
                  const vals = values[v.key] || {};
                  const sk = skOf(v);
                  const ok = writable(v);
                  return (
                    <tr key={v.key} style={{ opacity: ok ? 1 : 0.55 }}>
                      <td style={{ ...td, textAlign: 'center' }}>
                        <input type="checkbox" checked={!!on[v.key] && ok && row != null} disabled={!ok || row == null} onChange={e => setOn(p => ({ ...p, [v.key]: e.target.checked }))} />
                      </td>
                      <td style={{ ...td, textAlign: 'left', whiteSpace: 'normal', minWidth: 190 }}>
                        <b>{v.label}</b> <span style={{ color: 'var(--muted)' }}>({v.unit})</span>
                        <div style={{ fontSize: 11, color: ok ? 'var(--muted)' : '#f59e0b' }}>→ {targetOf(v)}{!ok ? (v.level === 'plant' ? ' · นำเข้าได้เฉพาะตอนดู ทั้งโรงงาน' : ' · ไม่มีสิทธิ์เขียนขอบเขตนี้') : ''}</div>
                      </td>
                      <td style={{ ...td, textAlign: 'left' }}>
                        <select style={{ ...inp, maxWidth: 260 }} value={row ?? ''} onChange={e => setVarRows(p => ({ ...p, [v.key]: e.target.value === '' ? null : Number(e.target.value) }))}>
                          <option value="">— ไม่นำเข้า —</option>
                          {labels.map(x => <option key={x.row} value={x.row}>แถว {x.row + 1}: {x.label.slice(0, 50)}</option>)}
                        </select>
                      </td>
                      {months.map((m) => {
                        const nv = vals[m];
                        const old = base?.get ? base.get(sk, v.key, m) : null;
                        const changed = nv != null && old != null && Math.abs(nv - old) > 1e-9;
                        return (
                          <td key={m} style={td} title={old != null ? `ค่าที่มีอยู่: ${fmt(old)}` : 'ยังไม่มีค่า'}>
                            <div style={{ color: nv == null ? 'var(--muted)' : changed ? '#f59e0b' : 'var(--text)' }}>{fmt(nv)}</div>
                            {old != null && <div style={{ fontSize: 11, color: 'var(--muted)', textDecoration: changed ? 'line-through' : 'none' }}>{fmt(old)}</div>}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 6, lineHeight: 1.6 }}>
              สีส้ม = ค่าใหม่ต่างจากที่มีอยู่ (ค่าเดิมขีดฆ่า) · ช่อง "–" ในไฟล์ = ไม่นำเข้า (ไม่เขียนทับด้วย 0) · ระบบจำแถวที่เลือกของชีท "{sheet}" ไว้ในเครื่องนี้ให้เดือนหน้า
            </div>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button onClick={onClose} style={{ ...inp, cursor: 'pointer' }}>ยกเลิก</button>
          <button onClick={doImport} disabled={busy || !nCells}
            style={{ ...inp, cursor: nCells ? 'pointer' : 'not-allowed', background: nCells ? 'var(--accent)' : 'var(--bg2)', color: nCells ? 'var(--accent-ink)' : 'var(--muted)', fontWeight: 700 }}>
            {busy ? '⏳ กำลังบันทึก…' : `💾 นำเข้า ${nCells} ค่า (${chosen.length} ตัวแปร)`}
          </button>
        </div>
      </div>
    </div>
  );
}
