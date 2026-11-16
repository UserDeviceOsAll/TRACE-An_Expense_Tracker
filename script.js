"use strict";
const ICONS = {
    grid: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
    chart: "M3 3v17h18 M6 15l4-5 4 2 6-8", history: "M5 4h14v16l-3-2-4 2-4-2-3 2z M8 8h8 M8 12h6",
    plusbox: "M4 4h16v16H4z M8 12h8 M12 8v8", sliders: "M4 6h5m5 0h6 M4 12h10m5 0h1 M4 18h2m5 0h9 M9 4v4 M15 10v4 M8 16v4",
    plus: "M12 5v14 M5 12h14", briefcase: "M3 7h18v13H3z M8 7V4h8v3 M3 11q9 5 18 0 M11 13h2",
    layers: "m12 3 10 5-10 5L2 8z M2 12l10 5 10-5 M2 16l10 5 10-5",
    sun: "M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2 M16 12a4 4 0 1 1-8 0 4 4 0 1 1 8 0",
    moon: "M20 15a8.5 8.5 0 0 1-11-11A9 9 0 1 0 20 15z", book: "M3 4q5-1 9 2 4-3 9-2v14q-5-1-9 2-4-3-9-2z M12 6v14",
    calendar: "M4 5h16v16H4z M4 10h16 M8 3v4 M16 3v4 M8 14h2 M14 14h2",
    chevron: "m7 10 5 5 5-5", ring: "M12 3a9 9 0 1 0 9 9h-9z M15 3.5V9h5.5a7.5 7.5 0 0 0-5.5-5.5z",
    flow: "M3 5h4v14H3z M17 3h4v5h-4z M17 15h4v6h-4z M7 10c5 0 5-5 10-5 M7 14c5 0 5 4 10 4",
    wallet: "M3 6h17v14H3z M4 6l12-4v4 M15 11h6v5h-6z", pulse: "M2 13h4l3-8 5 15 3-8h5",
    trend: "m3 16 6-6 4 3 7-8 M15 5h5v5", bell: "M5 16h14l-2-4V9a5 5 0 0 0-10 0v3z M10 19q2 3 4 0",
    arrow: "M4 12h15 m-6-6 6 6-6 6", check: "m4 12 5 5L20 6", shield: "m12 3 8 3v6q-1 6-8 9-7-3-8-9V6z M8 12l3 3 5-6"
};
function glyph(name) { return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="${ICONS[name] || ICONS.grid}"/></svg>`; }
function options(values, selected, all) {
    const items = all === undefined ? [] : [`<option value="">${E(all)}</option>`];
    values.forEach(v => {
        const [value, name] = Array.isArray(v) ? v : [v, v];
        items.push(`<option value="${E(value)}" ${value === selected ? "selected" : ""}>${E(name)}</option>`);
    });
    return items.join("");
}
const kindOptions = selected => options(book.types.map(t => t.name), selected);
const repeatOptions = selected => options([["none", "One time"], ["weekly", "Weekly"], ["monthly", "Monthly"], ["yearly", "Yearly"]], selected);
const bases = selected => options([["fixed", "Each selected interval, fixed amount"], ["scaled", "30 days, scaled to report length"]], selected);
const fmtError = error => error?.name === "QuotaExceededError" ? "Browser storage is full. Export a backup and remove a receipt or use a smaller image." : error.message || "The change could not be saved.";
let toastTimer, modalSubmit;
function toast(message) {
    $("#toast").textContent = message;
    $("#toast").classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $("#toast").classList.remove("show"), 4100);
}

function dialog(title, body, button, submit) {
    $("#modal-title").textContent = title;
    $("#modal-body").innerHTML = body;
    $("#modal-error").textContent = "";
    $("#modal-save").textContent = button;
    modalSubmit = submit;
    const modal = $("#modal");
    if (!modal.open)
        modal.showModal();
    return $("#modal-form");
}

function showPurchase(entry) {
    const fields = [["Amount", currency(entry.amount)], ["Date", dateLabel(entry.date,true)], ["Purchase time", entry.time || "Time unknown"],
        ["Type", entry.category], ["Vendor", entry.merchant || "Unspecified"], ["Cost centre", entry.centre], ["Paid with", entry.paymentMethod],
        ["Status", entry.status], ["Style", entry.nature], ["Frequency", entry.recurring], ["Tags", entry.tags || "None"], ["Note", entry.note || "None"]];
    const facts = fields.map(([k,v]) => "<div><dt>" + E(k) + "</dt><dd>" + E(v) + "</dd></div>").join("");
    const receipt = entry.receipt ? '<img class="full-receipt" alt="Expense receipt" src="' + E(entry.receipt) + '">' : "";
    dialog(entry.description, '<dl class="facts">' + facts + '</dl>' + receipt, "Edit expense", () => {
        location.href = "input.html?edit=" + encodeURIComponent(entry.id);
    });
}

function initDialog() {
    const m = $("#modal");
    $("#modal-close").onclick = $("#modal-cancel").onclick = () => m.close();
    $("#modal-form").onsubmit = e => {
        e.preventDefault();
        $("#modal-error").textContent = "";
        try {
            if (modalSubmit(e.currentTarget) !== false)
                m.close();
        }
        catch (err) {
            $("#modal-error").textContent = fmtError(err);
        }
    };
}

function dateDialog() {
    const range = rangeDates(book.range);
    let preset = book.range.preset;
    const presets = [["outlook", "30-day outlook"], ["week", "Last 7 days"], ["last30", "Last 30 days"], ["last90", "Last 90 days"], ["last180", "Last 180 days"], ["all", "All recorded dates"]];
    const form = dialog("Report interval", `<p class="fine">Both dates are included. The 30-day outlook includes today, 20 earlier days and 9 future days.</p>
    <div class="chips">${presets.map(([key, name]) => `<button type="button" data-preset="${key}" aria-pressed="${preset === key}">${name}</button>`).join("")}</div>
    <div class="fields"><label>Start date<input id="from-date" type="date" name="from" value="${range.from}" required></label><label>End date<input id="to-date" type="date" name="to" value="${range.to}" required></label></div>`, "Apply interval", f => {
        const from = f.elements.from.value, to = f.elements.to.value;
        if (!validDate(from) || !validDate(to) || to < from)
            throw Error("Choose an end date on or after the start date.");
        commit(b => { b.range = preset === "custom" ? { preset, from, to } : { preset }; });
        renderPage();
        toast("Report interval updated.");
    });
    function mark() { form.querySelectorAll("[data-preset]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.preset === preset))); }
    form.querySelectorAll("[data-preset]").forEach(b => b.onclick = () => {
        preset = b.dataset.preset;
        const values = rangeDates({ preset });
        form.elements.from.value = values.from;
        form.elements.to.value = values.to;
        mark();
    });
    [form.elements.from, form.elements.to].forEach(el => el.oninput = () => { preset = "custom"; mark(); });
}

function recordCell(e) {
    return `<strong>${E(e.description)}</strong><small>${E([e.merchant, e.tags].filter(Boolean).join(" · ") || e.centre)}</small>`;
}

function typePill(name) { return `<span class="type-pill"><i style="--swatch:${colourOf(name)}"></i>${E(name)}</span>`; }
function warningText(p) {
    if (p.state === "over")
        return currency(p.spent - p.effective) + " over the " + currency(p.effective) + " cap.";
    if (p.state === "reached")
        return "Recorded spending has reached " + currency(p.effective) + ".";
    if (p.state === "near")
        return Math.round(p.percent) + "% used. Your warning point is " + p.warning + "%.";
    return "Projected " + currency(p.forecast) + " against a " + currency(p.effective) + " cap.";
}

function alertsHTML(r) {
    if (!book.budget.alerts)
        return '<p class="signal calm">Warnings are paused in Settings.</p>';
    const active = warningsFor(r);
    return active.map(p => `<div class="signal ${p.rank === 3 ? "critical" : "watch"}"><i>${glyph("bell")}</i><div><strong>${E(p.name)} <span>${stateLabels[p.state]}</span></strong><small>${E((p.from ? intervalText(p.from, p.to) + " · " : "") + warningText(p))}</small></div></div>`).join("") ||
        `<div class="signal calm">${glyph("shield")}<div><strong>${r.policies.length ? "Within your warning thresholds" : "No active limits"}</strong><small>${r.policies.length + " active limits in this interval."}</small></div></div>`;
}

function kpi(title, value, detail, icon, colour) {
    return `<article class="metric ${colour}"><div><span>${E(title)}</span>${glyph(icon)}</div><strong>${E(value)}</strong><small>${E(detail)}</small></article>`;
}

function renderReport() {
    const r = selectedReport(book), budget = effectiveCap(r.budget, r.length);
    const change = r.before ? Math.round((r.total / r.before - 1) * 100) : null;
    const changeLabel = change === null ? "—" : (change > 0 ? "+" : "") + change + "%";
    $("#kpis").innerHTML = kpi("Total spend", currency(r.total), r.selected.length + " transactions", "wallet", "purple")
        + kpi("Budget remaining", budget ? currency(budget - r.total) : "Off", budget ? (r.budget.name || "Interval limit") + " · " + currency(budget) : "Set a budget in Settings", "shield", "teal")
        + kpi("Daily average", currency(r.average), r.elapsed + " elapsed days", "pulse", "peach")
        + kpi("Previous interval", changeLabel, r.before ? "Prior spend " + currency(r.before) : "No comparison entries", "trend", "blue");
    drawCurve(r);
    drawMix(r);
    $("#alerts-list").innerHTML = alertsHTML(r);
    const list = warningsFor(r), banner = $("#rule-signal");
    if (banner) {
        banner.hidden = !list.length;
        if (list.length)
            banner.innerHTML = glyph("bell") + "<strong>" + list.length + " budget " + (list.length === 1 ? "warning" : "warnings") + "</strong><span>" + E(list[0].name) + " · " + stateLabels[list[0].state] + "</span><b>Review ↓</b>";
    }
    if ($("#recent-list")) {
        const latest = [...r.selected].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
        $("#recent-list").innerHTML = latest.map(e => `<tr><th scope="row">${recordCell(e)}</th><td>${typePill(e.category)}</td><td>${E(dateLabel(e.date, true))}</td><td class="num">${E(currency(e.amount))}</td></tr>`).join("");
        $("#recent-empty").hidden = !!latest.length;
    }
    else {
        drawFlow(r);
        drawTrend(r);
        drawCalendar(r);
        drawDecision(r);
        drawTypeReport(r);
        const counts = countWeekdays(r.start, r.elapsed), totals = Array(7).fill(0);
        r.selected.forEach(e => { totals[weekDay(dayOf(e.date))] += e.amount; });
        const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        drawBars("#weekday-chart", [1, 2, 3, 4, 5, 6, 0].map(i => ({ name: names[i], value: counts[i] ? totals[i] / counts[i] : 0 })));
        drawBars("#centre-chart", groupSmall(ranked(r.selected, "centre"), 6, "Other teams"));
        drawBars("#nature-chart", ranked(r.selected, "nature").map(p => ({ ...p, name: p.name === "essential" ? "Essential" : "Flexible" })));
        const recurring = sumAmount(r.selected.filter(e => e.recurring !== "none")), top = ranked(r.selected.filter(e => e.merchant), "merchant")[0];
        $("#commitments").textContent = currency(recurring) + " marked as recurring.";
        $("#vendor-insight").textContent = top ? "Largest vendor · " + top.name + " · " + currency(top.value) : "";
    }
}

function renderPage() {
    const range = rangeDates(book.range);
    document.querySelectorAll(".range-label").forEach(n => n.textContent = intervalText(range.from, range.to));
    switch (document.body.dataset.page) {
        case "index":
        case "analysis":
            renderReport();
            break;
        case "settings":
            renderSettings();
            break;
        case "history":
            renderHistory();
            break;
        case "input":
            updateImpact();
            break;
    }
}

function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    $("#theme-toggle").setAttribute("aria-label", theme === "dark" ? "Use light appearance" : "Use dark appearance");
    $("#theme-toggle").innerHTML = glyph(theme === "dark" ? "sun" : "moon") + "<span>" + (theme === "dark" ? "Light" : "Dark") + " appearance</span>";
}

function switchBook(name) {
    try {
        if (name!=="example" && !profileFor(name)) throw Error("This user is no longer available.");
        rememberWorkspace(name);
        // Editing IDs and text filters belong to the current workspace.
        location.assign(location.pathname.split("/").pop() || "index.html");
    }
    catch (err) {
        toast(fmtError(err));
    }
}

function boot() {
    if (location.pathname.endsWith("analysis.html") && location.hash === "#limits") {
        location.replace("settings.html");
        return;
    }
    openBook();
    initDialog();
    document.querySelectorAll("[data-icon]").forEach(el => el.innerHTML = glyph(el.dataset.icon));
    initWorkspacePicker();
    document.querySelectorAll("[data-range]").forEach(b => { b.title = "Change report interval"; b.onclick = dateDialog; });
    const page = document.body.dataset.page;
    if (page === "input")
        initEntry();
    if (page === "history")
        initHistory();
    if (page === "settings")
        initSettings();
    if ($("#print-report"))
        $("#print-report").onclick = () => window.print();
    if (page === "index" || page === "analysis") {
        const link = document.createElement("a");
        link.id = "rule-signal";
        link.className = "rule-signal";
        link.href = "#alerts-heading";
        link.hidden = true;
        $("#kpis").before(link);
        let chartWidth = $("#forecast-chart").clientWidth;
        new ResizeObserver(entries => { const width = Math.round(entries[0].contentRect.width); if (width !== chartWidth) {
            chartWidth = width;
            renderReport();
        } }).observe($("#forecast-chart"));
    }
    renderPage();
    const saved = new URLSearchParams(location.search).get("saved");
    if (saved)
        toast(saved === "updated" ? "Expense updated." : "Expense recorded.");
    window.addEventListener("storage", e => {
        if (e.key?.startsWith(PROFILE_KEY)) {
            if (workspace!=="example" && !profileFor(workspace)) {
                switchBook(preferredUser() || "example");
                return;
            }
            refreshWorkspacePicker();
            if (page==="settings") renderUsers();
            if (page==="input") $("#entry-workspace").textContent="Saving to "+(profileFor(workspace)?.name || "the example ledger")+".";
        }
        if (e.key === LEDGER_KEY + workspace && e.newValue) {
            book = JSON.parse(e.newValue);
            if (page === "input")
                updateImpact();
            else if (!$("#modal").open)
                renderPage();
        }
    });
}
try {
    boot();
}
catch (err) {
    const message = document.createElement("p");
    message.className = "fatal";
    message.setAttribute("role", "alert");
    message.textContent = "Trace could not open the ledger. " + fmtError(err);
    document.querySelector(".page").prepend(message);
    console.error(err);
}
