const wedstrijdenBody = document.getElementById('wedstrijdenBody');

// ✅ Wedstrijden laden
async function laadWedstrijden() {
  try {
    const res = await fetch(`/api/wedstrijden`);
    if (!res.ok) throw new Error(`HTTP error! Status: ${res.status}`);
    const data = await res.json();
    wedstrijdenBody.innerHTML = '';

    data.forEach(w => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${w.id}</td>
        <td>${w.naam}</td>
        <td>${w.datum || '-'}</td>
        <td>${w.dagdeel || '-'}</td>
        <td>${w.actief ? '✅ Actief' : '❌ Inactief'}</td>
        <td>
          ${w.actief 
            ? `<button class="danger" onclick="deactiveerWedstrijd(${w.id})">Deactiveren</button>`
            : `<button onclick="activeerWedstrijd(${w.id})">Activeren</button>`}
        </td>
      `;
      wedstrijdenBody.appendChild(row);
    });
  } catch (err) {
    console.error('Fout bij laden wedstrijden:', err);
    alert('Kon wedstrijden niet laden.');
  }
}

// ✅ Activeer een wedstrijd (andere worden automatisch inactief)
async function activeerWedstrijd(id) {
  try {
    const res = await fetch(`/api/wedstrijden/${id}/activeren`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" }
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`HTTP ${res.status}: ${errText}`);
    }

    const data = await res.json();
    alert(data?.message || 'Wedstrijd geactiveerd');
    await laadWedstrijden();
  } catch (err) {
    console.error('Fout bij activeren:', err);
    alert('Kon wedstrijd niet activeren.');
  }
}

// ✅ Deactiveer een wedstrijd
async function deactiveerWedstrijd(id) {
  try {
    const res = await fetch(`/api/wedstrijden/${id}/deactiveren`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" }
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`HTTP ${res.status}: ${errText}`);
    }

    const data = await res.json();
    alert(data?.message || 'Wedstrijd gedeactiveerd');
    await laadWedstrijden();
  } catch (err) {
    console.error('Fout bij deactiveren:', err);
    alert('Kon wedstrijd niet deactiveren.');
  }
}

// Init
laadWedstrijden();