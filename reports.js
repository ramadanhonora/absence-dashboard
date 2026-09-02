// ══════════════════════════════════════════════════════
// ── PDF EXPORT ENGINE ─────────────────────────────────
// Snapshots a fully-rendered (correct Kurdish/Arabic) HTML block and
// saves it as a paginated PDF. Text is captured as an image, not
// selectable — this is what makes reliable Kurdish/Arabic rendering
// possible without a font-shaping library.
// Depends on globals defined in absentapi.html: LANGS, currentLang,
// allData, mgmtData, classes, weeks, months, getSeverity, getBadge,
// showToast, normalizeDate, formatDate, getAcademicYear.
// ══════════════════════════════════════════════════════

async function renderHtmlToPDF(contentHTML, filename) {
  const { jsPDF } = window.jspdf;

  const holder = document.createElement('div');
  holder.style.position = 'fixed';
  holder.style.top = '0';
  holder.style.left = '-99999px';
  holder.style.width = '794px'; // A4 width @ 96dpi
  holder.style.background = '#ffffff';
  holder.innerHTML = contentHTML;
  document.body.appendChild(holder);

  try {
    const canvas = await html2canvas(holder, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff'
    });

    const pdf = new jsPDF('p', 'pt', 'a4');
    const pageWidth  = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const ratio = pageWidth / canvas.width;
    const pageHeightInCanvasPx = pageHeight / ratio;

    let y = 0, first = true;
    while (y < canvas.height) {
      const sliceH = Math.min(pageHeightInCanvasPx, canvas.height - y);
      const sliceCanvas = document.createElement('canvas');
      sliceCanvas.width  = canvas.width;
      sliceCanvas.height = sliceH;
      const ctx = sliceCanvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
      ctx.drawImage(canvas, 0, y, canvas.width, sliceH, 0, 0, canvas.width, sliceH);

      const imgData = sliceCanvas.toDataURL('image/jpeg', 0.95);
      if (!first) pdf.addPage();
      pdf.addImage(imgData, 'JPEG', 0, 0, pageWidth, sliceH * ratio);
      first = false;
      y += sliceH;
    }

    pdf.save(filename);
  } finally {
    document.body.removeChild(holder);
  }
}

// ── Shared HTML builders ──────────────────────────────
function buildReportHeaderHTML(title, subtitle) {
  const L = LANGS[currentLang];
  return `
    <div dir="${L.dir}" lang="${L.htmlLang}" style="font-family:'Segoe UI',Tahoma,Arial,sans-serif;padding:24px;color:#222;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;border-bottom:3px solid #667eea;padding-bottom:14px;margin-bottom:18px;">
        <img src="aci.jpg" style="width:56px;height:56px;object-fit:contain;flex-shrink:0;">
        <div style="text-align:center;flex:1;">
          <div style="font-size:18px;font-weight:700;color:#333;">${L.dInstName}</div>
          <div style="font-size:13px;color:#667eea;font-weight:600;">${(L.academicYearLabel||'Academic Year')+': '+getAcademicYear()}</div>
        </div>
        <img src="new-left-logo.jpg" style="width:56px;height:56px;object-fit:contain;flex-shrink:0;">
      </div>
      <h2 style="color:#667eea;margin:0 0 4px;font-size:20px;">${title}</h2>
      ${subtitle ? `<p style="color:#666;margin:0 0 16px;font-size:13px;">${subtitle}</p>` : ''}
  `;
}

function buildReportFooterHTML() {
  const L = LANGS[currentLang];
  const now = new Date();
  return `
      <p style="margin-top:24px;color:#999;font-size:11px;border-top:1px solid #eee;padding-top:10px;">
        ${L.reportGenerated}: ${now.toLocaleDateString()} ${now.toLocaleTimeString()}
      </p>
    </div>
  `;
}

function buildSimpleTableHTML(headers, rows) {
  let html = `<table style="width:100%;border-collapse:collapse;font-size:12px;"><thead><tr>`;
  headers.forEach(h => { html += `<th style="background:#667eea;color:#fff;padding:8px 10px;text-align:start;">${h}</th>`; });
  html += `</tr></thead><tbody>`;
  rows.forEach((row, i) => {
    html += `<tr style="background:${i%2===0?'#fff':'#f8f9ff'};">`;
    row.forEach(cell => { html += `<td style="padding:7px 10px;border-bottom:1px solid #eee;">${cell}</td>`; });
    html += `</tr>`;
  });
  html += `</tbody></table>`;
  return html;
}

function buildClassSummaryTablesHTML(data) {
  const L = LANGS[currentLang];
  const byClass = {};
  data.forEach(row => {
    if (!row.classGroup) return;
    if (!byClass[row.classGroup]) byClass[row.classGroup] = {};
    row.absences.forEach(name => {
      if (!byClass[row.classGroup][name]) byClass[row.classGroup][name] = { total: 0, subjects: {} };
      byClass[row.classGroup][name].total += row.lectureCount;
      byClass[row.classGroup][name].subjects[row.subject] = (byClass[row.classGroup][name].subjects[row.subject]||0) + row.lectureCount;
    });
  });
  let html = '';
  Object.keys(byClass).sort().forEach(cls => {
    const students = byClass[cls];
    const sorted = Object.entries(students).sort((a,b)=>b[1].total-a[1].total);
    const subjects = new Set();
    Object.values(students).forEach(s => Object.keys(s.subjects).forEach(sub => subjects.add(sub)));
    const subArr = [...subjects].sort();
    html += `<h3 style="color:#667eea;font-size:15px;margin:16px 0 8px;">🏫 ${L.classLabel} ${cls}</h3>`;
    const headers = [L.studentLabel, ...subArr, L.totalLabel];
    const rows = sorted.map(([name,d]) => {
      const cells = [name];
      subArr.forEach(sub => cells.push(String(d.subjects[sub]||'-')));
      cells.push(String(d.total));
      return cells;
    });
    html += buildSimpleTableHTML(headers, rows);
  });
  return html || `<p style="color:#999;">${L.noAbsences}</p>`;
}

// ── Daily export ───────────────────────────────────────
async function exportDailyPDF() {
  const L = LANGS[currentLang];
  const val = document.getElementById('dailyDate').value;
  if (!val) return;
  showToast(L.exportingPdf, 'success');

  const fDate = normalizeDate(val);
  const filtered = allData.filter(r => r.date === fDate);
  const byClass = {};
  classes.forEach(c => byClass[c] = {});
  filtered.forEach(row => {
    if (!row.classGroup) return;
    if (!byClass[row.classGroup]) byClass[row.classGroup] = {};
    const nums = String(row.lecture).match(/\d+/g) || ['1'];
    nums.forEach(n => {
      const num = parseInt(n);
      if (num>=1 && num<=6) {
        if (!byClass[row.classGroup][num]) byClass[row.classGroup][num] = { subject: row.subject, students: [] };
        row.absences.forEach(s => { if (!byClass[row.classGroup][num].students.includes(s)) byClass[row.classGroup][num].students.push(s); });
      }
    });
  });

  let body = buildReportHeaderHTML(L.dDailyTitle, fDate);
  let any = false;
  Object.keys(byClass).sort().forEach(cls => {
    const lecs = byClass[cls];
    if (!Object.keys(lecs).length) return;
    any = true;
    body += `<h3 style="color:#667eea;font-size:15px;margin:16px 0 8px;">🏫 ${L.classLabel} ${cls}</h3>`;
    const headers = [1,2,3,4,5,6].map(n => 'Lec '+n);
    const subjRow = [1,2,3,4,5,6].map(n => lecs[n] ? lecs[n].subject : '—');
    const absRow  = [1,2,3,4,5,6].map(n => {
      const l = lecs[n];
      if (l && l.students.length) return l.students.join(', ');
      if (l) return L.noneAbsent;
      return '';
    });
    body += buildSimpleTableHTML(headers, [subjRow, absRow]);
  });
  if (!any) body += `<p style="color:#999;">${L.noAbsences}</p>`;
  body += buildReportFooterHTML();

  await renderHtmlToPDF(body, `Daily_Report_${fDate.replace(/\//g,'-')}.pdf`);
}

// ── Weekly export ──────────────────────────────────────
async function exportWeeklyPDF() {
  const L = LANGS[currentLang];
  const idx = parseInt(document.getElementById('weekSelect').value);
  if (isNaN(idx) || !weeks[idx]) return;
  const week = weeks[idx];
  const data = allData.filter(r => { const d = new Date(r.date); return d>=week.start && d<=week.end; });
  showToast(L.exportingPdf, 'success');
  const subtitle = `${L.weekLabel} ${week.number}: ${formatDate(week.start)} - ${formatDate(week.end)}`;
  let body = buildReportHeaderHTML(L.dWeeklyTitle, subtitle);
  body += buildClassSummaryTablesHTML(data);
  body += buildReportFooterHTML();
  await renderHtmlToPDF(body, `Weekly_Report_${week.number}.pdf`);
}

// ── Monthly export ─────────────────────────────────────
async function exportMonthlyPDF() {
  const L = LANGS[currentLang];
  const idx = parseInt(document.getElementById('monthSelect').value);
  if (isNaN(idx) || !months[idx]) return;
  const month = months[idx];
  const data = allData.filter(r => { const d = new Date(r.date); return d>=month.start && d<=month.end; });
  showToast(L.exportingPdf, 'success');
  let body = buildReportHeaderHTML(L.dMonthlyTitle, month.name);
  body += buildClassSummaryTablesHTML(data);
  body += buildReportFooterHTML();
  await renderHtmlToPDF(body, `Monthly_Report_${month.name.replace(/\s+/g,'_')}.pdf`);
}

// ── Roster export ──────────────────────────────────────
async function exportRosterPDF() {
  const L = LANGS[currentLang];
  const cls = document.getElementById('rosterClass').value;
  const min = parseInt(document.getElementById('minAbsences').value) || 0;
  if (!cls) return;
  showToast(L.exportingPdf, 'success');

  const summary = {}; const subjects = new Set();
  allData.filter(r => r.classGroup === cls).forEach(row => {
    row.absences.forEach(name => {
      if (!summary[name]) summary[name] = { total: 0, subjects: {} };
      summary[name].total += row.lectureCount;
      summary[name].subjects[row.subject] = (summary[name].subjects[row.subject]||0) + row.lectureCount;
      subjects.add(row.subject);
    });
  });
  const sorted = Object.entries(summary).filter(([,d])=>d.total>=min).sort((a,b)=>b[1].total-a[1].total);
  const subArr = [...subjects].sort();
  const headers = [L.studentLabel, ...subArr, L.totalLabel];
  const rows = sorted.map(([name,d]) => {
    const cells = [name];
    subArr.forEach(sub => cells.push(String(d.subjects[sub]||'-')));
    cells.push(String(d.total));
    return cells;
  });

  let body = buildReportHeaderHTML(L.dRosterTitle, `${L.classLabel} ${cls}`);
  body += rows.length ? buildSimpleTableHTML(headers, rows) : `<p style="color:#999;">${L.noAbsences}</p>`;
  body += buildReportFooterHTML();
  await renderHtmlToPDF(body, `Roster_${cls}.pdf`);
}

// ── Graduates export ───────────────────────────────────
async function exportGraduatesPDF() {
  const L = LANGS[currentLang];
  const yearFilter = document.getElementById('gradYearFilter').value;
  const list = (mgmtData.graduates||[]).filter(g => !yearFilter || g.year===yearFilter);
  showToast(L.exportingPdf, 'success');

  const byClass = {};
  list.forEach(g => { (byClass[g.className]=byClass[g.className]||[]).push(g.studentName); });

  let body = buildReportHeaderHTML(L.dGraduatesTitle, yearFilter || (L.allYears||''));
  if (!Object.keys(byClass).length) body += `<p style="color:#999;">—</p>`;
  Object.keys(byClass).sort().forEach(cls => {
    body += `<h3 style="color:#667eea;font-size:15px;margin:16px 0 8px;">🏫 ${cls}</h3>`;
    const rows = byClass[cls].map((n,i)=>[String(i+1), n]);
    body += buildSimpleTableHTML(['#', L.studentLabel], rows);
  });
  body += buildReportFooterHTML();
  await renderHtmlToPDF(body, `Graduates_${yearFilter||'All'}.pdf`);
}

// ── Official Certificate export ───────────────────────
async function exportCertificatePDF(encodedName) {
  const L = LANGS[currentLang];
  const name = decodeURIComponent(encodedName);

  const d = { cls:'', total:0, log:[] };
  allData.forEach(row => {
    row.absences.forEach(n => {
      if (n.toLowerCase() === name.toLowerCase()) {
        d.cls = row.classGroup || d.cls;
        d.total += row.lectureCount;
        d.log.push({ date: row.date, teacher: row.teacher, subject: row.subject, lecture: row.lecture });
      }
    });
  });
  d.log.sort((a,b) => new Date(a.date) - new Date(b.date));
  const subjects = [...new Set(d.log.map(a => a.subject))];
  const sev = getSeverity(d.total);
  const statusText  = sev === 'high' ? L.badgeHigh : sev === 'medium' ? L.badgeMedium : L.badgeLow;
  const statusColor = sev === 'high' ? '#c8402a' : sev === 'medium' ? '#ff8800' : '#2d6a4f';

  showToast(L.exportingPdf, 'success');

  let body = buildReportHeaderHTML(L.certTitle, '');
  body += `
    <div style="background:#f8f9ff;border:1px solid #d0d7ff;border-radius:10px;padding:16px 20px;margin-bottom:18px;">
      <div style="font-size:16px;font-weight:700;color:#333;margin-bottom:6px;">👤 ${name}</div>
      <div style="font-size:13px;color:#555;line-height:1.9;">
        <strong>${L.profileClass}:</strong> ${d.cls || '—'}<br>
        <strong>${L.profileTotal}:</strong> <span style="color:${statusColor};font-weight:700;">${d.total}</span>
        &nbsp;&nbsp; <strong>${L.colStatus||'Status'}:</strong> <span style="color:${statusColor};font-weight:700;">${statusText}</span><br>
        <strong>${L.profileSubjects}:</strong> ${subjects.join(', ') || '—'}<br>
        <strong>${L.profileEntries}:</strong> ${d.log.length}
      </div>
    </div>
    <h3 style="color:#667eea;font-size:14px;margin:0 0 8px;">${L.profileHistory}</h3>
  `;
  const headers = [L.colDate, L.colLecture, L.colSubject, L.colTeacher];
  const rows = d.log.map(a => [a.date, a.lecture, a.subject, a.teacher]);
  body += rows.length ? buildSimpleTableHTML(headers, rows) : `<p style="color:#999;">${L.noAbsences}</p>`;

  body += `
    <div style="margin-top:50px;display:flex;justify-content:space-between;gap:40px;">
      <div style="flex:1;">
        <div style="border-top:1.5px solid #333;padding-top:6px;font-size:12px;color:#555;">${L.certSignature}</div>
      </div>
      <div style="flex:1;">
        <div style="border-top:1.5px solid #333;padding-top:6px;font-size:12px;color:#555;">${L.certDate}: _______________</div>
      </div>
    </div>
  `;
  body += buildReportFooterHTML();

  await renderHtmlToPDF(body, `Certificate_${name.replace(/\s+/g,'_')}.pdf`);
}
