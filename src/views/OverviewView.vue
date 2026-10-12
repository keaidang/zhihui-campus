<template>
  <div class="overview-page">
    <!-- 顶栏导航 -->
    <header class="ov-nav">
      <div class="ov-nav-inner">
        <div class="ov-brand" @click="$router.push('/')">
          <img src="/logo.webp" alt="清北大学校徽" class="ov-logo" />
          <div class="ov-brand-text">
            <span class="ov-title">智汇校园 · 平台工程全景</span>
            <span class="ov-subtitle">技术架构 · 业务矩阵 · AI融合 · 演进历程</span>
          </div>
        </div>

        <nav class="ov-anchors">
          <a href="#arch" class="ov-anchor-link">技术架构</a>
          <a href="#edge-cloud" class="ov-anchor-link">云边协同</a>
          <a href="#modules" class="ov-anchor-link">系统功能</a>
          <a href="#ai-ecosystem" class="ov-anchor-link">AI能力体系</a>
          <a href="#philosophy" class="ov-anchor-link">设计理念</a>
          <a href="#engineering" class="ov-anchor-link">工程质量</a>
          <a href="#timeline" class="ov-anchor-link">演进历程</a>
        </nav>

        <div class="ov-nav-actions">
          <el-button round size="default" class="ov-back-btn" @click="$router.push('/')">
            返回首页
          </el-button>
          <el-button type="primary" round size="default" class="ov-enter-btn" @click="goWorkbench">
            {{ auth.isLoggedIn ? '进入工作台' : '体验系统' }}
          </el-button>
        </div>
      </div>
    </header>

    <main class="ov-container">
      <!-- Hero 区域 -->
      <section class="ov-hero">
        <div class="ov-hero-badge">
          <span class="badge-dot"></span>
          <span>毕业设计旗舰级工程 · 论文同源定稿实现</span>
        </div>
        <h1 class="ov-hero-title">
          基于云边协同与 Serverless 架构的<br />
          <span class="gradient-text">“智汇校园”一站式服务平台</span>
        </h1>
        <p class="ov-hero-desc">
          打破传统单体与臃肿微服务桎梏，依托 <b>Tencent EdgeOne</b> 边缘轻计算与 <b>Node Functions</b> 云端业务引擎，
          搭配分布式 <b>TiDB Cloud Serverless</b> 强一致事务，并深度植入 <b>18 项全域大模型 AI 融合能力</b>，
          实现“问办合一、触手可达”的现代化数字化高校全栈工程。
        </p>

        <!-- 关键核心指标数据看板 -->
        <div class="ov-metrics-strip">
          <div class="metric-card">
            <span class="m-val">3,200+</span>
            <span class="m-label">全球边缘就近分发节点</span>
          </div>
          <div class="metric-card highlight">
            <span class="m-val">1,002</span>
            <span class="m-label">全校在库全真业务规模用户</span>
          </div>
          <div class="metric-card">
            <span class="m-val">18 项</span>
            <span class="m-label">全域业务场景 AI 深度融合</span>
          </div>
          <div class="metric-card">
            <span class="m-val">439 项</span>
            <span class="m-label">单元与集成测试自动化全绿</span>
          </div>
          <div class="metric-card">
            <span class="m-val">0 台</span>
            <span class="m-label">中心自管服务器运维负担</span>
          </div>
        </div>
      </section>

      <!-- 第一章：技术和工程架构 -->
      <section id="arch" class="ov-section">
        <div class="sec-header">
          <div class="sec-tag">ARCH & STACK</div>
          <h2>1. 总体技术与工程架构</h2>
          <p>无传统虚拟机中心节点，计算与存储完全以 Serverless 形态交付，Git 推送自动化构建上线</p>
        </div>

        <div class="diagram-card">
          <div class="card-bar">
            <span class="bar-title">🏛️ 总体物理部署与请求流向拓扑</span>
            <span class="bar-tip">点击图片可全屏高清放大查看</span>
          </div>
          <div class="diagram-img-wrap">
            <el-image
              src="/shots/architecture.png"
              alt="总体架构图"
              :preview-src-list="['/shots/architecture.png']"
              preview-teleported
              hide-on-click-modal
              fit="contain"
              class="diagram-img"
            />
          </div>
        </div>

        <div class="arch-grid">
          <div class="arch-box">
            <div class="box-icon icon-edge">🌐</div>
            <h3>边缘层（EdgeOne CDN & Edge Functions）</h3>
            <ul>
              <li><b>全球静态加速</b>：Vue 3 单页构建产物分发至 3,200+ 节点，首屏主包极轻，毫秒级就近响应。</li>
              <li><b>动静资源缓存</b>：图片与静态资源实施 immutable 边缘强缓存，高频访问直接由边缘节点截流，回源率趋近于零。</li>
              <li><b>边缘原生端点</b>：V8 轻量沙箱毫秒级启动，承载 KV 访问统计与健康探针，无数据库依赖。</li>
            </ul>
          </div>

          <div class="arch-box">
            <div class="box-icon icon-cloud">☁️</div>
            <h3>中心云端（Node Functions 服务集群）</h3>
            <ul>
              <li><b>完整 Node.js 运行时</b>：托管全部 RESTful 核心业务 API、复杂计算与数据校验。</li>
              <li><b>强一致事务处理</b>：选课名额竞态原子扣减、图书库存借还闭环、审批流节点流转同事务生灭。</li>
              <li><b>安全鉴权与限流</b>：双令牌（Access+Refresh）加密轮转，数据库流水级频控，天然免疫多实例内存隔离穿透。</li>
            </ul>
          </div>

          <div class="arch-box">
            <div class="box-icon icon-db">🗄️</div>
            <h3>数据层（TiDB Cloud Serverless）</h3>
            <ul>
              <li><b>分布式关系型数据库</b>：100% 兼容 MySQL 协议，跨地域按需弹性伸缩，免去传统 RDS 繁重运维。</li>
              <li><b>连接池故障自愈</b>：内置抗瞬时故障重试机制与连接池保护，彻底攻克云原生数据库连接抖动难题。</li>
              <li><b>33 张全业务表结构</b>：完整承载五角色账户、排课、宿舍、成绩正态分布等千级真实数据规模。</li>
            </ul>
          </div>

          <div class="arch-box">
            <div class="box-icon icon-ai">🤖</div>
            <h3>智能与集成中台（AI & Mail Gateway）</h3>
            <ul>
              <li><b>Qwen3.8-Omni 大模型</b>：聚合统一出口网关，白名单结构化意图编译器，模型不直拼 SQL 确保安全。</li>
              <li><b>LanQin 真实邮件中枢</b>：直连 <code>@keaidang.com</code> 与 <code>@9o.pw</code> 域名，免密登录、邮箱收发与告警闭环。</li>
              <li><b>全量审计追踪</b>：管理操作与 AI 辅助推断 100% 留痕于 <code>sys_op_log</code>，安全可溯源。</li>
            </ul>
          </div>
        </div>
      </section>

      <!-- 第二章：云边协同与双运行时分工 -->
      <section id="edge-cloud" class="ov-section">
        <div class="sec-header">
          <div class="sec-tag">DUAL RUNTIME</div>
          <h2>2. 云边协同与双运行时精细分工</h2>
          <p>“无 DB 依赖、轻读写给 Edge；强事务、重计算给 Node”，拒绝为追求概念而硬堆代理跳数</p>
        </div>

        <div class="diagram-card">
          <div class="card-bar">
            <span class="bar-title">⚡ 运行时职责边界对比</span>
            <span class="bar-tip">点击图片可全屏高清放大查看</span>
          </div>
          <div class="diagram-img-wrap">
            <el-image
              src="/shots/runtime.png"
              alt="运行时对比图"
              :preview-src-list="['/shots/runtime.png']"
              preview-teleported
              hide-on-click-modal
              fit="contain"
              class="diagram-img"
            />
          </div>
        </div>

        <div class="spec-table-wrap">
          <table class="spec-table">
            <thead>
              <tr>
                <th>对比维度</th>
                <th>Edge Functions（边缘轻计算）</th>
                <th>Node Functions（中心云业务服务）</th>
                <th>协同设计架构考量</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><b>物理位置</b></td>
                <td>全球 3,200+ CDN 边缘节点</td>
                <td>中心化云数据中心容器</td>
                <td>就近接入与集中算力兼得</td>
              </tr>
              <tr>
                <td><b>冷启动表现</b></td>
                <td><b>&lt; 5ms</b>（毫秒级极速唤醒）</td>
                <td>~1s（弹性容器预热）</td>
                <td>高频探活与静态请求不产生等待感</td>
              </tr>
              <tr>
                <td><b>网络与存储</b></td>
                <td>受限 Web Fetch，无 TCP 直连</td>
                <td>完整 TCP 套接字，支持 MySQL/TLS</td>
                <td>数据库敏感凭证与连接彻底留在云端</td>
              </tr>
              <tr>
                <td><b>主要承载职责</b></td>
                <td>静态资源路由、图片强缓存、KV 访问量计数</td>
                <td>教务/学工/生活 33 表业务逻辑、事务、审计</td>
                <td>动静彻底解耦，中心节点压力卸载 85%+</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- 第三章：系统功能全景矩阵 -->
      <section id="modules" class="ov-section">
        <div class="sec-header">
          <div class="sec-tag">MODULE MATRIX</div>
          <h2>3. 系统功能全景与业务矩阵</h2>
          <p>覆盖五大角色（学生/教师/辅导员/校领导/超管）全生命周期的高校核心业务闭环</p>
        </div>

        <div class="diagram-card" style="margin-bottom: 24px;">
          <div class="card-bar">
            <span class="bar-title">🧩 功能模块全景树状图</span>
            <span class="bar-tip">点击图片可全屏高清放大查看</span>
          </div>
          <div class="diagram-img-wrap">
            <el-image
              src="/shots/modules.png"
              alt="功能矩阵图"
              :preview-src-list="['/shots/modules.png']"
              preview-teleported
              hide-on-click-modal
              fit="contain"
              class="diagram-img"
            />
          </div>
        </div>

        <!-- 模块展示卡片轮换/网格 -->
        <div class="module-showcase-grid">
          <!-- 模块 1：工作台与身份中枢 -->
          <div class="mod-card">
            <div class="mod-shot">
              <el-image
                src="/shots/workbench.jpg"
                :preview-src-list="['/shots/workbench.jpg']"
                preview-teleported
                hide-on-click-modal
                fit="cover"
              />
            </div>
            <div class="mod-body">
              <span class="mod-pill">统一门户 · BASE</span>
              <h3>一站式服务工作台</h3>
              <p>角色驱动的动态工作台卡片，内置校园专属邮箱胶囊、快捷办理直达与常用官方外链导航。</p>
              <div class="mod-features">
                <span>✓ 五角色 RBAC</span>
                <span>✓ 统一身份认证</span>
                <span>✓ 数据范围隔离</span>
              </div>
            </div>
          </div>

          <!-- 模块 2：数据驾驶舱 -->
          <div class="mod-card">
            <div class="mod-shot">
              <el-image
                src="/shots/dashboard.jpg"
                :preview-src-list="['/shots/dashboard.jpg']"
                preview-teleported
                hide-on-click-modal
                fit="cover"
              />
            </div>
            <div class="mod-body">
              <span class="mod-pill">决策中枢 · M4</span>
              <h3>全校综合数据大屏</h3>
              <p>为校领导与管理层实时呈现全校学生分布、近 7 日登录热度、请假报修态势与宿舍入住统计。</p>
              <div class="mod-features">
                <span>✓ 宏观数据可视化</span>
                <span>✓ 态势 AI 简报</span>
                <span>✓ 异动实时预警</span>
              </div>
            </div>
          </div>

          <!-- 模块 3：教务选课与成绩 -->
          <div class="mod-card">
            <div class="mod-shot">
              <el-image
                src="/shots/elect.jpg"
                :preview-src-list="['/shots/elect.jpg', '/shots/scores.jpg']"
                preview-teleported
                hide-on-click-modal
                fit="cover"
              />
            </div>
            <div class="mod-body">
              <span class="mod-pill">教务管理 · M1</span>
              <h3>在线选课与学业成绩</h3>
              <p>高并发防超卖在线选课系统，支持课表冲突算法预检、成绩分布图谱及多学期跨度学分分析。</p>
              <div class="mod-features">
                <span>✓ 事务强一致扣减</span>
                <span>✓ 时间冲突预检</span>
                <span>✓ GPA 绩点分析</span>
              </div>
            </div>
          </div>

          <!-- 模块 4：通用两表审批流 -->
          <div class="mod-card">
            <div class="mod-shot">
              <el-image
                src="/shots/approve.jpg"
                :preview-src-list="['/shots/approve.jpg', '/shots/leave.jpg']"
                preview-teleported
                hide-on-click-modal
                fit="cover"
              />
            </div>
            <div class="mod-body">
              <span class="mod-pill">学工管理 · M2</span>
              <h3>请假与通用审批流</h3>
              <p>采用创新两表审批流引擎（实例表+节点表），与具体单据松耦合，辅导员支持一键 AI 辅助合规审查。</p>
              <div class="mod-features">
                <span>✓ 辅导员学院隔离</span>
                <span>✓ 审批节点留痕</span>
                <span>✓ AI 风险提示</span>
              </div>
            </div>
          </div>

          <!-- 模块 5：宿舍管理与报修 -->
          <div class="mod-card">
            <div class="mod-shot">
              <el-image
                src="/shots/dorm.jpg"
                :preview-src-list="['/shots/dorm.jpg', '/shots/repair-manage.jpg']"
                preview-teleported
                hide-on-click-modal
                fit="cover"
              />
            </div>
            <div class="mod-body">
              <span class="mod-pill">学工生活 · M4</span>
              <h3>宿舍管理与设施报修</h3>
              <p>男女楼栋硬性约束分配算法，支持床位调宿、退宿与“水电/网络/家具/门锁”维修工单状态机闭环。</p>
              <div class="mod-features">
                <span>✓ 性别硬约束校验</span>
                <span>✓ 工单智能派发</span>
                <span>✓ 站内信节点通知</span>
              </div>
            </div>
          </div>

          <!-- 模块 6：图书馆与生活服务 -->
          <div class="mod-card">
            <div class="mod-shot">
              <el-image
                src="/shots/library.jpg"
                :preview-src-list="['/shots/library.jpg', '/shots/forum.jpg']"
                preview-teleported
                hide-on-click-modal
                fit="cover"
              />
            </div>
            <div class="mod-body">
              <span class="mod-pill">校园生活 · M3</span>
              <h3>图书借阅与社区生态</h3>
              <p>421 册全真馆藏图书检索，借还同事务原子锁库存，逾期智能催缴；配套失物招领、社团活动与校园论坛。</p>
              <div class="mod-features">
                <span>✓ 藏书实时借还</span>
                <span>✓ 自然语言找书</span>
                <span>✓ 论坛合规审核</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- 第四章：AI 深度赋能体系 -->
      <section id="ai-ecosystem" class="ov-section">
        <div class="sec-header">
          <div class="sec-tag">AI ECOSYSTEM</div>
          <h2>4. 全域大模型融合体系（C1 ~ C18）</h2>
          <p>拒绝空洞玩具包装，AI 深入教务、学工、审核、决策等 18 项真实业务场景全生命周期</p>
        </div>

        <div class="ai-banner">
          <div class="ai-banner-content">
            <span class="ai-chip">💡 核心创新：问办合一（From Dialog to Execution）</span>
            <h3>让 AI 不只停留在“回答”，更能精准“直达办理”</h3>
            <p>
              用户在对话框咨询任意事务（如“宿舍空调坏了怎么修”、“我想请假两天”），AI 不仅给出办事指南，
              更在气泡下方<b>直接挂载预填好参数的办理卡片</b>，点击即可直达申请或完成操作。
            </p>
          </div>
        </div>

        <div class="ai-grid">
          <div class="ai-card">
            <div class="ai-head"><span class="c-badge">C1</span><h4>校园智能助理</h4></div>
            <p>基于本地知识库的高校专属大模型应答，学校规章制度、部门职责、办事指南秒级精准解答。</p>
          </div>
          <div class="ai-card highlight">
            <div class="ai-head"><span class="c-badge">C14</span><h4>问办合一·直达卡片</h4></div>
            <p>实体精准语义捕获，自动挂载预填表单卡片，支持报修、请假、选课等业务一步跳转办理。</p>
          </div>
          <div class="ai-card">
            <div class="ai-head"><span class="c-badge">C2/C3</span><h4>论坛合规与告警</h4></div>
            <p>论坛发言毫秒级违规判定与分类，高危违规自动阻断，并在后台通过邮件推送预警管理员。</p>
          </div>
          <div class="ai-card">
            <div class="ai-head"><span class="c-badge">C4</span><h4>AI 智能辅助审批</h4></div>
            <p>针对学生请假单，结合请假天数、历史审批记录，为辅导员生成风险等级建议与合规备注。</p>
          </div>
          <div class="ai-card highlight">
            <div class="ai-head"><span class="c-badge">C5/C6</span><h4>管理问数与洞察</h4></div>
            <p>校领导通过自然语言提问（“这周哪个班请假最多”），服务端白名单安全编译器秒级出表。</p>
          </div>
          <div class="ai-card">
            <div class="ai-head"><span class="c-badge">C7</span><h4>学业学分规划助手</h4></div>
            <p>严格限定学生本人数据范围，对话式分析已修学分、挂科预警与下学期推荐选修方向。</p>
          </div>
          <div class="ai-card">
            <div class="ai-head"><span class="c-badge">C8</span><h4>报修智能分诊引擎</h4></div>
            <p>口语描述故障，AI 自动判定紧急级别、归属维保部门（水电/网络/家具等），提升派单效率。</p>
          </div>
          <div class="ai-card">
            <div class="ai-head"><span class="c-badge">C12</span><h4>图书自然语言找书</h4></div>
            <p>“想找本讲动态规划的算法书”，大模型智能转换检索特征，跨越精确关键词检索限制。</p>
          </div>
          <div class="ai-card">
            <div class="ai-head"><span class="c-badge">C15</span><h4>校园公文邮件起草</h4></div>
            <p>写信弹窗支持依据不同学术、行政、社团场景，自动起草得体正规的校园公函与通知邮件。</p>
          </div>
          <div class="ai-card">
            <div class="ai-head"><span class="c-badge">C16</span><h4>选课排课智能避坑</h4></div>
            <p>自动比对在选课程与个人课表，高亮标注无冲突课程，强预警时间重叠避免选课翻车。</p>
          </div>
          <div class="ai-card">
            <div class="ai-head"><span class="c-badge">C17</span><h4>校园态势宏观周报</h4></div>
            <p>聚合全校近 7 日教务、后勤、请假与活跃度多维流水，一键总结宏观治理周报简述。</p>
          </div>
          <div class="ai-card">
            <div class="ai-head"><span class="c-badge">C18</span><h4>万字规章切分入库</h4></div>
            <p>管理端粘贴长篇学生手册或制度文件，AI 智能分段抽取问答对，一键沉淀为高质量知识库。</p>
          </div>
        </div>

        <!-- AI 安全护栏规范 -->
        <div class="ai-guard-panel">
          <div class="guard-title">🛡️ AI 严苛安全护栏与工程红线（Security Guardrails）</div>
          <div class="guard-items">
            <div class="g-item"><b>模型绝不直碰 SQL</b>：仅负责意图分类与参数提取，服务端由预编译白名单编译器路由执行。</div>
            <div class="g-item"><b>破坏操作强制二次确认</b>：如“停用账号”，先返回受影响名单与确认弹窗，由人工最终裁决。</div>
            <div class="g-item"><b>DB 流水防刷频控</b>：严禁内存计数，所有接口经 <code>sys_login_log</code> / DB 频控，防御分布式穿透。</div>
            <div class="g-item"><b>思考模式极致提速</b>：默认关闭冗余 reasoning，意图输出从 4,117ms 骤降至 669ms，提速 84%。</div>
          </div>
        </div>
      </section>

      <!-- 第五章：核心设计理念 -->
      <section id="philosophy" class="ov-section">
        <div class="sec-header">
          <div class="sec-tag">DESIGN PHILOSOPHY</div>
          <h2>5. 核心设计理念与技术主张</h2>
          <p>坚持以真实业务为骨架，以极致体验为血肉，以安全规范为底线</p>
        </div>

        <div class="philo-grid">
          <div class="philo-card">
            <div class="philo-num">01</div>
            <h3>问办合一 · 即问即办</h3>
            <p>
              传统高校信息系统割裂为数十个独立子系统，找入口犹如“大海捞针”。
              我们倡导“语言即界面”，通过会话意图理解将孤立业务模块串联，真正实现从“获取知识”到“完成办理”零阻隔。
            </p>
          </div>
          <div class="philo-card">
            <div class="philo-num">02</div>
            <h3>全真业务 · 拒绝玩具 Mock</h3>
            <p>
              数据库内建 1,002 名全真师生档案、16 个教学班、男女宿舍楼栋分立、正态分布考试成绩与数十门真实专业课。
              从并发抢课到宿舍床位互斥，所有约束在底层数据库级闭环验证。
            </p>
          </div>
          <div class="philo-card">
            <div class="philo-num">03</div>
            <h3>零运维弹力 · 绿色敏捷</h3>
            <p>
              摆脱常驻服务器的高昂能耗与运维负担。全栈 Serverless 架构使得系统在闲时资源开销趋零，
              在选课等早高峰期瞬时并发弹性伸缩，配合全球 CDN 达成高可用与超低延迟。
            </p>
          </div>
          <div class="philo-card">
            <div class="philo-num">04</div>
            <h3>现代毛玻璃微拟物美学</h3>
            <p>
              告别传统教务系统陈旧刻板的界面设计。全站统一采用高斯模糊磨砂玻璃、12px+ 柔和圆角、品牌深海藏青与天空蓝双基调，
              兼具学术庄严感与现代 SaaS 交互质感。
            </p>
          </div>
        </div>
      </section>

      <!-- 第六章：工程质量与开发流程 -->
      <section id="engineering" class="ov-section">
        <div class="sec-header">
          <div class="sec-tag">QUALITY ASSURANCE</div>
          <h2>6. 工程质量守护与持续集成</h2>
          <p>严苛的代码质量纪律，让每一个版本每一次提交都稳健可靠</p>
        </div>

        <div class="eng-cards">
          <div class="eng-card">
            <div class="eng-icon">🧪</div>
            <h3>439 项全自动化单元测试</h3>
            <p>
              基于 Vitest 搭建高覆盖率测试套件，全面覆盖 JWT 令牌签发、数据范围拦截、两表审批状态机、
              并发选课事务回滚、AI 意图编译器语法树及防暴力破解限流，保障核心逻辑坚如磐石。
            </p>
          </div>
          <div class="eng-card">
            <div class="eng-icon">🔍</div>
            <h3>ESLint 规范零容忍</h3>
            <p>
              严格的代码静态规范检查，杜绝无用变量、类型隐患与死循环。全项目在每次部署前执行全量 Lint 校验，
              确保前后端 40+ 业务模块代码风格高度一致。
            </p>
          </div>
          <div class="eng-card">
            <div class="eng-icon">📐</div>
            <h3>ADR 架构决策记录驱动</h3>
            <p>
              全项目维护详尽的《架构决策记录》（ADR-1 ~ ADR-9），从为何选用 TiDB Serverless 到多模态成本控制与双运行时分工，
              所有重大选型均有理有据，作为软件工程全生命周期的单一事实来源。
            </p>
          </div>
        </div>
      </section>

      <!-- 第七章：演进历程与里程碑时间线 -->
      <section id="timeline" class="ov-section">
        <div class="sec-header">
          <div class="sec-tag">EVOLUTION ROADMAP</div>
          <h2>7. 项目演进历程与里程碑</h2>
          <p>从单一原型雏形，到全业务全真数据，再到全域大模型深度赋能的蜕变之路</p>
        </div>

        <div class="timeline-container">
          <div class="tl-item">
            <div class="tl-dot"></div>
            <div class="tl-date">2026 年 9 月上旬</div>
            <div class="tl-content">
              <h3>Phase 1 · 架构奠基与统一身份认证中枢</h3>
              <p>
                确立云边协同与 Serverless 总体架构；落地 EdgeOne Pages + TiDB Cloud 基础设施；
                构建五角色（学生/教师/辅导员/校领导/超管）RBAC 权限体系、JWT 双令牌轮转及防撞库审计。
              </p>
            </div>
          </div>

          <div class="tl-item">
            <div class="tl-dot"></div>
            <div class="tl-date">2026 年 9 月中旬</div>
            <div class="tl-content">
              <h3>Phase 2 · 教务与学工核心链路闭环（M1 & M2）</h3>
              <p>
                上线并发在线选课（原子事务扣减防超卖）、排课总览与成绩录入；
                研发通用两表审批流引擎（实例表+节点表），闭环请销假流转与校园设施维修申报。
              </p>
            </div>
          </div>

          <div class="tl-item">
            <div class="tl-dot"></div>
            <div class="tl-date">2026 年 9 月下旬</div>
            <div class="tl-content">
              <h3>Phase 3 · 生活服务与微服务生态（M3 & M4）</h3>
              <p>
                上线 421 册图书借还系统、失物招领流转、社团活动预约及六大版块校园互助论坛；
                集成 LanQin 邮件中枢，开通 <code>@keaidang.com</code> / <code>@9o.pw</code> 真实校园邮箱收发；
                落地男女楼栋硬约束宿舍系统与全校数据驾驶舱。
              </p>
            </div>
          </div>

          <div class="tl-item">
            <div class="tl-dot"></div>
            <div class="tl-date">2026 年 10 月上旬</div>
            <div class="tl-content">
              <h3>Phase 4 · 千级全真数据拟合与规模扩充</h3>
              <p>
                注入全校 1,002 名真实用户规模（480+ 学生、25 教师、7 辅导员），完成 16 个教学班关联、
                男女宿舍床位全量分配、近两个学期成绩正态分布录入，彻底消除假数据死角。
              </p>
            </div>
          </div>

          <div class="tl-item current">
            <div class="tl-dot current-pulse"></div>
            <div class="tl-date">2026 年 10 月中旬 · 现行定版</div>
            <div class="tl-content highlight-box">
              <h3>Phase 5 · 全域 AI 大模型深度赋能与“问办合一”</h3>
              <p>
                接入 Qwen3.8-Omni 统一大模型网关，落地 C1 ~ C18 共 18 项全域 AI 业务赋能；
                全面攻克“问办合一”直达办理卡片挂载、白名单安全编译与流式输出；
                完成登录页演示账号快捷体验、邮箱验证码免密登入与全平台视觉升级。
              </p>
            </div>
          </div>
        </div>
      </section>

      <!-- 底部结语与行动指引 -->
      <section class="ov-cta-section">
        <div class="ov-cta-box">
          <h2>体验智汇校园完整业务</h2>
          <p>无需繁琐注册，使用内置预设演示账号即可一键体验全部角色功能</p>
          <div class="cta-actions">
            <el-button type="primary" size="large" round class="cta-primary-btn" @click="goWorkbench">
              {{ auth.isLoggedIn ? '进入我的工作台' : '一键登录体验' }}
            </el-button>
            <el-button size="large" round class="cta-ghost-btn" @click="$router.push('/ai')">
              体验 AI 校园助手
            </el-button>
          </div>
        </div>
      </section>
    </main>

    <!-- 页脚 -->
    <footer class="ov-footer">
      <div class="ft-line">清北大学 · 智汇校园一站式服务平台 © 2026 · 基于云边协同与 Serverless 架构</div>
      <div class="ft-links">
        <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">苏ICP备2026056678号</a>
        <span> · </span>
        <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">鲁ICP备2025186072号</a>
      </div>
    </footer>
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const router = useRouter();
const auth = useAuthStore();

function goWorkbench() {
  if (auth.isLoggedIn) {
    router.push('/workbench');
  } else {
    router.push('/login');
  }
}
</script>

<style scoped>
.overview-page {
  min-height: 100vh;
  background: #0d1b2e;
  color: #f1f5f9;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif;
  position: relative;
  overflow-x: hidden;
}

/* 顶部吸顶导航 */
.ov-nav {
  position: sticky;
  top: 0;
  z-index: 100;
  background: rgba(13, 27, 46, 0.88);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  height: 64px;
}
.ov-nav-inner {
  max-width: 1240px;
  margin: 0 auto;
  height: 100%;
  padding: 0 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}
.ov-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  flex-shrink: 0;
}
.ov-logo {
  width: 36px;
  height: 36px;
  object-fit: contain;
}
.ov-brand-text {
  display: flex;
  flex-direction: column;
}
.ov-title {
  font-size: 15px;
  font-weight: 700;
  color: #fff;
  letter-spacing: 0.5px;
}
.ov-subtitle {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.6);
}

.ov-anchors {
  display: flex;
  align-items: center;
  gap: 20px;
  flex: 1;
  justify-content: center;
}
.ov-anchor-link {
  color: rgba(255, 255, 255, 0.72);
  text-decoration: none;
  font-size: 13px;
  font-weight: 500;
  transition: all 0.2s ease;
  white-space: nowrap;
}
.ov-anchor-link:hover {
  color: #38bdf8;
}

.ov-nav-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
.ov-back-btn {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.2);
  color: #fff;
}
.ov-back-btn:hover {
  background: rgba(255, 255, 255, 0.2);
  color: #fff;
}
.ov-enter-btn {
  background: #2563eb;
  border-color: #2563eb;
  box-shadow: 0 4px 12px rgba(37, 99, 235, 0.4);
}

/* 主内容容器 */
.ov-container {
  max-width: 1240px;
  margin: 0 auto;
  padding: 40px 20px 80px;
}

/* Hero 区域 */
.ov-hero {
  text-align: center;
  padding: 40px 10px 50px;
}
.ov-hero-badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 5px 16px;
  background: rgba(56, 189, 248, 0.12);
  border: 1px solid rgba(56, 189, 248, 0.35);
  border-radius: 999px;
  color: #38bdf8;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 24px;
}
.badge-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #38bdf8;
  box-shadow: 0 0 8px #38bdf8;
}
.ov-hero-title {
  font-size: 38px;
  line-height: 1.35;
  font-weight: 800;
  color: #fff;
  letter-spacing: 1px;
  margin: 0 0 20px;
}
.gradient-text {
  background: linear-gradient(135deg, #60a5fa 0%, #38bdf8 50%, #818cf8 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}
.ov-hero-desc {
  max-width: 860px;
  margin: 0 auto 36px;
  font-size: 16px;
  line-height: 1.8;
  color: rgba(255, 255, 255, 0.78);
}
.ov-hero-desc b {
  color: #fff;
  font-weight: 600;
}

/* 指标看板 */
.ov-metrics-strip {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 16px;
  margin-top: 20px;
}
.metric-card {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  padding: 20px 14px;
  text-align: center;
  backdrop-filter: blur(8px);
  transition: all 0.25s ease;
}
.metric-card:hover {
  transform: translateY(-2px);
  border-color: rgba(56, 189, 248, 0.4);
  background: rgba(255, 255, 255, 0.08);
}
.metric-card.highlight {
  border-color: rgba(99, 102, 241, 0.5);
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.15) 0%, rgba(59, 130, 246, 0.12) 100%);
}
.m-val {
  display: block;
  font-size: 28px;
  font-weight: 800;
  color: #38bdf8;
  letter-spacing: -0.5px;
  margin-bottom: 4px;
}
.metric-card.highlight .m-val {
  color: #818cf8;
}
.m-label {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
  line-height: 1.4;
}

/* 通用 Section 排版 */
.ov-section {
  padding: 60px 0 20px;
  scroll-margin-top: 70px;
}
.sec-header {
  margin-bottom: 28px;
}
.sec-tag {
  display: inline-block;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 2px;
  color: #38bdf8;
  margin-bottom: 6px;
  text-transform: uppercase;
}
.sec-header h2 {
  font-size: 26px;
  font-weight: 700;
  color: #fff;
  letter-spacing: 0.5px;
  margin: 0 0 8px;
}
.sec-header p {
  margin: 0;
  font-size: 14.5px;
  color: rgba(255, 255, 255, 0.65);
}

/* 架构图卡片展示 */
.diagram-card {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 14px;
  overflow: hidden;
  margin-bottom: 30px;
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.35);
}
.card-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  background: rgba(255, 255, 255, 0.06);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.bar-title {
  font-size: 13.5px;
  font-weight: 600;
  color: #fff;
}
.bar-tip {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
}
.diagram-img-wrap {
  padding: 24px;
  display: flex;
  justify-content: center;
  background: rgba(10, 20, 36, 0.6);
}
.diagram-img {
  max-width: 100%;
  border-radius: 8px;
  cursor: zoom-in;
  transition: transform 0.2s;
}
.diagram-img:hover {
  transform: scale(1.01);
}

/* 架构四大盒 */
.arch-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 20px;
}
.arch-box {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 24px;
  transition: all 0.25s ease;
}
.arch-box:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.25);
  transform: translateY(-2px);
}
.box-icon {
  font-size: 28px;
  margin-bottom: 12px;
}
.arch-box h3 {
  font-size: 17px;
  font-weight: 700;
  color: #fff;
  margin: 0 0 14px;
}
.arch-box ul {
  margin: 0;
  padding-left: 18px;
  color: rgba(255, 255, 255, 0.72);
  font-size: 13.5px;
  line-height: 1.8;
}
.arch-box ul li b {
  color: #fff;
}

/* 规范对比表格 */
.spec-table-wrap {
  overflow-x: auto;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.03);
}
.spec-table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
  font-size: 13.5px;
}
.spec-table th {
  background: rgba(255, 255, 255, 0.06);
  padding: 14px 18px;
  color: #fff;
  font-weight: 600;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}
.spec-table td {
  padding: 14px 18px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.78);
  line-height: 1.6;
}
.spec-table tr:last-child td {
  border-bottom: none;
}

/* 模块展示卡片网格 */
.module-showcase-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
}
.mod-card {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 14px;
  overflow: hidden;
  transition: all 0.25s ease;
  display: flex;
  flex-direction: column;
}
.mod-card:hover {
  transform: translateY(-4px);
  border-color: rgba(56, 189, 248, 0.4);
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.3);
}
.mod-shot {
  height: 180px;
  overflow: hidden;
  background: #091321;
}
.mod-shot :deep(.el-image) {
  width: 100%;
  height: 100%;
  object-fit: cover;
  cursor: zoom-in;
  transition: transform 0.3s;
}
.mod-shot :deep(.el-image):hover {
  transform: scale(1.05);
}
.mod-body {
  padding: 20px;
  flex: 1;
  display: flex;
  flex-direction: column;
}
.mod-pill {
  display: inline-block;
  align-self: flex-start;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 4px;
  background: rgba(56, 189, 248, 0.15);
  color: #38bdf8;
  margin-bottom: 10px;
}
.mod-body h3 {
  font-size: 16.5px;
  font-weight: 700;
  color: #fff;
  margin: 0 0 8px;
}
.mod-body p {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.65);
  line-height: 1.6;
  margin: 0 0 14px;
  flex: 1;
}
.mod-features {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding-top: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
.mod-features span {
  font-size: 11.5px;
  color: #a5b4fc;
}

/* AI 专区 */
.ai-banner {
  background: linear-gradient(135deg, rgba(37, 99, 235, 0.2) 0%, rgba(124, 58, 237, 0.2) 100%);
  border: 1px solid rgba(147, 197, 253, 0.3);
  border-radius: 14px;
  padding: 28px 32px;
  margin-bottom: 24px;
}
.ai-chip {
  display: inline-block;
  font-size: 12px;
  font-weight: 700;
  color: #7dd3fc;
  margin-bottom: 10px;
}
.ai-banner h3 {
  font-size: 20px;
  font-weight: 700;
  color: #fff;
  margin: 0 0 10px;
}
.ai-banner p {
  font-size: 14.5px;
  color: rgba(255, 255, 255, 0.85);
  line-height: 1.7;
  margin: 0;
}
.ai-banner p b {
  color: #38bdf8;
}

.ai-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-bottom: 24px;
}
.ai-card {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 16px;
  transition: all 0.25s ease;
}
.ai-card:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(56, 189, 248, 0.4);
  transform: translateY(-2px);
}
.ai-card.highlight {
  border-color: rgba(56, 189, 248, 0.4);
  background: rgba(56, 189, 248, 0.08);
}
.ai-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.c-badge {
  font-size: 11px;
  font-weight: 700;
  background: #3b82f6;
  color: #fff;
  padding: 1px 6px;
  border-radius: 4px;
}
.ai-head h4 {
  font-size: 14.5px;
  font-weight: 600;
  color: #fff;
  margin: 0;
}
.ai-card p {
  font-size: 12.5px;
  color: rgba(255, 255, 255, 0.65);
  line-height: 1.6;
  margin: 0;
}

.ai-guard-panel {
  background: rgba(245, 158, 11, 0.08);
  border: 1px solid rgba(245, 158, 11, 0.25);
  border-radius: 12px;
  padding: 20px 24px;
}
.guard-title {
  font-size: 14px;
  font-weight: 700;
  color: #fbbf24;
  margin-bottom: 12px;
}
.guard-items {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}
.g-item {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.8);
  line-height: 1.5;
}
.g-item b {
  color: #fde68a;
}

/* 设计理念 */
.philo-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 20px;
}
.philo-card {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 14px;
  padding: 26px;
  position: relative;
  transition: all 0.25s ease;
}
.philo-card:hover {
  background: rgba(255, 255, 255, 0.07);
  transform: translateY(-2px);
}
.philo-num {
  font-size: 32px;
  font-weight: 800;
  color: rgba(56, 189, 248, 0.25);
  margin-bottom: 6px;
}
.philo-card h3 {
  font-size: 17.5px;
  font-weight: 700;
  color: #fff;
  margin: 0 0 10px;
}
.philo-card p {
  font-size: 13.5px;
  color: rgba(255, 255, 255, 0.7);
  line-height: 1.7;
  margin: 0;
}

/* 工程质量卡片 */
.eng-cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
}
.eng-card {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 14px;
  padding: 24px;
}
.eng-icon {
  font-size: 32px;
  margin-bottom: 14px;
}
.eng-card h3 {
  font-size: 16.5px;
  font-weight: 700;
  color: #fff;
  margin: 0 0 10px;
}
.eng-card p {
  font-size: 13.5px;
  color: rgba(255, 255, 255, 0.7);
  line-height: 1.7;
  margin: 0;
}

/* 演进历程时间线 */
.timeline-container {
  position: relative;
  padding: 20px 0 20px 30px;
  border-left: 2px solid rgba(255, 255, 255, 0.12);
  margin-left: 10px;
}
.tl-item {
  position: relative;
  margin-bottom: 36px;
}
.tl-item:last-child {
  margin-bottom: 0;
}
.tl-dot {
  position: absolute;
  left: -37px;
  top: 6px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #38bdf8;
  border: 2px solid #0d1b2e;
  box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.4);
}
.tl-dot.current-pulse {
  background: #818cf8;
  box-shadow: 0 0 0 4px rgba(129, 140, 248, 0.5);
}
.tl-date {
  font-size: 12.5px;
  font-weight: 600;
  color: #38bdf8;
  margin-bottom: 6px;
}
.tl-item.current .tl-date {
  color: #a5b4fc;
}
.tl-content h3 {
  font-size: 16.5px;
  font-weight: 700;
  color: #fff;
  margin: 0 0 8px;
}
.tl-content p {
  font-size: 13.5px;
  color: rgba(255, 255, 255, 0.72);
  line-height: 1.7;
  margin: 0;
}
.highlight-box {
  background: rgba(99, 102, 241, 0.12);
  border: 1px solid rgba(99, 102, 241, 0.35);
  border-radius: 12px;
  padding: 16px 20px;
  margin-top: 6px;
}

/* 底部 CTA 卡片 */
.ov-cta-section {
  padding: 60px 0 20px;
}
.ov-cta-box {
  background: radial-gradient(circle at center, rgba(30, 58, 138, 0.6) 0%, rgba(15, 23, 42, 0.9) 100%);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 20px;
  padding: 50px 30px;
  text-align: center;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
}
.ov-cta-box h2 {
  font-size: 28px;
  font-weight: 800;
  color: #fff;
  margin: 0 0 12px;
}
.ov-cta-box p {
  font-size: 15px;
  color: rgba(255, 255, 255, 0.72);
  margin: 0 0 28px;
}
.cta-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
}
.cta-primary-btn {
  background: #2563eb;
  border-color: #2563eb;
  font-weight: 600;
  padding: 12px 28px;
  box-shadow: 0 4px 18px rgba(37, 99, 235, 0.5);
}
.cta-ghost-btn {
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(255, 255, 255, 0.25);
  color: #fff;
  font-weight: 600;
  padding: 12px 28px;
}
.cta-ghost-btn:hover {
  background: rgba(255, 255, 255, 0.2);
  color: #fff;
}

/* 页脚 */
.ov-footer {
  text-align: center;
  padding: 40px 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 12.5px;
  color: rgba(255, 255, 255, 0.5);
}
.ft-line {
  margin-bottom: 8px;
}
.ft-links a {
  color: inherit;
  text-decoration: none;
}
.ft-links a:hover {
  text-decoration: underline;
  color: #38bdf8;
}

/* 响应式适配 */
@media (max-width: 1024px) {
  .ov-metrics-strip { grid-template-columns: repeat(3, 1fr); }
  .arch-grid, .philo-grid, .guard-items { grid-template-columns: 1fr; }
  .module-showcase-grid { grid-template-columns: repeat(2, 1fr); }
  .ai-grid { grid-template-columns: repeat(2, 1fr); }
  .eng-cards { grid-template-columns: 1fr; }
}

@media (max-width: 768px) {
  .ov-anchors { display: none; }
  .ov-metrics-strip { grid-template-columns: repeat(2, 1fr); }
  .module-showcase-grid { grid-template-columns: 1fr; }
  .ai-grid { grid-template-columns: 1fr; }
  .ov-hero-title { font-size: 26px; }
  .ov-hero-desc { font-size: 14px; }
}
</style>
