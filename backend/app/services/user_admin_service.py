"""后台用户、状态和角色管理服务。"""
from __future__ import annotations

import sqlite3
from typing import Any
from urllib.parse import urlsplit
from uuid import uuid4

from app.core.auth_db import auth_connection
from app.services.auth_service import (
    PASSWORD_HASHER,
    AuthError,
    _audit,
    normalize_username,
    to_db_time,
    utc_now,
    validate_password,
)

SORT_COLUMNS = {
    "username": "u.normalized_username",
    "createdAt": "u.created_at",
    "lastLoginAt": "u.last_login_at",
}
VALID_STATUSES = {"pending", "active", "disabled", "locked"}


def _roles_for_user(connection: sqlite3.Connection, user_id: str) -> list[dict[str, str]]:
    return [
        {"id": row["id"], "code": row["code"], "name": row["name"]}
        for row in connection.execute(
            """
            SELECT r.id, r.code, r.name FROM roles r
            JOIN user_roles ur ON ur.role_id = r.id
            WHERE ur.user_id = ? ORDER BY r.code
            """,
            (user_id,),
        )
    ]


def _user_item(connection: sqlite3.Connection, row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "username": row["username"],
        "displayName": row["display_name"],
        "avatarUrl": row["avatar_url"],
        "bio": row["bio"],
        "status": row["status"],
        "version": row["version"],
        "roles": _roles_for_user(connection, row["id"]),
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "lastLoginAt": row["last_login_at"],
    }


def get_user(user_id: str) -> dict[str, Any]:
    with auth_connection() as connection:
        row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if row is None:
            raise AuthError("USER_NOT_FOUND", "用户不存在", 404)
        return _user_item(connection, row)


def list_users(
    *,
    query: str,
    status: str | None,
    role: str | None,
    page: int,
    page_size: int,
    sort_by: str,
    sort_order: str,
) -> dict[str, Any]:
    conditions: list[str] = []
    parameters: list[Any] = []
    if query.strip():
        conditions.append(
            "(u.normalized_username LIKE ? ESCAPE '\\' OR u.display_name LIKE ? ESCAPE '\\')"
        )
        escaped = query.strip().lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        parameters.extend([f"%{escaped}%", f"%{query.strip()}%"])
    if status:
        if status not in VALID_STATUSES:
            raise AuthError("USER_STATUS_INVALID", "用户状态无效", 422)
        conditions.append("u.status = ?")
        parameters.append(status)
    if role:
        conditions.append(
            "EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id "
            "WHERE ur.user_id = u.id AND r.code = ?)"
        )
        parameters.append(role)
    where_sql = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    sort_column = SORT_COLUMNS.get(sort_by, SORT_COLUMNS["createdAt"])
    direction = "ASC" if sort_order == "asc" else "DESC"

    with auth_connection() as connection:
        total = connection.execute(
            f"SELECT COUNT(*) FROM users u {where_sql}",  # noqa: S608 - fragments are controlled
            parameters,
        ).fetchone()[0]
        rows = connection.execute(
            f"""
            SELECT u.* FROM users u {where_sql}
            ORDER BY {sort_column} {direction}, u.id ASC
            LIMIT ? OFFSET ?
            """,  # noqa: S608 - sort and where fragments are controlled
            [*parameters, page_size, (page - 1) * page_size],
        ).fetchall()
        return {
            "items": [_user_item(connection, row) for row in rows],
            "page": page,
            "pageSize": page_size,
            "total": total,
        }


def list_roles() -> list[dict[str, Any]]:
    with auth_connection() as connection:
        roles = connection.execute("SELECT id, code, name FROM roles ORDER BY code").fetchall()
        result: list[dict[str, Any]] = []
        for role in roles:
            permissions = [
                row["code"]
                for row in connection.execute(
                    """
                    SELECT p.code FROM permissions p
                    JOIN role_permissions rp ON rp.permission_id = p.id
                    WHERE rp.role_id = ? ORDER BY p.code
                    """,
                    (role["id"],),
                )
            ]
            result.append({**dict(role), "permissions": permissions})
        return result


def create_user(
    *,
    username: str,
    password: str,
    display_name: str,
    role_ids: list[str],
    status: str,
    actor_id: str,
    trace_id: str,
    ip: str,
    user_agent: str,
) -> dict[str, Any]:
    normalized = normalize_username(username)
    validate_password(password, normalized)
    clean_name = display_name.strip()
    if not clean_name or len(clean_name) > 50 or any(ord(char) < 32 for char in clean_name):
        raise AuthError("DISPLAY_NAME_INVALID", "昵称需为 1-50 个字符且不能包含控制字符", 422)
    if status not in {"active", "disabled"}:
        raise AuthError("USER_STATUS_INVALID", "创建用户时状态只能为启用或禁用", 422)
    if not role_ids:
        raise AuthError("USER_ROLE_REQUIRED", "至少需要一个角色", 422)

    now = to_db_time(utc_now())
    user_id = str(uuid4())
    try:
        with auth_connection() as connection:
            existing_roles = {
                row["id"] for row in connection.execute(
                    f"SELECT id FROM roles WHERE id IN ({','.join('?' for _ in role_ids)})",
                    role_ids,
                )
            }
            if existing_roles != set(role_ids):
                raise AuthError("ROLE_NOT_FOUND", "包含不存在的角色", 422)
            connection.execute("BEGIN IMMEDIATE")
            connection.execute(
                """
                INSERT INTO users(
                    id, username, normalized_username, display_name, status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (user_id, username.strip(), normalized, clean_name, status, now, now),
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
            connection.executemany(
                """
                INSERT INTO user_roles(user_id, role_id, assigned_by, assigned_at)
                VALUES (?, ?, ?, ?)
                """,
                [(user_id, role_id, actor_id, now) for role_id in role_ids],
            )
            _audit(
                connection, action="user.created", result="success", trace_id=trace_id,
                ip=ip, user_agent=user_agent, actor_id=actor_id, target_id=user_id,
                metadata={"roles": sorted(role_ids), "status": status},
            )
            connection.execute("COMMIT")
            row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            return _user_item(connection, row)
    except sqlite3.IntegrityError as exc:
        if "normalized_username" in str(exc) or "user_identities.type" in str(exc):
            raise AuthError("USERNAME_TAKEN", "用户名已被使用", 409) from exc
        raise


def update_user_profile(
    *,
    user_id: str,
    display_name: str,
    avatar_url: str | None,
    bio: str | None,
    version: int,
    actor_id: str,
    trace_id: str,
    ip: str,
    user_agent: str,
) -> dict[str, Any]:
    clean_name = display_name.strip()
    if not clean_name or len(clean_name) > 50 or any(ord(char) < 32 for char in clean_name):
        raise AuthError("DISPLAY_NAME_INVALID", "昵称需为 1-50 个字符", 422)
    if bio is not None and (len(bio) > 500 or any(ord(char) < 9 for char in bio)):
        raise AuthError("BIO_INVALID", "个人简介最多 500 个字符", 422)
    if avatar_url:
        parsed = urlsplit(avatar_url)
        valid_relative = avatar_url.startswith("/") and not avatar_url.startswith("//")
        valid_https = parsed.scheme == "https" and bool(parsed.netloc)
        if not (valid_relative or valid_https) or parsed.username or parsed.password:
            raise AuthError("AVATAR_URL_INVALID", "头像地址必须是 HTTPS 或平台相对路径", 422)
    now = to_db_time(utc_now())
    with auth_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        cursor = connection.execute(
            """
            UPDATE users SET display_name = ?, avatar_url = ?, bio = ?,
                version = version + 1, updated_at = ?
            WHERE id = ? AND version = ?
            """,
            (clean_name, avatar_url, bio, now, user_id, version),
        )
        if cursor.rowcount == 0:
            connection.execute("ROLLBACK")
            if connection.execute("SELECT 1 FROM users WHERE id = ?", (user_id,)).fetchone() is None:
                raise AuthError("USER_NOT_FOUND", "用户不存在", 404)
            raise AuthError("USER_VERSION_CONFLICT", "用户信息已更新，请刷新后重试", 409)
        _audit(
            connection, action="user.profile.updated_by_admin", result="success", trace_id=trace_id,
            ip=ip, user_agent=user_agent, actor_id=actor_id, target_id=user_id,
            metadata={"fields": ["displayName", "avatarUrl", "bio"]},
        )
        connection.execute("COMMIT")
        row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return _user_item(connection, row)


def change_user_status(
    *,
    user_id: str,
    status: str,
    reason: str,
    version: int,
    actor_id: str,
    trace_id: str,
    ip: str,
    user_agent: str,
) -> dict[str, Any]:
    if user_id == actor_id:
        raise AuthError("USER_SELF_STATUS_FORBIDDEN", "不能修改自己的账号状态", 409)
    if status not in {"active", "disabled"}:
        raise AuthError("USER_STATUS_INVALID", "目标状态无效", 422)
    if not 2 <= len(reason.strip()) <= 500:
        raise AuthError("STATUS_REASON_INVALID", "状态变更原因需为 2-500 个字符", 422)

    now = to_db_time(utc_now())
    with auth_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        target = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if target is None:
            connection.execute("ROLLBACK")
            raise AuthError("USER_NOT_FOUND", "用户不存在", 404)
        if target["version"] != version:
            connection.execute("ROLLBACK")
            raise AuthError("USER_VERSION_CONFLICT", "用户信息已更新，请刷新后重试", 409)
        if status == "disabled" and _is_last_active_admin(connection, user_id):
            connection.execute("ROLLBACK")
            raise AuthError("LAST_ADMIN_REQUIRED", "不能禁用最后一个有效平台管理员", 409)
        if status == "active" and target["status"] not in {"disabled", "locked"}:
            connection.execute("ROLLBACK")
            raise AuthError("USER_STATUS_TRANSITION_INVALID", "当前状态不能执行此操作", 409)
        if status == "disabled" and target["status"] != "active":
            connection.execute("ROLLBACK")
            raise AuthError("USER_STATUS_TRANSITION_INVALID", "当前状态不能执行此操作", 409)

        connection.execute(
            """
            UPDATE users SET status = ?, auth_version = auth_version + 1,
                failed_login_count = 0, locked_until = NULL,
                version = version + 1, updated_at = ?
            WHERE id = ?
            """,
            (status, now, user_id),
        )
        connection.execute(
            "UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL",
            (now, user_id),
        )
        _audit(
            connection,
            action="user.unlocked" if target["status"] == "locked" else "user.status.changed",
            result="success", trace_id=trace_id, ip=ip, user_agent=user_agent,
            actor_id=actor_id, target_id=user_id,
            metadata={"before": target["status"], "after": status, "reason": reason.strip()},
        )
        connection.execute("COMMIT")
        row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return _user_item(connection, row)


def _is_last_active_admin(connection: sqlite3.Connection, user_id: str) -> bool:
    is_admin = connection.execute(
        """
        SELECT 1 FROM user_roles
        WHERE user_id = ? AND role_id = 'role:platform_admin'
        """,
        (user_id,),
    ).fetchone()
    if not is_admin:
        return False
    active_admins = connection.execute(
        """
        SELECT COUNT(*) FROM users u JOIN user_roles ur ON ur.user_id = u.id
        WHERE ur.role_id = 'role:platform_admin' AND u.status = 'active'
        """
    ).fetchone()[0]
    return active_admins <= 1


def replace_user_roles(
    *,
    user_id: str,
    role_ids: list[str],
    version: int,
    actor_id: str,
    trace_id: str,
    ip: str,
    user_agent: str,
) -> dict[str, Any]:
    if user_id == actor_id:
        raise AuthError("USER_SELF_ROLE_FORBIDDEN", "不能修改自己的角色", 409)
    if not role_ids:
        raise AuthError("USER_ROLE_REQUIRED", "至少需要一个角色", 422)
    unique_role_ids = sorted(set(role_ids))
    now = to_db_time(utc_now())

    with auth_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        target = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if target is None:
            connection.execute("ROLLBACK")
            raise AuthError("USER_NOT_FOUND", "用户不存在", 404)
        if target["version"] != version:
            connection.execute("ROLLBACK")
            raise AuthError("USER_VERSION_CONFLICT", "用户信息已更新，请刷新后重试", 409)
        found = {
            row["id"] for row in connection.execute(
                f"SELECT id FROM roles WHERE id IN ({','.join('?' for _ in unique_role_ids)})",
                unique_role_ids,
            )
        }
        if found != set(unique_role_ids):
            connection.execute("ROLLBACK")
            raise AuthError("ROLE_NOT_FOUND", "包含不存在的角色", 422)
        before = [role["id"] for role in _roles_for_user(connection, user_id)]
        if "role:platform_admin" in before and "role:platform_admin" not in found:
            if _is_last_active_admin(connection, user_id):
                connection.execute("ROLLBACK")
                raise AuthError("LAST_ADMIN_REQUIRED", "不能移除最后一个有效平台管理员", 409)

        connection.execute("DELETE FROM user_roles WHERE user_id = ?", (user_id,))
        connection.executemany(
            """
            INSERT INTO user_roles(user_id, role_id, assigned_by, assigned_at)
            VALUES (?, ?, ?, ?)
            """,
            [(user_id, role_id, actor_id, now) for role_id in unique_role_ids],
        )
        connection.execute(
            """
            UPDATE users SET auth_version = auth_version + 1,
                version = version + 1, updated_at = ? WHERE id = ?
            """,
            (now, user_id),
        )
        connection.execute(
            "UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL",
            (now, user_id),
        )
        _audit(
            connection, action="user.roles.changed", result="success", trace_id=trace_id,
            ip=ip, user_agent=user_agent, actor_id=actor_id, target_id=user_id,
            metadata={"before": before, "after": unique_role_ids},
        )
        connection.execute("COMMIT")
        row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return _user_item(connection, row)


def reset_user_password(
    *,
    user_id: str,
    new_password: str,
    reason: str,
    version: int,
    actor_id: str,
    trace_id: str,
    ip: str,
    user_agent: str,
) -> dict[str, Any]:
    if user_id == actor_id:
        raise AuthError("USER_SELF_PASSWORD_FORBIDDEN", "请通过个人安全设置修改自己的密码", 409)
    if not 2 <= len(reason.strip()) <= 500:
        raise AuthError("PASSWORD_RESET_REASON_INVALID", "重置原因需为 2-500 个字符", 422)

    now = to_db_time(utc_now())
    with auth_connection() as connection:
        target = connection.execute(
            "SELECT * FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
        if target is None:
            raise AuthError("USER_NOT_FOUND", "用户不存在", 404)
        if target["version"] != version:
            raise AuthError("USER_VERSION_CONFLICT", "用户信息已更新，请刷新后重试", 409)
        validate_password(new_password, target["normalized_username"])
        password_hash = PASSWORD_HASHER.hash(new_password)

        connection.execute("BEGIN IMMEDIATE")
        cursor = connection.execute(
            """
            UPDATE users SET auth_version = auth_version + 1,
                version = version + 1, updated_at = ?
            WHERE id = ? AND version = ?
            """,
            (now, user_id, version),
        )
        if cursor.rowcount == 0:
            connection.execute("ROLLBACK")
            raise AuthError("USER_VERSION_CONFLICT", "用户信息已更新，请刷新后重试", 409)
        connection.execute(
            """
            UPDATE password_credentials SET password_hash = ?, changed_at = ?
            WHERE user_id = ?
            """,
            (password_hash, now, user_id),
        )
        connection.execute(
            "UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL",
            (now, user_id),
        )
        _audit(
            connection, action="user.password.reset_by_admin", result="success",
            trace_id=trace_id, ip=ip, user_agent=user_agent,
            actor_id=actor_id, target_id=user_id,
            metadata={"reason": reason.strip()},
        )
        connection.execute("COMMIT")
        row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return _user_item(connection, row)
