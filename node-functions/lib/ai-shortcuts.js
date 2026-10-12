// node-functions/lib/ai-shortcuts.js — C14 问办合一 · 对话式业务一键直达匹配
//
// 作用：当用户在智能问答中咨询具体办事流程时（如请假、报修、借书、选课），
// 服务端根据问题关键词和召回的知识库分类，自动挂载预填跳转直达卡片。
// 前端点击后直接跳转至对应业务页面，实现「咨询即办理」的闭环。

export function detectShortcuts(question = '', sources = []) {
  const sc = [];
  const q = String(question || '').toLowerCase();
  const cats = (Array.isArray(sources) ? sources : []).map((s) => String(s?.category || '').toLowerCase());

  if (/请假|销假|假条|离校|出校审批/.test(q) || cats.includes('leave')) {
    sc.push({ label: '立即申请请假', path: '/af/leave', icon: 'Clock', desc: '在线填写请假单' });
  }
  if (/报修|维修|漏水|宿舍坏|灯坏|修空调|水管|电闸/.test(q) || cats.includes('repair') || cats.includes('dorm')) {
    sc.push({ label: '提交在线报修', path: '/dorm', query: { tab: 'repair' }, icon: 'House', desc: '后勤设施报修工单' });
  }
  if (/选课|退课|通识课|改选|必修课|选修课/.test(q) || cats.includes('elect')) {
    sc.push({ label: '进入在线选课', path: '/edu/elect', icon: 'Notebook', desc: '实时查余量与改选' });
  }
  if (/成绩|绩点|及格|查分|周课表|课表|学分/.test(q) || cats.includes('scores')) {
    sc.push({ label: '查看成绩课表', path: '/edu/scores', icon: 'Reading', desc: '学业进度与个人课表' });
  }
  if (/借阅|借书|还书|馆藏|图书|续借/.test(q) || cats.includes('lib') || cats.includes('library')) {
    sc.push({ label: '检索馆藏图书', path: '/library', icon: 'Collection', desc: '馆藏检索与在线续借' });
  }
  if (/失物|拾金不昧|丢了|招领|寻物|钥匙丢了|钱包/.test(q) || cats.includes('lost_found')) {
    sc.push({ label: '失物招领大厅', path: '/lost-found', icon: 'Search', desc: '登记拾物与挂失' });
  }
  if (/邮箱|发信|发邮件|写信|公文|邮件助理/.test(q) || cats.includes('mail')) {
    sc.push({ label: '打开校园邮箱', path: '/mail', icon: 'Promotion', desc: '师生邮箱与公文' });
  }
  if (/社团|活动|报名社团|百团/.test(q) || cats.includes('club')) {
    sc.push({ label: '浏览社团活动', path: '/club', icon: 'Flag', desc: '社团招募与活动预约' });
  }
  if (/论坛|发帖|二手交易|求助板块/.test(q) || cats.includes('forum')) {
    sc.push({ label: '进入校园论坛', path: '/forum', icon: 'ChatDotRound', desc: '师生社区交流' });
  }

  const seen = new Set();
  const res = [];
  for (const item of sc) {
    if (!seen.has(item.path)) {
      seen.add(item.path);
      res.push(item);
    }
  }
  return res.slice(0, 3);
}
