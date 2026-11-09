import type { AspectParticleUsage } from "./aspect-particle-quiz";

// Authored questions, twelve of each choice. Where two particles both make a
// sentence (我去了北京／我去过北京), the Japanese meaning names one: 〜た for
// 了, 〜たことがある for 过, 〜ている・〜ながら for 着. なし covers habits
// (每天, 常常), negation with 没, plans, verbs that take no particle (觉得,
// 是, 希望) and the first verb of two in a row (去超市买).
export const ASPECT_PARTICLE_USAGES: readonly AspectParticleUsage[] = [
  // 了: a completed action, or a change of state at the end of the sentence.
  {
    id: "aspect-01",
    prompt: "我昨天买（　）一件新衣服。",
    answer: "了",
    translation: "昨日、新しい服を一着買いました。",
  },
  {
    id: "aspect-02",
    prompt: "他一口气喝（　）三杯咖啡。",
    answer: "了",
    translation: "彼は一気にコーヒーを三杯飲みました。",
  },
  {
    id: "aspect-03",
    prompt: "春天来（　），天气越来越暖和了。",
    answer: "了",
    translation: "春が来て、だんだん暖かくなってきました。",
  },
  {
    id: "aspect-04",
    prompt: "电影已经开始（　），我们快进去吧。",
    answer: "了",
    translation: "映画はもう始まりました。早く入りましょう。",
  },
  {
    id: "aspect-05",
    prompt: "下（　）课我就给你打电话。",
    answer: "了",
    translation: "授業が終わったら、すぐに電話します。",
  },
  {
    id: "aspect-06",
    prompt: "我昨天晚上看（　）两个小时的电视。",
    answer: "了",
    translation: "昨日の夜、テレビを2時間見ました。",
  },
  {
    id: "aspect-07",
    prompt: "天黑（　），我们回家吧。",
    answer: "了",
    translation: "暗くなったので、家に帰りましょう。",
  },
  {
    id: "aspect-08",
    prompt: "我的手机坏（　），我想买个新的。",
    answer: "了",
    translation: "携帯電話が壊れたので、新しいのを買いたいです。",
  },
  {
    id: "aspect-09",
    prompt: "他喝醉（　），一句话也说不清楚。",
    answer: "了",
    translation: "彼は酔っぱらって、一言もはっきり話せません。",
  },
  {
    id: "aspect-10",
    prompt: "弟弟这一年长高（　）不少。",
    answer: "了",
    translation: "弟はこの一年でずいぶん背が伸びました。",
  },
  {
    id: "aspect-11",
    prompt: "他终于找到（　）工作。",
    answer: "了",
    translation: "彼はとうとう仕事を見つけました。",
  },
  {
    id: "aspect-12",
    prompt: "我等（　）他半个小时，他还没来。",
    answer: "了",
    translation: "彼を30分待ちましたが、まだ来ません。",
  },
  // 过: an experience, something that has happened at least once.
  {
    id: "aspect-13",
    prompt: "我去（　）两次北京。",
    answer: "过",
    translation: "北京には2回行ったことがあります。",
  },
  {
    id: "aspect-14",
    prompt: "你吃（　）北京烤鸭吗？",
    answer: "过",
    translation: "北京ダックを食べたことがありますか。",
  },
  {
    id: "aspect-15",
    prompt: "我从来没见（　）这么大的雪。",
    answer: "过",
    translation: "こんな大雪は一度も見たことがありません。",
  },
  {
    id: "aspect-16",
    prompt: "他小时候学（　）钢琴。",
    answer: "过",
    translation: "彼は子どものころ、ピアノを習ったことがあります。",
  },
  {
    id: "aspect-17",
    prompt: "我们以前见（　）面，你还记得吗？",
    answer: "过",
    translation: "私たちは以前会ったことがありますが、覚えていますか。",
  },
  {
    id: "aspect-18",
    prompt: "这本小说我看（　）两遍。",
    answer: "过",
    translation: "この小説は2回読んだことがあります。",
  },
  {
    id: "aspect-19",
    prompt: "我没听说（　）这个地方。",
    answer: "过",
    translation: "その場所のことは聞いたことがありません。",
  },
  {
    id: "aspect-20",
    prompt: "他曾经在日本工作（　）三年。",
    answer: "过",
    translation: "彼はかつて日本で3年働いたことがあります。",
  },
  {
    id: "aspect-21",
    prompt: "你爬（　）富士山没有？",
    answer: "过",
    translation: "富士山に登ったことがありますか。",
  },
  {
    id: "aspect-22",
    prompt: "这件事我跟他提（　），他好像忘了。",
    answer: "过",
    translation: "このことは彼に話したことがあるのですが、忘れたようです。",
  },
  {
    id: "aspect-23",
    prompt: "我还没坐（　）飞机。",
    answer: "过",
    translation: "まだ飛行機に乗ったことがありません。",
  },
  {
    id: "aspect-24",
    prompt: "这个菜我以前做（　），不太难。",
    answer: "过",
    translation: "この料理は以前作ったことがあります。あまり難しくありません。",
  },
  // 着: a state that lasts, or the manner of a second action.
  {
    id: "aspect-25",
    prompt: "门开（　），请进吧。",
    answer: "着",
    translation: "ドアは開いています。どうぞ入ってください。",
  },
  {
    id: "aspect-26",
    prompt: "她抱（　）一只小猫。",
    answer: "着",
    translation: "彼女は子猫を抱いています。",
  },
  {
    id: "aspect-27",
    prompt: "他在沙发上躺（　）看电视。",
    answer: "着",
    translation: "彼はソファーに寝転んでテレビを見ています。",
  },
  {
    id: "aspect-28",
    prompt: "她笑（　）说：“欢迎欢迎！”",
    answer: "着",
    translation: "彼女は笑いながら「ようこそ」と言いました。",
  },
  {
    id: "aspect-29",
    prompt: "外面下（　）大雨，你带伞了吗？",
    answer: "着",
    translation: "外は大雨が降っています。傘を持ってきましたか。",
  },
  {
    id: "aspect-30",
    prompt: "他戴（　）一副眼镜。",
    answer: "着",
    translation: "彼は眼鏡をかけています。",
  },
  {
    id: "aspect-31",
    prompt: "别站（　），快坐下吧。",
    answer: "着",
    translation: "立っていないで、早く座ってください。",
  },
  {
    id: "aspect-32",
    prompt: "孩子们唱（　）歌走进了教室。",
    answer: "着",
    translation: "子どもたちは歌を歌いながら教室に入ってきました。",
  },
  {
    id: "aspect-33",
    prompt: "房间里的灯还亮（　）。",
    answer: "着",
    translation: "部屋の明かりがまだついています。",
  },
  {
    id: "aspect-34",
    prompt: "他手里拿（　）一束花。",
    answer: "着",
    translation: "彼は手に花束を持っています。",
  },
  {
    id: "aspect-35",
    prompt: "她低（　）头，一句话也不说。",
    answer: "着",
    translation: "彼女はうつむいたまま、一言も話しません。",
  },
  {
    id: "aspect-36",
    prompt: "他红（　）脸，半天说不出话来。",
    answer: "着",
    translation: "彼は顔を赤くして、しばらく言葉が出てきませんでした。",
  },
  // なし: nothing goes in the blank.
  {
    id: "aspect-37",
    prompt: "我每天早上喝（　）一杯牛奶。",
    answer: "なし",
    translation: "毎朝、牛乳を一杯飲みます。",
  },
  {
    id: "aspect-38",
    prompt: "以前我常常去（　）那家咖啡馆。",
    answer: "なし",
    translation: "以前はよくあのカフェに行っていました。",
  },
  {
    id: "aspect-39",
    prompt: "我昨天没去（　）学校。",
    answer: "なし",
    translation: "昨日は学校に行きませんでした。",
  },
  {
    id: "aspect-40",
    prompt: "明天我们去（　）动物园吧。",
    answer: "なし",
    translation: "明日、動物園に行きましょう。",
  },
  {
    id: "aspect-41",
    prompt: "我去（　）超市买了一些水果。",
    answer: "なし",
    translation: "スーパーに行って、果物を少し買いました。",
  },
  {
    id: "aspect-42",
    prompt: "我觉得（　）这部电影很有意思。",
    answer: "なし",
    translation: "この映画はとても面白いと思います。",
  },
  {
    id: "aspect-43",
    prompt: "他是（　）我的大学同学。",
    answer: "なし",
    translation: "彼は私の大学の同級生です。",
  },
  {
    id: "aspect-44",
    prompt: "我打算（　）明年去中国留学。",
    answer: "なし",
    translation: "来年、中国へ留学するつもりです。",
  },
  {
    id: "aspect-45",
    prompt: "她很喜欢（　）打网球。",
    answer: "なし",
    translation: "彼女はテニスをするのがとても好きです。",
  },
  {
    id: "aspect-46",
    prompt: "我希望（　）你明天能来。",
    answer: "なし",
    translation: "明日、あなたが来られるといいなと思います。",
  },
  {
    id: "aspect-47",
    prompt: "他每个周末都打扫（　）房间。",
    answer: "なし",
    translation: "彼は毎週末、部屋を掃除します。",
  },
  {
    id: "aspect-48",
    prompt: "下个月我要去（　）上海出差。",
    answer: "なし",
    translation: "来月、上海へ出張に行きます。",
  },
];
