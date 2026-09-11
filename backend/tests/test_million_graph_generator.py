from __future__ import annotations

import contextlib
import io
import unittest

from generate_million_graph import (
    edge_counts,
    iter_edges,
    iter_vertices,
    main,
    vertex_counts,
)
from generate_random_graph import EDGE_FIELDS, TAG_FIELDS


class MillionGraphGeneratorTests(unittest.TestCase):
    def test_default_scale_is_one_million_vertices_and_three_million_edges(self) -> None:
        vertices = vertex_counts(1_000_000)
        edges = edge_counts(3_000_000)
        self.assertEqual(sum(vertices.values()), 1_000_000)
        self.assertEqual(vertices, {
            "company": 300_000,
            "person": 200_000,
            "account": 400_000,
            "loan": 100_000,
        })
        self.assertEqual(sum(edges.values()), 3_000_000)

    def test_vertex_stream_matches_schema_and_is_deterministic(self) -> None:
        for tag, fields in TAG_FIELDS.items():
            first = list(iter_vertices(tag, 3, seed=8, prefix="large"))
            second = list(iter_vertices(tag, 3, seed=8, prefix="large"))
            self.assertEqual(first, second)
            self.assertTrue(all(len(record.values) == len(fields) for record in first))
            self.assertTrue(all(record.vid.startswith(f"large_{tag[0] if tag != 'account' else 'a'}_") for record in first))

    def test_edge_stream_matches_schema_and_references_known_prefix(self) -> None:
        totals = vertex_counts(1_000)
        for edge_type, fields in EDGE_FIELDS.items():
            records = list(iter_edges(
                edge_type,
                10,
                vertex_totals=totals,
                seed=9,
                prefix="large",
            ))
            self.assertTrue(all(len(record.values) == len(fields) for record in records))
            self.assertTrue(all(record.source.startswith("large_") for record in records))
            self.assertTrue(all(record.target.startswith("large_") for record in records))
            self.assertEqual([record.rank for record in records], list(range(1, 11)))

    def test_dry_run_does_not_connect_to_database(self) -> None:
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            result = main([
                "--vertices", "100",
                "--edges", "300",
                "--space", "dry_million",
                "--dry-run",
            ])
        self.assertEqual(result, 0)
        self.assertIn("vertices=100", output.getvalue())

    def test_existing_business_space_is_rejected(self) -> None:
        error = io.StringIO()
        with contextlib.redirect_stderr(error):
            result = main(["--space", "anti_fraud_kg", "--dry-run"])
        self.assertEqual(result, 2)
        self.assertIn("独立图空间", error.getvalue())


if __name__ == "__main__":
    unittest.main()
