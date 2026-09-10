"""用户名密码认证与服务端会话。"""
from __future__ import annotations

import hashlib
import json
import re
import secrets
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

from app.core.auth_db import auth_connection
from config import SESSION_ABSOLUTE_HOURS, SESSION_IDLE_MINUTES

USERNAME_PATTERN = re.compile(r"^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])$")
RESERVED_USERNAMES = {"admin", "administrator", "root", "system", "support", "security", "api"}
COMMON_PASSWORDS = {
    "password", "password123", "123456789012", "qwerty123456",
    "admin123456", "letmein123456", "welcome123456",
}
PASSWORD_HASHER = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=2)
DUMMY_PASSWORD_HASH = PASSWORD_HASHER.hash("not-a-real-password-for-timing-only")


@dataclass
class AuthError(Exception):
    code: str
    message: str
    status_code: int


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def to_db_time(value: datetime) -> str:
    return value.isoformat().replace("+00:00", "Z")


def parse_db_time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def normalize_username(username: str) -> str:
    normalized = username.strip().lower()
    if not USERNAME_PATTERN.fullmatch(normalized):
        raise AuthError(
            "USERNAME_INVALID",
            "用户名需为 3-32 位，仅包含字母、数字、点、下划线或短横线，且首尾为字母或数字",
            422,
        )
    if normalized in RESERVED_USERNAMES:
        raise AuthError("USERNAME_RESERVED", "该用户名不可使用", 422)
    return normalized


def validate_password(password: str, normalized_username: str) -> None:
    if len(password) < 12 or len(password) > 128:
        raise AuthError("PASSWORD_POLICY_VIOLATION", "密码长度需为 12-128 个字符", 422)
    lowered = password.casefold()
    if lowered == normalized_username.casefold() or lowered in COMMON_PASSWORDS:
        raise AuthError("PASSWORD_POLICY_VIOLATION", "密码过于简单，请更换密码", 422)


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _audit(
    connection: sqlite3.Connection,
    *,
    action: str,
    result: str,
    trace_id: str,
    ip: str,
    user_agent: str,
    actor_id: str | None = None,
    target_id: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    connection.execute(
        """
        INSERT INTO audit_events(
            id, actor_id, action, target_type, target_id, result, trace_id,
            ip, user_agent, metadata, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            str(uuid4()), actor_id, action, "user" if target_id else None, target_id,
            result, trace_id, ip, user_agent[:512],
            json.dumps(metadata or {}, ensure_ascii=False), to_db_time(utc_now()),
        ),
    )


def record_auth_event(
    *,
    action: str,
    result: str,
    trace_id: str,
    ip: str,
    user_agent: str,
    actor_id: str | None = None,
    target_id: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    """记录未进入用户事务的认证事件，例如注册校验失败。"""
    with auth_connection() as connection:
        _audit(
            connection,
            action=action,
            result=result,
            trace_id=trace_id,
            ip=ip,
            user_agent=user_agent,
            actor_id=actor_id,
            target_id=target_id,
            metadata=metadata,
        )


def current_user(connection: sqlite3.Connection, user_id: str) -> dict[str, Any]:
    user = connection.execute(
        """
        SELECT id, username, display_name, avatar_url, status
        FROM users WHERE id = ?
        """,
        (user_id,),
    ).fetchone()
    if user is None:
        raise AuthError("AUTH_SESSION_INVALID", "登录状态已失效", 401)
    roles = [
        row["code"]
        for row in connection.execute(
            """
            SELECT r.code FROM roles r
            JOIN user_roles ur ON ur.role_id = r.id
            WHERE ur.user_id = ? ORDER BY r.code
            """,
            (user_id,),
        )
    ]
    permissions = [
        row["code"]
        for row in connection.execute(
            """
            SELECT DISTINCT p.code FROM permissions p
            JOIN role_permissions rp ON rp.permission_id = p.id
            JOIN user_roles ur ON ur.role_id = rp.role_id
            WHERE ur.user_id = ? ORDER BY p.code
            """,
            (user_id,),
        )
    ]
    return {
        "id": user["id"],
        "username": user["username"],
        "displayName": user["display_name"],
        "avatarUrl": user["avatar_url"],
        "status": user["status"],
        "roles": roles,
        "permissions": permissions,
    }


def register_user(
    *,
    username: str,
    password: str,
    display_name: str,
    trace_id: str,
    ip: str,
    user_agent: str,
) -> dict[str, Any]:
    normalized = normalize_username(username)
    validate_password(password, normalized)
    clean_display_name = display_name.strip()
    if not clean_display_name or len(clean_display_name) > 50 or any(ord(char) < 32 for char in clean_display_name):
        raise AuthError("DISPLAY_NAME_INVALID", "昵称需为 1-50 个字符且不能包含控制字符", 422)

    now = to_db_time(utc_now())
    user_id = str(uuid4())
    try:
        with auth_connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute(
                """
                INSERT INTO users(
                    id, username, normalized_username, display_name, status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, 'active', ?, ?)
                """,
                (user_id, username.strip(), normalized, clean_display_name, now, now),
            )
            connection.execute(
                """
                INSERT INTO user_identities(
                    id, user_id, type, normalized_value, verified_at, is_primary
                ) VALUES (?, ?, 'username', ?, ?, 1)
                """,
                (str(uuid4()), user_id, normalized, now),
            )
            connection.execute(
                "INSERT INTO password_credentials(user_id, password_hash, changed_at) VALUES (?, ?, ?)",
                (user_id, PASSWORD_HASHER.hash(password), now),
            )
            connection.execute(
                """
                INSERT INTO user_roles(user_id, role_id, assigned_at)
                VALUES (?, 'role:viewer', ?)
                """,
                (user_id, now),
            )
            _audit(
                connection, action="auth.register", result="success", trace_id=trace_id,
                ip=ip, user_agent=user_agent, actor_id=user_id, target_id=user_id,
            )
            connection.execute("COMMIT")
            return current_user(connection, user_id)
    except sqlite3.IntegrityError as exc:
        if "normalized_username" in str(exc) or "user_identities.type" in str(exc):
            raise AuthError("USERNAME_TAKEN", "用户名已被使用", 409) from exc
        raise


def login_user(
    *,
    identifier: str,
    password: str,
    trace_id: str,
    ip: str,
    user_agent: str,
) -> tuple[dict[str, Any], str, str]:
    normalized = identifier.strip().lower()
    now = utc_now()
    cutoff = to_db_time(now - timedelta(minutes=5))

    with auth_connection() as connection:
        recent_ip_failures = connection.execute(
            """
            SELECT COUNT(*) FROM login_attempts
            WHERE ip = ? AND succeeded = 0 AND created_at >= ?
            """,
            (ip, cutoff),
        ).fetchone()[0]
        if recent_ip_failures >= 30:
            _audit(
                connection, action="auth.login", result="failure", trace_id=trace_id,
                ip=ip, user_agent=user_agent, metadata={"reason": "rate_limited"},
            )
            raise AuthError("AUTH_RATE_LIMITED", "登录尝试过于频繁，请稍后再试", 429)

        row = connection.execute(
            """
            SELECT u.*, pc.password_hash
            FROM users u JOIN password_credentials pc ON pc.user_id = u.id
            WHERE u.normalized_username = ?
            """,
            (normalized,),
        ).fetchone()

        password_valid = False
        try:
            password_valid = PASSWORD_HASHER.verify(
                row["password_hash"] if row else DUMMY_PASSWORD_HASH,
                password,
            )
        except (VerifyMismatchError, InvalidHashError):
            password_valid = False

        connection.execute("BEGIN IMMEDIATE")
        if row is None or not password_valid:
            connection.execute(
                """
                INSERT INTO login_attempts(normalized_identifier, ip, succeeded, created_at)
                VALUES (?, ?, 0, ?)
                """,
                (normalized[:254], ip, to_db_time(now)),
            )
            if row is not None and row["status"] in {"active", "locked"}:
                failed_count = row["failed_login_count"] + 1
                if failed_count >= 5 and row["status"] == "active":
                    connection.execute(
                        """
                        UPDATE users
                        SET status = 'locked', failed_login_count = ?,
                            locked_until = ?, updated_at = ?, version = version + 1
                        WHERE id = ?
                        """,
                        (failed_count, to_db_time(now + timedelta(minutes=15)), to_db_time(now), row["id"]),
                    )
                else:
                    connection.execute(
                        "UPDATE users SET failed_login_count = ?, updated_at = ? WHERE id = ?",
                        (failed_count, to_db_time(now), row["id"]),
                    )
            _audit(
                connection, action="auth.login", result="failure", trace_id=trace_id,
                ip=ip, user_agent=user_agent, target_id=row["id"] if row else None,
                metadata={"reason": "invalid_credentials"},
            )
            connection.execute("COMMIT")
            raise AuthError("AUTH_INVALID_CREDENTIALS", "用户名或密码错误", 401)

        if row["status"] == "locked":
            locked_until = parse_db_time(row["locked_until"]) if row["locked_until"] else now
            if locked_until > now:
                _audit(
                    connection, action="auth.login", result="failure", trace_id=trace_id,
                    ip=ip, user_agent=user_agent, target_id=row["id"],
                    metadata={"reason": "account_locked"},
                )
                connection.execute("COMMIT")
                raise AuthError("ACCOUNT_LOCKED", "账号已锁定，请稍后再试", 423)
            connection.execute(
                """
                UPDATE users SET status = 'active', failed_login_count = 0,
                    locked_until = NULL, updated_at = ?, version = version + 1
                WHERE id = ?
                """,
                (to_db_time(now), row["id"]),
            )
        elif row["status"] != "active":
            _audit(
                connection, action="auth.login", result="failure", trace_id=trace_id,
                ip=ip, user_agent=user_agent, target_id=row["id"],
                metadata={"reason": "account_unavailable"},
            )
            connection.execute("COMMIT")
            raise AuthError("AUTH_INVALID_CREDENTIALS", "用户名或密码错误", 401)

        token = secrets.token_urlsafe(32)
        csrf_token = secrets.token_urlsafe(24)
        session_id = str(uuid4())
        expires_at = now + timedelta(hours=SESSION_ABSOLUTE_HOURS)
        connection.execute(
            """
            INSERT INTO sessions(
                id, user_id, token_hash, csrf_hash, auth_version, created_at,
                last_seen_at, expires_at, ip, user_agent
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                session_id, row["id"], _digest(token), _digest(csrf_token),
                row["auth_version"], to_db_time(now), to_db_time(now),
                to_db_time(expires_at), ip, user_agent[:512],
            ),
        )
        connection.execute(
            """
            UPDATE users SET failed_login_count = 0, locked_until = NULL,
                last_login_at = ?, updated_at = ? WHERE id = ?
            """,
            (to_db_time(now), to_db_time(now), row["id"]),
        )
        connection.execute(
            """
            INSERT INTO login_attempts(normalized_identifier, ip, succeeded, created_at)
            VALUES (?, ?, 1, ?)
            """,
            (normalized[:254], ip, to_db_time(now)),
        )
        _audit(
            connection, action="auth.login", result="success", trace_id=trace_id,
            ip=ip, user_agent=user_agent, actor_id=row["id"], target_id=row["id"],
        )
        connection.execute("COMMIT")
        return current_user(connection, row["id"]), token, csrf_token


def authenticate_session(token: str | None) -> tuple[dict[str, Any], sqlite3.Row]:
    if not token:
        raise AuthError("AUTH_SESSION_INVALID", "登录状态已失效", 401)
    now = utc_now()
    with auth_connection() as connection:
        row = connection.execute(
            """
            SELECT s.*, u.status, u.auth_version AS current_auth_version
            FROM sessions s JOIN users u ON u.id = s.user_id
            WHERE s.token_hash = ?
            """,
            (_digest(token),),
        ).fetchone()
        if (
            row is None
            or row["revoked_at"] is not None
            or row["status"] != "active"
            or row["auth_version"] != row["current_auth_version"]
            or parse_db_time(row["expires_at"]) <= now
            or parse_db_time(row["last_seen_at"]) + timedelta(minutes=SESSION_IDLE_MINUTES) <= now
        ):
            raise AuthError("AUTH_SESSION_INVALID", "登录状态已失效", 401)
        if parse_db_time(row["last_seen_at"]) + timedelta(minutes=1) <= now:
            connection.execute(
                "UPDATE sessions SET last_seen_at = ? WHERE id = ?",
                (to_db_time(now), row["id"]),
            )
        return current_user(connection, row["user_id"]), row


def validate_session_csrf(session: sqlite3.Row, csrf_token: str | None) -> None:
    if not csrf_token or not secrets.compare_digest(session["csrf_hash"], _digest(csrf_token)):
        raise AuthError("CSRF_INVALID", "请求安全校验失败", 403)


def logout_session(
    *,
    token: str | None,
    csrf_token: str | None,
    trace_id: str,
    ip: str,
    user_agent: str,
) -> None:
    if not token:
        return
    with auth_connection() as connection:
        row = connection.execute(
            "SELECT id, user_id, csrf_hash, revoked_at FROM sessions WHERE token_hash = ?",
            (_digest(token),),
        ).fetchone()
        if row is None or row["revoked_at"] is not None:
            return
        validate_session_csrf(row, csrf_token)
        connection.execute("BEGIN IMMEDIATE")
        connection.execute(
            "UPDATE sessions SET revoked_at = ? WHERE id = ?",
            (to_db_time(utc_now()), row["id"]),
        )
        _audit(
            connection, action="auth.logout", result="success", trace_id=trace_id,
            ip=ip, user_agent=user_agent, actor_id=row["user_id"], target_id=row["user_id"],
        )
        connection.execute("COMMIT")
