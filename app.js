const express = require("express");
const path = require("path");
const multer = require("multer");
const AdmZip = require("adm-zip");
const ExcelJS = require("exceljs");

const app = express();
const PORT = process.env.PORT || 3000;

/* -------------------- Static -------------------- */
app.use(express.static(__dirname));
app.use(express.json());

/* -------------------- Upload -------------------- */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB (increased)
});

/* -------------------- Temp Storage -------------------- */
const downloads = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [id, item] of downloads.entries()) {
    if (now - item.createdAt > 30 * 60 * 1000) { // 30 minutes
      downloads.delete(id);
    }
  }
}, 10 * 60 * 1000);

/* -------------------- Helpers -------------------- */
function escapeCsv(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function normalizeDate(dateStr) {
  if (!dateStr) return "";
  
  // Try to parse various date formats
  // Format: YYYY-MM-DD (already normalized)
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }
  
  // Format: MM/DD/YY or MM/DD/YYYY
  const match = dateStr.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (match) {
    const [, month, day, year] = match;
    const fullYear = year.length === 2 ? (parseInt(year) < 50 ? `20${year}` : `19${year}`) : year;
    return `${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  
  return dateStr;
}

function normalizeTime(timeStr) {
  if (!timeStr) return "";
  
  // Already in HH:MM or HH:MM:SS format
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(timeStr)) {
    return timeStr;
  }
  
  // Parse 12-hour format with AM/PM
  const match = timeStr.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/i);
  if (match) {
    let [, hour, minute, second = "00", period] = match;
    hour = parseInt(hour);
    minute = minute.padStart(2, '0');
    second = second.padStart(2, '0');
    
    if (period && /pm|p\.m\./i.test(period) && hour !== 12) {
      hour += 12;
    } else if (period && /am|a\.m\./i.test(period) && hour === 12) {
      hour = 0;
    }
    
    return `${hour.toString().padStart(2, '0')}:${minute}:${second}`;
  }
  
  return timeStr;
}

function extractMediaReferences(message) {
  const mediaPatterns = [
    /<attached:\s*([^>]+)>/gi,
    /\[([^\]]+\.(jpg|jpeg|png|gif|mp4|avi|mov|pdf|doc|docx|zip|rar))\]/gi,
  ];
  
  const media = [];
  for (const pattern of mediaPatterns) {
    let match;
    while ((match = pattern.exec(message)) !== null) {
      media.push(match[1] || match[0]);
    }
  }
  
  return media;
}

function enrichRow(row) {
  const normalizedDate = normalizeDate(row.date);
  const normalizedTime = normalizeTime(row.time);
  const media = extractMediaReferences(row.message);
  
  // Parse datetime for additional fields
  let datetime = null;
  let dayOfWeek = "";
  let hour = "";
  let messageLength = row.message.length;
  let wordCount = row.message.trim() ? row.message.trim().split(/\s+/).length : 0;
  
  if (normalizedDate && normalizedTime) {
    try {
      const [hours, minutes] = normalizedTime.split(':');
      datetime = new Date(`${normalizedDate}T${hours}:${minutes}:00`);
      if (!isNaN(datetime.getTime())) {
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        dayOfWeek = days[datetime.getDay()];
        hour = hours;
      }
    } catch (e) {
      // Invalid date
    }
  }
  
  return {
    ...row,
    date: normalizedDate,
    time: normalizedTime,
    datetime: datetime ? datetime.toISOString() : "",
    dayOfWeek,
    hour: hour ? `${hour}:00` : "",
    messageLength,
    wordCount,
    mediaCount: media.length,
    mediaFiles: media.join('; '),
  };
}

function calculateStatistics(rows) {
  const stats = {
    totalMessages: rows.length,
    uniqueSenders: new Set(rows.map(r => r.sender).filter(s => s)).size,
    dateRange: { start: null, end: null },
    messagesPerSender: {},
    totalWords: 0,
    totalCharacters: 0,
    averageMessageLength: 0,
    mostActiveDay: {},
    mostActiveHour: {},
    mediaCount: 0,
  };
  
  const dates = [];
  const senders = {};
  
  for (const row of rows) {
    // Sender stats
    if (row.sender) {
      senders[row.sender] = (senders[row.sender] || 0) + 1;
    }
    
    // Date range
    if (row.date) {
      dates.push(row.date);
    }
    
    // Word and character counts
    stats.totalWords += row.wordCount || 0;
    stats.totalCharacters += row.messageLength || 0;
    
    // Day of week
    if (row.dayOfWeek) {
      stats.mostActiveDay[row.dayOfWeek] = (stats.mostActiveDay[row.dayOfWeek] || 0) + 1;
    }
    
    // Hour
    if (row.hour) {
      stats.mostActiveHour[row.hour] = (stats.mostActiveHour[row.hour] || 0) + 1;
    }
    
    // Media
    stats.mediaCount += row.mediaCount || 0;
  }
  
  stats.messagesPerSender = senders;
  stats.averageMessageLength = stats.totalMessages > 0 ? Math.round(stats.totalCharacters / stats.totalMessages) : 0;
  
  if (dates.length > 0) {
    dates.sort();
    stats.dateRange.start = dates[0];
    stats.dateRange.end = dates[dates.length - 1];
  }
  
  // Find most active day and hour
  stats.mostActiveDayName = Object.keys(stats.mostActiveDay).reduce((a, b) => 
    stats.mostActiveDay[a] > stats.mostActiveDay[b] ? a : b, "");
  stats.mostActiveHourValue = Object.keys(stats.mostActiveHour).reduce((a, b) => 
    stats.mostActiveHour[a] > stats.mostActiveHour[b] ? a : b, "");
  
  return stats;
}

function filterRows(rows, filters) {
  let filtered = [...rows];
  
  if (filters.sender && filters.sender !== "all") {
    filtered = filtered.filter(r => r.sender === filters.sender);
  }
  
  if (filters.dateFrom) {
    filtered = filtered.filter(r => r.date >= filters.dateFrom);
  }
  
  if (filters.dateTo) {
    filtered = filtered.filter(r => r.date <= filters.dateTo);
  }
  
  if (filters.keyword) {
    const keyword = filters.keyword.toLowerCase();
    filtered = filtered.filter(r => 
      r.message.toLowerCase().includes(keyword) || 
      r.sender.toLowerCase().includes(keyword)
    );
  }
  
  return filtered;
}

function toCsv(rows, columns = ["date", "time", "sender", "message"], delimiter = ",") {
  const lines = [columns.map(escapeCsv).join(delimiter)];
  
  for (const r of rows) {
    const values = columns.map(col => r[col] ?? "");
    lines.push(values.map(escapeCsv).join(delimiter));
  }
  return lines.join("\n");
}

async function toExcel(rows, columns = ["date", "time", "sender", "message"]) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("WhatsApp Chat");
  
  // Add headers
  worksheet.addRow(columns);
  
  // Style headers
  worksheet.getRow(1).font = { bold: true };
  worksheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF4F46E5' }
  };
  worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  
  // Add data
  for (const row of rows) {
    worksheet.addRow(columns.map(col => row[col] ?? ""));
  }
  
  // Auto-size columns
  worksheet.columns.forEach(column => {
    column.width = 15;
  });
  
  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
}

function toJson(rows) {
  return JSON.stringify(rows, null, 2);
}

function toHtml(rows, columns = ["date", "time", "sender", "message"]) {
  let html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>WhatsApp Chat Export</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #4f46e5; color: white; }
        tr:nth-child(even) { background-color: #f2f2f2; }
      </style>
    </head>
    <body>
      <h1>WhatsApp Chat Export</h1>
      <table>
        <thead>
          <tr>${columns.map(c => `<th>${c}</th>`).join("")}</tr>
        </thead>
        <tbody>
  `;
  
  for (const row of rows) {
    html += `<tr>${columns.map(col => `<td>${String(row[col] ?? "").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</td>`).join("")}</tr>`;
  }
  
  html += `
        </tbody>
      </table>
    </body>
    </html>
  `;
  
  return html;
}

function parseWhatsAppTxt(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const rows = [];

  function normalizeLine(s) {
    return s
      .replace(/\u202F/g, " ")
      .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "")
      .trimEnd();
  }

  const bracketTimeDateRe =
    /^\[(\d{1,2}:\d{2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm)?)\s*,\s*(\d{4}-\d{2}-\d{2})\]\s*(.*)$/i;

  const bracketDateTimeRe =
    /^\[(\d{4}-\d{2}-\d{2})\s*,\s*(\d{1,2}:\d{2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm)?)\]\s*(.*)$/i;

  const dashRe =
    /^(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}),\s*(\d{1,2}:\d{2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm)?)\s*-\s*(.*)$/i;

  for (let raw of lines) {
    if (!raw.trim()) continue;

    const line = normalizeLine(raw);

    let date = "";
    let time = "";
    let rest = "";

    let m = line.match(bracketTimeDateRe);
    if (m) {
      time = m[1].trim();
      date = m[2].trim();
      rest = m[3];
    } else {
      m = line.match(bracketDateTimeRe);
      if (m) {
        date = m[1].trim();
        time = m[2].trim();
        rest = m[3];
      } else {
        m = line.match(dashRe);
        if (m) {
          date = m[1].trim();
          time = m[2].trim();
          rest = m[3];
        }
      }
    }

    if (m) {
      const idx = rest.indexOf(":");
      let sender = "";
      let message = rest;

      if (idx !== -1) {
        sender = rest.slice(0, idx).trim();
        message = rest.slice(idx + 1).trimStart();
      } else {
        sender = "";
        message = rest.trim();
      }

      rows.push({ date, time, sender, message });
    } else {
      if (rows.length > 0) {
        rows[rows.length - 1].message += "\n" + line;
      } else {
        rows.push({ date: "", time: "", sender: "", message: line });
      }
    }
  }

  return rows.map(enrichRow);
}

/* -------------------- Routes -------------------- */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/preview.html", (req, res) => {
  res.sendFile(path.join(__dirname, "preview.html"));
});

app.post("/upload", (req, res, next) => {
  upload.single("chatFile")(req, res, (err) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ error: "File too large (max 50MB)." });
      }
      return res.status(400).json({ error: "Upload error: " + err.message });
    }
    next();
  });
}, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded." });

  const lowerName = req.file.originalname.toLowerCase();
  const isZip = lowerName.endsWith(".zip");
  const isTxt = lowerName.endsWith(".txt");

  if (!isZip && !isTxt) {
    return res.status(400).json({ error: "Please upload a .txt or .zip file." });
  }

  let allRows = [];
  let filesProcessed = 0;
  const fileErrors = [];

  try {
    if (isZip) {
      const zip = new AdmZip(req.file.buffer);
      const zipEntries = zip.getEntries();

      for (const entry of zipEntries) {
        if (entry.entryName.endsWith(".txt") && !entry.isDirectory) {
          try {
            const content = entry.getData().toString("utf8");
            const rows = parseWhatsAppTxt(content);
            if (rows.length > 0) {
              allRows = allRows.concat(rows);
              filesProcessed++;
            }
          } catch (err) {
            fileErrors.push({ file: entry.entryName, error: err.message });
            console.error(`Error processing ${entry.entryName}:`, err.message);
          }
        }
      }

      if (filesProcessed === 0) {
        return res.status(400).json({ 
          error: "No valid .txt files found in the zip archive.",
          fileErrors 
        });
      }
    } else {
      const rows = parseWhatsAppTxt(req.file.buffer.toString("utf8"));
      if (!rows.length) {
        return res.status(400).json({ error: "Unsupported WhatsApp format." });
      }
      allRows = rows;
      filesProcessed = 1;
    }

    if (!allRows.length) {
      return res.status(400).json({ error: "No messages found in the file(s)." });
    }

    const stats = calculateStatistics(allRows);
    const id = Math.random().toString(36).slice(2);
    const baseName = req.file.originalname.replace(/\.(txt|zip)$/, "");

    downloads.set(id, {
      rows: allRows,
      stats,
      baseName,
      filesProcessed,
      fileErrors,
      createdAt: Date.now(),
    });

    res.json({
      success: true,
      id,
      stats,
      preview: allRows.slice(0, 20),
      totalRows: allRows.length,
      filesProcessed,
      fileErrors: fileErrors.length > 0 ? fileErrors : undefined,
    });
  } catch (err) {
    console.error("Upload error:", err);
    return res.status(500).json({ error: "Error processing file: " + err.message });
  }
});

app.post("/api/filter/:id", (req, res) => {
  const item = downloads.get(req.params.id);
  if (!item) {
    return res.status(404).json({ error: "Session expired." });
  }

  const filtered = filterRows(item.rows, req.body.filters || {});
  const stats = calculateStatistics(filtered);

  res.json({
    rows: filtered,
    stats,
    preview: filtered.slice(0, 20),
  });
});

app.get("/api/data/:id", (req, res) => {
  const item = downloads.get(req.params.id);
  if (!item) {
    return res.status(404).json({ error: "Session expired." });
  }

  const filters = req.query.filters ? JSON.parse(req.query.filters) : {};
  const filtered = filterRows(item.rows, filters);
  const columns = req.query.columns ? req.query.columns.split(",") : ["date", "time", "sender", "message"];

  res.json({
    rows: filtered,
    columns,
    stats: calculateStatistics(filtered),
  });
});

app.get("/download/:id", async (req, res) => {
  const item = downloads.get(req.params.id);
  res.setHeader("Cache-Control", "no-store");

  if (!item) {
    return res.sendFile(
      path.join(__dirname, "expired.html"),
      (err) => {
        if (err) {
          res.status(404).send(`
            <!doctype html>
            <html>
            <head>
              <meta charset="utf-8" />
              <link rel="stylesheet" href="/styles.css" />
              <title>Download Expired</title>
            </head>
            <body>
              <main class="card">
                <h1>Download Expired</h1>
                <p class="sub">This download link has expired or has already been used.</p>
                <p class="note">Download links are valid for 30 minutes and can only be used once.</p>
                <a class="btn" href="/">Convert another file</a>
              </main>
            </body>
            </html>
          `);
        }
      }
    );
  }

  const format = req.query.format || "csv";
  const filters = req.query.filters ? JSON.parse(req.query.filters) : {};
  const columns = req.query.columns ? req.query.columns.split(",") : ["date", "time", "sender", "message"];
  const delimiter = req.query.delimiter || ",";
  
  const filtered = filterRows(item.rows, filters);
  const baseName = item.baseName || "chat";

  let content, filename, contentType;

  try {
    switch (format) {
      case "json":
        content = toJson(filtered);
        filename = `${baseName}.json`;
        contentType = "application/json";
        break;
      
      case "excel":
      case "xlsx":
        const buffer = await toExcel(filtered, columns);
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="${baseName}.xlsx"`);
        return res.send(buffer);
      
      case "html":
        content = toHtml(filtered, columns);
        filename = `${baseName}.html`;
        contentType = "text/html";
        break;
      
      case "csv":
      default:
        content = toCsv(filtered, columns, delimiter);
        filename = `${baseName}.csv`;
        contentType = "text/csv";
        break;
    }

    downloads.delete(req.params.id);

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(content);
  } catch (err) {
    console.error("Export error:", err);
    res.status(500).json({ error: "Error generating export: " + err.message });
  }
});

/* -------------------- Errors -------------------- */
app.use((err, req, res, next) => {
  if (err?.code === "LIMIT_FILE_SIZE") {
    return res.status(400).json({ error: "File too large (max 50MB)." });
  }
  console.error(err);
  res.status(500).json({ error: "Something went wrong." });
});

/* -------------------- Start -------------------- */
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});

