"use strict";
// Unit IV: filtering chooses the records; grouping and arithmetic turn them into a report.
function ranked(rows, field) {
    const totals = new Map();
    for (const entry of rows) {
        const key = entry[field] || "Unspecified";
        totals.set(key, round((totals.get(key) || 0) + entry.amount));
    }
    return [...totals].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
}

function countWeekdays(first, days) {
    const count = Array(7).fill(Math.floor(days / 7));
    for (let i = 0; i < days % 7; i++)
        count[weekDay(first + i)]++;
    return count;
}

function selectedReport(ledger, range = null, asOf = todayISO()) {
    range ??= rangeDates(ledger.range, asOf, ledger.expenses);
    const start = dayOf(range.from), end = dayOf(range.to), day = dayOf(asOf);
    const length = end - start + 1, elapsed = Math.max(0, Math.min(end, day) - start + 1);
    const cutoff = start + elapsed - 1, priorStart = start - length;
    const selected = [], previous = [];
    for (const expense of ledger.expenses) {
        const d = dayOf(expense.date);
        if (d >= start && d <= cutoff)
            selected.push(expense);
        if (d >= priorStart && d < priorStart + elapsed)
            previous.push(expense);
    }
    const total = sumAmount(selected), before = sumAmount(previous);
    const r = { ...range, asOfDay: day, start, end, length, elapsed, cutoff, priorStart, selected, previous, total, before,
        open: start <= day && day < end, future: start > day, average: elapsed ? total / elapsed : 0 };
    r.model = paceModel(selected, r);
    r.policies = policyResults(ledger, r);
    return r;
}
// Extension: ordinary least squares on event number (0, 1, 2...) fits timing and size separately.
function fitLine(values) {
    const centre = (values.length - 1) / 2;
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    let numerator = 0, denominator = 0;
    values.forEach((value, i) => {
        numerator += (i - centre) * (value - mean);
        denominator += (i - centre) ** 2;
    });
    const slope = denominator ? numerator / denominator : 0;
    return { slope, at: i => mean + slope * (i - centre) };
}

function fitJumps(history, origin) {
    const events = history.slice(-28);
    if (events.length < 2) return null;
    const dates = events.map(e => e[0]), amounts = events.map(e => e[1]);
    const cadence = Math.max(1, fitLine(dates).slope), size = fitLine(amounts);
    const last = dates.at(-1);
    // Align to the last observed event; fractional periods accumulate before rounding to a date.
    let first = Math.max(1, Math.floor((origin - last) / cadence));
    const dateAt = k => last + Math.round(k * cadence);
    while (dateAt(first) <= origin) first++;
    return { cadence, slope:size.slope, first, samples:events.length };
}

// Model whether a purchase occurs separately from how much it costs.
// Train and score each repeating pattern on calendar days, including zeros.
function fitOccurrence(history, start, origin) {
    const fit = fitJumps(history, origin);
    if (!fit) return null;
    const seen = new Set(history.map(([d]) => d));
    const first = Math.max(start, origin - 364);
    function cadenceRule(training, end) {
        const schedule = fitJumps(training,end);
        return day => {
            const last = training.at(-1)[0], k = Math.round((day-last)/schedule.cadence);
            return day === last + Math.round(k*schedule.cadence) ? 1 : 0;
        };
    }
    function phaseRule(period, end) {
        const counts = Array(period).fill(0), hits = Array(period).fill(0);
        for (let day=first; day<=end; day++) {
            const phase=((day%period)+period)%period;
            counts[phase]++;
            if (seen.has(day)) hits[phase]++;
        }
        // Every candidate has at least two training cycles.
        return day => {
            const phase=((day%period)+period)%period;
            return counts[phase] ? hits[phase]/counts[phase] : 0;
        };
    }
    const days=origin-first+1, validation=Math.min(42,Math.floor(days/3)), split=origin-validation;
    const training=history.filter(([day]) => day<=split);
    let period=null;
    if (validation>=4 && training.length>=2) {
        const score = predict => {
            let loss=0;
            for (let d=split+1; d<=origin; d++) loss+=(predict(d)-Number(seen.has(d)))**2;
            return loss/validation;
        };
        let best=score(cadenceRule(training,split));
        for (const p of [1,2,3,4,5,6,7,14,28]) {
            if (split-first+1<2*p) continue;
            const loss=score(phaseRule(p,split));
            if (loss+0.001<best) {best=loss;period=p;}
        }
    }
    const chance=period ? phaseRule(period,origin) : cadenceRule(history,origin);
    const method=period===null ? "Purchase spacing" : period===1 ? "Overall purchase frequency" :
        period===7 ? "Weekday pattern" : period+"-day cycle";
    // A repeatable draw for mixed-probability days makes a single coherent scenario.
    // It changes neither the fitted probability nor the actual ledger.
    function draw(day) {
        let n=Math.imul(day ^ 0x9e3779b9,0x21f0aaad);
        n=Math.imul(n ^ (n>>>16),0x735a2d97);
        return ((n ^ (n>>>15))>>>0)/4294967296;
    }
    // Compare jump-size rules on later purchases so falling trends are not always extrapolated.
    const events=history.slice(-28), validationEvents=Math.min(7,Math.floor(events.length/3));
    function sizeRule(sample,method) {
        const amounts=sample.map(e=>e[1]), line=fitLine(amounts);
        const typical=amounts.reduce((s,v)=>s+v,0)/amounts.length;
        const floor=Math.min(...amounts)/4, ceiling=Math.max(...amounts)*3;
        const weekdays=Array.from({length:7},()=>[]);
        sample.forEach(([d,v])=>weekdays[weekDay(d)].push(v));
        return (index,day) => {
            const matches=weekdays[weekDay(day)];
            let value=typical;
            if (method==="Amount trend") value=line.at(index);
            if (method==="Weekday amount" && matches.length>=2) value=matches.reduce((s,v)=>s+v,0)/matches.length;
            return round(Math.max(.01,Math.min(ceiling,Math.max(floor,value))));
        };
    }
    let amountMethod="Amount trend";
    if (validationEvents>=2) {
        const prefix=events.slice(0,-validationEvents), test=events.slice(-validationEvents);
        let best=Infinity;
        for (const candidate of ["Typical amount","Weekday amount","Amount trend"]) {
            const predict=sizeRule(prefix,candidate);
            const loss=test.reduce((sum,[day,value],i)=>sum+Math.abs(predict(prefix.length+i,day)-value),0);
            if (loss<best-0.001) {amountMethod=candidate;best=loss;}
        }
    }
    const amountFor=sizeRule(events,amountMethod);
    const cumulative=[0], amounts=[0];
    let k=period ? 1 : fit.first;
    function projected(daysAhead) {
        while (cumulative.length<=daysAhead) {
            const day=origin+cumulative.length;
            const amount=draw(day)<chance(day) ? amountFor(events.length-1+k++,day) : 0;
            amounts.push(amount);
            cumulative.push(round(cumulative.at(-1)+amount));
        }
        return cumulative[daysAhead] || 0;
    }
    function daily(offset) {
        projected(offset);
        return {day:origin+offset, probability:chance(origin+offset), amount:amounts[offset]};
    }
    return {...fit, method, amountMethod, chance, daily, projected, period, quiet:days-history.filter(([day])=>day>=first).length, observed:days};
}

function paceModel(entries, r) {
    const byDay = new Map();
    for (const e of entries) {
        const day = dayOf(e.date);
        byDay.set(day, round((byDay.get(day) || 0) + e.amount));
    }
    const history = [...byDay].sort((a, b) => a[0] - b[0]);
    const fit = fitOccurrence(history,r.start,r.cutoff), spent = sumAmount(entries);
    const futureDays = r.open ? r.end - r.cutoff : 7;
    const projected = days => fit ? fit.projected(days) : 0;
    const testDays = Math.min(14, Math.floor(r.elapsed / 4)), split = r.cutoff - testDays;
    const training = history.filter(e => e[0] <= split);
    let error = null, baselineError = null, occurrenceError = null, frequencyError = null;
    if (testDays >= 3 && training.length >= 3) {
        const trial = fitOccurrence(training,r.start,split);
        const mean = training.reduce((s, e) => s + e[1], 0) / (split - r.start + 1);
        let sum = 0, baselineSum = 0, chanceLoss = 0, frequencyLoss = 0;
        const frequency = training.length/(split-r.start+1);
        for (let day = split + 1; day <= r.cutoff; day++) {
            const step = trial.daily(day-split), guess = step.amount;
            const happened = Number(byDay.has(day));
            chanceLoss += (step.probability-happened)**2;
            frequencyLoss += (frequency-happened)**2;
            const actual = byDay.get(day) || 0;
            sum += Math.abs(guess - actual);
            baselineSum += Math.abs(mean - actual);
        }
        error = round(sum / testDays);
        baselineError = round(baselineSum / testDays);
        occurrenceError = chanceLoss/testDays;
        frequencyError = frequencyLoss/testDays;
    }
    return { enough: !!fit, spent, byDay, fit, projected, futureDays, error, baselineError, occurrenceError, frequencyError, testDays,
        expected: fit ? round(spent + projected(futureDays)) : null };
}

const effectiveCap = (rule, days) => round(rule.cap * (rule.basis === "scaled" ? days / 30 : 1));
function policyResults(ledger, r) {
    const plans = ledger.periodBudgets || [];
    const matching = plans.find(p => p.from === r.from && p.to === r.to);
    r.budget = matching || ledger.budget;
    const overall = { ...r.budget, name: matching?.name || "Overall budget", kind: "Overall", members: null };
    const dated = plans.filter(p => p !== matching && p.from <= r.to && p.to >= r.from)
        .map(p => ({ ...p, kind: "Dated budget", members: null }));
    const rules = [overall, ...dated,
        ...ledger.types.map(t => ({ ...t, kind: "Type", members: [t.name] })),
        ...ledger.groups.map(g => ({ ...g, kind: "Group" }))];
    return rules.filter(rule => rule.cap > 0).map(rule => {
        const isPlan = rule.kind === "Dated budget";
        const start = isPlan ? dayOf(rule.from) : r.start, end = isPlan ? dayOf(rule.to) : r.end;
        const cutoff = isPlan ? Math.min(end, r.asOfDay) : r.cutoff;
        const entries = isPlan ? ledger.expenses.filter(e => e.date >= rule.from && dayOf(e.date) <= cutoff)
            : rule.members ? r.selected.filter(e => rule.members.includes(e.category)) : r.selected;
        const window = isPlan ? {start, end, cutoff, elapsed: Math.max(0, cutoff-start+1), open: start <= cutoff && cutoff < end} : r;
        const cap = effectiveCap(rule, window.end - window.start + 1), spent = sumAmount(entries);
        const percent = cap > 0 ? spent / cap * 100 : 0;
        const forecast = window.open && entries.length ? paceModel(entries, window).expected : null;
        let state = "ok", rank = 0;
        if (ledger.budget.alerts) {
            if (spent >= cap && spent > 0) {
                state = spent > cap ? "over" : "reached";
                rank = 3;
            }
            else if (percent >= rule.warning) {
                state = "near";
                rank = 2;
            }
            else if (ledger.budget.projection && forecast > cap) {
                state = "pace";
                rank = 1;
            }
        }
        return { ...rule, spent, effective: cap, percent, forecast, state, rank };
    });
}
const stateLabels = { ok: "Within limit", over: "Over limit", reached: "At limit", near: "Near limit", pace: "Forecast over limit" };
function warningsFor(r) {
    return r.policies.filter(p => p.rank > 0).sort((a, b) => b.rank - a.rank || b.percent - a.percent);
}

function groupSmall(parts, count, label) {
    if (parts.length <= count)
        return parts;
    return [...parts.slice(0, count - 1), { name: label, value: round(parts.slice(count - 1).reduce((s, v) => s + v.value, 0)), aggregate: true }];
}

function chartSeries(r, horizon = r.model.futureDays) {
    const daily = [...r.model.byDay].sort((a, b) => a[0] - b[0]);
    const actual = [];
    let running = 0, cursor = 0;
    // Plot every day for short windows and the true change dates for long sparse ledgers.
    function chartDays(start, end, events) {
        if (end < start) return [];
        if (end - start < 120) return Array.from({length:end-start+1}, (_, i) => start+i);
        const dates = [...new Set([start, ...events, end])];
        if (dates.length <= 320) return dates;
        return Array.from({length:320}, (_, i) => dates[Math.round(i*(dates.length-1)/319)]);
    }
    for (const day of chartDays(r.start, r.cutoff, daily.map(e => e[0]))) {
        while (cursor < daily.length && daily[cursor][0] <= day)
            running += daily[cursor++][1];
        actual.push({ day, value: round(running) });
    }
    const future = [];
    if (r.model.enough) {
        const fit = r.model.fit, end = r.cutoff + horizon, jumps = [];
        for (let offset=1; offset<=horizon; offset++) {
            if (fit.daily(offset).amount>0) jumps.push(r.cutoff+offset);
        }
        for (const day of chartDays(r.cutoff, end, jumps)) {
            future.push({ day, value: round(r.total + r.model.projected(day-r.cutoff)) });
        }
    }
    return { actual, future };
}

function comparisonBuckets(r, grouping = "even") {
    if (!r.elapsed)
        return [];
    const days = r.elapsed, size = Math.ceil(days / 7), result = [];
    let offset = 0;
    if (grouping === "month") {
        const oldestMonth = new Date(r.cutoff * DAY_MS);
        oldestMonth.setUTCDate(1);
        oldestMonth.setUTCMonth(oldestMonth.getUTCMonth() - 11);
        offset = Math.max(0, oldestMonth.getTime() / DAY_MS - r.start);
    }
    while (offset < days) {
        const from = r.start + offset;
        const nextMonth = new Date(from * DAY_MS);
        nextMonth.setUTCDate(1);
        nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
        const length = Math.min(grouping === "month" ? nextMonth.getTime() / DAY_MS - from : size, days - offset);
        const prior = r.priorStart + offset;
        const total = (rows, start) => sumAmount(rows.filter(e => dayOf(e.date) >= start && dayOf(e.date) < start + length));
        result.push({ from, to: from + length - 1, prior, priorEnd: prior + length - 1, current: total(r.selected, from), previous: total(r.previous, prior) });
        offset += length;
    }
    return result;
}
