import express from 'express';
import session from 'express-session';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

import { GeminiService } from './src/GeminiService';
import { Scanner } from './src/Scanner';
import { Apprendre } from './src/Apprendre';

dotenv.config({ override: true });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;
const HOST = '0.0.0.0';

// Configuration du moteur de vues EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Fichiers statiques (assets, CSS, images)
app.use(express.static(path.join(__dirname, 'public')));
app.use('/assets', express.static(path.join(__dirname, 'public/assets')));

// Décodage des requêtes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Sessions utilisateur en mémoire (pour le mode apprentissage)
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'fraude-scanner-session-secret',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 },
  })
);

// Upload d'images en mémoire (max 4 Mo)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 },
});

// Services métier
const gemini = new GeminiService();
const scanner = new Scanner(gemini, __dirname);
const apprendre = new Apprendre(gemini);

// ---------- Pages du site ----------
const renderIndex = (_req: express.Request, res: express.Response) => res.render('index');
app.get('/', renderIndex);
app.get('/index.php', renderIndex);

const renderScanner = (_req: express.Request, res: express.Response) => res.render('scanner');
app.get('/scanner', renderScanner);
app.get('/scanner.php', renderScanner);

const renderCommentCaMarche = (_req: express.Request, res: express.Response) => res.render('comment-ca-marche');
app.get('/comment-ca-marche', renderCommentCaMarche);
app.get('/comment-ca-marche.php', renderCommentCaMarche);

const renderDocumentation = (_req: express.Request, res: express.Response) => res.render('documentation');
app.get('/documentation', renderDocumentation);
app.get('/documentation.php', renderDocumentation);

const renderAPropos = (_req: express.Request, res: express.Response) => res.render('a-propos');
app.get('/a-propos', renderAPropos);
app.get('/a-propos.php', renderAPropos);

// ---------- API Supabase Config ----------
const handleSupabaseConfig = (_req: express.Request, res: express.Response) => {
  res.setHeader('Cache-Control', 'no-store');
  const url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || '';

  if (!url || !publishableKey || !url.startsWith('https://')) {
    return res.status(503).json({ error: 'Configuration Supabase manquante dans .env.' });
  }

  return res.json({ url, publishableKey });
};

app.get('/api/supabase-config', handleSupabaseConfig);
app.get('/api/supabase-config.php', handleSupabaseConfig);

// ---------- API Analyser (chat scanner et apprentissage) ----------
const handleAnalyser = async (req: express.Request, res: express.Response) => {
  try {
    const message = ((req.body?.message || '') as string).trim();
    let image: { mime: string; data: Buffer } | null = null;

    if (req.file) {
      const autorise = ['image/jpeg', 'image/png', 'image/webp'];
      if (!autorise.includes(req.file.mimetype)) {
        return res.json({
          type: 'texte',
          mode: 'scanner',
          texte: "Format d'image non pris en charge. Envoie une capture JPG, PNG ou WEBP.",
        });
      }
      image = {
        mime: req.file.mimetype,
        data: req.file.buffer,
      };
    }

    if (message === '' && !image) {
      return res.json({
        type: 'texte',
        mode: 'scanner',
        texte: "Colle un SMS ou joins une capture d'écran pour lancer l'analyse.",
      });
    }

    if (message.startsWith('/')) {
      const resultat = await apprendre.executer(message, image, req.session);
      return res.json(resultat);
    } else {
      const verdict = await scanner.analyser(message, image);
      return res.json(verdict);
    }
  } catch (err: any) {
    console.error('Erreur API analyser:', err?.message || err);
    return res.json({
      type: 'texte',
      mode: 'scanner',
      texte: "Une erreur est survenue. Réessaie dans un instant.",
    });
  }
};

app.post('/api/analyser', upload.single('image'), handleAnalyser);
app.post('/api/analyser.php', upload.single('image'), handleAnalyser);

// Gestion des erreurs Multer (ex: taille dépassée)
app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.json({
      type: 'texte',
      mode: 'scanner',
      texte: "L'image dépasse 4 Mo. Envoie une capture plus légère.",
    });
  }
  next(err);
});

// Démarrage du serveur
app.listen(PORT, HOST, () => {
  console.log(`Fraude Scanner server running at http://${HOST}:${PORT}`);
});
