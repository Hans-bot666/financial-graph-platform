"""受控创建首个平台管理员。

用法（在 backend 目录）：
    python create_admin.py --username platform-admin --display-name 平台管理员
"""
from __future__ import annotations

import argparse
import getpass
import os
from uuid import uuid4

from app.core.auth_db import auth_connection
from app.services.auth_service import _audit, normalize_username, register_user, to_db_time, utc_now


def main() -> int:
    parser = argparse.ArgumentParser(description="创建金融图谱平台首个管理员")
    parser.add_argument("--username", default="platform-admin")
    parser.add_argument("--display-name", default="平台管理员")
    args = parser.parse_args()

    with auth_connection() as connection:
        existing_admin = connection.execute(
            """
            SELECT u.username FROM users u
            JOIN user_roles ur ON ur.user_id = u.id
            WHERE ur.role_id = 'role:platform_admin' AND u.status = 'active'
            LIMIT 1
            """
        ).fetchone()
        if existing_admin:
            print(f"有效平台管理员已存在：{existing_admin['username']}，未做修改。")
            return 0

    password = os.getenv("INITIAL_ADMIN_PASSWORD") or getpass.getpass("初始密码（至少 12 位）: ")
    normalized = normalize_username(args.username)
    with auth_connection() as connection:
        existing = connection.execute(
            "SELECT id FROM users WHERE normalized_username = ?",
            (normalized,),
        ).fetchone()

    if existing is not None:
        print("指定用户名已被普通用户占用，请选择其他管理员用户名。")
        return 1
    user = register_user(
        username=args.username,
        password=password,
        display_name=args.display_name,
        trace_id=uuid4().hex,
        ip="bootstrap",
        user_agent="create_admin.py",
    )
    user_id = user["id"]

    now = to_db_time(utc_now())
    trace_id = uuid4().hex
    with auth_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        connection.execute(
            """
            INSERT OR IGNORE INTO user_roles(user_id, role_id, assigned_at)
            VALUES (?, 'role:platform_admin', ?)
            """,
            (user_id, now),
        )
        connection.execute(
            """
            UPDATE users SET status = 'active', auth_version = auth_version + 1,
                version = version + 1, updated_at = ? WHERE id = ?
            """,
            (now, user_id),
        )
        _audit(
            connection, action="user.bootstrap_admin", result="success",
            trace_id=trace_id, ip="bootstrap", user_agent="create_admin.py",
            actor_id=user_id, target_id=user_id,
        )
        connection.execute("COMMIT")

    print(f"平台管理员已就绪：{args.username}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
