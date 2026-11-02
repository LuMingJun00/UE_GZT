# UE 场景制作一体化工作台 — 交接总结

## 项目目标
制作一个 UE 场景制作一体化工作台：内置 UE 5.7 工程（方便导入资产）、本地网页控制台、集成贴图制作工具 EkkoPBR（PBR 材质生成），并支持收纳入库与备份。

## 硬性约束
- **不得修改 UE 软件源文件**（引擎只读调用，UE 5.7 路径：`C:\Program Files\UE\UE_5.7\Engine\Binaries\Win64\UnrealEditor.exe`）
- EkkoPBR 之前要求"原样调用不修改本体"，**用户后续已明确授权可直接修改 EkkoPBR 源文件**（`Reference\EkkoPBR-Portable-Windows\dist\`），原文件已备份为 `dist\index.html.bak-20261101`

## 已交付内容
- 工作台根目录：`E:\00_AI\UE_GZT`
- **UE 工程**：`SceneWorkbench\`（uproject + Config 三件套 + 17 目录 + 两张地图 `00_MaterialPreview.umap` / `01_SceneBuild.umap` + 材质 `M_Preview` / `MI_Preview`）
- **本地控制台**：`Workbench\server.mjs`，端口 5360，API 含 status / ekkopbr start+stop / ue open / folder open / collect / backup
- **网页界面**：`Workbench\www\index.html`（深色中文控制台，v1.1：tabs 标签页切换「贴图制作流程」/「单模型拆分流程」，不内嵌 iframe）
- **脚本**：`collect_textures.ps1`（收纳入库）、`backup_project.ps1`（快照备份，均 UTF-8 BOM）、`start-workbench.cmd` / `stop-workbench.cmd`（GBK 936 编码）
- **方案文档**：`workbench-design.md`（已含实施完成章节）

## 当前主线：EkkoPBR 贴图拖拽导入（进行中）

### 需求
用户要求：在 **`http://127.0.0.1:5173/` 的 EkkoPBR 页面**，把贴图图片**直接拖到材质预览窗口（球体区域）**，松开即自动导入「输入源」（input[type=file]，onChange 用 FileReader.readAsDataURL）；工作台页面保持上一版外观（**不用 iframe、不展开层级**）。

### 实现方式（当前版本）
- **直接修改 EkkoPBR 源文件** `Reference\EkkoPBR-Portable-Windows\dist\index.html`：在 `</body>` 前内联一段拖拽脚本，内容包括：
  - document 级 **capture 阶段**监听 dragover / dragenter / dragleave / drop
  - 拖入时预览窗口（canvas 祖先）显示红色虚线框
  - drop 后将文件写入隐藏 file input 并 dispatch change
  - 右上角 toast「已导入输入源：xxx.png」
  - 右下角常驻绿色徽标「● 拖拽导入已启用」
  - input 未就绪自动重试（10 次 × 500ms）
- 注入版服务器 `Workbench\scripts\ekkopbr-inject-server.mjs`（端口 5173，服务 dist 目录）：检测 HTML 已含脚本则不再重复注入
- 工作台 `server.mjs` 的 /api/ekkopbr/start 负责启动 5173（pid 写 `Workbench\.ekkopbr-inject.pid`）

### 关键修复（重要）
**真实拖拽失败的根因**：从文件管理器拖文件时，`dragover` 阶段 `dataTransfer.files` 是**空的**（跨进程拖拽文件列表延迟），原脚本要求 files 非空才 preventDefault → 浏览器默认禁止投放 → drop 永不触发。

**修复**：dragover / dragenter 只判断 `dataTransfer.types` 是否含 `'Files'`（即 `isFileDrag(e)`），drop 时才读取 files。已通过 CDP 验证：dragover 时 `defaultPrevented=true`。

### 验证方式（已通过）
- 脚本：`Workbench\scripts\cdp-inject-test.mjs`（Chrome `--remote-debugging-port=9222` 打开 5173 后运行 `node cdp-inject-test.mjs`）
- 验证点：徽标出现、dragover preventDefault=true、drop 导入「cdp-drop.png」成功、属性面板显示文件名、7 个 data 通道图、toast 提示
- 模拟用真实 PNG：`/assets/brand-icon-2MVkIIGa.png`

## 新主线：单模型拆分流程（2026-11-02 已落地，联调待用户实测）

### 需求
工作台新增独立「单模型拆分」流程（标签页与贴图流程并列）：①场景资产拆分 → ②资产高清细化 → ③AI 建模批量生成 → ④模型减面（暂缓占位）→ ⑤批量导入与场景整理。外部平台以 API 接入：comfly（图生图）+ Tripo（图生 3D）。

### 外部平台 API（实测结论）
- **comfly**（高清重绘/图生图）：OpenAI 兼容，baseUrl `https://ai.comfly.org/v1`，模型 `gpt-image-2`（用户网络集成平台上的"GPT绘画模型2"）；AI 反推拆分用 `gpt-4o` 走 /chat/completions。已实测 `/images/generations`、`/images/edits`（multipart）均 200，返回 webstatic.aiproxy.vip 直链。**key 有效**。
- **Tripo**（图生 3D）：Base URL `https://openapi.tripo3d.com/v3`，POST `/generation/image-to-model` 异步返回 task_id，GET `/tasks/{id}` 轮询（queued/running/success/failed），pbr=true 强制纹理。**key 实测 401 Invalid API key，待用户核对更换**（config.json `tripo.ready=false`，生成/下载代码已就绪）。

### 实现
- `Workbench\config.json`：comfly/tripo 密钥与模型、提示词模板（splitSystem / refineTemplate，前端可编辑并「保存模板至 config.json」）、路径映射（Assets\Models / Content\Assets\Meshes / tmp）
- `Workbench\server.mjs`（端口 5360）：新增 GET/POST `/api/split/config`、`/api/mcp/status`、`/api/tripo/status`、POST `/api/split/ai`、`/api/refine`、`/api/tripo/upload`、`/api/tripo/generate`、`/api/tripo/download`、`/api/import`
- `Workbench\www\index.html`：tabs 导航 + splitView 5 步面板 + 完整交互 JS（标签切换、参考图拖拽/点击上传、canvas 手动框选命名入清单、AI 反推拆分、清单表格渲染与勾选、批量细化、Tripo 批量生成+自动轮询+下载、批量导入）

### 关键决策
- **步骤⑤不走 MCP**：UnrealMCP C++ 插件无资产导入命令、无 Python 桥接命令（已 grep 验证），加工具需重编译风险大。改为「模型落盘归位 + server 幂等生成 `SceneWorkbench\Content\Python\import_models.py` 供用户一键执行」；MCP 在线状态仅探测 55557 端口作展示。
- Tripo 建任务自动定位本地细化图（`Assets\Models\<名称>\refined.png`），细化输出与 Tripo 模型双落盘（Assets + 工程 Content\Assets\Meshes\<类别>\<名称>\）。
- Houdini 减面：界面占位（note2），先用 Tripo face_limit 控制面数。

### 已验证
- node --check 全过；readBody 修复为 Buffer.concat（修复中文名 UTF-8 跨 chunk 乱码，实测"测试中文名"完整落盘）
- API 实测：AI 拆分（真实反推"玻璃瓶"+prompt+类别）、细化（落盘 refined.png）、导入（staged + scriptPath）、Tripo key 未就绪友好拦截、模板保存/回读
- 浏览器实测（browser-use）：标签切换、上传、手动框选→命名→清单、AI 拆分→清单、状态徽章（Tripo key 未就绪 / MCP 检测）、保存模板按钮

### 待办
- **Tripo key 401**：用户核对/更换 key → 改 config.json `tripo.apiKey` + `ready=true` → 重启工作台 → 实测 生成/轮询/下载
- 步骤⑤需用户打开 UE 编辑器运行 import_models.py 实测归位导入
- 以下为上一主线遗留：EkkoPBR 拖拽导入用户 Ctrl+F5 实测未闭环

## 待办（用户侧验证）
- 用户在 5173 页面 **Ctrl+F5 强刷**后，从文件管理器拖图片到材质预览窗口实测——**最新一次修复尚未得到用户实测确认**
- 若拖入时红色虚线框出现且导入成功 → 功能闭环完成
- 若仍失败 → 需要进一步排查（用户之前多次反馈"拖不进去"，历史原因包括：浏览器旧标签页未刷新、dragover files 为空未 preventDefault）

## 环境注意
- 用户使用中文交流，技术操作偏好分步细化指导
- 命令文件编码坑：.cmd 必须 GBK(936)，.ps1 必须 UTF-8 BOM，否则中文路径乱码
- 用户机器：Windows，Chrome 浏览器，端口 5360（工作台）/ 5173（EkkoPBR）

---

*生成时间：2026-11-02*
