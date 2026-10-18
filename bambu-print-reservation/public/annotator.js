// ============================================================
// MeshAnnotator — 浏览器端 3D 工况标注查看器 v2.1（2026-10-13 支撑交互修批）
//
// v2.1 曼波反馈三连修：
//   ① Shift 同特征并选只红染命中面本身，不再把各自的平滑片拖成淡蓝底；
//   ② 种子平滑洪波加 60° 法线锥（口径同受压区 ±64°）——孔壁/圆角不再爬圈成
//      大片浅蓝；
//   ③ 同工具点击染色区内【任意面】= 取消标注（原只认种子三角，点区内无反应）；
//   ④ 新增重做：Ctrl+Y / Ctrl+Shift+Z / 列表「↪ 重做」，新操作截断重做分支。
// 悬空需支撑保留独立语义（悬垂检出 + 同特征并选）。
// v2.0 曼波定（「接触面的面识别有问题，受压区是好的，面逻辑统一以受压区为准」）：
//   受压区/接触面/外观面统一走**法向轴向连通洪波**（predAxis：与种子面法线
//   平行 ±64° 内、边邻接连通）——原接触/外观的「平滑连通片」洪波会沿曲面
//   渐变爬出种子法向，识别结果不可预期；coplane_region 分支与 predCoplanar
//   死代码一并删除。悬空需支撑保留独立语义（悬垂检出 + 同特征并选）。
// 曼波反馈驱动（「支撑标注点面时自动把该面有垂直悬臂且满足倾角阈值的
// 地方渲染出来；Shift+点击额外选上同一特征（至少一个坐标方向相同、朝向
// 相同）的其他面；右上角渲染一个 3D 指向标」）：
//   ① 悬空需支撑 = 点一面 → 平滑连通区（人眼的「那个面」）内检出
//      **悬垂带**（朝下、法线与 −Z 夹角 ≤25°=重悬空带、非贴底）染红，
//      其余淡蓝——与 modelFeatures.overhangSevereDeg 同口径；
//   ② Shift+点击 = 并入「同一特征」的其他悬垂面：朝向相同（与种子悬垂带
//      平均法线夹角 ≤30°）且至少一个坐标方向相同（包围盒单轴重叠，容差
//      2% span），单轴区间扫掠+并查集传递闭包（候选可达上万，禁两两暴力）；
//   ③ 右上角 3D 指向标：三轴箭头随视角旋转（世界→眼旋转基投影）+
//      眼空间背光盘 + SVG 轴名，pick/hover 帧不画（不污染拾取缓冲）；
//   ④ 受弯轴线两点式（同面约束）、受压区轴向洪波、接触/外观面共面洪波、
//      同 seed 同工具点击 = 取消、Ctrl+Z 快照撤销——全部保留。
//
// 实现要点：区域染色走**着色器 tint 属性**（每顶点区域色，默认白），
// 洪波结果一次 bufferData 生效——染色不管区域多大都是 O(1) draw。
//
// 标注形态：point（点）/ line（两点线）/ circle（孔口环）/ region（面区域，
//   { tool, type:'region', faces:[面索引...], supportFaces?:[悬垂子集], normal:[3], seed } ）
// ============================================================

(function () {
  const MAT = {
    perspective(fov, aspect, near, far) {
      const f = 1 / Math.tan(fov / 2), nf = 1 / (near - far);
      return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
    },
    lookAt(eye, center, up) {
      const n = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
      const z = n([eye[0] - center[0], eye[1] - center[1], eye[2] - center[2]]);
      const x = n([up[1] * z[2] - up[2] * z[1], up[2] * z[0] - up[0] * z[2], up[0] * z[1] - up[1] * z[0]]);
      const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
      return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
        -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]),
        -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]),
        -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]), 1];
    },
    mul(a, b) {
      const o = new Array(16).fill(0);
      for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
      return o;
    },
  };

  const VS = `
    attribute vec3 aPos; attribute vec3 aNor; attribute vec3 aPick; attribute vec3 aTint;
    uniform mat4 uMVP; varying vec3 vNor; varying vec3 vPick; varying vec3 vTint; varying float vZ;
    void main() { vNor = aNor; vPick = aPick; vTint = aTint; vZ = aPos.z; gl_Position = uMVP * vec4(aPos, 1.0); }`;
  const FS = `
    precision mediump float; varying vec3 vNor; varying vec3 vPick; varying vec3 vTint; varying float vZ;
    uniform vec3 uColor; uniform float uMode; // 0=正常着色 1=悬停/覆盖纯色 2=拾取原样
    uniform float uClipOn; uniform float uClipZ; // Z 轴截面（2026-10-18 审批台预览：上方裁掉看内部）
    void main() {
      if (uMode > 1.5) { gl_FragColor = vec4(vPick, 1.0); return; }
      if (uClipOn > 0.5 && vZ > uClipZ) discard;
      float lit = 0.55 + 0.45 * max(dot(normalize(vNor), normalize(vec3(0.4, -0.6, 0.8))), 0.0);
      vec3 base = uColor * lit * vTint;
      gl_FragColor = vec4(mix(base, uColor, step(0.5, uMode)), 1.0);
    }`;

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s));
    return s;
  }

  function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!m) return [1, 1, 1];
    const n = parseInt(m[1], 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  window.MeshAnnotator = function (canvas, overlay, opts) {
    opts = opts || {};
    const tools = opts.tools || [];
    const readonly = !!opts.readonly; // 只读预览（2026-10-18 审批台）：禁标注创建，保留轨道旋转/缩放
    const gl = canvas.getContext('webgl', { antialias: true });
    if (!gl) throw new Error('浏览器不支持 WebGL');
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    gl.useProgram(prog);

    const fbo = gl.createFramebuffer();
    const pickTex = gl.createTexture();
    const depthRB = gl.createRenderbuffer();

    const loc = {
      aPos: gl.getAttribLocation(prog, 'aPos'), aNor: gl.getAttribLocation(prog, 'aNor'),
      aPick: gl.getAttribLocation(prog, 'aPick'), aTint: gl.getAttribLocation(prog, 'aTint'),
      uMVP: gl.getUniformLocation(prog, 'uMVP'), uColor: gl.getUniformLocation(prog, 'uColor'),
      uMode: gl.getUniformLocation(prog, 'uMode'),
      uClipOn: gl.getUniformLocation(prog, 'uClipOn'), uClipZ: gl.getUniformLocation(prog, 'uClipZ'),
    };

    const st = {
      mesh: null, triCount: 0, center: [0, 0, 0], span: 100,
      clipZ: null, // Z 轴截面（null=不裁；世界坐标 z，高于它片元 discard）
      yaw: 0.7, pitch: 0.5, dist: 2.6,
      tool: tools.length ? tools[0].id : null,
      annotations: [],        // point/line/axis/survey/circle/region 混合
      circleCandidates: [],
      undoStack: [],
      redoStack: [],
      selectedId: null, seq: 0, // 当前选中标注（_aid）与自增序号
      loadType: 'compression', // 载荷标注当前受力类型          // 撤销快照栈（漏初始化会让 snapshot() 首次调用即抛错，所有点击标注全灭）
      pendingLine: null,
      hoverFace: -1,
      placementArmed: false, // 放置平面模式（2026-10-16 曼波令：同切片软件 Place on Face）
      placementOps: [],      // 已应用的放置变换栈 [{q,dz}]（复位=逆序求逆；导出=顺序合成）
      dirty: true,
    };

    const posBuf = gl.createBuffer(), norBuf = gl.createBuffer(), pickBufG = gl.createBuffer(), tintBuf = gl.createBuffer();
    let tintArr = null; // Float32Array(F*9)，区域染色写这里

    /** 重建 GPU 缓冲与包围盒（loadMesh 与放置平面共用；不动标注/相机/选择态） */
    function rebuildMeshBuffers() {
      const positions = st.mesh.positions, faces = st.mesh.faces;
      const faceCount = faces.length / 3;
      const triPos = new Float32Array(faceCount * 9);
      const triNor = new Float32Array(faceCount * 9);
      const triPick = new Float32Array(faceCount * 9);
      tintArr = new Float32Array(faceCount * 9).fill(1);
      let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (let t = 0; t < faceCount; t++) {
        const i0 = faces[t * 3] * 3, i1 = faces[t * 3 + 1] * 3, i2 = faces[t * 3 + 2] * 3;
        const ax = positions[i0], ay = positions[i0 + 1], az = positions[i0 + 2];
        const bx = positions[i1], by = positions[i1 + 1], bz = positions[i1 + 2];
        const cx = positions[i2], cy = positions[i2 + 1], cz = positions[i2 + 2];
        let nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
        let ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
        let nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
        const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
        const r = (t & 255) / 255, g = ((t >> 8) & 255) / 255, b = ((t >> 16) & 255) / 255;
        for (let v = 0; v < 3; v++) {
          triPos.set([v === 0 ? ax : v === 1 ? bx : cx, v === 0 ? ay : v === 1 ? by : cy, v === 0 ? az : v === 1 ? bz : cz], t * 9 + v * 3);
          triNor.set([nx, ny, nz], t * 9 + v * 3);
          triPick.set([r, g, b], t * 9 + v * 3);
        }
        for (const [px, py, pz] of [[ax, ay, az], [bx, by, bz], [cx, cy, cz]]) {
          if (px < mn[0]) mn[0] = px; if (px > mx[0]) mx[0] = px;
          if (py < mn[1]) mn[1] = py; if (py > mx[1]) mx[1] = py;
          if (pz < mn[2]) mn[2] = pz; if (pz > mx[2]) mx[2] = pz;
        }
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf); gl.bufferData(gl.ARRAY_BUFFER, triPos, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, norBuf); gl.bufferData(gl.ARRAY_BUFFER, triNor, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, pickBufG); gl.bufferData(gl.ARRAY_BUFFER, triPick, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, tintBuf); gl.bufferData(gl.ARRAY_BUFFER, tintArr, gl.DYNAMIC_DRAW);
      st.triCount = faceCount;
      st.center = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
      st.span = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) || 100;
      st.hoverFace = -1;
      st.dirty = true;
    }

    function loadMesh(data) {
      st.mesh = { positions: data.positions, faces: data.faces };
      rebuildMeshBuffers();
      st.dist = 2.6;
      st.annotations = [];
      st.circleCandidates = [];
      st.placementArmed = false;
      st.placementOps = [];
    }

    function matrices() {
      const aspect = canvas.width / canvas.height;
      const proj = MAT.perspective(0.9, aspect, st.span * 0.01, st.span * 50);
      const d = st.dist * st.span;
      const eye = [
        st.center[0] + d * Math.cos(st.pitch) * Math.sin(st.yaw),
        st.center[1] - d * Math.cos(st.pitch) * Math.cos(st.yaw),
        st.center[2] + d * Math.sin(st.pitch),
      ];
      const view = MAT.lookAt(eye, st.center, [0, 0, 1]);
      // 世界→眼旋转基：view 列主序，三列各 = 世界 X/Y/Z 轴在眼空间的朝向（指向标投影用）
      const basis = {
        x: [view[0], view[1], view[2]],
        y: [view[4], view[5], view[6]],
        z: [view[8], view[9], view[10]],
      };
      return { mvp: MAT.mul(proj, view), eye, basis };
    }

    function bindAttribs(pickMode) {
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.vertexAttribPointer(loc.aPos, 3, gl.FLOAT, false, 0, 0);
      gl.enableVertexAttribArray(loc.aPos);
      gl.bindBuffer(gl.ARRAY_BUFFER, norBuf);
      gl.vertexAttribPointer(loc.aNor, 3, gl.FLOAT, false, 0, 0);
      gl.enableVertexAttribArray(loc.aNor);
      gl.bindBuffer(gl.ARRAY_BUFFER, pickMode ? pickBufG : tintBuf);
      gl.vertexAttribPointer(pickMode ? loc.aPick : loc.aTint, 3, gl.FLOAT, false, 0, 0);
      gl.enableVertexAttribArray(pickMode ? loc.aPick : loc.aTint);
    }

    function draw(mode) { // mode: 'normal' | 'hover' | 'pick'
      const pickMode = mode === 'pick';
      gl.bindFramebuffer(gl.FRAMEBUFFER, pickMode ? fbo : null);
      if (pickMode) {
        gl.bindTexture(gl.TEXTURE_2D, pickTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, canvas.width, canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.bindRenderbuffer(gl.RENDERBUFFER, depthRB);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, canvas.width, canvas.height);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, pickTex, 0);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthRB);
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.enable(gl.DEPTH_TEST);
      gl.clearColor(1, 1, 1, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      if (!st.mesh) return;
      const { mvp, basis } = matrices();
      gl.uniformMatrix4fv(loc.uMVP, false, new Float32Array(mvp));
      bindAttribs(pickMode);
      gl.uniform1f(loc.uMode, pickMode ? 2 : mode === 'hover' ? 1 : 0);
      if (mode === 'hover') gl.uniform3f(loc.uColor, 1.0, 0.76, 0.18);
      else gl.uniform3f(loc.uColor, 0.55, 0.62, 0.7);
      // Z 轴截面裁剪（2026-10-18 审批台预览）：高于 st.clipZ 的片元 discard，
      // 拾取渲染同样裁剪保证点选与所见一致
      gl.uniform1f(loc.uClipOn, st.clipZ == null ? 0 : 1);
      gl.uniform1f(loc.uClipZ, st.clipZ == null ? 0 : st.clipZ);
      gl.drawArrays(gl.TRIANGLES, 0, st.triCount * 3);
      if (mode === 'hover' && st.hoverFace >= 0 && st.hoverFace < st.triCount) {
        gl.uniform1f(loc.uMode, 1);
        gl.drawArrays(gl.TRIANGLES, st.hoverFace * 3, 3);
      }
      if (mode === 'normal') drawTriad(basis);
    }

    // ---------- 3D 指向标（右上角方位仪：世界坐标三轴随视角旋转） ----------
    const TRIAD = { cssR: 40, margin: 14 };
    let triadGeom = null, discGeom = null, triadView = null;
    function buildTriad() {
      if (triadGeom) return;
      const SEG = 10;
      const AXES = [
        { w: [1, 0, 0], c: [0.86, 0.26, 0.22] }, // X 红
        { w: [0, 1, 0], c: [0.15, 0.62, 0.35] }, // Y 绿
        { w: [0, 0, 1], c: [0.23, 0.47, 0.83] }, // Z 蓝（打印朝向的「上」）
      ];
      const pos = [], nor = [], tint = [];
      const put = (p, n, c) => { pos.push(p[0], p[1], p[2]); nor.push(n[0], n[1], n[2]); tint.push(c[0], c[1], c[2]); };
      for (const { w, c } of AXES) {
        const ref = Math.abs(w[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
        let u = [w[1] * ref[2] - w[2] * ref[1], w[2] * ref[0] - w[0] * ref[2], w[0] * ref[1] - w[1] * ref[0]];
        const ul = Math.hypot(u[0], u[1], u[2]) || 1;
        u = u.map((x) => x / ul);
        const v = [w[1] * u[2] - w[2] * u[1], w[2] * u[0] - w[0] * u[2], w[0] * u[1] - w[1] * u[0]];
        const P = (r, a, z) => [
          w[0] * z + (u[0] * Math.cos(a) + v[0] * Math.sin(a)) * r,
          w[1] * z + (u[1] * Math.cos(a) + v[1] * Math.sin(a)) * r,
          w[2] * z + (u[2] * Math.cos(a) + v[2] * Math.sin(a)) * r,
        ];
        const RAD = (a) => [u[0] * Math.cos(a) + v[0] * Math.sin(a), u[1] * Math.cos(a) + v[1] * Math.sin(a), u[2] * Math.cos(a) + v[2] * Math.sin(a)];
        const rShaft = 0.065, z0 = 0.22, z1 = 0.68, rCone = 0.17, coneH = 1.0 - z1;
        const back = [-w[0], -w[1], -w[2]];
        const coneN = (rr) => { // 锥面法线 = 径向*锥高 − 轴向*锥底半径
          const n = [rr[0] * coneH - w[0] * rCone, rr[1] * coneH - w[1] * rCone, rr[2] * coneH - w[2] * rCone];
          const l = Math.hypot(n[0], n[1], n[2]) || 1;
          return [n[0] / l, n[1] / l, n[2] / l];
        };
        const apex = [w[0], w[1], w[2]];
        for (let s = 0; s < SEG; s++) {
          const a0 = (2 * Math.PI * s) / SEG, a1 = (2 * Math.PI * (s + 1)) / SEG;
          const r0 = RAD(a0), r1 = RAD(a1);
          // 杆侧面
          put(P(rShaft, a0, z0), r0, c); put(P(rShaft, a1, z0), r1, c); put(P(rShaft, a1, z1), r1, c);
          put(P(rShaft, a0, z0), r0, c); put(P(rShaft, a1, z1), r1, c); put(P(rShaft, a0, z1), r0, c);
          // 杆底盖 + 锥台环盖（朝 -w，背视不穿帮）
          put(P(rShaft, a0, z0), back, c); put(P(rShaft, a1, z0), back, c); put([w[0] * z0, w[1] * z0, w[2] * z0], back, c);
          put(P(rShaft, a0, z1), back, c); put(P(rShaft, a1, z1), back, c); put(P(rCone, a1, z1), back, c);
          put(P(rShaft, a0, z1), back, c); put(P(rCone, a1, z1), back, c); put(P(rCone, a0, z1), back, c);
          // 锥侧面
          put(P(rCone, a0, z1), coneN(r0), c); put(P(rCone, a1, z1), coneN(r1), c); put(apex, coneN(RAD((a0 + a1) / 2)), c);
        }
      }
      // 背光圆盘直接建在眼空间（跟随屏幕、垫在箭头后面）
      const dp = [], dn = [], dt = [];
      const zD = -0.55, rD = 1.22, dc = [0.93, 0.95, 0.97];
      for (let s = 0; s < 20; s++) {
        const a0 = (2 * Math.PI * s) / 20, a1 = (2 * Math.PI * (s + 1)) / 20;
        dp.push(0, 0, zD, Math.cos(a0) * rD, Math.sin(a0) * rD, zD, Math.cos(a1) * rD, Math.sin(a1) * rD, zD);
        for (let k = 0; k < 3; k++) { dn.push(0, 0, 1); dt.push(dc[0], dc[1], dc[2]); }
      }
      const upload = (p, n, t) => {
        const g = { count: p.length / 3 };
        g.posBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, g.posBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(p), gl.STATIC_DRAW);
        g.norBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, g.norBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(n), gl.STATIC_DRAW);
        g.tintBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, g.tintBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(t), gl.STATIC_DRAW);
        return g;
      };
      triadGeom = upload(pos, nor, tint);
      discGeom = upload(dp, dn, dt);
    }
    function triadBox() { // 指向标屏幕框：css 锚点 + 眼空间→NDC 仿射（右上角）
      const cw = canvas.clientWidth, ch = canvas.clientHeight;
      if (!cw || !ch) return null;
      const cx = cw - TRIAD.margin - TRIAD.cssR, cy = TRIAD.margin + TRIAD.cssR;
      const sx = (TRIAD.cssR * 2) / cw, sy = (TRIAD.cssR * 2) / ch;
      const ncx = (cx / cw) * 2 - 1, ncy = 1 - (cy / ch) * 2;
      return { cx, cy, T: [sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, -0.25, 0, ncx, ncy, 0.5, 1] };
    }
    function drawTriad(basis) {
      buildTriad();
      const box = triadBox();
      if (!box) return;
      // 世界→眼旋转（列主序）：basis 三元组本身就是 R 的三列（世界轴的眼空间朝向），
      // 列序写错成转置会让箭头与字母反向——2026-10-13 曼波实测抓出
      const R = [basis.x[0], basis.x[1], basis.x[2], 0, basis.y[0], basis.y[1], basis.y[2], 0, basis.z[0], basis.z[1], basis.z[2], 0, 0, 0, 0, 1];
      const dpr = canvas.width / canvas.clientWidth;
      const half = Math.ceil(TRIAD.cssR * 1.35 * dpr);
      const dcx = Math.round(box.cx * dpr), dcy = Math.round(canvas.height - box.cy * dpr);
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(dcx - half, dcy - half, half * 2, half * 2);
      gl.clear(gl.DEPTH_BUFFER_BIT); // 该角落清深：模型再靠边也不遮挡指向标
      gl.uniform1f(loc.uMode, 0);
      gl.uniform3f(loc.uColor, 1, 1, 1);
      const bindG = (g) => {
        gl.bindBuffer(gl.ARRAY_BUFFER, g.posBuf); gl.vertexAttribPointer(loc.aPos, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, g.norBuf); gl.vertexAttribPointer(loc.aNor, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, g.tintBuf); gl.vertexAttribPointer(loc.aTint, 3, gl.FLOAT, false, 0, 0);
        gl.disableVertexAttribArray(loc.aPick);
      };
      bindG(discGeom);
      gl.uniformMatrix4fv(loc.uMVP, false, new Float32Array(box.T));
      gl.drawArrays(gl.TRIANGLES, 0, discGeom.count);
      bindG(triadGeom);
      gl.uniformMatrix4fv(loc.uMVP, false, new Float32Array(MAT.mul(box.T, R)));
      gl.drawArrays(gl.TRIANGLES, 0, triadGeom.count);
      gl.disable(gl.SCISSOR_TEST);
      triadView = { box, basis }; // renderOverlay 画轴名字母用
    }

    function pickFace(px, py) {
      draw('pick');
      const pix = new Uint8Array(4);
      gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pix);
      draw('normal');
      const face = pix[0] | (pix[1] << 8) | (pix[2] << 16);
      const bg = pix[0] === 255 && pix[1] === 255 && pix[2] === 255;
      return bg || face >= st.triCount ? -1 : face;
    }

    let pickBuf = null, pickBufW = 0, pickBufH = 0;
    function occlusionMap() {
      draw('pick');
      const w = canvas.width, h = canvas.height;
      if (!pickBuf || pickBufW !== w || pickBufH !== h) { pickBuf = new Uint8Array(w * h * 4); pickBufW = w; pickBufH = h; }
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pickBuf);
      draw('normal');
    }
    function occludedAt(cssX, cssY) {
      const px = Math.round(cssX * (canvas.width / canvas.clientWidth));
      const py = Math.round(canvas.height - cssY * (canvas.height / canvas.clientHeight));
      if (px < 0 || py < 0 || px >= pickBufW || py >= pickBufH) return false;
      const off = (py * pickBufW + px) * 4;
      const f = pickBuf[off] | (pickBuf[off + 1] << 8) | (pickBuf[off + 2] << 16);
      const bg = pickBuf[off] === 255 && pickBuf[off + 1] === 255 && pickBuf[off + 2] === 255;
      return !bg;
    }

    function project(p, mvp) {
      const cx = mvp[0] * p[0] + mvp[4] * p[1] + mvp[8] * p[2] + mvp[12];
      const cy = mvp[1] * p[0] + mvp[5] * p[1] + mvp[9] * p[2] + mvp[13];
      const cw = mvp[3] * p[0] + mvp[7] * p[1] + mvp[11] * p[2] + mvp[15];
      if (cw <= 0) return null;
      return [(cx / cw * 0.5 + 0.5) * canvas.clientWidth, (1 - (cy / cw * 0.5 + 0.5)) * canvas.clientHeight];
    }

    // ---------- 撤销/重做（快照栈，任何标注变更前先存档；新操作截断重做分支） ----------
    function snapshot() {
      st.undoStack.push(JSON.stringify(st.annotations));
      if (st.undoStack.length > 50) st.undoStack.shift();
      st.redoStack.length = 0;
    }
    // 全文件 onChange 都用它导出标注快照——此前只有 API 属性上这一份，
    function pushAnnotation(a) { a._aid = ++st.seq; st.annotations.push(a); return a; } // 标注唯一 id：选中/编辑/删除链路的钥匙（v49 漏发号，v154 修复）
    // 作用域内无函数，所有 opts.onChange(getAnnotations()) 必抛 ReferenceError
    function getAnnotations() { return st.annotations.map((a) => ({ ...a })); }
    function undo() {
      if (!st.undoStack.length) { if (opts.onHint) opts.onHint('没有可撤销的标注操作'); return; }
      st.redoStack.push(JSON.stringify(st.annotations));
      st.annotations = JSON.parse(st.undoStack.pop());
      st.pendingLine = null;
      if (st.selectedId && !st.annotations.some((a) => a._aid === st.selectedId)) st.selectedId = null;
      recomputeTints();
      renderOverlay();
      if (opts.onChange) opts.onChange(getAnnotations());
    }
    function redo() {
      if (!st.redoStack.length) { if (opts.onHint) opts.onHint('没有可重做的操作'); return; }
      st.undoStack.push(JSON.stringify(st.annotations));
      st.annotations = JSON.parse(st.redoStack.pop());
      st.pendingLine = null;
      recomputeTints();
      renderOverlay();
      if (opts.onChange) opts.onChange(getAnnotations());
    }

    const MAG_SCALE = { light: 0.7, medium: 1, heavy: 1.35 };
    const MAG_LABEL = { light: '轻载', medium: '中载', heavy: '重载' };
    const LOAD_TYPE_LABEL = { compression: '受压', tension: '受拉', shear: '剪切', bending: '弯曲', torsion: '扭转', contact: '滚压接触' };
    const NATURE_LABEL = { static: '静载', fatigue: '动载疲劳', impact: '冲击', vibration: '振动' };
    function magLabelOf(m) { return MAG_LABEL[m] || ''; }
    function magScaleOf(m) { return MAG_SCALE[m] || 1; }
    function toolOf(id) { return tools.find((t) => t.id === id) || { color: '#7f8c8d', label: id }; }

    // ---------- 面法线/邻接/质心（区域洪波与悬垂普查用，loadMesh 后惰性建一次） ----------
    let faceGeom = null, adjacency = null;
    function ensureTopology() {
      if (faceGeom) return;
      const { positions, faces } = st.mesh;
      const F = st.triCount;
      faceGeom = { n: new Float32Array(F * 3), d: new Float64Array(F), cz: new Float32Array(F) };
      adjacency = new Map();
      const edgeKey = (a, b) => a < b ? a + '_' + b : b + '_' + a;
      let zmin = Infinity;
      for (let t = 0; t < F; t++) {
        const i0 = faces[t * 3] * 3, i1 = faces[t * 3 + 1] * 3, i2 = faces[t * 3 + 2] * 3;
        const ax = positions[i0], ay = positions[i0 + 1], az = positions[i0 + 2];
        const ux = positions[i1] - ax, uy = positions[i1 + 1] - ay, uz = positions[i1 + 2] - az;
        const vx = positions[i2] - ax, vy = positions[i2 + 1] - ay, vz = positions[i2 + 2] - az;
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const l = Math.hypot(nx, ny, nz) || 1;
        faceGeom.n[t * 3] = nx / l; faceGeom.n[t * 3 + 1] = ny / l; faceGeom.n[t * 3 + 2] = nz / l;
        faceGeom.d[t] = faceGeom.n[t * 3] * ax + faceGeom.n[t * 3 + 1] * ay + faceGeom.n[t * 3 + 2] * az;
        faceGeom.cz[t] = (az + positions[i1 + 2] + positions[i2 + 2]) / 3;
        if (az < zmin) zmin = az;
        for (let e = 0; e < 3; e++) {
          const v1 = faces[t * 3 + e], v2 = faces[t * 3 + (e + 1) % 3];
          const key = edgeKey(v1, v2);
          let arr = adjacency.get(key);
          if (!arr) { arr = []; adjacency.set(key, arr); }
          arr.push(t);
        }
      }
      faceGeom.zmin = zmin;
      faceGeom.onPlate = (t) => faceGeom.cz[t] <= zmin + 0.3 + 1e-6;
    }

    /** 洪波：从 seedFace 沿邻接扩展，pred(face, seed) 为 true 的连通面集合 */
    function floodRegion(seedFace, pred) {
      ensureTopology();
      const seen = new Set([seedFace]);
      const out = [seedFace];
      const queue = [seedFace];
      const { n, d } = faceGeom;
      const sn = [n[seedFace * 3], n[seedFace * 3 + 1], n[seedFace * 3 + 2]];
      const sd = d[seedFace];
      while (queue.length) {
        const f = queue.shift();
        for (let e = 0; e < 3; e++) {
          const v1 = st.mesh.faces[f * 3 + e], v2 = st.mesh.faces[f * 3 + (e + 1) % 3];
          const key = v1 < v2 ? v1 + '_' + v2 : v2 + '_' + v1;
          for (const nb of (adjacency.get(key) || [])) {
            if (seen.has(nb)) continue;
            if (!pred(nb, sn, sd, n, d)) continue;
            seen.add(nb);
            out.push(nb);
            queue.push(nb);
          }
        }
      }
      return out;
    }

    /** 平滑区域生长：从 seed 沿邻接扩展，逐步法线夹角 ≤maxDeg（曲面渐变可穿越，硬边截停）
     *  axisDeg 可选：额外要求候选面法线与【种子面】法线夹角 ≤axisDeg——不给则无此约束。
     *  支撑标注用 60° 锥（与受压区 ±64° 口径一致）：防平滑洪波沿孔壁/圆角爬满一整圈 */
    function floodSmooth(seedFace, maxDeg, axisDeg) {
      ensureTopology();
      const cosT = Math.cos((maxDeg * Math.PI) / 180);
      const hasAxis = axisDeg !== undefined;
      const cosAxis = hasAxis ? Math.cos((axisDeg * Math.PI) / 180) : 0;
      const N = faceGeom.n;
      const sn = hasAxis ? [N[seedFace * 3], N[seedFace * 3 + 1], N[seedFace * 3 + 2]] : null;
      const seen = new Set([seedFace]);
      const out = [seedFace];
      const queue = [seedFace];
      while (queue.length) {
        const f = queue.shift();
        const fn = [N[f * 3], N[f * 3 + 1], N[f * 3 + 2]];
        for (let e = 0; e < 3; e++) {
          const v1 = st.mesh.faces[f * 3 + e], v2 = st.mesh.faces[f * 3 + (e + 1) % 3];
          const key = v1 < v2 ? v1 + '_' + v2 : v2 + '_' + v1;
          for (const nb of (adjacency.get(key) || [])) {
            if (seen.has(nb)) continue;
            const dot = N[nb * 3] * fn[0] + N[nb * 3 + 1] * fn[1] + N[nb * 3 + 2] * fn[2];
            if (dot < cosT) continue;
            if (hasAxis && N[nb * 3] * sn[0] + N[nb * 3 + 1] * sn[1] + N[nb * 3 + 2] * sn[2] < cosAxis) continue;
            seen.add(nb);
            out.push(nb);
            queue.push(nb);
          }
        }
      }
      return out;
    }

    const predAxis = (f, sn, sd, N, D) => { // 轴向连通（与种子面法线平行，双向）
      const dot = Math.abs(N[f * 3] * sn[0] + N[f * 3 + 1] * sn[1] + N[f * 3 + 2] * sn[2]);
      return dot > 0.9;
    };

    // ---------- 区域染色（tint 缓冲，多角色并行=平均混合而非覆盖） ----------
    function recomputeTints() {
      tintArr.fill(1);
      const sums = new Map(); // face → [r,g,b,count]
      const addC = (f, c) => {
        let e = sums.get(f);
        if (!e) { e = [0, 0, 0, 0]; sums.set(f, e); }
        e[0] += c[0]; e[1] += c[1]; e[2] += c[2]; e[3]++;
      };
      for (const a of st.annotations) {
        if (a.type !== 'region' && a.type !== 'survey') continue;
        const c = hexToRgb(toolOf(a.tool).color);
        if (a.supportFaces) {
          // 支撑双色：支撑子集红、区域内其余淡蓝
          const sup = new Set(a.supportFaces);
          for (const f of a.faces) addC(f, sup.has(f) ? c : [0.72, 0.82, 1]);
        } else {
          for (const f of a.faces) addC(f, c);
        }
      }
      for (const [f, e] of sums) {
        const t = [e[0] / e[3], e[1] / e[3], e[2] / e[3]];
        for (let v = 0; v < 3; v++) tintArr.set(t, f * 9 + v * 3);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, tintBuf);
      gl.bufferData(gl.ARRAY_BUFFER, tintArr, gl.DYNAMIC_DRAW);
      invalidate(); // 染色变了必须重绘 GL 帧——此前只刷 SVG 层，颜色要等下次鼠标划过才现身
    }

    // ---------- 覆盖层 ----------
    const SVGNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
    overlay.appendChild(svg);

    function renderOverlay() {
      overlay.innerHTML = '';
      overlay.appendChild(svg);
      svg.innerHTML = '';
      if (!st.mesh) return;
      if (st.annotations.some((a) => a.type === 'point')) occlusionMap();
      const { mvp } = matrices();
      svg.setAttribute('viewBox', `0 0 ${canvas.clientWidth} ${canvas.clientHeight}`);

  // 选中标注的光环（representative point 投影位置）
  if (st.selectedId) {
    const sel = st.annotations.find((x) => x._aid === st.selectedId);
    if (sel) {
      const rp = sel.type === 'line' || sel.type === 'axis'
        ? [(sel.a[0] + sel.b[0]) / 2, (sel.a[1] + sel.b[1]) / 2, (sel.a[2] + sel.b[2]) / 2]
        : sel.type === 'circle' ? sel.c : sel.type === 'load' ? [sel.pos[0] + sel.dir[0] * st.span * 0.07, sel.pos[1] + sel.dir[1] * st.span * 0.07, sel.pos[2] + sel.dir[2] * st.span * 0.07]
        : (sel.type === 'point' ? sel.pos : null); // region/survey 无代表点，跳过光环（修复：undefined 进 project 崩渲染循环）
      const p = project(rp, mvp);
      if (p) {
        const halo = document.createElementNS(SVGNS, 'circle');
        halo.setAttribute('cx', p[0].toFixed(1)); halo.setAttribute('cy', p[1].toFixed(1));
        halo.setAttribute('r', 14); halo.setAttribute('fill', 'none');
        halo.setAttribute('stroke', '#ffffff'); halo.setAttribute('stroke-width', '2');
        halo.setAttribute('stroke-dasharray', '4 3');
        svg.appendChild(halo);
      }
    }
  }
      // ① 识别圆环候选（虚线环，可点击确认）
      for (const circ of st.circleCandidates) {
        const pts = [];
        const basis = Math.abs(circ.n[2]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
        let ux = [circ.n[1] * basis[2] - circ.n[2] * basis[1], circ.n[2] * basis[0] - circ.n[0] * basis[2], circ.n[0] * basis[1] - circ.n[1] * basis[0]];
        const ul = Math.hypot(...ux) || 1; ux = ux.map((v) => v / ul);
        const vx = [circ.n[1] * ux[2] - circ.n[2] * ux[1], circ.n[2] * ux[0] - circ.n[0] * ux[2], circ.n[0] * ux[1] - circ.n[1] * ux[0]];
        let visible = 0;
        for (let k = 0; k < 24; k++) {
          const a = (2 * Math.PI * k) / 24;
          const p = project([
            circ.c[0] + circ.r * Math.cos(a) * ux[0] + circ.r * Math.sin(a) * vx[0],
            circ.c[1] + circ.r * Math.cos(a) * ux[1] + circ.r * Math.sin(a) * vx[1],
            circ.c[2] + circ.r * Math.cos(a) * ux[2] + circ.r * Math.sin(a) * vx[2],
          ], mvp);
          if (p) { pts.push(p.map((v) => v.toFixed(1)).join(',')); visible++; }
        }
        if (visible < 8) continue;
        const ring = document.createElementNS(SVGNS, 'polyline');
        ring.setAttribute('points', pts.join(' '));
        ring.setAttribute('fill', 'none');
        ring.setAttribute('stroke', '#f1c40f');
        ring.setAttribute('stroke-width', '2.5');
        ring.setAttribute('stroke-dasharray', '7 5');
        ring.style.pointerEvents = 'stroke';
        ring.style.cursor = 'pointer';
        ring.title = '点击确认：通孔标注（r' + circ.r + 'mm）';
        ring.addEventListener('click', () => {
          snapshot();
        pushAnnotation({ tool: 'hole_rim', type: 'circle', c: circ.c, n: circ.n, r: circ.r });
          st.circleCandidates = st.circleCandidates.filter((x) => x !== circ);
          renderOverlay();
          if (opts.onChange) opts.onChange(getAnnotations());
        });
        svg.appendChild(ring);
      }

      // ①' 载荷箭头（方向+类型空间化）
      const LOAD_ARROW_COLORS = { compression: '#3b7dd8', tension: '#e74c3c', shear: '#e67e22', bending: '#8e44ad', torsion: '#27ae60', contact: '#f39c12' };
      for (const a of st.annotations) {
        if (a.type !== 'load') continue;
        const c = LOAD_ARROW_COLORS[a.loadType] || '#3b7dd8';
        const len = st.span * 0.14 * magScaleOf(a.loadMagnitude);
        const tip = [a.pos[0] + a.dir[0] * len, a.pos[1] + a.dir[1] * len, a.pos[2] + a.dir[2] * len];
        const p0 = project(a.pos, mvp), p1 = project(tip, mvp);
        if (!p0 || !p1) continue;
        const ln = document.createElementNS(SVGNS, 'line');
        ln.setAttribute('x1', p0[0].toFixed(1)); ln.setAttribute('y1', p0[1].toFixed(1));
        ln.setAttribute('x2', p1[0].toFixed(1)); ln.setAttribute('y2', p1[1].toFixed(1));
        ln.setAttribute('stroke', c); ln.setAttribute('stroke-width', String(4 * magScaleOf(a.loadMagnitude)));
        svg.appendChild(ln);
        const ang = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
        for (const da of [2.6, -2.6]) {
          const wing = document.createElementNS(SVGNS, 'line');
          wing.setAttribute('x1', p1[0].toFixed(1)); wing.setAttribute('y1', p1[1].toFixed(1));
          wing.setAttribute('x2', (p1[0] - Math.cos(ang + da) * 12).toFixed(1));
          wing.setAttribute('y2', (p1[1] - Math.sin(ang + da) * 12).toFixed(1));
          wing.setAttribute('stroke', c); wing.setAttribute('stroke-width', '3');
          svg.appendChild(wing);
        }
        const lbl = document.createElementNS(SVGNS, 'text');
        lbl.setAttribute('x', (p0[0] + 8).toFixed(1)); lbl.setAttribute('y', (p0[1] - 6).toFixed(1));
        lbl.setAttribute('fill', c); lbl.setAttribute('font-size', '11');
        lbl.textContent = (LOAD_TYPE_LABEL[a.loadType] || a.loadType) + '载荷' +
          (a.loadNature && NATURE_LABEL[a.loadNature] ? '·' + NATURE_LABEL[a.loadNature] : '') +
          (a.loadMagnitude ? '·' + magLabelOf(a.loadMagnitude) : '');
        svg.appendChild(lbl);
      }
      // ② 线标注 + 放置中预览
      const lineDraw = (a, b, color, dashed) => {
        const pa = project(a, mvp), pb = project(b, mvp);
        if (!pa || !pb) return;
        const ln = document.createElementNS(SVGNS, 'line');
        ln.setAttribute('x1', pa[0].toFixed(1)); ln.setAttribute('y1', pa[1].toFixed(1));
        ln.setAttribute('x2', pb[0].toFixed(1)); ln.setAttribute('y2', pb[1].toFixed(1));
        ln.setAttribute('stroke', color);
        ln.setAttribute('stroke-width', '3.5');
        if (dashed) ln.setAttribute('stroke-dasharray', '6 4');
        svg.appendChild(ln);
        for (const p of [pa, pb]) {
          const dot = document.createElementNS(SVGNS, 'circle');
          dot.setAttribute('cx', p[0].toFixed(1)); dot.setAttribute('cy', p[1].toFixed(1));
          dot.setAttribute('r', 4); dot.setAttribute('fill', color);
          svg.appendChild(dot);
        }
      };
      for (const a of st.annotations) {
        if (a.type !== 'line' && a.type !== 'axis') continue;
        lineDraw(a.a, a.b, toolOf(a.tool).color, false);
      }

      // ②' 待定线标注：起点圆点 + 虚线预览（端点有效=绿/无效=红）
      if (st.pendingLine) {
        const tool = toolOf(st.tool);
        const pa = project(st.pendingLine.a, mvp);
        if (pa) {
          const dotA = document.createElementNS(SVGNS, 'circle');
          dotA.setAttribute('cx', pa[0].toFixed(1)); dotA.setAttribute('cy', pa[1].toFixed(1));
          dotA.setAttribute('r', 5); dotA.setAttribute('fill', tool.color); dotA.setAttribute('stroke', '#fff'); dotA.setAttribute('stroke-width', 1.5);
          svg.appendChild(dotA);
          if (st.pendingLine.cursor) {
            const pc = project(st.pendingLine.cursor, mvp);
            if (pc) {
              const ok = st.pendingLine.cursorValid;
              const ln = document.createElementNS(SVGNS, 'line');
              ln.setAttribute('x1', pa[0].toFixed(1)); ln.setAttribute('y1', pa[1].toFixed(1));
              ln.setAttribute('x2', pc[0].toFixed(1)); ln.setAttribute('y2', pc[1].toFixed(1));
              ln.setAttribute('stroke', ok ? tool.color : '#e74c3c');
              ln.setAttribute('stroke-width', '2.5');
              ln.setAttribute('stroke-dasharray', '6 4');
              svg.appendChild(ln);
              const dotB = document.createElementNS(SVGNS, 'circle');
              dotB.setAttribute('cx', pc[0].toFixed(1)); dotB.setAttribute('cy', pc[1].toFixed(1));
              dotB.setAttribute('r', 4); dotB.setAttribute('fill', ok ? tool.color : '#e74c3c');
              svg.appendChild(dotB);
            }
          }
        }
      }

      // ③ 点标注圆点
      for (let i = 0; i < st.annotations.length; i++) {
        const a = st.annotations[i];
        if (a.type !== 'point') continue;
        const tool = toolOf(a.tool);
        const pt = project(a.pos, mvp);
        if (!pt) continue;
        const occluded = occludedAt(pt[0], pt[1]);
        const dot = document.createElement('div');
        const isSel = a._aid === st.selectedId;
        dot.style.cssText = `position:absolute;left:${pt[0] - (isSel ? 8 : 6)}px;top:${pt[1] - (isSel ? 8 : 6)}px;width:${isSel ? 16 : 12}px;height:${isSel ? 16 : 12}px;border-radius:50%;` +
          `background:${tool.color};border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4);` +
          `pointer-events:auto;cursor:pointer;opacity:${occluded ? 0.35 : 1};`;
        dot.title = `${tool.label} @ (${a.pos.join(', ')})` + (a.note ? ' — ' + a.note : '') + (occluded ? '（被模型遮挡）' : '');
        dot.onclick = () => {
          if (confirm('删除这条标注？' + (a.note ? '\n备注：' + a.note : ''))) {
            snapshot();
        st.annotations.splice(i, 1);
            renderOverlay();
            if (opts.onChange) opts.onChange(getAnnotations());
          }
        };
        overlay.appendChild(dot);
      }

      // ④ 3D 指向标轴名（字母层；箭头本体在 draw() 的 WebGL 层，朝向取同一旋转基）
      if (triadView) {
        const { box, basis } = triadView;
        const axisDefs = [
          { t: 'X', d: basis.x, c: '#db4238' },
          { t: 'Y', d: basis.y, c: '#269e59' },
          { t: 'Z', d: basis.z, c: '#3b78d4' },
        ];
        for (const { t, d, c } of axisDefs) {
          const tx = document.createElementNS(SVGNS, 'text');
          tx.setAttribute('x', (box.cx + d[0] * TRIAD.cssR * 1.18).toFixed(1));
          tx.setAttribute('y', (box.cy - d[1] * TRIAD.cssR * 1.18).toFixed(1));
          tx.setAttribute('text-anchor', 'middle');
          tx.setAttribute('dominant-baseline', 'central');
          tx.setAttribute('font-size', '11');
          tx.setAttribute('font-weight', '700');
          tx.setAttribute('fill', c);
          tx.setAttribute('opacity', d[2] > 0 ? '1' : '0.5'); // 背向相机的轴名调暗
          tx.textContent = t;
          svg.appendChild(tx);
        }
      }
    }

    function render() {
      if (!st.dirty || !st.mesh) return;
      st.dirty = false;
      draw('normal');
      if (st.placementArmed && st.hoverFace >= 0) drawFaceHi(st.hoverFace); // 放置模式悬停高亮
      renderOverlay();
    }
    function invalidate() { st.dirty = true; requestAnimationFrame(render); }

    // 交互
    let dragging = false, lastX = 0, lastY = 0, moved = 0, hoverPending = false;
    canvas.addEventListener('mousedown', (e) => { dragging = true; moved = 0; lastX = e.clientX; lastY = e.clientY; });
    window.addEventListener('mouseup', () => { dragging = false; });
    canvas.addEventListener('mousemove', (e) => {
      if (dragging) {
        st.yaw -= (e.clientX - lastX) * 0.008; // v1.4 修复左右反向
        st.pitch = Math.max(-1.4, Math.min(1.4, st.pitch + (e.clientY - lastY) * 0.008));
        moved += Math.abs(e.clientX - lastX) + Math.abs(e.clientY - lastY);
        lastX = e.clientX; lastY = e.clientY;
        invalidate();
        return;
      }
      if (hoverPending || !st.mesh) return;
      hoverPending = true;
      requestAnimationFrame(() => {
        hoverPending = false;
        const rect = canvas.getBoundingClientRect();
        const px = Math.round((e.clientX - rect.left) * (canvas.width / rect.width));
        const py = Math.round(canvas.height - (e.clientY - rect.top) * (canvas.height / rect.height));
        if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) return;
        if (st.pendingLine) {
          // 预览端点 = 鼠标射线与模型表面的精确交点，且须落在起点平面内（≤0.3mm）
          const ray = screenRay(e, rect);
          const face = pickFace(px, py);
          let cand = null;
          if (face >= 0) {
            const hit = rayTriangle(ray, face);
            if (hit) {
              const off = Math.abs((hit[0] - st.pendingLine.planePoint[0]) * st.pendingLine.planeNormal[0] + (hit[1] - st.pendingLine.planePoint[1]) * st.pendingLine.planeNormal[1] + (hit[2] - st.pendingLine.planePoint[2]) * st.pendingLine.planeNormal[2]);
              if (off <= 0.3) cand = hit.map((v) => +v.toFixed(2));
            }
          }
          st.pendingLine.cursor = cand || st.pendingLine.cursor;
          st.pendingLine.cursorValid = !!cand;
          renderOverlay();
          return;
        }
        const face = pickFace(px, py);
        if (face !== st.hoverFace) { st.hoverFace = face; invalidate(); }
      });
    });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      st.dist = Math.max(0.6, Math.min(12, st.dist * (e.deltaY > 0 ? 1.1 : 0.9)));
      invalidate();
    }, { passive: false });

    function distToSegment(px, py, ax, ay, bx, by) {
      const dx = bx - ax, dy = by - ay;
      const l2 = dx * dx + dy * dy;
      if (l2 === 0) return Math.hypot(px - ax, py - ay);
      let t = ((px - ax) * dx + (py - ay) * dy) / l2;
      t = Math.max(0, Math.min(1, t));
      return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    }

    /** 屏幕坐标命中测试：返回命中的已有标注（后加入者优先），未命中 null */
    function pickAnnotationAtScreen(cssX, cssY) {
      const { mvp } = matrices();
      const px = cssX * (canvas.width / canvas.clientWidth);
      const py = cssY * (canvas.height / canvas.clientHeight);
      // 线/轴：点到线段距离
      for (let i = st.annotations.length - 1; i >= 0; i--) {
        const a = st.annotations[i];
        if (a.type !== 'line' && a.type !== 'axis') continue;
        const pa = project(a.a, mvp), pb = project(a.b, mvp);
        if (!pa || !pb) continue;
        if (distToSegment(px, py, pa[0], pa[1], pb[0], pb[1]) <= 10) return a;
      }
      // 点/载荷箭头：位置邻近（箭头含杆+头，用基点与尖端都试）
      for (let i = st.annotations.length - 1; i >= 0; i--) {
        const a = st.annotations[i];
        if (a.type !== 'point' && a.type !== 'load') continue;
        const p0 = project(a.pos, mvp);
        if (p0 && Math.hypot(px - p0[0], py - p0[1]) <= 16) return a;
        if (a.type === 'load') {
          const len = st.span * 0.14;
          const tip = [a.pos[0] + a.dir[0] * len, a.pos[1] + a.dir[1] * len, a.pos[2] + a.dir[2] * len];
          const p1 = project(tip, mvp);
          if (p1 && Math.hypot(px - p1[0], py - p1[1]) <= 16) return a;
        }
      }
      return null;
    }

    function surfacePoint(e) {
      const rect = canvas.getBoundingClientRect();
      const px = Math.round((e.clientX - rect.left) * (canvas.width / rect.width));
      const py = Math.round(canvas.height - (e.clientY - rect.top) * (canvas.height / rect.height));
      const face = pickFace(px, py);
      if (face < 0) return null;
      // v1.6：精确落点 = 鼠标射线 × 所在三角面求交（v1.5 用面质心，大面上会偏离鼠标）
      const ray = screenRay(e);
      const hit = rayTriangle(ray, face);
      return { face, pos: (hit || centroidOf(face)).map((v) => +v.toFixed(2)), normal: faceNormalOf(face) };
    }

    function centroidOf(face) {
      const f = st.mesh.faces, P = st.mesh.positions;
      const i0 = f[face * 3] * 3, i1 = f[face * 3 + 1] * 3, i2 = f[face * 3 + 2] * 3;
      return [(P[i0] + P[i1] + P[i2]) / 3, (P[i0 + 1] + P[i1 + 1] + P[i2 + 1]) / 3, (P[i0 + 2] + P[i1 + 2] + P[i2 + 2]) / 3];
    }

    function faceNormalOf(face) {
      const f = st.mesh.faces, P = st.mesh.positions;
      const i0 = f[face * 3] * 3, i1 = f[face * 3 + 1] * 3, i2 = f[face * 3 + 2] * 3;
      const ux = P[i1] - P[i0], uy = P[i1 + 1] - P[i0 + 1], uz = P[i1 + 2] - P[i0 + 2];
      const vx = P[i2] - P[i0], vy = P[i2 + 1] - P[i0 + 1], vz = P[i2 + 2] - P[i0 + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      return [nx / l, ny / l, nz / l];
    }

    // ---------- 放置平面（2026-10-16 曼波令：同切片软件 Place on Face） ----------
    // 交互：进入模式 → 悬停高亮面 → 点击把该面转成朝下（法线→-Z）并落到盘面 z=0；
    // 标注坐标随模型同步变换（面序号类标注旋转不变）；可逆序复位；导出四元数随单存档（切片烘焙用）
    function quatFromTo(a, b) {
      const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      if (d > 0.999999) return [0, 0, 0, 1];
      if (d < -0.999999) {
        const ax = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
        const cx = a[1] * ax[2] - a[2] * ax[1], cy = a[2] * ax[0] - a[0] * ax[2], cz = a[0] * ax[1] - a[1] * ax[0];
        const l = Math.hypot(cx, cy, cz) || 1;
        return [cx / l, cy / l, cz / l, 0];
      }
      const cx = a[1] * b[2] - a[2] * b[1], cy = a[2] * b[0] - a[0] * b[2], cz = a[0] * b[1] - a[1] * b[0];
      const q = [cx, cy, cz, 1 + d];
      const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
      return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
    }
    function quatMul(a, b) {
      return [
        a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
        a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
        a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
        a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
      ];
    }
    function quatInv(q) { return [-q[0], -q[1], -q[2], q[3]]; }
    function rotVec(q, v) {
      const [x, y, z, w] = q;
      const tx = 2 * (y * v[2] - z * v[1]);
      const ty = 2 * (z * v[0] - x * v[2]);
      const tz = 2 * (x * v[1] - y * v[0]);
      return [
        v[0] + w * tx + (y * tz - z * ty),
        v[1] + w * ty + (z * tx - x * tz),
        v[2] + w * tz + (x * ty - y * tx),
      ];
    }
    const r3 = (v) => [+v[0].toFixed(3), +v[1].toFixed(3), +v[2].toFixed(3)];
    function mapAnnotationCoords(fnPoint, fnDir) {
      for (const a of st.annotations) {
        if (Array.isArray(a.pos)) a.pos = fnPoint(a.pos);
        if (Array.isArray(a.c)) a.c = fnPoint(a.c);
        if (Array.isArray(a.a)) a.a = fnPoint(a.a);
        if (Array.isArray(a.b)) a.b = fnPoint(a.b);
        if (Array.isArray(a.n)) a.n = fnDir(a.n);
        if (Array.isArray(a.dir)) a.dir = fnDir(a.dir);
        if (Array.isArray(a.normal)) a.normal = fnDir(a.normal);
        // faces/seed/supportFaces 是面序号——旋转不变，无需处理
      }
    }
    function applyPlacement(face) {
      if (!st.mesh || face < 0) return false;
      const n = faceNormalOf(face);
      const q = quatFromTo(n, [0, 0, -1]);
      const P = st.mesh.positions;
      for (let i = 0; i < P.length; i += 3) {
        const v = rotVec(q, [P[i], P[i + 1], P[i + 2]]);
        P[i] = v[0]; P[i + 1] = v[1]; P[i + 2] = v[2];
      }
      let minz = Infinity;
      for (let i = 2; i < P.length; i += 3) if (P[i] < minz) minz = P[i];
      const dz = -minz;
      for (let i = 2; i < P.length; i += 3) P[i] += dz;
      mapAnnotationCoords(
        (v) => { const r = rotVec(q, v); r[2] += dz; return r3(r); },
        (v) => r3(rotVec(q, v))
      );
      st.placementOps.push({ q, dz });
      st.placementArmed = false;
      rebuildMeshBuffers();
      recomputeTints();
      renderOverlay();
      invalidate();
      if (opts.onPlacement) opts.onPlacement(getPlacement());
      if (opts.onPlacementMode) opts.onPlacementMode(false);
      if (opts.onHint) opts.onHint('已放置：该面朝下（提交前可「复位放置」还原）');
      return true;
    }
    function resetPlacement() {
      if (!st.mesh || !st.placementOps.length) return false;
      const ops = st.placementOps.splice(0).reverse();
      const P = st.mesh.positions;
      for (const op of ops) {
        const qi = quatInv(op.q);
        for (let i = 0; i < P.length; i += 3) {
          const v = rotVec(qi, [P[i], P[i + 1], P[i + 2] - op.dz]);
          P[i] = v[0]; P[i + 1] = v[1]; P[i + 2] = v[2];
        }
        mapAnnotationCoords(
          (v) => r3(rotVec(qi, [v[0], v[1], v[2] - op.dz])),
          (v) => r3(rotVec(qi, v))
        );
      }
      rebuildMeshBuffers();
      recomputeTints();
      renderOverlay();
      invalidate();
      if (opts.onPlacement) opts.onPlacement(null);
      if (opts.onHint) opts.onHint('已复位到原始摆放');
      return true;
    }
    function getPlacement() {
      if (!st.placementOps.length) return null;
      let q = [0, 0, 0, 1];
      for (const op of st.placementOps) q = quatMul(op.q, q); // 顺序应用=后算子左乘
      return q.map((v) => +v.toFixed(6));
    }
    /** 悬停高亮单面（放置模式预览；polygonOffset 防与共面 z-fighting） */
    function drawFaceHi(face) {
      if (face < 0 || face >= st.triCount) return;
      const { mvp } = matrices();
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.enable(gl.DEPTH_TEST);
      gl.uniformMatrix4fv(loc.uMVP, false, new Float32Array(mvp));
      bindAttribs(false);
      gl.uniform1f(loc.uMode, 0);
      gl.uniform3f(loc.uColor, 0.2, 0.88, 0.5);
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(-1, -1);
      gl.drawArrays(gl.TRIANGLES, face * 3, 3);
      gl.disable(gl.POLYGON_OFFSET_FILL);
    }

    /** 鼠标 → 世界射线（与 MAT.lookAt 的相机基一致） */
    function screenRay(e) {
      const rect = canvas.getBoundingClientRect();
      const sx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const sy = 1 - ((e.clientY - rect.top) / rect.height) * 2;
      const { eye } = matrices();
      const n = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
      const fwd = n([st.center[0] - eye[0], st.center[1] - eye[1], st.center[2] - eye[2]]);
      const z = n([eye[0] - st.center[0], eye[1] - st.center[1], eye[2] - st.center[2]]);
      const x = n([0 * z[2] - 1 * z[1], 1 * z[0] - 0 * z[2], 0 * z[1] - 0 * z[0]]); // up(0,0,1) × z
      const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
      const tf = Math.tan(0.45); // fov/2（与 MAT.perspective 同值）
      const aspect = canvas.width / canvas.height;
      const dir = n([
        fwd[0] + x[0] * sx * tf * aspect + y[0] * sy * tf,
        fwd[1] + x[1] * sx * tf * aspect + y[1] * sy * tf,
        fwd[2] + x[2] * sx * tf * aspect + y[2] * sy * tf,
      ]);
      return { origin: eye, dir };
    }

    /** 射线 × 三角面（Möller–Trumbore），命中返回精确交点 */
    function rayTriangle(ray, face) {
      const f = st.mesh.faces, P = st.mesh.positions;
      const i0 = f[face * 3] * 3, i1 = f[face * 3 + 1] * 3, i2 = f[face * 3 + 2] * 3;
      const a = [P[i0], P[i0 + 1], P[i0 + 2]], b = [P[i1], P[i1 + 1], P[i1 + 2]], c = [P[i2], P[i2 + 1], P[i2 + 2]];
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const p = [ray.dir[1] * e2[2] - ray.dir[2] * e2[1], ray.dir[2] * e2[0] - ray.dir[0] * e2[2], ray.dir[0] * e2[1] - ray.dir[1] * e2[0]];
      const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
      if (Math.abs(det) < 1e-9) return null;
      const inv = 1 / det;
      const t0 = [ray.origin[0] - a[0], ray.origin[1] - a[1], ray.origin[2] - a[2]];
      const u = (t0[0] * p[0] + t0[1] * p[1] + t0[2] * p[2]) * inv;
      if (u < -1e-4 || u > 1 + 1e-4) return null;
      const q = [t0[1] * e1[2] - t0[2] * e1[1], t0[2] * e1[0] - t0[0] * e1[2], t0[0] * e1[1] - t0[1] * e1[0]];
      const v = (ray.dir[0] * q[0] + ray.dir[1] * q[1] + ray.dir[2] * q[2]) * inv;
      if (v < -1e-4 || u + v > 1 + 1e-4) return null;
      const t = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) * inv;
      if (t < 0) return null;
      return [ray.origin[0] + ray.dir[0] * t, ray.origin[1] + ray.dir[1] * t, ray.origin[2] + ray.dir[2] * t];
    }

    /** 射线 × 物理平面（过 point、法向 normal）——线标注第二点的严格约束 */
    function rayPlane(ray, point, normal) {
      const denom = ray.dir[0] * normal[0] + ray.dir[1] * normal[1] + ray.dir[2] * normal[2];
      if (Math.abs(denom) < 1e-6) return null; // 射线与平面平行
      const t = ((point[0] - ray.origin[0]) * normal[0] + (point[1] - ray.origin[1]) * normal[1] + (point[2] - ray.origin[2]) * normal[2]) / denom;
      if (t < 0) return null;
      return [ray.origin[0] + ray.dir[0] * t, ray.origin[1] + ray.dir[1] * t, ray.origin[2] + ray.dir[2] * t];
    }

    canvas.addEventListener('click', (e) => {
      if (readonly) return; // 只读预览（审批台）：不创建标注、不进放置模式
      // 放置平面模式（2026-10-16）：点面 → 该面朝下落到盘面；不参与标注选中/放置
      if (st.placementArmed) {
        if (moved > 6 || !st.mesh) return;
        const rectP = canvas.getBoundingClientRect();
        const pxP = Math.round((e.clientX - rectP.left) * (canvas.width / rectP.width));
        const pyP = Math.round(canvas.height - (e.clientY - rectP.top) * (canvas.height / rectP.height));
        if (pxP < 0 || pyP < 0 || pxP >= canvas.width || pyP >= canvas.height) return;
        const faceP = pickFace(pxP, pyP);
        if (faceP >= 0) applyPlacement(faceP);
        else if (opts.onHint) opts.onHint('没有点到模型表面——对准某个面再点一下');
        return;
      }
      if (moved > 6 || !st.mesh || !st.tool) return;
      const rectC = canvas.getBoundingClientRect();
      const cssX = e.clientX - rectC.left, cssY = e.clientY - rectC.top;
      const tool = tools.find((t) => t.id === st.tool);
      // 选择路由：命中已有标注 → 选中（进入编辑态）；未命中继续放置
      const picked = pickAnnotationAtScreen(cssX, cssY);
      if (picked) {
        st.selectedId = picked._aid;
        renderOverlay();
        if (opts.onSelect) opts.onSelect(picked);
        return;
      }
      const hit = surfacePoint(e);
      if (!hit) { st.selectedId = null; renderOverlay(); if (opts.onSelect) opts.onSelect(null); return; }
      ensureTopology();

      // 悬空需支撑（v1.9，曼波定义）：点一面 = 平滑连通区（曲面渐变也算同一个
      // 面），区内**悬垂带**（朝下、法线与 −Z 夹角 ≤25°=重悬空带、非贴底）染红、
      // 其余淡蓝——口径与 modelFeatures.overhangSevereDeg 一致。
      // Shift+点击 = 并入「同一特征」的其他悬垂面。特征口径（曼波定）：
      //   朝向相同（与种子悬垂带平均法线夹角 ≤30°）且至少一个坐标方向相同
      //   （包围盒在某轴上重叠，容差 2% span），传递闭包——一排同高度的孔、
      //   同一高度被筋隔开的面都会被收进来。
      if (tool && tool.shape === 'support_region') {
        const N = faceGeom.n;
        const cosSevere = Math.cos((25 * Math.PI) / 180);
        const isOverhang = (f) => !faceGeom.onPlate(f) && -(N[f * 3 + 2]) >= cosSevere;
        let faces = floodSmooth(hit.face, 25, 60); // 60° 锥：孔壁/圆角不爬圈（v2.1 曼波浅蓝溢出反馈）
        let supportFaces = faces.filter(isOverhang);
        if (!supportFaces.length) {
          if (opts.onHint) opts.onHint('这个面未检出悬垂部位（判定：朝下、与 −Z 夹角 ≤25°、非贴底）——请点悬垂面， Shift 可全模型找同类');
          return;
        }
        if (e.shiftKey) {
          // Shift = 精准批量：种子只保留悬垂带本身，不带淡蓝底（v2.1 曼波反馈）
          faces = supportFaces.slice();
        }
        if (e.shiftKey) {
          let ax = 0, ay = 0, az = 0;
          for (const f of supportFaces) { ax += N[f * 3]; ay += N[f * 3 + 1]; az += N[f * 3 + 2]; }
          const al = Math.hypot(ax, ay, az) || 1;
          const cosOri = Math.cos((30 * Math.PI) / 180);
          const seedSet = new Set(faces);
          const cand = [];
          for (let t = 0; t < st.triCount; t++) {
            if (seedSet.has(t) || !isOverhang(t)) continue;
            if ((N[t * 3] * ax + N[t * 3 + 1] * ay + N[t * 3 + 2] * az) / al < cosOri) continue;
            cand.push(t);
          }
          const noFeature = () => { if (opts.onHint) opts.onHint('Shift：模型上没有同特征（朝向相同 + 至少一轴对齐）的其他悬垂面'); };
          if (cand.length) {
            // 单轴区间扫掠 + 并查集求传递闭包（视图网格可达 12 万面，两两暴力不可行）：
            // 按某轴 lo 排序后，当前面与「历史最大 hi」的持有者必重叠 → 并入即可传递
            const all = [...supportFaces, ...cand];
            const parent = all.map((_, i) => i);
            const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
            const uni = (i, j) => { const a = find(i), b = find(j); if (a !== b) parent[b] = a; };
            const boxes = new Map();
            const boxOf = (f) => {
              let b = boxes.get(f);
              if (!b) {
                const F = st.mesh.faces, P = st.mesh.positions;
                b = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity];
                for (let k = 0; k < 3; k++) {
                  const i = F[f * 3 + k] * 3;
                  if (P[i] < b[0]) b[0] = P[i]; if (P[i] > b[1]) b[1] = P[i];
                  if (P[i + 1] < b[2]) b[2] = P[i + 1]; if (P[i + 1] > b[3]) b[3] = P[i + 1];
                  if (P[i + 2] < b[4]) b[4] = P[i + 2]; if (P[i + 2] > b[5]) b[5] = P[i + 2];
                }
                boxes.set(f, b);
              }
              return b;
            };
            const tol = st.span * 0.02;
            for (let axis = 0; axis < 3; axis++) {
              const lo = axis * 2, hi = axis * 2 + 1;
              const order = all.map((_, i) => i).sort((i, j) => boxOf(all[i])[lo] - boxOf(all[j])[lo]);
              let maxHi = -Infinity, arg = -1;
              for (const i of order) {
                const b = boxOf(all[i]);
                if (arg >= 0 && b[lo] - tol <= maxHi) uni(i, arg);
                if (b[hi] > maxHi) { maxHi = b[hi]; arg = i; }
              }
            }
            const seedRoots = new Set(supportFaces.map((_, i) => find(i))); // all 前 seedSupport.length 个就是种子
            const feat = [];
            for (let i = 0; i < all.length; i++) {
              if (seedRoots.has(find(i)) && !seedSet.has(all[i])) feat.push(all[i]);
            }
            if (feat.length) {
              // v2.1：只并入选中的悬垂面本身——不再把它们各自的平滑片拖进来当
              // 淡蓝底（曼波反馈：Shift 后孔壁一大片浅蓝不可预期）。feat 全部
              // 过过 isOverhang，直接红染
              for (const f of feat) { faces.push(f); supportFaces.push(f); }
              if (opts.onHint) opts.onHint('Shift：已并入同特征悬垂面 ' + feat.length + ' 面（朝向相同 + 至少一轴对齐）');
            } else noFeature();
          } else noFeature();
        }
        // 同工具点击染色区内【任意面】= 取消该标注（v2.1 前 only 认种子三角，
        // 点区内其他面毫无反应——曼波「取消选中点击还是没有用」）
        const existing = st.annotations.find((a) => a.type === 'region' && a.tool === st.tool && (a.seed === hit.face || a.faces.includes(hit.face)));
        if (existing) {
          snapshot();
          if (st.selectedId === existing._aid) st.selectedId = null;
          st.annotations.splice(st.annotations.indexOf(existing), 1);
          recomputeTints();
          renderOverlay();
          if (opts.onChange) opts.onChange(getAnnotations());
          return;
        }
        snapshot();
        pushAnnotation({
          tool: st.tool, type: 'region', faces, supportFaces, seed: hit.face,
          normal: [N[hit.face * 3], N[hit.face * 3 + 1], N[hit.face * 3 + 2]].map((v) => +v.toFixed(3)),
          ...(e.shiftKey ? { shift: true } : {}),
        });
        recomputeTints();
        renderOverlay();
        if (opts.onChange) opts.onChange(getAnnotations());
        return;
      }

      // 受弯轴线（两点式，物理面约束）：两点都必须落在【同一物理面】上——
      // 第二点 = 鼠标射线打到模型表面、且与第一点共面（距第一点平面 ≤0.3mm）
      // 的精确交点。线永远贴在面上：不穿内部、不出面边界。
      if (tool && tool.shape === 'axis2') {
        if (!st.pendingLine) {
          st.pendingLine = {
            a: hit.pos, face: hit.face,
            planePoint: hit.pos, planeNormal: hit.normal,
            cursor: hit.pos, cursorValid: false,
          };
          renderOverlay();
          if (opts.onHint) opts.onHint('受弯轴线：在【同一物理面】上再点一点收线（Esc/右键取消）');
          return;
        }
        // 第二点校验（v1.7.2）：必须在【第一点所在平面】内——平面 = 过第一点、
        // 法向取第一面的法线。此前误用第二面自身法向（自己验自己恒过），跨面乱点全能成线
        const offPlane = Math.abs(
          (hit.pos[0] - st.pendingLine.a[0]) * st.pendingLine.planeNormal[0] +
          (hit.pos[1] - st.pendingLine.a[1]) * st.pendingLine.planeNormal[1] +
          (hit.pos[2] - st.pendingLine.a[2]) * st.pendingLine.planeNormal[2]
        );
        if (e.shiftKey) {
          // Shift：异面点——允许第二点落在其他面上（跨面轴线场景）
        } else if (offPlane > 0.3) {
          if (opts.onHint) opts.onHint('第二点须与第一点在同一物理面上（当前偏离平面 ' + offPlane.toFixed(1) + 'mm）');
          return;
        }
        snapshot();
        pushAnnotation({ tool: st.tool, type: 'line', a: st.pendingLine.a, b: hit.pos });
        st.pendingLine = null;
        renderOverlay();
        if (opts.onChange) opts.onChange(getAnnotations());
        return;
      }
      // 面区域统一逻辑（2026-10-13 曼波定：以受压区为准）：受压区/接触面/外观面
      // 全部走法向轴向连通洪波（与种子面法线平行 ±64° 内的连通面集）。原接触/外观
      // 的「平滑连通片」洪波会沿曲面渐变爬到种子法向之外，识别结果不可预期。
      if (tool && tool.shape === 'axis_region') {
        const faces = floodRegion(hit.face, predAxis);
        // 同 seed 同工具 = 取消该标注；不同角色在共享面上并行共存（染色取平均）
        // 同工具点击染色区内任意面 = 取消（与受压区/接触面/外观面统一手势）
        const existing = st.annotations.find((a) => (a.type === 'region' || a.type === 'survey') && a.tool === st.tool && (a.seed === hit.face || a.faces.includes(hit.face)));
        if (existing) {
          snapshot();
          if (st.selectedId === existing._aid) st.selectedId = null;
          st.annotations.splice(st.annotations.indexOf(existing), 1);
          recomputeTints();
          renderOverlay();
          if (opts.onChange) opts.onChange(getAnnotations());
          return;
        }
        snapshot();
        pushAnnotation({
          tool: st.tool, type: 'region', faces, seed: hit.face,
          normal: [faceGeom.n[hit.face * 3], faceGeom.n[hit.face * 3 + 1], faceGeom.n[hit.face * 3 + 2]].map((v) => +v.toFixed(3)),
        });
        recomputeTints();
        renderOverlay();
        if (opts.onChange) opts.onChange(getAnnotations());
        return;
      }

      // 载荷标注（方向+类型空间化）：点一面 = 力从该面法向压入；箭头即受力方向
      if (tool && tool.shape === 'load') {
        ensureTopology();
        const loadType = (typeof opts.getLoadType === 'function' ? opts.getLoadType() : st.loadType) || 'compression';
        const n = faceNormalOf(hit.face);
        const auto = [-n[0], -n[1], -n[2]].map((v) => +v.toFixed(3)); // 默认：力压入面 = -法向
        let dir = auto;
        if (typeof opts.getLoadDir === 'function') {
          const ov = opts.getLoadDir(); // '' = 按面自动；否则 ±X/±Y/±Z 轴向覆盖
          if (ov) {
            const sign = ov[0] === '-' ? -1 : 1;
            const axis = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] }[ov[ov.length - 1]];
            if (axis) dir = axis.map((v) => v * sign);
          }
        }
        snapshot();
        pushAnnotation({ tool: 'load', type: 'load', loadType, pos: hit.pos, dir, face: hit.face, loadNature: (typeof opts.getLoadNature === 'function' ? opts.getLoadNature() : null), loadMagnitude: (typeof opts.getLoadMagnitude === 'function' ? opts.getLoadMagnitude() : null) });
        renderOverlay();
        if (opts.onChange) opts.onChange(getAnnotations());
        return;
      }

      // 点标注（自由标注附备注）
      let note;
      if (st.tool === 'pin') note = prompt('自由标注备注（这条标注要说明什么？）') || '';
      snapshot();
        pushAnnotation({ tool: st.tool, type: 'point', pos: hit.pos, face: hit.face, ...(note ? { note } : {}) });
      renderOverlay();
      if (opts.onChange) opts.onChange(getAnnotations());
    });
    canvas.addEventListener('contextmenu', (e) => {
      if (st.pendingLine) { e.preventDefault(); st.pendingLine = null; renderOverlay(); if (opts.onHint) opts.onHint('已取消受弯轴线'); }
    });
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && !/INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || '')) {
        const k = e.key.toLowerCase();
        if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
        if (k === 'z' && e.shiftKey) { e.preventDefault(); redo(); return; } // Ctrl+Shift+Z
        if (k === 'y') { e.preventDefault(); redo(); return; } // Ctrl+Y
      }
      if (e.key === 'Escape' && st.pendingLine) { st.pendingLine = null; renderOverlay(); if (opts.onHint) opts.onHint('已取消受弯轴线'); }
      if (e.key === 'Escape' && st.placementArmed) { st.placementArmed = false; invalidate(); if (opts.onPlacementMode) opts.onPlacementMode(false); if (opts.onHint) opts.onHint('已取消放置平面'); }
    });

    window.addEventListener('resize', () => {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (w && h && (canvas.width !== w || canvas.height !== h)) { canvas.width = w; canvas.height = h; invalidate(); }
    });
    canvas.width = canvas.clientWidth || 600;
    canvas.height = canvas.clientHeight || 380;
    requestAnimationFrame(render);

    return {
      loadMesh,
      setTool: (id) => {
        st.tool = id;
        st.pendingLine = null;
        // 选标注工具即退出放置模式（互斥，防误点面旋转）
        if (st.placementArmed) { st.placementArmed = false; if (opts.onPlacementMode) opts.onPlacementMode(false); invalidate(); }
      },
      armPlacement: () => {
        st.placementArmed = true;
        st.pendingLine = null;
        invalidate();
        if (opts.onPlacementMode) opts.onPlacementMode(true);
        if (opts.onHint) opts.onHint('放置平面：点一个面，该面将朝下贴盘（Esc 取消）');
        return true;
      },
      cancelPlacement: () => {
        st.placementArmed = false;
        invalidate();
        if (opts.onPlacementMode) opts.onPlacementMode(false);
      },
      isPlacementArmed: () => st.placementArmed,
      hasPlacement: () => st.placementOps.length > 0,
      getPlacement,
      resetPlacement,
      flipLastLoad: () => {
        for (let i = st.annotations.length - 1; i >= 0; i--) {
          if (st.annotations[i].type === 'load') {
            st.annotations[i].dir = st.annotations[i].dir.map((v) => -v);
            invalidate();
            if (opts.onChange) opts.onChange(getAnnotations());
            return true;
          }
        }
        return false;
      },
      setLoadType: (t) => { st.loadType = t; },
      setCircleCandidates: (circles) => { st.circleCandidates = circles || []; invalidate(); },
      /** Z 轴截面（2026-10-18 审批台预览）：传世界坐标 z 裁剪其上方；null 取消裁剪 */
      setClipZ: (z) => {
        st.clipZ = z == null || z === '' || !Number.isFinite(Number(z)) ? null : Number(z);
        invalidate();
        return st.clipZ;
      },
      getAnnotations,
      undo: () => undo(),
      redo: () => redo(),
      updateAnnotation: (_aid, changes) => {
        snapshot();
        const a = st.annotations.find((x) => x._aid === _aid);
        if (!a) return null;
        if (changes.loadType) a.loadType = String(changes.loadType);
        if (changes.dirFlip) a.dir = a.dir.map((v) => -v);
        if (changes.note !== undefined) a.note = String(changes.note).slice(0, 200);
        recomputeTints();
        renderOverlay();
        if (opts.onChange) opts.onChange(getAnnotations());
        return { ...a };
      },
      deleteAnnotation: (_aid) => {
        snapshot();
        const i = st.annotations.findIndex((x) => x._aid === _aid);
        if (i < 0) return null;
        const [rm] = st.annotations.splice(i, 1);
        if (st.selectedId === _aid) st.selectedId = null;
        recomputeTints();
        renderOverlay();
        if (opts.onChange) opts.onChange(getAnnotations());
        return { ...rm };
      },
      selectNone: () => { st.selectedId = null; renderOverlay(); },
      clearSelection: () => { st.selectedId = null; renderOverlay(); },
      clearAnnotations: () => { st.annotations = []; st.pendingLine = null; recomputeTints(); renderOverlay(); },
    };
  };
})();
