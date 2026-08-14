"""Nebula Graph 客户端封装。

提供连接池管理、nGQL 执行、结果序列化，并内置一套 Mock 数据，
当 Nebula Graph 不可用时自动回退，方便前端演示与本地开发。
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from config import (
    NEBULA_HOST,
    NEBULA_PASSWORD,
    NEBULA_POOL_MAX,
    NEBULA_POOL_MIN,
    NEBULA_PORT,
    NEBULA_SPACE,
    NEBULA_TIMEOUT,
    NEBULA_USER,
)

logger = logging.getLogger(__name__)

# 尝试导入 nebula3-python；如未安装，则全程走 Mock
try:
    from nebula3.gclient.net import ConnectionPool
    from nebula3.common import ttypes

    NEBULA_AVAILABLE = True
except Exception as exc:  # pragma: no cover
    logger.warning("nebula3-python 未安装或导入失败：%s", exc)
    ConnectionPool = None  # type: ignore
    ttypes = None  # type: ignore
    NEBULA_AVAILABLE = False


@dataclass
class GraphResult:
    """统一返回结构。"""

    error_code: int
    error_msg: str
    column_names: list[str]
    rows: list[list[Any]]
    is_mock: bool = False


def _value_to_py(value: Any) -> Any:
    """把 Nebula Graph Value 对象递归转换为 Python 原生类型。"""
    if value is None:
        return None

    if hasattr(value, "getType"):
        try:
            from nebula3.common.ttypes import Value
        except Exception:
            return str(value)

        vt = value.getType()
        if vt == Value.NVAL:
            return None
        if vt == Value.BVAL:
            return value.get_bVal()
        if vt == Value.IVAL:
            return value.get_iVal()
        if vt == Value.SVAL:
            return value.get_sVal().decode("utf-8") if isinstance(value.get_sVal(), bytes) else value.get_sVal()
        if vt == Value.FVAL:
            return value.get_fVal()
        if vt == Value.DVAL:
            return value.get_dVal()
        if vt == Value.LVAL:
            return [_value_to_py(v) for v in value.get_lVal().values]
        if vt == Value.MVAL:
            return {k.decode("utf-8") if isinstance(k, bytes) else k: _value_to_py(v) for k, v in value.get_mVal().kvs.items()}
        if vt == Value.VVAL:
            return [_value_to_py(v) for v in value.get_vVal().values]
        if vt == Value.EVAL:
            return value.get_eVal()
        if vt == Value.PVAL:
            return value.get_pVal()
        if vt == Value.GVAL:
            return value.get_gVal()
        return str(value)

    # 已是 Python 原生类型
    return value


class NebulaClient:
    """Nebula Graph 连接池客户端。"""

    def __init__(self) -> None:
        self.pool: Any = None
        self.session: Any = None
        self._mock = False
        self._init_pool()

    def _init_pool(self) -> None:
        if not NEBULA_AVAILABLE:
            self._mock = True
            logger.warning("Nebula Graph SDK 不可用，使用内置 Mock 数据。")
            return

        try:
            self.pool = ConnectionPool()
            ok = self.pool.init(
                [(NEBULA_HOST, NEBULA_PORT)],
                self._config(),
            )
            if not ok:
                raise RuntimeError("连接池初始化失败")
            self.session = self.pool.get_session(NEBULA_USER, NEBULA_PASSWORD)
            self.session.execute(f"USE {NEBULA_SPACE};")
            logger.info("已连接 Nebula Graph %s:%s / space=%s", NEBULA_HOST, NEBULA_PORT, NEBULA_SPACE)
        except Exception as exc:
            logger.warning("连接 Nebula Graph 失败：%s，回退到 Mock 模式。", exc)
            self._mock = True
            if self.pool:
                try:
                    self.pool.close()
                except Exception:
                    pass
            self.pool = None
            self.session = None

    def _config(self) -> Any:
        from nebula3.Config import Config

        config = Config()
        config.min_connection_pool_size = NEBULA_POOL_MIN
        config.max_connection_pool_size = NEBULA_POOL_MAX
        config.timeout = NEBULA_TIMEOUT
        return config

    def close(self) -> None:
        if self.pool:
            try:
                self.pool.close()
            except Exception:
                pass
        self.pool = None
        self.session = None

    def execute(self, ngql: str) -> GraphResult:
        """执行 nGQL 并返回统一结构。"""
        if self._mock:
            return self._mock_execute(ngql)

        if not self.session:
            return GraphResult(-1, "session 未初始化", [], [])

        try:
            resp = self.session.execute(ngql)
        except Exception as exc:
            logger.exception("执行 nGQL 异常：%s", exc)
            return GraphResult(-1, f"执行异常: {exc}", [], [])

        # nebula3-python 3.8 exposes these as methods, while older releases
        # exposed thrift-style attributes. Support both result shapes.
        error_code_attr = getattr(resp, "error_code", -1)
        error_code = error_code_attr() if callable(error_code_attr) else error_code_attr
        error_msg_attr = getattr(resp, "error_msg", b"")
        error_msg = error_msg_attr() if callable(error_msg_attr) else error_msg_attr
        if isinstance(error_msg, bytes):
            error_msg = error_msg.decode("utf-8")
        error_msg = error_msg or ""

        if error_code != 0:
            return GraphResult(error_code, error_msg, [], [])

        try:
            # Current SDKs provide a stable Python-native representation.
            if hasattr(resp, "as_primitive") and hasattr(resp, "keys"):
                column_names = list(resp.keys())
                primitive_rows = resp.as_primitive()
                rows = [[row.get(name) for name in column_names] for row in primitive_rows]
                return GraphResult(0, "", column_names, rows)

            # Compatibility fallback for older thrift-style ResultSet objects.
            data_set = resp.data
            if data_set is None:
                return GraphResult(0, "", [], [])

            column_names = [c.decode("utf-8") if isinstance(c, bytes) else c for c in data_set.column_names]
            rows = []
            for row in data_set.rows:
                rows.append([_value_to_py(v) for v in row.values])
            return GraphResult(0, "", column_names, rows)
        except Exception as exc:
            logger.exception("解析结果异常：%s", exc)
            return GraphResult(-1, f"解析异常: {exc}", [], [])

    # ------------------------------------------------------------------
    # Mock 实现：用于无 Nebula 环境演示
    # ------------------------------------------------------------------
    def _mock_execute(self, ngql: str) -> GraphResult:
        lower = ngql.lower()
        if "guarantees" in lower:
            return self._mock_guarantee_circle()
        if "transfer" in lower or "money" in lower or "reflux" in lower or "loan" in lower:
            return self._mock_fund_flow()
        if "lost" in lower:
            return self._mock_lost_customer()
        if "anti_fraud_kg" in lower and "use " in lower:
            return GraphResult(0, "", [], [["OK"]])
        return GraphResult(0, "", ["message"], [["Mock 查询成功：" + ngql[:80]]])

    def _mock_fund_flow(self) -> GraphResult:
        return GraphResult(
            0,
            "",
            ["path"],
            [
                [
                    {
                        "nodes": [
                            {"id": "c1", "name": "凯达建材有限公司", "type": "company", "risk_score": 90},
                            {"id": "p1", "name": "王某", "type": "person", "risk_score": 80},
                            {"id": "a1", "name": "贷款专户 6222", "type": "account", "risk_score": 70},
                            {"id": "a2", "name": "配偶账户 8877", "type": "account", "risk_score": 85},
                            {"id": "c2", "name": "永盛砂石经营部", "type": "company", "risk_score": 60},
                            {"id": "a3", "name": "经营部账户 5566", "type": "account", "risk_score": 60},
                        ],
                        "edges": [
                            {"from": "c1", "to": "a1", "type": "holds_account", "label": "开立"},
                            {"from": "p1", "to": "c1", "type": "controls", "label": "实控人"},
                            {"from": "a1", "to": "a3", "type": "transfer", "label": "480万 货款", "amount": 4800000},
                            {"from": "a3", "to": "a2", "type": "transfer", "label": "450万 往来", "amount": 4500000},
                            {"from": "a2", "to": "p1", "type": "related_to", "label": "提现/消费", "amount": 2000000},
                        ],
                    }
                ]
            ],
            is_mock=True,
        )

    def _mock_guarantee_circle(self) -> GraphResult:
        return GraphResult(
            0,
            "",
            ["path"],
            [
                [
                    {
                        "nodes": [
                            {"id": "c3", "name": "东方贸易集团", "type": "company", "risk_score": 85},
                            {"id": "c4", "name": "金海进出口", "type": "company", "risk_score": 72},
                            {"id": "c5", "name": "华信供应链", "type": "company", "risk_score": 68},
                            {"id": "c6", "name": "远航船务", "type": "company", "risk_score": 75},
                            {"id": "c7", "name": "新纪元仓储", "type": "company", "risk_score": 55},
                        ],
                        "edges": [
                            {"from": "c3", "to": "c4", "type": "guarantees", "label": "担保 2000万", "amount": 20000000},
                            {"from": "c4", "to": "c5", "type": "guarantees", "label": "担保 1500万", "amount": 15000000},
                            {"from": "c5", "to": "c6", "type": "guarantees", "label": "担保 1200万", "amount": 12000000},
                            {"from": "c6", "to": "c7", "type": "guarantees", "label": "担保 800万", "amount": 8000000},
                            {"from": "c7", "to": "c3", "type": "guarantees", "label": "担保 1000万", "amount": 10000000},
                            {"from": "c3", "to": "c6", "type": "controls", "label": "实控关系"},
                        ],
                    }
                ]
            ],
            is_mock=True,
        )

    def _mock_lost_customer(self) -> GraphResult:
        return GraphResult(
            0,
            "",
            ["nodes"],
            [
                [
                    [
                        {"id": "c8", "name": "远景电子科技有限公司", "type": "company", "risk_score": 95, "is_lost": True},
                        {"id": "p2", "name": "李某", "type": "person", "risk_score": 90},
                        {"id": "p3", "name": "张某", "type": "person", "risk_score": 60},
                        {"id": "c9", "name": "宏达电子", "type": "company", "risk_score": 40},
                        {"id": "c10", "name": "远航电子", "type": "company", "risk_score": 45},
                    ]
                ]
            ],
            is_mock=True,
        )


# 全局单例
_client: NebulaClient | None = None


def get_client() -> NebulaClient:
    global _client
    if _client is None:
        _client = NebulaClient()
    return _client
