/* ═══ 🔊 เครื่องเสียงของไซเรนบนจอ — ของกลางตัวเดียวทั้งระบบ (2026-10-24) ════════════════════

   แยกออกมาจาก `components/DowntimeSiren.jsx` ตอนทำไซเรนฝั่งสโตร์ (user 24/10:
   *"เวลาเบิกของ สโตร์ ต้องได้ยินเสียงแจ้งเตือน เหมือนเวลา MTN ได้ยินเสียงเรียกช่าง"*)
   ⇒ มี 2 ไซเรนในระบบแล้ว · **ห้ามก๊อปเครื่องเสียงเป็นชุดที่ 2** (CLAUDE.md: แก้กฎที่เดียว)

   ⚠️⚠️ กฎเหล็กที่ย้ายมาพร้อมกัน — ห้ามทำให้ "ง่ายขึ้น":
   1. **สร้าง AudioContext ตั้งแต่ mount** (state `suspended` = ถูกต้อง ไม่เปลือง) แล้วฟัง `statechange`
      ⇒ จอที่เปิดทิ้งไว้รู้ตัวว่าเสียงยังล็อก **ก่อน**เกิดเหตุ — ไม่ใช่ตอนเหตุเกิดแล้วเงียบ
      (เคสจริง 26/08: จอห้องช่างรีบูตกลางคืน แล้วเสียงแรกที่ควรดังที่สุดกลับเงียบ)
   2. **ปลดล็อกด้วย `pointerdown` และ `keydown`** — รีโมท TV บางรุ่นส่ง key ไม่ส่ง pointer
   3. **เสียงสร้างด้วย Web Audio ไม่พึ่งไฟล์** (ไฟล์ = 404 เงียบ + autoplay policy ซ้อนอีกชั้น)
   4. 🔴 **`muted` ต้องรายงานตามจริงทุกครั้งที่เริ่มเล่น** — "เห็นแถบแต่ไม่มีเสียง" ห้ามเงียบ
      จอต้องเอาค่านี้ไปเขียนบนแถบว่าต้องแตะจอ 1 ครั้ง

   🔊 ลายเสียง (`pattern`) แยกตามเรื่อง — ห้องที่นั่งรวมกัน (ช่าง + สโตร์) ต้องแยกออกด้วยหูว่า
      เสียงนี้เรื่องอะไร ⇒ ส่ง pattern เข้ามา ไม่ hardcode ในฮุค                                   */

import { useEffect, useRef, useState, useCallback } from 'react';

/** ลายเสียงมาตรฐาน — คู่โน้ตตก (เดิมของ DowntimeSiren · 🔧 เรียกช่าง/เครื่องหยุด) */
export const SIREN_PATTERN_ALARM = [[880, 0], [660, 0.18]];
/** 📦 ไลน์เรียกของจากสโตร์ — คู่โน้ตขึ้น เสียงต่างจากของช่างชัดเจน (ไม่ใช่เหตุฉุกเฉินเครื่องจักร) */
export const SIREN_PATTERN_CALL = [[523, 0], [784, 0.16], [1046, 0.32]];

/**
 * @param {boolean} active  มีเหตุค้างอยู่ไหม (true = เล่นวนจนกว่าจะ false)
 * @param {object}  [opt]
 * @param {Array}   [opt.pattern]    [[ความถี่Hz, หน่วงวินาที], …]
 * @param {number}  [opt.everyMs]    คาบการวน (ms)
 * @returns {{ muted:boolean, unlockNow:() => void }}
 *   `muted` = เบราว์เซอร์ยังบล็อกเสียง (ยังไม่มีใครแตะจอ) ⇒ **จอต้องเขียนบอก ห้ามเงียบ**
 */
export default function useSiren(active, { pattern = SIREN_PATTERN_ALARM, everyMs = 1300 } = {}) {
  const [muted, setMuted] = useState(false);
  const acRef = useRef(null);
  const loopRef = useRef(null);
  const patRef = useRef(pattern);
  patRef.current = pattern;      // เปลี่ยนลายเสียงกลางทางได้ ไม่ต้องรีสตาร์ตลูป

  /* เตรียม AudioContext ตั้งแต่ mount + ฟังสถานะ (กฎข้อ 1-2) */
  useEffect(() => {
    let ac = acRef.current;
    if (!ac) {
      try { ac = acRef.current = new (window.AudioContext || window.webkitAudioContext)(); } catch { ac = null; }
    }
    if (!ac) { setMuted(true); return undefined; }   // ไม่มี Web Audio = ไม่มีทางมีเสียง ต้องบอก
    const sync = () => setMuted(ac.state !== 'running');
    sync();
    ac.addEventListener?.('statechange', sync);
    // ลอง resume ทันที — เครื่องที่เพิ่งคลิกมาจากเมนูมักผ่านเลย ชิปเตือนจะไม่ขึ้นกวน
    try { ac.resume().then(sync, sync); } catch { /* ignore */ }
    const unlock = () => { try { ac.resume().then(sync, () => {}); } catch { /* ignore */ } };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      ac.removeEventListener?.('statechange', sync);
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  /* เล่น/หยุดตามว่ามีเหตุค้างไหม */
  useEffect(() => {
    if (!active) { clearInterval(loopRef.current); loopRef.current = null; return undefined; }
    if (loopRef.current) return undefined;           // เล่นอยู่แล้ว
    if (!acRef.current) {
      try { acRef.current = new (window.AudioContext || window.webkitAudioContext)(); } catch { acRef.current = null; }
    }
    const ac = acRef.current;
    const beep = () => {
      if (!ac) return;
      try { ac.resume(); } catch { /* ignore */ }
      const now = ac.currentTime;
      patRef.current.forEach(([f, dt]) => {
        const o = ac.createOscillator(); const g = ac.createGain();
        o.type = 'square'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, now + dt);
        g.gain.exponentialRampToValueAtTime(0.25, now + dt + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, now + dt + 0.16);
        o.connect(g); g.connect(ac.destination);
        o.start(now + dt); o.stop(now + dt + 0.17);
      });
    };
    beep();
    setMuted(!ac || ac.state !== 'running');          // กฎข้อ 4 — รายงานตามจริงทุกครั้งที่เริ่มเล่น
    loopRef.current = setInterval(beep, everyMs);
    return () => { clearInterval(loopRef.current); loopRef.current = null; };
  }, [active, everyMs]);

  useEffect(() => () => { clearInterval(loopRef.current); try { acRef.current?.close(); } catch { /* ignore */ } }, []);

  /* ปลดล็อกด้วยการแตะ — ใช้ร่วมทั้งชิป standby และปุ่มในแถบเตือน (อย่าเขียนซ้ำในหน้า) */
  const unlockNow = useCallback(() => {
    const ac = acRef.current;
    if (!ac) return;
    try { ac.resume().then(() => setMuted(ac.state !== 'running'), () => {}); } catch { /* ignore */ }
  }, []);

  return { muted, unlockNow };
}
