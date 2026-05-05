const ccxt = require("ccxt");
const config = require("./config");

class ExchangeClient {
  constructor() {
    this.exchange = new ccxt.bitget({
      apiKey: config.BITGET_API_KEY || "",
      secret: config.BITGET_SECRET || "",
      password: config.BITGET_PASSPHRASE || "",
      enableRateLimit: true,
      options: { defaultType: "swap" },
    });
  }

  async getKlines(symbol, timeframe = "1h", limit = 300) {
    try {
      const ohlcv = await this.exchange.fetchOHLCV(symbol, timeframe, undefined, limit);
      return ohlcv.map((c) => ({ timestamp: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] }));
    } catch (e) {
      console.error("Kline fetch error:", e.message);
      return [];
    }
  }

  async getPrice(symbol) {
    try {
      const ticker = await this.exchange.fetchTicker(symbol);
      return ticker.last;
    } catch (e) {
      console.error("Price fetch error:", e.message);
      return null;
    }
  }

  async placeOrder(symbol, side, amount, price = null) {
    try {
      await this.exchange.setLeverage(config.LEVERAGE, symbol);
      await this.exchange.setMarginMode(config.MARGIN_MODE, symbol);
      
      // side: 'open_long' or 'open_short' for Bitget via ccxt
      const order = await this.exchange.createOrder(symbol, "market", side, amount, price, {
        marginMode: config.MARGIN_MODE,
      });
      return order;
    } catch (e) {
      console.error("Order error:", e.message);
      throw e;
    }
  }

  async closePosition(symbol, side) {
    try {
      const positions = await this.exchange.fetchPositions([symbol]);
      const pos = positions.find(p => p.symbol === symbol && parseFloat(p.contracts) > 0);
      if (pos) {
        // To close long: 'close_long', to close short: 'close_short'
        return await this.exchange.createOrder(symbol, "market", side, pos.contracts, undefined, {
          reduceOnly: true,
          marginMode: config.MARGIN_MODE,
        });
      }
      return null;
    } catch (e) {
      console.error("Close position error:", e.message);
      return null;
    }
  }

  async getOpenPositions() {
    try {
      return await this.exchange.fetchPositions();
    } catch (e) {
      return [];
    }
  }
}

module.exports = ExchangeClient;
