import hmac, hashlib, base64, time, os
import httpx
from fastapi import APIRouter

router = APIRouter()

KUCOIN_KEY        = os.environ.get("KUCOIN_API_KEY", "")
KUCOIN_SECRET     = os.environ.get("KUCOIN_API_SECRET", "")
KUCOIN_PASSPHRASE = os.environ.get("KUCOIN_API_PASSPHRASE", "")

def _sign(secret, passphrase, ts, endpoint):
    sign   = base64.b64encode(
        hmac.new(secret.encode(), (ts + "GET" + endpoint).encode(), hashlib.sha256).digest()
    ).decode()
    pphrase = base64.b64encode(
        hmac.new(secret.encode(), passphrase.encode(), hashlib.sha256).digest()
    ).decode()
    return {
        "KC-API-KEY": KUCOIN_KEY, "KC-API-SIGN": sign,
        "KC-API-PASSPHRASE": pphrase, "KC-API-TIMESTAMP": ts,
        "KC-API-KEY-VERSION": "2"
    }

@router.get("/kucoin/fills")
async def get_fills(symbol: str = "BTC-USDT", days: int = 1, account: str = "spot"):
    if not KUCOIN_KEY:
        return {"error": "KuCoin credentials not configured"}

    # HF account uses /hf/fills; regular spot uses /v1/fills
    base_path = "/api/v1/hf/fills" if account == "hf" else "/api/v1/fills"

    window_ms  = 7 * 86400 * 1000   # KuCoin max range per request = 7 days
    now_ms     = int(time.time() * 1000)
    start_ms   = now_ms - days * 86400 * 1000

    all_items = []
    async with httpx.AsyncClient() as client:
        chunk_start = start_ms
        while chunk_start < now_ms:
            chunk_end = min(chunk_start + window_ms, now_ms)
            ts       = str(int(time.time() * 1000))
            endpoint = f"{base_path}?symbol={symbol}&startAt={chunk_start}&endAt={chunk_end}&limit=100"
            headers  = _sign(KUCOIN_SECRET, KUCOIN_PASSPHRASE, ts, endpoint)
            r        = await client.get(f"https://api.kucoin.com{endpoint}", headers=headers)
            data     = r.json()
            items    = (data.get("data") or {}).get("items") or []
            all_items.extend(items)
            chunk_start = chunk_end

    return {"code": "200000", "data": {"items": all_items}}

