"""图空间目录与校验（白名单权威，非 SHOW SPACES）。"""
from __future__ import annotations

import logging
import re
from typing import Iterable

from app.contracts import GraphSpaceSummary
from config import NEBULA_EXTRA_SPACES, NEBULA_SPACE

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


def _parse_extra_spaces(raw: str | None = None) -> list[str]:
    text = NEBULA_EXTRA_SPACES if raw is None else raw
    items: list[str] = []
    for part in text.split(","):
        candidate = part.strip()
        if not candidate:
            continue
        if not is_valid_space_id(candidate):
            logger.warning("忽略非法图空间配置项：%r", candidate)
            continue
        items.append(candidate)
    return items


def build_space_catalog(
    default_space: str | None = None,
    extra_spaces: str | Iterable[str] | None = None,
) -> list[GraphSpaceSummary]:
    """构建白名单目录：默认空间 + 额外空间，去重保序。"""
    default = (default_space if default_space is not None else NEBULA_SPACE).strip()
    ordered: list[str] = []

    if is_valid_space_id(default):
        ordered.append(default)
    else:
        logger.error("默认图空间非法，已跳过：%r", default)

    if isinstance(extra_spaces, str) or extra_spaces is None:
        extras = _parse_extra_spaces(extra_spaces)
    else:
        extras = []
        for candidate in extra_spaces:
            value = str(candidate).strip()
            if not value:
                continue
            if not is_valid_space_id(value):
                logger.warning("忽略非法图空间配置项：%r", value)
                continue
            extras.append(value)

    for space_id in extras:
        if space_id not in ordered:
            ordered.append(space_id)

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
        for space_id in ordered
    ]


def list_graph_spaces() -> list[GraphSpaceSummary]:
    return build_space_catalog()


def resolve_space(space: str) -> GraphSpaceSummary:
    """校验请求 space：必须在目录且 ready。失败不回落默认空间。"""
    space_id = (space or "").strip()
    if not space_id:
        raise GraphSpaceError("SPACE_REQUIRED", "space 为必填字段")
    if not is_valid_space_id(space_id):
        raise GraphSpaceError("SPACE_NOT_FOUND", f"未登记的图空间：{space_id}")

    for item in list_graph_spaces():
        if item.id == space_id:
            if item.status != "ready":
                raise GraphSpaceError("SPACE_NOT_READY", f"图空间不可用：{space_id}")
            return item

    raise GraphSpaceError("SPACE_NOT_FOUND", f"未登记的图空间：{space_id}")
