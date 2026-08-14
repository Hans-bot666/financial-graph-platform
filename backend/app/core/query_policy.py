"""自由查询的第一层安全护栏。

这是词法级 MVP，后续应替换为完整 nGQL parser/AST 策略。默认拒绝所有
写入、DDL、权限和管理语句，并强制结果上限。
"""
from __future__ import annotations

import re


class QueryPolicyError(ValueError):
    pass


_FORBIDDEN = re.compile(
    r"\b(INSERT|UPDATE|UPSERT|DELETE|CREATE|ALTER|DROP|CLEAR|REBUILD|"
    r"GRANT|REVOKE|CHANGE|SUBMIT|ADD\s+HOSTS?|REMOVE\s+HOSTS?|BALANCE|"
    r"DOWNLOAD|INGEST|KILL)\b",
    re.IGNORECASE,
)
_LIMIT = re.compile(r"\bLIMIT\s+(\d+)\b", re.IGNORECASE)


def enforce_readonly(query: str, max_rows: int = 500) -> str:
    normalized = query.strip()
    if not normalized:
        raise QueryPolicyError("查询不能为空")
    if _FORBIDDEN.search(normalized):
        raise QueryPolicyError("只读查询接口禁止执行写入、DDL 或管理语句")

    limits = [int(match) for match in _LIMIT.findall(normalized)]
    if limits and max(limits) > max_rows:
        raise QueryPolicyError(f"LIMIT 不能超过 {max_rows}")

    # SHOW / DESCRIBE / EXPLAIN / PROFILE 自身不是行集查询，不能尾接 LIMIT。
    needs_limit = bool(re.search(r"\b(RETURN|YIELD)\b", normalized, re.IGNORECASE))
    if not limits and needs_limit:
        normalized = normalized.rstrip(";") + f" LIMIT {max_rows};"
    return normalized
