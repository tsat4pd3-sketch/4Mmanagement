/* ═══ NpiUi — ชิ้นส่วน UI ร่วมของโมดูล NPI (/npi + component ย่อย) ═══
   เก็บไว้ที่เดียวให้ทุกแท็บหน้าตาเดียวกัน — Modal (ไม่ปิดจาก backdrop ตาม UI §5) · Pill · ไฟสี · ฟิลด์ · ปุ่ม
   + ตัวอัปโหลดไฟล์เข้า bucket npi-files (PDF/รูป/office ≤20MB · รูปบีบ 2560px ก่อน) */
import { LIGHT } from '../utils/npi';
import { uploadAttachment, removeAttachment, attachFileName } from '../utils/fileAttach';
import FilePickBase from './FilePick';

export const inp = {
  width: '100%', padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)',
  background: 'var(--bg)', color: 'var(--text)', fontSize: 13, boxSizing: 'border-box',
};
export const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: 14 };
export const btn = (bg = 'var(--accent)', fg = 'var(--accent-ink)') => ({
  padding: '6px 12px', borderRadius: 8, border: 'none', background: bg, color: fg, fontSize: 12, fontWeight: 800, cursor: 'pointer',
});
export const ghost = {
  padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
};
export const thSt = { padding: '7px 9px', fontSize: 11, fontWeight: 800, color: 'var(--muted)', textAlign: 'left', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)' };
export const tdSt = { padding: '7px 9px', fontSize: 12, color: 'var(--text2)', borderTop: '1px solid var(--border)', verticalAlign: 'top' };

export function Field({ label, hint, children, span }) {
  return (
    <div style={span ? { gridColumn: `span ${span}` } : undefined}>
      <label style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, display: 'block', marginBottom: 4 }}>
        {label}{hint && <span style={{ fontWeight: 400, opacity: 0.75 }}> · {hint}</span>}
      </label>
      {children}
    </div>
  );
}

export function Pill({ label, color = '#94a3b8', title, small }) {
  return (
    <span title={title} style={{ display: 'inline-block', padding: small ? '0 6px' : '1px 8px', borderRadius: 999,
      fontSize: small ? 10.5 : 11.5, fontWeight: 800, color, background: `${color}22`, border: `1px solid ${color}66`, whiteSpace: 'nowrap' }}>
      {label}
    </span>
  );
}

/** ไฟสี Andon: กระพริบเฉพาะแดง (UI §2) */
export function LightDot({ light = 'grey', size = 12, title }) {
  const c = (LIGHT[light] || LIGHT.grey).color;
  return (
    <span title={title || LIGHT[light]?.label} className={light === 'red' ? 'dt-alarm-blink' : undefined}
      style={{ display: 'inline-block', width: size, height: size, borderRadius: '50%', background: c,
        boxShadow: light === 'grey' ? 'none' : `0 0 0 3px ${c}33`, flexShrink: 0 }} />
  );
}

/** select จาก meta { key: {label,color} } */
export function MetaSelect({ value, onChange, meta, disabled, style, exclude = [] }) {
  return (
    <select value={value || ''} onChange={e => onChange(e.target.value)} disabled={disabled} style={{ ...inp, ...style }}>
      {Object.entries(meta).filter(([k]) => !exclude.includes(k)).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
    </select>
  );
}

/** Modal ฟอร์ม — ⚠️ ไม่ปิดจาก backdrop (UI-CONVENTIONS §5: เผลอแตะแล้วข้อมูลหายทั้งฟอร์ม) */
export function Modal({ title, onClose, children, width = 640, footer }) {
  return (
    <div className="overlay" /* ไม่ปิดจาก backdrop — ห้ามใส่ onClick={onClose} ที่ชั้นนี้ */>
      <div className="modal" onClick={e => e.stopPropagation()}
        style={{ width: `min(${width}px, 96vw)`, maxHeight: '92vh', overflowY: 'auto', padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>{title}</h3>
          <button className="tbtn" onClick={onClose} aria-label="ปิด" style={{ ...ghost, padding: '4px 9px' }}>✕</button>
        </div>
        {children}
        {footer && <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>{footer}</div>}
      </div>
    </div>
  );
}

/** แถบเตือนโหลดไม่ได้/ยังไม่ apply migration — ห้ามเงียบ */
export function WarnBar({ children, color = '#ef4444' }) {
  if (!children) return null;
  return (
    <div style={{ background: `${color}18`, border: `1px solid ${color}66`, color, borderRadius: 8, padding: '8px 12px', fontSize: 12.5, fontWeight: 700, marginBottom: 10 }}>
      {children}
    </div>
  );
}

/* 📎 ไฟล์แนบ NPI — สูตรจริง (HEIC · GIF · บีบรูป · uploadOpts) อยู่ที่ `utils/fileAttach.js`
   🔴 ห้ามเขียนสูตรซ้ำที่นี่ — ย้ายออกไป 01/11 เพื่อให้โมดูลอื่น (OJT ฯลฯ) ใช้ชุดเดียวกัน */
const NPI_BUCKET = 'npi-files';
/** อัปโหลดไฟล์เข้า bucket npi-files → public URL · null = ล้มเหลว (toast แล้ว) */
export const uploadNpiFile = (folder, file) => uploadAttachment(NPI_BUCKET, folder, file);
/** ลบไฟล์ใน bucket จาก public URL (best-effort) */
export const removeNpiFile = (url) => removeAttachment(NPI_BUCKET, url);

/** ปุ่มเลือกไฟล์ + สถานะกำลังอัป (ตัวจริง = components/FilePick.jsx · ที่นี่แค่ผูกสไตล์ ghost ของ NPI) */
export function FilePick(props) { return <FilePickBase baseStyle={ghost} {...props} />; }

export const fileName = attachFileName;
