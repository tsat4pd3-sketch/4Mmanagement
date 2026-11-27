import { useState, useEffect, useCallback, useMemo, useContext } from 'react';
import { supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { toast } from './Toast';
import { can } from '../utils/permissions';
import { getActor } from '../utils/actorStamp';
import { askConfirm } from '../utils/askConfirm';
import { checkWriteRows } from '../utils/dbWrite';
import { fetchAllRows } from '../utils/fetchAllRows';
import { parseMb52, parseMb52File, diffOf, summarizeBySloc, hintsOf, ESM_BASIS_LABEL } from '../utils/mb52Import';
import { storeBtn } from '../utils/storeUi';
import FilterBar from './FilterBar';
import SearchInput from './SearchInput';
import MatLabel from './MatLabel';
import InfoMore from './InfoMore';
import { tr, dateLocale } from '../utils/i18n';
import { ImportButton, ImportInfo, WrongFileNote } from './ImportKit';
import { importLabel, whichImport, rowsFromText } from '../utils/importRegistry';
import { decodeSapExport } from '../utils/sapBomImport';

/* ═══ 📊 เทียบยอดคงคลัง SAP (MB52) กับระบบ — รายสัปดาห์ (2026-11-20 · คำสั่ง user)
   user: *"หน้างานจริงกับ SAP ไม่ตรงกัน … แต่ละส่วนงานจดสมุดลง Excel เอาไว้เทียบกับ SAP ปลายสัปดาห์/สิ้นเดือน
          อยากให้ระบบแทน manual ได้ และแม่นยำ เพื่อไว้เทียบชนกับ SAP"*
   · อัปโหลด MB52 (TSV UTF-16 .xls / .xlsx) → แกะที่จอ (`utils/mb52Import.js`) → RPC `sap_stock_upload_create` (DR)
     บันทึกรอบ + **ตรึงยอดระบบ ณ เวลาอัปโหลด** (user เลือก) ลง `sap_stock_compare` — ดูย้อนหลังได้ ตัวเลขไม่ขยับ
   · เทียบ **เฉพาะรหัสคลังที่อยู่ในไฟล์** (ไฟล์ทีละคลังได้) · ฝั่งระบบ: P4xx = ไลน์ที่ผูก · STORE/FG = ที่จัดเก็บหลักของพาร์ท
     ไม่ได้ตั้งที่จัดเก็บหลัก = รหัสเทียม STORE? / FG? (ห้ามเดา) · เทียบกับ Unrestr. (QI/Blocked โชว์ข้าง)
   · สิทธิ์อัปโหลด/ลบรอบ = `line_stock:issue` · ดูได้ทุกคนที่เข้าหน้า */
const UP_COLS = 'id, created_at, cutoff_at, report_date, file_name, slocs, sap_rows, uploaded_by';
const CMP_COLS = 'id, sloc, mat_no, part_name, bun, sap_qty, sap_qi, sap_blocked, sap_src_rows, esm_qty, esm_basis, hint_gap, hint_rcpt, hint_po';
const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString(undefined, { maximumFractionDigits: 3 }));
const when = (iso) => (iso ? new Date(iso).toLocaleString(dateLocale(), { timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');

/* 📥 แกะไม่ผ่าน ⇒ ถามทะเบียนกลางว่าเป็นไฟล์ของจุดนำเข้าอื่นไหม (`wrong` · ไม่รู้จัก = null) */
async function readFile(file) {
  const buf = await file.arrayBuffer();
  const b = new Uint8Array(buf);
  if (b[0] === 0x50 && b[1] === 0x4b) {           // PK = .xlsx จริง (บางคน export เป็น Spreadsheet)
    const XLSX = await import('xlsx');
    const wb = XLSX.read(buf);
    const r = parseMb52(XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]], { FS: '\t', RS: '\n' }));
    if (r.ok) return r;
    const sheets = wb.SheetNames.map(name => ({ name, rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' }) }));
    return { ...r, wrong: whichImport(sheets, 'sap_mb52') };
  }
  const r = parseMb52File(buf);                    // TSV UTF-16 แบบที่ SAP คาย (.xls)
  if (r.ok) return r;
  return { ...r, wrong: whichImport([{ name: file.name, rows: rowsFromText(decodeSapExport(buf)) }], 'sap_mb52') };
}

export default function SapStockCompare() {
  const { role, fullName } = useContext(UserContext);
  const canUpload = can('line_stock', 'issue', role);
  const [uploads, setUploads] = useState([]);
  const [upErr, setUpErr] = useState('');
  const [sel, setSel] = useState(null);
  const [rows, setRows] = useState([]);
  const [rowErr, setRowErr] = useState('');
  const [loadingRows, setLoadingRows] = useState(false);
  const [parsed, setParsed] = useState(null);       // ผลแกะไฟล์ที่รออัปโหลด
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [sloc, setSloc] = useState('');
  const [onlyDiff, setOnlyDiff] = useState(true);
  const [q, setQ] = useState('');
  const [showUp, setShowUp] = useState(false);   // หน้าต่างอัปโหลด (24/11)

  const loadUploads = useCallback(async () => {
    const { data, error } = await supabaseDR.from('sap_stock_uploads').select(UP_COLS)
      .order('created_at', { ascending: false }).limit(52);
    setUpErr(error ? error.message : '');
    if (!error) {
      setUploads(data || []);
      setSel(cur => cur && (data || []).some(u => u.id === cur) ? cur : (data?.[0]?.id || null));
    }
  }, []);
  useEffect(() => { loadUploads(); }, [loadUploads]);

  useEffect(() => {
    let alive = true;
    if (!sel) { setRows([]); return undefined; }
    setLoadingRows(true);
    fetchAllRows(supabaseDR, 'sap_stock_compare', CMP_COLS, qy => qy.eq('upload_id', sel).order('id')).then(({ data, error }) => {
      if (!alive) return;
      setLoadingRows(false);
      setRowErr(error ? error.message : '');
      setRows(error ? [] : (data || []));
      setSloc('');
    });
    return () => { alive = false; };
  }, [sel]);

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setFileName(f.name);
    try { setParsed(await readFile(f)); }
    catch (err) { setParsed({ ok: false, error: `${tr("อ่านไฟล์ไม่ได้")}: ${err.message}`, rows: [] }); }
  };

  const save = async () => {
    if (!canUpload || !parsed?.ok) return false;
    setBusy(true);
    const a = getActor();
    const { data, error } = await supabaseDR.rpc('sap_stock_upload_create', {
      p_meta: { uploaded_by: fullName || a.name || '', uploaded_by_uid: a.uid || null, file_name: fileName,
        report_date: parsed.reportDate, sap_rows: parsed.srcRows },
      p_rows: parsed.rows,
    });
    setBusy(false);
    if (error) { toast.error(`${tr("บันทึกไม่สำเร็จ")} — ${error.message}`); return false; }
    toast.success(`✅ ${tr("บันทึกรอบเทียบแล้ว")} · ${(data?.slocs || []).join(', ')} · ${data?.compare_rows || 0} ${tr("แถว (ตรึงยอดระบบ ณ ตอนนี้")})`);
    setParsed(null); setFileName('');
    await loadUploads();
    if (data?.id) setSel(data.id);
    return true;
  };

  const remove = async (u) => {
    if (!canUpload) return;
    if (!await askConfirm(`${tr("ลบรอบเทียบ")} ${u.file_name || ''} (${(u.slocs || []).join(', ')}) ${tr("ที่อัปโหลด")} ${when(u.created_at)}?\n${tr("ใช้เมื่ออัปโหลดไฟล์ผิด — ลบแล้วกู้คืนไม่ได้")}`)) return;
    const ok = checkWriteRows(await supabaseDR.from('sap_stock_uploads').delete().eq('id', u.id).select('id'), 'ลบรอบเทียบ SAP');
    if (ok) { toast.success('ลบรอบแล้ว'); setSel(null); loadUploads(); }
  };

  const cur = uploads.find(u => u.id === sel) || null;
  const summary = useMemo(() => summarizeBySloc(rows), [rows]);
  const s = q.trim().toLowerCase();
  const shown = useMemo(() => rows
    .filter(r => (!sloc || r.sloc === sloc) && (!onlyDiff || diffOf(r) !== 0)
      && (!s || [r.mat_no, r.part_name].some(v => String(v ?? '').toLowerCase().includes(s))))
    .sort((a, b) => Math.abs(diffOf(b)) - Math.abs(diffOf(a))), [rows, sloc, onlyDiff, s]);
  const unknownPile = rows.filter(r => r.esm_basis === 'pile_unknown').length;

  const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: 12, marginBottom: 12, boxShadow: 'var(--shadow-sm)' };
  const th = { padding: '6px 8px', fontSize: 12, color: 'var(--muted)', textAlign: 'left', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)' };
  const thR = { ...th, textAlign: 'right' };
  const td = { padding: '6px 8px', fontSize: 13, borderBottom: '1px solid var(--border2)', verticalAlign: 'top' };
  const tdR = { ...td, textAlign: 'right', whiteSpace: 'nowrap' };
  const diffColor = (d) => (d === 0 ? 'var(--green)' : 'var(--red)');

  /* 📋 24/11 (คำสั่ง user "จัดแท็บ MB52 ให้ด้วย") — ลำดับมาตรฐาน: **แถบกรองเดียว** (รอบเทียบ · รหัสคลัง · เฉพาะที่ต่าง ·
     ค้นหา · ⓘ · 📤 อัปโหลด) → ข้อมูลรอบ → ตัวเลขสรุปรายคลัง → ตาราง · การ์ดอัปโหลด/ปุ่มรอบที่เคยอยู่เหนือแถบกรอง
     ย้ายเข้าแถบกรอง (เลือกรอบ = dropdown) และหน้าต่างอัปโหลด (กดปุ่มเปิด) · ตรรกะอัปโหลด/เทียบเหมือนเดิมทุกตัว */
  const upload = parsed !== null || showUp;
  const slocOpts = summary.map(x => x.sloc);
  const anyFilter = !!sloc || !onlyDiff || !!q;
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <FilterBar onClear={anyFilter ? () => { setSloc(''); setOnlyDiff(true); setQ(''); } : undefined}>
        <select value={sel || ''} onChange={e => setSel(e.target.value || null)} aria-label={tr('รอบเทียบ')} disabled={!uploads.length}>
          {!uploads.length && <option value="">{tr('ยังไม่มีรอบเทียบ')}</option>}
          {uploads.map(u => <option key={u.id} value={u.id}>{tr('รอบ')} {when(u.created_at)} · {(u.slocs || []).join(', ')}</option>)}
        </select>
        <select value={sloc} onChange={e => setSloc(e.target.value)} aria-label={tr('รหัสคลัง')} disabled={!slocOpts.length}>
          <option value="">{tr('ทุกรหัสคลังในรอบนี้')}</option>
          {slocOpts.map(x => <option key={x} value={x}>{x}</option>)}
        </select>
        <label style={{ fontSize: 13, display: 'flex', gap: 4, alignItems: 'center' }}>
          <input type="checkbox" checked={onlyDiff} onChange={e => setOnlyDiff(e.target.checked)} /> {tr('เฉพาะที่ต่าง')}
        </label>
        <SearchInput value={q} onChange={setQ} placeholder={tr('ค้นหา MAT / ชื่อพาร์ท')} />
        <span className="spacer" />
        <InfoMore label={tr('วิธีใช้')}>
          {tr('อัปโหลดไฟล์ MB52 ที่ SAP export (.xls หรือ .xlsx) ทีละคลังหรือหลายคลังก็ได้ — ระบบเทียบเฉพาะรหัสคลังที่อยู่ในไฟล์ · ยอดฝั่งระบบตรึง ณ เวลาที่กดบันทึก (ดูย้อนหลังได้ ตัวเลขไม่ขยับ) · ต่าง = ระบบเรา − SAP · เทียบกับ Unrestr. (QI/Blocked โชว์ข้าง)')}
        </InfoMore>
        {canUpload && <ImportButton k="sap_mb52" onClick={() => setShowUp(true)} />}
      </FilterBar>

      {!canUpload && <div style={{ color: 'var(--amber)', fontSize: 13 }}>🔒 {tr('ดูอย่างเดียว — อัปโหลด/ลบรอบต้องมีสิทธิ์ line_stock:issue')}</div>}
      {upErr && <div style={{ color: 'var(--red)', fontSize: 13 }}>⚠ {tr('โหลดรายการรอบไม่สำเร็จ')}: {upErr}</div>}
      {!upErr && !uploads.length && <div style={{ padding: 30, textAlign: 'center', fontSize: 13, color: 'var(--muted)' }}>{tr('ยังไม่มีรอบเทียบ — กด')} 📥 {tr(importLabel('sap_mb52'))}</div>}

      {cur && <>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 13, color: 'var(--text2)' }}>
          <span>📊 <b style={{ color: 'var(--text)' }}>{cur.file_name || tr('ไม่มีชื่อไฟล์')}</b></span>
          <span>· {tr('วันที่ SAP')} {cur.report_date || '—'} · {tr('ตรึงยอดระบบ')} {when(cur.cutoff_at)} · {tr('โดย')} {cur.uploaded_by || '—'} · {fmt(cur.sap_rows)} {tr('บรรทัดในไฟล์')}</span>
          {canUpload && <button type="button" style={{ ...storeBtn('secondary'), minHeight: 0, padding: '4px 10px', fontSize: 12, marginLeft: 'auto', color: 'var(--red)' }} onClick={() => remove(cur)}>🗑 {tr('ลบรอบนี้')}</button>}
        </div>
        {rowErr && <div style={{ color: 'var(--red)', fontSize: 13 }}>⚠ {tr('โหลดผลเทียบไม่สำเร็จ')}: {rowErr}</div>}
        {loadingRows && <div style={{ fontSize: 13, color: 'var(--muted)' }}>{tr('กำลังโหลด…')}</div>}
        {!loadingRows && !rowErr && <>
          {/* ตัวเลขสรุปรายคลัง — กดแถว = กรองคลังนั้น (ช่องเดียวกับ dropdown รหัสคลังในแถบกรอง) */}
          <div style={{ ...card, marginBottom: 0, padding: 0, overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 520 }}>
              <thead><tr>
                <th style={th}>{tr('รหัสคลัง')}</th><th style={thR}>SAP</th><th style={thR}>{tr('ระบบเรา')}</th>
                <th style={thR}>MAT</th><th style={thR}>{tr('ตรง')}</th><th style={thR}>{tr('ต่าง')}</th><th style={thR}>{tr('ผลรวมส่วนต่าง')}</th>
              </tr></thead>
              <tbody>{summary.map(x => (
                <tr key={x.sloc} style={{ cursor: 'pointer', background: sloc === x.sloc ? 'var(--accent-dim)' : undefined }} onClick={() => setSloc(sloc === x.sloc ? '' : x.sloc)}>
                  <td style={td}><b>{x.sloc}</b></td><td style={tdR}>{fmt(x.sap)}</td><td style={tdR}>{fmt(x.esm)}</td>
                  <td style={tdR}>{x.mats}</td><td style={{ ...tdR, color: 'var(--green)' }}>{x.match}</td>
                  <td style={{ ...tdR, color: x.diff ? 'var(--red)' : 'var(--muted)' }}>{x.diff}</td><td style={tdR}>{fmt(x.absDiff)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {unknownPile > 0 && <div style={{ fontSize: 12, color: 'var(--amber)' }}>⚠ {unknownPile} {tr('แถวอยู่ในรหัสเทียม STORE?/FG? — พาร์ทยังไม่ได้ตั้งที่จัดเก็บหลัก ระบบจึงไม่รู้ว่าอยู่รหัสคลังไหนใน SAP (ตั้งที่ Part Master)')}</div>}
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            {sloc ? `${tr('รหัสคลัง')} ${sloc} · ` : ''}{tr('แสดง')} {shown.length.toLocaleString()} / {rows.length.toLocaleString()} {tr('แถว')} · {tr('เรียงส่วนต่างมาก→น้อย · ต่าง = ระบบเรา − SAP')}
          </div>
          <div style={{ ...card, marginBottom: 0, padding: 0, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={th}>{tr('รหัสคลัง')}</th><th style={th}>{tr('พาร์ท')}</th>
                <th style={thR}>SAP Unrestr.</th><th style={thR}>{tr('ระบบเรา')}</th><th style={thR}>{tr('ต่าง')}</th><th style={th}>{tr('คำใบ้')}</th>
              </tr></thead>
              <tbody>{shown.map(r => {
                const d = diffOf(r);
                const extra = [Number(r.sap_qi) ? `QI ${fmt(r.sap_qi)}` : null, Number(r.sap_blocked) ? `Blocked ${fmt(r.sap_blocked)}` : null].filter(Boolean).join(' · ');
                return (
                  <tr key={r.id}>
                    <td style={td}>{r.sloc}</td>
                    <td style={td}><MatLabel mat={r.mat_no} name={r.part_name} size={13} /></td>
                    <td style={tdR}>{fmt(r.sap_qty)} {r.bun || ''}{extra && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{extra}</div>}</td>
                    <td style={tdR} title={ESM_BASIS_LABEL[r.esm_basis] || ''}>{fmt(r.esm_qty)}</td>
                    <td style={{ ...tdR, color: diffColor(d), fontWeight: 600 }}>{d > 0 ? '+' : ''}{fmt(d)}</td>
                    <td style={{ ...td, fontSize: 12, color: 'var(--text2)' }}>{hintsOf(r).join(' · ') || '—'}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        </>}
      </>}

      {/* 📤 หน้าต่างอัปโหลด — ตรรกะเดิม (แกะไฟล์ → ดูสรุป → บันทึกและเทียบ) */}
      {upload && canUpload && (
        <div className="overlay">
          <div className="modal" onClick={e => e.stopPropagation()} style={{ width: 'min(640px, 96vw)', maxHeight: '92vh', overflowY: 'auto', display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <b style={{ fontSize: 16 }}>📥 {tr(importLabel('sap_mb52'))}</b>
              <button type="button" onClick={() => { setShowUp(false); setParsed(null); }} aria-label={tr('ปิด')}
                style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--muted)', fontSize: 18, cursor: 'pointer' }}>✕</button>
            </div>
            <ImportInfo k="sap_mb52" />
            <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.6 }}>
              {tr('ไฟล์ .xls ที่ SAP export (หรือ .xlsx) · ไฟล์ทีละคลังหรือหลายคลังก็ได้ — ระบบเทียบเฉพาะรหัสคลังที่อยู่ในไฟล์ · ยอดฝั่งระบบตัด ณ เวลาที่กดบันทึก')}
              <br />{tr('ต้องมีคอลัมน์ Material · SLoc · Unrestr. (ลำดับคอลัมน์ไม่สำคัญ) · แนะนำบันทึก layout กลางใน SAP ให้ทุกคน export แบบเดียวกัน')}
            </div>
            <input type="file" accept=".xls,.xlsx,.txt,.tsv" onChange={onFile} />
            {parsed && (
              <div style={{ padding: 10, borderRadius: 8, background: parsed.ok ? 'var(--green-dim)' : 'var(--red-dim)', border: `1px solid ${parsed.ok ? 'var(--green-line)' : 'var(--red-line)'}` }}>
                {parsed.ok ? <>
                  <div style={{ fontSize: 13 }}>
                    📄 <b>{fileName}</b> · {tr('วันที่ในไฟล์')} {parsed.reportDate || tr('ไม่พบ')} · {tr('รหัสคลัง')} <b>{parsed.slocs.join(', ')}</b> ·{' '}
                    {parsed.srcRows.toLocaleString()} {tr('บรรทัด')} → {parsed.rows.length.toLocaleString()} MAT · {tr('รวม Unrestr.')} {fmt(parsed.total)}
                  </div>
                  {parsed.warnings.map(w => <div key={w} style={{ fontSize: 12, color: 'var(--amber)' }}>⚠ {w}</div>)}
                  <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                    <button type="button" style={storeBtn('primary')} disabled={busy} onClick={async () => { if (await save()) setShowUp(false); }}>{busy ? '…' : `💾 ${tr('บันทึกและเทียบ')}`}</button>
                    <button type="button" style={storeBtn('secondary')} disabled={busy} onClick={() => setParsed(null)}>{tr('ยกเลิก')}</button>
                  </div>
                </> : <>
                  {parsed.wrong
                    ? <WrongFileNote k={parsed.wrong} here="sap_mb52" onGo={() => { setShowUp(false); setParsed(null); }} />
                    : <div style={{ fontSize: 13, color: 'var(--red)' }}>⚠ {parsed.error}</div>}
                  {parsed.headers?.length > 0 && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{tr('หัวคอลัมน์ที่เจอ')}: {parsed.headers.join(' · ')}</div>}
                </>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
