(window.VOXEL_MODELS = window.VOXEL_MODELS || {})["su37"] = (function () {
  // Su-37 Terminator（試作機 "711"）。高精細版：1m = 6 ボクセル（全長 22.2m → 約 133 ボクセル）。
  // 形状は「1/3m 単位」（以下 u）の連続座標で定義し、1u = 2 ボクセルの格子で標本化する。
  // 外から見えない内部のボクセルは最後に取り除く。
  const palette = {
    body: "#c9b98f", // 砂色（迷彩の地色）
    brown: "#8a6a45", // 迷彩の茶
    green: "#6f7a52", // 迷彩の緑
    bodyD: "#ad9e74", // パネルライン（砂色の上）
    brownD: "#6f5435", // パネルライン（茶の上）
    greenD: "#596340", // パネルライン（緑の上）
    belly: "#d6ccb0", // 下面の明るい砂色
    canopy: "#2a3a4a", // キャノピーのガラス
    glint: "#4d6680", // ガラスの映り込み
    frame: "#5a5446", // キャノピー枠
    irst: "#7fa3b8", // IRST 球（ガラス）
    radome: "#d8d2bf", // レドーム
    intake: "#1c2024", // 空気取り入れ口の奥
    nozzle: "#4d4a46", // 推力偏向ノズル（花弁）
    petal: "#66615a", // 花弁の継ぎ目
    hot: "#7a6a5c", // ノズル付け根の焼けた金属
    exhaust: "#b0703a", // ノズル奥
    cone: "#3a2c22", // ノズル奥のコーン
    dark: "#3d3a33", // スティンガー先端・翼端レール・ピトー管など
    star: "#b8322a", // 垂直尾翼の赤い星
    num: "#2f3a48", // 機番 "711"
    missile: "#e4e2da", // ミサイル
    seeker: "#4a4f55", // ミサイルのシーカー
  };

  const F = 2; // 1u あたりのボクセル数
  const map = new Map();
  const key = (X, Y, Z) => X + "," + Y + "," + Z;

  // --- 迷彩：格子点のハッシュを滑らかに補間した値ノイズ（u 座標で評価、左右で模様が変わる）
  function hash(i, j, k) {
    let h = (i * 374761393 + j * 668265263 + k * 1274126177) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  }
  function noise(x, y, z) {
    const xi = Math.floor(x),
      yi = Math.floor(y),
      zi = Math.floor(z);
    const s = (t) => t * t * (3 - 2 * t);
    const u = s(x - xi),
      v = s(y - yi),
      w = s(z - zi);
    let n = 0;
    for (let a = 0; a <= 1; a++)
      for (let b = 0; b <= 1; b++)
        for (let c = 0; c <= 1; c++) {
          n +=
            hash(xi + a, yi + b, zi + c) *
            (a ? u : 1 - u) *
            (b ? v : 1 - v) *
            (c ? w : 1 - w);
        }
    return n;
  }
  function camo(X, Y, Z) {
    const x = X / F,
      y = Y / F,
      z = Z / F;
    const n =
      0.7 * noise(x / 7, y / 6, z / 7) +
      0.3 * noise(x / 3 + 17, y / 3, z / 3 + 5);
    if (n > 0.62) return "brown";
    if (n < 0.37) return "green";
    return "body";
  }
  const CAMO = { body: 1, brown: 1, green: 1 };
  // 'camo' は迷彩色、'line' はその場所の迷彩色を一段暗くしたパネルライン
  function resolve(X, Y, Z, c) {
    if (c === "camo") return camo(X, Y, Z);
    if (c === "line") return camo(X, Y, Z) + "D";
    return c;
  }
  function set(X, Y, Z, c) {
    map.set(key(X, Y, Z), [X, Y, Z, resolve(X, Y, Z, c)]);
  }
  // Z >= 0 側だけ書けば左右対称に置かれる
  function put(X, Y, Z, c) {
    set(X, Y, Z, c);
    if (Z !== 0) set(X, Y, -Z, c);
  }
  const get = (X, Y, Z) => map.get(key(X, Y, Z));
  const has = (X, Y, Z) => map.has(key(X, Y, Z));

  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp01 = (t) => Math.max(0, Math.min(1, t));
  const ramp = (x, x0, x1, v0, v1) =>
    lerp(v0, v1, clamp01((x - x0) / (x1 - x0)));
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
  // u 座標の箱の中のボクセルを走査し、fn が返した色で埋める（z >= 0 側のみ、put で鏡映）
  function fill(x0, x1, y0, y1, z0, z1, fn) {
    for (let X = Math.ceil(x0 * F); X <= Math.floor(x1 * F); X++) {
      for (let Y = Math.ceil(y0 * F); Y <= Math.floor(y1 * F); Y++) {
        for (
          let Z = Math.max(0, Math.ceil(z0 * F));
          Z <= Math.floor(z1 * F);
          Z++
        ) {
          const c = fn(X / F, Y / F, Z / F, X, Y, Z);
          if (c) put(X, Y, Z, c);
        }
      }
    }
  }

  // x は尾端（スティンガー先端）0 〜 機首 66.5u。
  const NOSE = 66.5;

  // ===== 胴体（機首〜スティンガー）。楕円断面で、機首はわずかに垂れる。
  function section(x) {
    if (x >= 56) {
      const t = (x - 56) / (NOSE - 56);
      const s = Math.pow(Math.max(0, 1 - Math.pow(t, 1.8)), 0.75);
      return { a: 3.1 * s, b: 2.9 * s, cy: lerp(5.2, 4.7, t) };
    }
    if (x >= 36)
      return {
        a: ramp(x, 36, 56, 3.5, 3.1),
        b: ramp(x, 36, 56, 3.1, 2.9),
        cy: ramp(x, 36, 56, 5.5, 5.2),
      };
    if (x >= 14)
      return {
        a: ramp(x, 14, 36, 2.6, 3.5),
        b: ramp(x, 14, 36, 2.2, 3.1),
        cy: 5.5,
      };
    // テールスティンガー（ナセルの間を後ろへ長く伸びる）
    return {
      a: ramp(x, 0, 14, 1.0, 2.6),
      b: ramp(x, 0, 14, 0.9, 2.2),
      cy: ramp(x, 0, 14, 5.2, 5.5),
    };
  }
  const FUSE_LINES = new Set([20, 27, 34, 43.5].map((u) => Math.round(u * F)));
  fill(0, NOSE, 1, 9, 0, 4, (x, y, z, X) => {
    const { a, b, cy } = section(x);
    if (a <= 0.05) return null;
    const dz = z / a,
      dy = (y - cy) / b;
    if (dz * dz + dy * dy > 1) return null;
    if (x >= 58) return X === 116 ? "line" : "radome";
    if (x <= 1) return "dark";
    if (FUSE_LINES.has(X)) return "line";
    return "camo";
  });
  // ピトー管
  for (let X = 133; X <= 138; X++) put(X, 9, 0, "dark");
  // ドラッグシュート収納部（スティンガー上面のふくらみ）
  fill(1.5, 6, 5.5, 7, 0, 1, (x, y, z) => {
    const top = 6 + 0.8 * Math.sin(clamp01((x - 1.5) / 4.5) * Math.PI);
    return y <= top && z <= 0.9 ? (x < 2.2 ? "dark" : "camo") : null;
  });

  // ===== 単座バブルキャノピーと背部のフェアリング（エアブレーキ付き）
  fill(30, 55.5, 7.5, 11.2, 0, 2.4, (x, y, z, X, Y, Z) => {
    let top, w;
    if (x >= 44) {
      top = 8.2 + 2.8 * Math.sin(clamp01((x - 40) / 15) * Math.PI);
      w = ramp(x, 50, 55.5, 2.2, 1.0);
    } else {
      top = ramp(x, 30, 44, 8.4, 10.6);
      w = ramp(x, 30, 44, 1.6, 2.2);
    }
    const dz = z / w,
      dy = (y - 7.5) / (top - 7.5);
    if (dz * dz + dy * dy > 1) return null;
    if (x >= 44) {
      if (X === 88 || X === 89 || X === 104) return "frame"; // 後端と風防の枠
      if (y < 8.1) return "frame"; // キャノピーの縁
      if (X >= 92 && X <= 95 && Z === 1 && Y >= 20) return "glint";
      return "canopy";
    }
    // エアブレーキの輪郭
    if ((X === 70 || X === 84) && z <= 1.6) return "line";
    if (x > 35 && x < 42 && Math.abs(dz * dz + dy * dy - 0.82) < 0.12)
      return "line";
    return "camo";
  });
  // IRST 球（風防の直前、中心線上）
  fill(55.5, 57.5, 8, 10, 0, 1, (x, y, z) => {
    const d = Math.hypot(x - 56.5, y - 8.6, z);
    return d <= 0.8 ? "irst" : null;
  });
  // 背部のアンテナ
  for (let Y = 17; Y <= 19; Y++) put(56 - (Y - 17), Y, 0, "dark");

  // ===== 胴体中央の幅広い背面（胴体と LERX・ナセルをなめらかにつなぐ）
  fill(10, 46, 3, 8.5, 0, 8, (x, y, z, X) => {
    const W =
      x > 36 ? ramp(x, 36, 46, 8, 3.5) : x < 16 ? ramp(x, 10, 16, 4, 8) : 8;
    if (z > W) return null;
    const crown =
      x >= 14 ? ramp(x, 14, 36, 7.6, 8.4) : ramp(x, 10, 14, 6.6, 7.6);
    const top = 6 + (crown - 6) * Math.cos(((z / W) * Math.PI) / 2);
    const bot = z <= 2.5 ? 3 : 4; // ナセルの間はトンネル状にあける
    if (y < bot || y > top) return null;
    if (FUSE_LINES.has(X) && z <= W - 0.5) return "line";
    return "camo";
  });

  // ===== エンジンナセル（大きく離れて配置）とナセル下のインテーク
  const NZ = 5.5;
  fill(12, 41, 0, 5.6, 2.4, 8.6, (x, y, z, X, Y) => {
    const front = 38 + Math.min(Math.max(y, 0), 4) * 0.75; // 前縁は上が前へ出た斜め形
    if (x > front) return null;
    let hw = 2.6,
      hh = 2.6,
      cy = 2.6,
      p = 4;
    if (x < 22) {
      // 後方は丸くすぼまる
      const t = (22 - x) / 10;
      hw = lerp(2.6, 2.2, t);
      hh = lerp(2.6, 2.3, t);
      cy = lerp(2.6, 3.1, t);
      p = lerp(4, 2, t);
    }
    const dz = Math.abs(z - NZ) / (hw + 0.25),
      dy = Math.abs(y - cy) / (hh + 0.25);
    if (Math.pow(dz, p) + Math.pow(dy, p) > 1) return null;
    // インテーク開口部の奥
    if (x >= front - 2 && Math.abs(z - NZ) <= hw - 0.6 && y >= 0.6 && y <= 4.4)
      return "intake";
    // 下面の補助ルーバー
    if (Y === 0 && x > 29 && x < 34 && X % 2 === 0 && Math.abs(z - NZ) < 1.4)
      return "line";
    if (FUSE_LINES.has(X)) return "line";
    return "camo";
  });

  // ===== 推力偏向ノズル（丸型で少し長め、花弁つき）
  const NCY = 3.1;
  const petal = (y, z) =>
    Math.floor((Math.atan2(y - NCY, z - NZ) + Math.PI) / (Math.PI / 8)) % 2
      ? "petal"
      : "nozzle";
  fill(5, 12, 0.4, 5.8, 3, 8, (x, y, z) => {
    const r = ramp(x, 5, 12, 1.95, 2.3);
    const d = Math.hypot(z - NZ, y - NCY);
    if (d > r) return null;
    if (x < 6.6) return d < r - 0.6 ? null : petal(y, z); // 出口付近は殻だけにして奥を見せる
    if (x < 7.2) return d < 0.7 ? "cone" : d < r - 0.6 ? "exhaust" : "nozzle";
    if (x >= 8.5 && x < 9.2) return "dark"; // 可動部の継ぎ目
    if (x >= 9.2) return "hot";
    return petal(y, z);
  });

  // ===== 主翼と LERX（大きく湾曲した前縁延長）。前縁スラットとフラッペロンの線入り。
  const wing = [
    [53, 2.6],
    [50, 3.6],
    [46, 5.0],
    [42, 6.2],
    [38, 7.2],
    [34, 8],
    [20.5, 21.6],
    [16.5, 21.6],
    [14, 8.5],
    [14, 3],
  ];
  const wingLE = (z) => 34 - (z - 8) * (13.5 / 13.6);
  const wingTE = (z) => 14 + Math.max(0, z - 8.5) * (2.5 / 13.1);
  for (let X = 28; X <= 106; X++) {
    for (let Z = 4; Z <= 43; Z++) {
      const x = X / F,
        z = Z / F;
      if (!inPoly(x, z, wing)) continue;
      let th = 2; // 厚み（ボクセル）
      if (z >= 8) {
        const f = (x - wingTE(z)) / (wingLE(z) - wingTE(z));
        if (z < 14 && f > 0.12 && f < 0.75) th = 3;
      } else if (x < 36) th = 3;
      for (let Y = 10; Y < 10 + th; Y++) {
        let c = "camo";
        if (Y === 10 + th - 1 && z >= 9) {
          const le = wingLE(z),
            te = wingTE(z),
            ch = le - te;
          const hinge = te + 0.22 * ch,
            slat = te + 0.86 * ch;
          if (Math.abs(x - hinge) < 0.3 || (z < 21 && Math.abs(x - slat) < 0.3))
            c = "line";
          if (x < hinge && Math.abs(z - 15.5) < 0.3) c = "line"; // フラップとエルロンの境目
        }
        put(X, Y, Z, c);
      }
    }
  }

  // ===== 武装
  // 翼端のミサイルランチャーと R-73
  for (let X = 28; X <= 47; X++)
    for (let Y = 10; Y <= 11; Y++) put(X, Y, 43, "dark");
  for (let X = 25; X <= 44; X++) {
    for (let Y = 8; Y <= 9; Y++)
      for (let Z = 43; Z <= 44; Z++)
        put(X, Y, Z, X >= 43 ? "seeker" : "missile");
  }
  for (const [X, s] of [
    [26, 2],
    [27, 2],
    [41, 1],
  ]) {
    // 尾翼と前翼
    for (let d = 1; d <= s; d++) {
      put(X, 8 - d, 43, "missile");
      put(X, 8 - d, 44, "missile");
      put(X, 8, 44 + d, "missile");
    }
  }
  // 2×2 断面のミサイル（後端の十字尾翼と中ほどの翼つき）
  function missile(x0, len, Y, Z) {
    for (let X = x0; X < x0 + len; X++) {
      for (let dy = 0; dy <= 1; dy++)
        for (let dz = 0; dz <= 1; dz++)
          put(X, Y + dy, Z + dz, X >= x0 + len - 2 ? "seeker" : "missile");
    }
    for (const X of [x0 + 1, x0 + 2, x0 + len - 7]) {
      put(X, Y - 1, Z, "missile");
      put(X, Y - 1, Z + 1, "missile");
      put(X, Y + 2, Z, "missile");
      put(X, Y + 2, Z + 1, "missile");
      put(X, Y, Z - 1, "missile");
      put(X, Y + 1, Z - 1, "missile");
      put(X, Y, Z + 2, "missile");
      put(X, Y + 1, Z + 2, "missile");
    }
  }
  // 主翼下のパイロンと R-27
  for (let X = 38; X <= 52; X++)
    for (let Y = 8; Y <= 9; Y++)
      put(X, Y, 26, X < 40 || X > 50 ? "line" : "camo");
  missile(32, 24, 5, 26);
  // ナセル間の R-77
  missile(38, 22, 3, 0);
  for (let X = 44; X <= 52; X++) put(X, 5, 0, "dark");

  // ===== カナード翼（LERX の前方）
  const canard = [
    [51.5, 3.5],
    [47, 11.2],
    [44.6, 11.2],
    [45, 3.5],
  ];
  for (let X = 88; X <= 104; X++) {
    for (let Z = 6; Z <= 23; Z++) {
      const x = X / F,
        z = Z / F;
      if (!inPoly(x, z, canard)) continue;
      put(X, 12, Z, Z === 9 ? "line" : "camo");
      if (z < 8) put(X, 13, Z, "camo");
    }
  }

  // ===== テールブーム（ナセル外側、尾翼の取り付け部）
  fill(3.5, 16, 3.5, 6.5, 7, 9.5, (x, y, z) => {
    const r = x < 6 ? ramp(x, 3.5, 6, 0.4, 1.1) : 1.1;
    return Math.hypot((y - 5) / 1.3, z - 8.3) <= r ? "camo" : null;
  });

  // ===== 全遊動式水平尾翼
  const stab = [
    [14, 9.2],
    [7.5, 15.8],
    [4, 15.8],
    [3, 9.2],
  ];
  for (let X = 6; X <= 28; X++) {
    for (let Z = 18; Z <= 32; Z++) {
      if (!inPoly(X / F, Z / F, stab)) continue;
      put(X, 10, Z, "camo");
      put(X, 11, Z, Z === 19 ? "line" : "camo");
    }
  }

  // ===== 双垂直尾翼（テールブーム上、垂直）。方向舵の線と赤い星入り。
  const star = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.85 : 2.1,
      a = Math.PI / 2 + (i * Math.PI) / 5;
    star.push([10.2 + r * Math.cos(a), 12.6 + r * Math.sin(a)]);
  }
  const FZ = 16;
  for (let Y = 12; Y <= 36; Y++) {
    const h = (Y - 12) / 24;
    const le = lerp(20, 10.5, h),
      te = lerp(5, 6.5, h);
    for (let X = Math.ceil(te * F); X <= Math.floor(le * F); X++) {
      const x = X / F,
        y = Y / F;
      let c = "camo";
      if (Y >= 35) c = "dark";
      else if (inPoly(x, y, star)) c = "star";
      else if (h > 0.12 && h < 0.85 && Math.abs(x - (te + 2.4)) < 0.3)
        c = "line"; // 方向舵
      put(X, Y, FZ, c);
      if (Y <= 14 && x > te + 1) {
        put(X, Y, FZ - 1, "camo");
        put(X, Y, FZ + 1, "camo");
      } // 付け根の厚み
    }
  }
  // ブーム下のベントラルフィン
  for (let Y = 2; Y <= 7; Y++) {
    const k = (7 - Y) / 2;
    for (let X = Math.round(18 + k); X <= Math.round(28 - k * 2); X++)
      put(X, Y, 16, "camo");
  }

  // ===== 下から見える面は明るい下面色にする（迷彩色のボクセルだけ）
  for (const v of map.values()) {
    const [X, Y, Z, c] = v;
    if (CAMO[c] && Y <= 11 && !has(X, Y - 1, Z)) v[3] = "belly";
  }

  // ===== 機番 "711"（機首側面。左右どちらから見ても読めるように並びを反転させる）
  const DIGITS = {
    7: ["111", "001", "010", "010", "010"],
    1: ["010", "110", "010", "010", "111"],
  };
  const text = "711",
    X0 = 105,
    YT = 9;
  for (const side of [1, -1]) {
    for (let i = 0; i < text.length; i++) {
      const g = DIGITS[text[i]];
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 3; c++) {
          if (g[r][c] !== "1") continue;
          const col = i * 4 + c;
          const X = side > 0 ? X0 + col : X0 + 10 - col;
          const Y = YT - r;
          for (let Z = 10; Z >= 1; Z--) {
            const v = get(X, Y, side * Z);
            if (v) {
              v[3] = "num";
              break;
            }
          }
        }
      }
    }
  }

  // ===== 外から見えない内部のボクセルを取り除き、中心へ寄せて配列化
  const voxels = [];
  for (const [X, Y, Z, c] of map.values()) {
    if (
      has(X + 1, Y, Z) &&
      has(X - 1, Y, Z) &&
      has(X, Y + 1, Z) &&
      has(X, Y - 1, Z) &&
      has(X, Y, Z + 1) &&
      has(X, Y, Z - 1)
    )
      continue;
    voxels.push([X - 66, Y - 12, Z, c]);
  }
  return { id: "su37", name: "Su-37 Terminator", palette, voxels };
})();
