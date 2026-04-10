#!/usr/bin/env node
process.removeAllListeners('warning');
process.on('warning', (warning) => {
  if (warning.name === 'DeprecationWarning') return;
  console.warn(warning);
});

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
dotenv.config();

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.resolve('output/cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

// ── 유틸 ──────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function avg(arr) { return arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0; }

function cacheGet(key) {
  try { return JSON.parse(fs.readFileSync(path.join(CACHE_DIR, `${key}.json`), 'utf-8')); } catch { return null; }
}
function cacheSet(key, data) {
  fs.writeFileSync(path.join(CACHE_DIR, `${key}.json`), JSON.stringify(data));
}

// ── Yahoo Finance Headers ──────────────────────────────────────────────
const YH_HDR = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  'Accept': 'application/json',
};

// ── 기술적 지표 계산 함수들 ─────────────────────────────────────────────
function calcRSI(closes) {
  if (closes.length < 15) return null;
  let g=0, l=0;
  for (let i=closes.length-14; i<closes.length; i++) {
    const d = closes[i]-closes[i-1];
    if (d>0) g+=d; else l-=d;
  }
  if (l===0) return 100;
  return parseFloat((100 - 100/(1+(g/14)/(l/14))).toFixed(1));
}

function calcEMA(data, p) {
  if (!data || data.length < p) return null;
  const k = 2/(p+1);
  let e = avg(data.slice(0,p));
  for (let i=p; i<data.length; i++) e = data[i]*k + e*(1-k);
  return e;
}

function calcMACD(closes) {
  if (closes.length < 35) return null;
  const macdSeries = [];
  for (let i = 25; i < closes.length; i++) {
    const slice = closes.slice(0, i + 1);
    const e12 = calcEMA(slice, 12), e26 = calcEMA(slice, 26);
    if (e12 != null && e26 != null) macdSeries.push(e12 - e26);
  }
  if (macdSeries.length < 9) return null;
  const macdLine = macdSeries.at(-1);
  const signal = calcEMA(macdSeries, 9);
  if (signal == null) return null;
  return {
    histogram: parseFloat((macdLine - signal).toFixed(3)),
    rising: macdLine > macdSeries.at(-2),
  };
}

function calcATR(rows, period=14) {
  if (rows.length < period+1) return null;
  const trs = rows.slice(-period-1).map((r,i,arr) => {
    if (i===0) return null;
    const prev = arr[i-1];
    return Math.max(r.high-r.low, Math.abs(r.high-prev.close), Math.abs(r.low-prev.close));
  }).filter(Boolean);
  return trs.length ? avg(trs) : null;
}

// ── 장 시간 체크 ──────────────────────────────────────────────────────────
function isMarketOpen() {
  const now = new Date();
  const etTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = etTime.getDay(); // 0=일요일, 6=토요일
  const hour = etTime.getHours();
  const minute = etTime.getMinutes();

  // 주말이면 장 닫힘
  if (day === 0 || day === 6) return false;

  // 9:30 AM - 4:00 PM ET
  const currentMinutes = hour * 60 + minute;
  const marketOpen = 9 * 60 + 30; // 9:30 AM
  const marketClose = 16 * 60; // 4:00 PM

  return currentMinutes >= marketOpen && currentMinutes < marketClose;
}

// ── 실시간 Quote 가져오기 ──────────────────────────────────────────────────
async function fetchLiveQuote(symbol) {
  try {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d`;
    const res = await fetch(url, { headers: YH_HDR });
    if (!res.ok) return null;

    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) return null;

    const meta = result.meta;
    const q = result.indicators.quote[0];
    const timestamps = result.timestamp;

    if (!timestamps || timestamps.length === 0) return null;

    // 가장 최근 데이터
    const lastIdx = timestamps.length - 1;

    return {
      price: meta.regularMarketPrice || q.close[lastIdx],
      open: q.open[lastIdx] || meta.previousClose,
      high: q.high[lastIdx] || meta.regularMarketPrice,
      low: q.low[lastIdx] || meta.regularMarketPrice,
      volume: meta.regularMarketVolume || 0,
      previousClose: meta.previousClose,
      change: meta.regularMarketPrice - meta.previousClose,
      changePercent: ((meta.regularMarketPrice - meta.previousClose) / meta.previousClose * 100)
    };
  } catch (err) {
    return null;
  }
}

// ── Yahoo Finance 데이터 fetch ──────────────────────────────────────────
async function fetchHistory(symbol, cutoff) {
  const cacheKey = `yh_${symbol.replace(/\./g,'-')}`;
  let rows = cacheGet(cacheKey);
  if (rows && rows[0]?.rawClose === undefined) rows = null;
  if (rows) {
    const lastCached = rows.at(-1)?.date ?? '';
    const daysDiff = (new Date(cutoff) - new Date(lastCached)) / 86400000;
    if (daysDiff > 7) rows = null;
  }
  if (!rows) {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol.replace(/\./g,'-'))}?interval=1d&range=2y`;
    let json = null;
    for (let i = 0; i < 3; i++) {
      try {
        const res = await fetch(url, { headers: YH_HDR });
        if (res.status === 429) { await sleep(3000 * (i+1)); continue; }
        if (!res.ok) break;
        json = await res.json(); break;
      } catch { await sleep(1000); }
    }
    if (!json) return null;
    const result = json?.chart?.result?.[0];
    if (!result?.timestamp) return null;
    const q = result.indicators.quote[0];
    const adj = result.indicators.adjclose?.[0]?.adjclose;
    rows = result.timestamp.map((ts, i) => {
      const rawClose = q.close[i];
      const close = adj?.[i] ?? rawClose;
      if (!close || !q.high[i]) return null;
      return {
        date: new Date(ts*1000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }),
        open: q.open[i], high: q.high[i], low: q.low[i],
        close: parseFloat(close.toFixed(4)),
        rawClose: rawClose != null ? parseFloat(rawClose.toFixed(4)) : parseFloat(close.toFixed(4)),
        volume: q.volume[i] ?? 0,
      };
    }).filter(Boolean).sort((a,b) => a.date.localeCompare(b.date));
    if (!rows.length) return null;
    cacheSet(cacheKey, rows);
  }
  return rows.filter(r => r.date <= cutoff);
}

// ── 메인 ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let CUTOFF, SYMBOLS = [];

for (const arg of args) {
  if (arg.match(/^\d{4}-\d{2}-\d{2}$/)) {
    CUTOFF = arg;
  } else {
    SYMBOLS.push(arg.toUpperCase());
  }
}

if (!CUTOFF) CUTOFF = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

// ── AI 기반 심층 분석 ──────────────────────────────────────────────────
async function generateAIInsight(symbol, technicalData) {
  const {
    todayChangePct, todayVolume, avgVolume, volRatio,
    rsi, rsiPrev, rsiChange,
    macdData,
    closes, volumes,
    streak, streakType,
    toTarget, toStop,
    buyPrice, targetPrice, stopLoss,
    trend, macdStatus
  } = technicalData;

  const prompt = `당신은 미국 주식 데일리 트레이더를 위한 전문 분석가입니다. 아래 기술적 데이터를 바탕으로 구체적이고 실행 가능한 분석을 제공하세요.

**${symbol} 기술적 데이터:**
- 오늘 변동: ${todayChangePct}%
- 거래량: ${(todayVolume/1e6).toFixed(1)}M (평균 대비 ${volRatio}%)
- RSI: ${rsiPrev?.toFixed(0)} → ${rsi?.toFixed(0)} (${rsiChange >= 0 ? '+' : ''}${rsiChange}pt)
- MACD: ${macdStatus} (Histogram: ${macdData?.histogram?.toFixed(3)})
- 연속 ${streak}일 ${streakType === 'up' ? '상승' : '하락'}
- 추세: ${trend}
${buyPrice ? `- 진입가: $${buyPrice.toFixed(2)} | 목표: $${targetPrice?.toFixed(2)} (${toTarget}%) | 손절: $${stopLoss?.toFixed(2)} (${toStop}%)` : ''}

**요구사항:**
1. **핵심 패턴 분석** (2-3문장): 현재 차트에서 형성되고 있는 구체적 패턴과 의미
2. **주요 레벨** (구체적 가격): 다음 지지/저항선과 돌파 시 시나리오
3. **거래량 해석**: 거래량이 지금 무엇을 말하고 있는가?
4. **단기 예측** (1-3일): 확률 기반 시나리오 (60% 확률로 X, 30% 확률로 Y)
5. **액션 플랜**: Hold/Add/Trim/Exit + 구체적 조건
6. **주요 리스크**: 경계해야 할 신호 3가지

**출력 형식:**
간결하고 직설적으로. 불필요한 설명 제외. 구체적 가격과 퍼센트 포함.`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 800,
      messages: [{
        role: 'user',
        content: prompt
      }]
    });

    return response.content[0].text;
  } catch (error) {
    console.error(`AI 분석 실패 (${symbol}):`, error.message);
    return null;
  }
}

async function generateSummary() {
  const TRADES_PATH = path.join(__dirname, '../output/trades-manual.json');
  const PENDING_PATH = path.join(__dirname, '../output/picks-pending.json');
  let holdings = [];

  // trades-manual.json 로드 (실제 진입 데이터)
  let trades = [];
  if (fs.existsSync(TRADES_PATH)) {
    trades = JSON.parse(fs.readFileSync(TRADES_PATH, 'utf-8'));
  }

  if (SYMBOLS.length > 0) {
    // 지정된 종목들 분석
    for (const sym of SYMBOLS) {
      // 먼저 trades-manual.json에서 찾기 (실제 진입 데이터)
      const trade = trades.find(t => t.symbol === sym && t.result === 'open');

      if (trade) {
        // 실제 보유 중인 종목
        holdings.push({
          symbol: sym,
          buyPrice: trade.buyPrice,
          targetPrice: trade.target,
          stopLoss: trade.stop,
          analysisDate: trade.buyDate,
        });
      } else {
        // 보유 중이 아닌 종목 (추천만 받은 종목)
        let pending = null;
        if (fs.existsSync(PENDING_PATH)) {
          const pendingData = JSON.parse(fs.readFileSync(PENDING_PATH, 'utf-8'));
          pending = pendingData.find(p => p.symbol === sym);
        }

        holdings.push({
          symbol: sym,
          buyPrice: pending?.buyPrice || null,
          targetPrice: pending?.targetPrice || null,
          stopLoss: pending?.stopLoss || null,
          analysisDate: pending?.analysisDate || null,
        });
      }
    }
  } else {
    // 종목 지정 없으면 보유 중인 종목만
    const openTrades = trades.filter(t => t.result === 'open');

    if (openTrades.length === 0) {
      console.log('\n⚠️  보유 중인 종목이 없습니다.\n');
      return;
    }

    holdings = openTrades.map(t => ({
      symbol: t.symbol,
      buyPrice: t.buyPrice,
      targetPrice: t.target,
      stopLoss: t.stop,
      analysisDate: t.buyDate,
    }));
  }

  if (holdings.length === 0) {
    console.log('\n⚠️  분석할 종목이 없습니다.\n');
    return;
  }

  console.log(`\n${'='.repeat(70)}`);
  console.log(`📊 ${SYMBOLS.length > 0 ? '지정 종목' : '보유 종목'} 오늘의 요약 (${CUTOFF})`);
  console.log(`${'='.repeat(70)}\n`);

  const marketOpen = isMarketOpen();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const isToday = CUTOFF === today;

  if (marketOpen && isToday) {
    console.log(`🟢 장 중 실시간 데이터 사용\n`);
  }

  for (const pick of holdings) {
    const { symbol, buyPrice, targetPrice, stopLoss, analysisDate } = pick;

    let rows = await fetchHistory(symbol, CUTOFF);
    if (!rows || rows.length < 50) {
      console.log(`${symbol}: 데이터 부족\n`);
      continue;
    }

    // ── 장 중이면 실시간 데이터로 마지막 row 교체 ──
    if (marketOpen && isToday) {
      const liveQuote = await fetchLiveQuote(symbol);
      if (liveQuote) {
        const lastRow = rows[rows.length - 1];
        // 오늘 날짜가 이미 있으면 교체, 없으면 추가
        if (lastRow.date === today) {
          rows[rows.length - 1] = {
            date: today,
            open: liveQuote.open,
            high: liveQuote.high,
            low: liveQuote.low,
            close: liveQuote.price,
            rawClose: liveQuote.price,
            volume: liveQuote.volume
          };
        } else {
          rows.push({
            date: today,
            open: liveQuote.open,
            high: liveQuote.high,
            low: liveQuote.low,
            close: liveQuote.price,
            rawClose: liveQuote.price,
            volume: liveQuote.volume
          });
        }
      }
      await sleep(1000); // API rate limit
    }

    const closes = rows.map(r => r.close);
    const todayRow = rows[rows.length - 1];
    const yesterdayRow = rows[rows.length - 2];
    const prevClose = yesterdayRow.close;
    const todayClose = todayRow.close;
    const todayChange = todayClose - prevClose;
    const todayChangePct = (todayChange / prevClose * 100).toFixed(2);
    const todayVolume = todayRow.volume;
    const avgVol20 = avg(rows.slice(-20).map(r => r.volume));
    const volRatio = ((todayVolume / avgVol20 * 100) - 100).toFixed(0);

    const rsi = calcRSI(closes);
    const rsiPrev = calcRSI(closes.slice(0, -1));
    const rsiChange = rsi != null && rsiPrev != null ? (rsi - rsiPrev).toFixed(1) : null;

    const macd = calcMACD(closes);
    const macdPrev = calcMACD(closes.slice(0, -1));
    let macdStatus = '계산 불가';
    if (macd && macdPrev) {
      const wasPositive = macdPrev.histogram >= 0;
      const isPositive = macd.histogram >= 0;
      if (!wasPositive && isPositive) macdStatus = '🟢 골든크로스 발생!';
      else if (wasPositive && !isPositive) macdStatus = '🔴 데드크로스 발생!';
      else if (isPositive) macdStatus = '✅ 골든크로스 유지 중';
      else macdStatus = '⬜ 데드크로스 상태';
    }

    const ma50 = avg(closes.slice(-50));
    const ma50Dist = ((todayClose / ma50 - 1) * 100).toFixed(1);
    const ma50Status = todayClose >= ma50 ? `위 (+${ma50Dist}%)` : `아래 (${ma50Dist}%)`;

    let streak = 0;
    let streakType = '';
    for (let i = rows.length - 1; i >= 1; i--) {
      const prevRow = rows[i - 1];
      const currRow = rows[i];
      if (currRow.close > prevRow.close) {
        if (streakType === '' || streakType === 'up') {
          streakType = 'up';
          streak++;
        } else break;
      } else if (currRow.close < prevRow.close) {
        if (streakType === '' || streakType === 'down') {
          streakType = 'down';
          streak++;
        } else break;
      } else break;
    }
    const streakText = streak > 0
      ? `${streak}일 연속 ${streakType === 'up' ? '상승' : '하락'} 중`
      : '횡보 중';

    const toTarget = targetPrice ? ((targetPrice - todayClose) / todayClose * 100).toFixed(1) : null;
    const toStop = stopLoss ? ((todayClose - stopLoss) / todayClose * 100).toFixed(1) : null;
    const unrealizedPnL = buyPrice ? ((todayClose - buyPrice) / buyPrice * 100).toFixed(2) : null;
    const pnlIcon = unrealizedPnL && unrealizedPnL >= 0 ? '📈' : '📉';

    const atr = calcATR(rows);
    const distToTarget = targetPrice ? targetPrice - todayClose : null;
    const daysToTarget = distToTarget && atr > 0 ? Math.ceil(distToTarget / (atr * 0.55)) : null;

    let rsiStatus = '';
    if (rsi < 30) rsiStatus = '과매도 (반등 가능성)';
    else if (rsi < 45) rsiStatus = '약세권';
    else if (rsi < 55) rsiStatus = '중립권';
    else if (rsi < 70) rsiStatus = '강세권';
    else rsiStatus = '과매수 (조정 가능성)';

    let trend = '';
    if (streakType === 'up' && streak >= 2 && rsi > 45) trend = '상승 추세 강화 중';
    else if (streakType === 'up' && streak >= 1) trend = '상승 추세 진행 중';
    else if (streakType === 'down' && streak >= 2 && rsi < 45) trend = '하락 추세 강화 중';
    else if (streakType === 'down' && streak >= 1) trend = '하락 추세 진행 중';
    else trend = '횡보 중 — 방향성 대기';

    // AI 기반 심층 분석 생성
    const technicalData = {
      todayChangePct, todayVolume, avgVolume: avgVol20, volRatio,
      rsi, rsiPrev, rsiChange,
      macdData: macd,
      macdStatus,
      closes, volumes: rows.map(r => r.volume),
      streak, streakType,
      toTarget, toStop,
      buyPrice, targetPrice, stopLoss,
      trend
    };

    const aiSummary = await generateAIInsight(symbol, technicalData);
    const summary = aiSummary || `${symbol} AI 분석 실패 - 기본 정보만 표시`;

    // 출력
    console.log(`\n${'─'.repeat(70)}`);
    console.log(`${symbol} — 오늘의 요약${analysisDate ? ` (진입일: ${analysisDate})` : ''}`);
    console.log(`${'─'.repeat(70)}\n`);

    console.log(`📊 오늘의 움직임`);
    console.log(`   종가: $${todayClose.toFixed(2)} (${todayChangePct >= 0 ? '+' : ''}${todayChangePct}%, ${todayChange >= 0 ? '+' : ''}$${todayChange.toFixed(2)})`);
    console.log(`   거래량: ${(todayVolume / 1e6).toFixed(1)}M (평균 대비 ${volRatio >= 0 ? '+' : ''}${volRatio}%)`);
    console.log(`   ${streakText}\n`);

    console.log(`📈 기술적 상태`);
    console.log(`   RSI: ${rsiPrev?.toFixed(0) ?? '?'} → ${rsi?.toFixed(0) ?? '?'} (${rsiChange >= 0 ? '+' : ''}${rsiChange}pt, ${rsiStatus})`);
    console.log(`   MACD: ${macdStatus}`);
    console.log(`   50MA: ${ma50Status}`);
    console.log(`   추세: ${trend}\n`);

    if (buyPrice || targetPrice || stopLoss) {
      console.log(`🎯 포지션 현황`);
      if (buyPrice) console.log(`   진입가: $${buyPrice.toFixed(2)}`);
      if (targetPrice) console.log(`   목표가: $${targetPrice.toFixed(2)} (${toTarget}% 남음)`);
      if (stopLoss) console.log(`   손절가: $${stopLoss.toFixed(2)} (${toStop}% 여유)`);
      if (unrealizedPnL) console.log(`   평가손익: ${pnlIcon} ${unrealizedPnL >= 0 ? '+' : ''}${unrealizedPnL}%`);
      console.log('');
    }

    console.log(`🤖 AI 심층 분석`);
    console.log(summary);
    console.log('');
  }

  console.log(`${'='.repeat(70)}\n`);
}

generateSummary().catch(err => {
  console.error('에러:', err.message);
  process.exit(1);
});
