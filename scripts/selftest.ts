/**
 * 自检：验证格式化分档、耗时冻结口径与整行渲染结果
 *
 * 运行：bun run scripts/selftest.ts
 *
 * @author DeepSeek-V4.1-Flash
 * @date 2026-09-11
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

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
	const ok = actual === expected;
	if (! ok) failures = failures + 1;
	const mark = ok ? "PASS" : "FAIL";
	console.log(`[${mark}] ${label}: ${JSON.stringify(actual)}${ok ? "" : ` (期望 ${JSON.stringify(expected)})`}`);

}

console.log("== 计数缩写 ==");
check("560", formatCount(560), "560");
check("999", formatCount(999), "999");
check("27450", formatCount(27450), "27.45k");
check("1234567", formatCount(1234567), "1.2346m");
check("2500000000", formatCount(2500000000), "2.5b");
check("undefined", formatCount(undefined), "-");

console.log("== 时长分档 ==");
check("850ms", formatDuration(850), "850ms");
check("8.5s", formatDuration(8500), "8.50s");
check("2m57s", formatDuration(177000), "2m57s");
check("26m45s", formatDuration(1605000), "26m45s");
check("1h1m1s", formatDuration(3661000), "1h1m1s");
check("1 位小数", formatDuration(8500, 1), "8.5s");
check("0 位小数取整秒", formatDuration(8500, 0), "9s");

console.log("== 速率分档 ==");
check("60.3", formatRate(60.3), "60.3");
check("104", formatRate(104), "104");
check("9.5", formatRate(9.5), "9.50");

console.log("== 事件流模拟 ==");
// VAR 每轮：起点偏移、TTFT、wall 耗时、输出词元
// NOTE 四轮合计 TTFT 均值 9.5s、词元 27450、wall 1605000ms（26m45s），末轮 560 词元 / 177000ms
const TURNS: Array<{ start: number; ttft: number; wall: number; tokens: number }> = [
	{ start: 0, ttft: 10000, wall: 500000, tokens: 9000 },
	{ start: 600000, ttft: 9500, wall: 400000, tokens: 8890 },
	{ start: 1100000, ttft: 10000, wall: 528000, tokens: 9000 },
	{ start: 1800000, ttft: 8500, wall: 177000, tokens: 560 },
];

const state = freshState();
const session = "ses_selftest";
for (const turn of TURNS) {
	const messageID = `msg_${turn.start}`;
	noteUserMessage(state, session, turn.start, `usr_${turn.start}`);
	noteAssistantStarted(state, session, messageID, turn.start);
	// STEP 首条增量落在 start+ttft，即 TTFT 锚点（按 5 字节/词元喂数据）
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

const config = resolveConfig(undefined);
const BUSY_NOW = 1800000 + 177000 + 60000;
const busyReadout = buildReadout(state, session, BUSY_NOW, config);

console.log("--- busy（进行中）---");
check("busy 时 DUR 逐秒增长", fieldValue("DUR", busyReadout, config), "3m57s");
check("busy 时 TOTAL_DUR 逐秒增长", fieldValue("TOTAL_DUR", busyReadout, config), "27m45s");
check("busy 时 STS Waiting...", fieldValue("STS", busyReadout, config), "Waiting...");
check("busy 即活动", busyReadout.active, true);

// STEP idle 后耗时冻结在结算值，累计读数全部保留
noteIdle(state, session);
const readout = buildReadout(state, session, BUSY_NOW + 600000, config);

console.log("--- idle（挂机回来）---");
check("idle 后 DUR 冻结在结算值", fieldValue("DUR", readout, config), "2m57s");
check("idle 后 TOTAL_DUR 冻结在结算值", fieldValue("TOTAL_DUR", readout, config), "26m45s");
check("idle 后 TOKEN 保留", fieldValue("TOKEN", readout, config), "560");
check("idle 后 TOTAL_TK 保留", fieldValue("TOTAL_TK", readout, config), "27.45k");
check("idle 后 TTFT 保留", fieldValue("TTFT", readout, config), "9s");
check("idle 后 AVG_TTFT 保留", fieldValue("AVG_TTFT", readout, config), "10s");
check("idle 后 STS Ready", fieldValue("STS", readout, config), "Ready");
check("idle 即静止", readout.active, false);
check("TPS 回落本轮均值", fieldValue("TPS", readout, config), "3.32");

console.log("--- 整行（单块文本）---");
const line = buildLine(readout, config);
console.log(line);
check(
	"整行内容",
	line,
	"TPS 3.32 | AVG_TPS 17.5 | TOKEN 560 | TOTAL_TK 27.45k | TTFT 9s | AVG_TTFT 10s | DUR 2m57s | TOTAL_DUR 26m45s | STS Ready",
);

console.log("== 空值占位 ==");
const emptyReadout = buildReadout(freshState(), "ses_none", 0, config);
check(
	"空会话全字段占位（hideEmpty 默认关）",
	buildLine(emptyReadout, config),
	"TPS 0 | AVG_TPS 0 | TOKEN 0 | TOTAL_TK 0 | TTFT 0 | AVG_TTFT 0 | DUR 0 | TOTAL_DUR 0 | STS -",
);
check("hideEmpty 开启时空段隐藏", buildLine(emptyReadout, resolveConfig({ hideEmpty: true })), "STS -");
check("emptyText 可覆盖", buildLine(emptyReadout, resolveConfig({ emptyText: "1" })).includes("TTFT 1"), true);
check("displayValue 占位替换", displayValue("TPS", "-", config), "0");
check("displayValue 原样透传", displayValue("TPS", "560", config), "560");
check("displayValue 不动 STS 文案", displayValue("STS", "-", config), "-");

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

console.log("== 轮进行中收到任何 user 消息都不得清轮 ==");
// NOTE OpenCode 会发重复投递、也会发平台合成的"新"user 消息（ID 不同），
// 把清轮寄托在 user 事件上会导致流式中的 TOKEN 出现 350 -> 0 -> 100 -> 0 的锯齿
const mid = freshState();
noteUserMessage(mid, "ses_t", 0, "usr_a");
noteAssistantStarted(mid, "ses_t", "msg_a", 0);
noteTextDelta(mid, "ses_t", "msg_a", 100, 2500);
const midBefore = buildReadout(mid, "ses_t", 500, config);
check("流式中 TOKEN 估算", fieldValue("TOKEN", midBefore, config), "500");
// 对话进行中到达一条全新的 user 消息（合成消息 / 换皮重发）
noteUserMessage(mid, "ses_t", 200, "usr_b");
noteUserMessage(mid, "ses_t", 300, "usr_c");
const midAfter = buildReadout(mid, "ses_t", 700, config);
check("轮进行中 user 消息不清零 TOKEN", fieldValue("TOKEN", midAfter, config), "500");
check("轮进行中 user 消息不影响 TTFT", fieldValue("TTFT", midAfter, config), "100ms");
// 工具续跑（finish=tool-calls）后的下一条消息不开启新轮
noteAssistantFinished(mid, "ses_t", "msg_a", { completedAt: 800, outputTokens: 450, reasoningTokens: 0, finish: "tool-calls", errored: false });
noteAssistantStarted(mid, "ses_t", "msg_b", 900);
const continued = buildReadout(mid, "ses_t", 1000, config);
check("工具续跑不拆轮（TOKEN 累计保留）", fieldValue("TOKEN", continued, config), "450");
check("工具续跑不拆轮（TOTAL_TK 不重复结算）", fieldValue("TOTAL_TK", continued, config), "450");

console.log("== 幂等与清零时机 ==");
// STEP 重复投递同一条 user 消息（实测 OpenCode 会重复发 updated）不得清空本轮读数
noteUserMessage(state, session, BUSY_NOW + 500000, "usr_1800000");
const afterDup = buildReadout(state, session, BUSY_NOW + 500000, config);
check("重复 user 事件不清零 TOKEN", fieldValue("TOKEN", afterDup, config), "560");
check("重复 user 事件不清零 DUR", fieldValue("DUR", afterDup, config), "2m57s");
check("重复 user 事件不清零 TOTAL_TK", fieldValue("TOTAL_TK", afterDup, config), "27.45k");
// STEP 真正的新一轮开始才重置单会话字段
noteUserMessage(state, session, BUSY_NOW + 600000, "usr_next");
const nextTurn = buildReadout(state, session, BUSY_NOW + 600000, config);
check("新 user 消息清零 TOKEN", displayValue("TOKEN", fieldValue("TOKEN", nextTurn, config), config), "0");
check("新 user 消息清零 TTFT", displayValue("TTFT", fieldValue("TTFT", nextTurn, config), config), "0");
check("新 user 消息清零 DUR", displayValue("DUR", fieldValue("DUR", nextTurn, config), config), "0");
check("新 user 消息保留 TOTAL_TK", fieldValue("TOTAL_TK", nextTurn, config), "27.45k");

console.log("== 流式中的 TOKEN 实时估算 ==");
const live = freshState();
noteUserMessage(live, "ses_live", 0, "usr_0");
noteAssistantStarted(live, "ses_live", "msg_0", 0);
noteTextDelta(live, "ses_live", "msg_0", 100, 2000);
const streamingReadout = buildReadout(live, "ses_live", 500, config);
check("流式中 TOKEN 按字节估算", fieldValue("TOKEN", streamingReadout, config), "400");
noteTextDelta(live, "ses_live", "msg_0", 300, 500);
const streamingGrow = buildReadout(live, "ses_live", 700, config);
check("估算随流式增长", fieldValue("TOKEN", streamingGrow, config), "500");
noteAssistantFinished(live, "ses_live", "msg_0", {
	completedAt: 900,
	outputTokens: 380,
	reasoningTokens: 0,
	finish: "stop",
	errored: false,
});
const settledReadout = buildReadout(live, "ses_live", 1000, config);
check("完成后权威值接管（不被估算峰值顶住）", fieldValue("TOKEN", settledReadout, config), "380");

console.log(`\n共 ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
