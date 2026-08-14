"""金融图谱平台 v1 API。"""
from __future__ import annotations

from time import perf_counter
from uuid import uuid4

from fastapi import APIRouter, HTTPException

from app.contracts import (
    FeatureCompileResult, FeatureDefinition, FeatureValidationResult,
    GraphExpandRequest, GraphResult, GraphSchemaCatalog, PathFindRequest,
    ReadonlyQueryRequest, ScenarioExecuteRequest, ScenarioTemplate, VertexLookupRequest,
)
from app.core.query_policy import QueryPolicyError, enforce_readonly
from app.services.graph_mapper import map_paths
from app.services.exploration_service import (
    EDGE_TYPES, ENTITY_TYPES, ExplorationQueryError, expand_vertex, find_paths, lookup_vertex,
)
from app.services.scenario_service import (
    ScenarioExecutionError,
    execute_guarantee_circle,
    execute_loan_reflux,
    execute_lost_customer,
    list_scenarios,
)
from app.services.feature_service import (
    FeatureDefinitionError, compile_definition, delete_definition, get_definition,
    list_definitions, save_definition, validate_definition,
)
from nebula_client import get_client

router = APIRouter(prefix="/api/v1", tags=["platform-v1"])


@router.get("/health")
async def health() -> dict[str, str]:
    client = get_client()
    response = client.execute("SHOW TAGS;")
    return {
        "status": "ok" if response.error_code == 0 else "degraded",
        "database": "connected" if response.error_code == 0 else "unavailable",
        "space": getattr(client, "space", "anti_fraud_kg"),
    }


@router.get("/features/definitions", response_model=list[FeatureDefinition])
async def feature_definitions() -> list[FeatureDefinition]:
    return list_definitions()


@router.get("/features/definitions/{definition_id}", response_model=FeatureDefinition)
async def feature_definition(definition_id: str) -> FeatureDefinition:
    try:
        return get_definition(definition_id)
    except FeatureDefinitionError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.put("/features/definitions/{definition_id}", response_model=FeatureDefinition)
async def put_feature_definition(definition_id: str, definition: FeatureDefinition) -> FeatureDefinition:
    if definition_id != definition.id:
        raise HTTPException(status_code=409, detail="路径 ID 与特征定义 ID 不一致")
    try:
        return save_definition(definition)
    except FeatureDefinitionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.delete("/features/definitions/{definition_id}", status_code=204)
async def remove_feature_definition(definition_id: str) -> None:
    try:
        delete_definition(definition_id)
    except FeatureDefinitionError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/features/definitions/validate", response_model=FeatureValidationResult)
async def validate_feature_definition(definition: FeatureDefinition) -> FeatureValidationResult:
    return validate_definition(definition)


@router.post("/features/definitions/compile", response_model=FeatureCompileResult)
async def compile_feature_definition(definition: FeatureDefinition) -> FeatureCompileResult:
    try:
        return compile_definition(definition)
    except FeatureDefinitionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/graph/schema", response_model=GraphSchemaCatalog)
async def graph_schema() -> GraphSchemaCatalog:
    return GraphSchemaCatalog(entityTypes=list(ENTITY_TYPES), edgeTypes=list(EDGE_TYPES))


@router.post("/graph/vertices/lookup", response_model=GraphResult)
async def vertex_lookup(request: VertexLookupRequest) -> GraphResult:
    try:
        return lookup_vertex(request.value.strip(), request.field, request.entity_type)
    except ExplorationQueryError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/graph/expand", response_model=GraphResult)
async def graph_expand(request: GraphExpandRequest) -> GraphResult:
    try:
        return expand_vertex(request.vertex_id.strip(), request.min_hops, request.max_hops, request.edge_types, request.direction)
    except ExplorationQueryError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/graph/paths", response_model=GraphResult)
async def graph_paths(request: PathFindRequest) -> GraphResult:
    try:
        return find_paths(request.start_id.strip(), request.end_id.strip(), request.mode, request.max_hops, request.edge_types)
    except ExplorationQueryError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/scenarios", response_model=list[ScenarioTemplate])
async def scenarios() -> list[ScenarioTemplate]:
    return list_scenarios()


@router.post("/scenarios/loan-reflux/executions", response_model=GraphResult)
async def run_loan_reflux(request: ScenarioExecuteRequest) -> GraphResult:
    company_name = request.parameters.get("companyName")
    if not isinstance(company_name, str) or not company_name.strip():
        raise HTTPException(status_code=422, detail="parameters.companyName 为必填字符串")
    try:
        return execute_loan_reflux(company_name.strip())
    except ScenarioExecutionError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/scenarios/guarantee-circle/executions", response_model=GraphResult)
async def run_guarantee_circle(request: ScenarioExecuteRequest) -> GraphResult:
    company_name = request.parameters.get("companyName")
    if not isinstance(company_name, str) or not company_name.strip():
        raise HTTPException(status_code=422, detail="parameters.companyName 为必填字符串")
    try:
        return execute_guarantee_circle(company_name.strip())
    except ScenarioExecutionError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/scenarios/lost-customer/executions", response_model=GraphResult)
async def run_lost_customer(request: ScenarioExecuteRequest) -> GraphResult:
    company_name = request.parameters.get("companyName")
    lost_days = request.parameters.get("lostDays", 30)
    if not isinstance(company_name, str) or not company_name.strip():
        raise HTTPException(status_code=422, detail="parameters.companyName 为必填字符串")
    if isinstance(lost_days, bool) or not isinstance(lost_days, int) or not 1 <= lost_days <= 3650:
        raise HTTPException(status_code=422, detail="parameters.lostDays 必须是 1-3650 的整数")
    try:
        return execute_lost_customer(company_name.strip(), lost_days)
    except ScenarioExecutionError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/graph/query", response_model=GraphResult)
async def readonly_query(request: ReadonlyQueryRequest) -> GraphResult:
    try:
        query = enforce_readonly(request.query)
    except QueryPolicyError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    trace_id = uuid4().hex
    started = perf_counter()
    response = get_client().execute(query)
    elapsed = int((perf_counter() - started) * 1000)
    if response.error_code != 0:
        raise HTTPException(status_code=400, detail=response.error_msg)
    nodes, edges = map_paths(response.rows)
    return GraphResult(
        title="查询结果",
        nodes=nodes,
        edges=edges,
        columns=response.column_names,
        rows=response.rows,
        traceId=trace_id,
        executionTimeMs=elapsed,
    )
