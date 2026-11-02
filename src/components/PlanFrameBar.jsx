/* 🧾 PlanFrameBar — "กรอบแผน" (Layer 1) บนบอร์ด Heijunka
 *
 * ที่มา (20/10 · คำสั่ง user): *"หัวหน้าชอบไม่สแกนกัมบังเข้าระบบ … ตอนนี้ผลิตทำเองไม่เปิด
 * ก็เหมือนไม่มีออเดอร์"* ⇒ ให้แพลนนิ่ง **ตีกรอบ** ไว้ก่อน บอร์ดจะได้ตอบได้ว่า
 * "ความต้องการจริงเท่าไหร่" และ cross-function เช็คได้ว่าช่องว่างอยู่ตรงไหน
 *
 * 🔴 กฎที่ยึด (CLAUDE.md §Production Plan — ห้ามแหก):
 *  · แผน = **กรอบ** (Layer 1) · คัมบังที่สแกน = **ของจริง** (Layer 2)
 *  · แผน **ไม่สร้างใบผลิต ไม่เขียนสถานะกลับฐาน ไม่นับเป็นยอดผลิต** — จับคู่ตอนแสดงผลเท่านั้น
 *  · ตัวเลขทุกตัวมาจาก `matchPlanToActual()` (`utils/planLots.js`) — **ห้ามนับเองในไฟล์นี้**
 *  · `over` (ทำเกินกรอบ) / `offPlan` (ทำโดยไม่มีในกรอบ) **ต้องโชว์ ห้ามกลืน**
 *    — หน้างานทำนอกแผนไม่ใช่ความผิด แต่ต้องรู้ ไม่งั้นกรอบกลายเป็นเครื่องมือจับผิด
 *
 * 🔴 กฎความซื่อสัตย์ของจอ: **"ไม่มีกรอบ" ต้องเขียนบนจอ ห้ามเงียบ** — บอร์ดว่างมี 2 ความหมาย
 *    (ไม่มีงานจริง / มีงานแต่ไม่มีใครสแกน) ถ้าไม่เขียนแยก = จอโกหกแบบที่ user เจออยู่
 *    · ใบจองทดลอง `donePcs = null` = **ประเมินไม่ได้ ไม่ใช่ 0** ⇒ แยกนับ ห้ามปนยอดส่งลูกค้า
 */
import React from 'react';
import { statusColor } from '../utils/statusTone';

/* 🎨 สีสถานะมาจาก `statusTone.js` ชุดเดียวทั้งระบบ (มีด่าน `status-palette-single-source`)
   · `frame` = ม่วง **ไม่ใช่สถานะ** — เป็น "ชนิดของข้อมูล" (กรอบแผน) ที่ต้องไม่ชนกับสีสถานะคัมบัง 7 ตัว */
const C = {
  frame: '#a78bfa',
  gap:   statusColor('warn'),   // ยังไม่เปิดใบ = เหลือง (งานยังเดินอยู่ ไม่ใช่ alarm)
  off:   statusColor('bad'),    // นอกแผน/เกินแผน = ต้องมีคนตอบ
  ok:    statusColor('good'),
  none:  statusColor('none'),   // ยังตัดสินไม่ได้ / ไม่มีเป้าเทียบ
};

const pcs = (n) => Number(n || 0).toLocaleString();

/** @param rec  ผลของ matchPlanToActual() — null = ยังโหลดไม่เสร็จ
 *  @param lots ล็อตดิบของวัน (ใช้บอก "ไม่มีกรอบ" เท่านั้น — ตัวเลขทั้งหมดมาจาก rec) */
export default function PlanFrameBar({ rec, lots = null, size = 12, compact = false }) {
  /* ⏳ ยังโหลดไม่เสร็จ ≠ ไม่มีกรอบ — ห้ามเขียน "ไม่มีกรอบ" ตอนที่ยังตอบไม่ได้ */
  if (lots == null) return null;

  const chip = (color, text, title) => (
    <span title={title} style={{
      fontSize: size, fontWeight: 700, padding: '2px 9px', borderRadius: 20,
      background: 'var(--card)', backgroundImage: `linear-gradient(${color}1f, ${color}1f)`,
      border: `1px solid ${color}66`, color, whiteSpace: 'nowrap',
    }}>{text}</span>
  );

  /* 🔲 ไม่มีกรอบเลย = ต้องเขียนบนจอ ไม่งั้น "บอร์ดว่าง" ถูกอ่านว่า "ไม่มีออเดอร์" */
  if (!rec || !lots.length) {
    return (
      <span style={{
        fontSize: size, color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '2px 10px', borderRadius: 20, border: `1px dashed ${C.frame}66`,
      }}>
        <b style={{ color: C.frame }}>🧾 ยังไม่มีกรอบแผนของวันนี้</b>
        {!compact && <span>— บอร์ดนี้เห็นเฉพาะใบที่สแกนเข้าระบบ (ว่าง ≠ ไม่มีงาน)</span>}
      </span>
    );
  }

  const pending = rec.rows.filter(r => r.state === 'pending');
  const trial   = rec.rows.filter(r => r.state === 'trial');
  const offPcs  = rec.offPlan.reduce((a, x) => a + x.pcs, 0);
  const overPcs = rec.over.reduce((a, x) => a + x.pcs, 0);
  /* 🔴 ยังไม่ปันยอดได้เลยสักล็อต = ตอบ % ไม่ได้ ⇒ `null` ห้ามเขียน 0% */
  const pct = rec.pct;

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      {chip(C.frame, `🧾 กรอบแผน ${pcs(rec.planPcs)} ชิ้น · ${rec.rows.length - trial.length} ล็อต`,
        'กรอบที่ทีมวางแผนตีไว้ (Layer 1) — ไม่ใช่ใบผลิต ไม่นับเป็นยอดที่ทำได้')}
      {chip(pct != null && pct >= 100 ? C.ok : C.none,
        `เข้าระบบแล้ว ${pcs(rec.donePcs)}${pct != null ? ` (${pct}%)` : ''}`,
        'ยอดที่สแกนคัมบังเข้าระบบจริง รวมทุกใบของพาร์ทนั้น (Layer 2)')}
      {pending.length > 0 && chip(C.gap, `🔲 ยังไม่เปิดใบ ${pending.length} ล็อต`,
        `มีกรอบแต่ยังไม่มีใบคัมบังเลย: ${pending.map(r => r.lot.mat_no).join(' · ')}`)}
      {offPcs > 0 && chip(C.off, `⚠ นอกแผน ${pcs(offPcs)} ชิ้น`,
        `ผลิตจริงแต่ไม่มีในกรอบ: ${rec.offPlan.map(x => `${x.mat_no} ${pcs(x.pcs)}`).join(' · ')}`)}
      {overPcs > 0 && chip(C.off, `↗ เกินกรอบ ${pcs(overPcs)} ชิ้น`,
        `ทำเกินยอดที่วางแผนไว้: ${rec.over.map(x => `${x.mat_no} +${pcs(x.pcs)}`).join(' · ')}`)}
      {trial.length > 0 && chip(C.none, `🧪 จองทดลอง ${trial.length}`,
        'ใบจองเครื่องทดลอง — ยังไม่มีเลข MAT ให้จับคู่ ประเมินความคืบหน้าไม่ได้ (ไม่ใช่ 0)')}
    </span>
  );
}
