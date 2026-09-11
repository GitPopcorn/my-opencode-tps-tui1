# 安装落点与加载机制

本文档收录插件的安装落点实测、junction 方案与「入口为什么必须是原始 .tsx」的完整技术细节

---

## 一、两个参考插件的仓库定位

用 `opencode plugin <id>` 安装时，OpenCode 先按 npm 包名解析，因此「包名」才是权威线索

| 包名 | 版本 | 源码仓库 | 形态 |
|---|---|---|---|
| `opencode-tps1` | 0.1.2 | https://github.com/fengye110/opencode-tps1 | 单文件 `tui.tsx`，内联在 `session_prompt_right`，格式 `TPS x \| AVG x \| TTFT xs` |
| `opencode-tps-meter` | 0.3.1 | https://github.com/ChiR24/opencode-tps-meter | 多文件 TS，编译到 `dist/tui.mjs`，格式 `TPS: x (avg x) · n tok`，带 server 入口 |

两个包都声明了 `exports["./tui"]`，因此都走 TUI 插件通道

---

## 二、`opencode plugin` 的安装落点 (OpenCode 1.18.27 实测)

在隔离 HOME 里实跑 `opencode plugin <pkg> --global`，日志给出 `Detected tui target` / `Detected server + tui targets`，落盘结果如下

| 项目 | 位置 |
|---|---|
| 包体 | `~/.cache/opencode/packages/<净化后的 spec>/node_modules/<包名>/` |
| 包体 (spec 里的非法字符 `< > : " \| ? *` 与控制字符会替换成 `_`) | 同上 |
| 注册文件 (TUI 通道) | 全局 `~/.config/opencode/tui.json`，项目级 `<project>/.opencode/tui.json` |
| 注册文件 (server 通道) | 全局 `~/.config/opencode/opencode.json` / `opencode.jsonc`，项目级 `opencode.json` |
| 注册形式 | `plugin` 数组里追加一个纯字符串 spec，原样写回 (无 options 时不用元组) |
| 入口识别 | `exports["./tui"]` → TUI target；`exports["./server"]` 或 `main` → server target；`package.json["oc-themes"]` → 主题 |

具体到这两个包

- `opencode-tps1` → `Detected tui target`，只写 `tui.json`，包体落在 `~/.cache/opencode/packages/opencode-tps1@latest/`
- `opencode-tps-meter` → `Detected server + tui targets`，同时写 `tui.json` 与 `opencode.jsonc`，包体落在 `~/.cache/opencode/packages/opencode-tps-meter@latest/`

结论：`opencode plugin opencode-tps1@latest --global` 会安装到 `~/.cache/opencode/packages/opencode-tps1@latest/node_modules/opencode-tps1/`，并把 `"opencode-tps1@latest"` 追加进 `~/.config/opencode/tui.json` 的 `plugin` 数组

### 一个必须知道的坑

OpenCode 1.18 内建的 Solid JSX 转换插件 (`bun-plugin-solid`) 过滤器带负向预查 `(?!.*[/\\]node_modules[/\\])`，也就是**不处理 `node_modules` 里的裸 `.tsx`**。于是

- 直接给 `tui.json` 一个**本地绝对路径**指向 `tui.tsx` → 不在 `node_modules` 里 → 走完整 Solid 转换 → 响应式正常
- 把裸 `.tsx` 作为 npm 包发布再由 `opencode plugin` 安装 → 落在 `node_modules` → 只由 Bun 原生 JSX 处理。若文件里没有 `/** @jsxImportSource @opentui/solid */` 指令，Bun 会默认按 React 处理，导入 `react/jsx-runtime` 直接失败

结论：**入口固定为原始 `tui.tsx`，只有这一条路**。文件头带 `/** @jsxImportSource @opentui/solid */` 指令，两种落点都成立 —— 路径含 `node_modules` (npm 安装形态) 时跳过宿主转换器、由 Bun 原生 JSX 按指令编译；路径不含 (本地路径 / junction) 时走宿主的 Solid 转换器。预编译压缩产物反而会被宿主转换器处理并崩掉 (实测)

---

## 三、为什么 `tui.jsonc` 里可以直接写包名

裸 spec 的解析路径：

1. spec 拆成 `<name>@<version>`。没有 `@` 时 version 取 `latest`，`@scope/pkg` 因 `lastIndexOf("@") === 0` 也走无版本分支
2. 目录锁定为 `~/.cache/opencode/packages/<净化 spec>/`，其中 `< > : " | ? *` 与控制字符替换成 `_`
3. 短路条件：`<该目录>/node_modules/<name>` 已存在，则直接 `import.meta.resolve` 解析，不跑 npm install
4. 否则 `npm reify` 去 registry 装

所以只要把包按 npm 形态摆进缓存目录，就能用裸 ID 配置，全程不碰网络

---

## 四、目录形态 (不是把整个 spec 目录做成 junction)

```
仓库本体                                     <插件仓库目录>\my-opencode-tps-tui1

%USERPROFILE%\.cache\opencode\packages\my-opencode-tps-tui1@latest\
├── package.json                             {"dependencies":{"my-opencode-tps-tui1":"latest"}}
└── node_modules\
    └── my-opencode-tps-tui1   →  junction  →  仓库本体
```

把整个 `<spec>` 目录做成 junction 不行，因为短路判断查的正是 `<spec>/node_modules/<name>`，整目录 junction 之后该路径依然不存在，会掉进 npm install

### 为什么仓库本体不放进 `.config/opencode`

- 本插件独立成库推 GitHub。Git 不会收编嵌套仓库，父仓库只会把它记成 embedded repo 的 gitlink，两边的版本管理反而互相碍事
- 本体留在自己的仓库目录即可，缓存侧只放一条 junction，而 junction 可以随时重建
- 唯一代价：`%USERPROFILE%\.cache\opencode` 被清掉后链接会消失、插件静默失效，重跑 `scripts\relink.cmd` 就能恢复

### 各位置的存活能力对比

| 位置 | git 跟踪 | `opencode uninstall` | 结论 |
|---|---|---|---|
| 独立仓库目录 + 缓存 junction | 是，自己的仓库 | 只丢 junction，重跑脚本即恢复 | 采用 |
| `~/.config/opencode/plugins/<名>/` | 父仓库不会收编嵌套仓库 | `--keep-config` 可保 | 两处版本管理打架 |
| `~/.cache/opencode/packages/...` | 否 | Cache 在移除清单里硬编码 keep=false，无 keep 开关 | 会被直接删掉，禁用 |

`opencode uninstall` 的移除清单是 Data(keep=--keep-data) / Cache(keep=false) / Config(keep=--keep-config) / State(keep=false)。Cache 没有 keep 开关，所以本体绝不能放那儿

### 重建命令

```
scripts\relink.cmd
```

脚本放在仓库 `scripts\` 下，向上取一级作为本体目录，自动完成：写外壳 `package.json` → 建 junction → 穿透校验。已就绪时直接返回、不做任何删除；仅在链接损坏时才用不带 `/S` 的 `RMDIR` 移除旧链接，失败即中止

不用脚本的等价手工命令：

```
mklink /J "%USERPROFILE%\.cache\opencode\packages\my-opencode-tps-tui1@latest\node_modules\my-opencode-tps-tui1" "<仓库本体>"
```

### 几个实测注意点

- `opencode plugin` 插入新条目时会把插入点之后的缩进重排成空格，结构依旧合法，只是序列化器不保留原缩进；已存在的条目走 `Already configured` 分支，不重写文件
- 入口是原始 `tui.tsx`，**不需要任何构建产物**，跨设备克隆后直接可加载；插件目录也不需要 `node_modules` (`bun run check-deps` 会把 `dist/` 和本地 `@opentui` 都判为违规)
- 插件包自己的 `dependencies` 必须保持为空：本地安装的 `@opentui/solid` 会拉起第二份 `@opentui/core`，与宿主抢注册环境变量直接抛错 (见 [troubleshooting.md](troubleshooting.md))；solid-js 的 JSX 转换能力由宿主提供，无需也无法声明
- `.config/opencode/plugins/` 的自动扫描 glob 是 `{plugin,plugins}/*.{ts,js}`，只匹配直属文件、不递归子目录

---

## 五、入口为什么必须用原始 `.tsx`

### 换掉预编译产物的理由

对照两个能正常工作的参考插件

| 插件 | 入口 | 落点 |
|---|---|---|
| `opencode-tps1` | 原始 `tui.tsx` | `node_modules` 内 |
| `opencode-tps-meter` | 预编译 `dist/tui.mjs` | `node_modules` 内 |

两者都满足同一个前提：**入口文件位于路径含 `node_modules` 的位置**。宿主的 Solid 转换插件过滤器是

```
/^(?!.*[/\\]node_modules[/\\]).*\.[cm]?[jt]sx(?:[?#].*)?$/
```

也就是**跳过 `node_modules` 下的文件**。而本插件按 junction 方案加载时，`import.meta.resolve` 会把 junction 展开成真实路径 `<仓库本体>/...`，**路径里没有 `node_modules`**，于是转换器会去处理这个文件

- 原始 `.tsx` → 转换器正常工作，产出正确的元素树 (已实测渲染出完整一行)
- 预编译 + 压缩过的 `.js` → 转换器处理它时会出问题，导致整个入口模块加载失败，插件被静默丢弃

所以：**入口固定为原始 `tui.tsx`**。它在两种落点下都对

- 路径含 `node_modules` (真实安装) → 跳过转换器 → 靠文件头的 `/** @jsxImportSource @opentui/solid */` 指令
- 路径不含 `node_modules` (junction) → 走转换器

`bun run check-deps` 会把守这条：入口不是 `.tsx`、或存在 `dist/` 目录，都会报错
