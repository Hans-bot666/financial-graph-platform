"""Nebula 原生结果到统一 GraphResult 契约的映射。"""
from __future__ import annotations

from typing import Any

from app.contracts import GraphEdge, GraphNode


def map_paths(rows: list[list[Any]]) -> tuple[list[GraphNode], list[GraphEdge]]:
    nodes: dict[str, GraphNode] = {}
    edges: dict[str, GraphEdge] = {}

    def add_node(raw_node: dict[str, Any]) -> None:
        node_id = str(raw_node.get("id") or raw_node.get("vid") or "")
        if not node_id or node_id in nodes:
            return
        tags = raw_node.get("tags") or {}
        node_type = str(raw_node.get("type") or "unknown")
        properties: dict[str, Any] = dict(raw_node)
        if tags:
            node_type, tag_properties = next(iter(tags.items()))
            properties = dict(tag_properties)
        nodes[node_id] = GraphNode(
            id=node_id,
            label=str(properties.get("name") or raw_node.get("name") or node_id),
            type=node_type,
            properties=properties,
            risk=properties.get("risk_score") or raw_node.get("risk_score"),
        )

    def add_path(path: dict[str, Any]) -> None:
        for raw_node in path.get("nodes", []):
            add_node(raw_node)

        for raw_edge in path.get("edges", []):
            source = str(raw_edge.get("source") or raw_edge.get("from") or raw_edge.get("src") or "")
            target = str(raw_edge.get("target") or raw_edge.get("to") or raw_edge.get("dst") or "")
            if not source or not target:
                continue
            edge_type = str(raw_edge.get("type") or "unknown")
            rank = raw_edge.get("rank", 0)
            edge_id = str(raw_edge.get("id") or f"{source}:{edge_type}:{rank}:{target}")
            properties = dict(raw_edge.get("properties") or raw_edge.get("props") or {})
            label = (
                raw_edge.get("label")
                or properties.get("memo")
                or properties.get("relation")
                or properties.get("position")
                or properties.get("guarantee_type")
                or edge_type
            )
            edges[edge_id] = GraphEdge(
                id=edge_id,
                source=source,
                target=target,
                type=edge_type,
                label=str(label),
                properties=properties,
            )

    for row in rows:
        for cell in row:
            if not isinstance(cell, dict):
                continue
            if "nodes" in cell and "edges" in cell:
                add_path(cell)
            elif "vid" in cell or ("id" in cell and ("tags" in cell or "type" in cell)):
                add_node(cell)
            for value in cell.values():
                if isinstance(value, dict) and "nodes" in value and "edges" in value:
                    add_path(value)
                elif isinstance(value, dict) and ("vid" in value or ("id" in value and ("tags" in value or "type" in value))):
                    add_node(value)

    return list(nodes.values()), list(edges.values())
