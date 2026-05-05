const Analysis = require("./analysis");
const { ATR_MULTIPLIER_SL, TP1_RR, TP2_RR, TP3_RR, MIN_AI_SCORE } = require("./config");

class SignalGenerator {
  static generate(candles, symbol, timeframe) {
    const ind = Analysis.compute(candles);
    const price = ind.currentPrice;
    const atr = ind.atr;
    if (!atr || atr === 0 || isNaN(atr)) return null;

    const aiScore = this._calculateAIScore(ind, price);
    if (aiScore < MIN_AI_SCORE) return null;

    const type = aiScore > 50 ? "LONG" : "SHORT";
    
    const slDistance = atr * ATR_MULTIPLIER_SL;
    const sl = type === "LONG" ? price - slDistance : price + slDistance;
    const tp1 = price + slDistance * TP1_RR;
    const tp2 = price + slDistance * TP2_RR;
    const tp3 = price + slDistance * TP3_RR;
    const trailingStop = type === "LONG" ? price - (atr * (ATR_MULTIPLIER_SL + 0.5)) : price + (atr * (ATR_MULTIPLIER_SL + 0.5));

    const reasons = this._generateReasons(ind, price, type);

    return {
      symbol, timeframe, type,
      entry: parseFloat(price.toFixed(4)),
      sl: parseFloat(sl.toFixed(4)),
      tp1: parseFloat(tp1.toFixed(4)), tp2: parseFloat(tp2.toFixed(4)), tp3: parseFloat(tp3.toFixed(4)),
      trailingStop: parseFloat(trailingStop.toFixed(4)),
      rr1: TP1_RR, rr2: TP2_RR, rr3: TP3_RR,
      rsi: parseFloat(ind.rsi.toFixed(1)),
      stochK: parseFloat(ind.stochK.toFixed(1)),
      stochD: parseFloat(ind.stochD.toFixed(1)),
      adx: parseFloat(ind.adx.toFixed(1)),
      macdHistogram: parseFloat(ind.macdHistogram.toFixed(6)),
      atr: parseFloat(atr.toFixed(6)),
      volumeRatio: parseFloat(ind.volumeRatio.toFixed(2)),
      aiScore: aiScore,
      patterns: ind.patterns.map(p => p.name).join(", "),
      reasons,
      resistance: parseFloat(ind.resistance.toFixed(4)),
      support: parseFloat(ind.support.toFixed(4)),
      strength: aiScore,
      timestamp: Date.now(),
    };
  }

  static _calculateAIScore(ind, price) {
    let score = 50;
    const isUptrend = price > ind.ema50 && ind.ema50 > ind.ema200;
    const isDowntrend = price < ind.ema50 && ind.ema50 < ind.ema200;
    
    if (isUptrend) score += 20;
    if (isDowntrend) score -= 20;
    if (price > ind.sma20) score += 5; else score -= 5;

    if (ind.rsi < 30) score += 15; else if (ind.rsi < 40) score += 5;
    else if (ind.rsi > 70) score -= 15; else if (ind.rsi > 60) score -= 5;

    if (ind.stochK < 20 && ind.stochK > ind.stochD) score += 15;
    if (ind.stochK > 80 && ind.stochK < ind.stochD) score -= 15;

    if (ind.adx > 25) { if (ind.plusDI > ind.minusDI) score += 10; else score -= 10; }

    if (ind.macdHistogram > 0) score += 10; else score -= 10;

    const bbPos = (price - ind.bbLower) / (ind.bbUpper - ind.bbLower);
    if (bbPos < 0.2) score += 10; else if (bbPos > 0.8) score -= 10;

    const bullishStr = ind.patterns.filter(p => p.type === "BULLISH").reduce((a, p) => a + p.strength, 0);
    const bearishStr = ind.patterns.filter(p => p.type === "BEARISH").reduce((a, p) => a + p.strength, 0);
    score += bullishStr * 4; score -= bearishStr * 4;

    if (ind.volumeRatio > 1.5) score += 5;
    return Math.min(Math.max(score, 0), 100);
  }

  static _generateReasons(ind, price, type) {
    const reasons = [];
    if (price > ind.ema50 && ind.ema50 > ind.ema200) reasons.push("📈 Yükseliş Trendi");
    if (ind.rsi < 30) reasons.push("🔄 RSI Aşırı Satım");
    if (ind.stochK < 20) reasons.push("📉 Stokastik Dip");
    if (ind.adx > 25) reasons.push(`💪 Güçlü Trend (ADX: ${ind.adx.toFixed(0)})`);
    if (ind.volumeRatio > 1.5) reasons.push(`💥 Hacim Patlaması (${ind.volumeRatio}x)`);
    if (ind.patterns.length) reasons.push("🕯️ " + ind.patterns.map(p => p.name).join(", "));
    return reasons;
  }

  static checkBreakouts(ind, symbol) {
    const alerts = [];
    const price = ind.currentPrice;
    const res = ind.resistance;
    const supp = ind.support;

    // Breakout Detection (Trend Kırılımı)
    if (price > res && ind.volumeRatio > 1.2) {
      alerts.push({ type: "BREAKOUT", symbol, price, level: res, msg: "🚀 <b>DİRENÇ KIRILIMI!</b>" });
    }
    if (price < supp && ind.volumeRatio > 1.2) {
      alerts.push({ type: "BREAKDOWN", symbol, price, level: supp, msg: "📉 <b>DESTEK KIRILIMI!</b>" });
    }

    // Trend Change (EMA Cross)
    // Simplified: If price just crossed EMA50
    const prevPrice = ind.currentPrice * 0.99; // Approximation since we don't store history here
    // Realistically we need prev candle data. Assuming logic handles it via history.
    
    return alerts;
  }
}

module.exports = SignalGenerator;
