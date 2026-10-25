(window.VOXEL_MODELS = window.VOXEL_MODELS || {})["f14"] = (function () {
  // F-14 Tomcat。1m = 3 ボクセル（全長 19.1m → 約 57 ボクセル）。
  // 可変後退翼は中間的な後退角（約 40°）で展開した状態。
  const palette = {
    body: "#8d949c", // 制空グレー（上面）
    light: "#aab0b6", // 下面の明るいグレー
    dark: "#5b6168", // 防眩パネル・ウォークウェイなど
    canopy: "#2a3a4a", // キャノピーのガラス
    frame: "#474d54", // キャノピー枠
    radome: "#c9c3b2", // レドーム（オフホワイト）
    intake: "#1c2024", // 空気取り入れ口の奥
    nozzle: "#4a4440", // 排気ノズル外側
    exhaust: "#b0703a", // ノズル奥（焼けた金属）
    tailcap: "#2b2e33", // 垂直尾翼の先端
    accent: "#c0392b", // 垂直尾翼の帯
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

  // x は尾端 -2 〜 機首 55 で作り、最後に中心へずらす。
  const NOSE = 55;

  // --- 前部胴体（機首〜コクピット）。楕円断面。
  for (let x = 30; x <= NOSE; x++) {
    let a = 3.6,
      b = 3.3,
      cy = 4.3;
    if (x > 43) {
      const t = (x - 43) / (NOSE + 0.6 - 43);
      const s = Math.sqrt(Math.max(0, 1 - t * t * t));
      a = 3.6 * s;
      b = 3.3 * s;
      cy = lerp(4.3, 4.6, t);
    }
    for (let y = 0; y <= 9; y++) {
      for (let z = 0; z <= 4; z++) {
        const dz = z / (a + 0.35),
          dy = (y - cy) / (b + 0.35);
        if (dz * dz + dy * dy > 1) continue;
        let c = y < cy - 0.5 ? "light" : "body";
        if (x >= 49) c = "radome";
        else if (x >= 44 && y >= cy + 1.5 && z <= 2) c = "dark"; // 防眩パネル
        put(x, y, z, c);
      }
    }
  }
  // 機首下の TCS ポッド
  for (let x = 45; x <= 47; x++) {
    put(x, 0, 0, "dark");
    put(x, 1, 0, "dark");
  }

  // --- タンデム複座キャノピーと背部の盛り上がり
  for (let x = 26; x <= 44; x++) {
    let top;
    if (x >= 33) top = 7.6 + 2.6 * Math.sin(((x - 32.5) / 12) * Math.PI);
    else top = lerp(7.4, 9.1, (x - 26) / 7);
    const w = x >= 33 ? lerp(2.4, 1.4, clamp01((x - 40) / 4)) : 2.6;
    for (let y = 7; y <= Math.round(top); y++) {
      for (let z = 0; z <= 2; z++) {
        const dz = z / (w + 0.3),
          dy = (y - 7) / (top - 7 + 0.4);
        if (dz * dz + dy * dy * 0.6 > 1) continue;
        let c = "body";
        if (x >= 33) c = x === 38 || x === 33 ? "frame" : "canopy";
        put(x, y, z, c);
      }
    }
  }

  // --- 胴体中央部（ナセルの間の平らな「パンケーキ」）
  for (let x = 4; x <= 31; x++) {
    const halfW = x < 10 ? lerp(5, 8, (x - 4) / 6) : 8;
    for (let y = 3; y <= 7; y++) {
      for (let z = 0; z <= halfW; z++) {
        if (z > 3 && y < 6) continue; // ナセル側はナセル自体で作る
        if (y === 7 && x < 8) continue;
        put(x, y, z, y <= 3 ? "light" : "body");
      }
    }
  }
  // 中央のウォークウェイ
  for (let x = 14; x <= 30; x++) put(x, 7, 0, "dark");

  // --- 空気取り入れ口（箱型）→ エンジンナセル → ノズル
  const NZ = 6.5,
    NY = 3.5;
  for (let x = 0; x <= 39; x++) {
    let a, b, n;
    if (x >= 28) {
      a = 2.2;
      b = 3.6;
      n = 8;
    } // 箱型インテーク
    else if (x >= 18) {
      // 箱 → 円 へ遷移
      const t = (x - 18) / 10;
      a = lerp(3.0, 2.2, t);
      b = lerp(3.0, 3.6, t);
      n = lerp(2, 8, t);
    } else if (x >= 4) {
      a = 3.0;
      b = 3.0;
      n = 2;
    } // 円形ナセル
    else {
      a = lerp(2.3, 2.7, x / 4);
      b = a;
      n = 2;
    } // ノズル
    // インテーク前縁は上側が前に出る傾斜
    for (let y = -1; y <= 8; y++) {
      if (x >= 28 && x > 35 + y * 0.5) continue;
      for (let z = 3; z <= 10; z++) {
        const v =
          Math.pow(Math.abs(z - NZ) / (a + 0.3), n) +
          Math.pow(Math.abs(y - NY) / (b + 0.3), n);
        if (v > 1) continue;
        let c = y < NY - 0.5 ? "light" : "body";
        if (x <= 3) c = "nozzle";
        put(x, y, z, c);
      }
    }
  }
  // インテークの口を掘る（外周 1 ボクセルを残して 3 ボクセル奥まで空洞、奥は暗色）
  for (let y = 1; y <= 6; y++) {
    const lip = Math.floor(35 + y * 0.5);
    for (let z = 5; z <= 8; z++) {
      for (let x = lip - 2; x <= lip; x++) del(x, y, z);
      put(lip - 3, y, z, "intake");
    }
  }
  // ノズルの中を掘る
  for (let y = 0; y <= 7; y++) {
    for (let z = 3; z <= 10; z++) {
      const r = Math.hypot(z - NZ, y - NY);
      if (r < 1.7) {
        del(0, y, z);
        del(1, y, z);
        put(2, y, z, "exhaust");
      }
    }
  }

  // --- ビーバーテール（ノズル間の平たい尾部）
  for (let x = -1; x <= 4; x++) {
    const w = x < 1 ? 2 : 3;
    for (let z = 0; z <= w; z++) {
      put(x, 4, z, "body");
      if (x >= 1) put(x, 5, z, "body");
    }
  }

  // --- 主翼付け根のグローブ（鋭い後退角の固定部）
  const glove = [
    [41, 3],
    [26.5, 12.6],
    [18.5, 12.6],
    [16, 9],
    [16, 0],
    [41, 0],
  ];
  for (let x = 16; x <= 41; x++) {
    for (let z = 3; z <= 13; z++) {
      if (!inPoly(x + 0.5, z, glove)) continue;
      put(x, 6, z, "body");
      // 前縁側は薄く
      const le = 41 - ((z - 3) * (41 - 26.5)) / (12.6 - 3);
      if (x < le - 1.5) put(x, 7, z, "body");
    }
  }

  // --- 可変後退翼（中間後退角で展開）
  const SWEEP = Math.tan((40 * Math.PI) / 180);
  const Z0 = 9,
    ZT = 26,
    ROOT_LE = 26.5,
    ROOT_TE = 16,
    TIP_CH = 4.2;
  for (let z = Z0; z <= ZT; z++) {
    const t = (z - Z0) / (ZT - Z0);
    const le = ROOT_LE - (z - Z0) * SWEEP;
    const te = lerp(ROOT_TE, ROOT_LE - (ZT - Z0) * SWEEP - TIP_CH, t);
    for (let x = Math.ceil(te); x <= Math.floor(le); x++) {
      put(x, 6, z, "body");
      const f = (le - x) / (le - te);
      if (z <= 17 && f > 0.15 && f < 0.7) put(x, 7, z, "body"); // 根元側の厚み
    }
  }

  // --- 全遊動式水平尾翼
  const stab = [
    [11, 9.2],
    [2.5, 15.6],
    [-0.5, 15.6],
    [-2.2, 13],
    [-1, 9.2],
  ];
  for (let x = -3; x <= 11; x++) {
    for (let z = 9; z <= 16; z++) {
      if (!inPoly(x + 0.5, z, stab)) continue;
      put(x, 4, z, "body");
      if (z <= 10) put(x, 3, z, "light");
    }
  }

  // --- 双垂直尾翼（間隔が広く、わずかに外側へ傾斜）
  for (let y = 7; y <= 14; y++) {
    const h = (y - 7) / 7;
    const le = lerp(17, 6.5, h);
    const te = lerp(2.5, 1, h);
    const z = Math.round(5.6 + h * 1.2);
    for (let x = Math.ceil(te); x <= Math.floor(le); x++) {
      let c = "body";
      if (y === 14) c = "tailcap";
      else if (y === 11 || y === 12) c = "accent";
      put(x, y, z, c);
    }
  }
  // ナセル下のベントラルフィン
  for (let y = -2; y <= 0; y++) {
    for (let x = 4 + (0 - y); x <= 10 - (0 - y) * 2; x++) put(x, y, 8, "light");
  }

  // 中心へ寄せて配列化
  const voxels = [];
  for (const [x, y, z, c] of map.values()) voxels.push([x - 27, y + 2, z, c]);
  return { id: "f14", name: "F-14 Tomcat", palette, voxels };
})();
