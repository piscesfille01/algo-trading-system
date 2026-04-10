#!/usr/bin/env node
/**
 * 진입 검토 및 포지션 계산 (개선 버전)
 * Usage: node scripts/review-entry.js AAPL MSFT GOOGL
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BALANCE_PATH = path.join(__dirname, '../output/balance.json');
const TRADES_PATH = path.join(__dirname, '../output/trades-manual.json');
const PICKS_PATH = path.join(__dirname, '../output/latest-picks.json');

// ── 현재가 조회 ────────────────────────────────────────────────────
async function getCurrentPrice(symbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`;
    const response = await fetch(url);
    const data = await response.json();
    return data?.chart?.result?.[0]?.meta?.regularMarketPrice || null;
  } catch (err) {
    return null;
  }
}

// ── SPY/VIX 조회 ────────────────────────────────────────────────────
async function getMarketState() {
  try {
    const [spyPrice, vixPrice] = await Promise.all([
      getCurrentPrice('SPY'),
      getCurrentPrice('^VIX')
    ]);

    let state = '정상';
    let warning = '';

    if (vixPrice > 25) {
      state = '고위험';
      warning = '⚠️ VIX 25+ (포지션 축소 권장)';
    } else if (vixPrice > 20) {
      state = '주의';
      warning = '⚠️ VIX 20+ (변동성 증가)';
    }

    return { spy: spyPrice, vix: vixPrice, state, warning };
  } catch (err) {
    return { spy: null, vix: null, state: '알 수 없음', warning: '' };
  }
}

// ── 포트폴리오 상태 조회 ─────────────────────────────────────────────
async function getPortfolioStatus() {
  const INITIAL_BALANCE = 10000;

  const trades = fs.existsSync(TRADES_PATH)
    ? JSON.parse(fs.readFileSync(TRADES_PATH, 'utf-8'))
    : [];

  // 청산 손익 계산
  const closedTrades = trades.filter(t => t.result !== 'open');
  const closedPnl = closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);

  // 보유 포지션 분석
  const openPositions = trades.filter(t => t.result === 'open');

  const positions = [];
  let totalUnrealizedPnL = 0;
  let totalInvested = 0;

  for (const pos of openPositions) {
    const currentPrice = await getCurrentPrice(pos.symbol);
    if (!currentPrice) continue;

    const shares = pos.shares || 0;
    const entryPrice = pos.buyPrice || 0;
    const invested = pos.invested || (shares * entryPrice);
    const currentValue = shares * currentPrice;
    const unrealizedPnL = currentValue - invested;
    const unrealizedPct = (unrealizedPnL / invested) * 100;

    totalInvested += invested;
    totalUnrealizedPnL += unrealizedPnL;

    // 목표가/손절가까지 거리
    const toTarget = pos.target ? ((pos.target - currentPrice) / currentPrice * 100).toFixed(1) : null;
    const toStop = pos.stop ? ((currentPrice - pos.stop) / currentPrice * 100).toFixed(1) : null;

    positions.push({
      symbol: pos.symbol,
      shares,
      entryPrice,
      currentPrice,
      invested,
      currentValue,
      unrealizedPnL,
      unrealizedPct,
      target: pos.target,
      stop: pos.stop,
      toTarget,
      toStop,
      sector: pos.sector || null
    });
  }

  // 잔액 계산: 초기금 + 청산손익 - 보유투자금
  const availableCash = INITIAL_BALANCE + closedPnl - totalInvested;
  const totalValue = INITIAL_BALANCE + closedPnl + totalUnrealizedPnL;

  return {
    balance: INITIAL_BALANCE + closedPnl,
    totalInvested,
    availableCash,
    totalUnrealizedPnL,
    totalValue,
    positions
  };
}

// ── Latest Picks 로드 ───────────────────────────────────────────────
function loadLatestPicks() {
  if (!fs.existsSync(PICKS_PATH)) return null;

  try {
    const data = JSON.parse(fs.readFileSync(PICKS_PATH, 'utf-8'));
    return data;
  } catch (err) {
    return null;
  }
}

// ── 종목 재검토 ─────────────────────────────────────────────────────
async function reviewSymbol(symbol, latestPicks) {
  const currentPrice = await getCurrentPrice(symbol);
  if (!currentPrice) return null;

  // Pick 정보 찾기
  const pickInfo = latestPicks?.picks.find(p => p.symbol === symbol);

  if (pickInfo) {
    // 추천가 vs 현재가 비교
    const priceDiff = currentPrice - pickInfo.buyPrice;
    const priceDiffPct = (priceDiff / pickInfo.buyPrice) * 100;

    let priceStatus = '적정';
    let priceWarning = '';

    if (priceDiffPct > 3) {
      priceStatus = '고가';
      priceWarning = `⚠️ 추천가보다 ${priceDiffPct.toFixed(1)}% 높음 (갭 위험)`;
    } else if (priceDiffPct < -3) {
      priceStatus = '저가';
      priceWarning = `✅ 추천가보다 ${Math.abs(priceDiffPct).toFixed(1)}% 낮음 (기회)`;
    }

    return {
      symbol,
      currentPrice,
      ...pickInfo,
      priceDiff,
      priceDiffPct,
      priceStatus,
      priceWarning,
      isRecommended: true
    };
  }

  // 추천 리스트에 없는 종목
  return {
    symbol,
    currentPrice,
    isRecommended: false,
    warning: '⚠️ 최근 추천 리스트에 없음 - 직접 분석 필요'
  };
}

// ── 포지션 계산 (점수 × R:R 기반 가중치) ─────────────────────────────
function calculatePositions(symbols, availableCash, strategy = 'optimized') {
  const positions = [];

  if (strategy === 'optimized') {
    // 점수 × R:R 기반 가중치 계산
    const weights = symbols.map(s => ({
      symbol: s.symbol,
      weight: (s.score || 10) * Math.max(s.rrRatio || 1, 0.5), // 최소 0.5
      data: s
    }));

    const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0);

    for (const w of weights) {
      // 가중치 비율로 할당 (최소 5%, 최대 10% - 데일리 트레이딩)
      let percentage = (w.weight / totalWeight) * 100;
      percentage = Math.max(5, Math.min(10, percentage));

      const allocation = availableCash * (percentage / 100);
      const shares = Math.floor(allocation / w.data.currentPrice);
      const estimatedCost = shares * w.data.currentPrice;

      positions.push({
        ...w.data,
        allocation,
        percentage,
        shares,
        estimatedCost,
        weight: w.weight.toFixed(1)
      });
    }
  } else {
    // 기존 균등 분배 (legacy - 데일리 트레이딩 조정)
    const strategies = {
      conservative: 0.05,
      balanced: 0.08,
      aggressive: 0.10
    };

    const perStockPct = strategies[strategy] || 0.25;

    for (const sym of symbols) {
      const allocation = availableCash * perStockPct;
      const shares = Math.floor(allocation / sym.currentPrice);
      const estimatedCost = shares * sym.currentPrice;

      positions.push({
        ...sym,
        allocation,
        percentage: perStockPct * 100,
        shares,
        estimatedCost
      });
    }
  }

  return positions;
}

// ── 진입 우선순위 계산 ────────────────────────────────────────────────
function calculatePriority(positions) {
  return positions
    .map(p => {
      let priority = 0;
      let reasons = [];

      // 점수
      if (p.score >= 20) {
        priority += 10;
        reasons.push('고득점');
      } else if (p.score >= 15) {
        priority += 5;
      }

      // R:R 비율
      if (p.rrRatio >= 1.5) {
        priority += 8;
        reasons.push('높은 R:R');
      } else if (p.rrRatio >= 1.0) {
        priority += 4;
      }

      // 가격 상태
      if (p.priceStatus === '저가') {
        priority += 5;
        reasons.push('저가 기회');
      } else if (p.priceStatus === '고가') {
        priority -= 3;
        reasons.push('갭 위험');
      }

      // 확신도
      if (p.confidence >= 85) {
        priority += 3;
        reasons.push('높은 확신도');
      }

      return { ...p, priority, reasons };
    })
    .sort((a, b) => b.priority - a.priority);
}

// ── 리스크 분석 ─────────────────────────────────────────────────────
function analyzeRisks(positions, portfolio, market) {
  const risks = [];

  // 동시 보유
  const totalPositions = portfolio.positions.length + positions.length;
  if (totalPositions > 5) {
    risks.push(`⚠️ 동시 보유 ${totalPositions}개 (권장 5개 이하)`);
  }

  // 총 투자 비중 (데일리 트레이딩: 50% 이하 권장)
  const totalCost = positions.reduce((sum, p) => sum + p.estimatedCost, 0);
  const totalInvestmentPct = ((portfolio.totalInvested + totalCost) / portfolio.balance) * 100;
  if (totalInvestmentPct > 50) {
    risks.push(`⚠️ 총 투자 비중 ${totalInvestmentPct.toFixed(0)}% (데일리 트레이딩 권장 50% 이하)`);
  }

  // 시장 상황
  if (market.state === '고위험') {
    risks.push(`🔴 ${market.warning} - 포지션 5% 이하 권장`);
  } else if (market.state === '주의') {
    risks.push(`🟡 ${market.warning}`);
  }

  // 동일 섹터
  const sectors = {};
  [...portfolio.positions, ...positions].forEach(p => {
    if (p.sector) {
      sectors[p.sector] = (sectors[p.sector] || 0) + 1;
    }
  });

  for (const [sector, count] of Object.entries(sectors)) {
    if (count >= 3) {
      risks.push(`⚠️ ${sector} 섹터 ${count}개 (분산 필요)`);
    }
  }

  // 갭 위험
  const gapRisks = positions.filter(p => p.priceStatus === '고가');
  if (gapRisks.length > 0) {
    risks.push(`⚠️ 갭 위험: ${gapRisks.map(p => p.symbol).join(', ')}`);
  }

  return risks;
}

// ── 메인 ─────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const confirmFlag = args.includes('--confirm');
  const symbols = args.filter(arg => !arg.startsWith('--'));

  if (symbols.length === 0) {
    console.log(`
사용법: node scripts/review-entry.js SYMBOL1 SYMBOL2 ... [--confirm]

예시:
  node scripts/review-entry.js TKO SWKS              # 검토만
  node scripts/review-entry.js TKO SWKS --confirm    # 검토 + 자동 진입
`);
    process.exit(1);
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📊 진입 검토 - ${symbols.join(', ')}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // 1. 시장 상태
  console.log('⏳ 시장 상태 확인 중...');
  const market = await getMarketState();
  console.log(`   SPY: $${market.spy?.toFixed(2) || 'N/A'}  |  VIX: ${market.vix?.toFixed(2) || 'N/A'}  |  상태: ${market.state}\n`);

  // 2. 포트폴리오 상태
  console.log('⏳ 포트폴리오 조회 중...\n');
  const portfolio = await getPortfolioStatus();

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('💼 현재 포트폴리오');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`잔액 (총):        $${portfolio.balance.toFixed(2)}`);
  console.log(`투자 중:          $${portfolio.totalInvested.toFixed(2)}`);
  console.log(`가용 현금:        $${portfolio.availableCash.toFixed(2)}`);

  if (portfolio.totalInvested > 0) {
    const pnlSign = portfolio.totalUnrealizedPnL >= 0 ? '+' : '';
    console.log(`미실현 손익:      ${pnlSign}$${portfolio.totalUnrealizedPnL.toFixed(2)} (${pnlSign}${((portfolio.totalUnrealizedPnL/portfolio.totalInvested)*100).toFixed(2)}%)`);
  } else {
    console.log(`미실현 손익:      $0.00`);
  }

  console.log(`총 자산:          $${portfolio.totalValue.toFixed(2)}\n`);

  if (portfolio.positions.length > 0) {
    console.log('보유 종목:');
    for (const pos of portfolio.positions) {
      const pnlSign = pos.unrealizedPnL >= 0 ? '+' : '';
      const pnlColor = pos.unrealizedPnL >= 0 ? '🟢' : '🔴';
      console.log(`  ${pnlColor} ${pos.symbol.padEnd(6)} ${pos.shares}주 @ $${pos.entryPrice.toFixed(2)} → $${pos.currentPrice.toFixed(2)} | ${pnlSign}$${pos.unrealizedPnL.toFixed(2)} (${pnlSign}${pos.unrealizedPct.toFixed(2)}%)`);

      const targetInfo = pos.toTarget ? `목표까지 +${pos.toTarget}%` : 'N/A';
      const stopInfo = pos.toStop ? `손절까지 -${pos.toStop}%` : 'N/A';
      console.log(`           ${targetInfo}  |  ${stopInfo}`);
    }
    console.log('');
  } else {
    console.log('보유 종목 없음\n');
  }

  // 3. Latest Picks 로드
  const latestPicks = loadLatestPicks();
  if (latestPicks) {
    console.log(`📋 최근 추천 (${latestPicks.date}): ${latestPicks.picks.length}개 종목\n`);
  }

  // 4. 선택 종목 재검토
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔍 선택 종목 상세 검토');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const reviewedSymbols = [];
  for (const sym of symbols) {
    process.stdout.write(`${sym} 분석 중...`);
    const review = await reviewSymbol(sym, latestPicks);
    if (review) {
      reviewedSymbols.push(review);
      console.log(` ✓\n`);

      if (review.isRecommended) {
        console.log(`  점수:       ${review.score}/10 ${review.score >= 18 ? '🔥' : review.score >= 15 ? '✅' : ''}`);
        console.log(`  추천가:     $${review.buyPrice.toFixed(2)}`);
        console.log(`  현재가:     $${review.currentPrice.toFixed(2)} ${review.priceWarning}`);
        console.log(`  목표가:     $${review.target.toFixed(2)} (+${review.targetPct}%)`);
        console.log(`  손절가:     $${review.stop.toFixed(2)} (${review.stopPct}%)`);
        console.log(`  R:R 비율:   ${review.rrRatio}`);
        console.log(`  확신도:     ${review.confidence}%`);

        if (review.patterns && review.patterns.length > 0) {
          console.log(`  패턴:`);
          review.patterns.slice(0, 3).forEach(p => console.log(`    · ${p}`));
        }
      } else {
        console.log(`  ${review.warning}`);
        console.log(`  현재가:     $${review.currentPrice.toFixed(2)}`);
      }
      console.log('');
    } else {
      console.log(` ❌ 조회 실패\n`);
    }
  }

  if (reviewedSymbols.length === 0) {
    console.log('\n❌ 조회 가능한 종목이 없습니다.\n');
    process.exit(1);
  }

  // 5. 포지션 계산
  const positions = calculatePositions(reviewedSymbols, portfolio.availableCash, 'optimized');

  // 6. 우선순위 계산
  const prioritized = calculatePriority(positions);

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📈 신규 진입 계획 (균형 전략: 25%)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  let totalCost = 0;
  prioritized.forEach((pos, idx) => {
    const rank = idx + 1;
    const emoji = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}.`;

    console.log(`${emoji} ${pos.symbol} ${pos.isRecommended ? `(점수 ${pos.score})` : ''}`);
    console.log(`   배분:       $${pos.allocation.toFixed(2)} (${pos.percentage}%)`);
    console.log(`   매수:       ${pos.shares}주 × $${pos.currentPrice.toFixed(2)} = $${pos.estimatedCost.toFixed(2)}`);

    if (pos.isRecommended) {
      console.log(`   목표/손절:  $${pos.target.toFixed(2)} / $${pos.stop.toFixed(2)}`);
    }

    if (pos.reasons.length > 0) {
      console.log(`   우선순위:   ${pos.reasons.join(', ')}`);
    }

    console.log('');
    totalCost += pos.estimatedCost;
  });

  console.log(`총 투자액:      $${totalCost.toFixed(2)}`);
  console.log(`잔여 현금:      $${(portfolio.availableCash - totalCost).toFixed(2)}\n`);

  // 7. 리스크 분석
  const risks = analyzeRisks(prioritized, portfolio, market);

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('⚠️  종합 리스크 분석');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (risks.length > 0) {
    risks.forEach(r => console.log(r));
  } else {
    console.log('✅ 리스크 양호');
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('💡 추천 진입 순서');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  prioritized.forEach((pos, idx) => {
    console.log(`${idx + 1}. ${pos.symbol.padEnd(6)} - ${pos.reasons.join(', ') || '기본'}`);
  });

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ 검토 완료');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // --confirm 플래그: 자동 진입 기록
  if (confirmFlag) {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📝 진입 기록 중...');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const trades = fs.existsSync(TRADES_PATH)
      ? JSON.parse(fs.readFileSync(TRADES_PATH, 'utf-8'))
      : [];

    const balance = fs.existsSync(BALANCE_PATH)
      ? JSON.parse(fs.readFileSync(BALANCE_PATH, 'utf-8'))
      : { balance: 10000 };

    const today = new Date().toISOString().split('T')[0];
    let successCount = 0;

    for (const pos of prioritized) {
      if (!pos.isRecommended || pos.shares === 0) {
        console.log(`⚠️  ${pos.symbol}: 추천 없음 또는 주수 0 → 스킵\n`);
        continue;
      }

      // 진입 근거 작성 (자연어)
      const targetGain = ((pos.target - pos.currentPrice) / pos.currentPrice * 100).toFixed(1);
      const stopLoss = ((pos.currentPrice - pos.stop) / pos.currentPrice * 100).toFixed(1);

      let entryRationale = `${pos.symbol} 진입 (점수 ${pos.score}/10)\n\n`;
      entryRationale += `목표: +${targetGain}% | 손절: -${stopLoss}% | R:R ${pos.rrRatio}\n\n`;
      entryRationale += `진입 근거:\n`;

      // 패턴 정보 추가
      if (pos.patterns && pos.patterns.length > 0) {
        pos.patterns.slice(0, 5).forEach((pattern, idx) => {
          entryRationale += `${idx + 1}. ${pattern.replace(/[📊✅⚡🔥⭐🚀]/g, '').trim()}\n`;
        });
      }

      // 가격 상태 추가
      if (pos.priceWarning) {
        entryRationale += `\n가격: ${pos.priceWarning}`;
      }

      const newTrade = {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        symbol: pos.symbol,
        buyDate: today,
        buyPrice: pos.currentPrice,
        invested: pos.estimatedCost,
        shares: pos.shares,
        target: pos.target,
        stop: pos.stop,
        sellDate: null,
        sellPrice: null,
        result: 'open',
        pnl: null,
        pnlPct: null,
        notes: entryRationale
      };

      trades.push(newTrade);
      balance.balance -= pos.estimatedCost;

      console.log(`✅ ${pos.symbol} 진입 기록`);
      console.log(`   ${pos.shares}주 × $${pos.currentPrice.toFixed(2)} = $${pos.estimatedCost.toFixed(2)}`);
      console.log(`   목표: $${pos.target.toFixed(2)} / 손절: $${pos.stop.toFixed(2)}\n`);

      successCount++;
    }

    // 저장
    fs.writeFileSync(TRADES_PATH, JSON.stringify(trades, null, 2));
    fs.writeFileSync(BALANCE_PATH, JSON.stringify(balance, null, 2));

    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`✅ ${successCount}개 종목 진입 완료`);
    console.log(`   현재 잔고: $${balance.balance.toFixed(2)}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    console.log('💡 Dashboard 자동 업데이트됨 (새로고침하세요)\n');
  } else {
    console.log('다음 단계:');
    console.log('  1. 우선순위 순서대로 진입');
    console.log('  2. 자동 진입: node scripts/review-entry.js ' + symbols.join(' ') + ' --confirm');
    console.log('  3. 수동 진입: Dashboard에서 Add Position\n');
  }
}

main().catch(console.error);
