/* ══ ♻️ 5S → Setting — ตาราง + ฟอร์มของแต่ละส่วน (ยกจากระบบ Core 27/11 · loop smf01) ══════════════════════════
   ส่วน: พื้นที่ (act02_area) · ทีม (act02_team) · หัวข้อตรวจ (act02_checklist) · แผนตรวจ (act02_audit_plan) · เกณฑ์ผ่าน (act02_setting)
   · หน้า (Activity5s.jsx) ถือ state: แถวที่เลือก · ป๊อปอัป · ปี · คำค้น — ไฟล์นี้บอกว่าแต่ละส่วนมีคอลัมน์/ช่องอะไร
   · คนในทีม = เลือกจากทะเบียน employees (<PersonSelect> · 28/11) เก็บรหัส + ชื่อ snapshot (ไม่ผูก FK — แถวเก่าที่คนไม่อยู่ในทะเบียนยังอยู่ได้) */
import { useEffect, useState } from 'react';
import { supabase } from '../../supabaseClient';
import PersonSelect from '../../components/PersonSelect';
import { tr } from '../../utils/i18n';
import { monthsShort, yearDisplay } from '../../utils/dateFormat';
import { toast } from '../../components/Toast';
import { checkWrite } from '../../utils/dbWrite';
import { stamp } from './sections';

/* ── ตาราง (คลิกแถว = เลือก · ดับเบิลคลิก = แก้ไข) ─────────────────────────────────────────── */
const th = { textAlign: 'left', padding: '8px 10px', fontSize: 12, color: 'var(--muted)', fontWeight: 700, borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: 'var(--bg3)' };
const td = { padding: '7px 10px', fontSize: 13, borderTop: '1px solid var(--border)' };

export function Table5s({ cfg, rows, ctx, selected, onSelect, onOpen, empty }) {
  return (
    <div style={{ overflow: 'auto', maxHeight: '66vh', border: '1px solid var(--border)', borderRadius: 'var(--r-md)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>{cfg.columns.map(c => <th key={c.key} style={{ ...th, width: c.width, textAlign: c.align || 'left' }}>{tr(c.label)}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const on = selected === r[cfg.key];
            return (
              <tr key={r[cfg.key]} onClick={() => onSelect(on ? null : r[cfg.key])} onDoubleClick={() => onOpen(r)}
                style={{ cursor: 'pointer', background: on ? 'var(--bg2-surf)' : undefined, outline: on ? '1px solid var(--accent)' : undefined, opacity: r.status === 'Inactive' ? 0.55 : 1 }}>
                {cfg.columns.map(c => (
                  <td key={c.key} style={{ ...td, textAlign: c.align || 'left', fontFamily: c.mono ? 'monospace' : undefined, fontWeight: c.mono ? 700 : undefined }}>
                    {c.render ? c.render(r, ctx) : (r[c.key] ?? '')}
                  </td>
                ))}
              </tr>
            );
          })}
          {rows.length === 0 && <tr><td colSpan={cfg.columns.length} style={{ ...td, color: 'var(--muted)', padding: 16 }}>{empty}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

/* ── ป๊อปอัปเพิ่ม / แก้ไข (ไม่ปิดเมื่อคลิกพื้นหลัง — มีช่องกรอก) ──────────────────────────── */
const lab = { fontSize: 12, color: 'var(--muted)', marginBottom: 4, display: 'block' };
const inp = { width: '100%', padding: '7px 9px', borderRadius: 'var(--ctl-r)', border: '1px solid var(--border)', background: 'var(--bg3)', color: 'var(--text)', fontSize: 13 };

export function FormModal({ cfg, mode, value, onChange, onSave, onClose, busy, areas }) {
  const set = (k, v) => onChange({ ...value, [k]: v });
  const shown = cfg.fields.filter(f => !f.showIf || f.showIf(value));
  return (
    <div className="overlay">
      <div className="modal" style={{ width: 'min(96vw, 560px)', maxWidth: 560, maxHeight: '94vh', overflowY: 'auto' }}>
        <h3 style={{ marginTop: 0, marginBottom: 14, fontSize: 17, color: 'var(--text)' }}>{mode === 'add' ? tr('เพิ่ม') : tr('แก้ไข')}</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))', gap: 12 }}>
          {shown.map(f => (
            <div key={f.key} style={f.wide ? { gridColumn: '1 / -1' } : undefined}>
              <label style={lab}>{tr(f.label)}{f.required ? ' *' : ''}</label>
              {f.type === 'select' ? (
                <select style={inp} value={value[f.key] ?? ''} onChange={e => set(f.key, e.target.value)}>
                  {!f.required && <option value="">-</option>}
                  {f.options.map(o => <option key={o.value} value={o.value}>{tr(o.label)}</option>)}
                </select>
              ) : f.type === 'person' ? (
                /* 👤 เลือกจากทะเบียนพนักงาน (UI §5.1.2 picker กลาง) — เก็บรหัส + ชื่อ snapshot · คนเดิมที่ไม่อยู่ในทะเบียนยังโชว์ชื่อเดิม */
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <PersonSelect source="employees" allowFree={false} value={value.employee_name || ''} disabled={mode === 'edit' && f.lockOnEdit}
                      onChange={(p) => onChange(v => ({ ...v, employee_code: p.employee_code || '', employee_name: p.employee_code ? p.name : '' }))} />
                  </div>
                  <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 13, color: value.employee_code ? 'var(--text)' : 'var(--muted)', minWidth: 64 }}>{value.employee_code || '-'}</span>
                </div>
              ) : f.type === 'area' ? (
                <select style={inp} value={value[f.key] ?? ''} onChange={e => set(f.key, e.target.value)}>
                  <option value="">-</option>
                  {areas.map(a => <option key={a.act_area} value={a.act_area}>{a.area_code} {a.act_area_name}</option>)}
                </select>
              ) : f.type === 'month' ? (
                <select style={inp} value={value[f.key] ?? ''} onChange={e => set(f.key, e.target.value)}>
                  {monthsShort().map((m, i) => <option key={m} value={String(i + 1)}>{m}</option>)}
                </select>
              ) : (
                <input style={{ ...inp, fontFamily: f.key.endsWith('_code') ? 'monospace' : undefined }} type={f.type === 'number' ? 'number' : 'text'}
                  value={value[f.key] ?? ''} disabled={mode === 'edit' && f.lockOnEdit} placeholder={f.placeholder ? tr(f.placeholder) : undefined}
                  onChange={e => set(f.key, e.target.value)} />
              )}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button className="pg-btn" onClick={onClose} disabled={busy}>{tr('ยกเลิก')}</button>
          <button className="pg-btn" onClick={onSave} disabled={busy} style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>{busy ? tr('กำลังบันทึก…') : tr('บันทึก')}</button>
        </div>
      </div>
    </div>
  );
}

/* ── เกณฑ์ผ่านรายปี: Self Audit / Committee Audit (%) · act02_setting pass_self:<ปี> / pass_committee:<ปี> ── */
export function TargetForm({ year, canEdit }) {
  const [vals, setVals] = useState({ self: '', committee: '' });
  const [loaded, setLoaded] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    let alive = true;
    supabase.from('act02_setting').select('setting_key, setting_value').then(({ data, error }) => {
      if (!alive) return;
      if (error) { setErr(error.message); return; }
      const m = new Map((data || []).map(r => [r.setting_key, r.setting_value]));
      const base = m.get('pass_percent') ?? '80';
      const v = { self: m.get(`pass_self:${year}`) ?? m.get('pass_self') ?? base, committee: m.get(`pass_committee:${year}`) ?? m.get('pass_committee') ?? base };
      setVals(v); setLoaded(v); setErr('');
    });
    return () => { alive = false; };
  }, [year]);

  const ok = (v) => v !== '' && Number(v) >= 0 && Number(v) <= 100;
  const save = async () => {
    if (!ok(vals.self) || !ok(vals.committee)) { toast.error(tr('เกณฑ์ผ่าน 0–100%')); return; }
    setBusy(true);
    const res = await supabase.from('act02_setting').upsert([
      { setting_key: `pass_self:${year}`, setting_value: String(Number(vals.self)), ...stamp() },
      { setting_key: `pass_committee:${year}`, setting_value: String(Number(vals.committee)), ...stamp() },
    ], { onConflict: 'setting_key' }).select('setting_key');
    setBusy(false);
    if (!checkWrite(res, tr('บันทึกเกณฑ์ผ่าน'))) return;
    if (!res.data?.length) { toast.error(tr('บันทึกไม่ติด (0 แถว) — อาจไม่มีสิทธิ์แก้ 5S')); return; }
    setLoaded(vals); toast.success(`${tr('บันทึกเกณฑ์ผ่านปี')} ${yearDisplay(year)} ${tr('แล้ว')}`);
  };
  const dirty = loaded && (loaded.self !== vals.self || loaded.committee !== vals.committee);
  if (err) return <div style={{ color: 'var(--red)', fontSize: 13 }}>{err}</div>;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end' }}>
      {[['self', 'Self Audit (%)'], ['committee', 'Committee Audit (%)']].map(([k, label]) => (
        <div key={k} style={{ width: 200 }}>
          <label style={lab}>{label}</label>
          <input style={inp} type="number" min="0" max="100" value={vals[k]} disabled={!canEdit} onChange={e => setVals(v => ({ ...v, [k]: e.target.value }))} />
        </div>
      ))}
      {canEdit && <button className="pg-btn" onClick={save} disabled={busy || !dirty} style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>{busy ? tr('กำลังบันทึก…') : tr('บันทึก')}</button>}
    </div>
  );
}
