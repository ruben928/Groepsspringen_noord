const socket = io();
socket.on('connect', ()=>console.log('WebSocket verbonden!'));
socket.on('update_status', data=>{ laadWedstrijden(); });

const tbody = document.getElementById('wedstrijdenTableBody');
let wedstrijdenCache = {};

async function laadWedstrijden(){
  try {
    const res = await fetch('/api/wedstrijden');
    const wedstrijden = await res.json();
    tbody.innerHTML = '';
    if(!wedstrijden.length){ tbody.innerHTML='<tr><td colspan="7">Geen wedstrijden</td></tr>'; return; }
    wedstrijden.forEach((w,i)=>{ wedstrijdenCache[w.id]=w; addWedstrijdRow(w,i+1); });
  } catch(e){ tbody.innerHTML='<tr><td colspan="7">Fout laden</td></tr>'; }
}

function addWedstrijdRow(w,nr){
  const tr=document.createElement('tr');
  tr.id=`wedstrijd-row-${w.id}`;
  tr.innerHTML=`
    <td>${nr}</td>
    <td><a href="/wedstrijd/${w.id}" style="color:#4a90e2;text-decoration:underline;">${w.naam}</a></td>
    <td>${w.soort||''}</td>
    <td>${w.dagdeel||''}</td>
    <td>${w.datum||''}</td>
    <td>${w.locatie||''}</td>
    <td><button onclick="verwijderWedstrijd(${w.id})" class="trash-button">🗑</button></td>`;
  tbody.appendChild(tr);
}

async function verwijderWedstrijd(id){
  if(!confirm("Weet je zeker dat je deze wedstrijd wilt verwijderen?")) return;
  const res = await fetch(`/api/wedstrijden/${id}`, {method:'DELETE'});
  if(res.ok){ document.getElementById(`wedstrijd-row-${id}`).remove(); delete wedstrijdenCache[id]; socket.emit('update_status', {id}); }
}

// Modal setup
const modal=document.getElementById('modal');
document.getElementById('maakWedstrijdBtn').onclick=()=>{
  document.getElementById('wedstrijdForm').reset();
  document.getElementById('banenSection').style.display='none';
  document.getElementById('banenContainer').innerHTML='';
  modal.style.display='flex';
};
document.getElementById('cancelBtn').onclick=()=>modal.style.display='none';

// Banen selectie
let isDragging=false;
document.getElementById('soort').addEventListener('change', ()=>{
  const soort=document.getElementById('soort').value;
  const container=document.getElementById('banenContainer');
  container.innerHTML='';
  document.getElementById('banenSection').style.display=soort?'block':'none';
  container.style.gridTemplateColumns=(soort==='microteam')?'repeat(4,1fr)':'repeat(3,1fr)';
  const createBaan=label=>{ const div=document.createElement('div'); div.textContent=label; div.className='baan'; div.addEventListener('mousedown',()=>{ isDragging=true; div.classList.toggle('selected'); }); div.addEventListener('mouseenter',()=>{ if(isDragging) div.classList.toggle('selected'); }); container.appendChild(div); };
  if(soort==='groepsspringen'||soort==='individueel'){ for(let i=1;i<=6;i++) createBaan(`Baan ${i}`); } 
  else if(soort==='microteam'){ [["1A","1B"],["2A","2B"]].forEach(set=>set.forEach(createBaan)); }
});
document.addEventListener('mouseup',()=>{ isDragging=false; });

// Form submit
document.getElementById('wedstrijdForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const titel=document.getElementById('titel').value.trim();
  if(!titel){ alert('Titel verplicht'); return; }
  const banen=Array.from(document.querySelectorAll('#banenContainer .selected')).map(b=>b.textContent);
  const data={ titel, datum:document.getElementById('datum').value, locatie:document.getElementById('locatie').value.trim(), dagdeel:document.getElementById('dagdeel').value, soort:document.getElementById('soort').value, banen };
  const res=await fetch('/api/wedstrijden/aanmaken',{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data) });
  if(res.ok){ const result=await res.json(); addWedstrijdRow(result.wedstrijd,Object.keys(wedstrijdenCache).length+1); wedstrijdenCache[result.wedstrijd.id]=result.wedstrijd; socket.emit('update_status', result.wedstrijd); }
  modal.style.display='none';
});

window.onload=laadWedstrijden;