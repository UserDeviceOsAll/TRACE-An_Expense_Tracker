"use strict";
// Unit IV: one ledger is an object containing arrays of expense records and spending rules.
const LEDGER_KEY = "trace-business-v3:";
const MODE_KEY = "trace-business-workspace";
const THEME_KEY = "trace-theme-v1";
const PAYMENTS = ["UPI", "Card", "Cash", "Bank transfer", "Other"];
const FREQUENCIES = ["none", "weekly", "monthly", "yearly"];
const STATUSES = ["Company paid", "To reimburse", "Reimbursed"];
const COLOURS = ["#ae97ff", "#62dfce", "#ffae84", "#7bb9ff", "#ed94c1", "#e8c970", "#91b3ff", "#9fca85", "#d39afa", "#82c6de"];
const STARTERS = [
    // type, template description, quick amount in INR, allowance per 30 days
    ["Food", "Team lunch", 450, 7500], ["Transport", "Local travel", 240, 6500],
    ["Office", "Office supplies", 650, 8500], ["Software", "Software subscription", 1299, 8500],
    ["Shopping", "Business purchase", 850, 4500], ["Bills", "Utility payment", 1800, 10500],
    ["Health", "Health expense", 500, 2500], ["Education", "Training materials", 750, 4500],
    ["Entertainment", "Client event", 600, 3000], ["Other", "General expense", 250, 4000]
];
const INR = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
const currency = value => INR.format(value);
const compact = value => value >= 100000 ? "₹" + Number((value / 100000).toFixed(1)) + "L" : value >= 1000 ? "₹" + Number((value / 1000).toFixed(1)) + "k" : "₹" + Math.round(value);
const round = value => Math.round((value + Number.EPSILON) * 100) / 100;
const sumAmount = rows => rows.reduce((paise, row) => paise + Math.round(row.amount * 100), 0) / 100;
const label = (value, max = 80) => typeof value === "string" ? value.trim().slice(0, max) : "";
const typeName = value => label(value, 28).replace(/\s+/g, " ");
const sameName = (a, b) => a.toLowerCase() === b.toLowerCase();
const unique = values => [...new Set(values)];
const choose = (values, value, fallback = values[0]) => values.includes(value) ? value : fallback;
function numberIn(value, fallback, max, min = 0) {
    const n = Number(value);
    return value !== null && value !== "" && Number.isFinite(n) && n >= min && n <= max ? round(n) : fallback;
}

function uid() { return globalThis.crypto?.randomUUID?.() || "trace-" + Date.now() + "-" + Math.random().toString(36).slice(2); }
function currentTime() {
    const d = new Date();
    return [d.getHours(), d.getMinutes()].map(n => String(n).padStart(2,"0")).join(":");
}
function todayISO() {
    const d = new Date();
    return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
}
// Use calendar-day numbers for arithmetic. Daylight-saving changes never shorten a report.
const DAY_MS = 86400000;
const dayOf = iso => Date.parse(iso + "T00:00:00Z") / DAY_MS;
const isoOf = day => new Date(day * DAY_MS).toISOString().split("T")[0];
const weekDay = day => ((day + 4) % 7 + 7) % 7;
function validDate(iso) {
    return typeof iso === "string" && /^\d{4}-\d\d-\d\d$/.test(iso) && Number.isFinite(dayOf(iso)) && isoOf(dayOf(iso)) === iso;
}
const dateFormats = new Map();
function dateLabel(iso, year = false) {
    if (!dateFormats.has(year))
        dateFormats.set(year, new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" }));
    return dateFormats.get(year).format(new Date(dayOf(iso) * DAY_MS));
}

function intervalText(start, end) {
    return dateLabel(start, start.slice(0, 4) !== end.slice(0, 4)) + " – " + dateLabel(end, true);
}

function rangeDates(saved = {}, today = todayISO(), entries = book?.expenses || []) {
    const d = dayOf(today);
    switch (saved.preset) {
        case "custom":
            if (validDate(saved.from) && validDate(saved.to) && saved.from <= saved.to)
                return { from: saved.from, to: saved.to };
            break;
        case "week": return { from: isoOf(d - 6), to: today };
        case "last30": return { from: isoOf(d - 29), to: today };
        case "last90": return { from: isoOf(d - 89), to: today };
        case "last180": return { from: isoOf(d - 179), to: today };
        case "all": {
            let from = today, to = "";
            for (const e of entries)
                if (e.date <= today) {
                    if (e.date < from)
                        from = e.date;
                    if (e.date > to)
                        to = e.date;
                }
            return { from, to: to || today };
        }
    }
    return { from: isoOf(d - 20), to: isoOf(d + 9) };
}
const baseRule = { cap: 60000, basis: "scaled", warning: 80 };
function starter(name, index = 0) {
    const template = STARTERS.find(row => row[0] === name);
    return { name, colour: COLOURS[index % COLOURS.length], cap: template?.[3] ?? 3000, basis: "scaled", warning: 80,
        quick: template?.[2] ?? 250, description: template?.[1] ?? name + " expense" };
}

function emptyBook() {
    return { version: 3, expenses: [], types: STARTERS.map(([name], index) => starter(name, index)), groups: [], periodBudgets: [],
        budget: { ...baseRule, alerts: true, projection: true }, range: { preset: "outlook" },
        defaults: { category: "Food", paymentMethod: "UPI", centre: "General", merchant: "", nature: "essential", recurring: "none", status: "Company paid", tags: "", note: "" } };
}

function tidyRule(source = {}, fallback = baseRule) {
    return { cap: numberIn(source.cap, fallback.cap, 1e9), basis: choose(["fixed", "scaled"], source.basis, fallback.basis),
        warning: Math.round(numberIn(source.warning, fallback.warning, 100, 1)) };
}

function ensureType(book, value) {
    const name = typeName(value) || "Other";
    let type = book.types.find(t => sameName(t.name, name));
    if (!type) {
        type = starter(name, book.types.length);
        book.types.push(type);
    }
    return type;
}

function receiptImage(value) {
    return typeof value === "string" && value.length < 550000 && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value) ? value : "";
}

function cleanExpense(row, book) {
    if (!row || typeof row !== "object" || !validDate(row.date))
        return null;
    const description = label(row.description), amount = numberIn(row.amount, 0, 10000000, .01);
    if (!description || !amount)
        return null;
    return { id: label(String(row.id ?? ""), 160) || uid(), date: row.date, time: /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(row.time) ? row.time : "", amount, description,
        category: ensureType(book, row.category).name, paymentMethod: choose(PAYMENTS, row.paymentMethod, "Other"), merchant: label(row.merchant, 60),
        centre: label(row.centre, 50) || "General", nature: choose(["essential", "flexible"], row.nature, "flexible"),
        recurring: choose(FREQUENCIES, row.recurring === true ? "monthly" : (row.recurringFrequency || row.recurring)), status: choose(STATUSES, row.status),
        tags: label(row.tags), note: label(row.note, 400), receipt: receiptImage(row.receipt) };
}

function cleanDefaults(source, book) {
    const original = emptyBook().defaults;
    return { category: book.types.find(t => sameName(t.name, typeName(source.category)))?.name || original.category,
        paymentMethod: choose(PAYMENTS, source.paymentMethod), centre: label(source.centre, 50) || "General", merchant: label(source.merchant, 60),
        nature: choose(["essential", "flexible"], source.nature), recurring: choose(FREQUENCIES, source.recurring), status: choose(STATUSES, source.status), tags: label(source.tags), note: label(source.note, 400) };
}
// Read v1 expenses, v2 settings and current backups into the same object before one storage write.
function importPlan(raw, base = emptyBook()) {
    const next = structuredClone(base);
    const modern = raw?.version === 3 && raw?.app === "Trace";
    const source = modern ? raw.book : raw;
    const rows = Array.isArray(source) ? source : source?.expenses;
    if (!Array.isArray(rows))
        throw Error("Choose a Trace backup containing an expense list.");
    if (modern) {
        if (!Array.isArray(source.types) || !Array.isArray(source.groups))
            throw Error("The backup is missing its types or limits.");
        source.types.forEach(t => {
            if (!typeName(t?.name))
                return;
            const type = ensureType(next, t.name);
            Object.assign(type, tidyRule(t, type), { quick: numberIn(t.quick, type.quick, 1e7, .01), description: label(t.description) || type.description,
                colour: /^#[\da-f]{6}$/i.test(t.colour) ? t.colour : type.colour });
        });
        const groups = new Map(next.groups.map(g => [g.id, g]));
        source.groups.forEach(g => {
            if (!g || !Array.isArray(g.members) || !label(g.name, 60))
                return;
            const members = unique(g.members.map(n => next.types.find(t => sameName(t.name, typeName(n)))?.name).filter(Boolean));
            if (members.length) {
                const id = label(g.id, 160) || uid();
                groups.set(id, { id, name: label(g.name, 60), members, ...tidyRule(g) });
            }
        });
        next.groups = [...groups.values()];
        if (source.periodBudgets !== undefined) {
            if (!Array.isArray(source.periodBudgets)) throw Error("Invalid dated budgets in backup.");
            const plans = new Map((next.periodBudgets || []).map(p => [p.id, p]));
            for (const p of source.periodBudgets) {
                if (!p || !label(p.name) || !validDate(p.from) || !validDate(p.to) || p.to < p.from ||
                    !numberIn(p.cap, 0, 1e9, .01) || !Number.isInteger(p.warning) || p.warning < 1 || p.warning > 100)
                    throw Error("A dated budget has invalid dates, amount or threshold.");
                const id = label(p.id, 160) || uid();
                plans.set(id, { id, name: label(p.name, 60), from: p.from, to: p.to, cap: round(p.cap), warning: p.warning, basis: "fixed" });
            }
            next.periodBudgets = [...plans.values()];
            const windows = next.periodBudgets.map(p => p.from + "/" + p.to);
            if (new Set(windows).size !== windows.length) throw Error("Two dated budgets have the same interval.");
        }
        if (source.budget)
            next.budget = { ...tidyRule(source.budget, next.budget), alerts: source.budget.alerts !== false, projection: source.budget.projection !== false };
        if (source.defaults)
            next.defaults = cleanDefaults(source.defaults, next);
        if (source.range)
            next.range = source.range.preset === "custom" ? { preset: "custom", ...rangeDates(source.range) } : { preset: choose(["outlook", "week", "last30", "last90", "last180", "all"], source.range.preset) };
    }
    else {
        const settings = source?.settings || {};
        if (Array.isArray(settings.categories))
            settings.categories.forEach(n => {
                const t = ensureType(next, n), old = Object.hasOwn(settings.categoryPrefs || {}, n) ? settings.categoryPrefs[n] : {};
                Object.assign(t, tidyRule({ cap: old?.limit, warning: old?.warning }, t), { quick: numberIn(old?.quickAmount, t.quick, 1e7, .01) });
            });
        if (settings.formDefaults)
            next.defaults = cleanDefaults({ ...next.defaults, ...settings.formDefaults }, next);
        if (source?.budget != null)
            next.budget.cap = numberIn(source.budget, next.budget.cap, 1e9);
    }
    const byId = new Map(next.expenses.map(e => [e.id, e]));
    let valid = 0;
    rows.forEach(r => { const e = cleanExpense(r, next); if (e) {
        byId.set(e.id, e);
        valid++;
    } });
    if (rows.length && !valid)
        throw Error("This backup contains no valid expense records.");
    next.expenses = [...byId.values()];
    return { book: next, count: valid, skipped: rows.length - valid };
}

function exampleBook() {
    const book = emptyBook(), now = dayOf(todayISO());
    book.groups.push({ id: "example-field", name: "Field operations", members: ["Food", "Transport"], cap: 9700, basis: "scaled", warning: 75 });
    const vendors = ["Harbor Kitchen", "Metro Transit", "Paper & Pine", "Studio Cloud", "North Market", "City Utilities", "Wellness Hub", "Skill Studio", "Forum Events", "Local supplier"];
    for (let offset = 149; offset >= 0; offset--) {
        const d = now - offset, dow = weekDay(d);
        const index = [0, 1, 2, 0, 4, 7, 1, 8, 2, 0, 9, 6, 1][((d % 13) + 13) % 13];
        const picks = [index];
        if (d % 3 === 0)
            picks.push((index + 2) % 10);
        if (d % 28 === 0)
            picks.push(3, 5);
        if (dow === 0 && d % 3 !== 0)
            continue;
        picks.forEach((i, j) => {
            const type = book.types[i];
            const amount = round(type.quick * (.72 + ((d * 7 + i * 3) % 16) / 10) * (offset < 20 ? 1.12 : 1));
            book.expenses.push({ ...book.defaults, id: "sample-" + d + "-" + j, date: isoOf(d), time: String(8 + (i + 3*j) % 13).padStart(2,"0") + ":" + (j % 2 ? "45" : "15"), description: type.description, amount, category: type.name, merchant: vendors[i],
                centre: ["Operations", "Sales", "Finance", "Product"][i % 4], paymentMethod: PAYMENTS[(i + j) % 4],
                nature: [4, 8].includes(i) ? "flexible" : "essential", recurring: [3, 5].includes(i) ? "monthly" : "none", status: d % 9 === 0 ? "To reimburse" : "Company paid", tags: "sample", receipt: "" });
        });
    }
    return book;
}

function legacyBook() {
    const raw = localStorage.getItem("trace-expenses-v1"), prefs = localStorage.getItem("trace-settings-v2"), budget = localStorage.getItem("trace-budget-v1");
    if (!raw && !prefs && !budget)
        return emptyBook();
    return importPlan({ expenses: JSON.parse(raw || "[]"), settings: JSON.parse(prefs || "{}"), budget }).book;
}
// A stable profile ID owns each ledger. Renaming a person never moves their entries.
const PROFILE_KEY = "trace-user-v1:";
function profileFor(id) {
    const saved = localStorage.getItem(PROFILE_KEY+id);
    const profile = saved && JSON.parse(saved);
    return profile && !profile.removed ? profile : null;
}
function userProfiles() {
    const profiles=[];
    for (let i=0;i<localStorage.length;i++) {
        const key=localStorage.key(i);
        if (key.startsWith(PROFILE_KEY)) {
            const profile=profileFor(key.slice(PROFILE_KEY.length));
            if (profile) profiles.push(profile);
        }
    }
    return profiles.sort((a,b)=>a.name.localeCompare(b.name));
}
function rememberWorkspace(id) {
    sessionStorage.setItem(MODE_KEY,id);
    localStorage.setItem(MODE_KEY,id);
    if (id!=="example") sessionStorage.setItem("trace-last-user",id);
}
function preferredUser() {
    const last=sessionStorage.getItem("trace-last-user");
    return profileFor(last)?.id || profileFor("business")?.id || userProfiles()[0]?.id;
}
let workspace, book;
function openBook() {
    if (localStorage.getItem(PROFILE_KEY+"business")===null) {
        const original={id:"business",name:"Business ledger",team:"",colour:COLOURS[0],theme:localStorage.getItem(THEME_KEY)==="light"?"light":"dark"};
        localStorage.setItem(PROFILE_KEY+"business",JSON.stringify(original));
    }
    const previous = sessionStorage.getItem(MODE_KEY) || localStorage.getItem(MODE_KEY);
    const existing = ["trace-expenses-v1", "trace-settings-v2", "trace-budget-v1", LEDGER_KEY + "business"].some(key => localStorage.getItem(key) !== null);
    workspace = previous==="example" || profileFor(previous) ? previous :
        (existing || document.body.dataset.page==="input" ? preferredUser() : null) || "example";
    const stored = localStorage.getItem(LEDGER_KEY + workspace);
    book = stored ? JSON.parse(stored) : workspace === "business" ? legacyBook() : workspace === "example" ? exampleBook() : emptyBook();
    if (!Array.isArray(book.expenses) || !Array.isArray(book.types))
        throw Error("The saved ledger could not be read.");
    if (!stored)
        localStorage.setItem(LEDGER_KEY + workspace, JSON.stringify(book));
    rememberWorkspace(workspace);
}
// Read the latest ledger before editing. All related changes are committed together.
function commit(edit) {
    if (workspace!=="example" && !profileFor(workspace)) throw Error("This user was removed. Switch to another workspace.");
    const key = LEDGER_KEY + workspace;
    const draft = JSON.parse(localStorage.getItem(key)) || structuredClone(book);
    const next = edit(draft) || draft;
    localStorage.setItem(key, JSON.stringify(next));
    book = next;
    return next;
}

function removeType(draft, name, destination) {
    if (STARTERS.some(row => row[0] === name) || name === destination || !draft.types.some(t => t.name === destination))
        throw Error("Choose an existing replacement type.");
    draft.types = draft.types.filter(t => t.name !== name);
    draft.expenses.forEach(e => { if (e.category === name)
        e.category = destination; });
    if (draft.defaults.category === name)
        draft.defaults.category = destination;
    draft.groups.forEach(g => { g.members = unique(g.members.map(n => n === name ? destination : n)); });
}
