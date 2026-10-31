// src/GeminiService.ts
// Appelle l'API Gemma / Gemini via le SDK officiel @google/genai (ou Groq si configuré).
// La clé et le modèle viennent de l'environnement, jamais du code en dur.

import { GoogleGenAI } from '@google/genai';

export interface ImageAttachment {
  mime: string;
  data: Buffer;
}

export class GeminiService {
  private fournisseur: string;
  private cleGoogle: string;
  private cleGroq: string;
  private modeleGoogle: string;
  private modeleGroq: string;
  private ai: GoogleGenAI | null = null;

  constructor() {
    this.fournisseur = process.env.LLM_PROVIDER || 'google';
    this.cleGoogle = process.env.GEMINI_API_KEY || '';
    this.cleGroq = process.env.GROQ_API_KEY || '';
    // Modèle Gemma officiel recommandé pour le hackathon Build with Gemma
    this.modeleGoogle = process.env.GEMMA_MODEL || 'gemma-4-26b-a4b-it';
    this.modeleGroq = process.env.GROQ_MODEL || 'gemma2-9b-it';

    if (this.cleGoogle) {
      this.ai = new GoogleGenAI({
        apiKey: this.cleGoogle,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });
    }
  }

  /**
   * Envoie une consigne (et une image facultative) à Gemma.
   * Retourne le texte de la réponse, ou null si l'appel a échoué.
   */
  public async generer(consigne: string, image?: ImageAttachment | null): Promise<string | null> {
    if (this.fournisseur === 'groq') {
      return this.appelerGroq(consigne);
    }
    return this.appelerGoogle(consigne, image);
  }

  /**
   * Comme generer(), mais décode et extrait un objet JSON propre.
   * Retourne null si ce n'est pas du JSON valide.
   */
  public async genererJson<T = any>(consigne: string, image?: ImageAttachment | null): Promise<T | null> {
    const texte = await this.generer(consigne, image);
    if (!texte) {
      return null;
    }
    return this.extraireJson<T>(texte);
  }

  private async appelerGoogle(consigne: string, image?: ImageAttachment | null): Promise<string | null> {
    if (!this.ai) {
      return null;
    }

    // Essai principal avec le modèle Gemma configuré
    const modeles = [this.modeleGoogle, 'gemini-3.8-flash'];

    for (const modele of modeles) {
      try {
        const parts: any[] = [];
        if (image && image.data) {
          parts.push({
            inlineData: {
              mimeType: image.mime,
              data: image.data.toString('base64'),
            },
          });
        }
        parts.push({ text: consigne });

        const response = await this.ai.models.generateContent({
          model: modele,
          contents: parts.length === 1 ? parts[0].text : { parts },
        });

        const texte = response.text;
        if (texte && texte.trim()) {
          return this.nettoyerTexteGemma(texte);
        }
      } catch (err: any) {
        console.warn(`[GeminiService] Échec modèle ${modele}:`, err?.message || err);
      }
    }

    return null;
  }

  private async appelerGroq(consigne: string): Promise<string | null> {
    if (!this.cleGroq) {
      return null;
    }

    try {
      const reponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.cleGroq}`,
        },
        body: JSON.stringify({
          model: this.modeleGroq,
          temperature: 0.2,
          messages: [{ role: 'user', content: consigne }],
        }),
        signal: AbortSignal.timeout(25000),
      });

      if (!reponse.ok) {
        return null;
      }

      const donnees: any = await reponse.json();
      const brut = donnees?.choices?.[0]?.message?.content ?? null;
      return brut ? this.nettoyerTexteGemma(brut) : null;
    } catch {
      return null;
    }
  }

  /**
   * Extrait un objet JSON depuis une réponse pouvant contenir du Markdown (```json ... ```)
   * ou des réflexions du modèle Gemma.
   */
  private extraireJson<T = any>(texte: string): T | null {
    // 1. Essai direct
    try {
      return JSON.parse(texte.trim()) as T;
    } catch {}

    // 2. Bloc de code ```json ... ``` ou ``` ... ```
    const codeBlockMatch = texte.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) {
      try {
        return JSON.parse(codeBlockMatch[1].trim()) as T;
      } catch {}
    }

    // 3. Recherche du bloc JSON {...} le plus profond ou le plus récent
    const lastClose = texte.lastIndexOf('}');
    if (lastClose !== -1) {
      for (let i = texte.lastIndexOf('{', lastClose); i >= 0; i = texte.lastIndexOf('{', i - 1)) {
        try {
          const candidate = texte.slice(i, lastClose + 1);
          return JSON.parse(candidate) as T;
        } catch {}
      }
    }

    // 4. Premier bloc {...}
    const match = texte.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]) as T;
      } catch {}
    }

    return null;
  }

  /**
   * Si Gemma produit des notes de réflexion préliminaires (ex: * Input: ...),
   * extrait la partie finale de la réponse.
   */
  private nettoyerTexteGemma(texte: string): string {
    const t = texte.trim();
    // Si la réponse contient un bloc de code markdown, on le garde
    if (t.includes('```')) {
      return t;
    }
    // Si la réponse commence par des puces de réflexion Chain-of-Thought
    if (t.startsWith('* Input:') || t.startsWith('* Goal:') || t.startsWith('* Constraint:')) {
      const parts = t.split(/\n(?=[A-ZÀ-Ö0-9])/);
      if (parts.length > 1) {
        return parts[parts.length - 1].trim();
      }
    }
    return t;
  }
}
