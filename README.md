# 🔫 TEMBAK! — Multiplayer Arena Shooter

Game tembak-tembakan multiplayer real-time dengan WebSocket. Black Blizzard-inspired UI.

## Fitur
- Multiplayer real-time via WebSocket (bukan localStorage!)
- Avatar: **gambar sendiri** atau **upload foto**
- Room system dengan kode 4 huruf
- Peta dengan obstacles, respawn, kill feed
- Menang di 10 kills pertama

---

## Deploy ke Railway

### 1. Install Railway CLI (opsional, bisa lewat GitHub juga)
```bash
npm install -g @railway/cli
```

### 2. Login Railway
```bash
railway login
```

### 3. Deploy
```bash
cd tembak-game
railway init        # buat project baru
railway up          # deploy!
```

### Atau lewat GitHub:
1. Push folder `tembak-game` ke GitHub repo
2. Buka [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub**
3. Pilih repo → Railway otomatis detect Node.js & deploy
4. Buka URL yang diberikan Railway → game siap dimainkan!

### Environment Variables (opsional)
Railway otomatis set `PORT`. Tidak perlu config tambahan.

---

## Run Lokal
```bash
cd tembak-game
npm install
npm start
# Buka http://localhost:3000
```

## Struktur
```
tembak-game/
├── server.js       ← WebSocket + Express server
├── package.json
├── railway.json    ← Railway config
└── public/
    └── index.html  ← Game frontend
```

## Cara Main
- **WASD** = Gerak
- **Mouse** = Arah bidik  
- **Klik** = Tembak
- **R** = Reload
- Pertama capai **10 kills** = menang!
