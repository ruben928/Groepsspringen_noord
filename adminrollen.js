const socket = io();

    socket.on('connect', () => console.log('WebSocket verbonden!'));

    socket.on('status_update', (data) => {
      console.log('Status update ontvangen:', data);
      fetchRoles(); // vernieuw de tabel bij update
    });

    async function fetchRoles() {
      const res = await fetch('/api/roles');
      if (!res.ok) { alert('Fout bij ophalen van rollen'); return; }
      const data = await res.json();
      const tbody = document.querySelector('#rollenTable tbody');
      tbody.innerHTML = '';
      data.roles.forEach(({id, user, role, baan, password}) => {
        const row = document.createElement('tr');
        row.innerHTML = `
          <td><input type="text" value="${user}" data-id="${id}" class="userInput"></td>
          <td><input type="text" value="${role}" data-id="${id}" class="roleInput"></td>
          <td><input type="text" value="${baan || ''}" data-id="${id}" class="baanInput"></td>
          <td><input type="password" value="${password || ''}" data-id="${id}" class="passwordInput"></td>
          <td class="center actions">
            <button onclick="updateRole(${id})">Opslaan</button>
            <button onclick="deleteRole(${id})" style="background-color:#d9534f;">Verwijderen</button>
          </td>
        `;
        tbody.appendChild(row);
      });
    }

    async function updateRole(id) {
      const row = document.querySelector(`[data-id="${id}"]`).closest('tr');
      const user = row.querySelector('.userInput').value.trim();
      const role = row.querySelector('.roleInput').value.trim();
      const baan = row.querySelector('.baanInput').value.trim();
      const password = row.querySelector('.passwordInput').value.trim();
      if (!user || !role || !password || !baan) { alert('Vul alle velden in.'); return; }

      const res = await fetch('/api/roles/' + id, {
        method:'PUT',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({user, role, baan, password})
      });
      if(res.ok){ alert('Rol bijgewerkt!'); socket.emit('update_status', {id,user,role,baan}); fetchRoles(); }
      else alert('Fout bij bijwerken rol');
    }

    async function deleteRole(id) {
      if(!confirm('Weet je zeker dat je deze rol wilt verwijderen?')) return;
      const res = await fetch('/api/roles/' + id, { method:'DELETE' });
      if(res.ok){ alert('Rol verwijderd!'); socket.emit('update_status', {id}); fetchRoles(); }
      else alert('Fout bij verwijderen rol');
    }

    async function addRole() {
      const user = document.getElementById('newUser').value.trim();
      const role = document.getElementById('newRole').value.trim();
      const baan = document.getElementById('newBaan').value.trim();
      if(!user || !role || !baan){ alert('Vul alle velden in.'); return; }
      const password = prompt("Geef een wachtwoord op voor deze gebruiker:");
      if(!password){ alert('Wachtwoord is verplicht.'); return; }

      const res = await fetch('/api/roles', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({user, role, baan, password})
      });
      if(res.ok){ 
        alert('Rol toegevoegd!'); 
        document.getElementById('newUser').value=''; 
        document.getElementById('newRole').value=''; 
        document.getElementById('newBaan').value='';
        socket.emit('update_status', {user, role, baan}); 
        fetchRoles(); 
      }
      else alert('Fout bij toevoegen rol');
    }

    fetchRoles();
