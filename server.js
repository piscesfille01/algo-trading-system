import express from 'express';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3001;
const OUTPUT_DIR = path.join(__dirname, 'output');

app.use(express.json());

// CORS for local dev
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'http://localhost:3000');
  res.header('Access-Control-Allow-Methods', 'GET, POST');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// Job status tracking
const jobStatus = { premarket: 'idle', postmarket: 'idle' };
const jobLogs = { premarket: [], postmarket: [] };

function readJSON(filepath) {
  try {
    return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
  } catch {
    return null;
  }
}

// GET /api/data — All data needed for dashboard
app.get('/api/data', (_req, res) => {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

  const todayRec = readJSON(path.join(OUTPUT_DIR, `${today}-premarket.json`));
  const portfolio = readJSON(path.join(OUTPUT_DIR, 'portfolio.json')) || {
    balance: parseFloat(process.env.INITIAL_BALANCE) || 10000,
    initialBalance: parseFloat(process.env.INITIAL_BALANCE) || 10000,
    positions: [],
  };
  const trades = readJSON(path.join(OUTPUT_DIR, 'trades.json')) || [];
  const performance = readJSON(path.join(OUTPUT_DIR, 'performance.json')) || null;

  res.json({ todayRec, portfolio, trades, performance });
});

// GET /api/status — Analysis job status + last logs
app.get('/api/status', (_req, res) => {
  res.json({
    ...jobStatus,
    premarketError: jobLogs.premarket.filter(l => l.startsWith('ERR')).slice(-3),
    postmarketError: jobLogs.postmarket.filter(l => l.startsWith('ERR')).slice(-3),
  });
});

// POST /api/analyze/premarket — Run pre-market analysis
app.post('/api/analyze/premarket', (req, res) => {
  if (jobStatus.premarket === 'running') {
    return res.json({ running: true, message: 'Already analyzing' });
  }

  jobStatus.premarket = 'running';
  jobLogs.premarket = [];

  const child = spawn('node', ['scripts/analyze-premarket.js'], {
    cwd: __dirname,
    env: { ...process.env },
  });

  child.stdout.on('data', d => process.stdout.write(d));
  child.stderr.on('data', d => {
    const msg = d.toString();
    process.stderr.write(msg);
    jobLogs.premarket.push('ERR: ' + msg.trim());
  });
  child.on('close', (code) => {
    jobStatus.premarket = code === 0 ? 'done' : 'error';
  });

  res.json({ running: true });
});

// POST /api/analyze/postmarket — Update post-market results
app.post('/api/analyze/postmarket', (req, res) => {
  if (jobStatus.postmarket === 'running') {
    return res.json({ running: true, message: 'Already analyzing' });
  }

  jobStatus.postmarket = 'running';
  jobLogs.postmarket = [];

  const child = spawn('node', ['scripts/analyze-postmarket.js'], {
    cwd: __dirname,
    env: { ...process.env },
  });

  child.stdout.on('data', d => process.stdout.write(d));
  child.stderr.on('data', d => {
    const msg = d.toString();
    process.stderr.write(msg);
    jobLogs.postmarket.push('ERR: ' + msg.trim());
  });
  child.on('close', (code) => {
    jobStatus.postmarket = code === 0 ? 'done' : 'error';
  });

  res.json({ running: true });
});

// GET /api/trades — 대시보드 trades 로드
app.get('/api/trades', (_req, res) => {
  const tradesPath = path.join(OUTPUT_DIR, 'trades-manual.json');
  if (!fs.existsSync(tradesPath)) {
    return res.json([]);
  }
  const trades = readJSON(tradesPath) || [];
  res.json(trades);
});

// POST /api/trades — 대시보드 trades 저장 (pick.js 잔액 계산용)
app.post('/api/trades', (req, res) => {
  const trades = req.body;
  if (!Array.isArray(trades)) return res.status(400).json({ error: 'array expected' });
  fs.writeFileSync(path.join(OUTPUT_DIR, 'trades-manual.json'), JSON.stringify(trades, null, 2));
  // balance.json도 동시에 업데이트
  const INITIAL = parseFloat(process.env.INITIAL_BALANCE) || 10000;
  const closedPnl   = trades.filter(t => t.result !== 'open').reduce((s, t) => s + (t.pnl ?? 0), 0);
  const openInvested = trades.filter(t => t.result === 'open').reduce((s, t) => s + (t.invested ?? 0), 0);
  const balance = parseFloat((INITIAL + closedPnl - openInvested).toFixed(2));
  fs.writeFileSync(path.join(OUTPUT_DIR, 'balance.json'), JSON.stringify({ balance }));
  res.json({ ok: true, balance });
});

// GET /api/quotes?symbols=AAPL,NVDA — 현재가 조회 (Yahoo Finance 프록시)
app.get('/api/quotes', async (req, res) => {
  const symbols = (req.query.symbols || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!symbols.length) return res.json({});
  const results = {};
  await Promise.all(symbols.map(async sym => {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=1d`;
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }, signal: AbortSignal.timeout(5000) });
      const json = await r.json();
      const price = json?.chart?.result?.[0]?.meta?.regularMarketPrice;
      if (price) results[sym] = parseFloat(price.toFixed(2));
    } catch {}
  }));
  res.json(results);
});

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

app.listen(PORT, () => {
  console.log(`📡 API 서버 실행 중: http://localhost:${PORT}`);
});
