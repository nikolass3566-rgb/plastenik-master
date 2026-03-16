const admin = require('firebase-admin');
const http = require('http');

const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://smart-greenhouse-64351-default-rtdb.europe-west1.firebasedatabase.app"
});

const db = admin.database();
const DEVICE_ID = "SN_PLAST_01";

// Funkcija koja uvek vraća naše lokalno vreme (Srbija/BiH/CG) bez obzira gde je Render server
function getLocalTime() {
    const now = new Date();
    // Pomeramo vreme za +1 ili +2 sata u zavisnosti od letnjeg računanja (Render je UTC)
    // Najsigurnije je koristiti localeString
    return new Date(now.toLocaleString("en-US", {timeZone: "Europe/Belgrade"}));
}

function getFmtDate(d) {
    return `${d.getDate()}-${d.getMonth() + 1}-${d.getFullYear()}`;
}

async function saveToHistory() {
    try {
        const localNow = getLocalTime();
        const dateStr = getFmtDate(localNow);
        const hh = String(localNow.getHours()).padStart(2, '0');
        const mm = String(localNow.getMinutes()).padStart(2, '0');
        const ts = localNow.getTime();
        const vremeString = localNow.toLocaleTimeString('sr-RS', { hour: '2-digit', minute: '2-digit' });

        // 1. Provera poslednjeg upisa da ne dupliramo
        const hourRef = db.ref(`history/${DEVICE_ID}/${dateStr}/${hh}`);
        const hourSnap = await hourRef.once('value');

        if (hourSnap.exists()) {
            const entries = hourSnap.val();
            let lastTs = 0;
            Object.keys(entries).forEach(minKey => {
                const minData = entries[minKey];
                Object.keys(minData).forEach(tsKey => {
                    if (parseInt(tsKey) > lastTs) lastTs = parseInt(tsKey);
                });
            });
            if ((ts - lastTs) / 1000 < 55) return; 
        }

        // 2. Čitanje iz 'uredjaji'
        const deviceSnap = await db.ref(`uredjaji/${DEVICE_ID}`).once('value');
        if (!deviceSnap.exists()) return;
        const data = deviceSnap.val();

        // 3. Upis u istoriju - IDENTIČNO kao u tvom JSON-u
        const historyPath = `history/${DEVICE_ID}/${dateStr}/${hh}/${mm}/${ts}`;
        await db.ref(historyPath).set({
            temp: parseFloat(data.temp) || 0,
            vlaga: parseFloat(data.vlaga) || 0,
            vlaga_tla: parseFloat(data.vlaga_tla) || 0,
            timestamp: ts,
            time: vremeString
        });

        // 4. Ažuriranje statusa u 'uredjaji'
        await db.ref(`uredjaji/${DEVICE_ID}`).update({
            zadnje_osvezavanje: vremeString,
            zadnji_update: ts
        });

        console.log(`✅ Uspešno upisano na: ${historyPath}`);

    } catch (error) {
        console.error("Greška:", error);
    }
}

async function cleanOldHistory() {
    const ref = db.ref(`history/${DEVICE_ID}`);
    try {
        const snapshot = await ref.once('value');
        if (!snapshot.exists()) return;
        const localNow = getLocalTime();
        const limit = new Date(localNow);
        limit.setDate(localNow.getDate() - 3);

        snapshot.forEach((child) => {
            const dateStr = child.key;
            const parts = dateStr.split('-');
            const folderDate = new Date(parts[2], parts[1] - 1, parts[0]);
            if (folderDate < limit) child.ref.remove();
        });
    } catch (error) { console.error(error); }
}

setInterval(saveToHistory, 30 * 1000);
setInterval(cleanOldHistory, 12 * 60 * 60 * 1000);
saveToHistory();
cleanOldHistory();

http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Server aktivan. Proverite folder history u bazi.');
}).listen(process.env.PORT || 3000);