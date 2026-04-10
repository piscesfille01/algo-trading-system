import { useState } from 'react';
import { PlusCircle, Clock, ChevronDown, ChevronUp, Trash2, Pencil, BookOpen, LayoutDashboard, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import TradeForm, { CloseForm, EditForm } from './TradeForm';

const RESULT_META = {
  target:   { text: 'Target Hit', short: 'TGT', cls: 'text-green-400',  bg: 'bg-green-500/10 border-green-500/25' },
  stoploss: { text: 'Stop Loss',  short: 'STP', cls: 'text-red-400',    bg: 'bg-red-500/10 border-red-500/25' },
  manual:   { text: 'Manual',     short: 'MNL', cls: 'text-slate-400',  bg: 'bg-slate-700/30 border-slate-600/25' },
  open:     { text: 'Open',       short: 'OPN', cls: 'text-amber-400',  bg: 'bg-amber-500/10 border-amber-500/25' },
};

export default function ManualTrades({ trades, balance, initialBalance, livePrices = {}, onAdd, onClose, onEdit, onDelete }) {
  const [tab, setTab] = useState('portfolio');
  const [showForm, setShowForm] = useState(false);
  const [closingTrade, setClosingTrade] = useState(null);
  const [editingTrade, setEditingTrade] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [expandedId, setExpandedId] = useState(null);

  const openTrades   = trades.filter(t => t.result === 'open');
  const closedTrades = trades
    .filter(t => t.result !== 'open')
    .sort((a, b) => (b.sellDate ?? '').localeCompare(a.sellDate ?? '') || b.buyDate.localeCompare(a.buyDate));

  const closedPnl   = closedTrades.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const totalReturn = (closedPnl / initialBalance * 100).toFixed(2);
  const wins        = closedTrades.filter(t => t.pnl > 0).length;
  const losses      = closedTrades.filter(t => t.pnl <= 0).length;
  const hitRate     = closedTrades.length > 0 ? (wins / closedTrades.length * 100).toFixed(0) : 0;
  const avgWin      = wins > 0 ? (closedTrades.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnlPct, 0) / wins).toFixed(1) : '—';
  const avgLoss     = losses > 0 ? (closedTrades.filter(t => t.pnl <= 0).reduce((s, t) => s + t.pnlPct, 0) / losses).toFixed(1) : '—';

  function handleClose(closeData) {
    onClose(closingTrade.id, closeData);
    setClosingTrade(null);
  }
  function handleEdit(updates) {
    onEdit(editingTrade.id, updates);
    setEditingTrade(null);
  }

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="bg-[#0a0a0a] border border-slate-800 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1 bg-slate-900 rounded-lg p-0.5">
            <TabBtn active={tab === 'portfolio'} onClick={() => setTab('portfolio')} icon={<LayoutDashboard size={12} />} label="Portfolio" />
            <TabBtn active={tab === 'log'}       onClick={() => setTab('log')}       icon={<BookOpen size={12} />}        label="Trade Log" />
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/25 transition-colors"
          >
            <PlusCircle size={12} /> Add Position
          </button>
        </div>

        <div className="grid grid-cols-4 gap-3">
          <Stat label="Available Cash"
            value={`$${balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            sub={`${closedPnl >= 0 ? '+' : ''}${totalReturn}%`}
            color={closedPnl >= 0 ? 'text-green-400' : 'text-red-400'} />
          <Stat label="Realized P&L"
            value={`${closedPnl >= 0 ? '+' : ''}$${Math.abs(closedPnl).toFixed(2)}`}
            color={closedPnl >= 0 ? 'text-green-400' : 'text-red-400'} />
          <Stat label="Win Rate" value={`${hitRate}%`} sub={`${wins}W ${losses}L`} color="text-violet-400" />
          <Stat label="Open" value={`${openTrades.length}`} sub="Positions" color="text-amber-400" />
        </div>
      </div>

      {/* ── Portfolio tab ── */}
      {tab === 'portfolio' && (
        <>
          {openTrades.length > 0 && (
            <div className="bg-[#0a0a0a] border border-slate-800 rounded-xl p-4">
              <h3 className="text-xs font-semibold text-slate-400 mb-3">Open Positions</h3>
              <div className="space-y-2">
                {openTrades.map(t => (
                  <OpenPositionRow
                    key={t.id}
                    trade={t}
                    livePrice={livePrices[t.symbol]}
                    onClose={() => setClosingTrade(t)}
                    onEdit={() => setEditingTrade(t)}
                    onDelete={() => onDelete(t.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Closed trades compact table */}
          <div className="bg-[#0a0a0a] border border-slate-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-slate-400">Closed Trades</h3>
              <span className="text-xs text-slate-600">{closedTrades.length} trades</span>
            </div>
            {closedTrades.length === 0 ? (
              <p className="text-center text-xs text-slate-600 py-6">No closed trades yet</p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-slate-600 border-b border-slate-800">
                        <th className="text-left pb-2 font-medium">Date</th>
                        <th className="text-left pb-2 font-medium">Symbol</th>
                        <th className="text-right pb-2 font-medium">Buy</th>
                        <th className="text-right pb-2 font-medium">Sell</th>
                        <th className="text-right pb-2 font-medium">Invested</th>
                        <th className="text-right pb-2 font-medium">P&L</th>
                        <th className="text-right pb-2 font-medium">Return</th>
                        <th className="text-center pb-2 font-medium">Result</th>
                        <th className="pb-2"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/50">
                      {(showAll ? closedTrades : closedTrades.slice(0, 8)).map(t => {
                        const isWin = t.pnl > 0;
                        const rm = RESULT_META[t.result] ?? RESULT_META.manual;
                        return (
                          <tr key={t.id} className="hover:bg-slate-900/40 transition-colors">
                            <td className="py-2 text-slate-600 font-mono">{t.buyDate}</td>
                            <td className="py-2 font-mono font-semibold text-slate-200">{t.symbol}</td>
                            <td className="py-2 text-right font-mono text-slate-400">${t.buyPrice.toFixed(2)}</td>
                            <td className="py-2 text-right font-mono text-slate-400">${t.sellPrice?.toFixed(2) ?? '—'}</td>
                            <td className="py-2 text-right font-mono text-slate-500">${t.invested.toFixed(0)}</td>
                            <td className={`py-2 text-right font-mono font-semibold ${isWin ? 'text-green-400' : 'text-red-400'}`}>
                              {isWin ? '+' : ''}${t.pnl?.toFixed(2) ?? '—'}
                            </td>
                            <td className={`py-2 text-right font-mono ${isWin ? 'text-green-400' : 'text-red-400'}`}>
                              {t.pnlPct > 0 ? '+' : ''}{t.pnlPct?.toFixed(2) ?? '—'}%
                            </td>
                            <td className={`py-2 text-center text-xs ${rm.cls}`}>{rm.short}</td>
                            <td className="py-2 text-center">
                              <button onClick={() => onDelete(t.id)} className="text-slate-700 hover:text-red-400 transition-colors">
                                <Trash2 size={11} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {closedTrades.length > 8 && (
                  <button
                    onClick={() => setShowAll(!showAll)}
                    className="mt-3 w-full flex items-center justify-center gap-1 text-xs text-slate-600 hover:text-slate-400 transition-colors py-1"
                  >
                    {showAll
                      ? <><ChevronUp size={12} /> Collapse</>
                      : <><ChevronDown size={12} /> Show all ({closedTrades.length})</>}
                  </button>
                )}
              </>
            )}
          </div>
        </>
      )}

      {/* ── Trade Log tab ── */}
      {tab === 'log' && (
        <div className="space-y-3">
          {/* Stats row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-[#0a0a0a] border border-slate-800 rounded-xl p-4">
              <p className="text-xs text-slate-500 mb-2">Performance</p>
              <div className="space-y-1.5 text-xs font-mono">
                <div className="flex justify-between">
                  <span className="text-slate-500">Total trades</span>
                  <span className="text-slate-300">{closedTrades.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Win / Loss</span>
                  <span className="text-slate-300">{wins} / {losses}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Win rate</span>
                  <span className={wins >= losses ? 'text-green-400' : 'text-red-400'}>{hitRate}%</span>
                </div>
              </div>
            </div>
            <div className="bg-[#0a0a0a] border border-slate-800 rounded-xl p-4">
              <p className="text-xs text-slate-500 mb-2">Averages</p>
              <div className="space-y-1.5 text-xs font-mono">
                <div className="flex justify-between">
                  <span className="text-slate-500">Avg win</span>
                  <span className="text-green-400">{avgWin !== '—' ? `+${avgWin}%` : '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Avg loss</span>
                  <span className="text-red-400">{avgLoss !== '—' ? `${avgLoss}%` : '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Realized P&L</span>
                  <span className={closedPnl >= 0 ? 'text-green-400' : 'text-red-400'}>
                    {closedPnl >= 0 ? '+' : ''}${closedPnl.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Trade cards */}
          {closedTrades.length === 0 ? (
            <div className="bg-[#0a0a0a] border border-slate-800 rounded-xl p-8 text-center text-xs text-slate-600">
              No closed trades yet
            </div>
          ) : (
            closedTrades.map(t => (
              <TradeLogCard
                key={t.id}
                trade={t}
                expanded={expandedId === t.id}
                onToggle={() => setExpandedId(expandedId === t.id ? null : t.id)}
                onDelete={() => onDelete(t.id)}
              />
            ))
          )}
        </div>
      )}

      {showForm    && <TradeForm onAdd={onAdd} onClose={() => setShowForm(false)} />}
      {closingTrade && <CloseForm trade={closingTrade} onClose={() => setClosingTrade(null)} onConfirm={handleClose} />}
      {editingTrade && <EditForm  trade={editingTrade}  onClose={() => setEditingTrade(null)} onConfirm={handleEdit} />}
    </div>
  );
}

function TradeLogCard({ trade: t, expanded, onToggle, onDelete }) {
  const isWin = t.pnl > 0;
  const rm = RESULT_META[t.result] ?? RESULT_META.manual;
  const holdDays = t.sellDate && t.buyDate
    ? Math.round((new Date(t.sellDate) - new Date(t.buyDate)) / 86400000)
    : null;

  return (
    <div className={`bg-[#0a0a0a] border rounded-xl overflow-hidden transition-colors ${
      isWin ? 'border-green-500/20' : 'border-red-500/15'
    }`}>
      {/* Card header — always visible */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-900/30 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <div className={`w-1 h-8 rounded-full ${isWin ? 'bg-green-500' : 'bg-red-500'}`} />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono font-bold text-slate-100">{t.symbol}</span>
              <span className={`text-xs px-1.5 py-0.5 rounded border font-medium ${rm.bg} ${rm.cls}`}>{rm.text}</span>
              {t.notes && <span className="text-xs text-slate-600 bg-slate-800/60 px-1.5 py-0.5 rounded border border-slate-700/40">note</span>}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs text-slate-500 font-mono">{t.buyDate}</span>
              {t.sellDate && <><span className="text-slate-700 text-xs">→</span><span className="text-xs text-slate-500 font-mono">{t.sellDate}</span></>}
              {holdDays !== null && <span className="text-xs text-slate-600">{holdDays}d</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className={`text-sm font-mono font-bold ${isWin ? 'text-green-400' : 'text-red-400'}`}>
              {isWin ? '+' : ''}${t.pnl?.toFixed(2) ?? '—'}
            </p>
            <p className={`text-xs font-mono ${isWin ? 'text-green-500/70' : 'text-red-500/70'}`}>
              {t.pnlPct > 0 ? '+' : ''}{t.pnlPct?.toFixed(2) ?? '—'}%
            </p>
          </div>
          <ChevronDown size={14} className={`text-slate-600 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-slate-800/60">
          {/* Price grid */}
          <div className="grid grid-cols-4 gap-3 mt-3 mb-3">
            <div>
              <p className="text-xs text-slate-600 mb-0.5">Buy</p>
              <p className="text-xs font-mono text-slate-300">${t.buyPrice.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-600 mb-0.5">Sell</p>
              <p className="text-xs font-mono text-slate-300">${t.sellPrice?.toFixed(2) ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs text-slate-600 mb-0.5">Target</p>
              <p className="text-xs font-mono text-green-500/70">{t.target ? `$${t.target.toFixed(2)}` : '—'}</p>
            </div>
            <div>
              <p className="text-xs text-slate-600 mb-0.5">Stop</p>
              <p className="text-xs font-mono text-red-500/70">{t.stop ? `$${t.stop.toFixed(2)}` : '—'}</p>
            </div>
            <div>
              <p className="text-xs text-slate-600 mb-0.5">Invested</p>
              <p className="text-xs font-mono text-slate-300">${t.invested.toFixed(0)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-600 mb-0.5">Shares</p>
              <p className="text-xs font-mono text-slate-300">{t.shares}</p>
            </div>
            {holdDays !== null && (
              <div>
                <p className="text-xs text-slate-600 mb-0.5">Held</p>
                <p className="text-xs font-mono text-slate-300">{holdDays} days</p>
              </div>
            )}
          </div>

          {/* Notes */}
          {t.notes && (
            <div className="bg-slate-900/60 border border-slate-800 rounded-lg px-3 py-2.5 mb-3">
              <p className="text-xs text-slate-500 mb-1 font-medium">Entry Rationale</p>
              <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">{t.notes}</p>
            </div>
          )}

          <div className="flex justify-end">
            <button onClick={onDelete} className="flex items-center gap-1 text-xs text-slate-700 hover:text-red-400 transition-colors">
              <Trash2 size={11} /> Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function OpenPositionRow({ trade: t, livePrice, onClose, onEdit, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const hasLive = livePrice != null;
  const unrealized = hasLive ? (livePrice - t.buyPrice) * t.shares : null;
  const unrealizedPct = hasLive ? ((livePrice - t.buyPrice) / t.buyPrice * 100) : null;
  const isProfit = unrealized >= 0;

  return (
    <div className={`rounded-lg border ${
      !hasLive ? 'bg-amber-400/5 border-amber-400/15' :
      isProfit ? 'bg-green-400/5 border-green-400/15' : 'bg-red-400/5 border-red-400/15'
    }`}>
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-3">
          <Clock size={13} className="text-amber-400 shrink-0" />
          <span className="font-mono font-semibold text-slate-200 text-sm">{t.symbol}</span>
          <span className="text-xs text-slate-500 font-mono">buy ${t.buyPrice.toFixed(2)}</span>
          {hasLive && (
            <span className="text-xs font-mono text-slate-400">
              now <span className={isProfit ? 'text-green-400' : 'text-red-400'}>${livePrice.toFixed(2)}</span>
            </span>
          )}
          {t.target && <span className="text-xs text-slate-600 font-mono">tgt ${t.target}</span>}
          {t.stop && <span className="text-xs text-slate-600 font-mono">stp ${t.stop}</span>}
          <span className="text-xs text-slate-700 font-mono">{t.buyDate}</span>
        </div>
        <div className="flex items-center gap-3">
          {hasLive && (
            <span className={`text-xs font-mono font-semibold ${isProfit ? 'text-green-400' : 'text-red-400'}`}>
              {isProfit ? '+' : ''}${unrealized.toFixed(2)} ({isProfit ? '+' : ''}{unrealizedPct.toFixed(2)}%)
            </span>
          )}
          <span className="text-xs text-slate-500 font-mono">${t.invested.toFixed(0)}</span>
          {t.notes && (
            <button onClick={() => setExpanded(e => !e)} className="text-slate-600 hover:text-slate-400 transition-colors" title="Show notes">
              <BookOpen size={12} />
            </button>
          )}
          <button onClick={onEdit} className="text-slate-500 hover:text-cyan-400 transition-colors" title="Edit">
            <Pencil size={12} />
          </button>
          <button onClick={onClose} className="text-xs px-2.5 py-1 rounded-md bg-violet-500/15 border border-violet-500/30 text-violet-300 hover:bg-violet-500/25 transition-colors">
            Close
          </button>
          <button onClick={onDelete} className="text-slate-600 hover:text-red-400 transition-colors">
            <Trash2 size={12} />
          </button>
        </div>
      </div>
      {expanded && t.notes && (
        <div className="px-3 pb-2.5 pt-0">
          <div className="bg-black/30 border border-slate-800/60 rounded-lg px-3 py-2">
            <p className="text-xs text-slate-500 mb-0.5 font-medium">Entry Rationale</p>
            <p className="text-xs text-slate-400 leading-relaxed whitespace-pre-wrap">{t.notes}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function TabBtn({ active, onClick, icon, label }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
        active
          ? 'bg-slate-700 text-slate-100'
          : 'text-slate-500 hover:text-slate-300'
      }`}
    >
      {icon}{label}
    </button>
  );
}

function Stat({ label, value, sub, color }) {
  return (
    <div>
      <p className="text-xs text-slate-600 mb-0.5">{label}</p>
      <p className={`text-base font-semibold font-mono ${color}`}>{value}</p>
      {sub && <p className={`text-xs ${color} opacity-70`}>{sub}</p>}
    </div>
  );
}
