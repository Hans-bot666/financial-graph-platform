from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1.router import router
from app.core import auth_db


class AdminApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.previous_db_path = auth_db.USER_DB_PATH
        auth_db.USER_DB_PATH = Path(self.temp_dir.name) / "users.db"
        app = FastAPI()
        app.include_router(router)
        self.client = TestClient(app)

        admin = self._register("platform-owner", "平台管理员")
        self.admin_id = admin["id"]
        with auth_db.auth_connection() as connection:
            connection.execute(
                """
                INSERT INTO user_roles(user_id, role_id, assigned_at)
                VALUES (?, 'role:platform_admin', '2026-09-10T00:00:00Z')
                """,
                (self.admin_id,),
            )
        self._login(self.client, "platform-owner")

    def tearDown(self) -> None:
        self.client.close()
        auth_db.USER_DB_PATH = self.previous_db_path
        self.temp_dir.cleanup()

    def _register(self, username: str, display_name: str) -> dict:
        response = self.client.post(
            "/api/v1/auth/register",
            json={
                "username": username,
                "password": "correct-horse-battery-staple",
                "displayName": display_name,
            },
        )
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    @staticmethod
    def _login(client: TestClient, username: str) -> None:
        response = client.post(
            "/api/v1/auth/login",
            json={"identifier": username, "password": "correct-horse-battery-staple"},
        )
        if response.status_code != 200:
            raise AssertionError(response.text)
        client.headers.update({"X-CSRF-Token": client.cookies.get("fgp_csrf")})

    def test_anonymous_and_viewer_cannot_list_users(self) -> None:
        anonymous = TestClient(self.client.app)
        self.assertEqual(anonymous.get("/api/v1/admin/users").status_code, 401)
        self._register("normal-viewer", "普通用户")
        viewer = TestClient(self.client.app)
        self._login(viewer, "normal-viewer")
        response = viewer.get("/api/v1/admin/users")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["detail"]["code"], "AUTHZ_FORBIDDEN")
        anonymous.close()
        viewer.close()

    def test_admin_can_create_filter_and_disable_user(self) -> None:
        roles = self.client.get("/api/v1/admin/roles")
        analyst_id = next(role["id"] for role in roles.json() if role["code"] == "analyst")
        created = self.client.post(
            "/api/v1/admin/users",
            json={
                "username": "risk-analyst",
                "password": "another-secure-password-value",
                "displayName": "风险分析员",
                "roleIds": [analyst_id],
                "status": "active",
            },
        )
        self.assertEqual(created.status_code, 201, created.text)
        user = created.json()
        self.assertEqual(user["roles"][0]["code"], "analyst")

        listed = self.client.get("/api/v1/admin/users", params={"q": "risk", "role": "analyst"})
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(listed.json()["total"], 1)

        disabled = self.client.patch(
            f"/api/v1/admin/users/{user['id']}/status",
            json={"status": "disabled", "reason": "测试禁用", "version": user["version"]},
        )
        self.assertEqual(disabled.status_code, 200, disabled.text)
        self.assertEqual(disabled.json()["status"], "disabled")

        failed_login = TestClient(self.client.app).post(
            "/api/v1/auth/login",
            json={"identifier": "risk-analyst", "password": "another-secure-password-value"},
        )
        self.assertEqual(failed_login.status_code, 401)

    def test_version_conflict_does_not_overwrite_user(self) -> None:
        user = self._register("version-user", "版本用户")
        response = self.client.patch(
            f"/api/v1/admin/users/{user['id']}/status",
            json={"status": "disabled", "reason": "过期版本", "version": 999},
        )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "USER_VERSION_CONFLICT")

    def test_admin_cannot_change_own_status_or_roles(self) -> None:
        detail = self.client.get(f"/api/v1/admin/users/{self.admin_id}").json()
        status = self.client.patch(
            f"/api/v1/admin/users/{self.admin_id}/status",
            json={"status": "disabled", "reason": "错误操作", "version": detail["version"]},
        )
        self.assertEqual(status.status_code, 409)
        roles = self.client.put(
            f"/api/v1/admin/users/{self.admin_id}/roles",
            json={"roleIds": ["role:viewer"], "version": detail["version"]},
        )
        self.assertEqual(roles.status_code, 409)

    def test_admin_can_reset_other_user_password_and_revoke_sessions(self) -> None:
        target = self._register("password-user", "密码用户")
        old_session = TestClient(self.client.app)
        self._login(old_session, "password-user")
        detail = self.client.get(f"/api/v1/admin/users/{target['id']}").json()

        reset = self.client.post(
            f"/api/v1/admin/users/{target['id']}/password",
            json={
                "newPassword": "New-secure-password-value-2026!",
                "reason": "用户忘记密码",
                "version": detail["version"],
            },
        )
        self.assertEqual(reset.status_code, 200, reset.text)
        self.assertEqual(old_session.get("/api/v1/auth/me").status_code, 401)

        old_password = TestClient(self.client.app).post(
            "/api/v1/auth/login",
            json={"identifier": "password-user", "password": "correct-horse-battery-staple"},
        )
        self.assertEqual(old_password.status_code, 401)
        new_password = TestClient(self.client.app).post(
            "/api/v1/auth/login",
            json={"identifier": "password-user", "password": "New-secure-password-value-2026!"},
        )
        self.assertEqual(new_password.status_code, 200)
        old_session.close()

    def test_admin_cannot_reset_own_password_from_management_api(self) -> None:
        detail = self.client.get(f"/api/v1/admin/users/{self.admin_id}").json()
        response = self.client.post(
            f"/api/v1/admin/users/{self.admin_id}/password",
            json={
                "newPassword": "New-secure-password-value-2026!",
                "reason": "错误操作",
                "version": detail["version"],
            },
        )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "USER_SELF_PASSWORD_FORBIDDEN")


if __name__ == "__main__":
    unittest.main()
