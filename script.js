// ==UserScript==
// @name         Xariah Tagger
// @match        *://xariah.net/*
// @grant        none
// @run-at       document-start
// @updateURL    https://mojojohoe.github.io/F-List-Eicon-Categories/script.js
// @downloadURL   https://mojojohoe.github.io/F-List-Eicon-Categories/script.js
// ==/UserScript==

(function() {
    'use strict';



    // --- 1. SHADOW-ROOT OPENER ---
    // Forces all shadow roots into open mode so we can read/write into them.

    const _origAttachShadow = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function(init) {
        if (init) init.mode = 'open';
        return _origAttachShadow.call(this, init);
    };



    // --- 2. TOOLTIP COORDINATE PATCH ---
    // Xariah positions tooltips by setting `top` via inline style on <x-tooltippopup>.
    // Because our tag manager bar pushes the page down, every tooltip drifts downward
    // by exactly the height of the bar. We intercept the setProperty call and subtract
    // that height so the tooltip lands where the cursor actually is.
    //
    // NOTE: The `parentRule?.selectorText` branch is intentionally removed — inline style
    // mutations never have a parentRule, so that condition was always false.

    const _origSetProperty = CSSStyleDeclaration.prototype.setProperty;
    CSSStyleDeclaration.prototype.setProperty = function(prop, val, priority) {
        if (prop === 'top' && this.parentElement?.tagName === 'X-TOOLTIPPOPUP') {
            const manager = document.getElementById('x-tag-manager');
            if (manager) {
                const numeric = parseFloat(val);
                if (!isNaN(numeric)) val = (numeric - manager.getBoundingClientRect().height) + 'px';
            }
        }
        return _origSetProperty.call(this, prop, val, priority);
    };



    // --- 3. STORAGE ENGINE ---
    // Sole source of truth is localStorage. Cookies are NOT used — they expire,
    // have a hard 4 KB limit, and offer no real durability advantage over localStorage.

    const getAllTags = () => JSON.parse(localStorage.getItem('x_tags') || '{}');

    const saveFullLibrary = (data) => localStorage.setItem('x_tags', JSON.stringify(data));

    const getStoredTags = (name) => getAllTags()[name] || '';

    const getRecentTags = () => JSON.parse(localStorage.getItem('x_recent_tags') || '[]');

    const saveRecentTag = (tag) => {
        const recent = [tag, ...getRecentTags().filter(t => t !== tag)].slice(0, 10);
        localStorage.setItem('x_recent_tags', JSON.stringify(recent));
    };

    // Tag-level merge: for each eicon in `imported`, union its tags with the existing
    // tags for that eicon. Eicons only in `existing` are preserved untouched.
    const mergeLibraries = (existing, imported) => {
        const result = { ...existing };
        for (const [eicon, tagStr] of Object.entries(imported)) {
            if (!result[eicon]) {
                result[eicon] = tagStr;
            } else {
                const existingSet = new Set(result[eicon].split(',').map(t => t.trim().toLowerCase()).filter(Boolean));
                tagStr.split(',').map(t => t.trim().toLowerCase()).filter(Boolean).forEach(t => existingSet.add(t));
                result[eicon] = [...existingSet].join(', ');
            }
        }
        return result;
    };



    // --- 4. UI STYLES ---

    const style = document.createElement('style');
    style.textContent = `
        :root { --tag-h: 0px; }

        #x-tag-manager {
            position: relative; z-index: 999999; background: #1a1a1a;
            border-bottom: 3px solid gold; color: #eee; font-family: sans-serif;
            box-sizing: border-box; max-height: 50vh; overflow-y: auto; width: 100%;
        }
        #x-sticky-header {
            position: sticky; top: 0; background: #1a1a1a; z-index: 10;
            padding: 10px 15px; border-bottom: 1px solid #333;
        }
        #x-manager-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }

        .data-btn { cursor: pointer; background: #333; border: 1px solid #555; border-radius: 4px; padding: 4px 8px; font-size: 14px; color: #ccc; }
        #x-collapse-toggle { cursor: pointer; background: gold; color: black; font-weight: bold; padding: 4px 12px; border-radius: 4px; font-size: 11px; text-transform: uppercase; }

        /* Layout */
        x-mainapp, .app-root, #app { transition: transform 0.1s ease-out; }
        .filter-input { width: 100%; padding: 10px; background: #000; border: 1px solid #444; color: gold; border-radius: 4px; outline: none; box-sizing: border-box; }
        #x-explorer-body { padding: 0 15px 15px 15px; }
        #x-explorer-body.hidden { display: none; }

        /* Best Matches */
        #best-matches-container { margin: 10px 0; border: 1px solid gold; border-radius: 4px; background: #111; display: none; }
        .best-matches-header { background: gold; color: black; padding: 3px 10px; font-weight: bold; font-size: 11px; }
        .best-matches-content { display: flex !important; flex-direction: row !important; flex-wrap: wrap !important; gap: 8px; padding: 10px; }

        /* Category Collapses */
        .tag-container { margin-top: 8px; border: 1px solid #333; border-radius: 4px; background: #222; }
        .tag-header { background: #2a2a2a; padding: 6px 10px; font-size: 12px; font-weight: bold; color: gold; cursor: pointer; display: flex; justify-content: space-between; }
        .tag-header:hover { background: #333; }
        .tag-content { display: grid; grid-template-columns: repeat(auto-fill, minmax(90px, 1fr)); gap: 8px; padding: 10px; background: #111; }
        .tag-content.collapsed { display: none; }

        /* Ghost Eicons */
        .ghost-eicon { width: 85px; height: 105px; background: #1a1a1a; border: 1px solid #333; display: flex; flex-direction: column; align-items: center; justify-content: center; position: relative; cursor: copy; }
        .ghost-eicon img { max-width: 65px; max-height: 65px; }
        .ghost-eicon span.ghost-name { font-size: 9px; color: #aaa; margin-top: 4px; text-align: center; overflow: hidden; width: 100%; white-space: nowrap; }
        .ghost-eicon .copy-flash { position: absolute; inset: 0; background: rgba(255,215,0,0.25); display: flex; align-items: center; justify-content: center; font-size: 11px; color: gold; font-weight: bold; opacity: 0; pointer-events: none; transition: opacity 0.15s; border-radius: 2px; }
        .ghost-eicon.flashing .copy-flash { opacity: 1; }

        /* Modal */
        #x-tag-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.85); z-index: 1000001; display: none; align-items: center; justify-content: center; }

        /* Tag Mode */
        #x-tag-mode-toggle { cursor: pointer; font-weight: bold; padding: 4px 12px; border-radius: 4px; font-size: 11px; text-transform: uppercase; background: #333; color: #aaa; border: 1px solid #555; transition: background 0.2s, color 0.2s; }
        #x-tag-mode-toggle.active { background: #e74c3c; color: white; border-color: #c0392b; box-shadow: 0 0 8px rgba(231,76,60,0.5); }
        #x-tag-mode-banner { display: none; background: #2d0a0a; border-top: 1px solid #e74c3c; padding: 4px 15px; font-size: 11px; color: #e74c3c; letter-spacing: 0.3px; }
        #x-tag-mode-banner.visible { display: block; }
        #x-tag-modal { background: #1a1a1a; border: 2px solid gold; border-radius: 8px; width: 90%; max-width: 450px; padding: 20px; }
        #x-modal-title { color: gold; font-size: 13px; font-weight: bold; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid #333; }
        #x-modal-title span { color: #fff; font-weight: normal; }

        .chip-section-label { font-size: 10px; color: #888; margin-bottom: 5px; text-transform: uppercase; letter-spacing: 0.5px; }
        .chip-container { display: flex; flex-wrap: wrap; gap: 6px; }
        .chip { padding: 4px 10px; border-radius: 100px; font-size: 11px; font-weight: bold; display: flex; align-items: center; gap: 5px; user-select: none; }
        .chip.yellow { background: gold; color: #000; }
        .chip.blue { background: #007bff; color: #fff; cursor: pointer; }
        .chip.green { background: #28a745; color: #fff; cursor: pointer; }
    `;
    document.head.appendChild(style);



    // --- 5. MODAL ENGINE ---

    let currentIconName = '';
    let activeTags = [];

    // Stored reference to the search input so we never rely on a fragile class selector.
    let searchInput = null;

    // --- TAG MODE STATE ---
    // When active, any x-eiconview whose icon already has tags is hidden.
    let tagModeActive = false;

    function updateSuggestions(q) {
        const sBox = document.getElementById('x-suggestions');
        const rBox = document.getElementById('x-recent-suggestions');
        if (!sBox || !rBox) return;
        sBox.innerHTML = '';
        rBox.innerHTML = '';

        // Recent tags
        getRecentTags()
            .filter(t => !activeTags.includes(t) && (!q || t.includes(q)))
            .forEach(tag => {
                const c = document.createElement('div');
                c.className = 'chip green';
                c.innerHTML = `${tag} ↻`;
                c.onclick = () => { activeTags.push(tag); renderModalChips(); updateSuggestions(q); };
                rBox.appendChild(c);
            });

        // Tag library suggestions
        if (q) {
            const unique = new Set();
            Object.values(getAllTags()).forEach(str => str.split(',').forEach(t => unique.add(t.trim().toLowerCase())));
            Array.from(unique)
                .filter(t => t.includes(q) && !activeTags.includes(t))
                .slice(0, 8)
                .forEach(tag => {
                    const c = document.createElement('div');
                    c.className = 'chip blue';
                    c.innerHTML = `${tag} +`;
                    c.onclick = () => { activeTags.push(tag); renderModalChips(); updateSuggestions(q); };
                    sBox.appendChild(c);
                });
        }
    }

    function renderModalChips() {
        const container = document.getElementById('x-active-chips');
        if (!container) return;
        container.innerHTML = '';
        activeTags.forEach(tag => {
            const chip = document.createElement('div');
            chip.className = 'chip yellow';
            chip.innerHTML = `${tag} <span style="cursor:pointer">×</span>`;
            chip.onclick = () => {
                activeTags = activeTags.filter(t => t !== tag);
                renderModalChips();
                updateSuggestions(document.getElementById('x-modal-input').value.toLowerCase());
            };
            container.appendChild(chip);
        });
    }

    function openTagModal(name) {
        currentIconName = name;
        const raw = getStoredTags(name);
        activeTags = raw ? raw.split(',').map(t => t.trim().toLowerCase()).filter(Boolean) : [];

        if (!document.getElementById('x-tag-modal-overlay')) {
            const overlay = document.createElement('div');
            overlay.id = 'x-tag-modal-overlay';
            overlay.innerHTML = `
                <div id="x-tag-modal">
                    <div id="x-modal-title">🏷️ Tags for: <span id="x-modal-icon-name"></span></div>

                    <div class="chip-section-label">Recent</div>
                    <div id="x-recent-suggestions" class="chip-container" style="margin-bottom:10px; border-bottom:1px solid #333; padding-bottom:10px;"></div>

                    <div class="chip-section-label">Suggestions</div>
                    <div id="x-suggestions" class="chip-container" style="margin-bottom:10px;"></div>

                    <input type="text" id="x-modal-input" placeholder="Search/Add tags..."
                        style="width:100%; padding:10px; background:#000; color:#fff; border:1px solid #444; border-radius:4px; box-sizing:border-box;">

                    <div id="x-active-chips" class="chip-container" style="margin-top:15px;"></div>

                    <div style="margin-top:20px; display:flex; justify-content:flex-end; gap:10px;">
                        <button id="x-modal-cancel" style="background:#444; color:white; border:none; padding:8px 15px; cursor:pointer; border-radius:4px;">Cancel</button>
                        <button id="x-modal-save" style="background:gold; color:black; border:none; padding:8px 15px; font-weight:bold; cursor:pointer; border-radius:4px;">Save</button>
                    </div>
                </div>`;
            document.body.appendChild(overlay);

            const input = overlay.querySelector('#x-modal-input');
            input.oninput = (e) => updateSuggestions(e.target.value.toLowerCase());
            input.onkeydown = (e) => {
                if (e.key === ',' || e.key === 'Enter') {
                    e.preventDefault();
                    const v = input.value.trim().replace(/,/g, '').toLowerCase();
                    if (v && !activeTags.includes(v)) {
                        activeTags.push(v);
                        input.value = '';
                        renderModalChips();
                        updateSuggestions('');
                    }
                }
            };

            overlay.querySelector('#x-modal-cancel').onclick = () => { overlay.style.display = 'none'; };

            overlay.querySelector('#x-modal-save').onclick = () => {
                const lib = getAllTags();
                if (activeTags.length) {
                    lib[currentIconName] = activeTags.join(', ');
                    activeTags.forEach(saveRecentTag);
                } else {
                    delete lib[currentIconName];
                }
                saveFullLibrary(lib);
                overlay.style.display = 'none';
                if (searchInput) renderAllSearch(searchInput.value);
                if (tagModeActive) applyTagMode();
            };
        }

        document.getElementById('x-modal-icon-name').textContent = name;
        document.getElementById('x-tag-modal-overlay').style.display = 'flex';
        const input = document.getElementById('x-modal-input');
        input.value = '';
        input.focus();
        updateSuggestions('');
        renderModalChips();
    }



    // --- 6. RENDER ENGINE ---

    function flashCopied(el) {
        el.classList.add('flashing');
        setTimeout(() => el.classList.remove('flashing'), 600);
    }

    function createGhost(name) {
        const ghost = document.createElement('div');
        ghost.className = 'ghost-eicon';
        ghost.innerHTML = `
            <img src="https://static.f-list.net/images/eicon/${name}.gif">
            <span class="ghost-name">${name}</span>
            <div class="copy-flash">✓ Copied</div>`;

        const gBtn = document.createElement('button');
        gBtn.className = 'tag-btn';
        gBtn.innerHTML = '🏷️';
        gBtn.style.cssText = `
            position: absolute !important; bottom: 2px !important; left: 2px !important;
            z-index: 1000 !important; background: rgba(0,0,0,0.8) !important; color: white !important;
            border: 1px solid gold !important; border-radius: 4px !important; padding: 2px !important;
            font-size: 12px !important; width: 20px !important; height: 20px !important;
            display: flex !important; align-items: center !important; justify-content: center !important;
            opacity: 0; transition: opacity 0.2s; cursor: pointer !important;`;
        gBtn.onclick = (e) => { e.stopPropagation(); openTagModal(name); };

        ghost.appendChild(gBtn);
        ghost.onmouseenter = () => gBtn.style.opacity = '1';
        ghost.onmouseleave = () => gBtn.style.opacity = '0';
        ghost.onclick = () => {
            navigator.clipboard.writeText(`[eicon]${name}[/eicon]`);
            flashCopied(ghost);
        };

        return ghost;
    }

    function renderAllSearch(query) {
        const bestAnchor = document.getElementById('best-matches-content');
        const bestContainer = document.getElementById('best-matches-container');
        const listAnchor = document.getElementById('tag-list-anchor');

        listAnchor.innerHTML = '';
        bestAnchor.innerHTML = '';
        bestContainer.style.display = 'none';

        if (!query || query.trim().length < 1) return;

        const lib = getAllTags();
        const keywords = query.toLowerCase().split(' ').filter(k => k.length > 0);

        // Score each eicon by how many search keywords match any of its tags
        const scored = [];
        for (const [name, tagStr] of Object.entries(lib)) {
            const iconTags = tagStr.toLowerCase().split(',').map(t => t.trim());
            let score = 0;
            keywords.forEach(kw => { if (iconTags.some(tag => tag.includes(kw))) score++; });
            if (score > 0) scored.push({ name, score });
        }

        if (scored.length > 0) {
            bestContainer.style.display = 'block';
            scored.sort((a, b) => b.score - a.score).slice(0, 10).forEach(res => bestAnchor.appendChild(createGhost(res.name)));
        }

        // Group eicons by which of their tags match the query, one collapsible box per tag
        const tagMap = {};
        for (const [eicon, tagString] of Object.entries(lib)) {
            tagString.split(',').forEach(t => {
                const tag = t.trim().toLowerCase();
                if (tag.includes(query.toLowerCase())) {
                    if (!tagMap[tag]) tagMap[tag] = [];
                    tagMap[tag].push(eicon);
                }
            });
        }

        Object.keys(tagMap).sort().forEach(tag => {
            const cont = document.createElement('div');
            cont.className = 'tag-container';
            cont.innerHTML = `
                <div class="tag-header"><span>${tag.toUpperCase()}</span><span>▸</span></div>
                <div class="tag-content collapsed"></div>`;

            const header = cont.querySelector('.tag-header');
            const content = cont.querySelector('.tag-content');
            header.onclick = () => {
                const isCollapsed = content.classList.toggle('collapsed');
                header.querySelector('span:last-child').textContent = isCollapsed ? '▸' : '▾';
            };

            tagMap[tag].forEach(name => content.appendChild(createGhost(name)));
            listAnchor.appendChild(cont);
        });
    }



    // --- 7. EXPLORER PANEL ---

    function initExplorer() {
        if (document.getElementById('x-tag-manager')) return;

        const manager = document.createElement('div');
        manager.id = 'x-tag-manager';
        manager.innerHTML = `
            <div id="x-sticky-header">
                <div id="x-manager-header">
                    <div style="display:flex; align-items:center; gap:8px;">
                        <h3 style="color:gold; margin:0; font-size:14px;">🏷️ Tag Search</h3>
                        <div id="x-collapse-toggle">Collapse</div>
                        <div id="x-tag-mode-toggle" title="Hide already-tagged eicons">Tag Mode</div>
                    </div>
                    <div style="display:flex; gap:6px;">
                        <button class="data-btn" id="x-export" title="Export tags">💾</button>
                        <button class="data-btn" id="x-import" title="Import tags">📥</button>
                    </div>
                </div>
                <input type="text" class="filter-input" placeholder="Search tags...">
            </div>
            <div id="x-tag-mode-banner">🔴 Tag Mode active — eicons with tags are hidden</div>
            <div id="x-explorer-body">
                <div id="best-matches-container">
                    <div class="best-matches-header">✨ Best Matches</div>
                    <div id="best-matches-content" class="best-matches-content"></div>
                </div>
                <div id="tag-list-anchor"></div>
            </div>`;

        document.body.prepend(manager);

        // Push page content down by the exact height of our bar
        const updateOffset = () => {
            const h = manager.getBoundingClientRect().height;
            document.documentElement.style.setProperty('--tag-h', h + 'px');
            document.querySelectorAll('x-mainapp, .app-root, #app').forEach(el => el.style.transform = `translateY(${h}px)`);
        };
        new ResizeObserver(updateOffset).observe(manager);

        // Tag Mode toggle
        const tagModeBtn = manager.querySelector('#x-tag-mode-toggle');
        const tagModeBanner = manager.querySelector('#x-tag-mode-banner');
        tagModeBtn.onclick = () => {
            tagModeActive = !tagModeActive;
            tagModeBtn.classList.toggle('active', tagModeActive);
            tagModeBtn.textContent = tagModeActive ? 'Tag Mode ON' : 'Tag Mode';
            tagModeBanner.classList.toggle('visible', tagModeActive);
            applyTagMode();
        };

        // Collapse / expand
        const toggle = manager.querySelector('#x-collapse-toggle');
        const body = manager.querySelector('#x-explorer-body');
        toggle.onclick = () => {
            const isHidden = body.classList.toggle('hidden');
            toggle.textContent = isHidden ? 'Expand' : 'Collapse';
            toggle.style.background = isHidden ? '#444' : 'gold';
            toggle.style.color = isHidden ? 'white' : 'black';
        };

        // Export
        manager.querySelector('#x-export').onclick = () => {
            const b = new Blob([localStorage.getItem('x_tags') || '{}'], { type: 'text/plain' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(b);
            a.download = 'xariah_tags.txt';
            a.click();
        };

        // Import — uses a custom dialog instead of prompt() for cleaner UX
        manager.querySelector('#x-import').onclick = () => {
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = '.txt,application/json';
            fileInput.onchange = (e) => {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    let imported;
                    try { imported = JSON.parse(ev.target.result); }
                    catch { alert('Invalid tag file — could not parse JSON.'); return; }

                    showImportDialog(imported);
                };
                reader.readAsText(e.target.files[0]);
            };
            fileInput.click();
        };

        // Store reference to search input so modal save can refresh results safely
        searchInput = manager.querySelector('.filter-input');
        searchInput.oninput = (e) => renderAllSearch(e.target.value);
    }

    // Inline import dialog — avoids prompt() and gives clear Merge / Replace choice
    function showImportDialog(imported) {
        if (document.getElementById('x-import-dialog')) return;

        const importCount = Object.keys(imported).length;
        const existingCount = Object.keys(getAllTags()).length;

        const dialog = document.createElement('div');
        dialog.id = 'x-import-dialog';
        dialog.style.cssText = `position:fixed; inset:0; background:rgba(0,0,0,0.85); z-index:1000002; display:flex; align-items:center; justify-content:center;`;
        dialog.innerHTML = `
            <div style="background:#1a1a1a; border:2px solid gold; border-radius:8px; width:90%; max-width:400px; padding:20px; color:#eee; font-family:sans-serif;">
                <div style="color:gold; font-weight:bold; margin-bottom:12px;">📥 Import Tags</div>
                <div style="font-size:13px; color:#aaa; margin-bottom:16px; line-height:1.6;">
                    Importing <strong style="color:#eee;">${importCount}</strong> eicons.<br>
                    You currently have <strong style="color:#eee;">${existingCount}</strong> eicons tagged.<br><br>
                    <strong style="color:gold;">Merge</strong> — combine tags for shared eicons, add new ones.<br>
                    <strong style="color:#ff6b6b;">Replace</strong> — discard all existing tags entirely.
                </div>
                <div style="display:flex; justify-content:flex-end; gap:10px;">
                    <button id="x-import-cancel" style="background:#444; color:white; border:none; padding:8px 15px; cursor:pointer; border-radius:4px;">Cancel</button>
                    <button id="x-import-replace" style="background:#c0392b; color:white; border:none; padding:8px 15px; cursor:pointer; border-radius:4px; font-weight:bold;">Replace</button>
                    <button id="x-import-merge" style="background:gold; color:black; border:none; padding:8px 15px; cursor:pointer; border-radius:4px; font-weight:bold;">Merge</button>
                </div>
            </div>`;

        document.body.appendChild(dialog);
        dialog.querySelector('#x-import-cancel').onclick  = () => dialog.remove();
        dialog.querySelector('#x-import-replace').onclick = () => { saveFullLibrary(imported); dialog.remove(); location.reload(); };
        dialog.querySelector('#x-import-merge').onclick   = () => { saveFullLibrary(mergeLibraries(getAllTags(), imported)); dialog.remove(); location.reload(); };
    }



    // --- 8. TAG MODE ENGINE ---
    // Hides/shows x-eiconview elements based on whether their icon has tags stored.
    // Called on toggle and on every interval tick (so newly scrolled-in eicons are caught).

    function getIconNameFromElement(el) {
        const shadow = el.shadowRoot;
        if (!shadow) return null;
        const rootDiv = shadow.querySelector('.root');
        return rootDiv ? rootDiv.getAttribute('data-tooltip') : null;
    }

    function applyTagMode() {
        const lib = getAllTags();
        findDeep(document, 'x-eiconview').forEach(el => {
            if (!tagModeActive) {
                el.style.display = '';
                return;
            }
            const name = getIconNameFromElement(el);
            if (name && lib[name]) {
                el.style.display = 'none';
            } else {
                el.style.display = '';
            }
        });
    }



    // --- 9. LIVE EICON BUTTONS ---
    // Injects a tag button into each eicon's shadow root

    const processIcon = (el) => {
        const shadow = el.shadowRoot;
        if (!shadow || shadow.querySelector('.tag-btn')) return;

        const rootDiv = shadow.querySelector('.root');
        if (!rootDiv) return;

        const iconName = rootDiv.getAttribute('data-tooltip');
        if (!iconName) return;

        rootDiv.style.position = 'relative';

        const hasTags = getStoredTags(iconName);
        const btn = document.createElement('button');
        btn.className = 'tag-btn';
        btn.innerHTML = '🏷️';
        btn.style.cssText = `
            position: absolute !important; bottom: 2px !important; left: 2px !important;
            z-index: 1000 !important; background: rgba(0,0,0,0.8) !important; color: white !important;
            border: 1px solid ${hasTags ? 'gold' : '#444'} !important; border-radius: 4px !important;
            padding: 2px !important; cursor: pointer !important; font-size: 12px !important;
            width: 20px !important; height: 20px !important; display: flex !important;
            align-items: center !important; justify-content: center !important;
            opacity: 0; transition: opacity 0.2s; pointer-events: auto !important;
            box-shadow: ${hasTags ? '0 0 5px gold' : 'none'} !important;`;
        btn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); openTagModal(iconName); };

        const shadowStyle = document.createElement('style');
        shadowStyle.textContent = `.root:hover .tag-btn { opacity: 1 !important; } .tag-btn:hover { transform: scale(1.1); }`;
        shadow.appendChild(shadowStyle);
        rootDiv.appendChild(btn);
    };



    // --- 9. DEEP SHADOW QUERY ---

    function findDeep(root, selector, results = []) {
        if (!root) return results;
        results.push(...Array.from(root.querySelectorAll(selector)));
        Array.from(root.querySelectorAll('*')).filter(el => el.shadowRoot).forEach(host => findDeep(host.shadowRoot, selector, results));
        return results;
    }



    // --- 10. BOOT LOOP ---

    setInterval(() => {
        initExplorer();
        findDeep(document, 'x-eiconview').forEach(processIcon);
        if (tagModeActive) applyTagMode();
    }, 1000);

})();
