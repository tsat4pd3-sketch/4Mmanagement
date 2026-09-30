/* ══ 🧲 ไทม์ไลน์จัดแผน — ลากสลับก่อนหลังได้ (2026-09-30 · คำสั่ง user) ══════════════════════
   *"พอเลือก order แล้วระบบคำนวณความยาวของ box order และ user ลาก จัดแผน เข้าไทม์ไลน์ สลับก่อนหลัง"*

   🔴 **ตำแหน่งกล่องถูกคำนวณ ไม่ใช่ลากไปวางตรงไหนก็ได้** — 1 ไลน์ทำได้ทีละใบ ⇒ ลากอิสระ =
      เปิดช่องว่างกลางกะโดยไม่มีเหตุผล แล้วแผนจะโกหกว่าจบเร็วกว่าจริง
      ⇒ **ลาก = เปลี่ยนลำดับ** ระบบคำนวณเวลาให้ใหม่ทุกครั้ง (สูตรอยู่ `utils/planTimeline.js`)
   🔴 ทุกพิกัด/ความยาวมาจาก `layoutLots()` **ห้ามคำนวณ px/นาทีเองในไฟล์นี้**
   🔴 กล่องที่คำนวณความยาวไม่ได้ (ไม่มี CT) = **ลายทแยง + ป้ายบอก ห้ามซ่อน ห้ามให้ยาว 0 เงียบๆ**
   ♿ ลากด้วยเมาส์ไม่ได้ (จอสัมผัส/คีย์บอร์ด) → ปุ่ม ↑↓ ในตารางด้านล่างยังทำงานเหมือนเดิม
      (HTML5 drag ไม่รองรับ touch — ห้ามถอดปุ่มทิ้ง)
   ══════════════════════════════════════════════════════════════════════════════════════════ */
import { useState, useMemo } from 'react';
import { layoutLots, reorderTo, hourTicks, UNKNOWN_BOX_MIN_PCT } from '../utils/planTimeline';
import { qtyText } from '../utils/planLots';
import MatLabel from './MatLabel';

const fmtHm = (ms) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const fmtMin = (m) => m == null ? '—' : m < 60 ? `${Math.round(m)} น.` : `${Math.floor(m / 60)}:${String(Math.round(m % 60)).padStart(2, '0')} ชม.`;
const ROW_H = 46;

export default function PlanTimeline({
  lots = [], ctOf, pairOf, dieOf, rule, startMs, endMs, breaks = [],
  onReorder, editable = false, nameOfMat = () => '',
}) {
  const [dragId, setDragId] = useState(null);
  const [overIdx, setOverIdx] = useState(null);

  const lay = useMemo(() => layoutLots({ lots, ctOf, pairOf, dieOf, rule, startMs, endMs, breaks }),
    [lots, ctOf, pairOf, dieOf, rule, startMs, endMs, breaks]);
  const ticks = useMemo(() => hourTicks(startMs, endMs, 1), [startMs, endMs]);
  const span = endMs - startMs;
  const pctOf = (ms) => ((ms - startMs) / span) * 100;

  /* รางกว้างเท่ากรอบกะเสมอ — งานที่ล้นออกไปวาดเลยขอบขวา (ไม่บีบให้พอดี) */
  const over = lay.endMs > endMs;

  const drop = (idx) => {
    if (!editable || !dragId) return;
    onReorder?.(reorderTo(lots, dragId, idx));
    setDragId(null); setOverIdx(null);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {/* ── หัวราง: ป้ายชั่วโมง ── */}
      <div style={{ position: 'relative', height: 16, marginLeft: 2 }}>
        {ticks.map(t => (
          <span key={t.ms} style={{ position: 'absolute', left: `${t.pct}%`, transform: 'translateX(-50%)',
            fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{t.label}</span>
        ))}
      </div>

      {/* ── ราง ── */}
      <div style={{ position: 'relative', height: ROW_H + 10, background: 'var(--bg2)',
        border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
        {/* เส้นชั่วโมง */}
        {ticks.map(t => (
          <div key={t.ms} style={{ position: 'absolute', left: `${t.pct}%`, top: 0, bottom: 0,
            width: 1, background: 'var(--border)', opacity: 0.6 }} />
        ))}
        {/* เวลาพัก — พื้นที่ที่เครื่องไม่เดิน (กล่องถูกยืดข้ามไปแล้วโดย layoutLots) */}
        {breaks.map(([bs, be], i) => (
          <div key={i} title="เวลาพักตามนโยบาย" style={{ position: 'absolute', left: `${pctOf(bs)}%`,
            width: `${((be - bs) / span) * 100}%`, top: 0, bottom: 0,
            background: 'rgba(148,163,184,0.18)' }} />
        ))}

        {/* กล่องล็อต */}
        {lay.boxes.map((b, i) => {
          const isUnknown = b.noCt;
          const w = isUnknown ? Math.max(b.nominalPct, UNKNOWN_BOX_MIN_PCT) : b.widthPct;
          const color = isUnknown ? '#94a3b8' : b.pairedWithPrev ? '#a78bfa' : b.afterUnknown ? '#f59e0b' : '#4d9fff';
          return (
            <div key={b.lot.id}>
              {/* ช่วงเปลี่ยนรุ่น */}
              {b.setupWidthPct > 0 && (
                <div title={`เปลี่ยนรุ่นก่อนเริ่มใบนี้ ~${fmtMin(b.setupMs / 60000)}`}
                  style={{ position: 'absolute', left: `${b.setupLeftPct}%`, width: `${b.setupWidthPct}%`,
                    top: 5, height: ROW_H, background: 'repeating-linear-gradient(45deg, rgba(245,158,11,0.35) 0 5px, transparent 5px 10px)',
                    border: '1px solid rgba(245,158,11,0.5)', borderRadius: 4, pointerEvents: 'none' }} />
              )}
              {/* 🔴 ไม่รู้เวลาเปลี่ยนรุ่น = ขีดประบางๆ ให้เห็นว่ามีช่วงที่ยังตอบไม่ได้ (ไม่ใช่ 0) */}
              {!b.setupKnown && i > 0 && (
                <div title="ยังตอบไม่ได้ว่าเปลี่ยนรุ่นใช้เวลาเท่าไหร่ — เวลาที่เห็นจึงเร็วกว่าจริง"
                  style={{ position: 'absolute', left: `${b.leftPct}%`, top: 3, height: ROW_H + 4,
                    borderLeft: '2px dashed #f59e0b', pointerEvents: 'none' }} />
              )}
              <div
                draggable={editable}
                onDragStart={() => setDragId(b.lot.id)}
                onDragEnd={() => { setDragId(null); setOverIdx(null); }}
                onDragOver={(e) => { if (editable && dragId) { e.preventDefault(); setOverIdx(i); } }}
                onDrop={(e) => { e.preventDefault(); drop(i); }}
                title={`#${b.seq} ${b.lot.mat_no} · ${qtyText(b.lot.qty_plan)} ชิ้น\n`
                  + (isUnknown ? 'ยังไม่มี cycle time — คำนวณความยาวไม่ได้'
                    : `${fmtHm(b.startMs)}–${fmtHm(b.endMs)} (${fmtMin(b.runMin)})`)
                  + (b.pairedWithPrev ? '\n👯 คู่ RH/LH กับใบก่อนหน้า — ปั๊มจังหวะเดียวกัน ไม่กินเวลาเพิ่ม' : '')
                  + (b.afterUnknown && !isUnknown ? '\n⚠️ มีใบที่คำนวณไม่ได้อยู่ก่อนหน้า — เวลาของใบนี้เชื่อไม่ได้' : '')
                  + (editable ? '\n\n🧲 ลากเพื่อสลับลำดับ' : '')}
                style={{
                  position: 'absolute', left: `${b.leftPct}%`, width: `${Math.max(w, 1.2)}%`,
                  top: 5, height: ROW_H, borderRadius: 5, cursor: editable ? 'grab' : 'default',
                  border: `1.5px solid ${color}`, borderLeft: `4px solid ${color}`,
                  background: isUnknown
                    ? `repeating-linear-gradient(135deg, ${color}33 0 6px, transparent 6px 12px)`
                    : `${color}22`,
                  opacity: dragId === b.lot.id ? 0.45 : 1,
                  boxShadow: overIdx === i && dragId && dragId !== b.lot.id ? `inset 3px 0 0 0 var(--accent)` : 'none',
                  overflow: 'hidden', padding: '3px 5px', boxSizing: 'border-box',
                }}>
                {/* 🔴 ป้ายข้างในต้อง `pointerEvents:'none'` — ไม่งั้นมันดักเมาส์แทนกล่อง
                    แล้ว "จับที่ตัวหนังสือ" ลากไม่ติด (เจอจากจอทดสอบ 30/09) */}
                <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text)', whiteSpace: 'nowrap', lineHeight: 1.25, pointerEvents: 'none' }}>
                  {b.pairedWithPrev && '👯 '}#{b.seq} {b.lot.mat_no}
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--text2)', whiteSpace: 'nowrap', pointerEvents: 'none' }}>
                  {isUnknown ? '⚠ ไม่มี CT' : `${qtyText(b.lot.qty_plan)} ชิ้น · ${fmtMin(b.runMin)}`}
                </div>
              </div>
            </div>
          );
        })}

        {/* ปลายกะ */}
        <div title="ปลายกะ" style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 2, background: over ? '#ef4444' : 'var(--border2)' }} />
        {/* พื้นที่วางท้ายสุด (ลากมาต่อท้าย) */}
        {editable && dragId && (
          <div onDragOver={(e) => { e.preventDefault(); setOverIdx(lay.boxes.length); }}
            onDrop={(e) => { e.preventDefault(); drop(lay.boxes.length); }}
            style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '12%',
              background: overIdx === lay.boxes.length ? 'rgba(34,197,94,0.15)' : 'transparent' }} />
        )}
      </div>

      {/* ── บรรทัดความจริงใต้ราง ── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', fontSize: 11.5 }}>
        <span style={{ color: 'var(--text2)' }}>
          🏁 คิวจบ <b style={{ color: over ? '#ef4444' : 'var(--text)' }}>{lay.unknownCount > 0 ? '—' : fmtHm(lay.endMs)}</b>
          {lay.overflowMin > 0 && <b style={{ color: '#ef4444' }}> · ล้นปลายกะ {fmtMin(lay.overflowMin)}</b>}
        </span>
        {lay.unknownCount > 0 && (
          <span style={{ color: '#f59e0b', fontWeight: 700 }}>
            ⚠️ {lay.unknownCount} ล็อตไม่มี CT — คำนวณความยาวไม่ได้ (กล่องลายทแยง) · เวลาหลังจากนั้นเชื่อไม่ได้
          </span>
        )}
        {lay.setupUnknownCount > 0 && (
          <span style={{ color: '#f59e0b' }}>
            ⚠️ {lay.setupUnknownCount} ช่วงยังไม่รู้เวลาเปลี่ยนรุ่น (เส้นประส้ม) — เวลาที่เห็น<b>เร็วกว่าจริง</b>
          </span>
        )}
        {editable && <span style={{ color: 'var(--muted)' }}>🧲 ลากกล่องเพื่อสลับก่อนหลัง (จอสัมผัสใช้ปุ่ม ↑↓ ในตารางด้านล่าง)</span>}
      </div>
    </div>
  );
}
