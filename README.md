<p align="center">
  <img src="logo.png" alt="Wavvy Logo" width="320">
</p>

<h1 align="center">Wavvy</h1>

<p align="center">
  <strong>Zero-click Wi-Fi captive portal auto-login for Chrome and Chromium browsers.</strong><br>
  Never see a campus, hotel, airport, or coffee shop splash screen again.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Manifest-V3-blue.svg?style=flat-square" alt="Manifest V3">
  <img src="https://img.shields.io/badge/Chrome-Extension-green.svg?style=flat-square" alt="Chrome Extension">
  <img src="https://img.shields.io/badge/Privacy-100%25%20On--Device-success.svg?style=flat-square" alt="Privacy First">
  <img src="https://img.shields.io/badge/License-MIT-orange.svg?style=flat-square" alt="License MIT">
</p>

---

## ⚡ Why Wavvy?

When you open your laptop at an airport, hotel, or university campus, public Wi-Fi networks intercept your connection with an annoying captive login page. You usually have to open a tab, wait for an insecure HTTP redirect to trigger, type your credentials, accept terms, and click connect.

**Wavvy automates the entire process in the background.** Before you even open a browser tab, Wavvy detects the gateway, fills your saved credentials, ticks the Terms of Service checkbox, submits the form, verifies the internet connection, and silently closes the login tab.

---

## ✨ Features

- 🎯 **Multi-Probe Detection Engine**: Probes Google (`generate_204`), Cloudflare, Apple Hotspot Detect, and Microsoft Connect Test to differentiate between captive portals and real disconnections. No false lockouts from DNS hijacking.
- 🪟 **Deep Iframe Penetration (`allFrames: true`)**: Traverses nested subframes to authenticate modern enterprise portals like Aruba ClearPass, Cisco ISE, Fortinet, and UniFi.
- ⚡ **Zero Loading Race Conditions**: Instantly detects when Single Page Applications (SPAs) finish mounting.
- 🧠 **Smart Reactive Form Fill**: Uses native prototype descriptor value setters compatible with React 16+, Vue 2/3, Angular, and Svelte.
- 🔋 **Adaptive Battery Saver**: Polls every 1 minute during portals or reconnects, then automatically throttles down to 5–10 minutes once online to protect your laptop's battery.
- 🔒 **100% Local & Private**: No analytics, no external servers, no cloud telemetry. Your credentials stay strictly inside your local browser storage.
- 📋 **Diagnostics & Activity Logs**: In-app live activity logger tracks pings, latency, and authentication status in real time.

---

## 🚀 Installation (Takes 30 Seconds)

1. **Download or Clone this Repository**:
   ```bash
   git clone https://github.com/Hootsworth/Wavvy.git
   ```
   *(Or click **Code &rarr; Download ZIP** and unzip the folder).*

2. **Open Extensions in Chrome**:
   - Navigate to `chrome://extensions` in your address bar (or Brave, Edge, Arc).
   - Toggle **Developer mode** in the top-right corner.

3. **Load Unpacked**:
   - Click **Load unpacked** in the top-left corner.
   - Select the downloaded `Wavvy` directory.

4. **Add Your Credentials**:
   - Click the Wavvy icon in your extensions toolbar &rarr; **Settings**.
   - Add your network profile (e.g. University Wi-Fi, Hotel Guest) with username/password or click-through mode.
   - Click **Save Changes**.

---

## 🌐 Landing Page & Scrollytelling Demo

Wavvy includes a standalone motion-designed interactive showcase built with GSAP and ScrollTrigger:

- **Live Demo**: Open [`index.html`](index.html) in any browser, or visit the deployed GitHub Pages site.
- Includes an interactive *"Try It Yourself"* network simulator comparing connection times with auto-login ON vs OFF.

---

## 🛠️ How It Works Under the Hood

```
[Connect to Wi-Fi]
        │
        ▼
[Silent Probe: 204 Check]
        │
        ├─► [Status == 204] ────────► Online (Throttles alarm to 5m)
        │
        └─► [302 Redirect / Splash]
                 │
                 ▼
        [Open Headless Portal Tab]
                 │
                 ▼
        [Settle SPA / Frame Traversal]
                 │
                 ▼
        [Autofill Credentials + Accept Terms]
                 │
                 ▼
        [Synthetic Form Submit]
                 │
                 ▼
        [Verify 204 & Close Tab]
```

---

## 📄 License

MIT License. Free to use, modify, and distribute.
