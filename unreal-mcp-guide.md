# UnrealMCP 接入说明（UE 5.7 / SceneWorkbench）

安装日期：2026-11-01（路径已于当日从中文目录迁至 `E:\00_AI\UE_GZT`）
插件来源：kks3800/Unreal_MCP（社区版，专为 UE 5.7 开发测试）

## 一、已安装清单

| 组件 | 位置 | 状态 |
|---|---|---|
| UE 插件（C++ 编译版） | `E:\00_AI\UE_GZT\SceneWorkbench\Plugins\UnrealMCP\` | ✅ 已编译，DLL 在 `Plugins\UnrealMCP\Binaries\Win64\UnrealEditor-UnrealMCP.dll` |
| Python MCP 服务器 | `Plugins\UnrealMCP\Server\.venv\`（mcp SDK 锁定 1.x） | ✅ 启动测试通过 |
| MCP 配置文件 | `E:\00_AI\UE_GZT\SceneWorkbench\.mcp.json` | ✅ 已生成（DYNAMIC_MODE + 地编模块） |
| VS 工具链 | MSVC 14.44.35207（VS 已升级） | ✅ UE 5.7 要求 14.44+ |

## 二、启用步骤

1. 用 UE 5.7 打开 `E:\00_AI\UE_GZT\SceneWorkbench\SceneWorkbench.uproject`。
   插件为 Editor-only，启动编辑器即自动加载，TCP 服务器监听 `127.0.0.1:55557`。
   可验证：`netstat -ano | findstr 55557`（编辑器开着时应有 LISTENING）。
2. 在支持 MCP 的客户端中添加上述服务器（豆包客户端如有"自定义 MCP 服务器"入口，配置参数见下）。

### 客户端 MCP 服务器配置参数

```
command: E:/00_AI/UE_GZT/SceneWorkbench/Plugins/UnrealMCP/Server/.venv/Scripts/python.exe
args:    ["E:/00_AI/UE_GZT/SceneWorkbench/Plugins/UnrealMCP/Server/unreal_mcp_server.py"]
env:     DYNAMIC_MODE=1
         ENABLED_MODULES=editor,blueprint,blueprint_nodes,material,material_graph,pcg,procedural
```

`.mcp.json` 内容（部分客户端读项目级配置）：
```json
{
  "mcpServers": {
    "unreal-mcp": {
      "type": "stdio",
      "command": "E:/00_AI/UE_GZT/SceneWorkbench/Plugins/UnrealMCP/Server/.venv/Scripts/python.exe",
      "args": ["E:/00_AI/UE_GZT/SceneWorkbench/Plugins/UnrealMCP/Server/unreal_mcp_server.py"],
      "env": {
        "DYNAMIC_MODE": "1",
        "ENABLED_MODULES": "editor,blueprint,blueprint_nodes,material,material_graph,pcg,procedural"
      }
    }
  }
}
```

### 验证示例（连接后测试）

- "在原点生成一个立方体" → 测试基础 actor 能力
- "创建材质 M_Test，红色，粗糙度 0.3" → 测试材质能力

## 三、注意事项

1. **路径已纯英文**：项目现位于 `E:\00_AI\UE_GZT`（不含中文），MSVC 编译不再受中文路径限制。
   编译命令：
   ```
   "C:\Program Files\UE\UE_5.7\Engine\Build\BatchFiles\Build.bat" SceneWorkbenchEditor Win64 Development -Project="E:\00_AI\UE_GZT\SceneWorkbench\SceneWorkbench.uproject" -WaitMutex
   ```
2. **依赖版本**：Python 端依赖 `mcp` 必须保持 **1.x**（插件代码用 FastMCP 旧 API）。
   更新插件后重新安装依赖时执行：
   ```
   cd Plugins\UnrealMCP\Server
   uv pip install -e . 'mcp<2'
   ```
3. **更新插件**：`cd Plugins\UnrealMCP && git pull`；若 `Source/` 有变更需重新编译并重启编辑器。
4. **安全**：插件 TCP 服务器绑定 127.0.0.1、无认证——本机任意进程可向编辑器发命令。仅用于本地开发，勿暴露端口到网络。
5. **当前模块范围**：已按地编需求启用 editor / blueprint / blueprint_nodes / material / material_graph / pcg / procedural。
   需要其他域（如 UMG、MetaSound）时修改 `.mcp.json` 的 `ENABLED_MODULES` 并重启客户端。
6. **VS 已升级**：原 17.11.4（MSVC 14.41，被 UE 5.7 禁用）→ 已装 MSVC 14.44.35207。

## 四、已解决的坑（备忘）

- MSVC 14.41 被 UBT 禁用 → 升级装 14.44
- 中文路径 C1083 → 项目目录整体改为纯英文 `UE_GZT`（原 junction 临时方案已弃用并删除）
- mcp SDK 2.x 与 FastMCP 旧 API 不兼容 → 锁定 `mcp<2`

## 五、Codex CLI 接入（2026-11-01 已完成）

- Codex CLI 0.166.0 已通过 npm 全局安装（Node 22），与桌面版运行时共用 `~/.codex` 配置。
- 已在 `C:\Users\Administrator\.codex\config.toml` 的 `[mcp_servers]` 添加 `unreal-mcp`（改前已备份：`config.toml.bak-unrealmcp`）。
- 验证：`codex mcp list` 中 `unreal-mcp` 状态为 **enabled**。
- 使用步骤：
  1. 用 UE 5.7 打开 `SceneWorkbench` 项目，等编辑器加载完（插件 TCP 55557 监听中）；
  2. 启动 Codex（新会话，重启才会重新读取 MCP 配置）；
  3. 直接对话操作 UE：如"在 00_MaterialPreview 创建材质 M_Test，红色、粗糙度 0.4""创建一个材质函数 MF_X 并自动布线"。
- 验证链路（已实测通过）：MCP 客户端 → `unreal_mcp_server.py`(stdio) → TCP 55557 → UE 插件 → 编辑器内真实执行（`get_editor_context` 已返回关卡/选中物体）。
