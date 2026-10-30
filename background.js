// Wavvy - Wi-Fi Captive Portal Auto Login (Manifest V3)
// Multi-probe detection, iframe traversal, reactive framework support & adaptive alarms.

const PROBE_ENDPOINTS = [
  { url: "http://connectivitycheck.gstatic.com/generate_204", type: "status204" },
  { url: "http://cp.cloudflare.com/generate_204", type: "status204" },
  { url: "http://captive.apple.com/hotspot-detect.html", type: "appleText" },
  { url: "http://www.msftconnecttest.com/connecttest.txt", type: "msftText" },
];

const ALARM_NAME = "wifi-portal-check";
const MAX_LOGS = 60;
const LOCK_TTL_MS = 60000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------- Lifecycle & Event Listeners ----------

chrome.runtime.onInstalled.addListener(async (details) => {
  await logEvent("installed", `Extension ${details.reason} (v${chrome.runtime.getManifest().version})`);
  await setupAlarm(1);
  check("install", true);
});

chrome.runtime.onStartup.addListener(async () => {
  await logEvent("startup", "Browser started");
  await setupAlarm(1);
  check("startup");
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    check("alarm");
  }
});

chrome.idle.onStateChanged.addListener((state) => {
  if (state === "active") {
    logEvent("wake", "Device unlocked / active");
    check("wake");
  }
});

// Trigger check when a user visits a page and gets blocked by DNS/network errors
if (chrome.webNavigation && chrome.webNavigation.onErrorOccurred) {
  let lastNavCheck = 0;
  chrome.webNavigation.onErrorOccurred.addListener((details) => {
    if (details.frameId !== 0) return;
    const err = details.error || "";
    if (
      err.includes("ERR_INTERNET_DISCONNECTED") ||
      err.includes("ERR_NAME_NOT_RESOLVED") ||
      err.includes("ERR_CONNECTION_RESET") ||
      err.includes("ERR_NETWORK_CHANGED")
    ) {
      const now = Date.now();
      if (now - lastNavCheck > 15000) {
        lastNavCheck = now;
        logEvent("nav-error", `Network error encountered: ${err}`);
        check("nav-error");
      }
    }
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || !msg.type) return;

  if (msg.type === "check-now") {
    check("manual", true).then(sendResponse);
    return true; // Keep message channel open for async response
  }

  if (msg.type === "get-logs") {
    chrome.storage.local.get("logs").then(({ logs = [] }) => sendResponse(logs));
    return true;
  }

  if (msg.type === "clear-logs") {
    chrome.storage.local.set({ logs: [] }).then(() => sendResponse(true));
    return true;
  }
});

// ---------- Alarm & Battery Optimization ----------

async function setupAlarm(periodMinutes) {
  try {
    const existing = await chrome.alarms.get(ALARM_NAME);
    if (!existing || existing.periodInMinutes !== periodMinutes) {
      await chrome.alarms.create(ALARM_NAME, {
        periodInMinutes: Math.max(1, periodMinutes),
        delayInMinutes: 0.2,
      });
    }
  } catch (err) {
    console.warn("Alarm setup warning:", err);
  }
}

async function updateAdaptiveAlarm(state) {
  const { checkInterval = 5 } = await chrome.storage.local.get("checkInterval");
  if (state === "online") {
    // Battery saver mode: probe less frequently when connection is healthy
    await setupAlarm(Number(checkInterval) || 5);
  } else {
    // Portal or offline: check rapidly to detect network reconnection or captive gate
    await setupAlarm(1);
  }
}

// ---------- Logging & Notifications ----------

async function logEvent(type, message, extra = null) {
  try {
    const { logs = [] } = await chrome.storage.local.get("logs");
    const entry = {
      id: Date.now() + Math.random().toString(36).slice(2, 6),
      time: Date.now(),
      type,
      message,
      extra,
    };
    const updated = [entry, ...logs.slice(0, MAX_LOGS - 1)];
    await chrome.storage.local.set({ logs: updated });
  } catch (e) {
    console.error("Logging error:", e);
  }
}

async function notify(title, message, isError = false) {
  const { notifyMode = "all" } = await chrome.storage.local.get("notifyMode");
  if (notifyMode === "none") return;
  if (notifyMode === "errors" && !isError) return;

  try {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon128.png",
      title,
      message,
      priority: isError ? 2 : 1,
    });
  } catch (e) {
    console.warn("Notification failed:", e);
  }
}

async function setStatus(state, text, extra = {}) {
  const status = { state, text, time: Date.now(), ...extra };
  await chrome.storage.local.set({ status });

  const badges = {
    working: ["...", "#f59e0b"],
    portal: ["!", "#dc2626"],
    failed: ["✕", "#dc2626"],
    online: ["✓", "#16a34a"],
    disabled: ["OFF", "#6b7280"],
    offline: ["?", "#9ca3af"],
  };

  const [label, color] = badges[state] || ["", "#000000"];
  chrome.action.setBadgeText({ text: label });
  if (label) chrome.action.setBadgeBackgroundColor({ color });

  await updateAdaptiveAlarm(state);
  return status;
}

// ---------- Concurrency Lock ----------

async function acquireLock() {
  const { lock = 0 } = await chrome.storage.session.get("lock");
  if (Date.now() - lock < LOCK_TTL_MS) return false;
  await chrome.storage.session.set({ lock: Date.now() });
  return true;
}

async function releaseLock() {
  await chrome.storage.session.remove("lock");
}

// ---------- Multi-Probe Portal Detection ----------

async function probeSingle(endpoint) {
  try {
    const start = Date.now();
    const res = await fetch(`${endpoint.url}?t=${Date.now()}`, {
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    });
    const latency = Date.now() - start;

    // Standard 204 No Content probe
    if (endpoint.type === "status204") {
      if (res.status === 204) return { state: "online", latency };
      if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) {
        return { state: "portal", reason: "HTTP redirect", latency };
      }
      if (res.status === 200) {
        // Some portals return 200 with splash HTML instead of 204
        return { state: "portal", reason: "Splash page (HTTP 200)", latency };
      }
      return { state: "portal", reason: `Status ${res.status}`, latency };
    }

    // Apple Hotspot detect probe expects <HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>
    if (endpoint.type === "appleText") {
      if (res.status === 200) {
        const text = await res.text();
        if (text.includes("Success")) return { state: "online", latency };
        return { state: "portal", reason: "Apple probe intercepted", latency };
      }
      if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) {
        return { state: "portal", reason: "Apple probe redirected", latency };
      }
    }

    // Microsoft Connect Test expects "Microsoft Connect Test"
    if (endpoint.type === "msftText") {
      if (res.status === 200) {
        const text = await res.text();
        if (text.includes("Microsoft Connect Test")) return { state: "online", latency };
        return { state: "portal", reason: "Microsoft probe intercepted", latency };
      }
      if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) {
        return { state: "portal", reason: "Microsoft probe redirected", latency };
      }
    }

    return { state: "portal", reason: `Unexpected response status ${res.status}`, latency };
  } catch (err) {
    return { state: "error", error: err.name || "NetworkError" };
  }
}

async function detectPortal() {
  // Test primary probe (Google 204)
  const primary = await probeSingle(PROBE_ENDPOINTS[0]);
  if (primary.state === "online") return { state: "online", latency: primary.latency };
  if (primary.state === "portal") return { state: "portal", reason: primary.reason, latency: primary.latency };

  // If primary gave a network error (DNS failure / TCP reset), probe secondary endpoints
  for (let i = 1; i < PROBE_ENDPOINTS.length; i++) {
    const secondary = await probeSingle(PROBE_ENDPOINTS[i]);
    if (secondary.state === "online") return { state: "online", latency: secondary.latency };
    if (secondary.state === "portal") return { state: "portal", reason: secondary.reason, latency: secondary.latency };
  }

  // If all probes throw network errors, check if network interface is active
  // In captive portals with strict DNS poisoning, fetch fails but browser tabs still get redirected
  return { state: "network-error" };
}

// ---------- Tab Navigation & Settling ----------

async function waitForLoad(tabId, timeout = 16000) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab && tab.status === "complete") return;
  } catch {}

  return new Promise((resolve) => {
    let resolved = false;
    const finish = () => {
      if (resolved) return;
      resolved = true;
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      resolve();
    };
    const listener = (id, info) => {
      if (id === tabId && info.status === "complete") finish();
    };
    const timer = setTimeout(finish, timeout);
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function settleTab(tabId) {
  // Wait for initial page load
  await waitForLoad(tabId, 15000);
  // Short pause for client-side JS (SPA frameworks, redirects) to mount
  await sleep(1000);
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab && tab.status !== "complete") {
      await waitForLoad(tabId, 8000);
    }
  } catch {}
}

// ---------- Profile Matching ----------

function pickProfile(profiles, hostname, fullUrl = "") {
  if (!profiles || !profiles.length) return null;
  const targetHost = (hostname || "").toLowerCase().trim();
  const targetUrl = (fullUrl || "").toLowerCase();

  // 1. Exact or substring host match
  const matched = profiles.find((p) => {
    const m = (p.match || "").toLowerCase().trim();
    return m && (targetHost.includes(m) || targetUrl.includes(m));
  });
  if (matched) return matched;

  // 2. Default profile (empty match)
  const defaultProfile = profiles.find((p) => !(p.match || "").trim());
  if (defaultProfile) return defaultProfile;

  // 3. Fallback to first profile with credentials
  return profiles.find((p) => p.username || p.clickThrough || p.mode === "clickthrough") || null;
}

// ---------- Injected Form Automation Script ----------
// This function executes inside every frame of the portal page. Must be 100% self-contained.
async function executePortalLogin(credentials) {
  const { username, password, clickThrough, mode, customUserSelector, customPassSelector, customSubmitSelector } = credentials;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const isVisible = (el) => {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    // Elements in active tabs or background tabs might report 0 offsetWidth if not yet painted,
    // but have client rects or parent in DOM.
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length || el.offsetParent !== null);
  };

  // Safe setter for React, Vue, Angular, Svelte reactive form inputs
  const setValue = (el, val) => {
    if (!el) return;
    try { el.focus(); } catch {}
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    if (descriptor && descriptor.set) {
      descriptor.set.call(el, val);
    } else {
      el.value = val;
    }
    el.dispatchEvent(new Event("focus", { bubbles: true, composed: true }));
    el.dispatchEvent(new Event("beforeinput", { bubbles: true, composed: true }));
    el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    el.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    el.dispatchEvent(new KeyboardEvent("keydown", { key: val.slice(-1) || "a", bubbles: true, composed: true }));
    el.dispatchEvent(new KeyboardEvent("keypress", { key: val.slice(-1) || "a", bubbles: true, composed: true }));
    el.dispatchEvent(new KeyboardEvent("keyup", { key: val.slice(-1) || "a", bubbles: true, composed: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true, composed: true }));
  };

  const TERMS_REGEX = /(accept|terms|agree|tos|policy|conditions|consent|rules|aup|disclaimer|wifi|wi-fi|internet|guest|access|continue|usage)/i;
  const ACTION_REGEX = /(connect|log ?in|sign ?in|sign ?on|log ?on|submit|continue|get online|free wi-?fi|enter|access|go|unlock|authenticate|authorize|verify|join|proceed|done|start|next|connexion|acceder|entrar|anmelden|inloggen|valider|iniciar|→|➔|➜|►|>>)/i;
  const NEGATIVE_REGEX = /(cancel|back|return|forgot|reset|clear|help|support|info|privacy|cookie|download|sign ?up|create|register|new user|new account)/i;
  const USER_FIELD_REGEX = /(user|login|email|account|uname|identity|member|roll|reg|student|auth|phone|mobile)/i;

  // 1. Accept Terms & Conditions checkboxes and radios across entire document
  const autoAcceptTerms = () => {
    let accepted = 0;
    document.querySelectorAll("input[type=checkbox], input[type=radio]").forEach((cb) => {
      const label = cb.labels && cb.labels[0] ? cb.labels[0].textContent : "";
      const parentText = cb.parentElement ? cb.parentElement.textContent : "";
      const text = `${cb.name || ""} ${cb.id || ""} ${cb.className || ""} ${label} ${parentText}`;
      if (!cb.checked && (TERMS_REGEX.test(text) || cb.required || cb.getAttribute("aria-required") === "true")) {
        try { cb.focus(); } catch {}
        cb.click();
        cb.checked = true;
        cb.dispatchEvent(new Event("change", { bubbles: true }));
        cb.dispatchEvent(new Event("input", { bubbles: true }));
        accepted++;
      }
    });
    return accepted;
  };

  // 2. Comprehensive Button Detection & Proximity Scoring
  const findBestSubmitButton = (pwField) => {
    if (customSubmitSelector) {
      try {
        const custom = document.querySelector(customSubmitSelector);
        if (custom && isVisible(custom)) return custom;
      } catch {}
    }

    // Collect all potentially clickable candidates in document
    const rawCandidates = [
      ...document.querySelectorAll(
        "button, input[type=submit], input[type=button], [role=button], " +
        "a[class*='btn'], a[class*='button'], div[class*='btn'], div[class*='button'], " +
        "span[class*='btn'], span[class*='button'], a[onclick], div[onclick], " +
        "[data-action*='submit'], [data-action*='login'], [data-action*='connect']"
      )
    ];

    // Remove duplicates
    const candidates = Array.from(new Set(rawCandidates)).filter(isVisible);
    if (!candidates.length) return null;

    let scored = candidates.map((el) => {
      let score = 0;
      const text = (el.textContent || el.value || "").trim();
      const aria = (el.getAttribute("aria-label") || el.getAttribute("title") || "").trim();
      const nameId = `${el.id || ""} ${el.name || ""} ${el.className || ""}`;
      const fullText = `${text} ${aria}`.trim();

      // Disqualifiers: Cancel, Back, Forgot Password, Register
      if (NEGATIVE_REGEX.test(fullText) || NEGATIVE_REGEX.test(nameId)) {
        return { el, score: -1000 };
      }

      // Explicit form submit button
      if (el.type === "submit") score += 120;
      if (el.getAttribute("role") === "button") score += 20;

      // Matches action words in visible text or value
      if (fullText && ACTION_REGEX.test(fullText)) {
        score += 110;
      }

      // Matches action cues in id/name/attributes
      if (ACTION_REGEX.test(nameId) || ACTION_REGEX.test(aria)) {
        score += 80;
      }

      // Style hints (primary, submit, login button classes)
      if (/(btn-primary|primary|btn-success|btn-login|btn-submit|submit|main-btn)/i.test(nameId)) {
        score += 40;
      }

      // DOM Proximity scoring relative to password field
      if (pwField) {
        // Inside the exact same <form>
        if (pwField.form && (el.form === pwField.form || pwField.form.contains(el))) {
          score += 60;
        }

        // Appears AFTER the password field in document order
        if (pwField.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) {
          score += 70;
        } else {
          // Appears before password field (less likely to be final submit)
          score -= 30;
        }
      }

      // Empty text but contains an icon/svg following password field (very common in modern UI)
      if (!text && el.querySelector("svg, i, img") && pwField && (pwField.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) {
        score += 65;
      }

      return { el, score };
    });

    // Sort by score descending
    scored = scored.filter((item) => item.score > 0).sort((a, b) => b.score - a.score);
    return scored.length ? scored[0].el : null;
  };

  // 3. Locate Username / Identity Input
  const findUsernameField = (pwField) => {
    if (customUserSelector) {
      try {
        const custom = document.querySelector(customUserSelector);
        if (custom && isVisible(custom)) return custom;
      } catch {}
    }

    const inputs = [...document.querySelectorAll("input")].filter(
      (i) => isVisible(i) && ["text", "email", "tel", "number", "search"].includes(i.type.toLowerCase())
    );

    // Look for autocomplete or name/id cues
    const cueMatch = inputs.find((i) => {
      const auto = i.getAttribute("autocomplete") || "";
      if (auto.includes("username") || auto.includes("email")) return true;
      const idName = `${i.name || ""} ${i.id || ""} ${i.placeholder || ""} ${i.getAttribute("aria-label") || ""}`;
      return USER_FIELD_REGEX.test(idName);
    });
    if (cueMatch) return cueMatch;

    // If password field exists, pick closest preceding input in DOM
    if (pwField) {
      let preceding = null;
      for (const i of inputs) {
        if (i.compareDocumentPosition(pwField) & Node.DOCUMENT_POSITION_FOLLOWING) {
          preceding = i;
        }
      }
      if (preceding) return preceding;
    }

    return inputs[0] || null;
  };

  // 4. Synthetic Full Mouse/Pointer Interaction Sequence
  const dispatchFullClick = async (el) => {
    if (!el) return false;
    try { el.scrollIntoView({ block: "center", inline: "center" }); } catch {}
    try { el.focus(); } catch {}

    const opts = { bubbles: true, cancelable: true, composed: true, view: window };
    el.dispatchEvent(new PointerEvent("pointerover", opts));
    el.dispatchEvent(new MouseEvent("mouseover", opts));
    el.dispatchEvent(new PointerEvent("pointerdown", opts));
    el.dispatchEvent(new MouseEvent("mousedown", opts));
    el.dispatchEvent(new PointerEvent("pointerup", opts));
    el.dispatchEvent(new MouseEvent("mouseup", opts));
    el.dispatchEvent(new MouseEvent("click", opts));

    if (typeof el.click === "function") {
      try { el.click(); } catch {}
    }
    return true;
  };

  // Wait for dynamic inputs (up to 4.5 seconds)
  const maxWait = (mode === "clickthrough" || clickThrough) ? 6 : 15;
  let pw = null;
  for (let i = 0; i < maxWait; i++) {
    if (customPassSelector) {
      try {
        const customPw = document.querySelector(customPassSelector);
        if (customPw && isVisible(customPw)) { pw = customPw; break; }
      } catch {}
    }
    pw = [...document.querySelectorAll("input[type=password]")].find(isVisible) || null;
    if (pw) break;
    await sleep(300);
  }

  // --- Case A: Credential-based Login ---
  if (pw && mode !== "clickthrough") {
    // 1. Tick terms
    autoAcceptTerms();

    // 2. Fill credentials with comprehensive reactive events
    const user = findUsernameField(pw);
    if (user && username) setValue(user, username);
    if (password) setValue(pw, password);

    // Re-check terms in case filling credentials revealed/unlocked terms
    autoAcceptTerms();
    await sleep(250);

    // 3. Find the best submit button (with proximity scoring & heuristic ranking)
    let btn = findBestSubmitButton(pw);

    // If button is currently disabled by frontend form validation, wait up to 1.5s for it to unlock
    if (btn && (btn.disabled || btn.getAttribute("aria-disabled") === "true" || btn.classList.contains("disabled"))) {
      for (let w = 0; w < 6 && btn.disabled; w++) {
        await sleep(250);
        btn = findBestSubmitButton(pw) || btn;
      }
      // If still disabled after wait, force-enable it
      if (btn.disabled) {
        btn.disabled = false;
        btn.removeAttribute("disabled");
        btn.setAttribute("aria-disabled", "false");
        btn.classList.remove("disabled");
      }
    }

    // 4. Dispatch interaction
    if (btn) {
      await dispatchFullClick(btn);

      // Fail-safe: Also trigger Enter key and form.requestSubmit if page hasn't started unloading
      await sleep(200);
      if (pw.form) {
        try {
          if (typeof pw.form.requestSubmit === "function") {
            pw.form.requestSubmit(btn);
          }
        } catch {}
      }
      return { ok: true, type: "credentials_submitted", buttonText: (btn.textContent || btn.value || "").trim(), frameUrl: window.location.href };
    }

    // Fallback if no button could be identified: Enter key & form requestSubmit
    if (pw.form) {
      try {
        if (typeof pw.form.requestSubmit === "function") {
          pw.form.requestSubmit();
          return { ok: true, type: "form_requestSubmit", frameUrl: window.location.href };
        }
      } catch {}
    }
    pw.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
    pw.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
    return { ok: true, type: "enter_key_dispatched", frameUrl: window.location.href };
  }

  // --- Case B: Click-Through Only or Passphrase-Free Portal ---
  if (mode === "clickthrough" || clickThrough || !password) {
    autoAcceptTerms();
    const btn = findBestSubmitButton(null);
    if (btn) {
      if (btn.disabled) {
        btn.disabled = false;
        btn.removeAttribute("disabled");
      }
      await sleep(150);
      await dispatchFullClick(btn);
      return { ok: true, type: "clickthrough_clicked", button: (btn.textContent || btn.value || "").trim(), frameUrl: window.location.href };
    }
  }

  // --- Case C: Multi-Step Portals (e.g. click "Guest Access" or "Campus Login" first) ---
  const step1Btn = findBestSubmitButton(null);
  if (step1Btn && !pw) {
    await dispatchFullClick(step1Btn);
    return { ok: true, type: "step1_transition", button: (step1Btn.textContent || step1Btn.value || "").trim(), frameUrl: window.location.href };
  }

  return { ok: false, reason: "No matching login form or connect button found in this frame" };
}

// ---------- Main Execution Flow ----------

async function check(triggerReason, isForce = false) {
  const store = await chrome.storage.local.get(["enabled", "profiles", "fails", "autoCloseTab"]);
  const enabled = store.enabled !== false;
  const profiles = store.profiles || [];
  let fails = store.fails || { count: 0, last: 0 };
  const autoCloseTab = store.autoCloseTab !== false;

  if (!enabled && !isForce) {
    return setStatus("disabled", "Auto-login is disabled in settings");
  }

  if (!(await acquireLock())) {
    return { state: "working", text: "Check already in progress..." };
  }

  try {
    await logEvent("check", `Checking Wi-Fi status (${triggerReason})`);
    const probe = await detectPortal();

    if (probe.state === "online") {
      await chrome.storage.local.set({ fails: { count: 0, last: 0 } });
      await logEvent("online", `Online (Latency: ${probe.latency}ms)`);
      return setStatus("online", "Connected to the internet", { latency: probe.latency });
    }

    if (probe.state === "network-error" && !isForce) {
      // Could be disconnected or a portal blocking raw probes
      // If we haven't failed recently, do one tab probe test
      if (fails.count >= 2) {
        return setStatus("offline", "No network connection detected");
      }
    }

    // Portal detected or network probe intercepted!
    await logEvent("portal-detected", `Portal detected (${probe.reason || "Probe redirected"})`);

    if (!profiles.length || !profiles.some((p) => p.username || p.clickThrough || p.mode === "clickthrough")) {
      await logEvent("warning", "Portal detected but no profiles are configured");
      notify("Wavvy: Portal Detected", "Configure your credentials in Settings to auto-login.");
      return setStatus("portal", "Portal detected - Add credentials in Settings");
    }

    if (isForce) fails = { count: 0, last: 0 };
    const COOLDOWN_MS = 4 * 60 * 1000;
    if (fails.count >= 3 && Date.now() - fails.last < COOLDOWN_MS) {
      const remainingMins = Math.ceil((COOLDOWN_MS - (Date.now() - fails.last)) / 60000);
      await logEvent("cooldown", `Login paused after 3 failures (${remainingMins}m remaining)`);
      return setStatus("failed", `Login paused after 3 failures. Retry in ${remainingMins}m or click Check.`);
    }

    const fail = async (reason) => {
      fails = { count: fails.count + 1, last: Date.now() };
      await chrome.storage.local.set({ fails });
      await logEvent("fail", `Login failed: ${reason}`);
      notify("Wavvy: Auto-Login Failed", reason, true);
      return setStatus("failed", reason);
    };

    // Clean up any stale portal tab from previous run
    const { portalTabId } = await chrome.storage.session.get("portalTabId");
    if (portalTabId) {
      chrome.tabs.remove(portalTabId).catch(() => {});
    }

    await setStatus("working", "Portal detected - Logging in...");

    // Create background probe tab to trigger captive gateway redirect
    const tab = await chrome.tabs.create({
      url: PROBE_ENDPOINTS[0].url,
      active: false,
    });
    await chrome.storage.session.set({ portalTabId: tab.id });

    await settleTab(tab.id);

    const updatedTab = await chrome.tabs.get(tab.id);
    let hostname = "";
    try {
      hostname = new URL(updatedTab.url).hostname;
    } catch {}

    const profile = pickProfile(profiles, hostname, updatedTab.url);
    if (!profile) {
      return fail(`No saved profile matches portal (${hostname || "unknown portal"})`);
    }

    await logEvent("logging-in", `Attempting login with profile: ${profile.name || profile.match || "Default"} on ${hostname}`);

    // Execute automation in ALL frames (solves Aruba, Cisco ISE, UniFi iframe portals)
    let executionResults = null;
    try {
      executionResults = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: executePortalLogin,
        args: [
          {
            username: profile.username || "",
            password: profile.password || "",
            clickThrough: !!profile.clickThrough,
            mode: profile.mode || "credentials",
            customUserSelector: profile.customUserSelector || "",
            customPassSelector: profile.customPassSelector || "",
            customSubmitSelector: profile.customSubmitSelector || "",
          },
        ],
      });
    } catch (scriptErr) {
      return fail(`Could not interact with portal page (${scriptErr.message})`);
    }

    // Evaluate frame responses
    const successfulFrame = executionResults?.find((r) => r.result && r.result.ok);
    if (!successfulFrame) {
      const rejection = executionResults?.[0]?.result?.reason || "Login form could not be identified";
      return fail(rejection);
    }

    const actionDesc = successfulFrame.result.buttonText ? `button "${successfulFrame.result.buttonText}"` : successfulFrame.result.type;
    await logEvent("submitted", `Form submitted via ${actionDesc}`);

    // If step 1 transition (e.g. clicked "Guest Login" or "Terms" first), wait and retry for Step 2
    if (successfulFrame.result.type === "step1_transition") {
      await logEvent("multi-step", "Step 1 button clicked, waiting for Step 2 credentials form...");
      await sleep(2500);
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id, allFrames: true },
          func: executePortalLogin,
          args: [
            {
              username: profile.username || "",
              password: profile.password || "",
              clickThrough: !!profile.clickThrough,
              mode: profile.mode || "credentials",
            },
          ],
        });
      } catch {}
    }

    // Verification Loop: Probe until internet is unlocked (up to 16 seconds)
    for (let attempt = 1; attempt <= 8; attempt++) {
      await sleep(2000);
      const verify = await detectPortal();
      if (verify.state === "online") {
        if (autoCloseTab) {
          chrome.tabs.remove(tab.id).catch(() => {});
        }
        await chrome.storage.session.remove("portalTabId");
        await chrome.storage.local.set({ fails: { count: 0, last: 0 } });

        await logEvent("success", `Successfully authenticated on ${hostname || "portal"}`);
        notify("Wavvy: Wi-Fi Connected", `Successfully logged into ${profile.name || hostname || "Wi-Fi portal"}.`);
        return setStatus("online", `Logged in to ${profile.name || hostname || "portal"}`);
      }
    }

    return fail("Portal did not unlock connection. Please verify your credentials.");
  } catch (err) {
    await logEvent("error", `Unexpected error: ${err.message}`);
    return setStatus("failed", `Error: ${err.message}`);
  } finally {
    await releaseLock();
  }
}
