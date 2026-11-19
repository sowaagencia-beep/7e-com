/* ============================================================
   7E-COM — Sincronizar o site a partir dos catálogos Collection
   ------------------------------------------------------------
   Fonte da verdade: <Collection>/<PASTA>/productos.js  +  produtos/
   (dados limpos, revistos à mão — sem os erros de OCR do PDF).

   Reconstrói por completo as categorias indicadas em CATS.
   As categorias fora de CATS (7business) ficam intactas.

   USO:
     node sync-collection.mjs [--dry] [--only 7home,7pro]
   ============================================================ */

import sharp from 'sharp';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync, cpSync } from 'fs';
import { join, basename } from 'path';

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry');
function flag(n) { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; }

const PROJECT = join(import.meta.dirname, '..');
const COLLECTION = join(PROJECT, '..', 'Collection');
const DATA_JSON = join(PROJECT, 'data', 'products.json');
const DATA_JS = join(PROJECT, 'data', 'products.js');

const CATS = [
    { dir: '7_HOME',    cat: '7home',    label: '7Home' },
    { dir: '7_PRO',     cat: '7pro',     label: '7Pro' },
    { dir: '7_TECH',    cat: '7tech',    label: '7Tech' },
    { dir: '7_STORAGE', cat: '7storage', label: '7Storage' },
    { dir: '7_BIKE',    cat: '7bike',    label: '7Bike' },
];
const only = flag('--only');
const TARGETS = only ? CATS.filter(c => only.split(',').includes(c.cat)) : CATS;

console.log(`\n=== Sincronizar site <- Collection ===`);
console.log(`Collection: ${COLLECTION}`);
console.log(`Categorias: ${TARGETS.map(t => t.cat).join(', ')}`);
console.log(`Modo:       ${DRY ? 'DRY-RUN (não grava)' : 'GRAVAR'}\n`);

// ---------- ler catálogo ----------
function lerCatalogo(dir) {
    const src = readFileSync(join(COLLECTION, dir, 'productos.js'), 'utf8');
    const fn = new Function(src.replace(/\bconst\s+PRODUCTOS\b/, 'const __P') + '\nreturn __P;');
    return fn().filter(p => p && p.codigo);
}

// primeiro código da lista "A (cor) / B (cor)", sem o parêntese
const primeiroCodigo = s => String(s).split('/')[0].trim().replace(/\s*\(.*$/, '').trim();
const todosCodigos = s => String(s).split('/').map(x => x.trim().replace(/\s*\(.*$/, '').trim()).filter(Boolean);

// ---------- resolver a foto de um produto ----------
function resolverFoto(p, dir, ficheiros) {
    const porBase = {};
    for (const f of ficheiros) porBase[f.replace(/\.[^.]+$/, '').toUpperCase()] = f;
    if (p.foto) {
        const f = basename(p.foto);
        if (ficheiros.includes(f)) return f;
    }
    for (const c of todosCodigos(p.codigo)) {
        const hit = porBase[c.toUpperCase()];
        if (hit) return hit;
    }
    return null;
}

const relatorio = { semFoto: [], duplicados: [], total: 0 };
const novosRegistos = [];
const imagensPorCategoria = {};

for (const { dir, cat, label } of TARGETS) {
    const produtos = lerCatalogo(dir);
    const pastaFotos = join(COLLECTION, dir, 'produtos');
    const ficheiros = existsSync(pastaFotos) ? readdirSync(pastaFotos) : [];

    const vistos = new Set();
    const registos = [];
    const copias = [];

    for (const [i, p] of produtos.entries()) {
        // colapsa duplicados exatos (mesmo código + título + foto)
        const chave = `${p.codigo}||${p.titulo}||${p.foto || ''}`;
        if (vistos.has(chave)) { relatorio.duplicados.push(`${cat}: ${p.codigo} — ${p.titulo}`); continue; }
        vistos.add(chave);

        const foto = resolverFoto(p, dir, ficheiros);
        if (!foto) relatorio.semFoto.push(`${cat}: ${p.codigo} — ${p.titulo}`);

        const base = foto
            ? foto.replace(/\.[^.]+$/, '')
            : (primeiroCodigo(p.codigo).replace(/[^A-Za-z0-9-]/g, '') || `item-${i}`);
        const nomeImg = `${base.replace(/[^A-Za-z0-9._-]/g, '-')}.jpg`;

        if (foto) copias.push({ src: join(pastaFotos, foto), out: nomeImg });

        registos.push({
            category: cat,
            categoryLabel: label,
            page: `col-${cat}-${String(i + 1).padStart(3, '0')}`,   // id único e estável
            image: `Imgens/Products/${cat}/${nomeImg}`,
            name: p.titulo || '',
            model: [p.marca ? String(p.marca).toUpperCase() : '', p.subtitulo || ''].filter(Boolean).join(' · '),
            code: p.codigo || '',
            pieces: p.piezas || 'Confirmar com fornecedor',
            boxSize: p.tamano_caja || 'Confirmar com fornecedor',
            description: p.descripcion || '',
        });
    }

    imagensPorCategoria[cat] = copias;
    novosRegistos.push(...registos);
    console.log(`  ${cat.padEnd(10)} ${String(registos.length).padStart(3)} produtos  (${copias.length} fotos)`);
}

// ---------- imagens ----------
if (!DRY) {
    console.log('\nA tratar as imagens (800x1000, fundo branco)...');
    for (const [cat, copias] of Object.entries(imagensPorCategoria)) {
        const destino = join(PROJECT, 'Imgens', 'Products', cat);
        mkdirSync(destino, { recursive: true });
        const antes = new Set(existsSync(destino) ? readdirSync(destino) : []);
        const novos = new Set();
        let n = 0;
        for (const { src, out } of copias) {
            if (novos.has(out)) continue;            // produtos que partilham a mesma foto
            novos.add(out);
            await sharp(src)
                .resize(800, 1000, { fit: 'contain', background: { r: 255, g: 255, b: 255 } })
                .flatten({ background: { r: 255, g: 255, b: 255 } })
                .jpeg({ quality: 88 })
                .toFile(join(destino, out));
            n++;
        }
        // remove as imagens antigas que já não são usadas (ficheiro a ficheiro: o
        // Dropbox mantém a pasta aberta e não deixa apagá-la de uma vez)
        let apagadas = 0;
        for (const f of antes) {
            if (novos.has(f)) continue;
            try { rmSync(join(destino, f), { force: true, maxRetries: 5, retryDelay: 200 }); apagadas++; }
            catch { console.log(`    ⚠ não deu para apagar ${f}`); }
        }
        console.log(`  ${cat.padEnd(10)} ${n} imagens geradas, ${apagadas} antigas removidas`);
    }
}

// ---------- integrar ----------
const atual = JSON.parse(readFileSync(DATA_JSON, 'utf8'));
const alvos = new Set(TARGETS.map(t => t.cat));
const mantidos = atual.filter(p => !alvos.has(p.category));
const final = mantidos.concat(novosRegistos);

console.log('\n--- Relatório ---');
if (relatorio.duplicados.length) {
    console.log(`Duplicados exatos colapsados (${relatorio.duplicados.length}):`);
    relatorio.duplicados.forEach(d => console.log('   · ' + d));
}
if (relatorio.semFoto.length) {
    console.log(`⚠ Sem foto correspondente (${relatorio.semFoto.length}):`);
    relatorio.semFoto.forEach(d => console.log('   ! ' + d));
} else {
    console.log('Todas as fotos encontradas ✓');
}

const porCat = {}; final.forEach(p => porCat[p.category] = (porCat[p.category] || 0) + 1);
console.log('\nTotal por categoria:', JSON.stringify(porCat, null, 0));
console.log('Total do site:', final.length, `(antes: ${atual.length})`);

if (DRY) {
    console.log('\nDRY-RUN — nada foi gravado. Exemplo de registo:');
    console.log(JSON.stringify(novosRegistos[0], null, 2));
} else {
    writeFileSync(DATA_JSON, JSON.stringify(final, null, 2));
    writeFileSync(DATA_JS, 'window.PRODUCTS = ' + JSON.stringify(final, null, 2) + ';\n');
    console.log('\n✅ data/products.json e data/products.js atualizados.');
}
