/* ══ 🏭 Smart Factory → Edit Data — สไตล์/ตัวช่วยที่ใช้ร่วม (ไฟล์ข้อมูลล้วน) ══ */
import { createElement } from 'react';
import { WF_STATUS } from './labels.js';

export const th = { padding: '7px 9px', fontSize: 12, color: 'var(--muted)', fontWeight: 700, borderBottom: '1px solid var(--border)', background: 'var(--bg3)', textAlign: 'left', position: 'sticky', top: 0, zIndex: 1 };
export const td = { padding: '6px 9px', fontSize: 13, borderTop: '1px solid var(--border)' };
export const inp = { width: '100%', padding: '6px 8px', borderRadius: 'var(--ctl-r)', border: '1px solid var(--border)', background: 'var(--bg3)', color: 'var(--text)', fontSize: 13 };
export const sel = { ...inp, width: 'auto' };
export const lab = { fontSize: 12, color: 'var(--muted)', marginBottom: 4, display: 'block' };
export const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));
export const fmtNum = (v) => (v == null ? '-' : Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 }));
export const statusOf = (v) => WF_STATUS.find(s => s.value === v) || { label: v || '-', tone: 'muted' };
/** ชิปสถานะ (สร้างด้วย createElement — ไฟล์นี้ไม่ใช่ไฟล์คอมโพเนนต์) */
export const Chip = ({ tone, children }) => createElement('span', { style: {
  fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 'var(--r-sm, 6px)', whiteSpace: 'nowrap',
  background: tone === 'muted' ? 'var(--bg3)' : `var(--${tone}-dim)`, color: tone === 'muted' ? 'var(--text2)' : `var(--${tone})`,
} }, children);
