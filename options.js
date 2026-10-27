const $ = (selector) => document.querySelector(selector);

const createBlankProfile = () => ({
  id: Date.now() + Math.random().toString(36).slice(2, 6),
  name: "New Network",
  match: "",
  mode: "credentials",
  username: "",
  password: "",
  clickThrough: true,
  customUserSelector: "",
  customPassSelector: "",
  customSubmitSelector: "",
});

let profiles = [];

async function init() {
  const data = await chrome.storage.local.get([
    "profiles",
    "enabled",
    "checkInterval",
    "notifyMode",
    "autoCloseTab",
  ]);

  profiles = data.profiles && data.profiles.length ? data.profiles : [createBlankProfile()];
  $("#enabled").checked = data.enabled !== false;
  $("#autoCloseTab").checked = data.autoCloseTab !== false;
  $("#checkInterval").value = data.checkInterval || "5";
  $("#notifyMode").value = data.notifyMode || "all";

  renderProfiles();
  loadLogs();
}

function renderProfiles() {
  const container = $("#profiles-container");
  container.innerHTML = "";

  profiles.forEach((p, index) => {
    const card = document.createElement("div");
    card.className = "card profile-card";

    // Header with profile title & delete button
    const header = document.createElement("div");
    header.className = "profile-header";
    header.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px;">
        <span class="profile-badge">#${index + 1}</span>
        <strong>${escapeHtml(p.name || "Default Network")}</strong>
      </div>
    `;

    const delBtn = document.createElement("button");
    delBtn.className = "danger small";
    delBtn.textContent = "Remove";
    delBtn.addEventListener("click", () => {
      profiles.splice(index, 1);
      if (profiles.length === 0) profiles.push(createBlankProfile());
      renderProfiles();
    });
    header.appendChild(delBtn);
    card.appendChild(header);

    // Profile Name & Match Domain
    const row1 = document.createElement("div");
    row1.className = "grid-2";
    row1.innerHTML = `
      <div>
        <label>Profile Name / Label</label>
        <input type="text" class="input-name" value="${escapeHtml(p.name || "")}" placeholder="e.g. University Wi-Fi, Hotel Guest">
      </div>
      <div>
        <label>Portal Address / Domain Contains (Optional)</label>
        <input type="text" class="input-match" value="${escapeHtml(p.match || "")}" placeholder="e.g. campus.edu (leave empty for any portal)">
      </div>
    `;
    card.appendChild(row1);

    // Auth Mode Selector
    const modeWrap = document.createElement("div");
    modeWrap.style.marginTop = "10px";
    modeWrap.innerHTML = `
      <label>Authentication Mode</label>
      <select class="input-mode">
        <option value="credentials" ${p.mode !== "clickthrough" ? "selected" : ""}>Username &amp; Password</option>
        <option value="clickthrough" ${p.mode === "clickthrough" ? "selected" : ""}>Click-Through / Free Wi-Fi (No Password)</option>
      </select>
    `;
    card.appendChild(modeWrap);

    // Credentials Section
    const credsWrap = document.createElement("div");
    credsWrap.className = "grid-2";
    credsWrap.style.marginTop = "10px";
    if (p.mode === "clickthrough") credsWrap.style.display = "none";

    credsWrap.innerHTML = `
      <div>
        <label>Username / Email / Roll Number</label>
        <input type="text" class="input-user" autocomplete="off" value="${escapeHtml(p.username || "")}">
      </div>
      <div>
        <label>Password / Access Passphrase</label>
        <div class="input-with-toggle">
          <input type="password" class="input-pass" autocomplete="off" value="${escapeHtml(p.password || "")}">
          <button type="button" class="toggle-pwd-btn">Show</button>
        </div>
      </div>
    `;
    card.appendChild(credsWrap);

    // Terms & Connect Row
    const ctRow = document.createElement("div");
    ctRow.className = "row";
    ctRow.innerHTML = `
      <input type="checkbox" id="ct-${index}" class="input-ct" ${p.clickThrough ? "checked" : ""}>
      <label for="ct-${index}">Auto-accept Terms of Service checkboxes &amp; click Connect</label>
    `;
    card.appendChild(ctRow);

    // Advanced CSS Selectors Collapsible
    const advToggle = document.createElement("button");
    advToggle.type = "button";
    advToggle.className = "collapsible-trigger";
    advToggle.textContent = "+ Advanced CSS Selectors (For Custom/Tricky Portals)";

    const advContent = document.createElement("div");
    advContent.className = "collapsible-content";
    advContent.innerHTML = `
      <div class="hint" style="margin-bottom:8px;">Override automated field detection with explicit CSS selectors:</div>
      <div class="grid-2">
        <div>
          <label>Custom Username Selector</label>
          <input type="text" class="input-custom-user" value="${escapeHtml(p.customUserSelector || "")}" placeholder="#login-user">
        </div>
        <div>
          <label>Custom Password Selector</label>
          <input type="text" class="input-custom-pass" value="${escapeHtml(p.customPassSelector || "")}" placeholder="#login-pass">
        </div>
      </div>
      <div style="margin-top:8px;">
        <label>Custom Submit Button Selector</label>
        <input type="text" class="input-custom-submit" value="${escapeHtml(p.customSubmitSelector || "")}" placeholder="button.btn-connect">
      </div>
    `;

    advToggle.addEventListener("click", () => {
      const isOpen = advContent.classList.toggle("open");
      advToggle.textContent = isOpen ? "- Hide Advanced CSS Selectors" : "+ Advanced CSS Selectors (For Custom/Tricky Portals)";
    });

    card.appendChild(advToggle);
    card.appendChild(advContent);

    // Event Listeners for inputs
    const nameInput = card.querySelector(".input-name");
    nameInput.addEventListener("input", (e) => {
      p.name = e.target.value;
      header.querySelector("strong").textContent = p.name || "Default Network";
    });

    const matchInput = card.querySelector(".input-match");
    matchInput.addEventListener("input", (e) => { p.match = e.target.value; });

    const modeSelect = card.querySelector(".input-mode");
    modeSelect.addEventListener("change", (e) => {
      p.mode = e.target.value;
      credsWrap.style.display = p.mode === "clickthrough" ? "none" : "grid";
    });

    const userInput = card.querySelector(".input-user");
    userInput.addEventListener("input", (e) => { p.username = e.target.value; });

    const passInput = card.querySelector(".input-pass");
    passInput.addEventListener("input", (e) => { p.password = e.target.value; });

    const toggleBtn = card.querySelector(".toggle-pwd-btn");
    toggleBtn.addEventListener("click", () => {
      if (passInput.type === "password") {
        passInput.type = "text";
        toggleBtn.textContent = "Hide";
      } else {
        passInput.type = "password";
        toggleBtn.textContent = "Show";
      }
    });

    const ctCheckbox = card.querySelector(".input-ct");
    ctCheckbox.addEventListener("change", (e) => { p.clickThrough = e.target.checked; });

    const customUserInput = card.querySelector(".input-custom-user");
    customUserInput.addEventListener("input", (e) => { p.customUserSelector = e.target.value; });

    const customPassInput = card.querySelector(".input-custom-pass");
    customPassInput.addEventListener("input", (e) => { p.customPassSelector = e.target.value; });

    const customSubmitInput = card.querySelector(".input-custom-submit");
    customSubmitInput.addEventListener("input", (e) => { p.customSubmitSelector = e.target.value; });

    container.appendChild(card);
  });
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Add Profile Button
$("#add-profile-btn").addEventListener("click", () => {
  profiles.push(createBlankProfile());
  renderProfiles();
  window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
});

// Save Settings
$("#save-btn").addEventListener("click", async () => {
  const cleanedProfiles = profiles.map((p) => ({
    name: (p.name || "").trim(),
    match: (p.match || "").trim().toLowerCase(),
    mode: p.mode || "credentials",
    username: (p.username || "").trim(),
    password: p.password || "",
    clickThrough: !!p.clickThrough,
    customUserSelector: (p.customUserSelector || "").trim(),
    customPassSelector: (p.customPassSelector || "").trim(),
    customSubmitSelector: (p.customSubmitSelector || "").trim(),
  }));

  await chrome.storage.local.set({
    profiles: cleanedProfiles,
    enabled: $("#enabled").checked,
    autoCloseTab: $("#autoCloseTab").checked,
    checkInterval: parseInt($("#checkInterval").value, 10) || 5,
    notifyMode: $("#notifyMode").value || "all",
    fails: { count: 0, last: 0 },
  });

  const indicator = $("#saved-indicator");
  indicator.classList.add("show");
  setTimeout(() => indicator.classList.remove("show"), 2000);
});

// Export Profiles
$("#export-btn").addEventListener("click", () => {
  const exportData = {
    app: "wifi-portal-auto-login",
    version: "2.0.0",
    exportDate: new Date().toISOString(),
    profiles,
  };
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `wifi-portal-profiles-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

// Import Profiles
$("#import-btn").addEventListener("click", () => $("#import-file").click());
$("#import-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (Array.isArray(data.profiles) && data.profiles.length) {
      profiles = data.profiles;
      renderProfiles();
      alert(`Successfully imported ${profiles.length} profiles. Click 'Save Changes' to apply.`);
    } else {
      alert("Invalid profile file format.");
    }
  } catch (err) {
    alert("Could not read backup file: " + err.message);
  }
  e.target.value = "";
});

// Diagnostics & Live Activity Log
async function loadLogs() {
  const box = $("#log-box");
  try {
    const logs = await chrome.runtime.sendMessage({ type: "get-logs" });
    if (!logs || !logs.length) {
      box.textContent = "No recent activity recorded yet.";
      return;
    }

    box.innerHTML = logs
      .map((l) => {
        const timeStr = new Date(l.time).toLocaleTimeString();
        const typeClass = (l.type || "").toLowerCase();
        return `<div class="log-entry"><span class="log-time">[${timeStr}]</span> <span class="log-type ${typeClass}">${l.type.toUpperCase()}:</span> ${escapeHtml(l.message)}</div>`;
      })
      .join("");
  } catch {
    box.textContent = "Unable to fetch activity logs.";
  }
}

$("#refresh-logs-btn").addEventListener("click", loadLogs);

$("#copy-logs-btn").addEventListener("click", async () => {
  const box = $("#log-box");
  await navigator.clipboard.writeText(box.innerText);
  alert("Activity logs copied to clipboard!");
});

$("#clear-logs-btn").addEventListener("click", async () => {
  if (confirm("Clear all recent diagnostic logs?")) {
    await chrome.runtime.sendMessage({ type: "clear-logs" });
    loadLogs();
  }
});

init();
