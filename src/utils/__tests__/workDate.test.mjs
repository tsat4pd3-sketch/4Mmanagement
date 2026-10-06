import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getWorkDate, getCurrentShift, localDateStr, WORK_DAY_START_HOUR, shiftOfTime, workDateOfTime,
         openShiftDefaults, shiftStartTime } from '../workDate.js';

/* 📅 วันทำงาน — ทุกเคสส่ง `now` เองเสมอ ห้ามอ้างเวลาจริง (กันเทสระเบิดเวลา) */

const at = (s) => new Date(s);   // สร้างตามเวลาเครื่อง (เจตนา — ฟังก์ชันนี้ทำงานตามเวลาเครื่อง)

test('ก่อน 08:00 นับเป็นวันก่อนหน้า (กะดึกข้ามเที่ยงคืน)', () => {
  assert.equal(getWorkDate(at('2026-09-23T07:59:00')), '2026-09-22');
  assert.equal(getWorkDate(at('2026-09-23T08:00:00')), '2026-09-23');
  assert.equal(getWorkDate(at('2026-09-23T03:00:00')), '2026-09-22');
  assert.equal(getWorkDate(at('2026-09-23T23:59:00')), '2026-09-23');
});

test('🔴 ข้ามเดือน/ข้ามปี — ตี 3 ของวันที่ 1 ต้องได้วันสุดท้ายของเดือนก่อน', () => {
  assert.equal(getWorkDate(at('2026-03-01T03:00:00')), '2026-02-28');
  assert.equal(getWorkDate(at('2024-03-01T03:00:00')), '2024-02-29');   // อธิกสุรทิน
  assert.equal(getWorkDate(at('2026-01-01T03:00:00')), '2025-12-31');
});

test('🔴 ไม่ใช้ UTC — เที่ยงคืนครึ่งตามเวลาเครื่องต้องไม่เด้งไปอีกวัน', () => {
  /* กับดักที่กฎ CLAUDE.md ห้ามไว้: `toISOString().slice(0,10)` ที่เวลาไทย 00:30
     จะได้ "เมื่อวาน 17:30 UTC" = วันก่อนหน้า ซึ่งบังเอิญตรงกับคำตอบที่ถูก
     ⇒ เคสที่แยกออกจริงคือ **08:30** (ไทย = วันนี้ · UTC = 01:30 วันเดียวกันก็จริง
        แต่ถ้าเครื่องอยู่โซนอื่นจะเพี้ยน) จึงล็อกด้วย localDateStr แทนการเทียบ ISO */
  assert.equal(getWorkDate(at('2026-09-23T08:30:00')), localDateStr(at('2026-09-23T08:30:00')));
  assert.equal(localDateStr(at('2026-09-05T00:30:00')), '2026-09-05', 'ต้องเป็นวันตามเครื่อง ไม่ใช่ UTC');
});

test('กะ: เช้า 08:00–19:59 · ดึก 20:00–07:59', () => {
  assert.equal(getCurrentShift(at('2026-09-23T08:00:00')), 'day');
  assert.equal(getCurrentShift(at('2026-09-23T19:59:00')), 'day');
  assert.equal(getCurrentShift(at('2026-09-23T20:00:00')), 'night');
  assert.equal(getCurrentShift(at('2026-09-23T07:59:00')), 'night');
  assert.equal(WORK_DAY_START_HOUR, 8);
});

/* ── จัด timestamp จริงลงกะ/วันทำงาน (2026-09-25 · ตัวกรองวันที่+กะ ของรายการใบซ่อม) ── */

test('shiftOfTime / workDateOfTime: ใบที่แจ้งตี 2 = กะดึกของวันทำงานก่อนหน้า', () => {
  assert.equal(shiftOfTime('2026-09-23T02:10:00'), 'night');
  assert.equal(workDateOfTime('2026-09-23T02:10:00'), '2026-09-22');
  assert.equal(shiftOfTime('2026-09-23T08:00:00'), 'day');
  assert.equal(workDateOfTime('2026-09-23T08:00:00'), '2026-09-23');
  assert.equal(shiftOfTime('2026-09-23T20:00:00'), 'night');
  assert.equal(workDateOfTime('2026-09-23T20:00:00'), '2026-09-23', 'กะดึกก่อนเที่ยงคืน = วันทำงานวันนั้น');
});

test('🔴 ค่าที่อ่านไม่ได้ต้องเป็น null ห้ามตกไปปี 1970', () => {
  for (const bad of [null, undefined, '', 'ไม่ใช่วันที่', NaN]) {
    assert.equal(shiftOfTime(bad), null, `shiftOfTime(${String(bad)})`);
    assert.equal(workDateOfTime(bad), null, `workDateOfTime(${String(bad)})`);
  }
  // `new Date(null)` = epoch ⇒ ถ้าเผลอไม่กันจะได้ 'day'/'1970-01-01' โดยไม่มีใครรู้
  assert.notEqual(shiftOfTime(null), getCurrentShift(new Date(0)));
});

test('รับ Date object ได้เหมือนกับสตริง (ผู้เรียกบางที่ส่ง Date มาแล้ว)', () => {
  assert.equal(shiftOfTime(at('2026-09-23T21:30:00')), 'night');
  assert.equal(workDateOfTime(at('2026-09-23T21:30:00')), '2026-09-23');
});

/* ── ค่าเริ่มต้นฟอร์มเปิดกะ — วัน+กะ ต้องมาจากเวลาเดียวกัน (06/10 · เคสจริง LINE C) ──────
   เดิมหน้าจอคิดแยกชิ้น: รีเฟรช `shift` จากนาฬิกา แต่ `work_date` ค้างค่าเดิม
   ⇒ 07:40 ได้ "กะดึกของวันนี้" = เริ่ม 20:00 คืนนี้ = เปิดกะล่วงหน้า 12 ชม. */

test('openShiftDefaults: ตอน 07:40 = กะดึกของ "เมื่อวาน" (กะที่กำลังเดินอยู่) ไม่ใช่ของวันนี้', () => {
  assert.deepEqual(openShiftDefaults(at('2026-10-05T07:40:00')),
    { work_date: '2026-10-04', shift: 'night', start_time: '20:00' });
});

test('openShiftDefaults: รอยต่อ 4 จุดของวัน', () => {
  const d = (t) => openShiftDefaults(at(t));
  assert.deepEqual(d('2026-10-05T07:59:59'), { work_date: '2026-10-04', shift: 'night', start_time: '20:00' });
  assert.deepEqual(d('2026-10-05T08:00:00'), { work_date: '2026-10-05', shift: 'day',   start_time: '08:00' });
  assert.deepEqual(d('2026-10-05T19:59:59'), { work_date: '2026-10-05', shift: 'day',   start_time: '08:00' });
  assert.deepEqual(d('2026-10-05T20:00:00'), { work_date: '2026-10-05', shift: 'night', start_time: '20:00' });
  assert.deepEqual(d('2026-10-06T00:30:00'), { work_date: '2026-10-05', shift: 'night', start_time: '20:00' });
});

test('🔴 openShiftDefaults: กะที่เสนอต้อง "เริ่มแล้ว" ไม่ใช่กะที่เริ่มในอนาคต', () => {
  /* ตรวจทุกชั่วโมงของวัน: เวลาเริ่มของกะที่เสนอ ต้องไม่อยู่หลัง "ตอนนี้"
     (เดิมบั๊กโผล่เฉพาะ 00:00-07:59 ซึ่งเป็นช่วงที่คนเปลี่ยนกะจริง จึงพลาดกันง่าย) */
  for (let h = 0; h < 24; h++) {
    const now = at(`2026-10-05T${String(h).padStart(2, '0')}:30:00`);
    const d = openShiftDefaults(now);
    const startMs = new Date(`${d.work_date}T${d.start_time}:00`).getTime();
    assert.ok(startMs <= now.getTime(),
      `${h}:30 เสนอ ${d.shift} ของ ${d.work_date} เริ่ม ${d.start_time} = ยังไม่เริ่ม (ล่วงหน้า ${Math.round((startMs - now.getTime()) / 60000)} น.)`);
  }
});

test('shiftStartTime: กะดึก 20:00 · อย่างอื่น 08:00', () => {
  assert.equal(shiftStartTime('night'), '20:00');
  assert.equal(shiftStartTime('day'), '08:00');
  assert.equal(shiftStartTime(undefined), '08:00', 'ไม่รู้กะ = ใช้เวลาเริ่มกะเช้า ไม่ throw');
});
