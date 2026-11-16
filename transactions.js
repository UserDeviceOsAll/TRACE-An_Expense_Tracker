"use strict";
let editId = null, attachedReceipt = "", receiptPending = false, receiptRead = 0, historyPage = 0;
const entryKeys = ["category", "amount", "description", "date", "time", "paymentMethod", "merchant", "centre", "nature", "recurring", "status", "tags", "note"];
function templateFor(name) {
    const t = book.types.find(t => t.name === name) || book.types[0];
    return { ...book.defaults, category: t.name, description: t.description, amount: t.quick, date: todayISO(), time: currentTime(), receipt: "" };
}

function setEntry(e) {
    const f = $("#expense-form").elements;
    f.category.innerHTML = kindOptions(e.category);
    for (const k of entryKeys)
        f[k].value = k === "amount" ? Number(e[k]).toFixed(2) : (e[k] ?? "");
    receiptRead++;
    receiptPending = false;
    attachedReceipt = e.receipt || "";
    $("#receipt").value = "";
    showReceipt();
    $("#save-expense").disabled = false;
    if (editId && (attachedReceipt || e.note))
        $("#more-details").open = true;
    updateImpact();
}

function showReceipt() {
    $("#receipt-preview").innerHTML = attachedReceipt ? `<img class="receipt-thumb" alt="Attached expense receipt" src="${attachedReceipt}"><button class="small-btn" id="remove-receipt" type="button">Remove receipt</button>` : "";
    const b = $("#remove-receipt");
    if (b)
        b.onclick = () => { receiptRead++; receiptPending = false; attachedReceipt = ""; $("#receipt").value = ""; $("#save-expense").disabled = false; showReceipt(); };
}

function updateImpact() {
    const form = $("#expense-form");
    if (!form)
        return;
    const range = rangeDates(book.range), values = Object.fromEntries(new FormData(form)), target = $("#entry-impact");
    $("#impact-range").textContent = intervalText(range.from, range.to);
    if (!validDate(values.date) || !Number(values.amount)) {
        target.textContent = "Enter a valid amount and date to check its impact.";
        return;
    }
    if (values.date < range.from || values.date > range.to) {
        target.textContent = "This expense falls outside the report interval.";
        return;
    }
    if (!book.budget.alerts) {
        target.textContent = "Warnings are paused in Settings.";
        return;
    }
    const next = { ...book, expenses: [...book.expenses.filter(e => e.id !== editId), { ...values, amount: Number(values.amount) }] };
    const r = selectedReport(next), affected = r.policies.filter(p => (!p.members || p.members.includes(values.category)) && (!p.from || (values.date >= p.from && values.date <= p.to)));
    target.innerHTML = affected.map(p => `<div class="impact-row"><div><strong>${E(p.name)}</strong><span class="state ${p.rank === 3 ? "critical" : p.rank ? "watch" : ""}">${stateLabels[p.state]}</span></div><meter aria-label="${E(p.name)} usage" min="0" max="100" value="${Math.min(100, p.percent)}"></meter><small>${E(currency(p.spent))} of ${E(currency(p.effective))} after saving · warning at ${p.warning}%</small></div>`).join("") || '<p class="fine">Set a limit to see the effect of this expense.</p>';
}

function initEntry() {
    const form = $("#expense-form"), f = form.elements, params = new URLSearchParams(location.search);
    f.date.max = todayISO();
    f.paymentMethod.innerHTML = options(PAYMENTS);
    f.status.innerHTML = options(STATUSES);
    f.recurring.innerHTML = repeatOptions();
    $("#entry-workspace").textContent = "Saving to " + (profileFor(workspace)?.name || "the example ledger") + ".";
    const existing = book.expenses.find(e => e.id === params.get("edit"));
    if (params.get("edit") && !existing)
        $("#form-error").textContent = "This expense no longer exists. You can record a new entry.";
    if (existing) {
        editId = existing.id;
        $("#entry-title").textContent = "Edit expense";
        $("#save-expense").textContent = "Save changes";
    }
    setEntry(existing || templateFor(book.defaults.category));
    const datalist = (id, values) => { $(id).replaceChildren(...unique(values.filter(Boolean)).slice(0, 80).map(v => new Option(v, v))); };
    datalist("#vendors", book.expenses.map(e => e.merchant));
    datalist("#suggest-descriptions", book.expenses.map(e => e.description));
    datalist("#centres", [book.defaults.centre, "General", "Operations", "Sales", "Finance", "Product", ...book.expenses.map(e => e.centre)]);
    const templates = unique([book.defaults.category, "Transport", "Office", "Software"]).slice(0, 4).map(templateFor);
    const recent = [...book.expenses].sort((a, b) => b.date.localeCompare(a.date)).filter((e, i, rows) => rows.findIndex(a => a.description === e.description && a.amount === e.amount) === i).slice(0, 3);
    function shortcuts(node, rows, repeated) {
        node.innerHTML = (rows.length && repeated ? "<h3>Recent purchases</h3>" : "") + rows.map((e, i) => `<button type="button" class="shortcut" data-i="${i}"><i style="--swatch:${colourOf(e.category)}"></i><span>${E(e.description)}</span><b>${E(currency(e.amount))}</b></button>`).join("");
        node.onclick = event => { const btn = event.target.closest("[data-i]"); if (!btn)
            return; setEntry({ ...rows[Number(btn.dataset.i)], date: todayISO(), time: currentTime(), receipt: "" }); toast("Template applied. Review and save."); };
    }
    shortcuts($("#templates"), templates, false);
    shortcuts($("#recent-templates"), recent, true);
    let lastType = f.category.value;
    f.category.onchange = () => {
        const before = book.types.find(t => t.name === lastType), after = templateFor(f.category.value);
        if (!editId && (!f.description.value || f.description.value === before?.description))
            f.description.value = after.description;
        if (!editId && (!f.amount.value || Number(f.amount.value) === before?.quick))
            f.amount.value = after.amount.toFixed(2);
        lastType = f.category.value;
        updateImpact();
    };
    $("#templates").addEventListener("click", () => { lastType = f.category.value; });
    $("#recent-templates").addEventListener("click", () => { lastType = f.category.value; });
    const addType = document.createElement("button");
    addType.type = "button";
    addType.className = "text-button";
    addType.textContent = "Create expense type";
    document.querySelector(".entry-grid .card-head").append(addType);
    addType.onclick = () => editType(null, name => { const selected = templateFor(name); f.category.innerHTML = kindOptions(name); f.description.value = selected.description; f.amount.value = selected.amount.toFixed(2); lastType = name; updateImpact(); });
    [f.amount, f.date].forEach(c => c.oninput = updateImpact);
    $("#receipt").onchange = async (event) => {
        const ticket = ++receiptRead, file = event.target.files[0];
        receiptPending = false;
        $("#save-expense").disabled = false;
        if (!file)
            return;
        $("#form-error").textContent = "";
        if (!["image/jpeg", "image/webp", "image/png"].includes(file.type) || file.size > 400 * 1024) {
            event.target.value = "";
            $("#form-error").textContent = "Choose a PNG, JPEG or WebP image up to 400 KB.";
            return;
        }
        receiptPending = true;
        $("#save-expense").disabled = true;
        try {
            const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(Error("Could not read the receipt.")); reader.readAsDataURL(file); });
            const preview = new Image();
            preview.src = data;
            await preview.decode();
            if (ticket === receiptRead) {
                attachedReceipt = receiptImage(data);
                showReceipt();
            }
        }
        catch (err) {
            if (ticket === receiptRead)
                $("#form-error").textContent = "This receipt image could not be opened.";
        }
        finally {
            if (ticket === receiptRead) {
                receiptPending = false;
                $("#save-expense").disabled = false;
            }
        }
    };
    form.onsubmit = event => {
        event.preventDefault();
        if (receiptPending)
            return;
        try {
            const values = Object.fromEntries(new FormData(form)), id = editId || uid();
            commit(draft => {
                if (!draft.types.some(t => t.name === values.category))
                    throw Error("This expense type has changed. Select an existing type.");
                const e = cleanExpense({ ...values, id, receipt: attachedReceipt }, draft);
                if (!e || e.date > todayISO())
                    throw Error("Review the description, amount and expense date.");
                const i = draft.expenses.findIndex(x => x.id === id);
                if (editId && i < 0)
                    throw Error("This expense was deleted in another tab.");
                if (i >= 0)
                    draft.expenses[i] = e;
                else
                    draft.expenses.unshift(e);
            });
            location.href = "history.html?saved=" + (editId ? "updated" : "added") + "&entry=" + encodeURIComponent(id);
        }
        catch (err) {
            $("#form-error").textContent = fmtError(err);
        }
    };
}

function filteredHistory() {
    const f = $("#filters").elements, term = f.search.value.toLowerCase().trim(), { from, to } = rangeDates(book.range);
    const selectedDay = new URLSearchParams(location.search).get("day");
    const end = to < todayISO() ? to : todayISO();
    const list = book.expenses.filter(e => e.date >= from && e.date <= end && (!validDate(selectedDay) || e.date === selectedDay)
        && ["category", "centre", "status", "nature", "recurring"].every(k => !f[k].value || f[k].value === e[k])
        && (!term || [e.description, e.merchant, e.category, e.note, e.tags, e.centre, e.paymentMethod, e.status].join(" ").toLowerCase().includes(term)));
    const sorters = { newest: (a, b) => b.date.localeCompare(a.date), oldest: (a, b) => a.date.localeCompare(b.date), high: (a, b) => b.amount - a.amount, low: (a, b) => a.amount - b.amount, name: (a, b) => a.description.localeCompare(b.description) };
    return list.sort(sorters[f.sort.value]);
}

function renderHistory() {
    const f = $("#filters").elements;
    const populate = (el, values, all) => { const value = el.value; el.innerHTML = options(values, value, all); };
    populate(f.category, book.types.map(t => t.name), "All types");
    populate(f.centre, unique(book.expenses.map(e => e.centre)).sort(), "All cost centres");
    const list = filteredHistory(), pages = Math.max(1, Math.ceil(list.length / 20));
    historyPage = Math.min(historyPage, pages - 1);
    $("#history-list").innerHTML = list.slice(historyPage * 20, (historyPage + 1) * 20).map(e => `<tr>
    <th scope="row"><button class="record-button" data-view="${E(e.id)}">${recordCell(e)}</button></th><td>${typePill(e.category)}</td><td>${E(dateLabel(e.date, true))}</td><td>${E(e.centre)}</td><td>${E(e.paymentMethod)}<small>${E(e.status)}</small></td><td class="num">${E(currency(e.amount))}</td><td><div class="actions"><a class="small-btn" href="input.html?edit=${encodeURIComponent(e.id)}" aria-label="Edit ${E(e.description)}">Edit</a><button class="small-btn danger" data-remove="${E(e.id)}" aria-label="Delete ${E(e.description)}">Delete</button></div></td></tr>`).join("");
    $("#filtered-total").textContent = currency(sumAmount(list));
    $("#history-empty").hidden = list.length > 0;
    $("#history-status").textContent = list.length + " matching transactions · " + book.expenses.length + " in this ledger";
    $("#pager").innerHTML = pages <= 1 ? "" : `<button class="small-btn" data-step="-1" ${!historyPage ? "disabled" : ""}>Previous</button><span>Page ${historyPage + 1} of ${pages}</span><button class="small-btn" data-step="1" ${historyPage === pages - 1 ? "disabled" : ""}>Next</button>`;
}

function downloadFile(name, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type })), link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function csvCell(value) {
    let text = String(value || "");
    if (/^[\s]*[=+@\u002d]/.test(text))
        text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
}

function initHistory() {
    const form = $("#filters"), f = form.elements, params = new URLSearchParams(location.search);
    if (validDate(params.get("day"))) {
        const clear = document.createElement("a");
        clear.className = "sub-link";
        clear.href = "history.html";
        clear.textContent = "Viewing " + dateLabel(params.get("day"), true) + " · Clear day filter";
        form.before(clear);
    }
    f.category.innerHTML = options(book.types.map(t => t.name), params.get("type"), "All types");
    f.status.innerHTML = options(STATUSES, "", "All statuses");
    f.recurring.innerHTML = options(FREQUENCIES.map(n => [n, n === "none" ? "One time" : n]), "", "All frequencies");
    form.onsubmit = e => e.preventDefault();
    form.oninput = () => { historyPage = 0; renderHistory(); };
    form.onreset = () => setTimeout(() => { for (const k of ["search", "category", "centre", "status", "nature", "recurring"])
        f[k].value = ""; f.sort.value = "newest"; historyPage = 0; renderHistory(); });
    $("#pager").onclick = e => { const b = e.target.closest("[data-step]"); if (b) {
        historyPage += Number(b.dataset.step);
        renderHistory();
    } };
    $("#history-list").onclick = e => {
        const button = e.target.closest("[data-view],[data-remove]");
        if (!button)
            return;
        const entry = book.expenses.find(x => x.id === (button.dataset.view || button.dataset.remove));
        if (!entry)
            return;
        if (button.dataset.remove) {
            dialog("Delete expense?", `<p>Remove ${E(entry.description)} (${E(currency(entry.amount))}) dated ${E(dateLabel(entry.date, true))} from this ledger?</p>`, "Delete expense", () => {
                commit(b => { b.expenses = b.expenses.filter(x => x.id !== entry.id); });
                renderPage();
                toast("Expense deleted.");
            });
        }
        else {
            showPurchase(entry);
        }
    };
    $("#csv-export").onclick = () => {
        const keys = ["date", "time", "description", "category", "amount", "merchant", "centre", "paymentMethod", "status", "nature", "recurring", "tags", "note"];
        const rows = [keys.join(","), ...filteredHistory().map(e => keys.map(k => k === "amount" ? e.amount.toFixed(2) : csvCell(e[k])).join(","))];
        downloadFile("trace-" + workspace + "-filtered.csv", "\uFEFF" + rows.join("\r\n"), "text/csv;charset=utf-8");
    };
    $("#export-btn").onclick = () => downloadFile("trace-" + workspace + "-" + todayISO() + ".json", JSON.stringify({ app: "Trace", version: 3, workspace, owner: profileFor(workspace)?.name, book }, null, 2), "application/json");
    $("#import-btn").onclick = () => $("#import-file").click();
    $("#import-file").onchange = async (e) => {
        const file = e.target.files[0];
        if (!file)
            return;
        try {
            const data = JSON.parse(await file.text()), plan = importPlan(data, book);
            dialog("Import into " + (profileFor(workspace)?.name || "Example ledger") + "?", `<p>${plan.count} valid records in this backup. Matching IDs and supplied settings will be updated. Other expenses stay in the ledger.</p>${plan.skipped ? `<p>${plan.skipped} invalid records will be skipped.</p>` : ""}`, "Import backup", () => {
                commit(b => importPlan(data, b).book);
                renderPage();
                toast("Backup imported.");
            });
        }
        catch (err) {
            toast("Backup could not be imported. " + fmtError(err));
        }
        finally {
            e.target.value = "";
        }
    };
    const saved = book.expenses.find(e => e.id === params.get("entry")), range = rangeDates(book.range);
    if (saved && (saved.date < range.from || saved.date > range.to)) {
        const b = document.createElement("button");
        b.className = "button secondary";
        b.textContent = "Show saved expense on " + dateLabel(saved.date, true);
        form.before(b);
        b.onclick = () => { try {
            commit(d => { d.range = { preset: "custom", from: saved.date, to: saved.date }; });
            b.remove();
            renderPage();
        }
        catch (err) {
            toast(fmtError(err));
        } };
    }
}
