(window.VOXEL_MODELS = window.VOXEL_MODELS || {})["adf11f"] = (function () {
  // ADF-11F Raven（AC7 の架空無人戦闘機）。1m = 3 ボクセル（全長約 18.5m → 56 ボクセル）。
  // 無人機なのでキャノピーはなく、機首上面に赤いセンサーの「目」。機首側の前半分が
  // 分離するコア UAV で、その継ぎ目と折りたたまれた小翼をパネルラインで描く。
  const palette = {
    body: "#3c4148", // 機体上面のダークグレー
    panel: "#30343a", // 動翼・パネルの少し暗いグレー
    core: "#434951", // コア UAV の外板（わずかに明るい）
    under: "#2e3238", // 下面
    dark: "#23272c", // 主翼前縁・尾翼先端などの黒に近いグレー
    seam: "#2a2e33", // 細かなパネルライン
    line: "#121417", // コア UAV の分離線
    sensor: "#c8452c", // 赤いセンサー
    glow: "#ff6a3d", // センサー中心の明るい赤
    intake: "#0d0f11", // 空気取り入れ口の奥
    nozzle: "#4a4d52", // 排気ノズルの外周
    petal: "#3a3c40", // ノズルの花弁の継ぎ目
    exhaust: "#8a3b22", // ノズル奥（焼けた金属）
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
  const colorAt = (x, y, z) => (map.get(key(x, y, z)) || [])[3];
  function recolor(x, y, z, c) {
    if (has(x, y, z)) put(x, y, z, c);
  }
  // その列 (x, z) のいちばん上 / いちばん下のボクセルを塗る
  function topOf(x, z) {
    for (let y = 30; y >= -5; y--) if (has(x, y, z)) return y;
    return null;
  }
  function botOf(x, z) {
    for (let y = -5; y <= 30; y++) if (has(x, y, z)) return y;
    return null;
  }
  function paintTop(x, z, c) {
    const y = topOf(x, z);
    if (y !== null) put(x, y, z, c);
    return y;
  }
  function paintBot(x, z, c) {
    const y = botOf(x, z);
    if (y !== null) put(x, y, z, c);
    return y;
  }
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

  // x は尾端 0 〜 機首 NOSE で作り、最後に中心へずらす。
  const NOSE = 55;
  const CY = 5; // チャイン（胴体側面の稜線）の高さ
  const SEAM = 31; // コア UAV の後端

  // 胴体の半幅・上面の高さ・下面の深さ
  function halfWidth(x) {
    if (x > 44)
      return 3.1 * Math.pow(clamp01((NOSE + 0.6 - x) / (NOSE + 0.6 - 44)), 0.9);
    if (x > 30) return lerp(5.6, 3.1, (x - 30) / 14);
    if (x < 4) return lerp(4.6, 5.6, x / 4);
    return 5.6;
  }
  function topH(x) {
    if (x > 38) return lerp(3.0, 0.5, Math.pow((x - 38) / (NOSE - 38), 1.2));
    if (x > 30) return lerp(3.4, 3.0, (x - 30) / 8);
    if (x >= 22) return 3.4;
    return lerp(2.4, 3.4, x / 22);
  }
  function botH(x) {
    if (x > 34) return lerp(2.4, 0.4, (x - 34) / (NOSE - 34));
    return 2.4;
  }

  // --- 胴体。上下で形の違うレンズ断面にして、側面に鋭いチャインを作る
  for (let x = 2; x <= NOSE; x++) {
    const w = halfWidth(x);
    const ht = topH(x);
    const hb = botH(x);
    for (let z = 0; z <= Math.ceil(w); z++) {
      const r = z / (w + 0.45);
      if (r > 1) continue;
      const top = CY + ht * (1 - r * r);
      const bot = CY - hb * (1 - Math.pow(r, 1.6));
      for (let y = Math.round(bot); y <= Math.round(top); y++) {
        put(x, y, z, y < CY ? "under" : x >= SEAM ? "core" : "body");
      }
    }
  }
  // 背中の稜線（コア UAV の背骨）
  for (let x = SEAM + 1; x <= 46; x++) {
    const y = topOf(x, 0);
    if (y !== null && x <= 42) put(x, y + 1, 0, "core");
  }

  // --- エンジンナセル（胴体下面の左右 2 基）と排気口
  const EZ = 3,
    EY = CY - 1,
    ER = 2.3;
  for (let x = 0; x <= 30; x++) {
    const rr = x > 26 ? lerp(ER, ER - 0.3, (x - 26) / 4) : ER;
    for (let z = 0; z <= EZ + 3; z++) {
      for (let y = EY - 3; y <= EY + 3; y++) {
        const dz = z - EZ,
          dy = y - EY;
        if (dz * dz + dy * dy > (rr + 0.35) * (rr + 0.35)) continue;
        if (x >= 2 && y >= CY && has(x, y, z)) continue;
        put(x, y, z, y < CY ? "under" : "body");
      }
    }
  }
  // 排気口：外周は花弁状のノズル、奥は焼けた色で 1 段へこませる
  for (let x = 0; x <= 2; x++) {
    for (let z = 0; z <= EZ + 3; z++) {
      for (let y = EY - 3; y <= EY + 3; y++) {
        const dz = z - EZ,
          dy = y - EY;
        const d2 = dz * dz + dy * dy;
        if (d2 > (ER + 0.35) * (ER + 0.35)) continue;
        const inner = d2 <= (ER - 0.8) * (ER - 0.8);
        const ang = Math.atan2(dy, dz);
        const rim =
          Math.floor(((ang + Math.PI) / (2 * Math.PI)) * 8 + 0.5) % 2
            ? "nozzle"
            : "petal";
        if (x === 0) {
          if (inner) del(x, y, z);
          else put(x, y, z, rim);
        } else if (x === 1) put(x, y, z, inner ? "exhaust" : rim);
        else if (!inner) put(x, y, z, "nozzle");
      }
    }
  }
  // 2 基のあいだのビーバーテール
  for (let x = 0; x <= 3; x++)
    for (let z = 0; z <= 1; z++) put(x, CY, z, "dark");

  // --- 空気取り入れ口（主翼前縁の付け根の下、チャインの陰）
  for (let x = 28; x <= 33; x++) {
    for (let z = 2; z <= 5; z++) {
      for (let y = CY - 3; y <= CY - 1; y++)
        put(x, y, z, x === 33 ? "dark" : "under");
    }
  }
  for (let z = 2; z <= 4; z++) {
    for (let y = CY - 3; y <= CY - 2; y++) {
      del(33, y, z);
      put(32, y, z, "intake");
    }
  }
  // 境界層を分けるスプリッター板
  for (let x = 32; x <= 35; x++)
    for (let y = CY - 3; y <= CY - 1; y++) {
      if (x >= 34 && y === CY - 3) continue;
      put(x, y, 1, "dark");
    }

  // --- 主翼：前縁後退角の大きい切り詰めデルタ。後縁はのこぎり状
  const wing = [
    [37, 4],
    [13, 19.5],
    [8.5, 19.5],
    [9.5, 13.5],
    [5, 9.5],
    [6, 6],
    [2, 4],
  ];
  const leX = (z) => lerp(37, 13, (z - 4) / 15.5); // 前縁の x
  for (let x = 0; x <= 40; x++) {
    for (let z = 4; z <= 20; z++) {
      if (!inPoly(x + 0.5, z + 0.5, wing)) continue;
      const le = x + 0.5 >= leX(z + 0.5) - 1.6; // 前縁の暗色帯
      put(x, CY, z, le ? "dark" : "body");
      if (z <= 11) put(x, CY - 1, z, "under"); // 付け根側は厚く
      if (z <= 7 && !le) put(x, CY + 1, z, "body");
    }
  }
  // 後縁の動翼（エレボン 2 枚・フラップ）。ヒンジ線を seam で描く
  for (let x = 0; x <= 30; x++) {
    for (let z = 6; z <= 19; z++) {
      if (!inPoly(x + 0.5, z + 0.5, wing)) continue;
      if (x + 0.5 >= leX(z + 0.5) - 1.6) continue;
      const aft = !inPoly(x - 2.5, z + 0.5, wing);
      const hinge = !aft && !inPoly(x - 3.5, z + 0.5, wing);
      if (!aft && !hinge) continue;
      const split = z === 10 || z === 15; // 動翼の境目
      paintTop(x, z, hinge || split ? "seam" : "panel");
    }
  }
  // 翼上のアクセスパネル（前縁と平行な細い線）
  for (let z = 7; z <= 16; z++) {
    const x = Math.round(leX(z + 0.5) - 5);
    if (inPoly(x + 0.5, z + 0.5, wing) && colorAt(x, CY, z) === "body")
      recolor(x, CY, z, "seam");
  }
  // 翼端：赤い航法灯と暗色の翼端板
  for (let x = 9; x <= 13; x++) recolor(x, CY, 18, x <= 10 ? "sensor" : "dark");
  // 翼下面のパイロン跡（小さなパネル）
  for (let x = 16; x <= 22; x++) recolor(x, CY - 1, 9, "seam");

  // --- 双垂直尾翼：外側へ大きく傾けて配置
  for (let y = 0; y <= 9; y++) {
    const h = y / 9;
    const le = lerp(16, 9, Math.pow(h, 0.9));
    const te = lerp(3, 5, h);
    const zc = 4.5 + y * 0.55;
    const yy = Math.round(CY + 2.4 + y);
    for (let x = Math.ceil(te); x <= Math.floor(le); x++) {
      let c = "body";
      if (y === 9 || x === Math.floor(le))
        c = "dark"; // 先端と前縁
      else if (x <= Math.ceil(te) + 1 && y >= 2)
        c = "panel"; // ラダー
      else if (x === Math.ceil(te) + 2 && y >= 2)
        c = "seam"; // ラダーのヒンジ
      else if (y === 6 && x >= Math.ceil(te) + 3 && x <= Math.ceil(te) + 5)
        c = "sensor"; // 赤い帯
      for (const z of [Math.floor(zc), Math.ceil(zc)]) put(x, yy, z, c);
    }
  }
  // 尾翼の付け根を胴体へなじませる
  for (let x = 4; x <= 15; x++)
    for (let y = CY + 2; y <= CY + 3; y++)
      for (let z = 4; z <= 5; z++) {
        if (!has(x, y, z)) put(x, y, z, "body");
      }
  // 尾翼先端の赤ライト
  put(6, CY + 11, 9, "sensor");
  put(7, CY + 11, 9, "sensor");

  // --- 胴体上面のディテール
  // パネルの継ぎ目（横方向）
  for (const px of [12, 21])
    for (let z = 0; z <= 5; z++) paintTop(px, z, "seam");
  // 縦方向のパネルライン（エンジン上）
  for (let x = 4; x <= 29; x++) {
    const y = topOf(x, 3);
    if (y !== null && colorAt(x, y, 3) === "body") put(x, y, 3, "seam");
  }
  // エンジン冷却用のグリル
  for (let x = 6; x <= 10; x++)
    if (x % 2 === 0) for (let z = 1; z <= 2; z++) paintTop(x, z, "dark");
  // 補助インテーク（背中の小さな開口）
  for (let x = 26; x <= 28; x++) paintTop(x, 2, "intake");
  paintTop(29, 2, "dark");

  // --- 下面のディテール
  // 兵器倉の扉（左右 2 枚）の外形
  for (let x = 13; x <= 26; x++) {
    for (let z = 0; z <= 1; z++) {
      const edge = x === 13 || x === 26 || z === 0;
      paintBot(x, z, edge ? "seam" : "under");
    }
  }
  // 前脚扉
  for (let x = 37; x <= 41; x++)
    paintBot(x, 0, x === 37 || x === 41 ? "seam" : "dark");

  // --- コア UAV：分離線・小翼・外板
  // 分離線を胴体断面に沿って一周させる
  for (let z = 0; z <= 6; z++) {
    const yt = topOf(SEAM, z),
      yb = botOf(SEAM, z);
    if (yt !== null && yt >= CY) put(SEAM, yt, z, "line");
    if (yb !== null && z <= 1) put(SEAM, yb, z, "line");
  }
  for (let y = CY - 2; y <= CY + 2; y++) {
    for (let z = 6; z >= 0; z--)
      if (has(SEAM, y, z)) {
        put(SEAM, y, z, "line");
        break;
      }
  }
  // 上面の外形線（後ろから前へ細くなる）
  for (let x = SEAM; x <= 50; x++) {
    const z = Math.max(1, Math.round(lerp(4.4, 1.2, (x - SEAM) / (50 - SEAM))));
    paintTop(x, z, "line");
  }
  // チャイン上に収納された小翼（コア UAV の主翼）の輪郭
  for (let x = 33; x <= 41; x++) {
    const zc = Math.round(halfWidth(x) - 0.6);
    const y = topOf(x, zc);
    if (y === null) continue;
    if (x === 33 || x === 41) put(x, y, zc, "line");
    else put(x, y, zc, x <= 35 ? "panel" : "core");
    if (x >= 34 && x <= 39) recolor(x, y, zc - 1, x === 34 ? "line" : "panel");
  }
  // 背中の分離用スリット
  for (let x = 33; x <= 38; x++) paintTop(x, 0, x % 2 ? "dark" : "line");

  // --- 機首のセンサー（キャノピーの代わり）。上面中央に細長い赤い「目」
  for (let x = 40; x <= 49; x++) {
    const zMax = x <= 42 || x >= 48 ? 0 : 1;
    for (let z = 0; z <= zMax; z++) {
      const c = x >= 44 && x <= 46 && z === 0 ? "glow" : "sensor";
      paintTop(x, z, c);
    }
  }
  // 目のまわりの黒い縁取り
  for (const [x, z] of [
    [39, 0],
    [42, 1],
    [48, 1],
    [43, 2],
    [44, 2],
    [45, 2],
    [46, 2],
    [47, 2],
    [50, 0],
  ])
    paintTop(x, z, "dark");
  // 機首側面（チャイン直上）のセンサー窓
  for (let x = 45; x <= 49; x++) {
    const z = Math.round(halfWidth(x) - 0.5);
    recolor(x, CY + 1, z, x === 47 ? "glow" : "sensor");
    recolor(x, CY, z + 1, "dark");
  }
  // 機首下面のセンサー（EOTS 風）
  for (let x = 47; x <= 49; x++)
    recolor(x, botOf(x, 0), 0, x === 48 ? "glow" : "sensor");
  // 機首先端のピトー管風の暗色チップ
  recolor(NOSE, CY, 0, "dark");

  // 中心へ寄せて配列化
  const voxels = [];
  for (const [x, y, z, c] of map.values()) voxels.push([x - 28, y, z, c]);
  return { id: "adf11f", name: "ADF-11F Raven", palette, voxels };
})();
