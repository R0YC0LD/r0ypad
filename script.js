const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// --- AYARLAR ---
const MAP_WIDTH = 4000;
const MAP_HEIGHT = 4000;
const INITIAL_RADIUS = 20;
const MAX_FOOD = 600;
const BOT_COUNT = 20;
const CAMERA_SMOOTHING = 0.1;

// Renk Paleti
const COLORS = ['#ff4757', '#2ed573', '#1e90ff', '#ffa502', '#8e44ad', '#00b894', '#e17055'];

// Oyun Durumu
let gameRunning = false;
let foods = [];
let bots = [];
let ejectedMasses = [];
let player = {
    cells: [],
    name: "Player",
    score: 0
};

// Kamera
let camX = 0;
let camY = 0;
let zoom = 1;

// Tuş Kontrolleri
const keys = { w: false, a: false, s: false, d: false };

// --- YARDIMCI FONKSİYONLAR ---
function randomRange(min, max) { return Math.random() * (max - min) + min; }
function randomColor() { return COLORS[Math.floor(Math.random() * COLORS.length)]; }

// Mesafe Hesaplama (Pisagor)
function getDist(x1, y1, x2, y2) {
    let dx = x2 - x1;
    let dy = y2 - y1;
    return Math.sqrt(dx * dx + dy * dy);
}

// Daire Çizimi
function drawCircle(x, y, radius, color, name = null) {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = adjustColor(color, -40); // Kenarlık biraz daha koyu
    ctx.stroke();
    ctx.closePath();

    if (name) {
        ctx.fillStyle = 'white';
        ctx.font = `bold ${Math.max(12, radius / 2)}px Ubuntu`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.strokeStyle = 'black';
        ctx.lineWidth = 1;
        ctx.strokeText(name, x, y);
        ctx.fillText(name, x, y);
    }
}

// Rengi koyulaştırma (Kenarlıklar için)
function adjustColor(color, amount) {
    return color; // Basitlik için orijinal rengi dönüyor, hex manipülasyonu eklenebilir
}

// --- SINIFLAR ---

class Food {
    constructor() {
        this.x = randomRange(0, MAP_WIDTH);
        this.y = randomRange(0, MAP_HEIGHT);
        this.radius = randomRange(4, 8);
        this.color = randomColor();
    }
    draw() {
        // Performans için basit çizim
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.fill();
    }
}

class EjectedMass {
    constructor(x, y, angle, color) {
        this.x = x;
        this.y = y;
        this.radius = 15;
        this.color = color;
        this.speed = 25;
        this.angle = angle;
        this.decay = 0.9; // Hız azalma çarpanı
    }

    update() {
        this.x += Math.cos(this.angle) * this.speed;
        this.y += Math.sin(this.angle) * this.speed;
        this.speed *= this.decay;
        if (this.speed < 0.5) this.speed = 0;
    }

    draw() {
        drawCircle(this.x, this.y, this.radius, this.color);
    }
}

class Cell {
    constructor(x, y, radius, color, isBot = false, name = "") {
        this.x = x;
        this.y = y;
        this.radius = radius;
        this.color = color;
        this.isBot = isBot;
        this.name = name;
        this.vx = 0;
        this.vy = 0;
        this.speedBase = 4;
        this.targetX = x; // Botlar için
        this.targetY = y;
        this.mergeTimer = 0; // Bölündükten sonra birleşme süresi
        this.canMerge = true;
    }

    getMass() { return this.radius * this.radius; }
    setMass(mass) { this.radius = Math.sqrt(mass); }

    move(inputX, inputY) {
        // Kütle arttıkça hız azalır
        let speed = this.speedBase * Math.pow(this.radius, -0.4) * 5;
        
        // Vektör Normalizasyonu (Çapraz giderken hızlanmamak için)
        if (inputX !== 0 || inputY !== 0) {
            let length = Math.sqrt(inputX**2 + inputY**2);
            inputX /= length;
            inputY /= length;
        }

        this.vx = inputX * speed;
        this.vy = inputY * speed;

        this.x += this.vx;
        this.y += this.vy;

        // Harita Sınırları
        this.x = Math.max(this.radius, Math.min(MAP_WIDTH - this.radius, this.x));
        this.y = Math.max(this.radius, Math.min(MAP_HEIGHT - this.radius, this.y));
    }

    botAI() {
        // Hedef yön değişimleri
        let targetDx = 0;
        let targetDy = 0;
        
        // Karar Ağırlıkları (Öncelik Sırası)
        let fleeWeight = 50;  // Kaçma önceliği en yüksek
        let huntWeight = 30;  // Avlanma önceliği orta
        let foodWeight = 1;   // Yem yeme önceliği en düşük

        let actionFound = false;

        // 1. TEHDİT ANALİZİ (Korku Modu)
        // Kendinden büyük (%20 daha büyük) hücrelerden kaç
        let nearestThreat = null;
        let minThreatDist = 300 + this.radius; // Görüş mesafesi

        // Oyuncuyu kontrol et
        player.cells.forEach(pCell => {
            if (pCell.radius > this.radius * 1.2) { // Eğer oyuncu benden %20 büyükse
                let d = getDist(this.x, this.y, pCell.x, pCell.y);
                if (d < minThreatDist) {
                    nearestThreat = pCell;
                    minThreatDist = d;
                }
            }
        });

        // Diğer botları kontrol et
        if (!nearestThreat) {
            bots.forEach(b => {
                if (b !== this && b.radius > this.radius * 1.2) {
                    let d = getDist(this.x, this.y, b.x, b.y);
                    if (d < minThreatDist) {
                        nearestThreat = b;
                        minThreatDist = d;
                    }
                }
            });
        }

        if (nearestThreat) {
            // Tehditten ters yöne kaçış vektörü hesapla
            targetDx = this.x - nearestThreat.x;
            targetDy = this.y - nearestThreat.y;
            actionFound = true;
        }

        // 2. AVLANMA ANALİZİ (Saldırı Modu)
        // Eğer kaçmıyorsak ve yiyebileceğimiz (%20 küçük) biri varsa kovala
        if (!actionFound) {
            let nearestPrey = null;
            let minPreyDist = 250 + this.radius;

            // Oyuncuyu avla
            player.cells.forEach(pCell => {
                if (this.radius > pCell.radius * 1.2) { // Ben oyuncudan büyüğüm
                    let d = getDist(this.x, this.y, pCell.x, pCell.y);
                    if (d < minPreyDist) {
                        nearestPrey = pCell;
                        minPreyDist = d;
                    }
                }
            });

            // Diğer küçük botları avla
            if (!nearestPrey) {
                bots.forEach(b => {
                    if (b !== this && this.radius > b.radius * 1.2) {
                        let d = getDist(this.x, this.y, b.x, b.y);
                        if (d < minPreyDist) {
                            nearestPrey = b;
                            minPreyDist = d;
                        }
                    }
                });
            }

            if (nearestPrey) {
                targetDx = nearestPrey.x - this.x;
                targetDy = nearestPrey.y - this.y;
                actionFound = true;
            }
        }

        // 3. BESLENME (Otlanma Modu)
        // Tehlike veya av yoksa yeme git
        if (!actionFound) {
            let closestFood = null;
            let minFoodDist = 150 + this.radius; // Yem görüş mesafesi daha kısa olabilir

            for (let f of foods) {
                let d = getDist(this.x, this.y, f.x, f.y);
                if (d < minFoodDist) {
                    minFoodDist = d;
                    closestFood = f;
                }
            }

            if (closestFood) {
                targetDx = closestFood.x - this.x;
                targetDy = closestFood.y - this.y;
            } else {
                // Etrafta hiçbir şey yoksa rastgele süzül (Perlin noise benzeri yumuşak geçiş)
                // Mevcut hedefe doğru yavaşça devam et, ara sıra yön değiştir
                if (Math.random() < 0.05) {
                    this.randomTargetX = randomRange(0, MAP_WIDTH) - this.x;
                    this.randomTargetY = randomRange(0, MAP_HEIGHT) - this.y;
                }
                targetDx = this.randomTargetX || 0;
                targetDy = this.randomTargetY || 0;
            }
        }

        // Hareketi Uygula
        this.move(targetDx, targetDy);
    }
}

// --- OYUN MANTIĞI ---

function initGame() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    foods = [];
    for (let i = 0; i < MAX_FOOD; i++) foods.push(new Food());

    bots = [];
    for (let i = 0; i < BOT_COUNT; i++) {
        bots.push(new Cell(
            randomRange(0, MAP_WIDTH),
            randomRange(0, MAP_HEIGHT),
            randomRange(20, 50),
            randomColor(),
            true,
            "Bot " + (i+1)
        ));
    }

    player.cells = [new Cell(MAP_WIDTH/2, MAP_HEIGHT/2, INITIAL_RADIUS, randomColor(), false, player.name)];
    gameRunning = true;
    requestAnimationFrame(gameLoop);
}

function handleInput() {
    let dx = 0;
    let dy = 0;
    if (keys.w) dy = -1;
    if (keys.s) dy = 1;
    if (keys.a) dx = -1;
    if (keys.d) dx = 1;

    player.cells.forEach(cell => cell.move(dx, dy));
}

function checkCollisions() {
    // 1. Oyuncu Yem Yemesi
    player.cells.forEach(pCell => {
        for (let i = foods.length - 1; i >= 0; i--) {
            if (getDist(pCell.x, pCell.y, foods[i].x, foods[i].y) < pCell.radius + foods[i].radius) {
                // Alan hesabı: Area += AreaFood
                let newArea = Math.PI * pCell.radius * pCell.radius + Math.PI * foods[i].radius * foods[i].radius;
                pCell.radius = Math.sqrt(newArea / Math.PI);
                foods.splice(i, 1);
                foods.push(new Food()); // Yeni yem üret
                player.score += 1;
            }
        }

        // Oyuncu atılan parçayı (V) yiyor mu?
        for (let i = ejectedMasses.length - 1; i >= 0; i--) {
            let mass = ejectedMasses[i];
            // Kendi attığını hemen yiyemez (hız kontrolü basit yöntem)
            if (mass.speed < 5 && getDist(pCell.x, pCell.y, mass.x, mass.y) < pCell.radius) {
                 let newArea = Math.PI * pCell.radius * pCell.radius + Math.PI * mass.radius * mass.radius;
                 pCell.radius = Math.sqrt(newArea / Math.PI);
                 ejectedMasses.splice(i, 1);
            }
        }
    });

    // 2. Oyuncu vs Bot Etkileşimi
    player.cells.forEach((pCell, pIdx) => {
        bots.forEach((bot, bIdx) => {
            let dist = getDist(pCell.x, pCell.y, bot.x, bot.y);
            
            // Oyuncu Botu Yerse
            if (dist < pCell.radius && pCell.radius > bot.radius * 1.1) {
                let newArea = Math.PI * pCell.radius * pCell.radius + Math.PI * bot.radius * bot.radius;
                pCell.radius = Math.sqrt(newArea / Math.PI);
                
                // Botu respawn et
                bot.x = randomRange(0, MAP_WIDTH);
                bot.y = randomRange(0, MAP_HEIGHT);
                bot.radius = randomRange(20, 40);
                player.score += 100;
            }
            // Bot Oyuncuyu Yerse
            else if (dist < bot.radius && bot.radius > pCell.radius * 1.1) {
                // Bu hücre ölür
                player.cells.splice(pIdx, 1);
                if(player.cells.length === 0) gameOver();
            }
        });
    });

    // 3. Bot Yem Yemesi (Basit simülasyon)
    bots.forEach(bot => {
        for (let i = foods.length - 1; i >= 0; i--) {
            if (getDist(bot.x, bot.y, foods[i].x, foods[i].y) < bot.radius) {
                 let newArea = Math.PI * bot.radius * bot.radius + Math.PI * foods[i].radius * foods[i].radius;
                 bot.radius = Math.sqrt(newArea / Math.PI);
                 foods.splice(i, 1);
                 foods.push(new Food());
            }
        }
    });
}

function splitPlayer() {
    let newCells = [];
    player.cells.forEach(cell => {
        if (cell.radius >= 30 && player.cells.length < 16) {
            let newMass = cell.getMass() / 2;
            cell.setMass(newMass);

            let splitCell = new Cell(cell.x, cell.y, cell.radius, cell.color, false, cell.name);
            
            // Fırlatma yönü (Son hareket yönüne göre)
            let angle = Math.atan2(cell.vy, cell.vx);
            if(cell.vx === 0 && cell.vy === 0) angle = 0; // Duruyorsa sağa

            // Hızlıca ileri atılma (Boost)
            splitCell.x += Math.cos(angle) * cell.radius * 2; 
            splitCell.y += Math.sin(angle) * cell.radius * 2;
            
            newCells.push(splitCell);
        }
    });
    player.cells = player.cells.concat(newCells);
}

function ejectMass() {
    player.cells.forEach(cell => {
        if (cell.radius > 30) {
            // Kütle kaybet
            let massLoss = 150; // Kaybedilen alan
            let currentMass = cell.getMass();
            cell.setMass(currentMass - massLoss);

            // Parça fırlat
            let angle = Math.atan2(cell.vy, cell.vx);
            if(cell.vx === 0 && cell.vy === 0) angle = 0;

            let eX = cell.x + Math.cos(angle) * cell.radius;
            let eY = cell.y + Math.sin(angle) * cell.radius;
            
            ejectedMasses.push(new EjectedMass(eX, eY, angle, cell.color));
        }
    });
}

function gameOver() {
    gameRunning = false;
    alert("Oyun Bitti! Skorun: " + Math.floor(player.score));
    document.getElementById('menuOverlay').style.display = 'flex';
    document.getElementById('uiOverlay').style.display = 'none';
}

function drawGrid() {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    const gridSize = 50;

    for (let x = 0; x < MAP_WIDTH; x += gridSize) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, MAP_HEIGHT); ctx.stroke();
    }
    for (let y = 0; y < MAP_HEIGHT; y += gridSize) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(MAP_WIDTH, y); ctx.stroke();
    }
}

function updateCamera() {
    if (player.cells.length === 0) return;

    // Oyuncu hücrelerinin ortasını bul
    let totalX = 0, totalY = 0, totalR = 0;
    player.cells.forEach(c => {
        totalX += c.x;
        totalY += c.y;
        totalR += c.radius;
    });
    
    let targetX = totalX / player.cells.length;
    let targetY = totalY / player.cells.length;

    // Kamera yumuşatma
    camX += (targetX - camX) * CAMERA_SMOOTHING;
    camY += (targetY - camY) * CAMERA_SMOOTHING;

    // Zoom ayarı (oyuncu büyüdükçe kamera uzaklaşır)
    let avgRadius = totalR / player.cells.length;
    let targetZoom = 100 / (avgRadius + 100) * 1.5; // Basit bir zoom formülü
    targetZoom = Math.max(0.5, Math.min(1.5, targetZoom));
    zoom += (targetZoom - zoom) * 0.05;
}

function gameLoop() {
    if (!gameRunning) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    handleInput();
    bots.forEach(bot => bot.botAI());
    ejectedMasses.forEach(m => m.update());
    checkCollisions();
    updateCamera();

    // UI Güncelle
    document.getElementById('scoreDisplay').innerText = Math.floor(player.score);

    // --- ÇİZİM İŞLEMLERİ ---
    ctx.save();
    
    // Kamerayı merkeze al
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-camX, -camY);

    drawGrid();

    // Ejected Mass
    ejectedMasses.forEach(m => m.draw());

    // Yemler
    foods.forEach(f => f.draw());

    // Botlar ve Oyuncu (Sıralı çizim: küçükler altta kalsın diye yarıçapa göre sort edilebilir)
    let allCells = [...bots, ...player.cells];
    allCells.sort((a, b) => a.radius - b.radius);

    allCells.forEach(cell => {
        drawCircle(cell.x, cell.y, cell.radius, cell.color, cell.name);
    });

    // Harita Sınırları
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 10;
    ctx.strokeRect(0, 0, MAP_WIDTH, MAP_HEIGHT);

    ctx.restore();

    requestAnimationFrame(gameLoop);
}

// --- EVENT LISTENERS ---

window.addEventListener('resize', () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
});

window.addEventListener('keydown', (e) => {
    if (e.key === 'w' || e.key === 'W') keys.w = true;
    if (e.key === 'a' || e.key === 'A') keys.a = true;
    if (e.key === 's' || e.key === 'S') keys.s = true;
    if (e.key === 'd' || e.key === 'D') keys.d = true;
    if (e.code === 'Space') splitPlayer();
    if (e.key === 'v' || e.key === 'V') ejectMass();
});

window.addEventListener('keyup', (e) => {
    if (e.key === 'w' || e.key === 'W') keys.w = false;
    if (e.key === 'a' || e.key === 'A') keys.a = false;
    if (e.key === 's' || e.key === 'S') keys.s = false;
    if (e.key === 'd' || e.key === 'D') keys.d = false;
});

document.getElementById('startButton').addEventListener('click', () => {
    let name = document.getElementById('playerName').value || "Player";
    player.name = name;
    document.getElementById('menuOverlay').style.display = 'none';
    document.getElementById('uiOverlay').style.display = 'block';
    initGame();
});
