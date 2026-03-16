/* ============================================================
   ClearLLM — Frontend Logic
   ============================================================ */

(function () {
    "use strict";

    // ---- State ----
    let currentSessionId = null;

    // ---- DOM refs ----
    const $ = (sel) => document.querySelector(sel);
    const inputText = $("#inputText");
    const charCount = $("#charCount");
    const btnAnonymize = $("#btnAnonymize");
    const btnClear = $("#btnClear");
    const btnCopy = $("#btnCopy");
    const btnDeanonymize = $("#btnDeanonymize");
    const btnCopyDeanon = $("#btnCopyDeanon");
    const btnDeleteSession = $("#btnDeleteSession");
    const btnSettings = $("#btnSettings");
    const btnCloseSettings = $("#btnCloseSettings");
    const settingsPanel = $("#settingsPanel");
    const langSelect = $("#langSelect");
    const loader = $("#loader");
    const resultsSection = $("#resultsSection");
    const deanonSection = $("#deanonSection");
    const entitiesList = $("#entitiesList");
    const anonymizedText = $("#anonymizedText");
    const llmResponse = $("#llmResponse");
    const deanonymizedText = $("#deanonymizedText");
    const deanonResult = $("#deanonResult");
    const deanonActions = $("#deanonActions");
    const sessionBadge = $("#sessionBadge");

    // ---- Helpers ----
    function toast(message, type = "success") {
        const el = document.createElement("div");
        el.className = `toast toast-${type}`;
        el.textContent = message;
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

    async function apiDelete(endpoint) {
        const res = await fetch(`/api/${endpoint}`, { method: "DELETE" });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ detail: "Erreur serveur" }));
            throw new Error(err.detail || `Erreur ${res.status}`);
        }
        return res.json();
    }

    function updateSessionBadge(active) {
        if (active) {
            sessionBadge.innerHTML =
                '<span class="dot dot-active"></span>Session active';
            sessionBadge.title = `Session: ${currentSessionId}`;
        } else {
            sessionBadge.innerHTML =
                '<span class="dot dot-inactive"></span>Aucune session';
            sessionBadge.title = "Aucune session active";
        }
    }

    function escapeHtml(str) {
        const div = document.createElement("div");
        div.textContent = str;
        return div.innerHTML;
    }

    function highlightPlaceholders(text) {
        const escaped = escapeHtml(text);
        return escaped.replace(
            /&lt;([A-Z_]+_\d+)&gt;/g,
            '<span class="placeholder">&lt;$1&gt;</span>'
        );
    }

    function getEntityClass(type) {
        const known = [
            "PERSON", "EMAIL_ADDRESS", "PHONE_NUMBER", "LOCATION",
            "CREDIT_CARD", "DATE_TIME", "IBAN_CODE", "IP_ADDRESS",
            "URL", "FR_SSN", "NRP",
        ];
        return known.includes(type) ? `entity-${type}` : "entity-default";
    }

    function setLoading(on) {
        loader.classList.toggle("visible", on);
        btnAnonymize.disabled = on;
    }

    // ---- Character count ----
    inputText.addEventListener("input", () => {
        const len = inputText.value.length;
        charCount.textContent = `${len.toLocaleString("fr-FR")} caractère${len !== 1 ? "s" : ""}`;
    });

    // ---- Settings ----
    btnSettings.addEventListener("click", () => {
        settingsPanel.classList.toggle("open");
    });

    btnCloseSettings.addEventListener("click", () => {
        settingsPanel.classList.remove("open");
    });

    // ---- Clear ----
    btnClear.addEventListener("click", () => {
        inputText.value = "";
        charCount.textContent = "0 caractères";
        resultsSection.style.display = "none";
        deanonSection.style.display = "none";
        deanonResult.style.display = "none";
        deanonActions.style.display = "none";
        llmResponse.value = "";
        currentSessionId = null;
        updateSessionBadge(false);
    });

    // ---- Anonymize ----
    btnAnonymize.addEventListener("click", async () => {
        const text = inputText.value.trim();
        if (!text) {
            toast("Veuillez saisir un message.", "error");
            return;
        }

        setLoading(true);
        resultsSection.style.display = "none";
        deanonSection.style.display = "none";

        try {
            const data = await api("anonymize", {
                text: text,
                language: langSelect.value,
            });

            currentSessionId = data.session_id;
            updateSessionBadge(true);

            // Render entities
            entitiesList.innerHTML = "";
            if (data.entities.length === 0) {
                entitiesList.innerHTML =
                    '<span style="color:var(--text-muted);font-size:0.85rem;">Aucune donnée personnelle détectée.</span>';
            } else {
                data.entities.forEach((e) => {
                    const tag = document.createElement("span");
                    tag.className = `entity-tag ${getEntityClass(e.entity_type)}`;
                    tag.innerHTML = `<span class="entity-type">${escapeHtml(e.entity_type)}</span> <span class="entity-arrow">\u2192</span> ${escapeHtml(e.anonymized)}`;
                    tag.title = `Original: "${e.original}" (score: ${e.score})`;
                    entitiesList.appendChild(tag);
                });
            }

            // Render anonymized text
            anonymizedText.innerHTML = highlightPlaceholders(data.anonymized_text);

            resultsSection.style.display = "block";
            deanonSection.style.display = "block";
            deanonResult.style.display = "none";
            deanonActions.style.display = "none";

            resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
        } catch (err) {
            toast(err.message, "error");
        } finally {
            setLoading(false);
        }
    });

    // ---- Copy anonymized ----
    btnCopy.addEventListener("click", () => {
        const text = anonymizedText.textContent;
        navigator.clipboard.writeText(text).then(
            () => toast("Message anonymisé copié !"),
            () => toast("Erreur lors de la copie.", "error")
        );
    });

    // ---- De-anonymize ----
    btnDeanonymize.addEventListener("click", async () => {
        const text = llmResponse.value.trim();
        if (!text) {
            toast("Veuillez coller la réponse du LLM.", "error");
            return;
        }
        if (!currentSessionId) {
            toast("Aucune session active. Anonymisez d'abord un message.", "error");
            return;
        }

        btnDeanonymize.disabled = true;

        try {
            const data = await api("deanonymize", {
                session_id: currentSessionId,
                text: text,
            });

            deanonymizedText.textContent = data.deanonymized_text;
            deanonResult.style.display = "block";
            deanonActions.style.display = "flex";
            deanonResult.scrollIntoView({ behavior: "smooth", block: "start" });
        } catch (err) {
            toast(err.message, "error");
        } finally {
            btnDeanonymize.disabled = false;
        }
    });

    // ---- Copy de-anonymized ----
    btnCopyDeanon.addEventListener("click", () => {
        const text = deanonymizedText.textContent;
        navigator.clipboard.writeText(text).then(
            () => toast("Réponse restaurée copiée !"),
            () => toast("Erreur lors de la copie.", "error")
        );
    });

    // ---- Delete session ----
    btnDeleteSession.addEventListener("click", async () => {
        if (!currentSessionId) return;
        try {
            await apiDelete(`session/${currentSessionId}`);
            currentSessionId = null;
            updateSessionBadge(false);
            deanonResult.style.display = "none";
            deanonActions.style.display = "none";
            toast("Session supprimée. Les mappings sont effacés.");
        } catch (err) {
            toast(err.message, "error");
        }
    });

    // ---- Keyboard shortcut: Ctrl+Enter to anonymize ----
    inputText.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            e.preventDefault();
            btnAnonymize.click();
        }
    });
})();
