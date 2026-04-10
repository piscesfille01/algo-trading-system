import { CheckCircle, XCircle, Clock, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';

export default function HistoryTable({ trades }) {
  const [showAll, setShowAll] = useState(false);

  const sorted = [...(trades || [])].sort((a, b) => {
    const da = a.date || a.createdAt;
    const db_ = b.date || b.createdAt;
    return da > db_ ? -1 : 1;
  });
  const displayTrades = showAll ? sorted : sorted.slice(0, 10);

  return (
    <div className="glass-card rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-slate-200">거래 이력</h2>
        <span className="text-xs text-slate-500">{sorted.length}건</span>
      </div>

      {sorted.length === 0 ? (
        <p className="text-center text-sm text-slate-500 py-8">거래 이력이 없습니다</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-500 border-b border-slate-700/50">
                  <th className="text-left pb-2 font-medium">날짜</th>
                  <th className="text-left pb-2 font-medium">종목</th>
                  <th className="text-right pb-2 font-medium">매수가</th>
                  <th className="text-right pb-2 font-medium">청산가</th>
                  <th className="text-right pb-2 font-medium">P&L</th>
                  <th className="text-right pb-2 font-medium">수익률</th>
                  <th className="text-center pb-2 font-medium">결과</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/30">
                {displayTrades.map(t => {
                  const pnl = t.pnl ?? 0;
                  const pct = t.pnlPct ?? 0;
                  const isWin = pnl >= 0;
                  const date = t.date || (t.createdAt?.toDate
                    ? t.createdAt.toDate().toISOString().split('T')[0]
                    : t.createdAt?.split?.('T')?.[0] ?? '-');

                  return (
                    <tr key={t.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-2 text-slate-500 font-mono">{date}</td>
                      <td className="py-2">
                        <span className="font-mono font-semibold text-slate-200">{t.symbol}</span>
                      </td>
                      <td className="py-2 text-right font-mono text-slate-300">${t.buyPrice?.toFixed(2)}</td>
                      <td className="py-2 text-right font-mono text-slate-300">
                        {t.exitPrice ? `$${t.exitPrice.toFixed(2)}` : <span className="text-slate-600">진행중</span>}
                      </td>
                      <td className={`py-2 text-right font-mono font-semibold ${isWin ? 'text-green-400' : 'text-red-400'}`}>
                        {isWin ? '+' : '-'}${Math.abs(pnl).toFixed(2)}
                      </td>
                      <td className={`py-2 text-right font-mono ${isWin ? 'text-green-400' : 'text-red-400'}`}>
                        {pct > 0 ? '+' : ''}{pct.toFixed(2)}%
                      </td>
                      <td className="py-2 text-center">
                        {t.status === 'closed' ? (
                          isWin
                            ? <CheckCircle size={14} className="inline text-green-400" />
                            : <XCircle size={14} className="inline text-red-400" />
                        ) : (
                          <Clock size={14} className="inline text-amber-400" />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {sorted.length > 10 && (
            <button
              onClick={() => setShowAll(!showAll)}
              className="mt-3 w-full flex items-center justify-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors py-1"
            >
              {showAll ? <><ChevronUp size={12} /> 접기</> : <><ChevronDown size={12} /> 전체 보기 ({sorted.length}건)</>}
            </button>
          )}
        </>
      )}
    </div>
  );
}
