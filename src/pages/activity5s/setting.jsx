/* ══ ♻️ 5S → Setting — ตาราง + ฟอร์มของแต่ละส่วน (ยกจากระบบ Core 27/11 · loop smf01) ══════════════════════════
   ส่วน: พื้นที่ (act02_area) · ทีม (act02_team) · หัวข้อตรวจ (act02_checklist) · แผนตรวจ (act02_audit_plan) · กลยุทธ์ = ของกลาง `useStrategySetting` (28/11 แทนเกณฑ์ผ่าน)
   · หน้า (Activity5s.jsx) ถือ state: แถวที่เลือก · ป๊อปอัป · ปี · คำค้น — ไฟล์นี้บอกว่าแต่ละส่วนมีคอลัมน์/ช่องอะไร
   · คนในทีม = เลือกจากทะเบียน employees (<PersonSelect> · 28/11) เก็บรหัส + ชื่อ snapshot (ไม่ผูก FK — แถวเก่าที่คนไม่อยู่ในทะเบียนยังอยู่ได้) */
import PersonSelect from '../../components/PersonSelect';
import { tr } from '../../utils/i18n';
import { monthsShort } from '../../utils/dateFormat';

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

export function FormModal({ cfg, mode, value, onChange, onSave, onClose, busy, areas = [] }) {
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
                  {(typeof f.options === 'function' ? f.options(value) : f.options).map(o => <option key={o.value} value={o.value}>{tr(o.label)}</option>)}
                </select>
              ) : f.type === 'person' ? (
                /* 👤 เลือกจากทะเบียนพนักงาน (UI §5.1.2 picker กลาง) — เก็บรหัส + ชื่อ snapshot · คนเดิมที่ไม่อยู่ในทะเบียนยังโชว์ชื่อเดิม */
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* ชื่อคอลัมน์ปลายทางกำหนดได้ (codeKey/nameKey · ค่าเดิม = employee_code/employee_name) — ใช้ร่วมกับกิจกรรมอื่น เช่น เจ้าของงานในแผนงาน */}
                    <PersonSelect source="employees" allowFree={false} value={value[f.nameKey || 'employee_name'] || ''} disabled={mode === 'edit' && f.lockOnEdit}
                      onChange={(p) => onChange(v => ({ ...v, [f.codeKey || 'employee_code']: p.employee_code || '', [f.nameKey || 'employee_name']: p.employee_code ? p.name : '' }))} />
                  </div>
                  <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 13, color: value[f.codeKey || 'employee_code'] ? 'var(--text)' : 'var(--muted)', minWidth: 64 }}>{value[f.codeKey || 'employee_code'] || '-'}</span>
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
                <input style={{ ...inp, fontFamily: f.key.endsWith('_code') ? 'monospace' : undefined }} type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
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
