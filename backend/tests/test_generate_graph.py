from __future__ import annotations

import contextlib
import io
import unittest

from generate_graph import (
    declared_edge_type_name,
    edge_counts,
    edge_statements,
    iter_edges,
    iter_vertices,
    load_schema_statements,
    main,
    split_total,
    vertex_counts,
    vertex_statement,
)


class GenerateGraphTests(unittest.TestCase):
    def test_default_total_is_one_million_elements(self) -> None:
        vertices, edges = split_total(1_000_000)
        self.assertEqual(vertices + edges, 1_000_000)
        self.assertEqual(vertices, 250_000)
        self.assertEqual(edges, 750_000)
        self.assertEqual(sum(vertex_counts(vertices).values()), vertices)
        self.assertEqual(sum(edge_counts(edges).values()), edges)

    def test_schema_file_declares_company_and_applied_for_types(self) -> None:
        statements = load_schema_statements()
        self.assertTrue(statements[0].startswith("CREATE GRAPH TYPE IF NOT EXISTS anti_fraud_kg_type"))
        self.assertIn("NODE company (LABELS company {id STRING PRIMARY KEY", statements[0])
        self.assertIn("EDGE applied_for_company_loan (company)-[:applied_for", statements[0])
        self.assertEqual(statements[1], "CREATE GRAPH IF NOT EXISTS anti_fraud_kg TYPED anti_fraud_kg_type")
        self.assertEqual(statements[2], "SESSION SET GRAPH anti_fraud_kg")

    def test_vertex_insert_uses_typed_at_syntax(self) -> None:
        row = next(iter_vertices("company", 1, seed=1))
        statement = vertex_statement("company", [row])
        self.assertTrue(statement.startswith("INSERT (@company{id: \"c_0000000\""))
        self.assertIn("凯达建材有限公司", statement)

    def test_edge_insert_uses_declared_type_and_typed_match(self) -> None:
        totals = vertex_counts(100)
        applied = list(iter_edges("applied_for", 20, vertex_totals=totals, seed=3))
        statements = edge_statements("applied_for", applied)
        joined = "\n".join(statements)
        self.assertIn("FOR re IN batch_rows", joined)
        self.assertTrue(
            "[@applied_for_company_loan{" in joined or "[@applied_for_person_loan{" in joined,
            joined,
        )
        self.assertEqual(
            declared_edge_type_name("applied_for", "company", "loan"),
            "applied_for_company_loan",
        )
        transfer = list(iter_edges("transfer", 2, vertex_totals=totals, seed=3))
        transfer_sql = edge_statements("transfer", transfer)[0]
        self.assertIn("MATCH (s@account{id: re.src_id}), (d@account{id: re.dst_id})", transfer_sql)
        self.assertIn("INSERT (s)-[@transfer{", transfer_sql)

    def test_dry_run_does_not_connect(self) -> None:
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            result = main(["--total", "400", "--dry-run"])
        self.assertEqual(result, 0)
        self.assertIn("合计=400", output.getvalue())
        self.assertIn("INSERT (@company{", output.getvalue())

    def test_write_requires_yes(self) -> None:
        error = io.StringIO()
        with contextlib.redirect_stderr(error):
            result = main(["--total", "400"])
        self.assertEqual(result, 2)
        self.assertIn("--yes", error.getvalue())

    def test_edges_use_unique_source_target_pairs(self) -> None:
        totals = {"company": 20, "person": 20, "account": 40, "loan": 20}
        rows = list(iter_edges("disbursed_to", 80, vertex_totals=totals, seed=20260914))
        pairs = {(row.source, row.target) for row in rows}
        self.assertEqual(len(pairs), 80)
        with self.assertRaises(RuntimeError):
            list(iter_edges("disbursed_to", 801, vertex_totals=totals, seed=1))


if __name__ == "__main__":
    unittest.main()
