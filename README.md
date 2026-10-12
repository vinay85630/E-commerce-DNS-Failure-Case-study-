# 🌐 Cascading DNS Failure in an E-Commerce Platform: Case Study & Live Simulator

[![Node.js](https://img.shields.io/badge/Node.js-v18+-green.svg)](https://nodejs.org)
[![Zero Dependencies](https://img.shields.io/badge/Dependencies-Zero-blue.svg)]()
[![GitHub Pages Ready](https://img.shields.io/badge/GitHub%20Pages-Ready-brightgreen.svg)]()
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

An interactive SRE incident simulation and comprehensive architectural case study examining a **Severity 1 (P0) DNS blackout** in a tier-1 e-commerce retailer ($25M GMV/day).

---

## 🚀 Live Demo & Quickstart

### Option 1: Run Locally (Instant Start)
The project is built with **zero external dependencies** using native Node.js.

```bash
# 1. Clone the repository
git clone https://github.com/vinay85630/E-commerce-DNS-Failure-Case-study-.git
cd E-commerce-DNS-Failure-Case-study-

# 2. Start the simulator server
node server.js
```

Open your browser at **[http://localhost:3000](http://localhost:3000)**.

---

### Option 2: 1-Click Live Demo on GitHub Pages
This entire interactive simulator is 100% static-compatible. You can host a free live demo directly on GitHub:

1. In this repository on GitHub, navigate to **Settings** > **Pages**.
2. Under **Build and deployment** > **Branch**, select `main` branch and `/ (root)` folder.
3. Click **Save**.
4. Your live demo will be immediately accessible globally at:  
   👉 **`https://vinay85630.github.io/E-commerce-DNS-Failure-Case-study-/`**

---

## 🎯 What You Can Experience in the Live Simulator

### 1. ⚡ SRE War Room & Animated Topology
- **End-to-End DNS Resolution Path**: Animated SVG diagram mapping query flow: `Browser -> Recursive Resolver (8.8.8.8 / 1.1.1.1) -> Authoritative Nameservers -> Edge CDN -> Kubernetes Origin -> Payment Gateway`.
- **Active TTL Decay Clock**: Live countdown showing resolver cache expiration in real-time.
- **Financial Ticker**: Real-time ticker tracking lost revenue ($/second) based on dropped shopper traffic.
- **RFC 1035 Packet Stream**: Live scrolling terminal showing DNS query opcodes, RCODEs (`NOERROR`, `SERVFAIL`), and latencies.

### 2. 💥 Chaos Engineering Scenarios
| Scenario | Trigger | Observed System Behavior |
| :--- | :--- | :--- |
| **🟢 Normal Baseline** | Healthy state | 100% resolution, 18ms latency, all checkouts complete successfully. |
| **🔴 Scenario A: Authoritative NS Outage** | Primary Anycast provider BGP route drop | Cache serves requests until TTL hits `0s`. Immediate global blackout (`SERVFAIL`), 100% cart abandonment. |
| **⚠️ Scenario B: DNSSEC Mismatch** | Corrupted Key Signing Key | Validating resolvers (Google 8.8.8.8, Cloudflare 1.1.1.1) reject zone signatures with immediate `SERVFAIL`. |
| **🌪️ Scenario C: Internal CoreDNS Storm** | Backend retry loop | Kubernetes CoreDNS exhausts memory; pod lookups for external payment gateway (`api.globalpay.net`) timeout. |
| **🛡️ Scenario D: Dual-Provider Failover** | Secondary Route 53 NS enabled | Traffic automatically shifts to secondary nameserver; 100% recovery with zero downtime. |
| **🔄 Scenario E: RFC 8767 Stale Cache** | Serve-stale fallback enabled | Resolvers serve expired cached records while revalidating; shields shoppers from upstream outage. |

### 3. 🛒 Interactive Storefront View
- Browse products and trigger instant checkouts.
- When an outage occurs, experience real browser error screens (`ERR_NAME_NOT_RESOLVED`, `DNS_PROBE_FINISHED_NXDOMAIN`) with diagnostic breakdowns.

---

## 📑 The Production Case Study

The full 5,000-word post-mortem and production engineering blueprint is available in:  
👉 **[`DNS_FAILURE_CASE_STUDY.md`](DNS_FAILURE_CASE_STUDY.md)**

### Key Takeaways from the Case Study:
1. **The Anycast Fallacy**: Anycast protects against physical server loss, but shares a single control plane. A single zone file error breaks all 300+ edge nodes at once.
2. **The TTL Trap**: 60-second TTLs allow fast IP changes, but leave zero buffer during DNS provider failures.
3. **Multi-Provider Active-Active Architecture**: Always delegate authoritative NS records across at least two independent vendors (e.g. AWS Route 53 + Cloudflare/NS1) synchronized via GitOps (OctoDNS).
4. **Kubernetes CoreDNS Resiliency**: Implement NodeLocal DNSCache and negative caching to prevent external DNS failures from crashing internal service discovery.

---

## 📂 Repository Structure

```text
├── DNS_FAILURE_CASE_STUDY.md    # Complete SRE post-mortem & architecture guide
├── README.md                    # Project documentation & GitHub Pages instructions
├── index.html                   # Interactive Single-Page Simulator & Storefront UI
├── style.css                    # SRE War Room dark theme & animations
├── app.js                       # Complete client-side DNS simulation engine
├── server.js                    # Zero-dependency Node.js HTTP & REST API server
└── package.json                 # Project configuration
```

---

## 🛠️ API Endpoints

When running `node server.js`:

- `GET /api/status`: Inspect current simulation flags and node states.
- `GET /api/dns-query?domain=apexcommerce.com`: Execute simulated DNS query returning RFC-compliant JSON response.
- `POST /api/chaos/scenario`: Trigger chaos scenarios via programmatic API (`{ "scenario": "authoritative_outage" }`).

---

## 📜 License
MIT License. Free for educational, organizational, and presentation use.
