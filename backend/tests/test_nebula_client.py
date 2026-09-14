from __future__ import annotations

import threading
import unittest

from nebula_client import GraphResult, NebulaClient, _result_to_graph_result, to_gql


class _FakeResultSet:
    def __init__(
        self,
        *,
        succeeded: bool = True,
        columns: list[str] | None = None,
        rows: list[dict[str, object]] | None = None,
        status_code: str = "00000",
        status_message: str = "",
    ) -> None:
        self.is_succeeded = succeeded
        self.column_names = columns or []
        self._rows = rows or []
        self.status_code = status_code
        self.status_message = status_message

    def as_primitive_by_row(self):
        yield from self._rows


class _FakeSdkClient:
    def __init__(self) -> None:
        self.statements: list[str] = []

    def execute(self, statement: str) -> _FakeResultSet:
        self.statements.append(statement)
        if statement.startswith("SESSION SET GRAPH") or statement.startswith("USE "):
            return _FakeResultSet()
        return _FakeResultSet(columns=["id", "name"], rows=[{"id": "c1", "name": "企业A"}])


class _FakePool:
    def __init__(self, client: _FakeSdkClient) -> None:
        self.client = client
        self.returned: list[_FakeSdkClient] = []

    def get_client(self) -> _FakeSdkClient:
        return self.client

    def return_client(self, client: _FakeSdkClient) -> None:
        self.returned.append(client)


class NebulaClientV5Tests(unittest.TestCase):
    def test_converts_v5_primitive_rows(self) -> None:
        result = _result_to_graph_result(
            _FakeResultSet(
                columns=["id", "score"],
                rows=[{"id": "c1", "score": 92}, {"id": "c2", "score": None}],
            )
        )

        self.assertEqual(result, GraphResult(0, "", ["id", "score"], [["c1", 92], ["c2", None]]))

    def test_converts_v5_status_error(self) -> None:
        result = _result_to_graph_result(
            _FakeResultSet(
                succeeded=False,
                status_code="42N01",
                status_message="graph not found",
            )
        )

        self.assertEqual(result.error_code, -1)
        self.assertEqual(result.error_msg, "[42N01] graph not found")

    def test_execute_in_space_uses_and_queries_same_borrowed_client(self) -> None:
        sdk_client = _FakeSdkClient()
        pool = _FakePool(sdk_client)
        client = NebulaClient.__new__(NebulaClient)
        client.pool = pool
        client._mock = False
        client.space = "default_graph"
        client._lock = threading.RLock()

        result = client.execute_in_space("risk_graph", "MATCH (v) RETURN v;")

        self.assertEqual(result.error_code, 0)
        self.assertEqual(
            sdk_client.statements,
            ["SESSION SET GRAPH risk_graph", "MATCH (v) RETURN v"],
        )
        self.assertEqual(pool.returned, [sdk_client])
        self.assertEqual(client.space, "risk_graph")

    def test_list_graphs_does_not_select_a_graph(self) -> None:
        sdk_client = _FakeSdkClient()
        pool = _FakePool(sdk_client)
        client = NebulaClient.__new__(NebulaClient)
        client.pool = pool
        client._mock = False
        client.space = "default_graph"
        client._lock = threading.RLock()

        result = client.list_graphs()

        self.assertEqual(result.error_code, 0)
        self.assertEqual(sdk_client.statements, ["SHOW GRAPHS"])
        self.assertEqual(pool.returned, [sdk_client])

    def test_strips_ngql_semicolons(self) -> None:
        self.assertEqual(to_gql("RETURN 1 AS ok;"), "RETURN 1 AS ok")
        self.assertEqual(to_gql("SESSION SET GRAPH anti_fraud_kg;"), "SESSION SET GRAPH anti_fraud_kg")


if __name__ == "__main__":
    unittest.main()
