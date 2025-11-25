// ===== Helpers =====
function normaliseerDeelnemer(d) {
  if (!d) return d;
  d.bonusHJ = d.bonusHJ ?? d.bonus_hj ?? d.bonushj ?? 0;
  d.aftrek_HJ = d.aftrek_HJ ?? d.aftrek_hj ?? 0;
  d.bm = d.bm ?? 0; // toegevoegd voor BM
  return d;
}

// === Centrale moeilijkheidscheck ===
function checkMoeilijkheid(d) {
  const moeilijkheid = parseFloat(d.moeilijkheid) || 0;
  // als max_score exact 0 kan zijn willen we dat respecteren, daarom check op null
  const max = (d.max_score === undefined || d.max_score === null) ? null : parseFloat(d.max_score);
  if (max === null || Number.isNaN(max)) return false;
  return moeilijkheid > max;
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
  .moeilijkheid-warning { color: #b33; font-weight:600; margin-top:6px; }
`;
document.head.appendChild(style);

// ===== App state =====
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
function maakTegelHTML(d, status, totaal) {
  return `
    <h3>${d.naam}</h3>
    <p>Nummer: ${d.nummer}</p>
    <p>Vereniging: ${d.vereniging}</p>
    <p>Categorie: ${d.categorie || ''}</p>
    <p>Moeilijkheid: ${d.moeilijkheid || 0}</p>
    <p>Bonus HJ: ${d.bonusHJ.toFixed(2)}</p>
    <p>Aftrek HJ: ${d.aftrek_HJ.toFixed(2)}</p>
    <p>BM: ${d.bm.toFixed(2)}</p>
    <p><strong>Totaal:</strong> ${totaal.toFixed(2)}</p>
    <p><strong>Status:</strong> ${status}</p>`;
}

function voegTegelToe(col, d) {
  d = normaliseerDeelnemer(d);
  const tegel = document.createElement('div');
  tegel.className = 'baan-tegel';
  tegel.dataset.nummer = d.nummer;
  tegel.dataset.baan = d.baan;

  const status = d.correctie_status || "geen_verzoek";
  if (status !== 'geen_verzoek') tegel.classList.add(status);

  const totaal = berekenTotaal(d);
  tegel.innerHTML = maakTegelHTML(d, status, totaal);

  if (d.categorie) {
    const endpoint = getMoeilijkheidEndpoint();
    fetch(`/api/${endpoint}/max_score?categorie=${encodeURIComponent(d.categorie)}`)
      .then(res => res.json())
      .then(data => {
        d.max_score = data.max_score;
        if (checkMoeilijkheid(d) && (d.correctie_status === undefined || d.correctie_status === 'geen_verzoek')) {
          tegel.classList.add('knipper-rood');
        }
      }).catch(()=>{});
  }

  tegel.onclick = () => openModal(d);
  col.appendChild(tegel);
}

async function updateTegel(d) {
  d = normaliseerDeelnemer(d);
  const tegel = document.querySelector(`.baan-tegel[data-baan="${d.baan}"][data-nummer="${d.nummer}"]`);
  if (!tegel) return;

  if ((d.max_score === undefined || d.max_score === null) && d.categorie) {
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

  tegel.className = 'baan-tegel';
  if (status !== 'geen_verzoek') tegel.classList.add(status);
  else if (checkMoeilijkheid(d)) tegel.classList.add('knipper-rood');

  const totaal = berekenTotaal(d);
  tegel.innerHTML = maakTegelHTML(d, status, totaal);
  tegel.onclick = () => openModal(d);
}

// ===== Modal openen =====
async function openModal(d) {
  d = normaliseerDeelnemer(d);
  currentDeelnemer = d;
  modalTitle.textContent = `Scores: ${d.naam} (Nr ${d.nummer}, Baan ${d.baan})`;

  if (d.categorie && (d.max_score === undefined || d.max_score === null)) {
    try {
      const endpoint = getMoeilijkheidEndpoint();
      const res = await fetch(`/api/${endpoint}/max_score?categorie=${encodeURIComponent(d.categorie)}`);
      if (res.ok) {
        const data = await res.json();
        d.max_score = data.max_score;
      }
    } catch (e) { console.warn("Kon max_score niet ophalen:", e); }
  }

  scoreTable.innerHTML = `
    <tr><td>Jury 1</td><td><input id="jury1Input" type="number" value="${d.jury1||0}"></td></tr>
    <tr><td>Jury 2</td><td><input id="jury2Input" type="number" value="${d.jury2||0}"></td></tr>
    <tr><td>Moeilijkheid</td><td>
      <input id="moeilijkheidInput" type="number" value="${d.moeilijkheid||0}" ${d.max_score!==undefined && d.max_score!==null?`max="${d.max_score}"`:''}>
      <div id="moeilijkheidWarning" class="moeilijkheid-warning" style="display:none;">Moeilijkheid is hoger dan het maximum voor deze categorie.</div>
    </td></tr>
    <tr><td>Samenstelling</td><td><input id="samenstellingInput" type="number" value="${d.samenstelling||0}"></td></tr>
    <tr><td>Bonus HJ</td><td><input id="bonusHJInput" type="number" value="${d.bonusHJ||0}"></td></tr>
    <tr><td>Aftrek HJ</td><td><input id="aftrekHJInput" type="number" value="${d.aftrek_HJ||0}"></td></tr>
    <tr><td>BM</td><td><input id="bmInput" type="number" value="${d.bm||0}"></td></tr>
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

  const tr = document.createElement('tr');
  const td = document.createElement('td');
  td.colSpan = 2;
  td.appendChild(deleteBtn);
  tr.appendChild(td);
  scoreTable.appendChild(tr);

  const bmBtn = document.createElement("button");
  bmBtn.id = "saveBMBtn";
  bmBtn.textContent = "💎 BM opslaan";
  bmBtn.style.backgroundColor = "#4CAF50";
  bmBtn.style.color = "white";
  bmBtn.style.marginTop = "5px";
  bmBtn.onclick = saveBM;

  const bmTr = document.createElement('tr');
  const bmTd = document.createElement('td');
  bmTd.colSpan = 2;
  bmTd.appendChild(bmBtn);
  bmTr.appendChild(bmTd);
  scoreTable.appendChild(bmTr);

  bindMoeilijkheidCheck(d);
  scoreModal.style.display = "flex";
}

function saveBM() {
  if (!currentDeelnemer) return;
  const bmInput = document.getElementById("bmInput");
  const value = parseFloat(bmInput.value) || 0;

  fetch(`/api/wedstrijden/${wedstrijd_id}/deelnemer_bm`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nummer: currentDeelnemer.nummer, baan: currentDeelnemer.baan, bm: value })
  }).then(res => {
    if (res.ok) {
      currentDeelnemer.bm = value;
      updateTegel(currentDeelnemer);
      alert("BM opgeslagen!");
    } else alert("Opslaan BM mislukt");
  });
}

// ===== Bind Moeilijkheid =====
function bindMoeilijkheidCheck(d) {
  const moeilijkheidInput = document.getElementById("moeilijkheidInput");
  const warning = document.getElementById("moeilijkheidWarning");
  if (!moeilijkheidInput) return;

  const updateWarning = () => {
    const val = parseFloat(moeilijkheidInput.value) || 0;
    d.moeilijkheid = val;
    if (checkMoeilijkheid(d)) {
      warning.style.display = 'block';
      const tegel = document.querySelector(`.baan-tegel[data-baan="${d.baan}"][data-nummer="${d.nummer}"]`);
      if (tegel && (d.correctie_status === undefined || d.correctie_status === 'geen_verzoek')) tegel.classList.add('teveel-moeilijkheid');
    } else {
      warning.style.display = 'none';
      const tegel = document.querySelector(`.baan-tegel[data-baan="${d.baan}"][data-nummer="${d.nummer}"]`);
      if (tegel) tegel.classList.remove('teveel-moeilijkheid');
    }
  };

  moeilijkheidInput.removeEventListener('input', updateWarning);
  moeilijkheidInput.addEventListener('input', updateWarning);
  updateWarning();
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

  const jury1Input = document.getElementById('jury1Input');
  const jury2Input = document.getElementById('jury2Input');
  const moeilijkheidInput = document.getElementById('moeilijkheidInput');
  const samenstellingInput = document.getElementById('samenstellingInput');
  const bonusHJInput = document.getElementById('bonusHJInput');
  const aftrekHJInput = document.getElementById('aftrekHJInput');
  const statusSelect = document.getElementById('statusSelect');

  const body = {
    nummer: currentDeelnemer.nummer,
    baan: currentDeelnemer.baan,
    jury1: parseFloat(jury1Input.value) || 0,
    jury2: parseFloat(jury2Input.value) || 0,
    moeilijkheid: parseFloat(moeilijkheidInput.value) || 0,
    samenstelling: parseFloat(samenstellingInput.value) || 0,
    bonusHJ: parseFloat(bonusHJInput.value) || 0,
    aftrek_HJ: parseFloat(aftrekHJInput.value) || 0,
    correctie_status: statusSelect.value
  };

  const tmp = Object.assign({}, currentDeelnemer, { moeilijkheid: body.moeilijkheid, max_score: currentDeelnemer.max_score });
  if (checkMoeilijkheid(tmp)) {
    const warning = document.getElementById('moeilijkheidWarning');
    if (warning) warning.style.display = 'block';
    alert('Moeilijkheid is hoger dan toegestaan voor deze categorie. Pas de moeilijkheid of categorie aan.');
    return;
  }

  const res = await fetch(`/api/wedstrijden/${wedstrijd_id}/deelnemer_score`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (res.ok) {
    currentDeelnemer.jury1 = body.jury1;
    currentDeelnemer.jury2 = body.jury2;
    currentDeelnemer.moeilijkheid = body.moeilijkheid;
    currentDeelnemer.samenstelling = body.samenstelling;
    currentDeelnemer.bonusHJ = body.bonusHJ;
    currentDeelnemer.aftrek_HJ = body.aftrek_HJ;
    currentDeelnemer.correctie_status = body.correctie_status;

    updateTegel(currentDeelnemer);
    alert('Scores en status opgeslagen!');
  } else {
    const err = await res.json().catch(()=>({ error: 'Opslaan mislukt' }));
    alert(err.error || 'Opslaan mislukt');
  }
}

async function saveCategorie() {
  if (!currentDeelnemer) return;
  const categorieInput = document.getElementById('categorieInput');
  const body = { nummer: currentDeelnemer.nummer, baan: currentDeelnemer.baan, categorie: categorieInput.value };
  const res = await fetch(`/api/wedstrijden/${wedstrijd_id}/deelnemer_categorie`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  if(res.ok) {
    currentDeelnemer.categorie = body.categorie;
    try {
      const endpoint = getMoeilijkheidEndpoint();
      const r = await fetch(`/api/${endpoint}/max_score?categorie=${encodeURIComponent(body.categorie)}`);
      if (r.ok) currentDeelnemer.max_score = (await r.json()).max_score;
    } catch {}
    alert('Categorie opgeslagen!');
    updateTegel(currentDeelnemer);
  } else alert('Categorie opslaan mislukt');
}

async function updateStatus() {
  if (!currentDeelnemer) return;
  const statusSelect = document.getElementById('statusSelect');
  const newStatus = statusSelect.value;
  const body = { nummer: currentDeelnemer.nummer, baan: currentDeelnemer.baan, correctie_status: newStatus };
  const res = await fetch(`/api/wedstrijden/${wedstrijd_id}/correctie_status`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  if(res.ok) {
    currentDeelnemer.correctie_status = newStatus;
    updateTegel(currentDeelnemer);
    alert('Status bijgewerkt!');
  } else alert('Opslaan mislukt');
}

async function verwijderDeelnemer() {
  if(!currentDeelnemer) return;
  if(!confirm(`Weet je zeker dat je ${currentDeelnemer.naam} wilt verwijderen?`)) return;
  const res = await fetch(`/api/wedstrijden/${wedstrijd_id}/deelnemer`, { method:'DELETE', headers:{'Content-Type':'application/json'}, body:JSON.stringify({nummer:currentDeelnemer.nummer, baan:currentDeelnemer.baan}) });
  if(res.ok) { scoreModal.style.display='none'; await laadBanen(); } else alert('Verwijderen mislukt');
}

const zoekInput = document.getElementById('zoekInput');
zoekInput.addEventListener('input', () => {
    const zoekterm = zoekInput.value.trim();
    const tegels = document.querySelectorAll('.baan-tegel');
    if (zoekterm === "") { tegels.forEach(t => t.style.display = 'block'); return; }
    tegels.forEach(tegel => { const nummer = tegel.dataset.nummer; tegel.style.display = (nummer === zoekterm) ? 'block' : 'none'; });
});

const addTeamBtn = document.getElementById('addTeamBtn');
addTeamBtn.addEventListener('click', async () => {
    const teamNaam = prompt('Teamnaam invoeren:'); if (!teamNaam) return;
    const res = await fetch(`/api/wedstrijden/${wedstrijd_id}/teams`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ naam: teamNaam }) });
    if (res.ok) { alert('Team toegevoegd!'); laadBanen(); } else { alert('Fout bij toevoegen van team'); }
});

// ===== Start =====
saveScoresBtn.addEventListener('click', saveScores);
saveCategorieBtn.addEventListener('click', saveCategorie);
updateStatusBtn.addEventListener('click', updateStatus);
laadBanen();
initSocket();
// ===== Einde =====
