/* 🔌 ศูนย์เชื่อมต่อ Node-RED / เครื่องจักร — /integrations (หมวด ตั้งค่าโปรแกรม,ฐานข้อมูล · 2026-11-11 · คำสั่ง user)
   📄 docs/modules/integration-hub.md · รูปตัวอย่าง (artifact) ที่ user OK แล้ว 11/11

   แท็บ `?tab=sources|kinds` · หน้าต้นทาง `?src=<code>` (คนละ param กับ tab · UI §6.8 ข้อ 2.4)
   🔴 ทะเบียนชนิดข้อมูล = ตาราง integration_kinds (DR) รวมกับชนิดในตัวผ่าน mergeKinds() (src/utils/integrationKinds.js · 27/11)
      · ตัว gen flow = src/utils/nodeRedFlow.js — ห้ามประกอบเองในหน้า · เพิ่ม/แก้/ลบชนิด = modal ในแท็บชนิดข้อมูล (edge kind_*)
   🔴 สร้าง/เปลี่ยนรหัส/พัก = ผ่าน edge `integration-admin` เท่านั้น (ตาราง DR client เป็น anon — เขียนตรงไม่ได้โดยตั้งใจ)
   🔴 รหัสลับแสดงครั้งเดียวหลังสร้าง/เปลี่ยน · ไม่เก็บใน state ถาวร ไม่ใส่ในไฟล์ flow
   ⚠️ egress: เลือกคอลัมน์ · สถิติดึงแค่ 25 ชม. · poll ทุก 1 นาที (RATE.METER) */
import { useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { UserContext } from '../App';
import Page from '../components/Page';
import PageHeader from '../components/PageHeader';
import NoticeBar from '../components/NoticeBar';
import EnergyMqttTopics from '../components/EnergyMqttTopics';
import MachineFactsPanel from '../components/MachineFactsPanel';
import IntegrationGuide from '../components/IntegrationGuide';
import { toast } from '../components/Toast';
import { supabase, supabaseDR, DR_BASE_URL } from '../supabaseClient';
import useTabParam from '../utils/useTabParam';
import { usePolling } from '../utils/usePolling';
import { RATE } from '../utils/refreshRates';
import { can } from '../utils/permissions';
import { loadLinesRes } from '../utils/useProductionLines';
import { energyPointOptions, energyZonesFrom } from '../utils/energy';
import { mergeKinds, kindOf, kindLabel, sourceStatus, healthBars, SOURCE_STALE_MIN, SENSOR_KEEP_DAYS } from '../utils/integrationKinds';
import { buildNodeRedFlow, envVarName } from '../utils/nodeRedFlow';
import { bkkDateStr } from '../utils/workDate';

import { tr, dateLocale } from '../utils/i18n';
import { askConfirm } from '../utils/askConfirm';
const COLS = 'id, code, name, note, kinds, key_hint, legacy_secret, is_paused, last_seen_at, last_ok_at, last_error, last_result, updated_at, updated_by';
const INGEST_URL = `${DR_BASE_URL}/functions/v1/ingest-energy`;
const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 14, boxShadow: 'var(--shadow-sm)' };
const chip = { fontSize: 12, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6, padding: '2px 8px' };
const STATUS = {
  online: { label: 'ออนไลน์', color: 'var(--green)' },
  stale: { label: 'ขาดการติดต่อ', color: 'var(--amber)' },
  never: { label: 'ยังไม่เคยได้รับ', color: 'var(--muted)' },
  paused: { label: 'พักการรับ', color: 'var(--red)' },
};
const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString(dateLocale(), { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');

/** เรียก edge integration-admin — ตรวจ token ล็อกอินของ Main + has_perm('integration:manage') ฝั่ง server */
async function callAdmin(action, payload = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('ต้องล็อกอินก่อน');
  const { data, error } = await supabaseDR.functions.invoke('integration-admin', {
    body: { action, ...payload },
    headers: { 'x-esm-token': session.access_token, 'x-esm-apikey': import.meta.env.VITE_SUPABASE_ANON_KEY },
  });
  if (error) {
    let msg = error.message;
    try { msg = (await error.context.json()).error || msg; } catch { /* ตอบไม่ใช่ JSON — ใช้ข้อความเดิม */ }
    throw new Error(msg);
  }
  if (!data?.ok) throw new Error(data?.error || 'ทำรายการไม่สำเร็จ');
  return data;
}

export default function Integrations() {
  const { role } = useContext(UserContext);
  const canManage = can('integration', 'manage', role);
  const canMap = can('energy', 'record', role);
  const [tab, setTab] = useTabParam(['sources', 'kinds', 'guide'], 'sources');
  const [params, setParams] = useSearchParams();
  const srcCode = params.get('src') || '';
  const [sources, setSources] = useState(null);       // null = ยังไม่โหลด/อ่านไม่ได้
  const [hourly, setHourly] = useState([]);
  const [kindRows, setKindRows] = useState(undefined); // undefined = ยังโหลด · null = อ่านไม่ได้ (ใช้ชนิดในตัวตามโค้ด + เขียนบอก)
  const [err, setErr] = useState('');
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [creating, setCreating] = useState(false);
  const [shownKey, setShownKey] = useState(null);     // { code, key } — โชว์ครั้งเดียว
  const reqId = useRef(0);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    const since = new Date(Date.now() - 25 * 3600000).toISOString();
    const [s, h, k] = await Promise.all([
      supabaseDR.from('integration_sources').select(COLS).order('created_at'),
      supabaseDR.from('integration_hourly').select('source_id, hour_at, ok_count, fail_count, saved_rows').gte('hour_at', since),
      supabaseDR.from('integration_kinds').select('key, label, icon, unit, help, is_builtin, sort_order, updated_by'),
    ]);
    if (id !== reqId.current) return;
    // ทะเบียนชนิดอ่านไม่ได้ ≠ ไม่มีชนิด — คงรอบก่อน ถ้าไม่เคยได้เลย = null (ใช้ชนิดในตัว + เขียนบอก)
    if (k.error) setKindRows(prev => (prev === undefined ? null : prev)); else setKindRows(k.data || []);
    const e = s.error || h.error;
    if (e) {
      const missing = e.code === '42P01' || e.code === 'PGRST205';
      setErr(missing ? 'ยังไม่ได้ apply migration 20261111_integration_hub_dr (DR) — แจ้ง admin' : `${tr("โหลดทะเบียนต้นทางไม่สำเร็จ")}: ${e.message}`);
      return;                                          // คงข้อมูลรอบก่อน ห้ามทับด้วยลิสต์ว่าง
    }
    setErr('');
    setSources(s.data || []);
    setHourly(h.data || []);
    setNowMs(Date.now());
  }, []);
  usePolling(load, RATE.METER);

  const openSrc = useCallback((code) => {
    setParams(prev => { const n = new URLSearchParams(prev); if (code) n.set('src', code); else n.delete('src'); return n; });
  }, [setParams]);

  const kinds = useMemo(() => mergeKinds(kindRows === undefined ? null : kindRows), [kindRows]);
  const current = srcCode && sources ? sources.find(x => x.code === srcCode) : null;
  const hourlyOf = useCallback((sid) => hourly.filter(r => r.source_id === sid), [hourly]);

  const header = (
    <PageHeader icon="🔌" title={tr('การเชื่อมต่อ Node-RED / เครื่องจักร')}
      sub={tr('ที่เดียวสำหรับทุกระบบที่ส่งข้อมูลเข้า ESM · ต้นทางส่งข้อเท็จจริง สูตรและการตัดสินอยู่ที่ ESM')}
      tabs={[{ key: 'sources', label: tr("แหล่งต้นทาง") }, { key: 'kinds', label: tr("ชนิดข้อมูล") }, { key: 'guide', label: tr("คู่มือ (WI)") }]}
      tab={tab} onTab={(k) => { openSrc(null); setTab(k); }}
      actions={canManage && !srcCode && tab === 'sources'
        ? <button type="button" className="pg-btn primary" onClick={() => setCreating(true)}>{tr('+ เพิ่มการเชื่อมต่อ')}</button> : null} />
  );

  return (
    <Page>
      {header}
      {err && <NoticeBar tone="bad">{err}{sources ? tr(" — ตัวเลขบนจอเป็นของรอบก่อนหน้า") : ''}</NoticeBar>}
      {kindRows === null && <NoticeBar tone="warn">{tr('อ่านทะเบียนชนิดข้อมูลไม่ได้ — แสดงเฉพาะชนิดในตัว ชนิดที่เพิ่มเองจะยังไม่ขึ้น')}</NoticeBar>}
      {!sources && !err && <div style={{ color: 'var(--muted)', padding: 20 }}>{tr('กำลังโหลด…')}</div>}

      {tab === 'guide' && <IntegrationGuide />}
      {sources && tab === 'kinds' && <KindsTab sources={sources} kinds={kinds} canManage={canManage && kindRows !== null} onChanged={load} />}

      {sources && tab === 'sources' && (srcCode ? (
        current
          ? <SourceDetail src={current} kinds={kinds} hours={hourlyOf(current.id)} nowMs={nowMs} canManage={canManage} canMap={canMap}
              onBack={() => openSrc(null)} onChanged={load} onKey={setShownKey} />
          : (
            <div style={{ display: 'grid', gap: 10 }}>
              <NoticeBar tone="warn">{tr('ไม่พบต้นทางรหัส')} <b>{srcCode}</b> {tr('ในทะเบียน')}</NoticeBar>
              <div><button type="button" className="pg-btn" onClick={() => openSrc(null)}>{tr('← การเชื่อมต่อทั้งหมด')}</button></div>
            </div>
          )
      ) : (
        <SourceList sources={sources} kinds={kinds} hourly={hourly} nowMs={nowMs} onOpen={openSrc} canManage={canManage} />
      ))}

      {creating && <CreateModal kinds={kinds} onClose={() => setCreating(false)}
        onCreated={(src, key) => { setCreating(false); setShownKey({ code: src.code, key, legacy: false }); load(); openSrc(src.code); }} />}
      {shownKey && <KeyModal info={shownKey} onClose={() => setShownKey(null)} />}
    </Page>
  );
}

/* ── ① รายการต้นทาง ── */
function SourceList({ sources, kinds, hourly, nowMs, onOpen, canManage }) {
  const st = sources.map(s => sourceStatus(s, nowMs));
  const okToday = hourly.reduce((a, r) => a + (Number(r.ok_count) || 0), 0);
  const kindsUsed = new Set(sources.flatMap(s => s.kinds || []));
  return (
    <div style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, alignContent: 'start' }}>
        <Kpi label={tr('แหล่งต้นทาง')} value={sources.length} unit={tr("ระบบ")}
          sub={`${tr("ออนไลน์")} ${st.filter(x => x === 'online').length} · ${tr("ขาด")} ${st.filter(x => x === 'stale').length} · ${tr("ยังไม่เคยได้รับ")} ${st.filter(x => x === 'never').length} · ${tr("พัก")} ${st.filter(x => x === 'paused').length}`} />
        <Kpi label={tr('ชนิดข้อมูลที่ใช้อยู่')} value={kindsUsed.size} unit={`/ ${kinds.length} ${tr("ชนิด")}`}
          sub={`ESM ${tr("รับได้แล้ว")} ${kinds.filter(k => k.status === 'live').length} ${tr("ชนิด")}`} />
        <Kpi label={tr('รับสำเร็จ 24 ชม.')} value={okToday.toLocaleString()} unit={tr("ครั้ง")} sub={tr('นับทุกต้นทางรวมกัน')} />
      </div>
      {!sources.length ? (
        <div style={{ ...card, color: 'var(--muted)' }}>{tr('ยังไม่มีต้นทางในทะเบียน')}{canManage ? tr(" — กด \"+ เพิ่มการเชื่อมต่อ\"") : ''}</div>
      ) : sources.map((s, i) => {
        const m = STATUS[st[i]];
        return (
          <div key={s.id} role="button" tabIndex={0} onClick={() => onOpen(s.code)} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(s.code); }}
            style={{ ...card, display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center', cursor: 'pointer', borderColor: st[i] === 'online' || st[i] === 'never' ? 'var(--border)' : m.color }}>
            <div style={{ flex: '999 1 320px', minWidth: 0, display: 'grid', gap: 6 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                <span style={{ fontSize: 17, fontWeight: 800, color: 'var(--text)' }}>{s.name}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: m.color, border: `1px solid ${m.color}`, borderRadius: 999, padding: '1px 10px' }}>● {tr(m.label)}</span>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>{s.code}{s.note ? ` · ${s.note}` : ''}</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {(s.kinds || []).map(k => <span key={k} style={chip}>{kindLabel(k, kinds)}</span>)}
              </div>
            </div>
            <div style={{ flex: '1 1 180px', fontSize: 12.5, display: 'grid', gap: 2 }}>
              <span style={{ color: 'var(--muted)' }}>{tr('รับสำเร็จล่าสุด')}</span>
              <b style={{ color: 'var(--text)' }}>{fmtTime(s.last_ok_at)}</b>
              {s.last_error && <span style={{ color: 'var(--red)' }}>{tr('ล้มล่าสุด:')} {s.last_error}</span>}
            </div>
            <span style={{ fontWeight: 700, color: 'var(--text2)' }}>{tr('เปิดดู →')}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ── ② หน้าต้นทาง ── */
function SourceDetail({ src, kinds, hours, nowMs, canManage, canMap, onBack, onChanged, onKey }) {
  const [busy, setBusy] = useState('');
  /* ✏️ แก้ชื่อ/หมายเหตุ (23/11 · คำสั่ง user) — edge integration-admin action 'update' · 🔴 รหัส (code) แก้ไม่ได้
     เพราะอยู่ในชื่อ topic ของมิเตอร์ (`<code>/<ตู้>/kw`) + Node-RED ตัวเดิมส่ง x-source = code ⇒ เปลี่ยน = ข้อมูลหลุด */
  const [edit, setEdit] = useState(null);           // null = ไม่ได้แก้ · { name, note, kinds }
  const [points, setPoints] = useState(null);
  const hasEnergy = (src.kinds || []).includes('energy_readings');
  const hasMachine = (src.kinds || []).some(k => k === 'machine_state' || k === 'piece_count');
  const st = sourceStatus(src, nowMs);
  const m = STATUS[st];
  const bars = useMemo(() => healthBars(hours, nowMs), [hours, nowMs]);
  const okSum = bars.reduce((a, b) => a + b.ok, 0), failSum = bars.reduce((a, b) => a + b.fail, 0);
  const flow = useMemo(() => buildNodeRedFlow({ source: src, kinds: src.kinds || [], ingestUrl: INGEST_URL, kindDefs: kinds }), [src, kinds]);

  /* จุดที่ผูก topic ได้ — โหลดเมื่อเปิดต้นทางที่ส่งค่าไฟเท่านั้น · อ่านไม่ได้ = บอกบนจอ ไม่ใช่ลิสต์ว่างเงียบ */
  const ptsReq = useRef(0);
  const loadPoints = useCallback(async () => {
    const id = ++ptsReq.current;
    const [ln, a, f] = await Promise.all([
      loadLinesRes(),
      supabaseDR.from('pm_facility_areas').select('name').order('name'),
      supabaseDR.from('machines').select('id, line_name').eq('equipment_category', 'facility').eq('is_active', true),
    ]);
    if (id !== ptsReq.current) return;
    if (ln?.error || a.error || f.error) { setPoints('error'); return; }
    setPoints(energyPointOptions(ln?.data || [], energyZonesFrom(a.data, f.data)));
  }, []);
  usePolling(loadPoints, RATE.SLOW, { enabled: hasEnergy });

  const act = async (action, label, confirmText) => {
    if (confirmText && !await askConfirm(confirmText)) return;
    setBusy(action);
    try {
      const r = await callAdmin(action, { id: src.id });
      if (r.key) onKey({ code: src.code, key: r.key });
      toast.success(label);
      onChanged();
    } catch (e) { toast.error(`${label}${tr("ไม่สำเร็จ")}: ${e.message}`); }
    finally { setBusy(''); }
  };

  const saveEdit = async () => {
    const name = (edit?.name || '').trim();
    if (!name) { toast.error(tr('ต้องมีชื่อต้นทาง')); return; }
    if (!edit.kinds.length) { toast.error(tr('เลือกชนิดข้อมูลอย่างน้อย 1 ชนิด')); return; }
    setBusy('update');
    try {
      await callAdmin('update', { id: src.id, name, note: (edit.note || '').trim() || null, kinds: edit.kinds });
      toast.success(tr('บันทึกชื่อ/หมายเหตุแล้ว'));
      setEdit(null);
      onChanged();
    } catch (e) { toast.error(`${tr('บันทึกไม่สำเร็จ')}: ${e.message}`); }
    finally { setBusy(''); }
  };

  const download = () => {
    const blob = new Blob([JSON.stringify(flow.nodes, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `esm-${src.code}-flow.json`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  };
  const copyFlow = async () => {
    try { await navigator.clipboard.writeText(JSON.stringify(flow.nodes)); toast.success('คัดลอก flow แล้ว — Node-RED › Import › วาง'); }
    catch { toast.error('คัดลอกไม่ได้ (เบราว์เซอร์ไม่อนุญาต) — ใช้ปุ่มดาวน์โหลดแทน'); }
  };

  const usesLegacy = src.legacy_secret && !src.key_hint;
  const noAuth = !src.legacy_secret && !src.key_hint;     // ไม่มีรหัสเลย = ingest ตอบ 401 ทุกครั้ง ต้องบอกบนจอ
  return (
    <div style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <button type="button" className="pg-btn" onClick={onBack}>{tr('← การเชื่อมต่อทั้งหมด')}</button>
        {edit ? (
          <div style={{ display: 'grid', gap: 6, minWidth: 0, flex: '1 1 420px' }}>
            <label style={{ display: 'grid', gap: 2, fontSize: 12, color: 'var(--muted)' }}>{tr('ชื่อต้นทาง')}
              <input value={edit.name} maxLength={120} autoFocus onChange={e => setEdit(v => ({ ...v, name: e.target.value }))} />
            </label>
            <label style={{ display: 'grid', gap: 2, fontSize: 12, color: 'var(--muted)' }}>{tr('หมายเหตุ (เช่น IP · PLC · ฐานข้อมูล)')}
              <input value={edit.note} maxLength={300} onChange={e => setEdit(v => ({ ...v, note: e.target.value }))} />
            </label>
            {/* 🌡️ เลือกชนิดข้อมูลของต้นทาง (27/11) — ชนิดที่เพิ่มเองในแท็บชนิดข้อมูลต้องติ๊กที่นี่ flow ถึงจะมีส่วนของมัน */}
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>{tr('ชนิดข้อมูลที่ต้นทางนี้ส่ง')}</div>
            <KindChecks kinds={kinds} value={edit.kinds} onChange={v => setEdit(e => ({ ...e, kinds: v }))} />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="button" className="pg-btn primary" disabled={busy === 'update'} onClick={saveEdit}>{tr('บันทึก')}</button>
              <button type="button" className="pg-btn" disabled={busy === 'update'} onClick={() => setEdit(null)}>{tr('ยกเลิก')}</button>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{tr('รหัส')} <code>{src.code}</code> {tr('แก้ไม่ได้ — อยู่ในชื่อ topic ของมิเตอร์ เปลี่ยนแล้วข้อมูลจะหลุด')}</span>
            </div>
          </div>
        ) : (
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)' }}>{src.name}
            <span style={{ marginLeft: 10, fontSize: 12, fontWeight: 700, color: m.color, border: `1px solid ${m.color}`, borderRadius: 999, padding: '1px 10px', verticalAlign: 'middle' }}>● {tr(m.label)}</span>
            {canManage && (
              <button type="button" className="pg-btn" style={{ marginLeft: 8, verticalAlign: 'middle' }} disabled={!!busy}
                onClick={() => setEdit({ name: src.name || '', note: src.note || '', kinds: [...(src.kinds || [])] })}>✏️ {tr('แก้ชื่อ / หมายเหตุ / ชนิดข้อมูล')}</button>
            )}
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{src.code}{src.note ? ` · ${src.note}` : ''} {tr('· ไม่มีค่าใหม่เกิน')} {SOURCE_STALE_MIN} {tr("นาที = ขาดการติดต่อ")}</div>
        </div>
        )}
      </div>

      <div style={{ ...card, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <button type="button" className="pg-btn primary" onClick={download} disabled={!flow.nodes.length}>{tr('⬇ ดาวน์โหลด flow')}</button>
        <button type="button" className="pg-btn" onClick={copyFlow} disabled={!flow.nodes.length}>{tr('📋 คัดลอก flow')}</button>
        {canManage && <>
          <button type="button" className="pg-btn" disabled={!!busy}
            onClick={() => act('rotate', 'ออกรหัสใหม่', src.key_hint
              ? 'ออกรหัสใหม่แล้ว รหัสเดิมจะใช้ไม่ได้ทันที — Node-RED ที่ใช้รหัสเดิมจะส่งไม่เข้าจนกว่าจะเปลี่ยน ยืนยัน?'
              : 'ออกรหัสของต้นทางนี้ (secret กลางเดิมยังใช้ได้จนกว่าจะกด "เลิกใช้รหัสกลาง") ยืนยัน?')}>
            🔑 {src.key_hint ? tr("เปลี่ยนรหัสลับ") : tr("ออกรหัสของต้นทางนี้")}</button>
          {src.legacy_secret && src.key_hint && (
            <button type="button" className="pg-btn" disabled={!!busy}
              onClick={() => act('legacy_off', 'เลิกใช้รหัสกลาง', 'ยืนยันว่า Node-RED เปลี่ยนไปใช้ ESM_SOURCE_KEY แล้ว? หลังกด รหัสกลางเดิมจะส่งเข้าต้นทางนี้ไม่ได้')}>
              {tr('เลิกใช้รหัสกลาง')}</button>
          )}
          <button type="button" className="pg-btn" disabled={!!busy} style={{ color: src.is_paused ? 'var(--green)' : 'var(--red)' }}
            onClick={() => act(src.is_paused ? 'resume' : 'pause', src.is_paused ? 'เปิดรับต่อ' : 'พักการรับ',
              src.is_paused ? null : 'พักการรับ = ข้อมูลจากต้นทางนี้จะไม่ถูกบันทึกจนกว่าจะเปิดรับต่อ ยืนยัน?')}>
            {src.is_paused ? tr('▶ เปิดรับต่อ') : tr('⏸ พักการรับ')}</button>
        </>}
        <span style={{ fontSize: 12, color: noAuth ? 'var(--red)' : 'var(--muted)' }}>
          {noAuth ? tr("⚠ ยังไม่ได้ออกรหัส — ต้นทางนี้ส่งข้อมูลเข้าไม่ได้จนกว่าจะออกรหัส")
            : <>{tr('ยืนยันตัวตนด้วย:')} {usesLegacy ? tr("รหัสกลาง (INGEST_SECRET)") : `${tr("รหัสของต้นทาง")} …${src.key_hint}`}{src.legacy_secret && src.key_hint ? tr(" · ยังรับรหัสกลางอยู่") : ''}</>}
        </span>
      </div>

      {flow.skipped.length > 0 && (
        <NoticeBar tone="warn">{tr('ไฟล์ flow ไม่มีส่วนของ:')} {flow.skipped.map(s => `${kindLabel(s.key, kinds)} (${s.reason})`).join(' · ')}</NoticeBar>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12, alignContent: 'start' }}>
        <div style={{ ...card, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>{tr('สุขภาพการส่ง · 24 ชม.')}</div>
          <div style={{ display: 'flex', gap: 2, height: 40, alignItems: 'flex-end', marginTop: 10 }} role="img"
            aria-label={`24 ${tr("ชั่วโมงล่าสุด รับสำเร็จ")} ${okSum} ${tr("ครั้ง ล้ม")} ${failSum} ${tr("ครั้ง")}`}>
            {bars.map(b => (
              <div key={b.hourMs} title={`${new Date(b.hourMs).toLocaleTimeString(dateLocale(), { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' })} · ${tr("สำเร็จ")} ${b.ok}/${b.expect}${b.fail ? ` · ${tr("ล้ม")} ${b.fail}` : ''}`}
                style={{ flex: 1, height: `${Math.max(6, b.ratio * 100)}%`, borderRadius: 2,
                  background: b.fail ? 'var(--red)' : b.ratio >= 0.95 ? 'var(--green)' : b.ok ? 'var(--amber)' : 'var(--border)' }} />
            ))}
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
            1 {tr("แท่ง = 1 ชั่วโมง · เต็ม = ได้ครบทุกนาที · ส้ม = ขาดบางนาที · แดง = มีครั้งที่ล้ม · เทา = ไม่ได้รับเลย")}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 8 }}>
            {tr("สำเร็จ")} <b>{okSum.toLocaleString()}</b> {tr('· ล้ม')} <b style={{ color: failSum ? 'var(--red)' : 'inherit' }}>{failSum}</b> {tr('ครั้ง · รับสำเร็จล่าสุด')} {fmtTime(src.last_ok_at)}
          </div>
          {src.last_error && <div style={{ fontSize: 12.5, color: 'var(--red)', marginTop: 4 }}>{tr('ล้มล่าสุด:')} {src.last_error}</div>}
          {src.last_result && (
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6, fontFamily: 'ui-monospace, monospace', overflowWrap: 'anywhere' }}>
              {tr("คำตอบล่าสุด")}: {JSON.stringify(src.last_result)}
            </div>
          )}
        </div>

        <div style={{ ...card, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>{tr('ชนิดข้อมูลของต้นทางนี้')}</div>
          <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
            {!(src.kinds || []).length && <div style={{ fontSize: 12.5, color: 'var(--amber)' }}>{tr('ยังไม่ได้กำหนดชนิดข้อมูล — ไฟล์ flow จะว่าง')}</div>}
            {(src.kinds || []).map(k => {
              const d = kindOf(k, kinds);
              return (
                <div key={k} style={{ background: 'var(--bg2)', borderRadius: 8, padding: '8px 10px', fontSize: 12.5 }}>
                  <b style={{ color: 'var(--text)' }}>{kindLabel(k, kinds)}</b>
                  {d && <span style={{ color: 'var(--muted)' }}> → {d.dest}</span>}
                  {d?.status !== 'live' && <span style={{ color: 'var(--amber)' }}> {tr('· ESM ยังไม่มีปลายทางรับ')}</span>}
                  {d?.help && <div style={{ color: 'var(--muted)' }}>{d.help}</div>}
                  {d?.home && <Link to={d.home} style={{ fontSize: 12 }}>{tr('ดูบนจอ →')}</Link>}
                </div>
              );
            })}
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>
            {tr("ไฟล์ flow ตั้ง env ของ Node-RED ชื่อ")} <code>{envVarName(src)}</code>
            {hasEnergy && ' · แม่แบบค่าไฟ = schema TSS Smart Energy'}{hasMachine && ' · แม่แบบเครื่องจักร = Node-RED OEE PD2 (oee_stop / oee_piece)'}
          </div>
        </div>
      </div>

      {hasMachine && <MachineFactsPanel src={src} canManage={canManage} callAdmin={callAdmin} />}

      {hasEnergy && (
        <div style={{ ...card, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', marginBottom: 6 }}>{tr('จับคู่ topic ค่าไฟ ↔ จุดในระบบ')}</div>
          {points === 'error'
            ? <NoticeBar tone="bad">{tr('อ่านทะเบียนไลน์/โซนไม่สำเร็จ — ยังผูก topic ไม่ได้ ลองโหลดหน้าใหม่')}</NoticeBar>
            : points == null
              ? <div style={{ color: 'var(--muted)' }}>{tr('กำลังโหลดจุด…')}</div>
              : <EnergyMqttTopics points={points} canEdit={canMap} />}
        </div>
      )}
    </div>
  );
}

/* ── แท็บชนิดข้อมูล (27/11 · คำสั่ง user "เพิ่มชนิดไม่ควร hardcode ควรเป็น modal CRUD") ──
   ชนิดในตัว = แก้ได้แค่ชื่อ/ไอคอน/คำอธิบาย (ปลายทางผูกกับโค้ด) · ชนิดที่เพิ่มเอง = เซนเซอร์ทั่วไป แก้/ลบได้
   ลบ = edge ตรวจปลายทางให้ครบ (ต้นทางที่เลือกอยู่ · ข้อมูลที่มีอยู่) นับไม่ได้ = ห้ามลบ */
function KindsTab({ sources, kinds, canManage, onChanged }) {
  const [modal, setModal] = useState(null);         // null · { mode:'create' } · { mode:'edit', kind }
  const remove = async (k) => {
    if (!await askConfirm(`ลบชนิดข้อมูล "${k.label}" (${k.key})?\nลบได้เฉพาะชนิดที่ไม่มีต้นทางเลือกอยู่และยังไม่มีข้อมูล`)) return;
    try { await callAdmin('kind_delete', { key: k.key }); toast.success(`${tr('ลบชนิดข้อมูลแล้ว')}: ${k.label}`); onChanged(); }
    catch (e) { toast.error(`${tr('ลบไม่สำเร็จ')}: ${e.message}`); }
  };
  const custom = kinds.filter(k => k.custom);
  return (
    <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <div style={{ fontSize: 12.5, color: 'var(--text2)', flex: '1 1 320px' }}>
          {tr('ชนิดในตัว = ESM มีปลายทางเฉพาะ (แก้ได้แค่ชื่อ/ไอคอน/คำอธิบาย) · ชนิดที่เพิ่มเอง = ค่าเซนเซอร์ทั่วไป (อุณหภูมิ · การสั่นสะเทือน ฯลฯ) เก็บรายนาที')} {SENSOR_KEEP_DAYS} {tr('วัน + สรุปรายวัน')}
        </div>
        {canManage && <button type="button" className="pg-btn primary" onClick={() => setModal({ mode: 'create' })}>{tr('+ เพิ่มชนิดข้อมูล')}</button>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 10, alignContent: 'start' }}>
        {kinds.map(k => {
          const users = sources.filter(s => (s.kinds || []).includes(k.key));
          return (
            <div key={k.key} style={{ ...card, display: 'grid', gap: 4, alignContent: 'start' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', flex: 1, minWidth: 0 }}>{k.icon} {tr(k.label)}{k.unit ? <span style={{ fontSize: 12, color: 'var(--muted)' }}> ({k.unit})</span> : null}</div>
                {canManage && <button type="button" className="pg-btn" onClick={() => setModal({ mode: 'edit', kind: k })}>✏️ {tr('แก้')}</button>}
                {canManage && k.custom && <button type="button" className="pg-btn" onClick={() => remove(k)}>{tr('ลบ')}</button>}
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: k.status === 'live' ? 'var(--green)' : 'var(--amber)' }}>
                {k.status === 'live' ? tr("● ESM รับได้แล้ว") : tr("○ ออกแบบไว้ — ยังไม่มีปลายทางรับ")}
                <span style={{ fontWeight: 400, color: 'var(--muted)' }}> · {k.builtin ? tr('ชนิดในตัว') : tr('เพิ่มเอง')} · <code>{k.key}</code></span>
              </div>
              {k.help && <div style={{ fontSize: 12.5, color: 'var(--text2)' }}>{tr(k.help)}</div>}
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{tr('ปลายทาง:')} {k.dest}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{tr('ต้นทางที่ส่ง:')} {users.length ? users.map(s => s.name).join(', ') : '—'}</div>
            </div>
          );
        })}
      </div>
      {custom.length > 0 && <SensorLatest kinds={custom} sources={sources} />}
      {modal && <KindModal mode={modal.mode} kind={modal.kind} onClose={() => setModal(null)} onSaved={() => { setModal(null); onChanged(); }} />}
    </div>
  );
}

/* 🌡️ ค่าล่าสุดของชนิดที่เพิ่มเอง — ยังไม่มีจอดูเฉพาะ (user เลือก "รับได้ทันที" 27/11) ⇒ ตารางค่าล่าสุด + สรุปวันนี้
   egress: ดึงแค่ 15 นาทีล่าสุด (≤1000 แถว) + สรุปวันนี้ · อ่านไม่ได้ = เขียนบอก ห้ามโชว์ว่างเหมือนไม่มีข้อมูล */
function SensorLatest({ kinds, sources }) {
  const [data, setData] = useState(null);           // null = ยังโหลด · { err } · { latest, daily }
  const req = useRef(0);
  const keysStr = kinds.map(k => k.key).join(',');
  const load = useCallback(async () => {
    const id = ++req.current;
    const keys = keysStr.split(',').filter(Boolean);
    const today = bkkDateStr(Date.now());   // วันตามปฏิทินไทย (ตรงกับ trigger สรุปรายวัน)
    const [r, d] = await Promise.all([
      supabaseDR.from('sensor_readings').select('source_id, kind_key, point, bucket_at, value')
        .in('kind_key', keys).gte('bucket_at', new Date(Date.now() - 15 * 60000).toISOString()).order('bucket_at', { ascending: false }).limit(1000),
      supabaseDR.from('sensor_daily').select('source_id, kind_key, point, n, v_sum, v_min, v_max').in('kind_key', keys).eq('day', today),
    ]);
    if (id !== req.current) return;
    if (r.error || d.error) { setData({ err: (r.error || d.error).message }); return; }
    setData({ latest: r.data || [], daily: d.data || [] });
  }, [keysStr]);
  usePolling(load, RATE.METER);
  const srcName = (sid) => sources.find(s => s.id === sid)?.name || '—';
  const rows = useMemo(() => {
    if (!data?.daily) return [];
    const last = new Map();
    for (const r of data.latest) { const k = `${r.source_id}|${r.kind_key}|${r.point}`; if (!last.has(k)) last.set(k, r); }
    const keys = new Set([...last.keys(), ...data.daily.map(x => `${x.source_id}|${x.kind_key}|${x.point}`)]);
    return [...keys].map(k => {
      const [sid, kind, point] = k.split('|');
      const dd = data.daily.find(x => `${x.source_id}|${x.kind_key}|${x.point}` === k);
      return { sid, kind, point, last: last.get(k) || null, day: dd || null };
    }).sort((a, b) => a.kind.localeCompare(b.kind) || a.point.localeCompare(b.point, 'th', { numeric: true }));
  }, [data]);
  const fmt = (v) => (v == null ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 }));
  const th = { textAlign: 'left', padding: '6px 8px', fontSize: 12, color: 'var(--muted)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' };
  const td = { padding: '6px 8px', fontSize: 12.5, borderBottom: '1px solid var(--border)' };
  return (
    <div style={{ ...card, minWidth: 0 }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>{tr('ค่าล่าสุดของชนิดที่เพิ่มเอง')}</div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>{tr('ค่าล่าสุดใน 15 นาที (ไม่มี = ขาดการส่ง) · ต่ำสุด/เฉลี่ย/สูงสุด = วันนี้ตั้งแต่ 00:00')}</div>
      {data == null ? <div style={{ color: 'var(--muted)' }}>{tr('กำลังโหลด…')}</div>
        : data.err ? <NoticeBar tone="bad">{tr('อ่านค่าเซนเซอร์ไม่ได้')}: {data.err}</NoticeBar>
        : !rows.length ? <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{tr('ยังไม่มีข้อมูลเข้า — ติ๊กชนิดนี้ที่ต้นทาง แล้วดาวน์โหลด flow ไปเติมค่าในโหนด function')}</div>
        : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
              <thead><tr><th style={th}>{tr('ชนิด')}</th><th style={th}>{tr('จุดวัด')}</th><th style={th}>{tr('ต้นทาง')}</th><th style={th}>{tr('ค่าล่าสุด')}</th><th style={th}>{tr('เวลา')}</th><th style={th}>{tr('ต่ำสุด / เฉลี่ย / สูงสุด วันนี้')}</th></tr></thead>
              <tbody>
                {rows.map(r => {
                  const k = kinds.find(x => x.key === r.kind);
                  return (
                    <tr key={`${r.sid}|${r.kind}|${r.point}`}>
                      <td style={td}>{k?.icon} {k?.label || r.kind}</td>
                      <td style={{ ...td, fontWeight: 700 }}>{r.point}</td>
                      <td style={td}>{srcName(r.sid)}</td>
                      <td style={{ ...td, fontWeight: 800 }}>{r.last ? `${fmt(r.last.value)} ${k?.unit || ''}` : <span style={{ color: 'var(--amber)' }}>{tr('ไม่มีค่าใน 15 นาที')}</span>}</td>
                      <td style={td}>{r.last ? fmtTime(r.last.bucket_at) : '—'}</td>
                      <td style={td}>{r.day?.n ? `${fmt(r.day.v_min)} / ${fmt(Number(r.day.v_sum) / r.day.n)} / ${fmt(r.day.v_max)} (${r.day.n} ${tr('นาที')})` : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
    </div>
  );
}

/* ── modal เพิ่ม/แก้ชนิดข้อมูล (ฟอร์ม · ไม่ปิดจาก backdrop) ── */
function KindModal({ mode, kind, onClose, onSaved }) {
  const isEdit = mode === 'edit';
  const builtin = isEdit && kind?.builtin;
  const [f, setF] = useState(() => ({
    key: kind?.key || '', label: kind?.label || '', icon: kind?.icon || '', unit: kind?.unit || '', help: kind?.help || '',
  }));
  const [busy, setBusy] = useState(false);
  const keyOk = /^[a-z][a-z0-9_]{1,39}$/.test(f.key);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const submit = async () => {
    setBusy(true);
    try {
      const base = { key: f.key, label: f.label.trim(), icon: f.icon.trim() || null, help: f.help.trim() || null };
      // ชนิดในตัวห้ามส่ง unit (edge ปฏิเสธ) — แก้ได้แค่ชื่อ/ไอคอน/คำอธิบาย
      await callAdmin(isEdit ? 'kind_update' : 'kind_create', builtin ? base : { ...base, unit: f.unit.trim() || null });
      toast.success(isEdit ? `${tr('บันทึกชนิดข้อมูลแล้ว')}: ${base.label}` : `${tr('เพิ่มชนิดข้อมูลแล้ว')}: ${base.label}`);
      onSaved();
    } catch (e) { toast.error(`${tr('บันทึกไม่สำเร็จ')}: ${e.message}`); }
    finally { setBusy(false); }
  };
  const lbl = { display: 'grid', gap: 4, fontSize: 13 };
  return (
    <div className="overlay">{/* ไม่ปิดจาก backdrop — ฟอร์ม (UI §5) */}
      <div className="modal" style={{ width: 'min(520px, 96vw)', display: 'grid', gap: 10 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <b style={{ fontSize: 17 }}>{isEdit ? `${tr('แก้ชนิดข้อมูล')} ${kind.key}` : tr('เพิ่มชนิดข้อมูล (เซนเซอร์)')}</b>
          <button type="button" className="tbtn" aria-label={tr('ปิด')} onClick={onClose}>✕</button>
        </div>
        {builtin && <NoticeBar tone="info">{tr('ชนิดในตัว — ESM มีปลายทางรับเฉพาะ แก้ได้แค่ชื่อ ไอคอน และคำอธิบาย (ลบไม่ได้)')}</NoticeBar>}
        <label style={lbl}>{tr('รหัส (ใช้ในไฟล์ flow · a-z 0-9 _ ขึ้นต้นด้วยตัวอักษร)')}
          <input value={f.key} disabled={isEdit} placeholder={tr('เช่น temp · vibration')} onChange={e => set('key', e.target.value.toLowerCase().trim())} />
          {!isEdit && f.key && !keyOk && <span style={{ color: 'var(--red)', fontSize: 12 }}>{tr('ใช้ได้แค่ a-z 0-9 _ ยาว 2-40 ตัว ขึ้นต้นด้วยตัวอักษร')}</span>}
          {isEdit && <span style={{ color: 'var(--muted)', fontSize: 12 }}>{tr('รหัสแก้ไม่ได้ — อยู่ในไฟล์ flow และข้อมูลที่เก็บแล้ว')}</span>}
        </label>
        <label style={lbl}>{tr('ชื่อที่แสดง')}
          <input value={f.label} maxLength={80} placeholder={tr('เช่น อุณหภูมิ')} onChange={e => set('label', e.target.value)} />
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: builtin ? '1fr' : '1fr 1fr', gap: 8 }}>
          <label style={lbl}>{tr('ไอคอน (emoji)')}
            <input value={f.icon} maxLength={8} placeholder="🌡️" onChange={e => set('icon', e.target.value)} />
          </label>
          {!builtin && (
            <label style={lbl}>{tr('หน่วย')}
              <input value={f.unit} maxLength={20} placeholder={tr('เช่น °C · mm/s')} onChange={e => set('unit', e.target.value)} />
            </label>
          )}
        </div>
        <label style={lbl}>{tr('คำอธิบาย')}
          <input value={f.help} maxLength={300} onChange={e => set('help', e.target.value)} />
        </label>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="pg-btn" onClick={onClose}>{tr('ยกเลิก')}</button>
          <button type="button" className="pg-btn primary" disabled={busy || (!isEdit && !keyOk) || !f.label.trim()} onClick={submit}>
            {busy ? tr('กำลังบันทึก…') : tr('บันทึก')}</button>
        </div>
      </div>
    </div>
  );
}

/* ช่องติ๊กชนิดข้อมูล — ใช้ทั้งตอนเพิ่มต้นทางและแก้ต้นทาง (ชนิด planned ติ๊กไม่ได้) */
function KindChecks({ kinds, value, onChange }) {
  const toggle = (k) => onChange(value.includes(k) ? value.filter(x => x !== k) : [...value, k]);
  return (
    <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
      {kinds.map(k => (
        <label key={k.key} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5, opacity: k.status === 'live' ? 1 : 0.6 }}>
          <input type="checkbox" checked={value.includes(k.key)} disabled={k.status !== 'live'} onChange={() => toggle(k.key)} />
          <span>{k.icon} {tr(k.label)}{k.unit ? ` (${k.unit})` : ''}{k.status !== 'live' && <span style={{ color: 'var(--amber)' }}> {tr('(ยังไม่มีปลายทางรับ)')}</span>}</span>
        </label>
      ))}
    </div>
  );
}

function Kpi({ label, value, unit, sub }) {
  return (
    <div style={{ ...card }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text2)' }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--text)' }}>{value} <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--muted)' }}>{unit}</span></div>
      <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{sub}</div>
    </div>
  );
}

/* ── เพิ่มต้นทาง (ฟอร์ม · ไม่ปิดจาก backdrop) ── */
function CreateModal({ kinds: kindDefs, onClose, onCreated }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [kinds, setKinds] = useState([]);
  const [busy, setBusy] = useState(false);
  const codeOk = /^[a-z0-9][a-z0-9_-]{1,39}$/.test(code);
  const submit = async () => {
    setBusy(true);
    try {
      const r = await callAdmin('create', { code, name, note, kinds });
      onCreated(r.source, r.key);
    } catch (e) { toast.error(`${tr("เพิ่มต้นทางไม่สำเร็จ")}: ${e.message}`); }
    finally { setBusy(false); }
  };
  return (
    <div className="overlay">{/* ไม่ปิดจาก backdrop — ฟอร์ม (UI §5) */}
      <div className="modal" style={{ width: 'min(560px, 96vw)', display: 'grid', gap: 10 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <b style={{ fontSize: 17 }}>{tr('เพิ่มการเชื่อมต่อ')}</b>
          <button type="button" className="tbtn" aria-label={tr('ปิด')} onClick={onClose}>✕</button>
        </div>
        <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>{tr('รหัสต้นทาง (a-z 0-9 - _ · ใช้เป็นคำนำหน้า topic)')}
          <input value={code} onChange={e => setCode(e.target.value.toLowerCase().trim())} placeholder={tr('เช่น pd2-oee')} />
          {code && !codeOk && <span style={{ color: 'var(--red)', fontSize: 12 }}>{tr('ใช้ได้แค่ a-z 0-9 - _ ยาว 2-40 ตัว')}</span>}
        </label>
        <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>{tr('ชื่อที่แสดง')}
          <input value={name} onChange={e => setName(e.target.value)} placeholder={tr('เช่น Node-RED PD2 · OEE')} />
        </label>
        <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>{tr('หมายเหตุ (ที่อยู่เครื่อง / ฐานข้อมูลต้นทาง / ผู้ดูแล)')}
          <input value={note} onChange={e => setNote(e.target.value)} />
        </label>
        <div style={{ fontSize: 13 }}>{tr('ชนิดข้อมูลที่ต้นทางนี้ส่ง')}</div>
        <KindChecks kinds={kindDefs} value={kinds} onChange={setKinds} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="pg-btn" onClick={onClose}>{tr('ยกเลิก')}</button>
          <button type="button" className="pg-btn primary" disabled={busy || !codeOk || !name.trim() || !kinds.length} onClick={submit}>
            {busy ? tr('กำลังสร้าง…') : tr('สร้าง + ออกรหัสลับ')}</button>
        </div>
      </div>
    </div>
  );
}

/* ── รหัสลับ (แสดงครั้งเดียว · ปิดได้จากปุ่มเท่านั้น กันเผลอแตะแล้วรหัสหาย) ── */
function KeyModal({ info, onClose }) {
  const copy = async () => {
    try { await navigator.clipboard.writeText(info.key); toast.success('คัดลอกรหัสแล้ว'); }
    catch { toast.error('คัดลอกไม่ได้ — เลือกข้อความแล้วคัดลอกเอง'); }
  };
  return (
    <div className="overlay">{/* ไม่ปิดจาก backdrop — รหัสแสดงครั้งเดียว */}
      <div className="modal" style={{ width: 'min(560px, 96vw)', display: 'grid', gap: 10 }} onClick={e => e.stopPropagation()}>
        <b style={{ fontSize: 17 }}>{tr('🔑 รหัสลับของต้นทาง')} {info.code}</b>
        <NoticeBar tone="warn">{tr('แสดง')}<b>{tr('ครั้งเดียว')}</b> — ESM {tr("เก็บไว้แค่ค่าที่ย้อนกลับไม่ได้ ปิดหน้าต่างนี้แล้วดูอีกไม่ได้ (ลืม = ออกรหัสใหม่")})</NoticeBar>
        <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 14, background: 'var(--bg2-surf)', border: '1px solid var(--border)', borderRadius: 8, padding: 10, overflowWrap: 'anywhere', userSelect: 'all' }}>
          {info.key}
        </div>
        <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, display: 'grid', gap: 4, color: 'var(--text2)' }}>
          <li>{tr('Node-RED › เมนู ☰ › Settings › Environment (หรือไฟล์ settings.js) เพิ่มตัวแปร')} <code>ESM_SOURCE_KEY</code> = {tr("รหัสนี้")}</li>
          <li>{tr('ดาวน์โหลด flow จากหน้าต้นทาง แล้ว Import · เลือก DB ในโหนด mysql')}</li>
          <li>{tr('Deploy แล้วดูแถบสุขภาพการส่ง — ภายใน 1 นาทีควรเป็นสีเขียว')}</li>
        </ol>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="pg-btn" onClick={copy}>{tr('📋 คัดลอกรหัส')}</button>
          <button type="button" className="pg-btn primary" onClick={onClose}>{tr('จดไว้แล้ว ปิด')}</button>
        </div>
      </div>
    </div>
  );
}
