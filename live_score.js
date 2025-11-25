let socket = null;
let alleBaanData = {};
let diaOrder = [];
let ontvangenBanen = new Set();
let loopGestart = false;
let actieveWedstrijdId = null;
let isPauzeLoop = false;

let scoreLoopInterval = null;
let infoLoopInterval = null;

let laatsteDrieBanen = [];
let nieuweScoresBuffer = new Set();

// ✅ Buffer voor vertraagde updates
let scoreBuffer = {};
let bufferTimer = null;
const BUFFER_INTERVAL = 3 * 60 * 1000; // 3 minuten wachten

// ---------- helpers ----------

function toonWelkomDia() {
  document.querySelectorAll('.dia').forEach(d => d.classList.remove('active'));
  const welkom = document.getElementById('welcome-dia');
  if (welkom) welkom.classList.add('active');
}

function adjustFontSize(el, maxFont) {
  const parentWidth = el.parentElement.offsetWidth;
  let fontSize = maxFont;
  el.style.fontSize = fontSize + 'px';
  while (el.scrollWidth > parentWidth && fontSize > 20) {
    fontSize -= 2;
    el.style.fontSize = fontSize + 'px';
  }
}

// ---------- info-dia ----------

function toonInfoDia(bericht) {
  const container = document.getElementById('diasContainer');
  let infoDia = document.getElementById('infoDia');
  if (!infoDia) {
    infoDia = document.createElement('div');
    infoDia.id = 'infoDia';
    infoDia.className = 'dia center-dia';
    infoDia.innerHTML = `
      <h1>INFO</h1>
      <div class="bericht"></div>
    `;
    container.appendChild(infoDia);
  }
  infoDia.querySelector('.bericht').textContent =
    (bericht || '').replace(/^INFO:\s*/i, '') || 'INFO';
}

// ---------- socket setup ----------

function socketSetup() {
  socket = io({ withCredentials: true });

  socket.on('connect', () => {
    console.log('✅ Verbonden met Socket.IO');
    if (actieveWedstrijdId)
      socket.emit('join_wedstrijd', { wedstrijd_id: actieveWedstrijdId });
  });

  socket.on('disconnect', () => console.warn('❌ Verbinding verbroken...'));

  // ✅ SCORES KOMEN BINNEN → eerst bufferen
  socket.on('score_update', d => {
    if (!d.baan) return;
    scoreBuffer[d.baan] = {
      moeilijkheid: d.moeilijkheid ?? 0,
      samenstelling: d.samenstelling ?? 0,
      bonusHJ: d.bonusHJ ?? 0,
      aftrek_HJ: d.aftrek_HJ ?? 0,
      subscore: d.subscore ?? 0,
      team: d.naam ?? '',
      categorie: d.categorie ?? ''
    };

    if (!bufferTimer) {
      bufferTimer = setTimeout(() => {
        console.log('⏱️ 3 minuten voorbij — verwerk buffered scores');
        Object.keys(scoreBuffer).forEach(baan => {
          alleBaanData[baan] = scoreBuffer[baan];
          updateDia(baan);
          ontvangenBanen.add(baan);
        });
        scoreBuffer = {};
        bufferTimer = null;

        if (ontvangenBanen.size >= 3 && !loopGestart && !isPauzeLoop) {
          startScoreLoop();
          loopGestart = true;
        }
      }, BUFFER_INTERVAL);
    }
  });

  socket.on('pauze_dia', () => {
    console.log('⏸️ Pauze ontvangen');
    stopAlleLoops();
    isPauzeLoop = true;
    loopGestart = false;
    toonWelkomDia();
    startInfoLoop();
  });

  socket.on('resume_dia', data => {
    console.log('▶️ Hervatten ontvangen', data);
    stopAlleLoops();
    isPauzeLoop = false;
    nieuweScoresBuffer.clear();
    loopGestart = false;

    const infoDia = document.getElementById('infoDia');
    if (infoDia) infoDia.remove();

    if (laatsteDrieBanen.length > 0) {
      console.log('🔁 Laatste 3 dia’s tonen:', laatsteDrieBanen);
      let i = 0;
      const interval = setInterval(() => {
        document.querySelectorAll('.dia').forEach(d =>
          d.classList.remove('active')
        );
        const id = laatsteDrieBanen[i];
        const dia = document.getElementById(id);
        if (dia) dia.classList.add('active');
        i++;
        if (i >= laatsteDrieBanen.length) {
          clearInterval(interval);
          console.log('⏭️ Wacht op nieuwe scores...');
        }
      }, 4000);
    } else {
      console.log('Geen vorige dia’s — start loop.');
      loopGestart = true;
      startScoreLoop();
    }
  });

  socket.on('info_dia', data => {
    console.log('🟢 Info-dia ontvangen:', data);
    stopAlleLoops();
    isPauzeLoop = true;
    toonInfoDia(data.bericht);
    startInfoLoop();
  });
}

// ---------- dia’s ----------

function createDia(baan) {
  if (document.getElementById(`dia_${baan}`)) return;
  const container = document.getElementById('diasContainer');
  const dia = document.createElement('div');
  dia.className = 'dia';
  dia.id = `dia_${baan}`;
  dia.innerHTML = `
    <div class="team-info">
      <div class="team-naam" id="team_${baan}"></div>
      <div class="team-categorie" id="cat_${baan}"></div>
    </div>
    <div class="scores">
      <div class="scoreblok"><span class="label">Moeilijkheid</span><span class="waarde" id="m_${baan}">0.00</span></div>
      <div class="scoreblok"><span class="label">Samenstelling</span><span class="waarde" id="s_${baan}">0.00</span></div>
      <div class="scoreblok"><span class="label">Bonus HJ</span><span class="waarde" id="b_${baan}">0.00</span></div>
      <div class="scoreblok"><span class="label">Aftrek HJ</span><span class="waarde" id="a_${baan}">0.00</span></div>
      <div class="scoreblok"><span class="label">Subscore</span><span class="waarde" id="sub_${baan}">0.00</span></div>
    </div>
  `;
  container.appendChild(dia);
  diaOrder.push(`dia_${baan}`);
}

function updateDia(baan) {
  if (!alleBaanData[baan]) return;
  document.getElementById(`m_${baan}`).textContent = Number(
    alleBaanData[baan].moeilijkheid
  ).toFixed(2);
  document.getElementById(`s_${baan}`).textContent = Number(
    alleBaanData[baan].samenstelling
  ).toFixed(2);
  document.getElementById(`b_${baan}`).textContent = Number(
    alleBaanData[baan].bonusHJ
  ).toFixed(2);
  document.getElementById(`a_${baan}`).textContent = Number(
    alleBaanData[baan].aftrek_HJ
  ).toFixed(2);
  document.getElementById(`sub_${baan}`).textContent = Number(
    alleBaanData[baan].subscore
  ).toFixed(2);

  const teamEl = document.getElementById(`team_${baan}`);
  teamEl.textContent = alleBaanData[baan].team;
  adjustFontSize(teamEl, 700);
  document.getElementById(`cat_${baan}`).textContent =
    alleBaanData[baan].categorie;
}

// ---------- loops ----------

function stopAlleLoops() {
  clearInterval(scoreLoopInterval);
  clearInterval(infoLoopInterval);
  scoreLoopInterval = null;
  infoLoopInterval = null;

  const actieveDia = document.querySelector('.dia.active');
  if (actieveDia) {
    const idx = diaOrder.indexOf(actieveDia.id);
    laatsteDrieBanen = diaOrder.slice(Math.max(0, idx - 2), idx + 1);
    console.log('💾 Laatste 3 dia’s opgeslagen:', laatsteDrieBanen);
  }
}

function startScoreLoop(interval = 5000) {
  if (isPauzeLoop || diaOrder.length === 0) return;
  console.log('▶️ Start score-loop');
  stopAlleLoops();

  let i = 0;
  scoreLoopInterval = setInterval(() => {
    if (isPauzeLoop) return;
    document.querySelectorAll('.dia').forEach(d =>
      d.classList.remove('active')
    );
    const dia = document.getElementById(diaOrder[i % diaOrder.length]);
    if (dia) dia.classList.add('active');
    i++;
  }, interval);
}

function startInfoLoop(interval = 5000) {
  console.log('🟡 Start info-loop');
  stopAlleLoops();
  const welkom = document.getElementById('welcome-dia');
  const info = document.getElementById('infoDia');
  if (!welkom || !info) return;

  let toggle = 0;
  document.querySelectorAll('.dia').forEach(d => d.classList.remove('active'));
  welkom.classList.add('active');

  infoLoopInterval = setInterval(() => {
    document.querySelectorAll('.dia').forEach(d =>
      d.classList.remove('active')
    );
    if (toggle % 2 === 0) welkom.classList.add('active');
    else info.classList.add('active');
    toggle++;
  }, interval);
}

// ---------- init ----------

async function initPage() {
  socketSetup();
  try {
    const res = await fetch('/api/live_scores');
    const data = await res.json();
    const container = document.getElementById('diasContainer');

    actieveWedstrijdId = data?.wedstrijd?.id ?? null;
    console.log('📦 Actieve wedstrijd:', actieveWedstrijdId);

    const welkomDia = document.createElement('div');
welkomDia.className = 'dia active center-dia';
welkomDia.id = 'welcome-dia';
welkomDia.innerHTML = `
  <h1>Welkom in ${data.wedstrijd?.locatie ?? ''}</h1>
  <div class="naam">${data.wedstrijd?.naam ?? ''}</div>
`;

    container.appendChild(welkomDia);
    diaOrder.push('welcome-dia');

    if (data.banen && data.banen.length) {
      data.banen.forEach(b => {
        alleBaanData[b.baan] = {
          moeilijkheid: b.moeilijkheid ?? 0,
          samenstelling: b.samenstelling ?? 0,
          bonusHJ: b.bonusHJ ?? 0,
          aftrek_HJ: b.aftrek_HJ ?? 0,
          subscore: b.subscore ?? 0,
          team: b.naam ?? '',
          categorie: b.categorie ?? ''
        };
        createDia(b.baan);
        updateDia(b.baan);
      });
    }

    if (socket.connected && actieveWedstrijdId) {
      socket.emit('join_wedstrijd', { wedstrijd_id: actieveWedstrijdId });
    }
  } catch (e) {
    console.error('❌ Fout bij laden van scores:', e);
  }
}

initPage();
