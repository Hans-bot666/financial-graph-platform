from __future__ import annotations

import unittest
from unittest.mock import patch

from app.services.graph_space_service import (
    GraphSpaceError,
    build_space_catalog,
    is_valid_space_id,
    parse_graph_names,
    resolve_space,
)
from nebula_client import GraphResult


class GraphSpaceServiceTests(unittest.TestCase):
    def test_catalog_uses_discovered_graphs_and_marks_default(self) -> None:
        catalog = build_space_catalog(
            ["random_financial_graph_million", "anti_fraud_kg"],
            default_space="anti_fraud_kg",
            hidden_graphs="",
        )
        self.assertEqual(
            [item.id for item in catalog],
            ["anti_fraud_kg", "random_financial_graph_million"],
        )
        self.assertTrue(catalog[0].is_default)
        self.assertEqual(catalog[0].display_name, "对公贷款反欺诈图")
        self.assertEqual(catalog[1].display_name, "百万随机金融图")
        self.assertFalse(catalog[1].is_default)

    def test_blacklist_hides_graphs(self) -> None:
        catalog = build_space_catalog(
            ["anti_fraud_kg", "random_financial_graph_million", "scratch_graph"],
            default_space="anti_fraud_kg",
            hidden_graphs="scratch_graph,random_financial_graph_million",
        )
        self.assertEqual([item.id for item in catalog], ["anti_fraud_kg"])

    def test_invalid_discovered_ids_are_dropped(self) -> None:
        catalog = build_space_catalog(
            ["anti_fraud_kg", "bad-name", ";drop", "ok_space"],
            default_space="anti_fraud_kg",
            hidden_graphs="",
        )
        self.assertEqual([item.id for item in catalog], ["anti_fraud_kg", "ok_space"])

    def test_default_absent_from_db_is_not_injected(self) -> None:
        catalog = build_space_catalog(
            ["scratch_graph"],
            default_space="anti_fraud_kg",
            hidden_graphs="",
        )
        self.assertEqual([item.id for item in catalog], ["scratch_graph"])
        self.assertFalse(catalog[0].is_default)

    def test_parse_graph_names_from_name_column(self) -> None:
        result = GraphResult(0, "", ["Name"], [["anti_fraud_kg"], ['"scratch_graph"']])
        self.assertEqual(parse_graph_names(result), ["anti_fraud_kg", "scratch_graph"])

    def test_parse_graph_names_from_nebula5_columns(self) -> None:
        result = GraphResult(
            0,
            "",
            ["name", "graph_type", "schema", "owner", "extra"],
            [["anti_fraud_kg", "anti_fraud_kg_type", "/default_schema", "root", None]],
        )
        self.assertEqual(parse_graph_names(result), ["anti_fraud_kg"])

    def test_space_id_format(self) -> None:
        self.assertTrue(is_valid_space_id("anti_fraud_kg"))
        self.assertFalse(is_valid_space_id("anti-fraud"))
        self.assertFalse(is_valid_space_id("1abc"))
        self.assertFalse(is_valid_space_id(""))

    def test_resolve_space_rejects_unknown(self) -> None:
        catalog = build_space_catalog(["anti_fraud_kg"], default_space="anti_fraud_kg", hidden_graphs="")
        with patch("app.services.graph_space_service.list_graph_spaces", return_value=catalog):
            with patch("app.services.graph_space_service.parse_hidden_graphs", return_value=[]):
                with self.assertRaises(GraphSpaceError) as ctx:
                    resolve_space("not_in_catalog")
        self.assertEqual(ctx.exception.code, "SPACE_NOT_FOUND")

    def test_resolve_space_rejects_hidden(self) -> None:
        catalog = build_space_catalog(
            ["anti_fraud_kg"],
            default_space="anti_fraud_kg",
            hidden_graphs="scratch_graph",
        )
        with patch("app.services.graph_space_service.list_graph_spaces", return_value=catalog):
            with patch("app.services.graph_space_service.parse_hidden_graphs", return_value=["scratch_graph"]):
                with self.assertRaises(GraphSpaceError) as ctx:
                    resolve_space("scratch_graph")
        self.assertEqual(ctx.exception.code, "SPACE_FORBIDDEN")

    def test_resolve_space_accepts_ready(self) -> None:
        catalog = build_space_catalog(
            ["anti_fraud_kg", "random_financial_graph_million"],
            default_space="anti_fraud_kg",
            hidden_graphs="",
        )
        with patch("app.services.graph_space_service.list_graph_spaces", return_value=catalog):
            with patch("app.services.graph_space_service.parse_hidden_graphs", return_value=[]):
                resolved = resolve_space("random_financial_graph_million")
        self.assertEqual(resolved.id, "random_financial_graph_million")


if __name__ == "__main__":
    unittest.main()
