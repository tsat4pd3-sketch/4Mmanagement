import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import { UserContext, NAV_ITEMS, NAV_GROUP_ORDER } from '../App';
import Page from '../components/Page';
import PageHeader from '../components/PageHeader';
import SearchSelect from '../components/SearchSelect';
import SearchInput from '../components/SearchInput';
import LineSelect from '../components/LineSelect';
import ProductSelect from '../components/ProductSelect';
import { toast } from '../components/Toast';
import { canAccessPage, canSeeded } from '../utils/permissions';
import { checkWriteRows } from '../utils/dbWrite';
import useProductionLines from '../utils/useProductionLines';
import useIsMobile from '../utils/useIsMobile';
import { ALL } from '../utils/filterLabels';
import {
  ROT_LIMITS, normalizeConfig, buildPlaylist, secOf, pathOnly, isValidRotationPath,
  cleanItemsForSave, fmtSec, SKIP_REASON_LABEL,
  sectionsOfProfile, canManageDisplay, displayChannelName,
  DISPLAY_PAGE_PARAMS, queryParamsOf, withQueryParams, paramSummary, paramVisible,
} from '../utils/displayRotation';

/* ══ 🔁 ตั้งค่าจอวนหน้า — /display-rotation ══════════════════════════════════════════
   2026-10-09 · คำสั่ง user: "แบบมีหน้า config ได้ ว่าจอ user นี้จะเปิดอะไรวนบ้าง"
   2026-10-14 · รอบ 2 (feedback หลังติดทีวี 13 จอ):
     1. ลิสต์มีแต่ "บัญชีจอ" (role display) — บัญชีคนไม่ต้องโผล่
     2. จอ 2 คอลัมน์: ซ้ายตั้งค่า · ขวาตัวอย่างหน้า + สั่งจอ (เดิมคอลัมน์เดียว ที่ว่างด้านขวาเยอะ)
     3. ส่วนงานของจอดึงจากบัญชี (ตั้งที่ /add-user) มาโชว์เอง ไม่ต้องพิมพ์ในหมายเหตุ
     4. แอดมินส่วนงานตั้ง/สั่งได้เฉพาะจอของส่วนงานตัวเอง — canManageDisplay() + RLS fn_can_manage_display()
        สั่งจอผ่าน Realtime broadcast (ดู DisplayRotator) · goto ได้แค่ลำดับในรอบ
     5. ตัวกรองต่อหน้า (แท็บ/ไลน์/ส่วนงาน) จากทะเบียน DISPLAY_PAGE_PARAMS — ชุดที่หน้านั้นอ่านจริงเท่านั้น
   ข้อมูล: `display_rotations` (Main · 1 แถว = 1 บัญชี) · กฎตีความ = utils/displayRotation.js

   ⚠️ ตัวอย่างหน้าทางขวา = เปิดด้วย "บัญชีของคุณ" ไม่ใช่บัญชีจอ ⇒ ขอบเขตข้อมูลอาจกว้างกว่าจอจริง (เขียนบอกบนจอแล้ว)
   ════════════════════════════════════════════════════════════════════════════════════ */

const EMPTY = { enabled: true, items: [], default_sec: ROT_LIMITS.defaultSec, pause_sec: ROT_LIMITS.defaultPauseSec, reload_min: ROT_LIMITS.defaultReloadMin, note: '' };
const RELOAD_OPTS = [
  { v: 360, label: 'ทุก 6 ชม.' }, { v: 720, label: 'ทุก 12 ชม. (แนะนำ)' },
  { v: 1440, label: 'ทุก 24 ชม.' }, { v: '', label: 'ไม่รีโหลด' },
];

/* ลิสต์หน้าที่เลือกได้ = เมนูจริงของระบบ (NAV_ITEMS) — ห้ามพิมพ์รายชื่อหน้าซ้ำในไฟล์นี้ */
const PAGE_OPTIONS = NAV_ITEMS
  .filter(i => i.to !== '/' && i.to !== '/display-rotation')
  .sort((a, b) => NAV_GROUP_ORDER.indexOf(a.group) - NAV_GROUP_ORDER.indexOf(b.group));
const pageMeta = (path) => NAV_ITEMS.find(n => n.to === pathOnly(path));

export default function DisplayRotation() {
  const { role, realRole, sections: mySections } = useContext(UserContext);
  const isMobile = useIsMobile(1100);
  const canEdit = canSeeded('display_rotation', 'manage', role);
  const lines = useProductionLines();

  const [accounts, setAccounts] = useState([]);      // profiles (role display เท่านั้น)
  const [emails, setEmails] = useState({});          // id → email (admin เท่านั้นที่อ่านได้)
  const [plans, setPlans] = useState({});            // user_id → แถว display_rotations
  const [loadErr, setLoadErr] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [q, setQ] = useState('');
  const [selId, setSelId] = useState('');
  const [form, setForm] = useState(EMPTY);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [focusIdx, setFocusIdx] = useState(0);       // แถวที่โชว์ในตัวอย่าง

  useEffect(() => {
    let alive = true;
    (async () => {
      const [pRes, rRes] = await Promise.all([
        supabase.from('profiles').select('id, full_name, role, section, sections').eq('role', 'display'),
        supabase.from('display_rotations').select('user_id, enabled, items, default_sec, pause_sec, reload_min, note, updated_at, updated_by_name'),
      ]);
      if (!alive) return;
      const err = pRes.error || rRes.error;
      setLoadErr(err ? err.message : null);
      setAccounts(pRes.data || []);
      setPlans(Object.fromEntries((rRes.data || []).map(r => [r.user_id, r])));
      setLoaded(true);
    })();
    return () => { alive = false; };
  }, [reloadKey]);

  // อีเมล login อยู่ที่ auth.users (profiles ไม่มีคอลัมน์ email) — RPC เปิดให้ admin เท่านั้น
  useEffect(() => {
    if (realRole !== 'admin') return undefined;
    let alive = true;
    (async () => {
      const { data, error } = await supabase.rpc('get_auth_users');
      if (!alive || error) return;
      setEmails(Object.fromEntries((data || []).map(u => [u.id, u.email])));
    })();
    return () => { alive = false; };
  }, [realRole]);

  /* ── จอที่ "ฉัน" ดูแลได้ (ขอบเขตส่วนงาน) · จำนวนที่ซ่อนต้องเขียนบนจอ ── */
  const mySecKey = (mySections || []).join('|');
  const { screens, hiddenScreens } = useMemo(() => {
    const mine = mySecKey ? mySecKey.split('|') : [];
    const ok = accounts.filter(a => canManageDisplay(mine, sectionsOfProfile(a)));
    ok.sort((a, b) => String(a.full_name || '').localeCompare(String(b.full_name || ''), 'th', { numeric: true }));
    return { screens: ok, hiddenScreens: accounts.length - ok.length };
  }, [accounts, mySecKey]);
  const shown = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!k) return screens;
    return screens.filter(a => [a.full_name, emails[a.id], ...sectionsOfProfile(a), plans[a.id]?.note]
      .some(v => String(v || '').toLowerCase().includes(k)));
  }, [screens, q, emails, plans]);

  const selAcc = screens.find(a => a.id === selId) || null;
  const targetRole = selAcc?.role || null;
  const tvSections = useMemo(() => (selAcc ? sectionsOfProfile(selAcc) : []), [selAcc]);

  const pick = useCallback((id) => {
    if (id === selId) return;
    if (dirty && !window.confirm('มีการแก้ที่ยังไม่บันทึก — ทิ้งการแก้แล้วเปลี่ยนจอ?')) return;
    setSelId(id || '');
    const row = id ? plans[id] : null;
    setForm(row ? { ...EMPTY, ...row, items: Array.isArray(row.items) ? row.items : [], note: row.note || '' } : EMPTY);
    setDirty(false);
    setFocusIdx(0);
  }, [dirty, plans, selId]);

  const setF = (k, v) => { setForm(f => ({ ...f, [k]: v })); setDirty(true); };
  const setItem = (i, patch) => setF('items', form.items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const moveItem = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= form.items.length) return;
    const arr = [...form.items];
    [arr[i], arr[j]] = [arr[j], arr[i]];
    setF('items', arr);
    setFocusIdx(j);
  };

  /* 🔴 ให้เลือกได้เฉพาะหน้าที่บัญชีนั้น "เข้าได้จริง" (09/10: "หน้าที่เข้าไม่ได้ก็ไม่ควรมีให้ setup") */
  const { pageOptions, hiddenPages } = useMemo(() => {
    if (!targetRole) return { pageOptions: [], hiddenPages: 0 };
    const ok = PAGE_OPTIONS.filter(p => canAccessPage(p.to, targetRole));
    return {
      pageOptions: ok.map(p => ({
        id: p.to, label: `${p.icon} ${p.label}`, code: p.to, sub: p.group, group: p.group, keywords: p.to,
        badge: DISPLAY_PAGE_PARAMS[p.to] ? 'มีตัวกรอง' : null, badgeColor: 'var(--accent)',
      })),
      hiddenPages: PAGE_OPTIONS.length - ok.length,
    };
  }, [targetRole]);

  /* ⚠️ ห้ามกรองแถวว่างก่อน buildPlaylist — `idx` ของหน้าที่ข้ามต้องตรงกับแถวบนจอ */
  const preview = useMemo(() => {
    const cfg = normalizeConfig(form);
    const items = form.items.map(it => ({ path: String(it?.path ?? '').trim(), sec: it?.sec ?? null }));
    const r = buildPlaylist(items, p => (targetRole ? canAccessPage(p, targetRole) : true), cfg.defaultSec);
    return { playable: r.playable, skipped: r.skipped.filter(s => s.path) };
  }, [form, targetRole]);
  const cycleSec = preview.playable.reduce((s, p) => s + p.sec, 0);

  /* ── 📡 สถานะจอ + สั่งจอ (ช่องเดียวกับ DisplayRotator) ── */
  const [live, setLive] = useState(null);   // presence ล่าสุดของจอ หรือ null = ไม่ออนไลน์
  const chanRef = useRef(null);
  const savedPlan = selId ? plans[selId] : null;
  useEffect(() => {
    setLive(null);
    if (!selId) return undefined;
    const ch = supabase.channel(displayChannelName(selId), { config: { broadcast: { self: false }, presence: { key: `admin-${Math.random().toString(36).slice(2, 8)}` } } });
    const read = () => {
      const st = ch.presenceState();
      const metas = (st.screen || []);
      const last = metas.reduce((a, m) => (!a || (m.at || 0) > (a.at || 0) ? m : a), null);
      setLive(last);
    };
    ch.on('presence', { event: 'sync' }, read);
    ch.subscribe((s) => { if (s === 'SUBSCRIBED') chanRef.current = ch; });
    return () => { chanRef.current = null; supabase.removeChannel(ch); };
  }, [selId]);
  const send = (payload) => {
    const ch = chanRef.current;
    if (!ch) { toast.error('ยังต่อช่องสั่งจอไม่ติด — รอสักครู่แล้วลองใหม่'); return; }
    ch.send({ type: 'broadcast', event: 'cmd', payload });
  };
  // presence ถูก Realtime ถอดให้เองเมื่อจอหลุด ⇒ มี = ออนไลน์ (เวลาใน meta = ครั้งล่าสุดที่เปลี่ยนหน้า ไม่ใช่ heartbeat)
  const online = !!live;
  const savedPlayable = useMemo(() => (savedPlan
    ? buildPlaylist(normalizeConfig(savedPlan).items, p => (targetRole ? canAccessPage(p, targetRole) : true)).playable
    : []), [savedPlan, targetRole]);

  const save = async () => {
    if (!selId || !canEdit) return;
    if (!canManageDisplay(mySections || [], tvSections)) { toast.error('จอนี้อยู่นอกส่วนงานที่คุณดูแล'); return; }
    const items = cleanItemsForSave(form.items);
    const bad = items.find(it => !isValidRotationPath(it.path));
    if (bad) { toast.error(`ที่อยู่หน้าไม่ถูกต้อง: "${bad.path}" — ต้องขึ้นต้นด้วย / และอยู่ในระบบนี้`); return; }
    const denied = items.filter(it => !canAccessPage(pathOnly(it.path), targetRole));
    if (denied.length) {
      toast.error(`บัญชีนี้เข้าไม่ได้ ${denied.length} หน้า (${denied.map(d => d.path).join(', ')}) — เอาออกก่อนบันทึก`);
      return;
    }
    setSaving(true);
    const { data: me } = await supabase.auth.getUser();
    const payload = {
      user_id: selId,
      enabled: !!form.enabled,
      items,
      default_sec: secOf({ sec: form.default_sec }, ROT_LIMITS.defaultSec),
      pause_sec: Math.min(ROT_LIMITS.maxPauseSec, Math.max(ROT_LIMITS.minPauseSec, Math.round(Number(form.pause_sec) || ROT_LIMITS.defaultPauseSec))),
      reload_min: form.reload_min === '' || form.reload_min == null ? null : Number(form.reload_min),
      note: (form.note || '').trim() || null,
      updated_by: me?.user?.id || null,
      updated_by_name: me?.user?.email || null,
    };
    const res = await supabase.from('display_rotations').upsert(payload, { onConflict: 'user_id' }).select('user_id');
    setSaving(false);
    if (!checkWriteRows(res, 'บันทึกรอบจอ', { zeroMsg: 'บันทึกไม่สำเร็จ — ไม่มีสิทธิ์ตั้งจอนี้ (นอกส่วนงานที่ดูแล หรือไม่มีสิทธิ์ “จอวนหน้า”)' })) return;
    toast.success(online ? 'บันทึกแล้ว — กด 🔄 รีโหลดจอ เพื่อให้จอใช้รอบใหม่ทันที' : 'บันทึกแล้ว — จอจะใช้รอบใหม่ตอนวนครบรอบ (หรือเปิดจอใหม่)');
    setDirty(false);
    setReloadKey(k => k + 1);
  };

  const removePlan = async () => {
    if (!selId || !plans[selId] || !canEdit) return;
    if (!window.confirm('ลบรอบของจอนี้? จอจะหยุดวนและค้างที่หน้าปัจจุบัน')) return;
    const res = await supabase.from('display_rotations').delete().eq('user_id', selId).select('user_id');
    if (!checkWriteRows(res, 'ลบรอบจอ')) return;
    toast.success('ลบรอบแล้ว');
    setForm(EMPTY); setDirty(false); setReloadKey(k => k + 1);
  };

  const actions = selId && canEdit ? (
    <>
      {plans[selId] && <button type="button" onClick={removePlan} style={btnGhost}>🗑 ลบรอบ</button>}
      <button type="button" onClick={save} disabled={saving || !dirty} style={btnPrimary}>
        {saving ? 'กำลังบันทึก…' : dirty ? '💾 บันทึก' : '✓ บันทึกแล้ว'}
      </button>
    </>
  ) : null;

  const allSections = useMemo(() => [...new Set((lines || []).map(l => l.section).filter(Boolean))], [lines]);
  const focusItem = form.items[focusIdx] || null;
  const focusPath = focusItem?.path && isValidRotationPath(focusItem.path) && canAccessPage(pathOnly(focusItem.path), targetRole) ? focusItem.path : '';

  return (
    <Page>
      <PageHeader title="ตั้งค่าจอวนหน้า" icon="🔁"
        sub="เลือกจอ → ตั้งหน้าที่วน หน้าละกี่วินาที (+ แท็บ/ไลน์ของแต่ละหน้า) · สั่งจอเปลี่ยนหน้าได้จากที่นี่"
        actions={actions} />

      {loadErr && <div style={warnBox}>⚠ โหลดข้อมูลไม่ครบ: {loadErr} — รายการด้านล่างอาจไม่ครบ</div>}
      {!canEdit && <div style={infoBox}>ดูอย่างเดียว — ต้องมีสิทธิ์ “จอวนหน้า: ตั้งว่าบัญชีจอไหนเปิดหน้าอะไรวนบ้าง” (ตั้งที่ /permissions)</div>}

      {/* ── เลือกจอ (การ์ด) ── */}
      <section className="card" style={{ padding: 14, marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
          <div style={{ fontSize: 14, fontWeight: 800 }}>📺 จอที่คุณดูแล ({screens.length})</div>
          {hiddenScreens > 0 && (
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>· ซ่อน {hiddenScreens} จอที่อยู่นอกส่วนงานของคุณ</div>
          )}
          <div style={{ flex: 1 }} />
          {screens.length > 8 && <div style={{ width: 240, maxWidth: '100%' }}><SearchInput value={q} onChange={setQ} fields="ชื่อจอ / ส่วนงาน / หมายเหตุ" /></div>}
        </div>
        {loaded && screens.length === 0 && (
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>
            ยังไม่มีบัญชีจอ (role 📺 จอแสดงผล) ในส่วนงานของคุณ — สร้าง/ตั้งส่วนงานบัญชีจอที่ /add-user
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 8, alignContent: 'start' }}>
          {shown.map(a => {
            const plan = plans[a.id];
            const n = Array.isArray(plan?.items) ? plan.items.length : 0;
            const secs = sectionsOfProfile(a);
            const on = a.id === selId;
            return (
              <button key={a.id} type="button" onClick={() => pick(a.id)} aria-current={on ? 'true' : undefined}
                style={{
                  textAlign: 'left', padding: '10px 12px', borderRadius: 10, display: 'grid', gap: 3,
                  background: on ? 'var(--accent-dim)' : 'var(--bg2)', color: 'var(--text)',
                  border: `1.5px solid ${on ? 'var(--accent)' : 'var(--border2)'}`,
                }}>
                <span style={{ fontSize: 15, fontWeight: 800 }}>{a.full_name || emails[a.id] || a.id.slice(0, 8)}</span>
                <span style={{ fontSize: 12, color: secs.length ? 'var(--text2)' : 'var(--amber)' }}>
                  📍 {secs.length ? secs.join(', ') : 'ยังไม่ตั้งส่วนงาน (เห็นทั้งโรงงาน)'}
                </span>
                <span style={{ fontSize: 12, color: plan ? (plan.enabled ? 'var(--green)' : 'var(--muted)') : 'var(--muted)' }}>
                  {plan ? (plan.enabled ? `🔁 วน ${n} หน้า` : '⏸ ปิดการวน') : '— ยังไม่ตั้งรอบ'}
                </span>
                {plan?.note && <span style={{ fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{plan.note}</span>}
              </button>
            );
          })}
        </div>
      </section>

      {!selAcc && screens.length > 0 && (
        <div style={{ ...infoBox, textAlign: 'center', padding: 24, fontSize: 13 }}>👆 เลือกจอด้านบนเพื่อตั้งรอบ</div>
      )}

      {selAcc && (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0,1fr)' : 'minmax(0,1.1fr) minmax(0,1fr)', gap: 12, alignItems: 'start' }}>
          {/* ════ ซ้าย: ตั้งค่า ════ */}
          <div style={{ display: 'grid', gap: 12, minWidth: 0 }}>
            <section className="card" style={{ padding: 16, display: 'grid', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 16, fontWeight: 800 }}>{selAcc.full_name}</div>
                <span style={chipSt}>📍 ส่วนงาน: {tvSections.length ? tvSections.join(', ') : 'ทั้งโรงงาน (ยังไม่ตั้ง)'}</span>
                {emails[selAcc.id] && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{emails[selAcc.id]}</span>}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: -6 }}>
                ส่วนงานดึงจากบัญชีจอเอง (แก้ที่ /add-user) — จอเห็นข้อมูลเฉพาะส่วนงานนี้ทุกหน้า
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 700 }}>
                <input type="checkbox" checked={!!form.enabled} disabled={!canEdit} onChange={e => setF('enabled', e.target.checked)} />
                เปิดการวนหน้า
                <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--muted)' }}>(ปิด = เก็บรอบไว้ แต่จอค้างหน้าเดิม)</span>
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <Field label="ค่าตั้งต้น วินาที/หน้า">
                  <input type="number" min={ROT_LIMITS.minSec} max={ROT_LIMITS.maxSec} value={form.default_sec ?? ''} disabled={!canEdit}
                    onChange={e => setF('default_sec', e.target.value)} style={{ width: 110 }} />
                </Field>
                <Field label="มีคนแตะจอ = หยุดวน (วินาที)">
                  <input type="number" min={ROT_LIMITS.minPauseSec} max={ROT_LIMITS.maxPauseSec} value={form.pause_sec ?? ''} disabled={!canEdit}
                    onChange={e => setF('pause_sec', e.target.value)} style={{ width: 110 }} />
                </Field>
                <Field label="รีโหลดเต็มหน้า (ล้างหน่วยความจำทีวี)">
                  <select value={form.reload_min ?? ''} disabled={!canEdit} onChange={e => setF('reload_min', e.target.value === '' ? '' : Number(e.target.value))}>
                    {RELOAD_OPTS.map(o => <option key={o.label} value={o.v}>{o.label}</option>)}
                  </select>
                </Field>
              </div>
              <Field label="ตำแหน่งที่ติดจอ / หมายเหตุ">
                <input type="text" value={form.note || ''} disabled={!canEdit} maxLength={200}
                  onChange={e => setF('note', e.target.value)}
                  placeholder={`เช่น ${tvSections[0] || 'PD3'} ห้องช่าง ผนังซ้าย`} />
              </Field>
            </section>

            <section className="card" style={{ padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
                <div style={{ fontSize: 15, fontWeight: 800 }}>ลำดับหน้าที่วน</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                  วนจริง {preview.playable.length} หน้า · ครบรอบ {fmtSec(cycleSec)}
                  {preview.skipped.length > 0 && <span style={{ color: 'var(--red)', fontWeight: 700 }}> · จะถูกข้าม {preview.skipped.length} หน้า</span>}
                </div>
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
                เลือกได้ {pageOptions.length} หน้าที่จอนี้เข้าได้
                {hiddenPages > 0 && ` · ซ่อน ${hiddenPages} หน้าที่ role จอแสดงผลไม่มีสิทธิ์ (เปิดได้ที่ /permissions)`}
              </div>

              {form.items.length === 0 && (
                <div style={{ fontSize: 13, color: 'var(--muted)', padding: '8px 0' }}>ยังไม่มีหน้าในรอบ — กด “+ เพิ่มหน้า”</div>
              )}

              <div style={{ display: 'grid', gap: 8 }}>
                {form.items.map((it, i) => (
                  <ItemRow key={i} i={i} it={it} n={form.items.length} canEdit={canEdit}
                    focused={i === focusIdx} onFocus={() => setFocusIdx(i)}
                    pageOptions={pageOptions} defaultSec={form.default_sec}
                    skip={preview.skipped.find(s => s.idx === i)}
                    lines={lines} tvSections={tvSections} allSections={allSections}
                    onChange={(patch) => setItem(i, patch)}
                    onMove={(d) => moveItem(i, d)}
                    onRemove={() => { setF('items', form.items.filter((_, j) => j !== i)); setFocusIdx(Math.max(0, i - 1)); }} />
                ))}
              </div>

              {canEdit && form.items.length < ROT_LIMITS.maxItems && (
                <button type="button" onClick={() => { setF('items', [...form.items, { path: '', sec: null }]); setFocusIdx(form.items.length); }}
                  style={{ ...btnGhost, marginTop: 10 }}>+ เพิ่มหน้า</button>
              )}
              {plans[selId]?.updated_at && (
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 10 }}>
                  แก้ล่าสุด {new Date(plans[selId].updated_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}
                  {plans[selId].updated_by_name ? ` โดย ${plans[selId].updated_by_name}` : ''}
                </div>
              )}
            </section>
          </div>

          {/* ════ ขวา: สั่งจอ + ตัวอย่าง ════ */}
          <div style={{ display: 'grid', gap: 12, minWidth: 0, position: isMobile ? 'static' : 'sticky', top: 12 }}>
            <section className="card" style={{ padding: 14, display: 'grid', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 15, fontWeight: 800 }}>🎮 สั่งจอ</div>
                {online ? (
                  <span style={{ ...chipSt, color: 'var(--green)', borderColor: 'var(--green)' }}>
                    🟢 ออนไลน์ · หน้า {(live.idx ?? 0) + 1}/{live.n}{live.held ? ' · ⏸ หยุดอยู่' : ''}
                  </span>
                ) : (
                  <span style={{ ...chipSt, color: 'var(--muted)' }}>⚪ ไม่ได้เปิดอยู่ / ยังไม่ได้ login</span>
                )}
              </div>
              {online && live.path && (
                <div style={{ fontSize: 12, color: 'var(--text2)' }}>
                  ตอนนี้: <b>{pageMeta(live.path)?.label || live.path}</b>
                  {paramSummary(live.path).length > 0 && <span style={{ color: 'var(--muted)' }}> · {paramSummary(live.path).join(' · ')}</span>}
                </div>
              )}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button type="button" style={btnGhost} disabled={!online || !canEdit} onClick={() => send({ type: 'prev' })}>◀ ก่อนหน้า</button>
                {live?.held
                  ? <button type="button" style={btnGhost} disabled={!online || !canEdit} onClick={() => send({ type: 'resume' })}>▶ วนต่อ</button>
                  : <button type="button" style={btnGhost} disabled={!online || !canEdit} onClick={() => send({ type: 'hold' })}>⏸ หยุดค้าง</button>}
                <button type="button" style={btnGhost} disabled={!online || !canEdit} onClick={() => send({ type: 'next' })}>ถัดไป ▶▶</button>
                <button type="button" style={btnGhost} disabled={!online || !canEdit} onClick={() => send({ type: 'reload' })} title="ให้จอโหลดใหม่ — ใช้หลังบันทึกรอบใหม่">🔄 รีโหลดจอ</button>
              </div>
              {savedPlayable.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {savedPlayable.map((p, j) => (
                    <button key={j} type="button" disabled={!online || !canEdit} onClick={() => send({ type: 'goto', idx: j })}
                      style={{ ...chipBtn, ...(online && live.idx === j ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : null) }}>
                      {j + 1}. {pageMeta(p.path)?.label || p.path}
                    </button>
                  ))}
                </div>
              )}
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                ปุ่มเลขหน้า = รอบที่บันทึกแล้ว (แก้แล้วยังไม่บันทึก จอยังไม่รู้) · จอต้องตั้งรอบไว้และเปิดอยู่จึงสั่งได้
              </div>
            </section>

            <section className="card" style={{ padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                <div style={{ fontSize: 15, fontWeight: 800 }}>👁 ตัวอย่างหน้า {focusItem ? `#${focusIdx + 1}` : ''}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>กดแถวทางซ้ายเพื่อสลับ</div>
              </div>
              <PagePreview path={focusPath} />
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
                ⚠ ตัวอย่างเปิดด้วยบัญชีของคุณ — ข้อมูลอาจกว้างกว่าที่จอเห็นจริง (จอเห็นเฉพาะ {tvSections.length ? tvSections.join(', ') : 'ทั้งโรงงาน'})
              </div>
            </section>
          </div>
        </div>
      )}
    </Page>
  );
}

/* ── 1 แถวในรอบ: เลือกหน้า + ตัวกรองของหน้านั้น + วินาที ── */
function ItemRow({ i, it, n, canEdit, focused, onFocus, pageOptions, defaultSec, skip, lines, tvSections, allSections, onChange, onMove, onRemove }) {
  const base = it.path ? pathOnly(it.path) : '';
  const params = queryParamsOf(it.path);
  const defs = DISPLAY_PAGE_PARAMS[base] || null;
  // ช่องที่ไม่เข้าเงื่อนไข showIf แล้ว (เช่น เปลี่ยนแท็บ) ถูกตัดออกจากลิงก์ — ไม่ทิ้งค่าค้างที่หน้าไม่ได้ใช้
  const setParam = (k, v) => {
    const next = { ...params, [k]: v };
    (defs || []).forEach(d => { if (!paramVisible(d, next)) delete next[d.key]; });
    onChange({ path: withQueryParams(base, next) });
  };
  const scopeOptions = useMemo(() => {
    const secs = tvSections.length ? tvSections : allSections;
    const parents = (lines || []).filter(l => !l.parent_line_name && (!tvSections.length || tvSections.includes(l.section)))
      .map(l => l.name).filter(n => (lines || []).some(c => c.parent_line_name === n));
    return [
      ...(tvSections.length ? [] : [{ value: 'plant', label: '🏭 ทั้งโรงงาน' }]),
      ...secs.map(x => ({ value: `section:${x}`, label: `📁 ส่วนงาน ${x}` })),
      ...parents.map(x => ({ value: `line_group:${x}`, label: `🏭 กลุ่มไลน์ ${x}` })),
    ];
  }, [tvSections, allSections, lines]);
  const rawQ = (String(it.path || '').match(/[?#].*$/) || [''])[0];
  const secOptions = tvSections.length ? tvSections : allSections;

  return (
    <div onClick={onFocus} onFocusCapture={onFocus}
      style={{ display: 'grid', gridTemplateColumns: '28px minmax(0,1fr)', gap: 8, alignItems: 'start', padding: 10, borderRadius: 10, cursor: 'pointer',
        border: `1.5px solid ${skip ? 'var(--red)' : focused ? 'var(--accent)' : 'var(--border2)'}`, background: 'var(--bg2)' }}>
      <div style={{ fontWeight: 800, fontSize: 14, paddingTop: 8, textAlign: 'center', color: focused ? 'var(--accent)' : 'var(--text)' }}>{i + 1}</div>
      <div style={{ display: 'grid', gap: 6, minWidth: 0 }}>
        <SearchSelect value={pageOptions.some(p => p.id === base) ? base : ''} options={pageOptions}
          placeholder="— ค้นหาหน้า —" disabled={!canEdit}
          onChange={({ id }) => onChange({ path: id || '' })} />

        {defs && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {defs.filter(d => paramVisible(d, params)).map(d => (
              <label key={d.key} style={{ display: 'grid', gap: 2, fontSize: 11, color: 'var(--muted)', minWidth: 0, alignContent: 'start' }}>
                <span style={{ fontWeight: 700 }}>{d.label}</span>
                {d.kind === 'select' && (
                  <select value={params[d.key] || ''} disabled={!canEdit} onChange={e => setParam(d.key, e.target.value)}>
                    <option value="">— ค่าเริ่มต้นของหน้า —</option>
                    {d.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                )}
                {d.kind === 'section' && (
                  <select value={params[d.key] || ''} disabled={!canEdit} onChange={e => setParam(d.key, e.target.value)}>
                    <option value="">{ALL.section}</option>
                    {secOptions.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                )}
                {d.kind === 'bool' && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 34, fontSize: 13, color: 'var(--text)' }}>
                    <input type="checkbox" checked={params[d.key] === '1'} disabled={!canEdit}
                      onChange={e => setParam(d.key, e.target.checked ? '1' : '')} />
                    {params[d.key] === '1' ? 'เปิด' : 'ปิด'}
                  </span>
                )}
                {d.kind === 'scope' && (
                  <select value={params[d.key] || ''} disabled={!canEdit} onChange={e => setParam(d.key, e.target.value)}>
                    <option value="">— ค่าเริ่มต้นของหน้า (ส่วนงานของจอ) —</option>
                    {scopeOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                )}
                {d.kind === 'product' && (
                  <ProductSelect value={params[d.key] || ''} disabled={!canEdit} style={{ minWidth: 240 }}
                    onChange={({ mat_no }) => setParam(d.key, mat_no || '')} />
                )}
                {d.kind === 'text' && (
                  <input type="text" value={params[d.key] || ''} disabled={!canEdit} maxLength={80}
                    onChange={e => setParam(d.key, e.target.value)} style={{ width: 180 }} />
                )}
                {d.kind === 'line' && (
                  <LineSelect lines={lines} value={params[d.key] || ''} disabled={!canEdit}
                    sections={tvSections} placeholder={ALL.line}
                    onChange={v => setParam(d.key, v)} />
                )}
              </label>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          {!defs && (
            <input type="text" value={rawQ} disabled={!canEdit || !base} placeholder="ต่อท้ายลิงก์ (ขั้นสูง · ไม่บังคับ)"
              onChange={e => {
                const v = e.target.value.trim();
                onChange({ path: `${base}${v && !/^[?#]/.test(v) ? `?${v}` : v}` });
              }}
              style={{ flex: '1 1 200px', minWidth: 0, fontFamily: 'var(--font-mono, monospace)' }} />
          )}
          {defs && <div style={{ flex: 1 }} />}
          <input type="number" min={ROT_LIMITS.minSec} max={ROT_LIMITS.maxSec} value={it.sec ?? ''} disabled={!canEdit}
            placeholder={`${secOf({}, defaultSec)} วิ`} title="วินาทีของหน้านี้ (ว่าง = ค่าตั้งต้น)"
            onChange={e => onChange({ sec: e.target.value === '' ? null : e.target.value })} style={{ width: 96 }} />
          {canEdit && (
            <>
              <button type="button" onClick={(e) => { e.stopPropagation(); onMove(-1); }} disabled={i === 0} style={btnSm} title="เลื่อนขึ้น">▲</button>
              <button type="button" onClick={(e) => { e.stopPropagation(); onMove(1); }} disabled={i === n - 1} style={btnSm} title="เลื่อนลง">▼</button>
              <button type="button" onClick={(e) => { e.stopPropagation(); onRemove(); }} style={btnSm} title="เอาออก">✕</button>
            </>
          )}
        </div>
        {skip && (
          <div style={{ fontSize: 12, color: 'var(--red)', fontWeight: 700 }}>
            ⛔ <code>{skip.path}</code> — {SKIP_REASON_LABEL[skip.reason]} · จอจะข้ามหน้านี้
            {skip.reason === 'no_access' && ' — เอาออกก่อนจึงบันทึกได้ (หรือเปิดสิทธิ์ให้ role นี้ที่ /permissions)'}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── ตัวอย่างหน้าแบบย่อ (iframe 1920×1080 ย่อตามกว้างกล่อง) ──
   โหลดเฉพาะแถวที่เลือก ไม่โหลดทุกแถว (ทุกหน้ายิงข้อมูลจริง = egress) */
function PagePreview({ path }) {
  const boxRef = useRef(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scale = w ? w / 1920 : 0.3;
  return (
    <div ref={boxRef} style={{ position: 'relative', width: '100%', height: Math.round(1080 * scale), overflow: 'hidden', borderRadius: 8, border: '1px solid var(--border2)', background: 'var(--bg)' }}>
      {path ? (
        <iframe key={path} src={path} title="ตัวอย่างหน้า" loading="lazy"
          style={{ width: 1920, height: 1080, border: 0, transform: `scale(${scale})`, transformOrigin: '0 0', pointerEvents: 'none' }} />
      ) : (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: 'var(--muted)', padding: 12, textAlign: 'center' }}>
          เลือกหน้าในแถวทางซ้ายเพื่อดูตัวอย่าง
        </div>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'grid', gap: 4, fontSize: 12, color: 'var(--text2)', minWidth: 0 }}>
      <span style={{ fontWeight: 700 }}>{label}</span>
      {children}
    </label>
  );
}

const warnBox = { padding: 12, marginBottom: 12, borderRadius: 10, fontSize: 13, lineHeight: 1.6,
  border: '1px solid var(--amber)', background: 'var(--card)', backgroundImage: 'linear-gradient(rgba(245,158,11,.10), rgba(245,158,11,.10))', color: 'var(--text)' };
const infoBox = { padding: 12, marginBottom: 12, borderRadius: 10, fontSize: 12, lineHeight: 1.7,
  border: '1px solid var(--border2)', background: 'var(--bg2)', color: 'var(--text2)' };
const chipSt = { padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700,
  background: 'var(--bg2)', border: '1px solid var(--border2)', color: 'var(--text)' };
const chipBtn = { padding: '4px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700,
  background: 'var(--bg2)', border: '1px solid var(--border2)', color: 'var(--text)' };
const btnPrimary = { padding: '8px 16px', borderRadius: 10, fontSize: 13, fontWeight: 800,
  background: 'var(--accent)', color: 'var(--accent-ink)', border: 'none' };
const btnGhost = { padding: '8px 14px', borderRadius: 10, fontSize: 13, fontWeight: 700,
  background: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--border2)' };
const btnSm = { minWidth: 34, height: 34, borderRadius: 8, fontSize: 12, fontWeight: 800,
  background: 'var(--card)', color: 'var(--text)', border: '1px solid var(--border2)' };
