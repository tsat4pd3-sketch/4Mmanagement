/* ══ ⛔ หน้าตาแถบ "เครื่องหยุด" บนบอร์ด Heijunka — ที่เดียวของทั้งระบบ (2026-11-04) ════
 *
 * เหตุผล/ตัวเลขที่ทำให้ต้องมี → `src/utils/downtimeBands.js` (หัวไฟล์)
 * สรุป: ช่องว่างบนบอร์ดคือ **เวลาที่เครื่องหยุดจริง** แต่เดิมวาดเป็นขีดสูง 4-5px ชิดขอบบน
 * ⇒ บนจอ TV มองไม่เห็น หน้างานอ่านว่า "โปรแกรมเรียงใบไม่ต่อเนื่อง"
 *
 * 🔴 กติกาที่ห้ามถอด:
 *   ① **ต้องอยู่ใต้ใบกัมบัง** (`zIndex: 0`) — ใบงานคือของหลักของบอร์ด ห้ามถูกบัง
 *      (ใบวาด zIndex ≥ 1 · แถบพักก็ zIndex 0 เหมือนกัน ⇒ ช่วงที่ทับกันเห็นทั้งคู่)
 *   ② **ลายเฉียง ไม่ใช่สีทึบ** — สีทึบเต็มแถวกลืนกับใบงาน/แถบพัก แยกไม่ออกว่าอันไหนงาน
 *   ③ **แดง = หยุดไม่ได้วางแผน · เทา = งานตามแผน (PM)** — กฎ "งานตามแผนไม่ใช่ปัญหา"
 *      (CLAUDE.md §อื่นๆ ห้ามขึ้นอันดับ 1 ข้อ 3) ห้ามตีสีเดียวกัน
 *   ④ **ฟอนต์ขั้นต่ำ 11px** (ด่าน `font-min-11`) · แคบกว่าป้าย = ไม่พิมพ์ (ลายกับ tooltip ยังบอกได้)
 *      ห้ามหมุนตั้ง 90° (เคสแถบพัก: ถูกตัดกลางคำ อ่านไม่ออก แล้วไปทับใบงาน)
 *   ⑤ `pointerEvents` ต้องเปิดไว้ที่ตัวแถบเพื่อให้ชี้เมาส์อ่านเหตุได้ — แต่ **ห้ามกินคลิกของใบ**
 *      (ใบอยู่เหนือกว่าอยู่แล้ว ⇒ คลิกใบยังโดนใบ)
 *
 * 📄 docs/UI-CONVENTIONS.md §6.31
 * ══════════════════════════════════════════════════════════════════════════════════════ */

/**
 * @param {{ band:{ w:Object, leftPct:number, widthPct:number }, label:string,
 *           pxWidth?:number, fontSize?:number }} p
 *   `pxWidth` = ความกว้างจริงของแถบในหน่วย px (เอาไว้ตัดสินว่าพิมพ์ป้ายได้ไหม) · ไม่ส่ง = ไม่พิมพ์
 */
export default function DowntimeBand({ band, label, pxWidth = 0, fontSize = 11 }) {
  const { w, leftPct, widthPct } = band || {};
  if (!w) return null;
  /* ③ งานตามแผน (PM) = เทา · หยุดเสีย = แดง
     🔴 สีมาจาก token ใน index.css เท่านั้น (ด่าน `colorRatchet` · UI §6.17 · คำสั่ง user 04/11)
        ห้ามเขียน hex/rgba ดิบในไฟล์นี้ — ธีมสว่าง/มืดใช้คนละค่า */
  const tone = w.planned
    ? { ink: 'var(--muted)', stripe: 'var(--border)' }
    : { ink: 'var(--red)',   stripe: 'var(--red-line)' };
  const fs = Math.max(11, fontSize);                 // ④ ห้ามต่ำกว่า 11 (จอ TV)
  const text = `⛔ ${w.name || 'เครื่องหยุด'}${w.min ? ` ${w.min}น.` : ''}`;
  return (
    <div title={label} style={{
      position: 'absolute', top: 0, bottom: 0,
      left: `${leftPct}%`, width: `${widthPct}%`,
      /* ② ลายเฉียง — ทิศตรงข้ามแถบพัก (45°) เพื่อให้แยกออกจากกันทันทีแม้ขาวดำ */
      /* ลายทึบครึ่งหนึ่งของพื้นที่ ⇒ `-line` (α .40) ให้ความเข้มรวม ≈ .20 เท่าที่ออกแบบไว้
         (ใช้ `-dim` α .12 แล้วจางเกินกว่าจะเห็นจากระยะยืนดูบอร์ด = หมดความหมายของงานนี้) */
      background: `repeating-linear-gradient(-45deg, ${tone.stripe} 0px, ${tone.stripe} 5px, transparent 5px, transparent 10px)`,
      borderLeft: `1px solid ${tone.ink}`, borderRight: `1px solid ${tone.ink}`,
      zIndex: 0,                                     // ① ใต้ใบกัมบังเสมอ
      cursor: 'help', overflow: 'hidden',
      /* ⑥ ป้ายอยู่ **ขอบล่าง** แบบเดียวกับแถบพัก — ใบกัมบังเว้นขอบบน-ล่างไว้
         ⇒ แถบคาดกลางจะถูกใบทับจนอ่านไม่ออก (พิสูจน์แล้วว่าแถบพักอ่านได้ที่ตำแหน่งนี้) */
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }}>
      {pxWidth >= 58 && (
        <span style={{
          fontSize: fs, fontWeight: 800, color: tone.ink,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', padding: '0 2px',
          marginBottom: 1, textShadow: '0 1px 2px var(--bg2)',
        }}>{text}</span>
      )}
    </div>
  );
}
