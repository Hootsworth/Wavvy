const $ = (selector) => document.querySelector(selector);

function updateStatusDisplay(status, enabled = true) {
  const ring = $("#status-ring");
  const text = $("#status-text");
  const subtext = $("#status-subtext");

  if (!enabled) {
    ring.className = "indicator-ring disabled";
    text.textContent = "Auto-Login Paused";
    subtext.textContent = "Disabled in settings or popup toggle";
    return;
  }

  if (!status) {
    ring.className = "indicator-ring";
    text.textContent = "Unknown Status";
    subtext.textContent = "Click Check & Connect to probe";
    return;
  }

  ring.className = `indicator-ring ${status.state || ""}`;
  text.textContent = status.text || status.state;

  const timeStr = status.time ? new Date(status.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
  const latencyStr = status.latency ? ` • ${status.latency}ms latency` : "";
  subtext.textContent = timeStr ? `Updated ${timeStr}${latencyStr}` : "Ready";
}

function updateActivityFeed(logs = []) {
  const box = $("#activity-box");
  if (!logs || !logs.length) {
    box.innerHTML = `<div class="feed-item"><span class="feed-text" style="color:var(--muted)">No recent events recorded</span></div>`;
    return;
  }

  const recent = logs.slice(0, 3);
  box.innerHTML = recent
    .map((item) => {
      const time = new Date(item.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      return `
        <div class="feed-item">
          <span class="feed-text" title="${escapeHtml(item.message)}">${escapeHtml(item.message)}</span>
          <span class="feed-time">${time}</span>
        </div>
      `;
    })
    .join("");
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

async function loadState() {
  const data = await chrome.storage.local.get(["status", "enabled", "profiles", "logs"]);
  const isEnabled = data.enabled !== false;
  $("#enabled-toggle").checked = isEnabled;

  const profilesCount = (data.profiles || []).length;
  $("#profiles-count").textContent = `${profilesCount} ${profilesCount === 1 ? "profile" : "profiles"} configured`;

  updateStatusDisplay(data.status, isEnabled);
  updateActivityFeed(data.logs);
}

// Toggle enabled/disabled
$("#enabled-toggle").addEventListener("change", async (e) => {
  const enabled = e.target.checked;
  await chrome.storage.local.set({ enabled });
  const { status } = await chrome.storage.local.get("status");
  updateStatusDisplay(status, enabled);
});

// Manual Check & Connect
$("#check-btn").addEventListener("click", async () => {
  const btn = $("#check-btn");
  btn.disabled = true;
  const originalText = btn.innerHTML;
  btn.innerHTML = `Connecting...`;

  updateStatusDisplay({ state: "working", text: "Probing network & portals..." }, true);

  try {
    const result = await chrome.runtime.sendMessage({ type: "check-now" });
    const { enabled = true } = await chrome.storage.local.get("enabled");
    updateStatusDisplay(result, enabled);

    const logs = await chrome.runtime.sendMessage({ type: "get-logs" });
    updateActivityFeed(logs);
  } catch (err) {
    updateStatusDisplay({ state: "failed", text: "Check failed: " + err.message }, true);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
});

// Open Settings Page
$("#open-settings-link").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

// Real-time updates while popup is open
chrome.storage.onChanged.addListener((changes) => {
  if (changes.status || changes.enabled) {
    loadState();
  }
  if (changes.logs) {
    updateActivityFeed(changes.logs.newValue);
  }
});

loadState();
