import { TrendingUp, TrendingDown, DollarSign, Target, BarChart2, Zap } from 'lucide-react';

export default function PortfolioSummary({ portfolio, performance }) {
  const balance = portfolio?.balance ?? 10000;
  const initial = portfolio?.initialBalance ?? 10000;
  const totalReturn = ((balance - initial) / initial * 100).toFixed(2);
  const totalPnl = (balance - initial).toFixed(2);
  const isPositive = balance >= initial;

  const stats = [
    {
      label: '현재 잔액',
      value: `$${balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      sub: `시작 $${initial.toLocaleString()}`,
      icon: <DollarSign size={16} />,
      color: 'text-cyan-400',
      bg: 'bg-cyan-400/10',
    },
    {
      label: '누적 수익',
      value: `${isPositive ? '+' : ''}$${Math.abs(totalPnl).toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
      sub: `${isPositive ? '+' : ''}${totalReturn}%`,
      icon: isPositive ? <TrendingUp size={16} /> : <TrendingDown size={16} />,
      color: isPositive ? 'text-green-400' : 'text-red-400',
      bg: isPositive ? 'bg-green-400/10' : 'bg-red-400/10',
    },
    {
      label: '적중률',
      value: `${performance?.hitRate ?? 0}%`,
      sub: `${performance?.winTrades ?? 0}승 ${performance?.loseTrades ?? 0}패`,
      icon: <Target size={16} />,
      color: 'text-violet-400',
      bg: 'bg-violet-400/10',
    },
    {
      label: '총 거래 수',
      value: `${performance?.totalTrades ?? 0}건`,
      sub: '완료된 거래',
      icon: <BarChart2 size={16} />,
      color: 'text-amber-400',
      bg: 'bg-amber-400/10',
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {stats.map((s, i) => (
        <div key={i} className="glass-card rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-slate-500">{s.label}</span>
            <div className={`${s.bg} ${s.color} p-1.5 rounded-lg`}>{s.icon}</div>
          </div>
          <div className={`text-xl font-semibold ${s.color} font-mono`}>{s.value}</div>
          <div className="text-xs text-slate-500 mt-0.5">{s.sub}</div>
        </div>
      ))}
    </div>
  );
}
