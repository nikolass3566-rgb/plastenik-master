const admin = require('firebase-admin');
const http = require('http');

// 1. Inicijalizacija Firebase-a preko Environment Varijable
const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://smart-greenhouse-64351-default-rtdb.europe-west1.firebasedatabase.app"
});

const db = admin.database();
const DEVICE_ID = "SN_PLAST_01";

// Pomoćna funkcija za format datuma DD-M-YYYY
function getFmtDate(d) {
    return `${d.getDate()}-${d.getMonth() + 1}-${d.getFullYear()}`;
}

// --- GLAVNA FUNKCIJA ZA ISTORIJU I OSVEŽAVANJE ---
async function saveToHistory() {
    try {
        const now = new Date();
        const dateStr = getFmtDate(now);
        const hh = String(now.getHours()).padStart(2, '0');
        const mm = String(now.getMinutes()).padStart(2, '0');
        const ts = now.getTime();
        const vremeString = now.toLocaleTimeString('sr-RS', { hour: '2-digit', minute: '2-digit' });

        // A. Provera da li je podatak već upisan u poslednjih 55 sekundi
        const hourRef = db.ref(`history/${DEVICE_ID}/${dateStr}/${hh}`);
        const hourSnap = await hourRef.once('value');

        if (hourSnap.exists()) {
            const entries = hourSnap.val();
            let lastTs = 0;
            Object.keys(entries).forEach(minKey => {
                const minData = entries[minKey];
                Object.keys(minData).forEach(tsKey => {
                    const t = parseInt(tsKey);
                    if (t > lastTs) lastTs = t;
                });
            });

            const diffSeconds = (ts - lastTs) / 1000;
            if (diffSeconds < 55) {
                // Već postoji svež upis, preskačemo da ne dupliramo aplikaciju
                return; 
            }
        }

        // B. Uzimanje podataka iz čvora 'uredjaji' (kako je na slici)
        const deviceSnap = await db.ref(`uredjaji/${DEVICE_ID}`).once('value');
        if (!deviceSnap.exists()) {
            console.log("Upozorenje: Čvor uredjaji/SN_PLAST_01 ne postoji u bazi.");
            return;
        }

        const data = deviceSnap.val();

        // C. Upis u ISTORIJU (za grafik u aplikaciji)
        await db.ref(`history/${DEVICE_ID}/${dateStr}/${hh}/${mm}/${ts}`).set({
            temp: parseFloat(data.temp) || 0,
            vlaga: parseFloat(data.vlaga) || 0,
            vlaga_tla: parseFloat(data.vlaga_tla) || 0,
            timestamp: ts,
            time: vremeString
        });

        // D. Ažuriranje tajmera u glavnom čvoru (da aplikacija vidi da je osveženo)
        await db.ref(`uredjaji/${DEVICE_ID}`).update({
            zadnje_osvezavanje: vremeString,
            zadnji_update: ts
        });

        console.log(`⏱️ [${vremeString}] Uspešno ažurirana istorija i status uređaja.`);

    } catch (error) {
        console.error("Greška u saveToHistory:", error);
    }
}

// --- FUNKCIJA ZA ČIŠĆENJE STARIH PODATAKA (3 DANA) ---
async function cleanOldHistory() {
    console.log("Pokrećem proveru za brisanje starih podataka...");
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
                console.log(`🗑️ Brišem istoriju za datum: ${dateStr}`);
                child.ref.remove();
            }
        });
    } catch (error) {
        console.error("Greška u cleanOldHistory:", error);
    }
}

// --- TAJMERI I SERVER ---

// Provera na svakih 30 sekundi
setInterval(saveToHistory, 30 * 1000);

// Čišćenje baze na svakih 12 sati
setInterval(cleanOldHistory, 12 * 60 * 60 * 1000);

// Pokreni odmah pri startovanju servera
saveToHistory();
cleanOldHistory();

// Minimalni HTTP server za Render
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Pametni Plastenik Server je aktivan i prati čvor "uredjaji".\n');
});

server.listen(process.env.PORT || 3000, () => {
  console.log("Server je pokrenut i sluša...");
});