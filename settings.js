"use strict";
function basisNote(rule) { return rule.basis === "scaled" ? "per 30 days" : "per interval"; }
function ruleFields(rule) {
    return `<div class="fields"><label>Limit (₹)<input name="limit" id="rule-cap" type="number" min="0" max="1000000000" step=".01" value="${rule.cap}" required></label><label>Early warning (%)<input name="warning" id="rule-warning" type="number" min="1" max="100" step="1" value="${rule.warning}" required></label><label class="wide">Limit applies to<select name="basis">${bases(rule.basis)}</select></label></div>`;
}

function fromRuleForm(form) {
    return { cap: Number(form.elements.limit.value), warning: Number(form.elements.warning.value), basis: form.elements.basis.value };
}

function applyAfter(save, message) { if (save)
    save();
else
    renderPage(); toast(message); }
function editType(name = null, after) {
    const old = book.types.find(t => t.name === name);
    const type = old || { ...starter("Personal", book.types.length), description: "Business expense" };
    const builtin = STARTERS.some(r => r[0] === name);
    const body = `<div class="fields"><label>Type name<input name="typeName" maxlength="28" value="${E(old?.name || "")}" placeholder="e.g. Client travel" ${builtin ? "readonly" : ""} required></label>
    <label>Colour<input type="color" name="colour" value="${E(type.colour)}"></label><label>Default description<input name="description" maxlength="80" value="${E(type.description)}" required></label>
    <label>Quick amount (₹)<input name="quick" type="number" min=".01" max="10000000" step=".01" value="${type.quick}" required></label></div>${ruleFields(type)}`;
    dialog(old ? "Edit expense type" : "New expense type", body, old ? "Save type" : "Create type", form => {
        const f = form.elements, nextName = typeName(f.typeName.value), description = label(f.description.value);
        if (!nextName || !description)
            throw Error("Enter a type name and a default description.");
        commit(draft => {
            if (draft.types.some(t => sameName(t.name, nextName) && t.name !== name))
                throw Error("This expense type already exists.");
            const current = old ? draft.types.find(t => t.name === name) : ensureType(draft, nextName);
            if (!current)
                throw Error("This type was deleted in another tab. Open Settings again.");
            if (old && name !== nextName) {
                draft.expenses.forEach(e => { if (e.category === name)
                    e.category = nextName; });
                draft.groups.forEach(g => { g.members = g.members.map(n => n === name ? nextName : n); });
                if (draft.defaults.category === name)
                    draft.defaults.category = nextName;
            }
            Object.assign(current, { name: nextName, description, quick: Number(f.quick.value), colour: f.colour.value }, fromRuleForm(form));
        });
        applyAfter(after ? () => after(nextName) : null, "Expense type saved.");
    });
}

function deleteType(name) {
    const count = book.expenses.filter(e => e.category === name).length;
    const other = book.types.filter(t => t.name !== name).map(t => t.name);
    dialog("Delete " + name + "?", `<p>${count} existing ${count === 1 ? "expense" : "expenses"} will keep their dates, amounts and receipts. Choose where to move them. Shared limits and entry defaults will use the replacement too.</p><label>Move records to<select name="replacement">${options(other, "Other")}</select></label>`, "Delete type & move records", form => {
        commit(draft => removeType(draft, name, form.elements.replacement.value));
        renderPage();
        toast("Personal type deleted. Records retained.");
    });
}

function editLimit(id = null) {
    const existing = book.groups.find(g => g.id === id);
    const selected = existing?.members || [book.defaults.category];
    const rule = existing || { cap: 5000, warning: 80, basis: "fixed" };
    const members = book.types.map(t => `<label class="check"><input type="checkbox" name="member" value="${E(t.name)}" ${selected.includes(t.name) ? "checked" : ""}>${E(t.name)}</label>`).join("");
    const body = `<label>How to apply the limit<select name="mode" ${existing ? "disabled" : ""}>${options([["each", "A separate cap for each selected type"], ["shared", "One shared cap across selected types"]], existing ? "shared" : "each")}</select></label>
    <label id="group-name-field">Group name<input name="groupName" maxlength="60" value="${E(existing?.name || "Shared expenses")}"></label>
    <fieldset class="member-field"><legend>Expense types</legend><div class="chips member-tools"><button id="select-members" type="button">Select all</button><button id="clear-members" type="button">Clear selection</button></div><div class="members">${members}</div></fieldset>${ruleFields(rule)}`;
    const form = dialog(existing ? "Edit shared limit" : "Add a spending limit", body, "Save limit", f => {
        const names = [...f.querySelectorAll("[name=member]:checked")].map(e => e.value);
        if (!names.length)
            throw Error("Select at least one expense type.");
        const fields = fromRuleForm(f), shared = f.elements.mode.value === "shared", name = label(f.elements.groupName.value, 60);
        if (shared && !name)
            throw Error("Give the shared limit a name.");
        commit(draft => {
            if (names.some(n => !draft.types.some(t => t.name === n)))
                throw Error("A selected type has changed. Reopen the rule.");
            if (!shared)
                draft.types.filter(t => names.includes(t.name)).forEach(t => Object.assign(t, fields));
            else {
                const group = { ...fields, id: id || uid(), name, members: names };
                if (id) {
                    const old = draft.groups.find(g => g.id === id);
                    if (!old)
                        throw Error("This rule has been removed.");
                    Object.assign(old, group);
                }
                else
                    draft.groups.push(group);
            }
        });
        renderPage();
        toast(shared ? "Shared limit saved." : "Individual limits updated.");
    });
    const sync = () => { $("#group-name-field").hidden = form.elements.mode.value !== "shared"; };
    sync();
    form.elements.mode.onchange = sync;
    const checkAll = checked => form.querySelectorAll("[name=member]").forEach(el => el.checked = checked);
    $("#select-members").onclick = () => checkAll(true);
    $("#clear-members").onclick = () => checkAll(false);
}

function deleteGroup(id) {
    const group = book.groups.find(g => g.id === id);
    if (!group)
        return;
    dialog("Remove shared limit?", `<p>Remove the ${E(group.name)} rule for ${E(group.members.join(", "))}? Individual caps will still apply.</p>`, "Remove limit", () => {
        commit(b => { b.groups = b.groups.filter(g => g.id !== id); });
        renderPage();
        toast("Shared limit removed.");
    });
}

function editPlan(id) {
    const existing = (book.periodBudgets || []).find(p => p.id === id);
    const range = rangeDates(book.range);
    const p = existing || { ...range, name: "Operating budget", cap: effectiveCap(book.budget, dayOf(range.to)-dayOf(range.from)+1) || 60000, warning: book.budget.warning };
    const fields = `<div class="fields">
        <label class="wide">Budget name<input name="planName" maxlength="60" value="${E(p.name)}" required></label>
        <label>Start date<input name="from" type="date" value="${E(p.from)}" required></label>
        <label>End date<input name="to" type="date" value="${E(p.to)}" required></label>
        <label>Allowance (₹)<input name="cap" type="number" min=".01" max="1000000000" step=".01" value="${p.cap}" required></label>
        <label>Warn at (%)<input name="warning" type="number" min="1" max="100" value="${p.warning}" required></label></div>`;
    dialog(existing ? "Edit dated budget" : "New dated budget", fields, "Save dated budget", form => {
        const fields = form.elements, name = label(fields.planName.value, 60), from = fields.from.value, to = fields.to.value;
        if (!name || !validDate(from) || !validDate(to) || to < from) throw Error("Enter a name and an end date on or after the start.");
        commit(draft => {
            const plans = draft.periodBudgets ||= [];
            if (plans.some(p => p.id !== id && p.from === from && p.to === to)) throw Error("This date interval already has a budget. Edit its allowance.");
            const updated = { id: id || uid(), name, from, to, cap: Number(fields.cap.value), warning: Number(fields.warning.value), basis: "fixed" };
            if (!id) plans.push(updated);
            else {
                const saved = plans.find(p => p.id === id);
                if (!saved) throw Error("This budget was removed in another tab.");
                Object.assign(saved, updated);
            }
        });
        renderPage();
        toast("Dated budget saved.");
    });
}

function renderPlans() {
    const today = todayISO(), plans = [...(book.periodBudgets || [])].sort((a,b) => b.from.localeCompare(a.from));
    $("#plan-list").innerHTML = plans.map(p => {
        const spent = sumAmount(book.expenses.filter(e => e.date >= p.from && e.date <= p.to && e.date <= today));
        const period = today < p.from ? "Upcoming" : today > p.to ? "Completed" : "In progress";
        return `<article class="plan-row"><div><small>${period} · ${E(intervalText(p.from,p.to))}</small><h3>${E(p.name)}</h3>
            <span>${E(currency(spent))} of ${E(currency(p.cap))} · Warning at ${p.warning}%</span></div>
            <meter aria-label="${E(p.name)} usage" min="0" max="100" value="${Math.min(100,spent/p.cap*100)}"></meter>
            <div class="actions" data-plan="${E(p.id)}"><button class="small-btn" data-act="view">View report</button>
            <button class="small-btn" data-act="edit">Edit</button><button class="small-btn danger" data-act="remove">Remove</button></div></article>`;
    }).join("") || '<p class="fine">Add your first dated budget. Its report will track every purchase between the two dates against one allowance.</p>';
}

function renderSettings() {
    renderUsers();
    renderPlans();
    const r = selectedReport(book), f = $("#budget-form").elements;
    f.cap.value = book.budget.cap;
    f.basis.value = book.budget.basis;
    f.warning.value = book.budget.warning;
    f.alerts.checked = book.budget.alerts;
    f.projection.checked = book.budget.projection;
    $("#effective-budget").textContent = currency(effectiveCap(book.budget, r.length)) + " for " + intervalText(r.from, r.to) + " · " + r.length + " days";
    $("#rule-list").innerHTML = book.groups.map(g => {
        const p = r.policies.find(p => p.kind === "Group" && p.id === g.id);
        return `<article class="setting-row"><div><strong>${E(g.name)}</strong><small>${E(g.members.join(" + "))}</small><small>${E(currency(g.cap))} ${basisNote(g)} · Warn at ${g.warning}%</small></div><div><span class="state ${p?.rank ? "watch" : ""}">${p ? E(currency(p.spent) + " / " + currency(p.effective)) : "Off"}</span></div><div class="actions"><button class="small-btn" data-edit-group="${E(g.id)}">Edit</button><button class="small-btn danger" data-remove-group="${E(g.id)}">Remove</button></div></article>`;
    }).join("") || '<p class="fine">Individual limits are active for each type below. Add a shared limit to track several types together.</p>';
    $("#type-list").innerHTML = book.types.map(t => {
        const isBase = STARTERS.some(row => row[0] === t.name);
        return `<div class="setting-row"><div>${typePill(t.name)}<small>${E(t.description)} · ${E(currency(t.quick))} default</small></div><div><strong>${t.cap ? E(currency(t.cap)) : "Off"}</strong><small>${basisNote(t)} · Warn at ${t.warning}%</small></div><div class="actions"><button class="small-btn" data-edit-type="${E(t.name)}" aria-label="Edit ${E(t.name)}">Edit</button>${isBase ? "" : `<button class="small-btn danger" data-delete-type="${E(t.name)}" aria-label="Delete ${E(t.name)}">Delete</button>`}</div></div>`;
    }).join("");
    const d = book.defaults, fields = $("#defaults-form").elements;
    fields.category.innerHTML = kindOptions(d.category);
    fields.paymentMethod.innerHTML = options(PAYMENTS, d.paymentMethod);
    fields.recurring.innerHTML = repeatOptions(d.recurring);
    fields.status.innerHTML = options(STATUSES, d.status);
    ["centre", "merchant", "nature", "tags", "note"].forEach(k => fields[k].value = d[k]);
}

function initSettings() {
    initUserSettings();
    $("#new-plan").onclick = () => editPlan();
    $("#plan-list").onclick = event => {
        const button = event.target.closest("[data-act]");
        if (!button) return;
        const id = button.parentElement.dataset.plan, p = book.periodBudgets.find(p => p.id === id);
        if (button.dataset.act === "edit") editPlan(id);
        if (button.dataset.act === "view") {
            commit(draft => { draft.range = {preset: "custom", from: p.from, to: p.to}; });
            location.href = "analysis.html";
        }
        if (button.dataset.act === "remove") dialog("Remove dated budget?", `<p>Remove the allowance for ${E(p.name)}? All purchases stay in the ledger.</p>`, "Remove budget", () => {
            commit(draft => { draft.periodBudgets = draft.periodBudgets.filter(plan => plan.id !== id); });
            renderPage();
            toast("Dated budget removed.");
        });
    };
    $("#budget-form").onsubmit = e => {
        e.preventDefault();
        const f = e.target.elements;
        try {
            commit(b => { b.budget = { cap: Number(f.cap.value), basis: f.basis.value, warning: Number(f.warning.value), alerts: f.alerts.checked, projection: f.projection.checked }; });
            renderPage();
            toast("Budget and warnings saved.");
        }
        catch (err) {
            toast(fmtError(err));
        }
    };
    $("#defaults-form").onsubmit = e => {
        e.preventDefault();
        const values = Object.fromEntries(new FormData(e.target));
        try {
            commit(b => { b.defaults = cleanDefaults(values, b); });
            renderPage();
            toast("Entry defaults saved.");
        }
        catch (err) {
            toast(fmtError(err));
        }
    };
    $("#new-rule").onclick = () => editLimit();
    $("#new-type").onclick = () => editType();
    $("#rules").onclick = e => {
        const b = e.target.closest("[data-edit-group],[data-remove-group]");
        if (!b)
            return;
        if (b.dataset.editGroup)
            editLimit(b.dataset.editGroup);
        else
            deleteGroup(b.dataset.removeGroup);
    };
    $("#types").onclick = e => {
        const b = e.target.closest("[data-edit-type],[data-delete-type]");
        if (!b)
            return;
        if (b.dataset.editType)
            editType(b.dataset.editType);
        else
            deleteType(b.dataset.deleteType);
    };
}
