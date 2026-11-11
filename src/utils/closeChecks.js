/* ══════════════════════════════════════════════════════════════════════════════════════
   🛡️ Poka-yoke ของหน้าปิดกะ — "จับตอนคนยังอยู่หน้าเครื่อง" (2026-11-11 · คำสั่ง user)

   ทำไมต้องมี: ข้อมูลที่ขัดกันเองถูกจับได้ตอนออดิทย้อนหลัง **หลายวันให้หลัง** ซึ่งกู้ไม่ได้ —
   คนที่ลงข้อมูลจำไม่ได้แล้วว่าวันนั้นเกิดอะไร (เคสจริง HYDROFORM 25/06: เครื่องเดินจริง 70 นาที
   แต่บันทึกผลิต 800 ชิ้นที่ CT 50 วิ = ต้องใช้ 667 นาที · ย้อนไปถามใครไม่ได้แล้ว)
   ⇒ ด่านต้องอยู่ **2 จังหวะ**: ① ตอนลงยอด/ปิดใบ (ทันที) ② ก่อนส่งขอปิดกะ (รีเช็ครวม)

   🔴 กฎของไฟล์นี้:
   · **pure ล้วน ไม่ยิง DB ไม่อ่าน state** — เทสได้ · หน้าอื่นเอาไปใช้ซ้ำได้
   · **ไม่รู้ = ไม่เตือน** (ไม่มี CT · ไม่รู้ช่วงเวลา · ไม่รู้จำนวนเลน) — เตือนผิดบ่อย = คนกดผ่านทุกใบ
   · **CT คือค่ามาตรฐาน เดินเร็วกว่าได้** ⇒ ต้องมี tolerance ห้ามเทียบตรงๆ
   · **ห้ามบล็อกเรื่องที่ "เป็นไปได้จริง"** — หน้างานต้องเดินต่อได้ · เรื่องที่ขัดกับฟิสิกส์ = ให้ติ๊กยืนยัน
     (ติ๊ก = บังคับให้อ่าน · ไม่ใช่กดผ่านด้วยปุ่มเดียว)
   · **ห้ามแก้ค่าที่คนกรอกให้เอง** (กฎเดียวกับด่านเวลา `shiftWindow.js`) — บอกแล้วให้คนตัดสิน
   ══════════════════════════════════════════════════════════════════════════════════════ */

/** CT เป็นค่ามาตรฐาน — เดินเร็วกว่ามาตรฐานได้ ⇒ เกินเกณฑ์นี้ถึงถือว่า "เป็นไปไม่ได้" */
export const QTY_FIT_TOL = 1.15;
/** ต่ำกว่านี้ไม่กวน (นาที) — เศษไม่กี่นาทีเกิดจากปัดเวลา/เศษ CT ปกติ */
export const QTY_FIT_MIN_OVER = 15;

/**
 * ① ด่านตอนลงยอด — "ยอดเท่านี้ ทำทันในเวลาที่มีไหม"
 * @param {number} qty       ยอดที่กำลังจะบันทึก (ชิ้น)
 * @param {number} ctSec     CT ต่อ 1 จังหวะ (วินาที) — ไม่รู้ = ส่ง 0/null
 * @param {number} winMin    ช่วงเวลาที่ใบนี้มีให้เดินเครื่อง (นาที) — เปิดใบ→ตอนนี้/ปิดใบ
 * @param {number} parallelN จำนวนเลนที่ทำพาร์ทนี้พร้อมกัน (ไลน์เครื่องขนาน) · ไม่รู้ = 1
 * @param {number} dtMin     นาทีที่เครื่องหยุด (downtime) ในช่วงนั้น — หักออกจากเวลาที่มี
 * @param {number} piecesPerShot ชิ้นต่อ 1 จังหวะ (งานคู่ RH/LH ปั๊มทีเดียวได้ 2 ชิ้น · กฎ "ชิ้น ≠ shot")
 * @returns {null|{needMin:number,haveMin:number,overMin:number,ratioPct:number}}
 *          `null` = ไม่รู้ / ยังไม่เกินเกณฑ์ ⇒ **ห้ามเตือน**
 */
export function checkQtyFit({ qty, ctSec, winMin, parallelN = 1, dtMin = 0, piecesPerShot = 1,
  tolerance = QTY_FIT_TOL, minOverMin = QTY_FIT_MIN_OVER } = {}) {
  const q = Number(qty), ct = Number(ctSec), win = Number(winMin);
  const lanes = Math.max(1, Number(parallelN) || 1);
  const pps = Math.max(1, Number(piecesPerShot) || 1);
  if (!(q > 0) || !(ct > 0) || !(win > 0)) return null;          // ไม่รู้ = ไม่เตือน
  const shots = q / pps;                                          // 🔴 ชิ้น ≠ shot
  const needMin = (shots * ct) / 60 / lanes;
  const haveMin = Math.max(0, win - Math.max(0, Number(dtMin) || 0));
  const overMin = needMin - haveMin;
  if (!(needMin > haveMin * tolerance) || !(overMin >= minOverMin)) return null;
  return {
    needMin: Math.round(needMin),
    haveMin: Math.round(haveMin),
    overMin: Math.round(overMin),
    ratioPct: haveMin > 0 ? Math.round((needMin / haveMin) * 100) : null,
  };
}

/** ข้อความของด่าน ① — รวมไว้ที่นี่ ห้ามเขียนเองในหน้า (ต้องบอก "ต้องไปตรวจอะไร" ไม่ใช่แค่ว่าผิด) */
export function qtyFitMessage(fit, { matNo = '', qty = 0, ctSec = 0 } = {}) {
  if (!fit) return '';
  return `ยอด ${Number(qty).toLocaleString()} ชิ้น${matNo ? ` (${matNo})` : ''} ที่ CT ${ctSec} วิ `
    + `ต้องใช้เวลาเดินเครื่อง ${fit.needMin.toLocaleString()} นาที `
    + `แต่ช่วงนี้มีให้แค่ ${fit.haveMin.toLocaleString()} นาที (เกิน ${fit.overMin.toLocaleString()} นาที)\n`
    + 'ตรวจก่อนบันทึก: ① พิมพ์ยอดเกินหลักไหม ② ลืมลง Downtime ที่เครื่องหยุดไหม '
    + '③ ใบนี้เปิดช้ากว่าที่เริ่มทำจริงไหม ④ ทำหลายเลนพร้อมกันแต่ทะเบียนยังไม่ได้ตั้ง';
}

/* ── ② ด่านรีเช็คก่อนส่งขอปิดกะ ──────────────────────────────────────────────────────
   `level`: `confirm` = ต้องติ๊กทีละข้อก่อนปิดกะได้ · `info` = บอกให้รู้ ไม่ต้องติ๊ก
   (`block` ของ Downtime เปิดค้าง อยู่ที่ `handleCloseSession` ตามเดิม — ด่านนั้นปิดตายอยู่แล้ว) */

/** ปลายกะที่ไกลจากเลิกงานเกินนี้ โดยไม่มีใบ downtime รองรับ = ชวนให้ทวน (กฎเดียวกับ `checkCloseTime`) */
export const CLOSE_DT_OVER_SHIFT_TOL = 1.02;   // เวลาหยุดรวมเกินเวลากะ 2% = เป็นไปไม่ได้

/**
 * @param {object} oee  ผลจาก `computeSessionOee` (ต้องมี pOver/pRawPct/dtOverstateMin/unknownQty/…)
 * @param {object} session แถวกะ
 * @param {number} dtRowCount จำนวนแถว downtime ของกะ
 * @param {object|null} endTimeWarn ผลจาก `checkCloseTime` (ไม่ส่ง = ไม่ตรวจข้อนี้)
 * @param {number} suspectPending ของสงสัยที่ QA ยังไม่ตัดสิน (ชิ้น)
 * @returns {Array<{key,level,title,detail,hint}>}
 */
export function buildCloseChecks({ oee = null, session = null, dtRowCount = 0,
  endTimeWarn = null, suspectPending = 0 } = {}) {
  const out = [];
  if (!oee) return out;
  const n = (v) => Number(v) || 0;
  const fmt = (v) => n(v).toLocaleString();

  /* 🔴 ข้อสำคัญที่สุด — "งานที่บันทึกไว้ ใช้เวลามากกว่าเวลาที่เครื่องมีจริง" = ขัดกับฟิสิกส์
     ตัวเลขมาจาก `computeSessionOee` (stdMin − runMin) ห้ามคิดเองในหน้า
     เคสนี้แปลว่า **ยอด หรือ เวลา อย่างใดอย่างหนึ่งผิด** — ระบบชี้ไม่ได้ว่าอันไหน คนต้องตรวจ */
  if (oee.pOver && n(oee.dtOverstateMin) >= QTY_FIT_MIN_OVER) {
    out.push({
      key: 'work_over_time',
      level: 'confirm',
      title: `งานที่บันทึกไว้ใช้เวลามากกว่าเวลาที่เครื่องมี ${fmt(oee.dtOverstateMin)} นาที`,
      detail: `%P คำนวณได้ ${oee.pRawPct ?? '—'}% (ถูกตัดเหลือ 100%) · งานตามมาตรฐาน `
        + `${fmt(oee.stdMin)} นาที แต่เวลาเดินเครื่องมีแค่ ${fmt(oee.runMin)} นาที`,
      hint: 'ยอดหรือเวลาผิดอย่างใดอย่างหนึ่ง — ไล่ตาราง %P รายชิ้นงานด้านล่างว่า MAT ไหนกินเวลาเกิน '
        + 'แล้วแก้ที่ต้นเหตุ: ยอดพิมพ์เกินหลัก / ลืมลง Downtime / เวลาเริ่ม-จบ MAT ไม่ตรง / CT ในทะเบียนผิด',
    });
  }

  /* เวลาหยุดรวม > เวลากะ = เป็นไปไม่ได้ (ไลน์ขนานถูกหารเลนมาแล้วใน `loggedDtMin`) */
  const shiftMin = n(oee.shiftMin);
  if (shiftMin > 0 && n(oee.loggedDtMin) > shiftMin * CLOSE_DT_OVER_SHIFT_TOL) {
    out.push({
      key: 'dt_over_shift',
      level: 'confirm',
      title: `เวลาหยุดรวม ${fmt(oee.loggedDtMin)} นาที มากกว่าเวลากะ ${fmt(shiftMin)} นาที`,
      detail: 'รวมนาทีของทุกใบ Downtime แล้วเกินความยาวของกะนี้',
      hint: 'มักเกิดจากใบที่ลืมปิดแล้วเวลาจบเพี้ยนไปทั้งกะ หรือใบซ้ำ 2 ใบของเหตุเดียวกัน — ไล่ดูตาราง Downtime',
    });
  }

  /* กะยาวแต่ไม่มีข้อมูลอะไรเลย = ลืมลง ไม่ใช่ "วันนี้ไม่มีงาน" (ไม่มีงานต้องมีใบ "ไม่มีแผนผลิต") */
  if (n(oee.totalProduced) === 0 && dtRowCount === 0 && shiftMin >= 60) {
    out.push({
      key: 'no_data',
      level: 'confirm',
      title: 'กะนี้ไม่มียอดผลิตและไม่มี Downtime เลย',
      detail: `กะยาว ${fmt(shiftMin)} นาที แต่ไม่มีข้อมูลการผลิตสักรายการ`,
      hint: 'ลืมสแกนเปิดใบ / ลืมลงยอด หรือถ้าวันนี้ไม่มีแผนผลิตจริง ให้ลง Downtime "ไม่มีแผนผลิต" ไว้ '
        + 'ไม่งั้น %A ของกะนี้จะกดค่าเฉลี่ยของไลน์ทั้งเดือน',
    });
  }

  /* ปลายกะที่ไม่มีใบ downtime รองรับ — ด่านเดียวกับที่เตือนใต้ช่องเวลา (เอามารวมในด่านก่อนปิด)
     รูปของ `endTimeWarn` = ผลดิบจาก `checkCloseTime` (`null` = ตรวจไม่ได้ ⇒ ปล่อยผ่าน ห้ามบล็อก) */
  if (endTimeWarn && endTimeWarn.ok === false && n(endTimeWarn.unaccountedMin) > 0) {
    out.push({
      key: 'end_time_far',
      level: 'confirm',
      title: `เวลาปิดกะล้ำหน้าเวลาจริง ${fmt(endTimeWarn.aheadMin)} นาที — ไม่มีใบ Downtime รองรับ `
        + `${fmt(endTimeWarn.unaccountedMin)} นาที`,
      detail: 'เวลาปิดกะ = ฐานเวลาของ %A/%P ทั้งกะ · นาทีที่ไม่มีอะไรรองรับจะถูกนับว่า "เดินเครื่องอยู่"',
      hint: `เลิกจริงตอนนี้ = แก้เวลาปิดเป็น ${endTimeWarn.nowHHmm || 'เวลาปัจจุบัน'} · `
        + 'ถ้าหยุดจริงตั้งแต่ก่อนหน้านั้น = ลง Downtime ช่วงที่ไม่ได้ผลิตให้ครบก่อน',
    });
  }

  /* ── info: บอกให้รู้ว่าตัวเลขยังไม่สมบูรณ์ (คนลงข้อมูลแก้เองไม่ได้ ไม่ต้องติ๊ก) ── */
  if (n(oee.unknownQty) > 0) out.push({
    key: 'qty_no_ct', level: 'info',
    title: `ยอด ${fmt(oee.unknownQty)} ชิ้นไม่มี CT ในทะเบียน ⇒ ไม่เข้า %P`,
    detail: '%P ของกะนี้คิดจากเฉพาะพาร์ทที่รู้ CT', hint: 'แจ้ง PE ให้เติม CT ของพาร์ทนั้น',
  });
  if (n(oee.ngNoMatP) > 0) out.push({
    key: 'ng_no_mat', level: 'info',
    title: `ของเสีย ${fmt(oee.ngNoMatP)} ชิ้นชี้ MAT ไม่ได้ ⇒ ไม่เข้า %P`,
    detail: 'ของเสียที่ไม่ผูกใบผลิต ไม่รู้ CT จึงคิดเวลาที่เสียไปไม่ได้',
    hint: 'คราวหน้าเลือก MAT.NO ตอนลงของเสียด้วย (%Q ยังนับให้ครบอยู่)',
  });
  if (n(suspectPending) > 0) out.push({
    key: 'suspect_pending', level: 'info',
    title: `ของสงสัย ${fmt(suspectPending)} ชิ้นยังรอ QA ตัดสิน ⇒ %Q ของกะนี้เป็นค่าชั่วคราว`,
    detail: 'ตัดสินแล้วระบบจะคิด %Q ใหม่ให้เอง', hint: 'ตามผลพิจารณาที่ถังเหลือง/ถังแดง',
  });

  return out;
}

/** ข้อที่ต้องติ๊กก่อนปิดกะได้ */
export const confirmChecks = (checks = []) => checks.filter(c => c?.level === 'confirm');
