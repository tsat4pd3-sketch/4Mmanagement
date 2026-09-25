/* ══ ⏱️ กฎเวลาเปลี่ยนรุ่นงานปั๊ม (press changeover / setup time) ═══════════════════════════
   ที่มา (user 2026-09-24): "งานปั๊มมันจะวุ่นวายกว่าที่ผ่านมา มันมี setup time change over die
   มาเป็นตัวแปร ถ้า die height ต่างกันเกินมันมีผล เลยต้องมีการ drag จัดแผนเพื่อหา optimization"
   user 2026-09-25: "ลุยก่อน diff die height เดี๋ยวถามมาให้" ⇒ แผงนี้คือ**ที่กรอกตัวเลขที่ช่างปั๊มตอบมา**
   (โค้ดจะไม่มีตัวเลขเวลา setup ฝังไว้เลย — ทุกค่ามาจากตารางนี้เท่านั้น)

   🔴 กฎความซื่อสัตย์ที่แผงนี้ต้องรักษา (สูตรอยู่ src/utils/pressSetup.js — ห้ามคิดเลขในนี้):
     · ยังไม่มีกฎ = เขียนบนจอว่า "ยังตอบไม่ได้" **ห้ามโชว์ 0 นาที**
     · แม่พิมพ์ที่ยังไม่กรอกความสูง = นับให้เห็น **ห้ามตัดออกจากการคำนวณเงียบๆ**
     · ตัวอย่างการจัดลำดับเป็น "ข้อเสนอ" ไม่ใช่คำสั่ง — คนวางแผนตัดสิน
   ══════════════════════════════════════════════════════════════════════════════════════ */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabaseDR } from '../supabaseClient';
import { toast } from './Toast';
import { checkWrite } from '../utils/dbWrite';
import { resolveSetupRule, sequenceSetup, orderByDieHeight, setupDataReadiness } from '../utils/pressSetup';

const COLS = 'id, scope_kind, scope_value, per_mm_sec, base_min, same_die_min, height_steps, note, is_active, updated_by_name, updated_at';
const SCOPES = [
  { key: 'global', label: '🏭 ทั้งโรงงาน (ค่าตั้งต้น)' },
  { key: 'line', label: '📍 เฉพาะไลน์' },
  { key: 'machine', label: '⚙️ เฉพาะเครื่อง' },
];
const scopeLabel = (r) => (r.scope_kind === 'global' ? 'ทั้งโรงงาน' : `${r.scope_kind === 'line' ? 'ไลน์' : 'เครื่อง'} ${r.scope_value || '—'}`);

const inp = { padding: '5px 8px', borderRadius: 6, fontSize: 12, border: '1px solid var(--border)', background: 'var(--bg3)', color: 'var(--text)', width: '100%', boxSizing: 'border-box' };
const btn = (bg, color = '#fff') => ({ padding: '5px 10px', borderRadius: 6, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', background: bg, color, border: '1px solid var(--border)', whiteSpace: 'nowrap' });
const numOrNull = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));

/* ปัดเศษนาทีให้อ่านรู้เรื่อง — นาทีที่มาจากวินาที/60 เป็นทศนิยมยาว (ห้ามโชว์ดิบ) */
const fmtMin = (v) => (v == null ? '—' : (Math.abs(v) < 10 ? Math.round(v * 10) / 10 : Math.round(v)).toLocaleString('th-TH'));

/* แปลงกฎผลของความสูงเป็นข้อความอ่านง่าย — อัตราต่อมม. + ขั้นบันได (ถ้ามี) */
function heightRuleText(rule) {
  const per = rule?.per_mm_sec;
  const list = Array.isArray(rule?.height_steps) ? rule.height_steps : [];
  const parts = [];
  if (per != null && per !== '') parts.push(`ต่างกัน 1 มม. = ${per} วินาที`);
  if (list.length) parts.push(list.map(s => (s.max_mm == null ? `เกินนั้น +${s.add_min ?? 0} น.` : `≤${s.max_mm} มม. +${s.add_min ?? 0} น.`)).join(' · '));
  return parts.length ? parts.join(' + ') : '🔴 ยังไม่ได้บอกผลของความสูง — จัดลำดับให้ไม่ได้ (ทุกลำดับจะเท่ากันหมด)';
}

/* ── ตัวแก้ขั้นบันได |Δ ความสูง| → นาทีที่บวกเพิ่ม ─────────────────────────────── */
function StepsEditor({ steps, onChange, disabled }) {
  const list = Array.isArray(steps) ? steps : [];
  const set = (i, k, v) => onChange(list.map((s, j) => (j === i ? { ...s, [k]: numOrNull(v) } : s)));
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      {list.map((s, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 5, fontSize: 11.5 }}>
          <span style={{ color: 'var(--muted)' }}>ต่างไม่เกิน</span>
          <input type="number" step="1" min="0" disabled={disabled} value={s.max_mm ?? ''} placeholder="∞"
            onChange={e => set(i, 'max_mm', e.target.value)} style={{ ...inp, width: 68 }} />
          <span style={{ color: 'var(--muted)' }}>มม. → +</span>
          <input type="number" step="1" min="0" disabled={disabled} value={s.add_min ?? ''} placeholder="0"
            onChange={e => set(i, 'add_min', e.target.value)} style={{ ...inp, width: 62 }} />
          <span style={{ color: 'var(--muted)' }}>นาที</span>
          {!disabled && (
            <button type="button" onClick={() => onChange(list.filter((_, j) => j !== i))} style={btn('var(--bg2)', 'var(--text2)')}>✕</button>
          )}
        </div>
      ))}
      {!disabled && (
        <button type="button" onClick={() => onChange([...list, { max_mm: null, add_min: null }])} style={{ ...btn('var(--bg2)', 'var(--text)'), width: 'fit-content' }}>
          + เพิ่มขั้น
        </button>
      )}
      <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>
        เว้น "ไม่เกิน" ว่าง = ขั้นสุดท้าย (ไม่จำกัด) · ระบบเรียงขั้นให้เองจากน้อยไปมาก
      </div>
    </div>
  );
}

export default function PressSetupRules({ dies = [], lineNames = [], canEdit = false, onClose }) {
  const [rows, setRows] = useState([]);
  const [state, setState] = useState('loading');   // loading | ok | missing | error
  const [draft, setDraft] = useState({});          // id → patch
  const [adding, setAdding] = useState(null);
  const [busy, setBusy] = useState(false);
  const [previewLine, setPreviewLine] = useState(lineNames[0] || '');

  const load = useCallback(async () => {
    const { data, error } = await supabaseDR.from('press_setup_rules').select(COLS).order('scope_kind');
    if (error) {
      // ⚠️ ไม่มีตาราง = ยังไม่ apply migration → บอกตรงๆ ห้านเงียบ (บทเรียน equipment_kind)
      setState(/press_setup_rules|schema cache|does not exist/i.test(error.message || '') ? 'missing' : 'error');
      setRows([]); return;
    }
    setState('ok'); setRows(data || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const active = useMemo(() => rows.filter(r => r.is_active !== false), [rows]);

  /* ── ความพร้อมของข้อมูล (ของจริง ไม่ปัดเศษความจริง) ── */
  const ready = useMemo(() => setupDataReadiness({
    dies: dies.map(d => ({ id: d.id, die_height_mm: d.ext?.die_height_mm })),
    presses: [], rules: rows,
  }), [dies, rows]);

  /* ── ตัวอย่าง: ลำดับที่เป็นอยู่ vs เรียงตามความสูง (เห็นว่าประหยัดได้กี่นาที) ── */
  const preview = useMemo(() => {
    if (!previewLine) return null;
    const rule = resolveSetupRule(rows, { lineName: previewLine });
    const list = dies
      .filter(d => d.line_name === previewLine && d.is_active !== false)
      .map(d => ({ id: d.id, machine_no: d.machine_no, die_height_mm: d.ext?.die_height_mm ?? null }));
    if (list.length < 2) return { rule, list, tooFew: true };
    const asIs = sequenceSetup(list, rule);
    const sorted = orderByDieHeight(list);
    return { rule, list, asIs, sortedSeq: sequenceSetup(sorted, rule), sorted };
  }, [dies, rows, previewLine]);

  const patch = (id, k, v) => setDraft(d => ({ ...d, [id]: { ...(d[id] || {}), [k]: v } }));
  const valOf = (r, k) => (draft[r.id] && k in draft[r.id] ? draft[r.id][k] : r[k]);

  const saveRow = async (r) => {
    const d = draft[r.id]; if (!d) return;
    const payload = {};
    /* 🔴 ว่าง = null = "ยังไม่รู้" ห้าม ?? 0 (0 = "เปลี่ยนแม่พิมพ์ใช้เวลา 0 นาที" = โกหกที่ดูน่าเชื่อ) */
    if ('per_mm_sec' in d) payload.per_mm_sec = numOrNull(d.per_mm_sec);
    if ('base_min' in d) payload.base_min = numOrNull(d.base_min);
    if ('same_die_min' in d) payload.same_die_min = numOrNull(d.same_die_min);
    if ('height_steps' in d) payload.height_steps = (d.height_steps || []).filter(s => s.add_min != null || s.max_mm != null);
    if ('note' in d) payload.note = d.note || null;
    setBusy(true);
    const res = await supabaseDR.from('press_setup_rules').update(payload).eq('id', r.id).select('id');
    setBusy(false);
    if (!checkWrite(res, `บันทึกกฎ ${scopeLabel(r)}`)) return;
    // 🔴 RLS ปฏิเสธ UPDATE = "สำเร็จ 0 แถว ไม่มี error" → ต้องนับแถว ห้ามขึ้นเขียวจาก !error
    if (!res.data?.length) { toast.error('บันทึกไม่ติด (0 แถว) — อาจไม่มีสิทธิ์แก้กฎนี้'); return; }
    toast.success('บันทึกแล้ว');
    setDraft(x => { const n = { ...x }; delete n[r.id]; return n; });
    load();
  };

  const addRule = async () => {
    const a = adding || {};
    if (a.scope_kind !== 'global' && !String(a.scope_value || '').trim()) {
      toast.error(a.scope_kind === 'line' ? 'เลือกไลน์ก่อน' : 'กรอกเลขเครื่องก่อน'); return;
    }
    const payload = {
      scope_kind: a.scope_kind || 'global',
      scope_value: a.scope_kind === 'global' ? null : String(a.scope_value).trim(),
      per_mm_sec: numOrNull(a.per_mm_sec),
      base_min: numOrNull(a.base_min),        // ว่าง = ยังไม่รู้ (ห้ามเป็น 0)
      same_die_min: numOrNull(a.same_die_min),
      height_steps: (a.height_steps || []).filter(s => s.add_min != null || s.max_mm != null),
      note: a.note || null,
    };
    setBusy(true);
    const res = await supabaseDR.from('press_setup_rules').insert([payload]).select('id');
    setBusy(false);
    if (!checkWrite(res, 'เพิ่มกฎ')) return;
    toast.success('เพิ่มกฎแล้ว'); setAdding(null); load();
  };

  const toggle = async (r) => {
    const on = r.is_active !== false;
    if (on && !window.confirm(`ปิดใช้กฎ "${scopeLabel(r)}" ?\n\nจอที่ใช้กฎนี้จะกลับไปเป็น "ยังไม่มีกฎ" (ตอบเวลา setup ไม่ได้) จนกว่าจะเปิดกลับ`)) return;
    const res = await supabaseDR.from('press_setup_rules').update({ is_active: !on }).eq('id', r.id).select('id');
    if (!checkWrite(res, 'เปลี่ยนสถานะกฎ')) return;
    if (!res.data?.length) { toast.error('เปลี่ยนสถานะไม่ติด (0 แถว) — อาจไม่มีสิทธิ์'); return; }
    load();
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.7 }}>
        เวลาเปลี่ยนรุ่นของงานปั๊ม <b>ขึ้นกับลำดับที่ผลิต</b> — เปลี่ยนจากแม่พิมพ์ที่ความสูงใกล้กัน
        ปรับ shut height น้อย เสียเวลาน้อย · ตัวเลขทั้งหมดในหน้านี้ <b>มาจากช่างปั๊ม</b> ไม่ใช่ค่าที่ระบบเดา
        {' '}(โค้ดไม่มีเวลา setup ฝังไว้เลย — ตารางว่าง = ทุกจอจะเขียนว่า "ยังตอบไม่ได้")
      </div>

      {state === 'loading' && <div style={{ fontSize: 12, color: 'var(--muted)' }}>กำลังโหลด…</div>}
      {state === 'missing' && (
        <div style={{ fontSize: 12, color: '#f59e0b' }}>
          ⚠️ ยังไม่ได้ apply migration <code>20260925_press_die_height_setup_dr.sql</code> (DR · Product DB) — แจ้ง admin
        </div>
      )}
      {state === 'error' && (
        <div style={{ fontSize: 12, color: '#ef4444' }}>❌ โหลดกฎไม่ได้ (คนละเรื่องกับ "ยังไม่มีกฎ") — ลองใหม่อีกครั้ง</div>
      )}

      {/* ความพร้อมของข้อมูล — บอกตรงๆ ว่ายังขาดอะไร */}
      <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '9px 12px', fontSize: 12, lineHeight: 1.8 }}>
        <b>📋 ความพร้อมของข้อมูล</b><br />
        กฎที่ใช้งานอยู่ <b>{ready.ruleCount}</b> ข้อ ·
        แม่พิมพ์ในขอบเขตนี้ <b>{ready.dieTotal}</b> ตัว — กรอกความสูงแล้ว <b>{ready.dieWithHeight}</b>
        {ready.dieMissing > 0 && <span style={{ color: '#f59e0b' }}> · ยังไม่กรอก <b>{ready.dieMissing}</b> ตัว</span>}
        <br />
        {ready.canPlan
          ? <span style={{ color: 'var(--accent)' }}>✅ เริ่มเทียบลำดับได้แล้ว (ยิ่งกรอกความสูงครบ ตัวเลขยิ่งตรง)</span>
          : <span style={{ color: '#f59e0b' }}>⚠️ ยังจัดลำดับให้ไม่ได้ — ต้องมีกฎที่บอก "ผลของความสูง" + รู้ความสูงอย่างน้อย 2 ตัว</span>}
        {/* 2 คำถามคนละเรื่อง: จัดลำดับได้ (ไม่ต้องรู้เวลาฐาน) vs ตอบเวลารวมได้ (ต้องรู้) */}
        {!ready.canTotal && (
          <div style={{ color: 'var(--muted)' }}>
            ℹ️ ยังไม่มีกฎไหนกรอก <b>เวลาฐาน</b> ⇒ จอจะบอก "เวลารวมทั้งรอบ" ไม่ได้ (แต่เทียบลำดับได้)
          </div>
        )}
      </div>

      {/* ตารางกฎ */}
      {state === 'ok' && (
        <div style={{ display: 'grid', gap: 8 }}>
          {rows.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              ยังไม่มีกฎในทะเบียน — {canEdit ? 'กด "+ เพิ่มกฎ" เพื่อกรอกตัวเลขที่ช่างปั๊มให้มา' : 'ให้ผู้มีสิทธิ์แก้ทะเบียนเป็นคนกรอก'}
            </div>
          )}
          {rows.map(r => {
            const off = r.is_active === false;
            const dirty = !!draft[r.id];
            return (
              <div key={r.id} style={{
                background: 'var(--card)', border: `1px solid ${dirty ? 'rgba(245,158,11,0.5)' : 'var(--border)'}`,
                borderRadius: 10, padding: '10px 12px', opacity: off ? 0.55 : 1,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                  <b style={{ fontSize: 13 }}>{scopeLabel(r)}</b>
                  {off && <span style={{ fontSize: 11, color: 'var(--muted)' }}>(ปิดใช้)</span>}
                  <span className="spacer" style={{ flex: 1 }} />
                  {r.updated_by_name && (
                    <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>แก้ล่าสุด: {r.updated_by_name}</span>
                  )}
                  {canEdit && <>
                    {dirty && <button onClick={() => saveRow(r)} disabled={busy} style={btn('var(--accent)', '#071008')}>💾 บันทึก</button>}
                    <button onClick={() => toggle(r)} style={btn('var(--bg2)', 'var(--text2)')}>{off ? 'เปิดใช้' : 'ปิดใช้'}</button>
                  </>}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, alignItems: 'start' }}>
                  {/* ⭐ ตัวแปรหลักจากช่างปั๊ม: ต่างกัน 1 มม. = กี่วินาที (25/09 = 1 วินาที) */}
                  <label style={{ fontSize: 11, color: 'var(--muted)' }}>
                    ต่างกัน 1 มม. = กี่วินาที
                    <input type="number" step="0.1" min="0" disabled={!canEdit} value={valOf(r, 'per_mm_sec') ?? ''}
                      placeholder="ยังไม่รู้" onChange={e => patch(r.id, 'per_mm_sec', e.target.value)} style={{ ...inp, marginTop: 3 }} />
                  </label>
                  {/* 🔴 ว่าง = "ยังไม่รู้" ไม่ใช่ 0 — placeholder ต้องเขียนให้ชัด ไม่งั้นคนอ่านว่าไม่เสียเวลา */}
                  <label style={{ fontSize: 11, color: 'var(--muted)' }}>
                    เวลาฐาน (เปลี่ยนแม่พิมพ์คนละตัว) นาที
                    <input type="number" step="1" min="0" disabled={!canEdit} value={valOf(r, 'base_min') ?? ''}
                      placeholder="ยังไม่รู้ = เว้นว่าง" onChange={e => patch(r.id, 'base_min', e.target.value)} style={{ ...inp, marginTop: 3 }} />
                  </label>
                  <label style={{ fontSize: 11, color: 'var(--muted)' }}>
                    แม่พิมพ์ตัวเดิม (เปลี่ยนแค่ล็อต) นาที
                    <input type="number" step="1" min="0" disabled={!canEdit} value={valOf(r, 'same_die_min') ?? ''}
                      placeholder="ยังไม่รู้ = เว้นว่าง" onChange={e => patch(r.id, 'same_die_min', e.target.value)} style={{ ...inp, marginTop: 3 }} />
                  </label>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 3 }}>
                      ผลของความสูง — <span style={{ color: 'var(--text2)' }}>
                        {heightRuleText({ per_mm_sec: valOf(r, 'per_mm_sec'), height_steps: valOf(r, 'height_steps') })}
                      </span>
                    </div>
                    <div style={{ fontSize: 10.5, color: 'var(--muted)', marginBottom: 4 }}>
                      ขั้นบันไดด้านล่างเป็น <b>ของเสริม</b> (บวกทับอัตราต่อมม.) — ไว้ใส่เงื่อนไขแบบขั้น เช่น "เกิน 200 มม. ต้องเปลี่ยนบล็อกรอง +30 น." · ไม่มีก็เว้นว่างได้
                    </div>
                    <StepsEditor steps={valOf(r, 'height_steps')} disabled={!canEdit}
                      onChange={v => patch(r.id, 'height_steps', v)} />
                  </div>
                  <label style={{ fontSize: 11, color: 'var(--muted)', gridColumn: '1 / -1' }}>
                    หมายเหตุ (ใครให้ตัวเลขนี้ / วัดจากอะไร)
                    <input disabled={!canEdit} value={valOf(r, 'note') ?? ''} placeholder="เช่น ช่างปั๊มกะเช้าให้ตัวเลข 25/09"
                      onChange={e => patch(r.id, 'note', e.target.value)} style={{ ...inp, marginTop: 3 }} />
                  </label>
                </div>
              </div>
            );
          })}

          {canEdit && (adding ? (
            <div style={{ background: 'var(--bg2)', border: '1px dashed var(--border2)', borderRadius: 10, padding: '10px 12px', display: 'grid', gap: 8 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
                <label style={{ fontSize: 11, color: 'var(--muted)' }}>ขอบเขต
                  <select value={adding.scope_kind || 'global'} onChange={e => setAdding(a => ({ ...a, scope_kind: e.target.value, scope_value: '' }))} style={{ ...inp, marginTop: 3 }}>
                    {SCOPES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                </label>
                {adding.scope_kind === 'line' && (
                  <label style={{ fontSize: 11, color: 'var(--muted)' }}>ไลน์
                    <select value={adding.scope_value || ''} onChange={e => setAdding(a => ({ ...a, scope_value: e.target.value }))} style={{ ...inp, marginTop: 3 }}>
                      <option value="">— เลือกไลน์ —</option>
                      {lineNames.map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </label>
                )}
                {adding.scope_kind === 'machine' && (
                  <label style={{ fontSize: 11, color: 'var(--muted)' }}>เลขเครื่อง
                    <input value={adding.scope_value || ''} onChange={e => setAdding(a => ({ ...a, scope_value: e.target.value.toUpperCase() }))}
                      placeholder="เช่น P-01" style={{ ...inp, marginTop: 3, fontFamily: 'monospace' }} />
                  </label>
                )}
                <label style={{ fontSize: 11, color: 'var(--muted)' }}>ต่างกัน 1 มม. = กี่วินาที
                  <input type="number" step="0.1" min="0" value={adding.per_mm_sec ?? ''} placeholder="เช่น 1"
                    onChange={e => setAdding(a => ({ ...a, per_mm_sec: e.target.value }))} style={{ ...inp, marginTop: 3 }} />
                </label>
                <label style={{ fontSize: 11, color: 'var(--muted)' }}>เวลาฐาน (นาที)
                  <input type="number" min="0" value={adding.base_min ?? ''} placeholder="ยังไม่รู้ = เว้นว่าง"
                    onChange={e => setAdding(a => ({ ...a, base_min: e.target.value }))} style={{ ...inp, marginTop: 3 }} />
                </label>
                <label style={{ fontSize: 11, color: 'var(--muted)' }}>ตัวเดิม เปลี่ยนล็อต (นาที)
                  <input type="number" min="0" value={adding.same_die_min ?? ''} placeholder="ยังไม่รู้ = เว้นว่าง"
                    onChange={e => setAdding(a => ({ ...a, same_die_min: e.target.value }))} style={{ ...inp, marginTop: 3 }} />
                </label>
              </div>
              <StepsEditor steps={adding.height_steps} onChange={v => setAdding(a => ({ ...a, height_steps: v }))} />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={() => setAdding(null)} style={btn('var(--bg2)', 'var(--text2)')}>ยกเลิก</button>
                <button onClick={addRule} disabled={busy} style={btn('var(--accent)', '#071008')}>บันทึกกฎใหม่</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setAdding({ scope_kind: rows.some(r => r.scope_kind === 'global') ? 'line' : 'global', height_steps: [] })}
              style={{ ...btn('var(--bg2)', 'var(--text)'), width: 'fit-content' }}>+ เพิ่มกฎ</button>
          ))}
        </div>
      )}

      {/* ตัวอย่างผลของการจัดลำดับ — ข้อเสนอ ไม่ใช่คำสั่ง */}
      {state === 'ok' && lineNames.length > 0 && (
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', fontSize: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
            <b>🧪 ลองเทียบลำดับ</b>
            <select value={previewLine} onChange={e => setPreviewLine(e.target.value)} style={{ ...inp, width: 'auto' }}>
              {lineNames.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          {!preview?.rule && <div style={{ color: '#f59e0b' }}>⚠️ ไลน์นี้ยังไม่มีกฎ (ของไลน์เองหรือของทั้งโรงงาน) — เทียบเวลาไม่ได้</div>}
          {preview?.rule && preview.tooFew && <div style={{ color: 'var(--muted)' }}>ไลน์นี้มีแม่พิมพ์ที่ใช้งานอยู่น้อยกว่า 2 ตัว — ไม่มีลำดับให้เทียบ</div>}
          {preview?.rule && !preview.tooFew && (() => {
            /* ⭐ เทียบด้วย varMin = "ส่วนที่ขึ้นกับลำดับ" (ผลของความสูง) ไม่ใช่เวลารวม
               เพราะลำดับที่สลับกันบนของชุดเดิมมีจำนวนครั้งเปลี่ยนเท่ากัน ⇒ เวลาฐานหักกลบ
               ⇒ ตอบ "ลำดับไหนดีกว่า" ได้แม้ยังไม่รู้เวลาฐาน (base_min = null) */
            const a = preview.asIs.varMin, b = preview.sortedSeq.varMin;
            const save = a != null && b != null ? a - b : null;
            const tot = preview.sortedSeq.totalMin;
            return (
              <div style={{ lineHeight: 1.9 }}>
                เวลาปรับ shut height ตามลำดับทะเบียนตอนนี้ ({preview.list.length} ตัว) = <b>{fmtMin(a)}</b> นาที ·
                เรียงตามความสูง = <b>{fmtMin(b)}</b> นาที
                {save != null && (
                  <div style={{ color: save > 0.05 ? 'var(--accent)' : 'var(--muted)', fontWeight: 700 }}>
                    {save > 0.05 ? `⇒ จัดลำดับใหม่ประหยัดได้ ~${fmtMin(save)} นาที/รอบ` : '⇒ ลำดับที่เป็นอยู่ดีอยู่แล้ว (เรียงใหม่ไม่ช่วย)'}
                  </div>
                )}
                {preview.sortedSeq.baseUnknown && (
                  <div style={{ color: 'var(--muted)' }}>
                    ℹ️ ยังไม่รู้ <b>เวลาฐาน</b> (ยกแม่พิมพ์ลง-ขึ้น-จูน) จึงบอก "เวลารวมทั้งรอบ" ไม่ได้ —
                    แต่เทียบลำดับได้ เพราะทุกลำดับเปลี่ยนแม่พิมพ์ {preview.sortedSeq.changeCount} ครั้งเท่ากัน เวลาฐานจึงหักกลบ
                  </div>
                )}
                {tot != null && <div style={{ color: 'var(--text2)' }}>เวลารวมทั้งรอบ (รวมเวลาฐาน) = <b>{fmtMin(tot)}</b> นาที</div>}
                {preview.sortedSeq.unknownCount > 0 && (
                  <div style={{ color: '#f59e0b' }}>
                    ⚠️ มี {preview.sortedSeq.unknownCount} ช่วงที่ประเมินผลความสูงไม่ได้ (ยังไม่กรอกความสูง) — ตัวเลขนี้ <b>ต่ำกว่าความจริง</b>
                  </div>
                )}
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                  เป็นการทดลองบนทะเบียนทั้งไลน์ (ไม่ใช่คิวงานจริง) — ใช้ดูว่า "ลำดับมีผลแค่ไหน" ก่อนเอาไปจัดแผนจริง
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {onClose && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={btn('var(--bg2)', 'var(--text)')}>ปิด</button>
        </div>
      )}
    </div>
  );
}
