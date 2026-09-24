/* ══ 🩺 schemaAudit — ตรวจสุขภาพโครงสร้างฐานข้อมูล (แท็บใน /schema) ═══════════════════
   2026-09-22 · คำสั่ง user: *"พวกตารางซ้ำๆ คือยังไง audit test และ improve ได้มั้ย
   ตารางไหนไม่ได้ใช้ หรือมันโครงสร้างไม่ดี แก้ไขให้ที ตอนนี้จำนวน schema เยอะมาก"*

   ทำไมเป็น "จอ" ไม่ใช่ "รายงานครั้งเดียว":
     รอบนี้เจอตารางสำรองค้างใน public 37 ตัว (DR 33 + Main 4) ที่ session ก่อนๆ สร้างไว้
     ตอนทำ migration แล้วไม่มีใครเก็บกวาด — **ถ้าตอบเป็นรายงาน เดือนหน้าก็กลับมาใหม่**
     ⇒ ทำเป็นตัวตรวจที่อ่านโครงสร้างจริงทุกครั้งที่เปิดจอ + มีด่านใน build กันคนสร้างเพิ่ม
     (`regressionGuards`: ห้าม migration ใหม่ create ตารางสำรองใน public)

   ไฟล์นี้ pure ล้วน (ไม่แตะ DB/DOM) — เทส `__tests__/schemaAudit.test.mjs`
   ═══════════════════════════════════════════════════════════════════════════════════════ */

/* ชื่อที่ถือว่าเป็น "ตารางสำรอง/ชั่วคราวของ migration"
   ⚠️ ต้องตรงกับ regex ใน migration `20260922_archive_backup_tables_*.sql` และใน
      `regressionGuards` — 3 ที่นี้ต้องแก้พร้อมกันเสมอ ไม่งั้นด่านกับจอบอกคนละเรื่อง */
export const BACKUP_RE = /(^_?(bak|bk|reclass)_)|(_bak_)|(_backup_\d{8}$)|(_backfill_\d{8}$)/;
export const isBackupName = (t) => BACKUP_RE.test(String(t || ''));

export const fmtBytes = (b) => {
  const n = Number(b) || 0;
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
};

const isView = (r) => r.k === 'v' || r.k === 'm';

/**
 * ตรวจ 1 project
 * @param {object[]} tables  แถวจาก esm_schema_overview().tables
 * @param {object[]} fks     เส้น FK จาก esm_schema_overview().fks
 * @param {Set<string>} used ชื่อตารางที่โค้ดฝั่งแอปเรียกใช้จริง (จากตัวสแกนซอร์ส)
 * @param {'main'|'dr'} side ฝั่งไหน — DR สำคัญกว่าเพราะ client วิ่งด้วย anon เสมอ
 */
export function auditProject({ tables = [], fks = [], used = new Set(), side = 'main' } = {}) {
  const rows = Array.isArray(tables) ? tables : [];
  const fkIn = new Map();
  for (const f of Array.isArray(fks) ? fks : []) fkIn.set(f.rt, (fkIn.get(f.rt) || 0) + 1);

  const backup = rows.filter(r => isBackupName(r.t));
  const noRls = rows.filter(r => !isView(r) && !r.rls && !isBackupName(r.t));
  const noPk = rows.filter(r => !isView(r) && !(r.pk || []).length && !isBackupName(r.t));
  const orphan = rows.filter(r => !isBackupName(r.t) && !used.has(r.t) && !(fkIn.get(r.t) > 0));
  const emptyUsed = rows.filter(r => !isView(r) && used.has(r.t) && !(Number(r.rows) > 0));
  const big = [...rows].sort((a, b) => (b.bytes || 0) - (a.bytes || 0)).slice(0, 5);

  return {
    total: rows.length,
    checks: [
      {
        id: 'backup', level: backup.length ? 'bad' : 'ok',
        title: '🧹 ตารางสำรอง/ชั่วคราวที่ค้างใน public',
        why: 'migration ที่แตะข้อมูลจริงมัก copy ตารางไว้กันพลาด — ถ้าทิ้งไว้ใน public มันปนกับตารางจริง '
           + 'ทุกที่ที่มองเห็น schema และ (ถ้า RLS ไม่ตามมา) เปิดให้ anon key อ่านสำเนาข้อมูลจริงได้',
        fix: 'ย้ายเข้า schema `archive` (ไม่ลบ ย้อนได้) — ดู migration 20260922_archive_backup_tables_*.sql',
        rows: backup.map(r => ({ t: r.t, note: `${r.rows > 0 ? `~${r.rows} แถว` : 'ว่าง'}${r.rls ? '' : ' · RLS ปิด'}` })),
      },
      {
        id: 'no_rls', level: noRls.length ? (side === 'dr' ? 'bad' : 'warn') : 'ok',
        title: '🛡️ ตารางที่ปิด RLS',
        why: side === 'dr'
          ? 'ฝั่งนี้ client วิ่งด้วย role anon เสมอ (anon key ฝังอยู่ในบันเดิลเว็บ) — RLS ปิด = ใครก็อ่าน/เขียนได้ทั้งตารางโดยไม่ต้อง login'
          : 'ตารางที่ปิด RLS ไม่มีด่านฝั่งฐานข้อมูลเลย พึ่งความถูกต้องของโค้ดหน้าอย่างเดียว',
        fix: 'enable row level security + เขียน policy ด้วย has_perm(<คีย์เดียวกับปุ่มบนจอ>) ให้ครบทุกคำสั่งที่โค้ดใช้',
        rows: noRls.map(r => ({ t: r.t, note: `${r.rows > 0 ? `~${r.rows} แถว` : 'ว่าง'}` })),
      },
      {
        id: 'no_pk', level: noPk.length ? 'warn' : 'ok',
        title: '🔑 ตารางที่ไม่มีคีย์หลัก (PK)',
        why: 'ไม่มี PK = ชี้ "แถวไหน" ไม่ได้ ⇒ แก้/ลบรายแถวไม่ได้ · realtime DELETE ส่ง old มาไม่ครบ · แถวซ้ำได้เงียบๆ',
        fix: 'เพิ่ม primary key (หรือ unique ที่ระบุแถวได้) — ตารางบันทึกเหตุการณ์ใช้ id uuid default gen_random_uuid()',
        rows: noPk.map(r => ({ t: r.t, note: `${r.cols} คอลัมน์` })),
      },
      {
        id: 'orphan', level: orphan.length ? 'info' : 'ok',
        title: '🕳️ ไม่มีหน้าไหนเรียกใช้ และไม่มีตารางอื่นชี้มา',
        why: 'อาจเป็นของเลิกใช้แล้วที่ลืมเก็บ หรือฟีเจอร์ที่ทำไว้แล้วยังไม่ได้ต่อจอ',
        fix: '⚠️ ห้ามลบทันที — เช็คก่อนว่า trigger/function ฝั่ง DB หรือ Edge Function ใช้อยู่ไหม (ตัวสแกนนี้เห็นแค่โค้ดฝั่งหน้าเว็บ)',
        rows: orphan.map(r => ({ t: r.t, note: `${isView(r) ? 'วิว · ' : ''}${r.rows > 0 ? `~${r.rows} แถว` : 'ว่าง'}` })),
      },
      {
        id: 'empty_used', level: 'info',
        title: '🈳 โค้ดเรียกใช้อยู่ แต่ยังไม่มีข้อมูลสักแถว',
        why: 'ฟีเจอร์พร้อมแล้วแต่หน้างานยังไม่ได้ใช้ (หรือกรอกไม่สำเร็จเพราะสิทธิ์/บั๊ก) — ไม่ใช่ปัญหาโครงสร้าง แต่ควรรู้',
        fix: 'ถ้าตั้งใจว่าต้องมีข้อมูลแล้ว ให้ไล่ดูว่าปุ่มบันทึกในหน้านั้นเขียนติดจริงไหม (RLS ปฏิเสธ UPDATE = เงียบ)',
        rows: emptyUsed.map(r => ({ t: r.t, note: 'ว่าง' })),
      },
      {
        id: 'big', level: 'info',
        title: '📦 ตารางที่กินพื้นที่มากสุด',
        why: 'ตัวที่โตเร็วคือตัวที่ทำให้ค่า egress/พื้นที่พุ่ง และเป็นตัวแรกที่ควรมีนโยบายลบย้อนหลัง (retention)',
        fix: 'ตารางบันทึกเหตุการณ์ที่โตเรื่อยๆ ควรมี cron ลบของเก่า (แบบ audit_log ที่เก็บ 6 เดือน)',
        rows: big.map(r => ({ t: r.t, note: `${fmtBytes(r.bytes)} · ~${r.rows} แถว` })),
      },
    ],
  };
}

/** ข้อความสรุปสำหรับกดคัดลอกไปแจ้ง/ทำงานต่อ */
export function auditText(result, projectLabel) {
  if (!result) return '';
  const out = [`🩺 ตรวจสุขภาพโครงสร้าง — ${projectLabel || ''} (${result.total} ตาราง/วิว)`];
  for (const c of result.checks) {
    out.push(`\n${c.title}: ${c.rows.length ? `${c.rows.length} รายการ` : '— ไม่พบ'}`);
    for (const r of c.rows.slice(0, 40)) out.push(`  · ${r.t} (${r.note})`);
    if (c.rows.length > 40) out.push(`  · … อีก ${c.rows.length - 40}`);
  }
  return out.join('\n');
}

export default { auditProject, auditText, isBackupName, BACKUP_RE, fmtBytes };
