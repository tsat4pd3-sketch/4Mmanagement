/* ══════════════════════════════════════════════════════════════════════
   ใบประเมินทักษะความสามารถของพนักงาน (รายบุคคล) — F-PRS-P1-119-0
   ย้ายออกจาก Report.jsx 2026-08-06 เพื่อให้ทั้ง Skill Matrix (/skills-report)
   และ ฐานข้อมูลพนักงาน (/operator) เรียกใบเดียวกันผ่าน SkillRadarPanel
   (เลขฟอร์ม/Rev/ช่องลายเซ็น/โลโก้ อ่านจากทะเบียนเอกสาร /doc-forms เหมือนเดิม)

   โหมด Hybrid: หัวข้อการพิจารณา = master (skill_sub_items),
   ค่าติ๊ก 4 ระดับ derive จากคะแนนสกิลเดิม (0-100)
   ══════════════════════════════════════════════════════════════════════ */
import { docFormSync, fullCode } from '../utils/docForms';
import { skillGaugeSvgStr, scoreToLevel } from '../utils/skillLevels';
import { positionLabel, loadPositions } from '../utils/positions';   // ตำแหน่งเก็บเป็น key — ใบพิมพ์ต้องแปลงเป็นชื่อ

const IND_SIG_DEFAULTS = ['พนักงานผู้ถูกประเมิน', 'ผู้ประเมิน', 'ผู้รับรอง'];
const sigLabelsOf = (key, defaults) => docFormSync(key, { sig_blocks: defaults }).sig_blocks || defaults;

export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));


/* เกณฑ์การให้คะแนน 4 ระดับ (หัวคอลัมน์เฉียง + คำอธิบายท้ายฟอร์ม) — ตรงตามฟอร์มกระดาษ */
const INDIV_CRITERIA = [
  'ผ่านการฝึกอบรมหน้างานจริง (OJT)',
  'สามารถอธิบายขั้นตอนการปฏิบัติงานและเข้าปฏิบัติงานได้',
  'สามารถแก้ไขปัญหาและตัดสินใจหน้างานได้',
  'สามารถสอนงานคนอื่นได้',
];

/* กระจายคะแนนสกิล (0-100) → ระดับ 0-4 ต่อหัวข้อย่อย n ข้อ แบบ deterministic
   ให้ค่าเฉลี่ยของระดับ ≈ score/25 (ทำให้ % กลุ่ม = เฉลี่ยแถว ≈ คะแนนจริง เหมือนฟอร์มกระดาษ) */
function distributeLevels(score, n) {
  const s = Math.max(0, Math.min(100, Number(score) || 0));
  const L = s / 25;                    // 0..4
  const base = Math.floor(L);
  const extra = Math.round((L - base) * n);  // จำนวนหัวข้อที่ได้ +1 ระดับ
  return Array.from({ length: n }, (_, i) => Math.min(4, base + (i < extra ? 1 : 0)));
}

/* โลโก้ Thai Summit — รับ dataURL ที่ resolve แล้ว (doc_forms.logo_url ถ้าอัปโหลด ไม่งั้น
   ไฟล์ทางการ src/assets/TS logo.png) · handler แปลงเป็น dataURL ผ่าน urlToDataUrl ก่อนส่งเข้ามา */
export function tsLogoHtml(logoUrl) {
  const src = logoUrl || '';
  return `
  <div style="display:flex;align-items:center;gap:7px">
    <img src="${src}" alt="Thai Summit" style="height:38px;width:auto;object-fit:contain"/>
    <div style="line-height:1.2">
      <div style="font-size:10px;font-weight:800;color:#7a1f1f;letter-spacing:0.02em">THAI SUMMIT</div>
      <div style="font-size:7px;font-weight:700;color:#333;letter-spacing:0.06em">AUTOMOTIVE CO.,LTD.</div>
    </div>
  </div>`;
}

/* radar SVG (N แกน สเกล 0-100) สำหรับฝังในหน้าพิมพ์ (ไม่มี recharts ในหน้าต่างใหม่) */
export function buildRadarSvg(items, opt = {}) {
  const size = opt.size || 320;
  const cx = size / 2, cy = size / 2;
  const R = size * 0.25;
  const N = items.length;
  if (N < 3) return `<svg width="${size}" height="${size}"></svg>`;
  const ang = i => (-90 + i * 360 / N) * Math.PI / 180;
  const pt = (i, r) => [cx + r * Math.cos(ang(i)), cy + r * Math.sin(ang(i))];
  const fmt = ([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`;
  const clip = s => { const t = String(s || ''); return t.length > 15 ? t.slice(0, 14) + '…' : t; };

  let rings = '';
  [20, 40, 60, 80, 100].forEach(v => {
    const rr = R * v / 100;
    const poly = items.map((_, i) => fmt(pt(i, rr))).join(' ');
    rings += `<polygon points="${poly}" fill="none" stroke="#d1d5db" stroke-width="0.7"/>`;
  });
  rings += `<circle cx="${cx}" cy="${cy}" r="1.5" fill="#9ca3af"/>`;

  let axes = '';
  items.forEach((it, i) => {
    const [x, y] = pt(i, R);
    axes += `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#cbd5e1" stroke-width="0.7"/>`;
    const [lx, ly] = pt(i, R + 12);
    const anchor = Math.abs(lx - cx) < 10 ? 'middle' : (lx > cx ? 'start' : 'end');
    axes += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" font-size="7" fill="#374151" text-anchor="${anchor}" dominant-baseline="middle">${esc(clip(it.label))}</text>`;
  });

  const vpoly = items.map((it, i) => fmt(pt(i, R * Math.max(0, Math.min(100, it.value)) / 100))).join(' ');
  const dots = items.map((it, i) => {
    const [x, y] = pt(i, R * Math.max(0, Math.min(100, it.value)) / 100);
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2" fill="#1d4ed8"/>`;
  }).join('');

  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
    ${rings}${axes}
    <polygon points="${vpoly}" fill="#3b82f6" fill-opacity="0.4" stroke="#1d4ed8" stroke-width="1.4"/>
    ${dots}
  </svg>`;
}

/* สร้าง HTML ใบประเมินรายบุคคล
   emp: { name, employee_id_code, position, department, image_url, employee_skills[] }
   skillDefs: skill_definitions ทั้งหมด · subItemsByskill: { [skill_name]: [{seq,label,wi_ref}] }
   signers: { assessor:{name,pos,sig}, certifier:{name,pos,sig} }
   imgUrl/assesseeSig/assessorSig/certifierSig: dataURL แปลงแล้ว                          */
export function buildIndividualSkillHtml({ emp, skillDefs, subItemsByskill, dept, assessorName, assessorPos, certifierName, certifierPos, imgUrl, assessorSig, certifierSig, logoUrl }) {
  const today = new Date().toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
  const skillMap = Object.fromEntries((emp.employee_skills || []).map(s => [s.skill_name, s.score]));

  // สกิลที่จะแสดง = สกิลที่พนักงานมี record (score กำหนดไว้) เรียงตาม sort_order · fallback = ทุกสกิล
  let skills = skillDefs.filter(s => skillMap[s.name] !== undefined && skillMap[s.name] !== null);
  if (skills.length === 0) skills = skillDefs.slice();

  // ประมวลผลต่อสกิล — ค่าติ๊กรายแถว derive จากคะแนน (โหมด Hybrid),
  // แต่ % สรุป/radar ใช้คะแนนจริงเพื่อความเที่ยงตรง (เหมือนฟอร์มกระดาษที่กลุ่ม = เฉลี่ยหัวข้อจริง)
  const perSkill = skills.map(s => {
    const items = (subItemsByskill[s.name] && subItemsByskill[s.name].length)
      ? subItemsByskill[s.name]
      : [{ seq: 1, label: s.label, wi_ref: null }];
    const score = Number(skillMap[s.name] ?? 0);
    const levels = distributeLevels(score, items.length);
    const groupPct = score;   // คะแนนจริงของสกิล
    return { skill: s, items, levels, groupPct };
  });

  const overall = perSkill.length
    ? Math.round(perSkill.reduce((a, g) => a + g.groupPct, 0) / perSkill.length)
    : 0;

  // ── ตารางประเมินหลัก ──
  const critHeaderCells = INDIV_CRITERIA.map(c =>
    `<th style="border:1px solid #666;background:#f3f4f6;width:26px;padding:0;vertical-align:bottom;height:120px">
       <div style="writing-mode:vertical-rl;transform:rotate(180deg);font-size:8px;white-space:nowrap;margin:0 auto;height:118px;overflow:hidden">${esc(c)}</div>
     </th>`).join('');

  const bodyRows = perSkill.map(g => {
    const n = g.items.length;
    return g.items.map((it, ri) => {
      const lv = g.levels[ri];
      const rowPct = lv * 25;
      const tickCells = INDIV_CRITERIA.map((_, ci) =>
        `<td style="border:1px solid #999;text-align:center;font-size:9px;padding:1px">${ci < lv ? '1' : '0'}</td>`
      ).join('');
      const firstCell = ri === 0
        ? `<td rowspan="${n}" style="border:1px solid #666;padding:2px 4px;font-size:9px;font-weight:700;vertical-align:middle;background:#fafafa">${esc(g.skill.label)}<div style="font-size:7px;color:#777;font-weight:400">(${esc(g.skill.label)})</div></td>`
        : '';
      return `<tr>
        ${firstCell}
        <td style="border:1px solid #999;text-align:center;font-size:9px;width:24px">${ri + 1}</td>
        <td style="border:1px solid #999;padding:1px 4px;font-size:9px">${esc(it.label)}${it.wi_ref ? `<span style="color:#999;font-size:7px;margin-left:4px">${esc(it.wi_ref)}</span>` : ''}</td>
        ${tickCells}
        <td style="border:1px solid #999;text-align:center;font-size:9px;font-weight:700;width:38px">${rowPct}%</td>
        ${ri === 0 ? `<td rowspan="${n}" style="border:1px solid #666"></td>` : ''}
      </tr>`;
    }).join('');
  }).join('');

  // ── สรุปผลการประเมิน (มุมล่างซ้าย) ──
  const summaryRows = perSkill.map(g => `
    <tr>
      <td style="border:1px solid #999;padding:2px 5px;font-size:8.5px">${esc(g.skill.label)}</td>
      <td style="border:1px solid #999;text-align:center;padding:1px;width:34px">${skillGaugeSvgStr(scoreToLevel(g.groupPct >= 100 ? 100 : g.groupPct))}</td>
      <td style="border:1px solid #999;text-align:center;font-size:9px;font-weight:700;width:38px">${g.groupPct}%</td>
    </tr>`).join('');

  // ── radar ──
  const radarSvg = buildRadarSvg(perSkill.map(g => ({ label: g.skill.label, value: g.groupPct })), { size: 300 });

  // ── legend 4 ระดับ (มุมล่างขวา) ──
  const legendPies = [
    { p: '100%', t: 'สามารถสอนงานผู้อื่นได้', lv: 4 },
    { p: '75%',  t: 'สามารถแก้ปัญหาและตัดสินใจในการทำงานได้', lv: 3 },
    { p: '50%',  t: 'ปฏิบัติงานได้โดยไม่ต้องมีผู้แนะนำ', lv: 2 },
    { p: '25%',  t: 'ผ่านการอบรม(OJT)และปฏิบัติงานได้โดยมีผู้แนะนำ', lv: 1 },
  ].map(x => `<div style="display:flex;align-items:center;gap:5px;margin-bottom:2px">
      <span style="flex-shrink:0">${skillGaugeSvgStr(x.lv)}</span>
      <span style="font-size:8px"><b>${x.p}</b> ${esc(x.t)}</span>
    </div>`).join('');

  const criteriaExplain = INDIV_CRITERIA.map(c =>
    `<div style="font-size:7.5px;display:flex;justify-content:space-between;gap:8px;margin-bottom:1px">
       <span>${esc(c)}</span>
       <span style="white-space:nowrap;color:#444">"ผ่าน"=1 &nbsp; "ไม่ผ่าน"=0</span>
     </div>`).join('');

  const signBox = (title, name, pos, sig, showPhoto) => `
    <td style="border:1px solid #666;padding:5px 6px;vertical-align:top;width:${showPhoto ? '34%' : '33%'}">
      <div style="font-size:9px;font-weight:700;text-align:center;margin-bottom:3px">${esc(title)}</div>
      ${showPhoto ? `<div style="text-align:center;margin-bottom:3px">${imgUrl ? `<img src="${imgUrl}" style="width:52px;height:64px;object-fit:cover;border:1px solid #ccc"/>` : `<div style="width:52px;height:64px;border:1px solid #ccc;margin:0 auto;display:flex;align-items:center;justify-content:center;font-size:7px;color:#aaa">รูปพนักงาน</div>`}</div>` : ''}
      <div style="height:26px;text-align:center">${sig ? `<img src="${sig}" style="max-height:26px;max-width:90px;object-fit:contain"/>` : ''}</div>
      <div style="text-align:center;font-size:8.5px;border-top:1px dotted #999;padding-top:1px">(${esc(name || '.....................')})</div>
      <div style="text-align:center;font-size:7.5px;color:#555">ตำแหน่ง : ${esc(pos || '-')}</div>
      <div style="text-align:center;font-size:7.5px;color:#555">วันที่ : ${today}</div>
    </td>`;

  return `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"/>
<title>ใบประเมินทักษะ - ${esc(emp.name || '')}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700;800&display=swap');
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Sarabun',sans-serif;font-size:9px;color:#000;background:#fff;width:200mm;margin:0 auto}
  .page{padding:0}table{border-collapse:collapse}
  #fit{transform-origin:top left}
  @media print{@page{size:A4 portrait;margin:5mm}body{-webkit-print-color-adjust:exact;print-color-adjust:exact;width:auto}}
</style></head><body><div class="page"><div id="fit">
  <!-- header -->
  <table style="width:100%;margin-bottom:4px"><tr>
    <td style="width:24%;vertical-align:middle">${tsLogoHtml(logoUrl)}</td>
    <td style="text-align:center;vertical-align:middle">
      <div style="font-size:13px;font-weight:800">ใบประเมินทักษะความสามารถของพนักงานแผนก ${esc(dept || '-')}</div>
    </td>
    <td style="width:16%;text-align:right;vertical-align:middle"><div style="font-size:11px;font-weight:800;color:#1d4ed8">Multi Skill</div></td>
  </tr></table>

  <!-- assessee / assessor / certifier + radar -->
  <table style="width:100%;margin-bottom:5px"><tr>
    <td style="width:62%;vertical-align:top;padding-right:6px">
      <table style="width:100%"><tr>
        ${signBox(sigLabelsOf('individual_skill', IND_SIG_DEFAULTS)[0], emp.name, positionLabel(emp.position), null, true)}
        ${signBox(sigLabelsOf('individual_skill', IND_SIG_DEFAULTS)[1], assessorName, assessorPos, assessorSig, false)}
        ${signBox(sigLabelsOf('individual_skill', IND_SIG_DEFAULTS)[2], certifierName, certifierPos, certifierSig, false)}
      </tr></table>
      <div style="font-size:8px;color:#555;margin-top:3px">เลขที่บัตร : <b>${esc(emp.employee_id_code || '-')}</b> &nbsp;·&nbsp; ตำแหน่ง : <b>${esc(positionLabel(emp.position) || '-')}</b></div>
    </td>
    <td style="width:38%;vertical-align:top;text-align:center;border:1px solid #ccc;padding:2px">
      <div style="font-size:8px;font-weight:700;color:#1d4ed8">Multi Skill</div>
      ${radarSvg}
    </td>
  </tr></table>

  <!-- main assessment table -->
  <table style="width:100%"><thead>
    <tr style="background:#e5e7eb">
      <th style="border:1px solid #666;padding:2px;font-size:9px;width:14%">หัวข้อ</th>
      <th style="border:1px solid #666;padding:2px;font-size:9px;width:22px">ลำดับ</th>
      <th style="border:1px solid #666;padding:2px;font-size:9px">หัวข้อการพิจารณา</th>
      ${critHeaderCells}
      <th style="border:1px solid #666;padding:2px;font-size:8px;width:38px">สรุปผลการประเมิน</th>
      <th style="border:1px solid #666;padding:2px;font-size:8px;width:18%">ความคิดเห็นเพิ่มเติม</th>
    </tr>
  </thead><tbody>${bodyRows}</tbody></table>

  <!-- summary + legend -->
  <table style="width:100%;margin-top:6px"><tr>
    <td style="width:38%;vertical-align:top;padding-right:8px">
      <div style="font-size:9px;font-weight:700;margin-bottom:2px">สรุปผลการประเมิน</div>
      <table style="width:100%">
        ${summaryRows}
        <tr style="background:#dbeafe;font-weight:800">
          <td style="border:1px solid #666;padding:2px 5px;font-size:8.5px">ทักษะการทำงานโดยรวม</td>
          <td style="border:1px solid #666;text-align:center;padding:1px">${skillGaugeSvgStr(scoreToLevel(overall >= 100 ? 100 : overall))}</td>
          <td style="border:1px solid #666;text-align:center;font-size:9px">${overall}%</td>
        </tr>
      </table>
    </td>
    <td style="vertical-align:top">
      <div style="font-size:8.5px;font-weight:700;margin-bottom:2px">คำอธิบาย : ระดับทักษะความสามารถการปฏิบัติงานของพนักงาน</div>
      ${legendPies}
      <div style="font-size:8px;font-weight:700;margin:4px 0 2px">เกณฑ์การให้คะแนนของผู้ประเมิน</div>
      ${criteriaExplain}
      <div style="font-size:7.5px;color:#444;margin-top:4px">
        <div>หมายเหตุ : 1) พนักงานใหม่ ต้องมีประสบการณ์งานประกอบอย่างน้อย 3 เดือนขึ้นไป ถึงจะขอทดสอบทักษะได้</div>
        <div style="padding-left:44px">2) พนักงานเก่า ต้องผ่านการฝึกเข้าปฏิบัติงานในหน้างานอย่างน้อย 1 เดือน ถึงจะขอทดสอบปรับระดับทักษะได้</div>
      </div>
    </td>
  </tr></table>
  <div style="text-align:right;font-size:8px;color:#666;margin-top:3px">${fullCode(docFormSync('individual_skill', { form_code: 'F-PRS-P1-119-0' }))}${docFormSync('individual_skill', {}).effective_date ? ' · Effective Date : ' + docFormSync('individual_skill', {}).effective_date : ''}</div>
</div></div>
<script>
  function fitOnePage() {
    try {
      // ย่อ #fit ให้พอดี A4 1 หน้า (สูง 297-2*5 = 287mm) เสมอ — พนักงานสกิลเยอะก็ไม่เกินแผ่น
      // ใช้ zoom (ไม่ใช่ transform) เพราะ zoom ลดกล่อง layout จริง → print นับหน้าถูก (transform เป็นภาพลวงตา ไม่ลดหน้า)
      var probe = document.createElement('div');
      probe.style.cssText = 'height:100mm;position:absolute;visibility:hidden;top:0';
      document.body.appendChild(probe);
      var pxPerMm = probe.getBoundingClientRect().height / 100;
      document.body.removeChild(probe);
      var avail = 287 * pxPerMm;
      var el = document.getElementById('fit');
      var h = el.getBoundingClientRect().height;
      if (h > avail) { el.style.zoom = (avail / h); }
    } catch (e) {}
    window.print();
  }
  window.onload = function () {
    if (document.fonts && document.fonts.ready) { document.fonts.ready.then(fitOnePage); }
    else { fitOnePage(); }
  };
</script></body></html>`;
}
