/* 🛠️ ช่อง Why-Why ของใบซ่อม MO (TPM ข้อ 5 "ปิดวงจรซ่อม" · 2026-11-27) · 📄 docs/modules/tpm.md
   ใช้ที่ฟอร์มขั้นลงผลซ่อม + ขั้นปิดใบใน /mtn-repair (ช่องชุดเดียวกัน ผู้ปิดใบเติมได้ถ้าช่างยังไม่กรอก)
   · บังคับหรือไม่ = `closeGate()` (utils/tpm.js) — เฉพาะเครื่องเกรด A · ที่นี่แค่วาดช่อง + บอกเหตุผลจากด่าน
   · ค่า: form.failure_mode · form.why_why (array) · form.prevent_action · form.prevent_note */
import { tr } from '../utils/i18n';
import { PREVENT_ACTIONS, WHY_MIN, WHY_MAX, whyList } from '../utils/tpm';

const inp = { width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box' };
const lbl = { display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 4 };

export default function WhyWhyFields({ form, set, gate, grade }) {
  const whys = whyList(form.why_why);
  const rows = Array.from({ length: Math.min(WHY_MAX, Math.max(WHY_MIN, whys.length + (whys[whys.length - 1] ? 1 : 0))) }, (_, i) => whys[i] || '');
  const setWhy = (i, v) => { const next = [...rows]; next[i] = v; set('why_why', next); };
  const tone = gate?.required ? (gate.ok ? 'var(--green)' : 'var(--red)') : 'var(--border)';
  return (
    <div style={{ border: `1px solid ${tone}`, borderRadius: 'var(--r-md)', padding: 10, display: 'grid', gap: 8 }}>
      <div style={{ fontSize: 13, fontWeight: 800 }}>
        🔁 {tr('ป้องกันเกิดซ้ำ (Why-Why)')}
        <span style={{ fontWeight: 600, fontSize: 12, color: gate?.required ? 'var(--red)' : 'var(--muted)', marginLeft: 6 }}>
          {grade.loading ? tr('กำลังอ่านเกรดเครื่อง…') : tr(gate?.why || '')}
        </span>
      </div>
      {gate?.required && !gate.ok && (
        <div style={{ fontSize: 12, color: 'var(--red)' }}>{tr('ยังขาด')}: {gate.missing.map(m => tr(m)).join(' · ')}</div>
      )}
      <label><span style={lbl}>{tr('อาการเสีย (failure mode)')}</span>
        <input value={form.failure_mode || ''} onChange={e => set('failure_mode', e.target.value)} style={inp}
          placeholder={tr('เช่น ลูกปืนสึก / สายรั่ว / น็อตหลวม / มอเตอร์ร้อน')} /></label>
      <div>
        <span style={lbl}>{tr('ทำไม-ทำไม (ไล่จากอาการไปถึงต้นเหตุ อย่างน้อย')} {WHY_MIN} {tr('ชั้น)')}</span>
        <div style={{ display: 'grid', gap: 6 }}>
          {rows.map((w, i) => (
            <input key={i} value={w} onChange={e => setWhy(i, e.target.value)} style={inp} placeholder={`${tr('ทำไม')} ${i + 1}`} />
          ))}
        </div>
      </div>
      <div className="mgrid" style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 8 }}>
        <label><span style={lbl}>{tr('ป้องกันเกิดซ้ำโดย')}</span>
          <select value={form.prevent_action || ''} onChange={e => set('prevent_action', e.target.value)} style={inp}>
            <option value="">{tr('— เลือก —')}</option>
            {PREVENT_ACTIONS.map(p => <option key={p.key} value={p.key}>{tr(p.label)}</option>)}
          </select></label>
        <label><span style={lbl}>{form.prevent_action === 'none' ? tr('เหตุผลที่ไม่ต้องทำเพิ่ม') : tr('ทำอะไร (แผน/จุดตรวจ/OPL ไหน)')}</span>
          <input value={form.prevent_note || ''} onChange={e => set('prevent_note', e.target.value)} style={inp} /></label>
      </div>
    </div>
  );
}
