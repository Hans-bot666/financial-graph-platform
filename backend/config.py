"""后端配置项。"""
import os

NEBULA_HOST = os.getenv("NEBULA_HOST", "127.0.0.1")
NEBULA_PORT = int(os.getenv("NEBULA_PORT", "9669"))
NEBULA_USER = os.getenv("NEBULA_USER", "root")
NEBULA_PASSWORD = os.getenv("NEBULA_PASSWORD", "nebula")
NEBULA_SPACE = os.getenv("NEBULA_SPACE", "anti_fraud_kg")

# 连接池配置
NEBULA_POOL_MIN = int(os.getenv("NEBULA_POOL_MIN", "1"))
NEBULA_POOL_MAX = int(os.getenv("NEBULA_POOL_MAX", "10"))
NEBULA_TIMEOUT = int(os.getenv("NEBULA_TIMEOUT", "0"))
