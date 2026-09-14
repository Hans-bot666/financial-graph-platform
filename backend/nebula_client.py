"""Nebula Graph 客户端封装。

提供连接池管理、nGQL 执行、结果序列化，并内置一套 Mock 数据，
当 Nebula Graph 不可用时自动回退，方便前端演示与本地开发。
"""
from __future__ import annotations

import logging
import threading
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


def to_gql(statement: str) -> str:
    """NebulaGraph 5.x GQL 不接受 nGQL 风格的语句结束分号。"""
    return statement.strip().rstrip(";").strip()

# 尝试导入 NebulaGraph 5.x Python SDK；如未安装，则全程走 Mock。
try:
    from nebulagraph_python import NebulaPool as SdkNebulaPool
    from nebulagraph_python import NebulaPoolConfig

    NEBULA_AVAILABLE = True
except Exception as exc:  # pragma: no cover
    logger.warning("nebula5-python 未安装或导入失败：%s", exc)
    SdkNebulaPool = None  # type: ignore[assignment]
    NebulaPoolConfig = None  # type: ignore[assignment,misc]
    NEBULA_AVAILABLE = False


@dataclass
class GraphResult:
    """统一返回结构。"""

    error_code: int
    error_msg: str
    column_names: list[str]
    rows: list[list[Any]]
    is_mock: bool = False


def _result_to_graph_result(result: Any) -> GraphResult:
    """把 nebula5-python ResultSet 转为项目稳定使用的返回结构。"""
    succeeded = getattr(result, "is_succeeded", False)
    if callable(succeeded):
        succeeded = succeeded()

    status_code = str(getattr(result, "status_code", "") or "")
    status_message = str(getattr(result, "status_message", "") or "")
    if not succeeded:
        message = f"[{status_code}] {status_message}".strip() if status_code else status_message
        return GraphResult(-1, message or "NebulaGraph 查询失败", [], [])

    column_names = [str(name) for name in getattr(result, "column_names", [])]
    primitive_rows = result.as_primitive_by_row()
    rows = [[row.get(name) for name in column_names] for row in primitive_rows]
    return GraphResult(0, "", column_names, rows)


class NebulaClient:
    """NebulaGraph 5.x 连接池适配器。"""

    def __init__(self) -> None:
        self.pool: Any = None
        self._mock = False
        self.space = NEBULA_SPACE
        self._lock = threading.RLock()
        self._init_pool()

    def _init_pool(self) -> None:
        if not NEBULA_AVAILABLE:
            self._mock = True
            logger.warning("Nebula Graph SDK 不可用，使用内置 Mock 数据。")
            return

        try:
            request_timeout_ms = NEBULA_TIMEOUT if NEBULA_TIMEOUT > 0 else 30_000
            # 5.x 连接池若在初始化时指定 graph，会立刻执行 SESSION SET GRAPH。
            # 图尚未创建时会把整个连接池打空，因此先连上 catalog，再按查询切换 Graph。
            config = NebulaPoolConfig(
                addresses=f"{NEBULA_HOST}:{NEBULA_PORT}",
                user_name=NEBULA_USER,
                password=NEBULA_PASSWORD,
                min_client_size=NEBULA_POOL_MIN,
                max_client_size=NEBULA_POOL_MAX,
                request_timeout_ms=request_timeout_ms,
            )
            self.pool = SdkNebulaPool(config)
            probe = self._execute_sdk("RETURN 1 AS ok")
            if probe.error_code != 0:
                raise RuntimeError(probe.error_msg)
            self.space = NEBULA_SPACE
            graph_probe = self._execute_sdk("RETURN 1 AS ok", NEBULA_SPACE)
            if graph_probe.error_code != 0:
                logger.warning(
                    "已连接 NebulaGraph 5.x %s:%s，但 Graph `%s` 尚未就绪：%s。"
                    "请先按 schema.ngql 创建 Graph Type 和 Graph。",
                    NEBULA_HOST,
                    NEBULA_PORT,
                    NEBULA_SPACE,
                    graph_probe.error_msg,
                )
            else:
                logger.info("已连接 NebulaGraph 5.x %s:%s / graph=%s", NEBULA_HOST, NEBULA_PORT, NEBULA_SPACE)
        except Exception as exc:
            logger.warning("连接 NebulaGraph 失败：%s，回退到 Mock 模式。", exc)
            self._mock = True
            if self.pool:
                try:
                    self.pool.close()
                except Exception:
                    pass
            self.pool = None

    def close(self) -> None:
        if self.pool:
            try:
                self.pool.close()
            except Exception:
                pass
        self.pool = None

    def execute(self, ngql: str) -> GraphResult:
        """执行 GQL 并返回统一结构。调用方若需指定 Graph，应使用 execute_in_space。"""
        if self._mock:
            return self._mock_execute(ngql)

        return self._execute_sdk(ngql, self.space)

    def list_graphs(self) -> GraphResult:
        """列出 catalog 中的 Graph。不得预选业务 Graph。"""
        if self._mock:
            return GraphResult(0, "", ["Name"], [["anti_fraud_kg"]], is_mock=True)
        with self._lock:
            return self._execute_sdk("SHOW GRAPHS")

    def _execute_sdk(self, ngql: str, space: str | None = None) -> GraphResult:
        """从 5.x 池借出客户端，并确保 SESSION SET GRAPH 与查询在同一会话执行。"""
        if not self.pool:
            return GraphResult(-1, "NebulaGraph 连接池未初始化", [], [])

        client: Any = None
        try:
            client = self.pool.get_client()
            if space:
                use_result = _result_to_graph_result(client.execute(to_gql(f"SESSION SET GRAPH {space}")))
                if use_result.error_code != 0:
                    return use_result
            return _result_to_graph_result(client.execute(to_gql(ngql)))
        except Exception as exc:
            logger.exception("执行 nGQL 异常：%s", exc)
            return GraphResult(-1, f"执行异常: {exc}", [], [])
        finally:
            if client is not None:
                try:
                    self.pool.return_client(client)
                except Exception:
                    logger.exception("归还 NebulaGraph 客户端到连接池失败")

    def execute_in_space(self, space: str, ngql: str) -> GraphResult:
        """在指定 Graph 执行查询；持锁保证并发请求不串 Graph。

        `space` 必须已由上层目录校验通过。在 NebulaGraph 5.x 中表示 Graph 名。
        """
        with self._lock:
            self.space = space
            if self._mock:
                return self._mock_execute(ngql)
            return self._execute_sdk(ngql, space)

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
        if "show graphs" in lower:
            return GraphResult(0, "", ["Name"], [["anti_fraud_kg"]], is_mock=True)
        if "anti_fraud_kg" in lower and ("use " in lower or "session set graph" in lower):
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
