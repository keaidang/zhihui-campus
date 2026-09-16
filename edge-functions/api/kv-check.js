// edge-functions/api/kv-check.js — KV 连通性验证（验收用）
// 验证命名空间 zhihuicampus 绑定是否生效：写入→读取→清理
export async function onRequest({ request }) {
  const key = 'health:ping';
  const stamp = new Date().toISOString();
  try {
    await zhihuicampus.put(key, stamp);
    const v = await zhihuicampus.get(key);
    if (v !== stamp) throw new Error('读写值不一致');
    await zhihuicampus.delete(key);
    return new Response(
      JSON.stringify({ code: 0, message: 'ok', data: { kv: 'up', stamp } }),
      { headers: { 'content-type': 'application/json; charset=UTF-8' } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ code: 50001, message: 'KV 不可用: ' + e.message, data: null }),
      { status: 500, headers: { 'content-type': 'application/json; charset=UTF-8' } },
    );
  }
}
