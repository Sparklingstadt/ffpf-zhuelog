// Su-57 (Felon) voxel model.
// 座標: +x = 機首, +y = 上, z = 翼幅方向（z=0 で左右対称）。1m ≒ 3 ボクセル。
// 形状は「機首からの距離 u（ボクセル、0〜60）」と「中心線からの距離 h = |z|」で定義し、
// 最後に x = 30 - u へ変換する。
(window.VOXEL_MODELS = window.VOXEL_MODELS || {})["su57"] = (function () {
  const palette = {
    body: "#a3adb5", // ライトグレー（迷彩の地色）
    light: "#c2c9cf", // 明るいグレー
    blue: "#6d8fa8", // ブルーグレー
    slate: "#52667a", // 濃いブルーグレー
    // パネルライン用に迷彩色をそれぞれ少し暗くした色
    bodyLn: "#89939b",
    lightLn: "#a5adb4",
    blueLn: "#5a7890",
    slateLn: "#435567",
    dark: "#3b444d", // アンテナ・キャノピー枠・テールスティンガー先端
    canopy: "#7d6430", // 金色がかったステルスキャノピー
    canopyHi: "#a88a48", // キャノピーの映り込み
    irst: "#26313b", // IRST（光学センサー球）
    intake: "#1a1d20",
    nozzle: "#5e5a54",
    nozzleDark: "#47433e",
    burner: "#2a2724",
    red: "#b8322a", // 国籍標識（赤い星）
    navRed: "#d8382a", // 左翼端灯
    navGreen: "#3fae5a", // 右翼端灯
    navWhite: "#eef0ea", // 尾灯
  };
  const CAMO = { body: 1, light: 1, blue: 1, slate: 1 };

  // ---------- helpers ----------
  // 折れ線テーブル [[u, v], ...] を線形補間する
  function tbl(points, u) {
    if (u <= points[0][0]) return points[0][1];
    for (let i = 1; i < points.length; i++) {
      const [u1, v1] = points[i];
      if (u <= u1) {
        const [u0, v0] = points[i - 1];
        return v0 + ((v1 - v0) * (u - u0)) / (u1 - u0);
      }
    }
    return points[points.length - 1][1];
  }
  // 超楕円の内側判定（半径は 0.5 だけ膨らませてボクセル中心で判定する）
  function inSuper(dx, dy, rx, ry, p) {
    if (rx <= 0 || ry < 0) return false;
    const a = Math.abs(dx) / (rx + 0.5);
    const b = Math.abs(dy) / (ry + 0.5);
    return Math.pow(a, p) + Math.pow(b, p) <= 1;
  }
  // 決定的な疑似乱数（迷彩用）
  function mulberry32(seed) {
    return function () {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- 胴体（リフティングボディ） ----------
  const W = [
    [0, 0],
    [3, 1.2],
    [8, 2.1],
    [14, 2.7],
    [18, 3.3],
    [22, 4.8],
    [28, 6.4],
    [32, 7],
    [48, 7],
    [52, 6],
    [54, 4],
    [55, 2],
  ];
  const HT = [
    [0, 0],
    [3, 0.9],
    [8, 1.8],
    [14, 2.2],
    [20, 2],
    [26, 1.8],
    [34, 1.5],
    [46, 1.2],
    [55, 1],
  ];
  const HB = [
    [0, 0],
    [3, 0.9],
    [8, 1.4],
    [14, 1.8],
    [22, 2],
    [28, 1.2],
    [34, 1],
    [55, 1],
  ];
  // 下半分の幅。u=19〜31 はインテーク内壁との間に境界層ダイバータの隙間をあける
  const LOWW = [
    [0, 0],
    [3, 1.2],
    [8, 2.1],
    [14, 2.4],
    [18, 2.4],
    [19, 1.4],
    [31, 1.4],
    [32, 2.4],
  ];
  function fuselage(u, y, h) {
    if (u < 0 || u > 55) return false;
    const w = tbl(W, u);
    const p = u < 20 ? 2.2 : 3;
    if (y >= 0) return inSuper(h, y, w, tbl(HT, u), p);
    return inSuper(h, y, Math.min(w, tbl(LOWW, u)), tbl(HB, u), p);
  }
  // 背中のこぶ（キャノピー後方から尾部へ）
  const SPINE = [
    [17, 3.3],
    [22, 3.1],
    [30, 2.6],
    [40, 2.2],
    [50, 1.8],
    [54, 1.2],
  ];
  function spine(u, y, h) {
    if (u < 17 || u > 54 || y < 0) return false;
    return inSuper(h, y, 1.8, tbl(SPINE, u), 2);
  }
  // キャノピー
  // 細長い涙滴形（幅 3 ボクセル ≒ 1m）
  const CANOPY_RISE = [
    [7, 0.3],
    [9, 1.2],
    [12, 1.8],
    [16, 1.6],
    [19, 1.0],
    [21, 0.4],
  ];
  function canopy(u, y, h) {
    if (u < 7 || u > 21) return false;
    const base = Math.floor(tbl(HT, u));
    if (y < base) return false;
    return inSuper(h, y - base, 1.2, tbl(CANOPY_RISE, u), 2);
  }

  // ---------- 翼 ----------
  // LEVCON（主翼付け根前方の可動式前縁フラップ）
  function levcon(u, y, h) {
    if (y !== 0 || u < 15 || u > 28) return false;
    return h <= 3 + (u - 15) * (6 / 11) + 0.5;
  }
  // 主翼: 前縁後退角 ≒ 49°、後縁はわずかに前進
  function wingLE(h) {
    return 28 + ((h - 7) * 16) / 14;
  }
  function wingTE(h) {
    return 50 - ((h - 7) * 2) / 14;
  }
  function wing(u, y, h) {
    if (h < 6 || h > 21) return false;
    const le = wingLE(h),
      te = wingTE(h);
    if (u < Math.round(le) || u > Math.round(te)) return false;
    if (y === 0) return true;
    if (y === 1) return h <= 10 && u > le + 2 && u < te - 2; // 付け根だけ厚くする
    return false;
  }
  // 全遊動式水平尾翼
  function taileron(u, y, h) {
    if (y !== 0 || h < 7 || h > 15) return false;
    const le = 52 + ((h - 7) * 4) / 8;
    const te = 59 - (h - 7) / 8;
    return u >= Math.round(le) && u <= Math.round(te);
  }
  // 外側に 26° 傾いた全遊動式双垂直尾翼
  const CANT = (26 * Math.PI) / 180;
  function finCoord(y, h) {
    const dz = h - 6,
      dy = y - 1;
    return {
      d: dz * Math.sin(CANT) + dy * Math.cos(CANT),
      across: dz * Math.cos(CANT) - dy * Math.sin(CANT),
    };
  }
  function fin(u, y, h) {
    const { d, across } = finCoord(y, h);
    if (Math.abs(across) > 0.62 || d < -0.3 || d > 7.4) return false;
    const le = 41 + d,
      te = 51;
    return u >= Math.round(le) && u <= te;
  }

  // ---------- エンジンナセル・インテーク・ノズル ----------
  const NZC = 5,
    NYC = -1;
  // インテーク開口部: 上側が前に出て下側が後退する斜めカット（内側ほど前）
  function intakeFront(y, h) {
    return 23 + (-1 - y) + (NZC - h) * 0.4;
  }
  function nacelleSection(y, h, inset) {
    return inSuper(h - NZC, y - NYC, 2.4 - inset, 2.0 - inset, 2.5);
  }
  function nacelle(u, y, h) {
    if (u > 54) return null;
    if (!nacelleSection(y, h, 0)) return null;
    if (u < 27 && y > -1) return null; // LEVCON の下に収める
    const front = intakeFront(y, h);
    if (u < Math.round(front)) return null;
    // 開口部の奥 3 ボクセルは暗いダクト、縁はリップとして一段暗く
    if (u < front + 3.5 && nacelleSection(y, h, 1)) return "intake";
    if (u < front + 1) return "camoLn";
    return "camo";
  }
  const NOZZLE_R = [
    [54, 2.3],
    [57, 1.9],
  ];
  function nozzle(u, y, h) {
    if (u < 55 || u > 57) return null;
    const r = tbl(NOZZLE_R, u);
    const dz = h - NZC,
      dy = y - NYC;
    const d2 = dz * dz + dy * dy;
    if (d2 > (r + 0.45) * (r + 0.45)) return null;
    if (u >= 56 && d2 < (r - 0.7) * (r - 0.7))
      return u === 57 ? null : "burner";
    return "nozzle";
  }
  // テールスティンガー（左右のノズルの間で後方へ突き出す）
  function stinger(u, y, h) {
    if (u < 50 || u > 60) return null;
    const hw = u <= 58 ? 1 : 0;
    if (h > hw) return null;
    const top = u <= 54 ? 1 : 0;
    if (y < -1 || y > top) return null;
    if (u >= 59 && y !== 0) return null;
    return u >= 58 ? "dark" : "camo";
  }

  // ---------- 迷彩（3D ボロノイで多角形のスプリッター模様） ----------
  const rand = mulberry32(5701);
  const camoKeys = ["body", "body", "light", "blue", "blue", "slate"];
  const seeds = [];
  for (let i = 0; i < 130; i++) {
    seeds.push({
      u: rand() * 64 - 2,
      z: rand() * 46 - 23,
      y: rand() * 14 - 5,
      c: camoKeys[Math.floor(rand() * camoKeys.length)],
    });
  }
  function camo(u, y, z) {
    let best = Infinity,
      c = "body";
    for (const s of seeds) {
      const du = u - s.u,
        dz = z - s.z,
        dy = (y - s.y) * 0.45;
      const d = du * du + dz * dz + dy * dy;
      if (d < best) {
        best = d;
        c = s.c;
      }
    }
    return c;
  }

  // ---------- 組み立て ----------
  function classify(u, y, z) {
    const h = Math.abs(z);
    let c = nozzle(u, y, h);
    if (c) return c;
    c = nacelle(u, y, h);
    if (c === "intake") return c;
    if (canopy(u, y, h)) return "canopy";
    if (c) return c;
    c = stinger(u, y, h);
    if (c) return c;
    if (
      fuselage(u, y, h) ||
      spine(u, y, h) ||
      levcon(u, y, h) ||
      wing(u, y, h) ||
      taileron(u, y, h) ||
      fin(u, y, h)
    )
      return "camo";
    return null;
  }

  const map = new Map();
  const key = (u, y, z) => u + "," + y + "," + z;
  for (let u = 0; u <= 60; u++) {
    for (let y = -5; y <= 10; y++) {
      for (let z = -21; z <= 21; z++) {
        let c = classify(u, y, z);
        if (!c) continue;
        if (c === "camo") c = camo(u, y, z);
        else if (c === "camoLn") c = camo(u, y, z) + "Ln";
        map.set(key(u, y, z), c);
      }
    }
  }

  // ---------- ディテール ----------
  const has = (u, y, z) => map.has(key(u, y, z));
  function paint(u, y, z, c) {
    const k = key(u, y, z);
    if (map.has(k)) map.set(k, c);
  }
  function add(u, y, z, c) {
    map.set(key(u, y, z), c);
  }
  // パネルライン: 迷彩色なら一段暗い色にする
  function line(u, y, z) {
    const k = key(u, y, z),
      c = map.get(k);
    if (CAMO[c]) map.set(k, c + "Ln");
  }
  function topY(u, z) {
    for (let y = 10; y >= -5; y--) if (has(u, y, z)) return y;
    return null;
  }
  function botY(u, z) {
    for (let y = -5; y <= 10; y++) if (has(u, y, z)) return y;
    return null;
  }
  // 上面と下面の両方にラインを引く
  function lineTB(u, z) {
    const t = topY(u, z),
      b = botY(u, z);
    if (t !== null) line(u, t, z);
    if (b !== null) line(u, b, z);
  }
  function lineTop(u, z) {
    const t = topY(u, z);
    if (t !== null) line(u, t, z);
  }
  function lineBot(u, z) {
    const b = botY(u, z);
    if (b !== null) line(u, b, z);
  }
  function isSurface(u, y, z) {
    return (
      !has(u + 1, y, z) ||
      !has(u - 1, y, z) ||
      !has(u, y + 1, z) ||
      !has(u, y - 1, z) ||
      !has(u, y, z + 1) ||
      !has(u, y, z - 1)
    );
  }
  // 矩形のパネル（輪郭だけ）
  function panel(u0, u1, z0, z1, fn) {
    for (let u = u0; u <= u1; u++) {
      for (let z = z0; z <= z1; z++) {
        if (u === u0 || u === u1 || z === z0 || z === z1) {
          fn(u, z);
          fn(u, -z);
        }
      }
    }
  }

  // レドームの継ぎ目
  for (let y = -5; y <= 10; y++)
    for (let z = -5; z <= 5; z++) {
      if (has(5, y, z) && isSurface(5, y, z)) line(5, y, z);
    }
  // キャノピー: 前方のフレームと上面の映り込み
  for (let y = 0; y <= 10; y++)
    for (let z = -2; z <= 2; z++) {
      if (map.get(key(10, y, z)) === "canopy") paint(10, y, z, "dark");
    }
  for (let u = 12; u <= 16; u++) {
    const t = topY(u, 0);
    if (map.get(key(u, t, 0)) === "canopy" && u !== 15)
      paint(u, t, 0, "canopyHi");
  }
  // 風防の前の IRST センサー球
  add(6, topY(6, 0) + 1, 0, "irst");

  // LEVCON のヒンジライン
  for (let u = 19; u <= 27; u++) {
    const h = Math.round(tbl(W, u)) + 1;
    line(u, 0, h);
    line(u, 0, -h);
  }
  // 主翼: 前縁フラップと後縁フラッペロンの分割線
  for (let h = 8; h <= 20; h++) {
    for (const s of [1, -1]) {
      lineTB(Math.round(wingLE(h)) + 2, s * h);
      lineTB(Math.round(wingTE(h)) - 3, s * h);
    }
  }
  for (let u = Math.round(wingTE(14)) - 3; u <= Math.round(wingTE(14)); u++) {
    lineTB(u, 14);
    lineTB(u, -14);
  }
  // 水平尾翼の付け根（回転軸）
  for (let u = 52; u <= 59; u++) {
    lineTB(u, 8);
    lineTB(u, -8);
  }

  // 背面のパネル: エンジン点検口と背骨の点検口
  panel(37, 47, 3, 6, lineTop);
  panel(23, 31, 1, 1, lineTop);
  // 下面: 前脚扉、主脚扉、兵装ベイ扉（中央で割れる観音開き）
  panel(11, 17, 0, 1, lineBot);
  panel(31, 40, 4, 6, lineBot);
  for (let u = 32; u <= 48; u++) {
    for (let z = -2; z <= 2; z++) {
      if (u === 32 || u === 48 || Math.abs(z) === 2 || z === 0) line(u, -1, z);
    }
  }

  // ノズル: 付け根の継ぎ目と、後端のペタル（花弁状の板）
  for (let u = 55; u <= 57; u++) {
    for (let y = -5; y <= 3; y++) {
      for (let z = -8; z <= 8; z++) {
        if (map.get(key(u, y, z)) !== "nozzle") continue;
        const ang = Math.atan2(y - NYC, Math.abs(z) - NZC);
        const petal =
          Math.floor(((ang + Math.PI) / (2 * Math.PI)) * 12) % 2 === 0;
        if (u === 55 || petal) paint(u, y, z, "nozzleDark");
      }
    }
  }

  // 垂直尾翼: 付け根の回転軸ライン
  for (let y = -5; y <= 10; y++) {
    for (let h = 0; h <= 21; h++) {
      const { d, across } = finCoord(y, h);
      if (Math.abs(across) > 0.62 || d > 0.6) continue;
      for (let u = 41; u <= 51; u++) {
        line(u, y, h);
        line(u, y, -h);
      }
    }
  }
  // 赤い星: 主翼上面と垂直尾翼の外側
  for (const s of [1, -1]) {
    for (const [du, dh] of [
      [0, 0],
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [2, 0],
      [-2, 0],
      [0, 2],
      [0, -2],
    ]) {
      if (Math.abs(du) + Math.abs(dh) === 2 && du !== 0 && dh !== 0) continue;
      paint(42 + du, 0, s * (16 + dh), "red");
    }
    for (let y = -5; y <= 10; y++) {
      for (let h = 0; h <= 21; h++) {
        const { d, across } = finCoord(y, h);
        if (Math.abs(across) > 0.62) continue;
        for (let u = 46; u <= 50; u++) {
          const du = Math.abs(u - 48),
            dd = Math.abs(d - 3.6);
          if (du + dd <= 1.5 || (du <= 2 && dd < 0.5))
            paint(u, y, s * h, "red");
        }
      }
    }
  }

  // ブレードアンテナ（背面と腹面）
  add(28, topY(28, 0) + 1, 0, "slateLn");
  add(20, botY(20, 0) - 1, 0, "dark");
  // 翼端灯（右 +z が緑、左 -z が赤）と尾灯
  const tipU = Math.round(wingLE(21));
  paint(tipU, 0, 21, "navGreen");
  paint(tipU, 0, -21, "navRed");
  paint(60, 0, 0, "navWhite");

  const voxels = [];
  for (const [k, c] of map) {
    const [u, y, z] = k.split(",").map(Number);
    voxels.push([30 - u, y, z, c]);
  }
  return { id: "su57", name: "Su-57", palette, voxels };
})();
