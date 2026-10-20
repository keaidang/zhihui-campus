// 口令强度规则单测
//
// 为什么必须测：这条规则被 4 个入口共用（注册 / 忘记密码 / 自助改密 / 管理员重置）。
// 规则一旦漂移，就会出现"某个入口能设弱口令"的**静默缺口** —— 没人会收到报错，
// 只会有一个更弱的入口静静存在。故边界（7/8/64/65）与非字符串输入必须钉死。
import { describe, it, expect } from 'vitest';
import {
  PWD_MIN,
  PWD_MAX,
  isPasswordLengthOk,
  checkNewPassword,
  resolveResetPassword,
} from '../../node-functions/lib/password-rules.js';

describe('isPasswordLengthOk · 长度边界', () => {
  it('常量与实际边界一致（8~64）', () => {
    expect(PWD_MIN).toBe(8);
    expect(PWD_MAX).toBe(64);
  });

  it('7 位过短、8 位刚好', () => {
    expect(isPasswordLengthOk('a'.repeat(7))).toBe(false);
    expect(isPasswordLengthOk('a'.repeat(8))).toBe(true);
  });

  it('64 位刚好、65 位过长', () => {
    expect(isPasswordLengthOk('a'.repeat(64))).toBe(true);
    expect(isPasswordLengthOk('a'.repeat(65))).toBe(false);
  });

  it('空串 / 非字符串一律不合法（防止放行或抛 TypeError）', () => {
    expect(isPasswordLengthOk('')).toBe(false);
    expect(isPasswordLengthOk(null)).toBe(false);
    expect(isPasswordLengthOk(undefined)).toBe(false);
    expect(isPasswordLengthOk(12345678)).toBe(false);
    expect(isPasswordLengthOk({})).toBe(false);
    expect(isPasswordLengthOk(['a', 'b'])).toBe(false);
  });

  it('中文按字符数计（不按字节）', () => {
    expect(isPasswordLengthOk('密码密码密码密码')).toBe(true); // 8 字符
    expect(isPasswordLengthOk('密码密码密码密')).toBe(false); // 7 字符
  });
});

describe('checkNewPassword · 自助改密校验', () => {
  it('合法新密码通过', () => {
    expect(checkNewPassword('OldPass123', 'NewPass456')).toEqual({ ok: true });
  });

  it('长度不合法被拒，且原因含区间（前端直接展示）', () => {
    const r = checkNewPassword('OldPass123', 'short');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('8~64');
  });

  it('与原密码完全相同被拒（原因含"相同"，前端据此给不同错误码）', () => {
    const r = checkNewPassword('SamePass123', 'SamePass123');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('相同');
  });

  it('原密码为空/缺失时不触发"相同"判定（该场景由参数校验兜住）', () => {
    expect(checkNewPassword('', 'NewPass456')).toEqual({ ok: true });
    expect(checkNewPassword(undefined, 'NewPass456')).toEqual({ ok: true });
  });

  it('★ 长度判定优先于"与原密码相同"（两者都不满足时报长度问题）', () => {
    const r = checkNewPassword('short', 'short');
    expect(r.reason).toContain('8~64');
  });
});

describe('★ 重构等价性：与重构前各入口的字面量规则一致', () => {
  it('与注册接口的旧判定等价（其入参已由 String() 保证为字符串）', () => {
    // 旧：if (password.length < PASSWORD_MIN || password.length > 64) → 拒绝
    const oldRejects = (p) => p.length < 8 || p.length > 64;
    for (const p of ['', 'a'.repeat(7), 'a'.repeat(8), 'a'.repeat(63), 'a'.repeat(64), 'a'.repeat(65)]) {
      expect(!isPasswordLengthOk(p), `len=${p.length}`).toBe(oldRejects(p));
    }
  });

  it('与忘记密码接口的旧判定逐例一致（含非字符串输入）', () => {
    // 旧：const PWD_OK = (p) => typeof p === 'string' && p.length >= 8 && p.length <= 64
    const oldOk = (p) => typeof p === 'string' && p.length >= 8 && p.length <= 64;
    for (const p of ['a'.repeat(8), 'a'.repeat(64), 'a'.repeat(7), 'a'.repeat(65), '', null, undefined, 12345678]) {
      expect(isPasswordLengthOk(p)).toBe(oldOk(p));
    }

// ============================================================
// 2026-10-20：管理员重置密码的取值口径（用户要求"重置为默认密码"）
// ============================================================
describe('resolveResetPassword · 管理员重置时设成什么口令', () => {
  const DEF = 'Zhihui@2026';

  it('★ 不传密码 → 重置为统一默认密码（原实现是随机生成一串）', () => {
    expect(resolveResetPassword('', DEF)).toEqual({ password: DEF, isDefault: true });
    expect(resolveResetPassword(undefined, DEF)).toEqual({ password: DEF, isDefault: true });
    expect(resolveResetPassword(null, DEF)).toEqual({ password: DEF, isDefault: true });
    expect(resolveResetPassword('   ', DEF)).toEqual({ password: DEF, isDefault: true });
  });

  it('传了自定义密码 → 按传入的来（导入/统一发号场景）', () => {
    expect(resolveResetPassword('Class@2026', DEF)).toEqual({ password: 'Class@2026', isDefault: false });
  });

  it('首尾空格被裁掉（避免管理员以为设了带空格的密码）', () => {
    expect(resolveResetPassword('  Class@2026  ', DEF).password).toBe('Class@2026');
  });

  it('★ 长度不合法时返回 error，而不是静默改成默认密码', () => {
    const short = resolveResetPassword('abc', DEF);
    expect(short.error, '过短必须报错').toContain('8~64');
    expect(short.password).toBeUndefined();
    expect(resolveResetPassword('a'.repeat(65), DEF).error).toContain('8~64');
  });

  it('非字符串输入按"未传"处理（数字/对象不会变成口令）', () => {
    expect(resolveResetPassword(12345678, DEF)).toEqual({ password: DEF, isDefault: true });
    expect(resolveResetPassword({}, DEF)).toEqual({ password: DEF, isDefault: true });
  });

  it('默认密码本身必须通过强度规则（否则重置出来的口令连注册都过不了）', () => {
    expect(isPasswordLengthOk(DEF)).toBe(true);
  });
});

  });
});
