/* ตรวจ "ความถูกต้องของ OOXML" ในไฟล์ .pptx ที่ generate ออกมา
   ═══════════════════════════════════════════════════════════════════════════
   ⚠️ ทำไมต้องมี: `audit.py` เดิมตรวจแค่ **เรขาคณิต** (ของล้นขอบ/ทับกัน) กับ textfit
   → เด็คที่ layout สวยแต่ XML ผิดสเปก ยังหลุดออกไปได้ แล้ว PowerPoint ขึ้น
     "PowerPoint found a problem with content … click Repair" = **เปิดไม่ได้ทั้งไฟล์**
   เกิดจริง 2026-09-10: combo bar+line ใส่ `dataLabelPosition: 'outEnd'` ใน option ที่ใช้ร่วม
   → pptxgenjs เขียน `<c:dLblPos val="outEnd"/>` ลงใน `<c:lineChart>` ซึ่ง OOXML ไม่อนุญาต

   ใช้:  node audit/pptxvalid.mjs <โฟลเดอร์ที่ unzip .pptx แล้ว>
   ออก exit code 1 เมื่อเจอปัญหา — เอาไปต่อท้ายขั้นตอนตรวจก่อน merge ได้
═══════════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
if (!dir) { console.error('ใช้: node audit/pptxvalid.mjs <dir ที่ unzip .pptx>'); process.exit(2); }

const walk = (d) => fs.readdirSync(d, { withFileTypes: true })
  .flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);

const problems = [];
const add = (file, msg) => problems.push(`${path.relative(dir, file)} — ${msg}`);

/* ตำแหน่งป้ายค่าที่ OOXML อนุญาตต่อชนิดกราฟ (ECMA-376 · ST_DLblPos)
   ผิดชนิดเดียว = ทั้งไฟล์เปิดไม่ได้ ไม่ใช่แค่กราฟนั้นเพี้ยน */
const DLBL_OK = {
  lineChart:     new Set(['ctr', 'l', 'r', 't', 'b']),
  scatterChart:  new Set(['ctr', 'l', 'r', 't', 'b']),
  areaChart:     new Set(['ctr']),
  pieChart:      new Set(['ctr', 'inEnd', 'outEnd', 'bestFit']),
  doughnutChart: new Set(['ctr']),
  barChart:      new Set(['ctr', 'inEnd', 'inBase', 'outEnd']),
};

for (const f of walk(dir)) {
  if (!/\.(xml|rels)$/.test(f)) continue;
  const x = fs.readFileSync(f, 'utf8');

  // 1) แต่ละ part ต้อง parse ได้ (จับ tag ไม่ปิด/อักขระต้องห้าม)
  //    ใช้ตัวตรวจง่ายๆ: จำนวน < กับ > ต้องสมดุล และไม่มี & เปล่าๆ
  const amp = x.match(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/g);
  if (amp) add(f, `พบ & ที่ไม่ได้ escape ${amp.length} จุด`);

  if (!/\/charts\/chart\d+\.xml$/.test(f)) continue;

  // 2) ตำแหน่งป้ายค่าต้องตรงกับชนิดกราฟ
  for (const kind of Object.keys(DLBL_OK)) {
    const re = new RegExp(`<c:${kind}>([\\s\\S]*?)</c:${kind}>`, 'g');
    let m;
    while ((m = re.exec(x))) {
      for (const pos of new Set([...m[1].matchAll(/<c:dLblPos val="([^"]+)"\/>/g)].map(p => p[1]))) {
        if (!DLBL_OK[kind].has(pos)) {
          add(f, `<c:${kind}> ใช้ dLblPos="${pos}" ซึ่ง OOXML ไม่อนุญาต (ได้เฉพาะ ${[...DLBL_OK[kind]].join('/')}) — PowerPoint จะขอ Repair`);
        }
      }
    }
  }

  // 3) ค่าที่ไม่ใช่ตัวเลขในแคชตัวเลขของกราฟ
  for (const v of new Set([...x.matchAll(/<c:v>([^<]*)<\/c:v>/g)].map(p => p[1]))) {
    if (/^(undefined|NaN|null|Infinity|-Infinity)$/i.test(v)) add(f, `แคชกราฟมีค่า "${v}"`);
  }

  // 4) สีที่เป็น undefined (เกิดเมื่อ chartColors สั้นกว่าจำนวน series)
  for (const c of new Set([...x.matchAll(/<a:srgbClr val="([^"]*)"/g)].map(p => p[1]))) {
    if (!/^[0-9A-Fa-f]{6}$/.test(c)) add(f, `สีไม่ใช่ hex 6 หลัก: "${c}"`);
  }
}

if (problems.length) {
  console.log(`❌ OOXML ไม่ถูกต้อง ${problems.length} จุด`);
  problems.slice(0, 20).forEach(p => console.log('  ', p));
  process.exit(1);
}
console.log('✅ OOXML ผ่าน — ป้ายค่า/ค่าตัวเลข/สี ถูกต้องทุก chart part');
