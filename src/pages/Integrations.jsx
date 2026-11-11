/* 🔌 ศูนย์เชื่อมต่อ Node-RED / เครื่องจักร — /integrations (หมวด ตั้งค่าโปรแกรม,ฐานข้อมูล · 2026-11-11 · คำสั่ง user)
   📄 docs/modules/integration-hub.md · รูปตัวอย่าง (artifact) ที่ user OK แล้ว 11/11

   แท็บ `?tab=sources|kinds` · หน้าต้นทาง `?src=<code>` (คนละ param กับ tab · UI §6.8 ข้อ 2.4)
   🔴 ทะเบียนชนิดข้อมูล = src/utils/integrationKinds.js · ตัว gen flow = src/utils/nodeRedFlow.js — ห้ามประกอบเองในหน้า
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
import { toast } from '../components/Toast';
import { supabase, supabaseDR, DR_BASE_URL } from '../supabaseClient';
import useTabParam from '../utils/useTabParam';
import { usePolling } from '../utils/usePolling';
import { RATE } from '../utils/refreshRates';
import { can } from '../utils/permissions';
import { loadLinesRes } from '../utils/useProductionLines';
import { energyPointOptions, energyZonesFrom } from '../utils/energy';
import { INTEGRATION_KINDS, kindOf, kindLabel, sourceStatus, healthBars, SOURCE_STALE_MIN } from '../utils/integrationKinds';
import { buildNodeRedFlow, envVarName } from '../utils/nodeRedFlow';

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
const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');

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
  const [tab, setTab] = useTabParam(['sources', 'kinds'], 'sources');
  const [params, setParams] = useSearchParams();
  const srcCode = params.get('src') || '';
  const [sources, setSources] = useState(null);       // null = ยังไม่โหลด/อ่านไม่ได้
  const [hourly, setHourly] = useState([]);
  const [err, setErr] = useState('');
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [creating, setCreating] = useState(false);
  const [shownKey, setShownKey] = useState(null);     // { code, key } — โชว์ครั้งเดียว
  const reqId = useRef(0);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    const since = new Date(Date.now() - 25 * 3600000).toISOString();
    const [s, h] = await Promise.all([
      supabaseDR.from('integration_sources').select(COLS).order('created_at'),
      supabaseDR.from('integration_hourly').select('source_id, hour_at, ok_count, fail_count, saved_rows').gte('hour_at', since),
    ]);
    if (id !== reqId.current) return;
    const e = s.error || h.error;
    if (e) {
      const missing = e.code === '42P01' || e.code === 'PGRST205';
      setErr(missing ? 'ยังไม่ได้ apply migration 20261111_integration_hub_dr (DR) — แจ้ง admin' : `โหลดทะเบียนต้นทางไม่สำเร็จ: ${e.message}`);
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

  const current = srcCode && sources ? sources.find(x => x.code === srcCode) : null;
  const hourlyOf = useCallback((sid) => hourly.filter(r => r.source_id === sid), [hourly]);

  const header = (
    <PageHeader icon="🔌" title="การเชื่อมต่อ Node-RED / เครื่องจักร"
      sub="ที่เดียวสำหรับทุกระบบที่ส่งข้อมูลเข้า ESM · ต้นทางส่งข้อเท็จจริง สูตรและการตัดสินอยู่ที่ ESM"
      tabs={[{ key: 'sources', label: 'แหล่งต้นทาง' }, { key: 'kinds', label: 'ชนิดข้อมูล' }]}
      tab={tab} onTab={(k) => { openSrc(null); setTab(k); }}
      actions={canManage && !srcCode && tab === 'sources'
        ? <button type="button" className="pg-btn primary" onClick={() => setCreating(true)}>+ เพิ่มการเชื่อมต่อ</button> : null} />
  );

  return (
    <Page>
      {header}
      {err && <NoticeBar tone="bad">{err}{sources ? ' — ตัวเลขบนจอเป็นของรอบก่อนหน้า' : ''}</NoticeBar>}
      {!sources && !err && <div style={{ color: 'var(--muted)', padding: 20 }}>กำลังโหลด…</div>}

      {sources && tab === 'kinds' && <KindsTab sources={sources} />}

      {sources && tab === 'sources' && (srcCode ? (
        current
          ? <SourceDetail src={current} hours={hourlyOf(current.id)} nowMs={nowMs} canManage={canManage} canMap={canMap}
              onBack={() => openSrc(null)} onChanged={load} onKey={setShownKey} />
          : (
            <div style={{ display: 'grid', gap: 10 }}>
              <NoticeBar tone="warn">ไม่พบต้นทางรหัส <b>{srcCode}</b> ในทะเบียน</NoticeBar>
              <div><button type="button" className="pg-btn" onClick={() => openSrc(null)}>← การเชื่อมต่อทั้งหมด</button></div>
            </div>
          )
      ) : (
        <SourceList sources={sources} hourly={hourly} nowMs={nowMs} onOpen={openSrc} canManage={canManage} />
      ))}

      {creating && <CreateModal onClose={() => setCreating(false)}
        onCreated={(src, key) => { setCreating(false); setShownKey({ code: src.code, key, legacy: false }); load(); openSrc(src.code); }} />}
      {shownKey && <KeyModal info={shownKey} onClose={() => setShownKey(null)} />}
    </Page>
  );
}

/* ── ① รายการต้นทาง ── */
function SourceList({ sources, hourly, nowMs, onOpen, canManage }) {
  const st = sources.map(s => sourceStatus(s, nowMs));
  const okToday = hourly.reduce((a, r) => a + (Number(r.ok_count) || 0), 0);
  const kindsUsed = new Set(sources.flatMap(s => s.kinds || []));
  return (
    <div style={{ display: 'grid', gap: 14, alignContent: 'start' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, alignContent: 'start' }}>
        <Kpi label="แหล่งต้นทาง" value={sources.length} unit="ระบบ"
          sub={`ออนไลน์ ${st.filter(x => x === 'online').length} · ขาด ${st.filter(x => x === 'stale').length} · ยังไม่เคยได้รับ ${st.filter(x => x === 'never').length} · พัก ${st.filter(x => x === 'paused').length}`} />
        <Kpi label="ชนิดข้อมูลที่ใช้อยู่" value={kindsUsed.size} unit={`/ ${INTEGRATION_KINDS.length} ชนิด`}
          sub={`ESM รับได้แล้ว ${INTEGRATION_KINDS.filter(k => k.status === 'live').length} ชนิด`} />
        <Kpi label="รับสำเร็จ 24 ชม." value={okToday.toLocaleString()} unit="ครั้ง" sub="นับทุกต้นทางรวมกัน" />
      </div>
      {!sources.length ? (
        <div style={{ ...card, color: 'var(--muted)' }}>ยังไม่มีต้นทางในทะเบียน{canManage ? ' — กด "+ เพิ่มการเชื่อมต่อ"' : ''}</div>
      ) : sources.map((s, i) => {
        const m = STATUS[st[i]];
        return (
          <div key={s.id} role="button" tabIndex={0} onClick={() => onOpen(s.code)} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(s.code); }}
            style={{ ...card, display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center', cursor: 'pointer', borderColor: st[i] === 'online' || st[i] === 'never' ? 'var(--border)' : m.color }}>
            <div style={{ flex: '999 1 320px', minWidth: 0, display: 'grid', gap: 6 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                <span style={{ fontSize: 17, fontWeight: 800, color: 'var(--text)' }}>{s.name}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: m.color, border: `1px solid ${m.color}`, borderRadius: 999, padding: '1px 10px' }}>● {m.label}</span>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>{s.code}{s.note ? ` · ${s.note}` : ''}</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {(s.kinds || []).map(k => <span key={k} style={chip}>{kindLabel(k)}</span>)}
              </div>
            </div>
            <div style={{ flex: '1 1 180px', fontSize: 12.5, display: 'grid', gap: 2 }}>
              <span style={{ color: 'var(--muted)' }}>รับสำเร็จล่าสุด</span>
              <b style={{ color: 'var(--text)' }}>{fmtTime(s.last_ok_at)}</b>
              {s.last_error && <span style={{ color: 'var(--red)' }}>ล้มล่าสุด: {s.last_error}</span>}
            </div>
            <span style={{ fontWeight: 700, color: 'var(--text2)' }}>เปิดดู →</span>
          </div>
        );
      })}
    </div>
  );
}

/* ── ② หน้าต้นทาง ── */
function SourceDetail({ src, hours, nowMs, canManage, canMap, onBack, onChanged, onKey }) {
  const [busy, setBusy] = useState('');
  const [points, setPoints] = useState(null);
  const hasEnergy = (src.kinds || []).includes('energy_readings');
  const hasMachine = (src.kinds || []).some(k => k === 'machine_state' || k === 'piece_count');
  const st = sourceStatus(src, nowMs);
  const m = STATUS[st];
  const bars = useMemo(() => healthBars(hours, nowMs), [hours, nowMs]);
  const okSum = bars.reduce((a, b) => a + b.ok, 0), failSum = bars.reduce((a, b) => a + b.fail, 0);
  const flow = useMemo(() => buildNodeRedFlow({ source: src, kinds: src.kinds || [], ingestUrl: INGEST_URL }), [src]);

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
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(action);
    try {
      const r = await callAdmin(action, { id: src.id });
      if (r.key) onKey({ code: src.code, key: r.key });
      toast.success(label);
      onChanged();
    } catch (e) { toast.error(`${label}ไม่สำเร็จ: ${e.message}`); }
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
        <button type="button" className="pg-btn" onClick={onBack}>← การเชื่อมต่อทั้งหมด</button>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)' }}>{src.name}
            <span style={{ marginLeft: 10, fontSize: 12, fontWeight: 700, color: m.color, border: `1px solid ${m.color}`, borderRadius: 999, padding: '1px 10px', verticalAlign: 'middle' }}>● {m.label}</span>
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{src.code}{src.note ? ` · ${src.note}` : ''} · ไม่มีค่าใหม่เกิน {SOURCE_STALE_MIN} นาที = ขาดการติดต่อ</div>
        </div>
      </div>

      <div style={{ ...card, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <button type="button" className="pg-btn primary" onClick={download} disabled={!flow.nodes.length}>⬇ ดาวน์โหลด flow</button>
        <button type="button" className="pg-btn" onClick={copyFlow} disabled={!flow.nodes.length}>📋 คัดลอก flow</button>
        {canManage && <>
          <button type="button" className="pg-btn" disabled={!!busy}
            onClick={() => act('rotate', 'ออกรหัสใหม่', src.key_hint
              ? 'ออกรหัสใหม่แล้ว รหัสเดิมจะใช้ไม่ได้ทันที — Node-RED ที่ใช้รหัสเดิมจะส่งไม่เข้าจนกว่าจะเปลี่ยน ยืนยัน?'
              : 'ออกรหัสของต้นทางนี้ (secret กลางเดิมยังใช้ได้จนกว่าจะกด "เลิกใช้รหัสกลาง") ยืนยัน?')}>
            🔑 {src.key_hint ? 'เปลี่ยนรหัสลับ' : 'ออกรหัสของต้นทางนี้'}</button>
          {src.legacy_secret && src.key_hint && (
            <button type="button" className="pg-btn" disabled={!!busy}
              onClick={() => act('legacy_off', 'เลิกใช้รหัสกลาง', 'ยืนยันว่า Node-RED เปลี่ยนไปใช้ ESM_SOURCE_KEY แล้ว? หลังกด รหัสกลางเดิมจะส่งเข้าต้นทางนี้ไม่ได้')}>
              เลิกใช้รหัสกลาง</button>
          )}
          <button type="button" className="pg-btn" disabled={!!busy} style={{ color: src.is_paused ? 'var(--green)' : 'var(--red)' }}
            onClick={() => act(src.is_paused ? 'resume' : 'pause', src.is_paused ? 'เปิดรับต่อ' : 'พักการรับ',
              src.is_paused ? null : 'พักการรับ = ข้อมูลจากต้นทางนี้จะไม่ถูกบันทึกจนกว่าจะเปิดรับต่อ ยืนยัน?')}>
            {src.is_paused ? '▶ เปิดรับต่อ' : '⏸ พักการรับ'}</button>
        </>}
        <span style={{ fontSize: 12, color: noAuth ? 'var(--red)' : 'var(--muted)' }}>
          {noAuth ? '⚠ ยังไม่ได้ออกรหัส — ต้นทางนี้ส่งข้อมูลเข้าไม่ได้จนกว่าจะออกรหัส'
            : <>ยืนยันตัวตนด้วย: {usesLegacy ? 'รหัสกลาง (INGEST_SECRET)' : `รหัสของต้นทาง …${src.key_hint}`}{src.legacy_secret && src.key_hint ? ' · ยังรับรหัสกลางอยู่' : ''}</>}
        </span>
      </div>

      {flow.skipped.length > 0 && (
        <NoticeBar tone="warn">ไฟล์ flow ไม่มีส่วนของ: {flow.skipped.map(s => `${kindLabel(s.key)} (${s.reason})`).join(' · ')}</NoticeBar>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12, alignContent: 'start' }}>
        <div style={{ ...card, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>สุขภาพการส่ง · 24 ชม.</div>
          <div style={{ display: 'flex', gap: 2, height: 40, alignItems: 'flex-end', marginTop: 10 }} role="img"
            aria-label={`24 ชั่วโมงล่าสุด รับสำเร็จ ${okSum} ครั้ง ล้ม ${failSum} ครั้ง`}>
            {bars.map(b => (
              <div key={b.hourMs} title={`${new Date(b.hourMs).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' })} · สำเร็จ ${b.ok}/${b.expect}${b.fail ? ` · ล้ม ${b.fail}` : ''}`}
                style={{ flex: 1, height: `${Math.max(6, b.ratio * 100)}%`, borderRadius: 2,
                  background: b.fail ? 'var(--red)' : b.ratio >= 0.95 ? 'var(--green)' : b.ok ? 'var(--amber)' : 'var(--border)' }} />
            ))}
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
            1 แท่ง = 1 ชั่วโมง · เต็ม = ได้ครบทุกนาที · ส้ม = ขาดบางนาที · แดง = มีครั้งที่ล้ม · เทา = ไม่ได้รับเลย
          </div>
          <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 8 }}>
            สำเร็จ <b>{okSum.toLocaleString()}</b> · ล้ม <b style={{ color: failSum ? 'var(--red)' : 'inherit' }}>{failSum}</b> ครั้ง · รับสำเร็จล่าสุด {fmtTime(src.last_ok_at)}
          </div>
          {src.last_error && <div style={{ fontSize: 12.5, color: 'var(--red)', marginTop: 4 }}>ล้มล่าสุด: {src.last_error}</div>}
          {src.last_result && (
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6, fontFamily: 'ui-monospace, monospace', overflowWrap: 'anywhere' }}>
              คำตอบล่าสุด: {JSON.stringify(src.last_result)}
            </div>
          )}
        </div>

        <div style={{ ...card, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>ชนิดข้อมูลของต้นทางนี้</div>
          <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
            {!(src.kinds || []).length && <div style={{ fontSize: 12.5, color: 'var(--amber)' }}>ยังไม่ได้กำหนดชนิดข้อมูล — ไฟล์ flow จะว่าง</div>}
            {(src.kinds || []).map(k => {
              const d = kindOf(k);
              return (
                <div key={k} style={{ background: 'var(--bg2)', borderRadius: 8, padding: '8px 10px', fontSize: 12.5 }}>
                  <b style={{ color: 'var(--text)' }}>{kindLabel(k)}</b>
                  {d && <span style={{ color: 'var(--muted)' }}> → {d.dest}</span>}
                  {d?.status !== 'live' && <span style={{ color: 'var(--amber)' }}> · ESM ยังไม่มีปลายทางรับ</span>}
                  {d?.help && <div style={{ color: 'var(--muted)' }}>{d.help}</div>}
                  {d?.home && <Link to={d.home} style={{ fontSize: 12 }}>ดูบนจอ →</Link>}
                </div>
              );
            })}
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>
            ไฟล์ flow ตั้ง env ของ Node-RED ชื่อ <code>{envVarName(src)}</code>
            {hasEnergy && ' · แม่แบบค่าไฟ = schema TSS Smart Energy'}{hasMachine && ' · แม่แบบเครื่องจักร = Node-RED OEE PD2 (oee_stop / oee_piece)'}
          </div>
        </div>
      </div>

      {hasMachine && <MachineFactsPanel src={src} canManage={canManage} callAdmin={callAdmin} />}

      {hasEnergy && (
        <div style={{ ...card, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', marginBottom: 6 }}>จับคู่ topic ค่าไฟ ↔ จุดในระบบ</div>
          {points === 'error'
            ? <NoticeBar tone="bad">อ่านทะเบียนไลน์/โซนไม่สำเร็จ — ยังผูก topic ไม่ได้ ลองโหลดหน้าใหม่</NoticeBar>
            : points == null
              ? <div style={{ color: 'var(--muted)' }}>กำลังโหลดจุด…</div>
              : <EnergyMqttTopics points={points} canEdit={canMap} />}
        </div>
      )}
    </div>
  );
}

/* ── แท็บชนิดข้อมูล ── */
function KindsTab({ sources }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 10, alignContent: 'start' }}>
      {INTEGRATION_KINDS.map(k => {
        const users = sources.filter(s => (s.kinds || []).includes(k.key));
        return (
          <div key={k.key} style={{ ...card, display: 'grid', gap: 4, alignContent: 'start' }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>{k.icon} {k.label}</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: k.status === 'live' ? 'var(--green)' : 'var(--amber)' }}>
              {k.status === 'live' ? '● ESM รับได้แล้ว' : '○ ออกแบบไว้ — ยังไม่มีปลายทางรับ'}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text2)' }}>{k.help}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>ปลายทาง: {k.dest}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>ต้นทางที่ส่ง: {users.length ? users.map(s => s.name).join(', ') : '—'}</div>
          </div>
        );
      })}
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
function CreateModal({ onClose, onCreated }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [kinds, setKinds] = useState([]);
  const [busy, setBusy] = useState(false);
  const toggle = (k) => setKinds(ks => (ks.includes(k) ? ks.filter(x => x !== k) : [...ks, k]));
  const codeOk = /^[a-z0-9][a-z0-9_-]{1,39}$/.test(code);
  const submit = async () => {
    setBusy(true);
    try {
      const r = await callAdmin('create', { code, name, note, kinds });
      onCreated(r.source, r.key);
    } catch (e) { toast.error(`เพิ่มต้นทางไม่สำเร็จ: ${e.message}`); }
    finally { setBusy(false); }
  };
  return (
    <div className="overlay">{/* ไม่ปิดจาก backdrop — ฟอร์ม (UI §5) */}
      <div className="modal" style={{ width: 'min(560px, 96vw)', display: 'grid', gap: 10 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <b style={{ fontSize: 17 }}>เพิ่มการเชื่อมต่อ</b>
          <button type="button" className="tbtn" aria-label="ปิด" onClick={onClose}>✕</button>
        </div>
        <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>รหัสต้นทาง (a-z 0-9 - _ · ใช้เป็นคำนำหน้า topic)
          <input value={code} onChange={e => setCode(e.target.value.toLowerCase().trim())} placeholder="เช่น pd2-oee" />
          {code && !codeOk && <span style={{ color: 'var(--red)', fontSize: 12 }}>ใช้ได้แค่ a-z 0-9 - _ ยาว 2-40 ตัว</span>}
        </label>
        <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>ชื่อที่แสดง
          <input value={name} onChange={e => setName(e.target.value)} placeholder="เช่น Node-RED PD2 · OEE" />
        </label>
        <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>หมายเหตุ (ที่อยู่เครื่อง / ฐานข้อมูลต้นทาง / ผู้ดูแล)
          <input value={note} onChange={e => setNote(e.target.value)} />
        </label>
        <div style={{ fontSize: 13 }}>ชนิดข้อมูลที่ต้นทางนี้ส่ง</div>
        <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {INTEGRATION_KINDS.map(k => (
            <label key={k.key} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5, opacity: k.status === 'live' ? 1 : 0.6 }}>
              <input type="checkbox" checked={kinds.includes(k.key)} disabled={k.status !== 'live'} onChange={() => toggle(k.key)} />
              <span>{k.icon} {k.label}{k.status !== 'live' && <span style={{ color: 'var(--amber)' }}> (ยังไม่มีปลายทางรับ)</span>}</span>
            </label>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="pg-btn" onClick={onClose}>ยกเลิก</button>
          <button type="button" className="pg-btn primary" disabled={busy || !codeOk || !name.trim() || !kinds.length} onClick={submit}>
            {busy ? 'กำลังสร้าง…' : 'สร้าง + ออกรหัสลับ'}</button>
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
        <b style={{ fontSize: 17 }}>🔑 รหัสลับของต้นทาง {info.code}</b>
        <NoticeBar tone="warn">แสดง<b>ครั้งเดียว</b> — ESM เก็บไว้แค่ค่าที่ย้อนกลับไม่ได้ ปิดหน้าต่างนี้แล้วดูอีกไม่ได้ (ลืม = ออกรหัสใหม่)</NoticeBar>
        <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 14, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: 10, overflowWrap: 'anywhere', userSelect: 'all' }}>
          {info.key}
        </div>
        <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, display: 'grid', gap: 4, color: 'var(--text2)' }}>
          <li>Node-RED › เมนู ☰ › Settings › Environment (หรือไฟล์ settings.js) เพิ่มตัวแปร <code>ESM_SOURCE_KEY</code> = รหัสนี้</li>
          <li>ดาวน์โหลด flow จากหน้าต้นทาง แล้ว Import · เลือก DB ในโหนด mysql</li>
          <li>Deploy แล้วดูแถบสุขภาพการส่ง — ภายใน 1 นาทีควรเป็นสีเขียว</li>
        </ol>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="pg-btn" onClick={copy}>📋 คัดลอกรหัส</button>
          <button type="button" className="pg-btn primary" onClick={onClose}>จดไว้แล้ว ปิด</button>
        </div>
      </div>
    </div>
  );
}
