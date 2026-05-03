(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const GROUND_Y = H - 60;

  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const ammoEl = document.getElementById('ammo');
  const overlay = document.getElementById('overlay');

  // Entity colors — fixed across biomes (the ninja is always the ninja).
  const COLOR = {
    ninjaBody: '#1a1a1a',
    ninjaBand: '#c0392b',
    ninjaFace: '#e6d9b8',
    zombie: '#6aa84f',
    zombieDark: '#3d6b2a',
    zombieShirt: '#7a4a3a',
    eyeball: '#f4f4f4',
    eyeIris: '#1a1a1a',
    eyeVein: '#c0392b',
    kunai: '#3a3a3a',
    kunaiTip: '#cfcfcf',
  };

  // Biome configs — palette + parallax style + ground/ceiling renderers.
  // Cycled every BIOME_DISTANCE_M meters.
  const BIOME_DISTANCE_M = 500;
  const BIOMES = [
    {
      name: 'forest',
      sky: '#b8c8d4',
      grass: '#5fb04a',
      grassDark: '#3e8a35',
      soil: '#7a4a2b',
      soilDark: '#5e361d',
      far:  { kind: 'hills', mult: 0.18, color: '#9eb1c2', count: 5, baseH: 70, varH: 25 },
      near: { kind: 'hills', mult: 0.42, color: '#6b8aa3', count: 7, baseH: 50, varH: 18 },
      hasCeiling: false,
      groundKind: 'forest',
    },
    {
      // Dojo: tatami floor + shoji walls + Mt Fuji visible through opening, cherry blossoms above.
      name: 'dojo',
      sky: '#b8c0c8',                  // cloudy gray (sky visible through center opening)
      grass: '#d99655',                // top edge of tatami mat
      grassDark: '#7a4a1f',            // shadow seam under mat edge
      soil: '#c98545',                 // tatami body (warm tan)
      soilDark: '#5a3a18',             // grid lines between mats
      far:  { kind: 'mountains', mult: 0.18, color: '#5a6b7a', count: 4, baseH: 95,  varH: 30 },
      near: { kind: 'shoji',     mult: 0.42, color: '#c98545', count: 3, baseH: 160, varH: 0  },
      hasCeiling: true,
      groundKind: 'dojo',
    },
  ];
  let currentBiome = 0;
  let curtain = null;              // active transition curtain (or null)

  // --- Game feel constants -------------------------------------------------
  const GRAVITY = 2200;          // px/s^2
  const JUMP_V  = -720;          // initial jump velocity (apex ≈ 118px, tight enough that mistiming punishes)
  const JUMP_CUT = 0.45;         // multiplier when releasing jump early (variable height)
  const COYOTE_MS = 90;
  const BUFFER_MS = 110;
  const SLIDE_MS  = 480;
  const HITSTOP_MS = 280;

  const START_SPEED = 320;       // px/s scroll
  const MAX_SPEED   = 760;
  const SPEED_RAMP  = 6;         // +px/s per second
  const SPAWN_MIN_MS_START = 900;
  const SPAWN_MIN_MS_END   = 420;
  const KUNAI_SPEED = 720;
  const KUNAI_START = 3;
  const KUNAI_MAX = 3;
  const KUNAI_COOLDOWN_S = 8;          // continuous regen: +1 every 8s while below max
  const PICKUP_MIN_S = 6;
  const PICKUP_MAX_S = 14;
  const PICKUP_LOW_AMMO_BIAS = 0.55;   // shrink interval when low/empty
  const PICKUP_MAGNET_R = 95;          // px — magnet kicks in when player center is within this
  const PICKUP_MAGNET_PULL = 360;      // px/s max pull velocity at closest range

  const THROWER_BASE_P = 0.30;         // chance of zombie being a thrower at start of run
  const THROWER_MAX_P  = 0.55;         // ...at max speed
  const THROWER_TRIGGER_X = 0.80;      // throw earlier (was 0.70) → longer flight distance
  const THROWER_WINDUP_S = 0.45;
  const ENEMY_SHURIKEN_VX = -160;      // world-coord velocity. With scroll-with-world,
                                        // screen velocity = vx - game_speed, so it's always
                                        // faster than the world (visual stays correct) without
                                        // being overwhelming at high game speed.
  const ENEMY_SHURIKEN_Y = 198;        // chest height — jump or slide both clear

  // --- State ---------------------------------------------------------------
  let last = 0, running = false, started = false;
  let speed = START_SPEED;
  let distance = 0;              // pixels traveled
  let best = +localStorage.getItem('ninja_best') || 0;
  bestEl.textContent = `Best: ${Math.floor(best)} m`;

  let player, enemies, kunais, enemyShots, particles, pickups, bgFar, bgNear, ground;
  let lastJumpPress = -9999, lastGround = -9999;
  let nextSpawn = 0, nextPickup = 0, hitstopUntil = 0;
  let kunaiAmmo = KUNAI_START;
  let kunaiCooldown = 0;         // seconds remaining until +1 (only ticks when ammo == 0)
  let displayedScore = -1;       // for tick animation
  let recordBeaten = false;
  let pendingGameOver = null;    // setTimeout id for the game-over overlay (cleared on early retry)

  function reset() {
    speed = START_SPEED;
    distance = 0;
    nextSpawn = 600;
    nextPickup = (PICKUP_MIN_S + Math.random() * (PICKUP_MAX_S - PICKUP_MIN_S)) * 1000;
    hitstopUntil = 0;
    kunaiAmmo = KUNAI_START;
    kunaiCooldown = 0;
    displayedScore = -1;
    recordBeaten = false;
    scoreEl.classList.remove('record');
    bestEl.classList.remove('record');
    player = {
      x: 110,
      y: GROUND_Y - 44,
      w: 30, h: 44,
      vy: 0,
      onGround: true,
      sliding: false,
      slideUntil: 0,
      jumpHeld: false,
      bobT: 0,
      alive: true,
    };
    enemies = [];
    kunais = [];
    enemyShots = [];
    pickups = [];
    particles = [];
    curtain = null;
    // Cancel any in-flight game-over overlay from a death the user just dismissed
    // by pressing Space early — otherwise it'd appear during the new run.
    if (pendingGameOver !== null) {
      clearTimeout(pendingGameOver);
      pendingGameOver = null;
    }
    applyBiome(0);
    ground = 0;
    updateHud();
  }

  function applyBiome(idx) {
    currentBiome = idx;
    const b = BIOMES[idx];
    bgFar = makeLayer(b.far);
    bgNear = makeLayer(b.near);
  }

  function makeLayer(cfg) {
    // Parallax items in screen space; each draw kind has its own width/stride conventions.
    const arr = [];
    let widthBase, widthRange, stride;
    if (cfg.kind === 'hills')          { widthBase = 110; widthRange = 120; stride = W / cfg.count; }
    else if (cfg.kind === 'mountains') { widthBase = 180; widthRange = 80;  stride = W / cfg.count; }
    else if (cfg.kind === 'shoji')     { widthBase = 220; widthRange = 0;   stride = W / cfg.count + 40; }
    else                                { widthBase = 16;  widthRange = 8;   stride = W / cfg.count + 30; }
    for (let i = 0; i < cfg.count; i++) {
      arr.push({
        x: i * stride + Math.random() * 40,
        w: widthBase + Math.random() * widthRange,
        h: cfg.baseH + Math.random() * cfg.varH,
        // Per-item randomness for kind-specific details (snow cap offset, cherry blossom flag, etc.)
        seed: Math.random(),
      });
    }
    return { speedMult: cfg.mult, color: cfg.color, items: arr, kind: cfg.kind };
  }

  // --- Input ---------------------------------------------------------------
  const keys = new Set();
  window.addEventListener('keydown', e => {
    if (['Space','ArrowUp','ArrowDown','KeyX','KeyZ','KeyJ'].includes(e.code)) e.preventDefault();
    if (!started) { startGame(); return; }
    // Auto-repeats are never new actions — block them before any state branch.
    // Without this, holding Space at the moment of death = OS auto-repeats trigger
    // an instant restart before the player even sees the GAME OVER overlay.
    if (e.repeat) return;
    if (!running && player && !player.alive) {
      // Only allow restart once the GAME OVER overlay is actually visible.
      // Pre-overlay (during the 630ms hitstop+delay), the player likely hasn't
      // registered the death yet — accepting input here causes accidental restarts.
      if (!overlay.classList.contains('show')) return;
      if (e.code === 'Space' || e.code === 'Enter') { reset(); running = true; overlay.classList.remove('show'); }
      return;
    }
    keys.add(e.code);
    if (e.code === 'Space' || e.code === 'ArrowUp') {
      lastJumpPress = performance.now();
      player.jumpHeld = true;
    }
    if (e.code === 'ArrowDown') startSlide();
    if (e.code === 'KeyX' || e.code === 'KeyJ') throwKunai();
  });
  window.addEventListener('keyup', e => {
    keys.delete(e.code);
    if (e.code === 'Space' || e.code === 'ArrowUp') {
      player.jumpHeld = false;
      // variable jump height: cut velocity if still rising
      if (player && player.vy < 0) player.vy *= JUMP_CUT;
    }
  });

  function startGame() {
    started = true;
    reset();
    running = true;
    overlay.classList.remove('show');
    last = performance.now();
    requestAnimationFrame(frame);
  }

  // --- Actions -------------------------------------------------------------
  function tryJump() {
    const now = performance.now();
    const buffered = now - lastJumpPress <= BUFFER_MS;
    const coyote = now - lastGround <= COYOTE_MS;
    if (buffered && (player.onGround || coyote) && !player.sliding) {
      player.vy = JUMP_V;
      player.onGround = false;
      lastJumpPress = -9999;
      puff(player.x + player.w / 2, GROUND_Y, 6);
    }
  }
  function startSlide() {
    if (!player.onGround) return;
    if (player.sliding) return;
    player.sliding = true;
    player.slideUntil = performance.now() + SLIDE_MS;
  }
  function throwKunai() {
    if (kunaiAmmo <= 0) return;
    const wasMax = kunaiAmmo === KUNAI_MAX;
    kunaiAmmo--;
    // If we were full, the cooldown clock was idle — start it now so regen resumes.
    // Otherwise, the clock is already mid-tick; let it keep counting.
    if (wasMax) kunaiCooldown = KUNAI_COOLDOWN_S;
    updateHud();
    // Launch from head/headband height so the projectile intersects air enemies (eye, hanger),
    // not just ground zombies. Sliding throws stay low — by design, sliding-shots only hit zombies.
    kunais.push({
      x: player.x + player.w,
      y: player.y + (player.sliding ? 4 : 8),
      vx: KUNAI_SPEED,
      w: 18, h: 6,
      life: 1.6,
    });
  }

  // --- Spawning ------------------------------------------------------------
  function spawn() {
    // Three enemy types — distribution shifts with speed:
    //   zombie (jump): 55% → 40%
    //   eye (slide or precision-jump): 30% → 40%
    //   hanger (slide or kunai — NOT jumpable): 15% → 20%
    const t = Math.min(1, (speed - START_SPEED) / (MAX_SPEED - START_SPEED));
    const zombieP = 0.55 - 0.15 * t;
    const eyeP    = 0.30 + 0.10 * t;
    const r = Math.random();

    if (r < zombieP) {
      // Sometimes pair up zombies for tougher cluster (no throwers in clusters)
      const cluster = Math.random() < 0.18 ? 2 : 1;
      const throwerP = THROWER_BASE_P + (THROWER_MAX_P - THROWER_BASE_P) * t;
      const makeThrower = cluster === 1 && Math.random() < throwerP;
      let xOff = 0;
      for (let i = 0; i < cluster; i++) {
        enemies.push({
          type: 'zombie',
          x: W + 20 + xOff,
          y: GROUND_Y - 38,
          w: 26, h: 38,
          walkT: Math.random() * Math.PI * 2,
          thrower: makeThrower && i === 0,
          hasThrown: false,
          windup: 0,
        });
        xOff += 34;
      }
    } else if (r < zombieP + eyeP) {
      enemies.push({
        type: 'eye',
        x: W + 20,
        y: GROUND_Y - 56,
        w: 26, h: 22,
        bobT: Math.random() * Math.PI * 2,
      });
    } else {
      // Hanger — chain from top of screen, corpse body at jump-apex height.
      // Body bottom must be <= 216 (slide-clear height) and top must be < 102 (jump-apex bottom)
      // so jumping cannot escape it. Slide under or kunai-shoot.
      enemies.push({
        type: 'hanger',
        x: W + 30,
        y: 0,
        w: 26,
        h: GROUND_Y - 30,        // 0 → 210
        bodyTop: 130,            // chain 0..130, body 130..210
        swayT: Math.random() * Math.PI * 2,
      });
    }

    // Schedule next spawn — interval shrinks with speed
    const minMs = SPAWN_MIN_MS_START + (SPAWN_MIN_MS_END - SPAWN_MIN_MS_START) * t;
    nextSpawn = minMs + Math.random() * 500;
  }

  function spawnPickup() {
    // Heights tuned for the trimmed jump arc (apex bottom y ≈ 122):
    //   high — y=120: smack in the apex zone, jump and you'll grab it without precision timing
    //   low  — y=210: chest height, free if you stay standing (sliding passes under)
    const high = Math.random() < 0.7;
    const y = high ? 120 : GROUND_Y - 30;
    pickups.push({
      x: W + 30,
      y,
      r: 14,                      // +3 from before — pickups should feel rewarding, not finicky
      bobT: Math.random() * Math.PI * 2,
      spin: 0,
    });
    // Next interval — biased shorter when player is empty/low
    const lowFactor = kunaiAmmo === 0 ? PICKUP_LOW_AMMO_BIAS
                    : kunaiAmmo === 1 ? (PICKUP_LOW_AMMO_BIAS + 1) / 2
                    : 1;
    const span = (PICKUP_MAX_S - PICKUP_MIN_S) * lowFactor;
    nextPickup = (PICKUP_MIN_S * lowFactor + Math.random() * span) * 1000;
  }

  // --- Particles -----------------------------------------------------------
  function puff(x, y, n = 5) {
    for (let i = 0; i < n; i++) {
      particles.push({
        x, y,
        vx: (Math.random() - 0.5) * 80,
        vy: -Math.random() * 80 - 20,
        life: 0.4 + Math.random() * 0.2,
        r: 2 + Math.random() * 2,
        c: '#dcd0a8',
      });
    }
  }
  function sparkle(x, y) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      particles.push({
        x, y,
        vx: Math.cos(a) * 140,
        vy: Math.sin(a) * 140 - 30,
        life: 0.35 + Math.random() * 0.15,
        r: 2 + Math.random() * 2,
        c: '#ffce4a',
      });
    }
  }

  function bloodPuff(x, y) {
    for (let i = 0; i < 10; i++) {
      particles.push({
        x, y,
        vx: (Math.random() - 0.5) * 220,
        vy: (Math.random() - 1) * 200,
        life: 0.5 + Math.random() * 0.3,
        r: 2 + Math.random() * 2,
        c: i % 2 ? '#3d6b2a' : '#6aa84f',
      });
    }
  }

  // --- Update --------------------------------------------------------------
  function update(dt) {
    if (performance.now() < hitstopUntil) return;

    // speed ramp
    speed = Math.min(MAX_SPEED, speed + SPEED_RAMP * dt);
    const dx = speed * dt;
    distance += dx;

    // kunai cooldown — ticks whenever below max; +1 each time it expires
    if (kunaiAmmo < KUNAI_MAX) {
      kunaiCooldown -= dt;
      if (kunaiCooldown <= 0) {
        kunaiAmmo++;
        kunaiCooldown = kunaiAmmo < KUNAI_MAX ? KUNAI_COOLDOWN_S : 0;
      }
    }

    // input-driven actions
    tryJump();

    // player physics
    player.bobT += dt * 14;
    if (!player.onGround) {
      player.vy += GRAVITY * dt;
      player.y += player.vy * dt;
      if (player.y + player.h >= GROUND_Y) {
        player.y = GROUND_Y - player.h;
        player.vy = 0;
        player.onGround = true;
        lastGround = performance.now();
      }
    } else {
      lastGround = performance.now();
    }
    if (player.sliding && performance.now() > player.slideUntil) {
      player.sliding = false;
    }

    // background — both layers are kind-agnostic (items have x/w/h)
    for (const h of bgFar.items) {
      h.x -= speed * bgFar.speedMult * dt;
      if (h.x + h.w < 0) h.x += W + h.w + 20;
    }
    for (const h of bgNear.items) {
      h.x -= speed * bgNear.speedMult * dt;
      if (h.x + h.w < 0) h.x += W + h.w + 20;
    }
    ground -= dx;   // absolute scroll offset; each ground renderer mods it as needed

    // Biome transition — every BIOME_DISTANCE_M meters, swap to the next biome.
    // The curtain entity scrolls past faster than the world; biome flips when it crosses player.
    // Clamp m to >= 0: a negative-dt frame at startup once produced m=-1 →
    // expectedBiome=-1 → applyBiome(-1) crash. Defensive belt-and-suspenders.
    const m = Math.max(0, Math.floor(distance / 10));
    const expectedBiome = Math.floor(m / BIOME_DISTANCE_M) % BIOMES.length;
    if (expectedBiome !== currentBiome && !curtain) {
      curtain = {
        x: W + 30,
        w: 75,
        target: expectedBiome,
        from: currentBiome,
        swapped: false,
      };
    }
    if (curtain) {
      curtain.x -= (speed + 240) * dt;   // travels faster than the world for a deliberate wipe
      const playerCenter = player.x + player.w / 2;
      const curtainCenter = curtain.x + curtain.w / 2;
      if (!curtain.swapped && curtainCenter < playerCenter) {
        applyBiome(curtain.target);
        curtain.swapped = true;
      }
      if (curtain.x + curtain.w + 20 < 0) curtain = null;
    }

    // spawn enemies
    nextSpawn -= dt * 1000;
    if (nextSpawn <= 0) spawn();

    // spawn pickups — interval shrinks when ammo is low/empty so you're never stuck
    nextPickup -= dt * 1000;
    if (nextPickup <= 0) spawnPickup();

    // enemies
    for (const e of enemies) {
      e.x -= dx;
      if (e.type === 'eye') {
        e.bobT += dt * 5;
        e.y = GROUND_Y - 56 + Math.sin(e.bobT) * 6;
      } else if (e.type === 'hanger') {
        e.swayT += dt * 2.4;
      } else {
        e.walkT += dt * 10;
        // Thrower zombie: wind up + throw a shuriken once when in range
        if (e.thrower && !e.hasThrown && e.x < W * THROWER_TRIGGER_X) {
          if (e.windup === 0) e.windup = THROWER_WINDUP_S;
          e.windup -= dt;
          if (e.windup <= 0) {
            e.hasThrown = true;
            enemyShots.push({
              x: e.x,
              y: ENEMY_SHURIKEN_Y,
              w: 16, h: 10,
              vx: ENEMY_SHURIKEN_VX,
              spin: 0,
            });
          }
        }
      }
    }
    // enemy projectiles — scroll with the world so they behave like real in-world
    // projectiles. Without `s.x -= dx`, at high game speed the world scrolls
    // leftward faster than the shuriken's own velocity, so the thrower visibly
    // overtakes its own shuriken — looking like the shuriken was "thrown backward."
    for (const s of enemyShots) {
      s.x += s.vx * dt;
      s.x -= dx;
      s.spin += dt * 14;
    }
    // kunais
    for (const k of kunais) {
      k.x += k.vx * dt;
      k.life -= dt;
    }
    // pickups: scroll with world, bob, spin, and pull toward player when close
    const pcx = player.x + player.w / 2;
    const pcy = (player.sliding ? GROUND_Y - 12 : player.y + player.h / 2);
    for (const p of pickups) {
      p.x -= dx;
      p.bobT += dt * 4;
      p.spin += dt * 7;
      const dxp = pcx - p.x;
      const dyp = pcy - p.y;
      const dist = Math.hypot(dxp, dyp);
      if (dist < PICKUP_MAGNET_R && dist > 0.5) {
        // Pull strength scales linearly: 0 at the edge of the radius, max at center.
        const strength = (1 - dist / PICKUP_MAGNET_R) * PICKUP_MAGNET_PULL;
        p.x += (dxp / dist) * strength * dt;
        p.y += (dyp / dist) * strength * dt;
      }
    }

    // collisions: kunai vs enemy (no inset — projectile hits should feel snappy)
    for (const k of kunais) {
      if (k.dead) continue;
      for (const e of enemies) {
        if (e.dead) continue;
        if (rectHit(k, e, 0)) {
          k.dead = true;
          e.dead = true;
          // Hangers are tall — drop the puff at impact y, not body center
          const py = e.type === 'hanger' ? k.y + k.h / 2 : e.y + e.h / 2;
          bloodPuff(e.x + e.w / 2, py);
          break;
        }
      }
    }

    // collisions: player vs pickup
    const pBox = playerBox();
    for (const p of pickups) {
      if (p.dead) continue;
      const pickupBox = { x: p.x - p.r, y: p.y - p.r, w: p.r * 2, h: p.r * 2 };
      if (rectHit(pBox, pickupBox)) {
        p.dead = true;
        if (kunaiAmmo < KUNAI_MAX) kunaiAmmo++;
        // If pickup tops us off, idle the regen clock so the next throw starts a fresh 8s.
        if (kunaiAmmo >= KUNAI_MAX) kunaiCooldown = 0;
        sparkle(p.x, p.y);
      }
    }

    // collisions: player vs enemy
    for (const e of enemies) {
      if (e.dead) continue;
      if (rectHit(pBox, e)) {
        die();
        return;
      }
    }

    // collisions: player vs enemy shuriken (small inset for player grace)
    for (const s of enemyShots) {
      if (s.dead) continue;
      if (rectHit(pBox, s, 1)) {
        die();
        return;
      }
    }

    // cleanup
    enemies = enemies.filter(e => !e.dead && e.x + e.w > -10);
    kunais  = kunais.filter(k => !k.dead && k.life > 0 && k.x < W + 40);
    enemyShots = enemyShots.filter(s => !s.dead && s.x + s.w > -10);
    pickups = pickups.filter(p => !p.dead && p.x > -20);

    // particles
    for (const p of particles) {
      p.vy += 600 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    }
    particles = particles.filter(p => p.life > 0);

    updateHud();
  }

  function playerBox() {
    if (player.sliding) {
      // squish: shorter, slightly wider
      return { x: player.x - 2, y: GROUND_Y - 24, w: player.w + 4, h: 24 };
    }
    return { x: player.x, y: player.y, w: player.w, h: player.h };
  }
  function rectHit(a, b, inset = 3) {
    // Default 3px inset = forgiving hitbox for player-vs-enemy. Pass 0 for thin
    // projectiles (kunai is only 6px tall — a 3px inset on each side eats the
    // hitbox to zero and projectiles silently miss).
    const i = inset;
    return a.x + i < b.x + b.w - i &&
           a.x + a.w - i > b.x + i &&
           a.y + i < b.y + b.h - i &&
           a.y + a.h - i > b.y + i;
  }

  function die() {
    if (!player.alive) return;
    player.alive = false;
    running = false;
    hitstopUntil = performance.now() + HITSTOP_MS;
    bloodPuff(player.x + player.w / 2, player.y + player.h / 2);
    const m = Math.floor(distance / 10);
    if (m > best) {
      best = m;
      localStorage.setItem('ninja_best', String(best));
    }
    pendingGameOver = setTimeout(() => {
      pendingGameOver = null;
      overlay.querySelector('h1').textContent = 'GAME OVER';
      overlay.querySelector('p').innerHTML = `<b>${m} m</b> &nbsp;·&nbsp; best <b>${Math.floor(best)} m</b>`;
      overlay.querySelector('.hint').textContent = 'Press Space to retry';
      overlay.classList.add('show');
    }, HITSTOP_MS + 350);
  }

  function updateHud() {
    const m = Math.floor(distance / 10);
    scoreEl.textContent = `${m} m`;
    // Tick-pulse animation each time the integer meter advances
    if (m !== displayedScore) {
      displayedScore = m;
      scoreEl.classList.remove('tick');
      // force reflow so the animation restarts
      void scoreEl.offsetWidth;
      scoreEl.classList.add('tick');
    }
    // Best tracks max(stored, live) so it climbs together once we surpass the record
    const liveBest = Math.max(best, m);
    bestEl.textContent = `Best: ${liveBest} m`;
    // Visual record-broken state
    const broken = m > best && best > 0;
    if (broken && !recordBeaten) {
      recordBeaten = true;
      scoreEl.classList.add('record');
      bestEl.classList.add('record');
    }
    // Ammo display: filled stars for available, dim stars for empty slots up to max,
    // plus a regen countdown whenever below max
    let html = '';
    for (let i = 0; i < KUNAI_MAX; i++) {
      html += i < kunaiAmmo ? '★ ' : '<span class="empty">★</span> ';
    }
    if (kunaiAmmo < KUNAI_MAX) {
      const secs = Math.max(0, Math.ceil(kunaiCooldown));
      html += `<span class="cooldown">${secs}s</span>`;
    }
    ammoEl.innerHTML = html.trim();
  }

  // --- Render --------------------------------------------------------------
  function draw() {
    const b = BIOMES[currentBiome];

    // sky
    ctx.fillStyle = b.sky;
    ctx.fillRect(0, 0, W, H);

    // parallax (kind-dispatched per biome)
    drawParallax(bgFar);
    drawParallax(bgNear);

    // ceiling (only some biomes have one)
    if (b.hasCeiling) drawDojoCeiling();

    // ground (biome-specific)
    if (b.groundKind === 'dojo') drawDojoGround(b);
    else drawForestGround(b);

    // particles
    for (const p of particles) {
      ctx.fillStyle = p.c;
      ctx.fillRect(p.x - p.r/2, p.y - p.r/2, p.r, p.r);
    }

    // enemies
    for (const e of enemies) {
      if (e.type === 'zombie') drawZombie(e);
      else if (e.type === 'hanger') drawHanger(e);
      else drawEye(e);
    }

    // kunais
    for (const k of kunais) drawKunai(k);

    // enemy shurikens
    for (const s of enemyShots) drawEnemyShot(s);

    // pickups (shuriken)
    for (const p of pickups) drawPickup(p);

    // player
    drawNinja(player);

    // transition curtain (always rendered last so it can obscure the biome swap)
    if (curtain) drawCurtain(curtain);
  }

  function drawParallax(layer) {
    if (layer.kind === 'hills')          drawHills(layer);
    else if (layer.kind === 'mountains') drawMountains(layer);
    else if (layer.kind === 'shoji')     drawShoji(layer);
    else if (layer.kind === 'pillars')   drawPillars(layer);
  }

  function drawMountains(layer) {
    // Distant peaks with snow caps — Mt-Fuji-style triangles.
    for (const m of layer.items) {
      const baseY = GROUND_Y;
      const peakX = m.x + m.w / 2;
      const peakY = GROUND_Y - m.h;
      ctx.fillStyle = layer.color;
      ctx.beginPath();
      ctx.moveTo(m.x, baseY);
      ctx.lineTo(peakX, peakY);
      ctx.lineTo(m.x + m.w, baseY);
      ctx.closePath();
      ctx.fill();
      // Snow cap — small triangle at the top, ~22% of height
      const snowH = m.h * 0.22;
      const snowSpread = (m.w / m.h) * snowH;
      ctx.fillStyle = '#f0f0f4';
      ctx.beginPath();
      ctx.moveTo(peakX - snowSpread, peakY + snowH);
      ctx.lineTo(peakX, peakY);
      ctx.lineTo(peakX + snowSpread, peakY + snowH);
      // ragged snow line — quick zig-zag down
      ctx.lineTo(peakX + snowSpread * 0.4, peakY + snowH * 1.4);
      ctx.lineTo(peakX, peakY + snowH * 1.1);
      ctx.lineTo(peakX - snowSpread * 0.5, peakY + snowH * 1.5);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawShoji(layer) {
    // Shoji wall panels with dark grid trim, viewed at the back of the dojo.
    for (const s of layer.items) {
      const x = s.x, y = GROUND_Y - s.h, w = s.w, h = s.h;
      // Panel base
      ctx.fillStyle = layer.color;
      ctx.fillRect(x, y, w, h);
      // Top bottom trim (dark wood)
      ctx.fillStyle = '#3a1f0a';
      ctx.fillRect(x, y, w, 6);
      ctx.fillRect(x, y + h - 8, w, 8);
      // Outer frame
      ctx.fillRect(x, y, 4, h);
      ctx.fillRect(x + w - 4, y, 4, h);
      // Grid lines — 4 vertical, 5 horizontal across the upper "screen" portion
      ctx.strokeStyle = '#3a1f0a';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const gridTop = y + 6;
      const gridBottom = y + h * 0.55;       // grid in upper portion only (lower is solid panel)
      const gridLeft = x + 4;
      const gridRight = x + w - 4;
      for (let i = 1; i < 5; i++) {
        const lx = gridLeft + (gridRight - gridLeft) * (i / 5);
        ctx.moveTo(lx, gridTop);
        ctx.lineTo(lx, gridBottom);
      }
      for (let i = 1; i < 5; i++) {
        const ly = gridTop + (gridBottom - gridTop) * (i / 5);
        ctx.moveTo(gridLeft, ly);
        ctx.lineTo(gridRight, ly);
      }
      ctx.stroke();
      // Mid divider between grid and lower panel
      ctx.fillStyle = '#3a1f0a';
      ctx.fillRect(x, gridBottom, w, 4);
      // Cherry blossom dots in the upper grid (decorative, sparse)
      if (s.seed > 0.5) {
        ctx.fillStyle = '#f8a8b8';
        for (let i = 0; i < 4; i++) {
          const px = gridLeft + (gridRight - gridLeft) * (0.15 + i * 0.22);
          const py = gridTop + 8 + Math.sin(i * 1.7 + s.seed * 7) * 4;
          ctx.beginPath();
          ctx.arc(px, py, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  function drawPillars(layer) {
    for (const p of layer.items) {
      ctx.fillStyle = layer.color;
      ctx.fillRect(p.x, GROUND_Y - p.h, p.w, p.h);
      // Top capital + bottom base (slightly wider trim)
      ctx.fillRect(p.x - 2, GROUND_Y - p.h, p.w + 4, 5);
      ctx.fillRect(p.x - 2, GROUND_Y - 6, p.w + 4, 6);
    }
  }

  function drawForestGround() {
    const b = BIOMES[currentBiome];
    ctx.fillStyle = b.grass;
    ctx.fillRect(0, GROUND_Y, W, 8);
    ctx.fillStyle = b.grassDark;
    ctx.fillRect(0, GROUND_Y + 8, W, 6);
    ctx.fillStyle = b.soil;
    ctx.fillRect(0, GROUND_Y + 14, W, H - (GROUND_Y + 14));
    ctx.fillStyle = b.soilDark;
    // Diagonal stripes (every 40px, pattern wraps via mod-positive)
    const offset = ((ground % 40) + 40) % 40 - 40;
    for (let x = offset; x < W; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, GROUND_Y + 14);
      ctx.lineTo(x + 18, GROUND_Y + 14);
      ctx.lineTo(x + 8, H);
      ctx.lineTo(x - 10, H);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawDojoGround() {
    const b = BIOMES[currentBiome];
    // Top edge of mat (highlight)
    ctx.fillStyle = b.grass;
    ctx.fillRect(0, GROUND_Y, W, 4);
    // Shadow seam
    ctx.fillStyle = b.grassDark;
    ctx.fillRect(0, GROUND_Y + 4, W, 2);
    // Tatami mat body
    ctx.fillStyle = b.soil;
    ctx.fillRect(0, GROUND_Y + 6, W, H - (GROUND_Y + 6));
    // Horizontal grain seam (one across, suggests perspective)
    ctx.fillStyle = b.soilDark;
    ctx.fillRect(0, GROUND_Y + 28, W, 1);
    // Vertical plank/mat seams every 90px, scrolling with the world
    const period = 90;
    const offset = ((ground % period) + period) % period - period;
    for (let x = offset; x < W; x += period) {
      ctx.fillRect(x, GROUND_Y + 6, 2, H - (GROUND_Y + 6));
    }
    // Subtle diagonal seam from mat corner toward bottom — quick perspective hint
    ctx.strokeStyle = b.soilDark;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = offset; x < W; x += period) {
      ctx.moveTo(x, GROUND_Y + 28);
      ctx.lineTo(x - 14, H);
    }
    ctx.stroke();
  }

  function drawDojoCeiling() {
    // Dark wooden beam across the top
    ctx.fillStyle = '#3a2210';
    ctx.fillRect(0, 0, W, 22);
    ctx.fillStyle = '#5a3a18';
    ctx.fillRect(0, 22, W, 4);
    // Cherry blossom branches dangling from corners (decorative, static — no scroll)
    const drawBranch = (cx, cy, mirror) => {
      ctx.save();
      ctx.translate(cx, cy);
      if (mirror) ctx.scale(-1, 1);
      // Branch
      ctx.strokeStyle = '#3a2210';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(30, 6, 70, 22);
      ctx.stroke();
      // Blossoms
      ctx.fillStyle = '#f8a8b8';
      const blossomPositions = [[18, 4], [34, 10], [52, 16], [66, 22], [44, 4], [22, 14]];
      for (const [bx, by] of blossomPositions) {
        ctx.beginPath();
        ctx.arc(bx, by, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      // Pale highlight in center of each blossom
      ctx.fillStyle = '#fde0e8';
      for (const [bx, by] of blossomPositions) {
        ctx.beginPath();
        ctx.arc(bx, by, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    };
    drawBranch(0, 26, false);
    drawBranch(W, 26, true);
  }

  function drawCurtain(c) {
    // Torii-style gate — pillars + crossbeam are opaque; middle is semi-transparent
    // so the player can still read what's coming through it during the wipe.
    const x = c.x, w = c.w;
    // Translucent red banner between the pillars (player sees through it)
    ctx.fillStyle = 'rgba(138, 26, 26, 0.55)';
    ctx.fillRect(x + 8, 38, w - 16, H - 38);
    // Pillars (opaque dark wood)
    ctx.fillStyle = '#3a1a08';
    ctx.fillRect(x, 0, 9, H);
    ctx.fillRect(x + w - 9, 0, 9, H);
    // Lighter wood inner stripe on each pillar
    ctx.fillStyle = '#5a2818';
    ctx.fillRect(x + 3, 0, 2, H);
    ctx.fillRect(x + w - 5, 0, 2, H);
    // Top crossbeam — slightly extended beyond pillars (torii silhouette)
    ctx.fillStyle = '#5a2818';
    ctx.fillRect(x - 6, 18, w + 12, 14);
    ctx.fillStyle = '#3a1a08';
    ctx.fillRect(x - 8, 12, w + 16, 6);
    ctx.fillRect(x - 4, 32, w + 8, 4);
    // Small yellow medallion in the center of the banner
    ctx.fillStyle = '#e8c828';
    const cx = x + w / 2, cy = H / 2 + 10;
    ctx.beginPath();
    ctx.arc(cx, cy, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3a1a08';
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawHills(layer) {
    ctx.fillStyle = layer.color;
    for (const h of layer.items) {
      ctx.beginPath();
      ctx.moveTo(h.x, GROUND_Y);
      ctx.quadraticCurveTo(h.x + h.w / 2, GROUND_Y - h.h, h.x + h.w, GROUND_Y);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawNinja(p) {
    const sliding = p.sliding;
    let x = p.x, y = p.y, w = p.w, h = p.h;
    if (sliding) { y = GROUND_Y - 24; h = 24; w = p.w + 6; x = p.x - 3; }
    // bob while running on ground
    const bob = (p.onGround && !sliding) ? Math.sin(p.bobT) * 1.5 : 0;
    y += bob;

    // body (rounded rect)
    roundRect(ctx, x, y, w, h, 7, COLOR.ninjaBody);
    // headband (top stripe)
    const bandY = y + (sliding ? 4 : 8);
    ctx.fillStyle = COLOR.ninjaBand;
    ctx.fillRect(x + 1, bandY, w - 2, sliding ? 4 : 5);
    // eye slit
    ctx.fillStyle = COLOR.ninjaFace;
    const eyeY = bandY + (sliding ? 5 : 6);
    ctx.fillRect(x + w * 0.42, eyeY, w * 0.42, sliding ? 3 : 4);
    // belt
    const beltY = y + h - (sliding ? 9 : 14);
    ctx.fillStyle = COLOR.ninjaBand;
    ctx.fillRect(x + 1, beltY, w - 2, sliding ? 3 : 4);
    // buckle
    ctx.fillStyle = COLOR.ninjaFace;
    ctx.fillRect(x + w * 0.36, beltY - 1, w * 0.18, sliding ? 4 : 6);
  }

  function drawZombie(e) {
    const x = e.x, y = e.y, w = e.w, h = e.h;
    const sway = Math.sin(e.walkT) * 1.5;
    // legs
    ctx.fillStyle = COLOR.zombieDark;
    ctx.fillRect(x + 4, y + h - 10, 6, 10);
    ctx.fillRect(x + w - 10, y + h - 10, 6, 10);
    // shirt
    ctx.fillStyle = COLOR.zombieShirt;
    ctx.fillRect(x + 2, y + 14, w - 4, h - 22);
    // head
    ctx.fillStyle = COLOR.zombie;
    roundRect(ctx, x + 4, y + sway, w - 8, 16, 3, COLOR.zombie);
    // eyes
    ctx.fillStyle = '#fff';
    ctx.fillRect(x + 8, y + 5 + sway, 3, 3);
    ctx.fillRect(x + w - 11, y + 5 + sway, 3, 3);
    ctx.fillStyle = '#000';
    ctx.fillRect(x + 9, y + 6 + sway, 1, 1);
    ctx.fillRect(x + w - 10, y + 6 + sway, 1, 1);
    // mouth
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(x + 9, y + 11 + sway, w - 18, 2);
    // arms outstretched
    ctx.fillStyle = COLOR.zombie;
    ctx.fillRect(x - 3, y + 16, 6, 4);
    ctx.fillRect(x + w - 3, y + 16, 6, 4);

    // Thrower variant: shuriken in left hand (always visible) + multi-channel windup telegraph
    if (e.thrower && !e.hasThrown) {
      const winding = e.windup > 0 && e.windup < THROWER_WINDUP_S;
      // Multi-channel telegraph: expanding ring + halo + body flash + floating "!".
      // Layered so it punches through fast scroll — single-channel red glow gets lost.
      if (winding) {
        const k = 1 - (e.windup / THROWER_WINDUP_S);  // 0 → 1 over the windup
        const cx = x + w / 2;
        const cy = y + 8 + sway;
        // (1) Expanding shockwave ring — motion contrast against the scrolling world
        ctx.strokeStyle = `rgba(220, 60, 50, ${(1 - k) * 0.7})`;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(cx, cy, 8 + k * 30, 0, Math.PI * 2);
        ctx.stroke();
        // (2) Inner halo — solid red bloom around the head
        ctx.fillStyle = `rgba(220, 60, 50, ${0.55 * k})`;
        ctx.beginPath();
        ctx.arc(cx, cy, 14 + k * 5, 0, Math.PI * 2);
        ctx.fill();
        // (3) Body flash — torso/shirt tinted red so the silhouette itself reads as "danger"
        ctx.fillStyle = `rgba(255, 70, 50, ${0.35 * k})`;
        ctx.fillRect(x + 2, y + 14, w - 4, h - 22);
        // (4) Floating "!" above the zombie — strongest signal, contrast-readable on any background
        const t = performance.now();
        const exY = y - 18 - Math.sin(t / 80) * 3;
        const blink = 0.55 + 0.45 * Math.abs(Math.sin(t / 70));
        ctx.font = 'bold 22px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 3;
        ctx.strokeStyle = `rgba(0, 0, 0, ${blink})`;
        ctx.strokeText('!', cx, exY);
        ctx.fillStyle = `rgba(255, 220, 50, ${blink})`;
        ctx.fillText('!', cx, exY);
      }
      // Tiny rotating shuriken in the front hand
      const shX = x - 9;
      const shY = y + 18;
      ctx.save();
      ctx.translate(shX, shY);
      ctx.rotate(e.walkT * (winding ? 1.4 : 0.3));
      ctx.fillStyle = '#cfcfcf';
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const r = i % 2 === 0 ? 5 : 2;
        const px = Math.cos(a) * r, py = Math.sin(a) * r;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 0.8;
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawEnemyShot(s) {
    ctx.save();
    ctx.translate(s.x + s.w / 2, s.y + s.h / 2);
    ctx.rotate(s.spin);
    // body — same star shape as pickup but smaller and with a red center to read as enemy
    ctx.fillStyle = '#cfcfcf';
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const r = i % 2 === 0 ? 8 : 3;
      const px = Math.cos(a) * r, py = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 1;
    ctx.stroke();
    // red center disambiguates from gold-glowing player pickups
    ctx.fillStyle = '#c0392b';
    ctx.beginPath();
    ctx.arc(0, 0, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawHanger(e) {
    // chain hangs from top, body sways slightly
    const sway = Math.sin(e.swayT) * 4;
    const cx = e.x + e.w / 2;
    const bodyTop = e.bodyTop;
    const bodyBottom = e.h;
    const bodyH = bodyBottom - bodyTop;

    // chain — zig-zag stylized links from top of screen down to body
    ctx.strokeStyle = '#777';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let y = 0; y < bodyTop; y += 8) {
      const swayHere = sway * (y / bodyTop);     // hinge at top, more sway lower down
      const off = (y / 8) % 2 === 0 ? -2 : 2;
      ctx.moveTo(cx + off + swayHere, y);
      ctx.lineTo(cx - off + swayHere, y + 8);
    }
    ctx.stroke();

    // body offsets follow the bottom of the chain
    const bx = cx - e.w / 2 + sway;
    const by = bodyTop;

    // legs/feet dangling
    ctx.fillStyle = COLOR.zombieDark;
    ctx.fillRect(bx + 5, by + bodyH - 14, 5, 14);
    ctx.fillRect(bx + e.w - 10, by + bodyH - 14, 5, 14);

    // shirt/torso
    ctx.fillStyle = COLOR.zombieShirt;
    ctx.fillRect(bx + 2, by + 18, e.w - 4, bodyH - 32);

    // head (slumped forward — drawn at top of body)
    ctx.fillStyle = COLOR.zombie;
    roundRect(ctx, bx + 3, by, e.w - 6, 22, 4, COLOR.zombie);

    // dead eyes (Xs)
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(bx + 7, by + 7);  ctx.lineTo(bx + 11, by + 11);
    ctx.moveTo(bx + 11, by + 7); ctx.lineTo(bx + 7, by + 11);
    ctx.moveTo(bx + e.w - 11, by + 7);  ctx.lineTo(bx + e.w - 7, by + 11);
    ctx.moveTo(bx + e.w - 7, by + 7);   ctx.lineTo(bx + e.w - 11, by + 11);
    ctx.stroke();

    // open slack mouth
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(bx + 9, by + 15, e.w - 18, 3);

    // arms dangling down past body
    ctx.fillStyle = COLOR.zombie;
    ctx.fillRect(bx - 1, by + 22, 4, bodyH - 30);
    ctx.fillRect(bx + e.w - 3, by + 22, 4, bodyH - 30);

    // noose loop where chain meets head
    ctx.strokeStyle = '#5a4a36';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx + sway, by + 2, 5, 0, Math.PI * 2);
    ctx.stroke();
  }

  function drawEye(e) {
    const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
    // wings
    ctx.fillStyle = '#3a3a3a';
    const flap = Math.sin(e.bobT * 2) * 4;
    ctx.beginPath();
    ctx.ellipse(cx - 14, cy + flap, 8, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx + 14, cy + flap, 8, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    // eyeball
    ctx.fillStyle = COLOR.eyeball;
    ctx.beginPath();
    ctx.ellipse(cx, cy, e.w / 2, e.h / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    // veins
    ctx.strokeStyle = COLOR.eyeVein;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - 6, cy - 4); ctx.lineTo(cx - 2, cy - 1);
    ctx.moveTo(cx + 6, cy + 4); ctx.lineTo(cx + 2, cy + 1);
    ctx.stroke();
    // iris
    ctx.fillStyle = COLOR.eyeIris;
    ctx.beginPath();
    ctx.arc(cx - 2, cy, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawPickup(p) {
    // Pickups look like the kunai they give you — knife shape, not a star.
    // This is the load-bearing visual rule: KNIFE = yours, STAR = theirs.
    const y = p.y + Math.sin(p.bobT) * 3;
    ctx.save();
    ctx.translate(p.x, y);
    ctx.rotate(p.spin);
    // Blade body — dark steel
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(-4, -1.5, 14, 3);
    // Pointed tip (light steel triangle)
    ctx.fillStyle = '#cfcfcf';
    ctx.beginPath();
    ctx.moveTo(10, -2);
    ctx.lineTo(15, 0);
    ctx.lineTo(10, 2);
    ctx.closePath();
    ctx.fill();
    // Handle wrap (brown) and pommel ring (the iconic kunai detail)
    ctx.fillStyle = '#7a4a2b';
    ctx.fillRect(-10, -2, 6, 4);
    ctx.strokeStyle = '#cfcfcf';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(-12, 0, 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    // Gold glow ring — keeps the "this is a friendly pickup, grab it" cue.
    ctx.strokeStyle = 'rgba(255, 206, 74, 0.55)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(p.x, y, p.r + 4 + Math.sin(p.bobT * 1.3) * 1.5, 0, Math.PI * 2);
    ctx.stroke();
  }

  function drawKunai(k) {
    ctx.fillStyle = COLOR.kunai;
    ctx.fillRect(k.x, k.y, k.w - 4, k.h);
    ctx.fillStyle = COLOR.kunaiTip;
    ctx.beginPath();
    ctx.moveTo(k.x + k.w - 4, k.y - 1);
    ctx.lineTo(k.x + k.w + 2, k.y + k.h / 2);
    ctx.lineTo(k.x + k.w - 4, k.y + k.h + 1);
    ctx.closePath();
    ctx.fill();
  }

  function roundRect(ctx, x, y, w, h, r, fill) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fill();
  }

  // --- Loop ----------------------------------------------------------------
  function frame(t) {
    // Clamp dt to [0, 0.033]: the first frame after startGame can produce a
    // negative (t - last) due to timing-precision races; negative dt would
    // run physics backward and corrupt distance.
    const dt = Math.max(0, Math.min(0.033, (t - last) / 1000));
    last = t;
    if (running) update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  // initial paint behind overlay so the canvas isn't blank
  reset();
  player.alive = true;
  draw();
})();
