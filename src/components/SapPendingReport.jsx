/**
 * 🧾 SapPendingReport — ยอด "ตัดจ่ายใน SAP ไม่ได้" ที่ค้างอยู่ (2026-11-04 · คำสั่ง user)
 * user: *"กรณีตัดจ่ายใน SAP ไม่ได้ ใส่ยอดว่าค้างตัดเท่าไหร่ และมีรีพอร์ทสรุปพวกยอดที่ค้าง"*
 * · ต้นทาง = สโตร์ติ๊ก 🧾 ในป๊อปอัป "ถึงไลน์แล้ว" (DeliverScanModal) → `wip_replenish_requests.sap_pending_*` (Main)
 * · หน้านี้: สรุปรายพาร์ท + รายใบ + ปุ่ม "✔ ตัดใน SAP แล้ว" (ตั้ง `sap_cleared_*` · ห้ามลบยอดเดิม)
 * · ไม่แตะยอดสต็อกใน ESM — ของส่งถึงไลน์แล้ว ค้างแค่ฝั่ง SAP
 * กติกา/สรุป = `utils/sapPending.js`
 */
import { useState, useEffect, useCallback, useContext, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import { UserContext } from '../App';
import { can } from '../utils/permissions';
import { checkWriteRows } from '../utils/dbWrite';
import { summarizeSapPending } from '../utils/sapPending';
import { toast } from './Toast';
import MatLabel from './MatLabel';
import SearchInput from './SearchInput';
import Segmented from './Segmented';

import { tr } from '../utils/i18n';
const COLS = 'id, line_name, mat_no, part_name, request_qty, picked_qty, delivered_at, delivered_by, status, sap_pending_qty, sap_pending_note, sap_pending_at, sap_pending_by_name, sap_cleared_at, sap_cleared_by_name';
const fmt = (v) => (v == null ? '—' : Number(v).toLocaleString());
const dt = (iso) => (iso ? new Date(iso).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 14 };
const th = { textAlign: 'left', fontSize: 11.5, color: 'var(--muted)', fontWeight: 700, padding: '6px 8px', borderBottom: '1px solid var(--border)' };
const td = { fontSize: 12.5, color: 'var(--text)', padding: '7px 8px', borderBottom: '1px solid var(--border)', verticalAlign: 'top' };

export default function SapPendingReport() {
  const { role, fullName } = useContext(UserContext);
  const canClear = can('heijunka', 'operate', role);
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [view, setView] = useState('open');   // open | cleared
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('wip_replenish_requests').select(COLS)
      .not('sap_pending_qty', 'is', null).order('sap_pending_at', { ascending: false }).limit(1000);
    setLoading(false);
    if (error) { setErr(error.code === '42703' ? 'ยังไม่ได้ apply migration 20261104b_wip_replenish_sap_pending_main (Main)' : error.message); return; }
    setErr(''); setRows(data || []);
  }, []);
  useEffect(() => { let alive = true; (async () => { if (alive) await load(); })(); return () => { alive = false; }; }, [load]);

  const sum = useMemo(() => summarizeSapPending(rows), [rows]);
  const needle = q.trim().toLowerCase();
  const match = (r) => !needle || [r.mat_no, r.part_name, r.line_name, r.sap_pending_note].some(v => String(v || '').toLowerCase().includes(needle));
  const list = (view === 'open' ? sum.open : rows.filter(r => r.sap_cleared_at)).filter(match);
  const hidden = (view === 'open' ? sum.open.length : rows.filter(r => r.sap_cleared_at).length) - list.length;
  const parts = sum.parts.filter(p => !needle || [p.mat_no, p.part_name, ...p.lines].some(v => String(v || '').toLowerCase().includes(needle)));

  const clear = async (r) => {
    if (!canClear) { toast.error('ไม่มีสิทธิ์ (heijunka:operate)'); return; }
    if (!window.confirm(`ยืนยันว่าตัดใน SAP แล้ว?\n\n${r.part_name || ''} MAT ${r.mat_no} × ${fmt(r.sap_pending_qty)} → ${r.line_name}`)) return;
    setBusy(r.id);
    const ok = checkWriteRows(await supabase.from('wip_replenish_requests')
      .update({ sap_cleared_at: new Date().toISOString(), sap_cleared_by_name: fullName || null })
      .eq('id', r.id).is('sap_cleared_at', null).select('id'), 'บันทึกตัด SAP',
      { zeroMsg: 'ใบนี้ถูกเคลียร์ไปแล้ว หรือไม่มีสิทธิ์ — กดรีเฟรช' });
    setBusy(null);
    if (ok) toast.success(`✔ เคลียร์ยอดค้าง SAP ของ ${r.mat_no} แล้ว`);
    load();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ ...card, display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>ค้างตัดใน SAP</div>
          <div style={{ fontSize: 24, fontWeight: 900, color: sum.totalSlips ? 'var(--amber)' : 'var(--green)' }}>{fmt(sum.totalSlips)} ใบ</div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{fmt(sum.parts.length)} พาร์ท</div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text2)', flex: 1, minWidth: 240 }}>
          ใบที่สโตร์ส่งถึงไลน์แล้ว แต่ <b>ตัดจ่ายใน SAP ไม่ได้</b> (ติ๊ก 🧾 ในป๊อปอัป "ถึงไลน์แล้ว") — ตัดใน SAP เสร็จแล้วกด "✔ ตัดใน SAP แล้ว" ·
          ยอดสต็อกในระบบนี้ขยับไปตั้งแต่ตอนส่งแล้ว ไม่เปลี่ยนอีก
        </div>
        <button className="tbtn" onClick={load} style={{ padding: '7px 12px', borderRadius: 'var(--r-md)', border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', cursor: 'pointer', fontSize: 12.5 }}>{tr('↻ รีเฟรช')}</button>
      </div>

      {err && <div style={{ ...card, color: 'var(--red)', fontSize: 13 }}>โหลดไม่สำเร็จ — {err}</div>}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Segmented value={view} onChange={setView} label="สถานะ"
          options={[{ value: 'open', label: `ยังค้าง (${sum.open.length})` }, { value: 'cleared', label: `เคลียร์แล้ว (${rows.length - sum.open.length})` }]} />
        <SearchInput value={q} onChange={setQ} fields="MAT / ชื่อพาร์ท / ไลน์ / สาเหตุ" grow={false} />
      </div>

      {view === 'open' && parts.length > 0 && (
        <div style={card}>
          <div style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--text)', marginBottom: 6 }}>สรุปรายพาร์ท</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>{tr('พาร์ท')}</th><th style={{ ...th, textAlign: 'right' }}>{tr('ค้างตัด')}</th><th style={{ ...th, textAlign: 'right' }}>{tr('ใบ')}</th><th style={th}>{tr('ไลน์')}</th><th style={th}>{tr('ค้างตั้งแต่')}</th></tr></thead>
            <tbody>
              {parts.map(p => (
                <tr key={p.mat_no}>
                  <td style={td}><MatLabel mat={p.mat_no} name={p.part_name} /></td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 900, color: 'var(--amber)' }}>{fmt(p.qty)}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{fmt(p.slips)}</td>
                  <td style={td}>{p.lines.join(', ')}</td>
                  <td style={td}>{dt(p.oldest)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={card}>
        <div style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--text)', marginBottom: 6 }}>{view === 'open' ? 'รายใบที่ยังค้าง' : 'รายใบที่เคลียร์แล้ว'}</div>
        {loading ? <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>กำลังโหลด…</div>
          : !list.length ? <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{view === 'open' ? 'ไม่มียอดค้างตัด SAP' : 'ยังไม่มีใบที่เคลียร์'}{hidden > 0 ? ` · ซ่อนอยู่ ${hidden} ใบ (ไม่ตรงคำค้น)` : ''}</div>
          : (
            <>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={th}>{tr('พาร์ท')}</th><th style={th}>{tr('ไลน์')}</th><th style={{ ...th, textAlign: 'right' }}>{tr('ส่ง')}</th>
                  <th style={{ ...th, textAlign: 'right' }}>{tr('ค้างตัด')}</th><th style={th}>{tr('สาเหตุ')}</th><th style={th}>{tr('จดเมื่อ/โดย')}</th><th style={th} />
                </tr></thead>
                <tbody>
                  {list.map(r => (
                    <tr key={r.id}>
                      <td style={td}><MatLabel mat={r.mat_no} name={r.part_name} /></td>
                      <td style={td}>{r.line_name}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{fmt(Number(r.picked_qty) > 0 ? r.picked_qty : r.request_qty)}</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 900, color: r.sap_cleared_at ? 'var(--muted)' : 'var(--amber)' }}>{fmt(r.sap_pending_qty)}</td>
                      <td style={td}>{r.sap_pending_note || '—'}</td>
                      <td style={td}>{dt(r.sap_pending_at)}{r.sap_pending_by_name ? ` · ${r.sap_pending_by_name}` : ''}</td>
                      <td style={td}>
                        {r.sap_cleared_at
                          ? <span style={{ fontSize: 12, color: 'var(--green)' }}>✔ {dt(r.sap_cleared_at)}{r.sap_cleared_by_name ? ` · ${r.sap_cleared_by_name}` : ''}</span>
                          : canClear && (
                            <button disabled={busy === r.id} onClick={() => clear(r)}
                              style={{ padding: '6px 10px', borderRadius: 'var(--r-md)', border: 'none', background: 'var(--accent)', color: 'var(--accent-ink)', fontWeight: 800, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                              {busy === r.id ? '…' : tr('✔ ตัดใน SAP แล้ว')}
                            </button>
                          )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {hidden > 0 && <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 6 }}>ซ่อนอยู่ {hidden} ใบ (ไม่ตรงคำค้น)</div>}
            </>
          )}
      </div>
    </div>
  );
}
