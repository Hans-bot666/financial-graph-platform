from __future__ import annotations

import unittest

from app.services.graph_mapper import map_paths


class GraphMapperTests(unittest.TestCase):
    def test_maps_standalone_vertex_result(self) -> None:
        nodes, edges = map_paths([[{"vid": "c1", "tags": {"company": {"name": "企业A"}}}]])
        self.assertEqual(nodes[0].id, "c1")
        self.assertEqual(nodes[0].type, "company")
        self.assertEqual(edges, [])

    def test_maps_nebula_path_to_g6_contract(self) -> None:
        rows = [[{
            "nodes": [
                {"vid": "c1", "tags": {"company": {"name": "企业A", "risk_score": 80}}},
                {"vid": "a1", "tags": {"account": {"name": "账户1"}}},
            ],
            "edges": [{
                "src": "c1", "dst": "a1", "type": "holds_account", "rank": 0,
                "props": {"relation": "基本户"},
            }],
        }]]
        nodes, edges = map_paths(rows)
        self.assertEqual([node.id for node in nodes], ["c1", "a1"])
        self.assertEqual(edges[0].source, "c1")
        self.assertEqual(edges[0].target, "a1")
        self.assertEqual(edges[0].label, "基本户")

    def test_deduplicates_same_edge_across_paths(self) -> None:
        edge = {"src": "p1", "dst": "c1", "type": "controls", "rank": 0, "props": {"relation": "法人"}}
        rows = [
            [{"nodes": [], "edges": [edge]}],
            [{"nodes": [], "edges": [edge]}],
        ]
        _, edges = map_paths(rows)
        self.assertEqual(len(edges), 1)
        self.assertEqual(edges[0].id, "p1:controls:0:c1")


if __name__ == "__main__":
    unittest.main()
