const banenContainer = document.getElementById('banenContainer');
const wedstrijd_id = parseInt(window.location.pathname.split("/").pop(), 10);
let currentDeelnemer = null;
let socket;
let wedstrijdSoort = 'onbekend';

// Modal elementen
const scoreModal = document.getElementById("scoreModal");
const scoreTable = document.getElementById("scoreTable");
const modalTitle = document.getElementById("modalTitle");
const closeModal = document.getElementById("closeModal");
const saveScoresBtn = document.getElementById("saveScores");
const saveCategorieBtn = document.getElementById("saveCategorie");
const updateStatusBtn = document.getElementById("updateStatus");

// CSV upload
const csvInput = document.getElementById('csvFile');
const uploadBtn = document.getElementById('uploadBtn');

// ===== CSV importeren =====
uploadBtn.addEventListener('click', async () => {
  const file = csvInput.files[0];
  if (!file) return alert("Kies eerst een CSV-bestand!");
  const formData = new FormData();
  formData.append('file', file);
  uploadBtn.disabled = true;
  uploadBtn.textContent = "⏳ Uploaden...";
  try {
    const res = await fetch(`/api/wedstrijden/${wedstrijd_id}/upload_csv`, { method: 'POST', body: formData });
    const data = await res.json();
    if (res.ok) {
      alert(`✅ ${data.inserted} toegevoegd, ${data.skipped} overgeslagen`);
      await laadBanen();
    } else alert(`❌ Fout: ${data.error || 'Onbekende fout'}`);
  } catch (e) {
    console.error(e);
    alert("❌ Upload mislukt.");
  } finally {
    uploadBtn.disabled = false;
    uploadBtn.textContent = "Uploaden";
  }
});

// ===== Modal gedrag =====
closeModal.addEventListener('click', () => scoreModal.style.display = "none");
window.addEventListener('click', (e) => { if (e.target === scoreModal) scoreModal.style.display = "none"; });

// ===== Helpers =====
function normaliseerDeelnemer(d) {
  if (!d) return d;
  d.bonusHJ = d.bonusHJ ?? d.bonus_hj ?? d.bonushj ?? 0;
  d.aftrek_HJ = d.aftrek_HJ ?? d.aftrek_hj ?? 0;
  return d;
}

function getMoeilijkheidEndpoint() {
  switch (wedstrijdSoort) {
    case 'groepsspringen': return 'moeilijkheid_groep';
    case 'individueel': return 'moeilijkheid_indi';
    case 'microteam':
    case 'micro': return 'moeilijkheid_micro';
    default: return 'moeilijkheid_groep';
  }
}

function berekenTotaal(d) {
  const jury1 = parseFloat(d.jury1)||0;
  const jury2 = parseFloat(d.jury2)||0;
  const moeilijkheid = parseFloat(d.moeilijkheid)||0;
  const samenstelling = parseFloat(d.samenstelling)||0;
  const bonusHJ = parseFloat(d.bonusHJ)||0;
  const aftrekHJ = parseFloat(d.aftrek_HJ)||0;

  let subjury = 0;
  switch(wedstrijdSoort) {
    case 'groepsspringen':
      subjury = 40 - ((jury1 + jury2)/2);
      break;
    case 'microteam':
    case 'individueel':
      subjury = (jury1 + jury2)/2;
      break;
    default:
      subjury = (jury1 + jury2)/2;
      console.warn("Onbekend wedstrijdsoort, fallback:", wedstrijdSoort);
  }

  return subjury + moeilijkheid + samenstelling + bonusHJ - aftrekHJ;
}

// 🎨 CSS voor knipperende tegels
const style = document.createElement('style');
style.innerHTML = `
  .knipper-rood, .teveel-moeilijkheid { animation: knipper 1s infinite; }
  @keyframes knipper { 0%,100%{background-color:#fff}50%{background-color:#ffcccc} }
`;
document.head.appendChild(style);

// ===== Socket.io =====
function initSocket() {
  socket = io({ withCredentials: true });
  socket.on("connect", () => socket.emit("join_wedstrijd", { wedstrijd_id }));
  socket.on("score_update", d => updateTegel(normaliseerDeelnemer(d)));
  socket.on("status_update", d => updateTegel(normaliseerDeelnemer(d)));
  socket.on("categorie_update", d => updateTegel(normaliseerDeelnemer(d)));
  socket.on("new_deelnemer", () => laadBanen());
  socket.on("deelnemer_verwijderd", info => {
    if (info.wedstrijd_id !== wedstrijd_id) return;
    const tegel = document.querySelector(`.baan-tegel[data-baan="${info.baan}"][data-nummer="${info.nummer}"]`);
    if (tegel) tegel.remove();
  });
}

// ===== Tegels renderen =====
function voegTegelToe(col, d) {
  d = normaliseerDeelnemer(d);
  const tegel = document.createElement('div');
  tegel.className = 'baan-tegel';
  tegel.dataset.nummer = d.nummer;
  tegel.dataset.baan = d.baan;

  const status = d.correctie_status || "geen_verzoek";
  tegel.classList.remove('ingediend','goedgekeurd','afgewezen','knipper-rood','teveel-moeilijkheid');
  if (status !== "geen_verzoek") tegel.classList.add(status);

  const totaal = berekenTotaal(d);
  tegel.innerHTML = `
    <h3>${d.naam}</h3>
    <p>Nummer: ${d.nummer}</p>
    <p>Vereniging: ${d.vereniging}</p>
    <p>Categorie: ${d.categorie || ''}</p>
    <p>Moeilijkheid: ${d.moeilijkheid || 0}</p>
    <p>Bonus HJ: ${d.bonusHJ.toFixed(2)}</p>
    <p>Aftrek HJ: ${d.aftrek_HJ.toFixed(2)}</p>
    <p><strong>Totaal:</strong> ${totaal.toFixed(2)}</p>
    <p><strong>Status:</strong> ${status}</p>
  `;

  if (d.categorie) {
    const endpoint = getMoeilijkheidEndpoint();
    fetch(`/api/${endpoint}/max_score?categorie=${encodeURIComponent(d.categorie)}`)
      .then(res => res.json())
      .then(data => {
        const maxScore = data.max_score;
        if (d.moeilijkheid > maxScore) tegel.classList.add('knipper-rood');
        d.max_score = maxScore;
      }).catch(()=>{});
  }

  tegel.onclick = () => openModal(d);
  col.appendChild(tegel);
}

async function updateTegel(d) {
  d = normaliseerDeelnemer(d);
  const tegel = document.querySelector(`.baan-tegel[data-baan="${d.baan}"][data-nummer="${d.nummer}"]`);
  if (!tegel) return;

  // Haal max_score als die nog niet bekend is
  if (!d.max_score && d.categorie) {
    try {
      const endpoint = getMoeilijkheidEndpoint();
      const res = await fetch(`/api/${endpoint}/max_score?categorie=${encodeURIComponent(d.categorie)}`);
      if (res.ok) {
        const data = await res.json();
        d.max_score = data.max_score;
      }
    } catch (e) { console.warn("Kon max_score niet ophalen:", e); }
  }

  const status = d.correctie_status || "geen_verzoek";

  // Reset klassen
  tegel.className = 'baan-tegel';

  // Prioriteit logica: status gaat voor knipperen
  if (status !== "geen_verzoek") {
    tegel.classList.add(status); // incl. 'ingediend', 'goedgekeurd', 'afgewezen'
  } else if (d.max_score && parseFloat(d.moeilijkheid) > parseFloat(d.max_score)) {
    tegel.classList.add('knipper-rood'); // alleen knipperen als status "geen_verzoek"
  }

  const totaal = berekenTotaal(d);
  tegel.innerHTML = `
    <h3>${d.naam}</h3>
    <p>Nummer: ${d.nummer}</p>
    <p>Vereniging: ${d.vereniging}</p>
    <p>Categorie: ${d.categorie || ''}</p>
    <p>Moeilijkheid: ${d.moeilijkheid || 0}</p>
    <p>Bonus HJ: ${d.bonusHJ.toFixed(2)}</p>
    <p>Aftrek HJ: ${d.aftrek_HJ.toFixed(2)}</p>
    <p><strong>Totaal:</strong> ${totaal.toFixed(2)}</p>
    <p><strong>Status:</strong> ${status}</p>
  `;

  tegel.onclick = () => openModal(d);
}


// ===== Modal openen =====
async function openModal(d) {
  d = normaliseerDeelnemer(d);
  currentDeelnemer = d;
  modalTitle.textContent = `Scores: ${d.naam} (Nr ${d.nummer}, Baan ${d.baan})`;

  let maxScore = null;
  if(d.categorie) {
    try {
      const endpoint = getMoeilijkheidEndpoint();
      const res = await fetch(`/api/${endpoint}/max_score?categorie=${encodeURIComponent(d.categorie)}`);
      if(res.ok) {
        const data = await res.json();
        maxScore = data.max_score;
        d.max_score = maxScore;
      }
    } catch(e) { console.warn("Kon max_score niet ophalen:", e); }
  }

  scoreTable.innerHTML = `
    <tr><td>Jury 1</td><td><input id="jury1Input" type="number" value="${d.jury1||0}"></td></tr>
    <tr><td>Jury 2</td><td><input id="jury2Input" type="number" value="${d.jury2||0}"></td></tr>
    <tr><td>Moeilijkheid</td><td><input id="moeilijkheidInput" type="number" value="${d.moeilijkheid||0}" ${maxScore!==null?`max="${maxScore}"`:''}></td></tr>
    <tr><td>Samenstelling</td><td><input id="samenstellingInput" type="number" value="${d.samenstelling||0}"></td></tr>
    <tr><td>Bonus HJ</td><td><input id="bonusHJInput" type="number" value="${d.bonusHJ||0}"></td></tr>
    <tr><td>Aftrek HJ</td><td><input id="aftrekHJInput" type="number" value="${d.aftrek_HJ||0}"></td></tr>
    <tr><td>Categorie</td><td><input id="categorieInput" type="text" value="${d.categorie||''}"></td></tr>
    <tr><td>Status</td><td>
      <select id="statusSelect">
        <option value="geen_verzoek" ${d.correctie_status==='geen_verzoek'?'selected':''}>Geen verzoek</option>
        <option value="ingediend" ${d.correctie_status==='ingediend'?'selected':''}>Ingediend</option>
        <option value="goedgekeurd" ${d.correctie_status==='goedgekeurd'?'selected':''}>Goedgekeurd</option>
        <option value="afgewezen" ${d.correctie_status==='afgewezen'?'selected':''}>Afgewezen</option>
      </select>
    </td></tr>
  `;

  const deleteBtn = document.createElement("button");
  deleteBtn.id = "deleteDeelnemer";
  deleteBtn.textContent = "🗑️ Verwijder deelnemer";
  deleteBtn.style.backgroundColor = "red";
  deleteBtn.style.color = "white";
  deleteBtn.style.marginTop = "10px";
  deleteBtn.onclick = verwijderDeelnemer;

  scoreTable.appendChild(document.createElement("tr")).appendChild(document.createElement("td")).appendChild(deleteBtn);

  const moeilijkheidInput = document.getElementById("moeilijkheidInput");
  moeilijkheidInput.addEventListener("input", () => {
    const val = parseFloat(moeilijkheidInput.value) || 0;
    const tegel = document.querySelector(`.baan-tegel[data-baan="${d.baan}"][data-nummer="${d.nummer}"]`);
    if (!tegel || maxScore===null) return;
    if(val>maxScore) tegel.classList.add("teveel-moeilijkheid");
    else tegel.classList.remove("teveel-moeilijkheid");
  });

  scoreModal.style.display = "flex";
}

// ===== Banen renderen =====
async function laadBanen() {
  try {
    const wedstrijdRes = await fetch(`/api/wedstrijden/${wedstrijd_id}`);
    if (!wedstrijdRes.ok) throw new Error("Kon wedstrijd niet ophalen");
    const wedstrijdData = await wedstrijdRes.json();
    wedstrijdSoort = (wedstrijdData.soort || 'onbekend').toLowerCase().trim();
  } catch {
    wedstrijdSoort = 'onbekend';
  }

  const res = await fetch(`/api/wedstrijden/${wedstrijd_id}/alle2_deelnemers`);
  const deelnemers = await res.json();
  const banenMap = {};
  deelnemers.forEach(d => {
    d = normaliseerDeelnemer(d);
    if(!d.baan) return;
    if(!banenMap[d.baan]) banenMap[d.baan] = [];
    banenMap[d.baan].push(d);
  });
  renderBanen(banenMap);
}

function renderBanen(banenMap) {
  banenContainer.innerHTML = '';
  Object.keys(banenMap).forEach(baan => {
    const col = document.createElement('div');
    col.className = 'baan-col';
    col.innerHTML = `<h2>Baan ${baan}</h2>`;
    banenMap[baan].forEach(d => voegTegelToe(col, d));
    banenContainer.appendChild(col);
  });
}

// ===== API acties =====
async function saveScores() {
  if (!currentDeelnemer) return;

  const body = {
    nummer: currentDeelnemer.nummer,
    baan: currentDeelnemer.baan,
    jury1: parseFloat(jury1Input.value),
    jury2: parseFloat(jury2Input.value),
    moeilijkheid: parseFloat(moeilijkheidInput.value),
    samenstelling: parseFloat(samenstellingInput.value),
    bonusHJ: parseFloat(bonusHJInput.value),
    aftrek_HJ: parseFloat(aftrekHJInput.value),
    correctie_status: statusSelect.value  // status als string meegeven
  };

  const res = await fetch(`/api/wedstrijden/${wedstrijd_id}/deelnemer_score`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (res.ok) {
    alert("Scores en status opgeslagen!");
    // Update lokaal de status zodat updateTegel de klassen correct kan bijwerken
    currentDeelnemer.correctie_status = statusSelect.value;
    updateTegel(currentDeelnemer);
  } else {
    alert("Opslaan mislukt");
  }
}


async function saveCategorie() {
  if (!currentDeelnemer) return;
  const body = {
    nummer: currentDeelnemer.nummer,
    baan: currentDeelnemer.baan,
    categorie: categorieInput.value
  };
  const res = await fetch(`/api/wedstrijden/${wedstrijd_id}/deelnemer_categorie`, {
    method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)
  });
  if(res.ok) alert("Categorie opgeslagen!"); else alert("Categorie opslaan mislukt");
}

async function updateStatus() {
  if (!currentDeelnemer) return;
  const newStatus = statusSelect.value;
  const body = {
    nummer: currentDeelnemer.nummer,
    baan: currentDeelnemer.baan,
    correctie_status: newStatus
  };
  const res = await fetch(`/api/wedstrijden/${wedstrijd_id}/correctie_status`, {
    method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)
  });
  if(res.ok) {
    alert("Status bijgewerkt!");
    currentDeelnemer.correctie_status = newStatus;
    updateTegel(currentDeelnemer);
  } else alert("Opslaan mislukt");
}

async function verwijderDeelnemer() {
  if(!currentDeelnemer) return;
  if(!confirm(`Weet je zeker dat je ${currentDeelnemer.naam} wilt verwijderen?`)) return;
  const res = await fetch(`/api/wedstrijden/${wedstrijd_id}/deelnemer`, {
    method:'DELETE', headers:{'Content-Type':'application/json'}, body:JSON.stringify({nummer:currentDeelnemer.nummer, baan:currentDeelnemer.baan})
  });
  if(res.ok) { scoreModal.style.display='none'; await laadBanen(); } else alert("Verwijderen mislukt");
}

// ===== Start =====
saveScoresBtn.addEventListener('click', saveScores);
saveCategorieBtn.addEventListener('click', saveCategorie);
updateStatusBtn.addEventListener('click', updateStatus);
laadBanen();
initSocket();
