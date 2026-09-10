from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1.auth_router import router
from app.core import auth_db


class AuthenticationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.previous_db_path = auth_db.USER_DB_PATH
        auth_db.USER_DB_PATH = Path(self.temp_dir.name) / "users.db"
        app = FastAPI()
        app.include_router(router, prefix="/api/v1")
        self.client = TestClient(app)

    def tearDown(self) -> None:
        self.client.close()
        auth_db.USER_DB_PATH = self.previous_db_path
        self.temp_dir.cleanup()

    def _register(self) -> dict:
        response = self.client.post(
            "/api/v1/auth/register",
            json={
                "username": "xiaomeng",
                "password": "correct-horse-battery-staple",
                "displayName": "小萌",
            },
        )
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def test_register_creates_viewer_without_exposing_credentials(self) -> None:
        user = self._register()
        self.assertEqual(user["username"], "xiaomeng")
        self.assertEqual(user["roles"], ["viewer"])
        self.assertNotIn("password", user)

    def test_duplicate_normalized_username_is_rejected(self) -> None:
        self._register()
        response = self.client.post(
            "/api/v1/auth/register",
            json={
                "username": " XIAOMENG ",
                "password": "another-secure-password-value",
                "displayName": "另一位用户",
            },
        )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "USERNAME_TAKEN")

    def test_login_restore_and_logout_session(self) -> None:
        self._register()
        login = self.client.post(
            "/api/v1/auth/login",
            json={"identifier": "xiaomeng", "password": "correct-horse-battery-staple"},
        )
        self.assertEqual(login.status_code, 200, login.text)
        self.assertIn("HttpOnly", login.headers["set-cookie"])
        self.assertEqual(login.json()["user"]["displayName"], "小萌")

        current = self.client.get("/api/v1/auth/me")
        self.assertEqual(current.status_code, 200)
        self.assertIn("platform.access", current.json()["permissions"])

        csrf_token = self.client.cookies.get("fgp_csrf")
        logout = self.client.post("/api/v1/auth/logout", headers={"X-CSRF-Token": csrf_token})
        self.assertEqual(logout.status_code, 204)
        self.assertEqual(self.client.get("/api/v1/auth/me").status_code, 401)

    def test_invalid_password_uses_stable_error(self) -> None:
        self._register()
        response = self.client.post(
            "/api/v1/auth/login",
            json={"identifier": "xiaomeng", "password": "incorrect-password-value"},
        )
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["code"], "AUTH_INVALID_CREDENTIALS")


if __name__ == "__main__":
    unittest.main()
