"""后台用户与角色管理 API。"""
from __future__ import annotations

from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.api.dependencies import require_permission
from app.services.auth_service import AuthError
from app.services.user_admin_service import (
    change_user_status,
    create_user,
    get_user,
    list_roles,
    list_users,
    replace_user_roles,
    reset_user_password,
    update_user_profile,
)

router = APIRouter(prefix="/admin", tags=["user-administration"])


class CreateUserRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)
    display_name: str = Field(min_length=1, max_length=100, alias="displayName")
    role_ids: list[str] = Field(min_length=1, alias="roleIds")
    status: Literal["active", "disabled"] = "active"

    model_config = {"populate_by_name": True}


class UpdateUserRequest(BaseModel):
    display_name: str = Field(min_length=1, max_length=100, alias="displayName")
    avatar_url: str | None = Field(default=None, max_length=2048, alias="avatarUrl")
    bio: str | None = Field(default=None, max_length=500)
    version: int = Field(ge=1)

    model_config = {"populate_by_name": True}


class ChangeStatusRequest(BaseModel):
    status: Literal["active", "disabled"]
    reason: str = Field(min_length=2, max_length=500)
    version: int = Field(ge=1)


class ReplaceRolesRequest(BaseModel):
    role_ids: list[str] = Field(min_length=1, alias="roleIds")
    version: int = Field(ge=1)

    model_config = {"populate_by_name": True}


class ResetPasswordRequest(BaseModel):
    new_password: str = Field(min_length=1, max_length=256, alias="newPassword")
    reason: str = Field(min_length=2, max_length=500)
    version: int = Field(ge=1)

    model_config = {"populate_by_name": True}


def _context(request: Request) -> tuple[str, str, str]:
    return (
        request.headers.get("x-request-id") or uuid4().hex,
        request.client.host if request.client else "unknown",
        request.headers.get("user-agent", ""),
    )


def _error(error: AuthError, trace_id: str) -> JSONResponse:
    return JSONResponse(
        status_code=error.status_code,
        content={"code": error.code, "message": error.message, "traceId": trace_id, "details": None},
        headers={"X-Request-ID": trace_id},
    )


@router.get("/users")
async def users(
    q: str = Query(default="", max_length=100),
    status: str | None = Query(default=None),
    role: str | None = Query(default=None, max_length=64),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100, alias="pageSize"),
    sort_by: str = Query(default="createdAt", alias="sortBy"),
    sort_order: Literal["asc", "desc"] = Query(default="desc", alias="sortOrder"),
    _actor: dict = Depends(require_permission("user.read")),
) -> dict:
    return list_users(
        query=q,
        status=status,
        role=role,
        page=page,
        page_size=page_size,
        sort_by=sort_by,
        sort_order=sort_order,
    )


@router.post("/users", status_code=201)
async def add_user(
    payload: CreateUserRequest,
    request: Request,
    actor: dict = Depends(require_permission("user.create", csrf=True)),
):
    trace_id, ip, user_agent = _context(request)
    try:
        return create_user(
            username=payload.username,
            password=payload.password,
            display_name=payload.display_name,
            role_ids=payload.role_ids,
            status=payload.status,
            actor_id=actor["id"],
            trace_id=trace_id,
            ip=ip,
            user_agent=user_agent,
        )
    except AuthError as error:
        return _error(error, trace_id)


@router.get("/users/{user_id}")
async def user_detail(
    user_id: str,
    _actor: dict = Depends(require_permission("user.read")),
):
    try:
        return get_user(user_id)
    except AuthError as error:
        return _error(error, uuid4().hex)


@router.patch("/users/{user_id}")
async def edit_user(
    user_id: str,
    payload: UpdateUserRequest,
    request: Request,
    actor: dict = Depends(require_permission("user.update", csrf=True)),
):
    trace_id, ip, user_agent = _context(request)
    try:
        return update_user_profile(
            user_id=user_id,
            display_name=payload.display_name,
            avatar_url=payload.avatar_url,
            bio=payload.bio,
            version=payload.version,
            actor_id=actor["id"],
            trace_id=trace_id,
            ip=ip,
            user_agent=user_agent,
        )
    except AuthError as error:
        return _error(error, trace_id)


@router.patch("/users/{user_id}/status")
async def set_user_status(
    user_id: str,
    payload: ChangeStatusRequest,
    request: Request,
    actor: dict = Depends(require_permission("user.status.manage", csrf=True)),
):
    trace_id, ip, user_agent = _context(request)
    try:
        return change_user_status(
            user_id=user_id,
            status=payload.status,
            reason=payload.reason,
            version=payload.version,
            actor_id=actor["id"],
            trace_id=trace_id,
            ip=ip,
            user_agent=user_agent,
        )
    except AuthError as error:
        return _error(error, trace_id)


@router.put("/users/{user_id}/roles")
async def set_user_roles(
    user_id: str,
    payload: ReplaceRolesRequest,
    request: Request,
    actor: dict = Depends(require_permission("user.role.manage", csrf=True)),
):
    trace_id, ip, user_agent = _context(request)
    try:
        return replace_user_roles(
            user_id=user_id,
            role_ids=payload.role_ids,
            version=payload.version,
            actor_id=actor["id"],
            trace_id=trace_id,
            ip=ip,
            user_agent=user_agent,
        )
    except AuthError as error:
        return _error(error, trace_id)


@router.post("/users/{user_id}/password")
async def reset_password(
    user_id: str,
    payload: ResetPasswordRequest,
    request: Request,
    actor: dict = Depends(require_permission("user.password.reset", csrf=True)),
):
    trace_id, ip, user_agent = _context(request)
    try:
        return reset_user_password(
            user_id=user_id,
            new_password=payload.new_password,
            reason=payload.reason,
            version=payload.version,
            actor_id=actor["id"],
            trace_id=trace_id,
            ip=ip,
            user_agent=user_agent,
        )
    except AuthError as error:
        return _error(error, trace_id)


@router.get("/roles")
async def roles(
    _actor: dict = Depends(require_permission("user.read")),
) -> list[dict]:
    return list_roles()
