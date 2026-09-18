# -*- coding: utf-8 -*-
"""执行 database/ 下的 SQL 脚本（按文件名顺序）到 TiDB zhihui_campus 库"""
import ssl
import sys
import time
from pathlib import Path

import pymysql

ROOT = Path(__file__).resolve().parent.parent
OUT = Path(__file__).resolve().parent / "schema-run-result.txt"
lines = []


def log(s):
    lines.append(str(s))


env = {}
for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
    if "=" in line and not line.strip().startswith("#"):
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip()

ctx = ssl.create_default_context()
ctx.load_verify_locations(str(ROOT / env["DB_CA_PATH"]))

try:
    t0 = time.time()
    conn = pymysql.connect(
        host=env["DB_HOST"], port=int(env["DB_PORT"]),
        user=env["DB_USER"], password=env["DB_PASSWORD"],
        database=env["DB_NAME"], ssl=ctx, connect_timeout=20,
        autocommit=True,
    )
    log(f"[OK] 连接成功 ({int((time.time()-t0)*1000)}ms)")

    scripts = sorted((ROOT / "database").glob("schema-*.sql"))
    log(f"[..] 待执行脚本: {[p.name for p in scripts]}")
    cur = conn.cursor()
    for script in scripts:
        sql_text = script.read_text(encoding="utf-8")
        # 按分号切分执行（脚本内无存储过程/触发器，安全）
        stmts = [s.strip() for s in sql_text.split(";") if s.strip() and not s.strip().startswith("--")]
        # 更稳的做法：逐行过滤注释后拼回
        stmts = []
        buf = []
        for raw in sql_text.splitlines():
            line = raw.strip()
            if line.startswith("--") or not line:
                continue
            buf.append(raw)
        joined = "\n".join(buf)
        stmts = [s.strip() for s in joined.split(";") if s.strip()]
        ok = 0
        for stmt in stmts:
            cur.execute(stmt)
            ok += 1
        log(f"[OK] {script.name}: {ok} 条语句")

    # 验证
    cur.execute("SHOW TABLES")
    log("[OK] 当前表: " + ", ".join(r[0] for r in cur.fetchall()))
    cur.execute("SELECT code, name FROM sys_role ORDER BY id")
    log("[OK] 角色: " + ", ".join(f"{r[0]}({r[1]})" for r in cur.fetchall()))
    conn.close()
    log("[DONE] 全部完成")
except Exception as e:
    import traceback
    log(f"[FAIL] {e!r}")
    log(traceback.format_exc())
    OUT.write_text("\n".join(lines), encoding="utf-8")
    sys.exit(1)

OUT.write_text("\n".join(lines), encoding="utf-8")
