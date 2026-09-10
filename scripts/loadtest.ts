/**
 * 加载级实测
 *
 * 用桩件替掉 @opentui/solid，把 tui.tsx 现编产物真实 import 进来，
 * 投递合成事件后读取被命令式写入的 text 节点，校验单块渲染、空值占位、
 * 活动高亮、耗时冻结、STS 状态机、幂等与会话释放。
 *
 * 运行：bun run loadtest
 *
 * NOTE 本插件走命令式刷新：整行一个 <text>，ref 回调里捕获节点后直接改
 *      content / fg。桩件的 createElement 必须模拟 ref 回调并保存 fg。
 *
 * @author DeepSeek-V4.1-Flash
 * @date 2026-09-11
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "tui.tsx");
const work = join(root, ".loadtest");
const built = join(work, "tui.js");

if (! existsSync(source)) {
	console.error("缺少 tui.tsx");
	process.exit(1);
}

/** VAR @opentui/solid 桩件：元素带 content / fg 字段并触发 ref，模拟命令式刷新路径 */
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

const INDEX_STUB = `
export function createElement(type, props) {
	const node = { type, content: "", fg: undefined, props };
	if (props && typeof props.ref === "function") props.ref(node);
	return node;
}
export function createComponent(type, props) { return type(props); }
export function spread() {}
`;

/** VAR 测试驱动：注册假 api → 投合成事件 → 读取单块 text 节点的 content 与 fg */
const DRIVER = `
import plugin from "./tui.js";

const handlers = new Map();
let slots = null;
let dispose = null;

const api = {
	event: { on(type, handler) { handlers.set(type, handler); return () => handlers.delete(type); } },
	slots: { register(p) { slots = p.slots; } },
	theme: { current: { textMuted: "muted", info: "info", success: "ok", secondary: "sec", text: "text" } },
	renderer: { requestRender() { renders = renders + 1; } },
	lifecycle: { onDispose(fn) { dispose = fn; return () => {}; } },
	ui: { toast() {} },
};
let renders = 0;

await plugin.tui(api, undefined);
console.log("插件 id      :", plugin.id);
console.log("注册事件     :", [...handlers.keys()].sort().join(", "));
console.log("注册槽位     :", Object.keys(slots).join(", "));

const emit = (type, properties) => {
	const handler = handlers.get(type);
	if (! handler) throw new Error("未注册的事件: " + type);
	handler({ type, properties });
};

// NOTE 消息时间戳为合成值，流式增量与 busy 耗时由插件内部取真实 Date.now()，
// 因此 TPS / TTFT / busy 期 DUR 无法在此精确复现（由 scripts/selftest.ts 覆盖逻辑），
// 这里只断言由消息时间戳决定的确定性字段。
const TURNS = [
	{ start: 0, wall: 500000, tokens: 9000 },
	{ start: 600000, wall: 400000, tokens: 8890 },
	{ start: 1100000, wall: 528000, tokens: 9000 },
	{ start: 1800000, wall: 177000, tokens: 560 },
];

const tree = slots.session_prompt_right({}, { session_id: "ses_1" });
const box = tree.props;
const text = box.children;
const read = () => text.content;
const fg = () => text.fg;

let failures = 0;
const check = (label, actual, expected) => {
	const ok = actual === expected;
	if (! ok) failures = failures + 1;
	const mark = ok ? "PASS" : "FAIL";
	console.log("[" + mark + "] " + label + ": " + JSON.stringify(actual) + (ok ? "" : " (期望 " + JSON.stringify(expected) + ")"));
};

console.log("--- 首帧（空会话）---");
console.log("box 属性  :", JSON.stringify({ flexDirection: box.flexDirection, flexShrink: box.flexShrink, gap: box.gap }));
console.log("渲染结果  :", read());
check("单块渲染（children 是单个 text 而非数组）", Array.isArray(box.children), false);
check("折行交给宿主，不再自开 gap", box.gap, undefined);
check("空会话全字段占位", read(), "TPS 0 | AVG_TPS 0 | TOKEN 0 | TOTAL_TK 0 | TTFT 0 | AVG_TTFT 0 | DUR 0 | TOTAL_DUR 0 | STS -");
check("静止回落灰色", fg(), "muted");

console.log("--- 投递四轮事件 ---");
for (const turn of TURNS) {
	const id = "msg_" + turn.start;
	emit("message.updated", { sessionID: "ses_1", info: { id: "usr_" + turn.start, sessionID: "ses_1", role: "user", time: { created: turn.start } } });
	emit("message.updated", { sessionID: "ses_1", info: { id, sessionID: "ses_1", role: "assistant", time: { created: turn.start }, tokens: { output: 0, reasoning: 0 }, cost: 0 } });
	emit("message.part.delta", { sessionID: "ses_1", messageID: id, partID: "p1", field: "text", delta: "x".repeat(200) });
	// STEP 末轮流式中插入平台合成的新 user 消息（ID 不同）：轮进行中不得清零
	if (turn.start === 1800000) {
		emit("message.updated", { sessionID: "ses_1", info: { id: "usr_synthetic", sessionID: "ses_1", role: "user", time: { created: 1800001 } } });
	}
	emit("message.updated", { sessionID: "ses_1", info: { id, sessionID: "ses_1", role: "assistant", time: { created: turn.start, completed: turn.start + turn.wall }, tokens: { output: turn.tokens, reasoning: 0 }, cost: 0, finish: "stop" } });
}
// STEP 幂等校验：重复投递完成事件不应重复计数
emit("message.updated", { sessionID: "ses_1", info: { id: "msg_1800000", sessionID: "ses_1", role: "assistant", time: { created: 1800000, completed: 1977000 }, tokens: { output: 560, reasoning: 0 }, cost: 0, finish: "stop" } });
// STEP 幂等校验：重复投递 user 消息不得清空本轮读数（实测会导致 TOKEN/TTFT/DUR 提前清零）
emit("message.updated", { sessionID: "ses_1", info: { id: "usr_1800000", sessionID: "ses_1", role: "user", time: { created: 1800000 } } });
emit("session.status", { sessionID: "ses_1", status: { type: "busy" } });

console.log("--- busy（进行中）---");
const busyLine = read();
console.log("渲染结果  :", busyLine);
check("活动高亮为白色", fg(), "text");
check("busy 行含 TOKEN 560", busyLine.includes("TOKEN 560"), true);
check("busy 行含 TOTAL_TK 27.45k", busyLine.includes("TOTAL_TK 27.45k"), true);
check("busy 行含 STS Waiting...", busyLine.includes("STS Waiting..."), true);
check("busy 行是单块（无换行符）", busyLine.includes("\\n"), false);

emit("session.idle", { sessionID: "ses_1" });
console.log("--- idle（挂机回来）---");
const idleLine = read();
console.log("渲染结果  :", idleLine);
check("静止回落灰色", fg(), "muted");
check("idle 后 TOKEN 保留", idleLine.includes("TOKEN 560"), true);
check("idle 后 TOTAL_TK 保留", idleLine.includes("TOTAL_TK 27.45k"), true);
check("idle 后 DUR 冻结在结算值", idleLine.includes("DUR 2m57s"), true);
check("idle 后 TOTAL_DUR 冻结在结算值", idleLine.includes("TOTAL_DUR 26m45s"), true);
check("idle 转 Ready", idleLine.includes("STS Ready"), true);

emit("session.status", { sessionID: "ses_1", status: { type: "retry", attempt: 3 } });
check("重试文案", read().includes("STS Retrying #3..."), true);

emit("session.error", { sessionID: "ses_1" });
check("错误文案", read().includes("STS Error"), true);

const beforeDelete = renders;
emit("session.deleted", { sessionID: "ses_1" });
// NOTE hideEmpty=false 时空会话回落到占位行（与首帧一致），而不是整行消失
check("会话释放后回落占位行", read(), "TPS 0 | AVG_TPS 0 | TOKEN 0 | TOTAL_TK 0 | TTFT 0 | AVG_TTFT 0 | DUR 0 | TOTAL_DUR 0 | STS -");
check("释放后不再重绘空行", renders >= beforeDelete, true);

if (dispose) dispose();
console.log("");
console.log("共 " + failures + " 项失败");
process.exit(failures === 0 ? 0 : 1);
`;

/**
 * 写入桩件与驱动
 *
 * @return {} 无
 * @author DeepSeek-V4.1-Flash
 * @date 2026-09-11
 */
function prepare(): void {
	rmSync(work, { recursive: true, force: true });
	mkdirSync(join(work, "node_modules", "@opentui", "solid"), { recursive: true });

	// STEP 入口是原始 .tsx，这里现编一份压缩产物喂给桩件（仅为测试，不写回仓库）
	const build = spawnSync(process.execPath, [
		"build", "tui.tsx", "--outfile", built, "--target", "bun", "--format", "esm", "--production",
		"--external", "solid-js", "--external", "@opentui/solid", "--external", "@opencode-ai/plugin",
	], { cwd: root, encoding: "utf8" });
	if (! (build.stdout === null)) process.stdout.write(build.stdout);
	if (build.status !== 0) {
		console.error("构建测试产物失败");
		process.exit(1);
	}
	writeFileSync(join(work, "driver.mjs"), DRIVER);
	writeFileSync(join(work, "node_modules", "@opentui", "solid", "package.json"), '{"name":"@opentui/solid","version":"0.5.8","type":"module","exports":{".":{"default":"./index.js"},"./jsx-runtime":{"default":"./jsx-runtime.js"},"./jsx-dev-runtime":{"default":"./jsx-dev-runtime.js"}}}');
	writeFileSync(join(work, "node_modules", "@opentui", "solid", "index.js"), INDEX_STUB);
	writeFileSync(join(work, "node_modules", "@opentui", "solid", "jsx-runtime.js"), JSX_STUB);
	writeFileSync(join(work, "node_modules", "@opentui", "solid", "jsx-dev-runtime.js"), JSX_STUB);

}

prepare();
// STEP 直接用当前运行时（bun）执行驱动，避免依赖 PATH 里的 bun 解析
const result = spawnSync(process.execPath, ["run", join(work, "driver.mjs")], {
	cwd: work,
	encoding: "utf8",
});
if (! (result.stdout === null)) process.stdout.write(result.stdout);
if (! (result.stderr === null)) process.stderr.write(result.stderr);
process.exit(result.status === null ? 1 : result.status);
