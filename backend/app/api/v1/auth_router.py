"""用户注册、登录和服务端会话 API。"""
from __future__ import annotations

from uuid import uuid4

from fastapi import APIRouter, Cookie, Header, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.services.auth_service import (
    AuthError,
    authenticate_session,
    login_user,
    logout_session,
    record_auth_event,
    register_user,
)
from config import (
    COOKIE_NAME,
    COOKIE_SECURE,
    CORS_ORIGINS,
    SELF_REGISTRATION_ENABLED,
    SESSION_ABSOLUTE_HOURS,
)

router = APIRouter(prefix="/auth", tags=["authentication"])
CSRF_COOKIE_NAME = "fgp_csrf"


class RegisterRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)
    display_name: str = Field(min_length=1, max_length=100, alias="displayName")

    model_config = {"populate_by_name": True}


class LoginRequest(BaseModel):
    identifier: str = Field(min_length=1, max_length=254)
    password: str = Field(min_length=1, max_length=256)


def _request_context(request: Request) -> tuple[str, str, str]:
    trace_id = request.headers.get("x-request-id") or uuid4().hex
    ip = request.client.host if request.client else "unknown"
    user_agent = request.headers.get("user-agent", "")
    return trace_id, ip, user_agent


def _auth_error(error: AuthError, trace_id: str) -> JSONResponse:
    return JSONResponse(
        status_code=error.status_code,
        content={"code": error.code, "message": error.message, "traceId": trace_id, "details": None},
        headers={"X-Request-ID": trace_id},
    )


@router.get("/config")
async def auth_config() -> dict[str, object]:
    return {
        "selfRegistrationEnabled": SELF_REGISTRATION_ENABLED,
        "username": {"minLength": 3, "maxLength": 32},
        "password": {"minLength": 12, "maxLength": 128},
    }


@router.post("/register", status_code=201)
async def register(payload: RegisterRequest, request: Request) -> Response:
    trace_id, ip, user_agent = _request_context(request)
    origin = request.headers.get("origin")
    if origin and origin not in CORS_ORIGINS:
        return _auth_error(AuthError("ORIGIN_INVALID", "请求来源校验失败", 403), trace_id)
    if not SELF_REGISTRATION_ENABLED:
        return _auth_error(AuthError("REGISTRATION_DISABLED", "当前未开放自助注册", 403), trace_id)
    try:
        user = register_user(
            username=payload.username,
            password=payload.password,
            display_name=payload.display_name,
            trace_id=trace_id,
            ip=ip,
            user_agent=user_agent,
        )
        return JSONResponse(
            status_code=201,
            content=user,
            headers={"X-Request-ID": trace_id},
        )
    except AuthError as error:
        record_auth_event(
            action="auth.register",
            result="failure",
            trace_id=trace_id,
            ip=ip,
            user_agent=user_agent,
            metadata={"reason": error.code},
        )
        return _auth_error(error, trace_id)


@router.post("/login")
async def login(payload: LoginRequest, request: Request) -> Response:
    trace_id, ip, user_agent = _request_context(request)
    origin = request.headers.get("origin")
    if origin and origin not in CORS_ORIGINS:
        return _auth_error(AuthError("ORIGIN_INVALID", "请求来源校验失败", 403), trace_id)
    try:
        user, session_token, csrf_token = login_user(
            identifier=payload.identifier,
            password=payload.password,
            trace_id=trace_id,
            ip=ip,
            user_agent=user_agent,
        )
    except AuthError as error:
        return _auth_error(error, trace_id)

    response = JSONResponse(
        content={"user": user},
        headers={"X-Request-ID": trace_id},
    )
    max_age = SESSION_ABSOLUTE_HOURS * 60 * 60
    response.set_cookie(
        COOKIE_NAME,
        session_token,
        max_age=max_age,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="lax",
        path="/",
    )
    response.set_cookie(
        CSRF_COOKIE_NAME,
        csrf_token,
        max_age=max_age,
        httponly=False,
        secure=COOKIE_SECURE,
        samesite="lax",
        path="/",
    )
    return response


@router.get("/me")
async def me(session_token: str | None = Cookie(default=None, alias=COOKIE_NAME)) -> Response:
    trace_id = uuid4().hex
    try:
        user, _session = authenticate_session(session_token)
        return JSONResponse(content=user, headers={"X-Request-ID": trace_id})
    except AuthError as error:
        return _auth_error(error, trace_id)


@router.post("/logout", status_code=204)
async def logout(
    request: Request,
    session_token: str | None = Cookie(default=None, alias=COOKIE_NAME),
    csrf_token: str | None = Header(default=None, alias="X-CSRF-Token"),
) -> Response:
    trace_id, ip, user_agent = _request_context(request)
    origin = request.headers.get("origin")
    if origin and origin not in CORS_ORIGINS:
        return _auth_error(AuthError("ORIGIN_INVALID", "请求来源校验失败", 403), trace_id)
    try:
        logout_session(
            token=session_token,
            csrf_token=csrf_token,
            trace_id=trace_id,
            ip=ip,
            user_agent=user_agent,
        )
    except AuthError as error:
        return _auth_error(error, trace_id)
    response = Response(status_code=204, headers={"X-Request-ID": trace_id})
    response.delete_cookie(COOKIE_NAME, path="/")
    response.delete_cookie(CSRF_COOKIE_NAME, path="/")
    return response
