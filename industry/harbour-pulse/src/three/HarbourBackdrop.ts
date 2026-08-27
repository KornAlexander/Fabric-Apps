import * as THREE from 'three';

/**
 * Daytime Sydney-harbour backdrop for the ferry popup: a graded sky, a large
 * animated water plane with a bow wake, and a ring of foreshore scenery — a
 * city skyline, the Harbour Bridge, the Opera House and green headlands with
 * apartments and trees — so the vessel reads as sailing on the harbour from any
 * orbit angle. Built from simple boxes/prims to stay lightweight.
 */
export class HarbourBackdrop {
  readonly group = new THREE.Group();
  readonly sky: THREE.Texture;
  private readonly water: THREE.Mesh;
  private readonly base: Float32Array;
  private readonly wake: THREE.Group;
  private readonly disposables: (THREE.BufferGeometry | THREE.Material)[] = [];

  constructor() {
    this.sky = this.makeSky();
    this.water = this.makeWater();
    this.group.add(this.water);
    this.wake = this.makeWake();
    this.group.add(this.wake);
    this.buildShore();
    this.base = (this.water.geometry.getAttribute('position').array as Float32Array).slice();
  }

  /** Ripple the water surface and pulse the wake foam. */
  update(t: number): void {
    const pos = this.water.geometry.getAttribute('position') as THREE.BufferAttribute;
    const a = pos.array as Float32Array;
    const b = this.base;
    for (let i = 0; i < a.length; i += 3) {
      const x = b[i];
      const y = b[i + 1];
      a[i + 2] =
        Math.sin(x * 0.05 + t * 1.3) * 0.55 +
        Math.cos(y * 0.07 + t * 1.7) * 0.4 +
        Math.sin((x + y) * 0.11 + t * 2.3) * 0.2;
    }
    pos.needsUpdate = true;
    this.water.geometry.computeVertexNormals();
    this.wake.scale.z = 1 + Math.sin(t * 3) * 0.06;
  }

  dispose(): void {
    this.sky.dispose();
    for (const d of this.disposables) d.dispose();
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    });
  }

  // --- Sky, water, wake ------------------------------------------------------

  private makeSky(): THREE.Texture {
    const c = document.createElement('canvas');
    c.width = 16;
    c.height = 256;
    const g = c.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#6ea9e6');
    grad.addColorStop(0.55, '#a9cef0');
    grad.addColorStop(0.8, '#d8e8f5');
    grad.addColorStop(1, '#eef4f8');
    g.fillStyle = grad;
    g.fillRect(0, 0, 16, 256);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private makeWater(): THREE.Mesh {
    const geo = new THREE.PlaneGeometry(720, 720, 96, 96);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x1f6f93,
      roughness: 0.32,
      metalness: 0.4,
    });
    this.disposables.push(geo, mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = -0.6;
    mesh.receiveShadow = true;
    return mesh;
  }

  private makeWake(): THREE.Group {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({
      color: 0xeaf6ff,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    });
    this.disposables.push(mat);
    const streak = (x: number, rot: number) => {
      const geo = new THREE.PlaneGeometry(6, 34);
      this.disposables.push(geo);
      const p = new THREE.Mesh(geo, mat);
      p.rotation.x = -Math.PI / 2;
      p.rotation.z = rot;
      p.position.set(x, -0.5, 22);
      g.add(p);
    };
    streak(-4, 0.28);
    streak(4, -0.28);
    const churnGeo = new THREE.PlaneGeometry(14, 12);
    this.disposables.push(churnGeo);
    const churn = new THREE.Mesh(churnGeo, mat);
    churn.rotation.x = -Math.PI / 2;
    churn.position.set(0, -0.5, -22);
    g.add(churn);
    return g;
  }

  // --- Shoreline scenery -----------------------------------------------------

  private buildShore(): void {
    const land = new THREE.Mesh(
      new THREE.RingGeometry(185, 540, 64),
      new THREE.MeshStandardMaterial({ color: 0x53663a, roughness: 1 }),
    );
    this.disposables.push(land.geometry as THREE.BufferGeometry, land.material as THREE.Material);
    land.rotation.x = -Math.PI / 2;
    land.position.y = -0.25;
    land.receiveShadow = true;
    this.group.add(land);

    // A full ring of low-rise foreshore apartments with the odd tree.
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      const r = 210 + this.rand(i) * 40;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const h = 14 + this.rand(i * 7) * 30;
      const w = 12 + this.rand(i * 3) * 16;
      const warm = this.rand(i * 11) > 0.5;
      this.building(x, z, w, h, w * 0.8, warm ? 0xcdbfa4 : 0xb9c2c9, a, warm ? 0x8a4a3a : 0x2b3a44);
      if (this.rand(i * 5) > 0.7) this.tree(x + Math.cos(a) * 12, z + Math.sin(a) * 12);
    }

    this.cityCluster(Math.PI * 0.5, 205);
    this.harbourBridge(Math.PI * 0.5 + 0.55, 190);
    this.operaHouse(Math.PI * 0.5 + 0.9, 178);
  }

  /** A box building facing the harbour centre, with a tinted glazing crown. */
  private building(
    x: number,
    z: number,
    w: number,
    h: number,
    d: number,
    color: number,
    face: number,
    roof: number,
  ): void {
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color, roughness: 0.85 }),
    );
    this.disposables.push(body.geometry as THREE.BufferGeometry, body.material as THREE.Material);
    body.position.set(x, h / 2 - 0.3, z);
    body.rotation.y = -face;
    body.castShadow = true;
    body.receiveShadow = true;
    this.group.add(body);
    const crown = new THREE.Mesh(
      new THREE.BoxGeometry(w * 0.98, h * 0.42, d * 0.98),
      new THREE.MeshStandardMaterial({ color: roof, roughness: 0.4, metalness: 0.3 }),
    );
    this.disposables.push(crown.geometry as THREE.BufferGeometry, crown.material as THREE.Material);
    crown.position.set(x, h * 0.72, z);
    crown.rotation.y = -face;
    this.group.add(crown);
  }

  private tree(x: number, z: number): void {
    const foliage = new THREE.Mesh(
      new THREE.ConeGeometry(4.5, 12, 7),
      new THREE.MeshStandardMaterial({ color: 0x3f6b34, roughness: 1 }),
    );
    this.disposables.push(
      foliage.geometry as THREE.BufferGeometry,
      foliage.material as THREE.Material,
    );
    foliage.position.set(x, 6, z);
    foliage.castShadow = true;
    this.group.add(foliage);
  }

  /** A tight cluster of tall CBD towers, a couple in blue glass. */
  private cityCluster(angle: number, radius: number): void {
    const cx = Math.cos(angle) * radius;
    const cz = Math.sin(angle) * radius;
    for (let i = 0; i < 12; i++) {
      const off = (i - 6) * 11;
      const px = cx + Math.cos(angle + Math.PI / 2) * off;
      const pz = cz + Math.sin(angle + Math.PI / 2) * off;
      const h = 45 + this.rand(i * 13) * 55;
      const glass = this.rand(i * 17) > 0.55;
      this.building(
        px,
        pz,
        9 + this.rand(i) * 6,
        h,
        9,
        glass ? 0x6f93b8 : 0xa7adb4,
        angle,
        glass ? 0x415f80 : 0x6a7076,
      );
    }
    // A slim spire to stand in for the tallest tower.
    const spire = new THREE.Mesh(
      new THREE.CylinderGeometry(0.6, 1.4, 30, 8),
      new THREE.MeshStandardMaterial({ color: 0xc9cdd2, roughness: 0.5 }),
    );
    this.disposables.push(spire.geometry as THREE.BufferGeometry, spire.material as THREE.Material);
    spire.position.set(cx, 110, cz);
    this.group.add(spire);
  }

  /** A steel through-arch bridge: an arch, deck and two sandstone pylons. */
  private harbourBridge(angle: number, radius: number): void {
    const g = new THREE.Group();
    const cx = Math.cos(angle) * radius;
    const cz = Math.sin(angle) * radius;
    const steel = new THREE.MeshStandardMaterial({ color: 0x8a9096, roughness: 0.6, metalness: 0.4 });
    const stone = new THREE.MeshStandardMaterial({ color: 0xc9b892, roughness: 0.9 });
    this.disposables.push(steel, stone);
    const span = 130;
    const rise = 34;
    const seg = 14;
    for (let i = 0; i < seg; i++) {
      const t0 = i / seg;
      const t1 = (i + 1) / seg;
      const y0 = Math.sin(t0 * Math.PI) * rise + 12;
      const y1 = Math.sin(t1 * Math.PI) * rise + 12;
      const x0 = (t0 - 0.5) * span;
      const x1 = (t1 - 0.5) * span;
      const len = Math.hypot(x1 - x0, y1 - y0);
      const geo = new THREE.BoxGeometry(len, 3, 4);
      this.disposables.push(geo);
      const m = new THREE.Mesh(geo, steel);
      m.position.set((x0 + x1) / 2, (y0 + y1) / 2, 0);
      m.rotation.z = Math.atan2(y1 - y0, x1 - x0);
      m.castShadow = true;
      g.add(m);
    }
    const deckGeo = new THREE.BoxGeometry(span + 30, 3, 8);
    this.disposables.push(deckGeo);
    const deck = new THREE.Mesh(deckGeo, steel);
    deck.position.set(0, 11, 0);
    g.add(deck);
    for (const s of [-1, 1]) {
      const pyGeo = new THREE.BoxGeometry(12, 30, 12);
      this.disposables.push(pyGeo);
      const py = new THREE.Mesh(pyGeo, stone);
      py.position.set((s * (span + 20)) / 2, 15, 0);
      py.castShadow = true;
      g.add(py);
    }
    g.position.set(cx, 0, cz);
    g.rotation.y = -angle + Math.PI / 2;
    this.group.add(g);
  }

  /** The Opera House: a stepped podium under a fan of white sail shells. */
  private operaHouse(angle: number, radius: number): void {
    const g = new THREE.Group();
    const cx = Math.cos(angle) * radius;
    const cz = Math.sin(angle) * radius;
    const white = new THREE.MeshStandardMaterial({ color: 0xf1f0ea, roughness: 0.5 });
    const base = new THREE.MeshStandardMaterial({ color: 0x9a8f7d, roughness: 0.9 });
    this.disposables.push(white, base);
    const podGeo = new THREE.BoxGeometry(64, 8, 30);
    this.disposables.push(podGeo);
    const pod = new THREE.Mesh(podGeo, base);
    pod.position.set(0, 4, 0);
    g.add(pod);
    const shell = (x: number, s: number, tilt: number) => {
      const geo = new THREE.SphereGeometry(s, 16, 12, 0, Math.PI, 0, Math.PI / 2);
      this.disposables.push(geo);
      const m = new THREE.Mesh(geo, white);
      m.scale.set(0.5, 1.4, 1);
      m.position.set(x, 8, 0);
      m.rotation.y = tilt;
      m.castShadow = true;
      g.add(m);
    };
    let x = -22;
    for (const s of [12, 15, 12, 9]) {
      shell(x, s, 0.15);
      shell(x + 4, s * 0.7, -2.9);
      x += 15;
    }
    g.position.set(cx, 0, cz);
    g.rotation.y = -angle + Math.PI / 2;
    this.group.add(g);
  }

  /** Deterministic pseudo-random in [0,1) so the skyline stays stable. */
  private rand(n: number): number {
    const s = Math.sin(n * 127.1 + 11.7) * 43758.5453;
    return s - Math.floor(s);
  }
}
