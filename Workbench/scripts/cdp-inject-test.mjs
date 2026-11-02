// CDP 注入验证脚本 v2：在注入版 EkkoPBR 页面(5173)模拟「拖拽图片到预览窗口」→ 验证输入源载入
// 用法：node cdp-inject-test.mjs
// 前置：Chrome 以 --remote-debugging-port=9222 打开 http://127.0.0.1:5173/
const PORT = 9222;

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const page = targets.find((t) => t.type === 'page' && t.url.includes('5173'));
if (!page) {
  console.error('PAGE_NOT_FOUND: 未找到 EkkoPBR(5173) 页面 target，请确认调试 Chrome 已打开 5173');
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
let msgId = 0;
const pending = new Map();

function send(method, params) {
  return new Promise((resolve, reject) => {
    const mid = ++msgId;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  }
};

await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });

async function evalJS(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return 'EXCEPTION: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value !== undefined ? r.result.value : (r.result?.description || JSON.stringify(r.result));
}

// STEP1：等待渲染，探测注入脚本与隐藏 file input
await new Promise((s) => setTimeout(s, 4000));
const probe = await evalJS(`(()=>{
  const i=document.querySelector('input[type="file"][accept*="image"]');
  const html=document.documentElement.outerHTML;
  return JSON.stringify({title:document.title, hasInput:!!i, accept:i?i.accept:'', scripts:document.scripts.length, hasIsFileDrag:html.includes('isFileDrag')});
})()`);
console.log('STEP1_PROBE:', probe);

// STEP1.5：模拟真实拖拽 dragover（真实场景 dragover 时 files 可为空，仅 types 含 Files）→ 必须 preventDefault 允许投放
const dv = await evalJS(`(async()=>{
  const dt=new DataTransfer();
  dt.items.add(new File([new Uint8Array([1])],'t.png',{type:'image/png'}));
  const ev=new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dt});
  document.dispatchEvent(ev);
  return JSON.stringify({defaultPrevented:ev.defaultPrevented, types:Array.from(dt.types)});
})()`);
console.log('STEP1_5_DRAGOVER:', dv);

// STEP2：模拟真实拖拽 drop —— 用页面自身资产构造真实图片 File + DataTransfer + DragEvent
const inject = await evalJS(`(async()=>{
  const i=document.querySelector('input[type="file"][accept*="image"]');
  if(!i) return 'NO_INPUT';
  const r=await fetch('/assets/brand-icon-2MVkIIGa.png');
  if(!r.ok) return 'FETCH_FAIL '+r.status;
  const blob=await r.blob();
  const f=new File([blob],'cdp-drop.png',{type:'image/png'});
  const dt=new DataTransfer();
  dt.items.add(f);
  // 与注入脚本监听器相同的 drop 事件（document 级，bubbles）
  const ev=new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt});
  document.dispatchEvent(ev);
  await new Promise(s=>setTimeout(s,2500));
  return 'DISPATCHED files='+i.files.length+' name='+(i.files[0]?i.files[0].name:'-')+' size='+f.size;
})()`);
console.log('STEP2_DROP:', inject);

// STEP3：验证输入源已载入（属性面板文本 + data 图片）+ 常驻徽标
const verify = await evalJS(`(()=>{
  const dataImgs=document.querySelectorAll('img[src^="data:image"]');
  const hits=[];
  document.querySelectorAll('div,span,p,label,button').forEach(el=>{
    const t=(el.textContent||'').trim();
    if(t && t.length<60 && (t.includes('cdp-drop')||t.includes('源图')||t.includes('已导入'))) hits.push(t);
  });
  let badge='';
  document.querySelectorAll('div').forEach(el=>{
    const t=(el.textContent||'').trim();
    if(t && t.indexOf('拖拽导入已启用')>=0) badge=t;
  });
  return JSON.stringify({dataImgCount:dataImgs.length, badge:badge, hits:[...new Set(hits)].slice(0,10)});
})()`);
console.log('STEP3_VERIFY:', verify);

ws.close();
console.log('DONE');
