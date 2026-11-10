// Page designer: a development-only overlay for mocking up changes on a frozen snapshot of the current page.
// The snapshot is a script-free copy in an iframe, so the live page never sees the edits. Pointer input goes to a
// transparent layer above the iframe and is hit-tested into it, which keeps links and forms in the copy inert.
(() => {
    if (window.__designerLoaded) return;
    window.__designerLoaded = true;

    const SAVE_URL = '/_designer/save';
    const PLACEHOLDER_ATTR = 'data-designer-placeholder';
    const SCROLL_ATTR = 'data-designer-scroll';
    const SHAPE_ATTR = 'data-designer-shape';
    const Z_BASE = 100000;
    const MIN_SIZE = 8;
    const DRAG_THRESHOLD = 3;
    const ROTATE_SNAP = 15;
    const TEXT_PREVIEW_LENGTH = 80;

    const RESIZE_DIRS = {
        nw: [-1, -1], n: [0, -1], ne: [1, -1], e: [1, 0],
        se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0]
    };
    const RESIZE_CURSORS = { nw: 'nwse', se: 'nwse', ne: 'nesw', sw: 'nesw', n: 'ns', s: 'ns', e: 'ew', w: 'ew' };

    const ICONS = {
        select: 'M5 3l14 8-6 2-2 6z',
        pick: 'M2 22l1-4 9-9 3 3-9 9zM14 6l2-2a2.1 2.1 0 0 1 3 3l-2 2zM12 5l7 7',
        fill: 'M19 11l-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2a2 2 0 0 0 2.8 0zM5 2l5 5M2 13h15M22 20a2 2 0 1 1-4 0c0-1.6 1.7-2.4 2-4 .3 1.6 2 2.4 2 4z',
        rotate: 'M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5',
        resize: 'M15 3h6v6M9 21H3v-6M21 3l-8 8M3 21l8-8',
        comment: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
        shape: 'M3 3h9v9H3zM12 16.5a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0-9 0',
        parent: 'M12 19V5M5 12l7-7 7 7',
        reset: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5',
        save: 'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2zM17 21v-8H7v8M7 3v5h8',
        close: 'M18 6L6 18M6 6l12 12'
    };

    const TOOLS = [
        { id: 'select', label: 'Zaznacz', hint: 'Kliknij element, aby go zaznaczyć, i przeciągnij, aby go przesunąć.' },
        { id: 'pick', label: 'Pobierz kolor', hint: 'Kliknij element, aby pobrać jego kolor.' },
        { id: 'fill', label: 'Wypełnij', hint: 'Kliknij element, aby wypełnić go wybranym kolorem.' },
        { id: 'rotate', label: 'Obróć', hint: 'Przeciągnij zaznaczony element, aby go obrócić. Shift: co 15°.' },
        { id: 'resize', label: 'Rozmiar', hint: 'Zaznacz element i przeciągnij jego uchwyty.' },
        { id: 'comment', label: 'Komentarz', hint: 'Kliknij element lub puste miejsce, aby dodać komentarz.' },
        { id: 'shape', label: 'Kształt', hint: 'Przeciągnij, aby narysować kształt w wybranym kolorze. Shift: równe boki.' }
    ];
    const SHAPE_TYPES = [
        { id: 'rectangle', label: 'Prostokąt' },
        { id: 'ellipse', label: 'Elipsa' }
    ];
    const ACTIONS = [
        { id: 'parent', label: 'Nadrzędny', title: 'Zaznacz element nadrzędny' },
        { id: 'reset', label: 'Przywróć', title: 'Cofnij zmiany zaznaczonego elementu' },
        { id: 'save', label: 'Zapisz', title: 'Zapisz projekt do pliku' },
        { id: 'close', label: 'Zamknij', title: 'Zamknij projektanta' }
    ];

    const icon = id => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[id]}"/></svg>`;
    const button = (id, label, title, kind) =>
        `<button type="button" class="tb-btn" data-${kind}="${id}" title="${title}">${icon(id)}<span>${label}</span></button>`;

    const host = document.createElement('div');
    host.id = 'designer-host';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
<style>
    :host { all: initial; }
    [hidden] { display: none !important; }
    * { box-sizing: border-box; font-family: "Segoe UI", system-ui, sans-serif; }
    svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    /* Above the page's "Uwagi" button: the bottom left corner belongs to the admin controls. */
    #launcher { position: fixed; right: 16px; bottom: 60px; z-index: 2147483000; display: flex; align-items: center; gap: 6px;
        padding: 8px 12px; border: 0; border-radius: 8px; background: #1f2430; color: #fff; font-size: 13px; cursor: pointer;
        box-shadow: 0 2px 10px rgba(0,0,0,.35); opacity: .75; }
    #launcher:hover { opacity: 1; }
    #stage { position: fixed; inset: 0; z-index: 2147483001; background: #fff; overflow: hidden; }
    iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; pointer-events: none; }
    #catch { position: absolute; inset: 0; cursor: default; touch-action: none; }
    #catch[data-tool="fill"], #catch[data-tool="comment"], #catch[data-tool="pick"], #catch[data-tool="shape"] { cursor: crosshair; }
    #catch[data-tool="rotate"] { cursor: grab; }
    #marks { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
    #hover { position: fixed; outline: 1px dashed #0d6efd; background: rgba(13,110,253,.08); }
    #selection { position: fixed; outline: 2px solid #0d6efd; }
    .handle { position: absolute; width: 10px; height: 10px; margin: -5px 0 0 -5px; background: #fff; border: 2px solid #0d6efd;
        pointer-events: auto; touch-action: none; display: none; }
    #selection[data-tool="resize"] .handle { display: block; }
    #rotate-handle { position: absolute; left: 50%; top: -30px; width: 14px; height: 14px; margin-left: -7px; border-radius: 50%;
        background: #0d6efd; border: 2px solid #fff; pointer-events: auto; cursor: grab; touch-action: none; display: none; }
    #selection[data-tool="rotate"] #rotate-handle { display: block; }
    .pin { position: fixed; width: 24px; height: 24px; margin: -12px 0 0 -12px; border: 2px solid #fff; border-radius: 50%; padding: 0;
        background: #dc3545; color: #fff; font-size: 12px; font-weight: 600; pointer-events: auto; cursor: pointer;
        box-shadow: 0 1px 4px rgba(0,0,0,.45); }
    #toolbar { position: fixed; top: 10px; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; gap: 4px;
        padding: 6px 8px; border-radius: 10px; background: #1f2430; color: #e8eaf0; box-shadow: 0 4px 18px rgba(0,0,0,.4); }
    #tb-row { display: flex; align-items: stretch; gap: 2px; }
    #grip { width: 14px; cursor: move; touch-action: none; border-radius: 4px; flex: none;
        background: radial-gradient(#7d8499 1px, transparent 1.5px) 0 0 / 5px 5px; }
    .tb-btn { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; min-width: 62px; padding: 5px 6px; white-space: nowrap;
        border: 0; border-radius: 6px; background: transparent; color: inherit; font-size: 11px; cursor: pointer; }
    .tb-btn:hover { background: #333a4b; }
    .tb-btn.active { background: #0d6efd; color: #fff; }
    .tb-btn:disabled { opacity: .35; cursor: default; background: transparent; }
    .sep { width: 1px; margin: 3px 4px; background: #4a5165; flex: none; }
    #color-label { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; min-width: 52px; font-size: 11px; cursor: pointer; }
    #color { width: 30px; height: 20px; padding: 0; border: 1px solid #7d8499; border-radius: 4px; background: none; cursor: pointer; }
    #shape-row { display: flex; gap: 4px; padding-left: 18px; }
    .sub-btn { padding: 3px 10px; border: 0; border-radius: 5px; background: #333a4b; color: inherit; font-size: 12px; cursor: pointer; }
    .sub-btn.active { background: #0d6efd; color: #fff; }
    #status { padding: 1px 4px; font-size: 12px; color: #b9bfce; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 720px; }
    #popover { position: fixed; width: 280px; padding: 10px; border-radius: 8px; background: #1f2430; color: #e8eaf0; box-shadow: 0 4px 18px rgba(0,0,0,.45); }
    #popover textarea { width: 100%; height: 84px; padding: 6px; resize: vertical; border: 1px solid #4a5165; border-radius: 4px;
        background: #12151c; color: #fff; font-size: 13px; }
    #popover div { display: flex; justify-content: flex-end; gap: 6px; margin-top: 8px; }
    #popover button { padding: 4px 10px; border: 0; border-radius: 4px; background: #333a4b; color: #fff; font-size: 12px; cursor: pointer; }
    #popover #pop-save { background: #0d6efd; }
    #popover #pop-delete { background: #dc3545; margin-right: auto; }
</style>
<button type="button" id="launcher" title="Otwórz projektanta na migawce tej strony">${icon('resize')}<span>Projektant</span></button>
<div id="stage" hidden>
    <div id="catch"></div>
    <div id="marks">
        <div id="hover" hidden></div>
        <div id="selection" hidden>
            <div id="rotate-handle" title="Obróć"></div>
        </div>
        <div id="pins"></div>
    </div>
    <div id="toolbar">
        <div id="tb-row">
            <div id="grip" title="Przesuń pasek narzędzi"></div>
            ${TOOLS.map(t => button(t.id, t.label, t.label, 'tool')).join('')}
            <label id="color-label" title="Wybrany kolor"><input type="color" id="color" value="#ffc107"><span>Kolor</span></label>
            <div class="sep"></div>
            ${ACTIONS.map(a => button(a.id, a.label, a.title, 'action')).join('')}
        </div>
        <div id="shape-row" hidden>
            ${SHAPE_TYPES.map(s => `<button type="button" class="sub-btn" data-shape="${s.id}">${s.label}</button>`).join('')}
        </div>
        <div id="status"></div>
    </div>
    <div id="popover" hidden>
        <textarea id="pop-text" placeholder="Treść komentarza"></textarea>
        <div>
            <button type="button" id="pop-delete">Usuń</button>
            <button type="button" id="pop-cancel">Anuluj</button>
            <button type="button" id="pop-save">Zapisz</button>
        </div>
    </div>
</div>`;

    const $ = id => shadow.getElementById(id);
    const stage = $('stage'), catchLayer = $('catch'), hoverBox = $('hover'), selectionBox = $('selection');
    const pinsLayer = $('pins'), toolbar = $('toolbar'), statusLine = $('status'), colorInput = $('color');
    const popover = $('popover'), popText = $('pop-text');

    for (const dir of Object.keys(RESIZE_DIRS)) {
        const handle = document.createElement('div');
        const [sx, sy] = RESIZE_DIRS[dir];
        handle.className = 'handle';
        handle.dataset.dir = dir;
        handle.style.left = `${(sx + 1) * 50}%`;
        handle.style.top = `${(sy + 1) * 50}%`;
        handle.style.cursor = `${RESIZE_CURSORS[dir]}-resize`;
        selectionBox.appendChild(handle);
    }

    // Enhanced navigation can drop nodes it doesn't know about, so the host is re-attached whenever it goes missing.
    // It lives on <html> rather than <body> to stay out of the page's own markup.
    const ensureHost = () => { if (!host.isConnected) document.documentElement.appendChild(host); };
    new MutationObserver(ensureHost).observe(document.documentElement, { childList: true });
    ensureHost();

    let frame = null, doc = null, win = null;
    let tool = 'select', selected = null, hovered = null, gesture = null, editing = null;
    let records = new Map(), comments = [], nextCommentId = 1, nextShapeId = 1, topZ = Z_BASE, dirty = false;
    let shapeType = SHAPE_TYPES[0].id;
    let renderQueued = false;

    // --- Snapshot ---

    /** Serializes the live page into a static, script-free document, keeping form state and scroll positions. */
    function captureSnapshotHtml() {
        const copy = document.documentElement.cloneNode(true);
        const copies = copy.querySelectorAll('*');
        document.documentElement.querySelectorAll('*').forEach((el, i) => {
            const clone = copies[i];
            for (const attr of [...clone.attributes]) {
                if (attr.name.toLowerCase().startsWith('on')) clone.removeAttribute(attr.name);
            }
            if (el.scrollTop || el.scrollLeft) clone.setAttribute(SCROLL_ATTR, `${el.scrollLeft},${el.scrollTop}`);
            clone.removeAttribute('autofocus');

            if (el instanceof HTMLInputElement) {
                if (el.type === 'checkbox' || el.type === 'radio') clone.toggleAttribute('checked', el.checked);
                else if (el.type !== 'password' && el.type !== 'file') clone.setAttribute('value', el.value);
            } else if (el instanceof HTMLTextAreaElement) {
                clone.textContent = el.value;
            } else if (el instanceof HTMLOptionElement) {
                clone.toggleAttribute('selected', el.selected);
            }
        });

        copy.querySelector('#designer-host')?.remove();
        copy.querySelectorAll('script').forEach(s => s.remove());
        copy.querySelector('base')?.setAttribute('href', `${location.origin}/`);
        return `<!DOCTYPE html>${copy.outerHTML}`;
    }

    async function openDesigner() {
        const html = captureSnapshotHtml();
        const scrollX = window.scrollX, scrollY = window.scrollY;

        // A fresh iframe per session means a stale load event can never be mistaken for this one.
        frame = document.createElement('iframe');
        frame.tabIndex = -1;
        frame.title = 'Migawka strony';
        stage.prepend(frame);
        stage.hidden = false;
        $('launcher').hidden = true;

        await new Promise(resolve => {
            frame.addEventListener('load', resolve, { once: true });
            frame.srcdoc = html;
        });

        doc = frame.contentDocument;
        win = frame.contentWindow;
        doc.querySelectorAll(`[${SCROLL_ATTR}]`).forEach(el => {
            const [left, top] = el.getAttribute(SCROLL_ATTR).split(',').map(Number);
            el.scrollLeft = left;
            el.scrollTop = top;
            el.removeAttribute(SCROLL_ATTR);
        });
        // Explicitly instant: Bootstrap sets smooth scrolling on the root, which would animate this.
        win.scrollTo({ left: scrollX, top: scrollY, behavior: 'instant' });
        doc.addEventListener('scroll', scheduleRender, true);
        win.addEventListener('resize', scheduleRender);

        setTool('select');
        scheduleRender();
    }

    function closeDesigner() {
        if (dirty && !confirm('Masz niezapisane zmiany. Zamknąć bez zapisywania?')) return;
        closeEditor();
        frame?.remove();
        frame = doc = win = selected = hovered = gesture = null;
        records = new Map();
        comments = [];
        nextCommentId = 1;
        nextShapeId = 1;
        topZ = Z_BASE;
        dirty = false;
        pinsLayer.replaceChildren();
        hoverBox.hidden = selectionBox.hidden = true;
        stage.hidden = true;
        $('launcher').hidden = false;
    }

    // --- Hit testing and geometry ---

    /** Whether the element is just page background: the root, or a layout wrapper covering the whole viewport. */
    function isBackground(el) {
        if (el === doc.documentElement || el === doc.body) return true;
        if (el.hasAttribute(SHAPE_ATTR)) return false;
        const rect = el.getBoundingClientRect();
        return rect.width >= doc.documentElement.clientWidth && rect.height >= doc.documentElement.clientHeight;
    }

    function hitTest(x, y) {
        const el = doc.elementFromPoint(x, y);
        return !el || isBackground(el) ? null : el;
    }

    /** The element's box in viewport coordinates, with the rotation applied by the designer factored out. */
    function boxOf(el) {
        const rect = el.getBoundingClientRect();
        const rec = records.get(el);
        return {
            cx: rect.left + rect.width / 2,
            cy: rect.top + rect.height / 2,
            w: rec?.lifted ? rec.w : rect.width,
            h: rec?.lifted ? rec.h : rect.height,
            rot: rec?.rot ?? 0
        };
    }

    function isInside(el, x, y) {
        const box = boxOf(el);
        const rad = -box.rot * Math.PI / 180;
        const dx = x - box.cx, dy = y - box.cy;
        const localX = dx * Math.cos(rad) - dy * Math.sin(rad);
        const localY = dx * Math.sin(rad) + dy * Math.cos(rad);
        return Math.abs(localX) <= box.w / 2 && Math.abs(localY) <= box.h / 2;
    }

    /** The clicked element, preferring the current selection so that its children don't steal the click. */
    function targetAt(x, y) {
        return selected && isInside(selected, x, y) ? selected : hitTest(x, y);
    }

    function pageRect(rect) {
        return { x: round(rect.left + win.scrollX), y: round(rect.top + win.scrollY), w: round(rect.width), h: round(rect.height) };
    }

    const round = n => Math.round(n * 10) / 10;

    // --- Element records ---

    /** A CSS path for the element, as it would match on the live page (placeholders don't count as siblings). */
    function selectorOf(el) {
        const parts = [];
        for (let node = el; node && node !== doc.documentElement; node = node.parentElement) {
            if (node === doc.body) { parts.unshift('body'); break; }
            if (node.id && doc.querySelectorAll(`#${CSS.escape(node.id)}`).length === 1) {
                parts.unshift(`#${CSS.escape(node.id)}`);
                break;
            }
            const classes = [...node.classList].slice(0, 2).map(c => `.${CSS.escape(c)}`).join('');
            const siblings = [...node.parentElement.children].filter(s => !s.hasAttribute(PLACEHOLDER_ATTR));
            parts.unshift(`${node.localName}${classes}:nth-child(${siblings.indexOf(node) + 1})`);
        }
        return parts.join(' > ');
    }

    function describe(el) {
        if (el.hasAttribute(SHAPE_ATTR)) return { shape: Number(el.getAttribute(SHAPE_ATTR)) };
        const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim() || el.getAttribute('placeholder') || el.getAttribute('alt') || '';
        return { selector: selectorOf(el), tag: el.localName, text: text.slice(0, TEXT_PREVIEW_LENGTH) };
    }

    function recordOf(el) {
        let rec = records.get(el);
        if (!rec) {
            rec = {
                el,
                info: describe(el),
                originalStyle: el.getAttribute('style'),
                before: pageRect(el.getBoundingClientRect()),
                beforeFill: effectiveColor(el),
                lifted: false,
                placeholder: null,
                frozenCells: [],
                left: 0, top: 0, w: 0, h: 0, rot: 0,
                fill: null
            };
            records.set(el, rec);
        }
        return rec;
    }

    /**
     * Takes the element out of the flow so edits never push its neighbours: a hidden copy keeps its original
     * space, while the element itself becomes absolutely positioned at the same spot.
     */
    function lift(rec) {
        if (rec.lifted) return;
        const el = rec.el;
        const rect = el.getBoundingClientRect();

        // Table parts lose their column widths once out of the table, so their cells are pinned first.
        if (/^(tr|thead|tbody|tfoot)$/.test(el.localName)) {
            for (const cell of el.querySelectorAll('th, td')) {
                rec.frozenCells.push({ cell, style: cell.getAttribute('style') });
                cell.style.setProperty('width', `${cell.getBoundingClientRect().width}px`, 'important');
            }
        }

        const placeholder = el.cloneNode(true);
        placeholder.setAttribute(PLACEHOLDER_ATTR, '');
        placeholder.removeAttribute('id');
        placeholder.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
        placeholder.style.setProperty('visibility', 'hidden', 'important');
        el.before(placeholder);
        rec.placeholder = placeholder;

        // Ancestors must not clip the element or paint over it. These tweaks stay after a reset: they only
        // affect the throwaway snapshot and don't change how anything looks at rest.
        for (let a = el.parentElement; a && a !== doc.body; a = a.parentElement) {
            const style = win.getComputedStyle(a);
            if ((style.overflowX !== 'visible' || style.overflowY !== 'visible') && !a.scrollTop && !a.scrollLeft) {
                a.style.setProperty('overflow', 'visible', 'important');
            }
            if (style.position !== 'static' && style.zIndex !== 'auto') {
                a.style.setProperty('z-index', String(Z_BASE), 'important');
            }
        }

        rec.w = rect.width;
        rec.h = rect.height;
        const set = (name, value) => el.style.setProperty(name, value, 'important');
        set('position', 'absolute');
        set('margin', '0');
        set('box-sizing', 'border-box');
        set('left', '0px');
        set('top', '0px');
        set('width', `${rec.w}px`);
        set('height', `${rec.h}px`);
        set('z-index', String(++topZ));

        // The containing block is unknown, so measure where left/top 0 lands and correct by the difference.
        const origin = el.getBoundingClientRect();
        rec.left = rect.left - origin.left;
        rec.top = rect.top - origin.top;
        rec.lifted = true;
        applyGeometry(rec);
    }

    function applyGeometry(rec) {
        const set = (name, value) => rec.el.style.setProperty(name, value, 'important');
        set('left', `${rec.left}px`);
        set('top', `${rec.top}px`);
        set('width', `${rec.w}px`);
        set('height', `${rec.h}px`);
        set('transform-origin', 'center center');
        set('transform', rec.rot ? `rotate(${rec.rot}deg)` : 'none');
    }

    /**
     * Adds a new shape to the snapshot. It is an ordinary lifted element with its record, so the move, resize,
     * rotate, fill and comment tools need no special cases. Appended last, it can't affect any nth-child selector.
     */
    function createShape() {
        const el = doc.createElement('div');
        const id = nextShapeId++;
        el.setAttribute(SHAPE_ATTR, String(id));
        const set = (name, value) => el.style.setProperty(name, value, 'important');
        set('position', 'absolute');
        set('margin', '0');
        set('box-sizing', 'border-box');
        set('z-index', String(++topZ));
        set('background', colorInput.value);
        if (shapeType === 'ellipse') set('border-radius', '50%');
        doc.body.appendChild(el);

        const rec = {
            el, isShape: true, id, type: shapeType, lifted: true,
            left: 0, top: 0, w: MIN_SIZE, h: MIN_SIZE, rot: 0, fill: colorInput.value
        };
        records.set(el, rec);
        applyGeometry(rec);
        return rec;
    }

    function removeShape(el) {
        // Comments may hold a thought that outlives the shape, so they stay where they are, as free pins.
        for (const comment of comments.filter(c => c.el === el)) {
            const pos = commentPosition(comment);
            comment.pageX = pos.x + win.scrollX;
            comment.pageY = pos.y + win.scrollY;
            comment.el = null;
        }
        el.remove();
        records.delete(el);
        if (hovered === el) hovered = null;
        if (selected === el) selected = null;
        dirty = true;
    }

    function resetElement(el) {
        const rec = records.get(el);
        if (!rec) return;
        if (rec.isShape) return removeShape(el);
        if (rec.originalStyle === null) el.removeAttribute('style');
        else el.setAttribute('style', rec.originalStyle);
        for (const { cell, style } of rec.frozenCells) {
            if (style === null) cell.removeAttribute('style');
            else cell.setAttribute('style', style);
        }
        rec.placeholder?.remove();
        records.delete(el);
        dirty = true;
    }

    // --- Colors ---

    const colorContext = document.createElement('canvas').getContext('2d');

    /** Normalizes any CSS color to #rrggbb, ignoring alpha. */
    function toHex(cssColor) {
        colorContext.fillStyle = '#000000';
        colorContext.fillStyle = cssColor;
        const value = colorContext.fillStyle;
        if (value.startsWith('#')) return value;
        const [r, g, b] = value.match(/[\d.]+/g).map(Number);
        return `#${[r, g, b].map(n => Math.round(n).toString(16).padStart(2, '0')).join('')}`;
    }

    /** The color an element appears to have: its own background, or the nearest non-transparent ancestor's. */
    function effectiveColor(el) {
        for (let node = el; node; node = node.parentElement) {
            const color = win.getComputedStyle(node).backgroundColor;
            colorContext.fillStyle = '#000000';
            colorContext.fillStyle = color;
            const parsed = colorContext.fillStyle;
            const transparent = !parsed.startsWith('#') && Number(parsed.match(/[\d.]+/g)[3]) === 0;
            if (!transparent) return toHex(color);
        }
        return '#ffffff';
    }

    function setColor(hex) {
        colorInput.value = hex;
        setStatus(`Pobrano kolor ${hex}.`);
    }

    function applyFill(el) {
        const rec = recordOf(el);
        rec.fill = colorInput.value;
        el.style.setProperty('background', rec.fill, 'important');
        dirty = true;
    }

    /** Uses the browser's pixel-accurate eyedropper when there is one; otherwise waits for a click on an element. */
    function startColorPick() {
        if (window.EyeDropper) {
            new window.EyeDropper().open().then(r => setColor(r.sRGBHex)).catch(() => { });
        } else {
            setTool('pick');
        }
    }

    // --- Comments ---

    function commentPosition(comment) {
        if (comment.el) {
            const rect = comment.el.getBoundingClientRect();
            return { x: rect.left + rect.width * comment.fx, y: rect.top + rect.height * comment.fy };
        }
        return { x: comment.pageX - win.scrollX, y: comment.pageY - win.scrollY };
    }

    function syncPins() {
        pinsLayer.replaceChildren(...comments.map((comment, i) => {
            const pin = document.createElement('button');
            pin.type = 'button';
            pin.className = 'pin';
            pin.textContent = String(i + 1);
            pin.title = comment.text;
            pin.addEventListener('click', () => {
                const pos = commentPosition(comment);
                openEditor(comment, pos.x, pos.y);
            });
            comment.pin = pin;
            return pin;
        }));
    }

    function newComment(x, y) {
        const el = targetAt(x, y);
        if (!el) return { id: 0, el: null, pageX: x + win.scrollX, pageY: y + win.scrollY, text: '' };
        const rect = el.getBoundingClientRect();
        return {
            id: 0, el, info: describe(el),
            fx: rect.width ? (x - rect.left) / rect.width : 0,
            fy: rect.height ? (y - rect.top) / rect.height : 0,
            text: ''
        };
    }

    function openEditor(comment, x, y) {
        editing = comment;
        popText.value = comment.text;
        $('pop-delete').hidden = comment.id === 0;
        popover.hidden = false;
        const left = Math.min(x + 16, window.innerWidth - popover.offsetWidth - 8);
        const top = Math.min(y + 16, window.innerHeight - popover.offsetHeight - 8);
        popover.style.left = `${Math.max(8, left)}px`;
        popover.style.top = `${Math.max(8, top)}px`;
        popText.focus();
    }

    function closeEditor() {
        editing = null;
        popover.hidden = true;
    }

    function saveEditor() {
        const text = popText.value.trim();
        if (text && editing) {
            editing.text = text;
            if (editing.id === 0) {
                editing.id = nextCommentId++;
                comments.push(editing);
            }
            dirty = true;
            syncPins();
            scheduleRender();
        }
        closeEditor();
    }

    function deleteEdited() {
        comments = comments.filter(c => c !== editing);
        dirty = true;
        syncPins();
        scheduleRender();
        closeEditor();
    }

    // --- Saving ---

    function buildDesign() {
        const all = [...records.values()];
        const shapes = all.filter(rec => rec.isShape).map(rec => {
            const box = boxOf(rec.el);
            return {
                id: rec.id, type: rec.type,
                x: round(box.cx - box.w / 2 + win.scrollX), y: round(box.cy - box.h / 2 + win.scrollY),
                w: round(box.w), h: round(box.h),
                rotation: round(rec.rot), fill: rec.fill
            };
        });
        const elements = all.filter(rec => !rec.isShape).map(rec => {
            const entry = { ...rec.info, before: rec.before };
            if (rec.lifted) {
                const box = boxOf(rec.el);
                entry.after = {
                    x: round(box.cx - box.w / 2 + win.scrollX), y: round(box.cy - box.h / 2 + win.scrollY),
                    w: round(box.w), h: round(box.h)
                };
                entry.rotation = round(rec.rot);
            }
            if (rec.fill) entry.fill = { before: rec.beforeFill, after: rec.fill };
            return entry;
        });

        return {
            version: 1,
            page: location.pathname + location.search,
            title: doc.title,
            savedAt: new Date().toISOString(),
            viewport: { w: win.innerWidth, h: win.innerHeight },
            scroll: { x: round(win.scrollX), y: round(win.scrollY) },
            elements,
            shapes,
            comments: comments.map(c => {
                const pos = commentPosition(c);
                const entry = { id: c.id, text: c.text, at: { x: round(pos.x + win.scrollX), y: round(pos.y + win.scrollY) } };
                if (c.el) entry.element = c.info;
                return entry;
            })
        };
    }

    async function saveDesign() {
        setStatus('Zapisywanie…');
        try {
            const response = await fetch(SAVE_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-csrf-token': document.querySelector('meta[name="csrf-token"]')?.content ?? '' },
                credentials: 'same-origin',
                body: JSON.stringify(buildDesign())
            });
            if (!response.ok) throw new Error(String(response.status));
            const result = await response.json();
            dirty = false;
            setStatus(`Zapisano: ${result.file}`);
        } catch {
            setStatus('Nie udało się zapisać projektu.');
        }
    }

    // --- Tools and selection ---

    function setTool(id) {
        tool = id;
        catchLayer.dataset.tool = id;
        selectionBox.dataset.tool = id;
        shadow.querySelectorAll('[data-tool].tb-btn').forEach(b => b.classList.toggle('active', b.dataset.tool === id));
        $('shape-row').hidden = id !== 'shape';
        showDefaultStatus();
        scheduleRender();
    }

    function setShapeType(id) {
        shapeType = id;
        shadow.querySelectorAll('.sub-btn').forEach(b => b.classList.toggle('active', b.dataset.shape === id));
    }

    function select(el) {
        selected = el;
        showDefaultStatus();
        scheduleRender();
    }

    function setStatus(text) {
        statusLine.textContent = text;
    }

    function showDefaultStatus() {
        const hint = TOOLS.find(t => t.id === tool)?.hint ?? '';
        if (!selected) return setStatus(hint);
        const box = boxOf(selected);
        const angle = box.rot ? ` · ${Math.round(box.rot)}°` : '';
        const rec = records.get(selected);
        const name = rec?.isShape ? SHAPE_TYPES.find(s => s.id === rec.type).label : `<${selected.localName}>`;
        setStatus(`${name} ${Math.round(box.w)}×${Math.round(box.h)}${angle} — ${hint}`);
    }

    function updateActionButtons() {
        shadow.querySelector('[data-action="parent"]').disabled = !selected || isBackground(selected.parentElement);
        const reset = shadow.querySelector('[data-action="reset"]');
        const isShape = records.get(selected)?.isShape ?? false;
        reset.disabled = !selected || !records.has(selected);
        reset.querySelector('span').textContent = isShape ? 'Usuń' : 'Przywróć';
        reset.title = isShape ? 'Usuń zaznaczony kształt' : 'Cofnij zmiany zaznaczonego elementu';
    }

    // --- Gestures ---

    function beginGesture(e, type, extra = {}) {
        if (!selected) return;
        const box = boxOf(selected);
        gesture = {
            type, el: selected, startX: e.clientX, startY: e.clientY, started: false,
            cx: box.cx, cy: box.cy, rec: null, orig: null, ...extra
        };
        stage.setPointerCapture(e.pointerId);
    }

    function beginDraw(e) {
        gesture = { type: 'draw', startX: e.clientX, startY: e.clientY, started: false, rec: null, origin: null };
        stage.setPointerCapture(e.pointerId);
    }

    function updateDraw(e) {
        let dx = e.clientX - gesture.startX, dy = e.clientY - gesture.startY;
        if (!gesture.started) {
            if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
            gesture.started = true;
            gesture.rec = createShape();
            // Where left/top 0 lands in the viewport, measured at the shape's starting position.
            gesture.origin = gesture.rec.el.getBoundingClientRect();
            dirty = true;
            selected = gesture.rec.el;
        }
        if (e.shiftKey) {
            const side = Math.max(Math.abs(dx), Math.abs(dy));
            dx = dx < 0 ? -side : side;
            dy = dy < 0 ? -side : side;
        }

        const { rec, origin } = gesture;
        rec.w = Math.max(MIN_SIZE, Math.abs(dx));
        rec.h = Math.max(MIN_SIZE, Math.abs(dy));
        rec.left = Math.min(gesture.startX, gesture.startX + dx) - origin.left;
        rec.top = Math.min(gesture.startY, gesture.startY + dy) - origin.top;
        applyGeometry(rec);
        showDefaultStatus();
        scheduleRender();
    }

    function updateGesture(e) {
        if (gesture.type === 'draw') return updateDraw(e);
        const dx = e.clientX - gesture.startX, dy = e.clientY - gesture.startY;
        if (!gesture.started) {
            if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
            gesture.started = true;
            gesture.rec = recordOf(gesture.el);
            lift(gesture.rec);
            const { left, top, w, h, rot } = gesture.rec;
            gesture.orig = { left, top, w, h, rot };
            dirty = true;
        }

        const { rec, orig } = gesture;
        if (gesture.type === 'move') {
            rec.left = orig.left + dx;
            rec.top = orig.top + dy;
        } else if (gesture.type === 'rotate') {
            const angleAt = (x, y) => Math.atan2(y - gesture.cy, x - gesture.cx) * 180 / Math.PI;
            let rot = orig.rot + angleAt(e.clientX, e.clientY) - angleAt(gesture.startX, gesture.startY);
            if (e.shiftKey) rot = Math.round(rot / ROTATE_SNAP) * ROTATE_SNAP;
            rec.rot = ((rot % 360) + 360) % 360;
        } else if (gesture.type === 'resize') {
            // Work in the element's own axes so that the handles behave on rotated elements too.
            const [sx, sy] = RESIZE_DIRS[gesture.dir];
            const rad = orig.rot * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
            const localX = dx * cos + dy * sin, localY = -dx * sin + dy * cos;
            rec.w = Math.max(MIN_SIZE, orig.w + sx * localX);
            rec.h = Math.max(MIN_SIZE, orig.h + sy * localY);
            const growW = rec.w - orig.w, growH = rec.h - orig.h;
            // Keep the opposite edge in place: the center travels half the growth towards the dragged handle.
            const shiftX = sx * growW / 2, shiftY = sy * growH / 2;
            rec.left = orig.left + shiftX * cos - shiftY * sin - growW / 2;
            rec.top = orig.top + shiftX * sin + shiftY * cos - growH / 2;
        }
        applyGeometry(rec);
        showDefaultStatus();
        scheduleRender();
    }

    function endGesture() {
        const finished = gesture;
        gesture = null;
        // A plain click inside the selection drills down to the element under the pointer.
        if (finished && !finished.started && finished.clickTarget && finished.clickTarget !== selected) select(finished.clickTarget);
        // A finished shape is usually adjusted next, so drawing hands over to the select tool.
        if (finished?.type === 'draw' && finished.started) setTool('select');
        scheduleRender();
    }

    catchLayer.addEventListener('pointerdown', e => {
        if (e.button !== 0 || !doc) return;
        if (editing) closeEditor();
        const x = e.clientX, y = e.clientY;
        const inside = selected && isInside(selected, x, y);

        switch (tool) {
            case 'select':
                if (!inside) select(hitTest(x, y));
                beginGesture(e, 'move', { clickTarget: inside ? hitTest(x, y) : null });
                break;
            case 'rotate':
                if (!inside) select(hitTest(x, y));
                beginGesture(e, 'rotate');
                break;
            case 'resize':
                if (!inside) select(hitTest(x, y));
                break;
            case 'pick': {
                const el = hitTest(x, y) ?? doc.body;
                setTool('select');
                setColor(effectiveColor(el));
                break;
            }
            case 'fill': {
                const el = targetAt(x, y);
                if (el) {
                    applyFill(el);
                    select(el);
                }
                break;
            }
            case 'comment':
                openEditor(newComment(x, y), x, y);
                break;
            case 'shape':
                beginDraw(e);
                break;
        }
    });

    selectionBox.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        if (e.target.id === 'rotate-handle') beginGesture(e, 'rotate');
        else if (e.target.dataset.dir) beginGesture(e, 'resize', { dir: e.target.dataset.dir });
    });

    stage.addEventListener('pointermove', e => {
        if (gesture) return updateGesture(e);
        const over = e.composedPath()[0] === catchLayer && doc ? hitTest(e.clientX, e.clientY) : null;
        if (over !== hovered) {
            hovered = over;
            scheduleRender();
        }
    });
    stage.addEventListener('pointerup', endGesture);
    stage.addEventListener('pointercancel', endGesture);

    // The snapshot sits behind the catch layer, so wheel input has to be forwarded to whatever should scroll.
    catchLayer.addEventListener('wheel', e => {
        if (!doc) return;
        e.preventDefault();
        for (let node = hitTest(e.clientX, e.clientY); node; node = node.parentElement) {
            const overflow = win.getComputedStyle(node).overflowY;
            if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight) {
                node.scrollBy(e.deltaX, e.deltaY);
                return;
            }
        }
        win.scrollBy({ left: e.deltaX, top: e.deltaY, behavior: 'instant' });
    }, { passive: false });

    // --- Rendering ---

    function scheduleRender() {
        if (renderQueued) return;
        renderQueued = true;
        requestAnimationFrame(() => {
            renderQueued = false;
            render();
        });
    }

    function render() {
        if (!doc) return;

        const showHover = hovered && hovered !== selected && !gesture && tool !== 'shape';
        hoverBox.hidden = !showHover;
        if (showHover) {
            const rect = hovered.getBoundingClientRect();
            Object.assign(hoverBox.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
        }

        selectionBox.hidden = !selected;
        if (selected) {
            const box = boxOf(selected);
            Object.assign(selectionBox.style, {
                left: `${box.cx - box.w / 2}px`, top: `${box.cy - box.h / 2}px`,
                width: `${box.w}px`, height: `${box.h}px`, transform: `rotate(${box.rot}deg)`
            });
        }

        for (const comment of comments) {
            const pos = commentPosition(comment);
            comment.pin.style.left = `${pos.x}px`;
            comment.pin.style.top = `${pos.y}px`;
        }

        updateActionButtons();
    }

    // --- Toolbar wiring ---

    $('launcher').addEventListener('click', openDesigner);

    toolbar.addEventListener('click', e => {
        if (e.target.dataset.shape) return setShapeType(e.target.dataset.shape);
        const btn = e.target.closest('.tb-btn');
        if (!btn) return;
        if (btn.dataset.tool === 'pick') return startColorPick();
        if (btn.dataset.tool) return setTool(btn.dataset.tool);
        switch (btn.dataset.action) {
            case 'parent':
                if (selected && !isBackground(selected.parentElement)) select(selected.parentElement);
                break;
            case 'reset':
                if (selected) {
                    resetElement(selected);
                    showDefaultStatus();
                    syncPins();
                    scheduleRender();
                }
                break;
            case 'save':
                saveDesign();
                break;
            case 'close':
                closeDesigner();
                break;
        }
    });

    const grip = $('grip');
    grip.addEventListener('pointerdown', e => {
        const rect = toolbar.getBoundingClientRect();
        const offsetX = e.clientX - rect.left, offsetY = e.clientY - rect.top;
        grip.setPointerCapture(e.pointerId);
        const onMove = ev => {
            toolbar.style.transform = 'none';
            toolbar.style.left = `${Math.max(0, Math.min(window.innerWidth - rect.width, ev.clientX - offsetX))}px`;
            toolbar.style.top = `${Math.max(0, Math.min(window.innerHeight - rect.height, ev.clientY - offsetY))}px`;
        };
        grip.addEventListener('pointermove', onMove);
        grip.addEventListener('pointerup', () => grip.removeEventListener('pointermove', onMove), { once: true });
    });

    $('pop-save').addEventListener('click', saveEditor);
    $('pop-cancel').addEventListener('click', closeEditor);
    $('pop-delete').addEventListener('click', deleteEdited);
    popText.addEventListener('keydown', e => {
        if (e.key === 'Enter' && e.ctrlKey) saveEditor();
    });

    document.addEventListener('keydown', e => {
        if (stage.hidden) return;
        if (e.key === 'Escape') {
            if (editing) closeEditor();
            else select(null);
        } else if (e.key === 'Delete' && !editing && records.get(selected)?.isShape) {
            removeShape(selected);
            showDefaultStatus();
            syncPins();
            scheduleRender();
        }
    }, true);

    setShapeType(shapeType);
})();
