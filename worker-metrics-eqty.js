// worker-metrics-eqty.js
// Cloudflare Worker — EQTY metrics endpoint (replaces Vercel api/metrics.js)
// Deploy as a Worker, bind secrets: API_USERNAME, API_PASSWORD

const ALLOWED_ORIGINS = [
  'https://zolpho.github.io',
  'https://eqty-dao.github.io',
  'https://eqty.me'
];

const API_BASE      = 'https://hummingbot-api.eqty.pro';
const KUCOIN_BOT    = 'ea5d7b611fd1da6ad5bffd559bac3c0ed6ed11d0';
const GATEIO_BOT    = 'da6132e324292f6f7b914b58333808506f741db0';
const PAIR          = 'EQTY-USDT';

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
    const corsHeaders = {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 200, headers: corsHeaders });
    }

    const { API_USERNAME: user, API_PASSWORD: pass } = env;
    if (!user || !pass) {
      return Response.json({ error: 'API credentials not configured' }, { status: 500, headers: corsHeaders });
    }

    const auth = btoa(`${user}:${pass}`);

    try {
      const [kucoinData, gateioData] = await Promise.all([
        getEqtyMetrics(auth, KUCOIN_BOT, 'kucoin',  'cex_mm_kucoin', 'kucoin'),
        getEqtyMetrics(auth, GATEIO_BOT, 'gate_io', 'cex_mm_gate',   'gate_io'),
      ]);

      return Response.json({
        timestamp: Math.floor(Date.now() / 1000),
        kucoin: kucoinData,
        gateio: gateioData,
      }, { headers: corsHeaders });

    } catch (error) {
      return Response.json({
        error: error.message,
        timestamp: Math.floor(Date.now() / 1000),
        kucoin: getErrorMetrics(),
        gateio: getErrorMetrics(),
      }, { status: 500, headers: corsHeaders });
    }
  }
};

async function getEqtyMetrics(auth, botId, connector, accountName, portfolioKey) {
  const headers = { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' };

  try {
    const [statusRes, obRes, portfolioRes] = await Promise.all([
      fetch(`${API_BASE}/bot-orchestration/${botId}/status`, { headers }),
      fetch(`${API_BASE}/market-data/order-book`, {
        method: 'POST', headers,
        body: JSON.stringify({ connector_name: connector, trading_pair: PAIR })
      }),
      fetch(`${API_BASE}/portfolio/state`, {
        method: 'POST', headers,
        body: JSON.stringify({
          account_names: [accountName],
          connector_names: [portfolioKey],
          skip_gateway: false,
          refresh: true
        })
      })
    ]);

    const [statusData, orderBook, portfolioData] = await Promise.all([
      statusRes.json(), obRes.json(), portfolioRes.json()
    ]);

    const logs     = statusData?.data?.general_logs || [];
    const orders   = parseActiveOrders(logs, PAIR);
    const bestBid  = orderBook?.bids?.[0]?.price || 0;
    const bestAsk  = orderBook?.asks?.[0]?.price || 0;
    const midPrice = (parseFloat(bestBid) + parseFloat(bestAsk)) / 2;
    const balances = portfolioData?.[accountName]?.[portfolioKey] || [];
    const assets   = calculateAssetMetrics(balances, midPrice);

    const buyOrders  = orders.filter(o => o.side.toUpperCase() === 'BUY').length;
    const sellOrders = orders.filter(o => o.side.toUpperCase() === 'SELL').length;

    return {
      ...assets,
      mid_price:           midPrice,
      best_bid:            bestBid,
      best_ask:            bestAsk,
      active_orders_count: buyOrders + sellOrders,
      buy_orders_count:    buyOrders,
      sell_orders_count:   sellOrders,
      bot_running:         statusData?.data?.recently_active ? 1 : 0,
      recently_active:     statusData?.data?.recently_active ? 1 : 0,
    };

  } catch (error) {
    return getErrorMetrics();
  }
}

function parseActiveOrders(logs, pair) {
  const escapedPair    = pair.replace('-', '\\-');
  const createPattern  = new RegExp(`Created (LIMIT_MAKER|LIMIT) (BUY|SELL) order (\\S+) for ([\\d.]+) ${escapedPair} at ([\\d.]+)`);
  const cancelPattern  = /Cancelled order (\S+)/;
  const fillPattern    = /Filled ([\d.]+) out of ([\d.]+) of the (BUY|SELL) order (\S+)/;

  const activeOrders   = new Map();
  const cancelledOrders = new Set();

  for (const log of logs) {
    const msg = log.msg || '';
    const cancelMatch = msg.match(cancelPattern);
    if (cancelMatch) cancelledOrders.add(cancelMatch[1]);
    const fillMatch = msg.match(fillPattern);
    if (fillMatch && parseFloat(fillMatch[1]) === parseFloat(fillMatch[2])) {
      cancelledOrders.add(fillMatch[4]);
    }
  }

  const recentLogs = logs.slice(-50);
  for (let i = recentLogs.length - 1; i >= 0; i--) {
    const match = (recentLogs[i].msg || '').match(createPattern);
    if (match) {
      const [, , side, orderId, amount, price] = match;
      if (!cancelledOrders.has(orderId) && !activeOrders.has(orderId)) {
        activeOrders.set(orderId, { side, price: parseFloat(price), orderId, amount: parseFloat(amount) });
        if (activeOrders.size >= 15) break;
      }
    }
  }

  return Array.from(activeOrders.values());
}

function calculateAssetMetrics(balances, midPrice) {
  const eqtyBal = balances.find(b => b.token === 'EQTY') || {};
  const usdtBal = balances.find(b => b.token === 'USDT') || {};

  const eqtyTotal     = parseFloat(eqtyBal.units) || 0;
  const eqtyAvailable = parseFloat(eqtyBal.available_units) || 0;
  const usdtTotal     = parseFloat(usdtBal.units) || 0;
  const usdtAvailable = parseFloat(usdtBal.available_units) || 0;

  const eqtyValue  = eqtyTotal * midPrice;
  const totalValue = eqtyValue + usdtTotal;
  const eqtyPct    = totalValue > 0 ? (eqtyValue / totalValue) * 100 : 0;
  const usdtPct    = totalValue > 0 ? (usdtTotal / totalValue) * 100 : 0;
  const target     = totalValue / 2;

  return {
    eqty_current_pct:   eqtyPct,
    usdt_current_pct:   usdtPct,
    eqty_order_adjust:  eqtyValue > 0 ? (target / eqtyValue) * 100 : 100,
    usdt_order_adjust:  usdtTotal > 0 ? (target / usdtTotal) * 100 : 100,
    is_balanced:        (eqtyPct >= 31 && eqtyPct <= 69) ? 1 : 0,
    total_value_usdt:   totalValue,
    eqty_total:         eqtyTotal,
    eqty_available:     eqtyAvailable,
    usdt_total:         usdtTotal,
    usdt_available:     usdtAvailable,
  };
}

function getErrorMetrics() {
  return {
    eqty_current_pct: 0, usdt_current_pct: 0, eqty_order_adjust: 100, usdt_order_adjust: 100,
    is_balanced: 0, total_value_usdt: 0, eqty_total: 0, eqty_available: 0,
    usdt_total: 0, usdt_available: 0, mid_price: 0, best_bid: 0, best_ask: 0,
    active_orders_count: 0, buy_orders_count: 0, sell_orders_count: 0,
    bot_running: 0, recently_active: 0,
  };
}

