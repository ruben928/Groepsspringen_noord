import os
import csv
import io
import psycopg2
from psycopg2.extras import RealDictCursor
from flask import Flask, request, render_template, redirect, url_for, session, jsonify
from flask_socketio import SocketIO, emit, join_room, leave_room
from decimal import Decimal
from datetime import datetime

# -------------------
# CONFIGURATIE
# -------------------
app = Flask(__name__)
app.secret_key = "supergeheime_veilige_sleutel_die_je_niet_in_je_repo_zet"
socketio = SocketIO(app, cors_allowed_origins="*")

# ===== DATABASE CONFIG =====
DB_HOST = "localhost"
DB_NAME = "groepsspringenfriesland"
DB_USER = "ruben"
DB_PASS = "ruben"
DB_PORT = 5432

def get_db_conn():
    return psycopg2.connect(
        host=DB_HOST, dbname=DB_NAME, user=DB_USER, password=DB_PASS, port=DB_PORT
    )

def to_serializable(obj):
    if isinstance(obj, list):
        return [to_serializable(i) for i in obj]
    elif isinstance(obj, dict):
        return {k: to_serializable(v) for k, v in obj.items()}
    elif isinstance(obj, Decimal):
        return float(obj)
    return obj

@socketio.on('join_wedstrijd')
def join_wedstrijd(data):
    wedstrijd_id = data.get('wedstrijd_id')
    join_room(f"wedstrijd_{wedstrijd_id}")
    emit('joined', {'room': f"wedstrijd_{wedstrijd_id}"})

# ===== INIT DATABASE =====
def init_db():
    conn = get_db_conn()
    cur = conn.cursor()

    # Rollen tabel
    cur.execute("""
        CREATE TABLE IF NOT EXISTS rollen (
            id SERIAL PRIMARY KEY,
            username VARCHAR(50) NOT NULL UNIQUE,
            role VARCHAR(20) NOT NULL,
            password VARCHAR(100) NOT NULL,
            baan INTEGER
        );
    """)
    cur.execute("SELECT COUNT(*) FROM rollen;")
    if cur.fetchone()[0] == 0:
        cur.execute("""
            INSERT INTO rollen (username, role, password, baan)
            VALUES ('admin', 'admin', 'wachtwoord123', NULL);
        """)

    # Wedstrijden
    cur.execute("""
        CREATE TABLE IF NOT EXISTS wedstrijden (
            id SERIAL PRIMARY KEY,
            naam VARCHAR(100) NOT NULL,
            datum DATE,
            dagdeel VARCHAR(50),
            soort VARCHAR(50),
            locatie VARCHAR(100),
            actief BOOLEAN DEFAULT FALSE
        );
    """)

    # Deelnemers
    cur.execute("""
        CREATE TABLE IF NOT EXISTS deelnemers (
            wedstrijd_id INTEGER REFERENCES wedstrijden(id) ON DELETE CASCADE,
            id SERIAL PRIMARY KEY,
            nummer INTEGER NOT NULL,
            naam VARCHAR(100) NOT NULL,
            vereniging VARCHAR(100),
            categorie VARCHAR(50),
            baan INTEGER NOT NULL,
            totaal_score NUMERIC DEFAULT 0,
            jury1 NUMERIC DEFAULT 0,
            jury2 NUMERIC DEFAULT 0,
            subjury VARCHAR(100),
            moeilijkheid NUMERIC DEFAULT 0,
            samenstelling NUMERIC DEFAULT 0,
            bonusHJ NUMERIC DEFAULT 0,
            aftrek_HJ NUMERIC DEFAULT 0,
            subscore NUMERIC DEFAULT 0,
            correctie_status VARCHAR(20) DEFAULT 'geen_verzoek',
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (wedstrijd_id, nummer, baan, naam, vereniging, categorie)

        );
    """)

    conn.commit()
    cur.close()
    conn.close()
    print("✅ Database gecontroleerd (rollen behouden, andere tabellen staan klaar)")

init_db()

# ===== LOGIN =====
@app.route('/', methods=['GET','POST'])
@app.route('/login', methods=['GET','POST'])
def login():
    if request.method=="POST":
        username = request.form.get("username")
        password = request.form.get("password")
        conn = get_db_conn()
        cur = conn.cursor()
        cur.execute("SELECT role, baan FROM rollen WHERE username=%s AND password=%s;", (username, password))
        res = cur.fetchone()
        cur.close()
        conn.close()

        if res:
            role, baan = res
            session["username"] = username
            session["role"] = role
            session["baan"] = baan

            if role == "admin":
                return redirect(url_for("dashboard"))
            elif role == "chefjury":
                return redirect(url_for("chefjury_home"))
            else:
                conn = get_db_conn(); cur = conn.cursor()
                cur.execute("SELECT id FROM wedstrijden WHERE actief=TRUE LIMIT 1;")
                row = cur.fetchone()
                cur.close(); conn.close()
                if not row:
                    return "Geen actieve wedstrijd", 400
                wedstrijd_id = row[0]
                return render_template("invoer.html", w_id=wedstrijd_id, baan=baan)
        else:
            return render_template("index.html", error="Ongeldige gebruikersnaam of wachtwoord")
    return render_template("index.html")

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('login'))

# ===== NAV LINKS =====


# ===== ADMIN PAGES =====
@app.route('/dashboard')
def dashboard():
    if session.get("role") != "admin":
        return redirect(url_for('login'))

    conn = get_db_conn()
    cur = conn.cursor()
    cur.execute("SELECT id, naam FROM wedstrijden WHERE actief=TRUE LIMIT 1;")
    row = cur.fetchone()
    cur.close()
    conn.close()

    mijn_wedstrijd = {"id": row[0], "naam": row[1]} if row else None

    return render_template(
        "dashboard.html",
        nav_links=get_nav_links(),
        username=session.get("username"),
        mijn_wedstrijd=mijn_wedstrijd
    )

@app.route('/admin/rollen')
def admin_rollen():
    if session.get("role") != "admin": return redirect(url_for('login'))
    return render_template("rollen.html", nav_links=get_nav_links())

@app.route('/admin/wedstrijden')
def admin_wedstrijden():
    if session.get("role") not in ["admin", "chefjury"]:
        return redirect(url_for('login'))
    return render_template("wedstrijden.html", nav_links=get_nav_links())

@app.route('/chefjury/wedstrijden')
def chefjury_wedstrijden():
    if session.get("role") not in ["admin", "chefjury"]:
        return redirect(url_for('login'))
    return render_template("chefjurywedstrijden.html", nav_links=get_nav_links())

@app.route('/admin/activeren')
def admin_activeren():
    if session.get("role") != "admin": return redirect(url_for('login'))
    return render_template("activeren.html", nav_links=get_nav_links())

@app.route('/wedstrijd/<int:w_id>')
def wedstrijd_detail(w_id):
    if session.get("role") not in ["admin","chefjury"]: return redirect(url_for('login'))
    return render_template("detail.html", nav_links=get_nav_links(), wedstrijd_id=w_id)

def get_nav_links():
    role = session.get("role")

    if role == "chefjury":
        return [
            {"name": "Home", "url": "/chefjury"},
            {"name": "Wedstrijden", "url": "/chefjury/wedstrijden"},
            {"name": "Uitloggen", "url": "/logout"}
        ]
    elif role == "admin":
        return [
            {"name": "Dashboard", "url": "/dashboard"},
            {"name": "Wedstrijden", "url": "/admin/wedstrijden"},
            {"name": "Gebruikers", "url": "/admin/rollen"},
            {"name": "Uitloggen", "url": "/logout"}
        ]
    else:
        return [
            {"name": "Home", "url": "/"},
            {"name": "Uitloggen", "url": "/logout"}
        ]


@app.route('/chefjury/wedstrijd/<int:w_id>')
def chefjury_chefjurycontrole(w_id):
    if session.get("role") != "chefjury":
        return redirect(url_for('login'))
    return render_template(
        "chefjurycontrole.html",
        nav_links=get_nav_links(),
        wedstrijd_id=w_id
    )

@app.route('/uitslagen')
def uitslagen_auto():
    conn = get_db_conn()
    cur = conn.cursor()
    cur.execute("SELECT id, naam, datum, dagdeel, soort, locatie FROM wedstrijden WHERE actief=TRUE LIMIT 1;")
    row = cur.fetchone()
    cur.close()
    conn.close()

    if not row:
        return render_template("uitslagen.html", wedstrijd=None)

    wedstrijd = {
        "id": row[0],
        "naam": row[1],
        "datum": str(row[2]),
        "dagdeel": row[3],
        "soort": row[4],
        "locatie": row[5]
    }

    return render_template("uitslagen.html", wedstrijd=wedstrijd)

@app.route("/live_scores")
def live_scores():
    return render_template("live_scores.html")

@app.route('/printen')
def Juryblaadjes_printen():
    if session.get("role") not in ("admin", "chefjury"):
        return redirect(url_for("login"))
    return render_template("printjury.html", username=session.get("username"))


# ===== CHEFJURY PAGES =====
@app.route('/chefjury')
def chefjury_home():
    if session.get("role") != "chefjury":
        return redirect(url_for("login"))
    return render_template("chefjury_home.html", username=session.get("username"))

# ===== API: Rollen =====
@app.route('/api/roles', methods=['GET'])
def api_get_roles():
    conn = get_db_conn(); cur = conn.cursor()
    cur.execute("SELECT id, username, role, password, baan FROM rollen ORDER BY id;")
    rollen = [{"id": r[0], "user": r[1], "role": r[2], "password": r[3], "baan": r[4]} for r in cur.fetchall()]
    cur.close(); conn.close()
    return jsonify({"roles": rollen})

@app.route('/api/roles', methods=['POST'])
def api_add_role():
    data = request.json
    conn = get_db_conn(); cur = conn.cursor()
    cur.execute("INSERT INTO rollen (username, role, password, baan) VALUES (%s,%s,%s,%s) RETURNING id;",
                (data["user"], data["role"], data["password"], data.get("baan")))
    r_id = cur.fetchone()[0]; conn.commit(); cur.close(); conn.close()
    socketio.emit("update_status", {"id": r_id, "user": data["user"], "role": data["role"], "baan": data.get("baan")})
    return jsonify({"id": r_id, "user": data["user"], "role": data["role"], "password": data["password"], "baan": data.get("baan")})

@app.route('/api/roles/<int:r_id>', methods=['PUT'])
def api_update_role(r_id):
    data = request.json
    conn = get_db_conn(); cur = conn.cursor()
    cur.execute("UPDATE rollen SET username=%s, role=%s, password=%s, baan=%s WHERE id=%s;",
                (data["user"], data["role"], data["password"], data.get("baan"), r_id))
    conn.commit(); cur.close(); conn.close()
    socketio.emit("update_status", {"id": r_id, "user": data["user"], "role": data["role"], "baan": data.get("baan")})
    return "", 204

@app.route('/api/roles/<int:r_id>', methods=['DELETE'])
def api_delete_role(r_id):
    conn = get_db_conn(); cur = conn.cursor()
    cur.execute("DELETE FROM rollen WHERE id=%s;", (r_id,))
    conn.commit(); cur.close(); conn.close()
    socketio.emit("update_status", {"id": r_id})
    return "", 204

# ===== API: Wedstrijden =====
@app.route('/api/wedstrijden', methods=['GET'])
def api_get_wedstrijden():
    conn = get_db_conn(); cur = conn.cursor()
    cur.execute("SELECT id, naam, datum, dagdeel, soort, locatie, actief FROM wedstrijden ORDER BY id;")
    data = [{"id": w[0],"naam":w[1],"datum":w[2],"dagdeel":w[3],"soort":w[4],"locatie":w[5],"actief":w[6]} for w in cur.fetchall()]
    cur.close(); conn.close()
    return jsonify(data)

@app.route('/api/wedstrijden/aanmaken', methods=['POST'])
def api_wedstrijd_aanmaken():
    data = request.json
    conn = get_db_conn(); cur = conn.cursor()
    cur.execute("INSERT INTO wedstrijden (naam, datum, dagdeel, soort, locatie) VALUES (%s,%s,%s,%s,%s) RETURNING id;",
                (data.get("titel"), data.get("datum"), data.get("dagdeel"), data.get("soort"), data.get("locatie")))
    w_id = cur.fetchone()[0]; conn.commit(); cur.close(); conn.close()
    return jsonify({"wedstrijd": {**data, "id": w_id}})

@app.route('/api/wedstrijden/<int:w_id>', methods=['DELETE'])
def api_wedstrijd_verwijderen(w_id):
    conn = get_db_conn(); cur = conn.cursor()
    cur.execute("DELETE FROM wedstrijden WHERE id=%s;", (w_id,))
    conn.commit(); cur.close(); conn.close()
    return "", 204

@app.route('/api/wedstrijden/<int:w_id>/activeren', methods=['PATCH'])
def api_wedstrijd_activeren(w_id):
    conn = get_db_conn(); cur = conn.cursor()
    cur.execute("UPDATE wedstrijden SET actief=FALSE;")
    cur.execute("UPDATE wedstrijden SET actief=TRUE WHERE id=%s;", (w_id,))
    conn.commit(); cur.close(); conn.close()
    socketio.emit("wedstrijd_geactiveerd", {"wedstrijd_id": w_id})
    return jsonify({"message": "Wedstrijd geactiveerd"})

@app.route('/api/wedstrijden/<int:w_id>/deactiveren', methods=['PATCH'])
def api_wedstrijd_deactiveren(w_id):
    conn = get_db_conn(); cur = conn.cursor()
    cur.execute("UPDATE wedstrijden SET actief=FALSE WHERE id=%s;", (w_id,))
    conn.commit(); cur.close(); conn.close()
    socketio.emit("status_update", {"wedstrijd_id": w_id, "actief": False})
    return jsonify({"message": "Wedstrijd gedeactiveerd"})

# ===== API: Live Scores =====
@app.route("/api/live_scores", methods=["GET"])
def api_live_scores():
    conn = get_db_conn()
    cur = conn.cursor()
    cur.execute("SELECT id, naam, locatie FROM wedstrijden WHERE actief=TRUE LIMIT 1;")
    wedstrijd = cur.fetchone()
    if not wedstrijd:
        return jsonify({"error": "Geen actieve wedstrijd"}), 404
    wedstrijd_id, wedstrijd_naam, locatie = wedstrijd
    cur.execute("""
        SELECT DISTINCT ON (baan)
            baan,
            nummer,
            naam,
            vereniging,
            categorie,
            COALESCE(moeilijkheid, 0) AS moeilijkheid,
            COALESCE(samenstelling, 0) AS samenstelling,
            COALESCE(bonushj, 0) AS bonusHJ,
            COALESCE(aftrek_hj, 0) AS aftrek_HJ,
            COALESCE(subscore, 0) AS subscore,
            updated_at AS timestamp
        FROM deelnemers
        WHERE wedstrijd_id = %s
        ORDER BY baan, updated_at DESC;
    """, (wedstrijd_id,))
    rows = cur.fetchall()
    cur.close()
    conn.close()
    banen = [
        {
            "baan": r[0],
            "nummer": r[1],
            "naam": r[2],
            "vereniging": r[3],
            "categorie": r[4],
            "moeilijkheid": float(r[5]),
            "samenstelling": float(r[6]),
            "bonusHJ": float(r[7]),
            "aftrek_HJ": float(r[8]),
            "subscore": float(r[9]),
            "timestamp": str(r[10])
        }
        for r in rows
    ]
    return jsonify({
        "wedstrijd": {
            "id": wedstrijd_id,
            "naam": wedstrijd_naam,
            "locatie": locatie
        },
        "banen": banen
    })







# ===== API: Opslaan Resultaat =====
@app.route('/api/wedstrijden/<int:w_id>/resultaten', methods=['POST'])
def api_sla_resultaat_op(w_id):
    try:
        data = request.get_json()
        nummer = data.get("nummer")
        if nummer is None:
            return jsonify({"error": "Nummer ontbreekt"}), 400

        baan = data.get("baan") or session.get("baan")
        if baan is None:
            return jsonify({"error": "Baan ontbreekt"}), 400
        
        categorie = data.get("categorie", "")   
        jury1 = float(data.get("jury1", 0))
        jury2 = float(data.get("jury2", 0))
        moeilijkheid = float(data.get("moeilijkheid", 0))
        samenstelling = float(data.get("samenstelling", 0))
        bonus = float(data.get("bonus", 0))
        aftrek_HJ = float(data.get("aftrek_HJ", 0))  # nieuw toegevoegd

        subjury = (jury1 + jury2) / 2
        subscore = moeilijkheid + samenstelling + bonus - aftrek_HJ
        totaal_score = subjury + subscore

        conn = get_db_conn()
        cur = conn.cursor()
        cur.execute("""
            UPDATE deelnemers
            SET jury1=%s, jury2=%s, moeilijkheid=%s, samenstelling=%s, bonusHJ=%s,
                aftrek_HJ=%s,
                subjury=%s, subscore=%s, totaal_score=%s,
                updated_at=NOW(),
                correctie_status='geen_verzoek'
            WHERE wedstrijd_id=%s AND nummer=%s AND baan=%s
            RETURNING id, naam, vereniging, categorie;
        """, (
            jury1, jury2, moeilijkheid, samenstelling, bonus,
            aftrek_HJ,
            subjury, subscore, totaal_score,
            w_id, nummer, baan
        ))

        deelnemer = cur.fetchone()
        conn.commit()
        cur.close()
        conn.close()

        if not deelnemer:
            return jsonify({"error": "Deelnemer niet gevonden"}), 404

        deelnemer_id, naam, vereniging, categorie = deelnemer

        # Emit realtime naar alle clients
        score_data = {
            "wedstrijd_id": w_id,
            "nummer": nummer,
            "baan": baan,
            "jury1": jury1,
            "jury2": jury2,
            "moeilijkheid": moeilijkheid,
            "samenstelling": samenstelling,
            "bonus": bonus,
            "aftrek_HJ": aftrek_HJ,
            "subjury": round(subjury, 2),
            "subscore": round(subscore, 2),
            "totaal_score": round(totaal_score, 2),
            "correctie_status": "geen_verzoek",
            "naam": naam,
            "vereniging": vereniging,
            "categorie": categorie
        }
        print(f"🚀 Sending score_update: {score_data}")
        socketio.emit("score_update", score_data, namespace="/")

        return jsonify({"message": "Resultaat opgeslagen"})

    except Exception as e:
        app.logger.error(f"Fout bij opslaan resultaat: {e}")
        return jsonify({"error": "Interne serverfout"}), 500





# ===== API: Correctie Verzoek =====
@app.route('/api/wedstrijden/<int:w_id>/correctie_status', methods=['PUT'])
def api_update_correctie_status(w_id):
    data = request.json
    nummer = data.get("nummer")
    baan = data.get("baan")
    nieuwe_status = data.get("correctie_status")

    if not nummer or not baan or nieuwe_status is None:
        return jsonify({"error": "Vereiste velden ontbreken"}), 400

    try:
        conn = get_db_conn()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        # 1️⃣ Status aanpassen
        cur.execute("""
            UPDATE deelnemers
            SET correctie_status = %s
            WHERE wedstrijd_id = %s AND nummer = %s AND baan = %s
            RETURNING *;
        """, (nieuwe_status, w_id, nummer, baan))
        deelnemer = cur.fetchone()

        conn.commit()

        if not deelnemer:
            cur.close(); conn.close()
            return jsonify({"error": "Deelnemer niet gevonden"}), 404

        # 2️⃣ Converteer Decimal → float
        deelnemer = to_serializable(deelnemer)
        if "updated_at" in deelnemer and isinstance(deelnemer["updated_at"], datetime):
                deelnemer["updated_at"] = deelnemer["updated_at"].isoformat()


        # 3️⃣ Zorg dat veldnaam consistent is
        if "bonushj" in deelnemer and "bonusHJ" not in deelnemer:
            deelnemer["bonusHJ"] = deelnemer["bonushj"]

        # 4️⃣ Emit volledig deelnemerobject (inclusief scores)
        socketio.emit("status_update", deelnemer, room=f"wedstrijd_{w_id}")

        cur.close()
        conn.close()

        return jsonify({
            "message": f"Correctie-status van deelnemer {nummer} bijgewerkt",
            "deelnemer": deelnemer
        })

    except Exception as e:
        print(f"❌ Fout bij api_update_correctie_status: {e}")
        return jsonify({"error": str(e)}), 500



# ===== API: Deelnemers & Scores =====
@app.route('/api/wedstrijden/<int:w_id>/alle2_deelnemers', methods=['GET'])
def api_alle2_deelnemers(w_id):
    conn = get_db_conn()
    cur = conn.cursor()
    cur.execute("""
    SELECT id, naam, nummer, vereniging, categorie, jury1, jury2,
           moeilijkheid, samenstelling, bonusHJ, aftrek_HJ, baan, correctie_status
    FROM deelnemers
    WHERE wedstrijd_id = %s
    ORDER BY id
    ;
    """, (w_id,))

    deelnemers = [
        {
            "id": d[0],
            "naam": d[1],
            "nummer": d[2],
            "vereniging": d[3],
            "categorie": d[4],
            "jury1": float(d[5]),
            "jury2": float(d[6]),
            "moeilijkheid": float(d[7]),
            "samenstelling": float(d[8]),
            "bonusHJ": float(d[9]),
            "aftrek_HJ": float(d[10]),
            "baan": d[11],
            "correctie_status": d[12] or "geen_verzoek"
        }
        for d in cur.fetchall()
    ]
    cur.close(); conn.close()
    return jsonify(deelnemers)




@app.route('/api/wedstrijden/<int:w_id>/update_deelnemer', methods=['PUT'])
def update_deelnemer(w_id):
    try:
        data = request.json

        nummer = data.get("nummer")
        baan = data.get("baan")
        jury1 = float(data.get("jury1", 0))
        jury2 = float(data.get("jury2", 0))
        moeilijkheid = float(data.get("moeilijkheid", 0))
        samenstelling = float(data.get("samenstelling", 0))
        bonusHJ = float(data.get("bonusHJ", 0))
        categorie = data.get("categorie", "")
        correctie_status = data.get("correctie_status", "geen_verzoek")

        # Bereken scores
        subjury = (jury1 + jury2) / 2
        subscore = moeilijkheid + samenstelling + bonusHJ
        totaal_score = subjury + subscore

        conn = get_db_conn()
        cur = conn.cursor()
        cur.execute("""
    UPDATE deelnemers
    SET jury1=%s, jury2=%s, moeilijkheid=%s, samenstelling=%s, bonusHJ=%s,
        subjury=%s, subscore=%s, totaal_score=%s,
        correctie_status=%s
    WHERE wedstrijd_id=%s AND nummer=%s AND baan=%s
    RETURNING id, naam, vereniging, categorie;
""", (
    jury1, jury2, moeilijkheid, samenstelling, bonusHJ,
    subjury, subscore, totaal_score,
    correctie_status,
    w_id, nummer, baan
))


        deelnemer = cur.fetchone()
        conn.commit()
        cur.close()
        conn.close()

        if not deelnemer:
            return jsonify({"error": "Deelnemer niet gevonden"}), 404

        deelnemer_id, naam, vereniging, categorie_db = deelnemer

        payload = {
            "wedstrijd_id": w_id,
            "nummer": nummer,
            "baan": baan,
            "jury1": jury1,
            "jury2": jury2,
            "moeilijkheid": moeilijkheid,
            "samenstelling": samenstelling,
            "bonusHJ": bonusHJ,
            "subjury": round(subjury, 2),
            "subscore": round(subscore, 2),
            "totaal_score": round(totaal_score, 2),
            "categorie": categorie_db,
            "naam": naam,
            "vereniging": vereniging,
            "correctie_status": correctie_status
        }

        # Emit realtime naar alle clients
        print(f"🚀 Sending score_update (update_deelnemer): {payload}")
        socketio.emit("score_update", payload, namespace="/")

        return jsonify({"message": f"Scores van deelnemer {nummer} bijgewerkt", "deelnemer": payload})

    except Exception as e:
        print(data)
        return jsonify({"error": str(e)}), 500









# ===== API: Upload CSV =====
@app.route('/api/wedstrijden/<int:w_id>/upload_csv', methods=['POST'])
def api_upload_csv(w_id):
    if "file" not in request.files:
        return jsonify({"error": "Geen bestand ontvangen"}), 400

    file = request.files["file"]
    try:
        text = file.stream.read().decode("utf-8-sig")
    except Exception as e:
        return jsonify({"error": f"Kon bestand niet lezen: {str(e)}"}), 400

    import csv, io
    sniffer = csv.Sniffer()
    sample = text[:4096]

    try:
        dialect = sniffer.sniff(sample, delimiters=[",", ";", "\t"])
        delimiter = dialect.delimiter
    except Exception:
        delimiter = ","

    stream = io.StringIO(text, newline=None)
    reader = csv.DictReader(stream, delimiter=delimiter)

    if not reader.fieldnames:
        return jsonify({"error": "CSV bevat geen headers"}), 400

    headers = [h.strip().lower() for h in reader.fieldnames]
    required = {"naam", "categorie", "baan", "nummer"}
    missing = required - set(headers)

    if missing:
        return jsonify({
            "error": f"CSV mist verplichte kolommen: {', '.join(missing)}",
            "gevonden_headers": headers
        }), 400

    conn = get_db_conn()
    cur = conn.cursor()
    inserted, skipped = 0, 0
    debug = []

    for i, row in enumerate(reader, start=2):
        naam = (row.get("naam") or "").strip()
        categorie = (row.get("categorie") or "").strip()
        baan_str = (row.get("baan") or "").strip()
        nummer_str = (row.get("nummer") or "").strip()
        vereniging = (row.get("vereniging") or "").strip() if "vereniging" in row else ""

        # ❗ baan_str mag ALLES zijn: 1, 1A, 2B, ...
        if not (naam and categorie and baan_str and nummer_str):
            skipped += 1
            debug.append(f"Rij {i}: Ongeldige waarden → naam='{naam}', categorie='{categorie}', baan='{baan_str}', nummer='{nummer_str}'")
            continue

        # nummer blijft numeriek
        try:
            nummer = int(float(nummer_str))
        except:
            skipped += 1
            debug.append(f"Rij {i}: Kon nummer niet converteren → nummer='{nummer_str}'")
            continue

        # ❗ Baan NIET omzetten naar int
        baan = baan_str  # gewoon als tekst opslaan

        # Duplicate-check werkt nog steeds perfect
        cur.execute("""
            SELECT 1 FROM deelnemers
            WHERE wedstrijd_id=%s
              AND nummer=%s
              AND baan=%s
              AND naam=%s
              AND vereniging=%s
              AND categorie=%s;
        """, (w_id, nummer, baan, naam, vereniging, categorie))

        if cur.fetchone():
            skipped += 1
            msg = f"Rij {i}: Exact duplicate → nummer={nummer}, baan='{baan}', naam='{naam}', categorie='{categorie}', vereniging='{vereniging}'"
            debug.append(msg)
            print(msg)
            continue

        cur.execute("""
            INSERT INTO deelnemers
            (wedstrijd_id, naam, nummer, vereniging, categorie, baan)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id;
        """, (w_id, naam, nummer, vereniging, categorie, baan))

        cur.fetchone()
        inserted += 1

    conn.commit()
    cur.close()
    conn.close()

    return jsonify({
        "inserted": inserted,
        "skipped": skipped,
        "debug": debug[:200]
    })





# ===== API: Mijn Wedstrijd =====
@app.route('/api/mijn_wedstrijd', methods=['GET'])
def api_mijn_wedstrijd():
    conn = get_db_conn(); cur = conn.cursor()
    cur.execute("SELECT id, naam, datum, dagdeel, soort, locatie FROM wedstrijden WHERE actief=TRUE LIMIT 1;")
    row = cur.fetchone()
    cur.close(); conn.close()

    if not row:
        return jsonify({"error": "Geen actieve wedstrijd gevonden"}), 404

    return jsonify({
        "id": row[0],
        "naam": row[1],
        "datum": str(row[2]),
        "dagdeel": row[3],
        "soort": row[4],
        "locatie": row[5],
        "baan": session.get("baan")
    })
    
    
    
# ===== UITSLAGEN PAGINA =====





# ===== API: Deelnemer Score Bijwerken =====

@app.route('/api/wedstrijden/<int:w_id>/deelnemer_score', methods=['PUT'])
def deelnemer_score_bijwerken(w_id):
    try:
        data = request.get_json()
        nummer = data.get("nummer")
        if nummer is None:
            return jsonify({"error": "Nummer ontbreekt"}), 400

        baan = data.get("baan") or session.get("baan")
        if baan is None:
            return jsonify({"error": "Baan ontbreekt"}), 400

        jury1 = float(data.get("jury1", 0))
        jury2 = float(data.get("jury2", 0))
        moeilijkheid = float(data.get("moeilijkheid", 0))
        samenstelling = float(data.get("samenstelling", 0))
        bonusHJ = float(data.get("bonusHJ", 0))
        aftrek_HJ = float(data.get("aftrek_HJ", 0))  # Toegevoegd

        subjury = (jury1 + jury2) / 2
        subscore = moeilijkheid + samenstelling + bonusHJ - aftrek_HJ
        totaal_score = subjury + subscore

        conn = get_db_conn()
        cur = conn.cursor()
        cur.execute("""
            UPDATE deelnemers
            SET jury1=%s, jury2=%s, moeilijkheid=%s, samenstelling=%s, bonusHJ=%s, aftrek_HJ=%s,
                subjury=%s, subscore=%s, totaal_score=%s,
                correctie_status='geen_verzoek',
                updated_at=NOW()
            WHERE wedstrijd_id=%s AND nummer=%s AND baan=%s
            RETURNING id, naam, vereniging, categorie, updated_at;
        """, (
            jury1, jury2, moeilijkheid, samenstelling, bonusHJ, aftrek_HJ,
            subjury, subscore, totaal_score,
            w_id, nummer, baan
        ))

        deelnemer = cur.fetchone()
        conn.commit()
        cur.close()
        conn.close()

        if not deelnemer:
            return jsonify({"error": "Deelnemer niet gevonden"}), 404

        deelnemer_id, naam, vereniging, categorie, updated_at = deelnemer

        score_data = {
            "wedstrijd_id": w_id,
            "nummer": nummer,
            "baan": baan,
            "jury1": jury1,
            "jury2": jury2,
            "moeilijkheid": moeilijkheid,
            "samenstelling": samenstelling,
            "bonusHJ": bonusHJ,
            "aftrek_HJ": aftrek_HJ,
            "subjury": round(subjury, 2),
            "subscore": round(subscore, 2),
            "totaal_score": round(totaal_score, 2),
            "correctie_status": "geen_verzoek",
            "naam": naam,
            "vereniging": vereniging,
            "categorie": categorie,
            "updated_at": updated_at.isoformat()
        }
        print(f"🚀 Sending invoer score_update: {score_data}")
        socketio.emit("score_update", score_data, namespace="/")

        return jsonify({"message": "Resultaat opgeslagen"})
    except Exception as e:
        app.logger.error(f"Fout bij deelnemer_score_bijwerken: {e}")
        return jsonify({"error": "Interne serverfout"}), 500










@app.route("/api/wedstrijden/<int:wedstrijd_id>/deelnemer_categorie", methods=["PUT"])
def deelnemer_categorie_bijwerken(wedstrijd_id):
    try:
        data = request.get_json()
        nummer = data.get("nummer")
        baan = data.get("baan")
        categorie = data.get("categorie")

        if nummer is None or baan is None or not categorie:
            return jsonify({"error": "nummer, baan en categorie zijn vereist"}), 400

        conn = get_db_conn()
        cur = conn.cursor(cursor_factory=RealDictCursor)

        cur.execute("""
            UPDATE deelnemers
            SET categorie = %s
            WHERE wedstrijd_id = %s AND nummer = %s AND baan = %s
            RETURNING *;
        """, (categorie, wedstrijd_id, nummer, baan))

        deelnemer = cur.fetchone()
        conn.commit()
        cur.close()
        conn.close()

        if not deelnemer:
            return jsonify({"error": "Deelnemer niet gevonden"}), 404

        deelnemer = to_serializable(deelnemer)

        # Converteer datetime velden naar string voor JSON serialisatie
        if "updated_at" in deelnemer and isinstance(deelnemer["updated_at"], datetime):
            deelnemer["updated_at"] = deelnemer["updated_at"].isoformat()

        socketio.emit("categorie_update", deelnemer, room=f"wedstrijd_{wedstrijd_id}")

        return jsonify({"deelnemer": deelnemer}), 200

    except Exception as e:
        print(f"❌ Fout bij deelnemer_categorie_bijwerken: {e}")
        return jsonify({"error": str(e)}), 500


# ===== API: Deelnemer verwijderen =====
@app.route('/api/wedstrijden/<int:w_id>/deelnemer', methods=['DELETE'])
def api_delete_deelnemer(w_id):
    """
    Verwijdert een deelnemer op basis van wedstrijd_id, baan en nummer.
    Verwacht JSON-body: {"nummer": 3, "baan": 1}
    """
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "Geen JSON ontvangen"}), 400

        nummer = data.get("nummer")
        baan = data.get("baan")

        if nummer is None or baan is None:
            return jsonify({"error": "Nummer en baan zijn vereist"}), 400

        conn = get_db_conn()
        cur = conn.cursor()

        # Controleer of deelnemer bestaat
        cur.execute("""
            SELECT id, naam FROM deelnemers
            WHERE wedstrijd_id = %s AND baan = %s AND nummer = %s;
        """, (w_id, baan, nummer))
        deelnemer = cur.fetchone()

        if not deelnemer:
            cur.close()
            conn.close()
            return jsonify({"error": "Deelnemer niet gevonden"}), 404

        deelnemer_id, naam = deelnemer

        # --- Verwijder deelnemer uit DB ---
        cur.execute("""
            DELETE FROM deelnemers
            WHERE wedstrijd_id = %s AND baan = %s AND nummer = %s;
        """, (w_id, baan, nummer))
        conn.commit()
        cur.close()
        conn.close()

        # --- Logging + Socket update ---
        print(f"🗑️ Verwijder deelnemer {naam} (wedstrijd {w_id}, baan {baan}, nummer {nummer})")

        verwijder_data = {
            "wedstrijd_id": w_id,
            "baan": baan,
            "nummer": nummer,
            "naam": naam
        }

        print(f"🚀 Sending verwijder deelnemer event: {verwijder_data}")
        socketio.emit(
            "deelnemer_verwijderd",
            verwijder_data,
            namespace="/",
            room=f"wedstrijd_{w_id}"
        )

        return jsonify({
            "status": "ok",
            "bericht": f"Deelnemer '{naam}' (nr {nummer}, baan {baan}) is verwijderd."
        }), 200

    except Exception as e:
        app.logger.error(f"❌ Fout bij verwijderen deelnemer: {e}")
        return jsonify({"error": str(e)}), 500


@app.route('/api/moeilijkheid_groep/max_score')
def max_score_groep():
    categorie = (request.args.get("categorie") or request.args.get("category") or "").strip().strip('"')
    if not categorie:
        return jsonify({"error": "Categorie ontbreekt"}), 400

    try:
        conn = get_db_conn()
        cur = conn.cursor()

        cur.execute("SELECT max_score FROM moeilijkheid_groep WHERE category = %s;", (categorie,))
        result = cur.fetchone()

        cur.close()
        conn.close()

        if not result:
            return jsonify({"error": f"Categorie '{categorie}' niet gevonden"}), 404

        return jsonify({"max_score": result[0]})

    except Exception as e:
        return jsonify({"error": str(e)}), 500







# ===== API: Actieve Wedstrijden =====
@app.route('/api/actieve_wedstrijden', methods=['GET'])
def api_actieve_wedstrijden():
    """
    Geeft alle actieve wedstrijden terug in de originele databasevolgorde.
    """
    conn = get_db_conn()
    cur = conn.cursor()
    cur.execute("""
        SELECT id, naam, datum, dagdeel, soort, locatie
        FROM wedstrijden
        WHERE actief = TRUE
        ORDER BY id;  -- id komt overeen met invoegvolgorde
    """)
    wedstrijden = [
        {
            "id": r[0],
            "naam": r[1],
            "datum": str(r[2]) if r[2] else None,
            "dagdeel": r[3],
            "soort": r[4],
            "locatie": r[5]
        }
        for r in cur.fetchall()
    ]
    cur.close()
    conn.close()
    return jsonify(wedstrijden)


# ===== API: Deelnemers per wedstrijd, in originele databasevolgorde per baan =====
@app.route('/api/wedstrijden/<int:w_id>/alle2_deelnemers', methods=['GET'])
def api_wedstrijd_deelnemers_alle2(w_id):
    """
    Geeft alle deelnemers van een wedstrijd terug, gegroepeerd per baan
    en in de originele volgorde zoals ze in de database staan (dus géén ORDER BY nummer).
    """
    conn = get_db_conn()
    cur = conn.cursor()
    cur.execute("""
        SELECT id, naam, nummer, vereniging, categorie, baan
        FROM deelnemers
        WHERE wedstrijd_id = %s
        ORDER BY baan, ;  -- volgorde per baan volgens invoer
    """, (w_id,))

    deelnemers = cur.fetchall()
    cur.close()
    conn.close()

    # Groepeer deelnemers per baan
    banen_dict = {}
    for d in deelnemers:
        baan = d[5]
        if baan not in banen_dict:
            banen_dict[baan] = []
        banen_dict[baan].append({
            "id": d[0],
            "naam": d[1],
            "nummer": d[2],
            "vereniging": d[3],
            "categorie": d[4],
            "baan": d[5]
        })

    # Zet de banen in oplopende volgorde (1, 2, 3, ...)
    banen_lijst = []
    for baan in sorted(banen_dict.keys()):
        banen_lijst.append({
            "baan": baan,
            "deelnemers": banen_dict[baan]
        })

    return jsonify(banen_lijst)




@app.route("/admin/shutdown", methods=["POST"])
def shutdown_server():
    if session.get("role") != "admin":
        return "Niet toegestaan", 403

    # Stuur eerst antwoord terug
    def shutdown():
        import os
        os._exit(0)

    from threading import Timer
    Timer(1, shutdown).start()

    return "Server wordt afgesloten..."














# ===== WEBSOCKET EVENTS =====

# Houd bij welke juryleden ingelogd zijn
ingelogde_juryleden = set()

@socketio.on('connect')
def ws_connect():
    username = session.get("username", "onbekend")
    print(f"✅ {username} verbonden via WebSocket")
    emit('message', {'msg': f'Welkom {username}!'}, broadcast=False)


@socketio.on('disconnect')
def handle_disconnect():
    username = session.get("username")
    if username in [j for j, _ in ingelogde_juryleden]:
        ingelogde_juryleden.remove((username, None))
        emit("jury_uitgelogd", {"username": username}, broadcast=True)
    print(f"❌ {username} is disconnected")


@socketio.on('send_message')
def ws_message(data):
    emit('message', {'msg': data['msg']}, broadcast=True)


@socketio.on("new_deelnemer")
def handle_new_deelnemer(data):
    emit("new_deelnemer", data, broadcast=True)


@socketio.on('join_wedstrijd')
def join_wedstrijd(data):
    wedstrijd_id = data.get("wedstrijd_id")
    username = session.get("username", "onbekend")
    role = session.get("role", "onbekend")
    baan = session.get("baan")  

    if not wedstrijd_id:
        print(f"⚠️ {username} probeerde te joinen zonder wedstrijd_id")
        return

    room_name = f"wedstrijd_{wedstrijd_id}"
    join_room(room_name)
    print(f"✅ {username} ({role}) joined room {room_name} (baan={baan})")

    if role.startswith("hoofdjury"):
        ingelogde_juryleden.add((username, baan))
        emit("jury_ingelogd", {"username": username, "baan": baan}, broadcast=True)

    if role == "chefjury":
        print(f"👩‍🍳 {username} ontvangt huidige juryleden: {ingelogde_juryleden}")
        for j, b in ingelogde_juryleden:
            emit("jury_ingelogd", {"username": j, "baan": b})

    if role == "admin":
        for j, b in ingelogde_juryleden:
            emit("jury_ingelogd", {"username": j, "baan": b})


# --- Chefjury acties ---
@socketio.on('chef_join')
def chef_join(data):
    username = session.get('username', 'onbekend')
    print(f"👩‍🍳 Chef {username} verbonden")


@socketio.on('pauzeer_dia_loop')
def pauzeer_dia_loop(data):
    wedstrijd_id = data.get('wedstrijd_id')
    room = f"wedstrijd_{wedstrijd_id}"
    print(f"🛑 Chef pauzeer dia-loop in room {room}")
    emit('pauze_dia', room=room)




@socketio.on('resume_dia_loop')
def resume_dia_loop(data):
    wedstrijd_id = data.get('wedstrijd_id')
    room = f"wedstrijd_{wedstrijd_id}"
    print(f"▶️ Chef hervat dia-loop in room {room}")

    emit('resume_dia', {
        'reden': 'na_pauze',
        'timestamp': datetime.now().isoformat()
    }, room=room)

   




@socketio.on('toon_info_dia')
def toon_info_dia(data):
    wedstrijd_id = data.get('wedstrijd_id')
    bericht = data.get('bericht', '')
    room = f"wedstrijd_{wedstrijd_id}"
    print(f"📢 Chef toont info-dia in room {room}: {bericht}")
    # Stuur het bericht naar alle clients in de room
    emit('info_dia', {'bericht': f"{bericht}"}, room=room)


@socketio.on("deelnemer_verwijderd")
def handle_deelnemer_verwijderd(data):
    naam = data.get("naam", "onbekend")
    baan = data.get("baan")
    nummer = data.get("nummer")
    wedstrijd_id = data.get("wedstrijd_id")

    print(f"🗑️ Socket ontvangen: deelnemer {naam} (baan {baan}, nummer {nummer}) verwijderd uit wedstrijd {wedstrijd_id}")
    emit("deelnemer_verwijderd", data, room=f"wedstrijd_{wedstrijd_id}")






# ✅ Einde WebSocket events















# ===== ERROR HANDLER =====
@app.errorhandler(Exception)
def handle_exception(e):
    print(f"SERVER ERROR: {str(e)}")
    return jsonify({
        "status": "error",
        "error": str(e) or "Onbekende fout op de server"
    }), 500

# ===== MAIN =====
if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=5000, debug=True)

