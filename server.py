#!/usr/bin/env python3
"""Local Stock Hermes web server.

Serves the static prototype, provides a small username/password login system,
and proxies /api/ask to the same OpenAI-compatible model configured for the
current Hermes profile. API keys stay on the server and are never exposed to the
browser.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import time
from datetime import date, datetime, timedelta
from http import cookies
from concurrent.futures import ThreadPoolExecutor, as_completed
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib import error, request
from urllib.parse import parse_qs, urlparse

try:
    import yaml
except Exception:  # pragma: no cover
    yaml = None

ROOT = Path(__file__).resolve().parent
HERMES_HOME = Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes"))
CONFIG_PATH = HERMES_HOME / "config.yaml"
DB_PATH = ROOT / "stock_hermes.db"
ENV_PATH = ROOT / ".env"
SESSION_TTL_SECONDS = 60 * 60 * 24 * 14
PBKDF2_ITERATIONS = 260_000


def load_dotenv() -> None:
    if not ENV_PATH.exists():
        return
    for raw_line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


load_dotenv()


def db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db() -> None:
    with db() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                balance_cents INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL
            )
            """
        )
        user_columns = {row["name"] for row in conn.execute("PRAGMA table_info(users)")}
        if "balance_cents" not in user_columns:
            conn.execute("ALTER TABLE users ADD COLUMN balance_cents INTEGER NOT NULL DEFAULT 0")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                created_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS chat_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                market TEXT NOT NULL,
                role TEXT NOT NULL,
                text TEXT NOT NULL,
                ticker TEXT,
                favorite INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_chat_user_market_id ON chat_messages(user_id, market, id)")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS concepts (
                term TEXT PRIMARY KEY,
                definition TEXT NOT NULL,
                simple TEXT NOT NULL,
                why_important TEXT NOT NULL,
                related TEXT NOT NULL DEFAULT '[]',
                source TEXT NOT NULL DEFAULT 'ai',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )
            """
        )


def hash_password(password: str, salt: str | None = None) -> str:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("ascii"),
        PBKDF2_ITERATIONS,
    ).hex()
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt}${digest}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, iterations, salt, expected = stored.split("$", 3)
        if scheme != "pbkdf2_sha256":
            return False
        digest = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            salt.encode("ascii"),
            int(iterations),
        ).hex()
        return hmac.compare_digest(digest, expected)
    except Exception:
        return False


def normalize_username(username: str) -> str:
    username = (username or "").strip().lower()
    if not 3 <= len(username) <= 32:
        raise ValueError("用户名长度需要 3-32 位")
    allowed = set("abcdefghijklmnopqrstuvwxyz0123456789_-@.")
    if any(ch not in allowed for ch in username):
        raise ValueError("用户名只能包含字母、数字、下划线、短横线、点或 @")
    return username


def validate_password(password: str) -> None:
    if len(password or "") < 6:
        raise ValueError("密码至少 6 位")
    if len(password) > 200:
        raise ValueError("密码过长")


def cents_to_usd(cents: int) -> str:
    return f"{max(0, int(cents)) / 100:.2f}"


def parse_usd_to_cents(value: Any) -> int:
    raw = str(value or "").strip().replace("$", "").replace(",", "")
    if not raw:
        raise ValueError("请输入入金金额")
    try:
        cents = round(float(raw) * 100)
    except ValueError as exc:
        raise ValueError("入金金额格式不正确") from exc
    if cents <= 0:
        raise ValueError("入金金额必须大于 0")
    if cents > 1_000_000:
        raise ValueError("单次入金不能超过 $10,000")
    return cents


def billing_payload(user_id: int) -> dict[str, Any]:
    with db() as conn:
        row = conn.execute("SELECT balance_cents FROM users WHERE id = ?", (user_id,)).fetchone()
    balance_cents = int(row["balance_cents"] if row else 0)
    return {
        "ok": True,
        "currency": "USD",
        "balanceCents": balance_cents,
        "balanceUsd": cents_to_usd(balance_cents),
        "purpose": "用于调用 gpt-5.5 分析股票时展示你的可用美元余额",
    }


def add_user_balance(user_id: int, amount_cents: int) -> dict[str, Any]:
    now = int(time.time())
    with db() as conn:
        conn.execute(
            "UPDATE users SET balance_cents = balance_cents + ? WHERE id = ?",
            (amount_cents, user_id),
        )
        row = conn.execute("SELECT balance_cents FROM users WHERE id = ?", (user_id,)).fetchone()
    balance_cents = int(row["balance_cents"] if row else 0)
    return {
        "ok": True,
        "currency": "USD",
        "addedCents": amount_cents,
        "addedUsd": cents_to_usd(amount_cents),
        "balanceCents": balance_cents,
        "balanceUsd": cents_to_usd(balance_cents),
        "updatedAt": now,
    }


def create_session(user_id: int) -> str:
    now = int(time.time())
    token = secrets.token_urlsafe(32)
    with db() as conn:
        conn.execute("DELETE FROM sessions WHERE expires_at < ?", (now,))
        conn.execute(
            "INSERT INTO sessions(token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
            (token, user_id, now, now + SESSION_TTL_SECONDS),
        )
    return token


def hermes_model_config() -> dict[str, str]:
    cfg: dict[str, Any] = {}
    if CONFIG_PATH.exists() and yaml:
        cfg = yaml.safe_load(CONFIG_PATH.read_text(encoding="utf-8")) or {}

    model_cfg = cfg.get("model") or {}
    model = model_cfg.get("default") or "gpt-5.5"
    base_url = model_cfg.get("base_url") or ""
    api_key = model_cfg.get("api_key") or ""
    provider = model_cfg.get("provider") or "current"
    return {
        "model": str(model),
        "base_url": str(base_url).rstrip("/"),
        "api_key": str(api_key),
        "provider": str(provider),
    }


def load_model_configs() -> list[dict[str, str]]:
    hermes_cfg = hermes_model_config()
    primary = {
        "model": os.environ.get("STOCK_HERMES_MODEL") or hermes_cfg["model"],
        "base_url": (os.environ.get("STOCK_HERMES_BASE_URL") or hermes_cfg["base_url"]).rstrip("/"),
        "api_key": os.environ.get("STOCK_HERMES_API_KEY") or hermes_cfg["api_key"],
        "provider": os.environ.get("STOCK_HERMES_PROVIDER") or hermes_cfg["provider"],
    }
    fallback = {
        "model": os.environ.get("STOCK_HERMES_FALLBACK_MODEL") or hermes_cfg["model"],
        "base_url": (os.environ.get("STOCK_HERMES_FALLBACK_BASE_URL") or hermes_cfg["base_url"]).rstrip("/"),
        "api_key": os.environ.get("STOCK_HERMES_FALLBACK_API_KEY") or hermes_cfg["api_key"],
        "provider": os.environ.get("STOCK_HERMES_FALLBACK_PROVIDER") or hermes_cfg["provider"],
    }
    configs = [primary]
    if fallback["model"] != primary["model"] or fallback["base_url"] != primary["base_url"]:
        configs.append(fallback)
    for cfg in configs:
        if not cfg["base_url"]:
            raise RuntimeError(f"未配置模型 base_url；请设置 STOCK_HERMES_BASE_URL 或 {CONFIG_PATH} 的 model.base_url")
        if not cfg["api_key"]:
            raise RuntimeError(f"未配置模型 api_key；请设置 STOCK_HERMES_API_KEY 或 {CONFIG_PATH} 的 model.api_key")
    return configs


def load_model_config() -> dict[str, str]:
    return load_model_configs()[0]


def file_meta(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"path": str(path), "exists": False}
    stat = path.stat()
    return {
        "path": str(path),
        "exists": True,
        "size": stat.st_size,
        "modifiedAt": int(stat.st_mtime),
    }


def table_count(conn: sqlite3.Connection, table: str) -> int:
    try:
        return int(conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])
    except Exception:
        return 0


def env_quote(value: str) -> str:
    return json.dumps(str(value), ensure_ascii=False)


USER_MEMORY_DIR = Path("user_memories")  # relative to HERMES_HOME / bot dir
USER_MEMORY_FILES = ["MEMORY.md", "USER.md"]


def user_memory_base(user_id: int) -> Path:
    return HERMES_HOME / USER_MEMORY_DIR / str(user_id)


def resolve_user_memory_path(user_id: int, rel_path: str) -> Path | None:
    """Resolve a per-user memory path, validate it stays within the user's dir."""
    clean = Path(rel_path.strip().lstrip("/")).name
    if clean not in USER_MEMORY_FILES:
        return None
    return user_memory_base(user_id) / clean


def read_memory_file_for_user(user_id: int, rel_path: str) -> dict[str, Any] | None:
    full = resolve_user_memory_path(user_id, rel_path)
    if not full or not full.exists():
        return None
    stat = full.stat()
    content = full.read_text(encoding="utf-8", errors="replace")
    size = len(content.encode("utf-8"))
    return {
        "path": rel_path,
        "absPath": str(full),
        "content": content,
        "size": size,
        "modifiedAt": int(stat.st_mtime),
        "lineCount": content.count("\n") + 1,
    }


def write_memory_file_for_user(user_id: int, rel_path: str, content: str) -> dict[str, Any] | None:
    full = resolve_user_memory_path(user_id, rel_path)
    if not full:
        return None
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_text(content, encoding="utf-8")
    try:
        os.chmod(full, 0o600)
    except Exception:
        pass
    stat = full.stat()
    return {
        "path": rel_path,
        "absPath": str(full),
        "content": content,
        "size": len(content.encode("utf-8")),
        "modifiedAt": int(stat.st_mtime),
        "lineCount": content.count("\n") + 1,
    }


def write_project_env(updates: dict[str, str]) -> None:
    existing_lines = ENV_PATH.read_text(encoding="utf-8").splitlines() if ENV_PATH.exists() else []
    seen: set[str] = set()
    new_lines: list[str] = []
    for raw_line in existing_lines:
        stripped = raw_line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            new_lines.append(raw_line)
            continue
        key = stripped.split("=", 1)[0].strip()
        if key in updates:
            new_lines.append(f"{key}={env_quote(updates[key])}")
            seen.add(key)
        else:
            new_lines.append(raw_line)
    if updates:
        if new_lines and new_lines[-1].strip():
            new_lines.append("")
        for key, value in updates.items():
            if key not in seen:
                new_lines.append(f"{key}={env_quote(value)}")
    ENV_PATH.write_text("\n".join(new_lines).rstrip() + "\n", encoding="utf-8")
    try:
        os.chmod(ENV_PATH, 0o600)
    except Exception:
        pass
    for key, value in updates.items():
        os.environ[key] = value


def hermes_settings_payload(user: dict[str, Any]) -> dict[str, Any]:
    configs = load_model_configs()
    default_memory_dir = HERMES_HOME / "memories"
    fenxi_memory_dir = HERMES_HOME / "bots" / "fenxi" / "memories"
    project_env_keys = [
        "STOCK_HERMES_MODEL",
        "STOCK_HERMES_PROVIDER",
        "STOCK_HERMES_BASE_URL",
        "STOCK_HERMES_API_KEY",
        "STOCK_HERMES_FALLBACK_MODEL",
        "STOCK_HERMES_FALLBACK_PROVIDER",
        "STOCK_HERMES_FALLBACK_BASE_URL",
        "STOCK_HERMES_FALLBACK_API_KEY",
    ]
    with db() as conn:
        stats = {
            "users": table_count(conn, "users"),
            "sessions": table_count(conn, "sessions"),
            "chatMessages": table_count(conn, "chat_messages"),
            "concepts": table_count(conn, "concepts"),
        }
    return {
        "ok": True,
        "user": {"id": int(user["id"]), "username": user["username"]},
        "hermes": {
            "home": str(HERMES_HOME),
            "configPath": str(CONFIG_PATH),
            "configExists": CONFIG_PATH.exists(),
            "profile": os.environ.get("HERMES_PROFILE") or "default",
        },
        "modelRouting": [
            {
                "role": "primary" if idx == 0 else "fallback",
                "model": cfg["model"],
                "provider": cfg["provider"],
                "baseUrlConfigured": bool(cfg["base_url"]),
                "baseUrl": cfg["base_url"],
                "apiKeyConfigured": bool(cfg["api_key"]),
            }
            for idx, cfg in enumerate(configs)
        ],
        "storage": {
            "browserShortTermKey": "stockHermesState.v1",
            "projectDb": file_meta(DB_PATH),
            "projectDbStats": stats,
            "projectEnv": file_meta(ENV_PATH),
            "projectEnvKeys": {key: bool(os.environ.get(key)) for key in project_env_keys},
        },
        "memories": {
            "appShortTerm": "浏览器 localStorage 的 stockHermesState.v1，保存股票池、偏好、最近聊天和概念标注模式。",
            "appLongTerm": "项目 SQLite：chat_messages 保存历史问答，concepts 保存投资概念解释。",
            "hermesDefaultMemory": {
                "memory": file_meta(default_memory_dir / "MEMORY.md"),
                "user": file_meta(default_memory_dir / "USER.md"),
            },
            "fenxiBotMemory": {
                "memory": file_meta(fenxi_memory_dir / "MEMORY.md"),
                "user": file_meta(fenxi_memory_dir / "USER.md"),
            },
        },
    }


def chat_completion(cfg: dict[str, str], messages: list[dict[str, str]], max_tokens: int = 900, temperature: float = 0.4) -> str:
    body = {
        "model": cfg["model"],
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    data = json.dumps(body).encode("utf-8")
    req = request.Request(
        cfg["base_url"].rstrip("/") + "/chat/completions",
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "Hermes-Agent/1.0 Stock-Hermes/0.5",
            "Authorization": f"Bearer {cfg['api_key']}",
        },
    )
    try:
        with request.urlopen(req, timeout=90) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:1200]
        raise RuntimeError(f"模型 {cfg['model']} 返回 HTTP {exc.code}: {detail}") from exc
    except Exception as exc:
        raise RuntimeError(f"模型 {cfg['model']} 调用失败: {exc}") from exc

    parsed = json.loads(raw)
    return parsed["choices"][0]["message"]["content"].strip()


def chat_completion_with_fallback(messages: list[dict[str, str]], max_tokens: int = 900, temperature: float = 0.4) -> tuple[str, dict[str, str]]:
    errors: list[str] = []
    for cfg in load_model_configs():
        try:
            return chat_completion(cfg, messages, max_tokens=max_tokens, temperature=temperature), cfg
        except Exception as exc:
            errors.append(str(exc))
    raise RuntimeError("；".join(errors))


def call_model(payload: dict[str, Any]) -> str:
    question = str(payload.get("question") or "").strip()
    state = payload.get("state") or {}
    preferences = state.get("preferences") or {}
    template = state.get("template") or "balanced-research"
    market_label = state.get("activeMarketLabel") or state.get("activeMarket") or "当前"

    # 用户的 watchlist（股票池）不再注入 prompt——只是用户本地查看用。
    # 问答应该独立于 watchlist，用户问题里提到了具体股票才结合该股票讨论。

    system = """你是 Stock Hermes，一个中文股票研究助手。
你的定位：帮助用户做研究、拆风险、列假设、整理下一步验证问题；不要给出直接买入/卖出指令，不承诺收益。
回答风格：中文、具体、可执行、少废话。
不要假设用户有任何持仓或正在跟踪的股票；用户问题中提到了具体股票代码/公司名才结合该股票讨论，没提到就当作通用问题回答。
如果数据是页面模拟数据或不足，要明确说明需要进一步验证真实行情/财报/新闻。"""

    user = f"""用户问题：{question}

用户当前研究偏好（投资周期/风险承受/分析风格）：
{json.dumps(preferences, ensure_ascii=False)}

当前研究模板：{template}

用户当前正在查看的市场：{market_label}

请直接回答用户问题。结尾用一句话提醒：以上是研究辅助，不是买卖建议。"""

    answer, _used_cfg = chat_completion_with_fallback(
        [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        max_tokens=4000,
        temperature=0.4,
    )
    return answer


def fetch_quotes(symbols: list[str]) -> list[dict[str, Any]]:
    """Fetch delayed real market quotes from Nasdaq's public quote endpoint."""
    cleaned: list[str] = []
    for symbol in symbols[:20]:
        ticker = "".join(ch for ch in str(symbol).upper().strip() if ch.isalnum() or ch in ".-")[:12]
        if ticker and ticker not in cleaned:
            cleaned.append(ticker)
    if not cleaned:
        return []

    results: list[dict[str, Any]] = []
    for ticker in cleaned:
        url = f"https://api.nasdaq.com/api/quote/{ticker}/info?assetclass=stocks"
        req = request.Request(
            url,
            headers={
                "Accept": "application/json, text/plain, */*",
                "User-Agent": "Mozilla/5.0 Stock-Hermes/0.4",
                "Referer": "https://www.nasdaq.com/",
                "Origin": "https://www.nasdaq.com",
            },
        )
        try:
            with request.urlopen(req, timeout=18) as resp:
                raw = resp.read().decode("utf-8", errors="replace")
            parsed = json.loads(raw)
            primary = ((parsed.get("data") or {}).get("primaryData") or {})
            company = ((parsed.get("data") or {}).get("companyName") or ticker)
            price_text = str(primary.get("lastSalePrice") or "").replace("$", "").replace(",", "").strip()
            change_text = str(primary.get("percentageChange") or "").replace("%", "").replace(",", "").strip()
            net_change_text = str(primary.get("netChange") or "").replace("$", "").replace(",", "").strip()
            volume_text = str(primary.get("volume") or "").replace(",", "").strip()
            try:
                price = float(price_text)
            except Exception:
                price = None
            try:
                change_percent = float(change_text)
            except Exception:
                change_percent = None
            try:
                net_change = float(net_change_text)
            except Exception:
                net_change = None
            try:
                volume = int(volume_text)
            except Exception:
                volume = None

            results.append(
                {
                    "ticker": ticker,
                    "name": company,
                    "price": price,
                    "change": change_percent,
                    "netChange": net_change,
                    "volume": volume,
                    "lastTradeTimestamp": primary.get("lastTradeTimestamp"),
                    "isRealTime": bool(primary.get("isRealTime")),
                    "source": "Nasdaq delayed quote",
                    "ok": price is not None,
                }
            )
        except Exception as exc:
            results.append({"ticker": ticker, "ok": False, "error": str(exc), "source": "Nasdaq delayed quote"})
    return results


def clean_earnings_date(value: str | None, fallback: date | None = None) -> date:
    fallback = fallback or date.today()
    if not value:
        return fallback
    try:
        return datetime.strptime(str(value).strip()[:10], "%Y-%m-%d").date()
    except Exception:
        return fallback


SEC_TICKER_MAP_CACHE: dict[str, Any] = {"loaded_at": 0.0, "symbols": {}}
SEC_TICKER_MAP_TTL = 60 * 60 * 24
SEC_FORMS_PRIORITY = {"6-K", "20-F", "10-Q", "10-K", "8-K"}


def sec_user_agent() -> str:
    return os.environ.get("STOCK_HERMES_SEC_USER_AGENT", "StockHermes/0.1 contact@example.com")


def fetch_json_url(url: str, timeout: int = 15) -> dict[str, Any]:
    req = request.Request(url, headers={"Accept": "application/json", "User-Agent": sec_user_agent()})
    with request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8", errors="replace")
    return json.loads(raw)


def sec_ticker_map() -> dict[str, dict[str, Any]]:
    now = time.time()
    if SEC_TICKER_MAP_CACHE["symbols"] and now - float(SEC_TICKER_MAP_CACHE["loaded_at"]) < SEC_TICKER_MAP_TTL:
        return SEC_TICKER_MAP_CACHE["symbols"]
    data = fetch_json_url("https://www.sec.gov/files/company_tickers.json")
    symbols: dict[str, dict[str, Any]] = {}
    for item in data.values():
        ticker = str(item.get("ticker") or "").upper().strip()
        cik = str(item.get("cik_str") or "").zfill(10)
        if ticker and cik:
            symbols[ticker] = {"ticker": ticker, "cik": cik, "title": item.get("title") or ""}
    SEC_TICKER_MAP_CACHE["symbols"] = symbols
    SEC_TICKER_MAP_CACHE["loaded_at"] = now
    return symbols


def latest_sec_filing(symbol: str) -> dict[str, Any]:
    ticker = (symbol or "").upper().strip()
    if not ticker:
        return {"ok": False, "error": "missing symbol"}
    entry = sec_ticker_map().get(ticker)
    if not entry:
        return {"ok": False, "symbol": ticker, "fallbackUrl": sec_search_url(ticker), "error": "symbol not found in SEC ticker map"}

    cik = entry["cik"]
    data = fetch_json_url(f"https://data.sec.gov/submissions/CIK{cik}.json")
    recent = (data.get("filings") or {}).get("recent") or {}
    forms = recent.get("form") or []
    accession_numbers = recent.get("accessionNumber") or []
    primary_docs = recent.get("primaryDocument") or []
    filing_dates = recent.get("filingDate") or []
    report_dates = recent.get("reportDate") or []

    for idx, form in enumerate(forms):
        form_name = str(form or "").upper().strip()
        if form_name not in SEC_FORMS_PRIORITY:
            continue
        accession = str(accession_numbers[idx] or "") if idx < len(accession_numbers) else ""
        primary_doc = str(primary_docs[idx] or "") if idx < len(primary_docs) else ""
        if not accession or not primary_doc:
            continue
        accession_path = accession.replace("-", "")
        filing_url = f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{accession_path}/{primary_doc}"
        index_url = f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{accession_path}/"
        return {
            "ok": True,
            "symbol": ticker,
            "company": data.get("name") or entry.get("title") or "",
            "cik": cik,
            "form": form_name,
            "filingDate": filing_dates[idx] if idx < len(filing_dates) else "",
            "reportDate": report_dates[idx] if idx < len(report_dates) else "",
            "accessionNumber": accession,
            "document": primary_doc,
            "url": filing_url,
            "indexUrl": index_url,
            "fallbackUrl": sec_search_url(ticker),
            "source": "SEC EDGAR submissions",
        }

    return {
        "ok": False,
        "symbol": ticker,
        "company": data.get("name") or entry.get("title") or "",
        "cik": cik,
        "fallbackUrl": sec_search_url(ticker),
        "error": "no recent earnings-related SEC filing found",
    }


def sec_search_url(symbol: str) -> str:
    ticker = (symbol or "").upper().strip()
    return f"https://www.sec.gov/edgar/search/#/q={ticker}&category=custom&forms=6-K%252C20-F%252C10-Q%252C10-K%252C8-K"


def clean_earnings_row(row: dict[str, Any], target_date: date) -> dict[str, Any]:
    symbol = str(row.get("symbol") or "").strip().upper()
    company = str(row.get("name") or row.get("companyName") or symbol).strip()
    raw_time = str(row.get("time") or "").strip()
    time_label_map = {
        "time-pre-market": "盘前",
        "time-after-hours": "盘后",
        "time-not-supplied": "未注明",
        "pre-market": "盘前",
        "after-hours": "盘后",
    }
    time_label = time_label_map.get(raw_time, raw_time or "未注明")
    return {
        "date": target_date.isoformat(),
        "symbol": symbol,
        "name": company,
        "time": raw_time or "time-not-supplied",
        "timeLabel": time_label,
        "epsForecast": row.get("epsForecast") or "",
        "eps": row.get("eps"),
        "fiscalQuarterEnding": row.get("fiscalQuarterEnding") or "",
        "marketCap": row.get("marketCap") or "",
        "source": "Nasdaq earnings calendar",
    }


def fetch_earnings_for_date(target_date: date) -> dict[str, Any]:
    url = f"https://api.nasdaq.com/api/calendar/earnings?date={target_date.isoformat()}"
    req = request.Request(
        url,
        headers={
            "Accept": "application/json, text/plain, */*",
            "User-Agent": "Mozilla/5.0 Stock-Hermes/0.5",
            "Referer": "https://www.nasdaq.com/",
            "Origin": "https://www.nasdaq.com",
        },
    )
    try:
        with request.urlopen(req, timeout=18) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
        parsed = json.loads(raw)
        data = parsed.get("data") or {}
        rows = data.get("rows") or []
        cleaned = [clean_earnings_row(row, target_date) for row in rows if isinstance(row, dict) and row.get("symbol")]
        return {
            "date": target_date.isoformat(),
            "asOf": data.get("asOf") or target_date.isoformat(),
            "ok": True,
            "count": len(cleaned),
            "rows": cleaned,
        }
    except Exception as exc:
        return {"date": target_date.isoformat(), "ok": False, "error": str(exc), "count": 0, "rows": []}


def fetch_earnings_window(days_back: int = 7, days_forward: int = 7, anchor: date | None = None) -> dict[str, Any]:
    anchor = anchor or date.today()
    days_back = min(max(int(days_back), 0), 30)
    days_forward = min(max(int(days_forward), 0), 30)
    start = anchor - timedelta(days=days_back)
    end = anchor + timedelta(days=days_forward)
    all_dates = []
    current = start
    while current <= end:
        all_dates.append(current)
        current += timedelta(days=1)

    with ThreadPoolExecutor(max_workers=10) as pool:
        day_results = list(pool.map(fetch_earnings_for_date, all_dates))

    rows = [row for day in day_results for row in day.get("rows", [])]
    return {
        "ok": True,
        "source": "Nasdaq earnings calendar",
        "anchorDate": anchor.isoformat(),
        "startDate": start.isoformat(),
        "endDate": end.isoformat(),
        "daysBack": days_back,
        "daysForward": days_forward,
        "total": len(rows),
        "rows": rows,
    }


def clean_market(value: str) -> str:
    market = (value or "us").strip().lower()
    return market if market in {"us", "hk", "cn"} else "us"

def clean_role(value: str) -> str:
    role = (value or "agent").strip().lower()
    return role if role in {"user", "agent"} else "agent"

def chat_row(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "market": row["market"],
        "type": row["role"],
        "text": row["text"],
        "ticker": row["ticker"],
        "favorite": bool(row["favorite"]),
        "createdAt": row["created_at"],
    }

def load_chat_messages(user_id: int, market: str, limit: int = 80, favorite_only: bool = False) -> list[dict[str, Any]]:
    where = "user_id = ? AND market = ?"
    params: list[Any] = [user_id, clean_market(market)]
    if favorite_only:
        where += " AND favorite = 1"
    with db() as conn:
        rows = conn.execute(
            f"SELECT * FROM chat_messages WHERE {where} ORDER BY id DESC LIMIT ?",
            (*params, limit),
        ).fetchall()
    return [chat_row(row) for row in reversed(rows)]

def save_chat_message(user_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    market = clean_market(str(payload.get("market") or "us"))
    role = clean_role(str(payload.get("type") or payload.get("role") or "agent"))
    text = str(payload.get("text") or "").strip()
    if not text:
        raise ValueError("消息内容不能为空")
    if len(text) > 30_000:
        text = text[:30_000] + "\n…（已截断）"
    ticker = str(payload.get("ticker") or "").strip().upper()[:20] or None
    favorite = 1 if payload.get("favorite") else 0
    now = int(time.time())
    with db() as conn:
        cur = conn.execute(
            "INSERT INTO chat_messages(user_id, market, role, text, ticker, favorite, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (user_id, market, role, text, ticker, favorite, now),
        )
        row = conn.execute("SELECT * FROM chat_messages WHERE id = ?", (int(cur.lastrowid),)).fetchone()
    return chat_row(row)

def favorite_latest_agent_message(user_id: int, market: str) -> int:
    with db() as conn:
        row = conn.execute(
            "SELECT id FROM chat_messages WHERE user_id = ? AND market = ? AND role = 'agent' ORDER BY id DESC LIMIT 1",
            (user_id, clean_market(market)),
        ).fetchone()
        if not row:
            return 0
        conn.execute("UPDATE chat_messages SET favorite = 1 WHERE id = ?", (row["id"],))
        return 1


def clean_concept_term(value: str) -> str:
    term = " ".join(str(value or "").strip().split())
    if len(term) > 40:
        term = term[:40].strip()
    return term


def concept_row(row: sqlite3.Row) -> dict[str, Any]:
    try:
        related = json.loads(row["related"] or "[]")
    except Exception:
        related = []
    return {
        "term": row["term"],
        "definition": row["definition"],
        "simple": row["simple"],
        "whyImportant": row["why_important"],
        "related": related if isinstance(related, list) else [],
        "source": row["source"],
        "updatedAt": row["updated_at"],
    }


def load_concepts(terms: list[str] | None = None) -> dict[str, dict[str, Any]]:
    with db() as conn:
        if terms:
            cleaned = [clean_concept_term(term) for term in terms if clean_concept_term(term)]
            if not cleaned:
                return {}
            placeholders = ",".join("?" for _ in cleaned)
            rows = conn.execute(f"SELECT * FROM concepts WHERE term IN ({placeholders})", cleaned).fetchall()
        else:
            rows = conn.execute("SELECT * FROM concepts ORDER BY updated_at DESC LIMIT 300").fetchall()
    return {row["term"]: concept_row(row) for row in rows}


def save_concepts(concepts: list[dict[str, Any]], source: str = "ai") -> list[dict[str, Any]]:
    now = int(time.time())
    cleaned: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in concepts:
        term = clean_concept_term(str(item.get("term") or ""))
        if not term or term in seen or len(term) < 2:
            continue
        definition = str(item.get("definition") or "").strip()[:260]
        simple = str(item.get("simple") or "").strip()[:260]
        why = str(item.get("whyImportant") or item.get("why_important") or "").strip()[:260]
        raw_related_value = item.get("related")
        related_raw = raw_related_value if isinstance(raw_related_value, list) else []
        related = [clean_concept_term(str(x)) for x in related_raw][:6]
        if not definition or not simple:
            continue
        if not why:
            why = "帮助理解回答中的投资逻辑，但不能单独作为买卖依据。"
        cleaned.append({
            "term": term,
            "definition": definition,
            "simple": simple,
            "whyImportant": why,
            "related": [x for x in related if x],
            "source": source,
            "updatedAt": now,
        })
        seen.add(term)
    if not cleaned:
        return []
    with db() as conn:
        for item in cleaned:
            conn.execute(
                """
                INSERT INTO concepts(term, definition, simple, why_important, related, source, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(term) DO UPDATE SET
                    definition = excluded.definition,
                    simple = excluded.simple,
                    why_important = excluded.why_important,
                    related = excluded.related,
                    source = excluded.source,
                    updated_at = excluded.updated_at
                """,
                (
                    item["term"],
                    item["definition"],
                    item["simple"],
                    item["whyImportant"],
                    json.dumps(item["related"], ensure_ascii=False),
                    item["source"],
                    now,
                    now,
                ),
            )
    return cleaned


def extract_json_array(text: str) -> list[Any]:
    content = str(text or "").strip()
    if content.startswith("```"):
        content = content.strip("`")
        content = content.removeprefix("json").strip()
    try:
        parsed = json.loads(content)
    except Exception:
        start = content.find("[")
        end = content.rfind("]")
        if start < 0 or end <= start:
            raise
        parsed = json.loads(content[start:end + 1])
    return parsed if isinstance(parsed, list) else []


BUILTIN_CONCEPTS: dict[str, dict[str, Any]] = {
    "自由现金流": {
        "definition": "企业经营现金流扣除必要资本开支后剩下、可自由支配的现金。",
        "simple": "公司维持和发展业务后，真正能留下来分红、回购、还债或再投资的钱。",
        "whyImportant": "它比会计利润更接近真钱，常用来判断企业赚钱质量。",
        "related": ["经营现金流", "资本开支", "股东回报"],
    },
    "净利润": {
        "definition": "公司收入扣除成本、费用、税费等之后归属于股东的会计利润。",
        "simple": "报表上显示公司赚了多少钱，但不一定等于真的收到多少现金。",
        "whyImportant": "它是估值和盈利能力分析的基础，但需要和现金流一起看。",
        "related": ["利润表", "自由现金流", "盈利质量"],
    },
    "ROIC": {
        "definition": "投入资本回报率，衡量公司用股东和债权人投入的资本创造利润的效率。",
        "simple": "公司每投入一块长期资本，能赚回多少回报。",
        "whyImportant": "长期高 ROIC 往往说明公司有较强竞争优势或资本配置能力。",
        "related": ["资本成本", "护城河", "再投资能力"],
    },
    "WACC": {
        "definition": "加权平均资本成本，综合衡量股权和债务资金的最低要求回报。",
        "simple": "公司用钱的综合成本，赚得低于它就可能在毁灭价值。",
        "whyImportant": "ROIC 高于 WACC 才更可能真正创造股东价值。",
        "related": ["ROIC", "资本成本", "估值"],
    },
    "护城河": {
        "definition": "企业长期抵御竞争、维持超额利润的结构性优势。",
        "simple": "别人很难抢走它生意和利润的原因。",
        "whyImportant": "护城河决定高利润能否持续，而不是只看一两年业绩。",
        "related": ["品牌", "规模效应", "转换成本"],
    },
    "回撤": {
        "definition": "资产价格从阶段高点下跌到低点的幅度。",
        "simple": "买进去后最多可能先亏多少。",
        "whyImportant": "它影响持有体验和风险承受，收益高不等于过程舒服。",
        "related": ["波动率", "风险承受", "仓位管理"],
    },
    "股息率": {
        "definition": "每股分红除以股票价格得到的比例。",
        "simple": "按当前价格买入，一年分红大约占本金的比例。",
        "whyImportant": "常用于红利策略，但要同时看分红可持续性。",
        "related": ["分红率", "红利低波", "现金流"],
    },
    "红利低波": {
        "definition": "偏向选择高分红、低波动股票的一类投资策略或指数风格。",
        "simple": "找分红相对稳定、价格波动相对小的公司组合。",
        "whyImportant": "适合追求稳健现金流的人理解，但低波不代表没有风险。",
        "related": ["股息率", "波动率", "防御风格"],
    },
    "资本开支": {
        "definition": "企业为购买、建设或维护长期资产而发生的支出。",
        "simple": "公司为了以后继续赚钱，买设备、建厂、扩产花的钱。",
        "whyImportant": "它会影响自由现金流，也能反映公司扩张强度。",
        "related": ["自由现金流", "折旧", "再投资"],
    },
}


def fallback_concepts_from_answer(answer: str) -> list[dict[str, Any]]:
    lower_answer = answer.lower()
    matched: list[dict[str, Any]] = []
    for term, data in BUILTIN_CONCEPTS.items():
        if term.lower() in lower_answer:
            matched.append({"term": term, **data})
    return save_concepts(matched, source="builtin")[:8]


def extract_concepts_from_answer(answer: str, question: str = "") -> list[dict[str, Any]]:
    answer = str(answer or "").strip()[:8000]
    question = str(question or "").strip()[:1000]
    if not answer:
        return []
    prompt = f"""请从下面这段股票/投资问答中，抽取 3-8 个普通读者可能不懂、但理解回答很关键的概念。

要求：
1. 只输出严格 JSON 数组，不要 Markdown。
2. 每项字段：term, definition, simple, whyImportant, related。
3. term 必须是在回答原文中真实出现的词，长度 2-20 字符，优先中文术语或常见英文缩写。
4. definition 用一句准确解释；simple 用更口语的话解释；whyImportant 说明投资里为什么要懂它。
5. 不要抽取股票代码、公司名、泛泛词（例如“风险”“上涨”“市场”）。

用户问题：
{question}

AI回答：
{answer}
"""
    try:
        content, _used_cfg = chat_completion_with_fallback(
            [
                {"role": "system", "content": "你是投资教育术语抽取器，只输出可解析 JSON。"},
                {"role": "user", "content": prompt},
            ],
            max_tokens=1200,
            temperature=0.1,
        )
        parsed = extract_json_array(content)
        filtered: list[dict[str, Any]] = []
        for item in parsed:
            if not isinstance(item, dict):
                continue
            term = clean_concept_term(str(item.get("term") or ""))
            if not term or term.lower() not in answer.lower():
                continue
            filtered.append({**item, "term": term})
        saved = save_concepts(filtered, source="ai")[:8]
        return saved or fallback_concepts_from_answer(answer)
    except Exception:
        return fallback_concepts_from_answer(answer)


RELATED_FALLBACKS: dict[str, list[dict[str, str]]] = {
    "CRCL": [
        {"ticker": "CRCL", "relation": "核心标的", "reason": "稳定币发行商，USDC 增长、监管和利率是主线。"},
        {"ticker": "COIN", "relation": "渠道/生态", "reason": "Coinbase 与 USDC 生态绑定，交易活跃度和稳定币收入相关。"},
        {"ticker": "HOOD", "relation": "下游券商", "reason": "零售交易入口，受加密交易和风险偏好影响。"},
        {"ticker": "PYPL", "relation": "支付同行", "reason": "数字支付和稳定币支付场景可对比。"},
        {"ticker": "SQ", "relation": "支付同行", "reason": "Block 连接支付、商户和加密资产叙事。"},
        {"ticker": "MSTR", "relation": "加密风险代理", "reason": "受加密资产价格和市场风险偏好影响。"},
    ],
    "NVDA": [
        {"ticker": "NVDA", "relation": "核心标的", "reason": "AI GPU 龙头，数据中心需求是主线。"},
        {"ticker": "AMD", "relation": "直接同行", "reason": "GPU/加速卡竞争者，份额和定价可对比。"},
        {"ticker": "AVGO", "relation": "AI 芯片同行", "reason": "ASIC/网络芯片，受 AI 基建资本开支驱动。"},
        {"ticker": "TSM", "relation": "上游代工", "reason": "先进制程和封装产能影响供给。"},
        {"ticker": "ASML", "relation": "上游设备", "reason": "先进制程设备供应链核心。"},
        {"ticker": "SMCI", "relation": "下游服务器", "reason": "AI 服务器出货映射 GPU 需求。"},
        {"ticker": "MSFT", "relation": "下游云厂商", "reason": "Azure AI CapEx 是需求验证点。"},
    ],
    "AAPL": [
        {"ticker": "AAPL", "relation": "核心标的", "reason": "iPhone、服务收入和端侧 AI 是主线。"},
        {"ticker": "QCOM", "relation": "上游芯片", "reason": "通信芯片供应链相关。"},
        {"ticker": "AVGO", "relation": "上游芯片", "reason": "无线和定制芯片供应链相关。"},
        {"ticker": "TSM", "relation": "上游代工", "reason": "A 系列/M 系列先进制程代工。"},
        {"ticker": "GOOGL", "relation": "生态竞争", "reason": "移动生态、AI 和服务入口竞争。"},
        {"ticker": "MSFT", "relation": "大科技对比", "reason": "AI 商业化与估值锚对比。"},
    ],
    "MSFT": [
        {"ticker": "MSFT", "relation": "核心标的", "reason": "Azure、Office/Copilot 和企业软件是主线。"},
        {"ticker": "AMZN", "relation": "云同行", "reason": "AWS 与 Azure 增速和利润率对比。"},
        {"ticker": "GOOGL", "relation": "云/AI 同行", "reason": "Google Cloud 和 Gemini 竞争。"},
        {"ticker": "NVDA", "relation": "上游算力", "reason": "AI 基建 CapEx 的核心供应商。"},
        {"ticker": "ORCL", "relation": "企业软件/云", "reason": "企业 IT 支出和云基础设施对比。"},
        {"ticker": "CRM", "relation": "企业软件", "reason": "SaaS 需求和 AI 助手商业化对比。"},
    ],
    "TSLA": [
        {"ticker": "TSLA", "relation": "核心标的", "reason": "电动车、储能和自动驾驶预期共同定价。"},
        {"ticker": "GM", "relation": "汽车同行", "reason": "传统车企电动化和价格竞争对比。"},
        {"ticker": "F", "relation": "汽车同行", "reason": "北美汽车周期和新能源转型对比。"},
        {"ticker": "RIVN", "relation": "电动车同行", "reason": "纯电品牌需求和现金流压力对比。"},
        {"ticker": "ALB", "relation": "上游锂", "reason": "电池原材料价格影响成本链条。"},
        {"ticker": "UBER", "relation": "自动驾驶下游", "reason": "Robotaxi 叙事的潜在应用场景。"},
    ],
}

def fallback_related(ticker: str, market: str = "us") -> list[dict[str, str]]:
    symbol = "".join(ch for ch in str(ticker).upper().strip() if ch.isalnum() or ch in ".-")[:12]
    if not symbol:
        return []
    if symbol in RELATED_FALLBACKS:
        return RELATED_FALLBACKS[symbol]
    return [
        {"ticker": symbol, "relation": "核心标的", "reason": "用户指定的研究起点。"},
        {"ticker": "SPY" if market == "us" else symbol, "relation": "市场基准", "reason": "先和市场整体走势对比，确认是个股因素还是系统性波动。"},
        {"ticker": "QQQ" if market == "us" else symbol, "relation": "行业/成长基准", "reason": "用于观察科技成长风格是否同步变化。"},
    ]

def call_related_model(ticker: str, market: str) -> list[dict[str, str]]:
    fallback = fallback_related(ticker, market)
    prompt = f"""请为股票 {ticker} 生成同市场内最相关的同行、上游、下游股票池。
要求：
1. 输出严格 JSON 数组，不要 Markdown，不要解释。
2. 每项字段：ticker, relation, reason。
3. 第一项必须是 {ticker} 本身，relation 写“核心标的”。
4. 总数 5-8 个，优先选择当前市场 {market} 可交易股票代码。
5. relation 用中文短词，如：直接同行、上游供应商、下游客户、生态伙伴、风险代理。
"""
    try:
        content, _used_cfg = chat_completion_with_fallback(
            [
                {"role": "system", "content": "你是股票产业链研究助手，只输出可解析 JSON。"},
                {"role": "user", "content": prompt},
            ],
            max_tokens=700,
            temperature=0.2,
        )
        if content.startswith("```"):
            content = content.strip("`")
            content = content.removeprefix("json").strip()
        parsed = json.loads(content)
        cleaned: list[dict[str, str]] = []
        seen: set[str] = set()
        for item in parsed:
            symbol = "".join(ch for ch in str(item.get("ticker") or "").upper().strip() if ch.isalnum() or ch in ".-")[:12]
            if not symbol or symbol in seen:
                continue
            seen.add(symbol)
            cleaned.append({
                "ticker": symbol,
                "relation": str(item.get("relation") or "关联标的")[:20],
                "reason": str(item.get("reason") or "与核心标的相关，需要进一步验证。")[:160],
            })
        return cleaned[:8] or fallback
    except Exception:
        return fallback


class Handler(SimpleHTTPRequestHandler):
    server_version = "StockHermes/0.4"

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self) -> None:
        # 静态资源三层防缓存：no-store + no-cache + Pragma/Expires 兜底，
        # 防止浏览器 disk cache 把带新 query string 的旧响应留着。
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def send_json(self, status: int, payload: dict[str, Any], extra_headers: dict[str, str] | None = None) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        if extra_headers:
            for key, value in extra_headers.items():
                self.send_header(key, value)
        self.end_headers()
        self.wfile.write(data)

    def read_json(self, max_bytes: int = 80_000) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        if length > max_bytes:
            raise ValueError("请求过大")
        if length <= 0:
            return {}
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def cookie_token(self) -> str | None:
        raw = self.headers.get("Cookie") or ""
        jar = cookies.SimpleCookie()
        try:
            jar.load(raw)
        except Exception:
            return None
        morsel = jar.get("stock_hermes_session")
        return morsel.value if morsel else None

    def current_user(self) -> dict[str, Any] | None:
        token = self.cookie_token()
        if not token:
            return None
        now = int(time.time())
        with db() as conn:
            row = conn.execute(
                """
                SELECT users.id, users.username
                FROM sessions
                JOIN users ON users.id = sessions.user_id
                WHERE sessions.token = ? AND sessions.expires_at > ?
                """,
                (token, now),
            ).fetchone()
        if not row:
            return None
        return {"id": row["id"], "username": row["username"]}

    def require_user(self) -> dict[str, Any] | None:
        user = self.current_user()
        if not user:
            self.send_json(401, {"ok": False, "error": "未登录"})
            return None
        return user

    def session_cookie(self, token: str, max_age: int = SESSION_TTL_SECONDS) -> str:
        return f"stock_hermes_session={token}; HttpOnly; SameSite=Lax; Path=/; Max-Age={max_age}"

    def clear_cookie(self) -> str:
        return "stock_hermes_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"

    def do_GET(self) -> None:  # noqa: N802
        parsed_url = urlparse(self.path)
        path = parsed_url.path
        if path == "/api/auth/me":
            user = self.current_user()
            self.send_json(200, {"ok": True, "user": user})
            return
        if path == "/api/config":
            if not self.require_user():
                return
            try:
                configs = load_model_configs()
                cfg = configs[0]
                fallback = configs[1] if len(configs) > 1 else None
                self.send_json(200, {
                    "ok": True,
                    "model": cfg["model"],
                    "provider": cfg["provider"],
                    "fallbackModel": fallback["model"] if fallback else None,
                    "fallbackProvider": fallback["provider"] if fallback else None,
                })
            except Exception as exc:
                self.send_json(500, {"ok": False, "error": str(exc)})
            return
        if path == "/api/settings":
            user = self.require_user()
            if not user:
                return
            try:
                self.send_json(200, hermes_settings_payload(user))
            except Exception as exc:
                self.send_json(500, {"ok": False, "error": str(exc)})
            return
        if path == "/api/billing":
            user = self.require_user()
            if not user:
                return
            try:
                self.send_json(200, billing_payload(int(user["id"])))
            except Exception as exc:
                self.send_json(500, {"ok": False, "error": str(exc)})
            return
        if path == "/api/quotes":
            if not self.require_user():
                return
            try:
                qs = parse_qs(parsed_url.query)
                symbols = ",".join(qs.get("symbols", []))
                tickers = [item.strip() for item in symbols.split(",") if item.strip()]
                quotes = fetch_quotes(tickers)
                self.send_json(200, {"ok": True, "quotes": quotes, "source": "Nasdaq delayed quote"})
            except Exception as exc:
                self.send_json(500, {"ok": False, "error": str(exc)})
            return
        if path == "/api/earnings":
            if not self.require_user():
                return
            try:
                qs = parse_qs(parsed_url.query)
                anchor = clean_earnings_date((qs.get("date") or [""])[0])
                days_back = int((qs.get("daysBack") or qs.get("past") or ["7"])[0])
                days_forward = int((qs.get("daysForward") or qs.get("future") or ["7"])[0])
                payload = fetch_earnings_window(days_back=days_back, days_forward=days_forward, anchor=anchor)
                self.send_json(200, payload)
            except Exception as exc:
                self.send_json(500, {"ok": False, "error": str(exc)})
            return
        if path == "/api/filing/latest":
            if not self.require_user():
                return
            try:
                qs = parse_qs(parsed_url.query)
                symbol = str((qs.get("symbol") or [""])[0]).strip().upper()
                self.send_json(200, latest_sec_filing(symbol))
            except Exception as exc:
                self.send_json(500, {"ok": False, "error": str(exc)})
            return
        if path == "/api/related":
            user = self.require_user()
            if not user:
                return
            try:
                qs = parse_qs(parsed_url.query)
                ticker = str((qs.get("ticker") or [""])[0]).strip().upper()
                market = clean_market(str((qs.get("market") or ["us"])[0]))
                related = call_related_model(ticker, market)
                self.send_json(200, {"ok": True, "ticker": ticker, "related": related})
            except Exception as exc:
                self.send_json(500, {"ok": False, "error": str(exc)})
            return
        if path == "/api/chat":
            user = self.require_user()
            if not user:
                return
            try:
                qs = parse_qs(parsed_url.query)
                market = clean_market((qs.get("market") or ["us"])[0])
                limit = min(max(int((qs.get("limit") or ["80"])[0]), 1), 300)
                favorite_only = (qs.get("favorite") or ["0"])[0] == "1"
                messages = load_chat_messages(int(user["id"]), market, limit, favorite_only)
                self.send_json(200, {"ok": True, "messages": messages})
            except Exception as exc:
                self.send_json(500, {"ok": False, "error": str(exc)})
            return
        if path == "/api/memory":
            user = self.require_user()
            if not user:
                return
            try:
                uid = int(user["id"])
                files = []
                for rel in USER_MEMORY_FILES:
                    info = read_memory_file_for_user(uid, rel)
                    files.append({
                        "path": rel,
                        "exists": info is not None,
                        "content": info["content"] if info else "",
                        "size": info["size"] if info else 0,
                        "modifiedAt": info["modifiedAt"] if info else None,
                        "lineCount": info["lineCount"] if info else 0,
                    })
                self.send_json(200, {"ok": True, "files": files})
            except Exception as exc:
                self.send_json(500, {"ok": False, "error": str(exc)})
            return
        return super().do_GET()

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path == "/api/auth/register":
            return self.handle_register()
        if path == "/api/auth/login":
            return self.handle_login()
        if path == "/api/auth/logout":
            return self.handle_logout()
        if path == "/api/billing/deposit":
            user = self.require_user()
            if not user:
                return
            try:
                payload = self.read_json(10_000)
                amount_cents = parse_usd_to_cents(payload.get("amount"))
                self.send_json(200, add_user_balance(int(user["id"]), amount_cents))
            except Exception as exc:
                self.send_json(400, {"ok": False, "error": str(exc)})
            return
        if path == "/api/settings":
            if not self.require_user():
                return
            try:
                payload = self.read_json()
                allowed = {
                    "STOCK_HERMES_MODEL",
                    "STOCK_HERMES_PROVIDER",
                    "STOCK_HERMES_BASE_URL",
                    "STOCK_HERMES_API_KEY",
                    "STOCK_HERMES_FALLBACK_MODEL",
                    "STOCK_HERMES_FALLBACK_PROVIDER",
                    "STOCK_HERMES_FALLBACK_BASE_URL",
                    "STOCK_HERMES_FALLBACK_API_KEY",
                }
                updates: dict[str, str] = {}
                for key in allowed:
                    if key not in payload:
                        continue
                    value = str(payload.get(key) or "").strip()
                    if key.endswith("API_KEY") and not value:
                        continue
                    if value:
                        updates[key] = value
                if not updates:
                    self.send_json(400, {"ok": False, "error": "没有可保存的设置"})
                    return
                write_project_env(updates)
                user = self.current_user() or {"id": 0, "username": "unknown"}
                self.send_json(200, {"ok": True, "settings": hermes_settings_payload(user)})
            except Exception as exc:
                self.send_json(500, {"ok": False, "error": str(exc)})
            return
        if path == "/api/memory":
            user = self.require_user()
            if not user:
                return
            try:
                payload = self.read_json()
                uid = int(user["id"])
                rel = str(payload.get("path") or "").strip()
                content = str(payload.get("content") or "")
                result = write_memory_file_for_user(uid, rel, content)
                if result is None:
                    self.send_json(400, {"ok": False, "error": "无效的路径或不被允许"})
                    return
                self.send_json(200, {"ok": True, "file": result})
            except Exception as exc:
                self.send_json(500, {"ok": False, "error": str(exc)})
            return
        if path == "/api/ask":
            if not self.require_user():
                return
            try:
                payload = self.read_json()
                answer = call_model(payload)
                concepts: list[dict[str, Any]] = []
                try:
                    concepts = extract_concepts_from_answer(answer, str(payload.get("question") or ""))
                except Exception:
                    concepts = []
                self.send_json(200, {"ok": True, "answer": answer, "concepts": concepts})
            except Exception as exc:
                self.send_json(500, {"ok": False, "error": str(exc)})
            return
        if path == "/api/concepts/extract":
            if not self.require_user():
                return
            try:
                payload = self.read_json()
                concepts = extract_concepts_from_answer(str(payload.get("answer") or ""), str(payload.get("question") or ""))
                self.send_json(200, {"ok": True, "concepts": concepts})
            except Exception as exc:
                self.send_json(500, {"ok": False, "error": str(exc)})
            return
        if path == "/api/chat":
            user = self.require_user()
            if not user:
                return
            try:
                payload = self.read_json()
                message = save_chat_message(int(user["id"]), payload)
                self.send_json(200, {"ok": True, "message": message})
            except Exception as exc:
                self.send_json(400, {"ok": False, "error": str(exc)})
            return
        if path == "/api/chat/clear":
            user = self.require_user()
            if not user:
                return
            try:
                payload = self.read_json()
                market = clean_market(str(payload.get("market") or "us"))
                with db() as conn:
                    conn.execute("DELETE FROM chat_messages WHERE user_id = ? AND market = ?", (int(user["id"]), market))
                self.send_json(200, {"ok": True})
            except Exception as exc:
                self.send_json(400, {"ok": False, "error": str(exc)})
            return
        if path == "/api/chat/favorite-latest":
            user = self.require_user()
            if not user:
                return
            try:
                payload = self.read_json()
                market = clean_market(str(payload.get("market") or "us"))
                updated = favorite_latest_agent_message(int(user["id"]), market)
                self.send_json(200, {"ok": True, "updated": updated})
            except Exception as exc:
                self.send_json(400, {"ok": False, "error": str(exc)})
            return
        self.send_json(404, {"ok": False, "error": "Not found"})

    def handle_register(self) -> None:
        try:
            payload = self.read_json(10_000)
            username = normalize_username(str(payload.get("username") or ""))
            password = str(payload.get("password") or "")
            validate_password(password)
            now = int(time.time())
            with db() as conn:
                cur = conn.execute(
                    "INSERT INTO users(username, password_hash, created_at) VALUES (?, ?, ?)",
                    (username, hash_password(password), now),
                )
                user_id = int(cur.lastrowid)
            token = create_session(user_id)
            self.send_json(
                200,
                {"ok": True, "user": {"id": user_id, "username": username}},
                {"Set-Cookie": self.session_cookie(token)},
            )
        except sqlite3.IntegrityError:
            self.send_json(409, {"ok": False, "error": "用户名已存在"})
        except Exception as exc:
            self.send_json(400, {"ok": False, "error": str(exc)})

    def handle_login(self) -> None:
        try:
            payload = self.read_json(10_000)
            username = normalize_username(str(payload.get("username") or ""))
            password = str(payload.get("password") or "")
            with db() as conn:
                row = conn.execute("SELECT id, username, password_hash FROM users WHERE username = ?", (username,)).fetchone()
            if not row or not verify_password(password, row["password_hash"]):
                self.send_json(401, {"ok": False, "error": "用户名或密码错误"})
                return
            token = create_session(int(row["id"]))
            self.send_json(
                200,
                {"ok": True, "user": {"id": row["id"], "username": row["username"]}},
                {"Set-Cookie": self.session_cookie(token)},
            )
        except Exception as exc:
            self.send_json(400, {"ok": False, "error": str(exc)})

    def handle_logout(self) -> None:
        token = self.cookie_token()
        if token:
            with db() as conn:
                conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
        self.send_json(200, {"ok": True}, {"Set-Cookie": self.clear_cookie()})


def main() -> None:
    init_db()
    port = int(os.environ.get("PORT", "8899"))
    host = os.environ.get("HOST", "127.0.0.1")
    httpd = ThreadingHTTPServer((host, port), Handler)
    print(f"Stock Hermes running at http://{host}:{port}")
    print(f"Using Hermes config: {CONFIG_PATH}")
    print(f"Auth database: {DB_PATH}")
    httpd.serve_forever()


if __name__ == "__main__":
    main()

