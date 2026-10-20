/* 🧾 PlanFrameRow — แถว "กรอบแผน" บนบอร์ด Heijunka (Layer 1)
 *
 * ที่มา (20/10 · คำสั่ง user): หน้างานไม่สแกนคัมบัง ⇒ บอร์ดว่าง ⇒ ถูกอ่านว่า "ไม่มีออเดอร์"
 * แถวนี้วาด **รูปงานที่ทีมวางแผนตีกรอบไว้** ให้เห็นก่อน ไม่ว่าจะมีใบคัมบังหรือยัง
 *
 * 🔴 กฎที่ยึด:
 *  · กรอบ **ไม่ใช่ใบผลิต** — เส้นประ ไม่ทึบ ไม่มีไอคอนสถานะแบบการ์ดคัมบัง · ห้ามให้คนสับสน
 *  · ตำแหน่งเวลาจาก `layoutLots()` (`utils/planTimeline.js`) **ห้ามคิดพิกัดเองที่นี่**
 *  · 🔴 ล็อตที่ไม่รู้ CT = `widthPct: null` **ความยาวไม่ได้สเกลกับเวลา** ⇒ วาดต่างและเขียนบอก
 *    (`noCt`) · ล็อตหลังตัวที่ไม่รู้ CT = เวลาเชื่อไม่ได้ (`afterUnknown`) ⇒ จางลง + บอกใน tooltip
 *  · สถานะ "เปิดใบแล้วหรือยัง" มาจาก `matchPlanToActual()` เท่านั้น — **ห้ามนับใบเองที่นี่**
 */
import React from 'react';
import { layoutLots, UNKNOWN_BOX_MIN_PCT } from '../utils/planTimeline';
import MatLabel, { useMatIndex } from './MatLabel';
import { matText } from '../utils/matLabel';

const FRAME = '#a78bfa';
const ST = {
  done:    { c: '#22c55e', mark: '✓',  label: 'ครบตามกรอบแล้ว' },
  partial: { c: '#4d9fff', mark: '▶',  label: 'เปิดใบแล้วบางส่วน' },
  pending: { c: '#f59e0b', mark: '🔲', label: 'ยังไม่มีใบคัมบังเลย' },
  trial:   { c: '#8aa0b4', mark: '🧪', label: 'ใบจองเครื่องทดลอง — ไม่มี MAT ให้จับคู่' },
};

/** @param lotsByShift  { day: [...], night: [...] }
 *  @param stateOf      (lotId) => 'done'|'partial'|'pending'|'trial'|null  (จาก matchPlanToActual)
 *  @param halves       [{ key:'am', startMs }, { key:'pm', startMs }] — am = กะเช้า · pm = กะดึก */
export default function PlanFrameRow({
  lotsByShift = {}, stateOf = () => null, halves = [], breaksOf = () => [],
  ctOf = () => null, pairOf = () => null, leftW = 170, isMobile = false, lineName = null,
}) {
  /* 🔢 ป้ายชิ้นงาน = Part No. → Part Name → MAT SAP ที่เดียวทั้งระบบ (<MatLabel>/`matText` · มีด่าน) */
  const matIdx = useMatIndex();
  const totalLots = (lotsByShift.day?.length || 0) + (lotsByShift.night?.length || 0);
  if (!totalLots) return null;

  const strip = (half, shiftKey) => {
    const lots = lotsByShift[shiftKey] || [];
    const spanMs = 12 * 3600000;
    const { boxes, unknownCount } = layoutLots({
      lots, ctOf, pairOf,
      startMs: half.startMs, endMs: half.startMs + spanMs,
      breaks: breaksOf(half, lineName), rowSpanMs: spanMs,
    });
    return (
      <div key={half.key} style={{
        position: 'relative', height: 30, borderTop: '1px dashed var(--border2)',
        background: 'var(--card)', backgroundImage: `linear-gradient(${FRAME}0a, ${FRAME}0a)`,
      }}>
        {boxes.map((b) => {
          const st = ST[stateOf(b.lot.id) || 'pending'] || ST.pending;
          /* กล่องที่คำนวณเวลาไม่ได้ = ช่องนามธรรม ⇒ กว้างขั้นต่ำ + ลายทแยง (ห้ามทำให้ดูเหมือนเวลาจริง) */
          const w = b.widthPct != null ? Math.max(b.widthPct, 1.2) : Math.max(b.nominalPct, UNKNOWN_BOX_MIN_PCT);
          const left = Math.max(0, Math.min(b.leftPct, 100));
          if (left >= 100) return null;
          const qty = Number(b.lot.qty_plan) || 0;
          const tip = [
            `🧾 กรอบแผน · ${b.lot.mat_no ? matText(b.lot.mat_no, matIdx, { name: b.lot.part_name }) : '(ใบจองเครื่องทดลอง)'}`,
            `วางแผน ${qty.toLocaleString()} ชิ้น · ลำดับที่ ${b.seq}`,
            st.label,
            b.noCt ? '⚠ ไม่รู้ CT ของพาร์ทนี้ — กล่องนี้ไม่ได้สเกลกับเวลา (ตำแหน่งเป็นลำดับ ไม่ใช่เวลาจริง)' : null,
            b.afterUnknown && !b.noCt ? '⚠ มีล็อตที่คำนวณเวลาไม่ได้อยู่ก่อนหน้า — เวลาของกล่องนี้เชื่อไม่ได้' : null,
            '— กรอบ ไม่ใช่ใบผลิต · ไม่นับเป็นยอดที่ทำได้',
          ].filter(Boolean).join('\n');
          return (
            <div key={b.lot.id} title={tip} style={{
              position: 'absolute', top: 4, bottom: 4, left: `${left}%`, width: `${Math.min(w, 100 - left)}%`,
              boxSizing: 'border-box', borderRadius: 5, overflow: 'hidden',
              border: `1.5px dashed ${st.c}cc`,
              background: 'var(--card)', backgroundImage: b.noCt
                ? `repeating-linear-gradient(45deg, ${st.c}26 0 5px, transparent 5px 10px)`
                : `linear-gradient(${st.c}14, ${st.c}14)`,
              display: 'flex', alignItems: 'center', gap: 3, padding: '0 4px',
              opacity: b.afterUnknown ? 0.75 : 1,
            }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: st.c, flexShrink: 0 }}>{st.mark}</span>
              {b.lot.mat_no
                ? <MatLabel mat={b.lot.mat_no} name={b.lot.part_name} size={11} style={{ flexWrap: 'nowrap', overflow: 'hidden' }} />
                : <span style={{ fontSize: 11, color: 'var(--text2)', fontWeight: 700 }}>จองเครื่อง</span>}
              {qty > 0 && (
                <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0 }}>
                  {qty.toLocaleString()}
                </span>
              )}
            </div>
          );
        })}
        {/* 🔴 บอกบนจอว่ากี่ล็อตที่ตำแหน่งเชื่อไม่ได้ — ห้ามปล่อยให้ดูเหมือนเวลาจริงทั้งแถว */}
        {unknownCount > 0 && (
          <span style={{ position: 'absolute', right: 4, top: 7, fontSize: 11, color: '#f59e0b', fontWeight: 700 }}
            title="ล็อตที่ยังไม่รู้ CT — วางตามลำดับ ไม่ใช่เวลาจริง">⚠ {unknownCount} ล็อตไม่รู้ CT</span>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', borderTop: `1px solid ${FRAME}55`, overflow: 'hidden' }}>
      <div style={{
        width: leftW, flexShrink: 0, padding: '4px 8px', borderRight: '1px solid var(--border2)',
        display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 2, overflow: 'hidden',
        background: 'var(--card)', backgroundImage: `linear-gradient(${FRAME}14, ${FRAME}14)`,
        ...(isMobile ? { position: 'sticky', left: 0, zIndex: 3 } : null),
      }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: FRAME, lineHeight: 1.25 }}>🧾 กรอบแผน</div>
        <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.3 }}>
          แพลนนิ่งตีไว้ {totalLots} ล็อต
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.3 }}>ยังไม่ใช่ใบผลิต</div>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {strip(halves[0], 'day')}
        {strip(halves[1], 'night')}
      </div>
    </div>
  );
}
