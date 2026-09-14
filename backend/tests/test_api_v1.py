from __future__ import annotations

import unittest
import tempfile
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1.router import router
from app.core import auth_db
from app.services.graph_space_service import GraphSpaceError
from nebula_client import GraphResult as NebulaResult


class _FakeNebulaClient:
    last_query = ""
    spaces_used: list[str] = []

    def execute(self, query: str) -> NebulaResult:
        type(self).last_query = query
        return NebulaResult(
            0,
            "",
            ["path"],
            [[{
                "nodes": [
                    {"id": "c1", "name": "企业A", "type": "company"},
                    {"id": "a1", "name": "账户1", "type": "account"},
                ],
                "edges": [{"from": "c1", "to": "a1", "type": "holds_account"}],
            }]],
        )

    def list_graphs(self) -> NebulaResult:
        return NebulaResult(
            0,
            "",
            ["Name"],
            [["anti_fraud_kg"], ["random_financial_graph_million"]],
        )

    def execute_in_space(self, space: str, query: str) -> NebulaResult:
        type(self).spaces_used.append(space)
        return self.execute(query)


class ApiV1Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.temp_dir = tempfile.TemporaryDirectory()
        cls.previous_db_path = auth_db.USER_DB_PATH
        auth_db.USER_DB_PATH = Path(cls.temp_dir.name) / "users.db"
        app = FastAPI()
        app.include_router(router)
        cls.client = TestClient(app)
        registered = cls.client.post(
            "/api/v1/auth/register",
            json={
                "username": "api-test-admin",
                "password": "correct-horse-battery-staple",
                "displayName": "API 测试管理员",
            },
        )
        user_id = registered.json()["id"]
        with auth_db.auth_connection() as connection:
            connection.execute(
                """
                INSERT INTO user_roles(user_id, role_id, assigned_at)
                VALUES (?, 'role:platform_admin', '2026-09-10T00:00:00Z')
                """,
                (user_id,),
            )
        login = cls.client.post(
            "/api/v1/auth/login",
            json={"identifier": "api-test-admin", "password": "correct-horse-battery-staple"},
        )
        if login.status_code != 200:
            raise AssertionError(login.text)
        cls.client.headers.update({"X-CSRF-Token": cls.client.cookies.get("fgp_csrf")})

    def setUp(self) -> None:
        discover = patch(
            "app.services.graph_space_service.discover_graph_ids",
            return_value=["anti_fraud_kg", "random_financial_graph_million"],
        )
        hidden = patch("app.services.graph_space_service.parse_hidden_graphs", return_value=[])
        discover.start()
        hidden.start()
        self.addCleanup(discover.stop)
        self.addCleanup(hidden.stop)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.client.close()
        auth_db.USER_DB_PATH = cls.previous_db_path
        cls.temp_dir.cleanup()

    def test_scenario_catalog_is_versioned(self) -> None:
        response = self.client.get("/api/v1/scenarios")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()[0]["id"], "loan-reflux")
        self.assertEqual(response.json()[0]["version"], "1.0.0")
        self.assertEqual([item["id"] for item in response.json()], [
            "loan-reflux", "guarantee-circle", "lost-customer",
        ])

    def test_readonly_query_returns_graph_contract(self) -> None:
        with patch("app.api.v1.router.get_client", return_value=_FakeNebulaClient()):
            response = self.client.post(
                "/api/v1/graph/query",
                json={"space": "anti_fraud_kg", "query": "MATCH p=()-[]->() RETURN p LIMIT 10"},
            )
        body = response.json()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(body["nodes"][0]["id"], "c1")
        self.assertEqual(body["edges"][0]["source"], "c1")
        self.assertIn("traceId", body)

    def test_mutating_query_is_rejected_before_database_call(self) -> None:
        response = self.client.post(
            "/api/v1/graph/query",
            json={"space": "anti_fraud_kg", "query": "CREATE TAG forbidden(name string)"},
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("禁止执行写入", response.json()["detail"])

    def test_graph_schema_exposes_controlled_types(self) -> None:
        response = self.client.get("/api/v1/graph/schema")
        self.assertEqual(response.status_code, 200)
        self.assertIn("company", response.json()["entityTypes"])
        self.assertIn("transfer", response.json()["edgeTypes"])

    def test_graph_spaces_catalog(self) -> None:
        with patch(
            "app.services.graph_space_service.discover_graph_ids",
            return_value=["random_financial_graph_million", "anti_fraud_kg"],
        ):
            with patch("app.services.graph_space_service.parse_hidden_graphs", return_value=[]):
                response = self.client.get("/api/v1/graph/spaces")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(
            [item["id"] for item in body],
            ["anti_fraud_kg", "random_financial_graph_million"],
        )
        self.assertTrue(body[0]["isDefault"])
        self.assertEqual(body[0]["displayName"], "对公贷款反欺诈图")

    def test_graph_spaces_hides_blacklist(self) -> None:
        with patch(
            "app.services.graph_space_service.discover_graph_ids",
            return_value=["anti_fraud_kg", "scratch_graph"],
        ):
            with patch("app.services.graph_space_service.parse_hidden_graphs", return_value=["scratch_graph"]):
                response = self.client.get("/api/v1/graph/spaces")
        self.assertEqual(response.status_code, 200)
        self.assertEqual([item["id"] for item in response.json()], ["anti_fraud_kg"])

    def test_hidden_space_is_forbidden(self) -> None:
        with patch("app.services.graph_space_service.parse_hidden_graphs", return_value=["scratch_graph"]):
            response = self.client.post(
                "/api/v1/graph/vertices/lookup",
                json={"space": "scratch_graph", "value": "c1", "field": "id"},
            )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["detail"]["code"], "SPACE_FORBIDDEN")

    def test_catalog_unavailable_returns_bad_gateway(self) -> None:
        with patch(
            "app.services.graph_space_service.discover_graph_ids",
            side_effect=GraphSpaceError("CATALOG_UNAVAILABLE", "SHOW GRAPHS failed"),
        ):
            response = self.client.get("/api/v1/graph/spaces")
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json()["detail"]["code"], "CATALOG_UNAVAILABLE")

    def test_health_reports_real_database_state(self) -> None:
        with patch("app.api.v1.router.get_client", return_value=_FakeNebulaClient()):
            response = self.client.get("/api/v1/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["database"], "connected")

    def test_vertex_lookup_escapes_user_literal(self) -> None:
        _FakeNebulaClient.spaces_used = []
        with patch("app.services.exploration_service.get_client", return_value=_FakeNebulaClient()):
            response = self.client.post(
                "/api/v1/graph/vertices/lookup",
                json={"space": "anti_fraud_kg", "value": 'c1" OR true', "field": "id"},
            )
        self.assertEqual(response.status_code, 200)
        self.assertIn('c1\\" OR true', _FakeNebulaClient.last_query)
        self.assertIn("v.id =", _FakeNebulaClient.last_query)
        self.assertNotIn("==", _FakeNebulaClient.last_query)
        self.assertNotIn("id(v)", _FakeNebulaClient.last_query)
        self.assertEqual(_FakeNebulaClient.spaces_used, ["anti_fraud_kg"])

    def test_expand_rejects_unregistered_edge_type(self) -> None:
        response = self.client.post(
            "/api/v1/graph/expand",
            json={
                "space": "anti_fraud_kg",
                "vertexId": "c1",
                "minHops": 1,
                "maxHops": 2,
                "edgeTypes": ["DROP"],
            },
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("不支持的边类型", response.json()["detail"])

    def test_expand_uses_gql_quantified_path(self) -> None:
        _FakeNebulaClient.spaces_used = []
        with patch("app.services.exploration_service.get_client", return_value=_FakeNebulaClient()):
            response = self.client.post(
                "/api/v1/graph/expand",
                json={
                    "space": "anti_fraud_kg",
                    "vertexId": "c1",
                    "minHops": 1,
                    "maxHops": 2,
                    "edgeTypes": ["holds_account", "transfer"],
                    "direction": "both",
                },
            )
        self.assertEqual(response.status_code, 200)
        self.assertIn("(s)-[:holds_account|transfer]-{1,2}(t)", _FakeNebulaClient.last_query)
        self.assertIn("s.id =", _FakeNebulaClient.last_query)
        self.assertNotIn("==", _FakeNebulaClient.last_query)
        self.assertNotIn("*1..2", _FakeNebulaClient.last_query)

    def test_path_query_is_bounded(self) -> None:
        with patch("app.services.exploration_service.get_client", return_value=_FakeNebulaClient()):
            response = self.client.post(
                "/api/v1/graph/paths",
                json={
                    "space": "anti_fraud_kg",
                    "startId": "c1",
                    "endId": "a1",
                    "mode": "any-shortest",
                    "maxHops": 5,
                },
            )
        self.assertEqual(response.status_code, 200)
        self.assertIn("ANY SHORTEST PATH", _FakeNebulaClient.last_query)
        self.assertIn("-[:holds_account|applied_for|disbursed_to|transfer|guarantees|controls|shareholder|employs|related_to]-{1,5}(t)", _FakeNebulaClient.last_query)
        self.assertIn("LIMIT 1", _FakeNebulaClient.last_query)
        self.assertNotIn("==", _FakeNebulaClient.last_query)

    def test_unknown_space_is_rejected(self) -> None:
        response = self.client.post(
            "/api/v1/graph/vertices/lookup",
            json={"space": "not_in_catalog", "value": "c1", "field": "id"},
        )
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["detail"]["code"], "SPACE_NOT_FOUND")

    def test_missing_space_is_rejected(self) -> None:
        response = self.client.post(
            "/api/v1/graph/vertices/lookup",
            json={"value": "c1", "field": "id"},
        )
        self.assertEqual(response.status_code, 422)

    def test_scenario_validates_required_parameter(self) -> None:
        response = self.client.post(
            "/api/v1/scenarios/loan-reflux/executions",
            json={"space": "anti_fraud_kg", "parameters": {}},
        )
        self.assertEqual(response.status_code, 422)

    def test_guarantee_circle_uses_unified_graph_contract(self) -> None:
        _FakeNebulaClient.spaces_used = []
        with patch("app.services.scenario_service.get_client", return_value=_FakeNebulaClient()):
            response = self.client.post(
                "/api/v1/scenarios/guarantee-circle/executions",
                json={"space": "anti_fraud_kg", "parameters": {"companyName": "东方贸易集团"}},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["title"], "担保圈识别")
        self.assertEqual(response.json()["edges"][0]["source"], "c1")
        self.assertIn("[:guarantees]->{2,6}(c)", _FakeNebulaClient.last_query)
        self.assertIn("c.name =", _FakeNebulaClient.last_query)
        self.assertNotIn("==", _FakeNebulaClient.last_query)
        self.assertEqual(_FakeNebulaClient.spaces_used, ["anti_fraud_kg"])

    def test_lost_customer_validates_days_range(self) -> None:
        response = self.client.post(
            "/api/v1/scenarios/lost-customer/executions",
            json={
                "space": "anti_fraud_kg",
                "parameters": {"companyName": "远景电子科技有限公司", "lostDays": 0},
            },
        )
        self.assertEqual(response.status_code, 422)

    def test_scenario_database_error_returns_bad_gateway(self) -> None:
        class FailingClient:
            def execute_in_space(self, space: str, query: str) -> NebulaResult:
                return NebulaResult(-1, "database unavailable", [], [])

        with patch("app.services.scenario_service.get_client", return_value=FailingClient()):
            response = self.client.post(
                "/api/v1/scenarios/loan-reflux/executions",
                json={"space": "anti_fraud_kg", "parameters": {"companyName": "凯达建材有限公司"}},
            )
        self.assertEqual(response.status_code, 502)
        self.assertIn("database unavailable", response.json()["detail"])

    def test_alternating_spaces_do_not_cross(self) -> None:
        _FakeNebulaClient.spaces_used = []
        catalog = [
            "anti_fraud_kg",
            "random_financial_graph_million",
        ]
        with patch("app.services.graph_space_service.discover_graph_ids", return_value=catalog):
            with patch("app.services.graph_space_service.parse_hidden_graphs", return_value=[]):
                with patch("app.services.exploration_service.get_client", return_value=_FakeNebulaClient()):
                    first = self.client.post(
                        "/api/v1/graph/vertices/lookup",
                        json={"space": "anti_fraud_kg", "value": "c1", "field": "id"},
                    )
                    second = self.client.post(
                        "/api/v1/graph/vertices/lookup",
                        json={
                            "space": "random_financial_graph_million",
                            "value": "million_c_000000",
                            "field": "id",
                        },
                    )
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(
            _FakeNebulaClient.spaces_used,
            ["anti_fraud_kg", "random_financial_graph_million"],
        )

    @staticmethod
    def _feature_payload() -> dict:
        return {
            "id": "fund-return", "name": "资金回流路径数", "graphInstanceId": "anti-fraud",
            "entityType": "company", "version": 1, "status": "draft", "updatedAt": "2026-08-13T10:00:00Z",
            "nodes": [
                {"id": "i", "kind": "input", "title": "企业", "config": {"label": "company"}},
                {"id": "p", "kind": "path", "title": "转账路径", "config": {"edgeTypes": "transfer", "minHop": 2, "maxHop": 4, "direction": "双向"}},
                {"id": "f", "kind": "filter", "title": "30 日时间窗", "config": {"field": "transfer_time", "operator": "最近", "value": "30d"}},
                {"id": "a", "kind": "aggregate", "title": "路径数", "config": {"function": "COUNT DISTINCT"}},
                {"id": "o", "kind": "output", "title": "输出", "config": {"dataType": "INT64", "destinations": "explore", "exploreLabel": "资金回流路径数"}},
            ],
            "edges": [
                {"id": "e1", "source": "i", "target": "p"}, {"id": "e2", "source": "p", "target": "f"},
                {"id": "e3", "source": "f", "target": "a"}, {"id": "e4", "source": "a", "target": "o"},
            ],
        }

    def test_feature_definition_crud(self) -> None:
        payload = self._feature_payload()
        saved = self.client.put("/api/v1/features/definitions/fund-return", json=payload)
        self.assertEqual(saved.status_code, 200)
        listed = self.client.get("/api/v1/features/definitions")
        self.assertIn("fund-return", [item["id"] for item in listed.json()])
        loaded = self.client.get("/api/v1/features/definitions/fund-return")
        self.assertEqual(loaded.json()["graphInstanceId"], "anti-fraud")
        removed = self.client.delete("/api/v1/features/definitions/fund-return")
        self.assertEqual(removed.status_code, 204)

    def test_feature_compile_returns_bounded_parameterized_ngql(self) -> None:
        response = self.client.post("/api/v1/features/definitions/compile", json=self._feature_payload())
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["target"], "ngql-template")
        self.assertEqual(body["ir"]["runtime"], "bounded-online")
        self.assertIn("$entityKey", body["queryTemplate"])
        self.assertIn("[:transfer]-{2,4}", body["queryTemplate"])
        self.assertIn("s.id = $entityKey", body["queryTemplate"])
        self.assertNotIn("==", body["queryTemplate"])
        self.assertIn("duration({days: 30})", body["queryTemplate"])
        self.assertIn("LIMIT 1", body["queryTemplate"])

    def test_feature_compile_rejects_cycle(self) -> None:
        payload = self._feature_payload()
        payload["edges"].append({"id": "cycle", "source": "o", "target": "p"})
        response = self.client.post("/api/v1/features/definitions/compile", json=payload)
        self.assertEqual(response.status_code, 400)
        self.assertIn("环路", response.json()["detail"])

    def test_feature_compile_rejects_unregistered_edge_type(self) -> None:
        payload = self._feature_payload()
        payload["nodes"][1]["config"]["edgeTypes"] = "transfer,DROP"
        response = self.client.post("/api/v1/features/definitions/compile", json=payload)
        self.assertEqual(response.status_code, 400)
        self.assertIn("不支持的边类型", response.json()["detail"])


if __name__ == "__main__":
    unittest.main()
