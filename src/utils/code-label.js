// src/utils/code-label.js —— 把写进库里的英文代号翻成中文展示
//
// ★ 为什么要有这个文件（铁律 #56 的延续）：`sys_op_log.action`、`ai_usage_log.kind`、
//   `target` 前缀这些是**给审计与排查用的内部代号**（user.setStatus / lf_match / leave:123），
//   直接渲染到表格里，用户既看不懂 `lf_match` 是什么，也看不出 `user.setStatus` 和
//   `user.resetPassword` 到底差在哪。**代号可以留在库里，但不该出现在界面上。**
//
// 三条约定：
//   1. **只做展示层翻译，不改数据**。库里仍存英文代号，审计与论文口径不受影响。
//   2. **未登记的代号绝不丢弃**：显示中文占位（"未登记操作"），原码留在元素 `title` 里，
//      悬停可见 —— 既不污染界面，也不丢排查线索（呼应铁律 #54：给前端决定渲染的字段不许丢数据）。
//   3. **映射表不许漂移**：`tests/unit/code-label.spec.js` 会扫 `node-functions/**` 里
//      所有 `opLog(...)` 动作码与 `logAiUsage({kind})`，出现表里没有的直接判失败 ——
//      新增动作却忘翻中文，会被测试当场拦住，而不是等用户发现。

/** AI 调用用途（ai_usage_log.kind） */
const AI_KIND_LABEL = {
  chat: '校园问答',
  insight: '信息问数',
  action: '对话式操作',
  write: '写操作',
  study: '学业助手',
  review: '论坛审核',
  triage: '报修分诊',
  summary: '公告摘要',
  approval: '审批助手',
  anomaly: '异常监测',
  lf_match: '失物匹配',
  lib_search: '图书检索',
  other: '其他',
};

/**
 * 操作日志动作（sys_op_log.action）
 * 全量取自 `node-functions/**` 里的 opLog 调用点 + 生产库 distinct 值。
 */
const OP_ACTION_LABEL = {
  // —— AI 相关 ——
  'ai.action': 'AI 对话式操作',
  'ai.config.set': '修改 AI 功能开关',
  'ai.kb.upsert': '新增/更新知识库条目',
  'ai.kb.delete': '删除知识库条目',
  'ai.kb.status': '启用/停用知识库条目',
  'ai.review.confirm': 'AI 审核复核处置',
  'ai.review.falsePositive': 'AI 审核标记误判',
  'ai.anomaly.scan': 'AI 异常监测扫描',
  'ai.eval.run': '运行 AI 效果评估',
  'ai.error': 'AI 调用异常',
  // —— 系统错误 ——
  'error.500': '系统内部错误',
  'error.bodyUnreadable': '请求体读取失败',
  // —— 账号与权限 ——
  'user.create': '新建账号',
  'user.batchCreate': '批量新建账号',
  'user.delete': '删除账号',
  'user.batchDelete': '批量删除账号',
  'user.setStatus': '启用/禁用账号',
  'user.setRoles': '调整账号角色',
  'user.setProfile': '修改账号资料',
  'user.setValidUntil': '设置账号有效期',
  'user.resetPassword': '重置账号密码',
  'me.password': '修改本人登录密码',
  'me.password.fail': '修改登录密码失败',
  'password.forgotReset': '通过验证重置密码',
  'role.set': '调整角色',
  // —— 组织与院系 ——
  'dept.create': '新建院系/部门',
  'dept.update': '修改院系/部门',
  'dept.delete': '删除院系/部门',
  'dept.setStatus': '启用/停用院系部门',
  'class.create': '新建班级',
  'class.update': '修改班级',
  'class.delete': '删除班级',
  'student.import': '导入学生',
  'student.setProfile': '修改学生资料',
  // —— 教务 ——
  'course.create': '新建课程',
  'course.update': '修改课程',
  'course.delete': '删除课程',
  'course.import': '导入课程',
  'schedule.import': '导入课表',
  'edu.scoreEntry': '录入成绩',
  // —— 学工 ——
  'leave.approve': '审批请假',
  'notice.publish': '发布公告',
  'notice.revoke': '撤销公告',
  'notice.pin': '置顶/取消置顶公告',
  'notice.summary': '生成公告 AI 摘要',
  'repair.accept': '受理报修',
  'repair.finish': '报修完工',
  'repair.reject': '驳回报修',
  // —— 宿舍 ——
  'dorm.addBuilding': '新增宿舍楼',
  'dorm.addRoom': '新增宿舍房间',
  'dorm.assign': '分配宿舍',
  'dorm.unassign': '取消宿舍分配',
  'dorm.toggleRoom': '切换房间状态',
  // —— 图书 ——
  'lib.update': '修改图书信息',
  'lib.delete': '删除图书',
  'lib.return': '图书归还',
  // —— 失物招领 ——
  'lf.create': '发布失物招领',
  'lf.close': '关闭失物招领',
  'lf.match': 'AI 匹配失物招领',
  // —— 论坛与社团 ——
  'forum.delete': '删除帖子',
  'forum.pin': '置顶帖子',
  'forum.lock': '锁定帖子',
  'forum.ban': '禁言',
  'forum.unban': '解除禁言',
  'club.publish': '发布社团活动',
  'club.review': '审核社团活动',
  'club.stop': '停办社团活动',
  // —— 站内信与邮箱 ——
  'msg.send': '发送站内信',
  'msg.broadcast': '发送群发站内信',
  'mail.send': '发送邮件',
  'mailbox.enable': '启用校园邮箱',
  'mailbox.disable': '停用校园邮箱',
  'mailbox.resetPassword': '重置邮箱密码',
  'mailbox.userPassword': '修改邮箱密码',
  'mailbox.viewPassword': '查看邮箱密码',
  'mailbox.updateAddress': '修改邮箱地址',
  'mailbox.export': '导出邮箱数据',
};

/** 操作对象前缀（target 形如 `user:123` / `leave:456`） */
const OP_TARGET_LABEL = {
  user: '账号',
  student: '学生',
  teacher: '教师',
  class: '班级',
  course: '课程',
  dept: '院系/部门',
  role: '角色',
  room: '宿舍房间',
  building: '宿舍楼',
  leave: '请假单',
  notice: '公告',
  repair: '报修单',
  loan: '借阅记录',
  book: '图书',
  kb: '知识库条目',
  lf: '失物招领',
  thread: '帖子',
  recruit: '社团招新',
};

/** 明细列里已知的英文记号（自由文本，只替换能确定含义的，其余原样保留） */
const DETAIL_TOKEN_LABEL = {
  'via:ai': '来源：AI 操作',
  'handledBy=ai': '处理人：AI',
};

export const UNKNOWN_ACTION = '未登记操作';
export const UNKNOWN_KIND = '其他用途';

/** AI 调用用途 → 中文 */
export function aiKindLabel(kind) {
  const k = String(kind ?? '').trim();
  return AI_KIND_LABEL[k] || UNKNOWN_KIND;
}

/** 操作动作 → 中文 */
export function opActionLabel(action) {
  const a = String(action ?? '').trim();
  return OP_ACTION_LABEL[a] || UNKNOWN_ACTION;
}

/**
 * 操作对象 → 中文：`user:10144481` → `账号 10144481`
 * 没有 `前缀:` 形态的（少数直接存邮箱等）原样返回，不硬套。
 */
export function opTargetLabel(target) {
  const t = String(target ?? '').trim();
  if (!t) return '';
  const m = t.match(/^([a-z_]+):(.+)$/);
  if (!m) return t;
  const prefix = OP_TARGET_LABEL[m[1]];
  return prefix ? `${prefix} ${m[2]}` : t;
}

/** 明细里的已知英文记号 → 中文；其余原样（不猜、不丢） */
export function opDetailLabel(detail) {
  let s = String(detail ?? '');
  if (!s) return '';
  for (const [token, label] of Object.entries(DETAIL_TOKEN_LABEL)) {
    if (s.includes(token)) s = s.split(token).join(label);
  }
  return s;
}

/** 供测试与自检脚本核对映射完整性 */
export const __maps = { AI_KIND_LABEL, OP_ACTION_LABEL, OP_TARGET_LABEL };
