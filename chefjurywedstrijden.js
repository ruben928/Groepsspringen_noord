const socket = io();
socket.on('connect', ()=>console.log('WebSocket verbonden!'));
socket.on('update_status', ()=>{ laadWedstrijden(); });

const tbody = document.getElementById('wedstrijdenTableBody');
let wedstrijdenCache = {};

async function laadWedstrijden(){
  try {
    const res = await fetch('/api/wedstrijden');
    const wedstrijden = await res.json();
    tbody.innerHTML = '';
    if(!wedstrijden.length){
      tbody.innerHTML='<tr><td colspan="6">Geen wedstrijden</td></tr>';
      return;
    }
    wedstrijden.forEach((w,i)=>{
      wedstrijdenCache[w.id]=w;
      addWedstrijdRow(w,i+1);
    });
  } catch(e){
    tbody.innerHTML='<tr><td colspan="6">Fout laden</td></tr>';
  }
}

function addWedstrijdRow(w,nr){
  const tr=document.createElement('tr');
  tr.id=`wedstrijd-row-${w.id}`;
  tr.innerHTML=`
    <td>${nr}</td>
    <td><a href="/chefjury/wedstrijd/${w.id}" style="color:#4a90e2;text-decoration:underline;">${w.naam}</a></td>
    <td>${w.soort||''}</td>
    <td>${w.dagdeel||''}</td>
    <td>${w.datum||''}</td>
    <td>${w.locatie||''}</td>`;
  tbody.appendChild(tr);
}

window.onload=laadWedstrijden;