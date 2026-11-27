/* ═══ 🧾 ประวัติเบิก-ส่ง — ไลน์ขออะไรไป · สโตร์ส่งอะไรมา (2026-11-27 · คำสั่ง user) ════════════
   `/line-stock?tab=reqlog` · อ่านอย่างเดียวจาก `wip_replenish_requests` (Main)
   กฎสรุป/ผลของใบ = `utils/requestHistory.js` ที่เดียว (ห้ามคิดในหน้า)
   · ช่วงเวลา = วันทำงาน (`<TimeRangeBar>` · เริ่ม 08:00) → แปลงเป็น `requested_at` ผ่าน `workRangeToTs()`
   · ขอบเขตไลน์ = `lineScope()` ของกลาง · ซ่อนกี่ใบต้องเขียนบนจอ · ตัดสินไม่ได้ = ไม่ซ่อน
   · เพดานช่วง REQ_MAX_DAYS กัน egress — เกิน = บอกบนจอ ไม่ดึง (ห้ามตัดเงียบ)
   · CSV = เอกสาร ⇒ ชื่อไฟล์ผ่านทะเบียน /doc-forms (`csv_line_request_history`)
   ═══════════════════════════════════════════════════════════════════════════ */
import { useState, useEffect, useCallback, useContext, useMemo, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { UserContext } from '../App';
import { Hub } from './Page';
import TimeRangeBar from './TimeRangeBar';
import useTimeRange from '../utils/useTimeRange';
import { rangeDays } from '../utils/timeRange';
import FilterBar from './FilterBar';
import LineSelect from './LineSelect';
import SearchInput from './SearchInput';
import Segmented from './Segmented';
import NoticeBar from './NoticeBar';
import MatLabel from './MatLabel';
import { fetchAllRows } from '../utils/fetchAllRows';
import { downloadCsvDoc, csvCell } from '../utils/csvDoc';
import { allOf } from '../utils/filterLabels';
import { lineScope, filterRowsByLineScope } from '../utils/sectionScope';
import { useProductionLinesState } from '../utils/useProductionLines';
import { reqSourceMeta } from '../utils/replenishGate';
import { qtyUnit } from '../utils/coilUom';
import { waitText } from '../utils/storeTvDemand';
import { OUTCOME_META, reqOutcome, leadMinOf, qtyDiffOf, summarizeRequests, workRangeToTs } from '../utils/requestHistory';
import { tr, dateLocale } from '../utils/i18n';

const REQ_COLS = 'id, line_name, mat_no, part_name, request_qty, uom, picked_qty, received_qty, status, source, '
  + 'requested_at, requested_by, picked_at, picked_by_name, delivered_at, received_at, received_by_name, received_note, '
  + 'cancelled_at, cancel_reason';
const REQ_MAX_DAYS = 93;
const PAGE = 300;

const TONE = {
  ok:   { c: 'var(--green)', bg: 'var(--green-dim)' },
  bad:  { c: 'var(--red)',   bg: 'var(--red-dim)' },
  warn: { c: 'var(--amber)', bg: 'var(--amber-dim)' },
  info: { c: 'var(--blue)',  bg: 'var(--blue-dim)' },
  mute: { c: 'var(--muted)', bg: 'var(--bg2)' },
};
const OUT_FILTERS = [
  { value: '',        label: 'ทุกสถานะ' },
  { value: 'pending', label: 'ค้าง' },
  { value: 'short',   label: 'รับไม่ครบ' },
  { value: 'full',    label: 'รับครบ' },
  { value: 'cancelled', label: 'ยกเลิก' },
];

const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString(dateLocale(), { timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const fmtQty = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? '—' : Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 }));
const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', boxShadow: 'var(--shadow-sm)' };
const th = { padding: '8px 10px', fontSize: 11, fontWeight: 800, color: 'var(--muted)', textAlign: 'left', whiteSpace: 'nowrap' };
const td = { padding: '7px 10px', fontSize: 12.5, borderTop: '1px solid var(--border)', verticalAlign: 'top' };

export default function LineRequestHistory() {
  const { role, lineId, sections, scopeIdx } = useContext(UserContext);
  const linesState = useProductionLinesState();
  const lines = useMemo(() => linesState.rows || [], [linesState.rows]);
  const tr0 = useTimeRange({ defaultDays: 7, finest: 'day' });
  const days = rangeDays(tr0.from, tr0.to);
  const [lineFilter, setLineFilter] = useState('');
  const [outFilter, setOutFilter] = useState('');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [show, setShow] = useState(PAGE);
  const req = useRef(0);

  const load = useCallback(async () => {
    const my = ++req.current;   // กันผลรอบเก่าทับรอบใหม่ (กฎเหล็ก DB ข้อ 4)
    if (days > REQ_MAX_DAYS) { setRows([]); setErr(`${tr('ช่วงที่เลือก')} ${days} ${tr('วัน เกินเพดาน')} ${REQ_MAX_DAYS} ${tr('วัน — เลือกช่วงให้สั้นลง')}`); return; }
    const ts = workRangeToTs(tr0.from, tr0.to);
    if (!ts) { setRows([]); setErr(tr('อ่านช่วงวันที่ไม่ออก')); return; }
    setLoading(true);
    const { data, error } = await fetchAllRows(supabase, 'wip_replenish_requests', REQ_COLS, (x) => {
      let y = x.gte('requested_at', ts.gte).lt('requested_at', ts.lt).order('requested_at', { ascending: false }).order('id');
      if (lineFilter) y = y.eq('line_name', lineFilter);
      return y;
    });
    if (my !== req.current) return;
    setLoading(false);
    setRows(data || []);
    setShow(PAGE);
    setErr(error ? `${tr('โหลดไม่ครบ')}: ${error.message}` : '');
  }, [tr0.from, tr0.to, days, lineFilter]);
  useEffect(() => { load(); }, [load]);

  /* 🔭 ขอบเขตการดู — ของกลาง lineScope · ไลน์นอกทะเบียน = ตัดสินไม่ได้ ⇒ ไม่ซ่อน (บอกบนจอ) */
  const scope = useMemo(() => lineScope({ role, lineId, sections: sections || [], lines, scopeIdx }),
    [role, lineId, sections, lines, scopeIdx]);
  const scoped = useMemo(() => filterRowsByLineScope(rows, {
    scopedNames: scope.unlimited ? null : scope.names, lineNames: lines.map(l => l.name),
  }), [rows, scope, lines]);

  const needle = q.trim().toLowerCase();
  const searched = useMemo(() => (needle
    ? scoped.rows.filter(r => [r.mat_no, r.part_name, r.line_name, r.requested_by, r.picked_by_name, r.received_by_name, r.received_note]
      .some(v => String(v || '').toLowerCase().includes(needle)))
    : scoped.rows), [scoped.rows, needle]);
  const sum = useMemo(() => summarizeRequests(searched), [searched]);
  const shown = useMemo(() => searched.filter(r => {
    if (!outFilter) return true;
    const o = reqOutcome(r);
    return outFilter === 'pending' ? (o === 'open' || o === 'awaiting') : o === outFilter;
  }), [searched, outFilter]);

  const exportCsv = () => {
    const head = ['ขอเมื่อ', 'ไลน์', 'MAT', 'ชื่อพาร์ท', 'ที่มา', 'ผู้ขอ', 'ขอ', 'สโตร์หยิบ', 'ไลน์รับ', 'หน่วย', 'ส่วนต่าง', 'ผล', 'หยิบเมื่อ', 'ส่งถึงเมื่อ', 'รับเมื่อ', 'ผู้รับ', 'ขอ→รับ (นาที)', 'หมายเหตุรับ/เหตุยกเลิก'];
    const body = shown.map(r => [fmtTime(r.requested_at), r.line_name, r.mat_no, r.part_name || '', reqSourceMeta(r.source).short, r.requested_by || '',
      r.request_qty ?? '', r.picked_qty ?? '', r.received_qty ?? '', qtyUnit(r.uom), qtyDiffOf(r) ?? '', OUTCOME_META[reqOutcome(r)].label,
      fmtTime(r.picked_at), fmtTime(r.delivered_at), fmtTime(r.received_at), r.received_by_name || '', leadMinOf(r) ?? '', r.received_note || r.cancel_reason || '']
      .map(csvCell).join(','));
    downloadCsvDoc('csv_line_request_history', `line_request_history_${tr0.from}_${tr0.to}${lineFilter ? '_' + lineFilter : ''}`,
      [head.map(csvCell).join(','), ...body].join('\n'));
  };

  const tiles = [
    { label: 'ขอไป', value: sum.active, unit: 'ใบ', sub: sum.byOutcome.cancelled ? `${tr('ไม่นับยกเลิก')} ${sum.byOutcome.cancelled} ${tr('ใบ')}` : null },
    { label: 'รับครบ', value: sum.byOutcome.full, unit: 'ใบ', tone: sum.byOutcome.full ? 'ok' : null },
    { label: 'รับไม่ครบ', value: sum.byOutcome.short, unit: 'ใบ', tone: sum.byOutcome.short ? 'bad' : null,
      sub: sum.byOutcome.recv_noqty ? `+ ${sum.byOutcome.recv_noqty} ${tr('ใบรับแล้วแต่ไม่มียอดรับ (ตัดสินไม่ได้)')}` : null },
    { label: 'ค้าง', value: sum.pending, unit: 'ใบ', tone: sum.pending ? 'warn' : null,
      sub: `${tr('ยังไม่ส่ง')} ${sum.byOutcome.open} · ${tr('ส่งแล้วรอไลน์รับ')} ${sum.byOutcome.awaiting}` },
    { label: 'ขอ → รับ เฉลี่ย', value: sum.avgLeadMin == null ? '—' : waitText(sum.avgLeadMin), unit: '',
      sub: sum.leadN ? `${tr('จาก')} ${sum.leadN} ${tr('ใบที่รับแล้ว')}` : tr('ยังไม่มีใบที่รับแล้วในช่วงนี้') },
  ];

  return (
    <Hub>
      <TimeRangeBar scale={tr0.scale} from={tr0.from} to={tr0.to} today={tr0.today} scales={null}
        onFrom={tr0.setFrom} onTo={tr0.setTo} onPreset={tr0.setPreset} onReload={load} loading={loading}>
        <LineSelect lines={lines} value={lineFilter} onChange={setLineFilter} role={role} lineId={lineId} sections={sections} scopeIdx={scopeIdx}
          placeholder={allOf('ไลน์')} />
        <SearchInput value={q} onChange={setQ} fields={tr('MAT / ชื่อพาร์ท / ไลน์ / ผู้ขอ / ผู้รับ')} ariaLabel={tr('ค้นหาประวัติเบิก-ส่ง')} />
        <button className="pg-btn" onClick={exportCsv} disabled={!shown.length}>Export CSV</button>
      </TimeRangeBar>

      {err && <NoticeBar tone="bad" style={{ marginTop: 8 }}>{err}</NoticeBar>}
      {linesState.failed && <NoticeBar tone="warn" style={{ marginTop: 8 }}>{tr('โหลดทะเบียนไลน์ไม่สำเร็จ — ยังตัดขอบเขตไลน์ไม่ได้ จึงแสดงทุกไลน์')}</NoticeBar>}
      {(scoped.hidden > 0 || scope.unsure) && (
        <NoticeBar tone="info" style={{ marginTop: 8 }}>
          {scoped.hidden > 0 && <>{tr('ซ่อนใบของไลน์นอกขอบเขตของคุณ')} {scoped.hidden.toLocaleString()} {tr('ใบ')} </>}
          {scope.unsure && <>{tr('· ขอบเขตไลน์ของบัญชีนี้ตัดสินไม่ชัด')}</>}
        </NoticeBar>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 10, margin: '12px 0', alignContent: 'start' }}>
        {tiles.map(t => (
          <div key={t.label} style={{ ...card, padding: '12px 16px', borderColor: t.tone ? TONE[t.tone].c : 'var(--border)' }}>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 700 }}>{tr(t.label)}</div>
            <div style={{ fontSize: 24, fontWeight: 900, fontFamily: 'var(--font-display)', color: t.tone ? TONE[t.tone].c : 'var(--text)' }}>
              {typeof t.value === 'number' ? t.value.toLocaleString() : t.value}
              {t.unit && <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', marginLeft: 4 }}>{tr(t.unit)}</span>}
            </div>
            {t.sub && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{t.sub}</div>}
          </div>
        ))}
      </div>

      <FilterBar>
        <Segmented value={outFilter} onChange={setOutFilter} options={OUT_FILTERS.map(o => ({ ...o, label: tr(o.label) }))} />
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
          {tr('แสดง')} {shown.length.toLocaleString()} / {searched.length.toLocaleString()} {tr('ใบ')}
        </span>
      </FilterBar>

      <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
        <div className="table-sticky" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--bg2)' }}>
                {['ขอเมื่อ', 'ไลน์', 'พาร์ท', 'ที่มา / ผู้ขอ', 'ขอ', 'สโตร์หยิบ', 'ไลน์รับ', 'ส่วนต่าง', 'ผล', 'ขอ → รับ'].map(h => (
                  <th key={h} style={{ ...th, textAlign: ['ขอ', 'สโตร์หยิบ', 'ไลน์รับ', 'ส่วนต่าง'].includes(h) ? 'right' : 'left' }}>{tr(h)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr><td colSpan={10} style={{ padding: 30, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
                  {loading ? tr('กำลังโหลด…')
                    : searched.length ? tr('ไม่มีใบที่ตรงกับสถานะที่เลือก')
                    : rows.length ? tr('ไม่มีใบที่ตรงกับคำค้น / ขอบเขต')
                    : tr('ไม่มีใบเบิกในช่วงนี้')}
                </td></tr>
              )}
              {shown.slice(0, show).map(r => {
                const o = reqOutcome(r), meta = OUTCOME_META[o], tone = TONE[meta.tone];
                const diff = qtyDiffOf(r), lead = leadMinOf(r), unit = qtyUnit(r.uom);
                return (
                  <tr key={r.id}>
                    <td style={{ ...td, whiteSpace: 'nowrap', color: 'var(--text2)' }}>{fmtTime(r.requested_at)}</td>
                    <td style={{ ...td, fontWeight: 600 }}>{r.line_name || '—'}</td>
                    <td style={{ ...td, maxWidth: 320 }}><MatLabel mat={r.mat_no} name={r.part_name} /></td>
                    <td style={{ ...td, fontSize: 12 }}>
                      <div>{reqSourceMeta(r.source).short}</div>
                      <div style={{ color: 'var(--muted)', fontSize: 11 }}>{r.requested_by || '—'}</div>
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{fmtQty(r.request_qty)} <span style={{ fontSize: 11, color: 'var(--muted)' }}>{unit}</span></td>
                    <td style={{ ...td, textAlign: 'right' }}>{fmtQty(r.picked_qty)}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{fmtQty(r.received_qty)}</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: diff == null ? 'var(--muted)' : diff < 0 ? 'var(--red)' : 'var(--text2)' }}>
                      {diff == null ? '—' : `${diff > 0 ? '+' : ''}${fmtQty(diff)}`}
                    </td>
                    <td style={td}>
                      <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 'var(--r-md)', fontWeight: 700, background: tone.bg, color: tone.c, whiteSpace: 'nowrap' }}>
                        {tr(meta.label)}{o === 'other' && r.status ? ` (${r.status})` : ''}
                      </span>
                      {(r.received_note || r.cancel_reason) && (
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>{r.received_note || r.cancel_reason}</div>
                      )}
                    </td>
                    <td style={{ ...td, whiteSpace: 'nowrap', fontSize: 12, color: 'var(--text2)' }}>
                      {lead == null ? '—' : waitText(lead)}
                      {r.received_by_name && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.received_by_name}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {shown.length > show && (
          <div style={{ padding: 10, textAlign: 'center' }}>
            <button className="pg-btn" onClick={() => setShow(s => s + PAGE)}>
              {tr('แสดงเพิ่ม')} ({(shown.length - show).toLocaleString()} {tr('ใบที่เหลือ')})
            </button>
          </div>
        )}
      </div>
    </Hub>
  );
}
