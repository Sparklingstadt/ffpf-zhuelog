(window.VOXEL_MODELS = window.VOXEL_MODELS || {})["f22a"] = (function () {
  // F-22A Raptor。1m = 3 ボクセル（全長 18.9m → 約 57、全幅 13.6m → 約 41、全高 5.1m → 約 15）。
  const palette = {
    body: "#8a9097", // ミディアムグレー（基本色）
    dark: "#6a7077", // ダークグレーの迷彩パターン
    belly: "#959ba1", // 下面（わずかに明るい）
    panel: "#5f656c", // パネルライン・動翼のヒンジ線・扉の縁
    edge: "#767c83", // 主翼・尾翼の前縁、インテークリップ（RAM 処理）
    canopy: "#5a4a20", // 金色がかったバブルキャノピー
    glint: "#8a7434", // キャノピー頂部の照り返し
    intake: "#1b1e22", // 空気取り入れ口の奥
    nozzle: "#585c61", // 2D 推力偏向ノズルの外板
    exhaust: "#2e2b29", // ノズル奥
    light: "#a9c48a", // フォーメーションライト（スリムライト）
  };

  const map = new Map();
  const key = (x, y, z) => x + "," + y + "," + z;
  // z >= 0 側だけ書けば左右対称に置かれる
  function put(x, y, z, c) {
    map.set(key(x, y, z), [x, y, z, c]);
    map.set(key(x, y, -z), [x, y, -z, c]);
  }
  const has = (x, y, z) => map.has(key(x, y, z));
  const get = (x, y, z) => map.get(key(x, y, z));
  function paint(x, y, z, c) {
    // 既存ボクセルの色だけを変える
    if (has(x, y, z)) put(x, y, z, c);
  }
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp01 = (t) => Math.max(0, Math.min(1, t));
  // 折れ線補間
  function pl(xs, vs, x) {
    for (let i = 0; i < xs.length - 1; i++) {
      const a = xs[i],
        b = xs[i + 1];
      if ((x - a) * (x - b) <= 0)
        return lerp(vs[i], vs[i + 1], a === b ? 0 : (x - a) / (b - a));
    }
    return Math.abs(x - xs[0]) < Math.abs(x - xs[xs.length - 1])
      ? vs[0]
      : vs[vs.length - 1];
  }
  // 点 (u, v) が多角形 pts の内側か
  function inPoly(u, v, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [ui, vi] = pts[i];
      const [uj, vj] = pts[j];
      if (vi > v !== vj > v && u < ((uj - ui) * (v - vi)) / (vj - vi) + ui)
        inside = !inside;
    }
    return inside;
  }
  // 迷彩用のバリューノイズ（決定的）
  function hash(i, j) {
    let h = (i * 374761393 + j * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  }
  function vnoise(u, v) {
    const i = Math.floor(u),
      j = Math.floor(v);
    const fu = u - i,
      fv = v - j;
    const su = fu * fu * (3 - 2 * fu),
      sv = fv * fv * (3 - 2 * fv);
    return lerp(
      lerp(hash(i, j), hash(i + 1, j), su),
      lerp(hash(i, j + 1), hash(i + 1, j + 1), su),
      sv,
    );
  }
  // ダークグレーの不規則な迷彩パッチ
  function camo(x, y, z) {
    const az = Math.abs(z);
    const n =
      vnoise(x / 6.5 + 3.1, az / 5.5 + y / 9) * 0.7 +
      vnoise(x / 2.6 + 17, az / 2.4 + 9) * 0.3;
    return n > 0.6 ? "dark" : "body";
  }

  // x は尾端 0 〜 機首 57。
  const NOSE = 57;

  // --- 中央胴体: チャイン（最大幅）を持つ六角断面
  const KX = [57, 55, 52, 49, 46, 42, 38, 30, 20, 12, 7, 4];
  const KW = [0.3, 1.0, 1.9, 2.6, 3.1, 3.5, 3.6, 3.5, 3.2, 3.0, 2.0, 1.0];
  const KYC = [4.0, 4.0, 4.1, 4.2, 4.3, 4.4, 4.3, 4.1, 4.0, 3.6, 3.0, 2.8];
  const KYT = [4.3, 4.9, 5.7, 6.4, 7.0, 7.2, 7.3, 7.1, 6.6, 5.9, 4.6, 3.7];
  const KYB = [3.9, 3.3, 2.6, 2.0, 1.6, 1.2, 1.0, 1.0, 1.0, 1.2, 1.8, 2.3];
  for (let x = 4; x <= NOSE; x++) {
    const W = pl(KX, KW, x),
      yc = pl(KX, KYC, x),
      yt = pl(KX, KYT, x),
      yb = pl(KX, KYB, x);
    const wt = W * 0.5,
      wb = W * 0.6;
    const hex = [
      [-wt, yt + 0.45],
      [wt, yt + 0.45],
      [W + 0.45, yc],
      [wb, yb - 0.45],
      [-wb, yb - 0.45],
      [-W - 0.45, yc],
    ];
    for (let y = 0; y <= 9; y++) {
      for (let z = 0; z <= 5; z++) {
        if (inPoly(z, y, hex)) put(x, y, z, "body");
      }
    }
  }

  // --- インテーク〜エンジンナセル（中央胴体の左右に張り出す）
  // 前から見た断面。上辺はチャインから続く肩、外側下半分は内側へ傾く菱形の下半分。
  const NAC = [
    [-1, 6.4],
    [5.8, 5.8],
    [7.9, 4.4],
    [5.8, 0.4],
    [-1, 0.4],
  ];
  const AFT = [
    [-1, 4.4],
    [4.4, 4.4],
    [4.9, 2.6],
    [4.4, 0.7],
    [-1, 0.7],
  ];
  // 斜めのインテーク前縁: 上ほど前、外側ほど後ろ（側面・上面の両方で傾く）
  const lipX = (z, y) => 41.5 + (y - 3.5) * 0.55 - (Math.max(z, 3) - 3) * 0.75;
  // インテーク開口部（前から見た菱形の開口）
  const OPEN = [
    [3.5, 4.6],
    [7.1, 4.3],
    [5.4, 0.8],
    [3.5, 0.8],
  ];
  for (let x = 6; x <= 43; x++) {
    const t = clamp01((13 - x) / 7);
    const sec = NAC.map((p, i) => [
      lerp(p[0], AFT[i][0], t),
      lerp(p[1], AFT[i][1], t),
    ]);
    for (let y = 0; y <= 7; y++) {
      for (let z = 0; z <= 8; z++) {
        if (!inPoly(z, y, sec)) continue;
        if (z < 3 && x > 30) continue; // 前方の内側は中央胴体に任せる
        const lx = lipX(z, y);
        if (x > lx) continue;
        const open = inPoly(z, y, OPEN);
        if (open && x > lx - 3) continue; // 開口部の奥行き
        // 胴体との間のダイバーター（境界層を逃がす細いすき間）
        if (z === 3 && y >= 1 && y <= 3 && x > lx - 6 && !has(x, y, z))
          continue;
        let c = "body";
        if (open && x > lx - 4) c = "intake";
        else if (x > lx - 1) c = "edge"; // リップの縁取り
        put(x, y, z, c);
      }
    }
  }

  // --- 尾部ブーム（水平・垂直尾翼の付け根）と後端のテールコーン
  for (let x = 3; x <= 16; x++) {
    const shrink = x < 6 ? (6 - x) * 0.4 : 0;
    for (let y = 2; y <= 5; y++) {
      for (let z = 4; z <= 6; z++) {
        if (z === 6 && (y === 2 || y === 5)) continue;
        if (shrink > 0 && (y < 2 + shrink || y > 5 - shrink * 0.5)) continue;
        put(x, y, z, "body");
      }
    }
  }
  put(2, 3, 5, "panel");
  put(2, 4, 5, "panel");

  // --- 2D 推力偏向ノズル（平たい四角形、上下フラップがくさび状に伸びる）
  for (let x = 1; x <= 8; x++) {
    for (let y = 1; y <= 4; y++) {
      for (let z = 1; z <= 4; z++) {
        const inner = y >= 2 && y <= 3 && z >= 2 && z <= 3;
        const side = z === 1 || z === 4;
        if (x <= 2 && inner) continue; // 出口を 2 段へこませる
        if (x === 1 && side && (y === 2 || y === 3)) continue; // 側板は短い
        let c = "nozzle";
        if (x === 3 && inner) c = "exhaust";
        else if (x === 6 && !inner) c = "panel"; // フラップのヒンジ線
        put(x, y, z, c);
      }
    }
  }
  // ノズル間のフェアリング（テイルスティンガー）
  for (let x = 2; x <= 6; x++)
    for (let y = 2; y <= 3; y++) put(x, y, 0, x === 2 ? "panel" : "body");

  // --- 主翼: 前縁後退 42°、後縁前進 17° の菱形に近い平面形
  const wingLE = (z) => 38.5 - (z - 6.5) * 0.87;
  const wingTE = (z) => 17.3 + (z - 6.5) * 0.31;
  const wing = [
    [38.5, 6.5],
    [26.4, 20.4],
    [21.6, 20.4],
    [17.3, 6.5],
  ];
  for (let x = 14; x <= 40; x++) {
    for (let z = 6; z <= 20; z++) {
      if (!inPoly(x, z, wing)) continue;
      const le = wingLE(z),
        te = wingTE(z);
      const f = (le - x) / (le - te); // 前縁 0 〜 後縁 1
      let c = "body";
      if (f < 0.08) c = "edge";
      else if (Math.abs(f - 0.17) < 0.04 && z >= 8)
        c = "panel"; // 前縁フラップのヒンジ線
      else if (Math.abs(f - 0.76) < 0.035 && z >= 8)
        c = "panel"; // フラッペロン / エルロンのヒンジ線
      else if (f > 0.76 && z === 13) c = "panel"; // フラッペロンとエルロンの境目
      put(x, 4, z, c);
      // 翼厚: 根元側ほど厚い（下面側に積む）
      if ((z <= 15 && f > 0.1 && f < 0.75) || (z <= 9 && f > 0.05 && f < 0.85))
        put(x, 3, z, "body");
      if (z <= 8 && f > 0.15 && f < 0.6 && !has(x, 5, z)) put(x, 5, z, "body"); // 翼胴ブレンドの盛り上がり
    }
  }
  // 翼端のフォーメーションライト
  for (let x = 22; x <= 24; x++) paint(x, 4, 20, "light");

  // --- 水平尾翼: 主翼と同じ平面形（前縁・後縁が主翼と平行）
  const stab = [
    [15.2, 5.5],
    [8.4, 13.4],
    [4.6, 13.4],
    [2.2, 5.5],
  ];
  for (let x = 1; x <= 16; x++) {
    for (let z = 5; z <= 14; z++) {
      if (!inPoly(x, z, stab)) continue;
      const le = 15.2 - (z - 5.5) * 0.87;
      const te = 2.2 + (z - 5.5) * 0.31;
      const f = (le - x) / (le - te);
      put(x, 3, z, f < 0.12 ? "edge" : "body");
      if (z <= 8 && f > 0.15 && f < 0.7) put(x, 2, z, "body");
    }
  }
  for (let x = 8; x <= 12; x++) paint(x, 3, 5, "panel"); // 全遊動式尾翼の付け根（ピボット部）

  // --- 外側へ 28° 傾いた双垂直尾翼（方向舵のヒンジ線つき）
  const cant = Math.tan((28 * Math.PI) / 180);
  for (let h = 0; h <= 9; h++) {
    const y = 6 + h;
    const z0 = Math.floor(5.2 + h * cant);
    const z1 = Math.floor(5.2 + (h + 1) * cant);
    const le = lerp(19.5, 14.5, h / 9);
    const te = lerp(5.5, 8.2, h / 9);
    const hinge = Math.round(lerp(9, 10, h / 9));
    for (let x = Math.ceil(te); x <= Math.floor(le); x++) {
      let c = "body";
      if (h === 9)
        c = "dark"; // 先端キャップ
      else if (x >= Math.floor(le)) c = "edge";
      else if (x === hinge && h >= 1 && h <= 7)
        c = "panel"; // 方向舵
      else if (h === 7 && x >= hinge + 2 && x <= hinge + 4) c = "light";
      put(x, y, z0, c);
      if (z1 !== z0 && h < 9) put(x, y, z1, c); // 段差のすき間を埋める
    }
  }
  // 垂直尾翼の付け根（胴体上面とつなぐ）
  for (let x = 6; x <= 19; x++) if (!has(x, 5, 5)) put(x, 5, 5, "body");

  // --- キャノピー後方の背部フェアリング
  for (let x = 24; x <= 37; x++) {
    const t = (37 - x) / 13;
    const top = lerp(8.7, 7.0, t);
    const a = lerp(2.4, 1.2, t);
    for (let y = 7; y <= Math.round(top); y++) {
      for (let z = 0; z <= 3; z++) {
        const dz = z / (a + 0.3),
          dy = (y - 6.8) / (top - 6.8 + 0.3);
        if (dz * dz + dy * dy <= 1) put(x, y, z, "body");
      }
    }
  }

  // --- 迷彩とパネルライン（外板の色付け）
  for (const v of Array.from(map.values())) {
    const [x, y, z, c] = v;
    if (c !== "body" || z < 0) continue;
    const up = !has(x, y + 1, z),
      down = !has(x, y - 1, z);
    let col = down && !up ? "belly" : camo(x, y, z);
    if (down && !up) {
      // 主兵器倉の扉（のこぎり歯状の前後縁）、中央の合わせ目
      const saw = z % 2;
      if (
        z <= 3 &&
        x >= 19 + saw &&
        x <= 33 + saw &&
        (z === 3 || z === 0 || x === 19 + saw || x === 33 + saw)
      )
        col = "panel";
      // 主脚扉
      if (
        z >= 4 &&
        z <= 6 &&
        x >= 24 &&
        x <= 30 &&
        (z === 4 || z === 6 || x === 24 || x === 30)
      )
        col = "panel";
      // 前脚扉
      if (
        z <= 1 &&
        x >= 43 &&
        x <= 47 &&
        (z === 1 || x === 43 || x === 47 || z === 0)
      )
        col = "panel";
    }
    if (up) {
      // 背部の空中給油口
      if (z <= 1 && x >= 27 && x <= 30 && (z === 1 || x === 27 || x === 30))
        col = "panel";
      // エンジン点検パネル
      if (z >= 2 && z <= 3 && x >= 11 && x <= 16 && (x === 11 || x === 16))
        col = "panel";
    }
    put(x, y, z, col);
  }

  // --- 一体型バブルキャノピー（金色、枠なし）
  for (let x = 35; x <= 51; x++) {
    const u = (x - 43) / 8;
    if (Math.abs(u) > 1) continue;
    const s = Math.sqrt(1 - u * u);
    const top = 6.6 + 3.4 * (u > 0 ? Math.sqrt(1 - Math.pow(u, 1.5)) : s);
    const a = 2.1 * s + 0.4;
    for (let y = 6; y <= Math.round(top); y++) {
      for (let z = 0; z <= 3; z++) {
        const dz = z / (a + 0.3),
          dy = (y - 6.2) / (top - 6.2 + 0.3);
        if (dz * dz + dy * dy > 1) continue;
        put(x, y, z, "canopy");
      }
    }
  }
  // 頂部の照り返し
  for (const [x, y, z, c] of Array.from(map.values())) {
    if (c === "canopy" && z === 0 && !has(x, y + 1, z) && x >= 39 && x <= 46)
      put(x, y, z, "glint");
  }
  // キャノピー縁のシール線
  for (const [x, y, z, c] of Array.from(map.values())) {
    if (z < 0 || c === "canopy" || c === "glint" || y < 6) continue;
    if ((get(x, y + 1, z) || [])[3] === "canopy" && !has(x, y, z + 1))
      put(x, y, z, "panel");
  }

  // --- 機首側面のフォーメーションライト（チャインの直下）
  for (let x = 46; x <= 48; x++) {
    let zmax = -1;
    for (let z = 0; z <= 5; z++) if (has(x, 3, z)) zmax = z;
    if (zmax >= 0) paint(x, 3, zmax, "light");
  }

  const voxels = [];
  for (const [x, y, z, c] of map.values()) voxels.push([x - 28, y, z, c]);
  return { id: "f22a", name: "F-22A Raptor", palette, voxels };
})();
