(window.VOXEL_MODELS = window.VOXEL_MODELS || {})["f15c"] = (function () {
  // USAF air-superiority "Mod Eagle" two-tone grey
  const palette = {
    body: "#a7afb7", // light grey (FS36375)
    dark: "#7e8790", // dark grey (FS36176)
    bodyLine: "#959da5", // panel lines / control-surface hinges on light grey
    darkLine: "#6f7881", // panel lines on dark grey
    radome: "#8f979e",
    canopy: "#24313d",
    canopyHi: "#3d5468",
    frame: "#4f575f",
    intake: "#16191c",
    ramp: "#5b636b",
    titan: "#8a8278", // bare-metal aft engine bay
    nozzle: "#6b645d",
    nozzleDark: "#4b4640",
    exhaust: "#1a1a1c",
    burner: "#7a6a58",
    missile: "#dcdfe2",
    seeker: "#3a4047",
    insignia: "#6a737c",
    stripe: "#2f5a8f",
    slime: "#c3df7c",
    navRed: "#d23a32",
    navGreen: "#3fae5a",
  };

  // Resolution: S voxels per metre. Geometry below is written in metres
  // measured from the nose tip (d), above the fuselage datum (y) and
  // outboard of the centreline (z).
  const S = 6;
  const NOSE_X = 58; // output x = NOSE_X - i, so +x points to the nose
  const vox = (m) => Math.round(m * S);
  const H = 0.5 / S; // half-voxel tolerance

  const cells = new Map();
  const key = (x, y, z) => x + "," + y + "," + z;
  // i = voxel index from the nose, k = voxel index outboard (mirrored to -k)
  function putRaw(i, y, k, c) {
    const x = NOSE_X - i;
    cells.set(key(x, y, k), [x, y, k, c]);
  }
  function put(i, y, k, c) {
    putRaw(i, y, k, c);
    if (k !== 0) putRaw(i, y, -k, c);
  }
  function del(i, y, k) {
    const x = NOSE_X - i;
    cells.delete(key(x, y, k));
    cells.delete(key(x, y, -k));
  }
  function get(i, y, k) {
    return cells.get(key(NOSE_X - i, y, k));
  }
  function recolor(i, y, k, c) {
    const a = get(i, y, k);
    const b = get(i, y, -k);
    if (a) a[3] = c;
    if (b) b[3] = c;
  }

  // Piecewise-linear lookup over [[d, value], ...]
  function interp(table, d) {
    if (d <= table[0][0]) return table[0][1];
    for (let n = 1; n < table.length; n++) {
      const [d1, v1] = table[n];
      if (d <= d1) {
        const [d0, v0] = table[n - 1];
        return v0 + ((v1 - v0) * (d - d0)) / (d1 - d0);
      }
    }
    return table[table.length - 1][1];
  }

  // Two-tone camouflage blobs on the upper surfaces, symmetric about z = 0.
  function camo(d, y, z) {
    if (y <= -0.6) return "body";
    const f =
      Math.sin(d * 0.81 + z * 0.66) +
      Math.sin(z * 1.35 - d * 0.39 + 1.0) +
      0.45 * Math.sin(d * 2.1 - z * 1.7 + 0.5) +
      0.3 * Math.sin(z * 2.9 + d * 1.4);
    return f > 0.85 ? "dark" : "body";
  }
  const lineOf = (c) =>
    c === "dark" ? "darkLine" : c === "body" ? "bodyLine" : c;
  const PANEL_RINGS = [7.4, 10.6, 13.0, 15.0].map(vox);

  // ---- Central fuselage: radome, cockpit section, keel between the engines ----
  const fusW = [
    [0, 0.06],
    [0.5, 0.3],
    [1, 0.45],
    [2, 0.72],
    [3, 0.92],
    [4, 1.0],
    [6, 1.05],
    [13, 1.05],
    [15.5, 1.0],
    [17.3, 0.8],
  ];
  const fusTop = [
    [0, -0.2],
    [0.5, 0.1],
    [1, 0.3],
    [2, 0.6],
    [3, 0.82],
    [4, 0.95],
    [6, 1.0],
    [13, 1.0],
    [15.5, 0.85],
    [17.3, 0.6],
  ];
  const fusBot = [
    [0, -0.28],
    [0.5, -0.55],
    [1, -0.7],
    [2, -0.92],
    [3, -1.0],
    [4, -1.05],
    [7, -1.05],
    [13, -0.95],
    [17.3, -0.75],
  ];
  for (let i = 0; i <= vox(17.3); i++) {
    const d = i / S;
    const W = interp(fusW, d) + H;
    const top = interp(fusTop, d);
    const bot = interp(fusBot, d);
    const yc = (top + bot) / 2;
    const hh = (top - bot) / 2 + H;
    for (let y = Math.floor(bot * S) - 1; y <= Math.ceil(top * S) + 1; y++) {
      for (let k = 0; k <= Math.ceil(W * S); k++) {
        const v =
          Math.pow(k / S / W, 2.6) + Math.pow(Math.abs(y / S - yc) / hh, 2.6);
        if (v > 1) continue;
        let c;
        if (i === vox(2.9))
          c = "frame"; // radome seam
        else if (d < 2.9) c = "radome";
        else if (d > 16.6) c = "titan";
        else c = camo(d, y / S, k / S);
        if (PANEL_RINGS.includes(i)) c = lineOf(c);
        put(i, y, k, c);
      }
    }
  }

  // ---- Dorsal spine running back from the canopy ----
  for (let i = vox(6.0); i <= vox(14.0); i++) {
    const t = (i / S - 6.0) / 8.0;
    const top = 1.53 - 0.5 * t;
    const W = 0.77 - 0.27 * t;
    const yc = 0.8;
    for (let y = vox(0.9); y <= Math.ceil(top * S); y++) {
      for (let k = 0; k <= Math.ceil(W * S); k++) {
        const v =
          Math.pow(k / S / (W + H), 2) +
          Math.pow((y / S - yc) / (top - yc + H), 2);
        if (v > 1) continue;
        const c = camo(i / S, y / S, k / S);
        put(i, y, k, PANEL_RINGS.includes(i) ? lineOf(c) : c);
      }
    }
  }

  // ---- Big rectangular variable-ramp intakes / engine nacelles ----
  const nacOuter = [
    [5.7, 2.35],
    [14.7, 2.35],
    [17.3, 2.0],
    [18.3, 1.85],
  ];
  const nacTop = [
    [5.7, 0.67],
    [14.7, 0.67],
    [17.3, 0.45],
    [18.3, 0.33],
  ];
  const nacBot = [
    [5.7, -1.0],
    [13.5, -1.0],
    [16.0, -0.85],
    [18.3, -0.7],
  ];
  const intakeFront = (ym) => 5.7 + (0.67 - ym) * 0.45; // raked lip: ramp juts forward
  const NAC_K = vox(2.35);
  for (let i = vox(5.7); i <= vox(18.3); i++) {
    const d = i / S;
    const outer = Math.round(interp(nacOuter, d) * S);
    const top = Math.round(interp(nacTop, d) * S);
    const bot = Math.round(interp(nacBot, d) * S);
    const inner = d < 8.0 ? vox(1.2) + 1 : vox(1.0); // boundary-layer splitter slot up front
    for (let y = bot; y <= top; y++) {
      if (d < intakeFront(y / S)) continue;
      for (let k = inner; k <= outer; k++) {
        if (k === outer && (y === bot || y === top)) continue; // rounded corners
        let c = d > 16.6 ? "titan" : camo(d, y / S, k / S);
        if (PANEL_RINGS.includes(i)) c = lineOf(c);
        put(i, y, k, c);
      }
    }
  }
  // Intake mouths: one-voxel lip, hollow duct ~1 m deep with the ramp plate inside
  {
    const top = vox(0.67);
    const bot = vox(-1.0);
    const inner = vox(1.2) + 1;
    for (let y = bot + 1; y <= top - 1; y++) {
      const f = Math.ceil(intakeFront(y / S) * S);
      for (let k = inner + 1; k <= NAC_K - 1; k++) {
        for (let n = 0; n < vox(1.0); n++) del(f + n, y, k);
        put(f + vox(1.0), y, k, "intake");
      }
    }
    // Ramp: slopes down and back from the upper lip
    for (let n = 1; n < vox(1.0); n++) {
      const y = top - 1 - Math.floor(n * 0.35);
      const f = Math.ceil(intakeFront(y / S) * S);
      for (let k = inner + 1; k <= NAC_K - 1; k++) put(f + n, y, k, "ramp");
    }
  }

  // ---- Engine bays and F100 nozzles ----
  const ENG_Z = 1.0;
  const NOZ0 = vox(17.6);
  const NOZ1 = vox(19.4);
  for (let i = vox(14.7); i <= NOZ1; i++) {
    const nozzle = i >= NOZ0;
    const r = nozzle ? 0.8 - ((i - NOZ0) / S) * 0.05 : 0.85;
    for (let y = -vox(1.0); y <= vox(1.0); y++) {
      for (let k = 0; k <= vox(2.0); k++) {
        const dz = k / S - ENG_Z;
        const dy = y / S;
        const dist = Math.hypot(dz, dy);
        if (dist > r + H) continue;
        if (!nozzle) {
          put(i, y, k, i / S > 16.6 ? "titan" : camo(i / S, dy, k / S));
        } else if (dist > r - 0.26) {
          // exposed nozzle petals, alternating shades around the ring
          const a = Math.atan2(dy, dz);
          const seg = Math.floor(((a + Math.PI) / (2 * Math.PI)) * 14);
          put(i, y, k, i === NOZ1 || seg % 2 ? "nozzleDark" : "nozzle");
        } else if (i <= NOZ0 + 1) {
          // recessed afterburner face: flame holder ring around a dark core
          put(i, y, k, dist > 0.22 && dist < 0.38 ? "burner" : "exhaust");
        } else {
          del(i, y, k);
        }
      }
    }
  }

  // ---- Tail booms outboard of the engines ----
  for (let i = vox(14.7); i <= vox(18.8); i++) {
    for (let y = -2; y <= 2; y++) {
      for (let k = vox(1.85); k <= NAC_K; k++) {
        if ((k === NAC_K || i === vox(18.8)) && Math.abs(y) === 2) continue;
        put(i, y, k, camo(i / S, y / S, k / S));
      }
    }
  }

  // ---- Clipped-delta main wing (shoulder mounted) with flaps and ailerons ----
  const wingLE = (z) => 7.7 + (z - 2.35) * 0.85;
  const wingTE = (z) => 15.15 - (z - 2.35) * 0.12;
  const wingTip = (z) => 12.15 + (6.52 - z) * 3.2; // raked clip across the tip
  const wingThick = (z) => 0.42 - (z - 2.35) * 0.06;
  const WING_Y = 0.45;
  const TIP_K = Math.floor(6.52 * S);
  for (let k = NAC_K; k <= TIP_K; k++) {
    const z = k / S;
    const le = Math.round(wingLE(z) * S);
    const te = Math.round(Math.min(wingTE(z), wingTip(z)) * S);
    const t = wingThick(z) / 2 + 0.02;
    const ys = [];
    for (let y = vox(WING_Y - t) - 1; y <= vox(WING_Y + t) + 1; y++) {
      if (Math.abs(y / S - WING_Y) <= t) ys.push(y);
    }
    if (!ys.length) ys.push(vox(WING_Y));
    const yTop = Math.max(...ys);
    const flapHinge = Math.round((wingTE(z) - 0.75) * S);
    const ailHinge = Math.round((wingTE(z) - 0.55) * S);
    for (let i = le; i <= te; i++) {
      for (const y of ys) {
        // thin the leading and trailing edges to a single voxel
        if (y !== vox(WING_Y) && (i === le || i >= te - 1)) continue;
        let c = camo(i / S, WING_Y, z);
        if (y === yTop) {
          const onFlap = z <= 4.2 && i === flapHinge;
          const onAil = z >= 4.3 && z <= 5.9 && i === ailHinge;
          const split =
            (k === vox(4.25) && i >= ailHinge) ||
            (k === vox(5.9) && i >= ailHinge);
          const spar = z < 6.0 && i === Math.round((wingLE(z) + 1.3) * S);
          const rib =
            (k === vox(3.4) || k === vox(5.0)) &&
            i > (wingLE(z) + 1.3) * S &&
            i < Math.min(flapHinge, ailHinge);
          if (onFlap || onAil || split || spar || rib) c = lineOf(c);
        }
        put(i, y, k, c);
      }
    }
  }

  // ---- Twin vertical tails with rudders, tip caps and ECM fairings ----
  const FIN_K = vox(2.0);
  const FIN_ROOT = 0.67;
  const FIN_TOP = 3.67;
  for (let y = vox(0.33); y <= vox(FIN_TOP); y++) {
    const h = Math.max(0, y / S - FIN_ROOT);
    const le = Math.round((14.0 + h * 1.15) * S);
    const te = Math.round((18.5 + h * 0.15) * S);
    const rudder = Math.round((18.5 + h * 0.15 - 0.6) * S);
    for (let i = le; i <= te; i++) {
      let c = camo(i / S, y / S + 1.3, 2.0);
      if (y === vox(FIN_TOP)) c = "frame";
      else if (h > 2.25 && h < 2.6) c = "stripe";
      else if (h > 0.2 && h < 1.9 && i === rudder) c = lineOf(c);
      put(i, y, FIN_K, c);
      if (h < 0.8 && i > le && i < te) put(i, y, FIN_K + 1, c); // thicker fin root
    }
  }
  // ECM antenna fairing at the top trailing edge of each fin
  for (let y = vox(FIN_TOP) - 3; y <= vox(FIN_TOP); y++) {
    const te = Math.round((18.5 + (y / S - FIN_ROOT) * 0.15) * S);
    for (let i = te - 2; i <= te + 1; i++) {
      for (let k = FIN_K - 1; k <= FIN_K + 1; k++) put(i, y, k, "frame");
    }
  }

  // ---- All-moving stabilators with the dog-tooth leading edge ----
  for (let k = NAC_K; k <= vox(4.33); k++) {
    const z = k / S;
    let le = 15.83 + (z - 2.33) * 1.25;
    if (z >= 2.5 && z <= 2.9) le += 0.35;
    const te = 19.5 - (z - 2.33) * 0.25;
    const pivot = Math.round(((le + te) / 2) * S);
    for (let i = Math.round(le * S); i <= Math.round(te * S); i++) {
      put(i, 0, k, camo(i / S, 0, z));
      if (z < 3.2 && i > Math.round(le * S) + 1 && i < Math.round(te * S) - 1) {
        put(
          i,
          1,
          k,
          k === NAC_K + 1 && i === pivot ? "frame" : camo(i / S, 0, z),
        );
      }
    }
  }

  // ---- Single-seat bubble canopy ----
  const CAN_D = 5.0;
  const CAN_Y = 0.8;
  for (let i = vox(2.6); i <= vox(7.3); i++) {
    const d = i / S;
    const top = interp(fusTop, d);
    for (let y = Math.floor(top * S); y <= vox(2.2); y++) {
      const ym = y / S;
      if (ym < top - 0.08) continue;
      for (let k = 0; k <= vox(0.9); k++) {
        const v =
          Math.pow((d - CAN_D) / 2.15, 2) +
          Math.pow((ym - CAN_Y) / 1.15, 2) +
          Math.pow(k / S / 0.75, 2);
        if (v > 1) continue;
        let c = "canopy";
        if (Math.abs(d - 3.55) < 0.1)
          c = "frame"; // windscreen bow
        else if (ym < top + 0.1)
          c = "frame"; // canopy sill
        else if (ym > 1.7 && d > 4.0 && d < 5.6 && (i + y) % 5 < 2)
          c = "canopyHi"; // glint
        put(i, y, k, c);
      }
    }
  }

  // ---- Surface details painted onto the outer skin ----
  function topY(i, k) {
    for (let y = vox(4); y >= -vox(2); y--) if (get(i, y, k)) return y;
    return null;
  }
  function paintTop(i, k, c) {
    const y = topY(i, k);
    if (y !== null)
      recolor(i, y, k, typeof c === "function" ? c(get(i, y, k)[3]) : c);
  }
  function paintSide(i, y, c, maxK) {
    for (let k = maxK; k >= 0; k--) {
      if (get(i, y, k)) return recolor(i, y, k, c);
    }
  }

  // Speed brake outline on the spine behind the canopy
  {
    const i0 = vox(7.6),
      i1 = vox(10.4),
      kMax = vox(0.62);
    for (let i = i0; i <= i1; i++) {
      for (let k = 0; k <= kMax; k++) {
        if (i === i0 || i === i1 || k === kMax) paintTop(i, k, lineOf);
      }
    }
  }

  // Low-visibility star-and-bar on each intake side
  {
    const star = [
      ".....#.....",
      ".....#.....",
      ".#########.",
      "..#######..",
      "#####.#####",
      "...##.##...",
      "..##...##..",
    ];
    const i0 = vox(9.2);
    const y0 = vox(0.35);
    star.forEach((row, r) => {
      for (let c = 0; c < row.length; c++) {
        if (row[c] === "#") paintSide(i0 + c - 5, y0 - r, "insignia", NAC_K);
      }
    });
  }

  // Formation ("slime") light strips below the cockpit
  for (let y = -1; y <= 1; y++) paintSide(vox(2.4), y, "slime", vox(1.2));

  // Pitot / AoA probes ahead of the cockpit
  {
    const i = vox(2.4);
    const y = vox(0.25);
    let k = 0;
    while (get(i, y, k + 1)) k++;
    put(i, y, k + 1, "frame");
    put(i, y, k + 2, "frame");
  }

  // Blade antennas: IFF on the spine, UHF under the nose
  {
    const i = vox(11.6);
    const y = topY(i, 0);
    for (let n = 1; n <= 3; n++)
      for (let j = 0; j < 3 - (n === 3 ? 1 : 0); j++)
        put(i + j + (n - 1), y + n, 0, "frame");
    const ib = vox(4.5);
    for (let n = 1; n <= 2; n++)
      for (let j = 0; j < 2; j++)
        put(ib + j + (n - 1), vox(-1.05) - n, 0, "frame");
  }

  // Navigation lights on the clipped tips: red to port (-z), green to starboard (+z)
  {
    const z = TIP_K / S;
    const i = Math.round(wingLE(z) * S);
    for (let n = 0; n <= 1; n++) {
      putRaw(i + n, vox(WING_Y), -TIP_K, "navRed");
      putRaw(i + n, vox(WING_Y), TIP_K, "navGreen");
    }
  }

  // ---- Weapons: AIM-9s on the wing pylons, AIM-7s on the fuselage corners ----
  function missile(d0, len, y, k, finSpan, midFins) {
    const i0 = vox(d0);
    const i1 = vox(d0 + len);
    for (let i = i0; i <= i1; i++)
      put(i, y, k, i === i0 ? "seeker" : "missile");
    const fin = (i, span) => {
      for (let s = 1; s <= span; s++) {
        for (const [dy, dk] of [
          [s, 0],
          [-s, 0],
          [0, s],
          [0, -s],
        ]) {
          if (k + dk < 1 || get(i, y + dy, k + dk)) continue;
          put(i, y + dy, k + dk, "missile");
        }
      }
    };
    fin(i1, finSpan);
    fin(i1 - 1, finSpan);
    if (midFins) {
      fin(i0 + midFins, finSpan);
      fin(i0 + midFins + 1, finSpan);
    } else {
      fin(i0 + 2, 1); // canards
    }
  }
  // Wing pylon with a launch rail on each side
  {
    const k = vox(3.4);
    for (let i = vox(10.2); i <= vox(12.8); i++) {
      for (let y = -1; y <= 1; y++) put(i, y, k, "body");
      put(i, -1, k - 1, "frame");
      put(i, -1, k + 1, "frame");
    }
    missile(9.6, 2.9, -1, k - 3, 2, 0);
    missile(9.6, 2.9, -1, k + 3, 2, 0);
  }
  // Two Sparrows in tandem under each intake corner
  missile(6.6, 3.66, vox(-1.0) - 1, vox(2.1), 2, vox(1.3));
  missile(10.9, 3.66, vox(-1.0) - 1, vox(2.1), 2, vox(1.3));

  // ---- Hollow out voxels that are fully enclosed (never visible) ----
  const solid = Array.from(cells.values());
  const N6 = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ];
  const voxels = solid.filter(([x, y, z]) =>
    N6.some(([a, b, c]) => !cells.has(key(x + a, y + b, z + c))),
  );

  return { id: "f15c", name: "F-15C Eagle", palette, voxels };
})();
