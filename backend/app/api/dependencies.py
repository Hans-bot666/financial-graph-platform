"""FastAPI 认证与 RBAC 依赖。"""
from __future__ import annotations

from collections.abc import Callable
from typing import Any
from uuid import uuid4

from fastapi import HTTPException, Request

from app.services.auth_service import (
    AuthError,
    authenticate_session,
    record_auth_event,
    validate_session_csrf,
)
from config import COOKIE_NAME, CORS_ORIGINS


def _detail(code: str, message: str, trace_id: str) -> dict[str, Any]:
    return {"code": code, "message": message, "traceId": trace_id, "details": None}


def require_authenticated_user(request: Request) -> dict[str, Any]:
    trace_id = request.headers.get("x-request-id") or uuid4().hex
    try:
        user, _session = authenticate_session(request.cookies.get(COOKIE_NAME))
        return user
    except AuthError as error:
        raise HTTPException(
            status_code=error.status_code,
            detail=_detail(error.code, error.message, trace_id),
        ) from error


def require_permission(permission: str, *, csrf: bool = False) -> Callable[[Request], dict[str, Any]]:
    def dependency(request: Request) -> dict[str, Any]:
        trace_id = request.headers.get("x-request-id") or uuid4().hex
        ip = request.client.host if request.client else "unknown"
        user_agent = request.headers.get("user-agent", "")
        try:
            user, session = authenticate_session(request.cookies.get(COOKIE_NAME))
            if csrf:
                origin = request.headers.get("origin")
                if origin and origin not in CORS_ORIGINS:
                    raise AuthError("ORIGIN_INVALID", "请求来源校验失败", 403)
                validate_session_csrf(session, request.headers.get("x-csrf-token"))
        except AuthError as error:
            raise HTTPException(
                status_code=error.status_code,
                detail=_detail(error.code, error.message, trace_id),
            ) from error

        if permission not in user["permissions"]:
            record_auth_event(
                action="authorization.denied",
                result="failure",
                trace_id=trace_id,
                ip=ip,
                user_agent=user_agent,
                actor_id=user["id"],
                target_id=user["id"],
                metadata={"permission": permission, "path": request.url.path},
            )
            raise HTTPException(
                status_code=403,
                detail=_detail("AUTHZ_FORBIDDEN", "没有执行此操作的权限", trace_id),
            )
        return user

    return dependency
