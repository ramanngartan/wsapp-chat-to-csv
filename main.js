// Elements
const input = document.getElementById("chatFile");
const fileName = document.getElementById("fileName");
const button = document.getElementById("convertBtn");
const form = document.getElementById("uploadForm");

// File name display
input.addEventListener("change", () => {
  fileName.textContent =
    input.files && input.files[0]
      ? input.files[0].name
      : "Choose .txt file";
});

// Disable button on submit
form.addEventListener("submit", () => {
  button.disabled = true;
  button.textContent = "Converting…";
});

// Footer year
document.getElementById("year").textContent =
  new Date().getFullYear();
