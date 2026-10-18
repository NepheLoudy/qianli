// ============================================================
// 需求标签池（taxonomy）——「勾选 → 规则引擎 → 切片」体系的第一层词汇表
//
// 设计铁律（与曼波 2026-10-05 定稿口径一致）：
//   1. 每个标签必须能回答「映射到什么切片参数」——mapsHint 为空视为设计缺陷；
//   2. 正交分解：方向 × 类型 × 性质等维度独立，组内单选/组间多选；
//   3. 默认不勾 = 常规件一键提交，勾得越多引擎约束越多；
//   4. 词汇表（本文件）与映射规则库（待建 processRules）分离，版本号独立；
//      本文件只有 taxonomyVersion，规则库另有 rulesVersion。
//
// 受力参照系约定（力学标签的基石）：
//   所有方向标签以「模型上传时的摆放姿态」为参照，Z = 竖直向上
//   （CAD 导出的设计姿态通常是使用姿态）。Z 向受力 ≈ 层间受力（最弱方向）。
// ============================================================

const TAXONOMY_VERSION = 'v7'; // v7（2026-10-18 曼波令）：新增「材料特性」组（自润滑/含纤维等 → 耗材选择策略）；环境工况移除「食品接触」（FDM 无认证耗材可选，提示无实义）

/** 选项：{ id, label }；bool/number 字段无 options */
const groups = [
  {
    id: 'load',
    title: '载荷工况',
    tooltip: '零件怎么受力——决定打印朝向与强度布局，是最优先的一组',
    fields: [
      {
        id: 'load_direction',
        type: 'multi',
        title: '受力方向',
        formTitle: '受力方向',
        // 工作朝向指引在字段级（不藏在选项里）：Z = 此件工作时竖直向上的方向
        tooltip: '指引：想象此件【安装使用时的样子】——Z = 工作时竖直向上的方向，X/Y = 工作时的水平两向。可多选（对应不同方向的工况）。Z 向受力≈沿打印层缝方向（最弱），引擎会优先调整打印朝向避开；改不了则强化层间',
        options: [
          { id: 'X', label: 'X 轴' },
          { id: 'Y', label: 'Y 轴' },
          { id: 'Z', label: 'Z 轴' },
          { id: 'multi', label: '多向拟合' },
        ],
        mapsHint: [
          'Z → 优先改打印朝向使受力方向偏离层缝；不可避 → 层高 0.12–0.16、墙数+、热床 +5~10°C 强化层间',
          '多向拟合 → 不强行改朝向，按强度档位补墙/填充',
        ],
      },
      {
        id: 'load_type',
        type: 'multi',
        title: '受力类型',
        formTitle: '受力类型',
        tooltip: '与受力方向对应勾选（多选多对应）：各方向各自是什么工况就勾什么——如「Z 受压 + X 受弯」则同时勾受压+弯曲；引擎对方向×类型组合全量应用规则。悬臂梁=弯曲+剪切；滚压/点接触指滚轮、凸轮从动件等局部接触工况',
        options: [
          { id: 'tension', label: '受拉' },
          { id: 'compression', label: '受压' },
          { id: 'shear', label: '剪切' },
          { id: 'bending', label: '弯曲' },
          { id: 'torsion', label: '扭转' },
          { id: 'contact', label: '滚压/点接触' },
        ],
        mapsHint: [
          'bending/shear → 墙数≥3（受力件4）、填充≥40%（Gyroid/Cubic）、提示 CF 增强材料',
          'torsion → 45° 交叉填充方向、孔轴处加密',
          'contact → PA 系优先、提示嵌滚轮轴承、接触区局部高填充',
        ],
      },
      {
        id: 'load_nature',
        type: 'single',
        title: '载荷性质',
        formTitle: '载荷性质',
        tooltip: '静载=挂住不动；动载疲劳=反复受力（弹簧、锁扣、行驶颠簸）；冲击=磕碰撞击；振动=底盘/发射机构等持续震源',
        options: [
          { id: 'static', label: '静载' },
          { id: 'fatigue', label: '动载疲劳' },
          { id: 'impact', label: '冲击' },
          { id: 'vibration', label: '振动' },
        ],
        mapsHint: [
          'fatigue → 排除直线高填充（应力集中），Gyroid；圆角处理提醒',
          'impact → 材料转 PETG 等韧性系（排除全 CF 脆性）、墙数+',
          'vibration → Gyroid 填充、避薄壁共振、螺接防松提醒',
        ],
      },
      {
        id: 'load_magnitude',
        type: 'single',
        title: '载荷量级',
        formTitle: '载荷量级',
        tooltip: '等效静重估计：轻=小支架/装饰件（<1kg）；中=一般结构件/云台（1–5kg）；重=底盘承重/举升机构（>5kg）',
        options: [
          { id: 'light', label: '轻载' },
          { id: 'medium', label: '中载' },
          { id: 'heavy', label: '重载' },
        ],
        mapsHint: [
          'light → 填充 20%、墙数 2',
          'medium → 填充 40%、墙数 3',
          'heavy → 填充 60%+、墙数 4、材料上 CF/PA 档',
        ],
      },
    ],
  },
  {
    id: 'durability',
    title: '耐久工况',
    tooltip: '要求这零件活多久、在什么老化机制下活——寿命 × 载荷性质组合出蠕变/疲劳风险',
    fields: [
      {
        id: 'service_life',
        type: 'single',
        title: '使用寿命',
        formTitle: '使用寿命',
        tooltip: '一次性=打完即弃的验证件；短期=赛季内（数周）；上场件=比赛上场使用的关键件（跨学期持续服役，可靠性要求最高）。上场件+静载→蠕变风险，上场件+动载→疲劳风险',
        options: [
          { id: 'oneoff', label: '一次性（验证件）' },
          { id: 'short_term', label: '短期（赛季内）' },
          { id: 'long_term', label: '上场件' },
        ],
        mapsHint: [
          'long_term × 静载 → 排除 PLA（蠕变重灾区），PETG/PA/CF 系',
          'long_term × 动载 → 疲劳规则叠加寿命规则',
          'oneoff → 允许降质量快速件（与高速打印协同）',
        ],
      },
      {
        id: 'deflection_scale',
        type: 'scale',
        min: -3,
        max: 3,
        minLabel: '-3 柔顺',
        maxLabel: '+3 刚性',
        title: '刚度/挠度标尺',
        formTitle: '刚度挠度标尺',
        tooltip: '受力工况标尺（-3 ~ +3，0=常规不偏重）：+3 零挠度（精密平台/高刚度支架，宁重勿晃）→ +2 偏刚性 → 0 常规 → -2 偏柔顺 → -3 柔顺弹性（活铰链/卡扣/弹簧片，需反复弹性变形）。标尺驱动：≤-2 走柔性规则（排除 CF、低填充留变形余量），≥+2 走刚性规则（优先 CF）',
        mapsHint: [
          '≤-2 柔性区 → 排除 CF（脆）、低填充、壁薄化、疏支撑便于脱弹臂',
          '≥+2 刚性区 → 优先 CF 增强系、高填充方向',
        ],
      },
      {
        id: 'electrical_insulation',
        type: 'bool',
        title: '电气绝缘',
        formTitle: '电气绝缘',
        tooltip: '用于电气隔离（绝缘垫、接线端子座）。⚠️ 碳纤增强材料导电，此项将强制排除一切 CF 系',
        mapsHint: ['排除一切 CF 系（碳纤维导电，安全级拦截）；普通 PLA/PETG/ABS 均绝缘'],
      },
      {
        id: 'failure_consequence',
        type: 'single',
        title: '失效后果',
        formTitle: '失效后果',
        tooltip: '这零件断了会怎样：仅外观受损（摆件/装饰）→ 常规；影响功能（机构卡滞、返工拆机）→ 强度档位+1；关键安全（人身、贵重设备）→ 最高强度档 + 材料上探 + 建议冗余与人工复检',
        options: [
          { id: 'cosmetic', label: '仅外观受损' },
          { id: 'functional', label: '影响功能' },
          { id: 'critical', label: '关键安全' },
        ],
        mapsHint: [
          'functional → 墙/填充 +1 档',
          'critical → 满配强度（墙 4+、填充 60%+）、材料 CF/PA 上探、朝向保守化、复检提醒',
        ],
      },
      {
        id: 'repeated_assembly',
        type: 'bool',
        title: '反复拆装',
        formTitle: '反复拆装',
        tooltip: '螺纹/卡扣连接处会反复拆装（维修口、迭代验证件）。螺纹牙磨损与卡扣疲劳是主失效模式',
        mapsHint: ['螺纹处加墙、提示热熔铜螺母替代自攻；卡扣悬臂降速打印保弹性'],
      },
    ],
  },
  {
    id: 'fit',
    title: '精度与连接',
    tooltip: '有没有配合面、怎么装到机器人上——决定孔径补偿与局部加固',
    fields: [
      {
        id: 'fit_class',
        type: 'single',
        title: '配合需求',
        formTitle: '配合需求',
        tooltip: '间隙=能装能转（轴孔、活连接）；过盈=压装配（紧配）；精密=配合面有公差要求。螺纹孔请勾下方「连接方式」标注规格',
        options: [
          { id: 'clearance', label: '间隙配合' },
          { id: 'interference', label: '过盈配合' },
          { id: 'precision', label: '精密公差' },
        ],
        mapsHint: [
          '孔径负向补偿 + 外轮廓补偿、外壁降速；interference × ABS 收缩大 → 警告换料或加收缩补偿',
        ],
      },
      {
        id: 'fastener',
        type: 'multi',
        title: '连接方式',
        formTitle: '连接方式',
        tooltip: '可多选。自攻螺钉=直接拧入塑料；机制螺栓=M2/M3/M4 螺栓过孔；热熔铜螺母=烙铁压入预埋件；胶接=粘接面；打印件自配合=多个打印件插接/卡扣装配',
        options: [
          { id: 'self_tapping', label: '自攻螺钉' },
          { id: 'machine_screw', label: '机制螺栓' },
          { id: 'heatset_insert', label: '热熔铜螺母' },
          { id: 'adhesive', label: '胶接' },
          { id: 'printed_interlock', label: '打印件自配合（插接/卡扣）' },
        ],
        mapsHint: [
          'self_tapping → 底孔直径按规格表（M2/M3/M4）、孔周 ≥2 圈墙',
          'machine_screw → 通孔负补偿（公差）',
          'heatset_insert → 孔径按嵌件规格、孔周加固；胶接 → 接触面粗糙化提示（0.2 层高即可）',
          'printed_interlock → 插接面预留 0.2–0.3mm 间隙、孔销负补偿、配合面支撑避让',
        ],
      },
      {
        id: 'dim_tolerance',
        type: 'single',
        title: '关键尺寸公差',
        formTitle: '关键尺寸公差',
        tooltip: '全局尺寸精度要求：紧（±0.1mm，测量/装配精密件）→ 慢速精密档；中（±0.3mm，一般装配）→ 常规；宽松（非关键尺寸）→ 无约束。与「配合需求」不同：这里管全局尺寸，配合管轴孔配合面',
        options: [
          { id: 'tight', label: '紧（±0.1mm）' },
          { id: 'medium', label: '中（±0.3mm）' },
          { id: 'loose', label: '宽松（非关键）' },
        ],
        mapsHint: [
          'tight → 精密档：层高 0.12、外壁降速；ABS 大件收缩提示',
          'medium → 常规档；loose → 不加约束',
        ],
      },
      {
        id: 'post_machining',
        type: 'bool',
        title: '需要后续加工',
        formTitle: '后续加工预留',
        tooltip: '打印完还要钻孔/攻丝/打磨（后处理件）。需要预留加工余量：孔留小料、面留厚料',
        mapsHint: ['打印孔径预留负余量（留钻量）、关键面层数+；「打印后加工」说明写入工艺单'],
      },
    ],
  },
  {
    id: 'surface',
    title: '外观',
    tooltip: '有没有面子要求——支撑策略、层高、接缝的头号决策项',
    fields: [
      {
        id: 'appearance',
        type: 'bool',
        title: '外观件',
        formTitle: '外观件',
        tooltip: '有外观面要求。请在备注注明外观面朝向（如「顶面+前表面」），支撑将避让该面',
        mapsHint: [
          '层高 0.12、顶面 5 层/底面 4 层、接缝 hidden、外壁慢速、熨烫、支撑阈值 45° 避支撑痕、喷嘴 +5°C',
          '与高速打印冲突 → 警告确认（表面质量 vs 工期二选一）',
        ],
      },
      {
        id: 'multi_color',
        type: 'bool',
        title: '多色打印',
        formTitle: '多色打印',
        tooltip: '件本身需要多种颜色：在「颜色」栏用 + 列出全部颜色（如 白色+黑色），材料通常同一种。匹配要求所有颜色在**同一台打印机**的 AMS 里都有装料（逐色找槽、不共槽）；3mf 请在切片器内配好 AMS 颜色映射',
        mapsHint: [
          '颜色栏列全色（+分隔）；分发按「所有颜色同机 AMS 可得」选机；颜色→槽位映射以 3mf 内嵌配置为准',
        ],
      },
      {
        id: 'translucent',
        type: 'bool',
        title: '透光/半透件',
        formTitle: '透光件',
        tooltip: '要求透光/导光（灯罩、光路件、透明外壳）。透光率由填充与层缝散射决定：薄壁+低填充反而雾透均匀',
        mapsHint: ['薄壁 1-2 圈或低填充高融合、层高 0.12、耗材干燥（气泡散射）；材料选透明 PETG/PC'],
      },
    ],
  },
  {
    id: 'thermal',
    title: '热学工况',
    tooltip: '工作环境温度——材料选型的硬门槛（PLA 60°C 软化是第一红线）',
    fields: [
      {
        id: 'temp_class',
        type: 'single',
        title: '耐温等级',
        formTitle: '耐温等级',
        tooltip: '零件工作环境最高温度。常温≤50°C；中温 50–80°C（引擎舱旁、夏天车内）。≥80°C 超出常规机队耗材能力——走人工评审（可能需改材料/机加工）',
        options: [
          { id: 't50', label: '常温（≤50°C）' },
          { id: 't80', label: '中温（50–80°C）' },
        ],
        mapsHint: [
          't80 → 排除 PLA（60°C 玻璃化软化），PETG 起步；≥80°C 需求转人工评审（2026-10-16 曼波令移除高温档）',
        ],
      },
      {
        id: 'thermal_insulation',
        type: 'bool',
        title: '隔热',
        formTitle: '隔热',
        tooltip: '用结构件做隔热屏障。塑料本身导热都低，隔热主要靠结构：密闭气隙分层优于实心',
        mapsHint: ['Gyroid/低密度填充做密闭气隙；避免实心（导热路径短、费料）'],
      },
      {
        id: 'flame_retardant',
        type: 'bool',
        title: '阻燃需求',
        formTitle: '阻燃',
        tooltip: '靠近热源/电气回路需要阻燃（电源周边、电子外壳）。常规 FDM 耗材多数无阻燃认证——提示级，建议查证材料 UL 等级',
        mapsHint: ['提示：需阻燃认证耗材（PC-ABS FR 等）或改金属/钣金方案；常规耗材不支持承诺'],
      },
    ],
  },
  {
    id: 'material_trait',
    title: '材料特性',
    tooltip: '件对耗材的物性要求（自润滑/含纤维等）——直接映射耗材选择策略（优先/排除哪类材料），不直接改切片参数',
    fields: [
      {
        id: 'material_traits',
        type: 'multi',
        title: '材料特性',
        formTitle: '材料特性',
        tooltip: '可多选。特性决定「优先挑哪类耗材」：自润滑→PA 系、含纤维→CF 增强、高耐磨→PA/PETG、导电→碳系；导电与电气绝缘互斥（硬拦截），含纤维+绝缘为软警告',
        options: [
          { id: 'self_lubricating', label: '自润滑/低摩擦' },
          { id: 'fiber_reinforced', label: '含纤维增强' },
          { id: 'wear_resistant', label: '高耐磨' },
          { id: 'conductive', label: '导电/抗静电' },
        ],
        mapsHint: [
          'self_lubricating → 优先 PA 系（自润滑、滑动配合面友好）',
          'fiber_reinforced → 优先 CF 增强系（高刚性/尺寸稳定；提示硬化喷嘴抗磨）',
          'wear_resistant → 耐磨序列 PA>PETG>PLA，优先 PA/PETG',
          'conductive → 碳系增强导电（CF 系）；与电气绝缘硬冲突',
        ],
      },
    ],
  },
  {
    id: 'environment',
    title: '环境工况',
    tooltip: '使用环境对材料的老化影响',
    fields: [
      {
        id: 'oil_resistant',
        type: 'bool',
        title: '耐油/冷却液',
        formTitle: '耐油冷却液',
        tooltip: '会接触润滑油、冷却液、溶剂等',
        mapsHint: ['PP/PA > PETG > ABS；PLA 怕部分溶剂 → 提示换料'],
      },
      {
        id: 'uv_resistant',
        type: 'bool',
        title: '户外/UV',
        formTitle: '户外UV',
        tooltip: '长期日照/户外使用。PLA 怕 UV 与湿热，会脆化',
        mapsHint: ['排除 PLA → ASA/PETG 方向'],
      },
      {
        id: 'humidity_resistant',
        type: 'bool',
        title: '湿热环境',
        formTitle: '湿热环境',
        tooltip: '长期潮湿/水汽环境。注意 PA（尼龙）吸水会膨胀变形',
        mapsHint: ['排除 PA（吸湿变形）或提醒干燥打印与密封处理'],
      },
      {
        id: 'sun_exposure',
        type: 'bool',
        title: '暴晒/强日照',
        formTitle: '暴晒强日照',
        tooltip: '长期露天暴晒（含玻璃后直晒）。UV+高温双杀：PLA 脆化发白、ABS 泛黄——材料层直接排除',
        mapsHint: ['排除 PLA（UV 脆化）；ASA/PC 优先，PETG 次之'],
      },
      {
        id: 'dusty',
        type: 'bool',
        title: '粉尘/颗粒环境',
        formTitle: '粉尘环境',
        tooltip: '沙尘、粉料、木屑等颗粒环境。磨蚀配合面 + 卡入运动副',
        mapsHint: ['表面致密（墙数+1）、避免大孔隙填充外露；配合间隙放宽提示'],
      },
      {
        id: 'waterproof',
        type: 'bool',
        title: '防水/密封',
        formTitle: '防水密封',
        tooltip: '需要气密/水密或密封配合（O 圈、垫片场合）。层缝是渗漏路径',
        mapsHint: ['墙数≥4、层高 0.16 提致密；提示密封面抛光/涂封 + 必要时换 PETG'],
      },
    ],
  },
  {
    id: 'scene',
    title: '使用场景',
    tooltip: '最直观的一组：这是干什么用的件——场景决定工程判断的默认倾向（测试件可糙快、上场件留余量）',
    fields: [
      {
        id: 'scene_usage',
        type: 'multi',
        title: '使用场景',
        formTitle: '使用场景',
        tooltip: '可多选（一个件可以既是机器人项目件又是测试迭代件）。场景是整条链路的上下文标签：拟合分组、材料倾向与人工评审的共同参照',
        options: [
          { id: 'test_iter', label: '测试迭代件' },
          { id: 'infra', label: '基础建设件' },
          { id: 'robot', label: '机器人项目件' },
          { id: 'structural', label: '承力结构件' },
          { id: 'fixture', label: '夹具/工装件' },
          { id: 'enclosure', label: '电子/设备外壳件' },
          { id: 'showcase', label: '外观/展示件' },
          { id: 'teaching', label: '教学演示件' },
          { id: 'spare', label: '备件/替换件' },
        ],
        mapsHint: [
          'test_iter → 与「一次性寿命」协同：放宽质量换速度',
          'structural → 与载荷量级/失效后果联动提示强度档',
          'enclosure → 与电气绝缘/阻燃联动；fixture → 与关键尺寸公差联动',
        ],
      },
    ],
  },
  {
    id: 'efficiency',
    title: '效率与批量',
    tooltip: '工期与数量——高速牺牲表面质量换时间（份数在表单顶部填写）',
    fields: [
      {
        id: 'fast_mode',
        type: 'bool',
        title: '高速打印',
        formTitle: '高速打印',
        tooltip: '用高速度/粗层高换工期（表面质量略降）。会联动加急排队优先级；与外观件互斥，引擎会警告',
        mapsHint: ['高速 profile（层高 0.2+、提速、支撑稀疏化）；联动 isUrgent 排队加权'],
      },
    ],
  },
  {
    id: 'weight',
    title: '重量',
    tooltip: '飞行器/云台末端等重量敏感件',
    fields: [
      {
        id: 'weight_sensitive',
        type: 'bool',
        title: '重量敏感',
        formTitle: '重量敏感',
        tooltip: '对重量有要求（无人机、云台末端、臂末端）。将用低填充+镂空方向设计，强度档位让位于减重',
        mapsHint: ['Gyroid 低填充、顶底壳减至 3 层（壳厚是减重大头）、必要时镂空（人工确认）'],
      },
    ],
  },
  {
    id: 'craft',
    title: '工艺特征',
    tooltip: '几何决定打印难点的「人工确认区」——体检检不到、但打印时是真坑的特征，看一眼模型勾上',
    fields: [
      {
        id: 'thin_wall',
        type: 'bool',
        title: '薄壁件',
        formTitle: '薄壁件',
        tooltip: '存在壁厚 <1.6mm（≈2×喷嘴口径）的区域。薄壁处走线少、强度低，且容易打薄破孔',
        mapsHint: ['薄壁区多墙填满、降速、层高 0.16；必要时提示加厚设计'],
      },
      {
        id: 'long_bridge',
        type: 'bool',
        title: '大跨桥接',
        formTitle: '大跨桥接',
        tooltip: '存在长距离无支撑悬空走线（桥接长度 >30mm）。桥面下垂是主缺陷',
        mapsHint: ['桥接速度降档、桥接风扇满速、提示可加辅助支撑'],
      },
      {
        id: 'tall_slender',
        type: 'bool',
        title: '细长高件',
        formTitle: '细长高件',
        tooltip: '高度与底面尺寸比例大（高瘦件，>5:1）。打印中晃动与倾倒风险',
        mapsHint: ['整体降速、加裙边、必要时提示加支撑塔/分段设计'],
      },
      {
        id: 'fine_detail',
        type: 'bool',
        title: '精细纹理/细节',
        formTitle: '精细细节',
        tooltip: '有微小文字/浮雕/毫米级细节需要还原（铭牌、公仔、微结构）',
        mapsHint: ['层高 0.08–0.12、外壁慢速、提示 0.2 喷嘴选项'],
      },
    ],
  },
  {
    id: 'auto',
    title: '几何体检（自动检测）',
    tooltip: '上传模型后由几何分析自动预勾（孔/悬空/曲面/贴底接触），机器人只提建议——不符合实际就手动取消，勾选与其他组同等参与引擎映射',
    fields: [
      {
        id: 'hole_comp_z',
        type: 'bool',
        title: '通孔补偿·Z 向（竖直孔）',
        formTitle: '通孔补偿Z向',
        tooltip: '自动检测：存在竖直开孔（孔轴≈Z，开在顶/底平面）。竖直孔直径受轮廓收缩——螺孔插不进的重灾区',
        mapsHint: ['竖直孔直径走 xyHoleComp 负补偿（约 -0.1mm）；孔口降速/多壳提圆度'],
      },
      {
        id: 'hole_comp_xy',
        type: 'bool',
        title: '通孔补偿·XY 向（水平孔）',
        formTitle: '通孔补偿XY向',
        tooltip: '自动检测：存在水平开孔（孔轴在 XY 平面，开在侧壁）。水平孔的竖直尺寸受层高/下垂影响，顶部易塌',
        mapsHint: ['水平孔：孔顶悬垂降速+细层高；孔径轮廓补偿同样叠加（xyHoleComp）'],
      },
      {
        id: 'overhang_heavy',
        type: 'bool',
        title: '悬空支撑',
        formTitle: '悬空支撑',
        tooltip: '自动检测：重悬空（近水平朝下面）面积占比高，或上半程存在悬端（悬臂结构）。支撑加密 + 建议确认摆放朝向',
        mapsHint: ['supportDensity 30%（较基准加密）；悬端过高时朝向建议转人工确认'],
      },
      {
        id: 'curved_surface',
        type: 'bool',
        title: '曲面保护',
        formTitle: '曲面保护',
        tooltip: '自动检测：曲面/过渡面（非平面片）占比高。曲面上的支撑疤与层纹最显眼——减少支撑接触、外壁降速保光顺；若曲面是接触/外观面请再补勾「滚压/点接触」或「外观件」',
        mapsHint: ['supportThresholdAngle 放宽到 40°（减少曲面支撑疤）、precise 降速保曲面光顺'],
      },
      {
        id: 'small_footprint',
        type: 'bool',
        title: '小接触面加裙边',
        formTitle: '小接触面加裙边',
        tooltip: '自动检测：贴底接触面积占包围盒占地比例小（尖脚/柱状/球底件），或接触面积绝对值小而件又高——打印中易被碰倒、易翘边，加裙边（brim）固定',
        mapsHint: ['brim=true + 裙边宽 5mm：防倾倒防翘边'],
      },
    ],
  },
];

// ============================================================
// 冲突规则：when（字段值断言，组内 OR、字段间 AND）+ materialMatch（材料正则，可选）
// level=block 表单端拦截；level=warn 警告确认放行
// ============================================================
const CONFLICTS = [
  {
    id: 'temp-vs-pla',
    level: 'block',
    when: { temp_class: ['t80'] },
    materialMatch: /^PLA/i,
    message: '耐温档（50–80°C）与 PLA 系冲突（PLA 60°C 即软化），请换 PETG/ABS/PA 或下调耐温等级',
  },
  {
    id: 'insulation-vs-cf',
    level: 'block',
    when: { electrical_insulation: [true] },
    materialMatch: /CF|碳/i,
    message: '电气绝缘件禁用碳纤增强材料（碳纤维导电），请换普通 PLA/PETG/ABS',
  },
  // 材料特性 × 电气绝缘（2026-10-18）：选项间互斥（非材料串），不需要 materialMatch
  {
    id: 'conductive-vs-insulation',
    level: 'block',
    when: { electrical_insulation: [true], material_traits: ['conductive'] },
    message: '导电/抗静电需求与电气绝缘互斥（导电需碳系填料，绝缘禁碳）——请二选一或转人工评审',
  },
  {
    id: 'fiber-vs-insulation',
    level: 'warn',
    when: { electrical_insulation: [true], material_traits: ['fiber_reinforced'] },
    message: '含纤维增强与电气绝缘冲突风险：机队现有纤维增强均为碳纤（导电），确需绝缘请人工确认玻纤方案',
  },
  {
    id: 'creep-vs-pla',
    level: 'block',
    when: { service_life: ['long_term'], load_nature: ['static'] },
    materialMatch: /^PLA/i,
    message: '长期静载工况下 PLA 蠕变严重（数周即明显松垂），请换 PETG/PA/CF 系或缩短使用寿命',
  },
  {
    id: 'flexible-vs-cf',
    level: 'warn',
    when: { deflection_scale: { max: -2 } },
    materialMatch: /CF|碳/i,
    message: '柔顺弹性工况（标尺 ≤-2）与 CF 增强材料冲突（CF 脆、无法弹性变形），建议确认是否换韧性材料',
  },
  {
    id: 'fast-vs-appearance',
    level: 'warn',
    when: { fast_mode: [true], appearance: [true] },
    message: '高速打印会牺牲表面质量，与「外观件」要求冲突，请确认优先级',
  },
  {
    id: 'interference-vs-abs',
    level: 'warn',
    when: { fit_class: ['interference'] },
    materialMatch: /^ABS/i,
    message: 'ABS 收缩明显，过盈配合公差不易控制，建议改 PETG 或由规则库加收缩补偿',
  },
  {
    id: 'weight-vs-heavy',
    level: 'warn',
    when: { weight_sensitive: [true], load_magnitude: ['heavy'] },
    message: '重量敏感与重载工况存在张力（减重设计 vs 强度档位），引擎将冲突转人工评审',
  },
];

/** 条件命中：数组=值枚举；{min,max}=数值范围（标尺类字段） */
function whenValueHit(value, cond) {
  if (Array.isArray(cond)) {
    if (Array.isArray(value)) return value.some((x) => cond.includes(x)); // multi 字段任一命中
    return cond.includes(value);
  }
  if (cond && typeof cond === 'object') {
    const n = Number(value);
    if (!Number.isFinite(n)) return false;
    if (cond.min !== undefined && n < cond.min) return false;
    if (cond.max !== undefined && n > cond.max) return false;
    return true;
  }
  return false;
}

// ============================================================
// 校验与表单提取
// ============================================================

const fieldsById = new Map();
for (const g of groups) {
  for (const f of g.fields) {
    if (fieldsById.has(f.id)) throw new Error(`[taxonomy] 字段 id 重复: ${f.id}`);
    fieldsById.set(f.id, f);
  }
}

/** 校验一份勾选结果（selection: fieldId → value）。
 * @param {Object} selection
 * @param {Object} [opts] opts.material 材料字符串（如 "PLA-CF"），提供时才做材料类冲突判定
 * @returns {{errors: string[], warnings: string[]}} errors 非空即拦截
 */
function validateSelection(selection, opts = {}) {
  const errors = [];
  const warnings = [];
  if (!selection || typeof selection !== 'object') {
    return { errors: ['勾选内容为空或格式不正确'], warnings };
  }

  for (const [fieldId, value] of Object.entries(selection)) {
    const field = fieldsById.get(fieldId);
    if (!field) {
      errors.push(`未知需求标签: ${fieldId}`);
      continue;
    }
    if (value === undefined || value === null || value === false || value === '') continue;
    if (field.type === 'single') {
      if (!field.options.some((o) => o.id === value)) {
        errors.push(`「${field.title}」选项无效: ${value}`);
      }
    } else if (field.type === 'multi') {
      if (!Array.isArray(value)) {
        errors.push(`「${field.title}」应为多选数组`);
        continue;
      }
      for (const v of value) {
        if (!field.options.some((o) => o.id === v)) {
          errors.push(`「${field.title}」选项无效: ${v}`);
        }
      }
    } else if (field.type === 'scale') {
      const n = Number(value);
      if (!Number.isInteger(n) || n < field.min || n > field.max) {
        errors.push(`「${field.title}」应为 ${field.min}~${field.max} 的整数`);
      }
    } else if (field.type === 'number') {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1 || n > 99) {
        errors.push(`「${field.title}」应为 1–99 的整数`);
      }
    } // bool: truthy 即合法
  }

  for (const rule of CONFLICTS) {
    const hit = Object.entries(rule.when).every(([fieldId, cond]) => whenValueHit(selection[fieldId], cond));
    if (!hit) continue;
    if (rule.materialMatch) {
      if (!opts.material || !rule.materialMatch.test(String(opts.material))) continue;
    }
    (rule.level === 'block' ? errors : warnings).push(rule.message);
  }

  return { errors, warnings };
}

/**
 * 从审批表单字段（parseForm 同款 [{title, value}] 形态）提取标准化勾选。
 * 只消费本池登记的 formTitle，其余字段原样忽略（材料/颜色/附件由既有解析负责）。
 * @returns {{selection: Object, unmatched: string[]}} unmatched=字段匹配上但值无法识别的提示
 */
function selectionFromFormFields(fields) {
  const selection = {};
  const unmatched = [];
  for (const item of fields || []) {
    const title = String(item.title || '').trim();
    const field = [...fieldsById.values()].find((f) => f.formTitle === title);
    if (!field) continue;
    const raw = item.value;
    if (field.type === 'bool') {
      if (/是|需要|有|true|1|y/i.test(String(raw))) selection[field.id] = true;
      else if (/否|不|无|false|0|n/i.test(String(raw))) { /* 显式为否：不写入 */ }
      else unmatched.push(`${title}: 无法识别的布尔值「${raw}」`);
    } else if (field.type === 'single') {
      const label = String(raw || '').trim();
      const opt = field.options.find((o) => o.label === label);
      if (opt) selection[field.id] = opt.id;
      else unmatched.push(`${title}: 选项「${label}」不在标签池内`);
    } else if (field.type === 'multi') {
      // 仅按显式分隔符切分（逗号/顿号/分号）——标签本身可能含空格（如「Z 轴（…）」），不能按空白切
      const labels = Array.isArray(raw) ? raw : String(raw || '').split(/[,，、;；]+/);
      const ids = [];
      for (const label of labels) {
        const opt = field.options.find((o) => o.label === label.trim());
        if (opt) ids.push(opt.id);
        else if (label.trim()) unmatched.push(`${title}: 选项「${label.trim()}」不在标签池内`);
      }
      if (ids.length > 0) selection[field.id] = ids;
    } else if (field.type === 'number') {
      const n = parseInt(String(raw), 10);
      if (Number.isInteger(n)) selection[field.id] = n;
      else unmatched.push(`${title}: 无法识别的数量「${raw}」`);
    } else if (field.type === 'scale') {
      const n = parseInt(String(raw), 10);
      if (Number.isInteger(n) && n >= field.min && n <= field.max) selection[field.id] = n;
      else unmatched.push(`${title}: 标尺值「${raw}」超出 ${field.min}~${field.max}`);
    }
  }
  return { selection, unmatched };
}

/** 窗口输出（GET /api/print/taxonomy）：标签池全景 + 冲突规则可读版 */
function getTaxonomy() {
  // 使用场景顶置（2026-10-18 曼波令：标注工坊与预约台两页均置顶且必填——场景是整条
  // 链路的上下文标签；两页按本顺序渲染，改这一处双页生效）
  const orderedGroups = groups.filter((g) => g.id === 'scene')
    .concat(groups.filter((g) => g.id !== 'scene'));
  return {
    version: TAXONOMY_VERSION,
    convention: '受力方向按此件【工作时】的朝向为准（Z=工作时竖直向上，可多选）；材料可不填——引擎按需求标签反推可用材料（排除/优先）',
    groups: orderedGroups.map((g) => ({
      id: g.id,
      title: g.title,
      tooltip: g.tooltip,
      fields: g.fields.map((f) => ({
        id: f.id,
        type: f.type,
        min: f.min,
        max: f.max,
        minLabel: f.minLabel || null,
        maxLabel: f.maxLabel || null,
        title: f.title,
        formTitle: f.formTitle,
        tooltip: f.tooltip,
        mapsHint: f.mapsHint,
        options: f.options,
      })),
    })),
    conflicts: CONFLICTS.map((c) => ({
      id: c.id,
      level: c.level,
      when: c.when,
      materialMatch: c.materialMatch ? c.materialMatch.source : null,
      message: c.message,
    })),
  };
}

/** 使用场景必填判定（2026-10-18 曼波令：标注工坊与预约台「使用场景」必填）：
 *  scene_usage 为 multi 数组，至少勾选一项即通过 */
function isSceneSelected(selection) {
  const v = selection && selection.scene_usage;
  return Array.isArray(v) ? v.length > 0 : Boolean(v);
}

module.exports = {
  TAXONOMY_VERSION,
  groups,
  CONFLICTS,
  validateSelection,
  selectionFromFormFields,
  getTaxonomy,
  isSceneSelected,
};
