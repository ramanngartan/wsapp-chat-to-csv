// Get session ID from URL
const urlParams = new URLSearchParams(window.location.search);
const sessionId = urlParams.get("id");

if (!sessionId) {
  window.location.href = "/";
}

let currentData = null;
let currentFilters = {};
let selectedColumns = ["date", "time", "sender", "message"];

const availableColumns = [
  { id: "date", label: "Date" },
  { id: "time", label: "Time" },
  { id: "sender", label: "Sender" },
  { id: "message", label: "Message" },
  { id: "messageLength", label: "Message Length" },
  { id: "wordCount", label: "Word Count" },
  { id: "dayOfWeek", label: "Day of Week" },
  { id: "hour", label: "Hour" },
  { id: "mediaCount", label: "Media Count" },
  { id: "mediaFiles", label: "Media Files" },
];

// Theme toggle
const themeToggle = document.getElementById("themeToggle");
let currentTheme = localStorage.getItem("theme") || "dark";

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("theme", theme);
  if (themeToggle) {
    themeToggle.textContent = theme === "dark" ? "☀️" : "🌙";
  }
}

if (themeToggle) {
  themeToggle.addEventListener("click", () => {
    currentTheme = currentTheme === "dark" ? "light" : "dark";
    applyTheme(currentTheme);
  });
}

applyTheme(currentTheme);

// Load data
async function loadData() {
  try {
    const response = await fetch(`/api/data/${sessionId}`);
    if (!response.ok) {
      if (response.status === 404) {
        alert("Session expired. Please upload your file again.");
        window.location.href = "/";
        return;
      }
      throw new Error("Failed to load data");
    }
    
    currentData = await response.json();
    displayStats(currentData.stats);
    populateSenderFilter(currentData.rows);
    setupColumns();
    displayPreview(currentData.rows);
  } catch (error) {
    alert("Error loading data: " + error.message);
    console.error(error);
  }
}

function displayStats(stats) {
  const grid = document.getElementById("statsGrid");
  grid.innerHTML = `
    <div class="stat-card">
      <div class="stat-value">${stats.totalMessages.toLocaleString()}</div>
      <div class="stat-label">Total Messages</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${stats.uniqueSenders}</div>
      <div class="stat-label">Unique Senders</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${stats.totalWords.toLocaleString()}</div>
      <div class="stat-label">Total Words</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${stats.averageMessageLength}</div>
      <div class="stat-label">Avg Message Length</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${stats.dateRange.start || "N/A"}</div>
      <div class="stat-label">Start Date</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${stats.dateRange.end || "N/A"}</div>
      <div class="stat-label">End Date</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${stats.mostActiveDayName || "N/A"}</div>
      <div class="stat-label">Most Active Day</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${stats.mostActiveHourValue || "N/A"}</div>
      <div class="stat-label">Most Active Hour</div>
    </div>
    ${stats.mediaCount > 0 ? `
    <div class="stat-card">
      <div class="stat-value">${stats.mediaCount}</div>
      <div class="stat-label">Media Files</div>
    </div>
    ` : ""}
  `;
}

function populateSenderFilter(rows) {
  const senders = [...new Set(rows.map(r => r.sender).filter(s => s))].sort();
  const select = document.getElementById("senderFilter");
  senders.forEach(sender => {
    const option = document.createElement("option");
    option.value = sender;
    option.textContent = sender;
    select.appendChild(option);
  });
}

function setupColumns() {
  const container = document.getElementById("columnsCheckboxes");
  container.innerHTML = availableColumns.map(col => `
    <label class="checkbox-label">
      <input type="checkbox" value="${col.id}" ${selectedColumns.includes(col.id) ? "checked" : ""} />
      ${col.label}
    </label>
  `).join("");
  
  container.querySelectorAll("input[type='checkbox']").forEach(cb => {
    cb.addEventListener("change", () => {
      selectedColumns = Array.from(container.querySelectorAll("input[type='checkbox']:checked"))
        .map(cb => cb.value);
    });
  });
}

function displayPreview(rows) {
  const head = document.getElementById("previewHead");
  const body = document.getElementById("previewBody");
  const note = document.getElementById("previewNote");
  
  const previewRows = rows.slice(0, 20);
  const columns = selectedColumns.filter(c => availableColumns.some(ac => ac.id === c));
  
  head.innerHTML = `<tr>${columns.map(c => `<th>${availableColumns.find(ac => ac.id === c)?.label || c}</th>`).join("")}</tr>`;
  body.innerHTML = previewRows.map(row => 
    `<tr>${columns.map(col => `<td>${escapeHtml(String(row[col] ?? ""))}</td>`).join("")}</tr>`
  ).join("");
  
  note.textContent = `Showing ${previewRows.length} of ${rows.length} messages`;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// Apply filters
document.getElementById("applyFilters").addEventListener("click", async () => {
  const filters = {
    sender: document.getElementById("senderFilter").value,
    dateFrom: document.getElementById("dateFrom").value,
    dateTo: document.getElementById("dateTo").value,
    keyword: document.getElementById("keywordFilter").value.trim(),
  };
  
  currentFilters = filters;
  
  try {
    const response = await fetch(`/api/filter/${sessionId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filters }),
    });
    
    if (!response.ok) throw new Error("Filter failed");
    
    const data = await response.json();
    displayStats(data.stats);
    displayPreview(data.rows);
  } catch (error) {
    alert("Error applying filters: " + error.message);
  }
});

// Clear filters
document.getElementById("clearFilters").addEventListener("click", () => {
  document.getElementById("senderFilter").value = "all";
  document.getElementById("dateFrom").value = "";
  document.getElementById("dateTo").value = "";
  document.getElementById("keywordFilter").value = "";
  currentFilters = {};
  loadData();
});

// Export
document.getElementById("exportBtn").addEventListener("click", () => {
  const format = document.getElementById("exportFormat").value;
  const delimiter = document.getElementById("csvDelimiter").value;
  const columns = selectedColumns.join(",");
  
  const params = new URLSearchParams({
    format,
    columns,
    delimiter,
    filters: JSON.stringify(currentFilters),
  });
  
  window.location.href = `/download/${sessionId}?${params.toString()}`;
});

// Initialize
loadData();

