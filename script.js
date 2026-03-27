// ==UserScript==
// @name         Xariah Tagger
// @version      0.0.10
// @description  Alpha version of the tagging & search system for xariah eicon database
// @match        *://xariah.net/*
// @updateURL    https://mojojohoe.github.io/F-List-Eicon-Categories/script.js
// @downloadURL  https://mojojohoe.github.io/F-List-Eicon-Categories/script.js
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    const SCRIPT_VERSION = '0.0.10';

    // Injected into every x-popuphost shadow root to hide the native tooltip.
    // Defined early because the attachShadow hook below references it at call time.
    const POPUPHOST_SUPPRESS_STYLE = 'x-tooltippopup { display: none !important; }';



    // --- 1. SHADOW-ROOT OPENER + TOOLTIP SUPPRESSOR ---
    // Forces all shadow roots into open mode so we can read/write into them.
    // When x-popuphost creates its shadow root, we immediately:
    //   a) inject a CSS rule (belt)
    //   b) watch for x-tooltippopup being added and force inline display:none (braces)
    //   c) watch x-tooltippopup's style attribute — Xariah writes `top` and `left`
    //      inline on every mouse move, which can resurrect visibility. We reassert
    //      display:none as an inline !important each time to keep it dead.

    const _origAttachShadow = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function(init) {
        if (init) init.mode = 'open';
        const shadow = _origAttachShadow.call(this, init);
        if (this.tagName === 'X-POPUPHOST') {
            // Belt: CSS rule inside this shadow scope
            const s = document.createElement('style');
            s.textContent = POPUPHOST_SUPPRESS_STYLE;
            shadow.appendChild(s);

            // Braces: catch x-tooltippopup the moment it's inserted and keep it hidden
            const childObs = new MutationObserver((mutations) => {
                for (const mut of mutations) {
                    for (const node of mut.addedNodes) {
                        if (node.nodeType !== 1) continue;
                        suppressTooltipNode(node);
                        // Also scan descendants in case it's wrapped
                        node.querySelectorAll?.('x-tooltippopup').forEach(suppressTooltipNode);
                    }
                }
            });
            childObs.observe(shadow, { childList: true, subtree: true });
        }
        return shadow;
    };

    function suppressTooltipNode(node) {
        if (node.tagName !== 'X-TOOLTIPPOPUP') return;
        // Force inline display:none with !important — beats any stylesheet or JS assignment
        node.style.setProperty('display', 'none', 'important');

        // Watch for Xariah re-writing the style attribute (it does this on every pointermove)
        // and reassert display:none each time, unless WE were the one who wrote it.
        const styleObs = new MutationObserver(() => {
            const p = node.style.getPropertyPriority('display');
            const v = node.style.getPropertyValue('display');
            if (v !== 'none' || p !== 'important') {
                node.style.setProperty('display', 'none', 'important');
            }
        });
        styleObs.observe(node, { attributes: true, attributeFilter: ['style'] });
    }



    // --- 2. TOOLTIP PATCH ---
    // The native x-tooltippopup lives inside x-popuphost's shadow root, which lives
    // inside x-popuplayer's shadow root, inside x-mainapp's shadow root.
    // x-mainapp is translated down by our tag manager bar height, which shifts its entire
    // coordinate space — so the native tooltip's clientY-based `top` value always renders
    // too low by exactly that height. No CSS can reach it from outside.
    //
    // Solution A (chosen): suppress the native tooltip entirely by injecting
    // `x-tooltippopup { display:none }` into x-popuphost's shadow root the moment it
    // is created (via our already-running attachShadow hook). Then show our own
    // position:fixed tooltip appended to document.body — completely outside x-mainapp,
    // immune to translateY, positioned using raw clientX/clientY.

    // Our custom tooltip element — created once, reused
    let _customTooltip = null;
    let _tooltipHideTimer = null;

    function getCustomTooltip() {
        if (_customTooltip) return _customTooltip;
        _customTooltip = document.createElement('div');
        _customTooltip.id = 'x-custom-tooltip';
        _customTooltip.style.cssText = `
            position: fixed;
            z-index: 2147483647;
            background: #1a1a1a;
            color: #eee;
            border: 1px solid #555;
            border-radius: 4px;
            padding: 4px 8px;
            font-size: 12px;
            font-family: sans-serif;
            pointer-events: none;
            white-space: pre;
            max-width: 300px;
            display: none;
            box-shadow: 0 2px 8px rgba(0,0,0,0.6);
        `;
        document.body.appendChild(_customTooltip);
        return _customTooltip;
    }

    function showCustomTooltip(text, x, y) {
        clearTimeout(_tooltipHideTimer);
        const tt = getCustomTooltip();
        tt.textContent = text;
        tt.style.display = 'block';
        // Position 12px right and below the cursor, clamp to viewport
        const pad = 12;
        const ttW = tt.offsetWidth  || 120;
        const ttH = tt.offsetHeight || 24;
        const left = Math.min(x + pad, window.innerWidth  - ttW - 8);
        const top  = Math.min(y + pad, window.innerHeight - ttH - 8);
        tt.style.left = left + 'px';
        tt.style.top  = top  + 'px';
    }

    function hideCustomTooltip() {
        clearTimeout(_tooltipHideTimer);
        _tooltipHideTimer = setTimeout(() => {
            if (_customTooltip) _customTooltip.style.display = 'none';
        }, 80);
    }

    // Walk composedPath() to find the nearest element with data-tooltip.
    // composedPath() pierces all open shadow roots, so this works across
    // the full x-eiconsetvirtualview → x-eiconview → .root shadow chain.
    function findTooltipTarget(composedPath) {
        for (const el of composedPath) {
            if (el.nodeType === 1 && el.hasAttribute?.('data-tooltip')) return el;
        }
        return null;
    }

    // Attached once; tracks current hovered tooltip target for hide logic
    let _currentTooltipTarget = null;

    function initTooltipPatch() {
        // Catch any x-popuphost elements that already exist (edge case on slow pages)
        document.querySelectorAll('x-popuphost').forEach(host => {
            if (!host.shadowRoot) return;
            if (!host._xTooltipSuppressed) {
                host._xTooltipSuppressed = true;
                const s = document.createElement('style');
                s.textContent = POPUPHOST_SUPPRESS_STYLE;
                host.shadowRoot.appendChild(s);
            }
            host.shadowRoot.querySelectorAll('x-tooltippopup').forEach(suppressTooltipNode);
        });

        if (window._xTooltipHandlerBound) return;
        window._xTooltipHandlerBound = true;

        document.body.addEventListener('pointermove', (ev) => {
            if ((ev.pointerType ?? 'mouse') !== 'mouse') return;
            const target = findTooltipTarget(ev.composedPath());
            if (target) {
                _currentTooltipTarget = target;
                showCustomTooltip(target.getAttribute('data-tooltip'), ev.clientX, ev.clientY);
            } else {
                if (_currentTooltipTarget) {
                    _currentTooltipTarget = null;
                    hideCustomTooltip();
                }
            }
        }, { passive: true });

        // Hide immediately when pointer leaves the window
        document.body.addEventListener('pointerleave', hideCustomTooltip);
    }



    // --- 3. STORAGE ENGINE ---
    // Sole source of truth is localStorage.
    // All three stores use in-memory caches to avoid repeated JSON.parse on every call.
    // Caches are invalidated (set to null) whenever the corresponding store is written.
    // The unique-tag-set cache is derived from the tag library and rebuilt only on write.

    let _tagCache        = null;  // { [eiconName]: "tag1, tag2" }
    let _gridCache       = null;  // { [eiconName]: { spec, pos } }
    let _recentCache     = null;  // string[]
    let _uniqueTagsCache = null;  // Set<string> — all distinct tags across the library

    const getAllTags = () => {
        if (_tagCache === null) {
            const raw = JSON.parse(localStorage.getItem('x_tags') || '{}');
            // Guard: detect a store corrupted by importing a versioned file into old code.
            // A valid tag library has string values. The versioned file format has a
            // 'tags' key whose value is an object. If we find that, unwrap it.
            if (raw.version === 1 && raw.tags && typeof raw.tags === 'object') {
                console.warn('[XariahTagger] Detected corrupted x_tags (versioned file stored as library). Auto-recovering.');
                _tagCache = raw.tags;
                _gridCache = raw.grid || null;
                // Persist the corrected data immediately
                localStorage.setItem('x_tags', JSON.stringify(_tagCache));
                if (_gridCache) localStorage.setItem('x_grid_data', JSON.stringify(_gridCache));
            } else {
                _tagCache = raw;
            }
        }
        return _tagCache;
    };

    const saveFullLibrary = (data) => {
        _tagCache = data;
        _uniqueTagsCache = null; // tag set must be rebuilt after any library change
        localStorage.setItem('x_tags', JSON.stringify(data));
    };

    const getStoredTags = (name) => getAllTags()[name] || '';

    // Grid data is stored separately — it is positional metadata, not a searchable tag.
    // Schema: { [iconName]: { spec: "2x2", pos: number | null } }
    const getAllGridData = () => {
        if (_gridCache === null) _gridCache = JSON.parse(localStorage.getItem('x_grid_data') || '{}');
        return _gridCache;
    };

    const saveAllGridData = (d) => {
        _gridCache = d;
        localStorage.setItem('x_grid_data', JSON.stringify(d));
    };

    const getIconGrid  = (name) => getAllGridData()[name] || null;
    const saveIconGrid = (name, spec, pos) => {
        const d = getAllGridData();
        if (spec) d[name] = { spec, pos: pos ?? null };
        else delete d[name];
        saveAllGridData(d);
    };

    const getRecentTags = () => {
        if (_recentCache === null) _recentCache = JSON.parse(localStorage.getItem('x_recent_tags') || '[]');
        return _recentCache;
    };

    const saveRecentTag = (tag) => {
        const recent = [tag, ...getRecentTags().filter(t => t !== tag)].slice(0, 16);
        _recentCache = recent;
        localStorage.setItem('x_recent_tags', JSON.stringify(recent));
    };

    // Returns a cached Set of every distinct tag string across the whole library.
    // Rebuilt lazily after any saveFullLibrary call.
    const getUniqueTagSet = () => {
        if (_uniqueTagsCache === null) {
            _uniqueTagsCache = new Set();
            Object.values(getAllTags()).forEach(str =>
                str.split(',').forEach(t => {
                    const trimmed = t.trim().toLowerCase();
                    if (trimmed) _uniqueTagsCache.add(trimmed);
                })
            );
        }
        return _uniqueTagsCache;
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

        /* Category Collapses */
        .tag-container { margin-top: 8px; border: 1px solid #333; border-radius: 4px; background: #222; }
        .tag-header { background: #2a2a2a; padding: 6px 10px; font-size: 12px; font-weight: bold; color: gold; cursor: pointer; display: flex; justify-content: space-between; }
        .tag-header:hover { background: #333; }

        /* Shared grid layout — square 85×85 cells so composites are never distorted.
           grid-auto-flow: dense fills gaps before placing new rows. */
        .results-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, 85px);
            grid-auto-rows: 85px;
            grid-auto-flow: row dense;
            gap: 4px;
            padding: 10px;
            background: #111;
        }
        .tag-content { display: none; }
        .tag-content.open { display: grid;
            grid-template-columns: repeat(auto-fill, 85px);
            grid-auto-rows: 85px;
            grid-auto-flow: row dense;
            gap: 4px; padding: 10px; background: #111;
        }

        /* Ghost Eicons — square cell, name as bottom overlay */
        .ghost-eicon {
            width: 85px; height: 85px; background: #1a1a1a; border: 1px solid #333;
            display: flex; align-items: center; justify-content: center;
            position: relative; cursor: copy; overflow: hidden;
        }
        .ghost-eicon img { max-width: 65px; max-height: 65px; display: block; }
        .ghost-eicon span.ghost-name {
            position: absolute; bottom: 0; left: 0; right: 0;
            font-size: 9px; color: #ddd; text-align: center;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            background: rgba(0,0,0,0.65); padding: 2px 3px;
            pointer-events: none;
        }
        .ghost-eicon .copy-flash {
            position: absolute; inset: 0; background: rgba(255,215,0,0.25);
            display: flex; align-items: center; justify-content: center;
            font-size: 11px; color: gold; font-weight: bold;
            opacity: 0; pointer-events: none; transition: opacity 0.15s;
        }
        .ghost-eicon.flashing .copy-flash { opacity: 1; }

        /* Best Matches — same grid, no height cap; manager's 50vh handles overflow */
        #best-matches-container { margin: 10px 0; border: 1px solid gold; border-radius: 4px; background: #111; display: none; }
        .best-matches-header { background: gold; color: black; padding: 3px 10px; font-weight: bold; font-size: 11px; }
        .best-matches-content {
            display: grid !important;
            grid-template-columns: repeat(auto-fill, 85px) !important;
            grid-auto-rows: 85px !important;
            grid-auto-flow: row dense !important;
            gap: 4px !important;
            padding: 10px !important;
        }

        /* Grid Composites — span N cols × M rows; internal cells are 1fr so always square */
        .grid-composite-wrap {
            position: relative; cursor: copy; box-sizing: border-box;
        }
        .grid-composite-inner {
            width: 100%; height: 100%; display: grid; gap: 2px;
            background: #0d0d0d; border: 1px solid #444; border-radius: 3px;
            padding: 2px; box-sizing: border-box;
        }
        .grid-composite-cell {
            overflow: hidden; background: #1a1a1a; border: 1px solid #2a2a2a;
            position: relative; display: flex; align-items: center; justify-content: center;
            min-width: 0; min-height: 0;
        }
        .grid-composite-cell img { width: 100%; height: 100%; object-fit: contain; display: block; }
        .grid-composite-cell.empty { background: #111; border: 1px dashed #2a2a2a; }
        .grid-composite-cell .cell-tag-btn {
            position: absolute; bottom: 2px; left: 2px; z-index: 10;
            background: rgba(0,0,0,0.8); color: white; border: 1px solid #444;
            border-radius: 3px; padding: 1px; font-size: 10px; width: 16px; height: 16px;
            display: flex; align-items: center; justify-content: center;
            opacity: 0; transition: opacity 0.15s; cursor: pointer;
        }
        .grid-composite-cell:hover .cell-tag-btn { opacity: 1; }
        .grid-composite-wrap .composite-copy-flash {
            position: absolute; inset: 0; background: rgba(255,215,0,0.25);
            display: flex; align-items: center; justify-content: center;
            font-size: 11px; color: gold; font-weight: bold;
            opacity: 0; pointer-events: none; transition: opacity 0.15s; border-radius: 3px; z-index: 5;
        }
        .grid-composite-wrap.flashing .composite-copy-flash { opacity: 1; }

        /* Modal */
        #x-tag-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.85); z-index: 1000001; display: none; align-items: center; justify-content: center; }

        /* Tag Mode button — base state and active state */
        /* NOTE: x-eiconview lives inside a shadow root so page CSS cannot pierce it.
           Dimming is applied via inline styles in applyTagMode() instead. */
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
        .chip.red { background: #e74c3c; color: #fff; cursor: default; }

        /* Grid tag widget */
        #x-grid-area { margin-top: 10px; display: none; }
        #x-input-row { display: flex; align-items: center; gap: 8px; }
        #x-input-row #x-modal-input { flex: 1; }
        #x-grid-chip-slot { display: flex; align-items: center; flex-shrink: 0; }
        #x-grid-widget { display: inline-grid; gap: 4px; margin-top: 8px; }
        .grid-cell {
            width: 28px; height: 28px; background: #2a2a2a; border: 1px solid #555;
            border-radius: 3px; cursor: pointer; transition: background 0.15s;
        }
        .grid-cell:hover { background: #444; }
        .grid-cell.selected { background: #e74c3c; border-color: #c0392b; box-shadow: 0 0 4px rgba(231,76,60,0.6); }
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

    // --- GRID TAG STATE ---
    // activeGridSpec: parsed grid tag e.g. { raw: "#2x2", rows: 2, cols: 2 } or null
    // activeGridPos:  0-indexed flat cell index (row-major), or null if unset
    let activeGridSpec = null;
    let activeGridPos  = null;

    // Tracks the last typed suggestion query so chip clicks can preserve visible suggestions
    let suggestionQuery = '';

    // Stores tags + gridSpec from the most recent save, for "copy from last" feature
    let lastSavedEntry = null;

    function updateSuggestions(q) {
        const sBox = document.getElementById('x-suggestions');
        const rBox = document.getElementById('x-recent-suggestions');
        if (!sBox || !rBox) return;
        sBox.innerHTML = '';
        rBox.innerHTML = '';

        // Recent tags — clicking clears the input but keeps current suggestions visible
        getRecentTags()
            .filter(t => !activeTags.includes(t) && (!q || t.includes(q)))
            .forEach(tag => {
                const c = document.createElement('div');
                c.className = 'chip green';
                c.innerHTML = `${tag} ↻`;
                // Prevent mousedown from stealing focus away from the input
                c.addEventListener('mousedown', e => e.preventDefault());
                c.onclick = () => {
                    activeTags.push(tag);
                    renderModalChips();
                    const input = document.getElementById('x-modal-input');
                    if (input) { input.value = ''; input.focus(); }
                    updateSuggestions(suggestionQuery);
                };
                rBox.appendChild(c);
            });

        // Tag library suggestions — uses cached unique tag set, rebuilt only on save
        if (q) {
            Array.from(getUniqueTagSet())
                .filter(t => t.includes(q) && !activeTags.includes(t))
                .slice(0, 8)
                .forEach(tag => {
                    const c = document.createElement('div');
                    c.className = 'chip blue';
                    c.innerHTML = `${tag} +`;
                    // Prevent mousedown from stealing focus away from the input
                    c.addEventListener('mousedown', e => e.preventDefault());
                    c.onclick = () => {
                        activeTags.push(tag);
                        renderModalChips();
                        const input = document.getElementById('x-modal-input');
                        if (input) { input.value = ''; input.focus(); }
                        updateSuggestions(suggestionQuery);
                    };
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

    // Parses a string like "#2x4" → { raw, rows, cols } or null if not a valid grid tag.
    function parseGridTag(str) {
        const m = str.trim().match(/^#(\d+)x(\d+)$/i);
        if (!m) return null;
        const rows = parseInt(m[1], 10);
        const cols = parseInt(m[2], 10);
        if (rows < 1 || cols < 1 || rows > 20 || cols > 20) return null;
        return { raw: str.trim().toLowerCase(), rows, cols };
    }

    // Derives the group base name for an eicon by stripping a trailing suffix of up to
    // 3 characters that looks like a position indicator (digits, or separator+digits,
    // or trailing letters from a digit-ended name). The base must be ≥3 chars.
    //
    // Examples:  square1 → square   square-12 → square   squarea → square
    //            hypno clock 2 → hypno clock   rune3b → rune
    //            cat → cat (too short to strip)
    function getGroupBase(name) {
        const n = name.toLowerCase();
        // Most common: trailing digits e.g. square1, square12, square123
        let m = n.match(/^(.{3,}?[^0-9])(\d{1,3})$/);
        if (m) return m[1].replace(/[-_ ]$/, '');
        // Separator + digits e.g. square-1, frame_12
        m = n.match(/^(.{3,})[-_ ]\d{1,3}$/);
        if (m) return m[1];
        // Trailing letters after a digit/separator e.g. rune3b, rune3ab
        m = n.match(/^(.{3,}[0-9])([a-z]{1,2})$/);
        if (m) return m[1];
        return n;
    }

    function renderGridArea() {
        const chipSlot  = document.getElementById('x-grid-chip-slot');
        const gridArea  = document.getElementById('x-grid-area');
        const gridWidget = document.getElementById('x-grid-widget');
        if (!chipSlot || !gridArea || !gridWidget) return;

        chipSlot.innerHTML  = '';
        gridWidget.innerHTML = '';

        if (!activeGridSpec) {
            gridArea.style.display = 'none';
            return;
        }

        // Red chip with remove button
        const chip = document.createElement('div');
        chip.className = 'chip red';
        chip.innerHTML = `${activeGridSpec.raw} <span style="cursor:pointer; margin-left:2px;">×</span>`;
        chip.querySelector('span').onclick = () => {
            activeGridSpec = null;
            activeGridPos  = null;
            renderGridArea();
            updateSuggestions(document.getElementById('x-modal-input')?.value.toLowerCase() || '');
        };
        chipSlot.appendChild(chip);

        // Grid widget
        const { rows, cols } = activeGridSpec;
        gridWidget.style.gridTemplateColumns = `repeat(${cols}, 28px)`;
        gridArea.style.display = 'block';

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const idx = r * cols + c;
                const cell = document.createElement('div');
                cell.className = 'grid-cell' + (activeGridPos === idx ? ' selected' : '');
                cell.title = `Row ${r + 1}, Col ${c + 1}`;
                cell.onclick = () => {
                    // Clicking the already-selected cell deselects it
                    activeGridPos = activeGridPos === idx ? null : idx;
                    renderGridArea();
                };
                gridWidget.appendChild(cell);
            }
        }
    }

    function openTagModal(name) {
        currentIconName = name;
        const raw = getStoredTags(name);
        activeTags = raw ? raw.split(',').map(t => t.trim().toLowerCase()).filter(Boolean) : [];

        // Load any existing grid data for this icon
        const existingGrid = getIconGrid(name);
        if (existingGrid) {
            activeGridSpec = parseGridTag(existingGrid.spec.startsWith('#') ? existingGrid.spec : '#' + existingGrid.spec) || parseGridTag('#' + existingGrid.spec);
            // Normalise: spec may have been stored without '#' historically
            if (!activeGridSpec) activeGridSpec = null;
            activeGridPos = existingGrid.pos ?? null;
        } else {
            activeGridSpec = null;
            activeGridPos  = null;
        }

        if (!document.getElementById('x-tag-modal-overlay')) {
            const overlay = document.createElement('div');
            overlay.id = 'x-tag-modal-overlay';
            overlay.innerHTML = `
                <div id="x-tag-modal">
                <div id="x-modal-title">
                    🏷️ Tags for: <span id="x-modal-icon-name"></span>
                    <button id="x-copy-last-btn" title="Copy all tags from last saved eicon"
                        style="float:right; background:#2a2a2a; color:#aaa; border:1px solid #444; border-radius:4px; padding:3px 8px; font-size:10px; cursor:pointer; margin-left:8px; text-transform:uppercase; letter-spacing:0.4px;">
                        ↩ Copy Last
                    </button>
                </div>

                    <div class="chip-section-label">Recent</div>
                    <div id="x-recent-suggestions" class="chip-container" style="margin-bottom:10px; border-bottom:1px solid #333; padding-bottom:10px;"></div>

                    <div class="chip-section-label">Suggestions</div>
                    <div id="x-suggestions" class="chip-container" style="margin-bottom:10px;"></div>

                    <div id="x-input-row">
                        <input type="text" id="x-modal-input" placeholder="Search/Add tags… or #2x4 for a grid"
                            style="padding:10px; background:#000; color:#fff; border:1px solid #444; border-radius:4px; box-sizing:border-box;">
                        <div id="x-grid-chip-slot"></div>
                    </div>

                    <div id="x-grid-area">
                        <div style="font-size:10px; color:#888; margin-bottom:6px; text-transform:uppercase; letter-spacing:0.5px;">Grid Position</div>
                        <div id="x-grid-widget"></div>
                    </div>

                    <div id="x-active-chips" class="chip-container" style="margin-top:15px;"></div>

                    <div style="margin-top:20px; display:flex; justify-content:flex-end; gap:10px;">
                        <button id="x-modal-cancel" style="background:#444; color:white; border:none; padding:8px 15px; cursor:pointer; border-radius:4px;">Cancel</button>
                        <button id="x-modal-save" style="background:gold; color:black; border:none; padding:8px 15px; font-weight:bold; cursor:pointer; border-radius:4px;">Save</button>
                    </div>
                </div>`;
            document.body.appendChild(overlay);

            const input = overlay.querySelector('#x-modal-input');
            input.oninput = (e) => {
                suggestionQuery = e.target.value.toLowerCase();
                updateSuggestions(suggestionQuery);
            };
            input.onkeydown = (e) => {
                if (e.key === ',' || e.key === 'Enter') {
                    e.preventDefault();
                    const v = input.value.trim().replace(/,/g, '').toLowerCase();
                    if (!v) return;

                    // Check for grid tag format #NxM
                    const parsed = parseGridTag(v);
                    if (parsed) {
                        // Replace any existing grid tag — only one allowed
                        activeGridSpec = parsed;
                        activeGridPos  = null;
                        input.value = '';
                        renderGridArea();
                        updateSuggestions('');
                        return;
                    }

                    if (!activeTags.includes(v)) {
                        activeTags.push(v);
                        input.value = '';
                        renderModalChips();
                        updateSuggestions('');
                    }
                }
            };

            // Copy-from-last button
            overlay.querySelector('#x-copy-last-btn').onclick = () => {
                if (!lastSavedEntry) return;
                activeTags = [...lastSavedEntry.tags];
                if (lastSavedEntry.gridSpec) {
                    activeGridSpec = parseGridTag(lastSavedEntry.gridSpec);
                    activeGridPos  = null; // position is intentionally not copied
                } else {
                    activeGridSpec = null;
                    activeGridPos  = null;
                }
                renderModalChips();
                renderGridArea();
                updateSuggestions(suggestionQuery);
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

                // Record this save for the "copy from last" feature
                lastSavedEntry = {
                    tags: [...activeTags],
                    gridSpec: activeGridSpec ? activeGridSpec.raw : null
                };

                // Save grid tag data independently of searchable tags
                saveIconGrid(currentIconName, activeGridSpec ? activeGridSpec.raw : null, activeGridPos);

                overlay.style.display = 'none';
                if (searchInput) renderAllSearch(searchInput.value);
                if (tagModeActive) applyTagMode();
            };
        }

        document.getElementById('x-modal-icon-name').textContent = name;
        document.getElementById('x-tag-modal-overlay').style.display = 'flex';

        // Show copy-last button only when there's a previous entry to copy from
        const copyLastBtn = document.getElementById('x-copy-last-btn');
        if (copyLastBtn) copyLastBtn.style.display = lastSavedEntry ? 'inline-block' : 'none';

        suggestionQuery = '';
        const input = document.getElementById('x-modal-input');
        input.value = '';
        input.focus();
        updateSuggestions('');
        renderModalChips();
        renderGridArea();
    }



    // --- 6. RENDER ENGINE ---

    function flashCopied(el) {
        el.classList.add('flashing');
        setTimeout(() => el.classList.remove('flashing'), 600);
    }

    // Builds a composite grid DOM element that spans N×M cells in the parent CSS grid.
    // members: [{ name, spec, pos }]
    // Returns null if no valid spec can be determined.
    function buildGridComposite(members) {
        const specSource = members.find(m => m.spec && m.pos !== null) || members.find(m => m.spec);
        if (!specSource) return null;

        const specStr = specSource.spec.startsWith('#') ? specSource.spec : '#' + specSource.spec;
        const spec = parseGridTag(specStr);
        if (!spec) return null;

        const { rows, cols } = spec;

        // Map flat index → icon name
        const posMap = {};
        members.forEach(m => { if (m.pos !== null && m.pos !== undefined) posMap[m.pos] = m.name; });

        const wrap = document.createElement('div');
        wrap.className = 'grid-composite-wrap';
        wrap.style.cssText = `grid-column: span ${cols}; grid-row: span ${rows};`;

        const inner = document.createElement('div');
        inner.className = 'grid-composite-inner';
        inner.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
        inner.style.gridTemplateRows    = `repeat(${rows}, 1fr)`;
        // Store grid dimensions on the container so the click handler can read them
        inner.dataset.rows = String(rows);
        inner.dataset.cols = String(cols);

        for (let i = 0; i < rows * cols; i++) {
            const eiconName = posMap[i] || '';
            const cell = document.createElement('div');
            cell.className = 'grid-composite-cell' + (eiconName ? '' : ' empty');
            // Store the eicon name (or empty string for gaps) directly on the cell element
            cell.dataset.eiconName = eiconName;

            if (eiconName) {
                const img = document.createElement('img');
                img.src = `https://static.f-list.net/images/eicon/${eiconName}.gif`;
                img.loading = 'lazy';
                img.ondragstart = (e) => e.preventDefault();
                cell.appendChild(img);

                const tagBtn = document.createElement('button');
                tagBtn.className = 'cell-tag-btn';
                tagBtn.innerHTML = '🏷️';
                tagBtn.title = `Edit tags for ${eiconName}`;
                tagBtn.onclick = (e) => { e.stopPropagation(); openTagModal(eiconName); };
                cell.appendChild(tagBtn);
            }

            // Build BBCode fresh from cell data attributes at click time.
            // This avoids any closure, precomputed string, or dataset encoding issue.
            cell.onclick = () => {
                const r = parseInt(inner.dataset.rows, 10);
                const c = parseInt(inner.dataset.cols, 10);
                const allCells = inner.querySelectorAll('.grid-composite-cell');
                const lines = [];
                for (let row = 0; row < r; row++) {
                    let line = '';
                    for (let col = 0; col < c; col++) {
                        const n = allCells[row * c + col]?.dataset.eiconName || '';
                        line += n ? `[eicon]${n}[/eicon]` : '[eicon]none[/eicon]';
                    }
                    lines.push(line);
                }
                navigator.clipboard.writeText(lines.join('\n'));
                wrap.classList.add('flashing');
                setTimeout(() => wrap.classList.remove('flashing'), 600);
            };

            inner.appendChild(cell);
        }

        const flash = document.createElement('div');
        flash.className = 'composite-copy-flash';
        flash.textContent = '✓ Copied';

        wrap.appendChild(inner);
        wrap.appendChild(flash);

        return wrap;
    }

    // Renders either a grid composite (if the eicon has grid data and its group hasn't
    // been rendered yet in this section) or a plain ghost eicon.
    // renderedBases is a Set local to the current render section — pass a fresh one
    // per best-matches block and per tag category so composites aren't suppressed
    // across different result sections.
    function renderEiconOrComposite(name, renderedBases) {
        const gridData = getAllGridData();
        const gd = gridData[name];

        if (gd) {
            const base = getGroupBase(name);
            if (renderedBases.has(base)) return null;
            renderedBases.add(base);

            // Collect ALL members of this group from the full grid data store
            const members = Object.entries(gridData)
                .filter(([n]) => getGroupBase(n) === base)
                .map(([n, d]) => ({ name: n, ...d }));

            const composite = buildGridComposite(members);
            if (composite) return composite;
        }

        return createGhost(name);
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

        // Split query into positive and negative keywords.
        // A word prefixed with '-' is a negative (exclusion) term.
        // Note: tags containing hyphens are unaffected — the '-' prefix only applies
        // to the first character of a search word, not within a tag itself.
        const allKeywords = query.toLowerCase().split(' ').filter(k => k.length > 0);
        const positiveKws = allKeywords.filter(k => !k.startsWith('-'));
        const negativeKws = allKeywords.filter(k => k.startsWith('-')).map(k => k.slice(1)).filter(k => k.length > 0);

        // Bail out if there are no positive terms — negative-only queries return nothing
        if (positiveKws.length === 0) return;

        const lib = getAllTags();

        // Returns true if an eicon's tags contain any negative keyword
        const isExcluded = (tagStr) => {
            if (negativeKws.length === 0) return false;
            const iconTags = tagStr.toLowerCase().split(',').map(t => t.trim());
            return negativeKws.some(nkw => iconTags.some(tag => tag.includes(nkw)));
        };

        // Score each eicon by how many positive keywords match any of its tags.
        // Eicons matching any negative keyword are excluded entirely.
        const scored = [];
        for (const [name, tagStr] of Object.entries(lib)) {
            if (isExcluded(tagStr)) continue;
            const iconTags = tagStr.toLowerCase().split(',').map(t => t.trim());
            let score = 0;
            positiveKws.forEach(kw => { if (iconTags.some(tag => tag.includes(kw))) score++; });
            if (score > 0) scored.push({ name, score });
        }

        if (scored.length > 0) {
            bestContainer.style.display = 'block';
            const bestRendered = new Set();
            scored.sort((a, b) => b.score - a.score).slice(0, 30).forEach(res => {
                const el = renderEiconOrComposite(res.name, bestRendered);
                if (el) bestAnchor.appendChild(el);
            });
        }

        // Build one category section per tag that matches any positive keyword.
        // Each category only contains eicons not excluded by negative keywords.
        const tagMap = {};
        for (const [eicon, tagString] of Object.entries(lib)) {
            if (isExcluded(tagString)) continue;
            tagString.split(',').forEach(t => {
                const tag = t.trim().toLowerCase();
                if (positiveKws.some(kw => tag.includes(kw))) {
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
                const isCollapsed = !content.classList.contains('open');
                content.classList.toggle('open', isCollapsed);
                header.querySelector('span:last-child').textContent = isCollapsed ? '▾' : '▸';
            };

            const catRendered = new Set();
            tagMap[tag].forEach(name => {
                const el = renderEiconOrComposite(name, catRendered);
                if (el) content.appendChild(el);
            });

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
                        <span style="font-size:10px; color:#555; font-family:monospace;">v${SCRIPT_VERSION}</span>
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

        // Export — bundles tags AND grid data into a single versioned file.
        // Format: { version: 1, tags: {...}, grid: {...} }
        // Old single-store files (plain tag object) are still importable.
        manager.querySelector('#x-export').onclick = () => {
            const payload = JSON.stringify({
                version: 1,
                tags: getAllTags(),
                grid: getAllGridData()
            }, null, 2);
            const b = new Blob([payload], { type: 'text/plain' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(b);
            a.download = 'xariah_tags.txt';
            a.click();
        };

        // Import — handles both the new versioned format { version, tags, grid }
        // and old single-store files (plain tag object) for backward compatibility.
        manager.querySelector('#x-import').onclick = () => {
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = '.txt,application/json';
            fileInput.onchange = (e) => {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    let parsed;
                    try { parsed = JSON.parse(ev.target.result); }
                    catch { alert('Invalid tag file — could not parse JSON.'); return; }

                    let importedTags, importedGrid;
                    if (parsed.version === 1 && parsed.tags) {
                        // New combined format
                        importedTags = parsed.tags;
                        importedGrid = parsed.grid || {};
                    } else {
                        // Old format — plain tag object, no grid data
                        importedTags = parsed;
                        importedGrid = {};
                    }

                    showImportDialog(importedTags, importedGrid);
                };
                reader.readAsText(e.target.files[0]);
            };
            fileInput.click();
        };

        // Debounced search — waits 200ms after the user stops typing before rendering.
        // Prevents a full DOM rebuild on every single keystroke with a large library.
        let _searchDebounce = null;
        searchInput = manager.querySelector('.filter-input');
        searchInput.oninput = (e) => {
            clearTimeout(_searchDebounce);
            _searchDebounce = setTimeout(() => renderAllSearch(e.target.value), 200);
        };
    }

    // Inline import dialog — handles both tags and grid data
    function showImportDialog(importedTags, importedGrid) {
        if (document.getElementById('x-import-dialog')) return;

        const importTagCount  = Object.keys(importedTags).length;
        const importGridCount = Object.keys(importedGrid).length;
        const existingCount   = Object.keys(getAllTags()).length;
        const gridNote = importGridCount > 0
            ? `<br>Includes <strong style="color:#eee;">${importGridCount}</strong> eicon grid positions.`
            : '<br><em style="color:#555;">No grid data in this file.</em>';

        const dialog = document.createElement('div');
        dialog.id = 'x-import-dialog';
        dialog.style.cssText = `position:fixed; inset:0; background:rgba(0,0,0,0.85); z-index:1000002; display:flex; align-items:center; justify-content:center;`;
        dialog.innerHTML = `
            <div style="background:#1a1a1a; border:2px solid gold; border-radius:8px; width:90%; max-width:400px; padding:20px; color:#eee; font-family:sans-serif;">
                <div style="color:gold; font-weight:bold; margin-bottom:12px;">📥 Import Tags</div>
                <div style="font-size:13px; color:#aaa; margin-bottom:16px; line-height:1.6;">
                    Importing <strong style="color:#eee;">${importTagCount}</strong> tagged eicons.${gridNote}<br>
                    You currently have <strong style="color:#eee;">${existingCount}</strong> eicons tagged.<br><br>
                    <strong style="color:gold;">Merge</strong> — combine tags for shared eicons, add new ones.<br>
                    <strong style="color:#ff6b6b;">Replace</strong> — discard all existing data entirely.
                </div>
                <div style="display:flex; justify-content:flex-end; gap:10px;">
                    <button id="x-import-cancel"  style="background:#444; color:white; border:none; padding:8px 15px; cursor:pointer; border-radius:4px;">Cancel</button>
                    <button id="x-import-replace" style="background:#c0392b; color:white; border:none; padding:8px 15px; cursor:pointer; border-radius:4px; font-weight:bold;">Replace</button>
                    <button id="x-import-merge"   style="background:gold; color:black; border:none; padding:8px 15px; cursor:pointer; border-radius:4px; font-weight:bold;">Merge</button>
                </div>
            </div>`;

        document.body.appendChild(dialog);

        dialog.querySelector('#x-import-cancel').onclick = () => dialog.remove();

        dialog.querySelector('#x-import-replace').onclick = () => {
            saveFullLibrary(importedTags);
            saveAllGridData(importedGrid);
            dialog.remove();
            location.reload();
        };

        dialog.querySelector('#x-import-merge').onclick = () => {
            saveFullLibrary(mergeLibraries(getAllTags(), importedTags));
            // Grid merge: imported positions fill in gaps; existing positions win on conflict
            const mergedGrid = { ...importedGrid, ...getAllGridData() };
            saveAllGridData(mergedGrid);
            dialog.remove();
            location.reload();
        };
    }



    // --- 8. TAG MODE ENGINE ---
    // x-eiconview lives inside shadow roots, so page CSS cannot reach it.
    // We apply dimming via inline styles and wire hover with JS listeners.

    function getIconNameFromElement(el) {
        const shadow = el.shadowRoot;
        if (!shadow) return null;
        const rootDiv = shadow.querySelector('.root');
        return rootDiv ? rootDiv.getAttribute('data-tooltip') : null;
    }

    function applyTagMode() {
        const lib = getAllTags();
        findDeep(document, 'x-eiconview').forEach(el => {
            const name = getIconNameFromElement(el);
            const shouldDim = tagModeActive && !!(name && lib[name]);

            if (shouldDim && !el._xTagDimmed) {
                // First time dimming this element — set styles and attach hover handlers
                el._xTagDimmed = true;
                el.style.opacity    = '0.28';
                el.style.outline    = '1px solid rgba(255, 215, 0, 0.35)';
                el.style.transition = 'opacity 0.2s';
                el._xTagHoverIn  = () => { el.style.opacity = '1'; };
                el._xTagHoverOut = () => { el.style.opacity = '0.28'; };
                el.addEventListener('mouseenter', el._xTagHoverIn);
                el.addEventListener('mouseleave', el._xTagHoverOut);

            } else if (!shouldDim && el._xTagDimmed) {
                // Restore element
                el._xTagDimmed = false;
                el.style.opacity    = '';
                el.style.outline    = '';
                el.style.transition = '';
                if (el._xTagHoverIn)  el.removeEventListener('mouseenter', el._xTagHoverIn);
                if (el._xTagHoverOut) el.removeEventListener('mouseleave', el._xTagHoverOut);
                el._xTagHoverIn  = null;
                el._xTagHoverOut = null;
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

        // stopPropagation() called from inside a shadow root prevents the event from
        // crossing the shadow boundary — the site's click/copy handler on x-eiconview
        // (in the outer shadow context) never fires. No capture listener needed.
        btn.onclick = (e) => { e.stopPropagation(); openTagModal(iconName); };

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
    // initExplorer and initTooltipPatch only need to run until they succeed once.
    // processIcon is guarded by a WeakSet — O(1) lookup per element vs querying
    // the shadow DOM every tick. The interval is kept (rather than replaced with
    // MutationObserver) because the virtual scroll creates eicons dynamically and
    // Xariah's internal component lifecycle timing is not observable from outside.

    const _processedIcons = new WeakSet();
    let _explorerReady    = false;
    let _tooltipReady     = false;

    const _processIcon_guarded = (el) => {
        if (_processedIcons.has(el)) return;
        // Only add to the WeakSet after successful injection
        const shadow = el.shadowRoot;
        if (!shadow || !shadow.querySelector('.root')) return;
        processIcon(el);
        _processedIcons.add(el);
    };

    setInterval(() => {
        if (!_explorerReady) {
            initExplorer();
            if (document.getElementById('x-tag-manager')) _explorerReady = true;
        }
        if (!_tooltipReady) {
            initTooltipPatch();
            if (window._xTooltipHandlerBound) _tooltipReady = true;
        }
        findDeep(document, 'x-eiconview').forEach(_processIcon_guarded);
        if (tagModeActive) applyTagMode();
    }, 1000);

})();
