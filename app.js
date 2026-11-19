/* ============================================
   7E-COM — App JS
   Carrega data/products.json e gerencia:
   - Carousel do hero
   - Filtros + busca + paginação do catálogo
   - Modal de detalhe
   - Menu hamburguer
   - Formulário de contato (AJAX)
   ============================================ */

const WHATSAPP_NUMBER = '5547992283737';
const PAGE_SIZE = 24;

const state = {
    products: [],
    filtered: [],
    category: 'all',
    search: '',
    page: 1,
    heroSlides: [],
    heroIndex: 0,
    heroTimer: null,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// ============================================
// INIT
// ============================================
init();

async function init() {
    setupHamburger();
    setupContactForm();
    setupModal();
    $('#year').textContent = new Date().getFullYear();
    // Products are loaded via <script src="data/products.js"> as window.PRODUCTS
    // (works directly with file:// — no fetch/CORS issues).
    if (Array.isArray(window.PRODUCTS)) {
        state.products = window.PRODUCTS;
    } else {
        try {
            const res = await fetch('data/products.json');
            state.products = await res.json();
        } catch (e) {
            console.error('Falha ao carregar produtos:', e);
            state.products = [];
        }
    }
    state.filtered = state.products;
    buildFilters();
    setupSearch();
    renderHero();
    renderCatalog();
}

// ============================================
// HAMBURGER MENU
// ============================================
function setupHamburger() {
    const ham = $('.hamburger');
    const links = $('.nav-links');
    ham.addEventListener('click', () => {
        ham.classList.toggle('active');
        links.classList.toggle('open');
    });
    $$('.nav-links a').forEach(a => {
        a.addEventListener('click', () => {
            ham.classList.remove('active');
            links.classList.remove('open');
        });
    });
}

// ============================================
// HERO CAROUSEL
// ============================================
function renderHero() {
    const slidesEl = $('#hero-slides');
    const dotsEl = $('#hero-dots');
    slidesEl.innerHTML = '';
    dotsEl.innerHTML = '';

    // Pick 1 featured product each from 7bike, 7pro and 7tech.
    // For 7tech, force the "Suporte Giratorio Paracelular".
    const featured = [
        { category: '7bike', heroImage: 'Imgens/hero/hero-7bike.webp' },
        { category: '7pro', heroImage: 'Imgens/hero/hero-7pro.webp' },
        { category: '7tech', heroImage: 'Imgens/hero/hero-7tech.webp', nameIncludes: 'SUPORTE GIRATÓRIO' },
    ];
    const picked = [];
    for (const f of featured) {
        const candidate = state.products.find(p =>
            p.category === f.category &&
            p.name &&
            (f.nameIncludes ? p.name.includes(f.nameIncludes) : p.name.length < 50)
        );
        if (candidate) picked.push({ ...candidate, heroImage: f.heroImage });
    }
    state.heroSlides = picked;

    state.heroSlides.forEach((p, i) => {
        const slide = document.createElement('div');
        slide.className = 'hero-slide' + (i === 0 ? ' active' : '');
        slide.innerHTML = `
            <div class="hero-text">
                <span class="eyebrow">${escapeHtml(p.categoryLabel)}</span>
                <h1>${escapeHtml(p.name)}</h1>
                <p>${escapeHtml(p.description || 'Soluções inteligentes para quem vende mais. Conheça nossa linha completa.')}</p>
                <div class="hero-actions">
                    <a href="#produtos" class="btn btn-primary">Ver Catálogo</a>
                    <a href="#contato" class="btn btn-outline">Falar com Especialista</a>
                </div>
            </div>
            <div class="hero-image">
                <img src="${escapeAttr(p.heroImage || p.image)}" alt="${escapeAttr(p.name)}" loading="eager" onerror="this.onerror=null;this.src='${escapeAttr(p.image)}';">
            </div>
        `;
        slidesEl.appendChild(slide);

        const dot = document.createElement('button');
        dot.className = 'hero-dot' + (i === 0 ? ' active' : '');
        dot.addEventListener('click', () => goToHero(i));
        dotsEl.appendChild(dot);
    });

    $('#hero-prev').addEventListener('click', () => goToHero(state.heroIndex - 1));
    $('#hero-next').addEventListener('click', () => goToHero(state.heroIndex + 1));

    startHeroAutoplay();

    // Pause on hover
    const hero = $('.hero');
    hero.addEventListener('mouseenter', stopHeroAutoplay);
    hero.addEventListener('mouseleave', startHeroAutoplay);
}

function goToHero(idx) {
    const n = state.heroSlides.length;
    if (n === 0) return;
    state.heroIndex = ((idx % n) + n) % n;
    $$('.hero-slide').forEach((s, i) => s.classList.toggle('active', i === state.heroIndex));
    $$('.hero-dot').forEach((d, i) => d.classList.toggle('active', i === state.heroIndex));
}

function startHeroAutoplay() {
    stopHeroAutoplay();
    state.heroTimer = setInterval(() => goToHero(state.heroIndex + 1), 5500);
}

function stopHeroAutoplay() {
    if (state.heroTimer) clearInterval(state.heroTimer);
    state.heroTimer = null;
}

// ============================================
// CATALOG: filters, search, render, pagination
// ============================================
function buildFilters() {
    const el = $('#filters');
    el.innerHTML = '';
    const cats = [
        { id: 'all', label: 'Todos' },
        ...uniqueCategories().map(c => ({ id: c, label: categoryLabelOf(c) })),
    ];
    cats.forEach(c => {
        const btn = document.createElement('button');
        btn.className = 'filter-pill' + (c.id === state.category ? ' active' : '');
        btn.textContent = c.label;
        btn.dataset.cat = c.id;
        btn.addEventListener('click', () => {
            state.category = c.id;
            state.page = 1;
            $$('.filter-pill').forEach(b => b.classList.toggle('active', b.dataset.cat === c.id));
            applyFilters();
        });
        el.appendChild(btn);
    });
}

function uniqueCategories() {
    const order = ['7business', '7bike', '7home', '7pro', '7storage', '7tech'];
    const present = new Set(state.products.map(p => p.category));
    return order.filter(c => present.has(c));
}

function categoryLabelOf(cat) {
    const map = {
        '7business': '7Business',
        '7bike': '7Bike',
        '7home': '7Home',
        '7pro': '7Pro',
        '7storage': '7Storage',
        '7tech': '7Tech',
    };
    return map[cat] || cat;
}

function setupSearch() {
    let timer;
    $('#search').addEventListener('input', e => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            state.search = e.target.value.toLowerCase().trim();
            state.page = 1;
            applyFilters();
        }, 200);
    });
}

function applyFilters() {
    state.filtered = state.products.filter(p => {
        if (state.category !== 'all' && p.category !== state.category) return false;
        if (state.search) {
            const hay = (p.name + ' ' + p.code + ' ' + (p.model || '') + ' ' + (p.description || '')).toLowerCase();
            if (!hay.includes(state.search)) return false;
        }
        return true;
    });
    renderCatalog();
}

function renderCatalog() {
    const grid = $('#product-grid');
    const total = state.filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (state.page > totalPages) state.page = totalPages;
    const start = (state.page - 1) * PAGE_SIZE;
    const items = state.filtered.slice(start, start + PAGE_SIZE);

    if (total === 0) {
        grid.innerHTML = `<div class="catalog-empty">Nenhum produto encontrado. Tente outra busca ou categoria.</div>`;
        $('#pagination').innerHTML = '';
        return;
    }

    grid.innerHTML = items.map(p => `
        <article class="product-card" data-id="${escapeAttr(p.category + ':' + p.page)}">
            <div class="product-image">
                <img src="${escapeAttr(p.image)}" alt="${escapeAttr(p.name)}" loading="lazy">
            </div>
            <div class="product-body">
                <span class="product-tag">${escapeHtml(p.categoryLabel)}</span>
                <h3>${escapeHtml(p.name)}</h3>
                <div class="product-model">${escapeHtml(p.model || '')}</div>
                <div class="product-code">Código: ${escapeHtml(p.code)}</div>
                <span class="product-cta">Ver detalhes &rarr;</span>
            </div>
        </article>
    `).join('');

    grid.querySelectorAll('.product-card').forEach(card => {
        card.addEventListener('click', () => {
            const id = card.dataset.id;
            const [cat, page] = id.split(':');
            const product = state.products.find(p => p.category === cat && p.page === page);
            if (product) openModal(product);
        });
    });

    renderPagination(totalPages);
}

function renderPagination(totalPages) {
    const el = $('#pagination');
    if (totalPages <= 1) { el.innerHTML = ''; return; }

    const cur = state.page;
    const buttons = [];

    buttons.push(`<button class="page-btn" ${cur === 1 ? 'disabled' : ''} data-go="${cur-1}">&larr;</button>`);

    // Smart page list: 1 ... cur-1 cur cur+1 ... last
    const pages = new Set([1, totalPages, cur, cur-1, cur+1, cur-2, cur+2].filter(n => n >= 1 && n <= totalPages));
    const sorted = Array.from(pages).sort((a, b) => a - b);
    let prev = 0;
    for (const p of sorted) {
        if (p - prev > 1) buttons.push('<span class="page-btn" style="border:none; background:transparent; cursor:default;">…</span>');
        buttons.push(`<button class="page-btn ${p === cur ? 'active' : ''}" data-go="${p}">${p}</button>`);
        prev = p;
    }

    buttons.push(`<button class="page-btn" ${cur === totalPages ? 'disabled' : ''} data-go="${cur+1}">&rarr;</button>`);

    el.innerHTML = buttons.join('');
    el.querySelectorAll('button[data-go]').forEach(b => {
        b.addEventListener('click', () => {
            const go = parseInt(b.dataset.go);
            if (go >= 1 && go <= totalPages) {
                state.page = go;
                renderCatalog();
                document.getElementById('produtos').scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    });
}

// ============================================
// MODAL
// ============================================
function setupModal() {
    $('#modal-close').addEventListener('click', closeModal);
    $('#modal-backdrop').addEventListener('click', e => {
        if (e.target.id === 'modal-backdrop') closeModal();
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') closeModal();
    });
}

function openModal(p) {
    $('#modal-img').src = p.image;
    $('#modal-img').alt = p.name;
    $('#modal-tag').textContent = p.categoryLabel;
    $('#modal-name').textContent = p.name;
    $('#modal-model').textContent = p.model || '';
    $('#modal-code').textContent = p.code;
    $('#modal-pieces').textContent = p.pieces || 'Confirmar com fornecedor';
    $('#modal-box').textContent = p.boxSize || 'Confirmar com fornecedor';
    $('#modal-desc').textContent = p.description || '';
    const waMsg = encodeURIComponent(`Olá! Tenho interesse no produto ${p.name} (código ${p.code}). Pode me passar mais informações?`);
    $('#modal-whatsapp').href = `https://wa.me/${WHATSAPP_NUMBER}?text=${waMsg}`;
    $('#modal-backdrop').classList.add('open');
    document.body.style.overflow = 'hidden';
}

function closeModal() {
    $('#modal-backdrop').classList.remove('open');
    document.body.style.overflow = '';
}

// ============================================
// CONTACT FORM
// ============================================
function setupContactForm() {
    const form = $('#contact-form');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = $('#submit-btn');
        const originalText = btn.textContent;
        btn.textContent = 'Enviando…';
        btn.disabled = true;
        try {
            const res = await fetch(form.action, {
                method: 'POST',
                body: new FormData(form),
                headers: { 'Accept': 'application/json' },
            });
            if (!res.ok) throw new Error('Falha na resposta');
            $('#form-fields').style.display = 'none';
            $('#success-message').style.display = 'block';
        } catch (err) {
            console.error(err);
            alert('Não foi possível enviar a mensagem. Tente novamente em alguns minutos.');
            btn.textContent = originalText;
            btn.disabled = false;
        }
    });
}

// ============================================
// UTILS
// ============================================
function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
}
function escapeAttr(s) {
    return escapeHtml(s);
}
