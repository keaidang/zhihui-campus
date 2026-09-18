// 监控 461fec8 新前端是否上线（内容特征判别），每 60s 一轮，最多 25 分钟
const BASE = 'https://campus.keaidang.com';
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
for (let i = 1; i <= 25; i++) {
  try {
    const html = await (await fetch(BASE + '/?cb=' + Date.now())).text();
    const m = html.match(/assets\/index-[^"]*\.js/);
    if (m) {
      const js = await (await fetch(BASE + '/' + m[0])).text();
      const live = js.includes('pending-card') && js.includes('--zc-gold');
      console.log(`round${i}: asset=${m[0]} live=${live}`);
      if (live) {
        console.log('DEPLOYED ✓ 新版本已上线');
        process.exit(0);
      }
    }
  } catch (e) { console.log(`round${i}: ${e.message}`); }
  await sleep(60000);
}
console.log('TIMEOUT: 25 分钟内未上线');
process.exit(1);
