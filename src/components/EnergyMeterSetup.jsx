/* ⚙️ ตั้งค่าตู้บนบอร์ดค่าไฟสด — แท็บ "ตั้งค่าตู้" ของ /energy (`?tab=meters` · 2026-11-23 คำสั่ง user
   "ทำหน้าตั้งค่าตู้ในแท็บพลังงาน ให้ขึ้นชื่อ MDB-06")
   ทะเบียน = energy_live_meters (DR) · client อ่านอย่างเดียว ⇒ เขียนผ่าน edge `energy-meter-admin`
   (ตรวจล็อกอิน Main + has_perm('energy:record') ฝั่ง server — ปุ่มบนจอใช้คีย์เดียวกัน)
   🔴 มิเตอร์ (scope_name) = คีย์ข้อมูล/ประวัติ แก้ไม่ได้ — ชื่อบนจอแก้ที่ "ชื่อที่โชว์" (display_name)
   🔴 ตู้ที่มีตู้ลูกชี้มาอยู่ ลบไม่ได้ (edge ตรวจซ้ำ) · ตั้งแม่วน/ชี้ตัวเอง = edge ปฏิเสธ
   📄 docs/ENERGY_MONITORING_DESIGN.md */
import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { UserContext } from '../App';
import { supabase, supabaseDR } from '../supabaseClient';
import { toast } from './Toast';
import NoticeBar from './NoticeBar';
import { can } from '../utils/permissions';
import { askConfirm } from '../utils/askConfirm';
import { tr } from '../utils/i18n';

const COLS = 'scope_kind, scope_name, display_name, panel, parent_name, subtitle, limit_kw, limit_a, gauge_max_kw, idle_kw, sort_order, is_active, updated_at, updated_by';
const FIELDS = ['display_name', 'panel', 'parent_name', 'subtitle', 'limit_kw', 'limit_a', 'gauge_max_kw', 'idle_kw', 'sort_order', 'is_active'];
const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 14, boxShadow: 'var(--shadow-sm)' };
const th = { textAlign: 'left', padding: '6px 8px', fontSize: 12, color: 'var(--muted)', fontWeight: 700, whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)' };
const td = { padding: '5px 6px', borderBottom: '1px solid var(--border)', verticalAlign: 'middle' };
const inp = { width: '100%', minWidth: 0, fontSize: 13 };
const addLbl = { display: 'grid', gap: 3, fontSize: 12, color: 'var(--muted)', flex: '1 1 180px', minWidth: 0 };
const keyOf = (r) => `${r.scope_kind}|${r.scope_name}`;
const toDraft = (r) => Object.fromEntries(FIELDS.map(f => [f, r[f] == null ? (f === 'is_active' ? true : '') : r[f]]));
/** 'HH:MM:SS' (time ของ DB) → 'HH:MM' · ว่าง = '' */
const hm5 = (v) => (v ? String(v).slice(0, 5) : '');
const same = (a, b) => FIELDS.every(f => String(a[f] ?? '') === String(b[f] ?? ''));

async function callAdmin(action, payload) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('ต้องล็อกอินก่อน');
  const { data, error } = await supabaseDR.functions.invoke('energy-meter-admin', {
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

export default function EnergyMeterSetup() {
  const { role } = useContext(UserContext);
  const canEdit = can('energy', 'record', role);
  const [rows, setRows] = useState(null);          // null = ยังโหลด/อ่านไม่ได้ (ดู err)
  const [scopes, setScopes] = useState([]);        // มิเตอร์ที่ผูก topic แล้ว (ตัวเลือก "เพิ่มตู้")
  const [err, setErr] = useState('');
  const [drafts, setDrafts] = useState({});
  const [busy, setBusy] = useState('');
  const [panelCfg, setPanelCfg] = useState(undefined);   // undefined = ยังโหลด · null = อ่านไม่ได้
  const [targetDraft, setTargetDraft] = useState({});
  const [baseDraft, setBaseDraft] = useState({});     // { [panel]: { s:'HH:MM', e:'HH:MM' } } ช่วง Baseline (26/11)
  const [add, setAdd] = useState({ scope: '', panel: '', parent_name: '', display_name: '' });

  const load = useCallback(async () => {
    const [m, t, ps] = await Promise.all([
      supabaseDR.from('energy_live_meters').select(COLS).order('panel').order('sort_order').order('scope_name'),
      supabaseDR.from('energy_meter_topics').select('scope_kind, scope_name').limit(1000),
      supabaseDR.from('energy_panel_settings').select('panel, demand_target_kw, baseline_start, baseline_end, updated_by'),
    ]);
    // 🎯 เป้า Demand ต่อตู้ — อ่านไม่ได้ = null (ช่องเป้าล็อก + เขียนบอก · ห้ามโชว์ว่างเหมือนไม่ได้ตั้ง)
    const pmap = ps.error ? null : Object.fromEntries((ps.data || []).map(x => [x.panel, x]));
    setPanelCfg(pmap);
    setTargetDraft(pmap ? Object.fromEntries(Object.entries(pmap).map(([k, v]) => [k, v.demand_target_kw ?? ''])) : {});
    setBaseDraft(pmap ? Object.fromEntries(Object.entries(pmap).map(([k, v]) => [k, { s: hm5(v.baseline_start), e: hm5(v.baseline_end) }])) : {});
    if (m.error) { setErr(m.error.message); setRows(null); return; }
    setErr(t.error ? `อ่านรายชื่อมิเตอร์ที่ผูก topic ไม่ได้: ${t.error.message}`
      : (t.data || []).length >= 1000 ? 'รายชื่อ topic เกิน 1,000 แถว — ตัวเลือก "เพิ่มตู้" อาจไม่ครบ' : '');
    setRows(m.data || []);
    setDrafts(Object.fromEntries((m.data || []).map(r => [keyOf(r), toDraft(r)])));
    const seen = new Map();
    for (const x of t.data || []) if (x.scope_name) seen.set(keyOf(x), x);
    setScopes([...seen.values()]);
  }, []);
  useEffect(() => {
    let alive = true;
    load().catch(e => { if (alive) setErr(e.message); });
    return () => { alive = false; };
  }, [load]);

  const byKey = useMemo(() => new Map((rows || []).map(r => [keyOf(r), r])), [rows]);
  const panels = useMemo(() => [...new Set((rows || []).map(r => r.panel).filter(Boolean))].sort(), [rows]);
  const freeScopes = useMemo(() => scopes.filter(s => !byKey.has(keyOf(s))).sort((a, b) => a.scope_name.localeCompare(b.scope_name)), [scopes, byKey]);
  const labelOf = (r) => (r.display_name && String(r.display_name).trim()) || r.scope_name;
  const kidsOf = (r) => (rows || []).filter(x => x.scope_kind === r.scope_kind && x.parent_name === r.scope_name);

  const setD = (k, f, v) => setDrafts(d => ({ ...d, [k]: { ...d[k], [f]: v } }));

  const save = async (r) => {
    const k = keyOf(r);
    setBusy(k);
    try {
      await callAdmin('save', { scope_kind: r.scope_kind, scope_name: r.scope_name, ...drafts[k] });
      toast.success(`${tr('บันทึกตู้')} ${drafts[k].display_name || r.scope_name}`);
      await load();
    } catch (e) { toast.error(`${tr('บันทึกไม่สำเร็จ')}: ${e.message}`); } finally { setBusy(''); }
  };
  const remove = async (r) => {
    if (!await askConfirm(`เอาตู้ "${labelOf(r)}" (มิเตอร์ ${r.scope_name}) ออกจากบอร์ดค่าไฟสด?\nข้อมูล/ประวัติของมิเตอร์ไม่หาย — เพิ่มกลับได้ภายหลัง`)) return;
    setBusy(keyOf(r));
    try {
      await callAdmin('remove', { scope_kind: r.scope_kind, scope_name: r.scope_name });
      toast.success(`${tr('เอาออกจากบอร์ดแล้ว')}: ${labelOf(r)}`);
      await load();
    } catch (e) { toast.error(`${tr('ลบไม่สำเร็จ')}: ${e.message}`); } finally { setBusy(''); }
  };
  const saveTarget = async (panel) => {
    setBusy(`t|${panel}`);
    try {
      const b = baseDraft[panel] || {};
      await callAdmin('panel_target', { panel, demand_target_kw: targetDraft[panel] ?? '', baseline_start: b.s || null, baseline_end: b.e || null });
      toast.success(`${tr('บันทึกเป้า Demand ตู้')} ${panel}`);
      await load();
    } catch (e) { toast.error(`${tr('บันทึกไม่สำเร็จ')}: ${e.message}`); } finally { setBusy(''); }
  };
  const create = async () => {
    const s = freeScopes.find(x => keyOf(x) === add.scope);
    if (!s) { toast.error(tr('เลือกมิเตอร์ก่อน')); return; }
    if (!add.panel.trim()) { toast.error(tr('ต้องระบุตู้')); return; }
    setBusy('add');
    try {
      await callAdmin('save', { create: true, scope_kind: s.scope_kind, scope_name: s.scope_name, panel: add.panel, parent_name: add.parent_name || null, display_name: add.display_name || null, sort_order: (rows || []).length });
      toast.success(`${tr('เพิ่มตู้')} ${add.display_name || s.scope_name}`);
      setAdd({ scope: '', panel: add.panel, parent_name: '', display_name: '' });
      await load();
    } catch (e) { toast.error(`${tr('เพิ่มไม่สำเร็จ')}: ${e.message}`); } finally { setBusy(''); }
  };

  if (err && rows == null) return <NoticeBar tone="bad">{tr('อ่านทะเบียนตู้ไม่ได้')}: {err}</NoticeBar>;
  if (rows == null) return <div style={{ color: 'var(--muted)', padding: 20 }}>{tr('กำลังโหลด…')}</div>;

  const parentOpts = (r) => (rows || []).filter(x => x.scope_kind === (r?.scope_kind || 'zone') && x.scope_name !== r?.scope_name);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 14, alignContent: 'start' }}>
      {err && <NoticeBar tone="warn">{err}</NoticeBar>}
      {!canEdit && <NoticeBar tone="info">{tr('ดูได้อย่างเดียว — การแก้ต้องมีสิทธิ์บันทึกพลังงาน (energy:record)')}</NoticeBar>}

      <div style={card}>
        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>{tr('ตู้บนบอร์ดค่าไฟสด')} ({rows.length})</div>
        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 8 }}>
          {tr('มิเตอร์ = ชื่อที่ข้อมูลเข้ามา (แก้ไม่ได้ ประวัติผูกอยู่) · ชื่อที่โชว์ = ชื่อบนบอร์ด (ว่าง = ใช้ชื่อมิเตอร์) · ต่อจาก = ตู้แม่ในผังจ่ายไฟ (ว่าง = ชั้นบนสุดของตู้) · ลิมิตว่าง = ไม่เตือน · เกณฑ์รอ = kW ต่ำกว่านี้ถือว่า "รอ" (ว่าง = ไม่ตัดสิน ทำงาน/รอ)')}
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
            <thead><tr>
              <th style={th}>{tr('มิเตอร์')}</th><th style={th}>{tr('ชื่อที่โชว์')}</th><th style={th}>{tr('ตู้')}</th><th style={th}>{tr('ต่อจาก')}</th>
              <th style={th}>{tr('คำอธิบาย')}</th><th style={th}>{tr('ลิมิต kW')}</th><th style={th}>{tr('ลิมิต A')}</th><th style={th}>{tr('สเกลเกจ kW')}</th><th style={th} title={tr('kW ต่ำกว่านี้ = รอ · ว่าง = ยังไม่ตั้ง (บอร์ดไม่ตัดสินทำงาน/รอ)')}>{tr('เกณฑ์รอ (kW)')}</th>
              <th style={th}>{tr('ลำดับ')}</th><th style={th}>{tr('แสดง')}</th><th style={th} />
            </tr></thead>
            <tbody>
              {rows.map(r => {
                const k = keyOf(r), d = drafts[k] || toDraft(r), dirty = !same(d, toDraft(r)), kids = kidsOf(r);
                const dis = !canEdit || busy === k;
                return (
                  <tr key={k} style={{ background: dirty ? 'var(--accent-dim)' : undefined }}>
                    <td style={{ ...td, fontSize: 12.5, color: 'var(--text2)', whiteSpace: 'nowrap' }} title={r.updated_by ? `${tr('แก้ล่าสุดโดย')} ${r.updated_by}` : undefined}>{r.scope_name}</td>
                    <td style={td}><input style={inp} value={d.display_name} placeholder={r.scope_name} disabled={dis} onChange={e => setD(k, 'display_name', e.target.value)} /></td>
                    <td style={td}><PanelPick panels={panels} value={d.panel} disabled={dis} onChange={v => setD(k, 'panel', v)} /></td>
                    <td style={td}>
                      <select style={inp} value={d.parent_name || ''} disabled={dis} onChange={e => setD(k, 'parent_name', e.target.value)}>
                        <option value="">{tr('— ชั้นบนสุด —')}</option>
                        {parentOpts(r).map(x => <option key={keyOf(x)} value={x.scope_name}>{labelOf(x)}{labelOf(x) !== x.scope_name ? ` (${x.scope_name})` : ''}</option>)}
                      </select>
                    </td>
                    <td style={td}><input style={inp} value={d.subtitle} disabled={dis} onChange={e => setD(k, 'subtitle', e.target.value)} /></td>
                    <td style={{ ...td, width: 90 }}><input style={inp} type="number" min="0" value={d.limit_kw} disabled={dis} onChange={e => setD(k, 'limit_kw', e.target.value)} /></td>
                    <td style={{ ...td, width: 90 }}><input style={inp} type="number" min="0" value={d.limit_a} disabled={dis} onChange={e => setD(k, 'limit_a', e.target.value)} /></td>
                    <td style={{ ...td, width: 90 }}><input style={inp} type="number" min="0" value={d.gauge_max_kw} disabled={dis} onChange={e => setD(k, 'gauge_max_kw', e.target.value)} /></td>
                    <td style={{ ...td, width: 90 }}><input style={inp} type="number" min="0" step="0.1" value={d.idle_kw} placeholder={tr('ไม่ตั้ง')} disabled={dis} onChange={e => setD(k, 'idle_kw', e.target.value)} aria-label={`${tr('เกณฑ์รอ (kW)')} ${r.scope_name}`} /></td>
                    <td style={{ ...td, width: 70 }}><input style={inp} type="number" value={d.sort_order} disabled={dis} onChange={e => setD(k, 'sort_order', e.target.value)} /></td>
                    <td style={{ ...td, textAlign: 'center' }}><input type="checkbox" checked={d.is_active !== false} disabled={dis} onChange={e => setD(k, 'is_active', e.target.checked)} aria-label={tr('แสดงบนบอร์ด')} /></td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      {canEdit && <>
                        <button type="button" className="pg-btn primary" disabled={!dirty || busy === k} onClick={() => save(r)}>{busy === k ? '…' : tr('บันทึก')}</button>{' '}
                        {dirty && <button type="button" className="pg-btn" disabled={busy === k} onClick={() => setDrafts(x => ({ ...x, [k]: toDraft(r) }))}>{tr('ยกเลิก')}</button>}{' '}
                        <button type="button" className="pg-btn" disabled={busy === k || kids.length > 0} onClick={() => remove(r)}
                          title={kids.length ? `${tr('มีตู้ลูก')} ${kids.length} ${tr('ตู้ — ย้ายแม่ของตู้ลูกก่อน')}` : tr('เอาออกจากบอร์ด')}>{tr('ลบ')}</button>
                      </>}
                    </td>
                  </tr>
                );
              })}
              {!rows.length && <tr><td style={{ ...td, color: 'var(--muted)' }} colSpan={12}>{tr('ยังไม่มีตู้บนบอร์ด')}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div style={card}>
        <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>{tr('ค่าตั้งต่อตู้ — เป้า Demand 15 นาที · ช่วง Baseline')}</div>
        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 8 }}>
          {tr('ใช้กับการ์ด Demand 15 นาทีบนแท็บค่าไฟสด · ว่าง = ไม่ตั้งเป้า (การ์ดไม่ตัดสินเกิน/ไม่เกิน)')}
          {' · '}{tr('ช่วง Baseline = เวลาพักที่เครื่องควรเบา (เวลาไทย 24 ชม.) · ว่างทั้งคู่ = ไม่โชว์ Baseline')}
        </div>
        {panelCfg === null ? <NoticeBar tone="warn">{tr('อ่านเป้า Demand ไม่ได้ — ลองโหลดใหม่')}</NoticeBar> : (
          <div style={{ display: 'grid', gap: 6 }}>
            {panels.map(p => {
              const cur = panelCfg?.[p]?.demand_target_kw ?? '';
              const b = baseDraft[p] || { s: '', e: '' };
              const bCur = { s: hm5(panelCfg?.[p]?.baseline_start), e: hm5(panelCfg?.[p]?.baseline_end) };
              const dirty = String(targetDraft[p] ?? '') !== String(cur) || b.s !== bCur.s || b.e !== bCur.e;
              const setB = (k, v) => setBaseDraft(x => ({ ...x, [p]: { ...(x[p] || { s: '', e: '' }), [k]: v } }));
              return (
                <div key={p} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ minWidth: 140, fontWeight: 700, color: 'var(--text)' }}>{tr('ตู้')} {p}</span>
                  <input type="number" min="0" style={{ ...inp, width: 140 }} value={targetDraft[p] ?? ''} disabled={!canEdit || panelCfg === undefined}
                    placeholder={tr('ไม่ตั้งเป้า')} onChange={e => setTargetDraft(x => ({ ...x, [p]: e.target.value }))} aria-label={`${tr('เป้า Demand')} ${p}`} />
                  <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>kW</span>
                  <span style={{ fontSize: 12.5, color: 'var(--muted)', marginLeft: 8 }}>Baseline</span>
                  <input type="time" style={{ ...inp, width: 110 }} value={b.s} disabled={!canEdit || panelCfg === undefined}
                    onChange={e => setB('s', e.target.value)} aria-label={`${tr('เริ่ม Baseline')} ${p}`} />
                  <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>–</span>
                  <input type="time" style={{ ...inp, width: 110 }} value={b.e} disabled={!canEdit || panelCfg === undefined}
                    onChange={e => setB('e', e.target.value)} aria-label={`${tr('จบ Baseline')} ${p}`} />
                  {/* ช่อง time แสดงผลตามเครื่อง (อาจเป็น AM/PM) ⇒ ทวนค่า 24 ชม. ให้เห็นเสมอ (กฎเวลาที่คนกรอก) */}
                  <span style={{ fontSize: 12, color: 'var(--text2)' }}>{b.s || b.e ? `= ${b.s || '--:--'}–${b.e || '--:--'} ${tr('น.')}` : tr('ไม่ตั้ง')}</span>
                  {canEdit && <button type="button" className="pg-btn primary" disabled={!dirty || busy === `t|${p}`} onClick={() => saveTarget(p)}>{busy === `t|${p}` ? '…' : tr('บันทึก')}</button>}
                  {panelCfg?.[p]?.updated_by && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{tr('แก้ล่าสุดโดย')} {panelCfg[p].updated_by}</span>}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {canEdit && (
        <div style={card}>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>{tr('เพิ่มตู้เข้าบอร์ด')}</div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 8 }}>
            {tr('เลือกได้เฉพาะมิเตอร์ที่ผูก topic แล้ว (หน้าการเชื่อมต่อ) และยังไม่อยู่บนบอร์ด')} · {freeScopes.length
              ? `${freeScopes.length} ${tr('ตัวที่ยังไม่ได้เพิ่ม')}`
              : tr('ตอนนี้มิเตอร์ที่ผูก topic แล้วอยู่บนบอร์ดครบทุกตัว — มีมิเตอร์ใหม่ ให้ผูก topic ที่หน้าการเชื่อมต่อก่อน แล้วจะขึ้นในช่องนี้')}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'end' }}>
            <label style={addLbl}>{tr('มิเตอร์')}
              <select value={add.scope} onChange={e => setAdd(a => ({ ...a, scope: e.target.value }))} style={inp} disabled={!freeScopes.length}>
                <option value="">{freeScopes.length ? tr('— เลือก —') : tr('— ไม่มีมิเตอร์ที่ยังไม่ได้เพิ่ม —')}</option>
                {freeScopes.map(s => <option key={keyOf(s)} value={keyOf(s)}>{s.scope_name}</option>)}
              </select>
            </label>
            <label style={addLbl}>{tr('ชื่อที่โชว์')}
              <input style={inp} value={add.display_name} placeholder={tr('ว่าง = ชื่อมิเตอร์')} onChange={e => setAdd(a => ({ ...a, display_name: e.target.value }))} />
            </label>
            <label style={addLbl}>{tr('ตู้')}
              <PanelPick panels={panels} value={add.panel} onChange={v => setAdd(a => ({ ...a, panel: v }))} />
            </label>
            <label style={addLbl}>{tr('ต่อจาก')}
              <select value={add.parent_name} onChange={e => setAdd(a => ({ ...a, parent_name: e.target.value }))} style={inp}>
                <option value="">{tr('— ชั้นบนสุด —')}</option>
                {parentOpts(null).map(x => <option key={keyOf(x)} value={x.scope_name}>{labelOf(x)}</option>)}
              </select>
            </label>
            <button type="button" className="pg-btn primary" disabled={busy === 'add' || !add.scope} onClick={create}>{busy === 'add' ? '…' : tr('เพิ่มตู้')}</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ช่อง "ตู้" — เลือกจากตู้ที่มีอยู่ (ทุกตัวขึ้นเสมอ) หรือ "➕ ตู้ใหม่…" แล้วพิมพ์ชื่อ
   (เดิม input+datalist: เบราว์เซอร์กรองตัวเลือกตามค่าที่อยู่ในช่อง ⇒ เห็นแค่ตู้เดิมตู้เดียว · user แจ้ง 23/11) */
function PanelPick({ panels, value, onChange, disabled }) {
  const [typing, setTyping] = useState(false);
  const known = panels.includes(value);
  if (typing || (value && !known)) {
    return (
      <div style={{ display: 'flex', gap: 4 }}>
        <input style={inp} value={value} autoFocus={typing} disabled={disabled} placeholder={tr('ชื่อตู้ใหม่')} onChange={e => onChange(e.target.value)} />
        {panels.length > 0 && <button type="button" className="pg-btn" disabled={disabled} title={tr('เลือกจากตู้ที่มี')}
          onClick={() => { setTyping(false); onChange(panels.includes(value) ? value : ''); }}>☰</button>}
      </div>
    );
  }
  return (
    <select style={inp} value={value || ''} disabled={disabled}
      onChange={e => { if (e.target.value === '__new') { setTyping(true); onChange(''); } else onChange(e.target.value); }}>
      {!value && <option value="">{tr('— เลือกตู้ —')}</option>}
      {panels.map(p => <option key={p} value={p}>{p}</option>)}
      <option value="__new">{tr('➕ ตู้ใหม่…')}</option>
    </select>
  );
}
