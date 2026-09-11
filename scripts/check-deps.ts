/**
 * 依赖与入口体检：把守三条踩过坑的硬规则
 * </br>规则一 插件目录不得存在 node_modules/@opentui：
 * 它会拉起第二份 @opentui/core，与宿主抢注册环境变量 OPENTUI_FORCE_WCWIDTH 并抛错
 * </br>规则二 入口文件不得出现来自 "solid-js" 的裸导入：
 * OpenCode 只重写 @opentui/solid 这类子路径 specifier，裸 specifier 走普通解析并失败
 * </br>规则三 入口必须是原始 .tsx，不能是预编译产物：
 * 宿主的 Solid 转换插件只跳过路径含 node_modules 的文件；本插件经 junction 加载时
 * 真实路径在 node_modules 之外，压缩过的 .js 会被转换器处理并直接崩掉
 * </br>运行：bun run check-deps
 * @author DeepSeek_V4_Flash
 * @date 2026-09-11
 * @note note
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ===== ===== ===== ===== [常量] ===== ===== ===== =====

/** CONST 仓库根目录 (scripts/ 的上一级) */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** CONST 污染要素数组，出现即判定为污染，插件会被 OpenCode 静默丢弃 */
const POISON = [join("node_modules", "@opentui"), join("node_modules", "solid-js")];

/** CONST 入口里绝不允许出现的裸 specifier，宿主不会重写它 */
const BARE_SOLID = /from\s+"solid-js(\/[^"]*)?"/;

/** CONST 入口允许的扩展名 */
const ENTRY_SUFFIX = ".tsx";

// ===== ===== ===== ===== [逻辑代码] ===== ===== ===== =====

// STEP 扫描污染要素：插件目录里出现本地 @opentui / solid-js 即判失败

let failed = 0;

for (const relative of POISON) {
	if (! existsSync(join(root, relative))) continue;
	failed = failed + 1;
	console.log(`[FAIL ] 存在 ${relative} —— 必须删除，否则插件无法加载`);
	console.log(`       删除命令： rd /s /q "${join(root, relative)}"`);
	
}

// STEP 校验 package.json 的 TUI 入口声明

const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const entry = manifest.exports?.["./tui"];

if (typeof entry !== "string") {
	// SUBSTEP 声明缺失或不是字符串，直接计失败
	failed = failed + 1;
	console.log('[FAIL ] package.json 的 exports["./tui"] 不是字符串');
	
} else {
	// SUBSTEP 校验入口扩展名必须是原始 .tsx
	if (! entry.endsWith(ENTRY_SUFFIX)) {
		failed = failed + 1;
		console.log(`[FAIL ] 入口是 ${entry}，必须是原始 .tsx (见文件头规则三)`);
		
	} else {
		console.log(`[PASS ] 入口为原始 .tsx：${entry}`);
		
	}
	
	// SUBSTEP 校验入口文件真实存在，并对其内容做两条规则检查
	const entryPath = join(root, entry.replace(/^\.\//, ""));
	if (! existsSync(entryPath)) {
		failed = failed + 1;
		console.log(`[FAIL ] 入口文件不存在：${entry}`);
		
	} else {
		// PART 检查裸 solid-js 导入 (规则二)
		const text = readFileSync(entryPath, "utf8");
		if (BARE_SOLID.test(text)) {
			failed = failed + 1;
			console.log(`[FAIL ] ${entry} 里出现了裸 "solid-js" 导入，宿主不会重写它`);
			
		} else {
			console.log(`[PASS ] ${entry} 无裸 solid-js 导入`);
			
		}
		
		// PART 检查文件头 @jsxImportSource 指令 (node_modules 内编译依赖它)
		if (! text.startsWith("/** @jsxImportSource @opentui/solid */")) {
			console.log("[WARN ] 入口文件头缺少 @jsxImportSource 指令，装进 node_modules 后会退化成 React JSX");
			
		} else {
			console.log("[PASS ] 入口文件头带 @jsxImportSource 指令");
			
		}
		
	}
	
}

// STEP 检查 dist/ 目录不存在 (预编译产物会被宿主转换器处理并崩掉)

if (existsSync(join(root, "dist"))) {
	const size = statSync(join(root, "dist")).size;
	failed = failed + 1;
	console.log(`[FAIL ] 存在 dist/ (${size} 字节) —— 它不是入口，且容易被误当成入口，请删除`);
	
} else {
	console.log("[PASS ] 不存在 dist/ 目录");
	
}

// STEP 检查 node_modules 状态 (存在不算失败，但必须提醒它的用途边界)

const modules = join(root, "node_modules");
if (! existsSync(modules)) {
	console.log("[PASS ] 插件目录不存在 node_modules (理想状态)");
	
} else {
	console.log(`[INFO ] node_modules 有 ${readdirSync(modules).length} 项，仅用于编辑器与类型检查，切勿当成运行时依赖`);
	
}

// STEP 汇总失败数并以退出码向调用方报告结果

console.log(`\n共 ${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
