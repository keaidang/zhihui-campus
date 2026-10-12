// node-functions/lib/ai-shortcuts.js — C14 问办合一 · 对话式业务一键直达匹配
//
// 作用：当用户在智能问答中咨询具体办事流程时（如请假、报修、借书、选课），
// 服务端根据问题关键词和召回的知识库标题/分类，自动挂载预填跳转直达卡片。
// 前端点击后直接跳转至对应业务页面，实现「咨询即办理」的闭环。

export function detectShortcuts(question = '', sources = []) {
  const sc = [];
  const q = String(question || '').trim().toLowerCase();
  const sourceList = Array.isArray(sources) ? sources : [];
  const titles = sourceList.map((s) => String(s?.title || '').toLowerCase());
  const cats = sourceList.map((s) => String(s?.category || '').toLowerCase());

  // 辅助函数：判断提问文本或召回知识库标题是否命中正则
  const matchAny = (regex) => regex.test(q) || titles.some((t) => regex.test(t));

  // 1. 报修（含口语错别字"保修"、设备坏了、寝室设施故障）
  const repairExplicit = /报修|保修|维修|修理|送修|叫修|故障工单|漏水|漏电|渗水|反水/;
  const fixtureFault = /(空调|水管|水龙头|龙头|马桶|地漏|喷头|灯泡|电灯|日光灯|门锁|锁头|窗户|书桌|椅子|电路|插座|跳闸|电闸|网线|电风扇|热水器).*(坏|修|故障|不灵|不通|不热|不亮|堵|烧了|爆了|脱落|松动)/;
  const fixFixture = /(修|报修|保修|更换|换一下).*(空调|水管|水龙头|龙头|马桶|地漏|灯泡|电灯|门锁|锁头|窗户|书桌|椅子|电路|插座|电闸|网线|热水器)/;
  const dormRepair = /(宿舍|寝室).*(坏|漏|报修|保修|维修|故障|修一修)/;
  const kbRepair = titles.some((t) => /报修|维修/.test(t));
  if (matchAny(repairExplicit) || fixtureFault.test(q) || fixFixture.test(q) || dormRepair.test(q) || kbRepair || cats.includes('repair')) {
    sc.push({ label: '提交在线报修', path: '/dorm', query: { tab: 'repair' }, icon: 'House', desc: '后勤设施报修工单' });
  }

  // 2. 请假 / 销假
  if (matchAny(/请假|销假|假条|离校|出校|返校登记|请病假|请事假|请公假|请假条|缺勤|补假/) || cats.includes('leave')) {
    sc.push({ label: '立即申请请假', path: '/af/leave', icon: 'Clock', desc: '在线填写请假单' });
  }

  // 3. 选课 / 退课
  if (matchAny(/选课|退课|改选|抢课|补选|蹭课|选修课|通识课|培养方案.*选|怎么选课/) || cats.includes('elect')) {
    sc.push({ label: '进入在线选课', path: '/edu/elect', icon: 'Notebook', desc: '实时查余量与改选' });
  }

  // 4. 成绩 / 课表 / 学业
  if (matchAny(/成绩|绩点|gpa|及格|查分|看分|重修|挂科|学分|周课表|课表|上课时间|在哪上课/) || cats.includes('scores')) {
    sc.push({ label: '查看成绩课表', path: '/edu/scores', icon: 'Reading', desc: '学业进度与个人课表' });
  }

  // 5. 图书借阅（覆盖借书、借的书、还书、续借等）
  if (matchAny(/借书|还书|续借|借阅|藏书|馆藏|图书|借还|到期还书|图书馆|借.*书|还.*书/) || cats.includes('lib') || cats.includes('library')) {
    sc.push({ label: '检索馆藏图书', path: '/library', icon: 'Collection', desc: '馆藏检索与在线续借' });
  }

  // 6. 失物招领
  if (matchAny(/失物|拾金不昧|拾到|捡到|遗失|丢了|掉了|寻物|丢东西|挂失|拾物|捡了/) || cats.includes('lost_found')) {
    sc.push({ label: '失物招领大厅', path: '/lost-found', icon: 'Search', desc: '登记拾物与挂失' });
  }

  // 7. 校园邮箱 / 公文
  if (matchAny(/邮箱|发信|发邮件|收邮件|写信|公文|邮件助理|校园邮箱|发信给|邮件/) || cats.includes('mail')) {
    sc.push({ label: '打开校园邮箱', path: '/mail', icon: 'Promotion', desc: '师生邮箱与公文' });
  }

  // 8. 社团活动
  if (matchAny(/社团|百团|学生会|协会|报名社团|参加活动|社团招募|活动预约/) || cats.includes('club')) {
    sc.push({ label: '浏览社团活动', path: '/club', icon: 'Flag', desc: '社团招募与活动预约' });
  }

  // 9. 校园论坛 / 交易集市
  if (matchAny(/论坛|发帖|回帖|帖子|集市|跳蚤|二手|转让|闲置|买卖|求助板块|校园贴/) || cats.includes('forum')) {
    sc.push({ label: '进入校园论坛', path: '/forum', icon: 'ChatDotRound', desc: '师生社区与二手集市' });
  }

  // 10. 宿舍生活（非报修场景下咨询宿舍信息）
  if (matchAny(/看宿舍|查宿舍|我的宿舍|寝室号|宿舍号|退宿|换宿|宿舍分配|舍友|室友/) || (cats.includes('宿舍') && !q.includes('修') && !q.includes('坏'))) {
    sc.push({ label: '查看宿舍信息', path: '/dorm', icon: 'House', desc: '住宿与室友信息' });
  }

  const seen = new Set();
  const res = [];
  for (const item of sc) {
    const key = `${item.path}?${JSON.stringify(item.query || {})}`;
    if (!seen.has(key)) {
      seen.add(key);
      res.push(item);
    }
  }
  return res.slice(0, 3);
}
