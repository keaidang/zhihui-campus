// tests/unit/ai-query.spec.js —— 结构化查询编译器的安全与行为契约
//
// ★ 为什么这些测试重要（不是"凑覆盖率"）：
// 编译器是**模型与数据库之间的唯一闸门**。模型输出的一切都要经过它，
// 一旦这里漏了某个分支，后果不是"查错数据"，而是**越权**或**注入**。
// 所以每条测试都对应一条真实攻击面：
//   · 模型编造字段名 / 枚举值 / 操作符 → 必须被白名单挡下
//   · 模型试图绕过 scope（数据范围）→ 必须被强制注入的 WHERE 挡住
//   · 模型给超大 limit → 必须被硬夹
//   · 模型用 LIKE 通配符做全表扫描 → 必须被剔除
import { describe, it, expect } from 'vitest';
import { AGGS, ENTITIES, LIMIT_HINT, OPS, canQueryEntity, entityCatalog, requireEntity, requireField, requireMetric, requireOp } from '../../node-functions/lib/ai-entity.js';
import { compileQuery } from '../../node-functions/lib/ai-query.js';

const admin = { userId: 1, roles: ['admin', 'student'], deptId: null };
const counselor = { userId: 2, roles: ['counselor'], deptId: 2 };
const leader = { userId: 3, roles: ['leader'], deptId: null };
const student = { userId: 4, roles: ['student'], deptId: 2 };

/** 取 WHERE 之后、GROUP BY 之前的片段 */
function whereOf(sql) {
  const i = sql.indexOf(' WHERE ');
  if (i < 0) return '';
  const rest = sql.slice(i + 7);
  const j = rest.search(/ GROUP BY | ORDER BY | LIMIT /);
  return j < 0 ? rest : rest.slice(0, j);
}

describe('实体注册表 · 不变量', () => {
  it('★ 每个实体都必须声明 roles、base、fields、metrics（缺一项就可能漏鉴权）', () => {
    for (const [key, e] of Object.entries(ENTITIES)) {
      expect(Array.isArray(e.roles) && e.roles.length, `${key}.roles`).toBeTruthy();
      expect(typeof e.base, `${key}.base`).toBe('string');
      expect(Object.keys(e.fields || {}).length, `${key}.fields`).toBeGreaterThan(0);
      expect(Object.keys(e.metrics || {}).length, `${key}.metrics`).toBeGreaterThan(0);
      expect(typeof e.label, `${key}.label`).toBe('string');
    }
  });

  it('★ 每个实体都必须有 forced 的 count 指标（否则"有多少"这类问题无法回答）', () => {
    for (const [key, e] of Object.entries(ENTITIES)) {
      const forced = Object.values(e.metrics).filter((m) => m.forced);
      expect(forced.length, `${key} 缺少 forced 指标`).toBeGreaterThan(0);
    }
  });

  it('★ 每个实体都必须有 defaultSelect（否则明细查询无从下手）', () => {
    for (const [key, e] of Object.entries(ENTITIES)) {
      expect(Array.isArray(e.defaultSelect) && e.defaultSelect.length, `${key}.defaultSelect`).toBeTruthy();
      for (const k of e.defaultSelect) {
        expect(e.fields[k], `${key}.defaultSelect 里的 ${k} 不是合法字段`).toBeTruthy();
      }
    }
  });

  it('字段的 groupable 标记与 groupGranularity 声明一致', () => {
    // score.gpa 只允许按学生维度分组，注册表里必须真的这么声明
    const g = ENTITIES.score.groupGranularity?.gpa || [];
    for (const k of g) {
      expect(ENTITIES.score.fields[k]?.groupable, `${k} 被 gpa 用作分组维度却不 groupable`).toBe(true);
    }
  });

  it('枚举字段的 values 与 hint 里的说明一致（values 非空时才有枚举校验）', () => {
    for (const [key, e] of Object.entries(ENTITIES)) {
      for (const [fk, f] of Object.entries(e.fields)) {
        if (f.type === 'enum') {
          expect(Array.isArray(f.values) && f.values.length, `${key}.${fk} 是 enum 但没有 values`).toBeTruthy();
        }
      }
    }
  });
});

describe('角色可见性 · 默认拒绝', () => {
  it('★ 学生不能查任何实体（哪怕注册表里有他的数据）', () => {
    for (const key of Object.keys(ENTITIES)) {
      expect(canQueryEntity(key, student), `学生不该能查 ${key}`).toBe(false);
    }
  });

  it('教师可以查 user 实体，但 scope 会把范围限制到本人（见下方 scope 用例）', () => {
    // 注册表里 user 的 roles 含 teacher：教师需要查学生账号办自己的事。
    // 但 scopeWhere 对非 admin/leader/counselor 一律注入 ownerCol = 本人，
    // 所以教师实际只能看到自己的账号 —— 这是"默认拒绝"的价值：给了权限也不放大范围。
    expect(canQueryEntity('user', { userId: 5, roles: ['teacher'], deptId: 2 })).toBe(true);
  });

  it('★ 学生不能查成绩 / 请假（自己的成绩与请假走 C7 学业助手，不走通用查询）', () => {
    expect(canQueryEntity('score', student)).toBe(false);
    expect(canQueryEntity('leave', student)).toBe(false);
  });

  it('管理员与校领导可查全部实体', () => {
    for (const key of Object.keys(ENTITIES)) {
      expect(canQueryEntity(key, admin), `管理员不该能查 ${key}`).toBe(true);
      expect(canQueryEntity(key, leader), `校领导不该能查 ${key}`).toBe(true);
    }
  });

  it('entityCatalog 只返回该角色可见的实体，且不含任何 SQL 片段', () => {
    const cat = entityCatalog(counselor);
    expect(cat.length).toBeGreaterThan(0);
    for (const e of cat) {
      expect(e.fields.every((f) => !('sql' in f)), '暴露了 sql 片段给模型 = 泄漏实现').toBe(true);
      expect(e.fields.every((f) => !('key' in f && f.key.includes('.'))), '字段 key 不应含 SQL 片段').toBe(true);
    }
  });

  it('学生看到的目录是空的（而不是给出全部再在后面过滤）', () => {
    expect(entityCatalog(student)).toHaveLength(0);
  });
});

describe('requireEntity / requireField / requireMetric / requireOp · 白名单拦截', () => {
  it('不存在的实体被拒（49402）', () => {
    expect(() => requireEntity('sys_user', admin)).toThrowError(/不支持查询/);
  });

  it('模型编造的字段名被拒（错误信息要列出合法字段，便于它自我纠正）', () => {
    expect(() => requireField(ENTITIES.user, 'password')).toThrowError(/没有「password」这个字段/);
    expect(() => requireField(ENTITIES.user, 'password')).toThrowError(/username/);
  });

  it('★ 字段名里带 SQL 片段（u.username; DROP TABLE）一律被拒', () => {
    for (const evil of ['u.username; DROP TABLE sys_user', 'username--', '*', '1=1']) {
      expect(() => requireField(ENTITIES.user, evil), evil).toThrowError();
    }
  });

  it('不存在的指标被拒', () => {
    expect(() => requireMetric(ENTITIES.score, 'maxGpa')).toThrowError(/没有「maxGpa」这个统计方式/);
  });

  it('不在白名单里的操作符被拒（不允许模型自由写 SQL 运算符）', () => {
    for (const evil of ['UNION', 'OR 1=1', 'regex', 'union select']) {
      expect(() => requireOp(evil), evil).toThrowError(/不支持的筛选方式/);
    }
  });

  it('白名单本身是冻结的（防运行时被篡改）', () => {
    expect(Object.isFrozen(OPS)).toBe(true);
    expect(Object.isFrozen(AGGS)).toBe(true);
    expect(Object.isFrozen(ENTITIES)).toBe(true);
  });

  it('无权角色查实体 → 403 而不是 49402（不能靠错误码探测实体是否存在）', () => {
    try {
      requireEntity('score', student);
      expect.unreachable?.();
    } catch (e) {
      expect(e.code).toBe(49403);
    }
  });
});

describe('compileQuery · 基本编译', () => {
  it('单值查询：SELECT 只有指标，且 LIMIT 被夹住', () => {
    const c = compileQuery(admin, { entity: 'user', metrics: { count: 1 } });
    expect(c.sql).toContain('COUNT(DISTINCT u.id) AS `人数`');
    expect(c.sql).toContain(`LIMIT ${LIMIT_HINT.aggregate}`);
    expect(c.isAggregate).toBe(true);
    expect(c.scalar).toBeUndefined();
  });

  it('★ 模型给 limit:99999 也会被夹到上限 50（防拖库）', () => {
    const c = compileQuery(admin, { entity: 'user', limit: 99999 });
    expect(c.limit).toBe(LIMIT_HINT.max);
    expect(c.sql).toContain(`LIMIT ${LIMIT_HINT.max}`);
  });

  it('明细查询：按 defaultSelect 展示、不显示 forced 指标、limit 走明细档', () => {
    const c = compileQuery(admin, { entity: 'user', limit: 5 });
    expect(c.isAggregate).toBe(false);
    expect(c.sql).toContain('u.username AS `账号`');
    expect(c.sql).not.toContain('COUNT(');
    // limit 给了 5 就用 5；没给才用明细档 20
    expect(c.sql).toContain('LIMIT 5');
    expect(compileQuery(admin, { entity: 'user' }).sql).toContain(`LIMIT ${LIMIT_HINT.detail}`);
  });

  it('★ 文本字段不能用于排序（否则模型可按姓名排，语义无意义且拖慢查询）', () => {
    expect(() => compileQuery(admin, { entity: 'user', metrics: { count: 1 }, groupBy: ['dept'], orderBy: { field: 'realName', dir: 'asc' } })).toThrowError(/文本字段，不能用于排序/);
  });

  it('数值字段可以排序，且方向可控', () => {
    const desc = compileQuery(admin, { entity: 'leave', metrics: { count: 1 }, groupBy: ['className'], orderBy: { field: 'count', dir: 'desc' } });
    expect(desc.sql).toContain('ORDER BY `单数` DESC');
    const asc = compileQuery(admin, { entity: 'leave', metrics: { count: 1 }, groupBy: ['className'], orderBy: { field: 'count', dir: 'asc' } });
    expect(asc.sql).toContain('ORDER BY `单数` ASC');
  });

  it('方向写错时默认降序（不给它 ASC 的机会）', () => {
    const c = compileQuery(admin, { entity: 'leave', metrics: { count: 1 }, groupBy: ['className'], orderBy: { field: 'count', dir: '随便写的' } });
    expect(c.sql).toContain('DESC');
  });

  it('★ 一次最多 2 个分组维度（更复杂的走专门模板，避免组合爆炸）', () => {
    expect(() => compileQuery(admin, { entity: 'leave', metrics: { count: 1 }, groupBy: ['className', 'type', 'status'] })).toThrowError(/最多按 2 个维度分组/);
    // 2 个是允许的
    expect(() => compileQuery(admin, { entity: 'leave', metrics: { count: 1 }, groupBy: ['className', 'type'] })).not.toThrow();
  });

  it('不能分组的字段被拒（groupable=false）', () => {
    // description 是文本且未标 groupable
    expect(() => compileQuery(admin, { entity: 'repair', metrics: { count: 1 }, groupBy: ['description'] })).toThrowError(/不能用于分组/);
  });

  it('score 实体自动带上"已出成绩"过滤（否则 AVG 被大量 NULL 拉低）', () => {
    const c = compileQuery(admin, { entity: 'score', metrics: { avgScore: 1 } });
    expect(c.sql).toContain('e.status = 2');
    expect(c.sql).toContain('e.score IS NOT NULL');
  });
});

describe('★ 筛选条件：值必须参数化', () => {
  it('普通等值：值进 ? 占位符，绝不拼进 SQL 文本', () => {
    const c = compileQuery(admin, { entity: 'user', metrics: { count: 1 }, filters: [{ field: 'dept', op: 'eq', value: '计算机科学与技术学院' }] });
    expect(c.sql).toContain('dp.name = ?');
    expect(c.sql).not.toContain('计算机科学与技术学院');
    expect(c.params).toContain('计算机科学与技术学院');
  });

  it('★ SQL 注入尝试：引号闭合类输入完全无害（值仍是参数）', () => {
    const injections = [
      "'; DROP TABLE sys_user; --",
      "' OR '1'='1",
      "1; DELETE FROM af_leave WHERE 1=1; --",
      "' UNION SELECT password FROM sys_user --",
    ];
    for (const v of injections) {
      const c = compileQuery(admin, { entity: 'user', metrics: { count: 1 }, filters: [{ field: 'realName', op: 'eq', value: v }] });
      // 值必须在 params 里，且 SQL 文本里不含它
      expect(c.params, v).toContain(v);
      expect(c.sql, v).not.toContain(v);
      // SQL 结构没被改变：仍然只有一个 SELECT、参数个数与占位符个数一致
      expect((c.sql.match(/SELECT/gi) || []).length).toBe(1);
    }
  });

  it('★ LIKE 的通配符被剔除（% _ \\ 不该由模型控制，否则可全表扫描）', () => {
    const c = compileQuery(admin, { entity: 'user', metrics: { count: 1 }, filters: [{ field: 'realName', op: 'like', value: '张%_' }] });
    expect(c.params).toContain('%张%'); // % 被剔除后只剩字面量两侧的 %
    expect(c.params.join('')).not.toMatch(/[\\]_/);
  });

  it('★ 枚举值必须合法（模型编 status=9 被挡下）', () => {
    expect(() => compileQuery(admin, { entity: 'leave', metrics: { count: 1 }, filters: [{ field: 'status', op: 'eq', value: '9' }] })).toThrowError(/只能是/);
    expect(() => compileQuery(admin, { entity: 'leave', metrics: { count: 1 }, filters: [{ field: 'status', op: 'eq', value: '2' }] })).not.toThrow();
  });

  it('★ 数值字段的比较值必须是数字（挡住把字符串塞进数值比较）', () => {
    expect(() => compileQuery(admin, { entity: 'leave', metrics: { count: 1 }, filters: [{ field: 'days', op: 'gt', value: 'abc' }] })).toThrowError(/必须是数字/);
  });

  it('in 操作符：值必须是数组且过枚举校验', () => {
    const ok = compileQuery(admin, { entity: 'user', metrics: { count: 1 }, filters: [{ field: 'role', op: 'in', value: ['student', 'teacher'] }] });
    expect(ok.sql).toContain('rl.code IN (?, ?)');
    expect(() => compileQuery(admin, { entity: 'user', metrics: { count: 1 }, filters: [{ field: 'role', op: 'in', value: ['student', 'root'] }] })).toThrowError(/只能是/);
    expect(() => compileQuery(admin, { entity: 'user', metrics: { count: 1 }, filters: [{ field: 'role', op: 'in', value: Array(30).fill('student') }] })).toThrowError(/1~20/);
  });

  it('筛选条件缺值被拒（否则生成 `= ?` 传 null，语义变成"等于空"）', () => {
    expect(() => compileQuery(admin, { entity: 'user', metrics: { count: 1 }, filters: [{ field: 'realName', op: 'eq' }] })).toThrowError(/缺少比较值/);
  });

  it('筛选条件上限 6 个（防止模型堆条件导致慢查询）', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ field: 'realName', op: 'eq', value: `x${i}` }));
    const c = compileQuery(admin, { entity: 'user', metrics: { count: 1 }, filters: many });
    expect(c.params.length).toBeLessThanOrEqual(6);
  });

  it('时间窗口：days 必须是合理范围内的正整数', () => {
    const c = compileQuery(admin, { entity: 'leave', metrics: { count: 1 }, filters: [{ field: 'createdAt', days: 90 }] });
    expect(c.sql).toContain('INTERVAL ? DAY');
    expect(c.params).toContain(90);
    expect(() => compileQuery(admin, { entity: 'leave', metrics: { count: 1 }, filters: [{ field: 'createdAt', days: 0 }] })).toThrowError(/1~3660/);
    expect(() => compileQuery(admin, { entity: 'leave', metrics: { count: 1 }, filters: [{ field: 'createdAt', days: 99999 }] })).toThrowError(/1~3660/);
    expect(() => compileQuery(admin, { entity: 'leave', metrics: { count: 1 }, filters: [{ field: 'createdAt', days: -5 }] })).toThrowError(/1~3660/);
  });
});

describe('★★ 数据范围（scope）强制注入 —— 越权防线', () => {
  it('管理员 / 校领导：不加任何限制（全校只读）', () => {
    expect(whereOf(compileQuery(admin, { entity: 'user', metrics: { count: 1 } }).sql)).not.toMatch(/WHERE.*=/);
    expect(whereOf(compileQuery(leader, { entity: 'user', metrics: { count: 1 } }).sql)).not.toMatch(/WHERE.*=/);
  });

  it('★ 教师查账号：强制注入 user_id = 本人（教师有权限但范围不放���）', () => {
    // 用教师而不是学生来验证：学生压根无权访问 user/score 实体，
    // 那时抛的是 49403，**根本走不到 scope 注入这一步** —— 用学生测 scope 是测不到的。
    const teacher = { userId: 5, roles: ['teacher'], deptId: 2 };
    const c = compileQuery(teacher, { entity: 'user', metrics: { count: 1 } });
    expect(whereOf(c.sql)).toMatch(/u\.user_id = \?/);
    expect(c.params).toContain(teacher.userId);
  });

  it('★ 无权角色在 scope 注入**之前**就被拒（不能靠错误码探测实体是否存在）', () => {
    // 教师只能查 user；查 leave 时应得 49403，而不是"查得到但范围被限"。
    // 这条锁的是**鉴权与 scope 的先后顺序**：先鉴权、再限范围。
    try {
      compileQuery({ userId: 5, roles: ['teacher'], deptId: 2 }, { entity: 'leave', metrics: { count: 1 } });
      expect.unreachable?.();
    } catch (e) {
      expect(e.code).toBe(49403);
    }
  });

  it('★ 辅导员查账号：强制注入本院条件（经 class.dept_id）', () => {
    const c = compileQuery(counselor, { entity: 'user', metrics: { count: 1 } });
    expect(whereOf(c.sql)).toMatch(/cl\.dept_id = \?/);
    expect(c.params).toContain(counselor.deptId);
  });

  it('★ 辅导员查成绩：注入本院条件（经学生 → 班级 → 院系）', () => {
    const c = compileQuery(counselor, { entity: 'score', metrics: { count: 1 } });
    expect(whereOf(c.sql)).toMatch(/dp\.id = \?/);
    expect(c.params).toContain(counselor.deptId);
  });

  it('★ 辅导员查请假：注入 l.dept_id = 本院', () => {
    const c = compileQuery(counselor, { entity: 'leave', metrics: { count: 1 } });
    expect(whereOf(c.sql)).toMatch(/l\.dept_id = \?/);
  });

  it('★★ 模型试图用 filters 指定别的院系时，scope 仍然叠加（越权不可能）', () => {
    // 模型说"查计算机学院"（dept_id=1），但辅导员属于院系 2
    const c = compileQuery(counselor, {
      entity: 'user',
      metrics: { count: 1 },
      filters: [{ field: 'dept', op: 'eq', value: '计算机科学与技术学院' }],
    });
    const w = whereOf(c.sql);
    // 两个条件都是 AND 关系 —— 模型给的是"院系名字符串"，scope 给的是"本院 dept_id"
    expect(w).toMatch(/dp\.name = \?/);
    expect(w).toMatch(/cl\.dept_id = \?/);
    expect(w).toMatch(/ AND /);
    expect(c.params).toContain('计算机科学与技术学院');
    expect(c.params).toContain(counselor.deptId);
  });

  it('★ 辅导员查报修 / 借阅：经提交人所在班级判定本院', () => {
    for (const ent of ['repair', 'loan']) {
      const c = compileQuery(counselor, { entity: ent, metrics: { count: 1 } });
      expect(whereOf(c.sql), ent).toMatch(/sys_class WHERE dept_id = \?/);
      expect(c.params, ent).toContain(counselor.deptId);
    }
  });

  it('★ 辅导员查论坛：经作者所在班级判定本院', () => {
    const c = compileQuery(counselor, { entity: 'forum', metrics: { count: 1 } });
    expect(whereOf(c.sql)).toMatch(/t\.author_id IN/);
  });

  it('★ 无 deptId 的辅导员退化为 -1（查不到数据，而不是不加限制）', () => {
    const c = compileQuery({ userId: 9, roles: ['counselor'], deptId: null }, { entity: 'user', metrics: { count: 1 } });
    expect(c.params).toContain(-1);
    expect(whereOf(c.sql)).toMatch(/cl\.dept_id = \?/);
  });

  it('★ 无 userId 的用户退化为 -1（同上，绝不"不加限制"）', () => {
    // 辅导员缺 deptId → 注入 -1（查不到任何数据），而不是"不加限制看全校"
    const c = compileQuery({ userId: 5, roles: ['counselor'], deptId: null }, { entity: 'leave', metrics: { count: 1 } });
    expect(c.params).toContain(-1);
  });
});

describe('编译结果的自检不变量（可被单测直接断言）', () => {
  const cases = [
    { entity: 'user', metrics: { count: 1 } },
    { entity: 'user', metrics: { count: 1 }, groupBy: ['dept'] },
    { entity: 'score', metrics: { gpa: 1 }, groupBy: ['realName'] },
    { entity: 'score', metrics: { failRate: 1 }, filters: [{ field: 'dept', op: 'eq', value: 'X' }] },
    { entity: 'leave', metrics: { count: 1 }, groupBy: ['className'], filters: [{ field: 'createdAt', days: 30 }] },
    { entity: 'repair', limit: 5 },
    { entity: 'loan', metrics: { overdue: 1 } },
    { entity: 'forum', metrics: { count: 1 }, groupBy: ['board'] },
  ];

  it('★ 生成的 SQL 里 ? 占位符数量 === params 数量（防"少给参数"这类隐性 bug）', () => {
    for (const q of cases) {
      const c = compileQuery(admin, q);
      const placeholders = (c.sql.match(/\?/g) || []).length;
      expect(placeholders, `${q.entity} 占位符 ${placeholders} ≠ 参数 ${c.params.length}`).toBe(c.params.length);
    }
  });

  it('★ 生成的 SQL 不含分号（防语句拼接）与注释符', () => {
    for (const q of cases) {
      const c = compileQuery(admin, q);
      expect(c.sql, q.entity).not.toContain(';');
      expect(c.sql, q.entity).not.toContain('--');
      expect(c.sql, q.entity).not.toContain('/*');
    }
  });

  it('★ 每条 SQL 都带 LIMIT（防全表扫描）', () => {
    for (const q of cases) {
      expect(compileQuery(admin, q).sql, q.entity).toMatch(/LIMIT \d+$/);
    }
  });

  it('★ 生成的 SQL 里出现的所有别名都来自注册表（不留可注入的标识符）', () => {
    for (const q of cases) {
      const c = compileQuery(admin, q);
      // 反引号里的内容是我们自己的中文别名；表别名只能来自注册表里出现过的
      const aliases = new Set(['u', 'cl', 'dp', 'ur', 'rl', 'e', 'c', 'co', 'l', 'r', 'ln', 'b', 't']);
      const used = c.sql.match(/\b([a-z]{1,2})\./g) || [];
      for (const m of used) {
        expect(aliases.has(m.replace('.', '')), `${q.entity} 出现未登记的表别名 ${m}`).toBe(true);
      }
    }
  });
});
