/** Independent login shell: anonymous visitors never load business bundles or data. */
export function renderAdminLoginPage(): string {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>管理员登录 · 海之子研判工作台</title>
<style>
*{box-sizing:border-box}body{margin:0;font:16px/1.6 Inter,"Segoe UI","Microsoft YaHei",sans-serif;color:#243d3b;background:radial-gradient(ellipse at 18% 10%,#dfeee7,transparent 60%),#f4f7f5}main{min-height:100dvh;display:grid;place-items:center;padding:32px 20px}.card{width:min(100%,460px);padding:38px;background:#fff;border:1px solid #dce8e2;border-radius:20px;box-shadow:0 16px 60px #2444380d}.brand{display:flex;align-items:center;gap:12px;margin-bottom:30px;font-size:17px;font-weight:600;color:#286b65}.brand>span{display:grid;place-items:center;width:42px;height:42px;border-radius:12px;background:#286b65;color:#fff;font-size:20px}h1{margin:0;font-size:28px;line-height:1.4}.intro{margin:8px 0 26px;color:#61756f}.description{margin:0 0 24px;font-size:15px;line-height:1.8;color:#4b655e}label{display:block;margin:18px 0 8px;font-weight:600}input{width:100%;min-height:48px;padding:11px 13px;border:1px solid #bfcfc8;border-radius:9px;background:#fbfcfb;color:#243d3b;font:inherit}#message{min-height:26px;margin:14px 0 8px;font-size:15px;line-height:1.7;color:#a43d36}button{width:100%;min-height:48px;border:0;border-radius:9px;background:#286b65;color:#fff;padding:11px 18px;font:inherit;font-weight:600;cursor:pointer}button:hover:not(:disabled){background:#205a55}button:disabled{opacity:.6;cursor:wait}input:focus-visible,button:focus-visible{outline:3px solid #86b4a6;outline-offset:3px}@media(max-width:560px){.card{padding:28px 24px}}
</style></head><body><main><section class="card" aria-labelledby="title"><div class="brand"><span aria-hidden="true">海</span><p>海之子 · 建工 AI</p></div><h1 id="title">管理员登录</h1><p class="intro">老旧小区改造研判工作台</p><form id="login" method="post" action="/api/auth/login"><p class="description">登录后查看和管理项目资料、研判结果与改造方案。</p><label for="username">管理员账号</label><input id="username" name="username" autocomplete="username" maxlength="120" required autofocus><label for="password">密码</label><input id="password" name="password" type="password" autocomplete="current-password" required><p id="message" role="alert" aria-live="polite"></p><button id="submit" type="submit">登录工作台</button></form><noscript><p>请启用浏览器 JavaScript 后登录。</p></noscript></section></main>
<script>
const form=document.getElementById('login'),button=document.getElementById('submit'),message=document.getElementById('message'),passwordField=document.getElementById('password');
form.addEventListener('submit',async function(event){
  event.preventDefault();if(button.disabled)return;
  const username=document.getElementById('username').value.trim(),password=passwordField.value;
  passwordField.value='';button.disabled=true;button.textContent='正在登录…';message.textContent='';
  const controller=new AbortController(),timer=setTimeout(function(){controller.abort()},15000);
  try{
    const response=await fetch('/api/auth/login',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-Requested-With':'haizhizi'},body:JSON.stringify({username:username,password:password}),signal:controller.signal});
    const result=await response.json().catch(function(){return null});
    if(!response.ok){message.textContent=response.status===429?'尝试次数过多，请稍后再试。':response.status===401?'账号或密码不正确。':'登录失败，请稍后重试。';return}
    if(!result||!result.authentication||result.authentication.enabled!==true||result.authentication.role!=='admin'){message.textContent='无法确认管理员会话，请刷新重试。';return}
    location.reload();
  }catch(error){message.textContent='连接工作台失败，请检查网络后重试。'}finally{clearTimeout(timer);button.disabled=false;button.textContent='登录工作台'}
});
</script></body></html>`
}
