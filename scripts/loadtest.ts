/**
 * 加载级实测
 * </br>用桩件替掉 @opentui/solid，把 tui.tsx 现编产物真实 import 进来，
 * 投递合成事件后读取被命令式写入的 text 节点，校验单块渲染、空值占位、
 * 活动高亮、耗时冻结、STS 状态机、幂等、会话释放与侧边栏可折叠区块。
 * </br>运行：bun run loadtest
 * </br>NOTE 本插件走命令式刷新：prompt 行是单块 <code><text></code>，
 * 侧边栏是标题行 + 多行「row box + label/value」结构，ref 回调里捕获节点后直接改 content / fg / visible。
 * </br>桩件的 createElement 必须模拟 ref 回调、保存 fg 与 visible，并摊平嵌套 children。
 * @author DeepSeek_V4_Flash
 * @date 2026-09-11
 * @note note
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ===== ===== ===== ===== [常量] ===== ===== ===== =====

/** CONST 仓库根目录 (scripts/ 的上一级) */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** CONST 正式插件入口文件路径 */
const source = join(root, "tui.tsx");

/** CONST 加载级测试的工作目录 */
const work = join(root, ".loadtest");

/** CONST 现编产物的输出路径 (仅存在于 work 内，不写回仓库) */
const built = join(work, "tui.js");

/** CONST kv 键名，与 tui.tsx 里保持一致 */
const KV_KEY = "my-opencode-tps-tui1:sidebar:collapsed";

/** CONST @opentui/solid 桩件：元素带 content / fg / visible 字段并触发 ref，模拟命令式刷新路径 */
const JSX_STUB = `
import { createComponent, createElement } from "./index.js";
export function jsx(type, props) {
	if (typeof type === "function") return createComponent(type, props ?? {});
	return createElement(type, props ?? {});
	
}

export const jsxs = jsx;
export function jsxDEV(type, props) { return jsx(type, props); }
export function Fragment(props) { return props.children ?? null; }
`;

/** CONST 桩件运行时：createElement 模拟 ref 回调并摊平数组 children，createComponent 直调组件函数 */
const INDEX_STUB = `
export function createElement(type, props) {
	// STEP 把嵌套的 children 数组摊平一层，模拟宿主对 JSX 数组的常规处理
	let children = props ? props.children : undefined;
	if (Array.isArray(children)) {
		const flat = [];
		for (const child of children) {
			if (Array.isArray(child)) {
				for (const inner of child) {
					if (inner !== undefined && inner !== null) flat.push(inner);
				}
			} else if (child !== undefined && child !== null) {
				flat.push(child);
			}
		}
		children = flat;
	}
	const node = { type, content: "", fg: undefined, visible: true, ...props, props: { ...props, children } };
	if (props && typeof props.ref === "function") props.ref(node);
	return node;
	
}

export function createComponent(type, props) { return type(props); }
export function spread() {}
`;

/** CONST 测试驱动：注册假 api → 投合成事件 → 读取 text 节点 */
const DRIVER = `
// ===== ===== ===== ===== [环境搭建] ===== ===== ===== =====

import plugin from "./tui.js";

const KV_KEY = "my-opencode-tps-tui1:sidebar:collapsed";

// STEP 帧表与 tui.tsx 保持一致，用于校验动画图标写入的内容确实来自帧表
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const handlers = new Map();
const registeredSlots = [];
let slots = {};
let layers = [];
let kvStore = new Map();
let dispose = null;
let renders = 0;

// STEP 构造假 api：事件总线、槽位注册、主题、渲染器、生命周期、toast、keymap、kv

const api = {
	event: { on(type, handler) { handlers.set(type, handler); return () => handlers.delete(type); } },
	slots: { register(p) { registeredSlots.push(p); slots = Object.assign({}, slots, p.slots); } },
	theme: { current: { textMuted: "muted", info: "info", success: "ok", secondary: "sec", text: "text" } },
	renderer: { requestRender() { renders = renders + 1; } },
	lifecycle: { onDispose(fn) { dispose = fn; return () => {}; } },
	ui: { toast() {} },
	keymap: {
		registerLayer(layer) { layers.push(layer); return () => {}; },
		dispatchCommand(name) {
			for (const layer of layers) {
				for (const cmd of layer.commands ?? []) {
					if (cmd.name !== name) continue;
					cmd.run({});
					return;
				}
			}
		},
	},
	kv: {
		get(key, fallback) { return kvStore.has(key) ? kvStore.get(key) : fallback; },
		set(key, value) { kvStore.set(key, value); },
	},
};

// STEP 重新加载插件，清空所有桩件状态

const load = async (options) => {
	handlers.clear();
	registeredSlots.length = 0;
	slots = {};
	layers = [];
	kvStore.clear();
	renders = 0;
	dispose = null;
	await plugin.tui(api, options);
};

// STEP 加载插件本体并打印接线信息

await load(undefined);
console.log("插件 id      :", plugin.id);
console.log("注册事件     :", [...handlers.keys()].sort().join(", "));
console.log("注册槽位     :", Object.keys(slots).join(", "));

// STEP 定义事件投递辅助函数

const emit = (type, properties) => {
	const handler = handlers.get(type);
	if (! handler) throw new Error("未注册的事件: " + type);
	handler({ type, properties });
	
};

const slotOrder = (name) => {
	for (const reg of registeredSlots) {
		if (reg.slots[name] !== undefined) return reg.order;
	}
	return undefined;
	
};

// ===== ===== ===== ===== [合成事件数据] ===== ===== ===== =====

// NOTE 消息时间戳为合成值，流式增量与 busy 耗时由插件内部取真实 Date.now()，
// 因此 TPS / TTFT / busy 期 DUR 无法在此精确复现 (由 scripts/selftest.ts 覆盖逻辑)，
// 这里只断言由消息时间戳决定的确定性字段。
const TURNS = [
	{ start: 0, wall: 500000, tokens: 9000 },
	{ start: 600000, wall: 400000, tokens: 8890 },
	{ start: 1100000, wall: 528000, tokens: 9000 },
	{ start: 1800000, wall: 177000, tokens: 560 },
];

// STEP 渲染首帧并捕获单块 text 节点

const tree = slots.session_prompt_right({}, { session_id: "ses_1" });
const box = tree.props;
const text = box.children;
const read = () => text.content;
const fg = () => text.fg;

// ===== ===== ===== ===== [断言辅助] ===== ===== ===== =====

let failures = 0;
const check = (label, actual, expected) => {
	// STEP 判定并计数
	const ok = actual === expected;
	if (! ok) failures = failures + 1;
	
	// STEP 输出断言结果行
	const mark = ok ? "PASS " : "FAIL ";
	console.log("[" + mark + "] " + label + ": " + JSON.stringify(actual) + (ok ? "" : " (期望 " + JSON.stringify(expected) + ")"));
	
};

// ===== ===== ===== ===== [区段一：首帧] ===== ===== ===== =====

console.log("--- 首帧 (空会话) ---");
console.log("box 属性  :", JSON.stringify({ flexDirection: box.flexDirection, flexShrink: box.flexShrink, gap: box.gap }));
console.log("渲染结果  :", read());
check("单块渲染 (children 是单个 text 而非数组)", Array.isArray(box.children), false);
check("折行交给宿主，不再自开 gap", box.gap, undefined);
check("空会话全字段占位", read(), "TPS 0 | AVG_TPS 0 | TOKEN 0 | TOTAL_TK 0 | TTFT 0 | AVG_TTFT 0 | DUR 0 | TOTAL_DUR 0 | STS -");
check("静止回落灰色", fg(), "muted");

// ===== ===== ===== ===== [区段二：事件回放] ===== ===== ===== =====

console.log("--- 投递四轮事件 ---");

// STEP 逐轮回放：user → assistant 开始 → 流式增量 → 完成

for (const turn of TURNS) {
	const id = "msg_" + turn.start;
	emit("message.updated", { sessionID: "ses_1", info: { id: "usr_" + turn.start, sessionID: "ses_1", role: "user", time: { created: turn.start } } });
	emit("message.updated", { sessionID: "ses_1", info: { id, sessionID: "ses_1", role: "assistant", time: { created: turn.start }, tokens: { output: 0, reasoning: 0 }, cost: 0 } });
	emit("message.part.delta", { sessionID: "ses_1", messageID: id, partID: "p1", field: "text", delta: "x".repeat(200) });
	// PART 末轮流式中插入平台合成的新 user 消息 (ID 不同)：轮进行中不得清零
	if (turn.start === 1800000) {
		emit("message.updated", { sessionID: "ses_1", info: { id: "usr_synthetic", sessionID: "ses_1", role: "user", time: { created: 1800001 } } });
		
	}
	emit("message.updated", { sessionID: "ses_1", info: { id, sessionID: "ses_1", role: "assistant", time: { created: turn.start, completed: turn.start + turn.wall }, tokens: { output: turn.tokens, reasoning: 0 }, cost: 0, finish: "stop" } });
	
}

// STEP 幂等校验：重复投递完成事件不应重复计数

emit("message.updated", { sessionID: "ses_1", info: { id: "msg_1800000", sessionID: "ses_1", role: "assistant", time: { created: 1800000, completed: 1977000 }, tokens: { output: 560, reasoning: 0 }, cost: 0, finish: "stop" } });
// STEP 幂等校验：重复投递 user 消息不得清空本轮读数 (实测会导致 TOKEN/TTFT/DUR 提前清零)
emit("message.updated", { sessionID: "ses_1", info: { id: "usr_1800000", sessionID: "ses_1", role: "user", time: { created: 1800000 } } });
emit("session.status", { sessionID: "ses_1", status: { type: "busy" } });

// ===== ===== ===== ===== [区段三：busy 断言] ===== ===== ===== =====

console.log("--- busy (进行中) ---");
const busyLine = read();
console.log("渲染结果  :", busyLine);
check("活动高亮为白色", fg(), "text");
check("busy 行含 TOKEN 560", busyLine.includes("TOKEN 560"), true);
check("busy 行含 TOTAL_TK 27.45k", busyLine.includes("TOTAL_TK 27.45k"), true);
check("busy 行含 STS Waiting...", busyLine.includes("STS Waiting..."), true);
check("busy 行是单块 (无换行符)", busyLine.includes("\\n"), false);

// ===== ===== ===== ===== [区段四：idle 与状态机断言] ===== ===== ===== =====

// STEP idle 后耗时冻结、累计保留、颜色回落

emit("session.idle", { sessionID: "ses_1" });
console.log("--- idle (挂机回来) ---");
const idleLine = read();
console.log("渲染结果  :", idleLine);
check("静止回落灰色", fg(), "muted");
check("idle 后 TOKEN 保留", idleLine.includes("TOKEN 560"), true);
check("idle 后 TOTAL_TK 保留", idleLine.includes("TOTAL_TK 27.45k"), true);
check("idle 后 DUR 冻结在结算值", idleLine.includes("DUR 2m57s"), true);
check("idle 后 TOTAL_DUR 冻结在结算值", idleLine.includes("TOTAL_DUR 26m45s"), true);
check("idle 转 Ready", idleLine.includes("STS Ready"), true);

// SUBSTEP 重试与错误文案

emit("session.status", { sessionID: "ses_1", status: { type: "retry", attempt: 3 } });
check("重试文案", read().includes("STS Retrying #3..."), true);

emit("session.error", { sessionID: "ses_1" });
check("错误文案", read().includes("STS Error"), true);

// SUBSTEP 会话释放：回落占位行而非整行消失

const beforeDelete = renders;
emit("session.deleted", { sessionID: "ses_1" });
// NOTE hideEmpty=false 时空会话回落到占位行 (与首帧一致)，而不是整行消失
check("会话释放后回落占位行", read(), "TPS 0 | AVG_TPS 0 | TOKEN 0 | TOTAL_TK 0 | TTFT 0 | AVG_TTFT 0 | DUR 0 | TOTAL_DUR 0 | STS -");
check("释放后不再重绘空行", renders >= beforeDelete, true);

// ===== ===== ===== ===== [区段五：侧边栏可折叠区块] ===== ===== ===== =====

console.log("--- 侧边栏：locations 单选 ---");

// STEP 重新加载为仅 sidebar，确认 prompt 槽位未注册且 sidebar_content 注册为 order 50

await load({ locations: ["sidebar"] });
check("仅 sidebar 时 prompt 未注册", slots.session_prompt_right, undefined);
check("sidebar_content 已注册", typeof slots.sidebar_content, "function");
check("sidebar_content order", slotOrder("sidebar_content"), 50);

console.log("--- 侧边栏：footer 槽位 ---");

// STEP 重新加载为 footer，确认 order 200 且 content 未注册

await load({ locations: ["sidebar"], sidebarSlot: "footer" });
check("footer 时 sidebar_footer 已注册", typeof slots.sidebar_footer, "function");
check("footer 时 sidebar_footer order", slotOrder("sidebar_footer"), 200);
check("footer 时 sidebar_content 未注册", slots.sidebar_content, undefined);

console.log("--- 侧边栏：首帧与 row 结构 ---");

// STEP 重新加载为 content 侧边栏，渲染首帧

await load({ locations: ["sidebar"] });
const sidebarTree = slots.sidebar_content({}, { session_id: "ses_1" });
const rootBox = sidebarTree.props;
const titleBox = rootBox.children[0];
const fieldRows = rootBox.children.slice(1);
// NOTE 标题行已改为左右分区：左区 box 承载箭头 / 标题 / 摘要，右区是缓冲动画图标
const titleLeftBox = titleBox.props.children[0];
const arrowText = titleLeftBox.props.children[0];
const titleText = titleLeftBox.props.children[1];

console.log("标题行属性:", JSON.stringify({ flexDirection: titleBox.flexDirection, gap: titleBox.gap }));
console.log("首帧字段行数:", fieldRows.length);

check("首帧字段行数", fieldRows.length, 9);
check("首帧箭头为展开", arrowText.content, "▼");
check("首帧标题为纯文本", titleText.content, "METRICS");

// STEP 逐行断言 row box 与 cell 结构

const expectedLabels = ["TPS", "AVG_TPS", "TOKEN", "TOTAL_TK", "TTFT", "AVG_TTFT", "DUR", "TOTAL_DUR", "STS"];
const expectedValues = ["0", "0", "0", "0", "0", "0", "0", "0", "-"];

for (let i = 0; i < fieldRows.length; i = i + 1) {
	const row = fieldRows[i];
	const label = row.props.children[0];
	const value = row.props.children[1];
	
	check("row " + i + " 宽度 100%", row.width, "100%");
	check("row " + i + " flexDirection row", row.flexDirection, "row");
	check("row " + i + " justifyContent space-between", row.justifyContent, "space-between");
	check("row " + i + " shouldFill", row.shouldFill, true);
	check("row " + i + " paddingLeft 2", row.paddingLeft, 2);
	check("row " + i + " 含两个子节点", row.props.children.length, 2);
	check("row " + i + " label", label.content, expectedLabels[i]);
	check("row " + i + " value", value.content, expectedValues[i]);
	check("row " + i + " label 颜色 muted", label.fg, "muted");
	check("row " + i + " value 颜色 muted", value.fg, "muted");
	check("row " + i + " label wrapMode", label.wrapMode, "none");
	check("row " + i + " value wrapMode", value.wrapMode, "none");
	check("row " + i + " value truncate", value.truncate, true);
	check("row " + i + " label flexShrink", label.flexShrink, 0);
	check("row " + i + " value flexShrink", value.flexShrink, 1);
}

console.log("--- 侧边栏：sidebarAlign=false ---");

// STEP 重新加载并关闭对齐，确认标签与值自然紧邻

await load({ locations: ["sidebar"], sidebarAlign: false });
const alignTree = slots.sidebar_content({}, { session_id: "ses_1" });
const alignRows = alignTree.props.children.slice(1);
const firstRow = alignRows[0];
const firstLabel = firstRow.props.children[0];
const firstValue = firstRow.props.children[1];

check("align=false 无 space-between", firstRow.justifyContent, undefined);
check("align=false 有 columnGap", firstRow.columnGap, 1);
check("align=false 标签与值紧邻", firstLabel.content + " " + firstValue.content, "TPS 0");

console.log("--- 侧边栏：折叠与 kv ---");

// STEP 回到默认对齐，渲染并折叠

await load({ locations: ["sidebar"] });
const foldTree = slots.sidebar_content({}, { session_id: "ses_1" });
const foldRoot = foldTree.props;
const foldTitleBox = foldRoot.children[0];
const foldRows = foldRoot.children.slice(1);
const foldArrow = foldTitleBox.props.children[0].props.children[0];

check("折叠前字段行可见", foldRows.every((r) => r.visible !== false), true);

foldTitleBox.props.onMouseDown();
check("折叠后字段行不可见", foldRows.every((r) => r.visible === false), true);
check("折叠后标题行仍在", foldTitleBox.visible !== false, true);
check("折叠后箭头", foldArrow.content, "▶");
check("折叠后 kv 写入 true", api.kv.get(KV_KEY), true);

api.keymap.dispatchCommand("my-opencode-tps-tui1.sidebar.toggle");
check("展开后字段行可见", foldRows.every((r) => r.visible !== false), true);
check("展开后箭头", foldArrow.content, "▼");
check("展开后 kv 写入 false", api.kv.get(KV_KEY), false);

console.log("--- 侧边栏：事件回放数值 ---");

// STEP 用同一组事件回放，校验侧边栏字段值与单行一致

for (const turn of TURNS) {
	const id = "msg_" + turn.start;
	emit("message.updated", { sessionID: "ses_1", info: { id: "usr_" + turn.start, sessionID: "ses_1", role: "user", time: { created: turn.start } } });
	emit("message.updated", { sessionID: "ses_1", info: { id, sessionID: "ses_1", role: "assistant", time: { created: turn.start }, tokens: { output: 0, reasoning: 0 }, cost: 0 } });
	emit("message.part.delta", { sessionID: "ses_1", messageID: id, partID: "p1", field: "text", delta: "x".repeat(200) });
	if (turn.start === 1800000) {
		emit("message.updated", { sessionID: "ses_1", info: { id: "usr_synthetic", sessionID: "ses_1", role: "user", time: { created: 1800001 } } });
		
	}
	emit("message.updated", { sessionID: "ses_1", info: { id, sessionID: "ses_1", role: "assistant", time: { created: turn.start, completed: turn.start + turn.wall }, tokens: { output: turn.tokens, reasoning: 0 }, cost: 0, finish: "stop" } });
	
}

emit("message.updated", { sessionID: "ses_1", info: { id: "msg_1800000", sessionID: "ses_1", role: "assistant", time: { created: 1800000, completed: 1977000 }, tokens: { output: 560, reasoning: 0 }, cost: 0, finish: "stop" } });
emit("message.updated", { sessionID: "ses_1", info: { id: "usr_1800000", sessionID: "ses_1", role: "user", time: { created: 1800000 } } });
emit("session.status", { sessionID: "ses_1", status: { type: "busy" } });

// NOTE 取默认对齐下的 value cell，直接断言内容
const valueNodes = foldRows.map((r) => r.props.children[1]);
console.log("busy 侧边栏 value cells:", valueNodes.map((n) => n.content).join(", "));

check("sidebar TOKEN 560", valueNodes[2].content, "560");
check("sidebar TOTAL_TK 27.45k", valueNodes[3].content, "27.45k");
check("sidebar STS Waiting...", valueNodes[8].content, "Waiting...");

// ===== ===== ===== ===== [区段六：标题行缓冲动画图标] ===== ===== ===== =====

console.log("--- 侧边栏：标题行缓冲动画图标 ---");

// STEP 复用上面已投递到 busy 的默认对齐实例，直接读它的标题行

const spinTitleBox = foldRoot.children[0];
const spinLeftBox = spinTitleBox.props.children[0];
const spinnerNode = spinTitleBox.props.children[1];

console.log("标题行属性:", JSON.stringify({ flexDirection: spinTitleBox.flexDirection, width: spinTitleBox.width, justifyContent: spinTitleBox.justifyContent }));

// SUBSTEP 标题行左右分区结构

check("标题行宽度 100%", spinTitleBox.width, "100%");
check("标题行 justifyContent space-between", spinTitleBox.justifyContent, "space-between");
check("标题行仍是两个分区", spinTitleBox.props.children.length, 2);
check("左区是 box", spinLeftBox.type, "box");
check("左区 flexDirection row", spinLeftBox.flexDirection, "row");
check("左区保持三个子节点", spinLeftBox.props.children.length, 3);
check("左区顺序为 箭头 / 标题 / 摘要", spinLeftBox.props.children.map((n) => n.content).join("|"), "▼|METRICS|");

// SUBSTEP 动画图标节点本身

check("右区是 text", spinnerNode.type, "text");
check("spinner 固定 2 列宽", spinnerNode.width, 2);
check("spinner flexShrink 0", spinnerNode.flexShrink, 0);
check("spinner 颜色回落 theme.text (无 accent)", spinnerNode.fg, "text");

// SUBSTEP busy 态：图标显示并有帧内容

check("busy 时 spinner 可见", spinnerNode.visible, true);
check("busy 时 spinner 有内容", spinnerNode.content !== "", true);
check("busy 时 spinner 内容在帧表内", SPINNER_FRAMES.includes(spinnerNode.content), true);

// STEP 逐帧推进：连续采样必须看到不同的帧，且每一帧都取自帧表

const seenFrames = new Set();
for (let i = 0; i < 6; i = i + 1) {
	seenFrames.add(spinnerNode.content);
	await new Promise((resolve) => setTimeout(resolve, 100));
}

console.log("采样到的帧:", [...seenFrames].join(" "));
check("动画逐帧推进 (采到多个不同帧)", seenFrames.size >= 2, true);
check("每个采样帧都在帧表内", [...seenFrames].every((f) => SPINNER_FRAMES.includes(f)), true);

// SUBSTEP 跳帧必须带动 requestRender，否则命令式写入不会真正画出来

const rendersBeforeSpin = renders;
await new Promise((resolve) => setTimeout(resolve, 250));
check("跳帧会请求重绘", renders > rendersBeforeSpin, true);

// STEP idle 后：图标隐藏并停止推进 (空闲门控)

emit("session.idle", { sessionID: "ses_1" });
check("idle 后 spinner 隐藏", spinnerNode.visible, false);

const idleFrame = spinnerNode.content;
await new Promise((resolve) => setTimeout(resolve, 300));
check("idle 后动画停止推进", spinnerNode.content, idleFrame);

// ===== ===== ===== ===== [结果汇总] ===== ===== ===== =====

// STEP 触发清理并输出失败总数

if (dispose) dispose();
console.log("");
console.log("共 " + failures + " 项失败");
process.exit(failures === 0 ? 0 : 1);
`;

// ===== ===== ===== ===== [内部方法] ===== ===== ===== =====

/**
 * 写入桩件与驱动：搭工作目录、现编入口产物、铺 @opentui/solid 桩件
 * @return {void} 无返回值
 * @author DeepSeek_V4_Flash
 * @date 2026-09-11
 * @note note
 */
function prepare(): void {
	// STEP 清空并搭建工作目录：node_modules 里铺 @opentui/solid 桩件
	
	rmSync(work, { recursive: true, force: true });
	mkdirSync(join(work, "node_modules", "@opentui", "solid"), { recursive: true });
	
	// SUBSTEP 现编入口产物：入口是原始 .tsx，这里压缩一份喂给桩件 (仅为测试，不写回仓库)
	
	const build = spawnSync(process.execPath, [
		"build", "tui.tsx", "--outfile", built, "--target", "bun", "--format", "esm", "--production",
		"--external", "solid-js", "--external", "@opentui/solid", "--external", "@opencode-ai/plugin",
	], { cwd: root, encoding: "utf8" });
	if (! (build.stdout === null)) process.stdout.write(build.stdout);
	if (build.status !== 0) {
		console.error("构建测试产物失败");
		process.exit(1);
		
	}
	
	// SUBSTEP 铺桩件与驱动文件：package.json + index.js + 两个 jsx-runtime 入口
	
	writeFileSync(join(work, "driver.mjs"), DRIVER);
	writeFileSync(join(work, "node_modules", "@opentui", "solid", "package.json"), '{"name":"@opentui/solid","version":"0.5.8","type":"module","exports":{".":{"default":"./index.js"},"./jsx-runtime":{"default":"./jsx-runtime.js"},"./jsx-dev-runtime":{"default":"./jsx-dev-runtime.js"}}}');
	writeFileSync(join(work, "node_modules", "@opentui", "solid", "index.js"), INDEX_STUB);
	writeFileSync(join(work, "node_modules", "@opentui", "solid", "jsx-runtime.js"), JSX_STUB);
	writeFileSync(join(work, "node_modules", "@opentui", "solid", "jsx-dev-runtime.js"), JSX_STUB);
	
}

// ===== ===== ===== ===== [逻辑代码] ===== ===== ===== =====

// STEP 校验入口文件存在，缺失即中止

if (! existsSync(source)) {
	console.error("缺少 tui.tsx");
	process.exit(1);
	
}

// STEP 铺设桩件与产物

prepare();

// STEP 执行驱动：直接用当前运行时 (bun) 跑，避免依赖 PATH 里的 bun 解析

const result = spawnSync(process.execPath, ["run", join(work, "driver.mjs")], {
	cwd: work,
	encoding: "utf8",
});

// STEP 透传输出并以驱动退出码收尾

if (! (result.stdout === null)) process.stdout.write(result.stdout);
if (! (result.stderr === null)) process.stderr.write(result.stderr);
process.exit(result.status === null ? 1 : result.status);
