"use strict";
// Unit IV: all four views start with the same filtered array of ledger entries.
function chartScope(report) {
    const type = $("#forecast-series"), vendor = $("#scope-vendor"), compare = $("#compare-vendor");
    const centre = $("#scope-centre"), time = $("#scope-time"), search = $("#scope-text");
    const vendorValue = e => "v:" + (e.merchant || "");
    function fill(select, choices, prompt) {
        const previous = select.value;
        select.innerHTML = options(choices, previous, prompt);
    }
    const vendors = unique(book.expenses.map(vendorValue)).sort()
        .map(key => [key, key.slice(2) || "Unspecified vendor"]);
    fill(type, book.types.map(t => t.name), "All types");
    fill(vendor, vendors, "All vendors");
    fill(compare, vendors.filter(([key]) => key !== vendor.value), "None");
    $("#compare-label").hidden = !vendor.value;
    if (!vendor.value) compare.value = "";
    fill(centre, unique(book.expenses.map(e => e.centre)).filter(Boolean).sort(), "All cost centres");
    const query = search.value.trim().toLowerCase();
    const selected = report.selected.filter(e => {
        const band = e.time ? String(Math.floor(Number(e.time.slice(0,2))/6)) : "unknown";
        return (!type.value || e.category === type.value) &&
            (!vendor.value || vendorValue(e) === vendor.value || vendorValue(e) === compare.value) &&
            (!centre.value || e.centre === centre.value) && (!time.value || time.value === band) &&
            (!query || [e.description,e.tags,e.note,e.status,e.paymentMethod,e.nature,e.recurring].some(v => v?.toLowerCase().includes(query)));
    });
    const active = [type,vendor,compare,centre,time,search].filter(el => el.value).length;
    $("#scope-count").textContent = active ? " · " + active + " active" : "";
    $("#scope-summary").textContent = selected.length + (selected.length === 1 ? " purchase" : " purchases") + " · " + currency(sumAmount(selected)) + " recorded";
    $("#curve-period").textContent = intervalText(report.from,report.to);
    [type,vendor,compare,centre,time,$("#bucket-unit"),$("#view-switch")].forEach(el => el.onchange = () => drawCurve(report));
    search.oninput = () => drawCurve(report);
    if (!active) return report;
    return { ...report, selected, total:sumAmount(selected), model:paceModel(selected,report) };
}

function purchaseMoment(e) {
    const day = dayOf(e.date);
    if (!e.time) return day;
    const [hours,minutes] = e.time.split(":").map(Number);
    return day + (hours*60+minutes)/1440;
}

// Model one purchase at a time. Use date precision when any fitted record lacks a clock time.
function nextPurchase(rows, cutoff) {
    const recent = [...rows].sort((a,b) => purchaseMoment(a)-purchaseMoment(b)).slice(-28);
    if (recent.length < 3 || recent[0].date === recent.at(-1).date) return null;
    const timed = recent.every(e => e.time);
    const dates = recent.map(e => timed ? purchaseMoment(e) : dayOf(e.date));
    const rhythm = fitLine(dates).slope;
    if (rhythm <= 0) return null;
    const sizes = recent.map(e => e.amount), size = fitLine(sizes), last = dates.at(-1);
    // The forecast begins after the last complete report date.
    const steps = Math.max(1,Math.ceil((cutoff+1-last)/rhythm));
    const moment = last + steps*rhythm;
    const amount = round(Math.max(0,Math.min(3*Math.max(...sizes),size.at(sizes.length-1+steps))));
    const minute = Math.round(moment*1440);
    const result = {date:isoOf(timed ? Math.floor(minute/1440) : Math.round(moment)), amount, samples:recent.length};
    const holdout = Math.min(5,Math.floor(recent.length/4)), split=recent.length-holdout;
    if (holdout >= 2 && dates[split-1] > dates[0]) {
        const gap=fitLine(dates.slice(0,split)).slope, sizeFit=fitLine(sizes.slice(0,split));
        const ceiling=3*Math.max(...sizes.slice(0,split));
        let dayError=0, amountError=0;
        for (let i=split;i<recent.length;i++) {
            const predicted=dates[split-1]+gap*(i-split+1);
            dayError+=Math.abs(predicted-dates[i]);
            amountError+=Math.abs(Math.min(ceiling,Math.max(0,sizeFit.at(i)))-sizes[i]);
        }
        Object.assign(result,{holdout,dayError:round(dayError/holdout),amountError:round(amountError/holdout)});
    }
    return result;
}

function calendarBucket(day, unit) {
    if (unit === "day") return {start:day, end:day};
    if (unit === "week") {
        const start = day - (weekDay(day)+6)%7;
        return {start,end:start+6};
    }
    const d = new Date(day * DAY_MS);
    d.setUTCDate(1);
    const start = d.getTime()/DAY_MS;
    d.setUTCMonth(d.getUTCMonth()+1);
    return {start,end:d.getTime()/DAY_MS-1};
}

// Use integer paise so every stacked column reconciles to the ledger.
function spendingBuckets(rows, field, unit) {
    const totals = new Map(), periods = new Map();
    for (const e of rows) {
        const key = e[field] || "", cents = Math.round(e.amount*100);
        totals.set(key,(totals.get(key)||0)+cents);
        const range = calendarBucket(dayOf(e.date),unit);
        if (!periods.has(range.start)) periods.set(range.start,{...range, parts:new Map(), total:0});
        const bucket = periods.get(range.start);
        bucket.parts.set(key,(bucket.parts.get(key)||0)+cents);
        bucket.total += cents;
    }
    const names = [...totals.keys()].sort((a,b) => totals.get(b)-totals.get(a) || a.localeCompare(b));
    return {names,buckets:[...periods.values()].sort((a,b) => a.start-b.start)};
}

function timelineAxes(r,max) {
    const width = $("#forecast-chart").clientWidth < 480 ? 365 : 710;
    const left=49,right=width-12,bottom=186,top=16, step=niceStep(max);
    const ceiling=Math.max(step,Math.ceil(max/step)*step);
    const x = moment => left+(right-left)*(moment-r.start)/Math.max(1,r.elapsed);
    const y = value => bottom-(bottom-top)*value/ceiling;
    let grid="";
    for (let value=0; value<=ceiling; value+=step) {
        grid += '<line class="gridline" x1="'+left+'" x2="'+right+'" y1="'+y(value)+'" y2="'+y(value)+'"/>' + svgText(left-5,y(value)+4,compact(value),"end");
    }
    if (r.elapsed===1) {
        for (const hour of [0,6,12,18]) grid += svgText(x(r.start+hour/24),206,String(hour).padStart(2,"0")+":00",hour ? "middle":"start");
    } else {
        const dates=unique([r.start,Math.floor((r.start+r.cutoff)/2),r.cutoff]);
        dates.forEach((day,i) => {grid += svgText(i===dates.length-1 ? right : x(day),206,dateLabel(isoOf(day)),i===0 ? "start" : i===dates.length-1 ? "end":"middle");});
    }
    return {width, x,y,grid};
}

function drawPurchases(r) {
    const rows = [...r.selected].sort((a,b) => purchaseMoment(a)-purchaseMoment(b));
    const {width,x,y,grid} = timelineAxes(r,rows.reduce((max,e) => Math.max(max,e.amount),0));
    let marks="";
    for (const [i,e] of rows.entries()) {
        const day=dayOf(e.date), py=y(e.amount);
        const title=E(e.description+" · "+e.date+" · "+(e.time || "Time unknown")+" · "+currency(e.amount));
        const mark=e.time ? '<circle cx="'+x(purchaseMoment(e))+'" cy="'+py+'" r="4"/>'
            : '<line x1="'+x(day)+'" x2="'+x(day+1)+'" y1="'+py+'" y2="'+py+'" stroke-width="4"/>';
        marks += '<g class="purchase-mark" role="button" tabindex="0" data-purchase="'+i+'" aria-label="'+title+'"><title>'+title+'</title>'+mark+'</g>';
    }
    const target=$("#forecast-chart");
    target.innerHTML=chartSVG(width,216,"Individual purchases by date and amount",grid+marks);
    target.querySelector("svg").setAttribute("role","group");
    const table=$("#curve-table");
    table.innerHTML=valueTable(["Purchase","Date","Time","Amount","Vendor"],rows.map(e => [e.description,e.date,e.time || "Time unknown",currency(e.amount),e.merchant || "Unspecified"]),"Individual purchases");
    table.querySelectorAll("tbody th").forEach((cell,i) => {
        const button=document.createElement("button");
        button.className="record-button"; button.textContent=rows[i].description;
        button.onclick=()=>showPurchase(rows[i]); cell.replaceChildren(button);
    });
    function open(event) {
        const mark=event.target.closest("[data-purchase]");
        if (mark) showPurchase(rows[Number(mark.dataset.purchase)]);
    }
    target.querySelector("svg").onclick=open;
    target.querySelector("svg").onkeydown=event=>{
        if (event.key==="Enter" || event.key===" ") {event.preventDefault(); open(event);}
    };
    const prediction=nextPurchase(rows,r.cutoff);
    $("#forecast-note").textContent=(rows.some(e=>!e.time) ? "Horizontal marks span purchases whose exact time is unknown. " : "")+
        (prediction ? "Next estimated purchase after the report cutoff: "+dateLabel(prediction.date,true)+" · "+currency(prediction.amount)+" (fit to "+prediction.samples+" purchases)."+
            (prediction.holdout ? " On "+prediction.holdout+" held-out purchases, average errors were "+prediction.dayError+" days and "+currency(prediction.amountError)+"." : " More history is needed to test this estimate.") :
        "A purchase estimate needs at least three purchases across two dates.");
}

function drawGroups(r,field) {
    const unit=$("#bucket-unit").value, {names,buckets}=spendingBuckets(r.selected,field,unit);
    const axes=timelineAxes(r,buckets.reduce((max,b)=>Math.max(max,b.total/100),0));
    const {x,y,width}=axes, shown=names.length>6 ? names.slice(0,5) : names;
    const groups=shown.map((key,i)=>({keys:[key],name:key || "Unspecified vendor",colour:field==="category" ? colourOf(key) : COLOURS[i]}));
    if (shown.length<names.length) groups.push({keys:names.slice(shown.length),name:"Remaining ("+(names.length-shown.length)+")",colour:"#8f9daf"});
    let marks="";
    const table=[];
    for (const b of buckets) {
        const from=Math.max(r.start,b.start), to=Math.min(r.cutoff,b.end);
        const period=from===to ? dateLabel(isoOf(from),true) : intervalText(isoOf(from),isoOf(to));
        const px=x(from), span=x(to+1)-px, bar=Math.max(.8,span*.8);
        let running=0;
        for (const group of groups) {
            const amount=group.keys.reduce((sum,key)=>sum+(b.parts.get(key)||0),0)/100;
            if (!amount) continue;
            const upper=y(running+amount);
            marks += '<rect x="'+(px+(span-bar)/2)+'" y="'+upper+'" width="'+bar+'" height="'+(y(running)-upper)+'" fill="'+group.colour+'"><title>'+E(period+" · "+group.name+" · "+currency(amount))+'</title></rect>';
            running+=amount;
        }
        for (const [key,cents] of b.parts) table.push([period,key || "Unspecified vendor",currency(cents/100)]);
    }
    const kind=field==="merchant" ? "Vendor" : "Expense type";
    const legend=groups.map(g=>'<span><i style="--swatch:'+g.colour+'"></i>'+E(g.name)+'</span>').join("");
    $("#forecast-chart").innerHTML=chartSVG(width,216,kind+" spending by "+unit,axes.grid+marks)+'<div class="group-key">'+legend+'</div>';
    $("#curve-table").innerHTML=valueTable(["Period",kind,"Spend"],table,"Recorded spending by group");
    const rowsByGroup=new Map();
    for (const e of r.selected) {
        const key=e[field] || "";
        if (!rowsByGroup.has(key)) rowsByGroup.set(key,[]);
        rowsByGroup.get(key).push(e);
    }
    const forecasts=names.map(name=>{
        const rows=rowsByGroup.get(name), model=paceModel(rows,r);
        let testError=null;
        if (r.elapsed>=8) {
            const split=r.cutoff-7, past=rows.filter(e=>dayOf(e.date)<=split);
            const trial=paceModel(past,{...r,cutoff:split,elapsed:split-r.start+1,open:false});
            if (trial.enough) testError=round(Math.abs(trial.projected(7)-(sumAmount(rows)-sumAmount(past))));
        }
        return {name:name || "Unspecified vendor", count:rows.length, testError, forecast:model.enough ? model.projected(7) : null};
    }).sort((a,b)=>(b.forecast ?? -1)-(a.forecast ?? -1));
    const leader=forecasts.find(f=>f.forecast>0);
    $("#forecast-note").textContent=leader ? "Largest modeled spend over the next 7 days: "+leader.name+" · "+currency(leader.forecast)+"." : "No positive seven-day group estimate for this selection.";
    $("#curve-table").insertAdjacentHTML("beforeend",'<h3>Seven-day outlook</h3>'+valueTable([kind,"Purchases","Estimated additional spend","Last 7-day test error"],forecasts.map(f=>[f.name,f.count,f.forecast===null ? "Needs two spending dates" : currency(f.forecast), f.testError===null ? "Insufficient history" : currency(f.testError)]),"Independent group forecasts after the observed interval"));
}

function drawTimeline(r,mode) {
    if (!r.selected.length) {
        emptyPlot($("#forecast-chart"),"No recorded purchases match this interval and selection.");
        $("#curve-table").textContent="No matching purchases.";
        $("#forecast-note").textContent="";
    } else if (mode==="expenses") drawPurchases(r);
    else drawGroups(r,mode);
}
