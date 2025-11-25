// ============================================
// 🏆 Jury Pagina Logica met Socket.IO
// ============================================

let mijnWedstrijd = null;
let mijnBaan = null;
let deelnemersData = [];
let socket = null;
let wedstrijdSoort = null;
let toonVerenigingKolom = true; // Globale variabele

// ============================================
// 🔢 Helper: subjury berekenen op basis van wedstrijdSoort
// ============================================
function computeSubjury(j1, j2) {
  const jury1 = Number(j1) || 0;
  const jury2 = Number(j2) || 0;
  if (wedstrijdSoort === 'groepsspringen') {
    return 40 - ((jury1 + jury2) / 2);
  } else if (wedstrijdSoort === 'microteam' || wedstrijdSoort === 'individueel') {
    return (jury1 + jury2) / 2;
  } else {
    return 40 - ((jury1 + jury2) / 2);
  }
}

// ============================================
// ⚡ Helper: Actie-cel index dynamisch
// ============================================
function getActieCelIndex() {
  return toonVerenigingKolom ? 13 : 12;
}

// ============================================
// ⚡ Socket.IO setup
// ============================================
function socketSetup() {
  socket = io({ withCredentials: true });

  socket.on('connect', () => console.log('✅ Verbonden met Socket.IO'));
  socket.on('disconnect', () => document.getElementById('status').textContent = '❌ Verbinding verbroken...');

  socket.on('wedstrijd_geactiveerd', () => laadActieveWedstrijd());

  // Score update per deelnemer en per baan
  socket.on('score_update', d => {
    const deelnemer = deelnemersData.find(x => x.nummer == d.nummer && x.baan == d.baan);
    if (!deelnemer) return;
    Object.assign(deelnemer, d);

    const tr = document.getElementById(`row_${d.nummer}_${d.baan}`);
    if (!tr) return;

    ['jury1', 'jury2', 'moeilijkheid', 'samenstelling', 'bonusHJ', 'aftrek_HJ'].forEach(field => {
      const el = tr.querySelector(`#${field}_${d.nummer}`);
      if (el) el.value = parseFloat(d[field.toLowerCase()] ?? d[field]) || 0;
    });

    recalcRow(d.nummer, d.baan);

    const actieIndex = getActieCelIndex();
    if (d.correctie_status && d.correctie_status !== 'geen_verzoek') {
      tr.querySelectorAll('input').forEach(inp => inp.disabled = true);
      tr.cells[actieIndex].innerHTML = `<span class="status-ingediend">🟠 In behandeling</span>`;
    }

    showToast(`✅ Score bijgewerkt voor ${d.naam ?? 'deelnemer ' + d.nummer}`);
  });

  socket.on('categorie_update', d => {
    const tr = document.getElementById(`row_${d.nummer}_${d.baan}`);
    if (!tr) return;
    tr.cells[toonVerenigingKolom ? 3 : 2].textContent = d.categorie;
    const deelnemer = deelnemersData.find(x => x.nummer == d.nummer && x.baan == d.baan);
    if (deelnemer) deelnemer.categorie = d.categorie;
  });

  socket.on('status_update', d => updateRowStatus(d.nummer, d.baan, d.correctie_status));

  socket.on('new_deelnemer', d => {
    if (parseInt(d.baan) !== parseInt(mijnBaan)) return;
    if (!document.getElementById(`row_${d.nummer}_${d.baan}`)) {
      deelnemersData.push(d);
      document.getElementById('deelnemersBody').appendChild(buildRow(d));
      showToast(`✨ Nieuwe deelnemer: ${d.naam} (nr ${d.nummer})`);
    }
  });

  socket.on('deelnemer_verwijderd', info => {
    if (!info || parseInt(info.wedstrijd_id) !== parseInt(mijnWedstrijd)) return;
    if (parseInt(info.baan) !== parseInt(mijnBaan)) return;

    const tr = document.getElementById(`row_${info.nummer}_${info.baan}`);
    if (tr) {
      tr.remove();
      deelnemersData = deelnemersData.filter(d => !(d.nummer == info.nummer && d.baan == info.baan));
      showToast(`🗑️ ${info.naam} (nr ${info.nummer}) is verwijderd`, true);
    }
  });
}

// ============================================
// 🏁 Actieve wedstrijd laden
// ============================================
async function laadActieveWedstrijd() {
  const statusEl = document.getElementById('status');
  const body = document.getElementById('deelnemersBody');

  try {
    const res = await fetch('/api/mijn_wedstrijd');
    const data = await res.json();
    if (!res.ok || !data?.id) throw new Error('Geen actieve wedstrijd, wacht op admin.');

    mijnWedstrijd = data.id;
    mijnBaan = data.baan;
    wedstrijdSoort = (data.soort || 'onbekend').toLowerCase();

    document.getElementById('baanDisplay').textContent = mijnBaan ?? '?';
    statusEl.textContent = `✅ Actieve wedstrijd: ${data.naam ?? '(naam ontbreekt)'} (${wedstrijdSoort})`;

    await buildDeelnemers();
    socket?.emit('join_wedstrijd', { wedstrijd_id: mijnWedstrijd });

  } catch (e) {
    console.warn('⚠️ Fout bij laden actieve wedstrijd:', e);
    statusEl.textContent = '⏳ Wachten tot de admin of chefjury een wedstrijd op actief zet...';
    body.innerHTML = '<tr><td colspan="14">Nog geen actieve wedstrijd...</td></tr>';
  }
}

// ============================================
// 👥 Deelnemers tabel opbouwen
// ============================================
async function buildDeelnemers() {
  const res = await fetch(`/api/wedstrijden/${mijnWedstrijd}/alle2_deelnemers`);
  const data = await res.json();
  deelnemersData = data.filter(d => d.baan == mijnBaan);

  const body = document.getElementById('deelnemersBody');
  body.innerHTML = '';

  if (!deelnemersData.length) {
    body.innerHTML = '<tr><td colspan="14">Geen deelnemers op deze baan.</td></tr>';
    return;
  }

  // Toon vereniging alleen als er data voor is
  toonVerenigingKolom = deelnemersData.some(d => d.vereniging && d.vereniging.trim() !== '');
  const verenigingHeader = document.getElementById('th_vereniging');
  if (verenigingHeader) verenigingHeader.style.display = toonVerenigingKolom ? '' : 'none';

  deelnemersData.forEach(d => body.appendChild(buildRow(d)));
}

// ============================================
// 🧱 Bouw tabelrij voor deelnemer
// ============================================
function buildRow(d) {
  const tr = document.createElement('tr');
  tr.id = `row_${d.nummer}_${d.baan}`; // uniek ID per nummer + baan

  const jury1 = parseFloat(d.jury1) || 0;
  const jury2 = parseFloat(d.jury2) || 0;
  const moeilijkheid = parseFloat(d.moeilijkheid) || 0;
  const samenstelling = parseFloat(d.samenstelling) || 0;
  const bonusHJ = parseFloat(d.bonusHJ ?? d.bonushj) || 0;
  const aftrekHJ = parseFloat(d.aftrek_HJ ?? d.aftrek_hj) || 0;

  const subjuryVal = computeSubjury(jury1, jury2);
  const subscoreVal = moeilijkheid + samenstelling + bonusHJ - aftrekHJ;
  const totaalVal = subjuryVal + subscoreVal;

  const subjury = (jury1 && jury2) ? subjuryVal.toFixed(2) : '0.00';
  const subscore = subscoreVal.toFixed(2);
  const totaal  = (jury1 && jury2) ? totaalVal.toFixed(2) : '0.00';

  const heeftScores = jury1 !== 0 || jury2 !== 0 || moeilijkheid !== 0 || samenstelling !== 0 || bonusHJ !== 0 || aftrekHJ !== 0;
  const isVerzoek = d.correctie_status && d.correctie_status !== 'geen_verzoek';
  const moetLocken = heeftScores || isVerzoek;

  let actieHTML = '';
  if (d.correctie_status === 'ingediend' || d.correctie_status === 'in_behandeling')
    actieHTML = `<span class="status-ingediend">🟠 In behandeling</span>`;
  else if (d.correctie_status === 'goedgekeurd')
    actieHTML = `<span class="status-goedgekeurd">🟢 Goedgekeurd</span>`;
  else if (d.correctie_status === 'afgewezen')
    actieHTML = `<span class="status-afgewezen">🔴 Afgewezen</span>`;
  else if (heeftScores)
    actieHTML = `<button id="btn_verzoek_${d.nummer}" class="btn-request">Correctieverzoek</button>`;
  else
    actieHTML = `<button id="btn_opslaan_${d.nummer}" class="btn-save">Opslaan</button>`;

  tr.innerHTML = `
    <td>${d.nummer}</td>
    <td>${d.naam}</td>
    ${toonVerenigingKolom ? `<td>${d.vereniging ?? ''}</td>` : ''}
    <td>${d.categorie || ''}</td>
    <td id="totaal_${d.nummer}">${totaal}</td>
    <td><input type="number" step="0.1" id="jury1_${d.nummer}" value="${jury1}"></td>
    <td><input type="number" step="0.1" id="jury2_${d.nummer}" value="${jury2}"></td>
    <td id="subjury_${d.nummer}">${subjury}</td>
    <td><input type="number" step="0.1" id="moeilijkheid_${d.nummer}" value="${moeilijkheid}"></td>
    <td><input type="number" step="0.1" id="samenstelling_${d.nummer}" value="${samenstelling}"></td>
    <td><input type="number" step="0.1" id="bonusHJ_${d.nummer}" value="${bonusHJ}"></td>
    <td><input type="number" step="0.1" id="aftrek_HJ_${d.nummer}" value="${aftrekHJ}"></td>
    <td id="subscore_${d.nummer}">${subscore}</td>
    <td>${actieHTML}</td>
  `;

  if (moetLocken) tr.querySelectorAll('input').forEach(inp => inp.disabled = true);

  tr.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('input', () => recalcRow(d.nummer, d.baan));
  });

  const opslaanBtn = tr.querySelector(`#btn_opslaan_${d.nummer}`);
  const verzoekBtn = tr.querySelector(`#btn_verzoek_${d.nummer}`);

  if (opslaanBtn) opslaanBtn.addEventListener('click', () => handleOpslaan(d.nummer, d.baan));
  if (verzoekBtn) verzoekBtn.addEventListener('click', () => handleVerzoek(d.nummer, d.baan));

  return tr;
}

// ============================================
// 🔁 Live recalculatie van een rij
// ============================================
function recalcRow(nummer, baan) {
  const j1 = parseFloat(document.getElementById(`jury1_${nummer}`).value) || 0;
  const j2 = parseFloat(document.getElementById(`jury2_${nummer}`).value) || 0;
  const m  = parseFloat(document.getElementById(`moeilijkheid_${nummer}`).value) || 0;
  const s  = parseFloat(document.getElementById(`samenstelling_${nummer}`).value) || 0;
  const b  = parseFloat(document.getElementById(`bonusHJ_${nummer}`).value) || 0;
  const a  = parseFloat(document.getElementById(`aftrek_HJ_${nummer}`).value) || 0;

  const subjuryVal = computeSubjury(j1, j2);
  const subscoreVal = m + s + b - a;
  const totaalVal = subjuryVal + subscoreVal;

  const tr = document.getElementById(`row_${nummer}_${baan}`);
  if (!tr) return;

  tr.querySelector(`#subjury_${nummer}`).textContent = (j1 && j2) ? subjuryVal.toFixed(2) : '';
  tr.querySelector(`#subscore_${nummer}`).textContent = subscoreVal.toFixed(2);
  tr.querySelector(`#totaal_${nummer}`).textContent = (j1 && j2) ? totaalVal.toFixed(2) : '';
}

// ============================================
// 💾 Score opslaan
// ============================================
async function handleOpslaan(nummer, baan) {
  const btn = document.getElementById(`btn_opslaan_${nummer}`);
  if (btn) { btn.textContent = 'Opslaan...'; btn.disabled = true; }

  const deelnemer = deelnemersData.find(x => x.nummer == nummer && x.baan == baan);
  if (!deelnemer) { showToast('❌ Deelnemer niet gevonden!', true); return; }

  const jury1 = parseFloat(document.getElementById(`jury1_${nummer}`).value) || 0;
  const jury2 = parseFloat(document.getElementById(`jury2_${nummer}`).value) || 0;
  const moeilijkheid = parseFloat(document.getElementById(`moeilijkheid_${nummer}`).value) || 0;
  const samenstelling = parseFloat(document.getElementById(`samenstelling_${nummer}`).value) || 0;
  const bonusHJ = parseFloat(document.getElementById(`bonusHJ_${nummer}`).value) || 0;
  const aftrek_HJ = parseFloat(document.getElementById(`aftrek_HJ_${nummer}`).value) || 0;

  const subjury = computeSubjury(jury1, jury2);
  const subscore = (moeilijkheid + samenstelling + bonusHJ - aftrek_HJ);
  const totaal = subjury + subscore;

  const data = {
    nummer: deelnemer.nummer,
    baan: deelnemer.baan,
    jury1, jury2, moeilijkheid, samenstelling, bonusHJ, aftrek_HJ,
    subjury: Number(subjury.toFixed(2)),
    subscore: Number(subscore.toFixed(2)),
    totaal: Number(totaal.toFixed(2))
  };

  try {
    const res = await fetch(`/api/wedstrijden/${mijnWedstrijd}/deelnemer_score`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error('Opslaan mislukt');

    Object.assign(deelnemer, data);
    recalcRow(nummer, baan);

    const tr = document.getElementById(`row_${nummer}_${baan}`);
    tr.querySelectorAll('input').forEach(inp => inp.disabled = true);

    const actieIndex = getActieCelIndex();
    tr.cells[actieIndex].innerHTML = `<button id="btn_verzoek_${nummer}" class="btn-request">Correctieverzoek</button>`;
    tr.querySelector(`#btn_verzoek_${nummer}`).addEventListener('click', () => handleVerzoek(nummer, baan));

    showToast('✅ Score opgeslagen en vergrendeld!');
  } catch (e) {
    showToast(`❌ ${e.message}`, true);
    if (btn) { btn.textContent = 'Opslaan'; btn.disabled = false; }
  }
}

// ============================================
// 🟢 Correctieverzoek indienen
// ============================================
async function handleVerzoek(nummer, baan) {
  const btn = document.getElementById(`btn_verzoek_${nummer}`);
  if (!btn) return;
  btn.textContent = 'Verzenden...';
  btn.disabled = true;

  const data = { nummer, baan, correctie_status: 'ingediend' };
  try {
    const res = await fetch(`/api/wedstrijden/${mijnWedstrijd}/correctie_status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error('Verzoek mislukt');

    const tr = document.getElementById(`row_${nummer}_${baan}`);
    const actieIndex = getActieCelIndex();
    tr.cells[actieIndex].innerHTML = `<span class="status-ingediend">🟠 In behandeling</span>`;
    showToast('✅ Correctieverzoek verzonden!');
  } catch (e) {
    showToast(`❌ ${e.message}`, true);
    btn.textContent = 'Correctieverzoek';
    btn.disabled = false;
  }
}

// ============================================
// 🔄 Rij status updaten
// ============================================
function updateRowStatus(nummer, baan, status) {
  const tr = document.getElementById(`row_${nummer}_${baan}`);
  if (!tr) return;
  const actieIndex = getActieCelIndex();

  if (status === 'ingediend' || status === 'in_behandeling')
    tr.cells[actieIndex].innerHTML = `<span class="status-ingediend">🟠 In behandeling</span>`;
  else if (status === 'goedgekeurd')
    tr.cells[actieIndex].innerHTML = `<span class="status-goedgekeurd">🟢 Goedgekeurd</span>`;
  else if (status === 'afgewezen')
    tr.cells[actieIndex].innerHTML = `<span class="status-afgewezen">🔴 Afgewezen</span>`;
  else
    tr.cells[actieIndex].innerHTML = `<button id="btn_opslaan_${nummer}" class="btn-save">Opslaan</button>`;
}

// ============================================
// 🔔 Toast notificatie
// ============================================
function showToast(message = "✅ Opgeslagen!", isError = false, duration = 3000) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    document.body.appendChild(toast);
  }

  toast.textContent = message;
  toast.style.backgroundColor = isError ? '#dc3545' : '#4a90e2';
  toast.style.color = '#fff';
  toast.style.padding = '12px 24px';
  toast.style.borderRadius = '6px';
  toast.style.position = 'fixed';
  toast.style.top = '20px';
  toast.style.left = '50%';
  toast.style.transform = 'translateX(-50%)';
  toast.style.zIndex = '9999';
  toast.style.fontWeight = 'bold';
  toast.style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)';
  toast.style.opacity = '0';
  toast.style.transition = 'opacity 0.3s ease';

  requestAnimationFrame(() => toast.style.opacity = '1');

  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 500);
  }, duration);
}

// ============================================
// 🚀 Initialisatie
// ============================================
async function initPage() {
  socketSetup();
  await laadActieveWedstrijd();
}
initPage();
