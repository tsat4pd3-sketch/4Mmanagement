/**
 * เลื่อนนาฬิกาของ process ไปข้างหน้า `FAKE_DAYS` วัน (โหลดผ่าน `node --import`)
 * ใช้คู่กับ scripts/run-tests.mjs โหมด --clock — ดูเหตุผลในไฟล์นั้น
 */
const SHIFT = Number(process.env.FAKE_DAYS || 0) * 86400000;
if (SHIFT) {
  const RealDate = Date;
  class ShiftedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(RealDate.now() + SHIFT);
      else super(...args);
    }
    static now() { return RealDate.now() + SHIFT; }
  }
  globalThis.Date = ShiftedDate;
}
