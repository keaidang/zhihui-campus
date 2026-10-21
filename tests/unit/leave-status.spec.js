// 请假状态口径单测
//
// 为什么必须测：`af_leave.status` 是 1-based（1 审批中 / 2 已批准 / 3 已驳回 / 4 已销假），
// 而 2026-10-21 查实 `api/ai/briefing.js` 曾自己写死一套 0-based 口径（0/1/2/3）。
// 后果不是报错，而是**数字整体平移**：给校领导看的周报里"审批中 113 条"被报成"已批 113 条"，
// 58 条已销假因为 status=4 完全不进任何 SUM —— 四个数字全错，界面却毫无异常。
// 这类漂移只能靠"唯一口径常量 + 钉死参数顺序"来防，故本文件锁三件事：
//   1) LEAVE_CODE 的语义值必须与 LEAVE_STATUS 的键完全一致（不许加/删/改值）
//   2) leaveStatsQuery 的 params 顺序必须 pending/approved/rejected/done = [1,2,3,4]
//   3) SQL 里不许再出现 0 这个"历史口径"字面量（回归防线）
import { describe, it, expect } from 'vitest';
import { LEAVE_STATUS, LEAVE_CODE, leaveStatsQuery } from '../../node-functions/lib/services/leave.js';

describe('请假状态语义码 · LEAVE_CODE', () => {
  it('四个语义码都必须存在且不重复', () => {
    const codes = [LEAVE_CODE.PENDING, LEAVE_CODE.APPROVED, LEAVE_CODE.REJECTED, LEAVE_CODE.BACKED];
    expect(codes).toEqual([1, 2, 3, 4]);
    expect(new Set(codes).size).toBe(4);
  });

  it('每个语义码在 LEAVE_STATUS 里都有对应标签，且标签语义正确', () => {
    expect(LEAVE_STATUS[LEAVE_CODE.PENDING]).toBe('审批中');
    expect(LEAVE_STATUS[LEAVE_CODE.APPROVED]).toBe('已批准');
    expect(LEAVE_STATUS[LEAVE_CODE.REJECTED]).toBe('已驳回');
    expect(LEAVE_STATUS[LEAVE_CODE.BACKED]).toBe('已销假');
  });

  it('LEAVE_STATUS 只应有 1~4 四个键（0 不是合法状态）', () => {
    expect(Object.keys(LEAVE_STATUS).map(Number).sort()).toEqual([1, 2, 3, 4]);
    expect(LEAVE_STATUS[0]).toBeUndefined();
  });
});

describe('leaveStatsQuery · 聚合口径', () => {
  it('参数顺序必须是 pending/approved/rejected/done = 1/2/3/4', () => {
    const { params } = leaveStatsQuery(7);
    expect(params).toEqual([1, 2, 3, 4]);
  });

  it('参数里绝不能出现 0（历史上把 0 当"待批"的口径）', () => {
    expect(leaveStatsQuery(7).params).not.toContain(0);
  });

  it('生成的 SQL 用占位符而不是写死数字，且四个别名齐全', () => {
    const { sql } = leaveStatsQuery(7);
    expect(sql).not.toMatch(/status\s*=\s*\d/);
    for (const alias of ['total', 'pending', 'approved', 'rejected', 'done']) {
      expect(sql).toContain(`AS ${alias}`);
    }
  });

  it('窗口天数会写进 SQL，并夹在 1~365', () => {
    expect(leaveStatsQuery(7).sql).toContain('INTERVAL 7 DAY');
    expect(leaveStatsQuery(400).sql).toContain('INTERVAL 365 DAY');
    expect(leaveStatsQuery(-5).sql).toContain('INTERVAL 1 DAY');
    expect(leaveStatsQuery(0).sql).toContain('INTERVAL 7 DAY');
    expect(leaveStatsQuery('abc').sql).toContain('INTERVAL 7 DAY');
  });

  it('小数天数被截断，不会拼出 INTERVAL 7.5 DAY 这种非法 SQL', () => {
    expect(leaveStatsQuery(7.9).sql).toContain('INTERVAL 7 DAY');
  });
});
