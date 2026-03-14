# Docker & Hummingbot Monitor

Static dashboard hosted on GitHub Pages that shows:

- Docker status and active containers
- Balances for KuCoin and Gate.io
- Hummingbot trades for KuCoin and Gate.io (via bot history endpoint)
- **KuCoin BTC/USDT trading** with P&L summary, trade heatmap, and daily stats
- **Bot status monitoring** with Markets, Assets, Orders, and inventory tracking
- **Zabbix integration** for real-time alerting and metrics

All sensitive credentials are handled **server-side** via Cloudflare Workers; the GitHub Pages site never sees or stores secrets.

---

## Architecture Overview

- **Frontend**: `eqty.html` and `btc.html` served by GitHub Pages from this repo.
- **Proxy Worker** (`eqty-proxy` / `btc-proxy`): Cloudflare Worker that:
  - Receives requests from the frontend
  - Adds Hummingbot API credentials on the server side
  - Forwards to `https://hummingbot-api.eqty.pro`
  - Returns JSON back to the browser
- **Metrics Worker** (`eqty-metrics`): Cloudflare Worker that checks bot running status via MQTT endpoint
- **KuCoin Fills**: Served directly from the Hummingbot server via a custom FastAPI endpoint (`/kucoin/fills`)
- **Backend**: Hummingbot API running on a non-US VPS, only reachable via authenticated calls from the Workers.

Frontend calls look like:

```text
GitHub Pages (browser)
    → Cloudflare Worker (with secrets)
        → https://hummingbot-api.eqty.pro/...
```

KuCoin trade data flow:

```text
GitHub Pages (browser)
    → Cloudflare Worker (eqty-proxy / btc-proxy)
        → https://hummingbot-api.eqty.pro/kucoin/fills
            → KuCoin API (from non-US server IP)
```

> **Why not call KuCoin directly from Cloudflare?**
> KuCoin blocks US IPs (`error 400302`). Cloudflare Workers always exit from US nodes.
> Routing through the Hummingbot server (hosted in EU) solves this.

---

## Features

### Docker Tab
Shows whether Docker is running (via `/docker/running`).

Lists active containers with:
- Name, Short ID, Status, Image
- MQTT discovered bot badges

Auto-refresh every 120 seconds.

### KuCoin Tab (eqty.html)
- **Bot Balance**: EQTY and USDT balances with UID
- **Bot Status**: Real-time monitoring showing Markets, Assets, Orders, inventory range
- **P&L Summary**: Trade stats with 1D/7D/30D selector
- **Bot Trades**: Fetched via `/bot-orchestration/<BOT_ID>/history`

### Gate.io Tab
Same layout as KuCoin tab with dedicated bot status monitoring and trade history.

### BTC Page (btc.html)
- **KuCoin Balance**: BTC and USDT balances
- **Bot Status**: BTC/USDT bot monitoring
- **P&L Summary**: Spread capture, fees, net P&L with 1D/7D/30D selector
- **KuCoin Trades**: Real exchange fills via `/kucoin/fills` endpoint
- **Activity Heatmap**: Trade activity by day/hour with daily summary table

### Activity Tab
Trade heatmap for KuCoin and Gate.io bots showing activity density across days and hours.

---

## 1. Cloudflare Workers Setup

### 1.1 Prerequisites

```bash
npm install -g wrangler
wrangler login
```

### 1.2 Worker Files

| File | Worker Name | Purpose |
|---|---|---|
| `worker-docker.js` | `btc-proxy` / `eqty-proxy` | Generic proxy to Hummingbot API |
| `worker-metrics-btc.js` | `btc-metrics` | Bot running status for btc.html |
| `worker-metrics-eqty.js` | `eqty-metrics` | Bot running status for eqty.html |

### 1.3 Wrangler Config Files

**`wrangler-docker.toml`** — btc.html proxy:
```toml
name = "btc-proxy"
main = "worker-docker.js"
compatibility_date = "2025-01-01"
account_id = "cloudflare_workers_account_id"
```

**`wrangler-eqty.toml`** — eqty.html proxy:
```toml
name = "eqty-proxy"
main = "worker-docker.js"
compatibility_date = "2025-01-01"
account_id = "cloudflare_workers_account_id"
```

**`wrangler-metrics.toml`** — btc.html metrics:
```toml
name = "btc-metrics"
main = "worker-metrics-btc.js"
compatibility_date = "2025-01-01"
account_id = "cloudflare_workers_account_id"
```

**`wrangler-metrics-eqty.toml`** — eqty.html metrics:
```toml
name = "eqty-metrics"
main = "worker-metrics-eqty.js"
compatibility_date = "2025-01-01"
account_id = "cloudflare_workers_account_id"
```

### 1.4 Deploy All Workers

```bash
# btc.html proxy
wrangler deploy --config wrangler-docker.toml
wrangler secret put API_USERNAME --config wrangler-docker.toml
wrangler secret put API_PASSWORD --config wrangler-docker.toml

# eqty.html proxy
wrangler deploy --config wrangler-eqty.toml
wrangler secret put API_USERNAME --config wrangler-eqty.toml
wrangler secret put API_PASSWORD --config wrangler-eqty.toml

# btc.html metrics
wrangler deploy --config wrangler-metrics.toml
wrangler secret put API_USERNAME --config wrangler-metrics.toml
wrangler secret put API_PASSWORD --config wrangler-metrics.toml

# eqty.html metrics
wrangler deploy --config wrangler-metrics-eqty.toml
wrangler secret put API_USERNAME --config wrangler-metrics-eqty.toml
wrangler secret put API_PASSWORD --config wrangler-metrics-eqty.toml
```

> `API_USERNAME` and `API_PASSWORD` are the Hummingbot API basic auth credentials.

### 1.5 Worker URLs

| Worker | URL |
|---|---|
| `btc-proxy` | `https://btc-proxy.eqtydao.workers.dev` |
| `eqty-proxy` | `https://eqty-proxy.eqtydao.workers.dev` |
| `btc-metrics` | `https://btc-metrics.eqtydao.workers.dev` |
| `eqty-metrics` | `https://eqty-metrics.eqtydao.workers.dev` |

### 1.6 Test Workers

```bash
# Proxy — should return docker status
curl "https://eqty-proxy.eqtydao.workers.dev?endpoint=docker%2Frunning"

# Metrics — should return bot running status
curl "https://eqty-metrics.eqtydao.workers.dev"
# Expected: {"kucoin":{"botrunning":1},"gateio":{"botrunning":1}}
```

---

## 2. KuCoin Fills Endpoint (Hummingbot Server)

KuCoin API is called directly from the Hummingbot server (EU-based) to avoid US IP restrictions.

### 2.1 custom_routes.py

Place this file in `~/hummingbot-api/` on the server:

```python
import hmac, hashlib, base64, time, os
import httpx
from fastapi import APIRouter

router = APIRouter()

KUCOIN_KEY        = os.environ.get("KUCOIN_API_KEY", "")
KUCOIN_SECRET     = os.environ.get("KUCOIN_API_SECRET", "")
KUCOIN_PASSPHRASE = os.environ.get("KUCOIN_API_PASSPHRASE", "")

@router.get("/kucoin/fills")
async def get_fills(symbol: str = "BTC-USDT", days: int = 1):
    if not KUCOIN_KEY:
        return {"error": "KuCoin credentials not configured"}
    now      = int(time.time() * 1000)
    start_at = now - days * 86400 * 1000
    endpoint = f"/api/v1/hf/fills?symbol={symbol}&startAt={start_at}&endAt={now}&limit=100"
    ts       = str(now)
    sign     = base64.b64encode(
        hmac.new(KUCOIN_SECRET.encode(), (ts + "GET" + endpoint).encode(), hashlib.sha256).digest()
    ).decode()
    pphrase  = base64.b64encode(
        hmac.new(KUCOIN_SECRET.encode(), KUCOIN_PASSPHRASE.encode(), hashlib.sha256).digest()
    ).decode()
    headers = {
        "KC-API-KEY": KUCOIN_KEY, "KC-API-SIGN": sign,
        "KC-API-PASSPHRASE": pphrase, "KC-API-TIMESTAMP": ts,
        "KC-API-KEY-VERSION": "2"
    }
    async with httpx.AsyncClient() as client:
        r = await client.get(f"https://api.kucoin.com{endpoint}", headers=headers)
        return r.json()
```

### 2.2 Register in main.py

Add these two lines to `~/hummingbot-api/main.py`:

```python
# With other imports:
from custom_routes import router as custom_router

# With other app.include_router() calls:
app.include_router(custom_router, dependencies=[Depends(auth_user)])
```

### 2.3 Add KuCoin credentials to .env

```bash
echo "KUCOIN_API_KEY=your_key" >> ~/hummingbot-api/.env
echo "KUCOIN_API_SECRET=your_secret" >> ~/hummingbot-api/.env
echo "KUCOIN_API_PASSPHRASE=your_passphrase" >> ~/hummingbot-api/.env
```

### 2.4 Mount files in docker-compose.yml

```yaml
hummingbot-api:
  volumes:
    - ~/hummingbot-api/custom_routes.py:/hummingbot-api/custom_routes.py:ro
    - ~/hummingbot-api/main.py:/hummingbot-api/main.py:ro
  environment:
    - KUCOIN_API_KEY
    - KUCOIN_API_SECRET
    - KUCOIN_API_PASSPHRASE
```

### 2.5 Apply and test

```bash
cd ~/hummingbot-api
docker compose up -d hummingbot-api
sleep 5
curl -u "user:pass" "http://localhost:8000/kucoin/fills?symbol=BTC-USDT&days=1"
```

---

## 3. Frontend (this repo)

### 3.1 eqty.html — API base URLs

```javascript
const API_BASE = 'https://eqty-proxy.eqtydao.workers.dev';
```

```javascript
// Inside fetchBotRunningStatus():
const response = await fetch('https://eqty-metrics.eqtydao.workers.dev');
window.kucoinBotRunning = data.kucoin?.botrunning === 1;
window.gateioBotRunning = data.gateio?.botrunning === 1;
```

### 3.2 btc.html — API base URLs

```javascript
const API_BASE = 'https://btc-proxy.eqtydao.workers.dev';
```

```javascript
// Inside fetchBotRunningStatus():
const response = await fetch('https://btc-metrics.eqtydao.workers.dev');
window.testingBotRunning = data.testing?.botrunning === 1;
```

KuCoin trade data:
```javascript
// loadTradeData and loadActivityBtc use:
const data = await fetchWithAuth(`kucoin/fills?symbol=BTC-USDT&days=${days}`);
const trades = (data?.data?.items || []).map(f => ({
  trade_timestamp: f.createdAt,
  trade_type:      f.side.toUpperCase(),
  price:           f.price,
  quantity:        f.size,
  symbol:          f.symbol,
  market:          'kucoin',
  raw_json:        { trade_fee: { percent: parseFloat(f.feeRate) || 0.001 } }
}));
```

### 3.3 GitHub Pages deployment

A GitHub Action deploys this repo to the `gh-pages` branch.

`.github/workflows/deploy.yml`:

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [ main ]

permissions:
  contents: write

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: peaceiris/actions-gh-pages@v4
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./
```

Configure GitHub Pages:
- Repo → Settings → Pages → Source: `gh-pages` branch

---

## 4. Monitoring Setup (Zabbix Integration)

Monitor your market maker bots in real-time with Zabbix for automated alerting and metrics tracking.

### 4.1 Metrics Worker

The `eqty-metrics` worker returns:

```json
{
  "kucoin": { "botrunning": 1 },
  "gateio": { "botrunning": 1 }
}
```

For richer metrics (portfolio value, inventory %, order counts), the Zabbix HTTP Agent items call the Hummingbot API directly via the `eqty-proxy` worker using the `?endpoint=` pattern.

### 4.2 Zabbix Item Architecture — Dependent Items

Use **1 master HTTP Agent item** per host that fetches the full JSON payload once. All other items are **Dependent items** using JSONPath — no extra requests.

```
Before: 18 HTTP Agent items → 18 Worker calls per cycle
After:   1 HTTP Agent (master) + 18 Dependent items → 1 Worker call per cycle
```

**Master item** (1 per host, HTTP Agent):

| Field | Value |
|---|---|
| **Key** | `bot.metrics.raw` |
| **URL** | `https://eqty-metrics.eqtydao.workers.dev` |
| **Update interval** | 1m |
| **Value type** | Text |

**Dependent items** use JSONPath preprocessing, e.g. `$.kucoin.botrunning`.

### 4.3 Create Hosts

1. **Data collection** → **Hosts** → **Create host**
2. Create hosts: `MM-Bot-KuCoin`, `MM-Bot-GateIO`
3. No interface needed (HTTP agent)

### 4.4 Key Items (per host)

1. **Bot Running** — `$.kucoin.botrunning` (Value map: 0=Stopped, 1=Running)
2. **EQTY Current %** — via proxy endpoint
3. **Is Balanced** — (0=Unbalanced, 1=Balanced)
4. **Total Value USDT**
5. **Active Orders Count**
6. **Mid Price**

### 4.5 Triggers

| Trigger | Severity |
|---|---|
| Bot Stopped (`botrunning=0`) | High |
| Portfolio Critically Unbalanced (EQTY% <31 or >69) | High |
| Approaching Imbalance (EQTY% 31-35 or 65-69) | Warning |
| Few Active Orders (<5 but >0) | Warning |

### 4.6 Value Mappings

- **Bot Status**: 0=Stopped, 1=Running
- **Balance Status**: 0=Unbalanced, 1=Balanced

---

## Exposed Metrics

The `window.eqtyBotMetrics` and `window.gateioMetrics` JavaScript objects expose:

- `eqty_current_pct` — Current EQTY % (31–69% is safe range)
- `usdt_current_pct` — Current USDT %
- `is_balanced` — 1=balanced, 0=unbalanced
- `bot_running` — 1=has orders, 0=stopped
- `total_value_usdt` — Total portfolio value in USDT
- `active_orders_count` — Number of active orders
- `mid_price` — Current market mid price

---

## License

MIT

