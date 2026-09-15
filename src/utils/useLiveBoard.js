/* ── useLiveBoard — โครงมาตรฐานของ "จอที่ต้องสด" (2026-09-15) ─────────────────────────
   รวม 3 อย่างที่ทุกจอต้องมีให้ครบ ไว้ในบรรทัดเดียว — เพราะเขียนมือแล้ว**ตกหล่นทุกครั้ง**
   (audit 15/09: 11 จอ เขียน realtime กันคนละแบบ · 3 จอลืม debounce · 2 จอใช้
    `setTimeout(load,400)` ต่อ event ซึ่งไม่ใช่ debounce · ไม่มีจอไหนมีเพดานจริงเลยสักจอ)

     ① **realtime = ช่องทางหลัก** — push เฉพาะแถวที่เปลี่ยน (~200 bytes)
        ถูกกว่า poll ทั้งชุดเป็นร้อยเท่า **และเร็วกว่า**
     ② **`coalesce` = เพดานความถี่** — โรงงานยุ่งแค่ไหน จอก็โหลดไม่เกิน 1 ครั้งต่อ `tier`
     ③ **`makeIdleGate` = poll ข้ามรอบเมื่อไม่มีอะไรเปลี่ยน** — poll เป็นแค่กันเหนียวเผื่อ realtime หลุด
        รอบที่ถูกข้าม **ไม่มี network เลยสักไบต์**

   ⇒ ผลรวม: **ไม่มีใครแตะข้อมูล = จอแทบไม่กิน egress เลย** (คืน/เสาร์อาทิตย์/ช่วงพัก)
     มีคนแตะ = เห็นภายในไม่กี่วินาที เท่าเดิมหรือเร็วกว่าเดิม

   ── วิธีใช้ ────────────────────────────────────────────────────────────────
   ```js
   const load = useCallback(async () => { … }, [lineName]);   // deps ต้องนิ่ง!
   useLiveBoard(load, { tables: ['prod_orders', 'production_sessions'], topic: 'line-oee' });
   ```
   · `load` เปลี่ยน identity (เช่นเปลี่ยนไลน์) → **โหลดใหม่ทันที** ไม่ติด gate (ไม่งั้นจอค้างข้อมูลไลน์เก่า)
   · `tables` ว่าง = ไม่ subscribe อะไรเลย ⇒ **ห้ามทำ** (gate จะไม่มีใคร touch = จอค้างถึง LIVE.FLOOR)

   ⚠️ `load` ต้องเป็น `useCallback` ที่ deps นิ่ง และ **ห้ามมี object/array ใน deps**
      (กฎเหล็กข้อ 9 ใน CLAUDE.md — array ใบใหม่เนื้อเดิม = resubscribe + โหลดซ้ำทุก render)     */
import { useEffect, useCallback, useRef } from 'react';
import { supabaseDR } from '../supabaseClient';
import { liveChannel } from './liveChannel';
import { coalesce, makeIdleGate } from './liveRefresh';
import { usePolling } from './usePolling';
import { LIVE, RATE } from './refreshRates';

/**
 * @param {Function} load ตัวโหลดข้อมูลของจอ (useCallback · deps นิ่ง)
 * @param {object}   opts
 * @param {string[]} opts.tables ตารางที่ต้อง subscribe realtime (ต้องมีอย่างน้อย 1)
 * @param {string}   [opts.topic] ชื่อ channel (ตั้งให้อ่านออกเพื่อไล่ปัญหาง่าย)
 * @param {number}   [opts.tier]  เพดานความถี่ — LIVE.BOARD (จอ TV) · LIVE.PAGE · LIVE.ALARM
 * @param {number}   [opts.rate]  จังหวะ tick ของ poll กันเหนียว (ส่วนใหญ่ถูกข้ามอยู่แล้ว)
 * @param {object}   [opts.client] supabase client (default = supabaseDR)
 * @param {boolean}  [opts.enabled]
 */
export function useLiveBoard(load, opts = {}) {
  const {
    tables = [], topic, tier = LIVE.BOARD, rate = RATE.BOARD,
    client = supabaseDR, enabled = true,
  } = opts;

  const gateRef = useRef(null);
  if (!gateRef.current) gateRef.current = makeIdleGate(LIVE.FLOOR);
  const g = gateRef.current;

  // โหลดตอน mount และทุกครั้งที่ "คิวรีเปลี่ยน" (load identity เปลี่ยน = เลือกไลน์/วันใหม่)
  // ⚠️ ต้องไม่ผ่าน gate — ไม่งั้นสลับไลน์แล้วจอค้างข้อมูลไลน์เก่า
  useEffect(() => {
    if (!enabled) return;
    g.loaded();
    load();
  }, [load, enabled, g]);

  // poll = กันเหนียวเผื่อ realtime หลุด · ข้ามรอบเมื่อไม่มีอะไรเปลี่ยน (immediate=false — โหลดแรกทำข้างบนแล้ว)
  const tick = useCallback(() => {
    if (!g.shouldRun()) return;
    g.loaded();
    load();
  }, [load, g]);
  usePolling(tick, rate, { enabled, immediate: false });

  const tableKey = tables.join(',');   // string — ห้ามใส่ array ลง deps ตรงๆ (กฎเหล็กข้อ 9)
  useEffect(() => {
    if (!enabled || !tableKey) return;
    const bump = coalesce(() => { g.loaded(); return load(); }, tier);
    const onEvent = () => { g.touch(); bump(); };
    let ch = liveChannel(client, topic || `board:${tableKey}`);
    tableKey.split(',').forEach((t) => {
      ch = ch.on('postgres_changes', { event: '*', schema: 'public', table: t }, onEvent);
    });
    // กลับมา SUBSCRIBED = เพิ่ง (re)connect — ระหว่างหลุดอาจพลาด event ⇒ ให้ poll รอบหน้ายิงจริง
    ch.subscribe((status) => { if (status === 'SUBSCRIBED') g.touch(); });
    return () => { bump.cancel(); client.removeChannel(ch); };
  }, [tableKey, topic, tier, enabled, load, client, g]);
}

export default useLiveBoard;
