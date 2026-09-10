from __future__ import annotations

import unittest
import tempfile
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1.router import router
from app.core import auth_db
from nebula_client import GraphResult as NebulaResult


class _FakeNebulaClient:
    last_query = ""

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
                json={"query": "MATCH p=()-[]->() RETURN p LIMIT 10"},
            )
        body = response.json()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(body["nodes"][0]["id"], "c1")
        self.assertEqual(body["edges"][0]["source"], "c1")
        self.assertIn("traceId", body)

    def test_mutating_query_is_rejected_before_database_call(self) -> None:
        response = self.client.post(
            "/api/v1/graph/query",
            json={"query": "CREATE TAG forbidden(name string)"},
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("禁止执行写入", response.json()["detail"])

    def test_graph_schema_exposes_controlled_types(self) -> None:
        response = self.client.get("/api/v1/graph/schema")
        self.assertEqual(response.status_code, 200)
        self.assertIn("company", response.json()["entityTypes"])
        self.assertIn("transfer", response.json()["edgeTypes"])

    def test_health_reports_real_database_state(self) -> None:
        with patch("app.api.v1.router.get_client", return_value=_FakeNebulaClient()):
            response = self.client.get("/api/v1/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["database"], "connected")

    def test_vertex_lookup_escapes_user_literal(self) -> None:
        with patch("app.services.exploration_service.get_client", return_value=_FakeNebulaClient()):
            response = self.client.post(
                "/api/v1/graph/vertices/lookup",
                json={"value": 'c1" OR true', "field": "id"},
            )
        self.assertEqual(response.status_code, 200)
        self.assertIn('c1\\" OR true', _FakeNebulaClient.last_query)

    def test_expand_rejects_unregistered_edge_type(self) -> None:
        response = self.client.post(
            "/api/v1/graph/expand",
            json={"vertexId": "c1", "minHops": 1, "maxHops": 2, "edgeTypes": ["DROP"]},
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("不支持的边类型", response.json()["detail"])

    def test_path_query_is_bounded(self) -> None:
        with patch("app.services.exploration_service.get_client", return_value=_FakeNebulaClient()):
            response = self.client.post(
                "/api/v1/graph/paths",
                json={"startId": "c1", "endId": "a1", "mode": "any-shortest", "maxHops": 5},
            )
        self.assertEqual(response.status_code, 200)
        self.assertIn("FIND SHORTEST PATH WITH PROP", _FakeNebulaClient.last_query)
        self.assertIn("UPTO 5 STEPS", _FakeNebulaClient.last_query)
        self.assertIn("LIMIT 1", _FakeNebulaClient.last_query)

    def test_scenario_validates_required_parameter(self) -> None:
        response = self.client.post(
            "/api/v1/scenarios/loan-reflux/executions",
            json={"parameters": {}},
        )
        self.assertEqual(response.status_code, 422)

    def test_guarantee_circle_uses_unified_graph_contract(self) -> None:
        with patch("app.services.scenario_service.get_client", return_value=_FakeNebulaClient()):
            response = self.client.post(
                "/api/v1/scenarios/guarantee-circle/executions",
                json={"parameters": {"companyName": "东方贸易集团"}},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["title"], "担保圈识别")
        self.assertEqual(response.json()["edges"][0]["source"], "c1")

    def test_lost_customer_validates_days_range(self) -> None:
        response = self.client.post(
            "/api/v1/scenarios/lost-customer/executions",
            json={"parameters": {"companyName": "远景电子科技有限公司", "lostDays": 0}},
        )
        self.assertEqual(response.status_code, 422)

    def test_scenario_database_error_returns_bad_gateway(self) -> None:
        class FailingClient:
            def execute(self, query: str) -> NebulaResult:
                return NebulaResult(-1, "database unavailable", [], [])

        with patch("app.services.scenario_service.get_client", return_value=FailingClient()):
            response = self.client.post(
                "/api/v1/scenarios/loan-reflux/executions",
                json={"parameters": {"companyName": "凯达建材有限公司"}},
            )
        self.assertEqual(response.status_code, 502)
        self.assertIn("database unavailable", response.json()["detail"])

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
        self.assertIn("transfer*2..4", body["queryTemplate"])
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
