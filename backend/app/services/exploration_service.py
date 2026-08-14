"""探索分析的受控 nGQL 构造与执行。"""
from __future__ import annotations

from time import perf_counter
from uuid import uuid4

from app.contracts import GraphResult
from app.services.graph_mapper import map_paths
from nebula_client import get_client

ENTITY_TYPES = ("company", "person", "account", "loan")
EDGE_TYPES = (
    "holds_account", "applied_for", "disbursed_to", "transfer", "guarantees",
    "controls", "shareholder", "employs", "related_to",
)


class ExplorationQueryError(ValueError):
    pass


def _literal(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def _edge_expression(edge_types: list[str]) -> str:
    selected = list(dict.fromkeys(edge_types or EDGE_TYPES))
    invalid = sorted(set(selected) - set(EDGE_TYPES))
    if invalid:
        raise ExplorationQueryError(f"不支持的边类型：{', '.join(invalid)}")
    return "|".join(selected)


def _execute(title: str, query: str) -> GraphResult:
    trace_id = uuid4().hex
    started = perf_counter()
    response = get_client().execute(query)
    elapsed = int((perf_counter() - started) * 1000)
    if response.error_code != 0:
        raise ExplorationQueryError(response.error_msg)
    nodes, edges = map_paths(response.rows)
    return GraphResult(
        title=title, nodes=nodes, edges=edges, columns=response.column_names,
        rows=response.rows, traceId=trace_id, executionTimeMs=elapsed,
        warnings=[] if nodes else ["查询未命中图元素，请检查实体 ID、名称或关系范围。"],
    )


def lookup_vertex(value: str, field: str, entity_type: str | None) -> GraphResult:
    if entity_type and entity_type not in ENTITY_TYPES:
        raise ExplorationQueryError(f"不支持的实体类型：{entity_type}")
    if field == "id":
        query = f"MATCH (v) WHERE id(v) == {_literal(value)} RETURN v LIMIT 20;"
    else:
        if not entity_type:
            raise ExplorationQueryError("按名称查询时必须选择实体类型")
        query = f"MATCH (v:{entity_type}) WHERE v.{entity_type}.name == {_literal(value)} RETURN v LIMIT 20;"
    return _execute("实体查询", query)


def expand_vertex(vertex_id: str, min_hops: int, max_hops: int, edge_types: list[str], direction: str) -> GraphResult:
    if min_hops > max_hops:
        raise ExplorationQueryError("最小跳数不能大于最大跳数")
    edge_expr = _edge_expression(edge_types)
    pattern = {
        "out": f"(s)-[:{edge_expr}*{min_hops}..{max_hops}]->(t)",
        "in": f"(s)<-[:{edge_expr}*{min_hops}..{max_hops}]-(t)",
        "both": f"(s)-[:{edge_expr}*{min_hops}..{max_hops}]-(t)",
    }[direction]
    query = f"MATCH p={pattern} WHERE id(s) == {_literal(vertex_id)} RETURN p LIMIT 200;"
    return _execute(f"{min_hops}-{max_hops} 跳关系展开", query)


def find_paths(start_id: str, end_id: str, mode: str, max_hops: int, edge_types: list[str]) -> GraphResult:
    # FIND PATH 的 OVER 类型列表使用逗号；MATCH 边标签表达式使用竖线。
    edge_expr = _edge_expression(edge_types).replace("|", ",")
    keyword = "ALL PATH" if mode == "all" else "SHORTEST PATH"
    suffix = " | LIMIT 1" if mode == "any-shortest" else (" | LIMIT 100" if mode == "all" else "")
    query = (
        f"FIND {keyword} WITH PROP FROM {_literal(start_id)} TO {_literal(end_id)} "
        f"OVER {edge_expr} UPTO {max_hops} STEPS YIELD path AS p{suffix};"
    )
    return _execute("路径分析", query)
