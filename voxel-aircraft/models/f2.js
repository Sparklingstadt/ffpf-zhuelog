(window.VOXEL_MODELS = window.VOXEL_MODELS || {})["f2"] = (function () {
  // 航空自衛隊 F-2A。1m = 3 ボクセル（全長 15.5m → 約 47 ボクセル、翼幅 11.1m → 約 33 ボクセル）。
  // F-16 を拡大改造した単発機で、主翼は大きく後退角が浅い。洋上迷彩（濃淡 2 色の青）。
  // 対艦攻撃装備：翼端 AAM-3、翼下に ASM-2 対艦ミサイルと増槽。
  const palette = {
    blue1: "#3f5f8f", // 迷彩の濃い青
    blue2: "#6a8cbf", // 迷彩の明るい青
    belly: "#93abcf", // 下面の淡い青
    bellyLine: "#7d95ba", // 下面のパネルライン（脚扉など）
    seam: "#33507c", // 上面のパネルライン・動翼のヒンジ線
    radome: "#56677f", // レドーム
    canopy: "#2a3a4a", // キャノピーのガラス
    glare: "#4d6680", // キャノピー上面の映り込み
    frame: "#5574a3", // キャノピー枠（機体色）
    intake: "#14181d", // 空気取り入れ口の奥
    nozzle: "#4b4b4f", // 排気ノズルの外板
    nozzle2: "#3a3a3e", // 排気ノズルの外板（交互の花弁）
    exhaust: "#a8683a", // ノズル奥（焼けた金属）
    hinomaru: "#c8302c",
    white: "#e9ecef", // 日の丸の縁・ミサイル
    dark: "#30343a", // シーカー・アンテナ・ガンポートなど
    pylon: "#6f86ad", // パイロン
    tank: "#7d97c2", // 増槽
  };

  const map = new Map();
  const key = (x, y, z) => x + "," + y + "," + z;
  // z >= 0 側だけ書けば左右対称に置かれる
  function put(x, y, z, c) {
    map.set(key(x, y, z), [x, y, z, c]);
    map.set(key(x, y, -z), [x, y, -z, c]);
  }
  function del(x, y, z) {
    map.delete(key(x, y, z));
    map.delete(key(x, y, -z));
  }
  const has = (x, y, z) => map.has(key(x, y, z));
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp01 = (t) => Math.max(0, Math.min(1, t));
  function inPoly(px, pz, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, zi] = pts[i];
      const [xj, zj] = pts[j];
      if (zi > pz !== zj > pz && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi)
        inside = !inside;
    }
    return inside;
  }

  // x は尾端 0 〜 機首 47 で作り、最後に中心へずらす。'skin' は最後に迷彩か下面色へ塗り分ける。
  const NOSE = 47;
  const CY = 4.5; // 胴体中心の高さ

  // --- 胴体の断面（半幅 a、半高 b、中心 cy、角の丸み n）
  function section(x) {
    if (x <= 2)
      return {
        a: lerp(1.5, 1.75, x / 2),
        b: lerp(1.5, 1.75, x / 2),
        cy: CY,
        n: 2,
      }; // ノズル（後端ですぼまる）
    if (x < 12) {
      const t = (x - 3) / 9;
      return {
        a: lerp(2.0, 2.5, t),
        b: lerp(1.8, 1.9, t),
        cy: CY,
        n: lerp(2, 2.4, t),
      };
    }
    if (x <= 36) return { a: 2.5, b: 1.9, cy: CY, n: 2.4 };
    if (x <= 39) {
      const t = (x - 36) / 3;
      return {
        a: lerp(2.5, 2.2, t),
        b: lerp(1.9, 1.8, t),
        cy: CY,
        n: lerp(2.4, 2, t),
      };
    }
    // レドーム（F-16 より少し長いオジャイブ形）
    const t = (x - 39) / (NOSE + 0.7 - 39);
    const s = Math.sqrt(Math.max(0, 1 - Math.pow(t, 1.8)));
    return { a: 2.2 * s, b: 1.8 * s, cy: lerp(CY, 4.8, t), n: 2 };
  }

  for (let x = 0; x <= NOSE; x++) {
    const { a, b, cy, n } = section(x);
    for (let y = 0; y <= 9; y++) {
      for (let z = 0; z <= 4; z++) {
        const dz = z / (a + 0.4),
          dy = Math.abs(y - cy) / (b + 0.4);
        if (Math.pow(dz, n) + Math.pow(dy, n) > 1) continue;
        let c = "skin";
        if (x <= 2) c = "nozzle";
        else if (x >= 39) c = "radome";
        put(x, y, z, c);
      }
    }
  }
  // ノズルの開口：後端 2 枚をくり抜き、奥を焼けた色にする
  for (let y = 4; y <= 5; y++) {
    for (let z = 0; z <= 1; z++) {
      del(0, y, z);
      del(1, y, z);
      put(2, y, z, "exhaust");
    }
  }

  // --- 腹部インテーク（F-16 と同じく機首下に開口、後方で胴体下面へ溶け込む）
  const IN_FRONT = 35;
  for (let x = 15; x <= IN_FRONT; x++) {
    const bottom = x >= 22 ? 0 : lerp(0, 2.2, (22 - x) / 7);
    const hw = x >= 20 ? 2.0 : lerp(2.0, 1.4, (20 - x) / 5);
    for (let y = Math.round(bottom); y <= 3; y++) {
      for (let z = 0; z <= 2; z++) {
        if (z > hw + 0.3) continue;
        // 下側の角を丸める
        if (z === 2 && y === Math.round(bottom) && hw > 1.5) continue;
        put(x, y, z, "skin");
      }
    }
  }
  // 上唇を少し前へ突き出す（スマイル形の開口）
  for (let z = 0; z <= 1; z++) put(IN_FRONT + 1, 3, z, "skin");
  put(IN_FRONT + 1, 2, 2, "skin");
  // 開口部：前端 2 枚をくり抜いてダクトの奥を暗くする
  for (let y = 1; y <= 2; y++) {
    for (let z = 0; z <= 1; z++) {
      del(IN_FRONT, y, z);
      del(IN_FRONT - 1, y, z);
      put(IN_FRONT - 2, y, z, "intake");
    }
  }

  // --- ブレンデッドボディ：胴体と主翼・ストレーキをなめらかにつなぐ
  // 外縁の半幅 bw(x)。前方は LERX、後方は主翼付け根の後縁まで。
  function blendWidth(x) {
    if (x > 36) return 0;
    if (x >= 28) return lerp(5.2, 2.6, (x - 28) / 8);
    if (x >= 12) return 5.2;
    if (x >= 9) return lerp(3.0, 5.2, (x - 9) / 3);
    return 0;
  }
  for (let x = 9; x <= 36; x++) {
    const bw = blendWidth(x);
    if (bw < 2.6) continue;
    for (let z = 2; z <= Math.round(bw); z++) {
      const t = clamp01((z - 2) / Math.max(1, bw - 2));
      const top = lerp(6.2, 4.0, Math.pow(t, 0.55));
      const bot = lerp(3.0, 4.0, Math.pow(t, 0.8));
      for (let y = Math.round(bot); y <= Math.round(top); y++)
        put(x, y, z, "skin");
    }
  }

  // --- 主翼（F-16 より大きく、前縁後退角は浅い約 33°）
  const W_LE0 = [27.6, 4.5],
    W_LE1 = [20.4, 15.5],
    W_TE1 = [14.2, 15.5],
    W_TE0 = [11.6, 4.5];
  const wing = [W_LE0, W_LE1, W_TE1, W_TE0];
  const wingLE = (z) => lerp(W_LE0[0], W_LE1[0], (z - 4.5) / 11);
  const wingTE = (z) => lerp(W_TE0[0], W_TE1[0], (z - 4.5) / 11);
  for (let x = 10; x <= 28; x++) {
    for (let z = 4; z <= 15; z++) {
      if (!inPoly(x + 0.5, z, wing)) continue;
      put(x, 4, z, "skin");
      // 内翼側は翼厚を 2 層にする（下面色が出る）
      const f = (wingLE(z) - x) / (wingLE(z) - wingTE(z));
      if (z <= 12 && f > 0.1 && f < 0.75) put(x, 3, z, "skin");
    }
  }

  // --- 翼端の AAM-3（白）とランチャー
  for (let x = 13; x <= 19; x++) put(x, 3, 15, "dark");
  for (let x = 10; x <= 22; x++) put(x, 4, 16, "white");
  put(23, 4, 16, "dark");
  for (const x of [10, 11]) {
    put(x, 5, 16, "dark");
    put(x, 3, 16, "dark");
    put(x, 4, 17, "dark");
  }
  for (const x of [20]) {
    put(x, 5, 16, "dark");
    put(x, 3, 16, "dark");
    put(x, 4, 17, "dark");
  }

  // --- 翼下パイロンと搭載物
  // 内側：増槽（十字断面、両端すぼまり）
  for (let x = 18; x <= 23; x++) put(x, 2, 6, "pylon");
  for (let x = 13; x <= 27; x++) {
    put(x, 0, 6, "tank");
    if (x >= 15 && x <= 25) {
      put(x, 1, 6, "tank");
      put(x, -1, 6, "tank");
      put(x, 0, 5, "tank");
      put(x, 0, 7, "tank");
    }
  }
  for (const y of [-1, 1]) {
    put(13, y, 6, "tank");
  } // 尾部の安定板
  // 中間：ASM-2 対艦ミサイル（白、中央翼と尾翼つき）
  for (let x = 16; x <= 21; x++) put(x, 2, 10, "pylon");
  for (let x = 11; x <= 23; x++) put(x, 1, 10, "white");
  put(24, 1, 10, "dark");
  for (const x of [11, 12]) {
    put(x, 0, 10, "dark");
    put(x, 1, 9, "dark");
    put(x, 1, 11, "dark");
  }
  for (const x of [16, 17]) {
    put(x, 1, 9, "white");
    put(x, 1, 11, "white");
    put(x, 0, 10, "white");
  }

  // --- 全遊動式水平尾翼（わずかに下反角）
  const stab = [
    [10.6, 2.0],
    [5.4, 8.7],
    [2.7, 8.7],
    [1.6, 2.0],
  ];
  for (let x = 1; x <= 11; x++) {
    for (let z = 2; z <= 9; z++) {
      if (!inPoly(x + 0.5, z, stab)) continue;
      put(x, z >= 7 ? 3 : 4, z, "skin");
    }
  }
  // 水平尾翼付け根のフェアリング（後端がスピードブレーキ）
  for (let x = 0; x <= 5; x++) {
    put(x, 4, 3, "skin");
    if (x <= 3) put(x, 5, 3, "skin");
  }

  // --- 背部スパイン（キャノピー後方から垂直尾翼の付け根まで）
  for (let x = 10; x <= 29; x++) {
    const top = lerp(6.3, 7.0, clamp01((x - 10) / 19));
    const w = lerp(1.0, 1.8, clamp01((x - 10) / 19));
    for (let y = 6; y <= Math.round(top); y++) {
      for (let z = 0; z <= 2; z++) {
        const dz = z / (w + 0.35),
          dy = (y - 5.5) / (top - 5.5 + 0.3);
        if (dz * dz + dy * dy > 1) continue;
        put(x, y, z, "skin");
      }
    }
  }

  // --- キャノピー（前方風防＋後方 2 分割の 3 枚構成。前方に枠がある）
  const canopyTop = (x) => {
    if (x >= 35) return lerp(9.0, 6.2, (x - 35) / 3.3);
    if (x >= 31) return 9.2;
    return lerp(7.4, 9.2, (x - 28) / 3);
  };
  for (let x = 28; x <= 38; x++) {
    const top = canopyTop(x);
    const w = x >= 35 ? lerp(1.7, 1.0, (x - 35) / 3) : 1.85;
    for (let y = 6; y <= Math.round(top); y++) {
      for (let z = 0; z <= 2; z++) {
        const dz = z / (w + 0.3),
          dy = (y - 5.6) / (top - 5.6 + 0.3);
        if (dz * dz + dy * dy > 1) continue;
        let c = "canopy";
        if (x === 34 || x === 30) c = "frame"; // 風防後端の枠と後部キャノピーの境
        if (y === 6 && z >= 1) c = "frame"; // 下縁のレール
        if (x === 28) c = "skin";
        if (
          c === "canopy" &&
          z === 0 &&
          y === Math.round(top) &&
          x >= 31 &&
          x <= 33
        )
          c = "glare";
        put(x, y, z, c);
      }
    }
  }

  // --- 単垂直尾翼（付け根前方にドーサルフィン、後端にドラッグシュート収納部）
  for (let y = 7; y <= 12; y++) {
    const h = (y - 7) / 5;
    const le = lerp(15.5, 6.6, h);
    const te = lerp(1.6, 3.2, h);
    for (let x = Math.ceil(te); x <= Math.floor(le); x++) {
      let c = "skin";
      if (y === 12)
        c = "dark"; // 尾翼端のアンテナフェアリング
      else if (x === Math.ceil(te) + 2 && y <= 11) c = "seam"; // ラダーのヒンジ線
      put(x, y, 0, c);
    }
  }
  for (let x = 2; x <= 13; x++) put(x, 6, 0, "skin");
  for (let x = 0; x <= 4; x++) {
    put(x, 6, 0, "skin");
    put(x, 7, 0, "skin");
  }
  for (let x = 0; x <= 3; x++) put(x, 6, 1, "skin");
  put(-1, 6, 0, "dark");
  put(-1, 7, 0, "dark"); // ドラッグシュートの扉

  // --- ベントラルフィン（後部胴体下、外向きに傾斜）
  for (let x = 5; x <= 8; x++) {
    put(x, 2, 2, "skin");
    if (x <= 7) put(x, 1, 3, "skin");
  }

  // --- 小物：AOA センサー、背部 UHF アンテナ、腹部アンテナ
  put(37, 5, 3, "seam");
  put(19, 8, 0, "dark");
  put(26, -1, 0, "dark");

  // --- 塗装：迷彩（非対称の値ノイズ）と下面色
  function hash(x, y, z) {
    let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function noise(x, y, z) {
    const xi = Math.floor(x),
      yi = Math.floor(y),
      zi = Math.floor(z);
    const fx = x - xi,
      fy = y - yi,
      fz = z - zi;
    const s = (t) => t * t * (3 - 2 * t);
    const u = s(fx),
      v = s(fy),
      w = s(fz);
    let r = 0;
    for (let dx = 0; dx <= 1; dx++)
      for (let dy = 0; dy <= 1; dy++)
        for (let dz = 0; dz <= 1; dz++) {
          r +=
            hash(xi + dx, yi + dy, zi + dz) *
            (dx ? u : 1 - u) *
            (dy ? v : 1 - v) *
            (dz ? w : 1 - w);
        }
    return r;
  }
  const camo = (x, y, z) =>
    noise(x / 7 + 11.3, y / 5 + 3.1, z / 7 + 7.7) * 0.85 +
      noise(x / 3, y / 3, z / 3) * 0.15 >
    0.52
      ? "blue2"
      : "blue1";

  const color = new Map();
  for (const [x, y, z, c0] of map.values()) {
    let c = c0;
    if (c === "skin") {
      const up = !has(x, y + 1, z);
      const down = !has(x, y - 1, z);
      const inDuct = x >= IN_FRONT - 1 && y <= 0; // くり抜いた開口の下唇は下面色
      if (!inDuct && (up || (!down && y >= section(x).cy - 0.5)))
        c = camo(x, y, z);
      else c = "belly";
    } else if (c === "nozzle") {
      // 花弁を角度で交互に塗る
      const a = Math.atan2(y - CY, z);
      c =
        Math.floor(((a + Math.PI) / (2 * Math.PI)) * 12) % 2
          ? "nozzle2"
          : "nozzle";
    }
    color.set(key(x, y, z), c);
  }
  // 既存のボクセルだけ塗り替える（左右両側）
  function paint(x, y, z, c, onlyIf) {
    for (const zz of z === 0 ? [0] : [z, -z]) {
      const k = key(x, y, zz);
      if (!color.has(k)) continue;
      if (onlyIf && !onlyIf(color.get(k))) continue;
      color.set(k, c);
    }
  }
  const isCamo = (c) => c === "blue1" || c === "blue2";
  const isBelly = (c) => c === "belly";
  const topY = (x, z) => {
    for (let y = 12; y >= 0; y--) if (has(x, y, z)) return y;
    return null;
  };

  // --- パネルライン
  // 主翼：フラッペロンのヒンジ線と外端、前縁フラップの境
  for (let z = 5; z <= 12; z++) {
    const te = wingTE(z),
      le = wingLE(z);
    paint(Math.round(te + (le - te) * 0.24), 4, z, "seam", isCamo);
    if (z >= 6) paint(Math.floor(le) - 1, 4, z, "seam", isCamo);
  }
  for (
    let x = Math.round(wingTE(12));
    x <= Math.round(wingTE(12) + (wingLE(12) - wingTE(12)) * 0.24);
    x++
  )
    paint(x, 4, 12, "seam", isCamo);
  // 水平尾翼の付け根（全遊動式の軸まわり）
  for (let z = 3; z <= 8; z++) {
    const y = z >= 7 ? 3 : 4;
    paint(5, y, z, "seam", isCamo);
  }
  // 胴体上面の継ぎ目（レドーム後方・コクピット後方・エンジン区画）
  for (const x of [12, 22]) {
    for (let z = 0; z <= 3; z++) {
      const y = topY(x, z);
      if (y !== null) paint(x, y, z, "seam", isCamo);
    }
  }
  // 背部の空中給油受油口と M61 機関砲の砲口（左側ストレーキ上面）
  paint(24, topY(24, 0), 0, "dark");
  paint(25, topY(25, 0), 0, "dark");
  for (const x of [29, 30]) {
    const y = topY(x, -3);
    if (y !== null) {
      const k = key(x, y, -3);
      if (color.has(k)) color.set(k, x === 30 ? "dark" : "seam");
    }
  }
  // スピードブレーキの割れ目
  paint(0, 4, 3, "dark");
  paint(0, 5, 3, "dark");
  // 下面：前脚扉と主脚扉の輪郭
  for (let z = -1; z <= 1; z++) {
    paint(28, 0, z, "bellyLine", isBelly);
    paint(32, 0, z, "bellyLine", isBelly);
  }
  for (let x = 13; x <= 19; x++)
    for (let y = 0; y <= 3; y++)
      paint(x, y, 2, "bellyLine", (c) => isBelly(c) && !has(x, y - 1, 2));

  // --- 日の丸：主翼の上下面と後部胴体側面。赤い円に白い縁。
  for (const [x, y, z] of map.values()) {
    const k = key(x, y, z);
    const az = Math.abs(z);
    // 主翼（上面 y=4、下面 y=3 または 1 層の部分）
    if ((y === 4 && !has(x, 5, z)) || (y === 3 && !has(x, 2, z) && az <= 13)) {
      if (az >= 7 && az <= 15) {
        const d = Math.hypot(x - 18, az - 11);
        if (d <= 2.0) color.set(k, "hinomaru");
        else if (d <= 2.75) color.set(k, "white");
      }
    }
    // 後部胴体側面（水平尾翼より上）
    if (
      az >= 1 &&
      !has(x, y, z + Math.sign(z)) &&
      x >= 5 &&
      x <= 9 &&
      y >= 5 &&
      y <= 6 &&
      map.get(k)[3] === "skin"
    ) {
      color.set(k, Math.abs(x - 7) <= 1 ? "hinomaru" : "white");
    }
  }

  const voxels = [];
  for (const [x, y, z] of map.values())
    voxels.push([x - 23, y + 1, z, color.get(key(x, y, z))]);
  return { id: "f2", name: "F-2", palette, voxels };
})();
