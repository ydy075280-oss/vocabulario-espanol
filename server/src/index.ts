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

// Global error handler — 捕获所有未处理的异常，输出详细堆栈
app.use((err: any, _req: any, res: any, _next: any) => {
  console.error('🔥 [Server] Unhandled Error:', err.message);
  console.error('🔥 [Server] Stack:', err.stack);
  console.error('🔥 [Server] URL:', _req?.originalUrl || 'unknown');
  res.status(err.status || 500).json({
    error: err.message || '服务器内部错误',
    ...(process.env.NODE_ENV === 'dev' && { stack: err.stack }),
  });
});

// Serve frontend in production
if (process.env.NODE_ENV === 'production') {
  const clientBuild = path.join(__dirname, '..', '..', 'client', 'dist');
  app.use(express.static(clientBuild));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientBuild, 'index.html'));
  });
}

// Initialize database then start server
initDatabase()
  .then(() => {
    console.log('📦 Database initialized');
    app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
      console.log(`📚 API available at http://localhost:${PORT}/api`);
    });
  })
  .catch((err) => {
    console.error('❌ Failed to initialize database:', err);
    process.exit(1);
  });

export default app;
