(window.VOXEL_MODELS = window.VOXEL_MODELS || {})["f35c"] = (function () {
  // F-35C Lightning II（艦載型）。高精細版: 1m = 6 ボクセル（全長 15.7m → 約 94、翼幅 13.1m → 約 79）。
  // 形はメートル単位で定義し、ボクセル中心をメートルへ換算して内外判定する。
  // 最後に外から見えない内部のボクセルを取り除き、外殻だけを残す。
  const S = 6;
  const palette = {
    body: "#7e858c", // ステルスグレー
    belly: "#858c93", // 下面（わずかに明るい）
    edge: "#686e75", // 前縁などのエッジ処理
    line: "#6f767d", // パネルライン・動翼の分割線
    canopy: "#5a4a20", // 金色がかったキャノピー
    canopyHi: "#8a7432", // キャノピー上面の反射
    frame: "#4b5056", // キャノピー枠
    duct: "#3a3f45", // インテーク内壁
    intake: "#16191c", // インテーク奥
    nozzle: "#6d6862", // 排気ノズル外側
    petal: "#56524e", // ノズルの鋸歯状フラップ
    exhaust: "#2a2422", // ノズル奥
    turbine: "#423a35", // ノズル最奥
    sensor: "#3a3322", // EOTS・DAS の窓
    insignia: "#646b72", // ロービジの国籍標識・テールコード
    accent: "#2c3a58", // 米海軍らしい濃紺（尾翼端）
    gold: "#a8893e", // 尾翼の細いゴールドライン
    slime: "#9fb88a", // 編隊灯（スライムライト）
    hook: "#d8d8d2", // 着艦フック（白）
    hookDark: "#2a2a2a", // 着艦フック（黒帯）
  };

  const map = new Map();
  const key = (x, y, z) => x + "," + y + "," + z;
  // 1 個だけ置く（左右で色を変えたい標識用）
  function putOne(x, y, z, c) {
    map.set(key(x, y, z), [x, y, z, c]);
  }
  // z >= 0 側だけ書けば左右対称に置かれる
  function put(x, y, z, c) {
    putOne(x, y, z, c);
    putOne(x, y, -z, c);
  }
  function del(x, y, z) {
    map.delete(key(x, y, z));
    map.delete(key(x, y, -z));
  }
  const has = (x, y, z) => map.has(key(x, y, z));
  const colorAt = (x, y, z) => (map.get(key(x, y, z)) || [])[3];
  // 既にあるボクセルの色だけ変える
  function paintOne(x, y, z, c) {
    const v = map.get(key(x, y, z));
    if (v) v[3] = c;
  }
  function paint(x, y, z, c) {
    paintOne(x, y, z, c);
    paintOne(x, y, -z, c);
  }

  const M = (v) => v / S; // ボクセル → メートル
  const V = (m) => Math.round(m * S); // メートル → ボクセル
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp01 = (t) => Math.max(0, Math.min(1, t));
  const smooth = (t) => {
    t = clamp01(t);
    return t * t * (3 - 2 * t);
  };
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
  // 表 [[x, 値...], ...]（x 降順）を x で線形補間する
  function profile(table, x) {
    if (x >= table[0][0]) return table[0].slice(1);
    for (let i = 1; i < table.length; i++) {
      const [x0, ...a] = table[i - 1];
      const [x1, ...b] = table[i];
      if (x >= x1) {
        const t = (x0 - x) / (x0 - x1);
        return a.map((v, k) => lerp(v, b[k], t));
      }
    }
    return table[table.length - 1].slice(1);
  }
  // 列の一番上・一番下、行の一番外側にあるボクセルを探して塗る
  function topY(x, z) {
    for (let y = 40; y >= -6; y--) if (has(x, y, z)) return y;
    return null;
  }
  function botY(x, z) {
    for (let y = -6; y <= 40; y++) if (has(x, y, z)) return y;
    return null;
  }
  function sideZ(x, y) {
    for (let z = 45; z >= 0; z--) if (has(x, y, z)) return z;
    return null;
  }
  function paintTop(x, z, c) {
    const y = topY(x, z);
    if (y !== null) paint(x, y, z, c);
  }
  function paintBot(x, z, c) {
    const y = botY(x, z);
    if (y !== null) paint(x, y, z, c);
  }
  function paintTopOne(x, z, c) {
    const y = topY(x, z);
    if (y !== null) paintOne(x, y, z, c);
  }
  function paintBotOne(x, z, c) {
    const y = botY(x, z);
    if (y !== null) paintOne(x, y, z, c);
  }
  function paintSide(x, y, c) {
    const z = sideZ(x, y);
    if (z !== null) paint(x, y, z, c);
  }
  // 下面に長方形の枠線を引く（メートル指定）。saw なら前後の辺を鋸歯状にする。
  function rectBot(x0, x1, z0, z1, c, saw) {
    for (let x = V(x0); x <= V(x1); x++) {
      for (let z = V(z0); z <= V(z1); z++) {
        const off = saw ? (z >> 1) % 2 : 0;
        if (x < V(x0) + off || x > V(x1) - off) continue;
        if (
          x === V(x0) + off ||
          x === V(x1) - off ||
          z === V(z0) ||
          z === V(z1)
        )
          paintBot(x, z, c);
      }
    }
  }
  function rectTop(x0, x1, z0, z1, c, one) {
    for (let x = V(x0); x <= V(x1); x++)
      for (let z = V(z0); z <= V(z1); z++) {
        if (x === V(x0) || x === V(x1) || z === V(z0) || z === V(z1))
          (one ? paintTopOne : paintTop)(x, z, c);
      }
  }

  // x は尾端 0 〜 機首 15.7m。
  const LEN = 15.7;

  // ===== 胴体 =====
  // 断面は平らな下面、鋭いチャイン（稜線）、丸い上面。 [x, 半幅 W, 下面 yb, チャイン yc, 上面 yt]（m）
  const fus = [
    [15.7, 0.05, 1.22, 1.3, 1.38],
    [15.2, 0.38, 1.0, 1.27, 1.58],
    [14.5, 0.68, 0.78, 1.22, 1.8],
    [13.5, 0.98, 0.58, 1.18, 2.02],
    [12.6, 1.18, 0.48, 1.18, 2.12],
    [11.0, 1.47, 0.4, 1.2, 2.23],
    [10.0, 1.67, 0.33, 1.27, 2.3],
    [8.7, 2.2, 0.33, 1.33, 2.33],
    [4.7, 2.2, 0.33, 1.33, 2.33],
    [2.7, 1.93, 0.43, 1.33, 2.2],
    [1.3, 1.3, 0.62, 1.27, 1.9],
    [1.0, 1.05, 0.7, 1.25, 1.78],
  ];
  const fusAt = (xm) => profile(fus, xm);
  for (let x = V(1.0); x <= V(LEN); x++) {
    const [W, yb, yc, yt] = fusAt(M(x));
    for (let z = 0; z <= V(W) + 1; z++) {
      const u = M(z) / (W + 0.4 / S);
      if (u > 1) continue;
      const top = yc + (yt - yc) * Math.sqrt(Math.max(0, 1 - Math.pow(u, 2.5)));
      const bot = yb + (yc - yb) * Math.pow(u, 4);
      for (let y = V(bot); y <= V(top); y++)
        put(x, y, z, M(y) < yc - 0.08 ? "belly" : "body");
    }
  }

  // 背部のふくらみ（キャノピー後方から尾部へなだらかに下がる）
  for (let x = V(4.6); x <= V(9.6); x++) {
    const xm = M(x);
    const h = 0.5 * smooth((xm - 4.6) / 4.2);
    const [, , , yt] = fusAt(xm);
    for (let z = 0; z <= V(1.25); z++) {
      const r = M(z) / 1.25;
      if (r > 1) continue;
      const top = yt + h * Math.sqrt(1 - r * r);
      for (let y = V(yt) - 1; y <= V(top); y++) put(x, y, z, "body");
    }
  }

  // ===== 一体型キャノピー =====
  const canopySet = new Set();
  const CPEAK = 10.35,
    CREAR = 9.2,
    CFRONT = 12.75;
  for (let x = V(CREAR); x <= V(CFRONT); x++) {
    const xm = M(x);
    const hc =
      xm >= CPEAK
        ? 0.9 * (1 - ((xm - CPEAK) / 2.45) ** 2)
        : 0.9 * (1 - ((CPEAK - xm) / 1.45) ** 2);
    if (hc <= 0.05) continue;
    const [, , , yt] = fusAt(xm);
    const a = 0.45 + 0.4 * (hc / 0.9);
    for (let y = V(yt) - 1; y <= V(yt + hc); y++) {
      for (let z = 0; z <= V(a) + 1; z++) {
        const dz = M(z) / a,
          dy = (M(y) - yt) / hc;
        if (dz * dz + Math.max(0, dy) ** 2 > 1) continue;
        put(x, y, z, "canopy");
        canopySet.add(key(x, y, z));
      }
    }
  }
  // 枠（下縁・前後端）、後方の細いボウ、上面の反射
  for (const k of canopySet) {
    const [x, y, z] = k.split(",").map(Number);
    const rim = !canopySet.has(key(x, y - 1, z));
    if (rim || x === V(CREAR) || x === V(CFRONT) || x === V(9.75))
      paint(x, y, z, "frame");
    else if (z <= 1 && x >= V(10.2) && x <= V(11.4) && y === topY(x, z))
      paint(x, y, z, "canopyHi");
  }

  // ===== DSI インテーク =====
  // 胴体側面の箱。外壁は下側ほど内側へ寄せ、前縁は上・内側ほど前に出るキャレット形にする。
  const lipX = (ym, zm) => 10.45 - 0.22 * (2.0 - ym) - 0.25 * (zm - 1.5);
  const zOut = (ym) => lerp(2.12, 2.38, clamp01((ym - 0.55) / 1.2));
  for (let x = V(6.0); x <= V(10.6); x++) {
    const xm = M(x);
    const [W] = fusAt(xm);
    const yTop = lerp(1.6, 2.02, smooth((xm - 6.0) / 1.5));
    for (let y = V(0.55); y <= V(yTop); y++) {
      const ym = M(y);
      for (let z = V(Math.max(0.9, W - 0.3)); z <= V(zOut(ym)); z++) {
        if (xm > lipX(ym, M(z))) continue;
        if (y === V(yTop) && z === V(zOut(ym))) continue; // 角を丸める
        put(x, y, z, ym < 1.2 ? "belly" : "body");
      }
    }
  }
  // 吸気口をくり抜く（奥行き 1.1m）。穴に面したボクセルを内壁色、奥を黒に。
  const holes = [];
  for (let x = V(9.0); x <= V(10.6); x++) {
    for (let y = V(0.75); y <= V(1.85); y++) {
      for (let z = V(1.62); z <= V(zOut(M(y)) - 0.17); z++) {
        if (M(x) > lipX(M(y), M(z)) - 1.1) {
          del(x, y, z);
          holes.push([x, y, z]);
        }
      }
    }
  }
  // 壁が 1 枚だけで外にも面している場合は外側の色を保つ
  for (const [x, y, z] of holes) {
    for (const [dx, dy, dz] of [
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ]) {
      if (
        !has(x + dx, y + dy, z + dz) ||
        !has(x + 2 * dx, y + 2 * dy, z + 2 * dz)
      )
        continue;
      paint(x + dx, y + dy, z + dz, dx === -1 ? "intake" : "duct");
    }
  }
  // 吸気口の縁
  for (let y = V(0.6); y <= V(2.02); y++) {
    for (let z = V(1.62); z <= V(2.4); z++) {
      for (let x = V(10.6); x >= V(9.0); x--) {
        if (!has(x, y, z)) continue;
        const c = colorAt(x, y, z);
        if (c !== "duct" && c !== "intake") paint(x, y, z, "edge");
        break;
      }
    }
  }
  // ダイバーターレスのコブ（吸気口の内側前方の膨らみ）
  for (let x = V(9.8); x <= V(11.2); x++) {
    for (let y = V(0.75); y <= V(1.95); y++) {
      for (let z = V(1.0); z <= V(2.0); z++) {
        const dx = (M(x) - 10.45) / 0.65,
          dy = (M(y) - 1.35) / 0.55,
          dz = (M(z) - 1.45) / 0.45;
        if (dx * dx + dy * dy + dz * dz <= 1 && !has(x, y, z))
          put(x, y, z, M(y) < 1.2 ? "belly" : "body");
      }
    }
  }

  // ===== 主翼（C 型の大きな翼。前縁後退約 33°、後縁は前進角、広い翼端）=====
  const ROOT_Z = 1.9,
    TIP_Z = 6.55;
  const wing = [
    [9.45, ROOT_Z],
    [6.33, TIP_Z],
    [3.87, TIP_Z],
    [2.6, ROOT_Z],
  ];
  const WY = 1.33; // 翼の基準面の高さ
  const wingInfo = new Map(); // 'x,z' → 翼弦方向の位置 0（前縁）〜 1（後縁）
  function wingChord(zm) {
    const t = clamp01((zm - ROOT_Z) / (TIP_Z - ROOT_Z));
    return [lerp(9.45, 6.33, t), lerp(2.6, 3.87, t)]; // [前縁 x, 後縁 x]
  }
  for (let x = V(2.4); x <= V(9.6); x++) {
    for (let z = V(1.6); z <= V(TIP_Z); z++) {
      const xm = M(x) + 0.5 / S,
        zm = M(z);
      if (!inPoly(xm, zm, wing)) continue;
      const [le, te] = wingChord(zm);
      const c = le - te,
        xc = clamp01((le - xm) / c);
      wingInfo.set(x + "," + z, xc);
      const t = (0.042 * c * (Math.sqrt(xc) * (1 - xc))) / 0.385; // 翼厚の半分
      const yLo = Math.min(V(WY - t * 0.6), V(WY)),
        yHi = Math.max(V(WY), V(WY + t));
      for (let y = yLo; y <= yHi; y++)
        put(x, y, z, y < V(WY) ? "belly" : "body");
    }
  }
  // 前縁・翼端のエッジ、動翼の分割線、主翼折りたたみ線
  const FOLD = 4.4;
  const zTip = Math.max(...[...wingInfo.keys()].map((k) => +k.split(",")[1]));
  for (const [k, xc] of wingInfo) {
    const [x, z] = k.split(",").map(Number);
    if (!wingInfo.has(x + 1 + "," + z) || z === zTip) {
      for (let y = V(WY) - 2; y <= V(WY) + 3; y++)
        if (has(x, y, z)) paint(x, y, z, "edge");
      continue;
    }
    if (M(z) < 2.3) continue; // 胴体に埋まる部分
    const prev = wingInfo.get(x + 1 + "," + z);
    const cross = (f) => prev < f && xc >= f;
    let line = cross(0.16) || cross(0.74); // 前縁フラップ / フラッペロン・補助翼
    if (xc >= 0.74 && (z === V(FOLD) || z === V(2.4))) line = true; // 動翼の端
    if (z === V(FOLD)) line = true; // 折りたたみ線
    if (line) {
      paintTop(x, z, "line");
      paintBot(x, z, "line");
    }
  }

  // ===== 水平尾翼（尾部ブームに付く全遊動式）=====
  const stab = [
    [2.95, 1.6],
    [1.33, 4.15],
    [0.45, 4.15],
    [-0.05, 1.6],
  ];
  const SY = 1.27;
  for (let x = V(-0.1); x <= V(3.0); x++) {
    for (let z = V(1.4); z <= V(4.2); z++) {
      const xm = M(x) + 0.5 / S,
        zm = M(z);
      if (!inPoly(xm, zm, stab)) continue;
      const front =
        !inPoly(xm + 1 / S, zm, stab) || !inPoly(xm, zm + 1 / S, stab);
      const thick =
        zm < 2.6 &&
        inPoly(xm + 2 / S, zm, stab) &&
        inPoly(xm - 2 / S, zm, stab);
      put(x, V(SY), z, front ? "edge" : "body");
      if (thick) put(x, V(SY) + 1, z, "body");
    }
  }
  // 尾部ブーム（水平尾翼の付け根を支える細い張り出し）
  for (let x = V(0.1); x <= V(3.2); x++) {
    for (let y = V(0.95); y <= V(1.6); y++) {
      for (let z = V(1.3); z <= V(1.8); z++) {
        const dy = (M(y) - 1.27) / 0.3,
          dz = (M(z) - 1.55) / 0.25;
        if (dy * dy + dz * dz <= 1 && !has(x, y, z))
          put(x, y, z, M(y) < 1.27 ? "belly" : "body");
      }
    }
  }

  // ===== 外側へ約 20° 傾いた双垂直尾翼 =====
  const finSet = new Set();
  const FIN_ROOT_Y = 1.67,
    FIN_TOP_Y = 4.05,
    FIN_Z = 1.62,
    CANT = Math.tan((20 * Math.PI) / 180);
  let prevZ = null;
  for (let y = V(FIN_ROOT_Y); y <= V(FIN_TOP_Y); y++) {
    const h = (M(y) - FIN_ROOT_Y) / (FIN_TOP_Y - FIN_ROOT_Y);
    const le = V(lerp(5.15, 3.05, h));
    const te = V(lerp(0.95, 1.95, h));
    const z = V(FIN_Z + (M(y) - FIN_ROOT_Y) * CANT);
    const rudder = V(lerp(1.85, 2.4, h)); // 方向舵のヒンジ線
    for (let x = te; x <= le; x++) {
      let c = "body";
      if (x === le) c = "edge";
      else if (x === rudder && h < 0.85) c = "line";
      // 傾きで z がずれる段は、すき間ができないよう前の z にも置く
      for (const zz of prevZ !== null && prevZ !== z ? [z, prevZ] : [z]) {
        put(x, y, zz, c);
        finSet.add(x + "," + y + "," + zz);
      }
    }
    prevZ = z;
  }
  // 尾翼端の濃紺と細いゴールドライン
  for (const k of finSet) {
    const [x, y, z] = k.split(",").map(Number);
    const top = V(FIN_TOP_Y);
    if (y >= top - 1) paint(x, y, z, "accent");
    else if (y === top - 2) paint(x, y, z, "gold");
  }
  // テールコード "NG"（左右どちらの外側から見ても正しく読める向きに）
  const glyphs = {
    N: ["1001", "1101", "1011", "1001", "1001"],
    G: ["0111", "1000", "1011", "1001", "0111"],
  };
  const text = "NG";
  const TX0 = V(2.35),
    TY0 = V(2.5); // 右の尾翼から見て、文字列の左下
  const textW = text.length * 5 - 1;
  for (let i = 0; i < text.length; i++) {
    glyphs[text[i]].forEach((row, r) => {
      for (let c = 0; c < 4; c++) {
        if (row[c] !== "1") continue;
        const col = i * 5 + c,
          y = TY0 + 4 - r;
        const xr = TX0 + col; // 右の尾翼（+z 側から見る）
        const xl = TX0 + textW - 1 - col; // 左の尾翼（-z 側から見る）は x を反転
        for (let z = 0; z <= 30; z++) {
          if (finSet.has(xr + "," + y + "," + z))
            paintOne(xr, y, z, "insignia");
          if (finSet.has(xl + "," + y + "," + z))
            paintOne(xl, y, -z, "insignia");
        }
      }
    });
  }

  // ===== 単発の丸い排気ノズル（鋸歯状の縁）=====
  const NY = 1.25;
  for (let x = V(0.2); x <= V(1.35); x++) {
    const xm = M(x);
    const R = lerp(0.6, 0.66, clamp01((xm - 0.2) / 1.0));
    for (let y = V(NY - R) - 1; y <= V(NY + R) + 1; y++) {
      for (let z = 0; z <= V(R) + 1; z++) {
        const dy = M(y) - NY,
          dz = M(z);
        const r = Math.hypot(dy, dz);
        if (r > R) continue;
        // 周方向 12 枚のフラップ。交互に長さを変えて鋸歯にする。
        const petal = Math.floor(
          ((Math.atan2(dy, dz) + Math.PI) / (2 * Math.PI)) * 12,
        );
        if (xm < (petal % 2 === 0 ? 0.2 : 0.4)) continue;
        const inner = r < R - 0.16;
        if (inner && xm < 0.95) continue; // 開口部
        let c = xm < 0.6 && petal % 2 === 0 ? "petal" : "nozzle";
        if (inner) c = r < 0.18 ? "turbine" : "exhaust";
        put(x, y, z, c);
      }
    }
  }

  // ===== センサー類 =====
  // 機首下の EOTS（ファセット状の窓）
  for (let x = V(13.1); x <= V(13.9); x++) {
    for (let y = V(0.3); y <= V(0.75); y++) {
      for (let z = 0; z <= V(0.3); z++) {
        const dx = (M(x) - 13.5) / 0.42,
          dy = (M(y) - 0.62) / 0.3,
          dz = M(z) / 0.3;
        if (dx * dx + dy * dy + dz * dz <= 1 && !has(x, y, z))
          put(x, y, z, "sensor");
      }
    }
  }
  // DAS の窓（キャノピー前方の上面、キャノピー後方、機首の左右下、後部下面）
  for (let z = 0; z <= 1; z++) {
    paintTop(V(13.05), z, "sensor");
    paintTop(V(13.05) + 1, z, "sensor");
  }
  for (let z = 0; z <= 1; z++) paintTop(V(8.95), z, "sensor");
  for (let x = V(12.4); x <= V(12.6); x++) paintSide(x, V(0.8), "sensor");
  for (let x = V(6.6); x <= V(6.8); x++) paintBot(x, 0, "sensor");

  // ===== パネルライン =====
  // レドームの継ぎ目（その断面の外周）
  {
    const x = V(13.9);
    for (let y = 0; y <= 20; y++)
      for (let z = 0; z <= 12; z++) {
        if (!has(x, y, z)) continue;
        if (!(has(x, y + 1, z) && has(x, y - 1, z) && has(x, y, z + 1)))
          paint(x, y, z, "line");
      }
  }
  // 背部の点検パネル
  rectTop(5.6, 7.2, 0.35, 1.05, "line");
  rectTop(3.0, 4.3, 0.3, 0.95, "line");
  rectTop(7.6, 8.6, 0.0, 0.7, "line");
  // 空中給油プローブの扉（機首右側の上面、片側のみ）
  rectTop(11.1, 12.2, 0.75, 1.15, "line", true);
  // 下面: 左右の兵装庫扉（前後端は鋸歯状）、主脚扉、前脚扉、フック収納部
  rectBot(4.1, 8.3, 0.3, 1.3, "line", true);
  for (let x = V(4.1); x <= V(8.3); x++) paintBot(x, V(0.8), "line");
  rectBot(6.0, 7.6, 1.5, 2.1, "line", true);
  rectBot(11.2, 12.9, 0, 0.3, "line", true);
  rectBot(1.7, 3.2, 0, 0.2, "line", false);

  // ===== 編隊灯（スライムライト、機首側面のチャイン沿い）=====
  for (let x = V(11.2); x <= V(11.9); x++) paintSide(x, V(1.2), "slime");

  // ===== 国籍標識（ロービジ）=====
  // 円・星・左右の帯を輪郭だけで描くドット絵。上の行が機首側。実機どおり「左翼の上面」と「右翼の下面」に描く。
  const roundelArt = [
    ".......#####.......",
    ".....##.....##.....",
    "....#....#....#....",
    "#####...###...#####",
    "#...#.#######.#...#",
    "#####..#####..#####",
    "....#..##.##..#....",
    ".....##.....##.....",
    ".......#####.......",
  ];
  const RX = V(5.3),
    RZ = V(4.85);
  roundelArt.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      if (row[c] !== "#") continue;
      const x = RX + 4 - r,
        z = RZ + c - 9;
      paintTopOne(x, -z, "insignia");
      paintBotOne(x, z, "insignia");
    }
  });

  // ===== アンテナ（背部と腹部の小さなブレード）=====
  for (let x = V(6.2); x <= V(6.2) + 2; x++) {
    putOne(x, topY(x, 0) + 1, 0, "edge");
    putOne(x, botY(x, 0) - 1, 0, "edge");
  }
  putOne(V(6.2) + 1, topY(V(6.2) + 1, 0) + 1, 0, "edge");

  // ===== 着艦フック（少し下ろした状態、白黒の帯）=====
  const hx0 = V(3.1),
    hy0 = V(0.55),
    hx1 = V(1.15),
    hy1 = V(0.0);
  for (let i = 0; i <= hx0 - hx1; i++) {
    const x = hx0 - i,
      y = Math.round(lerp(hy0, hy1, i / (hx0 - hx1)));
    putOne(x, y, 0, Math.floor(i / 2) % 2 === 0 ? "hook" : "hookDark");
  }
  putOne(hx1, hy1 - 1, 0, "hookDark");
  putOne(hx1 + 1, hy1 - 1, 0, "hookDark");

  // ===== 外から見えない内部を取り除く =====
  const dirs = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ];
  const hidden = [];
  for (const [x, y, z] of map.values()) {
    if (dirs.every(([dx, dy, dz]) => has(x + dx, y + dy, z + dz)))
      hidden.push(key(x, y, z));
  }
  hidden.forEach((k) => map.delete(k));

  // 中心へ寄せて配列化
  const voxels = [];
  const CX = V(LEN / 2);
  for (const [x, y, z, c] of map.values()) voxels.push([x - CX, y, z, c]);
  return {
    id: "f35c",
    name: "F-35C Lightning II",
    voxelsPerMeter: S,
    palette,
    voxels,
  };
})();
