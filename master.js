const admin = require('firebase-admin');
const http = require('http');

// Učitavanje konfiguracije iz Render Environment Variables
const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);

// Popravka za privatni ključ (rešava problem sa novim redovima)
serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://smart-greenhouse-64351-default-rtdb.europe-west1.firebasedatabase.app"
});

const db = admin.database();
const DEVICE_ID = "SN_PLAST_01";

// Funkcija za formatiranje datuma u DD-M-YYYY (kako tvoja aplikacija zahteva)
function getFmtDate(d) {
    return `${d.getDate()}-${d.getMonth() + 1}-${d.getFullYear()}`;
}

// --- 1. FUNKCIJA ZA PAMETNO I BRZO UPISIVANJE ---
async function saveToHistory() {
    try {
        const now = new Date();
        const dateStr = getFmtDate(now);
        const hh = String(now.getHours()).padStart(2, '0');
        
        // Provera poslednjeg upisa u trenutnom satu
        const hourRef = db.ref(`history/${DEVICE_ID}/${dateStr}/${hh}`);
        const hourSnap = await hourRef.once('value');

        if (hourSnap.exists()) {
            const entries = hourSnap.val();
            let lastTs = 0;

            // Pronalazimo najnoviji timestamp u bazi
            Object.keys(entries).forEach(minKey => {
                const minData = entries[minKey];
                Object.keys(minData).forEach(tsKey => {
                    const ts = parseInt(tsKey);
                    if (ts > lastTs) lastTs = ts;
                });
            });

            const diffSeconds = (now.getTime() - lastTs) / 1000;

            // Ako je neko (App ili Server) upisao pre manje od 55 sekundi, preskačemo
            if (diffSeconds < 55) {
                return; 
            }
        }

        // Uzimanje trenutnih podataka sa uređaja (ESP8266)
        const deviceSnap = await db.ref(`devices/${DEVICE_ID}`).once('value');
        if (!deviceSnap.exists()) {
            console.log("ESP8266 nije poslao podatke, preskačem upis.");
            return;
        }

        const data = deviceSnap.val();
        const mm = String(now.getMinutes()).padStart(2, '0');
        const ts = now.getTime();

        // Upis u istoriju
        await db.ref(`history/${DEVICE_ID}/${dateStr}/${hh}/${mm}/${ts}`).set({
            temp: parseFloat(data.temp) || 0,
            vlaga: parseFloat(data.vlaga) || 0,
            vlaga_tla: parseFloat(data.vlaga_tla) || 0,
            timestamp: ts,
            time: now.toLocaleTimeString('sr-RS', { hour: '2-digit', minute: '2-digit' })
        });

        console.log(`⏱️ Podatak upisan: ${hh}:${mm}:${now.getSeconds()}s`);

    } catch (error) {
        console.error("Greška pri upisu:", error);
    }
}

// --- 2. FUNKCIJA ZA ČIŠĆENJE STARE ISTORIJE ---
async function cleanOldHistory() {
    console.log("Pokrećem automatsko čišćenje baze (starije od 3 dana)...");
    const ref = db.ref(`history/${DEVICE_ID}`);
    
    try {
        const snapshot = await ref.once('value');
        if (!snapshot.exists()) return;

        const today = new Date();
        const limit = new Date();
        limit.setDate(today.getDate() - 3);

        snapshot.forEach((child) => {
            const dateStr = child.key;
            const parts = dateStr.split('-');
            const folderDate = new Date(parts[2], parts[1] - 1, parts[0]);

            if (folderDate < limit) {
                console.log(`🗑️ Obrisano: ${dateStr}`);
                child.ref.remove();
            }
        });
    } catch (error) {
        console.error("Greška pri čišćenju:", error);
    }
}

// --- TAJMERI ---

// Proveravaj i upisuj svakih 30 sekundi
setInterval(saveToHistory, 30 * 1000);

// Čisti bazu svakih 12 sati
setInterval(cleanOldHistory, 12 * 60 * 60 * 1000);

// Pokreni odmah pri startu
saveToHistory();
cleanOldHistory();

// HTTP server da Render ne ugasi aplikaciju
http.createServer((req, res) => {
  res.writeHead(200, {'Content-Type': 'text/plain'});
  res.end('Smart Greenhouse Server is Active\n');
}).listen(process.env.PORT || 3000);