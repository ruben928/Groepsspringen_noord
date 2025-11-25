const socket = io({ withCredentials: true });
const wedstrijdLijst = document.getElementById("wedstrijdLijst");
const juryledenUl = document.getElementById("juryleden");
const chefUsername = "{{ username }}";
let actieveWedstrijdId = null;
let diaPauze = false;

// =================== Wedstrijden ophalen ===================
async function fetchWedstrijden() {
    const res = await fetch("/api/wedstrijden");
    const wedstrijden = await res.json();
    wedstrijdLijst.innerHTML = "";
    actieveWedstrijdId = null;

    wedstrijden.forEach(w => {
        const div = document.createElement("div");
        div.className = "wedstrijd";
        div.textContent = w.naam + (w.actief ? " (Actief)" : "");
        if(w.actief){
            div.classList.add("actief");
            actieveWedstrijdId = w.id;
        }
        wedstrijdLijst.appendChild(div);
    });

    if(actieveWedstrijdId){
        socket.emit("join_wedstrijd", {wedstrijd_id: actieveWedstrijdId});
    }
}

// =================== Jury status ===================
function updateJurylid(username, ingelogd, baan){
    if(username === chefUsername) return;
    let li = document.getElementById(`jury_${username}`);
    if(!li){
        li = document.createElement("li");
        li.id = `jury_${username}`;
        juryledenUl.appendChild(li);
    }
    li.classList.remove("ingelogd", "uitgelogd");
    li.classList.add(ingelogd ? "ingelogd" : "uitgelogd");
    li.textContent = baan ? `${username} baan ${baan}` : username;
}

// =================== Socket events ===================
socket.on("connect", () => {
    console.log("Verbonden met WebSocket");
    socket.emit("chef_join", {username: chefUsername});
});

socket.on("jury_ingelogd", data => updateJurylid(data.username, true, data.baan));
socket.on("jury_uitgelogd", data => updateJurylid(data.username, false, data.baan));
socket.on("wedstrijd_geactiveerd", () => fetchWedstrijden());

// =================== Pauze/Hervat via WebSocket ===================
const pauzeBtn = document.getElementById("pauzeBtn");
const infoDia = document.getElementById("infoDia");
const diaInput = document.getElementById("diaInput");
const diaText = document.getElementById("diaText");
const updateDiaBtn = document.getElementById("updateDiaBtn");

pauzeBtn.addEventListener("click", () => {
    if(!actieveWedstrijdId) return;

    if(!diaPauze){
        socket.emit("pauzeer_dia_loop", {wedstrijd_id: actieveWedstrijdId});
        diaPauze = true;
        pauzeBtn.textContent = "Hervat Dia";
    } else {
        socket.emit("resume_dia_loop", {wedstrijd_id: actieveWedstrijdId});
        diaPauze = false;
        pauzeBtn.textContent = "Pauzeer Dia";
    }
});

// =================== Verstuur info-dia via WebSocket ===================
updateDiaBtn.addEventListener("click", () => {
    if(!actieveWedstrijdId) return;

    const tekst = diaInput.value.trim();
    if(!tekst) return;

    socket.emit("toon_info_dia", {
        wedstrijd_id: actieveWedstrijdId,
        bericht: "INFO: " + tekst
    });

    // Zet automatisch pauze-knop
    diaPauze = true;
    pauzeBtn.textContent = "Hervat Dia";

    diaInput.value = "";
});

// =================== Info-dia synchroon bij ontvangst ===================
socket.on("toon_info_dia", data => {
    diaText.textContent = data.bericht.replace(/^INFO:\s*/i,'');
    diaPauze = true;
    pauzeBtn.textContent = "Hervat Dia";
});

// =================== Initialisatie ===================
fetchWedstrijden();