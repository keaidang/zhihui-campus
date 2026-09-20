// /api/admin/dashboard — M4 数据驾驶舱（leader/admin 只读聚合）
// 一次 GET 返回全校运行态势：用户/教学/学工/宿舍/生活服务/登录趋势/最近动态
// 全部只读聚合查询，无写操作；数据量级校内（数百用户）直接 COUNT，够用且零缓存复杂度
import { ok, jsonError, preflight } from '../../lib/http.js';
import { requireRoles } from '../../lib/guard.js';
import { query } from '../../lib/db.js';

export { preflight as onRequestOptions };

export async function onRequestGet(context) {
  try {
    await requireRoles(context, ['admin', 'leader']);

    // 并发跑聚合查询（互不依赖）
    const [
      userTotal, roleCounts, genderCounts, deptCounts,
      courseCount, classCount, electCount, scoreAgg,
      leaveCounts, repairCounts, pendingApprovals,
      dormBeds, dormBuildingCount,
      libAgg, loanActive, loanOverdue, clubAgg, forumAgg, lfActive,
      loginTrend, recentOps,
    ] = await Promise.all([
      query("SELECT COUNT(*) n FROM sys_user WHERE status = 1 AND EXISTS (SELECT 1 FROM sys_user_role ur JOIN sys_role r ON r.id = ur.role_id WHERE ur.user_id = sys_user.id AND r.code = 'student')"),
      query(
        `SELECT r.code, r.name, COUNT(*) n FROM sys_user_role ur
           JOIN sys_role r ON r.id = ur.role_id
           JOIN sys_user u ON u.id = ur.user_id AND u.status = 1
          GROUP BY r.id ORDER BY r.id`,
      ),
      query("SELECT gender, COUNT(*) n FROM sys_user u JOIN sys_user_role ur ON ur.user_id = u.id JOIN sys_role r ON r.id = ur.role_id WHERE r.code = 'student' AND u.status = 1 GROUP BY gender"),
      query(
        `SELECT d.name, COUNT(*) n FROM sys_user u
           JOIN sys_user_role ur ON ur.user_id = u.id
           JOIN sys_role r ON r.id = ur.role_id AND r.code = 'student'
           JOIN sys_department d ON d.id = u.dept_id
          WHERE u.status = 1 GROUP BY d.id ORDER BY n DESC`,
      ),
      query('SELECT COUNT(*) n FROM edu_course'),
      query('SELECT COUNT(*) n FROM edu_class'),
      query('SELECT COUNT(*) n FROM edu_elect'),
      query('SELECT COUNT(*) n, ROUND(AVG(score), 1) avg, MAX(score) max, MIN(score) min FROM edu_elect WHERE score IS NOT NULL'),
      query('SELECT status, COUNT(*) n FROM af_leave GROUP BY status'),
      query('SELECT status, COUNT(*) n FROM af_repair GROUP BY status'),
      query("SELECT COUNT(*) n FROM flow_instance WHERE status = 1"),
      query(
        `SELECT COALESCE(SUM(r.capacity), 0) total, COALESCE(SUM(r.occupied), 0) used
           FROM dorm_room r WHERE r.status = 1`,
      ),
      query('SELECT COUNT(*) n FROM dorm_building'),
      query('SELECT COUNT(*) n, COALESCE(SUM(total_copies), 0) copies FROM lib_book'),
      query('SELECT COUNT(*) n FROM lib_loan WHERE status = 0'),
      query('SELECT COUNT(*) n FROM lib_loan WHERE status = 0 AND due_at < NOW()'),
      query("SELECT (SELECT COUNT(*) FROM club_application WHERE status = 0) pending, (SELECT COUNT(*) FROM club_recruit WHERE status = 1) recruiting, (SELECT COUNT(*) FROM club_booking WHERE canceled_at IS NULL) bookings"),
      query("SELECT (SELECT COUNT(*) FROM forum_thread WHERE status = 1) threads, (SELECT COUNT(*) FROM forum_reply WHERE status = 1) replies, (SELECT COUNT(*) FROM forum_thread WHERE status = 1 AND created_at > NOW() - INTERVAL 24 HOUR) new24h"),
      query('SELECT COUNT(*) n FROM lf_item WHERE status = 1'),
      query(
        // 趋势按「北京日期」分桶：库内 created_at 是 UTC 墙钟，直接 DATE() 会把 00:00-08:00 算进前一天
        `SELECT DATE(CONVERT_TZ(created_at, '+00:00', '+08:00')) d, COUNT(*) n FROM sys_login_log
          WHERE success = 1 AND created_at > NOW() - INTERVAL 7 DAY
          GROUP BY DATE(CONVERT_TZ(created_at, '+00:00', '+08:00')) ORDER BY d`,
      ),
      query(
        // createdAt 原样返回真实瞬时（ISO 带 Z），前端 fmtTime() 转北京时间显示
        `SELECT o.action, o.target, o.detail, o.created_at AS createdAt, u.real_name AS operator
           FROM sys_op_log o LEFT JOIN sys_user u ON u.id = o.operator_id
          WHERE o.action <> 'error.500'
          ORDER BY o.id DESC LIMIT 10`,
      ),
    ]);

    const roleMap = Object.fromEntries(roleCounts.map((r) => [r.code, Number(r.n)]));
    const leaveMap = Object.fromEntries(leaveCounts.map((r) => [`s${r.status}`, Number(r.n)]));
    const repairMap = Object.fromEntries(repairCounts.map((r) => [`s${r.status}`, Number(r.n)]));

    return ok({
      users: {
        students: roleMap.student || 0,
        teachers: roleMap.teacher || 0,
        counselors: roleMap.counselor || 0,
        leaders: roleMap.leader || 0,
        admins: roleMap.admin || 0,
        gender: genderCounts.map((g) => ({ gender: Number(g.gender), n: Number(g.n) })),
      },
      depts: deptCounts.map((d) => ({ name: d.name, n: Number(d.n) })),
      edu: {
        courses: Number(courseCount[0].n),
        classes: Number(classCount[0].n),
        electives: Number(electCount[0].n),
        scored: Number(scoreAgg[0].n),
        scoreAvg: scoreAgg[0].avg === null ? null : Number(scoreAgg[0].avg),
      },
      affairs: {
        leave: { pending: leaveMap.s1 || 0, approved: leaveMap.s2 || 0, rejected: leaveMap.s3 || 0, done: leaveMap.s4 || 0 },
        repair: { pending: repairMap.s0 || 0, processing: repairMap.s1 || 0, done: repairMap.s2 || 0 },
        pendingApprovals: Number(pendingApprovals[0].n),
      },
      dorm: {
        buildings: Number(dormBuildingCount[0].n),
        bedsTotal: Number(dormBeds[0].total),
        bedsUsed: Number(dormBeds[0].used),
      },
      life: {
        books: Number(libAgg[0].n),
        bookCopies: Number(libAgg[0].copies),
        loansActive: Number(loanActive[0].n),
        loansOverdue: Number(loanOverdue[0].n),
        clubPending: Number(clubAgg[0].pending),
        clubRecruiting: Number(clubAgg[0].recruiting),
        clubBookings: Number(clubAgg[0].bookings),
        forumThreads: Number(forumAgg[0].threads),
        forumReplies: Number(forumAgg[0].replies),
        forumNew24h: Number(forumAgg[0].new24h),
        lfActive: Number(lfActive[0].n),
      },
      loginTrend: loginTrend.map((r) => ({ date: r.d, n: Number(r.n) })),
      recentOps,
    });
  } catch (e) {
    return jsonError(e);
  }
}
