"use strict";
const $ = selector => document.querySelector(selector);
const htmlEscape = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const E = htmlEscape;
function colourOf(name) { return book.types.find(t => t.name === name)?.colour || "#9da8bc"; }
function valueTable(headers, rows, caption) {
    return `<div class="table-wrap"><table><caption class="sr">${E(caption)}</caption><thead><tr>${headers.map(h => "<th scope='col'>" + E(h) + "</th>").join("")}</tr></thead><tbody>${rows.map(row => "<tr>" + row.map((cell, i) => i === 0 ? "<th scope='row'>" + E(cell) + "</th>" : "<td>" + E(cell) + "</td>").join("") + "</tr>").join("")}</tbody></table></div>`;
}

function chartSVG(width, height, title, contents) {
    return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${E(title)}"><title>${E(title)}</title>${contents}</svg>`;
}
const svgText = (x, y, value, anchor = "start", cls = "axis-label") => `<text x="${x}" y="${y}" text-anchor="${anchor}" class="${cls}">${E(value)}</text>`;
function emptyPlot(target, message) {
    target.innerHTML = `<div class="empty-plot"><span class="empty-orbit"></span><p>${E(message)}</p></div>`;
}

function niceStep(maximum) {
    const raw = Math.max(1, maximum / 4), unit = 10 ** Math.floor(Math.log10(raw));
    return ([1, 2, 2.5, 5, 10].find(n => n >= raw / unit) || 10) * unit;
}

function drawCurve(report) {
    const r = chartScope(report);
    const mode = document.querySelector("[name=chart-view]:checked").value;
    const grouped = mode === "category" || mode === "merchant";
    $("#bucket-label").hidden = !grouped;
    $(".curve-card .key").hidden = mode !== "cumulative";
    $("#occurrence-panel").hidden = mode !== "cumulative" || !r.model.enough;
    if (mode !== "cumulative") {
        $("#forecast-hero").hidden = $("#forecast-stats").hidden = true;
        drawTimeline(r, mode);
        return;
    }
    const target = $("#forecast-chart"), select = $("#forecast-horizon"), model = r.model;
    const horizon = select.value === "auto" ? model.futureDays : Number(select.value);
    const { actual, future } = chartSeries(r, horizon);
    select.onchange = () => drawCurve(report);
    $("#forecast-hero").hidden = !model.enough;
    $("#forecast-stats").hidden = !model.enough;
    $("#curve-period").textContent = intervalText(r.from, r.to);
    if (!r.selected.length) {
        emptyPlot(target, r.future ? "The selected interval begins in the future." : "Record an expense to plot your spending.");
        const action = document.createElement("button");
        action.type = "button";
        action.className = "small-btn";
        if (book.expenses.some(e => e.date <= todayISO())) {
            action.textContent = "Show all recorded dates";
            action.onclick = () => { try {
                commit(b => { b.range = { preset: "all" }; });
                renderPage();
            }
            catch (err) {
                toast(fmtError(err));
            } };
        }
        else {
            action.textContent = "Explore example charts";
            action.onclick = () => switchBook("example");
        }
        if (!report.selected.length) target.firstElementChild.append(action);
        else target.firstElementChild.querySelector("p").textContent = "No purchases match these chart filters.";
        $("#curve-table").textContent = "No recorded values.";
        $("#forecast-note").textContent = "Forecasts use recorded expenses in this interval.";
        return;
    }
    const width = target.clientWidth < 480 ? 365 : 710, height = 218, left = 47, right = width - 16, top = 18, bottom = height - 32;
    const end = future.at(-1)?.day || r.cutoff, amountMax = future.at(-1)?.value || r.total;
    const step = niceStep(amountMax), ceiling = Math.max(step, Math.ceil(amountMax / step) * step);
    const x = day => left + (day - r.start) / Math.max(1, end - r.start) * (right - left);
    const y = value => bottom - value / ceiling * (bottom - top);
    const path = points => points.map((p, i) => i
        ? `H${x(p.day).toFixed(2)} V${y(p.value).toFixed(2)}`
        : `M${x(p.day).toFixed(2)},${y(p.value).toFixed(2)}`).join(" ");
    let grid = "";
    for (let v = 0; v <= ceiling; v += step)
        grid += `<line x1="${left}" x2="${right}" y1="${y(v)}" y2="${y(v)}" class="gridline"/>` + svgText(left - 7, y(v) + 4, compact(v), "end");
    for (const fraction of (width < 400 ? [0, .5, 1] : [0, .25, .5, .75, 1])) {
        const d = Math.round(r.start + fraction * (end - r.start));
        grid += svgText(x(d), height - 7, dateLabel(isoOf(d)), fraction === 0 ? "start" : fraction === 1 ? "end" : "middle");
    }
    const last = actual.at(-1), boundary = x(last.day), next = future.at(-1);
    const defs = '<defs><linearGradient id="area" x2="0" y2="1" gradientUnits="objectBoundingBox"><stop stop-color="#a690ff" stop-opacity=".44"/><stop offset="1" stop-color="#a690ff" stop-opacity=".025"/></linearGradient><linearGradient id="outlook" x2="0" y2="1"><stop stop-color="#53dacb" stop-opacity=".26"/><stop offset="1" stop-color="#53dacb" stop-opacity=".02"/></linearGradient></defs>';
    let shapes = `<path fill="url(#area)" d="${path(actual)} L${boundary},${bottom} L${left},${bottom} Z"/><path class="actual-line" d="${path(actual)}"/>`;
    if (next)
        shapes += `<rect x="${boundary}" y="${top}" width="${right - boundary}" height="${bottom - top}" fill="var(--mint)" opacity=".035"/><path fill="url(#outlook)" d="${path(future)} L${right},${bottom} L${boundary},${bottom} Z"/><path class="future-line" d="${path(future)}"/><circle cx="${right}" cy="${y(next.value)}" r="3.5" fill="var(--mint)"/>`;
    if (future.length <= 121) future.forEach((p, i) => {
        if (i && p.value > future[i-1].value) shapes += `<circle class="jump-node" cx="${x(p.day)}" cy="${y(p.value)}" r="2.5"/>`;
    });
    shapes += `<line x1="${boundary}" x2="${boundary}" y1="${top}" y2="${bottom}" class="split-line"/><circle r="4" cx="${boundary}" cy="${y(last.value)}" fill="var(--violet)"/>`;
    const points = actual.concat(future.slice(1));
    let index = actual.length - 1;
    target.innerHTML = `<div class="inspect-plot" tabindex="0" role="slider" aria-label="Inspect cumulative spending" aria-valuemin="1" aria-valuemax="${points.length}">${chartSVG(width, height, "Cumulative actual spending and estimated future spending", defs + grid + shapes + '<g id="scan" pointer-events="none"><line class="scan-line"/><circle r="4" class="scan-dot"/></g>')}</div><div class="plot-readout" id="plot-readout"></div>`;
    const control = target.firstElementChild, svg = control.querySelector("svg");
    function inspect(i) {
        index = Math.max(0, Math.min(points.length - 1, i));
        const p = points[index], px = x(p.day), py = y(p.value);
        const scan = svg.querySelector("#scan");
        scan.innerHTML = `<line class="scan-line" x1="${px}" x2="${px}" y1="${top}" y2="${bottom}"/><circle class="scan-dot" r="4" cx="${px}" cy="${py}"/>`;
        const detail = dateLabel(isoOf(p.day), true) + " · " + (p.day > r.cutoff ? "Forecast " : "Recorded ") + currency(p.value);
        $("#plot-readout").textContent = detail;
        control.setAttribute("aria-valuenow", index + 1);
        control.setAttribute("aria-valuetext", detail);
    }
    function pointAt(event) {
        const box = svg.getBoundingClientRect(), px = (event.clientX - box.left) / box.width * width;
        const nearest = points.reduce((best, p, i) => Math.abs(x(p.day) - px) < Math.abs(x(points[best].day) - px) ? i : best, 0);
        inspect(nearest);
    }
    control.onpointermove = pointAt;
    control.onpointerdown = pointAt;
    control.onkeydown = e => { const keys = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: points.length - 1 }; if (Object.hasOwn(keys, e.key)) {
        e.preventDefault();
        inspect(keys[e.key]);
    } };
    inspect(index);
    if (model.enough) {
        const fit=model.fit;
        let first=null;
        for (let i=1; i<=horizon; i++) {
            const step=fit.daily(i);
            if (step.amount>0) {first=step;break;}
        }
        const nextWeek = Array.from({length:Math.min(7,horizon)},(_,i)=>fit.daily(i+1));
        const peak=Math.max(1,...nextWeek.map(step=>step.amount));
        $("#day-outlook").innerHTML=nextWeek.map(step=>{
            const date=dateLabel(isoOf(step.day)), percent=Math.round(step.probability*100);
            const likelihood=fit.period ? percent+"%" : step.probability ? "Due" : "Quiet";
            const detail=date+" · "+likelihood+" · modeled spend "+currency(step.amount);
            return '<div class="day-cell" title="'+E(detail)+'"><small>'+E(date)+'</small><i aria-hidden="true" style="--bar:'+Math.round(step.amount/peak*100)+'%"></i><strong>'+E(likelihood)+'</strong><span>'+E(step.amount ? compact(step.amount) : "₹0")+'</span></div>';
        }).join("");
        const evidence=fit.quiet+" quiet days among "+fit.observed+" calendar days. ";
        $("#occurrence-evidence").textContent=evidence+(fit.period ?
            "Percentages show how often spending occurred in the corresponding part of the learned cycle. Amounts show one possible sequence." :
            "Due and quiet days follow the fitted purchase spacing.")+
            (model.occurrenceError===null ? " More history is needed to test timing." : " Held-out probability error (Brier, lower is better): "+model.occurrenceError.toFixed(2)+" versus "+model.frequencyError.toFixed(2)+" for a constant purchase rate.");
        $("#forecast-total").textContent = currency(next.value);
        $("#forecast-date").textContent = "Through " + dateLabel(isoOf(next.day), true) + " · " + horizon + (horizon === 1 ? " forecast day" : " forecast days");
        const stats = [
            ["Next modeled event", first ? dateLabel(isoOf(first.day)) : "None", first ? currency(first.amount) + " estimated spend" : "Within this horizon"],
            ["Timing model", fit.method, "Jump size · " + fit.amountMethod],
            ["Daily test error", model.error === null ? "Pending" : currency(model.error), model.error === null ? "Needs 3 earlier events and 3 held-out days" : model.testDays + "-day test · constant pace missed by " + currency(model.baselineError) + "/day"]
        ];
        $("#forecast-stats").innerHTML = stats.map(([term, value, hint]) => `<div><dt>${E(term)}</dt><dd>${E(value)}</dd><small>${E(hint)}</small></div>`).join("");
        $("#forecast-note").textContent = "Jump size fitted to " + fit.samples + " spending dates. " +
            (fit.samples === 2 ? "Two dates give a provisional estimate." : "Flat segments represent days without modeled spend.");
    } else {
        $("#forecast-note").textContent = "Record spending on a second date to estimate the interval between jumps.";
    }
    $("#curve-table").innerHTML = valueTable(["Date", "Series", "Cumulative spend"], points.map(p => [dateLabel(isoOf(p.day), true), p.day <= r.cutoff ? "Recorded" : "Forecast", currency(p.value)]), "Values plotted on the trajectory");
}

function drawBudgetOutlook(r) {
    const target = $(".budget-outlook"), cap = effectiveCap(r.budget,r.length);
    target.hidden = !cap;
    if (!cap) return;
    const forecast = r.open ? r.model.expected : null;
    const fraction = amount => Math.min(100,amount/cap*100) + "%";
    target.style.setProperty("--used",fraction(r.total));
    target.style.setProperty("--outlook",fraction(forecast ?? r.total));
    $("#allowance-label").textContent = currency(r.total) + " used of " + currency(cap);
    let detail = r.total >= cap ? "Allowance reached." : currency(cap-r.total) + " available.";
    if (r.total < cap && forecast >= cap) {
        let lo = 1, hi = r.model.futureDays;
        while (lo < hi) {
            const mid = Math.floor((lo+hi)/2);
            if (r.total + r.model.projected(mid) >= cap) hi = mid;
            else lo = mid+1;
        }
        detail += " Estimated limit date " + dateLabel(isoOf(r.cutoff+lo),true) + ".";
    } else if (forecast !== null) {
        detail += " Forecast at interval end " + currency(forecast) + ".";
    }
    $("#allowance-outcome").textContent = detail;
}

function drawMix(r) {
    drawBudgetOutlook(r);
    const parts = ranked(r.selected, "category"), visible = groupSmall(parts, 5, "Other types"), radius = 53, ring = 2 * Math.PI * radius;
    let offset = 0;
    const circles = visible.map(part => {
        const length = part.value / r.total * ring, gap = Math.min(3, length * .08);
        const c = `<circle cx="78" cy="78" r="${radius}" fill="none" stroke="${part.aggregate ? "#8290a7" : colourOf(part.name)}" stroke-width="16" stroke-dasharray="${length - gap} ${ring - length + gap}" stroke-dashoffset="${-offset}" transform="rotate(-90 78 78)"><title>${E(part.name)} · ${E(currency(part.value))}</title></circle>`;
        offset += length;
        return c;
    }).join("");
    const centre = svgText(78, 78, parts.length, "middle", "ring-value") + svgText(78, 95, parts.length === 1 ? "TYPE" : "TYPES", "middle", "ring-label");
    $("#mix-chart").innerHTML = chartSVG(156, 156, "Spending share across " + parts.length + " expense types", '<circle cx="78" cy="78" r="53" fill="none" stroke="var(--track)" stroke-width="16"/>' + circles + centre);
    $("#mix-legend").innerHTML = visible.map(p => {
        const inner = `<i style="--swatch:${p.aggregate ? "#8290a7" : colourOf(p.name)}"></i><span>${E(p.name)}</span><b>${Math.round(p.value / r.total * 100)}%</b><small>${E(currency(p.value))}</small>`;
        return p.aggregate ? '<div>' + inner + '</div>' : `<a href="history.html?type=${encodeURIComponent(p.name)}">${inner}</a>`;
    }).join("") || '<p class="fine">Expense types appear as you record spending.</p>';
}

function drawFlow(r) {
    const root = $("#flow-chart"), rows = r.selected;
    if (!rows.length) {
        emptyPlot(root, "Payment flows appear when you record an expense.");
        $("#flow-table").textContent = "No flows in this interval.";
        return;
    }
    const sources = ranked(rows, "paymentMethod"), dest = groupSmall(ranked(rows, "category"), 6, "Other types");
    const width = root.clientWidth < 510 ? 390 : 830, height = 248, top = 24, gap = 11;
    const x1 = width < 500 ? 91 : 155, x2 = width < 500 ? 265 : width - 171;
    const scale = (height - top - 18 - gap * (Math.max(sources.length, dest.length) - 1)) / r.total;
    const layout = nodes => { let pos = top; return nodes.map(n => { const y = pos, h = n.value * scale; pos += h + gap; return { ...n, y, h, cursor: y }; }); };
    const left = layout(sources), right = layout(dest);
    const matrix = left.map(() => right.map(() => 0));
    const rawFlows = new Map();
    rows.forEach(e => {
        let j = right.findIndex(n => !n.aggregate && n.name === e.category);
        if (j < 0)
            j = right.length - 1;
        matrix[left.findIndex(n => n.name === e.paymentMethod)][j] += e.amount;
        if (!rawFlows.has(e.paymentMethod))
            rawFlows.set(e.paymentMethod, new Map());
        const flows = rawFlows.get(e.paymentMethod);
        flows.set(e.category, round((flows.get(e.category) || 0) + e.amount));
    });
    let paths = "";
    left.forEach((a, i) => right.forEach((b, j) => {
        const v = matrix[i][j];
        if (!v)
            return;
        const h = v * scale, y1 = a.cursor + h / 2, y2 = b.cursor + h / 2, mid = (x1 + x2) / 2;
        const detail = a.name + " → " + b.name + " · " + currency(v);
        paths += `<path class="ribbon" tabindex="0" role="img" aria-label="${E(detail)}" d="M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}" fill="none" stroke="${b.aggregate ? "#8290a7" : colourOf(b.name)}" stroke-width="${Math.max(.6, h)}"><title>${E(detail)}</title></path>`;
        a.cursor += h;
        b.cursor += h;
    }));
    function nodes(items, x, isLeft) {
        return items.map(n => `<rect x="${x - 3}" y="${n.y}" width="6" height="${Math.max(1, n.h)}" rx="2" fill="${isLeft ? "var(--violet)" : n.aggregate ? "#8290a7" : colourOf(n.name)}"/>` + svgText(isLeft ? x - 9 : x + 9, n.y + n.h / 2 + 4, n.name.length > 14 ? n.name.slice(0, 13) + "…" : n.name, isLeft ? "end" : "start", "node-label")).join("");
    }
    root.innerHTML = chartSVG(width, height, "Payment methods flow into expense types. Ribbon widths represent recorded INR.", paths + nodes(left, x1, true) + nodes(right, x2, false));
    const readout = document.createElement("p");
    readout.className = "plot-readout";
    readout.textContent = "Select a ribbon to inspect its amount.";
    root.append(readout);
    function show(e) { const p = e.target.closest(".ribbon"); if (p)
        readout.textContent = p.getAttribute("aria-label"); }
    const drawing = root.querySelector("svg");
    drawing.addEventListener("pointerover", show);
    drawing.addEventListener("focusin", show);
    drawing.addEventListener("click", show);
    $("#flow-table").innerHTML = valueTable(["Payment", "Expense type", "Amount"], [...rawFlows].flatMap(([method, flows]) => [...flows].map(([type, v]) => [method, type, currency(v)])), "All payment flows");
}

function drawTrend(r) {
    const grouping = $("#trend-grouping").value, buckets = comparisonBuckets(r, grouping), width = 500, height = 186, x0 = 37, y0 = 150, plot = width - x0 - 13, gap = plot / Math.max(1, buckets.length);
    $("#trend-grouping").onchange = () => drawTrend(r);
    const max = Math.max(1, ...buckets.flatMap(b => [b.current, b.previous])), scale = 123 / max;
    const bars = buckets.map((b, i) => {
        const cx = x0 + (i + .5) * gap, w = Math.min(19, gap * .31);
        const rect = (v, x, cls) => `<rect class="${cls}" x="${x}" y="${y0 - v * scale}" width="${w}" height="${v * scale}" rx="3"><title>${E(currency(v))}</title></rect>`;
        const tick = grouping === "month" ? new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" }).format(new Date(b.from * DAY_MS)) : dateLabel(isoOf(b.from));
        return rect(b.previous, cx - w - 1, "previous-bar") + rect(b.current, cx + 1, "current-bar") + svgText(cx, height - 12, tick, "middle");
    }).join("");
    $("#trend-chart").innerHTML = chartSVG(width, height, "Selected interval and preceding equal-length interval", svgText(3, 24, compact(max)) + `<line x1="${x0}" x2="490" y1="150" y2="150" class="gridline"/>` + bars);
    $("#comparison-dates").textContent = r.elapsed ? "Compared with " + intervalText(isoOf(r.priorStart), isoOf(r.priorStart + r.elapsed - 1)) : "No elapsed days in the selected interval.";
    if (grouping === "month")
        $("#comparison-dates").textContent += " · Up to 12 calendar months, clipped to your dates.";
    $("#trend-table").innerHTML = valueTable(["Selected dates", "Total", "Previous dates", "Total"], buckets.map(b => [intervalText(isoOf(b.from), isoOf(b.to)), currency(b.current), intervalText(isoOf(b.prior), isoOf(b.priorEnd)), currency(b.previous)]), "Equal-length comparison buckets");
}

function drawCalendar(r) {
    const grid = $("#spend-calendar"), amounts = r.model.byDay, start = Math.max(r.start, r.cutoff - 83);
    grid.replaceChildren();
    if (!r.elapsed) {
        $("#calendar-period").textContent = "This interval has no elapsed days.";
        return;
    }
    const visible = [...amounts].filter(([day]) => day >= start), max = Math.max(1, ...visible.map(([, v]) => v));
    $("#calendar-period").textContent = intervalText(isoOf(start), isoOf(r.cutoff)) + " · select a day to open its transactions.";
    for (let d = start; d <= r.cutoff; d++) {
        const value = amounts.get(d) || 0, level = value ? Math.max(1, Math.ceil(value / max * 4)) : 0;
        const a = document.createElement("a");
        a.href = "history.html?day=" + isoOf(d);
        a.dataset.level = level;
        a.textContent = Number(isoOf(d).slice(-2));
        a.title = dateLabel(isoOf(d), true) + " · " + currency(value);
        a.setAttribute("aria-label", a.title);
        grid.append(a);
    }
}

function drawDecision(r) {
    const select = $("#decision-rule"), old = select.value;
    const names = r.policies.map((p, i) => [String(i), p.kind + " · " + p.name]);
    select.innerHTML = options(names, old);
    function show() {
        const p = r.policies[Number(select.value)];
        if (!p) {
            $("#decision-flow").innerHTML = "<li>No active limits in this interval.</li>";
            return;
        }
        const items = [["Recorded", currency(p.spent)], ["Interval cap", currency(p.effective)], ["Warn at " + p.warning + "%", currency(round(p.effective * p.warning / 100))],
            ["Forecast", p.forecast === null ? "Unavailable" : currency(p.forecast)], ["Decision", book.budget.alerts ? stateLabels[p.state] : "Warnings paused"]];
        $("#decision-flow").innerHTML = items.map(([label, value]) => `<li><small>${E(label)}</small><strong>${E(value)}</strong></li>`).join("");
    }
    select.onchange = show;
    show();
}

function drawTypeReport(r) {
    const current = new Map(ranked(r.selected, "category").map(p => [p.name, p.value]));
    const previous = new Map(ranked(r.previous, "category").map(p => [p.name, p.value]));
    const types = [...book.types].sort((a, b) => (current.get(b.name) || 0) - (current.get(a.name) || 0));
    $("#type-report-rows").innerHTML = types.map(t => {
        const spent = current.get(t.name) || 0, prior = previous.get(t.name) || 0, cap = effectiveCap(t, r.length), variance = round(spent - prior);
        return '<tr><th scope="row"><a href="history.html?type=' + encodeURIComponent(t.name) + '">' + typePill(t.name) + '</a></th>'
            + '<td class="num">' + E(currency(spent)) + '</td><td class="num">' + E(currency(prior)) + '</td>'
            + '<td class="num">' + (variance > 0 ? "+" : "") + E(currency(variance)) + '</td><td class="num">' + (cap ? E(currency(cap)) : "Off") + '</td>'
            + '<td class="num">' + (cap ? E(currency(cap - spent)) : "—") + '</td></tr>';
    }).join("");
}

function drawBars(id, parts) {
    const max = Math.max(...parts.map(p => p.value), 1);
    $(id).innerHTML = parts.map((p, i) => `<div class="bar-row"><span>${E(p.name)}</span><div><i style="--width:${p.value / max * 100}%;--swatch:${COLOURS[i % COLOURS.length]}"></i></div><b>${E(currency(p.value))}</b></div>`).join("") || '<p class="fine">No spending in this interval.</p>';
}
