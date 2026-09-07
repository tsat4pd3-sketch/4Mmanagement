/**
 * qaFmeReadiness — "เปิดสวิตช์เรียกตรวจ FME ได้หรือยัง" (pure · ไม่แตะ DB/UI)
 *
 * ที่มา (2026-09-03): ระบบ FME ติดตั้งครบ (migration/cron/edge v14) แต่ dry-run กับข้อมูลจริงพบว่า
 * ถ้ากดเปิดตอนนี้ QA จะได้คิว 51 รายการที่ **กดเปิดใบตรวจไม่ได้สักอัน** (`qa_parts` ผูกรุ่นที่วิ่งจริงได้ 0)
 * และข้อความชุดแรกจะ **ตกไปห้อง Telegram fallback** เพราะ rule `qa_fme_call` ยังไม่เลือกห้อง
 * → สวิตช์เปิดได้เฉยๆ = ล้มเหลวเงียบ (ENGINEERING-PRINCIPLES §2/§6) จึงต้องมี preflight ที่ตัวสวิตช์
 *
 * ลำดับที่ต้องครบก่อนเปิด (ห้ามสลับ — docs/modules/qa-inspection.md):
 *   1. /qa-setup ลงพาร์ท + ผูกให้ครอบรุ่นที่วิ่งจริง (> 0 ก็พอ ไม่ต้องครบ)
 *   2. /notification-config เลือกห้องให้ qa_fme_call (+ qa_fme_overdue)
 *   3. /qa ⚙️ ค่อยเปิดสวิตช์
 *
 * ⚠️ `resolveQaPartId` ต้อง **ตรงกับ edge `qa-fme-scan` §5 (resolvePart)** ทุกบรรทัด —
 *    edge เป็น Deno import ไฟล์นี้ไม่ได้ จึงต้องมี 2 สำเนา · แก้ฝั่งไหนให้แก้อีกฝั่งในคอมมิทเดียวกัน
 *    (ถ้า drift: จอบอก "พร้อม" แต่คิวจริงเปิดใบไม่ได้ = กลับไปเงียบเหมือนเดิม)
 */

/** normalize เลข MAT/part no ให้เทียบกันได้ — สำเนาของ `norm` ใน edge */
export const normNo = (s) => String(s ?? '').replace(/[\s-]/g, '').toUpperCase();

/**
 * สร้างตัวจับคู่ "รุ่นที่ผลิต → พาร์ท QA" จาก master 2 ฝั่ง (สำเนา resolvePart ของ edge)
 * @param {Array<{id:string, part_no?:string, mat_no?:string}>} qaParts   qa_parts (Main · is_active)
 * @param {Array<{mat_no?:string, p_no?:string}>}              products  dr_products (DR)
 * @returns {(mats: string[]) => string|null}  รับเลข MAT ของรุ่น (ตัวแทน + คู่ RH/LH) → qa_parts.id
 */
export function makeQaPartResolver(qaParts, products) {
  const byMat = new Map(), byNo = new Map(), pnoOf = new Map();
  for (const p of qaParts || []) {
    if (!p?.id) continue;
    if (p.mat_no) byMat.set(normNo(p.mat_no), p.id);      // ผูกตรงรายเลข SAP (แม่นสุด)
    if (p.part_no) byNo.set(normNo(p.part_no), p.id);     // ถอยไปเทียบ part_no
  }
  for (const d of products || []) if (d?.mat_no && d.p_no) pnoOf.set(d.mat_no, d.p_no);
  return (mats) => {
    const all = (mats || []).filter(Boolean);
    for (const m of all) { const hit = byMat.get(normNo(m)); if (hit) return hit; }
    for (const m of all) {                                                          // เลขพาร์ทลูกค้า (p_no)
      const pn = pnoOf.get(m);
      const hit = pn ? byNo.get(normNo(pn)) : null;
      if (hit) return hit;
    }
    for (const m of all) { const hit = byNo.get(normNo(m)); if (hit) return hit; }  // part_no = เลข SAP
    return null;
  };
}

/**
 * นับว่ารุ่นในทะเบียนสินค้า (dr_products) ผูกกับพาร์ท QA ได้กี่รุ่น
 * @returns {{ models:number, linked:number, parts:number, partsWithMat:number }}
 */
export function countLinkedModels(qaParts, products) {
  const resolve = makeQaPartResolver(qaParts, products);
  const models = (products || []).filter(d => d?.mat_no);
  let linked = 0;
  for (const d of models) if (resolve([d.mat_no, d.pair_mat_no])) linked++;
  const parts = (qaParts || []).length;
  const partsWithMat = (qaParts || []).filter(p => p?.mat_no && String(p.mat_no).trim()).length;
  return { models: models.length, linked, parts, partsWithMat };
}

const roomOk = (rule) => !!rule && rule.is_enabled !== false && Array.isArray(rule.channel_ids) && rule.channel_ids.length > 0;

/**
 * ประเมินความพร้อมก่อนเปิดสวิตช์ — คืนรายการเช็ค + สรุปว่าเปิดได้ไหม
 * @param {object} p
 * @param {Array}  p.qaParts    qa_parts ที่ is_active (Main) · null = โหลดไม่ได้
 * @param {Array}  p.products   dr_products (DR) · null = โหลดไม่ได้
 * @param {Array}  p.rules      notification_rules เฉพาะ qa_fme_call / qa_fme_overdue · null = โหลดไม่ได้
 * @returns {{ canEnable:boolean, checks:Array<{key, ok:boolean|null, hard:boolean, label:string, detail:string, fixAt:string}> }}
 *   ok=null = ประเมินไม่ได้ (ข้อมูลโหลดไม่มา) → ถือว่ายังไม่พร้อม (fail-closed) และบอกเหตุผล ห้ามแปลงเป็นผ่าน
 */
export function assessFmeReadiness({ qaParts, products, rules } = {}) {
  const checks = [];

  if (!Array.isArray(qaParts) || !Array.isArray(products)) {
    checks.push({ key: 'parts', ok: null, hard: true, label: 'พาร์ท QA ผูกกับรุ่นที่ผลิต',
      detail: !Array.isArray(qaParts) ? 'อ่าน qa_parts ไม่ได้ — ประเมินไม่ได้' : 'อ่านทะเบียนสินค้า (dr_products) ไม่ได้ — ประเมินไม่ได้',
      fixAt: '/qa-setup' });
  } else {
    const c = countLinkedModels(qaParts, products);
    checks.push({ key: 'parts', ok: c.linked > 0, hard: true, label: 'พาร์ท QA ผูกกับรุ่นที่ผลิต',
      detail: c.linked > 0
        ? `ผูกได้ ${c.linked}/${c.models} รุ่น (พาร์ท QA ${c.parts} · ตั้ง MAT แล้ว ${c.partsWithMat})`
        : c.parts === 0
          ? 'ยังไม่มีพาร์ทในระบบตรวจเลย — เปิดแล้วทุกคิวจะกดเปิดใบตรวจไม่ได้'
          : `มีพาร์ท QA ${c.parts} แต่ไม่ตรงกับรุ่นที่ผลิตสักรุ่น (ตั้ง MAT แล้ว ${c.partsWithMat}) — ผูก MAT/เลขพาร์ทลูกค้าให้ตรงก่อน`,
      fixAt: '/qa-setup' });
  }

  if (!Array.isArray(rules)) {
    checks.push({ key: 'room_call', ok: null, hard: true, label: 'ห้อง Telegram สำหรับ "เรียกตรวจ" (qa_fme_call)',
      detail: 'อ่าน notification_rules ไม่ได้ — ประเมินไม่ได้', fixAt: '/notification-config' });
    checks.push({ key: 'room_overdue', ok: null, hard: false, label: 'ห้อง Telegram สำหรับ "เกินเวลา" (qa_fme_overdue)',
      detail: 'อ่าน notification_rules ไม่ได้ — ประเมินไม่ได้', fixAt: '/notification-config' });
  } else {
    const call = rules.find(r => r?.event_key === 'qa_fme_call');
    const over = rules.find(r => r?.event_key === 'qa_fme_overdue');
    checks.push({ key: 'room_call', ok: roomOk(call), hard: true, label: 'ห้อง Telegram สำหรับ "เรียกตรวจ" (qa_fme_call)',
      detail: roomOk(call) ? `เลือกแล้ว ${call.channel_ids.length} ห้อง`
        : !call ? 'ยังไม่มี rule นี้ (ยังไม่ apply migration 20260819_qa_fme_call.sql)'
        : call.is_enabled === false ? 'rule ถูกปิดอยู่' : 'ยังไม่เลือกห้อง — เปิดแล้วข้อความชุดแรกจะไปห้อง fallback',
      fixAt: '/notification-config' });
    checks.push({ key: 'room_overdue', ok: roomOk(over), hard: false, label: 'ห้อง Telegram สำหรับ "เกินเวลา" (qa_fme_overdue)',
      detail: roomOk(over) ? `เลือกแล้ว ${over.channel_ids.length} ห้อง`
        : !over ? 'ยังไม่มี rule นี้' : over.is_enabled === false ? 'rule ถูกปิดอยู่ — เกินเวลาจะไม่มีใครถูกเตือน'
        : 'ยังไม่เลือกห้อง — เตือนเกินเวลาจะไปห้อง fallback (เปิดได้ แต่ควรตั้ง)',
      fixAt: '/notification-config' });
  }

  const canEnable = checks.every(c => !c.hard || c.ok === true);
  return { canEnable, checks };
}
