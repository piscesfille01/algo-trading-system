#!/usr/bin/env node
/**
 * Live trading sell records
 * Usage: node scripts/sell.js SMCI 31.5
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { toZonedTime } from 'date-fns-tz';
import { format } from 'date-fns';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORTFOLIO_PATH = path.join(__dirname, '../output/real-portfolio.json');
const PT_TZ = 'America/Vancouver';
const today = format(toZonedTime(new Date(), PT_TZ), 'yyyy-MM-dd');

const symbol    = process.argv[2]?.toUpperCase();
const sellPrice = parseFloat(process.argv[3]);

if (!symbol || isNaN(sellPrice) || sellPrice <= 0) {
  console.error('사용법: node scripts/sell.js SMCI 31.5');
  process.exit(1);
}

if (!fs.existsSync(PORTFOLIO_PATH)) {
  console.error('포트폴리오 없음 — 먼저 buy.js로 매수 기록하세요');
  process.exit(1);
}

const portfolio = JSON.parse(fs.readFileSync(PORTFOLIO_PATH, 'utf-8'));
const posIdx = portfolio.positions.findIndex(p => p.symbol === symbol && p.status === 'open');

if (posIdx === -1) {
  console.error(`⚠️  ${symbol}: 보유 중인 포지션 없음`);
  process.exit(1);
}

const pos      = portfolio.positions[posIdx];
const proceeds = parseFloat((pos.shares * sellPrice).toFixed(2));
const pnl      = parseFloat((proceeds - pos.cost).toFixed(2));
const pnlPct   = parseFloat((pnl / pos.cost * 100).toFixed(2));
const result   = pnl >= 0 ? 'win' : 'loss';
const holdDays = Math.round((new Date(today) - new Date(pos.buyDate)) / 86400000);

portfolio.balance = parseFloat((portfolio.balance + proceeds).toFixed(2));

const closed = {
  ...pos,
  sellDate: today,
  sellPrice,
  proceeds,
  pnl,
  pnlPct,
  holdDays,
  status: 'closed',
  result,
  hitTarget: sellPrice >= pos.targetPrice,
  hitStop:   sellPrice <= pos.stopLoss,
};

portfolio.history.push(closed);
portfolio.positions.splice(posIdx, 1);
fs.writeFileSync(PORTFOLIO_PATH, JSON.stringify(portfolio, null, 2));

const line = '━'.repeat(50);
const icon = pnl >= 0 ? '✅' : '❌';
const sign = pnl >= 0 ? '+' : '';
const tag  = closed.hitTarget ? ' 🎯 목표가 달성' : closed.hitStop ? ' 🛑 손절' : '';

console.log(`\n${line}`);
console.log(`📤 매도 기록 (${today})`);
console.log(line);
console.log(`\n${icon} ${symbol}${tag}`);
console.log(`   매수 $${pos.buyPrice} → 매도 $${sellPrice}  (${sign}$${pnl}, ${sign}${pnlPct}%)`);
console.log(`   보유 ${holdDays}일  |  ${pos.shares}주 × $${sellPrice} = $${proceeds}`);
console.log(`\n💰 잔액: $${portfolio.balance.toLocaleString()}`);
console.log(`${line}\n`);
