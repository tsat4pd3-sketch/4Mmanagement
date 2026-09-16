/* ══ แถบ "นาทีที่หายไปของกะ" — งาน / หยุดตามแผน / เสียนอกแผน / อธิบายไม่ได้ ═══════════
   ที่มา (user 2026-09-16): "จะรู้ได้ยังไงว่าตอนนี้ดีเลย์ไปแล้วกี่ใบ และต้อง recover ยังไง"

   ⭐ ทำไมเป็นนาที ไม่ใช่ "กี่ใบ":
     · 1 ใบของคนละพาร์ท CT ต่างกัน · ใบที่ช้า 2 นาทีกับ 3 ชม. นับเป็น 1 เท่ากัน
     · ใบ backfill = 35% ของใบทั้งระบบ ถูกยกเว้นจากการตีดีเลย์รายใบ ⇒ นับใบยังไงก็ต่ำกว่าจริง
     · "ต้อง recover เท่าไหร่" ตอบด้วยนาทีเท่านั้น (เทียบกับเวลาที่เหลือ/OT ได้ตรงๆ)

   🔴 ตัวเลขทั้งหมดมาจาก `liveTimeSplit(computeLiveOee(...))` — **ห้ามคำนวณเองในหน้า**
      สูตรอยู่ `src/utils/oee.js` ที่เดียวเหมือน OEE (ผลคือเลขนาทีตรงกับ %A/%P/%Q ที่โชว์อยู่แล้ว)

   🔴 กฎความซื่อสัตย์ของจอ — `state` ต้องขึ้นข้อความเสมอ ห้ามโชว์แต่ตัวเลขเปล่า:
      over      = งานมาตรฐาน > เวลาที่มี ⇒ ข้อมูลผิด (⬜ = 0 ที่นี่ **ไม่ได้แปลว่าทันเป้า**)
      no_ct     = บางพาร์ทไม่ตั้ง CT ⇒ ⬜ สูงเกินจริง
      no_output = ยังไม่ผลิตชิ้นแรก ⇒ ⬜ เต็ม runMin (จริง แต่ต้องบอกว่าเพราะยังไม่เริ่ม)
   ═══════════════════════════════════════════════════════════════════════════════════ */

const SEGS = [
  { k: 'workMin',    c: '#22c55e', icon: '🟩', label: 'ทำได้' },
  { k: 'plannedMin', c: '#4d9fff', icon: '🟦', label: 'หยุดตามแผน' },
  { k: 'dtMin',      c: '#f59e0b', icon: '🟧', label: 'เสียนอกแผน' },
  { k: 'unknownMin', c: '#9ca3af', icon: '⬜', label: 'อธิบายไม่ได้' },
];

const NOTE = {
  over:      { c: '#ef4444', t: 'งานมาตรฐานเกินเวลาที่มี — ตัวเลขยังเชื่อไม่ได้ ตรวจ CT / ยอด / เวลาเปิด-ปิดใบ' },
  no_ct:     { c: '#f59e0b', t: 'บางชิ้นงานยังไม่ได้ตั้ง cycle time — ช่อง "อธิบายไม่ได้" สูงกว่าความจริง' },
  no_output: { c: 'var(--muted)', t: 'ยังไม่ผลิตชิ้นแรกของกะ — เวลาที่เดินได้ยังไม่มีคำอธิบาย' },
};

export default function ShiftTimeSplit({ split, compact = false }) {
  if (!split) return null;
  const note = NOTE[split.state];
  // ฐานของแถบ = ผลรวมก้อนที่วาดจริง (ไม่ใช่ elapsedMin) — ไลน์เครื่องขนาน capacityMin > runMin
  // ทำให้ผลรวมเกิน elapsed ได้ ถ้าหารด้วย elapsed แถบจะล้นกรอบเงียบๆ
  const total = SEGS.reduce((a, s) => a + (Number(split[s.k]) || 0), 0) + (Number(split.breakMin) || 0);
  if (!(total > 0)) return null;
  const fs = compact ? 11 : 12;

  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: 'flex', height: compact ? 7 : 9, borderRadius: 4, overflow: 'hidden', background: 'var(--border2)' }}>
        {SEGS.map(s => {
          const v = Number(split[s.k]) || 0;
          if (v <= 0) return null;
          return (
            <div key={s.k} title={`${s.label} ${Math.round(v)} นาที`}
              style={{ width: `${(v / total) * 100}%`, background: s.c, transition: 'width 0.7s ease' }} />
          );
        })}
        {/* เวลาพักตามนโยบาย — ถูกกันออกจากฐานไปแล้ว ไม่ใช่เวลาที่เสีย จึงวาดจางไว้ท้ายแถบ */}
        {split.breakMin > 0 && (
          <div title={`พักตามนโยบาย ${Math.round(split.breakMin)} นาที (ไม่นับเป็นเวลาที่เสีย)`}
            style={{ width: `${(split.breakMin / total) * 100}%`, background: 'var(--border)' }} />
        )}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4, alignItems: 'baseline' }}>
        {SEGS.map(s => {
          const v = Math.round(Number(split[s.k]) || 0);
          if (v <= 0 && s.k !== 'unknownMin') return null;
          const hot = s.k === 'unknownMin' && v > 0;
          return (
            <span key={s.k} title={s.label} style={{ fontSize: fs, color: hot ? 'var(--text)' : 'var(--muted)', fontWeight: hot ? 800 : 600 }}>
              {s.icon} {s.label} <span style={{ color: s.c, fontWeight: 800 }}>{v}</span> น.
            </span>
          );
        })}
        {split.unit === 'machine' && (
          <span style={{ fontSize: fs, color: 'var(--muted)' }}>· ฐาน = เวลาเครื่อง ×{split.parallelCap}</span>
        )}
      </div>

      {note && (
        <div style={{ fontSize: fs, color: note.c, fontWeight: 700, marginTop: 3 }}>⚠️ {note.t}</div>
      )}
      {split.startTimeOutOfFrame && (
        <div style={{ fontSize: fs, color: '#ef4444', fontWeight: 700, marginTop: 2 }}>
          ⚠️ เวลาเริ่มกะที่บันทึกไว้อยู่นอกกรอบกะนี้ — ระบบใช้ต้นกะแทนให้ชั่วคราว ให้แก้เวลาเริ่มกะที่ Daily Report
        </div>
      )}
      {split.noBreakPolicy && (
        <div style={{ fontSize: fs, color: 'var(--muted)', marginTop: 2 }}>· ยังไม่ได้ตั้งนโยบายเวลาพักของกะนี้ — เทียบกับค่าที่บันทึกตอนปิดกะไม่ได้</div>
      )}
    </div>
  );
}
