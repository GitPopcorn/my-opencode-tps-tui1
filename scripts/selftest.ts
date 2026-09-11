/**
 * 自检：验证格式化分档、耗时冻结口径与整行渲染结果
 * </br>运行：bun run scripts/selftest.ts
 * @author DeepSeek_V4_Flash
 * @date 2026-09-11
 * @note note
 */

import { formatCount, formatDuration, formatRate } from "../src/format.js";
import { resolveConfig } from "../src/config.js";
import {
	buildReadout,
	freshState,
	noteAssistantFinished,
	noteAssistantStarted,
	noteIdle,
	noteStatus,
	noteTextDelta,
	noteUserMessage,
} from "../src/metrics.js";
import { buildLine, displayValue, fieldValue } from "../src/render.js";

// ===== ===== ===== ===== [常量] ===== ===== ===== =====

/** CONST 断言失败计数，最终以此决定退出码 */
let failures = 0;

// ===== ===== ===== ===== [测试辅助方法] ===== ===== ===== =====

/**
 * 单条断言：实际值与期望值严格相等才算通过
 * @param {string} label 断言说明，输出在行首便于定位
 * @param {unknown} actual 实际值
 * @param {unknown} expected 期望值
 * @return {void} 无返回值，失败时累加 failures
 * @author DeepSeek_V4_Flash
 * @date 2026-09-11
 * @note 实际值与期望值均以 JSON 序列化输出，便于肉眼比对
 */
function check(label: string, actual: unknown, expected: unknown): void {
	// STEP 判定并计数
	const ok = actual === expected;
	if (! ok) failures = failures + 1;
	
	// STEP 输出断言结果行
	const mark = ok ? "PASS " : "FAIL ";
	console.log(`[${mark}] ${label}: ${JSON.stringify(actual)}${ok ? "" : ` (期望 ${JSON.stringify(expected)})`}`);
	
}

// ===== ===== ===== ===== [区段一：格式化函数自检] ===== ===== ===== =====

// STEP 计数缩写：整数量级、k/m/b 量级与无数据占位

console.log("== 计数缩写 ==");
check("560", formatCount(560), "560");
check("999", formatCount(999), "999");
check("27450", formatCount(27450), "27.45k");
check("1234567", formatCount(1234567), "1.2346m");
check("2500000000", formatCount(2500000000), "2.5b");
check("undefined", formatCount(undefined), "-");

// STEP 时长分档：ms / s / m+s / h+m+s 四种模式与精度钳制

console.log("== 时长分档 ==");
check("850ms", formatDuration(850), "850ms");
check("8.5s", formatDuration(8500), "8.50s");
check("2m57s", formatDuration(177000), "2m57s");
check("26m45s", formatDuration(1605000), "26m45s");
check("1h1m1s", formatDuration(3661000), "1h1m1s");
check("1 位小数", formatDuration(8500, 1), "8.5s");
check("0 位小数取整秒", formatDuration(8500, 0), "9s");

// STEP 速率分档：按数量级取 0/1/2 位小数

console.log("== 速率分档 ==");
check("60.3", formatRate(60.3), "60.3");
check("104", formatRate(104), "104");
check("9.5", formatRate(9.5), "9.50");

// ===== ===== ===== ===== [区段二：事件流模拟与读数校验] ===== ===== ===== =====

// STEP 构造四轮合成事件的时间表

console.log("== 事件流模拟 ==");
/** CONST 合成事件轮次表：每轮给出起点偏移、TTFT、wall 耗时、输出词元 */
const TURNS: Array<{ start: number; ttft: number; wall: number; tokens: number }> = [
	{ start: 0, ttft: 10000, wall: 500000, tokens: 9000 },
	{ start: 600000, ttft: 9500, wall: 400000, tokens: 8890 },
	{ start: 1100000, ttft: 10000, wall: 528000, tokens: 9000 },
	{ start: 1800000, ttft: 8500, wall: 177000, tokens: 560 },
];
// NOTE 四轮合计 TTFT 均值 9.5s、词元 27450、wall 1605000ms (26m45s)，末轮 560 词元 / 177000ms

/** CONST 指标状态容器，承载全部合成事件的结果 */
const state = freshState();
/** CONST 固定会话 ID，全部事件都投到这个会话上 */
const session = "ses_selftest";

// SUBSTEP 逐轮回放事件：user 锚定 → assistant 开始 → 首增量锚定 TTFT → 完成

for (const turn of TURNS) {
	const messageID = `msg_${turn.start}`;
	noteUserMessage(state, session, turn.start, `usr_${turn.start}`);
	noteAssistantStarted(state, session, session && messageID, turn.start);
	// PART 首条增量落在 start+ttft，即 TTFT 锚点 (按 5 字节/词元喂数据)
	noteTextDelta(state, session, messageID, turn.start + turn.ttft, turn.tokens * 5);
	noteAssistantFinished(state, session, messageID, {
		completedAt: turn.start + turn.wall,
		outputTokens: turn.tokens,
		reasoningTokens: 0,
		finish: "stop",
		errored: false,
	});
	
}

// STEP 末轮结束进入 busy：耗时走实时口径，按当前时间逐秒增长

noteStatus(state, session, { type: "busy" });

/** CONST 解析后的默认配置，后续全部断言共用 */
const config = resolveConfig(undefined);
/** CONST busy 断言的观测时刻：末轮起点 + wall + 额外 60s，用于验证逐秒增长 */
const BUSY_NOW = 1800000 + 177000 + 60000;
const busyReadout = buildReadout(state, session, BUSY_NOW, config);

// SUBSTEP busy 期断言：耗时增长、状态与活动高亮

console.log("--- busy (进行中) ---");
check("busy 时 DUR 逐秒增长", fieldValue("DUR", busyReadout, config), "3m57s");
check("busy 时 TOTAL_DUR 逐秒增长", fieldValue("TOTAL_DUR", busyReadout, config), "27m45s");
check("busy 时 STS Waiting...", fieldValue("STS", busyReadout, config), "Waiting...");
check("busy 即活动", busyReadout.active, true);

// STEP idle 后耗时冻结在结算值，累计读数全部保留

noteIdle(state, session);
const readout = buildReadout(state, session, BUSY_NOW + 600000, config);

// SUBSTEP idle 断言：挂机回来读到完整摘要而非占位符

console.log("--- idle (挂机回来) ---");
check("idle 后 DUR 冻结在结算值", fieldValue("DUR", readout, config), "2m57s");
check("idle 后 TOTAL_DUR 冻结在结算值", fieldValue("TOTAL_DUR", readout, config), "26m45s");
check("idle 后 TOKEN 保留", fieldValue("TOKEN", readout, config), "560");
check("idle 后 TOTAL_TK 保留", fieldValue("TOTAL_TK", readout, config), "27.45k");
check("idle 后 TTFT 保留", fieldValue("TTFT", readout, config), "9s");
check("idle 后 AVG_TTFT 保留", fieldValue("AVG_TTFT", readout, config), "10s");
check("idle 后 STS Ready", fieldValue("STS", readout, config), "Ready");
check("idle 即静止", readout.active, false);
check("TPS 回落本轮均值", fieldValue("TPS", readout, config), "3.32");

// SUBSTEP 整行渲染断言：全部字段拼成单块文本

console.log("--- 整行 (单块文本) ---");
const line = buildLine(readout, config);
console.log(line);
check(
	"整行内容",
	line,
	"TPS 3.32 | AVG_TPS 17.5 | TOKEN 560 | TOTAL_TK 27.45k | TTFT 9s | AVG_TTFT 10s | DUR 2m57s | TOTAL_DUR 26m45s | STS Ready",
);

// ===== ===== ===== ===== [区段三：空值占位与配置行为] ===== ===== ===== =====

// STEP 空会话读数：占位文本撑住结构，hideEmpty 开启时整段隐藏

console.log("== 空值占位 ==");
const emptyReadout = buildReadout(freshState(), "ses_none", 0, config);
check(
	"空会话全字段占位 (hideEmpty 默认关)",
	buildLine(emptyReadout, config),
	"TPS 0 | AVG_TPS 0 | TOKEN 0 | TOTAL_TK 0 | TTFT 0 | AVG_TTFT 0 | DUR 0 | TOTAL_DUR 0 | STS -",
);
check("hideEmpty 开启时空段隐藏", buildLine(emptyReadout, resolveConfig({ hideEmpty: true })), "STS -");
check("emptyText 可覆盖", buildLine(emptyReadout, resolveConfig({ emptyText: "1" })).includes("TTFT 1"), true);
check("displayValue 占位替换", displayValue("TPS", "-", config), "0");
check("displayValue 原样透传", displayValue("TPS", "560", config), "560");
check("displayValue 不动 STS 文案", displayValue("STS", "-", config), "-");

// STEP 配置归一化：去重、未知字段、回落、钳制与开关默认值

console.log("== 配置行为 ==");
check("去重与未知字段", resolveConfig({ items: ["TPS", "TPS", "NOPE", "STS"] }).items.join(","), "TPS,STS");
check("空数组回落全展示", resolveConfig({ items: [] }).items.length, 9);
check("STS 文案覆盖", resolveConfig({ sts: { waiting: "排队中..." } }).sts.waiting, "排队中...");
check("scope=message 生效", resolveConfig({ scope: "message" }).scope, "message");
check("刷新档位解析", JSON.stringify(resolveConfig({ refreshCountMs: 3000 }).refresh), '{"live":500,"count":3000,"clock":1000}');
check("刷新间隔下限钳制", resolveConfig({ refreshLiveMs: 10 }).refresh.live, 100);
check("刷新间隔上限钳制", resolveConfig({ refreshClockMs: 999999 }).refresh.clock, 60000);
check("hideEmpty 默认关", resolveConfig(undefined).hideEmpty, false);
check("colorize 默认开", resolveConfig(undefined).colorize, true);
check("colorize 可关闭", resolveConfig({ colorize: false }).colorize, false);
check("旧字段名 CST 已移除", resolveConfig({ items: ["CST"] }).items.length, 9);

// STEP labels 显示名：覆盖生效、未知键忽略、空串与非对象回落默认、整行前缀替换

console.log("== labels 显示名 ==");
check("labels 未配置时默认为字段名", resolveConfig(undefined).labels.TOKEN, "TOKEN");
check("labels 合法覆盖生效", resolveConfig({ labels: { TOKEN: "✪" } }).labels.TOKEN, "✪");
check("labels 未提及的字段保留默认", resolveConfig({ labels: { TOKEN: "词" } }).labels.TPS, "TPS");
check("labels 未知键被忽略", resolveConfig({ labels: { NOPE: "x" } }).labels.TPS, "TPS");
check("labels 空串回落默认", resolveConfig({ labels: { TOKEN: "" } }).labels.TOKEN, "TOKEN");
check("labels 非字符串回落默认", resolveConfig({ labels: { TOKEN: 123 } }).labels.TOKEN, "TOKEN");
check("labels 非对象回落默认", resolveConfig({ labels: "x" }).labels.DUR, "DUR");
/** CONST 配了自定义显示名的配置：英文缩写、符号、Emoji 各覆盖一项 */
const labeled = resolveConfig({ labels: { TPS: "✦", AVG_TPS: "AVG", DUR: "⏱️" } });
/** CONST 配置显示名后的整行文本 */
const labeledLine = buildLine(readout, labeled);
check("整行前缀使用自定义显示名", labeledLine.startsWith("✦ 3.32 | AVG 17.5"), true);
check("Emoji 前缀生效", labeledLine.includes("⏱️ 2m57s"), true);
check("未覆盖字段仍用字段名", labeledLine.includes("TOKEN 560"), true);
check("labels 不影响 hideEmpty 行为", buildLine(emptyReadout, resolveConfig({ hideEmpty: true, labels: { STS: "态" } })), "态 -");

// ===== ===== ===== ===== [区段四：轮次裁决与幂等] ===== ===== ===== =====

// STEP 轮进行中收到任何 user 消息都不得清轮

console.log("== 轮进行中收到任何 user 消息都不得清轮 ==");
// NOTE OpenCode 会发重复投递、也会发平台合成的"新"user 消息 (ID 不同)，
// 把清轮寄托在 user 事件上会导致流式中的 TOKEN 出现 350 -> 0 -> 100 -> 0 的锯齿

/** CONST 轮进行中场景的独立状态容器 */
const mid = freshState();
noteUserMessage(mid, "ses_t", 0, "usr_a");
noteAssistantStarted(mid, "ses_t", "msg_a", 0);
noteTextDelta(mid, "ses_t", "msg_a", 100, 2500);
const midBefore = buildReadout(mid, "ses_t", 500, config);
check("流式中 TOKEN 估算", fieldValue("TOKEN", midBefore, config), "500");

// SUBSTEP 注入两条全新的 user 消息 (合成消息 / 换皮重发)，断言读数不被清零

noteUserMessage(mid, "ses_t", 200, "usr_b");
noteUserMessage(mid, "ses_t", 300, "usr_c");
const midAfter = buildReadout(mid, "ses_t", 700, config);
check("轮进行中 user 消息不清零 TOKEN", fieldValue("TOKEN", midAfter, config), "500");
check("轮进行中 user 消息不影响 TTFT", fieldValue("TTFT", midAfter, config), "100ms");

// SUBSTEP 工具续跑 (finish=tool-calls) 后的下一条消息不开启新轮

noteAssistantFinished(mid, "ses_t", "msg_a", { completedAt: 800, outputTokens: 450, reasoningTokens: 0, finish: "tool-calls", errored: false });
noteAssistantStarted(mid, "ses_t", "msg_b", 900);
const continued = buildReadout(mid, "ses_t", 1000, config);
check("工具续跑不拆轮 (TOKEN 累计保留)", fieldValue("TOKEN", continued, config), "450");
check("工具续跑不拆轮 (TOTAL_TK 不重复结算)", fieldValue("TOTAL_TK", continued, config), "450");

// STEP 幂等与清零时机：重复投递不清零，真正的新一轮才重置单会话字段

console.log("== 幂等与清零时机 ==");
// SUBSTEP 重复投递同一条 user 消息 (实测 OpenCode 会重复发 updated) 不得清空本轮读数

// STEP 重复投递同一条 user 消息 (实测 OpenCode 会重复发 updated) 不得清空本轮读数
noteUserMessage(state, session, BUSY_NOW + 500000, "usr_1800000");
const afterDup = buildReadout(state, session, BUSY_NOW + 500000, config);
check("重复 user 事件不清零 TOKEN", fieldValue("TOKEN", afterDup, config), "560");
check("重复 user 事件不清零 DUR", fieldValue("DUR", afterDup, config), "2m57s");
check("重复 user 事件不清零 TOTAL_TK", fieldValue("TOTAL_TK", afterDup, config), "27.45k");

// SUBSTEP 真正的新一轮开始才重置单会话字段，累计值保留

noteUserMessage(state, session, BUSY_NOW + 600000, "usr_next");
const nextTurn = buildReadout(state, session, BUSY_NOW + 600000, config);
check("新 user 消息清零 TOKEN", displayValue("TOKEN", fieldValue("TOKEN", nextTurn, config), config), "0");
check("新 user 消息清零 TTFT", displayValue("TTFT", fieldValue("TTFT", nextTurn, config), config), "0");
check("新 user 消息清零 DUR", displayValue("DUR", fieldValue("DUR", nextTurn, config), config), "0");
check("新 user 消息保留 TOTAL_TK", fieldValue("TOTAL_TK", nextTurn, config), "27.45k");

// STEP 流式中的 TOKEN 实时估算：按字节估算单调增长，完成后权威值接管

console.log("== 流式中的 TOKEN 实时估算 ==");
/** CONST 流式估算场景的独立状态容器 */
const live = freshState();
noteUserMessage(live, "ses_live", 0, "usr_0");
noteAssistantStarted(live, "ses_live", "msg_0", 0);
noteTextDelta(live, "ses_live", "msg_0", 100, 2000);
const streamingReadout = buildReadout(live, "ses_live", 500, config);
check("流式中 TOKEN 按字节估算", fieldValue("TOKEN", streamingReadout, config), "400");

// SUBSTEP 追加增量后估算随之增长

noteTextDelta(live, "ses_live", "msg_0", 300, 500);
const streamingGrow = buildReadout(live, "ses_live", 700, config);
check("估算随流式增长", fieldValue("TOKEN", streamingGrow, config), "500");

// SUBSTEP 完成后权威值接管，不被估算峰值顶住

noteAssistantFinished(live, "ses_live", "msg_0", {
	completedAt: 900,
	outputTokens: 380,
	reasoningTokens: 0,
	finish: "stop",
	errored: false,
});
const settledReadout = buildReadout(live, "ses_live", 1000, config);
check("完成后权威值接管 (不被估算峰值顶住)", fieldValue("TOKEN", settledReadout, config), "380");

// ===== ===== ===== ===== [结果汇总] ===== ===== ===== =====

// STEP 输出失败总数并以退出码报告

console.log(`\n共 ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
