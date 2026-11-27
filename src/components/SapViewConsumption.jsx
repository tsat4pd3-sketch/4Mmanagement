/**
 * 📊 เทียบตัดแบบ SAP — ยอดตัดของ "คิดแบบ SAP" เทียบยอดที่ ESM ตัดจริง (2026-11-20 · คำสั่ง user)
 * user: *"ใน SAP 101 ตัด 501 ไม่สน OP เพราะ OP ไม่มีใน SAP · ของเรา 101 ตัด OP และ OP ตัด 501"*
 * · แบบ SAP = ยอด FG ในช่วง × BOM (ไม่มีขั้น OP) · ESM = ธุรกรรมตัดอัตโนมัติจริงของใบผลิตในช่วงเดียวกัน
 * · ลูกที่ขั้น OP กิน = ต่างรายวันได้ตามจังหวะขั้น (ยอดสะสมควรเท่ากัน) — ติดป้ายให้เห็น ไม่ใช่ความผิด
 * · ⚠️ ใช้ BOM ปัจจุบัน ไม่ใช่ BOM ณ วันผลิต (ยังไม่เก็บประวัติ BOM) — เขียนบอกบนจอ
 * คิดที่ RPC `fn_sap_view_consumption` (DR · read-only) · ตารางนี้ไม่เขียนอะไร
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabaseDR } from '../supabaseClient';
import TimeRangeBar from './TimeRangeBar';
import SearchInput from './SearchInput';
import Segmented from './Segmented';
import NoticeBar from './NoticeBar';
import MatLabel from './MatLabel';
import useTimeRange from '../utils/useTimeRange';
import { tr } from '../utils/i18n';

const fmt = (v) => (v == null ? '—' : Number(v).toLocaleString(undefined, { maximumFractionDigits: 3 }));
const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 14 };
const th = { textAlign: 'right', fontSize: 11.5, color: 'var(--muted)', fontWeight: 700, padding: '6px 8px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' };
const td = { fontSize: 12.5, color: 'var(--text)', padding: '7px 8px', borderBottom: '1px solid var(--border)', textAlign: 'right' };
const VIEWS = [{ key: 'diff', label: 'เฉพาะที่ต่าง' }, { key: 'all', label: 'ทั้งหมด' }];

export default function SapViewConsumption() {
  const t = useTimeRange({ defaultDays: 7, finest: 'day' });
  const { from, to } = t;
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [view, setView] = useState('diff');

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabaseDR.rpc('fn_sap_view_consumption', { p_from: from, p_to: to });
    setLoading(false);
    if (error) {
      setErr(error.code === 'PGRST202' ? 'ยังไม่ได้ apply migration 20261120b_sap_view_consumption_dr (DR)' : error.message);
      setRows([]); return;
    }
    setErr(''); setRows(data || []);
  }, [from, to]);
  useEffect(() => {
    let alive = true;
    (async () => { if (alive) await load(); })();
    return () => { alive = false; };
  }, [load]);

  const needle = q.trim().toLowerCase();
  const list = useMemo(() => rows
    .map(r => ({ ...r, sap: Number(r.sap_qty) || 0, esm: Number(r.esm_qty) || 0 }))
    .map(r => ({ ...r, diff: r.esm - r.sap }))
    .filter(r => view === 'all' || Math.abs(r.diff) > 1e-6)
    .filter(r => !needle || [r.mat_no, r.part_name].some(v => String(v || '').toLowerCase().includes(needle)))
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)), [rows, view, needle]);
  const nDiff = rows.filter(r => Math.abs((Number(r.esm_qty) || 0) - (Number(r.sap_qty) || 0)) > 1e-6).length;
  const hidden = (view === 'all' ? rows.length : nDiff) - list.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <TimeRangeBar
        scale={t.scale} from={from} to={to} today={t.today} scales={null}
        onFrom={t.setFrom} onTo={t.setTo} onPreset={t.setPreset} onReload={load} loading={loading}
      >
        <Segmented value={view} onChange={setView} options={VIEWS.map(v => ({ value: v.key, label: tr(v.label) }))} />
        <SearchInput value={q} onChange={setQ} fields={tr("MAT / ชื่อพาร์ท")} />
      </TimeRangeBar>

      <NoticeBar tone="info">
        <div>{tr('แบบ SAP = ยอด FG ที่ปิดใบในช่วงนี้ × BOM (SAP ไม่มีขั้น OP ⇒ FG ตัดวัตถุดิบตรง) · ESM = ยอดที่ระบบตัดจริงของใบผลิตช่วงเดียวกัน (รวมขั้น OP)')}</div>
        <div>{tr('🔩 = ขั้น OP เป็นคนกิน ⇒ รายวันต่างได้ตามจังหวะขั้น (ของค้างระหว่างขั้น) ยอดสะสมควรใกล้กัน')}</div>
        <div>⚠️ {tr('คิดด้วย BOM ปัจจุบัน ไม่ใช่ BOM ณ วันผลิต — ช่วงที่มีการแก้ BOM ระหว่างทางจะต่างได้')}</div>
      </NoticeBar>

      {err && <NoticeBar tone="bad">{tr('โหลดไม่สำเร็จ')} — {err}</NoticeBar>}

      <div style={card}>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
          {loading ? tr('กำลังโหลด…') : <>{tr('พาร์ททั้งหมด')} {rows.length} · {tr('ต่างกัน')} {nDiff}{hidden > 0 && <> · {tr('ซ่อนจากคำค้น')} {hidden}</>}</>}
        </div>
        {!loading && !err && !list.length && (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
            {rows.length ? tr('ไม่มีรายการที่ตรงเงื่อนไข') : tr('ไม่มีใบผลิตที่ปิดในช่วงนี้')}
          </div>
        )}
        {list.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={{ ...th, textAlign: 'left' }}>{tr('พาร์ท')}</th>
                <th style={th}>{tr('แบบ SAP')}</th>
                <th style={th}>{tr('ESM ตัดจริง')}</th>
                <th style={th}>{tr('ต่าง (ESM − SAP)')}</th>
              </tr></thead>
              <tbody>
                {list.map(r => (
                  <tr key={r.mat_no}>
                    <td style={{ ...td, textAlign: 'left' }}>{r.op_eaten && <span title={tr('ขั้น OP เป็นคนกิน')}>🔩 </span>}<MatLabel mat={r.mat_no} name={r.part_name} /></td>
                    <td style={td}>{fmt(r.sap)}</td>
                    <td style={td}>{fmt(r.esm)}</td>
                    <td style={{ ...td, fontWeight: 700, color: Math.abs(r.diff) < 1e-6 ? 'var(--muted)' : r.diff > 0 ? 'var(--red)' : 'var(--amber)' }}>
                      {r.diff > 0 ? '+' : ''}{fmt(r.diff)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
