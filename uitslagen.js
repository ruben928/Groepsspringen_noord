// uitslagen.js — volledig herschreven en werkend + EXCEL EXPORT
(() => {
  'use strict';

  // ===== Config / state =====
  let mijnWedstrijd = null;
  let wedstrijdSoort = null;
  let deelnemersData = [];
  let socket = null;
  let showVereniging = true;

  // ===== Hulpfuncties =====
  const toNum = v => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  function normalizeDeelnemer(d) {
    if (!d) return d;
    d.bonushj = toNum(d.bonushj ?? d.bonusHJ ?? d.bonus_hj ?? d.bonus_hj_score ?? 0);
    d.jury1 = toNum(d.jury1 || 0);
    d.jury2 = toNum(d.jury2 || 0);
    d.moeilijkheid = toNum(d.moeilijkheid || 0);
    d.samenstelling = toNum(d.samenstelling || 0);
    d.aftrek_HJ = toNum(d.aftrek_HJ || d.aftrekHJ || 0);
    return d;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function calculateScoresNumeric(d) {
    const jury1 = toNum(d.jury1);
    const jury2 = toNum(d.jury2);
    const moeilijkheid = toNum(d.moeilijkheid);
    const samenstelling = toNum(d.samenstelling);
    const bonushj = toNum(d.bonushj);
    const aftrek_hj = toNum(d.aftrek_HJ);

    const soort = (wedstrijdSoort || '').toLowerCase();
    const categorie = (d.categorie || '').trim().toLowerCase();

    let subjury = 0;
    if (jury1 > 0.00 || jury2 > 0.00) {
      if (
        categorie.includes('airtrack') ||
        categorie.includes('trampoline')
      ) {
        // Voor airtrack / trampoline: gemiddeld
        subjury = (jury1 + jury2) / 2;
      } else if (soort === 'groepsspringen') {
        subjury = 40 - (jury1 + jury2) / 2;
      } else if (soort === 'microteam' || soort === 'individueel') {
        subjury = 40 - (jury1 + jury2) / 2;
      }
    }

    const subscore = moeilijkheid + samenstelling + bonushj - aftrek_hj;
    const totaal = subjury + subscore;

    return { subjury, subscore, totaal };
  }

  function getCorrectedJuryValues(d) {
    const soort = (wedstrijdSoort || '').toLowerCase();
    let jury1corr = toNum(d.jury1);
    let jury2corr = toNum(d.jury2);

    if (soort === 'groepsspringen' || soort === 'microteam' || soort === 'individueel') {
      // Voor deze soorten wordt de jurywaarde (indien >0) omgezet naar 40 - waarde
      if (jury1corr > 0) jury1corr = 40 - jury1corr;
      if (jury2corr > 0) jury2corr = 40 - jury2corr;
    }

    return { jury1corr, jury2corr };
  }

  // ===== Rij bouwen =====
  function buildRow(d, plaats) {
    // d is een individuele deelnemer (niet samengevoegd)
    const { jury1corr, jury2corr } = getCorrectedJuryValues(d);
    const dForCalc = { ...d, jury1: jury1corr, jury2: jury2corr };
    const s = calculateScoresNumeric(dForCalc);

    const tr = document.createElement('tr');
    const heeftJury = (jury1corr > 0 || jury2corr > 0);
    const subjuryText = heeftJury ? s.subjury.toFixed(2) : '0.00';
    const totaalText = heeftJury ? s.totaal.toFixed(2) : '0.00';

    tr.innerHTML = `
      <td>${plaats}</td>
      <td>${escapeHtml(d.naam || '')}</td>
      ${showVereniging ? `<td>${escapeHtml(d.vereniging || '')}</td>` : ''}
      <td class="cijferkolom">${totaalText}</td>
      <td class="cijferkolom">${jury1corr.toFixed(2)}</td>
      <td class="cijferkolom">${jury2corr.toFixed(2)}</td>
      <td class="cijferkolom">${subjuryText}</td>
      <td class="cijferkolom">${toNum(d.moeilijkheid).toFixed(2)}</td>
      <td class="cijferkolom">${toNum(d.samenstelling).toFixed(2)}</td>
      <td class="cijferkolom">${toNum(d.bonushj).toFixed(2)}</td>
      <td class="cijferkolom">${toNum(d.aftrek_HJ).toFixed(2)}</td>
      <td class="cijferkolom">${s.subscore.toFixed(2)}</td>
    `;
    return tr;
  }

  // ===== Aggregated row builder (voor microteam) =====
  function buildAggregatedRow(agg, plaats) {
    // agg: { nummer, naam, vereniging, categorie, totaal, subjury, subscore, moeilijkheid, samenstelling, bonushj, aftrek_HJ }
    const tr = document.createElement('tr');

    // Voor jury1/jury2: vaak niet eenduidig bij samenvoegen — we tonen '-' om te laten zien dat het samengestelde waarde is
    const jury1Text = agg.jury1_display ?? '-';
    const jury2Text = agg.jury2_display ?? '-';

    tr.innerHTML = `
      <td>${plaats}</td>
      <td>${escapeHtml(agg.naam || '')}</td>
      ${showVereniging ? `<td>${escapeHtml(agg.vereniging || '')}</td>` : ''}
      <td class="cijferkolom">${toNum(agg.totaal).toFixed(2)}</td>
      <td class="cijferkolom">${typeof jury1Text === 'number' ? jury1Text.toFixed(2) : escapeHtml(jury1Text)}</td>
      <td class="cijferkolom">${typeof jury2Text === 'number' ? jury2Text.toFixed(2) : escapeHtml(jury2Text)}</td>
      <td class="cijferkolom">${toNum(agg.subjury).toFixed(2)}</td>
      <td class="cijferkolom">${toNum(agg.moeilijkheid).toFixed(2)}</td>
      <td class="cijferkolom">${toNum(agg.samenstelling).toFixed(2)}</td>
      <td class="cijferkolom">${toNum(agg.bonushj).toFixed(2)}</td>
      <td class="cijferkolom">${toNum(agg.aftrek_HJ).toFixed(2)}</td>
      <td class="cijferkolom">${toNum(agg.subscore).toFixed(2)}</td>
    `;
    return tr;
  }

  // ===== Teamranking per niveau =====
  function calculateTeamRankingPerNiveau() {
    const categoriesByNiveau = {};

    deelnemersData.forEach(d => {
      let niveauMatch = (d.categorie || '').match(/\b([ABC])\b/i);
      const niveau = niveauMatch ? niveauMatch[1].toUpperCase() : 'Onbekend';
      if (!categoriesByNiveau[niveau]) categoriesByNiveau[niveau] = [];
      categoriesByNiveau[niveau].push(d);
    });

    const rankingByNiveau = {};

    Object.entries(categoriesByNiveau).forEach(([niveau, catDeelnemers]) => {
      // MICROTEAM: groep per (nummer, naam, categorie) en tel totalen op
      if ((wedstrijdSoort || '').toLowerCase() === 'microteam') {
        const teams = {};
        catDeelnemers.forEach(d => {
          const key = `${d.nummer}__${(d.naam||'').trim()}__${(d.categorie||'').trim()}`;

          const { jury1corr, jury2corr } = getCorrectedJuryValues(d);
          const dForCalc = { ...d, jury1: jury1corr, jury2: jury2corr };
          const s = calculateScoresNumeric(dForCalc); // { subjury, subscore, totaal }

          if (!teams[key]) {
            teams[key] = {
              nummer: d.nummer,
              naam: d.naam || 'Onbekend',
              vereniging: d.vereniging || '',
              categorie: d.categorie || '',
              totaal: 0,
              subjury: 0,
              subscore: 0,
              moeilijkheid: 0,
              samenstelling: 0,
              bonushj: 0,
              aftrek_HJ: 0,
              // we kunnen jury1/jury2 als display bewaren (bijv. average) — maar vaak niet eenduidig: we laten het leeg
              jury1_values: [],
              jury2_values: []
            };
          }

          teams[key].totaal += toNum(s.totaal);
          teams[key].subjury += toNum(s.subjury);
          teams[key].subscore += toNum(s.subscore);
          teams[key].moeilijkheid += toNum(d.moeilijkheid);
          teams[key].samenstelling += toNum(d.samenstelling);
          teams[key].bonushj += toNum(d.bonushj);
          teams[key].aftrek_HJ += toNum(d.aftrek_HJ);
          teams[key].jury1_values.push(jury1corr);
          teams[key].jury2_values.push(jury2corr);
        });

        // Maak array en kies wat we tonen als jury1/jury2 (bijv. gemiddelde als er meerdere waarden zijn)
        const teamsArray = Object.values(teams).map(t => {
          const jury1_display = t.jury1_values.length ? (t.jury1_values.reduce((a,b)=>a+b,0)/t.jury1_values.length) : null;
          const jury2_display = t.jury2_values.length ? (t.jury2_values.reduce((a,b)=>a+b,0)/t.jury2_values.length) : null;
          return {
            nummer: t.nummer,
            naam: t.naam,
            vereniging: t.vereniging,
            categorie: t.categorie,
            totaal: t.totaal,
            subjury: t.subjury,
            subscore: t.subscore,
            moeilijkheid: t.moeilijkheid,
            samenstelling: t.samenstelling,
            bonushj: t.bonushj,
            aftrek_HJ: t.aftrek_HJ,
            jury1_display,
            jury2_display
          };
        });

        // Sorteer op totaal aflopend
        teamsArray.sort((a,b) => b.totaal - a.totaal);

        // Ranking: [ [teamnaam, totaal], ... ]
        rankingByNiveau[niveau] = teamsArray.map(t => [t.naam, t.totaal]);

        return;
      }

      // ANDERE ZOORTEN: normale teamranking (max score per team)
      const teamMaxScores = {};
      catDeelnemers.forEach(d => {
        const team = (d.vereniging && d.vereniging.trim()) ? d.vereniging : d.naam || 'Onbekend';
        const { jury1corr, jury2corr } = getCorrectedJuryValues(d);
        const dForCalc = { ...d, jury1: jury1corr, jury2: jury2corr };
        const score = calculateScoresNumeric(dForCalc).totaal;

        if (toNum(score) > 0) {
          if (!teamMaxScores[team] || score > teamMaxScores[team]) {
            teamMaxScores[team] = score;
          }
        }
      });

      rankingByNiveau[niveau] = Object.entries(teamMaxScores)
        .sort((a, b) => b[1] - a[1]);
    });

    return rankingByNiveau;
  }

  // ===== Teamranking tonen =====
  function displayOverallTeamRankingPerNiveau() {
    const rankingByNiveau = calculateTeamRankingPerNiveau();
    const container = document.getElementById('tablesContainer');
    if (!container) return;

    // Plaats de team-rankings onder de tabellen; we verwijderen eerst oude rank-views
    const oldRankings = container.querySelectorAll('.team-ranking');
    oldRankings.forEach(n => n.remove());

    Object.entries(rankingByNiveau).forEach(([niveau, rankingArray]) => {
      if (!rankingArray || rankingArray.length === 0) return;

      const div = document.createElement('div');
      div.className = 'team-ranking';
      div.style.textAlign = 'center';
      div.style.marginTop = '12px';

      const table = document.createElement('table');
      table.style.margin = '0 auto';
      table.innerHTML = `
        <thead>
          <tr><th colspan="2">Teamranking Niveau ${escapeHtml(niveau)}</th></tr>
          <tr>
            <th>Team</th>
            <th>Score</th>
          </tr>
        </thead>
        <tbody>
          ${rankingArray.map(([team, score]) => `
            <tr>
              <td>${escapeHtml(team)}</td>
              <td>${toNum(score).toFixed(2)}</td>
            </tr>
          `).join('')}
        </tbody>
      `;
      div.appendChild(table);
      container.appendChild(div);
    });
  }

  // ===== Tabellen bouwen =====
  function populateTables() {
    const container = document.getElementById('tablesContainer');
    if (!container) return;
    container.innerHTML = '';

    if (!deelnemersData.length) {
      container.innerHTML = '<p>Geen deelnemers beschikbaar.</p>';
      return;
    }

    showVereniging = deelnemersData.some(d => d.vereniging && d.vereniging.trim() !== '');

    // Unieke categorieën (exact zoals jouw data)
    let categories = [...new Set(deelnemersData.map(d => d.categorie || 'Onbekend'))];

    // Prioriteit-sorting (zoals je had)
    const niveaus = ['Jeugd C', 'Jeugd B', 'Jeugd A',
                     'Junior C', 'Junior B', 'Junior A',
                     'Senior C', 'Senior B', 'Senior A'];

    const toestellen = ['Airtrack', 'Trampoline valmat', 'Trampoline springtoestel'];
    const prioriteit = [];
    toestellen.forEach(toestel => {
      niveaus.forEach(niveau => {
        prioriteit.push(`${niveau} ${toestel}`);
      });
    });

    function getPrioriteitIndex(cat) {
      const match = prioriteit.findIndex(p => cat.toLowerCase() === p.toLowerCase());
      return match !== -1 ? match : prioriteit.length + cat.localeCompare('');
    }

    categories.sort((a, b) => getPrioriteitIndex(a) - getPrioriteitIndex(b));

    // Voor elke categorie: maak blok en tabel
    categories.forEach(cat => {
      const block = document.createElement('div');
      block.className = 'category-block';
      const h3 = document.createElement('h3');
      h3.textContent = `Categorie: ${cat}`;
      block.appendChild(h3);

      // Filter deelnemers voor deze categorie
      const catDeelnemers = deelnemersData.filter(d => (d.categorie || 'Onbekend') === cat);

      // Voor microteam: maak samengestelde rijen per team (nummer+naam+categorie)
      let rowsSource = null;
      if ((wedstrijdSoort || '').toLowerCase() === 'microteam') {
        // Groeperen en sommeren
        const groups = {};
        catDeelnemers.forEach(d => {
          const key = `${d.nummer}__${(d.naam||'').trim()}__${(d.categorie||'').trim()}`;

          const { jury1corr, jury2corr } = getCorrectedJuryValues(d);
          const dForCalc = { ...d, jury1: jury1corr, jury2: jury2corr };
          const s = calculateScoresNumeric(dForCalc);

          if (!groups[key]) {
            groups[key] = {
              nummer: d.nummer,
              naam: d.naam || 'Onbekend',
              vereniging: d.vereniging || '',
              categorie: d.categorie || '',
              totaal: 0,
              subjury: 0,
              subscore: 0,
              moeilijkheid: 0,
              samenstelling: 0,
              bonushj: 0,
              aftrek_HJ: 0,
              jury1_values: [],
              jury2_values: []
            };
          }

          groups[key].totaal += toNum(s.totaal);
          groups[key].subjury += toNum(s.subjury);
          groups[key].subscore += toNum(s.subscore);
          groups[key].moeilijkheid += toNum(d.moeilijkheid);
          groups[key].samenstelling += toNum(d.samenstelling);
          groups[key].bonushj += toNum(d.bonushj);
          groups[key].aftrek_HJ += toNum(d.aftrek_HJ);
          groups[key].jury1_values.push(jury1corr);
          groups[key].jury2_values.push(jury2corr);
        });

        // Converteer naar array en sorteer
        const aggregated = Object.values(groups).map(g => {
          const jury1_display = g.jury1_values.length ? (g.jury1_values.reduce((a,b)=>a+b,0)/g.jury1_values.length) : null;
          const jury2_display = g.jury2_values.length ? (g.jury2_values.reduce((a,b)=>a+b,0)/g.jury2_values.length) : null;
          return {
            nummer: g.nummer,
            naam: g.naam,
            vereniging: g.vereniging,
            categorie: g.categorie,
            totaal: g.totaal,
            subjury: g.subjury,
            subscore: g.subscore,
            moeilijkheid: g.moeilijkheid,
            samenstelling: g.samenstelling,
            bonushj: g.bonushj,
            aftrek_HJ: g.aftrek_HJ,
            jury1_display,
            jury2_display
          };
        });

        aggregated.sort((a,b) => b.totaal - a.totaal);
        rowsSource = aggregated; // Dit is wat we in de tabel renderen (samengevoegde rijen)

      } else {
        // Normale (individuele) weergave: sorteer per score
        const sorted = catDeelnemers.slice();
        sorted.sort((a, b) => {
          const { jury1corr: j1a, jury2corr: j2a } = getCorrectedJuryValues(a);
          const { jury1corr: j1b, jury2corr: j2b } = getCorrectedJuryValues(b);
          const ta = calculateScoresNumeric({ ...a, jury1: j1a, jury2: j2a }).totaal;
          const tb = calculateScoresNumeric({ ...b, jury1: j1b, jury2: j2b }).totaal;
          return tb - ta;
        });
        rowsSource = sorted;
      }

      // Bouw tabel
      const tableWrap = document.createElement('div');
      tableWrap.className = 'table-wrap';
      const table = document.createElement('table');

      table.innerHTML = `
        <thead>
          <tr>
            <th>Plaats</th>
            <th>Naam</th>
            ${showVereniging ? '<th>Vereniging</th>' : ''}
            <th class="cijferkolom">Totaal</th>
            <th class="cijferkolom">Jury1</th>
            <th class="cijferkolom">Jury2</th>
            <th class="cijferkolom">Subjury</th>
            <th class="cijferkolom">Moeilijkheid</th>
            <th class="cijferkolom">Samenstelling</th>
            <th class="cijferkolom">Bonus</th>
            <th class="cijferkolom">Aftrek HJ</th>
            <th class="cijferkolom">Subscore</th>
          </tr>
        </thead>
        <tbody></tbody>
      `;

      const tbody = table.querySelector('tbody');

      // Rijen toevoegen (afhankelijk van microteam of niet)
      rowsSource.forEach((r, i) => {
        if ((wedstrijdSoort || '').toLowerCase() === 'microteam') {
          tbody.appendChild(buildAggregatedRow(r, i + 1));
        } else {
          tbody.appendChild(buildRow(r, i + 1));
        }
      });

      tableWrap.appendChild(table);
      block.appendChild(tableWrap);
      container.appendChild(block);
    });

    // Teamranking tonen (onder tabellen)
    displayOverallTeamRankingPerNiveau();
  }

  // ===== Excel export zoals printlayout =====
  function exportAllTablesToExcel() {
    const blocks = document.querySelectorAll('.category-block');
    if (!blocks.length) {
        alert('Geen tabellen gevonden om te exporteren.');
        return;
    }

    const wb = XLSX.utils.book_new();
    const ws = {};

    let rowOffset = 0;
    const sheetData = [];

    blocks.forEach(block => {
        const titleEl = block.querySelector('h3');
        const tableEl = block.querySelector('table');
        if (!tableEl) return;

        // Titel toevoegen als rij
        sheetData.push([titleEl ? titleEl.textContent : "Categorie"]);
        rowOffset++;

        // Lege rij tussen titels en tabel voor leesbaarheid
        sheetData.push([]);
        rowOffset++;

        // HTML-tabel → array data
        const tableData = XLSX.utils.sheet_to_json(
            XLSX.utils.table_to_sheet(tableEl),
            { header: 1 }
        );

        // Toevoegen aan hoofd-blad
        tableData.forEach(row => sheetData.push(row));

        // Extra lege rij na de tabel
        sheetData.push([]);
        rowOffset++;
    });

    // Eén werkblad maken
    const wsFinal = XLSX.utils.aoa_to_sheet(sheetData);

    // Kolombreedtes instellen
    wsFinal['!cols'] = [
        { wpx: 42 },   // Plaats
        { wpx: 185 },  // Naam
        { wpx: 120 },  // Vereniging
        { wpx: 53 },
        { wpx: 53 },
        { wpx: 53 },
        { wpx: 53 },
        { wpx: 53 },
        { wpx: 53 },
        { wpx: 53 },
        { wpx: 53 },
        { wpx: 53 }
    ];

    XLSX.utils.book_append_sheet(wb, wsFinal, "Uitslagen");
    XLSX.writeFile(wb, "uitslagen.xlsx");
  }

  // ===== Data laden & sockets =====
  async function loadDeelnemers() {
    try {
      const res = await fetch(`/api/wedstrijden/${mijnWedstrijd}/alle2_deelnemers`);
      if (!res.ok) throw new Error('Kon deelnemers niet laden');
      const data = await res.json();
      deelnemersData = (Array.isArray(data) ? data : []).map(normalizeDeelnemer);
      populateTables();
    } catch (e) {
      const container = document.getElementById('tablesContainer');
      if (container) container.innerHTML = `<p>Fout bij laden: ${escapeHtml(e.message)}</p>`;
      console.error(e);
    }
  }

  function socketSetup() {
    if (typeof io === 'undefined') {
      console.warn('Socket.IO niet beschikbaar — geen live updates.');
      return;
    }

    socket = io({ withCredentials: true });

    socket.on('connect', () => {
      const s = document.getElementById('status');
      if (s) s.textContent = '✅ Verbonden met server';
      if (mijnWedstrijd) socket.emit('join_wedstrijd', { wedstrijd_id: mijnWedstrijd });
    });

    socket.on('disconnect', () => {
      const s = document.getElementById('status');
      if (s) s.textContent = '❌ Verbinding verbroken...';
    });

    ['score_update', 'categorie_update', 'status_update', 'new_deelnemer']
      .forEach(evt => {
        socket.on(evt, payload => {
          const d = normalizeDeelnemer(payload);
          updateDeelnemer(d);
        });
      });
  }

  function updateDeelnemer(d) {
    // Update of insert op basis van nummer + baan (zoals eerder)
    const idx = deelnemersData.findIndex(x => x.nummer == d.nummer && x.baan == d.baan);
    if (idx === -1) deelnemersData.push(d);
    else Object.assign(deelnemersData[idx], d);
    populateTables();
  }

  // print-kolomnamen aanpassing
  window.onbeforeprint = function () {
    const headers = document.querySelectorAll('table thead tr th');
    if (headers.length >= 10) {
      headers[6].textContent = 'Moei';
      headers[7].textContent = 'Smstl';
      headers[8].textContent = 'Bonus';
      headers[9].textContent = 'Aftrek';
    }
  };
  window.onafterprint = function () {
    const headers = document.querySelectorAll('table thead tr th');
    if (headers.length >= 10) {
      headers[6].textContent = 'Moeilijkheid';
      headers[7].textContent = 'Samenstelling';
      headers[8].textContent = 'Bonus';
      headers[9].textContent = 'Aftrek HJ';
    }
  };

  // ===== Init =====
  async function initPage() {
    const statusEl = document.getElementById('status');
    if (statusEl) statusEl.textContent = '⏳ Laden...';

    try {
      const r = await fetch('/api/mijn_wedstrijd');
      if (!r.ok) throw new Error('Geen actieve wedstrijd gevonden');

      const wedstrijd = await r.json();
      mijnWedstrijd = wedstrijd.id;
      wedstrijdSoort = (wedstrijd.soort || '').toLowerCase();

      document.title = `Uitslagen ${wedstrijd.naam || ''}`;
      const pageTitle = document.getElementById('pageTitle');
      if (pageTitle) pageTitle.textContent = document.title;

      await loadDeelnemers();
      socketSetup();

      // === Excel knop koppelen ===
      const exportBtn = document.getElementById('exportExcelBtn');
      if (exportBtn) exportBtn.onclick = exportAllTablesToExcel;

      if (statusEl) statusEl.textContent = '✅ Live verbonden';
    } catch (e) {
      const container = document.getElementById('tablesContainer');
      if (container) container.innerHTML = `<p>❌ ${escapeHtml(e.message)}</p>`;
      if (statusEl) statusEl.textContent = '⚠️ Wachten op actieve wedstrijd...';
      console.error(e);
    }
  }

  document.addEventListener('DOMContentLoaded', initPage, { once: true });

  window.Uitslagen = {
    calculateScoresNumeric,
    getCorrectedJuryValues,
    normalizeDeelnemer,
    refresh: populateTables,
    loadDeelnemers,
    setWedstrijdSoort: s => { wedstrijdSoort = s; }
  };
})();
