/* บอร์ด MO บนจอ TV ห้องช่าง (ประชุม 02/11 ข้อ B6 · 03/11) */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMoTvBoard, moTvGroupOf, fmtWait, MO_TV_GROUPS, MO_TV_COLS, MO_TV_DONE_FILTER } from '../moTvBoard.js';
import { STALE_SINCE_COLS } from '../mtnStale.js';

const NOW = Date.parse('2026-11-03T10:00:00+07:00');
const hAgo = (h) => new Date(NOW - h * 3600_000).toISOString();
/* แถวเลียนแบบการ select ด้วย MO_TV_COLS (คอลัมน์ที่ไม่มีค่า = null ไม่ใช่ undefined) */
const base = Object.fromEntries(MO_TV_COLS.split(',').map(k => [k, null]));
const mo = (o) => ({ ...base, id: o.mo_no, ...o });

test('ใบเข้ากองตาม stage — แยก 2 ฟอร์ม (MTN 8 ขั้น / JIG 7 ขั้น)', () => {
  assert.equal(moTvGroupOf(mo({ status: 'pending', mtn_dept: 'maintenance', purpose: 'repair', report_at: hAgo(1) })), 'accept');
  assert.equal(moTvGroupOf(mo({ status: 'repairing', mtn_dept: 'jig_maintenance' })), 'repair');
  assert.equal(moTvGroupOf(mo({ status: 'repaired', mtn_dept: 'maintenance' })), 'check');
  assert.equal(moTvGroupOf(mo({ status: 'checked', mtn_dept: 'jig_maintenance', purpose: 'repair' })), 'check');   // รอ QA
  assert.equal(moTvGroupOf(mo({ status: 'checked', mtn_dept: 'maintenance', purpose: 'repair' })), 'close');        // MTN ไม่มี QA = รับมอบ
  assert.equal(moTvGroupOf(mo({ status: 'handover', mtn_dept: 'maintenance', ho_at: hAgo(2) })), 'close');
  assert.equal(moTvGroupOf(mo({ status: 'handover', mtn_dept: 'die_maintenance' })), 'close');
  // ด่านอนุมัติก่อนเริ่มงาน (ไม่มีเลขขั้น) ห้ามปนกับ "รอช่างรับงาน"
  assert.equal(moTvGroupOf(mo({ status: 'pending', mtn_dept: 'maintenance', purpose: 'improve' })), 'approve');
  // นอกลำดับขั้น = ตะกร้ารับท้าย ห้ามหาย
  assert.equal(moTvGroupOf(mo({ status: 'returned', mtn_dept: 'maintenance' })), 'other');
  assert.equal(moTvGroupOf(mo({ status: 'waiting_vendor', mtn_dept: 'maintenance' })), 'other');
});

test('กรองกอง/ทีม/ขอบเขต + นับที่ซ่อน · ใบปิดไม่นับ', () => {
  const rows = [
    mo({ mo_no: 'A', status: 'pending', mtn_dept: 'maintenance', purpose: 'repair', report_at: hAgo(30), line_name: 'L1' }),
    mo({ mo_no: 'B', status: 'pending', mtn_dept: 'maintenance', purpose: 'repair', report_at: hAgo(2), line_name: 'L1' }),
    mo({ mo_no: 'C', status: 'repairing', mtn_dept: 'maintenance', accept_at: hAgo(5), line_name: 'L1' }),
    mo({ mo_no: 'D', status: 'pending', mtn_dept: 'jig_maintenance', purpose: 'repair', report_at: hAgo(1), line_name: 'L1' }),
    mo({ mo_no: 'E', status: 'pending', mtn_dept: 'maintenance', purpose: 'repair', report_at: hAgo(1), line_name: 'OTHER' }),
    mo({ mo_no: 'F', status: 'closed', mtn_dept: 'maintenance', line_name: 'L1' }),
  ];
  const b = buildMoTvBoard(rows, { group: 'accept', team: 'maintenance', inScope: (n) => n !== 'OTHER', now: NOW });
  assert.deepEqual(b.rows.map(r => r.o.mo_no), ['A', 'B'], 'ค้างนานสุดขึ้นก่อน');
  assert.equal(b.counts.accept, 2);
  assert.equal(b.counts.repair, 1, 'นับทุกกองเพื่อเขียนภาพรวม');
  assert.equal(b.total, 3);
  assert.equal(b.hiddenScope, 1);
  assert.equal(b.hiddenTeam, 1);
  assert.equal(b.rows[0].ageMin, 30 * 60);
  assert.equal(b.badGroup, false);
});

test('ค่า mo= ไม่รู้จัก = ไม่กรอง + ธงเตือน (ห้ามจอว่าง)', () => {
  const rows = [mo({ mo_no: 'A', status: 'repairing', mtn_dept: 'maintenance', accept_at: hAgo(1) })];
  const b = buildMoTvBoard(rows, { group: 'zzz', now: NOW });
  assert.equal(b.badGroup, true);
  assert.equal(b.rows.length, 1);
  assert.equal(buildMoTvBoard(rows, { group: 'all', now: NOW }).rows.length, 1);
});

test('ไม่รู้เวลาเข้าขั้น = ageMin null (ห้าม 0) และไปอยู่ท้ายลิสต์', () => {
  const rows = [
    mo({ mo_no: 'X', status: 'repairing', mtn_dept: 'maintenance' }),
    mo({ mo_no: 'Y', status: 'repairing', mtn_dept: 'maintenance', accept_at: hAgo(1) }),
  ];
  const b = buildMoTvBoard(rows, { now: NOW });
  assert.deepEqual(b.rows.map(r => r.o.mo_no), ['Y', 'X']);
  assert.equal(b.rows[1].ageMin, null);
  assert.equal(b.unknownAge, 1);
  assert.equal(fmtWait(null), '–');
  assert.equal(fmtWait(45), '45 น.');
  assert.equal(fmtWait(130), '2 ชม.');
  assert.equal(fmtWait(3 * 1440 + 5), '3 วัน');
});

test('คอลัมน์ select ครอบคอลัมน์เวลาเข้าขั้นทุกตัว · กองไม่ซ้ำ stage', () => {
  const cols = MO_TV_COLS.split(',');
  for (const c of STALE_SINCE_COLS) assert.ok(cols.includes(c), `ขาด ${c}`);
  for (const c of ['status', 'mtn_dept', 'purpose', 'dept_manager_at', 'plant_manager_at', 'qa_skipped_at', 'mtn_head_at', 'approve_at']) assert.ok(cols.includes(c));
  const all = MO_TV_GROUPS.flatMap(g => g.stages);
  assert.equal(new Set(all).size, all.length);
  assert.match(MO_TV_DONE_FILTER, /^\(.*closed.*\)$/);
});

test('ทะเบียนพารามิเตอร์ /tv (หน้าตั้งค่าจอวน) ตรงกับกองบนบอร์ด · ชุดสำเร็จรูป 4 หน้า', async () => {
  const { DISPLAY_PAGE_PARAMS, moRotationItems, queryParamsOf, isValidRotationPath, barChips } = await import('../displayRotation.js');
  const defs = DISPLAY_PAGE_PARAMS['/tv'];
  assert.ok(defs.find(d => d.key === 'dept').options.some(o => o.value === 'mo'));
  const moDef = defs.find(d => d.key === 'mo');
  assert.deepEqual(moDef.options.map(o => o.value), MO_TV_GROUPS.map(g => g.key), 'ตัวเลือกต้องครบทุกกองและไม่มีค่าที่บอร์ดไม่รู้จัก');
  assert.ok(defs.find(d => d.key === 'team').showIf.dept.includes('mo'));
  const items = moRotationItems('maintenance');
  assert.equal(items.length, 4);
  for (const it of items) {
    assert.ok(isValidRotationPath(it.path));
    const q = queryParamsOf(it.path);
    assert.equal(q.dept, 'mo');
    assert.equal(q.team, 'maintenance');
    assert.ok(MO_TV_GROUPS.some(g => g.key === q.mo));
    assert.equal(it.sec, null);
  }
  assert.deepEqual(items.map(i => queryParamsOf(i.path).mo), ['accept', 'repair', 'check', 'close']);
  assert.equal(queryParamsOf(moRotationItems('')[0].path).team, 'all');
  // แถบบนจอ TV บอกว่ากำลังโชว์กองไหน
  assert.ok(barChips(items[0].path).some(c => c.includes('รอช่างรับงาน')));
});
