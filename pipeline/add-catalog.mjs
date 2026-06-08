/* ============================================================
   7E-COM — Adicionar catálogo PDF ao site
   ------------------------------------------------------------
   USO:
     node add-catalog.mjs "<caminho.pdf>" <categoria> [opções]

   CATEGORIAS: 7business 7bike 7home 7pro 7storage 7tech
               (ou um nome novo — cria categoria nova)

   OPÇÕES:
     --photos "<pasta>"   Pasta com fotos sem fundo (.webp/.png/.jpg)
                          nomeadas pelo código do produto. Se omitido,
                          recorta a imagem do produto da própria página.
     --tag <nome>         Prefixo único para os ids deste catálogo
                          (default: nome do ficheiro PDF). Evita colisões
                          em re-execuções (idempotente).
     --label "<texto>"    Rótulo da categoria mostrado no site
                          (default: derivado, ex. 7home -> 7Home).
     --dry                Não grava nada; só mostra o que faria.

   EXEMPLOS:
     node add-catalog.mjs "C:/cat/7HOME_JUL.pdf" 7home --photos "C:/cat/fotos_jul"
     node add-catalog.mjs "C:/cat/7BEAUTY.pdf" 7beauty --label "7Beauty"
   ============================================================ */

import * as mupdf from 'mupdf';
import sharp from 'sharp';
import { createWorker } from 'tesseract.js';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from 'fs';
import { basename, join } from 'path';

// ---------- args ----------
const argv = process.argv.slice(2);
if (argv.length < 2) {
    console.error('USO: node add-catalog.mjs "<pdf>" <categoria> [--photos "<pasta>"] [--tag <nome>] [--label "<texto>"] [--dry]');
    process.exit(1);
}
const PDF = argv[0];
const CATEGORY = argv[1].toLowerCase();
function flag(name) { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; }
const PHOTOS_DIR = flag('--photos');
const TAG = (flag('--tag') || basename(PDF).replace(/\.[^.]+$/, '')).replace(/[^A-Za-z0-9]+/g, '-').toLowerCase();
const DRY = argv.includes('--dry');

const PROJECT = join(import.meta.dirname, '..');
const DATA_JSON = join(PROJECT, 'data', 'products.json');
const DATA_JS = join(PROJECT, 'data', 'products.js');
const IMG_DIR = join(PROJECT, 'Imgens', 'Products', CATEGORY);
const WORK = join(import.meta.dirname, '.work', TAG);

const LABELS = { '7business':'7Business','7bike':'7Bike','7home':'7Home','7pro':'7Pro','7storage':'7Storage','7tech':'7Tech' };
const LABEL = flag('--label') || LABELS[CATEGORY] || (CATEGORY.charAt(0).toUpperCase() + CATEGORY.slice(1));

if (!existsSync(PDF)) { console.error('PDF não encontrado:', PDF); process.exit(1); }
if (!existsSync(WORK)) mkdirSync(WORK, { recursive: true });
if (!DRY && !existsSync(IMG_DIR)) mkdirSync(IMG_DIR, { recursive: true });

console.log(`\n=== Adicionar catálogo ===`);
console.log(`PDF:       ${PDF}`);
console.log(`Categoria: ${CATEGORY} (${LABEL})`);
console.log(`Tag:       ${TAG}`);
console.log(`Fotos:     ${PHOTOS_DIR || '(recorte da própria página)'}`);
console.log(`Modo:      ${DRY ? 'DRY-RUN (não grava)' : 'GRAVAR'}\n`);

// ---------- 1. RENDER ----------
console.log('1/5 Render das páginas...');
const doc = mupdf.Document.openDocument(readFileSync(PDF), 'application/pdf');
const totalPages = doc.countPages();
for (let p = 1; p <= totalPages; p++) {
    const out = `${WORK}/p${String(p).padStart(3, '0')}.png`;
    if (existsSync(out)) continue;
    const page = doc.loadPage(p - 1);
    const pix = page.toPixmap(mupdf.Matrix.scale(150 / 72, 150 / 72), mupdf.ColorSpace.DeviceRGB, false, true);
    writeFileSync(out, pix.asPNG());
    pix.destroy(); page.destroy();
}
doc.destroy();
console.log(`    ${totalPages} páginas renderizadas.`);

// ---------- 2. OCR (painel direito) ----------
console.log('2/5 OCR do painel direito...');
const worker = await createWorker('por');
const pages = readdirSync(WORK).filter(f => /^p\d+\.png$/.test(f)).sort();
const ocr = [];
for (const file of pages) {
    const fp = `${WORK}/${file}`;
    const meta = await sharp(fp).metadata();
    const cropLeft = Math.floor(meta.width * 0.54);
    const buf = await sharp(fp).extract({ left: cropLeft, top: 0, width: meta.width - cropLeft, height: meta.height }).png().toBuffer();
    const { data: { text } } = await worker.recognize(buf);
    ocr.push({ page: file, raw: text.replace(/\r/g, '').trim() });
    process.stdout.write('.');
}
await worker.terminate();
console.log('');

// ---------- 3. PARSE ----------
console.log('3/5 Extração de dados...');
const FOOTER_RE = /^(7\s?(?:HOM|TEC|PRO|STOR|BIK|BUSI|BLISI|LISIN|HOME|TECH|BIKE|BUSINESS|S5T))/i;
const FOOTER_LIKE = s => FOOTER_RE.test(s.trim()) || /=$|=\d|\bT=CH|HOM=|RAG=/.test(s.trim());
function isNoise(line){const t=line.trim();if(!t)return true;if(/^\d+$/.test(t))return false;const a=t.replace(/[^A-Za-zÀ-ÿ0-9]/g,'');if(a.length<2)return true;if(FOOTER_LIKE(t))return true;if(/^"?=?\s*nm$/i.test(t))return true;if(/^[\"\)\(\\\/—=\-_•·\*]+m?\s*$/.test(t))return true;return false;}
function clean(s){return s.replace(/\s+/g,' ').replace(/[‘’]/g,"'").replace(/[“”]/g,'"').trim();}
function stripLead(line){return line.replace(/^[A-Za-z]{1,4}[»)»\\\/.,_=–—\-]+\s*(?=[A-Z])/,'').replace(/^\([^)]{0,8}\)\s*/,'').replace(/^[)\(»\\\/—=–\-_,.;:\*•·>"']+\s*/,'').trim();}
function isLabel(s){return /^\s*(?:TAMANHO\s+DE\s+CAIXA(?:\s*\(CM\))?|DESCRI[ÇCG][ÃA]O|N[ºo°0]?\s*DE\s*PE[ÇCG]AS|C[ÓO]DIGO)\s*$/i.test(s);}
function findLabel(lines,re){return lines.findIndex(l=>re.test(l));}
function valueAfter(lines,idx){for(let i=idx+1;i<Math.min(idx+5,lines.length);i++){const v=stripLead(lines[i]);if(isNoise(v)||isLabel(v))continue;if(v.length>=1)return clean(v);}return '';}
const COMMON = new Set(['MARROM','PRETO','VERDE','AZUL','VERMELHO','BRANCO','AMARELO','ROSA','CINZA','DOURADO','PRATEADO','PRATA','MODELO','STANDARD','CONFIRMAR','FORNECEDOR','PECAS']);
function extractCode(line){const toks=line.match(/[A-Z0-9][A-Z0-9./-]+[A-Z0-9]|\d{5,12}/gi)||[];for(let raw of toks){let t=raw.replace(/^[-./]+|[-./]+$/g,'');if(t.length<4||t.length>32)continue;if(COMMON.has(t.toUpperCase()))continue;if(FOOTER_LIKE(t))continue;if(!/\d/.test(t)&&!/-/.test(t))continue;if(/^\d+$/.test(t)&&t.length<6)continue;return t;}return '';}

function parse(entry) {
    const lines = entry.raw.split(/\n+/).map(l => l.trim()).filter(Boolean);
    const reC = /^\s*C[ÓO0]D[I1][CGOQ]O\s*$/i, reP = /^\s*N[ºo°0]?\s*DE\s*PE[ÇCG]AS\s*$/i,
          reX = /^\s*TAMANHO\s*DE\s*CAIXA(?:\s*\(CM\))?\s*$/i, reD = /^\s*DESCRI[ÇCG][ÃA]O\s*$/i;
    const iC = findLabel(lines, reC), iP = findLabel(lines, reP), iX = findLabel(lines, reX), iD = findLabel(lines, reD);
    if (iC < 0 && iP < 0 && iX < 0 && iD < 0) return null; // capa / divisória
    let code = '';
    if (iC >= 0) for (let i = iC+1; i < Math.min(iC+6, lines.length); i++){const c=extractCode(lines[i]);if(c){code=c;break;}}
    if (!code) for (const l of lines){const c=extractCode(l);if(c){code=c;break;}}
    // Página é claramente um produto (tem labels) mas o código não foi lido pelo OCR.
    // NÃO descartar: marcar para revisão para não perder produtos.
    let needsReview = false;
    if (!code) {
        if (iC < 0) return null;            // sem label CÓDIGO → provavelmente não é produto
        code = `REVISAR-${entry.page.replace('.png','')}`;
        needsReview = true;
    }
    const pieces = iP >= 0 ? (valueAfter(lines, iP) || 'Confirmar com fornecedor') : 'Confirmar com fornecedor';
    const boxSize = iX >= 0 ? (valueAfter(lines, iX) || 'Confirmar com fornecedor') : 'Confirmar com fornecedor';
    let description = '';
    if (iD >= 0) {
        description = lines.slice(iD+1).map(stripLead).filter(l=>!isNoise(l)&&!isLabel(l)).map(clean).join(' ')
            .replace(/\s*\d?[A-Z]{2,}\s?[=≡]+\s?[A-Z0-9]*\.?\s*$/i,'')
            .replace(/\s*7\s?\d?[A-Z=]{2,}[Z0-9.=]*\s*$/i,'').replace(/\s{2,}/g,' ').trim();
        if (description && !/[.!?]$/.test(description)) description += '.';
    }
    const firstAnchor = Math.min(...[iC,iP,iX,iD].filter(x=>x>=0));
    const header = lines.slice(0, firstAnchor).map(stripLead).filter(l=>!isNoise(l)).map(clean);
    let nameParts=[], modelParts=[], inModel=false;
    for (const line of header){const letters=line.replace(/[^A-Za-zÀ-ÿ]/g,'');if(!letters)continue;const up=letters===letters.toUpperCase();if(up&&!inModel)nameParts.push(line);else{inModel=true;modelParts.push(line);}}
    if (!nameParts.length && header.length) nameParts=[header[0]];
    let name = nameParts.join(' ').replace(/[^A-Za-zÀ-ÿ0-9\s\-&\/().,]/g,'').replace(/\s+/g,' ').trim();
    let model = modelParts.join(' ').replace(/^Modelo\s+/i,'').replace(/[^A-Za-zÀ-ÿ0-9\s\-&\/(),.+]/g,'').replace(/\s+/g,' ').trim();
    if (name){name=name.toLowerCase().split(/\s+/).map(w=>w.length<=2?w:w.charAt(0).toUpperCase()+w.slice(1)).join(' ');name=name.replace(/\b(2d|3d|qr|usb|hdmi|tv|dvd|cd|ml|pc|led|lcd|kit|set|pet|abs|pp|pvc)\b/gi,m=>m.toUpperCase());name=name.replace(/\b(de|da|do|das|dos|e|em|para|por|com|sem|no|na)\b/gi,m=>m.toLowerCase());name=name.charAt(0).toUpperCase()+name.slice(1);}
    return { page: entry.page, name: name || 'Produto', model, code, pieces, boxSize, description, needsReview };
}

const parsed = [];
for (const e of ocr) { const p = parse(e); if (p) { p.srcPage = e.page; parsed.push(p); } }
const reviewList = parsed.filter(p => p.needsReview);
console.log(`    ${parsed.length} produtos extraídos (de ${ocr.length} páginas; capas/divisórias ignoradas).`);
if (reviewList.length) console.log(`    ⚠ ${reviewList.length} com código ilegível (marcados REVISAR-*): ${reviewList.map(p=>p.srcPage).join(', ')}`);

// ---------- 4. IMAGENS ----------
console.log('4/5 Imagens...');
function coreSig(s){return s.toLowerCase().replace(/[^a-z0-9]/g,'').replace(/[io10l]/g,'');}
function normalize(s){return s.toLowerCase().replace(/[^a-z0-9]/g,'').replace(/o/g,'0').replace(/i/g,'1').replace(/l/g,'1');}
function lev(a,b){const m=a.length,n=b.length;const d=Array.from({length:m+1},(_,i)=>[i,...Array(n).fill(0)]);for(let j=0;j<=n;j++)d[0][j]=j;for(let i=1;i<=m;i++)for(let j=1;j<=n;j++)d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(a[i-1]===b[j-1]?0:1));return d[m][n];}

let photoFiles = [];
if (PHOTOS_DIR && existsSync(PHOTOS_DIR)) {
    photoFiles = readdirSync(PHOTOS_DIR).filter(f => /\.(webp|png|jpe?g)$/i.test(f));
}
const unmatched = [];
for (const p of parsed) {
    const safeCode = p.code.replace(/[^A-Za-z0-9-]/g, '');
    const outName = `${safeCode || p.srcPage.replace('.png','')}.jpg`;
    const outPath = join(IMG_DIR, outName);
    p.image = `Imgens/Products/${CATEGORY}/${outName}`;

    let srcImg = null;
    if (photoFiles.length) {
        const cN = normalize(p.code), cC = coreSig(p.code); let best='', score=0;
        for (const f of photoFiles){const b=f.replace(/\.[^.]+$/,'');const bN=normalize(b),bC=coreSig(b);
            if(cN===bN){best=f;score=999;break;}
            if(cC.length>=3&&cC===bC){if(bC.length>score){best=f;score=bC.length;}}
            else if(cC.length>=3&&(cC.includes(bC)||bC.includes(cC))){const s=Math.min(cC.length,bC.length);if(s>score){best=f;score=s;}}}
        // Fallback por distância de edição (erros de 1 letra do OCR, ex. NQI4GN↔NQJ4GN)
        if (!best && !p.needsReview) {
            let bd = 99;
            for (const f of photoFiles){const bN=normalize(f.replace(/\.[^.]+$/,''));const d=lev(cN,bN);if(d<bd){bd=d;best=f;}}
            if (bd > 2) best = '';   // só aceita se for muito parecido
        }
        if (best) srcImg = join(PHOTOS_DIR, best);
    }

    if (!DRY) {
        if (srcImg) {
            await sharp(srcImg).resize(800,1000,{fit:'contain',background:{r:255,g:255,b:255}}).flatten({background:{r:255,g:255,b:255}}).jpeg({quality:88}).toFile(outPath);
        } else {
            // Recorte do produto da própria página (lado esquerdo ~54%)
            const fp = `${WORK}/${p.srcPage}`;
            const meta = await sharp(fp).metadata();
            const w = Math.floor(meta.width * 0.5);
            await sharp(fp).extract({left:Math.floor(meta.width*0.04),top:Math.floor(meta.height*0.06),width:w,height:Math.floor(meta.height*0.9)})
                .resize(800,1000,{fit:'contain',background:{r:255,g:255,b:255}}).flatten({background:{r:255,g:255,b:255}}).jpeg({quality:85}).toFile(outPath);
            if (PHOTOS_DIR) unmatched.push(p.code);
        }
    } else if (PHOTOS_DIR && !srcImg) {
        unmatched.push(p.code);
    }
}
console.log(`    Imagens preparadas para ${parsed.length} produtos.`);
if (unmatched.length) console.log(`    ⚠ Sem foto correspondente (usado recorte): ${unmatched.join(', ')}`);

// ---------- 5. MERGE ----------
console.log('5/5 Integração no site...');
const records = parsed.map(p => ({
    category: CATEGORY, categoryLabel: LABEL,
    page: `${TAG}-${p.srcPage.replace('.png','')}`,   // id único e estável
    image: p.image, name: p.name, model: p.model, code: p.code,
    pieces: p.pieces, boxSize: p.boxSize, description: p.description, isNew: true,
    ...(p.needsReview ? { needsReview: true } : {}),
}));

// Fotos que sobraram (não associadas a nenhum produto) — pista para produtos perdidos
if (photoFiles.length) {
    const usados = new Set();
    for (const p of parsed) { const m = p.image.match(/([^\/]+)\.jpg$/); }
    // marca como usadas as fotos cujo coreSig bate com algum código
    const codesCore = parsed.map(p => coreSig(p.code));
    const sobra = photoFiles.filter(f => {
        const bC = coreSig(f.replace(/\.[^.]+$/, ''));
        return bC.length >= 3 && !codesCore.some(c => c === bC || c.includes(bC) || bC.includes(c));
    });
    if (sobra.length) console.log(`    ⚠ Fotos na pasta sem produto correspondente: ${sobra.join(', ')}`);
}

if (DRY) {
    console.log('\n--- DRY-RUN: primeiros 5 produtos ---');
    console.log(JSON.stringify(records.slice(0,5), null, 2));
    console.log(`\n(seriam adicionados ${records.length} produtos a ${CATEGORY})`);
} else {
    const all = JSON.parse(readFileSync(DATA_JSON, 'utf8'));
    const ids = new Set(records.map(r => r.page));
    const base = all.filter(p => !ids.has(p.page));   // idempotente: substitui se re-executado
    const merged = base.concat(records);
    writeFileSync(DATA_JSON, JSON.stringify(merged, null, 2));
    writeFileSync(DATA_JS, 'window.PRODUCTS = ' + JSON.stringify(merged, null, 2) + ';\n');
    const byCat = {}; merged.forEach(p => byCat[p.category]=(byCat[p.category]||0)+1);
    console.log(`    ✓ ${records.length} produtos adicionados a ${CATEGORY}.`);
    console.log(`    Total do site agora: ${merged.length}`);
    console.log(`    Por categoria: ${JSON.stringify(byCat)}`);
}

console.log('\n✅ Concluído.');
if (reviewList.length) {
    console.log(`\n⚠ ATENÇÃO: ${reviewList.length} produto(s) com código ilegível (ficaram como "REVISAR-...").`);
    console.log('  Para corrigir: edita data/products.js, ajusta o "code" e "image" desses itens,');
    console.log('  e regenera products.json. (Ou diz-me e eu corrijo o código/foto certos.)');
}
if (!DRY) {
    console.log('\nPróximos passos:');
    console.log('  1) Conferir no navegador (abrir index.html)');
    console.log('  2) Publicar:  node pipeline/deploy.mjs');
    console.log('  3) (opcional) git add -A && git commit && git push');
}
