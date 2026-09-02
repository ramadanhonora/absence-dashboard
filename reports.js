// ══════════════════════════════════════════════════════
// PDF EXPORT ENGINE
// Browser-only PDF generation. Files are NOT saved to Google Drive.
// Snapshots HTML blocks for reliable Kurdish/Arabic text rendering.
// Depends on globals from absentapi.html:
// LANGS, currentLang, allData, mgmtData, classes, weeks, months,
// getSeverity, showToast, normalizeDate, formatDate, getAcademicYear.
// Requires jsPDF and html2canvas.
// ══════════════════════════════════════════════════════

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function sanitizeFileName(value, fallback = 'Report') {
  const name = String(value ?? '').trim()
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_ .]+|[_ .]+$/g, '');
  return name || fallback;
}

function buildEmptyStateHTML(message) {
  return `<div style="margin:24px 0;padding:18px;text-align:center;color:#777;
    background:#f8f9fa;border:1px solid #e5e7eb;border-radius:8px;">
    ${escapeHtml(message || 'No data available')}
  </div>`;
}

function handlePDFExportError(error) {
  console.error('PDF export error:', error);
  const message = (LANGS[currentLang] && LANGS[currentLang].pdfExportError)
    || 'Unable to generate the PDF report.';
  showToast(message, 'error');
}

// ── PDF renderer ────────────────────────────────────────
// Renders the report in the browser, creates the PDF locally,
// and downloads it with pdf.save(). Nothing is uploaded to Drive.

async function renderHtmlToPDF(contentHTML, filename) {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    throw new Error('jsPDF is not loaded.');
  }
  if (typeof html2canvas !== 'function') {
    throw new Error('html2canvas is not loaded.');
  }

  const { jsPDF } = window.jspdf;
  const holder = document.createElement('div');

  holder.style.position = 'fixed';
  holder.style.top = '0';
  holder.style.left = '-99999px';
  holder.style.width = '794px'; // A4 width @ 96dpi
  holder.style.background = '#ffffff';
  holder.style.color = '#222';
  holder.style.padding = '0';
  holder.style.margin = '0';
  holder.style.boxSizing = 'border-box';
  holder.innerHTML = contentHTML;

  document.body.appendChild(holder);

  try {
    const canvas = await html2canvas(holder, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false
    });

    if (canvas.height === 0) {
      throw new Error('Canvas rendering failed (zero height).');
    }

    const pdf = new jsPDF('p', 'pt', 'a4');
    const pageWidth  = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const ratio = pageWidth / canvas.width;
    const pageHeightInCanvasPx = pageHeight / ratio;

    let y = 0;
    let first = true;

    while (y < canvas.height) {
      const sliceH = Math.min(pageHeightInCanvasPx, canvas.height - y);
      if (sliceH <= 0) break;

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

    pdf.save(sanitizeFileName(filename, 'Report.pdf'));
  } finally {
    if (holder.parentNode) holder.parentNode.removeChild(holder);
  }
}

// ── Shared HTML builders ────────────────────────────────

function buildReportHeaderHTML(title, subtitle) {
  const L = LANGS[currentLang] || {};

  return `
    <div dir="${escapeHtml(L.dir || 'ltr')}" lang="${escapeHtml(L.htmlLang || 'en')}"
      style="font-family:'Segoe UI',Tahoma,Arial,sans-serif;
      padding:28px 28px 20px;color:#222;box-sizing:border-box;">

      <div style="display:flex;align-items:center;justify-content:space-between;
        gap:14px;border-bottom:3px solid #667eea;padding-bottom:14px;margin-bottom:20px;">

        <img src="aci.jpg"
          style="width:58px;height:58px;object-fit:contain;flex-shrink:0;">

        <div style="text-align:center;flex:1;min-width:0;">
          <div style="font-size:18px;font-weight:700;color:#333;">
            ${escapeHtml(L.dInstName)}
          </div>
          <div style="font-size:13px;color:#667eea;font-weight:600;margin-top:3px;">
            ${escapeHtml((L.academicYearLabel || 'Academic Year') + ': ' + (typeof getAcademicYear === 'function' ? getAcademicYear() : ''))}
          </div>
        </div>

        <img src="new-left-logo.jpg"
          style="width:58px;height:58px;object-fit:contain;flex-shrink:0;">
      </div>

      <h2 style="color:#667eea;margin:0 0 5px;font-size:20px;line-height:1.3;">
        ${escapeHtml(title)}
      </h2>

      ${subtitle ? `
        <p style="color:#666;margin:0 0 18px;font-size:13px;line-height:1.5;">
          ${escapeHtml(subtitle)}
        </p>
      ` : ''}
  `;
}

function buildReportFooterHTML() {
  const L = LANGS[currentLang] || {};
  const now = new Date();

  return `
      <p style="margin:28px 0 0;color:#999;font-size:10px;
        border-top:1px solid #e5e7eb;padding-top:9px;">
        ${escapeHtml(L.reportGenerated || 'Generated')}:
        ${escapeHtml(now.toLocaleDateString())}
        ${escapeHtml(now.toLocaleTimeString())}
      </p>
    </div>
  `;
}

function buildSimpleTableHTML(headers, rows) {
  let html = `
    <table style="width:100%;border-collapse:collapse;font-size:11px;
      table-layout:auto;margin:0 0 16px;">
      <thead>
        <tr>
  `;

  headers.forEach(h => {
    html += `
      <th style="background:#667eea;color:#fff;padding:8px 9px;
        text-align:start;border:1px solid #667eea;font-weight:600;
        line-height:1.35;">
        ${escapeHtml(h)}
      </th>
    `;
  });

  html += `</tr></thead><tbody>`;

  rows.forEach((row, i) => {
    html += `
      <tr style="background:${i % 2 === 0 ? '#fff' : '#f8f9ff'};">
    `;

    row.forEach(cell => {
      html += `
        <td style="padding:7px 9px;border:1px solid #e8eaf0;
          vertical-align:top;line-height:1.4;word-break:break-word;">
          ${escapeHtml(cell)}
        </td>
      `;
    });

    html += `</tr>`;
  });

  html += `</tbody></table>`;
  return html;
}

function buildClassSummaryTablesHTML(data) {
  const L = LANGS[currentLang] || {};
  const byClass = {};

  (data || []).forEach(row => {
    if (!row.classGroup) return;

    if (!byClass[row.classGroup]) byClass[row.classGroup] = {};

    (row.absences || []).forEach(name => {
      if (!byClass[row.classGroup][name]) {
        byClass[row.classGroup][name] = {
          total: 0,
          subjects: {}
        };
      }

      byClass[row.classGroup][name].total += Number(row.lectureCount) || 0;

      const subject = row.subject || '';
      byClass[row.classGroup][name].subjects[subject] =
        (byClass[row.classGroup][name].subjects[subject] || 0)
        + (Number(row.lectureCount) || 0);
    });
  });

  let html = '';

  Object.keys(byClass).sort().forEach(cls => {
    const students = byClass[cls];

    const sorted = Object.entries(students)
      .sort((a, b) => b[1].total - a[1].total);

    const subjects = new Set();

    Object.values(students).forEach(student => {
      Object.keys(student.subjects).forEach(subject => subjects.add(subject));
    });

    const subArr = [...subjects].sort();

    html += `
      <h3 style="color:#667eea;font-size:15px;margin:18px 0 8px;">
        🏫 ${escapeHtml(L.classLabel || 'Class')} ${escapeHtml(cls)}
      </h3>
    `;

    const headers = [L.studentLabel || 'Student', ...subArr, L.totalLabel || 'Total'];

    const rows = sorted.map(([name, d]) => {
      const cells = [name];

      subArr.forEach(sub => {
        cells.push(String(d.subjects[sub] || '-'));
      });

      cells.push(String(d.total));
      return cells;
    });

    html += buildSimpleTableHTML(headers, rows);
  });

  return html || buildEmptyStateHTML(L.noAbsences);
}

// ── Daily export ────────────────────────────────────────

async function exportDailyPDF() {
  try {
    const L = LANGS[currentLang] || {};
    const input = document.getElementById('dailyDate');
    const val = input ? input.value : '';
    if (!val) return;

    if (typeof showToast === 'function') showToast(L.exportingPdf, 'success');

    const fDate = typeof normalizeDate === 'function' ? normalizeDate(val) : val;
    const filtered = (allData || []).filter(r => r.date === fDate);
    const byClass = {};

    (classes || []).forEach(c => byClass[c] = {});

    filtered.forEach(row => {
      if (!row.classGroup) return;
      if (!byClass[row.classGroup]) byClass[row.classGroup] = {};

      const nums = String(row.lecture).match(/\d+/g) || ['1'];

      nums.forEach(n => {
        const num = parseInt(n, 10);

        if (num >= 1 && num <= 6) {
          if (!byClass[row.classGroup][num]) {
            byClass[row.classGroup][num] = {
              subject: row.subject,
              students: []
            };
          }

          (row.absences || []).forEach(s => {
            if (!byClass[row.classGroup][num].students.includes(s)) {
              byClass[row.classGroup][num].students.push(s);
            }
          });
        }
      });
    });

    let body = buildReportHeaderHTML(L.dDailyTitle, fDate);
    let any = false;

    Object.keys(byClass).sort().forEach(cls => {
      const lecs = byClass[cls];
      if (!Object.keys(lecs).length) return;

      any = true;

      body += `
        <h3 style="color:#667eea;font-size:15px;margin:18px 0 8px;">
          🏫 ${escapeHtml(L.classLabel || 'Class')} ${escapeHtml(cls)}
        </h3>
      `;

      const headers = [1, 2, 3, 4, 5, 6].map(n => `Lec ${n}`);

      const subjRow = [1, 2, 3, 4, 5, 6].map(n =>
        lecs[n] ? lecs[n].subject : '—'
      );

      const absRow = [1, 2, 3, 4, 5, 6].map(n => {
        const lecture = lecs[n];

        if (lecture && lecture.students.length) {
          return lecture.students.join(', ');
        }

        if (lecture) return L.noneAbsent || 'None';
        return '';
      });

      body += buildSimpleTableHTML(headers, [subjRow, absRow]);
    });

    if (!any) body += buildEmptyStateHTML(L.noAbsences);

    body += buildReportFooterHTML();

    await renderHtmlToPDF(
      body,
      `Daily_Report_${fDate.replace(/\//g, '-')}.pdf`
    );
  } catch (error) {
    handlePDFExportError(error);
  }
}

// ── Weekly export ───────────────────────────────────────

async function exportWeeklyPDF() {
  try {
    const L = LANGS[currentLang] || {};
    const input = document.getElementById('weekSelect');
    const idx = parseInt(input ? input.value : '', 10);

    if (isNaN(idx) || !weeks || !weeks[idx]) return;

    const week = weeks[idx];

    const data = (allData || []).filter(r => {
      const d = new Date(r.date);
      return d >= week.start && d <= week.end;
    });

    if (typeof showToast === 'function') showToast(L.exportingPdf, 'success');

    const formattedStart = typeof formatDate === 'function' ? formatDate(week.start) : week.start;
    const formattedEnd = typeof formatDate === 'function' ? formatDate(week.end) : week.end;

    const subtitle = `${L.weekLabel || 'Week'} ${week.number}: ${formattedStart} - ${formattedEnd}`;

    let body = buildReportHeaderHTML(L.dWeeklyTitle, subtitle);
    body += buildClassSummaryTablesHTML(data);
    body += buildReportFooterHTML();

    await renderHtmlToPDF(
      body,
      `Weekly_Report_${week.number}.pdf`
    );
  } catch (error) {
    handlePDFExportError(error);
  }
}

// ── Monthly export ──────────────────────────────────────

async function exportMonthlyPDF() {
  try {
    const L = LANGS[currentLang] || {};
    const input = document.getElementById('monthSelect');
    const idx = parseInt(input ? input.value : '', 10);

    if (isNaN(idx) || !months || !months[idx]) return;

    const month = months[idx];

    const data = (allData || []).filter(r => {
      const d = new Date(r.date);
      return d >= month.start && d <= month.end;
    });

    if (typeof showToast === 'function') showToast(L.exportingPdf, 'success');

    let body = buildReportHeaderHTML(L.dMonthlyTitle, month.name);
    body += buildClassSummaryTablesHTML(data);
    body += buildReportFooterHTML();

    await renderHtmlToPDF(
      body,
      `Monthly_Report_${sanitizeFileName(month.name, 'Month')}.pdf`
    );
  } catch (error) {
    handlePDFExportError(error);
  }
}

// ── Roster export ───────────────────────────────────────

async function exportRosterPDF() {
  try {
    const L = LANGS[currentLang] || {};
    const clsInput = document.getElementById('rosterClass');
    const minInput = document.getElementById('minAbsences');

    const cls = clsInput ? clsInput.value : '';
    const min = parseInt(minInput ? minInput.value : '0', 10) || 0;

    if (!cls) return;

    if (typeof showToast === 'function') showToast(L.exportingPdf, 'success');

    const summary = {};
    const subjects = new Set();

    (allData || []).filter(r => r.classGroup === cls).forEach(row => {
      (row.absences || []).forEach(name => {
        if (!summary[name]) {
          summary[name] = {
            total: 0,
            subjects: {}
          };
        }

        summary[name].total += Number(row.lectureCount) || 0;

        summary[name].subjects[row.subject] =
          (summary[name].subjects[row.subject] || 0)
          + (Number(row.lectureCount) || 0);

        if (row.subject) subjects.add(row.subject);
      });
    });

    const sorted = Object.entries(summary)
      .filter(([, d]) => d.total >= min)
      .sort((a, b) => b[1].total - a[1].total);

    const subArr = [...subjects].sort();
    const headers = [L.studentLabel || 'Student', ...subArr, L.totalLabel || 'Total'];

    const rows = sorted.map(([name, d]) => {
      const cells = [name];

      subArr.forEach(sub => {
        cells.push(String(d.subjects[sub] || '-'));
      });

      cells.push(String(d.total));
      return cells;
    });

    let body = buildReportHeaderHTML(
      L.dRosterTitle,
      `${L.classLabel || 'Class'} ${cls}`
    );

    body += rows.length
      ? buildSimpleTableHTML(headers, rows)
      : buildEmptyStateHTML(L.noAbsences);

    body += buildReportFooterHTML();

    await renderHtmlToPDF(
      body,
      `Roster_${sanitizeFileName(cls, 'Class')}.pdf`
    );
  } catch (error) {
    handlePDFExportError(error);
  }
}

// ── Graduates export ────────────────────────────────────

async function exportGraduatesPDF() {
  try {
    const L = LANGS[currentLang] || {};
    const yearInput = document.getElementById('gradYearFilter');
    const yearFilter = yearInput ? yearInput.value : '';

    const list = ((mgmtData && mgmtData.graduates) || [])
      .filter(g => !yearFilter || g.year === yearFilter);

    if (typeof showToast === 'function') showToast(L.exportingPdf, 'success');

    const byClass = {};

    list.forEach(g => {
      const className = g.className || 'Unassigned';
      if (!byClass[className]) byClass[className] = [];
      byClass[className].push(g.studentName || '');
    });

    let body = buildReportHeaderHTML(
      L.dGraduatesTitle,
      yearFilter || (L.allYears || 'All Years')
    );

    if (!Object.keys(byClass).length) {
      body += buildEmptyStateHTML(L.noAbsences || 'No graduates found');
    }

    Object.keys(byClass).sort().forEach(cls => {
      body += `
        <h3 style="color:#667eea;font-size:15px;margin:18px 0 8px;">
          🏫 ${escapeHtml(cls)}
        </h3>
      `;

      const rows = byClass[cls].map((name, i) => [
        String(i + 1),
        name
      ]);

      body += buildSimpleTableHTML(['#', L.studentLabel || 'Student'], rows);
    });

    body += buildReportFooterHTML();

    await renderHtmlToPDF(
      body,
      `Graduates_${sanitizeFileName(yearFilter || 'All', 'All')}.pdf`
    );
  } catch (error) {
    handlePDFExportError(error);
  }
}

// ── Official Certificate export ─────────────────────────

async function exportCertificatePDF(encodedName) {
  try {
    const L = LANGS[currentLang] || {};
    const name = decodeURIComponent(encodedName || '');

    const d = {
      cls: '',
      total: 0,
      log: []
    };

    (allData || []).forEach(row => {
      (row.absences || []).forEach(n => {
        if (String(n).toLowerCase() === String(name).toLowerCase()) {
          d.cls = row.classGroup || d.cls;
          d.total += Number(row.lectureCount) || 0;

          d.log.push({
            date: row.date,
            teacher: row.teacher,
            subject: row.subject,
            lecture: row.lecture
          });
        }
      });
    });

    d.log.sort((a, b) => new Date(a.date) - new Date(b.date));

    const subjects = [...new Set(
      d.log.map(a => a.subject).filter(Boolean)
    )];

    const sev = typeof getSeverity === 'function' ? getSeverity(d.total) : 'low';

    const statusText =
      sev === 'high'
        ? L.badgeHigh
        : sev === 'medium'
          ? L.badgeMedium
          : L.badgeLow;

    const statusColor =
      sev === 'high'
        ? '#c8402a'
        : sev === 'medium'
          ? '#ff8800'
          : '#2d6a4f';

    if (typeof showToast === 'function') showToast(L.exportingPdf, 'success');

    let body = buildReportHeaderHTML(L.certTitle, '');

    body += `
      <div style="background:#f8f9ff;border:1px solid #d0d7ff;
        border-radius:10px;padding:16px 20px;margin-bottom:20px;">

        <div style="font-size:16px;font-weight:700;color:#333;margin-bottom:7px;">
          👤 ${escapeHtml(name)}
        </div>

        <div style="font-size:13px;color:#555;line-height:1.9;">
          <strong>${escapeHtml(L.profileClass)}:</strong>
          ${escapeHtml(d.cls || '—')}<br>

          <strong>${escapeHtml(L.profileTotal)}:</strong>
          <span style="color:${statusColor};font-weight:700;">
            ${escapeHtml(d.total)}
          </span>

          &nbsp;&nbsp;

          <strong>${escapeHtml(L.colStatus || 'Status')}:</strong>
          <span style="color:${statusColor};font-weight:700;">
            ${escapeHtml(statusText)}
          </span><br>

          <strong>${escapeHtml(L.profileSubjects)}:</strong>
          ${escapeHtml(subjects.join(', ') || '—')}<br>

          <strong>${escapeHtml(L.profileEntries)}:</strong>
          ${escapeHtml(d.log.length)}
        </div>
      </div>

      <h3 style="color:#667eea;font-size:14px;margin:0 0 8px;">
        ${escapeHtml(L.profileHistory)}
      </h3>
    `;

    const headers = [
      L.colDate,
      L.colLecture,
      L.colSubject,
      L.colTeacher
    ];

    const rows = d.log.map(a => [
      a.date,
      a.lecture,
      a.subject,
      a.teacher
    ]);

    body += rows.length
      ? buildSimpleTableHTML(headers, rows)
      : buildEmptyStateHTML(L.noAbsences);

    body += `
      <div style="margin-top:50px;display:flex;justify-content:space-between;gap:40px;">

        <div style="flex:1;">
          <div style="border-top:1.5px solid #333;padding-top:6px;
            font-size:12px;color:#555;">
            ${escapeHtml(L.certSignature)}
          </div>
        </div>

        <div style="flex:1;">
          <div style="border-top:1.5px solid #333;padding-top:6px;
            font-size:12px;color:#555;">
            ${escapeHtml(L.certDate)}: _______________
          </div>
        </div>
      </div>
    `;

    body += buildReportFooterHTML();

    await renderHtmlToPDF(
      body,
      `Certificate_${sanitizeFileName(name, 'Student')}.pdf`
    );
  } catch (error) {
    handlePDFExportError(error);
  }
}
