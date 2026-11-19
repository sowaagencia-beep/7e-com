# Pipeline 7E-COM — adicionar produtos e publicar

Ferramentas para adicionar produtos de **catálogos PDF** ao site e **publicar** no servidor.

## Pré-requisitos (só na 1ª vez)
```
cd pipeline
npm install
```
> As dependências (mupdf, sharp, tesseract.js, basic-ftp) ficam em `pipeline/node_modules`
> e estão fora do git. Se mudares de computador, corre `npm install` outra vez.

---

## 1) Adicionar um catálogo PDF

```
cd pipeline
node add-catalog.mjs "<caminho-do-pdf>" <categoria> [opções]
```

**Categorias:** `7business` `7bike` `7home` `7pro` `7storage` `7tech`
(ou um nome novo, ex. `7beauty`, para criar categoria nova — usa `--label "7Beauty"`).

**Opções:**
| Opção | Para quê |
|---|---|
| `--photos "<pasta>"` | Pasta com as fotos **sem fundo** (`.webp/.png/.jpg`) nomeadas pelo **código** do produto. O script cruza automaticamente, converte para `800×1000` fundo branco e coloca na pasta certa. Se não indicares, recorta a imagem da própria página do PDF (fica como placeholder até teres a foto limpa). |
| `--label "<texto>"` | Rótulo da categoria no site (ex. `"7Home"`). |
| `--tag <nome>` | Prefixo único dos ids (default = nome do PDF). Permite re-executar sem duplicar. |
| `--dry` | Simula — mostra o que faria sem gravar nada. |

**Exemplos:**
```
# Com fotos sem fundo já prontas (recomendado)
node add-catalog.mjs "D:/cat/7HOME_JUL.pdf" 7home --photos "D:/cat/fotos_jul"

# Sem fotos (usa recorte do PDF como placeholder)
node add-catalog.mjs "D:/cat/7PRO_NOVO.pdf" 7pro

# Categoria nova
node add-catalog.mjs "D:/cat/7BEAUTY.pdf" 7beauty --label "7Beauty"

# Ver antes de gravar
node add-catalog.mjs "D:/cat/7HOME_JUL.pdf" 7home --photos "D:/cat/fotos_jul" --dry
```

O script faz tudo: **render → OCR → extrair nome/código/specs/descrição → tratar imagens → integrar** em
`data/products.json` e `data/products.js`. É **idempotente**: correr o mesmo catálogo outra vez
substitui (não duplica).

> **Capa:** o script deteta automaticamente se a 1ª página é capa ou produto (pela presença de "CÓDIGO").

---

## 2) Conferir no navegador
Abre `index.html` (duplo-clique). Os produtos carregam de `data/products.js` (funciona sem servidor).

---

## 3) Publicar no site (FTP)

```
cd pipeline
node deploy.mjs            # envia só o que mudou (rápido)
node deploy.mjs --all      # força reenvio de tudo
node deploy.mjs --dry      # mostra o que enviaria
```
- Envia **só ficheiros novos/alterados** (compara tamanhos) → rápido.
- **Reconecta sozinho** se a ligação cair.
- **Não toca** nos ficheiros do WordPress no servidor.
- Credenciais FTP em `7-ECOM/Secrects/7e-com_credenciais do servidor.txt` (fora do projeto e do git).
- Token do GitHub em `7-ECOM/Secrects/TOKEN GIT.txt`.

---

## 4) Guardar no GitHub (opcional)
```
git add -A
git commit -m "Adiciona produtos do catálogo X"
git push
```

---

## Fluxo completo típico
```
cd pipeline
node add-catalog.mjs "D:/cat/NOVO.pdf" 7home --photos "D:/cat/fotos"
# (abrir index.html e conferir)
node deploy.mjs
cd ..
git add -A && git commit -m "Novos produtos 7home" && git push
```

## Notas
- Códigos com erros de OCR são corrigidos por correspondência aproximada com os nomes das fotos.
- No fim o script lista produtos **sem foto correspondente** (ficaram com recorte) para reveres.
- Pasta de trabalho temporária: `pipeline/.work/` (pode apagar-se a qualquer momento).
