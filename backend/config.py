"""后端配置项。"""
import os
from pathlib import Path

NEBULA_HOST = os.getenv("NEBULA_HOST", "127.0.0.1")
NEBULA_PORT = int(os.getenv("NEBULA_PORT", "9669"))
NEBULA_USER = os.getenv("NEBULA_USER", "root")
NEBULA_PASSWORD = os.getenv("NEBULA_PASSWORD", "nebula")
NEBULA_SPACE = os.getenv("NEBULA_SPACE", "anti_fraud_kg")

# 连接池配置
NEBULA_POOL_MIN = int(os.getenv("NEBULA_POOL_MIN", "1"))
NEBULA_POOL_MAX = int(os.getenv("NEBULA_POOL_MAX", "10"))
NEBULA_TIMEOUT = int(os.getenv("NEBULA_TIMEOUT", "0"))

# 用户认证与 SQLite。生产环境应显式配置 USER_DB_PATH、COOKIE_SECURE 和 CORS_ORIGINS。
BACKEND_DIR = Path(__file__).resolve().parent
USER_DB_PATH = Path(os.getenv("USER_DB_PATH", str(BACKEND_DIR / "data" / "users.db")))
SELF_REGISTRATION_ENABLED = os.getenv("SELF_REGISTRATION_ENABLED", "true").lower() == "true"
SESSION_IDLE_MINUTES = int(os.getenv("SESSION_IDLE_MINUTES", "30"))
SESSION_ABSOLUTE_HOURS = int(os.getenv("SESSION_ABSOLUTE_HOURS", "12"))
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() == "true"
COOKIE_NAME = os.getenv("COOKIE_NAME", "fgp_session")
CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ORIGINS",
        "http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:8080,http://localhost:8080",
    ).split(",")
    if origin.strip()
]
