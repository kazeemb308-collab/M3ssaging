const root=document.querySelector('#app');
import('./app-v2.js').catch(error=>{
  console.error('M3ssaging startup failed:',error);
  root.innerHTML=`<main style="min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;font-family:Arial,sans-serif;background:#fff"><section style="width:min(420px,100%);text-align:center"><h1 style="color:#075e54">Me and You</h1><p style="color:#667781">The app could not start.</p><p style="font-size:13px;color:#9a0000;word-break:break-word">${String(error?.message||error)}</p><button onclick="location.reload()" style="border:0;border-radius:8px;padding:12px 20px;background:#075e54;color:#fff;font-size:15px">Try again</button></section></main>`;
});
