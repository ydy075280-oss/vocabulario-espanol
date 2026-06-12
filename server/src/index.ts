import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { initDatabase } from './db';
import authRoutes from './routes/auth';
import uploadRoutes from './routes/upload';
import wordbookRoutes from './routes/wordbooks';
import cardRoutes from './routes/cards';
import learnRoutes from './routes/learn';
import createRoutes from './routes/create';
import ttsRoutes from './routes/tts';
import moduleRoutes from './routes/modules';

// Initialize database
initDatabase();
console.log('📦 Database initialized');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map(s => s.trim())
    : ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3001'],
  credentials: true,
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/wordbooks', wordbookRoutes);
app.use('/api/cards', cardRoutes);
app.use('/api/learn', learnRoutes);
app.use('/api/create', createRoutes);
app.use('/api/tts', ttsRoutes);
app.use('/api/modules', moduleRoutes);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve frontend in production
if (process.env.NODE_ENV === 'production') {
  const clientBuild = path.join(__dirname, '..', '..', 'client', 'dist');
  app.use(express.static(clientBuild));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientBuild, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📚 API available at http://localhost:${PORT}/api`);
});

export default app;
