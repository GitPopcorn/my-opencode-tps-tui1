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

/** VAR 侧边栏区块的排版选项 */
export type SidebarLayout = {
	indent: string;
	align: boolean;
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

/**
 * 计算文本的终端显示宽度：CJK 与全角字符按 2 列计，其余按 1 列计
 * </br>按码点遍历而非 UTF-16 码元，代理对 (Emoji 与扩展汉字) 才会算成一列宽的两列
 * @param {string} text 待测量的文本
 * @return {number} width 终端显示列数
 * @author DeepSeek_V4_Flash
 * @date 2026-09-11
 * @note note
 */
export function displayWidth(text: string): number {
	// VAR 累计列数，逐码点累加
	let width = 0;

	// STEP for...of 遍历的是码点，代理对不会被拆成两个半截字符
	for (const char of text) {
		// VAR 当前码点
		const code = char.codePointAt(0) ?? 0;

		// BRANCH CJK 标点、全角标点、全角字符与扩展汉字按 2 列计
		if (code >= 0x3000 && code <= 0x303f) {
			width = width + 2;
			continue;
		}

		// BRANCH 扩展汉字区 (A / B / C / D 统一表意文字扩展 A) 按 2 列计
		if (code >= 0x3400 && code <= 0x4dbf) {
			width = width + 2;
			continue;
		}

		// BRANCH CJK 统一表意文字基本区按 2 列计
		if (code >= 0x4e00 && code <= 0x9fff) {
			width = width + 2;
			continue;
		}

		// BRANCH 全角字符区按 2 列计
		if (code >= 0xff01 && code <= 0xff60) {
			width = width + 2;
			continue;
		}

		// BRANCH 全角符号区按 2 列计
		if (code >= 0xffe0 && code <= 0xffe6) {
			width = width + 2;
			continue;
		}

		// BRANCH 基本平面以外的码点 (Emoji、扩展汉字等) 按 2 列计
		if (code > 0xffff) {
			width = width + 2;
			continue;
		}

		// STEP 其余字符按 1 列计
		width = width + 1;

	}

	// STEP 返回累计列数
	return width;

}

/**
 * 把字段项渲染成侧边栏区块的多行文本 (每字段一行)
 * </br>align 开启时按最长显示名列右对齐值列，CJK 宽度按 displayWidth 计
 * @param {FieldEntry[]} entries 字段项，顺序即展示顺序
 * @param {ResolvedConfig} config 配置
 * @param {SidebarLayout} layout 排版选项：行首缩进与是否对齐值列
 * @return {string[]} lines 每字段一行的文本数组，不含标题行
 * @author DeepSeek_V4_Flash
 * @date 2026-09-11
 * @note note
 */
export function composeSidebarLines(entries: FieldEntry[], config: ResolvedConfig, layout: SidebarLayout): string[] {
	// STEP hideEmpty 开启时先滤掉无数据字段，与 composeLine 保持同一语义
	const kept = config.hideEmpty ? entries.filter((item) => (! isMissing(item.field, item.value))) : entries;

	// STEP 取各字段的显示名并做占位替换，渲染层只管拼行不碰数值口径
	const labels = kept.map((item) => config.labels[item.field]);
	const values = kept.map((item) => displayValue(item.field, item.value, config));

	// VAR 值列起始前的标签列宽，对齐关闭时不参与计算
	let labelWidth = 0;

	// STEP 对齐开启时先扫一遍取最长显示名的显示宽度
	if (layout.align) {
		for (const label of labels) {
			const width = displayWidth(label);
			if (width > labelWidth) labelWidth = width;
		}
	}

	// STEP 逐行拼接：缩进 + 显示名 + 对齐补白 + 分隔空格 + 值
	const lines: string[] = [];
	for (let index = 0; index < kept.length; index = index + 1) {
		// PART 对齐关闭时只用一个空格分隔，避免右侧拖出长短不齐的空白
		if (! layout.align) {
			lines.push(`${layout.indent}${labels[index]} ${values[index]}`);
			continue;
		}

		// PART 对齐开启时按显示宽度补齐标签列，中文标签不会被撑散
		const pad = " ".repeat(Math.max(0, labelWidth - displayWidth(labels[index])));
		lines.push(`${layout.indent}${labels[index]}${pad} ${values[index]}`);
	}

	// STEP 返回行数组，全字段被过滤时为空数组
	return lines;

}
