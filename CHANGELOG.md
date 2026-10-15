# Changelog

本项目的全部显要的变更都记录在此文件

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)

## [Unreleased]

## [1.2.0] - 2026-10-15

### Added

- 新增侧边栏指标区块：同一份读数除输入框底部单行外，还能在侧边栏渲染成每个字段一行的多行区块，默认两处同开
- 新增 `locations` 配置：决定开启哪些展示位置 (`"prompt"` 输入框底部单行 / `"sidebar"` 侧边栏可折叠区块)，自动去重、丢弃非法值，空数组或全部非法时回落到默认全开
- 新增侧边栏区块排版配置 `sidebarSlot` / `sidebarCollapsed` / `sidebarTitle` / `sidebarIndent` / `sidebarAlign`：落点可选侧边栏内容区或底部、初始折叠态、标题行文本、行首缩进、值列对齐逐项可配
- 新增侧边栏区块折叠快捷键，命令名 `my-opencode-tps-tui1.sidebar.toggle`，已进命令面板，快捷键可自行改；折叠状态经 `api.kv` 持久化
- 侧边栏区块按终端显示宽度对齐值列，中文标签按 2 列计，`labels` 中英混排也能对齐
- 新增侧边栏区块排版配置 `sidebarSpinner`：控制标题行右侧是否显示缓冲动画图标，默认开启，写 `false` 会连同 100ms 帧定时器一起关掉

### Changed

- 侧边栏区块复用输入框底部同一套三档刷新节拍与 `buildReadout` 读数口径，两个位置共享同一份读数，数值必然一致
- 折叠靠改节点的 `visible` 实现，不增删节点，折叠前后的刷新开销与折叠态无关
- 侧边栏区块的标签与数值改为**全程灰色**，工作状态改由标题行右侧的 braille 缓冲动画图标表达，不再由文字颜色表达；`colorize` 只作用于输入框底部那行

### Fixed

- 修复 `session.deleted` 未回收 `painters` 导致的累积泄漏：已卸载组件的回调原先会永久留在表里，每 250ms 触发一次 `buildReadout()` + 节点写入 + `requestRender()`，会话开删越勤累积越久。现在删除会话时先广播一次再摘除登记，界面能正常刷成占位回落
- 修复组件经「切换会话 / 收起侧边栏」等非 `session.deleted` 路径卸载后的悬挂引用：opentui 的 `ref` 不提供 unmount 通知，登记表条目会残留。现在按节点的 `isDestroyed` 在两个定时器里兜底回收，判据缺失时一律按存活处理，宁可少回收也不误删活组件
- 修复缓冲动画图标空闲时的空转：跳帧前先判断是否有活跃实例，无人活跃时不写节点也不请求重绘
- 更正一条长期存在的错误结论：`tui.tsx` 文件头与 `scripts/check-deps.ts` 规则二原先称「裸 `solid-js` 导入会被静默丢弃」，实测宿主 `@opentui/solid/runtime-plugin-support/configure.js` 的重写映射表**包含** `"solid-js"` 与 `"solid-js/store"`，裸 specifier 会被改写到宿主唯一实例（OpenCode 内置 MCP / LSP / Todo / Files 四个侧边栏区块自己就是这么写的）。真正致命的只有「插件目录装出 `node_modules`」。本次**只更正注释与文档描述，`check-deps.ts` 的正则拦截刻意保留**——本插件全程命令式渲染，禁掉是风格约束，去留需真机验证

## [1.1.0] - 2026-09-11

### Added

- 新增 `labels` 配置：各字段渲染前缀可自定义为任意字符串、特殊符号或 Emoji；未配置、留空或写错键名的字段回落为字段名自身
- 新增 CHANGELOG.md 版本发布历史文件

### Changed

- 大幅度规范化代码：统一 JSDoc 元素注释与结构注释体系，全仓执行格式硬标准 (TAB 缩进、CRLF、注释标签、区域分隔线)

## [1.0.0] - 2026-09-11

### Added

- 首个可用版本：TPS / 词元 / 时延 HUD，渲染在 OpenCode 1.x TUI 会话提示行右侧
- 指标来自 OpenCode 公开事件流，支持 items 显示项与顺序、separator、精度、三档刷新、sts 文案表等配置
