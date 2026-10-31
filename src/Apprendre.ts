// src/Apprendre.ts
// Mode apprentissage : commandes /apprendre, /resume, /plan, /quiz, /reponse, /stop.
// Le cours, la question en cours et le score sont gardés dans la session.

import { GeminiService, ImageAttachment } from './GeminiService';

export interface ApprendreResponse {
  type: 'texte';
  mode: 'apprendre' | 'scanner';
  texte: string;
}

export class Apprendre {
  private gemini: GeminiService;

  constructor(gemini: GeminiService) {
    this.gemini = gemini;
  }

  /** Retourne { type: 'texte', mode: 'apprendre' | 'scanner', texte: '...' } */
  public async executer(
    message: string,
    image: ImageAttachment | null | undefined,
    session: any
  ): Promise<ApprendreResponse> {
    message = (message || '').trim();
    const espace = message.indexOf(' ');
    const cmd = espace === -1 ? message : message.slice(0, espace);
    const reste = espace === -1 ? '' : message.slice(espace + 1).trim();

    switch (cmd.toLowerCase()) {
      case '/apprendre':
        return this.cmdApprendre(reste, image, session);
      case '/resume':
        return this.cmdResume(session);
      case '/plan':
        return this.cmdPlan(reste, session);
      case '/quiz':
        return this.cmdQuiz(session);
      case '/reponse':
        return this.cmdReponse(reste, session);
      case '/stop':
        return this.cmdStop(session);
      default:
        return this.aide();
    }
  }

  // ---------- Commandes ----------
  private async cmdApprendre(
    reste: string,
    image: ImageAttachment | null | undefined,
    session: any
  ): Promise<ApprendreResponse> {
    let cours = reste;

    if (image && image.data) {
      const transcription = await this.gemini.generer(
        "Transcris ce document de cours en texte brut, fidèlement, en français. Réponds uniquement avec le texte transcrit.",
        image
      );
      if (transcription && transcription.trim() !== '') {
        cours = transcription.trim();
      } else if (!cours) {
        return this.texte(
          'apprendre',
          "Je n'ai pas pu lire la photo. Colle le texte du cours après /apprendre, ou réessaie avec une image plus nette."
        );
      }
    }

    if (!cours) {
      if (!session.fs_cours) {
        return this.texte(
          'apprendre',
          "Mode apprentissage activé.\n\nEnvoie ton cours avec : /apprendre suivi du texte de ton cours (ou joins une photo).\n\nAutres commandes : /resume, /plan [jours], /quiz, /reponse ..., /stop"
        );
      }
      return this.texte(
        'apprendre',
        `Ton cours est déjà enregistré (${this.tailleCours(session.fs_cours)}).\nTu peux le remplacer avec /apprendre [nouveau cours], ou continuer avec /resume, /plan ou /quiz.`
      );
    }

    if (cours.length > 20000) {
      cours = cours.slice(0, 20000);
    }
    session.fs_cours = cours;
    session.fs_question = null;
    session.fs_attendu = null;

    return this.texte(
      'apprendre',
      `Cours enregistré (${this.tailleCours(cours)}) ! Que veux-tu faire maintenant ?\n/resume pour un résumé\n/plan 5 pour un programme de révision\n/quiz pour t'entraîner`
    );
  }

  private async cmdResume(session: any): Promise<ApprendreResponse> {
    const cours = session.fs_cours || '';
    if (!cours) {
      return this.texte(
        'apprendre',
        "Envoie d'abord ton cours avec : /apprendre suivi du texte de ton cours (ou joins une photo)."
      );
    }

    const consigne = `Voici un cours. Fais-en un résumé en 5 points courts maximum, puis liste 5 mots clés.\n\nCOURS :\n"""\n${cours}\n"""\n\nRéponds en français simple, avec des puces.`;
    let resume = await this.gemini.generer(consigne);

    if (!resume) {
      // Résumé de secours sans Gemma : premières phrases + mots fréquents
      const phrases = cours.split(/(?<=[.!?])\s+/);
      const points = phrases.map((p: string) => p.trim()).filter((p: string) => p.length > 0).slice(0, 4);
      const mots = this.motsCles(cours, 5);
      resume = `Résumé automatique (Gemma n'a pas répondu) :\n${points.map((p: string) => `• ${p}`).join('\n')}\n\nMots clés : ${mots.join(', ')}`;
    }

    return this.texte('apprendre', resume);
  }

  private async cmdPlan(reste: string, session: any): Promise<ApprendreResponse> {
    const cours = session.fs_cours || '';
    if (!cours) {
      return this.texte('apprendre', "Envoie d'abord ton cours avec /apprendre, puis demande un plan.");
    }

    const jours = Math.max(1, Math.min(14, parseInt(reste, 10) || 3));
    const consigne = `Voici un cours. Crée un programme de révision sur ${jours} jours, un point par jour, adapté à un étudiant togolais. Réponds en français simple, sous la forme :\nJour 1 : ...\nJour 2 : ...\n\nCOURS :\n"""\n${cours}\n"""`;

    let plan = await this.gemini.generer(consigne);

    if (!plan) {
      const lignes: string[] = ["Plan de secours (Gemma n'a pas répondu) :"];
      for (let i = 1; i <= jours; i++) {
        let action = "Résume le cours de mémoire, puis compare avec le résumé.";
        if (i === 1) action = "Relis tout le cours une première fois.";
        else if (i === jours) action = "Refais le quiz et révise tes erreurs.";
        else if (i % 2 === 0) action = "Révise les points clés vus la veille.";
        lignes.push(`Jour ${i} : ${action}`);
      }
      lignes.push(`\nRéessaie /plan ${jours} quand la connexion revient pour un plan adapté à ton cours.`);
      plan = lignes.join('\n');
    }

    return this.texte('apprendre', plan);
  }

  private async cmdQuiz(session: any): Promise<ApprendreResponse> {
    const cours = session.fs_cours || '';
    if (!cours) {
      return this.texte('apprendre', "Envoie d'abord ton cours avec /apprendre, puis lance le quiz.");
    }

    const consigne = `Voici un cours. Pose UNE question de compréhension dessus, niveau lycée.\nRéponds UNIQUEMENT en JSON valide : {"question":"...","reponse":"réponse attendue courte"}\n\nCOURS :\n"""\n${cours.slice(0, 6000)}\n"""`;
    const q: any = await this.gemini.genererJson(consigne);

    if (!q || !q.question) {
      return this.texte('apprendre', "Je n'ai pas réussi à créer une question. Réessaie /quiz dans un instant.");
    }

    session.fs_question = String(q.question).trim();
    session.fs_attendu = String(q.reponse || '').trim();

    return this.texte(
      'apprendre',
      `Question : ${session.fs_question}\n\nRéponds avec /reponse suivi de ta réponse.`
    );
  }

  private async cmdReponse(reste: string, session: any): Promise<ApprendreResponse> {
    const question = session.fs_question || '';
    if (!question || !reste) {
      return this.texte(
        'apprendre',
        "Lance d'abord une question avec /quiz, puis réponds avec /reponse suivi de ta réponse."
      );
    }

    const attendu = String(session.fs_attendu || '');
    session.fs_total = (session.fs_total || 0) + 1;

    let correct = false;
    let explication = '';

    const consigne = `Question : ${question}\nRéponse attendue : ${attendu}\nRéponse de l'étudiant : ${reste}\n\nJuge si la réponse de l'étudiant est correcte ou équivalente.\nRéponds UNIQUEMENT en JSON : {"correct":true|false,"explication":"une phrase courte en français simple"}`;
    const juge: any = await this.gemini.genererJson(consigne);

    if (juge) {
      correct = Boolean(juge.correct);
      explication = String(juge.explication || '').trim();
    } else {
      const lowerReste = reste.toLowerCase();
      const lowerAttendu = attendu.toLowerCase();
      correct = lowerReste.includes(lowerAttendu) || lowerAttendu.includes(lowerReste);
      explication = correct
        ? `Réponse proche de la réponse attendue : ${attendu}`
        : `Réponse attendue : ${attendu}`;
    }

    if (correct) {
      session.fs_score = (session.fs_score || 0) + 1;
    }

    const score = session.fs_score || 0;
    const total = session.fs_total || 0;

    session.fs_question = null;
    session.fs_attendu = null;

    const texte =
      (correct ? "Correct ! " : "Pas tout à fait. ") +
      explication +
      `\nScore : ${score} / ${total}.` +
      "\nTape /quiz pour une nouvelle question, ou /stop pour revenir au scanner.";

    return this.texte('apprendre', texte);
  }

  private cmdStop(session: any): ApprendreResponse {
    delete session.fs_cours;
    delete session.fs_question;
    delete session.fs_attendu;
    return this.texte(
      'scanner',
      "Mode apprentissage arrêté. Je reviens au scanner d'arnaques. Colle un SMS ou une capture pour l'analyser."
    );
  }

  private aide(): ApprendreResponse {
    return this.texte(
      'apprendre',
      "Commande inconnue. Voici les commandes disponibles :\n/apprendre [cours] - envoie ton cours (texte ou photo)\n/resume - résume le cours\n/plan [jours] - programme de révision\n/quiz - pose une question\n/reponse ... - réponds à la question\n/stop - revient au scanner"
    );
  }

  // ---------- Outils ----------
  private tailleCours(cours: string): string {
    const n = (cours || '').length;
    return n > 1000 ? `${(n / 1000).toFixed(1)} mille caractères` : `${n} caractères`;
  }

  private motsCles(texte: string, max: number): string[] {
    const stop = new Set([
      'dans', 'pour', 'avec', 'cette', 'comme', 'entre', 'leurs', 'mais',
      'plus', 'être', 'avoir', 'fait', 'faut', 'leur', 'elles', 'cours',
      'sont', 'faire', 'aussi'
    ]);
    const words = (texte.toLowerCase().match(/[\p{L}]{5,}/gu) || []);
    const freq: Record<string, number> = {};
    for (const w of words) {
      if (!stop.has(w)) {
        freq[w] = (freq[w] || 0) + 1;
      }
    }
    return Object.keys(freq)
      .sort((a, b) => freq[b] - freq[a])
      .slice(0, max);
  }

  private texte(mode: 'apprendre' | 'scanner', texte: string): ApprendreResponse {
    return { type: 'texte', mode, texte };
  }
}
