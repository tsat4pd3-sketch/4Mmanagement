/**
 * fetchByIds — ดึงแถวลูกด้วย .in(col, ids) แบบ "แบ่งก้อน + แบ่งหน้า" ให้ครบเสมอ
 *
 * ที่มา (บั๊กจริง 2026-08-20 · user จับได้จากหน้า OEE Analytics):
 *   ตารางสรุปโชว์ "DT 0 นาที" ทุกแถว แต่ A% ไม่ใช่ 100% — เป็นไปไม่ได้
 *   ต้นเหตุ: แท็บแนวโน้มช่วง 90 วัน มี 813 กะ → `.in('session_id', [813 uuid])`
 *   = URL ยาว ~31,700 ตัวอักษร โดนตัด → คิวรีล้มเหลว → downtime/defect/order ว่างหมด
 *   และโค้ดรับแค่ `{ data }` ไม่เช็ค `error` → **เงียบสนิท ไม่มีสัญญาณใดๆ**
 *   ผลคือ DT/ของเสีย/Pareto/มูลค่าเงิน เป็น 0 ขณะที่ A/P/Q (อ่านจากค่า stamp บนแถวกะ)
 *   ยังโชว์ค่าจริง → จอเดียวกันขัดแย้งกันเอง
 *
 * ⚠️ กันไว้ 3 ชั้น — ขาดชั้นไหนก็กลับไปผิดเงียบได้อีก:
 *   1. แบ่งก้อน id (IN_CHUNK) — กัน URL ยาวเกิน
 *   2. แบ่งหน้า (PAGE_SIZE) — Supabase คืนสูงสุด 1000 แถว/ครั้ง · 120 กะ × downtime กะละ 10 = เกินได้
 *   3. **`.order()` คู่กับ `.range()` เสมอ** — range ที่ไม่มีลำดับคงที่ = แถวหลุด/ซ้ำระหว่างหน้า
 *      (บทเรียนเดียวกับ role_permissions ที่เคยทำสิทธิ์หายเงียบ)
 *
 * ⚠️ คืน `error`/`failed` ออกมาให้ผู้เรียกเสมอ — **ห้ามกลืน** จอที่โชว์ตัวเลขรวมต้องบอกได้ว่า
 *    "ตัวเลขนี้ไม่ครบ" ไม่ใช่แสดง 0 เหมือนไม่มีข้อมูลจริง
 */

/** id ต่อก้อน — 120 uuid ≈ 4,700 ตัวอักษรใน URL (ปลอดภัยกับ proxy/gateway ทุกตัว) */
export const IN_CHUNK = 120;
/** เพดานแถวต่อครั้งของ PostgREST */
export const PAGE_SIZE = 1000;

/**
 * @param {string[]} ids           รายการ id (เช่น session_id)
 * @param {(chunk:string[]) => any} run  คืน query builder ที่ยัง **ไม่** await และยังไม่ใส่ order/range
 * @param {{ chunk?:number, page?:number, orderBy?:string, maxPages?:number }} opt
 * @returns {Promise<{ rows:any[], error:string|null, failed:number, truncated:boolean }>}
 */
export async function fetchByIds(ids, run, opt = {}) {
  const { chunk = IN_CHUNK, page = PAGE_SIZE, orderBy = 'id', maxPages = 60 } = opt;
  const rows = [];
  const errors = [];
  let truncated = false;

  const list = Array.from(new Set((ids || []).filter(Boolean)));
  for (let i = 0; i < list.length; i += chunk) {
    const part = list.slice(i, i + chunk);
    let p = 0;
    for (; p < maxPages; p++) {
      const { data, error } = await run(part).order(orderBy).range(p * page, (p + 1) * page - 1);
      if (error) { errors.push(error.message); break; }
      rows.push(...(data || []));
      if (!data || data.length < page) break;
    }
    if (p >= maxPages) truncated = true;   // ชนเพดานหน้า = ยังมีอีก แต่หยุดแล้ว ห้ามเงียบ
  }
  return { rows, error: errors[0] || null, failed: errors.length, truncated };
}
