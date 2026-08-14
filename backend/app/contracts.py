"""统一 API 契约。

这些模型是 React/G6 前端和图服务之间的稳定边界。数据库 SDK 的
字段形态不得直接泄漏到 HTTP API。
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class ApiError(BaseModel):
    code: str
    message: str
    trace_id: str | None = Field(default=None, alias="traceId")
    details: dict[str, Any] | None = None

    model_config = {"populate_by_name": True}


class GraphNode(BaseModel):
    id: str
    label: str
    type: str
    properties: dict[str, Any] = Field(default_factory=dict)
    risk: int | float | None = None


class GraphEdge(BaseModel):
    id: str
    source: str
    target: str
    type: str
    label: str | None = None
    properties: dict[str, Any] = Field(default_factory=dict)


class SummaryItem(BaseModel):
    key: str
    value: str


class GraphResult(BaseModel):
    title: str
    nodes: list[GraphNode] = Field(default_factory=list)
    edges: list[GraphEdge] = Field(default_factory=list)
    columns: list[str] = Field(default_factory=list)
    rows: list[list[Any]] = Field(default_factory=list)
    summary: list[SummaryItem] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    trace_id: str = Field(alias="traceId")
    execution_time_ms: int = Field(ge=0, alias="executionTimeMs")
    truncated: bool = False

    model_config = {"populate_by_name": True}


class ScenarioParameter(BaseModel):
    name: str
    label: str
    type: str
    required: bool = True
    default: Any | None = None


class ScenarioTemplate(BaseModel):
    id: str
    name: str
    category: str
    version: str
    description: str
    parameters: list[ScenarioParameter]


class ScenarioExecuteRequest(BaseModel):
    parameters: dict[str, Any]


class ReadonlyQueryRequest(BaseModel):
    query: str = Field(min_length=1, max_length=20_000)


class VertexLookupRequest(BaseModel):
    value: str = Field(min_length=1, max_length=256)
    field: Literal["id", "name"] = "id"
    entity_type: str | None = Field(default=None, alias="entityType")

    model_config = {"populate_by_name": True}


class GraphExpandRequest(BaseModel):
    vertex_id: str = Field(min_length=1, max_length=256, alias="vertexId")
    min_hops: int = Field(default=1, ge=1, le=6, alias="minHops")
    max_hops: int = Field(default=1, ge=1, le=6, alias="maxHops")
    edge_types: list[str] = Field(default_factory=list, alias="edgeTypes")
    direction: Literal["both", "out", "in"] = "both"

    model_config = {"populate_by_name": True}


class PathFindRequest(BaseModel):
    start_id: str = Field(min_length=1, max_length=256, alias="startId")
    end_id: str = Field(min_length=1, max_length=256, alias="endId")
    mode: Literal["shortest", "all", "any-shortest"] = "shortest"
    max_hops: int = Field(default=6, ge=1, le=10, alias="maxHops")
    edge_types: list[str] = Field(default_factory=list, alias="edgeTypes")

    model_config = {"populate_by_name": True}


class GraphSchemaCatalog(BaseModel):
    entity_types: list[str] = Field(alias="entityTypes")
    edge_types: list[str] = Field(alias="edgeTypes")

    model_config = {"populate_by_name": True}


FeatureOperatorKind = Literal[
    "input", "filter", "path", "pattern", "aggregate", "logic", "algorithm", "output"
]


class FeatureOperator(BaseModel):
    id: str = Field(min_length=1, max_length=128)
    kind: FeatureOperatorKind
    title: str = Field(min_length=1, max_length=128)
    description: str = Field(default="", max_length=512)
    x: float = 0
    y: float = 0
    config: dict[str, str | int | float | bool] = Field(default_factory=dict)


class FeatureFlowEdge(BaseModel):
    id: str = Field(min_length=1, max_length=128)
    source: str = Field(min_length=1, max_length=128)
    target: str = Field(min_length=1, max_length=128)


class FeatureDefinition(BaseModel):
    id: str = Field(min_length=1, max_length=128)
    name: str = Field(min_length=1, max_length=256)
    graph_instance_id: str = Field(min_length=1, max_length=128, alias="graphInstanceId")
    entity_type: str = Field(min_length=1, max_length=64, alias="entityType")
    version: int = Field(default=1, ge=1)
    status: Literal["draft", "validated", "published"] = "draft"
    nodes: list[FeatureOperator] = Field(max_length=100)
    edges: list[FeatureFlowEdge] = Field(max_length=200)
    updated_at: str = Field(alias="updatedAt")

    model_config = {"populate_by_name": True}


class FeatureValidationResult(BaseModel):
    valid: bool
    errors: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    order: list[str] = Field(default_factory=list)


class FeatureCompileResult(BaseModel):
    validation: FeatureValidationResult
    ir: dict[str, Any]
    target: Literal["ngql-template", "offline-job"]
    query_template: str | None = Field(default=None, alias="queryTemplate")
    parameters: list[str] = Field(default_factory=list)

    model_config = {"populate_by_name": True}
