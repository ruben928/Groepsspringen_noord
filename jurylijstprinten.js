let socket = null;

async function laadAlleBanen() {
  const overzicht = document.getElementById('overzicht');
  overzicht.innerHTML = '';
  
  try {
    const res = await fetch('/api/actieve_wedstrijden');
    const wedstrijden = await res.json();

    if(!res.ok || !wedstrijden.length) throw new Error('Geen actieve wedstrijden');

    for (const wed of wedstrijden) {
      const res2 = await fetch(`/api/wedstrijden/${wed.id}/alle2_deelnemers`);
      const deelnemers = await res2.json();

      const heeftVereniging = deelnemers.some(d => d.vereniging && d.vereniging.trim() !== '');
      const banen = [...new Set(deelnemers.map(d => d.baan))].sort((a, b) => a - b);

      for (const baan of banen) {
        const deelnemersBaan = deelnemers.filter(d => d.baan == baan);

        const h2 = document.createElement('h2');
        h2.textContent = `Baan ${baan} – ${wed.naam} (${wed.soort || ''})`;
        overzicht.appendChild(h2);

        const table = document.createElement('table');
        const thead = document.createElement('thead');
        thead.innerHTML = `
          <tr>
            <th>Nr</th>
            <th>Naam</th>
            ${heeftVereniging ? '<th>Vereniging</th>' : ''}
            <th>Categorie</th>
            <th>Totaal</th>
            <th>Jury 1</th>
            <th>Jury 2</th>
            <th>Subjury</th>
            <th>Moeilijkheid</th>
            <th>Samenstelling</th>
            <th>Bonus</th>
            <th>Aftrek HJ</th>
            <th>Subscore</th>
          </tr>
        `;
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        if (!deelnemersBaan.length) {
          tbody.innerHTML = '<tr><td colspan="13">Geen deelnemers op deze baan.</td></tr>';
        } else {
          deelnemersBaan.forEach(d => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
              <td>${d.nummer || ''}</td>
              <td>${d.naam || ''}</td>
              ${heeftVereniging ? `<td>${d.vereniging || ''}</td>` : ''}
              <td>${d.categorie || ''}</td>
              <td><input type="text"></td>
              <td><input type="text"></td>
              <td><input type="text"></td>
              <td><input type="text"></td>
              <td><input type="text"></td>
              <td><input type="text"></td>
              <td><input type="text"></td>
              <td><input type="text"></td>
              <td><input type="text"></td>
            `;
            tbody.appendChild(tr);
          });
        }
        table.appendChild(tbody);
        overzicht.appendChild(table);
      }
    }

    document.getElementById('status').textContent = `✅ Overzicht geladen!`;
  } catch (e) {
    console.warn(e);
    document.getElementById('status').textContent = '⚠️ Geen actieve wedstrijden gevonden of fout bij laden.';
  }
}

function setupSocket() {
  socket = io({ withCredentials: true });
  socket.on('connect', () => console.log('✅ Socket.IO verbonden'));
  socket.on('wedstrijd_geactiveerd', () => laadAlleBanen());
  socket.on('wedstrijd_gepauzeerd', () => laadAlleBanen());
}

setupSocket();
laadAlleBanen();
