/* 🏭 แผง "ข้อมูลจากเครื่อง" ในหน้าต้นทาง (/integrations?src=<code>) — OEE Line D3 เฟสเดินคู่ (2026-11-11 · คำสั่ง user)
   📄 docs/modules/integration-hub.md §OEE Line D3 · สูตรจัดถัง = src/utils/machineFacts.js (ห้ามคิดในหน้า)

   3 ส่วน: ① ผูกรหัสเครื่องของต้นทาง ↔ เครื่องในทะเบียน  ② จับคู่เหตุผลหยุด ↔ ประเภท downtime ของ ESM
           ③ ตารางเทียบกับ Daily Report (รายไลน์ × วัน × กะ)
   🔴 ยังไม่ใช่ OEE · ไม่เขียน downtime_logs · ไม่ป้อนสูตร (SCADA doc §6 เฟสเดินคู่)
   🔴 จับคู่ = คนกดเท่านั้น (เขียนผ่าน edge integration-admin · สิทธิ์ integration:manage) — ระบบเสนอเฉพาะตัวตรงเป๊ะ
   🔴 อ่านไม่ได้ = เขียนบนจอ ห้ามโชว์ตารางว่างเงียบ · ไม่รู้ = "–" ไม่ใช่ 0
   ⚠️ egress: ชิ้นดึงแบบรวมรายชั่วโมง (rpc fn_machine_counter_hourly) · ย้อนหลังคงที่ 7 วัน · โหลดใหม่ทุก RATE.BOARD */
import { useCallback, useMemo, useRef, useState } from 'react';
import NoticeBar from './NoticeBar';
import MachineSelect from './MachineSelect';
import SearchSelect from './SearchSelect';
import { toast } from './Toast';
import { supabaseDR } from '../supabaseClient';
import { usePolling } from '../utils/usePolling';
import { RATE } from '../utils/refreshRates';
import { fetchAllRows } from '../utils/fetchAllRows';
import { fetchByIds } from '../utils/fetchByIds';
import { bkkDateStr } from '../utils/workDate';
import { SESSION_STATUSES_REAL } from '../utils/sessionStatus';
import useMachines from '../utils/useMachines';
import { lineNameCompare } from '../utils/lineHierarchy';
import {
  summarizeMachineFacts, compareWithSessions, reasonRows, tagRows, suggestDowntimeType, stopTotals, STATE_META, STATE_ORDER,
} from '../utils/machineFacts';

const DAYS = 7;
const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 14, boxShadow: 'var(--shadow-sm)', minWidth: 0 };
const th = { textAlign: 'left', padding: '6px 8px', fontSize: 12, color: 'var(--muted)', fontWeight: 700, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' };
const td = { padding: '6px 8px', fontSize: 12.5, borderBottom: '1px solid var(--border)', verticalAlign: 'top' };
const KIND_LABEL = { onplan: 'หยุดตามแผน (OnplanMaster)', alarm: 'Alarm (AlarmMaster)', unplan: 'หยุดนอกแผน/รอ (UnplanMaster)' };
const fmtTime = (ms) => (ms ? new Date(ms).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const fmtDate = (d) => new Date(`${d}T00:00:00+07:00`).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', weekday: 'short', day: 'numeric', month: 'short' });
const minTxt = (sec) => (sec == null ? '–' : `${Math.round(sec / 60).toLocaleString()}`);
const num = (v) => (v == null ? '–' : Number(v).toLocaleString());

export default function MachineFactsPanel({ src, canManage, callAdmin }) {
  const { machines, failed: machinesFailed } = useMachines();
  const [data, setData] = useState(null);       // null = กำลังโหลด
  const [busy, setBusy] = useState('');
  const req = useRef(0);

  const load = useCallback(async () => {
    const id = ++req.current;
    const fromMs = Date.now() - DAYS * 86400000;
    const fromIso = new Date(fromMs).toISOString();
    const [st, pc, tm, rm, dt] = await Promise.all([
      fetchAllRows(supabaseDR, 'machine_state_events',
        'machine_tag, started_at, ended_at, duration_sec, state, reason_code, reason_text, is_minor',
        q => q.eq('source_id', src.id).gte('started_at', fromIso).order('started_at').order('machine_tag')),
      supabaseDR.rpc('fn_machine_counter_hourly', { p_source: src.id, p_from: fromIso }),
      supabaseDR.from('machine_tag_map').select('tag, machine_id, confirmed_by, confirmed_at').eq('source_id', src.id),
      supabaseDR.from('machine_reason_map').select('reason_kind, reason_code, reason_text, downtime_type_id, confirmed_by, confirmed_at').eq('source_id', src.id),
      supabaseDR.from('dr_downtime_types').select('id, name_th, category, process_type, is_active, sort_order').order('sort_order'),
    ]);
    if (id !== req.current) return;
    const errs = [st.error && 'ช่วงหยุด', pc.error && 'นับชิ้น', tm.error && 'การผูกเครื่อง', rm.error && 'การจับคู่เหตุผล', dt.error && 'ประเภท downtime'].filter(Boolean);
    // ฝั่ง Daily Report โหลดแยก (loadDr) — คงค่ารอบก่อนไว้ ไม่งั้นตารางเทียบหายไปค้าง "กำลังโหลด" จนรอบหน้า
    setData(prev => ({ states: st.data || [], counters: pc.data || [], tagMap: tm.data || [], reasonMap: rm.data || [], dtTypes: dt.data || [],
      errs, fromDate: bkkDateStr(fromMs), sessions: prev?.sessions ?? null, downtimes: prev?.downtimes ?? null, drErr: prev?.drErr ?? null }));
  }, [src.id]);
  usePolling(load, RATE.BOARD);

  /* Daily Report ของไลน์ที่มีเครื่องผูกแล้ว — โหลดต่อเมื่อรู้ไลน์ (ขึ้นกับทะเบียนเครื่อง + การผูก) */
  const mapped = useMemo(() => (data?.tagMap || []).filter(t => t.machine_id), [data?.tagMap]);
  const lineKey = useMemo(() => {
    const byId = new Map(machines.map(m => [m.id, m]));
    return [...new Set(mapped.map(t => byId.get(t.machine_id)?.line_name).filter(Boolean))].sort(lineNameCompare).join('\u0001');
  }, [mapped, machines]);
  const drReq = useRef(0);
  const loadDr = useCallback(async () => {
    const id = ++drReq.current;
    const lines = lineKey ? lineKey.split('\u0001') : [];
    const fromDate = bkkDateStr(Date.now() - DAYS * 86400000);
    if (!lines.length) { setData(d => (d ? { ...d, sessions: [], downtimes: [], drErr: null } : d)); return; }
    const s = await supabaseDR.from('production_sessions').select('id, work_date, shift, line_name, status, actual_qty')
      .in('line_name', lines).gte('work_date', fromDate).in('status', SESSION_STATUSES_REAL).limit(1000);
    if (id !== drReq.current) return;
    if (s.error) { setData(d => (d ? { ...d, sessions: [], downtimes: [], drErr: 'อ่านใบผลิต (Daily Report) ไม่สำเร็จ' } : d)); return; }
    const dl = await fetchByIds((s.data || []).map(x => x.id),
      part => supabaseDR.from('downtime_logs').select('id, session_id, duration_min, machine_no').in('session_id', part));
    if (id !== drReq.current) return;
    setData(d => (d ? { ...d, sessions: s.data || [], downtimes: dl.rows,
      drErr: dl.error ? 'อ่าน downtime ที่คนลงไม่ครบ — ช่อง DT ของคนอาจต่ำกว่าจริง' : null } : d));
  }, [lineKey]);
  usePolling(loadDr, RATE.BOARD, { enabled: !!data });

  const facts = useMemo(() => (data ? summarizeMachineFacts(data) : []), [data]);
  const compare = useMemo(() => (data?.sessions ? compareWithSessions(facts, { machines, sessions: data.sessions, downtimes: data.downtimes }) : null),
    [facts, machines, data?.sessions, data?.downtimes]);
  const tags = useMemo(() => (data ? tagRows({ ...data, machines }) : []), [data, machines]);
  const reasons = useMemo(() => (data ? reasonRows(data.states, data.reasonMap) : { rows: [], unmappable: 0, noReason: { count: 0, sec: 0 } }), [data]);
  const dtById = useMemo(() => new Map((data?.dtTypes || []).map(t => [t.id, t])), [data?.dtTypes]);
  const dtOptions = useMemo(() => (data?.dtTypes || []).filter(t => t.is_active !== false).map(t => ({
    id: t.id, label: t.name_th, group: t.category === 'planned' ? 'ในแผน' : 'นอกแผน',
    sub: t.process_type || 'ทุกกระบวนการ', keywords: [t.process_type || ''],
  })).sort((a, b) => (a.group === b.group ? 0 : a.group === 'ในแผน' ? -1 : 1)), [data?.dtTypes]);
  const machineNo = useCallback((id) => machines.find(m => m.id === id)?.machine_no || null, [machines]);

  const save = async (key, action, payload, okText) => {
    setBusy(key);
    try { await callAdmin(action, { id: src.id, ...payload }); toast.success(okText); await load(); }
    catch (e) { toast.error(`${okText}ไม่สำเร็จ: ${e.message}`); }
    finally { setBusy(''); }
  };

  if (!data) return <div style={card}><div style={{ color: 'var(--muted)' }}>กำลังโหลดข้อมูลจากเครื่อง…</div></div>;
  const unmappedTags = tags.filter(t => !t.map?.machine_id);
  const nothingYet = !data.states.length && !data.counters.length;

  return (
    <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
      <NoticeBar tone="info">
        🏭 ข้อมูลจากเครื่อง · <b>เฟสเดินคู่</b> — ยังไม่เข้าสูตร OEE และไม่สร้างใบ downtime · ใช้เทียบกับที่คนลงใน Daily Report เท่านั้น
        · ย้อนหลัง {DAYS} วัน (ตั้งแต่ {data.fromDate ? fmtDate(data.fromDate) : '—'}) · ข้อมูลเก็บ 90 วัน
      </NoticeBar>
      {data.errs.length > 0 && <NoticeBar tone="bad">อ่านไม่สำเร็จ: {data.errs.join(' · ')} — ตัวเลขด้านล่างไม่ครบ</NoticeBar>}
      {machinesFailed && <NoticeBar tone="warn">โหลดทะเบียนเครื่องไม่สำเร็จ — ยังผูกเครื่อง/รู้ไลน์ไม่ได้</NoticeBar>}
      {nothingYet && !data.errs.length && (
        <NoticeBar tone="warn">ยังไม่ได้รับข้อมูลจากเครื่องใน {DAYS} วันนี้ — import flow (ช่วงหยุด + นับชิ้น) แล้วตั้ง env ใน Node-RED ก่อน</NoticeBar>
      )}

      {/* ① ผูกรหัสเครื่อง */}
      <div style={card}>
        <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>① รหัสเครื่องของต้นทาง ↔ เครื่องในทะเบียน ESM</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0 8px' }}>
          ผูกแล้วข้อมูลย้อนหลังตามเอง (เก็บรหัสต้นทางไว้ ไม่ต้องย้ายข้อมูล) · ระบบเสนอเฉพาะเลขที่ตรงกับทะเบียนตัวเดียว — กดยืนยันเอง
        </div>
        {!tags.length ? <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>ยังไม่เห็นรหัสเครื่องจากต้นทางนี้</div> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>รหัสต้นทาง</th><th style={th}>เห็นล่าสุด</th><th style={th}>เครื่องใน ESM</th><th style={th}>ผู้ยืนยัน</th></tr></thead>
              <tbody>
                {tags.map(t => {
                  const cur = t.map?.machine_id || '';
                  return (
                    <tr key={t.tag}>
                      <td style={{ ...td, fontFamily: 'ui-monospace, monospace', fontWeight: 700 }}>{t.tag}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtTime(t.lastAt)}</td>
                      <td style={{ ...td, minWidth: 240 }}>
                        {canManage ? (
                          <div style={{ display: 'grid', gap: 6 }}>
                            <MachineSelect valueKey="id" value={cur} machines={machines} groupByLine disabled={!!busy}
                              onChange={(m) => m?.id && m.id !== cur && save(`tag:${t.tag}`, 'map_tag', { tag: t.tag, machine_id: m.id }, `ผูก ${t.tag}`)} />
                            {cur && !machinesFailed && machines.length > 0 && !machineNo(cur) && (
                              <span style={{ fontSize: 12, color: 'var(--red)' }}>⚠ เครื่องที่ผูกไว้ไม่อยู่ในทะเบียนแล้ว — เลือกใหม่หรือเลิกผูก</span>
                            )}
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              {t.suggest && (
                                <button type="button" className="pg-btn" disabled={!!busy}
                                  onClick={() => save(`tag:${t.tag}`, 'map_tag', { tag: t.tag, machine_id: t.suggest.id }, `ผูก ${t.tag}`)}>
                                  ✓ ใช้ข้อเสนอ: {t.suggest.machine_no}{t.suggest.line_name ? ` · ${t.suggest.line_name}` : ''}</button>
                              )}
                              {cur && (
                                <button type="button" className="pg-btn" disabled={!!busy}
                                  onClick={() => window.confirm(`เลิกผูก ${t.tag}? ข้อมูลของรหัสนี้จะหายจากตารางเทียบจนกว่าจะผูกใหม่`) &&
                                    save(`tag:${t.tag}`, 'map_tag', { tag: t.tag, machine_id: null }, `เลิกผูก ${t.tag}`)}>เลิกผูก</button>
                              )}
                            </div>
                          </div>
                        ) : (
                          cur ? <b>{machineNo(cur) || (machinesFailed || !machines.length ? '…' : '⚠ เครื่องนี้ไม่อยู่ในทะเบียนแล้ว')}</b>
                            : <span style={{ color: 'var(--amber)' }}>ยังไม่ผูก{t.suggest ? ` (ข้อเสนอ: ${t.suggest.machine_no})` : ''}</span>
                        )}
                      </td>
                      <td style={{ ...td, fontSize: 12, color: 'var(--muted)' }}>
                        {t.map?.confirmed_by ? `${t.map.confirmed_by} · ${fmtTime(Date.parse(t.map.confirmed_at))}` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ② จับคู่เหตุผล */}
      <div style={card}>
        <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>② เหตุผลหยุดของต้นทาง ↔ ประเภท downtime ของ ESM</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0 8px' }}>
          เลือกเองทีละรายการ · ระบบเสนอเฉพาะชื่อที่ตรงเป๊ะ · ไม่มีตัวตรงก็กด "ไม่มีใน ESM" ได้ (บันทึกว่าตรวจแล้ว) · ตอนนี้ใช้แสดงชื่อเท่านั้น ยังไม่สร้างใบ downtime
        </div>
        {reasons.noReason.count > 0 && (
          <NoticeBar tone="info" style={{ marginBottom: 8 }}>
            {reasons.noReason.count.toLocaleString()} ช่วง ({minTxt(reasons.noReason.sec)} นาที) ไม่ได้กดเหตุผลที่หน้าเครื่อง
            (รหัส 0 = ปกติ / รีเซ็ต) — ไม่ใช่เหตุผลหยุด จึงไม่อยู่ในรายการให้จับคู่
          </NoticeBar>
        )}
        {reasons.unmappable > 0 && (
          <NoticeBar tone="warn" style={{ marginBottom: 8 }}>
            {reasons.unmappable.toLocaleString()} ช่วงเป็นสถานะ ขาดการสื่อสาร/อื่นๆ — ยังไม่รู้ว่าต้นทางใช้ master เหตุผลชุดไหน จึงยังไม่ให้จับคู่
          </NoticeBar>
        )}
        {!reasons.rows.length ? <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>ยังไม่เห็นเหตุผลหยุดจากต้นทางนี้</div> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>ชุดเหตุผล</th><th style={th}>รหัส · ชื่อฝั่งต้นทาง</th><th style={th}>{DAYS} วัน</th><th style={th}>ประเภท downtime ใน ESM</th></tr></thead>
              <tbody>
                {reasons.rows.map(r => {
                  const k = `rsn:${r.kind}:${r.code}`;
                  const cur = r.map?.downtime_type_id || '';
                  const sug = !r.map ? suggestDowntimeType(r.text, data.dtTypes) : null;
                  const base = { kind: r.kind, code: r.code, text: r.text };
                  return (
                    <tr key={k}>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{KIND_LABEL[r.kind]}</td>
                      <td style={td}><span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 700 }}>{r.code}</span> · {r.text || <i style={{ color: 'var(--muted)' }}>ต้นทางไม่ส่งชื่อ</i>}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{r.count.toLocaleString()} ครั้ง · {minTxt(r.sec)} นาที</td>
                      <td style={{ ...td, minWidth: 260 }}>
                        {canManage ? (
                          <div style={{ display: 'grid', gap: 6 }}>
                            <SearchSelect value={cur} options={dtOptions} placeholder="ค้นประเภท downtime…"
                              loadFail={data.errs.includes('ประเภท downtime') ? 'โหลดประเภท downtime ไม่สำเร็จ' : ''}
                              onChange={({ id }) => id && id !== cur && save(k, 'map_reason', { ...base, downtime_type_id: id }, `จับคู่เหตุผล ${r.code}`)} />
                            {cur && !dtById.has(cur) && !data.errs.includes('ประเภท downtime') && (
                              <span style={{ fontSize: 12, color: 'var(--red)' }}>⚠ ประเภทที่จับคู่ไว้ถูกลบจากทะเบียนแล้ว — เลือกใหม่หรือล้าง</span>
                            )}
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                              {sug && (
                                <button type="button" className="pg-btn" disabled={!!busy}
                                  onClick={() => save(k, 'map_reason', { ...base, downtime_type_id: sug.id }, `จับคู่เหตุผล ${r.code}`)}>✓ ใช้ข้อเสนอ: {sug.name_th}</button>
                              )}
                              {!(r.map && !cur) && (
                                <button type="button" className="pg-btn" disabled={!!busy}
                                  onClick={() => save(k, 'map_reason', { ...base, downtime_type_id: null }, `บันทึก "ไม่มีใน ESM" ${r.code}`)}>ไม่มีใน ESM</button>
                              )}
                              {r.map && (
                                <button type="button" className="pg-btn" disabled={!!busy}
                                  onClick={() => save(k, 'map_reason', { ...base, clear: true }, `ล้างการจับคู่ ${r.code}`)}>ล้าง</button>
                              )}
                              {r.map && !cur && <span style={{ fontSize: 12, color: 'var(--muted)' }}>ตรวจแล้ว: ไม่มีตัวตรงใน ESM</span>}
                            </div>
                          </div>
                        ) : (
                          r.map ? (cur ? <b>{dtById.get(cur)?.name_th || '⚠ ประเภทนี้ถูกลบแล้ว'}</b> : 'ไม่มีตัวตรงใน ESM')
                            : <span style={{ color: 'var(--amber)' }}>ยังไม่จับคู่</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ③ เทียบ Daily Report */}
      <div style={card}>
        <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>③ เทียบกับ Daily Report (รายไลน์ × กะ)</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0 8px' }}>
          ชิ้นแสดงรายเครื่อง ไม่รวมเป็นยอดไลน์ (ชิ้นเดียวอาจผ่านหลายเครื่อง) · นาที = เวลาหยุดที่เครื่องบันทึก แบ่งตามกะ ESM (เช้า 08–20 · ดึก 20–08)
          · "–" = ไม่มีข้อมูล ไม่ใช่ 0
        </div>
        {unmappedTags.length > 0 && (
          <NoticeBar tone="warn" style={{ marginBottom: 8 }}>
            {unmappedTags.length} รหัสเครื่องยังไม่ผูก ({unmappedTags.map(t => t.tag).join(', ')}) — ไม่อยู่ในตารางนี้จนกว่าจะผูกที่ ①
          </NoticeBar>
        )}
        {data.drErr && <NoticeBar tone="bad" style={{ marginBottom: 8 }}>{data.drErr}</NoticeBar>}
        {compare == null ? <div style={{ color: 'var(--muted)' }}>กำลังโหลด Daily Report…</div>
          : !compare.length ? <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>ยังไม่มีอะไรให้เทียบ — ต้องผูกเครื่องอย่างน้อย 1 ตัวก่อน</div> : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th}>วัน · กะ</th><th style={th}>ไลน์</th>
                    <th style={th}>Daily Report: ยอดผลิต</th><th style={th}>DT คนลง (นาที)</th>
                    <th style={th}>เครื่อง</th><th style={th}>ชิ้นจากเครื่อง</th><th style={th}>NG กดหน้าเครื่อง</th>
                    {STATE_ORDER.map(s => <th key={s} style={th} title={STATE_META[s].label}>{STATE_META[s].label} (นาที)</th>)}
                    <th style={th}>หยุดสั้น (นาที)</th><th style={th}>DT คนลงเครื่องนี้</th>
                  </tr>
                </thead>
                <tbody>
                  {compare.map(r => {
                    const ms = r.machines.length ? r.machines : [null];
                    return ms.map((m, i) => (
                      <tr key={`${r.key}|${m?.tag || '-'}`}>
                        {i === 0 && <>
                          <td style={{ ...td, whiteSpace: 'nowrap', fontWeight: 700 }} rowSpan={ms.length}>{fmtDate(r.workDate)} · {r.shift === 'day' ? 'เช้า' : 'ดึก'}</td>
                          <td style={{ ...td, whiteSpace: 'nowrap' }} rowSpan={ms.length}>{r.line}</td>
                          <td style={td} rowSpan={ms.length}>
                            {r.session ? <b>{num(r.session.actual_qty)}</b> : <span style={{ color: 'var(--muted)' }}>ไม่มีใบผลิต</span>}
                            {r.sessionCount > 1 && <div style={{ fontSize: 11, color: 'var(--amber)' }}>{r.sessionCount} ใบในกะนี้ (รวมยอด)</div>}
                          </td>
                          <td style={td} rowSpan={ms.length}>
                            {num(r.humanDtMin)}
                            {r.humanLineDtMin != null && <div style={{ fontSize: 11, color: 'var(--muted)' }}>ไม่ระบุเครื่อง {num(r.humanLineDtMin)}</div>}
                          </td>
                        </>}
                        {m ? <>
                          <td style={{ ...td, whiteSpace: 'nowrap', fontFamily: 'ui-monospace, monospace' }}>{m.machineNo}</td>
                          <td style={td}>{num(m.pieces)}{m.pieces != null && <div style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{m.minutes.toLocaleString()} นาทีที่มีข้อมูล</div>}</td>
                          <td style={td}>{num(m.ng)}</td>
                          {STATE_ORDER.map(s => <td key={s} style={td}>{m.stopSec[s] ? minTxt(m.stopSec[s]) : '0'}</td>)}
                          <td style={td}>{minTxt(m.minorSec)}</td>
                          <td style={td}>{num(m.humanDtMin)}</td>
                        </> : (
                          <td style={{ ...td, color: 'var(--amber)' }} colSpan={STATE_ORDER.length + 5}>เครื่องไม่ได้ส่งข้อมูลกะนี้</td>
                        )}
                      </tr>
                    ));
                  })}
                </tbody>
              </table>
            </div>
          )}
        {compare?.length > 0 && (
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
            หยุดรวมที่เครื่องบันทึก {DAYS} วัน: {minTxt(facts.reduce((s, f) => s + stopTotals(f.stopSec).all, 0))} นาที
            · DT ที่คนลง: {num(compare.reduce((s, r) => s + (r.humanDtMin || 0), 0))} นาที
          </div>
        )}
      </div>
    </div>
  );
}
