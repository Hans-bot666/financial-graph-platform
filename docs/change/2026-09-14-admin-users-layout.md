# 用户管理并入主工作台

- 日期：2026-09-14
- 对应规格：`docs/spec/ui-shell/admin-users-layout.spec.md`
- 范围：前端壳层导航；不改后台用户 API

## 变更

- `TabKey` 增加 `admin`。
- 侧栏「用户管理」通过 `onTabChange` 切换，不再离开 `MainLayout`。
- `AdminUsers` 去掉独立顶栏和返回按钮。
- `/admin/users` 兼容跳转：有 `user.read` 打开用户管理 Tab，否则进入 `/403`。
