const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Fichier où sont stockés les acheteurs
const DATA_FILE = path.join(__dirname, 'acheteurs.json');
const ADMIN_PASSWORD = 'tete&bebert';

// Initialise le fichier si il n'existe pas
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify([]));
}

function lireAcheteurs() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function sauvegarderAcheteur(acheteur) {
  const liste = lireAcheteurs();
  liste.push(acheteur);
  fs.writeFileSync(DATA_FILE, JSON.stringify(liste, null, 2));
}

// Tarifs en centimes
function getTarifCentimes(invitant, tshirt, arrivee) {
  const uneNuit = arrivee === '12';
  let base = uneNuit ? 4400 : 4500;
  if (invitant === 'Camille') base = uneNuit ? 1900 : 2000;
  else if (invitant === 'Jean' || invitant === 'Théophile') base = uneNuit ? 3400 : 3500;
  if (tshirt === 'oui') base += 3000;
  return base;
}

// ── ROUTE : Création du PaymentIntent ──
app.post('/create-payment-intent', async (req, res) => {
  const { invitant, nom, email, arrivee, soirees, tshirt, taille_tshirt } = req.body;

  if (!invitant || !nom || !email || !arrivee || !soirees) {
    return res.status(400).json({ error: 'Informations manquantes.' });
  }

  const montant = getTarifCentimes(invitant, tshirt, arrivee);

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: montant,
      currency: 'eur',
      receipt_email: email,
      metadata: {
        nom_acheteur: nom,
        invitant: invitant,
        arrivee: arrivee + ' septembre 2026',
        soirees: soirees,
        festival: 'Les Braises 2026',
        lieu: 'Les Aubrais, Machecoul',
      },
      description: `Billet Les Braises 2026 — ${nom} (invité par ${invitant})`,
    });

    // On stocke temporairement les infos avec le paymentIntent ID
    // La sauvegarde définitive se fait après confirmation du paiement (webhook ou confirmation front)
    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id
    });

  } catch (err) {
    console.error('Stripe error:', err.message);
    res.status(500).json({ error: 'Erreur Stripe : ' + err.message });
  }
});

// ── ROUTE : Confirmation de paiement (appelée par le front après succès Stripe) ──
app.post('/confirm-payment', async (req, res) => {
  const { paymentIntentId, nom, prenom, email, invitant, arrivee, soirees, tshirt, taille_tshirt } = req.body;

  try {
    // Vérifie auprès de Stripe que le paiement est bien réussi
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (paymentIntent.status !== 'succeeded') {
      return res.status(400).json({ error: 'Paiement non confirmé.' });
    }

    const montantEuros = paymentIntent.amount / 100;

    // Enregistre l'acheteur
    const acheteur = {
      nom: nom,
      prenom: prenom,
      email: email,
      soirees: soirees,
      invitant: invitant,
      arrivee: arrivee + ' septembre 2026',
      tshirt: tshirt === 'oui' ? 'Oui — taille ' + taille_tshirt : 'Non',
      montant: montantEuros + ' €',
      date_achat: new Date().toLocaleString('fr-FR'),
      payment_id: paymentIntentId,
    };

    sauvegarderAcheteur(acheteur);
    console.log('✓ Nouvel acheteur enregistré :', nom, prenom);
    res.json({ ok: true });

  } catch (err) {
    console.error('Erreur confirmation:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── ROUTE : Page admin (protégée par mot de passe) ──
// ── ROUTE : Page admin (protégée par mot de passe) ──
app.get('/admin', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Admin — Les Braises 2026</title>
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=Libre+Baskerville:wght@400;700&display=swap" rel="stylesheet"/>
  <style>
    :root { --cream: #F5ECD7; --orange: #E8622A; --jaune: #F0B429; --brun: #2C1A0E; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: var(--brun); color: var(--cream); font-family: 'Libre Baskerville', Georgia, serif; min-height: 100vh; padding: 2rem 1rem 4rem; }
    h1 { font-family: 'Playfair Display', serif; color: var(--jaune); font-size: 1.8rem; margin-bottom: 0.3rem; }
    .subtitle { color: rgba(245,236,215,0.5); font-size: 0.78rem; letter-spacing: 0.15em; text-transform: uppercase; margin-bottom: 2rem; }
    #login-box { max-width: 340px; margin: 6rem auto; text-align: center; }
    #login-box input { width: 100%; background: rgba(44,26,14,0.9); border: 1px solid rgba(232,98,42,0.4); border-radius: 9px; padding: 0.75rem 1rem; font-family: 'Libre Baskerville', serif; font-size: 0.95rem; color: var(--cream); outline: none; margin: 1rem 0; }
    #login-box button { width: 100%; background: var(--orange); color: var(--cream); border: none; border-radius: 9px; padding: 0.85rem; font-family: 'Playfair Display', serif; font-size: 1rem; font-weight: 700; cursor: pointer; }
    #login-box button:hover { background: #cf5523; }
    .error { color: #f09595; font-size: 0.82rem; margin-top: 0.5rem; }
    #admin-panel { display: none; width: 100%; }
    .top-bar { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 1.5rem; flex-wrap: wrap; gap: 1rem; }
    .stats { display: flex; gap: 1rem; flex-wrap: wrap; }
    .stat { background: rgba(232,98,42,0.1); border: 1px solid rgba(232,98,42,0.3); border-radius: 10px; padding: 0.7rem 1.2rem; text-align: center; }
    .stat-num { font-family: 'Playfair Display', serif; font-size: 1.6rem; color: var(--jaune); }
    .stat-label { font-size: 0.65rem; letter-spacing: 0.15em; text-transform: uppercase; color: rgba(245,236,215,0.45); }
    .btn-export { background: var(--orange); color: var(--cream); border: none; border-radius: 9px; padding: 0.75rem 1.5rem; font-family: 'Playfair Display', serif; font-size: 0.95rem; font-weight: 700; cursor: pointer; text-decoration: none; display: inline-block; }
    .btn-export:hover { background: #cf5523; }
    .table-container { width: 100%; overflow-y: auto; max-height: 70vh; }
    table { width: 100%; border-collapse: collapse; font-size: 0.82rem; table-layout: fixed; }
    col.c-suppr  { width: 44px; }
    col.c-num    { width: 32px; }
    col.c-nom    { width: 130px; }
    col.c-prenom { width: 100px; }
    col.c-email  { width: 175px; }
    col.c-soirees{ width: 75px; }
    col.c-invitant{ width: 90px; }
    col.c-arrivee{ width: 115px; }
    col.c-tshirt { width: 65px; }
    col.c-taille { width: 55px; }
    col.c-montant{ width: 75px; }
    col.c-date   { width: 125px; }
    thead { position: sticky; top: 0; z-index: 2; }
    thead tr { background: #3a1e0a; border-bottom: 1px solid rgba(232,98,42,0.4); }
    th { padding: 0.75rem 0.5rem; text-align: left; font-size: 0.63rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--orange); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    td { padding: 0.65rem 0.5rem; border-bottom: 1px solid rgba(245,236,215,0.07); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; vertical-align: middle; }
    tr:hover td { background: rgba(245,236,215,0.03); }
    .badge { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 5px; font-size: 0.7rem; }
    .badge-1 { background: rgba(240,180,41,0.15); color: var(--jaune); }
    .badge-2 { background: rgba(232,98,42,0.15); color: var(--orange); }
    .empty { text-align: center; padding: 3rem; color: rgba(245,236,215,0.35); font-style: italic; }
    .btn-suppr { background: none; border: none; cursor: pointer; color: rgba(245,236,215,0.3); font-size: 15px; padding: 3px 5px; border-radius: 4px; transition: all 0.2s; }
    .btn-suppr:hover { color: #f09595; background: rgba(200,50,50,0.2); }
  </style>
</head>
<body>
  <div id="login-box">
    <h1>Les Braises</h1>
    <p class="subtitle">Accès administration</p>
    <input type="password" id="pwd" placeholder="Mot de passe" onkeydown="if(event.key==='Enter')login()" />
    <button onclick="login()">Accéder →</button>
    <p class="error" id="login-error"></p>
  </div>
  <div id="admin-panel">
    <div class="top-bar">
      <div>
        <h1>Les Braises 2026</h1>
        <p class="subtitle">Liste des participants</p>
      </div>
      <div style="display:flex;gap:1rem;align-items:center;flex-wrap:wrap;">
        <div class="stats">
          <div class="stat"><div class="stat-num" id="stat-total">—</div><div class="stat-label">billets vendus</div></div>
          <div class="stat"><div class="stat-num" id="stat-recette">—</div><div class="stat-label">recette totale</div></div>
        </div>
        <a class="btn-export" href="/export-csv?pwd=" id="export-btn">Télécharger Excel (.csv)</a>
      </div>
    </div>
    <div class="table-container">
      <table>
        <colgroup>
          <col class="c-suppr"/><col class="c-num"/><col class="c-nom"/><col class="c-prenom"/>
          <col class="c-email"/><col class="c-soirees"/><col class="c-invitant"/><col class="c-arrivee"/>
          <col class="c-tshirt"/><col class="c-taille"/><col class="c-montant"/><col class="c-date"/>
        </colgroup>
        <thead>
          <tr>
            <th></th><th>#</th><th>Nom</th><th>Prénom</th><th>Email</th>
            <th>Soirées</th><th>Invité par</th><th>Arrivée</th>
            <th>T-shirt</th><th>Taille</th><th>Montant</th><th>Date d'achat</th>
          </tr>
        </thead>
        <tbody id="table-body"></tbody>
      </table>
    </div>
  </div>
  <script>
    let mdp = '';
    function login() {
      mdp = document.getElementById('pwd').value;
      fetch('/api/acheteurs?pwd=' + encodeURIComponent(mdp))
        .then(r => { if (r.status === 401) throw new Error('Mot de passe incorrect.'); return r.json(); })
        .then(data => {
          document.getElementById('login-box').style.display = 'none';
          document.getElementById('admin-panel').style.display = 'block';
          document.getElementById('export-btn').href = '/export-csv?pwd=' + encodeURIComponent(mdp);
          afficherTableau(data);
        })
        .catch(err => { document.getElementById('login-error').textContent = err.message; });
    }
    async function supprimerAcheteur(index) {
      if (!confirm('Supprimer cet acheteur de la liste ?')) return;
      const res = await fetch('/api/acheteurs/' + index + '?pwd=' + encodeURIComponent(mdp), { method: 'DELETE' });
      if (res.ok) {
        fetch('/api/acheteurs?pwd=' + encodeURIComponent(mdp)).then(r => r.json()).then(data => afficherTableau(data));
      } else { alert('Erreur lors de la suppression.'); }
    }
    function afficherTableau(acheteurs) {
      const tbody = document.getElementById('table-body');
      let recette = 0;
      if (acheteurs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="12" class="empty">Aucun billet vendu pour le moment.</td></tr>';
      } else {
        tbody.innerHTML = acheteurs.map((a, i) => {
          const montantNum = parseFloat(a.montant);
          if (!isNaN(montantNum)) recette += montantNum;
          const badgeClass = (a.soirees || '') === '1 soirée' ? 'badge-1' : 'badge-2';
          const tshirtPris = a.tshirt && a.tshirt.startsWith('Oui');
          const tshirtCell = tshirtPris ? 'Oui' : 'Non';
          const tailleCell = tshirtPris ? (a.tshirt || '').replace('Oui — taille ', '') : '';
          return '<tr>' +
            '<td style="text-align:center"><button class="btn-suppr" onclick="supprimerAcheteur(' + i + ')" title="Supprimer">✕</button></td>' +
            '<td style="color:rgba(245,236,215,0.35)">' + (i+1) + '</td>' +
            '<td><strong>' + (a.nom||'') + '</strong></td>' +
            '<td>' + (a.prenom||'') + '</td>' +
            '<td style="color:rgba(245,236,215,0.6);font-size:0.75rem">' + (a.email||'') + '</td>' +
            '<td><span class="badge ' + badgeClass + '">' + (a.soirees||'') + '</span></td>' +
            '<td>' + (a.invitant||'') + '</td>' +
            '<td>' + (a.arrivee||'') + '</td>' +
            '<td>' + tshirtCell + '</td>' +
            '<td style="color:var(--orange)">' + tailleCell + '</td>' +
            '<td style="color:var(--jaune);font-weight:700">' + (a.montant||'') + '</td>' +
            '<td style="color:rgba(245,236,215,0.4);font-size:0.72rem">' + (a.date_achat||'') + '</td>' +
            '</tr>';
        }).join('');
        document.getElementById('stat-recette').textContent = recette.toFixed(0) + ' €';
      }
      document.getElementById('stat-total').textContent = acheteurs.length;
    }
  </script>
</body>
</html>`);
});

// ── ROUTE : API données acheteurs (protégée) ──
app.get('/api/acheteurs', (req, res) => {
  if (req.query.pwd !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Non autorisé.' });
  }
  res.json(lireAcheteurs());
});

// ── ROUTE : Suppression d'un acheteur (protégée) ──
app.delete('/api/acheteurs/:index', (req, res) => {
  if (req.query.pwd !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Non autorisé.' });
  }
  const index = parseInt(req.params.index);
  const liste = lireAcheteurs();
  if (index < 0 || index >= liste.length) {
    return res.status(400).json({ error: 'Index invalide.' });
  }
  liste.splice(index, 1);
  fs.writeFileSync(DATA_FILE, JSON.stringify(liste, null, 2));
  res.json({ ok: true });
});

// ── ROUTE : Export CSV (protégée) ──
app.get('/export-csv', (req, res) => {
  if (req.query.pwd !== ADMIN_PASSWORD) {
    return res.status(401).send('Non autorisé.');
  }

  const acheteurs = lireAcheteurs();
  const colonnes = ['Nom', 'Prénom', 'Email', 'Soirées', 'Invité par', 'Arrivée', 'T-shirt', 'Taille', 'Montant', "Date d'achat"];
  const lignes = acheteurs.map(a => {
    const tshirtOui = a.tshirt && a.tshirt.startsWith('Oui');
    return [a.nom, a.prenom, a.email, a.soirees, a.invitant, a.arrivee, tshirtOui ? 'Oui' : 'Non', tshirtOui ? a.tshirt.replace('Oui — taille ', '') : '', a.montant, a.date_achat];
  });

  const csvContent = [colonnes, ...lignes]
    .map(row => row.map(cell => `"${(cell || '').replace(/"/g, '""')}"`).join(';'))
    .join('\n');

  // BOM UTF-8 pour que Excel ouvre correctement les accents
  const bom = '\uFEFF';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="braises-participants.csv"');
  res.send(bom + csvContent);
});

// Toutes les autres routes → page d'accueil
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✓ Serveur Les Braises démarré sur http://localhost:${PORT}`);
});
