import { useState } from 'react';
import { X, PlusCircle, TrendingUp, TrendingDown, Minus, Pencil } from 'lucide-react';

export default function TradeForm({ onAdd, onClose }) {
  const [form, setForm] = useState({
    symbol: '',
    buyDate: new Date().toISOString().slice(0, 10),
    buyPrice: '',
    invested: '',
    target: '',
    stop: '',
    notes: '',
  });
  const [error, setError] = useState('');

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  function submit(e) {
    e.preventDefault();
    if (!form.symbol || !form.buyPrice || !form.invested) {
      setError('Symbol, buy price, and amount are required');
      return;
    }
    const buyPrice = parseFloat(form.buyPrice);
    const invested = parseFloat(form.invested);
    if (isNaN(buyPrice) || isNaN(invested) || buyPrice <= 0 || invested <= 0) {
      setError('Please enter valid numbers');
      return;
    }
    onAdd({
      id: Date.now().toString(),
      symbol: form.symbol.toUpperCase().trim(),
      buyDate: form.buyDate,
      buyPrice,
      invested,
      shares: parseFloat((invested / buyPrice).toFixed(4)),
      target: form.target ? parseFloat(form.target) : null,
      stop: form.stop ? parseFloat(form.stop) : null,
      notes: form.notes.trim() || null,
      sellDate: null,
      sellPrice: null,
      result: 'open',
      pnl: null,
      pnlPct: null,
    });
    onClose();
  }

  const shares = form.buyPrice && form.invested
    ? (parseFloat(form.invested) / parseFloat(form.buyPrice)).toFixed(3)
    : null;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#0a0a0a] border border-slate-800 rounded-2xl p-6 w-full max-w-sm max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
            <PlusCircle size={15} className="text-cyan-400" />
            Add Position
          </h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="text-xs text-slate-500 block mb-1">Symbol</label>
            <input
              className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm font-mono text-slate-100 placeholder-slate-600 focus:outline-none focus:border-cyan-500/60 uppercase"
              placeholder="NVDA"
              value={form.symbol}
              onChange={e => set('symbol', e.target.value)}
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500 block mb-1">Buy Date</label>
              <input
                type="date"
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm font-mono text-slate-100 focus:outline-none focus:border-cyan-500/60"
                value={form.buyDate}
                onChange={e => set('buyDate', e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Buy Price ($)</label>
              <input
                type="number" step="0.01" min="0"
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm font-mono text-slate-100 placeholder-slate-600 focus:outline-none focus:border-cyan-500/60"
                placeholder="60.00"
                value={form.buyPrice}
                onChange={e => set('buyPrice', e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Amount ($)</label>
            <input
              type="number" step="0.01" min="0"
              className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm font-mono text-slate-100 placeholder-slate-600 focus:outline-none focus:border-cyan-500/60"
              placeholder="1140"
              value={form.invested}
              onChange={e => set('invested', e.target.value)}
            />
            {shares && <p className="text-xs text-slate-500 mt-1">≈ {shares} shares</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500 block mb-1">Target ($) <span className="text-slate-700">opt</span></label>
              <input
                type="number" step="0.01" min="0"
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm font-mono text-slate-100 placeholder-slate-600 focus:outline-none focus:border-cyan-500/60"
                placeholder="64.82"
                value={form.target}
                onChange={e => set('target', e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Stop ($) <span className="text-slate-700">opt</span></label>
              <input
                type="number" step="0.01" min="0"
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm font-mono text-slate-100 placeholder-slate-600 focus:outline-none focus:border-cyan-500/60"
                placeholder="57.71"
                value={form.stop}
                onChange={e => set('stop', e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Entry Rationale <span className="text-slate-700">opt</span></label>
            <textarea
              rows={3}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-300 placeholder-slate-600 focus:outline-none focus:border-cyan-500/60 resize-none leading-relaxed"
              placeholder="e.g. Fib 0.786 support, RSI+MACD bullish div, volume dry-up on lows"
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
            />
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <button
            type="submit"
            className="w-full py-2 rounded-lg bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 text-sm font-medium hover:bg-cyan-500/30 transition-colors mt-1"
          >
            Add Position
          </button>
        </form>
      </div>
    </div>
  );
}

export function EditForm({ trade, onClose, onConfirm }) {
  const [form, setForm] = useState({
    symbol:   trade.symbol,
    buyDate:  trade.buyDate,
    buyPrice: String(trade.buyPrice),
    invested: String(trade.invested),
    target:   trade.target != null ? String(trade.target) : '',
    stop:     trade.stop   != null ? String(trade.stop)   : '',
    notes:    trade.notes  ?? '',
  });
  const [error, setError] = useState('');

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  function submit(e) {
    e.preventDefault();
    const buyPrice = parseFloat(form.buyPrice);
    const invested = parseFloat(form.invested);
    if (!form.symbol || isNaN(buyPrice) || isNaN(invested) || buyPrice <= 0 || invested <= 0) {
      setError('Symbol, buy price, and amount are required');
      return;
    }
    onConfirm({
      symbol:   form.symbol.toUpperCase().trim(),
      buyDate:  form.buyDate,
      buyPrice,
      invested,
      shares:   parseFloat((invested / buyPrice).toFixed(4)),
      target:   form.target ? parseFloat(form.target) : null,
      stop:     form.stop   ? parseFloat(form.stop)   : null,
      notes:    form.notes.trim() || null,
    });
  }

  const shares = form.buyPrice && form.invested
    ? (parseFloat(form.invested) / parseFloat(form.buyPrice)).toFixed(3)
    : null;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#0a0a0a] border border-slate-800 rounded-2xl p-6 w-full max-w-sm max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
            <Pencil size={14} className="text-amber-400" />
            Edit — <span className="text-cyan-400 font-mono">{trade.symbol}</span>
          </h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="text-xs text-slate-500 block mb-1">Symbol</label>
            <input
              className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm font-mono text-slate-100 focus:outline-none focus:border-amber-500/60 uppercase"
              value={form.symbol}
              onChange={e => set('symbol', e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500 block mb-1">Buy Date</label>
              <input
                type="date"
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm font-mono text-slate-100 focus:outline-none focus:border-amber-500/60"
                value={form.buyDate}
                onChange={e => set('buyDate', e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Buy Price ($)</label>
              <input
                type="number" step="0.01" min="0"
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm font-mono text-slate-100 focus:outline-none focus:border-amber-500/60"
                value={form.buyPrice}
                onChange={e => set('buyPrice', e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Amount ($)</label>
            <input
              type="number" step="0.01" min="0"
              className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm font-mono text-slate-100 focus:outline-none focus:border-amber-500/60"
              value={form.invested}
              onChange={e => set('invested', e.target.value)}
            />
            {shares && <p className="text-xs text-slate-500 mt-1">≈ {shares} shares</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500 block mb-1">Target ($)</label>
              <input
                type="number" step="0.01" min="0"
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm font-mono text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-500/60"
                placeholder="—"
                value={form.target}
                onChange={e => set('target', e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Stop ($)</label>
              <input
                type="number" step="0.01" min="0"
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm font-mono text-slate-100 placeholder-slate-600 focus:outline-none focus:border-amber-500/60"
                placeholder="—"
                value={form.stop}
                onChange={e => set('stop', e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Entry Rationale</label>
            <textarea
              rows={3}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-300 placeholder-slate-600 focus:outline-none focus:border-amber-500/60 resize-none leading-relaxed"
              placeholder="Entry rationale..."
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
            />
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <button
            type="submit"
            className="w-full py-2 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-300 text-sm font-medium hover:bg-amber-500/30 transition-colors mt-1"
          >
            Save Changes
          </button>
        </form>
      </div>
    </div>
  );
}

export function CloseForm({ trade, onClose, onConfirm }) {
  const [sellDate, setSellDate] = useState(new Date().toISOString().slice(0, 10));
  const [sellPrice, setSellPrice] = useState('');
  const [result, setResult] = useState('target');

  const preview = sellPrice
    ? (() => {
        const sp = parseFloat(sellPrice);
        const pnl = (sp - trade.buyPrice) * trade.shares;
        const pct = (sp - trade.buyPrice) / trade.buyPrice * 100;
        return { pnl, pct };
      })()
    : null;

  function submit(e) {
    e.preventDefault();
    const sp = parseFloat(sellPrice);
    if (isNaN(sp) || sp <= 0) return;
    const pnl = parseFloat(((sp - trade.buyPrice) * trade.shares).toFixed(2));
    const pnlPct = parseFloat(((sp - trade.buyPrice) / trade.buyPrice * 100).toFixed(2));
    onConfirm({ sellDate, sellPrice: sp, result, pnl, pnlPct });
  }

  const isProfit = preview && preview.pnl >= 0;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#0a0a0a] border border-slate-800 rounded-2xl p-6 w-full max-w-sm">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-semibold text-slate-200">
            Close — <span className="text-cyan-400 font-mono">{trade.symbol}</span>
          </h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="bg-slate-900 rounded-lg p-3 mb-4 text-xs font-mono">
          <div className="flex justify-between text-slate-400 mb-1">
            <span>Buy price</span><span>${trade.buyPrice.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-slate-400">
            <span>Amount / Shares</span><span>${trade.invested.toFixed(0)} / {trade.shares}</span>
          </div>
          {trade.target && (
            <div className="flex justify-between text-slate-500 mt-1">
              <span>Target</span><span className="text-green-500/70">${trade.target.toFixed(2)}</span>
            </div>
          )}
          {trade.stop && (
            <div className="flex justify-between text-slate-500">
              <span>Stop</span><span className="text-red-500/70">${trade.stop.toFixed(2)}</span>
            </div>
          )}
        </div>

        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500 block mb-1">Sell Date</label>
              <input
                type="date"
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm font-mono text-slate-100 focus:outline-none focus:border-violet-500/60"
                value={sellDate}
                onChange={e => setSellDate(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Sell Price ($)</label>
              <input
                type="number" step="0.01" min="0"
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm font-mono text-slate-100 placeholder-slate-600 focus:outline-none focus:border-violet-500/60"
                placeholder="65.00"
                value={sellPrice}
                onChange={e => setSellPrice(e.target.value)}
                autoFocus
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-500 block mb-1">Result</label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { v: 'target',   icon: <TrendingUp size={12} />,   label: 'Target',   cls: 'border-green-500/50 text-green-400 bg-green-500/10' },
                { v: 'stoploss', icon: <TrendingDown size={12} />, label: 'Stop',     cls: 'border-red-500/50 text-red-400 bg-red-500/10' },
                { v: 'manual',   icon: <Minus size={12} />,        label: 'Manual',   cls: 'border-slate-500/50 text-slate-400 bg-slate-700/30' },
              ].map(opt => (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => setResult(opt.v)}
                  className={`flex items-center justify-center gap-1 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                    result === opt.v ? opt.cls : 'border-slate-800 text-slate-600 hover:text-slate-400'
                  }`}
                >
                  {opt.icon}{opt.label}
                </button>
              ))}
            </div>
          </div>

          {preview && (
            <div className={`rounded-lg p-3 text-sm font-mono font-semibold text-center ${isProfit ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
              {isProfit ? '+' : ''}{preview.pnl.toFixed(2)} ({isProfit ? '+' : ''}{preview.pct.toFixed(2)}%)
            </div>
          )}

          <button
            type="submit"
            className="w-full py-2 rounded-lg bg-violet-500/20 border border-violet-500/40 text-violet-300 text-sm font-medium hover:bg-violet-500/30 transition-colors"
          >
            Confirm Close
          </button>
        </form>
      </div>
    </div>
  );
}
