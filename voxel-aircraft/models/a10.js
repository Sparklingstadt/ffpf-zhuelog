(window.VOXEL_MODELS = window.VOXEL_MODELS || {})["a10"] = (function () {
  // A-10 Thunderbolt II。1m = 3 ボクセル（全長 16.3m → 約 49 ボクセル、翼幅 17.5m → 53 ボクセル）。
  // ダークグレー2色迷彩（下面はやや明るいグレー）、機首にシャークマウス。
  // 兵装は近接航空支援の典型的な搭載: 内翼に GBU-12、主脚ポッドの外側に LAU-88（マベリック3連）、
  // その外に LAU-131 ロケットポッド、翼端寄りに AIM-9 の2連ランチャー。胴体下のパイロンは空き。
  const palette = {
    body: "#6f7a72", // 迷彩の明るい側
    dark: "#4d5650", // 迷彩の暗い側
    light: "#8a948d", // 下面
    panel: "#626c65", // パネルライン（明るい側の上）
    panelDark: "#434b46", // パネルライン（暗い側の上）
    panelLight: "#78827b", // パネルライン（下面の上）
    canopy: "#2a3a4a", // キャノピーのガラス
    glass2: "#41566b", // ガラス上部の映り込み
    frame: "#3f4742", // キャノピー枠・防眩パネル
    gun: "#3a3a3a", // GAU-8 の砲身
    bore: "#111214", // 砲口・ロケット発射口
    intake: "#1c2024", // 吸気口の奥・空中給油口
    lip: "#9aa39d", // エンジン吸気口のリップ
    fan: "#33383c", // ファン面
    spinner: "#a7adb1", // ファンのスピナー
    exhaust: "#5a4a3e", // 排気ノズル
    metal: "#7d7f80", // 排気コーン・金属部
    tire: "#202224", // 主脚タイヤ
    pylon: "#5e665f", // パイロン・ランチャー
    store: "#6b6e4a", // 爆弾（オリーブ）
    store2: "#7d8378", // ロケットポッド
    missile: "#c9cbc4", // マベリック・サイドワインダー
    seeker: "#2d2f33", // ミサイルのシーカー
    yellow: "#c9b458", // 実弾の帯・給油口の縁取り
    insig: "#3c433f", // 低視認性の国籍標識
    insigStar: "#8b948e", // 国籍標識の星
    slime: "#b6cf7d", // 編隊灯（スライムライト）
    navRed: "#c0392b", // 左翼端灯
    navGreen: "#2e9e5b", // 右翼端灯
    mouth: "#7a1f1f", // シャークマウスの口
    teeth: "#e8e6dc", // 歯
    eye: "#d8c23a", // 目
  };

  const map = new Map();
  const key = (x, y, z) => x + "," + y + "," + z;
  // z >= 0 側だけ書けば左右対称に置かれる
  function put(x, y, z, c) {
    map.set(key(x, y, z), [x, y, z, c]);
    map.set(key(x, y, -z), [x, y, -z, c]);
  }
  // 片側だけ色を変える（形は対称のまま）
  function paintOne(x, y, z, c) {
    if (map.has(key(x, y, z))) map.set(key(x, y, z), [x, y, z, c]);
  }
  const has = (x, y, z) => map.has(key(x, y, z));
  const colorAt = (x, y, z) => (map.get(key(x, y, z)) || [])[3];
  const lerp = (a, b, t) => a + (b - a) * t;
  // 折れ線補間: pts = [[x, v], ...]（x 昇順）
  function pw(pts, x) {
    if (x <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      if (x <= pts[i][0]) {
        const [x0, v0] = pts[i - 1],
          [x1, v1] = pts[i];
        return lerp(v0, v1, (x - x0) / (x1 - x0));
      }
    }
    return pts[pts.length - 1][1];
  }
  // 上面・側面の迷彩パターン（左右対称）
  function camo(x, y, z) {
    const v =
      Math.sin(x * 0.33 + z * 0.21 + 0.7) +
      Math.sin(z * 0.43 - x * 0.17 + y * 0.29 + 1.9) +
      0.35 * Math.sin(x * 0.9 + y * 0.7 - z * 0.5);
    return v > 0.6 ? "dark" : "body";
  }
  // 迷彩色の上だけパネルラインの色に塗り替える
  const PANEL = { body: "panel", dark: "panelDark", light: "panelLight" };
  function panelLine(x, y, z) {
    const c = colorAt(x, y, z);
    if (PANEL[c]) put(x, y, z, PANEL[c]);
  }

  // x は尾端 0 〜 機首 47 で作り、ビューア側で中心へ寄せる。y = 0 が胴体下面。
  const NOSE = 47;

  // ======================================================================
  // 胴体。角の丸い箱形断面（超楕円）で、尾部に向かって細く上がっていく。
  const halfW = [
    [0, 0.9],
    [6, 1.5],
    [18, 2.7],
    [28, 3.0],
    [41, 3.0],
    [45, 2.4],
    [47, 1.3],
  ];
  const halfH = [
    [0, 1.0],
    [6, 1.7],
    [18, 2.9],
    [30, 3.2],
    [41, 3.0],
    [45, 2.2],
    [47, 1.2],
  ];
  const midY = [
    [0, 5.0],
    [6, 4.6],
    [18, 3.6],
    [30, 3.3],
    [47, 2.9],
  ];
  const fusTop = (x) => Math.floor(pw(midY, x) + pw(halfH, x) + 0.4);
  for (let x = 0; x <= NOSE; x++) {
    const a = pw(halfW, x),
      b = pw(halfH, x),
      cy = pw(midY, x);
    for (let y = 0; y <= 9; y++) {
      for (let z = 0; z <= 4; z++) {
        const dz = Math.abs(z) / (a + 0.4),
          dy = Math.abs(y - cy) / (b + 0.4);
        if (Math.pow(dz, 2.6) + Math.pow(dy, 2.6) > 1) continue;
        let c = y < cy - 1 ? "light" : camo(x, y, z);
        if (x >= 41 && x <= 45 && y >= cy + b - 0.6 && z <= 1) c = "frame"; // 防眩パネル
        put(x, y, z, c);
      }
    }
  }
  // 尾端の灯火
  put(-1, 5, 0, "metal");
  // 胴体のパネルライン（輪切り方向）
  for (const px of [6, 12, 19, 27, 42]) {
    for (let y = 0; y <= 9; y++)
      for (let z = 0; z <= 4; z++) panelLine(px, y, z);
  }
  // 胴体側面の縦通材ライン（中ほどの高さを前後に走る）
  for (let x = 6; x <= 30; x++) {
    const y = Math.round(pw(midY, x));
    for (let z = 4; z >= 0; z--)
      if (has(x, y, z)) {
        panelLine(x, y, z);
        break;
      }
  }
  // 機首下の砲身フェアリングと前脚扉のライン
  for (let x = 36; x <= 45; x++)
    put(x, 0, 1, x === 36 || x === 45 ? "panelLight" : "light");
  for (let x = 34; x <= 41; x++) panelLine(x, 0, 2);

  // ======================================================================
  // シャークマウス（機首側面、砲身の上あたり）。後ろがすぼまり、機首側へ大きく開く。
  // 側面の一番外側のボクセルを塗る
  function paintSide(x, y, c) {
    for (let z = 4; z >= 0; z--)
      if (has(x, y, z)) {
        put(x, y, z, c);
        return;
      }
  }
  let eyeY = 0;
  for (let x = 37; x <= 46; x++) {
    const t = (x - 37) / 9;
    const yc = pw(midY, x) - 0.2 - t * 0.3;
    const h = 0.4 + t * 1.1;
    const lower = Math.round(yc - h),
      upper = Math.round(yc + h);
    if (x === 39) eyeY = upper + 2;
    paintSide(x, upper + 1, "bore"); // 唇の黒い縁取り
    paintSide(x, lower - 1, "bore");
    for (let y = lower; y <= upper; y++) {
      let c = "mouth";
      // 上下の歯は同じ位置にそろえ、口の奥（細い所）は赤のまま
      if (upper > lower && (y === upper || y === lower) && x % 2 === 0)
        c = "teeth";
      paintSide(x, y, c);
    }
  }
  // 目（口の後端の上）
  paintSide(39, eyeY, "eye");
  paintSide(40, eyeY, "bore");

  // ======================================================================
  // バブルキャノピー（コクピットの上に大きく盛り上がる）
  for (let x = 30; x <= 41; x++) {
    for (let y = 5; y <= 10; y++) {
      for (let z = 0; z <= 2; z++) {
        const dx = (x - 35.5) / 5.6,
          dy = (y - 6.0) / 3.6,
          dz = z / 2.4;
        if (dx * dx + dy * dy + dz * dz > 1) continue;
        if (has(x, y, z) && y < 6.5) continue; // 胴体と重なる低い所は胴体の色のまま
        put(x, y, z, "canopy");
      }
    }
  }
  // ガラスの塗り分け: 上部の映り込み、窓枠（風防の枠・キャノピーの弓・下縁）
  for (let x = 30; x <= 41; x++) {
    let top = -1;
    for (let y = 10; y >= 5; y--)
      if (colorAt(x, y, 0) === "canopy") {
        top = y;
        break;
      }
    for (let y = 5; y <= 10; y++) {
      for (let z = 0; z <= 2; z++) {
        if (colorAt(x, y, z) !== "canopy") continue;
        let c = "canopy";
        if (y === top && z === 0 && x >= 32 && x <= 37) c = "glass2";
        if (x === 39) c = "frame"; // 風防とキャノピーの境の弓
        if (x >= 40 && (z === 2 || y === top)) c = "frame"; // 平面風防の枠
        if (y === 6 && x <= 38) c = "frame"; // キャノピーの下縁
        put(x, y, z, c);
      }
    }
  }
  // 空中給油口（防眩パネルの前、黄色の縁取り）
  {
    const y = fusTop(43);
    for (let x = 42; x <= 44; x++)
      for (let z = 0; z <= 1; z++) {
        if (has(x, y, z))
          put(x, y, z, x === 43 && z === 0 ? "intake" : "yellow");
      }
  }
  // キャノピー後方の背部フェアリング（エンジン方向へなだらかに下がる）
  for (let x = 22; x <= 30; x++) {
    const top = Math.round(lerp(6.2, 8.0, (x - 22) / 8));
    for (let y = 6; y <= top; y++) {
      const w = y >= top ? 1 : 2;
      for (let z = 0; z <= w; z++)
        if (!has(x, y, z)) put(x, y, z, camo(x, y, z));
    }
  }
  // 背部の UHF ブレードアンテナ
  put(25, 8, 0, "dark");
  put(26, 8, 0, "dark");
  put(26, 9, 0, "dark");
  // 胴体下のアンテナ
  put(17, -1, 0, "dark");
  put(16, -1, 0, "dark");
  // 編隊灯（キャノピー後方の胴体側面）
  for (let y = 4; y <= 5; y++) {
    for (let z = 4; z >= 0; z--)
      if (has(29, y, z)) {
        put(29, y, z, "slime");
        break;
      }
  }

  // ======================================================================
  // 主翼。厚い直線翼。内翼（z ≤ 10）は水平、外翼は上反角（約 7°）で先端が上がる。
  // 平面形: 前縁は内翼 x = 30 から翼端 x = 28 へ、後縁は x = 20 から 23 へ（テーパー）。
  const ROOT = 10,
    TIP = 26;
  function wingLE(z) {
    return z <= ROOT ? 30 : lerp(30, 28, (z - ROOT) / (TIP - ROOT));
  }
  function wingTE(z) {
    return z <= ROOT ? 20 : lerp(20, 23, (z - ROOT) / (TIP - ROOT));
  }
  function wingBase(z) {
    return z <= ROOT ? 1 : 1 + (z - ROOT) * 0.14;
  }
  const wingTopAt = {}; // `${x},${z}` → 上面の y
  for (let z = 0; z <= TIP - 1; z++) {
    const le = wingLE(z),
      te = wingTE(z),
      base = Math.round(wingBase(z));
    const maxT = z <= ROOT ? 2.6 : lerp(2.2, 1.2, (z - ROOT) / (TIP - ROOT));
    for (let x = Math.ceil(te); x <= Math.floor(le); x++) {
      const u = (le - x) / (le - te); // 0 = 前縁, 1 = 後縁
      const prof = u < 0.3 ? Math.sqrt(u / 0.3) : 1 - ((u - 0.3) / 0.7) * 0.85;
      const th = Math.max(1, Math.round(maxT * prof));
      for (let k = 0; k < th; k++) {
        const y = base + k;
        if (has(x, y, z) && z <= 3) continue; // 胴体の中は胴体のまま
        put(x, y, z, k === 0 && th > 1 ? "light" : camo(x, y, z));
      }
      wingTopAt[x + "," + z] = base + th - 1;
    }
  }
  // ヘルナー翼端（下向きに垂れる）と翼端灯（右 = +z が緑、左が赤）
  for (let x = 23; x <= 28; x++) {
    const b = Math.round(wingBase(TIP));
    put(x, b - 1, TIP, "dark");
    if (x >= 24 && x <= 27) put(x, b, TIP, "dark");
  }
  {
    const b = Math.round(wingBase(TIP));
    paintOne(28, b - 1, TIP, "navGreen");
    paintOne(28, b - 1, -TIP, "navRed");
    put(23, b, TIP, "slime"); // 翼端後方の編隊灯
  }
  // 上面のパネルライン: フラップ / デセラロン（エルロン）のヒンジ線、その境目、内翼の前縁スラット
  for (let z = 4; z <= TIP - 1; z++) {
    const hx = Math.ceil(wingTE(z)) + 2;
    const y = wingTopAt[hx + "," + z];
    if (y !== undefined) panelLine(hx, y, z);
  }
  for (const sz of [10, 17]) {
    for (let x = Math.ceil(wingTE(sz)); x <= Math.ceil(wingTE(sz)) + 2; x++) {
      const y = wingTopAt[x + "," + sz];
      if (y !== undefined) panelLine(x, y, sz);
    }
  }
  for (let z = 4; z <= 9; z++) {
    const x = Math.floor(wingLE(z)) - 1;
    const y = wingTopAt[x + "," + z];
    if (y !== undefined) panelLine(x, y, z);
  }
  // デセラロンの先端を割った線（翼端寄りの後縁）
  for (let z = 21; z <= TIP - 1; z++) {
    const x = Math.ceil(wingTE(z));
    const base = Math.round(wingBase(z));
    if (has(x, base, z)) put(x, base, z, "panelDark");
  }
  // 主翼上面の国籍標識（左翼のみの実機に合わせず、左右対称に置く低視認性マーク）
  {
    const cx = 25,
      cz = 19,
      y0 = (x, z) => wingTopAt[x + "," + z];
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        const y = y0(cx + dx, cz + dz);
        if (y !== undefined)
          put(
            cx + dx,
            y,
            cz + dz,
            dx === 0 && dz === 0 ? "insigStar" : "insig",
          );
      }
    for (const dz of [-2, 2]) {
      const y = y0(cx, cz + dz);
      if (y !== undefined) put(cx, y, cz + dz, "insig");
    }
  }

  // ======================================================================
  // 主脚ポッド（内翼と外翼の境目、前縁より前に突き出す）。タイヤが下に半分のぞく。
  for (let x = 22; x <= 34; x++) {
    const r =
      x > 31
        ? lerp(1.6, 0.6, (x - 31) / 3)
        : x < 24
          ? lerp(0.6, 1.6, (x - 22) / 2)
          : 1.6;
    for (let y = -2; y <= 1; y++) {
      for (let z = 8; z <= 12; z++) {
        const dz = (z - 10) / (r + 0.3),
          dy = (y + 0.3) / (r + 0.6);
        if (dz * dz + dy * dy > 1) continue;
        put(x, y, z, y <= -1 ? "light" : camo(x, y, z));
      }
    }
  }
  for (const px of [26, 31])
    for (let y = -2; y <= 1; y++)
      for (let z = 8; z <= 12; z++) panelLine(px, y, z);
  // タイヤ（ポッド下面から半分露出）とハブ
  for (let x = 29; x <= 33; x++) {
    for (let y = -3; y <= -1; y++) {
      if (Math.hypot(x - 31, (y + 1.5) * 1.3) > 2.2) continue;
      put(x, y, 10, "tire");
    }
  }
  put(31, -2, 10, "metal");

  // ======================================================================
  // エンジンポッド（TF34、胴体後部の上に左右 2 基）
  const EZ = 6,
    EY = 9,
    ER = 2.3;
  for (let x = 8; x <= 21; x++) {
    let r = ER;
    if (x === 11) r = 2.0; // 後端へすぼまる
    if (x === 9 || x === 10) r = 1.6; // ファン排気ノズル
    if (x === 8) r = 1.0; // コアノズル
    if (x === 21) r = ER + 0.1; // 吸気口リップ
    for (let y = 5; y <= 13; y++) {
      for (let z = 2; z <= 10; z++) {
        const d = Math.hypot(y - EY, z - EZ);
        if (d > r + 0.35) continue;
        let c = y < EY - 1 ? "light" : camo(x, y, z);
        if (x === 21) {
          if (d < r - 0.8) continue; // 吸気口は1段くぼませる
          c = "lip";
        }
        if (x === 20 && d < r - 0.8) c = d < 0.8 ? "spinner" : "fan";
        if (x <= 10) c = "exhaust";
        if (x === 8) c = d < 0.6 ? "metal" : "exhaust";
        if (x === 9 && d < 0.9) c = "bore";
        put(x, y, z, c);
      }
    }
  }
  // ナセルのパネルライン（ファンカウルの分割）と国籍標識（外側面）
  for (const px of [13, 18]) {
    for (let y = 5; y <= 13; y++)
      for (let z = 2; z <= 10; z++) panelLine(px, y, z);
  }
  {
    const z = 8; // 外側面
    for (let y = 8; y <= 10; y++)
      for (let x = 14; x <= 16; x++) {
        const zz = has(x, y, z + 1) ? z + 1 : z;
        put(x, y, zz, x === 15 && y === 9 ? "insigStar" : "insig");
      }
    for (const x of [13, 17]) put(x, 9, has(x, 9, z + 1) ? z + 1 : z, "insig");
  }
  // エンジンパイロン（胴体とエンジンの間）
  for (let x = 12; x <= 19; x++) {
    for (let y = 5; y <= 7; y++) {
      for (let z = 3; z <= 4; z++) if (!has(x, y, z)) put(x, y, z, "pylon");
    }
  }

  // ======================================================================
  // 水平尾翼（エンジンの後ろ）。後ろ寄りに昇降舵のヒンジ線。
  for (let x = 0; x <= 6; x++) {
    for (let z = 0; z <= 8; z++) {
      if (x === 6 && z > 6) continue;
      put(x, 5, z, x === 2 && z >= 2 ? "panel" : camo(x, 5, z));
      if (x >= 2 && x <= 4 && z <= 5) put(x, 4, z, "light");
    }
  }
  // 双垂直尾翼（水平尾翼の両端、上下に張り出す H 型）。後ろ側に方向舵。
  for (let y = 1; y <= 13; y++) {
    let xs = 0,
      xe = 7;
    if (y >= 12) {
      xs = 1;
      xe = 5;
    }
    if (y === 13) {
      xs = 2;
      xe = 4;
    }
    if (y <= 2) {
      xs = 1;
      xe = 5;
    }
    for (let x = xs; x <= xe; x++) {
      for (let z = 8; z <= 9; z++) {
        let c = y >= 12 ? "dark" : camo(x, y, z);
        if (x === 2 && y >= 3 && y <= 11) c = PANEL[c] || c; // 方向舵のヒンジ線
        put(x, y, z, c);
      }
    }
  }
  // 垂直尾翼外側の編隊灯
  for (let y = 7; y <= 9; y++) put(5, y, 9, "slime");

  // ======================================================================
  // GAU-8 アヴェンジャー（7 砲身）。機首下から突き出し、先端にマズルクランプ。
  for (let x = 45; x <= 50; x++) {
    for (const [y, z] of [
      [1, 0],
      [0, 0],
      [2, 0],
      [1, 1],
    ]) {
      if (x <= 47 && has(x, y, z) && y >= 1) continue; // 機首内に埋まる部分はそのまま
      put(x, y, z, "gun");
    }
  }
  for (let y = 0; y <= 2; y++)
    for (let z = 0; z <= 1; z++) put(49, y, z, "gun");
  put(50, 1, 0, "bore");

  // ======================================================================
  // 兵装パイロンと搭載兵装
  function pylon(z, x0, x1, depth) {
    const base = Math.round(wingBase(z));
    for (let x = x0; x <= x1; x++)
      for (let d = 1; d <= depth; d++) put(x, base - d, z, "pylon");
    return base - depth - 1; // 兵装の上端
  }
  // 十字フィン（cz の左右・cy の上下に長さ len）
  function crossFin(x, cy, cz, len, c) {
    for (let k = 1; k <= len; k++) {
      put(x, cy + k, cz, c);
      put(x, cy - k, cz, c);
      put(x, cy, cz + k, c);
      if (cz - k >= 0 || cz === 0) put(x, cy, cz - k, c);
    }
  }
  // GBU-12 ペイブウェイ II: 太い弾体、先端のシーカーと小さなカナード、大きな尾翼
  function gbu12(z, top) {
    const cy = top - 1;
    for (let x = 20; x <= 29; x++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (Math.abs(dy) + Math.abs(dz) > 1 && x !== 24 && x !== 25) continue; // 中央部だけ太い
          put(x, cy + dy, z + dz, x === 27 ? "yellow" : "store");
        }
      }
    }
    put(30, cy, z, "store");
    put(31, cy, z, "seeker");
    crossFin(30, cy, z, 1, "store"); // カナード
    crossFin(20, cy, z, 2, "store");
    crossFin(21, cy, z, 2, "store"); // 尾翼
  }
  // ミサイル（マベリック / サイドワインダー）: 細い弾体＋十字フィン
  function missile(x0, x1, cy, z, finLen, canardX) {
    for (let x = x0; x <= x1; x++)
      put(x, cy, z, x === x1 ? "seeker" : "missile");
    crossFin(x0, cy, z, finLen, "missile");
    crossFin(x0 + 1, cy, z, finLen, "missile");
    if (canardX !== undefined) crossFin(canardX, cy, z, 1, "missile");
  }
  // LAU-88 にマベリック 3 発（下に 1 発、左右に 1 発ずつ）
  function lau88(z, top) {
    for (let x = 21; x <= 28; x++) put(x, top, z, "pylon");
    for (let x = 23; x <= 26; x++) {
      put(x, top, z - 1, "pylon");
      put(x, top, z + 1, "pylon");
    }
    missile(21, 29, top - 2, z, 1);
    missile(21, 29, top, z - 2, 1);
    missile(21, 29, top, z + 2, 1);
  }
  // LAU-131 ロケットポッド: 円筒、前面に発射口
  function lau131(z, top) {
    const cy = top - 1;
    for (let x = 22; x <= 29; x++) {
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          let c = "store2";
          if (x === 29 || x === 22) c = (dy + dz) % 2 === 0 ? "bore" : "store2";
          if (x === 28 || x === 23) c = "pylon"; // 帯
          put(x, cy + dy, z + dz, c);
        }
    }
  }
  // LAU-105 2 連ランチャーに AIM-9
  function lau105(z, top) {
    for (let x = 22; x <= 28; x++)
      for (let dz = -1; dz <= 1; dz++) put(x, top, z + dz, "pylon");
    missile(22, 30, top - 1, z - 2, 1, 28);
    missile(22, 30, top - 1, z + 2, 1, 28);
  }
  pylon(2, 23, 27, 1); // 胴体下（空き）
  gbu12(6, pylon(6, 23, 27, 1)); // 内翼
  lau88(15, pylon(15, 22, 27, 1)); // 主脚ポッドの外側
  lau131(20, pylon(20, 23, 27, 1));
  lau105(23, pylon(23, 23, 27, 1)); // 翼端寄り

  // 配列化（ビューアが中心を合わせるのでそのまま）
  const voxels = [];
  for (const [x, y, z, c] of map.values()) voxels.push([x - 24, y + 3, z, c]);
  return { id: "a10", name: "A-10 Thunderbolt II", palette, voxels };
})();
