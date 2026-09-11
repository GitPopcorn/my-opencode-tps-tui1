/**
 * 自诊断探针生成器
 * </br>TUI 插件的加载失败不留任何痕迹 (不进日志、不进 stderr)，所以要点亮一个
 * 首页可见的槽位来观察。本脚本把 tui.tsx 与 src/ 复制到临时目录，
 * 把槽位名 session_prompt_right 换成 app_bottom，并写好项目级 tui.json。
 * </br>运行：bun run scripts/probe.ts
 * </br>然后：cd 到脚本打印的目录，执行 opencode，看首页底部有没有出现状态行
 * @author DeepSeek_V4_Flash
 * @date 2026-09-11
 * @note note
 */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// ===== ===== ===== ===== [常量] ===== ===== ===== =====

/** CONST 仓库根目录 (scripts/ 的上一级) */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** CONST 正式插件入口文件路径 */
const source = join(root, "tui.tsx");

// ===== ===== ===== ===== [逻辑代码] ===== ===== ===== =====

// STEP 校验入口文件存在，缺失即中止

if (! existsSync(source)) {
	console.error("缺少 tui.tsx");
	process.exit(1);
	
}

// STEP 准备探针工作目录与路径常量

/** CONST 探针工作目录，落在系统临时目录下 */
const work = resolve(process.env.TEMP ?? "/tmp", "oc-tps-probe");
/** CONST 探针包目录 */
const pkg = join(work, "probe-pkg");
/** CONST 探针入口文件路径 */
const entry = join(pkg, "tui.tsx");

// SUBSTEP 清空旧目录并搭建骨架：.opencode 配置目录 + 探针包内的 src 副本

rmSync(work, { recursive: true, force: true });
mkdirSync(join(work, ".opencode"), { recursive: true });
cpSync(join(root, "src"), join(pkg, "src"), { recursive: true });

// SUBSTEP 生成探针入口：槽位换成首页可见的 app_bottom，这样无会话时也能看到渲染结果

const original = readFileSync(source, "utf8");
const swapped = original.split("session_prompt_right").join("app_bottom");
writeFileSync(entry, swapped);
console.log(`槽位名替换次数 = ${original.split("session_prompt_right").length - 1}`);

// SUBSTEP 写探针包的 package.json (双导出形态，与正式包一致)

writeFileSync(join(pkg, "package.json"), `${JSON.stringify({ name: "oc-tps-probe", version: "0.1.0", type: "module", exports: { ".": "./tui.tsx", "./tui": "./tui.tsx" } }, null, "\t")}\n`);

// STEP 写项目级配置：用 file:// 直指探针入口，同时也把裸包名形态列出来备用

/** CONST 探针的 tui.json 配置：file:// 元组直指探针入口 */
const config = {
	plugin: [[pathToFileURL(entry).href, { hideEmpty: false }]],
};
writeFileSync(join(work, ".opencode", "tui.json"), `${JSON.stringify(config, null, "\t")}\n`);

// STEP 打印使用指引：目录、入口、下一步命令与预期结果

console.log("");
console.log("探针已就绪");
console.log(`  目录： ${work}`);
console.log(`  入口： ${pathToFileURL(entry).href}`);
console.log("  槽位： app_bottom (首页底部可见)");
console.log("");
console.log("下一步：");
console.log(`  cd /d "${work}"`);
console.log("  opencode");
console.log("");
console.log("预期：首页底部出现 TPS - | AVG_TPS - | TOKEN - | ... 即说明插件本体与注册链路正常");
console.log("      什么都没有 = 加载失败 (此时把 tui.tsx 的槽位改回 session_prompt_right 供正式使用)");
