// ApexCommerce DNS Failure Simulator & Case Study Server
// Zero-dependency pure Node.js HTTP server and simulation API

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;

// Internal Simulation State for API
let simState = {
  primaryNS: 'online',
  secondaryNS: false,
  dnssecStatus: 'valid',
  coreDNSStatus: 'healthy',
  staleCache: false,
  ttlConfig: 60,
  ttlRemaining: 60,
  records: {
    'apexcommerce.com': '104.21.45.10',
    'api.apexcommerce.com': '104.21.45.11',
    'static.apexcommerce.com': '151.101.65.140',
    'checkout.apexcommerce.com': '104.21.45.12',
    'api.globalpay.net': '198.51.100.42'
  }
};

// MIME types
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // API Route: GET /api/status
  if (pathname === '/api/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      timestamp: new Date().toISOString(),
      simulation: simState
    }, null, 2));
    return;
  }

  // API Route: GET /api/dns-query
  if (pathname === '/api/dns-query' && req.method === 'GET') {
    const domain = parsedUrl.query.domain || 'apexcommerce.com';
    const startTime = Date.now();
    
    let rcode = 'NOERROR';
    let answers = [];
    let authority = [];
    let message = 'Query resolved successfully';

    if (simState.dnssecStatus === 'corrupted') {
      rcode = 'SERVFAIL';
      message = 'DNSSEC validation failed: RRSIG key signature mismatch';
    } else if (simState.primaryNS === 'offline' && !simState.secondaryNS && !simState.staleCache) {
      rcode = 'SERVFAIL';
      message = 'Authoritative nameservers unreachable; connection timed out';
    } else {
      const ip = simState.records[domain] || '104.21.45.10';
      answers.push({
        name: domain,
        type: 'A',
        class: 'IN',
        ttl: simState.ttlRemaining,
        data: ip
      });
      authority.push({
        name: domain,
        type: 'NS',
        class: 'IN',
        ttl: 86400,
        data: simState.secondaryNS ? 'ns1.route53.aws.com' : 'ns1.cloudns-alpha.net'
      });
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      header: {
        id: Math.floor(Math.random() * 65535),
        qr: 1,
        opcode: 'QUERY',
        aa: simState.primaryNS === 'online' ? 1 : 0,
        tc: 0,
        rd: 1,
        ra: 1,
        rcode: rcode
      },
      question: [{ name: domain, type: 'A', class: 'IN' }],
      answer: answers,
      authority: authority,
      responseTimeMs: Date.now() - startTime + (rcode === 'SERVFAIL' ? 120 : 18),
      message: message
    }, null, 2));
    return;
  }

  // API Route: POST /api/chaos/scenario
  if (pathname === '/api/chaos/scenario' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const scenario = payload.scenario;

        if (scenario === 'normal') {
          simState.primaryNS = 'online';
          simState.secondaryNS = false;
          simState.dnssecStatus = 'valid';
          simState.coreDNSStatus = 'healthy';
        } else if (scenario === 'authoritative_outage') {
          simState.primaryNS = 'offline';
        } else if (scenario === 'dnssec_failure') {
          simState.dnssecStatus = 'corrupted';
        } else if (scenario === 'coredns_storm') {
          simState.coreDNSStatus = 'overloaded';
        } else if (scenario === 'dual_dns_failover') {
          simState.secondaryNS = true;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, activeScenario: scenario, state: simState }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
      }
    });
    return;
  }

  // Static File Serving
  let filePath = path.join(__dirname, pathname === '/' ? 'index.html' : pathname);
  
  // Safe directory check
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Fallback to index.html for single-page application routing
      filePath = path.join(__dirname, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (readErr, content) => {
      if (readErr) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
        return;
      }

      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    });
  });
});

server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🌐 ApexCommerce DNS Failure Simulator & Case Study`);
  console.log(`=======================================================`);
  console.log(`🚀 Live Demo URL: http://localhost:${PORT}`);
  console.log(`📡 API Status:    http://localhost:${PORT}/api/status`);
  console.log(`🔍 DNS Probe:     http://localhost:${PORT}/api/dns-query?domain=apexcommerce.com`);
  console.log(`=======================================================`);
});
