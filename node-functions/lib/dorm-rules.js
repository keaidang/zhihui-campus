// node-functions/lib/dorm-rules.js — 住宿分配规则（纯函数，便于单测）
//
// 为什么单独成文件：性别楼栋约束原先内联在 api/dorm/index.js 的分配事务里，
// 无法单测；而它是"分配错楼栋"这类问题唯一的拦截点。
//
// 编码约定（全项目一致）：
//   sys_user.gender      0 未知 / 1 男 / 2 女
//   dorm_building.gender 'male' / 'female'（schema-010 已限定）

/**
 * 楼栋性别 → 学生性别编码。
 * ⚠ 非 'male' 一律视为 2（女）——这是**保持与原内联实现逐字节等价**的写法：
 *   原代码为 `(room.gender === 'male' ? 1 : 2)`，对异常值同样落到 2。
 *   楼栋性别由 schema 限定为 male/female，故不影响正常数据。
 */
export function genderCodeOfBuilding(buildingGender) {
  return String(buildingGender || '').toLowerCase() === 'male' ? 1 : 2;
}

/**
 * 学生性别是否可入住该楼栋。
 * - gender === 0（未知）→ 不限制（允许分配，与原实现一致）
 * - 其余 → 必须与楼栋性别编码严格相等
 *
 * ⚠ 必须用**严格相等**而不是先 Number() 归一：原实现是「拒绝条件」
 *   `ug !== 0 && ug !== need`，等价于「允许条件」`ug === 0 || ug === need`。
 *   若改成 Number() 归一，`Number(null) === 0` 会把"性别字段缺失"误判成
 *   "性别未知、不限制"，从而**放行**一次本应拒绝的分配（写测试时抓到的偏差）。
 *   非 0 且不等于楼栋编码的值（null / undefined / 字符串数字）一律拒绝，保守。
 */
export function isGenderMatch(userGender, buildingGender) {
  const need = genderCodeOfBuilding(buildingGender);
  return userGender === 0 || userGender === need;
}
