// ApexCommerce DNS Failure & Resilience Simulation Engine
// Self-contained client/server compatible interactive logic

(function () {
  'use strict';

  // State
  const state = {
    primaryNS: 'online',       // 'online' | 'offline'
    secondaryNS: false,        // boolean: Dual-provider failover enabled
    dnssecStatus: 'valid',     // 'valid' | 'corrupted'
    coreDNSStatus: 'healthy',  // 'healthy' | 'overloaded'
    staleCache: false,         // RFC 8767 Stale Cache fallback
    nodeLocalDNS: false,       // NodeLocal DNSCache enabled
    
    ttlConfig: 60,             // Record TTL setting (seconds)
    ttlRemaining: 60,          // Current resolver cache TTL countdown
    cachedRecord: '104.21.45.10',
    
    trafficRPS: 8500,
    gmvPerMinNormal: 17360,    // ~$25M / day = ~$17,360 / min
    gmvLostTotal: 0,
    
    activeScenario: 'normal',
    latencyMs: 18,
    successRate: 100.0,
    lastRcode: 'NOERROR',
    activeTab: 'war-room'
  };

  // DOM Elements
  const el = {
    statusPill: document.getElementById('incident-status-pill'),
    statusText: document.getElementById('incident-status-text'),
    gmvLostVal: document.getElementById('gmv-lost-val'),
    
    // Sliders & Controls
    ttlSlider: document.getElementById('ttl-slider'),
    ttlVal: document.getElementById('ttl-val'),
    trafficSlider: document.getElementById('traffic-slider'),
    trafficVal: document.getElementById('traffic-val'),
    toggleDualNS: document.getElementById('toggle-dual-ns'),
    toggleStaleCache: document.getElementById('toggle-stale-cache'),
    toggleCoreDNSCache: document.getElementById('toggle-coredns-cache'),
    ttlCountdown: document.getElementById('active-ttl-countdown'),
    
    // Topology Nodes & Texts
    nodeClient: document.getElementById('node-client'),
    nodeResolver: document.getElementById('node-resolver'),
    nodeNs1: document.getElementById('node-ns1'),
    nodeNs2: document.getElementById('node-ns2'),
    nodeCdn: document.getElementById('node-cdn'),
    nodeK8s: document.getElementById('node-k8s'),
    nodePayment: document.getElementById('node-payment'),
    
    resolverCacheStatus: document.getElementById('resolver-cache-status'),
    ns1StatusText: document.getElementById('ns1-status-text'),
    ns2StatusText: document.getElementById('ns2-status-text'),
    cdnStatusText: document.getElementById('cdn-status-text'),
    k8sCoreDNSLabel: document.getElementById('k8s-coredns-label'),
    paymentDnsStatus: document.getElementById('payment-dns-status'),
    
    // SVG Lines
    lineClientResolver: document.getElementById('line-client-resolver'),
    lineResolverNs1: document.getElementById('line-resolver-ns1'),
    lineResolverNs2: document.getElementById('line-resolver-ns2'),
    lineResolverCdn: document.getElementById('line-resolver-cdn'),
    lineCdnK8s: document.getElementById('line-cdn-k8s'),
    lineK8sPayment: document.getElementById('line-k8s-payment'),
    
    // Metrics
    metricSuccessRate: document.getElementById('metric-success-rate'),
    metricRcode: document.getElementById('metric-rcode'),
    metricLatency: document.getElementById('metric-latency'),
    metricTraffic: document.getElementById('metric-traffic'),
    metricDropped: document.getElementById('metric-dropped'),
    metricConversions: document.getElementById('metric-conversions'),
    metricCartAbandon: document.getElementById('metric-cart-abandon'),
    
    // Terminal Log
    packetLogStream: document.getElementById('packet-log-stream'),
    btnClearLog: document.getElementById('btn-clear-log'),
    
    // Storefront Elements
    browserDnsProbe: document.getElementById('browser-dns-probe'),
    storeBlackoutOverlay: document.getElementById('store-blackout-overlay'),
    browserErrorCode: document.getElementById('browser-error-code'),
    btnRetryPage: document.getElementById('btn-retry-page'),
    btnProbeDns: document.getElementById('btn-probe-dns'),
    
    // Checkout Modal
    checkoutModal: document.getElementById('checkout-modal'),
    modalClose: document.getElementById('modal-close'),
    checkoutItemTitle: document.getElementById('checkout-item-title'),
    checkoutChargeAmt: document.getElementById('checkout-charge-amt'),
    stepDns: document.getElementById('step-dns'),
    stepCdn: document.getElementById('step-cdn'),
    stepPayment: document.getElementById('step-payment'),
    stepCharge: document.getElementById('step-charge'),
    checkoutResultBox: document.getElementById('checkout-result-box')
  };

  // Audio tone generation for incidents (subtle Web Audio synthesized clicks/alerts)
  let audioCtx = null;
  function playBeep(type) {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      
      const now = audioCtx.currentTime;
      if (type === 'error') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.setValueAtTime(110, now + 0.1);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        osc.start(now);
        osc.stop(now + 0.3);
      } else if (type === 'success') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523.25, now);
        osc.frequency.setValueAtTime(659.25, now + 0.08);
        gain.gain.setValueAtTime(0.05, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        osc.start(now);
        osc.stop(now + 0.25);
      }
    } catch (e) {
      // Audio might be blocked by browser policy until user interaction
    }
  }

  // Log to terminal
  function logPacket(msg, type = 'info') {
    if (!el.packetLogStream) return;
    const now = new Date().toISOString().substring(11, 23);
    const line = document.createElement('div');
    line.className = 'log-entry';
    
    let typeClass = 'log-info';
    if (type === 'error') typeClass = 'log-err';
    if (type === 'success') typeClass = 'log-ok';
    if (type === 'warn') typeClass = 'log-warn';
    
    line.innerHTML = `<span class="log-time">${now}</span> <span class="${typeClass}">${msg}</span>`;
    el.packetLogStream.prepend(line);
    
    // Cap log lines to 80
    if (el.packetLogStream.children.length > 80) {
      el.packetLogStream.removeChild(el.packetLogStream.lastChild);
    }
  }

  // DNS Resolver Simulation logic
  function performDnsResolution(queryDomain = 'apexcommerce.com') {
    state.totalQueries++;
    
    // Case 1: Local / Recursive Cache Valid (TTL > 0)
    if (state.ttlRemaining > 0) {
      state.lastRcode = 'NOERROR';
      state.latencyMs = Math.floor(Math.random() * 5) + 2; // 2-6ms cache hit
      return {
        status: 'CACHE_HIT',
        rcode: 'NOERROR',
        ip: state.cachedRecord,
        ttl: state.ttlRemaining,
        latency: state.latencyMs,
        details: 'Resolved from Recursive Resolver Cache (TTL remaining)'
      };
    }

    // Case 2: Cache Expired, Upstream Query needed
    // 2.1 Primary NS is healthy
    if (state.primaryNS === 'online') {
      if (state.dnssecStatus === 'corrupted') {
        state.lastRcode = 'SERVFAIL';
        state.latencyMs = Math.floor(Math.random() * 20) + 45;
        return {
          status: 'DNSSEC_FAILURE',
          rcode: 'SERVFAIL',
          ip: null,
          ttl: 0,
          latency: state.latencyMs,
          details: 'DNSSEC validation failed: RRSIG key signature mismatch for apexcommerce.com'
        };
      }
      
      // Healthy primary resolution
      state.ttlRemaining = state.ttlConfig; // Refresh cache
      state.lastRcode = 'NOERROR';
      state.latencyMs = Math.floor(Math.random() * 12) + 14;
      return {
        status: 'AUTHORITATIVE_HIT',
        rcode: 'NOERROR',
        ip: state.cachedRecord,
        ttl: state.ttlRemaining,
        latency: state.latencyMs,
        details: 'Authoritative answer from CloudNS Alpha (Primary Anycast)'
      };
    }

    // 2.2 Primary NS is DOWN
    // Check if Secondary Provider is Active
    if (state.secondaryNS) {
      state.ttlRemaining = state.ttlConfig;
      state.lastRcode = 'NOERROR';
      state.latencyMs = Math.floor(Math.random() * 15) + 22; // 22-37ms failover
      return {
        status: 'FAILOVER_HIT',
        rcode: 'NOERROR',
        ip: state.cachedRecord,
        ttl: state.ttlRemaining,
        latency: state.latencyMs,
        details: 'Failover: Authoritative answer from AWS Route 53 (Secondary Provider)'
      };
    }

    // Check if RFC 8767 Stale Cache is allowed
    if (state.staleCache) {
      state.lastRcode = 'NOERROR';
      state.latencyMs = Math.floor(Math.random() * 8) + 10;
      return {
        status: 'RFC8767_STALE_SERVED',
        rcode: 'NOERROR',
        ip: state.cachedRecord,
        ttl: 0,
        latency: state.latencyMs,
        details: 'RFC 8767: Serving stale expired cache while revalidating upstream'
      };
    }

    // Complete Resolution Failure
    state.lastRcode = 'SERVFAIL';
    state.latencyMs = Math.floor(Math.random() * 50) + 120; // 120-170ms timeout
    return {
      status: 'OUTAGE_SERVFAIL',
      rcode: 'SERVFAIL',
      ip: null,
      ttl: 0,
      latency: state.latencyMs,
      details: 'All authoritative nameservers unreachable; no servers could be reached (TIMEOUT)'
    };
  }

  // Update Visual Network Topology
  function updateTopologyVisuals(res) {
    // Reset classes
    el.nodeClient.className = 'topo-node node-healthy';
    el.nodeResolver.className = 'topo-node node-healthy';
    el.nodeNs1.className = 'topo-node ' + (state.primaryNS === 'online' ? 'node-healthy' : 'node-outage');
    el.nodeNs2.className = 'topo-node ' + (state.secondaryNS ? 'node-failover' : 'node-inactive');
    el.nodeCdn.className = 'topo-node';
    el.nodeK8s.className = 'topo-node ' + (state.coreDNSStatus === 'healthy' ? 'node-healthy' : 'node-outage');
    el.nodePayment.className = 'topo-node';

    // Status Texts
    el.ns1StatusText.textContent = state.primaryNS === 'online' ? (state.dnssecStatus === 'corrupted' ? 'DNSSEC ERR' : 'ONLINE') : 'OUTAGE (BGP DOWN)';
    el.ns2StatusText.textContent = state.secondaryNS ? 'ACTIVE (FAILOVER)' : 'STANDBY';
    el.k8sCoreDNSLabel.textContent = state.coreDNSStatus === 'healthy' ? 'CoreDNS: 100% OK' : 'CoreDNS: 100% CPU OOM';
    
    // Lines
    el.lineClientResolver.className = 'topo-line topo-line-active';
    
    if (state.ttlRemaining > 0) {
      el.resolverCacheStatus.textContent = `CACHE: HIT (${state.ttlRemaining}s)`;
      el.lineResolverNs1.className = 'topo-line';
      el.lineResolverNs2.className = 'topo-line topo-line-dashed';
    } else {
      el.resolverCacheStatus.textContent = 'CACHE: EXPIRED';
      if (state.primaryNS === 'online') {
        el.lineResolverNs1.className = state.dnssecStatus === 'corrupted' ? 'topo-line topo-line-danger' : 'topo-line topo-line-active';
      } else {
        el.lineResolverNs1.className = 'topo-line topo-line-danger';
        if (state.secondaryNS) {
          el.lineResolverNs2.className = 'topo-line topo-line-failover';
        }
      }
    }

    if (res.rcode === 'NOERROR') {
      el.nodeCdn.className = 'topo-node node-healthy';
      el.cdnStatusText.textContent = 'ROUTING TRAFFIC';
      el.lineResolverCdn.className = 'topo-line topo-line-active';
      el.lineCdnK8s.className = 'topo-line topo-line-active';
    } else {
      el.nodeCdn.className = 'topo-node node-outage';
      el.cdnStatusText.textContent = 'NO INBOUND DNS';
      el.lineResolverCdn.className = 'topo-line topo-line-danger';
      el.lineCdnK8s.className = 'topo-line';
    }

    // CoreDNS & Payment
    if (state.coreDNSStatus === 'overloaded') {
      el.lineK8sPayment.className = 'topo-line topo-line-danger';
      el.paymentDnsStatus.textContent = 'LOOKUP TIMEOUT';
      el.nodePayment.className = 'topo-node node-outage';
    } else {
      el.lineK8sPayment.className = 'topo-line topo-line-active';
      el.paymentDnsStatus.textContent = 'RESOLVED';
      el.nodePayment.className = 'topo-node node-healthy';
    }
  }

  // Update UI and Telemetry
  function updateDashboard() {
    const res = performDnsResolution('apexcommerce.com');
    updateTopologyVisuals(res);

    // Calculate rates
    const isOutage = (res.rcode !== 'NOERROR') || (state.coreDNSStatus === 'overloaded');
    
    if (isOutage) {
      state.successRate = (res.rcode === 'NOERROR') ? 50.0 : 0.0;
      // Accumulate GMV loss
      const gmvLossPerSec = state.gmvPerMinNormal / 60;
      state.gmvLostTotal += gmvLossPerSec;
      
      el.statusPill.className = 'status-pill status-outage';
      el.statusText.textContent = res.rcode === 'SERVFAIL' ? 'P0 CRITICAL OUTAGE (SERVFAIL - RESOLUTION BLACKOUT)' : 'P0 CRITICAL OUTAGE (INTERNAL COREDNS COLLAPSE)';
    } else if (state.secondaryNS || state.staleCache) {
      state.successRate = 100.0;
      el.statusPill.className = 'status-pill status-degraded';
      el.statusText.textContent = state.secondaryNS ? 'FAILOVER ACTIVE: ROUTING VIA ROUTE 53 (100% RESOLUTION)' : 'RESILIENCE MODE: RFC 8767 STALE CACHE ACTIVE';
    } else {
      state.successRate = 100.0;
      el.statusPill.className = 'status-pill status-healthy';
      el.statusText.textContent = 'SYSTEM HEALTHY (100% RESOLUTION)';
    }

    // Format metrics
    el.gmvLostVal.textContent = `$${state.gmvLostTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    el.ttlCountdown.textContent = `${state.ttlRemaining}s`;
    el.metricSuccessRate.textContent = `${state.successRate.toFixed(1)}%`;
    el.metricRcode.textContent = `RCODE: ${res.rcode}`;
    el.metricLatency.textContent = `${res.latency} ms`;
    
    if (isOutage) {
      el.metricDropped.textContent = `Dropped: ${state.trafficRPS.toLocaleString()} RPS`;
      el.metricConversions.textContent = '0 /min';
      el.metricCartAbandon.textContent = 'Cart Drop: 100%';
    } else {
      el.metricDropped.textContent = 'Dropped: 0 RPS';
      el.metricConversions.textContent = `${Math.floor((state.trafficRPS / 8500) * 248)} /min`;
      el.metricCartAbandon.textContent = 'Cart Drop: 1.4%';
    }

    // Storefront sync
    if (res.rcode !== 'NOERROR') {
      el.storeBlackoutOverlay.classList.remove('hidden');
      el.browserErrorCode.textContent = res.status === 'DNSSEC_FAILURE' ? 'DNS_PROBE_FINISHED_NXDOMAIN (DNSSEC SERVFAIL)' : 'ERR_NAME_NOT_RESOLVED';
      el.browserDnsProbe.innerHTML = `<span style="color:#ef4444">apexcommerce.com -> [FAILED (${res.rcode})]</span>`;
    } else {
      el.storeBlackoutOverlay.classList.add('hidden');
      el.browserDnsProbe.innerHTML = `<span style="color:#10b981">apexcommerce.com -> ${res.ip} [RESOLVED (NOERROR)]</span>`;
    }

    // Log packet
    const logTag = res.rcode === 'NOERROR' ? `[OK ${res.latency}ms]` : `[FAIL ${res.latency}ms]`;
    const logType = res.rcode === 'NOERROR' ? (res.status === 'FAILOVER_HIT' ? 'warn' : 'success') : 'error';
    logPacket(`${logTag} apexcommerce.com IN A -> ${res.rcode} | ${res.details}`, logType);
  }

  // Ticker timer for TTL decay and metrics loop
  setInterval(() => {
    if (state.ttlRemaining > 0) {
      state.ttlRemaining--;
    }
    updateDashboard();
  }, 1000);

  // Scenario Buttons
  function resetAllFlags() {
    state.primaryNS = 'online';
    state.secondaryNS = false;
    state.dnssecStatus = 'valid';
    state.coreDNSStatus = 'healthy';
    state.staleCache = false;
    state.ttlRemaining = state.ttlConfig;
    
    el.toggleDualNS.checked = false;
    el.toggleStaleCache.checked = false;
    el.toggleCoreDNSCache.checked = false;

    document.querySelectorAll('.scenario-btn').forEach(b => b.classList.remove('active'));
  }

  // Scenario 1: Normal
  document.getElementById('btn-normal').addEventListener('click', function () {
    resetAllFlags();
    this.classList.add('active');
    logPacket('🟢 Applied Baseline: All Authoritative Nameservers healthy and active.', 'success');
    playBeep('success');
  });

  // Scenario 2: Authoritative Outage
  document.getElementById('btn-authoritative-outage').addEventListener('click', function () {
    resetAllFlags();
    this.classList.add('active');
    state.primaryNS = 'offline';
    logPacket('🔴 CRITICAL: CloudNS Alpha BGP withdrawn. Authoritative NS unresponsive. Watch TTL tick down!', 'error');
    playBeep('error');
  });

  // Scenario 3: DNSSEC Failure
  document.getElementById('btn-dnssec-failure').addEventListener('click', function () {
    resetAllFlags();
    this.classList.add('active');
    state.dnssecStatus = 'corrupted';
    state.ttlRemaining = 0; // immediate validation hit
    logPacket('⚠️ DNSSEC ALARM: Invalid RRSIG signature detected on apexcommerce.com zone. Validating resolvers returning SERVFAIL.', 'warn');
    playBeep('error');
  });

  // Scenario 4: CoreDNS Storm
  document.getElementById('btn-coredns-storm').addEventListener('click', function () {
    resetAllFlags();
    this.classList.add('active');
    state.coreDNSStatus = 'overloaded';
    logPacket('🌪️ INTERNAL STORM: Kubernetes CoreDNS CPU pegged at 100%. Pod lookups for api.globalpay.net timing out.', 'warn');
    playBeep('error');
  });

  // Scenario 5: Dual-Provider Failover
  document.getElementById('btn-dual-dns-failover').addEventListener('click', function () {
    this.classList.add('active');
    state.secondaryNS = true;
    el.toggleDualNS.checked = true;
    logPacket('🛡️ REMEDIATION: Secondary Route 53 Anycast provider active. Resolvers successfully failover!', 'success');
    playBeep('success');
  });

  // Scenario 6: RFC 8767 Stale Cache
  document.getElementById('btn-rfc8767-stale').addEventListener('click', function () {
    this.classList.add('active');
    state.staleCache = true;
    el.toggleStaleCache.checked = true;
    logPacket('🔄 RESILIENCE: RFC 8767 Serving Stale Data activated. Cached records served past TTL.', 'info');
    playBeep('success');
  });

  // Sliders and Toggles
  el.ttlSlider.addEventListener('input', (e) => {
    state.ttlConfig = parseInt(e.target.value, 10);
    el.ttlVal.textContent = `${state.ttlConfig}s`;
    if (state.primaryNS === 'online' && state.dnssecStatus === 'valid') {
      state.ttlRemaining = state.ttlConfig;
    }
  });

  el.trafficSlider.addEventListener('input', (e) => {
    state.trafficRPS = parseInt(e.target.value, 10);
    el.trafficVal.textContent = `${state.trafficRPS.toLocaleString()} RPS`;
    el.metricTraffic.textContent = `${state.trafficRPS.toLocaleString()} RPS`;
  });

  el.toggleDualNS.addEventListener('change', (e) => {
    state.secondaryNS = e.target.checked;
    logPacket(state.secondaryNS ? 'Dual-Provider DNS Enabled (Route 53 Active)' : 'Dual-Provider DNS Disabled', state.secondaryNS ? 'success' : 'warn');
  });

  el.toggleStaleCache.addEventListener('change', (e) => {
    state.staleCache = e.target.checked;
    logPacket(state.staleCache ? 'RFC 8767 Stale Serving Enabled' : 'RFC 8767 Disabled', 'info');
  });

  el.toggleCoreDNSCache.addEventListener('change', (e) => {
    state.nodeLocalDNS = e.target.checked;
    if (state.nodeLocalDNS && state.coreDNSStatus === 'overloaded') {
      state.coreDNSStatus = 'healthy';
      logPacket('NodeLocal DNSCache deployed: CoreDNS query load alleviated, cluster healed!', 'success');
    }
  });

  el.btnClearLog.addEventListener('click', () => {
    el.packetLogStream.innerHTML = '';
  });

  // Tabs Navigation
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-view').forEach(v => v.classList.remove('active'));
      
      btn.classList.add('active');
      const tabId = btn.getAttribute('data-tab');
      document.getElementById(`view-${tabId}`).classList.add('active');
      state.activeTab = tabId;
    });
  });

  // Storefront & Checkout Simulation
  document.querySelectorAll('.btn-buy').forEach(btn => {
    btn.addEventListener('click', () => {
      const product = btn.getAttribute('data-product');
      const price = btn.getAttribute('data-price');
      triggerCheckout(product, price);
    });
  });

  function triggerCheckout(product, price) {
    el.checkoutItemTitle.textContent = `Checkout: ${product}`;
    el.checkoutChargeAmt.textContent = price;
    el.checkoutModal.classList.remove('hidden');
    el.checkoutResultBox.innerHTML = '';
    
    // Reset steps
    [el.stepDns, el.stepCdn, el.stepPayment, el.stepCharge].forEach(s => {
      s.className = 'step-line';
    });

    // Step 1: DNS Resolve
    el.stepDns.className = 'step-line step-active';
    setTimeout(() => {
      const dnsRes = performDnsResolution('checkout.apexcommerce.com');
      if (dnsRes.rcode !== 'NOERROR') {
        el.stepDns.className = 'step-line step-error';
        el.stepDns.textContent = `1. Resolving checkout.apexcommerce.com: FAILED (${dnsRes.rcode})`;
        el.checkoutResultBox.className = 'result-box result-error';
        el.checkoutResultBox.innerHTML = `<strong>Order Failed:</strong> DNS Resolution error (<code>${dnsRes.details}</code>). Unable to connect to host.`;
        playBeep('error');
        return;
      }

      el.stepDns.className = 'step-line step-success';
      el.stepDns.textContent = `1. Resolved checkout.apexcommerce.com -> ${dnsRes.ip} (${dnsRes.latency}ms)`;

      // Step 2: CDN Edge
      el.stepCdn.className = 'step-line step-active';
      setTimeout(() => {
        el.stepCdn.className = 'step-line step-success';
        el.stepCdn.textContent = '2. Connected to Edge CDN Gateway (HTTP/3 200 OK)';

        // Step 3: Payment Gateway DNS & Call
        el.stepPayment.className = 'step-line step-active';
        setTimeout(() => {
          if (state.coreDNSStatus === 'overloaded') {
            el.stepPayment.className = 'step-line step-error';
            el.stepPayment.textContent = '3. Resolving api.globalpay.net: CoreDNS TIMEOUT';
            el.checkoutResultBox.className = 'result-box result-error';
            el.checkoutResultBox.innerHTML = '<strong>Order Failed:</strong> Internal Service Discovery Failure. Kubernetes CoreDNS could not resolve payment gateway within 5000ms.';
            playBeep('error');
            return;
          }

          el.stepPayment.className = 'step-line step-success';
          el.stepPayment.textContent = '3. Payment Gateway Token Acquired (api.globalpay.net 200 OK)';

          // Step 4: Final Charge
          el.stepCharge.className = 'step-line step-active';
          setTimeout(() => {
            el.stepCharge.className = 'step-line step-success';
            el.stepCharge.textContent = `4. Payment Authorized: $${price}.00 (Order #APX-${Math.floor(100000 + Math.random() * 900000)})`;
            el.checkoutResultBox.className = 'result-box result-success';
            el.checkoutResultBox.innerHTML = '<strong>Order Placed Successfully!</strong> Thank you for shopping with ApexCommerce.';
            playBeep('success');
          }, 300);

        }, 350);

      }, 300);

    }, 350);
  }

  el.modalClose.addEventListener('click', () => {
    el.checkoutModal.classList.add('hidden');
  });

  el.btnRetryPage.addEventListener('click', () => {
    updateDashboard();
  });

  el.btnProbeDns.addEventListener('click', () => {
    updateDashboard();
    logPacket('Manual DNS Probe triggered by user.', 'info');
  });

  // Initial Run
  document.getElementById('btn-normal').classList.add('active');
  updateDashboard();
  logPacket('🚀 Simulation Initialized: ApexCommerce SRE War Room Ready.', 'success');

})();
