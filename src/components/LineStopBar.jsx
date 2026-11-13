/* ═══════════════════════════════════════════════════════════════════════════
   📊 แถบ "ไลน์หยุด 1 ก้อน แตกเป็นช่วง" — เลขตัวเดียวกัน ไม่มีตรงไหนหายไป  2026-11-11

   คำสั่ง user: *"หน้าสรุป KPI ที่เกี่ยวกับ line stop หรือพวกเบรคดาวน์ พยายามให้โชว์
   กราฟแท่งแบบนี้ด้วย เพื่อให้เห็นว่าเลขตัวเดียวกัน ไม่ได้มีตรงไหนหายไป
   แต่บอกได้ว่าไปอยู่ช่วงไหน"*

   🔴 **หน้าที่หลักของคอมโพเนนต์นี้คือ "พิสูจน์ว่าบวกกลับได้"** — ไม่ใช่แค่วาดสวย
      ⇒ ทุกช่วงรวมกันต้องเท่ากับยอดเต็มเสมอ · ส่วนที่ยังแบ่งไม่ได้ **ต้องเป็นแถบที่มองเห็น**
        (สีจาง + ป้ายบอกจำนวน) **ห้ามตัดทิ้งหรือ normalize ให้เต็ม 100% เงียบๆ**
      ถ้าบวกแล้วไม่เท่ายอดเต็ม = ข้อมูลขัดกัน ⇒ เขียนเตือนบนแถบ ไม่ใช่ซ่อน

   🔴 **สีมาจาก token เท่านั้น** (ด่าน `card-shadow-via-token` / colorRatchet ห้ามสีดิบในหน้า)
   🔴 ฟอนต์ขั้นต่ำ 11px (จอ TV) · ไม่ใช้ `color-mix()` (เพดาน Chromium 94 ของจอหน้างาน)
   ═══════════════════════════════════════════════════════════════════════════ */
import React from 'react';

import { tr } from '../utils/i18n';
const fmtHr = (h) => (h == null ? '—' : `${Number(h).toLocaleString('th-TH', { maximumFractionDigits: 1 })} ชม.`);

/**
 * @param {object} p
 * @param {number} p.total     ยอดเต็ม (ชม.) — ความยาวเต็มของแถบ
 * @param {Array}  p.parts     [{ key, label, hr, color }] — `color` = ชื่อ CSS var เช่น 'var(--blue)'
 * @param {number} p.unknownHr ส่วนที่ยังแบ่งไม่ได้ (ชม.) — วาดเป็นแถบจางเสมอ ห้ามซ่อน
 * @param {string} p.unknownLabel ป้ายของส่วนที่ยังแบ่งไม่ได้ + เหตุผล/ทางแก้
 * @param {string} p.title     หัวแถบ
 * @param {string} p.note      บรรทัดอธิบายใต้แถบ
 */
export default function LineStopBar({ total, parts = [], unknownHr = 0, unknownLabel = 'ยังแบ่งช่วงไม่ได้', title, note }) {
  const known = parts.reduce((s, p) => s + (Number(p.hr) || 0), 0);
  const unk = Math.max(0, Number(unknownHr) || 0);
  const sum = known + unk;
  const T = Number(total) || 0;
  /* 🔴 ตัวพิสูจน์ — ต่างเกิน 0.1 ชม. = ข้อมูลขัดกัน ต้องเขียนบนจอ ห้ามกลบ */
  const mismatch = T > 0 && Math.abs(sum - T) > 0.1;
  const base = T > 0 ? T : sum;          // ไม่มียอดเต็ม = ใช้ผลรวมเป็นฐาน (แถบยังเต็ม 100%)
  const pct = (v) => (base > 0 ? (Number(v) || 0) / base * 100 : 0);

  const rows = [
    ...parts.map(p => ({ ...p, hr: Number(p.hr) || 0 })),
    ...(unk > 0 ? [{ key: '__unknown', label: unknownLabel, hr: unk, color: 'var(--bg3)', dim: true }] : []),
  ];

  return (
    <div style={{ fontSize: 11.5, lineHeight: 1.6 }}>
      {title && (
        <div style={{ fontWeight: 700, color: 'var(--text2)', marginBottom: 4 }}>
          {title} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>{tr('· รวม')} {fmtHr(base)}</span>
        </div>
      )}
      {/* แถบเดียว แตกเป็นช่วง — ความกว้างรวมกันได้ 100% ของยอดเต็มเสมอ */}
      <div style={{ display: 'flex', width: '100%', height: 22, borderRadius: 'var(--r-xs)',
                    overflow: 'hidden', border: '1px solid var(--border)', background: 'var(--bg3)' }}>
        {rows.map(r => {
          const w = pct(r.hr);
          if (w <= 0) return null;
          return (
            <div key={r.key} title={`${r.label} — ${fmtHr(r.hr)} (${w.toFixed(1)}%)`}
              style={{ width: `${w}%`, background: r.color,
                       borderRight: '1px solid var(--border)',
                       /* แถบ "ยังแบ่งไม่ได้" ต้องดูต่างจากช่วงที่รู้ชัด แต่ยังมองเห็น */
                       opacity: r.dim ? 0.55 : 1 }} />
          );
        })}
      </div>
      {/* ป้ายรายช่วง — บอกทั้งชั่วโมงและ % เพราะคนอ่านคนละแบบกัน */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 14px', marginTop: 5 }}>
        {rows.map(r => (
          <span key={r.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: r.dim ? 'var(--muted)' : 'var(--text2)' }}>
            <i style={{ width: 9, height: 9, borderRadius: 2, background: r.color, border: '1px solid var(--border)',
                        opacity: r.dim ? 0.55 : 1, display: 'inline-block' }} />
            {tr(r.label)} <b style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtHr(r.hr)}</b>
            <span style={{ color: 'var(--muted)' }}>({pct(r.hr).toFixed(1)}%)</span>
          </span>
        ))}
      </div>
      {mismatch && (
        <div style={{ color: 'var(--amber)', marginTop: 3 }}>
          ⚠ ช่วงย่อยรวมได้ {fmtHr(sum)} {tr('ไม่เท่ากับยอดเต็ม')} {fmtHr(T)} — ข้อมูลขัดกัน ต้องไล่ที่ต้นทาง
        </div>
      )}
      {note && <div style={{ color: 'var(--muted)', marginTop: 3 }}>{note}</div>}
    </div>
  );
}
