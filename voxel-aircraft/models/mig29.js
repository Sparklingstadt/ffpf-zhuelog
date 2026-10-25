(window.VOXEL_MODELS = window.VOXEL_MODELS || {})["mig29"] = (function () {
  // MiG-29 Fulcrum。1m = 3 ボクセル（全長 17.3m → 約 52 ボクセル、翼幅 11.4m → 約 34 ボクセル）。
  // ロシア空軍風のグレー／グリーングレー 2 トーン迷彩、下面は明るいグレー。
  // 主翼下に R-27 ×1・R-73 ×2（片側）、エンジン間にセンタータンクを搭載。
  const palette = {
    body: "#a3aca7", // 迷彩のグレー
    camo: "#74846d", // 迷彩のグリーングレー
    bodyD: "#8a938e", // 動翼（グレー部分）
    camoD: "#5f6e59", // 動翼（グリーングレー部分）
    belly: "#c4ccd0", // 下面
    dark: "#4d5552", // ピトー管・アンテナ・リップ
    louver: "#3a413e", // LERX 上面の補助インテーク
    canopy: "#2a3a4a", // キャノピーのガラス
    canopyHi: "#4d6a82", // ガラスの映り込み
    frame: "#59615d", // キャノピー枠
    irst: "#101a22", // IRST 球
    radome: "#d2d6cf", // レドーム
    intake: "#16191b", // 空気取り入れ口の奥
    nozzle: "#4b4743", // 排気ノズル外側
    petal: "#5f5953", // ノズルのペタル
    exhaust: "#a8683a", // ノズル奥（焼けた金属）
    tailcap: "#3a403d", // 垂直尾翼の先端
    star: "#c8102e", // 赤い星・機番
    white: "#f2f2ee", // 星の縁取り
    missile: "#e4e6e1", // ミサイル
    seeker: "#2b2f33", // シーカー
    pylon: "#7d8681", // パイロン
  };

  const map = new Map();
  const key = (x, y, z) => x + "," + y + "," + z;
  // z >= 0 側だけ書けば左右対称に置かれる
  function put(x, y, z, c) {
    map.set(key(x, y, z), [x, y, z, c]);
    map.set(key(x, y, -z), [x, y, -z, c]);
  }
  // 片側だけ色を塗り替える（機番の文字向きを左右で合わせるため）
  function paint(x, y, z, c) {
    const k = key(x, y, z);
    if (map.has(k)) map.set(k, [x, y, z, c]);
  }
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp01 = (t) => Math.max(0, Math.min(1, t));
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
  // 上面・側面の 2 トーン迷彩（なめらかなまだら模様）
  function skin(x, y, z) {
    const f =
      Math.sin(x * 0.42 + 0.9 * Math.sin(z * 0.45 + y * 0.3)) *
        Math.cos(z * 0.5 + y * 0.25 + 0.8 * Math.sin(x * 0.27)) +
      0.3 * Math.sin((x - z) * 0.23 + 1);
    return f > 0.12 ? "camo" : "body";
  }
  // 動翼は同じ迷彩を一段濃く
  const skinD = (x, y, z) => (skin(x, y, z) === "camo" ? "camoD" : "bodyD");

  // x は尾端 -3 〜 機首 50（ピトー管 52）で作り、最後に中心へずらす。
  const NOSE = 50;

  // --- 前部胴体（コクピット〜レドーム）。楕円断面で、機首に向かって少し垂れ下がる。
  function fwd(x) {
    if (x < 30) return { a: 2.4, b: 2.6, cy: 5.6 };
    if (x <= 40) return { a: 2.3, b: 2.5, cy: 6 };
    const t = (x - 40) / (NOSE + 0.7 - 40);
    const s = Math.sqrt(Math.max(0, 1 - Math.pow(t, 2.2)));
    return { a: 2.3 * s, b: 2.5 * s, cy: 6 - 1.3 * Math.pow(t, 1.3) };
  }
  for (let x = 22; x <= NOSE; x++) {
    const { a, b, cy } = fwd(x);
    for (let y = 1; y <= 10; y++) {
      for (let z = 0; z <= 4; z++) {
        const dz = z / (a + 0.4),
          dy = (y - cy) / (b + 0.4);
        if (dz * dz + dy * dy > 1) continue;
        let c = y < cy - 0.6 ? "belly" : skin(x, y, z);
        if (x >= 45) c = "radome";
        put(x, y, z, c);
      }
    }
  }
  // ピトー管と AoA ベーン
  put(NOSE + 1, 5, 0, "dark");
  put(NOSE + 2, 5, 0, "dark");
  put(43, 6, 3, "dark");
  // 機首下の腹部アンテナ
  put(38, 3, 0, "dark");

  // --- 単座のバブルキャノピー
  const canopyTop = {
    34: 9.8,
    35: 10.3,
    36: 10.6,
    37: 10.7,
    38: 10.6,
    39: 10.3,
    40: 9.8,
    41: 9.1,
  };
  for (let x = 34; x <= 41; x++) {
    const top = canopyTop[x];
    for (let y = 8; y <= Math.round(top); y++) {
      for (let z = 0; z <= 2; z++) {
        const dz = z / 1.9,
          dy = (y - 8) / (top - 8 + 0.5);
        if (dz * dz + dy * dy * 0.7 > 1) continue;
        let c = "canopy";
        if (x === 40 || x === 34)
          c = "frame"; // 風防枠・後端枠
        else if (y === 8 && z === 2)
          c = "frame"; // 縁
        else if (z === 0 && y >= 10 && x >= 36 && x <= 38) c = "canopyHi";
        put(x, y, z, c);
      }
    }
  }
  // 風防の前にある IRST 球
  put(42, 9, 0, "irst");

  // --- 背部の盛り上がり（キャノピー後方からエンジン間へなだらかに下がる）
  for (let x = 14; x <= 33; x++) {
    const top = Math.round(lerp(7.4, 9.6, (x - 14) / 19));
    for (let y = 7; y <= top; y++) {
      for (let z = 0; z <= 1; z++) {
        if (z === 1 && y === top && top >= 9) continue;
        put(x, y, z, skin(x, y, z));
      }
    }
  }
  // 背部のブレードアンテナ
  put(26, 10, 0, "dark");
  put(25, 10, 0, "dark");
  put(19, 9, 0, "dark");

  // --- エンジン間の平らな胴体上面（デッキ）
  for (let x = 2; x <= 30; x++) {
    for (let z = 0; z <= 7; z++) {
      let y0, y1;
      if (z <= 2) {
        y0 = 4;
        y1 = x <= 6 ? 6 : 7;
      } else if (z <= 6) {
        y0 = 5;
        y1 = 6;
      } else {
        if (x < 10 || x > 28) continue;
        y0 = 5;
        y1 = 5;
      }
      for (let y = y0; y <= y1; y++)
        put(x, y, z, y === y0 && z <= 2 ? "belly" : skin(x, y, z));
    }
  }
  // 後端のスピードブレーキ／ドラッグシュート収納部（エンジンの間から後ろへ突き出す）
  for (let x = -3; x <= 1; x++) {
    for (let z = 0; z <= 1; z++) {
      if (x === -3 && z === 1) continue;
      put(x, 4, z, x === -3 ? "dark" : "belly");
      put(x, 5, z, x === -3 ? "dark" : skin(x, 5, z));
    }
  }
  put(2, 7, 0, skin(2, 7, 0)); // 収納部前端のふくらみ
  put(3, 7, 0, skin(3, 7, 0));

  // --- 大きく張り出した LERX（コクピット横から主翼前縁へ）
  // 上面は胴体側が高く、外側へ向かってなだらかに下がる（コブラフード状）。
  for (let x = 27; x <= 44; x++) {
    const zl = 2 + 5.6 * Math.pow(clamp01((44 - x) / 16), 0.8);
    const base = x >= 36 ? 5 : 6;
    for (let z = 0; z <= Math.floor(zl + 0.3); z++) {
      const rise =
        z <= 2
          ? 1
          : Math.round(1.2 * clamp01(1 - (z - 2) / Math.max(1, zl - 2)));
      const top = base + rise;
      for (let y = 5; y <= top; y++)
        put(x, y, z, y === top ? skin(x, y, z) : "belly");
    }
  }
  // LERX 上面の補助インテーク（ルーバー）
  for (const x of [30, 32, 34])
    for (let z = 3; z <= 5; z++) {
      const k = key(x, 7, z);
      const y = map.has(k) ? 7 : 6;
      put(x, y, z, "louver");
    }

  // --- 斜めにカットされたインテーク → 離れた 2 基のエンジンナセル → ノズル
  // ナセルは z = 3..6（中心 4.5）、y = 0..4。
  const xf = (y) => 30 + 0.75 * y; // インテーク前縁（上唇が前に出る）
  for (let x = -1; x <= 34; x++) {
    for (let y = 0; y <= 4; y++) {
      for (let z = 3; z <= 6; z++) {
        const edgeZ = z === 3 || z === 6,
          edgeY = y === 0 || y === 4;
        let c = y <= 1 ? "belly" : skin(x, y, z);
        if (x >= 26) {
          // インテーク: 箱型断面、前面は斜め
          if (x > xf(y)) continue;
          const inner = !edgeZ && !edgeY;
          if (inner && x > xf(y) - 2) continue; // 口の中は空洞
          if (inner) c = "intake";
          else if (x > xf(y) - 1) c = "dark"; // リップ
        } else if (x >= 8) {
          // ナセル中央部: 角の丸い箱
          if (edgeZ && edgeY && x < 22) continue;
          if (x === 14 && y >= 2) c = "dark"; // エンジンアクセスパネルの継ぎ目
        } else {
          // 後部: 円に近い断面へ絞る
          if (y === 0) continue;
          if (edgeZ && (y === 1 || y === 4)) continue;
          if (x <= 2) {
            const inner = !edgeZ && (y === 2 || y === 3);
            if (inner && x === -1) continue; // ノズルの奥は窪ませる
            if (inner) c = "exhaust";
            else c = (y + z + x) % 2 ? "nozzle" : "petal";
          }
        }
        put(x, y, z, c);
      }
    }
  }

  // --- テールブーム（ナセルの外側。水平尾翼と垂直尾翼を支える）
  for (let x = 0; x <= 15; x++) {
    put(x, 3, 7, x <= 8 ? "belly" : skin(x, 3, 7));
    put(x, 4, 7, skin(x, 4, 7));
  }

  // --- 中程度の後退角の主翼（前縁約 42°）。後縁側 2 列はフラップ／エルロン。
  const wing = [
    [28, 6.5],
    [17.5, 17.6],
    [13, 17.6],
    [11.5, 6.5],
  ];
  const wingTE = (z) => lerp(11.5, 13, (z - 6.5) / 11.1);
  for (let x = 10; x <= 29; x++) {
    for (let z = 6; z <= 18; z++) {
      if (!inPoly(x + 0.5, z, wing)) continue;
      const ctrl = z >= 8 && z <= 16 && x <= wingTE(z) + 2;
      put(x, 5, z, ctrl ? skinD(x, 5, z) : skin(x, 5, z));
      if (z >= 8 && z <= 11) put(x, 4, z, "belly");
    }
  }
  // 翼端の RWR フェアリング
  for (let x = 11; x <= 19; x++)
    put(x, 5, 18, x === 11 || x === 19 ? "dark" : skin(x, 5, 18));

  // --- 全遊動式の水平尾翼
  const stab = [
    [9.5, 7.5],
    [4, 12.6],
    [0.5, 12.6],
    [-0.5, 7.5],
  ];
  for (let x = -1; x <= 10; x++) {
    for (let z = 8; z <= 13; z++) {
      if (!inPoly(x + 0.5, z, stab)) continue;
      put(x, 3, z, skin(x, 3, z));
    }
  }

  // --- 双垂直尾翼（テールブームの上、少し外側に傾く）と白縁の赤い星
  const star = ["..R..", "RRRRR", ".RRR.", ".R.R.", "R...R"]; // 上の行が y = 11、左の列が x = 4
  const isStar = (x, y) => {
    const row = star[11 - y],
      col = x - 4;
    return !!row && col >= 0 && col < 5 && row[col] === "R";
  };
  const finLE = (y) => lerp(13.5, 5.5, (y - 5) / 8);
  const finTE = (y) => lerp(1, 3, (y - 5) / 8);
  for (let y = 5; y <= 13; y++) {
    const z = y <= 11 ? 7 : 8;
    for (let x = Math.ceil(finTE(y)); x <= Math.floor(finLE(y)); x++) {
      let c =
        x <= Math.ceil(finTE(y)) + 1 && y >= 6 ? skinD(x, y, z) : skin(x, y, z); // ラダー
      if (y === 13) c = "tailcap";
      else if (x === Math.floor(finLE(y)) && y >= 9) c = "dark"; // 前縁のアンテナ
      if (isStar(x, y)) c = "star";
      else if (
        isStar(x + 1, y) ||
        isStar(x - 1, y) ||
        isStar(x, y + 1) ||
        isStar(x, y - 1)
      )
        c = "white";
      put(x, y, z, c);
    }
  }
  // 垂直尾翼前縁の付け根（ドーサルフィレット）
  for (let x = 14; x <= 17; x++) put(x, 5, 7, skin(x, 5, 7));
  for (let x = 14; x <= 15; x++) put(x, 6, 7, skin(x, 6, 7));
  // ブーム下のベントラルフィン
  for (let x = 5; x <= 9; x++) put(x, 2, 7, "belly");
  for (let x = 6; x <= 8; x++) put(x, 1, 7, "belly");

  // --- 兵装
  // ミサイル: x0（尾部）〜 x1（シーカー）。fins は十字翼を付ける x の一覧。
  function missile(x0, x1, y, z, fins, pylon) {
    for (let x = pylon[0]; x <= pylon[1]; x++) put(x, y + 1, z, "pylon");
    for (let x = x0; x <= x1; x++)
      put(x, y, z, x === x1 ? "seeker" : "missile");
    for (const fx of fins) {
      put(fx, y - 1, z, "missile");
      if (fx < pylon[0] || fx > pylon[1]) put(fx, y + 1, z, "missile");
      put(fx, y, z - 1, "missile");
      put(fx, y, z + 1, "missile");
    }
  }
  missile(15, 27, 2, 9, [15, 16, 23], [17, 22]); // R-27（内側）
  missile(13, 22, 3, 12, [13, 21], [15, 19]); // R-73（中央）
  missile(12, 20, 3, 15, [12, 19], [14, 17]); // R-73（外側）

  // エンジン間のセンタータンク
  for (let x = 6; x <= 24; x++) {
    const end = x <= 7 || x >= 23;
    for (let y = 1; y <= 3; y++) {
      for (let z = 0; z <= 1; z++) {
        if (z === 1 && (y !== 2 || end)) continue;
        if (end && y !== 2) continue;
        put(x, y, z, x === 24 ? "pylon" : "belly");
      }
    }
  }

  // --- インテーク側面の機番「07」（左右どちらから見ても正しく読めるように塗る）
  const digits = {
    0: ["111", "101", "101", "101", "111"],
    7: ["111", "001", "001", "010", "010"],
  };
  const text = "07";
  for (let i = 0; i < text.length; i++) {
    const g = digits[text[i]];
    for (let r = 0; r < 5; r++) {
      for (let cc = 0; cc < 3; cc++) {
        if (g[r][cc] !== "1") continue;
        const col = i * 4 + cc; // 0..6
        const y = 4 - r;
        paint(23 + col, y, 6, "star"); // 右側（+z）は機首が右
        paint(29 - col, y, -6, "star"); // 左側（-z）は機首が左
      }
    }
  }

  // 中心へ寄せて配列化
  const voxels = [];
  for (const [x, y, z, c] of map.values()) voxels.push([x - 25, y + 1, z, c]);
  return { id: "mig29", name: "MiG-29 Fulcrum", palette, voxels };
})();
