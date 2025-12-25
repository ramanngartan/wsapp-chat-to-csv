const express = require("express");
const path = require("path");
const multer = require("multer");

const app = express();
const PORT = process.env.PORT || 3000;

/* -------------------- Static -------------------- */
app.use(express.static(__dirname));

/* -------------------- Upload -------------------- */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

/* -------------------- Temp Storage -------------------- */
const downloads = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [id, item] of downloads.entries()) {
    if (now - item.createdAt > 10 * 60 * 1000) {
      downloads.delete(id);
    }
  }
}, 10 * 60 * 1000);

/* -------------------- Helpers -------------------- */
function escapeCsv(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function toCsv(rows) {
  const header = ["date", "time", "sender", "message"];
  const lines = [header.map(escapeCsv).join(",")];

  for (const r of rows) {
    lines.push(
      [r.date, r.time, r.sender, r.message].map(escapeCsv).join(",")
    );
  }
  return lines.join("\n");
}

function parseWhatsAppTxt(text) {
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    const rows = [];
  
    // Removes common invisible marks WhatsApp inserts (LTR/RTL marks, BOM),
    // and normalizes narrow no-break spaces to regular spaces.
    function normalizeLine(s) {
      return s
        .replace(/\u202F/g, " ") // narrow no-break space (often between seconds and PM)
        .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "") // direction/BOM
        .trimEnd();
    }
  
    // Format A (your current):
    // [11:10 p.m., 2025-11-16] Name: Message
    const bracketTimeDateRe =
      /^\[(\d{1,2}:\d{2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm)?)\s*,\s*(\d{4}-\d{2}-\d{2})\]\s*(.*)$/i;
  
    // Format B (the one you want):
    // [2023-07-07, 10:00:20 PM] Name: Message
    const bracketDateTimeRe =
      /^\[(\d{4}-\d{2}-\d{2})\s*,\s*(\d{1,2}:\d{2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?|am|pm)?)\]\s*(.*)$/i;
  
    // Legacy WhatsApp format:
    // 12/03/24, 9:41 pm - Name: Message
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
        // Split "Sender: Message" (message can be empty)
        const idx = rest.indexOf(":");
        let sender = "";
        let message = rest;
  
        if (idx !== -1) {
          sender = rest.slice(0, idx).trim();
          message = rest.slice(idx + 1).trimStart();
        } else {
          // system line with no explicit sender
          sender = "";
          message = rest.trim();
        }
  
        rows.push({ date, time, sender, message });
      } else {
        // Continuation line (multiline)
        if (rows.length > 0) {
          rows[rows.length - 1].message += "\n" + line;
        } else {
          rows.push({ date: "", time: "", sender: "", message: line });
        }
      }
    }
  
    return rows;
}
  
/* -------------------- Routes -------------------- */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.post("/upload", upload.single("chatFile"), (req, res) => {
  if (!req.file) return res.status(400).send("No file uploaded.");

  if (!req.file.originalname.endsWith(".txt")) {
    return res.status(400).send("Please upload a .txt file.");
  }

  const rows = parseWhatsAppTxt(req.file.buffer.toString("utf8"));
  if (!rows.length) {
    return res.status(400).send("Unsupported WhatsApp format.");
  }

  const csv = toCsv(rows);
  const id = Math.random().toString(36).slice(2);
  const filename =
    req.file.originalname.replace(/\.txt$/, "") +
    "-" +
    new Date().toISOString().slice(0, 10) +
    ".csv";

  downloads.set(id, {
    csv,
    filename,
    createdAt: Date.now(),
  });

  res.send(`
    <!doctype html>
    <html>
    <head>
      <meta charset="utf-8" />
      <link rel="stylesheet" href="/styles.css" />
      <title>Done</title>
    </head>
    <body>
      <main class="card">
        <h1>Done</h1>
        <p class="sub">Parsed <b>${rows.length}</b> messages.</p>
        <p class="note">File: <b>${filename}</b></p>
        <a class="btn" href="/download/${id}">Download CSV</a>
        <a class="link" href="/">Convert another file</a>
      </main>
    </body>
    </html>
  `);
});

app.get("/download/:id", (req, res) => {
  const item = downloads.get(req.params.id);

  res.setHeader("Cache-Control", "no-store");

  if (!item) {
    return res.sendFile(
      path.join(__dirname, "expired.html"),
      (err) => {
        if (err) {
          // Fallback if file doesn't exist
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
                <p class="note">Download links are valid for 10 minutes and can only be used once.</p>
                <a class="btn" href="/">Convert another file</a>
              </main>
            </body>
            </html>
          `);
        }
      }
    );
  }

  downloads.delete(req.params.id);

  res.setHeader("Content-Type", "text/csv");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${item.filename}"`
  );
  res.send(item.csv);
});

/* -------------------- Errors -------------------- */
app.use((err, req, res, next) => {
  if (err?.code === "LIMIT_FILE_SIZE") {
    return res.status(400).send("File too large (max 5MB).");
  }
  console.error(err);
  res.status(500).send("Something went wrong.");
});

/* -------------------- Start -------------------- */
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
