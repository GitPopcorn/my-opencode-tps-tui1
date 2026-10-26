# AGENTS.md — my-opencode-tps-tui1

---

## 提交信息规范门禁

- **触发条件**（以下任一时机触发）：
    - 提交代码：`commit-msg` 钩子自动检查并就地修复提交信息
    - 生成提交信息：调用门禁脚本 `--apply --file <提交信息文件>`
    - Reword 调整提交信息：调用门禁脚本 `--apply --file <提交信息文件>`
    - 全量历史复核：调用门禁脚本 `--scan-history`
- **门禁脚本**：单点共享，位于 `E:\vscode-workspace-temp\tools\check_commit_msg.py`
- **钩子安装**：`git config core.hooksPath .githooks`
- **规则全文与判定口径**：`E:\vscode-workspace-temp\docs\specs\2026-10-26-提交信息规范.md`
