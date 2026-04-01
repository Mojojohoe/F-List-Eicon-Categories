// ==UserScript==
// @name         Xariah Tagger
// @version      0.0.88
// @description  Alpha version of the tagging & search system for xariah eicon database
// @author       Jobix
// @match        *://xariah.net/eicons*
// @icon         https://mojojohoe.github.io/F-List-Eicon-Categories/Tag.png
// @updateURL    https://mojojohoe.github.io/F-List-Eicon-Categories/script.js
// @downloadURL  https://mojojohoe.github.io/F-List-Eicon-Categories/script.js
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    console.log('[XariahTagger] Script starting v0.0.88');
    const SCRIPT_VERSION = '0.0.88';

    // URL of the developer-maintained tag library on GitHub Pages.
    // Update this file in the repo to push new tags to all users.
    // Users can only ever pull from this URL — they cannot push back.
    const DEV_TAGS_URL = 'https://mojojohoe.github.io/F-List-Eicon-Categories/dev_tags.txt';

    // Injected into every x-popuphost shadow root to hide the native tooltip.
    // Defined early because the attachShadow hook below references it at call time.
    const POPUPHOST_SUPPRESS_STYLE = 'x-tooltippopup { display: none !important; }';



    // --- 1. SHADOW-ROOT OPENER + TOOLTIP SUPPRESSOR ---
    // Forces all shadow roots into open mode so we can read/write into them.
    // Also detects whether the shadow hook is actually running (requires Tampermonkey
    // user-script permissions to be fully enabled). The page favicon changes to the
    // XariahTagger icon the first time we successfully intercept a Xariah shadow root —
    // giving a clear visual signal that the script is fully operational.

    let _shadowHookConfirmed = false;

    const _setTagFavicon = () => {
        if (_shadowHookConfirmed) return;
        _shadowHookConfirmed = true;
        // Wait for document.head to exist (we run at document-start)
        const applyFavicon = () => {
            if (!document.head) { setTimeout(applyFavicon, 50); return; }
            // Remove any existing favicon links
            document.head.querySelectorAll('link[rel~="icon"]').forEach(l => l.remove());
            const link = document.createElement('link');
            link.rel  = 'icon';
            link.type = 'image/png';
            link.href = 'https://mojojohoe.github.io/F-List-Eicon-Categories/Tag.png';
            document.head.appendChild(link);
        };
        applyFavicon();
    };

    const _origAttachShadow = Element.prototype.attachShadow;
    console.log('[XariahTagger] attachShadow hook installed');
    Element.prototype.attachShadow = function(init) {
        if (init) init.mode = 'open';
        const shadow = _origAttachShadow.call(this, init);
        if (this.tagName && this.tagName.startsWith('X-') && !_shadowHookConfirmed) {
            console.log('[XariahTagger] First X-* shadow root intercepted:', this.tagName);
            _setTagFavicon();
        }
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
    let _assocCache      = null;  // Map<tag, Map<tag, count>> — co-occurrence counts
    let _blockedCache    = null;  // string[] — blocked tags, NEVER exported

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
        _assocCache      = null; // co-occurrence map must be rebuilt too
        _tagFreqCache    = null; // tag frequency counts must be rebuilt too
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

    const getIconGrid  = (name) => getAllGridData()[name.toLowerCase()] || null;
    const saveIconGrid = (name, spec, pos) => {
        const key = name.toLowerCase();
        const d = getAllGridData();
        if (spec) d[key] = { spec, pos: pos ?? null };
        else delete d[key];
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

    // --- BLOCKED TAGS STORAGE ---
    // Blocked tags are intentionally personal and never included in export/import.
    // Any eicon whose tags contain a blocked tag is censored everywhere it appears.
    const getAllBlockedTags = () => {
        if (_blockedCache === null) _blockedCache = JSON.parse(localStorage.getItem('x_blocked_tags') || '[]');
        return _blockedCache;
    };

    const saveBlockedTags = (tags) => {
        _blockedCache = tags;
        localStorage.setItem('x_blocked_tags', JSON.stringify(tags));
    };

    const addBlockedTag = (tag) => {
        const tags = getAllBlockedTags();
        if (!tags.includes(tag)) { tags.push(tag); saveBlockedTags(tags); }
    };

    const removeBlockedTag = (tag) => {
        saveBlockedTags(getAllBlockedTags().filter(t => t !== tag));
    };

    // Returns true if this eicon's tags (or any synonym of them) intersect the blocked tag set.
    // Synonym expansion means blocking "explicit" also catches eicons tagged with its synonyms.
    const isEiconCensored = (name) => {
        const blocked = getAllBlockedTags();
        if (blocked.length === 0) return false;
        const raw = getStoredTags(name);
        if (!raw) return false;
        const eiconTags = raw.split(',').map(t => t.trim().toLowerCase());
        // Build expanded set: each stored tag plus all its synonyms
        const expandedTags = new Set(eiconTags);
        eiconTags.forEach(t => {
            const related = getSynonymMap().get(t);
            if (related) related.forEach(r => expandedTags.add(r));
        });
        // Also expand each blocked tag through synonyms so blocking a master catches slaves
        return blocked.some(b => {
            if (expandedTags.has(b)) return true;
            const bRelated = getSynonymMap().get(b);
            return bRelated ? [...bRelated].some(r => expandedTags.has(r)) : false;
        });
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

    // Builds and caches two structures:
    //   _assocCache: Map<tag, Map<tag, cooccurrence_count>>
    //   _tagFreqCache: Map<tag, eicon_count>  (how many eicons carry each tag)
    //
    // Scoring uses conditional probability: for each source tag in currentTags,
    // the score for a candidate tag = cooccurrence(source, candidate) / freq(source).
    // These are summed across all source tags.
    //
    // This means: if 100 of 120 eicons tagged "heart" also have "pink",
    // pink scores 100/120 = 0.833 for that source. Summing across multiple
    // source tags rewards tags that are strongly associated with ALL of them.
    let _tagFreqCache = null;

    const getAssocMap = () => {
        if (_assocCache !== null) return _assocCache;

        _assocCache    = new Map(); // tag → Map<coTag, count>
        _tagFreqCache  = new Map(); // tag → total eicons carrying it

        for (const tagStr of Object.values(getAllTags())) {
            const tags = tagStr.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
            // Deduplicate within a single eicon's tags to avoid double-counting
            const unique = [...new Set(tags)];
            unique.forEach(t => _tagFreqCache.set(t, (_tagFreqCache.get(t) || 0) + 1));
            for (let i = 0; i < unique.length; i++) {
                for (let j = 0; j < unique.length; j++) {
                    if (i === j) continue;
                    if (!_assocCache.has(unique[i])) _assocCache.set(unique[i], new Map());
                    const inner = _assocCache.get(unique[i]);
                    inner.set(unique[j], (inner.get(unique[j]) || 0) + 1);
                }
            }
        }
        return _assocCache;
    };

    // Returns up to N candidate tags scored by conditional probability summed across currentTags.
    // score(candidate) = Σ  cooccurrence(source, candidate) / freq(source)
    //                    source ∈ currentTags
    const getAssocSuggestions = (currentTags, n = 6) => {
        if (currentTags.length === 0) return [];
        const assoc = getAssocMap(); // also populates _tagFreqCache
        const scores = new Map();

        currentTags.forEach(tag => {
            const freq    = _tagFreqCache ? (_tagFreqCache.get(tag) || 1) : 1;
            const related = assoc.get(tag);
            if (!related) return;
            related.forEach((count, other) => {
                if (currentTags.includes(other)) return;
                // Normalize by frequency of the source tag so common tags don't dominate
                scores.set(other, (scores.get(other) || 0) + count / freq);
            });
        });

        return [...scores.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, n)
            .map(([tag]) => tag);
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

    // Forced grid sets — groups of eicons that form a composite regardless of name similarity.
    // Storage: x_forced_grids → Array<string[]>  (each inner array = one group, ordered)
    let _forcedGridCache = null;

    const getAllForcedGrids = () => {
        if (_forcedGridCache === null) _forcedGridCache = JSON.parse(localStorage.getItem('x_forced_grids') || '[]');
        return _forcedGridCache;
    };

    const saveAllForcedGrids = (groups) => {
        _forcedGridCache = groups;
        localStorage.setItem('x_forced_grids', JSON.stringify(groups));
    };

    const getEiconForcedGroup = (name) => {
        const key = name.toLowerCase();
        const groups = getAllForcedGrids();
        for (let i = 0; i < groups.length; i++) {
            if (groups[i].includes(key)) return { groupIdx: i, group: groups[i] };
        }
        return null;
    };

    // Creates/merges a forced grid group from the given names.
    const addForcedGridGroup = (names) => {
        const groups = getAllForcedGrids();
        const merged = new Set(names.map(n => n.toLowerCase()));
        const keepGroups = [];
        groups.forEach(g => {
            if (g.some(n => merged.has(n))) { g.forEach(n => merged.add(n)); }
            else keepGroups.push(g);
        });
        keepGroups.push([...merged].sort());
        saveAllForcedGrids(keepGroups);
    };

    const removeForcedGridGroup = (idx) => {
        const groups = getAllForcedGrids();
        groups.splice(idx, 1);
        saveAllForcedGrids(groups);
    };

    // Returns { groupIdx, group } for the group containing this eicon, or null.
    const getEiconDuplicateGroup = (name) => {
        const key = name.toLowerCase();
        const groups = getAllDuplicates();
        for (let i = 0; i < groups.length; i++) {
            if (groups[i].includes(key)) return { groupIdx: i, group: groups[i] };
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
        .filter-input { padding: 8px 12px; background: transparent; border: none; color: gold; outline: none; box-sizing: border-box; flex: 1; min-width: 80px; font-size: 14px; }
        .filter-input::placeholder { color: #555; }
        /* Composite search bar wrapping ghost chips + the text input */
        #x-search-wrap {
            display: flex; align-items: center; flex-wrap: wrap; gap: 4px;
            background: #000; border: 1px solid #444; border-radius: 4px;
            padding: 4px 8px; cursor: text; min-height: 40px;
        }
        #x-search-wrap:focus-within { border-color: gold; }
        /* Ghost chips — quoted phrase chips inside the search bar */
        .search-ghost-chip {
            display: inline-flex; align-items: center; gap: 4px;
            background: transparent; border: 1px dashed #666;
            border-radius: 100px; padding: 3px 10px;
            font-size: 12px; color: #aaa; cursor: pointer;
            user-select: none; white-space: nowrap;
            transition: border-color 0.15s, color 0.15s;
        }
        .search-ghost-chip:hover { border-color: gold; color: gold; }
        .search-ghost-chip.negative { border-color: #a33; color: #e87; }
        .search-ghost-chip.negative:hover { border-color: var(--red); color: var(--red); }
        .search-ghost-chip .ghost-quote { color: #555; font-size: 10px; margin: 0 1px; }
        .search-ghost-chip.negative .ghost-quote { color: #833; }
        /* Top tags row above Best Matches */
        #x-top-tags {
            display: none; flex-wrap: wrap; gap: 6px;
            padding: 8px 10px 2px 10px;
        }
        #x-top-tags.visible { display: flex; }
        #x-top-tags-label { font-size: 10px; color: #555; letter-spacing: 1.5px; text-transform: uppercase; display: flex; align-items: center; margin-right: 2px; }
        .top-tag-chip {
            display: inline-flex; align-items: center; gap: 4px;
            background: #1a1a1a; border: 1px solid #333;
            border-radius: 100px; padding: 3px 10px;
            font-size: 12px; color: #aaa; cursor: pointer;
            transition: border-color 0.15s, color 0.15s, background 0.15s;
        }
        .top-tag-chip:hover { border-color: gold; color: gold; background: #1f1a00; }
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

        /* Welcome modal */
        #x-welcome-overlay {
            position: fixed; inset: 0; background: rgba(0,0,0,0.90); z-index: 3000000;
            display: flex; align-items: center; justify-content: center; font-family: sans-serif;
        }
        #x-welcome-box {
            background: #111; border: 2px solid gold; border-radius: 12px;
            width: 92%; max-width: 520px; padding: 32px 36px; color: #eee; position: relative;
        }
        #x-welcome-box h2 { color: gold; font-size: 22px; margin: 0 0 6px; }
        #x-welcome-box .sub { color: #888; font-size: 12px; font-family: monospace; letter-spacing: 1px; margin-bottom: 20px; text-transform: uppercase; }
        #x-welcome-box p { font-size: 14px; color: #aaa; line-height: 1.7; margin-bottom: 14px; }
        #x-welcome-box p strong { color: #eee; }
        #x-welcome-box a { color: gold; text-decoration: none; border-bottom: 1px solid #7a6115; }
        #x-welcome-box a:hover { border-bottom-color: gold; }
        #x-welcome-btn {
            display: block; width: 100%; margin-top: 24px;
            background: gold; color: #000; border: none; border-radius: 6px;
            padding: 12px; font-size: 15px; font-weight: bold; cursor: pointer;
        }
        #x-welcome-btn:hover { background: #ffe066; }

        /* Censored eicons — hazard tape border, blurred image, grey overlay with red X */
        .ghost-eicon.x-censored {
            border: 4px solid transparent !important;
            border-image: repeating-linear-gradient(
                45deg,
                #111 0px, #111 8px,
                #f5c842 8px, #f5c842 16px
            ) 4 !important;
        }
        .ghost-eicon.x-censored img { filter: blur(9px) !important; }
        .censor-overlay {
            position: absolute; inset: 0;
            background: rgba(30,30,30,0.88);
            display: flex; align-items: center; justify-content: center;
            pointer-events: none; z-index: 5;
            flex-direction: column; gap: 2px;
        }
        .censor-overlay .cx { font-size: 22px; line-height: 1; color: #e74c3c; font-weight: 900; }
        .censor-overlay .cl { font-size: 8px; color: #aaa; font-family: monospace; letter-spacing: 0.5px; text-transform: uppercase; }
        #x-tag-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.85); z-index: 2000001; display: none; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 20px 0; overflow-y: auto; }

        /* Eicon preview panel — sits above the tag modal inside the overlay flex column */
        #x-eicon-preview {
            display: none; align-items: center; justify-content: center;
            flex-wrap: wrap; gap: 4px;
            background: #111; border: 1px solid #333; border-radius: 10px;
            padding: 10px; max-width: 600px; width: max-content;
            box-shadow: 0 4px 16px rgba(0,0,0,0.5);
            flex-shrink: 0;
        }
        #x-eicon-preview.visible { display: flex; }
        /* Single large preview */
        .preview-single {
            width: 100px; height: 100px;
            display: flex; align-items: center; justify-content: center;
        }
        .preview-single img { width: 100px; height: 100px; object-fit: contain; image-rendering: pixelated; }
        /* Grid cell in the preview */
        .preview-cell {
            width: 60px; height: 60px; cursor: pointer; border-radius: 4px;
            border: 2px solid transparent; transition: border-color 0.15s, opacity 0.15s;
            display: flex; align-items: center; justify-content: center;
            background: #1a1a1a; overflow: hidden; flex-shrink: 0;
            position: relative;
        }
        .preview-cell img { width: 100%; height: 100%; object-fit: contain; image-rendering: pixelated; }
        .preview-cell:hover { border-color: #666; }
        .preview-cell.active { border-color: gold; box-shadow: 0 0 8px rgba(255,215,0,0.5); }
        .preview-cell.selected { border-color: gold; box-shadow: 0 0 8px rgba(255,215,0,0.5); opacity: 0.75; }
        .preview-cell.active.selected { border-color: gold; box-shadow: 0 0 12px rgba(255,215,0,0.8); opacity: 1; }
        .preview-cell.stacked { cursor: pointer; }
        .preview-cell.stacked .stack-ghost {
            position: absolute; border-radius: 3px; overflow: hidden;
            border: 1px solid rgba(255,255,255,0.15);
            transition: opacity 0.15s, transform 0.15s;
            pointer-events: none;
        }
        .preview-cell.stacked:hover .stack-ghost { opacity: 0.55; }
        .preview-cell.stacked .stack-ghost:nth-child(2) { bottom: -4px; right: -4px; width: 100%; height: 100%; opacity: 0; transform: translate(3px,3px) scale(0.88); }
        .preview-cell.stacked .stack-ghost:nth-child(3) { bottom: -8px; right: -8px; width: 100%; height: 100%; opacity: 0; transform: translate(6px,6px) scale(0.76); }
        .preview-cell.stacked .stack-badge { position: absolute; top: 2px; right: 2px; background: #e67e22; color: #fff; font-size: 8px; font-weight: bold; border-radius: 3px; padding: 0 3px; line-height: 12px; pointer-events: none; }
        .preview-cell.empty { opacity: 0.15; cursor: default; }
        /* Unsaved tag chip — faded yellow with dashed border */
        .chip.yellow.unsaved {
            opacity: 0.55; border: 1px dashed #a07800;
            background: #b89000; color: #000;
        }
        /* Partial tag: present in some but not all selected eicons */
        .chip.yellow.partial {
            background: repeating-linear-gradient(
                -45deg,
                gold 0px, gold 5px,
                #a07800 5px, #a07800 10px
            );
            color: #000; border: 1px solid #a07800; opacity: 0.85;
        }
        /* Unsaved partial: both effects — dashed border reasserts over .partial's solid */
        .chip.yellow.partial.unsaved {
            opacity: 0.55; border: 1px dashed #a07800;
        }

        /* Batch Selection floating bar */
        #x-selection-bar {
            position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
            z-index: 2500000; display: none;
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
        #x-tag-modal { background: #1a1a1a; border: 2px solid gold; border-radius: 8px; width: 92%; max-width: 560px; padding: 20px; }
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
        .chip.vermillion { background: #c0522a; color: #fff; cursor: pointer; border: 1px solid #e06030; }

        /* Smart grid hint — base colour is red; forced-grid variant is vermillion */
        #x-smart-grid-hint { --sg-color: #e74c3c; --sg-bg: #1a0a0a; --sg-border: #e74c3c44; }
        .chip.purple { background: #7c3aed; color: #fff; cursor: pointer; border: 1px solid #9d7ef5; }

        /* Smart grid drag-to-size widget — uses CSS vars for colour theming.
           Default: neutral grey suggestion (not yet applied). Forced-grid: vermillion. */
        #x-smart-grid-hint {
            display: none; margin-top: 10px; padding: 10px 14px 18px 14px;
            background: #222; border: 1px solid #444;
            border-radius: 6px; position: relative;
        }
        #x-smart-grid-hint.visible { display: block; }
        #x-smart-grid-hint.forced { background: #1a0e00; border-color: rgba(192,82,42,0.27); }
        #x-smart-grid-hint.forced #x-sg-bottom-handle, #x-smart-grid-hint.forced #x-sg-right-handle { background: rgba(192,82,42,0.20); border-color: rgba(192,82,42,0.33); }
        #x-smart-grid-hint.forced #x-sg-bottom-handle::after, #x-smart-grid-hint.forced #x-sg-right-handle::after { color: #c0522a; }
        #x-smart-grid-hint.forced .sgc { background: rgba(192,82,42,0.18); border-color: rgba(192,82,42,0.33); }
        #x-smart-grid-hint.forced .sgc.anchor { background: rgba(192,82,42,0.55); border-color: #c0522a; color: #c0522a; }
        #x-smart-grid-hint.forced #x-sg-size-label { color: rgba(192,82,42,0.53); }
        #x-smart-grid-hint.forced #x-sg-confirm { background: #c0522a; }
        #x-smart-grid-hint-label {
            font-size: 10px; color: #777; text-transform: uppercase;
            letter-spacing: 1px; margin-bottom: 10px;
        }
        #x-smart-grid-hint.forced #x-smart-grid-hint-label {
            color: rgba(231,76,60,0.60);
        }
        #x-sg-sidebar {
            position: absolute; top: 10px; right: 14px;
            display: flex; flex-direction: column; align-items: flex-start; gap: 10px;
        }
        #x-smart-grid-canvas { display: inline-block; padding-right: 130px; }
        #x-sg-wrap {
            position: relative; display: inline-block;
            user-select: none; margin-top: 10px;
        }
        #x-sg-bottom-handle {
            position: absolute; bottom: -10px; left: 0; right: 0; height: 10px;
            cursor: ns-resize; display: flex; align-items: center; justify-content: center;
            background: rgba(231,76,60,0.20);
            border-radius: 0 0 3px 3px;
            border: 1px solid rgba(231,76,60,0.33); border-top: none;
            transition: background 0.15s;
        }
        #x-sg-bottom-handle:hover { background: rgba(231,76,60,0.33); }
        #x-sg-bottom-handle::after { content: '↕'; color: #e74c3c; font-size: 10px; }
        #x-sg-right-handle {
            position: absolute; top: 0; right: -10px; bottom: 0; width: 10px;
            cursor: ew-resize; display: flex; align-items: center; justify-content: center;
            background: rgba(231,76,60,0.20);
            border-radius: 0 3px 3px 0;
            border: 1px solid rgba(231,76,60,0.33); border-left: none;
            transition: background 0.15s;
        }
        #x-sg-right-handle:hover { background: rgba(231,76,60,0.33); }
        #x-sg-right-handle::after { content: '↔'; color: #e74c3c; font-size: 10px; }
        #x-sg-cells { display: inline-grid; gap: 4px; }
        .sgc {
            width: 24px; height: 24px; border-radius: 3px;
            background: rgba(231,76,60,0.18);
            border: 1px solid rgba(231,76,60,0.33);
        }
        .sgc.anchor {
            background: rgba(231,76,60,0.55);
            border: 1px solid #e74c3c;
            display: flex; align-items: center; justify-content: center;
            font-size: 11px; color: #e74c3c;
        }
        .sgc.overflow { background: rgba(255,255,255,0.04); border-color: rgba(255,255,255,0.08); opacity: 0.35; }
        #x-sg-size-label {
            font-family: monospace; font-size: 15px;
            color: rgba(231,76,60,0.53); pointer-events: none;
        }
        #x-sg-confirm {
            background: #e74c3c; color: white; border: none; border-radius: 4px;
            padding: 6px 14px; font-size: 12px; font-weight: bold;
            cursor: pointer; transition: background 0.15s; white-space: nowrap;
        }
        #x-sg-confirm:hover { filter: brightness(0.85); }

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
        .grid-cell.conflict { border-color: #e67e22; box-shadow: 0 0 5px rgba(230,126,34,0.7); cursor: pointer !important; }
        .grid-cell.cycle-active { outline: 2px solid #e67e22; outline-offset: -2px; }
        /* Dev Tools tabs */
        #x-devtools-tabs {
            display: flex; gap: 4px; padding: 8px 12px;
            background: #0a0a0a; border-bottom: 2px solid #1a1a1a; flex-shrink: 0;
        }
        .dt-tab {
            padding: 9px 20px; font-size: 13px; font-weight: 600; cursor: pointer;
            color: #555; background: #111; border: 1px solid #222;
            border-radius: 6px; transition: all 0.15s; user-select: none;
            letter-spacing: 0.2px;
        }
        .dt-tab:hover { color: #aaa; background: #1a1a1a; border-color: #333; }
        .dt-tab.active {
            color: #000; background: gold; border-color: gold;
            box-shadow: 0 0 10px rgba(245,200,66,0.25);
        }
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

        /* Blocked tags panel */
        #x-blocked-panel { flex-direction: column; overflow-y: auto; padding: 20px; gap: 16px; width: 100%; }
        #x-blocked-form { background: #1a1a1a; border: 1px solid #e74c3c44; border-radius: 8px; padding: 18px; display: flex; flex-direction: column; gap: 12px; flex-shrink: 0; max-width: 860px; }
        #x-blocked-form h3 { margin: 0; font-size: 14px; color: #e74c3c; }
        #x-blocked-input-row { display: flex; gap: 8px; }
        #x-blocked-input { flex: 1; background: #000; border: 1px solid #e74c3c66; border-radius: 4px; padding: 8px 12px; color: #eee; font-size: 13px; outline: none; }
        #x-blocked-input:focus { border-color: #e74c3c; }
        #x-blocked-add-btn { background: #e74c3c; color: white; border: none; border-radius: 4px; padding: 8px 16px; font-size: 13px; font-weight: bold; cursor: pointer; }
        #x-blocked-add-btn:hover { background: #c0392b; }
        #x-blocked-list-wrap { max-width: 860px; }
        #x-blocked-list-wrap h3 { font-size: 14px; color: #aaa; margin-bottom: 10px; }
        .blocked-tag-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 14px; background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 6px; margin-bottom: 6px; }
        .blocked-tag-name { font-family: monospace; font-size: 13px; color: #eee; display: flex; align-items: center; gap: 8px; }
        .blocked-tag-name::before { content: '🚫'; font-size: 12px; }
        .blocked-remove-btn { background: none; border: 1px solid #444; color: #666; border-radius: 4px; padding: 3px 10px; font-size: 11px; cursor: pointer; transition: border-color .15s, color .15s; }
        .blocked-remove-btn:hover { border-color: #e74c3c; color: #e74c3c; }

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
        #x-dt-batch-bar {
            display: none; position: sticky; top: 0; z-index: 5;
            background: #1a1a00; border-bottom: 1px solid var(--gold, gold);
            padding: 8px 12px; align-items: center; gap: 10px;
            grid-column: 1 / -1;
        }
        #x-dt-batch-bar.visible { display: flex; }
        #x-dt-batch-bar-count { font-size: 13px; color: gold; font-weight: bold; flex: 1; }
        #x-dt-batch-tag-btn {
            background: gold; color: #000; border: none; border-radius: 100px;
            padding: 6px 16px; font-size: 12px; font-weight: bold; cursor: pointer;
        }
        #x-dt-batch-tag-btn:hover { background: #ffe066; }
        #x-devtools-right {
            width: 260px; flex-shrink: 0; overflow-y: auto;
            border-left: 1px solid #222; background: #0e0e0e;
            display: flex; flex-direction: column;
        }
        #x-devtools-right-header {
            padding: 8px 10px; font-size: 10px; color: #555; letter-spacing: 2px;
            text-transform: uppercase; border-bottom: 1px solid #1a1a1a;
            position: sticky; top: 0; background: #0e0e0e; z-index: 1;
        }
        #x-dt-sort-bar {
            display: flex; gap: 4px; padding: 6px 8px; background: #0e0e0e;
            border-bottom: 1px solid #1a1a1a; flex-shrink: 0;
            position: sticky; top: 36px; z-index: 1;
        }
        .dt-sort-btn {
            flex: 1; padding: 4px 0; font-size: 10px; cursor: pointer; color: #555;
            background: #1a1a1a; border: 1px solid #222; border-radius: 4px;
            text-align: center; transition: all 0.1s; user-select: none; white-space: nowrap;
        }
        .dt-sort-btn:hover { color: #aaa; border-color: #333; }
        .dt-sort-btn.active { color: gold; background: #1f1a00; border-color: #7a6115; }
        #x-dt-tag-list { overflow-y: auto; flex: 1; padding: 8px; display: flex; flex-direction: column; gap: 5px; }
        /* Physical tag shape — right-pointing label with a small hole */
        .dt-tag-item {
            display: flex; align-items: center; justify-content: space-between;
            padding: 6px 12px 6px 10px; cursor: pointer; border-radius: 3px 6px 6px 3px;
            position: relative; transition: filter 0.1s, transform 0.1s;
            clip-path: polygon(0 50%, 8px 0%, 100% 0%, 100% 100%, 8px 100%);
            padding-left: 18px;
        }
        .dt-tag-item::before {
            content: ''; position: absolute; left: 10px; top: 50%; transform: translateY(-50%);
            width: 5px; height: 5px; background: rgba(0,0,0,0.35); border-radius: 50%;
            z-index: 1;
        }
        .dt-tag-item:hover { filter: brightness(1.2); transform: translateX(1px); }
        .dt-tag-item.active { filter: brightness(1.35); transform: translateX(2px); box-shadow: 2px 0 8px rgba(255,215,0,0.3); outline: 1px solid rgba(255,215,0,0.5); }
        .dt-tag-item-name { font-size: 12px; font-weight: 600; color: rgba(255,255,255,0.9); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
        .dt-tag-item-count { font-size: 10px; color: rgba(255,255,255,0.55); font-family: monospace; flex-shrink: 0; margin-left: 6px; background: rgba(0,0,0,0.25); border-radius: 8px; padding: 1px 6px; }
        /* Ghost eicons in dev tools get a gold outline when selected */
        .ghost-eicon.dt-selected { outline: 2px solid gold; box-shadow: 0 0 8px rgba(255,215,0,0.4); }
        /* Synonym slave-to-master flash on chip */
        @keyframes synFlash { 0%{background:#9d7ef5;color:#fff;} 60%{background:#9d7ef5;color:#fff;} 100%{background:gold;color:#000;} }
        .chip.syn-flash { animation: synFlash 0.55s ease-out forwards; }
    `;

    // Style injection — deferred until document.head exists (script runs at document-start)
    const _injectStyles = () => {
        if (!document.head) { setTimeout(_injectStyles, 10); return; }
        document.head.appendChild(style);
        console.log('[XariahTagger] Styles injected');
    };
    _injectStyles();



    // --- 5. MODAL ENGINE ---

    let currentIconName = '';
    let activeTags = [];
    let _batchRemovedTags = new Set(); // tags explicitly removed during a batch edit session
    let _batchIconNames   = new Set(); // eicons in the current batch session (survives preview navigation)
    let _savedTagsSnapshot = new Set(); // tags as they were on disk when modal opened (for fade comparison)
    let _conflictCycle    = {};         // pos → current cycle index, for cycling through conflict occupants
    let _batchTagCache    = {};         // name → {tags, gridSpec, gridPos} — in-memory edits for the whole batch session
    let _previewStackCycle = {};        // posKey → current cycle index for stacked preview cells
    let _batchOriginalCommon = null;    // Set<tag> — stored-on-disk intersection when batch session started
    let _batchOriginalExtras = null;    // { [name]: Set<tag> } — per-eicon stored extras when batch started
    let _modalOpen = false;             // true while x-tag-modal-overlay is visible

    // Stored reference to the search input so we never rely on a fragile class selector.
    let searchInput = null;

    // Ghost phrases — verbatim quoted search terms extracted from the search bar.
    // Each entry is a plain string (without quotes) that must match a tag exactly.
    let _ghostPhrases = [];

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
                    syncTagToOverviewBatch(tag);
                    renderModalChips();
                    const input = document.getElementById('x-modal-input');
                    if (input) { input.value = ''; input.focus(); }
                    updateSuggestions(suggestionQuery);
                };
                rBox.appendChild(c);
            });

        // Tag library suggestions — 6 chips, shown when user is typing a query
        if (q) {
            Array.from(getUniqueTagSet())
                .filter(t => t.includes(q) && !activeTags.includes(t))
                .slice(0, 6)
                .forEach(tag => {
                    const c = document.createElement('div');
                    c.className = 'chip blue';
                    c.innerHTML = `${tag} +`;
                    c.addEventListener('mousedown', e => e.preventDefault());
                    c.onclick = () => {
                        activeTags.push(tag);
                        syncTagToOverviewBatch(tag);
                        renderModalChips();
                        const input = document.getElementById('x-modal-input');
                        if (input) { input.value = ''; input.focus(); }
                        updateSuggestions(suggestionQuery);
                    };
                    sBox.appendChild(c);
                });
        }

        // Association suggestions — always show up to 6 purple chips based on existing tags.
        // Not filtered by query: they reflect what's already tagged, not what's being typed.
        const assocBox = document.getElementById('x-assoc-suggestions');
        if (assocBox) {
            assocBox.innerHTML = '';
            getAssocSuggestions(activeTags, 6)
                .filter(t => !activeTags.includes(t))
                .slice(0, 6)
                .forEach(tag => {
                    const c = document.createElement('div');
                    c.className = 'chip purple';
                    c.innerHTML = `${tag} ✦`;
                    c.title = 'Often tagged together with your current tags';
                    c.addEventListener('mousedown', e => e.preventDefault());
                    c.onclick = () => {
                        activeTags.push(tag);
                        syncTagToOverviewBatch(tag);
                        renderModalChips();
                        const input = document.getElementById('x-modal-input');
                        if (input) { input.value = ''; input.focus(); }
                        updateSuggestions(suggestionQuery);
                    };
                    assocBox.appendChild(c);
                });
        }
    }

    // Parses a grid spec from storage, normalising missing '#' prefix automatically.
    const parseGridFromStorage = (spec) => spec
        ? (parseGridTag(spec.startsWith('#') ? spec : '#' + spec) || null)
        : null;

    const getModalInput = () => document.getElementById('x-modal-input');
    const refreshSuggestions = () => updateSuggestions(getModalInput()?.value.toLowerCase() || '');

    // Keeps _batchTagCache['__batch__'] in sync when a tag is added/replaced in batch
    // overview mode (currentIconName === '').  Must be called immediately after every
    // activeTags.push() so that batchSharedSet in renderModalChips is never stale.
    function syncTagToOverviewBatch(tag) {
        if (_batchIconNames.size === 0 || currentIconName) return;
        const bc = _batchTagCache['__batch__'];
        if (bc && !bc.tags.includes(tag)) bc.tags.push(tag);
    }

    // Full-replace variant used by Copy Last and any code that reassigns activeTags wholesale.
    function syncAllTagsToOverviewBatch() {
        if (_batchIconNames.size === 0 || currentIconName) return;
        if (_batchTagCache['__batch__']) {
            _batchTagCache['__batch__'].tags = [...activeTags];
        }
    }

    function renderModalChips() {
        const container = document.getElementById('x-active-chips');
        if (!container) return;
        container.innerHTML = '';

        // ── Build display list ───────────────────────────────────────────────
        // Each entry: { tag, partial }
        // partial = true  → tag is not present on every selected eicon
        // partial = false → tag applies to all selected (or only one eicon is selected)
        //
        // Domain = selected eicons that are in the batch, fallback to all batch members.
        // Helper: will `n` have `tag` after save?
        //   - currentIconName → check activeTags (not yet flushed to cache)
        //   - other batch members → check __batch__ union their extras cache

        const batchDomain = (() => {
            if (_batchIconNames.size === 0) return null;
            const sel = [...selectedIconNames].filter(n => _batchIconNames.has(n));
            return sel.length > 0 ? sel : [..._batchIconNames];
        })();

        const eiconWillHaveTag = (n, tag) => {
            if (n === currentIconName) return activeTags.includes(tag);
            const shared = _batchTagCache['__batch__']?.tags || [];
            const extras = _batchTagCache[n]?.tags || [];
            return shared.includes(tag) || extras.includes(tag);
        };

        let displayTags; // Array<{ tag: string, partial: boolean }>

        if (_batchIconNames.size > 0 && !currentIconName) {
            // ── Batch overview ───────────────────────────────────────────────
            // activeTags = __batch__ shared set → always non-partial.
            // Also surface per-eicon extras from selected eicons as partial chips.
            const sharedSet = new Set(activeTags);
            displayTags = activeTags.map(tag => ({ tag, partial: false }));

            const seen = new Set(activeTags);
            batchDomain.forEach(n => {
                (_batchTagCache[n]?.tags || []).forEach(tag => {
                    if (seen.has(tag)) return;
                    seen.add(tag);
                    const inAll = batchDomain.every(m => eiconWillHaveTag(m, tag));
                    displayTags.push({ tag, partial: !inAll });
                });
            });
        } else if (_batchIconNames.size > 0 && currentIconName && batchDomain && batchDomain.length > 1) {
            // ── Individual eicon inside batch, multiple selected ─────────────
            // Show the union of ALL domain eicons' tags so that extras belonging
            // to other selected eicons are visible (and correctly marked partial).
            const seen = new Set();
            const allTags = [];
            // Current eicon first (activeTags = __batch__ ∪ this eicon's extras)
            activeTags.forEach(t => { if (!seen.has(t)) { seen.add(t); allTags.push(t); } });
            // Other domain eicons: __batch__ already covered; add their per-eicon extras
            batchDomain.filter(n => n !== currentIconName).forEach(n => {
                (_batchTagCache[n]?.tags || []).forEach(t => {
                    if (!seen.has(t)) { seen.add(t); allTags.push(t); }
                });
            });
            displayTags = allTags.map(tag => ({
                tag,
                partial: !batchDomain.every(n => eiconWillHaveTag(n, tag))
            }));
        } else {
            // ── Single-eicon or individual with only itself selected ──────────
            displayTags = activeTags.map(tag => ({ tag, partial: false }));
        }

        // ── Render chips ─────────────────────────────────────────────────────
        displayTags.forEach(({ tag, partial: isPartial }) => {
            const chip = document.createElement('div');

            // isSaved: was this tag already on disk before this session opened?
            let isSaved;
            if (_batchIconNames.size > 0 && _batchOriginalCommon) {
                if (currentIconName && _batchOriginalExtras) {
                    // Individual eicon in batch
                    const origAll = new Set([
                        ..._batchOriginalCommon,
                        ...(_batchOriginalExtras[currentIconName] || new Set())
                    ]);
                    isSaved = origAll.has(tag);
                } else if (isPartial && _batchOriginalExtras) {
                    // Partial chip (overview or individual): saved if every domain eicon
                    // that will have it had it on disk already.
                    const eiconsThatHaveIt = (batchDomain || []).filter(n => eiconWillHaveTag(n, tag));
                    isSaved = eiconsThatHaveIt.length > 0 && eiconsThatHaveIt.every(n => {
                        if (n === currentIconName) {
                            const origAll = new Set([
                                ..._batchOriginalCommon,
                                ...(_batchOriginalExtras[n] || new Set())
                            ]);
                            return origAll.has(tag);
                        }
                        return (_batchOriginalExtras[n] || new Set()).has(tag)
                            || _batchOriginalCommon.has(tag);
                    });
                } else {
                    // Shared tag in overview
                    isSaved = _batchOriginalCommon.has(tag);
                }
            } else {
                isSaved = _savedTagsSnapshot.has(tag);
            }

            chip.className = 'chip yellow'
                + (isPartial ? ' partial' : '')
                + (!isSaved  ? ' unsaved' : '');
            chip.title = isPartial
                ? 'Not on all selected eicons — only some will have this tag'
                : (isSaved ? '' : 'Unsaved — click × to remove, or Save to apply');
            chip.innerHTML = `${tag} <span style="cursor:pointer">×</span>`;
            chip.onclick = () => {
                if (isPartial && !currentIconName) {
                    // Overview partial: remove from per-eicon extras of every domain eicon that has it
                    (batchDomain || []).forEach(n => {
                        const ec = _batchTagCache[n];
                        if (ec) ec.tags = ec.tags.filter(t => t !== tag);
                    });
                    // activeTags (shared set) doesn't contain this tag — no further action
                } else if (isPartial && currentIconName) {
                    // Individual partial: tag is in activeTags for this eicon but not all selected.
                    // Remove it from activeTags and from this eicon's cache only.
                    activeTags = activeTags.filter(t => t !== tag);
                    const ec = _batchTagCache[currentIconName];
                    if (ec) ec.tags = ec.tags.filter(t => t !== tag);
                    // Do NOT add to _batchRemovedTags — that would delete it from eicons that DO have it
                } else {
                    // Non-partial: remove from shared layer
                    activeTags = activeTags.filter(t => t !== tag);
                    if (_batchIconNames.size > 0) {
                        _batchRemovedTags.add(tag);
                        const bc = _batchTagCache['__batch__'];
                        if (bc) bc.tags = bc.tags.filter(t => t !== tag);
                    } else if (!currentIconName) {
                        _batchRemovedTags.add(tag);
                    }
                }
                renderModalChips();
                refreshSuggestions();
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

    // Detects if this eicon likely belongs to a multi-tile set (other eicons share its base name),
    // and if so renders an interactive 5×5 grid for choosing the set dimensions.
    // The grid is anchored at bottom-left. Hovering any cell sets the prospective rows×cols.
    // Clicking the #?×? label commits it as the active grid spec.
    // Smart grid hint — drag-to-size widget.
    // Top handle: drag up = more rows, down = fewer rows.
    // Right handle: drag right = more cols, left = fewer cols.
    // Changing cols auto-adjusts rows to ceil(count/cols) and vice versa.
    // Anchor icon ⚓ is fixed at bottom-left.
    // Extracts the numeric/alpha suffix after the group base for sorting.
    // Handles: trailing digits (abc1→1), separator+digits (abc-1→1),
    // row-col encoded digits (abc11→[1,1] treated as 11 for numeric sort),
    // trailing letters (abca→a).
    function extractSuffix(name) {
        const base = getGroupBase(name);
        return name.toLowerCase().slice(base.length).replace(/^[-_ ]/, '') || '';
    }

    // Sorts sibling names into a predictable grid order.
    // Detects row-col encoded pattern (e.g. abc11, abc12, abc21) and sorts by [row,col].
    // Falls back to natural alphanumeric sort.
    function sortSiblings(names) {
        // Check if all suffixes match a row-col pattern (1-2 digit row + 1-2 digit col)
        const rcPattern = /^(\d{1,2})(\d{1,2})$/;
        const rcSuffixes = names.map(n => extractSuffix(n).match(rcPattern));
        if (rcSuffixes.every(Boolean)) {
            return [...names].sort((a, b) => {
                const [, ar, ac] = rcSuffixes[names.indexOf(a)];
                const [, br, bc] = rcSuffixes[names.indexOf(b)];
                return (parseInt(ar) - parseInt(br)) || (parseInt(ac) - parseInt(bc));
            });
        }
        // Natural sort by suffix (handles letters, numbers, mixed)
        return [...names].sort((a, b) => extractSuffix(a).localeCompare(extractSuffix(b), undefined, { numeric: true }));
    }

    // After setting a grid spec for `currentIconName`, automatically saves grid data
    // for all detected siblings, assigning positions in sorted order (row-major).
    // Returns the position assigned to `currentIconName` so the modal can pre-select it.
    // Returns the set of natural (name-based) siblings for an eicon, excluding any
    // eicons that are already members of a forced grid group.
    // Checks DOM, gridData, and tag library.
    function getNaturalSiblings(name) {
        const base = getGroupBase(name);
        const forcedGroups = getAllForcedGrids();
        const isForced = (n) => forcedGroups.some(g => g.includes(n.toLowerCase()));
        const sibSet = new Set();
        // Only include this eicon itself if it's not in a forced group
        if (!isForced(name)) sibSet.add(name);
        findDeep(document, 'x-eiconview').forEach(el => {
            const n = getIconNameFromElement(el);
            if (n && getGroupBase(n) === base && !isForced(n)) sibSet.add(n);
        });
        Object.keys(getAllGridData()).forEach(n => { if (getGroupBase(n) === base && !isForced(n)) sibSet.add(n); });
        Object.keys(getAllTags()).forEach(n => { if (getGroupBase(n) === base && !isForced(n)) sibSet.add(n); });
        return sibSet;
    }

    function autoApplyGridToSiblings(spec) {
        const sibSet = getNaturalSiblings(currentIconName);
        const sorted = sortSiblings([...sibSet]);
        const total = spec.rows * spec.cols;
        sorted.forEach((name, idx) => {
            if (idx < total) saveIconGrid(name, spec.raw, idx);
        });
        return sorted.indexOf(currentIconName);
    }

    // Applies a grid spec to all natural siblings of a named group,
    // seeding with the provided names so off-screen/untagged eicons are included.
    // Saves a grid spec to all members of a forced group with sequential positions.
    // Returns the sorted member array.
    function applyGridToForcedGroup(fg, spec) {
        const sorted = sortSiblings(fg.group);
        const total  = spec.rows * spec.cols;
        sorted.forEach((n, idx) => { if (idx < total) saveIconGrid(n, spec.raw, idx); });
        return sorted;
    }

    function applyGridToNaturalGroup(seedNames, spec) {
        const first = seedNames[0] || '';
        const seedSet = getNaturalSiblings(first);
        seedNames.forEach(n => seedSet.add(n));
        const sorted = sortSiblings([...seedSet]);
        const total  = spec.rows * spec.cols;
        sorted.forEach((n, idx) => { if (idx < total) saveIconGrid(n, spec.raw, idx); });
        return sorted;
    }

    // Returns sibling eicons that share the same grid spec as `name`,
    // scoped to natural siblings only (not all eicons with that spec globally).
    function getSiblingsBySpec(name, spec) {
        const sibs = getNaturalSiblings(name);
        sibs.add(name);
        const matched = [...sibs].filter(n => getAllGridData()[n]?.spec === spec);
        if (!matched.includes(name)) matched.push(name);
        return matched;
    }

    // Shared helpers for the smart grid hint widget ────────────────────────
    // Returns the recommended initial [rows, cols] for a group of `count` eicons.
    // Odd count ≤ 7 → single row; even or count > 7 → square-ish.
    function suggestGridSize(count, MAX) {
        if (count <= 7 && count % 2 !== 0) return [1, count];
        const cols = Math.min(MAX, Math.ceil(Math.sqrt(count)));
        const rows = Math.min(MAX, Math.ceil(count / cols));
        return [rows, cols];
    }

    function buildSgCells(cellsEl, sizeLabel, rows, cols, cell, gap, count) {
        // count = actual number of eicons; cells beyond count are shown greyed
        cellsEl.style.gridTemplateColumns = `repeat(${cols}, ${cell}px)`;
        cellsEl.style.gridTemplateRows    = `repeat(${rows}, ${cell}px)`;
        cellsEl.style.gap = `${gap}px`;
        cellsEl.innerHTML = '';
        const total = rows * cols;
        for (let i = 0; i < total; i++) {
            const r = Math.floor(i / cols), c = i % cols;
            const div = document.createElement('div');
            const isAnchor = r === 0 && c === 0;
            const isOverflow = count != null && i >= count;
            div.className = 'sgc'
                + (isAnchor   ? ' anchor'   : '')
                + (isOverflow ? ' overflow' : '');
            if (isAnchor) div.textContent = '⚓';
            cellsEl.appendChild(div);
        }
        sizeLabel.textContent = `#${rows}×${cols}`;
    }

    function makeSgDragHandler(axis, getCols, getRows, setCols, setRows, MAX, STEP, rebuild) {
        return (startEvt) => {
            startEvt.preventDefault();
            const startX = startEvt.clientX, startY = startEvt.clientY;
            const startCols = getCols(), startRows = getRows();
            const onMove = (e) => {
                if (axis === 'x') {
                    const v = Math.max(1, Math.min(MAX, startCols + Math.round((e.clientX - startX) / STEP)));
                    if (v !== getCols()) { setCols(v); rebuild(); }
                } else {
                    const v = Math.max(1, Math.min(MAX, startRows + Math.round((e.clientY - startY) / STEP)));
                    if (v !== getRows()) { setRows(v); rebuild(); }
                }
            };
            const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        };
    }

    function renderSmartGridHint(name) {
        const hint  = document.getElementById('x-smart-grid-hint');
        if (!hint) return;

        if (activeGridSpec || !name) { hint.classList.remove('visible'); return; }

        // If this eicon is in a duplicate (&&) group, don't show a grid hint —
        // duplicate groups are for variant/alias eicons, not grid composites.
        if (getEiconDuplicateGroup(name)) { hint.classList.remove('visible'); return; }

        const base = getGroupBase(name);

        // Natural siblings — excludes eicons already in a forced group (Problem A fix)
        const siblings = getNaturalSiblings(name);

        // If this eicon itself is in a forced group, show forced-mode hint
        // using the exact group count, not an estimated sibling count (Problem B fix)
        const forcedResult = getEiconForcedGroup(name);
        if (forcedResult) {
            hint.classList.add('forced');
            forcedResult.group.forEach(n => siblings.add(n));
            // Override count to the exact forced group size — no guesswork
            const forcedCount = forcedResult.group.length;
            if (forcedCount < 2) { hint.classList.remove('visible'); return; }
            hint.classList.add('visible');

            const CELL = 22, GAP = 3, MAX = 5;
            const count = forcedCount;
            let [curRows, curCols] = suggestGridSize(count, MAX);

            // (falls through to shared widget setup below)
        }

        if (!forcedResult) {
            hint.classList.remove('forced');
            if (siblings.size < 2) { hint.classList.remove('visible'); return; }
            hint.classList.add('visible');
        }

        // ── Shared widget setup ───────────────────────────────────────────────
        const CELL = 22, GAP = 3, MAX = 5;
        const count = forcedResult ? forcedResult.group.length : siblings.size;
        let [curRows, curCols] = suggestGridSize(count, MAX);

        const cellsEl    = document.getElementById('x-sg-cells');
        const sizeLabel  = document.getElementById('x-sg-size-label');
        const topHandle  = document.getElementById('x-sg-bottom-handle');
        const rightHandle = document.getElementById('x-sg-right-handle');
        const confirmBtn = document.getElementById('x-sg-confirm');
        if (!cellsEl || !sizeLabel || !topHandle || !rightHandle || !confirmBtn) return;

        const STEP = CELL + GAP;
        const rebuild = () => buildSgCells(cellsEl, sizeLabel, curRows, curCols, CELL, GAP, count);
        const makeDragFn = (axis) => makeSgDragHandler(axis, () => curCols, () => curRows,
            (v) => { curCols = v; curRows = Math.min(MAX, Math.ceil(count / curCols)); },
            (v) => { curRows = v; curCols = Math.min(MAX, Math.ceil(count / curRows)); },
            MAX, STEP, rebuild);
        topHandle.onmousedown   = makeDragFn('y');
        rightHandle.onmousedown = makeDragFn('x');

        confirmBtn.onclick = () => {
            const spec = parseGridTag(`#${curRows}x${curCols}`);
            if (!spec) return;
            activeGridSpec = spec;
            if (forcedResult) {
                applyGridToForcedGroup(forcedResult, spec);
                activeGridPos = currentIconName ? (getAllGridData()[currentIconName]?.pos ?? null) : null;
            } else if (_batchIconNames.size > 0) {
                const sorted = sortSiblings([..._batchIconNames]);
                const total  = spec.rows * spec.cols;
                sorted.forEach((n, idx) => { if (idx < total) saveIconGrid(n, spec.raw, idx); });
                activeGridPos = currentIconName ? (getAllGridData()[currentIconName]?.pos ?? null) : null;
            } else {
                const myPos = autoApplyGridToSiblings(spec);
                activeGridPos = myPos >= 0 && myPos < spec.rows * spec.cols ? myPos : null;
            }
            hint.classList.remove('visible');
            renderGridArea();
            refreshPreview();
            refreshSuggestions();
        };

        rebuild();
    }

    function renderGridArea() {
        const chipSlot  = document.getElementById('x-grid-chip-slot');
        const gridArea  = document.getElementById('x-grid-area');
        const gridWidget = document.getElementById('x-grid-widget');
        if (!chipSlot || !gridArea || !gridWidget) return;

        chipSlot.innerHTML  = '';
        gridWidget.innerHTML = '';
        // Clear any previous lock note (not inside gridWidget so must be removed explicitly)
        gridArea.querySelectorAll('.x-grid-lock-note').forEach(el => el.remove());

        if (!activeGridSpec) {
            gridArea.style.display = 'none';
            return;
        }

        // Spec is active — hide the smart grid hint
        const hint = document.getElementById('x-smart-grid-hint');
        if (hint) hint.classList.remove('visible');

        // Red chip with remove button
        const chip = document.createElement('div');
        chip.className = 'chip red';
        chip.innerHTML = `${activeGridSpec.raw} <span style="cursor:pointer; margin-left:2px;">×</span>`;
        chip.querySelector('span').onclick = () => {
            activeGridSpec = null;
            activeGridPos  = null;
            if (!currentIconName) {
                // Batch mode: clear grid data for the full natural sibling set of every selected eicon,
                // AND all members of any forced groups represented in the selection.
                const gridD = getAllGridData();
                const toDelete = new Set();
                [...selectedIconNames].forEach(n => {
                    getNaturalSiblings(n).forEach(sib => toDelete.add(sib));
                    const fg = getEiconForcedGroup(n);
                    if (fg) fg.group.forEach(m => toDelete.add(m));
                });
                toDelete.forEach(n => { delete gridD[n]; });
                saveAllGridData(gridD);
            }
            renderGridArea();
            renderSmartGridHint(currentIconName);
            refreshSuggestions();
        };
        chipSlot.appendChild(chip);

        // --- Determine which eicons to show dots for ---
        // In batch mode: all _batchIconNames.
        // In single-eicon mode with a grid spec: expand to all group members sharing that spec,
        // so the user can see where every eicon sits and spot conflicts.
        const isBatchMode = _batchIconNames.size > 0;
        let batchNames;
        if (isBatchMode) {
            batchNames = [..._batchIconNames];
        } else if (currentIconName && activeGridSpec) {
            // Scope to the actual group — forced group or natural siblings only.
            // DO NOT match by spec string alone — many unrelated sets may share the same spec.
            const fg = getEiconForcedGroup(currentIconName);
            if (fg) {
                batchNames = fg.group.slice();
            } else {
                // Natural siblings — then intersect with those that actually have this spec saved
                const specRaw = activeGridSpec.raw;
                const allGrid = getAllGridData();
                batchNames = getSiblingsBySpec(currentIconName, specRaw);
            }
        } else {
            batchNames = currentIconName ? [currentIconName] : [];
        }
        const gridData    = getAllGridData();

        // Build a map: position → [eicon names] for all selected eicons
        const posOccupied = {}; // pos → array of names that claim it
        batchNames.forEach(n => {
            const gd = gridData[n];
            if (gd && gd.pos != null) {
                const p = parseInt(gd.pos, 10);
                if (!posOccupied[p]) posOccupied[p] = [];
                posOccupied[p].push(n);
            }
        });

        // Lock the grid if: in batch mode AND more than one eicon selected (not focused to a single)
        // OR if any position has multiple eicons claiming it (conflict)
        const hasConflict = Object.values(posOccupied).some(arr => arr.length > 1);
        const isLocked    = isBatchMode && batchNames.length > 1 && !currentIconName;

        // Grid widget
        const { rows, cols } = activeGridSpec;
        gridWidget.style.gridTemplateColumns = `repeat(${cols}, 28px)`;
        gridArea.style.display = 'block';

        if (isLocked || hasConflict) {
            const lockNote = document.createElement('div');
            lockNote.className = 'x-grid-lock-note';
            lockNote.style.cssText = 'font-size:10px; color:#888; margin-bottom:4px; font-style:italic;';
            lockNote.textContent = hasConflict
                ? '⚠ Conflicts (orange) — click to cycle through eicons sharing a position'
                : 'Click a preview eicon to assign its position';
            gridArea.insertBefore(lockNote, gridWidget);
        }

        // Reset stale cycle indices for positions that no longer have conflicts
        Object.keys(_conflictCycle).forEach(p => {
            if (!posOccupied[p] || posOccupied[p].length < 2) delete _conflictCycle[p];
        });

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const idx = r * cols + c;
                const cell = document.createElement('div');
                const isActivePos = activeGridPos === idx;
                const occupants   = posOccupied[idx] || [];
                const isConflict  = occupants.length > 1;

                cell.className = 'grid-cell'
                    + (isActivePos  ? ' selected'    : '')
                    + (isConflict   ? ' conflict'    : '');

                // Show the cycling-focused occupant name in the title
                const cycleIdx  = _conflictCycle[idx] || 0;
                const focusName = isConflict ? occupants[cycleIdx % occupants.length] : (occupants[0] || null);
                if (focusName === currentIconName && isConflict) cell.classList.add('cycle-active');
                cell.title = isConflict
                    ? `⚠ ${occupants.length} eicons here — click to cycle (${focusName})`
                    : `Row ${r + 1}, Col ${c + 1}`;

                // Show red dots — one per occupant, spread horizontally
                if (occupants.length > 0) {
                    cell.style.position = 'relative';
                    const dotW = 6, dotGap = 2;
                    const totalW = occupants.length * dotW + (occupants.length - 1) * dotGap;
                    occupants.forEach((_, di) => {
                        const dot = document.createElement('div');
                        const left = Math.round((28 - totalW) / 2) + di * (dotW + dotGap);
                        dot.style.cssText = `
                            position:absolute; bottom:2px; left:${left}px;
                            width:${dotW}px; height:${dotW}px; border-radius:50%;
                            background:${isConflict ? '#e67e22' : '#e74c3c'};
                            box-shadow:${isConflict ? '0 0 4px #e67e22' : 'none'};
                            pointer-events:none;`;
                        cell.appendChild(dot);
                    });
                }

                if (isConflict) {
                    // Conflict cell: each click cycles to the next occupant and focuses it
                    cell.onclick = () => {
                        const next = ((_conflictCycle[idx] || 0) + 1) % occupants.length;
                        _conflictCycle[idx] = next;
                        const targetName = occupants[next];
                        // Focus this eicon so the next grid-cell click reassigns its position
                        currentIconName = targetName;
                        selectedIconNames.clear();
                        selectedIconNames.add(targetName);
                        // Load its current state from cache or storage
                        const cached = _batchTagCache[targetName];
                        if (cached) {
                            activeTags     = [...cached.tags];
                            activeGridSpec = cached.gridSpec;
                            activeGridPos  = cached.gridPos;
                        } else {
                            const gd = getAllGridData()[targetName];
                            activeGridPos  = gd?.pos ?? null;
                        }
                        renderGridArea();
                        refreshPreview();
                        renderModalChips();
                        document.getElementById('x-modal-icon-name').textContent = targetName;
                    };
                } else if (!isLocked) {
                    cell.onclick = () => {
                        const newPos = activeGridPos === idx ? null : idx;
                        activeGridPos = newPos;
                        // Persist immediately so dots and preview update right away
                        if (currentIconName && activeGridSpec) {
                            saveIconGrid(currentIconName, activeGridSpec.raw, newPos);
                            // Also update the batch cache if we're in a session
                            if (_batchIconNames.has(currentIconName) && _batchTagCache[currentIconName]) {
                                _batchTagCache[currentIconName].gridPos = newPos;
                            }
                        }
                        renderGridArea();
                        refreshPreview();
                    };
                } else {
                    cell.style.cursor = 'default';
                    cell.style.opacity = '0.6';
                }

                gridWidget.appendChild(cell);
            }
        }
    }

    // Renders the left chip slot in the tag modal.
    // For a single eicon: shows grey && chip if in a dup group, grey ## chip if in a forced grid group.
    // For batch mode: shows chips if ALL selected are in the same group.
    // name = eicon name (single) or '' (batch).
    function renderLeftChipSlot(name) {
        const slot = document.getElementById('x-left-chip-slot');
        if (!slot) return;
        slot.innerHTML = '';

        // Check duplicate group
        let inDupGroup = false, dupGroupIdx = -1;
        // Check forced grid group
        let inForcedGroup = false, forcedGroupIdx = -1;

        if (name) {
            const dupResult = getEiconDuplicateGroup(name);
            if (dupResult) { inDupGroup = true; dupGroupIdx = dupResult.groupIdx; }
            const fResult = getEiconForcedGroup(name);
            if (fResult) { inForcedGroup = true; forcedGroupIdx = fResult.groupIdx; }
        } else {
            const names = [...selectedIconNames];
            if (names.length >= 2) {
                const firstDup = getEiconDuplicateGroup(names[0]);
                if (firstDup && names.every(n => firstDup.group.includes(n))) {
                    inDupGroup = true; dupGroupIdx = firstDup.groupIdx;
                }
                const firstForced = getEiconForcedGroup(names[0]);
                if (firstForced && names.every(n => firstForced.group.includes(n))) {
                    inForcedGroup = true; forcedGroupIdx = firstForced.groupIdx;
                }
            }
        }

        if (inDupGroup) {
            const chip = document.createElement('div');
            chip.className = 'chip grey';
            chip.title = 'In a linked set — click to manage';
            chip.textContent = '&&';
            chip.onclick = () => {
                const overlay = document.getElementById('x-tag-modal-overlay');
                if (overlay) overlay.style.display = 'none';
                stripSelectionVisuals();
                openDevTools('duplicates');
                setTimeout(() => scrollToDuplicateGroup(dupGroupIdx), 80);
            };
            slot.appendChild(chip);
        }

        if (inForcedGroup) {
            const chip = document.createElement('div');
            chip.className = 'chip vermillion';
            chip.title = 'In a forced grid set — click to manage';
            chip.textContent = '##';
            chip.onclick = () => {
                const overlay = document.getElementById('x-tag-modal-overlay');
                if (overlay) overlay.style.display = 'none';
                stripSelectionVisuals();
                openDevTools('forcedgrids');
            };
            slot.appendChild(chip);
        }
    }

    // Flushes the currently-visible eicon's unsaved state into _batchTagCache.
    // Called before switching eicons and before Save. outgoing = '' means batch-level.
    function flushBatchOutgoing() {
        if (_batchIconNames.size === 0) return;
        const out = currentIconName || '__batch__';
        if (out === '__batch__') {
            _batchTagCache['__batch__'] = { ..._batchTagCache['__batch__'], tags: [...activeTags] };
        } else {
            const bShared = new Set(_batchTagCache['__batch__']?.tags || []);
            const extras  = activeTags.filter(t => !bShared.has(t));
            _batchTagCache[out] = { ..._batchTagCache[out], tags: extras, gridSpec: activeGridSpec, gridPos: activeGridPos };
        }
    }

    // Loads grid spec+pos from storage into activeGridSpec/activeGridPos.
    function loadGridState(name) {
        const gd = getIconGrid(name);
        activeGridSpec = gd ? parseGridFromStorage(gd.spec) : null;
        activeGridPos  = gd ? (gd.pos ?? null) : null;
    }

    function openTagModal(name) {
      try {
        // If this eicon is not part of an active batch session, clear stale batch state.
        if (_batchIconNames.size > 0 && !_batchIconNames.has(name)) {
            _batchIconNames   = new Set();
            _batchTagCache    = {};
            _batchRemovedTags = new Set();
            _batchOriginalCommon = null;
            _batchOriginalExtras = null;
        }

        // In a batch session, keep an in-memory cache of all tag edits.
        // Switching eicons saves the current state into the cache rather than storage,
        // so nothing is lost until Save (persists all) or Cancel (discards all).
        if (_batchIconNames.size > 0) {
            flushBatchOutgoing();

            currentIconName = name;
            const batchTags = _batchTagCache['__batch__']?.tags || [];
            const cached = _batchTagCache[name];
            // activeTags = shared tags + this eicon's extras
            const extras = cached?.tags || [];
            activeTags = [...new Set([...batchTags, ...extras])];
            // Grid from cache or storage
            if (cached?.gridSpec) {
                activeGridSpec = cached.gridSpec;
                activeGridPos  = cached.gridPos;
            } else {
                const existingGrid = getIconGrid(name);
                if (existingGrid) {
                    activeGridSpec = parseGridFromStorage(existingGrid.spec);
                    activeGridPos  = existingGrid.pos ?? null;
                } else {
                    activeGridSpec = null;
                    activeGridPos  = null;
                }
                if (!_batchTagCache[name]) _batchTagCache[name] = { tags: [], gridSpec: activeGridSpec, gridPos: activeGridPos };
            }
        } else {
            // Single-eicon mode: load directly from storage as before
            currentIconName = name;
            const raw = getStoredTags(name);
            activeTags = raw ? raw.split(',').map(t => t.trim().toLowerCase()).filter(Boolean) : [];
            loadGridState(name);
        }

        if (!document.getElementById('x-tag-modal-overlay')) {
            const overlay = document.createElement('div');
            overlay.id = 'x-tag-modal-overlay';

            // Preview lives INSIDE the overlay as the first flex child — hides with it automatically
            const preview = document.createElement('div');
            preview.id = 'x-eicon-preview';
            overlay.appendChild(preview);

            const modalDiv = document.createElement('div');
            modalDiv.id = 'x-tag-modal';
            overlay.appendChild(modalDiv);
            modalDiv.innerHTML = `
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
                    <div id="x-suggestions" class="chip-container" style="margin-bottom:6px;"></div>
                    <div id="x-assoc-suggestions" class="chip-container" style="margin-bottom:10px;"></div>

                    <div id="x-input-row">
                        <div id="x-left-chip-slot"></div>
                        <input type="text" id="x-modal-input" placeholder="Search/Add tags… or #2x4 for a grid"
                            style="padding:10px; background:#000; color:#fff; border:1px solid #444; border-radius:4px; box-sizing:border-box;">
                        <div id="x-grid-chip-slot"></div>
                    </div>

                    <div id="x-smart-grid-hint">
                        <div id="x-smart-grid-hint-label">🔍 Possible grid set detected — drag to size, then confirm</div>
                        <div id="x-sg-sidebar">
                            <div id="x-sg-size-label">#1×1</div>
                            <button id="x-sg-confirm">Confirm ✓</button>
                        </div>
                        <div id="x-smart-grid-canvas">
                            <div id="x-sg-wrap">
                                <div id="x-sg-bottom-handle"></div>
                                <div id="x-sg-right-handle"></div>
                                <div id="x-sg-cells"></div>
                            </div>
                        </div>
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
                            clearSelection();
                        }
                        return;
                    }

                    // ## — forced grid group. Only valid in batch mode with 2+ eicons selected.
                    if (v === '##') {
                        if (_batchIconNames.size > 0 && selectedIconNames.size >= 2) {
                            addForcedGridGroup([...selectedIconNames]);
                            input.value = '';

                            // Auto-apply a smart grid immediately: odd≤7 → 1 row, otherwise square-ish
                            const fg = getEiconForcedGroup(currentIconName || [...selectedIconNames][0]);
                            if (fg) {
                                const cnt = fg.group.length;
                                const [aRows, aCols] = suggestGridSize(cnt, 5);
                                const spec = parseGridTag(`#${aRows}x${aCols}`);
                                if (spec) {
                                    activeGridSpec = spec;
                                    const sortedMembers = applyGridToForcedGroup(fg, spec);
                                    sortedMembers.forEach(n => {
                                        const gd = getAllGridData()[n];
                                        if (_batchTagCache[n]) _batchTagCache[n].gridSpec = spec;
                                        if (gd) activeGridPos = (n === currentIconName) ? gd.pos : activeGridPos;
                                    });
                                }
                            }
                            renderGridArea();
                            refreshPreview();
                            renderLeftChipSlot(currentIconName || '');
                            updateSuggestions('');
                        }
                        return;
                    }

                    // Check for grid tag format #NxM
                    const parsed = parseGridTag(v);
                    if (parsed) {
                        activeGridSpec = parsed;
                        input.value = '';
                        const hint = document.getElementById('x-smart-grid-hint');
                        if (hint) hint.classList.remove('visible');

                        if (_batchIconNames.size > 0) {
                            // Batch mode — save to all batch eicons regardless of which preview cell is focused
                            const batchArr = [..._batchIconNames];
                            const sorted = sortSiblings(batchArr);
                            const anyForced = sorted.some(n => getEiconForcedGroup(n));
                            if (anyForced) {
                                const fg0 = sorted.map(n => getEiconForcedGroup(n)).find(Boolean);
                                if (fg0) applyGridToForcedGroup(fg0, parsed);
                            } else if (sorted.length > 0) {
                                const total = parsed.rows * parsed.cols;
                                sorted.forEach((n, idx) => { if (idx < total) saveIconGrid(n, parsed.raw, idx); });
                            }
                            // Update activeGridPos for the currently-focused preview eicon if any
                            if (currentIconName) {
                                const gd = getAllGridData()[currentIconName];
                                activeGridPos = gd?.pos ?? null;
                            } else {
                                activeGridPos = null;
                            }
                        } else if (currentIconName) {
                            const fg = getEiconForcedGroup(currentIconName);
                            if (fg) {
                                const sortedMembers = applyGridToForcedGroup(fg, parsed);
                                const myIdx = sortedMembers.indexOf(currentIconName);
                                activeGridPos = myIdx >= 0 && myIdx < parsed.rows * parsed.cols ? myIdx : null;
                            } else if (getGroupBase(currentIconName) !== currentIconName) {
                                const myPos = autoApplyGridToSiblings(parsed);
                                activeGridPos = myPos >= 0 && myPos < parsed.rows * parsed.cols ? myPos : null;
                            } else {
                                activeGridPos = null;
                                saveIconGrid(currentIconName, parsed.raw, null);
                            }
                            if (fg || getGroupBase(currentIconName) !== currentIconName) {
                                // Position already saved by the group/sibling save above — read back for display
                                const gd = getAllGridData()[currentIconName];
                                activeGridPos = gd?.pos ?? null;
                            }
                        } else {
                            activeGridPos = null;
                        }
                        renderGridArea();
                        refreshPreview();
                        updateSuggestions('');
                        return;
                    }

                    if (!activeTags.includes(v)) {
                        const synMap = getSynonymMap();
                        const related = synMap.get(v);
                        let masterTag = v;
                        if (related) {
                            // Find which rule this slave belongs to — master is whichever
                            // term in the group has the others as its slaves
                            const allSynRules = getAllSynonyms();
                            const rule = allSynRules.find(r => r.slaves.includes(v));
                            if (rule) masterTag = rule.master;
                        }
                        if (!activeTags.includes(masterTag)) {
                            activeTags.push(masterTag);
                            syncTagToOverviewBatch(masterTag);
                            input.value = '';
                            renderModalChips();
                            updateSuggestions('');
                            // If substitution happened, flash the new chip purple
                            if (masterTag !== v) {
                                const chips = document.querySelectorAll('#x-active-chips .chip.yellow');
                                const newChip = [...chips].find(c => c.textContent.trim().startsWith(masterTag));
                                if (newChip) {
                                    newChip.classList.add('syn-flash');
                                    setTimeout(() => newChip.classList.remove('syn-flash'), 600);
                                }
                            }
                        } else {
                            input.value = '';
                        }
                    }
                }
            };

            // Copy-from-last button
            overlay.querySelector('#x-copy-last-btn').onclick = () => {
                if (!lastSavedEntry) return;
                activeTags = [...lastSavedEntry.tags];
                syncAllTagsToOverviewBatch();
                // Only copy the grid spec if there isn't one already set for this eicon.
                // If we auto-applied a grid position, preserve it — Copy Last is for tags only.
                if (!activeGridSpec) {
                    if (lastSavedEntry.gridSpec) {
                        activeGridSpec = parseGridTag(lastSavedEntry.gridSpec);
                        activeGridPos  = null; // position is intentionally not copied
                    } else {
                        activeGridSpec = null;
                        activeGridPos  = null;
                    }
                }
                renderModalChips();
                renderGridArea();
                updateSuggestions(suggestionQuery);
            };

            overlay.querySelector('#x-modal-cancel').onclick = () => {
                _batchRemovedTags    = new Set();
                _batchIconNames      = new Set();
                _batchTagCache       = {};
                _batchOriginalCommon = null;
                _batchOriginalExtras = null;
                _modalOpen = false;
                overlay.style.display = 'none';
                updateSelectionBar(); // restore bar
            };

            overlay.querySelector('#x-modal-save').onclick = () => {
                // Batch mode: _batchIconNames was populated by openBatchModal and persists
                // through preview navigation (which changes currentIconName).
                if (_batchIconNames.size > 0) {
                    // --- BATCH SAVE ---
                    flushBatchOutgoing();

                    const names      = [..._batchIconNames];
                    const sharedTags = _batchTagCache['__batch__']?.tags || [];
                    const lib = getAllTags();
                    names.forEach(name => {
                        const extras = _batchTagCache[name]?.tags || [];
                        const existingRaw = lib[name] || '';
                        const existingSet = new Set(existingRaw.split(',').map(t => t.trim().toLowerCase()).filter(Boolean));
                        _batchRemovedTags.forEach(t => existingSet.delete(t));
                        sharedTags.forEach(t => existingSet.add(t));
                        extras.forEach(t => existingSet.add(t));
                        if (existingSet.size > 0) lib[name] = [...existingSet].join(', ');
                        else delete lib[name];
                    });
                    saveFullLibrary(lib);
                    // Persist grid positions from cache for each eicon
                    names.forEach(name => {
                        const cached = _batchTagCache[name];
                        if (cached?.gridSpec) {
                            saveIconGrid(name, cached.gridSpec.raw, cached.gridPos ?? null);
                        } else if (activeGridSpec) {
                            // Fallback: use the shared batch grid spec if eicon wasn't individually visited
                            const gd = getAllGridData()[name];
                            if (!gd?.spec) saveIconGrid(name, activeGridSpec.raw, null);
                        }
                    });
                    activeTags.forEach(saveRecentTag);
                    lastSavedEntry = { tags: [...activeTags], gridSpec: activeGridSpec ? activeGridSpec.raw : null };
                    _batchRemovedTags    = new Set();
                    _batchIconNames      = new Set();
                    _batchTagCache       = {};
                    _batchOriginalCommon = null;
                    _batchOriginalExtras = null;
                    _modalOpen = false;
                    overlay.style.display = 'none';
                    clearSelection();
                    updateSelectionBar(); // restore bar after batch
                    if (searchInput) renderAllSearch(searchInput.value);
                    if (tagModeActive) applyTagMode();
                    if (_devToolsActiveTag) renderDevToolsEicons(_devToolsActiveTag);
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
                    _modalOpen = false;
                    overlay.style.display = 'none';
                    updateSelectionBar(); // restore bar (was hidden when modal opened)
                    if (searchInput) renderAllSearch(searchInput.value);
                    if (tagModeActive) applyTagMode();
                    if (_devToolsActiveTag) renderDevToolsEicons(_devToolsActiveTag);
                    if (_layoutMode === 'legacy') refreshLegacyButtons();
                }
            };
        }

        document.getElementById('x-modal-icon-name').textContent = name;
        document.getElementById('x-tag-modal-overlay').style.display = 'flex';
        _modalOpen = true;
        // Ensure the floating selection bar is hidden while the modal is open.
        const _modalSelBar = document.getElementById('x-selection-bar');
        if (_modalSelBar) _modalSelBar.classList.remove('visible');

        // Snapshot the tags already on disk — used to distinguish unsaved (faded) chips.
        // In batch mode we use _batchOriginalCommon / _batchOriginalExtras directly in
        // renderModalChips(), but also keep _savedTagsSnapshot correct as a fallback.
        if (_batchIconNames.size > 0 && _batchOriginalCommon) {
            const origExtras = (name && _batchOriginalExtras)
                ? (_batchOriginalExtras[name] || new Set())
                : new Set();
            _savedTagsSnapshot = new Set([..._batchOriginalCommon, ...origExtras]);
        } else {
            _savedTagsSnapshot = new Set(activeTags);
        }

        // Show copy-last button only when there's a previous entry to copy from
        const copyLastBtn = document.getElementById('x-copy-last-btn');
        if (copyLastBtn) copyLastBtn.style.display = lastSavedEntry ? 'inline-block' : 'none';

        suggestionQuery = '';
        const input = document.getElementById('x-modal-input');
        if (!input) { console.error('[XariahTagger] x-modal-input not found'); return; }
        input.value = '';
        input.focus();
        updateSuggestions('');
        renderModalChips();
        renderGridArea();
        renderSmartGridHint(name);
        renderLeftChipSlot(name);
        // If we're inside a batch session, keep the batch preview (showing all selected eicons)
        // but update the active cell to reflect the currently-editing eicon.
        // Only fall back to single-eicon preview when not in a batch session.
        if (_batchIconNames.size > 0) {
            refreshPreview();
        } else {
            renderEiconPreview(name);
        }
      } catch(e) {
        console.error('[XariahTagger] openTagModal error:', e);
      }
    }



    // Renders the eicon preview panel above the tag modal.
    // For a single eicon with no group: shows an enlarged GIF.
    // For a group (forced or natural): shows a clickable grid of all members.
    // Clicking a member switches the modal to editing that eicon.
    // Transitions from single-eicon modal to a full batch session using all members
    // currently visible in the eicon preview panel. Preserves any tags already added
    // in the single-eicon session by merging them into the batch shared layer.
    // Returns true if a batch was successfully initialised (≥2 members), false otherwise.
    function initBatchFromPreviewMembers() {
        if (_batchIconNames.size > 0) return true; // already in batch mode
        const panel = document.getElementById('x-eicon-preview');
        if (!panel) return false;

        // Collect names from all non-empty preview cells.
        // cell.title = "eiconname" or "eiconname (editing)" / "(selected)" — name is first token.
        const allPreviewNames = [];
        panel.querySelectorAll('.preview-cell:not(.empty)').forEach(pc => {
            const n = pc.title.split(' ')[0];
            if (n && !allPreviewNames.includes(n)) allPreviewNames.push(n);
        });
        // Ensure currentIconName is present even if its cell is missing from the query
        if (currentIconName && !allPreviewNames.includes(currentIconName)) {
            allPreviewNames.push(currentIconName);
        }
        if (allPreviewNames.length < 2) return false;

        // Compute the stored-on-disk intersection and per-eicon extras
        const storedSets = allPreviewNames.map(n => {
            const raw = getStoredTags(n);
            return new Set(raw ? raw.split(',').map(t => t.trim().toLowerCase()).filter(Boolean) : []);
        });
        const bCommon = new Set(storedSets[0]);
        storedSets.slice(1).forEach(s => { for (const t of [...bCommon]) { if (!s.has(t)) bCommon.delete(t); } });

        _batchTagCache    = {};
        _batchRemovedTags = new Set();
        allPreviewNames.forEach((n, i) => {
            const extras = [...storedSets[i]].filter(t => !bCommon.has(t));
            _batchTagCache[n] = { tags: extras, gridSpec: null, gridPos: null };
            const gd = getAllGridData()[n];
            if (gd?.spec) {
                _batchTagCache[n].gridSpec = parseGridFromStorage(gd.spec);
                _batchTagCache[n].gridPos  = gd.pos ?? null;
            }
        });

        // Carry over tags the user already added in the single-eicon session
        _batchTagCache['__batch__'] = { tags: [...bCommon], gridSpec: null, gridPos: null };
        // Tags added this session belonged only to the eicon being edited.
        // Keep them as that eicon's extras — do NOT promote to __batch__ (shared),
        // otherwise every eicon would appear to have them and partial would never fire.
        if (currentIconName && _batchTagCache[currentIconName]) {
            const addedThisSession = activeTags.filter(t => !bCommon.has(t));
            addedThisSession.forEach(t => {
                if (!_batchTagCache[currentIconName].tags.includes(t)) {
                    _batchTagCache[currentIconName].tags.push(t);
                }
            });
        }

        // Immutable snapshots of on-disk state for accurate isSaved chip colouring
        _batchOriginalCommon = new Set(bCommon);
        _batchOriginalExtras = {};
        allPreviewNames.forEach((n, i) => { _batchOriginalExtras[n] = storedSets[i]; });

        _batchIconNames = new Set(allPreviewNames);
        // Seed selectedIconNames with the eicon we were just editing so it is
        // included in the partial-detection domain from the very first ctrl-click.
        if (currentIconName) selectedIconNames.add(currentIconName);
        // The caller (ctrl-click / select-all) adds further members on top of this.

        // Switch to batch overview state
        activeTags    = [..._batchTagCache['__batch__'].tags];
        _savedTagsSnapshot = new Set(bCommon);
        currentIconName    = '';

        document.getElementById('x-modal-icon-name').textContent = `${_batchIconNames.size} eicons`;
        renderGridArea();
        renderLeftChipSlot('');
        updateSuggestions(suggestionQuery);
        return true;
    }

    // Module-level preview cell builder — shared by renderEiconPreview and renderEiconPreviewBatch.
    function makePreviewCell(cellName, isActive) {
        const cell = document.createElement('div');
        // Only show selected state when actually in a batch session — prevents stale
        // selectedIconNames entries from a previous session bleeding into single-eicon preview.
        const isSelected = _batchIconNames.size > 0 && selectedIconNames.has(cellName);
        cell.className = 'preview-cell'
            + (isActive   ? ' active'   : '')
            + (isSelected ? ' selected' : '');
        cell.title = cellName + (isActive ? ' (editing)' : isSelected ? ' (selected)' : '');
        const img = document.createElement('img');
        img.src = `https://static.f-list.net/images/eicon/${cellName}.gif`;
        img.alt = cellName;
        cell.appendChild(img);
        cell.onclick = (e) => {
            if (e.ctrlKey || e.metaKey) {
                // Ctrl+click: toggle this eicon in/out of selection.
                // In single-eicon mode with siblings visible, auto-promote to batch first
                // so that Save will apply to all selected, not just currentIconName.
                e.preventDefault();
                if (_batchIconNames.size === 0) initBatchFromPreviewMembers();
                if (selectedIconNames.has(cellName)) { selectedIconNames.delete(cellName); cell.classList.remove('selected'); }
                else { selectedIconNames.add(cellName); cell.classList.add('selected'); }
                updateSelectionBar();
                refreshPreview();
                renderModalChips();
            } else {
                // Plain click: navigate to (or stay on) this eicon.
                // In single-eicon mode with siblings, promote to batch first so the whole
                // group stays visible in preview rather than being replaced by a fresh session.
                if (_batchIconNames.size === 0 && currentIconName !== cellName) {
                    initBatchFromPreviewMembers();
                }
                // openTagModal handles both single and batch navigation correctly.
                selectedIconNames.clear();
                selectedIconNames.add(cellName);
                openTagModal(cellName);
            }
        };
        return cell;
    }

    // Builds a preview cell that holds multiple eicons stacked at the same position.
    // Clicking cycles through occupants; hovering reveals ghost layers beneath.
    function makeStackedPreviewCell(stackNames, activeCell, posKey) {
        const cycleIdx = _previewStackCycle[posKey] || 0;
        const topName  = stackNames[cycleIdx % stackNames.length];
        const isActive = stackNames.includes(activeCell);

        const cell = document.createElement('div');
        cell.className = 'preview-cell stacked conflict'
            + (isActive ? ' active' : '')
            + (stackNames.some(n => selectedIconNames.has(n)) ? ' selected' : '');
        cell.style.position = 'relative';
        cell.title = `${stackNames.length} eicons here — click to cycle (${topName})`;

        // Top image
        const topImg = document.createElement('img');
        topImg.src = `https://static.f-list.net/images/eicon/${topName}.gif`;
        topImg.alt = topName;
        topImg.style.cssText = 'width:100%; height:100%; object-fit:contain; display:block;';
        cell.appendChild(topImg);

        // Ghost layers (up to 2 extras) — revealed on hover via CSS
        stackNames.slice(1, 3).forEach((ghostName, gi) => {
            const ghost = document.createElement('div');
            ghost.className = 'stack-ghost';
            const ghostImg = document.createElement('img');
            ghostImg.src = `https://static.f-list.net/images/eicon/${ghostName}.gif`;
            ghostImg.style.cssText = 'width:100%; height:100%; object-fit:contain;';
            ghost.appendChild(ghostImg);
            cell.appendChild(ghost);
        });

        // Orange badge showing count
        const badge = document.createElement('div');
        badge.className = 'stack-badge';
        badge.textContent = `×${stackNames.length}`;
        cell.appendChild(badge);

        cell.onclick = (e) => {
            if (e.ctrlKey || e.metaKey) {
                // Ctrl: toggle all in stack
                const allSel = stackNames.every(n => selectedIconNames.has(n));
                stackNames.forEach(n => allSel ? selectedIconNames.delete(n) : selectedIconNames.add(n));
                updateSelectionBar();
                refreshPreview();
                return;
            }
            // Cycle to next occupant and focus it
            const next = ((_previewStackCycle[posKey] || 0) + 1) % stackNames.length;
            _previewStackCycle[posKey] = next;
            const targetName = stackNames[next];
            selectedIconNames.clear();
            selectedIconNames.add(targetName);
            openTagModal(targetName);
        };
        return cell;
    }

    // Refreshes the preview panel respecting current mode (batch vs single).
    function refreshPreview() {
        if (_batchIconNames.size > 0) {
            // Pass activeGridSpec directly — re-verifying from storage causes false negatives
            // when not all batch eicons fit in the grid or positions are null (forced groups).
            renderEiconPreviewBatch([..._batchIconNames].slice(0, 25), activeGridSpec || null);
        } else {
            renderEiconPreview(currentIconName);
        }
    }

    // Renders the preview for a batch selection — shows exactly the given names,
    // laid out using their stored grid positions if a shared spec is provided.
    // No sibling auto-discovery; what you selected is what you see.
    function renderEiconPreviewBatch(names, sharedSpec) {
        const panel = document.getElementById('x-eicon-preview');
        if (!panel) return;
        panel.style.cssText = 'display:flex; flex-direction:column; align-items:center; gap:4px;';
        panel.innerHTML = '';
        panel.classList.remove('visible');

        if (!names || names.length === 0) return;

        panel.classList.add('visible');

        const activeCell = currentIconName || null;

        // Inner container holds the cells — separate from panel so select-all sits below it
        const cellsWrap = document.createElement('div');

        if (sharedSpec && names.length > 1) {
            const gridData = getAllGridData();
            // posMap: pos → [name, ...] (array to handle conflicts)
            const posMap = {};
            names.forEach(n => {
                const gd = gridData[n];
                if (gd && gd.pos != null) {
                    const p = parseInt(gd.pos, 10);
                    if (!posMap[p]) posMap[p] = [];
                    posMap[p].push(n);
                }
            });
            const hasPos = Object.keys(posMap).length > 0;
            const rows = sharedSpec.rows, cols = sharedSpec.cols;

            cellsWrap.style.cssText = `display:grid; grid-template-columns:repeat(${cols},60px); grid-template-rows:repeat(${rows},60px); gap:4px;`;

            // Reset stale cycle indices for positions that no longer have stacks
            Object.keys(_previewStackCycle).forEach(k => {
                const arr = posMap[k];
                if (!arr || arr.length < 2) delete _previewStackCycle[k];
            });

            for (let i = 0; i < rows * cols; i++) {
                const occupants = hasPos ? (posMap[i] || []) : (names[i] ? [names[i]] : []);
                if (occupants.length > 1) {
                    cellsWrap.appendChild(makeStackedPreviewCell(occupants, activeCell, String(i)));
                } else if (occupants.length === 1) {
                    cellsWrap.appendChild(makePreviewCell(occupants[0], occupants[0] === activeCell));
                } else {
                    const empty = document.createElement('div');
                    empty.className = 'preview-cell empty';
                    cellsWrap.appendChild(empty);
                }
            }
        } else {
            cellsWrap.style.cssText = 'display:flex; flex-wrap:wrap; gap:4px; justify-content:center;';
            names.forEach(n => cellsWrap.appendChild(makePreviewCell(n, n === activeCell)));
        }

        panel.appendChild(cellsWrap);

        // Select-all toggle — below the cell grid, always visible when >1 eicons
        if (names.length > 1) {
            const allSelected = names.every(n => selectedIconNames.has(n));
            const btn = document.createElement('div');
            btn.style.cssText = 'font-size:9px; color:#888; text-align:center; width:100%; cursor:pointer; padding:2px 0; letter-spacing:0.5px; text-transform:uppercase;';
            btn.textContent = allSelected ? '✓ all selected' : '⊞ select all';
            btn.title       = allSelected ? 'Ctrl+click to deselect individually' : 'Select all eicons in this batch';
            btn.onclick = () => {
                if (allSelected) { names.forEach(n => selectedIconNames.delete(n)); }
                else             { names.forEach(n => selectedIconNames.add(n)); }
                updateSelectionBar();
                refreshPreview();
                renderModalChips();
            };
            panel.appendChild(btn);
        }
    }

    function renderEiconPreview(name) {
        const panel = document.getElementById('x-eicon-preview');
        if (!panel) return;
        // Clear all inline styles first, then content, then visibility class
        panel.style.cssText = '';
        panel.innerHTML = '';
        panel.classList.remove('visible');

        if (!name) return;

        // Determine group: forced first, then natural siblings
        const forcedResult = getEiconForcedGroup(name);
        const naturalSibs  = getNaturalSiblings(name);
        const hasGroup = forcedResult || naturalSibs.size >= 2;

        if (!hasGroup) {
            // Single eicon — show enlarged preview
            panel.classList.add('visible');
            const wrap = document.createElement('div');
            wrap.className = 'preview-single';
            const img = document.createElement('img');
            img.src = `https://static.f-list.net/images/eicon/${name}.gif`;
            img.alt = name;
            wrap.appendChild(img);
            panel.appendChild(wrap);
            return;
        }

        // Build ordered member list
        // Priority: forced group > spec-matched eicons in storage > natural DOM siblings
        let members;
        const gridData = getAllGridData();
        if (forcedResult) {
            members = forcedResult.group;
        } else {
            // Scope to natural siblings that actually have this spec — not ALL eicons with same spec
            const myGd  = gridData[name];
            const spec  = activeGridSpec?.raw || myGd?.spec;
            if (spec) {
                members = sortSiblings(getSiblingsBySpec(name, spec));
            } else {
                members = sortSiblings([...naturalSibs]);
            }
        }

        // Determine grid layout from activeGridSpec, then current eicon's stored spec, then any member
        const currentGd = gridData[name];
        const specEntry = activeGridSpec
            ? { spec: activeGridSpec.raw }
            : (currentGd?.spec ? currentGd : members.map(n => gridData[n]).find(d => d?.spec));
        let rows = 1, cols = members.length;
        if (specEntry) {
            const parsed = parseGridFromStorage(specEntry.spec);
            if (parsed) { rows = parsed.rows; cols = parsed.cols; }
        }

        panel.classList.add('visible');
        panel.style.cssText = 'display:flex; flex-direction:column; align-items:center; gap:4px;';

        const cellsWrap2 = document.createElement('div');

        // posMap: pos → [name, ...] to handle conflicts
        const posMap = {};
        members.forEach(n => {
            const gd = gridData[n];
            if (gd && gd.pos != null) {
                const p = parseInt(gd.pos, 10);
                if (!posMap[p]) posMap[p] = [];
                posMap[p].push(n);
            }
        });

        const total = rows * cols;
        const hasPositions = Object.keys(posMap).length > 0;

        if (hasPositions) {
            cellsWrap2.style.cssText = `display:grid; grid-template-columns:repeat(${cols},60px); grid-template-rows:repeat(${rows},60px); gap:4px;`;
            for (let i = 0; i < total; i++) {
                const occupants = posMap[i] || [];
                if (occupants.length > 1) {
                    cellsWrap2.appendChild(makeStackedPreviewCell(occupants, name, `sv_${i}`));
                } else if (occupants.length === 1) {
                    cellsWrap2.appendChild(makePreviewCell(occupants[0], occupants[0] === name));
                } else {
                    const empty = document.createElement('div');
                    empty.className = 'preview-cell empty';
                    cellsWrap2.appendChild(empty);
                }
            }
        } else {
            cellsWrap2.style.cssText = 'display:flex; flex-wrap:wrap; gap:4px; justify-content:center;';
            members.forEach(n => cellsWrap2.appendChild(makePreviewCell(n, n === name)));
        }
        panel.appendChild(cellsWrap2);

        // Select-all toggle — mirrors the one in renderEiconPreviewBatch.
        // Clicking promotes to a batch session so all siblings can be tagged together.
        if (members.length > 1) {
            const btn = document.createElement('div');
            btn.style.cssText = 'font-size:9px; color:#888; text-align:center; width:100%; cursor:pointer; padding:2px 0; letter-spacing:0.5px; text-transform:uppercase;';
            btn.textContent = '⊞ select all';
            btn.title = 'Tag all eicons in this group together';
            btn.onclick = () => {
                // Promote to batch using all visible group members, then select all
                const promoted = initBatchFromPreviewMembers();
                if (promoted) {
                    members.forEach(n => selectedIconNames.add(n));
                    updateSelectionBar();
                    refreshPreview();
                    renderModalChips();
                }
            };
            panel.appendChild(btn);
        }
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
        const specSource = members.find(m => m.spec);
        if (!specSource) return null;

        const specStr = specSource.spec.startsWith('#') ? specSource.spec : '#' + specSource.spec;
        const spec = parseGridTag(specStr);
        if (!spec) return null;

        const { rows, cols } = spec;

        // Map flat index → icon name
        // If all members have null positions (forced group awaiting manual placement),
        // fall back to sequential order so the composite still renders usefully.
        const posMap = {};
        members.forEach(m => {
            if (m.pos !== null && m.pos !== undefined) posMap[parseInt(m.pos, 10)] = m.name;
        });
        const hasExplicitPositions = Object.keys(posMap).length > 0;
        if (!hasExplicitPositions) {
            members.forEach((m, idx) => { if (m.name) posMap[idx] = m.name; });
        }

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

            // Build BBCode at click time. Alt+click = copy just this cell. Plain click = copy whole set.
            cell.onclick = (e) => {
                if (e.altKey) {
                    // Alt+click: copy just this single eicon
                    if (eiconName) {
                        navigator.clipboard.writeText(`[eicon]${eiconName}[/eicon]`);
                        const flash = document.createElement('div');
                        flash.textContent = '✓';
                        flash.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.7);color:gold;font-size:12px;pointer-events:none;border-radius:3px;';
                        cell.style.position = 'relative';
                        cell.appendChild(flash);
                        setTimeout(() => flash.remove(), 600);
                    }
                    return;
                }
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

        // Ctrl+Click on the composite toggles ALL named members into/out of the selection.
        // Uses capture phase so it fires before the cell's copy handler.
        const namedMembers = members.map(m => m.name).filter(Boolean);
        if (namedMembers.length > 0) {
            wrap.addEventListener('click', (e) => {
                if (!(e.ctrlKey || e.metaKey)) return;
                e.preventDefault();
                e.stopImmediatePropagation();
                // Toggle: if ALL are selected → deselect all; otherwise → select all
                const allSelected = namedMembers.every(n => selectedIconNames.has(n));
                if (allSelected) {
                    namedMembers.forEach(n => selectedIconNames.delete(n));
                    wrap.style.outline   = '';
                    wrap.style.boxShadow = '';
                    wrap.classList.remove('dt-selected');
                } else {
                    namedMembers.forEach(n => selectedIconNames.add(n));
                    wrap.style.outline   = '2px solid gold';
                    wrap.style.boxShadow = '0 0 8px rgba(255,215,0,0.4)';
                    wrap.classList.add('dt-selected');
                }
                updateSelectionBar();
            }, true);
        }

        return wrap;
    }

    // Renders either a grid composite (if the eicon has grid data and its group hasn't
    // been rendered yet in this section) or a plain ghost eicon.
    // renderedBases is a Set local to the current render section — pass a fresh one
    // per best-matches block and per tag category so composites aren't suppressed
    // across different result sections.
    function renderEiconOrComposite(name, renderedBases) {
        const gridData = getAllGridData();
        const gd = gridData[name.toLowerCase()];

        if (gd) {
            // Determine composite identity:
            // - Eicons in a forced group use "forced:<idx>" as the key so each forced group
            //   renders as its own composite, even when members share a name-base.
            // - Natural eicons use their name-base as before.
            const forcedResult = getEiconForcedGroup(name);
            const compositeKey = forcedResult ? `forced:${forcedResult.groupIdx}` : getGroupBase(name);

            if (renderedBases.has(compositeKey)) return null;
            renderedBases.add(compositeKey);

            let members;
            if (forcedResult) {
                // Forced group: include any member that has grid data (spec required, pos may be null)
                members = forcedResult.group
                    .filter(n => gridData[n] && gridData[n].spec)
                    .map(n => ({ name: n, ...gridData[n] }));
            } else {
                // Natural group: collect by name-base, excluding any forced-group members
                const base = getGroupBase(name);
                const forcedGroups = getAllForcedGrids();
                const isForced = (n) => forcedGroups.some(g => g.includes(n.toLowerCase()));
                members = Object.entries(gridData)
                    .filter(([n]) => getGroupBase(n) === base && !isForced(n))
                    .map(([n, d]) => ({ name: n, ...d }));
            }

            const composite = buildGridComposite(members);
            if (composite) {
                const anyCensored = members.some(m => m.name && isEiconCensored(m.name));
                if (anyCensored) {
                    composite.classList.add('x-censored');
                    composite.style.border      = '4px solid transparent';
                    composite.style.borderImage = 'repeating-linear-gradient(45deg,#111 0px,#111 8px,#f5c842 8px,#f5c842 16px) 4';
                    composite.querySelectorAll('img').forEach(img => { img.style.filter = 'blur(9px)'; });
                    const overlay = document.createElement('div');
                    overlay.className = 'censor-overlay';
                    overlay.innerHTML = '<span class="cx">✕</span><span class="cl">Blocked</span>';
                    composite.style.position = 'relative';
                    composite.appendChild(overlay);
                }
                return composite;
            }
        }

        return createGhost(name);
    }

    function createGhost(name) {
        const censored = isEiconCensored(name);
        const ghost = document.createElement('div');
        ghost.className = 'ghost-eicon' +
            (selectedIconNames.has(name) ? ' dt-selected' : '') +
            (censored ? ' x-censored' : '');
        ghost.dataset.tooltip = name;
        ghost.innerHTML = `
            <img src="https://static.f-list.net/images/eicon/${name}.gif">
            <span class="ghost-name">${name}</span>
            <div class="copy-flash">✓ Copied</div>`;

        if (censored) {
            const overlay = document.createElement('div');
            overlay.className = 'censor-overlay';
            overlay.innerHTML = '<span class="cx">✕</span><span class="cl">Blocked</span>';
            ghost.appendChild(overlay);
        }

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
            if (selectedIconNames.size > 0) clearSelection();
            flashCopied(ghost);
        });

        return ghost;
    }

    function renderAllSearch(query) {
        const bestAnchor    = document.getElementById('best-matches-content');
        const bestContainer = document.getElementById('best-matches-container');
        const listAnchor    = document.getElementById('tag-list-anchor');
        const topTagsEl     = document.getElementById('x-top-tags');

        // Preserve open collapse state across re-renders (e.g. after modal save)
        const openTags = new Set();
        listAnchor.querySelectorAll('.tag-content.open').forEach(content => {
            const header = content.previousElementSibling;
            if (header) openTags.add(header.querySelector('span')?.textContent?.toLowerCase());
        });

        listAnchor.innerHTML = '';
        bestAnchor.innerHTML = '';
        bestContainer.style.display = 'none';
        if (topTagsEl) {
            topTagsEl.classList.remove('visible');
            topTagsEl.innerHTML = '<span id="x-top-tags-label">Top</span>';
        }

        const hasGhost = _ghostPhrases.length > 0;
        const hasText  = query && query.trim().length > 0;
        if (!hasGhost && !hasText) return;

        const allKeywords = hasText ? query.toLowerCase().split(' ').filter(k => k.length > 0) : [];
        const positiveKws = allKeywords.filter(k => !k.startsWith('-'));
        const negativeKws = allKeywords.filter(k => k.startsWith('-')).map(k => k.slice(1)).filter(k => k.length > 0);

        // Split ghost phrases into positive (exact match required) and negative (exact exclusion)
        const posGhosts = _ghostPhrases.filter(e => !e.negative).map(e => e.phrase);
        const negGhosts = _ghostPhrases.filter(e =>  e.negative).map(e => e.phrase);

        if (positiveKws.length === 0 && posGhosts.length === 0) return;

        const expandedKwGroups = positiveKws.map(kw => expandKeyword(kw));
        const lib = getAllTags();
        const dupSkipSet = buildDupSkipSet(lib);

        const _wordBoundary = {};
        const kwTierScore = (kw, tag) => {
            if (tag === kw)          return 4;
            if (tag.startsWith(kw)) return 3;
            if (!_wordBoundary[kw]) _wordBoundary[kw] = new RegExp(`(?<![a-z])${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z])`);
            if (_wordBoundary[kw].test(tag)) return 2;
            if (tag.includes(kw))   return 1;
            return 0;
        };

        const isExcluded = (tagStr) => {
            const iconTags = tagStr.toLowerCase().split(',').map(t => t.trim());
            // Regular negative keywords (substring match)
            if (negativeKws.some(nkw => iconTags.some(tag => tag.includes(nkw)))) return true;
            // Negative ghost phrases (exact match only)
            if (negGhosts.some(phrase => iconTags.includes(phrase))) return true;
            return false;
        };

        // Score: positive ghost phrases are exact-only (score 4 each); keywords use tier scoring.
        const scored = [];
        for (const [name, tagStr] of Object.entries(lib)) {
            if (isExcluded(tagStr)) continue;
            if (dupSkipSet.has(name)) continue;
            const iconTags = tagStr.toLowerCase().split(',').map(t => t.trim());
            let score = 0, anyMatch = false;
            posGhosts.forEach(phrase => {
                if (iconTags.includes(phrase)) { score += 4; anyMatch = true; }
            });
            expandedKwGroups.forEach(kwGroup => {
                let best = 0;
                kwGroup.forEach(kw => {
                    iconTags.forEach(tag => { const s = kwTierScore(kw, tag); if (s > best) best = s; });
                });
                if (best > 0) { score += best; anyMatch = true; }
            });
            if (anyMatch) scored.push({ name, score });
        }

        // --- Top 5 tags ---
        if (scored.length > 0 && topTagsEl) {
            const tagFreq = {};
            scored.forEach(({ name }) => {
                (lib[name] || '').split(',').forEach(t => {
                    const tag = t.trim().toLowerCase();
                    if (tag) tagFreq[tag] = (tagFreq[tag] || 0) + 1;
                });
            });
            const top5 = Object.entries(tagFreq)
                .sort((a, b) => b[1] - a[1]).slice(0, 5).map(([tag]) => tag);
            if (top5.length > 0) {
                topTagsEl.classList.add('visible');
                topTagsEl.innerHTML = '<span id="x-top-tags-label">Top</span>';
                top5.forEach(tag => {
                    const chip = document.createElement('div');
                    chip.className = 'top-tag-chip';
                    chip.textContent = tag;
                    chip.title = tag.includes(' ') ? `Add as phrase "${tag}"` : `Add "${tag}" to search`;
                    chip.onclick = () => {
                        if (tag.includes(' ')) {
                            if (!_ghostPhrases.some(e => e.phrase === tag && !e.negative)) {
                                _ghostPhrases.push({ phrase: tag, negative: false });
                                renderGhostChipsFromState();
                            }
                        } else {
                            if (searchInput) {
                                const cur = searchInput.value.trim();
                                const words = cur.split(' ');
                                if (!words.includes(tag)) searchInput.value = cur ? `${cur} ${tag}` : tag;
                            }
                        }
                        if (searchInput) renderAllSearch(searchInput.value);
                    };
                    topTagsEl.appendChild(chip);
                });
            }
        }

        // --- Best Matches ---
        if (scored.length > 0) {
            bestContainer.style.display = 'block';
            const bestRendered = new Set();
            scored.sort((a, b) => b.score - a.score).slice(0, 30).forEach(res => {
                const el = renderEiconOrComposite(res.name, bestRendered);
                if (el) bestAnchor.appendChild(el);
            });
        }

        // --- Category sections ---
        const tagMap = {}, tagScore = {};
        for (const [eicon, tagString] of Object.entries(lib)) {
            if (isExcluded(tagString)) continue;
            if (dupSkipSet.has(eicon)) continue;
            tagString.split(',').forEach(t => {
                const tag = t.trim().toLowerCase();
                let best = 0;
                posGhosts.forEach(phrase => { if (tag === phrase) best = Math.max(best, 4); });
                expandedKwGroups.forEach(kwGroup => {
                    kwGroup.forEach(kw => { const s = kwTierScore(kw, tag); if (s > best) best = s; });
                });
                if (best > 0) {
                    if (!tagMap[tag]) { tagMap[tag] = []; tagScore[tag] = 0; }
                    tagMap[tag].push(eicon);
                    if (best > tagScore[tag]) tagScore[tag] = best;
                }
            });
        }

        Object.keys(tagMap)
            .sort((a, b) => (tagScore[b] - tagScore[a]) || a.localeCompare(b))
            .forEach(tag => {
                const cont = document.createElement('div');
                cont.className = 'tag-container';
                cont.innerHTML = `
                <div class="tag-header"><span>${tag.toUpperCase()}</span><span>▸</span></div>
                <div class="tag-content collapsed"></div>`;
                const header  = cont.querySelector('.tag-header');
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
                if (openTags.has(tag)) {
                    content.classList.add('open');
                    header.querySelector('span:last-child').textContent = '▾';
                }
                listAnchor.appendChild(cont);
            });
    }

    // Renders ghost phrase chips into #x-ghost-chips from module state.
    // Called from the top-tag chip onclick (which can't close over the local renderGhostChips).
    function renderGhostChipsFromState() {
        const container = document.getElementById('x-ghost-chips');
        if (!container) return;
        container.innerHTML = '';
        _ghostPhrases.forEach((entry, i) => {
            const chip = document.createElement('div');
            chip.className = 'search-ghost-chip' + (entry.negative ? ' negative' : '');
            chip.innerHTML = entry.negative
                ? `<span class="ghost-quote">-"</span>${entry.phrase}<span class="ghost-quote">"</span>`
                : `<span class="ghost-quote">"</span>${entry.phrase}<span class="ghost-quote">"</span>`;
            chip.title = entry.negative ? `Excluding phrase "${entry.phrase}"` : 'Click to edit';
            chip.onclick = () => {
                _ghostPhrases.splice(i, 1);
                renderGhostChipsFromState();
                if (searchInput) {
                    searchInput.value = `${entry.negative ? '-' : ''}"${entry.phrase}" ${searchInput.value}`.trim();
                    searchInput.focus();
                    renderAllSearch(searchInput.value);
                }
            };
            container.appendChild(chip);
        });
    }



    // --- 7. DEV TOOLS ---

    let _devToolsActiveTag = null;
    let _devToolsSortMode  = 'alpha-asc'; // alpha-asc | alpha-desc | count-asc | count-desc // currently selected tag in the right panel

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
                        <div class="dt-tab" data-tab="forcedgrids">🔲 Forced Grids</div>
                        <div class="dt-tab" data-tab="blocked">🚫 Blocked</div>
                    </div>
                    <div id="x-dt-browser" class="dt-tab-panel active">
                        <div id="x-devtools-left">
                            <div id="x-dt-batch-bar">
                                <span id="x-dt-batch-bar-count"></span>
                                <button id="x-dt-batch-tag-btn">🏷️ Tag Selected</button>
                            </div>
                            <div class="empty-state">Select a tag to browse its eicons →</div>
                        </div>
                        <div id="x-devtools-right">
                            <div id="x-devtools-right-header">Tags — click to browse</div>
                            <div id="x-dt-sort-bar">
                                <div class="dt-sort-btn active" data-sort="alpha-asc">A→Z</div>
                                <div class="dt-sort-btn" data-sort="alpha-desc">Z→A</div>
                                <div class="dt-sort-btn" data-sort="count-desc"># ↓</div>
                                <div class="dt-sort-btn" data-sort="count-asc"># ↑</div>
                            </div>
                            <div id="x-dt-tag-list"></div>
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
                    <div id="x-dt-forcedgrids" class="dt-tab-panel">
                        <div id="x-fg-panel" style="flex-direction:column; overflow-y:auto; padding:20px; gap:12px; display:flex;">
                            <div style="background:#1a0a00; border:1px solid #c0522a44; border-radius:8px; padding:14px 18px; flex-shrink:0;">
                                <div style="color:#c0522a; font-weight:bold; margin-bottom:6px; font-size:14px;">🔲 Forced Grid Sets</div>
                                <p style="font-size:13px; color:#666; margin:0;">
                                    Eicons in the same forced set form a grid composite regardless of their filenames.
                                    Select 2+ eicons and type <strong style="color:#ccc;">##</strong> in the batch tag modal to create a set.
                                    Deleting a set restores normal name-based grid detection.
                                </p>
                            </div>
                            <div id="x-fg-list"></div>
                        </div>
                    </div>
                    <div id="x-dt-blocked" class="dt-tab-panel">
                        <div id="x-blocked-panel">
                            <div id="x-blocked-form">
                                <h3>🚫 Blocked Tags</h3>
                                <p style="font-size:13px; color:#888; margin:0;">Any eicon tagged with a blocked tag is censored everywhere it appears — blurred with a hazard border. Blocked tags are <strong style="color:#eee;">never exported</strong> and are entirely personal to your browser.</p>
                                <div id="x-blocked-input-row">
                                    <input id="x-blocked-input" type="text" placeholder="Enter a tag to block…" autocomplete="off">
                                    <button id="x-blocked-add-btn">Block Tag</button>
                                </div>
                            </div>
                            <div id="x-blocked-list-wrap">
                                <h3>Active Blocked Tags</h3>
                                <div id="x-blocked-list"></div>
                            </div>
                        </div>
                    </div>
                </div>`;
            document.body.appendChild(overlay);

            overlay.querySelector('#x-devtools-close').onclick = () => closeDevTools();
            overlay.addEventListener('click', (e) => { if (e.target === overlay) closeDevTools(); });
            overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDevTools(); });

            overlay.querySelector('#x-dt-batch-tag-btn').onclick = () => openBatchModal();

            // Tab switching
            overlay.querySelectorAll('.dt-tab').forEach(tab => {
                tab.onclick = () => {
                    switchDevTab(tab.dataset.tab);
                };
            });

            // Sort buttons
            overlay.querySelectorAll('.dt-sort-btn').forEach(btn => {
                btn.onclick = () => {
                    overlay.querySelectorAll('.dt-sort-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    _devToolsSortMode = btn.dataset.sort;
                    renderDevToolsTagList(overlay.querySelector('#x-devtools-search').value.toLowerCase().trim());
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

            // Custom event fired by editSynonymRule to pre-populate slaves from an existing rule
            slaveInput.addEventListener('x-syn-load-slaves', (e) => {
                _synSlaves = [...e.detail];
                renderSlaveChips();
                refreshAddBtn();
            });

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

            // Blocked tags input
            const blockedInput = overlay.querySelector('#x-blocked-input');
            const blockedAddBtn = overlay.querySelector('#x-blocked-add-btn');
            const doAddBlocked = () => {
                const v = blockedInput.value.trim().toLowerCase();
                if (!v) return;
                addBlockedTag(v);
                blockedInput.value = '';
                renderBlockedTagsList();
                applyCensorMode();
            };
            blockedInput.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); doAddBlocked(); } };
            blockedAddBtn.onclick = doAddBlocked;
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
        const panelMap = { browser: 'x-dt-browser', synonyms: 'x-dt-synonyms', duplicates: 'x-dt-duplicates', forcedgrids: 'x-dt-forcedgrids', blocked: 'x-dt-blocked' };
        overlay.querySelectorAll('.dt-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
        overlay.querySelectorAll('.dt-tab-panel').forEach(p => p.classList.remove('active'));
        const panelEl = overlay.querySelector('#' + (panelMap[tabName] || 'x-dt-browser'));
        if (panelEl) panelEl.classList.add('active');
        overlay.querySelector('#x-devtools-search').style.display = tabName === 'browser' ? '' : 'none';
        if (tabName === 'synonyms')    renderSynonymRules();
        if (tabName === 'duplicates')  renderDuplicatesList();
        if (tabName === 'forcedgrids') renderForcedGridsList();
        if (tabName === 'blocked')     renderBlockedTagsList();
        if (tabName === 'browser')    renderDevToolsTagList('');
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
                <div style="display:flex;gap:6px;flex-shrink:0;">
                    <button class="syn-edit-btn" style="background:none;border:1px solid #555;color:#888;border-radius:4px;padding:4px 10px;font-size:12px;cursor:pointer;transition:border-color .15s,color .15s;" data-idx="${idx}">✏️ Edit</button>
                    <button class="syn-delete-btn" data-idx="${idx}">🗑 Delete</button>
                </div>`;
            row.querySelector('.syn-delete-btn').onclick = () => deleteSynonymRule(idx);
            row.querySelector('.syn-edit-btn').onclick   = () => editSynonymRule(idx);
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

    // Loads a synonym rule back into the Add Synonym form for editing.
    // Removes the rule from the store immediately — the user re-adds it (possibly
    // with changes and the Clean option) via the normal Add flow.
    function editSynonymRule(idx) {
        const rules = getAllSynonyms();
        const rule = rules[idx];
        if (!rule) return;

        // Remove the rule from the list — it will be re-added on confirm
        rules.splice(idx, 1);
        saveSynonyms(rules);
        invalidateSynonymMap();

        // Populate the form fields
        const masterInput  = document.getElementById('x-syn-master');
        const slaveInput   = document.getElementById('x-syn-slave-input');
        const slaveChipsEl = document.getElementById('x-syn-slave-chips');
        const addBtn       = document.getElementById('x-syn-add-btn');
        if (!masterInput || !slaveChipsEl || !addBtn) return;

        masterInput.value = rule.master;

        // Re-build the slave chip array by dispatching the same keyboard events
        // the user would have used — simpler to just directly manipulate the chips.
        // We reach into the closure via a custom event on the input.
        const editEvent = new CustomEvent('x-syn-load-slaves', { detail: rule.slaves });
        slaveInput.dispatchEvent(editEvent);

        addBtn.disabled = false;

        // Scroll the synonyms panel to the top so the form is visible
        const panel = document.getElementById('x-syn-panel');
        if (panel) panel.scrollTop = 0;

        // Re-render the list to reflect the removal
        renderSynonymRules();

        // Focus the master input
        masterInput.focus();
        masterInput.select();
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

    // Renders the blocked tags list in the Blocked tab.
    function renderBlockedTagsList() {
        const container = document.getElementById('x-blocked-list');
        if (!container) return;
        container.innerHTML = '';
        const tags = getAllBlockedTags();
        if (tags.length === 0) {
            container.innerHTML = '<div style="color:#444; font-size:13px; font-style:italic; padding:8px 0;">No blocked tags yet.</div>';
            return;
        }
        tags.forEach(tag => {
            const row = document.createElement('div');
            row.className = 'blocked-tag-row';
            row.innerHTML = `
                <span class="blocked-tag-name">${tag}</span>
                <button class="blocked-remove-btn">✕ Unblock</button>`;
            row.querySelector('.blocked-remove-btn').onclick = () => {
                removeBlockedTag(tag);
                renderBlockedTagsList();
                applyCensorMode();
            };
            container.appendChild(row);
        });
    }
    // Generic group list renderer used by both Duplicates and Forced Grids tabs.
    // opts: { containerId, getAllFn, removeFn, rerenderFn, emptyMsg, deleteConfirm,
    //         accentColor, bgColor, headerBg, bodyBg, labelSingular, labelPlural,
    //         deleteBtnClass, toggleClass }
    function renderGroupList(opts) {
        const container = document.getElementById(opts.containerId);
        if (!container) return;
        container.innerHTML = '';
        const groups = opts.getAllFn();
        if (groups.length === 0) {
            container.innerHTML = `<div style="color:#444; font-size:13px; font-style:italic; padding:12px 0;">${opts.emptyMsg}</div>`;
            return;
        }
        groups.forEach((group, idx) => {
            const wrap = document.createElement('div');
            wrap.style.cssText = `background:${opts.bgColor}; border:1px solid ${opts.accentColor}33; border-radius:8px; overflow:hidden; margin-bottom:8px;`;
            if (opts.dupIdx) wrap.dataset.dupIdx = idx;

            const header = document.createElement('div');
            header.style.cssText = `display:flex; justify-content:space-between; align-items:center; padding:10px 16px; cursor:pointer; user-select:none; background:${opts.headerBg};`;
            const firstName = group[0] || `group-${idx + 1}`;
            const extras = group.length - 1;
            header.innerHTML = `
                <span style="color:#ccc; font-size:13px;"><strong style="color:${opts.accentColor};">${firstName}</strong> <span style="color:#555;font-size:11px;">+${extras} ${extras === 1 ? opts.labelSingular : opts.labelPlural}</span> &nbsp;<span style="color:#444; font-size:11px;">${group.slice(1,4).join(', ')}${group.length > 4 ? '…' : ''}</span></span>
                <div style="display:flex; gap:8px; align-items:center;">
                    <button class="${opts.deleteBtnClass}" style="background:none; border:1px solid #444; color:#666; border-radius:4px; padding:3px 10px; font-size:11px; cursor:pointer;">🗑 ${opts.deleteLabel}</button>
                    <span class="${opts.toggleClass}" style="color:#555; font-size:14px;">▸</span>
                </div>`;

            const body = document.createElement('div');
            body.style.cssText = `display:none; padding:10px; background:${opts.bodyBg}; grid-template-columns:repeat(auto-fill,85px); grid-auto-rows:85px; grid-auto-flow:row dense; gap:4px;`;

            header.onclick = (e) => {
                if (e.target.classList.contains(opts.deleteBtnClass)) return;
                const open = body.style.display !== 'grid';
                body.style.display = open ? 'grid' : 'none';
                header.querySelector('.' + opts.toggleClass).textContent = open ? '▾' : '▸';
                if (open && !body._populated) {
                    body._populated = true;
                    const rendered = new Set();
                    group.forEach(name => { const el = renderEiconOrComposite(name, rendered); if (el) body.appendChild(el); });
                }
            };

            header.querySelector('.' + opts.deleteBtnClass).onclick = () => {
                if (!confirm(opts.deleteConfirm(group))) return;
                opts.removeFn(idx);
                opts.rerenderFn();
            };

            wrap.appendChild(header);
            wrap.appendChild(body);
            container.appendChild(wrap);
        });
    }

    function renderDuplicatesList() {
        renderGroupList({
            containerId: 'x-dup-list', getAllFn: getAllDuplicates, removeFn: removeDuplicateGroup,
            rerenderFn: renderDuplicatesList, dupIdx: true,
            accentColor: 'gold', bgColor: '#1a1a1a', headerBg: '#1f1f1f', bodyBg: '#111',
            labelSingular: 'duplicate', labelPlural: 'duplicates',
            deleteBtnClass: 'dup-delete-btn', toggleClass: 'dup-toggle', deleteLabel: 'Delete Group',
            emptyMsg: 'No duplicate groups defined yet. Select 2+ eicons and type && in the batch tag modal.',
            deleteConfirm: (g) => `Delete duplicate group containing ${g.length} eicons?\n\nThis removes the grouping rule. Eicons and their tags are not changed.`,
        });
    }

    function renderForcedGridsList() {
        renderGroupList({
            containerId: 'x-fg-list', getAllFn: getAllForcedGrids, removeFn: removeForcedGridGroup,
            rerenderFn: renderForcedGridsList,
            accentColor: '#c0522a', bgColor: '#1a0e00', headerBg: '#1f1200', bodyBg: '#110800',
            labelSingular: 'eicon', labelPlural: 'eicons',
            deleteBtnClass: 'fg-delete-btn', toggleClass: 'fg-toggle', deleteLabel: 'Delete Set',
            emptyMsg: 'No forced grid sets defined yet. Select 2+ eicons and type ## in the batch tag modal.',
            deleteConfirm: (g) => `Delete forced grid set containing ${g.length} eicons?\n\nThis removes the forced grouping. The eicons and their tags are not changed.\nNormal name-based grid detection will apply again.`,
        });
    }

    // Deterministic colour from tag string — cycles through a palette.
    function renderForcedGridsList() {
        const container = document.getElementById('x-fg-list');
        if (!container) return;
        container.innerHTML = '';
        const groups = getAllForcedGrids();
        if (groups.length === 0) {
            container.innerHTML = '<div style="color:#444; font-size:13px; font-style:italic; padding:12px 0;">No forced grid sets defined yet. Select 2+ eicons and type ## in the batch tag modal.</div>';
            return;
        }
        groups.forEach((group, idx) => {
            const wrap = document.createElement('div');
            wrap.style.cssText = 'background:#1a0e00; border:1px solid #c0522a33; border-radius:8px; overflow:hidden; margin-bottom:8px;';

            const header = document.createElement('div');
            header.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:10px 16px; cursor:pointer; user-select:none; background:#1f1200;';
            const firstName = group[0] || `forced-${idx + 1}`;
            header.innerHTML = `
                <span style="color:#ccc; font-size:13px;"><strong style="color:#c0522a;">${firstName}</strong> <span style="color:#555; font-size:11px;">+${group.length - 1} eicon${group.length - 1 === 1 ? '' : 's'}</span> &nbsp;<span style="color:#444; font-size:11px;">${group.slice(1,4).join(', ')}${group.length > 4 ? '…' : ''}</span></span>
                <div style="display:flex; gap:8px; align-items:center;">
                    <button class="fg-delete-btn" style="background:none; border:1px solid #444; color:#666; border-radius:4px; padding:3px 10px; font-size:11px; cursor:pointer;">🗑 Delete Set</button>
                    <span class="fg-toggle" style="color:#555; font-size:14px;">▸</span>
                </div>`;

            const body = document.createElement('div');
            body.style.cssText = 'display:none; padding:10px; background:#110800; grid-template-columns:repeat(auto-fill,85px); grid-auto-rows:85px; grid-auto-flow:row dense; gap:4px;';

            header.onclick = (e) => {
                if (e.target.classList.contains('fg-delete-btn')) return;
                const open = body.style.display !== 'grid';
                body.style.display = open ? 'grid' : 'none';
                header.querySelector('.fg-toggle').textContent = open ? '▾' : '▸';
                if (open && !body._populated) {
                    body._populated = true;
                    const rendered = new Set();
                    group.forEach(name => {
                        const el = renderEiconOrComposite(name, rendered);
                        if (el) body.appendChild(el);
                    });
                }
            };

            header.querySelector('.fg-delete-btn').onclick = () => {
                if (!confirm(`Delete forced grid set containing ${group.length} eicons?\n\nThis removes the forced grouping. The eicons and their tags are not changed.\nNormal name-based grid detection will apply again.`)) return;
                removeForcedGridGroup(idx);
                renderForcedGridsList();
            };

            wrap.appendChild(header);
            wrap.appendChild(body);
            container.appendChild(wrap);
        });
    }

    // Deterministic colour from tag string — cycles through a palette.
    const TAG_PALETTE = [
        '#c0392b','#e67e22','#f39c12','#27ae60','#16a085',
        '#2980b9','#8e44ad','#d35400','#1abc9c','#c0392b',
        '#6c3483','#1e8bc3','#2ecc71','#e74c3c','#3498db',
    ];
    function tagColour(tag) {
        let h = 0;
        for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) & 0xfffffff;
        return TAG_PALETTE[h % TAG_PALETTE.length];
    }

    // Builds the right-panel tag list with physical tag shapes, colour, and sort.
    function renderDevToolsTagList(filter) {
        const right = document.getElementById('x-devtools-right');
        if (!right) return;
        const header  = right.querySelector('#x-devtools-right-header');
        const listEl  = right.querySelector('#x-dt-tag-list');
        if (!header || !listEl) return;
        listEl.innerHTML = '';

        const lib = getAllTags();
        const tagCounts = {};
        for (const tagStr of Object.values(lib)) {
            tagStr.split(',').forEach(t => {
                const tag = t.trim().toLowerCase();
                if (tag) tagCounts[tag] = (tagCounts[tag] || 0) + 1;
            });
        }

        let tags = Object.keys(tagCounts);
        const filtered = filter ? tags.filter(t => t.includes(filter)) : tags;

        // Apply sort
        filtered.sort((a, b) => {
            switch (_devToolsSortMode) {
                case 'alpha-desc':  return b.localeCompare(a);
                case 'count-desc':  return tagCounts[b] - tagCounts[a] || a.localeCompare(b);
                case 'count-asc':   return tagCounts[a] - tagCounts[b] || a.localeCompare(b);
                default:            return a.localeCompare(b); // alpha-asc
            }
        });

        header.textContent = filter
            ? `${filtered.length} of ${Object.keys(tagCounts).length} tags`
            : `${Object.keys(tagCounts).length} tags`;

        // Sync sort button active state (in case tab was switched and re-rendered)
        right.querySelectorAll('.dt-sort-btn').forEach(b =>
            b.classList.toggle('active', b.dataset.sort === _devToolsSortMode));

        filtered.forEach(tag => {
            const colour = tagColour(tag);
            const item = document.createElement('div');
            item.className = 'dt-tag-item' + (tag === _devToolsActiveTag ? ' active' : '');
            item.style.background = colour;
            item.innerHTML = `
                <span class="dt-tag-item-name">${tag}</span>
                <span class="dt-tag-item-count">${tagCounts[tag]}</span>`;
            item.onclick = () => {
                _devToolsActiveTag = tag;
                listEl.querySelectorAll('.dt-tag-item').forEach(r => r.classList.remove('active'));
                item.classList.add('active');
                renderDevToolsEicons(tag);
            };
            listEl.appendChild(item);
        });

        if (filtered.length === 0) {
            const empty = document.createElement('div');
            empty.style.cssText = 'padding:20px 10px; color:#444; font-size:13px; font-style:italic;';
            empty.textContent = 'No tags match that filter.';
            listEl.appendChild(empty);
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
    const createDevGhost = (name) => createGhost(name); // alias: dev panel never has censored eicons



    // --- 8. EXPLORER PANEL ---

    // Shows a one-time welcome popup the first time XariahTagger runs (or after a
    // localStorage clear). Sentinel key x_welcomed prevents it appearing again.
    function showWelcomeModal() {
        if (localStorage.getItem('x_welcomed')) return;
        localStorage.setItem('x_welcomed', '1');

        const overlay = document.createElement('div');
        overlay.id = 'x-welcome-overlay';
        overlay.innerHTML = `
            <div id="x-welcome-box">
                <h2>🏷️ Welcome to XariahTagger</h2>
                <div class="sub">v${SCRIPT_VERSION} · Alpha</div>
                <p>XariahTagger adds a personal tagging and search system on top of Xariah. Hover any eicon to tag it, then search your tags to find it instantly.</p>
                <p>
                    <strong>Quick start:</strong> hover an eicon → click 🏷️ → add tags → Save.
                    Then type in the search bar at the top to find it.
                </p>
                <p>
                    <strong>📡 Developer tags:</strong> click the <strong>📡</strong> button in the tag bar to pull a curated starter library — a great way to hit the ground running without tagging everything from scratch.
                </p>
                <p>
                    Need help? The full <a href="https://mojojohoe.github.io/F-List-Eicon-Categories/" target="_blank">User Guide</a>
                    covers every feature — tagging, batch selection, grid sets, duplicates, synonyms, blocked tags, and more.
                </p>
                <p style="font-size:12px; color:#555; margin-bottom:0;">
                    If you're seeing this a second time, your localStorage was cleared — your tags were lost with it.
                    Use <strong style="color:#aaa;">💾 Export</strong> regularly to keep a backup, and re-import if needed.
                </p>
                <button id="x-welcome-btn">Let's go →</button>
            </div>`;
        document.body.appendChild(overlay);
        overlay.querySelector('#x-welcome-btn').onclick = () => overlay.remove();
    }

    function initExplorer() {
        if (document.getElementById('x-tag-manager')) return;
        showWelcomeModal();

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
                <div id="x-search-wrap" onclick="this.querySelector('.filter-input')?.focus()">
                    <div id="x-ghost-chips"></div>
                    <input type="text" class="filter-input" placeholder="Search tags… or &quot;exact phrase&quot;">
                </div>
            </div>
            <div id="x-tag-mode-banner">🔴 Tag Mode active — eicons with tags are hidden</div>
            <div id="x-explorer-body">
                <div id="x-top-tags"><span id="x-top-tags-label">Top</span></div>
                <div id="best-matches-container">
                    <div class="best-matches-header">✨ Best Matches</div>
                    <div id="best-matches-content" class="best-matches-content"></div>
                </div>
                <div id="tag-list-anchor"></div>
            </div>`;

        // In legacy mode, insert after Xariah's own #divUi so we don't overlap it.
        // In modern mode, prepend to body as usual.
        const divUi = document.getElementById('divUi');
        if (divUi && divUi.parentNode) {
            divUi.parentNode.insertBefore(manager, divUi.nextSibling);
            // divUi is position:fixed with z-index:100. Make our manager also fixed,
            // sitting directly below it, and add body padding so page content isn't hidden.
            const positionLegacyManager = () => {
                const divUiH = divUi.offsetHeight;
                manager.style.cssText += `; position: fixed !important; top: ${divUiH}px !important; left: 0 !important; right: 0 !important; z-index: 99 !important; max-height: 40vh !important; overflow-y: auto !important;`;
                document.body.style.paddingTop = (divUiH + manager.offsetHeight) + 'px';
            };
            // Wait one tick for the manager to render and get a measurable height
            setTimeout(positionLegacyManager, 100);
        } else {
            document.body.prepend(manager);
        }

        // Push page content down by the exact height of our bar
        const updateOffset = () => {
            const h = manager.getBoundingClientRect().height;
            document.documentElement.style.setProperty('--tag-h', h + 'px');
            document.querySelectorAll('x-mainapp, .app-root, #app').forEach(el => {
                el.style.transform    = `translateY(${h}px)`;
                // marginBottom compensates for translateY so the document scroll
                // height increases by the same amount — preventing bottom content cutoff.
                el.style.marginBottom = `${h}px`;
            });
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
                tags:        getAllTags(),
                grid:        getAllGridData(),
                synonyms:    getAllSynonyms(),
                duplicates:  getAllDuplicates(),
                forcedGrids: getAllForcedGrids()
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

                    let importedTags, importedGrid, importedSynonyms, importedDuplicates, importedForcedGrids;
                    if (parsed.version === 1 && parsed.tags) {
                        // New combined format
                        importedTags        = parsed.tags;
                        importedGrid        = parsed.grid        || {};
                        importedSynonyms    = parsed.synonyms    || [];
                        importedDuplicates  = parsed.duplicates  || [];
                        importedForcedGrids = parsed.forcedGrids || [];
                    } else {
                        // Old format — plain tag object, no supplemental data
                        importedTags        = parsed;
                        importedGrid        = {};
                        importedSynonyms    = [];
                        importedDuplicates  = [];
                        importedForcedGrids = [];
                    }

                    showImportDialog(importedTags, importedGrid, importedSynonyms, importedDuplicates, importedForcedGrids);
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
                    let importedTags, importedGrid, importedSynonyms, importedDuplicates, importedForcedGrids;
                    if (parsed.version === 1 && parsed.tags) {
                        importedTags        = parsed.tags;
                        importedGrid        = parsed.grid        || {};
                        importedSynonyms    = parsed.synonyms    || [];
                        importedDuplicates  = parsed.duplicates  || [];
                        importedForcedGrids = parsed.forcedGrids || [];
                    } else {
                        importedTags        = parsed;
                        importedGrid        = {};
                        importedSynonyms    = [];
                        importedDuplicates  = [];
                        importedForcedGrids = [];
                    }
                    btn.textContent = '📡';
                    btn.disabled = false;
                    showDevTagsDialog(importedTags, importedGrid, importedSynonyms, importedDuplicates, importedForcedGrids);
                })
                .catch(err => {
                    btn.textContent = '📡';
                    btn.disabled = false;
                    alert(`Could not fetch developer tags:\n${err.message}`);
                });
        };

        // Ghost chip + debounced search wiring
        let _searchDebounce = null;
        searchInput = manager.querySelector('.filter-input');
        const ghostChipContainer = manager.querySelector('#x-ghost-chips');

        // Renders ghost phrase chips inside the search bar
        const renderGhostChips = () => {
            ghostChipContainer.innerHTML = '';
            _ghostPhrases.forEach((entry, i) => {
                const chip = document.createElement('div');
                chip.className = 'search-ghost-chip' + (entry.negative ? ' negative' : '');
                chip.innerHTML = entry.negative
                    ? `<span class="ghost-quote">-"</span>${entry.phrase}<span class="ghost-quote">"</span>`
                    : `<span class="ghost-quote">"</span>${entry.phrase}<span class="ghost-quote">"</span>`;
                chip.title = entry.negative ? `Excluding phrase "${entry.phrase}"` : 'Click to edit';
                chip.onclick = () => {
                    _ghostPhrases.splice(i, 1);
                    renderGhostChips();
                    searchInput.value = `${entry.negative ? '-' : ''}"${entry.phrase}" ${searchInput.value}`.trim();
                    searchInput.focus();
                    triggerSearch();
                };
                ghostChipContainer.appendChild(chip);
            });
        };

        const triggerSearch = () => {
            clearTimeout(_searchDebounce);
            _searchDebounce = setTimeout(() => renderAllSearch(searchInput.value), 200);
        };

        searchInput.oninput = (e) => {
            let val = e.target.value;
            // Detect a completed quoted phrase, optionally prefixed with - for negation.
            // Captures: (prefix)(before)(negative?)(phrase)(after)
            const quoteMatch = val.match(/^(.*?)(-?)"([^"]+)"\s*(.*?)$/s);
            if (quoteMatch) {
                const before   = quoteMatch[1];
                const negative = quoteMatch[2] === '-';
                const phrase   = quoteMatch[3].trim().toLowerCase();
                const after    = quoteMatch[4];
                if (phrase) {
                    _ghostPhrases.push({ phrase, negative });
                    renderGhostChips();
                    // Strip the before-text too, but only the trailing '-' if negative
                    const remaining = (negative ? before.replace(/-\s*$/, '') : before) + after;
                    searchInput.value = remaining.trim();
                }
            }
            triggerSearch();
        };

        searchInput.onkeydown = (e) => {
            // Backspace on empty input pops the last ghost phrase back as quoted text
            if (e.key === 'Backspace' && searchInput.value === '' && _ghostPhrases.length > 0) {
                const last = _ghostPhrases.pop();
                renderGhostChips();
                searchInput.value = `${last.negative ? '-' : ''}"${last.phrase}"`;
                triggerSearch();
            }
        };
    }

    // Inline import dialog — handles tags, grid data, synonyms, and duplicates.
    // Applies a merge of all imported data stores into the current user library.
    // Called by both showImportDialog (Merge button) and showDevTagsDialog (Merge button).
    function commitMerge(importedTags, importedGrid, importedSynonyms, importedDuplicates, importedForcedGrids) {
        saveFullLibrary(mergeLibraries(getAllTags(), importedTags));
        saveAllGridData({ ...importedGrid, ...getAllGridData() });
        const existingSyn = getAllSynonyms();
        (importedSynonyms || []).forEach(({ master, slaves }) => {
            const existing = existingSyn.find(r => r.master === master);
            if (existing) { slaves.forEach(s => { if (!existing.slaves.includes(s)) existing.slaves.push(s); }); }
            else existingSyn.push({ master, slaves });
        });
        saveSynonyms(existingSyn);
        invalidateSynonymMap();
        const existingDup = getAllDuplicates();
        (importedDuplicates || []).forEach(group => {
            const alreadyCovered = group.some(n => existingDup.some(g => g.includes(n)));
            if (!alreadyCovered) existingDup.push(group);
        });
        saveAllDuplicates(existingDup);
        const existingFg = getAllForcedGrids();
        (importedForcedGrids || []).forEach(group => {
            const alreadyCovered = group.some(n => existingFg.some(g => g.includes(n)));
            if (!alreadyCovered) existingFg.push(group);
        });
        saveAllForcedGrids(existingFg);
    }

    function showImportDialog(importedTags, importedGrid, importedSynonyms, importedDuplicates, importedForcedGrids = []) {
        if (document.getElementById('x-import-dialog')) return;

        const importTagCount  = Object.keys(importedTags).length;
        const importGridCount = Object.keys(importedGrid).length;
        const existingCount   = Object.keys(getAllTags()).length;
        const synCount  = importedSynonyms.length;
        const dupCount  = importedDuplicates.length;
        const fgCount   = importedForcedGrids.length;

        const extraNote = [
            importGridCount > 0 ? `<strong style="color:#eee;">${importGridCount}</strong> grid positions` : '',
            synCount  > 0 ? `<strong style="color:#eee;">${synCount}</strong> synonym rules` : '',
            dupCount  > 0 ? `<strong style="color:#eee;">${dupCount}</strong> linked sets` : '',
            fgCount   > 0 ? `<strong style="color:#eee;">${fgCount}</strong> forced grid sets` : ''
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
            saveAllForcedGrids(importedForcedGrids);
            invalidateSynonymMap();
            dialog.remove();
            location.reload();
        };

        dialog.querySelector('#x-import-merge').onclick = () => {
            commitMerge(importedTags, importedGrid, importedSynonyms, importedDuplicates, importedForcedGrids);
            dialog.remove();
            location.reload();
        };
    }



    // Dev tags dialog — merge-only, no Replace option.
    // Shows what will be added before committing, lets user cancel safely.
    function showDevTagsDialog(importedTags, importedGrid, importedSynonyms, importedDuplicates, importedForcedGrids = []) {
        if (document.getElementById('x-dev-dialog')) return;

        const importTagCount  = Object.keys(importedTags).length;
        const existingTags    = getAllTags();
        const existingCount   = Object.keys(existingTags).length;
        const synCount        = (importedSynonyms   || []).length;
        const setCount        = (importedDuplicates || []).length;

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

        const extras = [
            synCount > 0 ? `<strong style="color:#eee;">${synCount}</strong> synonym rule${synCount === 1 ? '' : 's'}` : '',
            setCount > 0 ? `<strong style="color:#eee;">${setCount}</strong> linked set${setCount === 1 ? '' : 's'}` : ''
        ].filter(Boolean).join(' and ');

        const dialog = document.createElement('div');
        dialog.id = 'x-dev-dialog';
        dialog.style.cssText = `position:fixed; inset:0; background:rgba(0,0,0,0.85); z-index:2000002; display:flex; align-items:center; justify-content:center;`;
        dialog.innerHTML = `
            <div style="background:#1a1a1a; border:2px solid #3ecfb2; border-radius:8px; width:90%; max-width:420px; padding:20px; color:#eee; font-family:sans-serif;">
                <div style="color:#3ecfb2; font-weight:bold; margin-bottom:12px; font-size:14px;">📡 Developer Tag Library</div>
                <div style="font-size:13px; color:#aaa; margin-bottom:16px; line-height:1.8;">
                    The developer library contains <strong style="color:#eee;">${importTagCount}</strong> tagged eicons${extras ? ` plus ${extras}` : ''}.
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
            commitMerge(importedTags, importedGrid, importedSynonyms, importedDuplicates, importedForcedGrids);
            dialog.remove();
            location.reload();
        };
    }



    // --- 11. TAG MODE ENGINE ---
    // x-eiconview lives inside shadow roots, so page CSS cannot reach it.
    // We apply dimming via inline styles and wire hover with JS listeners.

    function getIconNameFromElement(el) {
        const shadow = el.shadowRoot;
        if (!shadow) return null;
        const rootDiv = shadow.querySelector('.root');
        return rootDiv ? (rootDiv.getAttribute('data-tooltip') || '').split('\n')[0].trim() : null;
    }

    function applyTagMode() {
        const lib = getAllTags();
        findDeep(document, 'x-eiconview').forEach(el => {
            const name = getIconNameFromElement(el);
            const shouldDim = tagModeActive && !!(name && lib[name]);

            if (shouldDim && !el._xTagDimmed) {
                el._xTagDimmed = true;
                el.style.opacity    = '0.28';
                el.style.outline    = '1px solid rgba(255, 215, 0, 0.35)';
                el.style.transition = 'opacity 0.2s';
                el._xTagHoverIn  = () => { el.style.opacity = '1'; };
                el._xTagHoverOut = () => { el.style.opacity = '0.28'; };
                el.addEventListener('mouseenter', el._xTagHoverIn);
                el.addEventListener('mouseleave', el._xTagHoverOut);

            } else if (!shouldDim && el._xTagDimmed) {
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

    // Applies or removes the censor visual on all visible live x-eiconview elements.
    // Uses the hazard-tape border-image, image blur injected into the shadow,
    // and a grey overlay div on the shadow root.
    const HAZARD_BORDER = '4px solid transparent';
    const HAZARD_IMAGE  = 'repeating-linear-gradient(45deg,#111 0px,#111 8px,#f5c842 8px,#f5c842 16px) 4';

    function applyCensorMode() {
        findDeep(document, 'x-eiconview').forEach(el => {
            const name = getIconNameFromElement(el);
            if (!name) return;
            const shouldCensor = isEiconCensored(name);

            if (shouldCensor && !el._xCensored) {
                el._xCensored = true;
                el.style.border      = HAZARD_BORDER;
                el.style.borderImage = HAZARD_IMAGE;

                // Inject blur + overlay into the shadow root
                const shadow = el.shadowRoot;
                if (shadow) {
                    // Blur style
                    const blurStyle = document.createElement('style');
                    blurStyle.className = 'x-censor-style';
                    blurStyle.textContent = `img { filter: blur(9px) !important; }`;
                    shadow.appendChild(blurStyle);
                    // Overlay div
                    const overlay = document.createElement('div');
                    overlay.className = 'x-censor-overlay';
                    overlay.style.cssText = `
                        position:absolute; inset:0; background:rgba(30,30,30,0.88);
                        display:flex; align-items:center; justify-content:center;
                        flex-direction:column; gap:2px; z-index:100; pointer-events:none;`;
                    overlay.innerHTML = `
                        <span style="font-size:22px;color:#e74c3c;font-weight:900;line-height:1;">✕</span>
                        <span style="font-size:8px;color:#aaa;font-family:monospace;letter-spacing:.5px;text-transform:uppercase;">Blocked</span>`;
                    const rootDiv = shadow.querySelector('.root');
                    if (rootDiv) {
                        rootDiv.style.position = 'relative';
                        rootDiv.appendChild(overlay);
                    }
                }

            } else if (!shouldCensor && el._xCensored) {
                el._xCensored = false;
                el.style.border      = '';
                el.style.borderImage = '';
                const shadow = el.shadowRoot;
                if (shadow) {
                    shadow.querySelectorAll('.x-censor-style').forEach(s => s.remove());
                    shadow.querySelectorAll('.x-censor-overlay').forEach(s => s.remove());
                }
            }
        });
    }



    // --- 12. BATCH SELECTION ENGINE ---

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
    // Never shown while the tag modal is open — its Tag Selected / Clear buttons
    // must not be reachable while the user is mid-edit.
    function updateSelectionBar() {
        const bar = document.getElementById('x-selection-bar');
        if (!bar) return;
        const count = selectedIconNames.size;
        if (count === 0 || _modalOpen) {
            bar.classList.remove('visible');
        } else {
            bar.classList.add('visible');
            const countEl = bar.querySelector('#x-selection-count');
            if (countEl) countEl.textContent = `${count} eicon${count === 1 ? '' : 's'} selected`;
        }
        updateDtBatchBar();
    }

    // Keeps the sticky batch bar inside the dev tools tag browser in sync with selection.
    function updateDtBatchBar() {
        const bar = document.getElementById('x-dt-batch-bar');
        if (!bar) return;
        const count = selectedIconNames.size;
        bar.classList.toggle('visible', count > 0);
        if (count > 0) {
            const countEl = bar.querySelector('#x-dt-batch-bar-count');
            if (countEl) countEl.textContent = `${count} eicon${count === 1 ? '' : 's'} selected`;
        }
    }

    // Clears all selections and removes highlights from all visible elements.
    // Strips gold-border visuals from all modern eicon elements without clearing the Set.
    // Used when navigating away (e.g. to dev tools) — selection is preserved, display is reset.
    function stripSelectionVisuals() {
        findDeep(document, 'x-eiconview').forEach(el => {
            el.style.outline = el.style.boxShadow = el.style.zIndex = '';
            el._xSelected = false;
        });
    }

    function clearSelection() {
        selectedIconNames.clear();
        // Modern: clear shadow-DOM host elements
        findDeep(document, 'x-eiconview').forEach(el => {
            if (el._xSelected) applySelectionVisual(el, false);
        });
        // Legacy: clear inline styles on flat containers
        document.querySelectorAll('.eicon-container[data-name]').forEach(el => {
            el.style.outline   = '';
            el.style.boxShadow = '';
            el.style.zIndex    = '';
            el._xSelected      = false;
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

        currentIconName = '';
        activeTags = [];
        activeGridSpec = null;
        activeGridPos  = null;
        _batchRemovedTags = new Set();
        _batchIconNames   = new Set(selectedIconNames);
        _batchTagCache    = {};

        // Build per-eicon tag sets from storage
        const names = [...selectedIconNames];
        const storedSets = names.map(n => {
            const raw = getStoredTags(n);
            return new Set(raw ? raw.split(',').map(t => t.trim().toLowerCase()).filter(Boolean) : []);
        });

        // __batch__ = intersection (tags ALL eicons share)
        const common = new Set(storedSets[0]);
        storedSets.slice(1).forEach(set => {
            for (const t of [...common]) { if (!set.has(t)) common.delete(t); }
        });

        // Per-eicon cache = only their additional tags beyond the shared set
        names.forEach((n, i) => {
            const extras = [...storedSets[i]].filter(t => !common.has(t));
            _batchTagCache[n] = { tags: extras, gridSpec: null, gridPos: null };
            const gd = getAllGridData()[n];
            if (gd?.spec) {
                _batchTagCache[n].gridSpec = parseGridFromStorage(gd.spec);
                _batchTagCache[n].gridPos  = gd.pos ?? null;
            }
        });

        // __batch__ holds the shared tags — what's shown when viewing "all"
        _batchTagCache['__batch__'] = { tags: [...common], gridSpec: null, gridPos: null };
        activeTags = [...common];

        // Immutable snapshots of on-disk state for accurate isSaved chip colouring.
        // These must be set before openTagModal is called below.
        _batchOriginalCommon = new Set(common);
        _batchOriginalExtras = {};
        names.forEach((n, i) => { _batchOriginalExtras[n] = storedSets[i]; });

        if (!document.getElementById('x-tag-modal-overlay')) {
            openTagModal(names[0]);
            currentIconName = '';
            activeTags      = [...common];
            activeGridSpec  = null;
            activeGridPos   = null;
        }
        // After the state reset, _savedTagsSnapshot must reflect batch overview (common only)
        _savedTagsSnapshot = new Set(common);

        document.getElementById('x-modal-icon-name').textContent = `${names.length} eicons`;
        document.getElementById('x-tag-modal-overlay').style.display = 'flex';
        const _selBar = document.getElementById('x-selection-bar');
        if (_selBar) _selBar.classList.remove('visible'); // hidden while modal is open

        const input = document.getElementById('x-modal-input');
        if (input) { input.value = ''; input.focus(); }

        renderGridArea();

        // Detect existing grid assignment: if all selected share the same spec, pre-load it
        const allGridData = getAllGridData();
        const existingSpecs = names.map(n => allGridData[n]?.spec).filter(Boolean);
        const allShareSpec  = existingSpecs.length === names.length
            && existingSpecs.every(s => s === existingSpecs[0]);

        // Also detect forced group membership
        const sharedForcedGroup = (() => {
            const fg = getEiconForcedGroup(names[0]);
            if (!fg) return null;
            return names.every(n => fg.group.includes(n.toLowerCase())) ? fg : null;
        })();

        if (allShareSpec) {
            // All selected eicons already have the same grid spec — load it, suppress hint
            activeGridSpec = parseGridTag(existingSpecs[0].startsWith('#') ? existingSpecs[0] : '#' + existingSpecs[0]);
            renderGridArea();
            renderSmartGridHint('');
        } else {
            // Show name-base smart hint as a suggestion (non-destructive)
            const bases = names.map(n => getGroupBase(n));
            const allSameBase = bases.length > 1 && bases.every(b => b === bases[0]) && bases[0] !== names[0].toLowerCase();
            renderSmartGridHint(allSameBase ? names[0] : '');
        }

        // Show preview of exactly the selected eicons (max 25, no auto-discovery)
        const previewNames = [..._batchIconNames].slice(0, 25);
        renderEiconPreviewBatch(previewNames, allShareSpec ? activeGridSpec : null);

        suggestionQuery = '';
        updateSuggestions('');
        renderModalChips();
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



    // --- 13. LIVE EICON BUTTONS ---
    // Injects a tag button into each eicon's shadow root.
    // Also wires Ctrl+Click selection and restores selection highlight
    // when a previously-selected eicon is re-rendered by the virtual scroll.

    const processIcon = (el) => {
        const shadow = el.shadowRoot;
        if (!shadow || shadow.querySelector('.tag-btn')) return;

        const rootDiv = shadow.querySelector('.root');
        if (!rootDiv) return;

        const iconName = (rootDiv.getAttribute('data-tooltip') || '').split('\n')[0].trim();
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



    // --- 14. LAYOUT DETECTION ---
    // Two distinct page layouts exist on xariah.net/eicons:
    //   Modern: web-component grid with <x-eiconview> elements and shadow DOM
    //   Legacy: paginated flat layout with .eicon-container[data-name] divs
    // We detect which one is active once the DOM is ready and branch accordingly.

    let _layoutMode = null; // 'modern' | 'legacy' | null (not yet detected)

    function detectLayout() {
        if (document.getElementById('divResults')) return 'legacy';
        if (findDeep(document, 'x-eiconview').length > 0) return 'modern';
        // DOM might not be ready yet
        if (document.body) {
            // If we have x-mainapp or x-eicon-grid it's modern even before eicons load
            if (document.querySelector('x-mainapp, x-eicon-grid')) return 'modern';
            // divResults will exist immediately in legacy mode
            return null; // not determinable yet
        }
        return null;
    }

    // Adds tag button and ctrl-click selection to a legacy .eicon-container element.
    const processLegacyIcon = (el) => {
        if (_processedIcons.has(el)) return;
        const iconName = el.getAttribute('data-name');
        if (!iconName) return;

        _processedIcons.add(el);
        ensureSelectionBar();

        // Make container relative so the tag button can be positioned inside it
        el.style.position = 'relative';
        el.style.display  = 'inline-block'; // containers are divs; ensure image stays inside

        // Restore selection highlight if previously selected
        if (selectedIconNames.has(iconName)) {
            el.style.outline   = '2px solid gold';
            el.style.boxShadow = '0 0 10px rgba(255,215,0,0.5)';
            el._xSelected = true;
        }

        // Ctrl+click = toggle selection; plain click = copy BBCode (existing behaviour)
        if (!el._xSelectionBound) {
            el._xSelectionBound = true;
            el.addEventListener('click', (e) => {
                if (e.ctrlKey || e.metaKey) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    toggleSelection(el, iconName);
                } else {
                    if (selectedIconNames.size > 0) clearSelection();
                    // Don't override Xariah's own copy handler — just clear selection
                }
            }, true);
        }

        const hasTags = getStoredTags(iconName);
        const btn = document.createElement('button');
        btn.className = 'x-legacy-tag-btn';
        btn.innerHTML = '🏷️';
        btn.title     = `Tag: ${iconName}`;
        btn.style.cssText = `
            position: absolute; bottom: 2px; left: 2px;
            z-index: 9999; background: rgba(0,0,0,0.8); color: white;
            border: 1px solid ${hasTags ? 'gold' : '#444'}; border-radius: 4px;
            padding: 2px; cursor: pointer; font-size: 12px;
            width: 20px; height: 20px;
            display: flex; align-items: center; justify-content: center;
            opacity: 0; transition: opacity 0.2s;
            box-shadow: ${hasTags ? '0 0 5px gold' : 'none'};`;
        // Use capture phase to beat Xariah's click handler on the container
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.stopImmediatePropagation();
            e.preventDefault();
            openTagModal(iconName);
        }, true);

        el.addEventListener('mouseenter', () => { btn.style.opacity = '1'; });
        el.addEventListener('mouseleave', () => { btn.style.opacity = '0'; });

        el.appendChild(btn);
    };

    // Refresh all visible legacy tag buttons (e.g. after save)
    function refreshLegacyButtons() {
        document.querySelectorAll('.eicon-container[data-name]').forEach(el => {
            const name = el.getAttribute('data-name');
            const btn  = el.querySelector('.x-legacy-tag-btn');
            if (!btn || !name) return;
            const hasTags = getStoredTags(name);
            btn.style.border    = `1px solid ${hasTags ? 'gold' : '#444'}`;
            btn.style.boxShadow = hasTags ? '0 0 5px gold' : 'none';
        });
    }



    // --- 15. DEEP SHADOW QUERY ---

    function findDeep(root, selector, results = []) {
        if (!root) return results;
        results.push(...Array.from(root.querySelectorAll(selector)));
        Array.from(root.querySelectorAll('*')).filter(el => el.shadowRoot).forEach(host => findDeep(host.shadowRoot, selector, results));
        return results;
    }



    // --- 16. BOOT LOOP ---
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
        // Detect layout mode once the DOM is ready
        if (!_layoutMode) {
            _layoutMode = detectLayout();
            if (_layoutMode === 'legacy') {
                // In legacy mode the favicon hook never fires (no X-* web components)
                // so set the favicon immediately here instead.
                console.log('[XariahTagger] Legacy layout detected — setting favicon directly');
                _setTagFavicon();
            } else if (_layoutMode === 'modern') {
                console.log('[XariahTagger] Modern layout detected');
            }
        }

        if (!_explorerReady) {
            try {
                initExplorer();
            } catch(e) {
                console.error('[XariahTagger] initExplorer error:', e);
            }
            if (document.getElementById('x-tag-manager')) {
                _explorerReady = true;
                console.log('[XariahTagger] Explorer ready');
            }
        }

        if (_layoutMode === 'modern') {
            if (!_tooltipReady) {
                try {
                    initTooltipPatch();
                } catch(e) {
                    console.error('[XariahTagger] initTooltipPatch error:', e);
                }
                if (window._xTooltipHandlerBound) {
                    _tooltipReady = true;
                    console.log('[XariahTagger] Tooltip patch ready');
                }
            }
            findDeep(document, 'x-eiconview').forEach(_processIcon_guarded);
        } else if (_layoutMode === 'legacy') {
            document.querySelectorAll('.eicon-container[data-name]').forEach(processLegacyIcon);
        }

        if (tagModeActive) applyTagMode();
        applyCensorMode();
    }, 1000);

})();
