/* 📥 นำเข้าไฟล์ V5 %Customer Satisfaction ของ QSM → คะแนนรายลูกค้า × Q/D × เดือน (2026-11-24 · user: "อัพ customer satisfaction ให้ที แยก Q/D และเจาะรายลูกค้า · อัพโหลดเองผ่านโปรแกรมได้รึยัง")
   · ตัวแกะ = `src/utils/csatImport.js` (ตัวเดียวกับ CLI scripts/acct-import/import_csat.mjs) · ตัวอ่าน xlsx = import แบบ lazy
   · เขียนที่ `kpi_csat_scores` (ผ่าน onSave ของแผง — ด่านสิทธิ์อยู่ที่ฟังก์ชันเขียนจริง) · trigger ฝั่ง DB รวมเป็นตัวแปรฐาน csat_* ให้เอง
   · ตรวจก่อนบันทึก: ค่ารวมที่ระบบคิด vs Overall ในไฟล์ ต้องตรง — ไม่ตรง = เขียนบอกบนจอ (ยังนำเข้าได้ แต่คนต้องเห็น) */
import { useMemo, useState } from 'react';
import { toast } from './Toast';
import { parseCsatBook, csatFileMeta, CSAT_KIND_LABEL } from '../utils/csatImport';
import { importLabel, whichImport } from '../utils/importRegistry';
import { ImportInfo, WrongFileNote } from './ImportKit';
import { tr } from '../utils/i18n';
import { monthsShort } from '../utils/dateFormat';
import { toneVar } from '../utils/statusTone';

const scoreTone = (s) => (s == null ? null : s >= 1 ? 'good' : s > 0 ? 'warn' : 'bad');
const pct = (v) => (v == null ? '—' : `${Number(v).toFixed(2).replace(/\.?0+$/, '')} %`);

export default function KpiCsatImportModal({ year, onSave, onClose }) {
  const [file, setFile] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [wrong, setWrong] = useState(null);
  const [maxMonth, setMaxMonth] = useState(12);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const pick = async (f) => {
    setFile(f); setErr(''); setParsed(null); setWrong(null);
    if (!f) return;
    try {
      const XLSX = await import('xlsx');
      const book = XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: true });
      const grids = {};
      book.SheetNames.forEach((name) => { grids[name] = XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, raw: true, defval: null, blankrows: false }); });
      const r = parseCsatBook({ names: book.SheetNames, grids }, { year });
      if (!r.sheet) {
        /* 📥 ไม่ใช่ไฟล์ V5 — เป็นไฟล์ของจุดนำเข้าอื่นไหม (§6.44 ข้อ 4) */
        const other = whichImport(book.SheetNames.map(name => ({ name, rows: grids[name] })), 'kpi_csat');
        if (other) { setWrong(other); return; }
        setErr(r.warnings.join(' · ') || tr('อ่านไฟล์ไม่ได้'));
        return;
      }
      setParsed(r);
      const meta = csatFileMeta(f.name);
      const last = r.rows.length ? Math.max(...r.rows.map(x => x.month)) : 0;
      setMaxMonth(meta.month || last || 12);
    } catch (e) {
      setErr(tr('อ่านไฟล์ไม่ได้: ') + (e?.message || e));
    }
  };

  const customers = useMemo(() => (parsed ? [...new Set(parsed.rows.map(x => x.customer))] : []), [parsed]);
  const months = useMemo(() => (parsed ? parsed.months.filter(m => m <= maxMonth && parsed.rows.some(x => x.month === m)) : []), [parsed, maxMonth]);
  const chosen = useMemo(() => (parsed ? parsed.rows.filter(x => x.month <= maxMonth) : []), [parsed, maxMonth]);
  const cell = (c, kind, m) => parsed.rows.find(x => x.customer === c && x.kind === kind && x.month === m) || null;

  const doImport = async () => {
    if (!chosen.length) { toast.error(tr('ไม่มีแถวที่จะนำเข้า')); return; }
    setBusy(true);
    const n = await onSave(chosen, { file: file?.name || '', bands: parsed.bands, year: parsed.year });
    setBusy(false);
    if (n > 0) { toast.success(`${tr('นำเข้าแล้ว')} ${n} ${tr('แถว จาก')} "${file?.name}" (${parsed.sheet})`); onClose?.(); }
  };

  const inp = { padding: '4px 6px', fontSize: 12, borderRadius: 'var(--ctl-r)', border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)' };
  const th = { padding: '3px 5px', fontSize: 11, color: 'var(--muted)', fontWeight: 700, borderBottom: '1px solid var(--border)', textAlign: 'center', whiteSpace: 'nowrap' };
  const td = { padding: '3px 5px', fontSize: 11.5, borderBottom: '1px solid var(--border)', textAlign: 'center', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' };
  const dot = (tone) => <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: toneVar(tone), marginRight: 4, verticalAlign: 'middle' }} />;

  return (
    /* ห้ามปิดจากคลิกพื้นหลัง — มีตารางตรวจก่อนบันทึก (ด่าน modal-closes-on-backdrop) */
    <div style={{ position: 'fixed', inset: 0, background: 'var(--scrim)', WebkitBackdropFilter: 'var(--scrim-blur)', backdropFilter: 'var(--scrim-blur)', zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
      <div style={{ background: 'var(--card-surf)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', boxShadow: 'var(--shadow-lg)', width: 'min(1180px, 100%)', maxHeight: '92vh', overflow: 'auto', padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <b style={{ fontSize: 14, color: 'var(--text)' }}>📥 {tr(importLabel('kpi_csat'))} — {tr('ปี')} {year + 543}</b>
          <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{tr('คะแนนรายลูกค้า × ส่งมอบ/คุณภาพ × เดือน → ระบบรวมเป็น Customer Satisfaction (Q&D) ของทั้งโรงงานให้เอง')}</span>
          <span style={{ flex: 1 }} />
          <button type="button" className="pg-btn sm" onClick={onClose}>{tr('ปิด')}</button>
        </div>
        <div style={{ marginTop: 10 }}><ImportInfo k="kpi_csat" /></div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
          <input type="file" accept=".xlsx,.xlsm,.xls" onChange={e => pick(e.target.files?.[0] || null)} style={{ fontSize: 12 }} />
          {parsed && (
            <>
              <span style={{ fontSize: 12, color: 'var(--text2)' }}>{tr('ชีท')} <b>{parsed.sheet}</b></span>
              <span style={{ fontSize: 12, color: 'var(--text2)' }}>{tr('ถึงเดือน')}</span>
              <select style={inp} value={maxMonth} onChange={e => setMaxMonth(Number(e.target.value))} title={tr('เดือนล่าสุดที่ QSM ประเมินแล้ว (จากชื่อไฟล์) — เดือนหลังจากนี้ไม่นำเข้า')}>
                {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{tr(monthsShort()[i])}</option>)}
              </select>
            </>
          )}
        </div>
        {err && <div style={{ marginTop: 8, color: 'var(--red)', fontSize: 12.5 }}>{err}</div>}
        {wrong && <div style={{ marginTop: 8 }}><WrongFileNote k={wrong} here="kpi_csat" onGo={onClose} /></div>}
        {parsed?.warnings?.length > 0 && parsed.warnings.map((w, i) => <div key={i} style={{ marginTop: 6, fontSize: 12, color: 'var(--amber)' }}>ℹ️ {w}</div>)}
        {parsed?.mismatch?.length > 0 && (
          <div style={{ marginTop: 6, fontSize: 12.5, color: 'var(--red)', fontWeight: 700 }}>
            ⚠ {tr('ค่ารวมที่ระบบคิดไม่ตรงกับไฟล์')}: {parsed.mismatch.map(x => `${x.kind} ${monthsShort()[x.month - 1]} ${tr('ไฟล์')} ${pct(x.sheet)} / ${tr('ระบบ')} ${pct(x.computed)}`).join(' · ')}
            <div style={{ fontWeight: 500, color: 'var(--text2)' }}>{tr('ระบบนับเฉพาะลูกค้าที่ประเมิน (ไม่ใช่ *) แล้วคิด Σคะแนน ÷ จำนวน — ถ้าไฟล์ใช้วิธีอื่น ให้เช็คกับ QSM ก่อนนำเข้า')}</div>
          </div>
        )}
        {parsed && (
          <div style={{ overflowX: 'auto', marginTop: 10 }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr><th style={{ ...th, textAlign: 'left' }}>{tr('ลูกค้า')}</th><th style={th}>{tr('ด้าน')}</th><th style={{ ...th, textAlign: 'left' }}>{tr('เกณฑ์ A')}</th>
                  {months.map(m => <th key={m} style={th}>{tr(monthsShort()[m - 1])}</th>)}</tr>
              </thead>
              <tbody>
                {customers.flatMap(c => ['delivery', 'quality'].map(kind => {
                  const b = parsed.bands[`${c}|${kind}`];
                  const rm = parsed.rows.find(x => x.customer === c && x.kind === kind && x.remark)?.remark;
                  return (
                    <tr key={`${c}|${kind}`}>
                      <td style={{ ...td, textAlign: 'left', fontWeight: 700 }}>{c}{rm && <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--muted)', whiteSpace: 'normal' }}>{rm}</div>}</td>
                      <td style={td}>{tr(CSAT_KIND_LABEL[kind])}</td>
                      <td style={{ ...td, textAlign: 'left', color: 'var(--muted)' }}>{b?.a ?? '—'}</td>
                      {months.map(m => {
                        const x = cell(c, kind, m);
                        if (!x) return <td key={m} style={{ ...td, color: 'var(--muted)' }}>—</td>;
                        if (!x.evaluated) return <td key={m} style={{ ...td, color: 'var(--muted)' }} title={tr('ไม่ประเมินเดือนนี้ (*)')}>*</td>;
                        return <td key={m} style={td} title={`${tr('ผล')} ${x.result} · ${tr('คะแนน')} ${x.score}`}>{dot(scoreTone(x.score))}{x.result}</td>;
                      })}
                    </tr>
                  );
                }))}
                {['delivery', 'quality', 'overall'].map(k => (
                  <tr key={k} style={{ background: 'var(--bg2)' }}>
                    <td style={{ ...td, textAlign: 'left', fontWeight: 800 }} colSpan={3}>{k === 'overall' ? tr('รวม Q&D (ที่ระบบจะโชว์)') : `${tr('รวม')} ${tr(CSAT_KIND_LABEL[k])}`}</td>
                    {months.map(m => <td key={m} style={{ ...td, fontWeight: 700 }}>{pct(parsed.totals.computed[k][m])}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 6 }}>● {tr('เขียว = เกรด A (1) · เหลือง = B (0.5) · แดง = C (0) · ตัวเลขในช่อง = ผลดิบจากลูกค้า (คะแนน/PPM) · * = ไม่ประเมิน')}</div>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button type="button" className="pg-btn sm" onClick={onClose}>{tr('ยกเลิก')}</button>
          <button type="button" className="pg-btn sm primary" disabled={!chosen.length || busy} onClick={doImport}>
            {busy ? '⏳' : '📥'} {tr('บันทึก')} {chosen.length} {tr('แถว')} ({customers.length} {tr('ลูกค้า')} · {months.length} {tr('เดือน')})
          </button>
        </div>
      </div>
    </div>
  );
}
