from __future__ import annotations

import unittest

from app.contracts import GraphEdge, GraphResult


class ContractTests(unittest.TestCase):
    def test_graph_result_serializes_frontend_field_names(self) -> None:
        result = GraphResult(title="test", traceId="trace", executionTimeMs=12)
        payload = result.model_dump(by_alias=True)
        self.assertEqual(payload["traceId"], "trace")
        self.assertEqual(payload["executionTimeMs"], 12)
        self.assertEqual(payload["nodes"], [])
        self.assertEqual(payload["summary"], [])

    def test_edge_uses_g6_source_target_contract(self) -> None:
        edge = GraphEdge(id="e1", source="a", target="b", type="transfer")
        self.assertEqual(edge.source, "a")
        self.assertEqual(edge.target, "b")


if __name__ == "__main__":
    unittest.main()

