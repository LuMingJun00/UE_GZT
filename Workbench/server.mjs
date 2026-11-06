// UE 场景制作工作台 - 本地控制台服务（仅监听本机 127.0.0.1）
import { createServer } from "node:http";
import { createConnection } from "node:net";
import { connect } from "node:net";
import { request as httpsRequest } from "node:https";
import tls from "node:tls";
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve, dirname, basename } from "node:path";
import { spawn, execFile, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const bundleRoot = resolve(dirname(fileURLToPath(import.meta.url)));
const wwwRoot = resolve(bundleRoot, "www");
const workbenchRoot = resolve(bundleRoot, "..");
const portFile = resolve(bundleRoot, ".wb-port");
const pidFile = resolve(bundleRoot, ".wb-pid");
const startPort = Number(process.argv[2]) || 5360;

// 关键路径（Windows）
const UE_EDITOR = "C:\\Program Files\\UE\\UE_5.7\\Engine\\Binaries\\Win64\\UnrealEditor.exe";
const UE_PROJECT = join(workbenchRoot, "SceneWorkbench", "SceneWorkbench.uproject");
const EKKO_DIR = join(workbenchRoot, "Reference", "EkkoPBR-Portable-Windows");
const LIBRARY_DIR = join(workbenchRoot, "Assets");
const TEXTURES_DIR = join(LIBRARY_DIR, "Textures");
const CONTENT_DIR = join(workbenchRoot, "SceneWorkbench", "Content");
const BACKUP_DIR = join(workbenchRoot, "Backups");
const SCRIPTS_DIR = resolve(bundleRoot, "scripts");
const EKKO_DIST = join(EKKO_DIR, "dist");
const EKKO_INJECT_SERVER = join(SCRIPTS_DIR, "ekkopbr-inject-server.mjs");
const EKKO_INJECT_PID = resolve(bundleRoot, ".ekkopbr-inject.pid");

// ===== 单模型拆分流程（配置与路径）=====
const CONFIG_FILE = resolve(bundleRoot, "config.json");
const TMP_DIR = resolve(bundleRoot, "tmp");
const MODEL_ROOT = resolve(workbenchRoot, "Assets", "Models");
const CONTENT_MESHES = resolve(workbenchRoot, "SceneWorkbench", "Content", "Assets", "Meshes");
const MCP_SERVER_PY = join(workbenchRoot, "SceneWorkbench", "Plugins", "UnrealMCP", "Server", "unreal_mcp_server.py");
const MCP_PYTHON = join(workbenchRoot, "SceneWorkbench", "Plugins", "UnrealMCP", "Server", ".venv", "Scripts", "python.exe");
const MCP_PORT = 55557;

function loadConfig() {
  try { return JSON.parse(readFileSync(CONFIG_FILE, "utf8")); }
  catch (e) { return null; }
}

// comfly 与 Tripo 统一走系统代理（浏览器可访问、Node 直连超时的网络环境）
function detectSystemProxy() {
  try {
    const REGEXE = process.env.SystemRoot ? join(process.env.SystemRoot, "System32", "reg.exe") : "reg";
    const base = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";
    const en = execFileSync(REGEXE, ["query", base, "/v", "ProxyEnable"], { encoding: "utf8", windowsHide: true });
    if (!/0x1/.test(en)) return "";
    const srv = execFileSync(REGEXE, ["query", base, "/v", "ProxyServer"], { encoding: "utf8", windowsHide: true });
    const m = srv.match(/[^\s]+\s+REG_SZ\s+(\S+)/);
    if (!m) return "";
    const v = m[1];
    if (/^https?:\/\//i.test(v)) return v;
    return "http://" + v.split(";")[0].trim();
  } catch (e) { return ""; }
}
const tripoProxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || detectSystemProxy();
async function proxyFetch(url, opts = {}) {
  if (!tripoProxyUrl) return fetch(url, Object.assign({}, opts, { signal: opts.signal || AbortSignal.timeout(opts.timeoutMs || 120000) }));
  const u = new URL(url);
  const p = new URL(tripoProxyUrl);
  let body = opts.body;
  let headers = Object.assign({}, opts.headers || {});
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { sock.destroy(); } catch (e) {}
      reject(new Error("请求超时（" + Math.round((opts.timeoutMs || 120000) / 1000) + "s）：" + u.host));
    }, opts.timeoutMs || 120000);
    function done(fn, val){ if(settled) return; settled = true; clearTimeout(timer); fn(val); }
    const sock = connect(Number(p.port || 80), p.hostname, () => {
      sock.write(`CONNECT ${u.host}:443 HTTP/1.1\r\nHost: ${u.host}:443\r\n\r\n`);
    });
    sock.on("error", function(e){ done(reject, e); });
    const onData = (chunk) => {
      const m = chunk.toString().match(/^HTTP\/1\.[01] (\d{3})/);
      if (!m) return;
      sock.removeListener("data", onData);
      if (m[1] !== "200") { done(reject, new Error("代理 CONNECT 失败 HTTP " + m[1])); sock.destroy(); return; }
      const tlsSock = tls.connect({ socket: sock, servername: u.host }, () => {
        const req = httpsRequest({
          host: u.host, path: u.pathname + u.search, method: opts.method || "GET", headers,
          createConnection: () => tlsSock,
        }, (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            const buf = Buffer.concat(chunks);
            done(resolve, {
              ok: res.statusCode >= 200 && res.statusCode < 300,
              status: res.statusCode,
              statusText: res.statusMessage,
              json: async () => JSON.parse(buf.toString("utf8")),
              text: async () => buf.toString("utf8"),
              arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
            });
          });
          res.on("error", function(e){ done(reject, e); });
        });
        req.on("error", function(e){ done(reject, e); });
        if (body) req.write(body);
        req.end();
      });
      tlsSock.on("error", function(e){ done(reject, e); });
    };
    sock.on("data", onData);
  });
}
function tripoFetch(url, opts) { return proxyFetch(url, opts); }

function sanitizeName(name) {
  if (!name) return "asset";
  const s = String(name).replace(/[\\/:*?"<>|\s]+/g, "_").replace(/^_+|_+$/g, "");
  return s || "asset";
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const requested = decoded === "/" ? "/index.html" : decoded;
  const candidate = resolve(wwwRoot, `.${requested}`);
  const rel = relative(wwwRoot, candidate);
  return rel.startsWith("..") || rel.includes("..\\") || rel.includes("../") ? null : candidate;
}

function isPortOpen(port, cb) {
  const s = createConnection({ port, host: "127.0.0.1" });
  s.once("connect", () => { s.destroy(); cb(true); });
  s.once("error", () => { s.destroy(); cb(false); });
}

function sendJson(res, code, obj) {
  if (res.writableEnded) return;
  if (!res.headersSent) res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolveBody) => {
    const chunks = [];
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolveBody(v); } };
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => done(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => done(""));
    req.on("aborted", () => done(""));
    req.on("close", () => { if (!settled) done(""); });
  });
}

async function handleApi(req, res, url) {
  const path = url.pathname;
  if (req.method === "GET" && path === "/api/status") {
    isPortOpen(5173, (ekkoOpen) => {
      sendJson(res, 200, {
        ok: true,
        ekkopbr: ekkoOpen,
        ekkopbrUrl: "http://127.0.0.1:5173/",
        ueEditor: existsSync(UE_EDITOR),
        ueProject: existsSync(UE_PROJECT),
        projectDir: join(workbenchRoot, "SceneWorkbench"),
      });
    });
    return true;
  }

  if (req.method === "GET" && path === "/api/split/config") {
    const cfg = loadConfig();
    if (!cfg) { sendJson(res, 500, { ok: false, error: "config.json 缺失或损坏" }); return true; }
    sendJson(res, 200, {
      ok: true,
      comfly: { baseUrl: cfg.comfly?.baseUrl, imageModel: cfg.comfly?.imageModel, visionModel: cfg.comfly?.visionModel, imageSize: cfg.comfly?.imageSize, configured: !!(cfg.comfly?.apiKey) },
      tripo: { baseUrl: cfg.tripo?.baseUrl, model: cfg.tripo?.model, ready: !!(cfg.tripo?.apiKey) && !!cfg.tripo?.ready, textureQuality: cfg.tripo?.textureQuality },
      prompts: { splitSystem: cfg.prompts?.splitSystem, refineTemplate: cfg.prompts?.refineTemplate },
    });
    return true;
  }

  if (req.method === "POST" && path === "/api/split/config") {
    const cfg = loadConfig();
    if (!cfg) { sendJson(res, 500, { ok: false, error: "config.json 缺失或损坏" }); return true; }
    const body = JSON.parse((await readBody(req)) || "{}");
    if (typeof body.splitSystem === "string" && body.splitSystem.trim()) cfg.prompts.splitSystem = body.splitSystem.trim();
    if (typeof body.refineTemplate === "string" && body.refineTemplate.trim()) cfg.prompts.refineTemplate = body.refineTemplate.trim();
    try { writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf8"); }
    catch (e) { sendJson(res, 500, { ok: false, error: "保存 config.json 失败: " + String(e && e.message || e) }); return true; }
    sendJson(res, 200, { ok: true, prompts: cfg.prompts });
    return true;
  }

  if (req.method === "GET" && path === "/api/mcp/status") {
    isPortOpen(MCP_PORT, (open) => {
      sendJson(res, 200, { ok: true, mcpOnline: open, port: MCP_PORT });
    });
    return true;
  }

  if (req.method === "GET" && path === "/api/tripo/status") {
    const ids = (url.searchParams.get("task_ids") || "").split(",").filter(Boolean).slice(0, 50);
    if (!ids.length) { sendJson(res, 400, { ok: false, error: "task_ids 为空" }); return true; }
    tripoQueryTasks(ids).then((results) => sendJson(res, 200, { ok: true, results }))
      .catch((e) => sendJson(res, 500, { ok: false, error: String(e && e.message || e) }));
    return true;
  }

  if (req.method !== "POST") return false;

  if (path === "/api/ekkopbr/start") {
    if (!existsSync(EKKO_DIST) || !existsSync(join(EKKO_DIST, "index.html"))) {
      sendJson(res, 500, { ok: false, error: "EkkoPBR 目录不完整" });
      return true;
    }
    const startInject = () => {
      const child = spawn(process.execPath, [EKKO_INJECT_SERVER, EKKO_DIST, EKKO_INJECT_PID, "5173"], { detached: true, stdio: "ignore", windowsHide: true });
      child.unref();
      // 等待 pid 文件出现（最多 8 秒）
      const t0 = Date.now();
      const wait = setInterval(() => {
        if (existsSync(EKKO_INJECT_PID)) {
          clearInterval(wait);
          sendJson(res, 200, { ok: true, url: "http://127.0.0.1:5173/" });
        } else if (Date.now() - t0 > 8000) {
          clearInterval(wait);
          sendJson(res, 200, { ok: true, url: "http://127.0.0.1:5173/", note: "启动中，若浏览器未打开请稍候" });
        }
      }, 500);
    };
    isPortOpen(5173, (open) => {
      if (!open) { startInject(); return; }
      // 端口已被占用：若是工作台注入版则视为已启动；否则按端口释放后重启为注入版
      const pid = existsSync(EKKO_INJECT_PID) ? readFileSync(EKKO_INJECT_PID, "utf8").trim() : "";
      if (pid && /^\d+$/.test(pid)) {
        sendJson(res, 200, { ok: true, url: "http://127.0.0.1:5173/" });
      } else {
        const ps = "$c = Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue; if($c){ Stop-Process -Id $($c.OwningProcess) -Force -ErrorAction SilentlyContinue }";
        spawn("powershell.exe", ["-NoProfile", "-Command", ps], { windowsHide: true, stdio: "ignore" })
          .on("exit", () => { setTimeout(startInject, 800); });
      }
    });
    return true;
  }

  if (path === "/api/ekkopbr/stop") {
    let pid = "";
    if (existsSync(EKKO_INJECT_PID)) pid = readFileSync(EKKO_INJECT_PID, "utf8").trim();
    const cleanup = () => {
      try { unlinkSync(EKKO_INJECT_PID); } catch {}
    };
    if (pid && /^\d+$/.test(pid)) {
      spawn("taskkill.exe", ["/PID", pid, "/T", "/F"], { windowsHide: true, stdio: "ignore" })
        .on("exit", () => { cleanup(); });
    } else {
      // 兜底：按端口 5173 查杀监听进程
      const ps = "$c = Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue; if($c){ Stop-Process -Id $($c.OwningProcess) -Force -ErrorAction SilentlyContinue }";
      spawn("powershell.exe", ["-NoProfile", "-Command", ps], { windowsHide: true, stdio: "ignore" })
        .on("exit", () => { cleanup(); });
    }
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (path === "/api/ue/open") {
    if (!existsSync(UE_EDITOR) || !existsSync(UE_PROJECT)) {
      sendJson(res, 500, { ok: false, error: "UE 5.7 或工程不存在" });
      return true;
    }
    spawn(UE_EDITOR, [UE_PROJECT], { detached: true, stdio: "ignore" }).unref();
    sendJson(res, 200, { ok: true, note: "正在打开 UE 5.7 工程，首次打开请耐心等待" });
    return true;
  }

  if (path === "/api/folder/open") {
    const body = JSON.parse((await readBody(req)) || "{}");
    const map = {
      library: LIBRARY_DIR,
      textures: TEXTURES_DIR,
      content: CONTENT_DIR,
      backup: BACKUP_DIR,
      download: join(process.env.USERPROFILE || "C:\\Users\\Administrator", "Downloads"),
      project: join(workbenchRoot, "SceneWorkbench"),
    };
    const target = map[body.target];
    if (!target) { sendJson(res, 400, { ok: false, error: "unknown target" }); return true; }
    if (!existsSync(target)) { sendJson(res, 500, { ok: false, error: "目录不存在: " + target }); return true; }
    spawn("explorer.exe", [target], { detached: true, stdio: "ignore" }).unref();
    sendJson(res, 200, { ok: true, path: target });
    return true;
  }

  if (path === "/api/collect") {
    const ps = join(SCRIPTS_DIR, "collect_textures.ps1");
    execFile("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps], { windowsHide: true, timeout: 60000 }, (err, stdout, stderr) => {
      sendJson(res, err ? 500 : 200, { ok: !err, output: (stdout || "") + (stderr || "") });
    });
    return true;
  }

  if (path === "/api/backup") {
    const ps = join(SCRIPTS_DIR, "backup_project.ps1");
    execFile("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps], { windowsHide: true, timeout: 120000 }, (err, stdout, stderr) => {
      sendJson(res, err ? 500 : 200, { ok: !err, output: (stdout || "") + (stderr || "") });
    });
    return true;
  }

  // ===== 单模型拆分流程 =====
  if (path === "/api/split/ai") {
    const body = JSON.parse((await readBody(req)) || "{}");
    const cfg = loadConfig();
    if (!cfg || !cfg.comfly?.apiKey) { sendJson(res, 500, { ok: false, error: "comfly API 未配置" }); return true; }
    const base = body.promptTemplate || cfg.prompts?.splitSystem || "";
    // 附加要求：名称中英双份（name=英文，最终导入 UE 用；nameCn=中文）、建模描述用中文（不改动用户保存的模板原文）
    const system = base + "\n【附加要求】每项资产必须输出：name 字段=英文名称（English，如 Wooden Box、Red Cube、Stone Pillar，最终用于 UE 导入）；nameCn 字段=中文名称；category 字段=中文类别；prompt 字段=中文建模描述（描述形状/材质/颜色/细节，50 词以内）。";
    const imageInput = body.imageData || body.imageUrl;
    if (!imageInput) { sendJson(res, 400, { ok: false, error: "缺少参考图" }); return true; }
    try {
      const items = await comflySplit(cfg, system, imageInput);
      sendJson(res, 200, { ok: true, items });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: String(e && e.message || e) });
    }
    return true;
  }

  // 手动框选区域识别：对裁剪图反推英文名称/类别/3D建模提示词
  if (path === "/api/split/recognize") {
    const body = JSON.parse((await readBody(req)) || "{}");
    const cfg = loadConfig();
    if (!cfg || !cfg.comfly?.apiKey) { sendJson(res, 500, { ok: false, error: "comfly API 未配置" }); return true; }
    const imageInput = body.imageData || body.imageUrl;
    if (!imageInput) { sendJson(res, 400, { ok: false, error: "缺少框选区域图片" }); return true; }
    try {
      const info = await comflyRecognize(cfg, imageInput);
      sendJson(res, 200, { ok: true, name: info.name, nameCn: info.nameCn, category: info.category, prompt: info.prompt });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: String(e && e.message || e) });
    }
    return true;
  }

  // 建模描述翻译（中文 → 英文，供 AI 3D 建模使用）
  if (path === "/api/split/translate") {
    const body = JSON.parse((await readBody(req)) || "{}");
    const cfg = loadConfig();
    if (!cfg || !cfg.comfly?.apiKey) { sendJson(res, 500, { ok: false, error: "comfly API 未配置" }); return true; }
    const text = String(body.text || "").trim();
    if (!text) { sendJson(res, 400, { ok: false, error: "缺少待翻译文本" }); return true; }
    try {
      const translated = await comflyTranslate(cfg, text);
      sendJson(res, 200, { ok: true, translated });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: String(e && e.message || e) });
    }
    return true;
  }

  // 两轮精化：对局部放大图精确输出物体边界框
  if (path === "/api/split/refine-bbox") {
    const body = JSON.parse((await readBody(req)) || "{}");
    const cfg = loadConfig();
    if (!cfg || !cfg.comfly?.apiKey) { sendJson(res, 500, { ok: false, error: "comfly API 未配置" }); return true; }
    const imageInput = body.imageData || body.imageUrl;
    const objectName = String(body.objectName || "").trim();
    if (!imageInput || !objectName) { sendJson(res, 400, { ok: false, error: "缺少局部图或物体名称" }); return true; }
    try {
      const bbox = await comflyLocateBbox(cfg, imageInput, objectName);
      sendJson(res, 200, { ok: true, bbox });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: String(e && e.message || e) });
    }
    return true;
  }

  if (path === "/api/refine") {
    const body = JSON.parse((await readBody(req)) || "{}");
    const cfg = loadConfig();
    if (!cfg || !cfg.comfly?.apiKey) { sendJson(res, 500, { ok: false, error: "comfly API 未配置" }); return true; }
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) { sendJson(res, 400, { ok: false, error: "items 为空" }); return true; }
    const template = body.template || cfg.prompts?.refineTemplate;
    try {
      const results = await refineItems(cfg, items, template);
      sendJson(res, 200, { ok: true, results });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: String(e && e.message || e) });
    }
    return true;
  }

  // 单个资产重新生成细化图（保存本地 Assets\Models\<名称>\refined_<ts>.png）
  if (path === "/api/refine/regen") {
    const body = JSON.parse((await readBody(req)) || "{}");
    const cfg = loadConfig();
    if (!cfg || !cfg.comfly?.apiKey) { sendJson(res, 500, { ok: false, error: "comfly API 未配置" }); return true; }
    const name = sanitizeName(String(body.name || "").trim());
    const imageData = body.imageData;
    const srcPathIn = String(body.srcPath || "").trim();
    if (!name || (!imageData && !srcPathIn)) { sendJson(res, 400, { ok: false, error: "缺少名称或源图" }); return true; }
    const prompt = String(body.prompt || "").trim() || cfg.prompts?.refineTemplate || "";
    if (!prompt) { sendJson(res, 400, { ok: false, error: "缺少细化提示词" }); return true; }
    try {
      const dir0 = join(MODEL_ROOT, name);
      const current = join(dir0, "refined.png");
      const tmpImg = join(TMP_DIR, "regen_src_" + name + "_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8) + ".png");
      const srcPath = String(body.srcPath || "").trim();
      mkdirSync(TMP_DIR, { recursive: true });
      if (srcPath) {
        const resolved = resolve(srcPath);
        const relCheck = relative(dir0, resolved);
        if (relCheck.startsWith("..") || relCheck.includes("..\\") || relCheck.includes("../")) throw new Error("源图路径不合法");
        if (!existsSync(resolved) || !/^refined(_\d+)?\.png$/i.test(basename(resolved))) throw new Error("源图文件不存在");
        writeFileSync(tmpImg, readFileSync(resolved));
      }
      else if (existsSync(current)) { writeFileSync(tmpImg, readFileSync(current)); }
      else if (imageData) saveBase64Image(imageData, tmpImg);
      else throw new Error("缺少源图（无当前细化图且未传源图）");
      const url = await comflyEdits(cfg, tmpImg, prompt);
      let ts = Date.now();
      let dest = join(MODEL_ROOT, name, "refined_" + ts + ".png");
      // 同资产并发时时间戳可能撞名：递增直到文件名空闲（保持 refined_<数字>.png 命名）
      while (existsSync(dest)) { ts += 1; dest = join(MODEL_ROOT, name, "refined_" + ts + ".png"); }
      await downloadUrlToFile(url, dest);
      // 同步覆盖主图 refined.png：保证步骤①缩略图 / ③建模使用的都是最新生成图
      writeFileSync(join(MODEL_ROOT, name, "refined.png"), readFileSync(dest));
      sendJson(res, 200, { ok: true, path: dest, localUrl: "/assets/Models/" + name + "/refined_" + ts + ".png", ts });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: String(e && e.message || e) });
    }
    return true;
  }

  // 列出某资产的所有本地细化图（refined*.png，最新在前）
  if (path === "/api/refine/list") {
    const body = JSON.parse((await readBody(req)) || "{}");
    const name = sanitizeName(String(body.name || "").trim());
    if (!name) { sendJson(res, 400, { ok: false, error: "缺少资产名称" }); return true; }
    try {
      const dir = join(MODEL_ROOT, name);
      const list = [];
      if (existsSync(dir)) {
        const files = readdirSync(dir).filter((f) => /^refined(_\d+)?\.png$/i.test(f));
        const stats = files.map((f) => { const p = join(dir, f); return { f, p, m: statSync(p).mtimeMs }; });
        stats.sort((a, b) => b.m - a.m);
        for (const s of stats) {
          list.push({ path: s.p, name: s.f, primary: /^refined\.png$/i.test(s.f), localUrl: "/assets/Models/" + name + "/" + s.f, mtimeMs: Math.round(s.m) });
        }
      }
      sendJson(res, 200, { ok: true, list });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: String(e && e.message || e) });
    }
    return true;
  }

  // 选择某候选替换当前细化图（复制为 refined.png 保持主图一致）
  if (path === "/api/refine/select") {
    const body = JSON.parse((await readBody(req)) || "{}");
    const name = sanitizeName(String(body.name || "").trim());
    const selPath = String(body.path || "").trim();
    if (!name || !selPath) { sendJson(res, 400, { ok: false, error: "缺少名称或候选路径" }); return true; }
    try {
      const dir = join(MODEL_ROOT, name);
      const resolved = resolve(selPath);
      const relCheck = relative(dir, resolved);
      if (relCheck.startsWith("..") || relCheck.includes("..\\") || relCheck.includes("../")) throw new Error("候选路径不合法");
      if (!existsSync(resolved) || !/^refined(_\d+)?\.png$/i.test(basename(resolved))) throw new Error("候选文件不存在");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "refined.png"), readFileSync(resolved));
      sendJson(res, 200, { ok: true, localUrl: "/assets/Models/" + name + "/refined.png" });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: String(e && e.message || e) });
    }
    return true;
  }

  // 删除某历史候选图（仅 refined_<ts>.png；主图 refined.png 与资产本体不可删）
  if (path === "/api/refine/delete") {
    const body = JSON.parse((await readBody(req)) || "{}");
    const name = sanitizeName(String(body.name || "").trim());
    const delPath = String(body.path || "").trim();
    if (!name || !delPath) { sendJson(res, 400, { ok: false, error: "缺少名称或候选路径" }); return true; }
    try {
      const dir = join(MODEL_ROOT, name);
      const resolved = resolve(delPath);
      const relCheck = relative(dir, resolved);
      if (relCheck.startsWith("..") || relCheck.includes("..\\") || relCheck.includes("../")) throw new Error("候选路径不合法");
      if (!existsSync(resolved)) throw new Error("候选文件不存在");
      const bn = basename(resolved);
      if (!/^refined_\d+\.png$/i.test(bn)) throw new Error("仅可删除历史候选图，当前主图不可删除");
      unlinkSync(resolved);
      sendJson(res, 200, { ok: true, name: bn });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: String(e && e.message || e) });
    }
    return true;
  }

  if (path === "/api/tripo/upload") {
    const body = JSON.parse((await readBody(req)) || "{}");
    const cfg = loadConfig();
    if (!cfg || !cfg.tripo?.apiKey) { sendJson(res, 500, { ok: false, error: "Tripo API 未配置" }); return true; }
    if (cfg.tripo.ready === false) { sendJson(res, 200, { ok: false, error: "Tripo API key 尚未通过验证（config.json tripo.ready=false），请更新 key 后重启工作台" }); return true; }
    const filePath = body.imagePath;
    if (!filePath || !existsSync(filePath)) { sendJson(res, 400, { ok: false, error: "图片路径不存在" }); return true; }
    try {
      const token = await tripoUpload(cfg, filePath);
      sendJson(res, 200, { ok: true, fileToken: token });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: String(e && e.message || e) });
    }
    return true;
  }

  if (path === "/api/tripo/generate") {
    const body = JSON.parse((await readBody(req)) || "{}");
    const cfg = loadConfig();
    if (!cfg || !cfg.tripo?.apiKey) { sendJson(res, 500, { ok: false, error: "Tripo API 未配置" }); return true; }
    if (cfg.tripo.ready === false) { sendJson(res, 200, { ok: false, error: "Tripo API key 尚未通过验证（config.json tripo.ready=false），请更新 key 后重启工作台" }); return true; }
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) { sendJson(res, 400, { ok: false, error: "items 为空" }); return true; }
    try {
      const results = await tripoCreateTasks(cfg, items, body);
      sendJson(res, 200, { ok: true, results });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: String(e && e.message || e) });
    }
    return true;
  }

  if (path === "/api/tripo/download") {
    const body = JSON.parse((await readBody(req)) || "{}");
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) { sendJson(res, 400, { ok: false, error: "items 为空" }); return true; }
    try {
      const results = await tripoDownload(items);
      sendJson(res, 200, { ok: true, results });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: String(e && e.message || e) });
    }
    return true;
  }

  if (path === "/api/import") {
    const body = JSON.parse((await readBody(req)) || "{}");
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) { sendJson(res, 400, { ok: false, error: "items 为空" }); return true; }
    try {
      const results = await importToUnreal(items, body);
      sendJson(res, 200, { ok: true, results });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: String(e && e.message || e) });
    }
    return true;
  }

  return false;
}

function serve(request, response) {
  const url = new URL(request.url, "http://127.0.0.1");
  if (url.pathname.startsWith("/api/")) {
    handleApi(request, response, url).catch(() => { if (!response.writableEnded) sendJson(response, 500, { ok: false, error: "api error" }); });
    return;
  }
  let filePath;
  if (url.pathname.startsWith("/assets/")) {
    // 素材库静态映射（本地文件，不依赖网络）
    const decoded = decodeURIComponent(url.pathname.split("?")[0]);
    const candidate = resolve(LIBRARY_DIR, decoded.slice("/assets/".length));
    const relCheck = relative(LIBRARY_DIR, candidate);
    filePath = (relCheck.startsWith("..") || relCheck.includes("..\\") || relCheck.includes("../") || !existsSync(candidate)) ? null : candidate;
  } else {
    try { filePath = safePath(url.pathname); } catch { response.writeHead(400); response.end("Bad request"); return; }
    if (!filePath || !existsSync(filePath)) { filePath = join(wwwRoot, "index.html"); }
  }
  try {
    const body = readFileSync(filePath);
    response.writeHead(200, { "Content-Type": mimeTypes[extname(filePath).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-cache" });
    response.end(body);
  } catch { response.writeHead(404); response.end("Not found"); }
}

function cleanup() {
  for (const file of [portFile, pidFile]) { try { unlinkSync(file); } catch {} }
}

// ===== 单模型拆分 · helper =====
function saveBase64Image(dataUrl, filePath) {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || "");
  if (!m) throw new Error("图片格式不是 base64 data URL");
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, Buffer.from(m[2], "base64"));
  return filePath;
}

async function downloadUrlToFile(url, filePath, proxyUrl) {
  const useProxy = proxyUrl || tripoProxyUrl;
  const r = useProxy ? await proxyFetch(url, { timeoutMs: 120000 }) : await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!r.ok) throw new Error("下载失败 HTTP " + r.status + " " + url);
  const buf = Buffer.from(await r.arrayBuffer());
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, buf);
  return filePath;
}

function extractJsonArray(text) {
  if (!text) throw new Error("AI 未返回内容");
  let t = String(text).trim();
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = t.indexOf("[");
  const end = t.lastIndexOf("]");
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  const arr = JSON.parse(t);
  if (!Array.isArray(arr)) throw new Error("AI 返回的不是数组");
  return arr;
}

async function comflySplit(cfg, systemPrompt, imageInput) {
  const body = {
    model: cfg.comfly.visionModel || "gpt-4o",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: [
        { type: "text", text: "请分析这张场景参考图，按系统要求输出拆分清单。" },
        { type: "image_url", image_url: { url: imageInput } },
      ]},
    ],
    max_tokens: 3000,
  };
  const r = await proxyFetch(cfg.comfly.baseUrl + "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + cfg.comfly.apiKey },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("comfly 反推失败 HTTP " + r.status + ": " + (j.error?.message || JSON.stringify(j).slice(0, 300)));
  const text = j.choices?.[0]?.message?.content || "";
  const raw = extractJsonArray(text);
  return raw.map((x, i) => {
    let bbox = null;
    if (Array.isArray(x.bbox) && x.bbox.length === 4) {
      const b = x.bbox.map(Number);
      if (b.every(Number.isFinite)) bbox = b.map((v) => Math.max(0, Math.min(1000, v)));
    } else if (typeof x.bbox === "string") {
      const nums = (x.bbox.match(/-?\d+(\.\d+)?/g) || []).map(Number).slice(0, 4);
      if (nums.length === 4 && nums.every(Number.isFinite)) bbox = nums.map((v) => Math.max(0, Math.min(1000, v)));
    }
    return {
      id: "item_" + Date.now() + "_" + i,
      name: String(x.name || ("Asset" + (i + 1))),
      nameCn: String(x.nameCn || x.name || ("资产" + (i + 1))),
      prompt: String(x.prompt || ""),
      category: String(x.category || "其他"),
      bbox,
    };
  });
}

async function comflyRecognize(cfg, imageInput) {
  const system = "你是资产识别专家。识别图片中的主体物体，输出一个 JSON 对象：{\"name\":\"英文名称\",\"nameCn\":\"中文名称\",\"category\":\"类别\",\"prompt\":\"中文建模描述\"}。要求：name 使用英文（English）且简洁（1-4 个单词，如 Wooden Box、Red Cube、Stone Pillar，最终用于 UE 导入）；nameCn 使用中文名称；category 从 家具/道具/建筑/植被/其他 中选择；prompt 用中文描述该物体的形状、材质、颜色、细节，50 词以内，适合作为 AI 3D 建模的输入。只输出 JSON 对象，不要输出任何解释或 markdown。";
  const body = {
    model: cfg.comfly.visionModel || "gpt-4o",
    messages: [
      { role: "system", content: system },
      { role: "user", content: [
        { type: "text", text: "识别这张图片中的资产。" },
        { type: "image_url", image_url: { url: imageInput } },
      ]},
    ],
    max_tokens: 600,
  };
  const r = await proxyFetch(cfg.comfly.baseUrl + "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + cfg.comfly.apiKey },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("comfly 识别失败 HTTP " + r.status + ": " + (j.error?.message || JSON.stringify(j).slice(0, 200)));
  const text = j.choices?.[0]?.message?.content || "";
  const cleaned = String(text).trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  let obj = null;
  try { obj = JSON.parse(cleaned); } catch {}
  if (!obj) {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) { try { obj = JSON.parse(m[0]); } catch {} }
  }
  if (!obj || typeof obj !== "object") throw new Error("AI 未返回有效识别结果");
  return {
    name: String(obj.name || "").trim() || "Asset",
    nameCn: String(obj.nameCn || "").trim() || String(obj.name || "").trim() || "资产",
    category: ["家具", "道具", "建筑", "植被", "其他"].includes(String(obj.category || "").trim()) ? String(obj.category).trim() : "其他",
    prompt: String(obj.prompt || "").trim(),
  };
}

async function comflyTranslate(cfg, text) {
  const system = "你是中英翻译助手。将用户输入翻译为英文，直接输出翻译结果，不要输出任何解释、引号或 markdown。";
  const body = {
    model: cfg.comfly.visionModel || "gpt-4o",
    messages: [
      { role: "system", content: system },
      { role: "user", content: String(text || "").trim() },
    ],
    max_tokens: 400,
  };
  const r = await proxyFetch(cfg.comfly.baseUrl + "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + cfg.comfly.apiKey },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("comfly 翻译失败 HTTP " + r.status + ": " + (j.error?.message || JSON.stringify(j).slice(0, 200)));
  const out = j.choices?.[0]?.message?.content || "";
  if (!out.trim()) throw new Error("AI 未返回翻译结果");
  return out.trim();
}

async function comflyLocateBbox(cfg, imageInput, objectName) {
  const system = "你是精确物体定位器。图片中含有一个主体物体，请输出该物体在本图中的完整位置边界框，格式为 JSON：{\"bbox\":[x0,y0,x1,y1]}，坐标为千分比即0-1000，x0/y0为左上角、x1/y1为右下角。要求：框必须包含物体完整主体（若物体部分超出画面边缘则框到画面边缘）；若物体是完整几何形状（圆形、椭圆形、矩形、三角形、多边形等），框必须包含其完整外形边界、宽高比与物体形状一致，不得只框住局部或中间区域；尽量贴近物体本体、不含无关背景，误差不超过15。只输出 JSON 对象，不要输出任何解释或 markdown。";
  const body = {
    model: cfg.comfly.visionModel || "gpt-4o",
    messages: [
      { role: "system", content: system },
      { role: "user", content: [
        { type: "text", text: "图中主体物体是：" + objectName + "。请给出它的精确边界框。" },
        { type: "image_url", image_url: { url: imageInput } },
      ]},
    ],
    max_tokens: 300,
  };
  const r = await proxyFetch(cfg.comfly.baseUrl + "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + cfg.comfly.apiKey },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("comfly 定位失败 HTTP " + r.status + ": " + (j.error?.message || JSON.stringify(j).slice(0, 200)));
  const text = j.choices?.[0]?.message?.content || "";
  let bbox = null;
  try {
    const cleaned = String(text).trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    const obj = JSON.parse(cleaned);
    if (Array.isArray(obj.bbox) && obj.bbox.length === 4) {
      const b = obj.bbox.map(Number);
      if (b.every(Number.isFinite)) bbox = b.map((v) => Math.max(0, Math.min(1000, v)));
    }
  } catch {}
  if (!bbox) {
    const nums = (String(text).match(/-?\d+(\.\d+)?/g) || []).map(Number).slice(0, 4);
    if (nums.length === 4 && nums.every(Number.isFinite)) bbox = nums.map((v) => Math.max(0, Math.min(1000, v)));
  }
  if (!bbox) throw new Error("AI 未返回有效 bbox");
  return bbox;
}

async function comflyEdits(cfg, imagePath, prompt) {
  // 走系统代理（proxyFetch 不支持原生 FormData，手工构造 multipart Buffer）
  const boundary = "----WBFormBoundary" + Date.now();
  const buf = readFileSync(imagePath);
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${cfg.comfly.imageModel || "gpt-image-2"}\r\n`, "utf8"),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="prompt"\r\n\r\n${prompt}\r\n`, "utf8"),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="size"\r\n\r\n${cfg.comfly.imageSize || "1024x1024"}\r\n`, "utf8"),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="n"\r\n\r\n1\r\n`, "utf8"),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="ref.png"\r\nContent-Type: image/png\r\n\r\n`, "utf8"),
    buf,
    Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"),
  ]);
  const r = await proxyFetch(cfg.comfly.baseUrl + "/images/edits", {
    method: "POST",
    headers: { Authorization: "Bearer " + cfg.comfly.apiKey, "Content-Type": "multipart/form-data; boundary=" + boundary },
    body,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("comfly 细化失败 HTTP " + r.status + ": " + (j.error?.message || JSON.stringify(j).slice(0, 300)));
  const url = j.data?.[0]?.url;
  if (!url) throw new Error("comfly 细化未返回图片 URL");
  return url;
}

async function refineItems(cfg, items, template) {
  mkdirSync(TMP_DIR, { recursive: true });
  // 并发执行：每个资产独立请求 comfly，互不阻塞；单个失败不影响其他
  return Promise.all(items.map(async (it) => {
    const name = sanitizeName(it.name);
    const tmpImg = join(TMP_DIR, "refine_src_" + name + "_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8) + ".png");
    try {
      if (it.imageData) saveBase64Image(it.imageData, tmpImg);
      else if (it.imagePath && existsSync(it.imagePath)) { mkdirSync(TMP_DIR, { recursive: true }); writeFileSync(tmpImg, readFileSync(it.imagePath)); }
      else return { id: it.id, name: it.name, status: "error", error: "缺少细化源图" };
      const url = await comflyEdits(cfg, tmpImg, template || cfg.prompts?.refineTemplate);
      const dest = join(MODEL_ROOT, name, "refined.png");
      await downloadUrlToFile(url, dest);
      return { id: it.id, name: it.name, status: "ok", path: dest, url, localUrl: "/assets/Models/" + name + "/refined.png" };
    } catch (e) {
      return { id: it.id, name: it.name, status: "error", error: String(e && e.message || e) };
    }
  }));
}

async function tripoUpload(cfg, filePath) {
  const buf = readFileSync(filePath);
  const boundary = "----WBFormBoundary" + Date.now();
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="ref.png"\r\nContent-Type: image/png\r\n\r\n`, "utf8"),
    buf,
    Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"),
  ]);
  const v2Base = cfg.tripo.baseUrl.replace(/\/v3\/?$/, "");
  const tries = [
    { url: cfg.tripo.baseUrl + "/files", name: "v3/files" },
    { url: v2Base + "/v2/openapi/upload", name: "v2/openapi/upload" },
  ];
  for (const t of tries) {
    try {
      const r = await tripoFetch(t.url, { method: "POST", headers: { Authorization: "Bearer " + cfg.tripo.apiKey, "Content-Type": "multipart/form-data; boundary=" + boundary }, body });
      const j = await r.json().catch(() => ({}));
      if (r.ok && (j.data?.file_token || j.data?.file_token_id)) {
        return j.data.file_token || j.data.file_token_id;
      }
      if (r.status === 401) throw new Error("Tripo API key 无效（401），请在 config.json 更新 tripo.apiKey");
      if (r.status === 404 || r.status === 405) continue; // 接口不存在 → 试下一个
      throw new Error("Tripo 上传失败 " + t.name + " HTTP " + r.status + ": " + (j.message || JSON.stringify(j).slice(0, 200)));
    } catch (e) {
      if (/401|API key/.test(String(e.message))) throw e;
      if (/404|405|接口不存在/.test(String(e.message))) continue;
      throw e;
    }
  }
  throw new Error("Tripo 上传接口不可用（v3/v2 均失败），请确认 tripo.baseUrl 或改用公网图片 URL");
}

async function tripoCreateTasks(cfg, items, opts) {
  const results = [];
  for (const it of items) {
    let input = it.fileToken || it.imageUrl;
    if (!input) {
      // 自动定位本地细化图：Assets\Models\<name>\refined.png（无则取该目录下任意 png）
      const name = sanitizeName(it.name);
      const dir = join(MODEL_ROOT, name);
      let src = join(dir, "refined.png");
      if (!existsSync(src) && existsSync(dir)) {
        const cands = readdirSync(dir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
        src = cands.length ? join(dir, cands[0]) : null;
      }
      if (src && existsSync(src)) {
        try { input = await tripoUpload(cfg, src); }
        catch (e) { results.push({ id: it.id, name: it.name, status: "error", error: "上传参考图失败: " + String(e && e.message || e) }); continue; }
      }
    }
    if (!input) { results.push({ id: it.id, name: it.name, status: "error", error: "缺少输入图（请先完成步骤2 高清细化）" }); continue; }
    const body = {
      input,
      model: opts.model || cfg.tripo.model,
      texture: true,
      pbr: cfg.tripo.pbr !== false,
      face_limit: opts.faceLimit || cfg.tripo.faceLimit,
      texture_quality: opts.textureQuality || cfg.tripo.textureQuality || "standard",
    };
    try {
      const r = await tripoFetch(cfg.tripo.baseUrl + "/generation/image-to-model", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + cfg.tripo.apiKey },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.code !== 0) throw new Error("Tripo 建任务失败 HTTP " + r.status + ": " + (j.message || JSON.stringify(j).slice(0, 200)));
      results.push({ id: it.id, name: it.name, status: "queued", task_id: j.data?.task_id });
    } catch (e) {
      results.push({ id: it.id, name: it.name, status: "error", error: String(e && e.message || e) });
    }
  }
  return results;
}

async function tripoQueryTasks(ids) {
  const cfg = loadConfig();
  if (!cfg || !cfg.tripo?.apiKey) throw new Error("Tripo API 未配置");
  const results = [];
  for (const tid of ids) {
    try {
      const r = await tripoFetch(cfg.tripo.baseUrl + "/tasks/" + encodeURIComponent(tid), {
        headers: { Authorization: "Bearer " + cfg.tripo.apiKey },
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.code !== 0) { results.push({ task_id: tid, status: "error", error: (j.message || "HTTP " + r.status) }); continue; }
      const d = j.data || {};
      results.push({
        task_id: tid,
        status: d.status,
        progress: d.progress,
        error_message: d.error_message,
        model_url: d.output?.model_url,
        rendered_image_url: d.output?.rendered_image_url,
        credits_consumed: d.credits_consumed,
      });
    } catch (e) {
      results.push({ task_id: tid, status: "error", error: String(e && e.message || e) });
    }
  }
  return results;
}

async function tripoDownload(items) {
  const results = [];
  for (const it of items) {
    try {
      const q = await tripoQueryTasks([it.task_id]);
      const d = q[0];
      if (!d || d.status !== "success") { results.push({ id: it.id, name: it.name, status: d?.status || "error", error: d?.error_message || "任务未完成" }); continue; }
      const name = sanitizeName(it.name);
      const cat = sanitizeName(it.category || "其他");
      const glbPath = join(MODEL_ROOT, name, name + ".glb");
      await downloadUrlToFile(d.model_url, glbPath, tripoProxyUrl);
      let previewPath = null;
      if (d.rendered_image_url) { previewPath = join(MODEL_ROOT, name, "preview.png"); await downloadUrlToFile(d.rendered_image_url, previewPath, tripoProxyUrl); }
      // 归位到工程 Content
      const contentPath = join(CONTENT_MESHES, cat, name, name + ".glb");
      mkdirSync(dirname(contentPath), { recursive: true });
      writeFileSync(contentPath, readFileSync(glbPath));
      results.push({ id: it.id, name: it.name, status: "ok", glbPath, previewPath, contentPath });
    } catch (e) {
      results.push({ id: it.id, name: it.name, status: "error", error: String(e && e.message || e) });
    }
  }
  return results;
}

function mcpCall(toolName, args, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    if (!existsSync(MCP_PYTHON) || !existsSync(MCP_SERVER_PY)) { reject(new Error("UnrealMCP Server 未找到")); return; }
    const child = spawn(MCP_PYTHON, [MCP_SERVER_PY], {
      env: { ...process.env, DYNAMIC_MODE: "1", ENABLED_MODULES: "editor,asset,import" },
      windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
    });
    let buf = "";
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; child.kill(); reject(new Error("MCP 调用超时")); } }, timeoutMs);
    child.stdout.on("data", (d) => {
      buf += d.toString("utf8");
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx); buf = buf.slice(idx + 1);
        if (!line.trim()) continue;
        let msg; try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id === "init") {
          child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
          child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: "call", method: "tools/call", params: { name: toolName, arguments: args } }) + "\n");
        } else if (msg.id === "call") {
          clearTimeout(timer);
          if (done) return; done = true;
          child.stdin.end();
          setTimeout(() => { try { child.kill(); } catch {} }, 500);
          if (msg.error) reject(new Error("MCP 工具错误: " + JSON.stringify(msg.error)));
          else resolve(msg.result);
        }
      }
    });
    child.stderr.on("data", () => {});
    child.on("exit", () => { if (!done) { done = true; clearTimeout(timer); reject(new Error("MCP 进程提前退出")); } });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: "init", method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "ue-workbench", version: "1.0" } } }) + "\n");
  });
}

async function importToUnreal(items, opts) {
  // 一期通道：模型落盘归位 + 生成 UE 编辑器导入脚本（不依赖 MCP 工具，C++ 插件暂无资产导入命令）
  const staged = [];
  const online = await new Promise((r) => isPortOpen(MCP_PORT, r));
  for (const it of items) {
    const name = sanitizeName(it.name);
    const cat = sanitizeName(it.category || "其他");
    const srcGlb = join(MODEL_ROOT, name, name + ".glb");
    const contentPath = join(CONTENT_MESHES, cat, name, name + ".glb");
    if (!existsSync(srcGlb) && !existsSync(contentPath)) {
      staged.push({ id: it.id, name: it.name, status: "missing", error: "模型文件不存在（请先完成 Tripo 下载）" });
      continue;
    }
    mkdirSync(dirname(contentPath), { recursive: true });
    if (existsSync(srcGlb)) writeFileSync(contentPath, readFileSync(srcGlb));
    staged.push({ id: it.id, name: it.name, category: cat, status: "staged", contentPath });
  }
  // 生成幂等导入脚本（编辑器 Python：批量导入 glb → 放置到关卡 → Outliner 归位）
  const scriptPath = join(workbenchRoot, "SceneWorkbench", "Content", "Python", "import_models.py");
  const ready = staged.filter((s) => s.status === "staged");
  const rows = ready.map((s) => `    {"name": ${JSON.stringify(s.name)}, "category": ${JSON.stringify(s.category)}, "location": [${opts.location || "0.0, 0.0, 0.0"}]},`).join("\n");
  const script = `# -*- coding: utf-8 -*-
"""由 UE 工作台生成：批量导入 glb 模型并放入当前关卡（幂等）。
在 UE 编辑器内执行：打开 Output Log -> Cmd 切到 Python -> py "${scriptPath.replace(/\\/g, "/")}"
"""
import unreal

MODELS = [
${rows}
]
DEST_ROOT = "/Game/Assets/Meshes"

def main():
    tools = unreal.AssetToolsHelpers.get_asset_tools()
    editor = unreal.EditorLevelLibrary
    imported = []
    for m in MODELS:
        name = m["name"]; cat = m["category"]; loc = unreal.Vector(*m["location"])
        src = unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_content_dir()) + "Assets/Meshes/" + cat + "/" + name + "/" + name + ".glb"
        if not unreal.Paths.file_exists(src):
            unreal.log_warning("[import_models] 文件不存在，跳过: " + src); continue
        dest = DEST_ROOT + "/" + cat + "/" + name
        unreal.EditorAssetLibrary.make_directory(dest)
        task = unreal.AssetImportTask()
        task.set_editor_property("filename", src)
        task.set_editor_property("destination_path", dest)
        task.set_editor_property("automated", True)
        task.set_editor_property("replace_existing", True)
        task.set_editor_property("save", True)
        tools.import_asset_tasks([task])
        paths = task.get_editor_property("imported_object_paths")
        if not paths:
            unreal.log_warning("[import_models] 导入无结果: " + name); continue
        asset_path = paths[0]
        actor = editor.spawn_actor_from_class(unreal.StaticMeshActor, loc, unreal.Rotator(0, 0, 0))
        actor.set_actor_label(name)
        sm = actor.static_mesh_component
        sm.set_static_mesh(unreal.load_asset(asset_path))
        actor.set_folder_path(cat)
        imported.append(name)
        unreal.log("[import_models] OK: " + name + " -> " + asset_path)
    editor.save_current_level()
    unreal.log("[import_models] 完成，共导入 " + str(len(imported)) + " 个模型: " + ", ".join(imported))

if __name__ == "__main__":
    main()
`;
  mkdirSync(dirname(scriptPath), { recursive: true });
  writeFileSync(scriptPath, script, "utf8");
  return {
    mode: "staged",
    note: "模型已归位到工程 Content\\Assets\\Meshes（自动命名+分类）。UE 编辑器打开后，运行 Content\\Python\\import_models.py 即可批量导入并放入关卡（Outliner 按类别归位）。",
    mcpOnline: online,
    scriptPath,
    items: staged,
  };
}

function listen(port) {
  const server = createServer(serve);
  server.once("error", (error) => {
    if (error.code === "EADDRINUSE" && port < startPort + 20) { listen(port + 1); return; }
    console.error(error); cleanup(); process.exit(1);
  });
  server.listen(port, "127.0.0.1", () => {
    writeFileSync(portFile, String(port), "utf8");
    writeFileSync(pidFile, String(process.pid), "utf8");
    console.log(`UE场景制作工作台运行中: http://127.0.0.1:${port}/`);
  });
}

process.on("SIGINT", () => { cleanup(); process.exit(0); });
process.on("SIGTERM", () => { cleanup(); process.exit(0); });
listen(startPort);
