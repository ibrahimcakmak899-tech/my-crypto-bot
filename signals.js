const Analysis = require("./analysis");
const { ATR_MULTIPLIER_SL, TP1_RR, TP2_RR, TP3_RR, RSI_OVERBOUGHT, RSI_OVERSOLD, MIN_AI_SCORE } = require("./config");

class SignalGenerator {
  static generate(candles, symbol, timeframe) {
    const ind = Analysis.compute(candles);
    const price = ind.currentPrice;
    const atr = ind.atr;
    if (!atr || atr === 0 || isNaN(atr)) return null;

    const aiScore = this._calculateAIScore(ind, price);
    if (aiScore < MIN_AI_SCORE) return null;

    const type = aiScore > 50 ? "LONG" : "SHORT";
    // For now, let's stick to Longs or just simple Long/Short logic. 
    // If the user wants shorting, the score needs to support it. 
    // A score < 50 implies a Sell signal in my new logic below.
    
    const slDistance = atr * ATR_MULTIPLIER_SL;
    const sl = type === "LONG" ? price - slDistance : price + slDistance;
    const tp1 = price + slDistance * TP1_RR;
    const tp2 = price + slDistance * TP2_RR;
    const tp3 = price + slDistance * TP3_RR;
    
    // Trailing stop calculation
    const trailingStop = type === "LONG" ? price - (atr * (ATR_MULTIPLIER_SL + 0.5)) : price + (atr * (ATR_MULTIPLIER_SL + 0.5));

    const reasons = this._generateReasons(ind, price, type);

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
      stochK: parseFloat(ind.stochK.toFixed(1)),
      stochD: parseFloat(ind.stochD.toFixed(1)),
      adx: parseFloat(ind.adx.toFixed(1)),
      macdHistogram: parseFloat(ind.macdHistogram.toFixed(6)),
      atr: parseFloat(atr.toFixed(6)),
      volumeRatio: parseFloat(ind.volumeRatio.toFixed(2)),
      aiScore: aiScore,
      patterns: ind.patterns.map(p => p.name).join(", "),
      reasons,
      strength: aiScore,
      timestamp: Date.now(),
    };
  }

  static _calculateAIScore(ind, price) {
    let score = 50;

    // --- Trend Filters (Strong Weight) ---
    const isUptrend = price > ind.ema50 && ind.ema50 > ind.ema200;
    const isDowntrend = price < ind.ema50 && ind.ema50 < ind.ema200;
    
    if (isUptrend) score += 20;
    if (isDowntrend) score -= 20;
    
    if (price > ind.sma20) score += 5;
    else score -= 5;

    // --- RSI (Momentum) ---
    if (ind.rsi < 30) score += 15; // Oversold (Strong Buy)
    else if (ind.rsi < 40) score += 5; // Dip
    else if (ind.rsi > 70) score -= 15; // Overbought (Strong Sell)
    else if (ind.rsi > 60) score -= 5;

    // --- Stochastic (Momentum) ---
    if (ind.stochK < 20 && ind.stochK > ind.stochD) score += 15; // Oversold crossover
    if (ind.stochK > 80 && ind.stochK < ind.stochD) score -= 15; // Overbought crossover

    // --- ADX (Trend Strength) ---
    if (ind.adx > 25) {
        if (ind.plusDI > ind.minusDI) score += 10;
        else score -= 10;
    }

    // --- MACD (Momentum) ---
    if (ind.macdHistogram > 0) score += 10;
    else score -= 10;

    // --- Bollinger Bands ---
    const bbPos = (price - ind.bbLower) / (ind.bbUpper - ind.bbLower);
    if (bbPos < 0.2) score += 10; // Near Lower Band
    else if (bbPos > 0.8) score -= 10; // Near Upper Band

    // --- Candlestick Patterns ---
    const bullishStr = ind.patterns.filter(p => p.type === "BULLISH").reduce((a, p) => a + p.strength, 0);
    const bearishStr = ind.patterns.filter(p => p.type === "BEARISH").reduce((a, p) => a + p.strength, 0);
    score += bullishStr * 4;
    score -= bearishStr * 4;

    // --- Volume ---
    if (ind.volumeRatio > 1.5) score += 5;
    if (ind.volumeRatio < 0.5) score -= 2; // Low volume, less reliable

    // Normalize to 0-100
    return Math.min(Math.max(score, 0), 100);
  }

  static _generateReasons(ind, price, type) {
    const reasons = [];
    const isUptrend = price > ind.ema50 && ind.ema50 > ind.ema200;
    const isDowntrend = price < ind.ema50 && ind.ema50 < ind.ema200;

    // Trend
    if (isUptrend) reasons.push("📈 Yükseliş Trendi (EMA 50>200)");
    if (isDowntrend) reasons.push("📉 Düşüş Trendi (EMA 50<200)");

    // Momentum
    if (ind.rsi < 30) reasons.push("🔄 RSI Aşırı Satım");
    if (ind.rsi > 70) reasons.push("🔄 RSI Aşırı Alım");
    
    // Stochastic
    if (ind.stochK < 20) reasons.push("📉 Stokastik Dip Bölgesinde");
    if (ind.stochK > 80) reasons.push("📈 Stokastik Tepe Bölgesinde");

    // ADX
    if (ind.adx > 25) reasons.push(`💪 Güçlü Trend (ADX: ${ind.adx.toFixed(0)})`);

    // Volume
    if (ind.volumeRatio > 1.5) reasons.push(`💥 Hacim Patlaması (${ind.volumeRatio}x)`);

    // Patterns
    if (ind.patterns.length) reasons.push("🕯️ Formasyon: " + ind.patterns.map(p => p.name).join(", "));

    return reasons;
  }
}

module.exports = SignalGenerator;
