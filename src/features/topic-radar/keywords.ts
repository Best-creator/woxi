/**
 * 选题雷达的中文科普源配置（2026-09-20 换源，替代原海外开发者源）。
 */

/** 科普相关词（相关度主判据） */
export const SCIENCE_TERMS = [
  "科学", "科普", "物理", "化学", "生物", "宇宙", "太空", "航天", "火箭", "nasa", "地球",
  "健康", "医学", "医生", "病毒", "细菌", "疫苗", "癌症", "营养", "睡眠", "大脑", "心理",
  "心理学", "基因", "dna", "进化", "动物", "植物", "昆虫", "恐龙", "海洋", "气候", "天气",
  "地震", "量子", "相对论", "数学", "历史", "考古", "文明", "冷知识", "实验", "研究",
  "人工智能", "ai", "芯片", "电池", "辐射", "紫外线", "维生素", "免疫力", "肠道", "黑洞"
];

/** 好奇结构词（设问/求证/反常识——科普选题的结构特征） */
export const CURIOSITY_TERMS = [
  "为什么", "怎么", "如何", "什么", "竟然", "居然", "真的吗", "假的", "之谜", "秘密",
  "原理", "涨知识", "揭秘", "辟谣", "谣言", "真相", "误解", "错觉", "反常识", "冷门"
];

/** 全民热度词（讨论度加成） */
export const HOT_TERMS = ["热搜", "爆了", "刷屏", "全网", "火了", "冲上", "第一", "热点"];

/**
 * 搜狗微信同行搜索的默认关键词组（每词取第 1 页 10 条）。
 * 匿名通道无法按时间排序（tsn 被重定向、sort 无效），宽泛词的相关度排名里一年以上老文占比极高
 * （实测「冷知识」10/10 是一年前），靠「多词铺量 + SOGOU_MAX_AGE_MS 时间过滤」凑近期条目。
 */
export const SOGOU_KEYWORDS = ["科普", "冷知识", "为什么", "科学", "健康", "心理学", "AI", "宇宙"];

export const ZHIHU_HOT_URL = "https://api.zhihu.com/topstory/hot-list?limit=50";
/**
 * B站用「知识区排行榜」（rid=36）而不是全站热门：全站热门本质是娱乐榜
 * （游戏/动画 55-63 分挤在科普前，真机首跑踩过）；知识区排行里全是科普/知识 UP 主的热门视频。
 * ranking/v2 风控较严（连续请求返回 -352），被拦时回退全站 popular（端点不同、风控独立计数）。
 */
export const BILIBILI_POPULAR_URL = "https://api.bilibili.com/x/web-interface/ranking/v2?rid=36&type=all";
export const BILIBILI_POPULAR_FALLBACK_URL = "https://api.bilibili.com/x/web-interface/popular?ps=40";
export const SOGOU_BASE_URL = "https://weixin.sogou.com";

/** 汇总后的过滤与截断参数 */
export const RADAR_MIN_SCORE = 35;
export const RADAR_MAX_ITEMS = 80;
export const RADAR_TOP_ITEMS = 30;
export const RADAR_BUCKET_ITEMS_PER_SOURCE = 5;

/**
 * 搜狗条目只保留近 N 天（timeConvert 时间戳过滤）。
 * 30 天而非 7 天：宽泛词相关度排序下近期条目占比极低，7 天会几乎归零；
 * 30 天内的同行文章对选题仍有参考价值，且 recency 维度会让它自然沉底。
 */
export const SOGOU_MAX_AGE_MS = 30 * 86_400_000;
