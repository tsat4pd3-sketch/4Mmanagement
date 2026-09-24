import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { mergeParams } from './useTabParam';
import { LOOKBACK_DAYS, TIME_SCALES, capBucket, normalizeRange, presetRange, isDateStr } from './timeRange';
import { getWorkDate } from './workDate';

/* ══ useTimeRange — ผูก "สเกล + กรอบเวลา" ของหน้ากับ URL (2026-09-23) ════════════════
 *
 * มาตรฐานเดียวกับ `useTabParam`: สิ่งที่ผู้ใช้เห็นว่า "ตัวเองกำลังดูอะไรอยู่" ต้องอยู่ใน URL
 *   ⇒ แชร์ลิงก์พร้อมตัวกรองได้ · refresh แล้วอยู่ที่เดิม · **เจาะจากบอร์ดแล้วพากรอบเวลาไปด้วย**
 *   (22/09 user ทัก: *"เรากรอง PD3 ไว้ พอกดเข้าไปดู มันรีเฟรชไปหน้าใหม่ ต้องกรองอีกรอบ"*)
 *
 * param ที่ใช้: `?scale=` `?from=` `?to=`  — ค่า default ไม่ถูกเขียนลง URL (ลิงก์สะอาด)
 *   ⚠️ `scale` = **ขนาดแท่งในกราฟ** (hour/day/week/month/year) ไม่ใช่ "ช่วงที่ดู"
 *      ช่วงที่ดูคือ from–to เสมอ · ปุ่ม "วันนี้/สัปดาห์นี้/…" เป็นแค่ตัวเติม from–to + ขนาดแท่ง
 *      พร้อมกันผ่าน `setView({from,to,scale})` (ดูบันไดใน `timeRange.js`)
 *
 * 🔴 **ห้ามเรียก `setSearchParams({...})` ตรงๆ** — ใช้ `mergeParams` เพื่อไม่ล้าง `?tab=`/`?dept=`
 *    ของหน้าแม่ทิ้ง (บั๊กจริงที่เคยเกิดกับ PmHub — ดูหัวไฟล์ `useTabParam.js`)
 *
 * ⚠️ `today` = **วันทำงาน** ผ่าน `getWorkDate()` (ก่อน 08:00 นับเป็นเมื่อวาน) ไม่ใช่วันปฏิทิน
 *    ⇒ กะดึกที่ยังไม่จบ กด "ย้อนหลัง 30 วัน" ตอนตี 3 ต้องได้ช่วงที่จบที่ "วันทำงานของกะตัวเอง"
 */
export default function useTimeRange(opts = {}) {
  const {
    defaultScale = 'day',
    defaultDays = 30,          // ช่วงตั้งต้นเมื่อ URL ยังไม่มี from/to
    /* เพดานความละเอียดของ "ข้อมูลหน้านี้" — ดูเหตุผลรายตาราง ใน `timeRange.js`
       ใช้ล้าง `?scale=` ที่แก้มือมาละเอียดเกินจริงด้วย (เช่น `?scale=hour` บนจอ OEE
       ซึ่ง `bucketKey` จะคืน null ⇒ ทุกแถวตกถังเดียวชื่อ "null" = กราฟแท่งเดียวที่ดูเหมือนจริง) */
    finest = 'hour', coarsest = 'year',
    param = { scale: 'scale', from: 'from', to: 'to' },
  } = opts;

  const [sp, setSp] = useSearchParams();
  const today = opts.today || getWorkDate();

  const def = useMemo(() => presetRange(defaultDays, today) || { from: today, to: today },
    [defaultDays, today]);

  const rawScale = sp.get(param.scale);
  const scale = capBucket(TIME_SCALES.some(s => s.key === rawScale) ? rawScale : defaultScale,
    finest, coarsest);

  const rawFrom = sp.get(param.from);
  const rawTo = sp.get(param.to);
  /* ค่าที่อ่านไม่ออกใน URL → ตกกลับค่าตั้งต้น **ห้ามปล่อยเป็น null แล้วให้จอขึ้น "ไม่มีข้อมูล"**
     (URL แก้มือได้เสมอ · คนก๊อปลิงก์ตกหล่นเป็นเรื่องปกติ) */
  const range = normalizeRange(isDateStr(rawFrom) ? rawFrom : def.from,
    isDateStr(rawTo) ? rawTo : def.to);

  const set = useCallback((patch, o) => {
    setSp(prev => {
      const cur = new URLSearchParams(prev);
      const next = { ...patch };
      if (next.from !== undefined || next.to !== undefined) {
        const n = normalizeRange(
          next.from !== undefined ? next.from : (cur.get(param.from) || def.from),
          next.to !== undefined ? next.to : (cur.get(param.to) || def.to));
        next.from = n.from; next.to = n.to;
      }
      const out = {};
      if (next.scale !== undefined) out[param.scale] = next.scale === defaultScale ? null : next.scale;
      if (next.from !== undefined) out[param.from] = next.from === def.from ? null : next.from;
      if (next.to !== undefined) out[param.to] = next.to === def.to ? null : next.to;
      return mergeParams(cur, out);
    }, { replace: !!o?.replace });
  }, [setSp, param.scale, param.from, param.to, defaultScale, def.from, def.to]);

  return {
    scale, from: range.from, to: range.to, today,
    setScale: (s) => set({ scale: s }),
    setFrom: (v) => set({ from: v }),
    setTo: (v) => set({ to: v }),
    setRange: (from, to) => set({ from, to }),
    setPreset: (days) => { const r = presetRange(days, today); if (r) set({ from: r.from, to: r.to }); },
    /* เปลี่ยน "ช่วง + ขนาดแท่ง" พร้อมกันใน **ครั้งเดียว** — กดปุ่มช่วงทีเขียน URL 2 รอบ
       = ประวัติ 2 ชั้น ⇒ กด Back ครั้งเดียวไม่กลับ (บั๊กที่ผู้ใช้เจอเป็น "ปุ่ม Back เสีย") */
    setView: (patch) => set(patch),
    presets: LOOKBACK_DAYS,
  };
}
