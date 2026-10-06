/* ══ 🔗 ผูกบอร์ด New Model (/nm-board) เข้ากับโปรเจค NPI (/npi) — 2026-10-06 · คำสั่ง user ══
   *"หลักๆ 2 หน้านี้ต้อง link กัน"*

   2 หน้านี้พูดถึง**ของชิ้นเดียวกัน** คือ "รุ่นใหม่ 1 รุ่น" แต่มองคนละมุม:
   - `/nm-board` = **บอร์ดผนังของ IEC** — 21 แผง · EVA สี · ใช้ยืนประชุมหน้าบอร์ด (คนตั้งสีเอง)
   - `/npi`      = **ทะเบียนของจริง** — พาร์ท · เฟส APQP/SPTT · เอกสาร PPAP · ECI · แผน tooling (มี workflow)

   🔴 **ห้ามยุบเป็นหน้าเดียว** — บอร์ดคือ "ภาพที่คนตัดสินใจร่วมกัน" (สีมาจากคน · กฎ IEC ข้อ 1)
      ส่วน NPI คือ "หลักฐาน" (สถานะมาจากเอกสารจริง) · ยุบรวม = สีบอร์ดจะถูกระบบเขียนทับ ผิดกติกา IEC
   ⇒ ผูกกันด้วย **ตัวชี้ + ตัวเลขจริงที่ยกมาโชว์** ไม่ใช่ copy ข้อมูลข้ามกัน

   🔴 **ทิศทางเดียว: NPI เป็นเจ้าของการผูก** (`npi_projects.nm_board_id`)
      บอร์ดเป็นข้อมูลในโค้ด (เฟสถอดจากบอร์ดกระดาษ) ⇒ ถ้าให้บอร์ดถือตัวชี้ ต้องแก้โค้ดทุกครั้งที่ผูกใหม่
   🔴 **ไม่เดาการผูกจากชื่อ/ลูกค้า** — `model` ซ้ำกันได้ (หลายรุ่นย่อยของ platform เดียว) เดาผิด = บอร์ด
      โชว์ตัวเลขของรุ่นอื่น ซึ่ง**แย่กว่าไม่โชว์เลย** · ยังไม่ผูก = เขียนบนจอว่ายังไม่ผูก (กฎความซื่อสัตย์ของจอ)
   ═══════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * แผงบนบอร์ด → หน้า/แท็บใน NPI ที่ถือ "ของจริง" ของเรื่องนั้น
 * 🔴 ใส่เฉพาะแผงที่ NPI เป็นเจ้าของข้อมูลนั้นจริงๆ — แผงที่ NPI ไม่มีของให้ดู **ห้ามใส่**
 *    (ลิงก์ที่กดไปแล้วไม่เจออะไร ทำให้คนเลิกเชื่อลิงก์ทั้งจอ)
 */
export const PANEL_NPI_MAP = {
  'tooling-schedule': { tab: 'tooling',   label: 'แผน tooling',        what: 'ขั้นงานทำแม่พิมพ์/จิ๊ก + แผน/จริง (Gantt)' },
  'eci-control':      { tab: 'drawings',  label: 'ECI + rev แบบ',      what: 'ทะเบียน ECI และ revision แบบ 2D/3D/spec' },
  'ppc-ecn':          { tab: 'drawings',  label: 'ECI + rev แบบ',      what: 'การเปลี่ยนแบบ/กระบวนการที่ออกเป็นใบ ECI' },
  'part-overview':    { tab: 'parts',     label: 'พาร์ท & PPAP',       what: 'รายการพาร์ท · ระดับ PPAP · สถานะ PSW' },
  'pop':              { tab: 'parts',     label: 'พาร์ท & PPAP',       what: 'เอกสารส่งมอบรายเฟส (= ทะเบียน PPAP/SPTT)' },
  'sptt':             { tab: 'parts',     label: 'พาร์ท & PPAP',       what: 'เอกสารตามด่าน SPTT ของพาร์ทแต่ละตัว' },
  'master-schedule':  { tab: 'board',     label: 'บอร์ด NPI',          what: 'เฟส APQP/SPTT ของทุกพาร์ท + นับถอยหลัง SOP' },
  'eva-milestone':    { tab: 'board',     label: 'บอร์ด NPI',          what: 'ตารางพาร์ท × เฟส เป็นไฟสีตามเอกสารจริง' },
  'kadai':            { tab: 'tasks',     label: 'งานที่มอบหมาย',      what: 'งานค้างที่ผูกพาร์ท/เฟส/รายการเอกสาร' },
};

/** ลิงก์ของแผงนี้ (ถ้ามี) — ไม่มี = `null` ห้ามคืน object เปล่าให้จอวาดปุ่มตาย */
export function npiLinkFor(panelKey, projectId) {
  const m = PANEL_NPI_MAP[panelKey];
  if (!m || !projectId) return null;
  return { ...m, href: `/npi?project=${encodeURIComponent(projectId)}&tab=${m.tab}` };
}

/** จำนวนแผงบนบอร์ดที่มีของจริงใน NPI ให้ดู — ใช้บอกคนว่า "ผูกแล้วได้อะไรเพิ่ม" */
export const linkedPanelCount = (panels) =>
  (panels || []).filter(p => PANEL_NPI_MAP[p?.key]).length;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

/** วันที่เหลือถึง SOP — อดีต = ติดลบ (เลยกำหนดแล้ว) · ไม่มีวัน = `null` ห้ามคืน 0 */
export function daysToSop(sopDate, now = new Date()) {
  if (!sopDate) return null;
  const d = new Date(`${sopDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const a = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((d - a) / 86400000);
}

/**
 * ย่อโปรเจค NPI ให้เหลือตัวเลขที่บอร์ดเอาไปโชว์ได้
 * 🔴 ทุกค่าที่ "ยังไม่รู้" คืน `null` ไม่ใช่ 0 — 0 แปลว่า "นับแล้วได้ศูนย์" ซึ่งคนละเรื่องกับ "ไม่มีข้อมูล"
 *    (กฎความซื่อสัตย์ของจอ · เดียวกับ /obeya)
 * @param {{project?:object, parts?:Array, deliverables?:Array, ecis?:Array, now?:Date}} input
 */
export function summarizeNpi({ project, parts, deliverables, ecis, now = new Date() } = {}) {
  if (!project) return null;
  const partList = Array.isArray(parts) ? parts : null;
  const docList = Array.isArray(deliverables) ? deliverables : null;
  const eciList = Array.isArray(ecis) ? ecis : null;

  const docTotal = docList ? docList.length : null;
  const docDone = docList ? docList.filter(d => d.status === 'approved' || d.status === 'done').length : null;

  return {
    projectId: project.id,
    code: project.project_code || null,
    name: project.name || null,
    customer: project.customer || null,
    model: project.model || null,
    status: project.status || null,
    leader: project.leader_name || null,
    sopDate: project.sop_date || null,
    sopIn: daysToSop(project.sop_date, now),
    parts: partList ? partList.length : null,
    /* PPAP ผ่านแล้วกี่พาร์ท — พาร์ทที่ยังไม่ตั้งสถานะไม่นับเป็น "ไม่ผ่าน" แค่ยังไม่ถึง */
    ppapApproved: partList ? partList.filter(p => p.ppap_status === 'approved').length : null,
    docTotal,
    docDone,
    docPct: docTotal ? Math.round((docDone / docTotal) * 100) : null,   // 0 รายการ = null ไม่ใช่ 0%
    /* ECI ที่ยัง "ไม่จบ" — implemented/rejected ถือว่าจบแล้ว */
    eciOpen: eciList ? eciList.filter(c => !['implemented', 'rejected'].includes(c.status)).length : null,
    eciTotal: eciList ? eciList.length : null,
  };
}

/**
 * ตัวเลือกให้คนกดผูกใน /npi — คืนรายการรุ่นบนบอร์ด (ไม่มีการเดา)
 * `hint` = เหตุผลที่น่าจะใช่ ใช้ **เรียงขึ้นก่อน** เท่านั้น ห้ามเลือกให้อัตโนมัติ
 */
export function boardOptions(boardProjects, { customer, model } = {}) {
  const c = String(customer || '').trim().toLowerCase();
  const m = String(model || '').trim().toLowerCase();
  return (boardProjects || []).filter(Boolean).map(p => {
    const sameCust = !!c && String(p.customer || '').toLowerCase() === c;
    const sameModel = !!m && String(p.title || '').toLowerCase().includes(m);
    return {
      id: p.id,
      label: `${p.title}${p.customer ? ` · ${String(p.customer).toUpperCase()}` : ''}`,
      hint: sameCust && sameModel ? 'ลูกค้าและชื่อรุ่นตรงกัน' : sameCust ? 'ลูกค้าเดียวกัน' : null,
      rank: (sameCust ? 1 : 0) + (sameModel ? 2 : 0),
    };
  }).sort((a, b) => b.rank - a.rank || a.label.localeCompare(b.label, 'th'));
}
