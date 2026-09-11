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
