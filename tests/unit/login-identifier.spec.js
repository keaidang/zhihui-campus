// tests/unit/login-identifier.spec.js —— 登录标识解析（lib/auth.js#pickLoginRow）
//
// 为什么必须测（2026-10-20 真实日志）：
//   用户会用**学号**（20260855）和**校园邮箱**（a2026010@keaidang.com）当用户名登录，
//   而原先只查 username → 全部以"用户名或密码错误"收场，用户根本不知道错在哪。
//   现在支持三种标识，但**唯一性与优先级**必须钉死：
//   user_no 没有唯一索引，命中多行时只能拒绝登录，绝不能"随便挑一个"去比对密码。
import { describe, it, expect } from 'vitest';
import { pickLoginRow } from '../../node-functions/lib/auth.js';

const A = { id: 1, username: 'student01', campus_email: 'student01@campus.edu.cn', user_no: '20260001' };
const B = { id: 2, username: 'teacher01', campus_email: 'teacher01@campus.edu.cn', user_no: '20260002' };
const SAME_NO = { id: 3, username: 'student02', campus_email: null, user_no: '20260001' }; // 与 A 学号重复

describe('pickLoginRow · 三种登录标识', () => {
  it('用户名精确匹配（且大小写敏感，与唯一索引口径一致）', () => {
    expect(pickLoginRow([A, B], 'student01')).toEqual({ row: A, by: 'username' });
    expect(pickLoginRow([A, B], 'STUDENT01').row).toBeNull();
  });

  it('★ 校园邮箱匹配（大小写不敏感）', () => {
    expect(pickLoginRow([A, B], 'teacher01@campus.edu.cn')).toEqual({ row: B, by: 'campus_email' });
    expect(pickLoginRow([A, B], 'Teacher01@Campus.edu.cn')).toEqual({ row: B, by: 'campus_email' });
  });

  it('★ 学号/工号匹配', () => {
    expect(pickLoginRow([A, B], '20260002')).toEqual({ row: B, by: 'user_no' });
  });

  it('★ 优先级：用户名 > 邮箱 > 学号', () => {
    // 同一个输入同时能命中 B 的用户名与 A 的邮箱时，必须按用户名来
    const rows = [{ ...A, campus_email: 'teacher01' }, B];
    expect(pickLoginRow(rows, 'teacher01').by).toBe('username');
    expect(pickLoginRow(rows, 'teacher01').row.username).toBe('teacher01');
  });

  it('★ 学号重复 → 拒绝登录（ambiguous），绝不"随便挑一个"', () => {
    const r = pickLoginRow([A, SAME_NO], '20260001');
    expect(r.row).toBeNull();
    expect(r.ambiguous).toBe(true);
  });

  it('学号重复但输入的是用户名 → 仍按用户名正常登录', () => {
    expect(pickLoginRow([A, SAME_NO], 'student01')).toEqual({ row: A, by: 'username' });
  });

  it('空输入 / 无匹配 / 非数组输入都安全返回 null', () => {
    expect(pickLoginRow([A], '')).toEqual({ row: null, by: null });
    expect(pickLoginRow([A], 'nobody')).toEqual({ row: null, by: null });
    expect(pickLoginRow(null, 'student01')).toEqual({ row: null, by: null });
    expect(pickLoginRow([A], null)).toEqual({ row: null, by: null });
  });

  it('user_no 为空串时不会被空输入误命中（SQL 侧同样加了 user_no <> ""）', () => {
    const noNo = { id: 9, username: 'x', campus_email: null, user_no: '' };
    expect(pickLoginRow([noNo], '').row).toBeNull();
  });
});
