(window.VOXEL_MODELS = window.VOXEL_MODELS || {})["x02"] = (function () {
  // X-02 Wyvern（Ace Combat）。1m = 3 ボクセル（全長 約 20m → 62 ボクセル）。
  // 可変後退翼は展開状態。翼端は外側パネルとして別色・上反角付きで表現する。
  // 形を作ったあと、パネルライン・動翼・兵装庫扉・ノズル内部などを表面に塗り分ける。
  const palette = {
    body: "#50575f", // 上面のダークグレー
    under: "#6c747c", // 下面の少し明るいグレー
    panel: "#42484f", // パネルライン
    flap: "#646c74", // 動翼（フラップ・補助翼・方向舵・昇降舵）
    dark: "#363b41", // 防眩パネル・可動部の境目
    radome: "#5a6168", // レドーム
    accent: "#dfe4e8", // 明るいアクセント（チャインの帯・前縁・可動翼端・尾翼端）
    mark: "#4fb3e0", // 青いライン
    formation: "#b8e65a", // 編隊灯
    navR: "#d8343a", // 左翼端の航法灯
    navG: "#36c46a", // 右翼端の航法灯
    warn: "#d9782f", // 注意表示
    canopy: "#c49a34", // 金色がかったキャノピー
    canopyHi: "#e2c46a", // キャノピー上部のハイライト
    canopyDk: "#8f6e22", // キャノピー下側の陰
    frame: "#2c3035", // キャノピー枠
    intake: "#14171a", // 空気取り入れ口の奥
    nozzle: "#3b3e43", // 排気口の外枠
    vane: "#2a2c30", // 排気口内の整流板
    exhaust: "#a9643a", // 排気口の奥（焼けた金属）
    exhaustHot: "#d0904a", // 排気口の最奥
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
  // 既にあるボクセルの色だけ変える（左右対称）
  function paint(x, y, z, c) {
    if (has(x, y, z)) put(x, y, z, c);
  }
  // 片側だけ色を変える（航法灯など）
  function paintOne(x, y, z, c) {
    const k = key(x, y, z);
    if (map.has(k)) map.set(k, [x, y, z, c]);
  }
  // 列 (x, z) の一番上 / 一番下のボクセルの y
  function topAt(x, z) {
    for (let y = 20; y >= -4; y--) if (has(x, y, z)) return y;
    return null;
  }
  function botAt(x, z) {
    for (let y = -4; y <= 20; y++) if (has(x, y, z)) return y;
    return null;
  }
  const paintTop = (x, z, c) => {
    const y = topAt(x, z);
    if (y !== null) put(x, y, z, c);
  };
  const paintBot = (x, z, c) => {
    const y = botAt(x, z);
    if (y !== null) put(x, y, z, c);
  };
  const lerp = (a, b, t) => a + (b - a) * t;
  // 平面形 (x, z) が多角形の内側か
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
  // キーフレームを x で線形補間
  function profile(keys, x) {
    if (x <= keys[0][0]) return keys[0].slice(1);
    for (let i = 1; i < keys.length; i++) {
      if (x <= keys[i][0]) {
        const a = keys[i - 1],
          b = keys[i];
        const t = (x - a[0]) / (b[0] - a[0]);
        return a.slice(1).map((v, k) => lerp(v, b[k + 1], t));
      }
    }
    return keys[keys.length - 1].slice(1);
  }

  // x は尾端 0 〜 機首 59（ノズルと水平尾翼は x < 0 まで張り出す）。
  const NOSE = 59;

  // ===== 形状 =====

  // --- 胴体。チャインで角ばった六角形断面（上下の平らな面 + 斜めの側面）。
  // [x, チャイン半幅, チャイン高さ, 上面高さ, 下面高さ, 上面の平ら半幅, 下面の平ら半幅]
  const FUS = [
    [1, 5.8, 3, 5.4, 0.6, 4.2, 4.8],
    [12, 6.4, 3, 6.4, 0, 3.8, 5],
    [30, 6.4, 3.2, 7, 0, 3, 4.6],
    [40, 5.2, 3.6, 8.2, 0.4, 2.2, 3.4],
    [44, 4.8, 3.9, 8.4, 0.8, 1.8, 3],
    [47, 4.2, 4, 7.8, 1.1, 1.5, 2.5],
    [52, 3.1, 4.2, 6.6, 2, 1, 1.4],
    [57, 1.6, 4.3, 5.4, 3, 0.4, 0.5],
    [NOSE, 0.6, 4.4, 4.8, 3.9, 0, 0],
  ];
  const fus = [];
  for (let x = 1; x <= NOSE; x++) {
    const [hw, cy, top, bot, th, bh] = profile(FUS, x);
    fus[x] = { hw, cy, top, bot };
    for (let y = Math.floor(bot); y <= Math.ceil(top); y++) {
      let lim;
      if (y >= cy) {
        if (y > top + 0.01) continue;
        lim = lerp(hw, th, (y - cy) / Math.max(0.5, top - cy));
      } else {
        if (y < bot - 0.01) continue;
        lim = lerp(hw, bh, (cy - y) / Math.max(0.5, cy - bot));
      }
      for (let z = 0; z <= lim + 0.45; z++) {
        let c = y >= cy - 0.5 || x >= NOSE - 2 ? "body" : "under";
        if (x >= 55) c = "radome";
        // 防眩パネル（キャノピー前方の上面）
        else if (x >= 50 && y >= top - 0.6 && z <= 1) c = "dark";
        // チャインの明るい帯（機首〜主翼付け根）
        if (x >= 40 && x <= 56 && Math.round(cy) === y && z >= lim - 0.6)
          c = "accent";
        put(x, y, z, c);
      }
    }
  }

  // --- 背中の 2 基のエンジンのふくらみ（中央は谷になる）
  for (let x = 2; x <= 24; x++) {
    const zs = x >= 21 ? [3] : [2, 3, 4];
    for (const z of zs) {
      const y = topAt(x, z);
      if (y !== null) put(x, y + 1, z, "body");
    }
  }
  // 下面の 2 基のエンジンのふくらみ
  for (let x = 2; x <= 20; x++) {
    for (const z of x >= 18 ? [3] : [2, 3, 4]) {
      const y = botAt(x, z);
      if (y !== null) put(x, y - 1, z, "under");
    }
  }

  // --- キャノピー（金色）。機首寄りの涙滴形で、後ろは背中のフェアリングへつながる。
  const CAN = [
    [43, 8.4],
    [45, 10.2],
    [48, 10.4],
    [51, 9.4],
    [54, 7],
  ];
  for (let x = 43; x <= 54; x++) {
    const base = fus[x].top;
    const [ctop] = profile(CAN, x);
    if (ctop <= base + 0.3) continue;
    const u = (x - 43) / 11;
    const w = 1.9 * Math.sin(Math.PI * Math.min(1, 0.25 + u * 0.85));
    const y0 = Math.round(base),
      y1 = Math.round(ctop);
    for (let y = y0; y <= y1; y++) {
      const dy = (y - base) / (ctop - base + 0.6);
      const half = Math.max(0.5, w * Math.sqrt(Math.max(0, 1 - dy * dy)));
      for (let z = 0; z <= half + 0.3; z++) {
        let c = "canopy";
        if (y === y1 && z === 0) c = "canopyHi";
        else if (y === y0)
          c = "frame"; // 枠（キャノピーの縁）
        else if (y === y0 + 1 && z >= half - 0.7) c = "canopyDk";
        if (x === 43 || x === 49) c = "frame"; // 後端の枠・前席風防の枠
        put(x, y, z, c);
      }
    }
  }
  // ヘッドレストの影（キャノピー内）
  paint(45, 9, 0, "canopyDk");
  // 風防前の IRST センサー
  paint(55, Math.round(fus[55].top), 0, "canopyHi");

  // --- 空気取り入れ口（主翼前縁の下、胴体側面）。前面が後退した斜めのカレット形。
  for (let x = 22; x <= 41; x++) {
    for (let y = 0; y <= 3; y++) {
      const front = 41 - (3 - y) * 0.7; // 下ほど後退
      if (x > front) continue;
      for (let z = 4; z <= 8; z++) {
        const outer = 8 - (x < 26 ? (26 - x) * 0.8 : 0); // 後方は胴体へ溶け込む
        if (z > outer) continue;
        put(x, y, z, y >= 2 ? "body" : "under");
      }
    }
  }
  // 開口部（2 段くぼませて奥を暗く）。縁は暗いリップ。
  for (let y = 1; y <= 2; y++) {
    const front = Math.floor(41 - (3 - y) * 0.7);
    for (let z = 5; z <= 7; z++) {
      del(front, y, z);
      del(front - 1, y, z);
      put(front - 2, y, z, "intake");
    }
  }
  for (let y = 0; y <= 3; y++) {
    const front = Math.floor(41 - (3 - y) * 0.7);
    for (let z = 4; z <= 8; z++) if (has(front, y, z)) put(front, y, z, "dark");
  }
  // 取り入れ口側面の注意表示
  paint(37, 2, 8, "warn");

  // --- LERX / ストレーキ（コクピット横から主翼前縁へ）
  const LERX = [
    [49, 3.6],
    [37, 8],
    [30, 8],
    [30, 4],
  ];
  for (let x = 30; x <= 49; x++) {
    for (let z = 3; z <= 10; z++) {
      if (!inPoly(x + 0.5, z, LERX)) continue;
      const y = Math.round(fus[x].cy);
      if (!has(x, y, z))
        put(x, y, z, inPoly(x + 0.5, z + 1, LERX) ? "body" : "accent");
    }
  }

  // --- 主翼（可変後退翼・展開状態）。前縁後退角 約 35°。
  const WY = 3;
  const WING = [
    [38, 5],
    [27.5, 18.5],
    [20.5, 18.5],
    [13, 5],
  ];
  const inWing = (x, z) => inPoly(x + 0.5, z, WING);
  for (let x = 12; x <= 38; x++) {
    for (let z = 5; z <= 19; z++) {
      if (!inWing(x, z)) continue;
      const le = !inWing(x + 1, z); // 前縁
      const nearLE = !inWing(x + 3, z);
      const te = !inWing(x - 2, z); // 後縁から 2 列
      let c = "body";
      if (le) c = "accent";
      else if (te) c = "flap";
      if (!has(x, WY, z)) put(x, WY, z, c);
      // 翼根側は厚み 2（下面）
      if (z <= 12 && !has(x, WY - 1, z)) put(x, WY - 1, z, "under");
      // 翼根の中央部は上面も 1 段ふくらませる（翼型の厚み）
      if (z <= 8 && !nearLE && inWing(x - 4, z) && !has(x, WY + 1, z))
        put(x, WY + 1, z, "body");
    }
  }
  // 可動翼端（外側パネル）。上反角を付けて別色に。
  const TIP = [
    [27.5, 18.5],
    [24.5, 23],
    [21, 23],
    [20.5, 18.5],
  ];
  for (let x = 19; x <= 28; x++) {
    for (let z = 18; z <= 23; z++) {
      if (!inPoly(x + 0.5, z, TIP)) continue;
      const y = WY + Math.round((z - 18) * 0.34);
      put(x, y, z, z === 18 ? "dark" : "accent");
    }
  }

  // --- 双垂直尾翼。外側へ約 30° 傾斜。
  const finZ = (y) => Math.round(5 + (y - 6) * 0.6);
  for (let y = 6; y <= 13; y++) {
    const t = (y - 6) / 7;
    const le = lerp(19, 10, t);
    const te = lerp(4, 3, t);
    const z = finZ(y);
    for (let x = Math.ceil(te); x <= Math.floor(le); x++) {
      let c = "body";
      if (y === 13) c = "accent";
      else if (x === Math.floor(le))
        c = "panel"; // 前縁
      else if (y === 11 && x <= le - 1) c = "mark";
      else if (x <= Math.ceil(te) + 2 && y <= 10) c = "flap"; // 方向舵
      if (x === Math.ceil(te) + 3 && y <= 10 && c === "body") c = "panel"; // 方向舵のヒンジ線
      put(x, y, z, c);
    }
    // 根元を胴体へつなぐ
    if (y === 6)
      for (let x = 4; x <= 19; x++)
        for (let yy = 5; yy <= 6; yy++)
          if (!has(x, yy, z)) put(x, yy, z, "body");
  }
  // 尾翼の編隊灯
  paint(6, 9, finZ(9), "formation");

  // --- 水平尾翼（全遊動式）。排気口より少し後ろへ張り出す。
  const STAB = [
    [11, 6],
    [3, 13],
    [-1, 13],
    [-2, 7],
    [1, 6],
  ];
  for (let x = -2; x <= 11; x++) {
    for (let z = 6; z <= 13; z++) {
      if (!inPoly(x + 0.5, z, STAB)) continue;
      let c = "flap";
      if (z === 13) c = "accent";
      else if (!inPoly(x + 1.5, z, STAB)) c = "panel"; // 前縁
      if (!has(x, 3, z)) put(x, 3, z, c);
    }
  }

  // --- 2 基のエンジンの平たい排気口（2 次元推力偏向ノズル）
  for (let x = -2; x <= 1; x++) {
    for (let y = 1; y <= 4; y++) {
      for (let z = 1; z <= 5; z++) put(x, y, z, "nozzle");
    }
  }
  // 上下のフラップを後ろへ延ばす（2D ノズルらしく）
  for (let z = 1; z <= 5; z++) {
    put(-3, 1, z, "nozzle");
    put(-3, 4, z, "nozzle");
  }
  // 奥をくぼませ、整流板と焼けた金属を見せる
  for (let y = 2; y <= 3; y++) {
    for (let z = 2; z <= 4; z++) {
      del(-3, y, z);
      del(-2, y, z);
      del(-1, y, z);
      put(0, y, z, z === 3 ? "exhaustHot" : "exhaust");
    }
    put(-1, y, 3, "vane"); // 中央の整流板
  }
  // 2 基の間のビーバーテール
  for (let x = -2; x <= 2; x++) put(x, 2, 0, "dark");
  put(-3, 2, 0, "dark");

  // ===== 表面のディテール =====

  // 背中: エンジンのふくらみの間の谷、横方向のパネルライン、エアブレーキ
  for (let x = 4; x <= 22; x++) paintTop(x, 0, "panel");
  for (const x of [9, 16, 23])
    for (let z = 1; z <= 5; z++) paintTop(x, z, "panel");
  for (let x = 27; x <= 32; x++)
    for (const z of [0, 1, 2]) {
      if (x === 27 || x === 32 || z === 2) paintTop(x, z, "panel"); // エアブレーキの枠
    }
  // 空中給油口
  paintTop(39, 0, "dark");
  // 背中のアンテナ
  {
    const y = topAt(34, 0);
    put(34, y + 1, 0, "dark");
    put(35, y + 1, 0, "dark");
  }
  // 胴体側面の縦のパネルライン（チャインの下）
  for (let x = 7; x <= 40; x += 7) {
    const y = Math.round(fus[x].cy) - 1;
    for (let z = 9; z >= 0; z--)
      if (has(x, y, z)) {
        put(x, y, z, "panel");
        break;
      }
  }
  // 機首側面の編隊灯
  for (let x = 44; x <= 46; x++) {
    const y = Math.round(fus[x].cy) - 1;
    for (let z = 9; z >= 0; z--)
      if (has(x, y, z)) {
        put(x, y, z, "formation");
        break;
      }
  }

  // 下面: 兵装庫扉（左右 2 枚）、前脚・主脚扉、ベントラルアンテナ
  for (let x = 22; x <= 37; x++) {
    for (let z = 0; z <= 3; z++) {
      const edge = x === 22 || x === 37 || z === 0 || z === 3;
      paintBot(x, z, edge ? "panel" : "under");
    }
  }
  for (let x = 43; x <= 48; x++)
    paintBot(x, 0, x === 43 || x === 48 ? "panel" : "dark"); // 前脚扉
  for (let x = 14; x <= 20; x++)
    for (const z of [4, 5])
      paintBot(x, z, x === 14 || x === 20 ? "panel" : "dark"); // 主脚扉
  {
    const y = botAt(40, 0);
    put(40, y - 1, 0, "dark");
  }

  // 主翼: 前縁の内側に細いライン、フラップと補助翼の境目、可変翼の軸のフェアリング
  for (let x = 12; x <= 38; x++) {
    for (let z = 5; z <= 19; z++) {
      if (!inWing(x, z) || !has(x, WY, z)) continue;
      const [, , , c] = map.get(key(x, WY, z));
      if (c === "flap" && z === 13) put(x, WY, z, "panel"); // フラップ / 補助翼の境
      if (c === "body" && !inWing(x - 3, z)) put(x, WY, z, "panel"); // 動翼のヒンジ線
      if (c === "body" && z === 10) put(x, WY, z, "dark"); // 可変翼の付け根（グラブ）の境目
    }
  }
  // 可変翼の軸（主翼付け根の丸いフェアリング）
  for (const [x, z] of [
    [27, 9],
    [28, 9],
    [27, 10],
    [28, 10],
  ]) {
    const y = topAt(x, z);
    if (y !== null) put(x, y + 1, z, "dark");
  }
  // 主翼上面の青いライン
  for (let z = 11; z <= 17; z++) {
    for (let x = 38; x >= 12; x--) {
      if (inWing(x, z) && !inWing(x + 1, z)) {
        paint(x - 2, WY, z, "mark");
        break;
      }
    }
  }
  // 翼端の航法灯（右 = +z は緑、左 = -z は赤）
  for (let x = 19; x <= 28; x++) {
    if (inPoly(x + 0.5, 23, TIP) && !inPoly(x + 1.5, 23, TIP)) {
      const y = WY + Math.round(5 * 0.34);
      paintOne(x, y, 23, "navG");
      paintOne(x, y, -23, "navR");
    }
  }

  const voxels = [];
  for (const [x, y, z, c] of map.values()) voxels.push([x, y, z, c]);
  return { id: "x02", name: "X-02 Wyvern", palette, voxels };
})();
