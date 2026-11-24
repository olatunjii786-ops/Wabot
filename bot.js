const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const fs = require('fs');

// Your phone number: digits only, with country code
const PHONE_NUMBER = '2349014094846';

// Set to true to force a fresh pairing (deletes auth_info on start)
const FORCE_FRESH_PAIRING = false;

async function startBot() {
    // Optional: wipe session folder for a clean start
    if (FORCE_FRESH_PAIRING && fs.existsSync('auth_info')) {
        fs.rmSync('auth_info', { recursive: true, force: true });
        console.log('Deleted old auth_info folder.');
    }

    const { state, saveCreds } = await useMultiFileAuthState('auth_info');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        // Keep default browser; custom labels can break pairing
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        // Request pairing code only when unregistered and QR event fires
        if (qr && !sock.authState.creds.registered) {
            try {
                const code = await sock.requestPairingCode(PHONE_NUMBER);
                console.log(`\n🔑 PAIRING CODE: ${code}`);
                console.log('Enter on phone: WhatsApp > Linked Devices > Link with phone number instead\n');
            } catch (err) {
                console.error('Pairing code request failed:', err.message);
            }
        }

        if (connection === 'open') {
            console.log('✅ Bot connected successfully!');
        }

        if (connection === 'close') {
            const statusCode = (lastDisconnect?.error instanceof Boom)
                ? lastDisconnect.error.output?.statusCode
                : undefined;

            const reason = lastDisconnect?.error?.message || 'unknown';
            console.log(`❌ Connection closed. Code: ${statusCode}, Reason: ${reason}`);

            // Do NOT reconnect on logged-out / 401 / 403 — session is dead
            const isLoggedOut = statusCode === DisconnectReason.loggedOut
                || statusCode === 401
                || statusCode === 403;

            if (isLoggedOut) {
                console.log('Session invalid. Delete the auth_info folder and re-pair.');
                console.log('Tip: set FORCE_FRESH_PAIRING = true and rerun.');
                process.exit(0);
            }

            // Reconnect with a short delay to let creds flush to disk
            console.log('Reconnecting in 3 seconds...');
            setTimeout(() => startBot(), 3000);
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // Auto-reply handler
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg?.message) return;
        if (msg.key.fromMe) return;
        if (msg.key.remoteJid === 'status@broadcast') return;
        if (msg.key.remoteJid?.endsWith('@g.us')) return; // ignore groups (optional)

        const text =
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            '';

        if (!text) return;

        console.log(`📩 ${msg.key.remoteJid}: "${text}"`);

        const replyText = `Auto-reply: I received your message ("${text}"). I'll get back to you soon.`;

        try {
            await sock.sendMessage(msg.key.remoteJid, { text: replyText });
        } catch (err) {
            console.error('Send failed:', err.message);
        }
    });
}

startBot();