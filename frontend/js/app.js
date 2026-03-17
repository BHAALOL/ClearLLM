/* ============================================================
   ClearLLM — Frontend Logic v2
   Features: real-time detection, entity editing, client-side
   AES-256-GCM encryption, theme toggle, TTL countdown,
   keyboard shortcuts
   ============================================================ */

(function () {
    "use strict";

    const SESSION_TTL_MS = 30 * 60 * 1000; // 30 min

    // ---- State ----
    let detectedEntities = [];   // {entity_type, text, start, end, score, enabled}
    let cryptoKey = null;        // AES-GCM key (memory only)
    let encryptedMapping = null; // {iv, data} stored in sessionStorage
    let mapping = null;          // plaintext mapping (in memory, cleared after encrypt)
    let sessionCreatedAt = null;
    let ttlInterval = null;
    let analyzeTimer = null;
    let isAnonymized = false;
    let liveViewEnabled = false; // disabled by default — recommended for large logs

    // ---- DOM ----
    const $ = (s) => document.querySelector(s);
    const inputText        = $("#inputText");
    const charCount        = $("#charCount");
    const btnAnonymize     = $("#btnAnonymize");
    const btnClear         = $("#btnClear");
    const btnCopy          = $("#btnCopy");
    const btnDeanonymize   = $("#btnDeanonymize");
    const btnCopyDeanon    = $("#btnCopyDeanon");
    const btnDeleteSession = $("#btnDeleteSession");
    const btnSidebarToggle = $("#btnSidebarToggle");
    const btnTheme         = $("#btnTheme");
    const themeLabel       = $("#themeLabel");
    const btnShortcuts     = $("#btnShortcuts");
    const btnShortcuts2    = $("#btnShortcuts2");
    const btnCloseModal    = $("#btnCloseModal");
    const shortcutsModal   = $("#shortcutsModal");
    const sidebar          = $("#sidebar");
    const langSelect       = $("#langSelect");
    const loader           = $("#loader");
    const emptyState1      = $("#emptyState1");
    const emptyState2      = $("#emptyState2");
    const highlightedPrev  = $("#highlightedPreview");
    const anonymizedText   = $("#anonymizedText");
    const resultFooter     = $("#resultFooter");
    const resultHint       = $("#resultHint");
    const rightPanelTitle  = $("#rightPanelTitle");
    const entitiesSection  = $("#entitiesSection");
    const entitiesList     = $("#entitiesList");
    const deanonRow        = $("#deanonRow");
    const divider          = $("#divider");
    const llmResponse      = $("#llmResponse");
    const deanonymizedText = $("#deanonymizedText");
    const deanonFooter     = $("#deanonFooter");
    const sessionBadge     = $("#sessionBadge");
    const liveBadge        = $("#liveBadge");
    const ttlWrap          = $("#ttlWrap");
    const ttlBar           = $("#ttlBar");
    const ttlText          = $("#ttlText");
    const manualText       = $("#manualText");
    const manualType       = $("#manualType");
    const btnAddEntity     = $("#btnAddEntity");
    const liveViewToggle   = $("#liveViewToggle");
    const liveViewLabel    = $("#liveViewLabel");
    const emptyStateHint   = $("#emptyStateHint");

    // ============================================================
    // HELPERS
    // ============================================================
    function toast(msg, type = "success") {
        const el = document.createElement("div");
        el.className = `toast toast-${type}`;
        el.textContent = msg;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 3000);
    }

    async function api(endpoint, body) {
        const res = await fetch(`/api/${endpoint}`, {
            method: body ? "POST" : "GET",
            headers: body ? { "Content-Type": "application/json" } : {},
            body: body ? JSON.stringify(body) : undefined,
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ detail: "Erreur serveur" }));
            throw new Error(err.detail || `Erreur ${res.status}`);
        }
        return res.json();
    }

    function escapeHtml(s) {
        const d = document.createElement("div");
        d.textContent = s;
        return d.innerHTML;
    }

    function getEntityClass(type) {
        const known = ["PERSON","EMAIL_ADDRESS","PHONE_NUMBER","LOCATION","CREDIT_CARD",
            "DATE_TIME","IBAN_CODE","IP_ADDRESS","URL","FR_SSN","NRP"];
        return known.includes(type) ? type : "default";
    }

    function highlightPlaceholders(text) {
        const e = escapeHtml(text);
        return e.replace(/&lt;([A-Z_]+_\d+)&gt;/g, '<span class="placeholder">&lt;$1&gt;</span>');
    }

    // ============================================================
    // CRYPTO (AES-256-GCM, client-side only)
    // ============================================================
    async function ensureCryptoKey() {
        if (!cryptoKey) {
            cryptoKey = await crypto.subtle.generateKey(
                { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
            );
        }
        return cryptoKey;
    }

    async function encryptMapping(map) {
        const key = await ensureCryptoKey();
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encoded = new TextEncoder().encode(JSON.stringify(map));
        const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
        const result = {
            iv: Array.from(iv),
            data: Array.from(new Uint8Array(ciphertext)),
        };
        try { sessionStorage.setItem("clearllm_map", JSON.stringify(result)); } catch (_) {}
        return result;
    }

    async function decryptMapping() {
        const raw = sessionStorage.getItem("clearllm_map");
        if (!raw || !cryptoKey) return null;
        try {
            const { iv, data } = JSON.parse(raw);
            const decrypted = await crypto.subtle.decrypt(
                { name: "AES-GCM", iv: new Uint8Array(iv) },
                cryptoKey,
                new Uint8Array(data)
            );
            return JSON.parse(new TextDecoder().decode(decrypted));
        } catch (_) {
            return null;
        }
    }

    function clearCrypto() {
        cryptoKey = null;
        encryptedMapping = null;
        mapping = null;
        sessionStorage.removeItem("clearllm_map");
    }

    // ============================================================
    // SESSION & TTL
    // ============================================================
    function startSession() {
        sessionCreatedAt = Date.now();
        sessionBadge.innerHTML = '<span class="dot dot-active"></span><span>Session active</span>';
        btnDeleteSession.style.display = "flex";
        ttlWrap.style.display = "block";
        ttlText.style.display = "block";
        updateTTL();
        if (ttlInterval) clearInterval(ttlInterval);
        ttlInterval = setInterval(updateTTL, 1000);
    }

    function updateTTL() {
        if (!sessionCreatedAt) return;
        const elapsed = Date.now() - sessionCreatedAt;
        const remaining = Math.max(0, SESSION_TTL_MS - elapsed);
        const pct = (remaining / SESSION_TTL_MS) * 100;
        const mins = Math.floor(remaining / 60000);
        const secs = Math.floor((remaining % 60000) / 1000);

        ttlBar.style.width = pct + "%";
        ttlBar.classList.remove("warning", "danger");
        if (pct < 15) ttlBar.classList.add("danger");
        else if (pct < 35) ttlBar.classList.add("warning");

        ttlText.textContent = `Expire dans ${mins}:${secs.toString().padStart(2, "0")}`;

        if (remaining <= 0) {
            endSession();
            toast("Session expiree. Les donnees ont ete effacees.", "error");
        }
    }

    function endSession() {
        sessionCreatedAt = null;
        if (ttlInterval) { clearInterval(ttlInterval); ttlInterval = null; }
        sessionBadge.innerHTML = '<span class="dot dot-inactive"></span><span>Aucune session</span>';
        btnDeleteSession.style.display = "none";
        ttlWrap.style.display = "none";
        ttlText.style.display = "none";
        ttlBar.style.width = "100%";
        clearCrypto();
    }

    // ============================================================
    // ENTITY MANAGEMENT
    // ============================================================
    function renderEntities() {
        entitiesList.innerHTML = "";
        if (detectedEntities.length === 0) {
            entitiesSection.style.display = "none";
            return;
        }
        entitiesSection.style.display = "block";

        // Deduplicate for display
        const seen = new Set();
        detectedEntities.forEach((e) => {
            const key = `${e.entity_type}::${e.text}`;
            if (seen.has(key)) return;
            seen.add(key);

            const tag = document.createElement("div");
            tag.className = `entity-tag entity-${getEntityClass(e.entity_type)}${e.enabled ? "" : " disabled"}`;

            const cb = document.createElement("input");
            cb.type = "checkbox";
            cb.className = "entity-check";
            cb.checked = e.enabled;

            const typeSpan = document.createElement("span");
            typeSpan.className = "entity-type";
            typeSpan.textContent = e.entity_type;

            const arrowSpan = document.createElement("span");
            arrowSpan.className = "entity-arrow";
            arrowSpan.textContent = "\u2192";

            const valueSpan = document.createElement("span");
            valueSpan.className = "entity-value";
            valueSpan.title = e.text;
            valueSpan.textContent = e.text;

            tag.appendChild(cb);
            tag.appendChild(typeSpan);
            tag.appendChild(arrowSpan);
            tag.appendChild(valueSpan);

            cb.addEventListener("change", () => {
                detectedEntities.forEach((ent) => {
                    if (ent.entity_type === e.entity_type && ent.text === e.text) {
                        ent.enabled = cb.checked;
                    }
                });
                tag.classList.toggle("disabled", !cb.checked);
                if (!isAnonymized) renderHighlightedPreview();
            });

            entitiesList.appendChild(tag);
        });
    }

    function renderHighlightedPreview() {
        const text = inputText.value;
        if (!text || detectedEntities.length === 0) {
            highlightedPrev.style.display = "none";
            if (!isAnonymized) emptyState1.style.display = "flex";
            return;
        }

        const enabled = detectedEntities.filter((e) => e.enabled).sort((a, b) => a.start - b.start);
        if (enabled.length === 0) {
            highlightedPrev.innerHTML = escapeHtml(text);
            highlightedPrev.style.display = "block";
            emptyState1.style.display = "none";
            return;
        }

        let html = "";
        let last = 0;
        for (const ent of enabled) {
            if (ent.start < last) continue; // skip overlaps
            html += escapeHtml(text.substring(last, ent.start));
            const cls = `hl hl-${getEntityClass(ent.entity_type)}`;
            html += `<mark class="${cls}" title="${escapeHtml(ent.entity_type)}">${escapeHtml(text.substring(ent.start, ent.end))}</mark>`;
            last = ent.end;
        }
        html += escapeHtml(text.substring(last));

        highlightedPrev.innerHTML = html;
        highlightedPrev.style.display = "block";
        anonymizedText.style.display = "none";
        emptyState1.style.display = "none";

        if (!isAnonymized) {
            rightPanelTitle.textContent = "Apercu en direct";
            resultFooter.style.display = "none";
        }
    }

    // ============================================================
    // REAL-TIME DETECTION (#4)
    // ============================================================
    function scheduleAnalysis() {
        if (analyzeTimer) clearTimeout(analyzeTimer);
        if (!liveViewEnabled) return; // live view disabled — analysis runs only on explicit click
        const text = inputText.value.trim();
        if (text.length < 15) {
            detectedEntities = [];
            renderEntities();
            highlightedPrev.style.display = "none";
            liveBadge.style.display = "none";
            if (!isAnonymized) emptyState1.style.display = "flex";
            return;
        }
        analyzeTimer = setTimeout(() => runLiveAnalysis(text), 600);
    }

    async function runLiveAnalysis(text) {
        try {
            liveBadge.style.display = "inline-flex";
            const data = await api("analyze", { text, language: langSelect.value });
            // Merge with manual entities
            const manuals = detectedEntities.filter((e) => e.manual);
            detectedEntities = data.entities.map((e) => ({
                ...e,
                enabled: isEntityEnabled(e),
                manual: false,
            }));
            // Re-add manuals
            manuals.forEach((m) => {
                if (!detectedEntities.some((e) => e.start === m.start && e.end === m.end))
                    detectedEntities.push(m);
            });
            renderEntities();
            if (!isAnonymized) renderHighlightedPreview();
        } catch (_) {
            // Silently fail on live analysis
        } finally {
            liveBadge.style.display = "none";
        }
    }

    function isEntityEnabled(e) {
        // Check if user previously disabled this entity type+text
        const prev = detectedEntities.find(
            (p) => p.entity_type === e.entity_type && p.text === e.text
        );
        return prev ? prev.enabled : true;
    }

    // ============================================================
    // MANUAL ENTITY ADD (#3)
    // ============================================================
    btnAddEntity.addEventListener("click", addManualEntity);
    manualText.addEventListener("keydown", (e) => { if (e.key === "Enter") addManualEntity(); });

    function addManualEntity() {
        const text = manualText.value.trim();
        const type = manualType.value;
        if (!text) return;

        const input = inputText.value;
        let idx = 0;
        let added = 0;
        while (true) {
            const pos = input.indexOf(text, idx);
            if (pos === -1) break;
            detectedEntities.push({
                entity_type: type,
                text: text,
                start: pos,
                end: pos + text.length,
                score: 1.0,
                enabled: true,
                manual: true,
            });
            idx = pos + text.length;
            added++;
        }

        if (added === 0) {
            toast("Texte introuvable dans le message.", "error");
            return;
        }

        manualText.value = "";
        renderEntities();
        renderHighlightedPreview();
        toast(`${added} occurrence${added > 1 ? "s" : ""} ajoutee${added > 1 ? "s" : ""}.`);
    }

    // ============================================================
    // ANONYMIZE
    // ============================================================
    btnAnonymize.addEventListener("click", async () => {
        const text = inputText.value.trim();
        if (!text) { toast("Veuillez saisir un message.", "error"); return; }

        loader.classList.add("visible");
        emptyState1.style.display = "none";
        highlightedPrev.style.display = "none";
        anonymizedText.style.display = "none";
        resultFooter.style.display = "none";
        btnAnonymize.disabled = true;

        try {
            const enabledEnts = detectedEntities.filter((e) => e.enabled);
            const body = { text, language: langSelect.value };
            if (enabledEnts.length > 0) {
                body.entities = enabledEnts.map((e) => ({
                    entity_type: e.entity_type,
                    start: e.start,
                    end: e.end,
                    score: e.score,
                }));
            }

            const data = await api("anonymize", body);

            // Encrypt mapping client-side
            await encryptMapping(data.mapping);
            mapping = null; // Clear plaintext from memory

            // Update entities from response
            detectedEntities = data.entities.map((e) => ({
                entity_type: e.entity_type,
                text: e.original,
                start: 0, end: 0, // positions no longer relevant post-anonymization
                score: e.score,
                enabled: true,
                anonymized: e.anonymized,
            }));
            renderEntities();

            // Show anonymized output
            isAnonymized = true;
            rightPanelTitle.textContent = "Message anonymise";
            anonymizedText.innerHTML = highlightPlaceholders(data.anonymized_text);
            anonymizedText.style.display = "block";
            anonymizedText.classList.add("fade-in");
            highlightedPrev.style.display = "none";
            resultFooter.style.display = "flex";
            resultHint.textContent = "Pret a copier";

            // Start session & TTL
            startSession();

            // Show deanon section
            divider.style.display = "flex";
            deanonRow.style.display = "grid";
            deanonymizedText.style.display = "none";
            deanonFooter.style.display = "none";
            emptyState2.style.display = "flex";
        } catch (err) {
            toast(err.message, "error");
            if (!isAnonymized) emptyState1.style.display = "flex";
        } finally {
            loader.classList.remove("visible");
            btnAnonymize.disabled = false;
        }
    });

    // ============================================================
    // DEANONYMIZE (client-side)
    // ============================================================
    btnDeanonymize.addEventListener("click", async () => {
        const text = llmResponse.value.trim();
        if (!text) { toast("Veuillez coller la reponse du LLM.", "error"); return; }

        const map = await decryptMapping();
        if (!map) {
            toast("Session expiree ou cle perdue. Veuillez re-anonymiser.", "error");
            return;
        }

        // Client-side replacement
        let result = text;
        const placeholders = Object.keys(map).sort((a, b) => b.length - a.length);
        for (const ph of placeholders) {
            result = result.split(ph).join(map[ph]);
        }

        deanonymizedText.textContent = result;
        deanonymizedText.style.display = "block";
        deanonymizedText.classList.add("fade-in");
        emptyState2.style.display = "none";
        deanonFooter.style.display = "flex";
    });

    // ============================================================
    // COPY
    // ============================================================
    btnCopy.addEventListener("click", () => {
        navigator.clipboard.writeText(anonymizedText.textContent).then(
            () => toast("Message anonymise copie !"),
            () => toast("Erreur lors de la copie.", "error")
        );
    });

    btnCopyDeanon.addEventListener("click", () => {
        navigator.clipboard.writeText(deanonymizedText.textContent).then(
            () => toast("Reponse restauree copiee !"),
            () => toast("Erreur lors de la copie.", "error")
        );
    });

    // ============================================================
    // CLEAR & DELETE SESSION
    // ============================================================
    btnClear.addEventListener("click", resetAll);

    btnDeleteSession.addEventListener("click", () => {
        endSession();
        toast("Session supprimee. Cle et mappings effaces.");
    });

    function resetAll() {
        inputText.value = "";
        charCount.textContent = "0 caracteres";
        detectedEntities = [];
        isAnonymized = false;
        renderEntities();

        anonymizedText.style.display = "none";
        highlightedPrev.style.display = "none";
        resultFooter.style.display = "none";
        emptyState1.style.display = "flex";
        rightPanelTitle.textContent = liveViewEnabled ? "Apercu en direct" : "Resultat";
        liveBadge.style.display = "none";

        deanonRow.style.display = "none";
        divider.style.display = "none";
        deanonymizedText.style.display = "none";
        deanonFooter.style.display = "none";
        emptyState2.style.display = "flex";
        llmResponse.value = "";

        endSession();
    }

    // ============================================================
    // CHAR COUNT + LIVE DETECTION
    // ============================================================
    inputText.addEventListener("input", () => {
        const len = inputText.value.length;
        charCount.textContent = `${len.toLocaleString("fr-FR")} caractere${len !== 1 ? "s" : ""}`;

        // Reset anonymized state when editing
        if (isAnonymized) {
            isAnonymized = false;
            rightPanelTitle.textContent = liveViewEnabled ? "Apercu en direct" : "Resultat";
            anonymizedText.style.display = "none";
            resultFooter.style.display = "none";
            // Also reset the deanon section since the mapping is now stale
            divider.style.display = "none";
            deanonRow.style.display = "none";
            deanonymizedText.style.display = "none";
            deanonFooter.style.display = "none";
            llmResponse.value = "";
            emptyState2.style.display = "flex";
            endSession();
        }

        scheduleAnalysis();
    });

    // ============================================================
    // LIVE VIEW TOGGLE
    // ============================================================
    function setLiveView(enabled) {
        liveViewEnabled = enabled;
        liveViewToggle.checked = enabled;
        liveViewLabel.textContent = enabled ? "Activee" : "Desactivee";
        localStorage.setItem("clearllm_live", enabled ? "1" : "0");
        if (emptyStateHint) {
            emptyStateHint.textContent = enabled
                ? "Commencez a taper pour voir la detection en temps reel"
                : "Collez vos logs puis cliquez sur Anonymiser";
        }
        if (!enabled) {
            // Clear any pending live analysis and hide the preview if not anonymized
            if (analyzeTimer) { clearTimeout(analyzeTimer); analyzeTimer = null; }
            liveBadge.style.display = "none";
            if (!isAnonymized) {
                highlightedPrev.style.display = "none";
                emptyState1.style.display = "flex";
                rightPanelTitle.textContent = "Resultat";
            }
        } else {
            if (!isAnonymized) rightPanelTitle.textContent = "Apercu en direct";
        }
    }

    liveViewToggle.addEventListener("change", () => setLiveView(liveViewToggle.checked));

    // Init live view from localStorage (default: disabled)
    setLiveView(localStorage.getItem("clearllm_live") === "1");

    // ============================================================
    // THEME TOGGLE (#14)
    // ============================================================
    function setTheme(theme) {
        document.documentElement.setAttribute("data-theme", theme);
        localStorage.setItem("clearllm_theme", theme);
        const iconSun = '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
        const iconMoon = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
        const icon = $("#iconTheme");
        icon.innerHTML = theme === "dark" ? iconSun : iconMoon;
        themeLabel.textContent = theme === "dark" ? "Theme clair" : "Theme sombre";
    }

    btnTheme.addEventListener("click", () => {
        const cur = document.documentElement.getAttribute("data-theme") || "dark";
        setTheme(cur === "dark" ? "light" : "dark");
    });

    // Init theme from localStorage
    setTheme(localStorage.getItem("clearllm_theme") || "dark");

    // ============================================================
    // KEYBOARD SHORTCUTS MODAL (#16)
    // ============================================================
    function openShortcuts() { shortcutsModal.classList.add("open"); }
    function closeShortcuts() { shortcutsModal.classList.remove("open"); }

    btnShortcuts.addEventListener("click", openShortcuts);
    btnShortcuts2.addEventListener("click", openShortcuts);
    btnCloseModal.addEventListener("click", closeShortcuts);
    shortcutsModal.addEventListener("click", (e) => {
        if (e.target === shortcutsModal) closeShortcuts();
    });

    // ============================================================
    // GLOBAL KEYBOARD SHORTCUTS
    // ============================================================
    document.addEventListener("keydown", (e) => {
        // Escape — close modal / sidebar
        if (e.key === "Escape") {
            closeShortcuts();
            sidebar.classList.remove("open");
            const overlay = $(".sidebar-overlay");
            if (overlay) overlay.classList.remove("active");
            return;
        }

        // ? — open shortcuts (only if not typing in input)
        if (e.key === "?" && !isInputFocused()) {
            e.preventDefault();
            openShortcuts();
            return;
        }

        if (!(e.ctrlKey || e.metaKey)) return;

        // Ctrl+Enter — anonymize
        if (e.key === "Enter") {
            e.preventDefault();
            btnAnonymize.click();
            return;
        }

        if (!e.shiftKey) return;

        // Ctrl+Shift+C — copy
        if (e.key === "C" || e.key === "c") {
            e.preventDefault();
            if (anonymizedText.style.display !== "none") btnCopy.click();
            return;
        }

        // Ctrl+Shift+D — deanonymize
        if (e.key === "D" || e.key === "d") {
            e.preventDefault();
            btnDeanonymize.click();
            return;
        }

        // Ctrl+Shift+L — toggle theme
        if (e.key === "L" || e.key === "l") {
            e.preventDefault();
            btnTheme.click();
            return;
        }

        // Ctrl+Shift+X — clear
        if (e.key === "X" || e.key === "x") {
            e.preventDefault();
            resetAll();
            return;
        }
    });

    function isInputFocused() {
        const tag = document.activeElement?.tagName;
        return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    }

    // ============================================================
    // SIDEBAR TOGGLE (mobile)
    // ============================================================
    btnSidebarToggle.addEventListener("click", () => {
        sidebar.classList.toggle("open");
        let overlay = $(".sidebar-overlay");
        if (!overlay) {
            overlay = document.createElement("div");
            overlay.className = "sidebar-overlay";
            document.body.appendChild(overlay);
            overlay.addEventListener("click", () => {
                sidebar.classList.remove("open");
                overlay.classList.remove("active");
            });
        }
        overlay.classList.toggle("active", sidebar.classList.contains("open"));
    });

})();
