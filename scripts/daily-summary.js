#!/usr/bin/env node
/**
 * 실전 포트폴리오 일일 요약
 * 사용법: node scripts/daily-summary.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { toZonedTime } from 'date-fns-tz';
import { format } from 'date-fns';
import dotenv from 'dotenv';
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORTFOLIO_PATH = path.join(__dirname, '../output/real-portfolio.json');
const PT_TZ = 'America/Vancouver';
const today = format(toZonedTime(new Date(), PT_TZ), 'yyyy-MM-dd');

if (!fs.existsSync(PORTFOLIO_PATH)) {
  console.log('\n포트폴리오 없음 — 아직 매수 기록이 없습니다.\n');
  process.exit(0);
}

const portfolio = JSON.parse(fs.readFileSync(PORTFOLIO_PATH, 'utf-8'));
const line = '━'.repeat(55);

// 현재가 fetch
async function fetchCurrentPrice(symbol) {
  try {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*', 'Referer': 'https://finance.yahoo.com/',
      }
    });
    if (!res.ok) return null;
    const json = await res.json();
    const closes = json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
    return closes.filter(Boolean).at(-1) ?? null;
  } catch { return null; }
}

const openPositions = portfolio.positions.filter(p => p.status === 'open');
const todayBuys     = [...openPositions, ...portfolio.history].filter(p => p.buyDate  === today);
const todaySells    = portfolio.history.filter(p => p.sellDate === today);

// 오픈 포지션 현재가 fetch
const prices = {};
if (openPositions.length) {
  await Promise.all(openPositions.map(async p => {
    prices[p.symbol] = await fetchCurrentPrice(p.symbol);
  }));
}

// P&L 계산
const unrealized = openPositions.reduce((sum, p) => {
  const cur = prices[p.symbol];
  return cur ? sum + parseFloat(((cur - p.buyPrice) * p.shares).toFixed(2)) : sum;
}, 0);
const realized = portfolio.history.reduce((sum, p) => sum + (p.pnl ?? 0), 0);
const totalPnl  = parseFloat((realized + unrealized).toFixed(2));
const totalPct  = parseFloat((totalPnl / portfolio.initialBalance * 100).toFixed(2));

// ── 헤더 ──
console.log(`\n${line}`);
console.log(`📊 실전 포트폴리오  (${today})`);
console.log(`   시작일: ${portfolio.startDate}  |  초기자본: $${portfolio.initialBalance.toLocaleString()}`);
console.log(line);

// ── 잔액 & 총 P&L ──
const balSign = totalPnl >= 0 ? '+' : '';
const balIcon = totalPnl >= 0 ? '📈' : '📉';
console.log(`\n  💰 현금 잔액:   $${portfolio.balance.toLocaleString()}`);
console.log(`  ${balIcon} 총 P&L:      ${balSign}$${totalPnl} (${balSign}${totalPct}%)`);
console.log(`     실현:  ${realized >= 0 ? '+' : ''}$${realized.toFixed(2)}  |  미실현: ${unrealized >= 0 ? '+' : ''}$${unrealized.toFixed(2)}`);

// ── 오늘 매수 ──
if (todayBuys.length) {
  console.log(`\n${line}`);
  console.log('📥 오늘 매수');
  console.log(line);
  for (const p of todayBuys) {
    console.log(`  ${p.symbol.padEnd(6)}  $${p.buyPrice} × ${p.shares}주 = $${p.cost}`);
    console.log(`          목표 $${p.targetPrice}  손절 $${p.stopLoss}  R:R ${p.rrRatio}:1`);
  }
}

// ── 보유 종목 ──
if (openPositions.length) {
  console.log(`\n${line}`);
  console.log('📂 보유 종목');
  console.log(line);
  for (const p of openPositions) {
    const cur = prices[p.symbol];
    if (cur) {
      const upnl    = parseFloat(((cur - p.buyPrice) * p.shares).toFixed(2));
      const upnlPct = parseFloat(((cur - p.buyPrice) / p.buyPrice * 100).toFixed(2));
      const s = upnl >= 0 ? '+' : '';
      const icon = cur >= p.targetPrice ? '🎯' : cur <= p.stopLoss ? '🛑' : upnl >= 0 ? '🟢' : '🔴';
      console.log(`  ${icon} ${p.symbol.padEnd(6)}  매수 $${p.buyPrice} → 현재 $${cur.toFixed(2)}  (${s}$${upnl}, ${s}${upnlPct}%)`);
      console.log(`          목표 $${p.targetPrice}  손절 $${p.stopLoss}  |  ${p.shares}주`);
    } else {
      console.log(`  ⏳ ${p.symbol.padEnd(6)}  매수 $${p.buyPrice}  목표 $${p.targetPrice}  손절 $${p.stopLoss}`);
    }
  }
}

// ── 오늘 매도 ──
if (todaySells.length) {
  console.log(`\n${line}`);
  console.log('📤 오늘 매도');
  console.log(line);
  for (const p of todaySells) {
    const icon = p.pnl >= 0 ? '✅' : '❌';
    const s    = p.pnl >= 0 ? '+' : '';
    const tag  = p.hitTarget ? ' 🎯 목표가' : p.hitStop ? ' 🛑 손절' : '';
    console.log(`  ${icon} ${p.symbol.padEnd(6)}  $${p.buyPrice} → $${p.sellPrice}${tag}`);
    console.log(`          ${s}$${p.pnl} (${s}${p.pnlPct}%)  |  보유 ${p.holdDays}일`);
  }
}

// ── 누적 통계 ──
if (portfolio.history.length) {
  const wins  = portfolio.history.filter(p => p.result === 'win').length;
  const total = portfolio.history.length;
  const avgWin  = portfolio.history.filter(p => p.pnl > 0).reduce((s,p) => s + p.pnlPct, 0) / (wins || 1);
  const avgLoss = portfolio.history.filter(p => p.pnl < 0).reduce((s,p) => s + p.pnlPct, 0) / ((total - wins) || 1);
  console.log(`\n${line}`);
  console.log(`📉 누적 실전 기록`);
  console.log(line);
  console.log(`  총 거래: ${total}건  |  ${wins}승 ${total - wins}패  |  승률 ${Math.round(wins / total * 100)}%`);
  console.log(`  평균 수익: +${avgWin.toFixed(1)}%  |  평균 손실: ${avgLoss.toFixed(1)}%`);
}

console.log(`\n${line}\n`);
