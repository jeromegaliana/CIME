import { useState, useRef, useCallback, useEffect } from "react";
import * as mammoth from "mammoth";

// ── html2canvas + jsPDF (capture DOM → PDF) ───────────────────────
function usePdfLibs() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (window.jspdf && window.html2canvas) { setReady(true); return; }
    let loaded = 0;
    const check = () => { loaded++; if (loaded === 2) setReady(true); };
    const s1 = document.createElement("script");
    s1.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
    s1.onload = check;
    const s2 = document.createElement("script");
    s2.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
    s2.onload = check;
    if (!window.jspdf) document.head.appendChild(s1); else check();
    if (!window.html2canvas) document.head.appendChild(s2); else check();
  }, []);
  return ready;
}

// ── pdf.js loader ─────────────────────────────────────────────────
function usePdfJs() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (window.pdfjsLib) { setReady(true); return; }
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    s.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      setReady(true);
    };
    document.head.appendChild(s);
  }, []);
  return ready;
}

async function extractPdfText(file) {
  const buf = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(item => item.str).join(" ") + "\n";
  }
  return text;
}

// ── Theme ─────────────────────────────────────────────────────────
const G = {
  bg: "#080A0E", surface: "#0F1218", surface2: "#161B24",
  border: "#1A1E28", border2: "#252B38",
  gold: "#C9A96E", goldLight: "#E8C98A", goldDim: "rgba(201,169,110,0.12)",
  text: "#EDE9E1", muted: "#6B6F7E", subtle: "#2E3240",
  green: "#5DB88A", greenBg: "rgba(93,184,138,0.08)", greenBorder: "rgba(93,184,138,0.2)",
  red: "#E06B6B", redBg: "rgba(224,107,107,0.08)", redBorder: "rgba(224,107,107,0.2)",
  amber: "#E8A84A", amberBg: "rgba(232,168,74,0.08)", amberBorder: "rgba(232,168,74,0.2)",
  blue: "#6B9FE8", blueBg: "rgba(107,159,232,0.08)", blueBorder: "rgba(107,159,232,0.2)",
  groq: "#F55036", groqBg: "rgba(245,80,54,0.08)", groqBorder: "rgba(245,80,54,0.2)",
};

const GROQ_MODEL = "llama-3.3-70b-versatile";

const DEFAULT_CONFIG = {
  analyse: `- Évalue honnêtement les écarts entre le CV et l'offre d'emploi
- Identifie les compétences manquantes comme des gaps à combler
- Priorise les critères obligatoires de l'offre vs les critères souhaitables
- Si un gap est critique, indique clairement pourquoi c'est important`,
  generation: `- Ne jamais inventer de nouvelles expériences, diplômes ou formations
- Si une compétence est identifiée comme un gap, NE PAS l'ajouter automatiquement — attendre la confirmation de l'utilisateur en étape 4
- Reformuler et mettre en valeur ce qui existe déjà dans le CV
- Utiliser les mots-clés exacts de l'offre d'emploi pour l'ATS
- Adapter le profil professionnel pour cibler précisément le poste`,
  affinement: `- Si l'utilisateur demande d'ajouter une compétence non présente dans le CV original, demander confirmation avant de l'ajouter
- Si une compétence est vue comme un gap, toujours demander à la personne quoi faire : l'ajouter ou non
- Ne jamais inventer de nouvelles expériences ou réalisations
- Expliquer brièvement chaque modification effectuée`,
  ton: `- Professionnel et bienveillant
- Direct et concis dans les explications
- Encourageant sans être excessif`,
};

function buildAnalysisSystem(config) {
  return `Tu es un expert RH. Analyse la correspondance CV/offre d'emploi.

INSTRUCTIONS: ${config.analyse}
TON: ${config.ton}

Retourne UNIQUEMENT un objet JSON valide, sans markdown ni texte avant/après.
Sois concis dans les textes (1-2 phrases par champ).
N'utilise jamais de guillemets doubles à l'intérieur des valeurs de texte — utilise des apostrophes si nécessaire.

{"score":72,"titre_poste":"...","nom_candidat":"...","resume":"...","points_forts":[{"titre":"...","detail":"..."}],"ecarts":[{"titre":"...","detail":"...","niveau":"critique|important|mineur"}],"recommandations":["..."]}`;
}

function buildCVSystem(config) {
  return `Tu es un expert RH. Réécris le CV en préservant TOUT le contenu original — n'omets aucune expérience, aucune réalisation, aucune compétence. Adapte uniquement le vocabulaire et la formulation.

INSTRUCTIONS: ${config.generation}
TON: ${config.ton}

Retourne UNIQUEMENT un objet JSON valide, sans markdown ni texte avant/après.
RÈGLES JSON STRICTES:
- N'utilise jamais de guillemets doubles dans les valeurs texte — remplace par des apostrophes
- Échappe les caractères spéciaux
- Tous les champs sont obligatoires

{"nom":"...","titre":"...","contact":"...","profil":"...","experiences":[{"entreprise":"...","poste":"...","dates":"...","points":["..."]}],"competences":["..."],"formation":[{"diplome":"...","institution":"...","annee":"..."}],"notes":["..."]}`;
}

function buildRefineSystem(config) {
  return `Tu es un expert en rédaction de CV. Préserve tout le contenu — ne raccourcis rien sans demande explicite.

INSTRUCTIONS: ${config.affinement}
TON: ${config.ton}

Retourne UNIQUEMENT un objet JSON valide, sans markdown ni texte avant/après.
N'utilise pas de guillemets doubles dans les valeurs texte.

Si confirmation requise: {"action":"confirm","question":"...","options":["Oui","Non"],"cv":{...cv complet inchangé...}}
Si modification: {"action":"update","cv":{...cv complet mis à jour...},"explication":"..."}`;
}

// ── Groq API call ─────────────────────────────────────────────────
async function callGroq(apiKey, system, userText, max_tokens = 8000) {
  const resp = await fetch("/api/groq", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userText },
      ],
      max_tokens,
      temperature: 0.3,
    }),
  });
  const data = await resp.json();
  if (data.error) throw new Error(data.error.message || "Erreur Groq API");
  const raw = data.choices?.[0]?.message?.content?.trim() || "";

  // Extraction robuste du JSON — trouve le premier { et le dernier } correspondant
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1) {
    throw new Error("Aucun JSON trouvé dans la réponse. Réessayez.");
  }
  const jsonStr = raw.slice(firstBrace, lastBrace + 1);
  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    // Tentative de réparation : supprimer les caractères problématiques
    const cleaned = jsonStr
      .replace(/[\x00-\x1F\x7F]/g, " ") // caractères de contrôle
      .replace(/,\s*([}\]])/g, "$1")      // trailing commas
      .replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":'); // clés sans guillemets
    try {
      return JSON.parse(cleaned);
    } catch {
      throw new Error("Format de réponse invalide. Réessayez — si ça persiste, simplifiez votre CV ou l'offre d'emploi.");
    }
  }
}

// ── PDF print view — CV professionnel fond blanc ──────────────────
function renderPrintHTML(d) {
  const escHtml = (s) => (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const exps = (d.experiences || []).map(e => `
    <div class="exp">
      <div class="exp-top">
        <div class="exp-left">
          <span class="exp-company">${escHtml(e.entreprise)}</span>
          <span class="exp-sep"> · </span>
          <span class="exp-role">${escHtml(e.poste)}</span>
        </div>
        <span class="exp-dates">${escHtml(e.dates)}</span>
      </div>
      <ul class="exp-points">${(e.points || []).map(p => `<li>${escHtml(p)}</li>`).join("")}</ul>
    </div>`).join("");

  const comps = (d.competences || []).map(c =>
    `<span class="tag">${escHtml(c)}</span>`).join("");

  const fmts = (d.formation || []).map(f => `
    <div class="form-item">
      <span class="form-diplome">${escHtml(f.diplome)}</span>
      ${f.institution ? `<span class="form-sep"> · </span><span class="form-inst">${escHtml(f.institution)}</span>` : ""}
      ${f.annee ? `<span class="form-year"> (${escHtml(f.annee)})</span>` : ""}
    </div>`).join("");

  return `<div class="cv-root">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  .cv-root {
    width: 794px;
    background: #ffffff;
    font-family: 'Arial', Helvetica, sans-serif;
    color: #1c1c1c;
    font-size: 11px;
    line-height: 1.55;
  }
  /* ── HEADER ── */
  .cv-header {
    padding: 36px 48px 24px;
    border-bottom: 2px solid #1c1c1c;
  }
  .cv-name {
    font-size: 26px;
    font-weight: 700;
    letter-spacing: -0.02em;
    color: #1c1c1c;
    margin-bottom: 3px;
  }
  .cv-title {
    font-size: 13px;
    font-weight: 400;
    color: #555;
    margin-bottom: 10px;
    letter-spacing: 0.02em;
  }
  .cv-contact {
    font-size: 10px;
    color: #777;
    letter-spacing: 0.03em;
  }
  /* ── BODY ── */
  .cv-body {
    padding: 0 48px 40px;
  }
  /* ── SECTION ── */
  .section {
    margin-top: 22px;
  }
  .section-title {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: #1c1c1c;
    padding-bottom: 5px;
    border-bottom: 1px solid #1c1c1c;
    margin-bottom: 12px;
  }
  /* ── PROFIL ── */
  .profil-text {
    font-size: 11px;
    color: #333;
    line-height: 1.65;
  }
  /* ── EXPERIENCES ── */
  .exp { margin-bottom: 14px; }
  .exp-top {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 4px;
  }
  .exp-left { flex: 1; }
  .exp-company { font-weight: 700; font-size: 11.5px; color: #1c1c1c; }
  .exp-sep { color: #aaa; }
  .exp-role { font-size: 11px; color: #444; font-style: italic; }
  .exp-dates { font-size: 10px; color: #888; white-space: nowrap; flex-shrink: 0; }
  .exp-points { padding-left: 14px; margin-top: 3px; }
  .exp-points li {
    font-size: 10.5px;
    color: #333;
    line-height: 1.55;
    margin-bottom: 2px;
  }
  /* ── COMPÉTENCES ── */
  .tags { display: flex; flex-wrap: wrap; gap: 5px; }
  .tag {
    padding: 3px 9px;
    border: 1px solid #ccc;
    border-radius: 3px;
    font-size: 10px;
    color: #333;
    background: #f9f9f9;
  }
  /* ── FORMATION ── */
  .form-item { margin-bottom: 6px; font-size: 11px; }
  .form-diplome { font-weight: 700; color: #1c1c1c; }
  .form-sep { color: #aaa; }
  .form-inst { color: #555; }
  .form-year { color: #888; }
  /* ── FOOTER ── */
  .cv-footer {
    border-top: 1px solid #eee;
    padding: 8px 48px;
    text-align: center;
    font-size: 8px;
    color: #bbb;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
</style>

<div class="cv-header">
  <div class="cv-name">${escHtml(d.nom)}</div>
  <div class="cv-title">${escHtml(d.titre)}</div>
  <div class="cv-contact">${escHtml(d.contact)}</div>
</div>

<div class="cv-body">
  ${d.profil ? `
  <div class="section">
    <div class="section-title">Profil professionnel</div>
    <div class="profil-text">${escHtml(d.profil)}</div>
  </div>` : ""}

  ${(d.experiences || []).length > 0 ? `
  <div class="section">
    <div class="section-title">Expériences professionnelles</div>
    ${exps}
  </div>` : ""}

  ${(d.competences || []).length > 0 ? `
  <div class="section">
    <div class="section-title">Compétences</div>
    <div class="tags">${comps}</div>
  </div>` : ""}

  ${(d.formation || []).length > 0 ? `
  <div class="section">
    <div class="section-title">Formation</div>
    ${fmts}
  </div>` : ""}
</div>

<div class="cv-footer">Optimisé par Cime · Atteignez le sommet de votre carrière</div>
</div>`;
}

async function generatePDF(cvData) {
  const { jsPDF } = window.jspdf;

  // Créer un conteneur hors écran avec fond blanc
  const container = document.createElement("div");
  container.style.cssText = `
    position: fixed;
    top: 0; left: -9999px;
    width: 794px;
    background: #ffffff;
    z-index: -1;
  `;
  container.innerHTML = renderPrintHTML(cvData);
  document.body.appendChild(container);

  // Laisser le temps au browser de rendre les styles
  await new Promise(r => setTimeout(r, 300));

  try {
    const canvas = await window.html2canvas(container.firstElementChild, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
      logging: false,
      width: 794,
      windowWidth: 794,
    });

    const imgData = canvas.toDataURL("image/png");
    const imgW = 210; // A4 mm
    const imgH = (canvas.height * imgW) / canvas.width;

    const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });

    // Paginer si le contenu dépasse une page A4
    const pageH = 297;
    if (imgH <= pageH) {
      doc.addImage(imgData, "PNG", 0, 0, imgW, imgH);
    } else {
      const pxPerMm = canvas.width / imgW;
      const pageHeightPx = pageH * pxPerMm;
      let pageNum = 0;
      let yOffset = 0;

      while (yOffset < canvas.height) {
        if (pageNum > 0) doc.addPage();
        doc.addImage(imgData, "PNG", 0, -(yOffset / pxPerMm), imgW, imgH);
        yOffset += pageHeightPx;
        pageNum++;
      }
    }

    doc.save(`CV_${(cvData.nom || "CV").replace(/\s+/g, "_")}_Cime.pdf`);
  } finally {
    document.body.removeChild(container);
  }
}

function buildHTMLDoc(d) {
  const exps=(d.experiences||[]).map(e=>`<div class="exp"><div class="eh"><div><strong>${e.entreprise}</strong> — <span class="gold">${e.poste}</span></div><span class="dates">${e.dates}</span></div><ul>${(e.points||[]).map(p=>`<li>${p}</li>`).join("")}</ul></div>`).join("");
  const comps=(d.competences||[]).map(c=>`<span class="tag">${c}</span>`).join("");
  const fmts=(d.formation||[]).map(f=>`<div class="fi"><strong>${f.diplome}</strong><br><span class="m">${f.institution} · ${f.annee}</span></div>`).join("");
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>CV – ${d.nom} · Cime</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Georgia,serif;color:#1a1a1a;max-width:820px;margin:0 auto;padding:48px 40px;font-size:14px;line-height:1.6}h1{font-size:32px;font-weight:300;margin-bottom:4px}.titre{font-size:16px;color:#8B6914;margin-bottom:8px}.contact{font-family:monospace;font-size:11px;color:#888;margin-bottom:32px}.sec{margin-bottom:28px}.st{font-family:monospace;font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#8B6914;border-bottom:1px solid #e0d5c0;padding-bottom:6px;margin-bottom:16px}.exp{margin-bottom:18px;padding-left:14px;border-left:2px solid #e0d5c0}.eh{display:flex;justify-content:space-between;margin-bottom:6px;flex-wrap:wrap}.gold{color:#8B6914}.dates{font-family:monospace;font-size:11px;color:#888}ul{padding-left:18px}li{margin-bottom:4px}.tags{display:flex;flex-wrap:wrap;gap:6px}.tag{padding:3px 10px;border:1px solid #d4b87a;border-radius:20px;font-size:12px;color:#8B6914}.fi{margin-bottom:12px}.m{color:#888;font-size:12px}.grid{display:grid;grid-template-columns:1fr 220px;gap:40px}.footer{margin-top:40px;padding-top:12px;border-top:1px solid #eee;font-family:monospace;font-size:10px;color:#bbb;text-align:center}</style></head><body><h1>${d.nom}</h1><div class="titre">${d.titre}</div><div class="contact">${d.contact}</div><div class="grid"><div><div class="sec"><div class="st">Profil</div><p>${d.profil}</p></div><div class="sec"><div class="st">Expériences</div>${exps}</div></div><div><div class="sec"><div class="st">Compétences</div><div class="tags">${comps}</div></div><div class="sec"><div class="st">Formation</div>${fmts}</div></div></div><div class="footer">Généré par Cime · Atteignez le sommet de votre carrière</div></body></html>`;
}

// ── Logo ──────────────────────────────────────────────────────────
function CimeLogo({ size = "md", showTagline = false }) {
  const sizes = { sm: { font: 17 }, md: { font: 26 }, lg: { font: 50 } };
  const s = sizes[size];
  const tri = size === "lg" ? 16 : size === "md" ? 12 : 9;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: size === "lg" ? "center" : "flex-start", gap: 3 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
        <span style={{ fontFamily: "Georgia,'Times New Roman',serif", fontSize: s.font, fontWeight: 300, color: G.text, letterSpacing: "-0.03em", lineHeight: 1 }}>Cime</span>
        <svg width={tri + 5} height={tri} viewBox="0 0 18 14" fill="none" style={{ marginBottom: 1 }}>
          <path d="M9 1 L17 13 L1 13 Z" stroke={G.gold} strokeWidth="1.5" fill="none" strokeLinejoin="round" />
          <circle cx="9" cy="1" r="1.8" fill={G.gold} />
        </svg>
      </div>
      {showTagline && <div style={{ fontFamily: "monospace", fontSize: size === "lg" ? 12 : 9, color: G.muted, letterSpacing: "0.15em", textTransform: "uppercase" }}>Atteignez le sommet</div>}
    </div>
  );
}

// ── Shared UI ─────────────────────────────────────────────────────
function SectionLabel({ children }) {
  return <div style={{ fontFamily: "monospace", fontSize: 10, letterSpacing: "0.2em", color: G.gold, textTransform: "uppercase", marginBottom: 12, paddingBottom: 8, borderBottom: `1px solid ${G.border}` }}>{children}</div>;
}

function StepIndicator({ current }) {
  const steps = [["01","Upload"],["02","Analyse"],["03","CV"],["04","Affiner"]];
  return (
    <div style={{ display: "flex", alignItems: "center" }}>
      {steps.map(([n, label], i) => {
        const done = i < current, active = i === current;
        return (
          <div key={n} style={{ display: "flex", alignItems: "center" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
              <div style={{ width: 26, height: 26, borderRadius: "50%", background: done ? G.greenBg : active ? G.gold : G.surface, border: `1px solid ${done ? G.greenBorder : active ? G.gold : G.border2}`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "monospace", fontSize: 9, color: done ? G.green : active ? "#080A0E" : G.muted, fontWeight: 500 }}>{done ? "✓" : n}</div>
              <div style={{ fontFamily: "monospace", fontSize: 8, color: active ? G.gold : done ? G.green : G.subtle, letterSpacing: "0.08em", textTransform: "uppercase", whiteSpace: "nowrap" }}>{label}</div>
            </div>
            {i < 3 && <div style={{ width: 28, height: 1, background: done ? G.greenBorder : G.border, margin: "0 5px", marginBottom: 16 }} />}
          </div>
        );
      })}
    </div>
  );
}

function Topbar({ title, subtitle, step, onBack, backLabel, children, onSettings }) {
  return (
    <div style={{ background: G.surface, borderBottom: `1px solid ${G.border}`, padding: "11px 22px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, position: "sticky", top: 0, zIndex: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <CimeLogo size="sm" />
        {onBack && <><div style={{ width: 1, height: 18, background: G.border }} /><button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", color: G.muted, fontSize: 12, fontFamily: "inherit", padding: 0 }}>← {backLabel}</button></>}
        {(title || subtitle) && <><div style={{ width: 1, height: 18, background: G.border }} /><div><div style={{ fontSize: 13, fontWeight: 500, color: G.text }}>{title}</div>{subtitle && <div style={{ fontFamily: "monospace", fontSize: 9, color: G.gold, letterSpacing: "0.08em", marginTop: 1 }}>{subtitle}</div>}</div></>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        {step !== undefined && <StepIndicator current={step} />}
        {onSettings && <button onClick={onSettings} style={{ width: 32, height: 32, borderRadius: 8, background: "transparent", border: `1px solid ${G.border2}`, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, color: G.muted, transition: "all 0.15s" }}>⚙</button>}
        {children}
      </div>
    </div>
  );
}

function LoadingScreen({ message }) {
  return (
    <div style={{ minHeight: "100vh", background: G.bg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 36 }}>
      <style>{`@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-9px)}}@keyframes pgaim{0%{width:5%}50%{width:82%}100%{width:96%}}`}</style>
      <div style={{ animation: "float 3s ease-in-out infinite" }}>
        <svg width="60" height="50" viewBox="0 0 60 50" fill="none">
          <path d="M30 2 L58 48 L2 48 Z" stroke={G.gold} strokeWidth="1.5" fill="none" strokeLinejoin="round" />
          <path d="M30 2 L42 24 L18 24" stroke={G.gold} strokeWidth="0.7" opacity="0.25" />
          <circle cx="30" cy="2" r="2.5" fill={G.gold} />
        </svg>
      </div>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontFamily: "Georgia,serif", fontSize: 34, fontWeight: 300, color: G.text, fontStyle: "italic", marginBottom: 6 }}>{message}</div>
        <div style={{ fontFamily: "monospace", fontSize: 10, color: G.muted, letterSpacing: "0.2em", textTransform: "uppercase" }}>Cime · Propulsé par Groq</div>
      </div>
      <div style={{ width: 220, height: 1.5, background: G.border, borderRadius: 2, overflow: "hidden" }}>
        <div style={{ height: "100%", background: `linear-gradient(90deg,${G.gold},${G.goldLight})`, animation: "pgaim 1.8s ease-in-out infinite" }} />
      </div>
    </div>
  );
}

function CVPreview({ cvData }) {
  return (
    <div style={{ background: G.surface, border: `1px solid ${G.border}`, borderRadius: 14, overflow: "hidden" }}>
      <div style={{ padding: "26px 30px 20px", borderBottom: `1px solid ${G.border}`, background: "#0A0C10" }}>
        <h2 style={{ fontFamily: "Georgia,serif", fontSize: "clamp(20px,3vw,32px)", fontWeight: 300, margin: "0 0 4px", color: G.text }}>{cvData.nom}</h2>
        <div style={{ fontSize: 13, color: G.gold, marginBottom: 8 }}>{cvData.titre}</div>
        <div style={{ fontFamily: "monospace", fontSize: 10, color: G.muted }}>{cvData.contact}</div>
      </div>
      <div style={{ padding: "22px 30px", display: "grid", gridTemplateColumns: "1fr 210px", gap: 26 }}>
        <div>
          <div style={{ marginBottom: 18 }}><SectionLabel>Profil</SectionLabel><p style={{ fontSize: 12, lineHeight: 1.8, color: "#C8C4BC", margin: 0 }}>{cvData.profil}</p></div>
          <div><SectionLabel>Expériences</SectionLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {(cvData.experiences || []).map((exp, i) => (
                <div key={i} style={{ paddingLeft: 12, borderLeft: `2px solid ${G.border}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 3, marginBottom: 3 }}>
                    <div><div style={{ fontSize: 12, fontWeight: 500 }}>{exp.entreprise}</div><div style={{ fontSize: 11, color: G.gold }}>{exp.poste}</div></div>
                    <div style={{ fontFamily: "monospace", fontSize: 10, color: G.muted }}>{exp.dates}</div>
                  </div>
                  <ul style={{ margin: "4px 0 0", paddingLeft: 14 }}>{(exp.points || []).map((p, j) => <li key={j} style={{ fontSize: 11, color: "#C8C4BC", lineHeight: 1.7, marginBottom: 2 }}>{p}</li>)}</ul>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div>
          <div style={{ marginBottom: 18 }}><SectionLabel>Compétences</SectionLabel><div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>{(cvData.competences || []).map((c, i) => <span key={i} style={{ padding: "3px 8px", background: G.goldDim, border: "1px solid rgba(201,169,110,0.15)", borderRadius: 20, fontSize: 10, color: G.gold }}>{c}</span>)}</div></div>
          <div><SectionLabel>Formation</SectionLabel>{(cvData.formation || []).map((f, i) => <div key={i} style={{ marginBottom: 10 }}><div style={{ fontSize: 11, fontWeight: 500 }}>{f.diplome}</div><div style={{ fontSize: 10, color: G.muted, marginTop: 1 }}>{f.institution}</div><div style={{ fontFamily: "monospace", fontSize: 9, color: G.subtle, marginTop: 1 }}>{f.annee}</div></div>)}</div>
        </div>
      </div>
    </div>
  );
}

function ExportButtons({ cvData, pdfReady }) {
  const [exp, setExp] = useState(false);

  const handlePDF = async () => {
    if (!pdfReady) return;
    setExp(true);
    try { await generatePDF(cvData); }
    catch (e) { console.error("PDF error:", e); }
    finally { setExp(false); }
  };

  const handleGDoc = () => {
    const blob = new Blob([buildHTMLDoc(cvData)], { type: "text/html;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `CV_${(cvData.nom||"CV").replace(/\s+/g,"_")}_Cime.html`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div style={{ display: "flex", gap: 7 }}>
      <button onClick={handlePDF} disabled={!pdfReady || exp}
        style={{ padding: "7px 13px", borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: pdfReady ? "pointer" : "wait", border: `1px solid ${G.gold}`, background: "transparent", color: G.gold, fontFamily: "inherit", opacity: exp ? 0.6 : 1 }}>
        {exp ? "⟳ Export..." : "⬇ PDF"}
      </button>
      <button onClick={handleGDoc} style={{ padding: "7px 13px", borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: "pointer", border: "none", background: G.gold, color: "#080A0E", fontFamily: "inherit" }}>📑 Google Docs</button>
    </div>
  );
}

// ── ONBOARDING: Groq API Key ──────────────────────────────────────
function OnboardingScreen({ onKeySubmit }) {
  const [key, setKey] = useState("");
  const [show, setShow] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    if (!key.trim().startsWith("gsk_")) { setError("La clé Groq commence par gsk_"); return; }
    setTesting(true); setError("");
    try {
      const resp = await fetch("/api/groq", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key.trim()}` },
        body: JSON.stringify({ model: GROQ_MODEL, messages: [{ role: "user", content: "ok" }], max_tokens: 5 }),
      });
      const data = await resp.json();
      if (data.error) throw new Error(data.error.message);
      onKeySubmit(key.trim());
    } catch (e) { setError("Clé invalide ou erreur de connexion : " + e.message); }
    setTesting(false);
  };

  return (
    <div style={{ minHeight: "100vh", background: G.bg, fontFamily: "'DM Sans', sans-serif", color: G.text, display: "flex", flexDirection: "column" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Cormorant:ital,wght@0,300;0,400;1,300;1,400&family=DM+Sans:wght@300;400;500&display=swap');@keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}input:focus{outline:none;border-color:#C9A96E!important}.btn-submit:hover:not(:disabled){background:#D4B47A!important}.step-card:hover{border-color:#2A2D38!important}`}</style>

      {/* Nav */}
      <div style={{ background: G.surface, borderBottom: `1px solid ${G.border}`, padding: "13px 28px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <CimeLogo size="sm" />
        <span style={{ fontFamily: "monospace", fontSize: 10, padding: "3px 10px", background: G.goldDim, border: "1px solid rgba(201,169,110,0.2)", borderRadius: 20, color: G.gold, letterSpacing: "0.08em" }}>Gratuit · Powered by Groq</span>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 20px 60px" }}>
        <div style={{ maxWidth: 520, width: "100%", animation: "fadeUp 0.4s ease" }}>

          {/* Hero */}
          <div style={{ textAlign: "center", marginBottom: 40 }}>
            <div style={{ display: "inline-block", marginBottom: 20 }}>
              <svg width="56" height="46" viewBox="0 0 56 46" fill="none">
                <path d="M28 2 L54 44 L2 44 Z" stroke={G.gold} strokeWidth="1.5" fill="none" strokeLinejoin="round" />
                <circle cx="28" cy="2" r="2.5" fill={G.gold} />
                <path d="M18 44 L28 26 L38 44" stroke={G.goldLight} strokeWidth="1" fill="none" opacity="0.35" />
              </svg>
            </div>
            <CimeLogo size="lg" showTagline={true} />
            <p style={{ marginTop: 16, color: G.muted, fontSize: 14, lineHeight: 1.7, maxWidth: 420, marginLeft: "auto", marginRight: "auto" }}>
              Cime utilise l'IA Groq pour optimiser votre CV. Entrez votre clé API Groq gratuite pour commencer.
            </p>
          </div>

          {/* How to get key */}
          <div style={{ background: G.surface, border: `1px solid ${G.border}`, borderRadius: 14, padding: "20px 22px", marginBottom: 20 }}>
            <div style={{ fontFamily: "monospace", fontSize: 10, letterSpacing: "0.15em", color: G.gold, textTransform: "uppercase", marginBottom: 16 }}>Comment obtenir votre clé gratuite</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[
                ["1", "Allez sur", "console.groq.com", "https://console.groq.com"],
                ["2", "Créez un compte gratuit", "", ""],
                ["3", "Cliquez sur « API Keys » → « Create API Key »", "", ""],
                ["4", "Copiez la clé et collez-la ci-dessous", "", ""],
              ].map(([n, text, link, href]) => (
                <div key={n} style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <div style={{ width: 22, height: 22, borderRadius: "50%", background: G.goldDim, border: "1px solid rgba(201,169,110,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "monospace", fontSize: 10, color: G.gold, flexShrink: 0 }}>{n}</div>
                  <div style={{ fontSize: 13, color: "#C8C4BC" }}>
                    {text}{" "}
                    {link && <a href={href} target="_blank" rel="noreferrer" style={{ color: G.gold, textDecoration: "none", borderBottom: `1px solid rgba(201,169,110,0.3)` }}>{link}</a>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Info badge */}
          <div style={{ background: G.greenBg, border: `1px solid ${G.greenBorder}`, borderRadius: 10, padding: "10px 14px", marginBottom: 20, display: "flex", gap: 10, alignItems: "flex-start" }}>
            <span style={{ fontSize: 14, flexShrink: 0 }}>🔒</span>
            <div style={{ fontSize: 12, color: G.green, lineHeight: 1.6 }}>Votre clé reste dans votre navigateur. Elle n'est jamais envoyée à nos serveurs — seulement utilisée pour appeler Groq directement.</div>
          </div>

          {/* Input */}
          <div style={{ background: G.surface, border: `1px solid ${G.border}`, borderRadius: 14, padding: "20px 22px" }}>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Clé API Groq</div>
            <div style={{ fontSize: 12, color: G.muted, marginBottom: 12 }}>Format : gsk_xxxxxxxxxxxxxxxxxxxx</div>
            <div style={{ position: "relative", marginBottom: 14 }}>
              <input
                type={show ? "text" : "password"}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                placeholder="gsk_..."
                style={{ width: "100%", background: "rgba(255,255,255,0.02)", border: `1px solid ${G.border2}`, borderRadius: 10, color: G.text, fontFamily: "monospace", fontSize: 13, padding: "11px 44px 11px 14px", boxSizing: "border-box", transition: "border-color 0.2s" }}
              />
              <button onClick={() => setShow(!show)} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: G.muted, fontSize: 13 }}>{show ? "🙈" : "👁"}</button>
            </div>
            {error && <div style={{ padding: "9px 12px", background: G.redBg, border: `1px solid ${G.redBorder}`, borderRadius: 8, color: G.red, fontSize: 12, marginBottom: 12 }}>{error}</div>}
            <button className="btn-submit" onClick={handleSubmit} disabled={!key.trim() || testing}
              style={{ width: "100%", padding: "14px", background: key.trim() && !testing ? G.gold : "#12151C", color: key.trim() && !testing ? "#080A0E" : G.subtle, border: "none", borderRadius: 10, fontFamily: "inherit", fontSize: 14, fontWeight: 500, cursor: key.trim() && !testing ? "pointer" : "not-allowed", transition: "all 0.2s", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              {testing ? <><span style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>⟳</span> Vérification...</> : <><svg width="13" height="11" viewBox="0 0 13 11" fill="none"><path d="M6.5 1 L12 10 L1 10 Z" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinejoin="round" /></svg> Démarrer avec Cime</>}
            </button>
          </div>

          <div style={{ textAlign: "center", marginTop: 16, fontFamily: "monospace", fontSize: 10, color: G.subtle, letterSpacing: "0.08em" }}>
            100% gratuit · Aucun compte Cime requis · Clé stockée localement
          </div>
        </div>
      </div>
      <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

// ── SETTINGS ──────────────────────────────────────────────────────
function SettingsScreen({ config, onSave, onBack, apiKey, onChangeKey }) {
  const [draft, setDraft] = useState({ ...config });
  const [saved, setSaved] = useState(false);
  const [activeTab, setActiveTab] = useState("analyse");
  const [showKey, setShowKey] = useState(false);
  const tabs = [
    { id: "analyse", label: "🔍 Analyse", desc: "Règles pour l'analyse match/gap" },
    { id: "generation", label: "✦ Génération CV", desc: "Règles pour créer le CV optimisé" },
    { id: "affinement", label: "💬 Chatbot", desc: "Règles pour l'affinement conversationnel" },
    { id: "ton", label: "🎨 Ton & Style", desc: "Style de communication de l'agent" },
  ];
  const presets = {
    analyse: [{ label: "Strict sur les gaps", text: "- Signaler tout écart critique avec explication\n- Ne pas minimiser les compétences manquantes" }, { label: "Prioriser l'expérience", text: "- Donner plus de poids à l'expérience terrain qu'aux certifications" }],
    generation: [{ label: "Ne jamais inventer", text: "- Ne jamais ajouter de compétences absentes du CV original\n- Si un gap est identifié, ne pas l'ajouter sans confirmation explicite" }, { label: "Maximiser ATS", text: "- Intégrer les mots-clés de l'offre dans les titres\n- Reformuler avec des verbes d'action forts" }],
    affinement: [{ label: "Toujours confirmer", text: "- Pour tout ajout de compétence absente, demander confirmation\n- Pour tout gap, proposer : ajouter, ignorer, ou reformuler" }, { label: "Mode coaching", text: "- Expliquer l'impact de chaque modification\n- Suggérer proactivement des améliorations" }],
    ton: [{ label: "Concis", text: "- Réponses courtes et directes\n- Pas de formules de politesse excessives" }, { label: "Coach bienveillant", text: "- Encourageant et positif\n- Explique le pourquoi de chaque suggestion" }],
  };
  const handleSave = () => { onSave(draft); setSaved(true); setTimeout(() => setSaved(false), 2000); };

  return (
    <div style={{ minHeight: "100vh", background: G.bg, fontFamily: "'DM Sans', sans-serif", color: G.text }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500&display=swap');textarea:focus{outline:none;border-color:#C9A96E!important}input:focus{outline:none;border-color:#C9A96E!important}.preset:hover{border-color:#C9A96E!important;color:#C9A96E!important}`}</style>
      <div style={{ background: G.surface, borderBottom: `1px solid ${G.border}`, padding: "12px 22px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <CimeLogo size="sm" />
          <div style={{ width: 1, height: 18, background: G.border }} />
          <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", color: G.muted, fontSize: 12, fontFamily: "inherit", padding: 0 }}>← Retour</button>
          <div style={{ width: 1, height: 18, background: G.border }} />
          <div style={{ fontSize: 14, fontWeight: 500 }}>⚙ Paramètres de l'agent</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setDraft({ ...DEFAULT_CONFIG })} style={{ padding: "7px 13px", borderRadius: 8, fontSize: 12, cursor: "pointer", border: `1px solid ${G.border2}`, background: "transparent", color: G.muted, fontFamily: "inherit" }}>↺ Réinitialiser</button>
          <button onClick={handleSave} style={{ padding: "7px 18px", borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: "pointer", border: "none", background: saved ? G.green : G.gold, color: "#080A0E", fontFamily: "inherit", transition: "background 0.3s", minWidth: 110 }}>{saved ? "✓ Sauvegardé !" : "Sauvegarder"}</button>
        </div>
      </div>

      <div style={{ maxWidth: 960, margin: "0 auto", padding: "22px 20px 60px" }}>

        {/* Groq key section */}
        <div style={{ background: G.surface, border: `1px solid ${G.border}`, borderRadius: 14, padding: "18px 22px", marginBottom: 20, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: G.groqBg, border: `1px solid ${G.groqBorder}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>⚡</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 2 }}>Clé API Groq active</div>
              <div style={{ fontFamily: "monospace", fontSize: 11, color: G.muted }}>{showKey ? apiKey : apiKey.slice(0,8) + "••••••••••••" + apiKey.slice(-4)}</div>
            </div>
            <button onClick={() => setShowKey(!showKey)} style={{ background: "none", border: "none", cursor: "pointer", color: G.muted, fontSize: 12 }}>{showKey ? "🙈" : "👁"}</button>
          </div>
          <button onClick={onChangeKey} style={{ padding: "7px 14px", borderRadius: 8, fontSize: 12, cursor: "pointer", border: `1px solid ${G.redBorder}`, background: G.redBg, color: G.red, fontFamily: "inherit" }}>Changer de clé</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {tabs.map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{ padding: "10px 12px", borderRadius: 10, background: activeTab === tab.id ? G.goldDim : "transparent", border: `1px solid ${activeTab === tab.id ? "rgba(201,169,110,0.25)" : G.border}`, cursor: "pointer", textAlign: "left", fontFamily: "inherit", transition: "all 0.15s" }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: activeTab === tab.id ? G.gold : G.text }}>{tab.label}</div>
                <div style={{ fontSize: 10, color: G.muted, marginTop: 2, lineHeight: 1.4 }}>{tab.desc}</div>
              </button>
            ))}
            <div style={{ marginTop: 8, padding: "11px 12px", background: G.surface, border: `1px solid ${G.border}`, borderRadius: 10 }}>
              <div style={{ fontFamily: "monospace", fontSize: 9, color: G.muted, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 5 }}>Aperçu prompt</div>
              <div style={{ fontFamily: "monospace", fontSize: 10, color: "#3A3D4A", lineHeight: 1.5, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical" }}>{draft[activeTab]?.slice(0, 130)}…</div>
            </div>
          </div>
          <div>
            <div style={{ background: G.surface, border: `1px solid ${G.border}`, borderRadius: 14, padding: 20 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                <div><div style={{ fontSize: 14, fontWeight: 500 }}>{tabs.find(t => t.id === activeTab)?.label}</div><div style={{ fontSize: 11, color: G.muted, marginTop: 1 }}>{tabs.find(t => t.id === activeTab)?.desc}</div></div>
                <span style={{ fontFamily: "monospace", fontSize: 10, padding: "2px 8px", background: G.goldDim, border: "1px solid rgba(201,169,110,0.15)", borderRadius: 6, color: G.gold }}>{draft[activeTab]?.split("\n").filter(l => l.trim()).length || 0} règles</span>
              </div>
              <textarea value={draft[activeTab] || ""} onChange={(e) => setDraft(prev => ({ ...prev, [activeTab]: e.target.value }))} placeholder={`Écrivez vos instructions...\n\nExemple:\n- Ne jamais inventer de compétences\n- Si un gap est identifié, demander confirmation`} style={{ width: "100%", minHeight: 240, background: "rgba(255,255,255,0.02)", border: `1px solid ${G.border}`, borderRadius: 10, color: G.text, fontFamily: "'DM Sans',sans-serif", fontSize: 13, lineHeight: 1.7, padding: "12px 14px", resize: "vertical", transition: "border-color 0.2s" }} />
              {presets[activeTab]?.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontFamily: "monospace", fontSize: 9, color: G.muted, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 6 }}>Suggestions</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{presets[activeTab].map((p, i) => <button key={i} className="preset" onClick={() => setDraft(prev => ({ ...prev, [activeTab]: prev[activeTab] ? prev[activeTab] + "\n" + p.text : p.text }))} style={{ padding: "4px 10px", borderRadius: 20, fontSize: 11, cursor: "pointer", border: `1px solid ${G.border2}`, background: "transparent", color: G.muted, fontFamily: "inherit", transition: "all 0.15s" }}>+ {p.label}</button>)}</div>
                </div>
              )}
            </div>
            <div style={{ marginTop: 10, background: "#07090C", border: `1px solid ${G.border}`, borderRadius: 10, padding: 14 }}>
              <div style={{ fontFamily: "monospace", fontSize: 9, color: G.muted, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 7 }}>Prompt injecté dans l'agent Groq</div>
              <pre style={{ fontFamily: "monospace", fontSize: 11, color: "#505870", lineHeight: 1.7, whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0 }}><span style={{ color: G.subtle }}>INSTRUCTIONS:</span>{"\n"}{draft[activeTab] || "(vide)"}</pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── SCREEN 1: Input ───────────────────────────────────────────────
function InputScreen({ onAnalyze, onSettings, error: globalError, onClearError }) {
  const [cvFile, setCvFile] = useState(null);
  const [cvText, setCvText] = useState("");
  const [jobDesc, setJobDesc] = useState(""); const [error, setError] = useState(""); const [dragging, setDragging] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const fileRef = useRef();
  const pdfJsReady = usePdfJs();

  const displayError = globalError || error;

  const readFile = useCallback(async (file) => {
    const ext = file.name.split(".").pop().toLowerCase();
    setExtracting(true);
    try {
      if (ext === "docx") { const buf = await file.arrayBuffer(); const { value } = await mammoth.extractRawText({ arrayBuffer: buf }); setCvText(value); }
      else if (ext === "pdf") {
        if (!pdfJsReady && !window.pdfjsLib) { await new Promise(r => setTimeout(r, 1500)); }
        const text = await extractPdfText(file);
        setCvText(text);
      }
      else { setCvText(await file.text()); }
      setCvFile(file); setError("");
    } catch (e) { setError("Erreur lecture: " + e.message); }
    setExtracting(false);
  }, [pdfJsReady]);

  const onDrop = useCallback(async (e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer?.files?.[0]; if (f) readFile(f); }, [readFile]);
  const canGo = !!cvText && jobDesc.trim().length > 20 && !extracting;

  return (
    <div style={{ minHeight: "100vh", background: G.bg, fontFamily: "'DM Sans', sans-serif", color: G.text }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Cormorant:ital,wght@0,300;0,400;1,300;1,400&family=DM+Sans:wght@300;400;500&display=swap');.dz:hover{border-color:#C9A96E!important;background:rgba(201,169,110,0.03)!important}.btn-go:hover:not(:disabled){background:#D4B47A!important}.jta:focus{border-color:#C9A96E!important;outline:none}`}</style>
      <div style={{ background: G.surface, borderBottom: `1px solid ${G.border}`, padding: "12px 26px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <CimeLogo size="sm" />
        <button onClick={onSettings} style={{ width: 32, height: 32, borderRadius: 8, background: "transparent", border: `1px solid ${G.border2}`, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, color: G.muted }}>⚙</button>
      </div>
      <div style={{ padding: "48px 20px 80px" }}>
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <div style={{ display: "inline-block", marginBottom: 20 }}>
            <svg width="62" height="52" viewBox="0 0 62 52" fill="none">
              <path d="M31 2 L60 50 L2 50 Z" stroke={G.gold} strokeWidth="1.5" fill="none" strokeLinejoin="round" />
              <path d="M31 2 L43 26 L19 26" stroke={G.gold} strokeWidth="0.7" opacity="0.2" />
              <circle cx="31" cy="2" r="2.5" fill={G.gold} />
              <path d="M19 50 L31 28 L43 50" stroke={G.goldLight} strokeWidth="1" fill="none" opacity="0.3" />
            </svg>
          </div>
          <CimeLogo size="lg" showTagline={true} />
          <p style={{ marginTop: 14, color: G.muted, fontSize: 14, lineHeight: 1.7, maxWidth: 480, marginLeft: "auto", marginRight: "auto" }}>Upload votre CV et l'offre d'emploi. L'agent Groq analyse les correspondances, génère un CV optimisé et vous accompagne jusqu'au sommet.</p>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", marginTop: 24 }}><StepIndicator current={0} /></div>
        </div>
        <div style={{ maxWidth: 860, margin: "0 auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
            <div style={{ background: G.surface, border: `1px solid ${G.border}`, borderRadius: 14, padding: 22 }}>
              <div style={{ fontFamily: "monospace", fontSize: 10, letterSpacing: "0.2em", color: G.gold, textTransform: "uppercase", marginBottom: 8 }}>Étape 01</div>
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 14 }}>Votre CV</div>
              {!cvFile ? (
                <div className="dz" onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop} onClick={() => fileRef.current?.click()} style={{ border: `1px dashed ${dragging ? G.gold : G.border2}`, borderRadius: 10, padding: "34px 20px", textAlign: "center", cursor: "pointer", background: "rgba(255,255,255,0.01)", transition: "all 0.2s" }}>
                  <div style={{ fontSize: 26, marginBottom: 10 }}>📄</div>
                  <div style={{ fontSize: 13, color: G.muted, lineHeight: 1.7 }}><span style={{ color: G.gold, fontWeight: 500 }}>Cliquez ou glissez</span><br />PDF · DOCX · TXT</div>
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", background: extracting ? G.amberBg : G.greenBg, border: `1px solid ${extracting ? G.amberBorder : G.greenBorder}`, borderRadius: 10, fontSize: 13, color: extracting ? G.amber : G.green }}>
                  <span>{extracting ? "⟳" : "✓"}</span>
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 }}>{extracting ? "Extraction du texte..." : cvFile.name}</span>
                  {!extracting && <button onClick={() => { setCvFile(null); setCvText(""); if (fileRef.current) fileRef.current.value = ""; }} style={{ background: "none", border: "none", cursor: "pointer", color: G.muted, fontSize: 18, padding: 0 }}>×</button>}
                </div>
              )}
              <input ref={fileRef} type="file" accept=".pdf,.docx,.txt" style={{ display: "none" }} onChange={(e) => { if (e.target.files?.[0]) readFile(e.target.files[0]); }} />
            </div>
            <div style={{ background: G.surface, border: `1px solid ${G.border}`, borderRadius: 14, padding: 22 }}>
              <div style={{ fontFamily: "monospace", fontSize: 10, letterSpacing: "0.2em", color: G.gold, textTransform: "uppercase", marginBottom: 8 }}>Étape 02</div>
              <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 14 }}>Offre d'emploi</div>
              <textarea className="jta" placeholder="Collez la description du poste : titre, responsabilités, compétences requises..." value={jobDesc} onChange={(e) => setJobDesc(e.target.value)} style={{ width: "100%", minHeight: 176, background: "rgba(255,255,255,0.02)", border: `1px solid ${G.border}`, borderRadius: 10, color: G.text, fontFamily: "inherit", fontSize: 13, lineHeight: 1.6, padding: "11px 13px", resize: "vertical", transition: "border-color 0.2s" }} />
              {jobDesc.length > 0 && <div style={{ marginTop: 5, textAlign: "right", fontFamily: "monospace", fontSize: 10, color: G.subtle }}>{jobDesc.trim().split(/\s+/).length} mots</div>}
            </div>
          </div>
          {displayError && (
            <div style={{ padding: "12px 16px", background: G.redBg, border: `1px solid ${G.redBorder}`, borderRadius: 10, color: G.red, fontSize: 13, marginBottom: 13, display: "flex", alignItems: "flex-start", gap: 10 }}>
              <span style={{ flexShrink: 0, marginTop: 1 }}>⚠</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500, marginBottom: 3 }}>Erreur</div>
                <div style={{ opacity: 0.9 }}>{displayError}</div>
                {displayError.includes("Failed to fetch") && (
                  <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
                    → Vérifiez que l'app est déployée sur Vercel (le proxy /api/groq est requis) et que votre clé API est valide.
                  </div>
                )}
                {displayError.includes("401") && (
                  <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
                    → Clé API invalide. <button onClick={() => { onClearError?.(); localStorage.removeItem("cime_groq_key"); window.location.reload(); }} style={{ background: "none", border: "none", cursor: "pointer", color: G.gold, fontFamily: "inherit", fontSize: 12, padding: 0, textDecoration: "underline" }}>Changer de clé</button>
                  </div>
                )}
              </div>
            </div>
          )}
          <button className="btn-go" onClick={() => onAnalyze(cvText, jobDesc)} disabled={!canGo} style={{ width: "100%", padding: "16px 24px", background: canGo ? G.gold : "#12151C", color: canGo ? "#080A0E" : G.subtle, border: "none", borderRadius: 10, fontFamily: "inherit", fontSize: 15, fontWeight: 500, cursor: canGo ? "pointer" : "not-allowed", transition: "all 0.2s", display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
            <svg width="13" height="11" viewBox="0 0 13 11" fill="none"><path d="M6.5 1 L12 10 L1 10 Z" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinejoin="round" /></svg>
            Analyser la correspondance
          </button>
        </div>
      </div>
    </div>
  );
}

// ── SCREEN 2: Analysis ────────────────────────────────────────────
function AnalysisScreen({ analysis, onBack, onGenerate, onSettings }) {
  const score = analysis.score || 0;
  const sc = score >= 70 ? G.green : score >= 50 ? G.amber : G.red;
  const scBg = score >= 70 ? G.greenBg : score >= 50 ? G.amberBg : G.redBg;
  const scBd = score >= 70 ? G.greenBorder : score >= 50 ? G.amberBorder : G.redBorder;
  const nC=(n)=>n==="critique"?G.red:n==="important"?G.amber:G.muted;
  const nBg=(n)=>n==="critique"?G.redBg:n==="important"?G.amberBg:"rgba(100,100,120,0.06)";
  const nBd=(n)=>n==="critique"?G.redBorder:n==="important"?G.amberBorder:G.border2;
  const nL=(n)=>n==="critique"?"Critique":n==="important"?"Important":"Mineur";
  return (
    <div style={{ minHeight: "100vh", background: G.bg, fontFamily: "'DM Sans', sans-serif", color: G.text }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500&display=swap');@keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}.btn-gen:hover{background:#D4B47A!important}`}</style>
      <Topbar title={analysis.nom_candidat} subtitle={analysis.titre_poste} step={1} onBack={onBack} backLabel="Modifier" onSettings={onSettings} />
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "26px 22px 80px", animation: "fadeUp 0.3s ease" }}>
        <div style={{ background: G.surface, border: `1px solid ${G.border}`, borderRadius: 14, padding: "24px 28px", marginBottom: 14, display: "flex", alignItems: "center", gap: 28, flexWrap: "wrap" }}>
          <div style={{ position: "relative", width: 92, height: 92, flexShrink: 0 }}>
            <svg width="92" height="92" viewBox="0 0 92 92"><circle cx="46" cy="46" r="38" fill="none" stroke={G.border2} strokeWidth="6" /><circle cx="46" cy="46" r="38" fill="none" stroke={sc} strokeWidth="6" strokeDasharray={`${2*Math.PI*38}`} strokeDashoffset={`${2*Math.PI*38*(1-score/100)}`} strokeLinecap="round" transform="rotate(-90 46 46)" /></svg>
            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}><div style={{ fontFamily: "Georgia,serif", fontSize: 24, fontWeight: 300, color: sc, lineHeight: 1 }}>{score}</div><div style={{ fontFamily: "monospace", fontSize: 8, color: G.muted }}>/ 100</div></div>
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 9, flexWrap: "wrap" }}>
              <div style={{ fontFamily: "Georgia,serif", fontSize: 19, fontWeight: 300 }}>Score de correspondance</div>
              <span style={{ padding: "2px 9px", background: scBg, border: `1px solid ${scBd}`, borderRadius: 20, fontSize: 11, color: sc, fontFamily: "monospace" }}>{score >= 70 ? "Bon match" : score >= 50 ? "Match partiel" : "Écarts importants"}</span>
            </div>
            <p style={{ fontSize: 13, lineHeight: 1.7, color: "#C8C4BC", margin: 0 }}>{analysis.resume}</p>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 13, marginBottom: 13 }}>
          <div style={{ background: G.surface, border: `1px solid ${G.border}`, borderRadius: 13, padding: 20 }}>
            <SectionLabel>✓ Points forts</SectionLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
              {(analysis.points_forts||[]).map((p,i)=>(
                <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <div style={{ width: 17, height: 17, borderRadius: "50%", background: G.greenBg, border: `1px solid ${G.greenBorder}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 2, fontSize: 9, color: G.green }}>✓</div>
                  <div><div style={{ fontSize: 13, fontWeight: 500, marginBottom: 2 }}>{p.titre}</div><div style={{ fontSize: 12, color: G.muted, lineHeight: 1.6 }}>{p.detail}</div></div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ background: G.surface, border: `1px solid ${G.border}`, borderRadius: 13, padding: 20 }}>
            <SectionLabel>⚠ Écarts à combler</SectionLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
              {(analysis.ecarts||[]).map((e,i)=>(
                <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <span style={{ padding: "2px 6px", background: nBg(e.niveau), border: `1px solid ${nBd(e.niveau)}`, borderRadius: 4, fontSize: 9, color: nC(e.niveau), fontFamily: "monospace", textTransform: "uppercase", whiteSpace: "nowrap", flexShrink: 0, marginTop: 2 }}>{nL(e.niveau)}</span>
                  <div><div style={{ fontSize: 13, fontWeight: 500, marginBottom: 2 }}>{e.titre}</div><div style={{ fontSize: 12, color: G.muted, lineHeight: 1.6 }}>{e.detail}</div></div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div style={{ background: G.surface, border: `1px solid ${G.border}`, borderRadius: 13, padding: 20, marginBottom: 16 }}>
          <SectionLabel>Recommandations Cime</SectionLabel>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9 }}>
            {(analysis.recommandations||[]).map((r,i)=>(
              <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 12px", background: "rgba(201,169,110,0.03)", border: `1px solid ${G.border}`, borderRadius: 9 }}>
                <div style={{ width: 18, height: 18, borderRadius: "50%", background: G.goldDim, border: "1px solid rgba(201,169,110,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "monospace", fontSize: 9, color: G.gold, flexShrink: 0, marginTop: 1 }}>{i+1}</div>
                <div style={{ fontSize: 12, color: "#C8C4BC", lineHeight: 1.6 }}>{r}</div>
              </div>
            ))}
          </div>
        </div>
        <button className="btn-gen" onClick={onGenerate} style={{ width: "100%", padding: "16px 24px", background: G.gold, color: "#080A0E", border: "none", borderRadius: 10, fontFamily: "inherit", fontSize: 15, fontWeight: 500, cursor: "pointer", transition: "all 0.2s", display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
          <svg width="13" height="11" viewBox="0 0 13 11" fill="none"><path d="M6.5 1 L12 10 L1 10 Z" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinejoin="round" /></svg>
          Générer le CV optimisé avec Cime
        </button>
      </div>
    </div>
  );
}

// ── SCREEN 3: Result ──────────────────────────────────────────────
function ResultScreen({ cvData, onBack, onRefine, pdfReady, onSettings }) {
  return (
    <div style={{ minHeight: "100vh", background: G.bg, fontFamily: "'DM Sans', sans-serif", color: G.text }}>
      <style>{`@keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}.btn-ref:hover{background:#D4B47A!important}`}</style>
      <Topbar title={cvData.nom} subtitle={cvData.titre} step={2} onBack={onBack} backLabel="Analyse" onSettings={onSettings}><ExportButtons cvData={cvData} pdfReady={pdfReady} /></Topbar>
      <div style={{ maxWidth: 880, margin: "0 auto", padding: "24px 22px 80px", animation: "fadeUp 0.3s ease" }}>
        <CVPreview cvData={cvData} />
        {(cvData.notes||[]).length > 0 && (
          <div style={{ marginTop: 13, background: G.surface, border: `1px solid ${G.border}`, borderRadius: 13, padding: 18 }}>
            <SectionLabel>💡 Changements appliqués par Cime</SectionLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {cvData.notes.map((n,i)=>(
                <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                  <div style={{ width: 18, height: 18, borderRadius: "50%", background: G.goldDim, border: "1px solid rgba(201,169,110,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "monospace", fontSize: 9, color: G.gold, flexShrink: 0 }}>{i+1}</div>
                  <div style={{ fontSize: 13, lineHeight: 1.7, color: "#C8C4BC", paddingTop: 1 }}>{n}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        <button className="btn-ref" onClick={onRefine} style={{ width: "100%", marginTop: 13, padding: "16px 24px", background: G.gold, color: "#080A0E", border: "none", borderRadius: 10, fontFamily: "inherit", fontSize: 15, fontWeight: 500, cursor: "pointer", transition: "all 0.2s", display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
          💬 Affiner avec l'agent Cime
        </button>
      </div>
    </div>
  );
}

// ── SCREEN 4: Chatbot ─────────────────────────────────────────────
function RefineScreen({ cvData: initialCv, onBack, pdfReady, onSettings, config, apiKey }) {
  const [cvData, setCvData] = useState(initialCv);
  const [messages, setMessages] = useState([{ role: "assistant", text: `Bonjour ! L'agent Cime est prêt à affiner votre CV.\n\n• **Contenu** — reformuler, renforcer le profil, ajuster les réalisations\n• **Compétences** — si une compétence manque, je vous demanderai confirmation\n• **Mise en forme** — raccourcir, réorganiser, changer le ton\n\nQue souhaitez-vous modifier ?`, type: "assistant" }]);
  const [input, setInput] = useState(""); const [thinking, setThinking] = useState(false); const [showPreview, setShowPreview] = useState(true);
  const messagesEndRef = useRef(); const textareaRef = useRef();
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const send = async (text) => {
    const t = (text || input).trim(); if (!t || thinking) return;
    setInput("");
    setMessages(prev => [...prev, { role: "user", text: t }]);
    setThinking(true);
    try {
      const result = await callGroq(apiKey, buildRefineSystem(config), `CV actuel:\n${JSON.stringify(cvData, null, 2)}\n\nDemande: ${t}`);
      if (result.action === "confirm") {
        setCvData(result.cv || cvData);
        setMessages(prev => [...prev, { role: "confirm", question: result.question, options: result.options || ["Oui, l'ajouter", "Non, ignorer"] }]);
      } else {
        setCvData(result.cv || result);
        setMessages(prev => [...prev, { role: "assistant", text: `✓ ${result.explication || "Modification appliquée."}`, type: "update" }]);
      }
    } catch (e) { setMessages(prev => [...prev, { role: "assistant", text: `Erreur : ${e.message}`, type: "error" }]); }
    setThinking(false);
  };

  const suggestions = ["Raccourcis les descriptions", "Renforce le profil", "Ajoute des mots-clés ATS", "Rends le ton plus dynamique", "Quantifie les réalisations"];
  const formatText = (text) => text.split("\n").map((line, i) => { const html = line.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>"); return <div key={i} style={{ marginBottom: line === "" ? 5 : 1 }} dangerouslySetInnerHTML={{ __html: html || "&nbsp;" }} />; });

  return (
    <div style={{ height: "100vh", background: G.bg, fontFamily: "'DM Sans', sans-serif", color: G.text, display: "flex", flexDirection: "column" }}>
      <style>{`@keyframes fadeUp{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}.sug:hover{border-color:#C9A96E!important;color:#C9A96E!important}.send:hover:not(:disabled){background:#D4B47A!important}textarea:focus{outline:none}::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:#1E2230;border-radius:2px}@keyframes bounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-5px)}}`}</style>
      <Topbar title={cvData.nom} subtitle={cvData.titre} step={3} onBack={onBack} backLabel="CV" onSettings={onSettings}>
        <button onClick={() => setShowPreview(!showPreview)} style={{ padding: "5px 11px", borderRadius: 8, fontSize: 11, cursor: "pointer", border: `1px solid ${showPreview ? G.gold : G.border2}`, background: showPreview ? G.goldDim : "transparent", color: showPreview ? G.gold : G.muted, fontFamily: "inherit", transition: "all 0.15s" }}>👁 {showPreview ? "Masquer" : "Voir CV"}</button>
        <ExportButtons cvData={cvData} pdfReady={pdfReady} />
      </Topbar>
      <div style={{ flex: 1, display: "grid", gridTemplateColumns: showPreview ? "1fr 1fr" : "1fr", overflow: "hidden" }}>
        <div style={{ display: "flex", flexDirection: "column", overflow: "hidden", borderRight: showPreview ? `1px solid ${G.border}` : "none" }}>
          <div style={{ flex: 1, overflowY: "auto", padding: "16px 15px 0" }}>
            {messages.map((msg, i) => (
              <div key={i} style={{ marginBottom: 12, display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start", animation: "fadeUp 0.2s ease" }}>
                {(msg.role === "assistant" || msg.role === "confirm") && (
                  <div style={{ width: 24, height: 24, borderRadius: "50%", background: G.goldDim, border: "1px solid rgba(201,169,110,0.2)", display: "flex", alignItems: "center", justifyContent: "center", marginRight: 7, flexShrink: 0, marginTop: 2 }}>
                    <svg width="9" height="8" viewBox="0 0 9 8" fill="none"><path d="M4.5 0.5 L8.5 7.5 L0.5 7.5 Z" stroke={G.gold} strokeWidth="1.2" fill="none" strokeLinejoin="round" /></svg>
                  </div>
                )}
                <div style={{ maxWidth: "78%" }}>
                  {msg.role === "confirm" ? (
                    <div style={{ background: G.surface, border: `1px solid ${G.amberBorder}`, borderRadius: "12px 12px 12px 3px", padding: "12px 14px" }}>
                      <div style={{ fontSize: 13, color: G.amber, marginBottom: 10, lineHeight: 1.6 }}>⚠ {msg.question}</div>
                      <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>{(msg.options||[]).map((opt,j)=><button key={j} onClick={()=>send(opt)} style={{ padding: "5px 12px", borderRadius: 8, fontSize: 12, cursor: "pointer", border: `1px solid ${j===0?G.gold:G.border2}`, background: j===0?G.goldDim:"transparent", color: j===0?G.gold:G.muted, fontFamily: "inherit", fontWeight: j===0?500:400 }}>{opt}</button>)}</div>
                    </div>
                  ) : (
                    <div style={{ padding: "10px 13px", borderRadius: msg.role==="user"?"12px 12px 3px 12px":"12px 12px 12px 3px", background: msg.role==="user"?G.gold:msg.type==="update"?"rgba(93,184,138,0.07)":msg.type==="error"?G.redBg:G.surface, border: msg.role==="user"?"none":`1px solid ${msg.type==="update"?G.greenBorder:msg.type==="error"?G.redBorder:G.border}`, color: msg.role==="user"?"#080A0E":msg.type==="update"?G.green:msg.type==="error"?G.red:"#C8C4BC", fontSize: 13, lineHeight: 1.7 }}>{formatText(msg.text)}</div>
                  )}
                </div>
              </div>
            ))}
            {thinking && (
              <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 7 }}>
                <div style={{ width: 24, height: 24, borderRadius: "50%", background: G.goldDim, border: "1px solid rgba(201,169,110,0.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <svg width="9" height="8" viewBox="0 0 9 8" fill="none"><path d="M4.5 0.5 L8.5 7.5 L0.5 7.5 Z" stroke={G.gold} strokeWidth="1.2" fill="none" strokeLinejoin="round" /></svg>
                </div>
                <div style={{ background: G.surface, border: `1px solid ${G.border}`, borderRadius: "12px 12px 12px 3px", padding: "10px 14px", display: "flex", gap: 5 }}>
                  {[0,1,2].map(d=><div key={d} style={{ width: 5, height: 5, borderRadius: "50%", background: G.gold, animation: `bounce 1.2s ease-in-out ${d*0.2}s infinite` }} />)}
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
          {messages.length <= 1 && <div style={{ padding: "7px 15px 0", display: "flex", flexWrap: "wrap", gap: 5 }}>{suggestions.map((s,i)=><button key={i} className="sug" onClick={()=>send(s)} style={{ padding: "4px 10px", borderRadius: 20, fontSize: 11, cursor: "pointer", border: `1px solid ${G.border2}`, background: "transparent", color: G.muted, fontFamily: "inherit", transition: "all 0.15s" }}>{s}</button>)}</div>}
          <div style={{ padding: "10px 15px 12px" }}>
            <div style={{ display: "flex", gap: 7, background: G.surface, border: `1px solid ${G.border2}`, borderRadius: 11, padding: "7px 7px 7px 12px", alignItems: "flex-end" }}>
              <textarea ref={textareaRef} value={input} onChange={(e)=>{setInput(e.target.value);e.target.style.height="auto";e.target.style.height=Math.min(e.target.scrollHeight,100)+"px";}} onKeyDown={(e)=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();}}} placeholder="Demandez un ajustement… (Entrée pour envoyer)" rows={1} style={{ flex:1,background:"transparent",border:"none",color:G.text,fontFamily:"inherit",fontSize:13,lineHeight:1.6,resize:"none",maxHeight:100,overflowY:"auto",padding:"3px 0" }} />
              <button className="send" onClick={()=>send()} disabled={!input.trim()||thinking} style={{ width:32,height:32,borderRadius:8,background:input.trim()&&!thinking?G.gold:G.border,border:"none",cursor:input.trim()&&!thinking?"pointer":"not-allowed",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,transition:"all 0.15s" }}>
                <svg width="11" height="10" viewBox="0 0 11 10" fill="none"><path d="M1 5 L10 5 M6 1 L10 5 L6 9" stroke={input.trim()&&!thinking?"#080A0E":G.subtle} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            </div>
            <div style={{ fontFamily: "monospace", fontSize: 9, color: G.subtle, textAlign: "center", marginTop: 4 }}>Shift+Entrée pour nouvelle ligne</div>
          </div>
        </div>
        {showPreview && <div style={{ overflowY: "auto", padding: "14px" }}><CVPreview cvData={cvData} /></div>}
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────
export default function App() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("cime_groq_key") || "");
  const [screen, setScreen] = useState("input");
  const [prevScreen, setPrevScreen] = useState("input");
  const [cvText, setCvText] = useState("");
  const [jobDesc, setJobDesc] = useState("");
  const [analysis, setAnalysis] = useState(null);
  const [cvData, setCvData] = useState(null);
  const [config, setConfig] = useState({ ...DEFAULT_CONFIG });
  const [globalError, setGlobalError] = useState("");
  const pdfReady = usePdfLibs();

  const handleKeySubmit = (key) => {
    localStorage.setItem("cime_groq_key", key);
    setApiKey(key);
  };
  const handleChangeKey = () => {
    localStorage.removeItem("cime_groq_key");
    setApiKey("");
    setScreen("input");
  };
  const goSettings = () => { setPrevScreen(screen); setScreen("settings"); };

  const handleAnalyze = async (cv, job) => {
    setCvText(cv); setJobDesc(job);
    setGlobalError("");
    setScreen("analyzing");
    try {
      const result = await callGroq(apiKey, buildAnalysisSystem(config), `CV:\n\n${cv}\n\n---\n\nOffre d'emploi:\n\n${job}\n\nRetourne UNIQUEMENT le JSON.`);
      setAnalysis(result);
      setScreen("analysis");
    } catch (e) {
      setGlobalError(e.message || "Erreur lors de l'analyse. Vérifiez votre clé API.");
      setScreen("input");
    }
  };

  const handleGenerate = async () => {
    setGlobalError("");
    setScreen("generating");
    try {
      const ctx = `Analyse (score ${analysis.score}/100) — Forts: ${(analysis.points_forts||[]).map(p=>p.titre).join(", ")} — Gaps: ${(analysis.ecarts||[]).map(e=>`${e.titre}(${e.niveau})`).join(", ")}`;
      const result = await callGroq(apiKey, buildCVSystem(config), `CV:\n\n${cvText}\n\n---\n\nOffre:\n\n${jobDesc}\n\n${ctx}\n\nRetourne UNIQUEMENT le JSON.`);
      setCvData(result);
      setScreen("result");
    } catch (e) {
      setGlobalError(e.message || "Erreur lors de la génération.");
      setScreen("analysis");
    }
  };

  if (!apiKey) return <OnboardingScreen onKeySubmit={handleKeySubmit} />;
  if (screen === "analyzing") return <LoadingScreen message="Analyse en cours…" />;
  if (screen === "generating") return <LoadingScreen message="Génération du CV…" />;
  if (screen === "settings") return <SettingsScreen config={config} onSave={setConfig} onBack={() => setScreen(prevScreen)} apiKey={apiKey} onChangeKey={handleChangeKey} />;
  if (screen === "analysis" && analysis) return <AnalysisScreen analysis={analysis} onBack={() => setScreen("input")} onGenerate={handleGenerate} onSettings={goSettings} error={globalError} />;
  if (screen === "result" && cvData) return <ResultScreen cvData={cvData} onBack={() => setScreen("analysis")} onRefine={() => setScreen("refine")} pdfReady={pdfReady} onSettings={goSettings} />;
  if (screen === "refine" && cvData) return <RefineScreen cvData={cvData} onBack={() => setScreen("result")} pdfReady={pdfReady} onSettings={goSettings} config={config} apiKey={apiKey} />;
  return <InputScreen onAnalyze={handleAnalyze} onSettings={goSettings} error={globalError} onClearError={() => setGlobalError("")} />;
}
