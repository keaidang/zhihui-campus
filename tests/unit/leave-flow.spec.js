// 请假流程补录规则单测（leaveFlowSeed）
//
// 为什么必须测：线上 265 条请假单没有流程实例，审批时 flow 表更新命中 0 行、
// 审批意见静默丢失。修复靠两件事：① 数据补录脚本 ② 审批/销假前 ensureLeaveFlow 兜底。
// 两者都依赖 leaveFlowSeed 的映射，映射一旦错位（例如把"已销假"补成"审批中"），
// 数据会被写成自相矛盾且再也对不上 —— 所以四种状态必须逐条钉死。
import { describe, it, expect } from 'vitest';
import { leaveFlowSeed, LEAVE_STATUS } from '../../node-functions/lib/services/leave.js';

describe('leaveFlowSeed · 补录映射', () => {
  it('审批中(1) → 实例进行中 + 节点待处理，且不留补录文案', () => {
    const s = leaveFlowSeed(1);
    expect(s).toEqual({ instStatus: 1, nodeStatus: 0, opinion: '' });
  });

  it('已批准(2) → 实例通过 + 节点通过，意见标注历史补录', () => {
    const s = leaveFlowSeed(2);
    expect(s.instStatus).toBe(2);
    expect(s.nodeStatus).toBe(1);
    expect(s.opinion).toContain('历史数据补录');
  });

  it('已驳回(3) → 实例驳回 + 节点驳回', () => {
    const s = leaveFlowSeed(3);
    expect(s.instStatus).toBe(3);
    expect(s.nodeStatus).toBe(2);
    expect(s.opinion).toContain('历史数据补录');
  });

  it('已销假(4) → 实例已销假 + 节点已通过（销假前必然审批过）', () => {
    const s = leaveFlowSeed(4);
    expect(s.instStatus).toBe(4);
    expect(s.nodeStatus).toBe(1);
  });

  it('实例状态与节点状态必须落在各自合法域内', () => {
    for (const st of [1, 2, 3, 4]) {
      const s = leaveFlowSeed(st);
      expect([1, 2, 3, 4]).toContain(s.instStatus);
      expect([0, 1, 2]).toContain(s.nodeStatus);
    }
  });

  it('字符串状态同样可识别（DB 驱动可能返回字符串）', () => {
    expect(leaveFlowSeed('2')).toEqual(leaveFlowSeed(2));
  });

  it('非法状态（0 / 5 / null / 空串）返回 null，不允许瞎补', () => {
    for (const bad of [0, 5, -1, null, undefined, '', 'abc']) {
      expect(leaveFlowSeed(bad)).toBeNull();
    }
  });

  it('补录映射覆盖的状态与 LEAVE_STATUS 的键集合一致', () => {
    const keys = Object.keys(LEAVE_STATUS).map(Number).sort();
    expect(keys).toEqual([1, 2, 3, 4]);
    for (const k of keys) expect(leaveFlowSeed(k)).not.toBeNull();
  });
});
