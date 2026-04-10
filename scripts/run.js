#!/usr/bin/env node
/**
 * 통합 실행 스크립트
 *
 * node scripts/run.js              → 종목 추천 + 보유종목 분석
 * node scripts/run.js holdings     → 보유종목 분석만
 * node scripts/run.js 2026-03-20   → 특정 날짜 추천
 */

import { execSync } from 'child_process';
import { toZonedTime } from 'date-fns-tz';
import { format } from 'date-fns';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TRADES_PATH = path.join(__dirname, '../output/trades-manual.json');

const PT_TIMEZONE = 'America/Vancouver';
const ET_TIMEZONE = 'America/New_York';
const now     = new Date();
const ptNow   = toZonedTime(now, PT_TIMEZONE);
const etNow   = toZonedTime(now, ET_TIMEZONE);
const timeStr = format(ptNow, 'HH:mm:ss');
const etStr   = format(etNow, 'HH:mm:ss');
const dateStr = format(ptNow, 'yyyy-MM-dd');
const mode    = process.argv[2];

console.log(`\n⏰  PT ${timeStr}  |  ET ${etStr}  (${dateStr})`);

// ── 보유종목 목록 ──────────────────────────────────────────────
function getOpenHoldings() {
  try {
    const trades = JSON.parse(fs.readFileSync(TRADES_PATH, 'utf-8'));
    return trades.filter(t => t.result === 'open' || t.status === 'open');
  } catch { return []; }
}

// ── 보유종목 간단 요약 ─────────────────────────────────────────
const YH_HDR = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': '*/*', 'Referer': 'https://finance.yahoo.com/',
};

async function fetchQuotes(symbols) {
  const results = {};
  await Promise.all(symbols.map(async sym => {
    try {
      const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5d`;
      const res = await fetch(url, { headers: YH_HDR });
      if (!res.ok) return;
      const json = await res.json();
      const meta = json?.chart?.result?.[0]?.meta;
      if (meta) results[sym] = meta.regularMarketPrice ?? null;
    } catch {}
  }));
  return results;
}

async function printHoldingsSummary() {
  const holdings = getOpenHoldings();
  if (!holdings.length) {
    console.log('\n📂 보유 포지션 없음\n');
    return;
  }

  const quotes = await fetchQuotes(holdings.map(h => h.symbol));
  const line = '━'.repeat(58);
  console.log(`\n${line}`);
  console.log(`📂 보유 포지션  (node scripts/analyze.js SYMBOL 로 상세 확인)`);
  console.log(line);

  for (const h of holdings) {
    const price = quotes[h.symbol];
    if (price == null) {
      console.log(`  ${h.symbol.padEnd(6)}  가격 없음`);
      continue;
    }
    const pnlPct = ((price - h.buyPrice) / h.buyPrice * 100);
    const pnlSign = pnlPct >= 0 ? '+' : '';
    const tgtDist = h.target ? ((h.target - price) / price * 100).toFixed(1) : '-';
    const stopDist = h.stop  ? ((price - h.stop)  / price * 100).toFixed(1) : '-';
    const icon = pnlPct >= 0 ? '📈' : '📉';
    console.log(`  ${icon} ${h.symbol.padEnd(6)}  $${price.toFixed(2)}  ${pnlSign}${pnlPct.toFixed(1)}%  |  TP +${tgtDist}%  SL -${stopDist}%`);
  }
  console.log(line + '\n');
}

// ── 분기 ──────────────────────────────────────────────────────
if (mode === 'holdings') {
  await printHoldingsSummary();
} else if (mode && /^\d{4}-\d{2}-\d{2}$/.test(mode)) {
  console.log(`\n📈 종목 추천 실행 (${mode} 기준)\n`);
  execSync(`node scripts/pick.js ${mode}`, { stdio: 'inherit' });
  await printHoldingsSummary();
} else {
  console.log('\n📈 종목 추천 실행\n');
  try {
    execSync('node scripts/pick.js', { stdio: 'inherit' });
  } catch (e) {
    console.error(`pick.js 오류: ${e.message}`);
  }
  await printHoldingsSummary();
}
