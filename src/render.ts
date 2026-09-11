/**
 * 读数 → 单块文本行
 * </br>整行只有一个 <code><text></code> 节点：全部字段拼进同一个字符串，间距由文本自身的
 * 空格决定，不再受 flex gap 影响，拖拽选中时也是完整一块。
 * @author DeepSeek_V4_Flash
 * @date 2026-09-11
 * @note note
 */

import { EMPTY, formatCount, formatDuration, formatRate } from "./format.js";
import type { FieldName, ResolvedConfig } from "./config.js";
import type { Readout } from "./metrics.js";

// ===== ===== ===== ===== [类型] ===== ===== ===== =====

/** VAR 单字段的展示项：字段名 + 已格式化的值 */
export type FieldEntry = {
	field: FieldName;
	value: string;
};

// ===== ===== ===== ===== [导出方法] ===== ===== ===== =====

/**
 * 取单个字段的展示值
 * </br>保留 EMPTY 语义，占位替换交给 composeLine，这样 hideEmpty 仍能识别「无数据」
 * @param {FieldName} field 字段名
 * @param {Readout} readout 读数
 * @param {ResolvedConfig} config 配置
 * @return {string} value 该字段的展示值，无数据为占位符
 * @author DeepSeek_V4_Flash
 * @date 2026-09-11
 * @note note
 */
export function fieldValue(field: FieldName, readout: Readout, config: ResolvedConfig): string {
	// BRANCH 逐字段查表取值：速率类走 formatRate、计数类走 formatCount、
	// 时长类走 formatDuration，STS 直接透传状态文案
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
 * </br>STS 永远有状态文案 (未知态的 "-" 也是有意展示)，不参与占位与隐藏
 * @param {FieldName} field 字段名
 * @param {string} value 字段原始展示值
 * @return {boolean} missing true 表示无数据
 * @author DeepSeek_V4_Flash
 * @date 2026-09-11
 * @note note
 */
function isMissing(field: FieldName, value: string): boolean {
	// BRANCH STS 不参与判定
	if (field === "STS") return false;

	// STEP 其余字段以占位符为无数据标志
	return value === EMPTY;

}

/**
 * 无值字段的最终展示文本
 * </br>hideEmpty=false 时用占位文本撑住结构，避免整行宽度反复跳变
 * @param {FieldName} field 字段名
 * @param {string} value 字段原始展示值
 * @param {ResolvedConfig} config 配置
 * @return {string} text 展示文本
 * @author DeepSeek_V4_Flash
 * @date 2026-09-11
 * @note note
 */
export function displayValue(field: FieldName, value: string, config: ResolvedConfig): string {
	// BRANCH 有数据原样透传
	if (! isMissing(field, value)) return value;

	// STEP 无数据替换为占位文本
	return config.emptyText;

}

/**
 * 把字段项按配置拼成单块文本
 * </br>每个字段渲染为「显示名 + 值」，显示名取 config.labels 对应项，
 * 默认等于字段自身的大写下划线名，用户可用 labels 配置替换成任意文本
 * @param {FieldEntry[]} entries 字段项，顺序即展示顺序
 * @param {ResolvedConfig} config 配置
 * @return {string} line 单行文本，全部被隐藏时为空串
 * @author DeepSeek_V4_Flash
 * @date 2026-09-11
 * @note note
 */
export function composeLine(entries: FieldEntry[], config: ResolvedConfig): string {
	// STEP hideEmpty 开启时先滤掉无数据字段
	const kept = config.hideEmpty ? entries.filter((item) => (! isMissing(item.field, item.value))) : entries;

	// STEP 逐项做占位替换后用分隔符拼接成单块文本，前缀取 labels 显示名而非字段名
	return kept.map((item) => `${config.labels[item.field]} ${displayValue(item.field, item.value, config)}`).join(` ${config.separator} `);

}

/**
 * 按配置默认顺序生成整行文本 (用于 toast 与测试)
 * @param {Readout} readout 读数
 * @param {ResolvedConfig} config 配置
 * @return {string} line 单行文本
 * @author DeepSeek_V4_Flash
 * @date 2026-09-11
 * @note note
 */
export function buildLine(readout: Readout, config: ResolvedConfig): string {
	// STEP 按配置字段顺序取值后拼接
	return composeLine(config.items.map((field) => ({ field, value: fieldValue(field, readout, config) })), config);

}
