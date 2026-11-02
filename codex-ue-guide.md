# Codex 操作 UE（SceneWorkbench）速用手册

> 状态：全部就绪，开 Codex 即可用。

## 已就绪清单

- UE 5.7 编辑器 + UnrealMCP 插件运行中（TCP 127.0.0.1:55557 监听）
- Codex CLI 0.166.0 已安装，MCP 服务器 `unreal-mcp` 已配置（`~/.codex/config.toml`）
- MCP 端到端已验证：`get_editor_context` 能读到编辑器关卡/选中物体

## 使用方法（三步）

1. **确认 UE 编辑器开着**（打开 `E:\00_AI\UE_GZT\SceneWorkbench\SceneWorkbench.uproject`，等加载完）
2. **打开 Codex 新会话**（新会话才会加载 MCP 配置）
3. **直接对话操作 UE**，例如：

```
- 在关卡中创建一个材质 M_Test：基色红色，粗糙度 0.4
- 创建材质函数 MF_TestAdd：两个输入相加输出
- 列出当前关卡所有 Actor
- 在原点生成一个立方体
- 帮我批量创建 5 个地面材质：草地/泥土/岩石/沙地/水面
```

Codex 会自动调用 MCP 工具在编辑器内执行并保存资产。

## 关键路径

| 项 | 路径 |
|---|---|
| 项目 | `E:\00_AI\UE_GZT\SceneWorkbench\SceneWorkbench.uproject` |
| MCP 服务器脚本 | `E:\00_AI\UE_GZT\SceneWorkbench\Plugins\UnrealMCP\Server\unreal_mcp_server.py` |
| Python（venv） | `E:\00_AI\UE_GZT\SceneWorkbench\Plugins\UnrealMCP\Server\.venv\Scripts\python.exe` |
| Codex 配置 | `C:\Users\Administrator\.codex\config.toml`（已备份 config.toml.bak-unrealmcp） |
| 完整说明 | `E:\00_AI\UE_GZT\UnrealMCP接入说明.md` |

## 注意事项

- **必须** UE 编辑器开着，否则工具调用失败
- 当前启用模块：editor / blueprint / blueprint_nodes / material / material_graph / pcg / procedural（材质、材质函数、蓝图、PCG 都覆盖）
- 材质/材质函数默认保存到 `/Game/Materials`、`/Game/MaterialFunctions`
- 资产由 Codex 调用后自动保存，可在编辑器内容浏览器查看

## 故障排查

- 工具无响应 → 看编辑器是否还开着：`netstat -ano | findstr 55557`（要有 LISTENING）
- Codex 找不到 MCP 工具 → 重启 Codex 会话；确认 `codex mcp list` 里 `unreal-mcp` 为 enabled
- 端口被占/编辑器重启后 → 重新打开项目即可自动恢复监听
- 依赖版本：venv 内 `mcp` 必须保持 1.x，**不要升级**（升级会报 FastMCP 缺失）
- 重新编译项目时加 `-MaxParallelActions=4`（防内存峰值 1455 报错）
