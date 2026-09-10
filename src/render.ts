/**
 * 读数 → 单块文本行
 *
 * 整行只有一个 <text> 节点：全部字段拼进同一个字符串，间距由文本自身的
 * 空格决定，不再受 flex gap 影响，拖拽选中时也是完整一块。
 *
 * @author DeepSeek-V4.1-Flash
 * @date 2026-09-11
 */

import { EMPTY, formatCount, formatDuration, formatRate } from "./format.js";
import type { FieldName, ResolvedConfig } from "./config.js";
import type { Readout } from "./metrics.js";

export type FieldEntry = {
	field: FieldName;
	value: string;
};

/**
 * 取单个字段的展示值
 *
 * 保留 EMPTY 语义，占位替换交给 composeLine，这样 hideEmpty 仍能识别「无数据」。
 *
 * @param {} field 字段名
 * @param {} readout 读数
 * @param {} config 配置
 * @return {} 该字段的展示值，无数据为占位符
 * @author DeepSeek-V4.1-Flash
 * @date 2026-09-11
 */
export function fieldValue(field: FieldName, readout: Readout, config: ResolvedConfig): string {
	// BRANCH 逐字段取值，标签一律大写，与字段名一致
	switch (field) {
		case "TPS":
			return formatRate(readout.tps);
		case "AVG_TPS":
			return formatRate(readout.avgTps);
		case "TOKEN":
			return formatCount(readout.tokens, config.countPrecision);
		case "TOTAL_TK":
			return formatCount(readout.totalTokens, config.countPrecision);
		case "TTFT":
			return formatDuration(readout.ttftMs, config.secondPrecision);
		case "AVG_TTFT":
			return formatDuration(readout.avgTtftMs, config.secondPrecision);
		case "DUR":
			return formatDuration(readout.durMs, config.secondPrecision);
		case "TOTAL_DUR":
			return formatDuration(readout.totalDurMs, config.secondPrecision);
		case "STS":
			return readout.status;
		default:
			return EMPTY;
	}

}

/**
 * 判定字段是否处于「无数据」状态
 *
 * STS 永远有状态文案（未知态的 "-" 也是有意展示），不参与占位与隐藏。
 *
 * @param {} field 字段名
 * @param {} value 字段原始展示值
 * @return {} true 表示无数据
 * @author DeepSeek-V4.1-Flash
 * @date 2026-09-11
 */
function isMissing(field: FieldName, value: string): boolean {
	if (field === "STS") return false;
	return value === EMPTY;

}

/**
 * 无值字段的最终展示文本
 *
 * hideEmpty=false 时用占位文本撑住结构，避免整行宽度反复跳变。
 *
 * @param {} field 字段名
 * @param {} value 字段原始展示值
 * @param {} config 配置
 * @return {} 展示文本
 * @author DeepSeek-V4.1-Flash
 * @date 2026-09-11
 */
export function displayValue(field: FieldName, value: string, config: ResolvedConfig): string {
	if (! isMissing(field, value)) return value;
	return config.emptyText;

}

/**
 * 把字段项按配置拼成单块文本
 *
 * @param {} entries 字段项，顺序即展示顺序
 * @param {} config 配置
 * @return {} 单行文本，全部被隐藏时为空串
 * @author DeepSeek-V4.1-Flash
 * @date 2026-09-11
 */
export function composeLine(entries: FieldEntry[], config: ResolvedConfig): string {
	const kept = config.hideEmpty ? entries.filter((item) => (! isMissing(item.field, item.value))) : entries;
	return kept.map((item) => `${item.field} ${displayValue(item.field, item.value, config)}`).join(` ${config.separator} `);

}

/**
 * 按配置默认顺序生成整行文本（用于 toast 与测试）
 *
 * @param {} readout 读数
 * @param {} config 配置
 * @return {} 单行文本
 * @author DeepSeek-V4.1-Flash
 * @date 2026-09-11
 */
export function buildLine(readout: Readout, config: ResolvedConfig): string {
	return composeLine(config.items.map((field) => ({ field, value: fieldValue(field, readout, config) })), config);

}
