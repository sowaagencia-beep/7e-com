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
     node deploy.mjs --prune    (apaga no servidor os ficheiros que ja
                                 nao existem localmente, SO dentro de
                                 data/ logotipo/ Imgens/ - nunca na raiz)

   Credenciais: lidas de <7-ECOM>/Secrects/7e-com_credenciais do servidor.txt
   ============================================================ */

import { Client } from 'basic-ftp';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, posix } from 'path';

const HERE = import.meta.dirname;
const PROJECT = join(HERE, '..');
const FORCE = process.argv.includes('--all');
const DRY = process.argv.includes('--dry');
const PRUNE = process.argv.includes('--prune');

// Credenciais: ficheiro de texto na pasta Secrects (fora do projeto e do git)
//   <7-ECOM>/Secrects/7e-com_credenciais do servidor.txt   (linhas "chave:valor")
const SECRETS_DIR = join(PROJECT, '..', 'Secrects');
const cfgPath = join(SECRETS_DIR, '7e-com_credenciais do servidor.txt');
if (!existsSync(cfgPath)) {
    console.error('Falta o ficheiro de credenciais FTP: ' + cfgPath);
    console.error('Formato (uma por linha):  host:...  Usuário de FTP:...  Senha:...  Porta:21');
    process.exit(1);
}
function lerCredenciais(path) {
    const kv = {};
    for (const linha of readFileSync(path, 'utf8').split(/\r?\n/)) {
        const i = linha.indexOf(':');
        if (i > 0) kv[linha.slice(0, i).trim().toLowerCase()] = linha.slice(i + 1).trim();
    }
    const get = (...ks) => { for (const k of Object.keys(kv)) if (ks.some(x => k.includes(x))) return kv[k]; };
    return {
        host: get('host'),
        user: get('usu', 'user'),
        password: get('senha', 'pass'),
        port: Number(get('porta', 'port')) || 21,
        remoteRoot: '/public_html',
    };
}
const CFG = lerCredenciais(cfgPath);
if (!CFG.host || !CFG.user || !CFG.password) {
    console.error('Credenciais incompletas em ' + cfgPath + ' (precisa de host, usuário e senha).');
    process.exit(1);
}
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

    // ---------- PRUNE ----------
    if (PRUNE) {
        console.log('\n--- Limpeza de ficheiros orfaos ---');
        const locais = new Set(files.map(f => f.remote));
        let apagados = 0, erros = 0;

        // Percorre o remoto SO dentro das pastas geridas por nos.
        async function varrer(remoteDir) {
            // trava de seguranca: nunca sair das pastas geridas
            const dentro = DIRS.some(d => {
                const raiz = posix.join(REMOTE_ROOT, d);
                return remoteDir === raiz || remoteDir.startsWith(raiz + '/');
            });
            if (!dentro) { console.log(`    (ignorado, fora do ambito: ${remoteDir})`); return; }

            let itens;
            try { itens = await client.list(remoteDir); }
            catch (e) { console.log(`    ! nao deu para listar ${remoteDir}: ${e.message}`); return; }

            for (const it of itens) {
                if (it.name === '.' || it.name === '..') continue;
                const rp = posix.join(remoteDir, it.name);
                if (it.isDirectory) { await varrer(rp); continue; }
                if (locais.has(rp)) continue;
                if (DRY) { console.log('  apagaria:', rp); apagados++; continue; }
                try {
                    await client.remove(rp);
                    apagados++;
                    if (apagados % 25 === 0) console.log(`  apagados ${apagados}...`);
                } catch (e) { console.log(`    ! falha ao apagar ${rp}: ${e.message}`); erros++; }
            }
        }

        for (const d of DIRS) await varrer(posix.join(REMOTE_ROOT, d));
        console.log(`\nLIMPEZA: ${apagados} ${DRY ? 'seriam apagados' : 'apagados'}, ${erros} falhas.`);
        if (erros) process.exitCode = 1;
    }

    if (failed) process.exitCode = 1;
} catch (err) {
    console.error('\n❌ ERRO:', err.message);
    process.exitCode = 1;
} finally {
    client.close();
}
