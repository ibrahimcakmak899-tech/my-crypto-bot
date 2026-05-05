const Analysis = require("./analysis");
const { ATR_MULTIPLIER_SL, TP1_RR, TP2_RR, TP3_RR, RSI_OVERBOUGHT, RSI_OVERSOLD, MIN_SIGNAL_STRENGTH, MIN_AI_SCORE } = require("./config");

class SignalGenerator {
  static generate(candles, symbol, timeframe) {
    const ind = Analysis.compute(candles);
    const price = ind.currentPrice;
    const atr = ind.atr;
    if (!atr || atr === 0 || isNaN(atr)) return null;

    const aiScore = this._calculateAIScore(ind, price);
    if (aiScore < MIN_AI_SCORE) return null;

    const type = aiScore > 50 ? "LONG" : null;
    if (!type) return null;

    const slDistance = atr * ATR_MULTIPLIER_SL;
    const sl = price - slDistance;
    const tp1 = price + slDistance * TP1_RR;
    const tp2 = price + slDistance * TP2_RR;
    const tp3 = price + slDistance * TP3_RR;

    const reasons = this._generateReasons(ind, price, type);
    const trailingStop = price - (atr * (ATR_MULTIPLIER_SL + 0.5));

    return {
      symbol,
      timeframe,
      type,
      entry: parseFloat(price.toFixed(4)),
      sl: parseFloat(sl.toFixed(4)),
      tp1: parseFloat(tp1.toFixed(4)),
      tp2: parseFloat(tp2.toFixed(4)),
      tp3: parseFloat(tp3.toFixed(4)),
      trailingStop: parseFloat(trailingStop.toFixed(4)),
      rr1: TP1_RR, rr2: TP2_RR, rr3: TP3_RR,
      rsi: parseFloat(ind.rsi.toFixed(1)),
      macdHistogram: parseFloat(ind.macdHistogram.toFixed(6)),
      atr: parseFloat(atr.toFixed(6)),
      aiScore: aiScore,
      patterns: ind.patterns.map(p => p.name).join(", "),
      reasons,
      strength: aiScore,
    };
  }

  static _calculateAIScore(ind, price) {
    let score = 50;
    const maxScore = 100;

    const isUptrend = price > ind.ema50 && ind.ema50 > ind.ema200;
    const isAboveSma20 = price > ind.sma20;

    if (isUptrend) score += 15;
    else if (price < ind.ema50 && ind.ema50 < ind.ema200) score -= 20;

    if (ind.rsi < 35) score += 10;
    else if (ind.rsi < 45) score += 5;
    else if (ind.rsi > 70) score -= 15;
    else if (ind.rsi > 60) score -= 5;

    if (ind.macdHistogram > 0) score += 10;
    else score -= 10;

    const bbPos = (price - ind.bbLower) / (ind.bbUpper - ind.bbLower);
    if (bbPos < 0.2) score += 10;
    else if (bbPos < 0.4) score += 5;
    else if (bbPos > 0.8) score -= 10;

    const bullishPatterns = ind.patterns.filter(p => p.type === "BULLISH").reduce((a, p) => a + p.strength, 0);
    const bearishPatterns = ind.patterns.filter(p => p.type === "BEARISH").reduce((a, p) => a + p.strength, 0);
    score += bullishPatterns * 3 - bearishPatterns * 4;

    if (isAboveSma20) score += 3;
    if (ind.volume > 0) score += 2;

    return Math.min(Math.max(score, 0), maxScore);
  }

  static _generateReasons(ind, price, type) {
    const reasons = [];
    const isUptrend = price > ind.ema50 && ind.ema50 > ind.ema200;

    if (isUptrend) reasons.push("📈 Güçlü yükseliş trendi (EMA 50>200)");
    if (ind.rsi < 40) reasons.push("🔄 RSI dip bölgesinde");
    else if (ind.rsi < 50) reasons.push("📊 RSI dengeli");

    if (ind.macdHistogram > 0) reasons.push("🟢 MACD pozitif");
    if (ind.patterns.length) reasons.push("🕯️ Mum: " + ind.patterns.filter(p => p.type === "BULLISH").map(p => p.name).join(", ") || "Nötr");
    if (price > ind.sma20) reasons.push("📏 Fiyat SMA20 üzerinde");
    if (price <= ind.bbMiddle) reasons.push("🎯 Bollinger orta bandı civarında");

    return reasons;
  }
}

module.exports = SignalGenerator;
