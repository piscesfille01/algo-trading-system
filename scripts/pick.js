#!/usr/bin/env node
/**
 * 단타 종목 추천 — OHLCV 기반 3가지 패턴
 * 실행: node scripts/pick.js [YYYY-MM-DD]
 *
 * 패턴:
 *  1. RSI < 30                          → 과매도 반등 (승률 56~59%)
 *  2. RSI < 35 + 거래량 3일 연속 증가   → 바닥 축적 (승률 64%)
 *  3. RSI < 40 + MACD 상승             → 모멘텀 전환 (승률 56%)
 */

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CUTOFF = process.argv[2] ?? new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const CACHE_DIR = path.resolve('output/cache');
const BACKTEST_PICKS_DIR = path.join(__dirname, '../output/backtest-picks');
const BALANCE_PATH  = path.join(__dirname, '../output/balance.json');
const FILTERS_PATH  = path.join(__dirname, '../output/filters.json');
const TRADES_PATH   = path.join(__dirname, '../output/trades-manual.json');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

// evolve.js가 저장한 개선 필터 로드
const savedFilters = fs.existsSync(FILTERS_PATH)
  ? JSON.parse(fs.readFileSync(FILTERS_PATH, 'utf-8')).filters
  : { spyFilter: false, rsiRising: false, volumeConfirm: false };

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function avg(arr)  { return arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0; }

// ── 실적 발표 캘린더 체크 (갭 트레이딩 전략) ──────────────────────────
async function checkEarningsCalendar(symbol, cutoffDate) {
  try {
    // Mock 데이터 우선 체크 (백테스트용)
    const mockPath = '/tmp/mock-earnings.json';
    if (fs.existsSync(mockPath)) {
      const mockData = JSON.parse(fs.readFileSync(mockPath, 'utf-8'));
      const cutoff = new Date(cutoffDate);

      // cutoffDate로부터 0-2일 이내 earnings 찾기
      for (let dayOffset = 0; dayOffset <= 2; dayOffset++) {
        const checkDate = new Date(cutoff);
        checkDate.setDate(checkDate.getDate() + dayOffset);
        const dateStr = checkDate.toISOString().split('T')[0];

        if (mockData.earnings[dateStr]?.includes(symbol)) {
          return {
            earningsDate: checkDate,
            daysUntil: dayOffset,
            isWithin2Days: true
          };
        }
      }
    }

    // Mock 데이터 없으면 Alpha Vantage API 호출
    const apiKey = process.env.ALPHAVANTAGE_API_KEY;
    if (!apiKey) return null;

    const url = `https://www.alphavantage.co/query?function=EARNINGS_CALENDAR&symbol=${symbol}&horizon=3month&apikey=${apiKey}`;
    const response = await fetch(url);
    const csvText = await response.text();

    // CSV 파싱 (헤더: symbol,name,reportDate,fiscalDateEnding,estimate,currency)
    const lines = csvText.trim().split('\n');
    if (lines.length < 2) return null;

    const headers = lines[0].split(',');
    const data = lines[1].split(',');

    const reportDateIdx = headers.indexOf('reportDate');
    if (reportDateIdx === -1 || !data[reportDateIdx]) return null;

    const reportDate = data[reportDateIdx];
    const earningsDate = new Date(reportDate);
    const cutoff = new Date(cutoffDate);
    const daysUntil = Math.floor((earningsDate - cutoff) / 86400000);

    // 실적 발표가 0-2일 이내 (당일, 익일, 모레)
    const isWithin2Days = daysUntil >= 0 && daysUntil <= 2;

    return {
      earningsDate,
      daysUntil,
      isWithin2Days
    };
  } catch (err) {
    return null;  // API 오류 시 무시
  }
}

// ── 백테스트: 최근 10거래일 이내 추천 이력 로드 ─────────────────────────
function getRecentlyRecommendedSymbols(cutoffDate, tradingDays = 10) {
  if (!fs.existsSync(BACKTEST_PICKS_DIR)) return new Set();

  const cutoff = new Date(cutoffDate);
  const recentSymbols = new Set();

  // 모든 백테스트 픽 파일 읽기
  const files = fs.readdirSync(BACKTEST_PICKS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''));

  // 날짜별로 정렬해서 cutoff 이전 날짜만 필터
  const pastDates = files
    .map(dateStr => ({ dateStr, date: new Date(dateStr) }))
    .filter(({ date }) => date < cutoff)
    .sort((a, b) => b.date - a.date);

  // 최근 10거래일 (주말 포함 최대 14일) 내 추천 종목 수집
  let count = 0;
  for (const { dateStr } of pastDates) {
    if (count >= tradingDays) break;

    try {
      const pickPath = path.join(BACKTEST_PICKS_DIR, `${dateStr}.json`);
      const picks = JSON.parse(fs.readFileSync(pickPath, 'utf-8'));

      if (Array.isArray(picks)) {
        picks.forEach(p => {
          if (p.symbol) recentSymbols.add(p.symbol);
        });
      }

      // 주말이 아닌 거래일만 카운트 (월-금)
      const day = new Date(dateStr).getDay();
      if (day !== 0 && day !== 6) count++;

    } catch (err) {
      // 파일 읽기 실패는 무시
    }
  }

  return recentSymbols;
}

// ── 실전: 현재 보유 종목 로드 ──────────────────────────────────────────
function getCurrentHoldings() {
  if (!fs.existsSync(TRADES_PATH)) return new Set();

  try {
    const trades = JSON.parse(fs.readFileSync(TRADES_PATH, 'utf-8'));
    const holdingSymbols = new Set();

    // status가 'open' 또는 result가 'open'인 종목만
    trades.forEach(t => {
      if (t.status === 'open' || t.result === 'open') {
        holdingSymbols.add(t.symbol);
      }
    });

    return holdingSymbols;
  } catch {
    return new Set();
  }
}

// ── 캐시 ──────────────────────────────────────────────────────────────
function cacheGet(key) {
  try { return JSON.parse(fs.readFileSync(path.join(CACHE_DIR, `${key}.json`), 'utf-8')); } catch { return null; }
}
function cacheSet(key, data) {
  fs.writeFileSync(path.join(CACHE_DIR, `${key}.json`), JSON.stringify(data));
}

// ── 유니버스: S&P500 + NASDAQ100 ──────────────────────────────────────
const FALLBACK = [
  'NVDA','AAPL','MSFT','GOOGL','META','TSLA','AMD','AVGO','AMZN','QCOM',
  'INTC','CRM','JPM','GS','V','LLY','UNH','XOM','CVX','AMAT','LRCX','MRVL',
  'RKLB','ASTS','PL','CCJ','MSTR','MARA','RIOT','COIN','PLTR','SOUN','IONQ',
  'ZM','NU','RDDT','HIMS','VKTX','RIVN','NVO','SPG','TSCO','LULU','MNST',
];


// ── 섹터 ETF 맵 ────────────────────────────────────────────────────────
// 종목 → 섹터 ETF 티커 매핑
// 매핑 없는 종목은 섹터 체크 스킵 (패널티 없음)
const SECTOR_ETF_MAP = {
  // 기술 (XLK)
  AAPL:'XLK', MSFT:'XLK', NVDA:'XLK', AMD:'XLK', INTC:'XLK', QCOM:'XLK',
  AVGO:'XLK', CRM:'XLK', ORCL:'XLK', SNOW:'XLK', PLTR:'XLK',
  // 반도체 (SMH) — XLK보다 정밀
  AMAT:'SMH', LRCX:'SMH', KLAC:'SMH', MRVL:'SMH', ARM:'SMH', TSM:'SMH',
  SMCI:'SMH', CDNS:'SMH', SNPS:'SMH', ON:'SMH',
  // 광통신/네트워크 (XLK)
  COHR:'XLK', LITE:'XLK', CIEN:'XLK',
  // 커뮤니케이션 (XLC)
  GOOGL:'XLC', META:'XLC', NFLX:'XLC', DIS:'XLC',
  // 소비재 - 임의 (XLY)
  TSLA:'XLY', NKE:'XLY', SBUX:'XLY', AMZN:'XLY',
  // 소비재 - 필수 (XLP)
  COST:'XLP', MNST:'XLP',
  // 금융 (XLF)
  JPM:'XLF', GS:'XLF', MS:'XLF', BAC:'XLF', V:'XLF',
  // 헬스케어 (XLV)
  LLY:'XLV', UNH:'XLV', MRNA:'XLV', BNTX:'XLV', ABBV:'XLV',
  // 에너지 (XLE)
  XOM:'XLE', CVX:'XLE', DVN:'XLE', APA:'XLE', EOG:'XLE', TRGP:'XLE',
  // 소재 (XLB)
  FCX:'XLB', NEM:'XLB', MP:'XLB',
};
// 사전 로드할 섹터 ETF 목록 (중복 제거)
const SECTOR_ETFS = [...new Set(Object.values(SECTOR_ETF_MAP))];

const UNIVERSE_CACHE_PATH = path.join(CACHE_DIR, 'universe.json');
const UNIVERSE_TTL_MS = 24 * 60 * 60 * 1000; // 24시간

async function fetchUniverse() {
  // 캐시 확인 (24시간 TTL)
  try {
    const cached = JSON.parse(fs.readFileSync(UNIVERSE_CACHE_PATH, 'utf-8'));
    if (Date.now() - cached.savedAt < UNIVERSE_TTL_MS && cached.tickers?.length > 100) {
      return { tickers: cached.tickers, nameMap: cached.nameMap ?? {} };
    }
  } catch {}

  const tickers = new Set();
  const nameMap = {};
  async function parseWiki(url, tableIndex, tickerCol, nameCol) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!res.ok) return;
      const html = await res.text();
      const tables = [...html.matchAll(/<table[^>]*class="[^"]*wikitable[^"]*"[^>]*>([\s\S]*?)<\/table>/g)];
      const table = tables[tableIndex];
      if (!table) return;
      const rows = [...table[1].matchAll(/<tr[\s\S]*?<\/tr>/g)].slice(1);
      for (const row of rows) {
        const cells = [...row[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)];
        const tickerCell = cells[tickerCol];
        const nameCell   = cells[nameCol];
        if (!tickerCell) continue;
        const ticker = tickerCell[1].replace(/<[^>]+>/g, '').trim().split('\n')[0].trim();
        if (!/^[A-Z]{1,5}$/.test(ticker)) continue;
        tickers.add(ticker);
        if (nameCell) {
          const name = nameCell[1].replace(/<[^>]+>/g, '').trim().split('\n')[0].trim();
          if (name && !/^\w+ \d{1,2},\s*\d{4}$/.test(name)) nameMap[ticker] = name;
        }
      }
    } catch {}
  }
  await Promise.all([
    parseWiki('https://en.wikipedia.org/wiki/List_of_S%26P_500_companies', 0, 0, 1),
    parseWiki('https://en.wikipedia.org/wiki/Nasdaq-100', 4, 1, 0),
  ]);
  if (tickers.size < 100) return { tickers: FALLBACK, nameMap: {} };
  const result = { tickers: [...tickers], nameMap };
  try { fs.writeFileSync(UNIVERSE_CACHE_PATH, JSON.stringify({ ...result, savedAt: Date.now() })); } catch {}
  return result;
}

// ── Yahoo Finance OHLCV ────────────────────────────────────────────────
const YH_HDR = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': '*/*', 'Referer': 'https://finance.yahoo.com/',
};

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
      previousClose: meta.previousClose
    };
  } catch (err) {
    return null;
  }
}

async function fetchFinviz(sym) {
  try {
    const res = await fetch(`https://finviz.com/quote.ashx?t=${encodeURIComponent(sym)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const rowRe = /<tr[^>]*>(.*?)<\/tr>/gs;
    const cellRe = /<td[^>]*>(.*?)<\/td>/gs;
    const stripRe = /<[^>]+>/g;
    const data = {};
    let m;
    while ((m = rowRe.exec(html)) !== null) {
      const cells = [];
      let cm;
      const cp = new RegExp(cellRe.source, 'gs');
      while ((cm = cp.exec(m[1])) !== null)
        cells.push(cm[1].replace(stripRe, '').trim());
      for (let i = 0; i < cells.length - 1; i += 2)
        if (cells[i]) data[cells[i]] = cells[i + 1];
    }
    const pct = v => v ? parseFloat(v.replace('%','')) : null;
    const num = v => v ? parseFloat(v.replace(/[^0-9.-]/g,'')) : null;
    return {
      shortFloat: pct(data['Short Float']),
      shortRatio: num(data['Short Ratio']),
      instOwn:    pct(data['Inst Own']),
      instTrans:  pct(data['Inst Trans']),
    };
  } catch { return null; }
}

async function fetchHistory(symbol) {
  const cacheKey = `yh_${symbol.replace(/\./g,'-')}`;
  let rows = cacheGet(cacheKey);
  if (rows && rows[0]?.rawClose === undefined) rows = null;  // 구버전 캐시 무효화
  // 캐시가 CUTOFF 기준 7일 이상 오래됐으면 재요청
  if (rows) {
    const lastCached = rows.at(-1)?.date ?? '';
    const daysDiff = (new Date(CUTOFF) - new Date(lastCached)) / 86400000;
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
        date:     new Date(ts*1000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }),
        open:     q.open[i], high: q.high[i], low: q.low[i],
        close:    parseFloat(close.toFixed(4)),
        rawClose: rawClose != null ? parseFloat(rawClose.toFixed(4)) : parseFloat(close.toFixed(4)),
        volume:   q.volume[i] ?? 0,
      };
    }).filter(Boolean).sort((a,b) => a.date.localeCompare(b.date));
    if (!rows.length) return null;
    cacheSet(cacheKey, rows);
  }

  let filtered = rows.filter(r => r.date <= CUTOFF);

  // 장 중이고 CUTOFF가 오늘이면 실시간 데이터로 마지막 row 교체
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  if (isMarketOpen() && CUTOFF === today && filtered.length > 0) {
    const liveQuote = await fetchLiveQuote(symbol);
    if (liveQuote) {
      const lastRow = filtered[filtered.length - 1];
      // 오늘 날짜가 이미 있으면 교체, 없으면 추가
      if (lastRow.date === today) {
        filtered[filtered.length - 1] = {
          date: today,
          open: liveQuote.open,
          high: liveQuote.high,
          low: liveQuote.low,
          close: liveQuote.price,
          rawClose: liveQuote.price,
          volume: liveQuote.volume
        };
      } else {
        filtered.push({
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
  }

  return filtered;
}

// ── Yahoo Finance 옵션 데이터 (당일 실시간) ────────────────────────────
// 캐시 키: opt_{symbol}_{CUTOFF} — 날짜가 바뀌면 자동 갱신
async function fetchOptions(symbol) {
  const cacheKey = `opt_${symbol.replace(/\./g,'-')}_${CUTOFF}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const url = `https://query2.finance.yahoo.com/v7/finance/options/${encodeURIComponent(symbol)}`;
    const res = await fetch(url, { headers: YH_HDR });
    if (!res.ok) return null;
    const json = await res.json();
    const opt = json?.optionChain?.result?.[0]?.options?.[0];
    if (!opt) return null;

    const calls = opt.calls ?? [];
    const puts  = opt.puts  ?? [];

    const callVol = calls.reduce((s, c) => s + (c.volume ?? 0), 0);
    const putVol  = puts.reduce((s,  p) => s + (p.volume ?? 0), 0);
    const callOI  = calls.reduce((s, c) => s + (c.openInterest ?? 0), 0);

    const pcRatio       = putVol && callVol ? parseFloat((putVol / callVol).toFixed(2)) : null;
    const callVolToOI   = callOI ? parseFloat((callVol / callOI).toFixed(2)) : null;

    const result = { callVol, putVol, callOI, pcRatio, callVolToOI };
    cacheSet(cacheKey, result);
    return result;
  } catch { return null; }
}

// ── 실적 발표일 조회 (Yahoo Finance meta) ─────────────────────────────
// 에러 시 null 반환 (실패해도 분석 계속)
async function fetchEarningsDate(sym) {
  const cacheKey = `earn_${sym}_${CUTOFF}`;
  const cached = cacheGet(cacheKey);
  if (cached !== undefined && cached !== null) return cached;
  try {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5d`;
    const res = await fetch(url, { headers: YH_HDR });
    if (!res.ok) return null;
    const json = await res.json();
    const meta = json?.chart?.result?.[0]?.meta;
    if (!meta) return null;
    const ts = meta.earningsTimestampStart ?? meta.earningsTimestampEnd ?? null;
    const result = ts ? new Date(ts * 1000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) : null;
    cacheSet(cacheKey, result);
    return result;
  } catch { return null; }
}

// ── 기술적 지표 ────────────────────────────────────────────────────────
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
  // 전체 히스토리 기반 MACD 시리즈 (EMA warm-up 포함)
  const macdSeries = [];
  for (let i = 25; i < closes.length; i++) {
    const slice = closes.slice(0, i + 1);
    const e12 = calcEMA(slice, 12), e26 = calcEMA(slice, 26);
    if (e12 != null && e26 != null) macdSeries.push(e12 - e26);
  }
  if (macdSeries.length < 9) return null;
  const macdLine = macdSeries.at(-1);
  // signal = EMA(9) of MACD series
  const signal = calcEMA(macdSeries, 9);
  if (signal == null) return null;
  return {
    histogram: parseFloat((macdLine - signal).toFixed(3)),
    rising: macdLine > macdSeries.at(-2),
  };
}

function calcBB(closes, period = 20, mult = 2) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const mean  = avg(slice);
  const std   = Math.sqrt(slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period);
  return { upper: mean + mult * std, middle: mean, lower: mean - mult * std };
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

// ── RSI (period 가변) — Triple RSI / Connors RSI-2용 ─────────────────
function calcRSIFast(closes, period = 5) {
  if (closes.length < period + 1) return null;
  let g = 0, l = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const d = closes[i] - closes[i-1];
    if (d > 0) g += d; else l -= d;
  }
  if (l === 0) return 100;
  return parseFloat((100 - 100 / (1 + (g/period) / (l/period))).toFixed(1));
}

// ── IBS (Internal Bar Strength) ───────────────────────────────────────
// 0 = 당일 저가에 종가, 1 = 당일 고가에 종가
// < 0.25 = 매도 소진 (반등 신호), > 0.75 = 매수 과열 (차익실현 신호)
// rawClose 사용 (adjusted close는 배당/분할로 high/low 범위를 벗어날 수 있음)
function calcIBS(row) {
  if (!row || row.high === row.low) return 0.5;
  const c = row.rawClose ?? row.close;
  const val = (c - row.low) / (row.high - row.low);
  return parseFloat(Math.max(0, Math.min(1, val)).toFixed(3));
}

// ── 거래량 패턴: 하락 시 거래량 감소 + 상승 시 거래량 급증 ─────────────
// 세력 매집 핵심 신호 — 하락할 때 팔자 없고, 반등할 때 사자 몰림
function calcVolumePattern(rows) {
  if (rows.length < 15) return null;
  const recent   = rows.slice(-10);
  const avgVol20 = avg(rows.slice(-20).map(r => r.volume));
  if (!avgVol20) return null;

  const downVols = [], upVols = [];
  for (let i = 1; i < recent.length; i++) {
    if (recent[i].close < recent[i-1].close) downVols.push(recent[i].volume);
    else if (recent[i].close > recent[i-1].close) upVols.push(recent[i].volume);
  }
  if (!downVols.length || !upVols.length) return null;

  const downAvg = avg(downVols);
  const upAvg   = avg(upVols);
  const ratio   = parseFloat((upAvg / downAvg).toFixed(2));

  // 하락 시 거래량 < 20일 평균 (팔자 소진)
  const isDryUp = downAvg < avgVol20 * 0.9;
  // 상승 시 거래량 > 20일 평균 (매수 유입)
  const isSurge = upAvg > avgVol20 * 1.2;

  return { isDryUp, isSurge, ratio, downAvg, upAvg, avgVol20 };
}

// ── 캔들 패턴 감지 ────────────────────────────────────────────────────
function detectCandlePattern(row) {
  if (!row || !row.open || !row.high || !row.low) return null;
  const c = row.rawClose ?? row.close;
  const o = row.open;
  const h = row.high;
  const l = row.low;

  const range = h - l;
  if (range === 0) return null;

  const bodySize = Math.abs(c - o);
  const bodyPct  = bodySize / range;
  const upperShadow = h - Math.max(c, o);
  const lowerShadow = Math.min(c, o) - l;

  const patterns = [];

  // Doji: body가 전체 range의 10% 이하
  if (bodyPct <= 0.10) {
    patterns.push('doji');
  }

  // Hammer (상승 망치): 아래 그림자가 body의 2배 이상 + 위 그림자가 작음 + 양봉 선호
  if (lowerShadow >= bodySize * 2 && upperShadow <= bodySize * 0.5 && c >= o) {
    patterns.push('hammer');
  }

  // Inverted Hammer (역망치): 위 그림자가 body의 2배 이상 + 아래 그림자가 작음
  if (upperShadow >= bodySize * 2 && lowerShadow <= bodySize * 0.5) {
    patterns.push('inverted_hammer');
  }

  return patterns.length > 0 ? patterns : null;
}

// L2 저점 이후 캔들 패턴 분석 (다이버전스 강도 확인)
function analyzeCandlesAfterL2(rows, L2idx) {
  const afterL2 = rows.slice(L2idx);
  if (afterL2.length < 2) return { hasBullishPattern: false, patterns: [] };

  const patterns = [];
  let hasBullishPattern = false;

  // L2 당일 캔들 체크
  const l2Candle = detectCandlePattern(afterL2[0]);
  if (l2Candle) {
    if (l2Candle.includes('doji') || l2Candle.includes('hammer')) {
      hasBullishPattern = true;
      patterns.push(`L2 ${l2Candle.join('/')}`);
    }
  }

  // L2 다음날 캔들 체크
  if (afterL2.length >= 2) {
    const l2NextCandle = detectCandlePattern(afterL2[1]);
    if (l2NextCandle) {
      if (l2NextCandle.includes('doji') || l2NextCandle.includes('hammer')) {
        hasBullishPattern = true;
        patterns.push(`L2+1 ${l2NextCandle.join('/')}`);
      }
    }
  }

  return { hasBullishPattern, patterns };
}

// ── 스윙 저점 탐색 (좌우 wing개 캔들보다 낮아야 함) ──────────────────────
// wing=3 → 노이즈 필터링, 진짜 변곡점만 캐치
function findSwingLows(rows, lookback = 70, wing = 3) {
  if (rows.length < lookback) return [];
  const slice = rows.slice(-lookback);
  const swings = [];
  for (let i = wing; i < slice.length - wing; i++) {
    let isLow = true;
    for (let j = 1; j <= wing; j++) {
      if (slice[i].low >= slice[i - j].low || slice[i].low >= slice[i + j].low) {
        isLow = false; break;
      }
    }
    if (isLow) {
      const origIdx = rows.length - lookback + i;
      swings.push({ idx: origIdx, price: slice[i].low, close: slice[i].close });
    }
  }
  return swings;
}

// ── 스윙 고점 탐색 (좌우 wing개 캔들보다 높아야 함) ──────────────────────
function findSwingHighs(rows, lookback = 70, wing = 3) {
  if (rows.length < lookback) return [];
  const slice = rows.slice(-lookback);
  const swings = [];
  for (let i = wing; i < slice.length - wing; i++) {
    let isHigh = true;
    for (let j = 1; j <= wing; j++) {
      if (slice[i].high <= slice[i - j].high || slice[i].high <= slice[i + j].high) {
        isHigh = false; break;
      }
    }
    if (isHigh) {
      const origIdx = rows.length - lookback + i;
      swings.push({ idx: origIdx, price: slice[i].high, close: slice[i].close });
    }
  }
  return swings;
}

// ── V자 반등 패턴 감지 ────────────────────────────────────────────────────
// 급락 후 빠른 반등 = 높은 변동성 + 강한 모멘텀
// 백테스트 사례: T, BEN, CPAY (10-27) — 손절 터치 후 목표가 도달
// 특징: RSI 극저점 → 급상승, ATR% 높음, 반등 거래량 동반
function detectVShapedReversal(rows, div) {
  if (!div || rows.length < 10) return null;

  const closes = rows.map(r => r.close);
  const currentPrice = closes.at(-1);

  // 1. 최근 10일 내 저점 확인 (L2 기준)
  const l2Idx = rows.length - 1 - div.daysAgoL2;
  if (l2Idx < 0 || div.daysAgoL2 > 10) return null;

  // 2. L2 이전 5일 최고가 → L2 급락 확인
  const before5HighIdx = Math.max(0, l2Idx - 5);
  const before5High = Math.max(...rows.slice(before5HighIdx, l2Idx).map(r => r.high));
  const dropPct = (before5High - div.L2.price) / before5High * 100;

  // 급락 기준 완화: 5일 내 -7% 이상 (8→7)
  if (dropPct < 7) return null;

  // 3. L2 이후 빠른 반등 확인 (2-5일 내)
  if (div.daysAgoL2 < 2) return null;  // 최소 2일 경과
  const bouncePct = (currentPrice - div.L2.price) / div.L2.price * 100;

  // 반등 기준: +2.5% 이상 (3→2.5)
  if (bouncePct < 2.5) return null;

  // 4. 거래량 동반 반등 확인
  const avgVol20 = avg(rows.slice(-20).map(r => r.volume));
  const bounceVols = rows.slice(l2Idx + 1).map(r => r.volume);
  const bounceVolAvg = avg(bounceVols);
  const volConfirmed = bounceVolAvg > avgVol20 * 1.1;

  // 5. RSI 강한 개선 완화: 15pt 이상 (20→15, T는 18.8pt)
  if (div.rsiImprove < 15) return null;

  return {
    dropPct: parseFloat(dropPct.toFixed(1)),
    bouncePct: parseFloat(bouncePct.toFixed(1)),
    daysInPattern: div.daysAgoL2,
    volConfirmed,
    details: `⚡ V자 반등 — ${dropPct.toFixed(0)}% 급락 → ${bouncePct.toFixed(0)}% 반등 (${div.daysAgoL2}일)`
  };
}

// ── 삼각수렴 패턴 감지 (엄격 모드) ────────────────────────────────────────
// 고점 하향 + 저점 상향 = 변동성 감소 → 돌파 임박
// 백테스트 결과: 신뢰도 낮음 → 육안 확인 수준으로만 엄격화
// 반환: { type, score, details, daysInPattern } | null
function detectTriangleConsolidation(rows, opts = {}) {
  const lookback = opts.lookback ?? 40;
  const minSwings = opts.minSwings ?? 4;  // 4개로 증가 (3→4)

  if (rows.length < lookback) return null;

  const swingHighs = findSwingHighs(rows, lookback, 2);
  const swingLows = findSwingLows(rows, lookback, 2);

  if (swingHighs.length < minSwings || swingLows.length < minSwings) return null;

  // 최근 N개의 고점/저점만 사용 (최대 5개)
  const recentHighs = swingHighs.slice(-5);
  const recentLows = swingLows.slice(-5);

  // 패턴 최소 기간 확인: 20일 이상 형성되어야 함
  const patternDays = recentHighs.at(-1).idx - recentHighs[0].idx;
  if (patternDays < 20) return null;

  // 선형 회귀로 추세선 기울기 계산 (간단한 최소제곱법)
  const calcSlope = (points) => {
    const n = points.length;
    if (n < 2) return 0;
    const avgIdx = points.reduce((sum, p, i) => sum + i, 0) / n;
    const avgPrice = points.reduce((sum, p) => sum + p.price, 0) / n;
    let num = 0, den = 0;
    points.forEach((p, i) => {
      num += (i - avgIdx) * (p.price - avgPrice);
      den += (i - avgIdx) ** 2;
    });
    return den === 0 ? 0 : num / den;
  };

  const highSlope = calcSlope(recentHighs);
  const lowSlope = calcSlope(recentLows);

  // 수렴 범위 확인: 최근 고점-저점 범위가 초기 대비 줄어드는지
  const firstRange = recentHighs[0].price - recentLows[0].price;
  const lastRange = recentHighs.at(-1).price - recentLows.at(-1).price;
  const rangeCompression = (firstRange - lastRange) / firstRange * 100;

  // 수렴 조건 강화: 범위가 30% 이상 줄어들어야 함 (20→30)
  if (rangeCompression < 30) return null;

  // 거래량 감소 확인 (패턴 중반 vs 패턴 후반)
  const midVol = avg(rows.slice(-lookback, -lookback/2).map(r => r.volume));
  const recentVol = avg(rows.slice(-10).map(r => r.volume));
  const volDecline = midVol > 0 ? (midVol - recentVol) / midVol * 100 : 0;

  let type = null;
  let score = 0;
  const details = [];

  // 패턴 분류 (기울기 기준 강화: 0.02 → 0.04)
  if (highSlope < -0.04 && lowSlope > 0.04) {
    // 대칭 삼각형: 고점 하향 + 저점 상향 (명확한 수렴)
    type = 'symmetrical';
    score = 1;  // 3 → 1 (백테스트 결과 반영)
    details.push('🔺 대칭 삼각수렴 — 고점↓ 저점↑');
  } else if (Math.abs(highSlope) < 0.02 && lowSlope > 0.04) {
    // 상승 삼각형: 고점 평평 + 저점 상향 (강세, 더 신뢰)
    type = 'ascending';
    score = 2;  // 4 → 2
    details.push('📈 상승 삼각수렴 — 저점↑ (강세)');
  } else if (highSlope < -0.04 && Math.abs(lowSlope) < 0.02) {
    // 하락 삼각형: 고점 하향 + 저점 평평 (약세, 제외)
    return null;  // 하락 패턴은 아예 제외
  } else {
    // 수렴은 하지만 명확한 패턴 아님
    return null;
  }

  // 보너스: 거래량 감소가 뚜렷하면 +1점 (수렴 신뢰도↑)
  if (volDecline > 20) {
    score += 1;
    details.push(`📊 거래량 감소 ${volDecline.toFixed(0)}% — 돌파 대기`);
  }

  // 보너스: 범위 압축이 강하면 +1점 (돌파 임박)
  if (rangeCompression > 40) {
    score += 1;
    details.push(`⚡ 강한 수렴 ${rangeCompression.toFixed(0)}% — 돌파 임박`);
  }

  const daysInPattern = rows.length - recentLows[0].idx;
  details.push(`패턴 ${daysInPattern}일째 진행중`);

  return { type, score, details, daysInPattern, rangeCompression };
}

// ── 특정 인덱스 시점의 RSI 계산 ──────────────────────────────────────────
function calcRSIAt(closes, endIdx, period = 14) {
  if (endIdx < period) return null;
  let g = 0, l = 0;
  for (let i = endIdx - period + 1; i <= endIdx; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) g += d; else l -= d;
  }
  if (l === 0) return 100;
  return parseFloat((100 - 100 / (1 + (g / period) / (l / period))).toFixed(1));
}

// ── 특정 인덱스 시점의 MACD 라인값 계산 ──────────────────────────────────
function calcMACDLineAt(closes, endIdx) {
  if (endIdx < 26) return null;
  const slice = closes.slice(0, endIdx + 1);
  const e12 = calcEMA(slice, 12);
  const e26 = calcEMA(slice, 26);
  if (e12 == null || e26 == null) return null;
  return e12 - e26;
}

// ── 상승 다이버전스 탐지 엔진 ─────────────────────────────────────────────
// 가격 Lower Low + RSI/MACD Higher Low = 진짜 상승 다이버전스
// opts: SPY 같은 느린 자산에 완화된 기준 적용 가능
// 반환: { divScore, details, daysAgoL2, rsiL1, rsiL2, recoveryPct } | null
function detectBullishDivergence(rows, opts = {}) {
  const daysAgoMax    = opts.daysAgoMax    ?? 10;
  const recoveryMax   = opts.recoveryMax   ?? 12;
  const rsiImproveMin = opts.rsiImproveMin ?? 8;
  const rsiL1Max      = opts.rsiL1Max      ?? 40;  // SPY는 50까지 허용
  const lookback      = opts.lookback      ?? 70;

  if (rows.length < 80) return null;
  const closes = rows.map(r => r.close);

  const swings = findSwingLows(rows, lookback, 3);
  if (swings.length < 2) return null;

  // L2 = 가장 최근 스윙 저점
  const L2 = swings[swings.length - 1];
  const daysAgoL2 = rows.length - 1 - L2.idx;
  if (daysAgoL2 > daysAgoMax) return null;

  // L1 = 직전 스윙 저점 (최소 5일 이상 간격)
  const L1 = swings[swings.length - 2];
  if (L2.idx - L1.idx < 5) return null;

  // 가격은 L2 < L1 (Lower Low) 이어야 다이버전스
  if (L2.price >= L1.price) return null;

  // 각 저점에서 RSI, MACD 계산
  const rsiL1  = calcRSIAt(closes, L1.idx);
  const rsiL2  = calcRSIAt(closes, L2.idx);
  const macdL1 = calcMACDLineAt(closes, L1.idx);
  const macdL2 = calcMACDLineAt(closes, L2.idx);

  if (rsiL1 == null || rsiL2 == null) return null;

  // L1 RSI가 rsiL1Max 초과면 진짜 과매도 저점이 아님 (노이즈)
  if (rsiL1 > rsiL1Max) return null;

  const rsiImprove = rsiL2 - rsiL1;
  const rsiDiv  = rsiL2 > rsiL1 && rsiImprove >= rsiImproveMin;
  const macdDiv = macdL1 != null && macdL2 != null && macdL2 > macdL1;

  if (!rsiDiv && !macdDiv) return null;

  // 현재가 L2 저점 대비 상승폭
  const currentClose = closes.at(-1);
  const recoveryPct  = (currentClose - L2.price) / L2.price * 100;
  if (recoveryPct > recoveryMax) return null;

  let divScore = 0;
  const details = [];

  if (rsiDiv && macdDiv) {
    divScore += 6;
    details.push(`🎯 RSI+MACD 이중 상승 다이버전스 (RSI: ${rsiL1}→${rsiL2}, +${rsiImprove.toFixed(1)})`);
  } else if (rsiDiv) {
    divScore += 4;
    details.push(`📊 RSI 상승 다이버전스 (${rsiL1}→${rsiL2}, +${rsiImprove.toFixed(1)})`);
  } else {
    divScore += 3;
    details.push(`📊 MACD 상승 다이버전스 (RSI: ${rsiL1}→${rsiL2})`);
  }

  // 신선도
  if (daysAgoL2 <= 2)      { divScore += 3; details.push(`⚡ 극신선 저점 (${daysAgoL2}일 전)`); }
  else if (daysAgoL2 <= 5) { divScore += 2; details.push(`✅ 최신 저점 (${daysAgoL2}일 전)`); }
  else if (daysAgoL2 <= 8) { divScore += 1; details.push(`저점 ${daysAgoL2}일 전`); }

  // RSI 개선폭 보너스
  if (rsiDiv && rsiImprove >= 15) { divScore += 2; }
  else if (rsiDiv && rsiImprove >= 8) { divScore += 1; }

  // 반등 시작: 2~8% 이상적 (모멘텀 확인 중)
  if (recoveryPct >= 2 && recoveryPct <= 8) {
    divScore += 1;
    details.push(`반등 초입 +${recoveryPct.toFixed(1)}%`);
  }

  L1.date = rows[L1.idx]?.date ?? null;
  L2.date = rows[L2.idx]?.date ?? null;
  return { divScore, details, daysAgoL2, rsiL1, rsiL2, rsiImprove, rsiDiv, macdDiv, recoveryPct, L1, L2 };
}

// ── 모멘텀 확인: L2 저점 이후 실제 반등이 시작됐는가 ─────────────────────
// 조건: L2 이후 최소 2일 경과 + 그 중 2일 이상 상승 마감 + 현재도 유지 중
// 목적: "반전 가능성"이 아닌 "반전이 실제로 시작됐음" 확인 후 진입
function checkMomentumConfirmation(rows, L2idx) {
  const afterL2 = rows.slice(L2idx);  // L2 포함
  const daysAfter = afterL2.length - 1;  // L2 이후 경과일
  if (daysAfter < 2) return { confirmed: false, upDays: 0, daysAfter };

  const avgVol20 = avg(rows.slice(-20).map(r => r.volume));

  let upDays = 0;
  let volConfirmed = false;
  for (let i = 1; i < afterL2.length; i++) {
    if (afterL2[i].close > afterL2[i - 1].close) {
      upDays++;
      if (afterL2[i].volume > avgVol20 * 1.1) volConfirmed = true;
    }
  }

  // 현재가가 L2 직후 첫날 종가보다 높아야 추세 유지 중
  const trendHolding = afterL2.at(-1).close >= afterL2[1]?.close;

  const confirmed = upDays >= 2 && trendHolding;
  return { confirmed, upDays, daysAfter, volConfirmed };
}

// ── 섹터 ETF 건강도 체크 ──────────────────────────────────────────────
// 반환: 'healthy' | 'weak' | 'unknown'
// weak 조건: ETF < 50MA  OR  최근 5일 연속 종가 하락
function checkSectorHealth(sectorRows) {
  if (!sectorRows || sectorRows.length < 50) return 'unknown';
  const closes = sectorRows.map(r => r.close);
  const ma50 = avg(closes.slice(-50));
  const current = closes.at(-1);
  if (current < ma50) return 'weak';
  // 최근 5일 연속 하락
  const last6 = closes.slice(-6);
  const consecutive5Down = last6.every((c, i) => i === 0 || c < last6[i - 1]);
  if (consecutive5Down) return 'weak';
  return 'healthy';
}

// ── 종목 분석 — 진짜 상승 다이버전스 후보만 ─────────────────────────────
// 다이버전스 탐지가 핵심 필수 조건 (없으면 탈락)
// 나머지 신호는 다이버전스 품질 강화 증거
// ── 과거 다이버전스 성공 이력 ────────────────────────────────────────────
function checkHistoricalDivergences(rows) {
  const OUTCOME_DAYS = 20;
  const results = [];
  const seen = new Set();

  for (let endIdx = 100; endIdx <= rows.length - OUTCOME_DAYS - 5; endIdx += 5) {
    const slice = rows.slice(0, endIdx);
    const d = detectBullishDivergence(slice, {
      daysAgoMax: 10, recoveryMax: 15, rsiImproveMin: 4, rsiL1Max: 50, lookback: 70,
    });
    if (!d) continue;
    const L2absIdx = endIdx - 1 - d.daysAgoL2;
    if (L2absIdx < 0 || seen.has(L2absIdx)) continue;
    seen.add(L2absIdx);
    const outcomeRow = rows[L2absIdx + OUTCOME_DAYS];
    if (!outcomeRow) continue;
    const gainPct = parseFloat(((outcomeRow.close - d.L2.price) / d.L2.price * 100).toFixed(1));
    results.push({ date: d.L2.date, gainPct, success: gainPct > 2, rsiImprove: d.rsiImprove });
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

function analyzeSymbol(symbol, rows, spyRows, sectorRowsMap, bearMarket = false, cutoffDate = null) {
  if (rows.length < 80) return null;
  const closes = rows.map(r => r.close);
  const rsi  = calcRSI(closes);
  const macd = calcMACD(closes);
  const atr  = calcATR(rows);
  if (rsi == null || atr == null) return null;

  const currentPrice = closes.at(-1);
  const ma50     = avg(closes.slice(-50));
  const ma200    = closes.length >= 200 ? avg(closes.slice(-200)) : null;
  const avgVol20 = avg(rows.slice(-20).map(r => r.volume));

  // rawClose 기준 recentHigh (buyPrice도 rawClose라 일치해야 함)
  const recentHighRaw = Math.max(...rows.slice(-40).map(r => r.rawClose ?? r.close));
  // adjusted close 기준 (눌림 % 표시용만 — target 계산은 recentHighRaw 사용)

  // ── 필터 1: 완전 붕괴 종목만 제외 (200MA 30% 이상 아래) ─────────────────
  if (ma200 && currentPrice < ma200 * 0.70) return null;

  // ── 필터 2: RSI 범위 — 모멘텀 강한 종목 포착 위해 상한 80 ──────────────
  if (rsi < 20 || rsi > 80) return null;

  // ── 필터 3: 최소 거래량 ──────────────────────────────────────────────
  if (avgVol20 > 0 && rows.at(-1).volume < avgVol20 * 0.3) return null;

  // ── 핵심 필수: 상승 다이버전스 탐지 ─────────────────────────────────
  const div = detectBullishDivergence(rows);
  let noDivergence = false;
  let momentum = null;

  // 다이버전스 있으면 기존 로직대로
  if (div) {
    momentum = checkMomentumConfirmation(rows, div.L2.idx);
    if (momentum.upDays < 1) return null;
  } else {
    // 다이버전스 없으면 강한 시그널 체크 (나중에 검증)
    noDivergence = true;
  }

  // ── 캔들 패턴 분석 — L2 이후 Doji/Hammer 패턴 (추세 전환 신호) ──────
  const candleAnalysis = div ? analyzeCandlesAfterL2(rows, div.L2.idx) : { hasBullishPattern: false, patterns: [] };

  // ── V자 반등 패턴 감지 — 급락 후 빠른 반등 ─────────────────────────────
  const vShape = detectVShapedReversal(rows, div);

  // ── 삼각수렴 패턴 감지 — 돌파 직전 신호 (엄격 모드) ─────────────────
  // 백테스트 결과: 기준 강화 + 점수 하향 (3→1, 4→2)
  const triangle = detectTriangleConsolidation(rows);

  // ── 섹터 ETF 건강도: weak이면 점수 패널티 (하드 제외 X — 바닥 섹터도 기회 있음) ──
  let sectorPenalty = 0;
  const sectorEtf = SECTOR_ETF_MAP[symbol];
  if (sectorEtf && sectorRowsMap) {
    const health = checkSectorHealth(sectorRowsMap[sectorEtf]);
    if (health === 'weak') sectorPenalty = -2;
  }

  // ── 스코어링 ──────────────────────────────────────────────────────────
  let score = div ? (div.divScore + sectorPenalty) : (6 + sectorPenalty);
  const patterns = div ? [...div.details] : [];

  // V자 반등 패턴 점수 (고변동성 + 강한 반등)
  if (vShape) {
    score += 3;  // 강력한 신호
    patterns.push(vShape.details);
    if (vShape.volConfirmed) {
      patterns.push(`📊 반등 거래량 동반 확인`);
    }
  }

  // 캔들 패턴 점수 (상승 전환 신호)
  if (candleAnalysis.hasBullishPattern) {
    score += 2;
    patterns.push(`🕯️ 상승 전환 캔들 — ${candleAnalysis.patterns.join(', ')}`);
  }

  // 삼각수렴 패턴 점수 (돌파 준비 신호)
  if (triangle) {
    score += triangle.score;
    patterns.push(...triangle.details);
  }

  // 눌림 위치 참고 표시
  const pullbackPct = (currentPrice - recentHighRaw) / recentHighRaw * 100;
  const ma50Str = ` (50MA ${currentPrice >= ma50 ? '+' : ''}${((currentPrice/ma50-1)*100).toFixed(1)}%)`;
  patterns.push(`눌림 ${pullbackPct.toFixed(1)}%  현재RSI ${rsi}${ma50Str}`);

  // 거래량 소진 + 반등 급증 (다이버전스 저점에서 가장 강력한 확인 신호)
  const volPat = calcVolumePattern(rows);
  if (volPat?.isDryUp && volPat?.isSurge) {
    score += 5;  // 3 → 5 강화 (백테스트 결과: 수급 강한 신호)
    patterns.push(`⭐ 매집 패턴 — 하락↓${(volPat.downAvg/volPat.avgVol20*100).toFixed(0)}% + 반등↑${(volPat.upAvg/volPat.avgVol20*100).toFixed(0)}%`);
  } else if (volPat?.isDryUp) {
    score += 2;
    patterns.push(`하락 거래량 소진 (${(volPat.downAvg/volPat.avgVol20*100).toFixed(0)}%) — 매도 압력 약화`);
  } else if (volPat?.isSurge) {
    score += 1;
    patterns.push(`반등 거래량 급증 (${(volPat.upAvg/volPat.avgVol20*100).toFixed(0)}%)`);
  }

  // BB 하단 근처에서 다이버전스 = 지지 + 모멘텀 전환 동시
  const bb = calcBB(closes);
  const recentLow5 = Math.min(...rows.slice(-5).map(r => r.low));
  if (bb && recentLow5 <= bb.lower * 1.02) {
    score += 2;
    patterns.push(`BB 하단 지지 ($${bb.lower.toFixed(2)})`);
  }

  // IBS: 당일 저가 근처 종가 = 매도 소진
  const ibs = calcIBS(rows.at(-1));
  if (ibs < 0.25) { score += 1; patterns.push(`IBS ${ibs} — 당일 매도 소진`); }

  // 모멘텀 확인 품질 점수 (하드 필터 통과 전제 — 품질 차등)
  if (momentum) {
    if (momentum.volConfirmed && momentum.upDays >= 3) {
      score += 3;
      patterns.push(`🚀 모멘텀 확인 ${momentum.daysAfter}일 중 ${momentum.upDays}일 상승 + 거래량 동반`);
    } else if (momentum.volConfirmed) {
      score += 2;
      patterns.push(`✅ 모멘텀 확인 ${momentum.upDays}일 상승 + 거래량 동반`);
    } else if (momentum.upDays >= 3) {
      score += 2;
      patterns.push(`✅ 모멘텀 확인 ${momentum.daysAfter}일 중 ${momentum.upDays}일 상승`);
    } else {
      score += 1;
      patterns.push(`✅ 모멘텀 확인 ${momentum.upDays}일 상승 (거래량 미동반)`);
    }
  }

  // 섹터 약세 경고 표시
  if (sectorPenalty < 0) patterns.push(`⚠️ 섹터 약세 (-2점 패널티)`);

  // 다이버전스 없으면 강한 시그널 2개 이상 필요
  if (noDivergence) {
    let strongSignals = 0;

    // 1. 거래량 패턴 (매집/반등)
    if (volPat?.isDryUp && volPat?.isSurge) strongSignals += 2;
    else if (volPat?.isDryUp || volPat?.isSurge) strongSignals += 1;

    // 2. BB 하단 지지
    if (bb && recentLow5 <= bb.lower * 1.02) strongSignals += 1;

    // 3. 삼각수렴 패턴
    if (triangle) strongSignals += 1;

    // 4. 상승 전환 캔들
    if (candleAnalysis.hasBullishPattern) strongSignals += 1;

    // 강한 시그널 2개 미만이면 탈락
    if (strongSignals < 2) return null;

    patterns.unshift(`⚠️ 다이버전스 미확인 (강한 시그널 ${strongSignals}개 기반)`);
  }

  // 점수 6점 이상이면 추천 (다이버전스 + 기본 패턴 확인만)
  if (score < 6) return null;

  // ── 타겟/손절 ─────────────────────────────────────────────────────────
  const buyPrice = parseFloat(rows.at(-1).rawClose.toFixed(2));
  const target   = parseFloat(Math.min(recentHighRaw, buyPrice + atr * 2.0).toFixed(2));

  // 구조적 손절: L2 저점 1% 아래 (다이버전스가 깨지면 = 패턴 실패)
  // L2가 현재가에서 너무 멀면(>10%) ATR 기반으로 fallback
  // 변동성 고려: ATR%가 크면 손절폭 확대
  const atrPercent = (atr / buyPrice) * 100;
  let stopMultiplier = 1.0;
  if (atrPercent > 3.0) {
    stopMultiplier = 2.5;  // 변동성 큰 종목 (T, BEN, CPAY 케이스)
  } else if (atrPercent > 2.0) {
    stopMultiplier = 2.0;
  } else {
    stopMultiplier = 1.5;
  }

  // 다이버전스 강도별 손절폭 차등 적용 (백테스트 개선)
  if (div && div.rsiImprove >= 20) {
    // 강한 다이버전스 (RSI 20pt+ 개선) → 손절폭 30% 확대
    stopMultiplier *= 1.3;
  } else if (div && div.rsiImprove >= 15) {
    // 중간 다이버전스 (RSI 15pt+ 개선) → 손절폭 15% 확대
    stopMultiplier *= 1.15;
  }

  // V자 반등 패턴 추가 손절폭 확대 (극단적 변동성 대응)
  if (vShape) {
    // V자 반등 → 손절폭 추가 2.2배 확대
    // 사례: T, BEN, CPAY — 급락 후 반등이지만 일시적 저점 터치 가능
    // 백테스트 결과: 1.8배로는 부족 (BEN 1.0% 차이로 손절)
    stopMultiplier *= 2.2;
  }

  let stop;
  if (div) {
    const l2DistPct = (buyPrice - div.L2.price) / buyPrice * 100;

    // V자 반등 시 구조적 손절도 확대 (L2 99% → 95%)
    const structuralStopPct = vShape ? 0.95 : 0.99;

    stop = l2DistPct <= 10
      ? parseFloat((div.L2.price * structuralStopPct).toFixed(2))   // 구조적 손절
      : parseFloat((buyPrice - atr * stopMultiplier).toFixed(2));  // ATR fallback (변동성 고려)
  } else {
    // 다이버전스 없으면 ATR 기반 손절 (변동성 고려)
    stop = parseFloat((buyPrice - atr * (stopMultiplier + 0.2)).toFixed(2));
  }
  const tPct     = parseFloat(((target - buyPrice) / buyPrice * 100).toFixed(1));
  const sPct     = parseFloat(((stop   - buyPrice) / buyPrice * 100).toFixed(1));
  const rrRatio  = parseFloat((Math.abs(tPct) / Math.abs(sPct)).toFixed(2));

  const histDiv = checkHistoricalDivergences(rows);

  const recent10 = rows.slice(-11);
  const upVols10 = [], dnVols10 = [];
  for (let i = 1; i < recent10.length; i++) {
    (recent10[i].close >= recent10[i-1].close ? upVols10 : dnVols10).push(recent10[i].volume);
  }
  // rrOk: 진입 적합 여부 (false여도 차트 연습용으로 반환)
  const rrOk = rrRatio >= 1.2;

  // 확신도 계산
  let confidence = 50;
  if (div) {
    confidence = 70; // 다이버전스 기본
    if (div.rsiDiv && div.macdDiv) confidence += 10; // 이중 다이버전스
    if (div.rsiImprove >= 20) confidence += 10; // 강한 RSI 개선
    else if (div.rsiImprove >= 10) confidence += 5;
    if (volPat?.isDryUp && volPat?.isSurge) confidence += 5; // 매집 패턴
  } else {
    // 다이버전스 없으면 50% 기본 + 시그널별 가산
    if (volPat?.isDryUp && volPat?.isSurge) confidence += 15;
    if (triangle) confidence += 8;
    if (bb && recentLow5 <= bb.lower * 1.02) confidence += 5;
    if (candleAnalysis.hasBullishPattern) confidence += 5;
  }
  confidence = Math.min(confidence, 95); // 최대 95%

  return { symbol, score, rsi, macdRising: macd?.rising, macdHist: macd?.histogram ?? null,
           buyPrice, target, stop, tPct, sPct, rrRatio, rrOk, patterns,
           div, momentum, atr, histDiv, bb, avgVol20,
           upVolAvg: avg(upVols10), dnVolAvg: avg(dnVols10),
           noDivergence, confidence,
  };
}

// ── 눌림목/추세 매매 탐지 — 상승장 전용 ──────────────────────────────
// 조건: 200MA 위 + RSI 75 이하 (과열 제외만)
function detectPullbackInUptrend(symbol, rows) {
  if (rows.length < 200) return null;
  const closes = rows.map(r => r.close);
  const rsi  = calcRSI(closes);
  const atr  = calcATR(rows);
  if (rsi == null || atr == null) return null;

  const currentPrice = closes.at(-1);
  const ma50  = avg(closes.slice(-50));
  const ma200 = avg(closes.slice(-200));
  const avgVol20 = avg(rows.slice(-20).map(r => r.volume));

  // 1. 200MA 위 상승 추세 (필수)
  if (currentPrice <= ma200) return null;

  // 2. RSI 과열 제외
  if (rsi > 75) return null;

  const recentHigh60 = Math.max(...rows.slice(-60).map(r => r.rawClose ?? r.close));
  const pullbackPct = (recentHigh60 - currentPrice) / recentHigh60 * 100;

  let score = 6;
  const patterns = [];
  patterns.push(`📐 눌림목 매매 — 200MA 위 상승 추세 중 ${pullbackPct.toFixed(1)}% 조정`);
  const ma50sign = currentPrice >= ma50 ? '+' : '';
  patterns.push(`50MA ${((currentPrice/ma50-1)*100) >= 0 ? '위' : '아래'} ${ma50sign}${((currentPrice/ma50-1)*100).toFixed(1)}%  현재RSI ${rsi}`);

  // 거래량 동반 반등
  const volRatio = avgVol20 > 0 ? rows.at(-1).volume / avgVol20 : null;
  if (volRatio && volRatio >= 1.2) {
    score += 1;
    patterns.push(`반등 거래량 동반 (${(volRatio*100).toFixed(0)}%)`);
  }

  // 50MA 정확히 지지
  if (distTo50 <= 2) {
    score += 1;
    patterns.push(`50MA 지지 확인 ($${ma50.toFixed(2)})`);
  }

  // RSI 45 이하 = 눌림 충분
  if (rsi <= 45) {
    score += 1;
    patterns.push(`RSI ${rsi} — 눌림 충분 (매도세 약화)`);
  }

  // 200MA 대비 위치 (장기 추세 강도)
  const vs200 = ((currentPrice - ma200) / ma200 * 100).toFixed(1);
  patterns.push(`200MA 위 +${vs200}% — 장기 상승 추세 유지`);

  const buyPrice = parseFloat((rows.at(-1).rawClose ?? rows.at(-1).close).toFixed(2));
  const target   = parseFloat(Math.min(recentHigh60, buyPrice + atr * 2.5).toFixed(2));
  const stop     = parseFloat((ma50 * 0.97).toFixed(2));   // 50MA 아래 3% 손절
  if (target <= buyPrice || stop >= buyPrice) return null;

  const tPct    = parseFloat(((target - buyPrice) / buyPrice * 100).toFixed(1));
  const sPct    = parseFloat(((stop   - buyPrice) / buyPrice * 100).toFixed(1));
  const rrRatio = parseFloat((Math.abs(tPct) / Math.abs(sPct)).toFixed(2));
  const rrOk    = rrRatio >= 1.2;

  return {
    symbol, score, rsi, macdRising: null, macdHist: null,
    buyPrice, target, stop, tPct, sPct, rrRatio, rrOk, patterns,
    div: null, momentum: null, atr, histDiv: null, bb: null, avgVol20,
    upVolAvg: null, dnVolAvg: null,
    patternType: 'pullback',
  };
}

// ── 메인 ──────────────────────────────────────────────────────────────
const line = '━'.repeat(60);

console.log(`\n🚀 단타 어시스턴트 (기준일: ${CUTOFF})\n`);

const { tickers, nameMap } = await fetchUniverse();

// 활성 필터 표시
const activeFilters = [
  '눌림목(50MA+RSI35-62+반등확인)',
  ...Object.entries(savedFilters).filter(([,v])=>v).map(([k,v])=>
    k==='spyFilter'?'SPY 200MA':k==='rsiRising'?'RSI 바닥확인':
    k==='volumeConfirm'?'거래량확인':k==='spyTrend5d'?'SPY5d':
    k==='spy10d'?'SPY10d':k==='maxATRPct'?`ATR<${(v*100).toFixed(0)}%`:k
  ),
];
console.log(`🔧 전략: ${activeFilters.join(', ')}\n`);
console.log(`유니버스: ${tickers.length}개 종목 스캔\n`);

// SPY + QQQ + VIX + 섹터 ETF 데이터 로드
const [spyRows, qqqRows, vixRows, ...sectorEtfRowsList] = await Promise.all([
  fetchHistory('SPY'),
  fetchHistory('QQQ'),
  fetchHistory('%5EVIX'),  // ^VIX
  ...SECTOR_ETFS.map(etf => fetchHistory(etf)),
]);
const sectorRowsMap = Object.fromEntries(
  SECTOR_ETFS.map((etf, i) => [etf, sectorEtfRowsList[i]])
);
const currentVix = vixRows?.at(-1)?.close ?? null;

// ── 시장 지표 출력 ─────────────────────────────────────────────────────
function printMarketIndicator(label, rows) {
  if (!rows || rows.length < 20) return;
  const last   = rows.at(-1);
  const prev   = rows.at(-2);
  const ma50   = rows.length >= 50  ? avg(rows.slice(-50).map(r => r.close))  : null;
  const ma200  = rows.length >= 200 ? avg(rows.slice(-200).map(r => r.close)) : null;
  const spy5avg = rows.length >= 6 ? avg(rows.slice(-6, -1).map(r => r.close)) : null;
  const rsi    = calcRSI(rows.map(r => r.close));
  const dayChg = prev ? ((last.close - prev.close) / prev.close * 100).toFixed(2) : null;
  const chgSign = dayChg > 0 ? '+' : '';
  const vs50   = ma50  ? ((last.close - ma50)  / ma50  * 100).toFixed(1) : null;
  const vs200  = ma200 ? ((last.close - ma200) / ma200 * 100).toFixed(1) : null;
  const trend5 = spy5avg ? (last.close > spy5avg ? '▲ 단기상승' : '▼ 단기하락') : '';
  const ma50icon  = ma50  ? (last.close > ma50  ? '✅' : '❌') : '';
  const ma50lbl   = ma50  ? (last.close > ma50  ? `50MA위 +${vs50}%`  : `50MA아래 ${vs50}%`)  : '';
  const ma200icon = ma200 ? (last.close > ma200 ? '✅' : '❌') : '';
  const ma200lbl  = ma200 ? (last.close > ma200 ? `200MA위 +${vs200}%` : `200MA아래 ${vs200}%`) : '';
  console.log(`  ${label.padEnd(5)} $${last.close.toFixed(2).padEnd(8)} ${chgSign}${dayChg}%  RSI ${rsi}  ${ma50icon} ${ma50lbl}  ${ma200icon} ${ma200lbl}  ${trend5}`);
}

const isToday = CUTOFF === new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

console.log(`\n${line}`);
console.log('📊 시장 지표');
console.log(`  SPY = S&P 500 ETF (미국 시장 전체)  |  QQQ = 나스닥100 ETF (기술주 중심)`);
console.log(line);
printMarketIndicator('SPY', spyRows);
printMarketIndicator('QQQ', qqqRows);
console.log();

// ── 실전 보유 종목 현황 (real-portfolio.json 기준) ─────────────────────
if (isToday) {
  const REAL_PATH = path.join(__dirname, '../output/real-portfolio.json');
  if (fs.existsSync(REAL_PATH)) {
    const realPortfolio = JSON.parse(fs.readFileSync(REAL_PATH, 'utf-8'));
    const held = realPortfolio.positions?.filter(p => p.status === 'open') ?? [];

    if (held.length > 0) {
      console.log(`${line}`);
      console.log('📂 실전 보유 종목');
      console.log(line);

      for (const p of held) {
        const rows = await fetchHistory(p.symbol);
        if (!rows || rows.length < 21) {
          console.log(`  ${p.symbol.padEnd(6)} ⏳ 데이터 없음`);
          continue;
        }
        const last         = rows.at(-1);
        const currentPrice = last.close;
        const avgVol20     = avg(rows.slice(-20).map(r => r.volume));
        const volRatio     = avgVol20 > 0 ? parseFloat((last.volume / avgVol20).toFixed(2)) : null;
        const pnlPct       = parseFloat(((currentPrice - p.buyPrice) / p.buyPrice * 100).toFixed(2));
        const pnlSign      = pnlPct >= 0 ? '+' : '';
        const nearTarget   = currentPrice >= p.targetPrice * 0.95;
        const nearStop     = currentPrice <= p.stopLoss * 1.05;
        const statusIcon   = nearStop ? '🔴' : nearTarget ? '🟡' : pnlPct >= 0 ? '🟢' : '🟠';

        console.log(`\n  ${statusIcon} ${p.symbol.padEnd(6)} 매수 $${p.buyPrice} → 현재 $${currentPrice.toFixed(2)} (${pnlSign}${pnlPct}%)`);
        console.log(`     목표 $${p.targetPrice}  손절 $${p.stopLoss}  |  거래량 평균 대비 ${volRatio ? (volRatio*100).toFixed(0)+'%' : '-'}`);

        const bbHold     = calcBB(rows.map(r => r.close));
        const bbBreakout = bbHold && currentPrice >= bbHold.upper * 0.98 && volRatio && volRatio >= 1.3;
        if (bbBreakout) {
          console.log(`     🚀 BB 상단 돌파 + 거래량 ${(volRatio*100).toFixed(0)}% — 추가 상승 가능`);
        } else if (nearTarget) {
          if (volRatio && volRatio >= 1.5)     console.log(`     ⚡ 거래량 폭발 (${(volRatio*100).toFixed(0)}%) + 목표가 근처`);
          else if (volRatio && volRatio <= 0.8) console.log(`     ⚠️  거래량 미동반 (${(volRatio*100).toFixed(0)}%) → ${(p.targetPrice*0.97).toFixed(2)} 근처 익절 고려`);
          else                                  console.log(`     🎯 목표가 근처 — 거래량 주시`);
        } else if (nearStop) {
          console.log(`     🛑 손절가 근처 — 손절 준비`);
        }
      }
      console.log();
    }
  }
}

// ── SPY 상태 분석 — 3단계 티어 ────────────────────────────────────────
let bearMarket = false;
let spyDivergence = null;
let spyBearTier = 0;  // 0=정상 1=주의(50MA아래) 2=경고(200MA아래) 3=위험(200MA-5%+)

if (spyRows && spyRows.length >= 50) {
  const spyCurrent = spyRows.at(-1).close;
  const spyMA50  = avg(spyRows.slice(-50).map(r => r.close));
  const spyMA200 = spyRows.length >= 200 ? avg(spyRows.slice(-200).map(r => r.close)) : null;
  bearMarket = spyCurrent < spyMA50;

  if (bearMarket) {
    if (spyMA200 && spyCurrent < spyMA200 * 0.95) spyBearTier = 3;       // 200MA 5%+ 아래
    else if (spyMA200 && spyCurrent < spyMA200)   spyBearTier = 2;       // 200MA 아래
    else                                            spyBearTier = 1;       // 50MA 아래만

    spyDivergence = detectBullishDivergence(spyRows, {
      daysAgoMax: 20, recoveryMax: 15, rsiImproveMin: 5, rsiL1Max: 50, lookback: 120
    });

    const vix = currentVix;
    const vixStr = vix ? ` VIX ${vix.toFixed(1)}` : '';
    const tierLabels = ['', '⚠️ 주의', '🔴 경고', '🚨 위험'];
    const tierDescs  = [
      '',
      'score 11+ 종목만 표시',
      'score 13+ 종목만 표시 — 비중 절반 권장',
      'score 15+ 종목만 표시 — 소량 진입만 권장',
    ];
    if (spyDivergence) {
      console.log(`\n🟡 하락장(티어${spyBearTier})${vixStr} + SPY 다이버전스 감지 — 반등 가능성 있음\n`);
    } else {
      console.log(`\n${tierLabels[spyBearTier]} 하락장 티어${spyBearTier}${vixStr} — ${tierDescs[spyBearTier]}\n`);
    }
  }
}

// 티어별 최소 score 기준 (SPY 다이버전스 있으면 한 단계 완화)
const TIER_MIN = [8, 11, 13, 15];
const effectiveTier = spyDivergence ? Math.max(0, spyBearTier - 1) : spyBearTier;
const bearMarketScoreMin = TIER_MIN[effectiveTier];

const results = [];
let fetched = 0;

// 8개씩 병렬 처리
for (let i = 0; i < tickers.length; i += 8) {
  const batch = tickers.slice(i, i+8);
  const settled = await Promise.allSettled(batch.map(async sym => {
    const rows = await fetchHistory(sym);
    fetched++;
    process.stdout.write(`\r📈 스캔 중... ${fetched}/${tickers.length}`);
    if (!rows || rows.length < 30) return null;
    const divResult = analyzeSymbol(sym, rows, spyRows, sectorRowsMap, bearMarket, CUTOFF);
    if (divResult) return divResult;
    // 상승장에서만 눌림목 탐지 fallback
    if (!bearMarket) return detectPullbackInUptrend(sym, rows);
    return null;
  }));
  settled.forEach(r => { if (r.status==='fulfilled' && r.value) results.push(r.value); });
  await sleep(50);
}

process.stdout.write('\n');

// ── 중복 방지 필터 ────────────────────────────────────────────────────
let excludedSymbols = new Set();

if (isToday) {
  // 실전 모드: 보유 종목 제외
  const holdings = getCurrentHoldings();
  if (holdings.size > 0) {
    console.log(`\n📂 보유 종목 제외: ${Array.from(holdings).join(', ')}\n`);
    excludedSymbols = holdings;
  }
} else {
  // 백테스트 모드: 최근 10거래일 추천 종목 제외
  const recentlyRecommended = getRecentlyRecommendedSymbols(CUTOFF, 10);
  if (recentlyRecommended.size > 0) {
    console.log(`\n🔄 최근 10거래일 추천 이력 제외: ${Array.from(recentlyRecommended).join(', ')}\n`);
    excludedSymbols = recentlyRecommended;
  }
}

// 잔액 읽기 (종목 필터링에 먼저 필요)
const balanceForFilter = fs.existsSync(BALANCE_PATH)
  ? (JSON.parse(fs.readFileSync(BALANCE_PATH,'utf-8')).balance ?? 10000)
  : 10000;
const perPickAmtFilter = parseFloat((balanceForFilter * 0.20 / 5).toFixed(2));

// 1차 필터링: top 10 후보 선정
const topCandidates = results
  .filter(p => !excludedSymbols.has(p.symbol))  // 중복 종목 제외
  .filter(p => Math.floor(perPickAmtFilter / p.buyPrice) >= 1)
  .filter(p => p.score >= 6)  // 점수 6점 이상만
  .sort((a,b) => b.score - a.score)
  .slice(0, 10);  // top 10 후보

// 실적발표 체크 (top 5만 체크 → rate limit 회피: 5 calls/min)
if (CUTOFF) {
  console.log('\n📅 실적발표 체크 중... (Alpha Vantage API, 12초 간격)');
  const top5 = topCandidates.slice(0, 5);
  for (let i = 0; i < top5.length; i++) {
    const pick = top5[i];
    process.stdout.write(`\r   ${i+1}/5: ${pick.symbol}...`);
    const earnings = await checkEarningsCalendar(pick.symbol, CUTOFF);
    if (earnings?.isWithin2Days && pick.score >= 6) {  // 7 → 6 (테스트용)
      pick.score += 5;
      const daysText = earnings.daysUntil === 0 ? '당일' : earnings.daysUntil === 1 ? '익일' : `${earnings.daysUntil}일 후`;
      pick.patterns.push(`📅 실적 발표 ${daysText} — 갭 트레이딩 기회 🎯`);
      process.stdout.write(` ✅ 실적발표 ${daysText}\n`);
    } else {
      process.stdout.write(` -\n`);
    }
    // Alpha Vantage rate limit: 5 calls/min → 12초 delay
    if (i < top5.length - 1) await sleep(12000);
  }
  console.log('');
}

// 재정렬 후 최종 top 5
const picks = topCandidates
  .sort((a,b) => b.score - a.score)
  .slice(0, 5);

// 차트 연습용: R:R 미달 or 점수 미달이지만 다이버전스 있는 후보 (실진입 X)
const practicePicks = picks.length === 0
  ? results
      .filter(p => Math.floor(perPickAmtFilter / p.buyPrice) >= 1)
      .sort((a,b) => b.score - a.score)
      .slice(0, 3)
  : [];

// ── 옵션 + 실적 발표일 추가 (최종 픽만) ──────────────────────────────
// 과거 날짜 backfill이면 옵션 API가 현재 데이터만 주므로 스킵
if (isToday && picks.length) {
  await Promise.allSettled(picks.map(async p => {
    // 옵션 데이터
    const opt = await fetchOptions(p.symbol);
    if (opt) {
      const lines = [];
      if (opt.pcRatio !== null) {
        if (opt.pcRatio < 0.5) {
          lines.push(`P/C ${opt.pcRatio} — 콜 집중 (상승 베팅↑)`);
          p.score += 2;  // 강한 콜 집중 시 점수 보너스
        } else if (opt.pcRatio < 0.7) {
          lines.push(`P/C ${opt.pcRatio} — 콜 우위 (상승 베팅)`);
          p.score += 1;  // 약한 콜 집중
        } else if (opt.pcRatio > 1.0) {
          lines.push(`P/C ${opt.pcRatio} — 풋 집중 (하락 베팅↑)`);
          p.score -= 1;  // 풋 집중 시 패널티
        } else {
          lines.push(`P/C ${opt.pcRatio}`);
        }
      }
      if (opt.callVolToOI !== null && opt.callVolToOI >= 1.0) {
        lines.push(`비정상 콜매수 (Vol/OI ${opt.callVolToOI}x) ⚡`);
        p.score += 2;
      }
      if (lines.length) p.patterns.push(...lines);
      p.options = opt;
    }

    // 실적 발표일 (Yahoo Finance meta — 에러 시 skip)
    const earnDate = await fetchEarningsDate(p.symbol);
    if (earnDate) {
      const daysToEarn = Math.round((new Date(earnDate) - new Date(CUTOFF)) / 86400000);
      if (daysToEarn >= 0 && daysToEarn <= 7) {
        p.earningsDate = earnDate;
        p.earningsDays = daysToEarn;
        // 실적 3일 이내: 위험 경고 + 점수 패널티
        if (daysToEarn <= 3) {
          p.score -= 3;
          p.patterns.push(`🚨 실적 발표 D-${daysToEarn} (${earnDate}) — 갭다운 위험`);
        } else {
          p.patterns.push(`⚠️ 실적 발표 D-${daysToEarn} (${earnDate}) — 진입 주의`);
        }
      }
    }

    // Finviz 수급 데이터
    const finviz = await fetchFinviz(p.symbol);
    if (finviz) {
      const lines = [];
      // 기관 거래 변화 (양수면 기관 매수)
      if (finviz.instTrans !== null) {
        if (finviz.instTrans > 5) {
          lines.push(`🏦 기관 매수 +${finviz.instTrans.toFixed(1)}%`);
          p.score += 2;  // 강한 기관 매수
        } else if (finviz.instTrans > 0) {
          lines.push(`기관 매수 +${finviz.instTrans.toFixed(1)}%`);
          p.score += 1;  // 약한 기관 매수
        } else if (finviz.instTrans < -5) {
          lines.push(`⚠️ 기관 매도 ${finviz.instTrans.toFixed(1)}%`);
          p.score -= 1;  // 기관 매도 패널티
        }
      }
      // 공매도 비율 (높으면 숏 스퀴즈 가능성)
      if (finviz.shortFloat !== null && finviz.shortFloat > 10) {
        lines.push(`🔥 공매도 ${finviz.shortFloat.toFixed(1)}% (숏스퀴즈 잠재력)`);
        p.score += 1;
      }
      if (lines.length) p.patterns.push(...lines);
      p.finviz = finviz;
    }
  }));
  // 옵션 스코어 + 실적 패널티 반영 후 재정렬
  picks.sort((a,b) => b.score - a.score);
}

// 잔액 읽기
const balance = balanceForFilter;

const perPickPct  = picks.length > 0 ? parseFloat((20 / picks.length).toFixed(1)) : 4;
const perPickAmt  = parseFloat((balance * perPickPct / 100).toFixed(2));

// ── 결과 저장 (review-entry.js에서 사용) ──────────────────────────────
const latestPicksPath = path.join(__dirname, '../output/latest-picks.json');
const pickData = {
  date: CUTOFF,
  timestamp: new Date().toISOString(),
  balance,
  marketState: bearMarket ? 'bear' : 'bull',
  picks: picks.map(p => ({
    symbol: p.symbol,
    score: p.score,
    buyPrice: p.buyPrice,
    target: p.target,
    stop: p.stop,
    targetPct: ((p.target - p.buyPrice) / p.buyPrice * 100).toFixed(1),
    stopPct: ((p.stop - p.buyPrice) / p.buyPrice * 100).toFixed(1),
    rrRatio: p.rrRatio,
    patterns: p.patterns,
    confidence: p.mlProb ? (p.mlProb * 100).toFixed(0) : null,
    sector: p.sector || null,
    atr: p.atr || null
  }))
};
fs.writeFileSync(latestPicksPath, JSON.stringify(pickData, null, 2));

console.log(`\n${line}`);
console.log(`📈 다이버전스 후보 종목 (${CUTOFF}) — TradingView 확인 후 진입`);
console.log(`   현재 잔액: $${balance.toLocaleString()} | 종목당 ${perPickPct}% ($${perPickAmt.toFixed(0)})`);
console.log(`   ※ 아래 종목은 스크리닝 후보입니다. RSI/MACD 다이버전스를 직접 확인하세요.`);
console.log(line);


function printPicks(pickList, _perPickPctVal, perPickAmtVal, finvizMap = {}, spySummary = null) {
  pickList.forEach((p, i) => {
    const name    = nameMap[p.symbol] ?? '';
    const shares  = Math.floor(perPickAmtVal / p.buyPrice);
    const actual  = parseFloat((shares * p.buyPrice).toFixed(2));
    const maxGain = parseFloat((shares * (p.target - p.buyPrice)).toFixed(2));
    const maxLoss = parseFloat((shares * (p.buyPrice - p.stop)).toFixed(2));
    const hasStrongSignal = p.patterns.some(pt =>
      pt.includes('세력 매집') || pt.includes('Higher Low') ||
      pt.includes('BB 하단') || pt.includes('깊은 눌림')
    );
    const weakWarning = hasStrongSignal ? '' : '  ⚠️ 신호 약함 — 거래량/구조 확인 필요';
    const bearTierLabels = ['', '  ⚠️ 하락장 주의', '  🔴 하락장 경고 (비중↓)', '  🚨 극심한 하락장 (소량만)'];
    const bearWarning = (bearMarket && !spyDivergence) ? bearTierLabels[spyBearTier] : (spyDivergence ? '  🟡 SPY 다이버전스 — 반등 가능' : '');
    const patternTag = p.patternType === 'pullback' ? '  📐 눌림목' : '';
    const confidenceIcon = p.confidence >= 80 ? '🟢' : p.confidence >= 65 ? '🟡' : '🔴';
    const confidenceTag = `  ${confidenceIcon} 확신도 ${p.confidence}%`;

    console.log(`\n${i+1}. ${p.symbol}${name ? ` (${name})` : ''}  score ${p.score}  R:R ${p.rrRatio}:1${confidenceTag}${patternTag}${weakWarning}${bearWarning}`);
    console.log(`   매수 $${p.buyPrice} × ${shares}주 = $${actual}  →  목표 $${p.target} (+${p.tPct}%, +$${maxGain})  손절 $${p.stop} (${p.sPct}%, -$${maxLoss})`);
    p.patterns.forEach(pt => console.log(`   · ${pt}`));

    // ── 다이버전스 상세 ─────────────────────────────────────────────────
    if (p.div) {
      const d = p.div;
      const rsiTag = d.rsiImprove >= 20 ? '🔥 강한' : d.rsiImprove >= 10 ? '✅' : '🟡 미약';
      const typeStr = d.rsiDiv && d.macdDiv ? 'RSI + MACD 이중' : d.rsiDiv ? 'RSI' : 'MACD';
      console.log(`\n   📋 ${typeStr} 다이버전스`);
      console.log(`      L1  ${d.L1.date}  $${d.L1.price.toFixed(2)}  RSI ${d.rsiL1.toFixed(1)}`);
      console.log(`      L2  ${d.L2.date}  $${d.L2.price.toFixed(2)}  RSI ${d.rsiL2.toFixed(1)}  (+${d.rsiImprove.toFixed(1)}pt ${rsiTag})`);
      console.log(`      L2로부터 ${d.daysAgoL2}일 경과  |  반등 +${d.recoveryPct.toFixed(1)}%`);
    }

    // ── 진입 시점 & 보유 기간 ────────────────────────────────────────────
    if (p.div && p.atr) {
      const d = p.div;
      const distToTgt = p.target - p.buyPrice;
      const dailyPace = p.atr * 0.55;
      const daysAtrEst = Math.ceil(distToTgt / dailyPace);
      const remainMin = Math.max(1, 10 - d.daysAgoL2);
      const remainMax = Math.max(remainMin + 3, 25 - d.daysAgoL2);
      const isMomOn = p.macdRising && p.rsi > 40;
      const entryNote = isMomOn
        ? '지금 진입 가능 (모멘텀 확인 완료)'
        : 'MACD 상승전환 또는 RSI 40+ 확인 후 진입';

      console.log(`\n   ⏱  진입 & 보유`);
      console.log(`      ${entryNote}`);
      console.log(`      예상 보유  ATR 기준 ~${daysAtrEst}거래일 (일일 $${dailyPace.toFixed(2)} 예상)`);
      console.log(`      다이버전스 통계  앞으로 ${remainMin}~${remainMax}거래일 이내`);
      if (!isMomOn) console.log(`      ⚠️  MACD 골든크로스 or RSI 45+ 선행 확인 권장`);
    } else if (p.noDivergence && p.atr) {
      // 다이버전스 없을 때 진입 가이드
      const distToTgt = p.target - p.buyPrice;
      const dailyPace = p.atr * 0.55;
      const daysAtrEst = Math.ceil(distToTgt / dailyPace);
      const isMomOn = p.macdRising && p.rsi > 40;
      const entryNote = isMomOn
        ? '⚠️ 소량 진입 가능 (강한 시그널 확인됨)'
        : '⚠️ 거래량 + RSI 40+ 확인 후 소량 진입';

      console.log(`\n   ⏱  진입 & 보유`);
      console.log(`      ${entryNote}`);
      console.log(`      예상 보유  ATR 기준 ~${daysAtrEst}거래일 (일일 $${dailyPace.toFixed(2)} 예상)`);
      console.log(`      ⚠️  다이버전스 미확인 — 비중 축소 권장 (절반 이하)`);
    }

    // ── 과거 다이버전스 이력 ─────────────────────────────────────────────
    if (p.histDiv) {
      const h = p.histDiv;
      const rateIcon = h.successRate >= 70 ? '✅' : h.successRate >= 50 ? '🟡' : '🔴';
      console.log(`\n   📊 과거 다이버전스 이력 (최근 ${h.count}회)`);
      console.log(`      ${rateIcon} 성공 ${h.successCount}/${h.count} (${h.successRate}%)  평균 수익 ${h.avgGainPct > 0 ? '+' : ''}${h.avgGainPct}%  성공시 평균 +${h.avgSuccessGain}%`);
      if (h.recent?.length) {
        h.recent.forEach(r => {
          const icon = r.success ? '✅' : '❌';
          const rsiSign = (r.rsiImprove ?? 0) >= 0 ? '+' : '';
          console.log(`      ${icon}  ${r.date}  ${r.gainPct > 0 ? '+' : ''}${r.gainPct}%  (RSI개선 ${rsiSign}${r.rsiImprove?.toFixed(0) ?? '-'}pt)`);
        });
      }
    } else {
      console.log(`\n   📊 과거 다이버전스 이력  —  2년 데이터 내 조건 충족 사례 없음`);
    }

    // ── 상승 트리거 현황 ─────────────────────────────────────────────────
    {
      const fv = finvizMap[p.symbol];
      const checks = [
        { label: 'MACD 히스토그램 양전환', ok: p.macdHist != null && p.macdHist >= 0 },
        { label: 'RSI 45+',               ok: p.rsi >= 45 },
        { label: '거래량 상승 우세',       ok: p.upVolAvg > p.dnVolAvg * 1.1 },
        { label: 'BB 중간선 돌파',         ok: p.bb ? p.buyPrice >= p.bb.middle : null },
        { label: '기관 순매수',            ok: fv?.instTrans != null ? fv.instTrans > 0 : null },
        { label: spySummary?.bear ? 'SPY 하락장' : 'SPY 상승장', ok: spySummary ? !spySummary.bear : null },
      ];
      const done  = checks.filter(c => c.ok === true);
      const total = checks.filter(c => c.ok !== null).length;
      const doneCnt = done.filter(c => !c.warn).length + done.filter(c => c.warn).length;

      const strengthIcon = doneCnt >= 5 ? '🟢' : doneCnt >= 3 ? '🟡' : '🔴';
      console.log(`\n   🚀 상승 트리거  ${strengthIcon} ${done.length}/${total} 충족`);
      checks.forEach(c => {
        if (c.ok === null) return; // 데이터 없으면 스킵
        const icon = c.ok ? (c.warn ? '⚠️' : '  ✅') : '  ⬜';
        console.log(`   ${icon}  ${c.label}`);
      });
      // 수급 점수
      if (fv) {
        let sc = 0, mx = 0;
        if (fv.instTrans != null)   { mx += 2; sc += fv.instTrans > 1 ? 2 : fv.instTrans > 0 ? 1 : 0; }
        if (fv.insiderTrans != null){ mx += 1; sc += fv.insiderTrans > 0 ? 1 : 0; }
        if (fv.shortFloat != null)  { mx += 1; sc += fv.shortFloat > 10 ? 1 : 0; }
        if (fv.instOwn != null)     { mx += 1; sc += fv.instOwn > 50 ? 1 : 0; }
        const sIcon = sc >= 4 ? '🟢' : sc >= 2 ? '🟡' : '🔴';
        const parts = [];
        if (fv.instTrans != null)    parts.push(`기관 ${fv.instTrans > 0 ? '+' : ''}${fv.instTrans.toFixed(2)}%`);
        if (fv.insiderTrans != null) parts.push(`내부자 ${fv.insiderTrans > 0 ? '+' : ''}${fv.insiderTrans.toFixed(2)}%`);
        if (fv.shortFloat != null)   parts.push(`공매도 ${fv.shortFloat.toFixed(1)}%${fv.shortFloat > 10 ? ' 🔥' : ''}`);
        console.log(`\n   📊 수급 점수  ${sIcon} ${sc}/${mx}  │  ${parts.join('  ')}`);
      }
      if (spySummary?.bear)
        console.log(`         SPY 하락장 — 트리거 충족해도 SPY 반등 없이 상승 제한될 수 있음`);
    }
  });
}

if (picks.length === 0) {
  console.log('\n⚠️  오늘 실진입 기준 충족 종목 없음 (R:R 또는 점수 미달)\n');

  // 차트 연습용 후보 출력 (실진입 X — 패턴 공부용)
  if (practicePicks.length > 0) {
    const pracLine = '─'.repeat(60);
    console.log(pracLine);
    console.log('📚 차트 연습용 후보 — 실진입 비추 (R:R 부족 or 점수 미달)');
    console.log('   다이버전스 패턴 확인 연습용으로만 활용하세요');
    console.log(pracLine);
    practicePicks.forEach((p, i) => {
      const name = nameMap[p.symbol] ?? '';
      const rrNote = !p.rrOk ? `R:R ${p.rrRatio}:1 ⚠️ 부족` : `R:R ${p.rrRatio}:1`;
      const scoreNote = p.score < bearMarketScoreMin ? `score ${p.score} (기준 ${bearMarketScoreMin} 미달)` : `score ${p.score}`;
      console.log(`\n${i+1}. ${p.symbol}${name ? ` (${name})` : ''}  ${scoreNote}  ${rrNote}`);
      console.log(`   매수 $${p.buyPrice}  →  목표 $${p.target} (+${p.tPct}%)  손절 $${p.stop} (${p.sPct}%)`);
      p.patterns.slice(0, 4).forEach(pt => console.log(`   · ${pt}`));
      if (p.div) {
        const d = p.div;
        const typeStr = d.rsiDiv && d.macdDiv ? 'RSI+MACD 이중' : d.rsiDiv ? 'RSI' : 'MACD';
        console.log(`   📋 ${typeStr} 다이버전스  L2 ${d.L2.date} $${d.L2.price.toFixed(2)} RSI ${d.rsiL2.toFixed(1)}`);
      }
    });
    console.log(`\n${pracLine}\n`);
  }
} else {
  // picks 종목 Finviz 수급 병렬 fetch
  const finvizMap = {};
  await Promise.all(picks.map(async p => {
    finvizMap[p.symbol] = await fetchFinviz(p.symbol);
  }));
  // SPY 상태 요약
  const spySummary = spyRows ? {
    bear: bearMarket,
    rsi: calcRSI(spyRows.map(r => r.close)),
    macdRising: calcMACD(spyRows.map(r => r.close))?.rising,
  } : null;
  printPicks(picks, perPickPct, perPickAmt, finvizMap, spySummary);
}

console.log(`\n${line}\n`);

// picks-pending.json 저장 (같은 날짜 기존 picks는 항상 덮어쓰기 — 픽 0개여도 기존 삭제)
const picksToSave = [...picks];
const PENDING_PATH = path.join(__dirname, '../output/picks-pending.json');
const existing = fs.existsSync(PENDING_PATH) ? JSON.parse(fs.readFileSync(PENDING_PATH,'utf-8')) : [];
const kept = existing.filter(p => p.analysisDate !== CUTOFF);
for (const p of picksToSave) {
  kept.push({
    id: `pick_${CUTOFF}_${p.symbol}`,
    analysisDate: CUTOFF, symbol: p.symbol, score: p.score,
    buyPrice: p.buyPrice, targetPrice: p.target, stopLoss: p.stop,
    rrRatio: p.rrRatio, patterns: p.patterns, status: 'pending',
    spyWarning: picks.length === 0,  // SPY 조건 미충족 여부 기록
  });
}
fs.writeFileSync(PENDING_PATH, JSON.stringify(kept, null, 2));
