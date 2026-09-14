"""图空间目录：SHOW GRAPHS 为权威，黑名单过滤后可见。"""
from __future__ import annotations

import logging
import re
from typing import Any, Iterable

from app.contracts import GraphSpaceSummary
from config import NEBULA_HIDDEN_GRAPHS, NEBULA_SPACE
from nebula_client import GraphResult, get_client

logger = logging.getLogger(__name__)

SPACE_ID_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,127}$")

DISPLAY_NAMES: dict[str, str] = {
    "anti_fraud_kg": "对公贷款反欺诈图",
    "random_financial_graph_million": "百万随机金融图",
}


class GraphSpaceError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def is_valid_space_id(space_id: str) -> bool:
    return bool(SPACE_ID_PATTERN.fullmatch(space_id))


def _display_name(space_id: str) -> str:
    return DISPLAY_NAMES.get(space_id, space_id)


def parse_id_list(raw: str | Iterable[str] | None) -> list[str]:
    if raw is None:
        items: Iterable[str] = []
    elif isinstance(raw, str):
        items = raw.split(",")
    else:
        items = raw

    parsed: list[str] = []
    seen: set[str] = set()
    for part in items:
        candidate = str(part).strip().strip('"').strip("'")
        if not candidate:
            continue
        if not is_valid_space_id(candidate):
            logger.warning("忽略非法图空间配置项：%r", candidate)
            continue
        if candidate in seen:
            continue
        seen.add(candidate)
        parsed.append(candidate)
    return parsed


def parse_hidden_graphs(raw: str | Iterable[str] | None = None) -> list[str]:
    return parse_id_list(NEBULA_HIDDEN_GRAPHS if raw is None else raw)


def _cell_as_graph_id(cell: Any) -> str | None:
    if isinstance(cell, str):
        candidate = cell.strip().strip('"').strip("'")
        if is_valid_space_id(candidate):
            return candidate
        return None
    if isinstance(cell, dict):
        for key in ("Name", "name", "Graph", "graph", "id"):
            found = _cell_as_graph_id(cell.get(key))
            if found:
                return found
    return None


def parse_graph_names(result: GraphResult) -> list[str]:
    """从 SHOW GRAPHS 结果中提取合法 Graph 名，去重保序。"""
    names: list[str] = []
    seen: set[str] = set()
    name_indexes = [
        index
        for index, column in enumerate(result.column_names)
        if str(column).strip().lower() in {"name", "graph", "id"}
    ]

    for row in result.rows:
        candidates: list[Any]
        if name_indexes:
            candidates = [row[index] for index in name_indexes if index < len(row)]
        else:
            candidates = list(row)

        found: str | None = None
        for cell in candidates:
            found = _cell_as_graph_id(cell)
            if found:
                break
        if found and found not in seen:
            seen.add(found)
            names.append(found)
    return names


def discover_graph_ids() -> list[str]:
    result = get_client().list_graphs()
    if result.error_code != 0:
        raise GraphSpaceError(
            "CATALOG_UNAVAILABLE",
            result.error_msg or "无法从 NebulaGraph 读取图目录",
        )
    return parse_graph_names(result)


def build_space_catalog(
    discovered: Iterable[str],
    *,
    default_space: str | None = None,
    hidden_graphs: str | Iterable[str] | None = None,
) -> list[GraphSpaceSummary]:
    """由发现结果减去黑名单，组装目录。"""
    default = (default_space if default_space is not None else NEBULA_SPACE).strip()
    hidden = set(parse_hidden_graphs(hidden_graphs))
    visible: list[str] = []
    seen: set[str] = set()

    for candidate in discovered:
        space_id = str(candidate).strip().strip('"').strip("'")
        if not space_id:
            continue
        if not is_valid_space_id(space_id):
            logger.warning("忽略非法图空间发现项：%r", space_id)
            continue
        if space_id in hidden or space_id in seen:
            continue
        seen.add(space_id)
        visible.append(space_id)

    if is_valid_space_id(default) and default in seen:
        visible = [default, *[item for item in visible if item != default]]

    return [
        GraphSpaceSummary(
            id=space_id,
            displayName=_display_name(space_id),
            status="ready",
            description=None,
            vertexCount=None,
            edgeCount=None,
            isDefault=space_id == default and is_valid_space_id(default),
        )
        for space_id in visible
    ]


def list_graph_spaces() -> list[GraphSpaceSummary]:
    return build_space_catalog(discover_graph_ids())


def resolve_space(space: str) -> GraphSpaceSummary:
    """校验请求 space：必须在可见目录且 ready。失败不回落默认空间。"""
    space_id = (space or "").strip()
    if not space_id:
        raise GraphSpaceError("SPACE_REQUIRED", "space 为必填字段")
    if not is_valid_space_id(space_id):
        raise GraphSpaceError("SPACE_NOT_FOUND", f"未找到图：{space_id}")
    if space_id in set(parse_hidden_graphs()):
        raise GraphSpaceError("SPACE_FORBIDDEN", f"图已隐藏，不可查询：{space_id}")

    for item in list_graph_spaces():
        if item.id == space_id:
            if item.status != "ready":
                raise GraphSpaceError("SPACE_NOT_READY", f"图空间不可用：{space_id}")
            return item

    raise GraphSpaceError("SPACE_NOT_FOUND", f"未找到图：{space_id}")
