/* ── useMasterRows — ของกลางของ "ทะเบียนที่ช่องเลือกใช้" (2026-10-13) ─────────────
   🔴 ปัญหาที่แก้: ทุก hook ทะเบียน (`useCustomers`/`useProductionLines`/…) เคยลงท้ายด้วย
      `.catch(() => {})` แล้วคืนลิสต์ว่าง ⇒ **ลิสต์ว่าง 2 ความหมายปนกัน**
        (ก) ทะเบียนไม่มีของจริง   (ข) โหลดไม่สำเร็จ
      หน้างานเปิดช่องเลือกเห็นว่าง → สรุปว่า "ยังไม่ได้ลงทะเบียน" → ไปสร้างซ้ำ
      (`useProductionLines` เป็นตัวอ่านทะเบียนไลน์ตัวเดียวที่อนุญาต ⇒ ล้มทีเดียว
       dropdown ไลน์ว่างทั้งแอป โดยจอไม่บอกเหตุ)

   ⚠️ **ไม่ได้มาแทน toast กลางใน `main.jsx`** — นั่นตอบ "มีอะไรล้ม" ระดับแอป
      แต่ toast ผ่านไปแล้วหาย และไม่บอกว่า*ช่องที่กำลังเพ่งอยู่*คือช่องที่ล้ม
      ตัวนี้ตอบ "ช่องนี้ว่างเพราะอะไร" ⇒ ใช้คู่กัน ไม่ใช่แทนกัน

   กติกา (กฎความซื่อสัตย์ของจอ · CLAUDE.md §OBEYA + กฎเขียน DB ข้อ 12):
   🔴 `failed` = true ⇒ **ช่องเลือกต้องเขียนบนจอ ห้ามปล่อยว่างเฉยๆ ห้ามซ่อนช่อง**
      (ยังให้พิมพ์/เลือกค่าเดิมได้ — คำเตือนไม่ใช่ตัวบล็อกงาน)
   🔴 ห้ามเอา `failed` ไปตัดสินใจ "เขียน/ลบ" — มันบอกแค่ว่าลิสต์ไม่น่าเชื่อถือ

   ของที่โหลดล้มแล้วยังมีของเดิมค้างใน cache: `cachedMaster` คืนของเดิมให้ (ไม่ทับด้วย [])
   ⇒ `rows` มีของ + `failed` true + `stale` true = "นี่ของเก่า อาจไม่ใช่ล่าสุด"           */
import { useCallback, useEffect, useState } from 'react';
import { masterLoadState, invalidateMaster } from './masterCache.js';

const EMPTY = [];

/**
 * @param key    คีย์เดียวกับที่ส่งให้ `cachedMaster` (ใช้ถามสถานะล้ม + สั่งโหลดใหม่)
 * @param loader ฟังก์ชันโหลด (ปกติคือ `loadXxx()` ที่ห่อ `cachedMaster` ไว้แล้ว)
 * @param empty  ค่าว่างของทะเบียนนี้ — ทะเบียนที่คืน object/ค่าตั้งต้นต้องส่งมา
 *               (เช่น `{ sets: [], qaParts: [] }` · ชุดค่าในโค้ดของ die_set_kinds)
 *               ⚠️ ต้องเป็นค่า**คงที่ระดับโมดูล** ห้ามสร้างใหม่ทุก render (กฎเหล็ก DB ข้อ 9)
 * @param dep    ค่า primitive ที่เปลี่ยนแล้วให้โหลดใหม่ (เช่น `version` ของผู้เรียก)
 * @param enabled false = ไม่ยิงเลย (คง `empty` ไว้ · ไม่ถือว่าล้ม)
 * @returns `{ rows, failed, stale, message, loading, reload }`
 */
export default function useMasterRows(key, loader, { empty = EMPTY, dep = 0, enabled = true } = {}) {
  const [st, setSt] = useState({ rows: empty, failed: false, stale: false, message: '', loading: true });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!enabled) { setSt({ rows: empty, failed: false, stale: false, message: '', loading: false }); return undefined; }
    let alive = true;
    setSt(s => ({ ...s, loading: true }));
    Promise.resolve()
      .then(loader)
      .then((d) => {
        if (!alive) return;
        /* ⚠️ `cachedMaster` **ไม่ throw** — มันกลืน error แล้วคืนของเดิม/ลิสต์ว่าง
           ⇒ ต้องถามทะเบียนผลล้มต่อคีย์ ไม่ใช่รอ catch (รอ catch = ไม่มีวันรู้) */
        const f = masterLoadState(key);
        setSt({
          rows: d ?? empty,
          failed: !!f,
          stale: !!f?.hadFallback,
          message: f?.message || '',
          loading: false,
        });
      })
      .catch((e) => {
        if (!alive) return;
        // loader ที่ไม่ได้ผ่าน cachedMaster (หรือ cachedMaster พังเอง) — ห้ามเงียบ
        console.warn('[useMasterRows] โหลดทะเบียน', key, 'ไม่สำเร็จ', e);
        setSt({ rows: empty, failed: true, stale: false, message: e?.message || 'โหลดไม่สำเร็จ', loading: false });
      });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce, dep, enabled]);

  const reload = useCallback(() => { invalidateMaster(key); setNonce(n => n + 1); }, [key]);
  return { ...st, reload };
}

/** ข้อความมาตรฐานข้างช่องเลือก — ทุกที่ต้องพูดเหมือนกัน (ห้ามแต่งเองในหน้า) */
export const registryFailText = (what = 'ทะเบียน', stale = false) => (stale
  ? `⚠️ โหลด${what}ล่าสุดไม่สำเร็จ — ลิสต์นี้เป็นของเดิมที่เก็บไว้ อาจไม่ครบ`
  : `⚠️ โหลด${what}ไม่สำเร็จ — ลิสต์ว่างนี้ไม่ได้แปลว่าไม่มีข้อมูล`);
