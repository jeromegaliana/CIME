# Cime △ — CV Optimizer
> Atteignez le sommet de votre carrière

App React propulsée par Groq (Llama 3.3 70B) — gratuite, chaque utilisateur utilise sa propre clé API Groq.

---

## 🚀 Déploiement GitHub + Vercel (5 minutes)

### 1. Préparer GitHub

```bash
# Cloner ou créer le repo
git init
git add .
git commit -m "Initial commit — Cime"

# Créer un repo sur github.com puis :
git remote add origin https://github.com/TON_USERNAME/cime.git
git push -u origin main
```

### 2. Déployer sur Vercel

1. Va sur **vercel.com** → "Add New Project"
2. Connecte ton compte GitHub
3. Sélectionne le repo `cime`
4. Vercel détecte automatiquement React — clique **Deploy**
5. C'est tout ! URL publique en 2 minutes ✓

### 3. (Optionnel) Domaine personnalisé

Dans Vercel → Settings → Domains → ajoute `cime.app` ou autre

---

## 🏗 Structure du projet

```
cime/
├── api/
│   └── groq.js          ← Proxy serverless (résout CORS)
├── public/
│   └── index.html
├── src/
│   ├── index.js
│   └── App.jsx          ← App complète
├── package.json
└── vercel.json
```

## ⚙️ Comment ça marche

```
Navigateur → /api/groq (Vercel) → api.groq.com
               ↑
         Proxy CORS — la clé Groq
         vient du client, jamais stockée
```

Le proxy `/api/groq` :
- Reçoit la requête du navigateur
- Ajoute la clé API (fournie par l'utilisateur dans le header)
- Forwarde vers Groq
- Retourne la réponse

**Coût hébergement : 0$ (Vercel hobby plan)**
**Coût IA : 0$ pour toi (chaque user utilise sa clé Groq gratuite)**

---

## 🛠 Dev local

```bash
npm install
npm start
# App sur http://localhost:3000
# Proxy /api/groq géré par react-scripts en dev via proxy config
```

Pour le dev local, ajouter dans `package.json` :
```json
"proxy": "http://localhost:3000"
```

Ou tester directement en prod sur Vercel via `vercel dev`.
