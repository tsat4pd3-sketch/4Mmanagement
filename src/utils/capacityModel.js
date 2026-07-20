/* ═══ capacityModel — ประเมิน "กำลังผลิตต่อกะจริง" สำหรับวางแผน (active planner) ═══
   หลักการ: วางแผนจาก throughput ที่ทำได้จริง ไม่ใช่ nameplate/ทฤษฎี
   - ตัวหลัก: median(ยอดดีต่อกะ) จากประวัติกะที่ปิดใน 60 วันล่าสุด ต่อ (ไลน์+พาร์ท)
     → median ตัดค่าโดด (วันเทพ/วันหายนะ) ออกเองโดยธรรมชาติ + บวก OEE/เบรค/NG ไว้ในตัวแล้ว
   - fallback: ข้อมูล < MIN_SESSIONS → (นาทีกะ×60 ÷ CT) × OEE median ของไลน์ (ติดป้าย confidence ต่ำ)
   - โชว์ช่วง P25–median–P75 = ความเสี่ยง (บางกะได้น้อยแค่ไหน) + ให้เลือกวางแผนที่ median หรือ P25
   ทุกฟังก์ชันเป็น pure — หน้าเป็นคน fetch แล้วส่งเข้ามา
   ═══════════════════════════════════════════════════════════════════════════ */

export const MIN_SESSIONS = 3;       // ต้องมีอย่างน้อยกี่กะ ถึงเชื่อ median จากของจริง
export const HISTORY_DAYS = 60;      // หน้าต่างประวัติที่ใช้ (recency — สะท้อนสภาพปัจจุบัน)
export const DEFAULT_OEE = 0.75;     // OEE default เมื่อไม่มีประวัติไลน์ (ค่ากลางของระบบ ~75%)
export const DEFAULT_SHIFT_MIN = 570; // นาทีต่อกะเมื่อไม่มี std (9.5 ชม.)

export function median(arr) {
  if (!arr?.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function percentile(arr, p) {
  if (!arr?.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const idx = (s.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return s[lo];
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

/**
 * ประเมินกำลังต่อกะของพาร์ทหนึ่ง
 * @param {number[]} perShiftOutputs  ยอดดีต่อกะจากประวัติ (อาร์เรย์ต่อ 1 กะ)
 * @param {object}  opts { ctSec, shiftMin, lineOee }
 * @returns {{ perShift, p25, p75, n, method:'actual'|'ct'|null, confidence:'high'|'med'|'low' }}
 */
export function estimateCapacity(perShiftOutputs = [], { ctSec = 0, shiftMin = DEFAULT_SHIFT_MIN, lineOee = DEFAULT_OEE } = {}) {
  const clean = perShiftOutputs.filter(v => Number.isFinite(v) && v > 0);
  if (clean.length >= MIN_SESSIONS) {
    return {
      perShift: Math.round(median(clean)),
      p25: Math.round(percentile(clean, 0.25)),
      p75: Math.round(percentile(clean, 0.75)),
      n: clean.length,
      method: 'actual',
      confidence: clean.length >= 6 ? 'high' : 'med',
    };
  }
  // fallback: คิดจาก cycle time × OEE (ทฤษฎี — ความมั่นใจต่ำ)
  if (ctSec > 0) {
    const perShift = Math.round((shiftMin * 60 / ctSec) * lineOee);
    return { perShift, p25: perShift, p75: perShift, n: clean.length, method: 'ct', confidence: 'low' };
  }
  return { perShift: null, p25: null, p75: null, n: clean.length, method: null, confidence: 'low' };
}

/** เลือกกำลังที่จะใช้วางแผนตามโหมด: median (สมจริง) หรือ P25 (ปลอดภัยไว้ก่อน) */
export const planCapacity = (est, mode = 'median') =>
  !est ? 0 : (mode === 'safe' ? (est.p25 ?? est.perShift ?? 0) : (est.perShift ?? 0));

/* ── ปฏิทินกำลังผลิต: เดินวันต่อวัน จัดสรรกำลังให้ความต้องการ แล้วบอกว่าแต่ละวันต้องเปิดอะไร ──
   ใช้ทั้งรายวัน (order) และรายเดือน (สรุปจากผลรายวัน)
   demandByDate: { 'YYYY-MM-DD': qtyDue }  ความต้องการที่ครบดิวในแต่ละวัน (รวมทุกพาร์ทของไลน์)
   dayCap/nightCap: กำลังต่อกะ (ชิ้น) ของไลน์ · calendar: (dateStr)=>'working'|'holiday'
   คืน: array ต่อวัน { date, isHoliday, carriedIn, due, producedDay, producedNight, producedOT, plan, shortfall, backlog }
   หลัก greedy: วันทำงานเปิดกะเช้าก่อน → ถ้า backlog ยังเหลือเปิดกะดึก → ยังเหลือเปิด OT (กะเช้า×1.25)
              → วันหยุดเปิดเฉพาะเมื่อมี backlog (ต้องมาทำวันหยุด) */
export function buildDayPlan({ dates, demandByDate, dayCap, nightCap, otFactor = 0.25, calendar }) {
  let backlog = 0; // ยอดค้างสะสม (ผลิตไม่ทันวันก่อน)
  return dates.map(date => {
    const isHoliday = calendar(date) !== 'working';
    const due = demandByDate[date] || 0;
    const carriedIn = backlog;
    let need = backlog + due;
    let producedDay = 0, producedNight = 0, producedOT = 0;
    const plan = [];

    if (!isHoliday) {
      producedDay = Math.min(need, dayCap);
      need -= producedDay;
      if (producedDay > 0) plan.push('day');
      if (need > 0 && nightCap > 0) {
        producedNight = Math.min(need, nightCap);
        need -= producedNight;
        if (producedNight > 0) plan.push('night');
      }
      if (need > 0 && dayCap > 0) {
        // OT ต่อท้าย (สมมติได้เพิ่ม otFactor ของกะเช้า เช่น 2-3 ชม.)
        producedOT = Math.min(need, Math.round(dayCap * otFactor));
        need -= producedOT;
        if (producedOT > 0) plan.push('ot');
      }
    } else if (need > 0 && dayCap > 0) {
      // วันหยุดแต่มี backlog → ต้องมาทำ (นับเป็นกะเช้าวันหยุด)
      producedDay = Math.min(need, dayCap);
      need -= producedDay;
      if (producedDay > 0) plan.push('holiday_work');
    }

    backlog = need; // เหลือเท่าไหร่ยกไปวันถัดไป
    return {
      date, isHoliday, carriedIn, due,
      producedDay, producedNight, producedOT,
      produced: producedDay + producedNight + producedOT,
      plan, shortfall: 0, backlog,
    };
  });
}
