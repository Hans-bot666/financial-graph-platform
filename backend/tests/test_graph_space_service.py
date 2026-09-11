from __future__ import annotations

import unittest
from unittest.mock import patch

from app.services.graph_space_service import (
    GraphSpaceError,
    build_space_catalog,
    is_valid_space_id,
    resolve_space,
)


class GraphSpaceServiceTests(unittest.TestCase):
    def test_default_catalog_contains_only_default_space(self) -> None:
        catalog = build_space_catalog(default_space="anti_fraud_kg", extra_spaces="")
        self.assertEqual([item.id for item in catalog], ["anti_fraud_kg"])
        self.assertTrue(catalog[0].is_default)
        self.assertEqual(catalog[0].display_name, "对公贷款反欺诈图")
        self.assertEqual(catalog[0].status, "ready")

    def test_extra_spaces_are_deduped_and_ordered(self) -> None:
        catalog = build_space_catalog(
            default_space="anti_fraud_kg",
            extra_spaces="random_financial_graph_million,anti_fraud_kg,random_financial_graph_million",
        )
        self.assertEqual(
            [item.id for item in catalog],
            ["anti_fraud_kg", "random_financial_graph_million"],
        )
        self.assertEqual(catalog[1].display_name, "百万随机金融图")
        self.assertFalse(catalog[1].is_default)

    def test_invalid_space_ids_are_dropped(self) -> None:
        catalog = build_space_catalog(
            default_space="anti_fraud_kg",
            extra_spaces="bad-name,;drop,ok_space",
        )
        self.assertEqual([item.id for item in catalog], ["anti_fraud_kg", "ok_space"])

    def test_space_id_format(self) -> None:
        self.assertTrue(is_valid_space_id("anti_fraud_kg"))
        self.assertFalse(is_valid_space_id("anti-fraud"))
        self.assertFalse(is_valid_space_id("1abc"))
        self.assertFalse(is_valid_space_id(""))

    def test_resolve_space_rejects_unknown(self) -> None:
        with patch(
            "app.services.graph_space_service.list_graph_spaces",
            return_value=build_space_catalog("anti_fraud_kg", ""),
        ):
            with self.assertRaises(GraphSpaceError) as ctx:
                resolve_space("not_in_catalog")
        self.assertEqual(ctx.exception.code, "SPACE_NOT_FOUND")

    def test_resolve_space_accepts_ready(self) -> None:
        catalog = build_space_catalog(
            "anti_fraud_kg",
            "random_financial_graph_million",
        )
        with patch("app.services.graph_space_service.list_graph_spaces", return_value=catalog):
            resolved = resolve_space("random_financial_graph_million")
        self.assertEqual(resolved.id, "random_financial_graph_million")


if __name__ == "__main__":
    unittest.main()
