/* 📺 แถบบอกหน้าของจอ TV ที่หมุนหน้าเอง (useTvPager) — กลางล่าง · มีหน้าเดียว = ไม่วาด
   · บอก "หน้า 2/3" + จุด · ⏸/▶ หยุดหมุน · ‹ › เปลี่ยนเอง · "เลื่อนเอง" = ปิดการแบ่งหน้า (คนนั่งดูที่โต๊ะ)
   · บอร์ดเดียวยาวเกินจอ = เลื่อนต่อในบอร์ดเดิม ⇒ เขียน "บอร์ดนี้ต่อ 2/3" ให้รู้ว่ายังไม่ใช่บอร์ดถัดไป
   · อยู่กลางล่าง — มุมขวาล่างเป็นที่ของชิปไซเรน (DowntimeSiren) */
import useTvShell from '../utils/useTvShell';
import { SUBPAGE_ATTR } from '../utils/displayRotation';

export default function TvPagerBar({ pager, intervalSec = 20, onScrollMode }) {
  const tv = useTvShell();   // 📺 จอประชุม: ตัวใหญ่ให้อ่านจากระยะ 2–3 ม. ว่าอยู่หน้าไหน (UI §6.32)
  if (!pager || pager.pageCount < 2) return null;
  const fz = tv ? 18 : 13;
  const btn = {
    border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text)', borderRadius: 7,
    padding: tv ? '4px 12px' : '3px 9px', fontSize: fz, fontWeight: 700, cursor: 'pointer', lineHeight: 1.3,
  };
  return (
    <div {...{ [SUBPAGE_ATTR]: `${pager.page + 1}/${pager.pageCount}` }} style={{
      position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: 'calc(12px + var(--mnav-h, 0px))', zIndex: 900,
      display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 12,
      background: 'var(--card)', border: '1px solid var(--border2)', boxShadow: 'var(--shadow-float)',
      fontSize: fz, fontWeight: 700, color: 'var(--text2)',
    }}>
      <button type="button" style={btn} onClick={pager.prev} aria-label="หน้าก่อน">‹</button>
      <span>หน้า {pager.page + 1}/{pager.pageCount}</span>
      <span aria-hidden style={{ display: 'flex', gap: 4 }}>
        {Array.from({ length: pager.pageCount }, (_, i) => (
          <span key={i} style={{ width: tv ? 12 : 8, height: tv ? 12 : 8, borderRadius: '50%', background: i === pager.page ? 'var(--accent)' : 'var(--border2)' }} />
        ))}
      </span>
      <button type="button" style={btn} onClick={pager.next} aria-label="หน้าถัดไป">›</button>
      <button type="button" style={btn} onClick={() => pager.setPaused(!pager.paused)}>
        {pager.paused ? '▶ หมุนต่อ' : `⏸ หมุนทุก ${intervalSec} วิ`}
      </button>
      {onScrollMode && <button type="button" style={{ ...btn, color: 'var(--muted)' }} onClick={onScrollMode}>เลื่อนเอง</button>}
      {pager.parts > 1 && <span style={{ color: '#f59e0b', fontSize: tv ? 18 : 12 }}>บอร์ดนี้ยาวเกินจอ — ต่อ {pager.part}/{pager.parts}</span>}
    </div>
  );
}
