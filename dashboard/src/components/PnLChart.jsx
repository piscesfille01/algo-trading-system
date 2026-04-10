import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { TrendingUp } from 'lucide-react';

export default function PnLChart({ trades, initialBalance = 10000, unrealizedPnl = 0 }) {
  const closedTrades = (trades || []).filter(t => t.result !== 'open');
  const openTrades = (trades || []).filter(t => t.result === 'open');
  const chartData = buildBalanceHistory(trades || [], initialBalance, unrealizedPnl);

  const closedPnl = closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
  const openInvested = openTrades.reduce((sum, t) => sum + (t.invested || 0), 0);
  const realizedBalance = initialBalance + closedPnl - openInvested;
  const totalBalance = initialBalance + closedPnl + unrealizedPnl;
  const totalPnl = totalBalance - initialBalance;
  const isPositive = totalPnl >= 0;

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    const val = payload[0].value;
    const diff = val - initialBalance;
    return (
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-xs">
        <p className="text-slate-400 mb-1">{label}</p>
        <p className="text-slate-100 font-mono font-semibold">${val.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
        <p className={`font-mono ${diff >= 0 ? 'text-green-400' : 'text-red-400'}`}>
          {diff >= 0 ? '+' : ''}${diff.toFixed(2)} ({((diff / initialBalance) * 100).toFixed(2)}%)
        </p>
      </div>
    );
  };

  return (
    <div className="glass-card rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
          <TrendingUp size={15} className="text-violet-400" />
          잔액 추이
        </h2>
        <div className="flex items-center gap-3 text-xs font-mono">
          {unrealizedPnl !== 0 && (
            <span className={`${unrealizedPnl >= 0 ? 'text-amber-400' : 'text-red-400'} opacity-80`}>
              미실현 {unrealizedPnl >= 0 ? '+' : ''}${unrealizedPnl.toFixed(2)}
            </span>
          )}
          <span className={isPositive ? 'text-green-400' : 'text-red-400'}>
            {isPositive ? '+' : ''}${totalPnl.toFixed(2)} ({((totalPnl / initialBalance) * 100).toFixed(2)}%)
          </span>
        </div>
      </div>

      {/* 요약 스탯 */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <Stat label="현재 잔액" value={`$${realizedBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}`} color="text-cyan-400" />
        <Stat
          label="미실현 손익"
          value={`${unrealizedPnl >= 0 ? '+' : ''}$${unrealizedPnl.toFixed(2)}`}
          color={unrealizedPnl >= 0 ? 'text-amber-400' : 'text-red-400'}
          sub="보유 포지션 기준"
        />
        <Stat
          label="총 평가"
          value={`$${totalBalance.toFixed(2)}`}
          color={isPositive ? 'text-green-400' : 'text-red-400'}
          sub={`${isPositive ? '+' : ''}${((totalPnl / initialBalance) * 100).toFixed(2)}%`}
        />
      </div>

      {chartData.length < 2 ? (
        <div className="h-40 flex items-center justify-center text-slate-500 text-xs">
          거래 데이터가 없습니다
        </div>
      ) : (() => {
        const yVals = chartData.map(d => d.balance);
        const yMin = Math.min(...yVals);
        const yMax = Math.max(...yVals);
        const yRange = yMax - yMin || 100;
        const pad = Math.max(yRange * 0.3, 50);
        const yDomain = [parseFloat((yMin - pad).toFixed(2)), parseFloat((yMax + pad).toFixed(2))];
        const yFmt = v => yRange < 500 ? `$${v.toFixed(0)}` : `$${(v / 1000).toFixed(1)}k`;
        return (
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={chartData} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="balanceGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={isPositive ? '#34d399' : '#f87171'} stopOpacity={0.3} />
                <stop offset="95%" stopColor={isPositive ? '#34d399' : '#f87171'} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e2030" />
            <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 10 }} tickLine={false} axisLine={false} />
            <YAxis
              tick={{ fill: '#64748b', fontSize: 10 }}
              tickLine={false} axisLine={false}
              tickFormatter={yFmt}
              width={55}
              domain={yDomain}
            />
            <Tooltip content={<CustomTooltip />} />
            <ReferenceLine y={initialBalance} stroke="#475569" strokeDasharray="4 4" />
            <Area type="monotone" dataKey="balance"
              stroke={isPositive ? '#34d399' : '#f87171'}
              strokeWidth={2} fill="url(#balanceGrad)"
            />
          </AreaChart>
        </ResponsiveContainer>
        );
      })()}

      {/* 최근 거래 P&L 바 */}
      {closedTrades.length > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-700/50">
          <p className="text-xs text-slate-500 mb-2">최근 거래 P&L</p>
          <div className="flex items-end gap-1 h-10">
            {closedTrades.slice(-12).map((t, i) => {
              const pct = t.pnlPct ?? 0;
              const h = Math.min(Math.abs(pct) * 8, 40);
              return (
                <div key={i} className="flex-1 flex flex-col items-center justify-end"
                  title={`${t.symbol}: ${pct > 0 ? '+' : ''}${pct?.toFixed(2)}%`}>
                  <div
                    className={`w-full rounded-sm ${pct >= 0 ? 'bg-green-400' : 'bg-red-400'}`}
                    style={{ height: `${h}px`, minHeight: '2px', opacity: 0.8 }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub, color }) {
  return (
    <div className="bg-slate-800/50 rounded-lg p-2.5">
      <p className="text-xs text-slate-500 mb-0.5">{label}</p>
      <p className={`text-sm font-mono font-semibold ${color}`}>{value}</p>
      {sub && <p className="text-xs text-slate-600 font-mono">{sub}</p>}
    </div>
  );
}

function buildBalanceHistory(allTrades, initialBalance, unrealizedPnl = 0) {
  if (!allTrades || allTrades.length === 0) {
    return [{ date: '시작', balance: initialBalance }];
  }

  // 날짜별 balance 변화 계산
  const byDate = {};

  for (const t of allTrades) {
    // 청산 날짜: realized P&L 추가
    if (t.sellDate && t.result !== 'open') {
      const normalizedDate = t.sellDate.split('T')[0];
      byDate[normalizedDate] = (byDate[normalizedDate] || 0) + (t.pnl || 0);
    }
  }

  // 첫 open position 진입 날짜 찾기 (미실현 손익 보간용)
  const openTrades = allTrades.filter(t => t.result === 'open' && t.buyDate);
  const firstOpenDate = openTrades.length > 0
    ? openTrades.map(t => t.buyDate.split('T')[0]).sort()[0]
    : null;

  // 고정 시작 날짜 (초기 balance 시작점)
  const FIXED_START_DATE = '2026-03-29';

  // 거래가 있는지 확인
  const allDates = [
    ...Object.keys(byDate),
    ...allTrades.filter(t => t.buyDate).map(t => t.buyDate.split('T')[0])
  ];

  if (allDates.length === 0) {
    return [{ date: '시작', balance: initialBalance }];
  }

  // 고정 시작 날짜부터 오늘까지 (timezone 안전하게)
  const [year, month, day] = FIXED_START_DATE.split('-').map(Number);
  const startDate = new Date(year, month - 1, day);
  const today = new Date();

  const result = [];
  let running = initialBalance;

  // 미실현 손익 보간 계산 (첫 진입일 ~ 오늘)
  let totalDays = 0;
  if (firstOpenDate && unrealizedPnl !== 0) {
    const [y, m, d] = firstOpenDate.split('-').map(Number);
    const openDate = new Date(y, m - 1, d);
    const diffTime = today - openDate;
    totalDays = Math.max(1, Math.floor(diffTime / (1000 * 60 * 60 * 24)));
  }

  // 고정 시작 날짜부터 순회
  let currentDate = new Date(startDate);

  // 날짜별로 순회
  while (currentDate <= today) {
    // timezone 안전하게 날짜 문자열 생성
    const dateStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`;
    const dayOfWeek = currentDate.getDay();

    // 주말 제외
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      // 해당 날짜에 realized P&L이 있으면 반영
      if (byDate[dateStr]) {
        running += byDate[dateStr];
      }

      // 미실현 손익 선형 보간 (첫 진입일 이후)
      let interpolatedUnrealized = 0;
      if (firstOpenDate && unrealizedPnl !== 0 && dateStr >= firstOpenDate) {
        const [y, m, d] = firstOpenDate.split('-').map(Number);
        const openDate = new Date(y, m - 1, d);
        const elapsed = Math.max(0, Math.floor((currentDate - openDate) / (1000 * 60 * 60 * 24)));
        const ratio = totalDays > 0 ? elapsed / totalDays : 1;
        interpolatedUnrealized = unrealizedPnl * ratio;
      }

      // 날짜 포맷 (MM-DD)
      const dateLabel = `${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`;

      // 오늘이면 "현재"
      const todayYear = today.getFullYear();
      const todayMonth = String(today.getMonth() + 1).padStart(2, '0');
      const todayDay = String(today.getDate()).padStart(2, '0');
      const todayStr = `${todayYear}-${todayMonth}-${todayDay}`;
      const isToday = dateStr === todayStr;

      result.push({
        date: isToday ? '현재' : dateLabel,
        balance: parseFloat((running + interpolatedUnrealized).toFixed(2))
      });
    }

    // 다음 날로 이동
    currentDate.setDate(currentDate.getDate() + 1);
  }

  return result;
}
