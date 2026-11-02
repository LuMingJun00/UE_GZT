# UE 场景制作工作台 · 设计方案（v1 · 待确认）

## 一、目标

为 UE 场景制作提供**一个本地一体化工位**：

- 内置一个 **UE 5.7 工程**，方便把资产直接导入使用；
- 集成 **EkkoPBR 贴图工具**（已在你提供的"Reference"目录中）；
- 提供统一的**素材库**收纳原始资产；
- 提供**一键启动控制台**，把所有入口集中起来。

所有产出均放在 `E:\00_AI\UE_GZT` 内，**不修改任何 UE 软件源文件**。

## 二、现状盘点（已核实）

| 项目 | 情况 |
| --- | --- |
| UE 引擎 | **UE 5.7** 已安装就绪：`C:\Program Files\UE\UE_5.7`（UnrealEditor.exe 存在） |
| 贴图工具 | **EkkoPBR 便携版**：`Reference\EkkoPBR-Portable-Windows`，自带 Node 运行时，本机 `127.0.0.1:5173` 启动，纯本地运行、不上传图片 |
| EkkoPBR 能力 | 生成 BaseColor / Normal / Roughness / Metalness / Height / AO 无缝 PBR 贴图组，分辨率 512~4096，PNG/TIF 浏览器导出 |
| 工作台目录 | `E:\00_AI\UE_GZT` 目前仅含「Reference」文件夹 |
| 硬约束 | 不修改 UE 软件源文件（引擎目录只读引用） |

## 三、总体架构（目录结构）

```
E:\00_AI\UE_GZT\
├── start-workbench.cmd        # 总入口：双击启动控制台
├── stop-workbench.cmd         # 一键停止所有本地服务
├── Workbench\                 # 控制台（本地网页 + 极简本地服务）
│   ├── server.mjs            # 本机 127.0.0.1:5360 提供控制台页面
│   └── www\index.html        # 控制台界面
├── SceneWorkbench\            # ★ 内置 UE 工程（UE 5.7）
│   ├── SceneWorkbench.uproject
│   ├── Config\
│   └── Content\
│       ├── Maps\
│       │   ├── 00_MaterialPreview   # 展台+灯光，贴图即拖即看
│       │   └── 01_SceneBuild        # 空白主场景
│       └── Assets\
│           ├── Meshes\       # 模型
│           ├── Textures\     # 贴图（EkkoPBR 产出汇入点）
│           ├── Materials\    # 材质
│           ├── Blueprints\   # 蓝图
│           ├── HDRI\         # 环境贴图
│           ├── Foliage\      # 植被
│           ├── FX\           # 特效
│           └── Audio\        # 音效
├── Assets\                    # 原始资产收纳（不入工程）
│   ├── Models\  Textures\  HDRI\  Audio\  Misc\
├── Reference\                 # EkkoPBR 工具（原样保留，不修改）
└── workbench-design.md        # 本文档
```

## 四、内置 UE 工程（SceneWorkbench · UE 5.7）

- **类型**：蓝图空工程（不勾选初学者内容，保持轻量）
- **引擎关联**：5.7（仅引用引擎，引擎文件零改动）
- **内置两张地图**：
  - `00_MaterialPreview`：展台 + 三点灯光 + HDRI 背景，贴图导入后挂到材质即可立刻预览，适合贴图检查；
  - `01_SceneBuild`：空白主场景，正式搭建用。
- **Content 目录**：按场景制作习惯分 8 类资产目录（见上图）。
- **启用内置插件**：HDRIBackdrop（环境光照）、SunPosition（日光/时间）、ModelingToolsEditorMode（建模模式）——均为引擎自带，无外部依赖。

## 五、贴图工具集成（EkkoPBR）

- **原样调用，不修改工具文件**；
- 控制台提供「启动/停止贴图工具」按钮（调用现有 `start-ekkopbr.cmd` / `stop-ekkopbr.cmd` 逻辑）；
- 导出为浏览器下载，配「收纳入库」脚本一键把下载的贴图归位到 `Assets\Textures\<名称>\`；
- 再导入 UE 工程 `Content\Assets\Textures`（UE 打开状态下自动识别新文件）。

## 六、素材库

`Assets\Models / Textures / HDRI / Audio / Misc` —— 原始资产统一收纳区，与 UE 工程分离，需要时再导入工程，避免工程膨胀。

## 七、工作台控制台

- **形式**：本地网页（默认 `127.0.0.1:5360`，端口避开 EkkoPBR 的 5173），双击 `start-workbench.cmd` 即用；
- **功能**：
  1. 启动 / 停止 贴图工具 EkkoPBR；
  2. 用 UE 5.7 打开内嵌工程；
  3. 打开素材库 / 输出目录；
  4. 贴图流程指引与快捷键。

## 八、标准贴图工作流（6 步）

1. 启动控制台 → 一键拉起 EkkoPBR；
2. 导入原始图片 → 生成无缝 PBR 贴图组；
3. 浏览器导出下载（BaseColor / Normal / Roughness / Metalness / Height / AO）；
4. 收纳入库 → 归位到 `Assets\Textures\<名称>\`；
5. 导入 UE 工程 `Assets/Textures`（拖入 Content Browser 自动识别）；
6. 材质预览台预览、微调、成图。

## 九、实施步骤（确认后执行）

1. 创建 UE 5.7 工程 + Content 目录结构 + 两张地图；
2. 搭建「材质预览台」场景（展台、灯光、HDRI 背景）；
3. 编写工作台控制台（网页 + 本地服务 + 脚本）；
4. 编写「收纳入库」与「启动/关闭」脚本；
5. 联调验证：启动 → 出图 → 入库 → UE 导入 → 预览，全流程跑通。

## 十、GitHub 参考调研（2026-10-29 检索）

| 参考项目 | 类型 | 亮点 | 对本工作台的借鉴 |
| --- | --- | --- | --- |
| **造物间 ZAOWU**（Berserker-Gandalf/game-creation-workbench） | 游戏创作·项目管理工作台（中文） | 本地服务 + cmd 启停 + 网页工作台；接入已有 UE/Unity 工程（原文件保留原地）；任务/资产版本/工程快照/SHA-256 交付/不可变验收历史；数据与程序分离；MIT | 直接验证了「本地网页控制台 + 工程接入 + 资产收纳管理」整体形态的成熟度 |
| **UnrealBatchImporter**（KiaArmani） | UE 批量导入 CLI | 不打开编辑器即可批量导入资产，按工厂设置 JSON 控制导入参数 | 「一键批量导入」自动化的实现思路 |
| **PATINA**（lovisdotio/fal-texture-pbr-generator） | AI PBR 贴图生成 | 标准命名 BaseColor/Normal/Roughness/Metallic/Height、ZIP 打包、WebGL 3D 实时预览；MIT | 贴图输出命名规范与导出组织的参考 |
| **TextureLab**（njbrown） | 程序化贴图生成器 | GPU 加速、跨平台、C++/Qt6；GPLv3 | 贴图工具生态对照；**EkkoPBR 在 GitHub 无公开仓库（闭源）**，按现状原样集成即可 |
| **UE5AssetManager / UnrealHelpers / Tech-Art-Tools** 等 | UE 资产管理/编辑器工具 | Python 批量资产管理、编辑器工具化、资产目录治理 | 资产目录规划与「编辑器内工具化」的参考 |

## 十一、可行性结论

1. **整体形态可行**：造物间 ZAOWU 已用同类架构（本地网页 + cmd 启停 + 工程接入 + 资产版本管理）做出成熟产品（MIT），说明本方案无技术障碍。
2. **贴图集成可行**：EkkoPBR 为闭源便携工具、GitHub 无公开仓库，原样调用现有启动/关闭脚本是正确且唯一稳妥的方式，不修改工具本体。
3. **自动导入可行**：已确认 UE 5.7 自带 `UnrealEditor-Cmd.exe`（Engine\Binaries\Win64，版本 ++UE5+Release-5.7-CL-51494982），可走 commandlet/脚本把素材库资产批量导入工程；保守方案是贴图直接放入 `Content` 由 UE 自动识别导入。
4. **约束满足**：所有方案只调用引擎二进制（只读运行），不写引擎目录，**不修改任何引擎源文件**。

## 十二、完善建议（吸收自参考项目）

1. **贴图命名规范**：约定导出命名后缀 `_BaseColor / _Normal / _Roughness / _Metalness / _Height / _AO`，入库脚本自动归位 + 规范化命名，UE 中可直接拖入材质节点。
2. **一键批量导入**：提供脚本调用 UE 5.7 `UnrealEditor-Cmd` 批量导入素材库资产到工程对应目录（作为**二期增强**；一期先以「放入 Content 自动导入 + 手动拖入」起步，稳妥优先）。
3. **工程快照备份**：一键把 `SceneWorkbench\Content + Config` 打包成带日期的 zip，防误改可恢复。
4. **资产来源记录**：贴图入库时自动生成 `_manifest.txt`（来源 / 日期 / 通道数 / 分辨率），可追溯。
5. **数据与程序分离**：工作台程序（脚本/网页）与数据（素材库/工程）分目录存放，重装/迁移不丢数据（沿用已设计结构）。

## 十三、待确认决策点

1. **工程命名/位置**：默认 `SceneWorkbench`，放在 `E:\00_AI\UE_GZT\SceneWorkbench`，可否？
2. **控制台形态**：默认做「本地网页一键总控」（推荐，界面友好），还是只要简单的批处理菜单？
3. **材质预览台**：默认需要（推荐，贴图预览效率高），是否保留？
4. **贴图命名规范 + 入库 manifest**：默认纳入（推荐），是否采用？
5. **工程快照备份按钮**：默认纳入（推荐），是否采用？
6. **一键批量导入**：一期先做「放入 Content 自动导入」，commandlet 批量导入放二期，可以吗？
7. 其他需要调整的地方（目录结构、地图命名、插件、工作流等）。

---

## 十四、实施完成情况与使用说明（2026-10-31 交付）

### 1. 已实施内容

| 项目 | 状态 | 说明 |
| --- | --- | --- |
| UE 5.7 工程 SceneWorkbench | ✅ | EngineAssociation=5.7；启用 HDRIBackdrop / SunPosition / ModelingToolsEditorMode / PythonScriptPlugin |
| 内置地图 ×2 | ✅ | 00_MaterialPreview（展台+球/立方/立板+平行光+天空光，材质预览）；01_SceneBuild（空白主场景）；启动图=00_MaterialPreview |
| 预览材质 | ✅ | M_Preview（BaseColor/Normal/Roughness/Metallic/AO 五参数）+ MI_Preview 实例 |
| 本地控制台 | ✅ | Workbench\server.mjs（端口 5360）+ www\index.html 深色中文控制台 |
| EkkoPBR 启停 | ✅ | 控制台按钮调用，检测 5173 端口；停止逻辑已修复（按 pid 文件/端口兜底查杀） |
| 打开 UE 工程 | ✅ | 控制台按钮启动 UnrealEditor.exe 打开工程 |
| 素材库目录 | ✅ | Assets\{Models,Textures,HDRI,Audio,Misc}；控制台一键打开 |
| 收纳入库 | ✅ | collect_textures.ps1：扫描下载目录近 12h PBR 后缀贴图 → Assets\Textures\<前缀>\ + manifest |
| 快照备份 | ✅ | backup_project.ps1：Content+Config+uproject → Backups\SceneWorkbench_时间戳.zip（已验证） |
| 启停脚本 | ✅ | 根目录 start-workbench.cmd / stop-workbench.cmd（已修复 cmd 延迟展开问题） |
| ZAOWU 参考件 | ✅ | Reference\ZAOWU v0.19.0 已下载校验并解压，仅作参考不集成 |

### 2. 使用方式

1. 双击根目录 **start-workbench.cmd** → 自动起本地服务并打开浏览器控制台（http://127.0.0.1:5360）。
2. 控制台：启动贴图工具 → 浏览器 5173 生成 PBR 贴图 → 导出下载 → 收纳入库 → 打开 UE 工程，把贴图拖入 Content\Assets\Textures（自动导入）→ 材质预览台套 MI_Preview 微调。
3. 结束使用：双击 **stop-workbench.cmd**（同时停止控制台与 EkkoPBR）。

### 3. 硬约束确认

- UE 引擎目录（C:\Program Files\UE\UE_5.7）仅被只读调用（UnrealEditor.exe / UnrealEditor-Cmd.exe），**未修改任何引擎源文件**。
- EkkoPBR 原样调用，未修改工具本体。
- 批量导入（commandlet）按决策放二期；一期贴图放入 Content 由编辑器自动导入。

### 4. 联调验证记录（2026-10-31）

服务启动 ✅ 页面加载 ✅ 状态检测 ✅ EkkoPBR 启停 ✅ 备份 ZIP 生成且含地图/材质/Config/uproject ✅ 收纳入库执行 ✅ 打开目录 ✅ 打开 UE 工程（进程存活）✅
