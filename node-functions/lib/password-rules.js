// node-functions/lib/password-rules.js — 口令强度规则（全项目唯一来源）
//
// 为什么抽成模块：注册（auth/register.js）、忘记密码（auth/password/forgot-reset.js）、
// 管理员重置（admin/users.js）、自助改密（me/password.js）四处都要判口令强度。
// 此前规则以字面量散落在三处（`PASSWORD_MIN = 8` / 内联 `PWD_OK` / `length < 8`），
// 任一处被改动都可能造成"某个入口能设弱口令"的静默缺口。
// 本模块为纯函数，边界由 tests/unit/password-rules.spec.js 覆盖。
export const PWD_MIN = 8;
export const PWD_MAX = 64;

/** 口令长度是否合法（8~64 位，非字符串一律不合法） */
export function isPasswordLengthOk(p) {
  return typeof p === 'string' && p.length >= PWD_MIN && p.length <= PWD_MAX;
}

/**
 * 自助改密的完整校验：长度 + 不得与原密码相同。
 * （"与原密码相同"只对改密场景有意义，故不并入 isPasswordLengthOk）
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function checkNewPassword(oldPassword, newPassword) {
  if (!isPasswordLengthOk(newPassword)) {
    return { ok: false, reason: `新密码长度须为 ${PWD_MIN}~${PWD_MAX} 位` };
  }
  if (typeof oldPassword === 'string' && oldPassword !== '' && oldPassword === newPassword) {
    return { ok: false, reason: '新密码不能与原密码相同' };
  }
  return { ok: true };
}
