import { TrendingUp, AlertTriangle, ChevronRight, Star, DollarSign } from 'lucide-react';

const SENTIMENT_COLOR = {
  '강세': 'text-green-400 bg-green-400/10',
  '약세': 'text-red-400 bg-red-400/10',
  '중립': 'text-amber-400 bg-amber-400/10',
};

export default function TodaysPicks({ recommendation, onRunAnalysis, balance = 10000 }) {
  const today = new Date().toISOString().split('T')[0];
  const isToday = recommendation?.date === today;

  if (!recommendation || !recommendation.picks?.length) {
    return (
      <div className="glass-card rounded-xl p-5 h-full flex items-center justify-center">
        <div className="text-center text-slate-500">
          <TrendingUp size={32} className="mx-auto mb-2 opacity-30" />
          <p className="text-sm">오늘 추천 데이터가 없습니다</p>
          <p className="text-xs text-slate-600 mt-1 mb-3">위의 "장 전 분석" 버튼을 눌러 분석을 시작하세요</p>
          {onRunAnalysis && (
            <button
              onClick={onRunAnalysis}
              className="text-xs bg-violet-500/20 text-violet-300 border border-violet-500/30 hover:bg-violet-500/30 px-4 py-2 rounded-lg transition-all"
            >
              지금 분석 실행
            </button>
          )}
        </div>
      </div>
    );
  }

  const sentimentClass = SENTIMENT_COLOR[recommendation.marketSentiment] || 'text-slate-400 bg-slate-400/10';

  // 포지션별 투자금액 계산
  const picks = recommendation.picks.map(pick => {
    const alloc = pick.allocationPct ?? 10;
    const investAmount = parseFloat((balance * alloc / 100).toFixed(2));
    const shares = Math.floor(investAmount / pick.buyPrice);
    const actualInvest = parseFloat((shares * pick.buyPrice).toFixed(2));
    const maxLoss = parseFloat((shares * (pick.buyPrice - pick.stopLoss)).toFixed(2));
    const maxGain = parseFloat((shares * (pick.targetPrice - pick.buyPrice)).toFixed(2));
    return { ...pick, investAmount, shares, actualInvest, maxLoss, maxGain, alloc };
  });

  const totalInvested = picks.reduce((s, p) => s + p.actualInvest, 0);
  const totalMaxLoss  = picks.reduce((s, p) => s + p.maxLoss, 0);
  const cash = parseFloat((balance - totalInvested).toFixed(2));

  return (
    <div className="glass-card rounded-xl p-5">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
            <TrendingUp size={15} className="text-cyan-400" />
            오늘의 추천 종목
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {recommendation.date} {!isToday && <span className="text-yellow-500">(오래된 데이터)</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {recommendation.vix && (
            <span className={`text-xs px-2 py-0.5 rounded font-mono ${recommendation.vix > 25 ? 'bg-red-500/20 text-red-400' : 'bg-slate-700 text-slate-400'}`}>
              VIX {recommendation.vix.toFixed(1)}
            </span>
          )}
          <span className={`text-xs px-2 py-0.5 rounded font-medium ${sentimentClass}`}>
            {recommendation.marketSentiment}
          </span>
        </div>
      </div>

      {/* 잔액 요약 */}
      <div className="grid grid-cols-3 gap-2 mb-3 bg-slate-800/60 rounded-lg p-3">
        <div className="text-center">
          <p className="text-xs text-slate-500 mb-0.5">현재 잔액</p>
          <p className="text-sm font-mono font-semibold text-slate-200">${balance.toLocaleString('en-US', { minimumFractionDigits: 0 })}</p>
        </div>
        <div className="text-center border-x border-slate-700/50">
          <p className="text-xs text-slate-500 mb-0.5">투자 예정</p>
          <p className="text-sm font-mono font-semibold text-cyan-400">${totalInvested.toLocaleString('en-US', { minimumFractionDigits: 0 })}</p>
          <p className="text-xs text-slate-600 font-mono">{(totalInvested/balance*100).toFixed(0)}%</p>
        </div>
        <div className="text-center">
          <p className="text-xs text-slate-500 mb-0.5">현금 유보</p>
          <p className="text-sm font-mono font-semibold text-slate-300">${cash.toLocaleString('en-US', { minimumFractionDigits: 0 })}</p>
          <p className="text-xs text-red-400/70 font-mono">최대손실 -${totalMaxLoss.toFixed(0)}</p>
        </div>
      </div>

      {/* 시장 코멘트 */}
      {recommendation.marketComment && (
        <p className="text-xs text-slate-400 mb-3 pb-3 border-b border-slate-700/50">
          {recommendation.marketComment}
        </p>
      )}

      {/* 추천 종목 카드 */}
      <div className="space-y-3">
        {picks.map((pick, i) => (
          <PickCard key={pick.symbol} pick={pick} rank={i + 1} />
        ))}
      </div>

      {/* 패스 종목 */}
      {recommendation.watchlist?.length > 0 && (
        <div className="mt-4 pt-3 border-t border-slate-700/50">
          <p className="text-xs text-slate-500 mb-2">오늘 패스</p>
          <div className="flex flex-wrap gap-2">
            {recommendation.watchlist.map(w => (
              <div key={w.symbol} className="group relative">
                <span className="text-xs bg-slate-800 text-slate-400 px-2 py-1 rounded cursor-help">
                  {w.symbol}
                </span>
                <div className="absolute bottom-6 left-0 w-48 bg-slate-900 border border-slate-700 rounded p-2 text-xs text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none">
                  {w.reason}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PickCard({ pick, rank }) {
  const targetPct = parseFloat(pick.targetPct);
  const stopPct   = parseFloat(pick.stopLossPct);
  const stars     = Math.round(pick.score / 2);

  return (
    <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-3 hover:border-slate-600 transition-colors">
      {/* 종목명 + 스코어 */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 font-mono">{rank}.</span>
          <span className="text-base font-bold text-slate-100 font-mono">{pick.symbol}</span>
          {pick.sector && <span className="text-xs text-slate-500 bg-slate-700/50 px-1.5 py-0.5 rounded">{pick.sector}</span>}
          {pick.isHighRisk && <AlertTriangle size={12} className="text-amber-400" />}
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-0.5">
            {[...Array(5)].map((_, i) => (
              <Star key={i} size={10} className={i < stars ? 'text-amber-400 fill-amber-400' : 'text-slate-600'} />
            ))}
          </div>
          <span className="text-xs text-slate-500 font-mono">{pick.score}/10</span>
        </div>
      </div>

      {/* 가격 3개 */}
      <div className="grid grid-cols-3 gap-2 mb-2">
        <PriceBox label="매수가" value={`$${pick.buyPrice}`} color="text-slate-200" />
        <PriceBox label="목표가" value={`$${pick.targetPrice}`} sub={`+${targetPct}%`} color="text-green-400" />
        <PriceBox label="손절가" value={`$${pick.stopLoss}`} sub={`${stopPct}%`} color="text-red-400" />
      </div>

      {/* 투자금액 + 주수 */}
      <div className="grid grid-cols-3 gap-2 mb-2 bg-slate-900/60 rounded-md p-2">
        <div className="text-center">
          <p className="text-xs text-slate-600 mb-0.5">투자금액</p>
          <p className="text-xs font-mono font-semibold text-cyan-300">${pick.actualInvest.toLocaleString()}</p>
          <p className="text-xs text-slate-600">{pick.alloc}%</p>
        </div>
        <div className="text-center border-x border-slate-700/40">
          <p className="text-xs text-slate-600 mb-0.5">주수</p>
          <p className="text-xs font-mono font-semibold text-slate-300">{pick.shares}주</p>
        </div>
        <div className="text-center">
          <p className="text-xs text-slate-600 mb-0.5">손실/수익</p>
          <p className="text-xs font-mono text-red-400">-${pick.maxLoss.toFixed(0)}</p>
          <p className="text-xs font-mono text-green-400">+${pick.maxGain.toFixed(0)}</p>
        </div>
      </div>

      {/* 근거 */}
      <div className="space-y-0.5">
        {pick.reasons?.slice(0, 3).map((reason, i) => (
          <div key={i} className="flex items-start gap-1.5">
            <ChevronRight size={10} className="text-cyan-500 mt-0.5 shrink-0" />
            <span className="text-xs text-slate-400 leading-relaxed">{reason}</span>
          </div>
        ))}
      </div>

      {pick.riskNote && (
        <div className="mt-1.5 flex items-center gap-1">
          <AlertTriangle size={10} className="text-amber-400" />
          <span className="text-xs text-amber-400">{pick.riskNote}</span>
        </div>
      )}
    </div>
  );
}

function PriceBox({ label, value, sub, color }) {
  return (
    <div className="bg-slate-900/50 rounded p-1.5 text-center">
      <div className="text-xs text-slate-500 mb-0.5">{label}</div>
      <div className={`text-xs font-mono font-semibold ${color}`}>{value}</div>
      {sub && <div className={`text-xs font-mono ${color} opacity-70`}>{sub}</div>}
    </div>
  );
}
