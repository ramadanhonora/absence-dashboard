# `reports.js`

> Complete replacement for the existing `reports.js`.
>
> **Important:** This version keeps PDF generation entirely in the browser. It uses `jsPDF` and `html2canvas` and calls `pdf.save(...)`. It does **not** use Google Drive, `DriveApp`, or any Apps Script upload endpoint.

```javascript
// ══════════════════════════════════════════════════════════════════════
// ── PDF EXPORT ENGINE ─────────────────────────────────────────────────
// Creates PDFs locally in the user's browser.
// No Google Drive upload is performed.
// Text is rendered as an image inside the PDF to preserve reliable
// Kurdish / Arabic rendering without requiring a PDF font-shaping library.
//
// Depends on globals defined in absentapi.html:
// LANGS, currentLang, allData, mgmtData, classes, weeks, months,
// getSeverity, getBadge, showToast, normalizeDate, formatDate,
// getAcademicYear.
// ══════════════════════════════════════════════════════════════════════

/**
 * Escape text before inserting it into generated HTML.
 * This prevents data values such as student names, subjects, or teachers
 * from accidentally being interpreted as HTML.
 */
function escapeHtml(value) {
  if (value === null || value === undefined) return '';

  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Convert a value into a safe filename.
 * Keeps Arabic/Kurdish/Unicode letters while removing characters that
 * are problematic on Windows/macOS/Linux.
 */
function sanitizeFileName(value, fallback = 'Report') {
  const text = String(value ?? '').trim();

  if (!text) return fallback;

  return text
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_ .]+|[_ .]+$/g, '')
    .slice(0, 150) || fallback;
}

/**
 * Get a translated label safely without requiring new LANGS keys.
 */
function getLabel(key, fallback) {
  const L = LANGS?.[currentLang] || {};
  return L[key] || fallback;
}

/**
 * Convert a date string into a filename-friendly representation.
 * The visible report date itself is not changed.
 */
function safeDateForFileName(value) {
  return sanitizeFileName(
    String(value ?? '')
      .replace(/\//g, '-')
      .replace(/\\/g, '-'),
    'date'
  );
}

/**
 * Display an empty report message in a consistent style.
 */
function buildEmptyStateHTML(message) {
  return `
    <div style="
      margin:24px 0;
      padding:22px;
      border:1px solid #e1e5ee;
      border-radius:10px;
      background:#fafbff;
      text-align:center;
      color:#777;
      font-size:13px;
      line-height:1.7;
    ">
      ${escapeHtml(message || 'No data available.')}
    </div>
  `;
}

/**
 * Render HTML to a locally downloadable PDF.
 *
 * IMPORTANT:
 * - No DriveApp
 * - No Google Drive API
 * - No server upload
 * - pdf.save(filename) downloads the PDF to the browser
 */
async function renderHtmlToPDF(contentHTML, filename) {
  if (!window.html2canvas) {
    throw new Error('html2canvas is not loaded.');
  }

  if (!window.jspdf || !window.jspdf.jsPDF) {
    throw new Error('jsPDF is not loaded.');
  }

  const { jsPDF } = window.jspdf;

  const holder = document.createElement('div');

  holder.style.position = 'fixed';
  holder.style.top = '0';
  holder.style.left = '-99999px';
  holder.style.width = '794px'; // A4 width at approximately 96 DPI
  holder.style.background = '#ffffff';
  holder.style.boxSizing = 'border-box';
  holder.style.overflow = 'visible';
  holder.style.padding = '0';
  holder.innerHTML = contentHTML;

  document.body.appendChild(holder);

  try {
    // Give the browser a moment to finish layout and image loading.
    await new Promise(resolve => requestAnimationFrame(resolve));

    const images = Array.from(holder.querySelectorAll('img'));

    if (images.length) {
      await Promise.all(
        images.map(img => {
          if (img.complete) return Promise.resolve();

          return new Promise(resolve => {
            img.addEventListener('load', resolve, { once: true });
            img.addEventListener('error', resolve, { once: true });
          });
        })
      );
    }

    const canvas = await html2canvas(holder, {
      scale: 2,
      useCORS: true,
      allowTaint: false,
      backgroundColor: '#ffffff',
      logging: false,
      imageTimeout: 15000,
      windowWidth: holder.scrollWidth,
      windowHeight: holder.scrollHeight
    });

    const pdf = new jsPDF('p', 'pt', 'a4');

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();

    // Reserve a small area at the bottom of every PDF page for page numbers.
    const footerHeight = 24;

    const contentPageHeight = pageHeight - footerHeight;
    const ratio = pageWidth / canvas.width;
    const pageHeightInCanvasPx = contentPageHeight / ratio;

    // Safety guard against an unexpected zero-sized canvas.
    if (!canvas.width || !canvas.height) {
      throw new Error('The report produced an empty canvas.');
    }

    let y = 0;
    let first = true;
    let pageNumber = 0;

    while (y < canvas.height) {
      const sliceH = Math.min(
        pageHeightInCanvasPx,
        canvas.height - y
      );

      const sliceCanvas = document.createElement('canvas');

      sliceCanvas.width = canvas.width;
      sliceCanvas.height = Math.ceil(sliceH);

      const ctx = sliceCanvas.getContext('2d');

      if (!ctx) {
        throw new Error('Unable to create PDF canvas context.');
      }

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(
        0,
        0,
        sliceCanvas.width,
        sliceCanvas.height
      );

      ctx.drawImage(
        canvas,
        0,
        y,
        canvas.width,
        sliceH,
        0,
        0,
        canvas.width,
        sliceH
      );

      const imgData = sliceCanvas.toDataURL(
        'image/jpeg',
        0.95
      );

      if (!first) {
        pdf.addPage();
      }

      // Report image/content.
      pdf.addImage(
        imgData,
        'JPEG',
        0,
        0,
        pageWidth,
        sliceH * ratio
      );

      pageNumber++;

      // Page number is added directly to the PDF, not to the image.
      // This keeps it sharp and consistent on every page.
      const pageLabel = getLabel('pageLabel', 'Page');
      const ofLabel = getLabel('ofLabel', 'of');

      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(8);
      pdf.setTextColor(130, 130, 130);

      pdf.text(
        `${pageLabel} ${pageNumber} ${ofLabel} ?`,
        pageWidth - 28,
        pageHeight - 9,
        { align: 'right' }
      );

      first = false;
      y += sliceH;
    }

    // Replace the temporary "?" with the real total-page count.
    // This is intentionally done after all pages have been created.
    const totalPages =
      typeof pdf.internal.getNumberOfPages === 'function'
        ? pdf.internal.getNumberOfPages()
        : pageNumber;

    for (let i = 1; i <= totalPages; i++) {
      pdf.setPage(i);

      const pageLabel = getLabel('pageLabel', 'Page');
      const ofLabel = getLabel('ofLabel', 'of');

      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(8);
      pdf.setTextColor(130, 130, 130);

      // Cover the temporary page-number text before writing the final one.
      pdf.setFillColor(255, 255, 255);
      pdf.rect(
        pageWidth - 90,
        pageHeight - 18,
        70,
        12,
        'F'
      );

      pdf.setTextColor(130, 130, 130);

      pdf.text(
        `${pageLabel} ${i} ${ofLabel} ${totalPages}`,
        pageWidth - 28,
        pageHeight - 9,
        { align: 'right' }
      );
    }

    // LOCAL BROWSER DOWNLOAD ONLY.
    // There is deliberately no DriveApp / Google Drive operation here.
    pdf.save(
      sanitizeFileName(filename, 'Report.pdf')
    );

  } finally {
    if (holder.parentNode) {
      holder.parentNode.removeChild(holder);
    }
  }
}


// ══════════════════════════════════════════════════════════════════════
// ── Shared HTML builders ──────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════

function buildReportHeaderHTML(title, subtitle) {
  const L = LANGS[currentLang];

  const direction = L.dir || 'ltr';
  const htmlLang = L.htmlLang || 'en';

  const institutionName =
    L.dInstName || '';

  const academicYearLabel =
    L.academicYearLabel || 'Academic Year';

  const academicYear =
    typeof getAcademicYear === 'function'
      ? getAcademicYear()
      : '';

  return `
    <div
      dir="${escapeHtml(direction)}"
      lang="${escapeHtml(htmlLang)}"
      style="
        font-family:'Segoe UI',Tahoma,Arial,sans-serif;
        width:100%;
        box-sizing:border-box;
        padding:24px 24px 20px;
        color:#222;
        background:#fff;
      "
    >

      <!-- Official report header -->
      <div style="
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:14px;
        border-bottom:3px solid #667eea;
        padding-bottom:14px;
        margin-bottom:20px;
      ">

        <img
          src="aci.jpg"
          alt=""
          style="
            width:58px;
            height:58px;
            object-fit:contain;
            flex-shrink:0;
          "
        >

        <div style="
          text-align:center;
          flex:1;
          min-width:0;
        ">
          <div style="
            font-size:18px;
            font-weight:700;
            color:#333;
            line-height:1.5;
          ">
            ${escapeHtml(institutionName)}
          </div>

          <div style="
            font-size:13px;
            color:#667eea;
            font-weight:600;
            line-height:1.5;
            margin-top:2px;
          ">
            ${escapeHtml(academicYearLabel)}:
            ${escapeHtml(academicYear)}
          </div>
        </div>

        <img
          src="new-left-logo.jpg"
          alt=""
          style="
            width:58px;
            height:58px;
            object-fit:contain;
            flex-shrink:0;
          "
        >
      </div>

      <!-- Report title -->
      <h2 style="
        color:#667eea;
        margin:0 0 5px;
        font-size:20px;
        line-height:1.4;
        font-weight:700;
      ">
        ${escapeHtml(title)}
      </h2>

      ${
        subtitle
          ? `
            <p style="
              color:#666;
              margin:0 0 18px;
              font-size:13px;
              line-height:1.7;
            ">
              ${escapeHtml(subtitle)}
            </p>
          `
          : ''
      }
  `;
}


function buildReportFooterHTML() {
  const L = LANGS[currentLang];

  const now = new Date();

  const dateText = now.toLocaleDateString();
  const timeText = now.toLocaleTimeString();

  return `
      <div style="
        margin-top:28px;
        padding-top:10px;
        border-top:1px solid #e5e7eb;
        color:#999;
        font-size:10px;
        line-height:1.5;
      ">
        ${escapeHtml(L.reportGenerated || 'Generated')}:
        ${escapeHtml(dateText)}
        ${escapeHtml(timeText)}
      </div>
    </div>
  `;
}


/**
 * Build a consistent report table.
 */
function buildSimpleTableHTML(headers, rows) {
  let html = `
    <table style="
      width:100%;
      border-collapse:collapse;
      table-layout:auto;
      font-size:12px;
      line-height:1.55;
      margin:0;
    ">
      <thead>
        <tr>
  `;

  headers.forEach(header => {
    html += `
      <th style="
        background:#667eea;
        color:#fff;
        padding:8px 9px;
        text-align:start;
        vertical-align:middle;
        border:1px solid #667eea;
        font-weight:700;
        word-break:break-word;
      ">
        ${escapeHtml(header)}
      </th>
    `;
  });

  html += `
        </tr>
      </thead>
      <tbody>
  `;

  rows.forEach((row, i) => {
    const background =
      i % 2 === 0
        ? '#ffffff'
        : '#f8f9ff';

    html += `
      <tr style="
        background:${background};
        break-inside:avoid;
        page-break-inside:avoid;
      ">
    `;

    row.forEach(cell => {
      html += `
        <td style="
          padding:7px 9px;
          border:1px solid #e9ebf0;
          vertical-align:top;
          word-break:break-word;
          overflow-wrap:anywhere;
        ">
          ${escapeHtml(cell)}
        </td>
      `;
    });

    html += `</tr>`;
  });

  html += `
      </tbody>
    </table>
  `;

  return html;
}


/**
 * Build summary tables grouped by class.
 */
function buildClassSummaryTablesHTML(data) {
  const L = LANGS[currentLang];

  const byClass = {};

  data.forEach(row => {
    if (!row.classGroup) return;

    if (!byClass[row.classGroup]) {
      byClass[row.classGroup] = {};
    }

    const absences =
      Array.isArray(row.absences)
        ? row.absences
        : [];

    absences.forEach(name => {
      const studentName = String(name ?? '');

      if (!studentName) return;

      if (!byClass[row.classGroup][studentName]) {
        byClass[row.classGroup][studentName] = {
          total: 0,
          subjects: {}
        };
      }

      const lectureCount =
        Number(row.lectureCount) || 0;

      byClass[row.classGroup][studentName].total +=
        lectureCount;

      byClass[row.classGroup][studentName].subjects[row.subject] =
        (
          byClass[row.classGroup][studentName].subjects[row.subject] || 0
        ) + lectureCount;
    });
  });

  let html = '';

  Object.keys(byClass)
    .sort()
    .forEach(cls => {
      const students = byClass[cls];

      const sorted =
        Object.entries(students)
          .sort((a, b) => b[1].total - a[1].total);

      const subjects = new Set();

      Object.values(students).forEach(student => {
        Object.keys(student.subjects)
          .forEach(subject => subjects.add(subject));
      });

      const subArr = [...subjects].sort();

      html += `
        <div style="
          margin-top:18px;
          page-break-inside:avoid;
          break-inside:avoid;
        ">
          <h3 style="
            color:#667eea;
            font-size:15px;
            margin:0 0 8px;
            padding-bottom:4px;
            line-height:1.5;
          ">
            🏫 ${escapeHtml(L.classLabel || 'Class')}
            ${escapeHtml(cls)}
          </h3>
      `;

      const headers = [
        L.studentLabel || 'Student',
        ...subArr,
        L.totalLabel || 'Total'
      ];

      const rows = sorted.map(([name, d]) => {
        const cells = [name];

        subArr.forEach(subject => {
          cells.push(
            String(d.subjects[subject] || '-')
          );
        });

        cells.push(String(d.total));

        return cells;
      });

      html += buildSimpleTableHTML(headers, rows);

      html += `</div>`;
    });

  return html || buildEmptyStateHTML(L.noAbsences);
}


// ══════════════════════════════════════════════════════════════════════
// ── Export error helper ────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════

function handlePDFExportError(error) {
  console.error('PDF export error:', error);

  const L = LANGS?.[currentLang] || {};

  const message =
    L.exportPdfError ||
    L.pdfExportError ||
    'PDF export failed. Please try again.';

  if (typeof showToast === 'function') {
    showToast(message, 'error');
  }
}


// ══════════════════════════════════════════════════════════════════════
// ── Daily export ──────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════

async function exportDailyPDF() {
  const L = LANGS[currentLang];

  const dateInput =
    document.getElementById('dailyDate');

  if (!dateInput) return;

  const val = dateInput.value;

  if (!val) return;

  showToast(L.exportingPdf, 'success');

  try {
    const fDate = normalizeDate(val);

    const filtered =
      allData.filter(r => r.date === fDate);

    const byClass = {};

    classes.forEach(c => {
      byClass[c] = {};
    });

    filtered.forEach(row => {
      if (!row.classGroup) return;

      if (!byClass[row.classGroup]) {
        byClass[row.classGroup] = {};
      }

      const nums =
        String(row.lecture ?? '').match(/\d+/g) ||
        ['1'];

      nums.forEach(n => {
        const num = parseInt(n, 10);

        if (num >= 1 && num <= 6) {
          if (!byClass[row.classGroup][num]) {
            byClass[row.classGroup][num] = {
              subject: row.subject,
              students: []
            };
          }

          const absences =
            Array.isArray(row.absences)
              ? row.absences
              : [];

          absences.forEach(student => {
            const studentName =
              String(student ?? '');

            if (
              studentName &&
              !byClass[row.classGroup][num].students.includes(studentName)
            ) {
              byClass[row.classGroup][num].students.push(
                studentName
              );
            }
          });
        }
      });
    });

    let body =
      buildReportHeaderHTML(
        L.dDailyTitle,
        fDate
      );

    let any = false;

    Object.keys(byClass)
      .sort()
      .forEach(cls => {
        const lecs = byClass[cls];

        if (!Object.keys(lecs).length) return;

        any = true;

        body += `
          <div style="
            margin-top:18px;
            page-break-inside:avoid;
            break-inside:avoid;
          ">
            <h3 style="
              color:#667eea;
              font-size:15px;
              margin:0 0 8px;
              line-height:1.5;
            ">
              🏫 ${escapeHtml(L.classLabel || 'Class')}
              ${escapeHtml(cls)}
            </h3>
        `;

        const headers =
          [1, 2, 3, 4, 5, 6]
            .map(n => `Lec ${n}`);

        const subjRow =
          [1, 2, 3, 4, 5, 6]
            .map(n =>
              lecs[n]
                ? lecs[n].subject
                : '—'
            );

        const absRow =
          [1, 2, 3, 4, 5, 6]
            .map(n => {
              const lecture = lecs[n];

              if (
                lecture &&
                lecture.students.length
              ) {
                return lecture.students.join(', ');
              }

              if (lecture) {
                return L.noneAbsent;
              }

              return '';
            });

        body += buildSimpleTableHTML(
          headers,
          [subjRow, absRow]
        );

        body += `</div>`;
      });

    if (!any) {
      body += buildEmptyStateHTML(
        L.noAbsences
      );
    }

    body += buildReportFooterHTML();

    await renderHtmlToPDF(
      body,
      `Daily_Report_${safeDateForFileName(fDate)}.pdf`
    );

  } catch (error) {
    handlePDFExportError(error);
  }
}


// ══════════════════════════════════════════════════════════════════════
// ── Weekly export ─────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════

async function exportWeeklyPDF() {
  const L = LANGS[currentLang];

  const weekSelect =
    document.getElementById('weekSelect');

  if (!weekSelect) return;

  const idx =
    parseInt(weekSelect.value, 10);

  if (
    Number.isNaN(idx) ||
    !weeks[idx]
  ) {
    return;
  }

  const week = weeks[idx];

  showToast(L.exportingPdf, 'success');

  try {
    const data =
      allData.filter(r => {
        const d = new Date(r.date);

        return (
          d >= week.start &&
          d <= week.end
        );
      });

    const subtitle =
      `${L.weekLabel} ${week.number}: ` +
      `${formatDate(week.start)} - ` +
      `${formatDate(week.end)}`;

    let body =
      buildReportHeaderHTML(
        L.dWeeklyTitle,
        subtitle
      );

    body +=
      buildClassSummaryTablesHTML(data);

    body +=
      buildReportFooterHTML();

    await renderHtmlToPDF(
      body,
      `Weekly_Report_Week_${sanitizeFileName(
        week.number,
        'Unknown'
      )}.pdf`
    );

  } catch (error) {
    handlePDFExportError(error);
  }
}


// ══════════════════════════════════════════════════════════════════════
// ── Monthly export ────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════

async function exportMonthlyPDF() {
  const L = LANGS[currentLang];

  const monthSelect =
    document.getElementById('monthSelect');

  if (!monthSelect) return;

  const idx =
    parseInt(monthSelect.value, 10);

  if (
    Number.isNaN(idx) ||
    !months[idx]
  ) {
    return;
  }

  const month = months[idx];

  showToast(L.exportingPdf, 'success');

  try {
    const data =
      allData.filter(r => {
        const d = new Date(r.date);

        return (
          d >= month.start &&
          d <= month.end
        );
      });

    let body =
      buildReportHeaderHTML(
        L.dMonthlyTitle,
        month.name
      );

    body +=
      buildClassSummaryTablesHTML(data);

    body +=
      buildReportFooterHTML();

    await renderHtmlToPDF(
      body,
      `Monthly_Report_${sanitizeFileName(
        month.name,
        'Month'
      )}.pdf`
    );

  } catch (error) {
    handlePDFExportError(error);
  }
}


// ══════════════════════════════════════════════════════════════════════
// ── Roster export ─────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════

async function exportRosterPDF() {
  const L = LANGS[currentLang];

  const classSelect =
    document.getElementById('rosterClass');

  const minInput =
    document.getElementById('minAbsences');

  if (!classSelect) return;

  const cls = classSelect.value;

  const min =
    parseInt(
      minInput?.value,
      10
    ) || 0;

  if (!cls) return;

  showToast(L.exportingPdf, 'success');

  try {
    const summary = {};
    const subjects = new Set();

    allData
      .filter(r => r.classGroup === cls)
      .forEach(row => {
        const absences =
          Array.isArray(row.absences)
            ? row.absences
            : [];

        absences.forEach(name => {
          const studentName =
            String(name ?? '');

          if (!studentName) return;

          if (!summary[studentName]) {
            summary[studentName] = {
              total: 0,
              subjects: {}
            };
          }

          const lectureCount =
            Number(row.lectureCount) || 0;

          summary[studentName].total +=
            lectureCount;

          summary[studentName].subjects[row.subject] =
            (
              summary[studentName].subjects[row.subject] ||
              0
            ) + lectureCount;

          subjects.add(row.subject);
        });
      });

    const sorted =
      Object.entries(summary)
        .filter(([, d]) => d.total >= min)
        .sort((a, b) => b[1].total - a[1].total);

    const subArr =
      [...subjects].sort();

    const headers = [
      L.studentLabel || 'Student',
      ...subArr,
      L.totalLabel || 'Total'
    ];

    const rows =
      sorted.map(([name, d]) => {
        const cells = [name];

        subArr.forEach(subject => {
          cells.push(
            String(
              d.subjects[subject] || '-'
            )
          );
        });

        cells.push(
          String(d.total)
        );

        return cells;
      });

    let body =
      buildReportHeaderHTML(
        L.dRosterTitle,
        `${L.classLabel} ${cls}`
      );

    body += rows.length
      ? buildSimpleTableHTML(
          headers,
          rows
        )
      : buildEmptyStateHTML(
          L.noAbsences
        );

    body +=
      buildReportFooterHTML();

    await renderHtmlToPDF(
      body,
      `Roster_${sanitizeFileName(
        cls,
        'Class'
      )}.pdf`
    );

  } catch (error) {
    handlePDFExportError(error);
  }
}


// ══════════════════════════════════════════════════════════════════════
// ── Graduates export ──────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════

async function exportGraduatesPDF() {
  const L = LANGS[currentLang];

  const yearFilterElement =
    document.getElementById('gradYearFilter');

  const yearFilter =
    yearFilterElement
      ? yearFilterElement.value
      : '';

  showToast(L.exportingPdf, 'success');

  try {
    const list =
      (mgmtData.graduates || [])
        .filter(
          g =>
            !yearFilter ||
            g.year === yearFilter
        );

    const byClass = {};

    list.forEach(g => {
      const className =
        String(g.className ?? '');

      const studentName =
        String(g.studentName ?? '');

      if (!byClass[className]) {
        byClass[className] = [];
      }

      byClass[className].push(
        studentName
      );
    });

    let body =
      buildReportHeaderHTML(
        L.dGraduatesTitle,
        yearFilter ||
          (L.allYears || '')
      );

    if (!Object.keys(byClass).length) {
      body += buildEmptyStateHTML(
        L.noAbsences || 'No graduates found.'
      );
    }

    Object.keys(byClass)
      .sort()
      .forEach(cls => {
        body += `
          <div style="
            margin-top:18px;
            page-break-inside:avoid;
            break-inside:avoid;
          ">
            <h3 style="
              color:#667eea;
              font-size:15px;
              margin:0 0 8px;
              line-height:1.5;
            ">
              🏫 ${escapeHtml(cls)}
            </h3>
        `;

        const rows =
          byClass[cls]
            .map((name, i) => [
              String(i + 1),
              name
            ]);

        body +=
          buildSimpleTableHTML(
            ['#', L.studentLabel],
            rows
          );

        body += `</div>`;
      });

    body +=
      buildReportFooterHTML();

    await renderHtmlToPDF(
      body,
      `Graduates_${sanitizeFileName(
        yearFilter || 'All',
        'All'
      )}.pdf`
    );

  } catch (error) {
    handlePDFExportError(error);
  }
}


// ══════════════════════════════════════════════════════════════════════
// ── Official Certificate export ──────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════

async function exportCertificatePDF(encodedName) {
  const L = LANGS[currentLang];

  let name = '';

  try {
    name =
      decodeURIComponent(
        encodedName
      );
  } catch (error) {
    name =
      String(encodedName ?? '');
  }

  name = String(name ?? '').trim();

  if (!name) return;

  showToast(L.exportingPdf, 'success');

  try {
    const d = {
      cls: '',
      total: 0,
      log: []
    };

    allData.forEach(row => {
      const absences =
        Array.isArray(row.absences)
          ? row.absences
          : [];

      absences.forEach(n => {
        const studentName =
          String(n ?? '');

        if (
          studentName.toLowerCase() ===
          name.toLowerCase()
        ) {
          d.cls =
            row.classGroup ||
            d.cls;

          d.total +=
            Number(row.lectureCount) || 0;

          d.log.push({
            date: row.date,
            teacher: row.teacher,
            subject: row.subject,
            lecture: row.lecture
          });
        }
      });
    });

    d.log.sort(
      (a, b) =>
        new Date(a.date) -
        new Date(b.date)
    );

    const subjects =
      [
        ...new Set(
          d.log.map(a => a.subject)
        )
      ];

    const sev =
      getSeverity(d.total);

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

    let body =
      buildReportHeaderHTML(
        L.certTitle,
        ''
      );

    body += `
      <div style="
        background:#f8f9ff;
        border:1px solid #d0d7ff;
        border-radius:10px;
        padding:16px 20px;
        margin-bottom:20px;
        page-break-inside:avoid;
        break-inside:avoid;
      ">

        <div style="
          font-size:16px;
          font-weight:700;
          color:#333;
          margin-bottom:7px;
          line-height:1.5;
        ">
          👤 ${escapeHtml(name)}
        </div>

        <div style="
          font-size:13px;
          color:#555;
          line-height:1.9;
        ">
          <strong>
            ${escapeHtml(L.profileClass)}
          </strong>:
          ${escapeHtml(d.cls || '—')}
          <br>

          <strong>
            ${escapeHtml(L.profileTotal)}
          </strong>:
          <span style="
            color:${statusColor};
            font-weight:700;
          ">
            ${escapeHtml(d.total)}
          </span>

          &nbsp;&nbsp;

          <strong>
            ${escapeHtml(
              L.colStatus || 'Status'
            )}
          </strong>:
          <span style="
            color:${statusColor};
            font-weight:700;
          ">
            ${escapeHtml(statusText)}
          </span>

          <br>

          <strong>
            ${escapeHtml(L.profileSubjects)}
          </strong>:
          ${escapeHtml(
            subjects.join(', ') || '—'
          )}

          <br>

          <strong>
            ${escapeHtml(L.profileEntries)}
          </strong>:
          ${escapeHtml(d.log.length)}
        </div>
      </div>

      <h3 style="
        color:#667eea;
        font-size:14px;
        margin:0 0 8px;
        line-height:1.5;
      ">
        ${escapeHtml(L.profileHistory)}
      </h3>
    `;

    const headers = [
      L.colDate,
      L.colLecture,
      L.colSubject,
      L.colTeacher
    ];

    const rows =
      d.log.map(a => [
        a.date,
        a.lecture,
        a.subject,
        a.teacher
      ]);

    body += rows.length
      ? buildSimpleTableHTML(
          headers,
          rows
        )
      : buildEmptyStateHTML(
          L.noAbsences
        );

    body += `
      <div style="
        margin-top:50px;
        display:flex;
        justify-content:space-between;
        gap:40px;
        page-break-inside:avoid;
        break-inside:avoid;
      ">

        <div style="
          flex:1;
          min-width:0;
        ">
          <div style="
            border-top:1.5px solid #333;
            padding-top:6px;
            font-size:12px;
            color:#555;
          ">
            ${escapeHtml(L.certSignature)}
          </div>
        </div>

        <div style="
          flex:1;
          min-width:0;
        ">
          <div style="
            border-top:1.5px solid #333;
            padding-top:6px;
            font-size:12px;
            color:#555;
          ">
            ${escapeHtml(L.certDate)}:
            _______________
          </div>
        </div>

      </div>
    `;

    body +=
      buildReportFooterHTML();

    await renderHtmlToPDF(
      body,
      `Certificate_${sanitizeFileName(
        name,
        'Student'
      )}.pdf`
    );

  } catch (error) {
    handlePDFExportError(error);
  }
}


// ══════════════════════════════════════════════════════════════════════
// END OF reports.js
// ══════════════════════════════════════════════════════════════════════
```
