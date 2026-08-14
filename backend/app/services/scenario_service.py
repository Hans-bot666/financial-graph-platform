"""版本化场景模板与执行服务。"""
from __future__ import annotations

from time import perf_counter
from uuid import uuid4

from app.contracts import GraphResult, ScenarioParameter, ScenarioTemplate, SummaryItem
from app.services.graph_mapper import map_paths
from nebula_client import get_client


SCENARIOS = {
    "loan-reflux": ScenarioTemplate(
        id="loan-reflux",
        name="贷款回流",
        category="fund-flow",
        version="1.0.0",
        description="识别贷款账户经多跳转账回流至借款企业实控人的路径。",
        parameters=[ScenarioParameter(name="companyName", label="企业名称", type="string", default="凯达建材有限公司")],
    ),
    "guarantee-circle": ScenarioTemplate(
        id="guarantee-circle",
        name="担保圈识别",
        category="guarantee-risk",
        version="1.0.0",
        description="识别以核心企业为起点、最终回到自身的多层闭环担保关系。",
        parameters=[ScenarioParameter(name="companyName", label="核心企业", type="string", default="东方贸易集团")],
    ),
    "lost-customer": ScenarioTemplate(
        id="lost-customer",
        name="失联客户追踪",
        category="post-loan-risk",
        version="1.0.0",
        description="识别达到失联阈值的企业，并返回法人、员工及关联企业等可触达线索。",
        parameters=[
            ScenarioParameter(name="companyName", label="失联企业", type="string", default="远景电子科技有限公司"),
            ScenarioParameter(name="lostDays", label="失联天数阈值", type="integer", default=30),
        ],
    ),
}


class ScenarioExecutionError(RuntimeError):
    pass


def _escape_literal(value: str) -> str:
    return value.replace("\\", "\\\\").replace("'", "\\'")


def list_scenarios() -> list[ScenarioTemplate]:
    return list(SCENARIOS.values())


def _execute_graph(title: str, query: str, summary: list[SummaryItem] | None = None) -> GraphResult:
    started = perf_counter()
    trace_id = uuid4().hex
    response = get_client().execute(query)
    elapsed = int((perf_counter() - started) * 1000)
    if response.error_code != 0:
        raise ScenarioExecutionError(response.error_msg or "NebulaGraph 场景查询失败")
    nodes, edges = map_paths(response.rows)
    return GraphResult(
        title=title,
        nodes=nodes,
        edges=edges,
        summary=summary or [],
        traceId=trace_id,
        executionTimeMs=elapsed,
    )


def execute_loan_reflux(company_name: str) -> GraphResult:
    safe_name = _escape_literal(company_name)
    query = f"""
    USE anti_fraud_kg;
    MATCH p=(c:company)-[:holds_account]->(a:account)
           -[:transfer*1..5]->(p2:person)-[:controls]->(c)
    WHERE c.company.name == '{safe_name}'
    RETURN p LIMIT 50;
    """.strip()
    return _execute_graph("贷款回流路径", query)


def execute_guarantee_circle(company_name: str) -> GraphResult:
    safe_name = _escape_literal(company_name)
    query = f"""
    USE anti_fraud_kg;
    MATCH p=(c:company)-[:guarantees*2..6]->(c)
    WHERE c.company.name == '{safe_name}'
    RETURN p LIMIT 50;
    """.strip()
    return _execute_graph("担保圈识别", query)


def execute_lost_customer(company_name: str, lost_days: int) -> GraphResult:
    safe_name = _escape_literal(company_name)
    query = f"""
    USE anti_fraud_kg;
    MATCH p=(contact)-[:controls|employs|related_to*1..2]-(c:company)
    WHERE c.company.name == '{safe_name}'
      AND c.company.is_lost == true
      AND c.company.lost_days >= {lost_days}
    RETURN p LIMIT 50;
    """.strip()
    return _execute_graph(
        "失联客户追踪",
        query,
        [
            SummaryItem(key="失联主体", value=company_name),
            SummaryItem(key="失联阈值", value=f"{lost_days} 天"),
        ],
    )
