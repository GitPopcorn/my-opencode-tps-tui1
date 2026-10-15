# 排障与自诊断

本文档收录一次「完全没加载」故障的完整复盘、两条硬规则与探针自诊断手法的留档

---

## 一、为什么一开始「完全没加载」(复盘)

现象：`tui.jsonc` 里配了裸包名，但 `plugin-meta.json` 没有条目，`opencode.log` 零记录，stderr 也是空的

### 两个真实原因

用「把 `dist/tui.js` 直接登记成插件入口，让它在 `app_bottom` 槽位渲染诊断文本」的探针法逐层剥离，得到两个原因

1. **本地装了 `@opentui/solid`**
   `bun install` 在插件目录生成的 `node_modules/@opentui/solid` 会拉起第二份 `@opentui/core`，与宿主抢注册同一个环境变量，直接抛错

   ```
   Environment variable "OPENTUI_FORCE_WCWIDTH" is already registered with different configuration
   ```

   于是整个插件被静默丢弃

2. **裸 specifier 不会被宿主重写**
   清掉本地依赖后暴露第二层：`import { createSignal } from "solid-js"` 解析失败，报文是 `Cannot find package 'solid-js'`
   OpenCode 的运行时重写只覆盖 `@opentui/solid` 这类**子路径** specifier，裸 specifier 照常走普通解析 (对应实现里的 `nodeModulesBareSpecifiers` 默认为 false)
   参考插件 `opencode-tps1` 正因为这个裸导入而加载不了；`oh-my-opencode-slim` 是整包打包、没有任何外部 import，所以它没事

### 两条硬规则

- 插件入口**不得出现来自 `solid-js` 的裸导入**。刷新一律走命令式：`ref` 拿到节点后改 `content`，再 `requestRender`。本插件已按此实现
- 插件目录**不得存在 `node_modules/@opentui`**。`bun run check-deps` 会同时检查这两项

---

## 二、排查手法留档

- TUI 插件的加载异常走 `console.error("[tui.plugin] ...")`，**不写进 `opencode.log`**，也不出现在 stderr (`--print-logs`、`--log-level DEBUG` 都拿不到) → 只能靠探针插件
- `plugin-meta.json` 只对部分插件写条目 (`oh-my-opencode-slim` 有、纯 TUI 插件没有)，**不能当作是否加载的判据**
- 启动画面在管道 stdin 下永远停在 `Finishing startup…`，进不了会话视图；要观测渲染结果，探针必须注册在 `app_bottom` 这类首页可见的槽位
- `tui.jsonc` 里写进去的包名**不会触发自动安装**。`opencode-tps1@latest` / `opencode-tps-meter@latest` 在缓存里根本不存在，所以它们也一直没加载；缺失的包会被静默跳过

---

## 三、一次自诊断 (把"没反应"变成"看得见")

TUI 插件的加载失败不留任何痕迹，所以出问题时要主动把槽位挪到首页可见的位置

1. 生成一份探针副本 (槽位从 `session_prompt_right` 换成 `app_bottom`)

   ```
   bun run scripts/probe.ts
   ```

2. 它会打印一个临时目录路径，并提示在里面执行 `opencode`

3. 探针会把状态行渲染在首页底部。看到 `TPS - | AVG_TPS - | ...` 就说明插件本体与注册链路都正常；什么都看不到就是加载失败

4. 探针是临时副本，不影响仓库里的正式文件

---

## 四、常见的注册坑

注册到 `~/.config/opencode/tui.json` 的每一项都会被 OpenCode 当成 npm 包名去解析。若配置里存在 npm 上返回 404 的包名，启动时会尝试安装并失败。要么删掉这一项，要么把包名换成真实存在的包

---

## 五、侧边栏指标区块常见故障

下面四条都是实测里真出现过的现象，按排查顺序走

### 侧边栏完全看不到指标区块

依次排查三处：

1. **侧边栏本身是不是可见的**：终端宽度 ≤ 120 时侧边栏是**浮层**而不是常驻分栏，默认不一定展开。先确认侧边栏确实打开着
2. **当前是不是在会话页**：两个侧边栏槽位都属于会话路由，主页 (home) 不渲染，进会话后才出现
3. **`locations` 里有没有 `"sidebar"`**：`locations` 缺省就是 `["prompt", "sidebar"]`，一旦显式写过就要确认没把 `"sidebar"` 漏掉

三处都对还是看不到，再回本文第二节确认插件本身是否加载成功

### 配了 `sidebarSlot: "footer"`，区块有了但版本号脚注没了

**这是预期行为，不是 bug**。`footer` 槽位是 `single_winner` 语义，同一槽位只能存在一个注册者，插件的侧边栏区块与内置的版本号脚注 (`• OpenCode <version>`) 互相顶掉，谁后注册谁赢。想要版本号脚注就把 `sidebarSlot` 改回默认的 `"content"`

### 侧边栏区块正常，但输入框底部那行不见了

`locations` 少了 `"prompt"`。两个位置各自独立开关，`["sidebar"]` 就是只留侧边栏。改回 `["prompt", "sidebar"]` 即恢复

补一句：默认配置下老用户升级后输入框底部那行的显示内容与行为**完全不变**，看不到那行一定是配置里动过 `locations`

### 中文标签对齐看起来差一列

`displayWidth` 用的是**简化**宽字符表（CJK 标点 / CJK 与扩展汉字 / 全角字符与符号 / 基本平面以上码点按 2 列计，其余按 1 列），不是完整的 East Asian Width 表

- 中文、全角、Emoji 计算正确，中英混排的 `labels` 能正常对齐
- **韩文、注音、部分符号修饰符**会偏 1 列，值列看上去差一列就是这个原因
- 规避方式：设 `sidebarAlign: false`，每行退化成「缩进 + 标签 + 单个空格 + 值」，代价是行长参差；或者把那几个标签换成表内的字符

### 侧边栏看不到缓冲动画图标

按顺序排查四处：

1. **当前是不是在会话页**：两个侧边栏槽位都属于会话路由，主页 (home) 不渲染
2. **`locations` 里有没有 `"sidebar"`**
3. **`sidebarSpinner` 是不是被写成了 `false`**：只有显式写 `false` 才关；写 `0` / `"no"` / `null` 都会按开启处理
4. **会话是不是真的活跃**：动画的判据是 `readout.active`，看 `STS` 那一行——`Waiting...` / `Streaming...` 说明在忙、图标该转，`Ready` 说明会话空闲、图标**本来就该隐藏**

第 4 条最容易误判：图标只在会话**忙**的时候出现，空闲时整个节点 `visible = false`，不是留一个空格或灰字占位。所以「看不到图标」在空闲状态下是正确表现，不是故障

### 长时间使用后 TUI 出现异常 / 操作变卡

这一版修掉的正是这类**累积型**问题。成因是已卸载组件的引用没被回收：

- `session.deleted` 原先不删 `painters` 表，而每个 request 闭包都抓着已卸载组件的节点对象，每 250ms 跑一次 `buildReadout()` + 节点写入 + `requestRender()`
- 组件被「切换会话 / 收起侧边栏」这类路径卸载时（没走 `session.deleted`），登记表里的条目会残留

表现是**用得越久越卡**，且重启 TUI 就恢复——因为一切都在进程内。

现在的行为：

- `session.deleted` 会先广播一次再摘除三张表的键，界面能正常刷成占位回落
- 250ms 指标节拍与 100ms 帧定时器每次都会调 `pruneDestroyed()`，按 opentui 的 `isDestroyed` 兜底回收已销毁组件；判据缺失时一律按存活处理，宁可少回收也不误删活组件

自查方法：频繁开关一批会话，如果卡顿不再随会话数线性增长，说明这条已经生效。若仍然复现，先设 `locations: ["prompt"]` 只留输入框底部那行做对照——侧边栏区块整个不注册，能立刻排除它是不是元凶
