#!/usr/bin/env node
/**
 * 개별 종목 실시간 분석
 * 사용법: node scripts/analyze.js CTSH
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TRADES_PATH = path.join(__dirname, '../output/trades-manual.json');
const CACHE_DIR   = path.resolve('output/cache');

const symbol = process.argv[2]?.toUpperCase();
if (!symbol) { console.error('사용법: node scripts/analyze.js CTSH'); process.exit(1); }

const YH_HDR = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': '*/*', 'Referer': 'https://finance.yahoo.com/',
};
const line  = '━'.repeat(58);
const line2 = '─'.repeat(58);

// ── 유틸 ──────────────────────────────────────────────────────
function avg(arr) { return arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0; }
function cacheGet(key) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, `${key}.json`), 'utf-8'));
    // 히스토리 캐시: 장 마감 후(ET 18:00+) 갱신 필요 여부 확인
    if (Array.isArray(raw) && raw._cachedAt) {
      const etNowH = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })).getHours();
      const cachedDate = raw._cachedAt.slice(0, 10);
      const todayET = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
      // 오늘 캐시면 장중(9-18시)에는 재사용, 장 끝난 후면 폐기
      if (cachedDate === todayET && etNowH >= 18) return null;
      // 어제 이전 캐시면 폐기
      if (cachedDate < todayET) return null;
    }
    return raw;
  } catch { return null; }
}
function cacheSet(key, data) {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
  if (Array.isArray(data)) data._cachedAt = new Date().toISOString();
  fs.writeFileSync(path.join(CACHE_DIR, `${key}.json`), JSON.stringify(data));
}

// ── 기술적 지표 ────────────────────────────────────────────────
function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let g = 0, l = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const d = closes[i] - closes[i-1];
    if (d > 0) g += d; else l -= d;
  }
  if (l === 0) return 100;
  return parseFloat((100 - 100 / (1 + (g/period) / (l/period))).toFixed(1));
}
function calcRSIAt(closes, endIdx, period = 14) {
  if (endIdx < period) return null;
  let g = 0, l = 0;
  for (let i = endIdx - period + 1; i <= endIdx; i++) {
    const d = closes[i] - closes[i-1];
    if (d > 0) g += d; else l -= d;
  }
  if (l === 0) return 100;
  return parseFloat((100 - 100 / (1 + (g/period) / (l/period))).toFixed(1));
}
function calcEMA(data, p) {
  if (!data || data.length < p) return null;
  const k = 2 / (p + 1);
  let e = avg(data.slice(0, p));
  for (let i = p; i < data.length; i++) e = data[i] * k + e * (1 - k);
  return e;
}
function calcMACDSeries(closes) {
  // 전체 히스토리 기반 MACD 라인 시리즈 생성 (EMA warm-up 포함)
  const series = [];
  for (let i = 25; i < closes.length; i++) {
    const slice = closes.slice(0, i + 1);
    const e12 = calcEMA(slice, 12), e26 = calcEMA(slice, 26);
    if (e12 != null && e26 != null) series.push(e12 - e26);
  }
  return series;
}
function calcMACD(closes) {
  if (closes.length < 35) return null;
  const macdSeries = calcMACDSeries(closes);
  if (macdSeries.length < 9) return null;
  const macdLine = macdSeries.at(-1);
  // signal = EMA(9) of MACD series (TradingView 동일 방식)
  const signal = calcEMA(macdSeries, 9);
  if (signal == null) return null;
  const hist = macdLine - signal;
  return {
    line:   parseFloat(macdLine.toFixed(4)),
    signal: parseFloat(signal.toFixed(4)),
    hist:   parseFloat(hist.toFixed(4)),
    rising: macdSeries.length >= 2 ? macdLine > macdSeries.at(-2) : false,
  };
}
// 최근 N일 MACD 히스토그램 시리즈 반환 (추세 분석용)
function calcMACDHistSeries(closes, n = 10) {
  // 전체 MACD 시리즈 → EMA(9) signal → 히스토그램 시리즈 끝 n개 반환
  const macdSeries = calcMACDSeries(closes);
  if (macdSeries.length < 9) return [];
  // signal EMA(9)를 각 시점별로 계산
  const histSeries = [];
  for (let i = 8; i < macdSeries.length; i++) {
    const sig = calcEMA(macdSeries.slice(0, i + 1), 9);
    if (sig != null) histSeries.push(parseFloat((macdSeries[i] - sig).toFixed(4)));
  }
  return histSeries.slice(-n);
}

function calcMACDLineAt(closes, endIdx) {
  if (endIdx < 26) return null;
  const slice = closes.slice(0, endIdx + 1);
  const e12 = calcEMA(slice, 12), e26 = calcEMA(slice, 26);
  return (e12 != null && e26 != null) ? e12 - e26 : null;
}
function calcBB(closes, period = 20, mult = 2) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const mean  = avg(slice);
  const std   = Math.sqrt(slice.reduce((s,v) => s + (v-mean)**2, 0) / period);
  return { upper: mean + mult*std, middle: mean, lower: mean - mult*std };
}
function calcATR(rows, period = 14) {
  if (rows.length < period + 1) return null;
  const trs = rows.slice(-period-1).map((r,i,arr) => {
    if (i === 0) return null;
    const p = arr[i-1];
    return Math.max(r.high - r.low, Math.abs(r.high - p.close), Math.abs(r.low - p.close));
  }).filter(Boolean);
  return trs.length ? avg(trs) : null;
}

// ── 스윙 저점 + 다이버전스 ────────────────────────────────────
function findSwingLows(rows, lookback = 70, wing = 3) {
  if (rows.length < lookback) return [];
  const slice = rows.slice(-lookback);
  const swings = [];
  for (let i = wing; i < slice.length - wing; i++) {
    let isLow = true;
    for (let j = 1; j <= wing; j++) {
      if (slice[i].low >= slice[i-j].low || slice[i].low >= slice[i+j].low) { isLow = false; break; }
    }
    if (isLow) swings.push({ idx: rows.length - lookback + i, price: slice[i].low, date: slice[i].date });
  }
  return swings;
}

function detectDivergence(rows) {
  if (rows.length < 80) return null;
  const closes = rows.map(r => r.close);
  const swings  = findSwingLows(rows, 70, 3);
  if (swings.length < 2) return null;

  const L2 = swings[swings.length - 1];
  const L1 = swings[swings.length - 2];
  const daysAgo = rows.length - 1 - L2.idx;

  if (daysAgo > 15 || L2.idx - L1.idx < 5 || L2.price >= L1.price) return null;

  const rsiL1 = calcRSIAt(closes, L1.idx);
  const rsiL2 = calcRSIAt(closes, L2.idx);
  if (rsiL1 == null || rsiL2 == null || rsiL1 > 50) return null;

  const macdL1 = calcMACDLineAt(closes, L1.idx);
  const macdL2 = calcMACDLineAt(closes, L2.idx);
  const rsiImprove = rsiL2 - rsiL1;
  const rsiDiv  = rsiL2 > rsiL1 && rsiImprove >= 5;
  const macdDiv = macdL1 != null && macdL2 != null && macdL2 > macdL1;

  if (!rsiDiv && !macdDiv) return null;

  const currentClose  = closes.at(-1);
  const recoveryPct   = (currentClose - L2.price) / L2.price * 100;

  return { L1, L2, rsiL1, rsiL2, rsiImprove, rsiDiv, macdDiv, daysAgo, recoveryPct };
}

// ── 과거 다이버전스 성공 이력 확인 ─────────────────────────────────
function checkHistoricalDivergences(rows) {
  const OUTCOME_DAYS = 20;
  const results = [];
  const seen = new Set();

  for (let endIdx = 100; endIdx <= rows.length - OUTCOME_DAYS - 5; endIdx += 5) {
    const slice = rows.slice(0, endIdx);
    const closes = slice.map(r => r.close);
    const swings = findSwingLows(slice, 70, 3);
    if (swings.length < 2) continue;

    const L2 = swings[swings.length - 1];
    const L1 = swings[swings.length - 2];
    const daysAgo = endIdx - 1 - L2.idx;
    if (daysAgo > 10 || L2.idx - L1.idx < 5 || L2.price >= L1.price) continue;
    if (seen.has(L2.idx)) continue;
    seen.add(L2.idx);

    const rsiL1 = calcRSIAt(closes, L1.idx);
    const rsiL2 = calcRSIAt(closes, L2.idx);
    if (!rsiL1 || !rsiL2 || rsiL1 > 50 || rsiL2 <= rsiL1) continue;
    const rsiImprove = rsiL2 - rsiL1;
    if (rsiImprove < 4) continue;

    const outcomeIdx = L2.idx + OUTCOME_DAYS;
    if (outcomeIdx >= rows.length) continue;
    const gainPct = parseFloat(((rows[outcomeIdx].close - L2.price) / L2.price * 100).toFixed(1));

    results.push({
      date: rows[L2.idx]?.date,
      L2price: L2.price,
      gainPct,
      success: gainPct > 2,
      rsiImprove
    });
  }

  if (results.length < 1) return null;
  const successes = results.filter(r => r.success);
  return {
    count: results.length,
    successCount: successes.length,
    successRate: Math.round(successes.length / results.length * 100),
    avgGainPct: parseFloat((results.reduce((s,r) => s + r.gainPct, 0) / results.length).toFixed(1)),
    avgSuccessGain: successes.length
      ? parseFloat((successes.reduce((s,r) => s + r.gainPct, 0) / successes.length).toFixed(1)) : 0,
    recent: results.slice(-3),
  };
}

// ── 데이터 패치 ────────────────────────────────────────────────
async function fetchHistory(sym) {
  const key = `yh_${sym.replace(/\./g,'-')}`;
  let rows = cacheGet(key);
  if (rows && rows[0]?.rawClose === undefined) rows = null;
  if (!rows) {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=2y`;
    const res = await fetch(url, { headers: YH_HDR });
    if (!res.ok) return null;
    const json = await res.json();
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
    cacheSet(key, rows);
  }
  return rows;
}

async function fetchLiveQuote(sym) {
  // range=1d + interval=1m → 오늘 실시간 데이터
  try {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5d`;
    const res = await fetch(url, { headers: YH_HDR });
    if (!res.ok) return null;
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) return null;
    const meta   = result.meta;
    const q      = result.indicators.quote[0];
    const closes = (result.indicators.adjclose?.[0]?.adjclose ?? q.close).filter(Boolean);
    const live     = meta.regularMarketPrice ?? closes.at(-1);
    const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? closes.at(-2);
    const dayChg   = prevClose ? parseFloat(((live - prevClose) / prevClose * 100).toFixed(2)) : null;
    const volume = q.volume?.at(-1) ?? 0;
    const high   = q.high?.at(-1)  ?? live;
    const low    = q.low?.at(-1)   ?? live;
    const open   = q.open?.at(-1)  ?? live;
    const today  = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    // 나이트마켓 / 프리마켓
    const postMktPrice = meta.postMarketPrice ?? null;
    const postMktChg   = meta.postMarketChangePercent ?? null;
    const preMktPrice  = meta.preMarketPrice  ?? null;
    const preMktChg    = meta.preMarketChangePercent  ?? null;
    return { price: parseFloat(live.toFixed(2)), dayChg, volume, high, low, open, prevClose, today,
             postMktPrice, postMktChg, preMktPrice, preMktChg };
  } catch { return null; }
}

// ── Finviz 수급 데이터 ─────────────────────────────────────────
async function fetchFinviz(sym) {
  try {
    const res = await fetch(`https://finviz.com/quote.ashx?t=${encodeURIComponent(sym)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    if (!res.ok) return null;
    const html = await res.text();
    // 테이블 행 파싱
    const rowRe = /<tr[^>]*>(.*?)<\/tr>/gs;
    const cellRe = /<td[^>]*>(.*?)<\/td>/gs;
    const stripRe = /<[^>]+>/g;
    const data = {};
    let m;
    while ((m = rowRe.exec(html)) !== null) {
      const cells = [];
      let cm;
      const cellPat = new RegExp(cellRe.source, 'gs');
      while ((cm = cellPat.exec(m[1])) !== null)
        cells.push(cm[1].replace(stripRe, '').trim());
      for (let i = 0; i < cells.length - 1; i += 2)
        if (cells[i]) data[cells[i]] = cells[i + 1];
    }
    const pct = v => v ? parseFloat(v.replace('%','')) : null;
    const num = v => v ? parseFloat(v.replace(/[^0-9.-]/g,'')) : null;
    return {
      shortFloat:   pct(data['Short Float']),   // 공매도 비율 (float 대비)
      shortRatio:   num(data['Short Ratio']),   // 공매도 커버일수
      instOwn:      pct(data['Inst Own']),       // 기관 보유 비율
      instTrans:    pct(data['Inst Trans']),     // 기관 수급 변화 (+ = 매집)
      insiderTrans: pct(data['Insider Trans']),  // 내부자 거래 변화
      optionable:   data['Option/Short']?.includes('Yes'),
    };
  } catch { return null; }
}

// ── SPY 상태 체크 ──────────────────────────────────────────────
async function fetchSpyState() {
  try {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/SPY?interval=1d&range=3mo`;
    const res = await fetch(url, { headers: YH_HDR });
    if (!res.ok) return null;
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result?.timestamp) return null;
    const closes = (result.indicators.adjclose?.[0]?.adjclose ?? result.indicators.quote[0].close).filter(Boolean);
    const rsi  = calcRSI(closes);
    const ma50 = avg(closes.slice(-50));
    const cur  = closes.at(-1);
    const macd = calcMACD(closes);
    const trend = cur > ma50 ? 'bull' : 'bear';
    return { rsi, ma50pct: ((cur/ma50-1)*100).toFixed(1), trend, macdRising: macd?.rising, hist: macd?.hist };
  } catch { return null; }
}

// ── 보유 종목 확인 ─────────────────────────────────────────────
function getHolding(sym) {
  try {
    const trades = JSON.parse(fs.readFileSync(TRADES_PATH, 'utf-8'));
    return trades.find(t => t.symbol === sym && t.result === 'open') ?? null;
  } catch { return null; }
}

// ── 메인 ──────────────────────────────────────────────────────
const runTime = new Date();
const etNow   = new Date(runTime.toLocaleString('en-US', { timeZone: 'America/New_York' }));
const timeStr = etNow.toLocaleTimeString('en-US', { hour12: false,
  hour: '2-digit', minute: '2-digit', second: '2-digit' });

console.log(`\n${line}`);
console.log(`🔍  ${symbol}  실시간 분석  —  ${timeStr} ET`);
console.log(line);

const [history, live, finviz, spyState] = await Promise.all([
  fetchHistory(symbol), fetchLiveQuote(symbol),
  fetchFinviz(symbol), fetchSpyState(),
]);
if (!history || history.length < 80) { console.error(`❌ ${symbol} 데이터 부족`); process.exit(1); }

// 오늘 캔들 업데이트
// 장 중(ET 09:30~16:00 평일)에만 live 캔들을 붙임. 장 외 시간엔 마지막 캔들이 확정 종가.
const etH = etNow.getHours(), etM = etNow.getMinutes();
const isMarketHours = etNow.getDay() >= 1 && etNow.getDay() <= 5
  && (etH > 9 || (etH === 9 && etM >= 30)) && etH < 16;

let rows = [...history];
if (live) {
  const lastRow = rows.at(-1);
  if (lastRow.date === live.today) {
    // 오늘 캔들 이미 있음 → live 가격으로 갱신 (장 중이든 아니든 업데이트)
    rows[rows.length - 1] = {
      ...lastRow,
      close: live.price, rawClose: live.price,
      high: Math.max(lastRow.high, live.price),
      low:  Math.min(lastRow.low,  live.price),
      volume: live.volume || lastRow.volume,
    };
  } else if (isMarketHours) {
    // 새 날짜 캔들은 장 중에만 추가
    rows.push({
      date: live.today, open: live.open, high: live.high,
      low: live.low, close: live.price, rawClose: live.price, volume: live.volume,
    });
  }
}

const closes   = rows.map(r => r.close);
const current  = closes.at(-1);
const prev     = closes.at(-2);
const rsi      = calcRSI(closes);
const macd     = calcMACD(closes);
const bb       = calcBB(closes);
const atr      = calcATR(rows);
const avgVol20 = avg(rows.slice(-20).map(r => r.volume));
const ma50     = avg(closes.slice(-50));
const ma200    = closes.length >= 200 ? avg(closes.slice(-200)) : null;
const recentHigh = Math.max(...closes.slice(-40));
const pullbackPct = ((current - recentHigh) / recentHigh * 100).toFixed(1);

// ── 현재가 블록 ────────────────────────────────────────────────
const etHour = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })).getHours();
const isOpen = etHour >= 9 && etHour < 16;
const marketStatus = isOpen ? '🟢 장중' : '🔴 장외';
const chgSign  = (live?.dayChg ?? 0) >= 0 ? '+' : '';
const chgIcon  = (live?.dayChg ?? 0) >= 0 ? '▲' : '▼';
const volRatio = live?.volume && avgVol20 ? (live.volume / avgVol20 * 100).toFixed(0) : null;

const fromOpen = live?.open ? parseFloat(((current - live.open) / live.open * 100).toFixed(2)) : null;
const fromOpenStr = fromOpen != null ? `  시가대비 ${fromOpen >= 0 ? '+' : ''}${fromOpen}%` : '';
console.log(`\n  ${marketStatus}  $${current.toFixed(2)}  ${chgIcon}${chgSign}${live?.dayChg ?? 0}% 전일비${fromOpenStr}  |  거래량 ${volRatio ? volRatio + '%' : '-'}`);
if (live) console.log(`  전일종가 $${live.prevClose?.toFixed(2) ?? '-'}  시가 $${live.open?.toFixed(2) ?? '-'}  범위 $${live.low.toFixed(2)}—$${live.high.toFixed(2)}`);
// 나이트마켓 / 프리마켓
if (live?.postMktPrice) {
  const pm = live.postMktPrice, pmChg = live.postMktChg;
  const pmSign = pmChg >= 0 ? '+' : '';
  const pmIcon = pmChg >= 0 ? '▲' : '▼';
  console.log(`  🌙 나이트마켓  $${pm.toFixed(2)}  ${pmIcon}${pmSign}${pmChg?.toFixed(2) ?? '-'}%  (장중 대비 ${pm >= current ? '+' : ''}${((pm - current)/current*100).toFixed(2)}%)`);
} else if (live?.preMktPrice) {
  const pm = live.preMktPrice, pmChg = live.preMktChg;
  const pmSign = pmChg >= 0 ? '+' : '';
  const pmIcon = pmChg >= 0 ? '▲' : '▼';
  console.log(`  🌅 프리마켓   $${pm.toFixed(2)}  ${pmIcon}${pmSign}${pmChg?.toFixed(2) ?? '-'}%  (전일종가 대비)`);
}

// ── 보유 종목 확인 ─────────────────────────────────────────────
const holding = getHolding(symbol);
if (holding) {
  const unrPnl    = (current - holding.buyPrice) * holding.shares;
  const unrPct    = ((current - holding.buyPrice) / holding.buyPrice * 100).toFixed(2);
  const pnlSign   = unrPnl >= 0 ? '+' : '';
  const pnlIcon   = unrPnl >= 0 ? '📈' : '📉';
  const tgtDist   = holding.target ? ((holding.target - current) / current * 100).toFixed(1) : null;
  const stopDist  = holding.stop   ? ((current - holding.stop)   / current * 100).toFixed(1) : null;
  const nearTgt   = holding.target && current >= holding.target * 0.97;
  const nearStop  = holding.stop   && current <= holding.stop   * 1.03;

  const dayChgStr = live?.dayChg != null
    ? `  |  오늘 ${live.dayChg >= 0 ? '▲+' : '▼'}${live.dayChg}%`
    : '';
  console.log(`\n${line2}`);
  console.log(`📂 보유 중  |  ${holding.buyDate} 매수  $${holding.buyPrice.toFixed(2)} × ${holding.shares}주`);
  console.log(`   ${pnlIcon} 진입가 대비  ${pnlSign}$${unrPnl.toFixed(2)} (${pnlSign}${unrPct}%)${dayChgStr}`);
  if (holding.target) {
    const tgtIcon = nearTgt ? '🎯' : '  ';
    console.log(`   ${tgtIcon} 목표  $${holding.target.toFixed(2)}  (현재가 대비 ${tgtDist > 0 ? '+' : ''}${tgtDist}%)`);
  }
  if (holding.stop) {
    const stopIcon = nearStop ? '🛑' : '  ';
    console.log(`   ${stopIcon} 손절  $${holding.stop.toFixed(2)}  (현재가 대비 -${stopDist}%)`);
  }
  if (holding.notes) {
    console.log(`\n  📝 진입 근거`);
    holding.notes.split('\n').forEach(n => n.trim() && console.log(`     ${n.trim()}`));
  }

  if (nearTgt)  console.log(`\n  ⚡ 목표가 근처 — 거래량 확인 후 익절 고려`);
  if (nearStop) console.log(`\n  🛑 손절가 근처 — 손절 준비`);
}

// ── 상승 시작 시점 예측 ────────────────────────────────────────
// "아직 상승이 시작되지 않은 보유 종목"에 대해 남은 조건과 예상 트리거 시점을 분석
function predictMoveStart(rows, current, rsi, macd, bb, atr, avgVol20, div, spyState, finviz) {
  const closes = rows.map(r => r.close);
  const histSeries = calcMACDHistSeries(closes, 10);

  // ── 조건 1: MACD 히스토그램 골든크로스 임박 ─────────────────
  // 히스토그램이 음수에서 0으로 수렴하는 속도 계산
  let macdDaysToZero = null;
  let macdTrend = null;
  if (histSeries.length >= 3) {
    const last = histSeries.at(-1);
    const prev = histSeries.at(-2);
    const prev2 = histSeries.at(-3);
    const slope1 = last - prev;
    const slope2 = prev - prev2;
    const accel  = slope1 - slope2; // 가속도 (양수 = 수렴 가속)
    macdTrend = slope1 > 0 ? 'rising' : slope1 < 0 ? 'falling' : 'flat';
    if (last < 0 && slope1 > 0) {
      // 선형 외삽: 현재 히스토그램 / 평균 개선 속도
      const avgSlope = (slope1 + (slope2 > 0 ? slope2 : 0)) / (slope2 > 0 ? 2 : 1);
      if (avgSlope > 0) macdDaysToZero = Math.min(30, Math.ceil(Math.abs(last) / avgSlope));
    } else if (last >= 0) {
      macdDaysToZero = 0; // 이미 양전환
    }
  }

  // ── 조건 2: RSI 45 돌파까지 남은 거리 ───────────────────────
  const rsiSeries = closes.slice(-6).map((_, i, arr) => {
    const idx = closes.length - 6 + i;
    return calcRSIAt(closes, idx);
  }).filter(Boolean);
  const rsiSlope = rsiSeries.length >= 2
    ? (rsiSeries.at(-1) - rsiSeries[0]) / (rsiSeries.length - 1) : 0;
  let rsiDaysTo45 = null;
  if (rsi < 45 && rsiSlope > 0) {
    rsiDaysTo45 = Math.ceil((45 - rsi) / rsiSlope);
  } else if (rsi >= 45) {
    rsiDaysTo45 = 0;
  }

  // ── 조건 3: 거래량 모멘텀 전환 확인 ─────────────────────────
  const recent10 = rows.slice(-11);
  const upVols = [], dnVols = [];
  for (let i = 1; i < recent10.length; i++) {
    const r = recent10[i], p = recent10[i-1];
    (r.close >= p.close ? upVols : dnVols).push(r.volume);
  }
  const upVolAvg = upVols.length ? avg(upVols) : 0;
  const dnVolAvg = dnVols.length ? avg(dnVols) : 0;
  const volConfirmed = upVolAvg > dnVolAvg * 1.1;

  // ── 조건 4: 가격이 BB 중간선 / 단기 저항 돌파 ───────────────
  const bbMidDist = bb ? ((bb.middle - current) / current * 100) : null;
  const bbCrossed = bb ? current >= bb.middle : false;

  // 최근 5일 고점 (단기 저항)
  const resist5 = Math.max(...rows.slice(-6, -1).map(r => r.high));
  const resistBreak = current >= resist5 * 0.99;

  // ── 조건 5: L2 이후 모멘텀 확인 (연속 상승일) ────────────────
  let consecUpDays = 0;
  for (let i = rows.length - 1; i >= Math.max(0, rows.length - 5); i--) {
    if (i === 0) break;
    if (rows[i].close > rows[i-1].close) consecUpDays++;
    else break;
  }
  const momentumStarted = consecUpDays >= 2;

  // ── 조건 6: SPY 시장 환경 ────────────────────────────────────
  const spyBull = spyState ? spyState.trend === 'bull' || spyState.macdRising : null;
  const spyLabel = spyState
    ? (spyState.trend === 'bull' ? `SPY 상승장 (50MA+${spyState.ma50pct}%)` : `SPY 하락장 (50MA${spyState.ma50pct}%)`)
    : 'SPY 데이터 없음';

  // ── 조건 7: 기관 수급 (Finviz) ───────────────────────────────
  const instPositive = finviz ? (finviz.instTrans != null && finviz.instTrans > 0) : null;
  const shortSqueeze = finviz ? (finviz.shortFloat != null && finviz.shortFloat > 10) : false;

  const conditions = [
    { name: 'MACD 히스토그램 양전환',  done: macd?.hist >= 0,         pending: macdDaysToZero,   unit: '일' },
    { name: 'RSI 45 돌파',             done: rsi >= 45,               pending: rsiDaysTo45,      unit: '일' },
    { name: '거래량 모멘텀 전환',       done: volConfirmed,            pending: null,             unit: null },
    { name: 'BB 중간선 돌파',           done: bbCrossed,               pending: bbMidDist != null ? Math.min(30, Math.ceil(bbMidDist / (atr * 0.3))) : null, unit: '일' },
    { name: '단기 저항 돌파',           done: resistBreak,             pending: null,             unit: null },
    { name: '연속 상승 2일+',           done: momentumStarted,         pending: null,             unit: null },
    { name: `시장 환경 (${spyLabel})`,  done: spyBull === true,        pending: null,             unit: null, optional: true },
    { name: '기관 순매수 전환',         done: instPositive === true,   pending: null,             unit: null, optional: true },
  ];

  // 필수(optional 아닌) 조건만 카운트
  const required = conditions.filter(c => !c.optional);
  const doneCnt  = required.filter(c => c.done).length;
  const totalCnt = required.length;
  const optDone  = conditions.filter(c => c.optional && c.done).length;

  // 이미 상승 시작된 상태 판단
  const alreadyStarted = doneCnt >= 4;

  // 트리거 예상일
  const pendingDays = required
    .filter(c => !c.done && c.pending != null && c.pending > 0)
    .map(c => c.pending);
  const estDaysToStart = pendingDays.length ? Math.max(...pendingDays) : 0;

  // 신호 강도 (시장 환경 하락장이면 한 단계 하향)
  const baseStrength = doneCnt >= 5 ? 2 : doneCnt >= 3 ? 1 : 0;
  const marketPenalty = spyBull === false ? 1 : 0;
  const strengthLevel = Math.max(0, baseStrength - marketPenalty);
  const strength = strengthLevel === 2 ? '🟢 상승 시작 임박' :
                   strengthLevel === 1 ? '🟡 조건 수렴 중' :
                   '🔴 아직 대기 필요';

  return { conditions, doneCnt, totalCnt, optDone, alreadyStarted, estDaysToStart, strength,
           macdDaysToZero, rsiDaysTo45, macdTrend, rsiSlope, bbMidDist, resist5, spyState, finviz, shortSqueeze };
}

function estimateTargetDays(holding, current, atr, rsi, macd, rows, avgVol20) {
  if (!holding?.target || !atr) return null;
  const distToTgt = holding.target - current;
  if (distToTgt <= 0) return { reached: true };

  // 기본 ATR 일일 진행 (보수적 55%)
  let dailyPace = atr * 0.55;
  const factors = [];

  // 거래량 모멘텀: 최근 10일 상승일 vs 하락일 거래량 비교 (기술적 지표 섹션과 동일 기간)
  const recent10 = rows.slice(-11);
  const upVols = [], dnVols = [];
  for (let i = 1; i < recent10.length; i++) {
    const r = recent10[i], p = recent10[i-1];
    (r.close >= p.close ? upVols : dnVols).push(r.volume);
  }
  const upVolAvg = upVols.length ? upVols.reduce((a,b)=>a+b,0)/upVols.length : 0;
  const dnVolAvg = dnVols.length ? dnVols.reduce((a,b)=>a+b,0)/dnVols.length : 0;
  const volRatio5 = avgVol20 > 0 ? upVolAvg / avgVol20 : 0;  // 변수명 유지 (비율 계산용)
  if (upVolAvg > dnVolAvg * 1.3 && volRatio5 > 1.1) {
    dailyPace *= 1.25; factors.push('✅ 상승 거래량 우세 (+25%)');
  } else if (upVolAvg > dnVolAvg * 1.1) {
    dailyPace *= 1.1;  factors.push('✅ 거래량 지지 (+10%)');
  } else if (dnVolAvg > upVolAvg * 1.2) {
    dailyPace *= 0.8;  factors.push('⚠️ 하락 거래량 > 상승 거래량 (-20%)');
  }

  // RSI 모멘텀: 40~65 구간에서 상승 중이면 가속
  if (rsi) {
    if (rsi >= 45 && rsi <= 65) {
      dailyPace *= 1.1; factors.push('✅ RSI 상승 구간 (+10%)');
    } else if (rsi > 65) {
      dailyPace *= 0.85; factors.push('⚠️ RSI 과열 (-15%)');
    } else if (rsi < 35) {
      dailyPace *= 0.9; factors.push('🟡 RSI 회복 대기 (-10%)');
    }
  }

  // MACD: 히스토그램 양전환 + 상승 중이면 가속
  if (macd) {
    if (macd.rising && macd.hist > 0) {
      dailyPace *= 1.15; factors.push('✅ MACD 상승 + 히스토그램 양전환 (+15%)');
    } else if (macd.rising) {
      dailyPace *= 1.05; factors.push('🟡 MACD 상승 전환 중 (+5%)');
    } else if (!macd.rising && macd.hist < 0) {
      dailyPace *= 0.8;  factors.push('⚠️ MACD 하락 중 (-20%)');
    }
  }

  const daysEst = Math.ceil(distToTgt / dailyPace);

  // 신뢰도 판정
  const positiveFactors = factors.filter(f => f.startsWith('✅')).length;
  const negativeFactors = factors.filter(f => f.startsWith('⚠️')).length;
  const confidence = positiveFactors >= 2 && negativeFactors === 0 ? '🟢 높음'
    : negativeFactors >= 2 ? '🔴 낮음' : '🟡 보통';

  // 진입일로부터 경과일
  let daysSinceEntry = null;
  if (holding.buyDate) {
    const buyD = new Date(holding.buyDate), nowD = new Date();
    daysSinceEntry = Math.floor((nowD - buyD) / (1000 * 60 * 60 * 24));
  }

  return { distToTgt, distPct: distToTgt / current * 100, dailyPace, daysEst, factors, confidence, daysSinceEntry, reached: false };
}

function calcAdjustments(holding, current, atr, rsi, macd, recentHigh) {
  if (!holding || !atr) return null;
  const entryPct = (current - holding.buyPrice) / holding.buyPrice * 100;
  const tgtProgress = holding.target
    ? (current - holding.buyPrice) / (holding.target - holding.buyPrice) * 100 : null;

  // — 손절 trailing
  let stopAdj = null;
  if (entryPct >= 12) {
    const newStop = parseFloat((holding.buyPrice * 1.05).toFixed(2));
    if (!holding.stop || newStop > holding.stop)
      stopAdj = { price: newStop, reason: `수익 +${entryPct.toFixed(1)}% — 진입가+5%로 trailing (수익 확정)` };
  } else if (entryPct >= 6) {
    const newStop = parseFloat((holding.buyPrice * 1.02).toFixed(2));
    if (!holding.stop || newStop > holding.stop)
      stopAdj = { price: newStop, reason: `수익 +${entryPct.toFixed(1)}% — 진입가+2%로 올려 리스크 제거` };
  } else if (entryPct >= 3) {
    const newStop = parseFloat(holding.buyPrice.toFixed(2));
    if (!holding.stop || newStop > holding.stop)
      stopAdj = { price: newStop, reason: `수익 +${entryPct.toFixed(1)}% — 손절 본전으로 이동` };
  }
  // ATR 기반 재검토
  const atrStop = parseFloat((holding.buyPrice - atr * 1.5).toFixed(2));
  let stopNote = null;
  if (holding.stop && Math.abs(holding.stop - atrStop) / atrStop > 0.03) {
    stopNote = `  ATR 기반 손절: $${atrStop.toFixed(2)} (설정값 $${holding.stop.toFixed(2)}과 괴리)`;
  }

  // — 목표가 상향
  let tgtAdj = null;
  const atrTarget = parseFloat((holding.buyPrice + atr * 3.0).toFixed(2));
  const isMomentumGood = rsi && rsi < 65 && macd?.rising;
  if (tgtProgress != null && tgtProgress >= 60 && isMomentumGood) {
    const proposed = Math.min(recentHigh * 0.98, atrTarget);
    if (holding.target && proposed > holding.target * 1.03)
      tgtAdj = { price: parseFloat(proposed.toFixed(2)),
        reason: `목표 ${tgtProgress.toFixed(0)}% 도달 + 모멘텀 유지 — 목표가 상향 가능` };
  }
  // RSI 과매수 or MACD 역전 → 일부 익절 경고
  let exitWarning = null;
  if (rsi && rsi > 70)
    exitWarning = `⚠️  RSI ${rsi} 과매수 — 일부 익절 또는 목표가 하향 고려`;
  else if (macd && !macd.rising && macd.hist < 0 && entryPct > 3)
    exitWarning = `⚠️  MACD 히스토그램 하락 반전 — 모멘텀 약화 중`;

  return { stopAdj, stopNote, tgtAdj, exitWarning, entryPct, tgtProgress };
}

// ── 기술적 지표 ────────────────────────────────────────────────
console.log(`\n${line2}`);
console.log(`📊 기술적 지표`);
console.log(`${line2}`);

const ma50pct  = ((current / ma50 - 1) * 100).toFixed(1);
const ma200pct = ma200 ? ((current / ma200 - 1) * 100).toFixed(1) : null;
console.log(`  RSI(14)   ${rsi}  ${rsi < 30 ? '⚡ 과매도' : rsi > 70 ? '🔥 과매수' : ''}`);
console.log(`  MACD      ${macd?.line?.toFixed(3) ?? '-'}  히스토그램 ${macd?.hist?.toFixed(3) ?? '-'}  ${macd?.rising ? '▲ 상승 중' : '▼ 하락 중'}`);
console.log(`  50MA      $${ma50.toFixed(2)}  (${ma50pct > 0 ? '+' : ''}${ma50pct}%)`);
if (ma200) console.log(`  200MA     $${ma200.toFixed(2)}  (${ma200pct > 0 ? '+' : ''}${ma200pct}%)`);
if (bb)    console.log(`  BB        하단 $${bb.lower.toFixed(2)}  중간 $${bb.middle.toFixed(2)}  상단 $${bb.upper.toFixed(2)}`);
console.log(`  ATR(14)   $${atr?.toFixed(2) ?? '-'}`);
console.log(`  눌림폭    ${pullbackPct}%  (40일 고점 $${recentHigh.toFixed(2)} 대비)`);

// ── 거래량 패턴 ────────────────────────────────────────────────
const recent10 = rows.slice(-11);
const downVols = [], upVols = [];
for (let i = 1; i < recent10.length; i++) {
  if (recent10[i].close < recent10[i-1].close) downVols.push(recent10[i].volume);
  else if (recent10[i].close > recent10[i-1].close) upVols.push(recent10[i].volume);
}
if (downVols.length && upVols.length) {
  const downAvg = avg(downVols), upAvg = avg(upVols);
  const isDryUp = downAvg < avgVol20 * 0.9;
  const isSurge = upAvg   > avgVol20 * 1.2;
  console.log(`  거래량    하락일 평균 ${(downAvg/avgVol20*100).toFixed(0)}%  상승일 평균 ${(upAvg/avgVol20*100).toFixed(0)}%`);
  if (isDryUp && isSurge) console.log(`            ⭐ 매집 패턴 — 매도 소진 + 매수 유입`);
  else if (isDryUp)       console.log(`            ✅ 하락 거래량 소진 — 매도 압력 약화`);
  else if (isSurge)       console.log(`            📈 상승 거래량 급증`);
}

// ── TP/SL 조정 제안 (보유 시) ──────────────────────────────────
const adjustments = holding ? calcAdjustments(holding, current, atr, rsi, macd, recentHigh) : null;
if (adjustments) {
  const { stopAdj, stopNote, tgtAdj, exitWarning, entryPct, tgtProgress } = adjustments;
  const hasAny = stopAdj || stopNote || tgtAdj || exitWarning;
  const tpStr  = holding.target ? `TP $${holding.target.toFixed(2)}` : 'TP -';
  const slStr  = holding.stop   ? `SL $${holding.stop.toFixed(2)}`   : 'SL -';
  const tpDist = holding.target ? ` (${((holding.target - current)/current*100).toFixed(1)}%)` : '';
  const slDist = holding.stop   ? ` (-${((current - holding.stop)/current*100).toFixed(1)}%)`  : '';
  if (hasAny) {
    console.log(`\n${line2}`);
    console.log(`📐 TP/SL 조정 제안  |  현재 ${tpStr}${tpDist}  /  ${slStr}${slDist}`);
    console.log(`${line2}`);
    console.log(`  현재 수익  ${entryPct >= 0 ? '+' : ''}${entryPct.toFixed(1)}%  |  목표 진행 ${tgtProgress != null ? tgtProgress.toFixed(0)+'%' : '-'}`);
    if (stopAdj)
      console.log(`  🔼 손절 상향  $${holding.stop?.toFixed(2) ?? '-'} → $${stopAdj.price.toFixed(2)}`);
    if (stopNote) console.log(stopNote);
    if (tgtAdj)
      console.log(`  🎯 목표 상향  $${holding.target?.toFixed(2) ?? '-'} → $${tgtAdj.price.toFixed(2)}`);
    if (stopAdj)   console.log(`     └ ${stopAdj.reason}`);
    if (tgtAdj)    console.log(`     └ ${tgtAdj.reason}`);
    if (exitWarning) console.log(`\n  ${exitWarning}`);
    if (!stopAdj && !tgtAdj && !exitWarning && !stopNote)
      console.log(`  ✅ 현재 설정 유지`);
  } else {
    console.log(`\n${line2}`);
    console.log(`📐 TP/SL  ✅ 현재 설정 적절  |  ${tpStr}${tpDist}  /  ${slStr}${slDist}`);
  }
}

// ── 목표가 도달 예상 (보유 시) ─────────────────────────────────
if (holding?.target) {
  const est = estimateTargetDays(holding, current, atr, rsi, macd, rows, avgVol20);
  console.log(`\n${line2}`);
  console.log(`📅 목표가 도달 예상`);
  console.log(`${line2}`);
  if (est?.reached) {
    console.log(`  🎯 이미 목표가 도달 또는 초과`);
  } else if (est) {
    const entryStr = est.daysSinceEntry != null ? `진입 후 ${est.daysSinceEntry}일 경과  |  ` : '';
    console.log(`  ${entryStr}목표 $${holding.target.toFixed(2)}  (현재 대비 +${est.distPct.toFixed(1)}%  $+${est.distToTgt.toFixed(2)})`);
    console.log(`  예상 소요  약 ${est.daysEst}거래일  (ATR 조정 일일 $${est.dailyPace.toFixed(2)} 진행)`);
    console.log(`  신뢰도  ${est.confidence}`);
    if (est.factors.length) {
      console.log(`  ─ 속도 조정 요인`);
      est.factors.forEach(f => console.log(`     ${f}`));
    }
  }
}

// ── 상승 시작 시점 예측 (보유 시) ────────────────────────────
if (holding) {
  const entryPct = (current - holding.buyPrice) / holding.buyPrice * 100;
  const pred = predictMoveStart(rows, current, rsi, macd, bb, atr, avgVol20, null, spyState, finviz);
  // 이미 +5% 이상 수익 = 상승 시작된 것으로 간주, 표시 스킵
  if (entryPct < 5) {
    console.log(`\n${line2}`);
    console.log(`🚀 상승 시작 시점 예측`);
    console.log(`${line2}`);

    if (pred.alreadyStarted) {
      console.log(`  ✅ 상승 시작 신호 충족 (${pred.doneCnt}/${pred.totalCnt}조건)  —  모멘텀 진행 중`);
    } else {
      console.log(`  ${pred.strength}  (${pred.doneCnt}/${pred.totalCnt} 조건 충족)`);
      if (pred.estDaysToStart > 0) {
        console.log(`  예상 트리거  약 ${pred.estDaysToStart}거래일 이내`);
      }
    }

    console.log(`\n  조건 체크리스트`);
    pred.conditions.forEach(c => {
      const icon = c.done ? '  ✅' : '  ⬜';
      let suffix = '';
      if (!c.done && c.pending != null && c.pending > 0) suffix = `  → 약 ${c.pending}${c.unit} 후`;
      else if (!c.done && c.pending === 0) suffix = `  → 임박`;
      console.log(`${icon}  ${c.name}${suffix}`);
    });

    // 구체적 수치 힌트
    console.log(`\n  수치 현황`);
    if (pred.macdDaysToZero != null) {
      const macdEta = pred.macdDaysToZero >= 30 ? '30일+' : `약 ${pred.macdDaysToZero}일`;
      console.log(`     MACD 히스토그램  ${macd?.hist?.toFixed(3)}  (${pred.macdTrend === 'rising' ? '▲ 수렴 중' : '▼ 발산 중'}  0선까지 ${macdEta})`);
    } else if (macd?.hist >= 0)
      console.log(`     MACD 히스토그램  ${macd?.hist?.toFixed(3)}  ✅ 이미 양전환`);
    else
      console.log(`     MACD 히스토그램  ${macd?.hist?.toFixed(3)}  ⚠️ 하락 중 — 반전 미확인`);

    if (pred.rsiDaysTo45 != null)
      console.log(`     RSI  ${rsi}  (45까지 약 ${pred.rsiDaysTo45}일  |  일간 +${pred.rsiSlope.toFixed(1)}pt 추세)`);
    else
      console.log(`     RSI  ${rsi}  ✅ 45 돌파`);

    if (pred.bbMidDist != null && !pred.conditions.find(c=>c.name==='BB 중간선 돌파')?.done)
      console.log(`     BB 중간선  $${bb.middle.toFixed(2)}  (현재가 대비 +${pred.bbMidDist.toFixed(1)}%  돌파 시 상승 가속 신호)`);
    console.log(`     단기 저항  $${pred.resist5.toFixed(2)}  (최근 5일 고점)`);

    // 시장 환경
    if (pred.spyState) {
      const s = pred.spyState;
      const spyIcon = s.trend === 'bull' ? '✅' : '⚠️';
      console.log(`     SPY  ${spyIcon} ${s.trend === 'bull' ? '상승장' : '하락장'}  RSI ${s.rsi}  50MA ${s.ma50pct > 0 ? '+' : ''}${s.ma50pct}%  MACD ${s.macdRising ? '▲' : '▼'}`);
      if (s.trend === 'bear') console.log(`          ↳ 하락장 개별주 다이버전스 신호는 SPY 반등 없이 트리거 안 될 수 있음`);
    }

    // 기관 수급
    if (pred.finviz) {
      const f = pred.finviz;
      // ── 수급 점수 계산 (5점 만점) ─────────────────────────────
      let supplyScore = 0, supplyMax = 0;
      // 기관 수급변화 (2점): 기관이 최근 분기에 더 많이 사고 있는지
      if (f.instTrans != null) {
        supplyMax += 2;
        if (f.instTrans > 1)       supplyScore += 2;   // 강한 매집
        else if (f.instTrans > 0)  supplyScore += 1;   // 소폭 매집
      }
      // 내부자 거래 (1점): 회사 내부인들이 사고 있는지
      if (f.insiderTrans != null) {
        supplyMax += 1;
        if (f.insiderTrans > 0) supplyScore += 1;
      }
      // 숏스퀴즈 잠재력 (1점): 공매도 세력이 많아 급반등 가능성
      if (f.shortFloat != null) {
        supplyMax += 1;
        if (f.shortFloat > 10) supplyScore += 1;
      }
      // 기관 보유 안정성 (1점): 기관이 50% 이상 보유 = 신뢰도 높음
      if (f.instOwn != null) {
        supplyMax += 1;
        if (f.instOwn > 50) supplyScore += 1;
      }
      const supplyIcon = supplyScore >= 4 ? '🟢' : supplyScore >= 2 ? '🟡' : '🔴';
      console.log(`\n  수급 점수  ${supplyIcon} ${supplyScore}/${supplyMax}`);
      if (f.instOwn   != null) console.log(`     기관 보유  ${f.instOwn.toFixed(1)}%${f.instOwn > 50 ? '  ✅' : ''}`);
      if (f.instTrans != null) {
        const icon = f.instTrans > 1 ? '✅✅' : f.instTrans > 0 ? '✅' : '⚠️';
        const label = f.instTrans > 1 ? '강한 매집' : f.instTrans > 0 ? '소폭 매집' : '기관 매도';
        console.log(`     기관 수급변화  ${icon} ${f.instTrans > 0 ? '+' : ''}${f.instTrans.toFixed(2)}%  (${label})`);
      }
      if (f.insiderTrans != null) {
        const icon = f.insiderTrans > 0 ? '✅' : '⚠️';
        const label = f.insiderTrans > 0 ? '내부자 매집' : '내부자 매도';
        console.log(`     내부자 거래  ${icon} ${f.insiderTrans > 0 ? '+' : ''}${f.insiderTrans.toFixed(2)}%  (${label})`);
      }
      if (f.shortFloat != null) {
        const squeezeNote = f.shortFloat > 10 ? '  🔥 숏스퀴즈 잠재력' : f.shortFloat < 3 ? '  (낮음)' : '';
        console.log(`     공매도 비율  ${f.shortFloat.toFixed(1)}%  커버일수 ${f.shortRatio?.toFixed(1) ?? '-'}일${squeezeNote}`);
      }
    }

    console.log(`\n  ⚠️  이 예측은 현재 지표 기반 추정입니다. 확률적 참고용이며 보장하지 않습니다.`);
  }
}

// ── 다이버전스 분석 ────────────────────────────────────────────
console.log(`\n${line2}`);
console.log(`🎯 다이버전스 분석`);
console.log(`${line2}`);

const div = detectDivergence(rows);
const histDiv = div ? checkHistoricalDivergences(rows) : null;

if (!div) {
  console.log(`  ❌ 현재 유효한 상승 다이버전스 없음`);
} else {
  const typeStr = div.rsiDiv && div.macdDiv ? 'RSI + MACD 이중' : div.rsiDiv ? 'RSI' : 'MACD';
  console.log(`  ✅ ${typeStr} 상승 다이버전스`);
  console.log(`\n  L1 저점   ${div.L1.date}  $${div.L1.price.toFixed(2)}  RSI ${div.rsiL1}`);
  console.log(`  L2 저점   ${div.L2.date}  $${div.L2.price.toFixed(2)}  RSI ${div.rsiL2}  (${div.daysAgo}일 전)`);
  console.log(`  RSI 개선  +${div.rsiImprove.toFixed(1)}pt  ${div.rsiImprove >= 15 ? '🔥 강한 다이버전스' : div.rsiImprove >= 8 ? '✅ 유효' : '⚠️ 미약'}`);
  console.log(`  저점 반등  +${div.recoveryPct.toFixed(1)}%  ${div.recoveryPct > 12 ? '⚠️ 이미 많이 올라옴' : div.recoveryPct > 2 ? '✅ 반등 진행 중' : '진입 대기'}`);

  // ── 과거 다이버전스 성공 이력 ──────────────────────────────────
  if (histDiv) {
    const rateIcon = histDiv.successRate >= 70 ? '✅' : histDiv.successRate >= 50 ? '🟡' : '🔴';
    const confidence = histDiv.count >= 5 ? '높음' : histDiv.count >= 3 ? '중간' : '낮음';
    console.log(`\n  📊 과거 다이버전스 성공 이력 (${histDiv.count}건, 신뢰도: ${confidence})`);
    console.log(`     ${rateIcon} 성공률 ${histDiv.successRate}% (${histDiv.successCount}/${histDiv.count})  |  평균 수익 ${histDiv.avgGainPct > 0 ? '+' : ''}${histDiv.avgGainPct}%`);

    if (histDiv.successRate >= 70) {
      console.log(`     ✅ 이 종목은 다이버전스 패턴에 강하게 반응 — 신뢰도 높음`);
      if (histDiv.count < 5) {
        console.log(`     ⚠️  다만 샘플 수 적음 (${histDiv.count}건) — 과신 금물`);
      }
    } else if (histDiv.successRate >= 50) {
      console.log(`     🟡 보통 수준 성공률 — 다른 신호와 함께 종합 판단 필요`);
    } else {
      console.log(`     🔴 과거 성공률 낮음 — 진입 신중, 비중 축소 권장`);
    }

    if (histDiv.recent?.length) {
      console.log(`     최근 케이스:`);
      histDiv.recent.forEach(r => {
        const icon = r.success ? '✅' : '❌';
        console.log(`       ${icon}  ${r.date}  ${r.success ? '+' : ''}${r.gainPct}%  (RSI개선 ${r.rsiImprove > 0 ? '+' : ''}${r.rsiImprove.toFixed(0)}pt)`);
      });
    }
  } else {
    console.log(`\n  📊 과거 다이버전스 이력  —  데이터 부족 (2년 내 조건 충족 사례 없음)`);
  }

  // ── 다이버전스 이후 거래량 확인 ──────────────────────────────
  const postL2rows = rows.slice(div.L2.idx);
  const daysSinceL2 = postL2rows.length - 1;
  const postUpDays = [], postDnDays = [];
  for (let i = 1; i < postL2rows.length; i++) {
    const r = postL2rows[i], p = postL2rows[i-1];
    (r.close >= p.close ? postUpDays : postDnDays).push({ vol: r.volume, date: r.date, pct: (r.close-p.close)/p.close*100 });
  }

  // ── 과거 성공 다이버전스 케이스 거래량 패턴 분석 ─────────────
  const historicalVolPatterns = [];
  for (let endIdx = 100; endIdx <= rows.length - 25; endIdx += 5) {
    const slice = rows.slice(0, endIdx);
    const closes = slice.map(r => r.close);
    const swings = findSwingLows(slice, 70, 3);
    if (swings.length < 2) continue;

    const L2 = swings[swings.length - 1];
    const L1 = swings[swings.length - 2];
    const daysAgo = endIdx - 1 - L2.idx;
    if (daysAgo > 15 || L2.idx - L1.idx < 5 || L2.price >= L1.price) continue;

    const rsiL1 = calcRSIAt(closes, L1.idx);
    const rsiL2 = calcRSIAt(closes, L2.idx);
    if (!rsiL1 || !rsiL2 || rsiL1 > 50 || rsiL2 <= rsiL1) continue;

    // L2 이후 20일간 결과
    const outcomeIdx = L2.idx + 20;
    if (outcomeIdx >= endIdx || outcomeIdx >= rows.length) continue;
    const gainPct = (rows[outcomeIdx].close - L2.price) / L2.price * 100;

    // L2 이후 첫 10일 거래량 패턴
    const postL2slice = rows.slice(L2.idx, Math.min(L2.idx + 11, rows.length));
    const avgVol = avg(rows.slice(Math.max(0, L2.idx - 20), L2.idx).map(r => r.volume));
    let upVols = [], dnVols = [];
    for (let i = 1; i < postL2slice.length; i++) {
      const vol = postL2slice[i].volume / avgVol * 100;
      (postL2slice[i].close >= postL2slice[i-1].close ? upVols : dnVols).push(vol);
    }

    historicalVolPatterns.push({
      date: L2.date ?? rows[L2.idx]?.date,
      gainPct,
      success: gainPct > 5,
      upVolAvg: upVols.length ? avg(upVols) : 0,
      dnVolAvg: dnVols.length ? avg(dnVols) : 0,
      volRatio: upVols.length && dnVols.length ? avg(upVols) / avg(dnVols) : 1,
    });
  }

  const successCases = historicalVolPatterns.filter(p => p.success);
  const avgSuccessVolRatio = successCases.length ? avg(successCases.map(p => p.volRatio)) : null;

  if (postUpDays.length || postDnDays.length) {
    const upVolAvg  = postUpDays.length ? avg(postUpDays.map(d => d.vol / avgVol20 * 100)) : 0;
    const dnVolAvg  = postDnDays.length ? avg(postDnDays.map(d => d.vol / avgVol20 * 100)) : 0;
    const currentVolRatio = dnVolAvg > 0 ? upVolAvg / dnVolAvg : 1;
    const bigBuyDay = postUpDays.find(d => d.vol / avgVol20 > 1.4);
    const recentUpVols = postUpDays.slice(-3).map(d => d.vol / avgVol20 * 100);
    const upVolFading = recentUpVols.length >= 2 && recentUpVols.at(-1) < recentUpVols[0] * 0.5;

    console.log(`\n  📊 다이버전스 이후 거래량 분석 (${daysSinceL2}일)`);
    console.log(`     현재 패턴  상승일 ${upVolAvg.toFixed(0)}%  vs  하락일 ${dnVolAvg.toFixed(0)}%  (비율 ${currentVolRatio.toFixed(2)}x)`);

    if (avgSuccessVolRatio != null && successCases.length >= 2) {
      const patternMatch = Math.abs(currentVolRatio - avgSuccessVolRatio) / avgSuccessVolRatio < 0.3;
      const successRate = (successCases.length / historicalVolPatterns.length * 100).toFixed(0);
      console.log(`     과거 성공 케이스 (${successCases.length}/${historicalVolPatterns.length}건, 성공률 ${successRate}%)`);
      console.log(`       → 평균 거래량 비율 ${avgSuccessVolRatio.toFixed(2)}x (상승일/하락일)`);

      if (patternMatch && currentVolRatio >= avgSuccessVolRatio * 0.7) {
        console.log(`     ✅ 현재 패턴이 성공 케이스와 유사 — 반등 신뢰도 높음`);
      } else if (currentVolRatio < avgSuccessVolRatio * 0.5) {
        console.log(`     ⚠️  현재 거래량 비율이 성공 케이스보다 약함 — 모멘텀 부족 가능성`);
      } else {
        console.log(`     🟡 현재 패턴이 성공 케이스와 약간 차이 — 주의 관찰 필요`);
      }
    } else if (historicalVolPatterns.length > 0) {
      console.log(`     ℹ️  과거 데이터 부족 (성공 케이스 ${successCases.length}건) — 패턴 비교 불가`);
    }

    if (bigBuyDay)
      console.log(`     ✅ 기관 매수 캔들  ${bigBuyDay.date}  +${bigBuyDay.pct.toFixed(1)}%  거래량 ${(bigBuyDay.vol/avgVol20*100).toFixed(0)}%`);
    if (upVolAvg > dnVolAvg * 1.2)
      console.log(`     ✅ 상승 거래량 우세 — 반등 신뢰도 높음`);
    else if (upVolFading)
      console.log(`     ⚠️  최근 상승일 거래량 감소 — 모멘텀 약화 중`);
    else if (upVolAvg < dnVolAvg)
      console.log(`     ⚠️  하락 거래량 > 상승 거래량 — 아직 매도 압력 잔재`);
    else
      console.log(`     🟡 거래량 혼조 — 추가 확인 필요`);
  }

  // ── 예상 상승 일수 ────────────────────────────────────────────
  if (atr) {
    const tgt = holding?.target ?? (current + atr * 2.0);
    const distToTgt = tgt - current;
    const dailyPace = atr * 0.55; // 실제 상승 시 ATR의 55% 수준
    const daysAtrEst = Math.ceil(distToTgt / dailyPace);
    // 다이버전스 패턴 통계: 보통 L2로부터 10~25 거래일 내 목표 도달
    const remainMin = Math.max(1, 10 - daysSinceL2);
    const remainMax = Math.max(remainMin + 2, 25 - daysSinceL2);
    const isMomentumOn = rsi && rsi > 40 && macd?.rising;
    const paceNote = isMomentumOn ? '모멘텀 진행 중' : 'MACD/RSI 회복 대기 중';

    console.log(`\n  ⏱  예상 상승 타이밍`);
    console.log(`     L2로부터 ${daysSinceL2}일 경과  |  목표 $${tgt.toFixed(2)}까지 +${distToTgt.toFixed(2)} (${((distToTgt/current)*100).toFixed(1)}%)`);
    console.log(`     ATR 기준  약 ${daysAtrEst}거래일  (일일 $${dailyPace.toFixed(2)} 예상)`);
    console.log(`     다이버전스 통계  앞으로 ${remainMin}~${remainMax}거래일 이내  (${paceNote})`);
    if (!isMomentumOn)
      console.log(`     ⚠️  MACD 골든크로스 or RSI 45+ 확인 후 진입/홀딩 유지 권장`);
  }

  // 목표/손절 제안 (미보유시)
  if (!holding && atr) {
    const buyPrice = parseFloat(current.toFixed(2));
    const target   = parseFloat(Math.min(recentHigh, buyPrice + atr * 2.0).toFixed(2));
    const stop     = parseFloat((buyPrice - atr * 1.5).toFixed(2));
    const tPct     = ((target - buyPrice) / buyPrice * 100).toFixed(1);
    const sPct     = ((stop   - buyPrice) / buyPrice * 100).toFixed(1);
    const rr       = (Math.abs(parseFloat(tPct)) / Math.abs(parseFloat(sPct))).toFixed(2);
    console.log(`\n${line2}`);
    console.log(`💡 진입 시나리오 (미보유)`);
    console.log(`${line2}`);
    console.log(`  진입   $${buyPrice}  |  목표 $${target} (+${tPct}%)  |  손절 $${stop} (${sPct}%)`);
    console.log(`  R:R    ${rr}:1  ${parseFloat(rr) >= 1.5 ? '✅' : parseFloat(rr) >= 1.2 ? '🟡' : '❌ 진입 비추'}`);
  }
}

// ── 최근 10일 가격 액션 ─────────────────────────────────────────
console.log(`\n${line2}`);
console.log(`📅 최근 10일`);
console.log(`${line2}`);
const last10 = rows.slice(-10);
for (let i = 1; i < last10.length; i++) {
  const r = last10[i], p = last10[i-1];
  const chg = ((r.close - p.close) / p.close * 100).toFixed(1);
  const vr  = avgVol20 ? (r.volume / avgVol20 * 100).toFixed(0) : '-';
  const dir = r.close >= p.close ? '▲' : '▼';
  const isToday = i === last10.length - 1 && live ? ' ← live' : '';
  console.log(`  ${r.date}  $${r.close.toFixed(2)}  ${dir}${chg.padStart(5)}%  거래량 ${vr}%${isToday}`);
}

console.log(`\n${line}\n`);
