import { useState, useCallback, useMemo, useContext } from 'react';
import { supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { toast } from './Toast';
import { can } from '../utils/permissions';
import { getActor } from '../utils/actorStamp';
import { useLiveBoard } from '../utils/useLiveBoard';
import { askConfirm } from '../utils/askConfirm';
import { sortLineNames } from '../utils/lineHierarchy';
import { ALL } from '../utils/filterLabels';
import FilterBar from './FilterBar';
import SearchInput from './SearchInput';
import LineSelect from './LineSelect';
import MatLabel from './MatLabel';
import { tr, dateLocale } from '../utils/i18n';
import { storeBtn } from '../utils/storeUi';
import InfoMore from './InfoMore';

/* ═══ 🧾 คิว "ของที่ไลน์ใช้แต่สโตร์ยังไม่ลงจ่าย" (2026-11-20 · คำสั่ง user ทาง 1)

   ที่มา: สโตร์ยื่นของให้ไลน์จริงแต่ไม่ลง "จ่ายพาร์ทเข้าไลน์" ⇒ ระบบเห็นของกองที่ STORE
          ขณะที่ไลน์ถูกตัดตอนปิดใบผลิตจนติดลบ (audit 20/11: ~63 รายการ)
   · รายการ = วิว `v_line_issue_gaps` (DR · ไลน์ติดลบ + STORE ในระบบมีของ) — คำนวณสด ไม่มีตารางสถานะ
     ยืนยันแล้วยอดไลน์กลับ ≥ 0 รายการหายเอง
   · ✅ จ่ายไปแล้ว = RPC `line_issue_gap_confirm` (STORE − / ไลน์ + · ย้ายได้ไม่เกินยอด STORE)
     ยืนยันทั้งหมด = `line_issue_gap_confirm_many` ธุรกรรมเดียว (ห้ามวนยิง RPC ทีละรายการจากจอ)
   · 🚫 ไม่ได้จ่าย (ต้องใส่เหตุผล) = `line_issue_gap_reject` → ยอดไปคลังพัก + เปิดเคสที่แท็บ "คลังพัก/ผลต่าง"
   · ค้างเกิน 1 กะ (เริ่มค้างก่อนรอยต่อกะ 08:00/20:00) = แดง + เคส F ใน v_store_abnormal (แจ้งเตือน 07:50 + 19:50)
   · สิทธิ์ = `line_stock:issue` (คีย์เดียวกับการลงจ่ายพาร์ทเข้าไลน์) — ไม่มีสิทธิ์ = ดูอย่างเดียว + เขียนบอก */
const COLS = 'line_name, mat_no, part_name, gap, store_qty, movable, since, overdue';
const fmt = (n) => Number(n || 0).toLocaleString();
const when = (iso) => {
  if (!iso) return tr('ไม่ทราบเวลา');
  const d = new Date(iso);
  return isNaN(d) ? '—' : d.toLocaleString(dateLocale(), { timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

/* 📋 24/11 (คำสั่ง user) — `embedded` = อยู่ในแท็บย่อยของ Stock Management › ส่งของเข้าไลน์
   ไม่มีกล่อง/หัวพับ · แถบกรองของคิวนี้ = แถบกรองเดียวของแท็บ · `banner` (แถบไลน์เรียกของ) ต่อท้ายแถบกรอง
   · ว่าง = เขียนบอก (ไม่ return null — เข้ามาในแท็บแล้วจอว่างเปล่า = งง) · ไม่ส่ง embedded = กล่องแบบเดิม */
export default function LineIssueGapQueue({ embedded = false, banner = null }) {
  const { role, fullName } = useContext(UserContext);
  const canIssue = can('line_stock', 'issue', role);
  const [rows, setRows] = useState([]);
  const [loadErr, setLoadErr] = useState('');
  const [line, setLine] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(null);
  const [rejectFor, setRejectFor] = useState(null);   // key ที่กำลังกรอกเหตุผล "ไม่ได้จ่าย"
  const [reason, setReason] = useState('');
  const [open, setOpen] = useState(true);

  const load = useCallback(async () => {
    const { data, error } = await supabaseDR.from('v_line_issue_gaps').select(COLS)
      .order('overdue', { ascending: false }).order('since', { ascending: true, nullsFirst: true }).limit(1000);
    setLoadErr(error ? error.message : '');
    if (!error) setRows(data || []);
  }, []);
  useLiveBoard(load, { tables: ['line_stock_transactions'], topic: 'line-issue-gaps' });

  const lineRows = useMemo(() => sortLineNames([...new Set(rows.map(r => r.line_name))]).map(name => ({ name })), [rows]);
  const s = q.trim().toLowerCase();
  const shown = rows.filter(r => (!line || r.line_name === line)
    && (!s || [r.mat_no, r.part_name, r.line_name].some(v => String(v ?? '').toLowerCase().includes(s))));
  const overdueN = rows.filter(r => r.overdue).length;
  const keyOf = (r) => `${r.line_name}|${r.mat_no}`;
  const by = () => { const a = getActor(); return { p_by: fullName || a.name || '', p_by_uid: a.uid || null }; };

  const confirmOne = async (r) => {
    if (!canIssue) return;
    setBusy(keyOf(r));
    const { data, error } = await supabaseDR.rpc('line_issue_gap_confirm', { p_line: r.line_name, p_mat: r.mat_no, ...by() });
    setBusy(null);
    if (error) { toast.error(`${tr("ยืนยันไม่สำเร็จ")} — ${error.message}`); load(); return; }
    const moved = Number(data) || 0;
    if (moved < Number(r.gap)) toast.error(`⚠ ${tr("ย้ายได้")} ${fmt(moved)} ${tr("จากที่ไลน์ขาด")} ${fmt(r.gap)} — STORE ${tr("ในระบบไม่พอ ส่วนที่เหลือไลน์ยังติดลบ (ต้องนับ/ลงรับเข้า")} STORE)`);
    else toast.success(`✅ ${tr("ลงจ่าย")} ${r.mat_no} → ${r.line_name} ${fmt(moved)} ${tr("ชิ้นแล้ว")}`);
    load();
  };

  const confirmAll = async () => {
    if (!canIssue || !shown.length) return;
    if (!await askConfirm(`${tr("ยืนยันว่าสโตร์จ่ายไปแล้วทั้ง")} ${shown.length} ${tr("รายการที่เห็น?\\n\\nระบบจะหัก STORE และบวกเข้าไลน์ตามยอดที่ไลน์ใช้ไป (ไม่เกินยอด STORE)\\nในนาม")} ${fullName || tr('(ไม่รู้ชื่อผู้ใช้)')}`)) return;
    setBusy('*');
    const { data, error } = await supabaseDR.rpc('line_issue_gap_confirm_many', {
      p_lines: shown.map(r => r.line_name), p_mats: shown.map(r => r.mat_no), ...by(),
    });
    setBusy(null);
    if (error) { toast.error(`${tr("ยืนยันไม่สำเร็จ")} — ${error.message}`); load(); return; }
    const ok = data?.confirmed || 0, skip = data?.skipped || 0;
    (skip ? toast.error : toast.success)(`✅ ${tr("ลงจ่ายแล้ว")} ${ok} ${tr("รายการ")} (${fmt(data?.qty)} ${tr("ชิ้น")})${skip ? ` · ${tr("ข้าม")} ${skip} ${tr("รายการที่ไม่ค้างแล้ว/ทำไม่ได้ — รีเฟรชดู")}` : ''}`);
    load();
  };

  const reject = async (r) => {
    if (!canIssue) return;
    if (!reason.trim()) { toast.error('ใส่เหตุผลว่าทำไมไม่ได้จ่าย'); return; }
    setBusy(keyOf(r));
    const { error } = await supabaseDR.rpc('line_issue_gap_reject', { p_line: r.line_name, p_mat: r.mat_no, p_reason: reason.trim(), ...by() });
    setBusy(null);
    if (error) { toast.error(`${tr("บันทึกไม่สำเร็จ")} — ${error.message}`); load(); return; }
    toast.success(`🚫 ${tr("บันทึกว่าไม่ได้จ่าย")} ${r.mat_no} — ${tr("ยอด")} ${fmt(r.gap)} ${tr("ย้ายไปคลังพัก เปิดเคสที่แท็บ \"คลังพัก/ผลต่าง\" แล้ว")}`);
    setRejectFor(null); setReason(''); load();
  };

  if (!rows.length && !loadErr && !embedded) return null;   // ไม่มีรายการค้าง = ไม่กินพื้นที่บอร์ด

  const th = { padding: '6px 8px', fontSize: 12, color: 'var(--muted)', textAlign: 'left', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)' };
  const td = { padding: '6px 8px', fontSize: 13, borderBottom: '1px solid var(--border2)', verticalAlign: 'top' };
  /* ปุ่มมาตรฐานบอร์ดสโตร์ (utils/storeUi.js · เป้านิ้ว 44px สำหรับแท็บเล็ตหน้าคลัง) */
  const btn = (kind) => storeBtn(kind === 'go' ? 'primary' : 'secondary', { whiteSpace: 'nowrap', ...(kind === 'danger' ? { color: 'var(--red)', borderColor: 'var(--red-line)' } : {}) });

  const show = embedded || open;
  return (
    <div style={embedded ? { display: 'grid', gap: 10 } : { background: 'var(--card-surf)', border: `1px solid ${overdueN ? 'var(--red)' : 'var(--border)'}`, borderRadius: 10, padding: 12, marginBottom: 12, boxShadow: 'var(--shadow-sm)' }}>
      {!embedded && <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', cursor: 'pointer' }} onClick={() => setOpen(o => !o)}>
        <b style={{ fontSize: 15 }}>🧾 {tr('ไลน์ใช้ของแล้ว แต่สโตร์ยังไม่ลงจ่าย')}</b>
        <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 10, background: 'var(--amber-dim)', color: 'var(--amber)' }}>{rows.length} {tr('รายการ')}</span>
        {overdueN > 0 && <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 10, background: 'var(--red-dim)', color: 'var(--red)' }}>⏰ {tr('เกิน 1 กะ')} {overdueN}</span>}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted)' }}>{open ? '▲' : '▼'}</span>
      </div>}
      {show && <>
        {!embedded && <div style={{ fontSize: 12, color: 'var(--muted)', margin: '6px 0 8px' }}>
          {tr('ไลน์ถูกตัดตอนปิดใบผลิตจนติดลบ ขณะที่ STORE ในระบบยังมีของ = สโตร์ยื่นของให้แล้วแต่ไม่ได้ลงจ่าย · จ่ายไปแล้วจริงกด ✅ · ไม่ได้จ่ายกด 🚫 แล้วใส่เหตุผล (ยอดไปคลังพักให้ 2 ฝ่ายเคลียร์)')}
        </div>}
        {/* แท็บย่อย: คำเตือนลงใต้แถบกรอง (ลำดับ แท็บ → แถบกรอง → เนื้อหา) */}
        {!embedded && <>
        {loadErr && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 6 }}>⚠ {tr('โหลดคิวไม่สำเร็จ')}: {loadErr}</div>}
        {!canIssue && <div style={{ color: 'var(--amber)', fontSize: 13, marginBottom: 6 }}>🔒 {tr('ดูอย่างเดียว — ยืนยัน/ปฏิเสธต้องมีสิทธิ์ลงจ่ายพาร์ทเข้าไลน์ (line_stock:issue)')}</div>}
        </>}
        <FilterBar>
          <LineSelect lines={lineRows} value={line} onChange={setLine} placeholder={ALL.line} />
          <SearchInput value={q} onChange={setQ} placeholder={tr('ค้นหา MAT / ชื่อพาร์ท')} />
          {canIssue && shown.length > 0 && (
            <button type="button" style={btn('go')} disabled={!!busy} onClick={confirmAll}>
              ✅ {tr('ยืนยันจ่ายทั้งหมดที่เห็น')} ({shown.length})
            </button>
          )}
          {embedded && <><span className="spacer" /><InfoMore label={tr('หน้านี้ทำอะไร')}>
            {tr('ไลน์ถูกตัดตอนปิดใบผลิตจนติดลบ ขณะที่ STORE ในระบบยังมีของ = สโตร์ยื่นของให้แล้วแต่ไม่ได้ลงจ่าย · จ่ายไปแล้วจริงกด ✅ · ไม่ได้จ่ายกด 🚫 แล้วใส่เหตุผล (ยอดไปคลังพักให้ 2 ฝ่ายเคลียร์)')}
          </InfoMore></>}
        </FilterBar>
        {embedded && banner}
        {embedded && <>
        {loadErr && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 6 }}>⚠ {tr('โหลดคิวไม่สำเร็จ')}: {loadErr}</div>}
        {!canIssue && <div style={{ color: 'var(--amber)', fontSize: 13, marginBottom: 6 }}>🔒 {tr('ดูอย่างเดียว — ยืนยัน/ปฏิเสธต้องมีสิทธิ์ลงจ่ายพาร์ทเข้าไลน์ (line_stock:issue)')}</div>}
        </>}
        {embedded && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 13 }}>
            <span style={{ padding: '3px 10px', borderRadius: 999, background: 'var(--amber-dim)', color: 'var(--amber)', fontWeight: 700 }}>{tr('ค้าง')} {rows.length} {tr('รายการ')}</span>
            {overdueN > 0 && <span style={{ padding: '3px 10px', borderRadius: 999, background: 'var(--red-dim)', color: 'var(--red)', fontWeight: 700 }}>⏰ {tr('เกิน 1 กะ')} {overdueN}</span>}
          </div>
        )}
        {embedded && !rows.length && !loadErr && <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>{tr('ไม่มีรายการค้าง — ไลน์ไม่ติดลบ หรือ STORE ในระบบไม่มีของให้ย้าย')}</div>}
        {shown.length < rows.length && <div style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0' }}>{tr('ซ่อนตามตัวกรอง')} {rows.length - shown.length} {tr('รายการ')}</div>}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th}>{tr('ไลน์')}</th><th style={th}>{tr('พาร์ท')}</th>
              <th style={{ ...th, textAlign: 'right' }}>{tr('ไลน์ติดลบ')}</th><th style={{ ...th, textAlign: 'right' }}>{tr('STORE ในระบบ')}</th>
              <th style={th}>{tr('ค้างตั้งแต่')}</th><th style={th} />
            </tr></thead>
            <tbody>
              {shown.map(r => {
                const k = keyOf(r);
                return (
                  <tr key={k}>
                    <td style={td}>{r.line_name}</td>
                    <td style={td}><MatLabel mat={r.mat_no} name={r.part_name} size={13} /></td>
                    <td style={{ ...td, textAlign: 'right', color: 'var(--red)', fontWeight: 600 }}>−{fmt(r.gap)}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{fmt(r.store_qty)}{Number(r.movable) < Number(r.gap) && <div style={{ fontSize: 11, color: 'var(--amber)' }}>{tr('ย้ายได้')} {fmt(r.movable)}</div>}</td>
                    <td style={td}>
                      <span style={{ color: r.overdue ? 'var(--red)' : 'var(--text2)' }}>{r.overdue ? '⏰ ' : ''}{when(r.since)}</span>
                    </td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      {canIssue && rejectFor !== k && <>
                        <button type="button" style={btn('go')} disabled={!!busy} onClick={() => confirmOne(r)}>{busy === k ? '…' : `✅ ${tr('จ่ายไปแล้ว')}`}</button>{' '}
                        <button type="button" style={btn('sub')} disabled={!!busy} onClick={() => { setRejectFor(k); setReason(''); }}>🚫 {tr('ไม่ได้จ่าย')}</button>
                      </>}
                      {canIssue && rejectFor === k && (
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                          <input value={reason} onChange={e => setReason(e.target.value)} placeholder={tr('เหตุผล (บังคับ)')} style={{ fontSize: 12, minWidth: 160 }} autoFocus />
                          <button type="button" style={btn('danger')} disabled={!!busy} onClick={() => reject(r)}>{tr('บันทึก')}</button>
                          <button type="button" style={btn('sub')} onClick={() => setRejectFor(null)}>{tr('ยกเลิก')}</button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </>}
    </div>
  );
}
