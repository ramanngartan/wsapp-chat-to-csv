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

  const bracketRe =
    /^\[(\d{1,2}:\d{2}\s*(?:a\.?m\.?|p\.?m\.?|am|pm)?)\s*,\s*(\d{4}-\d{2}-\d{2})\]\s*(.*)$/i;

  const dashRe =
    /^(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}),\s*(\d{1,2}:\d{2}\s*(?:a\.?m\.?|p\.?m\.?|am|pm)?)\s*-\s*(.*)$/i;

  for (const line of lines) {
    if (!line.trim()) continue;

    let m = line.match(bracketRe) || line.match(dashRe);

    if (m) {
      const date = m[2] || m[1];
      const time = m[1];
      const rest = m[m.length - 1];

      const idx = rest.indexOf(":");
      const sender = idx !== -1 ? rest.slice(0, idx).trim() : "";
      const message = idx !== -1 ? rest.slice(idx + 1).trim() : rest.trim();

      rows.push({ date, time, sender, message });
    } else if (rows.length) {
      rows[rows.length - 1].message += "\n" + line;
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
    return res.sendFile(path.join(__dirname, "expired.html"));
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
