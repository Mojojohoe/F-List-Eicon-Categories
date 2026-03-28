// ==UserScript==
// @name         Xariah Tagger
// @version      0.0.19
// @description  Alpha version of the tagging & search system for xariah eicon database
// @match        *://xariah.net/*
// @updateURL    https://mojojohoe.github.io/F-List-Eicon-Categories/script.js
// @downloadURL  https://mojojohoe.github.io/F-List-Eicon-Categories/script.js
// @grant        none
// @run-at       document-start
// @author       Jobix
// ==/UserScript==

(function() {
    'use strict';

    const SCRIPT_VERSION = '0.0.19';

    // URL of the developer-maintained tag library on GitHub Pages.
    // Update this file in the repo to push new tags to all users.
    // Users can only ever pull from this URL — they cannot push back.
    const DEV_TAGS_URL = 'https://mojojohoe.github.io/F-List-Eicon-Categories/dev_tags.txt';

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

    let _synonymCache = null;  // Array<{ master: string, slaves: string[] }>

    const getAllSynonyms = () => {
        if (_synonymCache === null) _synonymCache = JSON.parse(localStorage.getItem('x_synonyms') || '[]');
        return _synonymCache;
    };

    const saveSynonyms = (rules) => {
        _synonymCache = rules;
        localStorage.setItem('x_synonyms', JSON.stringify(rules));
    };

    // Returns a Map<slave, master> for fast lookup during search expansion.
    // Also usable as Map<master, master> so searching the master itself still expands.
    let _synonymMap = null; // Map<term, Set<relatedTerms>> — rebuilt when synonyms change
    const getSynonymMap = () => {
        if (_synonymMap === null) {
            _synonymMap = new Map();
            getAllSynonyms().forEach(({ master, slaves }) => {
                // Every term (master and each slave) maps to the full group
                const group = new Set([master, ...slaves]);
                group.forEach(term => {
                    if (!_synonymMap.has(term)) _synonymMap.set(term, new Set());
                    group.forEach(related => { if (related !== term) _synonymMap.get(term).add(related); });
                });
            });
        }
        return _synonymMap;
    };

    const invalidateSynonymMap = () => { _synonymMap = null; };

    // Expands a single keyword to include all synonym-related terms.
    const expandKeyword = (kw) => {
        const map = getSynonymMap();
        const related = map.get(kw);
        return related ? [kw, ...related] : [kw];
    };

    // --- DUPLICATE STORAGE ---
    // Schema: string[][] — each inner array is a group of eicon names that are duplicates.
    // Only one representative per group appears in search results.
    let _dupCache = null;

    const getAllDuplicates = () => {
        if (_dupCache === null) _dupCache = JSON.parse(localStorage.getItem('x_duplicates') || '[]');
        return _dupCache;
    };

    const saveAllDuplicates = (groups) => {
        _dupCache = groups;
        localStorage.setItem('x_duplicates', JSON.stringify(groups));
    };

    // Returns { groupIdx, group } for the group containing this eicon, or null.
    const getEiconDuplicateGroup = (name) => {
        const groups = getAllDuplicates();
        for (let i = 0; i < groups.length; i++) {
            if (groups[i].includes(name)) return { groupIdx: i, group: groups[i] };
        }
        return null;
    };

    // Merges selected names into one duplicate group. If any name is already in a group,
    // all those groups are merged together with the new names.
    const addDuplicateGroup = (names) => {
        const groups = getAllDuplicates();
        const merged = new Set(names.map(n => n.toLowerCase()));
        const keepGroups = [];
        groups.forEach(g => {
            if (g.some(n => merged.has(n))) { g.forEach(n => merged.add(n)); }
            else keepGroups.push(g);
        });
        keepGroups.push([...merged].sort());
        saveAllDuplicates(keepGroups);
    };

    const removeDuplicateGroup = (idx) => {
        const groups = getAllDuplicates();
        groups.splice(idx, 1);
        saveAllDuplicates(groups);
    };

    // Builds a Set of eicons that should be SKIPPED in search results because a
    // better-ranked representative from their duplicate group is already included.
    // Representative = first alphabetically among group members that exist in the lib.
    const buildDupSkipSet = (lib) => {
        const skip = new Set();
        getAllDuplicates().forEach(group => {
            const inLib = group.filter(n => lib[n]).sort();
            if (inLib.length > 1) inLib.slice(1).forEach(n => skip.add(n));
        });
        return skip;
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
        #x-tag-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.85); z-index: 2000001; display: none; align-items: center; justify-content: center; }

        /* Batch Selection floating bar */
        #x-selection-bar {
            position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
            z-index: 1000000; display: none;
            background: #1a1a1a; border: 2px solid gold;
            border-radius: 100px; padding: 10px 20px 10px 16px;
            box-shadow: 0 4px 24px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,215,0,0.15);
            align-items: center; gap: 14px; white-space: nowrap;
            font-family: sans-serif;
        }
        #x-selection-bar.visible { display: flex; }
        #x-selection-count { color: gold; font-size: 13px; font-weight: bold; }
        #x-selection-tag-btn {
            background: gold; color: #000; border: none; border-radius: 100px;
            padding: 8px 18px; font-size: 13px; font-weight: bold;
            cursor: pointer; display: flex; align-items: center; gap: 6px;
            transition: background 0.15s;
        }
        #x-selection-tag-btn:hover { background: #ffe066; }
        #x-selection-clear-btn {
            background: none; border: 1px solid #555; color: #888;
            border-radius: 100px; padding: 6px 12px; font-size: 12px;
            cursor: pointer; transition: border-color 0.15s, color 0.15s;
        }
        #x-selection-clear-btn:hover { border-color: #e74c3c; color: #e74c3c; }

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
        .chip.grey { background: #555; color: #ccc; cursor: pointer; border: 1px solid #777; }

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
        /* Dev Tools tabs */
        #x-devtools-tabs { display: flex; gap: 2px; padding: 0 16px; background: #111; border-bottom: 1px solid #222; flex-shrink: 0; }
        .dt-tab {
            padding: 8px 18px; font-size: 13px; cursor: pointer; color: #666;
            border-bottom: 2px solid transparent; transition: color 0.15s, border-color 0.15s;
            user-select: none;
        }
        .dt-tab:hover { color: #aaa; }
        .dt-tab.active { color: gold; border-bottom-color: gold; }
        .dt-tab-panel { display: none; flex: 1; overflow: hidden; }
        .dt-tab-panel.active { display: flex; }

        /* Synonyms panel */
        #x-syn-panel { flex-direction: column; overflow-y: auto; padding: 20px; gap: 16px; width: 100%; }
        #x-syn-form { background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 18px; display: flex; flex-direction: column; gap: 12px; flex-shrink: 0; }
        #x-syn-form h3 { margin: 0; font-size: 14px; color: gold; }
        .syn-row { display: flex; align-items: center; gap: 10px; }
        .syn-label { font-size: 12px; color: #666; text-transform: uppercase; letter-spacing: 1px; width: 60px; flex-shrink: 0; }
        .syn-input { flex: 1; background: #000; border: 1px solid #444; border-radius: 4px; padding: 8px 12px; color: #eee; font-size: 13px; outline: none; }
        .syn-input:focus { border-color: gold; }
        .syn-chips { display: flex; flex-wrap: wrap; gap: 6px; min-height: 28px; }
        #x-syn-clean-row { display: flex; align-items: center; gap: 10px; }
        #x-syn-clean-cb { width: 16px; height: 16px; cursor: pointer; accent-color: #e74c3c; }
        #x-syn-clean-label { font-size: 13px; color: #aaa; cursor: pointer; }
        #x-syn-add-btn {
            background: gold; color: #000; border: none; border-radius: 4px;
            padding: 8px 20px; font-size: 13px; font-weight: bold; cursor: pointer;
        }
        #x-syn-add-btn:hover { background: #ffe066; }
        #x-syn-add-btn:disabled { background: #444; color: #666; cursor: not-allowed; }
        #x-syn-panel { flex-direction: column; overflow-y: auto; padding: 20px; gap: 16px; width: 100%; }
        #x-syn-form { background: #1a1a1a; border: 1px solid #333; border-radius: 8px; padding: 18px; display: flex; flex-direction: column; gap: 12px; flex-shrink: 0; max-width: 860px; }
        #x-syn-list { display: flex; flex-direction: column; gap: 8px; max-width: 860px; }
        #x-syn-list h3 { margin: 0 0 4px; font-size: 14px; color: #aaa; }
        .syn-rule {
            background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 6px;
            padding: 12px 14px; display: flex; align-items: flex-start; gap: 12px;
        }
        .syn-rule-body { flex: 1; min-width: 0; }
        .syn-master { font-size: 13px; font-weight: bold; color: gold; margin-bottom: 6px; }
        .syn-slaves { display: flex; flex-wrap: wrap; gap: 5px; }
        .syn-slave-chip { background: #2a2a2a; color: #aaa; border-radius: 100px; padding: 2px 10px; font-size: 11px; }
        .syn-delete-btn {
            background: none; border: 1px solid #333; color: #555; border-radius: 4px;
            padding: 4px 10px; font-size: 12px; cursor: pointer; flex-shrink: 0;
            transition: border-color 0.15s, color 0.15s;
        }
        .syn-delete-btn:hover { border-color: #e74c3c; color: #e74c3c; }
        #x-dup-list { max-width: 860px; }

        /* Dev Tools */
        #x-devtools-overlay {
            position: fixed; inset: 0; background: rgba(0,0,0,0.92);
            z-index: 2000000; display: none; align-items: center; justify-content: center;
        }
        #x-devtools-overlay.open { display: flex; }
        #x-devtools-panel {
            width: 95vw; height: 90vh; background: #111; border: 2px solid #333;
            border-radius: 10px; display: flex; flex-direction: column; overflow: hidden;
        }
        #x-devtools-header {
            display: flex; align-items: center; justify-content: space-between;
            padding: 10px 16px; background: #1a1a1a; border-bottom: 2px solid gold;
            flex-shrink: 0;
        }
        #x-devtools-header h2 { margin: 0; font-size: 15px; color: gold; }
        #x-devtools-header-right { display: flex; align-items: center; gap: 10px; }
        #x-devtools-search {
            background: #000; border: 1px solid #444; border-radius: 4px;
            padding: 5px 10px; color: gold; font-size: 13px; outline: none; width: 200px;
        }
        #x-devtools-close {
            background: #333; border: 1px solid #555; color: #ccc; border-radius: 4px;
            padding: 4px 12px; cursor: pointer; font-size: 13px;
        }
        #x-devtools-close:hover { background: #c0392b; color: white; border-color: #c0392b; }
        #x-devtools-body { display: flex; flex: 1; overflow: hidden; }
        #x-devtools-left {
            flex: 1; overflow-y: auto; padding: 12px;
            display: grid;
            grid-template-columns: repeat(auto-fill, 85px);
            grid-auto-rows: 85px;
            grid-auto-flow: row dense;
            gap: 4px;
            align-content: start;
        }
        #x-devtools-left .empty-state {
            grid-column: 1 / -1; color: #444; font-size: 14px;
            display: flex; align-items: center; justify-content: center;
            height: 200px; font-style: italic;
        }
        #x-devtools-right {
            width: 240px; flex-shrink: 0; overflow-y: auto;
            border-left: 1px solid #222; background: #0e0e0e;
        }
        #x-devtools-right-header {
            padding: 10px 14px; font-size: 10px; color: #555; letter-spacing: 2px;
            text-transform: uppercase; border-bottom: 1px solid #1a1a1a;
            position: sticky; top: 0; background: #0e0e0e; z-index: 1;
        }
        .dt-tag-row {
            display: flex; align-items: center; justify-content: space-between;
            padding: 7px 14px; cursor: pointer; border-bottom: 1px solid #141414;
            transition: background 0.1s;
        }
        .dt-tag-row:hover { background: #1a1a1a; }
        .dt-tag-row.active { background: #1f1a00; border-left: 3px solid gold; padding-left: 11px; }
        .dt-tag-name { font-size: 13px; color: #ccc; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .dt-tag-row.active .dt-tag-name { color: gold; }
        .dt-tag-count {
            font-size: 11px; color: #555; font-family: monospace;
            background: #1a1a1a; border-radius: 10px; padding: 1px 7px; flex-shrink: 0; margin-left: 6px;
        }
        .dt-tag-row.active .dt-tag-count { background: #2a2200; color: #aa8800; }
        /* Ghost eicons in dev tools get a gold outline when selected */
        .ghost-eicon.dt-selected { outline: 2px solid gold; box-shadow: 0 0 8px rgba(255,215,0,0.4); }
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

    // --- BATCH SELECTION STATE ---
    // Tracks selected eicon names as strings — stable across virtual scroll recycling.
    const selectedIconNames = new Set();

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
        // Most common: trailing digits e.g. square1, square12, abc1
        // .{2,}? + [^0-9] = minimum 3 chars total before the digits,
        // which correctly handles 3-char bases like "abc" in "abc1".
        let m = n.match(/^(.{2,}?[^0-9])(\d{1,3})$/);
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

    // Renders the left chip slot in the tag modal.
    // For a single eicon: shows a grey && chip if it's in a duplicate group.
    // For batch mode: shows a grey && chip if the selected eicons are already in a group together.
    // name = eicon name (single) or '' (batch).
    function renderLeftChipSlot(name) {
        const slot = document.getElementById('x-left-chip-slot');
        if (!slot) return;
        slot.innerHTML = '';

        let inGroup = false;
        let groupIdx = -1;
        if (name) {
            const result = getEiconDuplicateGroup(name);
            if (result) { inGroup = true; groupIdx = result.groupIdx; }
        } else {
            // Batch: check if ALL selected eicons are in the same group
            const names = [...selectedIconNames];
            if (names.length >= 2) {
                const first = getEiconDuplicateGroup(names[0]);
                if (first && names.every(n => first.group.includes(n))) {
                    inGroup = true;
                    groupIdx = first.groupIdx;
                }
            }
        }

        if (!inGroup) return;

        const chip = document.createElement('div');
        chip.className = 'chip grey';
        chip.title = 'This eicon is in a duplicate group — click to manage';
        chip.textContent = '&&';
        chip.onclick = () => {
            const overlay = document.getElementById('x-tag-modal-overlay');
            if (overlay) overlay.style.display = 'none';
            openDevTools('duplicates');
            // After tab renders, expand and scroll to the correct group
            setTimeout(() => scrollToDuplicateGroup(groupIdx), 80);
        };
        slot.appendChild(chip);
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
                        <div id="x-left-chip-slot"></div>
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

                    // && — duplicate group tag. Only valid in batch mode with 2+ eicons selected.
                    if (v === '&&') {
                        if (!currentIconName && selectedIconNames.size >= 2) {
                            addDuplicateGroup([...selectedIconNames]);
                            input.value = '';
                            renderLeftChipSlot('');
                        }
                        return;
                    }

                    // Check for grid tag format #NxM
                    const parsed = parseGridTag(v);
                    if (parsed) {
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
                // If currentIconName is empty we're in batch mode (set by openBatchModal).
                // Otherwise we're saving a single eicon.
                if (!currentIconName) {
                    // --- BATCH SAVE ---
                    const names = [...selectedIconNames];
                    const lib = getAllTags();
                    names.forEach(name => {
                        const existingRaw = lib[name] || '';
                        const existingSet = new Set(existingRaw.split(',').map(t => t.trim().toLowerCase()).filter(Boolean));
                        activeTags.forEach(t => existingSet.add(t));
                        if (existingSet.size > 0) lib[name] = [...existingSet].join(', ');
                    });
                    saveFullLibrary(lib);
                    activeTags.forEach(saveRecentTag);
                    lastSavedEntry = { tags: [...activeTags], gridSpec: null };
                    overlay.style.display = 'none';
                    clearSelection();
                    if (searchInput) renderAllSearch(searchInput.value);
                    if (tagModeActive) applyTagMode();
                } else {
                    // --- SINGLE EICON SAVE ---
                    const lib = getAllTags();
                    if (activeTags.length) {
                        lib[currentIconName] = activeTags.join(', ');
                        activeTags.forEach(saveRecentTag);
                    } else {
                        delete lib[currentIconName];
                    }
                    saveFullLibrary(lib);
                    lastSavedEntry = {
                        tags: [...activeTags],
                        gridSpec: activeGridSpec ? activeGridSpec.raw : null
                    };
                    saveIconGrid(currentIconName, activeGridSpec ? activeGridSpec.raw : null, activeGridPos);
                    overlay.style.display = 'none';
                    if (searchInput) renderAllSearch(searchInput.value);
                    if (tagModeActive) applyTagMode();
                }
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
        renderLeftChipSlot(name);
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
                cell.dataset.tooltip = eiconName;
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
        ghost.className = 'ghost-eicon' + (selectedIconNames.has(name) ? ' dt-selected' : '');
        // data-tooltip enables our custom tooltip system on hover
        ghost.dataset.tooltip = name;
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

        ghost.addEventListener('click', (e) => {
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                e.stopPropagation();
                if (selectedIconNames.has(name)) {
                    selectedIconNames.delete(name);
                    ghost.classList.remove('dt-selected');
                } else {
                    selectedIconNames.add(name);
                    ghost.classList.add('dt-selected');
                }
                updateSelectionBar();
                return;
            }
            navigator.clipboard.writeText(`[eicon]${name}[/eicon]`);
            flashCopied(ghost);
        });

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

        // Expand each positive keyword through the synonym map.
        // Each keyword becomes a group of terms (itself + synonyms/masters).
        // An eicon is scored against the best-matching term in each group.
        const expandedKwGroups = positiveKws.map(kw => expandKeyword(kw));

        const lib = getAllTags();

        // Build the duplicate skip set — non-representative members of duplicate groups
        // are excluded from results so each group appears at most once per section.
        const dupSkipSet = buildDupSkipSet(lib);

        // Tiered match score for a single keyword against a single tag string.
        // Tiers are separated by 4 so no accumulation of lower tiers can outrank a higher one
        // for a single keyword, while multiple-keyword scores still stack correctly.
        //   4 = exact match          ("bar" === "bar")
        //   3 = tag starts with kw   ("bar chart" starts with "bar")
        //   2 = kw is a whole word   ("dive bar" contains word "bar")
        //   1 = kw is a substring    ("embarrassed" contains "bar")
        //   0 = no match
        const _wordBoundary = {};
        const kwTierScore = (kw, tag) => {
            if (tag === kw)              return 4;
            if (tag.startsWith(kw))     return 3;
            // Cache compiled RegExp per keyword for performance across many tags
            if (!_wordBoundary[kw]) _wordBoundary[kw] = new RegExp(`(?<![a-z])${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z])`);
            if (_wordBoundary[kw].test(tag)) return 2;
            if (tag.includes(kw))        return 1;
            return 0;
        };

        // Returns true if an eicon's tags contain any negative keyword (unchanged — negatives
        // use substring matching because they are exclusions, not ranking criteria)
        const isExcluded = (tagStr) => {
            if (negativeKws.length === 0) return false;
            const iconTags = tagStr.toLowerCase().split(',').map(t => t.trim());
            return negativeKws.some(nkw => iconTags.some(tag => tag.includes(nkw)));
        };

        // Score each eicon by summing the best tier score each keyword group achieves.
        // For each group, the best tier across all terms in the group AND all tags is used.
        const scored = [];
        for (const [name, tagStr] of Object.entries(lib)) {
            if (isExcluded(tagStr)) continue;
            if (dupSkipSet.has(name)) continue;
            const iconTags = tagStr.toLowerCase().split(',').map(t => t.trim());
            let score = 0;
            let anyMatch = false;
            expandedKwGroups.forEach(kwGroup => {
                // Best tier this keyword group achieves across all its terms and all eicon tags
                let best = 0;
                kwGroup.forEach(kw => {
                    iconTags.forEach(tag => {
                        const s = kwTierScore(kw, tag);
                        if (s > best) best = s;
                    });
                });
                if (best > 0) { score += best; anyMatch = true; }
            });
            if (anyMatch) scored.push({ name, score });
        }

        if (scored.length > 0) {
            bestContainer.style.display = 'block';
            const bestRendered = new Set();
            scored.sort((a, b) => b.score - a.score).slice(0, 30).forEach(res => {
                const el = renderEiconOrComposite(res.name, bestRendered);
                if (el) bestAnchor.appendChild(el);
            });
        }

        // Build tag sections: a tag qualifies if ANY term in ANY keyword group matches it.
        const tagMap   = {};
        const tagScore = {};
        for (const [eicon, tagString] of Object.entries(lib)) {
            if (isExcluded(tagString)) continue;
            if (dupSkipSet.has(eicon)) continue;
            tagString.split(',').forEach(t => {
                const tag = t.trim().toLowerCase();
                let best = 0;
                expandedKwGroups.forEach(kwGroup => {
                    kwGroup.forEach(kw => {
                        const s = kwTierScore(kw, tag);
                        if (s > best) best = s;
                    });
                });
                if (best > 0) {
                    if (!tagMap[tag]) { tagMap[tag] = []; tagScore[tag] = 0; }
                    tagMap[tag].push(eicon);
                    if (best > tagScore[tag]) tagScore[tag] = best;
                }
            });
        }

        // Sort sections: first by tier (descending), then alphabetically within each tier
        Object.keys(tagMap)
            .sort((a, b) => (tagScore[b] - tagScore[a]) || a.localeCompare(b))
            .forEach(tag => {
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



    // --- 7. DEV TOOLS ---

    let _devToolsActiveTag = null; // currently selected tag in the right panel

    function openDevTools(startTab) {
        let overlay = document.getElementById('x-devtools-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'x-devtools-overlay';
            overlay.innerHTML = `
                <div id="x-devtools-panel">
                    <div id="x-devtools-header">
                        <h2>🛠️ Dev Tools</h2>
                        <div id="x-devtools-header-right">
                            <input id="x-devtools-search" type="text" placeholder="Filter tags…" autocomplete="off">
                            <button id="x-devtools-close">✕ Close</button>
                        </div>
                    </div>
                    <div id="x-devtools-tabs">
                        <div class="dt-tab active" data-tab="browser">📂 Tag Browser</div>
                        <div class="dt-tab" data-tab="synonyms">🔗 Synonyms</div>
                        <div class="dt-tab" data-tab="duplicates">🔁 Duplicates</div>
                    </div>
                    <div id="x-dt-browser" class="dt-tab-panel active">
                        <div id="x-devtools-left">
                            <div class="empty-state">← Select a tag to browse its eicons</div>
                        </div>
                        <div id="x-devtools-right">
                            <div id="x-devtools-right-header">Tags — click to browse</div>
                        </div>
                    </div>
                    <div id="x-dt-synonyms" class="dt-tab-panel">
                        <div id="x-syn-panel">
                            <div id="x-syn-form">
                                <h3>🔗 Add Synonym Rule</h3>
                                <div class="syn-row">
                                    <span class="syn-label">Master</span>
                                    <input class="syn-input" id="x-syn-master" placeholder="Canonical tag (e.g. happy)" autocomplete="off">
                                </div>
                                <div class="syn-row" style="align-items:flex-start;">
                                    <span class="syn-label" style="margin-top:8px;">Slaves</span>
                                    <div style="flex:1; display:flex; flex-direction:column; gap:8px;">
                                        <div class="syn-chips" id="x-syn-slave-chips"></div>
                                        <input class="syn-input" id="x-syn-slave-input" placeholder="Type a slave tag and press Enter or ," autocomplete="off">
                                    </div>
                                </div>
                                <div id="x-syn-clean-row">
                                    <input type="checkbox" id="x-syn-clean-cb">
                                    <label id="x-syn-clean-label" for="x-syn-clean-cb">
                                        Clean database — replace all slave tags with master across entire library
                                    </label>
                                </div>
                                <div>
                                    <button id="x-syn-add-btn" disabled>Add Synonym Rule</button>
                                </div>
                            </div>
                            <div id="x-syn-list">
                                <h3>Active Synonym Rules</h3>
                                <div id="x-syn-rules-container"></div>
                            </div>
                        </div>
                    </div>
                    <div id="x-dt-duplicates" class="dt-tab-panel">
                        <div id="x-dup-panel" style="flex-direction:column; overflow-y:auto; padding:20px; gap:12px; display:flex;">
                            <div style="background:#1a1a1a; border:1px solid #333; border-radius:8px; padding:14px 18px; flex-shrink:0;">
                                <div style="color:gold; font-weight:bold; margin-bottom:6px; font-size:14px;">🔁 Duplicate Groups</div>
                                <p style="font-size:13px; color:#666; margin:0;">
                                    Eicons in the same group share identical artwork. Only one appears per search result section.
                                    Type <strong style="color:#ccc;">&amp;&amp;</strong> in the batch tag modal (with 2+ eicons selected) to create a group.
                                </p>
                            </div>
                            <div id="x-dup-list"></div>
                        </div>
                    </div>
                </div>`;
            document.body.appendChild(overlay);

            overlay.querySelector('#x-devtools-close').onclick = () => closeDevTools();
            overlay.addEventListener('click', (e) => { if (e.target === overlay) closeDevTools(); });
            overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDevTools(); });

            // Tab switching
            overlay.querySelectorAll('.dt-tab').forEach(tab => {
                tab.onclick = () => {
                    switchDevTab(tab.dataset.tab);
                };
            });

            // Tag browser search
            const dtSearch = overlay.querySelector('#x-devtools-search');
            let _dtDebounce = null;
            dtSearch.oninput = (e) => {
                clearTimeout(_dtDebounce);
                _dtDebounce = setTimeout(() => renderDevToolsTagList(e.target.value.toLowerCase().trim()), 150);
            };

            // Synonym form — slave chips
            const slaveInput = overlay.querySelector('#x-syn-slave-input');
            const slaveChipsEl = overlay.querySelector('#x-syn-slave-chips');
            const masterInput = overlay.querySelector('#x-syn-master');
            const addBtn = overlay.querySelector('#x-syn-add-btn');
            let _synSlaves = [];

            const refreshAddBtn = () => {
                addBtn.disabled = !(masterInput.value.trim() && _synSlaves.length > 0);
            };

            const renderSlaveChips = () => {
                slaveChipsEl.innerHTML = '';
                _synSlaves.forEach(slave => {
                    const chip = document.createElement('div');
                    chip.className = 'chip red';
                    chip.innerHTML = `${slave} <span style="cursor:pointer">×</span>`;
                    chip.querySelector('span').onclick = () => {
                        _synSlaves = _synSlaves.filter(s => s !== slave);
                        renderSlaveChips(); refreshAddBtn();
                    };
                    slaveChipsEl.appendChild(chip);
                });
            };

            masterInput.oninput = refreshAddBtn;

            slaveInput.onkeydown = (e) => {
                if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault();
                    const v = slaveInput.value.trim().replace(/,/g, '').toLowerCase();
                    if (v && !_synSlaves.includes(v)) {
                        _synSlaves.push(v);
                        renderSlaveChips(); refreshAddBtn();
                    }
                    slaveInput.value = '';
                }
            };

            addBtn.onclick = () => {
                const master = masterInput.value.trim().toLowerCase();
                if (!master || _synSlaves.length === 0) return;
                const doClean = overlay.querySelector('#x-syn-clean-cb').checked;
                if (doClean) {
                    showSynonymCleanConfirm(master, [..._synSlaves], () => {
                        commitSynonymRule(master, [..._synSlaves], true);
                        masterInput.value = ''; _synSlaves = []; renderSlaveChips(); refreshAddBtn();
                        overlay.querySelector('#x-syn-clean-cb').checked = false;
                        renderSynonymRules();
                    });
                } else {
                    commitSynonymRule(master, [..._synSlaves], false);
                    masterInput.value = ''; _synSlaves = []; renderSlaveChips(); refreshAddBtn();
                    renderSynonymRules();
                }
            };
        }

        _devToolsActiveTag = null;
        overlay.classList.add('open');
        switchDevTab(startTab || 'browser');
        if (!startTab || startTab === 'browser') {
            overlay.querySelector('#x-devtools-search').value = '';
            overlay.querySelector('#x-devtools-search').focus();
        }
    }

    function switchDevTab(tabName) {
        const overlay = document.getElementById('x-devtools-overlay');
        if (!overlay) return;
        const panelMap = { browser: 'x-dt-browser', synonyms: 'x-dt-synonyms', duplicates: 'x-dt-duplicates' };
        overlay.querySelectorAll('.dt-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
        overlay.querySelectorAll('.dt-tab-panel').forEach(p => p.classList.remove('active'));
        const panelEl = overlay.querySelector('#' + (panelMap[tabName] || 'x-dt-browser'));
        if (panelEl) panelEl.classList.add('active');
        overlay.querySelector('#x-devtools-search').style.display = tabName === 'browser' ? '' : 'none';
        if (tabName === 'synonyms') renderSynonymRules();
        if (tabName === 'duplicates') renderDuplicatesList();
        if (tabName === 'browser') renderDevToolsTagList('');
    }

    function closeDevTools() {
        const overlay = document.getElementById('x-devtools-overlay');
        if (overlay) overlay.classList.remove('open');
        _devToolsActiveTag = null;
    }

    // Commits a synonym rule — merges with any existing rule for this master.
    // If clean=true, also rewrites the tag library replacing slaves with master.
    function commitSynonymRule(master, slaves, clean) {
        const rules = getAllSynonyms();
        const existing = rules.find(r => r.master === master);
        if (existing) {
            slaves.forEach(s => { if (!existing.slaves.includes(s)) existing.slaves.push(s); });
        } else {
            rules.push({ master, slaves });
        }
        saveSynonyms(rules);
        invalidateSynonymMap();
        if (clean) performSynonymClean(master, slaves);
    }

    // Dry-run: returns { eiconCount, tagCount } showing what clean would affect.
    function synonymCleanDryRun(master, slaves) {
        const lib = getAllTags();
        const slaveSet = new Set(slaves);
        let eiconCount = 0;
        let tagCount = 0;
        for (const tagStr of Object.values(lib)) {
            const tags = tagStr.split(',').map(t => t.trim().toLowerCase());
            const slavesPresent = tags.filter(t => slaveSet.has(t));
            if (slavesPresent.length > 0) {
                eiconCount++;
                tagCount += slavesPresent.length;
            }
        }
        return { eiconCount, tagCount };
    }

    // Performs the actual database clean — replaces slave tags with master across all eicons.
    function performSynonymClean(master, slaves) {
        const lib = getAllTags();
        const slaveSet = new Set(slaves);
        for (const [eicon, tagStr] of Object.entries(lib)) {
            const tags = tagStr.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
            const hasSlaves = tags.some(t => slaveSet.has(t));
            if (!hasSlaves) continue;
            const cleaned = tags.filter(t => !slaveSet.has(t));
            if (!cleaned.includes(master)) cleaned.push(master);
            lib[eicon] = cleaned.join(', ');
        }
        saveFullLibrary(lib);
    }

    // Shows a confirmation dialog before performing a clean operation.
    function showSynonymCleanConfirm(master, slaves, onConfirm) {
        const { eiconCount, tagCount } = synonymCleanDryRun(master, slaves);
        const dialog = document.createElement('div');
        dialog.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:2100000;display:flex;align-items:center;justify-content:center;`;
        dialog.innerHTML = `
            <div style="background:#1a1a1a;border:2px solid #e74c3c;border-radius:8px;width:90%;max-width:420px;padding:22px;color:#eee;font-family:sans-serif;">
                <div style="color:#e74c3c;font-weight:bold;margin-bottom:12px;font-size:14px;">⚠️ Clean Database</div>
                <div style="font-size:13px;color:#aaa;margin-bottom:18px;line-height:1.8;">
                    This will replace <strong style="color:#e74c3c;">${tagCount} slave tag instance${tagCount===1?'':'s'}</strong>
                    across <strong style="color:#e74c3c;">${eiconCount} eicon${eiconCount===1?'':'s'}</strong>
                    with the master tag <strong style="color:gold;">${master}</strong>.<br><br>
                    Slave tags: ${slaves.map(s=>`<span style="background:#2a2a2a;padding:1px 8px;border-radius:10px;font-size:11px;">${s}</span>`).join(' ')}<br><br>
                    <strong style="color:#eee;">This cannot be undone without an export backup.</strong>
                </div>
                <div style="display:flex;justify-content:flex-end;gap:10px;">
                    <button id="syn-conf-cancel" style="background:#444;color:white;border:none;padding:8px 15px;cursor:pointer;border-radius:4px;">Cancel</button>
                    <button id="syn-conf-ok" style="background:#e74c3c;color:white;border:none;padding:8px 15px;cursor:pointer;border-radius:4px;font-weight:bold;">Clean & Save</button>
                </div>
            </div>`;
        document.body.appendChild(dialog);
        dialog.querySelector('#syn-conf-cancel').onclick = () => dialog.remove();
        dialog.querySelector('#syn-conf-ok').onclick = () => { dialog.remove(); onConfirm(); };
    }

    // Renders the active synonym rules list in the synonyms tab.
    function renderSynonymRules() {
        const container = document.getElementById('x-syn-rules-container');
        if (!container) return;
        container.innerHTML = '';
        const rules = getAllSynonyms();
        if (rules.length === 0) {
            container.innerHTML = '<div style="color:#444;font-size:13px;font-style:italic;padding:12px 0;">No synonym rules defined yet.</div>';
            return;
        }
        rules.forEach(({ master, slaves }, idx) => {
            const row = document.createElement('div');
            row.className = 'syn-rule';
            row.innerHTML = `
                <div class="syn-rule-body">
                    <div class="syn-master">⭐ ${master}</div>
                    <div class="syn-slaves">${slaves.map(s => `<span class="syn-slave-chip">${s}</span>`).join('')}</div>
                </div>
                <button class="syn-delete-btn" data-idx="${idx}">🗑 Delete</button>`;
            row.querySelector('.syn-delete-btn').onclick = () => deleteSynonymRule(idx);
            container.appendChild(row);
        });
    }

    // Deletes a synonym rule by index with a simple confirm.
    function deleteSynonymRule(idx) {
        const rules = getAllSynonyms();
        const rule = rules[idx];
        if (!rule) return;
        if (!confirm(`Delete synonym rule "${rule.master}" ↔ [${rule.slaves.join(', ')}]?\n\nThis only removes the rule — it does not undo any previous database clean.`)) return;
        rules.splice(idx, 1);
        saveSynonyms(rules);
        invalidateSynonymMap();
        renderSynonymRules();
    }

    // Scrolls the duplicates tab to a specific group by index, expanding it if collapsed.
    function scrollToDuplicateGroup(idx) {
        const container = document.getElementById('x-dup-list');
        if (!container) return;
        const target = container.querySelector(`[data-dup-idx="${idx}"]`);
        if (!target) return;
        // Expand the group if collapsed
        const body = target.querySelector('.dup-body');
        const toggle = target.querySelector('.dup-toggle');
        if (body && body.style.display !== 'grid') {
            body.style.display = 'grid';
            if (toggle) toggle.textContent = '▾';
            // Populate eicons lazily
            if (!body._populated) {
                body._populated = true;
                const group = getAllDuplicates()[idx] || [];
                const rendered = new Set();
                group.forEach(name => {
                    const el = renderEiconOrComposite(name, rendered);
                    if (el) body.appendChild(el);
                });
            }
        }
        // Scroll into view
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        // Brief gold flash to confirm which group
        const origBorder = target.style.borderColor;
        target.style.borderColor = 'gold';
        target.style.transition = 'border-color 0.3s';
        setTimeout(() => { target.style.borderColor = origBorder || ''; }, 1200);
    }

    // Renders the duplicates tab — one collapsible per group showing eicon thumbnails.
    function renderDuplicatesList() {
        const container = document.getElementById('x-dup-list');
        if (!container) return;
        container.innerHTML = '';
        const groups = getAllDuplicates();
        if (groups.length === 0) {
            container.innerHTML = '<div style="color:#444; font-size:13px; font-style:italic; padding:12px 0;">No duplicate groups defined yet. Select 2+ eicons and type && in the batch tag modal.</div>';
            return;
        }
        groups.forEach((group, idx) => {
            const wrap = document.createElement('div');
            wrap.dataset.dupIdx = idx;
            wrap.style.cssText = 'background:#1a1a1a; border:1px solid #2a2a2a; border-radius:8px; overflow:hidden; margin-bottom:8px;';

            const header = document.createElement('div');
            header.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:10px 16px; cursor:pointer; user-select:none; background:#1f1f1f;';
            header.innerHTML = `
                <span style="color:#ccc; font-size:13px;">Group ${idx + 1} — <strong style="color:gold;">${group.length}</strong> eicons &nbsp;<span style="color:#555; font-size:11px;">${group.slice(0,3).join(', ')}${group.length > 3 ? '…' : ''}</span></span>
                <div style="display:flex; gap:8px; align-items:center;">
                    <button class="dup-delete-btn" style="background:none; border:1px solid #444; color:#666; border-radius:4px; padding:3px 10px; font-size:11px; cursor:pointer;">🗑 Delete Group</button>
                    <span class="dup-toggle" style="color:#555; font-size:14px;">▸</span>
                </div>`;

            const body = document.createElement('div');
            body.className = 'dup-body';
            body.style.cssText = 'display:none; padding:10px; background:#111; grid-template-columns:repeat(auto-fill,85px); grid-auto-rows:85px; grid-auto-flow:row dense; gap:4px;';

            header.onclick = (e) => {
                if (e.target.classList.contains('dup-delete-btn')) return;
                const open = body.style.display !== 'grid';
                body.style.display = open ? 'grid' : 'none';
                header.querySelector('.dup-toggle').textContent = open ? '▾' : '▸';
                if (open && !body._populated) {
                    body._populated = true;
                    const rendered = new Set();
                    group.forEach(name => {
                        const el = renderEiconOrComposite(name, rendered);
                        if (el) body.appendChild(el);
                    });
                }
            };

            header.querySelector('.dup-delete-btn').onclick = () => {
                if (!confirm(`Delete duplicate group containing ${group.length} eicons?\n\nThis removes the grouping rule. Eicons and their tags are not changed.`)) return;
                removeDuplicateGroup(idx);
                renderDuplicatesList();
            };

            wrap.appendChild(header);
            wrap.appendChild(body);
            container.appendChild(wrap);
        });
    }

    // Builds the right-panel tag list, optionally filtered by a search string.
    function renderDevToolsTagList(filter) {
        const right = document.getElementById('x-devtools-right');
        if (!right) return;

        // Remove all rows (keep the sticky header)
        const header = right.querySelector('#x-devtools-right-header');
        right.innerHTML = '';
        right.appendChild(header);

        const lib = getAllTags();

        // Count eicons per tag
        const tagCounts = {};
        for (const tagStr of Object.values(lib)) {
            tagStr.split(',').forEach(t => {
                const tag = t.trim().toLowerCase();
                if (tag) tagCounts[tag] = (tagCounts[tag] || 0) + 1;
            });
        }

        const allTags = Object.keys(tagCounts).sort();
        const filtered = filter ? allTags.filter(t => t.includes(filter)) : allTags;

        header.textContent = filter
            ? `${filtered.length} of ${allTags.length} tags`
            : `${allTags.length} tags — click to browse`;

        filtered.forEach(tag => {
            const row = document.createElement('div');
            row.className = 'dt-tag-row' + (tag === _devToolsActiveTag ? ' active' : '');
            row.innerHTML = `
                <span class="dt-tag-name">${tag}</span>
                <span class="dt-tag-count">${tagCounts[tag]}</span>`;
            row.onclick = () => {
                _devToolsActiveTag = tag;
                // Highlight active row
                right.querySelectorAll('.dt-tag-row').forEach(r => r.classList.remove('active'));
                row.classList.add('active');
                renderDevToolsEicons(tag);
            };
            right.appendChild(row);
        });

        if (filtered.length === 0) {
            const empty = document.createElement('div');
            empty.style.cssText = 'padding:20px 14px; color:#444; font-size:13px; font-style:italic;';
            empty.textContent = 'No tags match that filter.';
            right.appendChild(empty);
        }
    }

    // Populates the left panel with eicons for the given tag using the same
    // masonry grid (renderEiconOrComposite) as the main search results.
    function renderDevToolsEicons(tag) {
        const left = document.getElementById('x-devtools-left');
        if (!left) return;
        left.innerHTML = '';

        const lib = getAllTags();
        const eicons = Object.entries(lib)
            .filter(([, tagStr]) => tagStr.split(',').map(t => t.trim().toLowerCase()).includes(tag))
            .map(([name]) => name)
            .sort();

        if (eicons.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'empty-state';
            empty.textContent = 'No eicons tagged with this.';
            left.appendChild(empty);
            return;
        }

        // Use shared renderEiconOrComposite so composites render correctly in the grid.
        // Each category browse gets its own fresh renderedBases set.
        const rendered = new Set();
        eicons.forEach(name => {
            const el = renderEiconOrComposite(name, rendered);
            if (el) left.appendChild(el);
        });
    }

    // Creates a ghost eicon for the dev tools panel.
    // Supports Ctrl+Click selection (using the shared selectedIconNames set)
    // and direct tag editing. Visual selection state is managed via .dt-selected class.
    function createDevGhost(name) {
        const ghost = document.createElement('div');
        ghost.className = 'ghost-eicon' + (selectedIconNames.has(name) ? ' dt-selected' : '');
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

        ghost.addEventListener('click', (e) => {
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                e.stopPropagation();
                if (selectedIconNames.has(name)) {
                    selectedIconNames.delete(name);
                    ghost.classList.remove('dt-selected');
                } else {
                    selectedIconNames.add(name);
                    ghost.classList.add('dt-selected');
                }
                updateSelectionBar();
            } else {
                // Plain click = copy BBCode
                navigator.clipboard.writeText(`[eicon]${name}[/eicon]`);
                flashCopied(ghost);
            }
        });

        return ghost;
    }



    // --- 8. EXPLORER PANEL ---

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
                        <button class="data-btn" id="x-devtools-btn" title="Tag Browser (Dev Tools)">🛠️</button>
                        <button class="data-btn" id="x-dev-tags" title="Merge developer tag library">📡</button>
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
                tags:       getAllTags(),
                grid:       getAllGridData(),
                synonyms:   getAllSynonyms(),
                duplicates: getAllDuplicates()
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

                    let importedTags, importedGrid, importedSynonyms, importedDuplicates;
                    if (parsed.version === 1 && parsed.tags) {
                        // New combined format
                        importedTags       = parsed.tags;
                        importedGrid       = parsed.grid       || {};
                        importedSynonyms   = parsed.synonyms   || [];
                        importedDuplicates = parsed.duplicates || [];
                    } else {
                        // Old format — plain tag object, no supplemental data
                        importedTags       = parsed;
                        importedGrid       = {};
                        importedSynonyms   = [];
                        importedDuplicates = [];
                    }

                    showImportDialog(importedTags, importedGrid, importedSynonyms, importedDuplicates);
                };
                reader.readAsText(e.target.files[0]);
            };
            fileInput.click();
        };

        // Dev Tools
        manager.querySelector('#x-devtools-btn').onclick = () => openDevTools();

        // Dev Tags — fetches the developer-maintained tag library from GitHub Pages
        // and merges it into the user's local library. Read-only: users cannot push back.
        manager.querySelector('#x-dev-tags').onclick = () => {
            const btn = manager.querySelector('#x-dev-tags');
            btn.textContent = '⏳';
            btn.disabled = true;

            fetch(DEV_TAGS_URL, { cache: 'no-cache' })
                .then(r => {
                    if (!r.ok) throw new Error(`HTTP ${r.status}`);
                    return r.json();
                })
                .then(parsed => {
                    let importedTags, importedGrid;
                    if (parsed.version === 1 && parsed.tags) {
                        importedTags = parsed.tags;
                        importedGrid = parsed.grid || {};
                    } else {
                        importedTags = parsed;
                        importedGrid = {};
                    }
                    btn.textContent = '📡';
                    btn.disabled = false;
                    showDevTagsDialog(importedTags, importedGrid);
                })
                .catch(err => {
                    btn.textContent = '📡';
                    btn.disabled = false;
                    alert(`Could not fetch developer tags:\n${err.message}`);
                });
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

    // Inline import dialog — handles tags, grid data, synonyms, and duplicates.
    function showImportDialog(importedTags, importedGrid, importedSynonyms, importedDuplicates) {
        if (document.getElementById('x-import-dialog')) return;

        const importTagCount  = Object.keys(importedTags).length;
        const importGridCount = Object.keys(importedGrid).length;
        const existingCount   = Object.keys(getAllTags()).length;
        const synCount  = importedSynonyms.length;
        const dupCount  = importedDuplicates.length;

        const extraNote = [
            importGridCount > 0 ? `<strong style="color:#eee;">${importGridCount}</strong> grid positions` : '',
            synCount  > 0 ? `<strong style="color:#eee;">${synCount}</strong> synonym rules` : '',
            dupCount  > 0 ? `<strong style="color:#eee;">${dupCount}</strong> duplicate groups` : ''
        ].filter(Boolean).join(', ');

        const dialog = document.createElement('div');
        dialog.id = 'x-import-dialog';
        dialog.style.cssText = `position:fixed; inset:0; background:rgba(0,0,0,0.85); z-index:2000002; display:flex; align-items:center; justify-content:center;`;
        dialog.innerHTML = `
            <div style="background:#1a1a1a; border:2px solid gold; border-radius:8px; width:90%; max-width:400px; padding:20px; color:#eee; font-family:sans-serif;">
                <div style="color:gold; font-weight:bold; margin-bottom:12px;">📥 Import Tags</div>
                <div style="font-size:13px; color:#aaa; margin-bottom:16px; line-height:1.6;">
                    Importing <strong style="color:#eee;">${importTagCount}</strong> tagged eicons${extraNote ? ` plus ${extraNote}` : ''}.<br>
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
            saveSynonyms(importedSynonyms);
            saveAllDuplicates(importedDuplicates);
            invalidateSynonymMap();
            dialog.remove();
            location.reload();
        };

        dialog.querySelector('#x-import-merge').onclick = () => {
            // Tags: merge at tag level
            saveFullLibrary(mergeLibraries(getAllTags(), importedTags));
            // Grid: existing positions win on conflict
            saveAllGridData({ ...importedGrid, ...getAllGridData() });
            // Synonyms: merge by master — imported slaves added to existing rules, new rules appended
            const existingSyn = getAllSynonyms();
            importedSynonyms.forEach(({ master, slaves }) => {
                const existing = existingSyn.find(r => r.master === master);
                if (existing) { slaves.forEach(s => { if (!existing.slaves.includes(s)) existing.slaves.push(s); }); }
                else existingSyn.push({ master, slaves });
            });
            saveSynonyms(existingSyn);
            invalidateSynonymMap();
            // Duplicates: merge groups — any new group not already covered is appended
            const existingDup = getAllDuplicates();
            importedDuplicates.forEach(group => {
                const alreadyCovered = group.some(n => existingDup.some(g => g.includes(n)));
                if (!alreadyCovered) existingDup.push(group);
            });
            saveAllDuplicates(existingDup);
            dialog.remove();
            location.reload();
        };
    }



    // Dev tags dialog — merge-only, no Replace option.
    // Shows what will be added before committing, lets user cancel safely.
    function showDevTagsDialog(importedTags, importedGrid) {
        if (document.getElementById('x-dev-dialog')) return;

        const importTagCount  = Object.keys(importedTags).length;
        const importGridCount = Object.keys(importedGrid).length;
        const existingTags    = getAllTags();
        const existingCount   = Object.keys(existingTags).length;

        // Count net-new eicons and net-new tags the merge would add
        let newEiconCount = 0;
        let newTagCount   = 0;
        for (const [eicon, tagStr] of Object.entries(importedTags)) {
            if (!existingTags[eicon]) {
                newEiconCount++;
                newTagCount += tagStr.split(',').filter(Boolean).length;
            } else {
                const existingSet = new Set(existingTags[eicon].split(',').map(t => t.trim().toLowerCase()));
                tagStr.split(',').forEach(t => {
                    const trimmed = t.trim().toLowerCase();
                    if (trimmed && !existingSet.has(trimmed)) newTagCount++;
                });
            }
        }

        const dialog = document.createElement('div');
        dialog.id = 'x-dev-dialog';
        dialog.style.cssText = `position:fixed; inset:0; background:rgba(0,0,0,0.85); z-index:2000002; display:flex; align-items:center; justify-content:center;`;
        dialog.innerHTML = `
            <div style="background:#1a1a1a; border:2px solid #3ecfb2; border-radius:8px; width:90%; max-width:420px; padding:20px; color:#eee; font-family:sans-serif;">
                <div style="color:#3ecfb2; font-weight:bold; margin-bottom:12px; font-size:14px;">📡 Developer Tag Library</div>
                <div style="font-size:13px; color:#aaa; margin-bottom:16px; line-height:1.8;">
                    The developer library contains <strong style="color:#eee;">${importTagCount}</strong> tagged eicons
                    ${importGridCount > 0 ? `and <strong style="color:#eee;">${importGridCount}</strong> grid positions` : ''}.
                    <br>You currently have <strong style="color:#eee;">${existingCount}</strong> eicons tagged.
                    <br><br>
                    Merging will add <strong style="color:#3ecfb2;">${newEiconCount}</strong> new eicons
                    and <strong style="color:#3ecfb2;">${newTagCount}</strong> new tags to your library.
                    <br>Your existing tags are never removed or overwritten.
                </div>
                <div style="display:flex; justify-content:flex-end; gap:10px;">
                    <button id="x-dev-cancel" style="background:#444; color:white; border:none; padding:8px 15px; cursor:pointer; border-radius:4px;">Cancel</button>
                    <button id="x-dev-merge" style="background:#3ecfb2; color:black; border:none; padding:8px 15px; cursor:pointer; border-radius:4px; font-weight:bold;">Merge</button>
                </div>
            </div>`;

        document.body.appendChild(dialog);

        dialog.querySelector('#x-dev-cancel').onclick = () => dialog.remove();

        dialog.querySelector('#x-dev-merge').onclick = () => {
            saveFullLibrary(mergeLibraries(getAllTags(), importedTags));
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



    // --- 9. BATCH SELECTION ENGINE ---

    // Applies or removes the gold selection highlight on an x-eiconview host element.
    // Inline styles are used because CSS cannot pierce the shadow boundary.
    function applySelectionVisual(el, selected) {
        if (selected) {
            el.style.outline    = '2px solid gold';
            el.style.boxShadow  = '0 0 10px rgba(255,215,0,0.5)';
            el.style.zIndex     = '10';
            el._xSelected       = true;
        } else {
            el.style.outline    = '';
            el.style.boxShadow  = '';
            el.style.zIndex     = '';
            el._xSelected       = false;
        }
    }

    // Updates the floating selection bar visibility and count.
    function updateSelectionBar() {
        const bar = document.getElementById('x-selection-bar');
        if (!bar) return;
        const count = selectedIconNames.size;
        if (count === 0) {
            bar.classList.remove('visible');
        } else {
            bar.classList.add('visible');
            const countEl = bar.querySelector('#x-selection-count');
            if (countEl) countEl.textContent = `${count} eicon${count === 1 ? '' : 's'} selected`;
        }
    }

    // Clears all selections and removes highlights from all visible elements.
    function clearSelection() {
        selectedIconNames.clear();
        findDeep(document, 'x-eiconview').forEach(el => {
            if (el._xSelected) applySelectionVisual(el, false);
        });
        updateSelectionBar();
    }

    // Toggles an eicon in/out of the selection, updates its visual, and refreshes the bar.
    function toggleSelection(el, iconName) {
        if (selectedIconNames.has(iconName)) {
            selectedIconNames.delete(iconName);
            applySelectionVisual(el, false);
        } else {
            selectedIconNames.add(iconName);
            applySelectionVisual(el, true);
        }
        updateSelectionBar();
    }

    // Opens a batch tag modal that saves to all selected eicons on Save.
    // Grid tags are excluded — positions are per-eicon and can't be batched.
    function openBatchModal() {
        if (selectedIconNames.size === 0) return;

        currentIconName = '';  // not editing a single icon
        activeTags = [];
        activeGridSpec = null;
        activeGridPos  = null;

        // Seed with tags common to ALL selected eicons (intersection)
        const names = [...selectedIconNames];
        const tagSets = names.map(n => {
            const raw = getStoredTags(n);
            return new Set(raw ? raw.split(',').map(t => t.trim().toLowerCase()).filter(Boolean) : []);
        });
        // Start with all tags from the first eicon, then intersect
        const common = tagSets[0];
        tagSets.slice(1).forEach(set => {
            for (const t of [...common]) { if (!set.has(t)) common.delete(t); }
        });
        activeTags = [...common];

        if (!document.getElementById('x-tag-modal-overlay')) {
            // The modal doesn't exist yet — call openTagModal with a dummy name to build it,
            // then we'll overwrite the title. But simpler: just ensure modal is built.
            openTagModal(names[0]);
            // Immediately override the state we just set
            currentIconName = '';
            activeTags = [...common];
        }

        // Set modal state directly and show
        document.getElementById('x-modal-icon-name').textContent =
            `${names.length} eicons`;
        document.getElementById('x-tag-modal-overlay').style.display = 'flex';

        const input = document.getElementById('x-modal-input');
        if (input) { input.value = ''; input.focus(); }

        suggestionQuery = '';
        updateSuggestions('');
        renderModalChips();
        renderGridArea();
        renderLeftChipSlot('');
    }

    // Create the floating selection bar once on first use
    function ensureSelectionBar() {
        if (document.getElementById('x-selection-bar')) return;
        const bar = document.createElement('div');
        bar.id = 'x-selection-bar';
        bar.innerHTML = `
            <span id="x-selection-count">0 eicons selected</span>
            <button id="x-selection-tag-btn">🏷️ Tag Selected</button>
            <button id="x-selection-clear-btn">✕ Clear</button>`;
        document.body.appendChild(bar);
        bar.querySelector('#x-selection-tag-btn').onclick = () => openBatchModal();
        bar.querySelector('#x-selection-clear-btn').onclick = () => clearSelection();
    }

    // Document-level listener: a plain (non-Ctrl) click anywhere outside an eicon
    // clears the selection. Runs in capture phase so it fires before any other handler.
    document.addEventListener('click', (e) => {
        if (e.ctrlKey || e.metaKey) return;
        if (selectedIconNames.size === 0) return;
        // If the click path contains an x-eiconview, let processIcon's handler deal with it
        if (e.composedPath().some(n => n.tagName === 'X-EICONVIEW')) return;
        // Ignore clicks inside our own UI
        if (e.composedPath().some(n => n.id === 'x-tag-manager' || n.id === 'x-selection-bar' ||
                                       n.id === 'x-tag-modal-overlay' || n.id === 'x-import-dialog' ||
                                       n.id === 'x-dev-dialog')) return;
        clearSelection();
    }, true);



    // --- 10. LIVE EICON BUTTONS ---
    // Injects a tag button into each eicon's shadow root.
    // Also wires Ctrl+Click selection and restores selection highlight
    // when a previously-selected eicon is re-rendered by the virtual scroll.

    const processIcon = (el) => {
        const shadow = el.shadowRoot;
        if (!shadow || shadow.querySelector('.tag-btn')) return;

        const rootDiv = shadow.querySelector('.root');
        if (!rootDiv) return;

        const iconName = rootDiv.getAttribute('data-tooltip');
        if (!iconName) return;

        ensureSelectionBar();
        rootDiv.style.position = 'relative';

        // Restore selection highlight if this eicon was selected before being scrolled out
        if (selectedIconNames.has(iconName)) applySelectionVisual(el, true);

        // Ctrl/Cmd+Click on the host element toggles selection.
        // Runs in capture phase so it fires before Xariah's own handler.
        if (!el._xSelectionBound) {
            el._xSelectionBound = true;
            el.addEventListener('click', (e) => {
                if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    toggleSelection(el, iconName);
                }
            }, true);
        }

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
