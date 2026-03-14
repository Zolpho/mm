// worker-metrics-eqty.js
// Returns {kucoin: {botrunning: 0/1}, gateio: {botrunning: 0/1}}
// Checks MQTT discovered/active bots from hummingbot-api

const API_BASE     = 'https://hummingbot-api.eqty.pro';
const KUCOIN_BOT   = 'ea5d7b611fd1da6ad5bffd559bac3c0ed6ed11d0';
const GATEIO_BOT   = 'da6132e324292f6f7b914b58333808506f741db0';

const ALLOWED_ORIGINS = [
  'https://zolpho.github.io',
  'https://eqty-dao.github.io',
  'https://eqty.me',
];

export default {
  async fetch(request, env) {
    const origin        = request.headers.get('Origin') || '';
    const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
    const corsHeaders   = {
      'Access-Control-Allow-Origin':  allowedOrigin,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 200, headers: corsHeaders });
    }

    const auth = btoa(`${env.API_USERNAME}:${env.API_PASSWORD}`);

    try {
      const res  = await fetch(`${API_BASE}/bot-orchestration/mqtt`, {
        headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' },
      });
      const raw  = await res.json();
      const d    = raw?.data ?? raw;

      // Normalise — API may return snake_case or camelCase
      const discovered = d?.discovered_bots ?? d?.discoveredbots ?? [];
      const active     = d?.active_bots     ?? d?.activebots     ?? [];
      const all        = [...new Set([...discovered, ...active])];

      const isRunning = (botId) =>
        all.some(b => typeof b === 'string' && (b === botId || b.startsWith(botId.slice(0, 8))));

      return Response.json({
        kucoin: { botrunning: isRunning(KUCOIN_BOT) ? 1 : 0 },
        gateio: { botrunning: isRunning(GATEIO_BOT) ? 1 : 0 },
      }, { headers: corsHeaders });

    } catch (err) {
      // Never crash — return 0 so UI shows Stopped rather than erroring
      return Response.json({
        kucoin: { botrunning: 0 },
        gateio: { botrunning: 0 },
      }, { status: 200, headers: corsHeaders });
    }
  },
};

