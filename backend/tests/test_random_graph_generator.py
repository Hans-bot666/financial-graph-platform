from __future__ import annotations

import contextlib
import io
import unittest

from generate_random_graph import (
    EDGE_FIELDS,
    TAG_FIELDS,
    build_random_graph,
    edge_statement,
    main,
    vertex_statement,
)


class RandomGraphGeneratorTests(unittest.TestCase):
    def test_default_dataset_has_exact_requested_counts(self) -> None:
        graph = build_random_graph(vertex_count=10_000, edge_count=30_000, seed=7, prefix="case")
        self.assertEqual(graph.vertex_count, 10_000)
        self.assertEqual(graph.edge_count, 30_000)
        self.assertEqual(len(graph.vertices["company"]), 3_000)
        self.assertEqual(len(graph.vertices["person"]), 2_000)
        self.assertEqual(len(graph.vertices["account"]), 4_000)
        self.assertEqual(len(graph.vertices["loan"]), 1_000)

    def test_generation_is_deterministic_for_same_seed(self) -> None:
        first = build_random_graph(vertex_count=100, edge_count=200, seed=42, prefix="same")
        second = build_random_graph(vertex_count=100, edge_count=200, seed=42, prefix="same")
        self.assertEqual(first.vertices, second.vertices)
        self.assertEqual(first.edges, second.edges)

    def test_records_match_schema_field_counts(self) -> None:
        graph = build_random_graph(vertex_count=100, edge_count=90, seed=9, prefix="schema")
        for tag, records in graph.vertices.items():
            self.assertTrue(records)
            self.assertTrue(all(len(record.values) == len(TAG_FIELDS[tag]) for record in records))
        for edge_type, records in graph.edges.items():
            self.assertTrue(records)
            self.assertTrue(all(len(record.values) == len(EDGE_FIELDS[edge_type]) for record in records))

    def test_ngql_statements_escape_values_and_include_edge_rank(self) -> None:
        graph = build_random_graph(vertex_count=100, edge_count=90, seed=3, prefix="ngql")
        vertex_ngql = vertex_statement("company", graph.vertices["company"][:2])
        edge_ngql = edge_statement("transfer", graph.edges["transfer"][:2])
        self.assertIn("INSERT VERTEX company(", vertex_ngql)
        self.assertIn('"ngql_c_000000":', vertex_ngql)
        self.assertIn("INSERT EDGE transfer(", edge_ngql)
        self.assertRegex(edge_ngql, r'"ngql_a_\d{6}" -> "ngql_a_\d{6}"@\d+:')

    def test_dry_run_does_not_require_database(self) -> None:
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            exit_code = main([
                "--vertices", "100",
                "--edges", "90",
                "--seed", "1",
                "--prefix", "dry",
                "--dry-run",
            ])
        self.assertEqual(exit_code, 0)
        self.assertIn("100 个顶点", output.getvalue())
        self.assertIn("nGQL 预览", output.getvalue())

    def test_write_requires_explicit_confirmation(self) -> None:
        error = io.StringIO()
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(error):
            exit_code = main(["--vertices", "100", "--edges", "90"])
        self.assertEqual(exit_code, 2)
        self.assertIn("--yes", error.getvalue())


if __name__ == "__main__":
    unittest.main()
