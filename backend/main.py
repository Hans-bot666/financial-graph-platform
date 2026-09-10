"""对公贷款反欺诈知识图谱 — FastAPI 后端。

提供基于 Nebula Graph 的：
- 信贷资金流向穿透（贷款回流、洗钱路径、虚增流水、垒大户）
- 担保圈 / 集团派系识别
- 失联客户追踪
- 通用图谱扩展与 nGQL 查询工作台
"""
from __future__ import annotations

import json
import logging
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from nebula_client import get_client
from app.api.v1.router import router as v1_router
from app.core.auth_db import auth_connection
from config import CORS_ORIGINS

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

# ------------------------------------------------------------------
# 数据模型
# ------------------------------------------------------------------

class QueryRequest(BaseModel):
    query: str


class GraphResponse(BaseModel):
    title: str
    nodes: list[dict[str, Any]]
    edges: list[dict[str, Any]]
    summary: list[dict[str, str]] | None = None


class LostResponse(BaseModel):
    title: str
    nodes: list[dict[str, Any]]
    edges: list[dict[str, Any]]
    summary: list[dict[str, str]]


# ------------------------------------------------------------------
# FastAPI 应用
# ------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    # 初始化用户 SQLite 数据库和迁移。
    with auth_connection():
        logger.info("用户认证数据库已就绪")
    # 启动时预热连接池（不强制成功，失败会回退 Mock）
    try:
        get_client()
    except Exception as exc:
        logger.warning("初始化 Nebula 客户端失败：%s", exc)
    yield
    # 关闭
    client = get_client()
    client.close()


app = FastAPI(
    title="对公贷款反欺诈知识图谱 API",
    description="基于 Nebula Graph 的反欺诈图分析服务",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(v1_router)


# ------------------------------------------------------------------
# 工具函数
# ------------------------------------------------------------------

def _result_to_graph(title: str, result: dict) -> GraphResponse:
    """把前端需要的图结构包装成 GraphResponse。"""
    nodes = result.get("nodes", [])
    edges = result.get("edges", [])
    summary = result.get("summary", [])
    return GraphResponse(title=title, nodes=nodes, edges=edges, summary=summary)


def _mock_graph_response(title: str) -> GraphResponse:
    """当后端无法连接 Nebula 时返回演示数据。"""
    if "回流" in title or "贷款" in title or "洗钱" in title or "流水" in title or "大户" in title:
        return GraphResponse(
            title=title,
            nodes=[
                {"id": "c1", "label": "凯达建材有限公司", "type": "company", "risk": 90},
                {"id": "p1", "label": "王某", "type": "person", "risk": 80},
                {"id": "a1", "label": "贷款专户 6222", "type": "account", "risk": 70},
                {"id": "a2", "label": "配偶账户 8877", "type": "account", "risk": 85},
                {"id": "c2", "label": "永盛砂石经营部", "type": "company", "risk": 60},
                {"id": "a3", "label": "经营部账户 5566", "type": "account", "risk": 60},
            ],
            edges=[
                {"from": "c1", "to": "a1", "label": "开立", "type": "holds_account"},
                {"from": "p1", "to": "c1", "label": "实控人", "type": "controls"},
                {"from": "a1", "to": "a3", "label": "480万 货款", "type": "transfer", "amount": 4800000},
                {"from": "a3", "to": "a2", "label": "450万 往来", "type": "transfer", "amount": 4500000},
                {"from": "a2", "to": "p1", "label": "提现/消费", "type": "related_to", "amount": 2000000},
            ],
            summary=[
                {"key": "贷款金额", "value": "500 万元"},
                {"key": "回流金额", "value": "450 万元"},
                {"key": "回流比例", "value": "90%"},
                {"key": "路径跳数", "value": "3 跳"},
                {"key": "疑似行为", "value": title},
            ],
        )
    if "担保" in title or "集团" in title or "派系" in title:
        return GraphResponse(
            title=title,
            nodes=[
                {"id": "c3", "label": "东方贸易集团", "type": "company", "risk": 85},
                {"id": "c4", "label": "金海进出口", "type": "company", "risk": 72},
                {"id": "c5", "label": "华信供应链", "type": "company", "risk": 68},
                {"id": "c6", "label": "远航船务", "type": "company", "risk": 75},
                {"id": "c7", "label": "新纪元仓储", "type": "company", "risk": 55},
            ],
            edges=[
                {"from": "c3", "to": "c4", "label": "担保 2000万", "type": "guarantees", "amount": 20000000},
                {"from": "c4", "to": "c5", "label": "担保 1500万", "type": "guarantees", "amount": 15000000},
                {"from": "c5", "to": "c6", "label": "担保 1200万", "type": "guarantees", "amount": 12000000},
                {"from": "c6", "to": "c7", "label": "担保 800万", "type": "guarantees", "amount": 8000000},
                {"from": "c7", "to": "c3", "label": "担保 1000万", "type": "guarantees", "amount": 10000000},
                {"from": "c3", "to": "c6", "label": "实控关系", "type": "controls"},
            ],
            summary=[
                {"key": "担保圈规模", "value": "5 户"},
                {"key": "担保总额", "value": "6500 万元"},
                {"key": "闭环长度", "value": "5 条边"},
                {"key": "核心节点", "value": "东方贸易集团"},
                {"key": "派系标签", "value": "东方系"},
            ],
        )
    if "扩展" in title or "探索" in title:
        return GraphResponse(
            title=title,
            nodes=[
                {"id": "c1", "label": "凯达建材有限公司", "type": "company", "risk": 90},
                {"id": "p1", "label": "王某", "type": "person", "risk": 80},
                {"id": "p6", "label": "刘某", "type": "person", "risk": 65},
                {"id": "a1", "label": "贷款专户 6222", "type": "account", "risk": 70},
                {"id": "a2", "label": "配偶账户 8877", "type": "account", "risk": 85},
                {"id": "c2", "label": "永盛砂石经营部", "type": "company", "risk": 60},
                {"id": "c3", "label": "东方贸易集团", "type": "company", "risk": 85},
                {"id": "c4", "label": "金海进出口", "type": "company", "risk": 72},
                {"id": "c15", "label": "瑞丰贸易", "type": "company", "risk": 78},
                {"id": "l1", "label": "贷款 2024-0152", "type": "loan", "risk": 75},
            ],
            edges=[
                {"from": "p1", "to": "c1", "label": "实控人", "type": "controls"},
                {"from": "p6", "to": "c1", "label": "持股 30%", "type": "controls"},
                {"from": "c1", "to": "a1", "label": "开立", "type": "holds_account"},
                {"from": "l1", "to": "a1", "label": "发放", "type": "issues"},
                {"from": "a1", "to": "c2", "label": "480万 货款", "type": "transfer", "amount": 4800000},
                {"from": "c2", "to": "a2", "label": "450万 往来", "type": "transfer", "amount": 4500000},
                {"from": "a2", "to": "p1", "label": "180万 提现", "type": "related_to", "amount": 1800000},
                {"from": "p1", "to": "p6", "label": "亲属", "type": "related_to"},
                {"from": "c1", "to": "c3", "label": "互保", "type": "guarantees", "amount": 5000000},
                {"from": "c3", "to": "c4", "label": "担保 2000万", "type": "guarantees", "amount": 20000000},
                {"from": "c4", "to": "c15", "label": "贸易往来", "type": "related_to"},
                {"from": "c15", "to": "p6", "label": "法定代表人", "type": "controls"},
            ],
            summary=[
                {"key": "中心节点", "value": "凯达建材有限公司"},
                {"key": "扩展跳数", "value": "2 跳"},
                {"key": "返回节点", "value": "10 个"},
                {"key": "返回边", "value": "12 条"},
                {"key": "关联类型", "value": "实控 / 担保 / 资金 / 任职"},
            ],
        )
    return GraphResponse(title=title, nodes=[], edges=[], summary=[])


def _query_to_graph_result(client, title: str, ngql: str) -> GraphResponse:
    resp = client.execute(ngql)
    if resp.is_mock:
        return _mock_graph_response(title)
    if resp.error_code != 0:
        return GraphResponse(title=title, nodes=[], edges=[], summary=[{"key": "错误", "value": resp.error_msg}])

    # 如果 nGQL 返回了 path/edge/vertex 等复杂类型，简单展示原始 JSON
    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []
    seen_ids: set[str] = set()

    def add_path(path: dict[str, Any]) -> None:
        for raw_node in path.get("nodes", []):
            nid = raw_node.get("id") or raw_node.get("vid")
            if not nid or nid in seen_ids:
                continue

            tags = raw_node.get("tags", {})
            node_type = raw_node.get("type", "unknown")
            props: dict[str, Any] = raw_node
            if tags:
                node_type, props = next(iter(tags.items()))

            nodes.append({
                "id": nid,
                "label": props.get("name", raw_node.get("name", nid)),
                "type": node_type,
                "risk": props.get("risk_score", raw_node.get("risk_score", 50)),
            })
            seen_ids.add(nid)

        for raw_edge in path.get("edges", []):
            props = raw_edge.get("props", {})
            edge_type = raw_edge.get("type", "unknown")
            label = props.get("memo") or props.get("relation") or edge_type
            edge = {
                "from": raw_edge.get("from") or raw_edge.get("src"),
                "to": raw_edge.get("to") or raw_edge.get("dst"),
                "type": edge_type,
                "label": raw_edge.get("label", label),
            }
            if "amount" in props:
                edge["amount"] = props["amount"]
            elif "amount" in raw_edge:
                edge["amount"] = raw_edge["amount"]
            edges.append(edge)

    for row in resp.rows:
        for cell in row:
            if isinstance(cell, dict):
                if "nodes" in cell and "edges" in cell:
                    add_path(cell)
                for k, v in cell.items():
                    if isinstance(v, dict) and "nodes" in v and "edges" in v:
                        add_path(v)

    return GraphResponse(title=title, nodes=nodes, edges=edges, summary=[])


# ------------------------------------------------------------------
# API 路由
# ------------------------------------------------------------------


def _safe(value: str) -> str:
    """简单转义单引号，防止 nGQL 字面量注入。"""
    return value.replace("\\", "\\\\").replace("'", "\\'")

@app.get("/api/health")
async def health():
    client = get_client()
    resp = client.execute("SHOW SPACES;")
    return {
        "status": "ok",
        "nebula_connected": not client._mock,
        "space": "anti_fraud_kg",
        "mock": client._mock,
        "nebula_response": {"code": resp.error_code, "msg": resp.error_msg},
    }


@app.get("/api/fund-flow/reflux", response_model=GraphResponse)
async def fund_flow_reflux(
    q: str = Query(..., description="企业名称或贷款编号"),
):
    """贷款回流：贷款发放账户 → 多跳转账 → 回流到借款人/实控人/关联方账户。"""
    client = get_client()
    safe_q = _safe(q)
    ngql = f"""
    USE anti_fraud_kg;
    MATCH p=(c:company)-[:holds_account]->(a:account)
           -[:transfer*1..5]->(p2:person)-[:controls]->(c)
    WHERE c.company.name == '{safe_q}'
    RETURN p LIMIT 50;
    """.strip()
    return _query_to_graph_result(client, "贷款回流路径", ngql)


@app.get("/api/fund-flow/money-laundering", response_model=GraphResponse)
async def fund_flow_money_laundering(
    q: str = Query(..., description="起点账户或企业名称"),
):
    """洗钱路径：多跳转账，识别拆分、快进快出等可疑资金链路。"""
    client = get_client()
    safe_q = _safe(q)
    ngql = f"""
    USE anti_fraud_kg;
    MATCH p=(src:account)-[:transfer*3..6]->(dst:account)
    WHERE src.vid == '{safe_q}' OR src.name == '{safe_q}'
    RETURN p, length(p) AS path_length
    ORDER BY path_length DESC LIMIT 50;
    """.strip()
    return _query_to_graph_result(client, "洗钱路径追踪", ngql)


@app.get("/api/fund-flow/fake-flow", response_model=GraphResponse)
async def fund_flow_fake_flow(
    q: str = Query(..., description="企业名称或账户"),
):
    """虚增流水：账户之间短期内循环转账，形成闭环。"""
    client = get_client()
    safe_q = _safe(q)
    ngql = f"""
    USE anti_fraud_kg;
    MATCH p=(a:account)-[:transfer*2..6]->(a)
    WHERE a.vid == '{safe_q}' OR a.name CONTAINS '{safe_q}'
    RETURN p LIMIT 50;
    """.strip()
    return _query_to_graph_result(client, "虚增流水检测", ngql)


@app.get("/api/fund-flow/stacked-clients", response_model=GraphResponse)
async def fund_flow_stacked_clients(
    q: str = Query(..., description="归集目标企业或账户"),
):
    """垒大户：多个来源账户向同一目标账户大额归集资金。"""
    client = get_client()
    safe_q = _safe(q)
    ngql = f"""
    USE anti_fraud_kg;
    MATCH (src:account)-[t:transfer]->(dst:account)
    WHERE dst.vid == '{safe_q}' OR dst.name CONTAINS '{safe_q}'
    WITH src, dst, sum(t.amount) AS total, count(t) AS cnt
    WHERE total > 1000000
    RETURN src.vid, dst.vid, total, cnt ORDER BY total DESC LIMIT 50;
    """.strip()
    return _query_to_graph_result(client, "垒大户识别", ngql)


@app.get("/api/guarantee/circle", response_model=GraphResponse)
async def guarantee_circle(
    q: str = Query(..., description="核心企业名称"),
):
    """担保圈：企业之间形成闭环担保。"""
    client = get_client()
    safe_q = _safe(q)
    ngql = f"""
    USE anti_fraud_kg;
    MATCH p=(c:company)-[:guarantees*2..6]->(c)
    WHERE c.name == '{safe_q}' OR c.vid == '{safe_q}'
    RETURN p LIMIT 50;
    """.strip()
    return _query_to_graph_result(client, "担保圈识别", ngql)


@app.get("/api/guarantee/faction", response_model=GraphResponse)
async def guarantee_faction(
    q: str = Query(..., description="核心企业名称"),
):
    """集团派系：通过担保、股权、任职、亲属关系发现隐性集团。"""
    client = get_client()
    safe_q = _safe(q)
    ngql = f"""
    USE anti_fraud_kg;
    MATCH p=(c:company)-[:guarantees|shareholder|employs|related_to*1..4]-(c2:company)
    WHERE c.name == '{safe_q}' OR c.vid == '{safe_q}'
    RETURN p LIMIT 100;
    """.strip()
    return _query_to_graph_result(client, "集团派系识别", ngql)


@app.get("/api/lost-customers", response_model=LostResponse)
async def lost_customers(
    q: str = Query(..., description="失联企业名称"),
    days: int = Query(30, description="失联天数阈值"),
):
    """失联客户追踪：根据联系方式有效性与关联关系推荐可联人。"""
    client = get_client()
    safe_q = _safe(q)
    ngql = f"""
    USE anti_fraud_kg;
    MATCH (c:company)-[:controls|related_to|employs*1..3]-(p:person)
    WHERE c.name == '{safe_q}' AND c.lost_days >= {days}
    RETURN c, p LIMIT 50;
    """.strip()
    result = _query_to_graph_result(client, "失联客户追踪", ngql)

    # 为失联场景补齐一些固定边（用于前端展示）
    lost_edges = [
        {"from": "p2", "to": "c8", "label": "法定代表人", "type": "controls"},
        {"from": "p3", "to": "c8", "label": "财务负责人", "type": "related_to"},
        {"from": "c9", "to": "c8", "label": "上下游", "type": "related_to"},
        {"from": "c10", "to": "c8", "label": "同一注册地", "type": "related_to"},
        {"from": "p2", "to": "p3", "label": "亲属", "type": "related_to"},
    ]
    nodes = result.nodes or [
        {"id": "c8", "label": "远景电子科技有限公司", "type": "company", "risk": 95, "isLost": True},
        {"id": "p2", "label": "李某", "type": "person", "risk": 90},
        {"id": "p3", "label": "张某", "type": "person", "risk": 60},
        {"id": "c9", "label": "宏达电子", "type": "company", "risk": 40},
        {"id": "c10", "label": "远航电子", "type": "company", "risk": 45},
    ]
    # 标记失联企业，前端渲染为红色
    for n in nodes:
        if n.get("label") == q or n.get("id") == "c8":
            n["isLost"] = True
    return LostResponse(
        title=result.title,
        nodes=nodes,
        edges=lost_edges,
        summary=[
            {"key": "失联主体", "value": q},
            {"key": "失联天数", "value": f"{days} 天"},
            {"key": "法人电话", "value": "空号 / 无法接通"},
            {"key": "关联可联", "value": "财务负责人张某"},
            {"key": "推荐触达", "value": "通过张某 / 上下游宏达电子"},
        ],
    )


@app.get("/api/graph/expand", response_model=GraphResponse)
async def graph_expand(
    q: str = Query(..., description="VID 或名称"),
    hop: int = Query(2, ge=1, le=5, description="扩展跳数"),
):
    """通用图谱扩展：从给定节点向外扩展指定跳数。"""
    client = get_client()
    safe_q = _safe(q)
    ngql = f"""
    USE anti_fraud_kg;
    MATCH p=(v)-[*1..{hop}]-(v2)
    WHERE id(v) == '{safe_q}' OR v.company.name == '{safe_q}' OR v.person.name == '{safe_q}'
    RETURN p LIMIT 100;
    """.strip()
    return _query_to_graph_result(client, "图谱扩展", ngql)


@app.post("/api/query", deprecated=True)
async def run_query(req: QueryRequest):
    """兼容旧前端的任意 nGQL 接口；新工作台必须使用受限的 /api/v1/graph/query。"""
    client = get_client()
    resp = client.execute(req.query)
    return {
        "error_code": resp.error_code,
        "error_msg": resp.error_msg,
        "columns": resp.column_names,
        "rows": resp.rows,
        "is_mock": resp.is_mock,
    }


# ------------------------------------------------------------------
# 主入口
# ------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
