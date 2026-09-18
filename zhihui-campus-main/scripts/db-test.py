# -*- coding: utf-8 -*-
# 智汇校园 · TiDB 连通性读写测试（结果写入 db-test-result.txt）
import ssl, time, traceback
from pathlib import Path
try:
    import pymysql
except Exception:
    Path(__file__).resolve().parent.joinpath("db-test-result.txt").write_text(
        "[FAIL] import pymysql 失败，驱动未安装", encoding="utf-8")
    raise

ROOT = Path(__file__).resolve().parent.parent
OUT = Path(__file__).resolve().parent / "db-test-result.txt"
lines = []

def log(s):
    print(s)
    lines.append(str(s))

# 解析 .env
env = {}
for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
    if "=" in line and not line.strip().startswith("#"):
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip()

try:
    ctx = ssl.create_default_context()
    ctx.load_verify_locations(cafile=str(ROOT / env["DB_CA_PATH"]))
    ctx.check_hostname = True
    log(f"[OK] CA 证书加载: {env['DB_CA_PATH']}")
except Exception as e:
    lines.append(f"[FAIL] CA 证书加载失败: {e!r}")
    OUT.write_text("\n".join(lines), encoding="utf-8")
    raise SystemExit(1)

try:
    t0 = time.time()
    conn = pymysql.connect(
        host=env["DB_HOST"], port=int(env["DB_PORT"]),
        user=env["DB_USER"], password=env["DB_PASSWORD"],
        ssl=ctx, connect_timeout=15,
    )
    log(f"[OK] TLS 连接建立 ({int((time.time()-t0)*1000)}ms)")

    cur = conn.cursor()
    t1 = time.time()
    cur.execute("SELECT VERSION(), NOW()")
    v, now = cur.fetchone()
    log(f"[OK] 读测试: SELECT VERSION() -> TiDB {v} | 服务器时间 {now} ({int((time.time()-t1)*1000)}ms)")

    cur.execute("CREATE DATABASE IF NOT EXISTS zhihui_campus DEFAULT CHARSET utf8mb4")
    log("[OK] 写测试-建库: zhihui_campus")

    cur.execute("USE zhihui_campus")

    cur.execute("SELECT DATABASE()")
    log(f"[OK] 当前库: {cur.fetchone()[0]}")

    t2 = time.time()
    cur.execute("""CREATE TABLE IF NOT EXISTS zhihui_campus._conn_test (
        id INT PRIMARY KEY AUTO_INCREMENT, msg VARCHAR(64) NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP)""")
    cur.execute("INSERT INTO zhihui_campus._conn_test (msg) VALUES (%s)", ["hello zhihui-campus"])
    conn.commit()
    cur.execute("SELECT id, msg, created_at FROM zhihui_campus._conn_test ORDER BY id DESC LIMIT 1")
    rid, msg, ts = cur.fetchone()
    log(f"[OK] 写入并读回: id={rid}, msg={msg}, created_at={ts} ({int((time.time()-t2)*1000)}ms)")
    cur.execute("DROP TABLE zhihui_campus._conn_test")
    conn.commit()
    log("[OK] 清理测试表")

    conn.close()
    log(f"\n== 全部通过 · 总耗时 {int((time.time()-t0)*1000)}ms ==")
    log("结论: TiDB Cloud Serverless 连通/读/写全部正常, .env 与 CA 证书有效")
    OUT.write_text("\n".join(lines), encoding="utf-8")
except Exception as e:
    log("[FAIL] 测试失败")
    log(traceback.format_exc())
    log("排查提示: 检查 .env 各项 / CA 证书路径 / 本机网络代理 / TiDB 控制台集群状态")
    OUT.write_text("\n".join(lines), encoding="utf-8")
    raise SystemExit(1)
