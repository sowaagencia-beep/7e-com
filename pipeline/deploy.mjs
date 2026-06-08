/* ============================================================
   7E-COM — Deploy incremental via FTP
   ------------------------------------------------------------
   Envia apenas ficheiros novos ou alterados (compara tamanhos),
   reconecta automaticamente em caso de queda de ligação.
   NÃO toca nos ficheiros do WordPress no servidor.

   USO:
     node deploy.mjs            (envia o que mudou)
     node deploy.mjs --all      (força reenvio de tudo)
     node deploy.mjs --dry      (mostra o que enviaria, sem enviar)

   Credenciais: lidas de pipeline/.ftp.json (fora do git).
   ============================================================ */

import { Client } from 'basic-ftp';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, posix } from 'path';

const HERE = import.meta.dirname;
const PROJECT = join(HERE, '..');
const FORCE = process.argv.includes('--all');
const DRY = process.argv.includes('--dry');

const cfgPath = join(HERE, '.ftp.json');
if (!existsSync(cfgPath)) {
    console.error('Falta pipeline/.ftp.json com as credenciais FTP. Exemplo:');
    console.error(JSON.stringify({ host:'ftp.7e-com.com.br', user:'w7e-com1', password:'***', port:21, remoteRoot:'/public_html' }, null, 2));
    process.exit(1);
}
const CFG = JSON.parse(readFileSync(cfgPath, 'utf8'));
const REMOTE_ROOT = CFG.remoteRoot || '/public_html';

// Itens do NOSSO site (nunca toca em WordPress)
const ROOT_FILES = ['index.html', 'styles.css', 'app.js'];
const DIRS = ['data', 'logotipo', 'Imgens'];

// Lista local recursiva -> [{local, remote, size}]
function walk(localDir, remoteDir, acc) {
    for (const f of readdirSync(localDir)) {
        const lp = join(localDir, f);
        const rp = posix.join(remoteDir, f);
        const st = statSync(lp);
        if (st.isDirectory()) walk(lp, rp, acc);
        else acc.push({ local: lp, remote: rp, size: st.size });
    }
    return acc;
}

const files = [];
for (const f of ROOT_FILES) {
    const lp = join(PROJECT, f);
    if (existsSync(lp)) files.push({ local: lp, remote: posix.join(REMOTE_ROOT, f), size: statSync(lp).size });
}
for (const d of DIRS) {
    const lp = join(PROJECT, d);
    if (existsSync(lp)) walk(lp, posix.join(REMOTE_ROOT, d), files);
}
console.log(`Ficheiros locais: ${files.length}`);

const client = new Client(60000);
client.ftp.verbose = false;

async function connect() {
    await client.access({ host: CFG.host, user: CFG.user, password: CFG.password, port: CFG.port || 21, secure: false });
}

// cache de tamanhos remotos por pasta (1 listagem por pasta)
const remoteSizeCache = new Map();
async function remoteSize(remotePath) {
    const dir = posix.dirname(remotePath);
    const name = posix.basename(remotePath);
    if (!remoteSizeCache.has(dir)) {
        const map = new Map();
        try { for (const it of await client.list(dir)) map.set(it.name, it.size); } catch {}
        remoteSizeCache.set(dir, map);
    }
    return remoteSizeCache.get(dir).get(name);
}

let uploaded = 0, skipped = 0, failed = 0;

async function withRetry(fn, label, tries = 4) {
    for (let i = 1; i <= tries; i++) {
        try { return await fn(); }
        catch (e) {
            console.log(`    ⚠ ${label}: ${e.message} (tentativa ${i}/${tries})`);
            if (i === tries) { failed++; return; }
            try { client.close(); } catch {}
            await new Promise(r => setTimeout(r, 1500 * i));
            await connect();
            remoteSizeCache.clear();
        }
    }
}

try {
    await connect();
    console.log('Ligado a', CFG.host, DRY ? '(DRY-RUN)' : '');

    for (const f of files) {
        const rsize = FORCE ? undefined : await remoteSize(f.remote);
        if (!FORCE && rsize === f.size) { skipped++; continue; }
        if (DRY) { console.log('  enviaria:', f.remote, `(${f.size}b)`); uploaded++; continue; }
        await withRetry(async () => {
            await client.ensureDir(posix.dirname(f.remote));
            await client.cd(REMOTE_ROOT);
            await client.uploadFrom(f.local, f.remote);
        }, f.remote);
        uploaded++;
        if (uploaded % 15 === 0) console.log(`  enviados ${uploaded}...`);
    }

    console.log(`\n✅ DEPLOY: ${uploaded} enviados, ${skipped} já atualizados, ${failed} falhas.`);
    if (failed) process.exitCode = 1;
} catch (err) {
    console.error('\n❌ ERRO:', err.message);
    process.exitCode = 1;
} finally {
    client.close();
}
