import { useState, useRef } from 'react';
import { supabaseDR } from '../supabaseClient';
import { toast } from './Toast';
import { checkWrite, checkWriteRows } from '../utils/dbWrite';
import { fetchAllPages, fetchByIds } from '../utils/fetchByIds';
import { invalidateTable } from '../utils/masterInvalidate';
import { storeBtn } from '../utils/storeUi';
import { buildStoreStockPlan, parseStoreStockSheet, storeSheetHeader } from '../utils/storeStockSheet';
import { ImportInfo, WrongFileNote } from './ImportKit';
import { importLabel, whichImport } from '../utils/importRegistry';
import { tr } from '../utils/i18n';

/* ══ 📥 StoreStockUpload — อัพโหลดไฟล์ทะเบียนพาร์ทของสโตร์ (Stock_Store.xlsm) (2026-11-23 · คำสั่ง user)
   แบบเดียวกับนำเข้า 862/830: เลือกไฟล์ → **ดูก่อนเขียนเสมอ** (เพิ่ม/ถอด/MAX-MIN เดิม→ใหม่) → กดยืนยัน
   กฎทั้งหมดอยู่ที่ `utils/storeStockSheet.js` — จอนี้โหลดสถานะปัจจุบัน + เขียนตามแผนเท่านั้น
   🔴 อ่านสถานะปัจจุบันไม่ครบ = ห้ามยืนยัน (แผนที่คิดจากข้อมูลขาด = ถอดพาร์ท/ทับค่าผิด)
   ═══════════════════════════════════════════════════════════════════════════════════════════ */
const CHUNK = 300;
const SHOW = 8;
const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString());

async function loadCurrent(mats) {
  const errs = [];
  const bR = await supabaseDR.from('monitor_boards').select('id, board_key').like('board_key', 'store-%');
  if (bR.error) errs.push(`บอร์ดสโตร์: ${bR.error.message}`);
  const boards = bR.data || [];
  const ids = boards.map(b => b.id);
  const pR = ids.length ? await fetchAllPages(() => supabaseDR.from('monitor_board_parts')
    .select('id, board_id, mat_no, part_no, row_key, part_name, packing, sort_order, is_active').in('board_id', ids)) : { rows: [] };
  if (pR.error) errs.push(`พาร์ทบนบอร์ด: ${pR.error}`);
  if (pR.truncated) errs.push(tr("พาร์ทบนบอร์ดโหลดไม่ครบ (เกินเพดาน)"));
  const kR = await fetchByIds(mats, part => supabaseDR.from('kanban_standards').select('mat_no, min_qty, max_qty').eq('is_active', true).in('mat_no', part), { orderBy: 'mat_no' });
  if (kR.error) errs.push(`ทะเบียนคัมบัง: ${kR.error}`);
  const hR = await fetchByIds(mats, part => supabaseDR.from('parts_master').select('mat_no, home_sloc').in('mat_no', part), { orderBy: 'mat_no' });
  if (hR.error) errs.push(`ทะเบียนพาร์ท: ${hR.error}`);
  const home = new Map((hR.rows || []).map(r => [String(r.mat_no || '').trim(), r.home_sloc ?? null]));
  return { boards, parts: pR.rows || [], ks: kR.rows || [], home, errs };
}

function List({ rows, render, empty }) {
  const [all, setAll] = useState(false);
  if (!rows.length) return empty ? <div style={{ fontSize: 13, color: 'var(--muted)' }}>{empty}</div> : null;
  const shown = all ? rows : rows.slice(0, SHOW);
  return (
    <div style={{ display: 'grid', gap: 3, fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>
      {shown.map((r, i) => <div key={i}>{render(r)}</div>)}
      {rows.length > SHOW && (
        <button type="button" onClick={() => setAll(v => !v)} style={{ justifySelf: 'start', background: 'none', border: 'none', color: 'var(--blue)', fontWeight: 700, cursor: 'pointer', padding: 0, fontSize: 13 }}>
          {all ? tr('ย่อ') : `${tr('ดูทั้งหมด')} ${rows.length} ${tr('รายการ')}`}
        </button>
      )}
    </div>
  );
}

const Sec = ({ title, n, tone, children }) => (
  <section style={{ border: '1px solid var(--border)', borderLeft: `4px solid ${tone || 'var(--border2)'}`, borderRadius: 'var(--radius)', padding: '10px 12px', display: 'grid', gap: 6 }}>
    <div style={{ fontSize: 14, fontWeight: 800 }}>{tr(title)} <span style={{ color: 'var(--muted)', fontWeight: 700 }}>· {fmt(n)}</span></div>
    {children}
  </section>
);

export default function StoreStockUpload({ canEdit, fullName, onClose, onImported }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState(null);
  const [fileName, setFileName] = useState('');
  const [loadErr, setLoadErr] = useState([]);
  const [wrong, setWrong] = useState(null);   // 📥 ไฟล์ของจุดนำเข้าอื่น (importRegistry)

  const pick = async (file) => {
    if (!file) return;
    setBusy(true); setPlan(null); setLoadErr([]); setWrong(null); setFileName(file.name);
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheets = wb.SheetNames.map(name => ({ name, rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null, raw: true }) }));
      /* 📥 ไม่มีชีทหน้าตา Stock_Store เลย + เป็นไฟล์ของจุดอื่น = บอกทางไป ไม่ขึ้นแผนว่างๆ */
      const other = sheets.some(sh => storeSheetHeader(sh.rows)) ? null : whichImport(sheets, 'store_stock');
      if (other) { setWrong(other); setBusy(false); if (fileRef.current) fileRef.current.value = ''; return; }
      const mats = [...new Set(sheets.flatMap(sh => parseStoreStockSheet(sh.name, sh.rows).parts.map(x => x.mat)))];
      const cur = await loadCurrent(mats);
      setLoadErr(cur.errs);
      setPlan(buildStoreStockPlan(sheets, cur));
    } catch (e) {
      toast.error(`${tr('อ่านไฟล์ไม่ได้')}: ${e.message}`);
    }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const confirm = async () => {
    if (!plan || !canEdit || loadErr.length) return;
    setBusy(true);
    const by = fullName || null;
    let ok = true;
    for (const s of plan.sheets) {
      const rows = s.upserts.map(u => ({ ...u, updated_by_name: by }));
      for (let i = 0; ok && i < rows.length; i += CHUNK) {
        ok = checkWrite(await supabaseDR.from('monitor_board_parts').upsert(rows.slice(i, i + CHUNK), { onConflict: 'board_id,row_key' }), `${tr('พาร์ทบอร์ด')} ${s.sloc}`);
      }
      /* ถอดออก = ปิดแถว (ไม่ลบ) — ช่องที่กรอกไว้ยังอยู่ · นำเข้ากลับมาได้ */
      const ids = s.remove.map(r => r.id);
      for (let i = 0; ok && i < ids.length; i += CHUNK) {
        ok = checkWriteRows(await supabaseDR.from('monitor_board_parts').update({ is_active: false, updated_by_name: by })
          .in('id', ids.slice(i, i + CHUNK)).select('id'), `${tr('ถอดพาร์ทออกจากบอร์ด')} ${s.sloc}`);
      }
      if (!ok) break;
    }
    /* MAX/MIN — เฉพาะ MAT ที่มีแถวคัมบังอยู่แล้ว (แผนคัดมาแล้ว) · onConflict mat_no = อัพเดทเฉพาะ 2 ช่องนี้ */
    if (ok && plan.minmax.length) {
      const rows = plan.minmax.map(m => ({ mat_no: m.mat, min_qty: m.min, max_qty: m.max, updated_by_name: by }));
      for (let i = 0; ok && i < rows.length; i += CHUNK) {
        ok = checkWrite(await supabaseDR.from('kanban_standards').upsert(rows.slice(i, i + CHUNK), { onConflict: 'mat_no' }), tr('บันทึก MAX/MIN'));
      }
      invalidateTable('kanban_standards');
    }
    /* ที่จัดเก็บหลัก — เติมเฉพาะที่ยังว่าง (`.is(null)` กันทับคนที่ตั้งพร้อมกัน) */
    if (ok && plan.homeFill.length) {
      const bySloc = new Map();
      plan.homeFill.forEach(h => { if (!bySloc.has(h.sloc)) bySloc.set(h.sloc, []); bySloc.get(h.sloc).push(h.mat); });
      for (const [sloc, mats] of bySloc) {
        for (let i = 0; ok && i < mats.length; i += CHUNK) {
          ok = checkWrite(await supabaseDR.from('parts_master').update({ home_sloc: sloc })
            .in('mat_no', mats.slice(i, i + CHUNK)).is('home_sloc', null), `${tr('ตั้งที่จัดเก็บหลัก')} ${sloc}`);
        }
      }
      invalidateTable('parts_master');
    }
    setBusy(false);
    if (!ok) return;
    toast.success(`${tr('นำเข้าแล้ว')} ${plan.totals.sheets} ${tr('บอร์ด')} · ${plan.totals.parts} ${tr('พาร์ท')} · MAX/MIN ${plan.minmax.length} ${tr('รายการ')}`);
    onImported?.();
  };

  const t = plan?.totals;
  const body = (
    <div style={{ display: 'grid', gap: 12 }}>
      <h3 style={{ margin: 0, fontSize: 17 }}>📥 {tr(importLabel('store_stock'))}</h3>
      <ImportInfo k="store_stock" />
      <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.6 }}>
        {tr('ไฟล์ Stock_Store.xlsm — 1 ชีท = 1 พื้นที่ (R401 · R402 · S401…S408) · คอลัมน์ Mat\'l SAP / Part Name / STD/PC / MAX / MIN')}<br />
        {tr('ไฟล์ = รายชื่อปัจจุบันของบอร์ด (พาร์ทที่ไม่อยู่ในไฟล์จะถูกถอดออก) · MAX/MIN ในไฟล์ทับค่าเดิม · ช่องว่างไม่แตะค่าเดิม · ดูรายการก่อนกดยืนยันทุกครั้ง')}
      </div>
      {!canEdit && <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--amber)' }}>{tr('บัญชีนี้ไม่มีสิทธิ์แก้บอร์ด Monitoring (monitoring:manage) — ดูผลได้ แต่ยืนยันไม่ได้')}</div>}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <input ref={fileRef} type="file" accept=".xlsx,.xlsm,.xls" disabled={busy} onChange={e => pick(e.target.files?.[0])} aria-label={tr('เลือกไฟล์ Stock_Store')} />
        {busy && <span style={{ fontSize: 13, color: 'var(--muted)' }}>{tr('กำลังอ่าน…')}</span>}
        {fileName && !busy && <span style={{ fontSize: 13, color: 'var(--muted)' }}>{fileName}</span>}
      </div>
      {wrong && <WrongFileNote k={wrong} here="store_stock" onGo={onClose} />}

      {loadErr.length > 0 && (
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--red)' }}>
          {tr('⚠ อ่านข้อมูลในระบบไม่ครบ — ยืนยันไม่ได้ (กันถอดพาร์ท/ทับค่าผิด):')} {loadErr.join(' · ')}
        </div>
      )}

      {plan && (<>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
          {[['บอร์ด', t.sheets], ['พาร์ทในไฟล์', t.parts], ['เพิ่มใหม่', t.add], ['แก้ชื่อ/STD/ลำดับ', t.update], ['ถอดออก', t.remove], ['MAX/MIN เปลี่ยน', plan.minmax.length]].map(([k, v]) => (
            <div key={k} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '8px 10px' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>{tr(k)}</div>
              <div style={{ fontSize: 20, fontWeight: 800 }}>{fmt(v)}</div>
            </div>
          ))}
        </div>

        <Sec title={tr("รายบอร์ด")} n={plan.sheets.length}>
          <List rows={plan.sheets} render={s => <><b>{s.sloc}</b> · {tr('ในไฟล์')} {s.upserts.length} · {tr('เพิ่ม')} {s.add.length} · {tr('แก้')} {s.update.length} · {tr('ถอด')} {s.remove.length}{s.dupMats.length ? ` · ⚠ MAT ซ้ำในชีท ${s.dupMats.length}` : ''}</>} />
        </Sec>
        {plan.skipped.length > 0 && (
          <Sec title={tr("ชีทที่ไม่ได้นำเข้า")} n={plan.skipped.length} tone="var(--amber)">
            <List rows={plan.skipped} render={s => <><b>{s.name}</b> — {s.why}</>} />
          </Sec>
        )}
        {t.remove > 0 && (
          <Sec title={tr("จะถอดออกจากบอร์ด (ไม่อยู่ในไฟล์แล้ว)")} n={t.remove} tone="var(--amber)">
            <List rows={plan.sheets.flatMap(s => s.remove.map(r => ({ ...r, sloc: s.sloc })))} render={r => <>{r.sloc} · <b>{r.mat_no}</b> {r.part_name || ''}</>} />
          </Sec>
        )}
        <Sec title={tr("MAX/MIN ที่จะเปลี่ยน (เดิม → ใหม่)")} n={plan.minmax.length} tone="var(--blue)">
          <List rows={plan.minmax} empty={tr('ไม่มีค่าที่เปลี่ยน')}
            render={m => <>{m.sloc} · <b>{m.mat}</b> {m.name || ''} — MIN {fmt(m.fromMin)} → <b>{fmt(m.min)}</b> · MAX {fmt(m.fromMax)} → <b>{fmt(m.max)}</b></>} />
        </Sec>
        {plan.minmaxBad.length > 0 && (
          <Sec title={tr("MAX น้อยกว่า MIN — ไม่บันทึก (แก้ในไฟล์ก่อน)")} n={plan.minmaxBad.length} tone="var(--red)">
            <List rows={plan.minmaxBad} render={m => <>{m.sloc} · <b>{m.mat}</b> {m.name || ''} — MAX {fmt(m.max)} · MIN {fmt(m.min)}</>} />
          </Sec>
        )}
        {plan.minmaxNoKs.length > 0 && (
          <Sec title={tr("ยังไม่มีทะเบียนคัมบัง — MAX/MIN ไม่ได้บันทึก")} n={plan.minmaxNoKs.length} tone="var(--amber)">
            <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{tr('ระบบไม่สร้างทะเบียนคัมบังให้เอง (จำนวนต่อใบคัมบังยังไม่รู้) — เพิ่มที่ Product Master › Kanban ก่อน แล้วอัพโหลดไฟล์อีกรอบ')}</div>
            <List rows={plan.minmaxNoKs} render={m => <>{m.sloc} · <b>{m.mat}</b> {m.name || ''} — MIN {fmt(m.min)} · MAX {fmt(m.max)}</>} />
          </Sec>
        )}
        <Sec title={tr("ที่จัดเก็บหลัก — เติมให้ (ยังว่าง)")} n={plan.homeFill.length}>
          {plan.homeConflict.length > 0 && <div style={{ fontSize: 13, color: 'var(--amber)', fontWeight: 700 }}>{tr('ตั้งไว้คนละที่ (ไม่ทับ)')} {plan.homeConflict.length}: {plan.homeConflict.slice(0, SHOW).map(h => `${h.mat} ${h.now}→${h.sloc}`).join(' · ')}{plan.homeConflict.length > SHOW ? ' …' : ''}</div>}
          {plan.homeNoPm.length > 0 && <div style={{ fontSize: 13, color: 'var(--muted)' }}>{tr('ไม่มีในทะเบียนพาร์ท (ตั้งที่จัดเก็บไม่ได้)')} {plan.homeNoPm.length}</div>}
        </Sec>
        {plan.dupAcross.length > 0 && (
          <Sec title={tr("MAT เดียวกันอยู่หลายชีท")} n={plan.dupAcross.length} tone="var(--amber)">
            <List rows={plan.dupAcross} render={d => <><b>{d.mat}</b> — {d.sheets.join(' และ ')} ({tr("ขึ้นทั้ง 2 บอร์ด · ที่จัดเก็บหลักใช้ชีทแรก")})</>} />
          </Sec>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button type="button" onClick={onClose} style={storeBtn('secondary')}>{tr('ยกเลิก')}</button>
          <button type="button" onClick={confirm} disabled={busy || !canEdit || loadErr.length > 0 || !plan.sheets.length}
            style={storeBtn('primary', { opacity: busy || !canEdit || loadErr.length || !plan.sheets.length ? 0.5 : 1 })}>
            {busy ? tr('กำลังบันทึก…') : `${tr('ยืนยันนำเข้า')} ${t.sheets} ${tr('บอร์ด')}`}
          </button>
        </div>
      </>)}
    </div>
  );

  return (
    <div className="overlay">
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 'min(900px, 96vw)', maxHeight: '92vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} aria-label={tr('ปิด')} title={tr('ปิด')}
            style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 18, cursor: 'pointer', lineHeight: 1, padding: 2 }}>✕</button>
        </div>
        {body}
      </div>
    </div>
  );
}
