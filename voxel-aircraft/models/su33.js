// Su-33 Flanker-D — 1 m = 3 voxels. +x = nose, +y = up, +z = starboard.
(window.VOXEL_MODELS = window.VOXEL_MODELS || {})["su33"] = (function () {
  const palette = {
    body: "#8fa1b3", // light blue-grey (Russian Navy)
    dark: "#5f7387", // darker blue-grey camouflage
    belly: "#a8b7c5",
    radome: "#6c7b89",
    canopy: "#2a3a4a",
    frame: "#4a5966",
    irst: "#3a3124",
    intake: "#1b2127",
    nozzle: "#53575d",
    exhaust: "#26292d",
    red: "#c62828",
    white: "#e6eaee",
    stripe: "#1e1e1e",
    bodyLine: "#7d8fa1", // panel / hinge lines on each base tone
    darkLine: "#52667a",
    bellyLine: "#92a2b1",
    nozzleDark: "#3b3f44",
    burner: "#7a4526",
    missile: "#dde2e6",
    seeker: "#39414a",
  };

  const S = 3; // voxels per metre
  const NOSE_X = 32; // x of the radome tip; d (metres from nose) = (NOSE_X - x) / S
  const LENGTH = 21.2;

  const map = new Map();
  const key = (x, y, z) => x + "," + y + "," + z;
  const parts = new Map(); // key -> structural part, used for panel lines
  const put = (x, y, z, c, part) => {
    map.set(key(x, y, z), [x, y, z, c]);
    if (part) parts.set(key(x, y, z), part);
  };
  const del = (x, y, z) => map.delete(key(x, y, z));
  const get = (x, y, z) => map.get(key(x, y, z));

  // Piecewise-linear lookup in [[t, v], ...]
  function lerpTable(table, t) {
    if (t <= table[0][0]) return table[0][1];
    for (let i = 1; i < table.length; i++) {
      if (t <= table[i][0]) {
        const [t0, v0] = table[i - 1];
        const [t1, v1] = table[i];
        return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
      }
    }
    return table[table.length - 1][1];
  }
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const thin = 0.5 / S + 1e-6; // half-thickness that hits exactly one voxel layer

  // ---- Fuselage: elliptical sections, separate top / bottom half-heights ----
  const BODY_W = [
    [0, 0],
    [0.5, 0.33],
    [1.5, 0.58],
    [3.0, 0.76],
    [4.5, 0.84],
    [6.5, 0.9],
    [8.5, 1.0],
    [11, 1.15],
    [14.5, 1.1],
    [16.5, 0.75],
    [18, 0.55],
    [21.2, 0.36],
  ];
  const BODY_HT = [
    [0, 0],
    [0.5, 0.33],
    [1.5, 0.58],
    [3.0, 0.74],
    [4.5, 0.8],
    [6.5, 0.88],
    [8.5, 0.92],
    [11, 0.85],
    [14.5, 0.7],
    [16.5, 0.55],
    [18, 0.48],
    [21.2, 0.34],
  ];
  const BODY_HB = [
    [0, 0],
    [0.5, 0.33],
    [1.5, 0.58],
    [3.0, 0.76],
    [4.5, 0.84],
    [6.5, 0.9],
    [8.5, 0.8],
    [11, 0.6],
    [14.5, 0.55],
    [16.5, 0.5],
    [18, 0.45],
    [21.2, 0.3],
  ];
  const BODY_YC = [
    [0, -0.28],
    [1.5, -0.15],
    [3.0, -0.05],
    [4.5, 0],
    [21.2, 0.05],
  ];
  function inBody(d, Y, Z) {
    if (d < 0 || d > LENGTH) return false;
    const w = lerpTable(BODY_W, d);
    if (w <= 0) return false;
    const dy = Y - lerpTable(BODY_YC, d);
    const h = dy >= 0 ? lerpTable(BODY_HT, d) : lerpTable(BODY_HB, d);
    return (Z / w) ** 2 + (dy / h) ** 2 <= 1;
  }

  // Dorsal spine behind the canopy
  const SPINE_H = [
    [6.5, 0.95],
    [8, 1.12],
    [11, 1.0],
    [14, 0.8],
    [16, 0.6],
  ];
  function inSpine(d, Y, Z) {
    if (d < 6.5 || d > 16 || Y < 0) return false;
    return (Z / 0.55) ** 2 + (Y / lerpTable(SPINE_H, d)) ** 2 <= 1;
  }

  // Bubble canopy
  function inCanopy(d, Y, Z) {
    return (
      ((d - 5.5) / 1.6) ** 2 + ((Y - 0.75) / 0.62) ** 2 + (Z / 0.42) ** 2 <=
        1 && Y > 0.5
    );
  }

  // ---- Engine nacelles (widely spaced, intakes under the LERX) ----
  function nacelleFront(Y) {
    return 7.6 + (0.35 * (-0.1 - Y)) / 1.6; // raked lip: upper lip further forward
  }
  function nacelleParams(d) {
    if (d <= 15) {
      return {
        zc: 1.4,
        yc: -0.9,
        a: 0.75,
        b: 0.8,
        n: 5 - 2.5 * clamp01((d - 10) / 5),
      };
    }
    const t = clamp01((d - 15) / 4.6);
    return {
      zc: 1.4 - 0.05 * t,
      yc: -0.9 + 0.2 * t,
      a: 0.75 - 0.22 * t,
      b: 0.8 - 0.27 * t,
      n: 2.5 - 0.5 * t,
    };
  }
  const NOZZLE_END = 19.6;
  function inNacelle(d, Y, Z) {
    const az = Math.abs(Z);
    if (d > NOZZLE_END || d < nacelleFront(Y)) return false;
    const p = nacelleParams(d);
    return (
      Math.abs(az - p.zc) / p.a <= 1 &&
      (Math.abs(az - p.zc) / p.a) ** p.n + (Math.abs(Y - p.yc) / p.b) ** p.n <=
        1
    );
  }

  // ---- LERX + main wing (single layer at the fuselage mid-plane) ----
  const LERX_S = [
    [5.0, 0.6],
    [6, 1.0],
    [7, 1.3],
    [8, 1.6],
    [9, 1.9],
    [10.5, 2.3],
  ];
  const WING_TIP = 7.1;
  const wingTE = (az) => 16.4 + Math.max(0, az - 2.3) * 0.06;
  function inWingPlan(d, az) {
    if (d < 5.0 || az > WING_TIP) return false;
    if (d <= 10.5) return az <= lerpTable(LERX_S, d);
    return az <= 2.3 + (d - 10.5) * 1.01 && d <= wingTE(az);
  }

  // Canards on the LERX leading edge
  function inCanardPlan(d, az) {
    if (az < 0.9 || az > 3.2) return false;
    const le = 6.4 + ((az - 0.9) * 2.2) / 2.3;
    const te = 8.3 + ((az - 0.9) * 0.9) / 2.3;
    return d >= le && d <= te;
  }

  // ---- Tail: booms, twin fins, tailplanes, ventral fins, stinger ----
  const BOOM_Z = 7; // voxel column of the tail booms / fins
  const finLE = (Y) => 15.4 + (Y - 0.15) * (3.0 / 3.6);
  const FIN_TE = 19.7;
  const FIN_TOP = 3.75;
  function inStabPlan(d, az) {
    if (az < 2.45 || az > 4.95) return false;
    const le = 17.5 + ((az - 2.45) * 2.4) / 2.5;
    const te = 20.4 + ((az - 2.45) * 0.5) / 2.5;
    return d >= le && d <= te;
  }

  // Disruptive two-tone camouflage on the upper surfaces (symmetric in z)
  function camo(x, y, z) {
    const az = Math.abs(z);
    const u = x + 2.2 * Math.sin(az * 0.33 + y * 0.4);
    const w = az + 2.0 * Math.sin(x * 0.27);
    const v =
      Math.sin(u * 0.36 + 0.4) * Math.sin(w * 0.42 + 1.1) +
      0.35 * Math.sin((u + w) * 0.21);
    return v > 0.32;
  }

  // ---- Rasterize the continuous shapes ----
  for (let x = -34; x <= 34; x++) {
    const d = (NOSE_X - x) / S;
    for (let y = -7; y <= 13; y++) {
      const Y = y / S;
      for (let z = -24; z <= 24; z++) {
        const Z = z / S;
        const az = Math.abs(Z);
        let c = null;
        let part = null;

        if (inCanopy(d, Y, Z)) {
          c = Math.abs(d - 4.4) < 0.17 || d > 6.85 ? "frame" : "canopy";
        } else if (inBody(d, Y, Z) || inSpine(d, Y, Z)) {
          c = d < 2.8 ? "radome" : "paint";
          part = "body";
        } else if (inNacelle(d, Y, Z)) {
          c = d >= 18.6 ? "nozzle" : "paint";
          part = "nacelle";
        } else if (Math.abs(Y) <= thin && inCanardPlan(d, az)) {
          c = "dark";
        } else if (Math.abs(Y) <= thin && inWingPlan(d, az)) {
          c = "paint";
          part = "wing";
        } else if (
          Math.abs(Y + 1 / S) <= thin &&
          az <= 3.4 &&
          inWingPlan(d, az)
        ) {
          c = "paint"; // thicker wing root, underside
          part = "wingUnder";
        } else if (Math.abs(z) === BOOM_Z) {
          if (d >= 13.5 && d <= 20.6 && Y >= -0.75 && Y <= 0.05) {
            c = "paint";
            part = "body";
          } else if (Y > 0.05 && Y <= FIN_TOP && d >= finLE(Y) && d <= FIN_TE) {
            c = Y > 3.45 ? "dark" : "paint";
            part = "fin";
          } else if (
            Y < -0.75 &&
            Y >= -1.7 &&
            d >= 16.0 + (-0.75 - Y) * 0.8 &&
            d <= 17.6
          ) {
            c = Y < -1.5 ? "dark" : "paint"; // ventral fin, dielectric tip
          }
        } else if (Math.abs(Y + 1 / S) <= thin && inStabPlan(d, az)) {
          c = "paint";
          part = "stab";
        }

        if (c) put(x, y, z, c, part);
      }
    }
  }

  // Wingtip launch rails
  for (
    let x = Math.round(NOSE_X - 16.8 * S);
    x <= Math.round(NOSE_X - 13.6 * S);
    x++
  ) {
    put(x, 0, 22, "dark");
    put(x, 0, -22, "dark");
  }

  // Intake mouths: 2-voxel recess with a dark compressor face behind
  for (const [, v] of [...map]) {
    const [x, y, z] = v;
    const d = (NOSE_X - x) / S;
    const Y = y / S;
    const az = Math.abs(z / S);
    const front = nacelleFront(Y);
    if (d > front + 1.1) continue;
    const p = nacelleParams(d);
    if (Math.abs(az - p.zc) < p.a - 0.3 && Math.abs(Y - p.yc) < p.b - 0.3) {
      if (d < front + 0.7) del(x, y, z);
      else put(x, y, z, "intake");
    }
  }

  // Nozzles: alternating petals, hollow exit with a warm afterburner face inside
  {
    const nozzleAt = (x, y, z) => {
      const p = nacelleParams((NOSE_X - x) / S);
      const dz = Math.abs(z / S) - p.zc;
      const dy = y / S - p.yc;
      return { p, r: Math.hypot(dz, dy), ang: Math.atan2(dy, dz) };
    };
    const hollow = [];
    for (const [, v] of map) {
      const [x, y, z, c] = v;
      if (c !== "nozzle") continue;
      const { p, r, ang } = nozzleAt(x, y, z);
      if (!get(x - 1, y, z) && r < p.a - 0.2) hollow.push([x, y, z]);
      else
        v[3] =
          Math.floor(((ang + Math.PI) / (2 * Math.PI)) * 8) % 2
            ? "nozzleDark"
            : "nozzle";
    }
    for (const [x, y, z] of hollow) {
      del(x, y, z);
      if (get(x + 1, y, z)) put(x + 1, y, z, "burner");
    }
  }

  // Pitot tube on the radome tip, dark tail-cone cap
  put(NOSE_X, -1, 0, "nozzle");
  put(NOSE_X + 1, -1, 0, "nozzle");
  for (const [, v] of [...map]) {
    const [x, y, z] = v;
    if ((NOSE_X - x) / S > 20.6 && Math.abs(z) <= 1) put(x, y, z, "dark");
  }

  // IRST ball, offset to starboard ahead of the windscreen
  for (const x of [21, 22]) put(x, 3, 1, "irst");

  // Retracted refuelling probe fairing, port side ahead of the windscreen
  for (let x = 19; x <= 22; x++) put(x, 2, -2, "paint");
  put(23, 2, -2, "nozzle");

  // GSh-30-1 cannon in the starboard LERX root
  for (let x = 8; x <= 11; x++) put(x, 1, 3, "paint");
  put(12, 1, 3, "intake");

  // Arrestor hook, lowered under the stinger
  {
    const x0 = Math.round(NOSE_X - 17.2 * S);
    const x1 = Math.round(NOSE_X - 19.6 * S);
    for (let x = x0, i = 0; x >= x1; x--, i++) {
      const t = (x0 - x) / (x0 - x1);
      const y = Math.round(-1 - t * 2.5);
      put(x, y, 0, i % 2 === 0 ? "white" : "stripe");
    }
  }

  // Paint: belly light, upper surfaces in two-tone camouflage
  for (const [k, v] of map) {
    if (v[3] !== "paint") continue;
    const [x, y, z] = v;
    if (y <= -2 || parts.get(k) === "wingUnder") v[3] = "belly";
    else v[3] = camo(x, y, z) ? "dark" : "body";
  }

  // Panel and hinge lines: a slightly darker shade of whatever tone is underneath
  {
    const LINE = { body: "bodyLine", dark: "darkLine", belly: "bellyLine" };
    const RINGS = [7.6, 10.4, 13.2, 16.0].map((d) =>
      Math.round(NOSE_X - d * S),
    );
    const near = (d, target) => d >= target && d < target + 1 / S;
    for (const [k, v] of map) {
      if (!LINE[v[3]]) continue;
      const [x, y, z] = v;
      const d = (NOSE_X - x) / S;
      const az = Math.abs(z / S);
      const part = parts.get(k);
      let line = false;
      if (part === "body" || part === "nacelle") {
        line = RINGS.includes(x);
      } else if (part === "wing" || part === "wingUnder") {
        const le = 10.5 + (az - 2.3) / 1.01;
        line =
          (az > 2.4 && near(d, wingTE(az) - 0.9)) || // flaperon / flap hinge
          (az > 3.0 && near(d, le + 0.5)) || // leading-edge slat
          Math.abs(z) === 13; // wing fold
      } else if (part === "fin") {
        line = near(d, FIN_TE - 1.0) && y >= 2 && y <= 10; // rudder hinge
      } else if (part === "stab") {
        line = Math.abs(z) === 8; // stabilator pivot
      }
      if (line) v[3] = LINE[v[3]];
    }
  }

  // Red stars on both fins and on the wings
  const STAR = [
    "...#...",
    "..###..",
    "#######",
    ".#####.",
    "..###..",
    ".##.##.",
    ".#...#.",
  ];
  // Fins: star in the x-y plane, top point up
  for (let r = 0; r < 7; r++) {
    for (let col = 0; col < 7; col++) {
      if (STAR[r][col] !== "#") continue;
      const x = -20 - col; // columns run nose -> tail
      const y = 8 - r;
      for (const z of [BOOM_Z, -BOOM_Z]) if (get(x, y, z)) put(x, y, z, "red");
    }
  }
  // Wings: star in the x-z plane, top point toward the nose
  for (let r = 0; r < 7; r++) {
    for (let col = 0; col < 7; col++) {
      if (STAR[r][col] !== "#") continue;
      const x = -10 - r;
      const z = 13 + col;
      for (const zz of [z, -z]) if (get(x, 0, zz)) put(x, 0, zz, "red");
    }
  }

  // Red bort number on both intake sides (reads left-to-right from either side)
  {
    const FONT = {
      8: ["###", "#.#", "###", "#.#", "###"],
      4: ["#.#", "#.#", "###", "..#", "..#"],
    };
    const text = "84";
    for (let r = 0; r < 5; r++) {
      for (let k = 0; k < text.length * 4 - 1; k++) {
        const ch = FONT[text[Math.floor(k / 4)]];
        if (k % 4 === 3 || ch[r][k % 4] !== "#") continue;
        const y = -1 - r;
        for (const side of [1, -1]) {
          const x = side > 0 ? 1 + k : 7 - k; // starboard: nose on the right; port: nose on the left
          for (let az = 8; az >= 0; az--) {
            const v = get(x, y, side * az);
            if (!v) continue;
            if (parts.get(key(x, y, side * az)) === "nacelle") v[3] = "red";
            break;
          }
        }
      }
    }
  }

  // ---- Stores: R-73 on the wingtips and outer pylons, R-27 on the inner and intake pylons ----
  function missile(z, y, xNose, len, bigWings) {
    for (let i = 0; i < len; i++)
      put(xNose - i, y, z, i === 0 ? "seeker" : "missile");
    const xt = xNose - len + 1;
    for (const x of [xt, xt + 1]) {
      put(x, y - 1, z, "missile");
      put(x, y, z - 1, "missile");
      put(x, y, z + 1, "missile");
    }
    const xc = bigWings ? xNose - 4 : xNose - 1; // R-27 mid wings / R-73 canards
    put(xc, y - 1, z, "missile");
    put(xc, y, z - 1, "missile");
    put(xc, y, z + 1, "missile");
  }
  function pylon(z, y, xFront, xBack) {
    for (let x = xFront; x >= xBack; x--) put(x, y, z, "dark");
  }
  for (const side of [1, -1]) {
    // Wingtip R-73 under the launch rail
    for (let x = -8; x >= -16; x--)
      put(x, -1, side * 22, x === -8 ? "seeker" : "missile");
    for (const x of [-15, -16]) put(x, -2, side * 22, "missile");
    put(-9, -2, side * 22, "missile");
    // Outer wing pylon: R-73
    pylon(side * 17, -1, -10, -15);
    missile(side * 17, -2, -8, 9, false);
    // Inner wing pylon: R-27
    pylon(side * 11, -1, -6, -13);
    missile(side * 11, -2, -3, 13, true);
    // Under-intake pylon: R-27
    pylon(side * 4, -6, 2, -5);
    missile(side * 4, -7, 5, 13, true);
  }

  const voxels = [...map.values()];
  return { id: "su33", name: "Su-33 Flanker-D", palette, voxels };
})();
