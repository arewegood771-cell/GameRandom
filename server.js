// ================================================================
// ISLAND RPG MULTIPLAYER SERVER - Full RPG Edition
// npm install express socket.io
// node server.js → buka http://localhost:3000
// ================================================================
const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });
app.use(express.static(path.join(__dirname)));

// ================================================================
// CONSTANTS
// ================================================================
const TICK_MS      = 100;   // Server tick setiap 100ms
const ENEMY_SPEED  = 60;    // px/s
const AGGRO_RANGE  = 180;   // px
const DEAGGRO_RANGE= 400;
const ATTACK_RANGE = 45;
const ENEMY_ATK_COOLDOWN = 1500; // ms

// Weapon data
const WEAPONS = {
  sword: { name:'Sword',  dmg:[12,18], range:55,  cooldown:600,  aoe:false, proj:false, color:0xaaccff },
  staff: { name:'Staff',  dmg:[20,30], range:280, cooldown:900,  aoe:true,  proj:true,  color:0xcc88ff },
  bow:   { name:'Bow',    dmg:[15,22], range:220, cooldown:700,  aoe:false, proj:true,  color:0xffcc44 },
  axe:   { name:'Axe',    dmg:[25,35], range:65,  cooldown:1100, aoe:true,  proj:false, color:0xff8844 },
  dagger:{ name:'Dagger', dmg:[8,12],  range:45,  cooldown:300,  aoe:false, proj:false, color:0x88ffcc },
};

// Enemy templates per island
const ENEMY_TYPES = {
  slime:   { name:'Slime',    hp:40,  atk:5,  def:1,  spd:50,  xp:10, gold:3,  color:0x44ff44, size:24 },
  goblin:  { name:'Goblin',   hp:70,  atk:10, def:3,  spd:75,  xp:20, gold:6,  color:0x88cc00, size:28 },
  orc:     { name:'Orc',      hp:150, atk:18, def:8,  spd:55,  xp:40, gold:12, color:0xff8800, size:36 },
  mage:    { name:'Dark Mage',hp:90,  atk:25, def:2,  spd:65,  xp:50, gold:15, color:0xaa00ff, size:28 },
  knight:  { name:'Knight',   hp:220, atk:22, def:15, spd:60,  xp:70, gold:20, color:0x4488ff, size:38 },
  dragon:  { name:'Dragon',   hp:500, atk:40, def:20, spd:80,  xp:150,gold:50, color:0xff2200, size:55 },
  skeleton:{ name:'Skeleton', hp:60,  atk:12, def:4,  spd:65,  xp:25, gold:7,  color:0xddddaa, size:26 },
  witch:   { name:'Witch',    hp:80,  atk:28, def:3,  spd:70,  xp:55, gold:18, color:0xee44ee, size:26 },
};

// Island config: { minLv, enemyTypes[], count }
const ISLAND_CONFIG = [
  null, // island 0 = safe zone
  { minLv:1,  maxLv:5,  types:['slime','goblin'],          count:6 },
  { minLv:6,  maxLv:12, types:['goblin','orc','skeleton'],  count:7 },
  { minLv:13, maxLv:20, types:['orc','mage','knight'],      count:7 },
  { minLv:21, maxLv:30, types:['knight','dragon','witch'],   count:8 },
];

// Dungeon templates
const DUNGEONS = {
  'forest_cave': {
    name: '🌲 Forest Cave',
    minLv: 3,
    waves: [
      { types:['slime','slime','goblin'],    count:4 },
      { types:['goblin','goblin','skeleton'], count:5 },
      { types:['orc'],                        count:3, boss:true },
    ],
    reward: { xp:200, gold:80, item:'iron_sword' }
  },
  'dark_dungeon': {
    name: '🌑 Dark Dungeon',
    minLv: 10,
    waves: [
      { types:['skeleton','mage'],          count:5 },
      { types:['knight','mage'],            count:4 },
      { types:['dragon'],                   count:1, boss:true },
    ],
    reward: { xp:600, gold:250, item:'flame_staff' }
  },
  'boss_lair': {
    name: '👹 Boss Lair',
    minLv: 20,
    waves: [
      { types:['dragon','witch','knight'],  count:6 },
      { types:['dragon','dragon'],          count:3 },
      { types:['dragon'],                   count:1, boss:true, ultra:true },
    ],
    reward: { xp:1500, gold:700, item:'legend_axe' }
  }
};

// Item database
const ITEMS = {
  heal_potion:  { name:'Heal Potion',  type:'consumable', effect:'heal',     value:50,  icon:'💊' },
  mana_potion:  { name:'Mana Potion',  type:'consumable', effect:'mana',     value:40,  icon:'🔵' },
  iron_sword:   { name:'Iron Sword',   type:'weapon',     weaponType:'sword', bonusDmg:5, icon:'🗡️' },
  flame_staff:  { name:'Flame Staff',  type:'weapon',     weaponType:'staff', bonusDmg:12,icon:'🪄' },
  legend_axe:   { name:'Legend Axe',   type:'weapon',     weaponType:'axe',   bonusDmg:20,icon:'🪓' },
  gold_coin:    { name:'Gold',         type:'currency',   icon:'🪙' },
  xp_scroll:    { name:'XP Scroll',    type:'consumable', effect:'xp',       value:100, icon:'📜' },
};

// Level XP table: xpNeeded[lv] = total XP to next level
function xpToLevel(lv) { return Math.floor(100 * Math.pow(1.4, lv - 1)); }

// ================================================================
// SERVER STATE
// ================================================================
const players   = {};     // socket.id → playerData
const enemies   = {};     // enemyId → enemyData
const dungeons  = {};     // dungeonRunId → dungeonState
let nextEnemyId = 1;
let nextDungeonId = 1;

// ================================================================
// ENEMY AI (server-side)
// ================================================================
function createEnemy(type, x, y, island, lv) {
  const tmpl = ENEMY_TYPES[type] || ENEMY_TYPES.slime;
  const lvScale = 1 + (lv - 1) * 0.15;
  const id = `e_${nextEnemyId++}`;
  return {
    id, type, x, y, island, lv,
    name:     tmpl.name,
    maxHp:    Math.floor(tmpl.hp * lvScale),
    hp:       Math.floor(tmpl.hp * lvScale),
    atk:      Math.floor(tmpl.atk * lvScale),
    def:      Math.floor(tmpl.def * lvScale),
    spd:      tmpl.spd,
    xp:       Math.floor(tmpl.xp * lvScale),
    gold:     Math.floor(tmpl.gold * lvScale),
    color:    tmpl.color,
    size:     tmpl.size,
    aggroTarget: null,
    lastAttack:  0,
    spawnX: x, spawnY: y,
    dungeonId: null,
  };
}

function spawnIslandEnemies() {
  for (let island = 1; island <= 4; island++) {
    const cfg = ISLAND_CONFIG[island];
    for (let j = 0; j < cfg.count; j++) {
      const type = cfg.types[Math.floor(Math.random() * cfg.types.length)];
      const lv   = cfg.minLv + Math.floor(Math.random() * (cfg.maxLv - cfg.minLv + 1));
      const x    = island * 800 + 80 + Math.random() * 640;
      const y    = 60 + Math.random() * 480;
      const e    = createEnemy(type, x, y, island, lv);
      enemies[e.id] = e;
    }
  }
  console.log(`✅ Spawned ${Object.keys(enemies).length} island enemies`);
}

// AI tick per enemy
function tickEnemy(e, dt) {
  if (e.hp <= 0) return;

  // Find nearest player
  let nearest = null, nearestDist = Infinity;
  for (const pid in players) {
    const p = players[pid];
    if (p.hp <= 0) continue;
    // Dungeon enemy only targets players in same dungeon
    if (e.dungeonId && p.dungeonId !== e.dungeonId) continue;
    if (!e.dungeonId && p.dungeonId) continue;
    const d = dist(e.x, e.y, p.x, p.y);
    if (d < nearestDist) { nearestDist = d; nearest = p; }
  }

  if (!nearest) {
    // Wander back to spawn
    moveToward(e, e.spawnX, e.spawnY, e.spd * dt);
    return;
  }

  if (nearestDist < AGGRO_RANGE || e.aggroTarget === nearest.id) {
    e.aggroTarget = nearest.id;

    if (nearestDist > DEAGGRO_RANGE) {
      e.aggroTarget = null;
      return;
    }

    // Move toward player
    if (nearestDist > ATTACK_RANGE) {
      moveToward(e, nearest.x, nearest.y, e.spd * dt);
    } else {
      // Attack
      const now = Date.now();
      if (now - e.lastAttack > ENEMY_ATK_COOLDOWN) {
        e.lastAttack = now;
        const dmg = Math.max(1, e.atk - nearest.def);
        nearest.hp = Math.max(0, nearest.hp - dmg);
        io.to(nearest.id).emit('take_damage', { dmg, hp: nearest.hp, maxHp: nearest.maxHp });
        io.emit('enemy_attack', { enemyId: e.id, targetId: nearest.id, dmg });
        if (nearest.hp <= 0) {
          nearest.dead = true;
          io.to(nearest.id).emit('player_dead');
          io.emit('broadcast_msg', { type:'death', msg:`💀 ${nearest.name} tewas!` });
          // Respawn timer
          setTimeout(() => {
            if (players[nearest.id]) {
              players[nearest.id].hp = players[nearest.id].maxHp;
              players[nearest.id].dead = false;
              players[nearest.id].x = 200;
              players[nearest.id].y = 300;
              players[nearest.id].dungeonId = null;
              io.to(nearest.id).emit('player_respawn', { x: 200, y: 300, hp: players[nearest.id].maxHp });
            }
          }, 4000);
        }
      }
    }
  }
}

function moveToward(e, tx, ty, step) {
  const dx = tx - e.x, dy = ty - e.y;
  const d = Math.sqrt(dx*dx + dy*dy);
  if (d < 2) return;
  e.x += (dx / d) * step;
  e.y += (dy / d) * step;
  // Clamp to island bounds
  if (!e.dungeonId) {
    const islandLeft  = e.island * 800 + 10;
    const islandRight = e.island * 800 + 790;
    e.x = Math.max(islandLeft, Math.min(islandRight, e.x));
    e.y = Math.max(10, Math.min(590, e.y));
  }
}

function dist(x1, y1, x2, y2) {
  return Math.sqrt((x2-x1)**2 + (y2-y1)**2);
}

// ================================================================
// DUNGEON SYSTEM
// ================================================================
function startDungeon(dungeonKey, playerIds) {
  const tmpl = DUNGEONS[dungeonKey];
  if (!tmpl) return null;

  const runId = `dng_${nextDungeonId++}`;
  const run = {
    id: runId,
    key: dungeonKey,
    name: tmpl.name,
    players: [...playerIds],
    wave: 0,
    maxWaves: tmpl.waves.length,
    alive: 0,
    complete: false,
    reward: tmpl.reward,
  };
  dungeons[runId] = run;

  playerIds.forEach(pid => {
    if (players[pid]) {
      players[pid].dungeonId = runId;
      players[pid].x = 4200 + Math.random() * 100;
      players[pid].y = 250 + Math.random() * 100;
    }
    io.to(pid).emit('dungeon_enter', { runId, name: run.name, wave: 0, maxWaves: run.maxWaves });
  });

  spawnDungeonWave(run, tmpl);
  return run;
}

function spawnDungeonWave(run, tmpl) {
  const waveDef = tmpl.waves[run.wave];
  if (!waveDef) return;

  const baseX = 4400, baseY = 300;
  let spawned = 0;
  for (let i = 0; i < waveDef.count; i++) {
    const type = waveDef.types[i % waveDef.types.length];
    const lv   = DUNGEONS[run.key].minLv + run.wave * 3 + Math.floor(Math.random() * 4);
    const scale= waveDef.boss ? (waveDef.ultra ? 4 : 2.5) : 1;
    const x    = baseX + (i % 3) * 80 + Math.random() * 40;
    const y    = baseY + Math.floor(i / 3) * 80 + Math.random() * 40;
    const e    = createEnemy(type, x, y, 99, lv);
    e.dungeonId = run.id;
    // Boss scale
    e.maxHp  = Math.floor(e.maxHp * scale);
    e.hp     = e.maxHp;
    e.atk    = Math.floor(e.atk * scale);
    if (waveDef.boss) e.isBoss = true;
    enemies[e.id] = e;
    spawned++;
  }
  run.alive = spawned;

  run.players.forEach(pid => {
    io.to(pid).emit('dungeon_wave', {
      wave: run.wave + 1,
      maxWaves: run.maxWaves,
      count: spawned,
      isBossWave: !!waveDef.boss,
    });
  });

  // Broadcast new enemies
  io.emit('enemies_batch', Object.fromEntries(
    Object.entries(enemies).filter(([,e]) => e.dungeonId === run.id)
  ));
}

function checkDungeonWaveClear(runId) {
  const run = dungeons[runId];
  if (!run || run.complete) return;

  const remaining = Object.values(enemies).filter(e => e.dungeonId === runId && e.hp > 0).length;
  run.alive = remaining;

  if (remaining === 0) {
    run.wave++;
    if (run.wave >= run.maxWaves) {
      // Dungeon clear!
      run.complete = true;
      run.players.forEach(pid => {
        if (!players[pid]) return;
        const p = players[pid];
        p.xp   += run.reward.xp;
        p.gold = (p.gold||0) + run.reward.gold;
        if (run.reward.item) addItem(p, run.reward.item);
        checkLevelUp(p, pid);
        p.dungeonId = null;
        p.x = 200; p.y = 300;
        io.to(pid).emit('dungeon_clear', {
          xp: run.reward.xp, gold: run.reward.gold, item: run.reward.item,
        });
        io.to(pid).emit('player_respawn', { x: 200, y: 300, hp: p.hp });
        io.to(pid).emit('stats_update', sanitizePlayer(p));
      });
      delete dungeons[runId];
    } else {
      // Next wave
      setTimeout(() => {
        const tmpl = DUNGEONS[run.key];
        run.players.forEach(pid => io.to(pid).emit('dungeon_next_wave', { wave: run.wave + 1 }));
        spawnDungeonWave(run, tmpl);
      }, 3000);
    }
  }
}

// ================================================================
// LEVELING & STATS SYSTEM
// ================================================================
function makePlayer(socketId, name) {
  return {
    id:      socketId,
    name:    name,
    x: 200 + Math.random()*150,
    y: 200 + Math.random()*150,
    // Core stats
    lv:      1,
    xp:      0,
    xpNext:  xpToLevel(1),
    gold:    0,
    // Derived stats (recalculate on level/equip)
    maxHp:   120,
    hp:      120,
    maxMp:   60,
    mp:      60,
    atk:     10,
    def:     3,
    spd:     100,
    crit:    5,    // crit%
    // Base stats (increase on level up)
    str:     5,
    intel:   5,
    agi:     5,
    statPoints: 0,
    // Equipment
    weapon:  'sword',
    weaponBonus: 0,
    armor:   'cloth',
    // Inventory: { itemKey: count }
    inventory: { heal_potion: 3 },
    // Status
    dead:    false,
    dungeonId: null,
    color:   0x00ff88,
    // Cooldowns (ms timestamps)
    attackCooldown: 0,
  };
}

function recalcStats(p) {
  p.maxHp  = 100 + p.str * 12 + (p.lv - 1) * 15;
  p.maxMp  = 50  + p.intel * 8 + (p.lv - 1) * 8;
  p.atk    = 5   + p.str * 2 + p.weaponBonus;
  p.def    = 2   + p.str   + Math.floor(p.agi / 2);
  p.spd    = 90  + p.agi * 3;
  p.crit   = 3   + p.agi;
  if (p.hp > p.maxHp) p.hp = p.maxHp;
  if (p.mp > p.maxMp) p.mp = p.maxMp;
}

function checkLevelUp(p, pid) {
  let leveled = false;
  while (p.xp >= p.xpNext) {
    p.xp    -= p.xpNext;
    p.lv    += 1;
    p.xpNext = xpToLevel(p.lv);
    p.statPoints += 3;
    // Auto-heal on level up
    recalcStats(p);
    p.hp = p.maxHp;
    p.mp = p.maxMp;
    leveled = true;
    io.to(pid).emit('level_up', { lv: p.lv, statPoints: p.statPoints });
    io.emit('broadcast_msg', { type:'levelup', msg:`⭐ ${p.name} naik ke Level ${p.lv}!` });
  }
  return leveled;
}

function addItem(p, itemKey, count = 1) {
  p.inventory[itemKey] = (p.inventory[itemKey] || 0) + count;
}

function sanitizePlayer(p) {
  // Only send safe fields to clients
  return {
    id: p.id, name: p.name, x: p.x, y: p.y,
    lv: p.lv, xp: p.xp, xpNext: p.xpNext, gold: p.gold,
    hp: p.hp, maxHp: p.maxHp, mp: p.mp, maxMp: p.maxMp,
    atk: p.atk, def: p.def, spd: p.spd, crit: p.crit,
    str: p.str, intel: p.intel, agi: p.agi, statPoints: p.statPoints,
    weapon: p.weapon, weaponBonus: p.weaponBonus,
    inventory: p.inventory, dead: p.dead,
    dungeonId: p.dungeonId, color: p.color,
  };
}

// ================================================================
// COMBAT: Player attacks enemy
// ================================================================
function playerAttackEnemy(p, enemyId) {
  const e = enemies[enemyId];
  if (!e || e.hp <= 0) return null;

  const wpn   = WEAPONS[p.weapon] || WEAPONS.sword;
  const isCrit= Math.random() * 100 < p.crit;
  const baseDmg = wpn.dmg[0] + Math.floor(Math.random() * (wpn.dmg[1] - wpn.dmg[0] + 1));
  let dmg = Math.max(1, baseDmg + p.atk - e.def);
  if (isCrit) dmg = Math.floor(dmg * 1.75);

  e.hp -= dmg;
  e.aggroTarget = p.id; // Enemy aggros attacker

  const result = { enemyId, dmg, crit: isCrit, enemyHp: Math.max(0, e.hp), enemyMaxHp: e.maxHp };

  if (e.hp <= 0) {
    // Enemy dead
    result.killed = true;
    result.xp     = e.xp;
    result.gold   = e.gold;

    // Random item drop (20% chance)
    const dropTable = ['heal_potion','mana_potion','xp_scroll'];
    if (Math.random() < 0.20) {
      const drop = dropTable[Math.floor(Math.random() * dropTable.length)];
      result.dropItem = drop;
      addItem(p, drop);
    }

    p.xp   += e.xp;
    p.gold  = (p.gold || 0) + e.gold;
    const wasDungeon = e.dungeonId;
    delete enemies[enemyId];

    checkLevelUp(p, p.id);

    // Respawn island enemy
    if (!wasDungeon) {
      setTimeout(() => {
        const cfg = ISLAND_CONFIG[e.island];
        if (!cfg) return;
        const type = cfg.types[Math.floor(Math.random() * cfg.types.length)];
        const lv   = cfg.minLv + Math.floor(Math.random() * (cfg.maxLv - cfg.minLv + 1));
        const ne   = createEnemy(type, e.spawnX, e.spawnY, e.island, lv);
        enemies[ne.id] = ne;
        io.emit('enemy_spawned', ne);
      }, 10000);
    } else {
      checkDungeonWaveClear(wasDungeon);
    }
  }

  return result;
}

// ================================================================
// SERVER TICK
// ================================================================
let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt  = (now - lastTick) / 1000; // seconds
  lastTick  = now;

  // Tick all enemies
  const moved = [];
  for (const eid in enemies) {
    const e = enemies[eid];
    if (e.hp <= 0) continue;
    const oldX = e.x, oldY = e.y;
    tickEnemy(e, dt);
    if (Math.abs(e.x - oldX) > 0.5 || Math.abs(e.y - oldY) > 0.5) {
      moved.push({ id: e.id, x: e.x, y: e.y, hp: e.hp, maxHp: e.maxHp });
    }
  }
  if (moved.length > 0) io.emit('enemies_move', moved);
}, TICK_MS);

// ================================================================
// SOCKET HANDLERS
// ================================================================
const PLAYER_COLORS = [0x00ff88, 0x00cfff, 0xffaa00, 0xff66ff, 0xff4444, 0x88ff00, 0xffdd00, 0x44ffee];
let colorIdx = 0;

io.on('connection', (socket) => {
  console.log(`🟢 Connected: ${socket.id}`);

  socket.on('player_join', (data) => {
    const p = makePlayer(socket.id, data.name || 'Player');
    p.color = PLAYER_COLORS[colorIdx++ % PLAYER_COLORS.length];
    players[socket.id] = p;

    // Send init data
    socket.emit('init', {
      self:    sanitizePlayer(p),
      players: Object.fromEntries(Object.entries(players).filter(([k])=>k!==socket.id).map(([k,v])=>[k,sanitizePlayer(v)])),
      enemies: enemies,
      weapons: WEAPONS,
      items:   ITEMS,
      dungeons: Object.fromEntries(Object.entries(DUNGEONS).map(([k,v])=>[k,{ name:v.name, minLv:v.minLv }])),
    });

    socket.broadcast.emit('player_joined', sanitizePlayer(p));
    console.log(`👤 ${p.name} joined. Total: ${Object.keys(players).length}`);
  });

  // Move
  socket.on('player_move', (data) => {
    const p = players[socket.id];
    if (!p || p.dead) return;
    p.x = data.x; p.y = data.y;
    socket.broadcast.emit('player_moved', { id: socket.id, x: data.x, y: data.y });
  });

  // Attack enemy
  socket.on('attack_enemy', (data) => {
    const p = players[socket.id];
    if (!p || p.dead) return;

    const now = Date.now();
    const wpn = WEAPONS[p.weapon] || WEAPONS.sword;
    if (now - p.attackCooldown < wpn.cooldown) return; // Cooldown
    p.attackCooldown = now;

    // AOE: hit all enemies in range (staff/axe)
    if (wpn.aoe) {
      Object.keys(enemies).forEach(eid => {
        const e = enemies[eid];
        if (!e || e.hp <= 0) return;
        const d = dist(p.x, p.y, e.x, e.y);
        if (d <= wpn.range) {
          const res = playerAttackEnemy(p, eid);
          if (res) {
            io.emit('enemy_hit', res);
            socket.emit('stats_update', sanitizePlayer(p));
          }
        }
      });
    } else {
      // Single target (nearest in range)
      const eid = data.enemyId;
      if (eid) {
        const res = playerAttackEnemy(p, eid);
        if (res) {
          io.emit('enemy_hit', res);
          socket.emit('stats_update', sanitizePlayer(p));
        }
      }
    }
  });

  // Use item
  socket.on('use_item', (data) => {
    const p = players[socket.id];
    if (!p) return;
    const { itemKey } = data;
    const item = ITEMS[itemKey];
    if (!item || !p.inventory[itemKey] || p.inventory[itemKey] <= 0) return;

    p.inventory[itemKey]--;
    if (p.inventory[itemKey] <= 0) delete p.inventory[itemKey];

    if (item.effect === 'heal') {
      p.hp = Math.min(p.maxHp, p.hp + item.value);
    } else if (item.effect === 'mana') {
      p.mp = Math.min(p.maxMp, p.mp + item.value);
    } else if (item.effect === 'xp') {
      p.xp += item.value;
      checkLevelUp(p, socket.id);
    }
    if (item.type === 'weapon') {
      p.weapon = item.weaponType;
      p.weaponBonus = item.bonusDmg;
      recalcStats(p);
    }

    socket.emit('stats_update', sanitizePlayer(p));
    socket.emit('item_used', { itemKey, item: ITEMS[itemKey] });
  });

  // Equip weapon (switch, must own unlock)
  socket.on('equip_weapon', (data) => {
    const p = players[socket.id];
    if (!p) return;
    const wKey = data.weapon;
    if (!WEAPONS[wKey]) return;
    p.weapon = wKey;
    recalcStats(p);
    socket.emit('stats_update', sanitizePlayer(p));
  });

  // Allocate stat point
  socket.on('stat_point', (data) => {
    const p = players[socket.id];
    if (!p || p.statPoints <= 0) return;
    if (!['str','intel','agi'].includes(data.stat)) return;
    p[data.stat]++;
    p.statPoints--;
    recalcStats(p);
    socket.emit('stats_update', sanitizePlayer(p));
  });

  // Enter dungeon
  socket.on('enter_dungeon', (data) => {
    const p = players[socket.id];
    if (!p || p.dead || p.dungeonId) return;
    const tmpl = DUNGEONS[data.key];
    if (!tmpl) return;
    if (p.lv < tmpl.minLv) {
      socket.emit('error_msg', `Butuh Level ${tmpl.minLv} untuk masuk!`);
      return;
    }
    startDungeon(data.key, [socket.id]);
  });

  // Leave dungeon (abandon)
  socket.on('leave_dungeon', () => {
    const p = players[socket.id];
    if (!p || !p.dungeonId) return;
    const run = dungeons[p.dungeonId];
    if (run) {
      run.players = run.players.filter(id => id !== socket.id);
      if (run.players.length === 0) {
        // Clean up dungeon enemies
        Object.keys(enemies).forEach(eid => {
          if (enemies[eid].dungeonId === p.dungeonId) delete enemies[eid];
        });
        delete dungeons[p.dungeonId];
      }
    }
    p.dungeonId = null;
    p.x = 200; p.y = 300;
    p.hp = Math.max(1, Math.floor(p.maxHp * 0.5));
    socket.emit('player_respawn', { x: 200, y: 300, hp: p.hp });
    socket.emit('stats_update', sanitizePlayer(p));
  });

  // Chat
  socket.on('chat', (msg) => {
    const p = players[socket.id];
    if (!p) return;
    const sanitized = String(msg).slice(0, 80).replace(/</g, '&lt;');
    io.emit('chat_message', {
      name:  p.name, color: p.color, msg: sanitized,
      time:  new Date().toLocaleTimeString('id-ID', { hour:'2-digit', minute:'2-digit' })
    });
  });

  socket.on('disconnect', () => {
    const p = players[socket.id];
    if (p) {
      console.log(`🔴 ${p.name} disconnected`);
      io.emit('player_left', { id: socket.id, name: p.name });
      delete players[socket.id];
    }
  });
});

// ================================================================
// BOOT
// ================================================================
spawnIslandEnemies();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🎮 Island RPG Full Edition`);
  console.log(`🌐 http://localhost:${PORT}\n`);
});
