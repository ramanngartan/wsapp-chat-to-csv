// Elements
const input = document.getElementById("chatFile");
const fileName = document.getElementById("fileName");
const button = document.getElementById("convertBtn");
const form = document.getElementById("uploadForm");

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

// File name display
if (input) {
  input.addEventListener("change", () => {
    fileName.textContent =
      input.files && input.files[0]
        ? input.files[0].name
        : "Choose .txt or .zip file";
  });
}

// Form submission with progress
if (form) {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    
    if (!input.files || !input.files[0]) {
      alert("Please select a file");
      return;
    }

    button.disabled = true;
    button.textContent = "Converting…";
    
    const formData = new FormData();
    formData.append("chatFile", input.files[0]);

    try {
      const response = await fetch("/upload", {
        method: "POST",
        body: formData,
      });

      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        const text = await response.text();
        console.error("Non-JSON response:", text.substring(0, 200));
        throw new Error("Server returned an unexpected response. Please try again.");
      }

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Upload failed");
      }
      
      if (data.success) {
        // Redirect to preview page
        window.location.href = `/preview.html?id=${data.id}`;
      } else {
        throw new Error(data.error || "Conversion failed");
      }
    } catch (error) {
      console.error("Upload error:", error);
      alert("Error: " + error.message);
      button.disabled = false;
      button.textContent = "Convert";
    }
  });
}

// Footer year
const yearEl = document.getElementById("year");
if (yearEl) {
  yearEl.textContent = new Date().getFullYear();
}
