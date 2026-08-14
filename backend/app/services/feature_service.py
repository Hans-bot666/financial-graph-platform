"""特征定义仓储、DAG 校验和受控编译。"""
from __future__ import annotations

import re
from threading import RLock

from app.contracts import (
    FeatureCompileResult, FeatureDefinition, FeatureValidationResult,
)
from app.services.exploration_service import EDGE_TYPES, ENTITY_TYPES


class FeatureDefinitionError(ValueError):
    pass


_definitions: dict[str, FeatureDefinition] = {}
_lock = RLock()
_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_OPERATORS = {"=", "==", "!=", ">", ">=", "<", "<="}


def list_definitions() -> list[FeatureDefinition]:
    with _lock:
        return sorted(_definitions.values(), key=lambda item: item.updated_at, reverse=True)


def get_definition(definition_id: str) -> FeatureDefinition:
    with _lock:
        definition = _definitions.get(definition_id)
    if definition is None:
        raise FeatureDefinitionError("特征定义不存在")
    return definition


def save_definition(definition: FeatureDefinition) -> FeatureDefinition:
    if definition.status == "published":
        raise FeatureDefinitionError("发布版本不可通过草稿接口覆盖")
    with _lock:
        current = _definitions.get(definition.id)
        if current and current.status == "published":
            raise FeatureDefinitionError("已发布版本不可修改，请创建新版本")
        _definitions[definition.id] = definition
    return definition


def delete_definition(definition_id: str) -> None:
    with _lock:
        current = _definitions.get(definition_id)
        if current and current.status == "published":
            raise FeatureDefinitionError("已发布版本不可删除")
        _definitions.pop(definition_id, None)


def validate_definition(definition: FeatureDefinition) -> FeatureValidationResult:
    errors: list[str] = []
    warnings: list[str] = []
    node_ids = [node.id for node in definition.nodes]
    ids = set(node_ids)
    if len(ids) != len(node_ids):
        errors.append("算子 ID 不能重复")
    inputs = [node for node in definition.nodes if node.kind == "input"]
    outputs = [node for node in definition.nodes if node.kind == "output"]
    if len(inputs) != 1:
        errors.append(f"必须且只能有一个实体输入，当前 {len(inputs)} 个")
    if not outputs:
        errors.append("至少需要一个特征输出")
    if definition.entity_type not in ENTITY_TYPES:
        errors.append(f"不支持的实体类型：{definition.entity_type}")

    incoming = {node.id: 0 for node in definition.nodes}
    outgoing: dict[str, list[str]] = {node.id: [] for node in definition.nodes}
    edge_pairs: set[tuple[str, str]] = set()
    for edge in definition.edges:
        if edge.source not in ids or edge.target not in ids:
            errors.append(f"连线 {edge.id} 引用了不存在的算子")
            continue
        if edge.source == edge.target:
            errors.append("算子不能连接到自身")
        if (edge.source, edge.target) in edge_pairs:
            errors.append(f"重复连线：{edge.source} → {edge.target}")
        edge_pairs.add((edge.source, edge.target))
        incoming[edge.target] += 1
        outgoing[edge.source].append(edge.target)

    queue = [node.id for node in definition.nodes if incoming[node.id] == 0]
    order: list[str] = []
    while queue:
        node_id = queue.pop(0)
        order.append(node_id)
        for target in outgoing[node_id]:
            incoming[target] -= 1
            if incoming[target] == 0:
                queue.append(target)
    if len(order) != len(definition.nodes):
        errors.append("流程存在环路，请删除形成循环的连线")

    connected = {value for edge in definition.edges for value in (edge.source, edge.target)}
    for node in definition.nodes:
        if node.id not in connected:
            warnings.append(f"「{node.title}」尚未连接")
        if node.kind == "path":
            min_hop = _as_int(node.config.get("minHop"), 1)
            max_hop = _as_int(node.config.get("maxHop"), 1)
            if not 1 <= min_hop <= max_hop <= 6:
                errors.append(f"「{node.title}」跳数必须满足 1 ≤ 最小跳数 ≤ 最大跳数 ≤ 6")
            edge_types = _csv(node.config.get("edgeTypes", "")) or list(EDGE_TYPES)
            invalid = sorted(set(edge_types) - set(EDGE_TYPES))
            if invalid:
                errors.append(f"不支持的边类型：{', '.join(invalid)}")
        if any(value in ("待配置", "请选择字段") for value in node.config.values()):
            warnings.append(f"「{node.title}」存在未完成配置")
        if node.kind == "output":
            destinations = _csv(node.config.get("destinations", ""))
            allowed_destinations = {"graph", "external", "explore", "api"}
            invalid_destinations = sorted(set(destinations) - allowed_destinations)
            if not destinations:
                errors.append(f"「{node.title}」至少选择一个输出目的地")
            if invalid_destinations:
                errors.append(f"「{node.title}」包含不支持的输出目的地：{', '.join(invalid_destinations)}")
            if "graph" in destinations and not _IDENTIFIER.fullmatch(str(node.config.get("graphProperty", ""))):
                errors.append(f"「{node.title}」写回原图时必须配置合法属性名")
            if "external" in destinations and not str(node.config.get("storageRef", "")).strip():
                errors.append(f"「{node.title}」外部存储必须配置目标引用")
    return FeatureValidationResult(valid=not errors, errors=errors, warnings=warnings, order=order)


def compile_definition(definition: FeatureDefinition) -> FeatureCompileResult:
    validation = validate_definition(definition)
    if not validation.valid:
        raise FeatureDefinitionError("；".join(validation.errors))
    by_id = {node.id: node for node in definition.nodes}
    ordered = [by_id[node_id] for node_id in validation.order]
    offline = any(node.kind == "algorithm" for node in ordered)
    ir = {
        "irVersion": "1.0", "featureId": definition.id, "name": definition.name,
        "graphInstanceId": definition.graph_instance_id, "entity": definition.entity_type,
        "version": definition.version,
        "nodes": [{"id": node.id, "op": node.kind.upper(), "config": node.config} for node in ordered],
        "edges": [[edge.source, edge.target] for edge in definition.edges],
        "runtime": "offline-job" if offline else "bounded-online",
        "limits": {"maxHop": 6, "maxRows": 500, "timeoutMs": 2000},
    }
    if offline:
        return FeatureCompileResult(validation=validation, ir=ir, target="offline-job")
    return FeatureCompileResult(
        validation=validation, ir=ir, target="ngql-template",
        queryTemplate=_compile_ngql(ordered, definition.entity_type), parameters=["entityKey"],
    )


def _compile_ngql(nodes: list, entity_type: str) -> str:
    path_nodes = [node for node in nodes if node.kind == "path"]
    if len(path_nodes) != 1:
        raise FeatureDefinitionError("首期在线编译必须且只能包含一个路径算子")
    path = path_nodes[0]
    edge_types = _csv(path.config.get("edgeTypes", "")) or list(EDGE_TYPES)
    if not all(_IDENTIFIER.fullmatch(value) and value in EDGE_TYPES for value in edge_types):
        raise FeatureDefinitionError("路径包含未注册的边类型")
    min_hop = _as_int(path.config.get("minHop"), 1)
    max_hop = _as_int(path.config.get("maxHop"), 1)
    direction = str(path.config.get("direction", "双向"))
    edge_expr = "|".join(edge_types)
    pattern = {
        "出边": f"(s:{entity_type})-[:{edge_expr}*{min_hop}..{max_hop}]->(t)",
        "out": f"(s:{entity_type})-[:{edge_expr}*{min_hop}..{max_hop}]->(t)",
        "入边": f"(s:{entity_type})<-[:{edge_expr}*{min_hop}..{max_hop}]-(t)",
        "in": f"(s:{entity_type})<-[:{edge_expr}*{min_hop}..{max_hop}]-(t)",
        "双向": f"(s:{entity_type})-[:{edge_expr}*{min_hop}..{max_hop}]-(t)",
        "both": f"(s:{entity_type})-[:{edge_expr}*{min_hop}..{max_hop}]-(t)",
    }.get(direction)
    if pattern is None:
        raise FeatureDefinitionError("路径方向仅支持出边、入边或双向")
    predicates = ["id(s) == $entityKey"]
    for node in (item for item in nodes if item.kind == "filter"):
        field = str(node.config.get("field", ""))
        operator = str(node.config.get("operator", ""))
        value = node.config.get("value")
        if not _IDENTIFIER.fullmatch(field):
            raise FeatureDefinitionError(f"「{node.title}」字段或操作符不受支持")
        if operator in {"最近", "within"}:
            match = re.fullmatch(r"([1-9][0-9]{0,3})([dhm])", str(value))
            if not match:
                raise FeatureDefinitionError(f"「{node.title}」时间窗仅支持 30d、12h、15m 格式")
            amount, unit = match.groups()
            unit_name = {"d": "days", "h": "hours", "m": "minutes"}[unit]
            predicates.append(f"datetime(t.{field}) >= datetime() - duration({{{unit_name}: {amount}}})")
        elif operator in _OPERATORS:
            predicates.append(f"t.{field} {operator.replace('==', '=')} {_literal(value)}")
        else:
            raise FeatureDefinitionError(f"「{node.title}」字段或操作符不受支持")
    aggregate = next((node for node in nodes if node.kind == "aggregate"), None)
    expression = "count(DISTINCT id(t))"
    if aggregate:
        function = str(aggregate.config.get("function", "COUNT DISTINCT")).upper()
        if function not in {"COUNT", "COUNT DISTINCT"}:
            raise FeatureDefinitionError("首期在线聚合仅支持 COUNT 和 COUNT DISTINCT")
        expression = "count(DISTINCT id(t))" if function == "COUNT DISTINCT" else "count(id(t))"
    return f"MATCH p={pattern} WHERE {' AND '.join(predicates)} RETURN {expression} AS feature_value LIMIT 1;"


def _csv(value: object) -> list[str]:
    if not isinstance(value, str) or value in ("", "全部"):
        return []
    return list(dict.fromkeys(part.strip() for part in value.split(",") if part.strip()))


def _as_int(value: object, default: int) -> int:
    if isinstance(value, bool):
        return default
    try:
        return int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default


def _literal(value: object) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    escaped = str(value).replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'
