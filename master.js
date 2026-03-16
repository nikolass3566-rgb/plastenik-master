const admin = require('firebase-admin');
const http = require('http');

// Umesto putanje do fajla, koristimo Environment Variable
// Render će ovaj tekst pročitati iz svojih podešavanja
const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://smart-greenhouse-64351-default-rtdb.europe-west1.firebasedatabase.app"
});

const db = admin.database();

async function cleanHistory() {
    console.log("Provera baze započeta...");
    const ref = db.ref('history/SN_PLAST_01');
    
    try {
        const snapshot = await ref.once('value');
        if (!snapshot.exists()) return;

        const today = new Date();
        const limit = new Date();
        limit.setDate(today.getDate() - 3); // Granica od 3 dana

        snapshot.forEach((child) => {
            const dateStr = child.key; // npr. "10-3-2026"
            const parts = dateStr.split('-');
            const folderDate = new Date(parts[2], parts[1] - 1, parts[0]);

            if (folderDate < limit) {
                console.log(`Brisanje starog datuma: ${dateStr}`);
                child.ref.remove();
            }
        });
    } catch (e) {
        console.error("Greška:", e);
    }
}

// Čišćenje na svakih 12 sati i odmah pri pokretanju
setInterval(cleanHistory, 12 * 60 * 60 * 1000);
cleanHistory();

// Mini-server koji drži aplikaciju "budnom" na Renderu
http.createServer((req, res) => {
  res.writeHead(200, {'Content-Type': 'text/plain'});
  res.end('Smart Greenhouse Cleaner is Running...\n');
}).listen(process.env.PORT || 3000);