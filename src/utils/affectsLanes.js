/* ═══════════════════════════════════════════════════════════════════════════════
   affectsLanes — "อุปกรณ์ตัวนี้หยุดแล้วไลน์หยุดกี่เลน" (2026-10-28 · คำสั่ง user)

   ปัญหาที่แก้ (เคสจริง HDF1 → LASER-345 · ถาม-ตอบกับ user 27-28/10):
     ไลน์เครื่องขนาน N เลน · downtime ที่ผูกเครื่องถูกหาร 1/N เพราะ "เครื่อง 1 ตัวหยุด
     เลนอื่นยังเดิน" (oee.js §3.2) — **ถูกสำหรับเลเซอร์ แต่ผิดสำหรับของกลาง**
     คอนเวเยอร์ที่เลี้ยงทั้ง 3 เลนพัง = ไลน์หยุดทั้งไลน์ ไม่ใช่หยุด 1/3

   ⇒ ทะเบียนเครื่อง (`machines.affects_lanes` ฝั่ง DR) ตอบว่า "ตัวนี้ครอบกี่เลน"
     · ว่าง/1 = ครอบ 1 เลน = **พฤติกรรมเดิมเป๊ะ** (ไม่ต้อง cut-over · ทยอยกรอกได้)
     · = N     = ของกลางของไลน์ (คอนเวเยอร์/ระบบลม/ตู้ไฟ) → ไม่หาร
     · = 2     = โรบอทที่ป้อน 2 เครื่อง → หาร 2/3
     กรอกที่ `/machines` (ช่องโชว์เฉพาะไลน์ที่ตั้งจำนวนเลนไว้)

   🔴 อ่านไม่ได้ = คืนแมปว่าง = **พฤติกรรมเดิม ไม่ใช่ศูนย์** (fail-open โดยตั้งใจ)
      — fail-closed (ไม่หารเลย) จะพ่นนาทีเกินจริง N เท่าในทุกจอทันที ซึ่งแย่กว่า
      · จอที่อยากซื่อสัตย์อ่าน `loadFail` ไปเขียนบนจอได้ (ห้ามเงียบถ้าเลขสำคัญ)
   ═══════════════════════════════════════════════════════════════════════════════ */
import { supabaseDR } from '../supabaseClient';
import { affectsLanesMap } from './oee';

let cache = null;        // { map, loadFail }
let inflight = null;

/**
 * แมป `{ [machineKey(machine_no)]: จำนวนเลนที่ครอบ }` — cache ทั้งแอป (ทะเบียนแทบไม่เปลี่ยน)
 * 🔴 ดึงเฉพาะแถวที่กรอกไว้ (`affects_lanes > 1`) — ทั้งโรงงานมีไม่ถึงสิบตัว ไม่ใช่โหลดทะเบียนทั้งก้อน
 * @returns {Promise<Object>} แมป (ว่าง = ไม่มีใครกรอก **หรือ** อ่านไม่ได้ → ดู `affectsLanesLoadFail()`)
 */
export async function loadAffectsLanes(force = false) {
  if (cache && !force) return cache.map;
  if (inflight && !force) return inflight;
  inflight = (async () => {
    try {
      const { data, error } = await supabaseDR
        .from('machines')
        .select('machine_no, affects_lanes')
        .gt('affects_lanes', 1);
      /* migration ยังไม่ apply (42703) = ไม่มีใครกรอกได้อยู่แล้ว ⇒ แมปว่าง ไม่ใช่ความผิดพลาด */
      const missingCol = !!error && /affects_lanes/.test(error.message || '');
      cache = { map: error ? {} : affectsLanesMap(data || []), loadFail: !!error && !missingCol };
    } catch {
      cache = { map: {}, loadFail: true };
    } finally {
      inflight = null;
    }
    return cache.map;
  })();
  return inflight;
}

/** `true` = รอบล่าสุดอ่านทะเบียนไม่ได้ ⇒ นาทีที่โชว์อาจต่ำกว่าจริงสำหรับของกลาง (จอควรเขียนบอก) */
export const affectsLanesLoadFail = () => !!cache?.loadFail;

/** แมปที่ cache ไว้แบบ sync — ยังไม่โหลด = `{}` (พฤติกรรมเดิม) */
export const affectsLanesSync = () => cache?.map || {};

/** ล้าง cache — เรียกหลังแก้ทะเบียนเครื่องที่ `/machines` */
export const invalidateAffectsLanes = () => { cache = null; };
