const express = require("express");
const path = require("path");
const multer = require("multer");

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(__dirname));

// Multer setup (store file in memory)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB for MVP
});
  
// In-memory cache for downloads (MVP)
const downloads = new Map();

// Cleanup old downloads every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of downloads.entries()) {
    if (now - value.createdAt > 10 * 60 * 1000) downloads.delete(key);
  }
}, 10 * 60 * 1000);


function escapeCsv(value) {
  const s = String(value ?? "");
  // Wrap in quotes, double any quotes inside
  return `"${s.replace(/"/g, '""')}"`;
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
  
    // Supports:
    // [11:10 p.m., 2025-11-16] Name: Message
    // Also tolerates extra spaces and a.m./p.m. variations
    const bracketRe =
      /^\[(\d{1,2}:\d{2}\s*(?:a\.?m\.?|p\.?m\.?|am|pm)?)\s*,\s*(\d{4}-\d{2}-\d{2})\]\s*(.*)$/i;
  
    // Legacy WhatsApp format (keep it, for other users):
    // 12/03/24, 9:41 pm - Name: Message
    const dashRe =
      /^(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}),\s*(\d{1,2}:\d{2}\s*(?:a\.?m\.?|p\.?m\.?|am|pm)?)\s*-\s*(.*)$/i;
  
    for (const line of lines) {
      if (!line.trim()) continue;
  
      let date = "";
      let time = "";
      let rest = "";
  
      let m = line.match(bracketRe);
      if (m) {
        time = m[1].trim();
        date = m[2].trim();
        rest = m[3];
      } else {
        m = line.match(dashRe);
        if (m) {
          date = m[1].trim();
          time = m[2].trim();
          rest = m[3];
        }
      }
  
      if (m) {
        // Split "Sender: Message" (message can be empty)
        const idx = rest.indexOf(":");
        let sender = "";
        let message = rest;
  
        if (idx !== -1) {
          sender = rest.slice(0, idx).trim();
          // allow empty message after colon
          message = rest.slice(idx + 1).trimStart();
          if (message.startsWith(" ")) message = message.slice(1);
        } else {
          // system message / no sender
          sender = "";
          message = rest.trim();
        }
  
        rows.push({ date, time, sender, message });
      } else {
        // Continuation line (multiline bullets, paragraphs, etc.)
        if (rows.length > 0) {
          rows[rows.length - 1].message += "\n" + line;
        } else {
          rows.push({ date: "", time: "", sender: "", message: line });
        }
      }
    }
  
    return rows;
  }
  

// Home
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Upload → Convert → Download CSV
app.post("/upload", upload.single("chatFile"), (req, res) => {
  if (!req.file) return res.status(400).send("No file uploaded.");

  if (!req.file.originalname.toLowerCase().endsWith(".txt")) {
    return res.status(400).send("Please upload a .txt WhatsApp export file.");
  }

  const txt = req.file.buffer.toString("utf8");
  const rows = parseWhatsAppTxt(txt);
  if (!rows.length) {
    return res.status(400).send("Could not detect WhatsApp message format in this file.");
  }
  const csv = toCsv(rows);

  const stamp = new Date().toISOString().slice(0, 10);
  const baseName = (req.file.originalname || "whatsapp-chat.txt").replace(/\.txt$/i, "");
  const outName = `${baseName}-${stamp}.csv`;

    // Store CSV temporarily
    const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    downloads.set(id, { csv, filename: outName, createdAt: Date.now() });
  
    // Show success page + auto-download once
    return res.send(`
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>Done</title>
          <link rel="stylesheet" href="/styles.css" />
        </head>
        <body>
          <main class="card">
            <h1>Done</h1>
            <p class="sub">Parsed <b>${rows.length}</b> messages.</p>
            <p class="note">File: <b>${outName}</b></p>
  
            <a class="btn" href="/download/${id}">Download CSV</a>
            <a class="link" href="/">Convert another file</a>
  
          </main>
        </body>
      </html>
    `);
  
});

// Friendly error handler (ex: file too large)
app.use((err, req, res, next) => {
    if (err && err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).send("File too large. Max 5MB for now.");
    }
    console.error(err);
    return res.status(500).send("Something went wrong. Please try again.");
});
  
app.get("/download/:id", (req, res) => {
    const id = req.params.id;
    const item = downloads.get(id);
  
    // Prevent browser caching (this fixes "download works twice")
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  
    if (!item) {
      return res.status(404).send(`
        <!doctype html>
        <html>
          <head>
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            <title>Expired</title>
            <link rel="stylesheet" href="/styles.css" />
          </head>
          <body>
            <main class="card">
              <h1>Download expired</h1>
              <p class="sub">Please convert the file again.</p>
              <a class="btn" href="/">Convert a file</a>
            </main>
          </body>
        </html>
      `);
    }
  
    // One-time link
    downloads.delete(id);
  
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${item.filename}"`);
    return res.send(item.csv);
});
  

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
