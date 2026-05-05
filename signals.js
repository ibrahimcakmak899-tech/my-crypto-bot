const Analysis = require("./analysis");
const {
  ATR_MULTIPLIER_SL,
  TP1_RR,
  TP2_RR,
  RSI_OVERBOUGHT,
  RSI_OVERSOLD,
  MIN_SIGNAL_STRENGTH,
} = require("./config");

class SignalGenerator {
  static generate(candles, symbol, timeframe) {
    const ind = Analysis.compute(candles);
    const price = ind.currentPrice;
    const atr = ind.atr;

    if (!atr || atr === 0 || isNaN(atr)) return null;

    const isUptrend = price > ind.ema50 && ind.ema50 > ind.ema200;
    if (!isUptrend) return null;

    const ctx = { score: 0, reasons: [] };

    if (ind.rsi < 50) {
      ctx.score += 1;
      ctx.reasons.push(`RSI dip (${ind.rsi.toFixed(1)})`);
    }
    if (ind.macdHistogram > 0) {
      ctx.score += 1;
      ctx.reasons.push("MACD bullish");
    }
    if (price <= ind.bbMiddle) {
      ctx.score += 1;
      ctx.reasons.push("At/near BB middle (dip)");
    }
    if (price > ind.ema50) {
      ctx.score += 0.5;
      ctx.reasons.push("Above EMA50");
    }

    if (ctx.score < 2.5) return null;

    const slDistance = atr * ATR_MULTIPLIER_SL;
    const sl = price - slDistance;
    const tp1 = price + slDistance * TP1_RR;
    const tp2 = price + slDistance * TP2_RR;

    return {
      symbol,
      timeframe,
      type: "LONG",
      trend: "UPTREND",
      entry: parseFloat(price.toFixed(4)),
      sl: parseFloat(sl.toFixed(4)),
      tp1: parseFloat(tp1.toFixed(4)),
      tp2: parseFloat(tp2.toFixed(4)),
      rr1: TP1_RR,
      rr2: TP2_RR,
      rsi: parseFloat(ind.rsi.toFixed(1)),
      macdHistogram: parseFloat(ind.macdHistogram.toFixed(6)),
      atr: parseFloat(atr.toFixed(6)),
      reasons: ctx.reasons,
      strength: ctx.score,
    };
  }
}

module.exports = SignalGenerator;
