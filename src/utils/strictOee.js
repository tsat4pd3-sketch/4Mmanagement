/*
  "OEE จริง" (strict) — นับ Downtime ที่ติ๊กว่า "ในแผน" เป็นการสูญเสียด้วย
  ────────────────────────────────────────────────────────────────────────
  ปัญหาที่แก้ (คำสั่ง user 2026-08-05): สูตร OEE มาตรฐาน "กัน" หยุดตามแผนออกจากฐานเวลา
  (A = run ÷ (กะ − พัก − หยุดในแผน)) → ถ้าติ๊กประเภท Downtime เป็น "ในแผน" ค่า A จะไม่ตกเลย
  พนักงานจึงเลี่ยงไปติ๊กในแผนกับเหตุการณ์ที่จริงๆ เป็นการสูญเสีย (รอ QA, เปลี่ยนตะกร้า)
  ทำให้ OEE ดูสวยเกินจริง — เคสจริง LASER EXPORT กะดึก 04/08: DT 40 นาที "ในแผน" ทั้งหมด → A = 100%

  นิยาม: หักเฉพาะ "เวลาพักตามนโยบาย" ออกจากฐาน · Downtime ทุกชนิดนับเป็นการสูญเสีย
      ฐาน (loading)   = เวลากะ − พักตามนโยบาย
      เวลารับภาระเดิม = ฐาน − หยุดในแผน            (ฐานของสูตร OEE มาตรฐาน)
      A จริง          = A ที่ stamp × (เวลารับภาระเดิม ÷ ฐาน)
      OEE จริง        = A จริง × P × Q

  ⚠️ ทำไมคูณสัดส่วนจาก A ที่ stamp ไม่คำนวณ A ใหม่จากเวลากะ:
  A ที่ stamp คิดแบบ "แยกตามพาร์ท" (ช่วงเวลาที่แต่ละ MAT วิ่งจริง) ไม่ใช่ช่วงกะทั้งกะ —
  ถ้าคำนวณใหม่ด้วยฐานทั้งกะจะได้คนละชุดกับ Daily Report และบางกะ "OEE จริง" กลับสูงกว่า OEE
  (เจอจริงตอนเทส 3 กะ) · วิธีคูณสัดส่วนฐานนี้เป็น pattern เดียวกับ OOE/TEEP ในหน้า OEE Analytics
  → รับประกัน OEE จริง ≤ OEE เสมอ และเท่ากันเป๊ะเมื่อไม่มีหยุดในแผน

  ความสัมพันธ์ (ฐานกว้างขึ้นเรื่อยๆ · เลขเล็กลงเรื่อยๆ):
      OEE (มาตรฐาน)  ฐาน = กะ − พัก − หยุดในแผน   ← ถูก gaming ได้
      OEE จริง        ฐาน = กะ − พัก               ← ตัวนี้
      OOE            ฐาน = เวลากะทั้งหมด (รวมพัก)
      TEEP           ฐาน = ปฏิทิน 24 ชม.

  ไม่ได้แปลว่า "หยุดตามแผนเป็นความผิด" — แต่ทำให้เห็นว่าถ้านับทุกการหยุด เวลาที่เหลือผลิตจริง
  เหลือเท่าไหร่ ใช้ควบคู่ OEE มาตรฐาน ไม่ใช่แทนที่
*/

// คืน null เมื่อคำนวณไม่ได้ (ไม่มีเวลากะ / ฐาน ≤ 0 / ไม่มีค่า A ที่ stamp)
export function strictOee({ shiftMin, breakMin = 0, plannedDtMin = 0, a = null, p = null, q = null }) {
  const shift = Number(shiftMin) || 0;
  const brk = Math.max(0, Number(breakMin) || 0);
  const planned = Math.max(0, Number(plannedDtMin) || 0);

  const base = shift - brk;                        // loading time (หักเฉพาะพักตามนโยบาย)
  if (!(base > 0) || a == null) return null;
  const loadOfficial = Math.max(0, base - planned); // ฐานของสูตรมาตรฐาน
  const ratio = loadOfficial / base;                // ≤ 1 เสมอ

  const r1 = v => Math.round(v * 10) / 10;
  const aStrict = Math.max(0, Math.min(100, Number(a) * ratio));
  const pv = p == null ? null : Number(p);
  const qv = q == null ? null : Number(q);
  const oee = pv == null || qv == null ? null : r1(aStrict * pv * qv / 10000);

  return {
    a: r1(aStrict),
    oee,
    baseMin: Math.round(base),
    loadMin: Math.round(loadOfficial),
    plannedDtMin: Math.round(planned),
    // สัดส่วนเวลาที่ถูก "กันออก" จากฐาน A ของสูตรมาตรฐาน — สูงผิดปกติ = ควรตรวจการจัดประเภท Downtime
    plannedSharePct: r1((planned / base) * 100),
  };
}

// ต่างกันกี่จุดจาก OEE มาตรฐานที่ stamp ไว้ (บวก = OEE มาตรฐานสูงกว่า)
export const strictGap = (stampedOee, strictOeeVal) =>
  stampedOee == null || strictOeeVal == null ? null : Math.round((Number(stampedOee) - strictOeeVal) * 10) / 10;

// เกณฑ์เตือน: หยุด "ในแผน" กินฐานเกินเท่าไหร่ถึงควรไปตรวจการจัดประเภท
export const STRICT_WARN_SHARE_PCT = 5;
