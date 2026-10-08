/* ══ 📋 แถบ "หลุดแผนไปแค่ไหน" บนบอร์ดไทม์ไลน์ (2026-09-30 · feedback หน้างาน) ═════════════
   คอมเมนต์ที่ได้มาเยอะ: *"ไม่รู้ว่าดีเลย์หรือหลุดแผนไปแค่ไหน เพราะการ์ดใหม่จะต่อไปเรื่อยๆ"*
   บอร์ดเดิมบอกได้แค่ "⚠️ ดีเลย์ N ใบ" + "→ จบ ~HH:MM" ⇒ อ่านไม่ออกว่า **ขนาด** เท่าไหร่
   (ค้าง 1 ใบ 3 ชม. กับ 3 ใบ 5 นาที ขึ้นเลขเท่ากัน) และไม่มีตัวเทียบว่า "ควรได้เท่าไหร่แล้ว"

   คำสั่ง user 2026-09-30: **"เอาทั้งสอง เวลา+ยอด ในแถบเดียว"**
   ⇒ 1 บรรทัด: ⏱️ ช้ากว่าแผนกี่นาที · 📦 ขาดกี่ชิ้น · 🏁 คาดจบกี่โมง (เกินกะเท่าไหร่) · กี่ใบไม่ทันกะ

   🔴 กติกา (ห้ามแก้ให้ "ดูดีขึ้น" โดยละเมิดข้อไหนก็ตาม):
     · ตัวเลขทุกตัวมาจาก `planStatusOf()` (`utils/heijunkaQueue.js`) **ห้ามคำนวณเองในหน้า**
       — เดิมบอร์ด 2 จอเคยคิดดีเลย์คนละสูตรแล้วขึ้นเลขคนละเลข (audit 2026-09-16)
     · **ประเมินไม่ได้ต้องเขียนว่าไม่รู้ ห้ามโชว์ 0** (ไม่มี CT = จอต้องบอก ไม่ใช่ทำเหมือนทันแผน)
     · **ห้ามกระพริบ** — แดงนิ่งพอ (UI-CONVENTIONS: กระพริบเฉพาะ Andon แดงของไลน์)
     · ฟอนต์ ≥ 11px (จอ TV) · ใช้ token สีของธีม ห้าม rgba ดิบ/`color-mix()`
   ══════════════════════════════════════════════════════════════════════════════════════════ */

/* 95 → "1:35 ชม." · 45 → "45 น." (จอ TV อ่านชั่วโมง:นาที เร็วกว่าเลขนาทีดิบ 3 หลัก) */
export function fmtSlipMin(min) {
  const m = Math.max(0, Math.round(min || 0));
  if (m < 60) return `${m} น.`;
  /* ≥ 1 วัน ต้องอ่านเป็น "วัน" — "1368:00 ชม." อ่านไม่ออกและดูเหมือนจอพัง
     (ของจริงเกิดได้เมื่อยกยอดข้ามวันหลายกะ · เคสวันย้อนหลังถูก clamp ที่ heijunkaQueue แล้ว) */
  if (m >= 1440) { const d = Math.floor(m / 1440), r = m % 1440; return `${d} วัน ${Math.floor(r / 60)}:${String(r % 60).padStart(2, '0')} ชม.`; }
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')} ชม.`;
}

/* oneLine = ใช้ในคอลัมน์ซ้ายของแถวบอร์ด (ความสูงแถวถูกล็อกด้วยแถบเวลา 2 กะ = 72px)
   ⇒ ห้ามตัดบรรทัด ไม่งั้นแถวสูงเกินแล้วแถบเวลาลอยไปกองบน (จอ TV เห็นเป็นช่องว่างแปลกๆ)
   รายละเอียดเต็มอยู่ใน tooltip + แถบหัวบอร์ดที่ตัดบรรทัดได้ */
/* compact = คอลัมน์ซ้ายของแถวกว้างแค่ ~140px (วัดจริงใน harness) ⇒ ประโยคเต็มถูก ellipsis ตัดทิ้ง
   แล้วคนบนจอ TV ที่ไม่มีเมาส์จะไม่เคยเห็นตัวเลขหลังจุด ⇒ แถวโชว์แค่ 2 ตัวที่ตัดสินใจได้จริง
   (ช้ากี่นาที · คาดจบกี่โมง) ที่เหลือ (ขาดกี่ชิ้น · กี่ใบไม่ทันกะ) อยู่หัวบอร์ดซึ่งมีที่ + tooltip */
export default function PlanSlipBar({ st, fmtMs, size = 11, showOk = false, oneLine = false, compact = false }) {
  if (!st) return null;
  const { slipMin, behindMin, behindPcs, finishMs, overShiftMin, lateCards, noCt, remainCards, delayed, neverClosed } = st;

  /* ไม่มีงานเหลือ = ไม่มีอะไรให้เทียบ (ไม่ใช่ "ตรงแผน") — เงียบไว้ ปล่อยให้ยอด done/total พูดแทน */
  if (!remainCards) return null;

  const parts = [];
  const late = overShiftMin > 0;
  const slipping = slipMin > 0;

  if (neverClosed > 0) {
    /* 🔴 ดูวันย้อนหลังแล้วยังมีใบเปิดค้าง = ใบนั้น**ไม่เคยถูกปิด** — รายงานเป็น "ช้ากว่าแผน N ชม."
       คือเล่าผิดเรื่อง (วันงานจบไปแล้ว ไม่มีใครมาปิดอีก) · วัดจริง 25/09: LINE A 14 ใบ ⇒ 20:49 ชม.
       ⇒ บอกจำนวนใบตรงๆ · เวลาที่หายไปยังอ่านได้ใน tooltip ไม่ได้ซ่อน */
    parts.push({ t: `🚫 ${neverClosed} ใบไม่เคยถูกปิด`, c: '#ef4444', b: true });
  } else if (noCt) {
    /* 🔴 ไม่มี CT = ประเมินเวลาไม่ได้ — ต้องเขียนตรงๆ ไม่ใช่โชว์ 0 หรือเงียบ */
    parts.push({ t: compact ? '⚠️ ไม่มี CT' : '⚠️ ไม่มี CT — ประเมินว่าช้าแค่ไหนไม่ได้', c: 'var(--muted)' });
  } else if (slipping) {
    /* ช้าเกิน 1 วัน = ไม่ใช่ "ช้ากว่าแผนของกะนี้" แต่เป็นใบที่ค้างข้ามวัน (ส่วนใหญ่คือใบที่ไม่เคย
       ถูกปิด) ⇒ เปลี่ยนคำให้ตรงความจริง ไม่ใช่รายงานเป็นดีเลย์ของกะ */
    const over1d = slipMin >= 1440;
    parts.push({
      t: over1d ? `⏱️ ค้างข้ามวัน ${fmtSlipMin(slipMin)}` : `⏱️ ${compact ? 'ช้า' : 'ช้ากว่าแผน'} ${fmtSlipMin(slipMin)}`,
      c: late || over1d ? '#ef4444' : '#f97316', b: true,
    });
  } else if (showOk) {
    parts.push({ t: '⏱️ ตามแผน', c: 'var(--accent)' });
  }

  /* ยอด: บอกเป็น "ชิ้น" ได้เฉพาะเมื่อพาร์ทที่เหลือ CT เท่ากันหมด · ไม่งั้นบอกเป็นนาทีของจังหวะงาน */
  if (neverClosed > 0) { /* วันจบแล้ว — ยอดที่ขาดเป็นของที่ไม่ได้ทำ ไม่ใช่ "ตามไม่ทันจังหวะ" ปล่อยให้ยอด done/total พูด */ }
  else if (behindPcs > 0 && !compact) parts.push({ t: `📦 ขาด ${behindPcs.toLocaleString()} ชิ้น`, c: '#f97316', b: true });
  else if (behindMin > 0 && !compact) parts.push({ t: `📦 ช้ากว่าจังหวะ ${fmtSlipMin(behindMin)} (หลายพาร์ท บอกเป็นชิ้นไม่ได้)`, c: '#f97316' });

  /* 🔴 compact: แถวมีที่แค่บรรทัดเดียวสั้นๆ — โชว์ "คาดจบ" เฉพาะเมื่อยังไม่ได้โชว์ตัวช้า
     (ยอด/ชิ้นของแถวมีอยู่แล้วบรรทัดบน `369/375 ชิ้น` ⇒ แถว = ยอด + เวลา ครบตามที่ user สั่ง) */
  if (finishMs != null && typeof fmtMs === 'function' && !neverClosed && !(compact && parts.length)) {
    parts.push({
      t: compact
        ? `🏁 ${fmtMs(finishMs)}${late ? ' ⚠️เกินกะ' : ''}`
        : `🏁 คาดจบ ~${fmtMs(finishMs)}${late ? ` (เกินกะ ${fmtSlipMin(overShiftMin)})` : ''}`,
      c: late ? '#ef4444' : slipping ? '#f97316' : 'var(--text2)', b: late,
    });
  }
  if (lateCards > 0 && !compact) parts.push({ t: `🔴 ${lateCards} ใบไม่ทันกะ`, c: '#ef4444', b: true });
  else if (delayed > 0 && !slipping && !compact) parts.push({ t: `⚠️ ค้าง ${delayed} ใบ`, c: '#f97316' });

  if (!parts.length) return null;

  const tip = [
    'ช้ากว่าแผน = เวลาที่คาดว่าจะจบจริง − เวลาที่ควรจบถ้าไม่มีใบไหนค้าง',
    behindPcs > 0 || behindMin > 0 ? 'ขาด = เทียบกับจังหวะงาน (ยอด × CT) ตั้งแต่เปิดใบแรก หักเวลาพักแล้ว' : null,
    lateCards > 0 ? 'ใบไม่ทันกะ = ใบที่คิวดันไปจบหลังปลายกะที่กำลังเดินอยู่' : null,
    noCt ? 'ไลน์นี้ยังไม่มี cycle time ในทะเบียนสินค้า — ประเมินเวลาไม่ได้จนกว่าจะกรอก' : null,
    neverClosed > 0 ? `วันงานนี้จบไปแล้ว แต่ยังมี ${neverClosed} ใบที่ไม่เคยถูกสแกนปิด — ของจริงคือถูกยกยอด/ตกหล่น` : null,
  ].filter(Boolean).join(' · ');

  return (
    <span title={tip} style={{
      display: 'inline-flex', alignItems: 'baseline', gap: 6, fontSize: size, lineHeight: 1.35,
      flexWrap: oneLine ? 'nowrap' : 'wrap',
      ...(oneLine ? { overflow: 'hidden', minWidth: 0 } : null),
    }}>
      {parts.map((p, i) => (
        <span key={i} style={{ color: p.c, fontWeight: p.b ? 800 : 700, whiteSpace: 'nowrap',
          ...(oneLine ? { overflow: 'hidden', textOverflow: 'ellipsis' } : null) }}>{p.t}</span>
      ))}
    </span>
  );
}
