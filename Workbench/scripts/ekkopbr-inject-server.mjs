// EkkoPBR 注入版静态服务（工作台托管）
// 作用：在 127.0.0.1:5173 提供与 EkkoPBR 原版一致的页面，仅对 HTML 响应注入一段拖拽脚本：
//       把图片直接拖到材质预览窗口（或页面任意位置）→ 自动写入隐藏 file input 并触发 change，
//       即导入输入源。不修改 EkkoPBR 磁盘上的任何文件。
// 用法：node ekkopbr-inject-server.mjs <dist目录> <pid文件> [端口]
import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

const distRoot = resolve(process.argv[2]);
const pidFile = process.argv[3] ? resolve(process.argv[3]) : null;
const PORT = Number(process.argv[4]) || 5173;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

// ---- 注入脚本：材质预览窗口拖拽导入输入源（capture 阶段拦截 + 常驻标识 + 未就绪重试） ----
const INJECT = [
  "(function(){",
  "var INPUT='input[type=\"file\"][accept*=\"image\"]',tip=null,tipTimer=null,badge=null,retry=0;",
  "function getZone(){var c=document.querySelector('canvas');if(c){var p=c.parentElement;for(var k=0;k<8&&p;k++){if(p.offsetHeight>160)return p;p=p.parentElement;}}return document.body;}",
  "function show(msg,ok){if(!tip){tip=document.createElement('div');tip.style.cssText='position:fixed;top:14px;right:14px;z-index:99999;padding:10px 16px;border-radius:8px;font:13px/1.5 \"Microsoft YaHei\",sans-serif;color:#fff;box-shadow:0 4px 14px rgba(0,0,0,.5);pointer-events:none;transition:opacity .3s';document.body.appendChild(tip);}tip.textContent=msg;tip.style.background=ok?'#15803d':'#b91c1c';tip.style.opacity='1';clearTimeout(tipTimer);tipTimer=setTimeout(function(){tip.style.opacity='0';},2600);}",
  "function showBadge(){if(badge)return;badge=document.createElement('div');badge.style.cssText='position:fixed;right:14px;bottom:14px;z-index:99999;padding:7px 12px;border-radius:20px;font:12px/1 \"Microsoft YaHei\",sans-serif;color:#d1fae5;background:rgba(6,78,59,.88);border:1px solid rgba(52,211,153,.5);box-shadow:0 3px 10px rgba(0,0,0,.4);pointer-events:none';badge.innerHTML='<span style=\"color:#34d399;margin-right:5px\">●</span>拖拽导入已启用';document.body.appendChild(badge);}",
  "function isFileDrag(e){var d=e.dataTransfer;return !!(d&&d.types&&Array.prototype.indexOf.call(d.types,'Files')>=0);}",
  "function on(){var z=getZone();z.style.outline='3px dashed #f87171';z.style.outlineOffset='-3px';z.style.transition='outline .12s';}",
  "function off(){var z=getZone();z.style.outline='';z.style.outlineOffset='';}",
  "function inject(f){var i=document.querySelector(INPUT);if(!i){if(retry<10){retry++;setTimeout(function(){inject(f);},500);return;}show('输入源未就绪，请稍后重试',false);return;}retry=0;try{var dt=new DataTransfer();dt.items.add(f);i.files=dt.files;i.dispatchEvent(new Event('change',{bubbles:true}));show('已导入输入源：'+f.name,true);}catch(err){show('导入失败：'+err.message,false);}}",
  "document.addEventListener('dragover',function(e){if(isFileDrag(e)){e.preventDefault();on();}},true);",
  "document.addEventListener('dragenter',function(e){if(isFileDrag(e)){e.preventDefault();on();}},true);",
  "document.addEventListener('dragleave',function(e){if(!e.relatedTarget)off();},true);",
  "document.addEventListener('drop',function(e){if(!isFileDrag(e)||!e.dataTransfer.files||!e.dataTransfer.files.length)return;e.preventDefault();e.stopPropagation();off();var f=e.dataTransfer.files[0];if(!/^image\\/(png|jpe?g|webp)$/i.test(f.type)){show('仅支持 JPG / PNG / WebP：'+f.name,false);return;}inject(f);},true);",
  "window.addEventListener('load',function(){showBadge();});",
  "setTimeout(function(){showBadge();},600);",
  "})();",
].join("\n");

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const requested = decoded === "/" ? "/index.html" : decoded;
  const candidate = resolve(distRoot, "." + requested);
  const rel = relative(distRoot, candidate);
  return rel.startsWith("..") || rel.includes("..\\") || rel.includes("../") ? null : candidate;
}

const server = createServer((req, res) => {
  let filePath;
  try { filePath = safePath(req.url || "/"); } catch { res.writeHead(400); res.end("Bad request"); return; }
  if (!filePath || !existsSync(filePath)) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); res.end("Not found"); return; }
  try {
    let body = readFileSync(filePath);
    const ct = mimeTypes[extname(filePath).toLowerCase()] || "application/octet-stream";
    if (ct.includes("text/html")) {
      let html = body.toString("utf8");
      // 源文件已内联拖拽脚本（2026-11-01 直改 dist/index.html）时不再重复注入
      if (!html.includes("拖拽导入已启用")) {
        const script = "<script>\n" + INJECT + "\n</" + "script>";
        const idx = html.lastIndexOf("</body>");
        html = idx >= 0 ? html.slice(0, idx) + script + html.slice(idx) : html + script;
      }
      body = Buffer.from(html, "utf8");
    }
    res.writeHead(200, { "Content-Type": ct, "Cache-Control": "no-cache" });
    res.end(body);
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Server error: " + err.message);
  }
});

server.once("error", (err) => {
  console.error("inject-ekkopbr listen error:", err.message);
  process.exit(1);
});

server.listen(PORT, "127.0.0.1", () => {
  if (pidFile) writeFileSync(pidFile, String(process.pid), "utf8");
  console.log(`EkkoPBR(inject) running: http://127.0.0.1:${PORT}/`);
});

process.on("SIGTERM", () => { process.exit(0); });
process.on("SIGINT", () => { process.exit(0); });
