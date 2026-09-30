/* ══ 🔗 สรุปดีเลย์ของวัน + "หลุดมาจากตัวไหน พาลไปโดนตัวไหน" (2026-09-30 · คำขอทีมปั๊ม) ═══════
   คำขอ: *"งานดีเลย์ มันก็จะถีบออกไปเรื่อยๆ ละพอไม่ทันก็ยกยอดไปวันถัดไป แล้วสรุปวันนี้ดีเลย์ไปกี่งาน
          ... และเห็นว่ามันหลุดมาจากตัวไหน พาลไปโดนตัวไหนบ้าง"*

   2 บรรทัดบนหัวบอร์ด:
     📆 วันนี้หลุดกรอบ N งาน (ปิดช้า x · ยังค้าง y) · ↷ ต้องยกยอด z ใบ · ยกยอดมา w ใบ
     🔗 ต้นเหตุ: <ใบ> ค้าง 1:40 → พาลไป 5 ใบ (+ ใบถัดไปที่หนักรองลงมา)

   🔴 กติกา:
     · ตัวเลขมาจาก `dayDelaySummaryOf()` / `pushChainOf()` (`utils/heijunkaQueue.js`) **ห้ามคิดในหน้า**
     · **"วันนี้หลุดกรอบ N งาน" ≠ "ดีเลย์ N ใบ" ของหัวบอร์ดเดิม** — อันเดิมคือ *ตอนนี้ค้างกี่ใบ*
       อันนี้รวม**ใบที่ช้าแล้วปิดไปได้แล้ว**ด้วย (มันคือเหตุที่ทำให้ใบอื่นถูกพาล จะหายไปจากสรุปวันไม่ได้)
     · เลข MAT ต้องวาดผ่าน `<MatLabel>` (UI §6.21) — คนอ่านต้องรู้ว่าเลขนั้นคือชิ้นงานอะไร
     · ไม่มีอะไรหลุด = **ไม่วาดเลย** (ห้ามโชว์ "0 งาน" ให้รกจอ TV)
     · ห้ามกระพริบ · ฟอนต์ ≥ 11px
   ══════════════════════════════════════════════════════════════════════════════════════════ */
import MatLabel from './MatLabel';
import { fmtSlipMin } from './PlanSlipBar';

export default function DelayBlameBar({ day, chains = [], size = 12, maxChains = 2 }) {
  if (!day) return null;
  const { lateJobs, lateDone, stillLate, willCarry, carriedIn, dayOver } = day;
  const top = chains.filter(c => c.victimCount > 0 || c.ownLateMin > 0).slice(0, maxChains);
  if (!lateJobs && !willCarry && !carriedIn && !top.length) return null;

  const chip = (c) => ({
    display: 'inline-flex', alignItems: 'baseline', gap: 4, fontSize: size, fontWeight: 700, color: c,
  });

  return (
    <div style={{ display: 'grid', gap: 3, minWidth: 0 }}>
      {/* ── บรรทัดสรุปวัน ── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 10, minWidth: 0 }}>
        {lateJobs > 0 && (
          <span title="งานที่หลุดกรอบเวลาของตัวเองในวันงานนี้ — รวมใบที่ช้าแล้วปิดไปได้แล้ว (คนละเลขกับ 'ดีเลย์ N ใบ' ที่บอกว่าตอนนี้ค้างกี่ใบ)"
            style={chip('#ef4444')}>
            📆 วันนี้หลุดกรอบ {lateJobs} งาน
            <span style={{ fontSize: size - 1, fontWeight: 600, color: 'var(--muted)' }}>
              (ปิดช้า {lateDone} · ยังค้าง {stillLate})
            </span>
          </span>
        )}
        {willCarry > 0 && (
          <span title={dayOver
              ? 'ใบที่ปิดไม่ได้จนจบวันงานนั้น — ของจริงคือถูกยกยอดไปวันถัดไป'
              : 'ใบที่คิวดันไปจบเลยกรอบวันงาน (08:00 ของวันถัดไป) — ของจริงคือต้องยกยอดไปวันถัดไป'}
            style={chip('#f59e0b')}>↷ {dayOver ? 'ไม่จบในวันงาน' : 'ต้องยกยอด'} {willCarry} ใบ</span>
        )}
        {carriedIn > 0 && (
          <span title="ใบที่ยกยอดมาจากกะ/วันก่อน = หนี้เก่าที่วันนี้ต้องแบก"
            style={chip('var(--text2)')}>⤵ ยกยอดมา {carriedIn} ใบ</span>
        )}
      </div>

      {/* ── สายการถีบ: ต้นเหตุ → ผู้ถูกพาล ── */}
      {top.map(c => (
        <div key={c.rootKey} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 5, fontSize: size - 0.5, minWidth: 0 }}>
          <span style={{ fontWeight: 800, color: '#ef4444' }}>🔗 ต้นเหตุ</span>
          {c.root?.prod_no && (
            <span title="เลขใบผลิต (บาร์โค้ดบัตรคัมบัง)" style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--text)' }}>
              #{c.root.prod_no}
            </span>
          )}
          <MatLabel mat={c.root?.mat_no} size={size - 0.5} />
          <span style={{ fontWeight: 800, color: '#ef4444' }}>กินเวลาเกิน {fmtSlipMin(c.ownLateMin)}</span>
          {c.victimCount > 0 ? (
            <span title={`ใบที่ถูกเลื่อนออกไปเพราะใบนี้: ${c.victims.map(v => `${v.o?.prod_no || v.key} (+${v.blameMin} น.)`).join(' · ')}`}
              style={{ fontWeight: 700, color: '#f97316' }}>
              → พาลไป {c.victimCount} ใบ
              <span style={{ fontWeight: 600, color: 'var(--muted)' }}>
                {' '}(หนักสุด +{fmtSlipMin(Math.max(...c.victims.map(v => v.blameMin)))})
              </span>
            </span>
          ) : (
            <span style={{ fontWeight: 600, color: 'var(--muted)' }}>— ยังไม่มีใบต่อท้ายถูกกระทบ</span>
          )}
        </div>
      ))}
    </div>
  );
}
