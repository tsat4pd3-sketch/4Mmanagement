import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import { UserContext, NAV_ITEMS, NAV_GROUP_ORDER } from '../App';
import Page from '../components/Page';
import PageHeader from '../components/PageHeader';
import SearchSelect from '../components/SearchSelect';
import { toast } from '../components/Toast';
import { canAccessPage, canSeeded } from '../utils/permissions';
import { checkWriteRows } from '../utils/dbWrite';
import { roleLabel } from '../utils/roleMeta';
import {
  ROT_LIMITS, normalizeConfig, buildPlaylist, secOf, pathOnly, isValidRotationPath,
  cleanItemsForSave, fmtSec, SKIP_REASON_LABEL,
} from '../utils/displayRotation';

/* ══ 🔁 ตั้งค่าจอวนหน้า — /display-rotation ══════════════════════════════════════════
   2026-10-09 · คำสั่ง user: "แบบมีหน้า config ได้ ว่าจอ user นี้จะเปิดอะไรวนบ้าง"
   ใคร: admin/manager (`display_rotation:manage` · ขยายได้ที่ /permissions)
   ข้อมูล: ตาราง `display_rotations` (Main · 1 แถว = 1 บัญชี) · กฎตีความ = utils/displayRotation.js
   ตัววนจริงบนจอ: components/DisplayRotator.jsx (อ่านแผนใหม่ทุกครบรอบ — บันทึกแล้วจอรับเอง)

   สิ่งที่จอนี้ต้องบอกตรงๆ (ห้ามเงียบ):
   · หน้าที่บัญชีนั้น "ไม่มีสิทธิ์" — บนจอจริงจะถูกข้าม ⇒ ติดป้าย ⛔ ตั้งแต่ตอนตั้ง
   · บัญชีที่ไม่ใช่ role `display` — โดน idle-logout 35 นาที (ยกเว้นตอนอยู่ /tv) ⇒ วนไปได้ไม่นานก็เด้ง login
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

export default function DisplayRotation() {
  const { role, realRole } = useContext(UserContext);
  const canEdit = canSeeded('display_rotation', 'manage', role);

  const [accounts, setAccounts] = useState([]);      // profiles
  const [emails, setEmails] = useState({});          // id → email (admin เท่านั้นที่อ่านได้)
  const [plans, setPlans] = useState({});            // user_id → แถว display_rotations
  const [loadErr, setLoadErr] = useState(null);
  const [selId, setSelId] = useState('');
  const [form, setForm] = useState(EMPTY);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [pRes, rRes] = await Promise.all([
        supabase.from('profiles').select('id, full_name, role, account_kind'),
        supabase.from('display_rotations').select('user_id, enabled, items, default_sec, pause_sec, reload_min, note, updated_at, updated_by_name'),
      ]);
      if (!alive) return;
      const err = pRes.error || rRes.error;
      setLoadErr(err ? err.message : null);
      setAccounts(pRes.data || []);
      setPlans(Object.fromEntries((rRes.data || []).map(r => [r.user_id, r])));
    })();
    return () => { alive = false; };
  }, [reloadKey]);

  // อีเมล login อยู่ที่ auth.users (profiles ไม่มีคอลัมน์ email) — RPC เปิดให้ admin เท่านั้น
  // ไม่ใช่ admin = ไม่มีอีเมลให้ดู (แสดงชื่อบัญชีแทน) ไม่ใช่ข้อผิดพลาด
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

  const selAcc = accounts.find(a => a.id === selId) || null;
  const targetRole = selAcc?.role || null;

  const pick = useCallback((id) => {
    if (dirty && !window.confirm('มีการแก้ที่ยังไม่บันทึก — ทิ้งการแก้แล้วเปลี่ยนบัญชี?')) return;
    setSelId(id || '');
    const row = id ? plans[id] : null;
    setForm(row ? { ...EMPTY, ...row, items: Array.isArray(row.items) ? row.items : [], note: row.note || '' } : EMPTY);
    setDirty(false);
  }, [dirty, plans]);

  const setF = (k, v) => { setForm(f => ({ ...f, [k]: v })); setDirty(true); };
  const setItem = (i, patch) => setF('items', form.items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const moveItem = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= form.items.length) return;
    const arr = [...form.items];
    [arr[i], arr[j]] = [arr[j], arr[i]];
    setF('items', arr);
  };

  /* ── บัญชีเรียง: role display ก่อน → มีแผนแล้ว → ชื่อ ── */
  const accOptions = useMemo(() => [...accounts]
    .sort((a, b) => (b.role === 'display') - (a.role === 'display')
      || (!!plans[b.id]) - (!!plans[a.id])
      || String(a.full_name || '').localeCompare(String(b.full_name || ''), 'th', { numeric: true }))
    .map(a => {
      const plan = plans[a.id];
      const n = Array.isArray(plan?.items) ? plan.items.length : 0;
      return {
        id: a.id,
        label: a.full_name || emails[a.id] || a.id.slice(0, 8),
        sub: [roleLabel(a.role), emails[a.id], a.account_kind === 'shared' ? 'บัญชีส่วนกลาง' : null].filter(Boolean).join(' · '),
        badge: plan ? (plan.enabled ? `🔁 ${n} หน้า` : '⏸ ปิดอยู่') : null,
        badgeColor: plan?.enabled ? 'var(--green)' : 'var(--muted)',
        group: a.role === 'display' ? '📺 role display (บัญชีจอ)' : 'บัญชีอื่น',
        keywords: [emails[a.id], a.role].filter(Boolean).join(' '),
      };
    }), [accounts, plans, emails]);

  /* 🔴 ให้เลือกได้เฉพาะหน้าที่บัญชีนั้น "เข้าได้จริง" (คำสั่ง user 09/10: "หน้าที่เข้าไม่ได้ก็ไม่ควรมีให้ setup")
     ยังไม่เลือกบัญชี = ไม่มีตัวเลือก · จำนวนที่ซ่อนต้องเขียนบนจอ (ห้ามหายเงียบ — คนตั้งจะงงว่าหน้าที่หาไปไหน) */
  const { pageOptions, hiddenPages } = useMemo(() => {
    if (!targetRole) return { pageOptions: [], hiddenPages: 0 };
    const ok = PAGE_OPTIONS.filter(p => canAccessPage(p.to, targetRole));
    return {
      pageOptions: ok.map(p => ({
        id: p.to, label: `${p.icon} ${p.label}`, code: p.to, sub: p.group, group: p.group, keywords: p.to,
      })),
      hiddenPages: PAGE_OPTIONS.length - ok.length,
    };
  }, [targetRole]);

  /* ⚠️ ห้ามกรองแถวว่างก่อน buildPlaylist — `idx` ของหน้าที่ข้ามต้องตรงกับแถวบนจอ
     (แถวว่างคั่น = ป้าย ⛔ ไปติดผิดแถว) · แถวที่ยังไม่เลือกหน้า ไม่นับเป็น "จะถูกข้าม" (ตอนบันทึกถูกตัดทิ้งอยู่แล้ว) */
  const preview = useMemo(() => {
    const cfg = normalizeConfig(form);
    const items = form.items.map(it => ({ path: String(it?.path ?? '').trim(), sec: it?.sec ?? null }));
    const r = buildPlaylist(items, p => (targetRole ? canAccessPage(p, targetRole) : true), cfg.defaultSec);
    return { playable: r.playable, skipped: r.skipped.filter(s => s.path) };
  }, [form, targetRole]);
  const cycleSec = preview.playable.reduce((s, p) => s + p.sec, 0);

  const save = async () => {
    if (!selId || !canEdit) return;
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
    const myName = accounts.find(a => a.id === me?.user?.id)?.full_name || null;
    const payload = {
      user_id: selId,
      enabled: !!form.enabled,
      items,
      default_sec: secOf({ sec: form.default_sec }, ROT_LIMITS.defaultSec),
      pause_sec: Math.min(ROT_LIMITS.maxPauseSec, Math.max(ROT_LIMITS.minPauseSec, Math.round(Number(form.pause_sec) || ROT_LIMITS.defaultPauseSec))),
      reload_min: form.reload_min === '' || form.reload_min == null ? null : Number(form.reload_min),
      note: (form.note || '').trim() || null,
      updated_by: me?.user?.id || null,
      updated_by_name: myName,
    };
    const res = await supabase.from('display_rotations').upsert(payload, { onConflict: 'user_id' }).select('user_id');
    setSaving(false);
    if (!checkWriteRows(res, 'บันทึกรอบจอ')) return;
    toast.success(`บันทึกแล้ว — จอของบัญชีนี้จะใช้รอบใหม่เมื่อวนครบรอบปัจจุบัน (หรือรีเฟรชจอ)`);
    setDirty(false);
    setReloadKey(k => k + 1);
  };

  const removePlan = async () => {
    if (!selId || !plans[selId] || !canEdit) return;
    if (!window.confirm('ลบรอบของบัญชีนี้? จอจะหยุดวนและค้างที่หน้าปัจจุบัน')) return;
    const res = await supabase.from('display_rotations').delete().eq('user_id', selId).select('user_id');
    if (!checkWriteRows(res, 'ลบรอบจอ')) return;
    toast.success('ลบรอบแล้ว');
    setForm(EMPTY); setDirty(false); setReloadKey(k => k + 1);
  };

  const actions = selId && canEdit ? (
    <>
      {plans[selId] && <button type="button" onClick={removePlan} style={btnGhost}>🗑 ลบรอบ</button>}
      <button type="button" onClick={save} disabled={saving || !dirty} style={btnPrimary}>
        {saving ? 'กำลังบันทึก…' : '💾 บันทึก'}
      </button>
    </>
  ) : null;

  const planned = accounts.filter(a => plans[a.id]);

  return (
    <Page width="form">
      <PageHeader title="ตั้งค่าจอวนหน้า" icon="🔁"
        sub="เลือกบัญชีที่ใช้เปิดจอ แล้วตั้งว่าให้เปิดหน้าไหนวนบ้าง หน้าละกี่วินาที"
        actions={actions} />

      {loadErr && <div style={warnBox}>⚠ โหลดข้อมูลไม่ครบ: {loadErr} — รายการด้านล่างอาจไม่ครบ</div>}
      {!canEdit && <div style={infoBox}>ดูอย่างเดียว — ต้องมีสิทธิ์ “จอวนหน้า: ตั้งว่าบัญชีจอไหนเปิดหน้าอะไรวนบ้าง” (ตั้งที่ /permissions)</div>}

      <section className="card" style={{ padding: 16, marginBottom: 12 }}>
        <div style={lbl}>บัญชีที่ใช้เปิดจอ</div>
        <SearchSelect value={selId} options={accOptions} placeholder="— พิมพ์ค้นหาชื่อบัญชี / อีเมล —"
          onChange={({ id }) => pick(id)} />
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>
          ตั้งไว้แล้ว {planned.length} บัญชี
          {planned.map(a => (
            <button key={a.id} type="button" onClick={() => pick(a.id)}
              style={{ ...chip, ...(a.id === selId ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : null) }}>
              {plans[a.id].enabled ? '🔁' : '⏸'} {a.full_name || emails[a.id] || a.id.slice(0, 8)}
            </button>
          ))}
        </div>
      </section>

      {selAcc && (
        <>
          {targetRole !== 'display' && (
            <div style={warnBox}>
              ⚠ บัญชีนี้เป็น role <b>{roleLabel(targetRole)}</b> ไม่ใช่ “📺 จอแสดงผล” — จอจะถูก<b>ออกจากระบบเองเมื่อไม่มีใครแตะ ~35 นาที</b>
              {['leader', 'supervisor'].includes(targetRole) && ' และทุกสิ้นกะ +60 นาที'}
              {' '}(ยกเว้นตอนอยู่หน้า /tv) · การวนหน้าเองไม่นับเป็นการใช้งาน ⇒ แนะนำให้ใช้บัญชี role display กับจอแขวน
            </div>
          )}

          <section className="card" style={{ padding: 16, marginBottom: 12, display: 'grid', gap: 12 }}>
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
            <Field label="หมายเหตุ (เช่น จอนี้แขวนที่ไหน)">
              <input type="text" value={form.note || ''} disabled={!canEdit} maxLength={200}
                onChange={e => setF('note', e.target.value)} placeholder="เช่น จอห้องช่าง PD3 ผนังซ้าย" />
            </Field>
          </section>

          <section className="card" style={{ padding: 16, marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
              <div style={{ fontSize: 15, fontWeight: 800 }}>ลำดับหน้าที่วน</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                วนจริง {preview.playable.length} หน้า · ครบรอบ {fmtSec(cycleSec)}
                {preview.skipped.length > 0 && <span style={{ color: 'var(--red)', fontWeight: 700 }}> · จะถูกข้าม {preview.skipped.length} หน้า</span>}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', flexBasis: '100%' }}>
                เลือกได้ {pageOptions.length} หน้าที่บัญชีนี้ ({roleLabel(targetRole)}) เข้าได้
                {hiddenPages > 0 && ` · ซ่อน ${hiddenPages} หน้าที่ไม่มีสิทธิ์ (เปิดสิทธิ์ได้ที่ /permissions)`}
              </div>
            </div>

            {form.items.length === 0 && (
              <div style={{ fontSize: 13, color: 'var(--muted)', padding: '8px 0' }}>ยังไม่มีหน้าในรอบ — กด “+ เพิ่มหน้า”</div>
            )}

            <div style={{ display: 'grid', gap: 8 }}>
              {form.items.map((it, i) => {
                const base = it.path ? pathOnly(it.path) : '';
                const q = (String(it.path || '').match(/[?#].*$/) || [''])[0];   // ส่วนต่อท้าย (?dept=…)
                const skip = preview.skipped.find(s => s.idx === i);
                return (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '28px minmax(0,1fr)', gap: 8, alignItems: 'start',
                    padding: 10, borderRadius: 10, border: `1px solid ${skip ? 'var(--red)' : 'var(--border2)'}`, background: 'var(--bg2)' }}>
                    <div style={{ fontWeight: 800, fontSize: 14, paddingTop: 8, textAlign: 'center' }}>{i + 1}</div>
                    <div style={{ display: 'grid', gap: 6, minWidth: 0 }}>
                      <SearchSelect value={pageOptions.some(p => p.id === base) ? base : ''} options={pageOptions}
                        placeholder="— ค้นหาหน้า —" disabled={!canEdit}
                        onChange={({ id }) => setItem(i, { path: id ? `${id}${q}` : '' })} />
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                        <input type="text" value={q} disabled={!canEdit || !base} placeholder="ต่อท้ายลิงก์ (ไม่บังคับ) เช่น ?dept=production"
                          onChange={e => {
                            const v = e.target.value.trim();
                            setItem(i, { path: `${base}${v && !/^[?#]/.test(v) ? `?${v}` : v}` });
                          }}
                          style={{ flex: '1 1 220px', minWidth: 0, fontFamily: 'var(--font-mono, monospace)' }} />
                        <input type="number" min={ROT_LIMITS.minSec} max={ROT_LIMITS.maxSec} value={it.sec ?? ''} disabled={!canEdit}
                          placeholder={`${secOf({}, form.default_sec)} วิ`} title="วินาทีของหน้านี้ (ว่าง = ค่าตั้งต้น)"
                          onChange={e => setItem(i, { sec: e.target.value === '' ? null : e.target.value })} style={{ width: 100 }} />
                        {canEdit && (
                          <>
                            <button type="button" onClick={() => moveItem(i, -1)} disabled={i === 0} style={btnSm} title="เลื่อนขึ้น">▲</button>
                            <button type="button" onClick={() => moveItem(i, 1)} disabled={i === form.items.length - 1} style={btnSm} title="เลื่อนลง">▼</button>
                            <button type="button" onClick={() => setF('items', form.items.filter((_, j) => j !== i))} style={btnSm} title="เอาออก">✕</button>
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
              })}
            </div>

            {canEdit && form.items.length < ROT_LIMITS.maxItems && (
              <button type="button" onClick={() => setF('items', [...form.items, { path: '', sec: null }])}
                style={{ ...btnGhost, marginTop: 10 }}>+ เพิ่มหน้า</button>
            )}
          </section>

          {plans[selId]?.updated_at && (
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              แก้ล่าสุด {new Date(plans[selId].updated_at).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}
              {plans[selId].updated_by_name ? ` โดย ${plans[selId].updated_by_name}` : ''}
            </div>
          )}
        </>
      )}

      <div style={{ ...infoBox, marginTop: 12 }}>
        <b>วิธีใช้ที่จอ:</b> login ที่ทีวีด้วยบัญชีที่ตั้งไว้ → จอวนเองตั้งแต่หน้าแรกของรอบ · ชิปมุมขวาล่างบอกลำดับ/เวลาถัดไป
        มีปุ่ม ◀ ⏸ ▶▶ · มีคนแตะจอ = หยุดวนชั่วคราวตามที่ตั้ง แล้ววนต่อเอง · ใช้คู่กับ 🎮 รีโมทจอ (มือถือ) ได้
      </div>
    </Page>
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

const lbl = { fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 6 };
const warnBox = { padding: 12, marginBottom: 12, borderRadius: 10, fontSize: 13, lineHeight: 1.6,
  border: '1px solid var(--amber)', background: 'var(--card)', backgroundImage: 'linear-gradient(rgba(245,158,11,.10), rgba(245,158,11,.10))', color: 'var(--text)' };
const infoBox = { padding: 12, marginBottom: 12, borderRadius: 10, fontSize: 12, lineHeight: 1.7,
  border: '1px solid var(--border2)', background: 'var(--bg2)', color: 'var(--text2)' };
const chip = { marginLeft: 6, padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700,
  background: 'var(--bg2)', border: '1px solid var(--border2)', color: 'var(--text)' };
const btnPrimary = { padding: '8px 16px', borderRadius: 10, fontSize: 13, fontWeight: 800,
  background: 'var(--accent)', color: 'var(--accent-ink)', border: 'none' };
const btnGhost = { padding: '8px 14px', borderRadius: 10, fontSize: 13, fontWeight: 700,
  background: 'var(--bg2)', color: 'var(--text)', border: '1px solid var(--border2)' };
const btnSm = { minWidth: 34, height: 34, borderRadius: 8, fontSize: 12, fontWeight: 800,
  background: 'var(--card)', color: 'var(--text)', border: '1px solid var(--border2)' };
