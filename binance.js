const ccxt = require("ccxt");

class BinanceClient {
  constructor() {
    this.exchange = new ccxt.binance({ enableRateLimit: true });
  }

  async getKlines(symbol, timeframe = "1h", limit = 300) {
    const ohlcv = await this.exchange.fetchOHLCV(symbol, timeframe, undefined, limit);
    return ohlcv.map((c) => ({
      timestamp: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5]
    }));
  }

  async getPrice(symbol) {
    const ticker = await this.exchange.fetchTicker(symbol);
    return ticker.last;
  }

  async get24hChange(symbol) {
    const ticker = await this.exchange.fetchTicker(symbol);
    return ticker.percentage;
  }
}

module.exports = BinanceClient;
