#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yahooFinance from 'yahoo-finance2';

// Yahoo Finance 설문 메시지 숨기기
yahooFinance.suppressNotices(['yahooSurvey']);

// ═══════════════════════════════════════════════════════════════════
// 보유 종목 매일 분석 스크립트
// 용도: 보유 중인 종목의 실시간 지표를 분석하고 손익비 조정 제안
// 사용: node scripts/analyze-position.js CTSH AXP
// ═══════════════════════════════════════════════════════════════════

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TRADES_PATH = path.join(__dirname, '../output/trades-manual.json');
const CACHE_DIR = path.join(__dirname, '../output/cache');

// 캐시 디렉토리 생성
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// ── RSI 계산 ──
function calculateRSI(prices, period = 14) {
  if (prices.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

// ── MACD 계산 ──
function calculateMACD(prices) {
  if (prices.length < 26) return null;
  const ema12 = prices.slice(-12).reduce((a, b) => a + b) / 12;
  const ema26 = prices.slice(-26).reduce((a, b) => a + b) / 26;
  return ema12 - ema26;
}

// ── ATR 계산 ──
function calculateATR(highs, lows, closes, period = 14) {
  if (highs.length < period) return null;
  let tr = [];
  for (let i = 1; i < highs.length; i++) {
    const high = highs[i];
    const low = lows[i];
    const prevClose = closes[i - 1];
    tr.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  return tr.slice(-period).reduce((a, b) => a + b) / period;
}

// ── 거래량 분석 ──
function analyzeVolume(volumes) {
  if (volumes.length < 20) return { avg: 0, current: 0, pct: 0 };
  const avg = volumes.slice(-20, -1).reduce((a, b) => a + b) / 19;
  const current = volumes[volumes.length - 1];
  const pct = ((current - avg) / avg) * 100;
  return { avg, current, pct };
}

// ── 옵션 데이터 가져오기 (Polygon.io) ──
async function getOptionsData(symbol) {
  try {
    const apiKey = process.env.POLYGON_API_KEY;
    if (!apiKey) return null;

    const response = await fetch(
      `https://api.polygon.io/v3/snapshot/options/${symbol}?apiKey=${apiKey}`
    );
    if (!response.ok) return null;

    const data = await response.json();
    if (!data.results || data.results.length === 0) return null;

    // Put/Call ratio 계산
    let totalCallVol = 0, totalPutVol = 0;
    data.results.forEach(opt => {
      const vol = opt.day?.volume || 0;
      if (opt.details?.contract_type === 'call') totalCallVol += vol;
      else if (opt.details?.contract_type === 'put') totalPutVol += vol;
    });

    const pcRatio = totalCallVol > 0 ? totalPutVol / totalCallVol : null;
    return { pcRatio, callVol: totalCallVol, putVol: totalPutVol };
  } catch (err) {
    return null;
  }
}

// ── 메인 분석 함수 ──
async function analyzePosition(symbol, trade) {
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📊 ${symbol} 분석`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  try {
    // 현재가 및 차트 데이터
    const quote = await yahooFinance.quote(symbol);
    const currentPrice = quote.regularMarketPrice;

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 60);

    const history = await yahooFinance.chart(symbol, {
      period1: startDate,
      period2: endDate,
      interval: '1d'
    });

    const closes = history.quotes.map(q => q.close);
    const highs = history.quotes.map(q => q.high);
    const lows = history.quotes.map(q => q.low);
    const volumes = history.quotes.map(q => q.volume);

    // 기술적 지표 계산
    const rsi = calculateRSI(closes);
    const macd = calculateMACD(closes);
    const atr = calculateATR(highs, lows, closes);
    const volAnalysis = analyzeVolume(volumes);

    // 옵션 데이터
    const optionsData = await getOptionsData(symbol);

    // 포지션 현황
    const buyPrice = trade.buyPrice;
    const target = trade.target;
    const stop = trade.stop;
    const invested = trade.invested;
    const shares = trade.shares;

    const currentPnL = (currentPrice - buyPrice) * shares;
    const currentPnLPct = ((currentPrice - buyPrice) / buyPrice) * 100;

    const toTarget = ((currentPrice - buyPrice) / (target - buyPrice)) * 100;
    const fromStop = ((currentPrice - stop) / currentPrice) * 100;

    const buyDate = new Date(trade.buyDate);
    const today = new Date();
    const holdDays = Math.floor((today - buyDate) / (1000 * 60 * 60 * 24));

    // ═══════════════════════════════════════════════════════════════
    // 📌 포지션 현황
    // ═══════════════════════════════════════════════════════════════
    console.log(`📌 포지션 현황`);
    console.log(`진입: $${buyPrice.toFixed(2)} (${trade.buyDate})`);
    console.log(`현재: $${currentPrice.toFixed(2)} (${currentPnLPct >= 0 ? '+' : ''}${currentPnLPct.toFixed(1)}%, 보유 ${holdDays}일)`);
    console.log(`목표: $${target.toFixed(2)} (+${(((target - buyPrice) / buyPrice) * 100).toFixed(1)}%) → ${toTarget.toFixed(1)}% 달성`);
    console.log(`손절: $${stop.toFixed(2)} (${(((stop - buyPrice) / buyPrice) * 100).toFixed(1)}%) → ${fromStop >= 0 ? '+' : ''}${fromStop.toFixed(1)}% 여유`);
    console.log(`\n미실현 손익: ${currentPnL >= 0 ? '+' : ''}$${currentPnL.toFixed(2)} (${currentPnLPct >= 0 ? '+' : ''}${currentPnLPct.toFixed(1)}%)`);
    console.log(`투자액: $${invested} (${shares}주)\n`);

    // ═══════════════════════════════════════════════════════════════
    // 📊 기술적 지표
    // ═══════════════════════════════════════════════════════════════
    console.log(`📊 기술적 지표`);
    console.log(`RSI(14): ${rsi ? rsi.toFixed(1) : 'N/A'} ${rsi > 70 ? '(과매수 ⚠️)' : rsi > 55 ? '(강세)' : rsi < 30 ? '(과매도)' : '(중립)'}`);
    console.log(`MACD: ${macd ? macd.toFixed(2) : 'N/A'} ${macd > 0 ? '(상승 중 ✅)' : '(하락 중 ⚠️)'}`);
    console.log(`거래량: 평균 대비 ${volAnalysis.pct >= 0 ? '+' : ''}${volAnalysis.pct.toFixed(0)}% ${Math.abs(volAnalysis.pct) > 50 ? '(급증 🔥)' : '(보통)'}`);
    console.log(`ATR(14): $${atr ? atr.toFixed(2) : 'N/A'} (${atr ? ((atr / currentPrice) * 100).toFixed(1) : 'N/A'}%)\n`);

    if (optionsData && optionsData.pcRatio !== null) {
      console.log(`📈 옵션 세력`);
      console.log(`P/C Ratio: ${optionsData.pcRatio.toFixed(2)} ${optionsData.pcRatio < 0.5 ? '(강한 콜 매수 🚀)' : optionsData.pcRatio > 1.5 ? '(강한 풋 매수 ⚠️)' : '(중립)'}`);
      console.log(`콜 거래량: ${optionsData.callVol.toLocaleString()}, 풋 거래량: ${optionsData.putVol.toLocaleString()}\n`);
    }

    // ═══════════════════════════════════════════════════════════════
    // ⚠️ 분석 & 제안
    // ═══════════════════════════════════════════════════════════════
    console.log(`⚠️ 분석 & 제안\n`);

    const suggestions = [];
    const warnings = [];

    // 1. Trailing Stop 제안
    if (currentPnLPct >= 3 && stop < buyPrice) {
      suggestions.push({
        type: '💡 Trailing Stop',
        current: `$${stop.toFixed(2)} (${(((stop - buyPrice) / buyPrice) * 100).toFixed(1)}%)`,
        proposed: `$${buyPrice.toFixed(2)} (본전)`,
        reason: '수익 +3% 이상 → 본전으로 손절가 상향 권장'
      });
    } else if (currentPnLPct >= 6 && stop < buyPrice * 1.03) {
      suggestions.push({
        type: '💡 Trailing Stop',
        current: `$${stop.toFixed(2)}`,
        proposed: `$${(buyPrice * 1.03).toFixed(2)} (+3%)`,
        reason: '수익 +6% 이상 → 손절가를 +3%로 상향 권장'
      });
    }

    // 2. 목표가 조정 제안
    if (toTarget >= 80 && rsi > 60 && macd > 0 && volAnalysis.pct > 20) {
      suggestions.push({
        type: '🎯 목표가 상향',
        current: `$${target.toFixed(2)}`,
        proposed: `$${(target * 1.05).toFixed(2)} (+5%)`,
        reason: '목표가 80% 도달 + 강한 모멘텀 → 목표가 추가 상향 고려'
      });
    }

    // 3. 조기 익절 제안
    if (rsi > 75 && volAnalysis.pct < -20) {
      warnings.push({
        type: '⚠️ 조기 익절 고려',
        reason: 'RSI 과매수(75+) + 거래량 급감 → 상승 모멘텀 약화 신호'
      });
    }

    // 4. 손절 재검토
    if (macd < 0 && rsi < 45 && volAnalysis.pct > 50) {
      warnings.push({
        type: '🚨 손절 재검토',
        reason: 'MACD 하락전환 + 거래량 급증 → 약세 전환 가능성'
      });
    }

    // 5. 옵션 세력 경고
    if (optionsData && optionsData.pcRatio > 1.5) {
      warnings.push({
        type: '⚠️ 풋 세력 유입',
        reason: `P/C Ratio ${optionsData.pcRatio.toFixed(2)} → 하락 베팅 증가`
      });
    }

    // 6. 목표가 임박
    if (toTarget >= 90) {
      suggestions.push({
        type: '✅ 목표가 임박',
        current: `$${currentPrice.toFixed(2)}`,
        target: `$${target.toFixed(2)}`,
        reason: `목표가 ${toTarget.toFixed(1)}% 달성 → 청산 준비`
      });
    }

    // 7. 손절가 근접
    if (fromStop < 2 && fromStop >= 0) {
      warnings.push({
        type: '🚨 손절가 근접',
        reason: `손절가까지 ${fromStop.toFixed(1)}% 남음 → 주의 필요`
      });
    }

    // ═══════════════════════════════════════════════════════════════
    // 🎯 조정된 목표/손절 (실시간 데이터 기반)
    // ═══════════════════════════════════════════════════════════════
    let adjustedTarget = target;
    let adjustedStop = stop;
    let adjustmentReasons = [];

    // 1. Trailing Stop (수익 보호)
    if (currentPnLPct >= 6 && stop < buyPrice * 1.03) {
      adjustedStop = buyPrice * 1.03;
      adjustmentReasons.push('수익 +6% → 손절가 +3%로 상향');
    } else if (currentPnLPct >= 3 && stop < buyPrice) {
      adjustedStop = buyPrice;
      adjustmentReasons.push('수익 +3% → 본전 손절로 상향');
    }

    // 2. 목표가 상향 (강한 모멘텀)
    if (toTarget >= 80 && rsi > 60 && macd > 0 && volAnalysis.pct > 20) {
      adjustedTarget = target * 1.05;
      adjustmentReasons.push('강한 모멘텀 → 목표가 +5% 상향');
    }

    // 3. 조기 청산 모드 (과매수 또는 약세 전환)
    if (rsi > 75 && volAnalysis.pct < -20) {
      adjustedTarget = currentPrice * 1.02; // 현재가 +2%로 하향
      adjustedStop = Math.max(adjustedStop, currentPrice * 0.98); // 현재가 -2%로 타이트하게
      adjustmentReasons.push('⚠️ RSI 과매수 → 조기 청산 모드');
    } else if (macd < 0 && rsi < 45) {
      adjustedStop = Math.max(adjustedStop, currentPrice * 0.97); // 현재가 -3%로 타이트하게
      adjustmentReasons.push('⚠️ MACD 하락전환 → 손절가 타이트하게');
    }

    // 4. 옵션 풋 세력 경고
    if (optionsData && optionsData.pcRatio > 1.5) {
      adjustedStop = Math.max(adjustedStop, currentPrice * 0.98);
      adjustmentReasons.push('⚠️ 풋 세력 유입 → 손절가 상향');
    }

    console.log(`🎯 조정된 목표/손절 (실시간 기반)\n`);

    const targetChanged = Math.abs(adjustedTarget - target) > 0.01;
    const stopChanged = Math.abs(adjustedStop - stop) > 0.01;

    if (!targetChanged && !stopChanged) {
      console.log(`✅ 조정 불필요 - 현재 설정 유지`);
      console.log(`목표: $${target.toFixed(2)}`);
      console.log(`손절: $${stop.toFixed(2)}\n`);
    } else {
      if (targetChanged) {
        console.log(`📈 목표가 조정`);
        console.log(`   기존: $${target.toFixed(2)} → 조정: $${adjustedTarget.toFixed(2)} (${((adjustedTarget - target) / target * 100).toFixed(1)}%)`);
      } else {
        console.log(`✅ 목표가: $${target.toFixed(2)} (유지)`);
      }

      if (stopChanged) {
        console.log(`🛡️ 손절가 조정`);
        console.log(`   기존: $${stop.toFixed(2)} → 조정: $${adjustedStop.toFixed(2)} (${((adjustedStop - stop) / stop * 100).toFixed(1)}%)`);
      } else {
        console.log(`✅ 손절가: $${stop.toFixed(2)} (유지)`);
      }

      console.log(`\n💡 조정 사유:`);
      adjustmentReasons.forEach(r => console.log(`   - ${r}`));
      console.log();
    }

    // 출력
    if (suggestions.length === 0 && warnings.length === 0) {
      console.log(`✅ 정상 추세 유지`);
      console.log(`- 목표가 ${toTarget.toFixed(1)}% 달성, 순항 중`);
      console.log(`- 기술적 지표 건강함`);
    } else {
      if (suggestions.length > 0) {
        console.log(`💡 추가 제안\n`);
        suggestions.forEach(s => {
          console.log(`${s.type}`);
          if (s.current && s.proposed) {
            console.log(`- 현재: ${s.current}`);
            console.log(`- 제안: ${s.proposed}`);
          }
          if (s.target) {
            console.log(`- 현재: ${s.current}, 목표: ${s.target}`);
          }
          console.log(`- 사유: ${s.reason}\n`);
        });
      }

      if (warnings.length > 0) {
        console.log(`⚠️ 경고\n`);
        warnings.forEach(w => {
          console.log(`${w.type}`);
          console.log(`- ${w.reason}\n`);
        });
      }
    }

  } catch (err) {
    if (err.message.includes('Too Many Requests') || err.message.includes('429')) {
      console.error(`❌ ${symbol} 분석 실패: Yahoo Finance API 호출 제한`);
      console.error(`\n💡 해결책:`);
      console.error(`   1. 5-10분 기다렸다가 다시 시도`);
      console.error(`   2. 또는 summary.js 사용 (캐시된 데이터 사용)`);
      console.error(`      → node scripts/summary.js\n`);
    } else {
      console.error(`❌ ${symbol} 분석 실패:`, err.message);
    }
  }
}

// ── 메인 실행 ──
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(`사용법: node scripts/analyze-position.js SYMBOL1 SYMBOL2 ...`);
    console.log(`예시: node scripts/analyze-position.js CTSH AXP`);
    process.exit(1);
  }

  // trades-manual.json 로드
  if (!fs.existsSync(TRADES_PATH)) {
    console.error(`❌ ${TRADES_PATH} 파일이 없습니다.`);
    process.exit(1);
  }

  const trades = JSON.parse(fs.readFileSync(TRADES_PATH, 'utf-8'));
  const openTrades = trades.filter(t => t.result === 'open');

  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📊 보유 종목 분석 (${new Date().toISOString().split('T')[0]})`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  for (const symbol of args) {
    const trade = openTrades.find(t => t.symbol === symbol.toUpperCase());
    if (!trade) {
      console.log(`\n⚠️ ${symbol}: 보유 중인 포지션 없음\n`);
      continue;
    }

    await analyzePosition(symbol.toUpperCase(), trade);
    await new Promise(resolve => setTimeout(resolve, 2000)); // API rate limit
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`✅ 분석 완료\n`);
}

main().catch(console.error);
