import { useState, useEffect, useCallback } from 'react';
import { getJobStatus, triggerPostmarket } from './firebase';
import PnLChart from './components/PnLChart';
import ManualTrades from './components/ManualTrades';
import { RefreshCw, TrendingUp, BarChart2, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';

const INITIAL_BALANCE = 10000;
const LS_KEY = 'manual_trades_v1';

function loadTrades() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) ?? []; } catch { return []; }
}
function saveTrades(t) {
  localStorage.setItem(LS_KEY, JSON.stringify(t));
}

function JobButton({ label, icon, status, onClick }) {
  const base = 'flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium transition-all disabled:opacity-50';
  if (status === 'running') return (
    <button disabled className={`${base} bg-slate-700 text-slate-300`}>
      <Loader2 size={13} className="animate-spin" /> Analyzing...
    </button>
  );
  if (status === 'done') return (
    <button onClick={onClick} className={`${base} bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30`}>
      <CheckCircle2 size={13} />{label}
    </button>
  );
  if (status === 'error') return (
    <button onClick={onClick} className={`${base} bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30`}>
      <AlertCircle size={13} />재시도
    </button>
  );
  return (
    <button onClick={onClick} className={`${base} bg-violet-500/20 text-violet-300 border border-violet-500/30 hover:bg-violet-500/30`}>
      {icon}{label}
    </button>
  );
}

export default function App() {
  const [manualTrades, setManualTrades] = useState(loadTrades);
  const [livePrices, setLivePrices] = useState({});
  const [lastUpdated, setLastUpdated] = useState(null);
  const [jobStatus, setJobStatus] = useState({ postmarket: 'idle' });

  // 앱 로드 시 서버에서 최신 데이터 가져오기 (review-entry.js --confirm 반영)
  useEffect(() => {
    async function loadFromServer() {
      try {
        const res = await fetch('http://localhost:3001/api/trades');
        const serverTrades = await res.json();

        if (serverTrades && serverTrades.length > 0) {
          // 서버 데이터가 있으면 source of truth로 사용
          setManualTrades(serverTrades);
          saveTrades(serverTrades);
        } else {
          // 서버에 데이터 없으면 localStorage → 서버 동기화
          const localTrades = loadTrades();
          if (localTrades.length) {
            syncToServer(localTrades);
          }
        }
      } catch (err) {
        // 서버 연결 실패시 localStorage 사용
        console.warn('서버 연결 실패, localStorage 사용:', err);
      }
    }
    loadFromServer();
  }, []);

  // 수동 거래 CRUD
  function syncToServer(trades) {
    fetch('http://localhost:3001/api/trades', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(trades),
    }).catch(() => {});
  }
  function addTrade(trade) {
    const next = [...manualTrades, trade];
    setManualTrades(next); saveTrades(next); syncToServer(next);
  }
  function closeTrade(id, closeData) {
    const next = manualTrades.map(t => t.id === id ? { ...t, ...closeData, status: 'closed' } : t);
    setManualTrades(next); saveTrades(next); syncToServer(next);
  }
  function editTrade(id, updates) {
    const next = manualTrades.map(t => t.id === id ? { ...t, ...updates } : t);
    setManualTrades(next); saveTrades(next); syncToServer(next);
  }
  function deleteTrade(id) {
    const next = manualTrades.filter(t => t.id !== id);
    setManualTrades(next); saveTrades(next); syncToServer(next);
  }

  // 보유 종목 현재가 1분마다 갱신
  const fetchLivePrices = useCallback(async () => {
    const openSymbols = manualTrades.filter(t => t.result === 'open').map(t => t.symbol);
    if (!openSymbols.length) return;
    try {
      const res = await fetch(`http://localhost:3001/api/quotes?symbols=${openSymbols.join(',')}`);
      const data = await res.json();
      setLivePrices(data);
      setLastUpdated(new Date());
    } catch {}
  }, [manualTrades]);

  useEffect(() => {
    fetchLivePrices();
    const interval = setInterval(fetchLivePrices, 60000);
    return () => clearInterval(interval);
  }, [fetchLivePrices]);

  // postmarket 실행 중 폴링
  useEffect(() => {
    if (jobStatus.postmarket !== 'running') return;
    const interval = setInterval(async () => {
      const s = await getJobStatus();
      setJobStatus(s);
    }, 2000);
    return () => clearInterval(interval);
  }, [jobStatus.postmarket]);

  async function runPostmarket() {
    await triggerPostmarket();
    setJobStatus(prev => ({ ...prev, postmarket: 'running' }));
  }

  // 잔액 계산: 초기금 + 청산 손익 - 오픈 포지션 투자금 (사용 가능 현금)
  const closedPnl = manualTrades
    .filter(t => t.result !== 'open')
    .reduce((sum, t) => sum + (t.pnl ?? 0), 0);
  const openInvested = manualTrades
    .filter(t => t.result === 'open')
    .reduce((sum, t) => sum + (t.invested ?? 0), 0);
  const manualBalance = INITIAL_BALANCE + closedPnl - openInvested;

  // 미실현 손익 (보유 포지션 × 현재가)
  const unrealizedPnl = manualTrades
    .filter(t => t.result === 'open' && livePrices[t.symbol])
    .reduce((sum, t) => {
      const livePrice = livePrices[t.symbol];
      return sum + (livePrice - t.buyPrice) * t.shares;
    }, 0);

  const now = new Date();
  const etHour = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' })).getHours();
  const marketOpen = etHour >= 9 && etHour < 16;

  return (
    <div className="min-h-screen bg-[#0f1117] p-4 md:p-6">
      {/* Header */}
      <header className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-gradient-to-br from-cyan-400 to-violet-500 rounded-lg flex items-center justify-center">
            <TrendingUp size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-lg font-semibold gradient-text">Stock Assistant</h1>
            <p className="text-xs text-slate-500">Paper Trading</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${marketOpen ? 'bg-green-400 live-dot' : 'bg-red-400'}`} />
            <span className={`text-xs font-medium ${marketOpen ? 'text-green-400' : 'text-red-400'}`}>
              {marketOpen ? 'OPEN' : 'CLOSED'}
            </span>
          </div>
          <JobButton
            label="Post-Market"
            icon={<BarChart2 size={13} />}
            status={jobStatus.postmarket}
            onClick={runPostmarket}
          />
          {lastUpdated && (
            <div className="flex items-center gap-1 text-xs text-slate-500">
              <RefreshCw size={11} className="animate-spin opacity-60" style={{ animationDuration: '3s' }} />
              {lastUpdated.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
            </div>
          )}
        </div>
      </header>

      <div className="space-y-4">
        {/* P&L Chart */}
        <PnLChart
          trades={manualTrades}
          initialBalance={INITIAL_BALANCE}
          unrealizedPnl={unrealizedPnl}
        />

        {/* Trade History */}
        <ManualTrades
          trades={manualTrades}
          balance={manualBalance}
          initialBalance={INITIAL_BALANCE}
          livePrices={livePrices}
          onAdd={addTrade}
          onClose={closeTrade}
          onEdit={editTrade}
          onDelete={deleteTrade}
        />
      </div>
    </div>
  );
}
