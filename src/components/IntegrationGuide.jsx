/* 📘 คู่มือ (WI) การเชื่อมต่อ Node-RED / เครื่องจักร — /integrations?tab=guide (2026-11-23 · คำสั่ง user "ทำ WI ตามโครงนี้เลย")
   ขั้นตอนตั้งแต่สร้างต้นทาง → import flow → ตรวจสุขภาพ → ผูก topic/เครื่อง → ปัญหาที่เจอบ่อย
   🔴 เนื้อหาต้องตรงพฤติกรรมจริงของระบบ — แก้ flow/edge/หน้าต้นทางแล้วต้องตามมาแก้ไฟล์นี้ด้วย
      (ชื่อ env = envVarName() ใน utils/nodeRedFlow.js · เกณฑ์ขาดการติดต่อ = SOURCE_STALE_MIN · กฎรหัส = edge integration-admin)
   · ไฟล์นี้แสดงอย่างเดียว ไม่เขียน DB · ไม่ใช่เอกสาร export (ไม่ต้องลง /doc-forms จนกว่าจะมีปุ่มพิมพ์) */
import { SOURCE_STALE_MIN } from '../utils/integrationKinds';
import { tr } from '../utils/i18n';

const card = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 16, boxShadow: 'var(--shadow-sm)', minWidth: 0 };
const code = { fontFamily: 'ui-monospace, monospace', background: 'var(--bg2)', borderRadius: 4, padding: '1px 6px', fontSize: 12.5 };

/* ขั้นตอน — `tip` = ข้อควรระวัง (สีเหลือง) · `who` = ใครทำ */
const STEPS = [
  {
    title: 'สร้างต้นทาง (1 Node-RED / 1 ระบบ = 1 ต้นทาง)', who: 'ผู้ดูแลระบบ ESM (สิทธิ์ integration:manage)',
    lines: [
      'แท็บ "แหล่งต้นทาง" → กด "+ เพิ่มการเชื่อมต่อ"',
      'ใส่รหัสต้นทาง (a-z 0-9 - _ ยาว 2–40 ตัว เช่น hdf) · ชื่อที่แสดง · หมายเหตุ (IP · PLC · ฐานข้อมูล)',
      'เลือกชนิดข้อมูลที่ต้นทางนี้ส่ง (ค่าไฟรายนาที · เหตุการณ์ · ยอดรายวัน · ช่วงหยุดเครื่อง · ชิ้นงาน · สถานะสด)',
    ],
    tip: 'รหัสต้นทางเปลี่ยนภายหลังไม่ได้ — อยู่ในชื่อ topic ของมิเตอร์ (เช่น hdf/MDB-07/kw) · ชื่อที่แสดงกับหมายเหตุแก้ได้ด้วยปุ่ม "✏️ แก้ชื่อ / หมายเหตุ"',
  },
  {
    title: 'เก็บรหัสลับของต้นทาง', who: 'ผู้ดูแลระบบ ESM',
    lines: [
      'หลังกดสร้าง ระบบโชว์รหัสลับ (ขึ้นต้น esm_) ให้เห็นครั้งเดียว — คัดลอกส่งให้คนดูแล Node-RED ทันที',
      'ระบบเก็บแค่ค่าแฮช ดูรหัสเดิมซ้ำไม่ได้ · ทำหายให้กด "🔑 เปลี่ยนรหัสลับ" ในหน้าต้นทาง',
    ],
    tip: 'เปลี่ยนรหัสลับแล้ว รหัสเดิมใช้ไม่ได้ทันที — Node-RED จะส่งไม่เข้าจนกว่าจะตั้งรหัสใหม่ · ห้ามส่งรหัสลงกลุ่มแชท/อีเมลที่คนนอกเห็น',
  },
  {
    title: 'ดาวน์โหลด flow แล้ว import เข้า Node-RED', who: 'คนดูแล Node-RED หน้างาน',
    lines: [
      'หน้าต้นทาง → "⬇ ดาวน์โหลด flow" (หรือ "📋 คัดลอก flow")',
      'Node-RED เมนู ☰ → Import → เลือกไฟล์ / วาง → Import',
      'flow ของ ESM เป็นกลุ่มแยก ไม่ทับ flow เดิม · อ่าน MySQL อย่างเดียว (SELECT) ไม่เขียนกลับฐานของหน้างาน',
    ],
    tip: 'import ทับของเดิมได้เมื่อ ESM ปรับ flow (เช่น เพิ่มค่ารายเฟส / แก้ชื่อ Alarm) — ลบกลุ่ม flow ESM เก่าออกก่อน กันส่งซ้ำ',
  },
  {
    title: 'ตั้งรหัสลับ + เลือกฐานข้อมูล แล้ว Deploy', who: 'คนดูแล Node-RED หน้างาน',
    lines: [
      'ตั้ง environment variable ของ Node-RED ชื่อ ESM_SOURCE_KEY = รหัสลับจากขั้นที่ 2 (ต้นทางเก่าที่ยังใช้รหัสกลางจะเป็น INGEST_SECRET — หน้าต้นทางบอกชื่อที่ต้องใช้)',
      'เปิดโหนด mysql ทุกตัวในกลุ่ม ESM → เลือกฐานของเครื่องนี้ (เช่น db_user02 / db_user04)',
      'กด Deploy',
    ],
    tip: 'ห้ามพิมพ์รหัสลับลงในโหนด function ตรงๆ — flow ต้องอ่านจาก env (env.get) เท่านั้น จะได้ส่งไฟล์ flow ต่อได้โดยไม่หลุดรหัส',
  },
  {
    title: 'ตรวจสุขภาพการส่ง', who: 'ผู้ดูแลระบบ ESM',
    lines: [
      'หน้าต้นทาง → แถบ "สุขภาพการส่ง · 24 ชม." 1 แท่ง = 1 ชั่วโมง: เขียวเต็ม = ได้ครบทุกนาที · ส้ม = ขาดบางนาที · แดง = มีครั้งที่ล้ม · เทา = ไม่ได้รับเลย',
      `ป้าย "● ออนไลน์" = มีค่าใหม่ภายใน ${SOURCE_STALE_MIN} นาที`,
      'ช่อง "คำตอบล่าสุด" ดู unmapped — มากกว่า 0 = มี topic ที่ยังไม่ได้ผูก (ทำขั้นที่ 6)',
    ],
  },
  {
    title: 'ผูกข้อมูลเข้ากับของในระบบ', who: 'ผู้ดูแลระบบ ESM / ผู้รับผิดชอบพลังงาน · เครื่องจักร',
    groups: [
      { head: '⚡ ค่าไฟ', lines: [
        'หน้าต้นทาง → กล่อง "topic ที่ระบบได้รับ แต่ยังไม่ได้ผูกกับจุดวัด" → กด "ผูก" แล้วเลือกจุดวัด (ไลน์/โซน) + ค่าที่อ่าน (kW · kWh สะสม · V · A)',
        'ค่ารายเฟส (v1-v3 · a1-a3) ไม่ต้องผูกเอง — เข้าตู้เดียวกันอัตโนมัติเมื่อ topic อื่นของตู้นั้นผูกแล้ว',
        'จะให้ตู้ขึ้น "บอร์ดค่าไฟสด" + ผังจ่ายไฟหลายชั้น ต้องลงทะเบียนตู้และตู้แม่ — ตอนนี้ยังไม่มีหน้าจอ แจ้งผู้ดูแลระบบ ESM',
      ] },
      { head: '🏭 เครื่องจักร (OEE รายจิ๊ก)', lines: [
        'หน้าต้นทาง → แผง "ข้อมูลจากเครื่อง" → ผูกรหัสเครื่องของต้นทาง (tag) กับเครื่องในทะเบียน ESM',
        'ผูกเหตุผลหยุด (หยุดตามแผน · หยุดนอกแผน · Alarm) กับประเภท downtime ของ ESM — Alarm ใช้รหัส AlarmMaster จาก PLC · หยุดนอกแผนใช้ UnplanMaster ที่พนักงานกดจาก HMI',
        'ใบผลิตต้องเลือกเครื่อง/จิ๊กให้ตรง — OEE รายจิ๊กหา CT จากพาร์ทในใบที่อยู่บนจิ๊กนั้น',
      ] },
    ],
    tip: 'ระบบเสนอได้ แต่คนต้องกดยืนยันเอง — ESM ไม่ผูกเหตุผล/เครื่องให้อัตโนมัติ กันข้อมูลผิดเงียบๆ',
  },
];

const FAQ = [
  ['ป้ายขึ้น "ขาดการติดต่อ" / แถบเทา', 'Node-RED หยุดหรือ Deploy ไม่ผ่าน · รหัสลับไม่ตรง (ESM ไม่รู้ว่าใครส่ง แถบจึงเทา — ดูโหนด debug ใน Node-RED จะขึ้น 401) · ต้นทางถูกพักการรับ (debug ขึ้น 423 — กด "▶ เปิดรับต่อ")'],
  ['topic ค้างในกล่อง "ยังไม่ได้ผูก"', 'ESM ไม่สร้างจุดวัดเองจาก topic แปลกหน้า (กันข้อมูลขยะ) — ผูกตามขั้นที่ 6'],
  ['ชื่อ Alarm ใน ESM ไม่ตรงกับหน้าเครื่อง', 'ใช้ flow รุ่นเก่าที่แปลรหัส FAULT ด้วย UnplanMaster — import flow ชุดใหม่จากหน้าต้นทาง'],
  ['แผง "ไฟฟ้าแยก 3 เฟส" ว่าง', 'flow ค่าไฟรุ่นเก่ายังไม่ส่งค่ารายเฟส — import flow ชุดใหม่'],
  ['เวลาในเครื่อง (PLC) คลาดจากนาฬิกาจริง 3–5 นาที', 'ไม่ต้องแก้ — ESM ยึดระยะเวลาของแต่ละช่วงหยุด และเผื่อ ±10 นาทีตอนเทียบกับ downtime ที่คนลง'],
  ['OEE รายจิ๊ก %P ติด 100% พร้อมเตือนแดง', 'CT ในทะเบียนพาร์ทยาวกว่าที่จิ๊กทำได้จริง — ให้ PE แก้ CT ที่ทะเบียนพาร์ท'],
  ['ตัวเลขไม่ตรงกับจอของ Node-RED', 'ESM เป็นเจ้าของสูตร (เวลาพักตามนโยบาย · CT จากใบผลิต · Q จาก QA) — ต่างกันได้ตามนิยาม ดูเหตุผลในหน้าดูลึกของจิ๊ก'],
];

export default function IntegrationGuide() {
  return (
    <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
      <div style={{ ...card, display: 'grid', gap: 6 }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>📘 {tr('คู่มือการเชื่อมต่อ (WI)')}</div>
        <div style={{ fontSize: 13, color: 'var(--text2)' }}>
          {tr('หลักการ: ต้นทาง (Node-RED / PLC) ส่ง "ข้อเท็จจริง" อย่างเดียว · สูตร OEE / ค่าไฟ / การตัดสินอยู่ที่ ESM · คน = เหตุผล (ทำไมหยุด / ของเสีย)')}
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{tr('ใช้กับต้นทางใหม่ทุกตัว และตอนเปลี่ยนเครื่อง / ย้าย Node-RED')}</div>
      </div>

      {STEPS.map((s, i) => (
        <div key={tr(s.title)} style={{ ...card, display: 'grid', gridTemplateColumns: '44px minmax(0, 1fr)', gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 999, background: 'var(--accent)', color: 'var(--bg)', display: 'grid', placeItems: 'center', fontSize: 17, fontWeight: 800 }}>{i + 1}</div>
          <div style={{ display: 'grid', gap: 6, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>{tr(s.title)}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>{tr('ผู้ทำ:')} {tr(s.who)}</div>
            {tr(s.lines) && <ul style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 4, fontSize: 13, color: 'var(--text2)' }}>{s.lines.map(l => <li key={l}>{tr(l)}</li>)}</ul>}
            {s.groups && s.groups.map(g => (
              <div key={tr(g.head)} style={{ display: 'grid', gap: 4 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)' }}>{tr(g.head)}</div>
                <ul style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 4, fontSize: 13, color: 'var(--text2)' }}>{g.lines.map(l => <li key={l}>{tr(l)}</li>)}</ul>
              </div>
            ))}
            {tr(s.tip) && <div style={{ fontSize: 12.5, color: 'var(--text2)', borderLeft: '3px solid var(--amber)', background: 'var(--bg2)', borderRadius: 4, padding: '6px 10px' }}>⚠️ {tr(s.tip)}</div>}
          </div>
        </div>
      ))}

      <div style={{ ...card, display: 'grid', gap: 8 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>🛠 {tr('ปัญหาที่เจอบ่อย')}</div>
        {FAQ.map(([q, a]) => (
          <div key={q} style={{ display: 'grid', gap: 2, padding: '8px 10px', background: 'var(--bg2)', borderRadius: 6 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{tr(q)}</div>
            <div style={{ fontSize: 12.5, color: 'var(--text2)' }}>{tr(a)}</div>
          </div>
        ))}
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          {tr('ตัวอย่างชื่อ topic:')} <span style={code}>hdf/MDB-07/kw</span> · <span style={code}>dieshop/DB-CNC/kwh_total</span> · {tr('รูปแบบ')} <span style={code}>{tr("<รหัสต้นทาง>/<ตู้>/<ค่า>")}</span>
        </div>
      </div>
    </div>
  );
}
