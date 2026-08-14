from __future__ import annotations

import unittest

from app.core.query_policy import QueryPolicyError, enforce_readonly


class QueryPolicyTests(unittest.TestCase):
    def test_adds_default_limit(self) -> None:
        self.assertEqual(
            enforce_readonly("MATCH (v) RETURN v;"),
            "MATCH (v) RETURN v LIMIT 500;",
        )

    def test_preserves_show_statement(self) -> None:
        self.assertEqual(enforce_readonly("SHOW SPACES;"), "SHOW SPACES;")

    def test_preserves_safe_limit(self) -> None:
        query = "MATCH (v) RETURN v LIMIT 10;"
        self.assertEqual(enforce_readonly(query), query)

    def test_rejects_write_statement(self) -> None:
        with self.assertRaises(QueryPolicyError):
            enforce_readonly('INSERT VERTEX company(name) VALUES "c1":("x");')

    def test_rejects_oversized_limit(self) -> None:
        with self.assertRaises(QueryPolicyError):
            enforce_readonly("MATCH (v) RETURN v LIMIT 1000;")


if __name__ == "__main__":
    unittest.main()
