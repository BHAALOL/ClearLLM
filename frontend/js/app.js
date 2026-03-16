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
    const btnSidebarToggle = $("#btnSidebarToggle");
    const sidebar = $(".sidebar");
    const langSelect = $("#langSelect");
    const loader = $("#loader");
    const emptyState1 = $("#emptyState1");
    const emptyState2 = $("#emptyState2");
    const anonymizedText = $("#anonymizedText");
    const resultFooter = $("#resultFooter");
    const entitiesSection = $("#entitiesSection");
    const entitiesList = $("#entitiesList");
    const deanonRow = $("#deanonRow");
    const divider = $("#divider");
    const llmResponse = $("#llmResponse");
    const deanonymizedText = $("#deanonymizedText");
    const deanonFooter = $("#deanonFooter");
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
                '<span class="dot dot-active"></span><span>Session active</span>';
            sessionBadge.title = `Session: ${currentSessionId}`;
            btnDeleteSession.style.display = "flex";
        } else {
            sessionBadge.innerHTML =
                '<span class="dot dot-inactive"></span><span>Aucune session</span>';
            sessionBadge.title = "Aucune session active";
            btnDeleteSession.style.display = "none";
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
        if (on) {
            emptyState1.style.display = "none";
            anonymizedText.style.display = "none";
        }
        btnAnonymize.disabled = on;
    }

    // ---- Sidebar toggle (mobile) ----
    btnSidebarToggle.addEventListener("click", () => {
        sidebar.classList.toggle("open");
        // Manage overlay
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

    // ---- Character count ----
    inputText.addEventListener("input", () => {
        const len = inputText.value.length;
        charCount.textContent = `${len.toLocaleString("fr-FR")} caractere${len !== 1 ? "s" : ""}`;
    });

    // ---- Clear ----
    btnClear.addEventListener("click", () => {
        inputText.value = "";
        charCount.textContent = "0 caracteres";
        // Reset right panel
        anonymizedText.style.display = "none";
        resultFooter.style.display = "none";
        emptyState1.style.display = "flex";
        // Reset entities
        entitiesSection.style.display = "none";
        entitiesList.innerHTML = "";
        // Reset deanon row
        deanonRow.style.display = "none";
        divider.style.display = "none";
        deanonymizedText.style.display = "none";
        deanonFooter.style.display = "none";
        emptyState2.style.display = "flex";
        llmResponse.value = "";
        // Reset session
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
        resultFooter.style.display = "none";

        try {
            const data = await api("anonymize", {
                text: text,
                language: langSelect.value,
            });

            currentSessionId = data.session_id;
            updateSessionBadge(true);

            // Render entities in sidebar
            entitiesList.innerHTML = "";
            if (data.entities.length === 0) {
                entitiesSection.style.display = "block";
                entitiesList.innerHTML =
                    '<span class="text-muted" style="font-size:0.78rem;">Aucune donnee personnelle detectee.</span>';
            } else {
                entitiesSection.style.display = "block";
                data.entities.forEach((e) => {
                    const tag = document.createElement("div");
                    tag.className = `entity-tag ${getEntityClass(e.entity_type)}`;
                    tag.innerHTML =
                        `<span class="entity-type">${escapeHtml(e.entity_type)}</span>` +
                        `<span class="entity-arrow">\u2192</span>` +
                        `<span class="entity-value">${escapeHtml(e.anonymized)}</span>`;
                    tag.title = `Original: "${e.original}" (score: ${e.score})`;
                    entitiesList.appendChild(tag);
                });
            }

            // Show anonymized result
            anonymizedText.innerHTML = highlightPlaceholders(data.anonymized_text);
            anonymizedText.style.display = "block";
            anonymizedText.classList.add("fade-in");
            emptyState1.style.display = "none";
            resultFooter.style.display = "flex";

            // Show deanon section
            divider.style.display = "flex";
            deanonRow.style.display = "grid";
            deanonymizedText.style.display = "none";
            deanonFooter.style.display = "none";
            emptyState2.style.display = "flex";
        } catch (err) {
            toast(err.message, "error");
            emptyState1.style.display = "flex";
        } finally {
            setLoading(false);
        }
    });

    // ---- Copy anonymized ----
    btnCopy.addEventListener("click", () => {
        const text = anonymizedText.textContent;
        navigator.clipboard.writeText(text).then(
            () => toast("Message anonymise copie !"),
            () => toast("Erreur lors de la copie.", "error")
        );
    });

    // ---- De-anonymize ----
    btnDeanonymize.addEventListener("click", async () => {
        const text = llmResponse.value.trim();
        if (!text) {
            toast("Veuillez coller la reponse du LLM.", "error");
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
            deanonymizedText.style.display = "block";
            deanonymizedText.classList.add("fade-in");
            emptyState2.style.display = "none";
            deanonFooter.style.display = "flex";
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
            () => toast("Reponse restauree copiee !"),
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
            entitiesSection.style.display = "none";
            entitiesList.innerHTML = "";
            toast("Session supprimee. Les mappings sont effaces.");
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
