import PartThumb from './PartThumb';
import { useMatIndex } from './MatLabel';
import { matInfo } from '../utils/matLabel';

/* ═══ 🃏 PartCard — การ์ดพาร์ท/สต๊อกมาตรฐานของทั้งระบบ (2026-09-25 · คำสั่ง user)

   *"หลายจอที่เป็นการ์ดมอนิเตอร์สตอคในระบบ มีหลายแบบมาก audit และปรับให้เป็นมาตรฐานที
     อย่างน้อยสโตร์ งานเบอร์ 2xx, 3xx, 5xx ควรเหมือนกัน ... เรื่อง layout การ์ด
     อยากให้ได้มาตรฐาน มีรูปชิ้นงาน เหมือนกัน"*

   audit 25/09 ก่อนทำ — การ์ดพาร์ทในระบบวาดเองทุกจอ ไม่มีจอไหนเหมือนกัน:
     `borderRadius` ที่ใช้จริง: 5 · 6 · 7 · 8 · 10 · 11 · 12 · 14 · 20 · 50%
     รูปชิ้นงาน: มีแค่ `/heijunka` (เพิ่ง 25/09) · อีก 6 จอไม่มีเลย
     เลข MAT: บางจอวาดเปล่า บางจอมีชื่อ บางจอเอาเหตุผลยาวๆ มาต่อเป็นย่อหน้า

   🔴 **การ์ดที่แสดง "ของ 1 ชิ้น/พาร์ท 1 ตัว" ต้องใช้ตัวนี้ ห้ามวาดเองอีก** (UI §6.23)
   โครง (บนลงล่าง) — เหมือนกันทุกจอ:
     ▎ [รูป 84] รหัส+ชื่องาน                      [ป้ายสถานะ]
     ▎ ป้ายเล็ก           ป้ายเล็ก
     ▎ ตัวเลขใหญ่ หน่วย    ค่าขวา (หนีบ 2 บรรทัด)
       ───────────────────────────────
       ป้าย 60px  ค่า            ← แถวคีย์-ค่า ห้ามต่อเป็นย่อหน้า
       ───────────────────────────────
                      [ ปุ่มลงมือ 44px ]

   กติกาที่ห้ามพัง (เหตุผลเต็ม + ตัวเลขที่วัดได้ → UI §6.22-6.24):
   1. สีสถานะใช้ได้ 2 จุด: **แถบซ้าย + ป้าย** — พื้นการ์ดเป็นกลางเสมอ
   2. ทุกตัวเลขมีป้ายกำกับ · ป้าย `nowrap` · ตัวเลข `tabular-nums`
   3. ไม่มีรูป = กล่อง 🖼️ **ห้ามเว้นว่างเงียบ**
   4. `img` ส่งมาจากพ่อ (ผ่าน `usePartImages()`) — **การ์ดห้ามยิง DB เอง**
      (การ์ด 100 ใบ = 100 คิวรี · กฎเหล็ก DB ข้อ 11)
   5. `alert` = พื้นแดงจางทั้งใบ **สงวนไว้สำหรับ "ต้องรีบจริง" เท่านั้น** (ของขาด/เลยกำหนด)
      ใช้พร่ำเพรื่อ = กลับไปเป็นกำแพงสีเหมือนก่อนแก้
   ═══════════════════════════════════════════════════════════════════════════════ */

export const PC_LABEL = {
  fontSize: 11, fontWeight: 700, color: 'var(--muted)',
  letterSpacing: 0.2, lineHeight: 1.3, whiteSpace: 'nowrap',
};
export const PC_NUM = { fontVariantNumeric: 'tabular-nums' };
const CLAMP2 = { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' };

/** ความกว้างขั้นต่ำของกริดการ์ด — แคบกว่านี้ รูป 84px จะบีบเนื้อหาจนป้ายตัดบรรทัด (วัดจริง 25/09) */
export const PART_CARD_MIN = 330;
export const partCardGrid = (min = PART_CARD_MIN) => ({
  display: 'grid',
  gridTemplateColumns: `repeat(auto-fill, minmax(min(${min}px, 100%), 1fr))`,
  gap: 12,
  alignContent: 'start',   // ไม่งั้นการ์ดถูกยืดสูงผิดสัดส่วนเมื่อ grid สูงกว่าเนื้อหา
});

export default function PartCard({
  code, name, sub,                 // รหัส (mat_no) · ชื่องาน · บรรทัดรอง (ซัพพลายเออร์/ลูกค้า)
  img, showImg = true,             // รูปจาก imgOf(code) — showImg=false เมื่อการ์ดไม่ใช่ "ชิ้นงาน"
  status,                          // { label, color, bg, border }
  metric,                          // { label, value, unit }
  aside,                           // { label, value } — คอลัมน์ขวาของแถวค่าหลัก
  rows = [],                       // [{ k, v }] — ห้ามส่งประโยคยาวมาแทน
  note,                            // ⚠️ ประโยคที่ "ระบบประกอบมาให้" (เช่น `detail` ของวิว abnormal)
                                   //    ใช้ได้เฉพาะข้อความที่เป็นประโยคจริงๆ **ห้ามเอาข้อมูลคีย์-ค่ามายัด**
  footer,                          // node ท้ายการ์ด (ปุ่ม/แถบคำสั่ง) — ใช้ storeBtn()
  alert = false,                   // ต้องรีบจริงเท่านั้น
  dim = false,                     // งานที่จบแล้ว (จางลง แต่ยังอ่านได้)
  matTone,                         // สีเลข MAT (เช่น matColor ตามหมวดเลข) — ไม่ส่ง = สีข้อความปกติ
  onClick, style, className,   // className = คลาสกลาง เช่น `mo-card-alert` (กระพริบแดง · ห้ามเขียน keyframes เอง)
}) {
  const st = status || {};
  const index = useMatIndex();
  const info = matInfo(code, index, { name });
  const metaRows = (rows || []).filter(r => r && r.v != null && String(r.v).trim() !== '');
  return (
    <article onClick={onClick} className={className} style={{
      position: 'relative', background: 'var(--card)',
      border: `1px solid ${alert ? 'rgba(239,68,68,0.45)' : 'var(--border)'}`,
      borderRadius: 'var(--radius-lg)', overflow: 'hidden', boxShadow: 'var(--shadow-sm)',
      display: 'flex', flexDirection: 'column', opacity: dim ? 0.62 : 1,
      cursor: onClick ? 'pointer' : undefined,
      // เคลือบแดงจางแทน color-mix (เพดาน Chromium 94 จอ TV — CLAUDE.md)
      backgroundImage: alert ? 'linear-gradient(rgba(239,68,68,0.07), rgba(239,68,68,0.07))' : undefined,
      ...style,
    }}>
      {st.color && <span aria-hidden style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: st.color }} />}

      <div style={{ padding: '12px 12px 12px 15px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        {showImg && <PartThumb url={img} alt={[code, name].filter(Boolean).join(' · ')} size={84} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
            {/* เลข MAT + ชื่องาน + Part No. ครบตาม UI §6.21 (ห้ามวาด mat_no เปล่าที่ที่คนตัดสินใจจากเลข)
                🔴 แต่ **วางเป็นชั้น ไม่ใช่ inline** — `<MatLabel>` เป็น inline-flex + wrap ซึ่งออกแบบมาสำหรับ
                   ตาราง/ชิป · พอเอามาใส่คอลัมน์แคบของการ์ด (เหลือ ~150px หลังหักรูป 84) มันตัดบรรทัด
                   กลางวลีจนได้ 4 บรรทัดรุ่งริ่ง (เห็นจากจอจริงตอนทำ) — จึงอ่านทะเบียนตัวเดียวกัน
                   (`useMatIndex`/`matInfo`) แล้ววาดเองเป็น 3 ชั้น ข้อมูลยังมาจากแหล่งเดียว */}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontFamily: 'monospace', fontWeight: 800, color: matTone || 'var(--text)', ...PC_NUM }}>{info.mat}</div>
              {info.name && <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2, lineHeight: 1.35 }}>{info.name}</div>}
              {info.pNo && <div title="Part No. ของลูกค้า" style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--muted)', marginTop: 1 }}>{info.pNo}</div>}
            </div>
            {st.label && (
              <span style={{
                fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 'var(--radius)',
                whiteSpace: 'nowrap', background: st.bg, border: `1px solid ${st.border}`, color: st.color,
              }}>{st.label}</span>
            )}
          </div>
          {sub && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>{sub}</div>}
        </div>
      </div>

      {(metric || aside) && (
        <div style={{
          padding: '0 12px 12px 15px', display: 'grid',
          gridTemplateColumns: metric && aside ? 'auto minmax(0, 1fr)' : '1fr', gap: 12, alignItems: 'flex-end',
        }}>
          {metric && (
            <div>
              <div style={PC_LABEL}>{metric.label}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', lineHeight: 1.15, whiteSpace: 'nowrap', ...PC_NUM }}>
                {metric.value}
                {metric.unit ? <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginLeft: 4 }}>{metric.unit}</span> : null}
              </div>
            </div>
          )}
          {aside && (
            <div style={{ minWidth: 0, textAlign: metric ? 'right' : 'left' }}>
              <div style={PC_LABEL}>{aside.label}</div>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)', lineHeight: 1.3, ...CLAMP2 }}
                title={String(aside.value ?? '')}>{aside.value}</div>
            </div>
          )}
        </div>
      )}

      {metaRows.length > 0 && (
        <dl style={{ margin: 0, padding: '8px 12px 10px 15px', borderTop: '1px solid var(--border)', display: 'grid', gap: 3 }}>
          {metaRows.map(r => (
            <div key={r.k} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
              <dt style={{ ...PC_LABEL, flex: '0 0 60px' }}>{r.k}</dt>
              <dd style={{ margin: 0, fontSize: 11.5, color: 'var(--text2)', minWidth: 0, lineHeight: 1.4, ...PC_NUM }}>{r.v}</dd>
            </div>
          ))}
        </dl>
      )}

      {note && (
        <div style={{
          padding: '8px 12px 10px 15px', borderTop: '1px solid var(--border)',
          fontSize: 11.5, color: 'var(--text2)', lineHeight: 1.5,
        }}>{note}</div>
      )}

      {footer && (
        <div style={{ marginTop: 'auto', padding: '10px 12px 12px 15px', borderTop: '1px solid var(--border)' }}>
          {footer}
        </div>
      )}
    </article>
  );
}
