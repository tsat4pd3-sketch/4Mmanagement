/**
 * ⚠️ StockDiscrepancyReport — คลังพัก "ผลต่างรอเคลียร์" + รายงานผลต่างรับ-ส่งรายเดือน (2026-11-05 · คำสั่ง user)
 * user: *"ต้องไม่หาย เป็น report transaction ที่มีปัญหา ไว้เพื่อสรุปรายเดือน แก้ไขกันระหว่างผลิตกับสโตร์ ชนกันใน SAP"* ·
 *       *"ทางนี้เลย มีหน้าคลังพัก"* · *"ยืนยันคู่"*
 * · ต้นทาง: ไลน์กดรับไม่ครบ (ใบขอเติม / รอบคัมบัง) → ledger ไลน์ → คลังพัก + เคสใน `stock_discrepancies` (DR)
 * · เคลียร์ 2 จังหวะ: ฝ่ายหนึ่ง "เสนอ" ผล → อีกฝ่าย (คนละคน) "ยืนยัน" ⇒ ledger ออกจากคลังพัก · หรือ "ไม่เห็นด้วย" ⇒ กลับไปรอเคลียร์
 * · กฎทั้งหมด `utils/stockDiscrepancy.js` · ลบเคสไม่ได้ (ไม่มี GRANT delete)
 */
import { useState, useEffect, useCallback, useContext, useMemo, useRef } from 'react';
import { supabaseDR } from '../supabaseClient';
import { UserContext } from '../App';
import { can } from '../utils/permissions';
import { checkWriteRows } from '../utils/dbWrite';
import { getWorkDate } from '../utils/workDate';
import { fetchAllRows } from '../utils/fetchAllRows';
import { downloadCsvDoc, csvCell } from '../utils/csvDoc';
import {
  SUSPENSE_LOC, SIDE_LABEL, OUTCOME_LABEL, STATUS_LABEL, sidesOf, proposeBlock, confirmBlock, resolveLedgerRows, monthlySummary,
} from '../utils/stockDiscrepancy';
import { toast } from './Toast';
import MatLabel from './MatLabel';
import SearchInput from './SearchInput';
import Segmented from './Segmented';

const COLS = 'id, created_at, source, ref_id, line_name, mat_no, part_name, sent_qty, received_qty, short_qty, work_date, reported_by, note, status, proposed_outcome, proposed_by, proposed_side, proposed_at, confirmed_by, confirmed_side, resolved_at, resolved_by, resolve_note, sap_doc';
const fmt = (v) => (v == null ? '—' : Number(v).toLocaleString());
const dt = (iso) => (iso ? new Date(iso).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 14 };
const th = { textAlign: 'left', fontSize: 11.5, color: 'var(--muted)', fontWeight: 700, padding: '6px 8px', borderBottom: '1px solid var(--border)' };
const td = { fontSize: 12.5, color: 'var(--text)', padding: '7px 8px', borderBottom: '1px solid var(--border)', verticalAlign: 'top' };
const btn = (primary) => ({ padding: '6px 10px', borderRadius: 8, fontSize: 12, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap',
  border: primary ? 'none' : '1px solid var(--border2)', background: primary ? 'var(--accent)' : 'var(--bg2)', color: primary ? 'var(--accent-ink)' : 'var(--text)' });

export default function StockDiscrepancyReport() {
  const { role, fullName } = useContext(UserContext);
  const sides = useMemo(() => sidesOf({ canStore: can('heijunka', 'operate', role), canLine: can('wip_request', 'receive', role) }), [role]);
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [view, setView] = useState('open');   // open | done | all
  const [q, setQ] = useState('');
  const [month, setMonth] = useState('');     // '' = ทุกเดือน
  const [form, setForm] = useState(null);     // { d, mode: 'propose'|'confirm', side, outcome, sapDoc, note }
  const req = useRef(0);

  const load = useCallback(async () => {
    const my = ++req.current;
    setLoading(true);
    const { data, error } = await fetchAllRows(supabaseDR, 'stock_discrepancies', COLS, x => x.order('work_date', { ascending: false }).order('id'));
    if (my !== req.current) return;
    setLoading(false);
    if (error) { setErr(error.code === '42P01' ? 'ยังไม่ได้ apply migration 20261104d_stock_discrepancies_dr (DR)' : error.message); return; }
    setErr(''); setRows(data || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const months = useMemo(() => monthlySummary(rows), [rows]);
  const needle = q.trim().toLowerCase();
  const inView = (r) => (view === 'open' ? (r.status === 'open' || r.status === 'proposed') : view === 'done' ? (r.status === 'returned' || r.status === 'written_off') : true);
  const base = rows.filter(r => (!month || String(r.work_date).startsWith(month)) && inView(r));
  const list = base.filter(r => !needle || [r.mat_no, r.part_name, r.line_name, r.note, r.reported_by, r.sap_doc].some(v => String(v || '').toLowerCase().includes(needle)));
  const suspenseQty = rows.filter(r => r.status === 'open' || r.status === 'proposed').reduce((s, r) => s + Number(r.short_qty || 0), 0);

  const openForm = (d, mode) => {
    const side = mode === 'confirm' ? sides.find(s => s !== d.proposed_side) || sides[0] : sides[0];
    setForm({ d, mode, side, outcome: d.proposed_outcome || 'returned', sapDoc: d.sap_doc || '', note: d.resolve_note || '' });
  };

  const propose = async () => {
    const { d, side, outcome, sapDoc, note } = form;
    const why = proposeBlock(d, { side, sides, outcome });
    if (why) { toast.error(why); return; }
    setBusy(d.id);
    const ok = checkWriteRows(await supabaseDR.from('stock_discrepancies').update({
      status: 'proposed', proposed_outcome: outcome, proposed_by: fullName || null, proposed_side: side, proposed_at: new Date().toISOString(),
      sap_doc: sapDoc.trim() || null, resolve_note: note.trim() || null,
    }).eq('id', d.id).eq('status', 'open').select('id'), 'เสนอผลเคลียร์', { zeroMsg: 'เคสนี้ถูกเปลี่ยนสถานะไปแล้ว — รีเฟรช' });
    setBusy(null);
    if (ok) { toast.success(`🤝 เสนอ "${OUTCOME_LABEL[outcome]}" แล้ว — รออีกฝ่ายยืนยัน`); setForm(null); }
    load();
  };

  /* ยืนยัน = claim สถานะ (proposed → ผลสุดท้าย) ก่อน แล้วค่อยเขียน ledger · ledger ล้ม = คืนสถานะ (กฎเหล็ก DB ข้อ 6) */
  const confirm = async () => {
    const { d, side, sapDoc, note } = form;
    const why = confirmBlock(d, { side, sides, by: fullName });
    if (why) { toast.error(why); return; }
    if (!window.confirm(`ยืนยัน "${OUTCOME_LABEL[d.proposed_outcome]}" ในนาม${SIDE_LABEL[side]}?\n\n${d.part_name || ''} MAT ${d.mat_no} × ${fmt(d.short_qty)} (${d.line_name})\nเสนอโดย ${d.proposed_by || '—'} (${SIDE_LABEL[d.proposed_side] || ''})`)) return;
    setBusy(d.id);
    const now = new Date().toISOString();
    const claimed = checkWriteRows(await supabaseDR.from('stock_discrepancies').update({
      status: d.proposed_outcome, confirmed_by: fullName || null, confirmed_side: side, resolved_at: now, resolved_by: fullName || null,
      sap_doc: sapDoc.trim() || d.sap_doc || null, resolve_note: note.trim() || d.resolve_note || null,
    }).eq('id', d.id).eq('status', 'proposed').select('id'), 'ยืนยันเคลียร์', { zeroMsg: 'เคสนี้ถูกเปลี่ยนสถานะไปแล้ว — รีเฟรช' });
    if (!claimed) { setBusy(null); load(); return; }
    const { error: eLedger } = await supabaseDR.from('line_stock_transactions').insert(
      resolveLedgerRows(d, { outcome: d.proposed_outcome, by: fullName, workDate: getWorkDate(), sapDoc: sapDoc.trim() || d.sap_doc }));
    if (eLedger) {
      const { error: eBack } = await supabaseDR.from('stock_discrepancies').update({
        status: 'proposed', confirmed_by: null, confirmed_side: null, resolved_at: null, resolved_by: null,
      }).eq('id', d.id).eq('status', d.proposed_outcome);
      toast.error(eBack ? `ย้ายยอดออกจากคลังพักไม่สำเร็จ และคืนสถานะไม่ได้ — แจ้ง admin (${eLedger.message})`
        : `ย้ายยอดออกจากคลังพักไม่สำเร็จ — คืนเป็น "รออีกฝ่ายยืนยัน" แล้ว ลองใหม่ (${eLedger.message})`);
    } else { toast.success(`✔ เคลียร์แล้ว: ${OUTCOME_LABEL[d.proposed_outcome]} ${d.mat_no} × ${fmt(d.short_qty)}`); setForm(null); }
    setBusy(null); load();
  };

  const rejectProposal = async (d) => {
    const side = sides.find(s => s !== d.proposed_side);
    if (!side) { toast.error('ต้องเป็นอีกฝ่ายถึงจะตีกลับได้'); return; }
    const why = window.prompt(`ไม่เห็นด้วยกับ "${OUTCOME_LABEL[d.proposed_outcome]}" — เหตุผล (บังคับ)`, '');
    if (why == null) return;
    if (!why.trim()) { toast.error('ใส่เหตุผลที่ไม่เห็นด้วย'); return; }
    setBusy(d.id);
    const ok = checkWriteRows(await supabaseDR.from('stock_discrepancies').update({
      status: 'open', proposed_outcome: null, proposed_by: null, proposed_side: null, proposed_at: null,
      resolve_note: `ตีกลับโดย ${fullName || '—'} (${SIDE_LABEL[side]}): ${why.trim()}`,
    }).eq('id', d.id).eq('status', 'proposed').select('id'), 'ตีกลับข้อเสนอ', { zeroMsg: 'เคสนี้ถูกเปลี่ยนสถานะไปแล้ว — รีเฟรช' });
    setBusy(null);
    if (ok) toast.info('ตีกลับแล้ว — เคสกลับไปรอเคลียร์');
    load();
  };

  const exportCsv = () => {
    if (!list.length) { toast.info('ไม่มีรายการให้ export'); return; }
    const head = ['วันที่งาน', 'ไลน์', 'Part Name', 'MAT', 'ส่ง', 'รับจริง', 'ขาด', 'สถานะ', 'ผลที่เสนอ', 'เสนอโดย', 'ยืนยันโดย', 'เลข SAP', 'หมายเหตุ', 'แจ้งโดย', 'ที่มา'];
    const body = list.map(r => [r.work_date, r.line_name, r.part_name || '', r.mat_no, r.sent_qty, r.received_qty, r.short_qty,
      STATUS_LABEL[r.status] || r.status, OUTCOME_LABEL[r.proposed_outcome] || '', r.proposed_by || '', r.confirmed_by || '',
      r.sap_doc || '', r.resolve_note || r.note || '', r.reported_by || '', r.source].map(csvCell).join(','));
    downloadCsvDoc('csv_stock_discrepancy', `stock_discrepancy_${month || 'all'}`, [head.map(csvCell).join(','), ...body].join('\n'));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ ...card, display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>📦 ยอดในคลังพัก "{SUSPENSE_LOC}"</div>
          <div style={{ fontSize: 24, fontWeight: 900, color: suspenseQty ? 'var(--amber)' : 'var(--green)' }}>{fmt(suspenseQty)}</div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{fmt(rows.filter(r => r.status === 'open' || r.status === 'proposed').length)} เคสยังไม่เคลียร์</div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text2)', flex: 1, minWidth: 260 }}>
          ไลน์กด <b>รับไม่ครบ</b> → ส่วนที่ขาดย้ายมาพักที่นี่ (ไม่หาย) → ฝ่ายหนึ่ง <b>เสนอ</b> คืน STORE / ตัดหาย →
          <b> อีกฝ่าย (คนละคน) ยืนยัน</b> ยอดจึงออกจากคลังพัก · ใส่เลขเอกสาร SAP ที่ใช้ปรับได้
          {!sides.length && <div style={{ marginTop: 4, color: 'var(--muted)' }}>บัญชีนี้ดูได้อย่างเดียว (ไม่มีสิทธิ์ heijunka:operate / wip_request:receive)</div>}
        </div>
        <button className="tbtn" onClick={load} style={btn(false)}>↻ รีเฟรช</button>
      </div>

      {err && <div style={{ ...card, color: 'var(--red)', fontSize: 13 }}>โหลดไม่สำเร็จ — {err}</div>}

      {months.length > 0 && (
        <div style={card}>
          <div style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--text)', marginBottom: 6 }}>สรุปรายเดือน</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th}>เดือน</th><th style={{ ...th, textAlign: 'right' }}>เคส</th><th style={{ ...th, textAlign: 'right' }}>ขาดรวม</th>
              <th style={{ ...th, textAlign: 'right' }}>ยังค้าง</th><th style={{ ...th, textAlign: 'right' }}>คืน STORE</th><th style={{ ...th, textAlign: 'right' }}>ตัดหาย</th><th style={th} />
            </tr></thead>
            <tbody>
              {months.map(m => (
                <tr key={m.month}>
                  <td style={{ ...td, fontWeight: 800 }}>{m.month}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{fmt(m.cases)}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{fmt(m.qty)}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 900, color: m.openQty ? 'var(--amber)' : 'var(--muted)' }}>{fmt(m.openQty)} ({fmt(m.openCases)} เคส)</td>
                  <td style={{ ...td, textAlign: 'right' }}>{fmt(m.returnedQty)}</td>
                  <td style={{ ...td, textAlign: 'right', color: m.writtenOffQty ? 'var(--red)' : 'var(--muted)' }}>{fmt(m.writtenOffQty)}</td>
                  <td style={td}><button className="tbtn" onClick={() => setMonth(month === m.month ? '' : m.month)} style={btn(month === m.month)}>{month === m.month ? '✓ กำลังดู' : 'ดูเดือนนี้'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Segmented value={view} onChange={setView} label="สถานะ"
          options={[{ value: 'open', label: 'ยังไม่เคลียร์' }, { value: 'done', label: 'เคลียร์แล้ว' }, { value: 'all', label: 'ทั้งหมด' }]} />
        <SearchInput value={q} onChange={setQ} fields="MAT / ชื่อพาร์ท / ไลน์ / เลข SAP / หมายเหตุ" grow={false} />
        {month && <span style={{ fontSize: 12, color: 'var(--text2)' }}>เดือน {month} <button className="tbtn" onClick={() => setMonth('')} style={btn(false)}>✕ ทุกเดือน</button></span>}
        <div style={{ flex: 1 }} />
        <button className="tbtn" onClick={exportCsv} disabled={!list.length} style={btn(false)}>⬇️ Export CSV</button>
      </div>

      <div style={card}>
        {loading ? <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>กำลังโหลด…</div>
          : !list.length ? <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{view === 'open' ? 'ไม่มีเคสค้างในคลังพัก' : 'ไม่มีรายการ'}{base.length > list.length ? ` · ซ่อนอยู่ ${base.length - list.length} เคส (ไม่ตรงคำค้น)` : ''}</div>
          : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={th}>วันที่</th><th style={th}>พาร์ท</th><th style={th}>ไลน์</th>
                  <th style={{ ...th, textAlign: 'right' }}>ส่ง</th><th style={{ ...th, textAlign: 'right' }}>รับจริง</th><th style={{ ...th, textAlign: 'right' }}>ขาด</th>
                  <th style={th}>สถานะ</th><th style={th}>รายละเอียด</th><th style={th} />
                </tr></thead>
                <tbody>
                  {list.map(r => {
                    const canPropose = r.status === 'open' && sides.length > 0;
                    const canConfirm = r.status === 'proposed' && sides.some(s => s !== r.proposed_side);
                    return (
                      <tr key={r.id}>
                        <td style={td}>{r.work_date}</td>
                        <td style={td}><MatLabel mat={r.mat_no} name={r.part_name} /></td>
                        <td style={td}>{r.line_name}</td>
                        <td style={{ ...td, textAlign: 'right' }}>{fmt(r.sent_qty)}</td>
                        <td style={{ ...td, textAlign: 'right' }}>{fmt(r.received_qty)}</td>
                        <td style={{ ...td, textAlign: 'right', fontWeight: 900, color: 'var(--amber)' }}>{fmt(r.short_qty)}</td>
                        <td style={td}>{STATUS_LABEL[r.status] || r.status}</td>
                        <td style={{ ...td, fontSize: 12, color: 'var(--text2)' }}>
                          {r.status === 'proposed' && <div>เสนอ {OUTCOME_LABEL[r.proposed_outcome]} · {r.proposed_by || '—'} ({SIDE_LABEL[r.proposed_side]}) {dt(r.proposed_at)}</div>}
                          {(r.status === 'returned' || r.status === 'written_off') && <div>ยืนยัน {r.confirmed_by || '—'} ({SIDE_LABEL[r.confirmed_side] || ''}) {dt(r.resolved_at)} · เสนอ {r.proposed_by || '—'}</div>}
                          {r.sap_doc && <div>SAP {r.sap_doc}</div>}
                          {(r.resolve_note || r.note) && <div>{r.resolve_note || r.note}</div>}
                          <div style={{ color: 'var(--muted)' }}>แจ้งโดย {r.reported_by || '—'}</div>
                        </td>
                        <td style={td}>
                          {canPropose && <button className="tbtn" disabled={busy === r.id} onClick={() => openForm(r, 'propose')} style={btn(true)}>เสนอผลเคลียร์</button>}
                          {canConfirm && (
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              <button className="tbtn" disabled={busy === r.id} onClick={() => openForm(r, 'confirm')} style={btn(true)}>✔ ยืนยัน</button>
                              <button className="tbtn" disabled={busy === r.id} onClick={() => rejectProposal(r)} style={btn(false)}>ไม่เห็นด้วย</button>
                            </div>
                          )}
                          {r.status === 'proposed' && !canConfirm && <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>รออีกฝ่ายยืนยัน</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {base.length > list.length && <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 6 }}>ซ่อนอยู่ {base.length - list.length} เคส (ไม่ตรงคำค้น)</div>}
            </div>
          )}
      </div>

      {form && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 2300, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, width: 'min(480px, 96vw)', boxShadow: 'var(--shadow-lg)' }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', marginBottom: 8 }}>
              {form.mode === 'propose' ? '🤝 เสนอผลเคลียร์' : '✔ ยืนยันผลเคลียร์'}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text2)', marginBottom: 10 }}>
              <MatLabel mat={form.d.mat_no} name={form.d.part_name} /> · {form.d.line_name} · ขาด <b>{fmt(form.d.short_qty)}</b>
              {form.mode === 'confirm' && <div style={{ marginTop: 4 }}>เสนอ <b>{OUTCOME_LABEL[form.d.proposed_outcome]}</b> โดย {form.d.proposed_by || '—'} ({SIDE_LABEL[form.d.proposed_side]})</div>}
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              <label style={{ fontSize: 12, color: 'var(--muted)' }}>กดในนามฝ่าย
                <Segmented value={form.side} onChange={v => setForm(f => ({ ...f, side: v }))} label="ฝ่าย"
                  options={sides.map(s => ({ value: s, label: SIDE_LABEL[s] }))} />
              </label>
              {form.mode === 'propose' && (
                <label style={{ fontSize: 12, color: 'var(--muted)' }}>ผล
                  <Segmented value={form.outcome} onChange={v => setForm(f => ({ ...f, outcome: v }))} label="ผลเคลียร์"
                    options={[{ value: 'returned', label: OUTCOME_LABEL.returned }, { value: 'written_off', label: OUTCOME_LABEL.written_off }]} />
                </label>
              )}
              <input value={form.sapDoc} onChange={e => setForm(f => ({ ...f, sapDoc: e.target.value }))} placeholder="เลขเอกสาร SAP ที่ใช้ปรับ (ถ้ามี)"
                style={{ padding: '8px 10px', borderRadius: 8, fontSize: 13 }} />
              <input value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} placeholder="หมายเหตุ / สาเหตุที่ขาด"
                style={{ padding: '8px 10px', borderRadius: 8, fontSize: 13 }} />
              {(() => {
                const why = form.mode === 'propose'
                  ? proposeBlock(form.d, { side: form.side, sides, outcome: form.outcome })
                  : confirmBlock(form.d, { side: form.side, sides, by: fullName });
                return why ? <div style={{ fontSize: 12, color: 'var(--red)', fontWeight: 700 }}>{why}</div> : null;
              })()}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="tbtn" onClick={() => setForm(null)} style={btn(false)}>ยกเลิก</button>
              <button className="tbtn" disabled={busy === form.d.id} onClick={form.mode === 'propose' ? propose : confirm} style={btn(true)}>
                {busy === form.d.id ? '…' : form.mode === 'propose' ? 'เสนอ (รออีกฝ่ายยืนยัน)' : 'ยืนยัน · ย้ายยอดออกจากคลังพัก'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
