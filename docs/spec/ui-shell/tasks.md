# 主导航 — 实施任务

- 依据：`README.md`、`sidebar-nav.spec.md`

| ID | 任务 | 状态 |
| --- | --- | --- |
| UI-T02 | `TopNav` 去页签 | done |
| UI-T08 | 删除 `RadialNav` 圆盘菜单 | done |
| UI-T09 | 新增默认窄栏的 `SideNav` | done |
| UI-T10 | 支持鼠标进入展开、离开收回 | done |
| UI-T11 | `MainLayout` 改为侧栏 + 右侧内容布局 | done |
| UI-T12 | 顶栏移除当前图名与用户管理入口 | done |
| UI-T13 | 侧栏按 `user.read` 权限显示用户管理 | done |
| UI-T14 | 顶栏用户区显示当前角色 | done |
| UI-T15 | 场景/子图搜索面板与搜索历史 | done |
| UI-T16 | 搜索结果打开：场景定位、子图进入探索分析 | done |
| UI-T17 | lint、构建与交互验收 | done（lint/build；浏览器交互待人工确认） |
| UI-T18 | `TabKey` 增加 `admin`，顶栏面包屑支持用户管理 | done |
| UI-T19 | 侧栏用户管理改为 `onTabChange('admin')`，带选中态 | done |
| UI-T20 | `MainLayout` 在 admin Tab 渲染 `AdminUsers`，无权限回退首页 | done |
| UI-T21 | 去掉用户管理独立顶栏/返回按钮，筛选改为组件状态 | done |
| UI-T22 | `/admin/users` 兼容跳转：有权限进 admin Tab，无权限进 403 | done |
| UI-T23 | lint、构建与管理员进出用户管理验收 | done（lint/typecheck；登录后交互待你本地点一次确认） |
