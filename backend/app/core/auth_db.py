"""用户认证 SQLite 数据库和迁移。"""
from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from config import USER_DB_PATH

SCHEMA_VERSION = 1

ROLE_PERMISSIONS: dict[str, tuple[str, ...]] = {
    "platform_admin": (
        "platform.access", "profile.read.self", "profile.update.self",
        "user.read", "user.create", "user.update", "user.status.manage", "user.role.manage",
        "user.password.reset",
        "graph.read", "graph.query", "scenario.read", "scenario.execute",
        "board.read", "board.write", "schema.read", "schema.write",
        "ingestion.read", "ingestion.write", "feature.read", "feature.write",
    ),
    "analyst": (
        "platform.access", "profile.read.self", "profile.update.self",
        "graph.read", "graph.query", "scenario.read", "scenario.execute",
        "board.read", "board.write", "schema.read", "ingestion.read", "feature.read",
    ),
    "viewer": (
        "platform.access", "profile.read.self", "profile.update.self",
        "graph.read", "scenario.read", "board.read", "schema.read", "ingestion.read", "feature.read",
    ),
}

ROLE_NAMES = {
    "platform_admin": "平台管理员",
    "analyst": "分析员",
    "viewer": "查看者",
}


def _sync_role_permissions(connection: sqlite3.Connection) -> None:
    """幂等同步内置角色权限，使已有 SQLite 数据库获得新增权限。"""
    for role_code, permission_codes in ROLE_PERMISSIONS.items():
        connection.execute(
            "INSERT OR IGNORE INTO roles(id, code, name, system) VALUES (?, ?, ?, 1)",
            (f"role:{role_code}", role_code, ROLE_NAMES[role_code]),
        )
        for permission_code in permission_codes:
            connection.execute(
                "INSERT OR IGNORE INTO permissions(id, code, name) VALUES (?, ?, ?)",
                (f"permission:{permission_code}", permission_code, permission_code),
            )
            connection.execute(
                "INSERT OR IGNORE INTO role_permissions(role_id, permission_id) VALUES (?, ?)",
                (f"role:{role_code}", f"permission:{permission_code}"),
            )


def _role_permissions_are_synced(connection: sqlite3.Connection) -> bool:
    expected = {
        (role_code, permission_code)
        for role_code, permission_codes in ROLE_PERMISSIONS.items()
        for permission_code in permission_codes
    }
    actual = {
        (row["role_code"], row["permission_code"])
        for row in connection.execute(
            """
            SELECT r.code AS role_code, p.code AS permission_code
            FROM role_permissions rp
            JOIN roles r ON r.id = rp.role_id
            JOIN permissions p ON p.id = rp.permission_id
            """
        )
    }
    return expected.issubset(actual)


def _connect(path: Path | None = None) -> sqlite3.Connection:
    db_path = path or USER_DB_PATH
    db_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(db_path, timeout=5, isolation_level=None)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA busy_timeout = 5000")
    connection.execute("PRAGMA journal_mode = WAL")
    return connection


@contextmanager
def auth_connection(path: Path | None = None) -> Iterator[sqlite3.Connection]:
    connection = _connect(path)
    try:
        migrate(connection)
        yield connection
    finally:
        connection.close()


def migrate(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL
        );
        """
    )
    current = connection.execute("SELECT COALESCE(MAX(version), 0) FROM schema_version").fetchone()[0]
    if current >= SCHEMA_VERSION:
        if not _role_permissions_are_synced(connection):
            connection.execute("BEGIN IMMEDIATE")
            try:
                _sync_role_permissions(connection)
                connection.execute("COMMIT")
            except Exception:
                connection.execute("ROLLBACK")
                raise
        return

    connection.executescript(
        """
        BEGIN IMMEDIATE;
        CREATE TABLE users (
            id TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            normalized_username TEXT NOT NULL UNIQUE,
            display_name TEXT NOT NULL,
            avatar_url TEXT,
            bio TEXT,
            status TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('pending', 'active', 'disabled', 'locked')),
            auth_version INTEGER NOT NULL DEFAULT 1,
            version INTEGER NOT NULL DEFAULT 1,
            failed_login_count INTEGER NOT NULL DEFAULT 0,
            locked_until TEXT,
            last_login_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE user_identities (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            type TEXT NOT NULL CHECK (type IN ('username', 'email', 'phone')),
            normalized_value TEXT NOT NULL,
            verified_at TEXT,
            is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
            UNIQUE(type, normalized_value)
        );

        CREATE TABLE password_credentials (
            user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            password_hash TEXT NOT NULL,
            changed_at TEXT NOT NULL
        );

        CREATE TABLE roles (
            id TEXT PRIMARY KEY,
            code TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            system INTEGER NOT NULL DEFAULT 1 CHECK (system IN (0, 1))
        );

        CREATE TABLE permissions (
            id TEXT PRIMARY KEY,
            code TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL
        );

        CREATE TABLE user_roles (
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
            assigned_by TEXT REFERENCES users(id),
            assigned_at TEXT NOT NULL,
            PRIMARY KEY (user_id, role_id)
        );

        CREATE TABLE role_permissions (
            role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
            permission_id TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
            PRIMARY KEY (role_id, permission_id)
        );

        CREATE TABLE sessions (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            token_hash TEXT NOT NULL UNIQUE,
            csrf_hash TEXT NOT NULL,
            auth_version INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            last_seen_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            revoked_at TEXT,
            ip TEXT,
            user_agent TEXT
        );

        CREATE TABLE login_attempts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            normalized_identifier TEXT NOT NULL,
            ip TEXT NOT NULL,
            succeeded INTEGER NOT NULL CHECK (succeeded IN (0, 1)),
            created_at TEXT NOT NULL
        );

        CREATE TABLE audit_events (
            id TEXT PRIMARY KEY,
            actor_id TEXT REFERENCES users(id),
            action TEXT NOT NULL,
            target_type TEXT,
            target_id TEXT,
            result TEXT NOT NULL,
            trace_id TEXT NOT NULL,
            ip TEXT,
            user_agent TEXT,
            metadata TEXT,
            created_at TEXT NOT NULL
        );

        CREATE INDEX idx_sessions_user ON sessions(user_id, revoked_at, expires_at);
        CREATE INDEX idx_login_attempts_ip_time ON login_attempts(ip, created_at);
        CREATE INDEX idx_login_attempts_identifier_time
            ON login_attempts(normalized_identifier, created_at);
        CREATE INDEX idx_audit_created ON audit_events(created_at);
        CREATE INDEX idx_audit_target ON audit_events(target_type, target_id, created_at);
        """
    )

    from datetime import datetime, timezone

    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    try:
        _sync_role_permissions(connection)
        connection.execute("INSERT INTO schema_version(version, applied_at) VALUES (?, ?)", (1, now))
        connection.execute("COMMIT")
    except Exception:
        connection.execute("ROLLBACK")
        raise
