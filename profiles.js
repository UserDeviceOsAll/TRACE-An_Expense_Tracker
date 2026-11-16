"use strict";
// Profiles are local workspaces. Each key holds one user's identity and appearance.
function refreshWorkspacePicker() {
    const profile=profileFor(workspace), select=$("#ledger"), users=userProfiles();
    select.innerHTML=options(users.map(p=>[p.id,p.name]).concat([
        ["example","Example ledger"],["add","＋ Add user…"],["manage","Manage users…"]
    ]),workspace);
    const name=profile?.name || "Example ledger";
    select.title=name;
    $("#example-banner").hidden=workspace!=="example";
    $("#use-business").textContent=preferredUser() ? "Use my ledger →" : "Create my ledger →";
    const badge=$(".local-status");
    badge.innerHTML='<i></i><span>'+E(name)+'</span>';
    badge.title=name+(profile?.team ? " · "+profile.team : "")+" · On this device";
    const colour=profile?.colour || COLOURS[0];
    document.documentElement.style.setProperty("--profile-accent",colour);
    setTheme(profile?.theme || (localStorage.getItem(THEME_KEY)==="light" ? "light" : "dark"));
}
function initWorkspacePicker() {
    refreshWorkspacePicker();
    $("#ledger").onchange=event=>{
        const choice=event.target.value;
        if (choice==="add" || choice==="manage") {
            event.target.value=workspace;
            if (choice==="add") editUser();
            else location.assign("settings.html#users");
        } else switchBook(choice);
    };
    $("#use-business").onclick=()=>{
        const id=preferredUser();
        if (id) switchBook(id); else editUser();
    };
    $("#theme-toggle").onclick=()=>{
        const theme=document.documentElement.dataset.theme==="dark" ? "light":"dark";
        try {
            if (workspace==="example") localStorage.setItem(THEME_KEY,theme);
            else {
                const profile=profileFor(workspace);
                if (!profile) throw Error("This user was removed.");
                profile.theme=theme;
                localStorage.setItem(PROFILE_KEY+workspace,JSON.stringify(profile));
            }
            setTheme(theme);
        } catch(error) {toast(fmtError(error));}
    };
}

function editUser(id) {
    const old=id ? profileFor(id):null;
    if (id && !old) {toast("This user was removed.");return;}
    const users=userProfiles();
    const p=old || {name:"",team:"",colour:COLOURS[users.length%COLOURS.length],theme:document.documentElement.dataset.theme};
    const form='<div class="fields"><label>Display name<input name="displayName" maxlength="40" required placeholder="e.g. Ananya" value="'+E(p.name)+'"></label>'+
        '<label>Team or role (optional)<input name="team" maxlength="50" placeholder="e.g. Operations" value="'+E(p.team)+'"></label>'+
        '<label>Profile colour<input name="colour" type="color" value="'+E(p.colour)+'"></label>'+
        '<label>Appearance<select name="theme">'+options([["dark","Dark"],["light","Light"]],p.theme)+'</select></label></div>';
    dialog(old ? "Personalize user" : "Add a workspace user",form,old ? "Save profile":"Create user",form=>{
        const f=form.elements, name=label(f.displayName.value,40);
        if (!name) throw Error("Enter a display name.");
        if (userProfiles().some(other=>other.id!==id && sameName(other.name,name))) throw Error("A user already has that name.");
        if (id && !profileFor(id)) throw Error("This user was removed.");
        const user={id:id || "user-"+uid(), name, team:label(f.team.value,50), colour:f.colour.value,theme:f.theme.value};
        localStorage.setItem(PROFILE_KEY+user.id,JSON.stringify(user));
        if (!old) {
            switchBook(user.id);
        } else {
            refreshWorkspacePicker();
            renderUsers();
            toast("Profile updated.");
        }
    });
}

function removeUser(id) {
    const p=profileFor(id);
    if (!p) return;
    const message='<p>Remove <strong>'+E(p.name)+'</strong> from this device? This deletes their local ledger, receipts, budgets and settings. You can export their backup from History first.</p>';
    dialog("Remove user?",message,"Remove user",()=>{
        // Keep the original profile's removal marker so an older ledger cannot reappear on startup.
        if (id==="business") localStorage.setItem(PROFILE_KEY+id,JSON.stringify({removed:true}));
        else localStorage.removeItem(PROFILE_KEY+id);
        localStorage.removeItem(LEDGER_KEY+id);
        if (workspace===id) switchBook(preferredUser() || "example");
        else {
            refreshWorkspacePicker();
            renderUsers();
            toast("User removed.");
        }
    });
}

function renderUsers() {
    const target=$("#user-list");
    if (!target) return;
    target.innerHTML=userProfiles().map(p=>{
        const initials=p.name.split(/\s+/).slice(0,2).map(s=>[...s][0]).join("").toUpperCase();
        const badge='<span class="profile-avatar" style="--user-colour:'+E(p.colour)+'" aria-hidden="true">'+E(initials)+'</span>';
        const info='<div><strong>'+E(p.name)+'</strong><small>'+E([p.team,p.id===workspace ? "Current user" : ""].filter(Boolean).join(" · "))+'</small></div>';
        const open=p.id===workspace ? "" : '<button class="small-btn" data-user-action="open">Open</button>';
        const actions='<div class="actions">'+open+'<button class="small-btn" data-user-action="edit">Personalize</button><button class="small-btn danger" data-user-action="remove">Remove</button></div>';
        return '<article class="user-row" data-user="'+E(p.id)+'">'+badge+info+actions+'</article>';
    }).join("") || '<p class="fine">Add a user to start a personal ledger.</p>';
}
function initUserSettings() {
    $("#add-user").onclick=()=>editUser();
    $("#user-list").onclick=event=>{
        const b=event.target.closest("[data-user-action]");
        if (!b) return;
        const id=b.closest("[data-user]").dataset.user;
        if (b.dataset.userAction==="edit") editUser(id);
        else if (b.dataset.userAction==="open") switchBook(id);
        else removeUser(id);
    };
}
