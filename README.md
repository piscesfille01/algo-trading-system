# Algorithmic Trading System

An automated day trading system for US equities that combines technical analysis with AI-powered insights to identify high-probability trading opportunities.

## 🎯 Core Algorithm

The system employs a **multi-pattern technical analysis approach** with three distinct entry strategies:

### Pattern Detection

1. **Oversold Bounce** (56-59% win rate)
   - Entry: RSI < 30
   - Thesis: Mean reversion from extreme oversold conditions

2. **Bottom Accumulation** (64% win rate)
   - Entry: RSI < 35 + 3-day consecutive volume increase
   - Thesis: Institutional accumulation at support levels

3. **Momentum Shift** (56% win rate)
   - Entry: RSI < 40 + MACD golden cross
   - Thesis: Early trend reversal with momentum confirmation

### Technical Indicators

- **RSI (Relative Strength Index)**: Primary momentum filter
- **MACD**: Trend confirmation and divergence detection
- **Volume Analysis**: Accumulation/distribution patterns
- **Moving Averages**: Trend direction and support/resistance

### Risk Management

- **Dynamic Position Sizing**: 20% of capital allocated per trade
- **Risk-Reward Ratio**: Minimum 1.5:1 target
- **Stop Loss**: Automatically calculated based on ATR
- **Target Price**: Statistical resistance levels

## 🤖 AI Integration

Leverages **Claude Sonnet 4** for advanced market analysis:

- Real-time technical pattern interpretation
- Support/resistance level identification
- Probability-based scenario forecasting
- Risk assessment and action recommendations

## 🏗️ Architecture

```
┌─────────────────┐
│   pick.js       │  Stock screening & signal generation
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   summary.js    │  AI-powered analysis (Claude API)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   server.js     │  REST API (Express)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Dashboard     │  React UI (Vite + TailwindCSS)
└─────────────────┘
```

## 📊 Tech Stack

**Backend:**
- Node.js / Express.js
- Anthropic Claude API
- Yahoo Finance API

**Frontend:**
- React + Vite
- TailwindCSS
- Recharts

**Data Sources:**
- Yahoo Finance (OHLCV data)
- Alpha Vantage (Earnings calendar)

## 🚀 Getting Started

### Prerequisites

```bash
node >= 18.0.0
npm >= 9.0.0
```

### Installation

```bash
# Clone repository
git clone https://github.com/piscesfille01/algo-trading-system.git
cd algo-trading-system

# Install dependencies
npm install
cd dashboard && npm install && cd ..

# Configure environment
cp .env.example .env
# Add your API keys to .env
```

### Configuration

Create `.env` file:

```env
ANTHROPIC_API_KEY=your_claude_api_key
ALPHAVANTAGE_API_KEY=your_alphavantage_key
INITIAL_BALANCE=10000
```

### Usage

```bash
# Run stock screening
node scripts/run.js

# Specific date analysis
node scripts/run.js 2026-03-20

# Start dashboard
npm run dev
```

## 📈 Features

- ✅ Automated stock screening with technical analysis
- ✅ AI-powered trade insights and recommendations
- ✅ Real-time portfolio tracking
- ✅ Interactive dashboard with P&L charts
- ✅ Trade history and performance analytics
- ✅ Risk management with automatic stop-loss calculation

## 📝 Trading Workflow

1. **Screening**: `pick.js` scans market for technical setups
2. **Analysis**: `summary.js` provides AI-enhanced insights
3. **Execution**: Manual trade entry via dashboard
4. **Monitoring**: Real-time position tracking
5. **Exit**: Automatic alerts for stop/target levels

## 🧪 Performance Metrics

- **Average Win Rate**: 56-64% (pattern-dependent)
- **Risk/Reward**: 1.5:1 minimum
- **Holding Period**: 1-5 trading days
- **Capital Allocation**: 20% per position

## 🛠️ Project Structure

```
algo-trading-system/
├── scripts/
│   ├── pick.js           # Stock screening algorithm
│   ├── summary.js        # AI analysis engine
│   ├── run.js            # Orchestration script
│   └── ...
├── dashboard/            # React frontend
├── server.js             # Express API
└── output/               # Trade data & cache
```

## ⚠️ Disclaimer

This is an educational project for algorithmic trading research. Not financial advice. Trading involves substantial risk of loss. Past performance does not guarantee future results.

## 📄 License

MIT License - See LICENSE file for details

---

**Built with:** Node.js • React • Claude AI • Technical Analysis
