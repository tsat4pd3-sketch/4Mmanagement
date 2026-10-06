/* ══ 🧲 ไทม์ไลน์จัดแผน — 1 กะ = 1 บรรทัด · ลากสลับก่อนหลังได้ (2026-09-30 · คำสั่ง user) ═════
   *"พอเลือก order แล้วระบบคำนวณความยาวของ box order และ user ลาก จัดแผน เข้าไทม์ไลน์ สลับก่อนหลัง"*
   *"เป็น timeline ขึ้น 2 บรรทัดไป ถ้าเลยไปกะเช้าอีกวันก็เป็น 3 บรรทัด"*  ← รอบ 2

   📺 **1 กะ = 1 บรรทัด ห้ามยัดทุกกะลงรางเดียว** — เคยลองรางเดียวยาวๆ แล้ว 4 กะทำให้แต่ละกะ
      เหลือ 1/4 ของความกว้าง กล่องงานเล็กจนอ่านไม่ออก · แบบบรรทัดคงสเกล 12 ชม./บรรทัด
      เท่าที่หน้างานคุ้นอยู่แล้ว แล้วงานที่ล้นก็ไหลลงบรรทัดถัดไปให้เห็นเป็นรูปธรรม
   🔴 **งานที่คร่อมเส้นแบ่งกะต้องโผล่ทั้ง 2 บรรทัด** (ท่อนต่อ ◀ / ▶) — ตัดให้เหลือบรรทัดเดียว
      = คนกะดึกไม่รู้ว่ารับงานอะไรมาทำต่อ
   🔴 **ตำแหน่งกล่องถูกคำนวณ ไม่ใช่ลากไปวางตรงไหนก็ได้** — 1 ไลน์ทำได้ทีละใบ ⇒ ลากอิสระ =
      เปิดช่องว่างกลางกะโดยไม่มีเหตุผล แล้วแผนจะโกหกว่าจบเร็วกว่าจริง
      ⇒ **ลาก = เปลี่ยนลำดับ** ระบบคำนวณเวลาให้ใหม่ทุกครั้ง (สูตรอยู่ `utils/planTimeline.js`)
   🔴 เวลาทุกค่ามาจาก `layoutLots()` · การหั่นเป็นบรรทัดมาจาก `sliceBySegments()`
      **ห้ามคำนวณ px/นาที/เปอร์เซ็นต์เองในไฟล์นี้**
   🔴 กล่องที่คำนวณความยาวไม่ได้ (ไม่มี CT) = **ลายทแยง + ป้ายบอก ห้ามซ่อน ห้ามให้ยาว 0 เงียบๆ**
   ♿ ลากด้วยเมาส์ไม่ได้ (จอสัมผัส/คีย์บอร์ด) → ปุ่ม ↑↓ ในตารางด้านล่างยังทำงานเหมือนเดิม
      (HTML5 drag ไม่รองรับ touch — ห้ามถอดปุ่มทิ้ง)
   ══════════════════════════════════════════════════════════════════════════════════════════ */
import { useState, useMemo } from 'react';
import { layoutLots, reorderTo, UNKNOWN_BOX_MIN_PCT } from '../utils/planTimeline';
import { sliceBySegments, visibleRows, rowTicks, SHIFT_LABEL } from '../utils/planHorizon';
import { qtyText, isTrialLot, lotKeyText } from '../utils/planLots';

const fmtHm = (ms) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
/* ข้ามวัน = บอกเวลาเปล่าๆ ไม่พอ ("22:34" ของวันไหน?) */
const fmtDayHm = (ms) => { const d = new Date(ms); return `${d.getDate()}/${d.getMonth() + 1} ${fmtHm(ms)}`; };
const fmtMin = (m) => m == null ? '—' : m < 60 ? `${Math.round(m)} น.` : `${Math.floor(m / 60)}:${String(Math.round(m % 60)).padStart(2, '0')} ชม.`;
const dm = (d) => `${d.slice(8)}/${d.slice(5, 7)}`;
const ROW_H = 44;
const LABEL_W = 116;

export default function PlanTimeline({
  lots = [], ctOf, pairOf, dieOf, rule, startMs, endMs, breaks = [], closed = [],
  segments = [], skipped = [], onReorder, editable = false,
}) {
  const [dragId, setDragId] = useState(null);
  const [overIdx, setOverIdx] = useState(null);

  /* กะเดียว (จอเดิม) = ทำเป็น "บรรทัดเดียว" ด้วยโครงเดียวกัน — ไม่มีโค้ด 2 ทาง */
  const segs = useMemo(() => (segments.length
    ? segments
    : [{ key: 'one', workDate: null, shift: null, startMs, endMs }]), [segments, startMs, endMs]);
  const multi = segments.length > 1;
  /* ช่องนามธรรมของกล่องไม่มี CT คิดจากความยาว **1 บรรทัด** ไม่ใช่ทั้งขอบเขต */
  const rowSpanMs = segs[0] ? segs[0].endMs - segs[0].startMs : null;

  const lay = useMemo(() => layoutLots({ lots, ctOf, pairOf, dieOf, rule, startMs, endMs, breaks, closed, rowSpanMs }),
    [lots, ctOf, pairOf, dieOf, rule, startMs, endMs, breaks, closed, rowSpanMs]);
  const rows = useMemo(() => visibleRows(sliceBySegments(lay.boxes, segs, breaks)), [lay.boxes, segs, breaks]);

  /* ข้ามวันไหม — ใช้ตัดสินว่าต้องเขียนวันที่คู่กับเวลาตอนบอก "คิวจบ" */
  const spansDays = multi && segments[0].workDate !== segments[segments.length - 1].workDate;
  const over = lay.endMs > endMs;
  const lastRowIdx = rows.length - 1;

  const drop = (idx) => {
    if (!editable || !dragId) return;
    onReorder?.(reorderTo(lots, dragId, idx));
    setDragId(null); setOverIdx(null);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {rows.map((row, ri) => {
        const ticks = rowTicks(row.seg, multi ? 2 : 1);
        const isNight = row.seg.shift === 'night';
        return (
          <div key={row.seg.key} style={{ display: 'flex', alignItems: 'stretch', gap: 8 }}>
            {/* ── ป้ายกะซ้ายมือ — บอกว่าบรรทัดนี้คือกะไหน วันไหน ── */}
            {multi && (
              <div style={{ width: LABEL_W, flex: `0 0 ${LABEL_W}px`, display: 'flex', flexDirection: 'column',
                justifyContent: 'center', paddingTop: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text2)', whiteSpace: 'nowrap' }}>
                  {SHIFT_LABEL[row.seg.shift]}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                  {dm(row.seg.workDate)}
                  {/* 🔴 กะที่ยังว่างต้องบอกว่าว่าง — บรรทัดเปล่าเฉยๆ อ่านเป็น "โหลดไม่ขึ้น" */}
                  {!row.hasWork && <span style={{ marginLeft: 4 }}>· ว่าง</span>}
                </div>
              </div>
            )}

            <div style={{ flex: 1, minWidth: 0 }}>
              {/* ── ป้ายชั่วโมงของบรรทัดนี้ ── */}
              <div style={{ position: 'relative', height: 14 }}>
                {ticks.map(t => (
                  <span key={t.ms} style={{ position: 'absolute', left: `${t.pct}%`,
                    transform: t.pct === 0 ? 'none' : t.pct >= 100 ? 'translateX(-100%)' : 'translateX(-50%)',
                    fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{t.label}</span>
                ))}
              </div>

              {/* ── ราง ── */}
              <div style={{ position: 'relative', height: ROW_H + 8,
                background: isNight ? 'rgba(99,102,241,0.07)' : 'var(--bg2)',
                border: '1px solid var(--border)', borderRadius: 7, overflow: 'hidden' }}>
                {ticks.map(t => (
                  <div key={t.ms} style={{ position: 'absolute', left: `${t.pct}%`, top: 0, bottom: 0,
                    width: 1, background: 'var(--border)', opacity: 0.6 }} />
                ))}
                {/* เวลาพัก — พื้นที่ที่เครื่องไม่เดิน (กล่องถูกยืดข้ามไปแล้วโดย layoutLots) */}
                {row.breaks.map((b, i) => (
                  <div key={i} title="เวลาพักตามนโยบาย" style={{ position: 'absolute', left: `${b.leftPct}%`,
                    width: `${b.widthPct}%`, top: 0, bottom: 0, background: 'rgba(148,163,184,0.18)' }} />
                ))}

                {row.pieces.map(({ box: b, boxIndex, run, setup }) => {
                  const isUnknown = b.noCt;
                  /* 🧪 งานทดลอง = คนละเรื่องกับงานผลิต ต้องแยกออกด้วยตาทันที (ฟ้าน้ำทะเล)
                     **ห้ามใช้เขียว/เหลือง/แดง** — สงวนไว้ให้ Andon (UI-CONVENTIONS) */
                  const isTrial = isTrialLot(b.lot);
                  const color = isUnknown ? '#94a3b8' : isTrial ? '#22d3ee'
                    : b.pairedWithPrev ? '#a78bfa' : b.afterUnknown ? '#f59e0b' : '#4d9fff';
                  const w = run ? (isUnknown ? Math.max(run.widthPct, UNKNOWN_BOX_MIN_PCT) : run.widthPct) : 0;
                  return (
                    <div key={b.lot.id}>
                      {/* ช่วงเปลี่ยนรุ่น */}
                      {setup && (
                        <div title={`เปลี่ยนรุ่นก่อนเริ่มใบนี้ ~${fmtMin(b.setupMs / 60000)}`}
                          style={{ position: 'absolute', left: `${setup.leftPct}%`, width: `${setup.widthPct}%`,
                            top: 4, height: ROW_H, background: 'repeating-linear-gradient(45deg, rgba(245,158,11,0.35) 0 5px, transparent 5px 10px)',
                            border: '1px solid rgba(245,158,11,0.5)', borderRadius: 4, pointerEvents: 'none' }} />
                      )}
                      {/* 🔴 ไม่รู้เวลาเปลี่ยนรุ่น = ขีดประบางๆ ให้เห็นว่ามีช่วงที่ยังตอบไม่ได้ (ไม่ใช่ 0) */}
                      {run && !b.setupKnown && boxIndex > 0 && !run.cutLeft && (
                        <div title="ยังตอบไม่ได้ว่าเปลี่ยนรุ่นใช้เวลาเท่าไหร่ — เวลาที่เห็นจึงเร็วกว่าจริง"
                          style={{ position: 'absolute', left: `${run.leftPct}%`, top: 2, height: ROW_H + 4,
                            borderLeft: '2px dashed #f59e0b', pointerEvents: 'none' }} />
                      )}
                      {run && (
                        <div
                          draggable={editable}
                          onDragStart={() => setDragId(b.lot.id)}
                          onDragEnd={() => { setDragId(null); setOverIdx(null); }}
                          onDragOver={(e) => { if (editable && dragId) { e.preventDefault(); setOverIdx(boxIndex); } }}
                          onDrop={(e) => { e.preventDefault(); drop(boxIndex); }}
                          title={`#${b.seq} ${lotKeyText(b.lot)} · ${qtyText(b.lot.qty_plan)} ชิ้น\n`
                            + (isTrial ? `🧪 จองเครื่องทดลองงานใหม่${b.lot.trial_reason ? ` (${b.lot.trial_reason})` : ''}\n`
                              + `⏱️ เวลานี้คือ "ที่ขอ" ไม่ใช่ที่ระบบคำนวณ — พาร์ทใหม่ยังไม่มี cycle time\n` : '')
                            + (isUnknown ? 'ยังไม่มี cycle time — คำนวณความยาวไม่ได้'
                              : `${spansDays ? fmtDayHm(b.startMs) : fmtHm(b.startMs)}–${spansDays ? fmtDayHm(b.endMs) : fmtHm(b.endMs)} (${fmtMin(b.runMin)})`)
                            + (run.cutLeft || run.cutRight ? '\n🔗 งานใบนี้คร่อมกะ — ทำต่อเนื่องข้ามเส้นแบ่งกะ' : '')
                            + (b.pairedWithPrev ? '\n👯 คู่ RH/LH กับใบก่อนหน้า — ปั๊มจังหวะเดียวกัน ไม่กินเวลาเพิ่ม' : '')
                            + (b.afterUnknown && !isUnknown ? '\n⚠️ มีใบที่คำนวณไม่ได้อยู่ก่อนหน้า — เวลาของใบนี้เชื่อไม่ได้' : '')
                            + (editable ? '\n\n🧲 ลากเพื่อสลับลำดับ' : '')}
                          style={{
                            position: 'absolute', left: `${run.leftPct}%`, width: `${Math.max(w, 1.2)}%`,
                            top: 4, height: ROW_H, cursor: editable ? 'grab' : 'default',
                            /* 🔗 ด้านที่ถูกตัด = ไม่มนมุม + ไม่มีขอบ ⇒ อ่านออกว่า "ยังไม่จบ ไปต่อ" */
                            borderRadius: `${run.cutLeft ? 0 : 5}px ${run.cutRight ? 0 : 5}px ${run.cutRight ? 0 : 5}px ${run.cutLeft ? 0 : 5}px`,
                            border: `1.5px solid ${color}`,
                            borderLeft: run.cutLeft ? `2px dashed ${color}` : `4px solid ${color}`,
                            borderRight: run.cutRight ? `2px dashed ${color}` : `1.5px solid ${color}`,
                            background: isUnknown
                              ? `repeating-linear-gradient(135deg, ${color}33 0 6px, transparent 6px 12px)`
                              : `${color}22`,
                            opacity: dragId === b.lot.id ? 0.45 : 1,
                            boxShadow: overIdx === boxIndex && dragId && dragId !== b.lot.id ? 'inset 3px 0 0 0 var(--accent)' : 'none',
                            overflow: 'hidden', padding: '2px 5px', boxSizing: 'border-box',
                          }}>
                          {/* 🔴 ป้ายข้างในต้อง `pointerEvents:'none'` — ไม่งั้นมันดักเมาส์แทนกล่อง
                              แล้ว "จับที่ตัวหนังสือ" ลากไม่ติด (เจอจากจอทดสอบ 30/09)
                              🔴 ท่อนที่แคบมาก **ไม่พิมพ์ตัวหนังสือเลย** — พิมพ์แล้วโดนตัดครึ่งตัว
                                 อ่านเป็นขยะ (เศษ 7 นาทีที่ไหลไปกะดึก เห็นจาก planlab 30/09)
                                 กล่องยังอยู่ + มี tooltip ครบ ⇒ ไม่ใช่การซ่อนข้อมูล */}
                          {w >= 4 && (
                            <>
                              <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text)', whiteSpace: 'nowrap', lineHeight: 1.2, pointerEvents: 'none' }}>
                                {run.cutLeft && '↩ '}{isTrial && '🧪 '}{b.pairedWithPrev && '👯 '}#{b.seq} {lotKeyText(b.lot)}
                              </div>
                              <div style={{ fontSize: 11, color: 'var(--text2)', whiteSpace: 'nowrap', pointerEvents: 'none' }}>
                                {isUnknown ? '⚠ ไม่มี CT'
                                  /* ยังไม่จบในกะนี้ — ในโหมดกะเดียวไม่มี "กะถัดไป" ให้ไหลไป จึงบอกเวลาตามเดิม */
                                  : run.cutRight ? (multi ? `${qtyText(b.lot.qty_plan)} ชิ้น · ทำต่อกะถัดไป ↪`
                                                          : `${qtyText(b.lot.qty_plan)} ชิ้น · ${fmtMin(b.runMin)}`)
                                  /* ท่อนต่อท่อนสุดท้าย — สิ่งที่คนกะนี้อยากรู้คือ "ของที่รับช่วงมาจบกี่โมง"
                                     ไม่ใช่ความยาวรวมของล็อต (ซึ่งเกิดไปแล้วครึ่งนึงตั้งแต่กะก่อน) */
                                  : run.cutLeft ? `ต่อจากกะก่อน · จบ ${fmtHm(b.endMs)}`
                                  /* 🔴 ต้องขึ้นคำว่า "ขอ" — เวลาของงานทดลองคนกรอก ไม่ใช่ระบบคำนวณ */
                                  : isTrial ? `ทดลอง ${qtyText(b.lot.qty_plan)} ชิ้น · ขอ ${fmtMin(b.runMin)}`
                                  : `${qtyText(b.lot.qty_plan)} ชิ้น · ${fmtMin(b.runMin)}`}
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* พื้นที่วางท้ายสุด (ลากมาต่อท้าย) — อยู่บรรทัดสุดท้ายที่วาดเท่านั้น */}
                {editable && dragId && ri === lastRowIdx && (
                  <div onDragOver={(e) => { e.preventDefault(); setOverIdx(lay.boxes.length); }}
                    onDrop={(e) => { e.preventDefault(); drop(lay.boxes.length); }}
                    style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '14%',
                      background: overIdx === lay.boxes.length ? 'rgba(34,197,94,0.15)' : 'transparent' }} />
                )}
              </div>
            </div>
          </div>
        );
      })}

      {/* 🔴 วันหยุดที่ขอบเขตข้ามไป ต้องเขียนบนจอ — ข้ามเงียบ = คนอ่านวันจบผิดโดยไม่รู้ตัว */}
      {skipped.length > 0 && (
        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginLeft: multi ? LABEL_W + 8 : 0 }}
          title="โรงงานไม่เดินเครื่องวันนี้ — คิวหยุดนับเวลาแล้วไปต่อวันเปิดถัดไป">
          ⏸ ข้ามวันหยุด {skipped.slice(0, 3).map(d => `${dm(d.workDate)} (${d.reason})`).join(' · ')}
          {skipped.length > 3 ? ` …อีก ${skipped.length - 3} วัน` : ''}
        </div>
      )}

      {/* ── บรรทัดความจริงใต้ราง ── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', fontSize: 11.5, marginLeft: multi ? LABEL_W + 8 : 0 }}>
        <span style={{ color: 'var(--text2)' }}>
          🏁 คิวจบ <b style={{ color: over ? '#ef4444' : 'var(--text)' }}>
            {lay.unknownCount > 0 ? '—' : (spansDays || multi ? fmtDayHm(lay.endMs) : fmtHm(lay.endMs))}</b>
          {/* 🔴 "ล้น" ที่นี่ = ล้นเลย**ขอบเขตทั้งหมด** ไม่ใช่ล้นกะ — งานที่ล้นกะไหลไปกะถัดไปแล้ว */}
          {lay.overflowMin > 0 && <b style={{ color: '#ef4444' }}> · ล้นเลยขอบเขต {fmtMin(lay.overflowMin)}</b>}
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
